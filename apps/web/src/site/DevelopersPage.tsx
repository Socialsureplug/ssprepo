import { Link } from 'react-router-dom';
import { ArrowRight, Braces, FlaskConical, History, KeyRound, RotateCcw, Webhook } from 'lucide-react';
import { buttonVariants } from '@app/ui';
import { BRAND } from '@app/shared';
import { PageHero, Section, CodeBlock } from './parts';

export default function DevelopersPage() {
  const items = [
    { icon: KeyRound, title: 'Secret-key auth', body: 'Separate test and live keys. Rotate or revoke instantly from the dashboard.' },
    { icon: RotateCcw, title: 'Idempotency', body: 'Send an Idempotency-Key with any POST to make retries safe.' },
    { icon: Webhook, title: 'Signed webhooks', body: 'HMAC-SHA256 signatures with timestamps, exponential-backoff retries and manual redelivery.' },
    { icon: FlaskConical, title: 'Sandbox bank', body: 'Simulate customer transfers in test mode through the real confirmation pipeline.' },
    { icon: History, title: 'Request logs', body: 'Inspect every API request and response with its request ID and latency.' },
    { icon: Braces, title: 'Predictable errors', body: 'Stable error codes, human-readable messages and a request ID on every response.' },
  ];
  return (
    <>
      <PageHero eyebrow="Developers" title="Build on bank transfers with a clean, reliable API." description="REST endpoints, JSON everywhere, amounts in kobo, and webhooks you can trust. Start in test mode in minutes.">
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link to="/signup" className={buttonVariants({ size: 'lg' })}>Get test API keys</Link>
          <Link to="/docs" className={buttonVariants({ size: 'lg', variant: 'secondary' })}>Read the docs <ArrowRight className="h-4 w-4" /></Link>
        </div>
      </PageHero>
      <Section>
        <div className="grid gap-12 lg:grid-cols-2">
          <div>
            <h2 className="display text-[38px] text-ink">Create a payment</h2>
            <p className="mt-3 text-[15px] text-muted">Send the amount in kobo. You get back a reference, a hosted checkout URL and the bank details your customer should transfer to.</p>
          </div>
          <CodeBlock tabs={[
            { label: 'Node.js', code: `const res = await fetch('https://api.example.com/v1/payments', {
  method: 'POST',
  headers: {
    Authorization: \`Bearer \${process.env.SECRET_KEY}\`,
    'Content-Type': 'application/json',
    'Idempotency-Key': order.id,
  },
  body: JSON.stringify({
    amount: 2500000,          // ₦25,000 in kobo
    currency: 'NGN',
    email: 'customer@example.com',
    reference: order.id,
    description: 'Product purchase',
  }),
});
const { reference, checkout_url } = await res.json();` },
            { label: 'Python', code: `import os, requests

res = requests.post(
    "https://api.example.com/v1/payments",
    headers={
        "Authorization": f"Bearer {os.environ['SECRET_KEY']}",
        "Idempotency-Key": order_id,
    },
    json={
        "amount": 2500000,
        "currency": "NGN",
        "email": "customer@example.com",
        "reference": order_id,
    },
)
checkout_url = res.json()["checkout_url"]` },
          ]} />
        </div>
        <div className="mt-20 grid gap-12 lg:grid-cols-2">
          <div>
            <h2 className="display text-[38px] text-ink">Verify webhook signatures</h2>
            <p className="mt-3 text-[15px] text-muted">
              Every event carries an <code className="rounded bg-surface-2 px-1 font-mono text-[13px]">X-{BRAND.name}-Signature</code> header. Compute the HMAC over the raw body and reject stale timestamps. Fulfil orders only from verified events.
            </p>
          </div>
          <CodeBlock tabs={[{ label: 'Node.js', code: `import crypto from 'node:crypto';

function verify(rawBody, header, secret) {
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = crypto.createHmac('sha256', secret)
    .update(\`\${t}.\${rawBody}\`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}` }]} />
        </div>
      </Section>
      <Section className="border-t border-line bg-surface">
        <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((i) => (
            <div key={i.title}>
              <i.icon className="h-5 w-5 text-primary" />
              <h3 className="mt-3 text-[16px] font-semibold text-ink">{i.title}</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{i.body}</p>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
