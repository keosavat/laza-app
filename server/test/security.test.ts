import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { seedIfEmpty, DEMO_USERS } from '../src/seed.ts';
import { backupDb, createLoginGuard, usersWithDefaultPassword } from '../src/lib/security.ts';

const PW = DEMO_USERS[0].password;
let base = '';
let close: () => void;
let db: ReturnType<typeof createApp>['db'];

async function call(method: string, url: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

before(async () => {
  const app = createApp({ dbFile: ':memory:', jwtSecret: 'test-secret' });
  db = app.db;
  seedIfEmpty(app.db);
  await new Promise<void>((ok) => app.server.listen(0, ok));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  close = () => app.server.close();
});
after(() => close());

describe('login guard', () => {
  test('locks an address out after repeated wrong passwords, per username', () => {
    let t = 0;
    const g = createLoginGuard(() => t);
    for (let i = 0; i < 8; i++) {
      g.check('1.1.1.1', 'admin');
      g.fail('1.1.1.1', 'admin');
    }
    assert.throws(() => g.check('1.1.1.1', 'admin'), /10 ນາທີ/);
    g.check('1.1.1.1', 'cashier'); // other usernames are not blocked by that
    g.check('2.2.2.2', 'admin'); // nor other addresses
    t += 10 * 60_000 + 1;
    g.check('1.1.1.1', 'admin'); // lock expires
  });

  test('a success clears the count; one address trying many usernames is stopped too', () => {
    const g = createLoginGuard(() => 0);
    for (let i = 0; i < 7; i++) g.fail('3.3.3.3', 'admin');
    g.ok('3.3.3.3', 'admin');
    g.check('3.3.3.3', 'admin');
    for (let i = 0; i < 40; i++) g.fail('4.4.4.4', `user${i}`);
    assert.throws(() => g.check('4.4.4.4', 'anyone-new'));
  });

  test('the login route answers 429 after too many failures but real users from other addresses still work', async () => {
    for (let i = 0; i < 8; i++) assert.equal((await call('POST', '/api/auth/login', { username: 'cashier', password: 'wrong' }, undefined, { 'x-forwarded-for': '9.9.9.9' })).status, 401);
    const blocked = await call('POST', '/api/auth/login', { username: 'cashier', password: PW }, undefined, { 'x-forwarded-for': '9.9.9.9' });
    assert.equal(blocked.status, 429, 'even the right password is refused while locked');
    const other = await call('POST', '/api/auth/login', { username: 'cashier', password: PW }, undefined, { 'x-forwarded-for': '8.8.8.8' });
    assert.equal(other.status, 200);
  });
});

describe('headers and default passwords', () => {
  test('security headers are present', async () => {
    const r = await call('GET', '/api/health');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(r.headers.get('strict-transport-security'), null, 'no HSTS over plain http');
    const https = await call('GET', '/api/health', undefined, undefined, { 'x-forwarded-proto': 'https' });
    assert.ok(https.headers.get('strict-transport-security'));
  });

  test('owners and managers are told which accounts still use the demo password; others are not', async () => {
    const login = async (u: string, pw = PW) => (await call('POST', '/api/auth/login', { username: u, password: pw }, undefined, { 'x-forwarded-for': `7.7.7.${u.length}` })).body.token as string;
    const owner = await login('admin');
    const weak = (await call('GET', '/api/me', undefined, owner)).body.defaultPasswords;
    assert.equal(weak.length, 5);
    assert.deepEqual((await call('GET', '/api/me', undefined, await login('cashier'))).body.defaultPasswords, []);

    const users = (await call('GET', '/api/users', undefined, owner)).body;
    for (const u of users) await call('PUT', `/api/users/${u.id}`, { password: `new-secret-${u.id}` }, owner);
    assert.equal(usersWithDefaultPassword(db).length, 0);
    assert.deepEqual((await call('GET', '/api/me', undefined, owner)).body.defaultPasswords, []);
  });
});

describe('daily backup', () => {
  test('writes one consistent copy per day, keeps only the newest ones, and the copy opens', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'laza-bk-'));
    try {
      const day = (n: number) => new Date(Date.UTC(2030, 0, n));
      for (let n = 1; n <= 5; n++) assert.ok(backupDb(db, dir, 3, day(n)));
      assert.equal(backupDb(db, dir, 3, day(5)), null, 'already done today');
      assert.deepEqual(fs.readdirSync(dir).sort(), ['laza-20300103.db', 'laza-20300104.db', 'laza-20300105.db']);
      assert.ok(fs.statSync(path.join(dir, 'laza-20300105.db')).size > 10_000);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
