import { config } from './config';
import { pool } from './db/pool';
import { logger } from './lib/logger';
import { createWorker, startScheduler } from './jobs/handlers';

/** Standalone background worker: webhooks, notifications, settlements, reconciliation, retries. */
const worker = createWorker(config.WORKER_POLL_MS);
const stopScheduler = startScheduler();
logger.info('Worker started');
void worker.start();

const shutdown = () => {
  worker.stop();
  stopScheduler();
  setTimeout(() => pool.end().then(() => process.exit(0)), 1000);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
