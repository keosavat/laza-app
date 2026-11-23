import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { seedIfEmpty, DEMO_USERS } from '../src/seed.ts';

const PW = DEMO_USERS[0].password;
let base = '';
let close: () => void;

async function call(method: string, url: string, body?: unknown, token?: string) {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const login = async (u: string) => (await call('POST', '/api/auth/login', { username: u, password: PW })).body.token as string;

before(async () => {
  const app = createApp({ dbFile: ':memory:', jwtSecret: 'test-secret' });
  seedIfEmpty(app.db);
  await new Promise<void>((ok) => app.server.listen(0, ok));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  close = () => app.server.close();
});
after(() => close());

describe('ingredient packs, lots and refill levels', () => {
  test('pack validation, stock-in by pack, expiry and suggested purchase', async () => {
    const admin = await login('admin');
    const bad1 = await call('POST', '/api/ingredients', { name: 'x', unit: 'g', packName: 'kg' }, admin);
    assert.equal(bad1.status, 400);
    const bad2 = await call('POST', '/api/ingredients', { name: 'x', unit: 'g', lowAt: 500, refillTo: 100 }, admin);
    assert.equal(bad2.status, 400);

    const ing = (await call('POST', '/api/ingredients', { name: 'ຜັກ', unit: 'g', category: 'ຜັກ', packName: 'kg', packSize: 1000, lowAt: 500, refillTo: 3000 }, admin)).body;
    assert.equal(ing.category, 'ຜັກ');
    assert.equal(ing.suggest, 3000);

    // 2 kg packs at 3,000 per pack → 2000 g, 3 per g
    const r = await call('POST', `/api/ingredients/${ing.id}/stock`, { type: 'in', qty: 2, byPack: true, unitCost: 3000, lot: 'L1', expiresAt: '2030-01-01' }, admin);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.ingredient.stock, 2000);
    assert.equal(r.body.ingredient.cost, 3);
    assert.equal(r.body.ingredient.next_expiry, undefined);
    const list = (await call('GET', '/api/ingredients', undefined, admin)).body.find((i: any) => i.id === ing.id);
    assert.equal(list.next_expiry, '2030-01-01');
    assert.equal(list.suggest, 0);

    assert.equal((await call('POST', `/api/ingredients/${ing.id}/stock`, { type: 'in', qty: 1, expiresAt: 'bad' }, admin)).status, 400);
    const plain = (await call('POST', '/api/ingredients', { name: 'ເກືອ', unit: 'g' }, admin)).body;
    assert.equal((await call('POST', `/api/ingredients/${plain.id}/stock`, { type: 'in', qty: 1, byPack: true }, admin)).status, 400);

    const sum = (await call('GET', '/api/inventory/summary', undefined, admin)).body;
    assert.ok(sum.menuTotal > 0 && sum.missingRecipe.length > 0);
  });
});

describe('audit log', () => {
  test('admin only; filters by user, action and date; paginates', async () => {
    const admin = await login('admin');
    const cashier = await login('cashier');
    await login('waiter');
    assert.equal((await call('GET', '/api/audit', undefined, cashier)).status, 403);

    const all = await call('GET', '/api/audit', undefined, admin);
    assert.equal(all.status, 200);
    assert.ok(all.body.rows.length >= 3);
    assert.ok(all.body.actions.includes('login'));

    const users = (await call('GET', '/api/users', undefined, admin)).body;
    const waiterId = users.find((u: any) => u.username === 'waiter').id;
    const mine = await call('GET', `/api/audit?user=${waiterId}&action=login`, undefined, admin);
    assert.equal(mine.body.rows.length, 1);
    assert.equal(mine.body.rows[0].user_name, users.find((u: any) => u.id === waiterId).name);

    assert.equal((await call('GET', '/api/audit?action=nope', undefined, admin)).body.rows.length, 0);
    assert.equal((await call('GET', '/api/audit?from=2000-01-01&to=2000-01-02', undefined, admin)).body.rows.length, 0);
    assert.ok((await call('GET', '/api/audit?from=2000-01-01', undefined, admin)).body.rows.length > 0);
    assert.equal((await call('GET', '/api/audit?from=bad', undefined, admin)).status, 400);

    const page = await call('GET', '/api/audit?limit=2', undefined, admin);
    assert.equal(page.body.rows.length, 2);
    assert.equal(page.body.hasMore, true);
  });
});
