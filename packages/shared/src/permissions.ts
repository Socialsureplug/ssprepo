import type { MerchantRole, StaffRole } from './statuses';

/** Staff (admin) permissions. Each admin role gets only what it needs. */
export const STAFF_PERMISSIONS = [
  'overview.view', 'merchants.view', 'merchants.kyb', 'merchants.status', 'transactions.view', 'balances.view',
  'settlements.view', 'settlements.manage', 'withdrawals.view', 'withdrawals.manage', 'refunds.view', 'refunds.manage',
  'fees.manage', 'providers.view', 'providers.manage', 'reconciliation.view', 'reconciliation.manage', 'risk.view',
  'risk.manage', 'logs.view', 'audit.view', 'ledger.adjust', 'settings.manage', 'staff.manage',
] as const;
export type StaffPermission = (typeof STAFF_PERMISSIONS)[number];

const ALL = [...STAFF_PERMISSIONS];

export const STAFF_ROLE_PERMISSIONS: Record<StaffRole, readonly StaffPermission[]> = {
  super_admin: ALL,
  finance_admin: [
    'overview.view', 'merchants.view', 'transactions.view', 'balances.view', 'settlements.view', 'settlements.manage',
    'withdrawals.view', 'withdrawals.manage', 'refunds.view', 'refunds.manage', 'fees.manage', 'reconciliation.view',
    'reconciliation.manage', 'ledger.adjust', 'audit.view',
  ],
  operations_admin: [
    'overview.view', 'merchants.view', 'merchants.kyb', 'merchants.status', 'transactions.view', 'settlements.view',
    'withdrawals.view', 'refunds.view', 'providers.view', 'providers.manage', 'logs.view', 'reconciliation.view',
  ],
  support_admin: ['overview.view', 'merchants.view', 'transactions.view', 'refunds.view', 'logs.view'],
  risk_admin: [
    'overview.view', 'merchants.view', 'merchants.status', 'transactions.view', 'withdrawals.view', 'risk.view',
    'risk.manage', 'logs.view', 'audit.view',
  ],
};

export function staffCan(roles: readonly StaffRole[], perm: StaffPermission): boolean {
  return roles.some((r) => STAFF_ROLE_PERMISSIONS[r]?.includes(perm));
}

/** Merchant team permissions. */
export const MERCHANT_PERMISSIONS = [
  'payments.view', 'payments.create', 'payments.refund', 'links.manage', 'customers.manage', 'balance.view',
  'withdrawals.create', 'developers.manage', 'settings.manage', 'team.manage', 'kyb.submit',
] as const;
export type MerchantPermission = (typeof MERCHANT_PERMISSIONS)[number];

export const MERCHANT_ROLE_PERMISSIONS: Record<MerchantRole, readonly MerchantPermission[]> = {
  owner: [...MERCHANT_PERMISSIONS],
  admin: [...MERCHANT_PERMISSIONS].filter((p) => p !== 'team.manage') as MerchantPermission[],
  developer: ['payments.view', 'payments.create', 'links.manage', 'customers.manage', 'developers.manage'],
  finance: ['payments.view', 'payments.refund', 'balance.view', 'withdrawals.create', 'customers.manage'],
  viewer: ['payments.view', 'balance.view'],
};

export function merchantCan(role: MerchantRole, perm: MerchantPermission): boolean {
  return MERCHANT_ROLE_PERMISSIONS[role]?.includes(perm) ?? false;
}
