// "Add more" dialog: pick dishes for an open order, then "order" or "order & print to kitchen".
import { useState } from 'react';
import { Printer, Send, ShoppingBasket } from 'lucide-react';
import { post, type Order } from '../lib/api';
import { useSession } from '../lib/store';
import { kip } from '../lib/format';
import { printKitchenTicket } from '../lib/print';
import MenuPicker from './MenuPicker';
import { CartLines, useCart } from './Cart';
import { Button, Modal, toast } from './ui';

export default function AddItemsModal({ order, onClose, onDone }: { order: Pick<Order, 'id' | 'type' | 'table_name' | 'queue_no' | 'guest_count'>; onClose: () => void; onDone: () => void }) {
  const { user, printers } = useSession();
  const cart = useCart();
  const [busy, setBusy] = useState<'plain' | 'print' | null>(null);
  const where = order.type === 'dine_in' ? `ໂຕະ ${order.table_name}` : `ຄິວ ${order.queue_no}`;

  const close = () => {
    if (cart.qty && !confirm('ຍັງມີລາຍການໃນກະຕ່າທີ່ບໍ່ໄດ້ສັ່ງ. ປິດໂດຍບໍ່ສັ່ງບໍ?')) return;
    onClose();
  };

  async function submit(print: boolean) {
    setBusy(print ? 'print' : 'plain');
    try {
      const r = await post<{ itemIds: number[]; order: Order; printedByServer: boolean }>(`/orders/${order.id}/items`, { items: cart.payload(), print });
      // No kitchen printer configured on the server: print from this device's browser instead.
      if (print && !r.printedByServer && !printers.kitchen) {
        printKitchenTicket(r.order, r.order.items.filter((i) => r.itemIds.includes(i.id)), user!.name);
      }
      toast.ok(`ສັ່ງເພີ່ມ ${cart.qty} ລາຍການ${print ? ' · ສົ່ງພິມໄປຄົວແລ້ວ' : ''}`);
      cart.clear();
      onDone();
      onClose();
    } catch (e) {
      toast.err(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal open onClose={close} full title={`ສັ່ງເພີ່ມ · ${where}`}>
      <div className="grid h-[78vh] min-h-0 md:grid-cols-[1fr_360px]">
        <div className="min-h-0 border-slate-200 md:border-r">
          <MenuPicker onAdd={cart.add} />
        </div>
        <div className="flex min-h-0 flex-col bg-slate-50">
          <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2.5 text-sm">
            <ShoppingBasket className="size-4 text-brand-600" />
            <span className="font-semibold">ລາຍການທີ່ຈະສັ່ງ</span>
            {order.guest_count > 0 && <span className="ml-auto text-xs text-slate-500">{order.guest_count} ທີ່ນັ່ງ</span>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto bg-white">
            {cart.qty === 0 ? <div className="p-8 text-center text-sm text-slate-400">ກົດເມນູດ້ານຊ້າຍເພື່ອເພີ່ມ</div> : <CartLines cart={cart} />}
          </div>
          <div className="space-y-2 border-t border-slate-200 bg-white p-3">
            <div className="flex items-end justify-between">
              <span className="text-sm text-slate-600">ຍອດລວມທີ່ສັ່ງເພີ່ມ ({cart.qty})</span>
              <span className="tabular text-xl font-bold text-brand-700">{kip(cart.total)}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" size="lg" onClick={() => submit(false)} disabled={!cart.qty || !!busy} loading={busy === 'plain'}>
                <Send className="size-4" /> ສັ່ງອາຫານ
              </Button>
              <Button size="lg" onClick={() => submit(true)} disabled={!cart.qty || !!busy} loading={busy === 'print'}>
                <Printer className="size-4" /> ສັ່ງ & ພິມໄປຄົວ
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
