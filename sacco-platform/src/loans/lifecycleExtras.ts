// Loan lifecycle extras: amortization position, penalties, write-off.
// Penalty rule (lending_policy): after grace_period_days past an installment's
// due date, each full 30-day period accrues late_penalty_rate % of outstanding.

import { pool } from '../db/pool';
import { loadLoanAccounting, loadLoanRow, buildLoanSchedule } from './accounting';
import { roundMoney } from './interest';
import { notifyMember } from '../channels/notifyMember';

export async function getLoanSchedule(loanId: number, asOf?: string) {
  const accounting = await loadLoanAccounting(loanId, asOf);
  return {
    loanId, memberId: accounting.loan.member_id, principal: accounting.principal,
    annualInterestRatePct: accounting.annualInterestRatePct, termMonths: accounting.termMonths,
    interestMethod: accounting.interestMethod, legacyBullet: accounting.legacyBullet,
    startDate: accounting.startDate, asOf: accounting.asOf,
    schedule: accounting.schedule, allocation: accounting.allocation,
  };
}

export async function previewLoanSchedule(input: {
  principal: number; annualInterestRatePct?: number; termMonths?: number;
  startDate?: string; method?: 'reducing_balance' | 'flat_rate';
}) {
  const principal = Number(input.principal);
  const termMonths = Math.trunc(Number(input.termMonths ?? 12));
  const annualInterestRatePct = Number(input.annualInterestRatePct ?? 12);
  if (!Number.isFinite(principal) || principal <= 0) throw new Error('principal must be positive');
  if (!Number.isInteger(termMonths) || termMonths <= 0) throw new Error('termMonths must be a positive integer');
  if (annualInterestRatePct < 0) throw new Error('annualInterestRatePct cannot be negative');
  const startDate = input.startDate ?? new Date().toISOString().slice(0, 10);
  const fakeLoan = {
    id: 0, member_id: 0, amount_due: principal, due_date: startDate, status: 'pending',
    requested_amount: principal, principal_amount: principal, interest_rate: annualInterestRatePct,
    term_months: termMonths, interest_method: input.method ?? 'reducing_balance',
    paid_total: 0, applied_at: startDate, approved_at: null, disbursed_at: startDate,
  } as any;
  return buildLoanSchedule(fakeLoan, startDate);
}

async function penaltyConfig() {
  const { rows } = await pool.query(
    `SELECT COALESCE(late_penalty_rate,0) AS rate, COALESCE(grace_period_days,7) AS grace
     FROM lending_policy ORDER BY id DESC LIMIT 1`
  );
  return { latePenaltyRate: Number(rows[0]?.rate ?? 0), gracePeriodDays: Number(rows[0]?.grace ?? 7) };
}

// Idempotent: periods_charged tracks billed 30-day blocks, so re-running
// only charges *new* periods per overdue installment.
export async function assessPenalties(loanId: number, asOf?: string) {
  const evaluationDate = asOf ?? new Date().toISOString().slice(0, 10);
  const { latePenaltyRate, gracePeriodDays } = await penaltyConfig();
  if (!(latePenaltyRate > 0)) {
    return { loanId, assessed: 0, penalties: [], message: 'late_penalty_rate is 0 — no penalties assessed' };
  }
  const loan = await loadLoanRow(loanId);
  if (!['active', 'arrears'].includes(loan.status)) {
    throw new Error(`Only active/arrears loans accrue penalties (current: ${loan.status})`);
  }
  const accounting = await loadLoanAccounting(loanId, evaluationDate);
  const asOfTime = new Date(evaluationDate + 'T00:00:00Z').getTime();
  const { rows: existing } = await pool.query(
    `SELECT reason, COALESCE(MAX(periods_charged),0)::int AS periods FROM penalties
     WHERE loan_id=$1 AND status<>'waived' GROUP BY reason`, [loanId]
  );
  const charged = new Map<string, number>(existing.map((r: any) => [String(r.reason), Number(r.periods)]));
  const assessed: any[] = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const inst of accounting.allocation.installments) {
      if (inst.outstanding <= 0) continue;
      const daysOverdue = Math.floor((asOfTime - new Date(inst.dueDate + 'T00:00:00Z').getTime()) / 86400000);
      if (daysOverdue <= gracePeriodDays) continue;
      const totalPeriods = Math.floor((daysOverdue - gracePeriodDays) / 30) + 1;
      const key = `Late repayment - installment ${inst.period}`;
      if (totalPeriods - (charged.get(key) ?? 0) <= 0) continue;
      const amount = roundMoney(inst.outstanding * (latePenaltyRate / 100) * (totalPeriods - (charged.get(key) ?? 0)));
      if (amount <= 0) continue;
      const { rows } = await client.query(
        `INSERT INTO penalties (loan_id, member_id, amount, reason, days_overdue, periods_charged)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [loanId, loan.member_id, amount, key, daysOverdue, totalPeriods]
      );
      assessed.push(rows[0]);
      charged.set(key, totalPeriods);
    }
    if (assessed.length) await client.query(`UPDATE loans SET status='arrears' WHERE id=$1 AND status='active'`, [loanId]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  return { loanId, assessed: assessed.length, penalties: assessed };
}

export async function waivePenalty(penaltyId: number, reason = 'Waived by officer') {
  const { rows } = await pool.query(
    `UPDATE penalties SET status='waived', waived_at=NOW(), waived_reason=$2
     WHERE id=$1 AND status='outstanding' RETURNING *`, [penaltyId, reason]
  );
  if (!rows[0]) throw new Error(`Outstanding penalty ${penaltyId} not found`);
  return rows[0];
}

export async function listPenalties(loanId: number) {
  const { rows } = await pool.query(`SELECT * FROM penalties WHERE loan_id=$1 ORDER BY applied_at ASC`, [loanId]);
  return rows;
}

// Write off an unrecoverable loan; recover pro-rata from active guarantors'
// savings balances, log recoveries, and notify the borrower.
export async function writeOffLoan(loanId: number, reason = 'Unrecoverable') {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT * FROM loans WHERE id=$1 FOR UPDATE`, [loanId]);
    const loan = rows[0];
    if (!loan) throw new Error(`Loan ${loanId} not found`);
    if (['paid', 'rejected'].includes(loan.status)) throw new Error(`Cannot write off a ${loan.status} loan`);
    if (loan.written_off_at) throw new Error(`Loan ${loanId} already written off`);
    const outstanding = Math.max(0, Number(loan.amount_due) - Number(loan.paid_total ?? 0));
    const { rows: guarantors } = await client.query(
      `SELECT g.*, COALESCE(sa.balance,0) AS savings_balance FROM guarantors g
       JOIN members m ON m.id=g.guarantor_member_id
       LEFT JOIN savings_accounts sa ON sa.member_id=m.id
       WHERE g.loan_id=$1 AND g.status='active' ORDER BY g.id ASC`, [loanId]
    );
    const recoveries: any[] = [];
    let recovered = 0;
    if (outstanding > 0 && guarantors.length) {
      const share = roundMoney(outstanding / guarantors.length);
      for (const g of guarantors) {
        const amount = Math.min(share, Number(g.savings_balance));
        if (amount <= 0) continue;
        await client.query(`UPDATE savings_accounts SET balance=balance-$2, updated_at=NOW() WHERE member_id=$1`,
          [g.guarantor_member_id, amount]);
        await client.query(
          `INSERT INTO transactions (member_id, type, amount, loan_id, reference)
           VALUES ($1,'guarantor_recovery',$2,$3,$4)`,
          [g.guarantor_member_id, -amount, loanId, `RECOV-${loanId}-${g.guarantor_member_id}`]
        );
        const { rows: rec } = await client.query(
          `INSERT INTO guarantor_recoveries (loan_id, guarantor_member_id, amount, reference)
           VALUES ($1,$2,$3,$4) RETURNING *`,
          [loanId, g.guarantor_member_id, amount, `RECOV-${loanId}-${g.guarantor_member_id}`]
        );
        await client.query(`UPDATE guarantors SET status='recovered' WHERE id=$1`, [g.id]);
        recoveries.push(rec[0]);
        recovered = roundMoney(recovered + amount);
      }
    }
    const { rows: updated } = await client.query(
      `UPDATE loans SET status='written_off', written_off_at=NOW(), write_off_reason=$2 WHERE id=$1 RETURNING *`,
      [loanId, reason]
    );
    await client.query(
      `INSERT INTO transactions (member_id, type, amount, loan_id, reference) VALUES ($1,'write_off',$2,$3,$4)`,
      [loan.member_id, -(outstanding - recovered), loanId, `WO-${loanId}`]
    );
    await client.query('COMMIT');
    const { rows: mRows } = await pool.query(
      `SELECT id, name, phone, sms_opt_in, whatsapp_opt_in FROM members WHERE id=$1`, [loan.member_id]);
    if (mRows[0]) {
      await notifyMember(mRows[0],
        `Dear ${mRows[0].name}, loan #${loanId} (balance KSh ${outstanding}) has been written off. Reason: ${reason}. - Jamii DT Sacco`
      ).catch(() => {});
    }
    return { loan: updated[0], outstanding, recovered, netWriteOff: roundMoney(outstanding - recovered), recoveries };
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}


