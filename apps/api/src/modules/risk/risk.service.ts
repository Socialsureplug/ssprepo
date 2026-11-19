import type { Mode } from '@app/shared';
import { config } from '../../config';
import type { Db } from '../../db/pool';
import { one } from '../../db/pool';

/**
 * Risk & fraud foundation: simple, explainable rules that raise risk events for human review.
 * Only data needed for fraud prevention is used (amounts, counts, references, IP address).
 * Rules never silently move money; they flag, and high-severity flags hold payouts for review.
 */
export interface RiskFlag { rule: string; severity: 'low' | 'medium' | 'high'; details: Record<string, unknown>; }

async function record(db: Db, orgId: string, mode: Mode, subjectType: string, subjectId: string, ip: string | null, flags: RiskFlag[]) {
  for (const f of flags) {
    await db.query(
      `INSERT INTO risk_events (organization_id, mode, rule, severity, subject_type, subject_id, details, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [orgId, mode, f.rule, f.severity, subjectType, subjectId, JSON.stringify(f.details), ip],
    );
  }
}

export async function evaluatePayment(db: Db, p: { organizationId: string; mode: Mode; paymentId: string; amount: number; email: string; ip: string | null }) {
  const flags: RiskFlag[] = [];
  const r = config.rules;
  if (p.amount >= r.largeTransactionThreshold) {
    flags.push({ rule: 'large_transaction', severity: 'medium', details: { amount: p.amount, threshold: r.largeTransactionThreshold } });
  }
  const velocity = await one<{ n: number }>(
    db,
    `SELECT count(*)::int AS n FROM payments WHERE organization_id=$1 AND mode=$2 AND created_at > now() - make_interval(mins => $3)`,
    [p.organizationId, p.mode, r.velocityWindowMinutes],
  );
  if ((velocity?.n ?? 0) > r.velocityMaxPayments) {
    flags.push({ rule: 'payment_velocity', severity: 'medium', details: { count: velocity!.n, windowMinutes: r.velocityWindowMinutes } });
  }
  const sameCustomer = await one<{ n: number }>(
    db,
    `SELECT count(*)::int AS n FROM payments p JOIN customers c ON c.id=p.customer_id
      WHERE p.organization_id=$1 AND p.mode=$2 AND c.email=$3 AND p.created_at > now() - interval '1 hour'`,
    [p.organizationId, p.mode, p.email],
  );
  if ((sameCustomer?.n ?? 0) > 20) flags.push({ rule: 'customer_velocity', severity: 'low', details: { count: sameCustomer!.n } });
  if (flags.length && p.mode === 'live') await record(db, p.organizationId, p.mode, 'payment', p.paymentId, p.ip, flags);
  return flags;
}

export async function evaluateFailureRate(db: Db, organizationId: string, mode: Mode) {
  const s = await one<{ total: number; failed: number }>(
    db,
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE status IN ('failed','expired'))::int AS failed
       FROM payments WHERE organization_id=$1 AND mode=$2 AND created_at > now() - interval '24 hours'`,
    [organizationId, mode],
  );
  if (s && s.total >= 50 && s.failed / s.total > 0.6) {
    const existing = await one(db, `SELECT 1 FROM risk_events WHERE organization_id=$1 AND rule='high_failure_rate' AND created_at > now() - interval '24 hours'`, [organizationId]);
    if (!existing && mode === 'live') {
      await record(db, organizationId, mode, 'organization', organizationId, null, [
        { rule: 'high_failure_rate', severity: 'medium', details: { total: s.total, failed: s.failed } },
      ]);
    }
  }
}

export async function evaluateWithdrawal(db: Db, w: { organizationId: string; mode: Mode; withdrawalId: string; amount: number; bankAccountCreatedAt: Date; ip: string | null }) {
  const flags: RiskFlag[] = [];
  if (Date.now() - w.bankAccountCreatedAt.getTime() < 24 * 60 * 60 * 1000) {
    flags.push({ rule: 'new_bank_account', severity: 'high', details: { addedAt: w.bankAccountCreatedAt.toISOString() } });
  }
  if (w.amount >= config.rules.largeTransactionThreshold) {
    flags.push({ rule: 'large_withdrawal', severity: 'medium', details: { amount: w.amount } });
  }
  const recent = await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM withdrawals WHERE organization_id=$1 AND mode=$2 AND created_at > now() - interval '1 hour'`, [w.organizationId, w.mode]);
  if ((recent?.n ?? 0) >= 5) flags.push({ rule: 'withdrawal_velocity', severity: 'high', details: { lastHour: recent!.n } });
  if (flags.length && w.mode === 'live') await record(db, w.organizationId, w.mode, 'withdrawal', w.withdrawalId, w.ip, flags);
  return flags;
}
