import pg from 'pg';
import { config } from '../config';
import { logger } from '../lib/logger';

// Return BIGINT (int8) as JS numbers. Safe: amounts are bounded well below 2^53 kobo.
pg.types.setTypeParser(20, (v) => Number(v));
// Return NUMERIC aggregates (SUM of bigint) as numbers.
pg.types.setTypeParser(1700, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: config.isTest ? 5 : 20,
  idleTimeoutMillis: 30_000,
  statement_timeout: 15_000,
});

pool.on('error', (err) => logger.error({ err }, 'Postgres pool error'));

export type Db = pg.Pool | pg.PoolClient;
export type Tx = pg.PoolClient;

export async function query<T extends pg.QueryResultRow = any>(db: Db, text: string, params: unknown[] = []): Promise<T[]> {
  const res = await db.query<T>(text, params);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = any>(db: Db, text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(db, text, params);
  return rows[0] ?? null;
}

/**
 * Run a function inside a transaction. Financial operations always go through here so that
 * state changes, ledger entries, outbox jobs and audit logs commit or roll back together.
 */
export async function withTx<T>(fn: (tx: Tx) => Promise<T>, opts: { isolation?: 'serializable' | 'repeatable read' } = {}): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(opts.isolation ? `BEGIN ISOLATION LEVEL ${opts.isolation.toUpperCase()}` : 'BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
