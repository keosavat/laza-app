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

describe('promotions and coupons', () => {
  let admin = '';
  let waiter = '';
  let orderId = 0;
  let sub = 0;
  let pct = 0;
  let coupon = 0;

  test('only admins manage promotions; input is validated', async () => {
    admin = await login('admin');
    waiter = await login('waiter');
    assert.equal((await call('POST', '/api/promotions', { name: 'x', type: 'percent', value: 10 }, waiter)).status, 403);
    assert.equal((await call('POST', '/api/promotions', { name: 'x', type: 'percent', value: 150 }, admin)).status, 400);
    assert.equal((await call('POST', '/api/promotions', { name: '', type: 'percent', value: 10 }, admin)).status, 400);
    assert.equal((await call('POST', '/api/promotions', { name: 'x', type: 'percent', value: 10, startsOn: '2030-02-01', endsOn: '2030-01-01' }, admin)).status, 400);
    assert.equal((await call('POST', '/api/promotions', { name: 'x', type: 'percent', value: 10, timeFrom: '10:00' }, admin)).status, 400);
    pct = (await call('POST', '/api/promotions', { name: 'ຫຼຸດ 10%', type: 'percent', value: 10, maxDiscount: 5000, minSubtotal: 20000 }, admin)).body.id;
    coupon = (await call('POST', '/api/promotions', { name: 'ຄູປອງ VIP', code: 'vip 50', type: 'amount', value: 50000, maxUses: 1 }, admin)).body.id;
    assert.ok(pct && coupon);
    assert.equal((await call('POST', '/api/promotions', { name: 'dup', code: 'VIP50', type: 'amount', value: 1 }, admin)).status, 400);
  });

  test('set up an order, then pick a promotion: min spend, cap and listing', async () => {
    await call('POST', '/api/shifts/open', { openingCash: 0 }, admin);
    const items = (await call('GET', '/api/menu-items', undefined, admin)).body;
    const tables = (await call('GET', '/api/tables', undefined, admin)).body;
    orderId = (await call('POST', '/api/orders', { type: 'dine_in', tableId: tables[0].id }, waiter)).body.id;

    // empty order: below the minimum spend
    assert.equal((await call('POST', `/api/orders/${orderId}/promo`, { promoId: pct }, waiter)).status, 400);

    const dish = items.find((i: any) => i.price >= 20000) ?? items[0];
    await call('POST', `/api/orders/${orderId}/items`, { items: [{ menuItemId: dish.id, qty: 5 }], print: false }, waiter);
    const list = (await call('GET', `/api/orders/${orderId}/promotions`, undefined, waiter)).body;
    sub = list.subtotal;
    assert.ok(sub >= 20000);
    assert.deepEqual(list.list.map((p: any) => p.id), [pct], 'coupon-code promotions are not listed');

    const ok = await call('POST', `/api/orders/${orderId}/promo`, { promoId: pct }, waiter);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const o = (await call('GET', `/api/orders/${orderId}`, undefined, waiter)).body;
    assert.equal(o.discount, Math.min(Math.round(sub * 0.1), 5000));
    assert.equal(o.promo_name, 'ຫຼຸດ 10%');
  });

  test('coupon codes need the code; a promotion replaces a manual discount and vice versa', async () => {
    assert.equal((await call('POST', `/api/orders/${orderId}/promo`, { promoId: coupon }, waiter)).status, 400);
    assert.equal((await call('POST', `/api/orders/${orderId}/promo`, { code: 'NOPE' }, waiter)).status, 404);
    const manual = await call('POST', `/api/orders/${orderId}/discount`, { type: 'amount', value: 1000 }, admin);
    assert.equal(manual.body.discount, 1000);
    assert.equal(manual.body.promo_name, '');
    const c = await call('POST', `/api/orders/${orderId}/promo`, { code: 'vip50' }, waiter);
    assert.equal(c.status, 200, JSON.stringify(c.body));
    const o = (await call('GET', `/api/orders/${orderId}`, undefined, waiter)).body;
    assert.equal(o.discount, Math.min(50000, sub));
    assert.equal(o.discount_type, 'none');
    assert.equal((await call('DELETE', `/api/orders/${orderId}/promo`, undefined, waiter)).status, 200);
    assert.equal((await call('GET', `/api/orders/${orderId}`, undefined, waiter)).body.discount, 0);
  });

  test('usage is counted on payment and the limit is enforced', async () => {
    assert.equal((await call('POST', `/api/orders/${orderId}/promo`, { code: 'VIP50' }, waiter)).status, 200);
    const total = (await call('GET', `/api/orders/${orderId}`, undefined, waiter)).body.total;
    const pay = await call('POST', `/api/orders/${orderId}/pay`, { payments: [{ method: 'cash', currency: 'LAK', amount: total }] }, admin);
    assert.equal(pay.status, 200, JSON.stringify(pay.body));
    const row = (await call('GET', '/api/promotions', undefined, admin)).body.find((p: any) => p.id === coupon);
    assert.equal(row.used_count, 1);
    assert.equal(row.total_discount, Math.min(50000, sub));

    // limit of 1 reached: a new order cannot use it
    const tables = (await call('GET', '/api/tables', undefined, admin)).body;
    const items = (await call('GET', '/api/menu-items', undefined, admin)).body;
    const o2 = (await call('POST', '/api/orders', { type: 'dine_in', tableId: tables[1].id }, waiter)).body.id;
    await call('POST', `/api/orders/${o2}/items`, { items: [{ menuItemId: items[0].id, qty: 1 }], print: false }, waiter);
    assert.equal((await call('POST', `/api/orders/${o2}/promo`, { code: 'VIP50' }, waiter)).status, 400);
  });

  test('inactive, wrong order type and used promotions behave; delete deactivates when used', async () => {
    assert.equal((await call('PUT', `/api/promotions/${pct}`, { orderType: 'takeaway' }, admin)).status, 200);
    const tables = (await call('GET', '/api/tables', undefined, admin)).body;
    const items = (await call('GET', '/api/menu-items', undefined, admin)).body;
    const o3 = (await call('POST', '/api/orders', { type: 'dine_in', tableId: tables[2].id }, waiter)).body.id;
    await call('POST', `/api/orders/${o3}/items`, { items: [{ menuItemId: items[0].id, qty: 20 }], print: false }, waiter);
    assert.equal((await call('POST', `/api/orders/${o3}/promo`, { promoId: pct }, waiter)).status, 400);

    const del = await call('DELETE', `/api/promotions/${coupon}`, undefined, admin);
    assert.deepEqual(del.body, { deleted: false, deactivated: true });
    const fresh = (await call('POST', '/api/promotions', { name: 'tmp', type: 'amount', value: 10 }, admin)).body.id;
    assert.deepEqual((await call('DELETE', `/api/promotions/${fresh}`, undefined, admin)).body, { deleted: true, deactivated: false });
  });
});
