import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney } from '@app/shared';
import { Card, CardHeader, PageHeader, Skeleton, Stat, StatusBadge, relativeTime } from '@app/ui';
import { useAdminQuery, LoadError, useStaff } from '../lib';

interface Overview {
  merchants: { total: number; active: number; awaiting_review: number };
  volume: { total_volume: number; today_volume: number; successful: number; failed: number };
  pendingSettlements: { n: number; amount: number };
  platformRevenue: number;
  providers: { code: string; name: string; health_status: string; enabled: boolean; health_checked_at: string | null; health_latency_ms: number | null }[];
  series: { date: string; volume: number; total: number }[];
  activeProviders: number; openReconciliationIssues: number; openRiskEvents: number;
}

export default function OverviewPage() {
  const { mode } = useStaff();
  const q = useAdminQuery<Overview>(['overview'], '/admin/overview', { refetchInterval: 30_000 });
  if (q.error) return <LoadError error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const stats: [string, React.ReactNode, string?][] = d ? [
    ['Total merchants', d.merchants.total.toLocaleString(), `${d.merchants.awaiting_review} awaiting KYB review`],
    ['Active merchants', d.merchants.active.toLocaleString(), 'Verified and active'],
    ['Total volume', formatMoney(d.volume.total_volume, 'NGN', { compact: true })],
    ["Today's volume", formatMoney(d.volume.today_volume, 'NGN', { compact: true })],
    ['Successful transactions', d.volume.successful.toLocaleString()],
    ['Failed / expired', d.volume.failed.toLocaleString()],
    ['Pending settlements', formatMoney(d.pendingSettlements.amount, 'NGN', { compact: true }), `${d.pendingSettlements.n} batches`],
    ['Platform revenue', formatMoney(d.platformRevenue, 'NGN', { compact: true }), 'Fee revenue ledger balance'],
  ] : [];
  return (
    <>
      <PageHeader eyebrow={`${mode} data`} title="Platform overview" />
      <Card className="mb-6 grid grid-cols-2 gap-6 p-5 md:grid-cols-4">
        {q.isLoading ? Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14" />) : stats.map(([l, v, s]) => <Stat key={l} label={l} value={v} sub={s} />)}
      </Card>
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title="Transaction volume" description="Successful volume per day, last 30 days" />
          <div className="h-72 p-3">
            {d && (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.series} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#eef0f4" />
                  <XAxis dataKey="date" tickFormatter={(v) => new Date(v).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })} tick={{ fontSize: 11, fill: '#8a92a1' }} tickLine={false} axisLine={{ stroke: '#e5e8ee' }} minTickGap={24} />
                  <YAxis tickFormatter={(v) => formatMoney(v, 'NGN', { compact: true, decimals: false })} tick={{ fontSize: 11, fill: '#8a92a1' }} tickLine={false} axisLine={false} width={60} />
                  <Tooltip cursor={{ fill: 'rgba(21,70,224,0.06)' }} formatter={(v: any) => [formatMoney(Number(v)), 'Volume']} labelFormatter={(l) => new Date(String(l)).toDateString()} />
                  <Bar dataKey="volume" fill="#1546e0" radius={[4, 4, 0, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Payment providers" description={d ? `${d.activeProviders} active` : undefined} action={<Link to="/providers" className="text-[13px] text-primary">Manage</Link>} />
            <div className="divide-y divide-line">
              {d?.providers.map((p) => (
                <div key={p.code} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0"><div className="truncate text-[13.5px] font-medium">{p.name}</div><div className="text-[12px] text-muted">{p.enabled ? 'Enabled' : 'Disabled'} · {p.health_checked_at ? `checked ${relativeTime(p.health_checked_at)}` : 'not checked'}{p.health_latency_ms !== null ? ` · ${p.health_latency_ms}ms` : ''}</div></div>
                  <StatusBadge status={p.enabled ? p.health_status : 'disabled'} />
                </div>
              ))}
            </div>
          </Card>
          <Card className="grid grid-cols-2 divide-x divide-line">
            <Link to="/reconciliation" className="p-5 hover:bg-surface"><Stat label="Open reconciliation issues" value={d?.openReconciliationIssues ?? '—'} /></Link>
            <Link to="/risk" className="p-5 hover:bg-surface"><Stat label="Open risk events" value={d?.openRiskEvents ?? '—'} /></Link>
          </Card>
        </div>
      </div>
    </>
  );
}
