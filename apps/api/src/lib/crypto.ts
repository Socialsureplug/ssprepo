import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from '../config';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, keylen: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SCRYPT_TEST = { N: 2 ** 10, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Password hashing with scrypt (memory-hard). Format: scrypt$N$r$p$salt$hash */
export async function hashPassword(password: string): Promise<string> {
  const params = config.isTest ? SCRYPT_TEST : SCRYPT;
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, 64, params);
  return ['scrypt', params.N, params.r, params.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
  });
  return crypto.timingSafeEqual(key, expected);
}

/** A dummy hash so login timing does not reveal whether an email exists. */
export const DUMMY_PASSWORD_HASH = 'scrypt$1024$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Keyed hash for tokens and API keys: lookups by hash, raw values never stored. */
export function hashToken(token: string): string {
  return crypto.createHmac('sha256', config.HASH_PEPPER).update(token).digest('hex');
}

export function hmacSha256Hex(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export function hmacSha512Hex(secret: string, payload: string): string {
  return crypto.createHmac('sha512', secret).update(payload).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function sha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** AES-256-GCM envelope for secrets that must be recoverable (provider credentials, webhook secrets, account numbers). */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', config.encryptionKey, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

export function decrypt(envelope: string): string {
  const [v, ivB64, tagB64, ctB64] = envelope.split(':');
  if (v !== 'v1') throw new Error('Unsupported ciphertext version');
  const decipher = crypto.createDecipheriv('aes-256-gcm', config.encryptionKey, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}
