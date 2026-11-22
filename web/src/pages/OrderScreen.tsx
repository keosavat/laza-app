import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRightLeft, Ban, Check, Minus, Percent, Plus, Printer, QrCode, Send, Trash2, Wallet, ChefHat, X } from 'lucide-react';
import QrModal from '../components/QrModal';
import { get, post, type Order, type OrderItem, type FloorTable } from '../lib/api';
import { useSession, useSync } from '../lib/store';
import { can, kip, since, STATUS_CLASS, STATUS_LABEL, time } from '../lib/format';
import { device } from '../lib/device';
import { printBill, printKitchenTicket } from '../lib/print';
import MenuPicker, { lineKey, linePrice, type CartLine } from '../components/MenuPicker';
import Checkout from '../components/Checkout';
import { Badge, Button, Field, Input, Modal, MoneyInput, Select, Spinner, cx, toast, useAction, useLoad } from '../components/ui';

export default function OrderScreen() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, branch, restaurant } = useSession();
  const role = user!.role;
  const [order, reload, loading] = useLoad(() => get<Order>(`/orders/${id}`), [id]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [modal, setModal] = useState<null | 'discount' | 'transfer' | 'checkout' | 'cancel' | 'qr'>(null);
  const [voiding, setVoiding] = useState<OrderItem | null>(null);
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

  const back = useCallback(() => nav(order?.type === 'takeaway' ? '/takeaway' : '/tables'), [nav, order?.type]);

  if (loading || !order) return <Spinner />;
  const closed = order.status !== 'open';
  const waiting = order.items.filter((i) => i.awaiting && i.status !== 'cancelled');

  const add = (item: CartLine['item'], options: CartLine['options'], note: string) => {
    if (closed) return;
    const key = lineKey(item.id, options, note);
    setCart((c) => (c.some((l) => l.key === key) ? c.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l)) : [...c, { key, item, options, note, qty: 1 }]));
  };
  const bump = (key: string, d: number) => setCart((c) => c.map((l) => (l.key === key ? { ...l, qty: l.qty + d } : l)).filter((l) => l.qty > 0));
  const cartTotal = cart.reduce((s, l) => s + linePrice(l) * l.qty, 0);
  const cartQty = cart.reduce((s, l) => s + l.qty, 0);

  /** Send the cart to the kitchen. Returns the updated order (or undefined on failure). */
  async function send(): Promise<Order | undefined> {
    if (!cart.length) return order;
    const r = await run(() =>
      post<{ itemIds: number[]; order: Order }>(`/orders/${order!.id}/items`, {
        items: cart.map((l) => ({ menuItemId: l.item.id, qty: l.qty, options: l.options, note: l.note })),
      }),
    );
    if (!r) return undefined;
    setCart([]);
    if (device.autoKitchenPrint) printKitchenTicket(r.order, r.order.items.filter((i) => r.itemIds.includes(i.id)), user!.name);
    toast.ok(`ສົ່ງເຂົ້າຄົວແລ້ວ ${r.itemIds.length} ລາຍການ`);
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
    const r = await run(() => post<Order>(`/orders/${order!.id}/print-bill`));
    if (r) printBill(r, restaurant!, branch!);
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
          <div className={cx('mt-3 grid gap-1.5', order.type === 'dine_in' ? 'grid-cols-5' : 'grid-cols-4')}>
            {order.type === 'dine_in' && <ActionBtn icon={QrCode} label="QR" onClick={() => setModal('qr')} highlight={!!order.qr_token} />}
            <ActionBtn icon={Printer} label="ພິມບິນ" onClick={doPrintBill} disabled={busy || (!active.length && !cart.length)} />
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
        {order.items.length > 0 && (
          <div className="divide-y divide-slate-100">
            {order.items.map((it) => (
              <div key={it.id} className={cx('flex gap-2 px-3 py-2', it.status === 'cancelled' && 'opacity-60', it.awaiting === 1 && it.status !== 'cancelled' && 'bg-rose-50/60')}>
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
                <div className="text-right">
                  <div className="tabular text-sm">{kip(it.unit_price * it.qty)}</div>
                  {!closed && it.awaiting === 1 && it.status !== 'cancelled' && can(role, 'pos') && (
                    <div className="mt-1 flex justify-end gap-2 text-xs">
                      <button onClick={() => decide('approve', [it.id])} className="font-semibold text-emerald-700 hover:underline">ຢືນຢັນ</button>
                      <button onClick={() => decide('reject', [it.id])} className="text-rose-600 hover:underline">ປະຕິເສດ</button>
                    </div>
                  )}
                  {!closed && !it.awaiting && it.status !== 'cancelled' && can(role, 'voidItem') && (
                    <button onClick={() => setVoiding(it)} className="mt-1 text-xs text-rose-600 hover:underline">
                      ຍົກເລີກ
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {cart.length > 0 && (
          <div className="border-t-4 border-dashed border-brand-200 bg-brand-50/50">
            <div className="px-3 pt-2 text-xs font-semibold text-brand-700">ລາຍການໃໝ່ (ຍັງບໍ່ສົ່ງ)</div>
            {cart.map((l) => (
              <div key={l.key} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{l.item.name}</div>
                  <Extras options={l.options.map((o) => o.name)} note={l.note} />
                  <div className="tabular text-xs text-slate-500">{kip(linePrice(l))}</div>
                </div>
                <div className="flex items-center gap-1">
                  <IconBtn onClick={() => bump(l.key, -1)} label="ລົດ">{l.qty === 1 ? <Trash2 className="size-4 text-rose-600" /> : <Minus className="size-4" />}</IconBtn>
                  <span className="tabular w-7 text-center font-semibold">{l.qty}</span>
                  <IconBtn onClick={() => bump(l.key, 1)} label="ເພີ່ມ"><Plus className="size-4" /></IconBtn>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1 border-t border-slate-200 p-3 text-sm">
        <Line label="ລວມ" value={order.subtotal + cartTotal} />
        {order.discount > 0 && <Line label={`ສ່ວນຫຼຸດ${order.discount_type === 'percent' ? ` ${order.discount_value}%` : ''}`} value={-order.discount} className="text-rose-600" />}
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
      {voiding && <VoidModal item={voiding} onClose={() => setVoiding(null)} onDone={reload} />}
    </div>
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
function IconBtn({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} className="flex size-8 items-center justify-center rounded-lg border border-slate-300 bg-white hover:bg-slate-50">
      {children}
    </button>
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
