import os from 'node:os';
import type { Db } from '../db/pool';
import { pool, one } from '../db/pool';
import { logger } from '../lib/logger';

/**
 * Postgres-backed job queue (transactional outbox). Enqueue with the same transaction handle
 * as the business change so a job exists if and only if the change committed.
 */
export type QueueName =
  | 'provider_webhook.process'
  | 'merchant_webhook.deliver'
  | 'notification.send'
  | 'payment.expire_due'
  | 'settlement.run'
  | 'settlement.process'
  | 'withdrawal.process'
  | 'refund.process'
  | 'reconciliation.run'
  | 'provider.health_check';

export interface EnqueueOptions { runAt?: Date; delayMs?: number; maxAttempts?: number; dedupeKey?: string; }

export async function enqueue(db: Db, queue: QueueName, payload: Record<string, unknown>, opts: EnqueueOptions = {}): Promise<void> {
  const runAt = opts.runAt ?? new Date(Date.now() + (opts.delayMs ?? 0));
  await db.query(
    `INSERT INTO jobs (queue, payload, run_at, max_attempts, dedupe_key) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (queue, dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('pending','running') DO NOTHING`,
    [queue, JSON.stringify(payload), runAt, opts.maxAttempts ?? 8, opts.dedupeKey ?? null],
  );
}

export type JobHandler = (payload: any, job: { id: number; attempts: number }) => Promise<void>;

/** Exponential backoff with jitter: 10s, 20s, 40s ... capped at 6h. */
export function backoffMs(attempt: number): number {
  const base = Math.min(10_000 * 2 ** (attempt - 1), 6 * 60 * 60 * 1000);
  return base + Math.floor(Math.random() * 1000);
}

export class Worker {
  private running = false;
  private readonly id = `${os.hostname()}:${process.pid}`;

  constructor(private readonly handlers: Partial<Record<QueueName, JobHandler>>, private readonly pollMs = 1000) {}

  /** Claim and run one job. Returns false when the queue is empty. */
  async runOnce(queues?: QueueName[]): Promise<boolean> {
    const names = queues ?? (Object.keys(this.handlers) as QueueName[]);
    const job = await one<{ id: number; queue: QueueName; payload: any; attempts: number; max_attempts: number }>(
      pool,
      `UPDATE jobs SET status='running', locked_at=now(), locked_by=$2, attempts=attempts+1
       WHERE id = (SELECT id FROM jobs WHERE status='pending' AND run_at <= now() AND queue = ANY($1)
                   ORDER BY run_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
       RETURNING id, queue, payload, attempts, max_attempts`,
      [names, this.id],
    );
    if (!job) return false;
    const handler = this.handlers[job.queue];
    try {
      if (!handler) throw new Error(`No handler for ${job.queue}`);
      await handler(job.payload, { id: job.id, attempts: job.attempts });
      await pool.query(`UPDATE jobs SET status='completed', completed_at=now(), locked_at=NULL WHERE id=$1`, [job.id]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const final = job.attempts >= job.max_attempts;
      logger.warn({ jobId: job.id, queue: job.queue, attempt: job.attempts, err: message }, 'Job failed');
      await pool.query(
        `UPDATE jobs SET status=$2, last_error=$3, locked_at=NULL, run_at=$4 WHERE id=$1`,
        [job.id, final ? 'failed' : 'pending', message.slice(0, 2000), new Date(Date.now() + backoffMs(job.attempts))],
      );
    }
    return true;
  }

  /** Drain all runnable jobs (used by tests and the sandbox). */
  async drain(queues?: QueueName[], max = 500): Promise<number> {
    let n = 0;
    while (n < max && (await this.runOnce(queues))) n++;
    return n;
  }

  async start(): Promise<void> {
    this.running = true;
    // Recover jobs left 'running' by a crashed worker.
    await pool.query(`UPDATE jobs SET status='pending', locked_at=NULL WHERE status='running' AND locked_at < now() - interval '10 minutes'`);
    while (this.running) {
      try {
        const worked = await this.runOnce();
        if (!worked) await new Promise((r) => setTimeout(r, this.pollMs));
      } catch (err) {
        logger.error({ err }, 'Worker loop error');
        await new Promise((r) => setTimeout(r, this.pollMs * 5));
      }
    }
  }

  stop(): void { this.running = false; }
}
