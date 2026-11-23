import { useState } from 'react';
import { get } from '../lib/api';
import { dateTime, kip } from '../lib/format';
import { Badge, Button, Card, Empty, Input, PageHeader, Select, Spinner, useLoad } from '../components/ui';

interface Row {
  id: number;
  user_id: number | null;
  user_name: string | null;
  action: string;
  entity: string;
  entity_id: number | null;
  data_json: string;
  created_at: string;
}
interface Res { rows: Row[]; hasMore: boolean; actions: string[] }
interface StaffRow { id: number; name: string }

/** action → [label, badge colour, risky?] */
const ACTION: Record<string, [string, string, boolean]> = {
  login: ['ເຂົ້າສູ່ລະບົບ', 'bg-slate-100 text-slate-700', false],
  create: ['ສ້າງ', 'bg-emerald-100 text-emerald-800', false],
  update: ['ແກ້ໄຂ', 'bg-sky-100 text-sky-800', false],
  delete: ['ລົບ', 'bg-rose-100 text-rose-700', true],
  add_items: ['ເພີ່ມລາຍການ', 'bg-slate-100 text-slate-700', false],
  pay: ['ຊຳລະເງິນ', 'bg-emerald-100 text-emerald-800', false],
  discount: ['ສ່ວນຫຼຸດ', 'bg-amber-100 text-amber-800', true],
  transfer: ['ຍ້າຍໂຕະ', 'bg-slate-100 text-slate-700', false],
  cancel: ['ຍົກເລີກບິນ', 'bg-rose-100 text-rose-700', true],
  void_item: ['ຍົກເລີກລາຍການ', 'bg-rose-100 text-rose-700', true],
  open: ['ເປີດກະ', 'bg-emerald-100 text-emerald-800', false],
  close: ['ປິດກະ', 'bg-sky-100 text-sky-800', false],
  issue_qr: ['ອອກ QR', 'bg-slate-100 text-slate-700', false],
  revoke_qr: ['ຍົກເລີກ QR', 'bg-amber-100 text-amber-800', false],
  approve_items: ['ອະນຸມັດອໍເດີ QR', 'bg-slate-100 text-slate-700', false],
  reject_items: ['ປະຕິເສດອໍເດີ QR', 'bg-amber-100 text-amber-800', false],
  stock_in: ['ຮັບສະຕັອກ', 'bg-emerald-100 text-emerald-800', false],
  stock_adjust: ['ນັບສະຕັອກ', 'bg-sky-100 text-sky-800', false],
  stock_waste: ['ຕັດເສຍຫາຍ', 'bg-rose-100 text-rose-700', true],
  debt_payment: ['ຮັບຊຳລະໜີ້', 'bg-emerald-100 text-emerald-800', false],
  promo: ['ໃຊ້ໂປຣໂມຊັນ', 'bg-amber-100 text-amber-800', false],
  promo_remove: ['ເອົາໂປຣອອກ', 'bg-amber-100 text-amber-800', true],
  recipe: ['ແກ້ສູດອາຫານ', 'bg-sky-100 text-sky-800', false],
};
const ENTITY: Record<string, string> = {
  order: 'ອໍເດີ', order_item: 'ລາຍການ', menu_item: 'ເມນູ', ingredient: 'ວັດຖຸດິບ', user: 'ພະນັກງານ', shift: 'ກະ', promotion: 'ໂປຣໂມຊັນ', customer: 'ລູກຄ້າ', settings: 'ຕັ້ງຄ່າ', printer: 'ເຄື່ອງພິມ',
};

/** One-line human summary of the stored JSON. */
function detail(r: Row): string {
  let d: any = {};
  try { d = JSON.parse(r.data_json || '{}'); } catch { /* ignore */ }
  switch (r.action) {
    case 'void_item': return `${d.name ?? ''} × ${d.qty ?? ''} — ${d.reason ?? ''}`;
    case 'cancel': return `ເຫດຜົນ: ${d.reason ?? '—'} (${d.activeItems ?? 0} ລາຍການ)`;
    case 'discount': return d.type === 'percent' ? `${d.value}%` : d.value ? kip(d.value) : 'ລຶບສ່ວນຫຼຸດ';
    case 'pay': return `ຍອດ ${kip(d.total ?? 0)} · ຮັບ ${kip(d.paid ?? 0)}`;
    case 'open': return `ເງິນເລີ່ມຕົ້ນ ${kip(d.opening ?? 0)}`;
    case 'close': return `ນັບໄດ້ ${kip(d.counted ?? 0)} / ຄວນມີ ${kip(d.expected ?? 0)} (${d.counted - d.expected >= 0 ? '+' : ''}${kip((d.counted ?? 0) - (d.expected ?? 0))})`;
    case 'update': if (d.price) return `ລາຄາ ${kip(d.price[0])} → ${kip(d.price[1])}`; break;
    case 'stock_in': case 'stock_adjust': case 'stock_waste': return `${d.qty} ${d.note ? '· ' + d.note : ''}`;
  }
  const keys = Object.keys(d);
  return keys.length ? keys.map((k) => `${k}: ${typeof d[k] === 'object' ? JSON.stringify(d[k]) : d[k]}`).join(', ').slice(0, 140) : '';
}

export default function AuditLog() {
  const [f, setF] = useState({ user: '', action: '', from: '', to: '', risky: false });
  const [limit, setLimit] = useState(100);
  const qs = new URLSearchParams({ limit: String(limit) });
  (['user', 'action', 'from', 'to'] as const).forEach((k) => f[k] && qs.set(k, f[k]));
  const [data, , loading] = useLoad(() => get<Res>(`/audit?${qs}`), [qs.toString()]);
  const [staff] = useLoad(() => get<StaffRow[]>('/users'));
  const set = (p: Partial<typeof f>) => { setF({ ...f, ...p }); setLimit(100); };

  const rows = (data?.rows ?? []).filter((r) => !f.risky || ACTION[r.action]?.[2]);

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <PageHeader title="ປະຫວັດການກະທຳ" sub="ໃຜ ເຮັດຫຍັງ ເມື່ອໃດ — ບັນທຶກອັດຕະໂນມັດ ແກ້ໄຂ ຫຼື ລົບບໍ່ໄດ້" />
      <Card className="flex flex-wrap items-end gap-3 p-3">
        <label className="text-xs text-slate-500">ພະນັກງານ
          <Select value={f.user} onChange={(e) => set({ user: e.target.value })} className="mt-1 w-40">
            <option value="">ທັງໝົດ</option>
            {staff?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </label>
        <label className="text-xs text-slate-500">ການກະທຳ
          <Select value={f.action} onChange={(e) => set({ action: e.target.value })} className="mt-1 w-44">
            <option value="">ທັງໝົດ</option>
            {data?.actions.map((a) => <option key={a} value={a}>{ACTION[a]?.[0] ?? a}</option>)}
          </Select>
        </label>
        <label className="text-xs text-slate-500">ແຕ່ວັນທີ
          <Input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} className="mt-1 w-40" />
        </label>
        <label className="text-xs text-slate-500">ເຖິງວັນທີ
          <Input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} className="mt-1 w-40" />
        </label>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={f.risky} onChange={(e) => set({ risky: e.target.checked })} className="size-4" />
          ສະເພາະເຫດການສ່ຽງ
        </label>
        {(f.user || f.action || f.from || f.to || f.risky) && (
          <Button variant="secondary" size="sm" onClick={() => set({ user: '', action: '', from: '', to: '', risky: false })}>ລ້າງຕົວກອງ</Button>
        )}
      </Card>

      {loading && !data ? <Spinner /> : rows.length === 0 ? (
        <Empty>ບໍ່ພົບບັນທຶກ</Empty>
      ) : (
        <Card className="divide-y divide-slate-100">
          {rows.map((r) => {
            const [label, color, risky] = ACTION[r.action] ?? [r.action, 'bg-slate-100 text-slate-700', false];
            return (
              <div key={r.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm ${risky ? 'bg-rose-50/40' : ''}`}>
                <span className="tabular w-36 shrink-0 text-slate-500">{dateTime(r.created_at)}</span>
                <span className="w-28 shrink-0 truncate font-medium">{r.user_name ?? 'ລູກຄ້າ/ລະບົບ'}</span>
                <Badge className={color}>{label}</Badge>
                <span className="text-slate-500">{ENTITY[r.entity] ?? r.entity}{r.entity_id ? ` #${r.entity_id}` : ''}</span>
                <span className="min-w-0 flex-1 truncate text-slate-700" title={detail(r)}>{detail(r)}</span>
              </div>
            );
          })}
        </Card>
      )}
      {data?.hasMore && (
        <div className="text-center"><Button variant="secondary" onClick={() => setLimit(limit + 100)}>ເບິ່ງເພີ່ມ</Button></div>
      )}
    </div>
  );
}
