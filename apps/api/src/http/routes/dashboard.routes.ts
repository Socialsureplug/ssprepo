import { Router } from 'express';
import { z } from 'zod';
import {
  createPaymentSchema, paymentLinkSchema, customerSchema, refundSchema, withdrawalSchema, PAYMENT_STATUSES,
} from '@app/shared';
import { pool, one, query } from '../../db/pool';
import { AppError, Errors } from '../../lib/errors';
import { parse, ok, pagination, actorFrom, clientIp, likeTerm } from '../helpers';
import { requireMerchant, can, dashboardLimiter } from '../middleware';
import * as payments from '../../modules/payments/payments.service';
import { rowToDTO, PAYMENT_LIST_SELECT } from '../../modules/payments/payments.repo';
import * as ledger from '../../modules/ledger/ledger.service';
import * as links from '../../modules/payment-links/payment-links.service';
import * as customers from '../../modules/customers/customers.service';
import * as refunds from '../../modules/refunds/refunds.service';
import * as withdrawals from '../../modules/withdrawals/withdrawals.service';
import { settlementDTO } from '../../modules/settlements/settlements.service';
import { getFeeSchedule } from '../../modules/fees/fees.service';

export const dashboardRouter = Router();
dashboardRouter.use(dashboardLimiter, requireMerchant);

const orgOf = (req: any) => ({ orgId: req.session.org.id as string, mode: req.session.mode as 'test' | 'live' });

function requireIdempotencyKey(req: any): string {
  const key = req.get('idempotency-key');
  if (!key || !/^[A-Za-z0-9_\-:.]{8,128}$/.test(key)) throw new AppError('idempotency_key_required', 'An Idempotency-Key header is required for this operation.', 400);
  return key;
}

// ------------------------------------------------------------------ overview
dashboardRouter.get('/overview', can('payments.view'), async (req, res) => {
  const { orgId, mode } = orgOf(req);
  const [balances, totals, series] = await Promise.all([
    ledger.merchantBalances(pool, orgId, mode),
    one(pool, `
      SELECT COALESCE(sum(amount) FILTER (WHERE status IN ('successful','partially_refunded','refunded')),0) AS total_processed,
             COALESCE(sum(amount) FILTER (WHERE status IN ('successful','partially_refunded','refunded') AND paid_at >= date_trunc('day', now())),0) AS today_volume,
             count(*) FILTER (WHERE status IN ('successful','partially_refunded','refunded') AND created_at > now() - interval '30 days')::int AS successful_30d,
             count(*) FILTER (WHERE status IN ('failed','expired') AND created_at > now() - interval '30 days')::int AS failed_30d,
             count(*) FILTER (WHERE status = 'pending')::int AS awaiting_payment,
             COALESCE(sum(fee) FILTER (WHERE status IN ('successful','partially_refunded','refunded') AND paid_at > now() - interval '30 days'),0) AS fees_30d
        FROM payments WHERE organization_id=$1 AND mode=$2`, [orgId, mode]),
    query(pool, `
      SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
             COALESCE(sum(p.amount) FILTER (WHERE p.status IN ('successful','partially_refunded','refunded')),0) AS volume,
             COALESCE(sum(p.fee) FILTER (WHERE p.status IN ('successful','partially_refunded','refunded')),0) AS fees,
             count(p.id) FILTER (WHERE p.status IN ('successful','partially_refunded','refunded'))::int AS successful,
             count(p.id) FILTER (WHERE p.status IN ('failed','expired'))::int AS failed,
             count(p.id)::int AS total
        FROM generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') AS d(day)
        LEFT JOIN payments p ON p.organization_id=$1 AND p.mode=$2 AND date_trunc('day', p.created_at) = d.day
       GROUP BY d.day ORDER BY d.day`, [orgId, mode]),
  ]);
  const recent = await query(pool, `${PAYMENT_LIST_SELECT} WHERE p.organization_id=$1 AND p.mode=$2 ORDER BY p.created_at DESC LIMIT 8`, [orgId, mode]);
  ok(res, {
    balances,
    totals: {
      totalProcessed: totals.total_processed, todayVolume: totals.today_volume, successful30d: totals.successful_30d,
      failed30d: totals.failed_30d, awaitingPayment: totals.awaiting_payment, fees30d: totals.fees_30d,
    },
    series: series.map((s) => ({ ...s, successRate: s.successful + s.failed > 0 ? s.successful / (s.successful + s.failed) : null })),
    recentPayments: recent.map((r) => rowToDTO(r)),
  });
});

// ------------------------------------------------------------------ payments
dashboardRouter.get('/payments', can('payments.view'), async (req, res) => {
  const { orgId, mode } = orgOf(req);
  const { page, pageSize, offset } = pagination(req);
  const params: unknown[] = [orgId, mode];
  let where = 'p.organization_id=$1 AND p.mode=$2';
  const status = String(req.query.status ?? '');
  if (status && (PAYMENT_STATUSES as readonly string[]).includes(status)) { params.push(status); where += ` AND p.status=$${params.length}`; }
  if (req.query.search) {
    params.push(likeTerm(String(req.query.search)));
    where += ` AND (lower(p.reference) LIKE $${params.length} OR lower(p.merchant_reference) LIKE $${params.length} OR c.email LIKE $${params.length})`;
  }
  if (req.query.customerId) { params.push(String(req.query.customerId)); where += ` AND p.customer_id=$${params.length}::uuid`; }
  if (req.query.linkId) { params.push(String(req.query.linkId)); where += ` AND p.payment_link_id=$${params.length}::uuid`; }
  if (req.query.from) { params.push(new Date(String(req.query.from))); where += ` AND p.created_at >= $${params.length}`; }
  if (req.query.to) { params.push(new Date(String(req.query.to))); where += ` AND p.created_at <= $${params.length}`; }
  const total = (await one(pool, `SELECT count(*)::int AS n FROM payments p LEFT JOIN customers c ON c.id=p.customer_id WHERE ${where}`, params))!.n;
  const rows = await query(pool, `${PAYMENT_LIST_SELECT} WHERE ${where} ORDER BY p.created_at DESC LIMIT ${pageSize} OFFSET ${offset}`, params);
  ok(res, { items: rows.map((r) => rowToDTO(r)), total, page, pageSize });
});

dashboardRouter.post('/payments', can('payments.create'), async (req, res) => {
  const { orgId, mode } = orgOf(req);
  const input = parse(createPaymentSchema, req.body);
  const p = await payments.createPayment(orgId, mode, input, { actor: actorFrom(req), ip: clientIp(req) });
  ok(res, rowToDTO(p as any, await one(pool, `SELECT id, email, name FROM customers WHERE id=$1`, [p.customer_id])), 201);
});

dashboardRouter.get('/payments/:id', can('payments.view'), async (req, res) => {
  const { orgId, mode } = orgOf(req);
  const p = await payments.getPaymentForOrg(pool, orgId, mode, String(req.params.id));
  const [customer, timeline, intent, entries, refundRows, providerTxns] = await Promise.all([
    p.customer_id ? one(pool, `SELECT id, email, name FROM customers WHERE id=$1`, [p.customer_id]) : null,
    payments.paymentTimeline(pool, p.id),
    one(pool, `SELECT bank_name, account_name, account_number, expires_at, status FROM payment_intents WHERE payment_id=$1 ORDER BY created_at DESC LIMIT 1`, [p.id]),
    ledger.listEntriesFor(pool, 'payment', p.id),
    query(pool, `SELECT * FROM refunds WHERE payment_id=$1 ORDER BY created_at DESC`, [p.id]),
    query(pool, `SELECT kind, amount, payer_name, payer_bank, match_status, occurred_at FROM provider_transactions WHERE payment_id=$1 ORDER BY occurred_at`, [p.id]),
  ]);
  ok(res, {
    payment: rowToDTO(p, customer), timeline, collectionAccount: intent, metadata: p.metadata,
    ledger: entries.filter((e) => e.organization_id === orgId || e.account !== 'suspense').map(({ organization_id: _o, ...e }) => e),
    refunds: refundRows.map((r) => refunds.refundDTO(r)), providerTransactions: providerTxns,
  });
});

dashboardRouter.post('/payments/:id/refunds', can('payments.refund'), async (req, res) => {
  const { orgId, mode } = orgOf(req);
  const body = parse(refundSchema.omit({ payment: true }), req.body);
  const r = await refunds.createRefund(orgId, mode, { payment: String(req.params.id), ...body }, { actor: actorFrom(req), idempotencyKey: requireIdempotencyKey(req) });
  ok(res, refunds.refundDTO(r), 201);
});

dashboardRouter.post('/payments/:id/sync', can('payments.view'), async (req, res) => {
  const { orgId, mode } = orgOf(req);
  const p = await payments.getPaymentForOrg(pool, orgId, mode, String(req.params.id));
  await payments.syncWithProvider(p.id);
  const fresh = await payments.getPaymentForOrg(pool, orgId, mode, p.id);
  ok(res, rowToDTO(fresh));
});

// ------------------------------------------------------------------ payment links
dashboardRouter.get('/payment-links', can('payments.view'), async (req, res) => {
  const { orgId, mode } = orgOf(req);
  const { page, pageSize } = pagination(req);
  ok(res, await links.listLinks(orgId, mode, page, pageSize));
});
dashboardRouter.post('/payment-links', can('links.manage'), async (req, res) => {
  const { orgId, mode } = orgOf(req);
  ok(res, await links.createLink(orgId, mode, parse(paymentLinkSchema, req.body), actorFrom(req)), 201);
});
dashboardRouter.get('/payment-links/:id', can('payments.view'), async (req, res) => {
  const { orgId, mode } = orgOf(req);
  ok(res, await links.getLink(orgId, mode, String(req.params.id)));
});
dashboardRouter.patch('/payment-links/:id', can('links.manage'), async (req, res) => {
  const { orgId, mode } = orgOf(req);
  const input = parse(paymentLinkSchema.partial().extend({ status: z.enum(['active', 'disabled']).optional() }), req.body);
  ok(res, await links.updateLink(orgId, mode, String(req.params.id), input, actorFrom(req)));
});

// ------------------------------------------------------------------ customers
dashboardRouter.get('/customers', can('payments.view'), async (req, res) => {
  const { orgId, mode } = orgOf(req);
  const { page, pageSize } = pagination(req);
  ok(res, await customers.listCustomers(pool, orgId, mode, { search: req.query.search ? String(req.query.search) : undefined, page, pageSize }));
});
dashboardRouter.post('/customers', can('customers.manage'), async (req, res) => {
  const { orgId, mode } = orgOf(req);
  const c = await customers.upsertCustomer(pool, orgId, mode, parse(customerSchema, req.body));
  ok(res, await customers.getCustomer(pool, orgId, mode, c.id), 201);
});
dashboardRouter.get('/customers/:id', can('payments.view'), async (req, res) => {
  const { orgId, mode } = orgOf(req);
  ok(res, await customers.getCustomer(pool, orgId, mode, String(req.params.id)));
});

// ------------------------------------------------------------------ balance, settlements, withdrawals
dashboardRouter.get('/balance', can('balance.view'), async (req, res) => {
  const { orgId, mode } = orgOf(req);
  const [balances, schedule, entries] = await Promise.all([
    ledger.merchantBalances(pool, orgId, mode),
    getFeeSchedule(pool, orgId),
    query(pool, `
      SELECT t.id, t.kind, t.description, t.created_at, a.code AS account, e.direction, e.amount
        FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id=t.id JOIN ledger_accounts a ON a.id=e.account_id
       WHERE a.organization_id=$1 AND a.mode=$2 ORDER BY t.created_at DESC LIMIT 50`, [orgId, mode]),
  ]);
  const org = req.session!.org!;
  ok(res, { ...balances, payoutFee: schedule.payout_fee, settlementSchedule: org.settlement_schedule, dailyWithdrawalLimit: org.daily_withdrawal_limit, activity: entries });
});

dashboardRouter.get('/settlements', can('balance.view'), async (req, res) => {
  const { orgId, mode } = orgOf(req);
  const { page, pageSize, offset } = pagination(req);
  const total = (await one(pool, `SELECT count(*)::int AS n FROM settlements WHERE organization_id=$1 AND mode=$2`, [orgId, mode]))!.n;
  const rows = await query(pool, `SELECT s.*, b.bank_name, b.account_number_last4 FROM settlements s LEFT JOIN bank_accounts b ON b.id=s.bank_account_id
    WHERE s.organization_id=$1 AND s.mode=$2 ORDER BY s.created_at DESC LIMIT $3 OFFSET $4`, [orgId, mode, pageSize, offset]);
  ok(res, { items: rows.map(settlementDTO), total, page, pageSize });
});

dashboardRouter.get('/settlements/:id', can('balance.view'), async (req, res) => {
  const { orgId, mode } = orgOf(req);
  const s = await one(pool, `SELECT s.*, b.bank_name, b.account_number_last4 FROM settlements s LEFT JOIN bank_accounts b ON b.id=s.bank_account_id WHERE s.id=$1 AND s.organization_id=$2 AND s.mode=$3`, [req.params.id, orgId, mode]);
  if (!s) throw Errors.notFound('Settlement');
  const items = await query(pool, `SELECT i.*, p.reference FROM settlement_items i JOIN payments p ON p.id=i.payment_id WHERE i.settlement_id=$1 ORDER BY i.created_at`, [s.id]);
  ok(res, { ...settlementDTO(s), items: items.map((i) => ({ paymentId: i.payment_id, reference: i.reference, grossAmount: i.gross_amount, feeAmount: i.fee_amount, netAmount: i.net_amount })) });
});

dashboardRouter.get('/withdrawals', can('balance.view'), async (req, res) => {
  const { orgId, mode } = orgOf(req);
  const { page, pageSize, offset } = pagination(req);
  const total = (await one(pool, `SELECT count(*)::int AS n FROM withdrawals WHERE organization_id=$1 AND mode=$2`, [orgId, mode]))!.n;
  const rows = await query(pool, `SELECT w.*, b.bank_name, b.account_number_last4, b.account_name FROM withdrawals w JOIN bank_accounts b ON b.id=w.bank_account_id
    WHERE w.organization_id=$1 AND w.mode=$2 ORDER BY w.created_at DESC LIMIT $3 OFFSET $4`, [orgId, mode, pageSize, offset]);
  ok(res, { items: rows.map(withdrawals.withdrawalDTO), total, page, pageSize });
});

dashboardRouter.post('/withdrawals/quote', can('withdrawals.create'), async (req, res) => {
  const { amount } = parse(z.object({ amount: z.number().int().positive() }), req.body);
  ok(res, await withdrawals.quoteWithdrawal(orgOf(req).orgId, amount));
});

dashboardRouter.post('/withdrawals', can('withdrawals.create'), async (req, res) => {
  const { orgId, mode } = orgOf(req);
  const input = parse(withdrawalSchema, req.body);
  const w = await withdrawals.createWithdrawal(orgId, mode, input, { actor: actorFrom(req), idempotencyKey: requireIdempotencyKey(req), ip: clientIp(req) });
  ok(res, withdrawals.withdrawalDTO(w), 201);
});

dashboardRouter.get('/refunds', can('payments.view'), async (req, res) => {
  const { orgId, mode } = orgOf(req);
  const rows = await query(pool, `SELECT r.*, p.reference AS payment_reference FROM refunds r JOIN payments p ON p.id=r.payment_id WHERE r.organization_id=$1 AND r.mode=$2 ORDER BY r.created_at DESC LIMIT 100`, [orgId, mode]);
  ok(res, rows.map(refunds.refundDTO));
});

// ------------------------------------------------------------------ notifications & search
dashboardRouter.get('/notifications', async (req, res) => {
  const rows = await query(pool, `SELECT id, type, title, body, data, read_at, created_at FROM notifications WHERE organization_id=$1 AND channel='in_app' ORDER BY created_at DESC LIMIT 30`, [orgOf(req).orgId]);
  const unread = rows.filter((r) => !r.read_at).length;
  ok(res, { items: rows, unread });
});
dashboardRouter.post('/notifications/read', async (req, res) => {
  await pool.query(`UPDATE notifications SET read_at=now() WHERE organization_id=$1 AND channel='in_app' AND read_at IS NULL`, [orgOf(req).orgId]);
  ok(res, { read: true });
});

dashboardRouter.get('/search', can('payments.view'), async (req, res) => {
  const { orgId, mode } = orgOf(req);
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return ok(res, { payments: [], customers: [] });
  const term = likeTerm(q);
  const [ps, cs] = await Promise.all([
    query(pool, `${PAYMENT_LIST_SELECT} WHERE p.organization_id=$1 AND p.mode=$2 AND (lower(p.reference) LIKE $3 OR lower(p.merchant_reference) LIKE $3 OR c.email LIKE $3) ORDER BY p.created_at DESC LIMIT 6`, [orgId, mode, term]),
    query(pool, `SELECT id, email, name FROM customers WHERE organization_id=$1 AND mode=$2 AND (email LIKE $3 OR lower(name) LIKE $3) LIMIT 5`, [orgId, mode, term]),
  ]);
  ok(res, { payments: ps.map((r) => rowToDTO(r)), customers: cs });
});
