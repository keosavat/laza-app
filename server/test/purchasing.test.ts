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

describe('suppliers and purchase orders', () => {
  let admin = '';
  let cashier = '';
  let sup = 0;
  let flour = 0;
  let oil = 0;
  let po = 0;
  const stockOf = async (id: number) => (await call('GET', '/api/ingredients', undefined, admin)).body.find((i: any) => i.id === id);

  test('admin only; supplier names are unique', async () => {
    admin = await login('admin');
    cashier = await login('cashier');
    assert.equal((await call('GET', '/api/suppliers', undefined, cashier)).status, 403);
    assert.equal((await call('POST', '/api/suppliers', { name: 'x' }, cashier)).status, 403);
    const s = await call('POST', '/api/suppliers', { name: 'ຕະຫຼາດເຊົ້າ', phone: '020123', contact: 'ປ້າ ແກ້ວ' }, admin);
    assert.equal(s.status, 201, JSON.stringify(s.body));
    sup = s.body.id;
    assert.equal((await call('POST', '/api/suppliers', { name: 'ຕະຫຼາດເຊົ້າ' }, admin)).status, 400, 'duplicate name');
    assert.equal((await call('POST', '/api/suppliers', { name: '' }, admin)).status, 400);
    flour = (await call('POST', '/api/ingredients', { name: 'ແປ້ງ', unit: 'kg', cost: 10000, stock: 5, lowAt: 10, refillTo: 50, supplierId: sup }, admin)).body.id;
    oil = (await call('POST', '/api/ingredients', { name: 'ນ້ຳມັນ', unit: 'L', cost: 20000, stock: 0, lowAt: 2, refillTo: 10 }, admin)).body.id;
    assert.equal((await call('POST', '/api/ingredients', { name: 'y', unit: 'kg', supplierId: 99999 }, admin)).status, 404);
  });

  test('suggestions group low stock by supplier (none = unassigned)', async () => {
    const s = (await call('GET', '/api/purchase-orders/suggest', undefined, admin)).body;
    const mine = s.find((g: any) => g.supplierId === sup);
    assert.equal(mine.lines.find((l: any) => l.ingredientId === flour).qty, 45, 'tops 5 up to 50');
    const none = s.find((g: any) => g.supplierId === null);
    assert.ok(none.lines.some((l: any) => l.ingredientId === oil));
  });

  test('create a draft; validation; edit while draft', async () => {
    assert.equal((await call('POST', '/api/purchase-orders', { supplierId: sup, lines: [] }, admin)).status, 400);
    assert.equal((await call('POST', '/api/purchase-orders', { supplierId: sup, lines: [{ ingredientId: flour, qty: 0, unitCost: 1 }] }, admin)).status, 400);
    assert.equal((await call('POST', '/api/purchase-orders', { supplierId: sup, lines: [{ ingredientId: flour, qty: 1 }, { ingredientId: flour, qty: 2 }] }, admin)).status, 400, 'duplicate ingredient');
    const r = await call('POST', '/api/purchase-orders', { supplierId: sup, expectedOn: '2030-01-01', lines: [{ ingredientId: flour, qty: 45, unitCost: 12000 }, { ingredientId: oil, qty: 10, unitCost: 18000 }] }, admin);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    po = r.body.id;
    assert.equal(r.body.status, 'draft');
    assert.equal(r.body.po_no, 1);
    assert.equal(r.body.total, 45 * 12000 + 10 * 18000);
    const e = await call('PUT', `/api/purchase-orders/${po}`, { note: 'ສົ່ງເຊົ້າ' }, admin);
    assert.equal(e.body.note, 'ສົ່ງເຊົ້າ');
    assert.equal(e.body.lines.length, 2, 'lines untouched when not sent');
    assert.equal((await call('POST', `/api/purchase-orders/${po}/receive`, { lines: [] }, admin)).status, 409, 'cannot receive a draft');
    assert.equal((await call('POST', `/api/purchase-orders/${po}/order`, {}, admin)).body.status, 'ordered');
    assert.equal((await call('PUT', `/api/purchase-orders/${po}`, { note: 'x' }, admin)).status, 409, 'locked once ordered');
    const sg = (await call('GET', '/api/purchase-orders/suggest', undefined, admin)).body;
    assert.equal(sg.flatMap((g: any) => g.lines).length, 0, 'already on order, not suggested again');
  });

  test('partial receipt raises stock and the average cost; over-receiving is refused', async () => {
    const d = (await call('GET', `/api/purchase-orders/${po}`, undefined, admin)).body;
    const fl = d.lines.find((l: any) => l.ingredient_id === flour);
    const ol = d.lines.find((l: any) => l.ingredient_id === oil);
    assert.equal((await call('POST', `/api/purchase-orders/${po}/receive`, { lines: [{ lineId: fl.id, qty: 46 }] }, admin)).status, 400, 'more than ordered');
    assert.equal((await call('POST', `/api/purchase-orders/${po}/receive`, { lines: [{ lineId: fl.id, qty: 0 }] }, admin)).status, 400, 'nothing received');
    const r = await call('POST', `/api/purchase-orders/${po}/receive`, { invoiceNo: 'INV-77', lines: [{ lineId: fl.id, qty: 20, unitCost: 12000, lot: 'L1', expiresAt: '2030-06-01' }] }, admin);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, 'partial');
    assert.equal(r.body.invoice_no, 'INV-77');
    assert.equal(r.body.received_value, 240000);
    const f = await stockOf(flour);
    assert.equal(f.stock, 25);
    assert.equal(f.cost, 11600, 'average of 5 @10,000 and 20 @12,000');
    assert.equal((await call('POST', `/api/purchase-orders/${po}/cancel`, {}, admin)).status, 409, 'cannot cancel after receiving');

    const rest = await call('POST', `/api/purchase-orders/${po}/receive`, { lines: [{ lineId: fl.id, qty: 25 }, { lineId: ol.id, qty: 10, unitCost: 19000 }] }, admin);
    assert.equal(rest.body.status, 'received');
    assert.ok(rest.body.received_at);
    assert.equal(rest.body.received_value, 45 * 12000 + 10 * 19000, 'actual cost, not the ordered cost, for the oil');
    assert.equal((await stockOf(oil)).stock, 10);
    assert.equal((await call('POST', `/api/purchase-orders/${po}/receive`, { lines: [{ lineId: fl.id, qty: 1 }] }, admin)).status, 409);
    const moves = (await call('GET', `/api/stock/moves?ingredientId=${oil}`, undefined, admin)).body;
    assert.equal(moves[0].type, 'in');
    assert.match(moves[0].note, /PO-0001/);
  });

  test('payables: pay what was received, never more; supplier total owed', async () => {
    const d = (await call('GET', `/api/purchase-orders/${po}`, undefined, admin)).body;
    assert.equal(d.owed, 45 * 12000 + 10 * 19000);
    assert.equal((await call('POST', `/api/purchase-orders/${po}/payments`, { amount: d.owed + 1 }, admin)).status, 400);
    assert.equal((await call('POST', `/api/purchase-orders/${po}/payments`, { amount: 0 }, admin)).status, 400);
    const p = await call('POST', `/api/purchase-orders/${po}/payments`, { amount: 500000, method: 'transfer', note: 'ງວດ 1' }, admin);
    assert.equal(p.status, 201);
    assert.equal(p.body.paid, 500000);
    assert.equal(p.body.owed, d.owed - 500000);
    assert.equal(p.body.payments.length, 1);
    const s = (await call('GET', '/api/suppliers', undefined, admin)).body.find((x: any) => x.id === sup);
    assert.equal(s.owed, d.owed - 500000);
    assert.equal(s.open_orders, 0);
    assert.equal(s.ingredients, 1);
  });

  test('close a short delivery, cancel an unreceived order, deactivate a used supplier', async () => {
    const mk = async () => (await call('POST', '/api/purchase-orders', { supplierId: sup, lines: [{ ingredientId: flour, qty: 10, unitCost: 11000 }] }, admin)).body;
    const a = await mk();
    assert.equal(a.po_no, 2);
    await call('POST', `/api/purchase-orders/${a.id}/order`, {}, admin);
    const line = (await call('GET', `/api/purchase-orders/${a.id}`, undefined, admin)).body.lines[0].id;
    await call('POST', `/api/purchase-orders/${a.id}/receive`, { lines: [{ lineId: line, qty: 4 }] }, admin);
    assert.equal((await call('POST', `/api/purchase-orders/${a.id}/close`, {}, admin)).body.status, 'received', 'closed short');

    const b = await mk();
    assert.equal((await call('POST', `/api/purchase-orders/${b.id}/close`, {}, admin)).status, 409, 'nothing partial to close');
    assert.equal((await call('POST', `/api/purchase-orders/${b.id}/cancel`, {}, admin)).body.status, 'cancelled');
    assert.equal((await call('GET', '/api/purchase-orders?status=cancelled', undefined, admin)).body.length, 1);
    assert.equal((await call('GET', '/api/purchase-orders?status=open', undefined, admin)).body.length, 0);

    const del = await call('DELETE', `/api/suppliers/${sup}`, undefined, admin);
    assert.equal(del.body.deactivated, true);
    assert.equal((await call('POST', '/api/purchase-orders', { supplierId: sup, lines: [{ ingredientId: flour, qty: 1 }] }, admin)).status, 400, 'inactive supplier');
    const fresh = (await call('POST', '/api/suppliers', { name: 'ໃໝ່' }, admin)).body.id;
    assert.equal((await call('DELETE', `/api/suppliers/${fresh}`, undefined, admin)).body.deleted, true);
  });
});
