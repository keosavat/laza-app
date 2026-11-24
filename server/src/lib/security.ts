// Protections needed once the server is reachable from the internet (e.g. through a tunnel).
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import type { Db } from '../db.ts';
import { checkPassword } from '../auth.ts';
import { HttpError } from './core.ts';

const WINDOW_MS = 10 * 60_000;
const MAX_PER_USER = 8; // wrong passwords for one username from one address
const MAX_PER_IP = 40; // wrong passwords from one address, any username

/** Slows down password guessing: too many failures from one address and the login answers 429 for a while. */
export function createLoginGuard(now: () => number = Date.now) {
  const fails = new Map<string, { n: number; since: number }>();
  const bump = (key: string) => {
    const t = now();
    const f = fails.get(key);
    if (!f || t - f.since > WINDOW_MS) fails.set(key, { n: 1, since: t });
    else f.n++;
  };
  const count = (key: string) => {
    const f = fails.get(key);
    if (!f) return 0;
    if (now() - f.since > WINDOW_MS) {
      fails.delete(key);
      return 0;
    }
    return f.n;
  };
  return {
    /** Throws 429 when this address is locked out. Call before checking the password. */
    check(ip: string, username: string) {
      if (count(`u:${ip}:${username}`) >= MAX_PER_USER || count(`i:${ip}`) >= MAX_PER_IP) {
        throw new HttpError(429, 'ໃສ່ລະຫັດຜິດຫຼາຍເກີນໄປ ກະລຸນາລໍຖ້າ 10 ນາທີ ແລ້ວລອງໃໝ່');
      }
    },
    fail(ip: string, username: string) {
      bump(`u:${ip}:${username}`);
      bump(`i:${ip}`);
      // keep the map small
      if (fails.size > 5000) for (const [k, v] of fails) if (now() - v.since > WINDOW_MS) fails.delete(k);
    },
    ok(ip: string, username: string) {
      fails.delete(`u:${ip}:${username}`);
    },
  };
}

/** Basic hardening headers (no extra dependency). HSTS only when the request came in over HTTPS. */
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), payment=()');
  if (req.secure || req.get('x-forwarded-proto') === 'https') res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
}

const DEFAULT_PASSWORDS = ['laza1234'];
const weakCache = new Map<string, boolean>();

/** Active staff still using a published demo password. bcrypt is slow, so each distinct hash is checked once. */
export function usersWithDefaultPassword(db: Db, restaurantId?: number): { id: number; username: string; name: string }[] {
  const rows = db.all(`SELECT id, username, name, password_hash FROM users WHERE active = 1 ${restaurantId ? 'AND restaurant_id = ?' : ''}`, ...(restaurantId ? [restaurantId] : []));
  return rows
    .filter((u) => {
      let weak = weakCache.get(u.password_hash);
      if (weak === undefined) {
        weak = DEFAULT_PASSWORDS.some((p) => checkPassword(p, u.password_hash));
        weakCache.set(u.password_hash, weak);
      }
      return weak;
    })
    .map((u) => ({ id: u.id, username: u.username, name: u.name }));
}

/** Copy the database into `dir` as laza-YYYYMMDD.db (one per day) and delete copies older than `keep` days. Returns the new file, or null if today's copy exists. */
export function backupDb(db: Db, dir: string, keep = 14, date = new Date()): string | null {
  fs.mkdirSync(dir, { recursive: true });
  const name = `laza-${date.toISOString().slice(0, 10).replace(/-/g, '')}.db`;
  const file = path.join(dir, name);
  if (fs.existsSync(file)) return null;
  const tmp = `${file}.tmp`;
  if (fs.existsSync(tmp)) fs.rmSync(tmp);
  db.run('VACUUM INTO ?', tmp); // a consistent snapshot, safe while the app is running
  fs.renameSync(tmp, file);
  const old = fs
    .readdirSync(dir)
    .filter((f) => /^laza-\d{8}\.db$/.test(f))
    .sort()
    .slice(0, -keep);
  for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
  return file;
}
