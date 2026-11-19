import crypto from 'node:crypto';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I to avoid transcription errors

export function randomCode(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Human-friendly, unguessable references for financial objects. */
export const refs = {
  payment: () => `PAY_${randomCode(12)}`,
  refund: () => `RFD_${randomCode(12)}`,
  settlement: () => `STL_${randomCode(12)}`,
  withdrawal: () => `WDR_${randomCode(12)}`,
  event: () => `evt_${crypto.randomBytes(12).toString('hex')}`,
  linkSlug: () => randomCode(10).toLowerCase(),
  requestId: () => `req_${crypto.randomBytes(10).toString('hex')}`,
};
