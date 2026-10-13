import { Request, Response, NextFunction } from 'express';
import { AuthClaims, UserRole, verifyToken } from './jwt';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { auth?: AuthClaims; } }
}

// When AUTH_DISABLED=true (default until JWT_SECRET is set), all routes stay
// open so existing demos keep working. Set JWT_SECRET + AUTH_DISABLED=false
// to enforce authentication in production.
export const authEnabled = (): boolean =>
  (process.env.AUTH_DISABLED ?? '') !== 'true' && Boolean(process.env.JWT_SECRET);

export const authMode = (): 'enforced' | 'disabled' => (authEnabled() ? 'enforced' : 'disabled');

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!authEnabled()) return next();

  // Bootstrap: with zero users, allow one unauthenticated registration so
  // the very first admin can be created without a chicken-and-egg problem.
  if (req.path === '/auth/register' && req.method === 'POST') return next();

  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.auth = verifyToken(token);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Guards a route to specific roles. Members may additionally only touch
// their own member record (checked via :id param or memberId body field).
export function requireRole(...roles: UserRole[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!authEnabled()) return next();
    if (!req.auth) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.auth.role)) return res.status(403).json({ error: 'Forbidden for this role' });
    if (req.auth.role === 'member' && req.auth.memberId != null) {
      const own = req.params.id ?? (req.body as any)?.memberId;
      if (own !== undefined && Number(own) !== Number(req.auth.memberId)) {
        return res.status(403).json({ error: 'Members may only access their own records' });
      }
    }
    return next();
  };
}
