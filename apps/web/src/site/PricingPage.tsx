import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { buttonVariants } from '@app/ui';
import { PageHero, Section, FAQ } from './parts';

export default function PricingPage() {
  const rows: [string, string][] = [
    ['Bank-transfer collection', '1% per successful payment, capped at ₦2,000'],
    ['Failed or expired payments', 'Free'],
    ['Payment links', 'Included'],
    ['Settlement to your bank (T+1)', 'Included'],
    ['On-demand withdrawal', '₦50 per withdrawal'],
    ['Refunds', 'Processing fee on the original payment is not returned'],
    ['Test mode', 'Free, unlimited'],
  ];
  return (
    <>
      <PageHero eyebrow="Pricing" title="Pay only when you get paid." description="One transparent rate for bank-transfer payments. No setup fees, no monthly fees, no hidden charges." />
      <Section>
        <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
          <div className="rounded-lg border border-ink p-8">
            <div className="eyebrow">Standard</div>
            <div className="tabular mt-4 font-serif text-[88px] leading-none text-ink">1%</div>
            <p className="mt-3 text-[15px] text-ink-2">per successful bank transfer, capped at <strong>₦2,000</strong>.</p>
            <div className="mt-6 rounded-md bg-surface p-4 text-[13.5px]">
              <div className="flex justify-between"><span className="text-muted">Customer pays</span><span className="tabular text-ink">₦25,000.00</span></div>
              <div className="mt-1 flex justify-between"><span className="text-muted">Processing fee</span><span className="tabular text-ink">−₦250.00</span></div>
              <div className="mt-2 flex justify-between border-t border-line pt-2 font-semibold"><span>You receive</span><span className="tabular text-primary">₦24,750.00</span></div>
            </div>
            <ul className="mt-6 space-y-2.5 text-[14px] text-ink-2">
              {['Dedicated account per payment', 'Signed webhooks & API access', 'Dashboard, team roles & reports'].map((t) => (
                <li key={t} className="flex items-start gap-2.5"><Check className="mt-0.5 h-4 w-4 text-primary" />{t}</li>
              ))}
            </ul>
            <Link to="/signup" className={buttonVariants({ className: 'mt-8 w-full' })}>Create an account</Link>
          </div>
          <div>
            <h2 className="text-[18px] font-semibold text-ink">Fee schedule</h2>
            <dl className="mt-4 divide-y divide-line border-y border-line">
              {rows.map(([k, v]) => (
                <div key={k} className="flex flex-col gap-1 py-4 sm:flex-row sm:justify-between sm:gap-8">
                  <dt className="text-[14.5px] text-ink">{k}</dt>
                  <dd className="text-[14.5px] text-muted sm:text-right">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 text-[13px] leading-relaxed text-muted">
              Fees are calculated on our servers at the moment each payment is created and shown on every transaction. Businesses processing high volumes can request custom pricing. Applicable taxes may apply.
            </p>
            <div className="mt-10 rounded-lg border border-line p-6">
              <h3 className="font-serif text-[26px] text-ink">High volume?</h3>
              <p className="mt-1.5 text-[14px] text-muted">If you process over ₦50 million per month, talk to us about volume pricing and dedicated support.</p>
              <Link to="/contact" className={buttonVariants({ variant: 'secondary', className: 'mt-4' })}>Contact sales</Link>
            </div>
          </div>
        </div>
      </Section>
      <Section className="border-t border-line bg-surface">
        <FAQ items={[
          ['Are there any setup or monthly fees?', 'No. You only pay the processing fee on successful payments and the withdrawal fee when you withdraw on demand.'],
          ['Who pays the fee — me or my customer?', 'The fee is deducted from the payment before it is credited to your balance. Your customer pays exactly the amount you request.'],
          ['Is pricing different in test mode?', 'Test mode is free. Fees are shown in test mode exactly as they would be calculated in live mode so you can reconcile your integration.'],
        ]} />
      </Section>
    </>
  );
}
