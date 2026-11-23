import crypto from 'node:crypto';
import type { Db, Row } from '../db.ts';
import { now } from '../db.ts';
import { bad, calcTotals, conflict, notFound, type DiscountType } from './core.ts';
import { deductForOrder, portionsMap } from './inventory.ts';
import { promoDiscount } from './promos.ts';

export function getBranch(db: Db, bid: number): Row {
  const b = db.get('SELECT * FROM branches WHERE id = ?', bid);
  if (!b) throw notFound('ບໍ່ພົບສາຂາ');
  return b;
}

export function currentShift(db: Db, bid: number): Row | undefined {
  return db.get("SELECT * FROM shifts WHERE branch_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1", bid);
}

export function requireShift(db: Db, bid: number): Row {
  const s = currentShift(db, bid);
  if (!s) throw conflict('ຍັງບໍ່ໄດ້ເປີດກະ ກະລຸນາເປີດກະກ່ອນ');
  return s;
}

export function loadOrder(db: Db, orderId: number, bid: number): Row {
  const o = db.get('SELECT * FROM orders WHERE id = ? AND branch_id = ?', orderId, bid);
  if (!o) throw notFound('ບໍ່ພົບອໍເດີ');
  return o;
}

export function requireOpen(o: Row) {
  if (o.status !== 'open') throw conflict('ອໍເດີນີ້ປິດແລ້ວ');
}

/** Recompute and persist money totals for an order. */
export function recalc(db: Db, orderId: number) {
  const o = db.get('SELECT * FROM orders WHERE id = ?', orderId)!;
  const b = db.get('SELECT vat_rate, service_rate FROM branches WHERE id = ?', o.branch_id)!;
  // Items still waiting for staff approval (customer QR orders) are not billed yet.
  const items = db.all('SELECT unit_price, qty, status FROM order_items WHERE order_id = ? AND awaiting = 0', orderId) as {
    unit_price: number;
    qty: number;
    status: string;
  }[];
  // An attached promotion drives the discount (re-evaluated as items change); otherwise the manual discount applies.
  let discountType = o.discount_type as DiscountType;
  let discountValue = o.discount_value;
  if (o.promo_id) {
    const p = db.get('SELECT * FROM promotions WHERE id = ?', o.promo_id);
    const sub = calcTotals({ items, discountType: 'none', discountValue: 0, serviceRate: 0, vatRate: 0 }).subtotal;
    discountType = 'amount';
    discountValue = p ? promoDiscount(p, sub) : 0;
  }
  const t = calcTotals({
    items,
    discountType,
    discountValue,
    serviceRate: o.type === 'dine_in' ? b.service_rate : 0,
    vatRate: b.vat_rate,
  });
  db.run(
    'UPDATE orders SET subtotal=?, discount=?, service=?, vat=?, total=?, updated_at=? WHERE id=?',
    t.subtotal,
    t.discount,
    t.service,
    t.vat,
    t.total,
    now(),
    orderId,
  );
  return t;
}

const parseItem = (it: Row) => ({ ...it, options: JSON.parse(it.options_json || '[]'), options_json: undefined });

export function orderDetail(db: Db, orderId: number, bid: number) {
  const o = db.get(
    `SELECT o.*, t.name AS table_name, u.name AS created_by_name
       FROM orders o LEFT JOIN tables t ON t.id = o.table_id LEFT JOIN users u ON u.id = o.created_by
      WHERE o.id = ? AND o.branch_id = ?`,
    orderId,
    bid,
  );
  if (!o) throw notFound('ບໍ່ພົບອໍເດີ');
  const items = db
    .all(
      `SELECT oi.*, u.name AS created_by_name FROM order_items oi LEFT JOIN users u ON u.id = oi.created_by
        WHERE oi.order_id = ? ORDER BY oi.id`,
      orderId,
    )
    .map(parseItem);
  const payments = db.all('SELECT * FROM payments WHERE order_id = ? ORDER BY id', orderId);
  return { ...o, items, payments };
}

function nextSeq(db: Db, bid: number, col: 'order_seq' | 'bill_seq'): number {
  db.run(`UPDATE branches SET ${col} = ${col} + 1 WHERE id = ?`, bid);
  return db.get(`SELECT ${col} AS v FROM branches WHERE id = ?`, bid)!.v;
}

export function createOrder(
  db: Db,
  p: { bid: number; uid: number; type: 'dine_in' | 'takeaway'; tableId: number | null; customerName: string; guestCount?: number },
) {
  return db.tx(() => {
    const shift = requireShift(db, p.bid);
    if (p.type === 'dine_in') {
      if (!p.tableId) throw bad('ກະລຸນາເລືອກໂຕະ');
      const t = db.get('SELECT * FROM tables WHERE id = ? AND branch_id = ? AND active = 1', p.tableId, p.bid);
      if (!t) throw notFound('ບໍ່ພົບໂຕະ');
      const existing = db.get("SELECT id FROM orders WHERE table_id = ? AND status = 'open'", p.tableId);
      if (existing) throw conflict(`ໂຕະ ${t.name} ມີອໍເດີເປີດຢູ່ແລ້ວ`);
    }
    let queueNo: number | null = null;
    if (p.type === 'takeaway') {
      db.run('UPDATE shifts SET queue_seq = queue_seq + 1 WHERE id = ?', shift.id);
      queueNo = db.get('SELECT queue_seq AS v FROM shifts WHERE id = ?', shift.id)!.v;
    }
    const seq = nextSeq(db, p.bid, 'order_seq');
    const ts = now();
    const { id } = db.run(
      `INSERT INTO orders (branch_id, shift_id, order_no, type, table_id, queue_no, status, customer_name, guest_count, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?, 'open', ?,?,?,?,?)`,
      p.bid,
      shift.id,
      String(seq).padStart(6, '0'),
      p.type,
      p.type === 'dine_in' ? p.tableId : null,
      queueNo,
      p.customerName,
      p.guestCount ?? 0,
      p.uid,
      ts,
      ts,
    );
    db.audit(p.bid, p.uid, 'create', 'order', id, { type: p.type, tableId: p.tableId });
    return id;
  });
}

export interface NewItem {
  menuItemId: number;
  qty: number;
  options: { group: string; name: string; price: number }[];
  note: string;
}

/** Validate selected options against the menu item's option groups; returns chosen options with server-side prices. */
function resolveOptions(menuItem: Row, chosen: { group: string; name: string }[]) {
  const groups = JSON.parse(menuItem.options_json || '[]') as {
    name: string;
    required?: boolean;
    multiple?: boolean;
    choices: { name: string; price: number }[];
  }[];
  const out: { group: string; name: string; price: number }[] = [];
  for (const c of chosen) {
    const g = groups.find((x) => x.name === c.group);
    const ch = g?.choices.find((x) => x.name === c.name);
    if (!g || !ch) throw bad(`ຕົວເລືອກ "${c.group}: ${c.name}" ບໍ່ຖືກຕ້ອງ`);
    out.push({ group: g.name, name: ch.name, price: Math.round(ch.price || 0) });
  }
  for (const g of groups) {
    const n = out.filter((o) => o.group === g.name).length;
    if (g.required && n === 0) throw bad(`ກະລຸນາເລືອກ "${g.name}" ສຳລັບ ${menuItem.name}`);
    if (!g.multiple && n > 1) throw bad(`"${g.name}" ເລືອກໄດ້ພຽງອັນດຽວ`);
  }
  return out;
}

export function addItems(
  db: Db,
  p: { bid: number; uid: number | null; orderId: number; items: NewItem[]; source?: 'staff' | 'customer'; awaiting?: boolean },
) {
  if (!p.items.length) throw bad('ບໍ່ມີລາຍການທີ່ຈະສົ່ງ');
  return db.tx(() => {
    const o = loadOrder(db, p.orderId, p.bid);
    requireOpen(o);
    if (p.awaiting) {
      // Stop a bored customer from flooding the approval queue.
      const waiting = db.get("SELECT COALESCE(SUM(qty),0) AS n FROM order_items WHERE order_id = ? AND awaiting = 1 AND status != 'cancelled'", o.id)!.n;
      if (waiting + p.items.reduce((s, i) => s + i.qty, 0) > 60) throw conflict('ມີລາຍການລໍຖ້າພະນັກງານຢືນຢັນຫຼາຍແລ້ວ ກະລຸນາລໍຖ້າ');
    }
    if (p.source === 'customer') {
      const left = portionsMap(db, p.bid);
      const asked = new Map<number, number>();
      for (const it of p.items) asked.set(it.menuItemId, (asked.get(it.menuItemId) ?? 0) + it.qty);
      for (const [id, qty] of asked) {
        const have = left.get(id);
        if (have !== undefined && have < qty) {
          const m = db.get('SELECT name FROM menu_items WHERE id = ?', id);
          throw conflict(have === 0 ? `${m?.name ?? 'ເມນູ'} ໝົດແລ້ວ` : `${m?.name ?? 'ເມນູ'} ເຫຼືອພຽງ ${have} ຈານ`);
        }
      }
    }
    const ts = now();
    const ids: number[] = [];
    for (const it of p.items) {
      const m = db.get('SELECT * FROM menu_items WHERE id = ? AND branch_id = ?', it.menuItemId, p.bid);
      if (!m) throw notFound('ບໍ່ພົບເມນູ');
      if (!m.active) throw conflict(`${m.name} ປິດການຂາຍຢູ່`);
      const opts = resolveOptions(m, it.options);
      const unitPrice = m.price + opts.reduce((s, x) => s + x.price, 0);
      const r = db.run(
        `INSERT INTO order_items (order_id, menu_item_id, category_id, name, unit_price, unit_cost, qty, options_json, note, status, created_by, created_at, updated_at, awaiting, source)
         VALUES (?,?,?,?,?,?,?,?,?, 'pending', ?,?,?,?,?)`,
        o.id,
        m.id,
        m.category_id,
        m.name,
        unitPrice,
        m.cost,
        it.qty,
        JSON.stringify(opts),
        it.note,
        p.uid,
        ts,
        ts,
        p.awaiting ? 1 : 0,
        p.source ?? 'staff',
      );
      ids.push(r.id);
    }
    // New items after the bill was printed invalidate the printed bill.
    if (!p.awaiting) db.run('UPDATE orders SET bill_printed_at = NULL WHERE id = ?', o.id);
    recalc(db, o.id);
    db.audit(p.bid, p.uid, 'add_items', 'order', o.id, { itemIds: ids, source: p.source ?? 'staff', awaiting: !!p.awaiting });
    return ids;
  });
}

export interface PaymentInput {
  method: 'cash' | 'transfer' | 'qr' | 'card';
  currency: 'LAK' | 'USD' | 'THB';
  amount: number;
}

export function payOrder(db: Db, p: { bid: number; uid: number; orderId: number; payments: PaymentInput[] }) {
  if (!p.payments.length) throw bad('ກະລຸນາເລືອກວິທີຊຳລະ');
  return db.tx(() => {
    const shift = requireShift(db, p.bid);
    const o = loadOrder(db, p.orderId, p.bid);
    requireOpen(o);
    const waiting = db.get("SELECT COUNT(*) AS n FROM order_items WHERE order_id = ? AND awaiting = 1 AND status != 'cancelled'", o.id)!.n;
    if (waiting) throw conflict(`ມີ ${waiting} ລາຍການຈາກລູກຄ້າທີ່ຍັງລໍຖ້າຢືນຢັນ: ກະລຸນາຢືນຢັນ ຫຼື ປະຕິເສດກ່ອນຊຳລະ`);
    const active = db.get("SELECT COUNT(*) AS n FROM order_items WHERE order_id = ? AND status != 'cancelled'", o.id)!.n;
    if (!active) throw bad('ອໍເດີບໍ່ມີລາຍການ');
    const t = recalc(db, o.id);
    const b = getBranch(db, p.bid);
    const rateOf = (c: string) => (c === 'USD' ? b.rate_usd : c === 'THB' ? b.rate_thb : 1);
    const rows = p.payments.map((x) => ({ ...x, rate: rateOf(x.currency), amount_lak: Math.round(x.amount * rateOf(x.currency)) }));
    const paid = rows.reduce((s, x) => s + x.amount_lak, 0);
    const cash = rows.filter((x) => x.method === 'cash').reduce((s, x) => s + x.amount_lak, 0);
    if (paid < t.total) throw bad(`ຍອດຊຳລະບໍ່ພໍ: ຂາດອີກ ${(t.total - paid).toLocaleString('en-US')} ກີບ`);
    const change = paid - t.total;
    if (change > cash) throw bad('ເງິນທອນໄດ້ສະເພາະການຈ່າຍເງິນສົດ: ຍອດໂອນ/QR/ບັດ ເກີນຍອດບິນ');
    const ts = now();
    for (const x of rows) {
      db.run(
        'INSERT INTO payments (order_id, shift_id, method, currency, amount, rate, amount_lak, created_at) VALUES (?,?,?,?,?,?,?,?)',
        o.id,
        shift.id,
        x.method,
        x.currency,
        x.amount,
        x.rate,
        x.amount_lak,
        ts,
      );
    }
    const billNo = 'B' + String(nextSeq(db, p.bid, 'bill_seq')).padStart(6, '0');
    db.run(
      "UPDATE orders SET status='paid', bill_no=?, paid_total=?, change_lak=?, paid_at=?, paid_by=?, updated_at=? WHERE id=?",
      billNo,
      paid,
      change,
      ts,
      p.uid,
      ts,
      o.id,
    );
    // Anything still in the kitchen pipeline is considered served once the bill is paid.
    db.run("UPDATE order_items SET status='served', updated_at=? WHERE order_id=? AND status IN ('pending','preparing','ready')", ts, o.id);
    deductForOrder(db, p.bid, o.id, p.uid);
    if (o.promo_id) db.run('UPDATE promotions SET used_count = used_count + 1 WHERE id = ?', o.promo_id);
    db.audit(p.bid, p.uid, 'pay', 'order', o.id, { total: t.total, paid, change, payments: rows });
    return { billNo, total: t.total, paid, change };
  });
}

/** Give a dine-in order a fresh secret QR token (replaces any previous one). */
export function issueQr(db: Db, p: { bid: number; uid: number; orderId: number; durationHours: number }) {
  return db.tx(() => {
    const o = loadOrder(db, p.orderId, p.bid);
    requireOpen(o);
    if (o.type !== 'dine_in') throw bad('QR ໃຊ້ໄດ້ສະເພາະອໍເດີນັ່ງກິນໃນຮ້ານ');
    const token = crypto.randomBytes(24).toString('base64url');
    const expiresAt = p.durationHours > 0 ? new Date(Date.now() + p.durationHours * 3_600_000).toISOString() : null;
    db.run('UPDATE orders SET qr_token = ?, qr_expires_at = ?, updated_at = ? WHERE id = ?', token, expiresAt, now(), o.id);
    db.audit(p.bid, p.uid, 'issue_qr', 'order', o.id, { durationHours: p.durationHours, replaced: !!o.qr_token });
    return { token, expiresAt };
  });
}

/** Expected cash in drawer (LAK) for a shift: opening float + cash received − change given. */
export function shiftCash(db: Db, shiftId: number) {
  const s = db.get('SELECT opening_cash FROM shifts WHERE id = ?', shiftId)!;
  const cashIn = db.get("SELECT COALESCE(SUM(amount_lak),0) AS v FROM payments WHERE shift_id = ? AND method = 'cash'", shiftId)!.v;
  const change = db.get(
    "SELECT COALESCE(SUM(o.change_lak),0) AS v FROM orders o WHERE o.id IN (SELECT DISTINCT order_id FROM payments WHERE shift_id = ?)",
    shiftId,
  )!.v;
  const byMethod = db.all(
    'SELECT method, currency, SUM(amount) AS amount, SUM(amount_lak) AS amount_lak, COUNT(*) AS n FROM payments WHERE shift_id = ? GROUP BY method, currency ORDER BY method, currency',
    shiftId,
  );
  const sales = db.get(
    'SELECT COUNT(*) AS bills, COALESCE(SUM(total),0) AS total FROM orders WHERE id IN (SELECT DISTINCT order_id FROM payments WHERE shift_id = ?)',
    shiftId,
  )!;
  return { openingCash: s.opening_cash, cashIn, change, expectedCash: s.opening_cash + cashIn - change, byMethod, bills: sales.bills, salesTotal: sales.total };
}
