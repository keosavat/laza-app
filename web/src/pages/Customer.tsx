// Customer-facing mobile page opened by scanning a table's QR code. No login: the token in the URL is the key.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Bell, ClipboardList, Loader2, Minus, Plus, Receipt, Search, ShoppingBasket, Trash2, UtensilsCrossed } from 'lucide-react';
import type { ChosenOption, OptionGroup } from '../lib/api';
import { kip, time } from '../lib/format';
import { OptionModal } from '../components/MenuPicker';
import { Modal, cx } from '../components/ui';

interface Info { restaurant: string; branch: string; table: string; guestCount: number; canOrder: boolean; autoConfirm: boolean }
interface PItem { id: number; category_id: number | null; name: string; price: number; image_url: string; options: OptionGroup[]; soldOut: boolean }
interface Menu { categories: { id: number; name: string }[]; items: PItem[] }
type State = 'awaiting' | 'pending' | 'preparing' | 'ready' | 'served' | 'cancelled';
interface MyOrder {
  items: { id: number; name: string; qty: number; price: number; options: string[]; note: string; state: State; reason: string; createdAt: string }[];
  totals: { subtotal: number; discount: number; service: number; vat: number; total: number; awaiting: number };
  pendingCalls: ('waiter' | 'bill')[];
  autoConfirm: boolean;
  canOrder: boolean;
}
interface Line { key: string; item: PItem; qty: number; options: ChosenOption[]; note: string }
type Closed = { reason: 'paid' | 'cancelled' | 'expired'; text: string };

const STATE_TEXT: Record<State, [string, string]> = {
  awaiting: ['ລໍຖ້າຮ້ານຢືນຢັນ', 'bg-amber-100 text-amber-800'],
  pending: ['ຮັບອໍເດີແລ້ວ', 'bg-sky-100 text-sky-800'],
  preparing: ['ກຳລັງເຮັດ', 'bg-indigo-100 text-indigo-800'],
  ready: ['ພ້ອມເສີບ', 'bg-violet-100 text-violet-800'],
  served: ['ເສີບແລ້ວ', 'bg-emerald-100 text-emerald-800'],
  cancelled: ['ຍົກເລີກ', 'bg-rose-100 text-rose-700'],
};

class ApiErr extends Error {
  status: number;
  data: any;
  constructor(status: number, message: string, data?: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}
async function pub<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/public/qr/${token}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiErr(0, 'ເຊື່ອມຕໍ່ບໍ່ໄດ້ ກະລຸນາກວດສອບ Wi-Fi');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiErr(res.status, data?.error || 'ເກີດຂໍ້ຜິດພາດ', data);
  return data as T;
}

const lineKey = (id: number, o: ChosenOption[], n: string) => `${id}|${o.map((x) => `${x.group}:${x.name}`).join(',')}|${n}`;
const linePrice = (l: Pick<Line, 'item' | 'options'>) => l.item.price + l.options.reduce((s, o) => s + o.price, 0);

export default function Customer() {
  const token = window.location.pathname.split('/')[2] ?? '';
  const storeKey = `laza_cart_${token}`;
  const [info, setInfo] = useState<Info | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [mine, setMine] = useState<MyOrder | null>(null);
  const [closed, setClosed] = useState<Closed | null>(null);
  const [fatal, setFatal] = useState('');
  const [menuErr, setMenuErr] = useState('');
  const [tab, setTab] = useState<'menu' | 'orders'>('menu');
  const [cat, setCat] = useState<number | 'all'>('all');
  const [q, setQ] = useState('');
  const [cart, setCart] = useState<Line[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(storeKey) || '[]');
    } catch {
      return [];
    }
  });
  const [showCart, setShowCart] = useState(false);
  const [picking, setPicking] = useState<PItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const msgTimer = useRef<ReturnType<typeof setTimeout>>();

  const say = useCallback((text: string, ok = true) => {
    setMsg({ ok, text });
    clearTimeout(msgTimer.current);
    msgTimer.current = setTimeout(() => setMsg(null), 3500);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(cart));
    } catch {
      /* private mode */
    }
  }, [cart, storeKey]);

  const loadMine = useCallback(async () => {
    try {
      setMine(await pub<MyOrder>(token, 'GET', '/orders'));
    } catch (e) {
      if (e instanceof ApiErr && e.status === 410) setClosed({ reason: e.data.reason, text: e.message });
    }
  }, [token]);

  useEffect(() => {
    (async () => {
      try {
        setInfo(await pub<Info>(token, 'GET', ''));
      } catch (e) {
        if (e instanceof ApiErr && e.status === 410) setClosed({ reason: e.data.reason, text: e.message });
        else setFatal(e instanceof Error ? e.message : 'ເກີດຂໍ້ຜິດພາດ');
        return;
      }
      try {
        setMenu(await pub<Menu>(token, 'GET', '/menu'));
      } catch (e) {
        setMenuErr(e instanceof Error ? e.message : '');
      }
      loadMine();
    })();
  }, [token, loadMine]);

  // Live updates: server pushes a nudge whenever staff change this table; polling is the safety net.
  useEffect(() => {
    const s = io({ auth: { qrToken: token }, transports: ['websocket', 'polling'] });
    s.on('sync', loadMine);
    s.on('connect', loadMine);
    const t = setInterval(loadMine, 15_000);
    return () => {
      s.disconnect();
      clearInterval(t);
    };
  }, [token, loadMine]);

  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (menu?.items ?? []).filter((i) => (cat === 'all' || i.category_id === cat) && (!s || i.name.toLowerCase().includes(s)));
  }, [menu, cat, q]);

  const add = (item: PItem, options: ChosenOption[], note: string) => {
    const key = lineKey(item.id, options, note);
    setCart((c) => (c.some((l) => l.key === key) ? c.map((l) => (l.key === key ? { ...l, qty: Math.min(20, l.qty + 1) } : l)) : [...c, { key, item, options, note, qty: 1 }]));
  };
  const bump = (key: string, d: number) => setCart((c) => c.map((l) => (l.key === key ? { ...l, qty: Math.min(20, l.qty + d) } : l)).filter((l) => l.qty > 0));
  const cartQty = cart.reduce((s, l) => s + l.qty, 0);
  const cartTotal = cart.reduce((s, l) => s + linePrice(l) * l.qty, 0);

  async function submit() {
    setBusy(true);
    try {
      const r = await pub<{ awaiting: boolean }>(token, 'POST', '/orders', {
        items: cart.map((l) => ({ menuItemId: l.item.id, qty: l.qty, options: l.options.map((o) => ({ group: o.group, name: o.name })), note: l.note })),
      });
      setCart([]);
      setShowCart(false);
      setTab('orders');
      say(r.awaiting ? 'ສົ່ງອໍເດີແລ້ວ ລໍຖ້າພະນັກງານຢືນຢັນ' : 'ສົ່ງອໍເດີເຂົ້າຄົວແລ້ວ');
      loadMine();
    } catch (e) {
      if (e instanceof ApiErr && e.status === 410) return setClosed({ reason: e.data.reason, text: e.message });
      say(e instanceof Error ? e.message : 'ສົ່ງບໍ່ສຳເລັດ', false);
    } finally {
      setBusy(false);
    }
  }

  async function call(type: 'waiter' | 'bill') {
    try {
      await pub(token, 'POST', '/call', { type });
      say(type === 'bill' ? 'ແຈ້ງຂໍບິນແລ້ວ ພະນັກງານກຳລັງມາ' : 'ເອີ້ນພະນັກງານແລ້ວ');
      loadMine();
    } catch (e) {
      say(e instanceof Error ? e.message : 'ເອີ້ນບໍ່ສຳເລັດ', false);
    }
  }

  if (fatal) return <Screen icon="❓" title="ເປີດ QR ນີ້ບໍ່ໄດ້" text={fatal + ' · ກະລຸນາສອບຖາມພະນັກງານ'} />;
  if (closed) {
    return (
      <Screen
        icon={closed.reason === 'paid' ? '🙏' : '⌛'}
        title={closed.reason === 'paid' ? 'ຂອບໃຈທີ່ໃຊ້ບໍລິການ' : closed.reason === 'expired' ? 'QR ໝົດເວລາ' : 'ອໍເດີຖືກຍົກເລີກ'}
        text={closed.text + (closed.reason === 'paid' ? '' : ' · ຖ້າຕ້ອງການສັ່ງຕື່ມ ກະລຸນາຖາມພະນັກງານ')}
      />
    );
  }
  if (!info) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-8 animate-spin text-brand-600" />
      </div>
    );
  }

  const orderCount = mine?.items.filter((i) => i.state !== 'cancelled').length ?? 0;
  const autoConfirm = mine?.autoConfirm ?? info.autoConfirm;
  const canOrder = mine?.canOrder ?? info.canOrder;

  return (
    <div className="mx-auto flex h-full max-w-xl flex-col bg-white">
      <header className="bg-brand-600 px-4 py-3 text-white">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <div className="truncate text-lg font-bold">{info.restaurant}</div>
            <div className="text-sm text-brand-100">ໂຕະ {info.table}</div>
          </div>
          <img src="/laza.svg" alt="" className="size-9 opacity-90" />
        </div>
      </header>

      {msg && (
        <div className={cx('fixed inset-x-4 top-3 z-[60] mx-auto max-w-md rounded-xl px-4 py-3 text-center text-sm font-medium text-white shadow-lg', msg.ok ? 'bg-emerald-600' : 'bg-rose-600')}>{msg.text}</div>
      )}

      {tab === 'menu' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {menuErr || !canOrder ? (
            <div className="m-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{menuErr || 'ຮ້ານປິດການສັ່ງຜ່ານ QR ຊົ່ວຄາວ ກະລຸນາເອີ້ນພະນັກງານ'}</div>
          ) : !menu ? (
            <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin text-brand-600" /></div>
          ) : (
            <>
              <div className="space-y-2 border-b border-slate-100 p-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ຄົ້ນຫາເມນູ..." className="h-10 w-full rounded-full border border-slate-300 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-brand-500" />
                </div>
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  <Pill active={cat === 'all'} onClick={() => setCat('all')}>ທັງໝົດ</Pill>
                  {menu.categories.map((c) => (
                    <Pill key={c.id} active={cat === c.id} onClick={() => setCat(c.id)}>{c.name}</Pill>
                  ))}
                </div>
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 pb-28">
                {items.length === 0 && <div className="py-10 text-center text-sm text-slate-400">ບໍ່ພົບເມນູ</div>}
                {items.map((it) => (
                  <button key={it.id} onClick={() => (it.options.length ? setPicking(it) : add(it, [], ''))} disabled={it.soldOut} className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 p-2 text-left shadow-sm active:scale-[.99] disabled:opacity-50">
                    <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 text-lg font-bold text-slate-300">
                      {it.image_url ? <img src={it.image_url} alt="" className="size-full object-cover" loading="lazy" /> : it.name.slice(0, 2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 font-medium leading-snug">{it.name}</div>
                      <div className="tabular font-semibold text-brand-700">{kip(it.price)}</div>
                      {it.soldOut ? <div className="text-xs font-semibold text-rose-600">ໝົດແລ້ວ</div> : it.options.length > 0 && <div className="text-[11px] text-slate-400">ມີຕົວເລືອກ</div>}
                    </div>
                    <span className={cx('flex size-9 shrink-0 items-center justify-center rounded-full text-white', it.soldOut ? 'bg-slate-300' : 'bg-brand-600')}><Plus className="size-5" /></span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-24">
          <div className="mb-3 grid grid-cols-2 gap-2">
            <CallBtn icon={Bell} label="ເອີ້ນພະນັກງານ" done={mine?.pendingCalls.includes('waiter')} onClick={() => call('waiter')} />
            <CallBtn icon={Receipt} label="ຂໍບິນ / ເກັບເງິນ" done={mine?.pendingCalls.includes('bill')} onClick={() => call('bill')} />
          </div>
          {!mine ? (
            <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin text-brand-600" /></div>
          ) : mine.items.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
              <ClipboardList className="mx-auto mb-2 size-10" />
              ຍັງບໍ່ໄດ້ສັ່ງຫຍັງ
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {mine.items.map((i) => (
                  <div key={i.id} className={cx('rounded-xl border p-3', i.state === 'cancelled' ? 'border-slate-200 opacity-60' : 'border-slate-200')}>
                    <div className="flex justify-between gap-2">
                      <div className="min-w-0">
                        <div className={cx('font-medium', i.state === 'cancelled' && 'line-through')}>{i.qty}× {i.name}</div>
                        {(i.options.length > 0 || i.note) && <div className="text-xs text-slate-500">{[...i.options, i.note && `* ${i.note}`].filter(Boolean).join(', ')}</div>}
                        {i.state === 'cancelled' && i.reason && <div className="text-xs text-rose-600">{i.reason}</div>}
                      </div>
                      <div className="tabular shrink-0 text-sm">{kip(i.price)}</div>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className={cx('rounded-full px-2 py-0.5 text-xs font-medium', STATE_TEXT[i.state][1])}>{STATE_TEXT[i.state][0]}</span>
                      <span className="text-[11px] text-slate-400">{time(i.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 space-y-1 rounded-xl bg-slate-50 p-3 text-sm">
                <Row l="ລວມ" v={mine.totals.subtotal} />
                {mine.totals.discount > 0 && <Row l="ສ່ວນຫຼຸດ" v={-mine.totals.discount} />}
                {mine.totals.service > 0 && <Row l="ຄ່າບໍລິການ" v={mine.totals.service} />}
                {mine.totals.vat > 0 && <Row l="VAT" v={mine.totals.vat} />}
                <div className="flex items-end justify-between border-t border-slate-200 pt-2">
                  <span className="font-semibold">ຍອດທີ່ຕ້ອງຈ່າຍ</span>
                  <span className="tabular text-2xl font-bold text-brand-700">{kip(mine.totals.total)}</span>
                </div>
                {mine.totals.awaiting > 0 && <div className="text-xs text-amber-700">ບໍ່ລວມ {kip(mine.totals.awaiting)} ທີ່ລໍຖ້າຮ້ານຢືນຢັນ</div>}
              </div>
              <p className="mt-3 text-center text-xs text-slate-400">ຊຳລະເງິນກັບພະນັກງານ · ຍອດອາດມີການປ່ຽນແປງເມື່ອຮ້ານຢືນຢັນ</p>
            </>
          )}
        </div>
      )}

      {tab === 'menu' && cartQty > 0 && (
        <button onClick={() => setShowCart(true)} className="fixed inset-x-3 bottom-[4.5rem] z-30 mx-auto flex max-w-xl items-center justify-between rounded-2xl bg-brand-700 px-4 py-3 text-white shadow-xl">
          <span className="flex items-center gap-2 font-semibold"><ShoppingBasket className="size-5" /> ເບິ່ງກະຕ່າ · {cartQty} ລາຍການ</span>
          <span className="tabular font-bold">{kip(cartTotal)}</span>
        </button>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto grid max-w-xl grid-cols-2 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
        <TabBtn active={tab === 'menu'} icon={UtensilsCrossed} label="ເມນູ" onClick={() => setTab('menu')} />
        <TabBtn active={tab === 'orders'} icon={ClipboardList} label="ອໍເດີຂອງຂ້ອຍ" badge={orderCount} onClick={() => { setTab('orders'); loadMine(); }} />
      </nav>

      {picking && <OptionModal item={picking} onClose={() => setPicking(null)} onDone={(o, n) => { add(picking, o, n); setPicking(null); }} />}

      <Modal
        open={showCart}
        onClose={() => setShowCart(false)}
        title={`ກະຕ່າ (${cartQty})`}
        footer={
          <button onClick={submit} disabled={busy || !cart.length} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-base font-semibold text-white disabled:opacity-50">
            {busy && <Loader2 className="size-4 animate-spin" />} ສັ່ງເລີຍ · {kip(cartTotal)}
          </button>
        }
      >
        <div className="divide-y divide-slate-100">
          {cart.map((l) => (
            <div key={l.key} className="flex items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{l.item.name}</div>
                {(l.options.length > 0 || l.note) && <div className="text-xs text-slate-500">{[...l.options.map((o) => o.name), l.note && `* ${l.note}`].filter(Boolean).join(', ')}</div>}
                <div className="tabular text-sm text-brand-700">{kip(linePrice(l) * l.qty)}</div>
              </div>
              <div className="flex items-center gap-1">
                <Step onClick={() => bump(l.key, -1)}>{l.qty === 1 ? <Trash2 className="size-4 text-rose-600" /> : <Minus className="size-4" />}</Step>
                <span className="tabular w-7 text-center font-semibold">{l.qty}</span>
                <Step onClick={() => bump(l.key, 1)}><Plus className="size-4" /></Step>
              </div>
            </div>
          ))}
          {!cart.length && <div className="py-6 text-center text-sm text-slate-400">ກະຕ່າວ່າງ</div>}
        </div>
        {!autoConfirm && <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">ຮ້ານຈະຢືນຢັນອໍເດີກ່ອນສົ່ງເຂົ້າຄົວ</p>}
      </Modal>
    </div>
  );
}

function Screen({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div className="mx-auto flex h-full max-w-sm flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="text-5xl">{icon}</div>
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="text-sm text-slate-600">{text}</p>
    </div>
  );
}
function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cx('shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium', active ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700')}>
      {children}
    </button>
  );
}
function TabBtn({ active, icon: Icon, label, badge, onClick }: { active: boolean; icon: typeof Bell; label: string; badge?: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cx('relative flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium', active ? 'text-brand-700' : 'text-slate-500')}>
      <Icon className="size-5" />
      {label}
      {!!badge && <span className="absolute right-[28%] top-1.5 min-w-4 rounded-full bg-rose-600 px-1 text-[10px] leading-4 text-white">{badge}</span>}
    </button>
  );
}
function CallBtn({ icon: Icon, label, done, onClick }: { icon: typeof Bell; label: string; done?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={done} className={cx('flex items-center justify-center gap-2 rounded-xl border-2 py-3 text-sm font-medium', done ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-brand-600 text-brand-700 active:bg-brand-50')}>
      <Icon className="size-4" />
      {done ? 'ແຈ້ງແລ້ວ ລໍຖ້າສັກຄູ່' : label}
    </button>
  );
}
function Step({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className="flex size-9 items-center justify-center rounded-lg border border-slate-300 active:bg-slate-100">{children}</button>;
}
function Row({ l, v }: { l: string; v: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-600">{l}</span>
      <span className="tabular">{kip(v)}</span>
    </div>
  );
}
