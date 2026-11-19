import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb, app, request, pool, one, query, createMerchant, createPayment, payViaSandbox, runJobs, runDueJobs, webhookReceiver, type MerchantCtx } from './helpers';
import { getProviderByCode } from '../src/providers/registry';
import type { SandboxProvider } from '../src/providers/adapters/sandbox';
import { hmacSha256Hex } from '../src/lib/crypto';

let m: MerchantCtx;

describe('provider webhook processing', () => {
  beforeAll(async () => {
    await resetDb();
    m = await createMerchant();
  });

  it('rejects webhooks with an invalid signature and never processes them', async () => {
    const p = await createPayment(m.secretKey);
    const body = JSON.stringify({ id: 'evt_forged', event: 'collection.successful', data: { provider_reference: 'x', account_number: p.data.bankTransfer.accountNumber, amount: 2_500_000, occurred_at: new Date().toISOString() } });
    await request(app).post('/webhooks/providers/sandbox').set('content-type', 'application/json').set('x-sandbox-signature', 'deadbeef').send(body).expect(401);
    await request(app).post('/webhooks/providers/sandbox').set('content-type', 'application/json').send(body).expect(401);
    await runJobs();
    expect((await one(pool, `SELECT status FROM payments WHERE id=$1`, [p.data.id]))!.status).toBe('pending');
    const stored = await one(pool, `SELECT signature_valid, processing_status FROM webhook_events WHERE event_type='collection.successful' AND NOT signature_valid LIMIT 1`);
    expect(stored).toEqual({ signature_valid: false, processing_status: 'ignored' });
  });

  it('rejects correctly-signed events for transfers the provider cannot verify', async () => {
    const p = await createPayment(m.secretKey);
    const sandbox = (await getProviderByCode(pool, 'sandbox'))!.provider as unknown as SandboxProvider;
    // Signed but referencing a transaction that does not exist at the provider.
    const { rawBody, headers } = sandbox.signedWebhook('collection.successful', {
      provider_reference: 'sbx_tx_doesnotexist', account_number: p.data.bankTransfer.accountNumber, amount: 2_500_000, occurred_at: new Date().toISOString(),
    });
    await request(app).post('/webhooks/providers/sandbox').set('content-type', 'application/json').set(headers).send(rawBody).expect(200);
    await runJobs();
    expect((await one(pool, `SELECT status FROM payments WHERE id=$1`, [p.data.id]))!.status).toBe('pending');
    const ev = await one(pool, `SELECT processing_status, error_message, retry_count FROM webhook_events WHERE payload->'data'->>'provider_reference'='sbx_tx_doesnotexist'`);
    expect(ev!.processing_status).toBe('failed');
    expect(ev!.error_message).toMatch(/could not be verified/);
  });

  it('is idempotent: the same event delivered twice is processed once', async () => {
    const p = await createPayment(m.secretKey, { amount: 3_000_000 });
    const sandbox = (await getProviderByCode(pool, 'sandbox'))!.provider as unknown as SandboxProvider;
    const { rawBody, headers } = await sandbox.simulateTransfer(p.data.bankTransfer.accountNumber, 3_000_000);
    const first = await request(app).post('/webhooks/providers/sandbox').set('content-type', 'application/json').set(headers).send(rawBody).expect(200);
    const second = await request(app).post('/webhooks/providers/sandbox').set('content-type', 'application/json').set(headers).send(rawBody).expect(200);
    expect(first.body.data.duplicate).toBe(false);
    expect(second.body.data.duplicate).toBe(true);
    await runJobs();
    const postings = await query(pool, `SELECT id FROM ledger_transactions WHERE idempotency_key=$1`, [`payment:${p.data.id}`]);
    expect(postings).toHaveLength(1);
    expect((await one(pool, `SELECT count(*)::int AS n FROM webhook_events WHERE external_event_id=$1`, [JSON.parse(rawBody).id]))!.n).toBe(1);
  });

  it('a different event for the same provider transaction does not double-credit', async () => {
    const p = await createPayment(m.secretKey, { amount: 4_000_000 });
    const sandbox = (await getProviderByCode(pool, 'sandbox'))!.provider as unknown as SandboxProvider;
    const { rawBody } = await sandbox.simulateTransfer(p.data.bankTransfer.accountNumber, 4_000_000);
    const data = JSON.parse(rawBody).data;
    for (const id of ['evt_a', 'evt_b']) {
      const w = sandbox.signedWebhook('collection.successful', data, `sbx_${id}_${p.reference}`);
      await request(app).post('/webhooks/providers/sandbox').set('content-type', 'application/json').set(w.headers).send(w.rawBody).expect(200);
    }
    await runJobs();
    const credits = await query(pool, `SELECT id FROM provider_transactions WHERE payment_id=$1`, [p.data.id]);
    expect(credits).toHaveLength(1);
    const pending = await query(pool, `SELECT 1 FROM ledger_transactions WHERE reference_id=$1 AND kind='payment'`, [p.data.id]);
    expect(pending).toHaveLength(1);
  });

  it('returns 404 for unknown providers', async () => {
    await request(app).post('/webhooks/providers/nope').send('{}').expect(404);
  });
});

describe('merchant webhooks', () => {
  let receiver: Awaited<ReturnType<typeof webhookReceiver>>;
  let secret: string;

  beforeAll(async () => {
    await resetDb();
    m = await createMerchant();
    receiver = await webhookReceiver();
    const res = await m.agent.put('/dashboard/settings/developers/webhook').set('x-csrf-token', m.csrf)
      .send({ url: receiver.url, events: ['payment.success', 'payment.created', 'settlement.completed'], enabled: true }).expect(200);
    secret = res.body.data.secret;
    expect(secret).toMatch(/^whsec_/);
  });
  afterAll(() => receiver.close());

  it('sends signed events that the merchant can verify', async () => {
    const p = await createPayment(m.secretKey);
    await payViaSandbox(p.reference);
    const success = receiver.received.find((r) => JSON.parse(r.body).type === 'payment.success');
    expect(success).toBeTruthy();
    const sig = String(success!.headers['x-nairaflow-signature']);
    const [, t, v1] = sig.match(/^t=(\d+),v1=([0-9a-f]+)$/)!;
    expect(v1).toBe(hmacSha256Hex(secret, `${t}.${success!.body}`));
    expect(JSON.parse(success!.body).data.reference).toBe(p.reference);
    // Events the merchant did not subscribe to are not sent.
    expect(receiver.received.some((r) => JSON.parse(r.body).type === 'payment.pending')).toBe(false);
  });

  it('retries failed deliveries with exponential backoff and logs every attempt', async () => {
    receiver.setStatus(500);
    const before = receiver.received.length;
    await createPayment(m.secretKey);
    await runDueJobs();
    const d = await one(pool, `SELECT * FROM webhook_deliveries WHERE event_type='payment.created' ORDER BY created_at DESC LIMIT 1`);
    expect(receiver.received.length).toBe(before + 1);
    expect(d!.status).toBe('retrying');
    expect(d!.attempt_count).toBe(1);
    expect(d!.last_response_status).toBe(500);
    expect(new Date(d!.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 5_000);

    // Manual retry from the dashboard once the endpoint is healthy.
    receiver.setStatus(200);
    await m.agent.post(`/dashboard/settings/developers/webhook/deliveries/${d!.id}/retry`).set('x-csrf-token', m.csrf).expect(200);
    await runDueJobs();
    const after = await one(pool, `SELECT status, attempt_count, last_response_time_ms FROM webhook_deliveries WHERE id=$1`, [d!.id]);
    expect(after!.status).toBe('succeeded');
    expect(after!.attempt_count).toBe(2);
    expect(after!.last_response_time_ms).toBeGreaterThanOrEqual(0);
  });

  it('gives up after the maximum attempts and notifies the merchant', async () => {
    receiver.setStatus(503);
    await createPayment(m.secretKey);
    await runJobs(12);
    const d = await one(pool, `SELECT status, attempt_count FROM webhook_deliveries WHERE event_type='payment.created' ORDER BY created_at DESC LIMIT 1`);
    expect(d).toEqual({ status: 'failed', attempt_count: 8 });
    expect(await one(pool, `SELECT 1 FROM notifications WHERE organization_id=$1 AND type='webhook.failure'`, [m.orgId])).toBeTruthy();
    receiver.setStatus(200);
  });
});
