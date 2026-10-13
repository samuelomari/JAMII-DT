// App users: staff (admin/teller) or members linked to a member record.
import { pool } from '../db/pool';
import { hashPassword, verifyPassword } from './password';
import { UserRole, isRole, signToken } from './jwt';

export interface AppUser { id: number; name: string; phone: string; role: UserRole; member_id: number | null; }

export async function createUser(input: { name: string; phone: string; password: string; role?: UserRole; memberId?: number | null }) {
  if (!input.name || !input.phone || !input.password) throw new Error('name, phone and password are required');
  if (input.role && !isRole(input.role)) throw new Error('role must be admin | teller | member');
  const passwordHash = await hashPassword(input.password);
  try {
    const { rows } = await pool.query(
      `INSERT INTO app_users (name, phone, password_hash, role, member_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, name, phone, role, member_id`,
      [input.name, input.phone, passwordHash, input.role ?? 'member', input.memberId ?? null]
    );
    return rows[0] as AppUser;
  } catch (e: any) {
    if (String(e.code) === '23505') throw new Error(`Phone ${input.phone} is already registered`);
    throw e;
  }
}

export async function authenticate(phone: string, password: string) {
  const { rows } = await pool.query(`SELECT * FROM app_users WHERE phone=$1`, [phone]);
  const user = rows[0];
  if (!user || !(await verifyPassword(password, user.password_hash))) throw new Error('Invalid phone or password');
  const token = signToken({ id: user.id, role: user.role, memberId: user.member_id });
  const { password_hash: _omit, ...safe } = user;
  return { token, user: safe };
}

export async function listUsers() {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.phone, u.role, u.member_id, m.name AS member_name, u.created_at
     FROM app_users u LEFT JOIN members m ON m.id=u.member_id ORDER BY u.id ASC`
  );
  return rows;
}

export async function setUserRole(id: number, role: UserRole) {
  if (!isRole(role)) throw new Error('role must be admin | teller | member');
  const { rows } = await pool.query(
    `UPDATE app_users SET role=$2 WHERE id=$1 RETURNING id, name, phone, role, member_id`, [id, role]
  );
  if (!rows[0]) throw new Error(`User ${id} not found`);
  return rows[0] as AppUser;
}

export async function countUsers(): Promise<number> {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS total FROM app_users`);
  return Number(rows[0]?.total ?? 0);
}
