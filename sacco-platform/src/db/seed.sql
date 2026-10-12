-- Mock data. Replace phone numbers with your own test numbers (E.164 format).
INSERT INTO members (name, phone, branch_id, membership_months, sms_opt_in, whatsapp_opt_in) VALUES
  ('Amina Odhiambo', '+254700000001', 1, 24, true,  true),
  ('Brian Kiptoo',   '+254700000002', 1, 36, true,  false),
  ('Carol Wanjiru',  '+254700000003', 2, 3,  true,  false),
  ('David Mutua',    '+254700000004', 2, 48, true,  false),
  ('Esther Achieng', '+254700000005', 1, 60, true,  true);

INSERT INTO savings_accounts (member_id, balance, share_capital) VALUES
  (1, 120000, 40000),
  (2, 250000, 80000),
  (3, 15000,  5000),
  (4, 400000, 150000),
  (5, 300000, 100000);

INSERT INTO loans (member_id, amount_due, due_date, status) VALUES
  (1, 15000, CURRENT_DATE + 3, 'active'),
  (2, 30000, CURRENT_DATE,     'active'),
  (4, 50000, CURRENT_DATE - 10, 'arrears');

INSERT INTO guarantors (loan_id, guarantor_member_id, committed_amount, status) VALUES
  (1, 5, 60000, 'active');
