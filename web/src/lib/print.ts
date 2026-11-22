// Thermal-printer friendly documents (58/80mm), printed through a hidden iframe.
import type { Branch, OrderItem, Order, Restaurant } from './api';
import { dateTime, kip, METHOD_LABEL } from './format';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const CSS = `
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body { width: 76mm; margin: 0 auto; padding: 3mm 2mm; font-family: "Noto Sans Lao", "Phetsarath OT", sans-serif; font-size: 12px; color: #000; }
  h1 { font-size: 16px; text-align: center; margin: 0 0 2px; }
  .c { text-align: center; } .r { text-align: right; } .b { font-weight: 700; } .s { font-size: 11px; }
  .big { font-size: 20px; font-weight: 700; }
  hr { border: 0; border-top: 1px dashed #000; margin: 4px 0; }
  table { width: 100%; border-collapse: collapse; } td { vertical-align: top; padding: 1px 0; }
  .opt { font-size: 11px; padding-left: 8px; }
`;

function printHtml(title: string, body: string) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`);
  doc.close();
  const go = () => {
    frame.contentWindow!.focus();
    frame.contentWindow!.print();
    setTimeout(() => frame.remove(), 1000);
  };
  // Give web fonts a moment to load before printing.
  setTimeout(go, 300);
}

const optLine = (it: Pick<OrderItem, 'options' | 'note'>) =>
  [...it.options.map((o) => o.name), it.note ? `* ${it.note}` : ''].filter(Boolean).map((x) => `<div class="opt">${esc(x)}</div>`).join('');

const whereLabel = (o: Pick<Order, 'type' | 'table_name' | 'queue_no'>) =>
  o.type === 'dine_in' ? `ໂຕະ ${esc(o.table_name ?? '')}` : `ກັບບ້ານ · ຄິວ ${o.queue_no ?? ''}`;

/** Kitchen ticket for a batch of newly sent items. */
export function printKitchenTicket(order: Order, items: OrderItem[], staff: string) {
  const rows = items
    .map((it) => `<tr><td class="b big" style="width:14mm">${it.qty}×</td><td class="b" style="font-size:15px">${esc(it.name)}${optLine(it)}</td></tr>`)
    .join('');
  printHtml(
    'Kitchen',
    `<div class="c big">${whereLabel(order)}</div>
     <div class="c s">ອໍເດີ #${esc(order.order_no)} · ${dateTime(new Date().toISOString())} · ${esc(staff)}</div><hr>
     <table>${rows}</table><hr><div class="c s">ໃບສັ່ງຄົວ</div>`,
  );
}

function itemsTable(order: Order) {
  return order.items
    .filter((i) => i.status !== 'cancelled')
    .map(
      (it) =>
        `<tr><td>${it.qty} × ${esc(it.name)}${optLine(it)}</td><td class="r">${kip(it.unit_price * it.qty)}</td></tr>`,
    )
    .join('');
}

function totalsBlock(order: Order) {
  const line = (label: string, v: number, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="r">${kip(v)}</td></tr>`;
  return `<table>
    ${line('ລວມ', order.subtotal)}
    ${order.discount ? line('ສ່ວນຫຼຸດ', -order.discount) : ''}
    ${order.service ? line('ຄ່າບໍລິການ', order.service) : ''}
    ${order.vat ? line('VAT', order.vat) : ''}
    ${line('ຍອດສຸດທິ', order.total, 'b big')}
  </table>`;
}

function header(rest: Restaurant, branch: Branch) {
  return `<h1>${esc(rest.name)}</h1>
    <div class="c s">${esc(branch.name)}${branch.address ? ' · ' + esc(branch.address) : ''}</div>
    ${branch.phone ? `<div class="c s">ໂທ ${esc(branch.phone)}</div>` : ''}
    ${branch.receipt_header ? `<div class="c s">${esc(branch.receipt_header)}</div>` : ''}<hr>`;
}

/** Pre-payment bill (check) for the customer. */
export function printBill(order: Order, rest: Restaurant, branch: Branch) {
  const usd = order.total / branch.rate_usd;
  const thb = order.total / branch.rate_thb;
  printHtml(
    'Bill',
    `${header(rest, branch)}
     <div class="c b">ໃບແຈ້ງຍອດ · ${whereLabel(order)}</div>
     <div class="s">ອໍເດີ #${esc(order.order_no)} · ${dateTime(new Date().toISOString())}</div><hr>
     <table>${itemsTable(order)}</table><hr>${totalsBlock(order)}
     <div class="s r">≈ $${usd.toFixed(2)} · ฿${thb.toFixed(0)}</div>
     ${branch.bank_info ? `<hr><div class="s">${esc(branch.bank_info).replace(/\n/g, '<br>')}</div>` : ''}
     <hr><div class="c s">ຍັງບໍ່ແມ່ນໃບຮັບເງິນ</div>`,
  );
}

/** QR card for a table: customers scan it to order from their phone. */
export function printTableQr(tableName: string, qrImage: string, url: string, rest: Restaurant, expiresAt: string | null) {
  printHtml(
    'QR',
    `<h1>${esc(rest.name)}</h1>
     <div class="c big" style="margin:6px 0">ໂຕະ ${esc(tableName)}</div>
     <div class="c"><img src="${qrImage}" style="width:62mm;height:62mm" /></div>
     <div class="c b" style="font-size:14px">ສະແກນເພື່ອສັ່ງອາຫານ</div>
     <div class="c s">ເປີດກ້ອງມືຖື ແລ້ວສະແກນ QR ນີ້</div>
     ${expiresAt ? `<div class="c s">ໃຊ້ໄດ້ຮອດ ${dateTime(expiresAt)}</div>` : ''}
     <hr><div class="c s" style="word-break:break-all">${esc(url)}</div>
     <div class="c s">QR ນີ້ໃຊ້ສະເພາະຮອບນີ້ ໝົດອາຍຸເມື່ອຊຳລະເງິນ</div>`,
  );
}

/** Final receipt after payment. */
export function printReceipt(order: Order, rest: Restaurant, branch: Branch, cashier: string) {
  const pays = order.payments
    .map(
      (p) =>
        `<tr><td>${METHOD_LABEL[p.method]}${p.currency !== 'LAK' ? ` (${p.currency} ${p.amount.toLocaleString('en-US')})` : ''}</td><td class="r">${kip(p.amount_lak)}</td></tr>`,
    )
    .join('');
  printHtml(
    'Receipt',
    `${header(rest, branch)}
     <div class="c b">ໃບຮັບເງິນ · ${whereLabel(order)}</div>
     <div class="s">ບິນ ${esc(order.bill_no ?? '')} · ອໍເດີ #${esc(order.order_no)}</div>
     <div class="s">${dateTime(order.paid_at)} · ${esc(cashier)}</div><hr>
     <table>${itemsTable(order)}</table><hr>${totalsBlock(order)}<hr>
     <table>${pays}${order.change_lak ? `<tr class="b"><td>ເງິນທອນ</td><td class="r">${kip(order.change_lak)}</td></tr>` : ''}</table>
     <hr><div class="c">${esc(branch.receipt_footer || '')}</div><div class="c s">Powered by LAZA app</div>`,
  );
}
