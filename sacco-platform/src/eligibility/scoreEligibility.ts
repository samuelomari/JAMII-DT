import { LendingPolicy, defaultPolicy } from './policy';

export interface MemberFinancials {
  savingsBalance: number;
  membershipMonths: number;
  activeArrearsCount: number;
}

export interface EligibilityResult {
  eligible: boolean;
  maxLoanAmount: number;
  reasons: string[];
}

export function scoreEligibility(
  member: MemberFinancials,
  policy: LendingPolicy = defaultPolicy
): EligibilityResult {
  const reasons: string[] = [];

  if (member.membershipMonths < policy.minMembershipMonths) {
    reasons.push(
      `Membership ${member.membershipMonths} months is below the ${policy.minMembershipMonths}-month minimum`
    );
  }
  if (member.activeArrearsCount > policy.maxArrearsAllowed) {
    reasons.push(`${member.activeArrearsCount} active arrears on record`);
  }

  const maxLoanAmount = member.savingsBalance * policy.maxLoanToSavingsRatio;
  const eligible = reasons.length === 0;

  return { eligible, maxLoanAmount: eligible ? maxLoanAmount : 0, reasons };
}

export async function loadMemberFinancials(
  memberId: number,
  query: (sql: string, params: unknown[]) => Promise<{ rows: any[] }>
): Promise<MemberFinancials | null> {
  const { rows } = await query(
    `SELECT m.membership_months,
            COALESCE(sa.balance, 0) AS balance,
            (SELECT COUNT(*) FROM loans l WHERE l.member_id = m.id AND l.status = 'arrears') AS arrears
     FROM members m
     LEFT JOIN savings_accounts sa ON sa.member_id = m.id
     WHERE m.id = $1`,
    [memberId]
  );
  if (!rows[0]) return null;
  return {
    savingsBalance: Number(rows[0].balance),
    membershipMonths: Number(rows[0].membership_months),
    activeArrearsCount: Number(rows[0].arrears),
  };
}
