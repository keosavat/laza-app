import { useNavigate } from 'react-router-dom';
import { Plus, ShoppingBag } from 'lucide-react';
import { get, post, type Order, type OrderRow } from '../lib/api';
import { useSession, useSync } from '../lib/store';
import { kip, since } from '../lib/format';
import { Button, Card, Empty, PageHeader, Spinner, useAction, useLoad } from '../components/ui';

export default function Takeaway() {
  const nav = useNavigate();
  const shift = useSession((s) => s.shift);
  const [orders, reload, loading] = useLoad(() => get<OrderRow[]>('/orders?status=open&type=takeaway'));
  const { busy, run } = useAction();
  useSync(['orders'], reload);

  async function create() {
    const o = await run(() => post<Order>('/orders', { type: 'takeaway' }));
    if (o) nav(`/order/${o.id}`);
  }

  return (
    <div className="p-4 lg:p-6">
      <PageHeader
        title="ຂາຍໜ້າຮ້ານ / ກັບບ້ານ"
        sub="ສ້າງອໍເດີໃໝ່ ຫຼື ເປີດອໍເດີທີ່ພັກໄວ້"
        actions={
          shift ? (
            <Button size="lg" onClick={create} loading={busy}>
              <Plus className="size-5" /> ອໍເດີໃໝ່
            </Button>
          ) : (
            <Button variant="warning" onClick={() => nav('/shift')}>ເປີດກະກ່ອນຂາຍ</Button>
          )
        }
      />
      <h2 className="mb-2 text-sm font-semibold text-slate-600">ອໍເດີທີ່ພັກໄວ້ / ລໍຖ້າຊຳລະ</h2>
      {loading ? (
        <Spinner />
      ) : !orders?.length ? (
        <Card>
          <Empty>ບໍ່ມີອໍເດີຄ້າງ</Empty>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {orders.map((o) => (
            <button key={o.id} onClick={() => nav(`/order/${o.id}`)} className="rounded-xl border-2 border-slate-200 bg-white p-3 text-left shadow-sm hover:border-brand-500">
              <div className="flex items-center gap-2 text-lg font-bold">
                <ShoppingBag className="size-5 text-brand-600" /> ຄິວ {o.queue_no}
              </div>
              <div className="tabular font-semibold">{kip(o.total)}</div>
              <div className="text-xs text-slate-500">
                {o.item_count} ລາຍການ · {since(o.created_at)}
              </div>
              {o.customer_name && <div className="truncate text-xs text-slate-600">{o.customer_name}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
