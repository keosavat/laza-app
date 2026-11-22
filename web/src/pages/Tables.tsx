import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Clock, Printer, ChefHat, QrCode, Hand, Bell, Minus, Plus } from 'lucide-react';
import { get, post, type FloorTable, type Order, type Zone } from '../lib/api';
import { useSession, useSync } from '../lib/store';
import { kip, since } from '../lib/format';
import { DURATIONS } from '../components/QrModal';
import { Button, Empty, Field, Input, Modal, PageHeader, Select, Spinner, cx, toast, useLoad } from '../components/ui';

type Filter = 'all' | 'free' | 'busy' | 'bill';

export default function Tables() {
  const nav = useNavigate();
  const shift = useSession((s) => s.shift);
  const [data, reload, loading] = useLoad(() => get<{ zones: Zone[]; tables: FloorTable[] }>('/floor'));
  const [zone, setZone] = useState<number | 'all'>('all');
  const [filter, setFilter] = useState<Filter>('all');
  const [openFor, setOpenFor] = useState<FloorTable | null>(null);
  const [, tick] = useState(0);
  useSync(['tables', 'orders'], reload);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  if (loading || !data) return <Spinner />;
  const tables = data.tables.filter((t) => zone === 'all' || t.zone_id === zone);
  const counts = {
    all: tables.length,
    free: tables.filter((t) => !t.order_id).length,
    busy: tables.filter((t) => t.order_id).length,
    bill: tables.filter((t) => t.bill_printed_at).length,
  };
  const shown = tables.filter((t) =>
    filter === 'all' ? true : filter === 'free' ? !t.order_id : filter === 'busy' ? !!t.order_id : !!t.bill_printed_at,
  );

  function open(t: FloorTable) {
    if (t.order_id) return nav(`/order/${t.order_id}`);
    if (!shift) {
      toast.err('ຍັງບໍ່ໄດ້ເປີດກະ: ໃຫ້ແຄັດເຊຍ ຫຼື ຜູ້ຈັດການເປີດກະກ່ອນ');
      return;
    }
    setOpenFor(t);
  }

  const FILTERS: [Filter, string][] = [
    ['all', 'ທັງໝົດ'],
    ['free', 'ວ່າງ'],
    ['busy', 'ມີລູກຄ້າ'],
    ['bill', 'ພິມບິນແລ້ວ'],
  ];

  return (
    <div className="p-4 lg:p-6">
      <PageHeader
        title="ໂຕະ"
        sub={`ມີລູກຄ້າ ${counts.busy} / ${counts.all} ໂຕະ`}
        actions={!shift && <Button variant="warning" onClick={() => nav('/shift')}>ເປີດກະກ່ອນຂາຍ</Button>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-lg bg-white p-1 shadow-sm">
          <ZoneBtn active={zone === 'all'} onClick={() => setZone('all')}>ທຸກໂຊນ</ZoneBtn>
          {data.zones.map((z) => (
            <ZoneBtn key={z.id} active={zone === z.id} onClick={() => setZone(z.id)}>
              {z.name}
            </ZoneBtn>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={cx('rounded-full border px-3 py-1 text-sm', filter === k ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-300 bg-white text-slate-600')}
            >
              {label} <span className="tabular text-xs opacity-70">{counts[k]}</span>
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <Empty>ບໍ່ມີໂຕະ — ເພີ່ມໂຕະໄດ້ທີ່ ຈັດການໂຕະ</Empty>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          {shown.map((t) => {
            const busy = !!t.order_id;
            return (
              <button
                key={t.id}
                onClick={() => open(t)}
                className={cx(
                  'flex min-h-28 flex-col justify-between rounded-xl border-2 p-3 text-left shadow-sm transition active:scale-[.98]',
                  !busy && 'border-slate-200 bg-white hover:border-brand-500',
                  busy && !t.bill_printed_at && 'border-brand-600 bg-brand-600 text-white',
                  busy && t.bill_printed_at && 'border-amber-500 bg-amber-500 text-white',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-lg font-bold">{t.name}</span>
                  <span className={cx('flex items-center gap-1 text-xs', busy ? 'text-white/80' : 'text-slate-400')}>
                    {t.has_qr ? <QrCode className="size-3.5" /> : null}
                    <Users className="size-3.5" />
                    {t.seats}
                  </span>
                </div>
                {busy ? (
                  <div className="space-y-0.5 text-sm">
                    <div className="tabular text-base font-semibold">{kip(t.order_total)}</div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-white/85">
                      <span className="flex items-center gap-1"><Clock className="size-3" />{since(t.opened_at)}</span>
                      {t.in_kitchen > 0 && <span className="flex items-center gap-1"><ChefHat className="size-3" />{t.in_kitchen}</span>}
                      {t.bill_printed_at && <span className="flex items-center gap-1"><Printer className="size-3" />ບິນ</span>}
                    </div>
                    {(t.awaiting_count > 0 || t.calls_open > 0) && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {t.awaiting_count > 0 && <span className="flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-rose-600"><Hand className="size-3" />ລໍຢືນຢັນ {t.awaiting_count}</span>}
                        {t.calls_open > 0 && <span className="flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-rose-600"><Bell className="size-3" />ເອີ້ນ</span>}
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="text-sm text-emerald-600">ວ່າງ</span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {openFor && <OpenTableModal table={openFor} onClose={() => setOpenFor(null)} onFail={reload} />}
    </div>
  );
}

function OpenTableModal({ table, onClose, onFail }: { table: FloorTable; onClose: () => void; onFail: () => void }) {
  const nav = useNavigate();
  const qrOn = useSession((s) => !!s.branch?.qr_enabled);
  const [guests, setGuests] = useState(table.seats);
  const [withQr, setWithQr] = useState(qrOn);
  const [hours, setHours] = useState(0);
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    try {
      const o = await post<Order>('/orders', { type: 'dine_in', tableId: table.id, guestCount: guests, withQr, durationHours: hours });
      nav(`/order/${o.id}${withQr ? '?qr=1' : ''}`);
    } catch (e) {
      toast.err(e);
      onFail();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`ເປີດໂຕະ ${table.name}`}
      footer={
        <Button size="lg" onClick={go} loading={busy} className="w-full">
          {withQr ? 'ເປີດໂຕະ ແລະ ສະແດງ QR' : 'ເປີດໂຕະ'}
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label={`ຈຳນວນແຂກ (ໂຕະນີ້ນັ່ງໄດ້ ${table.seats})`}>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setGuests((g) => Math.max(1, g - 1))} aria-label="ລົດ"><Minus className="size-4" /></Button>
            <Input type="number" min={1} max={200} value={guests} onChange={(e) => setGuests(Math.min(200, Math.max(1, Number(e.target.value) || 1)))} className="text-center" />
            <Button variant="secondary" onClick={() => setGuests((g) => Math.min(200, g + 1))} aria-label="ເພີ່ມ"><Plus className="size-4" /></Button>
          </div>
        </Field>
        <label className={cx('flex items-start gap-3 rounded-xl border-2 p-3', withQr ? 'border-brand-600 bg-brand-50' : 'border-slate-200', !qrOn && 'opacity-50')}>
          <input type="checkbox" checked={withQr} disabled={!qrOn} onChange={(e) => setWithQr(e.target.checked)} className="mt-1 size-4 accent-brand-600" />
          <span>
            <span className="flex items-center gap-1.5 font-medium"><QrCode className="size-4" /> ໃຫ້ລູກຄ້າສະແກນ QR ສັ່ງອາຫານເອງ</span>
            <span className="text-xs text-slate-500">{qrOn ? 'ສ້າງ QR ສະເພາະຮອບນີ້ ໝົດອາຍຸເມື່ອຊຳລະເງິນ' : 'ຮ້ານປິດການສັ່ງຜ່ານ QR ໃນການຕັ້ງຄ່າ'}</span>
          </span>
        </label>
        {withQr && (
          <Field label="ໄລຍະເວລາ QR">
            <Select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
              {DURATIONS.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </Field>
        )}
      </div>
    </Modal>
  );
}

function ZoneBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cx('rounded-md px-3 py-1.5 text-sm', active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')}>
      {children}
    </button>
  );
}
