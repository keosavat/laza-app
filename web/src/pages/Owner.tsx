import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Info, RefreshCw, Receipt, Wallet } from 'lucide-react';
import { get } from '../lib/api';
import { kip, since, time } from '../lib/format';
import { Badge, Card, Spinner, cx, useLoad } from '../components/ui';

interface Branch {
  id: number; name: string;
  today: { bills: number; sales: number; discount: number; avgBill: number; cancelled: number };
  yesterday: number; lastWeek: number;
  open: { n: number; total: number; oldestMin: number };
  shift: { openedAt: string; by: string; expectedCash: number } | null;
  stock: { out: number; low: number };
  debt: number; owedSuppliers: number; deposits: number;
}
interface Overview {
  at: string;
  totals: { sales: number; bills: number; avgBill: number; yesterday: number; lastWeek: number; openOrders: number; openTotal: number; cancelled: number; discount: number; debt: number; owedSuppliers: number; deposits: number; shiftsOpen: number };
  branches: Branch[];
  trend: { date: string; sales: number }[];
  recent: { id: number; branch: string; bill_no: string; total: number; paid_at: string; type: string; table_name: string | null; methods: string | null }[];
  flags: { level: 'warn' | 'info'; branchId: number; branch: string; text: string }[];
}
const METHOD: Record<string, string> = { cash: 'ເງິນສົດ', transfer: 'ໂອນ', qr: 'QR', card: 'ບັດ' };

/** Percent change with a label; null when there is nothing to compare with. */
function delta(now: number, before: number) {
  if (!(before > 0)) return null;
  return Math.round(((now - before) / before) * 100);
}

export default function Owner() {
  const [d, reload, loading] = useLoad(() => get<Overview>('/owner/overview'));

  // Live enough for a phone left open on the table: refresh every 30s and whenever the app comes back to the foreground.
  useEffect(() => {
    const t = setInterval(reload, 30_000);
    const vis = () => document.visibilityState === 'visible' && reload();
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [reload]);

  if (loading || !d) return <Spinner />;
  const t = d.totals;
  const max = Math.max(1, ...d.trend.map((x) => x.sales));
  const vsY = delta(t.sales, t.yesterday);
  const vsW = delta(t.sales, t.lastWeek);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">ພາບລວມເຈົ້າຂອງຮ້ານ</h1>
          <p className="text-xs text-slate-500">ອັບເດດ {time(d.at)} · ຣີເຟຣດເອງທຸກ 30 ວິນາທີ</p>
        </div>
        <button onClick={reload} className="rounded-full border border-slate-300 bg-white p-2.5 text-slate-600 active:scale-95" aria-label="ຣີເຟຣດ"><RefreshCw className="size-4" /></button>
      </div>

      <div className="rounded-xl bg-brand-700 p-5 text-white shadow-sm">
        <div className="text-sm text-white/80">ຍອດຂາຍມື້ນີ້ (ທຸກສາຂາ)</div>
        <div className="tabular mt-1 text-4xl font-bold">{kip(t.sales)}</div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <Delta label="ມື້ວານ" pct={vsY} />
          <Delta label="ອາທິດແລ້ວ" pct={vsW} />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <Mini k="ບິນ" v={t.bills.toLocaleString('en-US')} />
          <Mini k="ສະເລ່ຍ/ບິນ" v={kip(t.avgBill)} />
          <Mini k="ຍັງເປີດ" v={`${t.openOrders} · ${kip(t.openTotal)}`} />
        </div>
      </div>

      {d.flags.length > 0 && (
        <div className="space-y-2">
          {d.flags.map((f, i) => (
            <div key={i} className={cx('flex items-start gap-2 rounded-xl border p-3 text-sm', f.level === 'warn' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-600')}>
              {f.level === 'warn' ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" /> : <Info className="mt-0.5 size-4 shrink-0 text-slate-400" />}
              <span><b>{f.branch}</b> · {f.text}</span>
            </div>
          ))}
        </div>
      )}

      <Card className="p-4">
        <div className="mb-2 flex items-baseline justify-between"><h2 className="font-semibold">7 ວັນຜ່ານມາ</h2><span className="text-xs text-slate-500">ລວມທຸກສາຂາ</span></div>
        <div className="flex h-28 items-end gap-1.5">
          {d.trend.map((x, i) => (
            <div key={x.date} className="flex h-full flex-1 flex-col justify-end" title={`${x.date}: ${kip(x.sales)}`}>
              <div className={cx('rounded-t', i === d.trend.length - 1 ? 'bg-brand-600' : 'bg-slate-300')} style={{ height: `${Math.max(2, (x.sales / max) * 100)}%` }} />
              <div className="mt-1 text-center text-[10px] text-slate-400">{x.date.slice(8)}</div>
            </div>
          ))}
        </div>
      </Card>

      <div className="space-y-3">
        {d.branches.map((b) => {
          const y = delta(b.today.sales, b.yesterday);
          return (
            <Card key={b.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 truncate font-semibold">{b.name}</div>
                {b.shift ? <Badge className="bg-emerald-100 text-emerald-800">ເປີດກະ</Badge> : <Badge className="bg-slate-100 text-slate-500">ປິດກະ</Badge>}
              </div>
              <div className="mt-1 flex items-end justify-between gap-2">
                <div className="tabular text-2xl font-bold text-brand-700">{kip(b.today.sales)}</div>
                {y !== null && <span className={cx('flex items-center text-xs font-medium', y >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{y >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}{Math.abs(y)}% ມື້ວານ</span>}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <Cell k="ບິນ" v={String(b.today.bills)} />
                <Cell k="ຍັງເປີດ" v={b.open.n ? `${b.open.n} · ${since(new Date(Date.now() - b.open.oldestMin * 60000).toISOString())}` : '0'} warn={b.open.oldestMin > 240} />
                <Cell k="ຍົກເລີກ" v={kip(b.today.cancelled)} />
              </div>
              {b.shift && (
                <div className="mt-3 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <Wallet className="size-4 text-slate-400" />
                  <span>ເງິນໃນລິ້ນຊັກຄວນມີ <b className="tabular">{kip(b.shift.expectedCash)}</b></span>
                  <span className="ml-auto text-slate-400">{b.shift.by} · {since(b.shift.openedAt)}</span>
                </div>
              )}
              {(b.debt > 0 || b.owedSuppliers > 0 || b.deposits > 0 || b.stock.out > 0 || b.stock.low > 0) && (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                  {b.debt > 0 && <span>ລູກໜີ້ {kip(b.debt)}</span>}
                  {b.owedSuppliers > 0 && <span>ຄ້າງຈ່າຍຜູ້ສະໜອງ {kip(b.owedSuppliers)}</span>}
                  {b.deposits > 0 && <span>ເງິນມັດຈຳທີ່ຖື {kip(b.deposits)}</span>}
                  {b.stock.out > 0 && <span className="text-rose-600">ສະຕັອກໝົດ {b.stock.out}</span>}
                  {b.stock.low > 0 && <span className="text-amber-700">ໃກ້ໝົດ {b.stock.low}</span>}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Card className="p-4">
        <h2 className="mb-2 flex items-center gap-2 font-semibold"><Receipt className="size-4 text-slate-400" /> ບິນລ່າສຸດ</h2>
        {d.recent.length === 0 ? (
          <div className="py-4 text-center text-sm text-slate-400">ຍັງບໍ່ມີບິນ</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {d.recent.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate">{o.branch} · {o.type === 'dine_in' ? `ໂຕະ ${o.table_name ?? ''}` : 'ກັບບ້ານ'}</div>
                  <div className="text-xs text-slate-400">{o.bill_no} · {time(o.paid_at)}{o.methods && ` · ${o.methods.split(',').map((m) => METHOD[m] ?? m).join('/')}`}</div>
                </div>
                <div className="tabular font-semibold">{kip(o.total)}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link to="/branches" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-700">ລາຍງານປຽບທຽບສາຂາ</Link>
        <Link to="/transactions" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-700">ລາຍງານທຸລະກຳ</Link>
      </div>
    </div>
  );
}

function Delta({ label, pct }: { label: string; pct: number | null }) {
  if (pct === null) return <span className="rounded-full bg-white/15 px-2.5 py-1">{label}: —</span>;
  return (
    <span className="flex items-center gap-0.5 rounded-full bg-white/15 px-2.5 py-1">
      {pct >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
      {Math.abs(pct)}% ທຽບ{label}
    </span>
  );
}
const Mini = ({ k, v }: { k: string; v: string }) => (
  <div className="rounded-lg bg-white/10 px-1 py-2"><div className="text-[11px] text-white/70">{k}</div><div className="tabular text-sm font-semibold">{v}</div></div>
);
const Cell = ({ k, v, warn }: { k: string; v: string; warn?: boolean }) => (
  <div className={cx('rounded-lg px-2 py-1.5', warn ? 'bg-amber-50 text-amber-800' : 'bg-slate-50')}><div className="text-slate-400">{k}</div><div className="tabular font-medium">{v}</div></div>
);
