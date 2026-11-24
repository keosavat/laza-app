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

const addDays = (date: string, n: number) => new Date(Date.parse(date) + n * 86_400_000).toISOString().slice(0, 10);

describe('table reservations', () => {
  let admin = '';
  let cashier = '';
  let tables: any[] = [];
  let today = '';
  const book = (b: any) => call('POST', '/api/reservations', { name: 'ທ້າວ ບຸນ', partySize: 4, ...b }, cashier);

  test('book a table; bad input is refused; the past is refused', async () => {
    admin = await login('admin');
    cashier = await login('cashier');
    tables = (await call('GET', '/api/tables', undefined, admin)).body;
    today = (await call('GET', '/api/reservations/today', undefined, cashier)).body.date;
    const tomorrow = addDays(today, 1);

    const r = await book({ date: tomorrow, time: '19:00', tableId: tables[0].id, phone: '020111', note: 'ວັນເກີດ' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.status, 'booked');
    assert.equal(r.body.table_name, tables[0].name);

    assert.equal((await book({ date: 'x', time: '19:00' })).status, 400);
    assert.equal((await book({ date: tomorrow, time: '25:00' })).status, 400);
    assert.equal((await book({ date: tomorrow, time: '19:00', name: '' })).status, 400);
    assert.equal((await book({ date: tomorrow, time: '19:00', partySize: 0 })).status, 400);
    assert.equal((await book({ date: addDays(today, -1), time: '19:00' })).status, 400, 'no booking in the past');
    assert.equal((await book({ date: tomorrow, time: '19:00', tableId: 99999 })).status, 404);
  });

  test('a table cannot be double-booked at overlapping times', async () => {
    const d = addDays(today, 1);
    const t = tables[0].id;
    assert.equal((await book({ date: d, time: '19:30', tableId: t })).status, 409, 'overlaps 19:00–20:30');
    assert.equal((await book({ date: d, time: '18:00', tableId: t })).status, 409, '18:00–19:30 overlaps');
    assert.equal((await book({ date: d, time: '17:00', tableId: t })).status, 201, 'ends 18:30, before 19:00');
    assert.equal((await book({ date: d, time: '20:30', tableId: t })).status, 201, 'starts exactly when the first ends');
    assert.equal((await book({ date: d, time: '19:00', tableId: tables[1].id })).status, 201, 'another table is fine');
    assert.equal((await book({ date: d, time: '19:00' })).status, 201, 'no table assigned yet is fine');
  });

  test('list by day; edit; cancel frees the table; restore re-checks it', async () => {
    const d = addDays(today, 1);
    const list = (await call('GET', `/api/reservations?date=${d}`, undefined, cashier)).body;
    assert.equal(list.length, 5);
    assert.deepEqual(list.map((x: any) => x.reserved_time), [...list.map((x: any) => x.reserved_time)].sort());

    const first = list.find((x: any) => x.reserved_time === '19:00' && x.table_id === tables[0].id);
    const edit = await call('PUT', `/api/reservations/${first.id}`, { partySize: 6, note: 'ເພີ່ມຄົນ' }, cashier);
    assert.equal(edit.status, 200);
    assert.equal(edit.body.party_size, 6);
    assert.equal(edit.body.time ?? edit.body.reserved_time, '19:00', 'untouched fields stay');
    assert.equal((await call('PUT', `/api/reservations/${first.id}`, { time: '17:30' }, cashier)).status, 409, 'moving onto the 17:00 booking');

    assert.equal((await call('POST', `/api/reservations/${first.id}/status`, { status: 'cancelled' }, cashier)).body.status, 'cancelled');
    assert.equal((await call('PUT', `/api/reservations/${first.id}`, { partySize: 2 }, cashier)).status, 409, 'cancelled ones are not editable');
    const again = await book({ date: d, time: '19:15', durationMin: 60, tableId: tables[0].id });
    assert.equal(again.status, 201, 'the slot is free after cancelling');
    assert.equal((await call('POST', `/api/reservations/${first.id}/status`, { status: 'booked' }, cashier)).status, 409, 'cannot restore onto a slot taken meanwhile');
    assert.equal((await call('POST', `/api/reservations/${again.body.id}/status`, { status: 'no_show' }, cashier)).body.status, 'no_show');
    assert.equal((await call('POST', `/api/reservations/${first.id}/status`, { status: 'booked' }, cashier)).status, 200, 'restored once free');
    assert.equal((await call('POST', `/api/reservations/${first.id}/status`, { status: 'bogus' }, cashier)).status, 400);
  });

  test('seating opens an order linked to the booking and the customer; floor shows the badge', async () => {
    await call('POST', '/api/shifts/open', { openingCash: 100000 }, admin);
    const cust = (await call('POST', '/api/customers', { name: 'ນາງ ດາວ', phone: '020999' }, cashier)).body.id;
    const t = tables[2].id;
    const soon = (await call('GET', '/api/reservations/today', undefined, cashier)).body;
    const [h, m] = soon.time.split(':').map(Number);
    const later = `${String(Math.min(23, h + (m >= 30 ? 1 : 0))).padStart(2, '0')}:${m >= 30 ? '00' : '30'}`;
    // Only meaningful when "later" is still today and after now; skip the badge check near midnight.
    const r = await book({ date: today, time: later, tableId: t, phone: '020999', name: 'ນາງ ດາວ' });
    if (h < 23) {
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.customer_id, cust, 'linked to the customer by phone');
      const floor = (await call('GET', '/api/floor', undefined, cashier)).body.tables.find((x: any) => x.id === t);
      assert.equal(floor.resv_time, later);
      assert.equal(floor.resv_name, 'ນາງ ດາວ');
      assert.equal((await call('GET', '/api/reservations/today', undefined, cashier)).body.list.some((x: any) => x.id === r.body.id), true);

      const seat = await call('POST', `/api/reservations/${r.body.id}/seat`, {}, cashier);
      assert.equal(seat.status, 201, JSON.stringify(seat.body));
      assert.equal(seat.body.reservation.status, 'seated');
      assert.equal(seat.body.order.table_id, t);
      assert.equal(seat.body.order.customer_id, cust);
      assert.equal(seat.body.order.customer_name, 'ນາງ ດາວ');
      assert.equal(seat.body.order.guest_count, 4);
      assert.equal((await call('GET', '/api/floor', undefined, cashier)).body.tables.find((x: any) => x.id === t).resv_id, null, 'badge gone once seated');
      assert.equal((await call('POST', `/api/reservations/${r.body.id}/seat`, {}, cashier)).status, 409, 'cannot seat twice');
      assert.equal((await call('POST', `/api/reservations/${r.body.id}/status`, { status: 'cancelled' }, cashier)).status, 409);
    }
  });

  test('seating needs a table and an open shift; a busy table is refused', async () => {
    const d = today;
    const noTable = await book({ date: d, time: '23:00' });
    assert.equal((await call('POST', `/api/reservations/${noTable.body.id}/seat`, {}, cashier)).status, 400, 'no table chosen');
    const busyTable = tables[2].id; // has the seated party from the previous test (when it ran)
    const open = (await call('GET', '/api/floor', undefined, cashier)).body.tables.find((x: any) => x.id === busyTable).order_id;
    if (open) assert.equal((await call('POST', `/api/reservations/${noTable.body.id}/seat`, { tableId: busyTable }, cashier)).status, 409);
    const free = tables[3].id;
    const ok = await call('POST', `/api/reservations/${noTable.body.id}/seat`, { tableId: free }, cashier);
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.reservation.table_id, free, 'the chosen table is remembered');
  });
});
