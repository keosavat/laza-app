// Owner overview: "how is every branch doing right now", built for a phone screen.
import { Router } from 'express';
import type { Ctx } from '../app.ts';
import { requirePerm } from '../auth.ts';
import { dayRange, localDate } from '../lib/core.ts';
import { shiftCash } from '../lib/orders.ts';

const DAY = 86_400_000;
const HOUR = 3_600_000;

type Flag = { level: 'warn' | 'info'; branchId: number; branch: string; text: string };

export function ownerRoutes({ db }: Ctx) {
  const r = Router();

  r.get('/owner/overview', requirePerm('owner'), (req, res) => {
    const branches = db.all('SELECT * FROM branches WHERE restaurant_id = ? ORDER BY id', req.user.rid);
    const flags: Flag[] = [];
    const nowMs = Date.now();

    const salesOn = (bid: number, off: number, date: string) => {
      const { start, end } = dayRange(date, off);
      return db.get("SELECT COUNT(*) AS bills, COALESCE(SUM(total),0) AS sales, COALESCE(SUM(discount),0) AS discount FROM orders WHERE branch_id = ? AND status = 'paid' AND paid_at >= ? AND paid_at < ?", bid, start, end)!;
    };

    const rows = branches.map((b) => {
      const today = localDate(new Date(nowMs), b.utc_offset_min);
      const day = (n: number) => localDate(new Date(nowMs - n * DAY), b.utc_offset_min);
      const t = salesOn(b.id, b.utc_offset_min, today);
      const yesterday = salesOn(b.id, b.utc_offset_min, day(1)).sales;
      const lastWeek = salesOn(b.id, b.utc_offset_min, day(7)).sales;
      const { start, end } = dayRange(today, b.utc_offset_min);
      const cancelled = db.get(
        `SELECT COALESCE(SUM(oi.qty * oi.unit_price),0) AS v FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE o.branch_id = ? AND oi.status = 'cancelled' AND oi.updated_at >= ? AND oi.updated_at < ?`,
        b.id, start, end,
      )!.v;
      const open = db.get("SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS total, MIN(created_at) AS oldest FROM orders WHERE branch_id = ? AND status = 'open'", b.id)!;
      const shift = db.get('SELECT s.*, u.name AS opened_by_name FROM shifts s LEFT JOIN users u ON u.id = s.opened_by WHERE s.branch_id = ? AND s.closed_at IS NULL ORDER BY s.id DESC LIMIT 1', b.id);
      const stock = db.get(
        `SELECT COALESCE(SUM(CASE WHEN stock <= 0 THEN 1 ELSE 0 END),0) AS out, COALESCE(SUM(CASE WHEN stock > 0 AND low_at > 0 AND stock <= low_at THEN 1 ELSE 0 END),0) AS low
           FROM ingredients WHERE branch_id = ? AND active = 1`,
        b.id,
      )!;
      const debt = db.get("SELECT COALESCE(SUM(CASE WHEN type = 'charge' THEN amount ELSE -amount END),0) AS v FROM debt_entries WHERE branch_id = ?", b.id)!.v;
      const owedSuppliers = db.get(
        `SELECT COALESCE((SELECT SUM(l.received_value) FROM po_lines l JOIN purchase_orders p ON p.id = l.po_id WHERE p.branch_id = ?), 0)
              - COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE branch_id = ?), 0) AS v`,
        b.id, b.id,
      )!.v;
      const deposits = db.get('SELECT COALESCE(SUM(amount),0) AS v FROM deposit_entries WHERE branch_id = ?', b.id)!.v;

      const name = b.name as string;
      const flag = (level: Flag['level'], text: string) => flags.push({ level, branchId: b.id, branch: name, text });
      const shiftHours = shift ? (nowMs - Date.parse(shift.opened_at)) / HOUR : 0;
      if (shift && shiftHours > 14) flag('warn', `ກະເປີດຄ້າງ ${Math.floor(shiftHours)} ຊົ່ວໂມງ — ຄວນປິດກະ`);
      if (!shift && open.n > 0) flag('warn', `ມີ ${open.n} ອໍເດີຄ້າງ ແຕ່ບໍ່ໄດ້ເປີດກະ`);
      const openHours = open.oldest ? (nowMs - Date.parse(open.oldest)) / HOUR : 0;
      if (open.n > 0 && openHours > 4) flag('warn', `ມີອໍເດີເປີດຄ້າງມາ ${Math.floor(openHours)} ຊົ່ວໂມງ`);
      if (t.sales > 0 && cancelled >= 50_000 && cancelled / t.sales >= 0.05) flag('warn', `ຍົກເລີກລາຍການມື້ນີ້ ${Math.round(cancelled).toLocaleString('en-US')} ກີບ (${Math.round((cancelled / t.sales) * 100)}% ຂອງຍອດຂາຍ)`);
      if (stock.out > 0) flag('warn', `ວັດຖຸດິບໝົດ ${stock.out} ລາຍການ`);
      else if (stock.low > 0) flag('info', `ວັດຖຸດິບໃກ້ໝົດ ${stock.low} ລາຍການ`);
      if (owedSuppliers > 0) flag('info', `ຄ້າງຈ່າຍຜູ້ສະໜອງ ${Math.round(owedSuppliers).toLocaleString('en-US')} ກີບ`);

      return {
        id: b.id,
        name,
        today: { bills: t.bills, sales: t.sales, discount: t.discount, avgBill: t.bills ? Math.round(t.sales / t.bills) : 0, cancelled },
        yesterday,
        lastWeek,
        open: { n: open.n, total: open.total, oldestMin: open.oldest ? Math.round((nowMs - Date.parse(open.oldest)) / 60_000) : 0 },
        shift: shift ? { openedAt: shift.opened_at, by: shift.opened_by_name, expectedCash: shiftCash(db, shift.id).expectedCash } : null,
        stock,
        debt,
        owedSuppliers: Math.round(owedSuppliers),
        deposits,
      };
    });

    // Sales per day for the last 7 days, all branches together (each branch on its own calendar).
    const trend = Array.from({ length: 7 }, (_, i) => {
      const n = 6 - i;
      let sales = 0;
      let date = '';
      for (const b of branches) {
        const d = localDate(new Date(nowMs - n * DAY), b.utc_offset_min);
        date = date || d;
        sales += salesOn(b.id, b.utc_offset_min, d).sales;
      }
      return { date, sales };
    });

    const names = new Map(branches.map((b) => [b.id, b.name as string]));
    const recent = db
      .all(
        `SELECT o.id, o.branch_id, o.bill_no, o.total, o.paid_at, o.type, t.name AS table_name,
                (SELECT GROUP_CONCAT(DISTINCT method) FROM payments WHERE order_id = o.id) AS methods
           FROM orders o LEFT JOIN tables t ON t.id = o.table_id
          WHERE o.status = 'paid' AND o.branch_id IN (${branches.map(() => '?').join(',') || 'NULL'}) ORDER BY o.paid_at DESC LIMIT 8`,
        ...branches.map((b) => b.id),
      )
      .map((o) => ({ ...o, branch: names.get(o.branch_id) }));

    const sum = (f: (x: (typeof rows)[number]) => number) => rows.reduce((s, x) => s + f(x), 0);
    const bills = sum((x) => x.today.bills);
    const sales = sum((x) => x.today.sales);
    res.json({
      at: new Date(nowMs).toISOString(),
      totals: {
        sales,
        bills,
        avgBill: bills ? Math.round(sales / bills) : 0,
        yesterday: sum((x) => x.yesterday),
        lastWeek: sum((x) => x.lastWeek),
        openOrders: sum((x) => x.open.n),
        openTotal: sum((x) => x.open.total),
        cancelled: sum((x) => x.today.cancelled),
        discount: sum((x) => x.today.discount),
        debt: sum((x) => x.debt),
        owedSuppliers: sum((x) => x.owedSuppliers),
        deposits: sum((x) => x.deposits),
        shiftsOpen: rows.filter((x) => x.shift).length,
      },
      branches: rows,
      trend,
      recent,
      flags: flags.sort((a, b) => Number(b.level === 'warn') - Number(a.level === 'warn')),
    });
  });

  return r;
}
