import { pool, one, query } from '../db/pool';
import { logger } from '../lib/logger';
import { buildProvider, type ProviderRow } from '../providers/registry';
import { Worker, enqueue, type JobHandler, type QueueName } from './queue';
import { processProviderWebhookJob } from '../modules/webhooks/provider-webhooks.service';
import { deliverWebhookJob } from '../modules/webhooks/merchant-webhooks.service';
import { sendNotificationJob } from '../modules/notifications/notifications.service';
import { expirePayment, expireDuePayments } from '../modules/payments/payments.service';
import { runSettlements, processSettlementJob } from '../modules/settlements/settlements.service';
import { processWithdrawalJob } from '../modules/withdrawals/withdrawals.service';
import { processRefundJob } from '../modules/refunds/refunds.service';
import { runReconciliation } from '../modules/reconciliation/reconciliation.service';

/** Health status: operational (<2s), degraded (slow), unavailable (error). */
export async function checkProviderHealth(providerId: string) {
  const row = await one<ProviderRow>(pool, `SELECT * FROM payment_providers WHERE id=$1`, [providerId]);
  if (!row) return;
  const started = Date.now();
  let status: 'operational' | 'degraded' | 'unavailable' = 'operational';
  try {
    await buildProvider(row).healthCheck();
    if (Date.now() - started > 2000) status = 'degraded';
  } catch (err) {
    status = 'unavailable';
    logger.warn({ provider: row.code, err: (err as Error).message }, 'Provider health check failed');
  }
  await pool.query(`UPDATE payment_providers SET health_status=$2, health_checked_at=now(), health_latency_ms=$3 WHERE id=$1`, [providerId, status, Date.now() - started]);
}

export const handlers: Partial<Record<QueueName, JobHandler>> = {
  'provider_webhook.process': processProviderWebhookJob,
  'merchant_webhook.deliver': deliverWebhookJob,
  'notification.send': sendNotificationJob,
  'payment.expire_due': async (p) => { if (p.paymentId) await expirePayment(p.paymentId); else await expireDuePayments(); },
  'settlement.run': async () => { await runSettlements(); },
  'settlement.process': processSettlementJob,
  'withdrawal.process': processWithdrawalJob,
  'refund.process': processRefundJob,
  'reconciliation.run': async () => { await runReconciliation(new Date(Date.now() - 2 * 86400_000), new Date()); },
  'provider.health_check': async () => {
    const rows = await query<{ id: string }>(pool, `SELECT id FROM payment_providers WHERE enabled`);
    for (const r of rows) await checkProviderHealth(r.id);
  },
};

export function createWorker(pollMs?: number) {
  return new Worker(handlers, pollMs);
}

/**
 * Periodic jobs. Each uses a dedupe key so that running several worker instances never
 * schedules duplicates. Intervals are deliberately conservative.
 */
const SCHEDULE: { queue: QueueName; everyMs: number }[] = [
  { queue: 'payment.expire_due', everyMs: 5 * 60_000 },
  { queue: 'settlement.run', everyMs: 15 * 60_000 },
  { queue: 'reconciliation.run', everyMs: 60 * 60_000 },
  { queue: 'provider.health_check', everyMs: 60_000 },
];

export function startScheduler(): () => void {
  const timers = SCHEDULE.map(({ queue, everyMs }) => {
    const tick = () => {
      const slot = Math.floor(Date.now() / everyMs);
      enqueue(pool, queue, {}, { dedupeKey: `cron:${slot}`, maxAttempts: 3 }).catch((err) => logger.error({ err, queue }, 'scheduler enqueue failed'));
    };
    tick();
    return setInterval(tick, Math.min(everyMs, 60_000));
  });
  return () => timers.forEach(clearInterval);
}
