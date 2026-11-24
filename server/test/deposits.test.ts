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

const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);

describe('bottle/crate deposits', () => {
  let admin = '';
  let cashier = '';
  let waiter = '';
  let cust = 0;
  let crate = 0;
  let bottle = 0;
  const drawer = async () => (await call('GET', '/api/shifts/current', undefined, admin)).body.summary.expectedCash as number;

  test('kinds are managed by admin; deposits need an open shift', async () => {
    admin = await login('admin');
    cashier = await login('cashier');
    waiter = await login('waiter');
    cust = (await call('POST', '/api/customers', { name: 'ທ້າວ ຄຳ', phone: '020321' }, cashier)).body.id;
    assert.equal((await call('POST', '/api/deposit-kinds', { name: 'ຄັງເບຍ', amount: 50000 }, cashier)).status, 403);
    const k = await call('POST', '/api/deposit-kinds', { name: 'ຄັງເບຍ', amount: 50000 }, admin);
    assert.equal(k.status, 201, JSON.stringify(k.body));
    crate = k.body.id;
    bottle = (await call('POST', '/api/deposit-kinds', { name: 'ຂວດ', amount: 1000 }, admin)).body.id;
    assert.equal((await call('POST', '/api/deposit-kinds', { name: 'ຄັງເບຍ', amount: 1 }, admin)).status, 400, 'duplicate name');
    assert.equal((await call('POST', '/api/deposit-kinds', { name: 'x', amount: 0 }, admin)).status, 400);
    const noShift = await call('POST', '/api/deposits/take', { customerId: cust, kindId: crate, qty: 1 }, cashier);
    assert.equal(noShift.status, 409, 'no open shift');
    await call('POST', '/api/shifts/open', { openingCash: 100000 }, admin);
  });

  test('taking deposits puts cash in the drawer, but is not sales', async () => {
    assert.equal((await call('POST', '/api/deposits/take', { customerId: cust, kindId: crate, qty: 2 }, waiter)).status, 403, 'waiter cannot take money');
    const before = await drawer();
    const t = await call('POST', '/api/deposits/take', { customerId: cust, kindId: crate, qty: 2 }, cashier);
    assert.equal(t.status, 201, JSON.stringify(t.body));
    assert.equal(t.body.qty, 2);
    assert.equal(t.body.amount, 100000);
    assert.equal(await drawer(), before + 100000);
    const sum = (await call('GET', '/api/shifts/current', undefined, admin)).body.summary;
    assert.equal(sum.salesTotal, 0, 'deposits are not sales');
    assert.equal(sum.depositCash, 100000);
    // a transfer does not touch the drawer
    await call('POST', '/api/deposits/take', { customerId: cust, kindId: bottle, qty: 24, method: 'transfer' }, cashier);
    assert.equal(await drawer(), before + 100000);
    assert.equal((await call('POST', '/api/deposits/take', { customerId: cust, kindId: crate, qty: 0 }, cashier)).status, 400);
    assert.equal((await call('POST', '/api/deposits/take', { customerId: cust, kindId: 9999, qty: 1 }, cashier)).status, 404);
  });

  test('returns refund what was paid, never more than is held', async () => {
    const d = (await call('GET', '/api/deposits', undefined, cashier)).body;
    assert.equal(d.rows.length, 2);
    assert.equal(d.totalHeld, 100000 + 24000);
    const before = await drawer();
    assert.equal((await call('POST', '/api/deposits/return', { customerId: cust, kindId: crate, qty: 3 }, cashier)).status, 400, 'only 2 out');
    const r = await call('POST', '/api/deposits/return', { customerId: cust, kindId: crate, qty: 1 }, cashier);
    assert.equal(r.body.refunded, 50000);
    assert.equal(r.body.qty, 1);
    assert.equal(await drawer(), before - 50000, 'refund leaves the drawer');
    // price changes later; the refund still follows what the customer paid
    await call('PUT', `/api/deposit-kinds/${crate}`, { amount: 80000 }, admin);
    const last = await call('POST', '/api/deposits/return', { customerId: cust, kindId: crate, qty: 1 }, cashier);
    assert.equal(last.body.refunded, 50000);
    assert.equal(last.body.qty, 0);
    // bottles: 24 @1,000 paid by transfer; refunds are paid in cash, uneven split rounds but the last return clears the balance
    const a = await call('POST', '/api/deposits/return', { customerId: cust, kindId: bottle, qty: 10 }, cashier);
    assert.equal(a.body.refunded, 10000);
    const b = await call('POST', '/api/deposits/return', { customerId: cust, kindId: bottle, qty: 14 }, cashier);
    assert.equal(b.body.refunded, 14000);
    assert.equal((await call('GET', '/api/deposits', undefined, cashier)).body.rows.length, 0);
    const hist = (await call('GET', `/api/deposits/customer/${cust}`, undefined, cashier)).body;
    assert.equal(hist.length, 6);
    assert.equal(hist.reduce((s: number, e: any) => s + e.amount, 0), 0, 'ledger nets to zero');
  });

  test('a customer with deposits is deactivated, not deleted', async () => {
    const r = await call('DELETE', `/api/customers/${cust}`, undefined, admin);
    assert.equal(r.body.deactivated, true);
    assert.equal((await call('POST', '/api/deposits/take', { customerId: cust, kindId: crate, qty: 1 }, cashier)).status, 400, 'inactive customer');
    const k = await call('DELETE', `/api/deposit-kinds/${crate}`, undefined, admin);
    assert.equal(k.body.deactivated, true);
  });
});

describe('beer stored for customers', () => {
  let admin = '';
  let cashier = '';
  let cust = 0;
  let other = 0;
  const today = () => new Date().toISOString().slice(0, 10);

  test('store, case-insensitive item names, balances per customer', async () => {
    admin = await login('admin');
    cashier = await login('cashier');
    cust = (await call('POST', '/api/customers', { name: 'ນາງ ມະນີ' }, cashier)).body.id;
    other = (await call('POST', '/api/customers', { name: 'ທ້າວ ສົມ' }, cashier)).body.id;
    const a = await call('POST', '/api/beer-storage/store', { customerId: cust, item: 'ເບຍລາວ ຂວດໃຫຍ່', qty: 6, expiresOn: addDays(today(), 10) }, cashier);
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal(a.body.qty, 6);
    const b = await call('POST', '/api/beer-storage/store', { customerId: cust, item: 'ເບຍລາວ ຂວດໃຫຍ່', qty: 4, expiresOn: addDays(today(), 3) }, cashier);
    assert.equal(b.body.qty, 10);
    await call('POST', '/api/beer-storage/store', { customerId: other, item: 'Tiger', qty: 12 }, cashier);
    const list = (await call('GET', '/api/beer-storage', undefined, cashier)).body;
    assert.equal(list.rows.length, 2);
    assert.equal(list.totalQty, 22);
    assert.equal((await call('POST', '/api/beer-storage/store', { customerId: cust, item: '', qty: 1 }, cashier)).status, 400);
    assert.equal((await call('POST', '/api/beer-storage/store', { customerId: cust, item: 'x', qty: 0 }, cashier)).status, 400);
    assert.equal((await call('POST', '/api/beer-storage/store', { customerId: cust, item: 'x', qty: 1, expiresOn: addDays(today(), -3) }, cashier)).status, 400, 'already expired');
  });

  test('withdraw uses the oldest batch first, so the expiry follows what is left', async () => {
    const w = await call('POST', '/api/beer-storage/withdraw', { customerId: cust, item: 'ເບຍລາວ ຂວດໃຫຍ່', qty: 6 }, cashier);
    assert.equal(w.body.qty, 4);
    const row = (await call('GET', '/api/beer-storage', undefined, cashier)).body.rows.find((x: any) => x.customer_id === cust);
    assert.equal(row.next_expiry, addDays(today(), 3), 'only the second batch is left');
    assert.equal((await call('POST', '/api/beer-storage/withdraw', { customerId: cust, item: 'ເບຍລາວ ຂວດໃຫຍ່', qty: 5 }, cashier)).status, 400, 'more than stored');
    assert.equal((await call('POST', '/api/beer-storage/withdraw', { customerId: cust, item: 'Tiger', qty: 1 }, cashier)).status, 400, 'not theirs');
    assert.equal((await call('POST', '/api/beer-storage/withdraw', { customerId: other, item: 'tiger', qty: 12 }, cashier)).body.qty, 0);
    assert.equal((await call('GET', '/api/beer-storage', undefined, cashier)).body.rows.length, 1, 'empty balances disappear');
  });

  test('discard is admin only; history is kept', async () => {
    assert.equal((await call('POST', '/api/beer-storage/discard', { customerId: cust, item: 'ເບຍລາວ ຂວດໃຫຍ່', qty: 1 }, cashier)).status, 403);
    const d = await call('POST', '/api/beer-storage/discard', { customerId: cust, item: 'ເບຍລາວ ຂວດໃຫຍ່', qty: 1, note: 'ໝົດອາຍຸ' }, admin);
    assert.equal(d.body.qty, 3);
    const c = (await call('GET', `/api/beer-storage/customer/${cust}`, undefined, cashier)).body;
    assert.equal(c.balances[0].qty, 3);
    assert.deepEqual(c.history.map((h: any) => h.type), ['discard', 'withdraw', 'store', 'store']);
    assert.equal((await call('DELETE', `/api/customers/${cust}`, undefined, admin)).body.deactivated, true);
  });
});
