import { useNavigate } from 'react-router-dom';
import { Landmark } from 'lucide-react';
import type { Paginated } from '@app/shared';
import { Card, DataTable, EmptyState, Money, PageHeader, StatusBadge, formatDate, type Column } from '@app/ui';
import { useModeQuery, QueryError } from './shared';

export interface SettlementDTO {
  id: string; reference: string; status: string; schedule: string; destination: 'bank' | 'balance'; grossAmount: number; feeAmount: number; netAmount: number;
  paymentCount: number; failureReason: string | null; bankAccount: { bankName: string; last4: string } | null; createdAt: string; completedAt: string | null;
}

export default function SettlementsPage() {
  const navigate = useNavigate();
  const q = useModeQuery<Paginated<SettlementDTO>>(['settlements'], '/dashboard/settlements');
  const columns: Column<SettlementDTO>[] = [
    { key: 'ref', header: 'Reference', primary: true, cell: (s) => <span className="font-mono text-[12.5px]">{s.reference}</span> },
    { key: 'gross', header: 'Gross', align: 'right', hideOnMobile: true, cell: (s) => <Money amount={s.grossAmount} /> },
    { key: 'fees', header: 'Fees', align: 'right', hideOnMobile: true, cell: (s) => <Money amount={s.feeAmount} className="text-muted" /> },
    { key: 'net', header: 'Settled amount', align: 'right', cell: (s) => <Money amount={s.netAmount} className="font-medium" /> },
    { key: 'dest', header: 'Destination', cell: (s) => s.destination === 'balance' ? 'Available balance' : s.bankAccount ? `${s.bankAccount.bankName} ••${s.bankAccount.last4}` : 'Bank' },
    { key: 'status', header: 'Status', cell: (s) => <StatusBadge status={s.status} /> },
    { key: 'date', header: 'Settlement date', cell: (s) => <span className="text-muted">{formatDate(s.completedAt ?? s.createdAt)}</span> },
  ];
  return (
    <>
      <PageHeader title="Settlements" description="Batches of confirmed payments paid out to your bank account or released to your balance." />
      <Card>
        {q.error ? <div className="p-4"><QueryError error={q.error} /></div> : (
          <DataTable columns={columns} rows={q.data?.items} loading={q.isLoading} rowKey={(s) => s.id} onRowClick={(s) => navigate(`/dashboard/settlements/${s.id}`)}
            empty={<EmptyState icon={<Landmark className="h-5 w-5" />} title="Your settlement history will appear here." description="Once payments are confirmed, they're settled automatically on your settlement schedule." />} />
        )}
      </Card>
    </>
  );
}
