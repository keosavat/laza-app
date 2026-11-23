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

describe('customer debts', () => {
  let admin = '';
  let cashier = '';
  let kitchen = '';
  let cust = 0;
  let dish = 0;
  let tables: any[] = [];

  async function newOrder(tableIdx: number, qty: number) {
    const id = (await call('POST', '/api/orders', { type: 'dine_in', tableId: tables[tableIdx].id }, cashier)).body.id;
    await call('POST', `/api/orders/${id}/items`, { items: [{ menuItemId: dish, qty }], print: false }, cashier);
    return { id, total: (await call('GET', `/api/orders/${id}`, undefined, cashier)).body.total as number };
  }

  test('customers: cashier can create, only admin edits or sets a credit limit', async () => {
    admin = await login('admin');
    cashier = await login('cashier');
    kitchen = await login('kitchen');
    assert.equal((await call('GET', '/api/customers', undefined, kitchen)).status, 403);
    assert.equal((await call('POST', '/api/customers', { name: '' }, cashier)).status, 400);
    const c = await call('POST', '/api/customers', { name: 'ລູກຄ້າ A', phone: '020111', creditLimit: 999999999 }, cashier);
    assert.equal(c.status, 201);
    assert.equal(c.body.credit_limit, 0, 'a cashier cannot set the limit');
    cust = c.body.id;
    assert.equal((await call('POST', '/api/customers', { name: 'dup', phone: '020111' }, cashier)).status, 400);
    assert.equal((await call('PUT', `/api/customers/${cust}`, { creditLimit: 5000000 }, cashier)).status, 403);
    assert.equal((await call('PUT', `/api/customers/${cust}`, { creditLimit: 5000000 }, admin)).body.credit_limit, 5000000);
  });

  test('part of a bill goes on the account; cash drawer only gets what was paid', async () => {
    await call('POST', '/api/shifts/open', { openingCash: 100000 }, admin);
    const items = (await call('GET', '/api/menu-items', undefined, admin)).body;
    dish = items.find((i: any) => i.price >= 20000).id;
    tables = (await call('GET', '/api/tables', undefined, admin)).body;
    const o = await newOrder(0, 2);

    // no customer / wrong customer / more debt than the bill
    assert.equal((await call('POST', `/api/orders/${o.id}/pay`, { payments: [], debt: { amount: o.total } }, cashier)).status, 400);
    assert.equal((await call('POST', `/api/orders/${o.id}/pay`, { payments: [], debt: { customerId: 9999, amount: o.total } }, cashier)).status, 404);
    assert.equal((await call('POST', `/api/orders/${o.id}/pay`, { payments: [], debt: { customerId: cust, amount: o.total + 1 } }, cashier)).status, 400);
    // paying too little in cash with debt still short
    assert.equal((await call('POST', `/api/orders/${o.id}/pay`, { payments: [{ method: 'cash', currency: 'LAK', amount: 1000 }], debt: { customerId: cust, amount: 1000 } }, cashier)).status, 400);

    const upfront = 10000;
    const owed = o.total - upfront;
    const pay = await call('POST', `/api/orders/${o.id}/pay`, { payments: [{ method: 'cash', currency: 'LAK', amount: upfront }], debt: { customerId: cust, amount: owed } }, cashier);
    assert.equal(pay.status, 200, JSON.stringify(pay.body));
    assert.equal(pay.body.change, 0);
    assert.equal(pay.body.order.debt_amount, owed);

    const c = (await call('GET', `/api/customers/${cust}`, undefined, cashier)).body;
    assert.equal(c.customer.balance, owed);
    assert.equal(c.entries[0].type, 'charge');
    assert.equal(c.entries[0].bill_no, pay.body.billNo);

    const shift = (await call('GET', '/api/shifts/current', undefined, admin)).body;
    assert.equal(shift.summary.cashIn, upfront);
    assert.equal(shift.summary.expectedCash, 100000 + upfront);
    assert.equal(shift.summary.debtCharged, owed);
  });

  test('credit limit blocks an over-limit charge and rolls the payment back', async () => {
    await call('PUT', `/api/customers/${cust}`, { creditLimit: 10 }, admin);
    const o = await newOrder(1, 1);
    const r = await call('POST', `/api/orders/${o.id}/pay`, { payments: [], debt: { customerId: cust, amount: o.total } }, cashier);
    assert.equal(r.status, 400);
    assert.match(r.body.error, /ວົງເງິນ/);
    assert.equal((await call('GET', `/api/orders/${o.id}`, undefined, cashier)).body.status, 'open');
    await call('PUT', `/api/customers/${cust}`, { creditLimit: 0 }, admin);
  });

  test('whole bill on credit, then repayments (cash enters the drawer) and the daily report', async () => {
    const o = await newOrder(4, 1);
    const pay = await call('POST', `/api/orders/${o.id}/pay`, { payments: [], debt: { customerId: cust, amount: o.total } }, cashier);
    assert.equal(pay.status, 200, JSON.stringify(pay.body));

    let bal = (await call('GET', `/api/customers/${cust}`, undefined, cashier)).body.customer.balance;
    assert.ok(bal > o.total);
    assert.equal((await call('POST', `/api/customers/${cust}/payments`, { amount: bal + 1 }, cashier)).status, 400, 'cannot overpay');
    assert.equal((await call('POST', `/api/customers/${cust}/payments`, { amount: 0 }, cashier)).status, 400);

    const before = (await call('GET', '/api/shifts/current', undefined, admin)).body.summary.expectedCash;
    const p1 = await call('POST', `/api/customers/${cust}/payments`, { amount: 20000, method: 'cash', note: 'ງວດ 1' }, cashier);
    assert.equal(p1.status, 201);
    assert.equal(p1.body.balance, bal - 20000);
    const p2 = await call('POST', `/api/customers/${cust}/payments`, { amount: 5000, method: 'transfer' }, cashier);
    assert.equal(p2.body.balance, bal - 25000);
    const sum = (await call('GET', '/api/shifts/current', undefined, admin)).body.summary;
    assert.equal(sum.expectedCash, before + 20000, 'only the cash repayment enters the drawer');
    assert.equal(sum.debtCollected, 25000);

    const rep = (await call('GET', '/api/reports/daily', undefined, admin)).body;
    assert.equal(rep.debt.collected, 25000);
    assert.equal(rep.debt.outstanding, bal - 25000);
    assert.ok(rep.debt.charged > 0);

    const s = (await call('GET', '/api/debts/summary', undefined, cashier)).body;
    assert.equal(s.total, bal - 25000);
    assert.equal(s.count, 1);

    // settle everything
    bal = bal - 25000;
    assert.equal((await call('POST', `/api/customers/${cust}/payments`, { amount: bal }, cashier)).body.balance, 0);
    assert.equal((await call('GET', '/api/debts/summary', undefined, cashier)).body.count, 0);
  });

  test('customers with history are deactivated, not deleted; debt blocks deletion', async () => {
    const o = await newOrder(2, 1);
    await call('POST', `/api/orders/${o.id}/pay`, { payments: [], debt: { customerId: cust, amount: o.total } }, cashier);
    assert.equal((await call('DELETE', `/api/customers/${cust}`, undefined, admin)).status, 400);
    await call('POST', `/api/customers/${cust}/payments`, { amount: o.total }, cashier);
    assert.deepEqual((await call('DELETE', `/api/customers/${cust}`, undefined, admin)).body, { deleted: false, deactivated: true });
    const o2 = await newOrder(3, 1);
    assert.equal((await call('POST', `/api/orders/${o2.id}/pay`, { payments: [], debt: { customerId: cust, amount: o2.total } }, cashier)).status, 400);
  });
});
