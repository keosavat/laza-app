import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, HandPlatter, Receipt } from 'lucide-react';
import { get, post } from '../lib/api';
import { useSession, useSync } from '../lib/store';
import { can, since } from '../lib/format';
import { beep } from '../lib/sound';
import { Button, toast, useLoad } from './ui';

interface Alerts {
  calls: { id: number; type: 'waiter' | 'bill'; created_at: string; order_id: number; table_name: string }[];
  awaiting: { order_id: number; table_name: string; n: number; since: string }[];
}
const EMPTY: Alerts = { calls: [], awaiting: [] };

/** Floating list of things customers are waiting on: items to approve, "call waiter", "bill please". */
export default function QrAlerts() {
  const nav = useNavigate();
  const allowed = useSession((s) => can(s.user?.role, 'pos'));
  const [data, reload] = useLoad(() => (allowed ? get<Alerts>('/qr/alerts') : Promise.resolve(EMPTY)), [allowed]);
  useSync(['qr', 'orders'], reload);
  const seen = useRef<Set<string> | null>(null);
  const a = data ?? EMPTY;

  // Re-check now and then so "x minutes ago" and missed events stay correct.
  useEffect(() => {
    const t = setInterval(reload, 30_000);
    return () => clearInterval(t);
  }, [reload]);

  useEffect(() => {
    if (!data) return;
    const keys = new Set([...a.calls.map((c) => `c${c.id}`), ...a.awaiting.map((w) => `a${w.order_id}:${w.n}`)]);
    if (seen.current && [...keys].some((k) => !seen.current!.has(k))) beep(988, 300);
    seen.current = keys;
  }, [data, a.calls, a.awaiting]);

  if (!a.calls.length && !a.awaiting.length) return null;

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
      {a.awaiting.map((w) => (
        <div key={w.order_id} className="pointer-events-auto rounded-xl border-2 border-rose-400 bg-rose-50 p-3 shadow-lg">
          <div className="flex items-center gap-2 font-semibold text-rose-800">
            <HandPlatter className="size-4" />
            ໂຕະ {w.table_name}: {w.n} ລາຍການລໍຢືນຢັນ
            <span className="ml-auto text-xs font-normal text-rose-600">{since(w.since)}</span>
          </div>
          <Button size="sm" className="mt-2 w-full" onClick={() => nav(`/order/${w.order_id}`)}>ເປີດເພື່ອຢືນຢັນ</Button>
        </div>
      ))}
    </div>
  );
}
