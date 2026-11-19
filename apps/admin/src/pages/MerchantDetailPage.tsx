import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { formatMoney, RISK_STATUSES } from '@app/shared';
import { Alert, Button, Card, CardHeader, DescriptionList, Dialog, Field, Input, Select, Spinner, StatusBadge, Textarea, formatDate, humanize, nairaToKobo } from '@app/ui';
import { api, useAdminQuery, useAdminMutation, useCan, LoadError } from '../lib';

interface Detail {
  organization: { id: string; name: string; status: string; kyb_status: string; risk_status: string; live_enabled: boolean; settlement_schedule: string; daily_withdrawal_limit: number; created_at: string };
  profile: Record<string, string> | null;
  members: { email: string; role: string; status: string; first_name: string | null; last_name: string | null; email_verified_at: string | null }[];
  bankAccounts: { id: string; bank_name: string; account_number_last4: string; account_name: string; is_default: boolean; status: string; created_at: string }[];
  kybHistory: { id: string; status: string; submitted_at: string; reviewed_at: string | null; decision_reason: string | null; reviewer_email: string | null }[];
  riskEvents: { id: string; rule: string; severity: string; status: string; created_at: string }[];
  feeOverride: { percentage_bps: number; fixed_fee: number; min_fee: number; max_fee: number | null; payout_fee: number } | null;
  balances: { live: { available: number; pending: number }; test: { available: number; pending: number } };
}

export default function MerchantDetailPage() {
  const { id = '' } = useParams();
  const q = useAdminQuery<Detail>(['merchant', id], `/admin/merchants/${id}`);
  const [action, setAction] = useState<null | 'kyb' | 'status' | 'settlement' | 'fees'>(null);
  const canKyb = useCan('merchants.kyb');
  const canStatus = useCan('merchants.status');
  const canSettle = useCan('settlements.manage');
  const canFees = useCan('fees.manage');
  if (q.isLoading) return <div className="flex justify-center py-24"><Spinner /></div>;
  if (q.error) return <LoadError error={q.error} />;
  const { organization: o, profile: p, members, bankAccounts, kybHistory, riskEvents, feeOverride, balances } = q.data!;
  const P = (k: string) => p?.[k] ?? '—';
  return (
    <>
      <Link to="/merchants" className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Merchants</Link>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">{o.name}</h1>
          <div className="mt-2 flex flex-wrap gap-2"><StatusBadge status={o.kyb_status} label={`KYB: ${humanize(o.kyb_status)}`} /><StatusBadge status={o.status} /><StatusBadge status={o.risk_status} label={`Risk: ${humanize(o.risk_status)}`} />{o.live_enabled && <StatusBadge status="active" label="Live enabled" />}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canKyb && o.kyb_status !== 'not_started' && <Button onClick={() => setAction('kyb')}>Review KYB</Button>}
          {canStatus && <Button variant="secondary" onClick={() => setAction('status')}>Change status</Button>}
          {canSettle && <Button variant="secondary" onClick={() => setAction('settlement')}>Settlement rules</Button>}
          {canFees && <Button variant="secondary" onClick={() => setAction('fees')}>Pricing</Button>}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader title="Business profile" /><div className="px-5 pb-2"><DescriptionList items={[
          { label: 'Legal name', value: P('business_name') }, { label: 'Type', value: humanize(P('business_type')) }, { label: 'Registration', value: P('registration_number') },
          { label: 'Tax ID', value: P('tax_id') }, { label: 'Email', value: P('business_email') }, { label: 'Phone', value: P('business_phone') }, { label: 'Address', value: P('address') },
          { label: 'Website', value: P('website') }, { label: 'Description', value: P('description') }, { label: 'Expected volume', value: humanize(P('expected_monthly_volume')) },
        ]} /></div></Card>
        <div className="space-y-6">
          <Card><CardHeader title="Director" /><div className="px-5 pb-2"><DescriptionList items={[{ label: 'Name', value: P('director_name') }, { label: 'Email', value: P('director_email') }, { label: 'Phone', value: P('director_phone') }, { label: 'BVN (last 4)', value: P('director_bvn_last4') }]} /></div></Card>
          <Card><CardHeader title="Balances" /><div className="px-5 pb-2"><DescriptionList items={[
            { label: 'Live available', value: formatMoney(balances.live.available) }, { label: 'Live pending', value: formatMoney(balances.live.pending) },
            { label: 'Test available', value: formatMoney(balances.test.available) }, { label: 'Settlement schedule', value: humanize(o.settlement_schedule) },
            { label: 'Daily withdrawal limit', value: formatMoney(o.daily_withdrawal_limit) },
            { label: 'Pricing', value: feeOverride ? `Custom: ${feeOverride.percentage_bps / 100}% · cap ${feeOverride.max_fee ? formatMoney(feeOverride.max_fee) : 'none'}` : 'Platform default' },
          ]} /></div></Card>
        </div>
        <Card><CardHeader title="Settlement accounts" /><div className="divide-y divide-line">{bankAccounts.map((b) => (
          <div key={b.id} className="flex justify-between px-5 py-3 text-[13.5px]"><span>{b.bank_name} ••••{b.account_number_last4} · {b.account_name}</span><span className="text-muted">{b.is_default ? 'Default' : humanize(b.status)} · {formatDate(b.created_at, { time: false })}</span></div>
        ))}{!bankAccounts.length && <p className="px-5 py-4 text-[13px] text-muted">None added.</p>}</div></Card>
        <Card><CardHeader title="Team" /><div className="divide-y divide-line">{members.map((m) => (
          <div key={m.email} className="flex justify-between px-5 py-3 text-[13.5px]"><span>{m.first_name ? `${m.first_name} ${m.last_name} · ` : ''}{m.email}</span><span className="text-muted">{humanize(m.role)} · {humanize(m.status)}</span></div>
        ))}</div></Card>
        <Card><CardHeader title="KYB history" /><div className="divide-y divide-line">{kybHistory.map((k) => (
          <div key={k.id} className="px-5 py-3 text-[13.5px]"><div className="flex justify-between"><StatusBadge status={k.status} /><span className="text-muted">Submitted {formatDate(k.submitted_at)}</span></div>
            {k.reviewed_at && <div className="mt-1 text-[12.5px] text-muted">Reviewed by {k.reviewer_email} on {formatDate(k.reviewed_at)}{k.decision_reason ? ` — ${k.decision_reason}` : ''}</div>}</div>
        ))}{!kybHistory.length && <p className="px-5 py-4 text-[13px] text-muted">Not yet submitted.</p>}</div></Card>
        <Card><CardHeader title="Risk events" /><div className="divide-y divide-line">{riskEvents.map((r) => (
          <div key={r.id} className="flex justify-between px-5 py-3 text-[13.5px]"><span>{humanize(r.rule)}</span><span className="flex gap-2"><StatusBadge status={r.severity} /><StatusBadge status={r.status} /></span></div>
        ))}{!riskEvents.length && <p className="px-5 py-4 text-[13px] text-muted">No risk events.</p>}</div></Card>
      </div>
      {action === 'kyb' && <KybDialog id={o.id} onClose={() => setAction(null)} />}
      {action === 'status' && <StatusDialog id={o.id} current={o} onClose={() => setAction(null)} />}
      {action === 'settlement' && <SettlementDialog id={o.id} current={o} onClose={() => setAction(null)} />}
      {action === 'fees' && <FeeDialog id={o.id} current={feeOverride} onClose={() => setAction(null)} />}
    </>
  );
}

function KybDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [decision, setDecision] = useState('approved');
  const [reason, setReason] = useState('');
  const m = useAdminMutation(() => api.post(`/admin/merchants/${id}/kyb`, { decision, reason: reason || undefined }), onClose);
  return (
    <Dialog open onOpenChange={onClose} title="KYB decision" description="Approving enables live mode. Rejections and restrictions require a reason, which the merchant will see."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={decision === 'approved' ? 'primary' : 'danger'} loading={m.isPending} onClick={() => m.mutate(undefined)}>Record decision</Button></>}>
      <div className="space-y-4">
        {m.error && <Alert tone="danger">{m.error.message}</Alert>}
        <Field label="Decision" htmlFor="decision"><Select id="decision" value={decision} onChange={(e) => setDecision(e.target.value)}>{['under_review', 'approved', 'rejected', 'restricted'].map((d) => <option key={d} value={d}>{humanize(d)}</option>)}</Select></Field>
        <Field label="Reason" htmlFor="reason"><Textarea id="reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

function StatusDialog({ id, current, onClose }: { id: string; current: Detail['organization']; onClose: () => void }) {
  const [status, setStatus] = useState(current.status);
  const [risk, setRisk] = useState(current.risk_status);
  const [reason, setReason] = useState('');
  const m = useAdminMutation(() => api.post(`/admin/merchants/${id}/status`, { status, riskStatus: risk, reason }), onClose);
  return (
    <Dialog open onOpenChange={onClose} title="Account status" description="Suspending revokes live API keys and stops all processing."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" disabled={reason.trim().length < 3} loading={m.isPending} onClick={() => m.mutate(undefined)}>Save</Button></>}>
      <div className="space-y-4">
        {m.error && <Alert tone="danger">{m.error.message}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Account" htmlFor="st"><Select id="st" value={status} onChange={(e) => setStatus(e.target.value)}><option value="active">Active</option><option value="suspended">Suspended</option></Select></Field>
          <Field label="Risk status" htmlFor="rs"><Select id="rs" value={risk} onChange={(e) => setRisk(e.target.value)}>{RISK_STATUSES.map((r) => <option key={r} value={r}>{humanize(r)}</option>)}</Select></Field>
        </div>
        <Field label="Reason (required, audited)" htmlFor="sr"><Textarea id="sr" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

function SettlementDialog({ id, current, onClose }: { id: string; current: Detail['organization']; onClose: () => void }) {
  const [schedule, setSchedule] = useState(current.settlement_schedule);
  const [limit, setLimit] = useState((current.daily_withdrawal_limit / 100).toFixed(2));
  const m = useAdminMutation(() => api.put(`/admin/merchants/${id}/settlement`, { schedule, dailyWithdrawalLimit: nairaToKobo(limit) ?? 0 }), onClose);
  return (
    <Dialog open onOpenChange={onClose} title="Settlement rules" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate(undefined)}>Save</Button></>}>
      <div className="space-y-4">
        {m.error && <Alert tone="danger">{m.error.message}</Alert>}
        <Field label="Schedule" htmlFor="sch"><Select id="sch" value={schedule} onChange={(e) => setSchedule(e.target.value)}><option value="t0">Same day (T+0)</option><option value="t1">Next day (T+1)</option><option value="manual">Manual (hold in balance)</option></Select></Field>
        <Field label="Daily withdrawal limit (₦)" htmlFor="lim"><Input id="lim" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

export function FeeDialog({ id, current, onClose }: { id: string | null; current: Detail['feeOverride']; onClose: () => void }) {
  const [v, setV] = useState({
    pct: current ? String(current.percentage_bps / 100) : '1', fixed: current ? String(current.fixed_fee / 100) : '0', min: current ? String(current.min_fee / 100) : '0',
    max: current?.max_fee ? String(current.max_fee / 100) : '2000', payout: current ? String(current.payout_fee / 100) : '50',
  });
  const m = useAdminMutation(() => api.put('/admin/fees', {
    organizationId: id, percentageBps: Math.round(Number(v.pct) * 100), fixedFee: nairaToKobo(v.fixed) ?? 0, minFee: nairaToKobo(v.min) ?? 0,
    maxFee: v.max ? nairaToKobo(v.max) : null, payoutFee: nairaToKobo(v.payout) ?? 0,
  }), onClose);
  const f = (k: keyof typeof v, label: string, hint?: string) => <Field label={label} htmlFor={k} hint={hint}><Input id={k} inputMode="decimal" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>;
  return (
    <Dialog open onOpenChange={onClose} title={id ? 'Merchant-specific pricing' : 'Platform default pricing'} description="Applies to payments created after saving. Existing payments keep their fees."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate(undefined)}>Save pricing</Button></>}>
      <div className="grid grid-cols-2 gap-4">
        {m.error && <Alert tone="danger" className="col-span-2">{m.error.message}</Alert>}
        {f('pct', 'Percentage (%)', 'e.g. 1 = 1%')}{f('fixed', 'Fixed fee (₦)')}{f('min', 'Minimum fee (₦)')}{f('max', 'Maximum fee (₦)', 'Blank = no cap')}{f('payout', 'Withdrawal fee (₦)')}
      </div>
    </Dialog>
  );
}
