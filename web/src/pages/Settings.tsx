import { useEffect, useState } from 'react';
import { get, put, type Branch, type Restaurant } from '../lib/api';
import { useSession } from '../lib/store';
import { device } from '../lib/device';
import { Button, Card, Field, Input, PageHeader, Spinner, Textarea, useAction, useLoad } from '../components/ui';

export default function SettingsPage() {
  const refresh = useSession((s) => s.refresh);
  const [data, , loading] = useLoad(() => get<{ branch: Branch; restaurant: Restaurant; lanUrls: string[] }>('/settings'));
  const [f, setF] = useState<Record<string, string | number>>({});
  const [kitchenPrint, setKitchenPrint] = useState(device.autoKitchenPrint);
  const [receiptPrint, setReceiptPrint] = useState(device.autoReceiptPrint);
  const { busy, run } = useAction();

  useEffect(() => {
    if (!data) return;
    const b = data.branch;
    setF({
      restaurantName: data.restaurant.name,
      name: b.name,
      address: b.address,
      phone: b.phone,
      vat_rate: b.vat_rate,
      service_rate: b.service_rate,
      rate_usd: b.rate_usd,
      rate_thb: b.rate_thb,
      receipt_header: b.receipt_header,
      receipt_footer: b.receipt_footer,
      bank_info: b.bank_info,
      qr_enabled: b.qr_enabled,
      qr_auto_confirm: b.qr_auto_confirm,
      public_url: b.public_url,
    });
  }, [data]);

  if (loading || !data || !('name' in f)) return <Spinner />;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((x) => ({ ...x, [k]: e.target.type === 'number' ? Number(e.target.value) : e.target.value }));

  async function save() {
    if (await run(() => put('/settings', f), 'ບັນທຶກການຕັ້ງຄ່າແລ້ວ')) refresh();
  }

  return (
    <div className="max-w-4xl space-y-4 p-4 lg:p-6">
      <PageHeader title="ຕັ້ງຄ່າ" actions={<Button onClick={save} loading={busy}>ບັນທຶກ</Button>} />
      <Card className="grid gap-4 p-5 md:grid-cols-2">
        <h2 className="font-semibold md:col-span-2">ຂໍ້ມູນຮ້ານ</h2>
        <Field label="ຊື່ຮ້ານ"><Input value={f.restaurantName} onChange={set('restaurantName')} /></Field>
        <Field label="ຊື່ສາຂາ"><Input value={f.name} onChange={set('name')} /></Field>
        <Field label="ທີ່ຢູ່"><Input value={f.address} onChange={set('address')} /></Field>
        <Field label="ເບີໂທ"><Input value={f.phone} onChange={set('phone')} /></Field>
      </Card>
      <Card className="grid gap-4 p-5 md:grid-cols-2">
        <h2 className="font-semibold md:col-span-2">ພາສີ ແລະ ອັດຕາແລກປ່ຽນ</h2>
        <Field label="VAT (%)" hint="ຄິດຈາກຍອດຫຼັງສ່ວນຫຼຸດ + ຄ່າບໍລິການ"><Input type="number" min={0} max={100} step="0.1" value={f.vat_rate} onChange={set('vat_rate')} /></Field>
        <Field label="ຄ່າບໍລິການ (%)" hint="ໃຊ້ສະເພາະອໍເດີນັ່ງກິນໃນຮ້ານ"><Input type="number" min={0} max={100} step="0.1" value={f.service_rate} onChange={set('service_rate')} /></Field>
        <Field label="1 USD = ? ກີບ"><Input type="number" min={1} value={f.rate_usd} onChange={set('rate_usd')} /></Field>
        <Field label="1 THB = ? ກີບ"><Input type="number" min={1} value={f.rate_thb} onChange={set('rate_thb')} /></Field>
      </Card>
      <Card className="grid gap-4 p-5 md:grid-cols-2">
        <h2 className="font-semibold md:col-span-2">ໃບບິນ</h2>
        <Field label="ຂໍ້ຄວາມຫົວບິນ"><Textarea rows={2} value={f.receipt_header} onChange={set('receipt_header')} /></Field>
        <Field label="ຂໍ້ຄວາມທ້າຍບິນ"><Textarea rows={2} value={f.receipt_footer} onChange={set('receipt_footer')} /></Field>
        <div className="md:col-span-2">
          <Field label="ຂໍ້ມູນບັນຊີທະນາຄານ (ພິມໃນໃບແຈ້ງຍອດ)" hint="ເຊັ່ນ: BCEL 0101 xxxx xxxx · ຊື່ບັນຊີ">
            <Textarea rows={2} value={f.bank_info} onChange={set('bank_info')} />
          </Field>
        </div>
      </Card>
      <Card className="space-y-4 p-5">
        <h2 className="font-semibold">QR ສັ່ງອາຫານ (ລູກຄ້າສະແກນເອງ)</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-brand-600" checked={!!f.qr_enabled} onChange={(e) => setF((x) => ({ ...x, qr_enabled: e.target.checked ? 1 : 0 }))} />
          ເປີດໃຫ້ລູກຄ້າສັ່ງອາຫານຜ່ານ QR
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={!!f.qr_auto_confirm} onChange={(e) => setF((x) => ({ ...x, qr_auto_confirm: e.target.checked ? 1 : 0 }))} />
          <span>
            ສົ່ງເຂົ້າຄົວທັນທີ ໂດຍບໍ່ຕ້ອງໃຫ້ພະນັກງານຢືນຢັນ
            <span className="block text-xs text-slate-500">ຖ້າປິດ: ອໍເດີຈາກລູກຄ້າຈະລໍຖ້າພະນັກງານກົດຢືນຢັນກ່ອນ ແລະ ຍັງບໍ່ລວມໃນຍອດບິນ</span>
          </span>
        </label>
        <Field label="ທີ່ຢູ່ເວັບທີ່ມືຖືລູກຄ້າເປີດໄດ້" hint="ໃສ່ IP ຂອງເຄື່ອງແມ່ຂ່າຍໃນ Wi-Fi ຮ້ານ (ລູກຄ້າຕ້ອງເຊື່ອມ Wi-Fi ດຽວກັນ) ຫຼື ໂດເມນ https ຖ້າເປີດອອກອິນເຕີເນັດ">
          <Input value={f.public_url} onChange={set('public_url')} placeholder="http://192.168.1.10:4000" />
        </Field>
        {data.lanUrls.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            ທີ່ຢູ່ຂອງເຄື່ອງນີ້:
            {data.lanUrls.map((u) => (
              <button key={u} onClick={() => setF((x) => ({ ...x, public_url: u }))} className="rounded-full border border-slate-300 px-2.5 py-1 font-mono text-slate-700 hover:border-brand-500 hover:bg-brand-50">
                {u}
              </button>
            ))}
          </div>
        )}
      </Card>
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">ເຄື່ອງພິມ (ສະເພາະເຄື່ອງນີ້)</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-brand-600" checked={kitchenPrint} onChange={(e) => { setKitchenPrint(e.target.checked); device.autoKitchenPrint = e.target.checked; }} />
          ພິມໃບສັ່ງຄົວອັດຕະໂນມັດ ເມື່ອກົດ "ສົ່ງຄົວ"
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-brand-600" checked={receiptPrint} onChange={(e) => { setReceiptPrint(e.target.checked); device.autoReceiptPrint = e.target.checked; }} />
          ພິມໃບຮັບເງິນອັດຕະໂນມັດຫຼັງຊຳລະ
        </label>
        <p className="text-xs text-slate-500">
          ໃຊ້ເຄື່ອງພິມໃບບິນ 80mm ທີ່ຕັ້ງເປັນເຄື່ອງພິມຫຼັກຂອງ Windows. ເພື່ອພິມທັນທີບໍ່ຕ້ອງກົດຢືນຢັນ ໃຫ້ເປີດ Chrome ດ້ວຍ --kiosk-printing.
        </p>
      </Card>
    </div>
  );
}
