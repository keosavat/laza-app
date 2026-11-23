// Builds the content (blocks) of each ticket from an order snapshot.
import type { Block } from './render.ts';

export interface DocOrder {
  order_no: string;
  bill_no: string | null;
  type: 'dine_in' | 'takeaway';
  table_name: string | null;
  queue_no: number | null;
  created_at: string;
  paid_at: string | null;
  subtotal: number;
  discount: number;
  service: number;
  vat: number;
  total: number;
  change_lak: number;
  guest_count: number;
  items: {
    id: number;
    name: string;
    qty: number;
    unit_price: number;
    options: { group: string; name: string; price: number }[];
    note: string;
    status: string;
    source: string;
    created_by_name: string | null;
  }[];
  payments: { method: string; currency: string; amount: number; amount_lak: number }[];
}

export interface Shop {
  restaurant: string;
  branch: string;
  address: string;
  phone: string;
  header: string;
  footer: string;
  bank: string;
  rateUsd: number;
  rateThb: number;
  utcOffsetMin: number;
}

export const kip = (n: number) => `₭${Math.round(n).toLocaleString('en-US')}`;

/** HH:mm in the branch's local time. */
export function clock(iso: string | null, offsetMin: number) {
  if (!iso) return '';
  const d = new Date(Date.parse(iso) + offsetMin * 60_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
export function dateTime(iso: string | null, offsetMin: number) {
  if (!iso) return '';
  const d = new Date(Date.parse(iso) + offsetMin * 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

const METHOD: Record<string, string> = { cash: 'ເງິນສົດ', transfer: 'ໂອນເງິນ', qr: 'QR ທະນາຄານ', card: 'ບັດ' };
const where = (o: DocOrder) => (o.type === 'dine_in' ? `ໂຕະ ${o.table_name ?? ''}` : `ກັບບ້ານ · ຄິວ ${o.queue_no ?? ''}`);

/** Kitchen/bar ticket: big, no prices. */
export function kitchenDoc(o: DocOrder, items: DocOrder['items'], shop: Shop, opts: { station: string; reprint: boolean; now: string }): Block[] {
  const blocks: Block[] = [
    { t: 'text', text: where(o), size: 'xl', bold: true, align: 'center' },
    { t: 'text', text: `ອໍເດີ #${o.order_no} · ${dateTime(opts.now, shop.utcOffsetMin)}`, size: 's', align: 'center' },
  ];
  if (o.guest_count) blocks.push({ t: 'text', text: `ແຂກ ${o.guest_count} ຄົນ`, size: 's', align: 'center' });
  if (opts.reprint) blocks.push({ t: 'text', text: '*** ພິມຊ້ຳ ***', size: 'm', bold: true, align: 'center' });
  blocks.push({ t: 'rule' });
  for (const it of items) {
    blocks.push({ t: 'row', left: `${it.qty}×  ${it.name}`, right: '', size: 'l', bold: true });
    const sub = it.options.map((x) => x.name).join(', ');
    if (sub) blocks.push({ t: 'text', text: sub, size: 'm' });
    if (it.note) blocks.push({ t: 'text', text: `* ${it.note}`, size: 'm', bold: true });
    blocks.push({ t: 'space', h: 8 });
  }
  blocks.push({ t: 'rule' });
  const by = items.some((i) => i.source === 'customer') ? 'ລູກຄ້າສັ່ງເອງ (QR)' : (items[0]?.created_by_name ?? '');
  blocks.push({ t: 'text', text: [opts.station, by].filter(Boolean).join(' · '), size: 's', align: 'center' });
  return blocks;
}

function head(shop: Shop): Block[] {
  const b: Block[] = [{ t: 'text', text: shop.restaurant, size: 'l', bold: true, align: 'center' }];
  const sub = [shop.branch, shop.address].filter(Boolean).join(' · ');
  if (sub) b.push({ t: 'text', text: sub, size: 's', align: 'center' });
  if (shop.phone) b.push({ t: 'text', text: `ໂທ ${shop.phone}`, size: 's', align: 'center' });
  if (shop.header) b.push({ t: 'text', text: shop.header, size: 's', align: 'center' });
  b.push({ t: 'rule' });
  return b;
}

function lines(o: DocOrder): Block[] {
  const b: Block[] = [];
  for (const it of o.items.filter((i) => i.status !== 'cancelled')) {
    b.push({ t: 'row', left: `${it.qty} × ${it.name}`, right: kip(it.unit_price * it.qty), size: 'm' });
    const sub = it.options.map((x) => x.name).join(', ');
    if (sub) b.push({ t: 'text', text: sub, size: 's' });
  }
  return b;
}

function totals(o: DocOrder): Block[] {
  const b: Block[] = [{ t: 'row', left: 'ລວມ', right: kip(o.subtotal), size: 'm' }];
  if (o.discount) b.push({ t: 'row', left: 'ສ່ວນຫຼຸດ', right: `-${kip(o.discount)}`, size: 'm' });
  if (o.service) b.push({ t: 'row', left: 'ຄ່າບໍລິການ', right: kip(o.service), size: 'm' });
  if (o.vat) b.push({ t: 'row', left: 'VAT', right: kip(o.vat), size: 'm' });
  b.push({ t: 'row', left: 'ຍອດສຸດທິ', right: kip(o.total), size: 'l', bold: true });
  return b;
}

/** Pre-payment bill handed to the customer. */
export function billDoc(o: DocOrder, shop: Shop, now: string): Block[] {
  return [
    ...head(shop),
    { t: 'text', text: `ໃບແຈ້ງຍອດ · ${where(o)}`, size: 'm', bold: true, align: 'center' },
    { t: 'text', text: `ອໍເດີ #${o.order_no} · ${dateTime(now, shop.utcOffsetMin)}`, size: 's', align: 'center' },
    { t: 'rule' },
    ...lines(o),
    { t: 'rule' },
    ...totals(o),
    { t: 'text', text: `≈ $${(o.total / shop.rateUsd).toFixed(2)}  ·  ฿${(o.total / shop.rateThb).toFixed(0)}`, size: 's', align: 'right' },
    ...(shop.bank ? [{ t: 'rule' } as Block, { t: 'text', text: shop.bank, size: 's' } as Block] : []),
    { t: 'rule' },
    { t: 'text', text: 'ຍັງບໍ່ແມ່ນໃບຮັບເງິນ', size: 's', align: 'center' },
  ];
}

/** Final receipt after payment. */
export function receiptDoc(o: DocOrder, shop: Shop, cashier: string): Block[] {
  const pays: Block[] = o.payments.map((p) => ({
    t: 'row',
    left: `${METHOD[p.method] ?? p.method}${p.currency !== 'LAK' ? ` (${p.currency} ${p.amount.toLocaleString('en-US')})` : ''}`,
    right: kip(p.amount_lak),
    size: 'm',
  }));
  if (o.change_lak) pays.push({ t: 'row', left: 'ເງິນທອນ', right: kip(o.change_lak), size: 'm', bold: true });
  return [
    ...head(shop),
    { t: 'text', text: `ໃບຮັບເງິນ · ${where(o)}`, size: 'm', bold: true, align: 'center' },
    { t: 'text', text: `ບິນ ${o.bill_no ?? ''} · ອໍເດີ #${o.order_no}`, size: 's', align: 'center' },
    { t: 'text', text: `${dateTime(o.paid_at, shop.utcOffsetMin)} · ${cashier}`, size: 's', align: 'center' },
    { t: 'rule' },
    ...lines(o),
    { t: 'rule' },
    ...totals(o),
    { t: 'rule' },
    ...pays,
    { t: 'rule' },
    ...(shop.footer ? [{ t: 'text', text: shop.footer, size: 'm', align: 'center' } as Block] : []),
    { t: 'text', text: 'Powered by LAZA app', size: 's', align: 'center' },
  ];
}

export function testDoc(printerName: string, paperMm: number, shop: Shop, now: string): Block[] {
  return [
    { t: 'text', text: 'LAZA app', size: 'xl', bold: true, align: 'center' },
    { t: 'text', text: 'ທົດສອບເຄື່ອງພິມ', size: 'l', bold: true, align: 'center' },
    { t: 'rule' },
    { t: 'row', left: 'ເຄື່ອງພິມ', right: printerName, size: 'm' },
    { t: 'row', left: 'ຂະໜາດກະດາດ', right: `${paperMm}mm`, size: 'm' },
    { t: 'row', left: 'ຮ້ານ', right: shop.restaurant, size: 'm' },
    { t: 'row', left: 'ເວລາ', right: dateTime(now, shop.utcOffsetMin), size: 'm' },
    { t: 'rule' },
    { t: 'text', text: 'ຕຳໝາກຫຸ່ງ ເຝີຊີ້ນງົວ ກາເຟລາວເຢັນ\nABC abc 0123456789 ₭1,234,567', size: 'm' },
    { t: 'text', text: 'ຖ້າອ່ານຂໍ້ຄວາມນີ້ໄດ້ຊັດເຈນ ແປວ່າເຄື່ອງພິມພ້ອມໃຊ້ງານ', size: 's' },
    { t: 'rule', style: 'solid' },
    { t: 'text', text: '■■■■■■■■■■■■■■■■■■■■', size: 'l', align: 'center' },
  ];
}
