import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, Plus, Search } from 'lucide-react';
import { PAYMENT_STATUSES, type PaymentDTO, type Paginated } from '@app/shared';
import { Button, Card, DataTable, EmptyState, Input, PageHeader, Pagination, Select, humanize } from '@app/ui';
import { useSession } from '../lib/session';
import { useModeQuery, paymentColumns, QueryError } from './shared';
import { CreatePaymentDialog } from './CreatePaymentDialog';

export default function TransactionsPage() {
  const navigate = useNavigate();
  const { session } = useSession();
  const [params, setParams] = useSearchParams();
  const [create, setCreate] = useState(false);
  const [search, setSearch] = useState(params.get('search') ?? '');
  const page = Number(params.get('page') ?? 1);
  const status = params.get('status') ?? '';
  const qs = new URLSearchParams({ page: String(page), pageSize: '25', ...(status && { status }), ...(params.get('search') && { search: params.get('search')! }) });
  const q = useModeQuery<Paginated<PaymentDTO>>(['payments', qs.toString()], `/dashboard/payments?${qs}`);
  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };
  const filtered = !!status || !!params.get('search');

  return (
    <>
      <PageHeader title="Transactions" description="Every bank-transfer payment, with its fee, net amount and status."
        actions={session.permissions.includes('payments.create') && <Button onClick={() => setCreate(true)}><Plus className="h-4 w-4" />New payment</Button>} />
      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row">
          <form className="relative flex-1" onSubmit={(e) => { e.preventDefault(); update({ search }); }}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search reference, your reference or email" className="pl-9" aria-label="Search transactions" />
          </form>
          <Select value={status} onChange={(e) => update({ status: e.target.value })} className="sm:w-52" aria-label="Filter by status">
            <option value="">All statuses</option>
            {PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </Select>
        </div>
        {q.error ? <div className="p-4"><QueryError error={q.error} onRetry={() => q.refetch()} /></div> : (
          <DataTable
            columns={paymentColumns} rows={q.data?.items} loading={q.isLoading} rowKey={(p) => p.id}
            onRowClick={(p) => navigate(`/dashboard/transactions/${p.id}`)}
            empty={filtered
              ? <EmptyState title="No matching transactions" description="Try a different reference or clear the filters." action={<Button variant="secondary" onClick={() => { setSearch(''); setParams({}); }}>Clear filters</Button>} />
              : <EmptyState icon={<ArrowLeftRight className="h-5 w-5" />} title="No transactions yet" description="Payments you create through the API, dashboard or payment links will appear here." action={<Button onClick={() => setCreate(true)}>Create a payment</Button>} />}
            footer={q.data && <Pagination page={page} pageSize={25} total={q.data.total} onPage={(p) => update({ page: String(p) })} />}
          />
        )}
      </Card>
      <CreatePaymentDialog open={create} onOpenChange={setCreate} />
    </>
  );
}
