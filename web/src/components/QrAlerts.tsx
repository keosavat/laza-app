import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, HandPlatter, Receipt } from 'lucide-react';
import { get, post } from '../lib/api';
import { useSession, useSync } from '../lib/store';
import { can, since } from '../lib/format';
import { orderBell } from '../lib/sound';
import { Button, toast, useLoad } from './ui';

interface Alerts {
  calls: { id: number; type: 'waiter' | 'bill'; created_at: string; order_id: number; table_name: string }[];
  awaiting: { order_id: number; table_name: string | null; queue_no: number | null; customer_name: string; n: number; since: string }[];
  /** Customer items already sent to the kitchen (auto-confirm), for the last few minutes. */
  fresh: { order_id: number; table_name: string | null; queue_no: number | null; customer_name: string; n: number; since: string }[];
}
/** "ໂຕະ A01", or for a take-away / API order "ກັບບ້ານ · ຄິວ 3". */
const whereOf = (w: { table_name: string | null; queue_no: number | null }) => (w.table_name ? `ໂຕະ ${w.table_name}` : `ກັບບ້ານ${w.queue_no ? ` · ຄິວ ${w.queue_no}` : ''}`);
const EMPTY: Alerts = { calls: [], awaiting: [], fresh: [] };

/** Floating list of things customers are waiting on: items to approve, "call waiter", "bill please". */
export default function QrAlerts() {
  const nav = useNavigate();
  const allowed = useSession((s) => can(s.user?.role, 'pos'));
  const [data, reload] = useLoad(() => (allowed ? get<Alerts>('/qr/alerts') : Promise.resolve(EMPTY)), [allowed]);
  useSync(['qr', 'orders'], reload);
  const seen = useRef<Set<string> | null>(null);
  const a = { ...EMPTY, ...data };
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const freshKey = (w: Alerts['fresh'][number]) => `f${w.order_id}:${w.n}`;
  const fresh = a.fresh.filter((w) => !dismissed.has(freshKey(w)));

  // Re-check now and then so "x minutes ago", missed events and expiring notices stay correct.
  useEffect(() => {
    const t = setInterval(reload, 20_000);
    return () => clearInterval(t);
  }, [reload]);

  useEffect(() => {
    if (!data) return;
    const keys = new Set([...a.calls.map((c) => `c${c.id}`), ...a.awaiting.map((w) => `a${w.order_id}:${w.n}`), ...a.fresh.map(freshKey)]);
    if (seen.current && [...keys].some((k) => !seen.current!.has(k))) orderBell();
    seen.current = keys;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (!a.calls.length && !a.awaiting.length && !fresh.length) return null;

  const handle = async (id: number) => {
    try {
      await post(`/qr/calls/${id}/handle`);
      reload();
    } catch (e) {
      toast.err(e);
    }
  };

  return (
    // Bottom-left (beside the sidebar) so it never covers the pay / send buttons on the right.
    <div className="pointer-events-none fixed bottom-4 left-4 z-40 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 lg:left-64">
      {a.calls.map((c) => (
        <div key={c.id} className="pointer-events-auto rounded-xl border-2 border-amber-400 bg-amber-50 p-3 shadow-lg">
          <div className="flex items-center gap-2 font-semibold text-amber-900">
            {c.type === 'bill' ? <Receipt className="size-4" /> : <Bell className="size-4" />}
            ໂຕະ {c.table_name} {c.type === 'bill' ? 'ຂໍບິນ' : 'ເອີ້ນພະນັກງານ'}
            <span className="ml-auto text-xs font-normal text-amber-700">{since(c.created_at)}</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button size="sm" variant="secondary" onClick={() => nav(`/order/${c.order_id}`)}>ເບິ່ງໂຕະ</Button>
            <Button size="sm" onClick={() => handle(c.id)}>ຮັບຊາບແລ້ວ</Button>
          </div>
        </div>
      ))}
      {fresh.map((w) => (
        <div key={w.order_id} className="pointer-events-auto rounded-xl border-2 border-brand-500 bg-brand-50 p-3 shadow-lg">
          <div className="flex items-center gap-2 font-semibold text-brand-800">
            <HandPlatter className="size-4" />
            {whereOf(w)}: ລູກຄ້າສັ່ງ {w.n} ລາຍການ
            <span className="ml-auto text-xs font-normal text-brand-700">{since(w.since)}</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button size="sm" variant="secondary" onClick={() => nav(`/order/${w.order_id}`)}>ເບິ່ງໂຕະ</Button>
            <Button size="sm" onClick={() => setDismissed((d) => new Set(d).add(freshKey(w)))}>ຮັບຊາບແລ້ວ</Button>
          </div>
        </div>
      ))}
      {a.awaiting.map((w) => (
        <div key={w.order_id} className="pointer-events-auto rounded-xl border-2 border-rose-400 bg-rose-50 p-3 shadow-lg">
          <div className="flex items-center gap-2 font-semibold text-rose-800">
            <HandPlatter className="size-4" />
            {whereOf(w)}: {w.n} ລາຍການລໍຢືນຢັນ
            <span className="ml-auto text-xs font-normal text-rose-600">{since(w.since)}</span>
          </div>
          <Button size="sm" className="mt-2 w-full" onClick={() => nav(`/order/${w.order_id}`)}>ເປີດເພື່ອຢືນຢັນ</Button>
        </div>
      ))}
    </div>
  );
}
