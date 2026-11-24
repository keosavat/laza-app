import { Fragment, useState } from 'react';
import { Download } from 'lucide-react';
import { get, type Order } from '../lib/api';
import { useSync } from '../lib/store';
import { dateTime, kip, METHOD_LABEL, todayLocal } from '../lib/format';
import { Badge, Button, Card, Empty, Input, PageHeader, Select, Spinner, cx, toast, useLoad } from '../components/ui';

interface Row {
  id: number; bill_no: string | null; order_no: string; type: 'dine_in' | 'takeaway'; status: 'open' | 'paid' | 'cancelled';
  queue_no: number | null; table_name: string | null; customer_name: string; at: string; staff: string | null;
  subtotal: number; discount: number; promo_name: string; service: number; vat: number; total: number; change_lak: number;
  debt_amount: number; debt_customer: string | null; cancel_reason: string; qty: number; cost: number; profit: number;
  pay: Record<string, number>;
}
interface Report {
  from: string; to: string; truncated: boolean; limit: number; rows: Row[]; staff: { id: number; name: string }[];
  totals: {
    count: number; paidCount: number; cancelledCount: number; openCount: number; qty: number; subtotal: number; discount: number; service: number;
    vat: number; total: number; cost: number; profit: number; debt: number; change: number; avg: number; cancelledTotal: number; byMethod: Record<string, number>;
  };
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const STATUS: Record<Row['status'], [string, string]> = {
  paid: ['ຊຳລະແລ້ວ', 'bg-emerald-100 text-emerald-700'],
  cancelled: ['ຍົກເລີກ', 'bg-rose-100 text-rose-700'],
  open: ['ຍັງເປີດຢູ່', 'bg-amber-100 text-amber-700'],
};
const where = (r: Row) => (r.type === 'dine_in' ? `ໂຕະ ${r.table_name}` : `ກັບບ້ານ · ຄິວ ${r.queue_no}`);

export default function Transactions() {
  const [from, setFrom] = useState(todayLocal());
  const [to, setTo] = useState(todayLocal());
  const [status, setStatus] = useState('paid');
  const [type, setType] = useState('');
  const [method, setMethod] = useState('');
  const [staff, setStaff] = useState('');
  const [has, setHas] = useState('');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Order | null>(null);

  const qs = new URLSearchParams({ from, to, status });
  if (type) qs.set('type', type);
  if (method) qs.set('method', method);
  if (staff) qs.set('staff', staff);
  if (has) qs.set('has', has);
  if (q.trim()) qs.set('q', q.trim());
  const [rep, reload, loading] = useLoad(() => get<Report>(`/reports/transactions?${qs}`), [qs.toString()]);
  useSync(['orders'], reload);

  const range = (a: string, b: string) => { setFrom(a); setTo(b); };
  async function toggle(id: number) {
    if (openId === id) return setOpenId(null);
    setOpenId(id);
    setDetail(null);
    try {
      setDetail(await get<Order>(`/orders/${id}`));
    } catch (e) {
      toast.err(e);
    }
  }

  function exportCsv() {
    if (!rep) return;
    const head = ['ເວລາ', 'ບິນ', 'ອໍເດີ', 'ສະຖານະ', 'ບ່ອນ', 'ພະນັກງານ', 'ຈຳນວນ', 'ລວມ', 'ສ່ວນຫຼຸດ', 'ໂປຣໂມຊັນ', 'ຄ່າບໍລິການ', 'VAT', 'ຍອດສຸດທິ', 'ເງິນສົດ', 'ໂອນ', 'QR', 'ບັດ', 'ຕິດໜີ້', 'ລູກໜີ້', 'ເງິນທອນ', 'ຕົ້ນທຶນ', 'ກຳໄລຂັ້ນຕົ້ນ', 'ເຫດຜົນຍົກເລີກ'];
    const rows = rep.rows.map((r) => [
      r.at, r.bill_no ?? '', r.order_no, STATUS[r.status][0], where(r), r.staff ?? '', r.qty, r.subtotal, r.discount, r.promo_name, r.service, r.vat, r.total,
      r.pay.cash ?? 0, r.pay.transfer ?? 0, r.pay.qr ?? 0, r.pay.card ?? 0, r.debt_amount, r.debt_customer ?? '', r.change_lak, r.cost, r.profit, r.cancel_reason,
    ]);
    const csv = '﻿' + [head, ...rows].map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `transactions-${from}_${to}.csv`;
    a.click();
  }

  const t = rep?.totals;
  return (
    <div className="p-4 lg:p-6">
      <PageHeader
        title="ລາຍງານທຸລະກຳ"
        sub="ທຸກບິນຕາມຊ່ວງວັນທີ ພ້ອມຍອດລວມ, ວິທີຊຳລະ, ຕົ້ນທຶນ ແລະ ກຳໄລ"
        actions={<Button variant="secondary" onClick={exportCsv} disabled={!rep?.rows.length}><Download className="size-4" /> Excel (CSV)</Button>}
      />

      <Card className="mb-4 space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Button size="sm" variant="secondary" onClick={() => range(todayLocal(), todayLocal())}>ມື້ນີ້</Button>
          <Button size="sm" variant="secondary" onClick={() => range(addDays(-1), addDays(-1))}>ມື້ວານ</Button>
          <Button size="sm" variant="secondary" onClick={() => range(addDays(-6), todayLocal())}>7 ວັນ</Button>
          <Button size="sm" variant="secondary" onClick={() => range(todayLocal().slice(0, 8) + '01', todayLocal())}>ເດືອນນີ້</Button>
          <Input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="w-40!" />
          <span className="text-slate-400">–</span>
          <Input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className="w-40!" />
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="paid">ຊຳລະແລ້ວ</option>
            <option value="cancelled">ຍົກເລີກ</option>
            <option value="open">ຍັງເປີດຢູ່</option>
            <option value="all">ທັງໝົດ</option>
          </Select>
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">ທຸກປະເພດ</option>
            <option value="dine_in">ກິນຢູ່ຮ້ານ</option>
            <option value="takeaway">ກັບບ້ານ</option>
          </Select>
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">ທຸກວິທີຊຳລະ</option>
            {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select value={staff} onChange={(e) => setStaff(e.target.value)}>
            <option value="">ທຸກຄົນ</option>
            {rep?.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Select value={has} onChange={(e) => setHas(e.target.value)}>
            <option value="">ທຸກບິນ</option>
            <option value="debt">ສະເພາະຕິດໜີ້</option>
            <option value="discount">ສະເພາະມີສ່ວນຫຼຸດ</option>
          </Select>
          <Input placeholder="ຄົ້ນຫາ ບິນ / ໂຕະ / ລູກຄ້າ" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </Card>

      {loading && !rep ? (
        <Spinner />
      ) : !rep || !t ? null : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={`ຍອດຂາຍ (${t.paidCount} ບິນ)`} value={kip(t.total)} sub={t.paidCount ? `ສະເລ່ຍ ${kip(t.avg)} / ບິນ` : undefined} strong />
            <Stat label="ສ່ວນຫຼຸດ" value={kip(t.discount)} sub={`ຄ່າບໍລິການ ${kip(t.service)} · VAT ${kip(t.vat)}`} />
            <Stat label="ກຳໄລຂັ້ນຕົ້ນ" value={kip(t.profit)} sub={`ຕົ້ນທຶນ ${kip(t.cost)}`} />
            <Stat label="ຕິດໜີ້" value={kip(t.debt)} sub={t.cancelledCount ? `ຍົກເລີກ ${t.cancelledCount} ບິນ (${kip(t.cancelledTotal)})` : undefined} />
          </div>
          {Object.keys(t.byMethod).length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2 text-sm">
              {Object.entries(t.byMethod).map(([m, v]) => (
                <span key={m} className="rounded-full bg-white px-3 py-1 shadow-sm ring-1 ring-slate-200">
                  {METHOD_LABEL[m as keyof typeof METHOD_LABEL] ?? m}: <b className="tabular">{kip(v)}</b>
                </span>
              ))}
            </div>
          )}
          {rep.truncated && <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">ສະແດງສະເພາະ {rep.limit} ບິນຫຼ້າສຸດ — ຍອດລວມຂ້າງເທິງນັບສະເພາະບິນທີ່ສະແດງ. ຫຍໍ້ຊ່ວງວັນທີ ຫຼື ໃຊ້ຕົວກອງ.</div>}

          <Card className="overflow-x-auto">
            {rep.rows.length === 0 ? (
              <Empty>ບໍ່ມີທຸລະກຳຕາມເງື່ອນໄຂນີ້</Empty>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">ເວລາ</th>
                    <th className="px-3 py-2 font-medium">ບິນ</th>
                    <th className="px-3 py-2 font-medium">ບ່ອນ</th>
                    <th className="px-3 py-2 font-medium">ຜູ້ຮັບເງິນ</th>
                    <th className="px-3 py-2 font-medium">ວິທີຊຳລະ</th>
                    <th className="px-3 py-2 text-right font-medium">ສ່ວນຫຼຸດ</th>
                    <th className="px-3 py-2 text-right font-medium">ຍອດ</th>
                    <th className="px-3 py-2 text-right font-medium">ກຳໄລ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rep.rows.map((r) => (
                    <Fragment key={r.id}>
                      <tr onClick={() => toggle(r.id)} className={cx('cursor-pointer hover:bg-slate-50', openId === r.id && 'bg-slate-50')}>
                        <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{dateTime(r.at)}</td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium">{r.bill_no ?? '—'}</div>
                          <div className="text-xs text-slate-400">#{r.order_no}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          {where(r)}
                          {r.status !== 'paid' && <Badge className={cx('ml-2', STATUS[r.status][1])}>{STATUS[r.status][0]}</Badge>}
                        </td>
                        <td className="px-3 py-2.5">{r.staff ?? '—'}</td>
                        <td className="px-3 py-2.5">
                          {Object.keys(r.pay).map((m) => METHOD_LABEL[m as keyof typeof METHOD_LABEL] ?? m).join(', ') || '—'}
                          {r.debt_amount > 0 && <div className="text-xs text-rose-600">ຕິດໜີ້ {kip(r.debt_amount)}{r.debt_customer ? ` · ${r.debt_customer}` : ''}</div>}
                        </td>
                        <td className="tabular px-3 py-2.5 text-right text-slate-600">{r.discount ? kip(r.discount) : '—'}</td>
                        <td className={cx('tabular px-3 py-2.5 text-right font-semibold', r.status === 'cancelled' && 'text-slate-400 line-through')}>{kip(r.total)}</td>
                        <td className="tabular px-3 py-2.5 text-right text-slate-600">{r.status === 'paid' ? kip(r.profit) : '—'}</td>
                      </tr>
                      {openId === r.id && (
                        <tr className="bg-slate-50">
                          <td colSpan={8} className="px-4 pb-4 pt-1">
                            {!detail || detail.id !== r.id ? (
                              <Spinner />
                            ) : (
                              <div className="grid gap-4 text-sm md:grid-cols-2">
                                <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
                                  {detail.items.map((i) => (
                                    <div key={i.id} className={cx('flex justify-between gap-3 px-3 py-1.5', i.status === 'cancelled' && 'text-slate-400 line-through')}>
                                      <span>
                                        {i.qty}× {i.name}
                                        {i.options.length > 0 && <span className="text-xs text-slate-500"> ({i.options.map((o) => o.name).join(', ')})</span>}
                                      </span>
                                      <span className="tabular">{kip(i.unit_price * i.qty)}</span>
                                    </div>
                                  ))}
                                </div>
                                <div className="space-y-1">
                                  <Line l="ລວມ" v={r.subtotal} />
                                  {r.discount > 0 && <Line l={`ສ່ວນຫຼຸດ${r.promo_name ? ` (${r.promo_name})` : ''}`} v={-r.discount} />}
                                  {r.service > 0 && <Line l="ຄ່າບໍລິການ" v={r.service} />}
                                  {r.vat > 0 && <Line l="VAT" v={r.vat} />}
                                  <Line l="ຍອດສຸດທິ" v={r.total} strong />
                                  {detail.payments.map((p) => (
                                    <Line key={p.id} l={`${METHOD_LABEL[p.method]}${p.currency !== 'LAK' ? ` (${p.currency} ${p.amount})` : ''}`} v={p.amount_lak} />
                                  ))}
                                  {r.debt_amount > 0 && <Line l="ຕິດໜີ້" v={r.debt_amount} />}
                                  {r.change_lak > 0 && <Line l="ເງິນທອນ" v={r.change_lak} />}
                                  {r.status === 'paid' && <Line l={`ຕົ້ນທຶນ ${kip(r.cost)} · ກຳໄລ`} v={r.profit} />}
                                  {r.cancel_reason && <div className="text-rose-600">ເຫດຜົນຍົກເລີກ: {r.cancel_reason}</div>}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={cx('tabular mt-1 text-xl font-bold', strong && 'text-brand-700')}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </Card>
  );
}

function Line({ l, v, strong }: { l: string; v: number; strong?: boolean }) {
  return (
    <div className={cx('flex justify-between', strong && 'font-bold')}>
      <span>{l}</span>
      <span className="tabular">{kip(v)}</span>
    </div>
  );
}
