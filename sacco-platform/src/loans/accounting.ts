// Loan accounting: assembles a loan's amortization schedule, the penalties
// charged against it, and where each repayment was applied into a single
// position object that the API, statements and reports all share.

import { pool } from '../db/pool';
import {
  AmortizationResult,
  InterestMethod,
  ScheduleInstallment,
  buildAmortizationSchedule,
  isInterestMethod,
  roundMoney,
} from './interest';
import { AllocationResult, PaymentEvent, PenaltyCharge, allocatePayments } from './allocation';

export interface LoanRow {
  id: number;
  member_id: number;
  member_name?: string;
  member_phone?: string;
  amount_due: string | number;
  due_date: string;
  status: string;
  requested_amount: string | number | null;
  principal_amount: string | number | null;
  interest_rate: string | number | null;
  term_months: number | null;
  interest_method: string | null;
  paid_total: string | number | null;
  applied_at: string | Date | null;
  approved_at: string | Date | null;
  disbursed_at: string | Date | null;
}

export interface LoanAccounting {
  loan: LoanRow;
  principal: number;
  annualInterestRatePct: number;
  termMonths: number;
  interestMethod: InterestMethod;
  /** True for legacy rows that have no principal_amount column value. */
  legacyBullet: boolean;
  startDate: string;
  schedule: AmortizationResult;
  allocation: AllocationResult;
  asOf: string;
}

export const num = (value: string | number | null | undefined, fallback = 0): number =>
  value === null || value === undefined ? fallback : Number(value);

export const toIsoDate = (value: string | Date | null | undefined, fallback: string): string => {
  if (!value) return fallback;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
};
/**
 * Legacy rows have no principal_amount: their amount_due is the whole balance
 * payable on due_date, which is exactly a single-installment bullet loan.
 */
function bulletSchedule(
  principal: number,
  annualInterestRatePct: number,
  termMonths: number,
  dueDate: string
): AmortizationResult {
  const interest = roundMoney(principal * (annualInterestRatePct / 100) * (termMonths / 12));
  const installment: ScheduleInstallment = {
    period: 1,
    dueDate,
    openingBalance: roundMoney(principal),
    installment: roundMoney(principal + interest),
    interest,
    principal: roundMoney(principal),
    closingBalance: 0,
  };
  return {
    method: 'flat_rate',
    monthlyRate: annualInterestRatePct / 100 / 12,
    regularInstallment: installment.installment,
    totalInterest: interest,
    totalPayable: installment.installment,
    installments: [installment],
  };
}

export interface BuiltLoanSchedule {
  schedule: AmortizationResult;
  principal: number;
  annualInterestRatePct: number;
  termMonths: number;
  interestMethod: InterestMethod;
  legacyBullet: boolean;
  startDate: string;
}

export function buildLoanSchedule(loan: LoanRow, asOfFallback: string): BuiltLoanSchedule {
  const legacyBullet = loan.principal_amount === null || loan.principal_amount === undefined;
  const principal = legacyBullet ? num(loan.amount_due) : num(loan.principal_amount);
  const annualInterestRatePct = num(loan.interest_rate, 0);
  const termMonths = Math.max(1, Math.trunc(num(loan.term_months, 12)));
  const interestMethod: InterestMethod = isInterestMethod(loan.interest_method)
    ? loan.interest_method
    : 'reducing_balance';

  if (legacyBullet) {
    return {
      schedule: bulletSchedule(principal, annualInterestRatePct, termMonths, loan.due_date),
      principal,
      annualInterestRatePct,
      termMonths,
      interestMethod,
      legacyBullet,
      startDate: loan.due_date,
    };
  }

  const startDate = toIsoDate(loan.disbursed_at ?? loan.approved_at ?? loan.applied_at, asOfFallback);
  return {
    schedule: buildAmortizationSchedule({
      principal,
      annualInterestRatePct,
      termMonths,
      startDate,
      method: interestMethod,
    }),
    principal,
    annualInterestRatePct,
    termMonths,
    interestMethod,
    legacyBullet,
    startDate,
  };
}
export async function loadLoanRow(loanId: number): Promise<LoanRow> {
  const { rows } = await pool.query(
    'SELECT l.*, m.name AS member_name, m.phone AS member_phone' +
      ' FROM loans l JOIN members m ON m.id = l.member_id WHERE l.id = $1',
    [loanId]
  );
  if (!rows[0]) throw new Error(`Loan ${loanId} not found`);
  return rows[0] as LoanRow;
}

/** Full position of a loan as of today (or an explicit date). */
export async function loadLoanAccounting(loanId: number, asOf?: string): Promise<LoanAccounting> {
  const evaluationDate = asOf ?? new Date().toISOString().slice(0, 10);
  const loan = await loadLoanRow(loanId);

  const paymentsResult = await pool.query(
    "SELECT id, amount, to_char(paid_at, 'YYYY-MM-DD') AS paid_at" +
      ' FROM repayments WHERE loan_id = $1 ORDER BY paid_at ASC, id ASC',
    [loanId]
  );
  const penaltiesResult = await pool.query(
    "SELECT id, amount FROM penalties WHERE loan_id = $1 AND status <> 'waived'" +
      ' ORDER BY applied_at ASC, id ASC',
    [loanId]
  );

  const built = buildLoanSchedule(loan, evaluationDate);
  const payments: PaymentEvent[] = paymentsResult.rows.map((row) => ({
    amount: num(row.amount),
    paidAt: String(row.paid_at),
  }));
  const penalties: PenaltyCharge[] = penaltiesResult.rows.map((row) => ({
    id: Number(row.id),
    amount: num(row.amount),
  }));

  return {
    loan,
    ...built,
    allocation: allocatePayments({
      installments: built.schedule.installments,
      penalties,
      payments,
      asOf: evaluationDate,
    }),
    asOf: evaluationDate,
  };
}
