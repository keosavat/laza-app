import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { del, get, post, put } from '../lib/api';
import { kip } from '../lib/format';
import { Badge, Button, Card, Empty, Field, Input, Modal, MoneyInput, PageHeader, Select, Spinner, cx, toast, useAction, useLoad } from '../components/ui';

interface Promo {
  id: number; name: string; code: string; type: 'percent' | 'amount'; value: number; min_subtotal: number; max_discount: number;
  starts_on: string; ends_on: string; days: string; time_from: string; time_to: string; order_type: 'all' | 'dine_in' | 'takeaway';
  max_uses: number; used_count: number; active: number; total_discount: number;
}
const DAYS = ['ອາທິດ', 'ຈັນ', 'ອັງຄານ', 'ພຸດ', 'ພະຫັດ', 'ສຸກ', 'ເສົາ'];
const ORDER_TYPE = { all: 'ທຸກປະເພດ', dine_in: 'ນັ່ງກິນທີ່ຮ້ານ', takeaway: 'ກັບບ້ານ / ໜ້າຮ້ານ' };
const today = () => new Date().toISOString().slice(0, 10);

function state(p: Promo): [string, string] {
  if (!p.active) return ['ປິດໃຊ້', 'bg-slate-200 text-slate-600'];
  if (p.ends_on && p.ends_on < today()) return ['ໝົດເຂດ', 'bg-rose-100 text-rose-700'];
  if (p.starts_on && p.starts_on > today()) return ['ຍັງບໍ່ເລີ່ມ', 'bg-sky-100 text-sky-800'];
  if (p.max_uses > 0 && p.used_count >= p.max_uses) return ['ໃຊ້ຄົບແລ້ວ', 'bg-amber-100 text-amber-800'];
  return ['ເປີດໃຊ້', 'bg-emerald-100 text-emerald-800'];
}

export default function Promotions() {
  const [list, reload, loading] = useLoad(() => get<Promo[]>('/promotions'));
  const [edit, setEdit] = useState<Partial<Promo> | null>(null);
  const { run } = useAction();
  if (loading || !list) return <Spinner />;

  const blank: Partial<Promo> = { name: '', code: '', type: 'percent', value: 10, min_subtotal: 0, max_discount: 0, starts_on: '', ends_on: '', days: '0123456', time_from: '', time_to: '', order_type: 'all', max_uses: 0, active: 1 };
  return (
    <div className="space-y-4 p-4 lg:p-6">
      <PageHeader
        title="ໂປຣໂມຊັນ ແລະ ຄູປອງ"
        sub="ຕັ້ງສ່ວນຫຼຸດລ່ວງໜ້າ — ພະນັກງານເລືອກໃຊ້ໃນໜ້າອໍເດີ ຫຼື ໃສ່ລະຫັດຄູປອງ"
        actions={<Button onClick={() => setEdit(blank)}><Plus className="size-4" /> ເພີ່ມໂປຣໂມຊັນ</Button>}
      />
      {list.length === 0 ? (
        <Card><Empty>ຍັງບໍ່ມີໂປຣໂມຊັນ — ກົດ "ເພີ່ມໂປຣໂມຊັນ" (ເຊັ່ນ Happy Hour ຫຼຸດ 10% ຊ່ວງ 14:00–17:00)</Empty></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => {
            const [label, color] = state(p);
            return (
              <Card key={p.id} className={cx('p-4', !p.active && 'opacity-60')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{p.name}</div>
                    <div className="text-2xl font-bold text-brand-700">{p.type === 'percent' ? `${p.value}%` : kip(p.value)}</div>
                  </div>
                  <Badge className={color}>{label}</Badge>
                </div>
                <div className="mt-2 space-y-0.5 text-xs text-slate-500">
                  {p.code && <div>ລະຫັດຄູປອງ: <b className="font-mono text-slate-700">{p.code}</b></div>}
                  {p.min_subtotal > 0 && <div>ຍອດຂັ້ນຕ່ຳ {kip(p.min_subtotal)}</div>}
                  {p.max_discount > 0 && <div>ຫຼຸດສູງສຸດ {kip(p.max_discount)}</div>}
                  {(p.starts_on || p.ends_on) && <div>{p.starts_on || '…'} → {p.ends_on || '…'}</div>}
                  {p.time_from && <div>ເວລາ {p.time_from}–{p.time_to}</div>}
                  {p.days !== '0123456' && <div>ມື້: {[...p.days].map((d) => DAYS[Number(d)]).join(', ')}</div>}
                  <div>{ORDER_TYPE[p.order_type]}</div>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-sm">
                  <span className="text-slate-500">
                    ໃຊ້ແລ້ວ <b className="text-slate-800">{p.used_count}</b>{p.max_uses > 0 && ` / ${p.max_uses}`} ຄັ້ງ · ຫຼຸດລວມ <b className="text-slate-800">{kip(p.total_discount)}</b>
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setEdit(p)} title="ແກ້ໄຂ"><Pencil className="size-4" /></Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {edit && (
        <PromoModal
          p={edit}
          onClose={() => setEdit(null)}
          onSaved={reload}
          onDelete={
            edit.id
              ? async () => {
                  if (!confirm(`ລຶບ ${edit.name}?`)) return;
                  const r = await run(() => del<{ deactivated: boolean }>(`/promotions/${edit.id}`));
                  if (r) {
                    toast.ok(r.deactivated ? 'ເຄີຍຖືກໃຊ້ແລ້ວ ຈຶ່ງປິດໃຊ້ແທນການລຶບ' : 'ລຶບແລ້ວ');
                    setEdit(null);
                    reload();
                  }
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

function PromoModal({ p, onClose, onSaved, onDelete }: { p: Partial<Promo>; onClose: () => void; onSaved: () => void; onDelete?: () => void }) {
  const [f, setF] = useState({ ...p } as Promo);
  const { busy, run } = useAction();
  const set = (v: Partial<Promo>) => setF({ ...f, ...v });
  const toggleDay = (d: string) => set({ days: f.days.includes(d) ? f.days.replace(d, '') : [...f.days, d].sort().join('') });
  const save = async () => {
    const body = {
      name: f.name, code: f.code, type: f.type, value: f.value, minSubtotal: f.min_subtotal, maxDiscount: f.max_discount,
      startsOn: f.starts_on, endsOn: f.ends_on, days: f.days, timeFrom: f.time_from, timeTo: f.time_to, orderType: f.order_type, maxUses: f.max_uses, active: !!f.active,
    };
    if (await run(() => (p.id ? put(`/promotions/${p.id}`, body) : post('/promotions', body)), 'ບັນທຶກແລ້ວ')) {
      onSaved();
      onClose();
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={p.id ? 'ແກ້ໄຂໂປຣໂມຊັນ' : 'ໂປຣໂມຊັນໃໝ່'}
      footer={
        <>
          {onDelete && <Button variant="ghost" className="mr-auto text-rose-600" onClick={onDelete}><Trash2 className="size-4" /> ລຶບ</Button>}
          <Button onClick={save} loading={busy} disabled={!f.name.trim() || !(f.value > 0)}>ບັນທຶກ</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="ຊື່ໂປຣໂມຊັນ"><Input value={f.name} onChange={(e) => set({ name: e.target.value })} autoFocus maxLength={80} placeholder="ເຊັ່ນ Happy Hour, ລູກຄ້າ VIP" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ປະເພດສ່ວນຫຼຸດ">
            <Select value={f.type} onChange={(e) => set({ type: e.target.value as Promo['type'], value: 0, max_discount: 0 })}>
              <option value="percent">ເປີເຊັນ (%)</option>
              <option value="amount">ຈຳນວນເງິນ (₭)</option>
            </Select>
          </Field>
          <Field label={f.type === 'percent' ? 'ເປີເຊັນ' : 'ຈຳນວນເງິນ (₭)'}>
            {f.type === 'percent' ? (
              <Input type="number" min={0} max={100} value={f.value || ''} onChange={(e) => set({ value: Math.min(100, Number(e.target.value) || 0) })} />
            ) : (
              <MoneyInput value={f.value} onChange={(v) => set({ value: v })} />
            )}
          </Field>
          <Field label="ຍອດບິນຂັ້ນຕ່ຳ (₭)"><MoneyInput value={f.min_subtotal} onChange={(v) => set({ min_subtotal: v })} /></Field>
          {f.type === 'percent' && <Field label="ຫຼຸດສູງສຸດ (₭, 0 = ບໍ່ຈຳກັດ)"><MoneyInput value={f.max_discount} onChange={(v) => set({ max_discount: v })} /></Field>}
        </div>
        <Field label="ລະຫັດຄູປອງ (ບໍ່ບັງຄັບ)" hint="ຖ້າໃສ່ ພະນັກງານຕ້ອງພິມລະຫັດຈຶ່ງໃຊ້ໄດ້ (ບໍ່ສະແດງໃນລາຍການ). ວ່າງ = ເລືອກໄດ້ເລີຍ">
          <Input value={f.code} onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/\s+/g, '') })} maxLength={30} placeholder="ເຊັ່ນ VIP50" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ເລີ່ມວັນທີ"><Input type="date" value={f.starts_on} onChange={(e) => set({ starts_on: e.target.value })} /></Field>
          <Field label="ຫາວັນທີ"><Input type="date" value={f.ends_on} onChange={(e) => set({ ends_on: e.target.value })} /></Field>
          <Field label="ແຕ່ເວລາ"><Input type="time" value={f.time_from} onChange={(e) => set({ time_from: e.target.value })} /></Field>
          <Field label="ຫາເວລາ"><Input type="time" value={f.time_to} onChange={(e) => set({ time_to: e.target.value })} /></Field>
        </div>
        <Field label="ໃຊ້ໄດ້ໃນມື້">
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d, i) => (
              <button key={d} onClick={() => toggleDay(String(i))} className={cx('rounded-lg border px-3 py-1.5 text-sm', f.days.includes(String(i)) ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-300 text-slate-500')}>{d}</button>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ໃຊ້ກັບ">
            <Select value={f.order_type} onChange={(e) => set({ order_type: e.target.value as Promo['order_type'] })}>
              {Object.entries(ORDER_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="ຈຳນວນຄັ້ງສູງສຸດ (0 = ບໍ່ຈຳກັດ)"><Input type="number" min={0} value={f.max_uses || ''} onChange={(e) => set({ max_uses: Number(e.target.value) || 0 })} placeholder="0" /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-brand-600" checked={!!f.active} onChange={(e) => set({ active: e.target.checked ? 1 : 0 })} /> ເປີດໃຊ້ງານ
        </label>
      </div>
    </Modal>
  );
}
