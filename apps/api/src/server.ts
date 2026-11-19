import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { config } from './config';
import { createApp } from './app';
import { migrate } from './db/migrate';
import { pool } from './db/pool';
import { logger } from './lib/logger';
import { createWorker, startScheduler } from './jobs/handlers';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Single-service mode (SERVE_STATIC=true): one origin serves the API under /api, the merchant
 * web app at / and the admin app at /admin. Keeps session cookies first-party on hosts where
 * separate subdomains are different sites (e.g. *.onrender.com).
 */
function createSingleServiceApp() {
  const root = express();
  root.disable('x-powered-by');
  root.set('trust proxy', config.TRUST_PROXY);
  root.use('/api', createApp());

  const staticHeaders = helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'data:'], connectSrc: ["'self'"], frameAncestors: ["'none'"], formAction: ["'self'", 'mailto:'],
      },
    },
    strictTransportSecurity: config.isProd ? { maxAge: 63072000, includeSubDomains: true } : false,
  });
  root.use(staticHeaders);

  const mountSpa = (urlPath: string, dir: string) => {
    if (!fs.existsSync(path.join(dir, 'index.html'))) {
      logger.warn({ dir }, 'Static build missing; run the web/admin builds first');
      return;
    }
    root.use(urlPath, express.static(dir, { index: false, maxAge: '1h', setHeaders: (res, p) => {
      if (p.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } }));
    root.get(`${urlPath === '/' ? '' : urlPath}/{*splat}`, (_req, res) => res.sendFile(path.join(dir, 'index.html')));
    if (urlPath !== '/') root.get(urlPath, (_req, res) => res.sendFile(path.join(dir, 'index.html')));
  };
  mountSpa('/admin', path.join(repoRoot, 'apps/admin/dist'));
  mountSpa('/', path.join(repoRoot, 'apps/web/dist'));
  return root;
}

async function main() {
  if (!config.isProd) await migrate(false);
  const serveStatic = process.env.SERVE_STATIC === 'true';
  const app = serveStatic ? createSingleServiceApp() : createApp();
  const server = app.listen(config.PORT, () => logger.info(`API listening on :${config.PORT} (${config.NODE_ENV}${serveStatic ? ', serving web + admin' : ''})`));

  // The worker runs in-process in development, or in production when RUN_WORKER=true (small
  // deployments). Larger deployments run `npm run start:worker` as separate processes.
  let stopWorker = () => {};
  const runWorker = config.isProd ? process.env.RUN_WORKER === 'true' : process.env.RUN_WORKER !== 'false';
  if (runWorker) {
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
