import { pool } from '../db/pool';

export async function listMembers(limit = 50, offset = 0, search?: string) {
  const params: any[] = [];
  let where = '';
  if (search) {
    params.push(`%${search}%`);
    where = `WHERE m.name ILIKE $1 OR m.phone ILIKE $1`;
  }
  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT m.*, COALESCE(sa.balance,0) AS savings_balance, COALESCE(sa.share_capital,0) AS share_capital,
            (SELECT COUNT(*) FROM loans l WHERE l.member_id=m.id AND l.status IN ('active','arrears')) AS active_loans
     FROM members m LEFT JOIN savings_accounts sa ON sa.member_id=m.id
     ${where} ORDER BY m.id ASC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

export async function getMember(id: number) {
  const { rows } = await pool.query(
    `SELECT m.*, COALESCE(sa.balance,0) AS savings_balance, COALESCE(sa.share_capital,0) AS share_capital
     FROM members m LEFT JOIN savings_accounts sa ON sa.member_id=m.id WHERE m.id=$1`,
    [id]
  );
  if (!rows[0]) throw new Error(`Member ${id} not found`);
  const { rows: loans } = await pool.query(`SELECT * FROM loans WHERE member_id=$1 ORDER BY id DESC`, [id]);
  const { rows: transactions } = await pool.query(
    `SELECT * FROM transactions WHERE member_id=$1 ORDER BY created_at DESC LIMIT 50`, [id]
  );
  return { ...rows[0], loans, transactions };
}

export async function createMember(input: {
  name: string; phone: string; branch_id?: number; membership_months?: number;
  sms_opt_in?: boolean; whatsapp_opt_in?: boolean; initialSavings?: number; shareCapital?: number;
}) {
  if (!input.name || !input.phone) throw new Error('name and phone are required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO members (name, phone, branch_id, membership_months, sms_opt_in, whatsapp_opt_in)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [input.name, input.phone, input.branch_id ?? null, input.membership_months ?? 0,
       input.sms_opt_in ?? true, input.whatsapp_opt_in ?? false]
    );
    const member = rows[0];
    await client.query(
      `INSERT INTO savings_accounts (member_id, balance, share_capital) VALUES ($1,$2,$3)`,
      [member.id, input.initialSavings ?? 0, input.shareCapital ?? 0]
    );
    await client.query('COMMIT');
    return member;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function updateMember(id: number, patch: Record<string, any>) {
  const allowed = ['name', 'phone', 'branch_id', 'membership_months', 'sms_opt_in', 'whatsapp_opt_in'];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (!keys.length) throw new Error('No valid fields to update');
  const sets = keys.map((k, i) => `${k}=$${i + 2}`).join(', ');
  const { rows } = await pool.query(`UPDATE members SET ${sets} WHERE id=$1 RETURNING *`, [id, ...keys.map((k) => patch[k])]);
  if (!rows[0]) throw new Error(`Member ${id} not found`);
  return rows[0];
}
