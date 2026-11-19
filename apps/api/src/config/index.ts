import { z } from 'zod';

/**
 * Centralized, validated configuration. All secrets come from environment variables;
 * the process refuses to start in production with missing or insecure values.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default('postgres://app:app@localhost:5432/payments_dev'),
  // 32-byte keys, base64 encoded. Dev defaults are deterministic and MUST be replaced in production.
  ENCRYPTION_KEY: z.string().default('ZGV2LW9ubHktZW5jcnlwdGlvbi1rZXktMzItYnl0ZXM='),
  HASH_PEPPER: z.string().default('dev-only-pepper-change-me'),
  SESSION_TTL_HOURS: z.coerce.number().default(12),
  STAFF_SESSION_TTL_HOURS: z.coerce.number().default(4),
  WEB_URL: z.string().default('http://localhost:5173'),
  ADMIN_URL: z.string().default('http://localhost:5174'),
  API_URL: z.string().default('http://localhost:4000'),
  CHECKOUT_URL: z.string().default('http://localhost:5173/pay'),
  COOKIE_DOMAIN: z.string().optional(),
  EMAIL_PROVIDER: z.enum(['console', 'http', 'memory']).default('console'),
  EMAIL_HTTP_ENDPOINT: z.string().optional(),
  EMAIL_HTTP_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Nairaflow <no-reply@example.com>'),
  BRAND_NAME: z.string().default('Nairaflow'),
  SUPPORT_EMAIL: z.string().default('support@example.com'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  WORKER_POLL_MS: z.coerce.number().default(1000),
  // Allow outgoing merchant webhooks to private network addresses (dev only).
  WEBHOOK_ALLOW_PRIVATE_URLS: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  TRUST_PROXY: z.coerce.number().default(0),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration', parsed.error.issues);
  process.exit(1);
}

const env = parsed.data;

if (env.NODE_ENV === 'production') {
  const insecure = [
    env.ENCRYPTION_KEY === envSchema.shape.ENCRYPTION_KEY.parse(undefined) && 'ENCRYPTION_KEY',
    env.HASH_PEPPER === envSchema.shape.HASH_PEPPER.parse(undefined) && 'HASH_PEPPER',
    env.WEBHOOK_ALLOW_PRIVATE_URLS && 'WEBHOOK_ALLOW_PRIVATE_URLS',
  ].filter(Boolean);
  if (insecure.length) {
    // eslint-disable-next-line no-console
    console.error(`Refusing to start: insecure production configuration (${insecure.join(', ')})`);
    process.exit(1);
  }
}

export const config = {
  ...env,
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  encryptionKey: Buffer.from(env.ENCRYPTION_KEY, 'base64'),
  cookieSecure: env.NODE_ENV === 'production',
  /** Business rules that are configuration rather than code. */
  rules: {
    minWithdrawal: 100_00,
    maxWithdrawal: 5_000_000_00,
    largeTransactionThreshold: 5_000_000_00,
    velocityWindowMinutes: 10,
    velocityMaxPayments: 100,
    maxFailedLogins: 5,
    lockoutMinutes: 15,
  },
};

if (config.encryptionKey.length !== 32) {
  // eslint-disable-next-line no-console
  console.error('ENCRYPTION_KEY must decode to exactly 32 bytes');
  process.exit(1);
}
