import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { get, type Category, type ChosenOption, type MenuItem } from '../lib/api';
import { useSync } from '../lib/store';
import { kip } from '../lib/format';
import { Button, Input, Modal, Spinner, cx, useLoad } from './ui';

export interface CartLine {
  key: string;
  item: MenuItem;
  qty: number;
  options: ChosenOption[];
  note: string;
}
export const lineKey = (itemId: number, options: ChosenOption[], note: string) =>
  `${itemId}|${options.map((o) => `${o.group}:${o.name}`).join(',')}|${note}`;
export const linePrice = (l: Pick<CartLine, 'item' | 'options'>) => l.item.price + l.options.reduce((s, o) => s + o.price, 0);

/** Category tabs + searchable item grid. Calls onAdd with the chosen options. */
export default function MenuPicker({ onAdd }: { onAdd: (item: MenuItem, options: ChosenOption[], note: string) => void }) {
  const [data, reload, loading] = useLoad(async () => {
    const [cats, items] = await Promise.all([get<Category[]>('/categories'), get<MenuItem[]>('/menu-items')]);
    return { cats: cats.filter((c) => c.active), items: items.filter((i) => i.active) };
  });
  useSync(['menu'], reload);
  const [cat, setCat] = useState<number | 'all'>('all');
  const [q, setQ] = useState('');
  const [picking, setPicking] = useState<MenuItem | null>(null);

  const items = useMemo(() => {
    if (!data) return [];
    const s = q.trim().toLowerCase();
    return data.items.filter((i) => (cat === 'all' || i.category_id === cat) && (!s || i.name.toLowerCase().includes(s)));
  }, [data, cat, q]);

  if (loading || !data) return <Spinner />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-slate-200 bg-white p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input placeholder="ຄົ້ນຫາເມນູ..." value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <Pill active={cat === 'all'} onClick={() => setCat('all')}>ທັງໝົດ</Pill>
          {data.cats.map((c) => (
            <Pill key={c.id} active={cat === c.id} onClick={() => setCat(c.id)}>
              {c.name}
            </Pill>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {items.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-400">ບໍ່ພົບເມນູ</div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {items.map((it) => (
              <button
                key={it.id}
                onClick={() => (it.options.length ? setPicking(it) : onAdd(it, [], ''))}
                className="group overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm transition hover:border-brand-500 active:scale-[.98]"
              >
                <div className="flex aspect-[4/3] items-center justify-center bg-slate-100">
                  {it.image_url ? (
                    <img src={it.image_url} alt="" className="size-full object-cover" loading="lazy" />
                  ) : (
                    <span className="px-2 text-center text-2xl font-bold text-slate-300">{it.name.slice(0, 2)}</span>
                  )}
                </div>
                <div className="p-2">
                  <div className="line-clamp-2 min-h-10 text-sm font-medium leading-5">{it.name}</div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="tabular text-sm font-semibold text-brand-700">{kip(it.price)}</span>
                    {it.portions !== null && it.portions <= 5 && (
                      <span className={cx('rounded-full px-1.5 py-0.5 text-[10px] font-semibold', it.portions === 0 ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800')}>
                        {it.portions === 0 ? 'ສະຕັອກໝົດ' : `ເຫຼືອ ${it.portions}`}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      {picking && (
        <OptionModal
          item={picking}
          onClose={() => setPicking(null)}
          onDone={(opts, note) => {
            onAdd(picking, opts, note);
            setPicking(null);
          }}
        />
      )}
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cx('shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium', active ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')}
    >
      {children}
    </button>
  );
}

export function OptionModal({ item, onClose, onDone }: { item: Pick<MenuItem, 'name' | 'price' | 'options'>; onClose: () => void; onDone: (o: ChosenOption[], note: string) => void }) {
  const [sel, setSel] = useState<ChosenOption[]>(() =>
    item.options.filter((g) => g.required && !g.multiple).map((g) => ({ group: g.name, name: g.choices[0].name, price: g.choices[0].price })),
  );
  const [note, setNote] = useState('');
  const toggle = (group: string, multiple: boolean, c: { name: string; price: number }) => {
    setSel((s) => {
      const has = s.some((x) => x.group === group && x.name === c.name);
      if (multiple) return has ? s.filter((x) => !(x.group === group && x.name === c.name)) : [...s, { group, ...c }];
      const rest = s.filter((x) => x.group !== group);
      const g = item.options.find((x) => x.name === group)!;
      return has && !g.required ? rest : [...rest, { group, ...c }];
    });
  };
  const missing = item.options.filter((g) => g.required && !sel.some((x) => x.group === g.name));
  const price = item.price + sel.reduce((s, o) => s + o.price, 0);
  return (
    <Modal
      open
      onClose={onClose}
      title={item.name}
      footer={
        <Button disabled={missing.length > 0} onClick={() => onDone(sel, note.trim())} className="w-full" size="lg">
          ເພີ່ມ · {kip(price)}
        </Button>
      }
    >
      <div className="space-y-4">
        {item.options.map((g) => (
          <div key={g.name}>
            <div className="mb-2 text-sm font-semibold">
              {g.name} {g.required && <span className="text-rose-600">*</span>}
              <span className="ml-1 text-xs font-normal text-slate-400">{g.multiple ? 'ເລືອກໄດ້ຫຼາຍ' : 'ເລືອກ 1'}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {g.choices.map((c) => {
                const on = sel.some((x) => x.group === g.name && x.name === c.name);
                return (
                  <button
                    key={c.name}
                    onClick={() => toggle(g.name, g.multiple, c)}
                    className={cx('rounded-lg border px-3 py-2 text-sm', on ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-300')}
                  >
                    {c.name}
                    {c.price > 0 && <span className="ml-1 text-xs text-slate-500">+{kip(c.price)}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <div>
          <div className="mb-2 text-sm font-semibold">ໝາຍເຫດ</div>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ເຊັ່ນ: ບໍ່ໃສ່ຜັກ" maxLength={200} />
        </div>
      </div>
    </Modal>
  );
}
