import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowLeftRight, Plus } from 'lucide-react';
import { formatMoney, type PaymentDTO, type BalanceDTO } from '@app/shared';
import { Card, CardHeader, DataTable, EmptyState, PageHeader, Stat, Button, Skeleton, Tabs, buttonVariants } from '@app/ui';
import { useSession } from '../lib/session';
import { useModeQuery, paymentColumns, QueryError } from './shared';
import { CreatePaymentDialog } from './CreatePaymentDialog';

interface Overview {
  balances: BalanceDTO;
  totals: { totalProcessed: number; todayVolume: number; successful30d: number; failed30d: number; awaitingPayment: number; fees30d: number };
  series: { date: string; volume: number; fees: number; successful: number; failed: number; total: number; successRate: number | null }[];
  recentPayments: PaymentDTO[];
}

const BLUE = '#1546e0';
const AXIS = { fontSize: 11, fill: '#8a92a1' };

export default function OverviewPage() {
  const { session } = useSession();
  const navigate = useNavigate();
  const [create, setCreate] = useState(false);
  const q = useModeQuery<Overview>(['overview'], '/dashboard/overview');
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <PageHeader
        eyebrow={session.organization?.name}
        title={`${greeting}, ${session.user.firstName}`}
        actions={session.permissions.includes('payments.create') && <Button onClick={() => setCreate(true)}><Plus className="h-4 w-4" />New payment</Button>}
      />
      {q.error && <QueryError error={q.error} onRetry={() => q.refetch()} />}

      {/* Balances & headline numbers */}
      <Card className="mb-6">
        <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[1.2fr_2fr] lg:gap-10">
          <div className="flex flex-col justify-between gap-6 lg:border-r lg:border-line lg:pr-10">
            {q.isLoading ? <Skeleton className="h-16 w-56" /> : <Stat emphasis label="Available balance" value={formatMoney(q.data?.balances.available ?? 0)} sub="Ready to withdraw" />}
            <div className="flex items-end justify-between gap-4">
              {q.isLoading ? <Skeleton className="h-10 w-32" /> : <Stat label="Pending balance" value={formatMoney(q.data?.balances.pending ?? 0)} sub="Awaiting settlement" />}
              <Link to="/dashboard/balance" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>View balance</Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4 lg:content-center">
            {q.isLoading ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />) : (
              <>
                <Stat label="Total processed" value={formatMoney(q.data!.totals.totalProcessed, 'NGN', { compact: true })} />
                <Stat label="Today's volume" value={formatMoney(q.data!.totals.todayVolume, 'NGN', { compact: true })} />
                <Stat label="Successful (30d)" value={q.data!.totals.successful30d.toLocaleString()} />
                <Stat label="Failed / expired (30d)" value={q.data!.totals.failed30d.toLocaleString()} />
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Charts */}
      <div className="mb-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <VolumeCard series={q.data?.series} loading={q.isLoading} />
        <SuccessRateCard series={q.data?.series} loading={q.isLoading} />
      </div>

      <Card>
        <CardHeader title="Recent transactions" action={<Link to="/dashboard/transactions" className="text-[13px] font-medium text-primary">View all</Link>} />
        <DataTable
          columns={paymentColumns} rows={q.data?.recentPayments} loading={q.isLoading} rowKey={(p) => p.id}
          onRowClick={(p) => navigate(`/dashboard/transactions/${p.id}`)}
          empty={<EmptyState icon={<ArrowLeftRight className="h-5 w-5" />} title="No transactions yet"
            description={session.mode === 'test' ? 'Create a test payment and simulate a transfer from the checkout page to see the full flow.' : 'Connect your API or share a payment link to start accepting payments.'}
            action={<div className="flex flex-wrap justify-center gap-2"><Button onClick={() => setCreate(true)}>Create a payment</Button><Link to="/dashboard/developers" className={buttonVariants({ variant: 'secondary' })}>Get API keys</Link></div>} />}
        />
      </Card>
      <CreatePaymentDialog open={create} onOpenChange={setCreate} />
    </>
  );
}

function shortDate(d: string) {
  return new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}

function ChartTooltip({ active, payload, label, format }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line bg-white px-3 py-2 text-[12px] shadow-pop">
      <div className="text-muted">{new Date(label).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
      {payload.map((p: any) => <div key={p.dataKey} className="tabular mt-0.5 font-semibold text-ink">{format(p.value, p.payload)}</div>)}
    </div>
  );
}

function VolumeCard({ series, loading }: { series?: Overview['series']; loading: boolean }) {
  const [metric, setMetric] = useState<'volume' | 'fees' | 'total'>('volume');
  const total = series?.reduce((s, d) => s + d[metric], 0) ?? 0;
  const fmt = (v: number) => (metric === 'total' ? `${v.toLocaleString()} payments` : formatMoney(v));
  const empty = !loading && total === 0;
  return (
    <Card>
      <div className="flex flex-col gap-3 px-5 pt-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-[15px] font-semibold text-ink">{metric === 'volume' ? 'Transaction volume' : metric === 'fees' ? 'Fees' : 'Transaction activity'}</h3>
          <div className="tabular mt-1 text-[22px] font-semibold tracking-tight text-ink">{loading ? '—' : fmt(total)}</div>
          <div className="text-[12px] text-muted">Last 30 days</div>
        </div>
        <Tabs value={metric} onChange={setMetric} className="border-0" items={[{ value: 'volume', label: 'Volume' }, { value: 'fees', label: 'Fees' }, { value: 'total', label: 'Activity' }]} />
      </div>
      <div className="h-64 px-2 pb-3 pt-4">
        {loading ? <Skeleton className="mx-3 h-full" /> : empty ? <ChartEmpty /> : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series} margin={{ top: 4, right: 12, left: 4, bottom: 0 }} barCategoryGap={2}>
              <CartesianGrid vertical={false} stroke="#eef0f4" />
              <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS} tickLine={false} axisLine={{ stroke: '#e5e8ee' }} minTickGap={24} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} width={56}
                tickFormatter={(v) => (metric === 'total' ? String(v) : formatMoney(v, 'NGN', { compact: true, decimals: false }))} allowDecimals={false} />
              <Tooltip cursor={{ fill: 'rgba(21,70,224,0.06)' }} content={<ChartTooltip format={fmt} />} />
              <Bar dataKey={metric} fill={BLUE} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive animationDuration={400} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

function SuccessRateCard({ series, loading }: { series?: Overview['series']; loading: boolean }) {
  const s = series?.reduce((a, d) => ({ ok: a.ok + d.successful, bad: a.bad + d.failed }), { ok: 0, bad: 0 });
  const rate = s && s.ok + s.bad > 0 ? s.ok / (s.ok + s.bad) : null;
  return (
    <Card>
      <div className="px-5 pt-4">
        <h3 className="text-[15px] font-semibold text-ink">Payment success rate</h3>
        <div className="tabular mt-1 text-[22px] font-semibold tracking-tight text-ink">{rate === null ? '—' : `${(rate * 100).toFixed(1)}%`}</div>
        <div className="text-[12px] text-muted">Successful ÷ (successful + failed + expired), last 30 days</div>
      </div>
      <div className="h-64 px-2 pb-3 pt-4">
        {loading ? <Skeleton className="mx-3 h-full" /> : rate === null ? <ChartEmpty /> : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#eef0f4" />
              <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS} tickLine={false} axisLine={{ stroke: '#e5e8ee' }} minTickGap={24} />
              <YAxis domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} tick={AXIS} tickLine={false} axisLine={false} width={40} />
              <Tooltip cursor={{ stroke: '#cfd5df' }} content={<ChartTooltip format={(v: number, p: any) => `${(v * 100).toFixed(1)}% · ${p.successful}/${p.successful + p.failed}`} />} />
              <Line type="monotone" dataKey="successRate" stroke={BLUE} strokeWidth={2} dot={{ r: 3, fill: BLUE, strokeWidth: 0 }} activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

function ChartEmpty() {
  return <div className="flex h-full items-center justify-center rounded-md border border-dashed border-line text-[13px] text-muted">Activity will appear here once payments come in.</div>;
}
