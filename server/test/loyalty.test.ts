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

describe('CRM and loyalty points', () => {
  let admin = '';
  let cashier = '';
  let dish = 0;
  let tables: any[] = [];
  let cust = 0;

  async function newOrder(tableIdx: number, qty: number) {
    const id = (await call('POST', '/api/orders', { type: 'dine_in', tableId: tables[tableIdx].id }, cashier)).body.id;
    await call('POST', `/api/orders/${id}/items`, { items: [{ menuItemId: dish, qty }], print: false }, cashier);
    return { id, total: (await call('GET', `/api/orders/${id}`, undefined, cashier)).body.total as number };
  }
  const cash = (amount: number) => [{ method: 'cash', currency: 'LAK', amount }];
  const profile = async () => (await call('GET', `/api/customers/${cust}`, undefined, cashier)).body;

  test('profile fields are validated; loyalty is off until configured', async () => {
    admin = await login('admin');
    cashier = await login('cashier');
    await call('POST', '/api/shifts/open', { openingCash: 100000 }, admin);
    dish = (await call('GET', '/api/menu-items', undefined, admin)).body.find((i: any) => i.price >= 20000).id;
    tables = (await call('GET', '/api/tables', undefined, admin)).body;

    assert.equal((await call('POST', '/api/customers', { name: 'x', birthday: '1990-13-45' }, cashier)).status, 400);
    assert.equal((await call('POST', '/api/customers', { name: 'x', birthday: 'abc' }, cashier)).status, 400);
    const c = await call('POST', '/api/customers', { name: 'ນາງ ແກ້ວ', phone: '020555', birthday: '1992-05-17', tags: 'VIP, ມັກເຜັດ' }, cashier);
    assert.equal(c.status, 201, JSON.stringify(c.body));
    assert.equal(c.body.birthday, '1992-05-17');
    assert.equal(c.body.tags, 'VIP, ມັກເຜັດ');
    assert.equal(c.body.points, 0);
    cust = c.body.id;

    const o = await newOrder(0, 1);
    const pay = await call('POST', `/api/orders/${o.id}/pay`, { payments: cash(o.total), customerId: cust }, cashier);
    assert.equal(pay.status, 200, JSON.stringify(pay.body));
    assert.equal(pay.body.pointsEarned, 0, 'no points while earn rate is 0');
    assert.equal((await profile()).stats.visits, 1, 'the visit is still recorded');
  });

  test('only a manager changes the loyalty rates', async () => {
    assert.equal((await call('PUT', '/api/settings', { loyalty_earn_per: 10000 }, cashier)).status, 403);
    const r = await call('PUT', '/api/settings', { loyalty_earn_per: 10000, loyalty_redeem_value: 500 }, admin);
    assert.equal(r.status, 200);
    assert.equal(r.body.branch.loyalty_earn_per, 10000);
    assert.equal((await call('PUT', '/api/settings', { loyalty_earn_per: -1 }, admin)).status, 400);
  });

  test('paying earns points (one per ₭10,000, rounded down) and shows in the profile', async () => {
    const o = await newOrder(1, 3);
    const expected = Math.floor(o.total / 10000);
    assert.ok(expected >= 1);
    const pay = await call('POST', `/api/orders/${o.id}/pay`, { payments: cash(o.total), customerId: cust }, cashier);
    assert.equal(pay.body.pointsEarned, expected);
    const p = await profile();
    assert.equal(p.customer.points, expected);
    assert.equal(p.stats.visits, 2);
    assert.equal(p.pointEntries[0].type, 'earn');
    assert.equal(p.orders.length, 2);
    assert.ok(p.favorites.length >= 1);
    const order = (await call('GET', `/api/orders/${o.id}`, undefined, cashier)).body;
    assert.equal(order.points_earned, expected);
    assert.equal(order.crm_name, 'ນາງ ແກ້ວ');
  });

  test('redeeming points reduces what is due; cash change is computed on the reduced amount', async () => {
    const before = (await profile()).customer.points;
    const o = await newOrder(2, 2);
    const use = 3;
    assert.ok(before >= use);
    // too many points / no customer / more than the bill are refused
    assert.equal((await call('POST', `/api/orders/${o.id}/pay`, { payments: cash(o.total), customerId: cust, redeemPoints: before + 1 }, cashier)).status, 400);
    assert.equal((await call('POST', `/api/orders/${o.id}/pay`, { payments: cash(o.total), redeemPoints: use }, cashier)).status, 400, 'needs a customer');
    assert.equal((await call('POST', `/api/orders/${o.id}/pay`, { payments: cash(o.total - 2000), customerId: cust, redeemPoints: use }, cashier)).status, 400, 'short by ₭500');
    const drawer = (await call('GET', '/api/shifts/current', undefined, admin)).body.summary.expectedCash;
    const due = o.total - use * 500;
    const pay = await call('POST', `/api/orders/${o.id}/pay`, { payments: cash(due), customerId: cust, redeemPoints: use }, cashier);
    assert.equal(pay.status, 200, JSON.stringify(pay.body));
    assert.equal(pay.body.change, 0);
    assert.equal(pay.body.pointsValue, use * 500);
    const after = await profile();
    const earned = Math.floor((o.total - use * 500) / 10000);
    assert.equal(after.customer.points, before - use + earned);
    assert.equal((await call('GET', '/api/shifts/current', undefined, admin)).body.summary.expectedCash, drawer + due, 'drawer gets only the cash actually paid');
    assert.equal((await call('GET', `/api/orders/${o.id}`, undefined, cashier)).body.total, o.total, 'the bill total is unchanged');
  });

  test('a bill fully covered by points needs no payment lines', async () => {
    const pts = (await profile()).customer.points;
    await call('POST', `/api/customers/${cust}/points`, { points: 100, note: 'ຂອງຂວັນ' }, admin);
    const o = await newOrder(3, 1);
    const need = Math.ceil(o.total / 500);
    const pay = await call('POST', `/api/orders/${o.id}/pay`, { payments: [], customerId: cust, redeemPoints: need }, cashier);
    if (o.total % 500 === 0) assert.equal(pay.status, 200, JSON.stringify(pay.body));
    else assert.equal(pay.status, 400, 'over the bill value');
    assert.ok((await profile()).customer.points >= pts);
  });

  test('manual adjustments: admin only, never below zero, recorded', async () => {
    assert.equal((await call('POST', `/api/customers/${cust}/points`, { points: 5 }, cashier)).status, 403);
    assert.equal((await call('POST', `/api/customers/${cust}/points`, { points: 0 }, admin)).status, 400);
    const bal = (await profile()).customer.points;
    assert.equal((await call('POST', `/api/customers/${cust}/points`, { points: -(bal + 1) }, admin)).status, 400);
    const r = await call('POST', `/api/customers/${cust}/points`, { points: -1, note: 'ແກ້ໄຂ' }, admin);
    assert.equal(r.status, 201);
    assert.equal(r.body.points, bal - 1);
    assert.equal((await profile()).pointEntries[0].type, 'adjust');
  });

  test('the debtor of a bill is also its customer; list shows visits, spend and points', async () => {
    const debtor = (await call('POST', '/api/customers', { name: 'ລູກໜີ້ ໃໝ່' }, cashier)).body.id;
    const o = await newOrder(4, 1);
    assert.equal((await call('POST', `/api/orders/${o.id}/pay`, { payments: [], debt: { customerId: debtor, amount: o.total } }, cashier)).status, 200);
    assert.equal((await call('GET', `/api/orders/${o.id}`, undefined, cashier)).body.customer_id, debtor);
    const list = (await call('GET', '/api/customers', undefined, cashier)).body;
    const me = list.find((c: any) => c.id === cust);
    assert.equal(me.visits, 4);
    assert.ok(me.spent > 0 && me.last_visit);
    assert.equal(list.find((c: any) => c.id === debtor).visits, 1);
  });

  test('a customer with history is deactivated, not deleted', async () => {
    const r = await call('DELETE', `/api/customers/${cust}`, undefined, admin);
    assert.equal(r.status, 200);
    assert.equal(r.body.deactivated, true);
  });
});
