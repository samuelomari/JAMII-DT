DROP TABLE IF EXISTS dividend_payouts, dividend_cycles, guarantor_recoveries, penalties,
  notification_log, guarantors, repayments, transactions, loans, savings_accounts,
  lending_policy, members CASCADE;

CREATE TABLE members (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  branch_id INTEGER,
  membership_months INTEGER DEFAULT 0,
  sms_opt_in BOOLEAN DEFAULT true,
  whatsapp_opt_in BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE savings_accounts (
  id SERIAL PRIMARY KEY,
  member_id INTEGER UNIQUE REFERENCES members(id) ON DELETE CASCADE,
  balance NUMERIC NOT NULL DEFAULT 0,
  share_capital NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE loans (
  id SERIAL PRIMARY KEY,
  member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
  -- Legacy / compatibility columns (kept so existing seed + approve flow work)
  amount_due NUMERIC NOT NULL,
  due_date DATE NOT NULL,
  status TEXT DEFAULT 'pending',  -- pending | approved | active | arrears | rejected | disbursed | paid
  -- New lifecycle columns
  requested_amount NUMERIC,
  principal_amount NUMERIC,
  interest_rate NUMERIC DEFAULT 0,
  term_months INTEGER DEFAULT 12,
  paid_total NUMERIC DEFAULT 0,
  applied_at TIMESTAMP DEFAULT NOW(),
  approved_at TIMESTAMP,
  disbursed_at TIMESTAMP,
  rejected_reason TEXT,
  -- Interest + write-off
  interest_method TEXT DEFAULT 'reducing_balance',  -- reducing_balance | flat_rate
  written_off_at TIMESTAMP,
  write_off_reason TEXT
);

CREATE TABLE guarantors (
  id SERIAL PRIMARY KEY,
  loan_id INTEGER REFERENCES loans(id) ON DELETE CASCADE,
  guarantor_member_id INTEGER REFERENCES members(id),
  committed_amount NUMERIC NOT NULL,
  status TEXT DEFAULT 'active'
);

CREATE TABLE repayments (
  id SERIAL PRIMARY KEY,
  loan_id INTEGER REFERENCES loans(id) ON DELETE CASCADE,
  member_id INTEGER REFERENCES members(id),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  method TEXT DEFAULT 'M-Pesa',
  reference TEXT,
  paid_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE transactions (
  id SERIAL PRIMARY KEY,
  member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- deposit | withdrawal | disbursement | repayment | share_purchase
  amount NUMERIC NOT NULL,
  reference TEXT,
  loan_id INTEGER REFERENCES loans(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE notification_log (
  id SERIAL PRIMARY KEY,
  member_id INTEGER REFERENCES members(id),
  channel TEXT NOT NULL,
  body TEXT NOT NULL,
  success BOOLEAN,
  sent_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE lending_policy (
  id SERIAL PRIMARY KEY,
  max_loan_to_savings_ratio NUMERIC DEFAULT 3,
  min_membership_months INTEGER DEFAULT 6,
  max_arrears_allowed INTEGER DEFAULT 0,
  guarantee_multiplier NUMERIC DEFAULT 2,
  default_interest_rate NUMERIC DEFAULT 12,
  -- Late repayment penalties: rate% of the overdue amount per 30-day period,
  -- charged only after grace_period_days have passed.
  late_penalty_rate NUMERIC DEFAULT 0,
  grace_period_days INTEGER DEFAULT 7,
  default_interest_method TEXT DEFAULT 'reducing_balance',
  updated_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO lending_policy DEFAULT VALUES;

CREATE TABLE penalties (
  id SERIAL PRIMARY KEY,
  loan_id INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  member_id INTEGER REFERENCES members(id),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  reason TEXT DEFAULT 'Late repayment',
  days_overdue INTEGER DEFAULT 0,
  periods_charged INTEGER DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'outstanding',  -- outstanding | waived
  applied_at TIMESTAMP DEFAULT NOW(),
  waived_at TIMESTAMP,
  waived_reason TEXT
);

-- Money recovered from a guarantor's savings after a loan was written off.
CREATE TABLE guarantor_recoveries (
  id SERIAL PRIMARY KEY,
  loan_id INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  guarantor_member_id INTEGER NOT NULL REFERENCES members(id),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  reference TEXT,
  recovered_at TIMESTAMP DEFAULT NOW()
);

-- Annual dividend / interest rebate cycles paid out of Sacco surplus.
CREATE TABLE dividend_cycles (
  id SERIAL PRIMARY KEY,
  label TEXT NOT NULL,
  fiscal_year INTEGER NOT NULL,
  share_rate NUMERIC NOT NULL DEFAULT 0,    -- % of share capital
  savings_rate NUMERIC NOT NULL DEFAULT 0,  -- % of savings deposits
  status TEXT NOT NULL DEFAULT 'declared',  -- declared | paid
  total_share_dividend NUMERIC NOT NULL DEFAULT 0,
  total_savings_interest NUMERIC NOT NULL DEFAULT 0,
  total_payout NUMERIC NOT NULL DEFAULT 0,
  member_count INTEGER NOT NULL DEFAULT 0,
  declared_at TIMESTAMP DEFAULT NOW(),
  paid_at TIMESTAMP
);

CREATE TABLE dividend_payouts (
  id SERIAL PRIMARY KEY,
  cycle_id INTEGER NOT NULL REFERENCES dividend_cycles(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  share_capital NUMERIC NOT NULL DEFAULT 0,
  savings_balance NUMERIC NOT NULL DEFAULT 0,
  share_dividend NUMERIC NOT NULL DEFAULT 0,
  savings_interest NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | paid
  paid_at TIMESTAMP,
  UNIQUE (cycle_id, member_id)
);

CREATE TABLE app_users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE mpesa_callbacks (
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
CREATE INDEX IF NOT EXISTS idx_mpesa_receipt ON mpesa_callbacks(receipt);
CREATE INDEX IF NOT EXISTS idx_mpesa_hash ON mpesa_callbacks(receipt_hash);
CREATE INDEX IF NOT EXISTS idx_mpesa_member ON mpesa_callbacks(matched_member_id);
CREATE INDEX IF NOT EXISTS idx_users_phone ON app_users(phone);
