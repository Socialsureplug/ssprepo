import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KYB_STATUSES, type Paginated } from '@app/shared';
import { Card, DataTable, EmptyState, Input, Money, PageHeader, Pagination, Select, StatusBadge, formatDate, humanize, type Column } from '@app/ui';
import { useAdminQuery, LoadError } from '../lib';

interface Merchant { id: string; name: string; status: string; kyb_status: string; risk_status: string; live_enabled: boolean; owner_email: string; live_volume: number; created_at: string }

export default function MerchantsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [kyb, setKyb] = useState('');
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), ...(term && { search: term }), ...(kyb && { kyb }) });
  const q = useAdminQuery<Paginated<Merchant>>(['merchants', qs.toString()], `/admin/merchants?${qs}`);
  const columns: Column<Merchant>[] = [
    { key: 'name', header: 'Merchant', primary: true, cell: (m) => <div><div className="font-medium">{m.name}</div><div className="text-[12px] text-muted">{m.owner_email}</div></div> },
    { key: 'kyb', header: 'KYB', cell: (m) => <StatusBadge status={m.kyb_status} /> },
    { key: 'status', header: 'Account', cell: (m) => <StatusBadge status={m.status} /> },
    { key: 'risk', header: 'Risk', cell: (m) => <StatusBadge status={m.risk_status} /> },
    { key: 'vol', header: 'Live volume', align: 'right', cell: (m) => <Money amount={m.live_volume} /> },
    { key: 'created', header: 'Joined', hideOnMobile: true, cell: (m) => <span className="text-muted">{formatDate(m.created_at, { time: false })}</span> },
  ];
  return (
    <>
      <PageHeader title="Merchants" description="Review verification, manage status and inspect merchant activity." />
      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row">
          <form className="flex-1" onSubmit={(e) => { e.preventDefault(); setTerm(search); setPage(1); }}><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or ID" aria-label="Search merchants" /></form>
          <Select value={kyb} onChange={(e) => { setKyb(e.target.value); setPage(1); }} className="sm:w-56" aria-label="KYB status"><option value="">All KYB statuses</option>{KYB_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
        </div>
        {q.error ? <div className="p-4"><LoadError error={q.error} /></div> : (
          <DataTable columns={columns} rows={q.data?.items} loading={q.isLoading} rowKey={(m) => m.id} onRowClick={(m) => navigate(`/merchants/${m.id}`)}
            empty={<EmptyState title="No merchants found" />} footer={q.data && <Pagination page={page} pageSize={25} total={q.data.total} onPage={setPage} />} />
        )}
      </Card>
    </>
  );
}
