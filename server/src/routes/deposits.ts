// Customer deposits: bottle/crate deposits (money held, refunded on return) and beer stored for a customer.
import { Router } from 'express';
import type { Ctx } from '../app.ts';
import { requirePerm } from '../auth.ts';
import { now } from '../db.ts';
import { bad, int, notFound, oneOf, str } from '../lib/core.ts';
import { getCustomer } from '../lib/debts.ts';
import { requireShift } from '../lib/orders.ts';
import { getBranch } from '../lib/orders.ts';
import { localNow } from './reservations.ts';

export function depositRoutes({ db, emit }: Ctx) {
  const r = Router();
  const changed = (bid: number) => emit(bid, ['shift']);

  // ---------- deposit kinds (admin) ----------
  r.get('/deposit-kinds', requirePerm('pos'), (req, res) => {
    res.json(db.all('SELECT * FROM deposit_kinds WHERE branch_id = ? ORDER BY active DESC, name', req.user.bid));
  });
  const readKind = (b: any, prev?: any) => ({
    name: str(b.name ?? prev?.name, 'ຊື່ປະເພດ', { required: true, max: 60 }),
    amount: int(b.amount ?? prev?.amount, 'ເງິນມັດຈຳ/ໜ່ວຍ', { required: true, min: 1, max: 1e9 }),
    active: b.active === undefined ? (prev?.active ?? 1) : b.active ? 1 : 0,
  });
  r.post('/deposit-kinds', requirePerm('admin'), (req, res) => {
    const v = readKind(req.body ?? {});
    if (db.get('SELECT 1 FROM deposit_kinds WHERE branch_id = ? AND LOWER(name) = LOWER(?)', req.user.bid, v.name)) throw bad('ມີປະເພດຊື່ນີ້ແລ້ວ');
    const { id } = db.run('INSERT INTO deposit_kinds (branch_id, name, amount, active, created_at) VALUES (?,?,?,?,?)', req.user.bid, v.name, v.amount, v.active, now());
    db.audit(req.user.bid, req.user.uid, 'create', 'deposit_kind', id, v);
    res.status(201).json(db.get('SELECT * FROM deposit_kinds WHERE id = ?', id));
  });
  r.put('/deposit-kinds/:id', requirePerm('admin'), (req, res) => {
    const prev = db.get('SELECT * FROM deposit_kinds WHERE id = ? AND branch_id = ?', int(req.params.id, 'id'), req.user.bid);
    if (!prev) throw notFound('ບໍ່ພົບປະເພດມັດຈຳ');
    const v = readKind(req.body ?? {}, prev);
    if (db.get('SELECT 1 FROM deposit_kinds WHERE branch_id = ? AND LOWER(name) = LOWER(?) AND id != ?', req.user.bid, v.name, prev.id)) throw bad('ມີປະເພດຊື່ນີ້ແລ້ວ');
    // The price only affects future deposits; what customers already hold is refunded at what they paid.
    db.run('UPDATE deposit_kinds SET name=?, amount=?, active=? WHERE id=?', v.name, v.amount, v.active, prev.id);
    db.audit(req.user.bid, req.user.uid, 'update', 'deposit_kind', prev.id, v);
    res.json(db.get('SELECT * FROM deposit_kinds WHERE id = ?', prev.id));
  });
  r.delete('/deposit-kinds/:id', requirePerm('admin'), (req, res) => {
    const k = db.get('SELECT * FROM deposit_kinds WHERE id = ? AND branch_id = ?', int(req.params.id, 'id'), req.user.bid);
    if (!k) throw notFound('ບໍ່ພົບປະເພດມັດຈຳ');
    const used = db.get('SELECT 1 FROM deposit_entries WHERE kind_id = ? LIMIT 1', k.id);
    if (used) db.run('UPDATE deposit_kinds SET active = 0 WHERE id = ?', k.id);
    else db.run('DELETE FROM deposit_kinds WHERE id = ?', k.id);
    db.audit(req.user.bid, req.user.uid, 'delete', 'deposit_kind', k.id, { name: k.name });
    res.json({ deleted: !used, deactivated: !!used });
  });

  // ---------- container deposits ----------

  /** What a customer currently holds of one kind: units out and money held for them. */
  const held = (customerId: number, kindId: number) =>
    db.get('SELECT COALESCE(SUM(qty),0) AS qty, COALESCE(SUM(amount),0) AS amount FROM deposit_entries WHERE customer_id = ? AND kind_id = ?', customerId, kindId)! as { qty: number; amount: number };

  /** Everyone who still holds containers, and totals. */
  r.get('/deposits', requirePerm('pos'), (req, res) => {
    const rows = db.all(
      `SELECT e.customer_id, c.name, c.phone, e.kind_id, k.name AS kind, k.amount AS unit_amount, SUM(e.qty) AS qty, SUM(e.amount) AS amount, MIN(CASE WHEN e.qty > 0 THEN e.created_at END) AS since
         FROM deposit_entries e JOIN customers c ON c.id = e.customer_id JOIN deposit_kinds k ON k.id = e.kind_id
        WHERE e.branch_id = ? GROUP BY e.customer_id, e.kind_id HAVING SUM(e.qty) > 0 ORDER BY c.name, k.name`,
      req.user.bid,
    );
    res.json({ rows, totalQty: rows.reduce((s, x) => s + x.qty, 0), totalHeld: rows.reduce((s, x) => s + x.amount, 0) });
  });

  r.get('/deposits/customer/:id', requirePerm('pos'), (req, res) => {
    const c = getCustomer(db, int(req.params.id, 'id'), req.user.bid);
    res.json(
      db.all(
        `SELECT e.*, k.name AS kind, u.name AS user_name FROM deposit_entries e JOIN deposit_kinds k ON k.id = e.kind_id LEFT JOIN users u ON u.id = e.user_id
          WHERE e.customer_id = ? ORDER BY e.id DESC LIMIT 100`,
        c.id,
      ),
    );
  });

  /** The customer takes containers and pays the deposit. Cash goes into the drawer of the open shift. */
  r.post('/deposits/take', requirePerm('pay'), (req, res) => {
    const bid = req.user.bid;
    const c = getCustomer(db, int(req.body.customerId, 'ລູກຄ້າ', { required: true }), bid);
    if (!c.active) throw bad('ລູກຄ້ານີ້ປິດໃຊ້ແລ້ວ');
    const kind = db.get('SELECT * FROM deposit_kinds WHERE id = ? AND branch_id = ?', int(req.body.kindId, 'ປະເພດ', { required: true }), bid);
    if (!kind || !kind.active) throw notFound('ບໍ່ພົບປະເພດມັດຈຳ');
    const qty = int(req.body.qty, 'ຈຳນວນ', { required: true, min: 1, max: 9999 });
    const method = oneOf(req.body.method ?? 'cash', 'ວິທີຊຳລະ', ['cash', 'transfer', 'qr'] as const);
    const note = str(req.body.note, 'ໝາຍເຫດ', { max: 200 });
    const amount = qty * kind.amount;
    const id = db.tx(() => {
      const shift = requireShift(db, bid);
      const { id } = db.run('INSERT INTO deposit_entries (branch_id, customer_id, kind_id, qty, amount, method, shift_id, note, user_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', bid, c.id, kind.id, qty, amount, method, shift.id, note, req.user.uid, now());
      db.audit(bid, req.user.uid, 'deposit_take', 'customer', c.id, { kind: kind.name, qty, amount, method });
      return id;
    });
    changed(bid);
    res.status(201).json({ ...held(c.id, kind.id), amountPaid: amount, id });
  });

  /** The customer returns containers; the money they paid for those units is refunded in cash. */
  r.post('/deposits/return', requirePerm('pay'), (req, res) => {
    const bid = req.user.bid;
    const c = getCustomer(db, int(req.body.customerId, 'ລູກຄ້າ', { required: true }), bid);
    const kind = db.get('SELECT * FROM deposit_kinds WHERE id = ? AND branch_id = ?', int(req.body.kindId, 'ປະເພດ', { required: true }), bid);
    if (!kind) throw notFound('ບໍ່ພົບປະເພດມັດຈຳ');
    const qty = int(req.body.qty, 'ຈຳນວນ', { required: true, min: 1, max: 9999 });
    const note = str(req.body.note, 'ໝາຍເຫດ', { max: 200 });
    const { refund, id } = db.tx(() => {
      const shift = requireShift(db, bid);
      const h = held(c.id, kind.id);
      if (qty > h.qty) throw bad(`ລູກຄ້າຄ້າງຄືນ ${h.qty} ໜ່ວຍເທົ່ານັ້ນ`);
      // Everything paid for the last units is refunded, so rounding never leaves money behind.
      const amount = qty === h.qty ? h.amount : Math.round((h.amount / h.qty) * qty);
      const { id } = db.run("INSERT INTO deposit_entries (branch_id, customer_id, kind_id, qty, amount, method, shift_id, note, user_id, created_at) VALUES (?,?,?,?,?,'cash',?,?,?,?)", bid, c.id, kind.id, -qty, -amount, shift.id, note, req.user.uid, now());
      db.audit(bid, req.user.uid, 'deposit_return', 'customer', c.id, { kind: kind.name, qty, amount });
      return { refund: amount, id };
    });
    changed(bid);
    res.status(201).json({ ...held(c.id, kind.id), refunded: refund, id });
  });

  // ---------- beer stored for a customer ----------

  /** Stored balances, oldest batches used first, so the expiry shown is that of what is really left. */
  function balances(bid: number, customerId?: number) {
    const rows = db.all(
      `SELECT s.*, c.name AS customer_name, c.phone FROM beer_storage s JOIN customers c ON c.id = s.customer_id
        WHERE s.branch_id = ? ${customerId ? 'AND s.customer_id = ?' : ''} ORDER BY s.id`,
      ...(customerId ? [bid, customerId] : [bid]),
    );
    const map = new Map<string, { customer_id: number; customer_name: string; phone: string; item: string; qty: number; batches: { qty: number; expires_on: string; at: string }[]; since: string }>();
    for (const e of rows) {
      const key = `${e.customer_id}|${e.item.toLowerCase()}`;
      const g = map.get(key) ?? { customer_id: e.customer_id, customer_name: e.customer_name, phone: e.phone, item: e.item, qty: 0, batches: [], since: e.created_at };
      if (e.type === 'store') {
        g.batches.push({ qty: e.qty, expires_on: e.expires_on, at: e.created_at });
        g.qty += e.qty;
      } else {
        let need = e.qty;
        g.qty -= e.qty;
        while (need > 0 && g.batches.length) {
          const b = g.batches[0];
          const take = Math.min(b.qty, need);
          b.qty -= take;
          need -= take;
          if (b.qty === 0) g.batches.shift();
        }
      }
      map.set(key, g);
    }
    const today = localNow(getBranch(db, bid).utc_offset_min).date;
    return [...map.values()]
      .filter((g) => g.qty > 0)
      .map((g) => {
        const dates = g.batches.map((b) => b.expires_on).filter(Boolean).sort();
        const next = dates[0] ?? '';
        return { customer_id: g.customer_id, customer_name: g.customer_name, phone: g.phone, item: g.item, qty: g.qty, next_expiry: next, expired: !!next && next < today, since: g.batches[0]?.at ?? g.since };
      })
      .sort((a, b) => a.customer_name.localeCompare(b.customer_name) || a.item.localeCompare(b.item));
  }

  r.get('/beer-storage', requirePerm('pos'), (req, res) => {
    const rows = balances(req.user.bid);
    res.json({ rows, totalQty: rows.reduce((s, x) => s + x.qty, 0), expired: rows.filter((x) => x.expired).length });
  });

  r.get('/beer-storage/customer/:id', requirePerm('pos'), (req, res) => {
    const c = getCustomer(db, int(req.params.id, 'id'), req.user.bid);
    res.json({
      balances: balances(req.user.bid, c.id),
      history: db.all('SELECT s.*, u.name AS user_name FROM beer_storage s LEFT JOIN users u ON u.id = s.user_id WHERE s.customer_id = ? ORDER BY s.id DESC LIMIT 100', c.id),
    });
  });

  const balanceOf = (bid: number, customerId: number, item: string) => balances(bid, customerId).find((x) => x.item.toLowerCase() === item.toLowerCase())?.qty ?? 0;

  function record(req: any, type: 'store' | 'withdraw' | 'discard') {
    const bid = req.user.bid;
    const c = getCustomer(db, int(req.body.customerId, 'ລູກຄ້າ', { required: true }), bid);
    const item = str(req.body.item, 'ຊື່ເບຍ', { required: true, max: 80 });
    const qty = int(req.body.qty, 'ຈຳນວນ', { required: true, min: 1, max: 9999 });
    const note = str(req.body.note, 'ໝາຍເຫດ', { max: 200 });
    let expiresOn = '';
    if (type === 'store') {
      if (!c.active) throw bad('ລູກຄ້ານີ້ປິດໃຊ້ແລ້ວ');
      expiresOn = req.body.expiresOn ? String(req.body.expiresOn) : '';
      if (expiresOn && (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn) || Number.isNaN(Date.parse(expiresOn)))) throw bad('ວັນໝົດອາຍຸບໍ່ຖືກຕ້ອງ');
      if (expiresOn && expiresOn < localNow(getBranch(db, bid).utc_offset_min).date) throw bad('ວັນໝົດອາຍຸຕ້ອງບໍ່ແມ່ນວັນທີ່ຜ່ານມາແລ້ວ');
    }
    return db.tx(() => {
      let name = item;
      if (type !== 'store') {
        const cur = balances(bid, c.id).find((x) => x.item.toLowerCase() === item.toLowerCase());
        if (!cur) throw bad('ລູກຄ້ານີ້ບໍ່ມີເບຍຝາກລາຍການນີ້');
        if (qty > cur.qty) throw bad(`ມີເບຍຝາກ ${cur.qty} ເທົ່ານັ້ນ`);
        name = cur.item;
      } else {
        // Keep one spelling per customer: reuse the name already stored.
        name = balances(bid, c.id).find((x) => x.item.toLowerCase() === item.toLowerCase())?.item ?? item;
      }
      const { id } = db.run('INSERT INTO beer_storage (branch_id, customer_id, item, type, qty, expires_on, note, user_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)', bid, c.id, name, type, qty, expiresOn, note, req.user.uid, now());
      db.audit(bid, req.user.uid, `beer_${type}`, 'customer', c.id, { item: name, qty });
      return { id, item: name, qty: balanceOf(bid, c.id, name), moved: qty, expiresOn };
    });
  }
  r.post('/beer-storage/store', requirePerm('pos'), (req, res) => res.status(201).json(record(req, 'store')));
  r.post('/beer-storage/withdraw', requirePerm('pos'), (req, res) => res.status(201).json(record(req, 'withdraw')));
  /** Throw away expired or spoiled stored beer (manager). */
  r.post('/beer-storage/discard', requirePerm('admin'), (req, res) => res.status(201).json(record(req, 'discard')));

  return r;
}
