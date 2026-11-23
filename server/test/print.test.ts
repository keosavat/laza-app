import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { seedIfEmpty, DEMO_USERS } from '../src/seed.ts';
import { renderBlocks } from '../src/print/render.ts';
import { decodeEscpos, encodeRaster } from '../src/print/escpos.ts';
import type { Db } from '../src/db.ts';
import type { PrintService } from '../src/print/service.ts';

const PW = DEMO_USERS[0].password;
let base = '';
let db: Db;
let print: PrintService;
let close: () => void;

/** A pretend LAN printer that records every connection's bytes. */
function fakePrinter() {
  const received: Buffer[] = [];
  const server = net.createServer((s) => {
    const chunks: Buffer[] = [];
    s.on('data', (d) => chunks.push(d));
    s.on('end', () => received.push(Buffer.concat(chunks)));
  });
  return new Promise<{ port: number; received: Buffer[]; close: () => void }>((ok) =>
    server.listen(0, '127.0.0.1', () => ok({ port: (server.address() as AddressInfo).port, received, close: () => server.close() })),
  );
}
const settle = () => new Promise((r) => setTimeout(r, 450)); // transport waits 300ms before hanging up

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
  print = app.print;
  seedIfEmpty(db);
  await new Promise<void>((ok) => app.server.listen(0, ok));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  close = () => app.server.close();
});
after(() => close());

describe('rendering and ESC/POS', () => {
  test('Lao ticket renders at paper width and survives an encode/decode round trip', () => {
    const bm = renderBlocks(
      [
        { t: 'text', text: 'ໂຕະ A01', size: 'xl', bold: true, align: 'center' },
        { t: 'rule' },
        { t: 'row', left: '2× ເຝີຊີ້ນງົວ ຂະໜາດໃຫຍ່ ແລະ ໄຂ່ດາວ ເພີ່ມຊີ້ນ ບໍ່ໃສ່ຜັກ', right: '₭100,000' },
      ],
      576,
    );
    assert.equal(bm.width, 576);
    assert.ok(bm.height > 120, 'long line wrapped onto several rows');
    assert.ok(bm.data.some((x) => x === 1), 'has black pixels');
    const bytes = encodeRaster(bm, { cut: true, copies: 2 });
    assert.deepEqual([...bytes.subarray(0, 5)], [0x1b, 0x40, 0x1d, 0x76, 0x30]);
    const back = decodeEscpos(bytes);
    assert.equal(back.jobs, 2);
    assert.equal(back.cuts, 2);
    assert.equal(back.bitmap.height, bm.height * 2);
    assert.deepEqual(back.bitmap.data.subarray(0, bm.data.length), bm.data);
  });

  test('58mm paper is 384 dots wide', () => {
    assert.equal(renderBlocks([{ t: 'text', text: 'ທົດສອບ' }], 384).width, 384);
    assert.throws(() => renderBlocks([], 500));
  });
});

describe('printers and the print queue', () => {
  let admin = '';
  let waiter = '';
  let kitchenPrinter: Awaited<ReturnType<typeof fakePrinter>>;
  let barPrinter: Awaited<ReturnType<typeof fakePrinter>>;
  let billPrinter: Awaited<ReturnType<typeof fakePrinter>>;
  let kitchenId = 0;
  let barId = 0;
  let billId = 0;
  let drinksCat = 0;
  let orderId = 0;
  const menu: Record<string, number> = {};
  const jobs = () => db.all('SELECT * FROM print_jobs ORDER BY id');

  test('setup: only admins manage printers; inputs are validated', async () => {
    admin = await login('admin');
    waiter = await login('waiter');
    kitchenPrinter = await fakePrinter();
    barPrinter = await fakePrinter();
    billPrinter = await fakePrinter();

    const lan = (name: string, role: string, port: number) => ({ name, role, connection: 'lan', host: '127.0.0.1', port, paper_mm: 80 });
    assert.equal((await call('POST', '/api/printers', lan('x', 'kitchen', 1), waiter)).status, 403);
    assert.equal((await call('POST', '/api/printers', { ...lan('x', 'kitchen', 1), host: '8.8.8.8' }, admin)).status, 400, 'public IP refused');
    assert.equal((await call('POST', '/api/printers', { ...lan('x', 'kitchen', 1), port: 70000 }, admin)).status, 400);
    assert.equal((await call('POST', '/api/printers', { name: 'u', role: 'bill', connection: 'usb' }, admin)).status, 400, 'usb needs a printer name');
    assert.equal((await call('POST', '/api/printers', { ...lan('x', 'kitchen', 1), paper_mm: 70 }, admin)).status, 400);

    kitchenId = (await call('POST', '/api/printers', lan('ຄົວ', 'kitchen', kitchenPrinter.port), admin)).body.id;
    barId = (await call('POST', '/api/printers', lan('ບາ', 'kitchen', barPrinter.port), admin)).body.id;
    billId = (await call('POST', '/api/printers', { ...lan('ໜ້າຮ້ານ', 'bill', billPrinter.port), copies: 2 }, admin)).body.id;
    assert.ok(kitchenId && barId && billId);

    const me = (await call('GET', '/api/me', undefined, waiter)).body;
    assert.deepEqual(me.printers, { kitchen: true, bill: true });

    const cats = (await call('GET', '/api/categories', undefined, admin)).body;
    drinksCat = cats.find((c: any) => c.name === 'ເຄື່ອງດື່ມ').id;
    assert.equal((await call('PUT', `/api/categories/${drinksCat}`, { printerId: billId }, admin)).status, 400, 'bill printer cannot take kitchen tickets');
    assert.equal((await call('PUT', `/api/categories/${drinksCat}`, { printerId: barId }, admin)).body.printer_id, barId);

    for (const i of (await call('GET', '/api/menu-items', undefined, admin)).body) menu[i.name] = i.id;
  });

  test('sending to the kitchen splits tickets by category: food → kitchen, drinks → bar', async () => {
    await call('POST', '/api/shifts/open', { openingCash: 0 }, admin);
    const tables = (await call('GET', '/api/tables', undefined, admin)).body;
    orderId = (await call('POST', '/api/orders', { type: 'dine_in', tableId: tables[0].id, guestCount: 2 }, waiter)).body.id;
    const r = await call(
      'POST',
      `/api/orders/${orderId}/items`,
      {
        items: [
          { menuItemId: menu['ເຂົ້າໜຽວ'], qty: 2 },
          { menuItemId: menu['ເຝີຊີ້ນງົວ'], qty: 1, options: [{ group: 'ຂະໜາດ', name: 'ໃຫຍ່' }], note: 'ບໍ່ໃສ່ຜັກ' },
          { menuItemId: menu['ເບຍລາວ'], qty: 3 },
        ],
      },
      waiter,
    );
    assert.equal(r.status, 201);
    assert.equal(r.body.printedByServer, true);
    const q = jobs();
    assert.equal(q.length, 2);
    assert.deepEqual(q.map((j) => j.printer_id).sort(), [kitchenId, barId].sort());
    assert.ok(q.every((j) => j.status === 'queued' && j.type === 'kitchen'));
    const kitchenBlocks = JSON.parse(q.find((j) => j.printer_id === kitchenId).payload_json);
    const text = JSON.stringify(kitchenBlocks);
    assert.match(text, /ເຝີຊີ້ນງົວ/);
    assert.match(text, /ບໍ່ໃສ່ຜັກ/);
    assert.doesNotMatch(text, /ເບຍລາວ/, 'beer goes to the bar, not the kitchen');
    assert.doesNotMatch(text, /₭/, 'kitchen tickets have no prices');

    assert.equal(await print.processDue(), 2);
    await settle();
    assert.equal(kitchenPrinter.received.length, 1);
    assert.equal(barPrinter.received.length, 1);
    const dec = decodeEscpos(kitchenPrinter.received[0]);
    assert.equal(dec.bitmap.width, 576);
    assert.equal(dec.cuts, 1);
    assert.ok(jobs().every((j) => j.status === 'done'));
    assert.ok(db.get('SELECT last_ok_at FROM printers WHERE id = ?', kitchenId)!.last_ok_at);
  });

  test('bill and receipt go to the bill printer (with its copy count)', async () => {
    const b = await call('POST', `/api/orders/${orderId}/print-bill`, {}, waiter);
    assert.equal(b.body.printedByServer, true);
    const pay = await call('POST', `/api/orders/${orderId}/pay`, { payments: [{ method: 'cash', amount: 200000 }], print: true }, admin);
    assert.equal(pay.status, 200, JSON.stringify(pay.body));
    assert.equal(pay.body.printedByServer, true);
    const noPrint = jobs().filter((j) => j.printer_id === billId);
    assert.deepEqual(noPrint.map((j) => j.type), ['bill', 'receipt']);
    assert.match(noPrint[1].payload_json, /ເງິນທອນ/);
    await print.processDue();
    await settle();
    assert.equal(billPrinter.received.length, 2);
    assert.equal(decodeEscpos(billPrinter.received[1]).jobs, 2, 'two copies');

    const again = await call('POST', `/api/orders/${orderId}/print/receipt`, {}, waiter);
    assert.equal(again.status, 201);
  });

  test('reprint selected lines; marked as a reprint', async () => {
    const o = (await call('GET', `/api/orders/${orderId}`, undefined, admin)).body;
    const r = await call('POST', `/api/orders/${orderId}/print/kitchen`, { itemIds: [o.items[0].id] }, waiter);
    assert.equal(r.status, 201);
    assert.equal(r.body.tickets, 1);
    assert.match(jobs().at(-1).payload_json, /ພິມຊ້ຳ/);
  });

  test('a dead printer: retries with back-off, then fails; manual retry re-queues', async () => {
    kitchenPrinter.close();
    db.run('DELETE FROM print_jobs');
    const tables = (await call('GET', '/api/tables', undefined, admin)).body;
    const o2 = (await call('POST', '/api/orders', { type: 'dine_in', tableId: tables[1].id }, waiter)).body.id;
    await call('POST', `/api/orders/${o2}/items`, { items: [{ menuItemId: menu['ເຂົ້າໜຽວ'] }] }, waiter);
    for (let i = 1; i <= 5; i++) {
      await print.processDue({ force: true });
      const j = jobs()[0];
      assert.equal(j.attempts, i);
      assert.equal(j.status, i < 5 ? 'queued' : 'failed');
      if (i === 1) assert.ok(Date.parse(j.run_after) > Date.now(), 'waits before retrying');
    }
    assert.match(jobs()[0].error, /ປະຕິເສດ|ຕິດຕໍ່/);
    const status = (await call('GET', '/api/print/status', undefined, waiter)).body;
    assert.equal(status.failed, 1);
    assert.equal(status.problems[0].id, kitchenId);

    assert.equal((await call('POST', `/api/print/jobs/${jobs()[0].id}/retry`, {}, waiter)).status, 403);
    assert.equal((await call('POST', `/api/print/jobs/${jobs()[0].id}/retry`, {}, admin)).status, 200);
    assert.equal(jobs()[0].status, 'queued');
    assert.equal(jobs()[0].attempts, 0);
  });

  test('customer QR orders print when auto-confirmed, and only after approval otherwise', async () => {
    db.run('DELETE FROM print_jobs');
    const tables = (await call('GET', '/api/tables', undefined, admin)).body;
    const o = (await call('POST', '/api/orders', { type: 'dine_in', tableId: tables[2].id, withQr: true }, waiter)).body;
    await call('POST', `/api/public/qr/${o.qr_token}/orders`, { items: [{ menuItemId: menu['ເຂົ້າໜຽວ'] }] });
    assert.equal(jobs().length, 1);
    assert.match(jobs()[0].payload_json, /ລູກຄ້າສັ່ງເອງ/);

    await call('PUT', '/api/settings', { qr_auto_confirm: false }, admin);
    await call('POST', `/api/public/qr/${o.qr_token}/orders`, { items: [{ menuItemId: menu['ເບຍລາວ'] }] });
    assert.equal(jobs().length, 1, 'nothing printed while waiting for approval');
    await call('POST', `/api/orders/${o.id}/approve`, {}, waiter);
    assert.equal(jobs().length, 2);
    assert.equal(jobs()[1].printer_id, barId);
    await call('PUT', '/api/settings', { qr_auto_confirm: true }, admin);
  });

  test('auto kitchen print can be switched off; deleting a printer unlinks categories', async () => {
    db.run('DELETE FROM print_jobs');
    await call('PUT', '/api/settings', { auto_kitchen_print: false }, admin);
    const tables = (await call('GET', '/api/tables', undefined, admin)).body;
    const o = (await call('POST', '/api/orders', { type: 'dine_in', tableId: tables[3].id }, waiter)).body.id;
    const r = await call('POST', `/api/orders/${o}/items`, { items: [{ menuItemId: menu['ເຂົ້າໜຽວ'] }] }, waiter);
    assert.equal(r.body.printedByServer, false);
    assert.equal(jobs().length, 0);
    await call('PUT', '/api/settings', { auto_kitchen_print: true }, admin);

    assert.equal((await call('DELETE', `/api/printers/${barId}`, undefined, admin)).status, 204);
    const cats = (await call('GET', '/api/categories', undefined, admin)).body;
    assert.equal(cats.find((c: any) => c.id === drinksCat).printer_id, null);
    barPrinter.close();
    billPrinter.close();
  });

  test('adding items: print=true forces a ticket, print=false skips it, omitted follows the setting', async () => {
    const tables = (await call('GET', '/api/tables', undefined, admin)).body;
    const o = (await call('POST', '/api/orders', { type: 'dine_in', tableId: tables[4].id }, waiter)).body.id;
    const add = (print?: boolean) => call('POST', `/api/orders/${o}/items`, { items: [{ menuItemId: menu['ເຂົ້າໜຽວ'] }], ...(print === undefined ? {} : { print }) }, waiter);

    db.run('DELETE FROM print_jobs');
    await call('PUT', '/api/settings', { auto_kitchen_print: false }, admin);
    assert.equal((await add()).body.printedByServer, false);
    assert.equal((await add(true)).body.printedByServer, true, 'explicit "order & print" prints even when auto is off');
    assert.equal(jobs().length, 1);

    await call('PUT', '/api/settings', { auto_kitchen_print: true }, admin);
    assert.equal((await add(false)).body.printedByServer, false, '"order only" skips printing');
    assert.equal((await add()).body.printedByServer, true);
    assert.equal(jobs().length, 2);
    assert.equal((await call('GET', `/api/orders/${o}`, undefined, admin)).body.items.length, 4, 'all four batches were added');
  });

  test('test print is queued for the chosen printer', async () => {
    const r = await call('POST', `/api/printers/${billId}/test`, {}, admin);
    assert.equal(r.status, 201);
    assert.equal(db.get('SELECT type FROM print_jobs WHERE id = ?', r.body.jobId)!.type, 'test');
  });
});
