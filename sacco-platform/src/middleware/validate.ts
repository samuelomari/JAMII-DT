import { Request, Response, NextFunction } from 'express';

// Minimal body validator: schema = { field: 'number' | 'string' | 'array' | 'boolean' }
export function validateBody(schema: Record<string, string>, opts: { allowExtra?: boolean } = {}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors: string[] = [];
    for (const [field, type] of Object.entries(schema)) {
      const v = (req.body ?? {})[field];
      if (v === undefined || v === null) {
        errors.push(`${field} is required`);
        continue;
      }
      if (type === 'number' && typeof v !== 'number') errors.push(`${field} must be a number`);
      if (type === 'string' && typeof v !== 'string') errors.push(`${field} must be a string`);
      if (type === 'boolean' && typeof v !== 'boolean') errors.push(`${field} must be a boolean`);
      if (type === 'array' && !Array.isArray(v)) errors.push(`${field} must be an array`);
    }
    if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });
    if (!opts.allowExtra) { /* keep extra fields (e.g. optional termMonths) — no stripping */ }
    next();
  };
}

export function validateIdParam(req: Request, res: Response, next: NextFunction) {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'id must be a number' });
  next();
}
