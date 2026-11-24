import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Printer, RefreshCw, QrCode, Ban } from 'lucide-react';
import { del, post, type Order } from '../lib/api';
import { useSession } from '../lib/store';
import { dateTime } from '../lib/format';
import { printTableQr } from '../lib/print';
import { Button, Modal, Select, Spinner, toast, useAction , ask } from './ui';

export const DURATIONS: [number, string][] = [
  [0, 'ບໍ່ຈຳກັດ (ຈົນຊຳລະເງິນ)'],
  [1, '1 ຊົ່ວໂມງ (ບຸບເຟ່ຕ໌ດ່ວນ)'],
  [2, '2 ຊົ່ວໂມງ'],
  [3, '3 ຊົ່ວໂມງ'],
  [4, '4 ຊົ່ວໂມງ'],
];

/** Link a customer's phone must open. Uses the address set in Settings when staff browse via localhost. */
export function customerUrl(token: string, publicUrl: string) {
  return `${publicUrl || window.location.origin}/m/${token}`;
}

export default function QrModal({ order, onClose, onChanged }: { order: Order; onClose: () => void; onChanged: () => void }) {
  const { branch, restaurant } = useSession();
  const [hours, setHours] = useState(0);
  const [img, setImg] = useState('');
  const { busy, run } = useAction();
  const token = order.qr_token;
  const url = token ? customerUrl(token, branch!.public_url) : '';
  const local = /^(localhost|127\.|\[::1\])/.test(new URL(url || window.location.href).hostname);

  useEffect(() => {
    if (!url) return setImg('');
    QRCode.toDataURL(url, { margin: 1, width: 360, errorCorrectionLevel: 'M' }).then(setImg, () => toast.err('ສ້າງ QR ບໍ່ສຳເລັດ'));
  }, [url]);

  const issue = async () => {
    if (token && !(await ask('ສ້າງ QR ໃໝ່? QR ເກົ່າທີ່ວາງໃນໂຕະຈະໃຊ້ບໍ່ໄດ້ອີກ'))) return;
    if (await run(() => post(`/orders/${order.id}/qr`, { durationHours: hours }), token ? 'ສ້າງ QR ໃໝ່ແລ້ວ' : 'ສ້າງ QR ແລ້ວ')) onChanged();
  };
  const revoke = async () => {
    if (!(await ask('ປິດ QR ນີ້? ລູກຄ້າຈະສັ່ງຜ່ານມືຖືບໍ່ໄດ້ອີກ'))) return;
    if (await run(() => del(`/orders/${order.id}/qr`), 'ປິດ QR ແລ້ວ')) onChanged();
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.ok('ຄັດລອກລິ້ງແລ້ວ');
    } catch {
      toast.err('ຄັດລອກບໍ່ໄດ້ ກະລຸນາເລືອກຂໍ້ຄວາມແລ້ວຄັດລອກເອງ');
    }
  };

  return (
    <Modal open onClose={onClose} title={`QR ສັ່ງອາຫານ · ໂຕະ ${order.table_name}`}>
      {!token ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">ຍັງບໍ່ໄດ້ເປີດ QR ສຳລັບໂຕະນີ້. ເມື່ອເປີດແລ້ວ ລູກຄ້າສະແກນເພື່ອເບິ່ງເມນູ ແລະ ສັ່ງອາຫານຈາກມືຖືຂອງຕົນເອງ.</p>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">ໄລຍະເວລາທີ່ໃຊ້ໄດ້</span>
            <Select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
              {DURATIONS.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </label>
          <Button size="lg" className="w-full" onClick={issue} loading={busy}>
            <QrCode className="size-4" /> ເປີດ QR
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="mx-auto flex size-64 items-center justify-center rounded-xl border border-slate-200 bg-white p-2">
            {img ? <img src={img} alt="QR" className="size-full" /> : <Spinner />}
          </div>
          <div className="text-center text-sm text-slate-600">
            {order.qr_expires_at ? `ໃຊ້ໄດ້ຮອດ ${dateTime(order.qr_expires_at)}` : 'ໃຊ້ໄດ້ຈົນກວ່າຈະຊຳລະເງິນ'} · ແຂກ {order.guest_count || '—'} ຄົນ
          </div>
          <div className="flex items-center gap-2">
            <input readOnly value={url} onFocus={(e) => e.target.select()} className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 bg-slate-50 px-2 font-mono text-xs" />
            <Button variant="secondary" size="sm" onClick={copy} aria-label="ຄັດລອກ">
              <Copy className="size-4" />
            </Button>
          </div>
          {local && (
            <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              ລິ້ງນີ້ໃຊ້ <b>localhost</b> ຈຶ່ງເປີດຈາກມືຖືລູກຄ້າບໍ່ໄດ້. ໄປທີ່ <b>ຕັ້ງຄ່າ → QR ສັ່ງອາຫານ</b> ເພື່ອຕັ້ງທີ່ຢູ່ເວັບ (ເຊັ່ນ IP ຂອງເຄື່ອງນີ້ໃນ Wi-Fi ຮ້ານ).
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => printTableQr(order.table_name ?? '', img, url, restaurant!, order.qr_expires_at)} disabled={!img}>
              <Printer className="size-4" /> ພິມ QR
            </Button>
            <Button variant="secondary" onClick={issue} loading={busy}>
              <RefreshCw className="size-4" /> ສ້າງໃໝ່
            </Button>
          </div>
          <label className="flex items-center justify-between gap-2 text-sm text-slate-600">
            ໄລຍະເວລາ QR ໃໝ່
            <Select value={hours} onChange={(e) => setHours(Number(e.target.value))} className="w-56">
              {DURATIONS.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </label>
          <button onClick={revoke} className="flex w-full items-center justify-center gap-1 text-sm text-rose-600 hover:underline">
            <Ban className="size-4" /> ປິດ QR ນີ້
          </button>
        </div>
      )}
    </Modal>
  );
}
