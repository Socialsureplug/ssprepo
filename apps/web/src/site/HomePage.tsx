import { Link } from 'react-router-dom';
import {
  ArrowRight, ArrowUpRight, Building2, Check, FileCode2, Landmark, Link2, Lock, Receipt, RefreshCcw, ShieldCheck, Webhook, Workflow, Scale, Activity, KeyRound,
} from 'lucide-react';
import { BRAND } from '@app/shared';
import { buttonVariants, cn } from '@app/ui';
import { Section, SectionHeading, CodeBlock, FAQ } from './parts';

export function HomePage() {
  return (
    <>
      <Hero />
      <InfrastructureStatement />
      <HowItWorks />
      <Features />
      <PaymentLinksSection />
      <ApiSection />
      <DashboardPreview />
      <SecuritySection />
      <DeveloperSection />
      <PricingSummary />
      <FaqSection />
      <FinalCta />
    </>
  );
}

// ------------------------------------------------------------------ 1. Hero
function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-line">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#eef0f4_1px,transparent_1px),linear-gradient(to_bottom,#eef0f4_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]" aria-hidden />
      <div className="relative mx-auto grid max-w-[1200px] gap-14 px-5 pb-20 pt-16 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-10 lg:pb-28 lg:pt-24">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1 text-[12.5px] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Bank-transfer payments for Nigerian businesses
          </div>
          <h1 className="display mt-6 text-[52px] text-ink sm:text-[68px] lg:text-[80px]">
            Payments infrastructure for <em className="text-primary">modern</em> businesses.
          </h1>
          <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-ink-2 sm:text-[18px]">
            Accept bank transfers, automate payment confirmation, and manage your payments through one powerful infrastructure.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link to="/signup" className={buttonVariants({ size: 'lg' })}>Start accepting payments <ArrowRight className="h-4 w-4" /></Link>
            <Link to="/developers" className={buttonVariants({ size: 'lg', variant: 'secondary' })}>Explore the API</Link>
          </div>
          <ul className="mt-9 flex flex-wrap gap-x-6 gap-y-2 text-[13.5px] text-muted">
            {['No setup fees', 'Full test mode from day one', 'Signed, verified webhooks'].map((t) => (
              <li key={t} className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" />{t}</li>
            ))}
          </ul>
        </div>
        <HeroVisual />
      </div>
    </section>
  );
}

/** A composed, product-accurate illustration of one payment moving through the system. */
function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-[520px]" aria-label="Illustration of a bank-transfer payment flowing from customer to merchant">
      {/* Checkout card */}
      <div className="relative z-10 rounded-lg border border-line bg-white shadow-pop">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <span className="text-[13px] font-medium text-ink-2">Lagos Goods Ltd</span>
          <span className="inline-flex items-center gap-1.5 text-[12px] text-muted"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />Awaiting transfer · 28:41</span>
        </div>
        <div className="px-5 pb-5 pt-6">
          <div className="eyebrow">Pay</div>
          <div className="tabular mt-1 font-serif text-[48px] leading-none tracking-tight text-ink">₦25,000</div>
          <div className="mt-6 space-y-0 divide-y divide-line rounded-md border border-line">
            {[['Bank', 'Partner Bank'], ['Account name', 'Lagos Goods Checkout'], ['Account number', '99 4821 0736']].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-[12.5px] text-muted">{k}</span>
                <span className={cn('text-[13.5px] font-medium text-ink', k === 'Account number' && 'tabular tracking-wide')}>{v}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between rounded-md bg-surface px-4 py-2.5">
            <span className="text-[12.5px] text-muted">Reference</span>
            <span className="font-mono text-[12.5px] text-ink">PAY_7Q4M2KXH9C3T</span>
          </div>
        </div>
      </div>
      {/* Webhook event */}
      <div className="relative z-20 -mt-6 ml-auto w-[88%] rounded-lg border border-ink/10 bg-ink p-4 shadow-pop sm:-mr-6">
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-2 text-[11.5px] font-medium text-white/60"><Webhook className="h-3.5 w-3.5" /> POST /webhooks/payments</span>
          <span className="rounded-sm bg-success/25 px-1.5 py-0.5 text-[11px] font-medium text-[#7ee2b0]">200 · 84ms</span>
        </div>
        <pre className="overflow-hidden font-mono text-[11.5px] leading-relaxed text-white/85">{`{
  "type": "payment.success",
  "data": {
    "reference": "PAY_7Q4M2KXH9C3T",
    "amount": 2500000,
    "fee": 25000,
    "netAmount": 2475000
  }
}`}</pre>
      </div>
      {/* Ledger line */}
      <div className="relative z-30 -mt-5 w-[78%] rounded-lg border border-line bg-white px-4 py-3 shadow-pop sm:-ml-6">
        <div className="eyebrow mb-2">Ledger</div>
        {[['Customer transfer', '+₦25,000.00', 'text-ink'], ['Processing fee', '−₦250.00', 'text-muted'], ['Merchant payable', '₦24,750.00', 'text-primary font-semibold']].map(([k, v, c]) => (
          <div key={k} className="flex justify-between py-0.5 text-[12.5px]"><span className="text-ink-2">{k}</span><span className={cn('tabular', c)}>{v}</span></div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 2. Statement
function InfrastructureStatement() {
  const items = [
    { icon: Landmark, title: 'Bank-partner rails', body: 'Collections run on licensed bank and payment partners through a provider-agnostic integration layer.' },
    { icon: Scale, title: 'Double-entry ledger', body: 'Every naira is recorded as balanced debits and credits. Balances are derived, never edited.' },
    { icon: Webhook, title: 'Verified confirmations', body: 'Transfers are confirmed server-to-server and re-verified with the provider before you are notified.' },
    { icon: Workflow, title: 'Built to expand', body: 'Bank transfers first. The same core is designed for cards, USSD, payouts and multi-provider routing.' },
  ];
  return (
    <Section className="border-b border-line">
      <p className="mx-auto max-w-3xl text-center font-serif text-[30px] leading-[1.15] text-ink sm:text-[40px]">
        The infrastructure layer between your customers' bank transfers and your business — <span className="text-muted">reconciled, auditable and automatic.</span>
      </p>
      <div className="mt-14 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {items.map((i) => (
          <div key={i.title} className="bg-white p-6">
            <i.icon className="h-5 w-5 text-primary" />
            <h3 className="mt-4 text-[15px] font-semibold text-ink">{i.title}</h3>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{i.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ 3. How it works
function HowItWorks() {
  const steps = [
    { n: '01', title: 'Create a payment', body: 'Call the API or share a payment link. We compute fees server-side and issue a unique account for that payment.' },
    { n: '02', title: 'Customer transfers', body: 'Your customer sends the exact amount from any Nigerian bank app. No card, no account with us.' },
    { n: '03', title: 'We confirm and verify', body: 'The bank partner notifies us; we verify the transfer, match it to the payment and post it to the ledger.' },
    { n: '04', title: 'You get paid', body: 'You receive a signed webhook instantly, and funds settle to your bank account on your schedule.' },
  ];
  return (
    <Section>
      <SectionHeading eyebrow="How it works" title="From transfer to settlement, without manual checks." />
      <ol className="mt-14 grid gap-10 md:grid-cols-2 lg:grid-cols-4 lg:gap-8">
        {steps.map((s) => (
          <li key={s.n} className="border-t border-ink pt-5">
            <div className="tabular font-serif text-[28px] text-primary">{s.n}</div>
            <h3 className="mt-3 text-[17px] font-semibold text-ink">{s.title}</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-muted">{s.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

// ------------------------------------------------------------------ 4. Features
function Features() {
  const features = [
    { icon: Building2, title: 'Dedicated account per payment', body: 'Each payment gets its own account details, so every transfer is matched automatically.' },
    { icon: RefreshCcw, title: 'Automatic confirmation', body: 'No screenshots, no manual matching. Payments move to successful the moment the bank confirms.' },
    { icon: Receipt, title: 'Transparent fees', body: 'Gross, fee and net shown on every payment. Fees are calculated on our servers, never by clients.' },
    { icon: Landmark, title: 'Scheduled settlements', body: 'Next-day settlement to your bank account by default, or hold funds and withdraw on demand.' },
    { icon: Activity, title: 'Reconciliation built in', body: 'Provider records, ledger and settlements are compared continuously, with exceptions surfaced.' },
    { icon: KeyRound, title: 'Team roles', body: 'Invite finance, developers and support with the access they need — nothing more.' },
  ];
  return (
    <Section className="border-y border-line bg-surface">
      <SectionHeading eyebrow="Features" title="Everything you need to run on bank transfers." description="One integration covers collection, confirmation, customer records, settlement and reporting." />
      <div className="mt-14 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <div key={f.title}>
            <div className="flex h-9 w-9 items-center justify-center rounded-md border border-line bg-white"><f.icon className="h-4.5 w-4.5 text-primary" /></div>
            <h3 className="mt-4 text-[16px] font-semibold text-ink">{f.title}</h3>
            <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{f.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ 5. Payment links
function PaymentLinksSection() {
  return (
    <Section id="payment-links">
      <div className="grid items-center gap-14 lg:grid-cols-2">
        <div>
          <SectionHeading align="left" eyebrow="Payment links" title="Get paid without writing a line of code." description="Create a link in seconds and share it over WhatsApp, email or social. Customers see your amount and bank details, pay by transfer, and you see it confirmed in your dashboard." />
          <ul className="mt-8 space-y-3 text-[14.5px] text-ink-2">
            {['Fixed or customer-entered amounts', 'Expiry dates and success redirects', 'Every payment tracked per link'].map((t) => (
              <li key={t} className="flex items-start gap-3"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{t}</li>
            ))}
          </ul>
          <Link to="/signup" className={cn(buttonVariants({ variant: 'secondary' }), 'mt-8')}>Create your first link <ArrowRight className="h-4 w-4" /></Link>
        </div>
        <div className="rounded-lg border border-line bg-surface p-5 sm:p-8">
          <div className="rounded-lg border border-line bg-white shadow-card">
            <div className="flex items-center gap-3 border-b border-line px-5 py-3">
              <Link2 className="h-4 w-4 text-muted" />
              <span className="truncate font-mono text-[12.5px] text-ink-2">{BRAND.checkoutHost}/annual-membership</span>
            </div>
            <div className="p-6">
              <div className="text-[13px] text-muted">Abuja Fitness Club</div>
              <div className="mt-1 text-[18px] font-semibold text-ink">Annual membership</div>
              <div className="tabular mt-4 font-serif text-[44px] leading-none text-ink">₦120,000</div>
              <div className="mt-6 grid grid-cols-3 gap-3 border-t border-line pt-5 text-[12.5px]">
                {[['Payments', '214'], ['Collected', '₦25.7M'], ['Status', 'Active']].map(([k, v]) => (
                  <div key={k}><div className="text-muted">{k}</div><div className="mt-0.5 font-semibold text-ink">{v}</div></div>
                ))}
              </div>
            </div>
          </div>
          <p className="mt-3 text-center text-[11.5px] text-subtle">Illustrative example</p>
        </div>
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ 6. API
function ApiSection() {
  return (
    <Section className="bg-ink text-white">
      <div className="grid items-center gap-14 lg:grid-cols-[1fr_1.15fr]">
        <div>
          <div className="eyebrow !text-white/50">Payments API</div>
          <h2 className="display mt-4 text-[40px] sm:text-[52px]">One request to collect a payment.</h2>
          <p className="mt-5 max-w-md text-[16px] leading-relaxed text-white/70">
            Create a payment, redirect to hosted checkout or show account details in your own UI, then receive a signed webhook when the transfer is verified.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/docs#api" className={buttonVariants({ variant: 'primary' })}>Read the API reference</Link>
            <Link to="/signup" className={cn(buttonVariants({ variant: 'ghost' }), 'text-white hover:bg-white/10')}>Get test keys <ArrowUpRight className="h-4 w-4" /></Link>
          </div>
        </div>
        <CodeBlock
          dark
          tabs={[
            { label: 'cURL', code: `curl https://api.example.com/v1/payments \\
  -H "Authorization: Bearer sk_test_..." \\
  -H "Idempotency-Key: order-12345" \\
  -d '{
    "amount": 2500000,
    "currency": "NGN",
    "email": "customer@example.com",
    "reference": "ORDER-12345",
    "description": "Product purchase"
  }'` },
            { label: 'Response', code: `{
  "status": "success",
  "reference": "PAY_7Q4M2KXH9C3T",
  "checkout_url": "https://${BRAND.checkoutHost}/PAY_7Q4M2KXH9C3T",
  "amount": 2500000,
  "currency": "NGN"
}` },
          ]}
        />
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ 7. Dashboard preview
function DashboardPreview() {
  const bars = [32, 45, 38, 52, 61, 48, 70, 66, 74, 58, 82, 77, 90, 85];
  const rows = [
    ['PAY_8F2KQ7', 'adaeze@mail.com', '₦45,000', 'Successful'],
    ['PAY_3MZT9R', 'tunde@mail.com', '₦12,500', 'Pending'],
    ['PAY_Q4HV2N', 'ifeoma@mail.com', '₦250,000', 'Successful'],
  ];
  return (
    <Section id="dashboard">
      <SectionHeading eyebrow="Merchant dashboard" title="Your money, clearly accounted for." description="Available and pending balances, every transaction with its fee and net amount, settlements and a full activity trail." />
      <div className="mt-14 overflow-hidden rounded-lg border border-line bg-white shadow-pop">
        <div className="flex items-center gap-2 border-b border-line bg-surface px-4 py-2.5">
          {[0, 1, 2].map((i) => <span key={i} className="h-2.5 w-2.5 rounded-full bg-line-strong" />)}
          <span className="ml-3 text-[12px] text-muted">Overview</span>
        </div>
        <div className="grid gap-6 p-5 sm:p-8 lg:grid-cols-[1fr_1.4fr]">
          <div className="space-y-6">
            <div>
              <div className="text-[12.5px] text-muted">Available balance</div>
              <div className="tabular font-serif text-[44px] leading-none text-ink">₦4,812,350</div>
            </div>
            <div className="grid grid-cols-2 gap-4 border-t border-line pt-5">
              {[['Pending', '₦612,900'], ["Today's volume", '₦1,284,000'], ['Successful', '1,942'], ['Success rate', '97.8%']].map(([k, v]) => (
                <div key={k}><div className="text-[12px] text-muted">{k}</div><div className="tabular text-[18px] font-semibold text-ink">{v}</div></div>
              ))}
            </div>
          </div>
          <div>
            <div className="flex h-40 items-end gap-1.5 border-b border-line pb-px">
              {bars.map((h, i) => <div key={i} className="flex-1 rounded-t-sm bg-primary" style={{ height: `${h}%`, opacity: 0.35 + (i / bars.length) * 0.65 }} />)}
            </div>
            <div className="mt-5 divide-y divide-line text-[13px]">
              {rows.map(([r, e, a, s]) => (
                <div key={r} className="grid grid-cols-[1fr_auto] gap-2 py-2.5 sm:grid-cols-[1fr_1.4fr_auto_auto] sm:gap-6">
                  <span className="font-mono text-[12px] text-ink-2">{r}</span>
                  <span className="hidden truncate text-muted sm:block">{e}</span>
                  <span className="tabular text-right font-medium text-ink">{a}</span>
                  <span className={cn('hidden text-right sm:block', s === 'Successful' ? 'text-success' : 'text-warning')}>{s}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <p className="mt-3 text-center text-[11.5px] text-subtle">Illustrative data</p>
    </Section>
  );
}

// ------------------------------------------------------------------ 8. Security
function SecuritySection() {
  const items = [
    { icon: ShieldCheck, title: 'Server-side confirmation only', body: 'A payment is never marked successful by a browser redirect. Only verified provider events change payment state.' },
    { icon: Lock, title: 'Encryption and hashing', body: 'Secret keys are stored as hashes; provider credentials, webhook secrets and account numbers are encrypted at rest.' },
    { icon: Webhook, title: 'Signed, idempotent webhooks', body: 'Inbound provider events are signature-checked and processed exactly once. Outbound events are HMAC-signed with retries.' },
    { icon: FileCode2, title: 'Complete audit trail', body: 'Every state change, financial movement and admin action is recorded in an append-only log.' },
  ];
  return (
    <Section className="border-y border-line bg-surface">
      <div className="grid gap-14 lg:grid-cols-[1fr_1.5fr]">
        <SectionHeading align="left" eyebrow="Security & reliability" title="Built like financial infrastructure, because it is." description="Controls that protect your funds and your customers' trust are part of the core, not add-ons." />
        <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2">
          {items.map((i) => (
            <div key={i.title} className="bg-white p-6">
              <i.icon className="h-5 w-5 text-primary" />
              <h3 className="mt-4 text-[15px] font-semibold text-ink">{i.title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{i.body}</p>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ 9. Developers
function DeveloperSection() {
  const points = [
    ['Test mode, end to end', 'A sandbox bank simulates transfers through the real confirmation pipeline.'],
    ['Idempotency keys', 'Retry any POST safely. Same key, same result.'],
    ['Request logs', 'Every API call with request ID, status and latency in your dashboard.'],
    ['Webhook delivery logs', 'Response codes, timings and one-click redelivery.'],
  ];
  return (
    <Section>
      <div className="grid gap-14 lg:grid-cols-2">
        <SectionHeading align="left" eyebrow="For developers" title="Predictable APIs. Honest logs." description="Integrate in an afternoon and operate with confidence: every request, event and delivery is visible to you." />
        <dl className="grid gap-8 sm:grid-cols-2">
          {points.map(([t, b]) => (
            <div key={t} className="border-l-2 border-primary pl-4">
              <dt className="text-[15px] font-semibold text-ink">{t}</dt>
              <dd className="mt-1 text-[14px] leading-relaxed text-muted">{b}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ 10. Pricing
function PricingSummary() {
  return (
    <Section className="border-t border-line">
      <div className="grid items-center gap-10 rounded-lg border border-line p-8 sm:p-12 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <div className="eyebrow">Pricing</div>
          <h2 className="display mt-3 text-[40px] text-ink sm:text-[52px]">Simple, per-transaction pricing.</h2>
          <p className="mt-4 max-w-md text-[15px] text-muted">No setup fees, no monthly fees. You only pay when a transfer is successfully confirmed.</p>
          <Link to="/pricing" className={cn(buttonVariants({ variant: 'link' }), 'mt-6')}>See full pricing <ArrowRight className="h-4 w-4" /></Link>
        </div>
        <div className="border-t border-line pt-8 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
          <div className="tabular font-serif text-[72px] leading-none text-ink">1%</div>
          <div className="mt-2 text-[15px] text-ink-2">per successful bank transfer</div>
          <div className="mt-1 text-[14px] text-muted">capped at ₦2,000 per transaction</div>
        </div>
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ 11. FAQ
function FaqSection() {
  return (
    <Section className="border-t border-line bg-surface">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.6fr]">
        <SectionHeading align="left" eyebrow="FAQ" title="Questions, answered." />
        <FAQ items={[
          ['Do my customers need an account?', 'No. Customers pay by bank transfer from any Nigerian bank app using the account details shown at checkout.'],
          ['How do you know a transfer has arrived?', 'Our banking partner notifies us server-to-server. We verify the transaction with the partner, match it to the payment by its dedicated account number, and only then mark it successful.'],
          ['What happens if a customer sends the wrong amount?', 'Underpayments are not marked successful and overpayments are credited for the expected amount; in both cases the difference is flagged for review so it can be refunded.'],
          ['When do I receive my money?', 'By default, funds settle to your bank account the next business day (T+1). You can also hold funds in your balance and withdraw on demand.'],
          ['Can I test before going live?', 'Yes. Every account starts in test mode with a sandbox bank. Live mode is enabled after your business verification is approved.'],
          [`Is ${BRAND.name} a bank?`, `No. ${BRAND.name} is a technology platform. Collections and payouts are processed by licensed banking and payment partners.`],
        ]} />
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ 12. Final CTA
function FinalCta() {
  return (
    <section className="border-t border-line">
      <div className="mx-auto max-w-[1200px] px-5 py-24 text-center sm:px-8 sm:py-32">
        <h2 className="display mx-auto max-w-3xl text-[46px] text-ink sm:text-[68px]">Start accepting bank transfers today.</h2>
        <p className="mx-auto mt-5 max-w-lg text-[16px] text-muted">Create an account, integrate in test mode, and go live once your business is verified.</p>
        <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
          <Link to="/signup" className={buttonVariants({ size: 'lg' })}>Start accepting payments</Link>
          <Link to="/contact" className={buttonVariants({ size: 'lg', variant: 'secondary' })}>Talk to us</Link>
        </div>
      </div>
    </section>
  );
}
