import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowLeftRight, BadgePercent, Building2, FileClock, Gauge, Landmark, Link2, LogOut, Menu, Plug, Scale, ScrollText, Settings, ShieldAlert, Undo2, Wallet, Webhook, X, ArrowUpRight,
} from 'lucide-react';
import type { StaffPermission } from '@app/shared';
import { Logo, cn, humanize } from '@app/ui';
import { api, useStaff } from './lib';

const NAV: { group: string; items: { to: string; label: string; icon: any; perm: StaffPermission; end?: boolean }[] }[] = [
  { group: 'Monitor', items: [
    { to: '/', label: 'Overview', icon: Gauge, perm: 'overview.view', end: true },
    { to: '/merchants', label: 'Merchants', icon: Building2, perm: 'merchants.view' },
    { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight, perm: 'transactions.view' },
    { to: '/payment-links', label: 'Payment links', icon: Link2, perm: 'transactions.view' },
  ] },
  { group: 'Money', items: [
    { to: '/balances', label: 'Balances & ledger', icon: Wallet, perm: 'balances.view' },
    { to: '/settlements', label: 'Settlements', icon: Landmark, perm: 'settlements.view' },
    { to: '/withdrawals', label: 'Withdrawals', icon: ArrowUpRight, perm: 'withdrawals.view' },
    { to: '/refunds', label: 'Refunds & reversals', icon: Undo2, perm: 'refunds.view' },
    { to: '/reconciliation', label: 'Reconciliation', icon: Scale, perm: 'reconciliation.view' },
  ] },
  { group: 'Platform', items: [
    { to: '/providers', label: 'Providers', icon: Plug, perm: 'providers.view' },
    { to: '/fees', label: 'Fees', icon: BadgePercent, perm: 'fees.manage' },
    { to: '/risk', label: 'Risk monitoring', icon: ShieldAlert, perm: 'risk.view' },
  ] },
  { group: 'Logs', items: [
    { to: '/logs/api', label: 'API logs', icon: Activity, perm: 'logs.view' },
    { to: '/logs/webhooks', label: 'Webhook logs', icon: Webhook, perm: 'logs.view' },
    { to: '/audit', label: 'Audit logs', icon: ScrollText, perm: 'audit.view' },
    { to: '/settings', label: 'System settings', icon: Settings, perm: 'settings.manage' },
  ] },
];

export function AdminLayout() {
  const { session, mode, setMode } = useStaff();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  useEffect(() => setOpen(false), [location.pathname]);
  const logout = async () => { await api.post('/admin/auth/logout').catch(() => undefined); qc.clear(); navigate('/login'); };

  return (
    <div className="min-h-screen bg-white lg:grid lg:grid-cols-[248px_1fr]">
      <aside className={cn('fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col bg-ink text-white transition-transform lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-auto lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex h-16 items-center justify-between px-5">
          <Logo inverted suffix="Admin" />
          <button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Admin">
          {NAV.map((g) => {
            const items = g.items.filter((i) => session.permissions.includes(i.perm));
            if (!items.length) return null;
            return (
              <div key={g.group}>
                <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40">{g.group}</div>
                {items.map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => cn('flex items-center gap-3 rounded-md px-3 py-1.5 text-[13.5px]', isActive ? 'bg-white/12 text-white' : 'text-white/70 hover:bg-white/6 hover:text-white')}>
                    <i.icon className="h-4 w-4" />{i.label}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="border-t border-white/10 p-4">
          <div className="truncate text-[13px] font-medium">{session.user.firstName} {session.user.lastName}</div>
          <div className="truncate text-[12px] text-white/50">{session.roles.map(humanize).join(', ')}</div>
          <button onClick={logout} className="mt-3 flex items-center gap-2 text-[12.5px] text-white/70 hover:text-white"><LogOut className="h-3.5 w-3.5" />Sign out</button>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-40 bg-ink/40 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-white/95 px-4 backdrop-blur sm:px-6">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          <div className="flex items-center gap-2 text-[12.5px] text-muted"><FileClock className="h-4 w-4" />All admin actions are audited.</div>
          <div className="ml-auto flex items-center rounded-md border border-line p-0.5 text-[12px] font-semibold" role="group" aria-label="Data mode">
            {(['live', 'test'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m} className={cn('rounded px-2.5 py-1 uppercase', mode === m ? (m === 'live' ? 'bg-success text-white' : 'bg-warning text-white') : 'text-muted')}>{m} data</button>
            ))}
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1320px] px-4 py-6 sm:px-6 sm:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
