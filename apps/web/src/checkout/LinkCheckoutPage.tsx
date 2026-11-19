import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Lock, Link2Off } from 'lucide-react';
import { formatMoney } from '@app/shared';
import { Alert, Button, Field, Input, Logo, Spinner, nairaToKobo } from '@app/ui';
import { api } from '../lib/api';
import { useSubmit, formValues } from '../auth/forms';

interface PublicLink {
  slug: string; title: string; amount: number | null; description: string | null; merchantName: string; customerEmail: string | null;
  mode: 'test' | 'live'; available: boolean; unavailableReason: string | null;
}

export default function LinkCheckoutPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['link', slug], queryFn: () => api.get<PublicLink>(`/checkout/links/${slug}`), retry: false });
  const { submit, loading, error, fieldErrors, setError } = useSubmit(async (v: Record<string, string>) => {
    let amount: number | undefined;
    if (q.data && q.data.amount === null) {
      const k = nairaToKobo(v.amount ?? '');
      if (!k || k < 10_000) { setError('Enter an amount of at least ₦100.'); return; }
      amount = k;
    }
    const res = await api.post<{ reference: string }>(`/checkout/links/${slug}`, { email: v.email, name: v.name || undefined, amount });
    navigate(`/pay/${res.reference}`);
  });

  return (
    <div className="flex min-h-[100dvh] flex-col bg-surface sm:items-center sm:justify-center sm:py-10">
      <div className="w-full bg-white sm:max-w-[440px] sm:rounded-lg sm:border sm:border-line sm:shadow-pop">
        {q.isLoading && <div className="flex justify-center py-24"><Spinner /></div>}
        {q.error && (
          <div className="px-6 py-14 text-center">
            <Link2Off className="mx-auto h-6 w-6 text-muted" />
            <h1 className="mt-4 font-serif text-[30px] text-ink">Payment link not found</h1>
            <p className="mt-2 text-[14px] text-muted">Check the link you were given, or contact the business.</p>
          </div>
        )}
        {q.data && (
          <>
            {q.data.mode === 'test' && <div className="bg-warning px-4 py-1 text-center text-[11.5px] font-semibold uppercase tracking-wider text-white sm:rounded-t-lg">Test mode · no real money moves</div>}
            <div className="flex items-center justify-between border-b border-line px-6 py-3.5">
              <span className="truncate text-[14px] font-semibold text-ink">{q.data.merchantName}</span>
              <span className="flex items-center gap-1 text-[12px] text-muted"><Lock className="h-3 w-3" /> Secure checkout</span>
            </div>
            <div className="px-6 py-6">
              <h1 className="text-[18px] font-semibold text-ink">{q.data.title}</h1>
              {q.data.description && <p className="mt-1 text-[14px] text-muted">{q.data.description}</p>}
              {q.data.amount !== null && <div className="tabular mt-4 font-serif text-[46px] leading-none text-ink">{formatMoney(q.data.amount)}</div>}
              {!q.data.available ? (
                <Alert tone="warning" className="mt-6">
                  {q.data.unavailableReason === 'expired' ? 'This payment link has expired.' : 'This payment link is no longer accepting payments.'}
                </Alert>
              ) : (
                <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(formValues(e.currentTarget)); }} noValidate>
                  {error && <Alert tone="danger">{error}</Alert>}
                  {q.data.amount === null && (
                    <Field label="Amount (₦)" htmlFor="amount" error={fieldErrors.amount}><Input id="amount" name="amount" inputMode="decimal" placeholder="0.00" required /></Field>
                  )}
                  <Field label="Email address" htmlFor="email" error={fieldErrors.email} hint="Your receipt and payment updates go here.">
                    <Input id="email" name="email" type="email" autoComplete="email" defaultValue={q.data.customerEmail ?? ''} required />
                  </Field>
                  <Field label="Full name (optional)" htmlFor="name"><Input id="name" name="name" autoComplete="name" /></Field>
                  <Button type="submit" size="lg" className="w-full" loading={loading}>Continue to pay by bank transfer</Button>
                </form>
              )}
            </div>
          </>
        )}
      </div>
      <div className="mt-auto flex items-center justify-center gap-2 py-5 text-[12px] text-muted sm:mt-5 sm:py-0">Powered by <Logo className="origin-left scale-[0.72]" /></div>
    </div>
  );
}
