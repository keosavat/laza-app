// Customer debts (credit accounts): a ledger of charges (unpaid part of a bill) and repayments.
import type { Db, Row } from '../db.ts';
import { now } from '../db.ts';
import { bad, notFound } from './core.ts';

export function balanceOf(db: Db, customerId: number): number {
  return db.get(
    "SELECT COALESCE(SUM(CASE WHEN type = 'charge' THEN amount ELSE -amount END), 0) AS v FROM debt_entries WHERE customer_id = ?",
    customerId,
  )!.v;
}

export function getCustomer(db: Db, id: number, bid: number): Row {
  const c = db.get('SELECT * FROM customers WHERE id = ? AND branch_id = ?', id, bid);
  if (!c) throw notFound('ບໍ່ພົບລູກຄ້າ');
  return c;
}

/** Put part of a bill on a customer's account. Call inside the payment transaction. */
export function chargeDebt(db: Db, p: { bid: number; uid: number; customerId: number; orderId: number; amount: number }) {
  const c = getCustomer(db, p.customerId, p.bid);
  if (!c.active) throw bad('ລູກຄ້ານີ້ຖືກປິດໃຊ້ງານ');
  const bal = balanceOf(db, c.id);
  if (c.credit_limit > 0 && bal + p.amount > c.credit_limit) {
    throw bad(`ເກີນວົງເງິນຕິດໜີ້ຂອງ ${c.name}: ຄ້າງ ${bal.toLocaleString('en-US')} + ${p.amount.toLocaleString('en-US')} > ${c.credit_limit.toLocaleString('en-US')} ກີບ`);
  }
  db.run(
    "INSERT INTO debt_entries (branch_id, customer_id, type, amount, order_id, method, shift_id, note, user_id, created_at) VALUES (?,?,'charge',?,?,'',NULL,'',?,?)",
    p.bid, c.id, p.amount, p.orderId, p.uid, now(),
  );
  return c;
}
