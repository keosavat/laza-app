import { useState } from 'react';
import { Cake, Download, Pencil, Plus, Search } from 'lucide-react';
import { get, post } from '../lib/api';
import { useSession, useSync } from '../lib/store';
import { can, dateTime, kip } from '../lib/format';
import { Badge, Button, Card, Empty, Input, Modal, PageHeader, Select, Spinner, cx, useAction, useLoad } from '../components/ui';
import type { Customer } from '../components/CustomerPicker';
import { CustomerModal } from './Debts';

const DAY = 86_400_000;
const daysSince = (iso?: string | null) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / DAY) : null);
const birthdayThisMonth = (c: Customer) => !!c.birthday && Number(c.birthday.slice(5, 7)) === new Date().getMonth() + 1;
const birthdayLabel = (b: string) => `${b.slice(8, 10)}/${b.slice(5, 7)}`;

/** Simple automatic segments from visit history. */
function segment(c: Customer): { key: string; label: string; cls: string } {
  const v = c.visits ?? 0;
  const ago = daysSince(c.last_visit);
  if (v === 0) return { key: 'none', label: 'ຍັງບໍ່ມີການຊື້', cls: 'bg-slate-100 text-slate-500' };
  if (ago !== null && ago > 60) return { key: 'lapsed', label: `ຫາຍໄປ ${ago} ວັນ`, cls: 'bg-rose-100 text-rose-700' };
  if (v >= 5) return { key: 'regular', label: 'ລູກຄ້າປະຈຳ', cls: 'bg-emerald-100 text-emerald-700' };
  if (v === 1) return { key: 'new', label: 'ລູກຄ້າໃໝ່', cls: 'bg-sky-100 text-sky-700' };
  return { key: 'returning', label: 'ກັບມາຊື້ຊ້ຳ', cls: 'bg-amber-100 text-amber-700' };
}

interface Profile {
  customer: Customer;
  stats: { visits: number; spent: number; last_visit: string | null; first_visit: string | null };
  orders: { id: number; bill_no: string | null; order_no: string; type: string; total: number; paid_at: string; points_used: number; points_earned: number; debt_amount: number; table_name: string | null; queue_no: number | null }[];
  favorites: { name: string; qty: number }[];
  pointEntries: { id: number; type: 'earn' | 'redeem' | 'adjust'; points: number; bill_no: string | null; note: string; user_name: string | null; created_at: string }[];
}

export default function Customers() {
  const role = useSession((s) => s.user!.role);
  const branch = useSession((s) => s.branch);
  const admin = can(role, 'admin');
  const [list, reload, loading] = useLoad(() => get<Customer[]>('/customers'));
  const [q, setQ] = useState('');
  const [seg, setSeg] = useState('');
  const [sort, setSort] = useState('spent');
  const [open, setOpen] = useState<number | null>(null);
  const [edit, setEdit] = useState<Partial<Customer> | null>(null);
  useSync(['orders'], reload);
  if (loading || !list) return <Spinner />;

  const active = list.filter((c) => c.active);
  const recent = active.filter((c) => (daysSince(c.last_visit) ?? 9999) <= 30).length;
  const spent = active.reduce((s, c) => s + (c.spent ?? 0), 0);
  const points = active.reduce((s, c) => s + (c.points ?? 0), 0);
  const birthdays = active.filter(birthdayThisMonth).length;
  const loyaltyOn = (branch?.loyalty_earn_per ?? 0) > 0;

  const needle = q.trim().toLowerCase();
  const shown = active
    .filter((c) => !needle || (c.name + c.phone + (c.tags ?? '')).toLowerCase().includes(needle))
    .filter((c) => !seg || (seg === 'birthday' ? birthdayThisMonth(c) : seg === 'points' ? (c.points ?? 0) > 0 : segment(c).key === seg))
    .sort((a, b) =>
      sort === 'visits' ? (b.visits ?? 0) - (a.visits ?? 0)
      : sort === 'recent' ? (b.last_visit ?? '').localeCompare(a.last_visit ?? '')
      : sort === 'points' ? (b.points ?? 0) - (a.points ?? 0)
      : sort === 'name' ? a.name.localeCompare(b.name)
      : (b.spent ?? 0) - (a.spent ?? 0),
    );

  function exportCsv() {
    const rows = [
      ['ຊື່', 'ເບີໂທ', 'ວັນເກີດ', 'ປ້າຍກຳກັບ', 'ຈຳນວນຄັ້ງ', 'ຍອດໃຊ້ຈ່າຍ', 'ມາຄັ້ງລ່າສຸດ', 'ຄະແນນ', 'ໜີ້ຄ້າງ', 'ກຸ່ມ'],
      ...shown.map((c) => [c.name, c.phone, c.birthday ?? '', c.tags ?? '', c.visits ?? 0, c.spent ?? 0, c.last_visit ?? '', c.points ?? 0, c.balance, segment(c).label]),
    ];
    const csv = '﻿' + rows.map((r) => r.map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'customers.csv';
    a.click();
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <PageHeader
        title="ລູກຄ້າ (CRM)"
        sub={loyaltyOn ? 'ປະຫວັດການຊື້, ລູກຄ້າປະຈຳ ແລະ ຄະແນນສະສົມ' : 'ປະຫວັດການຊື້ ແລະ ລູກຄ້າປະຈຳ — ເປີດຄະແນນສະສົມໄດ້ທີ່ ຕັ້ງຄ່າ'}
        actions={
          <>
            <Button variant="secondary" onClick={exportCsv} disabled={!shown.length}><Download className="size-4" /> Excel (CSV)</Button>
            <Button onClick={() => setEdit({ name: '', phone: '', note: '', credit_limit: 0, active: 1 })}><Plus className="size-4" /> ລູກຄ້າໃໝ່</Button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="ລູກຄ້າທັງໝົດ" value={String(active.length)} />
        <Stat label="ມາໃນ 30 ວັນ" value={String(recent)} />
        <Stat label="ຍອດໃຊ້ຈ່າຍລວມ" value={kip(spent)} />
        <Stat label={loyaltyOn ? 'ຄະແນນຄ້າງລວມ' : 'ວັນເກີດເດືອນນີ້'} value={loyaltyOn ? points.toLocaleString('en-US') : String(birthdays)} sub={loyaltyOn && birthdays ? `ວັນເກີດເດືອນນີ້ ${birthdays} ຄົນ` : undefined} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ຄົ້ນຫາຊື່ / ເບີໂທ / ປ້າຍ..." className="pl-9" />
        </div>
        <Select value={seg} onChange={(e) => setSeg(e.target.value)} className="w-48!">
          <option value="">ທຸກກຸ່ມ</option>
          <option value="regular">ລູກຄ້າປະຈຳ (5+ ຄັ້ງ)</option>
          <option value="returning">ກັບມາຊື້ຊ້ຳ</option>
          <option value="new">ລູກຄ້າໃໝ່</option>
          <option value="lapsed">ຫາຍໄປ (60+ ວັນ)</option>
          <option value="birthday">ວັນເກີດເດືອນນີ້</option>
          <option value="points">ມີຄະແນນ</option>
          <option value="none">ຍັງບໍ່ມີການຊື້</option>
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-44!">
          <option value="spent">ຮຽງຕາມຍອດໃຊ້ຈ່າຍ</option>
          <option value="visits">ຮຽງຕາມຈຳນວນຄັ້ງ</option>
          <option value="recent">ມາລ່າສຸດ</option>
          <option value="points">ຮຽງຕາມຄະແນນ</option>
          <option value="name">ຮຽງຕາມຊື່</option>
        </Select>
      </div>

      <Card className="overflow-x-auto">
        {shown.length === 0 ? (
          <Empty>{active.length ? 'ບໍ່ພົບລູກຄ້າ' : 'ຍັງບໍ່ມີລູກຄ້າ — ເພີ່ມທີ່ນີ້ ຫຼື ເລືອກ "ລູກຄ້າສະມາຊິກ" ຕອນຊຳລະເງິນ'}</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">ລູກຄ້າ</th>
                <th className="px-4 py-2 font-medium">ກຸ່ມ</th>
                <th className="px-4 py-2 text-right font-medium">ມາ (ຄັ້ງ)</th>
                <th className="px-4 py-2 text-right font-medium">ຍອດໃຊ້ຈ່າຍ</th>
                <th className="px-4 py-2 font-medium">ມາລ່າສຸດ</th>
                <th className="px-4 py-2 text-right font-medium">ຄະແນນ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((c) => {
                const sg = segment(c);
                return (
                  <tr key={c.id} onClick={() => setOpen(c.id)} className="cursor-pointer hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <div className="font-medium">
                        {c.name}
                        {birthdayThisMonth(c) && <Cake className="ml-1.5 inline size-3.5 text-pink-500" aria-label="ວັນເກີດເດືອນນີ້" />}
                      </div>
                      <div className="text-xs text-slate-400">{[c.phone, c.tags].filter(Boolean).join(' · ') || '—'}</div>
                    </td>
                    <td className="px-4 py-2.5"><Badge className={sg.cls}>{sg.label}</Badge></td>
                    <td className="tabular px-4 py-2.5 text-right">{c.visits ?? 0}</td>
                    <td className="tabular px-4 py-2.5 text-right font-semibold">{kip(c.spent ?? 0)}</td>
                    <td className="px-4 py-2.5 text-slate-500">{c.last_visit ? dateTime(c.last_visit) : '—'}</td>
                    <td className="tabular px-4 py-2.5 text-right">{c.points ? c.points.toLocaleString('en-US') : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {open !== null && <ProfileModal id={open} admin={admin} onClose={() => setOpen(null)} onChanged={reload} onEdit={(c) => { setOpen(null); setEdit(c); }} />}
      {edit && <CustomerModal c={edit} admin={admin} onClose={() => setEdit(null)} onSaved={reload} />}
    </div>
  );
}

function ProfileModal({ id, admin, onClose, onChanged, onEdit }: { id: number; admin: boolean; onClose: () => void; onChanged: () => void; onEdit: (c: Customer) => void }) {
  const [d, reload] = useLoad(() => get<Profile>(`/customers/${id}`), [id]);
  const [pts, setPts] = useState('');
  const [note, setNote] = useState('');
  const { busy, run } = useAction();
  if (!d) return null;
  const c = d.customer;
  const sg = segment({ ...c, visits: d.stats.visits, last_visit: d.stats.last_visit });
  const adjust = async () => {
    const n = Math.trunc(Number(pts));
    if (!n) return;
    if (await run(() => post(`/customers/${id}/points`, { points: n, note }), 'ປັບຄະແນນແລ້ວ')) {
      setPts('');
      setNote('');
      await reload();
      onChanged();
    }
  };
  return (
    <Modal open onClose={onClose} title={c.name} wide>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <div className="space-y-1 rounded-xl bg-slate-50 p-4 text-sm">
            <div className="flex items-center gap-2">
              <Badge className={sg.cls}>{sg.label}</Badge>
              {c.tags?.split(',').map((t) => t.trim()).filter(Boolean).map((t) => <Badge key={t} className="bg-brand-50 text-brand-700">{t}</Badge>)}
            </div>
            <div className="text-slate-600">{c.phone || 'ບໍ່ມີເບີໂທ'}{c.birthday && <span className="ml-2 inline-flex items-center gap-1"><Cake className="size-3.5 text-pink-500" /> {birthdayLabel(c.birthday)}</span>}</div>
            {c.note && <div className="text-slate-500">{c.note}</div>}
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Mini label="ມາ (ຄັ້ງ)" value={String(d.stats.visits)} />
            <Mini label="ຍອດໃຊ້ຈ່າຍ" value={kip(d.stats.spent)} />
            <Mini label="ສະເລ່ຍ / ບິນ" value={kip(d.stats.visits ? Math.round(d.stats.spent / d.stats.visits) : 0)} />
          </div>
          <div className="text-xs text-slate-500">
            {d.stats.first_visit && `ມາຄັ້ງທຳອິດ ${dateTime(d.stats.first_visit)}`}{d.stats.last_visit && ` · ລ່າສຸດ ${dateTime(d.stats.last_visit)}`}
          </div>
          {c.balance > 0 && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">ໜີ້ຄ້າງ {kip(c.balance)} (ຮັບຊຳລະທີ່ໜ້າ "ລູກໜີ້")</div>}
          {d.favorites.length > 0 && (
            <div>
              <div className="mb-1.5 text-sm font-semibold">ເມນູທີ່ສັ່ງບ່ອຍ</div>
              <div className="flex flex-wrap gap-1.5">
                {d.favorites.map((f) => <span key={f.name} className="rounded-full bg-white px-2.5 py-1 text-xs ring-1 ring-slate-200">{f.name} <b>×{f.qty}</b></span>)}
              </div>
            </div>
          )}
          <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold">ຄະແນນສະສົມ</span>
              <span className="tabular text-2xl font-bold">{(c.points ?? 0).toLocaleString('en-US')}</span>
            </div>
            {admin && (
              <div className="flex gap-2">
                <Input type="number" value={pts} onChange={(e) => setPts(e.target.value)} placeholder="+ເພີ່ມ / −ຫຼຸດ" className="w-32!" />
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ເຫດຜົນ" maxLength={200} />
                <Button size="sm" variant="secondary" onClick={adjust} loading={busy} disabled={!Math.trunc(Number(pts))}>ປັບ</Button>
              </div>
            )}
          </div>
          {admin && <Button variant="ghost" size="sm" onClick={() => onEdit(c)}><Pencil className="size-4" /> ແກ້ໄຂຂໍ້ມູນລູກຄ້າ</Button>}
        </div>
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 text-sm font-semibold">ບິນລ່າສຸດ</div>
            {d.orders.length === 0 ? (
              <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-400">ຍັງບໍ່ມີ</div>
            ) : (
              <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 text-sm">
                {d.orders.map((o) => (
                  <div key={o.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0">
                      <span className="font-medium">{o.bill_no ?? '#' + o.order_no}</span>
                      <span className="block truncate text-xs text-slate-400">
                        {dateTime(o.paid_at)} · {o.type === 'dine_in' ? `ໂຕະ ${o.table_name}` : `ກັບບ້ານ ${o.queue_no ?? ''}`}
                        {o.points_earned > 0 && ` · +${o.points_earned} ຄະແນນ`}{o.points_used > 0 && ` · ໃຊ້ ${o.points_used} ຄະແນນ`}
                      </span>
                    </span>
                    <span className="tabular shrink-0 font-semibold">{kip(o.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="mb-1.5 text-sm font-semibold">ປະຫວັດຄະແນນ</div>
            {d.pointEntries.length === 0 ? (
              <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-400">ຍັງບໍ່ມີ</div>
            ) : (
              <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 text-sm">
                {d.pointEntries.map((e) => (
                  <div key={e.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0">
                      <span className="font-medium">{e.type === 'earn' ? `ໄດ້ຮັບ · ບິນ ${e.bill_no ?? ''}` : e.type === 'redeem' ? `ແລກ · ບິນ ${e.bill_no ?? ''}` : 'ປັບໂດຍຜູ້ຈັດການ'}</span>
                      <span className="block truncate text-xs text-slate-400">{dateTime(e.created_at)}{e.user_name && ` · ${e.user_name}`}{e.note && ` · ${e.note}`}</span>
                    </span>
                    <span className={cx('tabular shrink-0 font-semibold', e.points > 0 ? 'text-emerald-700' : 'text-rose-600')}>{e.points > 0 ? '+' : ''}{e.points.toLocaleString('en-US')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="tabular mt-1 text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}
function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="tabular text-sm font-bold">{value}</div>
    </div>
  );
}

