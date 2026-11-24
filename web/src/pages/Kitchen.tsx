import { useEffect, useMemo, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { get, post, wasQueued, type ItemStatus, type KitchenItem } from '../lib/api';
import { useSync } from '../lib/store';
import { since, STATUS_LABEL, time } from '../lib/format';
import { orderBell } from '../lib/sound';
import { Button, Empty, PageHeader, Spinner, cx, toast, useLoad } from '../components/ui';

const NEXT: Partial<Record<ItemStatus, ItemStatus>> = { pending: 'preparing', preparing: 'ready', ready: 'served' };
const NEXT_LABEL: Partial<Record<ItemStatus, string>> = { pending: 'ເລີ່ມເຮັດ', preparing: 'ເຮັດແລ້ວ', ready: 'ເສີບແລ້ວ' };
const COLS: { status: ItemStatus; tone: string }[] = [
  { status: 'pending', tone: 'border-amber-400' },
  { status: 'preparing', tone: 'border-sky-400' },
  { status: 'ready', tone: 'border-violet-400' },
];

export default function Kitchen() {
  const [items, reload, loading] = useLoad(() => get<KitchenItem[]>('/kitchen'));
  const [sound, setSound] = useState(true);
  const [, tick] = useState(0);
  const lastIds = useRef<Set<number> | null>(null);
  useSync(['kitchen'], reload);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!items) return;
    const ids = new Set(items.map((i) => i.id));
    if (lastIds.current && sound && items.some((i) => !lastIds.current!.has(i.id))) orderBell();
    lastIds.current = ids;
  }, [items, sound]);

  const grouped = useMemo(() => {
    const m = new Map<ItemStatus, KitchenItem[]>();
    for (const c of COLS) m.set(c.status, []);
    for (const it of items ?? []) m.get(it.status)?.push(it);
    return m;
  }, [items]);

  async function advance(it: KitchenItem) {
    const next = NEXT[it.status];
    if (!next) return;
    try {
      const r = await post(`/order-items/${it.id}/status`, { status: next }, { queue: `ຈໍຄົວ: ${it.name}` });
      if (wasQueued(r)) toast.ok('ເກັບໄວ້ ຈະສົ່ງເມື່ອເຊື່ອມຕໍ່ເຊີບເວີໄດ້');
      reload();
    } catch (e) {
      toast.err(e);
    }
  }

  return (
    <div className="flex h-full flex-col p-4 lg:p-6">
      <PageHeader
        title="ຈໍຄົວ"
        sub={`ລໍຖ້າ ${grouped.get('pending')?.length ?? 0} · ກຳລັງເຮັດ ${grouped.get('preparing')?.length ?? 0} · ພ້ອມເສີບ ${grouped.get('ready')?.length ?? 0}`}
        actions={
          <Button variant="secondary" onClick={() => setSound((s) => !s)}>
            {sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />} ສຽງແຈ້ງເຕືອນ
          </Button>
        }
      />
      {loading ? (
        <Spinner />
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-3">
          {COLS.map((c) => (
            <div key={c.status} className="flex min-h-0 flex-col rounded-xl bg-slate-200/60 p-2">
              <div className="px-2 pb-2 text-sm font-semibold">
                {STATUS_LABEL[c.status]} ({grouped.get(c.status)!.length})
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                {grouped.get(c.status)!.length === 0 && <Empty>—</Empty>}
                {grouped.get(c.status)!.map((it) => {
                  const mins = (Date.now() - Date.parse(it.created_at)) / 60000;
                  return (
                    <div key={it.id} className={cx('rounded-lg border-l-4 bg-white p-3 shadow-sm', c.tone)}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-bold">{it.type === 'dine_in' ? `ໂຕະ ${it.table_name}` : `ຄິວ ${it.queue_no}`}</div>
                        <div className={cx('text-xs', mins > 20 ? 'font-semibold text-rose-600' : 'text-slate-500')}>
                          {time(it.created_at)} · {since(it.created_at)}
                        </div>
                      </div>
                      <div className="mt-1 text-lg font-semibold">
                        <span className="tabular">{it.qty}×</span> {it.name}
                      </div>
                      {(it.options.length > 0 || it.note) && (
                        <div className="text-sm text-slate-600">
                          {it.options.map((o) => o.name).join(', ')}
                          {it.note && <div className="font-medium text-amber-700">* {it.note}</div>}
                        </div>
                      )}
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-xs text-slate-400">#{it.order_no} · {it.created_by_name}</span>
                        <Button size="sm" onClick={() => advance(it)}>{NEXT_LABEL[it.status]}</Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
