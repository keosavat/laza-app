// Typed API client + shared domain types.

export type Role = 'owner' | 'manager' | 'cashier' | 'waiter' | 'kitchen';
export interface User { uid: number; rid: number; bid: number; role: Role; name: string }

export interface Branch {
  id: number; name: string; address: string; phone: string;
  vat_rate: number; service_rate: number; rate_usd: number; rate_thb: number;
  receipt_header: string; receipt_footer: string; bank_info: string; utc_offset_min: number;
  qr_enabled: number; qr_auto_confirm: number; public_url: string; auto_kitchen_print: number;
}
export interface Restaurant { id: number; name: string }
export interface Category { id: number; name: string; sort: number; active: number; printer_id: number | null }
export interface OptionGroup { name: string; required: boolean; multiple: boolean; choices: { name: string; price: number }[] }
export interface MenuItem {
  id: number; category_id: number | null; name: string; price: number; cost: number;
  image_url: string; options: OptionGroup[]; active: number; sort: number;
  /** Portions left from stock; null = no recipe (not tracked). */
  portions: number | null; cost_from_recipe: number;
}
export interface Zone { id: number; name: string; sort: number }
export interface Table { id: number; zone_id: number | null; name: string; seats: number; sort: number; active: number }
export interface FloorTable extends Table {
  order_id: number | null; order_total: number | null; opened_at: string | null;
  bill_printed_at: string | null; item_count: number; in_kitchen: number;
  awaiting_count: number; calls_open: number; has_qr: number;
}
export type ItemStatus = 'pending' | 'preparing' | 'ready' | 'served' | 'cancelled';
export interface ChosenOption { group: string; name: string; price: number }
export interface OrderItem {
  id: number; order_id: number; menu_item_id: number; name: string; unit_price: number; qty: number;
  options: ChosenOption[]; note: string; status: ItemStatus; created_at: string; created_by_name: string; cancel_reason: string;
  awaiting: number; source: 'staff' | 'customer'; updated_at: string;
}
export type PayMethod = 'cash' | 'transfer' | 'qr' | 'card';
export type Currency = 'LAK' | 'USD' | 'THB';
export interface Payment { id: number; method: PayMethod; currency: Currency; amount: number; rate: number; amount_lak: number }
export interface Order {
  id: number; order_no: string; bill_no: string | null; type: 'dine_in' | 'takeaway'; table_id: number | null; table_name: string | null;
  queue_no: number | null; status: 'open' | 'paid' | 'cancelled'; customer_name: string; note: string;
  discount_type: 'none' | 'percent' | 'amount'; discount_value: number; promo_id?: number | null; promo_name?: string; debt_amount?: number; debt_customer_id?: number | null;
  subtotal: number; discount: number; service: number; vat: number; total: number; paid_total: number; change_lak: number;
  created_at: string; paid_at: string | null; bill_printed_at: string | null; created_by_name?: string;
  qr_token: string | null; qr_expires_at: string | null; guest_count: number;
  items: OrderItem[]; payments: Payment[];
}
export interface OrderRow extends Omit<Order, 'items' | 'payments'> { item_count: number; methods: string | null; paid_by_name: string | null }
export interface Shift {
  id: number; status: 'open' | 'closed'; opened_at: string; opening_cash: number; opened_by_name?: string;
  closed_at: string | null; counted_cash: number | null; expected_cash: number | null; note: string; closed_by_name?: string;
}
export interface ShiftSummary {
  openingCash: number; cashIn: number; debtCharged?: number; debtCollected?: number; change: number; expectedCash: number; bills: number; salesTotal: number;
  byMethod: { method: PayMethod; currency: Currency; amount: number; amount_lak: number; n: number }[];
}
export interface CurrentShift extends Shift { summary: ShiftSummary; openOrders: { n: number; total: number } }
export interface KitchenItem {
  id: number; order_id: number; name: string; qty: number; options: ChosenOption[]; note: string; status: ItemStatus;
  created_at: string; order_no: string; type: 'dine_in' | 'takeaway'; queue_no: number | null; table_name: string | null; created_by_name: string;
}
export interface Printer {
  id: number; name: string; role: 'kitchen' | 'bill'; connection: 'lan' | 'usb'; host: string; port: number; system_name: string;
  paper_mm: 58 | 80; cut: number; copies: number; active: number; last_ok_at: string | null; last_error: string; last_error_at: string | null;
  queued?: number; failed?: number;
}
export interface PrintJob {
  id: number; type: 'kitchen' | 'bill' | 'receipt' | 'test'; title: string; status: 'queued' | 'printing' | 'done' | 'failed';
  attempts: number; error: string; created_at: string; printed_at: string | null; order_id: number | null; printer_name: string;
}
export interface Ingredient {
  id: number; name: string; unit: string; cost: number; stock: number; low_at: number; active: number;
  low: boolean; out: boolean; value: number; used_in: number;
  category: string; pack_name: string; pack_size: number; refill_to: number; suggest: number; next_expiry: string | null;
}
export interface StockMove {
  id: number; ingredient_id: number; ingredient_name: string; unit: string; type: 'in' | 'adjust' | 'waste' | 'sale';
  qty: number; unit_cost: number; balance: number; note: string; lot?: string; expires_at?: string | null; user_name: string | null; created_at: string;
}
export interface Recipe {
  item: { id: number; name: string; price: number; cost: number };
  costFromRecipe: boolean;
  recipeCost: number;
  lines: { ingredientId: number; qty: number; name: string; unit: string; cost: number; stock: number; line_cost: number }[];
}
export interface StaffUser { id: number; name: string; username: string; role: Role; active: number; created_at: string }

const TOKEN_KEY = 'laza_token';
export const tokenStore = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } },
  set: (t: string) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } },
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const token = tokenStore.get();
  let res: Response;
  try {
    res = await fetch('/api' + url, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'ເຊື່ອມຕໍ່ເຊີບເວີບໍ່ໄດ້ ກະລຸນາກວດອິນເຕີເນັດ');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && url !== '/auth/login') onUnauthorized();
    throw new ApiError(res.status, data?.error || `ຜິດພາດ (${res.status})`);
  }
  return data as T;
}

export const get = <T,>(url: string) => api<T>('GET', url);
export const post = <T,>(url: string, body: unknown = {}) => api<T>('POST', url, body);
export const put = <T,>(url: string, body: unknown) => api<T>('PUT', url, body);
export const patch = <T,>(url: string, body: unknown) => api<T>('PATCH', url, body);
export const del = <T,>(url: string) => api<T>('DELETE', url);
