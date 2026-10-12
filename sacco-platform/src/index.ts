import 'dotenv/config';
import express from 'express';
import { pool } from './db/pool';
import { startLoanReminderJob, checkLoanDueDates } from './jobs/loanReminders';
import { loadPolicy } from './eligibility/policy';
import { scoreEligibility, loadMemberFinancials } from './eligibility/scoreEligibility';
import { checkGuarantorCapacity } from './guarantors/checkCapacity';
import { suggestGuarantors } from './guarantors/suggestGuarantors';
import { approveLoan } from './loans/approveLoan';
import { applyForLoan } from './loans/applyLoan';
import { repayLoan } from './loans/repayLoan';
import { rejectLoan, disburseLoan, getLoanStatement } from './loans/loanLifecycle';
import { listMembers, getMember, createMember, updateMember } from './members/members';
import { savingsTransaction, memberLedger } from './savings/savings';
import { portfolioSummary, arrearsReport, upcomingDues } from './reports/reports';
import { validateBody, validateIdParam } from './middleware/validate';

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

app.post('/loans/:id/approve', validateIdParam, async (req, res) => {
  try {
    res.json(await approveLoan(Number(req.params.id)));
  } catch (err: any) {
    console.error(err);
    res.status(400).json({ error: err.message ?? 'Approval failed' });
  }
});

app.post('/loans/apply', validateBody({ memberId: 'number', amount: 'number' }, { allowExtra: true }), async (req, res) => {
  try {
    const result = await applyForLoan(req.body);
    res.status(result.approved ? 201 : 422).json(result);
  } catch (err: any) {
    console.error(err);
    res.status(400).json({ error: err.message ?? 'Application failed' });
  }
});

app.post('/loans/:id/repay', validateIdParam, validateBody({ amount: 'number' }, { allowExtra: true }), async (req, res) => {
  try {
    res.json(await repayLoan({ loanId: Number(req.params.id), ...req.body }));
  } catch (err: any) {
    console.error(err);
    res.status(400).json({ error: err.message ?? 'Repayment failed' });
  }
});

app.post('/loans/:id/reject', validateIdParam, async (req, res) => {
  try {
    res.json(await rejectLoan(Number(req.params.id), req.body?.reason));
  } catch (err: any) {
    console.error(err);
    res.status(400).json({ error: err.message ?? 'Rejection failed' });
  }
});

app.post('/loans/:id/disburse', validateIdParam, async (req, res) => {
  try {
    res.json(await disburseLoan(Number(req.params.id)));
  } catch (err: any) {
    console.error(err);
    res.status(400).json({ error: err.message ?? 'Disbursement failed' });
  }
});

app.get('/loans/:id/statement', validateIdParam, async (req, res) => {
  try {
    res.json(await getLoanStatement(Number(req.params.id)));
  } catch (err: any) {
    console.error(err);
    res.status(404).json({ error: err.message ?? 'Not found' });
  }
});

app.get('/loans', async (req, res) => {
  try {
    const { status, memberId, limit = '50' } = req.query as Record<string, string>;
    const conds: string[] = [];
    const params: any[] = [];
    if (status) { params.push(status); conds.push(`l.status = $${params.length}`); }
    if (memberId) { params.push(Number(memberId)); conds.push(`l.member_id = $${params.length}`); }
    params.push(Math.min(Number(limit) || 50, 200));
    const { rows } = await pool.query(
      `SELECT l.*, m.name AS member_name FROM loans l JOIN members m ON m.id=l.member_id
       ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''} ORDER BY l.id DESC LIMIT $${params.length}`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list loans' });
  }
});

app.get('/members', async (req, res) => {
  try {
    res.json(await listMembers(Number(req.query.limit ?? 50), Number(req.query.offset ?? 0), req.query.search as string | undefined));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list members' });
  }
});

app.get('/members/:id', validateIdParam, async (req, res) => {
  try {
    res.json(await getMember(Number(req.params.id)));
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

app.post('/members', validateBody({ name: 'string', phone: 'string' }, { allowExtra: true }), async (req, res) => {
  try {
    res.status(201).json(await createMember(req.body));
  } catch (err: any) {
    console.error(err);
    res.status(400).json({ error: err.message ?? 'Create failed' });
  }
});

app.patch('/members/:id', validateIdParam, async (req, res) => {
  try {
    res.json(await updateMember(Number(req.params.id), req.body ?? {}));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/members/:id/savings', validateIdParam, validateBody({ type: 'string', amount: 'number' }, { allowExtra: true }), async (req, res) => {
  try {
    const { type, amount, reference } = req.body;
    if (!['deposit', 'withdrawal', 'share_purchase'].includes(type)) {
      return res.status(400).json({ error: 'type must be deposit | withdrawal | share_purchase' });
    }
    res.json(await savingsTransaction(Number(req.params.id), type, amount, reference));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/members/:id/ledger', validateIdParam, async (req, res) => {
  try {
    res.json(await memberLedger(Number(req.params.id), Number(req.query.limit ?? 50)));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load ledger' });
  }
});

// Manually trigger the reminder job (handy for demos).
app.post('/jobs/loan-reminders/run', async (_req, res) => {
  await checkLoanDueDates();
  res.json({ ok: true });
});

app.get('/guarantors/suggest', async (req, res) => {
  try {
    const shortfall = Number(req.query.shortfall ?? 0);
    const exclude = String(req.query.exclude ?? '').split(',').filter(Boolean).map(Number);
    const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
    if (!shortfall || shortfall <= 0) return res.status(400).json({ error: 'shortfall must be positive' });
    res.json(await suggestGuarantors(shortfall, exclude, branchId));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Suggestion failed' });
  }
});

app.get('/reports/summary', async (_req, res) => {
  try {
    res.json(await portfolioSummary());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Report failed' });
  }
});

app.get('/reports/arrears', async (_req, res) => {
  try {
    res.json(await arrearsReport());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Report failed' });
  }
});

app.get('/reports/upcoming', async (req, res) => {
  try {
    res.json(await upcomingDues(Number(req.query.days ?? 7)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Report failed' });
  }
});

app.get('/policy', async (_req, res) => {
  try {
    res.json(await loadPolicy());
  } catch (err) {
    res.status(500).json({ error: 'Failed to load policy' });
  }
});

app.put('/policy', async (req, res) => {
  try {
    const b = req.body ?? {};
    const { rows } = await pool.query(
      `INSERT INTO lending_policy (max_loan_to_savings_ratio, min_membership_months, max_arrears_allowed, guarantee_multiplier, default_interest_rate)
       VALUES (COALESCE($1, 3), COALESCE($2, 6), COALESCE($3, 0), COALESCE($4, 2), COALESCE($5, 12))
       RETURNING *`,
      [b.maxLoanToSavingsRatio ?? null, b.minMembershipMonths ?? null, b.maxArrearsAllowed ?? null, b.guaranteeMultiplier ?? null, b.defaultInterestRate ?? null]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: 'Policy update failed' });
  }
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
