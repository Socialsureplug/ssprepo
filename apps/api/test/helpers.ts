import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import type { Mode } from '@app/shared';
import { createApp } from '../src/app';
import { pool, one, query } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { seedPlatform } from '../src/db/seed';
import { createWorker } from '../src/jobs/handlers';
import { hashPassword } from '../src/lib/crypto';
import { MemoryEmailProvider } from '../src/modules/notifications/email';
import { createApiKey } from '../src/modules/organizations/onboarding.service';

export const app = createApp();
export const worker = createWorker(10);

let migrated = false;

/** Fresh database for each test file: all data truncated, platform defaults re-seeded. */
export async function resetDb() {
  if (!migrated) {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(false);
    migrated = true;
  }
  const tables = await query<{ tablename: string }>(pool, `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'schema_migrations'`);
  await pool.query(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await seedPlatform();
  MemoryEmailProvider.outbox.length = 0;
}

/** Run every queued job, including delayed ones (e.g. simulated provider callbacks, retries). */
export async function runJobs(rounds = 10) {
  for (let i = 0; i < rounds; i++) {
    await pool.query(`UPDATE jobs SET run_at=now() WHERE status='pending'`);
    const n = await worker.drain();
    if (n === 0) return;
  }
}

/** Run jobs but leave future-dated ones (used to observe retry scheduling). */
export async function runDueJobs() {
  await worker.drain();
}

export interface MerchantCtx {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  orgId: string;
  userId: string;
  email: string;
  secretKey: string;
}

let counter = 0;
export async function createMerchant(opts: { approved?: boolean; mode?: Mode; schedule?: 't0' | 't1' | 'manual' } = {}): Promise<MerchantCtx> {
  counter++;
  const email = `owner${counter}_${Date.now()}@merchant.test`;
  const agent = request.agent(app);
  await agent.post('/auth/signup').send({ firstName: 'Ada', lastName: 'Obi', email, password: 'CorrectHorse42', businessName: `Merchant ${counter}` }).expect(201);
  const user = (await one(pool, `SELECT id FROM users WHERE email=$1`, [email]))!;
  await pool.query(`UPDATE users SET email_verified_at=now() WHERE id=$1`, [user.id]);
  const org = (await one(pool, `SELECT organization_id FROM organization_members WHERE user_id=$1`, [user.id]))!;
  if (opts.approved) await pool.query(`UPDATE organizations SET kyb_status='approved', live_enabled=true WHERE id=$1`, [org.organization_id]);
  if (opts.schedule) await pool.query(`UPDATE organizations SET settlement_schedule=$2 WHERE id=$1`, [org.organization_id, opts.schedule]);
  const me = await agent.get('/auth/me').expect(200);
  const mode = opts.mode ?? 'test';
  if (mode === 'live') await agent.post('/auth/mode').set('x-csrf-token', me.body.data.csrfToken).send({ mode: 'live' }).expect(200);
  const key = await createApiKey(org.organization_id, mode, { type: 'user', id: user.id });
  return { agent, csrf: me.body.data.csrfToken, orgId: org.organization_id, userId: user.id, email, secretKey: key.secretKey };
}

export async function addBankAccount(m: MerchantCtx, accountNumber = '0123456789') {
  const res = await m.agent.post('/dashboard/settings/bank-accounts').set('x-csrf-token', m.csrf).send({ bankCode: '058', accountNumber }).expect(201);
  // Age the account so new-account risk holds don't apply in tests that aren't about risk.
  await pool.query(`UPDATE bank_accounts SET created_at = now() - interval '3 days' WHERE id=$1`, [res.body.data.id]);
  return res.body.data;
}

export function api(secretKey: string) {
  return {
    post: (path: string) => request(app).post(path).set('Authorization', `Bearer ${secretKey}`),
    get: (path: string) => request(app).get(path).set('Authorization', `Bearer ${secretKey}`),
  };
}

export async function createPayment(secretKey: string, body: Record<string, unknown> = {}) {
  const res = await api(secretKey).post('/v1/payments').send({ amount: 2_500_000, email: 'customer@example.com', ...body });
  if (res.status !== 201) throw new Error(`createPayment failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/** Customer pays via the sandbox; the provider webhook is then processed by the worker. */
export async function payViaSandbox(reference: string, amount?: number) {
  await request(app).post(`/checkout/${reference}/simulate-transfer`).send(amount ? { amount } : {}).expect(200);
  await runJobs();
}

export async function createStaff(roles: string[]) {
  const email = `staff_${roles.join('_')}_${Date.now()}@platform.test`;
  await pool.query(
    `INSERT INTO users (email, password_hash, first_name, last_name, is_staff, staff_roles, email_verified_at) VALUES ($1,$2,'Staff','User',true,$3,now())`,
    [email, await hashPassword('StaffPass12345'), roles],
  );
  const agent = request.agent(app);
  await agent.post('/admin/auth/login').send({ email, password: 'StaffPass12345' }).expect(200);
  const me = await agent.get('/admin/auth/me').expect(200);
  return { agent, csrf: me.body.data.csrfToken as string, email };
}

export async function balances(orgId: string, mode: Mode = 'test') {
  const { merchantBalances } = await import('../src/modules/ledger/ledger.service');
  return merchantBalances(pool, orgId, mode);
}

/** A local HTTP server that records webhook requests and replies with a configurable status. */
export async function webhookReceiver() {
  const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];
  let status = 200;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.writeHead(status).end('ok');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://localhost:${port}/hooks`,
    received,
    setStatus: (s: number) => { status = s; },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export { pool, one, query, request };
