// QR self-ordering: staff controls (authenticated) and the public customer API (token in URL).
import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Ctx } from '../app.ts';
import { requirePerm } from '../auth.ts';
import { now } from '../db.ts';
import { HttpError, bad, conflict, int, notFound, oneOf, str } from '../lib/core.ts';
import { portionsMap } from '../lib/inventory.ts';
import { addItems, getBranch, issueQr, loadOrder, recalc, requireOpen, type NewItem } from '../lib/orders.ts';

// ---------------------------------------------------------------- staff

export function qrStaffRoutes({ db, emit, print }: Ctx) {
  const r = Router();
  const touch = (bid: number) => emit(bid, ['orders', 'tables', 'kitchen', 'qr']);

  r.post('/orders/:id/qr', requirePerm('pos'), (req, res) => {
    const id = int(req.params.id, 'id');
    const out = issueQr(db, { bid: req.user.bid, uid: req.user.uid, orderId: id, durationHours: int(req.body.durationHours ?? 0, 'ໄລຍະເວລາ', { min: 0, max: 24 }) });
    touch(req.user.bid);
    res.status(201).json(out);
  });

  r.delete('/orders/:id/qr', requirePerm('pos'), (req, res) => {
    const o = loadOrder(db, int(req.params.id, 'id'), req.user.bid);
    db.run('UPDATE orders SET qr_token = NULL, qr_expires_at = NULL, updated_at = ? WHERE id = ?', now(), o.id);
    db.audit(req.user.bid, req.user.uid, 'revoke_qr', 'order', o.id);
    touch(req.user.bid);
    res.status(204).end();
  });

  const itemIds = (v: unknown): number[] | null => (Array.isArray(v) && v.length ? v.map((x) => int(x, 'ລາຍການ')) : null);

  /** Approve customer items waiting for confirmation → they go to the kitchen. */
  r.post('/orders/:id/approve', requirePerm('pos'), (req, res) => {
    const o = loadOrder(db, int(req.params.id, 'id'), req.user.bid);
    requireOpen(o);
    const ids = itemIds(req.body.itemIds);
    const n = db.tx(() => {
      const rows = db.all("SELECT id FROM order_items WHERE order_id = ? AND awaiting = 1 AND status != 'cancelled'", o.id).map((x) => x.id as number);
      const pick = ids ? rows.filter((x) => ids.includes(x)) : rows;
      for (const id of pick) db.run('UPDATE order_items SET awaiting = 0, updated_at = ? WHERE id = ?', now(), id);
      recalc(db, o.id);
      db.run('UPDATE orders SET bill_printed_at = NULL WHERE id = ?', o.id);
      db.audit(req.user.bid, req.user.uid, 'approve_items', 'order', o.id, { itemIds: pick });
      return pick;
    });
    // Approved customer items now go to the kitchen like any staff order.
    if (n.length && getBranch(db, req.user.bid).auto_kitchen_print) print.kitchen(req.user.bid, o.id, n);
    touch(req.user.bid);
    res.json({ approved: n.length });
  });

  r.post('/orders/:id/reject', requirePerm('pos'), (req, res) => {
    const o = loadOrder(db, int(req.params.id, 'id'), req.user.bid);
    requireOpen(o);
    const ids = itemIds(req.body.itemIds);
    const reason = str(req.body.reason ?? 'ຮ້ານປະຕິເສດ', 'ເຫດຜົນ', { max: 200 });
    const n = db.tx(() => {
      const rows = db.all("SELECT id FROM order_items WHERE order_id = ? AND awaiting = 1 AND status != 'cancelled'", o.id).map((x) => x.id as number);
      const pick = ids ? rows.filter((x) => ids.includes(x)) : rows;
      for (const id of pick) {
        db.run("UPDATE order_items SET status = 'cancelled', awaiting = 0, cancel_reason = ?, updated_at = ? WHERE id = ?", reason, now(), id);
      }
      recalc(db, o.id);
      db.audit(req.user.bid, req.user.uid, 'reject_items', 'order', o.id, { itemIds: pick, reason });
      return pick.length;
    });
    touch(req.user.bid);
    res.json({ rejected: n });
  });

  /** Things staff must react to: items waiting for approval and customer calls. */
  r.get('/qr/alerts', requirePerm('pos'), (req, res) => {
    const calls = db.all(
      `SELECT c.id, c.type, c.created_at, c.order_id, t.name AS table_name
         FROM qr_calls c JOIN orders o ON o.id = c.order_id LEFT JOIN tables t ON t.id = o.table_id
        WHERE c.branch_id = ? AND c.handled_at IS NULL AND o.status = 'open' ORDER BY c.id`,
      req.user.bid,
    );
    const awaiting = db.all(
      `SELECT o.id AS order_id, t.name AS table_name, o.queue_no, o.customer_name, SUM(oi.qty) AS n, MIN(oi.created_at) AS since
         FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN tables t ON t.id = o.table_id
        WHERE o.branch_id = ? AND o.status = 'open' AND oi.awaiting = 1 AND oi.status != 'cancelled'
        GROUP BY o.id ORDER BY since`,
      req.user.bid,
    );
    // Items a customer ordered that went straight to the kitchen (auto-confirm on): staff still need to know, for a few minutes.
    const fresh = db.all(
      `SELECT o.id AS order_id, t.name AS table_name, o.queue_no, o.customer_name, SUM(oi.qty) AS n, MAX(oi.created_at) AS since
         FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN tables t ON t.id = o.table_id
        WHERE o.branch_id = ? AND o.status = 'open' AND oi.source = 'customer' AND oi.awaiting = 0 AND oi.status != 'cancelled' AND oi.created_at >= ?
        GROUP BY o.id ORDER BY since`,
      req.user.bid,
      new Date(Date.now() - 3 * 60_000).toISOString(),
    );
    res.json({ calls, awaiting, fresh });
  });

  r.post('/qr/calls/:id/handle', requirePerm('pos'), (req, res) => {
    const { changes } = db.run(
      'UPDATE qr_calls SET handled_at = ?, handled_by = ? WHERE id = ? AND branch_id = ? AND handled_at IS NULL',
      now(),
      req.user.uid,
      int(req.params.id, 'id'),
      req.user.bid,
    );
    if (!changes) throw notFound('ບໍ່ພົບການເອີ້ນນີ້');
    touch(req.user.bid);
    res.status(204).end();
  });

  return r;
}

// ---------------------------------------------------------------- public (customers)

/** Tiny fixed-window rate limiter, in memory. */
function limiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key: string): boolean => {
    const t = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < t) {
      hits.set(key, { n: 1, reset: t + windowMs });
      if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < t) hits.delete(k);
      return true;
    }
    return ++h.n <= max;
  };
}

const CLOSED_TEXT: Record<string, string> = {
  paid: 'ໂຕະນີ້ປິດແລ້ວ ຂອບໃຈທີ່ໃຊ້ບໍລິການ',
  cancelled: 'ອໍເດີນີ້ຖືກຍົກເລີກແລ້ວ',
  expired: 'QR ນີ້ໝົດເວລາແລ້ວ ກະລຸນາຖາມພະນັກງານ',
};

export function qrPublicRoutes({ db, emit, emitOrder, print }: Ctx) {
  const r = Router();
  const orderLimit = limiter(10, 60_000);
  const callLimit = limiter(4, 60_000);
  const readLimit = limiter(120, 60_000);

  // Every public route first resolves the token to an open order.
  r.use('/:token', (req: Request, res: Response, next: NextFunction) => {
    const token = String(req.params.token);
    if (!readLimit(`${req.ip}:r`)) return next(new HttpError(429, 'ຮ້ອງຂໍຖີ່ເກີນໄປ ກະລຸນາລໍຖ້າສັກຄູ່'));
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return next(notFound('ບໍ່ພົບ QR ນີ້'));
    const o = db.get('SELECT o.*, t.name AS table_name FROM orders o LEFT JOIN tables t ON t.id = o.table_id WHERE o.qr_token = ?', token);
    if (!o) return next(notFound('ບໍ່ພົບ QR ນີ້ ຫຼື ຖືກປ່ຽນໃໝ່ແລ້ວ'));
    const reason = o.status !== 'open' ? o.status : o.qr_expires_at && Date.parse(o.qr_expires_at) < Date.now() ? 'expired' : '';
    if (reason) return void res.status(410).json({ error: CLOSED_TEXT[reason], closed: true, reason });
    res.locals.order = o;
    next();
  });

  r.get('/:token', (_req, res) => {
    const o = res.locals.order;
    const b = getBranch(db, o.branch_id);
    const rest = db.get('SELECT name FROM restaurants WHERE id = ?', b.restaurant_id)!;
    res.json({
      restaurant: rest.name,
      branch: b.name,
      table: o.table_name,
      guestCount: o.guest_count,
      expiresAt: o.qr_expires_at,
      canOrder: !!b.qr_enabled,
      autoConfirm: !!b.qr_auto_confirm,
      serviceRate: b.service_rate,
      vatRate: b.vat_rate,
    });
  });

  r.get('/:token/menu', (_req, res) => {
    const o = res.locals.order;
    const b = getBranch(db, o.branch_id);
    if (!b.qr_enabled) throw new HttpError(403, 'ຮ້ານປິດການສັ່ງອາຫານຜ່ານ QR ຊົ່ວຄາວ ກະລຸນາເອີ້ນພະນັກງານ');
    const categories = db.all('SELECT id, name FROM categories WHERE branch_id = ? AND active = 1 ORDER BY sort, id', o.branch_id);
    const left = portionsMap(db, o.branch_id);
    // Never expose cost or other internal fields to customers.
    const items = db
      .all('SELECT id, category_id, name, price, image_url, options_json FROM menu_items WHERE branch_id = ? AND active = 1 ORDER BY sort, id', o.branch_id)
      .map((i) => ({ id: i.id, category_id: i.category_id, name: i.name, price: i.price, image_url: i.image_url, options: JSON.parse(i.options_json || '[]'), soldOut: left.get(i.id) === 0 }));
    res.json({ categories, items });
  });

  r.post('/:token/orders', (req, res) => {
    const o = res.locals.order;
    const b = getBranch(db, o.branch_id);
    if (!b.qr_enabled) throw new HttpError(403, 'ຮ້ານປິດການສັ່ງອາຫານຜ່ານ QR ຊົ່ວຄາວ ກະລຸນາເອີ້ນພະນັກງານ');
    if (!orderLimit(`${req.params.token}`)) throw new HttpError(429, 'ສົ່ງອໍເດີຖີ່ເກີນໄປ ກະລຸນາລໍຖ້າ 1 ນາທີ');
    const raw = req.body?.items;
    if (!Array.isArray(raw) || !raw.length) throw bad('ກະຕ່າຍັງວ່າງ');
    if (raw.length > 20) throw bad('ສັ່ງໄດ້ບໍ່ເກີນ 20 ລາຍການຕໍ່ຄັ້ງ');
    const items: NewItem[] = raw.map((it: any) => ({
      menuItemId: int(it?.menuItemId, 'ເມນູ', { required: true }),
      qty: int(it?.qty ?? 1, 'ຈຳນວນ', { min: 1, max: 20 }),
      options: Array.isArray(it?.options) ? it.options.slice(0, 20).map((x: any) => ({ group: str(x?.group, 'ກຸ່ມ', { max: 60 }), name: str(x?.name, 'ຕົວເລືອກ', { max: 60 }) })) : [],
      note: str(it?.note, 'ໝາຍເຫດ', { max: 100 }),
    }));
    const awaiting = !b.qr_auto_confirm;
    const ids = addItems(db, { bid: o.branch_id, uid: null, orderId: o.id, items, source: 'customer', awaiting });
    if (!awaiting && b.auto_kitchen_print) print.kitchen(o.branch_id, o.id, ids);
    emit(o.branch_id, ['orders', 'tables', 'kitchen', 'qr']);
    emitOrder(o.id);
    res.status(201).json({ itemIds: ids, awaiting });
  });

  r.get('/:token/orders', (_req, res) => {
    const o = res.locals.order;
    const rows = db.all(
      'SELECT id, name, qty, unit_price, options_json, note, status, awaiting, source, cancel_reason, created_at FROM order_items WHERE order_id = ? ORDER BY id',
      o.id,
    );
    const items = rows.map((i) => ({
      id: i.id,
      name: i.name,
      qty: i.qty,
      price: i.unit_price * i.qty,
      options: JSON.parse(i.options_json || '[]').map((x: any) => x.name),
      note: i.note,
      state: i.status === 'cancelled' ? 'cancelled' : i.awaiting ? 'awaiting' : i.status,
      reason: i.cancel_reason,
      mine: i.source === 'customer',
      createdAt: i.created_at,
    }));
    const awaitingAmount = rows.filter((i) => i.awaiting && i.status !== 'cancelled').reduce((s, i) => s + i.unit_price * i.qty, 0);
    const calls = db.all('SELECT type FROM qr_calls WHERE order_id = ? AND handled_at IS NULL', o.id).map((c) => c.type);
    const b = getBranch(db, o.branch_id);
    res.json({
      items,
      totals: { subtotal: o.subtotal, discount: o.discount, service: o.service, vat: o.vat, total: o.total, awaiting: awaitingAmount },
      pendingCalls: calls,
      // Repeated here so a page that stays open notices when the restaurant changes these settings.
      autoConfirm: !!b.qr_auto_confirm,
      canOrder: !!b.qr_enabled,
    });
  });

  r.post('/:token/call', (req, res) => {
    const o = res.locals.order;
    const type = oneOf(req.body?.type, 'ປະເພດ', ['waiter', 'bill'] as const);
    if (!callLimit(`${req.params.token}`)) throw new HttpError(429, 'ເອີ້ນຖີ່ເກີນໄປ ພະນັກງານກຳລັງມາ');
    const open = db.get('SELECT id FROM qr_calls WHERE order_id = ? AND type = ? AND handled_at IS NULL', o.id, type);
    if (open) return void res.json({ ok: true, duplicate: true });
    if (type === 'bill' && !db.get("SELECT 1 FROM order_items WHERE order_id = ? AND status != 'cancelled' AND awaiting = 0", o.id)) {
      throw conflict('ຍັງບໍ່ມີລາຍການໃນໂຕະ');
    }
    db.run('INSERT INTO qr_calls (branch_id, order_id, type, created_at) VALUES (?,?,?,?)', o.branch_id, o.id, type, now());
    emit(o.branch_id, ['qr', 'tables']);
    emitOrder(o.id);
    res.status(201).json({ ok: true });
  });

  return r;
}
