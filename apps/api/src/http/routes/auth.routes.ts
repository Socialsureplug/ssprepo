import { Router, type Response } from 'express';
import { z } from 'zod';
import {
  signupSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema, changePasswordSchema, verifyEmailSchema, MODES,
  merchantCan, MERCHANT_PERMISSIONS, type MerchantSession,
} from '@app/shared';
import { config } from '../../config';
import * as auth from '../../modules/auth/auth.service';
import { pool, one } from '../../db/pool';
import { parse, ok, clientIp, actorFrom } from '../helpers';
import { MERCHANT_COOKIE, requireMerchantUser, authLimiter } from '../middleware';

export function setSessionCookie(res: Response, name: string, token: string, expiresAt: Date) {
  res.cookie(name, token, {
    httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', path: '/', expires: expiresAt, domain: config.COOKIE_DOMAIN,
  });
}

export function clearSessionCookie(res: Response, name: string) {
  res.clearCookie(name, { path: '/', domain: config.COOKIE_DOMAIN });
}

const meta = (req: any) => ({ ip: clientIp(req), userAgent: req.get('user-agent') });

export const authRouter = Router();

authRouter.post('/signup', authLimiter, async (req, res) => {
  const input = parse(signupSchema, req.body);
  const { session } = await auth.signup(input, meta(req));
  setSessionCookie(res, MERCHANT_COOKIE, session.token, session.expiresAt);
  ok(res, { created: true }, 201);
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const input = parse(loginSchema, req.body);
  const session = await auth.login(input.email, input.password, 'merchant', meta(req));
  setSessionCookie(res, MERCHANT_COOKIE, session.token, session.expiresAt);
  ok(res, { authenticated: true });
});

authRouter.post('/logout', requireMerchantUser, async (req, res) => {
  await auth.logout(req.session!.sessionId);
  clearSessionCookie(res, MERCHANT_COOKIE);
  ok(res, { loggedOut: true });
});

/** Session bootstrap for the dashboard. Never returns secrets; includes the CSRF token. */
authRouter.get('/me', requireMerchantUser, async (req, res) => {
  const s = req.session!;
  const body: MerchantSession & { permissions: string[] } = {
    user: { id: s.user.id, email: s.user.email, firstName: s.user.first_name, lastName: s.user.last_name, emailVerified: !!s.user.email_verified_at },
    organization: s.org && s.role ? {
      id: s.org.id, name: s.org.name, role: s.role, kybStatus: s.org.kyb_status, riskStatus: s.org.risk_status, liveEnabled: s.org.live_enabled,
    } : null,
    mode: s.mode,
    csrfToken: s.csrfToken,
    permissions: s.role ? MERCHANT_PERMISSIONS.filter((p) => merchantCan(s.role!, p)) : [],
  };
  ok(res, body);
});

authRouter.post('/verify-email', authLimiter, async (req, res) => {
  const { token } = parse(verifyEmailSchema, req.body);
  await auth.verifyEmail(token);
  ok(res, { verified: true });
});

authRouter.post('/resend-verification', authLimiter, requireMerchantUser, async (req, res) => {
  const s = req.session!;
  if (!s.user.email_verified_at) await auth.sendVerification(pool, s.user.id, s.user.email);
  ok(res, { sent: true });
});

authRouter.post('/forgot-password', authLimiter, async (req, res) => {
  const { email } = parse(forgotPasswordSchema, req.body);
  await auth.forgotPassword(email);
  ok(res, { message: 'If an account exists for this email, a reset link has been sent.' });
});

authRouter.post('/reset-password', authLimiter, async (req, res) => {
  const { token, password } = parse(resetPasswordSchema, req.body);
  await auth.resetPassword(token, password);
  ok(res, { reset: true });
});

authRouter.post('/change-password', authLimiter, requireMerchantUser, async (req, res) => {
  const { currentPassword, newPassword } = parse(changePasswordSchema, req.body);
  await auth.changePassword(req.session!.user.id, req.session!.sessionId, currentPassword, newPassword, actorFrom(req), req.session!.org?.id ?? null);
  ok(res, { changed: true });
});

authRouter.get('/sessions', requireMerchantUser, async (req, res) => {
  const sessions = await auth.listSessions(req.session!.user.id, 'merchant');
  ok(res, sessions.map((s) => ({ ...s, current: s.id === req.session!.sessionId })));
});

authRouter.delete('/sessions/:id', requireMerchantUser, async (req, res) => {
  await auth.revokeSession(req.session!.user.id, String(req.params.id));
  ok(res, { revoked: true });
});

authRouter.post('/mode', requireMerchantUser, async (req, res) => {
  const { mode } = parse(z.object({ mode: z.enum(MODES) }), req.body);
  await auth.switchMode(req.session!.sessionId, mode, req.session!.org);
  ok(res, { mode });
});

authRouter.get('/invites/:token', authLimiter, async (req, res) => {
  const { hashToken } = await import('../../lib/crypto');
  const t = await one(pool, `SELECT t.context, o.name FROM auth_tokens t JOIN organizations o ON o.id=(t.context->>'organizationId')::uuid
    WHERE t.token_hash=$1 AND t.kind='invite' AND t.used_at IS NULL AND t.expires_at > now()`, [hashToken(String(req.params.token))]);
  if (!t) return ok(res, { valid: false });
  const existing = await one(pool, `SELECT 1 FROM users WHERE email=$1`, [t.context.email]);
  ok(res, { valid: true, organizationName: t.name, email: t.context.email, hasAccount: !!existing });
});

authRouter.post('/invites/accept', authLimiter, async (req, res) => {
  const input = parse(z.object({
    token: z.string().min(20), firstName: z.string().trim().max(80).optional(), lastName: z.string().trim().max(80).optional(),
    password: resetPasswordSchema.shape.password.optional(),
  }), req.body);
  const session = await auth.acceptInvite(input.token, input, meta(req));
  setSessionCookie(res, MERCHANT_COOKIE, session.token, session.expiresAt);
  ok(res, { accepted: true });
});
