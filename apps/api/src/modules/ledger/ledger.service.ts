import type { Mode } from '@app/shared';
import type { Db, Tx } from '../../db/pool';
import { query, one } from '../../db/pool';
import { AppError } from '../../lib/errors';

/**
 * Double-entry ledger. Every financial movement is a balanced ledger transaction made of
 * debit/credit entries. Balances are always derived from entries; nothing stores a mutable balance.
 *
 * Chart of accounts
 *  platform (organization_id NULL):
 *   provider_clearing  asset      funds held at / owed by the payment provider
 *   payout_clearing    liability  payouts sent to the provider but not yet confirmed
 *   fee_revenue        revenue    processing + payout fees earned
 *   suspense           liability  unidentified / mismatched money awaiting investigation
 *  merchant (per organization):
 *   merchant_pending   liability  money owed to the merchant, not yet settled
 *   merchant_available liability  money owed to the merchant, withdrawable on demand
 */
export type AccountCode =
  | 'provider_clearing' | 'payout_clearing' | 'fee_revenue' | 'suspense' | 'merchant_pending' | 'merchant_available';

const ACCOUNT_META: Record<AccountCode, { type: 'asset' | 'liability' | 'revenue'; name: string; scope: 'platform' | 'merchant' }> = {
  provider_clearing: { type: 'asset', name: 'Provider clearing', scope: 'platform' },
  payout_clearing: { type: 'liability', name: 'Payouts in transit', scope: 'platform' },
  fee_revenue: { type: 'revenue', name: 'Fee revenue', scope: 'platform' },
  suspense: { type: 'liability', name: 'Suspense', scope: 'platform' },
  merchant_pending: { type: 'liability', name: 'Merchant pending balance', scope: 'merchant' },
  merchant_available: { type: 'liability', name: 'Merchant available balance', scope: 'merchant' },
};

export interface LedgerLine { account: AccountCode; direction: 'debit' | 'credit'; amount: number; }

export interface PostInput {
  mode: Mode;
  organizationId: string | null;
  kind: 'payment' | 'fee' | 'refund' | 'reversal' | 'settlement' | 'withdrawal' | 'withdrawal_reversal' | 'settlement_reversal'
    | 'release' | 'adjustment' | 'suspense';
  description: string;
  referenceType?: string;
  referenceId?: string;
  /** Unique key that makes posting idempotent: re-posting the same key is a no-op. */
  idempotencyKey: string;
  createdBy: string;
  lines: LedgerLine[];
}

export async function getAccountId(db: Db, code: AccountCode, mode: Mode, organizationId: string | null): Promise<string> {
  const meta = ACCOUNT_META[code];
  const orgId = meta.scope === 'platform' ? null : organizationId;
  if (meta.scope === 'merchant' && !orgId) throw new Error(`Account ${code} requires an organization`);
  const existing = await one<{ id: string }>(
    db,
    `SELECT id FROM ledger_accounts WHERE organization_id IS NOT DISTINCT FROM $1 AND mode=$2 AND code=$3 AND currency='NGN'`,
    [orgId, mode, code],
  );
  if (existing) return existing.id;
  const created = await one<{ id: string }>(
    db,
    `INSERT INTO ledger_accounts (organization_id, mode, code, type, name) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT DO NOTHING RETURNING id`,
    [orgId, mode, code, meta.type, meta.name],
  );
  if (created) return created.id;
  return getAccountId(db, code, mode, organizationId);
}

/**
 * Post a balanced ledger transaction. Must be called inside a DB transaction.
 * Returns the ledger transaction id, or the existing id when the idempotency key was already used.
 */
export async function post(tx: Tx, input: PostInput): Promise<{ id: string; duplicate: boolean }> {
  const lines = input.lines.filter((l) => l.amount !== 0);
  for (const l of lines) {
    if (!Number.isSafeInteger(l.amount) || l.amount < 0) throw new AppError('ledger_invalid', 'Ledger amounts must be positive integers', 500);
  }
  const debits = lines.filter((l) => l.direction === 'debit').reduce((s, l) => s + l.amount, 0);
  const credits = lines.filter((l) => l.direction === 'credit').reduce((s, l) => s + l.amount, 0);
  if (debits !== credits || debits === 0) {
    throw new AppError('ledger_unbalanced', `Unbalanced ledger transaction (${debits} vs ${credits})`, 500);
  }

  const inserted = await one<{ id: string }>(
    tx,
    `INSERT INTO ledger_transactions (mode, organization_id, kind, description, reference_type, reference_id, idempotency_key, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
    [input.mode, input.organizationId, input.kind, input.description, input.referenceType ?? null, input.referenceId ?? null,
      input.idempotencyKey, input.createdBy],
  );
  if (!inserted) {
    const existing = await one<{ id: string }>(tx, `SELECT id FROM ledger_transactions WHERE idempotency_key=$1`, [input.idempotencyKey]);
    return { id: existing!.id, duplicate: true };
  }

  for (const line of lines) {
    const accountId = await getAccountId(tx, line.account, input.mode, input.organizationId);
    await tx.query(`INSERT INTO ledger_entries (transaction_id, account_id, direction, amount) VALUES ($1,$2,$3,$4)`, [
      inserted.id, accountId, line.direction, line.amount,
    ]);
  }
  return { id: inserted.id, duplicate: false };
}

/** Balance in the account's natural sign: assets are debit-normal, liabilities/revenue credit-normal. */
export async function accountBalance(db: Db, code: AccountCode, mode: Mode, organizationId: string | null): Promise<number> {
  const meta = ACCOUNT_META[code];
  const orgId = meta.scope === 'platform' ? null : organizationId;
  const row = await one<{ debits: number; credits: number }>(
    db,
    `SELECT COALESCE(SUM(e.amount) FILTER (WHERE e.direction='debit'),0) AS debits,
            COALESCE(SUM(e.amount) FILTER (WHERE e.direction='credit'),0) AS credits
       FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
      WHERE a.organization_id IS NOT DISTINCT FROM $1 AND a.mode=$2 AND a.code=$3`,
    [orgId, mode, code],
  );
  const d = row?.debits ?? 0;
  const c = row?.credits ?? 0;
  return meta.type === 'asset' ? d - c : c - d;
}

export async function merchantBalances(db: Db, organizationId: string, mode: Mode) {
  const [available, pending] = await Promise.all([
    accountBalance(db, 'merchant_available', mode, organizationId),
    accountBalance(db, 'merchant_pending', mode, organizationId),
  ]);
  return { available, pending, currency: 'NGN' as const };
}

/**
 * Serialize balance-affecting operations for one merchant (withdrawals, refunds, settlements)
 * using a transaction-scoped advisory lock, so concurrent requests cannot overdraw.
 */
export async function lockMerchantBalance(tx: Tx, organizationId: string, mode: Mode): Promise<void> {
  await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`balance:${organizationId}:${mode}`]);
}

export async function listEntriesFor(db: Db, referenceType: string, referenceId: string) {
  return query(
    db,
    `SELECT t.id AS transaction_id, t.kind, t.description, t.created_at, a.code AS account, a.organization_id, e.direction, e.amount
       FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id JOIN ledger_accounts a ON a.id = e.account_id
      WHERE t.reference_type=$1 AND t.reference_id=$2 ORDER BY t.created_at, e.direction DESC`,
    [referenceType, referenceId],
  );
}

/** Global integrity check: total debits must equal total credits across the whole ledger. */
export async function trialBalance(db: Db, mode: Mode) {
  return one<{ debits: number; credits: number }>(
    db,
    `SELECT COALESCE(SUM(e.amount) FILTER (WHERE e.direction='debit'),0) AS debits,
            COALESCE(SUM(e.amount) FILTER (WHERE e.direction='credit'),0) AS credits
       FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.account_id WHERE a.mode=$1`,
    [mode],
  );
}
