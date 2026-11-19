import { config } from './config';
import { createApp } from './app';
import { migrate } from './db/migrate';
import { pool } from './db/pool';
import { logger } from './lib/logger';
import { createWorker, startScheduler } from './jobs/handlers';

async function main() {
  if (!config.isProd) await migrate(false);
  const app = createApp();
  const server = app.listen(config.PORT, () => logger.info(`API listening on :${config.PORT} (${config.NODE_ENV})`));

  // In development the worker runs in-process for convenience. In production run `npm run start:worker`
  // as a separate, horizontally scalable process.
  let stopWorker = () => {};
  if (!config.isProd && process.env.RUN_WORKER !== 'false') {
    const worker = createWorker(config.WORKER_POLL_MS);
    const stopScheduler = startScheduler();
    void worker.start();
    stopWorker = () => { worker.stop(); stopScheduler(); };
    logger.info('In-process worker started');
  }

  const shutdown = () => {
    logger.info('Shutting down');
    stopWorker();
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
