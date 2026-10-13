// Minimal HS256 JWT (built-in crypto only). Payload: { sub, role, memberId?, iat, exp }.
import { createHmac, timingSafeEqual } from 'node:crypto';

export type UserRole = 'admin' | 'teller' | 'member';

export interface AuthClaims { sub: number; role: UserRole; memberId: number | null; iat: number; exp: number; }

const b64url = (buf: Buffer | string): string =>
  Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

const unb64url = (s: string): Buffer => {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded + '='.repeat((4 - (padded.length % 4)) % 4), 'base64');
};

function secret(): string {
  const s = process.env.JWT_SECRET ?? '';
  if (!s) throw new Error('JWT_SECRET is not configured');
  return s;
}

export const isRole = (v: unknown): v is UserRole => v === 'admin' || v === 'teller' || v === 'member';

export function signToken(user: { id: number; role: UserRole; memberId: number | null }, ttlSeconds = 12 * 3600): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ sub: user.id, role: user.role, memberId: user.memberId, iat: now, exp: now + ttlSeconds }));
  const sig = b64url(createHmac('sha256', secret()).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

export function verifyToken(token: string): AuthClaims {
  const [header, payload, sig] = token.split('.');
  if (!header || !payload || !sig) throw new Error('Malformed token');
  const expected = createHmac('sha256', secret()).update(`${header}.${payload}`).digest();
  const actual = unb64url(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('Invalid signature');
  const claims = JSON.parse(unb64url(payload).toString('utf8'));
  if (typeof claims.sub !== 'number' || !isRole(claims.role)) throw new Error('Invalid claims');
  if (claims.exp * 1000 < Date.now()) throw new Error('Token expired');
  return claims as AuthClaims;
}
