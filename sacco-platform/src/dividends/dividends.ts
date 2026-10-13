// Dividends & interest-on-savings: declare an annual cycle from Sacco
// surplus, compute each member's payout pro-rata, then post to savings.

import { pool } from '../db/pool';
import { roundMoney } from '../loans/interest';
import { notifyMember } from '../channels/notifyMember';

export async function declareDividendCycle(input: {
  label: string; fiscalYear: number; shareRate: number; savingsRate: number;
}) {
  const { label, fiscalYear, shareRate, savingsRate } = input;
  if (!label || !fiscalYear) throw new Error('label and fiscalYear are required');
  if (shareRate < 0 || savingsRate < 0) throw new Error('Rates cannot be negative');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: cycle } = await client.query(
      `INSERT INTO dividend_cycles (label, fiscal_year, share_rate, savings_rate)
       VALUES ($1,$2,$3,$4) RETURNING *`, [label, fiscalYear, shareRate, savingsRate]
    );
    const cycleId = cycle[0].id;
    const { rows: members } = await client.query(
      `SELECT m.id AS member_id, COALESCE(sa.share_capital,0) AS share_capital,
              COALESCE(sa.balance,0) AS savings_balance
       FROM members m LEFT JOIN savings_accounts sa ON sa.member_id=m.id`
    );
    let totalShare = 0; let totalSavings = 0;
    for (const m of members) {
      const shareDiv = roundMoney(Number(m.share_capital) * (shareRate / 100));
      const savInt = roundMoney(Number(m.savings_balance) * (savingsRate / 100));
      const total = roundMoney(shareDiv + savInt);
      await client.query(
        `INSERT INTO dividend_payouts (cycle_id, member_id, share_capital, savings_balance,
          share_dividend, savings_interest, total)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [cycleId, m.member_id, m.share_capital, m.savings_balance, shareDiv, savInt, total]
      );
      totalShare = roundMoney(totalShare + shareDiv);
      totalSavings = roundMoney(totalSavings + savInt);
    }
    const { rows: updated } = await client.query(
      `UPDATE dividend_cycles SET total_share_dividend=$2, total_savings_interest=$3,
        total_payout=$4, member_count=$5 WHERE id=$1 RETURNING *`,
      [cycleId, totalShare, totalSavings, roundMoney(totalShare + totalSavings), members.length]
    );
    await client.query('COMMIT');
    return updated[0];
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

export async function listDividendCycles() {
  const { rows } = await pool.query(`SELECT * FROM dividend_cycles ORDER BY id DESC`);
  return rows;
}

export async function getDividendCycle(id: number, limit = 200) {
  const { rows } = await pool.query(`SELECT * FROM dividend_cycles WHERE id=$1`, [id]);
  if (!rows[0]) throw new Error(`Dividend cycle ${id} not found`);
  const { rows: payouts } = await pool.query(
    `SELECT p.*, m.name AS member_name, m.phone AS member_phone FROM dividend_payouts p
     JOIN members m ON m.id=p.member_id WHERE p.cycle_id=$1 ORDER BY p.total DESC LIMIT $2`, [id, limit]
  );
  return { cycle: rows[0], payouts };
}

// Pay a declared cycle: credit each member's savings, log ledger entries,
// flip payouts + cycle to paid, and notify members.
export async function payDividendCycle(id: number) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT * FROM dividend_cycles WHERE id=$1 FOR UPDATE`, [id]);
    const cycle = rows[0];
    if (!cycle) throw new Error(`Dividend cycle ${id} not found`);
    if (cycle.status === 'paid') throw new Error(`Cycle ${id} already paid`);
    const { rows: payouts } = await client.query(
      `SELECT * FROM dividend_payouts WHERE cycle_id=$1 AND status='pending' ORDER BY id ASC`, [id]
    );
    for (const p of payouts) {
      const total = Number(p.total);
      if (total > 0) {
        await client.query(
          `UPDATE savings_accounts SET balance=balance+$2, updated_at=NOW() WHERE member_id=$1`, [p.member_id, total]
        );
        await client.query(
          `INSERT INTO transactions (member_id, type, amount, reference) VALUES ($1,'dividend',$2,$3)`,
          [p.member_id, total, `DIV-${id}-${p.member_id}`]
        );
      }
      await client.query(`UPDATE dividend_payouts SET status='paid', paid_at=NOW() WHERE id=$1`, [p.id]);
    }
    const { rows: updated } = await client.query(
      `UPDATE dividend_cycles SET status='paid', paid_at=NOW() WHERE id=$1 RETURNING *`, [id]
    );
    await client.query('COMMIT');
    const { rows: notify } = await pool.query(
      `SELECT p.member_id, p.total, m.name, m.phone, m.sms_opt_in, m.whatsapp_opt_in,
              m.id FROM dividend_payouts p JOIN members m ON m.id=p.member_id WHERE p.cycle_id=$1`, [id]
    );
    for (const n of notify) {
      await notifyMember(n as any,
        `Dear ${n.name}, your ${cycle.label} payout of KSh ${n.total} has been credited to savings. - Jamii DT Sacco`
      ).catch(() => {});
    }
    return updated[0];
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

export async function memberDividends(memberId: number) {
  const { rows } = await pool.query(
    `SELECT p.*, c.label, c.fiscal_year, c.status AS cycle_status FROM dividend_payouts p
     JOIN dividend_cycles c ON c.id=p.cycle_id WHERE p.member_id=$1 ORDER BY c.id DESC`, [memberId]
  );
  return rows;
}
