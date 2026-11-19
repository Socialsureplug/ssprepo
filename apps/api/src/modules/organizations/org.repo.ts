import type { Mode, KybStatus, RiskStatus, SettlementSchedule } from '@app/shared';
import type { Db } from '../../db/pool';
import { one } from '../../db/pool';
import { Errors } from '../../lib/errors';

export interface OrgRow {
  id: string; name: string; status: 'active' | 'suspended'; kyb_status: KybStatus; risk_status: RiskStatus;
  live_enabled: boolean; settlement_schedule: SettlementSchedule; daily_withdrawal_limit: number; created_at: string;
}

export async function getOrg(db: Db, id: string, lock = false): Promise<OrgRow> {
  const org = await one<OrgRow>(db, `SELECT * FROM organizations WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`, [id]);
  if (!org) throw Errors.notFound('Organization');
  return org;
}

/**
 * Gatekeeper for money movement. Test mode is always available to active merchants so they
 * can integrate; live mode requires approved KYB, live enablement and an unrestricted risk status.
 */
export function assertCanProcess(org: OrgRow, mode: Mode): void {
  if (org.status === 'suspended' || org.risk_status === 'blocked') throw Errors.merchantRestricted();
  if (mode === 'live') {
    if (org.kyb_status !== 'approved' || !org.live_enabled) throw Errors.merchantNotVerified();
    if (org.risk_status === 'restricted') throw Errors.merchantRestricted();
  }
}

export function assertCanPayout(org: OrgRow, mode: Mode): void {
  assertCanProcess(org, mode);
  if (org.risk_status === 'review' && mode === 'live') throw Errors.merchantRestricted();
}
