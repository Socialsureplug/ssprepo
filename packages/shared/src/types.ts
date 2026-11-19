import type { PaymentStatus, KybStatus, Mode, MerchantRole, StaffRole, RiskStatus } from './statuses';

/** Typed API response envelopes shared by the API and web clients. */
export interface ApiSuccess<T> { status: 'success'; data: T; }
export interface ApiError { status: 'error'; error: { code: string; message: string; details?: unknown; requestId?: string }; }
export interface Paginated<T> { items: T[]; total: number; page: number; pageSize: number; }

export interface SessionUser {
  id: string; email: string; firstName: string; lastName: string; emailVerified: boolean;
}
export interface SessionOrganization {
  id: string; name: string; role: MerchantRole; kybStatus: KybStatus; riskStatus: RiskStatus; liveEnabled: boolean;
}
export interface MerchantSession {
  user: SessionUser; organization: SessionOrganization | null; mode: Mode; csrfToken: string;
}
export interface StaffSession { user: SessionUser; roles: StaffRole[]; permissions: string[]; csrfToken: string; }

export interface PaymentDTO {
  id: string; reference: string; merchantReference: string | null; mode: Mode; status: PaymentStatus;
  amount: number; currency: 'NGN'; fee: number; netAmount: number; amountRefunded: number;
  description: string | null; customer: { id: string; email: string; name: string | null } | null;
  paymentMethod: 'bank_transfer'; expiresAt: string; paidAt: string | null; createdAt: string;
  checkoutUrl: string; failureReason: string | null; paymentLinkId: string | null;
}

export interface CheckoutDTO {
  reference: string; status: PaymentStatus; amount: number; currency: 'NGN'; merchantName: string;
  description: string | null; customerEmail: string | null; expiresAt: string; mode: Mode;
  account: { bankName: string; accountName: string; accountNumber: string } | null;
  successRedirectUrl: string | null; cancelRedirectUrl: string | null; supportEmail: string;
}

export interface BalanceDTO { available: number; pending: number; currency: 'NGN'; }
