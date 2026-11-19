import { describe, it, expect, beforeAll } from 'vitest';
import { resetDb, app, request, pool, one, query, createMerchant, createPayment, payViaSandbox, runJobs, balances, api, type MerchantCtx } from './helpers';
import * as ledger from '../src/modules/ledger/ledger.service';
import { getProviderByCode } from '../src/providers/registry';
import { ingestProviderWebhook } from '../src/modules/webhooks/provider-webhooks.service';
import { expirePayment } from '../src/modules/payments/payments.service';
import { transitionPayment } from '../src/modules/payments/state-machine';
import { withTx } from '../src/db/pool';
import type { SandboxProvider } from '../src/providers/adapters/sandbox';

let m: MerchantCtx;

describe('bank-transfer payment flow', () => {
  beforeAll(async () => {
    await resetDb();
    m = await createMerchant();
  });

  it('creates a payment with server-side fees and a collection account', async () => {
    const res = await createPayment(m.secretKey, { reference: 'ORDER-12345', description: 'Product purchase', amount: 2_500_000 });
    expect(res.status).toBe('success');
    expect(res.reference).toMatch(/^PAY_[A-Z0-9]{12}$/);
    expect(res.checkout_url).toContain(res.reference);
    expect(res.amount).toBe(2_500_000);
    expect(res.data.fee).toBe(25_000);
    expect(res.data.netAmount).toBe(2_475_000);
    expect(res.data.status).toBe('pending');
    expect(res.data.bankTransfer.accountNumber).toMatch(/^\d{10}$/);
    const history = await query(pool, `SELECT from_status, to_status FROM payment_status_history h JOIN payments p ON p.id=h.payment_id WHERE p.reference=$1 ORDER BY h.created_at`, [res.reference]);
    expect(history.map((h) => h.to_status)).toEqual(['created', 'pending']);
  });

  it('rejects duplicate merchant references and invalid amounts', async () => {
    const dup = await api(m.secretKey).post('/v1/payments').send({ amount: 2_500_000, email: 'a@b.test', reference: 'ORDER-12345' });
    expect(dup.status).toBe(409);
    const tiny = await api(m.secretKey).post('/v1/payments').send({ amount: 50, email: 'a@b.test' });
    expect(tiny.status).toBe(422);
    const float = await api(m.secretKey).post('/v1/payments').send({ amount: 100.5, email: 'a@b.test' });
    expect(float.status).toBe(422);
  });

  it('public checkout shows payment instructions but no fees or internal data', async () => {
    const p = await createPayment(m.secretKey);
    const res = await request(app).get(`/checkout/${p.reference}`).expect(200);
    expect(res.body.data.account.accountNumber).toBe(p.data.bankTransfer.accountNumber);
    expect(res.body.data.amount).toBe(2_500_000);
    expect(res.body.data).not.toHaveProperty('fee');
    expect(res.body.data).not.toHaveProperty('organizationId');
    expect(res.body.data.customerEmail).toContain('•');
    await request(app).get('/checkout/PAY_DOESNOTEXIST').expect(404);
  });

  it('confirms payment only through a verified provider transfer and posts the ledger', async () => {
    const p = await createPayment(m.secretKey, { amount: 2_500_000 });
    // The customer coming back to the "success page" changes nothing.
    const before = await request(app).post(`/checkout/${p.reference}/verify`).expect(200);
    expect(before.body.data.status).toBe('pending');

    await payViaSandbox(p.reference);
    const after = await request(app).get(`/checkout/${p.reference}`).expect(200);
    expect(after.body.data.status).toBe('successful');
    expect(after.body.data.account).toBeNull(); // no longer displayed once paid

    const entries = await ledger.listEntriesFor(pool, 'payment', p.data.id);
    const sum = (acct: string, dir: string) => entries.filter((e) => e.account === acct && e.direction === dir).reduce((s, e) => s + e.amount, 0);
    expect(sum('provider_clearing', 'debit')).toBe(2_500_000);
    expect(sum('merchant_pending', 'credit')).toBe(2_475_000);
    expect(sum('fee_revenue', 'credit')).toBe(25_000);
    const tb = await ledger.trialBalance(pool, 'test');
    expect(tb!.debits).toBe(tb!.credits);
  });

  it('there is no endpoint that lets a client set a payment status', async () => {
    const p = await createPayment(m.secretKey);
    const res = await api(m.secretKey).post(`/v1/payments/${p.reference}`).send({ status: 'successful' });
    expect(res.status).toBe(404);
    const patch = await m.agent.patch(`/dashboard/payments/${p.data.id}`).set('x-csrf-token', m.csrf).send({ status: 'successful' });
    expect(patch.status).toBe(404);
  });

  it('enforces state machine transitions server-side', async () => {
    const p = await createPayment(m.secretKey);
    await withTx((tx) => transitionPayment(tx, p.data.id, 'failed', { actor: 'test' }));
    await expect(withTx((tx) => transitionPayment(tx, p.data.id, 'successful', { actor: 'test' }))).rejects.toThrow(/Cannot move from failed to successful/);
  });

  it('underpayment fails the payment and parks the money in suspense with a reconciliation issue', async () => {
    const p = await createPayment(m.secretKey, { amount: 1_000_000 });
    await payViaSandbox(p.reference, 900_000);
    const pay = await one(pool, `SELECT status, failure_reason FROM payments WHERE id=$1`, [p.data.id]);
    expect(pay).toEqual({ status: 'failed', failure_reason: 'underpaid' });
    const issue = await one(pool, `SELECT type FROM reconciliation_issues WHERE payment_id=$1`, [p.data.id]);
    expect(issue!.type).toBe('amount_mismatch');
    expect(await ledger.accountBalance(pool, 'suspense', 'test', null)).toBeGreaterThanOrEqual(900_000);
  });

  it('overpayment succeeds for the expected amount and flags the excess', async () => {
    const before = await balances(m.orgId);
    const p = await createPayment(m.secretKey, { amount: 1_000_000 });
    await payViaSandbox(p.reference, 1_200_000);
    const pay = await one(pool, `SELECT status, amount_received FROM payments WHERE id=$1`, [p.data.id]);
    expect(pay).toEqual({ status: 'successful', amount_received: 1_200_000 });
    const after = await balances(m.orgId);
    expect(after.pending - before.pending).toBe(p.data.netAmount); // merchant credited only the expected net
    expect(await one(pool, `SELECT 1 FROM reconciliation_issues WHERE payment_id=$1 AND type='amount_mismatch'`, [p.data.id])).toBeTruthy();
  });

  it('expires unpaid payments after the window and treats a late transfer as unmatched funds', async () => {
    const p = await createPayment(m.secretKey, { amount: 500_000 });
    await pool.query(`UPDATE payments SET expires_at=now() - interval '1 minute' WHERE id=$1`, [p.data.id]);
    await expirePayment(p.data.id);
    expect((await one(pool, `SELECT status FROM payments WHERE id=$1`, [p.data.id]))!.status).toBe('expired');
    const checkout = await request(app).get(`/checkout/${p.reference}`).expect(200);
    expect(checkout.body.data.status).toBe('expired');
    expect(checkout.body.data.account).toBeNull();

    // A late transfer to the expired account still arrives from the bank.
    const sandbox = (await getProviderByCode(pool, 'sandbox'))!.provider as unknown as SandboxProvider;
    const { rawBody, headers } = await sandbox.simulateTransfer(p.data.bankTransfer.accountNumber, 500_000);
    await ingestProviderWebhook('sandbox', rawBody, headers);
    await runJobs();
    expect((await one(pool, `SELECT status FROM payments WHERE id=$1`, [p.data.id]))!.status).toBe('expired');
    expect(await one(pool, `SELECT 1 FROM reconciliation_issues WHERE payment_id=$1 AND type='unmatched_transaction'`, [p.data.id])).toBeTruthy();
  });

  it('a provider reversal moves a successful payment to reversed and debits the merchant', async () => {
    const p = await createPayment(m.secretKey, { amount: 2_000_000 });
    await payViaSandbox(p.reference);
    const before = await balances(m.orgId);
    const collection = await one(pool, `SELECT provider_reference FROM provider_transactions WHERE payment_id=$1 AND kind='collection'`, [p.data.id]);
    const sandbox = (await getProviderByCode(pool, 'sandbox'))!.provider as unknown as SandboxProvider;
    const { rawBody, headers } = await sandbox.simulateReversal(collection!.provider_reference);
    await ingestProviderWebhook('sandbox', rawBody, headers);
    await runJobs();
    expect((await one(pool, `SELECT status FROM payments WHERE id=$1`, [p.data.id]))!.status).toBe('reversed');
    const after = await balances(m.orgId);
    expect(before.pending - after.pending).toBe(p.data.netAmount);
    expect(await one(pool, `SELECT 1 FROM reconciliation_issues WHERE payment_id=$1 AND type='unexpected_reversal'`, [p.data.id])).toBeTruthy();
  });
});

describe('live mode gating', () => {
  beforeAll(resetDb);

  it('unverified merchants cannot get live keys or create live payments', async () => {
    const m2 = await createMerchant();
    await m2.agent.post('/dashboard/settings/developers/keys').set('x-csrf-token', m2.csrf).expect(201); // test key ok
    await pool.query(`UPDATE sessions SET mode='live' WHERE user_id=$1`, [m2.userId]); // even if a session were forced into live mode…
    const res = await m2.agent.post('/dashboard/settings/developers/keys').set('x-csrf-token', m2.csrf);
    expect(res.body.error.code).toBe('merchant_not_verified');
    const pay = await m2.agent.post('/dashboard/payments').set('x-csrf-token', m2.csrf).send({ amount: 2_500_000, email: 'c@d.test' });
    expect(pay.body.error.code).toBe('merchant_not_verified');
  });

  it('approved merchants without a configured live provider get a clear provider error', async () => {
    const m3 = await createMerchant({ approved: true, mode: 'live' });
    const res = await api(m3.secretKey).post('/v1/payments').send({ amount: 2_500_000, email: 'c@d.test' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('provider_unavailable');
  });

  it('suspended merchants cannot process even in test mode', async () => {
    const m4 = await createMerchant();
    await pool.query(`UPDATE organizations SET status='suspended' WHERE id=$1`, [m4.orgId]);
    const res = await api(m4.secretKey).post('/v1/payments').send({ amount: 2_500_000, email: 'c@d.test' });
    expect(res.body.error.code).toBe('merchant_restricted');
  });
});

describe('payment links & customers', () => {
  beforeAll(async () => {
    await resetDb();
    m = await createMerchant();
  });

  it('creates a link, takes a payment through it and tracks totals', async () => {
    const link = await m.agent.post('/dashboard/payment-links').set('x-csrf-token', m.csrf)
      .send({ title: 'Annual membership', amount: 1_500_000, description: 'Membership fee' }).expect(201);
    expect(link.body.data.url).toContain(`/l/${link.body.data.slug}`);
    const pub = await request(app).get(`/checkout/links/${link.body.data.slug}`).expect(200);
    expect(pub.body.data.available).toBe(true);
    // The customer cannot override a fixed link amount.
    const started = await request(app).post(`/checkout/links/${link.body.data.slug}`).send({ email: 'buyer@x.test', amount: 200_000 }).expect(201);
    const pay = await one(pool, `SELECT amount, payment_link_id FROM payments WHERE reference=$1`, [started.body.data.reference]);
    expect(pay).toEqual({ amount: 1_500_000, payment_link_id: link.body.data.id });
    await payViaSandbox(started.body.data.reference);
    const detail = await m.agent.get(`/dashboard/payment-links/${link.body.data.id}`).expect(200);
    expect(detail.body.data.paymentsCount).toBe(1);
    expect(detail.body.data.totalCollected).toBe(1_500_000);

    await m.agent.patch(`/dashboard/payment-links/${link.body.data.id}`).set('x-csrf-token', m.csrf).send({ status: 'disabled' }).expect(200);
    const blocked = await request(app).post(`/checkout/links/${link.body.data.slug}`).send({ email: 'buyer@x.test' });
    expect(blocked.status).toBe(410);
  });

  it('aggregates customer history', async () => {
    const list = await m.agent.get('/dashboard/customers').expect(200);
    const buyer = list.body.data.items.find((c: any) => c.email === 'buyer@x.test');
    expect(buyer.totalPayments).toBe(1);
    expect(buyer.totalAmount).toBe(1_500_000);
  });
});
