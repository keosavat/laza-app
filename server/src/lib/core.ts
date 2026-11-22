// Shared helpers: HTTP errors, validation, money calculation, business-day ranges.

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const bad = (msg: string) => new HttpError(400, msg);
export const notFound = (what = 'ບໍ່ພົບຂໍ້ມູນ') => new HttpError(404, what);
export const forbidden = (msg = 'ບໍ່ມີສິດໃຊ້ງານສ່ວນນີ້') => new HttpError(403, msg);
export const conflict = (msg: string) => new HttpError(409, msg);

export function str(v: unknown, field: string, opts: { required?: boolean; max?: number } = {}): string {
  if (v === undefined || v === null) {
    if (opts.required) throw bad(`ກະລຸນາປ້ອນ ${field}`);
    return '';
  }
  if (typeof v !== 'string') throw bad(`${field} ບໍ່ຖືກຕ້ອງ`);
  const s = v.trim();
  if (opts.required && !s) throw bad(`ກະລຸນາປ້ອນ ${field}`);
  if (s.length > (opts.max ?? 500)) throw bad(`${field} ຍາວເກີນໄປ`);
  return s;
}

export function int(v: unknown, field: string, opts: { min?: number; max?: number; required?: boolean } = {}): number {
  if (v === undefined || v === null || v === '') {
    if (opts.required) throw bad(`ກະລຸນາປ້ອນ ${field}`);
    return opts.min ?? 0;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw bad(`${field} ຕ້ອງເປັນຕົວເລກຖ້ວນ`);
  if (opts.min !== undefined && n < opts.min) throw bad(`${field} ຕ້ອງບໍ່ໜ້ອຍກວ່າ ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) throw bad(`${field} ຕ້ອງບໍ່ເກີນ ${opts.max}`);
  return n;
}

export function num(v: unknown, field: string, opts: { min?: number; max?: number } = {}): number {
  const n = Number(v);
  if (!Number.isFinite(n)) throw bad(`${field} ຕ້ອງເປັນຕົວເລກ`);
  if (opts.min !== undefined && n < opts.min) throw bad(`${field} ຕ້ອງບໍ່ໜ້ອຍກວ່າ ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) throw bad(`${field} ຕ້ອງບໍ່ເກີນ ${opts.max}`);
  return n;
}

export function oneOf<T extends string>(v: unknown, field: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !allowed.includes(v as T)) throw bad(`${field} ບໍ່ຖືກຕ້ອງ`);
  return v as T;
}

export const bool = (v: unknown) => (v === true || v === 1 || v === '1' ? 1 : 0);

// ---------- Money ----------

export type DiscountType = 'none' | 'percent' | 'amount';

export interface TotalsInput {
  items: { unit_price: number; qty: number; status: string }[];
  discountType: DiscountType;
  discountValue: number;
  serviceRate: number; // percent
  vatRate: number; // percent
}

export interface Totals {
  subtotal: number;
  discount: number;
  service: number;
  vat: number;
  total: number;
}

/** All amounts are integer LAK. Service charge applies after discount; VAT applies on (after-discount + service). */
export function calcTotals(i: TotalsInput): Totals {
  const subtotal = i.items.reduce((s, it) => (it.status === 'cancelled' ? s : s + it.unit_price * it.qty), 0);
  let discount = 0;
  if (i.discountType === 'percent') discount = Math.round((subtotal * Math.min(Math.max(i.discountValue, 0), 100)) / 100);
  else if (i.discountType === 'amount') discount = Math.min(Math.max(Math.round(i.discountValue), 0), subtotal);
  const base = subtotal - discount;
  const service = Math.round((base * i.serviceRate) / 100);
  const vat = Math.round(((base + service) * i.vatRate) / 100);
  return { subtotal, discount, service, vat, total: base + service + vat };
}

// ---------- Business day ----------

/** Local calendar date (YYYY-MM-DD) for a UTC instant, given an offset in minutes. */
export function localDate(d: Date, offsetMin: number): string {
  return new Date(d.getTime() + offsetMin * 60_000).toISOString().slice(0, 10);
}

/** UTC ISO range [start, end) covering the local calendar day `date`. */
export function dayRange(date: string, offsetMin: number): { start: string; end: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('ວັນທີບໍ່ຖືກຕ້ອງ');
  const startMs = Date.parse(`${date}T00:00:00Z`) - offsetMin * 60_000;
  if (Number.isNaN(startMs)) throw bad('ວັນທີບໍ່ຖືກຕ້ອງ');
  return { start: new Date(startMs).toISOString(), end: new Date(startMs + 86_400_000).toISOString() };
}
