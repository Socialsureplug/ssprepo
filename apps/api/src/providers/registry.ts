import type { Mode } from '@app/shared';
import type { Db } from '../db/pool';
import { pool, one, query } from '../db/pool';
import { decrypt } from '../lib/crypto';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';
import type { PaymentProvider, ProviderContext } from './types';
import { SandboxProvider } from './adapters/sandbox';
import { HttpBankTransferProvider } from './adapters/http-bank-transfer';

/** Adapter catalogue. Register new provider adapters here. */
export const ADAPTERS: Record<string, { label: string; build: (ctx: ProviderContext) => PaymentProvider; credentialFields: string[]; configFields: string[] }> = {
  sandbox: { label: 'Sandbox (test mode only)', build: (c) => new SandboxProvider(c), credentialFields: ['webhookSecret'], configFields: [] },
  http_bank_transfer: {
    label: 'REST bank-transfer provider', build: (c) => new HttpBankTransferProvider(c),
    credentialFields: ['secretKey', 'webhookSecret'], configFields: ['baseUrl', 'signatureHeader', 'timeoutMs'],
  },
};

export interface ProviderRow {
  id: string; code: string; name: string; adapter: string; enabled: boolean; supports_test: boolean; supports_live: boolean;
  priority: number; credentials_encrypted: string | null; config: Record<string, unknown>; health_status: string;
}

export function buildProvider(row: ProviderRow): PaymentProvider {
  const def = ADAPTERS[row.adapter];
  if (!def) throw new Error(`Unknown provider adapter ${row.adapter}`);
  const credentials = row.credentials_encrypted ? JSON.parse(decrypt(row.credentials_encrypted)) : {};
  return def.build({ providerId: row.id, code: row.code, credentials, config: row.config ?? {} });
}

export async function getProviderById(db: Db, id: string): Promise<{ row: ProviderRow; provider: PaymentProvider }> {
  const row = await one<ProviderRow>(db, `SELECT * FROM payment_providers WHERE id=$1`, [id]);
  if (!row) throw Errors.notFound('Provider');
  return { row, provider: instrument(row, buildProvider(row)) };
}

export async function getProviderByCode(db: Db, code: string): Promise<{ row: ProviderRow; provider: PaymentProvider } | null> {
  const row = await one<ProviderRow>(db, `SELECT * FROM payment_providers WHERE code=$1`, [code]);
  if (!row) return null;
  return { row, provider: instrument(row, buildProvider(row)) };
}

/**
 * Select the provider for a new collection. Test mode always uses the sandbox; live mode uses the
 * highest-priority enabled live provider that is not marked unavailable. This is the hook for
 * multi-provider orchestration (routing rules, failover, cost-based selection).
 */
export async function selectCollectionProvider(db: Db, mode: Mode): Promise<{ row: ProviderRow; provider: PaymentProvider }> {
  const rows = await query<ProviderRow>(
    db,
    mode === 'test'
      ? `SELECT * FROM payment_providers WHERE enabled AND adapter='sandbox' ORDER BY priority LIMIT 1`
      : `SELECT * FROM payment_providers WHERE enabled AND supports_live AND adapter <> 'sandbox' AND health_status <> 'unavailable'
          ORDER BY CASE health_status WHEN 'operational' THEN 0 ELSE 1 END, priority LIMIT 1`,
  );
  if (!rows[0]) throw Errors.providerUnavailable();
  return { row: rows[0], provider: instrument(rows[0], buildProvider(rows[0])) };
}

/** Wrap every provider call with timing, structured provider logs and safe error mapping. */
function instrument(row: ProviderRow, provider: PaymentProvider): PaymentProvider {
  const sync = new Set(['verifyWebhook', 'parseWebhook', 'signedWebhook']);
  return new Proxy(provider, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function' || sync.has(String(prop)) || String(prop).startsWith('simulate')) return value?.bind?.(target) ?? value;
      return async (...args: unknown[]) => {
        const started = Date.now();
        try {
          const result = await value.apply(target, args);
          void logProviderCall(row.id, String(prop), true, Date.now() - started, args[0], result);
          return result;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          void logProviderCall(row.id, String(prop), false, Date.now() - started, args[0], null, message);
          logger.error({ provider: row.code, op: prop, err: message }, 'Provider call failed');
          throw Errors.providerUnavailable();
        }
      };
    },
  });
}

async function logProviderCall(providerId: string, operation: string, success: boolean, latency: number, req: unknown, res: unknown, error?: string) {
  try {
    await pool.query(
      `INSERT INTO provider_logs (provider_id, operation, success, latency_ms, request, response, error) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [providerId, operation, success, latency, JSON.stringify(redact(req)), JSON.stringify(redact(res)), error ?? null],
    );
  } catch (err) {
    logger.warn({ err }, 'Failed to write provider log');
  }
}

/** Remove account numbers and secrets from logged provider payloads. */
function redact(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.slice(0, 20).map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (/secret|password|token|key/i.test(k)) out[k] = '[REDACTED]';
    else if (/accountNumber|account_number|payerAccount/i.test(k) && typeof val === 'string') out[k] = `******${val.slice(-4)}`;
    else out[k] = val instanceof Date ? val.toISOString() : redact(val);
  }
  return out;
}
