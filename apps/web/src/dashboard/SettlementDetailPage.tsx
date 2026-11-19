import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { formatMoney } from '@app/shared';
import { Alert, Card, CardHeader, DescriptionList, Money, Spinner, StatusBadge, formatDate } from '@app/ui';
import { useModeQuery, QueryError } from './shared';
import type { SettlementDTO } from './SettlementsPage';

type Detail = SettlementDTO & { items: { paymentId: string; reference: string; grossAmount: number; feeAmount: number; netAmount: number }[] };

export default function SettlementDetailPage() {
  const { id = '' } = useParams();
  const q = useModeQuery<Detail>(['settlement', id], `/dashboard/settlements/${id}`);
  if (q.isLoading) return <div className="flex justify-center py-24"><Spinner /></div>;
  if (q.error) return <QueryError error={q.error} />;
  const s = q.data!;
  return (
    <>
      <Link to="/dashboard/settlements" className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Settlements</Link>
      <div className="mb-6 flex flex-wrap items-center gap-3"><span className="font-mono text-[13px] text-muted">{s.reference}</span><StatusBadge status={s.status} /></div>
      <div className="tabular mb-8 font-serif text-[52px] leading-none text-ink">{formatMoney(s.netAmount)}</div>
      {s.status === 'failed' && <Alert tone="danger" className="mb-6" title="Settlement failed">{s.failureReason} The funds were returned to your available balance. Check your settlement account, then withdraw from Balance.</Alert>}
      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Card className="h-fit px-5 py-2">
          <DescriptionList items={[
            { label: 'Gross amount', value: <Money amount={s.grossAmount} /> },
            { label: 'Fees', value: `−${formatMoney(s.feeAmount)}` },
            { label: 'Settled amount', value: <Money amount={s.netAmount} className="font-semibold" /> },
            { label: 'Payments', value: s.paymentCount },
            { label: 'Destination', value: s.destination === 'balance' ? 'Available balance' : s.bankAccount ? `${s.bankAccount.bankName} ••••${s.bankAccount.last4}` : 'Bank account' },
            { label: 'Created', value: formatDate(s.createdAt) },
            { label: 'Completed', value: formatDate(s.completedAt) },
          ]} />
        </Card>
        <Card>
          <CardHeader title="Included payments" />
          <div className="divide-y divide-line">
            {s.items.map((i) => (
              <Link key={i.paymentId} to={`/dashboard/transactions/${i.paymentId}`} className="flex items-center justify-between gap-4 px-5 py-3 text-[13.5px] hover:bg-surface">
                <span className="font-mono text-[12.5px]">{i.reference}</span>
                <span className="text-right"><Money amount={i.netAmount} className="font-medium" /><span className="block text-[12px] text-muted">of {formatMoney(i.grossAmount)}</span></span>
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
