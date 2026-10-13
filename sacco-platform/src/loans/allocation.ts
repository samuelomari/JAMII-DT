// Applies a member's repayments to a loan in the usual SACCO order:
//   1. outstanding penalties (oldest first)
//   2. interest of the earliest unpaid installment
//   3. principal of that installment
//   4. anything left over is a prepayment credit
//
// Pure functions only - the caller supplies installments, penalties and
// payments, and gets back exactly where every shilling went.

import { ScheduleInstallment, roundMoney } from './interest';

export interface PenaltyCharge {
  id: number;
  amount: number;
}

export interface PaymentEvent {
  amount: number;
  /** ISO date (YYYY-MM-DD). */
  paidAt: string;
}

export type InstallmentStatus = 'unpaid' | 'partial' | 'paid';

export interface InstallmentPosition extends ScheduleInstallment {
  paid: number;
  paidInterest: number;
  paidPrincipal: number;
  outstanding: number;
  status: InstallmentStatus;
  /** True when the installment was not fully settled by its due date. */
  overdue: boolean;
}

export interface PenaltyPosition extends PenaltyCharge {
  paid: number;
  outstanding: number;
}

export interface AllocationResult {
  installments: InstallmentPosition[];
  penalties: PenaltyPosition[];
  totals: {
    paidTotal: number;
    installmentDue: number;
    installmentPaid: number;
    principalDue: number;
    principalPaid: number;
    principalOutstanding: number;
    interestDue: number;
    interestPaid: number;
    interestOutstanding: number;
    penaltiesOutstanding: number;
    prepaymentCredit: number;
    totalOutstanding: number;
    settled: boolean;
  };
  nextDue?: {
    period: number;
    dueDate: string;
    installment: number;
    outstanding: number;
  };
  arrears: {
    periodsOverdue: number;
    overdueAmount: number;
  };
}

export interface AllocationInput {
  installments: readonly ScheduleInstallment[];
  penalties?: readonly PenaltyCharge[];
  payments?: readonly PaymentEvent[];
  /** ISO date used to decide what counts as overdue. Defaults to today. */
  asOf?: string;
  /** Pay penalties before installments (default true). */
  penaltiesFirst?: boolean;
}

const today = (): string => new Date().toISOString().slice(0, 10);

export function allocatePayments(input: AllocationInput): AllocationResult {
  const asOf = input.asOf ?? today();
  const penaltiesFirst = input.penaltiesFirst ?? true;

  const penaltyPositions: PenaltyPosition[] = (input.penalties ?? []).map((p) => ({
    id: p.id,
    amount: roundMoney(p.amount),
    paid: 0,
    outstanding: roundMoney(p.amount),
  }));

  const installments: InstallmentPosition[] = input.installments.map((i) => ({
    ...i,
    paid: 0,
    paidInterest: 0,
    paidPrincipal: 0,
    outstanding: roundMoney(i.installment),
    status: 'unpaid',
    overdue: false,
  }));

  let prepaymentCredit = 0;
  let paidTotal = 0;

  // Repayments are applied in the order they were made.
  const orderedPayments = [...(input.payments ?? [])].sort((a, b) => a.paidAt.localeCompare(b.paidAt));

  const payPenalties = (funds: number): number => {
    let remaining = funds;
    for (const penalty of penaltyPositions) {
      if (remaining <= 0) break;
      const applied = roundMoney(Math.min(penalty.outstanding, remaining));
      penalty.paid = roundMoney(penalty.paid + applied);
      penalty.outstanding = roundMoney(penalty.outstanding - applied);
      remaining = roundMoney(remaining - applied);
    }
    return remaining;
  };

  const payInstallments = (funds: number): number => {
    let remaining = funds;
    for (const installment of installments) {
      if (remaining <= 0) break;
      // Interest is settled before principal within each installment.
      const interestOwed = roundMoney(installment.interest - installment.paidInterest);
      if (interestOwed > 0) {
        const applied = roundMoney(Math.min(interestOwed, remaining));
        installment.paidInterest = roundMoney(installment.paidInterest + applied);
        remaining = roundMoney(remaining - applied);
      }
      const principalOwed = roundMoney(installment.principal - installment.paidPrincipal);
      if (principalOwed > 0 && remaining > 0) {
        const applied = roundMoney(Math.min(principalOwed, remaining));
        installment.paidPrincipal = roundMoney(installment.paidPrincipal + applied);
        remaining = roundMoney(remaining - applied);
      }
    }
    return remaining;
  };

  for (const payment of orderedPayments) {
    let remaining = roundMoney(payment.amount);
    paidTotal = roundMoney(paidTotal + remaining);
    if (penaltiesFirst) {
      remaining = payPenalties(remaining);
      remaining = payInstallments(remaining);
    } else {
      remaining = payInstallments(remaining);
      remaining = payPenalties(remaining);
    }
    if (remaining > 0) prepaymentCredit = roundMoney(prepaymentCredit + remaining);
  }

  let installmentDue = 0;
  let installmentPaid = 0;
  let principalDue = 0;
  let principalPaid = 0;
  let interestDue = 0;
  let interestPaid = 0;
  let overdueAmount = 0;
  let periodsOverdue = 0;

  for (const installment of installments) {
    installment.paid = roundMoney(installment.paidInterest + installment.paidPrincipal);
    installment.outstanding = roundMoney(installment.installment - installment.paid);
    installment.status =
      installment.outstanding <= 0 ? 'paid' : installment.paid > 0 ? 'partial' : 'unpaid';
    installment.overdue = installment.outstanding > 0 && installment.dueDate < asOf;

    installmentDue = roundMoney(installmentDue + installment.installment);
    installmentPaid = roundMoney(installmentPaid + installment.paid);
    principalDue = roundMoney(principalDue + installment.principal);
    principalPaid = roundMoney(principalPaid + installment.paidPrincipal);
    interestDue = roundMoney(interestDue + installment.interest);
    interestPaid = roundMoney(interestPaid + installment.paidInterest);

    if (installment.overdue) {
      periodsOverdue += 1;
      overdueAmount = roundMoney(overdueAmount + installment.outstanding);
    }
  }

  const penaltiesOutstanding = roundMoney(
    penaltyPositions.reduce((sum, p) => sum + p.outstanding, 0)
  );
  const principalOutstanding = roundMoney(principalDue - principalPaid);
  const interestOutstanding = roundMoney(interestDue - interestPaid);
  const totalOutstanding = roundMoney(
    Math.max(0, principalOutstanding) + Math.max(0, interestOutstanding) + penaltiesOutstanding
  );

  const nextInstallment = installments.find((i) => i.status !== 'paid') ?? installments[0];

  return {
    installments,
    penalties: penaltyPositions,
    totals: {
      paidTotal,
      installmentDue,
      installmentPaid,
      principalDue,
      principalPaid,
      principalOutstanding,
      interestDue,
      interestPaid,
      interestOutstanding,
      penaltiesOutstanding,
      prepaymentCredit,
      totalOutstanding,
      settled: totalOutstanding <= 0 && principalOutstanding <= 0,
    },
    nextDue: nextInstallment
      ? {
          period: nextInstallment.period,
          dueDate: nextInstallment.dueDate,
          installment: nextInstallment.installment,
          outstanding: nextInstallment.outstanding,
        }
      : undefined,
    arrears: { periodsOverdue, overdueAmount },
  };
}
