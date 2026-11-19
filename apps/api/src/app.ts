import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import './http/types';
import { config } from './config';
import { pool } from './db/pool';
import { requestId, errorHandler, notFoundHandler } from './http/middleware';
import { authRouter } from './http/routes/auth.routes';
import { dashboardRouter } from './http/routes/dashboard.routes';
import { settingsRouter } from './http/routes/settings.routes';
import { checkoutRouter } from './http/routes/checkout.routes';
import { v1Router } from './http/routes/v1.routes';
import { adminRouter } from './http/routes/admin.routes';
import { ingestProviderWebhook } from './modules/webhooks/provider-webhooks.service';
import { logger } from './lib/logger';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);

  app.use(requestId);
  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    strictTransportSecurity: config.isProd ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
  }));

  // Health checks (for load balancers / orchestrators).
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/health/ready', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      const backlog = (await pool.query(`SELECT count(*)::int AS n FROM jobs WHERE status='pending' AND run_at < now() - interval '5 minutes'`)).rows[0].n;
      res.json({ status: 'ok', database: 'ok', jobBacklog: backlog });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  // Provider webhooks need the exact raw body for signature verification, so they are
  // mounted before any JSON parser.
  app.post('/webhooks/providers/:code', express.text({ type: '*/*', limit: '256kb' }), async (req, res, next) => {
    try {
      const raw = typeof req.body === 'string' ? req.body : '';
      const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v]));
      const result = await ingestProviderWebhook(String(req.params.code), raw, headers);
      if (result.status === 'unknown_provider') return res.status(404).json({ status: 'error', error: { code: 'unknown_provider', message: 'Unknown provider' } });
      if (result.status === 'invalid_signature') return res.status(401).json({ status: 'error', error: { code: 'invalid_signature', message: 'Invalid signature' } });
      if (result.status === 'malformed') return res.status(400).json({ status: 'error', error: { code: 'malformed', message: 'Malformed event' } });
      return res.status(200).json({ status: 'success', data: { received: true, duplicate: result.status === 'duplicate' } });
    } catch (err) {
      logger.error({ err }, 'provider webhook ingest failed');
      return next(err);
    }
  });

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // Public API: server-to-server, no cookies, any origin may call with a secret key.
  app.use('/v1', cors({ origin: false }), v1Router);

  const webCors = cors({ origin: [config.WEB_URL], credentials: true });
  const adminCors = cors({ origin: [config.ADMIN_URL], credentials: true });
  app.use('/auth', webCors, authRouter);
  app.use('/dashboard/settings', webCors, settingsRouter);
  app.use('/dashboard', webCors, dashboardRouter);
  app.use('/checkout', webCors, checkoutRouter);
  app.use('/admin', adminCors, adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
