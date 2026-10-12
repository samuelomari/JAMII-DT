import { pool } from '../db/pool';
import { notifyMember } from '../channels/notifyMember';

// pending -> rejected | approved -> disbursed(active) with ledger entries + notifications.
export async function rejectLoan(loanId: number, reason = 'Did not meet policy') {
  const { rows } = await pool.query(
    `UPDATE loans SET status='rejected', rejected_reason=$2 WHERE id=$1 AND status='pending' RETURNING *`,
    [loanId, reason]
  );
  if (!rows[0]) throw new Error(`Pending loan ${loanId} not found`);
  return rows[0];
}

export async function disburseLoan(loanId: number) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT * FROM loans WHERE id=$1 FOR UPDATE`, [loanId]);
    const loan = rows[0];
    if (!loan) throw new Error(`Loan ${loanId} not found`);
    if (loan.status !== 'approved') throw new Error(`Only approved loans can be disbursed (current: ${loan.status})`);

    const { rows: updated } = await client.query(
      `UPDATE loans SET status='active', disbursed_at=NOW() WHERE id=$1 RETURNING *`,
      [loanId]
    );
    await client.query(
      `INSERT INTO transactions (member_id, type, amount, loan_id, reference)
       VALUES ($1, 'disbursement', $2, $3, $4)`,
      [loan.member_id, loan.amount_due, loanId, `DISB-${loanId}`]
    );
    await client.query('COMMIT');

    const { rows: mRows } = await pool.query(
      `SELECT id, name, phone, sms_opt_in, whatsapp_opt_in FROM members WHERE id=$1`,
      [loan.member_id]
    );
    if (mRows[0]) {
      await notifyMember(
        mRows[0],
        `Dear ${mRows[0].name}, KSh ${loan.amount_due} for loan #${loanId} has been disbursed to your account. - Jamii DT Sacco`
      );
    }
    return updated[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function getLoanStatement(loanId: number) {
  const { rows: loans } = await pool.query(`SELECT * FROM loans WHERE id=$1`, [loanId]);
  if (!loans[0]) throw new Error(`Loan ${loanId} not found`);
  const { rows: repayments } = await pool.query(
    `SELECT * FROM repayments WHERE loan_id=$1 ORDER BY paid_at ASC`, [loanId]
  );
  const { rows: guarantors } = await pool.query(
    `SELECT g.*, m.name AS guarantor_name FROM guarantors g
     JOIN members m ON m.id = g.guarantor_member_id WHERE g.loan_id=$1`, [loanId]
  );
  const loan = loans[0];
  const paidTotal = Number(loan.paid_total ?? repayments.reduce((s: number, r: any) => s + Number(r.amount), 0));
  return {
    loan,
    repayments,
    guarantors,
    balance: Number(loan.amount_due) - paidTotal,
    paidTotal,
  };
}
