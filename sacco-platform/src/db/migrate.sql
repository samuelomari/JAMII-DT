-- Run this on an EXISTING database created with the old schema (new installs: use schema.sql).
-- Usage: psql $DATABASE_URL -f src/db/migrate.sql
-- Auth users + M-Pesa callback journal (safe to run on existing DBs).
CREATE TABLE IF NOT EXISTS app_users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',  -- admin | teller | member
  member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mpesa_callbacks (
  id SERIAL PRIMARY KEY,
  checkout_request_id TEXT UNIQUE,
  merchant_request_id TEXT,
  result_code INTEGER,
  result_desc TEXT,
  receipt TEXT,
  amount NUMERIC,
  phone TEXT,
  receipt_hash TEXT,
  processed BOOLEAN DEFAULT false,
  matched_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  matched_loan_id INTEGER REFERENCES loans(id) ON DELETE SET NULL,
  outcome TEXT,
  raw JSONB,
  received_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mpesa_receipt ON mpesa_callbacks(receipt);
CREATE INDEX IF NOT EXISTS idx_mpesa_hash ON mpesa_callbacks(receipt_hash);
CREATE INDEX IF NOT EXISTS idx_mpesa_member ON mpesa_callbacks(matched_member_id);
CREATE INDEX IF NOT EXISTS idx_users_phone ON app_users(phone);


ALTER TABLE members ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'members_phone_key') THEN
    ALTER TABLE members ADD CONSTRAINT members_phone_key UNIQUE (phone);
  END IF;
END $$;

ALTER TABLE savings_accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

ALTER TABLE loans ADD COLUMN IF NOT EXISTS requested_amount NUMERIC;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS principal_amount NUMERIC;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS interest_rate NUMERIC DEFAULT 0;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS term_months INTEGER DEFAULT 12;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS paid_total NUMERIC DEFAULT 0;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS applied_at TIMESTAMP DEFAULT NOW();
ALTER TABLE loans ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS disbursed_at TIMESTAMP;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS rejected_reason TEXT;

CREATE TABLE IF NOT EXISTS repayments (
  id SERIAL PRIMARY KEY,
  loan_id INTEGER REFERENCES loans(id) ON DELETE CASCADE,
  member_id INTEGER REFERENCES members(id),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  method TEXT DEFAULT 'M-Pesa',
  reference TEXT,
  paid_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  reference TEXT,
  loan_id INTEGER REFERENCES loans(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE loans ADD COLUMN IF NOT EXISTS interest_method TEXT DEFAULT 'reducing_balance';
ALTER TABLE loans ADD COLUMN IF NOT EXISTS written_off_at TIMESTAMP;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS write_off_reason TEXT;

ALTER TABLE lending_policy ADD COLUMN IF NOT EXISTS guarantee_multiplier NUMERIC DEFAULT 2;
ALTER TABLE lending_policy ADD COLUMN IF NOT EXISTS default_interest_rate NUMERIC DEFAULT 12;
ALTER TABLE lending_policy ADD COLUMN IF NOT EXISTS late_penalty_rate NUMERIC DEFAULT 0;
ALTER TABLE lending_policy ADD COLUMN IF NOT EXISTS grace_period_days INTEGER DEFAULT 7;
ALTER TABLE lending_policy ADD COLUMN IF NOT EXISTS default_interest_method TEXT DEFAULT 'reducing_balance';
ALTER TABLE lending_policy ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

CREATE TABLE IF NOT EXISTS penalties (
  id SERIAL PRIMARY KEY,
  loan_id INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  member_id INTEGER REFERENCES members(id),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  reason TEXT DEFAULT 'Late repayment',
  days_overdue INTEGER DEFAULT 0,
  periods_charged INTEGER DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'outstanding',
  applied_at TIMESTAMP DEFAULT NOW(),
  waived_at TIMESTAMP,
  waived_reason TEXT
);

CREATE TABLE IF NOT EXISTS guarantor_recoveries (
  id SERIAL PRIMARY KEY,
  loan_id INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  guarantor_member_id INTEGER NOT NULL REFERENCES members(id),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  reference TEXT,
  recovered_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dividend_cycles (
  id SERIAL PRIMARY KEY,
  label TEXT NOT NULL,
  fiscal_year INTEGER NOT NULL,
  share_rate NUMERIC NOT NULL DEFAULT 0,
  savings_rate NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'declared',
  total_share_dividend NUMERIC NOT NULL DEFAULT 0,
  total_savings_interest NUMERIC NOT NULL DEFAULT 0,
  total_payout NUMERIC NOT NULL DEFAULT 0,
  member_count INTEGER NOT NULL DEFAULT 0,
  declared_at TIMESTAMP DEFAULT NOW(),
  paid_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dividend_payouts (
  id SERIAL PRIMARY KEY,
  cycle_id INTEGER NOT NULL REFERENCES dividend_cycles(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  share_capital NUMERIC NOT NULL DEFAULT 0,
  savings_balance NUMERIC NOT NULL DEFAULT 0,
  share_dividend NUMERIC NOT NULL DEFAULT 0,
  savings_interest NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMP,
  UNIQUE (cycle_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_loans_member ON loans(member_id);
CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);
CREATE INDEX IF NOT EXISTS idx_loans_due ON loans(due_date);
CREATE INDEX IF NOT EXISTS idx_repayments_loan ON repayments(loan_id);
CREATE INDEX IF NOT EXISTS idx_transactions_member ON transactions(member_id);
CREATE INDEX IF NOT EXISTS idx_notifications_member ON notification_log(member_id);
CREATE INDEX IF NOT EXISTS idx_penalties_loan ON penalties(loan_id);
CREATE INDEX IF NOT EXISTS idx_penalties_status ON penalties(status);
CREATE INDEX IF NOT EXISTS idx_recoveries_loan ON guarantor_recoveries(loan_id);
CREATE INDEX IF NOT EXISTS idx_payouts_cycle ON dividend_payouts(cycle_id);
CREATE INDEX IF NOT EXISTS idx_payouts_member ON dividend_payouts(member_id);
