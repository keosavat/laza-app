import { useState } from 'react';
import { Plus, Pencil, Search } from 'lucide-react';
import { del, get, post, put } from '../lib/api';
import { useSession, useSync } from '../lib/store';
import { can, dateTime, kip, METHOD_LABEL } from '../lib/format';
import { Badge, Button, Card, Empty, Field, Input, Modal, MoneyInput, PageHeader, Select, Spinner, cx, toast, useAction, useLoad , ask } from '../components/ui';
import type { Customer } from '../components/CustomerPicker';

interface Entry {
  id: number; type: 'charge' | 'payment'; amount: number; method: string; note: string; created_at: string;
  bill_no: string | null; order_no: number | null; user_name: string | null;
}

export default function Debts() {
  const role = useSession((s) => s.user!.role);
  const admin = can(role, 'admin');
  const [list, reload, loading] = useLoad(() => get<Customer[]>('/customers'));
  const [q, setQ] = useState('');
  const [onlyDebt, setOnlyDebt] = useState(true);
  const [open, setOpen] = useState<Customer | null>(null);
  const [edit, setEdit] = useState<Partial<Customer> | null>(null);
  useSync(['orders', 'shift'], reload);
  if (loading || !list) return <Spinner />;

  const owing = list.filter((c) => c.balance > 0);
  const total = owing.reduce((s, c) => s + c.balance, 0);
  const shown = list.filter((c) => (c.active || c.balance > 0) && (!onlyDebt || c.balance > 0) && (!q.trim() || (c.name + c.phone).toLowerCase().includes(q.trim().toLowerCase())));

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <PageHeader
        title="ລູກໜີ້ / ລູກຄ້າ"
        sub="ລູກຄ້າທີ່ຕິດໜີ້ (ເລືອກ ຕິດໜີ້ ຕອນຊຳລະເງິນ) ແລະ ການຮັບຊຳລະໜີ້"
        actions={<Button onClick={() => setEdit({ name: '', phone: '', note: '', credit_limit: 0, active: 1 })}><Plus className="size-4" /> ລູກຄ້າໃໝ່</Button>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <div className={cx('rounded-xl border p-4 shadow-sm', total > 0 ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-white')}>
          <div className="text-sm text-slate-500">ໜີ້ຄ້າງລວມ</div>
          <div className="tabular mt-1 text-2xl font-bold">{kip(total)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">ຈຳນວນລູກໜີ້</div>
          <div className="tabular mt-1 text-2xl font-bold">{owing.length}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">ລູກຄ້າທັງໝົດ</div>
          <div className="tabular mt-1 text-2xl font-bold">{list.filter((c) => c.active).length}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ຄົ້ນຫາຊື່ / ເບີໂທ..." className="pl-9" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-brand-600" checked={onlyDebt} onChange={(e) => setOnlyDebt(e.target.checked)} /> ສະເພາະທີ່ມີໜີ້ຄ້າງ
        </label>
      </div>

      <Card className="overflow-x-auto">
        {shown.length === 0 ? (
          <Empty>{list.length ? 'ບໍ່ພົບລາຍການ' : 'ຍັງບໍ່ມີລູກຄ້າ — ເພີ່ມໄດ້ທີ່ນີ້ ຫຼື ຕອນຊຳລະເງິນ (ຕິດໜີ້)'}</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">ລູກຄ້າ</th>
                <th className="px-4 py-2 font-medium">ເບີໂທ</th>
                <th className="px-4 py-2 text-right font-medium">ໜີ້ຄ້າງ</th>
                <th className="px-4 py-2 text-right font-medium">ວົງເງິນ</th>
                <th className="px-4 py-2 font-medium">ລ່າສຸດ</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((c) => (
                <tr key={c.id} onClick={() => setOpen(c)} className={cx('cursor-pointer hover:bg-slate-50', !c.active && 'opacity-50')}>
                  <td className="px-4 py-2.5 font-medium">{c.name} {!c.active && <Badge className="bg-slate-200 text-slate-600">ປິດໃຊ້</Badge>}</td>
                  <td className="px-4 py-2.5 text-slate-500">{c.phone || '—'}</td>
                  <td className={cx('tabular px-4 py-2.5 text-right font-semibold', c.balance > 0 ? 'text-rose-600' : 'text-slate-400')}>{kip(c.balance)}</td>
                  <td className="tabular px-4 py-2.5 text-right text-slate-500">{c.credit_limit > 0 ? kip(c.credit_limit) : 'ບໍ່ຈຳກັດ'}</td>
                  <td className="px-4 py-2.5 text-slate-500">{c.last_entry ? dateTime(c.last_entry) : '—'}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setOpen(c); }}>{c.balance > 0 ? 'ຮັບຊຳລະ' : 'ເບິ່ງ'}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {open && <Ledger id={open.id} admin={admin} onClose={() => setOpen(null)} onChanged={reload} onEdit={(c) => { setOpen(null); setEdit(c); }} />}
      {edit && <CustomerModal c={edit} admin={admin} onClose={() => setEdit(null)} onSaved={reload} />}
    </div>
  );
}

function Ledger({ id, admin, onClose, onChanged, onEdit }: { id: number; admin: boolean; onClose: () => void; onChanged: () => void; onEdit: (c: Customer) => void }) {
  const [d, reload] = useLoad(() => get<{ customer: Customer; entries: Entry[] }>(`/customers/${id}`), [id]);
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  const { busy, run } = useAction();
  if (!d) return null;
  const c = d.customer;
  const pay = async () => {
    const r = await run(() => post<{ balance: number }>(`/customers/${id}/payments`, { amount, method, note }), 'ຮັບຊຳລະແລ້ວ');
    if (r) {
      setAmount(0);
      setNote('');
      await reload();
      onChanged();
    }
  };
  return (
    <Modal open onClose={onClose} title={c.name} wide>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <div className={cx('rounded-xl p-4', c.balance > 0 ? 'bg-rose-50' : 'bg-emerald-50')}>
            <div className="text-sm text-slate-500">ໜີ້ຄ້າງ</div>
            <div className="tabular text-3xl font-bold">{kip(c.balance)}</div>
            <div className="mt-1 text-xs text-slate-500">
              {c.phone || 'ບໍ່ມີເບີໂທ'}{c.credit_limit > 0 && ` · ວົງເງິນ ${kip(c.credit_limit)}`}
            </div>
            {c.note && <div className="mt-1 text-xs text-slate-500">{c.note}</div>}
          </div>
          {c.balance > 0 && (
            <div className="space-y-3 rounded-xl border border-slate-200 p-3">
              <div className="text-sm font-semibold">ຮັບຊຳລະໜີ້</div>
              <MoneyInput value={amount} onChange={setAmount} placeholder="ຈຳນວນເງິນ (₭)" />
              <div className="flex flex-wrap gap-1.5">
                {[c.balance, Math.ceil(c.balance / 2 / 1000) * 1000].filter((v, i, a) => v > 0 && a.indexOf(v) === i).map((v, i) => (
                  <button key={v} onClick={() => setAmount(Math.min(v, c.balance))} className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-800">{i === 0 ? 'ທັງໝົດ' : 'ເຄິ່ງໜຶ່ງ'} · {kip(Math.min(v, c.balance))}</button>
                ))}
              </div>
              <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                {(['cash', 'transfer', 'qr', 'card'] as const).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
              </Select>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ໝາຍເຫດ (ບໍ່ບັງຄັບ)" maxLength={200} />
              <Button className="w-full" onClick={pay} loading={busy} disabled={amount <= 0 || amount > c.balance}>ຮັບຊຳລະ {amount > 0 && kip(amount)}</Button>
              {amount > c.balance && <div className="text-xs text-rose-600">ເກີນໜີ້ຄ້າງ</div>}
            </div>
          )}
          {admin && <Button variant="ghost" size="sm" onClick={() => onEdit(c)}><Pencil className="size-4" /> ແກ້ໄຂຂໍ້ມູນລູກຄ້າ / ວົງເງິນ</Button>}
        </div>
        <div>
          <div className="mb-2 text-sm font-semibold">ປະຫວັດ</div>
          {d.entries.length === 0 ? (
            <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-400">ຍັງບໍ່ມີ</div>
          ) : (
            <div className="max-h-[55vh] divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 text-sm">
              {d.entries.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0">
                    <span className={cx('font-medium', e.type === 'charge' ? 'text-rose-600' : 'text-emerald-700')}>
                      {e.type === 'charge' ? `ຕິດໜີ້ · ບິນ ${e.bill_no ?? '#' + e.order_no}` : `ຊຳລະ · ${METHOD_LABEL[e.method as keyof typeof METHOD_LABEL] ?? e.method}`}
                    </span>
                    <span className="block truncate text-xs text-slate-400">{dateTime(e.created_at)}{e.user_name && ` · ${e.user_name}`}{e.note && ` · ${e.note}`}</span>
                  </span>
                  <span className={cx('tabular shrink-0 font-semibold', e.type === 'charge' ? 'text-rose-600' : 'text-emerald-700')}>{e.type === 'charge' ? '+' : '−'}{kip(e.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function CustomerModal({ c, admin, onClose, onSaved }: { c: Partial<Customer>; admin: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: c.name ?? '', phone: c.phone ?? '', note: c.note ?? '', creditLimit: c.credit_limit ?? 0, active: c.active !== 0, birthday: c.birthday ?? '', tags: c.tags ?? '' });
  const { busy, run } = useAction();
  const save = async () => {
    const body = { name: f.name, phone: f.phone, note: f.note, creditLimit: f.creditLimit, active: f.active, birthday: f.birthday, tags: f.tags };
    if (await run(() => (c.id ? put(`/customers/${c.id}`, body) : post('/customers', body)), 'ບັນທຶກແລ້ວ')) {
      onSaved();
      onClose();
    }
  };
  const remove = async () => {
    if (!(await ask(`ລຶບ ${c.name}?`))) return;
    const r = await run(() => del<{ deactivated: boolean }>(`/customers/${c.id}`));
    if (r) {
      toast.ok(r.deactivated ? 'ມີປະຫວັດແລ້ວ ຈຶ່ງປິດໃຊ້ແທນການລຶບ' : 'ລຶບແລ້ວ');
      onSaved();
      onClose();
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={c.id ? 'ແກ້ໄຂລູກຄ້າ' : 'ລູກຄ້າໃໝ່'}
      footer={
        <>
          {c.id && admin && <Button variant="ghost" className="mr-auto text-rose-600" onClick={remove}>ລຶບ</Button>}
          <Button onClick={save} loading={busy} disabled={!f.name.trim()}>ບັນທຶກ</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="ຊື່"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus maxLength={80} /></Field>
        <Field label="ເບີໂທ"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={30} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ວັນເກີດ"><Input type="date" value={f.birthday} onChange={(e) => setF({ ...f, birthday: e.target.value })} /></Field>
          <Field label="ປ້າຍກຳກັບ" hint="ແຍກດ້ວຍ , ເຊັ່ນ VIP, ມັງສະວິຣັດ"><Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} maxLength={100} /></Field>
        </div>
        {admin && <Field label="ວົງເງິນຕິດໜີ້ສູງສຸດ (₭, 0 = ບໍ່ຈຳກັດ)"><MoneyInput value={f.creditLimit} onChange={(v) => setF({ ...f, creditLimit: v })} /></Field>}
        <Field label="ໝາຍເຫດ"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={200} /></Field>
        {c.id && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-brand-600" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> ເປີດໃຊ້ງານ
          </label>
        )}
      </div>
    </Modal>
  );
}
