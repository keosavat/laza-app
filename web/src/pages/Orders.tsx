import { useState } from 'react';
import { Printer } from 'lucide-react';
import { get, type Order, type OrderRow } from '../lib/api';
import { useSession, useSync } from '../lib/store';
import { dateTime, kip, METHOD_LABEL, STATUS_LABEL, todayLocal } from '../lib/format';
import { printReceipt } from '../lib/print';
import { Badge, Button, Card, Empty, Input, Modal, PageHeader, Select, Spinner, cx, toast, useLoad } from '../components/ui';

export default function Orders() {
  const { restaurant, branch, user } = useSession();
  const [date, setDate] = useState(todayLocal());
  const [status, setStatus] = useState<'paid' | 'cancelled' | 'open'>('paid');
  const [rows, reload, loading] = useLoad(() => get<OrderRow[]>(`/orders?status=${status}${status === 'open' ? '' : `&date=${date}`}`), [date, status]);
  const [detail, setDetail] = useState<Order | null>(null);
  useSync(['orders'], reload);

  const total = rows?.reduce((s, r) => s + r.total, 0) ?? 0;
  async function open(id: number) {
    try {
      setDetail(await get<Order>(`/orders/${id}`));
    } catch (e) {
      toast.err(e);
    }
  }

  return (
    <div className="p-4 lg:p-6">
      <PageHeader
        title="ປະຫວັດບິນ"
        sub={`${rows?.length ?? 0} ບິນ · ລວມ ${kip(total)}`}
        actions={
          <>
            <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="w-40">
              <option value="paid">ຊຳລະແລ້ວ</option>
              <option value="cancelled">ຍົກເລີກ</option>
              <option value="open">ຍັງເປີດຢູ່</option>
            </Select>
            {status !== 'open' && <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />}
          </>
        }
      />
      <Card className="overflow-x-auto">
        {loading ? (
          <Spinner />
        ) : !rows?.length ? (
          <Empty>ບໍ່ມີຂໍ້ມູນ</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">ບິນ / ອໍເດີ</th>
                <th className="px-4 py-2 font-medium">ບ່ອນ</th>
                <th className="px-4 py-2 font-medium">ເວລາ</th>
                <th className="px-4 py-2 font-medium">ວິທີຊຳລະ</th>
                <th className="px-4 py-2 font-medium">ຜູ້ຮັບເງິນ</th>
                <th className="px-4 py-2 text-right font-medium">ຍອດ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} onClick={() => open(r.id)} className="cursor-pointer hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{r.bill_no ?? '—'}</div>
                    <div className="text-xs text-slate-400">#{r.order_no}</div>
                  </td>
                  <td className="px-4 py-2.5">{r.type === 'dine_in' ? `ໂຕະ ${r.table_name}` : `ກັບບ້ານ · ຄິວ ${r.queue_no}`}</td>
                  <td className="px-4 py-2.5 text-slate-600">{dateTime(r.paid_at ?? r.created_at)}</td>
                  <td className="px-4 py-2.5">{r.methods?.split(',').map((m) => METHOD_LABEL[m as keyof typeof METHOD_LABEL] ?? m).join(', ') ?? '—'}</td>
                  <td className="px-4 py-2.5">{r.paid_by_name ?? '—'}</td>
                  <td className="tabular px-4 py-2.5 text-right font-semibold">{kip(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {detail && (
        <Modal
          open
          onClose={() => setDetail(null)}
          title={`${detail.bill_no ?? 'ອໍເດີ'} #${detail.order_no}`}
          footer={
            detail.status === 'paid' && (
              <Button variant="secondary" onClick={() => printReceipt(detail, restaurant!, branch!, user!.name)}>
                <Printer className="size-4" /> ພິມໃບຮັບເງິນຊ້ຳ
              </Button>
            )
          }
        >
          <div className="space-y-3 text-sm">
            <div className="text-slate-500">
              {detail.type === 'dine_in' ? `ໂຕະ ${detail.table_name}` : `ກັບບ້ານ · ຄິວ ${detail.queue_no}`} · {dateTime(detail.paid_at ?? detail.created_at)}
            </div>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {detail.items.map((i) => (
                <div key={i.id} className={cx('flex justify-between px-3 py-2', i.status === 'cancelled' && 'text-slate-400 line-through')}>
                  <span>
                    {i.qty}× {i.name}
                    {i.options.length > 0 && <span className="text-xs text-slate-500"> ({i.options.map((o) => o.name).join(', ')})</span>}
                    {i.status === 'cancelled' && <Badge className="ml-2 bg-rose-100 text-rose-700 no-underline">{STATUS_LABEL.cancelled}</Badge>}
                  </span>
                  <span className="tabular">{kip(i.unit_price * i.qty)}</span>
                </div>
              ))}
            </div>
            <div className="space-y-1">
              <Row l="ລວມ" v={detail.subtotal} />
              {detail.discount > 0 && <Row l="ສ່ວນຫຼຸດ" v={-detail.discount} />}
              {detail.service > 0 && <Row l="ຄ່າບໍລິການ" v={detail.service} />}
              {detail.vat > 0 && <Row l="VAT" v={detail.vat} />}
              <Row l="ຍອດສຸດທິ" v={detail.total} strong />
              {detail.payments.map((p) => (
                <Row key={p.id} l={`${METHOD_LABEL[p.method]}${p.currency !== 'LAK' ? ` (${p.currency} ${p.amount})` : ''}`} v={p.amount_lak} />
              ))}
              {detail.change_lak > 0 && <Row l="ເງິນທອນ" v={detail.change_lak} />}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Row({ l, v, strong }: { l: string; v: number; strong?: boolean }) {
  return (
    <div className={cx('flex justify-between', strong && 'text-base font-bold')}>
      <span>{l}</span>
      <span className="tabular">{kip(v)}</span>
    </div>
  );
}
