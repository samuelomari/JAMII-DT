DROP TABLE IF EXISTS notification_log, guarantors, loans, savings_accounts, lending_policy, members CASCADE;

CREATE TABLE members (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  branch_id INTEGER,
  membership_months INTEGER DEFAULT 0,
  sms_opt_in BOOLEAN DEFAULT true,
  whatsapp_opt_in BOOLEAN DEFAULT false
);

CREATE TABLE savings_accounts (
  id SERIAL PRIMARY KEY,
  member_id INTEGER UNIQUE REFERENCES members(id),
  balance NUMERIC NOT NULL DEFAULT 0,
  share_capital NUMERIC NOT NULL DEFAULT 0
);

CREATE TABLE loans (
  id SERIAL PRIMARY KEY,
  member_id INTEGER REFERENCES members(id),
  amount_due NUMERIC NOT NULL,
  due_date DATE NOT NULL,
  status TEXT DEFAULT 'pending'  -- pending | approved | active | arrears | paid
);

CREATE TABLE guarantors (
  id SERIAL PRIMARY KEY,
  loan_id INTEGER REFERENCES loans(id),
  guarantor_member_id INTEGER REFERENCES members(id),
  committed_amount NUMERIC NOT NULL,
  status TEXT DEFAULT 'active'
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
  max_arrears_allowed INTEGER DEFAULT 0
);

INSERT INTO lending_policy DEFAULT VALUES;
