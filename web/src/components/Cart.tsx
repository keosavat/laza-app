// Cart of not-yet-sent lines, shared by the order screen and the "add more" dialog.
import { useMemo, useState } from 'react';
import { Minus, Plus, StickyNote, Trash2 } from 'lucide-react';
import type { ChosenOption, MenuItem } from '../lib/api';
import { kip } from '../lib/format';
import { lineKey, linePrice, type CartLine } from './MenuPicker';
import { cx } from './ui';

let seq = 0;

export function useCart() {
  const [cart, setCart] = useState<CartLine[]>([]);
  return useMemo(() => {
    const add = (item: MenuItem, options: ChosenOption[], note: string) => {
      const same = lineKey(item.id, options, note);
      setCart((c) => {
        const hit = c.find((l) => lineKey(l.item.id, l.options, l.note) === same);
        // `key` is a stable id; matching is by item + options + note so identical picks stack.
        return hit ? c.map((l) => (l === hit ? { ...l, qty: l.qty + 1 } : l)) : [...c, { key: `c${++seq}`, item, options, note, qty: 1 }];
      });
    };
    const bump = (key: string, d: number) => setCart((c) => c.map((l) => (l.key === key ? { ...l, qty: Math.min(999, l.qty + d) } : l)).filter((l) => l.qty > 0));
    const setNote = (key: string, note: string) => setCart((c) => c.map((l) => (l.key === key ? { ...l, note: note.slice(0, 200) } : l)));
    return {
      cart,
      add,
      bump,
      setNote,
      clear: () => setCart([]),
      total: cart.reduce((s, l) => s + linePrice(l) * l.qty, 0),
      qty: cart.reduce((s, l) => s + l.qty, 0),
      /** Request body items for POST /orders/:id/items. */
      payload: () => cart.map((l) => ({ menuItemId: l.item.id, qty: l.qty, options: l.options, note: l.note.trim() })),
    };
  }, [cart]);
}
export type Cart = ReturnType<typeof useCart>;

/** Editable list of cart lines: quantity steppers and a per-line kitchen note. */
export function CartLines({ cart, compact }: { cart: Cart; compact?: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="divide-y divide-slate-100">
      {cart.cart.map((l) => (
        <div key={l.key} className={cx('px-3', compact ? 'py-2' : 'py-2.5')}>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{l.item.name}</div>
              {l.options.length > 0 && <div className="text-xs text-slate-500">{l.options.map((o) => o.name).join(', ')}</div>}
              <div className="tabular text-xs text-slate-500">{kip(linePrice(l))}{l.qty > 1 && ` × ${l.qty} = ${kip(linePrice(l) * l.qty)}`}</div>
            </div>
            <div className="flex items-center gap-1">
              <Step onClick={() => cart.bump(l.key, -1)} label="ລົດ">
                {l.qty === 1 ? <Trash2 className="size-4 text-rose-600" /> : <Minus className="size-4" />}
              </Step>
              <span className="tabular w-7 text-center font-semibold">{l.qty}</span>
              <Step onClick={() => cart.bump(l.key, 1)} label="ເພີ່ມ">
                <Plus className="size-4" />
              </Step>
            </div>
          </div>
          {editing === l.key ? (
            <input
              autoFocus
              value={l.note}
              onChange={(e) => cart.setNote(l.key, e.target.value)}
              onBlur={() => setEditing(null)}
              onKeyDown={(e) => e.key === 'Enter' && setEditing(null)}
              placeholder="ເຊັ່ນ: ບໍ່ເຜັດ, ບໍ່ໃສ່ຜັກ, ເອົາມາກ່ອນ"
              maxLength={200}
              className="mt-1.5 h-8 w-full rounded-md border border-amber-300 bg-amber-50 px-2 text-sm outline-none focus:ring-2 focus:ring-amber-200"
            />
          ) : (
            <button onClick={() => setEditing(l.key)} className={cx('mt-1 flex items-center gap-1 text-xs', l.note ? 'font-medium text-amber-700' : 'text-slate-400 hover:text-slate-600')}>
              <StickyNote className="size-3.5" />
              {l.note || 'ເພີ່ມໝາຍເຫດ'}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function Step({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} className="flex size-8 items-center justify-center rounded-lg border border-slate-300 bg-white hover:bg-slate-50">
      {children}
    </button>
  );
}
