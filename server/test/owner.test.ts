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

describe('owner overview', () => {
  let owner = '';
  let manager = '';
  let tok2 = '';

  const sell = async (token: string, qty: number, tableIdx = 0) => {
    await call('POST', '/api/shifts/open', { openingCash: 50000 }, token);
    const tables = (await call('GET', '/api/tables', undefined, token)).body;
    const dish = (await call('GET', '/api/menu-items', undefined, token)).body.find((i: any) => i.price >= 20000 && !(i.options ?? []).some((g: any) => g.required));
    const id = (await call('POST', '/api/orders', { type: 'dine_in', tableId: tables[tableIdx].id }, token)).body.id;
    await call('POST', `/api/orders/${id}/items`, { items: [{ menuItemId: dish.id, qty }], print: false }, token);
    const total = (await call('GET', `/api/orders/${id}`, undefined, token)).body.total as number;
    return { id, total, pay: () => call('POST', `/api/orders/${id}/pay`, { payments: [{ method: 'cash', currency: 'LAK', amount: total }] }, token) };
  };

  test('owner only', async () => {
    owner = await login('admin');
    manager = await login('manager');
    assert.equal((await call('GET', '/api/owner/overview', undefined, manager)).status, 403);
    assert.equal((await call('GET', '/api/owner/overview', undefined)).status, 401);
  });

  test('quiet restaurant: zeros, no sales, no false alarms about sales', async () => {
    const o = (await call('GET', '/api/owner/overview', undefined, owner)).body;
    assert.equal(o.branches.length, 1);
    assert.equal(o.totals.sales, 0);
    assert.equal(o.totals.bills, 0);
    assert.equal(o.trend.length, 7);
    assert.deepEqual(o.recent, []);
    assert.equal(o.branches[0].shift, null);
    assert.ok(!o.flags.some((f: any) => /ຍົກເລີກ|ເປີດຄ້າງ/.test(f.text)));
  });

  test('sales, open orders and cash show per branch and in total', async () => {
    const b2 = (await call('POST', '/api/branches', { name: 'ສາຂາ 2', copyFrom: (await call('GET', '/api/branches', undefined, owner)).body[0].id }, owner)).body;
    tok2 = (await call('POST', `/api/branches/${b2.id}/switch`, {}, owner)).body.token;

    const a = await sell(owner, 2);
    assert.equal((await a.pay()).status, 200);
    const b = await sell(tok2, 1);
    assert.equal((await b.pay()).status, 200);
    const c = await sell(tok2, 3, 1); // left open
    const o = (await call('GET', '/api/owner/overview', undefined, owner)).body;
    const m1 = o.branches[0];
    const m2 = o.branches[1];
    assert.equal(m1.today.sales, a.total);
    assert.equal(m1.today.bills, 1);
    assert.equal(m2.today.sales, b.total);
    assert.equal(m2.open.n, 1);
    assert.equal(m2.open.total, c.total);
    assert.equal(o.totals.sales, a.total + b.total);
    assert.equal(o.totals.bills, 2);
    assert.equal(o.totals.openOrders, 1);
    assert.equal(o.totals.avgBill, Math.round((a.total + b.total) / 2));
    assert.equal(o.totals.shiftsOpen, 2);
    assert.equal(m1.shift.expectedCash, 50000 + a.total, 'drawer = float + cash sales');
    assert.equal(o.trend[6].sales, a.total + b.total, 'today is the last trend point');
    assert.equal(o.trend[5].sales, 0);
    assert.equal(o.totals.yesterday, 0);
    assert.equal(o.recent.length, 2);
    assert.ok(o.recent[0].branch);
    assert.ok(o.recent[0].paid_at >= o.recent[1].paid_at, 'newest first');
  });

  test('flags: out-of-stock, heavy cancellations, supplier debt', async () => {
    await call('POST', '/api/ingredients', { name: 'ເກືອ', unit: 'kg', stock: 0 }, owner);
    let o = (await call('GET', '/api/owner/overview', undefined, owner)).body;
    assert.ok(o.flags.some((f: any) => f.branchId === o.branches[0].id && /ໝົດ/.test(f.text)), 'out of stock warning');

    // cancel a big part of a sale: 4 of 5 cancelled => well over 5% of sales
    const s = await sell(owner, 5, 2);
    const order = (await call('GET', `/api/orders/${s.id}`, undefined, owner)).body;
    const item = order.items[0];
    const v = await call('POST', `/api/order-items/${item.id}/cancel`, { qty: 4, reason: 'ທົດສອບ' }, owner);
    assert.ok(v.status < 300, JSON.stringify(v.body));
    assert.equal((await s.pay()).status, 200);
    o = (await call('GET', '/api/owner/overview', undefined, owner)).body;
    assert.ok(o.branches[0].today.cancelled > 0);
    assert.ok(o.flags.some((f: any) => /ຍົກເລີກ/.test(f.text)), 'cancellation warning');
    assert.equal(o.flags[0].level, 'warn', 'warnings sort first');
  });
});
