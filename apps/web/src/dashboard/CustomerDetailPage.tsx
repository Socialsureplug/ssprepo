import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { Paginated, PaymentDTO } from '@app/shared';
import { Card, CardHeader, DataTable, EmptyState, Money, Spinner, Stat, formatDate } from '@app/ui';
import { useModeQuery, paymentColumns, QueryError } from './shared';
import type { CustomerDTO } from './CustomersPage';

export default function CustomerDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const c = useModeQuery<CustomerDTO>(['customer', id], `/dashboard/customers/${id}`);
  const payments = useModeQuery<Paginated<PaymentDTO>>(['payments', 'customer', id], `/dashboard/payments?customerId=${id}&pageSize=100`);
  if (c.isLoading) return <div className="flex justify-center py-24"><Spinner /></div>;
  if (c.error) return <QueryError error={c.error} />;
  const cust = c.data!;
  return (
    <>
      <Link to="/dashboard/customers" className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Customers</Link>
      <h1 className="text-[28px] font-semibold tracking-tight">{cust.name ?? cust.email}</h1>
      <p className="mt-1 text-[14px] text-muted">{cust.email}{cust.phone ? ` · ${cust.phone}` : ''} · Customer since {formatDate(cust.createdAt, { time: false })}</p>
      <Card className="my-6 grid grid-cols-2 gap-6 p-5 sm:grid-cols-3">
        <Stat label="Total paid" value={<Money amount={cust.totalAmount} />} />
        <Stat label="Successful payments" value={cust.totalPayments} />
        <Stat label="Last payment" value={<span className="text-[16px]">{formatDate(cust.lastPaymentAt, { time: false })}</span>} />
      </Card>
      <Card>
        <CardHeader title="Transaction history" />
        <DataTable columns={paymentColumns.filter((col) => col.key !== 'customer')} rows={payments.data?.items} loading={payments.isLoading} rowKey={(p) => p.id}
          onRowClick={(p) => navigate(`/dashboard/transactions/${p.id}`)} empty={<EmptyState title="No transactions" />} />
      </Card>
    </>
  );
}
