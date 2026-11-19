import { describe, it, expect, beforeAll } from 'vitest';
import { resetDb, app, request, pool, one, createMerchant, createStaff } from './helpers';
import { MemoryEmailProvider } from '../src/modules/notifications/email';
import { runJobs } from './helpers';

function tokenFromOutbox(path: string) {
  const mail = [...MemoryEmailProvider.outbox].reverse().find((m) => m.text.includes(path));
  return mail?.text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
}

describe('authentication', () => {
  beforeAll(resetDb);

  const email = 'founder@shop.test';
  const password = 'CorrectHorse42';

  it('signs up, creates an organization with the user as owner, and sets an httpOnly session cookie', async () => {
    const res = await request(app).post('/auth/signup').send({ firstName: 'Ngozi', lastName: 'Eze', email, password, businessName: 'Shop Ltd' }).expect(201);
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/^sid=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    const member = await one(pool, `SELECT m.role FROM organization_members m JOIN users u ON u.id=m.user_id WHERE u.email=$1`, [email]);
    expect(member!.role).toBe('owner');
    const stored = await one(pool, `SELECT password_hash FROM users WHERE email=$1`, [email]);
    expect(stored!.password_hash).toMatch(/^scrypt\$/);
    expect(stored!.password_hash).not.toContain(password);
  });

  it('rejects weak passwords and duplicate emails', async () => {
    await request(app).post('/auth/signup').send({ firstName: 'A', lastName: 'B', email: 'x@y.test', password: 'short', businessName: 'Biz' }).expect(422);
    await request(app).post('/auth/signup').send({ firstName: 'A', lastName: 'B', email, password, businessName: 'Biz' }).expect(409);
  });

  it('verifies email with a single-use token', async () => {
    await runJobs();
    const token = tokenFromOutbox('/verify-email');
    expect(token).toBeTruthy();
    await request(app).post('/auth/verify-email').send({ token }).expect(200);
    await request(app).post('/auth/verify-email').send({ token }).expect(400);
    const u = await one(pool, `SELECT email_verified_at FROM users WHERE email=$1`, [email]);
    expect(u!.email_verified_at).not.toBeNull();
  });

  it('protects routes and requires CSRF tokens for state-changing requests', async () => {
    await request(app).get('/dashboard/overview').expect(401);
    const agent = request.agent(app);
    await agent.post('/auth/login').send({ email, password }).expect(200);
    await agent.get('/dashboard/overview').expect(200);
    const noCsrf = await agent.post('/dashboard/payment-links').send({ title: 'Test', amount: 100_000 });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error.code).toBe('csrf_invalid');
  });

  it('does not reveal whether an email exists and locks out after repeated failures', async () => {
    const unknown = await request(app).post('/auth/login').send({ email: 'nobody@shop.test', password: 'whatever123' }).expect(401);
    const wrong = await request(app).post('/auth/login').send({ email, password: 'wrongpassword1' }).expect(401);
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
    for (let i = 0; i < 4; i++) await request(app).post('/auth/login').send({ email, password: 'wrongpassword1' });
    const locked = await request(app).post('/auth/login').send({ email, password });
    expect(locked.status).toBe(423);
    await pool.query(`UPDATE users SET locked_until=NULL WHERE email=$1`, [email]);
  });

  it('resets the password via emailed token and revokes existing sessions', async () => {
    const agent = request.agent(app);
    await agent.post('/auth/login').send({ email, password }).expect(200);
    await request(app).post('/auth/forgot-password').send({ email }).expect(200);
    await request(app).post('/auth/forgot-password').send({ email: 'ghost@shop.test' }).expect(200); // same response
    await runJobs();
    const token = tokenFromOutbox('/reset-password');
    await request(app).post('/auth/reset-password').send({ token, password: 'NewPassword99' }).expect(200);
    await agent.get('/auth/me').expect(401);
    await request(app).post('/auth/login').send({ email, password }).expect(401);
    await request(app).post('/auth/login').send({ email, password: 'NewPassword99' }).expect(200);
  });

  it('changes password (requires current password) and logs out', async () => {
    const agent = request.agent(app);
    await agent.post('/auth/login').send({ email, password: 'NewPassword99' }).expect(200);
    const me = await agent.get('/auth/me').expect(200);
    const csrf = me.body.data.csrfToken;
    expect(me.body.data).not.toHaveProperty('user.password_hash');
    await agent.post('/auth/change-password').set('x-csrf-token', csrf).send({ currentPassword: 'nope', newPassword: 'Another12345' }).expect(422);
    await agent.post('/auth/change-password').set('x-csrf-token', csrf).send({ currentPassword: 'NewPassword99', newPassword: 'Another12345' }).expect(200);
    await agent.post('/auth/logout').set('x-csrf-token', csrf).expect(200);
    await agent.get('/auth/me').expect(401);
  });

  it('keeps merchant and staff sessions separate', async () => {
    const m = await createMerchant();
    await m.agent.get('/admin/overview').expect(401);
    const merchantLoginAsStaff = await request(app).post('/admin/auth/login').send({ email: m.email, password: 'CorrectHorse42' });
    expect(merchantLoginAsStaff.status).toBe(401);
    const staff = await createStaff(['support_admin']);
    await staff.agent.get('/dashboard/overview').expect(401);
  });

  it('blocks switching to live mode until KYB is approved', async () => {
    const m = await createMerchant();
    const res = await m.agent.post('/auth/mode').set('x-csrf-token', m.csrf).send({ mode: 'live' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('merchant_not_verified');
  });
});

describe('merchant onboarding & KYB', () => {
  beforeAll(resetDb);

  const profile = {
    businessName: 'Lagos Goods Ltd', businessType: 'limited_liability', businessEmail: 'ops@lagosgoods.test', businessPhone: '08031234567',
    country: 'NG', registrationNumber: 'RC123456', address: '12 Admiralty Way, Lekki, Lagos', description: 'We sell household goods online across Nigeria.',
    expectedMonthlyVolume: '1m_10m', directorName: 'Chidi Okeke', directorEmail: 'chidi@lagosgoods.test', directorPhone: '08098765432',
  };

  it('requires profile and settlement account before submission, then moves to pending', async () => {
    const m = await createMerchant();
    const early = await m.agent.post('/dashboard/settings/onboarding/submit').set('x-csrf-token', m.csrf);
    expect(early.body.error.code).toBe('profile_incomplete');
    await m.agent.put('/dashboard/settings/onboarding/profile').set('x-csrf-token', m.csrf).send({ ...profile, businessPhone: '123' }).expect(422);
    await m.agent.put('/dashboard/settings/onboarding/profile').set('x-csrf-token', m.csrf).send(profile).expect(200);
    const noBank = await m.agent.post('/dashboard/settings/onboarding/submit').set('x-csrf-token', m.csrf);
    expect(noBank.body.error.code).toBe('bank_account_required');
    const bank = await m.agent.post('/dashboard/settings/bank-accounts').set('x-csrf-token', m.csrf).send({ bankCode: '058', accountNumber: '0123456789' }).expect(201);
    expect(bank.body.data.account_number_last4).toBe('6789');
    expect(JSON.stringify(bank.body)).not.toContain('0123456789');
    const stored = await one(pool, `SELECT account_number_encrypted FROM bank_accounts WHERE id=$1`, [bank.body.data.id]);
    expect(stored!.account_number_encrypted).not.toContain('0123456789');
    await m.agent.post('/dashboard/settings/onboarding/submit').set('x-csrf-token', m.csrf).expect(200);
    const org = await one(pool, `SELECT kyb_status, live_enabled FROM organizations WHERE id=$1`, [m.orgId]);
    expect(org).toEqual({ kyb_status: 'pending', live_enabled: false });
    // Profile is locked while under review.
    await m.agent.put('/dashboard/settings/onboarding/profile').set('x-csrf-token', m.csrf).send(profile).expect(409);
  });
});
