// Promotions / coupons. Pure rules live here so orders.ts (recalc) and the routes share them.
import type { Row } from '../db.ts';
import { bad } from './core.ts';

/** Discount in LAK a promotion gives on a given subtotal (0 when the minimum spend is not reached). */
export function promoDiscount(p: Row, subtotal: number): number {
  if (subtotal <= 0 || subtotal < p.min_subtotal) return 0;
  let d = p.type === 'percent' ? Math.round((subtotal * Math.min(p.value, 100)) / 100) : Math.round(p.value);
  if (p.type === 'percent' && p.max_discount > 0) d = Math.min(d, p.max_discount);
  return Math.min(d, subtotal);
}

/** Why a promotion cannot be used right now, or null if it can. `offsetMin` = branch UTC offset. */
export function promoProblem(p: Row, order: { type: string }, offsetMin: number, at = new Date()): string | null {
  if (!p.active) return 'ໂປຣໂມຊັນນີ້ປິດໃຊ້ງານ';
  const local = new Date(at.getTime() + offsetMin * 60_000);
  const date = local.toISOString().slice(0, 10);
  const hhmm = local.toISOString().slice(11, 16);
  if (p.starts_on && date < p.starts_on) return `ໂປຣໂມຊັນນີ້ເລີ່ມວັນທີ ${p.starts_on}`;
  if (p.ends_on && date > p.ends_on) return 'ໂປຣໂມຊັນນີ້ໝົດເຂດແລ້ວ';
  if (!String(p.days).includes(String(local.getUTCDay()))) return 'ໂປຣໂມຊັນນີ້ບໍ່ໃຊ້ໃນມື້ນີ້';
  if (p.time_from && p.time_to) {
    const inside = p.time_from <= p.time_to ? hhmm >= p.time_from && hhmm <= p.time_to : hhmm >= p.time_from || hhmm <= p.time_to;
    if (!inside) return `ໃຊ້ໄດ້ສະເພາະເວລາ ${p.time_from}–${p.time_to}`;
  }
  if (p.order_type !== 'all' && p.order_type !== order.type) return p.order_type === 'dine_in' ? 'ໃຊ້ໄດ້ສະເພາະນັ່ງກິນທີ່ຮ້ານ' : 'ໃຊ້ໄດ້ສະເພາະກັບບ້ານ/ຂາຍໜ້າຮ້ານ';
  if (p.max_uses > 0 && p.used_count >= p.max_uses) return 'ໂປຣໂມຊັນນີ້ຖືກໃຊ້ຄົບຈຳນວນແລ້ວ';
  return null;
}

export function requirePromoOk(p: Row, order: { type: string }, subtotal: number, offsetMin: number) {
  const problem = promoProblem(p, order, offsetMin);
  if (problem) throw bad(problem);
  if (subtotal < p.min_subtotal) throw bad(`ຕ້ອງມີຍອດຂັ້ນຕ່ຳ ${p.min_subtotal.toLocaleString('en-US')} ກີບ (ຕອນນີ້ ${subtotal.toLocaleString('en-US')})`);
}
