# Nairaflow — bank-transfer payment infrastructure

> **Nairaflow** is a working placeholder name. Change it in `packages/shared/src/brand.ts`
> (plus `BRAND_NAME` / `EMAIL_FROM` env vars and the two `index.html` titles).

A full-stack payment platform for Nigerian businesses, starting with **bank-transfer collections**.
Merchants create payments (API, dashboard or payment links); each payment gets dedicated account
details from a licensed provider; the provider notifies the platform; the transfer is verified,
posted to a double-entry ledger, and the merchant receives a signed webhook and is settled.

The platform **does not operate banking infrastructure**. All money movement goes through a
provider adapter. A built-in **sandbox provider** simulates a bank in test mode; a configurable
**REST provider adapter** is the integration point for the licensed partner you contract with.

## Repository layout

```
apps/
  api/        Node.js + TypeScript REST API, job worker, PostgreSQL migrations, tests
  web/        React app: marketing site, auth, hosted checkout, merchant dashboard
  admin/      Separate React admin application (own login, own session cookie, RBAC)
packages/
  shared/     Types, zod validation schemas, money helpers, statuses, state machine, permissions
  ui/         Design system: tokens, fonts, shadcn-style components, API client
```

## Quick start

Requirements: Node 20+, PostgreSQL 14+.

```bash
npm install
```

```bash
docker compose up -d postgres   # or use a local PostgreSQL with user/password app/app
```

```bash
cp .env.example apps/api/.env   # dev defaults work without editing; production requires real secrets
```

```bash
SEED_ADMIN_PASSWORD='AdminPass1234' SEED_MERCHANT_PASSWORD='DemoPass1234' npm run db:seed
```

```bash
npm run dev   # API :4000 (with in-process worker), web :5173, admin :5174
```

- Merchant dashboard: http://localhost:5173 — `demo@example.com` / the merchant seed password
- Admin: http://localhost:5174 — `admin@example.com` / the admin seed password
- Try it: dashboard → **New payment** → **Open checkout** → **Simulate exact transfer**. The
  transfer is delivered as a signed provider webhook and confirmed through the real pipeline.

Run the test suite (uses a separate `payments_test` database, never real money):

```bash
createdb payments_test && npm test
```

## Architecture

### Payment flow

```
Merchant ──POST /v1/payments──▶ API ──createPaymentAccount()──▶ Provider (licensed bank)
                                 │                                     │
Customer ◀── checkout page (bank, account no., reference, countdown)   │
Customer ──bank transfer──────────────────────────────────────────────▶│
Provider ──signed webhook──▶ /webhooks/providers/:code
   → signature verification → idempotency (unique event id) → stored + queued (same tx)
   → worker: re-verify transaction with provider API → match by account number
   → ledger posting → state transition (pending → successful) → merchant webhook → audit log
```

The customer's browser can never change a payment: the checkout page only *asks the server to
re-check with the provider*.

### Core modules (`apps/api/src`)

| Module | Responsibility |
|---|---|
| `modules/payments` | Creation, **state machine** (`state-machine.ts`), collection matching, reversals, expiry |
| `modules/ledger` | Double-entry ledger; balances derived from entries; per-merchant advisory locks |
| `modules/fees` | Pure fee calculation (bps, fixed, min, cap) + platform/merchant schedules |
| `providers/` | `PaymentProvider` interface, registry/routing, sandbox + REST adapters, call logging |
| `modules/webhooks` | Inbound provider pipeline; outbound signed merchant webhooks with retries |
| `modules/settlements` | T+0 / T+1 / manual settlement batches, payout, failure handling |
| `modules/withdrawals` | On-demand payouts with limits, idempotency, risk holds |
| `modules/refunds` | Full/partial refunds with fund reservation |
| `modules/reconciliation` | Provider ↔ internal ↔ ledger ↔ settlement comparison, issue workflow |
| `modules/risk` | Rule-based risk events (velocity, large amounts, failure rate, new payout accounts) |
| `modules/notifications` | In-app + email notifications behind a swappable email provider |
| `jobs/` | Postgres-backed transactional job queue (outbox pattern, `SKIP LOCKED`, backoff) |

### Ledger

| Event | Entries |
|---|---|
| Payment confirmed | Dr provider_clearing (gross) · Cr merchant_pending (net) · Cr fee_revenue (fee) |
| Settlement to bank | Dr merchant_pending · Cr payout_clearing → on confirmation Dr payout_clearing · Cr provider_clearing |
| Settlement failed | Dr payout_clearing · Cr merchant_available |
| Manual schedule release | Dr merchant_pending · Cr merchant_available |
| Withdrawal | Dr merchant_available (amount) · Cr payout_clearing (net) · Cr fee_revenue (fee) |
| Refund | Dr merchant_pending/available · Cr payout_clearing → Dr payout_clearing · Cr provider_clearing |
| Under/over-payment, late or unmatched transfer | Dr provider_clearing · Cr suspense + reconciliation issue |
| Admin adjustment | Balanced posting against suspense or fee_revenue, reason required, audited |

Database guarantees: a deferred constraint trigger rejects any unbalanced transaction at commit;
`ledger_entries`, `ledger_transactions`, `payment_status_history` and `audit_logs` are append-only
(UPDATE/DELETE raise); every posting has a unique idempotency key.

### Security

- Passwords: scrypt; login lockout; equal-timing responses for unknown accounts
- Sessions: random tokens stored as keyed hashes, `HttpOnly` + `SameSite=Lax` (+ `Secure` in prod),
  CSRF synchronizer token on every state-changing request plus Origin check
- Merchant and staff sessions are separate cookies and separate login endpoints
- API secret keys shown once, stored as HMAC hashes; rotation and revocation
- AES-256-GCM encryption for provider credentials, webhook secrets and bank account numbers
- Provider webhooks: signature verification **and** API re-verification before crediting
- Merchant webhooks: HMAC-SHA256 with timestamp; SSRF protection blocks private networks
- RBAC: merchant roles (owner/admin/developer/finance/viewer) and staff roles
  (super/finance/operations/support/risk admin) in `packages/shared/src/permissions.ts`
- Rate limiting, request IDs, zod validation everywhere, parameterised SQL only, helmet headers,
  generic 500s (no stack traces or secrets in responses), redacted logs
- Production refuses to boot with the dev encryption key / pepper

### Connecting a licensed provider

1. Implement or adapt `apps/api/src/providers/adapters/http-bank-transfer.ts` to the provider's API
   (virtual accounts, transaction lookup, transfers, refunds, name enquiry, webhook format).
2. In **Admin → Providers**, set `baseUrl`, credentials (write-only, encrypted) and signature header.
3. Point the provider's webhook URL at `https://<api>/webhooks/providers/<code>`.
4. Run a health check, test against the provider's sandbox, then enable **Use for live payments**.

New adapters are registered in `providers/registry.ts`. Routing (`selectCollectionProvider`) picks
the highest-priority healthy live provider — the hook for multi-provider orchestration.

### Extending to new payment methods

`payments.payment_method` and the `PaymentProvider` capability interface are where cards, USSD and
QR plug in: add a capability interface, an adapter, a checkout component and a matching branch in
collection handling. The ledger, settlements, webhooks, reconciliation and dashboard are
method-agnostic.

## Production deployment

- Run the **API** (stateless, horizontally scalable) and the **worker** (`npm run start:worker`,
  any number of instances; jobs are claimed with `SKIP LOCKED`) as separate processes.
  `docker-compose.yml` shows the shape; `apps/api/Dockerfile` builds both.
- Run migrations on deploy: `npm run db:migrate` (the API auto-migrates only in development).
- Serve `apps/web/dist` and `apps/admin/dist` from a CDN; host admin on a separate domain behind
  SSO/VPN/IP allow-listing. Set `VITE_API_URL` at build time and `COOKIE_DOMAIN`, `TRUST_PROXY`,
  `WEB_URL`, `ADMIN_URL` on the API.
- Secrets from a secret manager into env vars. Terminate TLS at the load balancer (HSTS enabled).
- Use a shared store (e.g. Redis) for `express-rate-limit` when running multiple API instances.
- Health: `GET /health` (liveness), `GET /health/ready` (database + job backlog).

## Not yet built / next steps

- Two-factor authentication for staff and merchant owners
- Document upload for KYB (object storage) — the schema stores profile data; files are a TODO
- Displaying the admin maintenance banner in the merchant app
- Exports (CSV) for transactions and settlements
- Licensed provider contract + adapter field mapping, and the regulatory approvals that requires

Nothing in this repository claims a licence or regulatory approval. Pricing shown on the marketing
site mirrors the seeded default fee schedule and is configurable in Admin → Fees.
