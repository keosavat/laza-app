// Side panel on the Tables page: what an occupied table has ordered, plus quick actions (add more, bill, pay).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Maximize2, Plus, Printer, Wallet, X, Hand } from 'lucide-react';
import { get, post, type Order } from '../lib/api';
import { useSession, useSync } from '../lib/store';
import { can, kip, since, STATUS_CLASS, STATUS_LABEL, time } from '../lib/format';
import { printBill } from '../lib/print';
import AddItemsModal from './AddItemsModal';
import Checkout from './Checkout';
import { Badge, Button, Spinner, cx, toast, useAction, useLoad } from './ui';

export default function TablePanel({ orderId, onClose }: { orderId: number; onClose: () => void }) {
  const nav = useNavigate();
  const { user, branch, restaurant } = useSession();
  const [order, reload, loading] = useLoad(() => get<Order>(`/orders/${orderId}`), [orderId]);
  const [modal, setModal] = useState<null | 'add' | 'pay'>(null);
  const { busy, run } = useAction();
  useSync(['orders'], reload);

  if (loading || !order) {
    return (
      <aside className="rounded-xl border border-slate-200 bg-white">
        <Spinner />
      </aside>
    );
  }
  const live = order.items.filter((i) => i.status !== 'cancelled' && !i.awaiting);
  const waiting = order.items.filter((i) => i.awaiting && i.status !== 'cancelled');
  const open = order.status === 'open';

  async function bill() {
    const r = await run(() => post<Order & { printedByServer: boolean }>(`/orders/${orderId}/print-bill`));
    if (r?.printedByServer) toast.ok('ສົ່ງພິມບິນແລ້ວ');
    else if (r) printBill(r, restaurant!, branch!);
    reload();
  }

  return (
    <aside className="flex max-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:sticky lg:top-4">
      <div className="flex items-start gap-2 border-b border-slate-200 p-3">
        <div className="min-w-0 flex-1">
          <div className="text-lg font-bold">ໂຕະ {order.table_name}</div>
          <div className="text-xs text-slate-500">
            #{order.order_no} · ເປີດ {time(order.created_at)} ({since(order.created_at)}){order.guest_count ? ` · ແຂກ ${order.guest_count}` : ''}
            {order.bill_printed_at && <span className="ml-1 font-medium text-amber-600">· ພິມບິນແລ້ວ</span>}
          </div>
        </div>
        <button onClick={() => nav(`/order/${orderId}`)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" title="ເປີດເຕັມຈໍ" aria-label="ເປີດເຕັມຈໍ">
          <Maximize2 className="size-4" />
        </button>
        <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="ປິດ">
          <X className="size-4" />
        </button>
      </div>

      {open && (
        <div className="grid grid-cols-2 gap-2 border-b border-slate-200 p-3">
          <Button size="lg" className="col-span-2" onClick={() => setModal('add')}>
            <Plus className="size-5" /> ສັ່ງເພີ່ມ
          </Button>
          <Button variant="secondary" onClick={bill} disabled={busy || !live.length}>
            <Printer className="size-4" /> ພິມບິນ
          </Button>
          {can(user?.role, 'pay') ? (
            <Button
              variant="secondary"
              className="border-emerald-300! text-emerald-700!"
              onClick={() => (waiting.length ? toast.err('ກະລຸນາຢືນຢັນ ຫຼື ປະຕິເສດລາຍການຈາກລູກຄ້າກ່ອນຊຳລະ') : setModal('pay'))}
              disabled={!live.length}
            >
              <Wallet className="size-4" /> ຊຳລະເງິນ
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => nav(`/order/${orderId}`)}>
              <Maximize2 className="size-4" /> ລາຍລະອຽດ
            </Button>
          )}
        </div>
      )}

      {waiting.length > 0 && (
        <button onClick={() => nav(`/order/${orderId}`)} className="mx-3 mt-3 flex items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 p-2 text-left text-sm text-rose-700">
          <Hand className="size-4 shrink-0" />
          ລູກຄ້າສັ່ງ {waiting.reduce((s, i) => s + i.qty, 0)} ລາຍການ ລໍຖ້າຢືນຢັນ — ກົດເພື່ອເປີດ
        </button>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {order.items.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">ຍັງບໍ່ມີລາຍການ — ກົດ "ສັ່ງເພີ່ມ"</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {order.items.map((it) => (
              <div key={it.id} className={cx('flex gap-2 px-3 py-2 text-sm', it.status === 'cancelled' && 'opacity-50')}>
                <span className="tabular w-7 shrink-0 text-right font-semibold">{it.qty}×</span>
                <div className="min-w-0 flex-1">
                  <div className={cx('font-medium', it.status === 'cancelled' && 'line-through')}>{it.name}</div>
                  {(it.options.length > 0 || it.note) && (
                    <div className="text-xs text-slate-500">
                      {it.options.map((o) => o.name).join(', ')}
                      {it.note && <span className="text-amber-700"> · {it.note}</span>}
                    </div>
                  )}
                  <div className="mt-0.5 flex items-center gap-2">
                    {it.awaiting && it.status !== 'cancelled' ? (
                      <Badge className="bg-rose-100 text-rose-700">ລໍຢືນຢັນ</Badge>
                    ) : (
                      <Badge className={STATUS_CLASS[it.status]}>{STATUS_LABEL[it.status]}</Badge>
                    )}
                    <span className="text-[11px] text-slate-400">{time(it.created_at)}</span>
                  </div>
                </div>
                <span className="tabular shrink-0">{kip(it.unit_price * it.qty)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-0.5 border-t border-slate-200 p-3 text-sm">
        <Row l="ລວມ" v={order.subtotal} />
        {order.discount > 0 && <Row l="ສ່ວນຫຼຸດ" v={-order.discount} />}
        {order.service > 0 && <Row l="ຄ່າບໍລິການ" v={order.service} />}
        {order.vat > 0 && <Row l="VAT" v={order.vat} />}
        <div className="flex items-end justify-between pt-1">
          <span className="font-semibold">ຍອດສຸດທິ</span>
          <span className="tabular text-2xl font-bold text-brand-700">{kip(order.total)}</span>
        </div>
      </div>

      {modal === 'add' && <AddItemsModal order={order} onClose={() => setModal(null)} onDone={reload} />}
      {modal === 'pay' && (
        <Checkout
          order={order}
          onClose={() => setModal(null)}
          onPaid={() => {
            setModal(null);
            onClose();
          }}
        />
      )}
    </aside>
  );
}

function Row({ l, v }: { l: string; v: number }) {
  return (
    <div className="flex justify-between text-slate-600">
      <span>{l}</span>
      <span className="tabular">{kip(v)}</span>
    </div>
  );
}
