import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleDashed } from 'lucide-react';
import { Alert, Button, Card, CardHeader, Field, Input, PageHeader, Select, Spinner, StatusBadge, Textarea, cn } from '@app/ui';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useSubmit, formValues } from '../auth/forms';
import { BankAccounts } from './SettingsPage';

export interface OnboardingData {
  kybStatus: string; liveEnabled: boolean; emailVerified: boolean;
  profile: Record<string, string> | null;
  bankAccounts: { id: string; bank_name: string; account_number_last4: string; account_name: string; is_default: boolean }[];
  latestReview: { status: string; submitted_at: string; reviewed_at: string | null; decision_reason: string | null } | null;
}

const VOLUMES = [['lt_1m', 'Under ₦1M'], ['1m_10m', '₦1M – ₦10M'], ['10m_50m', '₦10M – ₦50M'], ['50m_200m', '₦50M – ₦200M'], ['gt_200m', 'Over ₦200M']];
const TYPES = [['sole_proprietorship', 'Sole proprietorship / business name'], ['partnership', 'Partnership'], ['limited_liability', 'Limited liability company'], ['ngo', 'NGO / non-profit'], ['other', 'Other']];

export function useOnboarding() {
  return useQuery({ queryKey: ['onboarding'], queryFn: () => api.get<OnboardingData>('/dashboard/settings/onboarding') });
}

export default function OnboardingPage() {
  const q = useOnboarding();
  const { refresh } = useSession();
  const qc = useQueryClient();
  const submitKyb = useMutation({ mutationFn: () => api.post('/dashboard/settings/onboarding/submit'), onSuccess: async () => { await qc.invalidateQueries(); await refresh(); } });
  if (q.isLoading) return <div className="flex justify-center py-24"><Spinner /></div>;
  if (q.error) return <Alert tone="danger">{q.error.message}</Alert>;
  const d = q.data!;
  const locked = ['pending', 'under_review', 'approved'].includes(d.kybStatus);
  const steps = [
    { label: 'Verify your email', done: d.emailVerified },
    { label: 'Business & director details', done: !!d.profile },
    { label: 'Settlement bank account', done: d.bankAccounts.length > 0 },
    { label: 'Submit for review', done: locked },
  ];

  return (
    <>
      <PageHeader eyebrow="Business verification" title="Activate live payments" description="We verify every business before it can accept real payments. You can keep building in test mode while we review." />
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <Card className="h-fit p-5">
          <div className="mb-4 flex items-center justify-between"><span className="text-[13px] font-medium text-muted">Status</span><StatusBadge status={d.kybStatus} /></div>
          <ol className="space-y-3">
            {steps.map((s, i) => (
              <li key={s.label} className="flex items-center gap-3 text-[13.5px]">
                {s.done ? <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white"><Check className="h-3 w-3" /></span> : <CircleDashed className="h-5 w-5 text-subtle" />}
                <span className={cn(s.done ? 'text-ink' : 'text-muted')}>{i + 1}. {s.label}</span>
              </li>
            ))}
          </ol>
        </Card>
        <div className="space-y-6">
          {d.kybStatus === 'rejected' && d.latestReview?.decision_reason && <Alert tone="warning" title="Changes requested">{d.latestReview.decision_reason}</Alert>}
          {d.kybStatus === 'approved' && <Alert tone="success" title="Your business is verified">Switch to LIVE in the header and generate live API keys to accept real payments.</Alert>}
          {(d.kybStatus === 'pending' || d.kybStatus === 'under_review') && <Alert tone="info" title="Submitted for review">We'll notify you by email when the review is complete. Details are locked while under review.</Alert>}
          <ProfileForm data={d} locked={locked} />
          <Card>
            <CardHeader title="Settlement bank account" description="Where your money is paid. The account name is verified with the bank." />
            <BankAccounts embedded />
          </Card>
          {!locked && (
            <Card className="p-5">
              {submitKyb.error && <Alert tone="danger" className="mb-4">{submitKyb.error.message}</Alert>}
              {!d.emailVerified && <Alert tone="info" className="mb-4">Verify your email address before submitting.</Alert>}
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[13.5px] text-muted">By submitting you confirm the information is accurate and that you're authorised to act for this business.</p>
                <Button disabled={!steps[0].done || !steps[1].done || !steps[2].done} loading={submitKyb.isPending} onClick={() => submitKyb.mutate()}>Submit for review</Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function ProfileForm({ data, locked }: { data: OnboardingData; locked: boolean }) {
  const qc = useQueryClient();
  const p = data.profile ?? {};
  const [saved, setSaved] = useState(false);
  const { submit, loading, error, fieldErrors } = useSubmit(async (v: Record<string, string>) => {
    await api.put('/dashboard/settings/onboarding/profile', { ...v, country: 'NG' });
    setSaved(true);
    await qc.invalidateQueries();
  });
  const f = (name: string) => ({ id: name, name, defaultValue: p[name] ?? '', disabled: locked, 'aria-invalid': !!fieldErrors[name] });
  return (
    <Card>
      <CardHeader title="Business details" description="As registered with the Corporate Affairs Commission (CAC)." />
      <form className="space-y-6 p-5" onSubmit={(e) => { e.preventDefault(); setSaved(false); void submit(formValues(e.currentTarget)); }} noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        {saved && !error && <Alert tone="success">Business details saved.</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Business name" htmlFor="businessName" error={fieldErrors.businessName}><Input {...f('businessName')} /></Field>
          <Field label="Business type" htmlFor="businessType"><Select {...f('businessType')}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label="Business email" htmlFor="businessEmail" error={fieldErrors.businessEmail}><Input type="email" {...f('businessEmail')} /></Field>
          <Field label="Business phone" htmlFor="businessPhone" error={fieldErrors.businessPhone}><Input type="tel" placeholder="0803 123 4567" {...f('businessPhone')} /></Field>
          <Field label="Country" htmlFor="country"><Input id="country" value="Nigeria" disabled /></Field>
          <Field label="CAC registration number" htmlFor="registrationNumber" error={fieldErrors.registrationNumber}><Input placeholder="RC 123456 / BN 1234567" {...f('registrationNumber')} /></Field>
          <Field label="Tax ID (optional)" htmlFor="taxId"><Input {...f('taxId')} /></Field>
          <Field label="Website (optional)" htmlFor="website" error={fieldErrors.website}><Input type="url" placeholder="https://" {...f('website')} /></Field>
          <Field label="Registered address" htmlFor="address" error={fieldErrors.address} className="sm:col-span-2"><Input {...f('address')} /></Field>
          <Field label="What does your business do?" htmlFor="description" error={fieldErrors.description} className="sm:col-span-2"><Textarea rows={3} {...f('description')} /></Field>
          <Field label="Expected monthly volume" htmlFor="expectedMonthlyVolume"><Select {...f('expectedMonthlyVolume')}>{VOLUMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        </div>
        <div className="border-t border-line pt-6">
          <h4 className="text-[14px] font-semibold text-ink">Owner / director</h4>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="directorName" error={fieldErrors.directorName}><Input {...f('directorName')} /></Field>
            <Field label="Email" htmlFor="directorEmail" error={fieldErrors.directorEmail}><Input type="email" {...f('directorEmail')} /></Field>
            <Field label="Phone" htmlFor="directorPhone" error={fieldErrors.directorPhone}><Input type="tel" {...f('directorPhone')} /></Field>
            <Field label="BVN — last 4 digits (optional)" htmlFor="directorBvnLast4" error={fieldErrors.directorBvnLast4} hint="We only store the last four digits."><Input inputMode="numeric" maxLength={4} {...f('directorBvnLast4')} /></Field>
          </div>
        </div>
        {!locked && <div className="flex justify-end"><Button type="submit" loading={loading}>Save details</Button></div>}
      </form>
    </Card>
  );
}
