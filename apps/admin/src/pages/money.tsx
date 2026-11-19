import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney } from '@app/shared';
import {
  Alert, Button, Card, CardHeader, DataTable, Dialog, EmptyState, Field, Input, Money, PageHeader, Select, StatusBadge, Textarea, formatDate, humanize, nairaToKobo, newIdempotencyKey, type Column,
} from '@app/ui';
import { api, useAdminQuery, useAdminMutation, useCan, useStaff, LoadError, Forbidden } from '../lib';

// ------------------------------------------------------------------ Payment links
interface LinkRow { id: string; title: string; url: string; amount: number | null; status: string; paymentsCount: number; totalCollected: number; merchantName: string; createdAt: string }
export function PaymentLinksPage() {
  const q = useAdminQuery<LinkRow[]>(['links'], '/admin/payment-links');
  const columns: Column<LinkRow>[] = [
    { key: 'title', header: 'Link', primary: true, cell: (l) => <div><div className="font-medium">{l.title}</div><div className="font-mono text-[11.5px] text-muted">{l.url}</div></div> },
    { key: 'merchant', header: 'Merchant', cell: (l) => l.merchantName },
    { key: 'amount', header: 'Amount', align: 'right', cell: (l) => l.amount === null ? 'Open' : <Money amount={l.amount} /> },
    { key: 'status', header: 'Status', cell: (l) => <StatusBadge status={l.status} /> },
    { key: 'created', header: 'Created', cell: (l) => <span className="text-muted">{formatDate(l.createdAt, { time: false })}</span> },
  ];
  return (<><PageHeader title="Payment links" /><Card>{q.error ? <div className="p-4"><LoadError error={q.error} /></div> : <DataTable columns={columns} rows={q.data} loading={q.isLoading} rowKey={(l) => l.id} empty={<EmptyState title="No payment links" />} />}</Card></>);
}

// ------------------------------------------------------------------ Balances & ledger
interface Balances { merchants: { id: string; name: string; available: number; pending: number }[]; platform: { account: string; balance: number }[]; trialBalance: { debits: number; credits: number } }
export function BalancesPage() {
  const q = useAdminQuery<Balances>(['balances'], '/admin/balances');
  const canAdjust = useCan('ledger.adjust');
  const [adjust, setAdjust] = useState<{ id: string; name: string } | null>(null);
  const columns: Column<Balances['merchants'][number]>[] = [
    { key: 'name', header: 'Merchant', primary: true, cell: (m) => <Link className="text-primary" to={`/merchants/${m.id}`}>{m.name}</Link> },
    { key: 'available', header: 'Available', align: 'right', cell: (m) => <Money amount={m.available} /> },
    { key: 'pending', header: 'Pending', align: 'right', cell: (m) => <Money amount={m.pending} /> },
    { key: 'adj', header: <span className="sr-only">Adjust</span>, align: 'right', cell: (m) => canAdjust && <Button size="sm" variant="secondary" onClick={() => setAdjust(m)}>Adjust</Button> },
  ];
  const tb = q.data?.trialBalance;
  return (
    <>
      <PageHeader title="Balances & ledger" description="All balances are derived from the double-entry ledger. Manual changes are only possible through audited adjustments." />
      {q.error && <LoadError error={q.error} />}
      {tb && <Alert tone={tb.debits === tb.credits ? 'success' : 'danger'} className="mb-6" title={tb.debits === tb.credits ? 'Ledger balanced' : 'Ledger imbalance detected'}>Total debits {formatMoney(tb.debits)} · total credits {formatMoney(tb.credits)}</Alert>}
      <Card className="mb-6 grid grid-cols-2 gap-6 p-5 md:grid-cols-4">
        {q.data?.platform.map((p) => <div key={p.account}><div className="text-[12.5px] text-muted">{humanize(p.account)}</div><div className="tabular text-[20px] font-semibold">{formatMoney(p.balance)}</div></div>)}
      </Card>
      <Card><CardHeader title="Merchant balances" /><DataTable columns={columns} rows={q.data?.merchants} loading={q.isLoading} rowKey={(m) => m.id} empty={<EmptyState title="No merchant balances yet" />} /></Card>
      {adjust && <AdjustDialog merchant={adjust} onClose={() => setAdjust(null)} />}
    </>
  );
}

function AdjustDialog({ merchant, onClose }: { merchant: { id: string; name: string }; onClose: () => void }) {
  const { mode } = useStaff();
  const [v, setV] = useState({ account: 'merchant_available', direction: 'credit', amount: '', counterAccount: 'suspense', reason: '' });
  const [key] = useState(newIdempotencyKey);
  const kobo = nairaToKobo(v.amount);
  const m = useAdminMutation(() => api.post('/admin/ledger/adjustments', { organizationId: merchant.id, mode, ...v, amount: kobo }, { 'Idempotency-Key': key }), onClose);
  return (
    <Dialog open onOpenChange={onClose} title={`Ledger adjustment — ${merchant.name}`} description={`Posts a balanced ${mode} ledger transaction. Requires a reason; recorded in the audit log.`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" disabled={!kobo || v.reason.trim().length < 10} loading={m.isPending} onClick={() => m.mutate(undefined)}>Post adjustment</Button></>}>
      <div className="grid grid-cols-2 gap-4">
        {m.error && <Alert tone="danger" className="col-span-2">{m.error.message}</Alert>}
        <Field label="Direction" htmlFor="dir"><Select id="dir" value={v.direction} onChange={(e) => setV({ ...v, direction: e.target.value })}><option value="credit">Credit merchant</option><option value="debit">Debit merchant</option></Select></Field>
        <Field label="Balance" htmlFor="acct"><Select id="acct" value={v.account} onChange={(e) => setV({ ...v, account: e.target.value })}><option value="merchant_available">Available</option><option value="merchant_pending">Pending</option></Select></Field>
        <Field label="Amount (₦)" htmlFor="amt"><Input id="amt" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>
        <Field label="Counter-account" htmlFor="ca"><Select id="ca" value={v.counterAccount} onChange={(e) => setV({ ...v, counterAccount: e.target.value })}><option value="suspense">Suspense</option><option value="fee_revenue">Fee revenue (goodwill)</option></Select></Field>
        <Field label="Reason (min. 10 characters)" htmlFor="why" className="col-span-2"><Textarea id="why" rows={3} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Settlements
interface SettlementRow { id: string; reference: string; merchantName: string; organizationId: string; status: string; destination: string; grossAmount: number; feeAmount: number; netAmount: number; paymentCount: number; failureReason: string | null; createdAt: string }
export function SettlementsPage() {
  const q = useAdminQuery<SettlementRow[]>(['settlements'], '/admin/settlements', { refetchInterval: 20_000 });
  const canRun = useCan('settlements.manage');
  const run = useAdminMutation(() => api.post<{ created: number }>('/admin/settlements/run'));
  const columns: Column<SettlementRow>[] = [
    { key: 'ref', header: 'Reference', primary: true, cell: (s) => <span className="font-mono text-[12.5px]">{s.reference}</span> },
    { key: 'merchant', header: 'Merchant', cell: (s) => <Link className="text-primary" to={`/merchants/${s.organizationId}`}>{s.merchantName}</Link> },
    { key: 'net', header: 'Net', align: 'right', cell: (s) => <Money amount={s.netAmount} className="font-medium" /> },
    { key: 'fees', header: 'Fees', align: 'right', hideOnMobile: true, cell: (s) => <Money amount={s.feeAmount} className="text-muted" /> },
    { key: 'count', header: 'Payments', align: 'right', cell: (s) => s.paymentCount },
    { key: 'dest', header: 'Destination', cell: (s) => humanize(s.destination) },
    { key: 'status', header: 'Status', cell: (s) => <span title={s.failureReason ?? undefined}><StatusBadge status={s.status} /></span> },
    { key: 'date', header: 'Created', cell: (s) => <span className="text-muted">{formatDate(s.createdAt)}</span> },
  ];
  return (
    <>
      <PageHeader title="Settlements" description="Settlement runs execute automatically every 15 minutes." actions={canRun && <Button loading={run.isPending} onClick={() => run.mutate(undefined)}>Run settlements now</Button>} />
      {run.data !== undefined && <Alert tone="success" className="mb-4">Settlement run complete.</Alert>}
      <Card>{q.error ? <div className="p-4"><LoadError error={q.error} /></div> : <DataTable columns={columns} rows={q.data} loading={q.isLoading} rowKey={(s) => s.id} empty={<EmptyState title="No settlements yet" />} />}</Card>
    </>
  );
}

// ------------------------------------------------------------------ Withdrawals
interface WithdrawalRow { id: string; reference: string; merchantName: string; amount: number; fee: number; netAmount: number; status: string; riskFlags: string[]; failureReason: string | null; bankAccount: { bankName: string; last4: string; accountName: string } | null; createdAt: string }
export function WithdrawalsPage() {
  const q = useAdminQuery<WithdrawalRow[]>(['withdrawals'], '/admin/withdrawals', { refetchInterval: 20_000 });
  const canManage = useCan('withdrawals.manage');
  const [reject, setReject] = useState<WithdrawalRow | null>(null);
  const [reason, setReason] = useState('');
  const approve = useAdminMutation((id: string) => api.post(`/admin/withdrawals/${id}/approve`));
  const rej = useAdminMutation(() => api.post(`/admin/withdrawals/${reject!.id}/reject`, { reason }), () => { setReject(null); setReason(''); });
  const columns: Column<WithdrawalRow>[] = [
    { key: 'ref', header: 'Reference', primary: true, cell: (w) => <span className="font-mono text-[12.5px]">{w.reference}</span> },
    { key: 'merchant', header: 'Merchant', cell: (w) => w.merchantName },
    { key: 'amount', header: 'Amount', align: 'right', cell: (w) => <Money amount={w.amount} className="font-medium" /> },
    { key: 'dest', header: 'Destination', hideOnMobile: true, cell: (w) => w.bankAccount ? `${w.bankAccount.bankName} ••${w.bankAccount.last4}` : '—' },
    { key: 'risk', header: 'Risk flags', cell: (w) => w.riskFlags.length ? <span className="text-[12px] text-warning">{w.riskFlags.map(humanize).join(', ')}</span> : <span className="text-muted">—</span> },
    { key: 'status', header: 'Status', cell: (w) => <span title={w.failureReason ?? undefined}><StatusBadge status={w.status} /></span> },
    { key: 'date', header: 'Requested', cell: (w) => <span className="text-muted">{formatDate(w.createdAt)}</span> },
    {
      key: 'act', header: <span className="sr-only">Actions</span>, align: 'right', cell: (w) => canManage && w.status === 'pending' && w.riskFlags.length > 0 && (
        <div className="flex justify-end gap-1"><Button size="sm" onClick={() => approve.mutate(w.id)}>Approve</Button><Button size="sm" variant="secondary" onClick={() => setReject(w)}>Reject</Button></div>
      ),
    },
  ];
  return (
    <>
      <PageHeader title="Withdrawals" description="Withdrawals with high-severity risk flags are held here until approved or rejected." />
      {approve.error && <Alert tone="danger" className="mb-4">{approve.error.message}</Alert>}
      <Card>{q.error ? <div className="p-4"><LoadError error={q.error} /></div> : <DataTable columns={columns} rows={q.data} loading={q.isLoading} rowKey={(w) => w.id} empty={<EmptyState title="No withdrawals" />} />}</Card>
      <Dialog open={!!reject} onOpenChange={() => setReject(null)} title="Reject withdrawal" description="The full amount, including fee, is returned to the merchant's available balance."
        footer={<><Button variant="secondary" onClick={() => setReject(null)}>Cancel</Button><Button variant="danger" disabled={reason.trim().length < 3} loading={rej.isPending} onClick={() => rej.mutate(undefined)}>Reject</Button></>}>
        {rej.error && <Alert tone="danger" className="mb-3">{rej.error.message}</Alert>}
        <Field label="Reason (shared with merchant)" htmlFor="rr"><Textarea id="rr" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Dialog>
    </>
  );
}

// ------------------------------------------------------------------ Refunds & reversals
interface RefundsData { refunds: { id: string; reference: string; paymentReference: string; merchantName: string; amount: number; status: string; reason: string | null; failureReason: string | null; createdAt: string }[]; reversals: { id: string; provider_reference: string; payment_reference: string | null; amount: number; match_status: string; occurred_at: string }[] }
export function RefundsPage() {
  const q = useAdminQuery<RefundsData>(['refunds'], '/admin/refunds');
  if (!useCan('refunds.view')) return <Forbidden />;
  return (
    <>
      <PageHeader title="Refunds & reversals" />
      {q.error && <LoadError error={q.error} />}
      <Card className="mb-6"><CardHeader title="Refunds" />
        <DataTable rows={q.data?.refunds} loading={q.isLoading} rowKey={(r) => r.id} empty={<EmptyState title="No refunds" />} columns={[
          { key: 'ref', header: 'Refund', primary: true, cell: (r) => <span className="font-mono text-[12.5px]">{r.reference}</span> },
          { key: 'pay', header: 'Payment', cell: (r) => <span className="font-mono text-[12px]">{r.paymentReference}</span> },
          { key: 'm', header: 'Merchant', cell: (r) => r.merchantName },
          { key: 'amt', header: 'Amount', align: 'right', cell: (r) => <Money amount={r.amount} /> },
          { key: 'st', header: 'Status', cell: (r) => <span title={r.failureReason ?? undefined}><StatusBadge status={r.status} /></span> },
          { key: 'd', header: 'Created', cell: (r) => <span className="text-muted">{formatDate(r.createdAt)}</span> },
        ]} />
      </Card>
      <Card><CardHeader title="Provider reversals" description="Transfers recalled by the bank. Each creates a reconciliation issue for review." />
        <DataTable rows={q.data?.reversals} loading={q.isLoading} rowKey={(r) => r.id} empty={<EmptyState title="No reversals" />} columns={[
          { key: 'ref', header: 'Provider reference', primary: true, cell: (r) => <span className="font-mono text-[12.5px]">{r.provider_reference}</span> },
          { key: 'pay', header: 'Payment', cell: (r) => r.payment_reference ?? 'Unmatched' },
          { key: 'amt', header: 'Amount', align: 'right', cell: (r) => <Money amount={r.amount} /> },
          { key: 'st', header: 'Match', cell: (r) => <StatusBadge status={r.match_status} /> },
          { key: 'd', header: 'Occurred', cell: (r) => <span className="text-muted">{formatDate(r.occurred_at)}</span> },
        ]} />
      </Card>
    </>
  );
}

export function money(n: number) { return formatMoney(n); }
