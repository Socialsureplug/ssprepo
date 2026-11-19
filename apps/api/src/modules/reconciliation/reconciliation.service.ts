import type { ReconStatus } from '@app/shared';
import { pool, one, query, withTx } from '../../db/pool';
import { AppError, Errors } from '../../lib/errors';
import { audit, type Actor } from '../../lib/audit';
import { logger } from '../../lib/logger';
import { buildProvider, type ProviderRow } from '../../providers/registry';
import * as ledger from '../ledger/ledger.service';

/**
 * Three-way reconciliation:
 *   provider records (provider.listTransactions)  vs  provider_transactions (what we ingested)
 *   payments                                      vs  ledger (every success has a posting)
 *   settlements                                   vs  provider confirmations (failed / stuck)
 * Issues are de-duplicated by fingerprint so re-runs never create noise.
 */
export async function runReconciliation(from: Date, to: Date) {
  const run = (await one<{ id: string }>(pool, `INSERT INTO reconciliation_runs (period_start, period_end) VALUES ($1,$2) RETURNING id`, [from, to]))!;
  let checked = 0;
  let issues = 0;
  const raise = async (type: string, fingerprint: string, f: { organizationId?: string | null; mode?: string | null; paymentId?: string | null; providerTransactionId?: string | null; settlementId?: string | null; expected?: number | null; actual?: number | null; details?: Record<string, unknown> }) => {
    const r = await one(
      pool,
      `INSERT INTO reconciliation_issues (run_id, type, fingerprint, organization_id, mode, payment_id, provider_transaction_id, settlement_id, expected_amount, actual_amount, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (fingerprint) DO NOTHING RETURNING id`,
      [run.id, type, fingerprint, f.organizationId ?? null, f.mode ?? null, f.paymentId ?? null, f.providerTransactionId ?? null,
        f.settlementId ?? null, f.expected ?? null, f.actual ?? null, JSON.stringify(f.details ?? {})],
    );
    if (r) issues++;
  };

  try {
    // 1. Provider vs internal records
    const providers = await query<ProviderRow>(pool, `SELECT * FROM payment_providers WHERE enabled`);
    for (const row of providers) {
      let remote;
      try {
        remote = await buildProvider(row).listTransactions(from, to);
      } catch (err) {
        logger.warn({ provider: row.code, err: (err as Error).message }, 'Reconciliation could not list provider transactions');
        continue;
      }
      for (const t of remote.filter((x) => x.kind === 'collection' && x.status === 'completed')) {
        checked++;
        const ours = await query(pool, `SELECT * FROM provider_transactions WHERE provider_id=$1 AND provider_reference=$2 AND kind='collection'`, [row.id, t.providerReference]);
        if (ours.length === 0) {
          await raise('missing_transaction', `missing:${row.id}:${t.providerReference}`, { details: { provider: row.code, providerReference: t.providerReference, side: 'internal' }, actual: t.amount });
        } else if (ours[0].amount !== t.amount) {
          await raise('amount_mismatch', `amount:${ours[0].id}`, { organizationId: null, providerTransactionId: ours[0].id, paymentId: ours[0].payment_id, expected: t.amount, actual: ours[0].amount, details: { source: 'provider_vs_internal' } });
        }
      }
    }

    // 2. Payments vs ledger: every confirmed payment must have exactly one payment posting.
    const paid = await query(
      pool,
      `SELECT p.id, p.organization_id, p.mode, p.amount,
              (SELECT count(*)::int FROM ledger_transactions t WHERE t.idempotency_key = 'payment:' || p.id) AS postings,
              (SELECT count(*)::int FROM provider_transactions pt WHERE pt.payment_id = p.id AND pt.kind='collection' AND pt.match_status IN ('matched','mismatch')) AS credits
         FROM payments p WHERE p.paid_at BETWEEN $1 AND $2`,
      [from, to],
    );
    for (const p of paid) {
      checked++;
      if (p.postings === 0) await raise('missing_transaction', `ledger_missing:${p.id}`, { organizationId: p.organization_id, mode: p.mode, paymentId: p.id, expected: p.amount, details: { side: 'ledger' } });
      if (p.credits > 1) await raise('duplicate_transaction', `dup_credit:${p.id}`, { organizationId: p.organization_id, mode: p.mode, paymentId: p.id, details: { credits: p.credits } });
    }

    // 3. Unmatched provider money still sitting in our records.
    const unmatched = await query(pool, `SELECT * FROM provider_transactions WHERE match_status='unmatched' AND kind='collection' AND occurred_at BETWEEN $1 AND $2`, [from, to]);
    for (const u of unmatched) {
      checked++;
      await raise('unmatched_transaction', `unmatched_transaction:${u.id}`, { providerTransactionId: u.id, mode: u.mode, actual: u.amount });
    }

    // 4. Settlements: failed, or stuck in processing for more than a day.
    const stuck = await query(pool, `SELECT * FROM settlements WHERE (status='failed') OR (status='processing' AND processed_at < now() - interval '24 hours')`);
    for (const s of stuck) {
      checked++;
      await raise('failed_settlement', `failed_settlement:${s.id}`, { organizationId: s.organization_id, mode: s.mode, settlementId: s.id, expected: s.net_amount, details: { status: s.status } });
    }

    // 5. Ledger integrity (should be impossible to break thanks to DB constraints).
    for (const mode of ['test', 'live'] as const) {
      const tb = await ledger.trialBalance(pool, mode);
      if (tb && tb.debits !== tb.credits) logger.error({ mode, tb }, 'LEDGER TRIAL BALANCE MISMATCH');
    }

    await pool.query(`UPDATE reconciliation_runs SET status='completed', finished_at=now(), checked_count=$2, issues_found=$3 WHERE id=$1`, [run.id, checked, issues]);
  } catch (err) {
    await pool.query(`UPDATE reconciliation_runs SET status='failed', finished_at=now(), error=$2 WHERE id=$1`, [run.id, (err as Error).message]);
    throw err;
  }
  return { runId: run.id, checked, issues };
}

const ALLOWED: Record<ReconStatus, ReconStatus[]> = { open: ['investigating', 'resolved'], investigating: ['open', 'resolved'], resolved: ['investigating'] };

export async function updateIssueStatus(id: string, status: ReconStatus, note: string, actor: Actor) {
  if (!note?.trim()) throw new AppError('note_required', 'A note is required for every reconciliation status change.', 422);
  return withTx(async (tx) => {
    const issue = await one(tx, `SELECT * FROM reconciliation_issues WHERE id=$1 FOR UPDATE`, [id]);
    if (!issue) throw Errors.notFound('Reconciliation issue');
    if (!ALLOWED[issue.status as ReconStatus].includes(status)) throw Errors.invalidTransition(issue.status, status);
    const updated = await one(
      tx,
      `UPDATE reconciliation_issues SET status=$2, resolution_note=$3, resolved_by=CASE WHEN $2='resolved' THEN $4::uuid ELSE NULL END,
              resolved_at=CASE WHEN $2='resolved' THEN now() ELSE NULL END WHERE id=$1 RETURNING *`,
      [id, status, note, actor.id],
    );
    await audit(tx, actor, 'reconciliation.status_changed', { organizationId: issue.organization_id, targetType: 'reconciliation_issue', targetId: id, metadata: { from: issue.status, to: status, note } });
    return updated;
  });
}
