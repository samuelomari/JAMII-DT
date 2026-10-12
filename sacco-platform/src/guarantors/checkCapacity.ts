import { pool } from '../db/pool';
import { loadPolicy } from '../eligibility/policy';

export interface GuarantorCheck {
  memberId: number;
  guaranteeLimit: number;
  committedAmount: number;
  availableCapacity: number;
  sufficient: boolean;
}

// Guarantee limit = multiplier x the guarantor's share capital (from lending_policy).
export async function checkGuarantorCapacity(
  memberId: number,
  requestedAmount: number
): Promise<GuarantorCheck> {
  const policy = await loadPolicy();
  const mult = policy.guaranteeMultiplier ?? 2;
  const { rows } = await pool.query(
    `SELECT COALESCE(sa.share_capital, 0) * $2 AS guarantee_limit,
            COALESCE(SUM(g.committed_amount), 0) AS committed_amount
     FROM members m
     LEFT JOIN savings_accounts sa ON sa.member_id = m.id
     LEFT JOIN guarantors g ON g.guarantor_member_id = m.id AND g.status = 'active'
     WHERE m.id = $1
     GROUP BY sa.share_capital`,
    [memberId, mult]
  );

  const guaranteeLimit = Number(rows[0]?.guarantee_limit ?? 0);
  const committedAmount = Number(rows[0]?.committed_amount ?? 0);
  const availableCapacity = guaranteeLimit - committedAmount;

  return {
    memberId,
    guaranteeLimit,
    committedAmount,
    availableCapacity,
    sufficient: availableCapacity >= requestedAmount,
  };
}
