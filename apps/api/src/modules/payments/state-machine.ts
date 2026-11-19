import { canTransition, type PaymentStatus, type WebhookEventType } from '@app/shared';
import type { Tx } from '../../db/pool';
import { one } from '../../db/pool';
import { Errors } from '../../lib/errors';
import { emitEvent } from '../webhooks/merchant-webhooks.service';
import { notifyOrg } from '../notifications/notifications.service';
import type { PaymentRow } from './payments.repo';
import { toPaymentDTO } from './payments.repo';
import { formatMoney } from '@app/shared';

const EVENT_FOR_STATUS: Partial<Record<PaymentStatus, WebhookEventType>> = {
  pending: 'payment.pending',
  processing: 'payment.processing',
  successful: 'payment.success',
  failed: 'payment.failed',
  expired: 'payment.expired',
  reversed: 'payment.reversed',
  refunded: 'payment.refunded',
  partially_refunded: 'payment.refunded',
};

/**
 * The only way a payment's status changes. Locks the row, validates the transition against the
 * state machine, records history and emits the merchant event — all in the caller's transaction.
 */
export async function transitionPayment(
  tx: Tx,
  paymentId: string,
  to: PaymentStatus,
  opts: { actor: string; reason?: string; patch?: Partial<Pick<PaymentRow, 'paid_at' | 'available_at' | 'amount_received' | 'failure_reason' | 'settled_at'>> },
): Promise<PaymentRow> {
  const current = await one<PaymentRow>(tx, `SELECT * FROM payments WHERE id=$1 FOR UPDATE`, [paymentId]);
  if (!current) throw Errors.notFound('Payment');
  if (current.status === to && to === 'partially_refunded') {
    // repeated partial refund: no status change, still recorded below
  } else if (!canTransition(current.status, to)) {
    throw Errors.invalidTransition(current.status, to);
  }

  const patch = opts.patch ?? {};
  const updated = await one<PaymentRow>(
    tx,
    `UPDATE payments SET status=$2,
        paid_at = COALESCE($3, paid_at), available_at = COALESCE($4, available_at),
        amount_received = COALESCE($5, amount_received), failure_reason = COALESCE($6, failure_reason)
      WHERE id=$1 RETURNING *`,
    [paymentId, to, patch.paid_at ?? null, patch.available_at ?? null, patch.amount_received ?? null, patch.failure_reason ?? null],
  );
  await tx.query(
    `INSERT INTO payment_status_history (payment_id, from_status, to_status, reason, actor) VALUES ($1,$2,$3,$4,$5)`,
    [paymentId, current.status, to, opts.reason ?? null, opts.actor],
  );

  const event = EVENT_FOR_STATUS[to];
  if (event) {
    const dto = await toPaymentDTO(tx, updated!);
    await emitEvent(tx, updated!.organization_id, updated!.mode, event, dto as unknown as Record<string, unknown>);
  }
  if (to === 'successful') {
    await notifyOrg(tx, updated!.organization_id, 'payment.successful', 'Payment received',
      `${formatMoney(updated!.amount)} received for ${updated!.reference}.`, { paymentId });
  } else if (to === 'failed') {
    await notifyOrg(tx, updated!.organization_id, 'payment.failed', 'Payment failed',
      `${updated!.reference} failed${opts.reason ? `: ${opts.reason}` : ''}.`, { paymentId });
  }
  return updated!;
}
