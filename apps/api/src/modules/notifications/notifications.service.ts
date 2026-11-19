import type { Db } from '../../db/pool';
import { pool, one, query } from '../../db/pool';
import { enqueue } from '../../jobs/queue';
import { emailProvider } from './email';
import { config } from '../../config';

export type NotificationType =
  | 'payment.successful' | 'payment.failed' | 'payment.expired' | 'settlement.completed' | 'settlement.failed'
  | 'withdrawal.initiated' | 'withdrawal.completed' | 'withdrawal.failed' | 'kyb.approved' | 'kyb.rejected'
  | 'security.alert' | 'api_key.created' | 'webhook.failure' | 'refund.completed';

/** Types that are worth an email to the business (others are in-app only to avoid noise). */
const EMAIL_TYPES = new Set<NotificationType>([
  'settlement.completed', 'settlement.failed', 'withdrawal.initiated', 'withdrawal.completed', 'withdrawal.failed',
  'kyb.approved', 'kyb.rejected', 'security.alert', 'api_key.created', 'webhook.failure',
]);

/**
 * Record a notification for an organization. Writes the in-app item and, for important types,
 * queues an email to owners/admins. Business logic never talks to the email provider directly.
 */
export async function notifyOrg(db: Db, organizationId: string, type: NotificationType, title: string, body: string, data: Record<string, unknown> = {}) {
  await db.query(
    `INSERT INTO notifications (organization_id, type, channel, title, body, data, status) VALUES ($1,$2,'in_app',$3,$4,$5,'sent')`,
    [organizationId, type, title, body, JSON.stringify(data)],
  );
  if (!EMAIL_TYPES.has(type)) return;
  const recipients = await query<{ email: string; user_id: string }>(
    db,
    `SELECT u.email, u.id AS user_id FROM organization_members m JOIN users u ON u.id=m.user_id
      WHERE m.organization_id=$1 AND m.status='active' AND m.role IN ('owner','admin')`,
    [organizationId],
  );
  for (const r of recipients) await queueEmail(db, { organizationId, userId: r.user_id, type, to: r.email, title, body, data });
}

export async function queueEmail(db: Db, n: { organizationId?: string | null; userId?: string | null; type: string; to: string; title: string; body: string; data?: Record<string, unknown> }) {
  const row = await one<{ id: string }>(
    db,
    `INSERT INTO notifications (organization_id, user_id, type, channel, recipient, title, body, data) VALUES ($1,$2,$3,'email',$4,$5,$6,$7) RETURNING id`,
    [n.organizationId ?? null, n.userId ?? null, n.type, n.to, n.title, n.body, JSON.stringify(n.data ?? {})],
  );
  await enqueue(db, 'notification.send', { notificationId: row!.id }, { maxAttempts: 5 });
}

export async function sendNotificationJob(payload: { notificationId: string }) {
  const n = await one(pool, `SELECT * FROM notifications WHERE id=$1`, [payload.notificationId]);
  if (!n || n.status === 'sent') return;
  try {
    await emailProvider().send({ to: n.recipient, subject: `${n.title} — ${config.BRAND_NAME}`, text: n.body });
    await pool.query(`UPDATE notifications SET status='sent', sent_at=now(), error=NULL WHERE id=$1`, [n.id]);
  } catch (err) {
    await pool.query(`UPDATE notifications SET error=$2 WHERE id=$1`, [n.id, (err as Error).message]);
    throw err;
  }
}
