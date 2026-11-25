import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { seedIfEmpty, DEMO_USERS } from '../src/seed.ts';
import { MAX_ATTEMPTS, RETRY_DELAYS, deliverDue, signBody, type FetchFn } from '../src/lib/webhooks.ts';

const PW = DEMO_USERS[0].password;
let base = '';
let close: () => void;
let db: ReturnType<typeof createApp>['db'];

async function call(method: string, url: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
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

describe('API keys and the public API', () => {
  let owner = '';
  let manager = '';
  let full = ''; // key with every scope
  let readOnly = '';
  let fullId = 0;
  let dish = 0;
  let optionDish = 0;

  const mkKey = async (name: string, scopes: string[], autoConfirm = false) => (await call('POST', '/api/integrations/keys', { name, scopes, autoConfirm }, owner)).body;
  const api = (method: string, url: string, body?: unknown, key = full, headers: Record<string, string> = {}) => call(method, `/api/v1${url}`, body, key, headers);

  test('only the owner manages keys; the key is shown once and stored hashed', async () => {
    owner = await login('admin');
    manager = await login('manager');
    assert.equal((await call('GET', '/api/integrations/keys', undefined, manager)).status, 403);
    assert.equal((await call('POST', '/api/integrations/keys', { name: 'x', scopes: ['menu:read'] }, manager)).status, 403);
    assert.equal((await call('POST', '/api/integrations/keys', { name: 'x', scopes: [] }, owner)).status, 400);
    assert.equal((await call('POST', '/api/integrations/keys', { name: 'x', scopes: ['admin:all'] }, owner)).status, 400);
    const k = await mkKey('ທົດສອບ', ['menu:read', 'orders:read', 'orders:write', 'reports:read']);
    assert.match(k.key, /^lz_[A-Za-z0-9_-]{30,}$/);
    full = k.key;
    fullId = k.id;
    const list = (await call('GET', '/api/integrations/keys', undefined, owner)).body;
    assert.equal(list.length, 1);
    assert.equal(list[0].key, undefined, 'the full key is never listed again');
    assert.equal(list[0].prefix, full.slice(0, 10));
    const row = db.get('SELECT key_hash FROM api_keys WHERE id = ?', fullId)!;
    assert.notEqual(row.key_hash, full);
    assert.equal(row.key_hash, crypto.createHash('sha256').update(full).digest('hex'));
    readOnly = (await mkKey('ອ່ານເມນູ', ['menu:read'])).key;
  });

  test('authentication, scopes and unknown paths', async () => {
    assert.equal((await call('GET', '/api/v1/menu')).status, 401);
    assert.equal((await api('GET', '/menu', undefined, 'lz_nope')).status, 401);
    assert.equal((await api('GET', '/menu', undefined, owner)).status, 401, 'a staff login token is not an API key');
    assert.equal((await api('GET', '/menu', undefined, readOnly)).status, 200);
    assert.equal((await api('GET', '/orders', undefined, readOnly)).status, 403, 'missing scope');
    assert.equal((await call('GET', '/api/v1/nothing-here', undefined, full)).status, 404);
    assert.equal((await call('GET', '/api/v1/')).status, 200);
    // the staff API does not accept API keys
    assert.equal((await call('GET', '/api/menu-items', undefined, full)).status, 401);
  });

  test('menu: no costs, availability included', async () => {
    const m = (await api('GET', '/menu')).body;
    assert.ok(m.categories.length > 0 && m.items.length > 0);
    assert.equal(m.items[0].cost, undefined);
    assert.equal(m.items[0].sold_out, false);
    dish = m.items.find((i: any) => i.price >= 20000 && !i.options.some((g: any) => g.required)).id;
    optionDish = m.items.find((i: any) => i.options.some((g: any) => g.required))?.id ?? 0;
  });

  test('creating an order: needs an open shift, validates, waits for staff approval', async () => {
    const body = { source: 'grabfood', externalRef: 'G-1001', customerName: 'ນາງ ມາລີ', phone: '020999', note: 'ບໍ່ເຜັດ', items: [{ menuItemId: dish, qty: 2 }] };
    assert.equal((await api('POST', '/orders', body)).status, 409, 'no open shift');
    await call('POST', '/api/shifts/open', { openingCash: 0 }, owner);
    assert.equal((await api('POST', '/orders', { ...body, source: 'Bad Source!' })).status, 400);
    assert.equal((await api('POST', '/orders', { ...body, items: [] })).status, 400);
    assert.equal((await api('POST', '/orders', { ...body, externalRef: 'G-x', items: [{ menuItemId: 999999, qty: 1 }] })).status, 404);
    if (optionDish) assert.equal((await api('POST', '/orders', { ...body, externalRef: 'G-y', items: [{ menuItemId: optionDish, qty: 1 }] })).status, 400, 'required option missing');
    assert.equal((await api('POST', '/orders', body, readOnly)).status, 403);

    const r = await api('POST', '/orders', body);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.type, 'takeaway');
    assert.equal(r.body.external_ref, 'G-1001');
    assert.equal(r.body.customer_name, 'ນາງ ມາລີ');
    assert.match(r.body.note, /grabfood #G-1001/);
    assert.equal(r.body.items[0].awaiting_confirmation, true, 'the key is not auto-confirm');
    assert.equal(r.body.total, 0, 'unapproved items are not billed yet');
    assert.equal(r.body.items[0].cost, undefined);
    const alerts = (await call('GET', '/api/qr/alerts', undefined, owner)).body;
    assert.ok(alerts.awaiting.length >= 1, 'staff see it waiting for approval');
  });

  test('the same externalRef never makes a second order', async () => {
    const body = { source: 'grabfood', externalRef: 'G-1001', items: [{ menuItemId: dish, qty: 5 }] };
    const again = await api('POST', '/orders', body);
    assert.equal(again.status, 200);
    assert.equal(again.body.idempotent, true);
    assert.equal(again.body.items.length, 1);
    assert.equal(again.body.items[0].qty, 2, 'the first request wins');
    assert.equal((await api('GET', '/orders?external_ref=G-1001')).body.data.length, 1);
    // another platform may reuse the same number
    assert.equal((await api('POST', '/orders', { ...body, source: 'foodpanda', externalRef: 'G-1001' })).status, 201);
  });

  test('an auto-confirm key sends items straight on and bills them', async () => {
    const auto = (await mkKey('ເວັບໄຊ', ['orders:read', 'orders:write'], true)).key;
    const r = await api('POST', '/orders', { source: 'website', externalRef: 'W-1', items: [{ menuItemId: dish, qty: 1 }] }, auto);
    assert.equal(r.status, 201);
    assert.equal(r.body.items[0].awaiting_confirmation, false);
    assert.ok(r.body.total > 0);
    assert.equal(r.body.items[0].status, 'pending', 'on the kitchen board');
  });

  test('listing: filters, newest first, paging', async () => {
    const all = (await api('GET', '/orders')).body;
    assert.equal(all.data.length, 3);
    assert.ok(all.data[0].id > all.data[1].id);
    const p1 = (await api('GET', '/orders?limit=2')).body;
    assert.equal(p1.data.length, 2);
    assert.ok(p1.next_after);
    const p2 = (await api('GET', `/orders?limit=2&after=${p1.next_after}`)).body;
    assert.equal(p2.data.length, 1);
    assert.equal(p2.next_after, null);
    assert.equal((await api('GET', '/orders?status=paid')).body.data.length, 0);
    assert.equal((await api('GET', '/orders?status=weird')).status, 400);
    assert.equal((await api('GET', `/orders/${all.data[0].id}`)).body.id, all.data[0].id);
    assert.equal((await api('GET', '/orders/999999')).status, 404);
  });

  test('cancel: only API-made orders, only while open', async () => {
    const mine = (await api('GET', '/orders?external_ref=G-1001')).body.data[0];
    const c = await api('POST', `/orders/${mine.id}/cancel`, { reason: 'ລູກຄ້າຍົກເລີກ' });
    assert.equal(c.status, 200);
    assert.equal(c.body.status, 'cancelled');
    assert.equal((await api('POST', `/orders/${mine.id}/cancel`, {})).status, 409);
    // a table order made by staff is out of reach of the API
    const tables = (await call('GET', '/api/tables', undefined, owner)).body;
    const staffOrder = (await call('POST', '/api/orders', { type: 'dine_in', tableId: tables[0].id }, owner)).body.id;
    assert.equal((await api('POST', `/orders/${staffOrder}/cancel`, {})).status, 403);
    await call('POST', `/api/orders/${staffOrder}/items`, { items: [{ menuItemId: dish, qty: 1 }], print: false }, owner);
    const total = (await call('GET', `/api/orders/${staffOrder}`, undefined, owner)).body.total;
    assert.equal((await call('POST', `/api/orders/${staffOrder}/pay`, { payments: [{ method: 'cash', currency: 'LAK', amount: total }] }, owner)).status, 200);
    const rep = (await api('GET', '/reports/daily')).body;
    assert.equal(rep.bills, 1);
    assert.equal(rep.sales, total);
    assert.equal(rep.by_method.cash, total);
    assert.equal((await api('GET', '/reports/daily?date=2020-01-01')).body.sales, 0);
    assert.equal((await api('GET', '/reports/daily', undefined, readOnly)).status, 403);
  });

  test('revoking a key stops it at once; rate limit answers 429 with Retry-After', async () => {
    const tmp = await mkKey('ຊົ່ວຄາວ', ['menu:read']);
    assert.equal((await api('GET', '/menu', undefined, tmp.key)).status, 200);
    assert.equal((await call('DELETE', `/api/integrations/keys/${tmp.id}`, undefined, owner)).status, 200);
    assert.equal((await api('GET', '/menu', undefined, tmp.key)).status, 401);
    assert.equal((await call('GET', '/api/integrations/keys', undefined, owner)).body.find((k: any) => k.id === tmp.id).active, false);

    const lim = (await mkKey('ຈຳກັດ', ['menu:read'])).key;
    const other = (await mkKey('ອີກອັນ', ['menu:read'])).key;
    process.env.LAZA_API_RATE = '3';
    try {
      for (let i = 0; i < 3; i++) assert.equal((await api('GET', '/menu', undefined, lim)).status, 200);
      const blocked = await api('GET', '/menu', undefined, lim);
      assert.equal(blocked.status, 429);
      assert.ok(Number(blocked.headers.get('retry-after')) > 0);
      assert.equal(blocked.headers.get('x-ratelimit-remaining'), '0');
      assert.equal((await api('GET', '/menu', undefined, other)).status, 200, 'other keys have their own allowance');
    } finally {
      delete process.env.LAZA_API_RATE;
    }
  });
});

describe('webhooks', () => {
  let owner = '';
  let manager = '';
  let hook = 0;
  let secret = '';
  const sent: { url: string; headers: Record<string, string>; body: string }[] = [];
  let respond = 200;
  const fakeFetch: FetchFn = async (url, init) => {
    sent.push({ url, headers: init.headers, body: init.body });
    return { status: respond };
  };

  test('receivers are owner-only; URLs are checked; the secret is shown on create/rotate only', async () => {
    owner = await login('admin');
    manager = await login('manager');
    assert.equal((await call('POST', '/api/integrations/webhooks', { url: 'https://x.test/h' }, manager)).status, 403);
    for (const bad of ['ftp://x.test/h', 'not a url', 'https://user:pw@x.test/h', 'http://169.254.169.254/latest', '']) {
      assert.equal((await call('POST', '/api/integrations/webhooks', { url: bad }, owner)).status, 400, bad);
    }
    assert.equal((await call('POST', '/api/integrations/webhooks', { url: 'https://x.test/h', events: ['order.exploded'] }, owner)).status, 400);
    const h = await call('POST', '/api/integrations/webhooks', { url: 'https://hooks.example.com/laza', events: ['order.created', 'order.paid'], description: 'ບັນຊີ' }, owner);
    assert.equal(h.status, 201, JSON.stringify(h.body));
    hook = h.body.id;
    secret = h.body.secret;
    assert.match(secret, /^whsec_/);
    const list = (await call('GET', '/api/integrations/webhooks', undefined, owner)).body;
    assert.notEqual(list[0].secret, secret);
    assert.ok(list[0].secret.length < secret.length, 'masked in the list');
    const rot = await call('POST', `/api/integrations/webhooks/${hook}/rotate-secret`, {}, owner);
    assert.notEqual(rot.body.secret, secret);
    secret = rot.body.secret;
  });

  test('only subscribed events are queued, with a stable payload', async () => {
    await call('POST', '/api/shifts/open', { openingCash: 0 }, owner);
    const tables = (await call('GET', '/api/tables', undefined, owner)).body;
    const dish = (await call('GET', '/api/menu-items', undefined, owner)).body.find((i: any) => i.price >= 20000 && !(i.options ?? []).some((g: any) => g.required));
    const o = (await call('POST', '/api/orders', { type: 'dine_in', tableId: tables[0].id }, owner)).body.id;
    await call('POST', `/api/orders/${o}/items`, { items: [{ menuItemId: dish.id, qty: 1 }], print: false }, owner);
    const total = (await call('GET', `/api/orders/${o}`, undefined, owner)).body.total;
    await call('POST', `/api/orders/${o}/pay`, { payments: [{ method: 'cash', currency: 'LAK', amount: total }] }, owner);
    const o2 = (await call('POST', '/api/orders', { type: 'dine_in', tableId: tables[1].id }, owner)).body.id;
    await call('POST', `/api/orders/${o2}/cancel`, { reason: 'ທົດສອບ' }, owner); // not subscribed
    await call('POST', '/api/shifts/close', { countedCash: total }, owner); // not subscribed

    const rows = db.all('SELECT * FROM webhook_deliveries WHERE endpoint_id = ? ORDER BY id', hook);
    assert.deepEqual(rows.map((r) => r.type), ['order.created', 'order.paid', 'order.created']);
    assert.ok(rows.every((r) => r.status === 'pending' && r.attempts === 0));
    const paid = JSON.parse(rows[1].payload);
    assert.match(paid.id, /^evt_/);
    assert.equal(paid.type, 'order.paid');
    assert.equal(paid.data.total, total);
    assert.equal(paid.data.status, 'paid');
    assert.equal(paid.data.payments[0].method, 'cash');
    assert.equal(paid.data.items[0].unit_cost, undefined, 'no internal costs');
    assert.equal(paid.data.created_by, undefined);
  });

  test('delivery is signed; success is recorded; a later event is not delivered twice', async () => {
    sent.length = 0;
    const n = await deliverDue(db, { fetchFn: fakeFetch, nowMs: Date.now() });
    assert.equal(n, 3);
    assert.equal(sent.length, 3);
    const s = sent[1];
    assert.equal(s.url, 'https://hooks.example.com/laza');
    assert.equal(s.headers['x-laza-event'], 'order.paid');
    const sig = s.headers['x-laza-signature'];
    const t = Number(/t=(\d+)/.exec(sig)![1]);
    assert.equal(sig, signBody(secret, s.body, t), 'receiver can verify with the secret');
    assert.equal(sig, `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${s.body}`).digest('hex')}`);
    assert.notEqual(signBody('whsec_other', s.body, t), sig, 'a wrong secret does not verify');
    assert.ok(db.all("SELECT status FROM webhook_deliveries WHERE endpoint_id = ?", hook).every((r) => r.status === 'ok'));
    assert.equal(await deliverDue(db, { fetchFn: fakeFetch }), 0, 'nothing left');
  });

  test('failures retry with growing delays and are given up after the last attempt', async () => {
    await call('POST', '/api/shifts/open', { openingCash: 0 }, owner); // the previous test closed the shift
    await call('POST', '/api/orders', { type: 'takeaway' }, owner); // a new event
    const id = db.get("SELECT id FROM webhook_deliveries WHERE status = 'pending'")!.id;
    respond = 500;
    let t = Date.now();
    sent.length = 0;
    assert.equal(await deliverDue(db, { fetchFn: fakeFetch, nowMs: t }), 1);
    let d = db.get('SELECT * FROM webhook_deliveries WHERE id = ?', id)!;
    assert.equal(d.status, 'failed');
    assert.equal(d.attempts, 1);
    assert.equal(d.last_status, 500);
    assert.equal(Date.parse(d.next_at) - t, RETRY_DELAYS[0] * 1000);
    assert.equal(await deliverDue(db, { fetchFn: fakeFetch, nowMs: t + 30_000 }), 0, 'not due yet');
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      t = Date.parse(db.get('SELECT next_at FROM webhook_deliveries WHERE id = ?', id)!.next_at ?? new Date(t).toISOString());
      assert.equal(await deliverDue(db, { fetchFn: fakeFetch, nowMs: t }), 1);
    }
    d = db.get('SELECT * FROM webhook_deliveries WHERE id = ?', id)!;
    assert.equal(d.status, 'dead');
    assert.equal(d.attempts, MAX_ATTEMPTS);
    assert.equal(sent.length, MAX_ATTEMPTS);
    assert.equal(await deliverDue(db, { fetchFn: fakeFetch, nowMs: t + 1e9 }), 0);
    respond = 200;
    // a connection error is a failure too
    await call('POST', '/api/orders', { type: 'takeaway' }, owner);
    const boom: FetchFn = async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); };
    await deliverDue(db, { fetchFn: boom });
    const f = db.get("SELECT * FROM webhook_deliveries WHERE status = 'failed'")!;
    assert.equal(f.last_error, 'ECONNREFUSED');
  });

  test('the log shows deliveries; a failed one can be retried by hand; test pings reach a real server', async () => {
    const log = (await call('GET', `/api/integrations/deliveries?endpointId=${hook}`, undefined, owner)).body;
    assert.ok(log.length >= 5);
    assert.equal((await call('GET', '/api/integrations/deliveries?status=dead', undefined, owner)).body.length, 1);
    assert.equal((await call('GET', '/api/integrations/deliveries?status=nope', undefined, owner)).status, 400);

    // keep the first (unreachable, example.com) receiver out of this test: only the local one should be contacted
    db.run('UPDATE webhook_endpoints SET active = 0 WHERE id = ?', hook);

    // a real receiver on localhost
    const got: { headers: http.IncomingHttpHeaders; body: string }[] = [];
    let code = 200;
    const srv = http.createServer((req, res) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        got.push({ headers: req.headers, body: b });
        res.statusCode = code;
        res.end('ok');
      });
    });
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/hook`;
    try {
      const h = (await call('POST', '/api/integrations/webhooks', { url, events: ['order.paid'] }, owner)).body;
      const t1 = await call('POST', `/api/integrations/webhooks/${h.id}/test`, {}, owner);
      assert.equal(t1.body.ok, true, JSON.stringify(t1.body));
      assert.equal(got.length, 1);
      const ev = JSON.parse(got[0].body);
      assert.equal(ev.type, 'ping', 'a ping is sent even to a receiver that did not subscribe to it');
      const sig = String(got[0].headers['x-laza-signature']);
      assert.equal(sig, signBody(h.secret, got[0].body, Number(/t=(\d+)/.exec(sig)![1])));

      code = 500;
      const t2 = await call('POST', `/api/integrations/webhooks/${h.id}/test`, {}, owner);
      assert.equal(t2.body.ok, false);
      assert.equal(t2.body.last_status, 500);
      assert.equal(t2.body.status, 'dead', 'a failed test is not retried later');

      // retry by hand: first make a failing delivery for this receiver
      await call('POST', '/api/shifts/open', { openingCash: 0 }, owner);
      const tb = (await call('GET', '/api/tables', undefined, owner)).body;
      const dish = (await call('GET', '/api/menu-items', undefined, owner)).body.find((i: any) => i.price >= 20000 && !(i.options ?? []).some((g: any) => g.required));
      const o = (await call('POST', '/api/orders', { type: 'dine_in', tableId: tb[2].id }, owner)).body.id;
      await call('POST', `/api/orders/${o}/items`, { items: [{ menuItemId: dish.id, qty: 1 }], print: false }, owner);
      const total = (await call('GET', `/api/orders/${o}`, undefined, owner)).body.total;
      await call('POST', `/api/orders/${o}/pay`, { payments: [{ method: 'cash', currency: 'LAK', amount: total }] }, owner);
      const del = db.get("SELECT id FROM webhook_deliveries WHERE endpoint_id = ? AND type = 'order.paid'", h.id)!.id;
      await deliverDue(db);
      assert.equal(db.get('SELECT status FROM webhook_deliveries WHERE id = ?', del)!.status, 'failed');
      code = 200;
      const re = await call('POST', `/api/integrations/deliveries/${del}/retry`, {}, owner);
      assert.equal(re.body.ok, true);
      assert.equal(re.body.status, 'ok');
      assert.equal((await call('POST', `/api/integrations/deliveries/${del}/retry`, {}, owner)).status, 400, 'already delivered');
    } finally {
      srv.close();
    }
  });

  test('disabling or deleting a receiver stops its events', async () => {
    assert.equal((await call('PUT', `/api/integrations/webhooks/${hook}`, { active: false }, owner)).body.active, false);
    const before = db.get('SELECT COUNT(*) AS n FROM webhook_deliveries WHERE endpoint_id = ?', hook)!.n;
    await call('POST', '/api/orders', { type: 'takeaway' }, owner);
    assert.equal(db.get('SELECT COUNT(*) AS n FROM webhook_deliveries WHERE endpoint_id = ?', hook)!.n, before);
    assert.equal((await call('DELETE', `/api/integrations/webhooks/${hook}`, undefined, owner)).status, 200);
    assert.equal((await call('GET', '/api/integrations/webhooks', undefined, owner)).body.some((h: any) => h.id === hook), false);
    assert.equal((await call('DELETE', `/api/integrations/webhooks/${hook}`, undefined, owner)).status, 404);
  });
});
