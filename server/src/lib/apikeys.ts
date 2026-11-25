// API keys for the public API: random, shown once, stored only as a hash.
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Db } from '../db.ts';
import { now } from '../db.ts';
import { HttpError } from './core.ts';

export const SCOPES = ['menu:read', 'orders:read', 'orders:write', 'reports:read'] as const;
export type Scope = (typeof SCOPES)[number];

export const SCOPE_LABEL: Record<Scope, string> = {
  'menu:read': 'ອ່ານເມນູ',
  'orders:read': 'ອ່ານອໍເດີ',
  'orders:write': 'ສ້າງ/ຍົກເລີກອໍເດີ (ຈາກລະບົບພາຍນອກ)',
  'reports:read': 'ອ່ານລາຍງານຍອດຂາຍ',
};

export const hashKey = (key: string) => crypto.createHash('sha256').update(key).digest('hex');

export function generateKey(): { key: string; prefix: string; hash: string } {
  const key = 'lz_' + crypto.randomBytes(24).toString('base64url');
  return { key, prefix: key.slice(0, 10), hash: hashKey(key) };
}

export interface ApiKeyCtx {
  id: number;
  bid: number;
  uid: number | null;
  name: string;
  scopes: Scope[];
  autoConfirm: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    apiKey?: ApiKeyCtx;
  }
}

const PER_MINUTE = 120;

/** Authenticates `Authorization: Bearer lz_…`, checks the scope and applies a per-key rate limit. */
export type RateWindows = Map<number, { start: number; n: number }>;
export function apiAuth(db: Db, scope: Scope, opts: { windows?: RateWindows; perMinute?: number | (() => number); nowFn?: () => number } = {}) {
  // One window per key, shared by every endpoint (pass the same Map to each apiAuth of an app).
  const windows = opts.windows ?? new Map();
  const nowFn = opts.nowFn ?? Date.now;
  return (req: Request, res: Response, next: NextFunction) => {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    if (!token.startsWith('lz_')) return next(new HttpError(401, 'ຕ້ອງໃສ່ API key: Authorization: Bearer lz_…'));
    const row = db.get('SELECT * FROM api_keys WHERE key_hash = ? AND active = 1', hashKey(token));
    if (!row) return next(new HttpError(401, 'API key ບໍ່ຖືກຕ້ອງ ຫຼື ຖືກຍົກເລີກແລ້ວ'));
    const scopes = String(row.scopes).split(',').filter(Boolean) as Scope[];
    if (!scopes.includes(scope)) return next(new HttpError(403, `API key ນີ້ບໍ່ມີສິດ "${scope}"`));
    const perMinute = typeof opts.perMinute === 'function' ? opts.perMinute() : (opts.perMinute ?? PER_MINUTE);
    const t = nowFn();
    const w = windows.get(row.id);
    if (!w || t - w.start >= 60_000) windows.set(row.id, { start: t, n: 1 });
    else w.n++;
    const cur = windows.get(row.id)!;
    res.setHeader('X-RateLimit-Limit', String(perMinute));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, perMinute - cur.n)));
    if (cur.n > perMinute) {
      res.setHeader('Retry-After', String(Math.ceil((cur.start + 60_000 - t) / 1000)));
      return next(new HttpError(429, 'ເອີ້ນ API ຖີ່ເກີນໄປ ກະລຸນາລໍຖ້າ'));
    }
    // last_used is only for display: write at most once a minute
    if (!row.last_used_at || t - Date.parse(row.last_used_at) > 60_000) db.run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', now(), row.id);
    req.apiKey = { id: row.id, bid: row.branch_id, uid: row.created_by, name: row.name, scopes, autoConfirm: !!row.auto_confirm };
    next();
  };
}
