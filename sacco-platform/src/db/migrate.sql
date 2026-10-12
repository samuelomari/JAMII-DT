-- Run this on an EXISTING database created with the old schema (new installs: use schema.sql).
-- Usage: psql $DATABASE_URL -f src/db/migrate.sql

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

ALTER TABLE lending_policy ADD COLUMN IF NOT EXISTS guarantee_multiplier NUMERIC DEFAULT 2;
ALTER TABLE lending_policy ADD COLUMN IF NOT EXISTS default_interest_rate NUMERIC DEFAULT 12;
ALTER TABLE lending_policy ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_loans_member ON loans(member_id);
CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);
CREATE INDEX IF NOT EXISTS idx_loans_due ON loans(due_date);
CREATE INDEX IF NOT EXISTS idx_repayments_loan ON repayments(loan_id);
CREATE INDEX IF NOT EXISTS idx_transactions_member ON transactions(member_id);
CREATE INDEX IF NOT EXISTS idx_notifications_member ON notification_log(member_id);
