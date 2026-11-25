// Read-only business analytics: plain SQL over paid orders, no AI involved.
// The same functions feed the insights page, the AI summary and the AI's question-answering tools.
// Nothing here returns customer names, phone numbers or staff names.
import type { Db } from '../db.ts';
import { bad, dayRange, localDate } from './core.ts';
import { getBranch } from './orders.ts';

const DAY = 86_400_000;

export interface Range {
  from: string;
  to: string;
  days: number;
  start: string; // UTC instants covering [from 00:00, to 24:00) on the branch's clock
  end: string;
  off: number; // branch UTC offset in minutes
}

/** Validate local dates (inclusive) and turn them into UTC bounds for the branch. Default: the last `defDays` days. */
export function rangeOf(db: Db, bid: number, from?: unknown, to?: unknown, defDays = 30): Range {
  const off = getBranch(db, bid).utc_offset_min;
  const today = localDate(new Date(), off);
  const t = to ? String(to) : today;
  const f = from ? String(from) : localDate(new Date(Date.parse(`${t}T12:00:00Z`) - (defDays - 1) * DAY), 0);
  for (const d of [f, t]) if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) throw bad('ວັນທີບໍ່ຖືກຕ້ອງ');
  if (t < f) throw bad('ວັນສິ້ນສຸດຕ້ອງບໍ່ກ່ອນວັນເລີ່ມ');
  const days = Math.round((Date.parse(t) - Date.parse(f)) / DAY) + 1;
  if (days > 366) throw bad('ເລືອກໄລຍະບໍ່ເກີນ 1 ປີ');
  return { from: f, to: t, days, start: dayRange(f, off).start, end: dayRange(t, off).end, off };
}

/** The period of the same length right before `r`. */
export function previousRange(db: Db, bid: number, r: Range): Range {
  const to = localDate(new Date(Date.parse(`${r.from}T12:00:00Z`) - DAY), 0);
  const from = localDate(new Date(Date.parse(`${to}T12:00:00Z`) - (r.days - 1) * DAY), 0);
  return rangeOf(db, bid, from, to);
}

const PAID = "o.branch_id = ? AND o.status = 'paid' AND o.paid_at >= ? AND o.paid_at < ?";

export function salesSummary(db: Db, bid: number, r: Range) {
  const t = db.get(
    `SELECT COUNT(*) AS bills, COALESCE(SUM(total),0) AS sales, COALESCE(SUM(subtotal),0) AS subtotal, COALESCE(SUM(discount),0) AS discount,
            COALESCE(SUM(service),0) AS service, COALESCE(SUM(vat),0) AS vat, COALESCE(SUM(guest_count),0) AS guests
       FROM orders o WHERE ${PAID}`,
    bid, r.start, r.end,
  )!;
  const cost = db.get(`SELECT COALESCE(SUM(oi.qty * oi.unit_cost),0) AS v FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE ${PAID} AND oi.status != 'cancelled'`, bid, r.start, r.end)!.v;
  const cancelled = db.get(
    `SELECT COALESCE(SUM(oi.qty * oi.unit_price),0) AS v FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.branch_id = ? AND oi.status = 'cancelled' AND oi.updated_at >= ? AND oi.updated_at < ? AND oi.menu_item_id IS NOT NULL`,
    bid, r.start, r.end,
  )!.v;
  const methods = db.all(`SELECT p.method, SUM(p.amount_lak) AS amount FROM payments p JOIN orders o ON o.id = p.order_id WHERE ${PAID} GROUP BY p.method ORDER BY amount DESC`, bid, r.start, r.end);
  const net = t.subtotal - t.discount;
  return {
    from: r.from,
    to: r.to,
    days: r.days,
    bills: t.bills,
    sales: t.sales,
    avgBill: t.bills ? Math.round(t.sales / t.bills) : 0,
    salesPerDay: Math.round(t.sales / r.days),
    discount: t.discount,
    discountPct: t.subtotal > 0 ? Math.round((t.discount / t.subtotal) * 1000) / 10 : 0,
    cancelled,
    cancelledPct: t.sales > 0 ? Math.round((cancelled / t.sales) * 1000) / 10 : 0,
    cost,
    grossProfit: net - cost,
    marginPct: net > 0 ? Math.round(((net - cost) / net) * 1000) / 10 : 0,
    byMethod: Object.fromEntries(methods.map((m) => [m.method, m.amount])),
  };
}

export function salesByDay(db: Db, bid: number, r: Range) {
  const m = new Map<string, { bills: number; sales: number }>();
  for (const o of db.all(`SELECT paid_at, total FROM orders o WHERE ${PAID}`, bid, r.start, r.end)) {
    const d = localDate(new Date(o.paid_at), r.off);
    const x = m.get(d) ?? { bills: 0, sales: 0 };
    x.bills++;
    x.sales += o.total;
    m.set(d, x);
  }
  return Array.from({ length: r.days }, (_, i) => {
    const date = new Date(Date.parse(r.from) + i * DAY).toISOString().slice(0, 10);
    return { date, ...(m.get(date) ?? { bills: 0, sales: 0 }) };
  });
}

export function salesByHour(db: Db, bid: number, r: Range) {
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, bills: 0, sales: 0 }));
  for (const o of db.all(`SELECT paid_at, total FROM orders o WHERE ${PAID}`, bid, r.start, r.end)) {
    const h = new Date(Date.parse(o.paid_at) + r.off * 60_000).getUTCHours();
    hours[h].bills++;
    hours[h].sales += o.total;
  }
  return hours;
}

export const WEEKDAYS = ['ອາທິດ', 'ຈັນ', 'ອັງຄານ', 'ພຸດ', 'ພະຫັດ', 'ສຸກ', 'ເສົາ'];

/** Total and average-per-day sales by weekday (counting only the weekdays that occur in the range). */
export function salesByWeekday(db: Db, bid: number, r: Range) {
  const daily = salesByDay(db, bid, r);
  const out = WEEKDAYS.map((name, weekday) => ({ weekday, name, days: 0, bills: 0, sales: 0, avgPerDay: 0 }));
  for (const d of daily) {
    const w = new Date(`${d.date}T12:00:00Z`).getUTCDay();
    out[w].days++;
    out[w].bills += d.bills;
    out[w].sales += d.sales;
  }
  for (const w of out) w.avgPerDay = w.days ? Math.round(w.sales / w.days) : 0;
  return out;
}

export type MenuClass = 'star' | 'plowhorse' | 'puzzle' | 'dog';
export const CLASS_LABEL: Record<MenuClass, string> = { star: 'ດາວເດັ່ນ (ຂາຍດີ ກຳໄລດີ)', plowhorse: 'ຂາຍດີ ແຕ່ກຳໄລຕ່ຳ', puzzle: 'ກຳໄລດີ ແຕ່ຂາຍນ້ອຍ', dog: 'ຂາຍນ້ອຍ ກຳໄລຕ່ຳ' };

/**
 * Menu engineering: each dish is placed by popularity (units sold vs. a fair share) and by profit per unit
 * (vs. the average profit per unit sold). Dishes without a cost price are left unclassified (margin unknown).
 */
export function itemPerformance(db: Db, bid: number, r: Range) {
  const rows = db.all(
    `SELECT oi.name, oi.menu_item_id, SUM(oi.qty) AS qty, SUM(oi.qty * oi.unit_price) AS revenue, SUM(oi.qty * oi.unit_cost) AS cost
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE ${PAID} AND oi.status != 'cancelled' AND oi.menu_item_id IS NOT NULL GROUP BY oi.menu_item_id, oi.name ORDER BY revenue DESC`,
    bid, r.start, r.end,
  );
  const totalQty = rows.reduce((s, x) => s + x.qty, 0);
  const totalProfit = rows.reduce((s, x) => s + (x.revenue - x.cost), 0);
  const avgProfitPerUnit = totalQty ? totalProfit / totalQty : 0;
  const popularCut = rows.length ? (totalQty / rows.length) * 0.7 : 0; // the usual 70%-of-fair-share rule
  return rows.map((x) => {
    const profit = x.revenue - x.cost;
    const unitProfit = x.qty ? profit / x.qty : 0;
    const known = x.cost > 0;
    const popular = x.qty >= popularCut;
    const profitable = unitProfit >= avgProfitPerUnit;
    return {
      id: x.menu_item_id as number,
      name: x.name as string,
      qty: x.qty as number,
      revenue: x.revenue as number,
      cost: x.cost as number,
      profit,
      marginPct: x.revenue > 0 ? Math.round((profit / x.revenue) * 1000) / 10 : 0,
      unitProfit: Math.round(unitProfit),
      class: (known ? (popular ? (profitable ? 'star' : 'plowhorse') : profitable ? 'puzzle' : 'dog') : null) as MenuClass | null,
    };
  });
}

/** Active menu items with no sale at all in the range. */
export function unsoldItems(db: Db, bid: number, r: Range) {
  return db.all(
    `SELECT m.id, m.name, m.price FROM menu_items m
      WHERE m.branch_id = ? AND m.active = 1 AND NOT EXISTS (
        SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE oi.menu_item_id = m.id AND ${PAID} AND oi.status != 'cancelled') ORDER BY m.name`,
    bid, bid, r.start, r.end,
  );
}

export function categoryMix(db: Db, bid: number, r: Range) {
  const rows = db.all(
    `SELECT COALESCE(c.name, 'ອື່ນໆ') AS name, SUM(oi.qty) AS qty, SUM(oi.qty * oi.unit_price) AS revenue, SUM(oi.qty * oi.unit_cost) AS cost
       FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN categories c ON c.id = oi.category_id
      WHERE ${PAID} AND oi.status != 'cancelled' GROUP BY c.id, c.name ORDER BY revenue DESC`,
    bid, r.start, r.end,
  );
  const total = rows.reduce((s, x) => s + x.revenue, 0);
  return rows.map((x) => ({ name: x.name as string, qty: x.qty as number, revenue: x.revenue as number, sharePct: total ? Math.round((x.revenue / total) * 1000) / 10 : 0, marginPct: x.revenue ? Math.round(((x.revenue - x.cost) / x.revenue) * 1000) / 10 : 0 }));
}

export function stockAlerts(db: Db, bid: number) {
  const rows = db.all('SELECT name, unit, stock, low_at FROM ingredients WHERE branch_id = ? AND active = 1', bid);
  return {
    out: rows.filter((i) => i.stock <= 0).map((i) => ({ name: i.name as string, unit: i.unit as string })),
    low: rows.filter((i) => i.stock > 0 && i.low_at > 0 && i.stock <= i.low_at).map((i) => ({ name: i.name as string, unit: i.unit as string, stock: i.stock as number, lowAt: i.low_at as number })),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Rule-based findings (Lao text). Works with no API key; the AI summary is built on top of the same numbers.

export interface Insight {
  level: 'good' | 'warn' | 'info';
  text: string;
}

const kip = (n: number) => `₭${Math.round(n).toLocaleString('en-US')}`;
const pct = (n: number) => `${n > 0 ? '+' : ''}${Math.round(n)}%`;

export function buildInsights(db: Db, bid: number, r: Range): { insights: Insight[]; data: ReturnType<typeof dataPack> } {
  const d = dataPack(db, bid, r);
  const out: Insight[] = [];
  const s = d.summary;
  if (!s.bills) return { insights: [{ level: 'info', text: 'ຍັງບໍ່ມີການຂາຍໃນໄລຍະນີ້ ຈຶ່ງຍັງວິເຄາະບໍ່ໄດ້' }], data: d };

  const p = d.previous;
  if (p.sales > 0) {
    const ch = ((s.sales - p.sales) / p.sales) * 100;
    if (Math.abs(ch) >= 10) out.push({ level: ch > 0 ? 'good' : 'warn', text: `ຍອດຂາຍ ${kip(s.sales)} ${ch > 0 ? 'ເພີ່ມຂຶ້ນ' : 'ຫຼຸດລົງ'} ${pct(ch)} ທຽບກັບໄລຍະກ່ອນໜ້າ (${kip(p.sales)})` });
    else out.push({ level: 'info', text: `ຍອດຂາຍ ${kip(s.sales)} ໃກ້ເຄີຍກັບໄລຍະກ່ອນໜ້າ (${pct(ch)})` });
  }
  if (s.bills >= 5) {
    const bills = d.byHour.filter((h) => h.bills > 0).sort((a, b) => b.sales - a.sales);
    if (bills.length >= 2) {
      const top = bills.slice(0, 2).map((h) => `${String(h.hour).padStart(2, '0')}:00`).join(', ');
      out.push({ level: 'info', text: `ຊ່ວງເວລາຂາຍດີສຸດ: ${top} (ຄວນຈັດພະນັກງານ ແລະ ວັດຖຸດິບໃຫ້ພໍ)` });
    }
  }
  const wd = d.byWeekday.filter((w) => w.days > 0 && w.bills > 0);
  if (r.days >= 14 && wd.length >= 4) {
    const best = [...wd].sort((a, b) => b.avgPerDay - a.avgPerDay)[0];
    const worst = [...wd].sort((a, b) => a.avgPerDay - b.avgPerDay)[0];
    out.push({ level: 'info', text: `ມື້ຂາຍດີສຸດ: ວັນ${best.name} (ສະເລ່ຍ ${kip(best.avgPerDay)}/ມື້), ມື້ເບົາສຸດ: ວັນ${worst.name} (${kip(worst.avgPerDay)}/ມື້) — ລອງເຮັດໂປຣໂມຊັນໃນມື້ເບົາ` });
  }
  const stars = d.items.filter((i) => i.class === 'star').slice(0, 3);
  if (stars.length) out.push({ level: 'good', text: `ເມນູດາວເດັ່ນ (ຂາຍດີ ແລະ ກຳໄລດີ): ${stars.map((i) => i.name).join(', ')} — ຮັກສາຄຸນນະພາບ ແລະ ວາງໃຫ້ເຫັນເດັ່ນ` });
  const horses = d.items.filter((i) => i.class === 'plowhorse').slice(0, 3);
  if (horses.length) out.push({ level: 'warn', text: `ຂາຍດີ ແຕ່ກຳໄລຕໍ່ຈານຕ່ຳ: ${horses.map((i) => `${i.name} (ກຳໄລ ${i.marginPct}%)`).join(', ')} — ພິຈາລະນາປັບລາຄາ ຫຼື ຫຼຸດຕົ້ນທຶນ` });
  const puzzles = d.items.filter((i) => i.class === 'puzzle').slice(0, 3);
  if (puzzles.length) out.push({ level: 'info', text: `ກຳໄລຕໍ່ຈານດີ ແຕ່ຂາຍນ້ອຍ: ${puzzles.map((i) => i.name).join(', ')} — ລອງແນະນຳ/ຈັດໂປຣໂມຊັນ ເພື່ອເພີ່ມຍອດ` });
  const dogs = d.items.filter((i) => i.class === 'dog');
  if (dogs.length >= 2) out.push({ level: 'warn', text: `ຂາຍນ້ອຍ ແລະ ກຳໄລຕ່ຳ ${dogs.length} ເມນູ (ເຊັ່ນ ${dogs.slice(-3).map((i) => i.name).join(', ')}) — ພິຈາລະນາເອົາອອກ ຫຼື ປັບປຸງ` });
  const unclassified = d.items.filter((i) => i.class === null).length;
  if (unclassified > 0) out.push({ level: 'info', text: `${unclassified} ເມນູຍັງບໍ່ມີຕົ້ນທຶນ ຈຶ່ງວິເຄາະກຳໄລບໍ່ໄດ້ — ໃສ່ຕົ້ນທຶນ ຫຼື ສູດອາຫານເພື່ອໃຫ້ຜົນແມ່ນຍຳຂຶ້ນ` });
  if (d.unsold.length) out.push({ level: 'warn', text: `ບໍ່ມີການຂາຍເລີຍໃນໄລຍະນີ້ ${d.unsold.length} ເມນູ${d.unsold.length <= 5 ? ': ' + d.unsold.map((i) => i.name).join(', ') : ''} — ກວດວ່າຄວນເຊື່ອງ/ເອົາອອກບໍ` });
  if (s.discountPct >= 5) out.push({ level: 'warn', text: `ສ່ວນຫຼຸດລວມ ${kip(s.discount)} ຄິດເປັນ ${s.discountPct}% ຂອງຍອດກ່ອນຫຼຸດ — ກວດວ່າຈຳເປັນ ແລະ ຢູ່ໃນການຄວບຄຸມ` });
  if (s.cancelledPct >= 3 && s.cancelled >= 50_000) out.push({ level: 'warn', text: `ຍົກເລີກລາຍການ ${kip(s.cancelled)} (${s.cancelledPct}% ຂອງຍອດຂາຍ) — ກວດເຫດຜົນໃນປະຫວັດການກະທຳ` });
  if (s.marginPct > 0 && s.marginPct < 40 && d.items.some((i) => i.class !== null)) out.push({ level: 'warn', text: `ກຳໄລເບື້ອງຕົ້ນ ${s.marginPct}% ຄ່ອນຂ້າງຕ່ຳ (ກ່ອນຄ່າແຮງງານ/ຄ່າເຊົ່າ)` });
  if (d.stock.out.length) out.push({ level: 'warn', text: `ວັດຖຸດິບໝົດ ${d.stock.out.length} ລາຍການ: ${d.stock.out.slice(0, 5).map((i) => i.name).join(', ')} — ອາດເຮັດໃຫ້ເສຍຍອດຂາຍ` });
  return { insights: out, data: d };
}

/** Everything the AI is allowed to see: aggregated numbers and dish names. No people. */
export function dataPack(db: Db, bid: number, r: Range) {
  const prev = previousRange(db, bid, r);
  const items = itemPerformance(db, bid, r);
  return {
    range: { from: r.from, to: r.to, days: r.days },
    summary: salesSummary(db, bid, r),
    previous: salesSummary(db, bid, prev),
    byDay: salesByDay(db, bid, r),
    byHour: salesByHour(db, bid, r),
    byWeekday: salesByWeekday(db, bid, r),
    items,
    unsold: unsoldItems(db, bid, r),
    categories: categoryMix(db, bid, r),
    stock: stockAlerts(db, bid),
  };
}
