// Customers with credit accounts ("ລູກໜີ້"): list, create, ledger and repayments.
import { Router } from 'express';
import type { Ctx } from '../app.ts';
import { can, requirePerm } from '../auth.ts';
import { now } from '../db.ts';
import { bad, int, notFound, num, oneOf, str } from '../lib/core.ts';
import { balanceOf, getCustomer } from '../lib/debts.ts';
import { requireShift } from '../lib/orders.ts';
import { addPoints, pointsOf } from '../lib/loyalty.ts';

export function debtRoutes({ db, emit }: Ctx) {
  const r = Router();
  const changed = (bid: number) => emit(bid, ['shift', 'orders']);

  const withBalance = (c: any) => ({ ...c, balance: balanceOf(db, c.id), points: pointsOf(db, c.id) });

  r.get('/customers', requirePerm('pay'), (req, res) => {
    const q = req.query.q ? `%${String(req.query.q).trim().toLowerCase()}%` : null;
    const rows = db
      .all(
        `SELECT c.*, COALESCE((SELECT SUM(CASE WHEN e.type = 'charge' THEN e.amount ELSE -e.amount END) FROM debt_entries e WHERE e.customer_id = c.id), 0) AS balance,
                (SELECT MAX(e.created_at) FROM debt_entries e WHERE e.customer_id = c.id) AS last_entry,
                (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status = 'paid') AS visits,
                (SELECT COALESCE(SUM(o.total),0) FROM orders o WHERE o.customer_id = c.id AND o.status = 'paid') AS spent,
                (SELECT MAX(o.paid_at) FROM orders o WHERE o.customer_id = c.id AND o.status = 'paid') AS last_visit,
                (SELECT COALESCE(SUM(p.points),0) FROM point_entries p WHERE p.customer_id = c.id) AS points
           FROM customers c WHERE c.branch_id = ? ${q ? 'AND (LOWER(c.name) LIKE ? OR c.phone LIKE ?)' : ''} ORDER BY c.active DESC, balance DESC, c.name`,
        req.user.bid,
        ...(q ? [q, q] : []),
      );
    res.json(rows);
  });

  r.get('/debts/summary', requirePerm('pay'), (req, res) => {
    const rows = db
      .all(
        `SELECT c.id, c.name, c.phone, c.credit_limit,
                COALESCE(SUM(CASE WHEN e.type = 'charge' THEN e.amount ELSE -e.amount END), 0) AS balance
           FROM customers c LEFT JOIN debt_entries e ON e.customer_id = c.id WHERE c.branch_id = ? GROUP BY c.id HAVING balance > 0 ORDER BY balance DESC`,
        req.user.bid,
      );
    res.json({ total: rows.reduce((s, x) => s + x.balance, 0), count: rows.length, top: rows.slice(0, 5) });
  });

  const birthday = (x: unknown) => {
    const v = String(x ?? '').trim();
    if (v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)))) throw bad('ວັນເກີດບໍ່ຖືກຕ້ອງ');
    return v;
  };
  const read = (b: any, prev: any, admin: boolean) => ({
    name: str(b.name ?? prev?.name, 'ຊື່ລູກຄ້າ', { required: true, max: 80 }),
    phone: str(b.phone ?? prev?.phone ?? '', 'ເບີໂທ', { max: 30 }),
    note: str(b.note ?? prev?.note ?? '', 'ໝາຍເຫດ', { max: 200 }),
    // Only managers set the credit limit; a cashier creating a customer on the spot gets "no limit set" (0).
    credit_limit: admin ? num(b.creditLimit ?? prev?.credit_limit ?? 0, 'ວົງເງິນ', { min: 0, max: 1e12 }) : prev?.credit_limit ?? 0,
    active: b.active === undefined ? (prev?.active ?? 1) : b.active ? 1 : 0,
    birthday: birthday(b.birthday ?? prev?.birthday ?? ''),
    tags: str(b.tags ?? prev?.tags ?? '', 'ປ້າຍກຳກັບ', { max: 100 }),
  });

  r.post('/customers', requirePerm('pay'), (req, res) => {
    const v = read(req.body ?? {}, undefined, can(req.user.role, 'admin'));
    if (v.phone && db.get('SELECT 1 FROM customers WHERE branch_id = ? AND phone = ?', req.user.bid, v.phone)) throw bad('ເບີໂທນີ້ມີໃນລະບົບແລ້ວ');
    const { id } = db.run('INSERT INTO customers (branch_id, name, phone, note, credit_limit, active, created_at, birthday, tags) VALUES (?,?,?,?,?,?,?,?,?)', req.user.bid, v.name, v.phone, v.note, v.credit_limit, v.active, now(), v.birthday, v.tags);
    db.audit(req.user.bid, req.user.uid, 'create', 'customer', id, { name: v.name });
    res.status(201).json(withBalance(db.get('SELECT * FROM customers WHERE id = ?', id)));
  });

  r.put('/customers/:id', requirePerm('admin'), (req, res) => {
    const prev = getCustomer(db, int(req.params.id, 'id'), req.user.bid);
    const v = read(req.body ?? {}, prev, true);
    if (v.phone && db.get('SELECT 1 FROM customers WHERE branch_id = ? AND phone = ? AND id != ?', req.user.bid, v.phone, prev.id)) throw bad('ເບີໂທນີ້ມີໃນລະບົບແລ້ວ');
    db.run('UPDATE customers SET name=?, phone=?, note=?, credit_limit=?, active=?, birthday=?, tags=? WHERE id=?', v.name, v.phone, v.note, v.credit_limit, v.active, v.birthday, v.tags, prev.id);
    db.audit(req.user.bid, req.user.uid, 'update', 'customer', prev.id, { name: v.name, creditLimit: v.credit_limit, active: v.active });
    res.json(withBalance(db.get('SELECT * FROM customers WHERE id = ?', prev.id)));
  });

  r.delete('/customers/:id', requirePerm('admin'), (req, res) => {
    const c = getCustomer(db, int(req.params.id, 'id'), req.user.bid);
    if (balanceOf(db, c.id) > 0) throw bad('ລູກຄ້ານີ້ຍັງມີໜີ້ຄ້າງ — ຕ້ອງຮັບຊຳລະໃຫ້ຄົບກ່ອນ');
    const used = db.get('SELECT 1 FROM debt_entries WHERE customer_id = ? UNION ALL SELECT 1 FROM point_entries WHERE customer_id = ? UNION ALL SELECT 1 FROM orders WHERE customer_id = ? LIMIT 1', c.id, c.id, c.id);
    if (used) db.run('UPDATE customers SET active = 0 WHERE id = ?', c.id);
    else db.run('DELETE FROM customers WHERE id = ?', c.id);
    db.audit(req.user.bid, req.user.uid, 'delete', 'customer', c.id, { name: c.name });
    res.json({ deleted: !used, deactivated: !!used });
  });

  r.get('/customers/:id', requirePerm('pay'), (req, res) => {
    const c = getCustomer(db, int(req.params.id, 'id'), req.user.bid);
    const entries = db.all(
      `SELECT e.*, o.bill_no, o.order_no, u.name AS user_name FROM debt_entries e LEFT JOIN orders o ON o.id = e.order_id LEFT JOIN users u ON u.id = e.user_id
        WHERE e.customer_id = ? ORDER BY e.id DESC LIMIT 200`,
      c.id,
    );
    const stats = db.get(
      "SELECT COUNT(*) AS visits, COALESCE(SUM(total),0) AS spent, MAX(paid_at) AS last_visit, MIN(paid_at) AS first_visit FROM orders WHERE customer_id = ? AND status = 'paid'",
      c.id,
    )!;
    const orders = db.all(
      `SELECT o.id, o.bill_no, o.order_no, o.type, o.total, o.paid_at, o.points_used, o.points_earned, o.debt_amount, t.name AS table_name, o.queue_no
         FROM orders o LEFT JOIN tables t ON t.id = o.table_id WHERE o.customer_id = ? AND o.status = 'paid' ORDER BY o.paid_at DESC LIMIT 50`,
      c.id,
    );
    const favorites = db.all(
      `SELECT oi.name, SUM(oi.qty) AS qty FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.customer_id = ? AND o.status = 'paid' AND oi.status != 'cancelled' GROUP BY oi.name ORDER BY qty DESC LIMIT 5`,
      c.id,
    );
    const pointEntries = db.all(
      `SELECT p.*, o.bill_no, u.name AS user_name FROM point_entries p LEFT JOIN orders o ON o.id = p.order_id LEFT JOIN users u ON u.id = p.user_id
        WHERE p.customer_id = ? ORDER BY p.id DESC LIMIT 100`,
      c.id,
    );
    res.json({ customer: withBalance(c), entries, stats, orders, favorites, pointEntries });
  });

  /** Manager adds or removes points by hand (e.g. a gift, a correction). The balance cannot go below zero. */
  r.post('/customers/:id/points', requirePerm('admin'), (req, res) => {
    const c = getCustomer(db, int(req.params.id, 'id'), req.user.bid);
    const points = int(req.body.points, 'ຄະແນນ', { required: true });
    if (!points) throw bad('ຈຳນວນຄະແນນຕ້ອງບໍ່ແມ່ນ 0');
    const note = str(req.body.note, 'ໝາຍເຫດ', { max: 200 });
    const balance = db.tx(() => {
      const cur = pointsOf(db, c.id);
      if (cur + points < 0) throw bad(`ຄະແນນບໍ່ພໍ: ມີ ${cur.toLocaleString('en-US')} ຄະແນນ`);
      addPoints(db, { bid: req.user.bid, uid: req.user.uid, customerId: c.id, type: 'adjust', points, note });
      db.audit(req.user.bid, req.user.uid, 'points_adjust', 'customer', c.id, { points, note, name: c.name });
      return cur + points;
    });
    emit(req.user.bid, ['orders']);
    res.status(201).json({ points: balance });
  });

  /** A customer pays back some or all of what they owe. Cash lands in the drawer of the open shift. */
  r.post('/customers/:id/payments', requirePerm('pay'), (req, res) => {
    const c = getCustomer(db, int(req.params.id, 'id'), req.user.bid);
    const method = oneOf(req.body.method ?? 'cash', 'ວິທີຊຳລະ', ['cash', 'transfer', 'qr', 'card'] as const);
    const amount = Math.round(num(req.body.amount, 'ຈຳນວນເງິນ', { min: 1, max: 1e12 }));
    const note = str(req.body.note, 'ໝາຍເຫດ', { max: 200 });
    const balance = db.tx(() => {
      const shift = requireShift(db, req.user.bid);
      const bal = balanceOf(db, c.id);
      if (amount > bal) throw bad(`ຮັບຊຳລະເກີນໜີ້ຄ້າງ (${bal.toLocaleString('en-US')} ກີບ)`);
      db.run(
        "INSERT INTO debt_entries (branch_id, customer_id, type, amount, order_id, method, shift_id, note, user_id, created_at) VALUES (?,?,'payment',?,NULL,?,?,?,?,?)",
        req.user.bid, c.id, amount, method, shift.id, note, req.user.uid, now(),
      );
      db.audit(req.user.bid, req.user.uid, 'debt_payment', 'customer', c.id, { amount, method, name: c.name });
      return bal - amount;
    });
    changed(req.user.bid);
    res.status(201).json({ balance });
  });

  return r;
}
