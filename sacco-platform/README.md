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

Approve a loan (sends a confirmation SMS/WhatsApp):

    curl -X POST localhost:3000/loans/1/approve

Run the reminder job now:

    curl -X POST localhost:3000/jobs/loan-reminders/run

View sent messages:

    curl localhost:3000/notifications

## Notes
- Africa's Talking sandbox only delivers to the simulator; use a live account for real phones.
- Twilio WhatsApp sandbox requires each test phone to join the sandbox first.
- Guarantee limit is 2x share capital in `checkCapacity.ts` and `suggestGuarantors.ts`; change to match Sacco policy.
