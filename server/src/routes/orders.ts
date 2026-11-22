import { Router } from 'express';
import type { Ctx } from '../app.ts';
import { can, requirePerm } from '../auth.ts';
import { now } from '../db.ts';
import { bad, conflict, dayRange, forbidden, int, notFound, num, oneOf, str } from '../lib/core.ts';
import { addItems, createOrder, getBranch, issueQr, loadOrder, orderDetail, payOrder, recalc, requireOpen, type NewItem, type PaymentInput } from '../lib/orders.ts';

const ITEM_FLOW = ['pending', 'preparing', 'ready', 'served'] as const;

export function orderRoutes({ db, emit }: Ctx) {
  const r = Router();
  const changed = (bid: number) => emit(bid, ['orders', 'tables', 'kitchen']);

  /** Floor view: every active table with its open order summary. */
  r.get('/floor', (req, res) => {
    const bid = req.user.bid;
    const zones = db.all('SELECT * FROM zones WHERE branch_id = ? ORDER BY sort, id', bid);
    const tables = db.all(
      `SELECT t.*, o.id AS order_id, o.total AS order_total, o.created_at AS opened_at, o.bill_printed_at,
              (SELECT COALESCE(SUM(qty),0) FROM order_items WHERE order_id = o.id AND status != 'cancelled') AS item_count,
              (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND awaiting = 0 AND status IN ('pending','preparing','ready')) AS in_kitchen,
              (SELECT COALESCE(SUM(qty),0) FROM order_items WHERE order_id = o.id AND awaiting = 1 AND status != 'cancelled') AS awaiting_count,
              (SELECT COUNT(*) FROM qr_calls WHERE order_id = o.id AND handled_at IS NULL) AS calls_open,
              CASE WHEN o.qr_token IS NOT NULL THEN 1 ELSE 0 END AS has_qr
         FROM tables t LEFT JOIN orders o ON o.table_id = t.id AND o.status = 'open'
        WHERE t.branch_id = ? AND t.active = 1 ORDER BY t.sort, t.id`,
      bid,
    );
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
    });
    if (req.body.withQr) {
      issueQr(db, { bid: req.user.bid, uid: req.user.uid, orderId: id, durationHours: int(req.body.durationHours ?? 0, 'ໄລຍະເວລາ', { min: 0, max: 24 }) });
    }
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
    changed(req.user.bid);
    res.status(201).json({ itemIds: ids, order: orderDetail(db, orderId, req.user.bid) });
  });

  r.post('/orders/:id/discount', requirePerm('discount'), (req, res) => {
    const o = loadOrder(db, int(req.params.id, 'id'), req.user.bid);
    requireOpen(o);
    const type = oneOf(req.body.type, 'ປະເພດສ່ວນຫຼຸດ', ['none', 'percent', 'amount']);
    const value = type === 'none' ? 0 : num(req.body.value, 'ສ່ວນຫຼຸດ', { min: 0, max: type === 'percent' ? 100 : 1e12 });
    db.tx(() => {
      db.run('UPDATE orders SET discount_type=?, discount_value=? WHERE id=?', type, value, o.id);
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
    changed(req.user.bid);
    res.json(orderDetail(db, o.id, req.user.bid));
  });

  r.post('/orders/:id/pay', requirePerm('pay'), (req, res) => {
    if (!Array.isArray(req.body.payments)) throw bad('ຂໍ້ມູນການຊຳລະບໍ່ຖືກຕ້ອງ');
    const payments: PaymentInput[] = req.body.payments.map((p: any) => ({
      method: oneOf(p?.method, 'ວິທີຊຳລະ', ['cash', 'transfer', 'qr', 'card']),
      currency: oneOf(p?.currency ?? 'LAK', 'ສະກຸນເງິນ', ['LAK', 'USD', 'THB']),
      amount: num(p?.amount, 'ຈຳນວນເງິນ', { min: 0.01 }),
    }));
    const orderId = int(req.params.id, 'id');
    const result = payOrder(db, { bid: req.user.bid, uid: req.user.uid, orderId, payments });
    changed(req.user.bid);
    res.json({ ...result, order: orderDetail(db, orderId, req.user.bid) });
  });

  r.post('/orders/:id/cancel', requirePerm('pos'), (req, res) => {
    const o = loadOrder(db, int(req.params.id, 'id'), req.user.bid);
    requireOpen(o);
    const active = db.get("SELECT COUNT(*) AS n FROM order_items WHERE order_id = ? AND status != 'cancelled'", o.id)!.n;
    if (active && !can(req.user.role, 'voidItem')) throw forbidden('ອໍເດີມີລາຍການແລ້ວ: ຕ້ອງເປັນຜູ້ຈັດການຈຶ່ງຍົກເລີກໄດ້');
    const reason = str(req.body.reason, 'ເຫດຜົນ', { max: 200, required: active > 0 });
    const ts = now();
    db.tx(() => {
      db.run("UPDATE order_items SET status='cancelled', cancel_reason=?, updated_at=? WHERE order_id=? AND status != 'cancelled'", reason, ts, o.id);
      db.run("UPDATE orders SET status='cancelled', cancel_reason=?, cancelled_at=?, updated_at=? WHERE id=?", reason, ts, ts, o.id);
      recalc(db, o.id);
      db.audit(req.user.bid, req.user.uid, 'cancel', 'order', o.id, { reason, activeItems: active });
    });
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
