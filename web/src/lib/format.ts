import type { ItemStatus, PayMethod, Role } from './api';

export const kip = (n: number | null | undefined) => `₭${Math.round(n ?? 0).toLocaleString('en-US')}`;
export const num = (n: number) => n.toLocaleString('en-US');

export function time(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
export function dateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB')} ${time(iso)}`;
}
/** "12 ນາທີ" / "2 ຊມ 5 ນາທີ" since a timestamp. */
export function since(iso: string | null | undefined, nowMs = Date.now()) {
  if (!iso) return '';
  const m = Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 60000));
  if (m < 60) return `${m} ນາທີ`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} ຊມ ${m % 60} ນາທີ`;
  return `${Math.floor(h / 24)} ມື້`;
}
export function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'ເຈົ້າຂອງຮ້ານ',
  manager: 'ຜູ້ຈັດການ',
  cashier: 'ແຄັດເຊຍ',
  waiter: 'ພະນັກງານເສີບ',
  kitchen: 'ຄົວ',
};
export const METHOD_LABEL: Record<PayMethod, string> = {
  cash: 'ເງິນສົດ',
  transfer: 'ໂອນເງິນ',
  qr: 'QR ທະນາຄານ',
  card: 'ບັດ',
};
export const STATUS_LABEL: Record<ItemStatus, string> = {
  pending: 'ລໍຖ້າ',
  preparing: 'ກຳລັງເຮັດ',
  ready: 'ພ້ອມເສີບ',
  served: 'ເສີບແລ້ວ',
  cancelled: 'ຍົກເລີກ',
};
export const STATUS_CLASS: Record<ItemStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  preparing: 'bg-sky-100 text-sky-800',
  ready: 'bg-violet-100 text-violet-800',
  served: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-rose-100 text-rose-700 line-through',
};

/** Permission check mirrored from the server (server is the source of truth). */
const PERMS = {
  pos: ['owner', 'manager', 'cashier', 'waiter'],
  pay: ['owner', 'manager', 'cashier'],
  discount: ['owner', 'manager', 'cashier'],
  voidItem: ['owner', 'manager'],
  kitchen: ['owner', 'manager', 'cashier', 'kitchen', 'waiter'],
  shift: ['owner', 'manager', 'cashier'],
  reports: ['owner', 'manager', 'cashier'],
  admin: ['owner', 'manager'],
  owner: ['owner'],
} as const;
export type Perm = keyof typeof PERMS;
export const can = (role: Role | undefined, p: Perm) => !!role && (PERMS[p] as readonly string[]).includes(role);
