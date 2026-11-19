import type { Mode, CreatePaymentInput } from '@app/shared';
import { pool, one, query, withTx, type Db, type Tx } from '../../db/pool';
import { AppError, Errors } from '../../lib/errors';
import { refs } from '../../lib/ids';
import { audit, type Actor, actorLabel } from '../../lib/audit';
import { enqueue } from '../../jobs/queue';
import { quotePayment } from '../fees/fees.service';
import { getOrg, assertCanProcess } from '../organizations/org.repo';
import { selectCollectionProvider, getProviderById } from '../../providers/registry';
import type { ProviderTransaction } from '../../providers/types';
import * as ledger from '../ledger/ledger.service';
import { evaluatePayment, evaluateFailureRate } from '../risk/risk.service';
import { emitEvent } from '../webhooks/merchant-webhooks.service';
import { transitionPayment } from './state-machine';
import { type PaymentRow, toPaymentDTO } from './payments.repo';
import { upsertCustomer } from '../customers/customers.service';

export interface CreatePaymentContext { actor: Actor; ip?: string | null; paymentLinkId?: string | null; }

/**
 * Create a bank-transfer payment:
 *  1. validate merchant eligibility, reference uniqueness and compute fees server-side
 *  2. persist the payment (status=created)
 *  3. ask the provider for collection account details (outside the DB transaction)
 *  4. persist the payment intent and move to pending; schedule expiry
 */
export async function createPayment(organizationId: string, mode: Mode, input: CreatePaymentInput, ctx: CreatePaymentContext) {
  const org = await getOrg(pool, organizationId);
  assertCanProcess(org, mode);
  const { provider, row: providerRow } = await selectCollectionProvider(pool, mode);
  const quote = await quotePayment(pool, organizationId, input.amount);
  const expiresAt = new Date(Date.now() + input.expiresInMinutes * 60_000);

  const payment = await withTx(async (tx) => {
    if (input.reference) {
      const dup = await one(tx, `SELECT 1 FROM payments WHERE organization_id=$1 AND mode=$2 AND merchant_reference=$3`, [organizationId, mode, input.reference]);
      if (dup) throw new AppError('duplicate_reference', `A payment with reference ${input.reference} already exists.`, 409);
    }
    const customer = await upsertCustomer(tx, organizationId, mode, { email: input.email, name: input.name, phone: input.phone });
    const p = await one<PaymentRow>(
      tx,
      `INSERT INTO payments (organization_id, mode, reference, merchant_reference, customer_id, amount, fee, net_amount, description,
                             metadata, callback_url, payment_link_id, provider_id, expires_at, created_ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [organizationId, mode, refs.payment(), input.reference ?? null, customer.id, quote.gross, quote.fee, quote.net,
        input.description ?? null, JSON.stringify(input.metadata ?? {}), input.callbackUrl ?? null, ctx.paymentLinkId ?? null,
        providerRow.id, expiresAt, ctx.ip ?? null],
    );
    await tx.query(`INSERT INTO payment_status_history (payment_id, from_status, to_status, actor) VALUES ($1,NULL,'created',$2)`, [p!.id, actorLabel(ctx.actor)]);
    if (ctx.paymentLinkId) await tx.query(`INSERT INTO payment_link_payments (payment_link_id, payment_id) VALUES ($1,$2)`, [ctx.paymentLinkId, p!.id]);
    await evaluatePayment(tx, { organizationId, mode, paymentId: p!.id, amount: p!.amount, email: input.email, ip: ctx.ip ?? null });
    await emitEvent(tx, organizationId, mode, 'payment.created', (await toPaymentDTO(tx, p!)) as any);
    await audit(tx, ctx.actor, 'payment.created', { organizationId, targetType: 'payment', targetId: p!.id, metadata: { amount: p!.amount, mode } });
    return p!;
  });

  let account;
  try {
    account = await provider.createPaymentAccount({
      reference: payment.reference, amount: payment.amount, currency: 'NGN', customerEmail: input.email,
      customerName: input.name, merchantName: org.name, expiresAt,
    });
  } catch (err) {
    await withTx((tx) => transitionPayment(tx, payment.id, 'failed', { actor: 'system', reason: 'provider_unavailable', patch: { failure_reason: 'provider_unavailable' } }));
    throw err instanceof AppError ? err : Errors.providerUnavailable();
  }

  return withTx(async (tx) => {
    await tx.query(
      `INSERT INTO payment_intents (payment_id, provider_id, provider_reference, bank_name, account_name, account_number, expires_at, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [payment.id, providerRow.id, account.providerReference, account.bankName, account.accountName, account.accountNumber,
        account.expiresAt, JSON.stringify(account.raw)],
    );
    const updated = await transitionPayment(tx, payment.id, 'pending', { actor: 'system', reason: 'collection_account_issued' });
    await enqueue(tx, 'payment.expire_due', { paymentId: payment.id }, { runAt: expiresAt, dedupeKey: `expire:${payment.id}` });
    return updated;
  });
}

/** Expire a payment whose window has passed. Re-checks with the provider first so a paid transfer is never expired. */
export async function expirePayment(paymentId: string): Promise<void> {
  const p = await one<PaymentRow>(pool, `SELECT * FROM payments WHERE id=$1`, [paymentId]);
  if (!p || !['created', 'pending'].includes(p.status)) return;
  if (new Date(p.expires_at) > new Date()) return;
  await syncWithProvider(paymentId);
  await withTx(async (tx) => {
    const fresh = await one<PaymentRow>(tx, `SELECT * FROM payments WHERE id=$1 FOR UPDATE`, [paymentId]);
    if (!fresh || !['created', 'pending'].includes(fresh.status)) return;
    await transitionPayment(tx, paymentId, 'expired', { actor: 'system', reason: 'payment_window_elapsed' });
    await tx.query(`UPDATE payment_intents SET status='expired' WHERE payment_id=$1 AND status='active'`, [paymentId]);
  });
  await evaluateFailureRate(pool, p.organization_id, p.mode);
}

/** Sweep for any overdue payments (safety net in case an expiry job was missed). */
export async function expireDuePayments(): Promise<number> {
  const due = await query<{ id: string }>(pool, `SELECT id FROM payments WHERE status IN ('created','pending') AND expires_at < now() LIMIT 500`);
  for (const p of due) await expirePayment(p.id);
  return due.length;
}

/**
 * Pull status from the provider (fallback when a webhook is delayed or lost). Any transactions
 * the provider reports go through the same verified processing path as webhooks.
 */
export async function syncWithProvider(paymentId: string): Promise<void> {
  const intent = await one(pool, `SELECT * FROM payment_intents WHERE payment_id=$1 ORDER BY created_at DESC LIMIT 1`, [paymentId]);
  if (!intent) return;
  const { provider, row } = await getProviderById(pool, intent.provider_id);
  const status = await provider.getPaymentStatus({ providerReference: intent.provider_reference, accountNumber: intent.account_number });
  for (const txn of status.transactions) {
    if (txn.status === 'completed') await recordCollection(row.id, txn);
  }
}

function availableAtFor(schedule: string, paidAt: Date): Date {
  if (schedule === 't1') return new Date(paidAt.getTime() + 24 * 60 * 60 * 1000);
  return paidAt; // t0 and manual: mature immediately
}

/**
 * Record an inbound transfer reported by a provider. Idempotent on (provider, reference).
 * Matches the transfer to a payment via the collection account number and posts the ledger.
 * Money that cannot be attributed cleanly is parked in suspense and raised for reconciliation.
 */
export async function recordCollection(providerId: string, txn: ProviderTransaction): Promise<{ outcome: string; paymentId?: string }> {
  return withTx(async (tx) => {
    const intent = txn.accountNumber
      ? await one(tx, `SELECT * FROM payment_intents WHERE provider_id=$1 AND account_number=$2 ORDER BY created_at DESC LIMIT 1`, [providerId, txn.accountNumber])
      : null;
    const payment = intent ? await one<PaymentRow>(tx, `SELECT * FROM payments WHERE id=$1 FOR UPDATE`, [intent.payment_id]) : null;
    const providerAdapter = (await one<{ adapter: string }>(tx, `SELECT adapter FROM payment_providers WHERE id=$1`, [providerId]))?.adapter;
    const mode: Mode = payment?.mode ?? (providerAdapter === 'sandbox' ? 'test' : 'live');

    const pt = await one<{ id: string }>(
      tx,
      `INSERT INTO provider_transactions (provider_id, mode, provider_reference, kind, amount, account_number, payer_name, payer_account,
                                          payer_bank, payment_id, match_status, occurred_at, raw)
       VALUES ($1,$2,$3,'collection',$4,$5,$6,$7,$8,$9,'unmatched',$10,$11)
       ON CONFLICT (provider_id, provider_reference, kind) DO NOTHING RETURNING id`,
      [providerId, mode, txn.providerReference, txn.amount, txn.accountNumber ?? null, txn.payerName ?? null, txn.payerAccount ?? null,
        txn.payerBank ?? null, payment?.id ?? null, txn.occurredAt, JSON.stringify(txn.raw ?? {})],
    );
    if (!pt) return { outcome: 'duplicate' };

    const suspense = async (reason: string, issueType: string, amount: number, orgId: string | null) => {
      await ledger.post(tx, {
        mode, organizationId: orgId, kind: 'suspense', description: `Unattributed funds: ${reason}`, referenceType: 'provider_transaction',
        referenceId: pt.id, idempotencyKey: `suspense:${pt.id}`, createdBy: 'system',
        lines: [{ account: 'provider_clearing', direction: 'debit', amount }, { account: 'suspense', direction: 'credit', amount }],
      });
      await tx.query(
        `INSERT INTO reconciliation_issues (type, fingerprint, organization_id, mode, payment_id, provider_transaction_id, expected_amount, actual_amount, details)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (fingerprint) DO NOTHING`,
        [issueType, `${issueType}:${pt.id}`, orgId, mode, payment?.id ?? null, pt.id, payment?.amount ?? null, txn.amount, JSON.stringify({ reason })],
      );
    };

    if (!payment) {
      await suspense('no matching collection account', 'unmatched_transaction', txn.amount, null);
      return { outcome: 'unmatched' };
    }

    if (!['created', 'pending', 'processing'].includes(payment.status)) {
      const reason = payment.status === 'successful' || payment.status === 'partially_refunded' ? 'additional transfer to a paid account' : `transfer received after payment ${payment.status}`;
      await tx.query(`UPDATE provider_transactions SET match_status='late' WHERE id=$1`, [pt.id]);
      await suspense(reason, payment.status === 'successful' ? 'duplicate_transaction' : 'unmatched_transaction', txn.amount, payment.organization_id);
      return { outcome: 'late', paymentId: payment.id };
    }

    if (txn.amount < payment.amount) {
      await tx.query(`UPDATE provider_transactions SET match_status='mismatch' WHERE id=$1`, [pt.id]);
      await suspense(`underpayment (expected ${payment.amount}, received ${txn.amount})`, 'amount_mismatch', txn.amount, payment.organization_id);
      await transitionPayment(tx, payment.id, 'failed', { actor: 'provider', reason: 'amount_mismatch', patch: { failure_reason: 'underpaid', amount_received: txn.amount } });
      return { outcome: 'underpaid', paymentId: payment.id };
    }

    const org = await one(tx, `SELECT settlement_schedule FROM organizations WHERE id=$1`, [payment.organization_id]);
    const paidAt = txn.occurredAt ?? new Date();
    await ledger.post(tx, {
      mode, organizationId: payment.organization_id, kind: 'payment', description: `Payment ${payment.reference}`,
      referenceType: 'payment', referenceId: payment.id, idempotencyKey: `payment:${payment.id}`, createdBy: 'provider',
      lines: [
        { account: 'provider_clearing', direction: 'debit', amount: payment.amount },
        { account: 'merchant_pending', direction: 'credit', amount: payment.net_amount },
        { account: 'fee_revenue', direction: 'credit', amount: payment.fee },
      ],
    });
    if (txn.amount > payment.amount) {
      await tx.query(`UPDATE provider_transactions SET match_status='mismatch' WHERE id=$1`, [pt.id]);
      await suspense(`overpayment of ${txn.amount - payment.amount}`, 'amount_mismatch', txn.amount - payment.amount, payment.organization_id);
    } else {
      await tx.query(`UPDATE provider_transactions SET match_status='matched' WHERE id=$1`, [pt.id]);
    }
    await tx.query(`UPDATE payment_intents SET status='used' WHERE id=$1`, [intent.id]);
    await transitionPayment(tx, payment.id, 'successful', {
      actor: 'provider', reason: 'transfer_confirmed',
      patch: { paid_at: paidAt, available_at: availableAtFor(org.settlement_schedule, paidAt), amount_received: txn.amount },
    });
    await audit(tx, { type: 'provider', id: providerId }, 'payment.confirmed', { organizationId: payment.organization_id, targetType: 'payment', targetId: payment.id, metadata: { providerReference: txn.providerReference } });
    return { outcome: 'successful', paymentId: payment.id };
  });
}

/** A provider reversed (recalled) a previously credited transfer. */
export async function recordReversal(providerId: string, txn: ProviderTransaction): Promise<{ outcome: string }> {
  return withTx(async (tx) => {
    const original = txn.relatedReference
      ? await one(tx, `SELECT * FROM provider_transactions WHERE provider_id=$1 AND provider_reference=$2 AND kind='collection'`, [providerId, txn.relatedReference])
      : null;
    const pt = await one<{ id: string }>(
      tx,
      `INSERT INTO provider_transactions (provider_id, mode, provider_reference, kind, amount, account_number, payment_id, match_status, occurred_at, raw)
       VALUES ($1,$2,$3,'reversal',$4,$5,$6,$7,$8,$9) ON CONFLICT (provider_id, provider_reference, kind) DO NOTHING RETURNING id`,
      [providerId, original?.mode ?? 'live', txn.providerReference, txn.amount, txn.accountNumber ?? null, original?.payment_id ?? null,
        original?.payment_id ? 'matched' : 'unmatched', txn.occurredAt, JSON.stringify(txn.raw ?? {})],
    );
    if (!pt) return { outcome: 'duplicate' };
    const payment = original?.payment_id ? await one<PaymentRow>(tx, `SELECT * FROM payments WHERE id=$1 FOR UPDATE`, [original.payment_id]) : null;
    const mode: Mode = original?.mode ?? 'live';
    if (!payment || !['successful', 'partially_refunded'].includes(payment.status) || original.match_status !== 'matched') {
      // Reversal of money parked in suspense (or unknown): unwind suspense.
      await ledger.post(tx, {
        mode, organizationId: payment?.organization_id ?? null, kind: 'reversal', description: 'Reversal of unattributed funds',
        referenceType: 'provider_transaction', referenceId: pt.id, idempotencyKey: `reversal:${pt.id}`, createdBy: 'provider',
        lines: [{ account: 'suspense', direction: 'debit', amount: txn.amount }, { account: 'provider_clearing', direction: 'credit', amount: txn.amount }],
      });
    } else {
      const fromAccount = payment.settled_at ? 'merchant_available' : 'merchant_pending';
      const merchantPortion = Math.max(0, txn.amount - payment.fee);
      await ledger.post(tx, {
        mode, organizationId: payment.organization_id, kind: 'reversal', description: `Reversal of ${payment.reference}`,
        referenceType: 'payment', referenceId: payment.id, idempotencyKey: `reversal:${pt.id}`, createdBy: 'provider',
        lines: [
          { account: fromAccount, direction: 'debit', amount: merchantPortion },
          { account: 'fee_revenue', direction: 'debit', amount: txn.amount - merchantPortion },
          { account: 'provider_clearing', direction: 'credit', amount: txn.amount },
        ],
      });
      await transitionPayment(tx, payment.id, 'reversed', { actor: 'provider', reason: 'provider_reversal' });
    }
    await tx.query(
      `INSERT INTO reconciliation_issues (type, fingerprint, organization_id, mode, payment_id, provider_transaction_id, actual_amount, details)
       VALUES ('unexpected_reversal',$1,$2,$3,$4,$5,$6,$7) ON CONFLICT (fingerprint) DO NOTHING`,
      [`unexpected_reversal:${pt.id}`, payment?.organization_id ?? null, mode, payment?.id ?? null, pt.id, txn.amount, JSON.stringify({ relatedReference: txn.relatedReference })],
    );
    return { outcome: 'reversed' };
  });
}

export async function getPaymentForOrg(db: Db, organizationId: string, mode: Mode, idOrRef: string): Promise<PaymentRow> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrRef);
  const p = await one<PaymentRow>(
    db,
    `SELECT * FROM payments WHERE organization_id=$1 AND mode=$2 AND (${isUuid ? 'id=$3::uuid' : 'reference=$3 OR merchant_reference=$3'})`,
    [organizationId, mode, idOrRef],
  );
  if (!p) throw Errors.notFound('Payment');
  return p;
}

export async function paymentTimeline(db: Db, paymentId: string) {
  return query(db, `SELECT from_status, to_status, reason, actor, created_at FROM payment_status_history WHERE payment_id=$1 ORDER BY created_at`, [paymentId]);
}

export type { Tx };
