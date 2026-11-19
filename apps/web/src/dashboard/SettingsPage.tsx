import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Landmark, Plus, Trash2 } from 'lucide-react';
import { MERCHANT_ROLES } from '@app/shared';
import {
  Alert, Button, Card, CardHeader, DataTable, Dialog, EmptyState, Field, Input, PageHeader, Select, StatusBadge, Tabs, formatDate, humanize, relativeTime, buttonVariants, type Column,
} from '@app/ui';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useSubmit, formValues } from '../auth/forms';
import { useOnboarding } from './OnboardingPage';

type Tab = 'business' | 'bank' | 'team' | 'security' | 'preferences';

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'business';
  return (
    <>
      <PageHeader title="Settings" />
      <Tabs className="mb-6" value={tab} onChange={(t) => setParams({ tab: t })} items={[
        { value: 'business', label: 'Business' }, { value: 'bank', label: 'Bank accounts' }, { value: 'team', label: 'Team' },
        { value: 'security', label: 'Security' }, { value: 'preferences', label: 'Settlement' },
      ]} />
      {tab === 'business' && <Business />}
      {tab === 'bank' && <Card><CardHeader title="Settlement bank accounts" description="Settlements and withdrawals are paid to these accounts." /><BankAccounts /></Card>}
      {tab === 'team' && <Team />}
      {tab === 'security' && <Security />}
      {tab === 'preferences' && <Preferences />}
    </>
  );
}

function Business() {
  const q = useOnboarding();
  const { session } = useSession();
  const p = q.data?.profile;
  return (
    <Card>
      <CardHeader title="Business profile" action={<Link to="/dashboard/onboarding" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>{session.organization?.kybStatus === 'approved' ? 'View verification' : 'Edit & verify'}</Link>} />
      <div className="grid gap-x-8 gap-y-4 p-5 sm:grid-cols-2">
        {[['Business name', session.organization?.name], ['Verification', <StatusBadge key="k" status={session.organization?.kybStatus ?? 'not_started'} />], ['Business email', p?.businessEmail], ['Business phone', p?.businessPhone], ['Registration number', p?.registrationNumber], ['Address', p?.address]].map(([k, v]) => (
          <div key={String(k)}><div className="text-[12.5px] text-muted">{k}</div><div className="mt-0.5 text-[14px] text-ink">{v || '—'}</div></div>
        ))}
      </div>
    </Card>
  );
}

interface Bank { id: string; bank_name: string; account_number_last4: string; account_name: string; is_default: boolean; created_at: string }

export function BankAccounts({ embedded }: { embedded?: boolean }) {
  const qc = useQueryClient();
  const { session } = useSession();
  const canManage = session.permissions.includes('settings.manage');
  const q = useQuery({ queryKey: ['bank-accounts'], queryFn: () => api.get<Bank[]>('/dashboard/settings/bank-accounts') });
  const banks = useQuery({ queryKey: ['banks'], queryFn: () => api.get<{ code: string; name: string }[]>('/dashboard/settings/banks'), staleTime: Infinity });
  const [adding, setAdding] = useState(false);
  const invalidate = () => qc.invalidateQueries();
  const makeDefault = useMutation({ mutationFn: (id: string) => api.post(`/dashboard/settings/bank-accounts/${id}/default`), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/dashboard/settings/bank-accounts/${id}`), onSuccess: invalidate });
  const { submit, loading, error, fieldErrors } = useSubmit(async (v: Record<string, string>) => {
    await api.post('/dashboard/settings/bank-accounts', v);
    setAdding(false);
    await invalidate();
  });
  return (
    <>
      {q.data?.length === 0 && !adding ? (
        <EmptyState icon={<Landmark className="h-5 w-5" />} title="No settlement account" description="Add the business bank account you want to be paid into." action={canManage && <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add bank account</Button>} />
      ) : (
        <div className="divide-y divide-line">
          {q.data?.map((b) => (
            <div key={b.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-[14px] font-medium text-ink">{b.bank_name} ••••{b.account_number_last4}{b.is_default && <StatusBadge status="active" label="Default" />}</div>
                <div className="text-[12.5px] text-muted">{b.account_name} · added {formatDate(b.created_at, { time: false })}</div>
              </div>
              {canManage && !b.is_default && (
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => makeDefault.mutate(b.id)}>Make default</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove.mutate(b.id)} aria-label="Remove"><Trash2 className="h-4 w-4" /></Button>
                </div>
              )}
            </div>
          ))}
          {canManage && !adding && <div className="px-5 py-3"><Button size="sm" variant="secondary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add another account</Button></div>}
        </div>
      )}
      {adding && (
        <form className="space-y-4 border-t border-line p-5" onSubmit={(e) => { e.preventDefault(); void submit(formValues(e.currentTarget)); }} noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Bank" htmlFor="bankCode" error={fieldErrors.bankCode}>
              <Select id="bankCode" name="bankCode" required defaultValue="">
                <option value="" disabled>Select bank</option>
                {banks.data?.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
              </Select>
            </Field>
            <Field label="Account number" htmlFor="accountNumber" error={fieldErrors.accountNumber} hint="10-digit NUBAN. We'll confirm the account name with the bank.">
              <Input id="accountNumber" name="accountNumber" inputMode="numeric" maxLength={10} required />
            </Field>
          </div>
          <div className="flex gap-2"><Button type="submit" loading={loading}>Verify & add</Button><Button type="button" variant="secondary" onClick={() => setAdding(false)}>Cancel</Button></div>
          {!embedded && <p className="text-[12.5px] text-muted">For your security, withdrawals to a newly added account may be held for review for 24 hours.</p>}
        </form>
      )}
    </>
  );
}

interface Member { id: string; email: string; role: string; status: string; first_name: string | null; last_name: string | null; created_at: string }

function Team() {
  const qc = useQueryClient();
  const { session } = useSession();
  const canManage = session.permissions.includes('team.manage');
  const q = useQuery({ queryKey: ['team'], queryFn: () => api.get<Member[]>('/dashboard/settings/team') });
  const [inviting, setInviting] = useState(false);
  const changeRole = useMutation({ mutationFn: ({ id, role }: { id: string; role: string }) => api.patch(`/dashboard/settings/team/${id}`, { role }), onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }) });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/dashboard/settings/team/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }) });
  const { submit, loading, error, fieldErrors } = useSubmit(async (v: Record<string, string>) => {
    await api.post('/dashboard/settings/team/invites', v);
    setInviting(false);
    await qc.invalidateQueries({ queryKey: ['team'] });
  });
  const columns: Column<Member>[] = [
    { key: 'name', header: 'Member', primary: true, cell: (m) => <div><div className="font-medium">{m.first_name ? `${m.first_name} ${m.last_name}` : m.email}</div>{m.first_name && <div className="text-[12px] text-muted">{m.email}</div>}</div> },
    {
      key: 'role', header: 'Role', cell: (m) => canManage && m.role !== 'owner'
        ? <Select className="h-8 w-36 text-[13px]" value={m.role} onChange={(e) => changeRole.mutate({ id: m.id, role: e.target.value })} aria-label="Role">{MERCHANT_ROLES.filter((r) => r !== 'owner').map((r) => <option key={r} value={r}>{humanize(r)}</option>)}</Select>
        : humanize(m.role),
    },
    { key: 'status', header: 'Status', cell: (m) => <StatusBadge status={m.status} /> },
    { key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right', cell: (m) => canManage && m.role !== 'owner' && <Button size="sm" variant="ghost" className="text-danger" onClick={() => remove.mutate(m.id)}>Remove</Button> },
  ];
  return (
    <Card>
      <CardHeader title="Team members" description="Owners and admins manage everything; developers manage API keys and webhooks; finance handles refunds and withdrawals; viewers can only view." action={canManage && <Button size="sm" onClick={() => setInviting(true)}><Plus className="h-4 w-4" />Invite</Button>} />
      <DataTable columns={columns} rows={q.data} loading={q.isLoading} rowKey={(m) => m.id} />
      <Dialog open={inviting} onOpenChange={setInviting} title="Invite a team member">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(formValues(e.currentTarget)); }} noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Email" htmlFor="iemail" error={fieldErrors.email}><Input id="iemail" name="email" type="email" required /></Field>
          <Field label="Role" htmlFor="irole"><Select id="irole" name="role" defaultValue="developer">{MERCHANT_ROLES.filter((r) => r !== 'owner').map((r) => <option key={r} value={r}>{humanize(r)}</option>)}</Select></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setInviting(false)}>Cancel</Button><Button type="submit" loading={loading}>Send invitation</Button></div>
        </form>
      </Dialog>
    </Card>
  );
}

interface SessionRow { id: string; ip: string | null; user_agent: string | null; created_at: string; last_seen_at: string; current: boolean }

function Security() {
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<SessionRow[]>('/auth/sessions') });
  const revoke = useMutation({ mutationFn: (id: string) => api.del(`/auth/sessions/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }) });
  const [done, setDone] = useState(false);
  const { submit, loading, error, fieldErrors, setError } = useSubmit(async (v: Record<string, string>) => {
    if (v.newPassword !== v.confirm) { setError('New passwords do not match.'); return; }
    await api.post('/auth/change-password', { currentPassword: v.currentPassword, newPassword: v.newPassword });
    setDone(true);
    await qc.invalidateQueries({ queryKey: ['sessions'] });
  });
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Change password" description="Changing your password signs out all other sessions." />
        <form className="space-y-4 p-5 sm:max-w-md" onSubmit={(e) => { e.preventDefault(); setDone(false); void submit(formValues(e.currentTarget)); e.currentTarget.reset(); }} noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          {done && <Alert tone="success">Password changed.</Alert>}
          <Field label="Current password" htmlFor="currentPassword"><Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required /></Field>
          <Field label="New password" htmlFor="newPassword" error={fieldErrors.newPassword}><Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required /></Field>
          <Field label="Confirm new password" htmlFor="confirm"><Input id="confirm" name="confirm" type="password" autoComplete="new-password" required /></Field>
          <Button type="submit" loading={loading}>Update password</Button>
        </form>
      </Card>
      <Card>
        <CardHeader title="Active sessions" description="Devices currently signed in to your account." />
        <div className="divide-y divide-line">
          {sessions.data?.map((s) => (
            <div key={s.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="truncate text-[13.5px] text-ink">{describeAgent(s.user_agent)} {s.current && <StatusBadge status="active" label="This device" className="ml-1" />}</div>
                <div className="text-[12px] text-muted">{s.ip ?? 'Unknown IP'} · active {relativeTime(s.last_seen_at)} · signed in {formatDate(s.created_at)}</div>
              </div>
              {!s.current && <Button size="sm" variant="secondary" onClick={() => revoke.mutate(s.id)}>Sign out</Button>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function describeAgent(ua: string | null) {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return `${browser}${os ? ` on ${os}` : ''}`;
}

function Preferences() {
  const qc = useQueryClient();
  const { session } = useSession();
  const balance = useQuery({ queryKey: [session.mode, 'balance'], queryFn: () => api.get<{ settlementSchedule: string }>('/dashboard/balance') });
  const m = useMutation({ mutationFn: (schedule: string) => api.put('/dashboard/settings/settlement-schedule', { schedule }), onSuccess: () => qc.invalidateQueries() });
  const cur = balance.data?.settlementSchedule;
  const options = [
    ['t1', 'Automatic next-day settlement (T+1)', 'Confirmed payments are paid to your default bank account the next day.'],
    ['manual', 'Hold in balance', 'Funds become available in your balance and you withdraw on demand.'],
  ];
  return (
    <Card>
      <CardHeader title="Settlement schedule" description="Same-day (T+0) settlement is available for eligible businesses — contact support." />
      <div className="space-y-3 p-5">
        {m.error && <Alert tone="danger">{m.error.message}</Alert>}
        {cur === 't0' && <Alert tone="info">Your account is on same-day (T+0) settlement, configured by our team.</Alert>}
        {options.map(([v, t, d]) => (
          <label key={v} className="flex cursor-pointer gap-3 rounded-md border border-line p-4 has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
            <input type="radio" name="schedule" className="mt-1 accent-[#1546e0]" checked={cur === v} disabled={!session.permissions.includes('settings.manage') || m.isPending} onChange={() => m.mutate(v)} />
            <span><span className="block text-[14px] font-medium text-ink">{t}</span><span className="block text-[13px] text-muted">{d}</span></span>
          </label>
        ))}
      </div>
    </Card>
  );
}
