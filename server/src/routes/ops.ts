// Shifts, reports, staff, settings and authentication.
import os from 'node:os';
import { Router } from 'express';
import type { Ctx } from '../app.ts';
import { ROLES, checkPassword, hashPassword, requirePerm, type Role } from '../auth.ts';
import { now } from '../db.ts';
import { HttpError, bad, conflict, dayRange, forbidden, int, localDate, notFound, num, oneOf, str } from '../lib/core.ts';
import { currentShift, getBranch, shiftCash } from '../lib/orders.ts';

export function authRoutes({ db, auth }: Ctx) {
  const r = Router();
  r.post('/login', (req, res) => {
    const username = str(req.body.username, 'ຊື່ຜູ້ໃຊ້', { required: true, max: 60 }).toLowerCase();
    const password = str(req.body.password, 'ລະຫັດຜ່ານ', { required: true, max: 200 });
    const u = db.get('SELECT * FROM users WHERE username = ?', username);
    if (!u || !u.active || !checkPassword(password, u.password_hash)) throw new HttpError(401, 'ຊື່ຜູ້ໃຊ້ ຫຼື ລະຫັດຜ່ານບໍ່ຖືກຕ້ອງ');
    const user = { uid: u.id, rid: u.restaurant_id, bid: u.branch_id, role: u.role as Role, name: u.name };
    db.audit(u.branch_id, u.id, 'login', 'user', u.id);
    res.json({ token: auth.sign(user), user });
  });
  return r;
}

export function opsRoutes({ db, emit, print }: Ctx) {
  const r = Router();

  r.get('/me', (req, res) => {
    const b = getBranch(db, req.user.bid);
    const rest = db.get('SELECT * FROM restaurants WHERE id = ?', req.user.rid);
    res.json({
      user: req.user,
      branch: b,
      restaurant: rest,
      shift: currentShift(db, req.user.bid) ?? null,
      printers: { kitchen: print.hasPrinter(req.user.bid, 'kitchen'), bill: print.hasPrinter(req.user.bid, 'bill') },
    });
  });

  // ----- Shifts -----
  r.get('/shifts/current', (req, res) => {
    const s = currentShift(db, req.user.bid);
    if (!s) return res.json(null);
    const openOrders = db.get("SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS total FROM orders WHERE branch_id = ? AND status = 'open'", req.user.bid);
    const opener = db.get('SELECT name FROM users WHERE id = ?', s.opened_by);
    res.json({ ...s, opened_by_name: opener?.name, summary: shiftCash(db, s.id), openOrders });
  });
  r.get('/shifts', requirePerm('shift'), (req, res) => {
    res.json(
      db.all(
        `SELECT s.*, a.name AS opened_by_name, c.name AS closed_by_name FROM shifts s
           LEFT JOIN users a ON a.id = s.opened_by LEFT JOIN users c ON c.id = s.closed_by
          WHERE s.branch_id = ? ORDER BY s.id DESC LIMIT 60`,
        req.user.bid,
      ),
    );
  });
  r.post('/shifts/open', requirePerm('shift'), (req, res) => {
    const opening = int(req.body.openingCash ?? 0, 'ເງິນທອນຕັ້ງຕົ້ນ', { min: 0 });
    const id = db.tx(() => {
      if (currentShift(db, req.user.bid)) throw conflict('ມີກະທີ່ເປີດຢູ່ແລ້ວ');
      const { id } = db.run(
        "INSERT INTO shifts (branch_id, status, opened_by, opened_at, opening_cash) VALUES (?, 'open', ?, ?, ?)",
        req.user.bid,
        req.user.uid,
        now(),
        opening,
      );
      db.audit(req.user.bid, req.user.uid, 'open', 'shift', id, { opening });
      return id;
    });
    emit(req.user.bid, ['shift']);
    res.status(201).json(db.get('SELECT * FROM shifts WHERE id = ?', id));
  });
  r.post('/shifts/close', requirePerm('shift'), (req, res) => {
    const counted = int(req.body.countedCash, 'ເງິນທີ່ນັບໄດ້', { min: 0, required: true });
    const note = str(req.body.note, 'ໝາຍເຫດ', { max: 500 });
    const out = db.tx(() => {
      const s = currentShift(db, req.user.bid);
      if (!s) throw conflict('ບໍ່ມີກະທີ່ເປີດຢູ່');
      const sum = shiftCash(db, s.id);
      db.run(
        "UPDATE shifts SET status='closed', closed_by=?, closed_at=?, counted_cash=?, expected_cash=?, note=? WHERE id=?",
        req.user.uid,
        now(),
        counted,
        sum.expectedCash,
        note,
        s.id,
      );
      db.audit(req.user.bid, req.user.uid, 'close', 'shift', s.id, { counted, expected: sum.expectedCash });
      return { shift: db.get('SELECT * FROM shifts WHERE id = ?', s.id), summary: sum, variance: counted - sum.expectedCash };
    });
    emit(req.user.bid, ['shift']);
    res.json(out);
  });

  // ----- Reports -----
  r.get('/reports/daily', requirePerm('reports'), (req, res) => {
    const bid = req.user.bid;
    const b = getBranch(db, bid);
    const off = b.utc_offset_min;
    const date = req.query.date ? String(req.query.date) : localDate(new Date(), off);
    const { start, end } = dayRange(date, off);
    const paidIn = "o.branch_id = ? AND o.status = 'paid' AND o.paid_at >= ? AND o.paid_at < ?";

    const totals = db.get(
      `SELECT COUNT(*) AS bills, COALESCE(SUM(total),0) AS sales, COALESCE(SUM(subtotal),0) AS subtotal,
              COALESCE(SUM(discount),0) AS discount, COALESCE(SUM(service),0) AS service, COALESCE(SUM(vat),0) AS vat
         FROM orders o WHERE ${paidIn}`,
      bid, start, end,
    )!;
    const byMethod = db.all(
      `SELECT p.method, COUNT(DISTINCT p.order_id) AS bills, SUM(p.amount_lak) AS amount_lak FROM payments p JOIN orders o ON o.id = p.order_id
        WHERE ${paidIn} GROUP BY p.method ORDER BY amount_lak DESC`,
      bid, start, end,
    );
    const change = db.get(`SELECT COALESCE(SUM(change_lak),0) AS v FROM orders o WHERE ${paidIn}`, bid, start, end)!.v;
    const items = db.all(
      `SELECT oi.name, oi.category_id, SUM(oi.qty) AS qty, SUM(oi.qty * oi.unit_price) AS amount, SUM(oi.qty * oi.unit_cost) AS cost
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE ${paidIn} AND oi.status != 'cancelled' GROUP BY oi.name, oi.category_id ORDER BY qty DESC`,
      bid, start, end,
    );
    const cats = new Map(db.all('SELECT id, name FROM categories WHERE branch_id = ?', bid).map((c) => [c.id, c.name]));
    const byCategory = new Map<string, { name: string; qty: number; amount: number }>();
    for (const it of items) {
      const name = cats.get(it.category_id) ?? 'ອື່ນໆ';
      const c = byCategory.get(name) ?? { name, qty: 0, amount: 0 };
      c.qty += it.qty;
      c.amount += it.amount;
      byCategory.set(name, c);
    }
    const byStaff = db.all(
      `SELECT u.name, COUNT(*) AS bills, SUM(o.total) AS amount FROM orders o LEFT JOIN users u ON u.id = o.paid_by
        WHERE ${paidIn} GROUP BY o.paid_by ORDER BY amount DESC`,
      bid, start, end,
    );
    const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, bills: 0, amount: 0 }));
    for (const o of db.all(`SELECT paid_at, total FROM orders o WHERE ${paidIn}`, bid, start, end)) {
      const h = new Date(Date.parse(o.paid_at) + off * 60_000).getUTCHours();
      hours[h].bills++;
      hours[h].amount += o.total;
    }
    const cancelled = db.get(
      `SELECT COUNT(*) AS lines, COALESCE(SUM(oi.qty * oi.unit_price),0) AS amount FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.branch_id = ? AND oi.status = 'cancelled' AND oi.updated_at >= ? AND oi.updated_at < ?`,
      bid, start, end,
    )!;
    const open = db.all(
      `SELECT o.id, o.type, o.total, o.created_at, o.queue_no, t.name AS table_name FROM orders o LEFT JOIN tables t ON t.id = o.table_id
        WHERE o.branch_id = ? AND o.status = 'open' ORDER BY o.created_at`,
      bid,
    );
    const trend = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.parse(`${date}T12:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10);
      const rg = dayRange(d, off);
      const v = db.get(`SELECT COUNT(*) AS bills, COALESCE(SUM(total),0) AS sales FROM orders o WHERE ${paidIn}`, bid, rg.start, rg.end)!;
      trend.push({ date: d, ...v });
    }
    const cost = items.reduce((s, x) => s + x.cost, 0);
    res.json({
      date,
      totals: { ...totals, avg: totals.bills ? Math.round(totals.sales / totals.bills) : 0, change, cost, grossProfit: totals.subtotal - totals.discount - cost },
      byMethod,
      topItems: items.slice(0, 10),
      byCategory: [...byCategory.values()].sort((a, b) => b.amount - a.amount),
      byStaff,
      byHour: hours,
      cancelled,
      open: { count: open.length, total: open.reduce((s, o) => s + o.total, 0), orders: open },
      trend,
    });
  });

  // ----- Staff -----
  const userOut = (u: any) => ({ id: u.id, name: u.name, username: u.username, role: u.role, active: u.active, created_at: u.created_at });
  r.get('/users', requirePerm('admin'), (req, res) => {
    res.json(db.all('SELECT * FROM users WHERE branch_id = ? ORDER BY id', req.user.bid).map(userOut));
  });
  const assignableRole = (actor: Role, v: unknown): Role => {
    const role = oneOf(v, 'ໜ້າທີ່', ROLES);
    if (role === 'owner' && actor !== 'owner') throw forbidden('ສະເພາະເຈົ້າຂອງຮ້ານຈຶ່ງຕັ້ງສິດເຈົ້າຂອງໄດ້');
    return role;
  };
  r.post('/users', requirePerm('admin'), (req, res) => {
    const username = str(req.body.username, 'ຊື່ຜູ້ໃຊ້', { required: true, max: 40 }).toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw bad('ຊື່ຜູ້ໃຊ້: ໃຊ້ a-z, 0-9, . _ - ຢ່າງໜ້ອຍ 3 ຕົວ');
    const password = str(req.body.password, 'ລະຫັດຜ່ານ', { required: true, max: 200 });
    if (password.length < 6) throw bad('ລະຫັດຜ່ານຕ້ອງມີຢ່າງໜ້ອຍ 6 ຕົວ');
    if (db.get('SELECT 1 FROM users WHERE username = ?', username)) throw conflict('ຊື່ຜູ້ໃຊ້ນີ້ມີແລ້ວ');
    const { id } = db.run(
      'INSERT INTO users (restaurant_id, branch_id, name, username, password_hash, role, active, created_at) VALUES (?,?,?,?,?,?,1,?)',
      req.user.rid,
      req.user.bid,
      str(req.body.name, 'ຊື່', { required: true, max: 80 }),
      username,
      hashPassword(password),
      assignableRole(req.user.role, req.body.role),
      now(),
    );
    db.audit(req.user.bid, req.user.uid, 'create', 'user', id);
    res.status(201).json(userOut(db.get('SELECT * FROM users WHERE id = ?', id)));
  });
  r.put('/users/:id', requirePerm('admin'), (req, res) => {
    const u = db.get('SELECT * FROM users WHERE id = ? AND branch_id = ?', int(req.params.id, 'id'), req.user.bid);
    if (!u) throw notFound();
    if (u.role === 'owner' && req.user.role !== 'owner') throw forbidden('ແກ້ໄຂບັນຊີເຈົ້າຂອງບໍ່ໄດ້');
    const role = req.body.role === undefined ? u.role : assignableRole(req.user.role, req.body.role);
    const active = req.body.active === undefined ? u.active : req.body.active ? 1 : 0;
    if (u.id === req.user.uid && (!active || role !== u.role)) throw bad('ບໍ່ສາມາດປ່ຽນສິດ ຫຼື ປິດບັນຊີຂອງຕົນເອງ');
    let hash = u.password_hash;
    if (req.body.password) {
      const pw = str(req.body.password, 'ລະຫັດຜ່ານ', { max: 200 });
      if (pw.length < 6) throw bad('ລະຫັດຜ່ານຕ້ອງມີຢ່າງໜ້ອຍ 6 ຕົວ');
      hash = hashPassword(pw);
    }
    db.run(
      'UPDATE users SET name=?, role=?, active=?, password_hash=? WHERE id=?',
      str(req.body.name ?? u.name, 'ຊື່', { required: true, max: 80 }),
      role,
      active,
      hash,
      u.id,
    );
    db.audit(req.user.bid, req.user.uid, 'update', 'user', u.id, { role, active, passwordChanged: hash !== u.password_hash });
    res.json(userOut(db.get('SELECT * FROM users WHERE id = ?', u.id)));
  });

  // ----- Settings -----
  r.get('/settings', (req, res) => {
    // Addresses other devices on the same Wi-Fi can use to reach this server (for customer QR links).
    const port = req.socket.localPort;
    const lanUrls = Object.values(os.networkInterfaces())
      .flat()
      .filter((n) => n && n.family === 'IPv4' && !n.internal)
      .map((n) => `http://${n!.address}:${port}`);
    res.json({ branch: getBranch(db, req.user.bid), restaurant: db.get('SELECT * FROM restaurants WHERE id = ?', req.user.rid), lanUrls });
  });
  r.put('/settings', requirePerm('admin'), (req, res) => {
    const b = getBranch(db, req.user.bid);
    const v = req.body ?? {};
    const pick = <T>(key: string, fallback: T, read: (x: unknown) => T): T => (v[key] === undefined ? fallback : read(v[key]));
    db.tx(() => {
      if (v.restaurantName !== undefined) {
        db.run('UPDATE restaurants SET name=? WHERE id=?', str(v.restaurantName, 'ຊື່ຮ້ານ', { required: true, max: 120 }), req.user.rid);
      }
      db.run(
        `UPDATE branches SET name=?, address=?, phone=?, vat_rate=?, service_rate=?, rate_usd=?, rate_thb=?, receipt_header=?, receipt_footer=?, bank_info=?,
           qr_enabled=?, qr_auto_confirm=?, public_url=?, auto_kitchen_print=? WHERE id=?`,
        pick('name', b.name, (x) => str(x, 'ຊື່ສາຂາ', { required: true, max: 120 })),
        pick('address', b.address, (x) => str(x, 'ທີ່ຢູ່', { max: 300 })),
        pick('phone', b.phone, (x) => str(x, 'ເບີໂທ', { max: 60 })),
        pick('vat_rate', b.vat_rate, (x) => num(x, 'VAT', { min: 0, max: 100 })),
        pick('service_rate', b.service_rate, (x) => num(x, 'ຄ່າບໍລິການ', { min: 0, max: 100 })),
        pick('rate_usd', b.rate_usd, (x) => num(x, 'ອັດຕາ USD', { min: 1 })),
        pick('rate_thb', b.rate_thb, (x) => num(x, 'ອັດຕາ THB', { min: 1 })),
        pick('receipt_header', b.receipt_header, (x) => str(x, 'ຫົວໃບບິນ', { max: 500 })),
        pick('receipt_footer', b.receipt_footer, (x) => str(x, 'ທ້າຍໃບບິນ', { max: 500 })),
        pick('bank_info', b.bank_info, (x) => str(x, 'ຂໍ້ມູນທະນາຄານ', { max: 500 })),
        pick('qr_enabled', b.qr_enabled, (x) => (x ? 1 : 0)),
        pick('qr_auto_confirm', b.qr_auto_confirm, (x) => (x ? 1 : 0)),
        pick('public_url', b.public_url, (x) => {
          const u = str(x, 'ທີ່ຢູ່ເວັບ', { max: 200 }).replace(/\/+$/, '');
          if (u && !/^https?:\/\/[^\s/]+(:\d+)?$/i.test(u)) throw bad('ທີ່ຢູ່ເວັບຕ້ອງຂຶ້ນຕົ້ນດ້ວຍ http:// ຫຼື https:// ເຊັ່ນ http://192.168.1.10:4000');
          return u;
        }),
        pick('auto_kitchen_print', b.auto_kitchen_print, (x) => (x ? 1 : 0)),
        b.id,
      );
      db.audit(req.user.bid, req.user.uid, 'update', 'settings', b.id, v);
    });
    emit(req.user.bid, ['settings']);
    res.json({ branch: getBranch(db, req.user.bid), restaurant: db.get('SELECT * FROM restaurants WHERE id = ?', req.user.rid) });
  });

  r.get('/audit', requirePerm('admin'), (req, res) => {
    const off = getBranch(db, req.user.bid).utc_offset_min;
    const where = ['a.branch_id = ?'];
    const args: (string | number)[] = [req.user.bid];
    const q = req.query;
    if (q.user) { where.push('a.user_id = ?'); args.push(int(q.user, 'ພະນັກງານ')); }
    if (q.action) { where.push('a.action = ?'); args.push(String(q.action)); }
    if (q.entity) { where.push('a.entity = ?'); args.push(String(q.entity)); }
    if (q.from) { where.push('a.created_at >= ?'); args.push(dayRange(String(q.from), off).start); }
    if (q.to) { where.push('a.created_at < ?'); args.push(dayRange(String(q.to), off).end); }
    const limit = Math.min(500, Math.max(1, Number(q.limit) || 100));
    const offset = Math.max(0, Number(q.offset) || 0);
    const rows = db.all(
      `SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
      ...args, limit + 1, offset,
    );
    const actions = db.all('SELECT DISTINCT action FROM audit_log WHERE branch_id = ? ORDER BY action', req.user.bid).map((x: any) => x.action);
    res.json({ rows: rows.slice(0, limit), hasMore: rows.length > limit, actions });
  });

  return r;
}
