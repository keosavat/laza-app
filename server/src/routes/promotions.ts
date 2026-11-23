// Promotions and coupon codes: admin CRUD, and applying one to an open order.
import { Router } from 'express';
import type { Ctx } from '../app.ts';
import { requirePerm } from '../auth.ts';
import { now } from '../db.ts';
import { bad, int, notFound, num, oneOf, str } from '../lib/core.ts';
import { getBranch, loadOrder, recalc, requireOpen } from '../lib/orders.ts';
import { promoDiscount, promoProblem, requirePromoOk } from '../lib/promos.ts';

export function promotionRoutes({ db, emit }: Ctx) {
  const r = Router();
  const changed = (bid: number) => emit(bid, ['orders', 'tables', 'kitchen']);
  const date = (v: unknown, label: string) => {
    const s = v ? String(v) : '';
    if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw bad(`${label} ບໍ່ຖືກຕ້ອງ`);
    return s;
  };
  const clock = (v: unknown, label: string) => {
    const s = v ? String(v) : '';
    if (s && !/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw bad(`${label} ບໍ່ຖືກຕ້ອງ`);
    return s;
  };

  const read = (b: any, prev?: any) => {
    const type = oneOf(b.type ?? prev?.type, 'ປະເພດ', ['percent', 'amount'] as const);
    const value = num(b.value ?? prev?.value, 'ມູນຄ່າສ່ວນຫຼຸດ', { min: 0.01, max: type === 'percent' ? 100 : 1e12 });
    const days = String(b.days ?? prev?.days ?? '0123456').replace(/[^0-6]/g, '');
    if (!days) throw bad('ກະລຸນາເລືອກຢ່າງໜ້ອຍ 1 ມື້');
    const v = {
      name: str(b.name ?? prev?.name, 'ຊື່ໂປຣໂມຊັນ', { required: true, max: 80 }),
      code: str(b.code ?? prev?.code ?? '', 'ລະຫັດຄູປອງ', { max: 30 }).toUpperCase().replace(/\s+/g, ''),
      type,
      value,
      min_subtotal: num(b.minSubtotal ?? prev?.min_subtotal ?? 0, 'ຍອດຂັ້ນຕ່ຳ', { min: 0, max: 1e12 }),
      max_discount: num(b.maxDiscount ?? prev?.max_discount ?? 0, 'ສ່ວນຫຼຸດສູງສຸດ', { min: 0, max: 1e12 }),
      starts_on: date(b.startsOn ?? prev?.starts_on, 'ວັນເລີ່ມ'),
      ends_on: date(b.endsOn ?? prev?.ends_on, 'ວັນສິ້ນສຸດ'),
      days,
      time_from: clock(b.timeFrom ?? prev?.time_from, 'ເວລາເລີ່ມ'),
      time_to: clock(b.timeTo ?? prev?.time_to, 'ເວລາສິ້ນສຸດ'),
      order_type: oneOf(b.orderType ?? prev?.order_type ?? 'all', 'ໃຊ້ກັບ', ['all', 'dine_in', 'takeaway'] as const),
      max_uses: Math.round(num(b.maxUses ?? prev?.max_uses ?? 0, 'ຈຳນວນຄັ້ງສູງສຸດ', { min: 0, max: 1e9 })),
      active: b.active === undefined ? (prev?.active ?? 1) : b.active ? 1 : 0,
    };
    if (!!v.time_from !== !!v.time_to) throw bad('ກະລຸນາໃສ່ທັງເວລາເລີ່ມ ແລະ ເວລາສິ້ນສຸດ (ຫຼື ປ່ອຍວ່າງທັງສອງ)');
    if (v.starts_on && v.ends_on && v.ends_on < v.starts_on) throw bad('ວັນສິ້ນສຸດຕ້ອງບໍ່ກ່ອນວັນເລີ່ມ');
    return v;
  };
  const dupCode = (bid: number, code: string, exceptId = 0) => {
    if (code && db.get('SELECT 1 FROM promotions WHERE branch_id = ? AND code = ? AND id != ?', bid, code, exceptId)) throw bad('ລະຫັດຄູປອງນີ້ມີແລ້ວ');
  };

  r.get('/promotions', requirePerm('admin'), (req, res) => {
    res.json(
      db.all(
        `SELECT p.*, (SELECT COALESCE(SUM(o.discount),0) FROM orders o WHERE o.promo_id = p.id AND o.status = 'paid') AS total_discount
           FROM promotions p WHERE p.branch_id = ? ORDER BY p.active DESC, p.id DESC`,
        req.user.bid,
      ),
    );
  });

  r.post('/promotions', requirePerm('admin'), (req, res) => {
    const v = read(req.body ?? {});
    dupCode(req.user.bid, v.code);
    const { id } = db.run(
      `INSERT INTO promotions (branch_id, name, code, type, value, min_subtotal, max_discount, starts_on, ends_on, days, time_from, time_to, order_type, max_uses, active, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      req.user.bid, v.name, v.code, v.type, v.value, v.min_subtotal, v.max_discount, v.starts_on, v.ends_on, v.days, v.time_from, v.time_to, v.order_type, v.max_uses, v.active, now(),
    );
    db.audit(req.user.bid, req.user.uid, 'create', 'promotion', id, { name: v.name, code: v.code });
    res.status(201).json(db.get('SELECT * FROM promotions WHERE id = ?', id));
  });

  r.put('/promotions/:id', requirePerm('admin'), (req, res) => {
    const prev = db.get('SELECT * FROM promotions WHERE id = ? AND branch_id = ?', int(req.params.id, 'id'), req.user.bid);
    if (!prev) throw notFound('ບໍ່ພົບໂປຣໂມຊັນ');
    const v = read(req.body ?? {}, prev);
    dupCode(req.user.bid, v.code, prev.id);
    db.run(
      `UPDATE promotions SET name=?, code=?, type=?, value=?, min_subtotal=?, max_discount=?, starts_on=?, ends_on=?, days=?, time_from=?, time_to=?, order_type=?, max_uses=?, active=? WHERE id=?`,
      v.name, v.code, v.type, v.value, v.min_subtotal, v.max_discount, v.starts_on, v.ends_on, v.days, v.time_from, v.time_to, v.order_type, v.max_uses, v.active, prev.id,
    );
    db.audit(req.user.bid, req.user.uid, 'update', 'promotion', prev.id, { name: v.name, active: v.active });
    changed(req.user.bid);
    res.json(db.get('SELECT * FROM promotions WHERE id = ?', prev.id));
  });

  r.delete('/promotions/:id', requirePerm('admin'), (req, res) => {
    const id = int(req.params.id, 'id');
    const p = db.get('SELECT * FROM promotions WHERE id = ? AND branch_id = ?', id, req.user.bid);
    if (!p) throw notFound('ບໍ່ພົບໂປຣໂມຊັນ');
    const used = db.get('SELECT 1 FROM orders WHERE promo_id = ? LIMIT 1', id);
    if (used) db.run('UPDATE promotions SET active = 0 WHERE id = ?', id);
    else db.run('DELETE FROM promotions WHERE id = ?', id);
    db.audit(req.user.bid, req.user.uid, 'delete', 'promotion', id, { name: p.name });
    changed(req.user.bid);
    res.json({ deleted: !used, deactivated: !!used });
  });

  /** Promotions the cashier can pick for this order right now (coupon-code promotions are not listed). */
  r.get('/orders/:id/promotions', requirePerm('pos'), (req, res) => {
    const o = loadOrder(db, int(req.params.id, 'id'), req.user.bid);
    const off = getBranch(db, req.user.bid).utc_offset_min;
    const sub = (db.get("SELECT COALESCE(SUM(unit_price * qty),0) AS s FROM order_items WHERE order_id = ? AND awaiting = 0 AND status != 'cancelled'", o.id) as any).s;
    const list = db
      .all("SELECT * FROM promotions WHERE branch_id = ? AND active = 1 AND code = '' ORDER BY name", req.user.bid)
      .filter((p) => !promoProblem(p, o, off))
      .map((p) => ({ id: p.id, name: p.name, type: p.type, value: p.value, min_subtotal: p.min_subtotal, max_discount: p.max_discount, estimate: promoDiscount(p, sub), reachable: sub >= p.min_subtotal }));
    res.json({ subtotal: sub, applied: o.promo_id ? { id: o.promo_id, name: o.promo_name } : null, list });
  });

  r.post('/orders/:id/promo', requirePerm('pos'), (req, res) => {
    const o = loadOrder(db, int(req.params.id, 'id'), req.user.bid);
    requireOpen(o);
    const off = getBranch(db, req.user.bid).utc_offset_min;
    let p: any;
    if (req.body.code) {
      const code = String(req.body.code).toUpperCase().replace(/\s+/g, '');
      p = db.get('SELECT * FROM promotions WHERE branch_id = ? AND code = ?', req.user.bid, code);
      if (!p) throw notFound('ບໍ່ພົບລະຫັດຄູປອງນີ້');
    } else {
      p = db.get('SELECT * FROM promotions WHERE branch_id = ? AND id = ?', req.user.bid, int(req.body.promoId, 'ໂປຣໂມຊັນ', { required: true }));
      if (!p) throw notFound('ບໍ່ພົບໂປຣໂມຊັນ');
      if (p.code) throw bad('ໂປຣໂມຊັນນີ້ຕ້ອງໃສ່ລະຫັດຄູປອງ');
    }
    const sub = (db.get("SELECT COALESCE(SUM(unit_price * qty),0) AS s FROM order_items WHERE order_id = ? AND awaiting = 0 AND status != 'cancelled'", o.id) as any).s;
    requirePromoOk(p, o, sub, off);
    db.tx(() => {
      // A promotion replaces any manual discount.
      db.run("UPDATE orders SET promo_id=?, promo_name=?, discount_type='none', discount_value=0 WHERE id=?", p.id, p.name, o.id);
      recalc(db, o.id);
      db.audit(req.user.bid, req.user.uid, 'promo', 'order', o.id, { promo: p.name, code: p.code || undefined });
    });
    changed(req.user.bid);
    res.json({ ok: true });
  });

  r.delete('/orders/:id/promo', requirePerm('pos'), (req, res) => {
    const o = loadOrder(db, int(req.params.id, 'id'), req.user.bid);
    requireOpen(o);
    db.tx(() => {
      db.run("UPDATE orders SET promo_id=NULL, promo_name='' WHERE id=?", o.id);
      recalc(db, o.id);
      db.audit(req.user.bid, req.user.uid, 'promo_remove', 'order', o.id, { promo: o.promo_name });
    });
    changed(req.user.bid);
    res.json({ ok: true });
  });

  return r;
}
