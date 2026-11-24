import { useState } from 'react';
import { ArrowRightLeft, Download, Pencil, Plus, Store } from 'lucide-react';
import { get, post, put } from '../lib/api';
import { useSession } from '../lib/store';
import { kip } from '../lib/format';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, cx, toast, useAction, useLoad } from '../components/ui';

interface BranchRow { id: number; name: string; address: string; phone: string; staff: number; tables: number; menu_items: number; shift_open: number; current: boolean }
interface Stat {
  id: number; name: string; bills: number; sales: number; avgBill: number; discount: number; service: number; vat: number; debt: number; guests: number; cost: number;
  grossProfit: number; margin: number; cancelled: number; byMethod: Record<string, number>; top: { name: string; qty: number; amount: number }[]; openOrders: number; shiftOpen: boolean; share: number;
}
interface Report {
  from: string; to: string; days: number; branches: Stat[];
  totals: { bills: number; sales: number; avgBill: number; discount: number; debt: number; cost: number; grossProfit: number; cancelled: number; guests: number; byMethod: Record<string, number> };
  daily: { date: string; byBranch: Record<string, number> }[];
}

const COLORS = ['#0f766e', '#d97706', '#4f46e5', '#be185d', '#0284c7', '#65a30d'];
const METHODS: [string, string][] = [['cash', 'ເງິນສົດ'], ['transfer', 'ໂອນ'], ['qr', 'QR'], ['card', 'ບັດ']];
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => isoDay(new Date(Date.parse(d) + n * 86_400_000));

export default function Branches() {
  const [tab, setTab] = useState<'report' | 'manage'>('report');
  return (
    <div className="space-y-4 p-4 lg:p-6">
      <PageHeader title="ຫຼາຍສາຂາ" sub="ປຽບທຽບຍອດຂາຍທຸກສາຂາ ແລະ ຈັດການສາຂາ (ສະເພາະເຈົ້າຂອງຮ້ານ)" />
      <div className="flex w-fit gap-1 rounded-lg bg-white p-1 shadow-sm">
        {([['report', 'ລາຍງານປຽບທຽບ'], ['manage', 'ຈັດການສາຂາ']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cx('rounded-md px-4 py-1.5 text-sm', tab === k ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')}>{l}</button>
        ))}
      </div>
      {tab === 'report' ? <Compare /> : <Manage />}
    </div>
  );
}

// ---------------- comparison report ----------------

function Compare() {
  const branch = useSession((s) => s.branch);
  const today = isoDay(new Date(Date.now() + (branch?.utc_offset_min ?? 420) * 60_000));
  const [range, setRange] = useState({ from: addDays(today, -6), to: today });
  const [data, , loading] = useLoad(() => get<Report>(`/reports/branches?from=${range.from}&to=${range.to}`), [range.from, range.to]);

  const preset = (days: number) => setRange({ from: addDays(today, -(days - 1)), to: today });
  const monthStart = `${today.slice(0, 8)}01`;

  const exportCsv = () => {
    if (!data) return;
    const head = ['ສາຂາ', 'ບິນ', 'ຍອດຂາຍ', 'ສ່ວນແບ່ງ %', 'ສະເລ່ຍ/ບິນ', 'ສ່ວນຫຼຸດ', 'ຕິດໜີ້', 'ຕົ້ນທຶນ', 'ກຳໄລເບື້ອງຕົ້ນ', 'ກຳໄລ %', 'ຍົກເລີກ'];
    const rows = data.branches.map((b) => [b.name, b.bills, b.sales, b.share, b.avgBill, b.discount, b.debt, b.cost, b.grossProfit, b.margin, b.cancelled]);
    rows.push(['ລວມ', data.totals.bills, data.totals.sales, 100, data.totals.avgBill, data.totals.discount, data.totals.debt, data.totals.cost, data.totals.grossProfit, '', data.totals.cancelled]);
    const csv = '﻿' + [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `branches-${data.from}_${data.to}.csv`;
    a.click();
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} className="w-40!" />
        <span className="text-slate-400">ຫາ</span>
        <Input type="date" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} className="w-40!" />
        <div className="flex gap-1">
          <Button variant="secondary" size="sm" onClick={() => setRange({ from: today, to: today })}>ມື້ນີ້</Button>
          <Button variant="secondary" size="sm" onClick={() => preset(7)}>7 ວັນ</Button>
          <Button variant="secondary" size="sm" onClick={() => preset(30)}>30 ວັນ</Button>
          <Button variant="secondary" size="sm" onClick={() => setRange({ from: monthStart, to: today })}>ເດືອນນີ້</Button>
        </div>
        <Button className="ml-auto" variant="secondary" size="sm" onClick={exportCsv} disabled={!data}><Download className="size-4" /> CSV</Button>
      </div>

      {loading || !data ? (
        <Spinner />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="ຍອດຂາຍລວມ" value={kip(data.totals.sales)} strong />
            <Stat label="ຈຳນວນບິນ" value={data.totals.bills.toLocaleString('en-US')} />
            <Stat label="ສະເລ່ຍ/ບິນ" value={kip(data.totals.avgBill)} />
            <Stat label="ກຳໄລເບື້ອງຕົ້ນ" value={kip(data.totals.grossProfit)} />
          </div>

          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
              <h2 className="font-semibold">ຍອດຂາຍລາຍວັນ</h2>
              {data.branches.map((b, i) => <span key={b.id} className="flex items-center gap-1.5 text-xs text-slate-600"><i className="size-2.5 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />{b.name}</span>)}
            </div>
            <DailyBars report={data} />
          </Card>

          {data.totals.sales === 0 ? (
            <Card><Empty>ບໍ່ມີການຂາຍໃນໄລຍະນີ້</Empty></Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.branches.map((b, i) => (
                <Card key={b.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <i className="size-3 shrink-0 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="truncate font-semibold">{b.name}</span>
                    </div>
                    <div className="flex gap-1">
                      {b.shiftOpen ? <Badge className="bg-emerald-100 text-emerald-800">ເປີດກະ</Badge> : <Badge className="bg-slate-100 text-slate-500">ປິດກະ</Badge>}
                    </div>
                  </div>
                  <div className="tabular mt-2 text-2xl font-bold text-brand-700">{kip(b.sales)}</div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full" style={{ width: `${b.share}%`, background: COLORS[i % COLORS.length] }} /></div>
                  <div className="mt-1 text-xs text-slate-500">{b.share}% ຂອງຍອດລວມ</div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    <Row k="ບິນ" v={b.bills.toLocaleString('en-US')} />
                    <Row k="ສະເລ່ຍ/ບິນ" v={kip(b.avgBill)} />
                    <Row k="ສ່ວນຫຼຸດ" v={kip(b.discount)} />
                    <Row k="ຕິດໜີ້" v={kip(b.debt)} />
                    <Row k="ກຳໄລ" v={`${kip(b.grossProfit)} (${b.margin}%)`} />
                    <Row k="ຍົກເລີກ" v={kip(b.cancelled)} />
                  </dl>
                  <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2 text-xs text-slate-500">
                    {METHODS.filter(([m]) => b.byMethod[m]).map(([m, l]) => <span key={m}>{l} {kip(b.byMethod[m])}</span>)}
                  </div>
                  {b.top.length > 0 && (
                    <div className="mt-2 text-xs text-slate-500">
                      <div className="font-medium text-slate-600">ເມນູຂາຍດີ</div>
                      {b.top.map((t) => <div key={t.name} className="flex justify-between gap-2"><span className="truncate">{t.name} ×{t.qty}</span><span className="tabular">{kip(t.amount)}</span></div>)}
                    </div>
                  )}
                  {b.openOrders > 0 && <div className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800">ອໍເດີທີ່ຍັງເປີດຢູ່ {b.openOrders}</div>}
                </Card>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-500">ກຳໄລເບື້ອງຕົ້ນ = ຍອດກ່ອນຄ່າບໍລິການ/VAT − ສ່ວນຫຼຸດ − ຕົ້ນທຶນເມນູ. ແຕ່ລະສາຂານັບວັນຕາມເວລາຂອງສາຂານັ້ນ. ຕົວເລກຕາມເມນູ/ຕົ້ນທຶນທີ່ຕັ້ງໄວ້ໃນແຕ່ລະສາຂາ.</p>
        </>
      )}
    </>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cx('rounded-xl border p-4 shadow-sm', strong ? 'border-brand-200 bg-brand-50' : 'border-slate-200 bg-white')}>
      <div className="text-sm text-slate-500">{label}</div>
      <div className={cx('tabular mt-1 text-xl font-bold', strong && 'text-brand-700')}>{value}</div>
    </div>
  );
}
const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between gap-2 border-b border-slate-50 py-0.5"><dt className="text-slate-500">{k}</dt><dd className="tabular text-right font-medium">{v}</dd></div>
);

/** Stacked daily bars, one colour per branch. */
function DailyBars({ report }: { report: Report }) {
  const max = Math.max(1, ...report.daily.map((d) => Object.values(d.byBranch).reduce((s, v) => s + v, 0)));
  const dense = report.daily.length > 31;
  return (
    <div className="flex h-40 items-end gap-px overflow-x-auto sm:gap-1">
      {report.daily.map((d) => {
        const total = Object.values(d.byBranch).reduce((s, v) => s + v, 0);
        return (
          <div key={d.date} className="group relative flex h-full min-w-1.5 flex-1 flex-col justify-end" title={`${d.date}: ${kip(total)}`}>
            <div className="flex flex-col-reverse overflow-hidden rounded-t" style={{ height: `${(total / max) * 100}%` }}>
              {report.branches.map((b, i) => (d.byBranch[b.id] ? <div key={b.id} style={{ height: `${(d.byBranch[b.id] / total) * 100}%`, background: COLORS[i % COLORS.length] }} /> : null))}
            </div>
            {!dense && <div className="mt-1 text-center text-[10px] text-slate-400">{d.date.slice(8)}</div>}
          </div>
        );
      })}
    </div>
  );
}

// ---------------- manage branches ----------------

function Manage() {
  const current = useSession((s) => s.branch?.id);
  const switchBranch = useSession((s) => s.switchBranch);
  const [list, reload, loading] = useLoad(() => get<BranchRow[]>('/branches'));
  const [edit, setEdit] = useState<Partial<BranchRow> | null>(null);
  const { busy, run } = useAction();
  if (loading || !list) return <Spinner />;
  return (
    <>
      <div className="flex items-center">
        <p className="text-sm text-slate-500">ກົດ "ເຂົ້າໄປຈັດການ" ເພື່ອປ່ຽນໄປເຮັດວຽກໃນສາຂານັ້ນ (ຕັ້ງຄ່າ, ພະນັກງານ, ເມນູ, ເປີດກະ).</p>
        <Button className="ml-auto" onClick={() => setEdit({ name: '', address: '', phone: '' })}><Plus className="size-4" /> ເພີ່ມສາຂາ</Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((b) => (
          <Card key={b.id} className={cx('p-4', b.id === current && 'border-brand-500')}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2"><Store className="size-4 shrink-0 text-slate-400" /><span className="truncate font-semibold">{b.name}</span></div>
              {b.id === current && <Badge className="bg-brand-100 text-brand-800">ສາຂາປັດຈຸບັນ</Badge>}
            </div>
            <div className="mt-1 text-xs text-slate-500">{[b.address, b.phone].filter(Boolean).join(' · ') || 'ຍັງບໍ່ມີທີ່ຢູ່'}</div>
            <div className="mt-3 flex gap-4 text-xs text-slate-600"><span>{b.staff} ພະນັກງານ</span><span>{b.tables} ໂຕະ</span><span>{b.menu_items} ເມນູ</span></div>
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2">
              <Button size="sm" variant="ghost" onClick={() => setEdit(b)}><Pencil className="size-4" /> ແກ້ໄຂ</Button>
              {b.id !== current && <Button size="sm" loading={busy} onClick={() => run(() => switchBranch(b.id))}><ArrowRightLeft className="size-4" /> ເຂົ້າໄປຈັດການ</Button>}
            </div>
          </Card>
        ))}
      </div>
      {edit && <BranchModal b={edit} branches={list} onClose={() => setEdit(null)} onSaved={reload} />}
    </>
  );
}

function BranchModal({ b, branches, onClose, onSaved }: { b: Partial<BranchRow>; branches: BranchRow[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: b.name ?? '', address: b.address ?? '', phone: b.phone ?? '' });
  const [copyFrom, setCopyFrom] = useState(0);
  const { busy, run } = useAction();
  const save = async () => {
    const body = b.id ? f : { ...f, copyFrom: copyFrom || undefined };
    if (await run(() => (b.id ? put(`/branches/${b.id}`, body) : post('/branches', body)), b.id ? 'ບັນທຶກແລ້ວ' : 'ສ້າງສາຂາແລ້ວ')) {
      onSaved();
      onClose();
      if (!b.id) toast.ok('ກົດ "ເຂົ້າໄປຈັດການ" ເພື່ອຕັ້ງຄ່າ ແລະ ເພີ່ມພະນັກງານຂອງສາຂານີ້');
    }
  };
  return (
    <Modal open onClose={onClose} title={b.id ? 'ແກ້ໄຂສາຂາ' : 'ສາຂາໃໝ່'} footer={<Button onClick={save} loading={busy} disabled={!f.name.trim()}>ບັນທຶກ</Button>}>
      <div className="space-y-4">
        <Field label="ຊື່ສາຂາ"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus maxLength={80} placeholder="ເຊັ່ນ ສາຂາ 2, ສາຂາທ່າເດື່ອ" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ທີ່ຢູ່"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} maxLength={200} /></Field>
          <Field label="ເບີໂທ"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={30} inputMode="tel" /></Field>
        </div>
        {!b.id && (
          <Field label="ສຳເນົາຈາກສາຂາ (ບໍ່ບັງຄັບ)" hint="ສຳເນົາການຕັ້ງຄ່າ (VAT, ອັດຕາແລກປ່ຽນ, ໃບຮັບເງິນ), ຜັງໂຕະ ແລະ ເມນູ. ບໍ່ສຳເນົາພະນັກງານ, ສະຕັອກ, ລູກຄ້າ, ເຄື່ອງພິມ.">
            <Select value={copyFrom} onChange={(e) => setCopyFrom(Number(e.target.value))}>
              <option value={0}>— ເລີ່ມຈາກສາຂາເປົ່າ —</option>
              {branches.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </Field>
        )}
      </div>
    </Modal>
  );
}
