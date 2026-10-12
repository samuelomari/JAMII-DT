import { pool } from '../db/pool';
import { notifyMember } from '../channels/notifyMember';

// Approves a loan and fires a confirmation through the shared notifier.
export async function approveLoan(loanId: number) {
  const { rows } = await pool.query(
    `UPDATE loans SET status = 'approved' WHERE id = $1
     RETURNING member_id, amount_due`,
    [loanId]
  );
  const loan = rows[0];
  if (!loan) throw new Error(`Loan ${loanId} not found`);

  const { rows: memberRows } = await pool.query(
    `SELECT id, name, phone, sms_opt_in, whatsapp_opt_in FROM members WHERE id = $1`,
    [loan.member_id]
  );
  const member = memberRows[0];

  const body = `Dear ${member.name}, your loan of KSh ${loan.amount_due} has been approved. Funds will be disbursed shortly. - Jamii DT Sacco`;
  await notifyMember(member, body);
  return { loanId, status: 'approved' };
}
