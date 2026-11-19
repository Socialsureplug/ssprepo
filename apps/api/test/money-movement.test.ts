import { describe, it, expect, beforeAll } from 'vitest';
import { resetDb, pool, one, query, createMerchant, createPayment, payViaSandbox, runJobs, balances, addBankAccount, api, type MerchantCtx } from './helpers';
import * as ledger from '../src/modules/ledger/ledger.service';
import { runSettlements } from '../src/modules/settlements/settlements.service';
import { runReconciliation } from '../src/modules/reconciliation/reconciliation.service';

describe('refunds', () => {
  let m: MerchantCtx;
  beforeAll(async () => {
    await resetDb();
    m = await createMerchant();
  });

  it('partially then fully refunds a payment through the provider', async () => {
    const p = await createPayment(m.secretKey, { amount: 2_000_000 });
    await payViaSandbox(p.reference);
    const before = await balances(m.orgId);

    const r1 = await api(m.secretKey).post('/v1/refunds').set('Idempotency-Key', 'refund-key-0001').send({ payment: p.reference, amount: 500_000, reason: 'Item out of stock' });
    expect(r1.status).toBe(201);
    expect((await balances(m.orgId)).pending).toBe(before.pending - 500_000); // reserved immediately
    await runJobs();
    expect((await one(pool, `SELECT status FROM refunds WHERE id=$1`, [r1.body.data.id]))!.status).toBe('completed');
    expect((await one(pool, `SELECT status, amount_refunded FROM payments WHERE id=$1`, [p.data.id]))).toEqual({ status: 'partially_refunded', amount_refunded: 500_000 });

    // Replay with the same idempotency key returns the same refund and does not double-debit.
    const replay = await api(m.secretKey).post('/v1/refunds').set('Idempotency-Key', 'refund-key-0001').send({ payment: p.reference, amount: 500_000, reason: 'Item out of stock' });
    expect(replay.body.data.id).toBe(r1.body.data.id);
    expect((await query(pool, `SELECT id FROM refunds WHERE payment_id=$1`, [p.data.id]))).toHaveLength(1);

    const over = await api(m.secretKey).post('/v1/refunds').set('Idempotency-Key', 'refund-key-0002').send({ payment: p.reference, amount: 1_600_000 });
    expect(over.status).toBe(422);
    // The retained fee means pending (1,480,000) cannot cover the remaining 1,500,000 yet.
    const short = await api(m.secretKey).post('/v1/refunds').set('Idempotency-Key', 'refund-key-0003').send({ payment: p.reference });
    expect(short.body.error.code).toBe('insufficient_balance');
    const topUp = await createPayment(m.secretKey, { amount: 500_000 });
    await payViaSandbox(topUp.reference);
    const rest = await api(m.secretKey).post('/v1/refunds').set('Idempotency-Key', 'refund-key-0006').send({ payment: p.reference });
    expect(rest.body.data.amount).toBe(1_500_000);
    await runJobs();
    expect((await one(pool, `SELECT status FROM payments WHERE id=$1`, [p.data.id]))!.status).toBe('refunded');
  });

  it('restores funds when the provider fails a refund', async () => {
    const p = await createPayment(m.secretKey, { amount: 1_000_000 });
    await payViaSandbox(p.reference);
    const before = await balances(m.orgId);
    await api(m.secretKey).post('/v1/refunds').set('Idempotency-Key', 'refund-key-0004').send({ payment: p.reference, amount: 300_000, reason: 'please fail' }).expect(201);
    await runJobs();
    const r = await one(pool, `SELECT status FROM refunds WHERE payment_id=$1`, [p.data.id]);
    expect(r!.status).toBe('failed');
    expect(await balances(m.orgId)).toEqual(before);
    expect((await one(pool, `SELECT status, amount_refunded FROM payments WHERE id=$1`, [p.data.id]))).toEqual({ status: 'successful', amount_refunded: 0 });
  });

  it('refuses refunds that need an idempotency key or exceed balance', async () => {
    const p = await createPayment(m.secretKey, { amount: 1_000_000 });
    const notPaid = await api(m.secretKey).post('/v1/refunds').set('Idempotency-Key', 'refund-key-0005').send({ payment: p.reference });
    expect(notPaid.body.error.code).toBe('payment_not_refundable');
    const noKey = await api(m.secretKey).post('/v1/refunds').send({ payment: p.reference });
    expect(noKey.status).toBe(400);
  });
});

describe('settlements', () => {
  beforeAll(resetDb);

  it('T+0 settles matured funds to the bank and completes on provider confirmation', async () => {
    const m = await createMerchant({ schedule: 't0' });
    await addBankAccount(m);
    const a = await createPayment(m.secretKey, { amount: 2_500_000 });
    const b = await createPayment(m.secretKey, { amount: 1_000_000 });
    await payViaSandbox(a.reference);
    await payViaSandbox(b.reference);
    expect((await balances(m.orgId)).pending).toBe(2_475_000 + 990_000);

    await runSettlements();
    const s = await one(pool, `SELECT * FROM settlements WHERE organization_id=$1`, [m.orgId]);
    expect(s).toMatchObject({ destination: 'bank', gross_amount: 3_500_000, fee_amount: 35_000, net_amount: 3_465_000, payment_count: 2 });
    expect(await balances(m.orgId)).toEqual({ available: 0, pending: 0, currency: 'NGN' });
    await runJobs();
    expect((await one(pool, `SELECT status FROM settlements WHERE id=$1`, [s!.id]))!.status).toBe('completed');
    expect(await ledger.accountBalance(pool, 'payout_clearing', 'test', null)).toBe(0);

    // Re-running settles nothing new.
    await runSettlements();
    expect((await query(pool, `SELECT id FROM settlements WHERE organization_id=$1`, [m.orgId]))).toHaveLength(1);
  });

  it('T+1 does not settle funds before they mature', async () => {
    const m = await createMerchant({ schedule: 't1' });
    await addBankAccount(m);
    const p = await createPayment(m.secretKey);
    await payViaSandbox(p.reference);
    await runSettlements();
    expect(await one(pool, `SELECT 1 FROM settlements WHERE organization_id=$1`, [m.orgId])).toBeNull();
    await pool.query(`UPDATE payments SET available_at = now() - interval '1 minute' WHERE id=$1`, [p.data.id]);
    await runSettlements();
    expect(await one(pool, `SELECT 1 FROM settlements WHERE organization_id=$1`, [m.orgId])).toBeTruthy();
  });

  it('manual schedule releases funds to the available balance', async () => {
    const m = await createMerchant({ schedule: 'manual' });
    const p = await createPayment(m.secretKey, { amount: 2_500_000 });
    await payViaSandbox(p.reference);
    await runSettlements();
    expect(await balances(m.orgId)).toEqual({ available: 2_475_000, pending: 0, currency: 'NGN' });
    const s = await one(pool, `SELECT destination, status FROM settlements WHERE organization_id=$1`, [m.orgId]);
    expect(s).toEqual({ destination: 'balance', status: 'completed' });
  });

  it('a failed bank settlement returns funds to the available balance and raises an issue', async () => {
    const m = await createMerchant({ schedule: 't0' });
    await addBankAccount(m, '1234560000'); // sandbox: accounts ending 0000 fail
    const p = await createPayment(m.secretKey, { amount: 2_500_000 });
    await payViaSandbox(p.reference);
    await runSettlements();
    await runJobs();
    const s = await one(pool, `SELECT * FROM settlements WHERE organization_id=$1`, [m.orgId]);
    expect(s!.status).toBe('failed');
    expect(await balances(m.orgId)).toEqual({ available: 2_475_000, pending: 0, currency: 'NGN' });
    expect(await one(pool, `SELECT 1 FROM reconciliation_issues WHERE settlement_id=$1 AND type='failed_settlement'`, [s!.id])).toBeTruthy();
  });
});

describe('withdrawals', () => {
  let m: MerchantCtx;
  let bankId: string;
  beforeAll(async () => {
    await resetDb();
    m = await createMerchant({ schedule: 'manual' });
    bankId = (await addBankAccount(m)).id;
    const p = await createPayment(m.secretKey, { amount: 5_000_000 });
    await payViaSandbox(p.reference);
    await runSettlements(); // 4,950,000 available
  });

  const withdraw = (amount: number, key: string) =>
    m.agent.post('/dashboard/withdrawals').set('x-csrf-token', m.csrf).set('Idempotency-Key', key).send({ amount, bankAccountId: bankId });

  it('never allows a withdrawal greater than the available balance', async () => {
    const res = await withdraw(5_000_000, 'wd-key-00001');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('insufficient_balance');
  });

  it('requires an idempotency key', async () => {
    const res = await m.agent.post('/dashboard/withdrawals').set('x-csrf-token', m.csrf).send({ amount: 100_000, bankAccountId: bankId });
    expect(res.status).toBe(400);
  });

  it('debits amount + fee, pays out the net and completes via provider webhook', async () => {
    const res = await withdraw(1_000_000, 'wd-key-00002');
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ amount: 1_000_000, fee: 5_000, netAmount: 995_000, status: 'pending' });
    expect((await balances(m.orgId)).available).toBe(4_950_000 - 1_000_000);
    const replay = await withdraw(1_000_000, 'wd-key-00002');
    expect(replay.body.data.id).toBe(res.body.data.id);
    await runJobs();
    expect((await one(pool, `SELECT status FROM withdrawals WHERE id=$1`, [res.body.data.id]))!.status).toBe('completed');
  });

  it('serializes concurrent withdrawals so the balance cannot be overdrawn', async () => {
    const available = (await balances(m.orgId)).available; // 3,950,000
    const results = await Promise.all([withdraw(3_000_000, 'wd-key-c0001'), withdraw(3_000_000, 'wd-key-c0002'), withdraw(3_000_000, 'wd-key-c0003')]);
    const okCount = results.filter((r) => r.status === 201).length;
    expect(okCount).toBe(1);
    expect((await balances(m.orgId)).available).toBe(available - 3_000_000);
    expect((await balances(m.orgId)).available).toBeGreaterThanOrEqual(0);
  });

  it('enforces the daily withdrawal limit', async () => {
    await pool.query(`UPDATE organizations SET daily_withdrawal_limit=4100000 WHERE id=$1`, [m.orgId]);
    const res = await withdraw(200_000, 'wd-key-00003');
    expect(res.body.error.code).toBe('limit_exceeded');
  });
});

describe('reconciliation', () => {
  beforeAll(resetDb);

  it('detects provider transactions missing from our records', async () => {
    const m = await createMerchant();
    const p = await createPayment(m.secretKey);
    // Money arrives at the provider but the webhook is lost.
    const { getProviderByCode } = await import('../src/providers/registry');
    const sandbox = (await getProviderByCode(pool, 'sandbox'))!.provider as any;
    await sandbox.simulateTransfer(p.data.bankTransfer.accountNumber, p.amount);
    const result = await runReconciliation(new Date(Date.now() - 3600_000), new Date(Date.now() + 60_000));
    expect(result.issues).toBeGreaterThanOrEqual(1);
    expect(await one(pool, `SELECT 1 FROM reconciliation_issues WHERE type='missing_transaction'`)).toBeTruthy();
    // Re-running does not duplicate issues.
    const again = await runReconciliation(new Date(Date.now() - 3600_000), new Date(Date.now() + 60_000));
    expect(again.issues).toBe(0);
  });
});
