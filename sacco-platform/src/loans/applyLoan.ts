import { pool } from '../db/pool';
import { loadPolicy } from '../eligibility/policy';
import { scoreEligibility, loadMemberFinancials } from '../eligibility/scoreEligibility';

export interface ApplyLoanInput {
  memberId: number;
  amount: number;
  termMonths?: number;
  interestRate?: number;
  dueDate?: string;
  guarantors?: { memberId: number; amount: number }[];
}

// Creates a pending loan after eligibility check. Guarantors attached if supplied.
export async function applyForLoan(input: ApplyLoanInput) {
  const { memberId, amount, termMonths = 12, dueDate } = input;
  if (!memberId || !amount || amount <= 0) throw new Error('memberId and positive amount are required');

  const financials = await loadMemberFinancials(memberId, (s, p) => pool.query(s, p));
  if (!financials) throw new Error(`Member ${memberId} not found`);

  const policy = await loadPolicy();
  const eligibility = scoreEligibility(financials, policy);
  const withinLimit = amount <= eligibility.maxLoanAmount;

  if (!eligibility.eligible || !withinLimit) {
    const reasons = [...eligibility.reasons];
    if (!withinLimit) reasons.push(`Requested KSh ${amount} exceeds max KSh ${eligibility.maxLoanAmount}`);
    return { approved: false, eligibility, withinLimit, reasons };
  }

  const interestRate = input.interestRate ?? policy.defaultInterestRate ?? 12;
  const computedDue = dueDate ?? new Date(Date.now() + termMonths * 30 * 86400000).toISOString().slice(0, 10);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO loans (member_id, amount_due, due_date, status, requested_amount, principal_amount, interest_rate, term_months, paid_total)
       VALUES ($1, $2, $3, 'pending', $2, $2, $4, $5, 0) RETURNING *`,
      [memberId, amount, computedDue, interestRate, termMonths]
    );
    const loan = rows[0];

    if (input.guarantors?.length) {
      for (const g of input.guarantors) {
        await client.query(
          `INSERT INTO guarantors (loan_id, guarantor_member_id, committed_amount, status)
           VALUES ($1, $2, $3, 'active')`,
          [loan.id, g.memberId, g.amount]
        );
      }
    }
    await client.query('COMMIT');
    return { approved: true, loan, eligibility, withinLimit };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
