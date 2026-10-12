import { pool } from '../db/pool';

export interface LendingPolicy {
  maxLoanToSavingsRatio: number;
  minMembershipMonths: number;
  maxArrearsAllowed: number;
  guaranteeMultiplier: number;
  defaultInterestRate: number;
}

export const defaultPolicy: LendingPolicy = {
  maxLoanToSavingsRatio: 3,
  minMembershipMonths: 6,
  maxArrearsAllowed: 0,
  guaranteeMultiplier: 2,
  defaultInterestRate: 12,
};

// Policy lives in the database so the Sacco can change it without a redeploy.
export async function loadPolicy(): Promise<LendingPolicy> {
  const { rows } = await pool.query(
    `SELECT * FROM lending_policy ORDER BY id DESC LIMIT 1`
  );
  if (!rows[0]) return defaultPolicy;
  return {
    maxLoanToSavingsRatio: Number(rows[0].max_loan_to_savings_ratio),
    minMembershipMonths: Number(rows[0].min_membership_months),
    maxArrearsAllowed: Number(rows[0].max_arrears_allowed),
    guaranteeMultiplier: Number(rows[0].guarantee_multiplier ?? 2),
    defaultInterestRate: Number(rows[0].default_interest_rate ?? 12),
  };
}
