-- State owned by the built-in sandbox provider. It plays the role of the external bank in
-- test mode, so reconciliation can compare "provider-side" records against our own.
CREATE TABLE sandbox_provider_accounts (
  account_number   TEXT PRIMARY KEY,
  reference        TEXT NOT NULL UNIQUE,
  expected_amount  BIGINT NOT NULL,
  account_name     TEXT NOT NULL,
  expires_at       TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sandbox_provider_transactions (
  reference        TEXT PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('collection','reversal','refund','payout')),
  account_number   TEXT,
  related_reference TEXT,
  amount           BIGINT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('processing','completed','failed')),
  payer_name       TEXT,
  payer_account    TEXT,
  payer_bank       TEXT,
  details          JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sandbox_provider_transactions_account_idx ON sandbox_provider_transactions(account_number);

-- Which merchant balance a refund was drawn from, so settlements and reversals stay exact.
ALTER TABLE refunds ADD COLUMN debit_account TEXT NOT NULL DEFAULT 'merchant_pending'
  CHECK (debit_account IN ('merchant_pending','merchant_available'));
