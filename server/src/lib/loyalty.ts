// Loyalty points: a signed ledger per customer (earn +, redeem −, manual adjust ±).
import type { Db } from '../db.ts';
import { now } from '../db.ts';
import { bad } from './core.ts';

export function pointsOf(db: Db, customerId: number): number {
  return db.get('SELECT COALESCE(SUM(points), 0) AS v FROM point_entries WHERE customer_id = ?', customerId)!.v;
}

/** Points earned for spending `amount` (₭): one point per `earnPer` ₭, rounded down. 0 when loyalty is off. */
export const earnedFor = (earnPer: number, amount: number) => (earnPer > 0 && amount > 0 ? Math.floor(amount / earnPer) : 0);

/** ₭ value of `points` when redeeming. */
export const valueOf = (redeemValue: number, points: number) => points * redeemValue;

/** Check a redemption request against the customer's balance and the bill; returns its ₭ value. Call inside the payment transaction. */
export function checkRedeem(db: Db, p: { redeemValue: number; customerId: number | null; points: number; maxValue: number }): number {
  if (!(p.points > 0)) return 0;
  if (!(p.redeemValue > 0)) throw bad('ຍັງບໍ່ໄດ້ເປີດໃຊ້ການແລກຄະແນນ');
  if (!p.customerId) throw bad('ກະລຸນາເລືອກລູກຄ້າກ່ອນແລກຄະແນນ');
  const bal = pointsOf(db, p.customerId);
  if (p.points > bal) throw bad(`ຄະແນນບໍ່ພໍ: ມີ ${bal.toLocaleString('en-US')} ຄະແນນ`);
  const value = valueOf(p.redeemValue, p.points);
  if (value > p.maxValue) throw bad('ຄະແນນທີ່ແລກຫຼາຍກວ່າຍອດບິນ');
  return value;
}

export function addPoints(db: Db, p: { bid: number; uid: number; customerId: number; type: 'earn' | 'redeem' | 'adjust'; points: number; orderId?: number | null; note?: string }) {
  if (!p.points) return;
  db.run(
    'INSERT INTO point_entries (branch_id, customer_id, type, points, order_id, note, user_id, created_at) VALUES (?,?,?,?,?,?,?,?)',
    p.bid, p.customerId, p.type, p.points, p.orderId ?? null, p.note ?? '', p.uid, now(),
  );
}
