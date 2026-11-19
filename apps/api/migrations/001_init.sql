-- =====================================================================
-- Core schema. All money columns are BIGINT minor units (kobo).
-- All timestamps are TIMESTAMPTZ. Primary keys are UUIDs.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END; $$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------- identity
CREATE TABLE users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email              TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash      TEXT NOT NULL,
  first_name         TEXT NOT NULL,
  last_name          TEXT NOT NULL,
  email_verified_at  TIMESTAMPTZ,
  is_staff           BOOLEAN NOT NULL DEFAULT false,
  staff_roles        TEXT[] NOT NULL DEFAULT '{}',
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  failed_login_count INT NOT NULL DEFAULT 0,
  locked_until       TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE organizations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  kyb_status          TEXT NOT NULL DEFAULT 'not_started'
                      CHECK (kyb_status IN ('not_started','pending','under_review','approved','rejected','restricted')),
  risk_status         TEXT NOT NULL DEFAULT 'normal' CHECK (risk_status IN ('normal','review','restricted','blocked')),
  live_enabled        BOOLEAN NOT NULL DEFAULT false,
  settlement_schedule TEXT NOT NULL DEFAULT 't1' CHECK (settlement_schedule IN ('t0','t1','manual')),
  daily_withdrawal_limit BIGINT NOT NULL DEFAULT 1000000000, -- ₦10,000,000
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER organizations_updated BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE organization_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('owner','admin','developer','finance','viewer')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','removed')),
  invited_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, email)
);
CREATE INDEX organization_members_user_idx ON organization_members(user_id);
CREATE TRIGGER organization_members_updated BEFORE UPDATE ON organization_members FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash      TEXT NOT NULL UNIQUE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('merchant','staff')),
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  mode            TEXT NOT NULL DEFAULT 'test' CHECK (mode IN ('test','live')),
  csrf_token      TEXT NOT NULL,
  ip              TEXT,
  user_agent      TEXT,
  expires_at      TIMESTAMPTZ NOT NULL,
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE auth_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('email_verification','password_reset','invite')),
  token_hash  TEXT NOT NULL UNIQUE,
  context     JSONB NOT NULL DEFAULT '{}',
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_user_idx ON auth_tokens(user_id, kind);

-- ---------------------------------------------------------------- onboarding
CREATE TABLE business_profiles (
  organization_id         UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  business_name           TEXT NOT NULL,
  business_type           TEXT NOT NULL,
  business_email          TEXT NOT NULL,
  business_phone          TEXT NOT NULL,
  country                 TEXT NOT NULL DEFAULT 'NG',
  registration_number     TEXT NOT NULL,
  tax_id                  TEXT,
  address                 TEXT NOT NULL,
  description             TEXT NOT NULL,
  website                 TEXT,
  expected_monthly_volume TEXT NOT NULL,
  director_name           TEXT NOT NULL,
  director_email          TEXT NOT NULL,
  director_phone          TEXT NOT NULL,
  director_bvn_last4      TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER business_profiles_updated BEFORE UPDATE ON business_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE kyb_verifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status          TEXT NOT NULL CHECK (status IN ('pending','under_review','approved','rejected','restricted')),
  snapshot        JSONB NOT NULL,
  submitted_by    UUID REFERENCES users(id),
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by     UUID REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  decision_reason TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX kyb_verifications_org_idx ON kyb_verifications(organization_id, created_at DESC);
CREATE INDEX kyb_verifications_status_idx ON kyb_verifications(status);

CREATE TABLE bank_accounts (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bank_code                TEXT NOT NULL,
  bank_name                TEXT NOT NULL,
  account_number_encrypted TEXT NOT NULL,
  account_number_hash      TEXT NOT NULL,
  account_number_last4     TEXT NOT NULL,
  account_name             TEXT NOT NULL,
  is_default               BOOLEAN NOT NULL DEFAULT false,
  status                   TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
  verified_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, bank_code, account_number_hash)
);
CREATE UNIQUE INDEX bank_accounts_one_default ON bank_accounts(organization_id) WHERE is_default AND status = 'active';

-- ---------------------------------------------------------------- providers
CREATE TABLE payment_providers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  adapter               TEXT NOT NULL,
  enabled               BOOLEAN NOT NULL DEFAULT false,
  supports_test         BOOLEAN NOT NULL DEFAULT true,
  supports_live         BOOLEAN NOT NULL DEFAULT false,
  priority              INT NOT NULL DEFAULT 100,
  credentials_encrypted TEXT,
  config                JSONB NOT NULL DEFAULT '{}',
  health_status         TEXT NOT NULL DEFAULT 'operational' CHECK (health_status IN ('operational','degraded','unavailable')),
  health_checked_at     TIMESTAMPTZ,
  health_latency_ms     INT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER payment_providers_updated BEFORE UPDATE ON payment_providers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE provider_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES payment_providers(id),
  operation   TEXT NOT NULL,
  success     BOOLEAN NOT NULL,
  latency_ms  INT NOT NULL,
  request     JSONB,
  response    JSONB,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX provider_logs_provider_idx ON provider_logs(provider_id, created_at DESC);

-- ---------------------------------------------------------------- customers & payments
CREATE TABLE customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  mode            TEXT NOT NULL CHECK (mode IN ('test','live')),
  email           TEXT NOT NULL,
  name            TEXT,
  phone           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, mode, email)
);
CREATE TRIGGER customers_updated BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE payment_links (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  mode                 TEXT NOT NULL CHECK (mode IN ('test','live')),
  slug                 TEXT NOT NULL UNIQUE,
  title                TEXT NOT NULL,
  amount               BIGINT CHECK (amount IS NULL OR amount > 0),
  currency             TEXT NOT NULL DEFAULT 'NGN',
  description          TEXT,
  customer_email       TEXT,
  reference            TEXT,
  success_redirect_url TEXT,
  cancel_redirect_url  TEXT,
  expires_at           TIMESTAMPTZ,
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_by           UUID REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payment_links_org_idx ON payment_links(organization_id, mode, created_at DESC);
CREATE TRIGGER payment_links_updated BEFORE UPDATE ON payment_links FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE payments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID NOT NULL REFERENCES organizations(id),
  mode               TEXT NOT NULL CHECK (mode IN ('test','live')),
  reference          TEXT NOT NULL UNIQUE,
  merchant_reference TEXT,
  customer_id        UUID REFERENCES customers(id),
  amount             BIGINT NOT NULL CHECK (amount > 0),
  currency           TEXT NOT NULL DEFAULT 'NGN',
  fee                BIGINT NOT NULL CHECK (fee >= 0),
  net_amount         BIGINT NOT NULL,
  amount_received    BIGINT NOT NULL DEFAULT 0,
  amount_refunded    BIGINT NOT NULL DEFAULT 0 CHECK (amount_refunded >= 0),
  status             TEXT NOT NULL DEFAULT 'created' CHECK (status IN
                     ('created','pending','processing','successful','failed','expired','reversed','refunded','partially_refunded')),
  payment_method     TEXT NOT NULL DEFAULT 'bank_transfer',
  description        TEXT,
  metadata           JSONB NOT NULL DEFAULT '{}',
  callback_url       TEXT,
  failure_reason     TEXT,
  payment_link_id    UUID REFERENCES payment_links(id),
  provider_id        UUID REFERENCES payment_providers(id),
  expires_at         TIMESTAMPTZ NOT NULL,
  paid_at            TIMESTAMPTZ,
  available_at       TIMESTAMPTZ,
  settled_at         TIMESTAMPTZ,
  created_ip         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (net_amount = amount - fee),
  CHECK (amount_refunded <= amount)
);
CREATE UNIQUE INDEX payments_merchant_ref_uq ON payments(organization_id, mode, merchant_reference) WHERE merchant_reference IS NOT NULL;
CREATE INDEX payments_org_idx ON payments(organization_id, mode, created_at DESC);
CREATE INDEX payments_status_idx ON payments(status, expires_at);
CREATE INDEX payments_customer_idx ON payments(customer_id);
CREATE INDEX payments_unsettled_idx ON payments(organization_id, mode, available_at) WHERE status IN ('successful','partially_refunded') AND settled_at IS NULL;
CREATE TRIGGER payments_updated BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE payment_status_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id  UUID NOT NULL REFERENCES payments(id),
  from_status TEXT,
  to_status   TEXT NOT NULL,
  reason      TEXT,
  actor       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payment_status_history_payment_idx ON payment_status_history(payment_id, created_at);
CREATE TRIGGER payment_status_history_immutable BEFORE UPDATE OR DELETE ON payment_status_history FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Collection instructions issued by a provider for a payment (e.g. a dynamic virtual account).
CREATE TABLE payment_intents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id         UUID NOT NULL REFERENCES payments(id),
  provider_id        UUID NOT NULL REFERENCES payment_providers(id),
  provider_reference TEXT NOT NULL,
  bank_name          TEXT NOT NULL,
  account_name       TEXT NOT NULL,
  account_number     TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','used','expired')),
  expires_at         TIMESTAMPTZ NOT NULL,
  raw                JSONB NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, provider_reference)
);
CREATE INDEX payment_intents_payment_idx ON payment_intents(payment_id);
CREATE UNIQUE INDEX payment_intents_active_account ON payment_intents(provider_id, account_number) WHERE status = 'active';

CREATE TABLE payment_link_payments (
  payment_link_id UUID NOT NULL REFERENCES payment_links(id),
  payment_id      UUID NOT NULL UNIQUE REFERENCES payments(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (payment_link_id, payment_id)
);

-- Money movements reported by providers. Source of truth for reconciliation.
CREATE TABLE provider_transactions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id        UUID NOT NULL REFERENCES payment_providers(id),
  mode               TEXT NOT NULL CHECK (mode IN ('test','live')),
  provider_reference TEXT NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('collection','reversal','refund','payout')),
  amount             BIGINT NOT NULL,
  currency           TEXT NOT NULL DEFAULT 'NGN',
  account_number     TEXT,
  payer_name         TEXT,
  payer_account      TEXT,
  payer_bank         TEXT,
  payment_id         UUID REFERENCES payments(id),
  match_status       TEXT NOT NULL CHECK (match_status IN ('matched','unmatched','mismatch','late')),
  occurred_at        TIMESTAMPTZ NOT NULL,
  raw                JSONB NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, provider_reference, kind)
);
CREATE INDEX provider_transactions_payment_idx ON provider_transactions(payment_id);
CREATE INDEX provider_transactions_occurred_idx ON provider_transactions(occurred_at);

-- ---------------------------------------------------------------- webhooks
CREATE TABLE webhook_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id       UUID REFERENCES payment_providers(id),
  provider_code     TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  payload           JSONB NOT NULL,
  signature_valid   BOOLEAN NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'received'
                    CHECK (processing_status IN ('received','processing','processed','failed','ignored')),
  retry_count       INT NOT NULL DEFAULT 0,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at      TIMESTAMPTZ,
  UNIQUE (provider_code, external_event_id)
);
CREATE INDEX webhook_events_created_idx ON webhook_events(created_at DESC);

CREATE TABLE merchant_webhooks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  mode             TEXT NOT NULL CHECK (mode IN ('test','live')),
  url              TEXT NOT NULL,
  secret_encrypted TEXT NOT NULL,
  secret_last4     TEXT NOT NULL,
  events           TEXT[] NOT NULL,
  enabled          BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, mode)
);
CREATE TRIGGER merchant_webhooks_updated BEFORE UPDATE ON merchant_webhooks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE webhook_deliveries (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_webhook_id    UUID NOT NULL REFERENCES merchant_webhooks(id) ON DELETE CASCADE,
  organization_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  mode                   TEXT NOT NULL,
  event_id               TEXT NOT NULL,
  event_type             TEXT NOT NULL,
  url                    TEXT NOT NULL,
  payload                JSONB NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','retrying','succeeded','failed')),
  attempt_count          INT NOT NULL DEFAULT 0,
  next_attempt_at        TIMESTAMPTZ,
  last_response_status   INT,
  last_response_time_ms  INT,
  last_response_body     TEXT,
  last_error             TEXT,
  delivered_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (merchant_webhook_id, event_id)
);
CREATE INDEX webhook_deliveries_org_idx ON webhook_deliveries(organization_id, mode, created_at DESC);
CREATE TRIGGER webhook_deliveries_updated BEFORE UPDATE ON webhook_deliveries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------- API
CREATE TABLE api_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  mode            TEXT NOT NULL CHECK (mode IN ('test','live')),
  kind            TEXT NOT NULL CHECK (kind IN ('secret','public')),
  prefix          TEXT NOT NULL,
  key_hash        TEXT NOT NULL UNIQUE,
  last4           TEXT NOT NULL,
  -- Public keys are not secret; they are stored in plain text so they can be displayed.
  public_value    TEXT,
  created_by      UUID REFERENCES users(id),
  last_used_at    TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_org_idx ON api_keys(organization_id, mode);

CREATE TABLE api_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  api_key_id      UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  mode            TEXT,
  request_id      TEXT NOT NULL,
  method          TEXT NOT NULL,
  path            TEXT NOT NULL,
  status_code     INT NOT NULL,
  latency_ms      INT NOT NULL,
  ip              TEXT,
  idempotency_key TEXT,
  request_body    JSONB,
  response_body   JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX api_logs_org_idx ON api_logs(organization_id, mode, created_at DESC);
CREATE INDEX api_logs_request_idx ON api_logs(request_id);

CREATE TABLE idempotency_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope           TEXT NOT NULL,
  key             TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  response_status INT,
  response_body   JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  UNIQUE (scope, key)
);

-- ---------------------------------------------------------------- ledger (double entry)
CREATE TABLE ledger_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),
  mode            TEXT NOT NULL CHECK (mode IN ('test','live')),
  code            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('asset','liability','revenue','expense')),
  currency        TEXT NOT NULL DEFAULT 'NGN',
  name            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ledger_accounts_uq ON ledger_accounts(COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), mode, code, currency);

CREATE TABLE ledger_transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode             TEXT NOT NULL CHECK (mode IN ('test','live')),
  organization_id  UUID REFERENCES organizations(id),
  kind             TEXT NOT NULL CHECK (kind IN ('payment','fee','refund','reversal','settlement','withdrawal',
                                                 'withdrawal_reversal','settlement_reversal','release','adjustment','suspense')),
  description      TEXT NOT NULL,
  reference_type   TEXT,
  reference_id     UUID,
  idempotency_key  TEXT NOT NULL UNIQUE,
  created_by       TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ledger_transactions_ref_idx ON ledger_transactions(reference_type, reference_id);
CREATE INDEX ledger_transactions_org_idx ON ledger_transactions(organization_id, mode, created_at DESC);
CREATE TRIGGER ledger_transactions_immutable BEFORE UPDATE OR DELETE ON ledger_transactions FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE ledger_entries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES ledger_transactions(id),
  account_id     UUID NOT NULL REFERENCES ledger_accounts(id),
  direction      TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  amount         BIGINT NOT NULL CHECK (amount > 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entries_account_idx ON ledger_entries(account_id);
CREATE INDEX ledger_entries_tx_idx ON ledger_entries(transaction_id);
CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Every ledger transaction must balance (sum of debits = sum of credits), checked at commit.
CREATE OR REPLACE FUNCTION check_ledger_balanced() RETURNS trigger AS $$
DECLARE d BIGINT; c BIGINT;
BEGIN
  SELECT COALESCE(SUM(amount) FILTER (WHERE direction='debit'),0), COALESCE(SUM(amount) FILTER (WHERE direction='credit'),0)
    INTO d, c FROM ledger_entries WHERE transaction_id = NEW.transaction_id;
  IF d <> c THEN RAISE EXCEPTION 'Unbalanced ledger transaction % (debits %, credits %)', NEW.transaction_id, d, c; END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER ledger_entries_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_ledger_balanced();

-- ---------------------------------------------------------------- fees
CREATE TABLE fees (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE, -- NULL = platform default
  percentage_bps  INT NOT NULL CHECK (percentage_bps BETWEEN 0 AND 1000),
  fixed_fee       BIGINT NOT NULL DEFAULT 0 CHECK (fixed_fee >= 0),
  min_fee         BIGINT NOT NULL DEFAULT 0 CHECK (min_fee >= 0),
  max_fee         BIGINT CHECK (max_fee IS NULL OR max_fee >= min_fee),
  payout_fee      BIGINT NOT NULL DEFAULT 0 CHECK (payout_fee >= 0),
  active          BOOLEAN NOT NULL DEFAULT true,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX fees_one_active ON fees(COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE active;

-- ---------------------------------------------------------------- settlements, withdrawals, refunds
CREATE TABLE settlements (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID NOT NULL REFERENCES organizations(id),
  mode               TEXT NOT NULL CHECK (mode IN ('test','live')),
  reference          TEXT NOT NULL UNIQUE,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','reversed')),
  schedule           TEXT NOT NULL,
  destination        TEXT NOT NULL CHECK (destination IN ('bank','balance')),
  gross_amount       BIGINT NOT NULL,
  fee_amount         BIGINT NOT NULL,
  net_amount         BIGINT NOT NULL CHECK (net_amount >= 0),
  payment_count      INT NOT NULL,
  bank_account_id    UUID REFERENCES bank_accounts(id),
  provider_id        UUID REFERENCES payment_providers(id),
  provider_reference TEXT,
  failure_reason     TEXT,
  idempotency_key    TEXT NOT NULL UNIQUE,
  processed_at       TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX settlements_org_idx ON settlements(organization_id, mode, created_at DESC);
CREATE INDEX settlements_status_idx ON settlements(status);
CREATE TRIGGER settlements_updated BEFORE UPDATE ON settlements FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE settlement_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id UUID NOT NULL REFERENCES settlements(id),
  payment_id    UUID NOT NULL UNIQUE REFERENCES payments(id),
  gross_amount  BIGINT NOT NULL,
  fee_amount    BIGINT NOT NULL,
  net_amount    BIGINT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX settlement_items_settlement_idx ON settlement_items(settlement_id);

CREATE TABLE withdrawals (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID NOT NULL REFERENCES organizations(id),
  mode               TEXT NOT NULL CHECK (mode IN ('test','live')),
  reference          TEXT NOT NULL UNIQUE,
  amount             BIGINT NOT NULL CHECK (amount > 0),
  fee                BIGINT NOT NULL CHECK (fee >= 0),
  net_amount         BIGINT NOT NULL CHECK (net_amount > 0),
  bank_account_id    UUID NOT NULL REFERENCES bank_accounts(id),
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','reversed')),
  idempotency_key    TEXT NOT NULL,
  requested_by       UUID REFERENCES users(id),
  provider_id        UUID REFERENCES payment_providers(id),
  provider_reference TEXT,
  failure_reason     TEXT,
  risk_flags         TEXT[] NOT NULL DEFAULT '{}',
  processed_at       TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key),
  CHECK (net_amount = amount - fee)
);
CREATE INDEX withdrawals_org_idx ON withdrawals(organization_id, mode, created_at DESC);
CREATE TRIGGER withdrawals_updated BEFORE UPDATE ON withdrawals FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE refunds (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID NOT NULL REFERENCES organizations(id),
  mode               TEXT NOT NULL CHECK (mode IN ('test','live')),
  payment_id         UUID NOT NULL REFERENCES payments(id),
  reference          TEXT NOT NULL UNIQUE,
  amount             BIGINT NOT NULL CHECK (amount > 0),
  reason             TEXT,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  idempotency_key    TEXT NOT NULL,
  requested_by       TEXT NOT NULL,
  provider_reference TEXT,
  failure_reason     TEXT,
  completed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX refunds_payment_idx ON refunds(payment_id);
CREATE TRIGGER refunds_updated BEFORE UPDATE ON refunds FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------- risk, reconciliation, audit
CREATE TABLE risk_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),
  mode            TEXT,
  rule            TEXT NOT NULL,
  severity        TEXT NOT NULL CHECK (severity IN ('low','medium','high')),
  subject_type    TEXT,
  subject_id      UUID,
  details         JSONB NOT NULL DEFAULT '{}',
  ip              TEXT,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','dismissed')),
  reviewed_by     UUID REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX risk_events_org_idx ON risk_events(organization_id, created_at DESC);
CREATE INDEX risk_events_status_idx ON risk_events(status, created_at DESC);

CREATE TABLE reconciliation_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start  TIMESTAMPTZ NOT NULL,
  period_end    TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  checked_count INT NOT NULL DEFAULT 0,
  issues_found  INT NOT NULL DEFAULT 0,
  error         TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ
);

CREATE TABLE reconciliation_issues (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                  UUID REFERENCES reconciliation_runs(id),
  type                    TEXT NOT NULL CHECK (type IN ('missing_transaction','duplicate_transaction','amount_mismatch',
                                                       'unexpected_reversal','failed_settlement','unmatched_transaction')),
  status                  TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved')),
  fingerprint             TEXT NOT NULL UNIQUE,
  organization_id         UUID REFERENCES organizations(id),
  mode                    TEXT,
  payment_id              UUID REFERENCES payments(id),
  provider_transaction_id UUID REFERENCES provider_transactions(id),
  settlement_id           UUID REFERENCES settlements(id),
  expected_amount         BIGINT,
  actual_amount           BIGINT,
  details                 JSONB NOT NULL DEFAULT '{}',
  resolution_note         TEXT,
  resolved_by             UUID REFERENCES users(id),
  resolved_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reconciliation_issues_status_idx ON reconciliation_issues(status, created_at DESC);
CREATE TRIGGER reconciliation_issues_updated BEFORE UPDATE ON reconciliation_issues FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type      TEXT NOT NULL CHECK (actor_type IN ('user','staff','api_key','system','provider')),
  actor_id        TEXT,
  organization_id UUID REFERENCES organizations(id),
  action          TEXT NOT NULL,
  target_type     TEXT,
  target_id       TEXT,
  ip              TEXT,
  user_agent      TEXT,
  request_id      TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_org_idx ON audit_logs(organization_id, created_at DESC);
CREATE INDEX audit_logs_action_idx ON audit_logs(action, created_at DESC);
CREATE INDEX audit_logs_target_idx ON audit_logs(target_type, target_id);
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  channel         TEXT NOT NULL CHECK (channel IN ('email','in_app')),
  recipient       TEXT,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  data            JSONB NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  error           TEXT,
  read_at         TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_org_idx ON notifications(organization_id, channel, created_at DESC);

-- ---------------------------------------------------------------- jobs & settings
-- Transactional job queue: jobs are enqueued in the same DB transaction as the
-- state change that caused them (outbox pattern), and claimed with SKIP LOCKED.
CREATE TABLE jobs (
  id           BIGSERIAL PRIMARY KEY,
  queue        TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
  attempts     INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 8,
  run_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  dedupe_key   TEXT,
  locked_at    TIMESTAMPTZ,
  locked_by    TEXT,
  last_error   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX jobs_ready_idx ON jobs(run_at) WHERE status = 'pending';
CREATE UNIQUE INDEX jobs_dedupe_idx ON jobs(queue, dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('pending','running');

CREATE TABLE system_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
