import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, RotateCw, Send, Webhook } from 'lucide-react';
import { WEBHOOK_EVENT_TYPES, BRAND } from '@app/shared';
import {
  Alert, Badge, Button, Card, CardHeader, CopyButton, DataTable, Dialog, EmptyState, Field, Input, PageHeader, StatusBadge, Tabs, formatDate, relativeTime, cn, type Column,
} from '@app/ui';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useModeQuery, QueryError } from './shared';

type Tab = 'keys' | 'webhooks' | 'logs';

export default function DevelopersPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'keys';
  const { session } = useSession();
  if (!session.permissions.includes('developers.manage')) {
    return <><PageHeader title="Developers" /><Alert tone="info">Your role doesn't include developer access. Ask an owner or admin to grant the Developer role.</Alert></>;
  }
  return (
    <>
      <PageHeader title="Developers" description={<>Integrate the API, receive webhooks and inspect requests. You're in <strong className={session.mode === 'live' ? 'text-success' : 'text-warning'}>{session.mode.toUpperCase()}</strong> mode; keys and logs are separate per mode.</>} />
      <Tabs className="mb-6" value={tab} onChange={(t) => setParams({ tab: t })} items={[{ value: 'keys', label: 'API keys' }, { value: 'webhooks', label: 'Webhooks' }, { value: 'logs', label: 'API logs' }]} />
      {tab === 'keys' && <ApiKeys />}
      {tab === 'webhooks' && <Webhooks />}
      {tab === 'logs' && <Logs />}
    </>
  );
}

interface KeyRow { id: string; kind: 'secret' | 'public'; prefix: string; last4: string; public_value: string | null; last_used_at: string | null; revoked_at: string | null; created_at: string }

function ApiKeys() {
  const { session } = useSession();
  const qc = useQueryClient();
  const q = useModeQuery<KeyRow[]>(['keys'], '/dashboard/settings/developers/keys');
  const [revealed, setRevealed] = useState<{ secretKey: string; publicKey: string } | null>(null);
  const [confirm, setConfirm] = useState<'rotate' | 'revoke' | null>(null);
  const generate = useMutation({
    mutationFn: () => api.post<{ secretKey: string; publicKey: string }>('/dashboard/settings/developers/keys'),
    onSuccess: (r) => { setRevealed(r); setConfirm(null); void qc.invalidateQueries(); },
  });
  const revoke = useMutation({ mutationFn: () => api.post('/dashboard/settings/developers/keys/revoke'), onSuccess: () => { setConfirm(null); void qc.invalidateQueries(); } });
  const active = q.data?.filter((k) => !k.revoked_at) ?? [];
  const secret = active.find((k) => k.kind === 'secret');
  const pub = active.find((k) => k.kind === 'public');

  return (
    <div className="space-y-6">
      {q.error && <QueryError error={q.error} />}
      <Card>
        <CardHeader title={`${session.mode === 'live' ? 'Live' : 'Test'} keys`} description="Secret keys authenticate server-side API requests. Never expose them in a browser or app."
          action={secret ? <Button variant="secondary" size="sm" onClick={() => setConfirm('rotate')}><RotateCw className="h-3.5 w-3.5" />Rotate</Button> : undefined} />
        {!secret && !q.isLoading ? (
          <EmptyState icon={<KeyRound className="h-5 w-5" />} title="Connect your API and start accepting payments" description={`Generate a ${session.mode} secret key to authenticate requests to the ${BRAND.name} API.`}
            action={<Button loading={generate.isPending} onClick={() => generate.mutate()}>Generate {session.mode} keys</Button>} />
        ) : (
          <div className="divide-y divide-line">
            {secret && <KeyLine label="Secret key" value={`${secret.prefix}${'•'.repeat(24)}${secret.last4}`} meta={`Created ${formatDate(secret.created_at)} · ${secret.last_used_at ? `last used ${relativeTime(secret.last_used_at)}` : 'never used'}`} />}
            {pub && <KeyLine label="Public key" value={pub.public_value ?? ''} copy meta="Safe to use in client-side code (reserved for upcoming client SDKs)." />}
          </div>
        )}
        {generate.error && <div className="px-5 pb-4"><Alert tone="danger">{generate.error.message}</Alert></div>}
        {secret && <div className="border-t border-line px-5 py-3 text-right"><Button variant="link" className="text-danger" onClick={() => setConfirm('revoke')}>Revoke all {session.mode} keys</Button></div>}
      </Card>

      <Dialog open={!!revealed} onOpenChange={() => setRevealed(null)} title="Save your secret key" description="This is the only time the full secret key will be shown. Store it in your server's secret manager." footer={<Button onClick={() => setRevealed(null)}>I've saved it</Button>}>
        <div className="space-y-3">
          <div className="rounded-md border border-line bg-surface p-3"><div className="text-[12px] text-muted">Secret key</div><div className="mt-1 break-all font-mono text-[12.5px]">{revealed?.secretKey}</div><CopyButton className="mt-2" value={revealed?.secretKey ?? ''} variant="primary" /></div>
        </div>
      </Dialog>
      <Dialog open={!!confirm} onOpenChange={() => setConfirm(null)} title={confirm === 'rotate' ? 'Rotate secret key?' : 'Revoke keys?'}
        description={confirm === 'rotate' ? 'A new key is created and the current key stops working immediately. Update your servers right away.' : 'All requests using these keys will fail until you generate new ones.'}
        footer={<><Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="danger" loading={generate.isPending || revoke.isPending} onClick={() => (confirm === 'rotate' ? generate.mutate() : revoke.mutate())}>{confirm === 'rotate' ? 'Rotate key' : 'Revoke'}</Button></>} />
    </div>
  );
}

function KeyLine({ label, value, meta, copy }: { label: string; value: string; meta: string; copy?: boolean }) {
  return (
    <div className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0"><div className="text-[13px] font-medium text-ink">{label}</div><div className="mt-1 truncate font-mono text-[12.5px] text-ink-2">{value}</div><div className="mt-1 text-[12px] text-muted">{meta}</div></div>
      {copy && <CopyButton value={value} />}
    </div>
  );
}

interface HookConfig { id: string; url: string; events: string[]; enabled: boolean; secret_last4: string }
interface Delivery { id: string; event_id: string; event_type: string; status: string; attempt_count: number; last_response_status: number | null; last_response_time_ms: number | null; last_error: string | null; created_at: string; next_attempt_at: string | null; payload: unknown }

function Webhooks() {
  const qc = useQueryClient();
  const hook = useModeQuery<HookConfig | null>(['webhook'], '/dashboard/settings/developers/webhook');
  const deliveries = useModeQuery<{ items: Delivery[] }>(['deliveries'], '/dashboard/settings/developers/webhook/deliveries', { refetchInterval: 10_000 });
  const [url, setUrl] = useState<string | null>(null);
  const [events, setEvents] = useState<string[] | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [inspect, setInspect] = useState<Delivery | null>(null);
  const cur = hook.data;
  const formUrl = url ?? cur?.url ?? '';
  const formEvents = events ?? cur?.events ?? ['payment.success', 'payment.failed'];
  const save = useMutation({
    mutationFn: () => api.put<{ secret: string | null }>('/dashboard/settings/developers/webhook', { url: formUrl, events: formEvents, enabled: true }),
    onSuccess: (r) => { if (r.secret) setNewSecret(r.secret); void qc.invalidateQueries(); },
  });
  const rotate = useMutation({ mutationFn: () => api.post<{ secret: string }>('/dashboard/settings/developers/webhook/rotate-secret'), onSuccess: (r) => setNewSecret(r.secret) });
  const toggleEnabled = useMutation({ mutationFn: () => api.put('/dashboard/settings/developers/webhook', { url: cur!.url, events: cur!.events, enabled: !cur!.enabled }), onSuccess: () => qc.invalidateQueries() });
  const test = useMutation({ mutationFn: () => api.post('/dashboard/settings/developers/webhook/test'), onSuccess: () => setTimeout(() => qc.invalidateQueries({ queryKey: [] }), 1500) });
  const retry = useMutation({ mutationFn: (id: string) => api.post(`/dashboard/settings/developers/webhook/deliveries/${id}/retry`), onSuccess: () => setTimeout(() => qc.invalidateQueries(), 1500) });

  const columns: Column<Delivery>[] = [
    { key: 'type', header: 'Event', primary: true, cell: (d) => <span className="font-mono text-[12.5px]">{d.event_type}</span> },
    { key: 'status', header: 'Status', cell: (d) => <StatusBadge status={d.status} /> },
    { key: 'code', header: 'Response', cell: (d) => d.last_response_status ? <span className={cn('tabular', d.last_response_status < 300 ? 'text-success' : 'text-danger')}>{d.last_response_status}</span> : <span className="text-muted">{d.last_error ? 'Error' : '—'}</span> },
    { key: 'time', header: 'Response time', hideOnMobile: true, cell: (d) => d.last_response_time_ms !== null ? <span className="tabular">{d.last_response_time_ms}ms</span> : '—' },
    { key: 'attempts', header: 'Attempts', cell: (d) => <span className="tabular">{d.attempt_count}</span> },
    { key: 'date', header: 'Created', cell: (d) => <span className="text-muted">{relativeTime(d.created_at)}</span> },
    { key: 'retry', header: <span className="sr-only">Retry</span>, align: 'right', hideOnMobile: true, cell: (d) => d.status !== 'succeeded' && <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); retry.mutate(d.id); }}>Retry</Button> },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Endpoint" description="We send signed POST requests for the events you choose."
          action={cur && <div className="flex items-center gap-2"><StatusBadge status={cur.enabled ? 'active' : 'disabled'} /><Button size="sm" variant="secondary" onClick={() => toggleEnabled.mutate()}>{cur.enabled ? 'Disable' : 'Enable'}</Button></div>} />
        <div className="space-y-5 p-5">
          {save.error && <Alert tone="danger">{save.error.message}</Alert>}
          <Field label="Webhook URL" htmlFor="hookurl" hint="Must be HTTPS and respond with 2xx within 10 seconds.">
            <Input id="hookurl" value={formUrl} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/webhooks/payments" />
          </Field>
          <fieldset>
            <legend className="text-[13px] font-medium text-ink-2">Events</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {WEBHOOK_EVENT_TYPES.map((e) => (
                <label key={e} className="flex cursor-pointer items-center gap-2.5 rounded-md border border-line px-3 py-2 text-[13px] has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
                  <input type="checkbox" className="accent-[#1546e0]" checked={formEvents.includes(e)} onChange={(ev) => setEvents(ev.target.checked ? [...formEvents, e] : formEvents.filter((x) => x !== e))} />
                  <span className="font-mono text-[12px]">{e}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {cur && (
            <div className="flex flex-wrap items-center gap-3 rounded-md bg-surface px-4 py-3 text-[13px]">
              <span className="text-muted">Signing secret</span><span className="font-mono">whsec_••••••••{cur.secret_last4}</span>
              <Button size="sm" variant="ghost" loading={rotate.isPending} onClick={() => rotate.mutate()}><RotateCw className="h-3.5 w-3.5" />Rotate</Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button loading={save.isPending} disabled={!formUrl || formEvents.length === 0} onClick={() => save.mutate()}>{cur ? 'Save changes' : 'Add endpoint'}</Button>
            {cur && <Button variant="secondary" loading={test.isPending} onClick={() => test.mutate()}><Send className="h-4 w-4" />Send test event</Button>}
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Delivery logs" description="Every attempt with its response. Failed deliveries retry automatically with exponential backoff." />
        {deliveries.error ? <div className="p-4"><QueryError error={deliveries.error} /></div> : (
          <DataTable columns={columns} rows={deliveries.data?.items} loading={deliveries.isLoading} rowKey={(d) => d.id} onRowClick={setInspect}
            empty={<EmptyState icon={<Webhook className="h-5 w-5" />} title="No deliveries yet" description="Add an endpoint and send a test event to see deliveries here." />} />
        )}
      </Card>
      <Dialog open={!!newSecret} onOpenChange={() => setNewSecret(null)} title="Webhook signing secret" description="Store this secret on your server to verify signatures. It won't be shown again." footer={<Button onClick={() => setNewSecret(null)}>Done</Button>}>
        <div className="break-all rounded-md border border-line bg-surface p-3 font-mono text-[12.5px]">{newSecret}</div>
        <CopyButton className="mt-3" value={newSecret ?? ''} variant="primary" />
      </Dialog>
      <Dialog open={!!inspect} onOpenChange={() => setInspect(null)} title={inspect?.event_type ?? ''} wide description={inspect ? `${inspect.event_id} · ${formatDate(inspect.created_at)}` : undefined}
        footer={inspect?.status !== 'succeeded' && <Button variant="secondary" onClick={() => { retry.mutate(inspect!.id); setInspect(null); }}>Retry now</Button>}>
        {inspect?.last_error && <Alert tone="danger" className="mb-3">{inspect.last_error}</Alert>}
        <pre className="max-h-96 overflow-auto rounded-md bg-ink p-4 font-mono text-[12px] text-white/90">{JSON.stringify(inspect?.payload, null, 2)}</pre>
      </Dialog>
    </div>
  );
}

interface LogRow { id: string; request_id: string; method: string; path: string; status_code: number; latency_ms: number; ip: string; idempotency_key: string | null; request_body: unknown; response_body: unknown; created_at: string }

function Logs() {
  const q = useModeQuery<{ items: LogRow[] }>(['api-logs'], '/dashboard/settings/developers/logs?pageSize=100', { refetchInterval: 15_000 });
  const [open, setOpen] = useState<LogRow | null>(null);
  const columns: Column<LogRow>[] = [
    { key: 'req', header: 'Request', primary: true, cell: (l) => <span className="font-mono text-[12.5px]"><span className={l.method === 'GET' ? 'text-success' : 'text-primary'}>{l.method}</span> {l.path}</span> },
    { key: 'status', header: 'Status', cell: (l) => <Badge className={cn(l.status_code < 300 ? 'border-success/30 text-success' : l.status_code < 500 ? 'border-warning/30 text-warning' : 'border-danger/30 text-danger')}>{l.status_code}</Badge> },
    { key: 'latency', header: 'Latency', cell: (l) => <span className="tabular">{l.latency_ms}ms</span> },
    { key: 'id', header: 'Request ID', hideOnMobile: true, cell: (l) => <span className="font-mono text-[12px] text-muted">{l.request_id}</span> },
    { key: 'time', header: 'Time', cell: (l) => <span className="text-muted">{formatDate(l.created_at)}</span> },
  ];
  return (
    <Card>
      {q.error ? <div className="p-4"><QueryError error={q.error} /></div> : (
        <DataTable columns={columns} rows={q.data?.items} loading={q.isLoading} rowKey={(l) => l.id} onRowClick={setOpen}
          empty={<EmptyState title="No API requests yet" description="Requests made with your secret key will be logged here with their responses." />} />
      )}
      <Dialog open={!!open} onOpenChange={() => setOpen(null)} wide title={open ? `${open.method} ${open.path}` : ''} description={open ? `${open.request_id} · ${open.status_code} · ${open.latency_ms}ms` : undefined}>
        <div className="space-y-3">
          <div><div className="mb-1 text-[12px] font-medium text-muted">Request body (sensitive fields redacted)</div><pre className="max-h-60 overflow-auto rounded-md bg-ink p-3 font-mono text-[12px] text-white/90">{JSON.stringify(open?.request_body, null, 2)}</pre></div>
          <div><div className="mb-1 text-[12px] font-medium text-muted">Response body</div><pre className="max-h-60 overflow-auto rounded-md bg-ink p-3 font-mono text-[12px] text-white/90">{JSON.stringify(open?.response_body, null, 2)}</pre></div>
        </div>
      </Dialog>
    </Card>
  );
}
