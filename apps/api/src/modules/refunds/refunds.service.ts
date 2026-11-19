import type { Mode } from '@app/shared';
import { formatMoney } from '@app/shared';
import { pool, one, withTx } from '../../db/pool';
import { AppError, Errors } from '../../lib/errors';
import { refs } from '../../lib/ids';
import { audit, type Actor, actorLabel } from '../../lib/audit';
import { enqueue } from '../../jobs/queue';
import * as ledger from '../ledger/ledger.service';
import { getProviderById } from '../../providers/registry';
import { transitionPayment } from '../payments/state-machine';
import type { PaymentRow } from '../payments/payments.repo';
import { notifyOrg } from '../notifications/notifications.service';

export interface RefundRow {
  id: string; organization_id: string; mode: Mode; payment_id: string; reference: string; amount: number; reason: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed'; debit_account: 'merchant_pending' | 'merchant_available';
  provider_reference: string | null; failure_reason: string | null; created_at: Date; completed_at: Date | null;
}

/**
 * Request a refund for a successful bank-transfer payment. Funds are reserved immediately
 * (merchant balance → payouts in transit) so the same money cannot be refunded or withdrawn twice.
 * Idempotent per (organization, idempotency key).
 */
export async function createRefund(
  organizationId: string, mode: Mode, input: { payment: string; amount?: number; reason?: string },
  ctx: { actor: Actor; idempotencyKey: string },
): Promise<RefundRow> {
  return withTx(async (tx) => {
    await ledger.lockMerchantBalance(tx, organizationId, mode);
    const existing = await one<RefundRow>(tx, `SELECT * FROM refunds WHERE organization_id=$1 AND idempotency_key=$2`, [organizationId, ctx.idempotencyKey]);
    if (existing) return existing;

    const isUuid = /^[0-9a-f-]{36}$/i.test(input.payment);
    const payment = await one<PaymentRow>(
      tx,
      `SELECT * FROM payments WHERE organization_id=$1 AND mode=$2 AND ${isUuid ? 'id=$3::uuid' : 'reference=$3'} FOR UPDATE`,
      [organizationId, mode, input.payment],
    );
    if (!payment) throw Errors.notFound('Payment');
    if (!['successful', 'partially_refunded'].includes(payment.status)) {
      throw new AppError('payment_not_refundable', 'Only successful payments can be refunded.', 422);
    }
    const refundable = payment.amount - payment.amount_refunded;
    const amount = input.amount ?? refundable;
    if (amount <= 0 || amount > refundable) {
      throw new AppError('invalid_amount', `Refund amount must be between ₦0.01 and ${formatMoney(refundable)}.`, 422);
    }
    const debitAccount = payment.settled_at ? 'merchant_available' : 'merchant_pending';
    const balance = await ledger.accountBalance(tx, debitAccount, mode, organizationId);
    if (balance < amount) throw Errors.insufficientBalance();

    const refund = await one<RefundRow>(
      tx,
      `INSERT INTO refunds (organization_id, mode, payment_id, reference, amount, reason, idempotency_key, requested_by, debit_account)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [organizationId, mode, payment.id, refs.refund(), amount, input.reason ?? null, ctx.idempotencyKey, actorLabel(ctx.actor), debitAccount],
    );
    await tx.query(`UPDATE payments SET amount_refunded = amount_refunded + $2 WHERE id=$1`, [payment.id, amount]);
    await ledger.post(tx, {
      mode, organizationId, kind: 'refund', description: `Refund ${refund!.reference} for ${payment.reference}`,
      referenceType: 'refund', referenceId: refund!.id, idempotencyKey: `refund:${refund!.id}`, createdBy: actorLabel(ctx.actor),
      lines: [{ account: debitAccount, direction: 'debit', amount }, { account: 'payout_clearing', direction: 'credit', amount }],
    });
    await enqueue(tx, 'refund.process', { refundId: refund!.id }, { dedupeKey: refund!.id });
    await audit(tx, ctx.actor, 'refund.created', { organizationId, targetType: 'refund', targetId: refund!.id, metadata: { amount, payment: payment.reference } });
    return refund!;
  });
}

/** Send a pending refund to the provider. */
export async function processRefundJob(payload: { refundId: string }) {
  const refund = await one<RefundRow>(pool, `SELECT * FROM refunds WHERE id=$1`, [payload.refundId]);
  if (!refund || refund.status !== 'pending') return;
  const payment = await one<PaymentRow>(pool, `SELECT * FROM payments WHERE id=$1`, [refund.payment_id]);
  const collection = await one(pool, `SELECT * FROM provider_transactions WHERE payment_id=$1 AND kind='collection' AND match_status IN ('matched','mismatch') ORDER BY created_at LIMIT 1`, [refund.payment_id]);
  if (!payment || !collection) {
    await failRefund(refund.reference, 'No confirmed provider transaction to refund');
    return;
  }
  const { provider } = await getProviderById(pool, collection.provider_id);
  const result = await provider.processRefund({
    reference: refund.reference, paymentReference: payment.reference, collectionProviderReference: collection.provider_reference,
    amount: refund.amount, reason: refund.reason,
  });
  await pool.query(`UPDATE refunds SET status='processing', provider_reference=$2 WHERE id=$1 AND status='pending'`, [refund.id, result.providerReference]);
  if (result.status === 'completed') await completeRefund(refund.reference, result.providerReference);
  if (result.status === 'failed') await failRefund(refund.reference, 'Provider declined the refund');
}

export async function completeRefund(reference: string, providerReference: string) {
  await withTx(async (tx) => {
    const r = await one<RefundRow>(tx, `SELECT * FROM refunds WHERE reference=$1 FOR UPDATE`, [reference]);
    if (!r || r.status === 'completed' || r.status === 'failed') return;
    await tx.query(`UPDATE refunds SET status='completed', provider_reference=COALESCE(provider_reference,$2), completed_at=now() WHERE id=$1`, [r.id, providerReference]);
    await ledger.post(tx, {
      mode: r.mode, organizationId: r.organization_id, kind: 'refund', description: `Refund ${r.reference} paid out`,
      referenceType: 'refund', referenceId: r.id, idempotencyKey: `refund_complete:${r.id}`, createdBy: 'provider',
      lines: [{ account: 'payout_clearing', direction: 'debit', amount: r.amount }, { account: 'provider_clearing', direction: 'credit', amount: r.amount }],
    });
    const p = await one<PaymentRow>(tx, `SELECT * FROM payments WHERE id=$1`, [r.payment_id]);
    const completedTotal = (await one<{ s: number }>(tx, `SELECT COALESCE(sum(amount),0) AS s FROM refunds WHERE payment_id=$1 AND status='completed'`, [r.payment_id]))!.s;
    if (p && ['successful', 'partially_refunded'].includes(p.status)) {
      await transitionPayment(tx, p.id, completedTotal >= p.amount ? 'refunded' : 'partially_refunded', { actor: 'provider', reason: `refund ${r.reference}` });
    }
    await notifyOrg(tx, r.organization_id, 'refund.completed', 'Refund completed', `Refund ${r.reference} of ${formatMoney(r.amount)} was completed.`, { refundId: r.id });
  });
}

export async function failRefund(reference: string, reason: string) {
  await withTx(async (tx) => {
    const r = await one<RefundRow>(tx, `SELECT * FROM refunds WHERE reference=$1 FOR UPDATE`, [reference]);
    if (!r || r.status === 'completed' || r.status === 'failed') return;
    await tx.query(`UPDATE refunds SET status='failed', failure_reason=$2 WHERE id=$1`, [r.id, reason]);
    await tx.query(`UPDATE payments SET amount_refunded = amount_refunded - $2 WHERE id=$1`, [r.payment_id, r.amount]);
    await ledger.post(tx, {
      mode: r.mode, organizationId: r.organization_id, kind: 'refund', description: `Refund ${r.reference} failed — funds restored`,
      referenceType: 'refund', referenceId: r.id, idempotencyKey: `refund_fail:${r.id}`, createdBy: 'provider',
      lines: [{ account: 'payout_clearing', direction: 'debit', amount: r.amount }, { account: r.debit_account, direction: 'credit', amount: r.amount }],
    });
    await audit(tx, { type: 'provider' }, 'refund.failed', { organizationId: r.organization_id, targetType: 'refund', targetId: r.id, metadata: { reason } });
  });
}

export function refundDTO(r: RefundRow & { payment_reference?: string }) {
  return {
    id: r.id, reference: r.reference, paymentId: r.payment_id, paymentReference: r.payment_reference, amount: r.amount, reason: r.reason,
    status: r.status, failureReason: r.failure_reason, createdAt: r.created_at, completedAt: r.completed_at, mode: r.mode,
  };
}
