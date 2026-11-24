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

describe('transactions report', () => {
  let admin = '';
  let cashier = '';
  let waiter = '';
  const totals: Record<string, number> = {};

  test('set up: one cash bill, one transfer bill with a customer debt, one cancelled bill', async () => {
    admin = await login('admin');
    cashier = await login('cashier');
    waiter = await login('waiter');
    await call('POST', '/api/shifts/open', { openingCash: 100000 }, admin);
    const dish = (await call('GET', '/api/menu-items', undefined, admin)).body.find((i: any) => i.price >= 20000).id;
    const tables = (await call('GET', '/api/tables', undefined, admin)).body;
    const cust = (await call('POST', '/api/customers', { name: 'ລູກຄ້າ ທົດສອບ', phone: '020999' }, admin)).body.id;
    await call('PUT', `/api/customers/${cust}`, { creditLimit: 10_000_000 }, admin);

    const make = async (i: number, qty: number) => {
      const id = (await call('POST', '/api/orders', { type: 'dine_in', tableId: tables[i].id }, cashier)).body.id;
      const add = await call('POST', `/api/orders/${id}/items`, { items: [{ menuItemId: dish, qty }], print: false }, cashier);
      assert.equal(add.status, 201, JSON.stringify(add.body));
      return { id, total: (await call('GET', `/api/orders/${id}`, undefined, cashier)).body.total as number };
    };
    const a = await make(0, 1);
    assert.equal((await call('POST', `/api/orders/${a.id}/pay`, { payments: [{ method: 'cash', currency: 'LAK', amount: a.total }] }, cashier)).status, 200);
    const b = await make(1, 2);
    const half = Math.floor(b.total / 2);
    assert.equal((await call('POST', `/api/orders/${b.id}/pay`, { payments: [{ method: 'transfer', currency: 'LAK', amount: b.total - half }], debt: { customerId: cust, amount: half } }, cashier)).status, 200);
    const c = await make(2, 1);
    const cx = await call('POST', `/api/orders/${c.id}/cancel`, { reason: 'ລູກຄ້າປ່ຽນໃຈ' }, admin);
    assert.equal(cx.status, 200, JSON.stringify(cx.body));
    totals.paid = a.total + b.total;
    totals.debt = half;
    totals.transfer = b.total - half;
    totals.cash = a.total;
  });

  test('defaults to paid bills of today; totals add up and exclude the cancelled one', async () => {
    const r = await call('GET', '/api/reports/transactions', undefined, admin);
    assert.equal(r.status, 200);
    assert.equal(r.body.rows.length, 2);
    assert.equal(r.body.totals.total, totals.paid);
    assert.equal(r.body.totals.debt, totals.debt);
    assert.equal(r.body.totals.byMethod.cash, totals.cash);
    assert.equal(r.body.totals.byMethod.transfer, totals.transfer);
    assert.equal(r.body.totals.paidCount, 2);
    for (const row of r.body.rows) assert.equal(row.total, row.subtotal - row.discount + row.service + row.vat);
  });

  test('status, method, debt and search filters', async () => {
    const q = async (s: string) => (await call('GET', `/api/reports/transactions?${s}`, undefined, admin)).body;
    assert.equal((await q('status=all')).rows.length, 3);
    assert.equal((await q('status=cancelled')).rows.length, 1);
    assert.equal((await q('status=cancelled')).totals.total, 0, 'cancelled bills are not sales');
    assert.equal((await q('method=cash')).rows.length, 1);
    assert.equal((await q('method=transfer')).rows.length, 1);
    const d = await q('has=debt');
    assert.equal(d.rows.length, 1);
    assert.equal(d.rows[0].debt_customer, 'ລູກຄ້າ ທົດສອບ');
    assert.equal((await q('q=ທົດສອບ')).rows.length, 1);
    assert.equal((await q('q=zzzz-none')).rows.length, 0);
    assert.equal((await q('type=takeaway')).rows.length, 0);
    assert.equal((await q('from=2000-01-01&to=2000-01-31')).rows.length, 0);
  });

  test('validation and permissions', async () => {
    assert.equal((await call('GET', '/api/reports/transactions', undefined, waiter)).status, 403);
    assert.equal((await call('GET', '/api/reports/transactions?from=bad', undefined, admin)).status, 400);
    assert.equal((await call('GET', '/api/reports/transactions?status=nope', undefined, admin)).status, 400);
    assert.equal((await call('GET', '/api/reports/transactions?from=2025-01-01&to=2020-01-01', undefined, admin)).status, 400);
    assert.equal((await call('GET', '/api/reports/transactions?from=2020-01-01&to=2025-01-01', undefined, admin)).status, 400, 'max one year');
  });
});
