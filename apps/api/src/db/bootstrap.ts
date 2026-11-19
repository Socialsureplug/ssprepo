import { pool, one } from './pool';
import { migrate } from './migrate';
import { seedPlatform } from './seed';
import { hashPassword } from '../lib/crypto';

/**
 * Production-safe bootstrap, run on every deploy (idempotent):
 *  - applies migrations
 *  - ensures platform defaults (fee schedule, sandbox provider, provider placeholder)
 *  - creates the first super admin from BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD
 *    only if no staff user exists yet
 *  - optionally creates a verified demo merchant (DEMO_MERCHANT_EMAIL / DEMO_MERCHANT_PASSWORD)
 * Passwords are never printed.
 */
async function main() {
  await migrate();
  await seedPlatform();

  const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.toLowerCase();
  const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const anyStaff = await one(pool, `SELECT 1 FROM users WHERE is_staff LIMIT 1`);
  if (!anyStaff && adminEmail && adminPassword) {
    if (adminPassword.length < 12) throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters');
    await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, is_staff, staff_roles, email_verified_at)
       VALUES ($1,$2,'Platform','Admin',true,'{super_admin}',now()) ON CONFLICT (email) DO NOTHING`,
      [adminEmail, await hashPassword(adminPassword)],
    );
    console.log(`Super admin created: ${adminEmail}`);
  }

  const demoEmail = process.env.DEMO_MERCHANT_EMAIL?.toLowerCase();
  const demoPassword = process.env.DEMO_MERCHANT_PASSWORD;
  if (demoEmail && demoPassword && !(await one(pool, `SELECT 1 FROM users WHERE email=$1`, [demoEmail]))) {
    const user = await one(pool, `INSERT INTO users (email, password_hash, first_name, last_name, email_verified_at) VALUES ($1,$2,'Demo','Merchant',now()) RETURNING id`,
      [demoEmail, await hashPassword(demoPassword)]);
    const org = await one(pool, `INSERT INTO organizations (name) VALUES ('Demo Store Ltd') RETURNING id`);
    await pool.query(`INSERT INTO organization_members (organization_id, user_id, email, role) VALUES ($1,$2,$3,'owner')`, [org!.id, user!.id, demoEmail]);
    console.log(`Demo merchant created: ${demoEmail}`);
  }
  console.log('Bootstrap complete.');
}

main().then(() => pool.end()).catch((err) => { console.error(err); process.exit(1); });
