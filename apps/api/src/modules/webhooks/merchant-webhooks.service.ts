import dns from 'node:dns/promises';
import net from 'node:net';
import type { Mode, WebhookEventType } from '@app/shared';
import { config } from '../../config';
import type { Db } from '../../db/pool';
import { pool, one } from '../../db/pool';
import { decrypt, hmacSha256Hex, randomToken, encrypt } from '../../lib/crypto';
import { refs } from '../../lib/ids';
import { enqueue, backoffMs } from '../../jobs/queue';
import { notifyOrg } from '../notifications/notifications.service';

export const SIGNATURE_HEADER = `X-${config.BRAND_NAME}-Signature`;
export const MAX_DELIVERY_ATTEMPTS = 8;

export function generateWebhookSecret() {
  const secret = `whsec_${randomToken(24)}`;
  return { secret, encrypted: encrypt(secret), last4: secret.slice(-4) };
}

/**
 * Signature scheme (documented for merchants):
 *   header  X-<Brand>-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
 * Merchants must recompute the HMAC over the raw body and reject timestamps older than 5 minutes.
 */
export function signPayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)) {
  return `t=${timestamp},v1=${hmacSha256Hex(secret, `${timestamp}.${body}`)}`;
}

/**
 * Emit a merchant-facing event. Called inside the business transaction, so a delivery is
 * recorded exactly when the underlying change commits.
 */
export async function emitEvent(db: Db, organizationId: string, mode: Mode, type: WebhookEventType, data: Record<string, unknown>) {
  const hook = await one<{ id: string; url: string; events: string[]; enabled: boolean }>(
    db, `SELECT id, url, events, enabled FROM merchant_webhooks WHERE organization_id=$1 AND mode=$2`, [organizationId, mode],
  );
  if (!hook || !hook.enabled || !hook.events.includes(type)) return;
  const eventId = refs.event();
  const payload = { id: eventId, type, mode, created_at: new Date().toISOString(), data };
  const row = await one<{ id: string }>(
    db,
    `INSERT INTO webhook_deliveries (merchant_webhook_id, organization_id, mode, event_id, event_type, url, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [hook.id, organizationId, mode, eventId, type, hook.url, JSON.stringify(payload)],
  );
  await enqueue(db, 'merchant_webhook.deliver', { deliveryId: row!.id }, { maxAttempts: 1, dedupeKey: row!.id });
}

/** Block deliveries to private / loopback / link-local networks (SSRF protection). */
export async function assertPublicUrl(url: string): Promise<void> {
  const u = new URL(url);
  if (config.WEBHOOK_ALLOW_PRIVATE_URLS) return;
  if (u.protocol !== 'https:') throw new Error('Webhook URL must use HTTPS');
  const addrs = net.isIP(u.hostname) ? [u.hostname] : (await dns.lookup(u.hostname, { all: true })).map((a) => a.address);
  for (const a of addrs) {
    if (isPrivateAddress(a)) throw new Error('Webhook URL resolves to a private network address');
  }
}

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l.startsWith('::ffff:')) return isPrivateAddress(l.slice(7));
    return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** Deliver one webhook attempt; schedule a retry with exponential backoff on failure. */
export async function deliverWebhookJob(payload: { deliveryId: string }) {
  const d = await one(
    pool,
    `SELECT d.*, w.secret_encrypted, w.enabled FROM webhook_deliveries d JOIN merchant_webhooks w ON w.id=d.merchant_webhook_id WHERE d.id=$1`,
    [payload.deliveryId],
  );
  if (!d || d.status === 'succeeded') return;
  const body = JSON.stringify(d.payload);
  const secret = decrypt(d.secret_encrypted);
  const attempt = d.attempt_count + 1;
  const started = Date.now();
  let status: number | null = null;
  let responseBody = '';
  let error: string | null = null;
  try {
    await assertPublicUrl(d.url);
    const res = await fetch(d.url, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `${config.BRAND_NAME}-Webhooks/1.0`,
        [SIGNATURE_HEADER]: signPayload(secret, body),
        'X-Event-Id': d.event_id,
        'X-Event-Type': d.event_type,
        'X-Delivery-Attempt': String(attempt),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
    responseBody = (await res.text()).slice(0, 2000);
  } catch (err) {
    error = (err as Error).message;
  }
  const elapsed = Date.now() - started;
  const ok = status !== null && status >= 200 && status < 300;
  const final = !ok && attempt >= MAX_DELIVERY_ATTEMPTS;
  const nextAt = ok || final ? null : new Date(Date.now() + backoffMs(attempt));
  await pool.query(
    `UPDATE webhook_deliveries SET status=$2, attempt_count=$3, last_response_status=$4, last_response_time_ms=$5,
       last_response_body=$6, last_error=$7, next_attempt_at=$8, delivered_at=CASE WHEN $9 THEN now() ELSE delivered_at END WHERE id=$1`,
    [d.id, ok ? 'succeeded' : final ? 'failed' : 'retrying', attempt, status, elapsed, responseBody, error ?? (ok ? null : `HTTP ${status}`), nextAt, ok],
  );
  if (nextAt) await enqueue(pool, 'merchant_webhook.deliver', { deliveryId: d.id }, { runAt: nextAt, maxAttempts: 1 });
  if (final) {
    await notifyOrg(pool, d.organization_id, 'webhook.failure', 'Webhook delivery failed',
      `We could not deliver ${d.event_type} (${d.event_id}) to ${d.url} after ${attempt} attempts. You can retry it from Developers → Webhooks.`,
      { deliveryId: d.id });
  }
}

export async function retryDelivery(db: Db, organizationId: string, deliveryId: string) {
  const d = await one(db, `UPDATE webhook_deliveries SET status='pending', next_attempt_at=now() WHERE id=$1 AND organization_id=$2 RETURNING id`, [deliveryId, organizationId]);
  if (!d) return false;
  await enqueue(db, 'merchant_webhook.deliver', { deliveryId }, { maxAttempts: 1 });
  return true;
}
