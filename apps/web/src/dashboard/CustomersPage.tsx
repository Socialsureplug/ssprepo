import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Users } from 'lucide-react';
import type { Paginated } from '@app/shared';
import { Card, DataTable, EmptyState, Input, Money, PageHeader, Pagination, formatDate, type Column } from '@app/ui';
import { useModeQuery, QueryError } from './shared';

export interface CustomerDTO {
  id: string; email: string; name: string | null; phone: string | null; createdAt: string; totalPayments: number; totalAmount: number; lastPaymentAt: string | null;
}

export const customerColumns: Column<CustomerDTO>[] = [
  { key: 'name', header: 'Customer', primary: true, cell: (c) => <div className="min-w-0"><div className="font-medium text-ink">{c.name ?? c.email}</div>{c.name && <div className="truncate text-[12px] text-muted">{c.email}</div>}</div> },
  { key: 'phone', header: 'Phone', hideOnMobile: true, cell: (c) => c.phone ?? <span className="text-muted">—</span> },
  { key: 'payments', header: 'Payments', align: 'right', cell: (c) => <span className="tabular">{c.totalPayments}</span> },
  { key: 'amount', header: 'Total amount', align: 'right', cell: (c) => <Money amount={c.totalAmount} className="font-medium" /> },
  { key: 'last', header: 'Last payment', cell: (c) => <span className="text-muted">{formatDate(c.lastPaymentAt, { time: false })}</span> },
  { key: 'created', header: 'Created', hideOnMobile: true, cell: (c) => <span className="text-muted">{formatDate(c.createdAt, { time: false })}</span> },
];

export default function CustomersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), pageSize: '25', ...(term && { search: term }) });
  const q = useModeQuery<Paginated<CustomerDTO>>(['customers', qs.toString()], `/dashboard/customers?${qs}`);
  return (
    <>
      <PageHeader title="Customers" description="People who have paid you, with their payment history." />
      <Card>
        <form className="relative border-b border-line p-4" onSubmit={(e) => { e.preventDefault(); setTerm(search); setPage(1); }}>
          <Search className="pointer-events-none absolute left-7 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email" className="pl-9 sm:max-w-sm" aria-label="Search customers" />
        </form>
        {q.error ? <div className="p-4"><QueryError error={q.error} /></div> : (
          <DataTable columns={customerColumns} rows={q.data?.items} loading={q.isLoading} rowKey={(c) => c.id} onRowClick={(c) => navigate(`/dashboard/customers/${c.id}`)}
            empty={<EmptyState icon={<Users className="h-5 w-5" />} title={term ? 'No matching customers' : 'No customers yet'} description={term ? 'Try another name or email.' : 'Customers are created automatically when they pay you.'} />}
            footer={q.data && <Pagination page={page} pageSize={25} total={q.data.total} onPage={setPage} />} />
        )}
      </Card>
    </>
  );
}
