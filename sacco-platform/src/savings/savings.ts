import { pool } from '../db/pool';

// Deposit / withdraw against savings_accounts + append to transactions ledger.
export async function savingsTransaction(
  memberId: number,
  type: 'deposit' | 'withdrawal' | 'share_purchase',
  amount: number,
  reference?: string
) {
  if (amount <= 0) throw new Error('Amount must be positive');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT * FROM savings_accounts WHERE member_id=$1 FOR UPDATE`, [memberId]);
    if (!rows[0]) throw new Error(`Savings account for member ${memberId} not found`);
    const acc = rows[0];

    let balance = Number(acc.balance);
    let shareCapital = Number(acc.share_capital);
    if (type === 'deposit') balance += amount;
    else if (type === 'share_purchase') { balance += amount; shareCapital += amount; }
    else {
      if (amount > balance) throw new Error('Insufficient savings balance');
      balance -= amount;
    }

    await client.query(
      `UPDATE savings_accounts SET balance=$2, share_capital=$3, updated_at=NOW() WHERE member_id=$1`,
      [memberId, balance, shareCapital]
    );
    await client.query(
      `INSERT INTO transactions (member_id, type, amount, reference) VALUES ($1,$2,$3,$4)`,
      [memberId, type, type === 'withdrawal' ? -amount : amount, reference ?? `${type}-${Date.now()}`]
    );
    await client.query('COMMIT');
    return { memberId, balance, shareCapital };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function memberLedger(memberId: number, limit = 50) {
  const { rows } = await pool.query(
    `SELECT * FROM transactions WHERE member_id=$1 ORDER BY created_at DESC LIMIT $2`,
    [memberId, limit]
  );
  return rows;
}
