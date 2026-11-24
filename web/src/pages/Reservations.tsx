import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, ChevronLeft, ChevronRight, Pencil, Phone, Plus, Users, UserCheck, UserX, Ban, Undo2 } from 'lucide-react';
import { get, post, put, type Order, type Reservation, type ResvStatus, type Table } from '../lib/api';
import { useSession, useSync } from '../lib/store';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, cx, toast, useAction, useLoad } from '../components/ui';

const STATUS: Record<ResvStatus, [string, string]> = {
  booked: ['ລໍຖ້າ', 'bg-sky-100 text-sky-800'],
  seated: ['ນັ່ງແລ້ວ', 'bg-emerald-100 text-emerald-800'],
  cancelled: ['ຍົກເລີກ', 'bg-slate-200 text-slate-600'],
  no_show: ['ບໍ່ມາ', 'bg-rose-100 text-rose-700'],
};

/** Today's date at the branch (YYYY-MM-DD), from its UTC offset. */
const localToday = (offsetMin: number) => new Date(Date.now() + offsetMin * 60_000).toISOString().slice(0, 10);
const shiftDay = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
const niceDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('lo-LA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const endTime = (t: string, mins: number) => {
  const m = Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) + mins;
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

export default function Reservations() {
  const nav = useNavigate();
  const offset = useSession((s) => s.branch?.utc_offset_min ?? 0);
  const shift = useSession((s) => s.shift);
  const today = localToday(offset);
  const [date, setDate] = useState(today);
  const [list, reload, loading] = useLoad(() => get<Reservation[]>(`/reservations?date=${date}`), [date]);
  const [tables] = useLoad(() => get<Table[]>('/tables'));
  const [edit, setEdit] = useState<Partial<Reservation> | null>(null);
  const [seatFor, setSeatFor] = useState<Reservation | null>(null);
  const { run } = useAction();
  useSync(['tables', 'orders'], reload);

  const active = (list ?? []).filter((r) => r.status === 'booked' || r.status === 'seated');
  const guests = active.reduce((s, r) => s + r.party_size, 0);

  const setStatus = async (r: Reservation, status: 'booked' | 'cancelled' | 'no_show') => {
    if (await run(() => post(`/reservations/${r.id}/status`, { status }))) reload();
  };

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <PageHeader
        title="ຈອງໂຕະ"
        sub={list ? `${active.length} ການຈອງ · ${guests} ຄົນ` : undefined}
        actions={<Button onClick={() => setEdit({ reserved_date: date, reserved_time: '18:00', party_size: 2, duration_min: 90, name: '', phone: '', note: '', table_id: null })}><Plus className="size-4" /> ຈອງໂຕະໃໝ່</Button>}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => setDate(shiftDay(date, -1))} aria-label="ມື້ກ່ອນ"><ChevronLeft className="size-4" /></Button>
        <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-40!" />
        <Button variant="secondary" onClick={() => setDate(shiftDay(date, 1))} aria-label="ມື້ໜ້າ"><ChevronRight className="size-4" /></Button>
        {date !== today && <Button variant="ghost" onClick={() => setDate(today)}>ມື້ນີ້</Button>}
        <span className="text-sm text-slate-500">{niceDate(date)}</span>
      </div>

      {loading || !list ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Card><Empty>ບໍ່ມີການຈອງໃນມື້ນີ້ — ກົດ "ຈອງໂຕະໃໝ່"</Empty></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((r) => {
            const [label, color] = STATUS[r.status];
            const waiting = r.status === 'booked';
            return (
              <Card key={r.id} className={cx('p-4', (r.status === 'cancelled' || r.status === 'no_show') && 'opacity-60')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="tabular text-2xl font-bold text-brand-700">{r.reserved_time}<span className="text-sm font-normal text-slate-400"> – {endTime(r.reserved_time, r.duration_min)}</span></div>
                    <div className="truncate font-semibold">{r.name}</div>
                  </div>
                  <Badge className={color}>{label}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
                  <span className="flex items-center gap-1"><Users className="size-4" />{r.party_size} ຄົນ</span>
                  <span className="flex items-center gap-1"><CalendarClock className="size-4" />{r.table_name ? `ໂຕະ ${r.table_name}` : <span className="text-amber-600">ຍັງບໍ່ລະບຸໂຕະ</span>}</span>
                  {r.phone && <span className="flex items-center gap-1"><Phone className="size-4" />{r.phone}</span>}
                </div>
                {r.note && <div className="mt-2 rounded-lg bg-slate-50 px-2 py-1 text-xs text-slate-600">{r.note}</div>}
                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
                  {waiting && <Button size="sm" onClick={() => (shift ? setSeatFor(r) : toast.err('ຍັງບໍ່ໄດ້ເປີດກະ: ເປີດກະກ່ອນຈຶ່ງຮັບແຂກໄດ້'))}><UserCheck className="size-4" /> ແຂກມາແລ້ວ</Button>}
                  {r.status === 'seated' && r.order_id && <Button size="sm" variant="secondary" onClick={() => nav(`/order/${r.order_id}`)}>ເປີດອໍເດີ</Button>}
                  {waiting && <Button size="sm" variant="ghost" onClick={() => setEdit(r)}><Pencil className="size-4" /> ແກ້ໄຂ</Button>}
                  {waiting && <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => setStatus(r, 'no_show')}><UserX className="size-4" /> ບໍ່ມາ</Button>}
                  {waiting && <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => setStatus(r, 'cancelled')}><Ban className="size-4" /> ຍົກເລີກ</Button>}
                  {(r.status === 'cancelled' || r.status === 'no_show') && <Button size="sm" variant="ghost" onClick={() => setStatus(r, 'booked')}><Undo2 className="size-4" /> ກູ້ຄືນ</Button>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {edit && tables && <ResvModal r={edit} tables={tables} onClose={() => setEdit(null)} onSaved={reload} />}
      {seatFor && tables && <SeatModal r={seatFor} tables={tables} onClose={() => setSeatFor(null)} onDone={(o) => nav(`/order/${o.id}`)} onFail={reload} />}
    </div>
  );
}

function ResvModal({ r, tables, onClose, onSaved }: { r: Partial<Reservation>; tables: Table[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(r);
  const { busy, run } = useAction();
  const set = (v: Partial<Reservation>) => setF({ ...f, ...v });
  const save = async () => {
    const body = { name: f.name, phone: f.phone, partySize: f.party_size, tableId: f.table_id ?? null, date: f.reserved_date, time: f.reserved_time, durationMin: f.duration_min, note: f.note };
    if (await run(() => (r.id ? put(`/reservations/${r.id}`, body) : post('/reservations', body)), 'ບັນທຶກແລ້ວ')) {
      onSaved();
      onClose();
    }
  };
  return (
    <Modal open onClose={onClose} title={r.id ? 'ແກ້ໄຂການຈອງ' : 'ຈອງໂຕະໃໝ່'} footer={<Button onClick={save} loading={busy} disabled={!f.name?.trim() || !f.reserved_time}>ບັນທຶກ</Button>}>
      <div className="space-y-4">
        <Field label="ຊື່ຜູ້ຈອງ"><Input value={f.name ?? ''} onChange={(e) => set({ name: e.target.value })} autoFocus maxLength={80} /></Field>
        <Field label="ເບີໂທ" hint="ຖ້າເບີນີ້ຢູ່ໃນລູກຄ້າ (CRM) ແລ້ວ ລະບົບຈະຜູກໃຫ້ອັດຕະໂນມັດ"><Input value={f.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} maxLength={30} inputMode="tel" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ວັນທີ"><Input type="date" value={f.reserved_date ?? ''} onChange={(e) => set({ reserved_date: e.target.value })} /></Field>
          <Field label="ເວລາ"><Input type="time" value={f.reserved_time ?? ''} onChange={(e) => set({ reserved_time: e.target.value })} /></Field>
          <Field label="ຈຳນວນຄົນ"><Input type="number" min={1} max={200} value={f.party_size ?? ''} onChange={(e) => set({ party_size: Number(e.target.value) || 1 })} /></Field>
          <Field label="ໄລຍະນັ່ງ (ນາທີ)"><Input type="number" min={15} max={480} step={15} value={f.duration_min ?? ''} onChange={(e) => set({ duration_min: Number(e.target.value) || 90 })} /></Field>
        </div>
        <Field label="ໂຕະ" hint="ເລືອກພາຍຫຼັງກໍໄດ້ — ລະບົບກັນບໍ່ໃຫ້ຈອງໂຕະດຽວກັນຊ້ອນເວລາ">
          <Select value={f.table_id ?? ''} onChange={(e) => set({ table_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">— ຍັງບໍ່ລະບຸ —</option>
            {tables.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name} (ນັ່ງໄດ້ {t.seats})</option>)}
          </Select>
        </Field>
        <Field label="ໝາຍເຫດ"><Input value={f.note ?? ''} onChange={(e) => set({ note: e.target.value })} maxLength={300} placeholder="ເຊັ່ນ ວັນເກີດ, ຕ້ອງການບ່ອນງຽບ" /></Field>
      </div>
    </Modal>
  );
}

function SeatModal({ r, tables, onClose, onDone, onFail }: { r: Reservation; tables: Table[]; onClose: () => void; onDone: (o: Order) => void; onFail: () => void }) {
  const [tableId, setTableId] = useState<number | ''>(r.table_id ?? '');
  const { busy, run } = useAction();
  const go = async () => {
    const res = await run(() => post<{ order: Order }>(`/reservations/${r.id}/seat`, { tableId: tableId || undefined }));
    if (res) onDone(res.order);
    else onFail();
  };
  return (
    <Modal open onClose={onClose} title={`ຮັບແຂກ: ${r.name}`} footer={<Button size="lg" className="w-full" onClick={go} loading={busy} disabled={!tableId}>ເປີດໂຕະ ແລະ ເລີ່ມສັ່ງ</Button>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">{r.party_size} ຄົນ · ຈອງເວລາ {r.reserved_time}</p>
        <Field label="ນັ່ງທີ່ໂຕະ">
          <Select value={tableId} onChange={(e) => setTableId(e.target.value ? Number(e.target.value) : '')} autoFocus>
            <option value="">— ເລືອກໂຕະ —</option>
            {tables.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name} (ນັ່ງໄດ້ {t.seats}){t.id === r.table_id ? ' · ໂຕະທີ່ຈອງ' : ''}</option>)}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
