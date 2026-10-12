import { pool } from '../db/pool';
import { notifyMember } from '../channels/notifyMember';

export interface RepayInput {
  loanId: number;
  amount: number;
  method?: string;
  reference?: string;
}

// Records a repayment, bumps paid_total, marks loan paid when cleared, logs ledger + SMS.
export async function repayLoan({ loanId, amount, method = 'M-Pesa', reference }: RepayInput) {
  if (!loanId || !amount || amount <= 0) throw new Error('loanId and positive amount are required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT * FROM loans WHERE id=$1 FOR UPDATE`, [loanId]);
    const loan = rows[0];
    if (!loan) throw new Error(`Loan ${loanId} not found`);
    if (!['active', 'arrears', 'approved', 'disbursed'].includes(loan.status)) {
      throw new Error(`Cannot repay a loan with status '${loan.status}'`);
    }

    const paidTotal = Number(loan.paid_total ?? 0) + Number(amount);
    const balance = Number(loan.amount_due) - paidTotal;
    const newStatus = balance <= 0 ? 'paid' : loan.status === 'approved' ? 'active' : loan.status;

    await client.query(
      `INSERT INTO repayments (loan_id, member_id, amount, method, reference)
       VALUES ($1, $2, $3, $4, $5)`,
      [loanId, loan.member_id, amount, method, reference ?? null]
    );
    await client.query(
      `INSERT INTO transactions (member_id, type, amount, loan_id, reference)
       VALUES ($1, 'repayment', $2, $3, $4)`,
      [loan.member_id, amount, loanId, reference ?? `PAY-${Date.now()}`]
    );
    const { rows: updated } = await client.query(
      `UPDATE loans SET paid_total=$2, status=$3 WHERE id=$1 RETURNING *`,
      [loanId, paidTotal, newStatus]
    );
    await client.query('COMMIT');

    const { rows: mRows } = await pool.query(
      `SELECT id, name, phone, sms_opt_in, whatsapp_opt_in FROM members WHERE id=$1`,
      [loan.member_id]
    );
    if (mRows[0]) {
      const remaining = Math.max(0, balance);
      await notifyMember(
        mRows[0],
        remaining === 0
          ? `Dear ${mRows[0].name}, we received KSh ${amount} for loan #${loanId}. Loan fully cleared. Asante! - Jamii DT Sacco`
          : `Dear ${mRows[0].name}, we received KSh ${amount} for loan #${loanId}. Balance KSh ${remaining}. - Jamii DT Sacco`
      );
    }
    return { loan: updated[0], paidTotal, balance: Math.max(0, balance) };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
