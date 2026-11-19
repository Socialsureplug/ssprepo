import { pool, one } from '../../db/pool';
import { sha256 } from '../../lib/crypto';
import { logger } from '../../lib/logger';
import { audit } from '../../lib/audit';
import { enqueue } from '../../jobs/queue';
import { getProviderByCode, getProviderById } from '../../providers/registry';
import { SandboxProvider } from '../../providers/adapters/sandbox';
import { recordCollection, recordReversal } from '../payments/payments.service';
import { completeSettlement, failSettlement } from '../settlements/settlements.service';
import { completeWithdrawal, failWithdrawal } from '../withdrawals/withdrawals.service';
import { completeRefund, failRefund } from '../refunds/refunds.service';

export type IngestResult = { status: 'accepted' | 'duplicate' | 'invalid_signature' | 'unknown_provider' | 'malformed'; eventId?: string };

/**
 * Step 1 of the inbound pipeline (runs in the HTTP request):
 *   provider → endpoint → signature verification → idempotency check → store → enqueue
 * Processing happens asynchronously so we acknowledge providers quickly and can retry safely.
 */
export async function ingestProviderWebhook(code: string, rawBody: string, headers: Record<string, string | undefined>): Promise<IngestResult> {
  const found = await getProviderByCode(pool, code);
  if (!found) return { status: 'unknown_provider' };
  const { row, provider } = found;

  const signatureValid = provider.verifyWebhook(rawBody, headers);
  let parsed: { id?: string; event?: string } = {};
  try { parsed = JSON.parse(rawBody); } catch { /* stored as malformed below */ }
  const externalId = String(parsed.id ?? `body:${sha256(rawBody)}`);
  const eventType = String(parsed.event ?? 'unknown');
  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch { payload = { raw: rawBody.slice(0, 5000) }; }

  if (!signatureValid) {
    // Store a record for investigation but never process it. Unsigned events use a distinct id
    // so a forged request cannot "claim" the id of a future genuine event.
    await pool.query(
      `INSERT INTO webhook_events (provider_id, provider_code, external_event_id, event_type, payload, signature_valid, processing_status, error_message)
       VALUES ($1,$2,$3,$4,$5,false,'ignored','Invalid signature') ON CONFLICT DO NOTHING`,
      [row.id, code, `invalid:${sha256(rawBody)}`, eventType, JSON.stringify(payload)],
    );
    logger.warn({ provider: code }, 'Rejected provider webhook with invalid signature');
    return { status: 'invalid_signature' };
  }
  if (!parsed.id) return { status: 'malformed' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await one<{ id: string }>(
      client,
      `INSERT INTO webhook_events (provider_id, provider_code, external_event_id, event_type, payload, signature_valid)
       VALUES ($1,$2,$3,$4,$5,true) ON CONFLICT (provider_code, external_event_id) DO NOTHING RETURNING id`,
      [row.id, code, externalId, eventType, JSON.stringify(payload)],
    );
    if (inserted) await enqueue(client, 'provider_webhook.process', { eventId: inserted.id }, { dedupeKey: inserted.id });
    await client.query('COMMIT');
    return inserted ? { status: 'accepted', eventId: inserted.id } : { status: 'duplicate' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Step 2 (worker): event processing → transaction verification → payment/ledger update →
 * merchant webhook → audit. Every handler is idempotent, so retries are always safe.
 */
export async function processProviderWebhookJob(payload: { eventId?: string; sandboxDelivery?: { rawBody: string; headers: Record<string, string>; sandboxRef: string; failed: boolean } }) {
  if (payload.sandboxDelivery) {
    // The sandbox "provider" delivering a webhook to us after a payout/refund.
    const d = payload.sandboxDelivery;
    await SandboxProvider.finalize(d.sandboxRef, d.failed);
    await ingestProviderWebhook('sandbox', d.rawBody, d.headers);
    return;
  }
  const claimed = await one(
    pool,
    `UPDATE webhook_events SET processing_status='processing' WHERE id=$1 AND processing_status IN ('received','failed') RETURNING *`,
    [payload.eventId],
  );
  if (!claimed) return;
  try {
    const result = await handleEvent(claimed.provider_id, JSON.stringify(claimed.payload));
    await pool.query(`UPDATE webhook_events SET processing_status=$2, processed_at=now(), error_message=NULL WHERE id=$1`, [claimed.id, result === 'ignored' ? 'ignored' : 'processed']);
    await audit(pool, { type: 'provider', id: claimed.provider_code }, 'provider_webhook.processed', { targetType: 'webhook_event', targetId: claimed.id, metadata: { type: claimed.event_type, result } });
  } catch (err) {
    await pool.query(`UPDATE webhook_events SET processing_status='failed', retry_count=retry_count+1, error_message=$2 WHERE id=$1`, [claimed.id, (err as Error).message.slice(0, 1000)]);
    throw err;
  }
}

async function handleEvent(providerId: string, rawBody: string): Promise<string> {
  const { provider } = await getProviderById(pool, providerId);
  const event = provider.parseWebhook(rawBody);
  switch (event.type) {
    case 'collection.received': {
      // Never trust the webhook body alone: re-verify the transaction with the provider's API.
      const verified = await provider.verifyTransaction(event.transaction.providerReference);
      if (!verified || verified.status !== 'completed' || verified.amount !== event.transaction.amount) {
        throw new Error('Transaction could not be verified with provider');
      }
      return (await recordCollection(providerId, { ...event.transaction, payerName: verified.payerName ?? event.transaction.payerName })).outcome;
    }
    case 'collection.reversed':
      return (await recordReversal(providerId, event.transaction)).outcome;
    case 'transfer.completed':
    case 'transfer.failed': {
      const ok = event.type === 'transfer.completed';
      if (event.reference.startsWith('STL_')) {
        if (ok) await completeSettlement(event.reference, event.providerReference); else await failSettlement(event.reference, event.reason ?? 'Transfer failed');
      } else if (event.reference.startsWith('WDR_')) {
        if (ok) await completeWithdrawal(event.reference, event.providerReference); else await failWithdrawal(event.reference, event.reason ?? 'Transfer failed');
      } else {
        return 'ignored';
      }
      return ok ? 'transfer_completed' : 'transfer_failed';
    }
    case 'refund.completed':
      await completeRefund(event.reference, event.providerReference);
      return 'refund_completed';
    case 'refund.failed':
      await failRefund(event.reference, event.reason ?? 'Refund failed');
      return 'refund_failed';
    default:
      return 'ignored';
  }
}
