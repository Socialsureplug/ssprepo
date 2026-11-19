import type { Mode } from '@app/shared';
import { config } from '../../config';
import { pool, one, query, withTx, type Db } from '../../db/pool';
import { hashPassword, verifyPassword, randomToken, hashToken, DUMMY_PASSWORD_HASH } from '../../lib/crypto';
import { AppError, Errors } from '../../lib/errors';
import { audit, type Actor } from '../../lib/audit';
import { queueEmail, notifyOrg } from '../notifications/notifications.service';

export interface SessionMeta { ip?: string | null; userAgent?: string | null; }

export async function createSession(db: Db, userId: string, kind: 'merchant' | 'staff', organizationId: string | null, meta: SessionMeta) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const ttlHours = kind === 'staff' ? config.STAFF_SESSION_TTL_HOURS : config.SESSION_TTL_HOURS;
  const expiresAt = new Date(Date.now() + ttlHours * 3600_000);
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, kind, organization_id, csrf_token, ip, user_agent, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [hashToken(token), userId, kind, organizationId, csrf, meta.ip ?? null, meta.userAgent?.slice(0, 300) ?? null, expiresAt],
  );
  return { token, expiresAt };
}

async function issueToken(db: Db, userId: string | null, kind: 'email_verification' | 'password_reset' | 'invite', ttlMinutes: number, context: Record<string, unknown> = {}) {
  const token = randomToken(32);
  await db.query(
    `INSERT INTO auth_tokens (user_id, kind, token_hash, context, expires_at) VALUES ($1,$2,$3,$4,$5)`,
    [userId, kind, hashToken(token), JSON.stringify(context), new Date(Date.now() + ttlMinutes * 60_000)],
  );
  return token;
}

async function consumeToken(db: Db, token: string, kind: string) {
  const row = await one(
    db,
    `UPDATE auth_tokens SET used_at=now() WHERE token_hash=$1 AND kind=$2 AND used_at IS NULL AND expires_at > now() RETURNING *`,
    [hashToken(token), kind],
  );
  if (!row) throw new AppError('invalid_token', 'This link is invalid or has expired. Request a new one.', 400);
  return row;
}

export async function signup(input: { firstName: string; lastName: string; email: string; password: string; businessName: string }, meta: SessionMeta) {
  const passwordHash = await hashPassword(input.password);
  return withTx(async (tx) => {
    const exists = await one(tx, `SELECT 1 FROM users WHERE email=$1`, [input.email]);
    if (exists) throw new AppError('email_taken', 'An account with this email already exists. Sign in instead.', 409);
    const user = (await one(
      tx,
      `INSERT INTO users (email, password_hash, first_name, last_name) VALUES ($1,$2,$3,$4) RETURNING id, email`,
      [input.email, passwordHash, input.firstName, input.lastName],
    ))!;
    const org = (await one(tx, `INSERT INTO organizations (name) VALUES ($1) RETURNING id`, [input.businessName]))!;
    await tx.query(`INSERT INTO organization_members (organization_id, user_id, email, role) VALUES ($1,$2,$3,'owner')`, [org.id, user.id, user.email]);
    await sendVerification(tx, user.id, user.email);
    const session = await createSession(tx, user.id, 'merchant', org.id, meta);
    await audit(tx, { type: 'user', id: user.id, ip: meta.ip }, 'auth.signup', { organizationId: org.id, targetType: 'user', targetId: user.id });
    return { session, userId: user.id, organizationId: org.id };
  });
}

export async function sendVerification(db: Db, userId: string, email: string) {
  const token = await issueToken(db, userId, 'email_verification', 60 * 24);
  await queueEmail(db, {
    userId, type: 'auth.verify_email', to: email, title: 'Verify your email',
    body: `Confirm your email address to finish setting up your account:\n\n${config.WEB_URL}/verify-email?token=${token}\n\nThis link expires in 24 hours.`,
  });
}

export async function verifyEmail(token: string) {
  return withTx(async (tx) => {
    const t = await consumeToken(tx, token, 'email_verification');
    await tx.query(`UPDATE users SET email_verified_at=COALESCE(email_verified_at, now()) WHERE id=$1`, [t.user_id]);
    await audit(tx, { type: 'user', id: t.user_id }, 'auth.email_verified', { targetType: 'user', targetId: t.user_id });
  });
}

/**
 * Password login with per-account lockout. Timing is equalised for unknown emails so the
 * response does not reveal whether an account exists.
 */
export async function login(email: string, password: string, kind: 'merchant' | 'staff', meta: SessionMeta) {
  const user = await one(pool, `SELECT * FROM users WHERE email=$1`, [email]);
  const valid = await verifyPassword(password, user?.password_hash ?? DUMMY_PASSWORD_HASH);
  const invalid = new AppError('invalid_credentials', 'Incorrect email or password.', 401);
  if (!user) throw invalid;
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new AppError('account_locked', 'Too many failed attempts. Try again in a few minutes or reset your password.', 423);
  }
  if (!valid) {
    const failures = user.failed_login_count + 1;
    const lock = failures >= config.rules.maxFailedLogins;
    await pool.query(
      `UPDATE users SET failed_login_count=$2, locked_until=$3 WHERE id=$1`,
      [user.id, lock ? 0 : failures, lock ? new Date(Date.now() + config.rules.lockoutMinutes * 60_000) : null],
    );
    await audit(pool, { type: kind === 'staff' ? 'staff' : 'user', id: user.id, ip: meta.ip, userAgent: meta.userAgent }, 'auth.login_failed', { targetType: 'user', targetId: user.id, metadata: { locked: lock } });
    throw invalid;
  }
  if (user.status !== 'active') throw new AppError('account_disabled', 'This account has been disabled. Contact support.', 403);
  if (kind === 'staff' && (!user.is_staff || !user.staff_roles.length)) throw invalid;

  return withTx(async (tx) => {
    await tx.query(`UPDATE users SET failed_login_count=0, locked_until=NULL WHERE id=$1`, [user.id]);
    const membership = kind === 'merchant'
      ? await one(tx, `SELECT organization_id FROM organization_members WHERE user_id=$1 AND status='active' ORDER BY created_at LIMIT 1`, [user.id])
      : null;
    const session = await createSession(tx, user.id, kind, membership?.organization_id ?? null, meta);
    await audit(tx, { type: kind === 'staff' ? 'staff' : 'user', id: user.id, ip: meta.ip, userAgent: meta.userAgent }, 'auth.login', {
      organizationId: membership?.organization_id ?? null, targetType: 'user', targetId: user.id,
    });
    return session;
  });
}

export async function logout(sessionId: string) {
  await pool.query(`UPDATE sessions SET revoked_at=now() WHERE id=$1`, [sessionId]);
}

export async function forgotPassword(email: string) {
  const user = await one(pool, `SELECT id, email FROM users WHERE email=$1 AND status='active'`, [email]);
  if (!user) return; // do not reveal whether the account exists
  await withTx(async (tx) => {
    const token = await issueToken(tx, user.id, 'password_reset', 30);
    await queueEmail(tx, {
      userId: user.id, type: 'auth.password_reset', to: user.email, title: 'Reset your password',
      body: `Use this link to choose a new password:\n\n${config.WEB_URL}/reset-password?token=${token}\n\nThe link expires in 30 minutes. If you did not request this, you can ignore this email.`,
    });
  });
}

export async function resetPassword(token: string, password: string) {
  const passwordHash = await hashPassword(password);
  await withTx(async (tx) => {
    const t = await consumeToken(tx, token, 'password_reset');
    await tx.query(`UPDATE users SET password_hash=$2, password_changed_at=now(), failed_login_count=0, locked_until=NULL WHERE id=$1`, [t.user_id, passwordHash]);
    await tx.query(`UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, [t.user_id]);
    await audit(tx, { type: 'user', id: t.user_id }, 'auth.password_reset', { targetType: 'user', targetId: t.user_id });
  });
}

export async function changePassword(userId: string, currentSessionId: string, current: string, next: string, actor: Actor, organizationId: string | null) {
  const user = await one(pool, `SELECT password_hash FROM users WHERE id=$1`, [userId]);
  if (!user || !(await verifyPassword(current, user.password_hash))) throw new AppError('invalid_credentials', 'Your current password is incorrect.', 422);
  const passwordHash = await hashPassword(next);
  await withTx(async (tx) => {
    await tx.query(`UPDATE users SET password_hash=$2, password_changed_at=now() WHERE id=$1`, [userId, passwordHash]);
    await tx.query(`UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL`, [userId, currentSessionId]);
    await audit(tx, actor, 'auth.password_changed', { organizationId, targetType: 'user', targetId: userId });
    if (organizationId) await notifyOrg(tx, organizationId, 'security.alert', 'Password changed', `The password for ${actor.id ? 'a team member account' : 'an account'} was changed. Other sessions were signed out.`);
  });
}

export async function listSessions(userId: string, kind: 'merchant' | 'staff') {
  return query(pool, `SELECT id, ip, user_agent, created_at, last_seen_at, expires_at FROM sessions WHERE user_id=$1 AND kind=$2 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC`, [userId, kind]);
}

export async function revokeSession(userId: string, sessionId: string) {
  const r = await one(pool, `UPDATE sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id`, [sessionId, userId]);
  if (!r) throw Errors.notFound('Session');
}

export async function switchMode(sessionId: string, mode: Mode, org: { kyb_status: string; live_enabled: boolean } | null) {
  if (mode === 'live' && (!org || org.kyb_status !== 'approved' || !org.live_enabled)) throw Errors.merchantNotVerified();
  await pool.query(`UPDATE sessions SET mode=$2 WHERE id=$1`, [sessionId, mode]);
}

export async function inviteMember(organizationId: string, orgName: string, email: string, role: string, actor: Actor) {
  return withTx(async (tx) => {
    const existing = await one(tx, `SELECT * FROM organization_members WHERE organization_id=$1 AND email=$2`, [organizationId, email]);
    if (existing && existing.status === 'active') throw new AppError('already_member', 'This person is already a team member.', 409);
    const user = await one(tx, `SELECT id FROM users WHERE email=$1`, [email]);
    const member = await one(
      tx,
      `INSERT INTO organization_members (organization_id, user_id, email, role, status, invited_by) VALUES ($1,$2,$3,$4,'invited',$5)
       ON CONFLICT (organization_id, email) DO UPDATE SET role=EXCLUDED.role, status='invited', invited_by=EXCLUDED.invited_by RETURNING *`,
      [organizationId, user?.id ?? null, email, role, actor.id],
    );
    const token = await issueToken(tx, user?.id ?? null, 'invite', 60 * 24 * 7, { memberId: member!.id, organizationId, email });
    await queueEmail(tx, {
      organizationId, type: 'team.invite', to: email, title: `You've been invited to ${orgName}`,
      body: `You've been invited to join ${orgName} on ${config.BRAND_NAME} as ${role}.\n\nAccept the invitation: ${config.WEB_URL}/accept-invite?token=${token}\n\nThis invitation expires in 7 days.`,
    });
    await audit(tx, actor, 'team.member_invited', { organizationId, targetType: 'member', targetId: member!.id, metadata: { email, role } });
    return member;
  });
}

export async function acceptInvite(token: string, details: { firstName?: string; lastName?: string; password?: string }, meta: SessionMeta) {
  const passwordHash = details.password ? await hashPassword(details.password) : null;
  return withTx(async (tx) => {
    const t = await consumeToken(tx, token, 'invite');
    const { memberId, organizationId, email } = t.context;
    let user = await one(tx, `SELECT id, password_hash FROM users WHERE email=$1`, [email]);
    if (user) {
      // Existing accounts must prove they own the account; the invite link alone is not a login.
      if (!details.password || !(await verifyPassword(details.password, user.password_hash))) {
        throw new AppError('invalid_credentials', 'Enter the password for your existing account to accept this invitation.', 401);
      }
    } else {
      if (!passwordHash || !details.firstName || !details.lastName) throw Errors.validation([{ field: 'password', message: 'Name and password are required to create your account' }]);
      user = await one(tx, `INSERT INTO users (email, password_hash, first_name, last_name, email_verified_at) VALUES ($1,$2,$3,$4,now()) RETURNING id`, [email, passwordHash, details.firstName, details.lastName]);
    }
    await tx.query(`UPDATE organization_members SET user_id=$2, status='active' WHERE id=$1`, [memberId, user!.id]);
    const session = await createSession(tx, user!.id, 'merchant', organizationId, meta);
    await audit(tx, { type: 'user', id: user!.id, ip: meta.ip }, 'team.invite_accepted', { organizationId, targetType: 'member', targetId: memberId });
    return session;
  });
}
