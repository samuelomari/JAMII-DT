DROP TABLE IF EXISTS notification_log, guarantors, repayments, transactions, loans, savings_accounts, lending_policy, members CASCADE;

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
  rejected_reason TEXT
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
  updated_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO lending_policy DEFAULT VALUES;

CREATE INDEX IF NOT EXISTS idx_loans_member ON loans(member_id);
CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);
CREATE INDEX IF NOT EXISTS idx_loans_due ON loans(due_date);
CREATE INDEX IF NOT EXISTS idx_repayments_loan ON repayments(loan_id);
CREATE INDEX IF NOT EXISTS idx_transactions_member ON transactions(member_id);
CREATE INDEX IF NOT EXISTS idx_notifications_member ON notification_log(member_id);

