import { config } from '../config';
import { pool, one } from './pool';
import { migrate } from './migrate';
import { encrypt, hashPassword, randomToken } from '../lib/crypto';

/**
 * Development seed: platform fee schedule, sandbox + placeholder live provider, a super admin
 * and a demo merchant. Never run against production.
 */
export async function seedPlatform() {
  await pool.query(
    `INSERT INTO fees (organization_id, percentage_bps, fixed_fee, min_fee, max_fee, payout_fee)
     SELECT NULL, 100, 0, 0, 200000, 5000 WHERE NOT EXISTS (SELECT 1 FROM fees WHERE organization_id IS NULL AND active)`,
  );
  await pool.query(
    `INSERT INTO payment_providers (code, name, adapter, enabled, supports_test, supports_live, priority, credentials_encrypted, config)
     VALUES ('sandbox', 'Sandbox', 'sandbox', true, true, false, 1000, $1, '{}') ON CONFLICT (code) DO NOTHING`,
    [encrypt(JSON.stringify({ webhookSecret: process.env.SANDBOX_WEBHOOK_SECRET ?? 'sandbox-webhook-secret' }))],
  );
  // Placeholder for the licensed provider. Disabled until an admin configures base URL + credentials.
  await pool.query(
    `INSERT INTO payment_providers (code, name, adapter, enabled, supports_test, supports_live, priority, config)
     VALUES ('primary_bank', 'Primary bank partner (not configured)', 'http_bank_transfer', false, false, true, 10, '{"baseUrl":"","signatureHeader":"x-provider-signature"}')
     ON CONFLICT (code) DO NOTHING`,
  );
}

async function main() {
  if (config.isProd) throw new Error('Refusing to seed a production database');
  await migrate();
  await seedPlatform();

  const adminEmail = 'admin@example.com';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? `Admin-${randomToken(6)}1`;
  const existingAdmin = await one(pool, `SELECT id FROM users WHERE email=$1`, [adminEmail]);
  if (!existingAdmin) {
    await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, is_staff, staff_roles, email_verified_at) VALUES ($1,$2,'Platform','Admin',true,'{super_admin}',now())`,
      [adminEmail, await hashPassword(adminPassword)],
    );
    console.log(`\nSuper admin created:\n  email:    ${adminEmail}\n  password: ${adminPassword}\n  (admin app: ${config.ADMIN_URL})`);
  }

  const merchantEmail = 'demo@example.com';
  const merchantPassword = process.env.SEED_MERCHANT_PASSWORD ?? `Demo-${randomToken(6)}1`;
  const existingMerchant = await one(pool, `SELECT id FROM users WHERE email=$1`, [merchantEmail]);
  if (!existingMerchant) {
    const user = await one(pool, `INSERT INTO users (email, password_hash, first_name, last_name, email_verified_at) VALUES ($1,$2,'Ada','Demo',now()) RETURNING id`,
      [merchantEmail, await hashPassword(merchantPassword)]);
    const org = await one(pool, `INSERT INTO organizations (name) VALUES ('Demo Store Ltd') RETURNING id`);
    await pool.query(`INSERT INTO organization_members (organization_id, user_id, email, role) VALUES ($1,$2,$3,'owner')`, [org!.id, user!.id, merchantEmail]);
    console.log(`\nDemo merchant created (test mode ready):\n  email:    ${merchantEmail}\n  password: ${merchantPassword}\n  (dashboard: ${config.WEB_URL})`);
  }
  console.log('\nSeed complete.');
}

if (process.argv[1]?.endsWith('seed.ts')) {
  main().then(() => pool.end()).catch((err) => { console.error(err); process.exit(1); });
}
