import type { Mode } from '@app/shared';
import type { Db } from '../../db/pool';
import { one, query } from '../../db/pool';
import { Errors } from '../../lib/errors';

export async function upsertCustomer(db: Db, organizationId: string, mode: Mode, c: { email: string; name?: string | null; phone?: string | null }) {
  return (await one<{ id: string; email: string; name: string | null }>(
    db,
    `INSERT INTO customers (organization_id, mode, email, name, phone) VALUES ($1,$2,lower($3),$4,$5)
     ON CONFLICT (organization_id, mode, email) DO UPDATE SET name=COALESCE(EXCLUDED.name, customers.name), phone=COALESCE(EXCLUDED.phone, customers.phone)
     RETURNING id, email, name`,
    [organizationId, mode, c.email, c.name || null, c.phone || null],
  ))!;
}

const CUSTOMER_STATS = `
  SELECT c.id, c.email, c.name, c.phone, c.created_at,
         count(p.id) FILTER (WHERE p.status IN ('successful','partially_refunded','refunded'))::int AS total_payments,
         COALESCE(sum(p.amount) FILTER (WHERE p.status IN ('successful','partially_refunded','refunded')),0) AS total_amount,
         max(p.paid_at) AS last_payment_at
    FROM customers c LEFT JOIN payments p ON p.customer_id=c.id`;

export async function listCustomers(db: Db, organizationId: string, mode: Mode, opts: { search?: string; page: number; pageSize: number }) {
  const params: unknown[] = [organizationId, mode];
  let where = `c.organization_id=$1 AND c.mode=$2`;
  if (opts.search) { params.push(`%${opts.search.toLowerCase()}%`); where += ` AND (c.email LIKE $3 OR lower(c.name) LIKE $3)`; }
  const total = (await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM customers c WHERE ${where}`, params))!.n;
  params.push(opts.pageSize, (opts.page - 1) * opts.pageSize);
  const items = await query(db, `${CUSTOMER_STATS} WHERE ${where} GROUP BY c.id ORDER BY c.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return { items: items.map(customerDTO), total, page: opts.page, pageSize: opts.pageSize };
}

export async function getCustomer(db: Db, organizationId: string, mode: Mode, id: string) {
  const row = await one(db, `${CUSTOMER_STATS} WHERE c.organization_id=$1 AND c.mode=$2 AND c.id=$3 GROUP BY c.id`, [organizationId, mode, id]);
  if (!row) throw Errors.notFound('Customer');
  return customerDTO(row);
}

function customerDTO(r: any) {
  return {
    id: r.id, email: r.email, name: r.name, phone: r.phone, createdAt: r.created_at, totalPayments: r.total_payments,
    totalAmount: Number(r.total_amount), lastPaymentAt: r.last_payment_at,
  };
}
