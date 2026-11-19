import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PAYMENT_STATUSES, type Paginated, type PaymentDTO } from '@app/shared';
import { Card, DataTable, EmptyState, Input, Money, PageHeader, Pagination, Select, StatusBadge, formatDate, humanize, type Column } from '@app/ui';
import { useAdminQuery, LoadError } from '../lib';

type Row = PaymentDTO & { merchantName: string };

export default function TransactionsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), ...(term && { search: term }), ...(status && { status }) });
  const q = useAdminQuery<Paginated<Row>>(['tx', qs.toString()], `/admin/transactions?${qs}`, { refetchInterval: 20_000 });
  const columns: Column<Row>[] = [
    { key: 'ref', header: 'Reference', primary: true, cell: (p) => <span className="font-mono text-[12.5px]">{p.reference}</span> },
    { key: 'merchant', header: 'Merchant', cell: (p) => p.merchantName },
    { key: 'customer', header: 'Customer', hideOnMobile: true, cell: (p) => <span className="block max-w-[200px] truncate">{p.customer?.email ?? '—'}</span> },
    { key: 'amount', header: 'Amount', align: 'right', cell: (p) => <Money amount={p.amount} className="font-medium" /> },
    { key: 'fee', header: 'Fee', align: 'right', hideOnMobile: true, cell: (p) => <Money amount={p.fee} className="text-muted" /> },
    { key: 'status', header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
    { key: 'date', header: 'Created', cell: (p) => <span className="text-muted">{formatDate(p.createdAt)}</span> },
  ];
  return (
    <>
      <PageHeader title="Transactions" description="All payments across merchants." />
      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row">
          <form className="flex-1" onSubmit={(e) => { e.preventDefault(); setTerm(search); setPage(1); }}><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search reference or customer email" aria-label="Search" /></form>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="sm:w-52" aria-label="Status"><option value="">All statuses</option>{PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
        </div>
        {q.error ? <div className="p-4"><LoadError error={q.error} /></div> : (
          <DataTable columns={columns} rows={q.data?.items} loading={q.isLoading} rowKey={(p) => p.id} onRowClick={(p) => navigate(`/transactions/${p.id}`)}
            empty={<EmptyState title="No transactions" />} footer={q.data && <Pagination page={page} pageSize={25} total={q.data.total} onPage={setPage} />} />
        )}
      </Card>
    </>
  );
}
