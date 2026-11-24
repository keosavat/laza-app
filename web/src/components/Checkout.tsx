import { useMemo, useState } from 'react';
import { Banknote, CreditCard, Landmark, QrCode, Trash2 } from 'lucide-react';
import { post, type Currency, type Order, type PayMethod } from '../lib/api';
import { useSession } from '../lib/store';
import { kip, METHOD_LABEL } from '../lib/format';
import { device } from '../lib/device';
import { printReceipt } from '../lib/print';
import { Button, Modal, cx, toast } from './ui';
import CustomerPicker, { type Customer } from './CustomerPicker';

interface Line { method: PayMethod; currency: Currency; amount: number }
const METHODS: { id: PayMethod; icon: typeof Banknote }[] = [
  { id: 'cash', icon: Banknote },
  { id: 'transfer', icon: Landmark },
  { id: 'qr', icon: QrCode },
  { id: 'card', icon: CreditCard },
];
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', '⌫'];

export default function Checkout({ order, onClose, onPaid }: { order: Order; onClose: () => void; onPaid: (o: Order) => void }) {
  const { branch, restaurant, user } = useSession();
  const rate = (c: Currency) => (c === 'USD' ? branch!.rate_usd : c === 'THB' ? branch!.rate_thb : 1);
  const [lines, setLines] = useState<Line[]>([]);
  const [method, setMethod] = useState<PayMethod>('cash');
  const [currency, setCurrency] = useState<Currency>('LAK');
  const [entry, setEntry] = useState('');
  const [printIt, setPrintIt] = useState(device.autoReceiptPrint);
  const [busy, setBusy] = useState(false);
  const [onCredit, setOnCredit] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [member, setMember] = useState(false);
  const [redeem, setRedeem] = useState(0);
  const earnPer = branch!.loyalty_earn_per;
  const redeemValue = branch!.loyalty_redeem_value;
  const useCustomer = member || onCredit ? customer : null;
  // Points a customer can spend on this bill, and what they are worth.
  const maxRedeem = useCustomer && redeemValue > 0 ? Math.min(useCustomer.points ?? 0, Math.floor(order.total / redeemValue)) : 0;
  const redeemPts = Math.min(redeem, maxRedeem);
  const pointsValue = redeemPts * redeemValue;
  const net = order.total - pointsValue;

  const paidLak = lines.reduce((s, l) => s + Math.round(l.amount * rate(l.currency)), 0);
  const remaining = Math.max(net - paidLak, 0);
  const remainingIn = (c: Currency) => (c === 'LAK' ? remaining : Math.ceil((remaining / rate(c)) * 100) / 100);
  const entryAmount = entry === '' ? remainingIn(currency) : Number(entry);
  // On credit: the amount typed is what is paid now; the rest goes on the customer's account.
  const pending: Line | null = remaining > 0 && entryAmount > 0 && (!onCredit || entry !== '') ? { method, currency, amount: entryAmount } : null;
  const all = pending ? [...lines, pending] : lines;
  const totalLak = all.reduce((s, l) => s + Math.round(l.amount * rate(l.currency)), 0);
  const cashLak = all.filter((l) => l.method === 'cash').reduce((s, l) => s + Math.round(l.amount * rate(l.currency)), 0);
  const debtLak = onCredit ? Math.max(net - totalLak, 0) : 0;
  const change = totalLak - (net - debtLak);
  const earnNow = useCustomer && earnPer > 0 ? Math.floor(net / earnPer) : 0;
  const problem = onCredit && debtLak > 0 && !customer ? 'ກະລຸນາເລືອກລູກຄ້າທີ່ຕິດໜີ້' : totalLak < net && !onCredit ? `ຍັງຂາດ ${kip(net - totalLak)}` : change > cashLak ? 'ເງິນທອນໄດ້ສະເພາະເງິນສົດ' : '';

  const quick = useMemo(() => {
    if (currency !== 'LAK') return [];
    const r = remaining;
    const set = new Set<number>([r]);
    for (const step of [10000, 50000, 100000]) set.add(Math.ceil(r / step) * step);
    return [...set].filter((x) => x > 0).slice(0, 4);
  }, [remaining, currency]);

  function key(k: string) {
    setEntry((e) => (k === '⌫' ? e.slice(0, -1) : (e + k).replace(/^0+(?=\d)/, '').slice(0, 12)));
  }
  function addLine() {
    if (!pending) return;
    setLines((l) => [...l, pending]);
    setEntry('');
  }

  async function pay() {
    if (problem) return toast.err(problem);
    setBusy(true);
    try {
      const r = await post<{ order: Order; change: number; printedByServer: boolean; pointsEarned: number }>(`/orders/${order.id}/pay`, {
        payments: all,
        print: printIt,
        ...(useCustomer ? { customerId: useCustomer.id } : {}),
        ...(redeemPts > 0 ? { redeemPoints: redeemPts } : {}),
        ...(debtLak > 0 && customer ? { debt: { customerId: customer.id, amount: debtLak } } : {}),
      });
      device.autoReceiptPrint = printIt;
      if (printIt && !r.printedByServer) printReceipt(r.order, restaurant!, branch!, user!.name);
      toast.ok(`ຊຳລະແລ້ວ${r.change ? ` · ທອນ ${kip(r.change)}` : ''}${r.pointsEarned ? ` · ໄດ້ ${r.pointsEarned.toLocaleString('en-US')} ຄະແນນ` : ''}`);
      onPaid(r.order);
    } catch (e) {
      toast.err(e);
    } finally {
      setBusy(false);
    }
  }

  const where = order.type === 'dine_in' ? `ໂຕະ ${order.table_name}` : `ກັບບ້ານ · ຄິວ ${order.queue_no}`;
  return (
    <Modal open onClose={onClose} title={`ຊຳລະເງິນ · ${where}`} wide>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <div className="rounded-xl bg-slate-900 p-4 text-white">
            <div className="text-sm text-slate-300">ຍອດທີ່ຕ້ອງຊຳລະ</div>
            <div className="tabular text-3xl font-bold">{kip(net)}</div>
            {pointsValue > 0 && <div className="tabular text-xs text-amber-300">ຍອດບິນ {kip(order.total)} − ຄະແນນ {kip(pointsValue)}</div>}
            <div className="tabular mt-1 text-sm text-slate-300">
              ≈ ${(net / branch!.rate_usd).toFixed(2)} · ฿{(net / branch!.rate_thb).toFixed(0)}
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {METHODS.map((m) => (
              <button
                key={m.id}
                onClick={() => setMethod(m.id)}
                className={cx('flex flex-col items-center gap-1 rounded-xl border-2 p-2 text-xs font-medium', method === m.id ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-200')}
              >
                <m.icon className="size-5" />
                {METHOD_LABEL[m.id]}
              </button>
            ))}
          </div>
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
            {(['LAK', 'USD', 'THB'] as Currency[]).map((c) => (
              <button
                key={c}
                onClick={() => {
                  setCurrency(c);
                  setEntry('');
                }}
                className={cx('flex-1 rounded-md py-1.5 text-sm font-medium', currency === c ? 'bg-white shadow' : 'text-slate-500')}
              >
                {c}
              </button>
            ))}
          </div>
          {lines.length > 0 && (
            <div className="space-y-1 rounded-lg border border-slate-200 p-2">
              {lines.map((l, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span>
                    {METHOD_LABEL[l.method]} · {l.currency} {l.amount.toLocaleString('en-US')}
                  </span>
                  <button onClick={() => setLines((x) => x.filter((_, j) => j !== i))} className="text-rose-600" aria-label="ລຶບ">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={onCredit} onChange={(e) => { setOnCredit(e.target.checked); setEntry(''); }} className="size-4 accent-brand-600" />
              ຕິດໜີ້ (ຈ່າຍພາຍຫຼັງ)
            </label>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={member || onCredit} disabled={onCredit} onChange={(e) => { setMember(e.target.checked); if (!e.target.checked) setRedeem(0); }} className="size-4 accent-brand-600" />
              ລູກຄ້າສະມາຊິກ{earnPer > 0 || redeemValue > 0 ? ' (ສະສົມ/ແລກຄະແນນ)' : ''}
            </label>
            {(member || onCredit) && (
              <>
                <CustomerPicker value={customer} onPick={(c) => { setCustomer(c); setRedeem(0); }} />
                {onCredit && <p className="text-xs text-slate-500">ໃສ່ຍອດທີ່ຈ່າຍຕອນນີ້ (ຖ້າມີ) ແລ້ວກົດ "ແຍກຈ່າຍ"; ສ່ວນທີ່ເຫຼືອຈະຕິດໜີ້ລູກຄ້າ.</p>}
              </>
            )}
            {useCustomer && redeemValue > 0 && (useCustomer.points ?? 0) > 0 && (
              <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">ແລກຄະແນນ <span className="text-xs font-normal text-slate-500">(ມີ {(useCustomer.points ?? 0).toLocaleString('en-US')} · 1 ຄະແນນ = {kip(redeemValue)})</span></span>
                  <button className="text-xs font-semibold text-brand-700 underline" onClick={() => setRedeem(maxRedeem)}>ໃຊ້ທັງໝົດ</button>
                </div>
                <div className="flex items-center gap-2">
                  <input type="number" min={0} max={maxRedeem} value={redeemPts || ''} placeholder="0" onChange={(e) => { setRedeem(Math.max(0, Math.min(maxRedeem, Math.floor(Number(e.target.value) || 0)))); setEntry(''); }} className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-right" />
                  <span className="tabular text-xs text-slate-600">{pointsValue > 0 ? `ຫຼຸດ ${kip(pointsValue)}` : `ສູງສຸດ ${maxRedeem.toLocaleString('en-US')} ຄະແນນ`}</span>
                </div>
              </div>
            )}
            {useCustomer && earnNow > 0 && <p className="text-xs text-emerald-700">ບິນນີ້ຈະໄດ້ ≈ {earnNow.toLocaleString('en-US')} ຄະແນນ</p>}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={printIt} onChange={(e) => setPrintIt(e.target.checked)} className="size-4 accent-brand-600" />
            ພິມໃບຮັບເງິນ
          </label>
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border-2 border-brand-500 px-4 py-3 text-right">
            <div className="text-xs text-slate-500">
              {METHOD_LABEL[method]} ({currency}) {entry === '' && remaining > 0 && '· ຍອດຄົງເຫຼືອ'}
            </div>
            <div className="tabular text-3xl font-bold">
              {currency === 'LAK' ? '₭' : currency === 'USD' ? '$' : '฿'}
              {entryAmount.toLocaleString('en-US')}
            </div>
          </div>
          {(
            <div className="grid min-h-8 grid-cols-4 gap-2">
              {quick.map((q) => (
                <button key={q} onClick={() => setEntry(String(q))} className="tabular rounded-lg bg-brand-50 py-2 text-xs font-semibold text-brand-800 hover:bg-brand-100">
                  {q.toLocaleString('en-US')}
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            {KEYS.map((k) => (
              <button key={k} onClick={() => key(k)} className="tabular h-12 rounded-lg bg-slate-100 text-lg font-semibold hover:bg-slate-200 active:bg-slate-300">
                {k}
              </button>
            ))}
          </div>
          <Button variant="secondary" className="w-full" onClick={addLine} disabled={!pending}>
            + ແຍກຈ່າຍ (ເພີ່ມວິທີຊຳລະອື່ນ)
          </Button>
          <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm">
            <Row label="ຮັບເງິນລວມ" value={kip(totalLak)} />
            {pointsValue > 0 && <Row label={`ແລກ ${redeemPts} ຄະແນນ`} value={`−${kip(pointsValue)}`} />}
            {debtLak > 0 && <Row label="ຕິດໜີ້" value={kip(debtLak)} strong />}
            <Row label="ເງິນທອນ" value={kip(Math.max(change, 0))} strong />
            {problem && <div className="text-rose-600">{problem}</div>}
          </div>
          <Button size="lg" className="w-full" onClick={pay} loading={busy} disabled={!!problem}>
            {debtLak > 0 ? 'ຢືນຢັນ (ຕິດໜີ້)' : 'ຢືນຢັນການຊຳລະ'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cx('flex justify-between', strong && 'text-lg font-bold text-brand-700')}>
      <span>{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );
}
