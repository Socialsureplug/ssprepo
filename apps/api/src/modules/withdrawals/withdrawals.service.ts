import type { Mode } from '@app/shared';
import { formatMoney } from '@app/shared';
import { config } from '../../config';
import { pool, one, withTx } from '../../db/pool';
import { decrypt } from '../../lib/crypto';
import { AppError, Errors } from '../../lib/errors';
import { refs } from '../../lib/ids';
import { audit, type Actor, actorLabel } from '../../lib/audit';
import { enqueue } from '../../jobs/queue';
import * as ledger from '../ledger/ledger.service';
import { getFeeSchedule } from '../fees/fees.service';
import { getOrg, assertCanPayout } from '../organizations/org.repo';
import { selectCollectionProvider } from '../../providers/registry';
import { evaluateWithdrawal } from '../risk/risk.service';
import { emitEvent } from '../webhooks/merchant-webhooks.service';
import { notifyOrg } from '../notifications/notifications.service';

export interface WithdrawalRow {
  id: string; organization_id: string; mode: Mode; reference: string; amount: number; fee: number; net_amount: number;
  bank_account_id: string; status: 'pending' | 'processing' | 'completed' | 'failed' | 'reversed'; risk_flags: string[];
  provider_reference: string | null; failure_reason: string | null; created_at: Date; completed_at: Date | null;
}

export async function quoteWithdrawal(organizationId: string, amount: number) {
  const schedule = await getFeeSchedule(pool, organizationId);
  return { amount, fee: schedule.payout_fee, net: amount - schedule.payout_fee };
}

/**
 * Merchant-initiated payout from the AVAILABLE balance to a verified settlement account.
 * Server-side checks: eligibility, limits, balance (under a per-merchant lock), idempotency and risk.
 * Ledger at request: Dr merchant_available (amount) / Cr payout_clearing (net) / Cr fee_revenue (fee).
 */
export async function createWithdrawal(
  organizationId: string, mode: Mode, input: { amount: number; bankAccountId: string },
  ctx: { actor: Actor; idempotencyKey: string; ip?: string | null },
): Promise<WithdrawalRow> {
  const org = await getOrg(pool, organizationId);
  assertCanPayout(org, mode);
  const r = config.rules;
  if (input.amount < r.minWithdrawal) throw new AppError('invalid_amount', `Minimum withdrawal is ${formatMoney(r.minWithdrawal)}.`, 422);
  if (input.amount > r.maxWithdrawal) throw new AppError('limit_exceeded', `Maximum single withdrawal is ${formatMoney(r.maxWithdrawal)}.`, 422);

  return withTx(async (tx) => {
    await ledger.lockMerchantBalance(tx, organizationId, mode);
    const existing = await one<WithdrawalRow>(tx, `SELECT * FROM withdrawals WHERE organization_id=$1 AND idempotency_key=$2`, [organizationId, ctx.idempotencyKey]);
    if (existing) {
      if (existing.amount !== input.amount || existing.bank_account_id !== input.bankAccountId) throw Errors.idempotencyMismatch();
      return existing;
    }
    const bank = await one(tx, `SELECT * FROM bank_accounts WHERE id=$1 AND organization_id=$2 AND status='active'`, [input.bankAccountId, organizationId]);
    if (!bank) throw Errors.notFound('Settlement bank account');

    const today = await one<{ s: number }>(
      tx, `SELECT COALESCE(sum(amount),0) AS s FROM withdrawals WHERE organization_id=$1 AND mode=$2 AND status <> 'failed' AND created_at >= date_trunc('day', now())`,
      [organizationId, mode],
    );
    if (today!.s + input.amount > org.daily_withdrawal_limit) {
      throw new AppError('limit_exceeded', `This exceeds your daily withdrawal limit of ${formatMoney(org.daily_withdrawal_limit)}.`, 422);
    }
    const schedule = await getFeeSchedule(tx, organizationId);
    const fee = schedule.payout_fee;
    if (input.amount - fee <= 0) throw new AppError('invalid_amount', 'Amount must be greater than the withdrawal fee.', 422);
    const available = await ledger.accountBalance(tx, 'merchant_available', mode, organizationId);
    if (available < input.amount) throw Errors.insufficientBalance();

    const w = await one<WithdrawalRow>(
      tx,
      `INSERT INTO withdrawals (organization_id, mode, reference, amount, fee, net_amount, bank_account_id, idempotency_key, requested_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [organizationId, mode, refs.withdrawal(), input.amount, fee, input.amount - fee, bank.id, ctx.idempotencyKey,
        ctx.actor.type === 'user' ? ctx.actor.id : null],
    );
    await ledger.post(tx, {
      mode, organizationId, kind: 'withdrawal', description: `Withdrawal ${w!.reference}`, referenceType: 'withdrawal', referenceId: w!.id,
      idempotencyKey: `withdrawal:${w!.id}`, createdBy: actorLabel(ctx.actor),
      lines: [
        { account: 'merchant_available', direction: 'debit', amount: input.amount },
        { account: 'payout_clearing', direction: 'credit', amount: input.amount - fee },
        { account: 'fee_revenue', direction: 'credit', amount: fee },
      ],
    });
    const flags = await evaluateWithdrawal(tx, { organizationId, mode, withdrawalId: w!.id, amount: input.amount, bankAccountCreatedAt: new Date(bank.created_at), ip: ctx.ip ?? null });
    const hold = mode === 'live' && flags.some((f) => f.severity === 'high');
    if (flags.length) await tx.query(`UPDATE withdrawals SET risk_flags=$2 WHERE id=$1`, [w!.id, flags.map((f) => f.rule)]);
    if (!hold) await enqueue(tx, 'withdrawal.process', { withdrawalId: w!.id }, { dedupeKey: w!.id });
    await notifyOrg(tx, organizationId, 'withdrawal.initiated', 'Withdrawal initiated',
      `${formatMoney(input.amount - fee)} to ${bank.bank_name} ••••${bank.account_number_last4}${hold ? ' is under review and will be processed after approval.' : ' is on its way.'}`,
      { withdrawalId: w!.id });
    await audit(tx, ctx.actor, 'withdrawal.created', { organizationId, targetType: 'withdrawal', targetId: w!.id, metadata: { amount: input.amount, fee, held: hold, flags: flags.map((f) => f.rule) } });
    return { ...w!, risk_flags: flags.map((f) => f.rule) };
  });
}

export async function processWithdrawalJob(payload: { withdrawalId: string }) {
  const w = await one<WithdrawalRow>(pool, `SELECT * FROM withdrawals WHERE id=$1`, [payload.withdrawalId]);
  if (!w || w.status !== 'pending') return;
  const bank = await one(pool, `SELECT * FROM bank_accounts WHERE id=$1`, [w.bank_account_id]);
  const { provider, row } = await selectCollectionProvider(pool, w.mode);
  const result = await provider.initiateSettlement({
    reference: w.reference, amount: w.net_amount, bankCode: bank.bank_code, accountNumber: decrypt(bank.account_number_encrypted),
    accountName: bank.account_name, narration: `Withdrawal ${w.reference}`,
  });
  await pool.query(`UPDATE withdrawals SET status='processing', provider_id=$2, provider_reference=$3, processed_at=now() WHERE id=$1 AND status='pending'`, [w.id, row.id, result.providerReference]);
  if (result.status === 'completed') await completeWithdrawal(w.reference, result.providerReference);
  if (result.status === 'failed') await failWithdrawal(w.reference, result.failureReason ?? 'Provider declined the transfer');
}

/** Admin approval for a withdrawal held by risk rules. */
export async function approveHeldWithdrawal(id: string, actor: Actor) {
  await withTx(async (tx) => {
    const w = await one<WithdrawalRow>(tx, `SELECT * FROM withdrawals WHERE id=$1 FOR UPDATE`, [id]);
    if (!w || w.status !== 'pending') throw new AppError('invalid_state', 'Only pending withdrawals can be approved.', 409);
    await enqueue(tx, 'withdrawal.process', { withdrawalId: w.id }, { dedupeKey: w.id });
    await audit(tx, actor, 'withdrawal.approved', { organizationId: w.organization_id, targetType: 'withdrawal', targetId: w.id });
  });
}

export async function completeWithdrawal(reference: string, providerReference: string) {
  await withTx(async (tx) => {
    const w = await one<WithdrawalRow>(tx, `SELECT * FROM withdrawals WHERE reference=$1 FOR UPDATE`, [reference]);
    if (!w || !['pending', 'processing'].includes(w.status)) return;
    await tx.query(`UPDATE withdrawals SET status='completed', completed_at=now(), provider_reference=COALESCE(provider_reference,$2) WHERE id=$1`, [w.id, providerReference]);
    await ledger.post(tx, {
      mode: w.mode, organizationId: w.organization_id, kind: 'withdrawal', description: `Withdrawal ${w.reference} confirmed`,
      referenceType: 'withdrawal', referenceId: w.id, idempotencyKey: `withdrawal_complete:${w.id}`, createdBy: 'provider',
      lines: [{ account: 'payout_clearing', direction: 'debit', amount: w.net_amount }, { account: 'provider_clearing', direction: 'credit', amount: w.net_amount }],
    });
    await emitEvent(tx, w.organization_id, w.mode, 'withdrawal.completed', { reference: w.reference, amount: w.amount, fee: w.fee, netAmount: w.net_amount });
    await notifyOrg(tx, w.organization_id, 'withdrawal.completed', 'Withdrawal completed', `${formatMoney(w.net_amount)} was sent to your bank account (${w.reference}).`, { withdrawalId: w.id });
  });
}

/** Failure or rejection: restore the full amount (including fee) to the available balance. */
export async function failWithdrawal(reference: string, reason: string, actor: Actor = { type: 'provider' }) {
  await withTx(async (tx) => {
    const w = await one<WithdrawalRow>(tx, `SELECT * FROM withdrawals WHERE reference=$1 FOR UPDATE`, [reference]);
    if (!w || !['pending', 'processing'].includes(w.status)) return;
    await tx.query(`UPDATE withdrawals SET status='failed', failure_reason=$2 WHERE id=$1`, [w.id, reason]);
    await ledger.post(tx, {
      mode: w.mode, organizationId: w.organization_id, kind: 'withdrawal_reversal', description: `Withdrawal ${w.reference} failed — funds restored`,
      referenceType: 'withdrawal', referenceId: w.id, idempotencyKey: `withdrawal_fail:${w.id}`, createdBy: actorLabel(actor),
      lines: [
        { account: 'payout_clearing', direction: 'debit', amount: w.net_amount },
        { account: 'fee_revenue', direction: 'debit', amount: w.fee },
        { account: 'merchant_available', direction: 'credit', amount: w.amount },
      ],
    });
    await emitEvent(tx, w.organization_id, w.mode, 'withdrawal.failed', { reference: w.reference, amount: w.amount, reason });
    await notifyOrg(tx, w.organization_id, 'withdrawal.failed', 'Withdrawal failed', `Withdrawal ${w.reference} failed: ${reason}. ${formatMoney(w.amount)} has been returned to your available balance.`, { withdrawalId: w.id });
    await audit(tx, actor, 'withdrawal.failed', { organizationId: w.organization_id, targetType: 'withdrawal', targetId: w.id, metadata: { reason } });
  });
}

export function withdrawalDTO(w: WithdrawalRow & { bank_name?: string; account_number_last4?: string; account_name?: string }) {
  return {
    id: w.id, reference: w.reference, amount: w.amount, fee: w.fee, netAmount: w.net_amount, status: w.status, riskFlags: w.risk_flags,
    failureReason: w.failure_reason, createdAt: w.created_at, completedAt: w.completed_at, mode: w.mode,
    bankAccount: w.bank_name ? { bankName: w.bank_name, last4: w.account_number_last4, accountName: w.account_name } : null,
  };
}
