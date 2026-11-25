// Public API v1 — for delivery apps, websites, accounting tools… Authenticated with an API key, never with a staff login.
import { Router } from 'express';
import type { Ctx } from '../app.ts';
import { apiAuth, type RateWindows } from '../lib/apikeys.ts';
import { bad, conflict, dayRange, HttpError, int, localDate, notFound, str } from '../lib/core.ts';
import { portionsMap } from '../lib/inventory.ts';
import { addItems, createOrder, getBranch, loadOrder, recalc, requireShift, type NewItem } from '../lib/orders.ts';
import { publicOrder, queueEvent } from '../lib/webhooks.ts';
import { now } from '../db.ts';
import { endSession } from '../lib/timed.ts';

export function apiV1Routes({ db, emit, print }: Ctx) {
  const r = Router();
  const windows: RateWindows = new Map();
  const perMinute = () => Number(process.env.LAZA_API_RATE ?? 120);
  const need = (scope: Parameters<typeof apiAuth>[1]) => apiAuth(db, scope, { windows, perMinute });
  const changed = (bid: number) => emit(bid, ['orders', 'tables', 'kitchen', 'qr']);

  r.get('/', (_req, res) => res.json({ name: 'LAZA public API', version: 1, docs: 'docs/API.md' }));

  // ---------- menu ----------
  r.get('/menu', need('menu:read'), (req, res) => {
    const bid = req.apiKey!.bid;
    const left = portionsMap(db, bid);
    const categories = db.all('SELECT id, name FROM categories WHERE branch_id = ? AND active = 1 ORDER BY sort, id', bid);
    const items = db
      .all('SELECT id, category_id, name, price, options_json FROM menu_items WHERE branch_id = ? AND active = 1 ORDER BY sort, id', bid)
      .map((i) => ({ id: i.id, category_id: i.category_id, name: i.name, price: i.price, options: JSON.parse(i.options_json || '[]'), sold_out: left.get(i.id) === 0 }));
    res.json({ categories, items });
  });

  // ---------- orders ----------
  r.get('/orders', need('orders:read'), (req, res) => {
    const bid = req.apiKey!.bid;
    const off = getBranch(db, bid).utc_offset_min;
    const where = ['o.branch_id = ?'];
    const params: any[] = [bid];
    if (req.query.status) {
      const st = String(req.query.status);
      if (!['open', 'paid', 'cancelled'].includes(st)) throw bad('status ຕ້ອງເປັນ open, paid ຫຼື cancelled');
      where.push('o.status = ?');
      params.push(st);
    }
    for (const [q, op] of [['from', '>='], ['to', '<']] as const) {
      if (!req.query[q]) continue;
      const d = String(req.query[q]);
      const { start, end } = dayRange(d, off);
      where.push(`o.created_at ${op} ?`);
      params.push(q === 'from' ? start : end);
    }
    if (req.query.external_ref) {
      where.push('o.external_ref = ?');
      params.push(String(req.query.external_ref));
    }
    if (req.query.after) {
      where.push('o.id < ?');
      params.push(int(req.query.after, 'after'));
    }
    const limit = Math.min(100, Math.max(1, int(req.query.limit ?? 50, 'limit', { min: 1, max: 100 })));
    const ids = db.all(`SELECT o.id FROM orders o WHERE ${where.join(' AND ')} ORDER BY o.id DESC LIMIT ?`, ...params, limit + 1);
    const more = ids.length > limit;
    const page = ids.slice(0, limit).map((x) => publicOrder(db, x.id));
    res.json({ data: page, next_after: more ? page[page.length - 1]!.id : null });
  });

  r.get('/orders/:id', need('orders:read'), (req, res) => {
    const o = loadOrder(db, int(req.params.id, 'id'), req.apiKey!.bid);
    res.json(publicOrder(db, o.id));
  });

  /**
   * Create a take-away order from another system. `source` + `externalRef` identify it on their side:
   * sending the same pair again returns the order that already exists instead of creating a second one.
   * Without "auto confirm" on the key, the items wait for staff to approve them (like customer QR orders).
   */
  r.post('/orders', need('orders:write'), (req, res) => {
    const k = req.apiKey!;
    const source = str(req.body.source, 'source', { required: true, max: 30 }).toLowerCase();
    if (!/^[a-z0-9_-]+$/.test(source)) throw bad('source ໃຊ້ໄດ້ສະເພາະ a-z, 0-9, _ ແລະ -');
    const ref = str(req.body.externalRef, 'externalRef', { required: true, max: 80 });
    const dup = db.get('SELECT id FROM orders WHERE branch_id = ? AND external_source = ? AND external_ref = ?', k.bid, source, ref);
    if (dup) return void res.status(200).json({ ...publicOrder(db, dup.id), idempotent: true });
    if (!Array.isArray(req.body.items) || !req.body.items.length) throw bad('items ຕ້ອງມີຢ່າງໜ້ອຍ 1 ລາຍການ');
    if (req.body.items.length > 50) throw bad('items ຫຼາຍເກີນໄປ (ສູງສຸດ 50)');
    const items: NewItem[] = req.body.items.map((it: any) => ({
      menuItemId: int(it?.menuItemId, 'menuItemId', { required: true }),
      qty: int(it?.qty ?? 1, 'qty', { min: 1, max: 99 }),
      options: Array.isArray(it?.options) ? it.options.slice(0, 20).map((x: any) => ({ group: str(x?.group, 'option.group', { max: 60 }), name: str(x?.name, 'option.name', { max: 60 }) })) : [],
      note: str(it?.note, 'note', { max: 200 }),
    }));
    if (k.uid === null) throw new HttpError(409, 'API key ນີ້ບໍ່ມີຜູ້ສ້າງ — ສ້າງ key ໃໝ່');
    const phone = str(req.body.phone, 'phone', { max: 30 });
    const out = db.tx(() => {
      requireShift(db, k.bid);
      const id = createOrder(db, { bid: k.bid, uid: k.uid!, type: 'takeaway', tableId: null, customerName: str(req.body.customerName, 'customerName', { max: 80 }) || source });
      const note = [`[${source} #${ref}]`, phone && `ໂທ ${phone}`, str(req.body.note, 'note', { max: 300 })].filter(Boolean).join(' · ');
      db.run('UPDATE orders SET external_source = ?, external_ref = ?, note = ?, updated_at = ? WHERE id = ?', source, ref, note, now(), id);
      const ids = addItems(db, { bid: k.bid, uid: null, orderId: id, items, source: 'customer', awaiting: !k.autoConfirm });
      db.audit(k.bid, k.uid, 'api_order', 'order', id, { key: k.name, source, ref });
      return { id, ids };
    });
    if (k.autoConfirm) print.kitchen(k.bid, out.id, out.ids);
    queueEvent(db, k.bid, 'order.created', publicOrder(db, out.id));
    changed(k.bid);
    res.status(201).json({ ...publicOrder(db, out.id), idempotent: false });
  });

  /** An order made through the API may be cancelled by the same integration while nobody has paid for it. */
  r.post('/orders/:id/cancel', need('orders:write'), (req, res) => {
    const k = req.apiKey!;
    const o = loadOrder(db, int(req.params.id, 'id'), k.bid);
    if (!o.external_source) throw new HttpError(403, 'ຍົກເລີກໄດ້ສະເພາະອໍເດີທີ່ສ້າງຜ່ານ API');
    if (o.status !== 'open') throw conflict('ອໍເດີນີ້ປິດແລ້ວ');
    const reason = str(req.body.reason, 'reason', { max: 200 }) || `ຍົກເລີກຈາກ ${o.external_source}`;
    const ts = now();
    db.tx(() => {
      db.run("UPDATE order_items SET status='cancelled', cancel_reason=?, updated_at=? WHERE order_id=? AND status != 'cancelled'", reason, ts, o.id);
      db.run("UPDATE orders SET status='cancelled', cancel_reason=?, cancelled_at=?, updated_at=? WHERE id=?", reason, ts, ts, o.id);
      endSession(db, o.id, { sync: false });
      recalc(db, o.id);
      db.audit(k.bid, k.uid, 'api_cancel', 'order', o.id, { key: k.name, reason });
    });
    queueEvent(db, k.bid, 'order.cancelled', publicOrder(db, o.id));
    changed(k.bid);
    res.json(publicOrder(db, o.id));
  });

  // ---------- reports ----------
  r.get('/reports/daily', need('reports:read'), (req, res) => {
    const bid = req.apiKey!.bid;
    const off = getBranch(db, bid).utc_offset_min;
    const date = req.query.date ? String(req.query.date) : localDate(new Date(), off);
    const { start, end } = dayRange(date, off);
    const w = "o.branch_id = ? AND o.status = 'paid' AND o.paid_at >= ? AND o.paid_at < ?";
    const t = db.get(`SELECT COUNT(*) AS bills, COALESCE(SUM(total),0) AS sales, COALESCE(SUM(discount),0) AS discount, COALESCE(SUM(service),0) AS service, COALESCE(SUM(vat),0) AS vat FROM orders o WHERE ${w}`, bid, start, end)!;
    const methods = db.all(`SELECT p.method, SUM(p.amount_lak) AS amount_lak FROM payments p JOIN orders o ON o.id = p.order_id WHERE ${w} GROUP BY p.method`, bid, start, end);
    res.json({ date, currency: 'LAK', bills: t.bills, sales: t.sales, discount: t.discount, service: t.service, vat: t.vat, by_method: Object.fromEntries(methods.map((m) => [m.method, m.amount_lak])) });
  });

  // anything else under /api/v1 is simply unknown (don't fall through to the staff API's 401)
  r.use((_req, _res, next) => next(new HttpError(404, 'ບໍ່ພົບ endpoint ນີ້ໃນ API v1')));
  return r;
}
