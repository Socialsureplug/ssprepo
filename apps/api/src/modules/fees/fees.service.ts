import type { Db } from '../../db/pool';
import { one } from '../../db/pool';

export interface FeeSchedule {
  id: string;
  organization_id: string | null;
  percentage_bps: number;
  fixed_fee: number;
  min_fee: number;
  max_fee: number | null;
  payout_fee: number;
}

/** Fallback used only if no schedule exists in the database (e.g. a fresh install before seeding). */
export const DEFAULT_SCHEDULE: Omit<FeeSchedule, 'id' | 'organization_id'> = {
  percentage_bps: 100, fixed_fee: 0, min_fee: 0, max_fee: 200_000, payout_fee: 0,
};

/**
 * Pure fee calculation in integer kobo. Percentage is in basis points (100 bps = 1%).
 * Rounds half up to the nearest kobo, applies min/max, and never exceeds the amount itself.
 */
export function calculateFee(amount: number, s: Pick<FeeSchedule, 'percentage_bps' | 'fixed_fee' | 'min_fee' | 'max_fee'>): number {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Amount must be a positive integer');
  const pct = Math.floor((amount * s.percentage_bps + 5_000) / 10_000);
  let fee = pct + s.fixed_fee;
  if (fee < s.min_fee) fee = s.min_fee;
  if (s.max_fee !== null && s.max_fee !== undefined && fee > s.max_fee) fee = s.max_fee;
  return Math.min(fee, amount);
}

/** Merchant-specific pricing overrides the platform default. */
export async function getFeeSchedule(db: Db, organizationId: string): Promise<FeeSchedule> {
  const row = await one<FeeSchedule>(
    db,
    `SELECT id, organization_id, percentage_bps, fixed_fee, min_fee, max_fee, payout_fee FROM fees
      WHERE active AND (organization_id=$1 OR organization_id IS NULL)
      ORDER BY organization_id NULLS LAST LIMIT 1`,
    [organizationId],
  );
  return row ?? { id: 'default', organization_id: null, ...DEFAULT_SCHEDULE };
}

export async function quotePayment(db: Db, organizationId: string, amount: number) {
  const schedule = await getFeeSchedule(db, organizationId);
  const fee = calculateFee(amount, schedule);
  return { gross: amount, fee, net: amount - fee, scheduleId: schedule.id };
}
