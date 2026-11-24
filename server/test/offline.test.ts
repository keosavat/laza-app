import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { seedIfEmpty, DEMO_USERS } from '../src/seed.ts';

const PW = DEMO_USERS[0].password;
let base = '';
let close: () => void;

async function call(method: string, url: string, body?: unknown, token?: string, key?: string) {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(key ? { 'idempotency-key': key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, replay: res.headers.get('x-idempotent-replay') };
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

describe('replaying requests queued while offline', () => {
  test('the same Idempotency-Key never orders or changes anything twice', async () => {
    const waiter = await login('waiter');
    const other = await login('cashier');
    await call('POST', '/api/shifts/open', { openingCash: 0 }, await login('admin'));
    const items = (await call('GET', '/api/menu-items', undefined, waiter)).body;
    const dish = items.find((i: any) => !i.options.length).id;
    const tables = (await call('GET', '/api/tables', undefined, waiter)).body;
    const id = (await call('POST', '/api/orders', { type: 'dine_in', tableId: tables[0].id }, waiter)).body.id;
    const add = { items: [{ menuItemId: dish, qty: 2 }], print: false };

    const first = await call('POST', `/api/orders/${id}/items`, add, waiter, 'key-1');
    assert.equal(first.status, 201);
    assert.equal(first.replay, null);
    const again = await call('POST', `/api/orders/${id}/items`, add, waiter, 'key-1');
    assert.equal(again.status, 201);
    assert.equal(again.replay, '1');
    assert.deepEqual(again.body.itemIds, first.body.itemIds);
    assert.equal((await call('GET', `/api/orders/${id}`, undefined, waiter)).body.items.length, 1, 'only one line was added');

    // a different key is a new request; no key = normal behaviour
    await call('POST', `/api/orders/${id}/items`, add, waiter, 'key-2');
    await call('POST', `/api/orders/${id}/items`, add, waiter);
    assert.equal((await call('GET', `/api/orders/${id}`, undefined, waiter)).body.items.length, 3);

    // keys are per user: another user reusing the key is not served someone else's reply
    const o2 = (await call('POST', '/api/orders', { type: 'takeaway' }, other)).body.id;
    const r = await call('POST', `/api/orders/${o2}/items`, add, other, 'key-1');
    assert.equal(r.replay, null);
    assert.equal(r.status, 201);
  });

  test('a rejected request is remembered too, so a replay gets the same answer', async () => {
    const waiter = await login('waiter');
    const r1 = await call('POST', '/api/orders/999999/items', { items: [] }, waiter, 'bad-1');
    const r2 = await call('POST', '/api/orders/999999/items', { items: [] }, waiter, 'bad-1');
    assert.equal(r1.status, r2.status);
    assert.equal(r2.replay, '1');
  });
});
