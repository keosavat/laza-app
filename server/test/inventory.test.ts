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

describe('inventory, recipes and stock deduction', () => {
  let admin = '';
  let waiter = '';
  let beef = 0;
  let noodle = 0;
  let pho = 0;
  let rice = 0;
  let tableId = 0;
  const stockOf = async (id: number) => (await call('GET', '/api/ingredients', undefined, admin)).body.find((i: any) => i.id === id);

  test('setup: only admins manage ingredients; stock-in averages the cost', async () => {
    admin = await login('admin');
    waiter = await login('waiter');
    assert.equal((await call('POST', '/api/ingredients', { name: 'x' }, waiter)).status, 403);
    assert.equal((await call('POST', '/api/ingredients', { name: '', unit: 'g' }, admin)).status, 400);

    beef = (await call('POST', '/api/ingredients', { name: 'ຊີ້ນງົວ', unit: 'ກຣາມ', cost: 100, stock: 1000, lowAt: 200 }, admin)).body.id;
    noodle = (await call('POST', '/api/ingredients', { name: 'ເສັ້ນເຝີ', unit: 'ກຣາມ', cost: 20, lowAt: 100 }, admin)).body.id;
    assert.equal((await stockOf(beef)).stock, 1000);

    // buy 1000 more at 200 → average cost 150
    const r = await call('POST', `/api/ingredients/${beef}/stock`, { type: 'in', qty: 1000, unitCost: 200, note: 'ຕະຫຼາດ' }, admin);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.balance, 2000);
    assert.equal((await stockOf(beef)).cost, 150);
    assert.equal((await call('POST', `/api/ingredients/${beef}/stock`, { type: 'in', qty: -5 }, admin)).status, 400);
    assert.equal((await call('POST', `/api/ingredients/${beef}/stock`, { type: 'bogus', qty: 5 }, admin)).status, 400);
  });

  test('adjust sets the counted amount; waste removes; both are logged', async () => {
    await call('POST', `/api/ingredients/${beef}/stock`, { type: 'adjust', qty: 1900, note: 'ນັບສະຕັອກ' }, admin);
    assert.equal((await stockOf(beef)).stock, 1900);
    await call('POST', `/api/ingredients/${beef}/stock`, { type: 'waste', qty: 100, note: 'ເສຍ' }, admin);
    assert.equal((await stockOf(beef)).stock, 1800);
    const moves = (await call('GET', `/api/stock/moves?ingredientId=${beef}`, undefined, admin)).body;
    assert.deepEqual(moves.map((m: any) => [m.type, m.qty, m.balance]).reverse(), [
      ['adjust', 1000, 1000],
      ['in', 1000, 2000],
      ['adjust', -100, 1900],
      ['waste', -100, 1800],
    ]);
  });

  test('recipe: cost follows ingredient costs; validation', async () => {
    const items = (await call('GET', '/api/menu-items', undefined, admin)).body;
    pho = items.find((i: any) => i.name === 'ເຝີຊີ້ນງົວ').id;
    rice = items.find((i: any) => i.name === 'ເຂົ້າໜຽວ').id;
    assert.equal(items.find((i: any) => i.id === pho).portions, null, 'no recipe yet → not tracked');

    assert.equal((await call('PUT', `/api/menu-items/${pho}/recipe`, { lines: [{ ingredientId: beef, qty: 0 }] }, admin)).status, 400);
    assert.equal((await call('PUT', `/api/menu-items/${pho}/recipe`, { lines: [{ ingredientId: beef, qty: 1 }, { ingredientId: beef, qty: 2 }] }, admin)).status, 400, 'duplicate ingredient');
    assert.equal((await call('PUT', `/api/menu-items/${pho}/recipe`, { lines: [{ ingredientId: 9999, qty: 1 }] }, admin)).status, 400);
    assert.equal((await call('PUT', `/api/menu-items/${pho}/recipe`, { lines: [] }, waiter)).status, 403);

    const ok = await call('PUT', `/api/menu-items/${pho}/recipe`, { lines: [{ ingredientId: beef, qty: 150 }, { ingredientId: noodle, qty: 100 }], costFromRecipe: true }, admin);
    assert.equal(ok.status, 200);
    const rec = (await call('GET', `/api/menu-items/${pho}/recipe`, undefined, admin)).body;
    assert.equal(rec.recipeCost, 150 * 150 + 100 * 20); // 22,500 + 2,000
    assert.equal(rec.item.cost, 24500, 'menu cost synced from the recipe');

    // change an ingredient price → linked menu cost follows
    await call('PUT', `/api/ingredients/${noodle}`, { cost: 30 }, admin);
    assert.equal((await call('GET', `/api/menu-items/${pho}/recipe`, undefined, admin)).body.item.cost, 25500);

    // sticky rice is tracked directly: 1 portion = 1 unit, and starts empty
    const sticky = (await call('POST', '/api/ingredients', { name: 'ເຂົ້າໜຽວ (ຈານ)', unit: 'ຈານ', cost: 1500, stock: 0 }, admin)).body.id;
    await call('PUT', `/api/menu-items/${rice}/recipe`, { lines: [{ ingredientId: sticky, qty: 1 }] }, admin);
    const list = (await call('GET', '/api/menu-items', undefined, admin)).body;
    assert.equal(list.find((i: any) => i.id === pho).portions, 0, 'noodles are out (0 stock)');
    assert.equal(list.find((i: any) => i.id === rice).portions, 0);
  });

  test('sold out: customers (QR) are refused, staff may still sell', async () => {
    await call('POST', '/api/shifts/open', { openingCash: 0 }, admin);
    tableId = (await call('GET', '/api/tables', undefined, admin)).body[0].id;
    const o = (await call('POST', '/api/orders', { type: 'dine_in', tableId, withQr: true }, waiter)).body;
    const menu = (await call('GET', `/api/public/qr/${o.qr_token}/menu`)).body;
    assert.equal(menu.items.find((i: any) => i.id === pho).soldOut, true);
    assert.equal(menu.items.find((i: any) => i.name === 'ລາບໄກ່').soldOut, false);
    const c = await call('POST', `/api/public/qr/${o.qr_token}/orders`, { items: [{ menuItemId: pho, qty: 1, options: [{ group: 'ຂະໜາດ', name: 'ກາງ' }] }] });
    assert.equal(c.status, 409);
    assert.match(c.body.error, /ໝົດ/);
    // staff can sell anyway (stock may simply not be updated yet)
    const s = await call('POST', `/api/orders/${o.id}/items`, { items: [{ menuItemId: pho, qty: 1, options: [{ group: 'ຂະໜາດ', name: 'ກາງ' }] }] }, waiter);
    assert.equal(s.status, 201);
    await call('POST', `/api/orders/${o.id}/cancel`, { reason: 'ທົດສອບ' }, admin);
  });

  let orderId = 0;
  test('paying deducts ingredients once; cancelled lines are not deducted', async () => {
    await call('POST', `/api/ingredients/${noodle}/stock`, { type: 'adjust', qty: 1000 }, admin);
    const o = (await call('POST', '/api/orders', { type: 'dine_in', tableId }, waiter)).body;
    orderId = o.id;
    const add = await call('POST', `/api/orders/${o.id}/items`, { items: [{ menuItemId: pho, qty: 2, options: [{ group: 'ຂະໜາດ', name: 'ກາງ' }] }, { menuItemId: pho, qty: 5, options: [{ group: 'ຂະໜາດ', name: 'ໃຫຍ່' }] }] }, waiter);
    assert.equal(add.status, 201, JSON.stringify(add.body));
    // cancel the 5-portion line: it must not use stock
    await call('POST', `/api/orders/${o.id}/items/cancel`, { itemIds: [add.body.itemIds[1]], reason: 'ຜິດ' }, admin);

    const before = { beef: (await stockOf(beef)).stock, noodle: (await stockOf(noodle)).stock };
    assert.equal((await call('POST', `/api/orders/${o.id}/pay`, { payments: [{ method: 'cash', amount: 1000000 }] }, admin)).status, 200);
    assert.equal((await stockOf(beef)).stock, before.beef - 2 * 150);
    assert.equal((await stockOf(noodle)).stock, before.noodle - 2 * 100);

    const moves = (await call('GET', `/api/stock/moves?ingredientId=${beef}`, undefined, admin)).body;
    assert.equal(moves[0].type, 'sale');
    assert.equal(moves[0].qty, -300);
    assert.match(moves[0].note, /ອໍເດີ #/);
    // paying again is refused, so stock cannot be deducted twice
    assert.equal((await call('POST', `/api/orders/${orderId}/pay`, { payments: [{ method: 'cash', amount: 1000000 }] }, admin)).status, 409);
    assert.equal((await stockOf(beef)).stock, before.beef - 300);
  });

  test('low stock summary and portions', async () => {
    await call('POST', `/api/ingredients/${beef}/stock`, { type: 'adjust', qty: 250 }, admin); // > lowAt 200
    assert.equal((await call('GET', '/api/inventory/summary', undefined, waiter)).body.lowCount, 1, 'sticky-rice ingredient is empty (lowAt 0 → counts as out)');
    await call('POST', `/api/ingredients/${beef}/stock`, { type: 'adjust', qty: 150 }, admin);
    const s = (await call('GET', '/api/inventory/summary', undefined, waiter)).body;
    assert.ok(s.low.some((i: any) => i.name === 'ຊີ້ນງົວ'));
    assert.ok(s.stockValue > 0);
    const list = (await call('GET', '/api/menu-items', undefined, admin)).body;
    assert.equal(list.find((i: any) => i.id === pho).portions, 1, '150g beef → 1 portion at 150g each');
  });

  test('deleting: refused while in a recipe; used ingredients are deactivated, unused deleted', async () => {
    assert.equal((await call('DELETE', `/api/ingredients/${beef}`, undefined, admin)).status, 400);
    const tmp = (await call('POST', '/api/ingredients', { name: 'ຊົ່ວຄາວ', unit: 'ອັນ' }, admin)).body.id;
    assert.deepEqual((await call('DELETE', `/api/ingredients/${tmp}`, undefined, admin)).body, { deleted: true, deactivated: false });
    const used = (await call('POST', '/api/ingredients', { name: 'ໃຊ້ແລ້ວ', unit: 'ອັນ', stock: 5 }, admin)).body.id;
    assert.deepEqual((await call('DELETE', `/api/ingredients/${used}`, undefined, admin)).body, { deleted: false, deactivated: true });
  });
});
