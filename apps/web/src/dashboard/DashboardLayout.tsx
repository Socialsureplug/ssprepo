import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import {
  LayoutGrid, ArrowLeftRight, Link2, Users, Wallet, Landmark, Code2, Settings, Bell, Search, Menu, X, LogOut, ChevronDown, ShieldCheck, Mail,
} from 'lucide-react';
import { formatMoney, type PaymentDTO } from '@app/shared';
import { Logo, cn, relativeTime, StatusBadge, Spinner, Alert, Button } from '@app/ui';
import { api } from '../lib/api';
import { useSession } from '../lib/session';

const NAV = [
  { to: '/dashboard', label: 'Overview', icon: LayoutGrid, end: true },
  { to: '/dashboard/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { to: '/dashboard/payment-links', label: 'Payment Links', icon: Link2 },
  { to: '/dashboard/customers', label: 'Customers', icon: Users },
  { to: '/dashboard/balance', label: 'Balance', icon: Wallet },
  { to: '/dashboard/settlements', label: 'Settlements', icon: Landmark },
  { to: '/dashboard/developers', label: 'Developers', icon: Code2 },
  { to: '/dashboard/settings', label: 'Settings', icon: Settings },
];

export default function DashboardLayout() {
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  const kyb = session.organization?.kybStatus;

  return (
    <div className="min-h-screen bg-white lg:grid lg:grid-cols-[240px_1fr]">
      {/* Sidebar */}
      <aside className={cn(
        'fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col border-r border-line bg-surface transition-transform lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-auto lg:translate-x-0',
        open ? 'translate-x-0 shadow-pop' : '-translate-x-full',
      )}>
        <div className="flex h-16 items-center justify-between px-5">
          <Link to="/dashboard"><Logo /></Link>
          <button className="rounded-md p-1.5 lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
        </div>
        <div className="px-3 pb-3">
          <div className="rounded-md border border-line bg-white px-3 py-2.5">
            <div className="truncate text-[13.5px] font-semibold text-ink">{session.organization?.name}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
              <ShieldCheck className={cn('h-3.5 w-3.5', kyb === 'approved' ? 'text-success' : 'text-subtle')} />
              {kyb === 'approved' ? 'Verified business' : 'Verification required for live'}
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="Dashboard">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => cn('flex items-center gap-3 rounded-md px-3 py-2 text-[14px] transition-colors',
                isActive ? 'bg-white font-medium text-ink shadow-card ring-1 ring-line' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')}>
              {({ isActive }) => (<><n.icon className={cn('h-4 w-4', isActive ? 'text-primary' : 'text-muted')} />{n.label}</>)}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line p-4 text-[12px] text-muted">
          Need help? <a href="mailto:support@example.com" className="text-primary">Contact support</a>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-40 bg-ink/30 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}

      <div className="flex min-w-0 flex-col">
        {session.mode === 'test' && (
          <div className="flex items-center justify-center gap-2 bg-warning px-4 py-1 text-[12px] font-medium text-white">
            Test mode — you're viewing test data. No real money moves.
          </div>
        )}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-white/95 px-4 backdrop-blur sm:px-6">
          <button className="rounded-md p-1.5 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-1.5 sm:gap-3">
            <ModeSwitch />
            <Notifications />
            <ProfileMenu />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
          {!session.user.emailVerified && <VerifyEmailBanner />}
          {kyb !== 'approved' && location.pathname !== '/dashboard/onboarding' && <KybBanner status={kyb ?? 'not_started'} />}
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function VerifyEmailBanner() {
  const resend = useMutation({ mutationFn: () => api.post('/auth/resend-verification') });
  return (
    <Alert tone="info" className="mb-6" title="Confirm your email address"
      action={<Button size="sm" variant="secondary" loading={resend.isPending} disabled={resend.isSuccess} onClick={() => resend.mutate()}><Mail className="h-3.5 w-3.5" />{resend.isSuccess ? 'Sent' : 'Resend link'}</Button>}>
      We sent a verification link to your inbox. Verify to submit your business for review and manage team and bank settings.
    </Alert>
  );
}

function KybBanner({ status }: { status: string }) {
  const copy: Record<string, [string, string]> = {
    not_started: ['Activate live payments', 'Complete your business profile and submit it for verification to accept real payments.'],
    rejected: ['Verification needs attention', 'Your submission could not be approved. Review the feedback and resubmit.'],
    pending: ['Verification submitted', 'We are reviewing your business. You can keep integrating in test mode.'],
    under_review: ['Verification in review', 'Our team is reviewing your business. You can keep integrating in test mode.'],
    restricted: ['Account restricted', 'Live processing is restricted on this account. Contact support for details.'],
  };
  const [title, body] = copy[status] ?? copy.not_started;
  const actionable = status === 'not_started' || status === 'rejected';
  return (
    <Alert tone={status === 'restricted' || status === 'rejected' ? 'warning' : 'info'} className="mb-6" title={title}
      action={actionable && <Link to="/dashboard/onboarding"><Button size="sm">{status === 'rejected' ? 'Review & resubmit' : 'Start verification'}</Button></Link>}>
      {body}
    </Alert>
  );
}

function ModeSwitch() {
  const { session } = useSession();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const live = session.mode === 'live';
  const canLive = session.organization?.kybStatus === 'approved' && session.organization?.liveEnabled;
  const m = useMutation({
    mutationFn: (mode: 'test' | 'live') => api.post('/auth/mode', { mode }),
    onSuccess: () => qc.invalidateQueries(),
    onError: (e: Error) => { setError(e.message); setTimeout(() => setError(null), 4000); },
  });
  return (
    <div className="relative">
      <div className="flex items-center rounded-md border border-line p-0.5 text-[12px] font-semibold" role="group" aria-label="Environment">
        <button onClick={() => live && m.mutate('test')} className={cn('rounded px-2.5 py-1 transition-colors', !live ? 'bg-warning text-white' : 'text-muted hover:text-ink')} aria-pressed={!live}>TEST</button>
        <button onClick={() => !live && m.mutate('live')} title={canLive ? 'Switch to live mode' : 'Live mode unlocks after verification'}
          className={cn('rounded px-2.5 py-1 transition-colors', live ? 'bg-success text-white' : 'text-muted hover:text-ink', !canLive && !live && 'cursor-not-allowed opacity-60')} aria-pressed={live}>LIVE</button>
      </div>
      {error && <div className="absolute right-0 top-10 z-50 w-64 rounded-md border border-line bg-white p-3 text-[12.5px] text-ink-2 shadow-pop">{error}</div>}
    </div>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const navigate = useNavigate();
  const { session } = useSession();
  const ref = useRef<HTMLDivElement>(null);
  const term = q.trim();
  const results = useQuery({
    queryKey: ['search', session.mode, term],
    queryFn: () => api.get<{ payments: PaymentDTO[]; customers: { id: string; email: string; name: string | null }[] }>(`/dashboard/search?q=${encodeURIComponent(term)}`),
    enabled: term.length >= 2,
  });
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setFocused(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const go = (to: string) => { setQ(''); setFocused(false); navigate(to); };
  return (
    <div ref={ref} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
      <input
        value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setFocused(true)}
        placeholder="Search reference or customer email"
        className="h-9 w-full rounded-md border border-line bg-surface pl-9 pr-3 text-[13.5px] placeholder:text-subtle focus:border-primary focus:bg-white focus:outline-none"
        aria-label="Search"
      />
      {focused && term.length >= 2 && (
        <div className="absolute left-0 right-0 top-11 z-50 max-h-96 overflow-y-auto rounded-md border border-line bg-white p-1 shadow-pop">
          {results.isLoading && <div className="flex justify-center p-4"><Spinner className="h-4 w-4" /></div>}
          {results.data && results.data.payments.length === 0 && results.data.customers.length === 0 && <div className="p-3 text-[13px] text-muted">No matches for "{term}".</div>}
          {results.data?.payments.map((p) => (
            <button key={p.id} onClick={() => go(`/dashboard/transactions/${p.id}`)} className="flex w-full items-center justify-between gap-3 rounded px-3 py-2 text-left hover:bg-surface">
              <span className="min-w-0"><span className="block font-mono text-[12.5px] text-ink">{p.reference}</span><span className="block truncate text-[12px] text-muted">{p.customer?.email}</span></span>
              <span className="text-right"><span className="tabular block text-[13px] font-medium">{formatMoney(p.amount)}</span><StatusBadge status={p.status} /></span>
            </button>
          ))}
          {results.data?.customers.map((c) => (
            <button key={c.id} onClick={() => go(`/dashboard/customers/${c.id}`)} className="flex w-full items-center gap-3 rounded px-3 py-2 text-left hover:bg-surface">
              <Users className="h-4 w-4 text-muted" /><span className="truncate text-[13px] text-ink">{c.name ? `${c.name} · ` : ''}{c.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Notifications() {
  const { session } = useSession();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['notifications', session.organization?.id],
    queryFn: () => api.get<{ items: { id: string; title: string; body: string; read_at: string | null; created_at: string }[]; unread: number }>('/dashboard/notifications'),
    refetchInterval: 60_000,
  });
  const markRead = useMutation({ mutationFn: () => api.post('/dashboard/notifications/read'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  return (
    <Dropdown.Root onOpenChange={(o) => { if (!o && q.data?.unread) markRead.mutate(); }}>
      <Dropdown.Trigger className="relative rounded-md p-2 text-ink-2 hover:bg-surface-2" aria-label="Notifications">
        <Bell className="h-[18px] w-[18px]" />
        {!!q.data?.unread && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary ring-2 ring-white" />}
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="end" sideOffset={8} className="z-50 w-[340px] max-w-[calc(100vw-24px)] rounded-md border border-line bg-white shadow-pop animate-fade-in">
          <div className="border-b border-line px-4 py-3 text-[13.5px] font-semibold">Notifications</div>
          <div className="max-h-[420px] overflow-y-auto">
            {!q.data?.items.length && <div className="px-4 py-8 text-center text-[13px] text-muted">You're all caught up.</div>}
            {q.data?.items.map((n) => (
              <div key={n.id} className={cn('border-b border-line px-4 py-3 last:border-0', !n.read_at && 'bg-primary-soft/40')}>
                <div className="flex justify-between gap-3"><span className="text-[13px] font-medium text-ink">{n.title}</span><span className="shrink-0 text-[11.5px] text-subtle">{relativeTime(n.created_at)}</span></div>
                <p className="mt-0.5 text-[12.5px] text-muted">{n.body}</p>
              </div>
            ))}
          </div>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

function ProfileMenu() {
  const { session } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const initials = `${session.user.firstName[0] ?? ''}${session.user.lastName[0] ?? ''}`.toUpperCase();
  const logout = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    qc.clear();
    navigate('/login');
  };
  return (
    <Dropdown.Root>
      <Dropdown.Trigger className="flex items-center gap-2 rounded-md p-1 hover:bg-surface-2" aria-label="Account menu">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-[12px] font-semibold text-white">{initials}</span>
        <ChevronDown className="hidden h-4 w-4 text-muted sm:block" />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="end" sideOffset={8} className="z-50 w-60 rounded-md border border-line bg-white p-1 shadow-pop animate-fade-in">
          <div className="px-3 py-2.5">
            <div className="text-[13.5px] font-medium text-ink">{session.user.firstName} {session.user.lastName}</div>
            <div className="truncate text-[12px] text-muted">{session.user.email}</div>
            <div className="mt-1 text-[11.5px] capitalize text-subtle">{session.organization?.role}</div>
          </div>
          <Dropdown.Separator className="my-1 h-px bg-line" />
          <Dropdown.Item onSelect={() => navigate('/dashboard/settings')} className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-[13.5px] outline-none data-[highlighted]:bg-surface"><Settings className="h-4 w-4 text-muted" />Settings</Dropdown.Item>
          <Dropdown.Item onSelect={logout} className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-[13.5px] text-danger outline-none data-[highlighted]:bg-danger-soft"><LogOut className="h-4 w-4" />Sign out</Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
