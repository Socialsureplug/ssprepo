import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { formatMoney, type PaymentDTO } from '@app/shared';
import { Card, CardHeader, DescriptionList, Spinner, StatusBadge, formatDate, humanize } from '@app/ui';
import { useAdminQuery, LoadError } from '../lib';

interface Detail {
  payment: PaymentDTO; merchant: { id: string; name: string }; createdIp: string | null;
  timeline: { to_status: string; reason: string | null; actor: string; created_at: string }[];
  ledger: { account: string; direction: string; amount: number; description: string }[];
  providerTransactions: { provider_code: string; provider_reference: string; kind: string; amount: number; match_status: string; payer_name: string | null; payer_bank: string | null; occurred_at: string }[];
  intent: { provider_code: string; provider_reference: string; bank_name: string; account_number: string; status: string } | null;
}

export default function TransactionDetailPage() {
  const { id = '' } = useParams();
  const q = useAdminQuery<Detail>(['tx', id], `/admin/transactions/${id}`);
  if (q.isLoading) return <div className="flex justify-center py-24"><Spinner /></div>;
  if (q.error) return <LoadError error={q.error} />;
  const { payment: p, merchant, timeline, ledger, providerTransactions, intent, createdIp } = q.data!;
  return (
    <>
      <Link to="/transactions" className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Transactions</Link>
      <div className="mb-6 flex flex-wrap items-center gap-3"><span className="font-mono text-[13px] text-muted">{p.reference}</span><StatusBadge status={p.status} /></div>
      <div className="tabular mb-8 font-serif text-[48px] leading-none">{formatMoney(p.amount)}</div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader title="Payment" /><div className="px-5 pb-2"><DescriptionList items={[
          { label: 'Merchant', value: <Link className="text-primary" to={`/merchants/${merchant.id}`}>{merchant.name}</Link> },
          { label: 'Customer', value: p.customer?.email }, { label: 'Merchant reference', value: p.merchantReference, mono: true },
          { label: 'Gross / fee / net', value: `${formatMoney(p.amount)} / ${formatMoney(p.fee)} / ${formatMoney(p.netAmount)}` },
          { label: 'Refunded', value: formatMoney(p.amountRefunded) }, { label: 'Created', value: formatDate(p.createdAt) }, { label: 'Paid', value: formatDate(p.paidAt) },
          { label: 'Expires', value: formatDate(p.expiresAt) }, { label: 'Created from IP', value: createdIp, mono: true }, { label: 'Failure reason', value: p.failureReason },
        ]} /></div></Card>
        <Card><CardHeader title="Provider" /><div className="px-5 pb-2"><DescriptionList items={[
          { label: 'Provider', value: intent?.provider_code }, { label: 'Provider reference', value: intent?.provider_reference, mono: true },
          { label: 'Collection account', value: intent ? `${intent.bank_name} · ${intent.account_number}` : null }, { label: 'Intent status', value: intent && humanize(intent.status) },
        ]} /></div>
          <div className="divide-y divide-line border-t border-line">{providerTransactions.map((t) => (
            <div key={t.provider_reference} className="px-5 py-3 text-[13px]"><div className="flex justify-between"><span className="font-mono">{t.provider_reference}</span><StatusBadge status={t.match_status} /></div>
              <div className="text-muted">{humanize(t.kind)} · {formatMoney(t.amount)} · {t.payer_name ?? 'unknown payer'}{t.payer_bank ? ` (${t.payer_bank})` : ''} · {formatDate(t.occurred_at)}</div></div>
          ))}</div>
        </Card>
        <Card><CardHeader title="Ledger" /><div className="divide-y divide-line">{ledger.map((e, i) => (
          <div key={i} className="flex justify-between px-5 py-2.5 text-[13px]"><span>{humanize(e.account)}</span><span className="tabular">{e.direction === 'debit' ? 'Dr' : 'Cr'} {formatMoney(e.amount)}</span></div>
        ))}{!ledger.length && <p className="px-5 py-4 text-[13px] text-muted">No postings.</p>}</div></Card>
        <Card><CardHeader title="State history" /><ol className="space-y-3 px-5 py-4">{timeline.map((t, i) => (
          <li key={i} className="text-[13px]"><span className="font-medium">{humanize(t.to_status)}</span> <span className="text-muted">· {formatDate(t.created_at)} · {t.actor}{t.reason ? ` · ${t.reason}` : ''}</span></li>
        ))}</ol></Card>
      </div>
    </>
  );
}
