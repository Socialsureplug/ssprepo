import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, FlaskConical, Lock, RefreshCw, XCircle, Hourglass, SearchX } from 'lucide-react';
import { BRAND, formatMoney, type CheckoutDTO } from '@app/shared';
import { Alert, Button, CopyButton, Logo, Spinner, ApiError, buttonVariants, cn } from '@app/ui';
import { api } from '../lib/api';

/**
 * Hosted checkout. The page only *displays* status; it can ask the server to re-check with the
 * provider, but nothing here can mark a payment as paid.
 */
export default function CheckoutPage() {
  const { reference = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['checkout', reference],
    queryFn: () => api.get<CheckoutDTO>(`/checkout/${reference}`),
    refetchInterval: (query) => (query.state.data && ['created', 'pending', 'processing'].includes(query.state.data.status) ? 5000 : false),
    retry: false,
  });
  const verify = useMutation({
    mutationFn: () => api.post<CheckoutDTO>(`/checkout/${reference}/verify`),
    onSuccess: (data) => qc.setQueryData(['checkout', reference], data),
  });

  if (q.isLoading) return <Shell><div className="flex justify-center py-24"><Spinner /></div></Shell>;
  if (q.error) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <Shell>
        <StateCard icon={<SearchX className="h-6 w-6" />} tone="neutral" title={notFound ? 'Payment not found' : 'We could not load this payment'}
          body={notFound ? 'Check the link you were given, or contact the business you are paying.' : 'Please check your connection and try again.'}
          action={!notFound && <Button variant="secondary" onClick={() => q.refetch()}>Try again</Button>} />
      </Shell>
    );
  }
  const p = q.data!;
  return (
    <Shell mode={p.mode} merchant={p.merchantName}>
      {p.status === 'successful' || p.status === 'partially_refunded' || p.status === 'refunded' ? (
        <StateCard icon={<CheckCircle2 className="h-6 w-6" />} tone="success" title="Payment received"
          body={<>Your transfer of <strong className="text-ink">{formatMoney(p.amount)}</strong> to {p.merchantName} has been confirmed.</>}
          details={[['Reference', p.reference]]}
          action={p.successRedirectUrl && <a href={p.successRedirectUrl} className={buttonVariants({ className: 'w-full' })}>Return to {p.merchantName}</a>} />
      ) : p.status === 'expired' ? (
        <StateCard icon={<Hourglass className="h-6 w-6" />} tone="neutral" title="This payment has expired"
          body="The time to complete this transfer has passed. Please don't send money to the old account details. Return to the business to start a new payment."
          details={[['Reference', p.reference]]}
          action={p.cancelRedirectUrl && <a href={p.cancelRedirectUrl} className={buttonVariants({ variant: 'secondary', className: 'w-full' })}>Return to {p.merchantName}</a>} />
      ) : p.status === 'failed' || p.status === 'reversed' ? (
        <StateCard icon={<XCircle className="h-6 w-6" />} tone="danger" title="Payment unsuccessful"
          body={<>This payment could not be completed. If money left your account, it will be investigated and returned. Contact <a className="text-primary" href={`mailto:${p.supportEmail}`}>{p.supportEmail}</a> with the reference below.</>}
          details={[['Reference', p.reference]]} />
      ) : (
        <PendingCheckout p={p} onVerify={() => verify.mutate()} verifying={verify.isPending} verifyError={verify.error?.message} />
      )}
    </Shell>
  );
}

function PendingCheckout({ p, onVerify, verifying, verifyError }: { p: CheckoutDTO; onVerify: () => void; verifying: boolean; verifyError?: string }) {
  const remaining = useCountdown(p.expiresAt);
  const amount = formatMoney(p.amount);
  const lowTime = remaining !== null && remaining < 5 * 60;
  return (
    <div className="animate-fade-in">
      <div className="px-5 pt-5 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="eyebrow">Pay</div>
            <div className="tabular mt-1 font-serif text-[46px] leading-none tracking-tight text-ink">{amount}</div>
            {p.description && <div className="mt-2 text-[13.5px] text-muted">{p.description}</div>}
          </div>
          <div className={cn('flex shrink-0 items-center gap-1.5 rounded-sm px-2 py-1 text-[12.5px] font-medium tabular', lowTime ? 'bg-danger-soft text-danger' : 'bg-surface-2 text-ink-2')} aria-live="polite">
            <Clock className="h-3.5 w-3.5" />{remaining === null ? '—' : formatDuration(remaining)}
          </div>
        </div>
        <p className="mt-4 rounded-md bg-primary-soft px-3 py-2.5 text-[13.5px] text-primary-ink">
          Transfer <strong>exactly {amount}</strong> to the account below. Use the payment reference as your transfer narration.
        </p>
      </div>

      {p.account ? (
        <dl className="mx-5 mt-4 divide-y divide-line rounded-md border border-line sm:mx-6">
          <Row label="Bank name" value={p.account.bankName} />
          <Row label="Account name" value={p.account.accountName} />
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <dt className="text-[12px] text-muted">Account number</dt>
              <dd className="tabular mt-0.5 text-[24px] font-semibold tracking-[0.06em] text-ink">{p.account.accountNumber}</dd>
            </div>
            <CopyButton value={p.account.accountNumber} label="Copy" />
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <dt className="text-[12px] text-muted">Payment reference</dt>
              <dd className="mt-0.5 truncate font-mono text-[14px] text-ink">{p.reference}</dd>
            </div>
            <CopyButton value={p.reference} label="Copy" />
          </div>
        </dl>
      ) : (
        <div className="mx-5 mt-4 sm:mx-6"><Alert tone="warning">Account details are being prepared. This page will update automatically.</Alert></div>
      )}

      <div className="px-5 pb-5 pt-4 sm:px-6">
        <div className="flex items-center gap-2 text-[13px] text-muted" role="status">
          <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-warning" /></span>
          {p.status === 'processing' ? 'Transfer detected — confirming with the bank…' : 'Waiting for your transfer. This page updates automatically.'}
        </div>
        {verifyError && <Alert tone="danger" className="mt-3">{verifyError}</Alert>}
        <Button className="mt-4 w-full" size="lg" onClick={onVerify} loading={verifying}>
          <RefreshCw className="h-4 w-4" /> I've sent the money
        </Button>
        <p className="mt-3 text-center text-[12.5px] text-muted">
          Transfers usually confirm within a minute. Need help? <a className="text-primary" href={`mailto:${p.supportEmail}?subject=${encodeURIComponent(`Payment ${p.reference}`)}`}>Contact support</a>
        </p>
      </div>
      {p.mode === 'test' && <SandboxPanel reference={p.reference} amount={p.amount} />}
    </div>
  );
}

function SandboxPanel({ reference, amount }: { reference: string; amount: number }) {
  const qc = useQueryClient();
  const [done, setDone] = useState(false);
  const sim = useMutation({
    mutationFn: (amt: number) => api.post(`/checkout/${reference}/simulate-transfer`, { amount: amt }),
    onSuccess: () => { setDone(true); setTimeout(() => qc.invalidateQueries({ queryKey: ['checkout', reference] }), 2500); },
  });
  return (
    <div className="border-t border-dashed border-warning/40 bg-warning-soft/60 px-5 py-4 sm:px-6">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-warning"><FlaskConical className="h-4 w-4" /> Test mode — sandbox bank</div>
      <p className="mt-1 text-[12.5px] text-ink-2">Simulate the customer's bank transfer. It is delivered as a signed provider webhook and confirmed through the real pipeline.</p>
      {done ? <p className="mt-3 text-[12.5px] font-medium text-success">Transfer sent to the sandbox bank. Waiting for confirmation…</p> : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="dark" loading={sim.isPending} onClick={() => sim.mutate(amount)}>Simulate exact transfer</Button>
          <Button size="sm" variant="secondary" disabled={sim.isPending} onClick={() => sim.mutate(Math.floor(amount / 2))}>Simulate underpayment</Button>
        </div>
      )}
      {sim.error && <p className="mt-2 text-[12.5px] text-danger">{sim.error.message}</p>}
    </div>
  );
}

function Shell({ children, mode, merchant }: { children: React.ReactNode; mode?: 'test' | 'live'; merchant?: string }) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-surface sm:items-center sm:justify-center sm:py-10">
      <div className="w-full bg-white sm:max-w-[440px] sm:rounded-lg sm:border sm:border-line sm:shadow-pop">
        {mode === 'test' && <div className="bg-warning px-4 py-1 text-center text-[11.5px] font-semibold uppercase tracking-wider text-white sm:rounded-t-lg">Test mode · no real money moves</div>}
        {merchant && (
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5 sm:px-6">
            <span className="truncate text-[14px] font-semibold text-ink">{merchant}</span>
            <span className="flex items-center gap-1 text-[12px] text-muted"><Lock className="h-3 w-3" /> Secure checkout</span>
          </div>
        )}
        {children}
      </div>
      <div className="mt-auto flex items-center justify-center gap-2 py-5 text-[12px] text-muted sm:mt-5 sm:py-0">
        Powered by <Logo className="scale-[0.72] origin-left" />
      </div>
      <span className="sr-only">{BRAND.name}</span>
    </div>
  );
}

function StateCard({ icon, tone, title, body, details, action }: { icon: React.ReactNode; tone: 'success' | 'danger' | 'neutral'; title: string; body: React.ReactNode; details?: [string, string][]; action?: React.ReactNode }) {
  const tones = { success: 'bg-success-soft text-success', danger: 'bg-danger-soft text-danger', neutral: 'bg-surface-2 text-ink-2' };
  return (
    <div className="px-6 py-10 text-center animate-fade-in">
      <div className={cn('mx-auto flex h-12 w-12 items-center justify-center rounded-full', tones[tone])}>{icon}</div>
      <h1 className="mt-5 font-serif text-[32px] leading-tight text-ink">{title}</h1>
      <p className="mx-auto mt-2 max-w-sm text-[14px] leading-relaxed text-muted">{body}</p>
      {details && (
        <dl className="mx-auto mt-6 max-w-sm divide-y divide-line rounded-md border border-line text-left">
          {details.map(([k, v]) => <Row key={k} label={k} value={v} mono />)}
        </dl>
      )}
      {action && <div className="mx-auto mt-6 max-w-sm">{action}</div>}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <dt className="text-[12.5px] text-muted">{label}</dt>
      <dd className={cn('truncate text-[14px] font-medium text-ink', mono && 'font-mono text-[13px]')}>{value}</dd>
    </div>
  );
}

function useCountdown(expiresAt: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.floor((new Date(expiresAt).getTime() - now) / 1000);
  return Number.isFinite(s) ? Math.max(0, s) : null;
}

function formatDuration(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
