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

## Notes
- Africa's Talking sandbox only delivers to the simulator; use a live account for real phones.
- Twilio WhatsApp sandbox requires each test phone to join the sandbox first.
- Guarantee multiplier + default interest rate live in `lending_policy` and are editable via `PUT /policy`; change to match Sacco policy.
