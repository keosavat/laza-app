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

describe('bulk actions on order lines', () => {
  let admin = '';
  let waiter = '';
  let a = 0; // order with 3 lines
  let b = 0; // another order
  let ids: number[] = [];
  let otherId = 0;

  test('set up two orders', async () => {
    admin = await login('admin');
    waiter = await login('waiter');
    await call('POST', '/api/shifts/open', { openingCash: 0 }, admin);
    const items = (await call('GET', '/api/menu-items', undefined, admin)).body;
    const rice = items.find((i: any) => i.name === 'ເຂົ້າໜຽວ').id;
    const tables = (await call('GET', '/api/tables', undefined, admin)).body;
    a = (await call('POST', '/api/orders', { type: 'dine_in', tableId: tables[0].id }, waiter)).body.id;
    b = (await call('POST', '/api/orders', { type: 'dine_in', tableId: tables[1].id }, waiter)).body.id;
    const r = await call('POST', `/api/orders/${a}/items`, { items: [{ menuItemId: rice, qty: 1 }, { menuItemId: rice, qty: 2, note: 'x' }, { menuItemId: rice, qty: 3, note: 'y' }] }, waiter);
    ids = r.body.itemIds;
    otherId = (await call('POST', `/api/orders/${b}/items`, { items: [{ menuItemId: rice }] }, waiter)).body.itemIds[0];
    assert.equal(ids.length, 3);
  });

  test('change status of several lines at once (waiter allowed)', async () => {
    const r = await call('POST', `/api/orders/${a}/items/status`, { itemIds: [ids[0], ids[1]], status: 'served' }, waiter);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const st = r.body.items.map((i: any) => i.status);
    assert.deepEqual(st, ['served', 'served', 'pending']);
    assert.equal((await call('POST', `/api/orders/${a}/items/status`, { itemIds: [ids[2]], status: 'bogus' }, waiter)).status, 400);
    assert.equal((await call('POST', `/api/orders/${a}/items/status`, { itemIds: [], status: 'ready' }, waiter)).status, 400);
  });

  test('cannot touch lines of another order or unknown lines', async () => {
    assert.equal((await call('POST', `/api/orders/${a}/items/status`, { itemIds: [ids[0], otherId], status: 'ready' }, waiter)).status, 404);
    assert.equal((await call('POST', `/api/orders/${a}/items/status`, { itemIds: [99999], status: 'ready' }, waiter)).status, 404);
    // nothing changed for the valid id in the failed batch
    const o = (await call('GET', `/api/orders/${a}`, undefined, admin)).body;
    assert.equal(o.items[0].status, 'served');
  });

  test('bulk cancel needs manager and a reason, and updates the total', async () => {
    assert.equal((await call('POST', `/api/orders/${a}/items/cancel`, { itemIds: [ids[0]], reason: 'x' }, waiter)).status, 403);
    assert.equal((await call('POST', `/api/orders/${a}/items/cancel`, { itemIds: [ids[0]] }, admin)).status, 400);
    const r = await call('POST', `/api/orders/${a}/items/cancel`, { itemIds: [ids[0], ids[2]], reason: 'ສັ່ງຜິດ' }, admin);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.total, 2 * 5000);
    assert.equal(r.body.items.filter((i: any) => i.status === 'cancelled' && i.cancel_reason === 'ສັ່ງຜິດ').length, 2);
    // already cancelled lines are rejected
    assert.equal((await call('POST', `/api/orders/${a}/items/cancel`, { itemIds: [ids[0]], reason: 'again' }, admin)).status, 409);
    assert.equal((await call('POST', `/api/orders/${a}/items/status`, { itemIds: [ids[2]], status: 'ready' }, waiter)).status, 409);
  });

  test('closed orders reject bulk changes', async () => {
    const pay = await call('POST', `/api/orders/${a}/pay`, { payments: [{ method: 'cash', amount: 10000 }] }, admin);
    assert.equal(pay.status, 200, JSON.stringify(pay.body));
    assert.equal((await call('POST', `/api/orders/${a}/items/status`, { itemIds: [ids[1]], status: 'ready' }, waiter)).status, 409);
  });
});
