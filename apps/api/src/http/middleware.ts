import type { Request, Response, NextFunction, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { merchantCan, staffCan, type MerchantPermission, type StaffPermission, type Mode } from '@app/shared';
import { config } from '../config';
import { pool, one } from '../db/pool';
import { AppError, Errors } from '../lib/errors';
import { hashToken, safeEqual, sha256 } from '../lib/crypto';
import { refs } from '../lib/ids';
import { logger } from '../lib/logger';
import type { SessionContext } from './types';
import { clientIp } from './helpers';

export const MERCHANT_COOKIE = 'sid';
export const STAFF_COOKIE = 'admin_sid';

export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.get('x-request-id');
  req.requestId = incoming && /^[A-Za-z0-9_\-]{8,64}$/.test(incoming) ? incoming : refs.requestId();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

/** Centralized error handler: known errors map to safe messages; everything else is a generic 500. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    if (err.status >= 500) logger.error({ err, requestId: req.requestId }, err.message);
    return res.status(err.status).json({ status: 'error', error: { code: err.code, message: err.message, details: err.details, requestId: req.requestId } });
  }
  if ((err as { type?: string })?.type === 'entity.parse.failed') {
    return res.status(400).json({ status: 'error', error: { code: 'invalid_json', message: 'Request body is not valid JSON.', requestId: req.requestId } });
  }
  if ((err as { type?: string })?.type === 'entity.too.large') {
    return res.status(413).json({ status: 'error', error: { code: 'payload_too_large', message: 'Request body is too large.', requestId: req.requestId } });
  }
  logger.error({ err, requestId: req.requestId, path: req.path }, 'Unhandled error');
  return res.status(500).json({
    status: 'error',
    error: { code: 'internal_error', message: 'Something went wrong on our side. Please try again.', requestId: req.requestId },
  });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ status: 'error', error: { code: 'route_not_found', message: 'Endpoint not found.', requestId: req.requestId } });
}

async function loadSession(token: string, kind: 'merchant' | 'staff'): Promise<SessionContext | null> {
  const row = await one(
    pool,
    `SELECT s.id AS session_id, s.csrf_token, s.mode, s.organization_id, s.expires_at, s.last_seen_at,
            u.id, u.email, u.first_name, u.last_name, u.email_verified_at, u.staff_roles, u.status, u.is_staff, u.password_changed_at, s.created_at AS session_created
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash=$1 AND s.kind=$2 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [hashToken(token), kind],
  );
  if (!row || row.status !== 'active') return null;
  if (kind === 'staff' && (!row.is_staff || !row.staff_roles.length)) return null;
  let org = null;
  let role = null;
  if (kind === 'merchant' && row.organization_id) {
    const m = await one(
      pool,
      `SELECT o.*, m.role FROM organization_members m JOIN organizations o ON o.id=m.organization_id
        WHERE m.organization_id=$1 AND m.user_id=$2 AND m.status='active'`,
      [row.organization_id, row.id],
    );
    if (m) { role = m.role; const { role: _r, ...o } = m; org = o; }
  }
  // Sliding activity timestamp (throttled to one write per minute).
  if (Date.now() - new Date(row.last_seen_at).getTime() > 60_000) {
    void pool.query(`UPDATE sessions SET last_seen_at=now() WHERE id=$1`, [row.session_id]).catch(() => undefined);
  }
  return {
    sessionId: row.session_id, csrfToken: row.csrf_token, mode: row.mode as Mode, org, role,
    user: { id: row.id, email: row.email, first_name: row.first_name, last_name: row.last_name, email_verified_at: row.email_verified_at, staff_roles: row.staff_roles },
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Cookie-session authentication + CSRF protection (synchronizer token in X-CSRF-Token header,
 * plus Origin checking). Cookies are HttpOnly, SameSite=Lax and Secure in production.
 */
function sessionAuth(kind: 'merchant' | 'staff', opts: { requireOrg?: boolean } = {}): RequestHandler {
  const cookie = kind === 'merchant' ? MERCHANT_COOKIE : STAFF_COOKIE;
  const allowedOrigin = kind === 'merchant' ? config.WEB_URL : config.ADMIN_URL;
  return async (req, _res, next) => {
    const token = req.cookies?.[cookie];
    if (!token) return next(Errors.unauthorized());
    const ctx = await loadSession(token, kind);
    if (!ctx) return next(Errors.unauthorized('Your session has expired. Please sign in again.'));
    if (!SAFE_METHODS.has(req.method)) {
      const origin = req.get('origin');
      if (origin && origin !== allowedOrigin) return next(Errors.forbidden('Cross-origin request blocked.'));
      const csrf = req.get('x-csrf-token') ?? '';
      if (!safeEqual(csrf, ctx.csrfToken)) return next(new AppError('csrf_invalid', 'Security token missing or invalid. Refresh the page and try again.', 403));
    }
    if (kind === 'merchant') {
      req.session = ctx;
      if (opts.requireOrg && !ctx.org) return next(Errors.forbidden('Complete business setup first.'));
    } else {
      req.staff = ctx;
    }
    next();
  };
}

export const requireMerchant = sessionAuth('merchant', { requireOrg: true });
export const requireMerchantUser = sessionAuth('merchant');
export const requireStaff = sessionAuth('staff');

export function requireVerifiedEmail(req: Request, _res: Response, next: NextFunction) {
  if (!req.session?.user.email_verified_at) return next(new AppError('email_not_verified', 'Verify your email address to continue.', 403));
  next();
}

export function can(perm: MerchantPermission): RequestHandler {
  return (req, _res, next) => {
    if (!req.session?.role || !merchantCan(req.session.role, perm)) return next(Errors.forbidden());
    next();
  };
}

export function staffPerm(perm: StaffPermission): RequestHandler {
  return (req, _res, next) => {
    if (!req.staff || !staffCan(req.staff.user.staff_roles, perm)) return next(Errors.forbidden('Your admin role does not include this permission.'));
    next();
  };
}

/** Secret-key API authentication: `Authorization: Bearer sk_test_...` / `sk_live_...`. */
export const requireApiKey: RequestHandler = async (req, _res, next) => {
  const header = req.get('authorization') ?? '';
  const key = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!/^sk_(test|live)_[A-Za-z0-9_-]{20,}$/.test(key)) return next(Errors.invalidApiKey());
  const row = await one(
    pool,
    `SELECT k.id AS key_id, k.mode AS key_mode, to_jsonb(o) AS org FROM api_keys k JOIN organizations o ON o.id=k.organization_id
      WHERE k.key_hash=$1 AND k.kind='secret' AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now())`,
    [hashToken(key)],
  );
  if (!row) return next(Errors.invalidApiKey());
  // Defense in depth: the key prefix must agree with the stored mode.
  if (!key.startsWith(`sk_${row.key_mode}_`)) return next(Errors.invalidApiKey());
  req.apiKey = { apiKeyId: row.key_id, mode: row.key_mode, org: { ...row.org, daily_withdrawal_limit: Number(row.org.daily_withdrawal_limit) } };
  void pool.query(`UPDATE api_keys SET last_used_at=now() WHERE id=$1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`, [row.key_id]).catch(() => undefined);
  next();
};

/**
 * Idempotency for API POSTs. Same key + same body → the original response is replayed.
 * Same key + different body → 422. Concurrent duplicate → 409.
 */
export const idempotency: RequestHandler = async (req, res, next) => {
  if (req.method !== 'POST') return next();
  const key = req.get('idempotency-key');
  if (!key) return next();
  if (!/^[A-Za-z0-9_\-:.]{8,128}$/.test(key)) return next(new AppError('invalid_idempotency_key', 'Idempotency-Key must be 8-128 characters.', 400));
  const owner = req.apiKey ? `${req.apiKey.org.id}:${req.apiKey.mode}` : `${req.session?.org?.id}:${req.session?.mode}`;
  const scope = `${owner}:${req.baseUrl}${req.path}`;
  const hash = sha256(JSON.stringify(req.body ?? {}));
  const inserted = await one(pool, `INSERT INTO idempotency_keys (scope, key, request_hash) VALUES ($1,$2,$3) ON CONFLICT (scope, key) DO NOTHING RETURNING id`, [scope, key, hash]);
  if (!inserted) {
    const existing = await one(pool, `SELECT * FROM idempotency_keys WHERE scope=$1 AND key=$2`, [scope, key]);
    if (existing.request_hash !== hash) return next(Errors.idempotencyMismatch());
    if (existing.response_status === null) return next(new AppError('request_in_progress', 'A request with this Idempotency-Key is still being processed.', 409));
    res.setHeader('Idempotent-Replayed', 'true');
    return res.status(existing.response_status).json(existing.response_body);
  }
  const original = res.json.bind(res);
  res.json = (body: unknown) => {
    if (res.statusCode >= 500) {
      // Allow a retry after server errors.
      void pool.query(`DELETE FROM idempotency_keys WHERE id=$1`, [inserted.id]);
    } else {
      void pool.query(`UPDATE idempotency_keys SET response_status=$2, response_body=$3, completed_at=now() WHERE id=$1`, [inserted.id, res.statusCode, JSON.stringify(body)]);
    }
    return original(body);
  };
  next();
};

const REDACT_KEYS = /password|secret|token|account_?number|bvn/i;
function redactBody(v: unknown, depth = 0): unknown {
  if (depth > 4 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => redactBody(x, depth + 1));
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, REDACT_KEYS.test(k) ? '[REDACTED]' : redactBody(val, depth + 1)]));
}

/** Persist a log line for every API request (request/response bodies redacted). */
export const apiLogger: RequestHandler = (req, res, next) => {
  const started = Date.now();
  let responseBody: unknown;
  const original = res.json.bind(res);
  res.json = (body: unknown) => { responseBody = body; return original(body); };
  res.on('finish', () => {
    void pool.query(
      `INSERT INTO api_logs (organization_id, api_key_id, mode, request_id, method, path, status_code, latency_ms, ip, idempotency_key, request_body, response_body)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [req.apiKey?.org.id ?? null, req.apiKey?.apiKeyId ?? null, req.apiKey?.mode ?? null, req.requestId, req.method, req.originalUrl.slice(0, 500),
        res.statusCode, Date.now() - started, clientIp(req), req.get('idempotency-key') ?? null,
        JSON.stringify(redactBody(req.body ?? null)), JSON.stringify(redactBody(responseBody ?? null))],
    ).catch((err) => logger.warn({ err }, 'api log write failed'));
  });
  next();
};

const limiterMessage = (req: Request) => ({ status: 'error', error: { code: 'rate_limited', message: 'Too many requests. Please slow down and retry.', requestId: req.requestId } });

/** Rate limits. In multi-instance deployments, configure a shared store (e.g. Redis) for express-rate-limit. */
export const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: config.isTest ? 1000 : 30, standardHeaders: 'draft-8', legacyHeaders: false, message: limiterMessage });
export const apiLimiter = rateLimit({
  windowMs: 60_000, limit: config.isTest ? 10_000 : 300, standardHeaders: 'draft-8', legacyHeaders: false, message: limiterMessage,
  keyGenerator: (req) => req.apiKey?.apiKeyId ?? clientIp(req),
});
export const publicLimiter = rateLimit({ windowMs: 60_000, limit: config.isTest ? 10_000 : 120, standardHeaders: 'draft-8', legacyHeaders: false, message: limiterMessage });
export const dashboardLimiter = rateLimit({ windowMs: 60_000, limit: config.isTest ? 10_000 : 600, standardHeaders: 'draft-8', legacyHeaders: false, message: limiterMessage });
