import { Router } from 'express';
import type { Ctx } from '../app.ts';
import { can, requirePerm } from '../auth.ts';
import { now } from '../db.ts';
import { bad, conflict, dayRange, forbidden, int, notFound, num, oneOf, str } from '../lib/core.ts';
import { localNow } from './reservations.ts';
import { TIME_ITEM_NAME, endSession, syncTime } from '../lib/timed.ts';
import { publicOrder, queueEvent } from '../lib/webhooks.ts';
import { addItems, createOrder, getBranch, issueQr, loadOrder, orderDetail, payOrder, recalc, requireOpen, type NewItem, type PaymentInput } from '../lib/orders.ts';

const ITEM_FLOW = ['pending', 'preparing', 'ready', 'served'] as const;

export function orderRoutes({ db, emit, print }: Ctx) {
  /** Kitchen tickets go out automatically unless the branch switched it off. */
  const autoKitchen = (bid: number) => !!getBranch(db, bid).auto_kitchen_print;
  const r = Router();
  const changed = (bid: number) => emit(bid, ['orders', 'tables', 'kitchen']);

  /** Floor view: every active table with its open order summary. */
  r.get('/floor', (req, res) => {
    const bid = req.user.bid;
    // Running table clocks: bring each time line (and order total) up to date before listing.
    for (const s of db.all("SELECT s.order_id FROM table_sessions s JOIN orders o ON o.id = s.order_id WHERE o.branch_id = ? AND o.status = 'open' AND s.ended_at IS NULL", bid)) syncTime(db, s.order_id);
    const zones = db.all('SELECT * FROM zones WHERE branch_id = ? ORDER BY sort, id', bid);
    const tables = db.all(
      `SELECT t.*, o.id AS order_id, o.total AS order_total, o.created_at AS opened_at, o.bill_printed_at,
              (SELECT COALESCE(SUM(qty),0) FROM order_items WHERE order_id = o.id AND status != 'cancelled') AS item_count,
              (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND awaiting = 0 AND status IN ('pending','preparing','ready')) AS in_kitchen,
              (SELECT COALESCE(SUM(qty),0) FROM order_items WHERE order_id = o.id AND awaiting = 1 AND status != 'cancelled') AS awaiting_count,
              (SELECT COUNT(*) FROM qr_calls WHERE order_id = o.id AND handled_at IS NULL) AS calls_open,
              CASE WHEN o.qr_token IS NOT NULL THEN 1 ELSE 0 END AS has_qr,
              ts.started_at AS timer_started_at, ts.paused_at AS timer_paused_at, ts.paused_sec AS timer_paused_sec, ts.ended_at AS timer_ended_at,
              ts.rate AS timer_rate, ts.step AS timer_step, ts.min_minutes AS timer_min
         FROM tables t LEFT JOIN orders o ON o.table_id = t.id AND o.status = 'open' LEFT JOIN table_sessions ts ON ts.order_id = o.id
        WHERE t.branch_id = ? AND t.active = 1 ORDER BY t.sort, t.id`,
      bid,
    );
    // Next waiting reservation per table today (not yet over), shown as a badge on the floor plan.
    const n = localNow(getBranch(db, bid).utc_offset_min);
    const nowMin = Number(n.time.slice(0, 2)) * 60 + Number(n.time.slice(3, 5));
    const next = new Map<number, any>();
    for (const x of db.all("SELECT id, table_id, name, party_size, reserved_time, duration_min FROM reservations WHERE branch_id = ? AND reserved_date = ? AND status = 'booked' AND table_id IS NOT NULL ORDER BY reserved_time", bid, n.date)) {
      const end = Number(x.reserved_time.slice(0, 2)) * 60 + Number(x.reserved_time.slice(3, 5)) + x.duration_min;
      if (end > nowMin && !next.has(x.table_id)) next.set(x.table_id, x);
    }
    for (const t of tables) {
      const x = next.get(t.id);
      t.resv_id = x?.id ?? null;
      t.resv_time = x?.reserved_time ?? null;
      t.resv_name = x?.name ?? null;
      t.resv_party = x?.party_size ?? null;
    }
    res.json({ zones, tables });
  });

  r.get('/orders', (req, res) => {
    const bid = req.user.bid;
    const where = ['o.branch_id = ?'];
    const params: any[] = [bid];
    if (req.query.status) {
      where.push('o.status = ?');
      params.push(oneOf(req.query.status, 'status', ['open', 'paid', 'cancelled']));
    }
    if (req.query.type) {
      where.push('o.type = ?');
      params.push(oneOf(req.query.type, 'type', ['dine_in', 'takeaway']));
    }
    if (req.query.date) {
      const b = getBranch(db, bid);
      const { start, end } = dayRange(String(req.query.date), b.utc_offset_min);
      where.push('COALESCE(o.paid_at, o.cancelled_at, o.created_at) >= ? AND COALESCE(o.paid_at, o.cancelled_at, o.created_at) < ?');
      params.push(start, end);
    }
    const rows = db.all(
      `SELECT o.*, t.name AS table_name, u.name AS paid_by_name,
              (SELECT COALESCE(SUM(qty),0) FROM order_items WHERE order_id = o.id AND status != 'cancelled') AS item_count,
              (SELECT GROUP_CONCAT(DISTINCT method) FROM payments WHERE order_id = o.id) AS methods
         FROM orders o LEFT JOIN tables t ON t.id = o.table_id LEFT JOIN users u ON u.id = o.paid_by
        WHERE ${where.join(' AND ')} ORDER BY o.id DESC LIMIT 500`,
      ...params,
    );
    res.json(rows);
  });

  r.post('/orders', requirePerm('pos'), (req, res) => {
    const type = oneOf(req.body.type, 'ປະເພດອໍເດີ', ['dine_in', 'takeaway']);
    const id = createOrder(db, {
      bid: req.user.bid,
      uid: req.user.uid,
      type,
      tableId: req.body.tableId ? int(req.body.tableId, 'ໂຕະ') : null,
      customerName: str(req.body.customerName, 'ຊື່ລູກຄ້າ', { max: 80 }),
      guestCount: int(req.body.guestCount ?? 0, 'ຈຳນວນແຂກ', { min: 0, max: 200 }),
      startTimer: req.body.startTimer !== false,
    });
    if (req.body.withQr) {
      issueQr(db, { bid: req.user.bid, uid: req.user.uid, orderId: id, durationHours: int(req.body.durationHours ?? 0, 'ໄລຍະເວລາ', { min: 0, max: 24 }) });
    }
    queueEvent(db, req.user.bid, 'order.created', publicOrder(db, id));
    changed(req.user.bid);
    res.status(201).json(orderDetail(db, id, req.user.bid));
  });

  r.get('/orders/:id', (req, res) => {
    res.json(orderDetail(db, int(req.params.id, 'id'), req.user.bid));
  });

  r.patch('/orders/:id', requirePerm('pos'), (req, res) => {
    const o = loadOrder(db, int(req.params.id, 'id'), req.user.bid);
    requireOpen(o);
    db.run(
      'UPDATE orders SET customer_name=?, note=?, updated_at=? WHERE id=?',
      req.body.customerName === undefined ? o.customer_name : str(req.body.customerName, 'ຊື່ລູກຄ້າ', { max: 80 }),
      req.body.note === undefined ? o.note : str(req.body.note, 'ໝາຍເຫດ', { max: 300 }),
      now(),
      o.id,
    );
    changed(req.user.bid);
    res.json(orderDetail(db, o.id, req.user.bid));
  });

  r.post('/orders/:id/items', requirePerm('pos'), (req, res) => {
    if (!Array.isArray(req.body.items)) throw bad('ລາຍການບໍ່ຖືກຕ້ອງ');
    if (req.body.items.length > 100) throw bad('ລາຍການຫຼາຍເກີນໄປ');
    const items: NewItem[] = req.body.items.map((it: any) => ({
      menuItemId: int(it?.menuItemId, 'ເມນູ', { required: true }),
      qty: int(it?.qty ?? 1, 'ຈຳນວນ', { min: 1, max: 999 }),
      options: Array.isArray(it?.options) ? it.options.map((o: any) => ({ group: str(o?.group, 'ກຸ່ມ'), name: str(o?.name, 'ຕົວເລືອກ') })) : [],
      note: str(it?.note, 'ໝາຍເຫດ', { max: 200 }),
    }));
    const orderId = int(req.params.id, 'id');
    const ids = addItems(db, { bid: req.user.bid, uid: req.user.uid, orderId, items });
    // print: true = "order & print to kitchen", false = order only, omitted = follow the branch auto-print setting.
    const wantPrint = req.body.print === undefined ? autoKitchen(req.user.bid) : req.body.print === true;
    const tickets = wantPrint ? print.kitchen(req.user.bid, orderId, ids) : 0;
    changed(req.user.bid);
    res.status(201).json({ itemIds: ids, printedByServer: tickets > 0, order: orderDetail(db, orderId, req.user.bid) });
  });

  r.post('/orders/:id/discount', requirePerm('discount'), (req, res) => {
    const o = loadOrder(db, int(req.params.id, 'id'), req.user.bid);
    requireOpen(o);
    const type = oneOf(req.body.type, 'ປະເພດສ່ວນຫຼຸດ', ['none', 'percent', 'amount']);
    const value = type === 'none' ? 0 : num(req.body.value, 'ສ່ວນຫຼຸດ', { min: 0, max: type === 'percent' ? 100 : 1e12 });
    db.tx(() => {
      db.run("UPDATE orders SET discount_type=?, discount_value=?, promo_id=NULL, promo_name='' WHERE id=?", type, value, o.id);
      recalc(db, o.id);
      db.audit(req.user.bid, req.user.uid, 'discount', 'order', o.id, { type, value });
    });
    changed(req.user.bid);
    res.json(orderDetail(db, o.id, req.user.bid));
  });

  r.post('/orders/:id/transfer', requirePerm('pos'), (req, res) => {
    const o = loadOrder(db, int(req.params.id, 'id'), req.user.bid);
    requireOpen(o);
    if (o.type !== 'dine_in') throw bad('ຍ້າຍໂຕະໄດ້ສະເພາະອໍເດີນັ່ງກິນ');
    const t = db.get('SELECT * FROM tables WHERE id = ? AND branch_id = ? AND active = 1', int(req.body.tableId, 'ໂຕະ'), req.user.bid);
    if (!t) throw notFound('ບໍ່ພົບໂຕະ');
    if (db.get("SELECT 1 FROM orders WHERE table_id = ? AND status = 'open'", t.id)) throw conflict(`ໂຕະ ${t.name} ມີລູກຄ້າແລ້ວ`);
    db.run('UPDATE orders SET table_id=?, updated_at=? WHERE id=?', t.id, now(), o.id);
    db.audit(req.user.bid, req.user.uid, 'transfer', 'order', o.id, { from: o.table_id, to: t.id });
    changed(req.user.bid);
    res.json(orderDetail(db, o.id, req.user.bid));
  });

  r.post('/orders/:id/print-bill', requirePerm('pos'), (req, res) => {
    const o = loadOrder(db, int(req.params.id, 'id'), req.user.bid);
    requireOpen(o);
    db.run('UPDATE orders SET bill_printed_at=? WHERE id=?', now(), o.id);
    const tickets = print.bill(req.user.bid, o.id);
    changed(req.user.bid);
    res.json({ ...orderDetail(db, o.id, req.user.bid), printedByServer: tickets > 0 });
  });

  r.post('/orders/:id/pay', requirePerm('pay'), (req, res) => {
    if (!Array.isArray(req.body.payments)) throw bad('ຂໍ້ມູນການຊຳລະບໍ່ຖືກຕ້ອງ');
    if (req.body.payments.length === 0 && !(req.body.debt?.amount > 0) && !(req.body.redeemPoints > 0)) throw bad('ກະລຸນາເລືອກວິທີຊຳລະ');
    const payments: PaymentInput[] = req.body.payments.map((p: any) => ({
      method: oneOf(p?.method, 'ວິທີຊຳລະ', ['cash', 'transfer', 'qr', 'card']),
      currency: oneOf(p?.currency ?? 'LAK', 'ສະກຸນເງິນ', ['LAK', 'USD', 'THB']),
      amount: num(p?.amount, 'ຈຳນວນເງິນ', { min: 0.01 }),
    }));
    const orderId = int(req.params.id, 'id');
    const debt = req.body.debt?.amount > 0 ? { customerId: int(req.body.debt.customerId, 'ລູກຄ້າ', { required: true }), amount: num(req.body.debt.amount, 'ຍອດຕິດໜີ້', { min: 1 }) } : null;
    const customerId = req.body.customerId ? int(req.body.customerId, 'ລູກຄ້າ') : null;
    const redeemPoints = req.body.redeemPoints ? int(req.body.redeemPoints, 'ຄະແນນ', { min: 0 }) : 0;
    const result = payOrder(db, { bid: req.user.bid, uid: req.user.uid, orderId, payments, debt, customerId, redeemPoints });
    const tickets = req.body.print ? print.receipt(req.user.bid, orderId) : 0;
    queueEvent(db, req.user.bid, 'order.paid', publicOrder(db, orderId));
    changed(req.user.bid);
    res.json({ ...result, printedByServer: tickets > 0, order: orderDetail(db, orderId, req.user.bid) });
  });

  r.post('/orders/:id/cancel', requirePerm('pos'), (req, res) => {
    const o = loadOrder(db, int(req.params.id, 'id'), req.user.bid);
    requireOpen(o);
    // The automatic time line of a time-billed table is not something a waiter ordered: an order with only that line, and no time charged yet, is still "empty".
    const active = db.get("SELECT COUNT(*) AS n FROM order_items WHERE order_id = ? AND status != 'cancelled' AND NOT (menu_item_id IS NULL AND name = ? AND unit_price = 0)", o.id, TIME_ITEM_NAME)!.n;
    if (active && !can(req.user.role, 'voidItem')) throw forbidden('ອໍເດີມີລາຍການແລ້ວ: ຕ້ອງເປັນຜູ້ຈັດການຈຶ່ງຍົກເລີກໄດ້');
    const reason = str(req.body.reason, 'ເຫດຜົນ', { max: 200, required: active > 0 });
    const ts = now();
    db.tx(() => {
      db.run("UPDATE order_items SET status='cancelled', cancel_reason=?, updated_at=? WHERE order_id=? AND status != 'cancelled'", reason, ts, o.id);
      db.run("UPDATE orders SET status='cancelled', cancel_reason=?, cancelled_at=?, updated_at=? WHERE id=?", reason, ts, ts, o.id);
      endSession(db, o.id, { sync: false });
      recalc(db, o.id);
      db.audit(req.user.bid, req.user.uid, 'cancel', 'order', o.id, { reason, activeItems: active });
    });
    queueEvent(db, req.user.bid, 'order.cancelled', publicOrder(db, o.id));
    changed(req.user.bid);
    res.json(orderDetail(db, o.id, req.user.bid));
  });

  // ----- Items -----
  const loadItem = (id: number, bid: number) => {
    const it = db.get(
      'SELECT oi.*, o.status AS order_status FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.id = ? AND o.branch_id = ?',
      id,
      bid,
    );
    if (!it) throw notFound('ບໍ່ພົບລາຍການ');
    return it;
  };

  r.post('/order-items/:id/status', requirePerm('kitchen'), (req, res) => {
    const it = loadItem(int(req.params.id, 'id'), req.user.bid);
    const status = oneOf(req.body.status, 'ສະຖານະ', ITEM_FLOW);
    if (it.status === 'cancelled') throw conflict('ລາຍການນີ້ຖືກຍົກເລີກແລ້ວ');
    db.run('UPDATE order_items SET status=?, updated_at=? WHERE id=?', status, now(), it.id);
    changed(req.user.bid);
    res.json(loadItem(it.id, req.user.bid));
  });

  r.post('/order-items/:id/cancel', requirePerm('voidItem'), (req, res) => {
    const it = loadItem(int(req.params.id, 'id'), req.user.bid);
    if (it.order_status !== 'open') throw conflict('ອໍເດີນີ້ປິດແລ້ວ');
    if (it.status === 'cancelled') throw conflict('ລາຍການນີ້ຖືກຍົກເລີກແລ້ວ');
    const reason = str(req.body.reason, 'ເຫດຜົນ', { required: true, max: 200 });
    const qty = req.body.qty === undefined ? it.qty : int(req.body.qty, 'ຈຳນວນ', { min: 1, max: it.qty });
    const ts = now();
    db.tx(() => {
      if (qty < it.qty) {
        // Partial void: shrink the line and record the voided part as its own cancelled line.
        db.run('UPDATE order_items SET qty = qty - ?, updated_at=? WHERE id=?', qty, ts, it.id);
        db.run(
          `INSERT INTO order_items (order_id, menu_item_id, category_id, name, unit_price, unit_cost, qty, options_json, note, status, created_by, created_at, updated_at, cancel_reason)
           VALUES (?,?,?,?,?,?,?,?,?, 'cancelled', ?,?,?,?)`,
          it.order_id, it.menu_item_id, it.category_id, it.name, it.unit_price, it.unit_cost, qty, it.options_json, it.note, it.created_by, it.created_at, ts, reason,
        );
      } else {
        db.run("UPDATE order_items SET status='cancelled', cancel_reason=?, updated_at=? WHERE id=?", reason, ts, it.id);
      }
      recalc(db, it.order_id);
      db.audit(req.user.bid, req.user.uid, 'void_item', 'order_item', it.id, { qty, reason, name: it.name });
    });
    changed(req.user.bid);
    res.json(orderDetail(db, it.order_id, req.user.bid));
  });

  // ----- Bulk actions on several selected lines of one open order -----
  /** Load the selected lines of an order; every line must exist, be live and be approved. */
  const pickLines = (orderId: number, ids: unknown) => {
    if (!Array.isArray(ids) || !ids.length) throw bad('ກະລຸນາເລືອກລາຍການ');
    if (ids.length > 200) throw bad('ເລືອກຫຼາຍເກີນໄປ');
    const list = [...new Set(ids.map((x) => int(x, 'ລາຍການ')))];
    const rows = db.all(`SELECT * FROM order_items WHERE order_id = ? AND id IN (${list.map(() => '?').join(',')})`, orderId, ...list);
    if (rows.length !== list.length) throw notFound('ບໍ່ພົບບາງລາຍການ');
    for (const r of rows) {
      if (r.status === 'cancelled') throw conflict(`"${r.name}" ຖືກຍົກເລີກແລ້ວ`);
      if (r.awaiting) throw conflict(`"${r.name}" ລໍຖ້າຢືນຢັນ ກະລຸນາຢືນຢັນກ່ອນ`);
    }
    return rows;
  };

  r.post('/orders/:id/items/status', requirePerm('kitchen'), (req, res) => {
    const o = loadOrder(db, int(req.params.id, 'id'), req.user.bid);
    requireOpen(o);
    const status = oneOf(req.body.status, 'ສະຖານະ', ITEM_FLOW);
    db.tx(() => {
      const rows = pickLines(o.id, req.body.itemIds);
      for (const row of rows) db.run('UPDATE order_items SET status = ?, updated_at = ? WHERE id = ?', status, now(), row.id);
    });
    changed(req.user.bid);
    res.json(orderDetail(db, o.id, req.user.bid));
  });

  r.post('/orders/:id/items/cancel', requirePerm('voidItem'), (req, res) => {
    const o = loadOrder(db, int(req.params.id, 'id'), req.user.bid);
    requireOpen(o);
    const reason = str(req.body.reason, 'ເຫດຜົນ', { required: true, max: 200 });
    db.tx(() => {
      const rows = pickLines(o.id, req.body.itemIds);
      const ts = now();
      for (const row of rows) {
        db.run("UPDATE order_items SET status = 'cancelled', cancel_reason = ?, updated_at = ? WHERE id = ?", reason, ts, row.id);
        db.audit(req.user.bid, req.user.uid, 'void_item', 'order_item', row.id, { qty: row.qty, reason, name: row.name });
      }
      recalc(db, o.id);
    });
    changed(req.user.bid);
    res.json(orderDetail(db, o.id, req.user.bid));
  });

  /** Kitchen display: items still being prepared, oldest first. */
  r.get('/kitchen', requirePerm('kitchen'), (req, res) => {
    const rows = db.all(
      `SELECT oi.id, oi.order_id, oi.name, oi.qty, oi.options_json, oi.note, oi.status, oi.created_at, oi.updated_at,
              o.order_no, o.type, o.queue_no, t.name AS table_name, u.name AS created_by_name
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         LEFT JOIN tables t ON t.id = o.table_id LEFT JOIN users u ON u.id = oi.created_by
        WHERE o.branch_id = ? AND oi.awaiting = 0 AND oi.status IN ('pending','preparing','ready') AND o.status != 'cancelled'
        ORDER BY oi.created_at, oi.id`,
      req.user.bid,
    );
    res.json(rows.map((x) => ({ ...x, options: JSON.parse(x.options_json || '[]'), options_json: undefined })));
  });

  return r;
}
