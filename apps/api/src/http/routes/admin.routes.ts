import { Router } from 'express';
import { z } from 'zod';
import {
  loginSchema, feeScheduleSchema, STAFF_ROLES, STAFF_ROLE_PERMISSIONS, KYB_STATUSES, RISK_STATUSES, RECON_STATUSES, PAYMENT_STATUSES,
} from '@app/shared';
import { pool, one, query, withTx } from '../../db/pool';
import { encrypt, hashPassword, randomToken } from '../../lib/crypto';
import { AppError, Errors } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { parse, ok, pagination, actorFrom, clientIp, likeTerm } from '../helpers';
import { requireStaff, staffPerm, authLimiter, STAFF_COOKIE, dashboardLimiter } from '../middleware';
import { setSessionCookie, clearSessionCookie } from './auth.routes';
import * as auth from '../../modules/auth/auth.service';
import * as ledger from '../../modules/ledger/ledger.service';
import { rowToDTO, PAYMENT_LIST_SELECT } from '../../modules/payments/payments.repo';
import { paymentTimeline } from '../../modules/payments/payments.service';
import { settlementDTO, runSettlements } from '../../modules/settlements/settlements.service';
import { withdrawalDTO, approveHeldWithdrawal, failWithdrawal } from '../../modules/withdrawals/withdrawals.service';
import { refundDTO } from '../../modules/refunds/refunds.service';
import { linkDTO } from '../../modules/payment-links/payment-links.service';
import { runReconciliation, updateIssueStatus } from '../../modules/reconciliation/reconciliation.service';
import { notifyOrg } from '../../modules/notifications/notifications.service';
import { ADAPTERS } from '../../providers/registry';
import { checkProviderHealth } from '../../jobs/handlers';

export const adminRouter = Router();

// ------------------------------------------------------------------ staff auth
adminRouter.post('/auth/login', authLimiter, async (req, res) => {
  const input = parse(loginSchema, req.body);
  const session = await auth.login(input.email, input.password, 'staff', { ip: clientIp(req), userAgent: req.get('user-agent') });
  setSessionCookie(res, STAFF_COOKIE, session.token, session.expiresAt);
  ok(res, { authenticated: true });
});

adminRouter.use(dashboardLimiter, requireStaff);

adminRouter.post('/auth/logout', async (req, res) => {
  await auth.logout(req.staff!.sessionId);
  clearSessionCookie(res, STAFF_COOKIE);
  ok(res, { loggedOut: true });
});

adminRouter.get('/auth/me', (req, res) => {
  const s = req.staff!;
  const permissions = [...new Set(s.user.staff_roles.flatMap((r) => STAFF_ROLE_PERMISSIONS[r] ?? []))];
  ok(res, {
    user: { id: s.user.id, email: s.user.email, firstName: s.user.first_name, lastName: s.user.last_name, emailVerified: true },
    roles: s.user.staff_roles, permissions, csrfToken: s.csrfToken,
  });
});

const mode = (req: any): 'test' | 'live' => (req.query.mode === 'test' ? 'test' : 'live');

// ------------------------------------------------------------------ overview
adminRouter.get('/overview', staffPerm('overview.view'), async (req, res) => {
  const m = mode(req);
  const [merchants, volume, pending, revenue, providers, series, openIssues, openRisk] = await Promise.all([
    one(pool, `SELECT count(*)::int AS total, count(*) FILTER (WHERE status='active' AND kyb_status='approved')::int AS active,
                      count(*) FILTER (WHERE kyb_status IN ('pending','under_review'))::int AS awaiting_review FROM organizations`),
    one(pool, `SELECT COALESCE(sum(amount) FILTER (WHERE status IN ('successful','partially_refunded','refunded')),0) AS total_volume,
                      COALESCE(sum(amount) FILTER (WHERE status IN ('successful','partially_refunded','refunded') AND paid_at >= date_trunc('day', now())),0) AS today_volume,
                      count(*) FILTER (WHERE status IN ('successful','partially_refunded','refunded'))::int AS successful,
                      count(*) FILTER (WHERE status IN ('failed','expired'))::int AS failed
                 FROM payments WHERE mode=$1`, [m]),
    one(pool, `SELECT count(*)::int AS n, COALESCE(sum(net_amount),0) AS amount FROM settlements WHERE mode=$1 AND status IN ('pending','processing')`, [m]),
    ledger.accountBalance(pool, 'fee_revenue', m, null),
    query(pool, `SELECT code, name, health_status, enabled, health_checked_at, health_latency_ms FROM payment_providers ORDER BY priority`),
    query(pool, `SELECT to_char(d.day,'YYYY-MM-DD') AS date, COALESCE(sum(p.amount) FILTER (WHERE p.status IN ('successful','partially_refunded','refunded')),0) AS volume,
                        count(p.id)::int AS total
                   FROM generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') d(day)
                   LEFT JOIN payments p ON p.mode=$1 AND date_trunc('day', p.created_at)=d.day GROUP BY d.day ORDER BY d.day`, [m]),
    one(pool, `SELECT count(*)::int AS n FROM reconciliation_issues WHERE status <> 'resolved'`),
    one(pool, `SELECT count(*)::int AS n FROM risk_events WHERE status='open'`),
  ]);
  ok(res, {
    merchants, volume, pendingSettlements: pending, platformRevenue: revenue, providers, series,
    activeProviders: providers.filter((p) => p.enabled).length, openReconciliationIssues: openIssues!.n, openRiskEvents: openRisk!.n,
  });
});

// ------------------------------------------------------------------ merchants
adminRouter.get('/merchants', staffPerm('merchants.view'), async (req, res) => {
  const { page, pageSize, offset } = pagination(req);
  const params: unknown[] = [];
  const where: string[] = [];
  if (req.query.search) { params.push(likeTerm(String(req.query.search))); where.push(`(lower(o.name) LIKE $${params.length} OR o.id::text = $${params.length})`); }
  if (req.query.kyb && (KYB_STATUSES as readonly string[]).includes(String(req.query.kyb))) { params.push(req.query.kyb); where.push(`o.kyb_status=$${params.length}`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await one(pool, `SELECT count(*)::int AS n FROM organizations o ${w}`, params))!.n;
  const rows = await query(pool, `
    SELECT o.*, (SELECT email FROM organization_members m WHERE m.organization_id=o.id AND m.role='owner' LIMIT 1) AS owner_email,
           (SELECT COALESCE(sum(amount),0) FROM payments p WHERE p.organization_id=o.id AND p.mode='live' AND p.status IN ('successful','partially_refunded','refunded')) AS live_volume
      FROM organizations o ${w} ORDER BY o.created_at DESC LIMIT ${pageSize} OFFSET ${offset}`, params);
  ok(res, { items: rows, total, page, pageSize });
});

adminRouter.get('/merchants/:id', staffPerm('merchants.view'), async (req, res) => {
  const id = String(req.params.id);
  const org = await one(pool, `SELECT * FROM organizations WHERE id=$1`, [id]);
  if (!org) throw Errors.notFound('Merchant');
  const [profile, members, banks, kyb, risk, fee, liveBal, testBal] = await Promise.all([
    one(pool, `SELECT * FROM business_profiles WHERE organization_id=$1`, [id]),
    query(pool, `SELECT m.email, m.role, m.status, u.first_name, u.last_name, u.email_verified_at FROM organization_members m LEFT JOIN users u ON u.id=m.user_id WHERE m.organization_id=$1`, [id]),
    query(pool, `SELECT id, bank_name, account_number_last4, account_name, is_default, status, created_at FROM bank_accounts WHERE organization_id=$1`, [id]),
    query(pool, `SELECT k.*, u.email AS reviewer_email FROM kyb_verifications k LEFT JOIN users u ON u.id=k.reviewed_by WHERE k.organization_id=$1 ORDER BY k.created_at DESC`, [id]),
    query(pool, `SELECT * FROM risk_events WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 20`, [id]),
    one(pool, `SELECT * FROM fees WHERE organization_id=$1 AND active`, [id]),
    ledger.merchantBalances(pool, id, 'live'),
    ledger.merchantBalances(pool, id, 'test'),
  ]);
  ok(res, { organization: org, profile, members, bankAccounts: banks, kybHistory: kyb, riskEvents: risk, feeOverride: fee, balances: { live: liveBal, test: testBal } });
});

adminRouter.post('/merchants/:id/kyb', staffPerm('merchants.kyb'), async (req, res) => {
  const { decision, reason } = parse(z.object({
    decision: z.enum(['under_review', 'approved', 'rejected', 'restricted']), reason: z.string().trim().max(1000).optional(),
  }), req.body);
  if (['rejected', 'restricted'].includes(decision) && !reason) throw Errors.validation([{ field: 'reason', message: 'A reason is required' }]);
  const id = String(req.params.id);
  await withTx(async (tx) => {
    const org = await one(tx, `SELECT * FROM organizations WHERE id=$1 FOR UPDATE`, [id]);
    if (!org) throw Errors.notFound('Merchant');
    if (org.kyb_status === 'not_started') throw new AppError('kyb_not_submitted', 'This merchant has not submitted verification.', 409);
    await tx.query(`UPDATE organizations SET kyb_status=$2, live_enabled=$3 WHERE id=$1`, [id, decision, decision === 'approved']);
    await tx.query(
      `UPDATE kyb_verifications SET status=$2, reviewed_by=$3, reviewed_at=now(), decision_reason=$4
        WHERE id=(SELECT id FROM kyb_verifications WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 1)`,
      [id, decision, req.staff!.user.id, reason ?? null],
    );
    if (decision === 'approved') await notifyOrg(tx, id, 'kyb.approved', 'Your business is verified', 'Live mode is now enabled. Generate live API keys to start accepting real payments.');
    if (decision === 'rejected') await notifyOrg(tx, id, 'kyb.rejected', 'Verification needs attention', `We could not approve your verification: ${reason}. Update your details and resubmit.`);
    await audit(tx, actorFrom(req), `kyb.${decision}`, { organizationId: id, targetType: 'organization', targetId: id, metadata: { reason, from: org.kyb_status } });
  });
  ok(res, { kybStatus: decision });
});

adminRouter.post('/merchants/:id/status', staffPerm('merchants.status'), async (req, res) => {
  const input = parse(z.object({
    status: z.enum(['active', 'suspended']).optional(), riskStatus: z.enum(RISK_STATUSES).optional(), reason: z.string().trim().min(3).max(1000),
  }), req.body);
  const id = String(req.params.id);
  await withTx(async (tx) => {
    const org = await one(tx, `SELECT * FROM organizations WHERE id=$1 FOR UPDATE`, [id]);
    if (!org) throw Errors.notFound('Merchant');
    await tx.query(`UPDATE organizations SET status=COALESCE($2,status), risk_status=COALESCE($3,risk_status) WHERE id=$1`, [id, input.status ?? null, input.riskStatus ?? null]);
    if (input.status === 'suspended') await tx.query(`UPDATE api_keys SET revoked_at=now() WHERE organization_id=$1 AND mode='live' AND revoked_at IS NULL`, [id]);
    await audit(tx, actorFrom(req), 'merchant.status_changed', { organizationId: id, targetType: 'organization', targetId: id, metadata: { ...input, previous: { status: org.status, riskStatus: org.risk_status } } });
  });
  ok(res, { updated: true });
});

adminRouter.put('/merchants/:id/settlement', staffPerm('settlements.manage'), async (req, res) => {
  const input = parse(z.object({ schedule: z.enum(['t0', 't1', 'manual']), dailyWithdrawalLimit: z.number().int().min(0) }), req.body);
  const id = String(req.params.id);
  await pool.query(`UPDATE organizations SET settlement_schedule=$2, daily_withdrawal_limit=$3 WHERE id=$1`, [id, input.schedule, input.dailyWithdrawalLimit]);
  await audit(pool, actorFrom(req), 'merchant.settlement_rules_changed', { organizationId: id, targetType: 'organization', targetId: id, metadata: input });
  ok(res, { updated: true });
});

// ------------------------------------------------------------------ transactions & links
adminRouter.get('/transactions', staffPerm('transactions.view'), async (req, res) => {
  const { page, pageSize, offset } = pagination(req);
  const params: unknown[] = [mode(req)];
  let where = 'p.mode=$1';
  if (req.query.status && (PAYMENT_STATUSES as readonly string[]).includes(String(req.query.status))) { params.push(req.query.status); where += ` AND p.status=$${params.length}`; }
  if (req.query.organizationId) { params.push(String(req.query.organizationId)); where += ` AND p.organization_id=$${params.length}::uuid`; }
  if (req.query.search) { params.push(likeTerm(String(req.query.search))); where += ` AND (lower(p.reference) LIKE $${params.length} OR c.email LIKE $${params.length})`; }
  const total = (await one(pool, `SELECT count(*)::int AS n FROM payments p LEFT JOIN customers c ON c.id=p.customer_id WHERE ${where}`, params))!.n;
  const rows = await query(pool, `SELECT x.*, o.name AS merchant_name FROM (${PAYMENT_LIST_SELECT} WHERE ${where} ORDER BY p.created_at DESC LIMIT ${pageSize} OFFSET ${offset}) x JOIN organizations o ON o.id=x.organization_id ORDER BY x.created_at DESC`, params);
  ok(res, { items: rows.map((r) => ({ ...rowToDTO(r), merchantName: r.merchant_name, organizationId: r.organization_id })), total, page, pageSize });
});

adminRouter.get('/transactions/:id', staffPerm('transactions.view'), async (req, res) => {
  const p = await one(pool, `${PAYMENT_LIST_SELECT} WHERE p.id=$1`, [req.params.id]);
  if (!p) throw Errors.notFound('Payment');
  const [timeline, entries, providerTxns, intent, org] = await Promise.all([
    paymentTimeline(pool, p.id),
    ledger.listEntriesFor(pool, 'payment', p.id),
    query(pool, `SELECT pt.*, pp.code AS provider_code FROM provider_transactions pt JOIN payment_providers pp ON pp.id=pt.provider_id WHERE pt.payment_id=$1`, [p.id]),
    one(pool, `SELECT i.*, pp.code AS provider_code FROM payment_intents i JOIN payment_providers pp ON pp.id=i.provider_id WHERE i.payment_id=$1 ORDER BY i.created_at DESC LIMIT 1`, [p.id]),
    one(pool, `SELECT id, name FROM organizations WHERE id=$1`, [p.organization_id]),
  ]);
  ok(res, { payment: rowToDTO(p), merchant: org, timeline, ledger: entries, providerTransactions: providerTxns, intent, createdIp: p.created_ip });
});

adminRouter.get('/payment-links', staffPerm('transactions.view'), async (req, res) => {
  const rows = await query(pool, `SELECT l.*, o.name AS merchant_name FROM payment_links l JOIN organizations o ON o.id=l.organization_id WHERE l.mode=$1 ORDER BY l.created_at DESC LIMIT 200`, [mode(req)]);
  ok(res, rows.map((l) => ({ ...linkDTO(l), merchantName: l.merchant_name })));
});

// ------------------------------------------------------------------ balances & ledger
adminRouter.get('/balances', staffPerm('balances.view'), async (req, res) => {
  const m = mode(req);
  const rows = await query(pool, `
    SELECT o.id, o.name, a.code,
           COALESCE(sum(e.amount) FILTER (WHERE e.direction='credit'),0) - COALESCE(sum(e.amount) FILTER (WHERE e.direction='debit'),0) AS balance
      FROM organizations o JOIN ledger_accounts a ON a.organization_id=o.id AND a.mode=$1 LEFT JOIN ledger_entries e ON e.account_id=a.id
     GROUP BY o.id, o.name, a.code ORDER BY o.name`, [m]);
  const byOrg = new Map<string, { id: string; name: string; available: number; pending: number }>();
  for (const r of rows) {
    const cur = byOrg.get(r.id) ?? { id: r.id, name: r.name, available: 0, pending: 0 };
    if (r.code === 'merchant_available') cur.available = r.balance;
    if (r.code === 'merchant_pending') cur.pending = r.balance;
    byOrg.set(r.id, cur);
  }
  const platform = await Promise.all((['provider_clearing', 'payout_clearing', 'fee_revenue', 'suspense'] as const).map(async (c) => ({ account: c, balance: await ledger.accountBalance(pool, c, m, null) })));
  ok(res, { merchants: [...byOrg.values()], platform, trialBalance: await ledger.trialBalance(pool, m) });
});

adminRouter.post('/ledger/adjustments', staffPerm('ledger.adjust'), async (req, res) => {
  const input = parse(z.object({
    organizationId: z.uuid(), mode: z.enum(['test', 'live']), account: z.enum(['merchant_available', 'merchant_pending']),
    direction: z.enum(['credit', 'debit']), amount: z.number().int().positive(), counterAccount: z.enum(['suspense', 'fee_revenue']),
    reason: z.string().trim().min(10).max(1000),
  }), req.body);
  const key = req.get('idempotency-key');
  if (!key) throw new AppError('idempotency_key_required', 'Adjustments require an Idempotency-Key header.', 400);
  const result = await withTx(async (tx) => {
    await ledger.lockMerchantBalance(tx, input.organizationId, input.mode);
    const posted = await ledger.post(tx, {
      mode: input.mode, organizationId: input.organizationId, kind: 'adjustment', description: `Manual adjustment: ${input.reason}`,
      referenceType: 'organization', referenceId: input.organizationId, idempotencyKey: `adjustment:${key}`, createdBy: `staff:${req.staff!.user.id}`,
      lines: [
        { account: input.account, direction: input.direction, amount: input.amount },
        { account: input.counterAccount, direction: input.direction === 'credit' ? 'debit' : 'credit', amount: input.amount },
      ],
    });
    await audit(tx, actorFrom(req), 'ledger.adjustment', { organizationId: input.organizationId, targetType: 'ledger_transaction', targetId: posted.id, metadata: input });
    return posted;
  });
  ok(res, result, 201);
});

// ------------------------------------------------------------------ settlements, withdrawals, refunds
adminRouter.get('/settlements', staffPerm('settlements.view'), async (req, res) => {
  const rows = await query(pool, `SELECT s.*, o.name AS merchant_name, b.bank_name, b.account_number_last4 FROM settlements s JOIN organizations o ON o.id=s.organization_id
    LEFT JOIN bank_accounts b ON b.id=s.bank_account_id WHERE s.mode=$1 ORDER BY s.created_at DESC LIMIT 200`, [mode(req)]);
  ok(res, rows.map((s) => ({ ...settlementDTO(s), merchantName: s.merchant_name, organizationId: s.organization_id })));
});
adminRouter.post('/settlements/run', staffPerm('settlements.manage'), async (req, res) => {
  const created = await runSettlements();
  await audit(pool, actorFrom(req), 'settlement.run_triggered', { metadata: { created } });
  ok(res, { created });
});

adminRouter.get('/withdrawals', staffPerm('withdrawals.view'), async (req, res) => {
  const rows = await query(pool, `SELECT w.*, o.name AS merchant_name, b.bank_name, b.account_number_last4, b.account_name FROM withdrawals w
    JOIN organizations o ON o.id=w.organization_id JOIN bank_accounts b ON b.id=w.bank_account_id WHERE w.mode=$1 ORDER BY w.created_at DESC LIMIT 200`, [mode(req)]);
  ok(res, rows.map((w) => ({ ...withdrawalDTO(w), merchantName: w.merchant_name, organizationId: w.organization_id })));
});
adminRouter.post('/withdrawals/:id/approve', staffPerm('withdrawals.manage'), async (req, res) => {
  await approveHeldWithdrawal(String(req.params.id), actorFrom(req));
  ok(res, { approved: true });
});
adminRouter.post('/withdrawals/:id/reject', staffPerm('withdrawals.manage'), async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(500) }), req.body);
  const w = await one(pool, `SELECT reference, status FROM withdrawals WHERE id=$1`, [req.params.id]);
  if (!w || w.status !== 'pending') throw new AppError('invalid_state', 'Only pending withdrawals can be rejected.', 409);
  await failWithdrawal(w.reference, `Rejected after review: ${reason}`, actorFrom(req));
  ok(res, { rejected: true });
});

adminRouter.get('/refunds', staffPerm('refunds.view'), async (req, res) => {
  const rows = await query(pool, `SELECT r.*, p.reference AS payment_reference, o.name AS merchant_name FROM refunds r JOIN payments p ON p.id=r.payment_id
    JOIN organizations o ON o.id=r.organization_id WHERE r.mode=$1 ORDER BY r.created_at DESC LIMIT 200`, [mode(req)]);
  const reversals = await query(pool, `SELECT pt.*, p.reference AS payment_reference FROM provider_transactions pt LEFT JOIN payments p ON p.id=pt.payment_id WHERE pt.kind='reversal' AND pt.mode=$1 ORDER BY pt.created_at DESC LIMIT 100`, [mode(req)]);
  ok(res, { refunds: rows.map((r) => ({ ...refundDTO(r), merchantName: r.merchant_name })), reversals });
});

// ------------------------------------------------------------------ providers
function providerDTO(p: any) {
  return {
    id: p.id, code: p.code, name: p.name, adapter: p.adapter, enabled: p.enabled, supportsTest: p.supports_test, supportsLive: p.supports_live,
    priority: p.priority, config: p.config, hasCredentials: !!p.credentials_encrypted, healthStatus: p.health_status,
    healthCheckedAt: p.health_checked_at, healthLatencyMs: p.health_latency_ms, updatedAt: p.updated_at,
  };
}
adminRouter.get('/providers', staffPerm('providers.view'), async (_req, res) => {
  const rows = await query(pool, `SELECT * FROM payment_providers ORDER BY priority`);
  ok(res, { providers: rows.map(providerDTO), adapters: Object.entries(ADAPTERS).map(([k, v]) => ({ adapter: k, label: v.label, credentialFields: v.credentialFields, configFields: v.configFields })) });
});

const providerInput = z.object({
  name: z.string().trim().min(2).max(80), enabled: z.boolean(), supportsLive: z.boolean(), priority: z.number().int().min(1).max(1000),
  config: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  /** Write-only. Omit to keep existing credentials. Never returned by any endpoint. */
  credentials: z.record(z.string(), z.string().min(1)).optional(),
});

adminRouter.post('/providers', staffPerm('providers.manage'), async (req, res) => {
  const input = parse(providerInput.extend({ code: z.string().regex(/^[a-z0-9_]{2,40}$/), adapter: z.enum(Object.keys(ADAPTERS) as [string, ...string[]]) }), req.body);
  if (input.adapter === 'sandbox' && input.supportsLive) throw Errors.validation([{ field: 'supportsLive', message: 'The sandbox can never process live payments' }]);
  const row = await one(pool, `INSERT INTO payment_providers (code, name, adapter, enabled, supports_live, priority, config, credentials_encrypted) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [input.code, input.name, input.adapter, input.enabled, input.supportsLive, input.priority, JSON.stringify(input.config), input.credentials ? encrypt(JSON.stringify(input.credentials)) : null]);
  await audit(pool, actorFrom(req), 'provider.created', { targetType: 'provider', targetId: row!.id, metadata: { code: input.code, adapter: input.adapter, credentialKeys: Object.keys(input.credentials ?? {}) } });
  ok(res, providerDTO(row), 201);
});

adminRouter.patch('/providers/:id', staffPerm('providers.manage'), async (req, res) => {
  const input = parse(providerInput.partial(), req.body);
  const existing = await one(pool, `SELECT * FROM payment_providers WHERE id=$1`, [req.params.id]);
  if (!existing) throw Errors.notFound('Provider');
  if (existing.adapter === 'sandbox' && input.supportsLive) throw Errors.validation([{ field: 'supportsLive', message: 'The sandbox can never process live payments' }]);
  const row = await one(pool, `UPDATE payment_providers SET name=COALESCE($2,name), enabled=COALESCE($3,enabled), supports_live=COALESCE($4,supports_live),
      priority=COALESCE($5,priority), config=COALESCE($6,config), credentials_encrypted=COALESCE($7,credentials_encrypted) WHERE id=$1 RETURNING *`,
    [req.params.id, input.name ?? null, input.enabled ?? null, input.supportsLive ?? null, input.priority ?? null, input.config ? JSON.stringify(input.config) : null,
      input.credentials ? encrypt(JSON.stringify(input.credentials)) : null]);
  await audit(pool, actorFrom(req), 'provider.updated', { targetType: 'provider', targetId: String(req.params.id), metadata: { ...input, credentials: input.credentials ? Object.keys(input.credentials) : undefined } });
  ok(res, providerDTO(row));
});

adminRouter.post('/providers/:id/health-check', staffPerm('providers.manage'), async (req, res) => {
  await checkProviderHealth(String(req.params.id));
  ok(res, providerDTO(await one(pool, `SELECT * FROM payment_providers WHERE id=$1`, [req.params.id])));
});

adminRouter.get('/providers/:id/logs', staffPerm('providers.view'), async (req, res) => {
  ok(res, await query(pool, `SELECT * FROM provider_logs WHERE provider_id=$1 ORDER BY created_at DESC LIMIT 100`, [req.params.id]));
});

// ------------------------------------------------------------------ fees
adminRouter.get('/fees', staffPerm('fees.manage'), async (_req, res) => {
  ok(res, await query(pool, `SELECT f.*, o.name AS merchant_name FROM fees f LEFT JOIN organizations o ON o.id=f.organization_id WHERE f.active ORDER BY f.organization_id NULLS FIRST`));
});
adminRouter.put('/fees', staffPerm('fees.manage'), async (req, res) => {
  const input = parse(feeScheduleSchema, req.body);
  if (input.maxFee !== null && input.maxFee < input.minFee) throw Errors.validation([{ field: 'maxFee', message: 'Maximum fee must be at least the minimum fee' }]);
  const row = await withTx(async (tx) => {
    const prev = await one(tx, `UPDATE fees SET active=false WHERE active AND organization_id IS NOT DISTINCT FROM $1 RETURNING *`, [input.organizationId]);
    const created = await one(tx, `INSERT INTO fees (organization_id, percentage_bps, fixed_fee, min_fee, max_fee, payout_fee, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [input.organizationId, input.percentageBps, input.fixedFee, input.minFee, input.maxFee, input.payoutFee, req.staff!.user.id]);
    await audit(tx, actorFrom(req), 'fees.updated', { organizationId: input.organizationId, targetType: 'fee_schedule', targetId: created!.id, metadata: { previous: prev, next: input } });
    return created;
  });
  ok(res, row);
});
adminRouter.delete('/fees/:organizationId', staffPerm('fees.manage'), async (req, res) => {
  await pool.query(`UPDATE fees SET active=false WHERE organization_id=$1 AND active`, [req.params.organizationId]);
  await audit(pool, actorFrom(req), 'fees.override_removed', { organizationId: String(req.params.organizationId) });
  ok(res, { removed: true });
});

// ------------------------------------------------------------------ reconciliation & risk
adminRouter.get('/reconciliation', staffPerm('reconciliation.view'), async (req, res) => {
  const status = String(req.query.status ?? '');
  const params: unknown[] = [];
  let where = '';
  if ((RECON_STATUSES as readonly string[]).includes(status)) { params.push(status); where = 'WHERE i.status=$1'; }
  const [issues, runs] = await Promise.all([
    query(pool, `SELECT i.*, o.name AS merchant_name, p.reference AS payment_reference, s.reference AS settlement_reference, u.email AS resolved_by_email
      FROM reconciliation_issues i LEFT JOIN organizations o ON o.id=i.organization_id LEFT JOIN payments p ON p.id=i.payment_id
      LEFT JOIN settlements s ON s.id=i.settlement_id LEFT JOIN users u ON u.id=i.resolved_by ${where} ORDER BY i.created_at DESC LIMIT 200`, params),
    query(pool, `SELECT * FROM reconciliation_runs ORDER BY started_at DESC LIMIT 10`),
  ]);
  ok(res, { issues, runs });
});
adminRouter.post('/reconciliation/run', staffPerm('reconciliation.manage'), async (req, res) => {
  const result = await runReconciliation(new Date(Date.now() - 7 * 86400_000), new Date());
  await audit(pool, actorFrom(req), 'reconciliation.run_triggered', { metadata: result });
  ok(res, result);
});
adminRouter.patch('/reconciliation/:id', staffPerm('reconciliation.manage'), async (req, res) => {
  const { status, note } = parse(z.object({ status: z.enum(RECON_STATUSES), note: z.string().trim().min(3).max(2000) }), req.body);
  ok(res, await updateIssueStatus(String(req.params.id), status, note, actorFrom(req)));
});

adminRouter.get('/risk', staffPerm('risk.view'), async (req, res) => {
  const rows = await query(pool, `SELECT r.*, o.name AS merchant_name, o.risk_status FROM risk_events r LEFT JOIN organizations o ON o.id=r.organization_id
    WHERE ($1 = '' OR r.status=$1) ORDER BY r.created_at DESC LIMIT 200`, [String(req.query.status ?? '')]);
  ok(res, rows);
});
adminRouter.patch('/risk/:id', staffPerm('risk.manage'), async (req, res) => {
  const { status, note } = parse(z.object({ status: z.enum(['reviewed', 'dismissed']), note: z.string().trim().min(3).max(1000) }), req.body);
  const r = await one(pool, `UPDATE risk_events SET status=$2, reviewed_by=$3, reviewed_at=now() WHERE id=$1 RETURNING *`, [req.params.id, status, req.staff!.user.id]);
  if (!r) throw Errors.notFound('Risk event');
  await audit(pool, actorFrom(req), 'risk.event_reviewed', { organizationId: r.organization_id, targetType: 'risk_event', targetId: r.id, metadata: { status, note } });
  ok(res, r);
});

// ------------------------------------------------------------------ logs
adminRouter.get('/logs/api', staffPerm('logs.view'), async (req, res) => {
  const { pageSize, offset } = pagination(req);
  ok(res, await query(pool, `SELECT l.id, l.request_id, l.method, l.path, l.status_code, l.latency_ms, l.ip, l.mode, l.created_at, o.name AS merchant_name
    FROM api_logs l LEFT JOIN organizations o ON o.id=l.organization_id ORDER BY l.created_at DESC LIMIT $1 OFFSET $2`, [pageSize, offset]));
});
adminRouter.get('/logs/webhooks', staffPerm('logs.view'), async (_req, res) => {
  const [inbound, outbound] = await Promise.all([
    query(pool, `SELECT id, provider_code, external_event_id, event_type, signature_valid, processing_status, retry_count, error_message, created_at, processed_at
      FROM webhook_events ORDER BY created_at DESC LIMIT 100`),
    query(pool, `SELECT d.id, d.event_id, d.event_type, d.url, d.status, d.attempt_count, d.last_response_status, d.last_response_time_ms, d.last_error, d.created_at, o.name AS merchant_name
      FROM webhook_deliveries d JOIN organizations o ON o.id=d.organization_id ORDER BY d.created_at DESC LIMIT 100`),
  ]);
  ok(res, { inbound, outbound });
});
adminRouter.get('/logs/webhooks/:id', staffPerm('logs.view'), async (req, res) => {
  const e = await one(pool, `SELECT * FROM webhook_events WHERE id=$1`, [req.params.id]);
  if (!e) throw Errors.notFound('Webhook event');
  ok(res, e);
});
adminRouter.get('/audit', staffPerm('audit.view'), async (req, res) => {
  const { pageSize, offset } = pagination(req);
  const params: unknown[] = [pageSize, offset];
  let where = '';
  if (req.query.action) { params.push(`${String(req.query.action)}%`); where = `WHERE a.action LIKE $3`; }
  ok(res, await query(pool, `SELECT a.*, o.name AS merchant_name, u.email AS actor_email FROM audit_logs a LEFT JOIN organizations o ON o.id=a.organization_id
    LEFT JOIN users u ON a.actor_type IN ('user','staff') AND u.id::text=a.actor_id ${where} ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`, params));
});
adminRouter.get('/jobs', staffPerm('logs.view'), async (_req, res) => {
  ok(res, await query(pool, `SELECT queue, status, count(*)::int AS n, max(last_error) AS sample_error FROM jobs WHERE created_at > now() - interval '7 days' GROUP BY queue, status ORDER BY queue`));
});

// ------------------------------------------------------------------ system settings & staff
adminRouter.get('/settings', staffPerm('settings.manage'), async (_req, res) => {
  ok(res, await query(pool, `SELECT key, value, updated_at FROM system_settings ORDER BY key`));
});
adminRouter.put('/settings/:key', staffPerm('settings.manage'), async (req, res) => {
  const key = String(req.params.key);
  if (!['maintenance_banner', 'checkout_support_url', 'signups_enabled'].includes(key)) throw Errors.notFound('Setting');
  const { value } = parse(z.object({ value: z.union([z.string().max(500), z.boolean()]) }), req.body);
  await pool.query(`INSERT INTO system_settings (key, value, updated_by) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [key, JSON.stringify(value), req.staff!.user.id]);
  await audit(pool, actorFrom(req), 'settings.updated', { metadata: { key, value } });
  ok(res, { key, value });
});
adminRouter.get('/staff', staffPerm('staff.manage'), async (_req, res) => {
  ok(res, await query(pool, `SELECT id, email, first_name, last_name, staff_roles, status, created_at FROM users WHERE is_staff ORDER BY created_at`));
});
adminRouter.post('/staff', staffPerm('staff.manage'), async (req, res) => {
  const input = parse(z.object({ email: z.email(), firstName: z.string().min(1), lastName: z.string().min(1), roles: z.array(z.enum(STAFF_ROLES)).min(1) }), req.body);
  const tempPassword = randomToken(12);
  const row = await one(pool, `INSERT INTO users (email, password_hash, first_name, last_name, is_staff, staff_roles, email_verified_at) VALUES ($1,$2,$3,$4,true,$5,now())
    ON CONFLICT (email) DO UPDATE SET is_staff=true, staff_roles=EXCLUDED.staff_roles RETURNING id`,
    [input.email.toLowerCase(), await hashPassword(tempPassword), input.firstName, input.lastName, input.roles]);
  await audit(pool, actorFrom(req), 'staff.created', { targetType: 'user', targetId: row!.id, metadata: { email: input.email, roles: input.roles } });
  await auth.forgotPassword(input.email.toLowerCase());
  ok(res, { id: row!.id, message: 'Staff user created. A password setup link was emailed.' }, 201);
});
adminRouter.patch('/staff/:id', staffPerm('staff.manage'), async (req, res) => {
  const input = parse(z.object({ roles: z.array(z.enum(STAFF_ROLES)), status: z.enum(['active', 'disabled']) }), req.body);
  if (req.params.id === req.staff!.user.id) throw new AppError('cannot_modify_self', 'You cannot change your own roles or status.', 409);
  await pool.query(`UPDATE users SET staff_roles=$2, status=$3, is_staff=$4 WHERE id=$1 AND is_staff`, [req.params.id, input.roles, input.status, input.roles.length > 0]);
  if (input.status === 'disabled') await pool.query(`UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, [req.params.id]);
  await audit(pool, actorFrom(req), 'staff.updated', { targetType: 'user', targetId: String(req.params.id), metadata: input });
  ok(res, { updated: true });
});
