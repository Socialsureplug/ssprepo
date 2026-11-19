import type { z } from 'zod';
import type { Mode, paymentLinkSchema } from '@app/shared';
import { config } from '../../config';
import { pool, one, query, withTx } from '../../db/pool';
import { AppError, Errors } from '../../lib/errors';
import { refs } from '../../lib/ids';
import { audit, type Actor } from '../../lib/audit';
import { createPayment } from '../payments/payments.service';

type LinkInput = z.infer<typeof paymentLinkSchema>;

export function linkUrl(slug: string) {
  return `${config.WEB_URL}/l/${slug}`;
}

const LINK_STATS = `
  SELECT l.*,
         count(p.id) FILTER (WHERE p.status IN ('successful','partially_refunded','refunded'))::int AS payments_count,
         COALESCE(sum(p.amount) FILTER (WHERE p.status IN ('successful','partially_refunded','refunded')),0) AS total_collected
    FROM payment_links l LEFT JOIN payment_link_payments lp ON lp.payment_link_id=l.id LEFT JOIN payments p ON p.id=lp.payment_id`;

export function linkDTO(l: any) {
  const expired = l.expires_at && new Date(l.expires_at) < new Date();
  return {
    id: l.id, slug: l.slug, url: linkUrl(l.slug), title: l.title, amount: l.amount, currency: l.currency, description: l.description,
    customerEmail: l.customer_email, reference: l.reference, successRedirectUrl: l.success_redirect_url, cancelRedirectUrl: l.cancel_redirect_url,
    expiresAt: l.expires_at, status: l.status === 'active' && expired ? 'expired' : l.status, createdAt: l.created_at, mode: l.mode,
    paymentsCount: l.payments_count ?? 0, totalCollected: Number(l.total_collected ?? 0),
  };
}

export async function createLink(organizationId: string, mode: Mode, input: LinkInput, actor: Actor) {
  return withTx(async (tx) => {
    const l = await one(
      tx,
      `INSERT INTO payment_links (organization_id, mode, slug, title, amount, currency, description, customer_email, reference,
                                  success_redirect_url, cancel_redirect_url, expires_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [organizationId, mode, refs.linkSlug(), input.title, input.amount, input.currency, input.description || null, input.customerEmail || null,
        input.reference || null, input.successRedirectUrl || null, input.cancelRedirectUrl || null, input.expiresAt ?? null, actor.id],
    );
    await audit(tx, actor, 'payment_link.created', { organizationId, targetType: 'payment_link', targetId: l!.id });
    return linkDTO(l);
  });
}

export async function updateLink(organizationId: string, mode: Mode, id: string, input: Partial<LinkInput> & { status?: 'active' | 'disabled' }, actor: Actor) {
  return withTx(async (tx) => {
    const l = await one(tx, `SELECT * FROM payment_links WHERE id=$1 AND organization_id=$2 AND mode=$3 FOR UPDATE`, [id, organizationId, mode]);
    if (!l) throw Errors.notFound('Payment link');
    const merged = {
      title: input.title ?? l.title, amount: input.amount !== undefined ? input.amount : l.amount, description: input.description ?? l.description,
      customer_email: input.customerEmail ?? l.customer_email, reference: input.reference ?? l.reference,
      success_redirect_url: input.successRedirectUrl ?? l.success_redirect_url, cancel_redirect_url: input.cancelRedirectUrl ?? l.cancel_redirect_url,
      expires_at: input.expiresAt !== undefined ? input.expiresAt : l.expires_at, status: input.status ?? l.status,
    };
    const updated = await one(
      tx,
      `UPDATE payment_links SET title=$2, amount=$3, description=$4, customer_email=$5, reference=$6, success_redirect_url=$7,
              cancel_redirect_url=$8, expires_at=$9, status=$10 WHERE id=$1 RETURNING *`,
      [id, merged.title, merged.amount, merged.description || null, merged.customer_email || null, merged.reference || null,
        merged.success_redirect_url || null, merged.cancel_redirect_url || null, merged.expires_at, merged.status],
    );
    await audit(tx, actor, input.status === 'disabled' ? 'payment_link.disabled' : 'payment_link.updated', { organizationId, targetType: 'payment_link', targetId: id });
    return linkDTO(updated);
  });
}

export async function listLinks(organizationId: string, mode: Mode, page: number, pageSize: number) {
  const total = (await one<{ n: number }>(pool, `SELECT count(*)::int AS n FROM payment_links WHERE organization_id=$1 AND mode=$2`, [organizationId, mode]))!.n;
  const rows = await query(pool, `${LINK_STATS} WHERE l.organization_id=$1 AND l.mode=$2 GROUP BY l.id ORDER BY l.created_at DESC LIMIT $3 OFFSET $4`, [organizationId, mode, pageSize, (page - 1) * pageSize]);
  return { items: rows.map(linkDTO), total, page, pageSize };
}

export async function getLink(organizationId: string, mode: Mode, id: string) {
  const l = await one(pool, `${LINK_STATS} WHERE l.id=$1 AND l.organization_id=$2 AND l.mode=$3 GROUP BY l.id`, [id, organizationId, mode]);
  if (!l) throw Errors.notFound('Payment link');
  return linkDTO(l);
}

/** Public: what the customer sees before paying. */
export async function getPublicLink(slug: string) {
  const l = await one(pool, `SELECT l.*, o.name AS merchant_name, o.status AS org_status FROM payment_links l JOIN organizations o ON o.id=l.organization_id WHERE l.slug=$1`, [slug]);
  if (!l) throw Errors.notFound('Payment link');
  const expired = l.expires_at && new Date(l.expires_at) < new Date();
  return {
    slug: l.slug, title: l.title, amount: l.amount, currency: l.currency, description: l.description, merchantName: l.merchant_name,
    customerEmail: l.customer_email, mode: l.mode, cancelRedirectUrl: l.cancel_redirect_url,
    available: l.status === 'active' && !expired && l.org_status === 'active',
    unavailableReason: l.status !== 'active' ? 'disabled' : expired ? 'expired' : l.org_status !== 'active' ? 'merchant_unavailable' : null,
  };
}

/** Public: start a checkout from a link. The amount comes from the link unless the link is open-amount. */
export async function startLinkCheckout(slug: string, input: { email: string; name?: string; amount?: number }, ip: string) {
  const l = await one(pool, `SELECT * FROM payment_links WHERE slug=$1`, [slug]);
  if (!l) throw Errors.notFound('Payment link');
  if (l.status !== 'active' || (l.expires_at && new Date(l.expires_at) < new Date())) {
    throw new AppError('link_unavailable', 'This payment link is no longer accepting payments.', 410);
  }
  const amount = l.amount ?? input.amount;
  if (!amount) throw Errors.validation([{ field: 'amount', message: 'Enter an amount' }]);
  return createPayment(l.organization_id, l.mode, {
    amount, currency: 'NGN', email: l.customer_email || input.email, name: input.name, description: l.description || l.title,
    expiresInMinutes: 30, metadata: { payment_link: l.slug, ...(l.reference ? { link_reference: l.reference } : {}) },
  }, { actor: { type: 'system', id: 'checkout', ip }, ip, paymentLinkId: l.id });
}
