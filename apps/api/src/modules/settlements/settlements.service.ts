import type { Mode } from '@app/shared';
import { formatMoney } from '@app/shared';
import { pool, one, query, withTx } from '../../db/pool';
import { decrypt, sha256 } from '../../lib/crypto';
import { refs } from '../../lib/ids';
import { audit, SYSTEM_ACTOR } from '../../lib/audit';
import { enqueue } from '../../jobs/queue';
import * as ledger from '../ledger/ledger.service';
import { selectCollectionProvider } from '../../providers/registry';
import { emitEvent } from '../webhooks/merchant-webhooks.service';
import { notifyOrg } from '../notifications/notifications.service';

export interface SettlementRow {
  id: string; organization_id: string; mode: Mode; reference: string; status: 'pending' | 'processing' | 'completed' | 'failed' | 'reversed';
  schedule: string; destination: 'bank' | 'balance'; gross_amount: number; fee_amount: number; net_amount: number; payment_count: number;
  bank_account_id: string | null; provider_reference: string | null; failure_reason: string | null; processed_at: Date | null;
  completed_at: Date | null; created_at: Date;
}

/**
 * Settlement rules (per merchant `settlement_schedule`):
 *   t0     funds mature immediately; paid out to the settlement bank account on the next run
 *   t1     funds mature 24h after payment; then paid out to the bank account
 *   manual funds mature immediately into the AVAILABLE balance; the merchant withdraws on demand
 * Scheduled/custom rules plug in by changing how `available_at` is computed at payment time.
 *
 * Ledger:
 *   to bank:    Dr merchant_pending  / Cr payout_clearing   → on completion Dr payout_clearing / Cr provider_clearing
 *               on failure Dr payout_clearing / Cr merchant_available (money stays with the merchant, withdrawable)
 *   to balance: Dr merchant_pending  / Cr merchant_available
 */
export async function runSettlements(): Promise<number> {
  const groups = await query<{ organization_id: string; mode: Mode }>(
    pool,
    `SELECT DISTINCT p.organization_id, p.mode FROM payments p JOIN organizations o ON o.id=p.organization_id
      WHERE p.status IN ('successful','partially_refunded') AND p.settled_at IS NULL AND p.available_at <= now()
        AND o.status='active' AND o.risk_status NOT IN ('blocked','restricted')`,
  );
  let created = 0;
  for (const g of groups) {
    if (await createSettlement(g.organization_id, g.mode)) created++;
  }
  return created;
}

export async function createSettlement(organizationId: string, mode: Mode): Promise<SettlementRow | null> {
  return withTx(async (tx) => {
    await ledger.lockMerchantBalance(tx, organizationId, mode);
    const org = await one(tx, `SELECT * FROM organizations WHERE id=$1`, [organizationId]);
    const items = await query<{ id: string; amount: number; fee: number; net: number }>(
      tx,
      `SELECT p.id, p.amount, p.fee,
              p.net_amount - COALESCE((SELECT sum(r.amount) FROM refunds r WHERE r.payment_id=p.id AND r.debit_account='merchant_pending' AND r.status <> 'failed'),0) AS net
         FROM payments p
        WHERE p.organization_id=$1 AND p.mode=$2 AND p.status IN ('successful','partially_refunded') AND p.settled_at IS NULL AND p.available_at <= now()
        ORDER BY p.paid_at FOR UPDATE`,
      [organizationId, mode],
    );
    if (!items.length) return null;
    const net = items.reduce((s, i) => s + i.net, 0);
    if (net < 0) return null; // refunds exceed matured funds; wait for more funds to mature
    const gross = items.reduce((s, i) => s + i.amount, 0);
    const fees = items.reduce((s, i) => s + i.fee, 0);

    const bank = await one(tx, `SELECT id FROM bank_accounts WHERE organization_id=$1 AND is_default AND status='active'`, [organizationId]);
    const destination: 'bank' | 'balance' = org.settlement_schedule !== 'manual' && bank && net > 0 ? 'bank' : 'balance';
    const idempotencyKey = `stl:${organizationId}:${mode}:${sha256(items.map((i) => i.id).sort().join(','))}`;

    const s = await one<SettlementRow>(
      tx,
      `INSERT INTO settlements (organization_id, mode, reference, status, schedule, destination, gross_amount, fee_amount, net_amount,
                                payment_count, bank_account_id, idempotency_key, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`,
      [organizationId, mode, refs.settlement(), destination === 'balance' ? 'completed' : 'pending', org.settlement_schedule, destination,
        gross, fees, net, items.length, destination === 'bank' ? bank.id : null, idempotencyKey, destination === 'balance' ? new Date() : null],
    );
    if (!s) return null;
    for (const i of items) {
      await tx.query(`INSERT INTO settlement_items (settlement_id, payment_id, gross_amount, fee_amount, net_amount) VALUES ($1,$2,$3,$4,$5)`, [s.id, i.id, i.amount, i.fee, i.net]);
    }
    await tx.query(`UPDATE payments SET settled_at=now() WHERE id = ANY($1)`, [items.map((i) => i.id)]);

    if (net > 0) {
      await ledger.post(tx, {
        mode, organizationId, kind: destination === 'bank' ? 'settlement' : 'release',
        description: destination === 'bank' ? `Settlement ${s.reference} to bank` : `Settlement ${s.reference} to available balance`,
        referenceType: 'settlement', referenceId: s.id, idempotencyKey: `settlement:${s.id}`, createdBy: 'system',
        lines: [
          { account: 'merchant_pending', direction: 'debit', amount: net },
          { account: destination === 'bank' ? 'payout_clearing' : 'merchant_available', direction: 'credit', amount: net },
        ],
      });
    }
    await emitEvent(tx, organizationId, mode, 'settlement.created', settlementDTO(s));
    if (destination === 'bank') {
      await enqueue(tx, 'settlement.process', { settlementId: s.id }, { dedupeKey: s.id });
    } else {
      await emitEvent(tx, organizationId, mode, 'settlement.completed', settlementDTO(s));
      await notifyOrg(tx, organizationId, 'settlement.completed', 'Funds settled to your balance',
        `${formatMoney(net)} from ${items.length} payment(s) is now in your available balance.`, { settlementId: s.id });
    }
    await audit(tx, SYSTEM_ACTOR, 'settlement.created', { organizationId, targetType: 'settlement', targetId: s.id, metadata: { net, destination } });
    return s;
  });
}

export async function processSettlementJob(payload: { settlementId: string }) {
  const s = await one<SettlementRow>(pool, `SELECT * FROM settlements WHERE id=$1`, [payload.settlementId]);
  if (!s || s.status !== 'pending') return;
  const bank = await one(pool, `SELECT * FROM bank_accounts WHERE id=$1`, [s.bank_account_id]);
  const { provider, row } = await selectCollectionProvider(pool, s.mode);
  const result = await provider.initiateSettlement({
    reference: s.reference, amount: s.net_amount, bankCode: bank.bank_code, accountNumber: decrypt(bank.account_number_encrypted),
    accountName: bank.account_name, narration: `Settlement ${s.reference}`,
  });
  await pool.query(
    `UPDATE settlements SET status='processing', provider_id=$2, provider_reference=$3, processed_at=now() WHERE id=$1 AND status='pending'`,
    [s.id, row.id, result.providerReference],
  );
  if (result.status === 'completed') await completeSettlement(s.reference, result.providerReference);
  if (result.status === 'failed') await failSettlement(s.reference, result.failureReason ?? 'Provider declined the transfer');
}

export async function completeSettlement(reference: string, providerReference: string) {
  await withTx(async (tx) => {
    const s = await one<SettlementRow>(tx, `SELECT * FROM settlements WHERE reference=$1 FOR UPDATE`, [reference]);
    if (!s || !['pending', 'processing'].includes(s.status)) return;
    const updated = await one<SettlementRow>(tx, `UPDATE settlements SET status='completed', completed_at=now(), provider_reference=COALESCE(provider_reference,$2) WHERE id=$1 RETURNING *`, [s.id, providerReference]);
    await ledger.post(tx, {
      mode: s.mode, organizationId: s.organization_id, kind: 'settlement', description: `Settlement ${s.reference} confirmed by provider`,
      referenceType: 'settlement', referenceId: s.id, idempotencyKey: `settlement_complete:${s.id}`, createdBy: 'provider',
      lines: [{ account: 'payout_clearing', direction: 'debit', amount: s.net_amount }, { account: 'provider_clearing', direction: 'credit', amount: s.net_amount }],
    });
    await emitEvent(tx, s.organization_id, s.mode, 'settlement.completed', settlementDTO(updated!));
    await notifyOrg(tx, s.organization_id, 'settlement.completed', 'Settlement completed', `${formatMoney(s.net_amount)} was sent to your settlement account (${s.reference}).`, { settlementId: s.id });
  });
}

export async function failSettlement(reference: string, reason: string) {
  await withTx(async (tx) => {
    const s = await one<SettlementRow>(tx, `SELECT * FROM settlements WHERE reference=$1 FOR UPDATE`, [reference]);
    if (!s || !['pending', 'processing'].includes(s.status)) return;
    const updated = await one<SettlementRow>(tx, `UPDATE settlements SET status='failed', failure_reason=$2 WHERE id=$1 RETURNING *`, [s.id, reason]);
    await ledger.post(tx, {
      mode: s.mode, organizationId: s.organization_id, kind: 'settlement_reversal', description: `Settlement ${s.reference} failed — funds returned to available balance`,
      referenceType: 'settlement', referenceId: s.id, idempotencyKey: `settlement_fail:${s.id}`, createdBy: 'provider',
      lines: [{ account: 'payout_clearing', direction: 'debit', amount: s.net_amount }, { account: 'merchant_available', direction: 'credit', amount: s.net_amount }],
    });
    await tx.query(
      `INSERT INTO reconciliation_issues (type, fingerprint, organization_id, mode, settlement_id, expected_amount, details)
       VALUES ('failed_settlement',$1,$2,$3,$4,$5,$6) ON CONFLICT (fingerprint) DO NOTHING`,
      [`failed_settlement:${s.id}`, s.organization_id, s.mode, s.id, s.net_amount, JSON.stringify({ reason })],
    );
    await emitEvent(tx, s.organization_id, s.mode, 'settlement.failed', settlementDTO(updated!));
    await notifyOrg(tx, s.organization_id, 'settlement.failed', 'Settlement failed',
      `Settlement ${s.reference} of ${formatMoney(s.net_amount)} could not be completed: ${reason}. The funds are in your available balance; check your settlement account details.`, { settlementId: s.id });
  });
}

export function settlementDTO(s: SettlementRow & { bank_name?: string; account_number_last4?: string }) {
  return {
    id: s.id, reference: s.reference, status: s.status, schedule: s.schedule, destination: s.destination, grossAmount: s.gross_amount,
    feeAmount: s.fee_amount, netAmount: s.net_amount, paymentCount: s.payment_count, failureReason: s.failure_reason,
    bankAccount: s.bank_name ? { bankName: s.bank_name, last4: s.account_number_last4 } : null,
    createdAt: s.created_at, completedAt: s.completed_at, mode: s.mode,
  };
}
