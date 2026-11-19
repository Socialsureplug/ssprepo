import { BRAND, WEBHOOK_EVENT_TYPES } from '@app/shared';
import { cn } from '@app/ui';
import { CodeBlock } from './parts';

const SECTIONS = [
  ['introduction', 'Introduction'], ['authentication', 'Authentication'], ['test-mode', 'Test & live mode'], ['api', 'API reference'],
  ['payments', 'Payments'], ['payment-links', 'Payment links'], ['refunds', 'Refunds'], ['webhooks', 'Webhooks'], ['idempotency', 'Idempotency'], ['errors', 'Errors'], ['statuses', 'Payment statuses'],
] as const;

const ENDPOINTS: [string, string, string][] = [
  ['POST', '/v1/payments', 'Create a bank-transfer payment'],
  ['GET', '/v1/payments', 'List payments (filter by status, paginated)'],
  ['GET', '/v1/payments/:id', 'Retrieve a payment by id, reference or your reference'],
  ['GET', '/v1/payments/:id/verify', 'Re-check a payment with the bank partner, then return it'],
  ['POST', '/v1/payment-links', 'Create a payment link'],
  ['GET', '/v1/payment-links/:id', 'Retrieve a payment link with totals'],
  ['POST', '/v1/refunds', 'Refund a successful payment (full or partial)'],
  ['GET', '/v1/customers', 'List customers'],
  ['POST', '/v1/customers', 'Create or update a customer'],
  ['GET', '/v1/balance', 'Available and pending balance'],
  ['GET', '/v1/settlements', 'List settlements'],
  ['POST', '/v1/webhooks/test', 'Send a test event to your webhook endpoint'],
];

export default function DocsPage() {
  return (
    <div className="mx-auto grid max-w-[1200px] gap-10 px-5 py-12 sm:px-8 lg:grid-cols-[220px_1fr] lg:py-16">
      <aside className="lg:sticky lg:top-24 lg:h-fit">
        <div className="eyebrow mb-3">Documentation</div>
        <nav className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible" aria-label="Documentation">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13.5px] text-ink-2 hover:bg-surface-2 hover:text-ink">{label}</a>
          ))}
        </nav>
      </aside>
      <article className="min-w-0 max-w-3xl space-y-16 [&_h2]:scroll-mt-24 [&_h2]:text-[24px] [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-ink [&_p]:mt-3 [&_p]:text-[15px] [&_p]:leading-relaxed [&_p]:text-ink-2">
        <section>
          <h1 id="introduction" className="display scroll-mt-24 text-[48px] text-ink">{BRAND.name} API</h1>
          <p>The {BRAND.name} API lets you collect payments by bank transfer. You create a payment; we issue dedicated bank account details for it; your customer transfers the exact amount; our banking partner notifies us; we verify the transfer, post it to the ledger and send you a signed webhook.</p>
          <p>Base URL: <Code>https://api.example.com</Code>. All requests and responses are JSON. <strong>All amounts are integers in kobo</strong> (₦1 = 100 kobo).</p>
        </section>

        <section>
          <h2 id="authentication">Authentication</h2>
          <p>Authenticate with your secret key in the <Code>Authorization</Code> header. Secret keys start with <Code>sk_test_</Code> or <Code>sk_live_</Code>. Keep them on your server — never in a browser or mobile app.</p>
          <CodeBlock className="mt-4" tabs={[{ label: 'Header', code: 'Authorization: Bearer sk_test_<your-secret-key>' }]} />
          <p>Keys are shown once when generated. We store only a hash; if you lose a key, rotate it from <em>Developers → API keys</em>.</p>
        </section>

        <section>
          <h2 id="test-mode">Test & live mode</h2>
          <p>Test and live data are completely separate and selected by the key you use. In test mode, payments are collected by a sandbox bank: open any test checkout page and use <em>Simulate transfer</em>, which sends a signed provider webhook through the same pipeline as live payments.</p>
          <p>Live mode is enabled after your business verification (KYB) is approved.</p>
        </section>

        <section>
          <h2 id="api">API reference</h2>
          <div className="mt-4 overflow-hidden rounded-lg border border-line">
            {ENDPOINTS.map(([m, path, desc]) => (
              <div key={m + path} className="flex flex-col gap-1 border-b border-line px-4 py-3 last:border-0 sm:flex-row sm:items-center sm:gap-4">
                <span className={cn('w-12 font-mono text-[12px] font-semibold', m === 'GET' ? 'text-success' : 'text-primary')}>{m}</span>
                <span className="font-mono text-[13px] text-ink sm:w-64">{path}</span>
                <span className="text-[13.5px] text-muted">{desc}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 id="payments">Create a payment</h2>
          <p><Code>POST /v1/payments</Code> — fields: <Code>amount</Code> (kobo, min 10000), <Code>currency</Code> (NGN), <Code>email</Code>, optional <Code>name</Code>, <Code>reference</Code> (your unique order id), <Code>description</Code>, <Code>expiresInMinutes</Code> (10–1440, default 30), <Code>callbackUrl</Code>, <Code>metadata</Code>.</p>
          <CodeBlock className="mt-4" tabs={[
            { label: 'Request', code: `POST /v1/payments
{
  "amount": 2500000,
  "currency": "NGN",
  "email": "customer@example.com",
  "reference": "ORDER-12345",
  "description": "Product purchase"
}` },
            { label: 'Response', code: `{
  "status": "success",
  "reference": "PAY_7Q4M2KXH9C3T",
  "checkout_url": "https://${BRAND.checkoutHost}/PAY_7Q4M2KXH9C3T",
  "amount": 2500000,
  "currency": "NGN",
  "data": {
    "status": "pending",
    "fee": 25000,
    "netAmount": 2475000,
    "expiresAt": "2026-01-01T12:30:00.000Z",
    "bankTransfer": {
      "bankName": "Partner Bank",
      "accountName": "Your Business Checkout",
      "accountNumber": "9948210736"
    }
  }
}` },
          ]} />
          <p>Redirect your customer to <Code>checkout_url</Code>, or render the <Code>bankTransfer</Code> details in your own interface. <strong>Never treat a customer returning to your site as proof of payment</strong> — wait for the <Code>payment.success</Code> webhook or call <Code>GET /v1/payments/:id/verify</Code>.</p>
        </section>

        <section>
          <h2 id="payment-links">Payment links</h2>
          <p><Code>POST /v1/payment-links</Code> with <Code>title</Code>, <Code>amount</Code> (or <Code>null</Code> to let the customer enter one), optional <Code>description</Code>, <Code>expiresAt</Code>, <Code>successRedirectUrl</Code> and <Code>cancelRedirectUrl</Code>. The response includes a shareable <Code>url</Code>.</p>
        </section>

        <section>
          <h2 id="refunds">Refunds</h2>
          <p><Code>POST /v1/refunds</Code> with <Code>payment</Code> (reference or id), optional <Code>amount</Code> for partial refunds, and <Code>reason</Code>. An <Code>Idempotency-Key</Code> header is required. Refunds are drawn from your balance and sent to the payer's account by our banking partner.</p>
        </section>

        <section>
          <h2 id="webhooks">Webhooks</h2>
          <p>Configure an HTTPS endpoint and choose events in <em>Developers → Webhooks</em>. We POST JSON events and expect a <Code>2xx</Code> within 10 seconds. Failed deliveries are retried with exponential backoff up to 8 times; you can also redeliver manually.</p>
          <p>Verify every request: the <Code>X-{BRAND.name}-Signature</Code> header has the form <Code>t=&lt;unix&gt;,v1=&lt;hex&gt;</Code>, where <Code>v1 = HMAC_SHA256(secret, t + "." + rawBody)</Code>. Reject timestamps older than five minutes and de-duplicate on the event <Code>id</Code>.</p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {WEBHOOK_EVENT_TYPES.map((e) => <span key={e} className="rounded-sm border border-line px-2 py-0.5 font-mono text-[12px] text-ink-2">{e}</span>)}
          </div>
        </section>

        <section>
          <h2 id="idempotency">Idempotency</h2>
          <p>Include <Code>Idempotency-Key: &lt;unique string&gt;</Code> on POST requests. Repeating a request with the same key and body returns the original response (with header <Code>Idempotent-Replayed: true</Code>). Reusing a key with a different body returns <Code>422 idempotency_key_reused</Code>.</p>
        </section>

        <section>
          <h2 id="errors">Errors</h2>
          <p>Errors return a non-2xx status and a body like <Code>{'{"status":"error","error":{"code":"invalid_api_key","message":"…","requestId":"req_…"}}'}</Code>. Include the request ID when contacting support.</p>
          <div className="mt-4 overflow-hidden rounded-lg border border-line text-[13.5px]">
            {[
              ['401', 'invalid_api_key', 'Missing, malformed or revoked key'], ['403', 'merchant_not_verified', 'Live mode requires approved verification'],
              ['409', 'duplicate_reference', 'Your reference was already used'], ['422', 'validation_error', 'Invalid fields; see details'],
              ['422', 'insufficient_balance', 'Not enough balance for refund or withdrawal'], ['429', 'rate_limited', 'Too many requests'],
              ['503', 'provider_unavailable', 'Banking partner temporarily unavailable; retry later'],
            ].map(([s, c, d]) => (
              <div key={c} className="grid grid-cols-[48px_1fr] gap-x-4 border-b border-line px-4 py-2.5 last:border-0 sm:grid-cols-[48px_220px_1fr]">
                <span className="font-mono text-muted">{s}</span><span className="font-mono text-ink">{c}</span><span className="col-span-2 text-muted sm:col-span-1">{d}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 id="statuses">Payment statuses</h2>
          <p><Code>created</Code> → <Code>pending</Code> (account issued, awaiting transfer) → <Code>successful</Code>. Payments may instead become <Code>failed</Code> (e.g. underpaid) or <Code>expired</Code>. Successful payments can later be <Code>partially_refunded</Code>, <Code>refunded</Code> or <Code>reversed</Code> (recalled by the bank). Status changes happen only on our servers.</p>
        </section>
      </article>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-ink">{children}</code>;
}
