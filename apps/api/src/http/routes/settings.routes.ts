import { Router } from 'express';
import { z } from 'zod';
import {
  businessProfileSchema, bankAccountSchema, inviteMemberSchema, merchantWebhookSchema, MERCHANT_ROLES,
} from '@app/shared';
import { pool, one, query } from '../../db/pool';
import { AppError, Errors } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { NIGERIAN_BANKS } from '../../lib/banks';
import { parse, ok, pagination, actorFrom } from '../helpers';
import { requireMerchant, can, requireVerifiedEmail, dashboardLimiter } from '../middleware';
import * as onboarding from '../../modules/organizations/onboarding.service';
import { inviteMember } from '../../modules/auth/auth.service';
import { retryDelivery } from '../../modules/webhooks/merchant-webhooks.service';
import { enqueue } from '../../jobs/queue';

export const settingsRouter = Router();
settingsRouter.use(dashboardLimiter, requireMerchant);

const orgOf = (req: any) => ({ orgId: req.session.org.id as string, mode: req.session.mode as 'test' | 'live' });

settingsRouter.get('/banks', (_req, res) => ok(res, NIGERIAN_BANKS));

// ------------------------------------------------------------------ onboarding & KYB
settingsRouter.get('/onboarding', async (req, res) => {
  const { orgId } = orgOf(req);
  const [profile, banks, latestKyb] = await Promise.all([
    onboarding.getProfile(orgId),
    onboarding.listBankAccounts(orgId),
    one(pool, `SELECT status, submitted_at, reviewed_at, decision_reason FROM kyb_verifications WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 1`, [orgId]),
  ]);
  const org = req.session!.org!;
  ok(res, {
    kybStatus: org.kyb_status, liveEnabled: org.live_enabled, emailVerified: !!req.session!.user.email_verified_at,
    profile: profile && {
      businessName: profile.business_name, businessType: profile.business_type, businessEmail: profile.business_email,
      businessPhone: profile.business_phone, country: profile.country, registrationNumber: profile.registration_number, taxId: profile.tax_id ?? '',
      address: profile.address, description: profile.description, website: profile.website ?? '', expectedMonthlyVolume: profile.expected_monthly_volume,
      directorName: profile.director_name, directorEmail: profile.director_email, directorPhone: profile.director_phone, directorBvnLast4: profile.director_bvn_last4 ?? '',
    },
    bankAccounts: banks,
    latestReview: latestKyb,
  });
});

settingsRouter.put('/onboarding/profile', can('kyb.submit'), async (req, res) => {
  await onboarding.saveProfile(orgOf(req).orgId, parse(businessProfileSchema, req.body), actorFrom(req));
  ok(res, { saved: true });
});

settingsRouter.post('/onboarding/submit', can('kyb.submit'), requireVerifiedEmail, async (req, res) => {
  await onboarding.submitKyb(orgOf(req).orgId, actorFrom(req));
  ok(res, { submitted: true });
});

settingsRouter.get('/bank-accounts', can('balance.view'), async (req, res) => ok(res, await onboarding.listBankAccounts(orgOf(req).orgId)));
settingsRouter.post('/bank-accounts', can('settings.manage'), requireVerifiedEmail, async (req, res) => {
  const { orgId, mode } = orgOf(req);
  ok(res, await onboarding.addBankAccount(orgId, mode, parse(bankAccountSchema, req.body), actorFrom(req)), 201);
});
settingsRouter.post('/bank-accounts/:id/default', can('settings.manage'), async (req, res) => {
  await onboarding.setDefaultBankAccount(orgOf(req).orgId, String(req.params.id), actorFrom(req));
  ok(res, { updated: true });
});
settingsRouter.delete('/bank-accounts/:id', can('settings.manage'), async (req, res) => {
  const { orgId } = orgOf(req);
  const r = await one(pool, `UPDATE bank_accounts SET status='removed', is_default=false WHERE id=$1 AND organization_id=$2 AND NOT is_default RETURNING id`, [req.params.id, orgId]);
  if (!r) throw new AppError('cannot_remove', 'Set another default account before removing this one.', 409);
  await audit(pool, actorFrom(req), 'bank_account.removed', { organizationId: orgId, targetType: 'bank_account', targetId: String(req.params.id) });
  ok(res, { removed: true });
});

settingsRouter.put('/settlement-schedule', can('settings.manage'), async (req, res) => {
  const { schedule } = parse(z.object({ schedule: z.enum(['t1', 'manual']) }), req.body);
  const { orgId } = orgOf(req);
  await pool.query(`UPDATE organizations SET settlement_schedule=$2 WHERE id=$1`, [orgId, schedule]);
  await audit(pool, actorFrom(req), 'settlement.schedule_changed', { organizationId: orgId, metadata: { schedule } });
  ok(res, { schedule });
});

// ------------------------------------------------------------------ team
settingsRouter.get('/team', async (req, res) => {
  const rows = await query(pool, `SELECT m.id, m.email, m.role, m.status, m.created_at, u.first_name, u.last_name FROM organization_members m
    LEFT JOIN users u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.status <> 'removed' ORDER BY m.created_at`, [orgOf(req).orgId]);
  ok(res, rows);
});
settingsRouter.post('/team/invites', can('team.manage'), requireVerifiedEmail, async (req, res) => {
  const { email, role } = parse(inviteMemberSchema, req.body);
  const m = await inviteMember(orgOf(req).orgId, req.session!.org!.name, email.toLowerCase(), role, actorFrom(req));
  ok(res, { id: m!.id, email: m!.email, role: m!.role, status: m!.status }, 201);
});
settingsRouter.patch('/team/:id', can('team.manage'), async (req, res) => {
  const { role } = parse(z.object({ role: z.enum(MERCHANT_ROLES).refine((r) => r !== 'owner') }), req.body);
  const { orgId } = orgOf(req);
  const r = await one(pool, `UPDATE organization_members SET role=$3 WHERE id=$1 AND organization_id=$2 AND role <> 'owner' RETURNING id`, [req.params.id, orgId, role]);
  if (!r) throw Errors.notFound('Team member');
  await audit(pool, actorFrom(req), 'team.role_changed', { organizationId: orgId, targetType: 'member', targetId: String(req.params.id), metadata: { role } });
  ok(res, { updated: true });
});
settingsRouter.delete('/team/:id', can('team.manage'), async (req, res) => {
  const { orgId } = orgOf(req);
  const r = await one(pool, `UPDATE organization_members SET status='removed' WHERE id=$1 AND organization_id=$2 AND role <> 'owner' RETURNING user_id`, [req.params.id, orgId]);
  if (!r) throw Errors.notFound('Team member');
  if (r.user_id) await pool.query(`UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND organization_id=$2 AND revoked_at IS NULL`, [r.user_id, orgId]);
  await audit(pool, actorFrom(req), 'team.member_removed', { organizationId: orgId, targetType: 'member', targetId: String(req.params.id) });
  ok(res, { removed: true });
});

// ------------------------------------------------------------------ developers
settingsRouter.get('/developers/keys', can('developers.manage'), async (req, res) => {
  const { orgId, mode } = orgOf(req);
  ok(res, await onboarding.listApiKeys(orgId, mode));
});
settingsRouter.post('/developers/keys', can('developers.manage'), requireVerifiedEmail, async (req, res) => {
  const { orgId, mode } = orgOf(req);
  if (mode === 'live' && (req.session!.org!.kyb_status !== 'approved' || !req.session!.org!.live_enabled)) throw Errors.merchantNotVerified();
  ok(res, await onboarding.createApiKey(orgId, mode, actorFrom(req)), 201);
});
settingsRouter.post('/developers/keys/revoke', can('developers.manage'), async (req, res) => {
  const { orgId, mode } = orgOf(req);
  await onboarding.revokeApiKeys(orgId, mode, actorFrom(req));
  ok(res, { revoked: true });
});

settingsRouter.get('/developers/webhook', can('developers.manage'), async (req, res) => {
  const { orgId, mode } = orgOf(req);
  const hook = await one(pool, `SELECT id, url, events, enabled, secret_last4, created_at, updated_at FROM merchant_webhooks WHERE organization_id=$1 AND mode=$2`, [orgId, mode]);
  ok(res, hook);
});
settingsRouter.put('/developers/webhook', can('developers.manage'), async (req, res) => {
  const { orgId, mode } = orgOf(req);
  ok(res, await onboarding.upsertWebhook(orgId, mode, parse(merchantWebhookSchema, req.body), actorFrom(req)));
});
settingsRouter.post('/developers/webhook/rotate-secret', can('developers.manage'), async (req, res) => {
  const { orgId, mode } = orgOf(req);
  ok(res, await onboarding.rotateWebhookSecret(orgId, mode, actorFrom(req)));
});
settingsRouter.post('/developers/webhook/test', can('developers.manage'), async (req, res) => {
  const { orgId, mode } = orgOf(req);
  const hook = await one(pool, `SELECT id, events FROM merchant_webhooks WHERE organization_id=$1 AND mode=$2`, [orgId, mode]);
  if (!hook) throw Errors.notFound('Webhook endpoint');
  await sendTestEvent(orgId, mode);
  ok(res, { queued: true });
});
settingsRouter.get('/developers/webhook/deliveries', can('developers.manage'), async (req, res) => {
  const { orgId, mode } = orgOf(req);
  const { page, pageSize, offset } = pagination(req);
  const rows = await query(pool, `SELECT id, event_id, event_type, url, status, attempt_count, next_attempt_at, last_response_status, last_response_time_ms,
      last_error, delivered_at, created_at, payload FROM webhook_deliveries WHERE organization_id=$1 AND mode=$2 ORDER BY created_at DESC LIMIT $3 OFFSET $4`, [orgId, mode, pageSize, offset]);
  ok(res, { items: rows, page, pageSize });
});
settingsRouter.post('/developers/webhook/deliveries/:id/retry', can('developers.manage'), async (req, res) => {
  const okRetry = await retryDelivery(pool, orgOf(req).orgId, String(req.params.id));
  if (!okRetry) throw Errors.notFound('Delivery');
  ok(res, { queued: true });
});
settingsRouter.get('/developers/logs', can('developers.manage'), async (req, res) => {
  const { orgId, mode } = orgOf(req);
  const { page, pageSize, offset } = pagination(req);
  const rows = await query(pool, `SELECT id, request_id, method, path, status_code, latency_ms, ip, idempotency_key, request_body, response_body, created_at
    FROM api_logs WHERE organization_id=$1 AND mode=$2 ORDER BY created_at DESC LIMIT $3 OFFSET $4`, [orgId, mode, pageSize, offset]);
  ok(res, { items: rows, page, pageSize });
});

/** Emit a synthetic, clearly-labelled event to the merchant's endpoint. */
export async function sendTestEvent(orgId: string, mode: 'test' | 'live') {
  const hook = await one(pool, `SELECT id, url FROM merchant_webhooks WHERE organization_id=$1 AND mode=$2`, [orgId, mode]);
  if (!hook) throw Errors.notFound('Webhook endpoint');
  const { refs } = await import('../../lib/ids');
  const eventId = refs.event();
  const payload = { id: eventId, type: 'payment.success', mode, test: true, created_at: new Date().toISOString(), data: { reference: 'PAY_TESTEVENT0000', amount: 2500000, currency: 'NGN', status: 'successful' } };
  const row = await one(pool, `INSERT INTO webhook_deliveries (merchant_webhook_id, organization_id, mode, event_id, event_type, url, payload) VALUES ($1,$2,$3,$4,'payment.success',$5,$6) RETURNING id`,
    [hook.id, orgId, mode, eventId, hook.url, JSON.stringify(payload)]);
  await enqueue(pool, 'merchant_webhook.deliver', { deliveryId: row!.id }, { maxAttempts: 1 });
}
