# sacco-platform

Member SMS/WhatsApp alerts + loan eligibility and guarantor matching, on one shared schema.

## Setup
1. `npm install`
2. `cp .env.example .env` and fill in your Africa's Talking sandbox and Twilio sandbox credentials
3. Create a database: `createdb sacco_platform`
4. Edit phone numbers in `src/db/seed.sql` to your own test numbers (E.164, e.g. +2547...)
5. `npm run db:setup`
6. `npm run dev`

## Try it
Evaluate a loan:

    curl -X POST localhost:3000/loans/evaluate -H 'Content-Type: application/json' \
      -d '{"memberId":2,"amount":200000,"guarantors":[{"memberId":5,"amount":50000}]}'

Apply for a loan (eligibility-checked, creates a pending loan):

    curl -X POST localhost:3000/loans/apply -H 'Content-Type: application/json' \
      -d '{"memberId":2,"amount":200000,"termMonths":12}'

Approve / reject / disburse:

    curl -X POST localhost:3000/loans/1/approve
    curl -X POST localhost:3000/loans/1/reject -H 'Content-Type: application/json' -d '{"reason":"Low savings"}'
    curl -X POST localhost:3000/loans/1/disburse

Record a repayment (auto-marks paid when cleared + sends receipt SMS):

    curl -X POST localhost:3000/loans/1/repay -H 'Content-Type: application/json' \
      -d '{"amount":5000,"method":"M-Pesa","reference":"MPESA123"}'

Loan statement + loan list:

    curl localhost:3000/loans/1/statement
    curl 'localhost:3000/loans?status=active&limit=20'

Members + savings ledger:

    curl localhost:3000/members?search=amina
    curl localhost:3000/members/2
    curl -X POST localhost:3000/members -H 'Content-Type: application/json' \
      -d '{"name":"Faith Njeri","phone":"+254700000006","initialSavings":50000,"shareCapital":20000}'
    curl -X POST localhost:3000/members/2/savings -H 'Content-Type: application/json' \
      -d '{"type":"deposit","amount":10000}'
    curl localhost:3000/members/2/ledger

Guarantor suggestions, reports, policy:

    curl 'localhost:3000/guarantors/suggest?shortfall=100000&exclude=2&branchId=1'
    curl localhost:3000/reports/summary
    curl localhost:3000/reports/arrears
    curl 'localhost:3000/reports/upcoming?days=7'
    curl localhost:3000/policy
    curl -X PUT localhost:3000/policy -H 'Content-Type: application/json' \
      -d '{"maxLoanToSavingsRatio":3,"guaranteeMultiplier":2,"defaultInterestRate":12}'

Run the reminder job now:

    curl -X POST localhost:3000/jobs/loan-reminders/run

View sent messages:

    curl localhost:3000/notifications

## New: amortization, penalties, dividends, M-Pesa, auth

Loan schedule (per-installment principal/interest split + live allocation):

    curl localhost:3000/loans/1/schedule
    curl -X POST localhost:3000/loans/schedule/preview -H 'Content-Type: application/json' \
      -d '{"principal":200000,"annualInterestRatePct":12,"termMonths":12}'

Late penalties (rule in `lending_policy`: `late_penalty_rate` % per 30-day
block past `grace_period_days`; idempotent) + write-off with guarantor recovery:

    curl -X POST localhost:3000/loans/1/penalties/assess
    curl localhost:3000/loans/1/penalties
    curl -X POST localhost:3000/penalties/1/waive -H 'Content-Type: application/json' -d '{"reason":"Goodwill"}'
    curl -X POST localhost:3000/loans/1/write-off -H 'Content-Type: application/json' -d '{"reason":"Unrecoverable"}'

Dividends (declare a cycle, then pay it into members' savings):

    curl -X POST localhost:3000/dividends/declare -H 'Content-Type: application/json' \
      -d '{"label":"FY2025 Dividends","fiscalYear":2025,"shareRate":8,"savingsRate":5}'
    curl localhost:3000/dividends
    curl -X POST localhost:3000/dividends/1/pay
    curl localhost:3000/members/2/dividends

M-Pesa Daraja (configure MPESA_* in `.env`; callback auto-matches oldest
open loan first, else savings deposit; idempotent on TransID):

    curl -X POST localhost:3000/payments/mpesa/stkpush -H 'Content-Type: application/json' \
      -d '{"memberId":2,"amount":5000}'
    curl localhost:3000/payments/mpesa/callbacks

Auth (JWT, roles admin | teller | member). Disabled by default for demos;
enforce with `JWT_SECRET=<long-random> AUTH_DISABLED=false`:

    curl -X POST localhost:3000/auth/register -H 'Content-Type: application/json' \
      -d '{"name":"Admin","phone":"+254700000099","password":"supersecret123"}'   # first user becomes admin
    curl -X POST localhost:3000/auth/login -H 'Content-Type: application/json' \
      -d '{"phone":"+254700000099","password":"supersecret123"}'
    curl localhost:3000/auth/me -H "Authorization: Bearer <token>"
    # Afterwards pass -H "Authorization: Bearer <token>" on every call.

## Notes
- Africa's Talking sandbox only delivers to the simulator; use a live account for real phones.
- Twilio WhatsApp sandbox requires each test phone to join the sandbox first.
- Guarantee multiplier + default interest rate live in `lending_policy` and are editable via `PUT /policy`; change to match Sacco policy.
