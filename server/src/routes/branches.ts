// Multiple branches: the owner creates them, switches between them, and compares their sales.
import { Router } from 'express';
import type { Ctx } from '../app.ts';
import { requirePerm } from '../auth.ts';
import { now } from '../db.ts';
import { bad, dayRange, int, localDate, notFound, str } from '../lib/core.ts';

const DAY = 86_400_000;

export function branchRoutes({ db, auth }: Ctx) {
  const r = Router();

  const branchOf = (id: number, rid: number) => {
    const b = db.get('SELECT * FROM branches WHERE id = ? AND restaurant_id = ?', id, rid);
    if (!b) throw notFound('ບໍ່ພົບສາຂານີ້');
    return b;
  };

  r.get('/branches', requirePerm('owner'), (req, res) => {
    const rows = db.all(
      `SELECT b.id, b.name, b.address, b.phone, b.utc_offset_min, b.created_at,
              (SELECT COUNT(*) FROM users u WHERE u.branch_id = b.id AND u.active = 1) AS staff,
              (SELECT COUNT(*) FROM tables t WHERE t.branch_id = b.id AND t.active = 1) AS tables,
              (SELECT COUNT(*) FROM menu_items m WHERE m.branch_id = b.id AND m.active = 1) AS menu_items,
              (SELECT COUNT(*) FROM shifts s WHERE s.branch_id = b.id AND s.closed_at IS NULL) AS shift_open
         FROM branches b WHERE b.restaurant_id = ? ORDER BY b.id`,
      req.user.rid,
    );
    res.json(rows.map((b) => ({ ...b, current: b.id === req.user.bid })));
  });

  /** Copy rows of one branch into another, remapping foreign keys through `maps`. */
  function copyRows(table: string, from: number, to: number, fix: (row: any) => void): Map<number, number> {
    const ids = new Map<number, number>();
    for (const row of db.all(`SELECT * FROM ${table} WHERE branch_id = ? ORDER BY id`, from)) {
      const oldId = row.id as number;
      delete row.id;
      row.branch_id = to;
      fix(row);
      const cols = Object.keys(row);
      const { id } = db.run(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map((c) => row[c]));
      ids.set(oldId, id);
    }
    return ids;
  }

  /** New branch. `copyFrom` copies the settings, floor plan (zones, tables) and menu (categories, items) of an existing branch. */
  r.post('/branches', requirePerm('owner'), (req, res) => {
    const name = str(req.body.name, 'ຊື່ສາຂາ', { required: true, max: 80 });
    if (db.get('SELECT 1 FROM branches WHERE restaurant_id = ? AND LOWER(name) = LOWER(?)', req.user.rid, name)) throw bad('ມີສາຂາຊື່ນີ້ແລ້ວ');
    const src = req.body.copyFrom ? branchOf(int(req.body.copyFrom, 'ສາຂາຕົ້ນແບບ'), req.user.rid) : null;
    const id = db.tx(() => {
      const { id } = db.run('INSERT INTO branches (restaurant_id, name, address, phone, created_at) VALUES (?,?,?,?,?)', req.user.rid, name, str(req.body.address, 'ທີ່ຢູ່', { max: 200 }), str(req.body.phone, 'ເບີໂທ', { max: 30 }), now());
      if (src) {
        const keep = ['vat_rate', 'service_rate', 'rate_usd', 'rate_thb', 'utc_offset_min', 'receipt_header', 'receipt_footer', 'bank_info', 'loyalty_earn_per', 'loyalty_redeem_value', 'qr_enabled', 'qr_auto_confirm', 'auto_kitchen_print'];
        db.run(`UPDATE branches SET ${keep.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keep.map((k) => src[k]), id);
        const zones = copyRows('zones', src.id, id, () => {});
        copyRows('tables', src.id, id, (row) => {
          row.zone_id = row.zone_id ? (zones.get(row.zone_id) ?? null) : null;
        });
        const cats = copyRows('categories', src.id, id, (row) => {
          row.printer_id = null; // printers belong to a branch's own hardware
        });
        copyRows('menu_items', src.id, id, (row) => {
          row.category_id = row.category_id ? (cats.get(row.category_id) ?? null) : null;
          row.cost_from_recipe = 0; // recipes and stock are not copied
        });
      }
      db.audit(id, req.user.uid, 'create', 'branch', id, { name, copiedFrom: src?.id ?? null });
      return id;
    });
    res.status(201).json(db.get('SELECT * FROM branches WHERE id = ?', id));
  });

  r.put('/branches/:id', requirePerm('owner'), (req, res) => {
    const b = branchOf(int(req.params.id, 'id'), req.user.rid);
    const name = str(req.body.name ?? b.name, 'ຊື່ສາຂາ', { required: true, max: 80 });
    if (db.get('SELECT 1 FROM branches WHERE restaurant_id = ? AND LOWER(name) = LOWER(?) AND id != ?', req.user.rid, name, b.id)) throw bad('ມີສາຂາຊື່ນີ້ແລ້ວ');
    db.run('UPDATE branches SET name=?, address=?, phone=? WHERE id=?', name, str(req.body.address ?? b.address, 'ທີ່ຢູ່', { max: 200 }), str(req.body.phone ?? b.phone, 'ເບີໂທ', { max: 30 }), b.id);
    db.audit(b.id, req.user.uid, 'update', 'branch', b.id, { name });
    res.json(db.get('SELECT * FROM branches WHERE id = ?', b.id));
  });

  /** The owner works in another branch: a fresh token whose branch is that one (same person, same login). */
  r.post('/branches/:id/switch', requirePerm('owner'), (req, res) => {
    const b = branchOf(int(req.params.id, 'id'), req.user.rid);
    const user = { ...req.user, bid: b.id };
    db.audit(b.id, req.user.uid, 'switch_branch', 'branch', b.id, { from: req.user.bid });
    res.json({ token: auth.sign(user), user });
  });

  // ---------- comparison report ----------

  /** Sales of one branch between two local dates (inclusive), by that branch's own clock. */
  function stats(b: any, from: string, to: string) {
    const { start } = dayRange(from, b.utc_offset_min);
    const { end } = dayRange(to, b.utc_offset_min);
    const paid = "o.branch_id = ? AND o.status = 'paid' AND o.paid_at >= ? AND o.paid_at < ?";
    const t = db.get(
      `SELECT COUNT(*) AS bills, COALESCE(SUM(total),0) AS sales, COALESCE(SUM(subtotal),0) AS subtotal, COALESCE(SUM(discount),0) AS discount,
              COALESCE(SUM(service),0) AS service, COALESCE(SUM(vat),0) AS vat, COALESCE(SUM(debt_amount),0) AS debt, COALESCE(SUM(guest_count),0) AS guests
         FROM orders o WHERE ${paid}`,
      b.id, start, end,
    )!;
    const cost = db.get(
      `SELECT COALESCE(SUM(oi.qty * oi.unit_cost),0) AS v FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE ${paid} AND oi.status != 'cancelled'`,
      b.id, start, end,
    )!.v;
    const methods = db.all(
      `SELECT p.method, SUM(p.amount_lak) AS amount FROM payments p JOIN orders o ON o.id = p.order_id WHERE ${paid} GROUP BY p.method`,
      b.id, start, end,
    );
    const top = db.all(
      `SELECT oi.name, SUM(oi.qty) AS qty, SUM(oi.qty * oi.unit_price) AS amount FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE ${paid} AND oi.status != 'cancelled' GROUP BY oi.name ORDER BY amount DESC LIMIT 3`,
      b.id, start, end,
    );
    const cancelled = db.get(
      `SELECT COALESCE(SUM(oi.qty * oi.unit_price),0) AS v FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.branch_id = ? AND oi.status = 'cancelled' AND oi.updated_at >= ? AND oi.updated_at < ?`,
      b.id, start, end,
    )!.v;
    const daily = new Map<string, number>();
    for (const o of db.all(`SELECT paid_at, total FROM orders o WHERE ${paid}`, b.id, start, end)) {
      const d = localDate(new Date(o.paid_at), b.utc_offset_min);
      daily.set(d, (daily.get(d) ?? 0) + o.total);
    }
    const net = t.subtotal - t.discount;
    return {
      id: b.id,
      name: b.name,
      bills: t.bills,
      sales: t.sales,
      avgBill: t.bills ? Math.round(t.sales / t.bills) : 0,
      subtotal: t.subtotal,
      discount: t.discount,
      service: t.service,
      vat: t.vat,
      debt: t.debt,
      guests: t.guests,
      cost,
      grossProfit: net - cost,
      margin: net > 0 ? Math.round(((net - cost) / net) * 1000) / 10 : 0,
      cancelled,
      byMethod: Object.fromEntries(methods.map((m) => [m.method, m.amount])) as Record<string, number>,
      top,
      daily,
      openOrders: db.get("SELECT COUNT(*) AS n FROM orders WHERE branch_id = ? AND status = 'open'", b.id)!.n,
      shiftOpen: !!db.get('SELECT 1 FROM shifts WHERE branch_id = ? AND closed_at IS NULL', b.id),
    };
  }

  /** ?from=YYYY-MM-DD&to=YYYY-MM-DD (default: the last 7 days up to today). Owner only. */
  r.get('/reports/branches', requirePerm('owner'), (req, res) => {
    const branches = db.all('SELECT * FROM branches WHERE restaurant_id = ? ORDER BY id', req.user.rid);
    const today = localDate(new Date(), getOffset(branches, req.user.bid));
    const to = req.query.to ? String(req.query.to) : today;
    const from = req.query.from ? String(req.query.from) : localDate(new Date(Date.parse(`${to}T12:00:00Z`) - 6 * DAY), 0);
    for (const d of [from, to]) if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) throw bad('ວັນທີບໍ່ຖືກຕ້ອງ');
    if (to < from) throw bad('ວັນສິ້ນສຸດຕ້ອງບໍ່ກ່ອນວັນເລີ່ມ');
    const days = Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
    if (days > 366) throw bad('ເລືອກໄລຍະບໍ່ເກີນ 1 ປີ');

    const rows = branches.map((b) => stats(b, from, to));
    const dates = Array.from({ length: days }, (_, i) => new Date(Date.parse(from) + i * DAY).toISOString().slice(0, 10));
    const daily = dates.map((date) => ({ date, byBranch: Object.fromEntries(rows.map((x) => [x.id, x.daily.get(date) ?? 0])) }));
    const sum = (k: 'bills' | 'sales' | 'subtotal' | 'discount' | 'service' | 'vat' | 'debt' | 'guests' | 'cost' | 'grossProfit' | 'cancelled') => rows.reduce((s, x) => s + x[k], 0);
    const methods: Record<string, number> = {};
    for (const x of rows) for (const [m, v] of Object.entries(x.byMethod)) methods[m] = (methods[m] ?? 0) + v;
    const totals = { bills: sum('bills'), sales: sum('sales'), discount: sum('discount'), debt: sum('debt'), cost: sum('cost'), grossProfit: sum('grossProfit'), cancelled: sum('cancelled'), guests: sum('guests'), byMethod: methods };
    res.json({
      from,
      to,
      days,
      branches: rows.map(({ daily: _d, ...x }) => ({ ...x, share: totals.sales > 0 ? Math.round((x.sales / totals.sales) * 1000) / 10 : 0 })),
      totals: { ...totals, avgBill: totals.bills ? Math.round(totals.sales / totals.bills) : 0 },
      daily,
    });
  });

  const getOffset = (branches: any[], bid: number) => branches.find((b) => b.id === bid)?.utc_offset_min ?? 420;

  return r;
}
