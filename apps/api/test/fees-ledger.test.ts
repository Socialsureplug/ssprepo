import { describe, it, expect, beforeAll } from 'vitest';
import { canTransition, PAYMENT_STATUSES, PAYMENT_TRANSITIONS } from '@app/shared';
import { calculateFee } from '../src/modules/fees/fees.service';
import * as ledger from '../src/modules/ledger/ledger.service';
import { withTx } from '../src/db/pool';
import { resetDb, pool, one, createMerchant } from './helpers';

describe('fee calculation', () => {
  const s = { percentage_bps: 100, fixed_fee: 0, min_fee: 0, max_fee: 200_000 };

  it('charges 1% of ₦25,000 as ₦250', () => {
    expect(calculateFee(2_500_000, s)).toBe(25_000);
  });
  it('applies the maximum cap', () => {
    expect(calculateFee(100_000_000, s)).toBe(200_000);
  });
  it('applies the minimum fee', () => {
    expect(calculateFee(10_000, { ...s, min_fee: 5_000 })).toBe(5_000);
  });
  it('adds the fixed fee', () => {
    expect(calculateFee(1_000_000, { ...s, fixed_fee: 10_000 })).toBe(20_000);
  });
  it('rounds half up to the nearest kobo', () => {
    expect(calculateFee(150, { ...s, max_fee: null })).toBe(2); // 1.5 kobo → 2
    expect(calculateFee(149, { ...s, max_fee: null })).toBe(1);
  });
  it('never exceeds the amount itself', () => {
    expect(calculateFee(10_000, { ...s, min_fee: 50_000, max_fee: null })).toBe(10_000);
  });
  it('rejects non-integer or non-positive amounts', () => {
    expect(() => calculateFee(10.5, s)).toThrow();
    expect(() => calculateFee(0, s)).toThrow();
  });
});

describe('payment state machine rules', () => {
  it('terminal states have no exits', () => {
    for (const t of ['failed', 'expired', 'reversed', 'refunded'] as const) expect(PAYMENT_TRANSITIONS[t]).toHaveLength(0);
  });
  it('allows pending → successful but never failed → successful or successful → pending', () => {
    expect(canTransition('pending', 'successful')).toBe(true);
    expect(canTransition('failed', 'successful')).toBe(false);
    expect(canTransition('successful', 'pending')).toBe(false);
    expect(canTransition('expired', 'successful')).toBe(false);
  });
  it('every transition target is a known status', () => {
    for (const s of PAYMENT_STATUSES) for (const t of PAYMENT_TRANSITIONS[s]) expect(PAYMENT_STATUSES).toContain(t);
  });
});

describe('double-entry ledger', () => {
  let orgId: string;
  beforeAll(async () => {
    await resetDb();
    orgId = (await createMerchant()).orgId;
  });

  it('posts a balanced transaction and derives balances from entries', async () => {
    await withTx((tx) => ledger.post(tx, {
      mode: 'test', organizationId: orgId, kind: 'payment', description: 'test', idempotencyKey: 'ledger-test-1', createdBy: 'test',
      lines: [
        { account: 'provider_clearing', direction: 'debit', amount: 2_500_000 },
        { account: 'merchant_pending', direction: 'credit', amount: 2_475_000 },
        { account: 'fee_revenue', direction: 'credit', amount: 25_000 },
      ],
    }));
    expect(await ledger.accountBalance(pool, 'merchant_pending', 'test', orgId)).toBe(2_475_000);
    expect(await ledger.accountBalance(pool, 'fee_revenue', 'test', null)).toBe(25_000);
    expect(await ledger.accountBalance(pool, 'provider_clearing', 'test', null)).toBe(2_500_000);
  });

  it('is idempotent on the idempotency key', async () => {
    const again = await withTx((tx) => ledger.post(tx, {
      mode: 'test', organizationId: orgId, kind: 'payment', description: 'test', idempotencyKey: 'ledger-test-1', createdBy: 'test',
      lines: [{ account: 'provider_clearing', direction: 'debit', amount: 1 }, { account: 'merchant_pending', direction: 'credit', amount: 1 }],
    }));
    expect(again.duplicate).toBe(true);
    expect(await ledger.accountBalance(pool, 'merchant_pending', 'test', orgId)).toBe(2_475_000);
  });

  it('rejects unbalanced transactions in the service', async () => {
    await expect(withTx((tx) => ledger.post(tx, {
      mode: 'test', organizationId: orgId, kind: 'adjustment', description: 'bad', idempotencyKey: 'ledger-test-2', createdBy: 'test',
      lines: [{ account: 'merchant_available', direction: 'credit', amount: 100 }, { account: 'suspense', direction: 'debit', amount: 99 }],
    }))).rejects.toThrow(/Unbalanced/);
  });

  it('rejects unbalanced entries at the database level, even bypassing the service', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tx = await one(client, `INSERT INTO ledger_transactions (mode, kind, description, idempotency_key, created_by) VALUES ('test','adjustment','raw','raw-1','test') RETURNING id`);
      const acct = await ledger.getAccountId(client, 'suspense', 'test', null);
      await client.query(`INSERT INTO ledger_entries (transaction_id, account_id, direction, amount) VALUES ($1,$2,'debit',100)`, [tx!.id, acct]);
      await expect(client.query('COMMIT')).rejects.toThrow(/Unbalanced/);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('ledger entries and audit logs are immutable', async () => {
    await expect(pool.query(`UPDATE ledger_entries SET amount = amount + 1`)).rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM ledger_transactions`)).rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM audit_logs`)).rejects.toThrow(/append-only/);
  });

  it('trial balance always nets to zero', async () => {
    const tb = await ledger.trialBalance(pool, 'test');
    expect(tb!.debits).toBe(tb!.credits);
  });
});
