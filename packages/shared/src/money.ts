/**
 * All monetary values are stored and computed as integer minor units (kobo for NGN).
 * Never use floating point for money.
 */
export const CURRENCIES = ['NGN'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const MINOR_UNITS: Record<Currency, number> = { NGN: 100 };

export function toMinor(major: number | string, currency: Currency = 'NGN'): number {
  const str = typeof major === 'number' ? major.toFixed(2) : major.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(str)) throw new Error('Invalid amount');
  const [whole, frac = ''] = str.split('.');
  const factor = MINOR_UNITS[currency];
  return Number(whole) * factor + Number(frac.padEnd(2, '0'));
}

export function toMajor(minor: number, currency: Currency = 'NGN'): number {
  return minor / MINOR_UNITS[currency];
}

export function formatMoney(minor: number, currency: Currency = 'NGN', opts: { compact?: boolean; decimals?: boolean } = {}): string {
  const major = toMajor(minor, currency);
  if (opts.compact && Math.abs(major) >= 1_000_000) {
    return '₦' + (major / 1_000_000).toFixed(major >= 10_000_000 ? 1 : 2).replace(/\.0+$/, '') + 'M';
  }
  const showDecimals = opts.decimals ?? !Number.isInteger(major);
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(major);
}
