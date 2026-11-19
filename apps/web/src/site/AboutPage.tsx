import { BRAND } from '@app/shared';
import { PageHero, Section } from './parts';

export default function AboutPage() {
  const principles = [
    ['Trust is engineered', 'Every naira is accounted for in a double-entry ledger, every change is audited, and nothing is marked paid until it is verified.'],
    ['Clarity over cleverness', 'Plain financial language, clear statuses and fees shown on every transaction.'],
    ['Built for developers', 'Predictable APIs, honest logs and a test mode that behaves like production.'],
    ['Partners, not pretence', `${BRAND.name} is a technology company. Licensed banks and payment institutions hold and move funds; we build the infrastructure around them.`],
  ];
  return (
    <>
      <PageHero eyebrow="About" title="Infrastructure for how Nigeria actually pays." description="Bank transfers are how millions of people pay every day. We make them work for businesses: automatically confirmed, reconciled and settled." />
      <Section>
        <div className="grid gap-12 lg:grid-cols-[1fr_1.4fr]">
          <h2 className="display text-[40px] text-ink">What we believe</h2>
          <dl className="divide-y divide-line border-y border-line">
            {principles.map(([t, b]) => (
              <div key={t} className="grid gap-2 py-6 sm:grid-cols-[200px_1fr] sm:gap-8">
                <dt className="text-[16px] font-semibold text-ink">{t}</dt>
                <dd className="text-[15px] leading-relaxed text-muted">{b}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Section>
      <Section className="border-t border-line bg-surface">
        <div className="max-w-3xl">
          <h2 className="display text-[40px] text-ink">Starting with bank transfers</h2>
          <p className="mt-4 text-[16px] leading-relaxed text-ink-2">
            We're starting with the payment method Nigerian customers already trust and use most. Our platform is designed from the ground up to add cards, USSD, QR, recurring payments, payouts and multi-provider routing on the same ledger and APIs, so your integration grows with you.
          </p>
        </div>
      </Section>
    </>
  );
}
