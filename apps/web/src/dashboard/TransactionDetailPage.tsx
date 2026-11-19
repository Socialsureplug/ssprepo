import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, RefreshCw, Undo2 } from 'lucide-react';
import { formatMoney, type PaymentDTO } from '@app/shared';
import {
  Alert, Button, Card, CardHeader, CopyButton, DescriptionList, Dialog, Field, Input, Money, Spinner, StatusBadge, Textarea,
  formatDate, humanize, nairaToKobo, newIdempotencyKey, buttonVariants, cn,
} from '@app/ui';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useModeQuery, QueryError } from './shared';

interface Detail {
  payment: PaymentDTO;
  timeline: { from_status: string | null; to_status: string; reason: string | null; actor: string; created_at: string }[];
  collectionAccount: { bank_name: string; account_name: string; account_number: string; expires_at: string; status: string } | null;
  metadata: Record<string, unknown>;
  ledger: { transaction_id: string; kind: string; description: string; account: string; direction: string; amount: number; created_at: string }[];
  refunds: { id: string; reference: string; amount: number; status: string; reason: string | null; failureReason: string | null; createdAt: string }[];
  providerTransactions: { kind: string; amount: number; payer_name: string | null; payer_bank: string | null; match_status: string; occurred_at: string }[];
}

const ACCOUNT_LABEL: Record<string, string> = {
  provider_clearing: 'Bank partner clearing', merchant_pending: 'Your pending balance', merchant_available: 'Your available balance',
  fee_revenue: 'Processing fee', payout_clearing: 'Payout in transit', suspense: 'Under review',
};

export default function TransactionDetailPage() {
  const { id = '' } = useParams();
  const { session } = useSession();
  const qc = useQueryClient();
  const [refundOpen, setRefundOpen] = useState(false);
  const q = useModeQuery<Detail>(['payment', id], `/dashboard/payments/${id}`);
  const sync = useMutation({ mutationFn: () => api.post(`/dashboard/payments/${id}/sync`), onSuccess: () => qc.invalidateQueries() });

  if (q.isLoading) return <div className="flex justify-center py-24"><Spinner /></div>;
  if (q.error) return <QueryError error={q.error} />;
  const { payment: p, timeline, collectionAccount, ledger, refunds, providerTransactions } = q.data!;
  const refundable = ['successful', 'partially_refunded'].includes(p.status) && p.amount - p.amountRefunded > 0;
  const open = ['created', 'pending', 'processing'].includes(p.status);

  return (
    <>
      <Link to="/dashboard/transactions" className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Transactions</Link>
      <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-[13px] text-muted">{p.reference}</span>
            <StatusBadge status={p.status} />
          </div>
          <div className="tabular mt-2 font-serif text-[52px] leading-none tracking-tight text-ink">{formatMoney(p.amount)}</div>
          <div className="mt-2 text-[14px] text-muted">{p.customer?.email ?? 'No customer'} · Bank transfer · {formatDate(p.createdAt)}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {open && <Button variant="secondary" loading={sync.isPending} onClick={() => sync.mutate()}><RefreshCw className="h-4 w-4" />Check status</Button>}
          {open && <a href={`/pay/${p.reference}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'secondary' })}><ExternalLink className="h-4 w-4" />Open checkout</a>}
          {refundable && session.permissions.includes('payments.refund') && <Button variant="secondary" onClick={() => setRefundOpen(true)}><Undo2 className="h-4 w-4" />Refund</Button>}
        </div>
      </div>
      {p.failureReason && <Alert tone="danger" className="mb-6" title="Payment failed">{failureCopy(p.failureReason)}</Alert>}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Amounts" />
            <div className="px-5 pb-2">
              <DescriptionList items={[
                { label: 'Gross amount', value: <Money amount={p.amount} /> },
                { label: 'Processing fee', value: <span className="tabular">−{formatMoney(p.fee)}</span> },
                { label: 'Net amount', value: <Money amount={p.netAmount} className="font-semibold text-ink" /> },
                ...(p.amountRefunded ? [{ label: 'Refunded', value: <span className="tabular">−{formatMoney(p.amountRefunded)}</span> }] : []),
              ]} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Ledger entries" description="Double-entry record of every movement for this payment." />
            {ledger.length === 0 ? <p className="px-5 py-6 text-[13.5px] text-muted">Ledger entries are posted when the transfer is confirmed.</p> : (
              <div className="divide-y divide-line">
                {ledger.map((e, i) => (
                  <div key={i} className="flex items-center justify-between gap-4 px-5 py-2.5 text-[13.5px]">
                    <div className="min-w-0"><div className="text-ink">{ACCOUNT_LABEL[e.account] ?? humanize(e.account)}</div><div className="truncate text-[12px] text-muted">{e.description}</div></div>
                    <div className={cn('tabular shrink-0', e.direction === 'credit' ? 'text-ink' : 'text-muted')}>{e.direction === 'debit' ? 'Dr' : 'Cr'} {formatMoney(e.amount)}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {refunds.length > 0 && (
            <Card>
              <CardHeader title="Refunds" />
              <div className="divide-y divide-line">
                {refunds.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-4 px-5 py-3 text-[13.5px]">
                    <div><div className="font-mono text-[12.5px]">{r.reference}</div><div className="text-[12px] text-muted">{r.reason ?? 'No reason given'}{r.failureReason ? ` · ${r.failureReason}` : ''}</div></div>
                    <div className="text-right"><Money amount={r.amount} className="font-medium" /><div><StatusBadge status={r.status} /></div></div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <div className="px-5 pb-2">
              <DescriptionList items={[
                { label: 'Reference', value: <span className="inline-flex items-center gap-2 font-mono text-[12.5px]">{p.reference}<CopyButton value={p.reference} label="" variant="ghost" /></span> },
                { label: 'Your reference', value: p.merchantReference, mono: true },
                { label: 'Customer', value: p.customer ? <Link className="text-primary" to={`/dashboard/customers/${p.customer.id}`}>{p.customer.name ?? p.customer.email}</Link> : '—' },
                { label: 'Description', value: p.description },
                { label: 'Payment method', value: 'Bank transfer' },
                { label: 'Created', value: formatDate(p.createdAt) },
                { label: 'Paid', value: formatDate(p.paidAt) },
                { label: 'Expires', value: formatDate(p.expiresAt) },
                ...(collectionAccount ? [{ label: 'Collection account', value: `${collectionAccount.bank_name} · ${collectionAccount.account_number}` }] : []),
                ...(providerTransactions[0]?.payer_name ? [{ label: 'Paid by', value: `${providerTransactions[0].payer_name}${providerTransactions[0].payer_bank ? ` (${providerTransactions[0].payer_bank})` : ''}` }] : []),
              ]} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Timeline" />
            <ol className="space-y-4 px-5 py-4">
              {timeline.map((t, i) => (
                <li key={i} className="relative flex gap-3">
                  <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', i === timeline.length - 1 ? 'bg-primary' : 'bg-line-strong')} />
                  <div>
                    <div className="text-[13.5px] font-medium text-ink">{humanize(t.to_status)}</div>
                    <div className="text-[12px] text-muted">{formatDate(t.created_at)}{t.reason ? ` · ${humanize(t.reason)}` : ''}</div>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
      <RefundDialog open={refundOpen} onOpenChange={setRefundOpen} payment={p} />
    </>
  );
}

function failureCopy(reason: string) {
  if (reason === 'underpaid') return 'The customer transferred less than the requested amount. The funds are held for review and will be returned to the sender.';
  if (reason === 'provider_unavailable') return 'Our banking partner was unavailable when this payment was created. Create a new payment to try again.';
  return humanize(reason);
}

function RefundDialog({ open, onOpenChange, payment }: { open: boolean; onOpenChange: (o: boolean) => void; payment: PaymentDTO }) {
  const qc = useQueryClient();
  const max = payment.amount - payment.amountRefunded;
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [key] = useState(newIdempotencyKey);
  const kobo = amount ? nairaToKobo(amount) : max;
  const invalid = kobo === null || kobo <= 0 || kobo > max;
  const m = useMutation({
    mutationFn: () => api.post(`/dashboard/payments/${payment.id}/refunds`, { amount: kobo, reason: reason || undefined }, { 'Idempotency-Key': key }),
    onSuccess: () => { void qc.invalidateQueries(); onOpenChange(false); },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Refund payment" description="Refunds are sent back to the account that made the transfer. They're drawn from your balance; the original processing fee isn't returned."
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="danger" disabled={invalid} loading={m.isPending} onClick={() => m.mutate()}>Refund {kobo && !invalid ? formatMoney(kobo) : ''}</Button></>}>
      <div className="space-y-4">
        {m.error && <Alert tone="danger">{m.error.message}</Alert>}
        <Field label="Amount (₦)" htmlFor="ramount" hint={`Up to ${formatMoney(max)}. Leave blank to refund in full.`} error={amount && invalid ? 'Enter a valid amount within the refundable limit.' : undefined}>
          <Input id="ramount" inputMode="decimal" placeholder={(max / 100).toFixed(2)} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Reason (optional)" htmlFor="rreason"><Textarea id="rreason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
