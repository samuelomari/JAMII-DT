// Loan interest mathematics. Pure functions only - no database access - so the
// money rules can be unit tested directly.
//
// Two methods are supported:
//   reducing_balance - equal installments (annuity) on the declining balance
//   flat_rate        - interest is charged on the original principal for the
//                      whole term and spread evenly across installments

export type InterestMethod = 'reducing_balance' | 'flat_rate';

export const interestMethods: readonly InterestMethod[] = ['reducing_balance', 'flat_rate'];

export interface ScheduleInstallment {
  period: number;
  /** ISO date (YYYY-MM-DD) the installment falls due. */
  dueDate: string;
  openingBalance: number;
  installment: number;
  interest: number;
  principal: number;
  closingBalance: number;
}

export interface AmortizationInput {
  principal: number;
  /** Nominal annual interest rate, e.g. 12 for 12% p.a. */
  annualInterestRatePct: number;
  termMonths: number;
  /** ISO date (YYYY-MM-DD) the loan starts; first installment is one month later. */
  startDate: string;
  method?: InterestMethod;
}

export interface AmortizationResult {
  method: InterestMethod;
  monthlyRate: number;
  regularInstallment: number;
  totalInterest: number;
  totalPayable: number;
  installments: ScheduleInstallment[];
}

/** Money is stored as NUMERIC in Postgres; keep two decimal places everywhere. */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function monthlyRate(annualInterestRatePct: number): number {
  return annualInterestRatePct / 100 / 12;
}

export function isInterestMethod(value: unknown): value is InterestMethod {
  return typeof value === 'string' && (interestMethods as readonly string[]).includes(value);
}

/** Add whole months to an ISO date, clamping the day (31 Jan + 1m = 28/29 Feb). */
export function addMonths(isoDate: string, months: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Equal-installment (annuity) payment for a reducing-balance loan. */
export function annuityInstallment(
  principal: number,
  annualInterestRatePct: number,
  termMonths: number
): number {
  if (termMonths <= 0) throw new Error('termMonths must be positive');
  const rate = monthlyRate(annualInterestRatePct);
  if (rate === 0) return roundMoney(principal / termMonths);
  const growth = Math.pow(1 + rate, termMonths);
  return roundMoney((principal * rate * growth) / (growth - 1));
}

function reducingBalanceSchedule(
  principal: number,
  annualInterestRatePct: number,
  termMonths: number,
  startDate: string
): ScheduleInstallment[] {
  const rate = monthlyRate(annualInterestRatePct);
  const regular = annuityInstallment(principal, annualInterestRatePct, termMonths);
  const installments: ScheduleInstallment[] = [];
  let balance = roundMoney(principal);

  for (let period = 1; period <= termMonths; period++) {
    const openingBalance = balance;
    const interest = roundMoney(openingBalance * rate);
    const isFinalPeriod = period === termMonths;
    // The last installment settles whatever is left, absorbing rounding drift.
    const principalPart = isFinalPeriod
      ? openingBalance
      : Math.min(roundMoney(regular - interest), openingBalance);
    const installment = isFinalPeriod ? roundMoney(principalPart + interest) : regular;
    balance = roundMoney(openingBalance - principalPart);
    installments.push({
      period,
      dueDate: addMonths(startDate, period),
      openingBalance,
      installment,
      interest,
      principal: principalPart,
      closingBalance: balance,
    });
  }
  return installments;
}

function flatRateSchedule(
  principal: number,
  annualInterestRatePct: number,
  termMonths: number,
  startDate: string
): ScheduleInstallment[] {
  const totalInterest = roundMoney(principal * (annualInterestRatePct / 100) * (termMonths / 12));
  const perInterest = roundMoney(totalInterest / termMonths);
  const perPrincipal = roundMoney(principal / termMonths);
  const installments: ScheduleInstallment[] = [];
  let balance = roundMoney(principal);
  let interestCharged = 0;

  for (let period = 1; period <= termMonths; period++) {
    const openingBalance = balance;
    const isFinalPeriod = period === termMonths;
    const interest = isFinalPeriod ? roundMoney(totalInterest - interestCharged) : perInterest;
    const principalPart = isFinalPeriod ? openingBalance : perPrincipal;
    interestCharged = roundMoney(interestCharged + interest);
    balance = roundMoney(openingBalance - principalPart);
    installments.push({
      period,
      dueDate: addMonths(startDate, period),
      openingBalance,
      installment: roundMoney(principalPart + interest),
      interest,
      principal: principalPart,
      closingBalance: balance,
    });
  }
  return installments;
}

export function buildAmortizationSchedule(input: AmortizationInput): AmortizationResult {
  const { principal, annualInterestRatePct, termMonths, startDate } = input;
  if (!Number.isFinite(principal) || principal <= 0) throw new Error('principal must be positive');
  if (!Number.isInteger(termMonths) || termMonths <= 0) throw new Error('termMonths must be a positive integer');
  if (annualInterestRatePct < 0) throw new Error('annualInterestRatePct cannot be negative');

  const method = input.method ?? 'reducing_balance';
  const installments =
    method === 'flat_rate'
      ? flatRateSchedule(principal, annualInterestRatePct, termMonths, startDate)
      : reducingBalanceSchedule(principal, annualInterestRatePct, termMonths, startDate);

  const totalInterest = roundMoney(installments.reduce((sum, i) => sum + i.interest, 0));
  return {
    method,
    monthlyRate: monthlyRate(annualInterestRatePct),
    regularInstallment: installments.length ? installments[0].installment : 0,
    totalInterest,
    totalPayable: roundMoney(principal + totalInterest),
    installments,
  };
}

/** Sum a numeric field across records. */
export function sumBy<T>(rows: readonly T[], pick: (row: T) => number): number {
  return roundMoney(rows.reduce((sum, row) => roundMoney(sum + pick(row)), 0));
}
