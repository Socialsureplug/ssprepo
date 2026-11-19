export const PAYMENT_STATUSES = [
  'created', 'pending', 'processing', 'successful', 'failed', 'expired', 'reversed', 'refunded', 'partially_refunded',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * Allowed payment state transitions. Enforced server-side only; the frontend can never
 * set a status. Terminal states have no outgoing transitions.
 */
export const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  created: ['pending', 'failed', 'expired'],
  pending: ['processing', 'successful', 'failed', 'expired'],
  processing: ['successful', 'failed'],
  successful: ['reversed', 'refunded', 'partially_refunded'],
  partially_refunded: ['refunded', 'partially_refunded', 'reversed'],
  failed: [],
  expired: [],
  reversed: [],
  refunded: [],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}

export const SETTLEMENT_STATUSES = ['pending', 'processing', 'completed', 'failed', 'reversed'] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export const WITHDRAWAL_STATUSES = ['pending', 'processing', 'completed', 'failed', 'reversed'] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

export const REFUND_STATUSES = ['pending', 'processing', 'completed', 'failed'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const KYB_STATUSES = ['not_started', 'pending', 'under_review', 'approved', 'rejected', 'restricted'] as const;
export type KybStatus = (typeof KYB_STATUSES)[number];

export const RISK_STATUSES = ['normal', 'review', 'restricted', 'blocked'] as const;
export type RiskStatus = (typeof RISK_STATUSES)[number];

export const RECON_STATUSES = ['open', 'investigating', 'resolved'] as const;
export type ReconStatus = (typeof RECON_STATUSES)[number];

export const RECON_ISSUE_TYPES = [
  'missing_transaction', 'duplicate_transaction', 'amount_mismatch', 'unexpected_reversal', 'failed_settlement', 'unmatched_transaction',
] as const;
export type ReconIssueType = (typeof RECON_ISSUE_TYPES)[number];

export const PROVIDER_HEALTH = ['operational', 'degraded', 'unavailable'] as const;
export type ProviderHealth = (typeof PROVIDER_HEALTH)[number];

export const MODES = ['test', 'live'] as const;
export type Mode = (typeof MODES)[number];

export const WEBHOOK_EVENT_TYPES = [
  'payment.created', 'payment.pending', 'payment.processing', 'payment.success', 'payment.failed', 'payment.expired',
  'payment.reversed', 'payment.refunded', 'settlement.created', 'settlement.completed', 'settlement.failed',
  'withdrawal.completed', 'withdrawal.failed',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export const MERCHANT_ROLES = ['owner', 'admin', 'developer', 'finance', 'viewer'] as const;
export type MerchantRole = (typeof MERCHANT_ROLES)[number];

export const STAFF_ROLES = ['super_admin', 'finance_admin', 'operations_admin', 'support_admin', 'risk_admin'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const SETTLEMENT_SCHEDULES = ['t0', 't1', 'manual'] as const;
export type SettlementSchedule = (typeof SETTLEMENT_SCHEDULES)[number];
