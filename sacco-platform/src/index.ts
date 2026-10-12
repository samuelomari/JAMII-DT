import 'dotenv/config';
import express from 'express';
import { pool } from './db/pool';
import { startLoanReminderJob, checkLoanDueDates } from './jobs/loanReminders';
import { loadPolicy } from './eligibility/policy';
import { scoreEligibility, loadMemberFinancials } from './eligibility/scoreEligibility';
import { checkGuarantorCapacity } from './guarantors/checkCapacity';
import { suggestGuarantors } from './guarantors/suggestGuarantors';
import { approveLoan } from './loans/approveLoan';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

// Full loan check: eligibility + guarantor cover + suggestions if short.
// Body: { memberId, amount, guarantors: [{ memberId, amount }] }
app.post('/loans/evaluate', async (req, res) => {
  try {
    const { memberId, amount, guarantors = [] } = req.body;
    const financials = await loadMemberFinancials(memberId, (s, p) => pool.query(s, p));
    if (!financials) return res.status(404).json({ error: 'Member not found' });

    const eligibility = scoreEligibility(financials, await loadPolicy());
    const withinLimit = amount <= eligibility.maxLoanAmount;

    const guarantorChecks = await Promise.all(
      guarantors.map((g: { memberId: number; amount: number }) =>
        checkGuarantorCapacity(g.memberId, g.amount)
      )
    );
    const covered = guarantors.reduce(
      (sum: number, g: { amount: number }, i: number) =>
        sum + (guarantorChecks[i].sufficient ? g.amount : 0),
      0
    );
    const shortfall = Math.max(0, amount - covered);
    const suggestions =
      shortfall > 0
        ? await suggestGuarantors(shortfall, [memberId, ...guarantors.map((g: any) => g.memberId)])
        : [];

    res.json({
      eligibility,
      withinLimit,
      guarantorChecks,
      coveredAmount: covered,
      shortfall,
      suggestions,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Evaluation failed' });
  }
});

app.post('/loans/:id/approve', async (req, res) => {
  try {
    res.json(await approveLoan(Number(req.params.id)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Approval failed' });
  }
});

// Manually trigger the reminder job (handy for demos).
app.post('/jobs/loan-reminders/run', async (_req, res) => {
  await checkLoanDueDates();
  res.json({ ok: true });
});

app.get('/notifications', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM notification_log ORDER BY sent_at DESC LIMIT 100`
  );
  res.json(rows);
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`sacco-platform listening on :${port}`);
  startLoanReminderJob();
});
