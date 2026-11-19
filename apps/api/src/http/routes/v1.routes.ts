import { Router } from 'express';
import { createPaymentSchema, paymentLinkSchema, customerSchema, refundSchema, PAYMENT_STATUSES } from '@app/shared';
import { pool, one, query } from '../../db/pool';
import { AppError, Errors } from '../../lib/errors';
import { parse, ok, pagination, actorFrom, clientIp } from '../helpers';
import { requireApiKey, idempotency, apiLogger, apiLimiter } from '../middleware';
import * as payments from '../../modules/payments/payments.service';
import { rowToDTO, PAYMENT_LIST_SELECT } from '../../modules/payments/payments.repo';
import * as links from '../../modules/payment-links/payment-links.service';
import * as customers from '../../modules/customers/customers.service';
import * as refunds from '../../modules/refunds/refunds.service';
import * as ledger from '../../modules/ledger/ledger.service';
import { settlementDTO } from '../../modules/settlements/settlements.service';
import { sendTestEvent } from './settings.routes';

/**
 * Public REST API (v1). Authenticated with secret keys; every request is logged with a
 * request id; POSTs support Idempotency-Key. Test and live data are fully separated by key.
 */
export const v1Router = Router();
v1Router.use(apiLogger, requireApiKey, apiLimiter, idempotency);

const ctx = (req: any) => ({ orgId: req.apiKey.org.id as string, mode: req.apiKey.mode as 'test' | 'live' });

v1Router.post('/payments', async (req, res) => {
  const { orgId, mode } = ctx(req);
  const input = parse(createPaymentSchema, req.body);
  const p = await payments.createPayment(orgId, mode, input, { actor: actorFrom(req), ip: clientIp(req) });
  const dto = rowToDTO(p as any, await one(pool, `SELECT id, email, name FROM customers WHERE id=$1`, [p.customer_id]));
  const intent = await one(pool, `SELECT bank_name, account_name, account_number, expires_at FROM payment_intents WHERE payment_id=$1 AND status='active'`, [p.id]);
  res.status(201).json({
    status: 'success', reference: dto.reference, checkout_url: dto.checkoutUrl, amount: dto.amount, currency: dto.currency,
    data: {
      ...dto,
      bankTransfer: intent && { bankName: intent.bank_name, accountName: intent.account_name, accountNumber: intent.account_number, expiresAt: intent.expires_at },
    },
  });
});

v1Router.get('/payments', async (req, res) => {
  const { orgId, mode } = ctx(req);
  const { page, pageSize, offset } = pagination(req);
  const params: unknown[] = [orgId, mode];
  let where = 'p.organization_id=$1 AND p.mode=$2';
  const status = String(req.query.status ?? '');
  if (status) {
    if (!(PAYMENT_STATUSES as readonly string[]).includes(status)) throw Errors.validation([{ field: 'status', message: 'Unknown status' }]);
    params.push(status); where += ` AND p.status=$3`;
  }
  const total = (await one(pool, `SELECT count(*)::int AS n FROM payments p WHERE ${where}`, params))!.n;
  const rows = await query(pool, `${PAYMENT_LIST_SELECT} WHERE ${where} ORDER BY p.created_at DESC LIMIT ${pageSize} OFFSET ${offset}`, params);
  ok(res, { items: rows.map((r) => rowToDTO(r)), total, page, pageSize });
});

v1Router.get('/payments/:id', async (req, res) => {
  const { orgId, mode } = ctx(req);
  const p = await payments.getPaymentForOrg(pool, orgId, mode, String(req.params.id));
  ok(res, rowToDTO(p, p.customer_id ? await one(pool, `SELECT id, email, name FROM customers WHERE id=$1`, [p.customer_id]) : null));
});

/** Explicit server-side verification: re-checks the provider before answering. */
v1Router.get('/payments/:id/verify', async (req, res) => {
  const { orgId, mode } = ctx(req);
  const p = await payments.getPaymentForOrg(pool, orgId, mode, String(req.params.id));
  if (['created', 'pending', 'processing'].includes(p.status)) await payments.syncWithProvider(p.id);
  const fresh = await payments.getPaymentForOrg(pool, orgId, mode, p.id);
  ok(res, rowToDTO(fresh, fresh.customer_id ? await one(pool, `SELECT id, email, name FROM customers WHERE id=$1`, [fresh.customer_id]) : null));
});

v1Router.post('/payment-links', async (req, res) => {
  const { orgId, mode } = ctx(req);
  ok(res, await links.createLink(orgId, mode, parse(paymentLinkSchema, req.body), actorFrom(req)), 201);
});

v1Router.get('/payment-links/:id', async (req, res) => {
  const { orgId, mode } = ctx(req);
  ok(res, await links.getLink(orgId, mode, String(req.params.id)));
});

v1Router.post('/refunds', async (req, res) => {
  const { orgId, mode } = ctx(req);
  const key = req.get('idempotency-key');
  if (!key) throw new AppError('idempotency_key_required', 'Refunds require an Idempotency-Key header.', 400);
  const r = await refunds.createRefund(orgId, mode, parse(refundSchema, req.body), { actor: actorFrom(req), idempotencyKey: key });
  ok(res, refunds.refundDTO(r), 201);
});

v1Router.get('/customers', async (req, res) => {
  const { orgId, mode } = ctx(req);
  const { page, pageSize } = pagination(req);
  ok(res, await customers.listCustomers(pool, orgId, mode, { search: req.query.email ? String(req.query.email) : undefined, page, pageSize }));
});

v1Router.post('/customers', async (req, res) => {
  const { orgId, mode } = ctx(req);
  const c = await customers.upsertCustomer(pool, orgId, mode, parse(customerSchema, req.body));
  ok(res, await customers.getCustomer(pool, orgId, mode, c.id), 201);
});

v1Router.get('/balance', async (req, res) => {
  const { orgId, mode } = ctx(req);
  ok(res, await ledger.merchantBalances(pool, orgId, mode));
});

v1Router.get('/settlements', async (req, res) => {
  const { orgId, mode } = ctx(req);
  const { page, pageSize, offset } = pagination(req);
  const rows = await query(pool, `SELECT * FROM settlements WHERE organization_id=$1 AND mode=$2 ORDER BY created_at DESC LIMIT $3 OFFSET $4`, [orgId, mode, pageSize, offset]);
  ok(res, { items: rows.map(settlementDTO), page, pageSize });
});

v1Router.post('/webhooks/test', async (req, res) => {
  const { orgId, mode } = ctx(req);
  await sendTestEvent(orgId, mode);
  ok(res, { queued: true });
});
