import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { get, post } from '../lib/api';
import { kip } from '../lib/format';
import { Button, Input, cx, toast, useAction, useLoad } from './ui';

export interface Customer {
  id: number; name: string; phone: string; note: string; credit_limit: number; active: number; balance: number; last_entry?: string | null;
  birthday?: string; tags?: string; points?: number; visits?: number; spent?: number; last_visit?: string | null;
}

/** Pick a customer (search by name/phone) or create one on the spot. */
export default function CustomerPicker({ value, onPick }: { value: Customer | null; onPick: (c: Customer | null) => void }) {
  const [list, reload] = useLoad(() => get<Customer[]>('/customers'));
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: '', phone: '' });
  const { busy, run } = useAction();

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-brand-500 bg-brand-50 p-2.5 text-sm">
        <span>
          <b>{value.name}</b> {value.phone && <span className="text-slate-500">· {value.phone}</span>}
          <span className="block text-xs text-slate-500">
            ໜີ້ຄ້າງ {kip(value.balance)}{value.credit_limit > 0 && ` · ວົງເງິນ ${kip(value.credit_limit)}`}{!!value.points && ` · ${value.points.toLocaleString('en-US')} ຄະແນນ`}
          </span>
        </span>
        <button onClick={() => onPick(null)} className="text-xs text-slate-500 underline">ປ່ຽນ</button>
      </div>
    );
  }
  const shown = (list ?? []).filter((c) => c.active && (!q.trim() || (c.name + c.phone).toLowerCase().includes(q.trim().toLowerCase()))).slice(0, 30);
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-2">
      {adding ? (
        <div className="space-y-2">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="ຊື່ລູກຄ້າ" autoFocus maxLength={80} />
          <Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="ເບີໂທ (ບໍ່ບັງຄັບ)" maxLength={30} />
          <div className="flex gap-2">
            <Button
              size="sm"
              loading={busy}
              disabled={!f.name.trim()}
              onClick={async () => {
                const c = await run(() => post<Customer>('/customers', f), 'ສ້າງລູກຄ້າແລ້ວ');
                if (c) {
                  reload();
                  onPick(c);
                }
              }}
            >
              ສ້າງ ແລະ ເລືອກ
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>ຍົກເລີກ</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ຄົ້ນຫາຊື່ / ເບີໂທ..." className="pl-8" />
          </div>
          <div className="max-h-40 overflow-y-auto">
            {shown.length === 0 && <div className="py-2 text-center text-sm text-slate-400">ບໍ່ພົບລູກຄ້າ</div>}
            {shown.map((c) => (
              <button key={c.id} onClick={() => onPick(c)} className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100">
                <span>{c.name} <span className="text-xs text-slate-400">{c.phone}</span></span>
                <span className={cx('tabular text-xs', c.balance > 0 ? 'text-rose-600' : 'text-slate-400')}>{c.balance > 0 ? `ຄ້າງ ${kip(c.balance)}` : c.points ? `${c.points.toLocaleString('en-US')} ຄະແນນ` : ''}</span>
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              setF({ name: /\d/.test(q) ? '' : q, phone: /\d/.test(q) ? q : '' });
              setAdding(true);
            }}
            className="flex w-full items-center gap-2 border-t border-slate-100 px-1 pt-2 text-sm font-medium text-brand-700"
          >
            <Plus className="size-4" /> ລູກຄ້າໃໝ່
          </button>
        </>
      )}
    </div>
  );
}

export { toast };
