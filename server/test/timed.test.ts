import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { seedIfEmpty, DEMO_USERS } from '../src/seed.ts';
import { activeSeconds, timeCharge, type Sess } from '../src/lib/timed.ts';

const PW = DEMO_USERS[0].password;
let base = '';
let close: () => void;
let db: ReturnType<typeof createApp>['db'];

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
  db = app.db;
  seedIfEmpty(app.db);
  await new Promise<void>((ok) => app.server.listen(0, ok));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  close = () => app.server.close();
});
after(() => close());

const T0 = Date.parse('2030-01-01T10:00:00Z');
const sess = (over: Partial<Sess> = {}): Sess => ({ started_at: new Date(T0).toISOString(), ended_at: null, paused_at: null, paused_sec: 0, rate: 60000, step: 15, min_minutes: 0, ...over });
const at = (min: number, sec = 0) => T0 + min * 60_000 + sec * 1000;

describe('time charge', () => {
  test('rounds up to the billing block; nothing before any time has passed', () => {
    assert.equal(timeCharge(sess(), at(0)).charge, 0);
    assert.equal(timeCharge(sess(), at(0, 1)).charge, 15000, 'one second already costs the first block');
    assert.equal(timeCharge(sess(), at(15)).charge, 15000, 'exactly one block');
    assert.equal(timeCharge(sess(), at(15, 1)).charge, 30000, 'a second over starts the next block');
    assert.equal(timeCharge(sess(), at(90)).charge, 90000);
    assert.equal(timeCharge(sess(), at(90)).billedMin, 90);
  });

  test('minimum minutes and 1-minute billing', () => {
    assert.equal(timeCharge(sess({ min_minutes: 30 }), at(5)).charge, 30000, 'minimum of 30 minutes');
    assert.equal(timeCharge(sess({ min_minutes: 30 }), at(40)).billedMin, 45, 'above the minimum the blocks apply');
    assert.equal(timeCharge(sess({ step: 1 }), at(1, 1)).charge, 2000);
    assert.equal(timeCharge(sess({ step: 60, rate: 100000 }), at(61)).charge, 200000);
    assert.equal(timeCharge(sess({ rate: 50000, step: 10 }), at(25)).charge, Math.round((30 * 50000) / 60));
  });

  test('pauses are not counted', () => {
    assert.equal(activeSeconds(sess({ paused_sec: 600 }), at(60)), 50 * 60);
    assert.equal(activeSeconds(sess({ paused_at: new Date(at(40)).toISOString() }), at(120)), 40 * 60, 'clock stops at the pause');
    assert.equal(activeSeconds(sess({ ended_at: new Date(at(30)).toISOString() }), at(300)), 30 * 60, 'and at the end');
  });
});

describe('time-billed tables', () => {
  let owner = '';
  let manager = '';
  let cashier = '';
  let tables: any[] = [];
  let pool = 0; // time-billed
  let plain = 0;
  let order = 0;
  const agoIso = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const detail = async (id = order) => (await call('GET', `/api/orders/${id}`, undefined, cashier)).body;
  const timeLine = (o: any) => o.items.find((i: any) => i.name === 'ຄ່າເວລາ');

  test('only managers set a table up for time billing; values are validated', async () => {
    owner = await login('admin');
    manager = await login('manager');
    cashier = await login('cashier');
    await call('POST', '/api/shifts/open', { openingCash: 0 }, owner);
    tables = (await call('GET', '/api/tables', undefined, owner)).body;
    pool = tables[0].id;
    plain = tables[1].id;
    assert.equal((await call('PUT', `/api/tables/${pool}`, { ratePerHour: 60000 }, cashier)).status, 403);
    assert.equal((await call('PUT', `/api/tables/${pool}`, { ratePerHour: -1 }, owner)).status, 400);
    assert.equal((await call('PUT', `/api/tables/${pool}`, { ratePerHour: 60000, timeStep: 7 }, owner)).status, 400);
    const ok = await call('PUT', `/api/tables/${pool}`, { ratePerHour: 60000, timeStep: 15, timeMin: 0 }, owner);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.rate_per_hour, 60000);
    assert.equal(ok.body.time_step, 15);
    assert.equal((await call('PUT', `/api/tables/${pool}`, { name: 'POOL 1' }, owner)).body.rate_per_hour, 60000, 'untouched when not sent');
  });

  test('opening the table starts the clock and adds a time line that stays out of the kitchen', async () => {
    const o = await call('POST', '/api/orders', { type: 'dine_in', tableId: pool }, cashier);
    assert.equal(o.status, 201, JSON.stringify(o.body));
    order = o.body.id;
    assert.ok(o.body.timer, 'order carries its timer');
    assert.equal(o.body.timer.running, true);
    const line = timeLine(o.body);
    assert.ok(line);
    assert.equal(line.status, 'served', 'never a kitchen ticket');
    assert.equal(line.menu_item_id, null);
    const kitchen = (await call('GET', '/api/kitchen', undefined, cashier)).body;
    assert.ok(!JSON.stringify(kitchen).includes('ຄ່າເວລາ'));
    const plainOrder = (await call('POST', '/api/orders', { type: 'dine_in', tableId: plain }, cashier)).body;
    assert.equal(plainOrder.timer, null, 'ordinary tables have no clock');
    assert.equal((await call('POST', `/api/orders/${plainOrder.id}/timer/start`, {}, cashier)).status, 400, 'table is not time-billed');
    await call('POST', `/api/orders/${plainOrder.id}/cancel`, { reason: 'ທົດສອບ' }, cashier);
  });

  test('the charge follows the clock and is included in the total with other items', async () => {
    db.run('UPDATE table_sessions SET started_at = ? WHERE order_id = ?', agoIso(85), order);
    let o = await detail();
    assert.equal(timeLine(o).unit_price, 90000, '85 minutes → 90 minute block');
    assert.match(timeLine(o).note, /1:30/);
    assert.equal(o.total, 90000);
    const dish = (await call('GET', '/api/menu-items', undefined, owner)).body.find((i: any) => i.price >= 20000 && !(i.options ?? []).some((g: any) => g.required));
    await call('POST', `/api/orders/${order}/items`, { items: [{ menuItemId: dish.id, qty: 2 }], print: false }, cashier);
    o = await detail();
    assert.equal(o.total, 90000 + dish.price * 2);
    const floor = (await call('GET', '/api/floor', undefined, cashier)).body.tables.find((t: any) => t.id === pool);
    assert.equal(floor.order_total, o.total, 'floor shows the live total');
    assert.ok(floor.timer_started_at && floor.timer_rate === 60000);
  });

  test('pause freezes the charge, resume continues without counting the pause', async () => {
    assert.equal((await call('POST', `/api/orders/${order}/timer/resume`, {}, cashier)).status, 409, 'not paused');
    const p = await call('POST', `/api/orders/${order}/timer/pause`, {}, cashier);
    assert.equal(p.status, 200);
    assert.equal(p.body.paused, true);
    assert.equal((await call('POST', `/api/orders/${order}/timer/pause`, {}, cashier)).status, 409, 'already paused');
    // pretend the pause began 30 minutes after the start: 55 minutes were played in total
    db.run('UPDATE table_sessions SET paused_at = ? WHERE order_id = ?', agoIso(30), order);
    assert.equal(timeLine(await detail()).unit_price, 60000, '55 min → 60 min block, and it does not grow while paused');
    const r = await call('POST', `/api/orders/${order}/timer/resume`, {}, cashier);
    assert.equal(r.body.running, true);
    assert.ok(r.body.paused_sec >= 1799 && r.body.paused_sec <= 1802, 'the pause is excluded');
    assert.equal(timeLine(await detail()).unit_price, 60000);
  });

  test('only a manager can correct the start time, and only sensibly', async () => {
    const body = (min: number) => ({ startedAt: agoIso(min), reason: 'ລືມກົດເລີ່ມ' });
    assert.equal((await call('POST', `/api/orders/${order}/timer/adjust`, body(120), cashier)).status, 403);
    assert.equal((await call('POST', `/api/orders/${order}/timer/adjust`, { startedAt: new Date(Date.now() + 60_000).toISOString() }, manager)).status, 400, 'future');
    assert.equal((await call('POST', `/api/orders/${order}/timer/adjust`, body(25 * 60), manager)).status, 400, 'over 24h back');
    assert.equal((await call('POST', `/api/orders/${order}/timer/adjust`, { startedAt: 'nope' }, manager)).status, 400);
    db.run('UPDATE table_sessions SET paused_sec = 0 WHERE order_id = ?', order);
    const a = await call('POST', `/api/orders/${order}/timer/adjust`, body(121), manager);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(timeLine(await detail()).unit_price, 135000, '121 minutes rolls into the 2h15 block');
  });

  test('stopping freezes the charge; paying stops the clock too and the bill keeps the final amount', async () => {
    db.run('UPDATE table_sessions SET started_at = ? WHERE order_id = ?', agoIso(50), order);
    const s = await call('POST', `/api/orders/${order}/timer/stop`, {}, cashier);
    assert.equal(s.body.ended, true);
    assert.equal(s.body.charge, 60000, '50 minutes → 60 minute block');
    assert.equal(timeLine(await detail()).unit_price, 60000, 'stays the same after stopping');
    assert.equal((await call('POST', `/api/orders/${order}/timer/pause`, {}, cashier)).status, 409, 'a stopped clock cannot be paused');
    assert.equal((await call('POST', `/api/orders/${order}/timer/adjust`, { startedAt: agoIso(10) }, manager)).status, 409, 'nor edited');

    const total = (await detail()).total;
    const pay = await call('POST', `/api/orders/${order}/pay`, { payments: [{ method: 'cash', currency: 'LAK', amount: total }] }, cashier);
    assert.equal(pay.status, 200, JSON.stringify(pay.body));
    assert.equal(pay.body.total, total);
    const paid = await detail();
    assert.equal(paid.status, 'paid');
    assert.equal(timeLine(paid).unit_price, 60000);
  });

  test('paying without stopping ends the clock at that moment; cancelling closes it', async () => {
    const o = (await call('POST', '/api/orders', { type: 'dine_in', tableId: pool }, cashier)).body.id;
    db.run('UPDATE table_sessions SET started_at = ? WHERE order_id = ?', agoIso(20), o);
    const total = (await detail(o)).total;
    assert.equal(total, 30000);
    assert.equal((await call('POST', `/api/orders/${o}/pay`, { payments: [{ method: 'cash', currency: 'LAK', amount: total }] }, cashier)).status, 200);
    const s = db.get('SELECT * FROM table_sessions WHERE order_id = ?', o)!;
    assert.ok(s.ended_at, 'clock stopped by payment');

    const c = (await call('POST', '/api/orders', { type: 'dine_in', tableId: pool }, cashier)).body.id;
    assert.equal((await call('POST', `/api/orders/${c}/cancel`, { reason: 'ທົດສອບ' }, cashier)).status, 200);
    assert.ok(db.get('SELECT ended_at FROM table_sessions WHERE order_id = ?', c)!.ended_at);
  });

  test('start later; waiving the time line (manager void) removes the charge for good', async () => {
    const o = (await call('POST', '/api/orders', { type: 'dine_in', tableId: pool, startTimer: false }, cashier)).body;
    assert.equal(o.timer, null, 'not started');
    assert.equal((await call('POST', `/api/orders/${o.id}/timer/start`, {}, cashier)).status, 201);
    assert.equal((await call('POST', `/api/orders/${o.id}/timer/start`, {}, cashier)).status, 409, 'already counting');
    db.run('UPDATE table_sessions SET started_at = ? WHERE order_id = ?', agoIso(40), o.id);
    const d = await detail(o.id);
    assert.equal(d.total, 45000);
    const line = timeLine(d);
    assert.equal((await call('POST', `/api/order-items/${line.id}/cancel`, { qty: 1, reason: 'ເຈົ້າຂອງຍົກໃຫ້' }, cashier)).status, 403, 'cashier cannot waive');
    assert.equal((await call('POST', `/api/order-items/${line.id}/cancel`, { qty: 1, reason: 'ເຈົ້າຂອງຍົກໃຫ້' }, manager)).status, 200);
    assert.equal((await detail(o.id)).total, 0);
    db.run('UPDATE table_sessions SET started_at = ? WHERE order_id = ?', agoIso(400), o.id);
    assert.equal((await detail(o.id)).total, 0, 'the clock does not bring the charge back');
  });
});
