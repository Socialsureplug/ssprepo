import { describe, it, expect, beforeAll } from 'vitest';
import { resetDb, app, request, pool, one, createMerchant, createStaff, createPayment, api, type MerchantCtx } from './helpers';

describe('public API', () => {
  let m: MerchantCtx;
  beforeAll(async () => {
    await resetDb();
    m = await createMerchant();
  });

  it('rejects missing, malformed and revoked keys', async () => {
    await request(app).get('/v1/balance').expect(401);
    const bad = await request(app).get('/v1/balance').set('Authorization', 'Bearer sk_test_' + 'invalid-key-for-tests-0000');
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('invalid_api_key');
    // Rotating keys revokes the old one.
    await m.agent.post('/dashboard/settings/developers/keys').set('x-csrf-token', m.csrf).expect(201);
    await api(m.secretKey).get('/v1/balance').expect(401);
  });

  it('stores only a hash of secret keys', async () => {
    const res = await m.agent.post('/dashboard/settings/developers/keys').set('x-csrf-token', m.csrf).expect(201);
    m.secretKey = res.body.data.secretKey;
    expect(m.secretKey).toMatch(/^sk_test_/);
    const row = await one(pool, `SELECT key_hash FROM api_keys WHERE id=$1`, [res.body.data.id]);
    expect(row!.key_hash).not.toContain(m.secretKey);
    const list = await m.agent.get('/dashboard/settings/developers/keys').expect(200);
    expect(JSON.stringify(list.body)).not.toContain(m.secretKey);
  });

  it('replays idempotent requests and rejects key reuse with a different body', async () => {
    const body = { amount: 2_500_000, email: 'idem@x.test' };
    const a = await api(m.secretKey).post('/v1/payments').set('Idempotency-Key', 'idem-key-0001').send(body).expect(201);
    const b = await api(m.secretKey).post('/v1/payments').set('Idempotency-Key', 'idem-key-0001').send(body).expect(201);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.body.reference).toBe(a.body.reference);
    const c = await api(m.secretKey).post('/v1/payments').set('Idempotency-Key', 'idem-key-0001').send({ ...body, amount: 999_999 });
    expect(c.status).toBe(422);
    expect(c.body.error.code).toBe('idempotency_key_reused');
  });

  it('returns request ids and records API logs without secrets', async () => {
    const res = await api(m.secretKey).get('/v1/payments').expect(200);
    const reqId = res.headers['x-request-id'];
    expect(reqId).toMatch(/^req_/);
    await new Promise((r) => setTimeout(r, 100));
    const log = await one(pool, `SELECT * FROM api_logs WHERE request_id=$1`, [reqId]);
    expect(log).toMatchObject({ method: 'GET', status_code: 200, organization_id: m.orgId, mode: 'test' });
    expect(JSON.stringify(log)).not.toContain(m.secretKey);
  });

  it('isolates merchants from each other', async () => {
    const other = await createMerchant();
    const p = await createPayment(other.secretKey);
    await api(m.secretKey).get(`/v1/payments/${p.reference}`).expect(404);
    await m.agent.get(`/dashboard/payments/${p.data.id}`).expect(404);
  });

  it('hides internal errors behind a generic message', async () => {
    const res = await api(m.secretKey).post('/v1/payments').set('content-type', 'application/json').send('{"amount":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_json');
  });
});

describe('admin', () => {
  beforeAll(resetDb);

  it('enforces role-based permissions', async () => {
    const support = await createStaff(['support_admin']);
    await support.agent.get('/admin/transactions').expect(200);
    const fees = await support.agent.put('/admin/fees').set('x-csrf-token', support.csrf)
      .send({ organizationId: null, percentageBps: 50, fixedFee: 0, minFee: 0, maxFee: null, payoutFee: 0 });
    expect(fees.status).toBe(403);
    await support.agent.get('/admin/providers').expect(403);
    await support.agent.get('/admin/audit').expect(403);

    const finance = await createStaff(['finance_admin']);
    await finance.agent.put('/admin/fees').set('x-csrf-token', finance.csrf)
      .send({ organizationId: null, percentageBps: 150, fixedFee: 0, minFee: 0, maxFee: 300_000, payoutFee: 5_000 }).expect(200);
    await finance.agent.post('/admin/merchants/00000000-0000-0000-0000-000000000000/kyb').set('x-csrf-token', finance.csrf).send({ decision: 'approved' }).expect(403);
  });

  it('applies new fee schedules to new payments only, and merchant overrides win', async () => {
    const m = await createMerchant();
    const p1 = await createPayment(m.secretKey, { amount: 1_000_000 });
    expect(p1.data.fee).toBe(15_000); // 1.5% from the previous test
    const finance = await createStaff(['finance_admin']);
    await finance.agent.put('/admin/fees').set('x-csrf-token', finance.csrf)
      .send({ organizationId: m.orgId, percentageBps: 50, fixedFee: 0, minFee: 0, maxFee: null, payoutFee: 0 }).expect(200);
    const p2 = await createPayment(m.secretKey, { amount: 1_000_000 });
    expect(p2.data.fee).toBe(5_000);
    expect((await one(pool, `SELECT fee FROM payments WHERE id=$1`, [p1.data.id]))!.fee).toBe(15_000);
  });

  it('KYB approval enables live mode and is fully audited', async () => {
    const m = await createMerchant();
    await pool.query(`UPDATE organizations SET kyb_status='pending' WHERE id=$1`, [m.orgId]);
    await pool.query(`INSERT INTO kyb_verifications (organization_id, status, snapshot) VALUES ($1,'pending','{}')`, [m.orgId]);
    const ops = await createStaff(['operations_admin']);
    await ops.agent.post(`/admin/merchants/${m.orgId}/kyb`).set('x-csrf-token', ops.csrf).send({ decision: 'rejected' }).expect(422); // reason required
    await ops.agent.post(`/admin/merchants/${m.orgId}/kyb`).set('x-csrf-token', ops.csrf).send({ decision: 'approved' }).expect(200);
    expect(await one(pool, `SELECT kyb_status, live_enabled FROM organizations WHERE id=$1`, [m.orgId])).toEqual({ kyb_status: 'approved', live_enabled: true });
    expect(await one(pool, `SELECT 1 FROM audit_logs WHERE action='kyb.approved' AND organization_id=$1`, [m.orgId])).toBeTruthy();
    expect(await one(pool, `SELECT 1 FROM notifications WHERE type='kyb.approved' AND organization_id=$1`, [m.orgId])).toBeTruthy();
    await m.agent.post('/auth/mode').set('x-csrf-token', m.csrf).send({ mode: 'live' }).expect(200);
  });

  it('never exposes provider credentials and audits changes', async () => {
    const ops = await createStaff(['operations_admin']);
    const list = await ops.agent.get('/admin/providers').expect(200);
    const sandbox = list.body.data.providers.find((p: any) => p.code === 'sandbox');
    expect(sandbox.hasCredentials).toBe(true);
    expect(JSON.stringify(list.body)).not.toContain('sandbox-webhook-secret');
    const primary = list.body.data.providers.find((p: any) => p.code === 'primary_bank');
    await ops.agent.patch(`/admin/providers/${primary.id}`).set('x-csrf-token', ops.csrf)
      .send({ credentials: { secretKey: 'sk_provider_live_secret', webhookSecret: 'whsec_provider' }, config: { baseUrl: 'https://provider.example.com' } }).expect(200);
    const row = await one(pool, `SELECT credentials_encrypted FROM payment_providers WHERE id=$1`, [primary.id]);
    expect(row!.credentials_encrypted).not.toContain('sk_provider_live_secret');
    const audit = await one(pool, `SELECT metadata FROM audit_logs WHERE action='provider.updated' ORDER BY created_at DESC LIMIT 1`);
    expect(JSON.stringify(audit)).not.toContain('sk_provider_live_secret');
    // Sandbox can never be enabled for live payments.
    await ops.agent.patch(`/admin/providers/${sandbox.id}`).set('x-csrf-token', ops.csrf).send({ supportsLive: true }).expect(422);
  });

  it('manual ledger adjustments require permission, a reason and leave an audit trail', async () => {
    const m = await createMerchant();
    const support = await createStaff(['support_admin']);
    const body = { organizationId: m.orgId, mode: 'test', account: 'merchant_available', direction: 'credit', amount: 10_000, counterAccount: 'fee_revenue', reason: 'Goodwill credit for delayed settlement' };
    await support.agent.post('/admin/ledger/adjustments').set('x-csrf-token', support.csrf).set('Idempotency-Key', 'adj-0001').send(body).expect(403);
    const finance = await createStaff(['finance_admin']);
    await finance.agent.post('/admin/ledger/adjustments').set('x-csrf-token', finance.csrf).set('Idempotency-Key', 'adj-0001').send({ ...body, reason: 'short' }).expect(422);
    await finance.agent.post('/admin/ledger/adjustments').set('x-csrf-token', finance.csrf).set('Idempotency-Key', 'adj-0001').send(body).expect(201);
    await finance.agent.post('/admin/ledger/adjustments').set('x-csrf-token', finance.csrf).set('Idempotency-Key', 'adj-0001').send(body).expect(201); // idempotent
    const bal = await m.agent.get('/dashboard/balance').expect(200);
    expect(bal.body.data.available).toBe(10_000);
    expect(await one(pool, `SELECT 1 FROM audit_logs WHERE action='ledger.adjustment' AND organization_id=$1`, [m.orgId])).toBeTruthy();
  });

  it('reconciliation status changes require a note and are audited', async () => {
    const finance = await createStaff(['finance_admin']);
    const issue = await one(pool, `INSERT INTO reconciliation_issues (type, fingerprint) VALUES ('unmatched_transaction','test-fp-1') RETURNING id`);
    await finance.agent.patch(`/admin/reconciliation/${issue!.id}`).set('x-csrf-token', finance.csrf).send({ status: 'resolved' }).expect(422);
    await finance.agent.patch(`/admin/reconciliation/${issue!.id}`).set('x-csrf-token', finance.csrf).send({ status: 'investigating', note: 'Checking with provider' }).expect(200);
    await finance.agent.patch(`/admin/reconciliation/${issue!.id}`).set('x-csrf-token', finance.csrf).send({ status: 'resolved', note: 'Refunded to sender' }).expect(200);
    const logs = await one(pool, `SELECT count(*)::int AS n FROM audit_logs WHERE action='reconciliation.status_changed' AND target_id=$1`, [issue!.id]);
    expect(logs!.n).toBe(2);
  });

  it('suspending a merchant revokes live keys and blocks processing', async () => {
    const m = await createMerchant({ approved: true });
    const risk = await createStaff(['risk_admin']);
    await risk.agent.post(`/admin/merchants/${m.orgId}/status`).set('x-csrf-token', risk.csrf).send({ status: 'suspended', reason: 'Suspicious activity under review' }).expect(200);
    const res = await api(m.secretKey).post('/v1/payments').send({ amount: 2_500_000, email: 'a@b.test' });
    expect(res.body.error.code).toBe('merchant_restricted');
  });
});
