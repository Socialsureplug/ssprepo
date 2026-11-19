import type { Mode, PaymentStatus, PaymentDTO } from '@app/shared';
import { config } from '../../config';
import type { Db } from '../../db/pool';
import { one } from '../../db/pool';

export interface PaymentRow {
  id: string; organization_id: string; mode: Mode; reference: string; merchant_reference: string | null;
  customer_id: string | null; amount: number; currency: 'NGN'; fee: number; net_amount: number; amount_received: number;
  amount_refunded: number; status: PaymentStatus; payment_method: 'bank_transfer'; description: string | null;
  metadata: Record<string, unknown>; callback_url: string | null; failure_reason: string | null; payment_link_id: string | null;
  provider_id: string | null; expires_at: Date; paid_at: Date | null; available_at: Date | null; settled_at: Date | null;
  created_ip: string | null; created_at: Date; updated_at: Date;
}

export function checkoutUrl(reference: string) {
  return `${config.CHECKOUT_URL}/${reference}`;
}

export async function toPaymentDTO(db: Db, p: PaymentRow): Promise<PaymentDTO> {
  const customer = p.customer_id
    ? await one<{ id: string; email: string; name: string | null }>(db, `SELECT id, email, name FROM customers WHERE id=$1`, [p.customer_id])
    : null;
  return rowToDTO(p, customer);
}

export function rowToDTO(p: PaymentRow & { customer_email?: string; customer_name?: string | null }, customer?: { id: string; email: string; name: string | null } | null): PaymentDTO {
  const c = customer ?? (p.customer_id && p.customer_email ? { id: p.customer_id, email: p.customer_email, name: p.customer_name ?? null } : null);
  return {
    id: p.id, reference: p.reference, merchantReference: p.merchant_reference, mode: p.mode, status: p.status,
    amount: p.amount, currency: p.currency, fee: p.fee, netAmount: p.net_amount, amountRefunded: p.amount_refunded,
    description: p.description, customer: c, paymentMethod: 'bank_transfer',
    expiresAt: new Date(p.expires_at).toISOString(), paidAt: p.paid_at ? new Date(p.paid_at).toISOString() : null,
    createdAt: new Date(p.created_at).toISOString(), checkoutUrl: checkoutUrl(p.reference), failureReason: p.failure_reason,
    paymentLinkId: p.payment_link_id,
  };
}

export const PAYMENT_LIST_SELECT = `SELECT p.*, c.email AS customer_email, c.name AS customer_name FROM payments p LEFT JOIN customers c ON c.id=p.customer_id`;
