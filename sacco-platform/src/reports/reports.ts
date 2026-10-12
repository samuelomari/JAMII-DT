import { pool } from '../db/pool';

export async function portfolioSummary() {
  const loans = await pool.query(
    `SELECT status, COUNT(*)::int AS count, COALESCE(SUM(amount_due),0)::float AS total_due,
            COALESCE(SUM(paid_total),0)::float AS total_paid
     FROM loans GROUP BY status`
  );
  const savings = await pool.query(
    `SELECT COUNT(*)::int AS accounts, COALESCE(SUM(balance),0)::float AS total_savings,
            COALESCE(SUM(share_capital),0)::float AS total_share_capital FROM savings_accounts`
  );
  const members = await pool.query(`SELECT COUNT(*)::int AS total FROM members`);
  const arrears = await pool.query(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(amount_due - COALESCE(paid_total,0)),0)::float AS arrears_balance
     FROM loans WHERE status='arrears'`
  );
  const notifications = await pool.query(
    `SELECT channel, COUNT(*)::int AS count, SUM(CASE WHEN success THEN 1 ELSE 0 END)::int AS delivered
     FROM notification_log GROUP BY channel`
  );
  return {
    members: members.rows[0],
    savings: savings.rows[0],
    arrears: arrears.rows[0],
    byStatus: loans.rows,
    notifications: notifications.rows,
  };
}

export async function arrearsReport() {
  const { rows } = await pool.query(
    `SELECT l.id AS loan_id, m.id AS member_id, m.name, m.phone,
            l.amount_due, COALESCE(l.paid_total,0) AS paid_total,
            (l.amount_due - COALESCE(l.paid_total,0)) AS balance,
            l.due_date, CURRENT_DATE - l.due_date AS days_overdue
     FROM loans l JOIN members m ON m.id=l.member_id
     WHERE l.status='arrears' ORDER BY l.due_date ASC`
  );
  return rows;
}

export async function upcomingDues(days = 7) {
  const { rows } = await pool.query(
    `SELECT l.id AS loan_id, m.name, m.phone, l.amount_due,
            COALESCE(l.paid_total,0) AS paid_total, l.due_date, l.status
     FROM loans l JOIN members m ON m.id=l.member_id
     WHERE l.status IN ('active','arrears')
       AND l.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + ($1 || ' days')::interval
     ORDER BY l.due_date ASC`,
    [days]
  );
  return rows;
}
