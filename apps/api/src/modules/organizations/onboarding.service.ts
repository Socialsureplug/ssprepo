import type { z } from 'zod';
import type { businessProfileSchema } from '@app/shared';
import { pool, one, query, withTx } from '../../db/pool';
import { encrypt, hashToken, randomToken } from '../../lib/crypto';
import { AppError, Errors } from '../../lib/errors';
import { audit, type Actor } from '../../lib/audit';
import { bankName } from '../../lib/banks';
import { selectCollectionProvider } from '../../providers/registry';
import { notifyOrg } from '../notifications/notifications.service';
import { generateWebhookSecret, assertPublicUrl } from '../webhooks/merchant-webhooks.service';
import type { Mode } from '@app/shared';

type Profile = z.infer<typeof businessProfileSchema>;

export async function getProfile(organizationId: string) {
  return one(pool, `SELECT * FROM business_profiles WHERE organization_id=$1`, [organizationId]);
}

export async function saveProfile(organizationId: string, p: Profile, actor: Actor) {
  await withTx(async (tx) => {
    const org = await one(tx, `SELECT kyb_status FROM organizations WHERE id=$1 FOR UPDATE`, [organizationId]);
    if (['pending', 'under_review'].includes(org.kyb_status)) {
      throw new AppError('kyb_locked', 'Your verification is being reviewed. Profile changes are locked until review completes.', 409);
    }
    await tx.query(
      `INSERT INTO business_profiles (organization_id, business_name, business_type, business_email, business_phone, country, registration_number,
         tax_id, address, description, website, expected_monthly_volume, director_name, director_email, director_phone, director_bvn_last4)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (organization_id) DO UPDATE SET business_name=EXCLUDED.business_name, business_type=EXCLUDED.business_type,
         business_email=EXCLUDED.business_email, business_phone=EXCLUDED.business_phone, country=EXCLUDED.country,
         registration_number=EXCLUDED.registration_number, tax_id=EXCLUDED.tax_id, address=EXCLUDED.address, description=EXCLUDED.description,
         website=EXCLUDED.website, expected_monthly_volume=EXCLUDED.expected_monthly_volume, director_name=EXCLUDED.director_name,
         director_email=EXCLUDED.director_email, director_phone=EXCLUDED.director_phone, director_bvn_last4=EXCLUDED.director_bvn_last4`,
      [organizationId, p.businessName, p.businessType, p.businessEmail, p.businessPhone, p.country, p.registrationNumber, p.taxId || null,
        p.address, p.description, p.website || null, p.expectedMonthlyVolume, p.directorName, p.directorEmail, p.directorPhone, p.directorBvnLast4 || null],
    );
    await tx.query(`UPDATE organizations SET name=$2 WHERE id=$1`, [organizationId, p.businessName]);
    await audit(tx, actor, 'onboarding.profile_saved', { organizationId, targetType: 'organization', targetId: organizationId });
  });
}

/** Submit for KYB review: requires a complete profile and a settlement account. */
export async function submitKyb(organizationId: string, actor: Actor) {
  return withTx(async (tx) => {
    const org = await one(tx, `SELECT * FROM organizations WHERE id=$1 FOR UPDATE`, [organizationId]);
    if (!['not_started', 'rejected'].includes(org.kyb_status)) throw new AppError('kyb_already_submitted', 'Verification has already been submitted.', 409);
    const profile = await one(tx, `SELECT * FROM business_profiles WHERE organization_id=$1`, [organizationId]);
    if (!profile) throw new AppError('profile_incomplete', 'Complete your business profile before submitting.', 422);
    const bank = await one(tx, `SELECT bank_name, account_number_last4, account_name FROM bank_accounts WHERE organization_id=$1 AND is_default AND status='active'`, [organizationId]);
    if (!bank) throw new AppError('bank_account_required', 'Add a settlement bank account before submitting.', 422);
    await tx.query(
      `INSERT INTO kyb_verifications (organization_id, status, snapshot, submitted_by) VALUES ($1,'pending',$2,$3)`,
      [organizationId, JSON.stringify({ profile, bank }), actor.id],
    );
    await tx.query(`UPDATE organizations SET kyb_status='pending' WHERE id=$1`, [organizationId]);
    await audit(tx, actor, 'kyb.submitted', { organizationId, targetType: 'organization', targetId: organizationId });
  });
}

export async function listBankAccounts(organizationId: string) {
  return query(pool, `SELECT id, bank_code, bank_name, account_number_last4, account_name, is_default, verified_at, created_at FROM bank_accounts WHERE organization_id=$1 AND status='active' ORDER BY is_default DESC, created_at`, [organizationId]);
}

/** Resolve the account name with the provider (name enquiry) before saving; numbers are stored encrypted. */
export async function addBankAccount(organizationId: string, mode: Mode, input: { bankCode: string; accountNumber: string }, actor: Actor) {
  const name = bankName(input.bankCode);
  if (!name) throw Errors.validation([{ field: 'bankCode', message: 'Unsupported bank' }]);
  const { provider } = await selectCollectionProvider(pool, mode === 'live' ? 'live' : 'test').catch(() => selectCollectionProvider(pool, 'test'));
  const resolved = await provider.resolveAccount(input.bankCode, input.accountNumber);
  return withTx(async (tx) => {
    const hasDefault = await one(tx, `SELECT 1 FROM bank_accounts WHERE organization_id=$1 AND is_default AND status='active'`, [organizationId]);
    const row = await one(
      tx,
      `INSERT INTO bank_accounts (organization_id, bank_code, bank_name, account_number_encrypted, account_number_hash, account_number_last4, account_name, is_default, verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
       ON CONFLICT (organization_id, bank_code, account_number_hash) DO UPDATE SET status='active'
       RETURNING id, bank_code, bank_name, account_number_last4, account_name, is_default, created_at`,
      [organizationId, input.bankCode, name, encrypt(input.accountNumber), hashToken(`acct:${input.accountNumber}`), input.accountNumber.slice(-4), resolved.accountName, !hasDefault],
    );
    await audit(tx, actor, 'bank_account.added', { organizationId, targetType: 'bank_account', targetId: row!.id, metadata: { bank: name, last4: input.accountNumber.slice(-4) } });
    await notifyOrg(tx, organizationId, 'security.alert', 'Settlement account added', `${name} ••••${input.accountNumber.slice(-4)} was added as a settlement account.`);
    return row;
  });
}

export async function setDefaultBankAccount(organizationId: string, id: string, actor: Actor) {
  await withTx(async (tx) => {
    const acct = await one(tx, `SELECT id FROM bank_accounts WHERE id=$1 AND organization_id=$2 AND status='active'`, [id, organizationId]);
    if (!acct) throw Errors.notFound('Bank account');
    await tx.query(`UPDATE bank_accounts SET is_default=false WHERE organization_id=$1`, [organizationId]);
    await tx.query(`UPDATE bank_accounts SET is_default=true WHERE id=$1`, [id]);
    await audit(tx, actor, 'bank_account.default_changed', { organizationId, targetType: 'bank_account', targetId: id });
    await notifyOrg(tx, organizationId, 'security.alert', 'Default settlement account changed', 'Your default settlement account was changed.');
  });
}

// ------------------------------------------------------------------ API keys

/**
 * Secret keys are shown once, then only a keyed hash is stored. Format: sk_<mode>_<random>.
 * Rotation creates a new key and revokes the old one in the same transaction.
 */
export async function createApiKey(organizationId: string, mode: Mode, actor: Actor) {
  return withTx(async (tx) => {
    await tx.query(`UPDATE api_keys SET revoked_at=now() WHERE organization_id=$1 AND mode=$2 AND revoked_at IS NULL`, [organizationId, mode]);
    const secret = `sk_${mode}_${randomToken(32)}`;
    const publicKey = `pk_${mode}_${randomToken(24)}`;
    const row = await one(
      tx,
      `INSERT INTO api_keys (organization_id, mode, kind, prefix, key_hash, last4, created_by) VALUES ($1,$2,'secret',$3,$4,$5,$6) RETURNING id, created_at`,
      [organizationId, mode, `sk_${mode}_`, hashToken(secret), secret.slice(-4), actor.id],
    );
    await tx.query(
      `INSERT INTO api_keys (organization_id, mode, kind, prefix, key_hash, last4, public_value, created_by) VALUES ($1,$2,'public',$3,$4,$5,$6,$7)`,
      [organizationId, mode, `pk_${mode}_`, hashToken(publicKey), publicKey.slice(-4), publicKey, actor.id],
    );
    await audit(tx, actor, 'api_key.created', { organizationId, targetType: 'api_key', targetId: row!.id, metadata: { mode } });
    await notifyOrg(tx, organizationId, 'api_key.created', `New ${mode} API key`, `A new ${mode} secret key ending in ${secret.slice(-4)} was generated. Previous ${mode} keys were revoked.`);
    return { id: row!.id, secretKey: secret, publicKey, createdAt: row!.created_at };
  });
}

export async function revokeApiKeys(organizationId: string, mode: Mode, actor: Actor) {
  await withTx(async (tx) => {
    await tx.query(`UPDATE api_keys SET revoked_at=now() WHERE organization_id=$1 AND mode=$2 AND revoked_at IS NULL`, [organizationId, mode]);
    await audit(tx, actor, 'api_key.revoked', { organizationId, metadata: { mode } });
  });
}

export async function listApiKeys(organizationId: string, mode: Mode) {
  return query(pool, `SELECT id, kind, prefix, last4, public_value, last_used_at, revoked_at, created_at FROM api_keys WHERE organization_id=$1 AND mode=$2 ORDER BY created_at DESC LIMIT 20`, [organizationId, mode]);
}

// ------------------------------------------------------------------ merchant webhook endpoint

export async function upsertWebhook(organizationId: string, mode: Mode, input: { url: string; events: string[]; enabled: boolean }, actor: Actor) {
  if (mode === 'live') await assertPublicUrl(input.url).catch((e) => { throw Errors.validation([{ field: 'url', message: e.message }]); });
  return withTx(async (tx) => {
    const existing = await one(tx, `SELECT id FROM merchant_webhooks WHERE organization_id=$1 AND mode=$2`, [organizationId, mode]);
    let secret: string | null = null;
    if (existing) {
      await tx.query(`UPDATE merchant_webhooks SET url=$2, events=$3, enabled=$4 WHERE id=$1`, [existing.id, input.url, input.events, input.enabled]);
    } else {
      const s = generateWebhookSecret();
      secret = s.secret;
      await tx.query(
        `INSERT INTO merchant_webhooks (organization_id, mode, url, secret_encrypted, secret_last4, events, enabled) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [organizationId, mode, input.url, s.encrypted, s.last4, input.events, input.enabled],
      );
    }
    await audit(tx, actor, 'webhook.configured', { organizationId, metadata: { mode, url: input.url, events: input.events } });
    return { secret };
  });
}

export async function rotateWebhookSecret(organizationId: string, mode: Mode, actor: Actor) {
  const s = generateWebhookSecret();
  const r = await one(pool, `UPDATE merchant_webhooks SET secret_encrypted=$3, secret_last4=$4 WHERE organization_id=$1 AND mode=$2 RETURNING id`, [organizationId, mode, s.encrypted, s.last4]);
  if (!r) throw Errors.notFound('Webhook endpoint');
  await audit(pool, actor, 'webhook.secret_rotated', { organizationId, metadata: { mode } });
  return { secret: s.secret };
}
