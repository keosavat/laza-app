import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import type { Request, Response, NextFunction } from 'express';
import { HttpError, forbidden } from './lib/core.ts';

export type Role = 'owner' | 'manager' | 'cashier' | 'waiter' | 'kitchen';
export const ROLES: readonly Role[] = ['owner', 'manager', 'cashier', 'waiter', 'kitchen'];

export interface AuthUser {
  uid: number;
  rid: number;
  bid: number;
  role: Role;
  name: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user: AuthUser;
  }
}

/** What each role may do. Owner and manager can do everything. */
export const PERMS = {
  pos: ['owner', 'manager', 'cashier', 'waiter'],
  pay: ['owner', 'manager', 'cashier'],
  discount: ['owner', 'manager', 'cashier'],
  voidItem: ['owner', 'manager'],
  kitchen: ['owner', 'manager', 'cashier', 'kitchen', 'waiter'],
  shift: ['owner', 'manager', 'cashier'],
  reports: ['owner', 'manager', 'cashier'],
  admin: ['owner', 'manager'],
  owner: ['owner'],
} as const satisfies Record<string, readonly Role[]>;
export type Perm = keyof typeof PERMS;

export function can(role: Role, perm: Perm): boolean {
  return (PERMS[perm] as readonly Role[]).includes(role);
}

export type Auth = ReturnType<typeof makeAuth>;

export function makeAuth(secret: string) {
  const sign = (u: AuthUser): string =>
    jwt.sign({ uid: u.uid, rid: u.rid, bid: u.bid, role: u.role, name: u.name }, secret, { expiresIn: '12h' });
  const verify = (token: string): AuthUser => {
    const p = jwt.verify(token, secret) as AuthUser;
    return { uid: p.uid, rid: p.rid, bid: p.bid, role: p.role, name: p.name };
  };
  const middleware = (req: Request, _res: Response, next: NextFunction) => {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!token) return next(new HttpError(401, 'ກະລຸນາເຂົ້າສູ່ລະບົບ'));
    try {
      req.user = verify(token);
      next();
    } catch {
      next(new HttpError(401, 'ໝົດເວລາເຂົ້າລະບົບ ກະລຸນາເຂົ້າໃໝ່'));
    }
  };
  return { sign, verify, middleware };
}

export function requirePerm(perm: Perm) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !can(req.user.role, perm)) return next(forbidden());
    next();
  };
}

export const hashPassword = (pw: string) => bcrypt.hashSync(pw, 10);
export const checkPassword = (pw: string, hash: string) => bcrypt.compareSync(pw, hash);
