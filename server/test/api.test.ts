import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { seedIfEmpty, DEMO_USERS } from '../src/seed.ts';
import { calcTotals, dayRange } from '../src/lib/core.ts';

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
async function login(username: string) {
  const r = await call('POST', '/api/auth/login', { username, password: PW });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.token as string;
}

before(async () => {
  const { server, db } = createApp({ dbFile: ':memory:', jwtSecret: 'test-secret' });
  seedIfEmpty(db, { withMenu: false });
  await new Promise<void>((ok) => server.listen(0, ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
after(() => close());

describe('calcTotals', () => {
  test('discount, service then VAT', () => {
    const t = calcTotals({
      items: [
        { unit_price: 10000, qty: 2, status: 'served' },
        { unit_price: 5000, qty: 1, status: 'cancelled' },
      ],
      discountType: 'percent',
      discountValue: 10,
      serviceRate: 10,
      vatRate: 10,
    });
    assert.deepEqual(t, { subtotal: 20000, discount: 2000, service: 1800, vat: 1980, total: 21780 });
  });
  test('amount discount cannot exceed subtotal', () => {
    const t = calcTotals({ items: [{ unit_price: 1000, qty: 1, status: 'pending' }], discountType: 'amount', discountValue: 5000, serviceRate: 0, vatRate: 0 });
    assert.equal(t.total, 0);
  });
  test('dayRange uses Laos offset', () => {
    assert.deepEqual(dayRange('2026-11-22', 420), { start: '2026-11-21T17:00:00.000Z', end: '2026-11-22T17:00:00.000Z' });
  });
});

describe('POS flow', () => {
  let admin = '';
  let waiter = '';
  let kitchen = '';
  let tableA = 0;
  let tableB = 0;
  let coffee = 0;
  let rice = 0;

  test('auth rejects bad password and missing token', async () => {
    assert.equal((await call('POST', '/api/auth/login', { username: 'admin', password: 'nope' })).status, 401);
    assert.equal((await call('GET', '/api/me')).status, 401);
    admin = await login('admin');
    waiter = await login('waiter');
    kitchen = await login('kitchen');
    const me = await call('GET', '/api/me', undefined, admin);
    assert.equal(me.body.user.role, 'owner');
    assert.equal(me.body.shift, null);
  });

  test('set up menu and tables (admin only)', async () => {
    assert.equal((await call('POST', '/api/categories', { name: 'x' }, waiter)).status, 403);
    const cat = await call('POST', '/api/categories', { name: 'ເຄື່ອງດື່ມ' }, admin);
    assert.equal(cat.status, 201);
    const c1 = await call(
      'POST',
      '/api/menu-items',
      {
        name: 'ກາເຟ',
        price: 20000,
        cost: 6000,
        categoryId: cat.body.id,
        options: [{ name: 'ຂະໜາດ', required: true, choices: [{ name: 'ກາງ', price: 0 }, { name: 'ໃຫຍ່', price: 10000 }] }],
      },
      admin,
    );
    assert.equal(c1.status, 201, JSON.stringify(c1.body));
    coffee = c1.body.id;
    rice = (await call('POST', '/api/menu-items', { name: 'ເຂົ້າຜັດ', price: 30000, categoryId: cat.body.id }, admin)).body.id;
    const bulk = await call('POST', '/api/tables/bulk', { prefix: 'T', from: 1, count: 2 }, admin);
    assert.equal(bulk.status, 201);
    const tables = (await call('GET', '/api/tables', undefined, admin)).body;
    [tableA, tableB] = tables.map((t: any) => t.id);
    assert.equal(tables[0].name, 'T 01');
  });

  test('orders require an open shift', async () => {
    const r = await call('POST', '/api/orders', { type: 'dine_in', tableId: tableA }, waiter);
    assert.equal(r.status, 409);
    assert.equal((await call('POST', '/api/shifts/open', { openingCash: 100000 }, waiter)).status, 403);
    assert.equal((await call('POST', '/api/shifts/open', { openingCash: 100000 }, admin)).status, 201);
    assert.equal((await call('POST', '/api/shifts/open', { openingCash: 0 }, admin)).status, 409);
  });

  let orderId = 0;
  test('dine-in: open table, add items, kitchen flow, one order per table', async () => {
    const o = await call('POST', '/api/orders', { type: 'dine_in', tableId: tableA }, waiter);
    assert.equal(o.status, 201);
    orderId = o.body.id;
    assert.equal((await call('POST', '/api/orders', { type: 'dine_in', tableId: tableA }, waiter)).status, 409);

    // required option missing
    const missing = await call('POST', `/api/orders/${orderId}/items`, { items: [{ menuItemId: coffee, qty: 1 }] }, waiter);
    assert.equal(missing.status, 400);
    // client-sent price is ignored; option price comes from the server
    const add = await call(
      'POST',
      `/api/orders/${orderId}/items`,
      {
        items: [
          { menuItemId: coffee, qty: 2, options: [{ group: 'ຂະໜາດ', name: 'ໃຫຍ່', price: 1 }] },
          { menuItemId: rice, qty: 1, note: 'ບໍ່ໃສ່ຜັກ' },
        ],
      },
      waiter,
    );
    assert.equal(add.status, 201, JSON.stringify(add.body));
    assert.equal(add.body.order.total, 2 * 30000 + 30000);

    const k = await call('GET', '/api/kitchen', undefined, kitchen);
    assert.equal(k.body.length, 2);
    assert.equal(k.body[0].table_name, 'T 01');
    const st = await call('POST', `/api/order-items/${k.body[0].id}/status`, { status: 'ready' }, kitchen);
    assert.equal(st.status, 200);
    assert.equal((await call('POST', `/api/orders/${orderId}/items`, { items: [{ menuItemId: rice }] }, kitchen)).status, 403);

    const floor = await call('GET', '/api/floor', undefined, waiter);
    const t = floor.body.tables.find((x: any) => x.id === tableA);
    assert.equal(t.order_id, orderId);
    assert.equal(t.item_count, 3);
  });

  test('void item needs manager; partial void recalculates', async () => {
    const o = (await call('GET', `/api/orders/${orderId}`, undefined, admin)).body;
    const coffeeLine = o.items.find((i: any) => i.menu_item_id === coffee);
    assert.equal((await call('POST', `/api/order-items/${coffeeLine.id}/cancel`, { reason: 'x' }, waiter)).status, 403);
    const v = await call('POST', `/api/order-items/${coffeeLine.id}/cancel`, { reason: 'ລູກຄ້າປ່ຽນໃຈ', qty: 1 }, admin);
    assert.equal(v.status, 200, JSON.stringify(v.body));
    assert.equal(v.body.total, 30000 + 30000);
    assert.equal(v.body.items.filter((i: any) => i.status === 'cancelled').length, 1);
  });

  test('discount, transfer table, print bill', async () => {
    assert.equal((await call('POST', `/api/orders/${orderId}/discount`, { type: 'percent', value: 10 }, waiter)).status, 403);
    const d = await call('POST', `/api/orders/${orderId}/discount`, { type: 'amount', value: 5000 }, admin);
    assert.equal(d.body.total, 55000);
    const tr = await call('POST', `/api/orders/${orderId}/transfer`, { tableId: tableB }, waiter);
    assert.equal(tr.body.table_id, tableB);
    const pb = await call('POST', `/api/orders/${orderId}/print-bill`, {}, waiter);
    assert.ok(pb.body.bill_printed_at);
  });

  test('payment: waiter cannot pay; underpay rejected; non-cash overpay rejected; multi-currency with change', async () => {
    assert.equal((await call('POST', `/api/orders/${orderId}/pay`, { payments: [{ method: 'cash', amount: 55000 }] }, waiter)).status, 403);
    assert.equal((await call('POST', `/api/orders/${orderId}/pay`, { payments: [{ method: 'cash', amount: 50000 }] }, admin)).status, 400);
    assert.equal((await call('POST', `/api/orders/${orderId}/pay`, { payments: [{ method: 'transfer', amount: 60000 }] }, admin)).status, 400);
    // 1 USD = 21,500 LAK (default) + 40,000 LAK cash → paid 61,500, change 6,500
    const p = await call(
      'POST',
      `/api/orders/${orderId}/pay`,
      { payments: [{ method: 'cash', currency: 'USD', amount: 1 }, { method: 'cash', currency: 'LAK', amount: 40000 }] },
      admin,
    );
    assert.equal(p.status, 200, JSON.stringify(p.body));
    assert.equal(p.body.change, 6500);
    assert.match(p.body.billNo, /^B\d{6}$/);
    assert.equal(p.body.order.status, 'paid');
    assert.equal((await call('POST', `/api/orders/${orderId}/pay`, { payments: [{ method: 'cash', amount: 1 }] }, admin)).status, 409);
    const floor = await call('GET', '/api/floor', undefined, waiter);
    assert.equal(floor.body.tables.find((x: any) => x.id === tableB).order_id, null);
  });

  test('takeaway gets queue numbers; empty order can be cancelled by waiter', async () => {
    const a = await call('POST', '/api/orders', { type: 'takeaway' }, waiter);
    const b = await call('POST', '/api/orders', { type: 'takeaway' }, waiter);
    assert.equal(b.body.queue_no, a.body.queue_no + 1);
    assert.equal((await call('POST', `/api/orders/${b.body.id}/cancel`, {}, waiter)).status, 200);
    await call('POST', `/api/orders/${a.body.id}/items`, { items: [{ menuItemId: rice, qty: 1 }] }, waiter);
    const pay = await call('POST', `/api/orders/${a.body.id}/pay`, { payments: [{ method: 'qr', amount: 30000 }] }, admin);
    assert.equal(pay.status, 200);
  });

  test('daily report and shift close reconcile cash', async () => {
    const r = await call('GET', '/api/reports/daily', undefined, admin);
    assert.equal(r.status, 200);
    assert.equal(r.body.totals.bills, 2);
    assert.equal(r.body.totals.sales, 85000);
    assert.equal(r.body.totals.change, 6500);
    assert.equal(r.body.byMethod.find((m: any) => m.method === 'qr').amount_lak, 30000);
    assert.equal(r.body.cancelled.lines, 1);
    assert.equal(r.body.trend.length, 7);

    const cur = await call('GET', '/api/shifts/current', undefined, admin);
    // opening 100,000 + cash 61,500 − change 6,500
    assert.equal(cur.body.summary.expectedCash, 155000);
    const c = await call('POST', '/api/shifts/close', { countedCash: 154000, note: 'ຂາດ 1,000' }, admin);
    assert.equal(c.status, 200);
    assert.equal(c.body.variance, -1000);
    assert.equal((await call('GET', '/api/shifts/current', undefined, admin)).body, null);
  });

  test('staff management guards', async () => {
    const u = await call('POST', '/api/users', { name: 'ນ້ອງໃໝ່', username: 'New.Staff', password: 'secret1', role: 'waiter' }, admin);
    assert.equal(u.status, 201);
    assert.equal(u.body.username, 'new.staff');
    assert.equal(u.body.password_hash, undefined);
    assert.equal((await call('POST', '/api/users', { name: 'x', username: 'new.staff', password: 'secret1', role: 'waiter' }, admin)).status, 409);
    const manager = await login('manager');
    assert.equal((await call('POST', '/api/users', { name: 'x', username: 'boss2', password: 'secret1', role: 'owner' }, manager)).status, 403);
    await call('PUT', `/api/users/${u.body.id}`, { active: false }, admin);
    assert.equal((await call('POST', '/api/auth/login', { username: 'new.staff', password: 'secret1' })).status, 401);
  });

  test('settings update and validation', async () => {
    const s = await call('PUT', '/api/settings', { vat_rate: 10, rate_usd: 22000, restaurantName: 'ຮ້ານທົດລອງ' }, admin);
    assert.equal(s.status, 200);
    assert.equal(s.body.branch.vat_rate, 10);
    assert.equal(s.body.restaurant.name, 'ຮ້ານທົດລອງ');
    assert.equal((await call('PUT', '/api/settings', { vat_rate: 200 }, admin)).status, 400);
    assert.equal((await call('PUT', '/api/settings', { vat_rate: 5 }, waiter)).status, 403);
  });
});
