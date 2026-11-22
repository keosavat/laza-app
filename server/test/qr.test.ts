import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { seedIfEmpty, DEMO_USERS } from '../src/seed.ts';
import type { Db } from '../src/db.ts';

const PW = DEMO_USERS[0].password;
let base = '';
let db: Db;
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
const pub = (method: string, token: string, path: string, body?: unknown) => call(method, `/api/public/qr/${token}${path}`, body);
async function login(username: string) {
  const r = await call('POST', '/api/auth/login', { username, password: PW });
  assert.equal(r.status, 200);
  return r.body.token as string;
}

before(async () => {
  const app = createApp({ dbFile: ':memory:', jwtSecret: 'test-secret' });
  db = app.db;
  seedIfEmpty(db);
  await new Promise<void>((ok) => app.server.listen(0, ok));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  close = () => app.server.close();
});
after(() => close());

describe('QR self-ordering', () => {
  let admin = '';
  let waiter = '';
  let kitchen = '';
  let orderId = 0;
  let token = '';
  let pho = 0; // item with a required option
  let rice = 0; // plain item
  let hidden = 0;

  const staffOrder = async () => (await call('GET', `/api/orders/${orderId}`, undefined, admin)).body;
  const kitchenNames = async () => (await call('GET', '/api/kitchen', undefined, kitchen)).body.map((i: any) => i.name);

  test('open a table with a QR code', async () => {
    admin = await login('admin');
    waiter = await login('waiter');
    kitchen = await login('kitchen');
    const items = (await call('GET', '/api/menu-items', undefined, admin)).body;
    pho = items.find((i: any) => i.name === 'ເຝີຊີ້ນງົວ').id;
    rice = items.find((i: any) => i.name === 'ເຂົ້າໜຽວ').id;
    hidden = items.find((i: any) => i.name === 'ນ້ຳດື່ມ').id;
    await call('PUT', `/api/menu-items/${hidden}`, { active: false }, admin);

    assert.equal((await call('POST', '/api/shifts/open', { openingCash: 0 }, admin)).status, 201);
    const tables = (await call('GET', '/api/tables', undefined, admin)).body;
    const o = await call('POST', '/api/orders', { type: 'dine_in', tableId: tables[0].id, guestCount: 3, withQr: true, durationHours: 0 }, waiter);
    assert.equal(o.status, 201, JSON.stringify(o.body));
    orderId = o.body.id;
    assert.equal(o.body.guest_count, 3);
    token = o.body.qr_token;
    assert.match(token, /^[A-Za-z0-9_-]{32}$/);
  });

  test('only staff with POS permission can issue QR; takeaway has none', async () => {
    assert.equal((await call('POST', `/api/orders/${orderId}/qr`, {}, kitchen)).status, 403);
    assert.equal((await call('POST', `/api/orders/${orderId}/qr`, {})).status, 401);
    const t = await call('POST', '/api/orders', { type: 'takeaway' }, waiter);
    assert.equal((await call('POST', `/api/orders/${t.body.id}/qr`, {}, waiter)).status, 400);
  });

  test('public info and menu need no login and never leak costs', async () => {
    const info = await pub('GET', token, '');
    assert.equal(info.status, 200);
    assert.equal(info.body.table, 'A01');
    assert.equal(info.body.autoConfirm, true);
    const menu = await pub('GET', token, '/menu');
    assert.equal(menu.status, 200);
    assert.ok(menu.body.items.length > 5);
    assert.ok(menu.body.items.every((i: any) => i.cost === undefined && i.active === undefined));
    assert.ok(!menu.body.items.some((i: any) => i.id === hidden), 'inactive items hidden');
    assert.equal((await call('GET', '/api/orders')).status, 401);
  });

  test('bad or unknown tokens are not found', async () => {
    assert.equal((await pub('GET', 'x'.repeat(32), '')).status, 404);
    assert.equal((await pub('GET', 'short', '')).status, 404);
    assert.equal((await pub('GET', "a'b".padEnd(32, 'c'), '/menu')).status, 404);
  });

  test('auto-confirm: customer order goes straight to the kitchen at server prices', async () => {
    const bad = await pub('POST', token, '/orders', { items: [{ menuItemId: pho, qty: 1 }] });
    assert.equal(bad.status, 400, 'required size missing');
    const r = await pub('POST', token, '/orders', {
      items: [
        { menuItemId: pho, qty: 2, options: [{ group: 'ຂະໜາດ', name: 'ໃຫຍ່', price: 1 }], price: 1 },
        { menuItemId: rice, qty: 1, note: 'ໃສ່ຖົງ' },
      ],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.awaiting, false);
    const o = await staffOrder();
    assert.equal(o.total, 2 * 45000 + 5000);
    assert.ok(o.items.every((i: any) => i.source === 'customer' && i.created_by === null));
    assert.deepEqual((await kitchenNames()).sort(), ['ເຂົ້າໜຽວ', 'ເຝີຊີ້ນງົວ'].sort());

    const mine = await pub('GET', token, '/orders');
    assert.equal(mine.body.items.length, 2);
    assert.equal(mine.body.totals.total, 95000);
    assert.equal(mine.body.items[0].state, 'pending');
    assert.equal(mine.body.items[0].cost, undefined);
  });

  test('input limits', async () => {
    assert.equal((await pub('POST', token, '/orders', { items: [] })).status, 400);
    assert.equal((await pub('POST', token, '/orders', { items: [{ menuItemId: rice, qty: 0 }] })).status, 400);
    assert.equal((await pub('POST', token, '/orders', { items: [{ menuItemId: rice, qty: 21 }] })).status, 400);
    assert.equal((await pub('POST', token, '/orders', { items: [{ menuItemId: 99999, qty: 1 }] })).status, 404);
    assert.equal((await pub('POST', token, '/orders', { items: [{ menuItemId: hidden, qty: 1 }] })).status, 409);
    assert.equal((await pub('POST', token, '/orders', { items: Array.from({ length: 21 }, () => ({ menuItemId: rice })) })).status, 400);
  });

  test('approval mode: items wait, are not billed, and block payment until staff decide', async () => {
    assert.equal((await call('PUT', '/api/settings', { qr_auto_confirm: false }, admin)).status, 200);
    assert.equal((await pub('GET', token, '')).body.autoConfirm, false);
    const before = (await staffOrder()).total;

    const r = await pub('POST', token, '/orders', { items: [{ menuItemId: rice, qty: 2 }] });
    assert.equal(r.body.awaiting, true);
    const r2 = await pub('POST', token, '/orders', { items: [{ menuItemId: rice, qty: 1 }] });
    assert.equal(r2.status, 201);

    assert.equal((await staffOrder()).total, before, 'awaiting items not billed');
    assert.ok(!(await call('GET', '/api/kitchen', undefined, kitchen)).body.some((i: any) => i.id === r.body.itemIds[0]));
    const mine = await pub('GET', token, '/orders');
    assert.equal(mine.body.totals.awaiting, 15000);
    assert.equal(mine.body.items.at(-1).state, 'awaiting');

    const alerts = (await call('GET', '/api/qr/alerts', undefined, waiter)).body;
    assert.equal(alerts.awaiting[0].n, 3, 'counts quantities (2 + 1), matching the banner');
    const floor = (await call('GET', '/api/floor', undefined, waiter)).body.tables.find((t: any) => t.order_id === orderId);
    assert.equal(floor.awaiting_count, 3);
    assert.equal((await pub('GET', token, '/orders')).body.autoConfirm, false);
    assert.equal(floor.has_qr, 1);

    const pay = await call('POST', `/api/orders/${orderId}/pay`, { payments: [{ method: 'cash', amount: 100000 }] }, admin);
    assert.equal(pay.status, 409);
    assert.match(pay.body.error, /ລໍຖ້າຢືນຢັນ/);

    assert.equal((await call('POST', `/api/orders/${orderId}/approve`, { itemIds: r.body.itemIds }, kitchen)).status, 403);
    const ok = await call('POST', `/api/orders/${orderId}/approve`, { itemIds: r.body.itemIds }, waiter);
    assert.equal(ok.body.approved, 1);
    assert.equal((await staffOrder()).total, before + 10000);
    assert.ok((await call('GET', '/api/kitchen', undefined, kitchen)).body.some((i: any) => i.id === r.body.itemIds[0]));

    const no = await call('POST', `/api/orders/${orderId}/reject`, { reason: 'ເຂົ້າໜຽວໝົດ' }, waiter);
    assert.equal(no.body.rejected, 1);
    const o = await staffOrder();
    assert.equal(o.total, before + 10000);
    const rej = o.items.find((i: any) => i.id === r2.body.itemIds[0]);
    assert.equal(rej.status, 'cancelled');
    assert.equal(rej.cancel_reason, 'ເຂົ້າໜຽວໝົດ');
    const view = await pub('GET', token, '/orders');
    assert.equal(view.body.items.find((i: any) => i.id === r2.body.itemIds[0]).reason, 'ເຂົ້າໜຽວໝົດ');
    assert.equal(view.body.totals.awaiting, 0);
    assert.equal((await call('GET', '/api/qr/alerts', undefined, waiter)).body.awaiting.length, 0);
  });

  test('customers can call a waiter or ask for the bill', async () => {
    const w = await pub('POST', token, '/call', { type: 'waiter' });
    assert.equal(w.status, 201);
    assert.equal((await pub('POST', token, '/call', { type: 'waiter' })).body.duplicate, true);
    assert.equal((await pub('POST', token, '/call', { type: 'bill' })).status, 201);
    assert.equal((await pub('POST', token, '/call', { type: 'hack' })).status, 400);
    assert.deepEqual((await pub('GET', token, '/orders')).body.pendingCalls.sort(), ['bill', 'waiter']);

    const alerts = (await call('GET', '/api/qr/alerts', undefined, waiter)).body;
    assert.equal(alerts.calls.length, 2);
    assert.equal(alerts.calls[0].table_name, 'A01');
    assert.equal((await call('POST', `/api/qr/calls/${alerts.calls[0].id}/handle`, {}, waiter)).status, 204);
    assert.equal((await call('POST', `/api/qr/calls/${alerts.calls[0].id}/handle`, {}, waiter)).status, 404);
    assert.equal((await call('GET', '/api/qr/alerts', undefined, waiter)).body.calls.length, 1);
  });

  test('a new QR invalidates the old one; revoking removes access', async () => {
    const fresh = await call('POST', `/api/orders/${orderId}/qr`, { durationHours: 2 }, waiter);
    assert.equal(fresh.status, 201);
    assert.notEqual(fresh.body.token, token);
    assert.ok(fresh.body.expiresAt);
    assert.equal((await pub('GET', token, '')).status, 404);
    token = fresh.body.token;
    assert.equal((await pub('GET', token, '')).status, 200);
  });

  test('expired QR is closed', async () => {
    db.run('UPDATE orders SET qr_expires_at = ? WHERE id = ?', new Date(Date.now() - 1000).toISOString(), orderId);
    const r = await pub('GET', token, '/menu');
    assert.equal(r.status, 410);
    assert.equal(r.body.reason, 'expired');
    assert.equal((await pub('POST', token, '/orders', { items: [{ menuItemId: rice }] })).status, 410);
    db.run('UPDATE orders SET qr_expires_at = NULL WHERE id = ?', orderId);
    assert.equal((await pub('GET', token, '')).status, 200);
  });

  test('paying closes the customer session', async () => {
    const pay = await call('POST', `/api/orders/${orderId}/pay`, { payments: [{ method: 'cash', amount: 200000 }] }, admin);
    assert.equal(pay.status, 200, JSON.stringify(pay.body));
    const r = await pub('GET', token, '/orders');
    assert.equal(r.status, 410);
    assert.equal(r.body.reason, 'paid');
    assert.equal((await pub('POST', token, '/orders', { items: [{ menuItemId: rice }] })).status, 410);
    assert.equal((await pub('POST', token, '/call', { type: 'waiter' })).status, 410);
  });

  test('QR ordering can be switched off for the branch', async () => {
    const tables = (await call('GET', '/api/tables', undefined, admin)).body;
    const o = await call('POST', '/api/orders', { type: 'dine_in', tableId: tables[1].id, withQr: true }, waiter);
    const t = o.body.qr_token;
    await call('PUT', '/api/settings', { qr_enabled: false }, admin);
    assert.equal((await pub('GET', t, '/menu')).status, 403);
    assert.equal((await pub('POST', t, '/orders', { items: [{ menuItemId: rice }] })).status, 403);
    assert.equal((await pub('GET', t, '')).body.canOrder, false);
    await call('PUT', '/api/settings', { qr_enabled: true }, admin);
    assert.equal((await pub('GET', t, '/menu')).status, 200);

    // revoked by staff
    assert.equal((await call('DELETE', `/api/orders/${o.body.id}/qr`, undefined, waiter)).status, 204);
    assert.equal((await pub('GET', t, '')).status, 404);
  });

  test('order submissions are rate limited per QR', async () => {
    const tables = (await call('GET', '/api/tables', undefined, admin)).body;
    const o = await call('POST', '/api/orders', { type: 'dine_in', tableId: tables[2].id, withQr: true }, waiter);
    const t = o.body.qr_token;
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await pub('POST', t, '/orders', { items: [{ menuItemId: rice }] })).status;
    assert.equal(last, 429);
  });

  test('public URL setting is validated and trimmed', async () => {
    assert.equal((await call('PUT', '/api/settings', { public_url: 'ftp://x' }, admin)).status, 400);
    assert.equal((await call('PUT', '/api/settings', { public_url: 'javascript:alert(1)' }, admin)).status, 400);
    const ok = await call('PUT', '/api/settings', { public_url: 'http://192.168.1.10:4000/' }, admin);
    assert.equal(ok.body.branch.public_url, 'http://192.168.1.10:4000');
    const s = await call('GET', '/api/settings', undefined, admin);
    assert.ok(Array.isArray(s.body.lanUrls));
  });
});
