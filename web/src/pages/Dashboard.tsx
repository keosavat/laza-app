import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { get, type PayMethod } from '../lib/api';
import { useSession, useSync } from '../lib/store';
import { kip, METHOD_LABEL, num, since, todayLocal } from '../lib/format';
import { Button, Card, Empty, Input, PageHeader, Spinner, useLoad } from '../components/ui';

interface Daily {
  date: string;
  totals: { bills: number; sales: number; subtotal: number; discount: number; service: number; vat: number; avg: number; change: number; cost: number; grossProfit: number };
  byMethod: { method: PayMethod; bills: number; amount_lak: number }[];
  debt: { charged: number; collected: number; outstanding: number };
  topItems: { name: string; qty: number; amount: number }[];
  byCategory: { name: string; qty: number; amount: number }[];
  byStaff: { name: string; bills: number; amount: number }[];
  byHour: { hour: number; bills: number; amount: number }[];
  cancelled: { lines: number; amount: number };
  open: { count: number; total: number; orders: { id: number; type: string; total: number; created_at: string; queue_no: number | null; table_name: string | null }[] };
  trend: { date: string; bills: number; sales: number }[];
}

export default function Dashboard() {
  const nav = useNavigate();
  const shift = useSession((s) => s.shift);
  const [date, setDate] = useState(todayLocal());
  const [d, reload, loading] = useLoad(() => get<Daily>(`/reports/daily?date=${date}`), [date]);
  useSync(['orders'], reload);

  if (loading || !d) return <Spinner />;
  const t = d.totals;
  const maxHour = Math.max(1, ...d.byHour.map((h) => h.amount));
  const maxTrend = Math.max(1, ...d.trend.map((x) => x.sales));
  const hours = d.byHour.filter((h) => h.hour >= 6 || h.amount > 0);

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <PageHeader
        title="ລາຍງານປະຈຳວັນ"
        sub={`ຂໍ້ມູນຂອງວັນທີ ${d.date}`}
        actions={
          <>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer className="size-4" /> ພິມ
            </Button>
          </>
        }
      />
      {!shift && (
        <Card className="flex items-center justify-between border-amber-300 bg-amber-50 p-4">
          <span className="text-sm text-amber-800">ຍັງບໍ່ໄດ້ເປີດກະ — ຕ້ອງເປີດກະກ່ອນຈຶ່ງຂາຍໄດ້</span>
          <Button variant="warning" size="sm" onClick={() => nav('/shift')}>ເປີດກະ</Button>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="ຍອດຂາຍ (ເກັບເງິນແລ້ວ)" value={kip(t.sales)} sub={`ກຳໄລຂັ້ນຕົ້ນ ${kip(t.grossProfit)}`} accent />
        <Kpi label="ຈຳນວນບິນ" value={num(t.bills)} sub={`ສະເລ່ຍ ${kip(t.avg)} / ບິນ`} />
        <Kpi label="ໂຕະ/ອໍເດີທີ່ຍັງບໍ່ຈ່າຍ" value={num(d.open.count)} sub={`ຄ້າງ ${kip(d.open.total)}`} />
        <Kpi label="ຍົກເລີກ" value={kip(d.cancelled.amount)} sub={`${d.cancelled.lines} ລາຍການ`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <h3 className="mb-3 font-semibold">ການເກັບເງິນ</h3>
          {d.byMethod.length === 0 ? (
            <Empty>ຍັງບໍ່ມີ</Empty>
          ) : (
            <div className="space-y-2 text-sm">
              {d.byMethod.map((m) => (
                <div key={m.method} className="flex justify-between">
                  <span>{METHOD_LABEL[m.method]} <span className="text-slate-400">({m.bills} ບິນ)</span></span>
                  <span className="tabular font-medium">{kip(m.amount_lak)}</span>
                </div>
              ))}
              {d.debt.charged > 0 && (
                <div className="flex justify-between text-rose-600"><span>ຕິດໜີ້ (ຍັງບໍ່ໄດ້ເກັບ)</span><span className="tabular">{kip(d.debt.charged)}</span></div>
              )}
              <div className="flex justify-between border-t border-slate-100 pt-2 text-slate-500">
                <span>ທອນເງິນ</span>
                <span className="tabular">−{kip(t.change)}</span>
              </div>
            </div>
          )}
          {(d.debt.outstanding > 0 || d.debt.collected > 0) && (
            <div className="mt-4 space-y-1 rounded-lg bg-rose-50 p-3 text-sm">
              <div className="flex justify-between"><span>ຮັບຊຳລະໜີ້ເກົ່າວັນນີ້</span><span className="tabular">{kip(d.debt.collected)}</span></div>
              <div className="flex justify-between font-semibold text-rose-700"><span>ໜີ້ຄ້າງລວມ</span><span className="tabular">{kip(d.debt.outstanding)}</span></div>
            </div>
          )}
          <h3 className="mb-2 mt-5 font-semibold">ພາສີ ແລະ ສ່ວນຫຼຸດ</h3>
          <div className="space-y-1 text-sm">
            <Pair l="ຍອດກ່ອນສ່ວນຫຼຸດ" v={kip(t.subtotal)} />
            <Pair l="ສ່ວນຫຼຸດ" v={kip(t.discount)} />
            <Pair l="ຄ່າບໍລິການ" v={kip(t.service)} />
            <Pair l="VAT" v={kip(t.vat)} />
          </div>
        </Card>

        <Card className="p-4 lg:col-span-2">
          <h3 className="mb-3 font-semibold">ຍອດຂາຍຕາມຊົ່ວໂມງ</h3>
          <div className="flex h-44 items-end gap-1">
            {hours.map((h) => (
              <div key={h.hour} className="flex flex-1 flex-col items-center gap-1" title={`${h.hour}:00 · ${kip(h.amount)} · ${h.bills} ບິນ`}>
                <div className="w-full rounded-t bg-brand-500" style={{ height: `${(h.amount / maxHour) * 150}px`, minHeight: h.amount ? 3 : 1, opacity: h.amount ? 1 : 0.15 }} />
                <span className="text-[10px] text-slate-400">{h.hour}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ListCard title="ເມນູຂາຍດີ" rows={d.topItems.map((x) => ({ l: x.name, s: `${x.qty} ຈານ`, v: x.amount }))} />
        <ListCard title="ຕາມໝວດ" rows={d.byCategory.map((x) => ({ l: x.name, s: `${x.qty}`, v: x.amount }))} />
        <ListCard title="ຕາມຜູ້ຮັບເງິນ" rows={d.byStaff.map((x) => ({ l: x.name ?? '—', s: `${x.bills} ບິນ`, v: x.amount }))} />
        <LowStock />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-3 font-semibold">ແນວໂນ້ມ 7 ວັນ</h3>
          <div className="space-y-2">
            {d.trend.map((x) => (
              <div key={x.date} className="flex items-center gap-3 text-sm">
                <span className="w-20 shrink-0 text-slate-500">{x.date.slice(5)}</span>
                <div className="h-5 flex-1 rounded bg-slate-100">
                  <div className="h-5 rounded bg-brand-500" style={{ width: `${(x.sales / maxTrend) * 100}%` }} />
                </div>
                <span className="tabular w-28 text-right">{kip(x.sales)}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-4">
          <h3 className="mb-3 font-semibold">ອໍເດີທີ່ຍັງບໍ່ໄດ້ຊຳລະ ({d.open.count})</h3>
          {d.open.orders.length === 0 ? (
            <Empty>ບໍ່ມີ</Empty>
          ) : (
            <div className="divide-y divide-slate-100 text-sm">
              {d.open.orders.map((o) => (
                <button key={o.id} onClick={() => nav(`/order/${o.id}`)} className="flex w-full justify-between py-2 text-left hover:bg-slate-50">
                  <span>{o.type === 'dine_in' ? `ໂຕະ ${o.table_name}` : `ຄິວ ${o.queue_no}`} <span className="text-slate-400">· {since(o.created_at)}</span></span>
                  <span className="tabular font-medium">{kip(o.total)}</span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div className={accent ? 'rounded-xl bg-brand-600 p-4 text-white shadow-sm' : 'rounded-xl border border-slate-200 bg-white p-4 shadow-sm'}>
      <div className={accent ? 'text-sm text-brand-100' : 'text-sm text-slate-500'}>{label}</div>
      <div className="tabular mt-1 text-2xl font-bold">{value}</div>
      <div className={accent ? 'text-xs text-brand-100' : 'text-xs text-slate-400'}>{sub}</div>
    </div>
  );
}
function Pair({ l, v }: { l: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-600">{l}</span>
      <span className="tabular">{v}</span>
    </div>
  );
}
function ListCard({ title, rows }: { title: string; rows: { l: string; s: string; v: number }[] }) {
  return (
    <Card className="p-4">
      <h3 className="mb-3 font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <Empty>ຍັງບໍ່ມີຂໍ້ມູນ</Empty>
      ) : (
        <div className="space-y-2 text-sm">
          {rows.slice(0, 8).map((r, i) => (
            <div key={r.l + i} className="flex justify-between gap-2">
              <span className="truncate">
                {r.l} <span className="text-slate-400">· {r.s}</span>
              </span>
              <span className="tabular shrink-0">{kip(r.v)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Ingredients that are running low (links to the inventory page for admins). */
function LowStock() {
  const nav = useNavigate();
  const role = useSession((s) => s.user?.role);
  const [s] = useLoad(() => get<{ lowCount: number; low: { id: number; name: string; unit: string; stock: number }[] }>('/inventory/summary'));
  useSync(['menu', 'orders'], () => {});
  if (!s || s.lowCount === 0) return null;
  return (
    <Card className="border-amber-300 bg-amber-50 p-4 lg:col-span-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold text-amber-900">ວັດຖຸດິບໃກ້ໝົດ ({s.lowCount})</h3>
        {(role === 'owner' || role === 'manager') && <button onClick={() => nav('/inventory')} className="text-sm font-medium text-amber-800 underline">ຈັດການສະຕັອກ</button>}
      </div>
      <div className="flex flex-wrap gap-2">
        {s.low.map((i) => (
          <span key={i.id} className="rounded-full bg-white px-3 py-1 text-sm">
            {i.name}: <b className={i.stock <= 0 ? 'text-rose-600' : 'text-amber-700'}>{Math.round(i.stock * 100) / 100} {i.unit}</b>
          </span>
        ))}
      </div>
    </Card>
  );
}
