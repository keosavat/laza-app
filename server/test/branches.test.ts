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
  // a second, unrelated restaurant: its branch must stay out of reach
  const t = new Date().toISOString();
  const rid = app.db.run('INSERT INTO restaurants (name, created_at) VALUES (?,?)', 'ຮ້ານອື່ນ', t).id;
  app.db.run('INSERT INTO branches (restaurant_id, name, created_at) VALUES (?,?,?)', rid, 'ສາຂາຂອງຮ້ານອື່ນ', t);
  await new Promise<void>((ok) => app.server.listen(0, ok));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  close = () => app.server.close();
});
after(() => close());

describe('multiple branches', () => {
  let owner = '';
  let manager = '';
  let main = 0;
  let second = 0;
  let foreign = 0;

  const sell = async (token: string, qty: number) => {
    await call('POST', '/api/shifts/open', { openingCash: 0 }, token);
    const tables = (await call('GET', '/api/tables', undefined, token)).body;
    const dish = (await call('GET', '/api/menu-items', undefined, token)).body.find((i: any) => i.price >= 20000 && !(i.options ?? []).some((g: any) => g.required));
    const id = (await call('POST', '/api/orders', { type: 'dine_in', tableId: tables[0].id }, token)).body.id;
    await call('POST', `/api/orders/${id}/items`, { items: [{ menuItemId: dish.id, qty }], print: false }, token);
    const total = (await call('GET', `/api/orders/${id}`, undefined, token)).body.total;
    const pay = await call('POST', `/api/orders/${id}/pay`, { payments: [{ method: 'cash', currency: 'LAK', amount: total }] }, token);
    assert.equal(pay.status, 200, JSON.stringify(pay.body));
    return total as number;
  };

  test('only the owner manages branches and sees the comparison', async () => {
    owner = await login('admin');
    manager = await login('manager');
    assert.equal((await call('GET', '/api/branches', undefined, manager)).status, 403);
    assert.equal((await call('POST', '/api/branches', { name: 'x' }, manager)).status, 403);
    assert.equal((await call('GET', '/api/reports/branches', undefined, manager)).status, 403);
    const list = (await call('GET', '/api/branches', undefined, owner)).body;
    assert.equal(list.length, 1, 'only this restaurant');
    main = list[0].id;
    assert.equal(list[0].current, true);
    foreign = (await call('GET', '/api/me', undefined, owner)).body.restaurant.id + 1;
  });

  test('a new branch can copy settings, floor and menu from an existing one', async () => {
    assert.equal((await call('POST', '/api/branches', { name: '' }, owner)).status, 400);
    assert.equal((await call('POST', '/api/branches', { name: 'x', copyFrom: 99999 }, owner)).status, 404);
    await call('PUT', '/api/settings', { vat_rate: 10, service_rate: 5 }, owner);
    const b = await call('POST', '/api/branches', { name: 'ສາຂາ 2', address: 'ວຽງຈັນ', copyFrom: main }, owner);
    assert.equal(b.status, 201, JSON.stringify(b.body));
    second = b.body.id;
    assert.equal(b.body.vat_rate, 10);
    assert.equal(b.body.service_rate, 5);
    assert.equal((await call('POST', '/api/branches', { name: 'ສາຂາ 2' }, owner)).status, 400, 'duplicate name');

    const sw = await call('POST', `/api/branches/${second}/switch`, {}, owner);
    assert.equal(sw.status, 200);
    assert.equal(sw.body.user.bid, second);
    const tok2 = sw.body.token;
    assert.equal((await call('GET', '/api/me', undefined, tok2)).body.branch.name, 'ສາຂາ 2');
    const [t1, t2] = [(await call('GET', '/api/tables', undefined, owner)).body, (await call('GET', '/api/tables', undefined, tok2)).body];
    assert.equal(t2.length, t1.length, 'tables copied');
    assert.ok(t2.every((t: any) => !t1.some((x: any) => x.id === t.id)), 'with new ids');
    const [m1, m2] = [(await call('GET', '/api/menu-items', undefined, owner)).body, (await call('GET', '/api/menu-items', undefined, tok2)).body];
    assert.equal(m2.length, m1.length, 'menu copied');
    const c2 = (await call('GET', '/api/categories', undefined, tok2)).body;
    assert.ok(m2.filter((m: any) => m.category_id).every((m: any) => c2.some((c: any) => c.id === m.category_id)), 'items point at the new branch categories');

    const empty = await call('POST', '/api/branches', { name: 'ສາຂາວ່າງ' }, owner);
    const tok3 = (await call('POST', `/api/branches/${empty.body.id}/switch`, {}, owner)).body.token;
    assert.equal((await call('GET', '/api/tables', undefined, tok3)).body.length, 0, 'no copy requested: empty branch');
  });

  test('switching is limited to the owner and the owner\'s own restaurant', async () => {
    assert.equal((await call('POST', `/api/branches/${second}/switch`, {}, manager)).status, 403);
    assert.equal((await call('POST', `/api/branches/${foreign}/switch`, {}, owner)).status, 404);
    assert.equal((await call('PUT', `/api/branches/${foreign}`, { name: 'hack' }, owner)).status, 404);
    const r = await call('PUT', `/api/branches/${second}`, { name: 'ສາຂາ ວຽງຈັນ', phone: '021111' }, owner);
    assert.equal(r.body.name, 'ສາຂາ ວຽງຈັນ');
  });

  test('the comparison report adds up each branch and the total', async () => {
    const tok2 = (await call('POST', `/api/branches/${second}/switch`, {}, owner)).body.token;
    const a = await sell(owner, 1);
    const b = await sell(tok2, 3);
    const b2 = await sell(tok2, 1);
    const rep = (await call('GET', '/api/reports/branches', undefined, owner)).body;
    const m = rep.branches.find((x: any) => x.id === main);
    const s = rep.branches.find((x: any) => x.id === second);
    assert.equal(m.sales, a);
    assert.equal(m.bills, 1);
    assert.equal(s.sales, b + b2);
    assert.equal(s.bills, 2);
    assert.equal(s.avgBill, Math.round((b + b2) / 2));
    assert.equal(rep.totals.sales, a + b + b2);
    assert.equal(rep.totals.bills, 3);
    assert.equal(rep.totals.byMethod.cash, a + b + b2);
    assert.equal(m.share + s.share, 100, 'shares add to 100');
    assert.equal(rep.days, 7);
    assert.equal(rep.daily.length, 7);
    const lastDay = rep.daily[rep.daily.length - 1];
    assert.equal(lastDay.byBranch[main] + lastDay.byBranch[second], a + b + b2, 'today column holds everything');
    assert.ok(s.top.length >= 1);
    assert.equal(s.shiftOpen, true);
  });

  test('range validation and a single day', async () => {
    assert.equal((await call('GET', '/api/reports/branches?from=2026-02-01&to=2026-01-01', undefined, owner)).status, 400);
    assert.equal((await call('GET', '/api/reports/branches?from=abc', undefined, owner)).status, 400);
    assert.equal((await call('GET', '/api/reports/branches?from=2020-01-01&to=2026-01-01', undefined, owner)).status, 400, 'over a year');
    const old = (await call('GET', '/api/reports/branches?from=2020-01-01&to=2020-01-01', undefined, owner)).body;
    assert.equal(old.days, 1);
    assert.equal(old.totals.sales, 0);
    assert.equal(old.branches.length, 3);
  });
});
