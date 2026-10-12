import { pool } from '../db/pool';

export async function suggestGuarantors(
  shortfallAmount: number,
  excludeMemberIds: number[],
  branchId?: number
) {
  const { rows } = await pool.query(
    `SELECT m.id, m.name, m.phone,
            (COALESCE(sa.share_capital, 0) * 2) - COALESCE(SUM(g.committed_amount), 0) AS available_capacity
     FROM members m
     LEFT JOIN savings_accounts sa ON sa.member_id = m.id
     LEFT JOIN guarantors g ON g.guarantor_member_id = m.id AND g.status = 'active'
     WHERE NOT (m.id = ANY($1::int[]))
       AND ($2::int IS NULL OR m.branch_id = $2)
     GROUP BY m.id, m.name, m.phone, sa.share_capital
     HAVING (COALESCE(sa.share_capital, 0) * 2) - COALESCE(SUM(g.committed_amount), 0) >= $3
     ORDER BY available_capacity DESC
     LIMIT 10`,
    [excludeMemberIds, branchId ?? null, shortfallAmount]
  );
  return rows;
}
