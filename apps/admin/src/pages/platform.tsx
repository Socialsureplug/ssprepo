import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney, STAFF_ROLES } from '@app/shared';
import {
  Alert, Badge, Button, Card, CardHeader, DataTable, Dialog, EmptyState, Field, Input, PageHeader, Select, StatusBadge, Tabs, Textarea, formatDate, humanize, relativeTime, cn, type Column,
} from '@app/ui';
import { api, useAdminQuery, useAdminMutation, useCan, useStaff, LoadError, Forbidden } from '../lib';
import { FeeDialog } from './MerchantDetailPage';

// ------------------------------------------------------------------ Providers
interface Provider { id: string; code: string; name: string; adapter: string; enabled: boolean; supportsTest: boolean; supportsLive: boolean; priority: number; config: Record<string, string | number | boolean>; hasCredentials: boolean; healthStatus: string; healthCheckedAt: string | null; healthLatencyMs: number | null }
interface Adapter { adapter: string; label: string; credentialFields: string[]; configFields: string[] }
export function ProvidersPage() {
  const q = useAdminQuery<{ providers: Provider[]; adapters: Adapter[] }>(['providers'], '/admin/providers', { refetchInterval: 30_000 });
  const canManage = useCan('providers.manage');
  const [edit, setEdit] = useState<Provider | null>(null);
  const [logs, setLogs] = useState<Provider | null>(null);
  const health = useAdminMutation((id: string) => api.post(`/admin/providers/${id}/health-check`));
  if (q.error) return <LoadError error={q.error} />;
  return (
    <>
      <PageHeader title="Payment providers" description="Licensed bank / payment partners behind the provider abstraction. Credentials are encrypted and never displayed." />
      <Alert tone="info" className="mb-6" title="Integration point">Live collections require a licensed provider. Configure its base URL and credentials here, verify it against the provider's sandbox, then enable it for live traffic. Routing uses the enabled live provider with the lowest priority number that is not unavailable.</Alert>
      <div className="grid gap-6 lg:grid-cols-2">
        {q.data?.providers.map((p) => (
          <Card key={p.id}>
            <CardHeader title={p.name} description={`${p.code} · ${q.data!.adapters.find((a) => a.adapter === p.adapter)?.label ?? p.adapter}`} action={<StatusBadge status={p.enabled ? p.healthStatus : 'disabled'} />} />
            <div className="grid grid-cols-2 gap-4 p-5 text-[13px]">
              <div><div className="text-muted">Modes</div><div>{[p.supportsTest && 'Test', p.supportsLive && 'Live'].filter(Boolean).join(' · ') || '—'}</div></div>
              <div><div className="text-muted">Priority</div><div className="tabular">{p.priority}</div></div>
              <div><div className="text-muted">Credentials</div><div>{p.hasCredentials ? 'Configured (encrypted)' : <span className="text-warning">Not configured</span>}</div></div>
              <div><div className="text-muted">Last health check</div><div>{p.healthCheckedAt ? `${relativeTime(p.healthCheckedAt)} · ${p.healthLatencyMs}ms` : 'Never'}</div></div>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-line px-5 py-3">
              {canManage && <Button size="sm" variant="secondary" onClick={() => setEdit(p)}>Configure</Button>}
              {canManage && <Button size="sm" variant="secondary" loading={health.isPending && health.variables === p.id} onClick={() => health.mutate(p.id)}>Run health check</Button>}
              <Button size="sm" variant="ghost" onClick={() => setLogs(p)}>Provider logs</Button>
            </div>
          </Card>
        ))}
      </div>
      {edit && <ProviderDialog provider={edit} adapter={q.data!.adapters.find((a) => a.adapter === edit.adapter)!} onClose={() => setEdit(null)} />}
      {logs && <ProviderLogs provider={logs} onClose={() => setLogs(null)} />}
    </>
  );
}

function ProviderDialog({ provider, adapter, onClose }: { provider: Provider; adapter: Adapter; onClose: () => void }) {
  const [v, setV] = useState({ name: provider.name, enabled: provider.enabled, supportsLive: provider.supportsLive, priority: provider.priority, config: { ...provider.config } as Record<string, string | number | boolean> });
  const [creds, setCreds] = useState<Record<string, string>>({});
  const filledCreds = Object.fromEntries(Object.entries(creds).filter(([, x]) => x));
  const m = useAdminMutation(() => api.patch(`/admin/providers/${provider.id}`, { ...v, credentials: Object.keys(filledCreds).length ? { ...filledCreds } : undefined }), onClose);
  return (
    <Dialog open onOpenChange={onClose} wide title={`Configure ${provider.name}`} description="Credential fields are write-only: leave blank to keep the stored value."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {m.error && <Alert tone="danger" className="sm:col-span-2">{m.error.message}</Alert>}
        <Field label="Display name" htmlFor="pn"><Input id="pn" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Priority (lower wins)" htmlFor="pp"><Input id="pp" type="number" value={v.priority} onChange={(e) => setV({ ...v, priority: Number(e.target.value) })} /></Field>
        <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" className="accent-[#1546e0]" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} />Enabled</label>
        <label className={cn('flex items-center gap-2 text-[13.5px]', provider.adapter === 'sandbox' && 'opacity-50')}><input type="checkbox" className="accent-[#1546e0]" disabled={provider.adapter === 'sandbox'} checked={v.supportsLive} onChange={(e) => setV({ ...v, supportsLive: e.target.checked })} />Use for live payments</label>
        {adapter.configFields.map((f) => (
          <Field key={f} label={`Config: ${f}`} htmlFor={`c-${f}`}><Input id={`c-${f}`} value={String(v.config[f] ?? '')} onChange={(e) => setV({ ...v, config: { ...v.config, [f]: e.target.value } })} /></Field>
        ))}
        {adapter.credentialFields.map((f) => (
          <Field key={f} label={`Credential: ${f}`} htmlFor={`k-${f}`} hint={provider.hasCredentials ? 'Stored — enter a new value to replace' : 'Not set'}>
            <Input id={`k-${f}`} type="password" autoComplete="off" value={creds[f] ?? ''} onChange={(e) => setCreds({ ...creds, [f]: e.target.value })} />
          </Field>
        ))}
      </div>
    </Dialog>
  );
}

function ProviderLogs({ provider, onClose }: { provider: Provider; onClose: () => void }) {
  const q = useAdminQuery<{ id: string; operation: string; success: boolean; latency_ms: number; error: string | null; created_at: string }[]>(['plogs', provider.id], `/admin/providers/${provider.id}/logs`);
  return (
    <Dialog open onOpenChange={onClose} wide title={`${provider.name} — provider logs`} description="Last 100 calls. Account numbers and secrets are redacted.">
      <div className="max-h-[60vh] divide-y divide-line overflow-y-auto rounded-md border border-line">
        {q.data?.map((l) => (
          <div key={l.id} className="flex justify-between gap-4 px-3 py-2 text-[12.5px]"><span className="font-mono">{l.operation}</span><span className={l.success ? 'text-success' : 'text-danger'}>{l.success ? 'OK' : l.error}</span><span className="tabular text-muted">{l.latency_ms}ms · {relativeTime(l.created_at)}</span></div>
        ))}
        {q.data?.length === 0 && <p className="p-4 text-[13px] text-muted">No calls yet.</p>}
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Fees
interface FeeRow { id: string; organization_id: string | null; merchant_name: string | null; percentage_bps: number; fixed_fee: number; min_fee: number; max_fee: number | null; payout_fee: number; created_at: string }
export function FeesPage() {
  const q = useAdminQuery<FeeRow[]>(['fees'], '/admin/fees');
  const [edit, setEdit] = useState<FeeRow | 'default' | null>(null);
  const remove = useAdminMutation((orgId: string) => api.del(`/admin/fees/${orgId}`));
  if (!useCan('fees.manage')) return <Forbidden />;
  const def = q.data?.find((f) => !f.organization_id);
  const desc = (f: FeeRow) => `${f.percentage_bps / 100}%${f.fixed_fee ? ` + ${formatMoney(f.fixed_fee)}` : ''} · min ${formatMoney(f.min_fee)} · cap ${f.max_fee !== null ? formatMoney(f.max_fee) : 'none'} · withdrawal ${formatMoney(f.payout_fee)}`;
  return (
    <>
      <PageHeader title="Fees" description="Fees are calculated server-side when each payment is created. Changes apply to new payments only." />
      {q.error && <LoadError error={q.error} />}
      <Card className="mb-6"><CardHeader title="Platform default" action={<Button size="sm" variant="secondary" onClick={() => setEdit('default')}>Edit</Button>} />
        <p className="tabular px-5 py-4 text-[14px]">{def ? desc(def) : 'Not configured (code fallback: 1%, cap ₦2,000)'}</p></Card>
      <Card><CardHeader title="Merchant-specific pricing" description="Set from a merchant's page." />
        <DataTable rows={q.data?.filter((f) => f.organization_id)} loading={q.isLoading} rowKey={(f) => f.id} empty={<EmptyState title="No custom pricing" />} columns={[
          { key: 'm', header: 'Merchant', primary: true, cell: (f) => <Link className="text-primary" to={`/merchants/${f.organization_id}`}>{f.merchant_name}</Link> },
          { key: 'p', header: 'Pricing', cell: (f) => <span className="tabular">{desc(f)}</span> },
          { key: 'd', header: 'Since', cell: (f) => <span className="text-muted">{formatDate(f.created_at, { time: false })}</span> },
          { key: 'x', header: <span className="sr-only">Remove</span>, align: 'right', cell: (f) => <Button size="sm" variant="ghost" className="text-danger" onClick={() => remove.mutate(f.organization_id!)}>Remove</Button> },
        ]} />
      </Card>
      {edit && <FeeDialog id={edit === 'default' ? null : edit.organization_id} current={edit === 'default' ? def ?? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

// ------------------------------------------------------------------ Reconciliation
interface Issue { id: string; type: string; status: string; merchant_name: string | null; payment_reference: string | null; settlement_reference: string | null; payment_id: string | null; expected_amount: number | null; actual_amount: number | null; details: Record<string, unknown>; resolution_note: string | null; resolved_by_email: string | null; created_at: string; mode: string | null }
interface Run { id: string; status: string; checked_count: number; issues_found: number; started_at: string; finished_at: string | null }
export function ReconciliationPage() {
  const [filter, setFilter] = useState('open');
  const q = useAdminQuery<{ issues: Issue[]; runs: Run[] }>(['recon', filter], `/admin/reconciliation?status=${filter}`);
  const canManage = useCan('reconciliation.manage');
  const run = useAdminMutation(() => api.post('/admin/reconciliation/run'));
  const [sel, setSel] = useState<Issue | null>(null);
  const [next, setNext] = useState('investigating');
  const [note, setNote] = useState('');
  const update = useAdminMutation(() => api.patch(`/admin/reconciliation/${sel!.id}`, { status: next, note }), () => { setSel(null); setNote(''); });
  const columns: Column<Issue>[] = [
    { key: 'type', header: 'Issue', primary: true, cell: (i) => <span className="font-medium">{humanize(i.type)}</span> },
    { key: 'm', header: 'Merchant', cell: (i) => i.merchant_name ?? '—' },
    { key: 'ref', header: 'Reference', cell: (i) => <span className="font-mono text-[12px]">{i.payment_reference ?? i.settlement_reference ?? '—'}</span> },
    { key: 'amt', header: 'Expected / actual', align: 'right', cell: (i) => <span className="tabular">{i.expected_amount !== null ? formatMoney(i.expected_amount) : '—'} / {i.actual_amount !== null ? formatMoney(i.actual_amount) : '—'}</span> },
    { key: 'st', header: 'Status', cell: (i) => <StatusBadge status={i.status} /> },
    { key: 'd', header: 'Detected', cell: (i) => <span className="text-muted">{relativeTime(i.created_at)}</span> },
  ];
  const last = q.data?.runs[0];
  return (
    <>
      <PageHeader title="Reconciliation" description="Provider records vs internal ledger vs settlements. Runs hourly; every status change requires a note and is audited."
        actions={canManage && <Button loading={run.isPending} onClick={() => run.mutate(undefined)}>Run reconciliation</Button>} />
      {last && <p className="mb-4 text-[13px] text-muted">Last run {relativeTime(last.started_at)} · {humanize(last.status)} · {last.checked_count} records checked · {last.issues_found} new issues</p>}
      <Tabs className="mb-4" value={filter} onChange={setFilter} items={[{ value: 'open', label: 'Open' }, { value: 'investigating', label: 'Investigating' }, { value: 'resolved', label: 'Resolved' }, { value: '', label: 'All' }]} />
      <Card>{q.error ? <div className="p-4"><LoadError error={q.error} /></div> : <DataTable columns={columns} rows={q.data?.issues} loading={q.isLoading} rowKey={(i) => i.id} onRowClick={(i) => { setSel(i); setNext(i.status === 'open' ? 'investigating' : 'resolved'); }} empty={<EmptyState title="No issues" description="Everything reconciles." />} />}</Card>
      <Dialog open={!!sel} onOpenChange={() => setSel(null)} wide title={sel ? humanize(sel.type) : ''} description={sel ? `Detected ${formatDate(sel.created_at)}${sel.mode ? ` · ${sel.mode}` : ''}` : undefined}
        footer={canManage && <><Button variant="secondary" onClick={() => setSel(null)}>Close</Button><Button disabled={note.trim().length < 3} loading={update.isPending} onClick={() => update.mutate(undefined)}>Update status</Button></>}>
        {sel && (
          <div className="space-y-4">
            {update.error && <Alert tone="danger">{update.error.message}</Alert>}
            {sel.payment_id && <Link className="text-[13px] text-primary" to={`/transactions/${sel.payment_id}`}>Open payment {sel.payment_reference}</Link>}
            <pre className="max-h-48 overflow-auto rounded-md bg-surface p-3 font-mono text-[12px]">{JSON.stringify(sel.details, null, 2)}</pre>
            {sel.resolution_note && <p className="text-[13px] text-muted">Last note: {sel.resolution_note}{sel.resolved_by_email ? ` — ${sel.resolved_by_email}` : ''}</p>}
            {canManage && (
              <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
                <Field label="New status" htmlFor="ns"><Select id="ns" value={next} onChange={(e) => setNext(e.target.value)}>{['open', 'investigating', 'resolved'].filter((s) => s !== sel.status).map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select></Field>
                <Field label="Note (required)" htmlFor="nn"><Textarea id="nn" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}

// ------------------------------------------------------------------ Risk
interface RiskEvent { id: string; merchant_name: string | null; organization_id: string | null; rule: string; severity: string; status: string; subject_type: string | null; details: Record<string, unknown>; ip: string | null; created_at: string; risk_status: string | null }
export function RiskPage() {
  const [filter, setFilter] = useState('open');
  const q = useAdminQuery<RiskEvent[]>(['risk', filter], `/admin/risk?status=${filter}`);
  const canManage = useCan('risk.manage');
  const [sel, setSel] = useState<RiskEvent | null>(null);
  const [note, setNote] = useState('');
  const review = useAdminMutation((status: string) => api.patch(`/admin/risk/${sel!.id}`, { status, note }), () => { setSel(null); setNote(''); });
  return (
    <>
      <PageHeader title="Risk monitoring" description="Rule-based signals: velocity, large amounts, failure rates, new payout accounts. Signals flag for review; they never move money." />
      <Tabs className="mb-4" value={filter} onChange={setFilter} items={[{ value: 'open', label: 'Open' }, { value: 'reviewed', label: 'Reviewed' }, { value: 'dismissed', label: 'Dismissed' }, { value: '', label: 'All' }]} />
      <Card>{q.error ? <div className="p-4"><LoadError error={q.error} /></div> : (
        <DataTable rows={q.data} loading={q.isLoading} rowKey={(r) => r.id} onRowClick={setSel} empty={<EmptyState title="No risk events" />} columns={[
          { key: 'rule', header: 'Signal', primary: true, cell: (r) => <span className="font-medium">{humanize(r.rule)}</span> },
          { key: 'sev', header: 'Severity', cell: (r) => <StatusBadge status={r.severity} /> },
          { key: 'm', header: 'Merchant', cell: (r) => r.organization_id ? <Link onClick={(e) => e.stopPropagation()} className="text-primary" to={`/merchants/${r.organization_id}`}>{r.merchant_name}</Link> : '—' },
          { key: 'rs', header: 'Merchant risk', cell: (r) => r.risk_status ? <StatusBadge status={r.risk_status} /> : '—' },
          { key: 'st', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
          { key: 'd', header: 'Raised', cell: (r) => <span className="text-muted">{relativeTime(r.created_at)}</span> },
        ]} />
      )}</Card>
      <Dialog open={!!sel} onOpenChange={() => setSel(null)} title={sel ? humanize(sel.rule) : ''} description={sel ? `${sel.merchant_name ?? ''} · ${formatDate(sel.created_at)}${sel.ip ? ` · IP ${sel.ip}` : ''}` : undefined}
        footer={canManage && sel?.status === 'open' && <><Button variant="secondary" disabled={note.trim().length < 3} onClick={() => review.mutate('dismissed')}>Dismiss</Button><Button disabled={note.trim().length < 3} loading={review.isPending} onClick={() => review.mutate('reviewed')}>Mark reviewed</Button></>}>
        <pre className="max-h-48 overflow-auto rounded-md bg-surface p-3 font-mono text-[12px]">{JSON.stringify(sel?.details, null, 2)}</pre>
        {canManage && sel?.status === 'open' && <Field className="mt-4" label="Review note (required)" htmlFor="rn"><Textarea id="rn" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>}
        {sel?.organization_id && <p className="mt-3 text-[12.5px] text-muted">To restrict or block the merchant, use Change status on the <Link className="text-primary" to={`/merchants/${sel.organization_id}`}>merchant page</Link>.</p>}
      </Dialog>
    </>
  );
}

// ------------------------------------------------------------------ Logs
export function ApiLogsPage() {
  const q = useAdminQuery<{ id: string; request_id: string; method: string; path: string; status_code: number; latency_ms: number; ip: string; mode: string | null; merchant_name: string | null; created_at: string }[]>(['apilogs'], '/admin/logs/api?pageSize=100', { refetchInterval: 15_000 });
  return (
    <>
      <PageHeader title="API logs" description="Merchant API requests across the platform (bodies are viewable by the merchant; secrets are redacted)." />
      <Card>{q.error ? <div className="p-4"><LoadError error={q.error} /></div> : (
        <DataTable rows={q.data} loading={q.isLoading} rowKey={(l) => l.id} empty={<EmptyState title="No API requests yet" />} columns={[
          { key: 'r', header: 'Request', primary: true, cell: (l) => <span className="font-mono text-[12px]">{l.method} {l.path}</span> },
          { key: 's', header: 'Status', cell: (l) => <Badge className={l.status_code < 300 ? 'text-success' : l.status_code < 500 ? 'text-warning' : 'text-danger'}>{l.status_code}</Badge> },
          { key: 'm', header: 'Merchant', cell: (l) => l.merchant_name ?? '—' },
          { key: 'mode', header: 'Mode', hideOnMobile: true, cell: (l) => l.mode ?? '—' },
          { key: 'lat', header: 'Latency', cell: (l) => <span className="tabular">{l.latency_ms}ms</span> },
          { key: 'id', header: 'Request ID', hideOnMobile: true, cell: (l) => <span className="font-mono text-[11.5px] text-muted">{l.request_id}</span> },
          { key: 'd', header: 'Time', cell: (l) => <span className="text-muted">{formatDate(l.created_at)}</span> },
        ]} />
      )}</Card>
    </>
  );
}

interface Inbound { id: string; provider_code: string; external_event_id: string; event_type: string; signature_valid: boolean; processing_status: string; retry_count: number; error_message: string | null; created_at: string; processed_at: string | null }
interface Outbound { id: string; event_id: string; event_type: string; url: string; status: string; attempt_count: number; last_response_status: number | null; last_response_time_ms: number | null; last_error: string | null; merchant_name: string; created_at: string }
export function WebhookLogsPage() {
  const [tab, setTab] = useState<'inbound' | 'outbound'>('inbound');
  const q = useAdminQuery<{ inbound: Inbound[]; outbound: Outbound[] }>(['whlogs'], '/admin/logs/webhooks', { refetchInterval: 15_000 });
  const [sel, setSel] = useState<string | null>(null);
  const detail = useAdminQuery<Record<string, unknown>>(['whlog', sel], `/admin/logs/webhooks/${sel}`, { enabled: !!sel });
  return (
    <>
      <PageHeader title="Webhook logs" />
      <Tabs className="mb-4" value={tab} onChange={setTab} items={[{ value: 'inbound', label: 'Inbound (from providers)' }, { value: 'outbound', label: 'Outbound (to merchants)' }]} />
      {q.error && <LoadError error={q.error} />}
      <Card>
        {tab === 'inbound' ? (
          <DataTable rows={q.data?.inbound} loading={q.isLoading} rowKey={(e) => e.id} onRowClick={(e) => setSel(e.id)} empty={<EmptyState title="No provider webhooks yet" />} columns={[
            { key: 't', header: 'Event', primary: true, cell: (e) => <span className="font-mono text-[12px]">{e.event_type}</span> },
            { key: 'p', header: 'Provider', cell: (e) => e.provider_code },
            { key: 'sig', header: 'Signature', cell: (e) => <StatusBadge status={e.signature_valid ? 'succeeded' : 'failed'} label={e.signature_valid ? 'Valid' : 'Invalid'} /> },
            { key: 's', header: 'Processing', cell: (e) => <span title={e.error_message ?? undefined}><StatusBadge status={e.processing_status} /></span> },
            { key: 'r', header: 'Retries', align: 'right', cell: (e) => e.retry_count },
            { key: 'd', header: 'Received', cell: (e) => <span className="text-muted">{formatDate(e.created_at)}</span> },
            { key: 'pd', header: 'Processed', hideOnMobile: true, cell: (e) => <span className="text-muted">{formatDate(e.processed_at)}</span> },
          ]} />
        ) : (
          <DataTable rows={q.data?.outbound} loading={q.isLoading} rowKey={(e) => e.id} empty={<EmptyState title="No merchant webhook deliveries yet" />} columns={[
            { key: 't', header: 'Event', primary: true, cell: (e) => <span className="font-mono text-[12px]">{e.event_type}</span> },
            { key: 'm', header: 'Merchant', cell: (e) => e.merchant_name },
            { key: 'u', header: 'URL', hideOnMobile: true, cell: (e) => <span className="block max-w-[220px] truncate text-[12px]">{e.url}</span> },
            { key: 's', header: 'Status', cell: (e) => <span title={e.last_error ?? undefined}><StatusBadge status={e.status} /></span> },
            { key: 'c', header: 'Response', cell: (e) => e.last_response_status ?? '—' },
            { key: 'a', header: 'Attempts', align: 'right', cell: (e) => e.attempt_count },
            { key: 'd', header: 'Created', cell: (e) => <span className="text-muted">{formatDate(e.created_at)}</span> },
          ]} />
        )}
      </Card>
      <Dialog open={!!sel} onOpenChange={() => setSel(null)} wide title="Provider event">
        <pre className="max-h-[60vh] overflow-auto rounded-md bg-ink p-4 font-mono text-[12px] text-white/90">{JSON.stringify(detail.data, null, 2)}</pre>
      </Dialog>
    </>
  );
}

interface AuditRow { id: string; actor_type: string; actor_id: string | null; actor_email: string | null; merchant_name: string | null; action: string; target_type: string | null; target_id: string | null; ip: string | null; metadata: Record<string, unknown>; created_at: string }
export function AuditPage() {
  const [action, setAction] = useState('');
  const [term, setTerm] = useState('');
  const q = useAdminQuery<AuditRow[]>(['audit', term], `/admin/audit?pageSize=100${term ? `&action=${encodeURIComponent(term)}` : ''}`);
  const [sel, setSel] = useState<AuditRow | null>(null);
  if (!useCan('audit.view')) return <Forbidden />;
  return (
    <>
      <PageHeader title="Audit logs" description="Append-only record of every sensitive action. Entries cannot be edited or deleted." />
      <Card>
        <form className="border-b border-line p-4" onSubmit={(e) => { e.preventDefault(); setTerm(action); }}><Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Filter by action prefix, e.g. kyb. or ledger." className="sm:max-w-sm" aria-label="Filter actions" /></form>
        {q.error ? <div className="p-4"><LoadError error={q.error} /></div> : (
          <DataTable rows={q.data} loading={q.isLoading} rowKey={(a) => a.id} onRowClick={setSel} empty={<EmptyState title="No audit entries" />} columns={[
            { key: 'a', header: 'Action', primary: true, cell: (a) => <span className="font-mono text-[12.5px]">{a.action}</span> },
            { key: 'actor', header: 'Actor', cell: (a) => a.actor_email ?? `${a.actor_type}${a.actor_id ? `:${a.actor_id.slice(0, 8)}` : ''}` },
            { key: 'm', header: 'Merchant', cell: (a) => a.merchant_name ?? '—' },
            { key: 't', header: 'Target', hideOnMobile: true, cell: (a) => a.target_type ? `${a.target_type}` : '—' },
            { key: 'ip', header: 'IP', hideOnMobile: true, cell: (a) => <span className="font-mono text-[12px]">{a.ip ?? '—'}</span> },
            { key: 'd', header: 'Time', cell: (a) => <span className="text-muted">{formatDate(a.created_at)}</span> },
          ]} />
        )}
      </Card>
      <Dialog open={!!sel} onOpenChange={() => setSel(null)} wide title={sel?.action ?? ''} description={sel ? `${formatDate(sel.created_at)} · ${sel.target_type ?? ''} ${sel.target_id ?? ''}` : undefined}>
        <pre className="max-h-[60vh] overflow-auto rounded-md bg-surface p-4 font-mono text-[12px]">{JSON.stringify(sel?.metadata, null, 2)}</pre>
      </Dialog>
    </>
  );
}

// ------------------------------------------------------------------ System settings & staff
export function SettingsPage() {
  const { session } = useStaff();
  const settings = useAdminQuery<{ key: string; value: unknown; updated_at: string }[]>(['settings'], '/admin/settings');
  const staff = useAdminQuery<{ id: string; email: string; first_name: string; last_name: string; staff_roles: string[]; status: string; created_at: string }[]>(['staff'], '/admin/staff', { enabled: session.permissions.includes('staff.manage') });
  const jobs = useAdminQuery<{ queue: string; status: string; n: number; sample_error: string | null }[]>(['jobs'], '/admin/jobs');
  const [banner, setBanner] = useState<string | null>(null);
  const saveBanner = useAdminMutation(() => api.put('/admin/settings/maintenance_banner', { value: banner ?? '' }));
  const [adding, setAdding] = useState(false);
  const [nv, setNv] = useState({ email: '', firstName: '', lastName: '', roles: ['support_admin'] as string[] });
  const add = useAdminMutation(() => api.post('/admin/staff', nv), () => setAdding(false));
  const current = settings.data?.find((s) => s.key === 'maintenance_banner')?.value as string | undefined;
  if (!session.permissions.includes('settings.manage')) return <Forbidden />;
  return (
    <>
      <PageHeader title="System settings" />
      <div className="space-y-6">
        <Card><CardHeader title="Maintenance banner" description="Optional message shown to merchants (leave blank to hide)." />
          <div className="flex flex-col gap-2 p-5 sm:flex-row">
            <Input value={banner ?? current ?? ''} onChange={(e) => setBanner(e.target.value)} placeholder="e.g. Settlements are delayed due to a bank partner outage." />
            <Button loading={saveBanner.isPending} onClick={() => saveBanner.mutate(undefined)}>Save</Button>
          </div>
        </Card>
        <Card><CardHeader title="Background jobs (7 days)" description="Queue health for webhooks, notifications, settlements and reconciliation." />
          <div className="divide-y divide-line">{jobs.data?.map((j) => (
            <div key={j.queue + j.status} className="flex justify-between gap-4 px-5 py-2.5 text-[13px]"><span className="font-mono">{j.queue}</span><span className="flex items-center gap-3"><StatusBadge status={j.status === 'completed' ? 'succeeded' : j.status} label={humanize(j.status)} /><span className="tabular w-12 text-right">{j.n}</span></span></div>
          ))}</div>
        </Card>
        {session.permissions.includes('staff.manage') && (
          <Card><CardHeader title="Staff accounts" description="Each role grants only the permissions it needs." action={<Button size="sm" onClick={() => setAdding(true)}>Add staff</Button>} />
            <DataTable rows={staff.data} loading={staff.isLoading} rowKey={(s) => s.id} columns={[
              { key: 'n', header: 'Name', primary: true, cell: (s) => <div><div className="font-medium">{s.first_name} {s.last_name}</div><div className="text-[12px] text-muted">{s.email}</div></div> },
              { key: 'r', header: 'Roles', cell: (s) => s.staff_roles.map(humanize).join(', ') },
              { key: 's', header: 'Status', cell: (s) => <StatusBadge status={s.status === 'active' ? 'active' : 'disabled'} /> },
            ]} />
          </Card>
        )}
      </div>
      <Dialog open={adding} onOpenChange={setAdding} title="Add staff member" description="They'll receive an email to set their password."
        footer={<><Button variant="secondary" onClick={() => setAdding(false)}>Cancel</Button><Button loading={add.isPending} disabled={!nv.email || !nv.roles.length} onClick={() => add.mutate(undefined)}>Create</Button></>}>
        <div className="space-y-4">
          {add.error && <Alert tone="danger">{add.error.message}</Alert>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name" htmlFor="sf"><Input id="sf" value={nv.firstName} onChange={(e) => setNv({ ...nv, firstName: e.target.value })} /></Field>
            <Field label="Last name" htmlFor="sl"><Input id="sl" value={nv.lastName} onChange={(e) => setNv({ ...nv, lastName: e.target.value })} /></Field>
          </div>
          <Field label="Email" htmlFor="se"><Input id="se" type="email" value={nv.email} onChange={(e) => setNv({ ...nv, email: e.target.value })} /></Field>
          <fieldset><legend className="text-[13px] font-medium text-ink-2">Roles</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">{STAFF_ROLES.map((r) => (
              <label key={r} className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="accent-[#1546e0]" checked={nv.roles.includes(r)} onChange={(e) => setNv({ ...nv, roles: e.target.checked ? [...nv.roles, r] : nv.roles.filter((x) => x !== r) })} />{humanize(r)}</label>
            ))}</div>
          </fieldset>
        </div>
      </Dialog>
    </>
  );
}
