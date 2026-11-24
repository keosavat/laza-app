import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRightLeft, Ban, Check, Percent, Tag, Printer, QrCode, Send, Wallet, ChefHat, X } from 'lucide-react';
import QrModal from '../components/QrModal';
import { del, get, post, wasQueued, type Order, type OrderItem, type FloorTable, type ItemStatus } from '../lib/api';
import { useSession, useSync } from '../lib/store';
import { can, dateTime, kip, since, STATUS_CLASS, STATUS_LABEL, time } from '../lib/format';
import { device } from '../lib/device';
import { printBill, printKitchenTicket } from '../lib/print';
import MenuPicker, { type CartLine } from '../components/MenuPicker';
import { CartLines, useCart } from '../components/Cart';
import Checkout from '../components/Checkout';
import { Badge, Button, Field, Input, Modal, MoneyInput, Select, Spinner, cx, toast, useAction, useLoad } from '../components/ui';

export default function OrderScreen() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, branch, restaurant, printers } = useSession();
  const role = user!.role;
  const [order, reload, loading] = useLoad(() => get<Order>(`/orders/${id}`), [id]);
  const cartState = useCart();
  const cart = cartState.cart;
  const [modal, setModal] = useState<null | 'discount' | 'promo' | 'transfer' | 'checkout' | 'cancel' | 'qr' | 'bulkcancel'>(null);
  const [voiding, setVoiding] = useState<OrderItem | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [tab, setTab] = useState<'menu' | 'order'>('menu');
  const [params, setParams] = useSearchParams();
  const qrShown = useRef(false);
  const { busy, run } = useAction();
  useSync(['orders'], reload);

  // Coming from "open table with QR": show the QR straight away so it can be scanned or printed.
  useEffect(() => {
    if (order?.qr_token && params.get('qr') === '1' && !qrShown.current) {
      qrShown.current = true;
      setModal('qr');
      setParams({}, { replace: true });
    }
  }, [order?.qr_token, params, setParams]);

  // Drop selections for lines that were cancelled, are waiting for approval, or whose order closed.
  useEffect(() => {
    if (!order) return;
    const ok = new Set(order.status === 'open' ? order.items.filter((i) => i.status !== 'cancelled' && !i.awaiting).map((i) => i.id) : []);
    setSelected((s) => (s.every((x) => ok.has(x)) ? s : s.filter((x) => ok.has(x))));
  }, [order]);

  const back = useCallback(() => nav(order?.type === 'takeaway' ? '/takeaway' : '/tables'), [nav, order?.type]);

  if (loading || !order) return <Spinner />;
  const closed = order.status !== 'open';
  const waiting = order.items.filter((i) => i.awaiting && i.status !== 'cancelled');
  // Lines staff can act on in bulk: live, approved, and the order still open.
  const selectable = closed || !can(role, 'kitchen') ? [] : order.items.filter((i) => i.status !== 'cancelled' && !i.awaiting);

  const add = (item: CartLine['item'], options: CartLine['options'], note: string) => {
    if (!closed) cartState.add(item, options, note);
  };
  const cartTotal = cartState.total;
  const cartQty = cartState.qty;

  /** Send the cart to the kitchen. Returns the updated order (or undefined on failure). */
  async function send(): Promise<Order | undefined> {
    if (!cart.length) return order;
    const r = await run(() =>
      post<{ itemIds: number[]; order: Order; printedByServer: boolean }>(`/orders/${order!.id}/items`, {
        items: cartState.payload(),
      }, { queue: `ສັ່ງອາຫານ ${order!.type === 'dine_in' ? `ໂຕະ ${order!.table_name}` : `ຄິວ ${order!.queue_no}`} (${cartState.qty} ລາຍການ)` }),
    );
    if (!r) return undefined;
    cartState.clear();
    if (wasQueued(r)) {
      toast.ok('ເຊີບເວີຕິດຕໍ່ບໍ່ໄດ້ — ເກັບອໍເດີໄວ້ແລ້ວ ຈະສົ່ງອັດຕະໂນມັດເມື່ອເຊື່ອມຕໍ່ (ຍັງບໍ່ໄດ້ພິມໃບຄົວ)');
      return undefined;
    }
    // Server prints to the kitchen printers when configured; otherwise fall back to this device's browser printing.
    if (!r.printedByServer && !printers.kitchen && device.autoKitchenPrint) printKitchenTicket(r.order, r.order.items.filter((i) => r.itemIds.includes(i.id)), user!.name);
    toast.ok(`ສົ່ງເຂົ້າຄົວແລ້ວ ${r.itemIds.length} ລາຍການ${r.printedByServer ? ' · ກຳລັງພິມ' : ''}`);
    reload();
    return r.order;
  }

  async function decide(action: 'approve' | 'reject', itemIds?: number[]) {
    const ok = await run(
      () => post(`/orders/${order!.id}/${action}`, { itemIds, reason: action === 'reject' ? 'ຮ້ານປະຕິເສດ' : undefined }),
      action === 'approve' ? 'ຢືນຢັນແລ້ວ ສົ່ງເຂົ້າຄົວ' : 'ປະຕິເສດແລ້ວ',
    );
    if (ok) reload();
  }

  async function setStatusFor(ids: number[], status: ItemStatus) {
    const r = await run(() => post<Order>(`/orders/${order!.id}/items/status`, { itemIds: ids, status }, { queue: `ປ່ຽນສະຖານະ ${ids.length} ລາຍການ` }), `ປ່ຽນສະຖານະ ${ids.length} ລາຍການແລ້ວ`);
    if (r) {
      setSelected([]);
      if (wasQueued(r)) toast.ok('ເກັບໄວ້ ຈະສົ່ງເມື່ອເຊື່ອມຕໍ່ເຊີບເວີໄດ້');
      reload();
    }
  }
  const setStatus = (status: ItemStatus) => setStatusFor(selected, status);
  async function reprintLines(ids: number[]) {
    if (!printers.kitchen) return printKitchenTicket(order!, order!.items.filter((i) => ids.includes(i.id)), user!.name);
    await run(() => post(`/orders/${order!.id}/print/kitchen`, { itemIds: ids }), 'ສົ່ງພິມໃບຄົວແລ້ວ');
  }
  const reprint = () => {
    reprintLines(selected);
    setSelected([]);
  };

  async function checkout() {
    if (waiting.length) return toast.err('ກະລຸນາຢືນຢັນ ຫຼື ປະຕິເສດລາຍການຈາກລູກຄ້າກ່ອນຊຳລະ');
    const o = await send();
    if (!o) return;
    if (!o.items.some((i) => i.status !== 'cancelled')) return toast.err('ຍັງບໍ່ມີລາຍການ');
    await reload();
    setModal('checkout');
  }

  async function doPrintBill() {
    const o = await send();
    if (!o) return;
    const r = await run(() => post<Order & { printedByServer: boolean }>(`/orders/${order!.id}/print-bill`));
    if (r?.printedByServer) toast.ok('ສົ່ງພິມບິນແລ້ວ');
    else if (r) printBill(r, restaurant!, branch!);
    reload();
  }

  const active = order.items.filter((i) => i.status !== 'cancelled' && !i.awaiting);
  const where = order.type === 'dine_in' ? `ໂຕະ ${order.table_name}` : `ກັບບ້ານ · ຄິວ ${order.queue_no}`;

  const panel = (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="border-b border-slate-200 p-3">
        <div className="flex items-center gap-2">
          <button onClick={back} className="rounded-lg p-1.5 hover:bg-slate-100" aria-label="ກັບຄືນ">
            <ArrowLeft className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-bold">{where}</div>
            <div className="text-xs text-slate-500">
              #{order.order_no} · ເປີດ {time(order.created_at)} ({since(order.created_at)})
              {order.bill_printed_at && <span className="ml-1 font-medium text-amber-600">· ພິມບິນແລ້ວ</span>}
            </div>
          </div>
          {closed && <Badge className={order.status === 'paid' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-700'}>{order.status === 'paid' ? 'ຊຳລະແລ້ວ' : 'ຍົກເລີກ'}</Badge>}
        </div>
        {!closed && (
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {order.type === 'dine_in' && <ActionBtn icon={QrCode} label="QR" onClick={() => setModal('qr')} highlight={!!order.qr_token} />}
            <ActionBtn icon={Printer} label="ພິມບິນ" onClick={doPrintBill} disabled={busy || (!active.length && !cart.length)} />
            <ActionBtn icon={Tag} label="ໂປຣໂມຊັນ" onClick={() => setModal('promo')} highlight={!!order.promo_id} />
            <ActionBtn icon={Percent} label="ສ່ວນຫຼຸດ" onClick={() => setModal('discount')} disabled={!can(role, 'discount')} />
            <ActionBtn icon={ArrowRightLeft} label="ຍ້າຍໂຕະ" onClick={() => setModal('transfer')} disabled={order.type !== 'dine_in'} />
            <ActionBtn icon={Ban} label="ຍົກເລີກ" onClick={() => setModal('cancel')} danger />
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {waiting.length > 0 && (
          <div className="m-2 rounded-xl border-2 border-rose-300 bg-rose-50 p-3">
            <div className="text-sm font-semibold text-rose-700">ລູກຄ້າສັ່ງ {waiting.reduce((s, i) => s + i.qty, 0)} ລາຍການ — ລໍຖ້າຢືນຢັນ</div>
            <div className="mb-2 text-xs text-rose-600">ຍັງບໍ່ລວມໃນຍອດ ແລະ ຍັງບໍ່ສົ່ງຄົວ</div>
            {can(role, 'pos') && (
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" onClick={() => decide('approve')} disabled={busy}>
                  <Check className="size-4" /> ຢືນຢັນທັງໝົດ
                </Button>
                <Button size="sm" variant="secondary" onClick={() => decide('reject')} disabled={busy}>
                  <X className="size-4" /> ປະຕິເສດທັງໝົດ
                </Button>
              </div>
            )}
          </div>
        )}
        {active.length === 0 && waiting.length === 0 && cart.length === 0 && <div className="py-10 text-center text-sm text-slate-400">ກົດເມນູເພື່ອເພີ່ມລາຍການ</div>}
        {selectable.length > 0 && (
          <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur">
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                className="size-4 accent-brand-600"
                checked={selected.length === selectable.length}
                onChange={(e) => setSelected(e.target.checked ? selectable.map((i) => i.id) : [])}
              />
              {selected.length ? `ເລືອກແລ້ວ ${selected.length} ລາຍການ` : 'ເລືອກທັງໝົດ'}
              <span className="text-slate-400">· ກົດແຖວເພື່ອເບິ່ງລາຍລະອຽດ</span>
            </label>
            {selected.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button size="sm" onClick={() => setStatus('served')} disabled={busy} className="bg-emerald-600! hover:bg-emerald-700!">ເສີບແລ້ວ</Button>
                <Button size="sm" onClick={() => setStatus('preparing')} disabled={busy} className="bg-sky-600! hover:bg-sky-700!">ກຳລັງເຮັດ</Button>
                <Button size="sm" onClick={() => setStatus('ready')} disabled={busy} className="bg-amber-500! hover:bg-amber-600!">ພ້ອມເສີບ</Button>
                <Button size="sm" variant="secondary" onClick={reprint}><Printer className="size-4" /> ພິມຄົວຄືນ ({selected.length})</Button>
                {can(role, 'voidItem') && (
                  <Button size="sm" variant="danger" onClick={() => setModal('bulkcancel')}><Ban className="size-4" /> ຍົກເລີກ</Button>
                )}
              </div>
            )}
          </div>
        )}
        {order.items.length > 0 && (
          <div className="divide-y divide-slate-100">
            {order.items.map((it) => {
              const canPick = selectable.some((s) => s.id === it.id);
              const isOpen = openId === it.id;
              return (
                <div key={it.id} className={cx(it.status === 'cancelled' && 'opacity-60', it.awaiting === 1 && it.status !== 'cancelled' && 'bg-rose-50/60', selected.includes(it.id) && 'bg-brand-50')}>
                  <div className="flex gap-2 px-3 py-2">
                    <input
                      type="checkbox"
                      disabled={!canPick}
                      checked={selected.includes(it.id)}
                      onChange={() => setSelected((s) => (s.includes(it.id) ? s.filter((x) => x !== it.id) : [...s, it.id]))}
                      className={cx('mt-1 size-4 shrink-0 accent-brand-600', !canPick && 'invisible')}
                      aria-label={`ເລືອກ ${it.name}`}
                    />
                    <button onClick={() => setOpenId(isOpen ? null : it.id)} className="flex min-w-0 flex-1 gap-2 text-left" aria-expanded={isOpen}>
                      <div className="tabular w-7 shrink-0 text-right font-semibold">{it.qty}×</div>
                      <div className="min-w-0 flex-1">
                        <div className={cx('text-sm font-medium', it.status === 'cancelled' && 'line-through')}>{it.name}</div>
                        <Extras options={it.options.map((o) => o.name)} note={it.note} />
                        {it.cancel_reason && <div className="text-xs text-rose-600">ເຫດຜົນ: {it.cancel_reason}</div>}
                        <div className="mt-0.5 flex items-center gap-2">
                          {it.awaiting === 1 && it.status !== 'cancelled' ? (
                            <Badge className="bg-rose-100 text-rose-700">ລໍຢືນຢັນ</Badge>
                          ) : (
                            <Badge className={STATUS_CLASS[it.status]}>{STATUS_LABEL[it.status]}</Badge>
                          )}
                          <span className="text-[11px] text-slate-400">{time(it.created_at)} · {it.source === 'customer' ? 'ລູກຄ້າສັ່ງເອງ' : it.created_by_name}</span>
                        </div>
                      </div>
                      <div className="tabular shrink-0 text-sm">{kip(it.unit_price * it.qty)}</div>
                    </button>
                  </div>
                  {!closed && it.awaiting === 1 && it.status !== 'cancelled' && can(role, 'pos') && (
                    <div className="flex justify-end gap-3 px-3 pb-2 text-xs">
                      <button onClick={() => decide('approve', [it.id])} className="font-semibold text-emerald-700 hover:underline">ຢືນຢັນ</button>
                      <button onClick={() => decide('reject', [it.id])} className="text-rose-600 hover:underline">ປະຕິເສດ</button>
                    </div>
                  )}
                  {isOpen && (
                    <ItemDetail
                      item={it}
                      canVoid={!closed && canPick && can(role, 'voidItem')}
                      canStatus={!closed && canPick && can(role, 'kitchen')}
                      onStatus={(s) => setStatusFor([it.id], s)}
                      onReprint={() => reprintLines([it.id])}
                      onVoid={() => setVoiding(it)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
        {cart.length > 0 && (
          <div className="border-t-4 border-dashed border-brand-200 bg-brand-50/50">
            <div className="px-3 pt-2 text-xs font-semibold text-brand-700">ລາຍການໃໝ່ (ຍັງບໍ່ສົ່ງ)</div>
            <CartLines cart={cartState} compact />
          </div>
        )}
      </div>

      <div className="space-y-1 border-t border-slate-200 p-3 text-sm">
        <Line label="ລວມ" value={order.subtotal + cartTotal} />
        {order.discount > 0 && <Line label={order.promo_name ? `ໂປຣ: ${order.promo_name}` : `ສ່ວນຫຼຸດ${order.discount_type === 'percent' ? ` ${order.discount_value}%` : ''}`} value={-order.discount} className="text-rose-600" />}
        {order.service > 0 && <Line label={`ຄ່າບໍລິການ ${branch!.service_rate}%`} value={order.service} />}
        {order.vat > 0 && <Line label={`VAT ${branch!.vat_rate}%`} value={order.vat} />}
        <div className="flex items-end justify-between pt-1">
          <span className="font-semibold">ຍອດສຸດທິ{cart.length > 0 && <span className="text-xs font-normal text-slate-500"> (ກ່ອນລວມລາຍການໃໝ່)</span>}</span>
          <span className="tabular text-2xl font-bold text-brand-700">{kip(order.total)}</span>
        </div>
        {!closed && (
          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button variant="secondary" size="lg" onClick={send} disabled={!cart.length} loading={busy && cart.length > 0}>
              <Send className="size-4" /> ສົ່ງຄົວ {cartQty > 0 && `(${cartQty})`}
            </Button>
            {can(role, 'pay') ? (
              <Button size="lg" onClick={checkout} disabled={busy || (!active.length && !cart.length)}>
                <Wallet className="size-4" /> ຊຳລະເງິນ
              </Button>
            ) : (
              <Button size="lg" onClick={doPrintBill} disabled={busy || (!active.length && !cart.length)}>
                <Printer className="size-4" /> ພິມບິນ
              </Button>
            )}
          </div>
        )}
        {closed && (
          <Button variant="secondary" className="mt-2 w-full" onClick={back}>
            ກັບຄືນ
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex border-b border-slate-200 bg-white lg:hidden">
        {(['menu', 'order'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx('flex-1 py-2.5 text-sm font-medium', tab === t ? 'border-b-2 border-brand-600 text-brand-700' : 'text-slate-500')}>
            {t === 'menu' ? 'ເມນູ' : `ອໍເດີ · ${kip(order.total + cartTotal)}`} {t === 'order' && cartQty > 0 && <span className="ml-1 rounded-full bg-brand-600 px-1.5 text-xs text-white">{cartQty}</span>}
          </button>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_400px]">
        <div className={cx('min-h-0', tab !== 'menu' && 'hidden lg:block')}>
          {closed ? (
            <div className="flex h-full items-center justify-center text-slate-400">
              <ChefHat className="mr-2 size-5" /> ອໍເດີນີ້ປິດແລ້ວ
            </div>
          ) : (
            <MenuPicker onAdd={add} />
          )}
        </div>
        <div className={cx('min-h-0 border-l border-slate-200', tab !== 'order' && 'hidden lg:block')}>{panel}</div>
      </div>

      {modal === 'qr' && <QrModal order={order} onClose={() => setModal(null)} onChanged={reload} />}
      {modal === 'promo' && <PromoModal order={order} onClose={() => setModal(null)} onDone={reload} />}
      {modal === 'discount' && <DiscountModal order={order} onClose={() => setModal(null)} onDone={reload} />}
      {modal === 'transfer' && <TransferModal order={order} onClose={() => setModal(null)} onDone={reload} />}
      {modal === 'cancel' && (
        <CancelModal
          order={order}
          hasItems={active.length > 0}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            back();
          }}
        />
      )}
      {modal === 'checkout' && (
        <Checkout
          order={order}
          onClose={() => setModal(null)}
          onPaid={() => {
            setModal(null);
            back();
          }}
        />
      )}
      {modal === 'bulkcancel' && (
        <BulkCancelModal
          order={order}
          ids={selected}
          onClose={() => setModal(null)}
          onDone={() => {
            setSelected([]);
            reload();
          }}
        />
      )}
      {voiding && <VoidModal item={voiding} onClose={() => setVoiding(null)} onDone={reload} />}
    </div>
  );
}

/** Expanded details of one order line: price breakdown, who/when, and quick actions. */
function ItemDetail({
  item,
  canVoid,
  canStatus,
  onStatus,
  onReprint,
  onVoid,
}: {
  item: OrderItem;
  canVoid: boolean;
  canStatus: boolean;
  onStatus: (s: ItemStatus) => void;
  onReprint: () => void;
  onVoid: () => void;
}) {
  const extras = item.options.reduce((s, o) => s + o.price, 0);
  const base = item.unit_price - extras;
  const row = (l: string, v: string, cls = '') => (
    <div className={cx('flex justify-between', cls)}>
      <span>{l}</span>
      <span className="tabular">{v}</span>
    </div>
  );
  return (
    <div className="mx-3 mb-3 space-y-3 rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm">
      <div className="space-y-0.5">
        {row('ລາຄາເມນູ', kip(base))}
        {item.options.map((o, i) => (
          <div key={i} className="flex justify-between text-slate-600">
            <span>+ {o.group}: {o.name}</span>
            <span className="tabular">{o.price ? kip(o.price) : '—'}</span>
          </div>
        ))}
        {row('ລາຄາ / ຫົວໜ່ວຍ', kip(item.unit_price), 'border-t border-slate-100 pt-0.5')}
        {row(`× ${item.qty}`, kip(item.unit_price * item.qty), 'font-semibold')}
      </div>
      {item.note && <div className="rounded-lg bg-amber-50 px-2 py-1.5 text-amber-800">ໝາຍເຫດ: {item.note}</div>}
      <div className="space-y-0.5 text-xs text-slate-500">
        <div>ສັ່ງໂດຍ: {item.source === 'customer' ? 'ລູກຄ້າ (ສະແກນ QR)' : item.created_by_name || '—'} · {dateTime(item.created_at)}</div>
        {item.updated_at !== item.created_at && <div>ອັບເດດລ່າສຸດ: {dateTime(item.updated_at)}</div>}
        {item.cancel_reason && <div className="text-rose-600">ເຫດຜົນຍົກເລີກ: {item.cancel_reason}</div>}
      </div>
      {(canStatus || canVoid) && (
        <div className="flex flex-wrap gap-1.5">
          {canStatus && item.status !== 'served' && (
            <Button size="sm" className="bg-emerald-600! hover:bg-emerald-700!" onClick={() => onStatus('served')}>ເສີບແລ້ວ</Button>
          )}
          {canStatus && <Button size="sm" variant="secondary" onClick={onReprint}><Printer className="size-4" /> ພິມຄົວຄືນ</Button>}
          {canVoid && (
            <Button size="sm" variant="danger" onClick={onVoid}>
              <Ban className="size-4" /> ຍົກເລີກ{item.qty > 1 ? ' (ບາງສ່ວນໄດ້)' : ''}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function BulkCancelModal({ order, ids, onClose, onDone }: { order: Order; ids: number[]; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const { busy, run } = useAction();
  const lines = order.items.filter((i) => ids.includes(i.id));
  const amount = lines.reduce((s, i) => s + i.unit_price * i.qty, 0);
  const reasons = ['ລູກຄ້າປ່ຽນໃຈ', 'ສັ່ງຜິດ', 'ອາຫານໝົດ', 'ຄົວເຮັດຜິດ'];
  return (
    <Modal
      open
      onClose={onClose}
      title={`ຍົກເລີກ ${lines.length} ລາຍການ`}
      footer={
        <Button
          variant="danger"
          loading={busy}
          disabled={!reason.trim()}
          onClick={async () => {
            const r = await run(() => post(`/orders/${order.id}/items/cancel`, { itemIds: ids, reason }), 'ຍົກເລີກລາຍການແລ້ວ');
            if (r) {
              onDone();
              onClose();
            }
          }}
        >
          ຢືນຢັນຍົກເລີກ
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 p-2 text-sm">
          {lines.map((i) => (
            <div key={i.id} className="flex justify-between py-0.5">
              <span>{i.qty}× {i.name}</span>
              <span className="tabular text-slate-500">{kip(i.unit_price * i.qty)}</span>
            </div>
          ))}
          <div className="mt-1 flex justify-between border-t border-slate-100 pt-1 font-semibold">
            <span>ລວມທີ່ຈະຕັດອອກ</span>
            <span className="tabular">{kip(amount)}</span>
          </div>
        </div>
        <Field label="ເຫດຜົນ">
          <div className="mb-2 flex flex-wrap gap-2">
            {reasons.map((r) => (
              <button key={r} onClick={() => setReason(r)} className={cx('rounded-full border px-3 py-1 text-sm', reason === r ? 'border-rose-500 bg-rose-50' : 'border-slate-300')}>
                {r}
              </button>
            ))}
          </div>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
        </Field>
      </div>
    </Modal>
  );
}

function Extras({ options, note }: { options: string[]; note: string }) {
  if (!options.length && !note) return null;
  return (
    <div className="text-xs text-slate-500">
      {options.join(', ')}
      {note && <span className="text-amber-700"> · {note}</span>}
    </div>
  );
}
function Line({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className={cx('flex justify-between', className)}>
      <span>{label}</span>
      <span className="tabular">{kip(value)}</span>
    </div>
  );
}
function ActionBtn({ icon: Icon, label, onClick, disabled, danger, highlight }: { icon: typeof Printer; label: string; onClick: () => void; disabled?: boolean; danger?: boolean; highlight?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'flex flex-col items-center gap-0.5 rounded-lg border py-1.5 text-xs disabled:opacity-40',
        danger ? 'border-rose-200 text-rose-600 hover:bg-rose-50' : highlight ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-700 hover:bg-slate-50',
      )}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}

interface PromoList {
  subtotal: number;
  applied: { id: number; name: string } | null;
  list: { id: number; name: string; type: 'percent' | 'amount'; value: number; min_subtotal: number; max_discount: number; estimate: number; reachable: boolean }[];
}

function PromoModal({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const [data] = useLoad(() => get<PromoList>(`/orders/${order.id}/promotions`));
  const [code, setCode] = useState('');
  const { busy, run } = useAction();
  const apply = async (body: { promoId?: number; code?: string }) => {
    if (await run(() => post(`/orders/${order.id}/promo`, body), 'ໃຊ້ໂປຣໂມຊັນແລ້ວ')) {
      onDone();
      onClose();
    }
  };
  const remove = async () => {
    if (await run(() => del(`/orders/${order.id}/promo`), 'ເອົາໂປຣໂມຊັນອອກແລ້ວ')) {
      onDone();
      onClose();
    }
  };
  return (
    <Modal open onClose={onClose} title="ໂປຣໂມຊັນ / ຄູປອງ">
      <div className="space-y-4">
        {order.promo_id ? (
          <div className="flex items-center justify-between rounded-lg bg-emerald-50 p-3 text-sm">
            <span>ກຳລັງໃຊ້: <b>{order.promo_name}</b> (ຫຼຸດ {kip(order.discount)})</span>
            <Button size="sm" variant="ghost" onClick={remove} disabled={busy}>ເອົາອອກ</Button>
          </div>
        ) : null}
        <div>
          <div className="mb-2 text-sm font-semibold">ໂປຣໂມຊັນທີ່ໃຊ້ໄດ້ຕອນນີ້</div>
          {!data ? (
            <Spinner />
          ) : data.list.length === 0 ? (
            <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">ບໍ່ມີໂປຣໂມຊັນທີ່ໃຊ້ໄດ້ຕອນນີ້</div>
          ) : (
            <div className="space-y-2">
              {data.list.map((p) => (
                <button
                  key={p.id}
                  disabled={busy || !p.reachable}
                  onClick={() => apply({ promoId: p.id })}
                  className={cx('flex w-full items-center justify-between gap-2 rounded-lg border p-3 text-left text-sm', p.reachable ? 'border-slate-300 hover:border-brand-600' : 'border-slate-200 opacity-60', order.promo_id === p.id && 'border-brand-600 bg-brand-50')}
                >
                  <span>
                    <span className="font-medium">{p.name}</span>
                    <span className="block text-xs text-slate-500">
                      {p.type === 'percent' ? `${p.value}%` : kip(p.value)}
                      {p.max_discount > 0 && ` · ສູງສຸດ ${kip(p.max_discount)}`}
                      {p.min_subtotal > 0 && ` · ຍອດຂັ້ນຕ່ຳ ${kip(p.min_subtotal)}`}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-right font-semibold text-emerald-700">{p.reachable ? `-${kip(p.estimate)}` : 'ຍັງບໍ່ຮອດຍອດ'}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="mb-2 text-sm font-semibold">ມີລະຫັດຄູປອງ?</div>
          <div className="flex gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ເຊັ່ນ VIP50" maxLength={30} />
            <Button onClick={() => apply({ code })} disabled={busy || !code.trim()}>ໃຊ້</Button>
          </div>
        </div>
        <div className="text-xs text-slate-400">ໂປຣໂມຊັນຈະແທນທີ່ສ່ວນຫຼຸດທີ່ໃສ່ເອງ, ແລະ ກົງກັນຂ້າມ</div>
      </div>
    </Modal>
  );
}

function DiscountModal({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState<'percent' | 'amount'>(order.discount_type === 'amount' ? 'amount' : 'percent');
  const [value, setValue] = useState(order.discount_type === 'none' ? 0 : order.discount_value);
  const { busy, run } = useAction();
  const save = async (t: 'none' | 'percent' | 'amount', v: number) => {
    const r = await run(() => post(`/orders/${order.id}/discount`, { type: t, value: v }), t === 'none' ? 'ລຶບສ່ວນຫຼຸດແລ້ວ' : 'ໃສ່ສ່ວນຫຼຸດແລ້ວ');
    if (r) {
      onDone();
      onClose();
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="ສ່ວນຫຼຸດທັງບິນ"
      footer={
        <>
          {order.discount_type !== 'none' && <Button variant="ghost" onClick={() => save('none', 0)} disabled={busy}>ລຶບສ່ວນຫຼຸດ</Button>}
          <Button onClick={() => save(type, value)} loading={busy} disabled={value <= 0}>ບັນທຶກ</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {(['percent', 'amount'] as const).map((t) => (
            <button key={t} onClick={() => { setType(t); setValue(0); }} className={cx('flex-1 rounded-md py-2 text-sm font-medium', type === t ? 'bg-white shadow' : 'text-slate-500')}>
              {t === 'percent' ? 'ເປີເຊັນ (%)' : 'ຈຳນວນເງິນ (₭)'}
            </button>
          ))}
        </div>
        {type === 'percent' ? (
          <>
            <div className="grid grid-cols-5 gap-2">
              {[5, 10, 15, 20, 50].map((p) => (
                <button key={p} onClick={() => setValue(p)} className={cx('rounded-lg border py-2 text-sm', value === p ? 'border-brand-600 bg-brand-50' : 'border-slate-300')}>
                  {p}%
                </button>
              ))}
            </div>
            <Input type="number" min={0} max={100} value={value || ''} onChange={(e) => setValue(Math.min(100, Number(e.target.value) || 0))} placeholder="%" />
          </>
        ) : (
          <MoneyInput value={value} onChange={setValue} placeholder="₭" />
        )}
        <div className="text-sm text-slate-500">ຍອດກ່ອນສ່ວນຫຼຸດ: {kip(order.subtotal)}</div>
      </div>
    </Modal>
  );
}

function TransferModal({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const [floor] = useLoad(() => get<{ tables: FloorTable[] }>('/floor'));
  const { busy, run } = useAction();
  const free = floor?.tables.filter((t) => !t.order_id) ?? [];
  const go = async (tableId: number) => {
    const r = await run(() => post(`/orders/${order.id}/transfer`, { tableId }), 'ຍ້າຍໂຕະແລ້ວ');
    if (r) {
      onDone();
      onClose();
    }
  };
  return (
    <Modal open onClose={onClose} title={`ຍ້າຍຈາກໂຕະ ${order.table_name} ໄປ...`}>
      {!floor ? (
        <Spinner />
      ) : free.length === 0 ? (
        <div className="py-6 text-center text-sm text-slate-500">ບໍ່ມີໂຕະວ່າງ</div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {free.map((t) => (
            <button key={t.id} disabled={busy} onClick={() => go(t.id)} className="rounded-lg border border-slate-300 py-3 font-semibold hover:border-brand-600 hover:bg-brand-50">
              {t.name}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

function VoidModal({ item, onClose, onDone }: { item: OrderItem; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState(item.qty);
  const [reason, setReason] = useState('');
  const { busy, run } = useAction();
  const reasons = ['ລູກຄ້າປ່ຽນໃຈ', 'ສັ່ງຜິດ', 'ອາຫານໝົດ', 'ຄົວເຮັດຜິດ'];
  return (
    <Modal
      open
      onClose={onClose}
      title={`ຍົກເລີກ: ${item.name}`}
      footer={
        <Button
          variant="danger"
          loading={busy}
          disabled={!reason.trim()}
          onClick={async () => {
            const r = await run(() => post(`/order-items/${item.id}/cancel`, { qty, reason }), 'ຍົກເລີກລາຍການແລ້ວ');
            if (r) {
              onDone();
              onClose();
            }
          }}
        >
          ຢືນຢັນຍົກເລີກ
        </Button>
      }
    >
      <div className="space-y-4">
        {item.qty > 1 && (
          <Field label={`ຈຳນວນທີ່ຍົກເລີກ (ສູງສຸດ ${item.qty})`}>
            <Select value={qty} onChange={(e) => setQty(Number(e.target.value))}>
              {Array.from({ length: item.qty }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="ເຫດຜົນ">
          <div className="mb-2 flex flex-wrap gap-2">
            {reasons.map((r) => (
              <button key={r} onClick={() => setReason(r)} className={cx('rounded-full border px-3 py-1 text-sm', reason === r ? 'border-rose-500 bg-rose-50' : 'border-slate-300')}>
                {r}
              </button>
            ))}
          </div>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
        </Field>
      </div>
    </Modal>
  );
}

function CancelModal({ order, hasItems, onClose, onDone }: { order: Order; hasItems: boolean; onClose: () => void; onDone: () => void }) {
  const role = useSession((s) => s.user!.role);
  const [reason, setReason] = useState('');
  const { busy, run } = useAction();
  const allowed = !hasItems || can(role, 'voidItem');
  return (
    <Modal
      open
      onClose={onClose}
      title="ຍົກເລີກອໍເດີທັງໝົດ"
      footer={
        <Button
          variant="danger"
          loading={busy}
          disabled={!allowed || (hasItems && !reason.trim())}
          onClick={async () => {
            const r = await run(() => post(`/orders/${order.id}/cancel`, { reason }), 'ຍົກເລີກອໍເດີແລ້ວ');
            if (r) onDone();
          }}
        >
          ຢືນຢັນຍົກເລີກອໍເດີ
        </Button>
      }
    >
      {!allowed ? (
        <p className="text-sm text-rose-600">ອໍເດີນີ້ມີລາຍການແລ້ວ: ຕ້ອງໃຫ້ຜູ້ຈັດການເປັນຜູ້ຍົກເລີກ</p>
      ) : hasItems ? (
        <Field label="ເຫດຜົນ">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} autoFocus />
        </Field>
      ) : (
        <p className="text-sm text-slate-600">ອໍເດີຍັງບໍ່ມີລາຍການ: ຍົກເລີກ ແລະ ປ່ອຍໂຕະໃຫ້ວ່າງບໍ?</p>
      )}
    </Modal>
  );
}
