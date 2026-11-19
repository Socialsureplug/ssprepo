import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { checkoutFromLinkSchema, type CheckoutDTO } from '@app/shared';
import { config } from '../../config';
import { pool, one } from '../../db/pool';
import { AppError, Errors } from '../../lib/errors';
import { parse, ok, clientIp } from '../helpers';
import { publicLimiter } from '../middleware';
import { syncWithProvider } from '../../modules/payments/payments.service';
import { getPublicLink, startLinkCheckout } from '../../modules/payment-links/payment-links.service';
import { getProviderByCode } from '../../providers/registry';
import { SandboxProvider } from '../../providers/adapters/sandbox';
import { ingestProviderWebhook } from '../../modules/webhooks/provider-webhooks.service';

/**
 * Public, unauthenticated checkout API used by the hosted payment page.
 * Exposes only what a paying customer needs; never fees, merchant internals or other payments.
 * The customer can never change a payment's status: they can only ask us to re-check with the provider.
 */
export const checkoutRouter = Router();
checkoutRouter.use(publicLimiter);

const verifyLimiter = rateLimit({ windowMs: 60_000, limit: config.isTest ? 1000 : 12, standardHeaders: 'draft-8', legacyHeaders: false });

async function loadCheckout(reference: string): Promise<CheckoutDTO> {
  if (!/^PAY_[A-Z0-9]{12}$/.test(reference)) throw Errors.notFound('Payment');
  const p = await one(
    pool,
    `SELECT p.reference, p.status, p.amount, p.currency, p.description, p.expires_at, p.mode, c.email AS customer_email, o.name AS merchant_name,
            l.success_redirect_url, l.cancel_redirect_url
       FROM payments p JOIN organizations o ON o.id=p.organization_id LEFT JOIN customers c ON c.id=p.customer_id
       LEFT JOIN payment_links l ON l.id=p.payment_link_id
      WHERE p.reference=$1`,
    [reference],
  );
  if (!p) throw Errors.notFound('Payment');
  const open = ['created', 'pending', 'processing'].includes(p.status) && new Date(p.expires_at) > new Date();
  const intent = open
    ? await one(pool, `SELECT i.bank_name, i.account_name, i.account_number FROM payment_intents i JOIN payments p ON p.id=i.payment_id
        WHERE p.reference=$1 AND i.status='active' ORDER BY i.created_at DESC LIMIT 1`, [reference])
    : null;
  return {
    reference: p.reference, status: p.status, amount: p.amount, currency: p.currency, merchantName: p.merchant_name, description: p.description,
    customerEmail: p.customer_email ? maskEmail(p.customer_email) : null, expiresAt: new Date(p.expires_at).toISOString(), mode: p.mode,
    account: intent ? { bankName: intent.bank_name, accountName: intent.account_name, accountNumber: intent.account_number } : null,
    successRedirectUrl: p.success_redirect_url, cancelRedirectUrl: p.cancel_redirect_url, supportEmail: config.SUPPORT_EMAIL,
  };
}

function maskEmail(email: string) {
  const [u, d] = email.split('@');
  return `${u.slice(0, 2)}${'•'.repeat(Math.max(1, u.length - 2))}@${d}`;
}

checkoutRouter.get('/links/:slug', async (req, res) => {
  ok(res, await getPublicLink(String(req.params.slug)));
});

checkoutRouter.post('/links/:slug', async (req, res) => {
  const input = parse(checkoutFromLinkSchema, req.body);
  const p = await startLinkCheckout(String(req.params.slug), input, clientIp(req));
  ok(res, { reference: p.reference }, 201);
});

checkoutRouter.get('/:reference', async (req, res) => {
  ok(res, await loadCheckout(String(req.params.reference)));
});

/** "I've sent the money" — re-check with the provider (fallback for delayed webhooks). */
checkoutRouter.post('/:reference/verify', verifyLimiter, async (req, res) => {
  const reference = String(req.params.reference);
  const p = await one(pool, `SELECT id, status FROM payments WHERE reference=$1`, [reference]);
  if (!p) throw Errors.notFound('Payment');
  if (['created', 'pending', 'processing'].includes(p.status)) {
    try { await syncWithProvider(p.id); } catch { /* provider hiccup: status stays pending, customer can retry */ }
  }
  ok(res, await loadCheckout(reference));
});

/**
 * TEST MODE ONLY: simulate the customer's bank transfer through the sandbox provider. The
 * simulated transfer arrives as a signed provider webhook and runs the full production pipeline.
 */
checkoutRouter.post('/:reference/simulate-transfer', async (req, res) => {
  const { amount } = parse(z.object({ amount: z.number().int().positive().optional() }), req.body ?? {});
  const reference = String(req.params.reference);
  const p = await one(pool, `SELECT p.id, p.mode, p.amount, i.account_number FROM payments p JOIN payment_intents i ON i.payment_id=p.id AND i.status='active' WHERE p.reference=$1`, [reference]);
  if (!p) throw Errors.notFound('Payment');
  if (p.mode !== 'test') throw new AppError('test_mode_only', 'Simulated transfers are only available for test-mode payments.', 403);
  const sandbox = await getProviderByCode(pool, 'sandbox');
  if (!sandbox) throw Errors.providerUnavailable();
  const sbx = (sandbox.provider as unknown as SandboxProvider);
  const { rawBody, headers } = await sbx.simulateTransfer(p.account_number, amount ?? p.amount);
  await ingestProviderWebhook('sandbox', rawBody, headers);
  ok(res, { simulated: true });
});
