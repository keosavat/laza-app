import { useState } from 'react';
import { Beer, Plus, Settings2, Trash2, Undo2, ArrowUpFromLine, AlertTriangle } from 'lucide-react';
import { del, get, post, put } from '../lib/api';
import { useSession } from '../lib/store';
import { can, dateTime, kip } from '../lib/format';
import CustomerPicker, { type Customer } from '../components/CustomerPicker';
import { printSlip, type Slip } from '../lib/print';
import { Badge, Button, Card, Empty, Field, Input, Modal, MoneyInput, PageHeader, Select, Spinner, ask, cx, toast, useAction, useLoad } from '../components/ui';

interface Kind { id: number; name: string; amount: number; active: number }
interface Holding { customer_id: number; name: string; phone: string; kind_id: number; kind: string; unit_amount: number; qty: number; amount: number; since: string }
interface Stored { customer_id: number; customer_name: string; phone: string; item: string; qty: number; next_expiry: string; expired: boolean; since: string }

export default function Deposits() {
  const [tab, setTab] = useState<'box' | 'beer'>('box');
  const [slip, setSlip] = useState<Slip | null>(null);
  return (
    <div className="space-y-4 p-4 lg:p-6">
      <PageHeader title="ມັດຈຳ ແລະ ຝາກເບຍ" sub="ມັດຈຳຂວດ/ຄັງເບຍ (ຮັບ-ຄືນເງິນ) ແລະ ເບຍທີ່ລູກຄ້າຝາກໄວ້ທີ່ຮ້ານ" />
      <div className="flex w-fit gap-1 rounded-lg bg-white p-1 shadow-sm">
        {([['box', 'ມັດຈຳຂວດ / ຄັງ'], ['beer', 'ຝາກເບຍ']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cx('rounded-md px-4 py-1.5 text-sm', tab === k ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')}>{l}</button>
        ))}
      </div>
      {tab === 'box' ? <Containers onSlip={setSlip} /> : <BeerStorage onSlip={setSlip} />}
      {slip && <SlipModal slip={slip} onClose={() => setSlip(null)} />}
    </div>
  );
}

// ---------------- bottle / crate deposits ----------------

function Containers({ onSlip }: { onSlip: (s: Slip) => void }) {
  const admin = useSession((s) => can(s.user?.role, 'admin'));
  const shift = useSession((s) => s.shift);
  const [data, reload, loading] = useLoad(() => get<{ rows: Holding[]; totalQty: number; totalHeld: number }>('/deposits'));
  const [take, setTake] = useState(false);
  const [ret, setRet] = useState<Holding | null>(null);
  const [kinds, setKinds] = useState(false);

  const noShift = () => toast.err('ຍັງບໍ່ໄດ້ເປີດກະ: ເປີດກະກ່ອນຈຶ່ງຮັບ/ຄືນມັດຈຳໄດ້');
  if (loading || !data) return <Spinner />;
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-slate-600">ຂວດ/ຄັງທີ່ຢູ່ກັບລູກຄ້າ <b className="tabular">{data.totalQty.toLocaleString('en-US')}</b> ໜ່ວຍ · ເງິນມັດຈຳທີ່ຖືຢູ່ <b className="tabular text-amber-700">{kip(data.totalHeld)}</b></span>
        <div className="ml-auto flex gap-2">
          {admin && <Button variant="secondary" onClick={() => setKinds(true)}><Settings2 className="size-4" /> ປະເພດ/ລາຄາມັດຈຳ</Button>}
          <Button onClick={() => (shift ? setTake(true) : noShift())}><Plus className="size-4" /> ຮັບມັດຈຳ</Button>
        </div>
      </div>
      {data.rows.length === 0 ? (
        <Card><Empty>ບໍ່ມີລູກຄ້າຄ້າງຂວດ/ຄັງ — ກົດ "ຮັບມັດຈຳ" ເມື່ອລູກຄ້າເອົາເບຍກັບ</Empty></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.rows.map((h) => (
            <Card key={`${h.customer_id}-${h.kind_id}`} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{h.name}</div>
                  {h.phone && <div className="text-xs text-slate-500">{h.phone}</div>}
                </div>
                <Badge className="bg-sky-100 text-sky-800">{h.kind}</Badge>
              </div>
              <div className="mt-2 flex items-end justify-between">
                <div className="tabular text-3xl font-bold text-brand-700">{h.qty}<span className="ml-1 text-sm font-normal text-slate-400">ໜ່ວຍ</span></div>
                <div className="text-right text-sm"><div className="tabular font-semibold text-amber-700">{kip(h.amount)}</div><div className="text-xs text-slate-400">ເງິນມັດຈຳທີ່ຖື</div></div>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-500">
                <span>ຕັ້ງແຕ່ {dateTime(h.since)}</span>
                <Button size="sm" onClick={() => (shift ? setRet(h) : noShift())}><Undo2 className="size-4" /> ຮັບຄືນ</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {take && <TakeModal onClose={() => setTake(false)} onDone={reload} onSlip={onSlip} />}
      {ret && <ReturnModal h={ret} onClose={() => setRet(null)} onDone={reload} onSlip={onSlip} />}
      {kinds && <KindsModal onClose={() => setKinds(false)} />}
    </>
  );
}

function TakeModal({ onClose, onDone, onSlip }: { onClose: () => void; onDone: () => void; onSlip: (s: Slip) => void }) {
  const staff = useSession((s) => s.user?.name ?? '');
  const [kinds] = useLoad(() => get<Kind[]>('/deposit-kinds'));
  const [cust, setCust] = useState<Customer | null>(null);
  const [kindId, setKindId] = useState(0);
  const [qty, setQty] = useState(1);
  const [method, setMethod] = useState<'cash' | 'transfer' | 'qr'>('cash');
  const { busy, run } = useAction();
  const active = (kinds ?? []).filter((k) => k.active);
  const kind = active.find((k) => k.id === kindId);
  const total = (kind?.amount ?? 0) * qty;
  const save = async () => {
    const r = await run(() => post<{ id: number; qty: number; amount: number }>('/deposits/take', { customerId: cust!.id, kindId, qty, method }), `ຮັບມັດຈຳ ${kip(total)} ແລ້ວ`);
    if (r) {
      onDone();
      onClose();
      onSlip({
        title: 'ໃບຮັບມັດຈຳ', no: `DP-${String(r.id).padStart(6, '0')}`, customer: cust!.name, phone: cust!.phone, staff, signatures: true,
        rows: [[`${kind!.name} × ${qty}`, `${kip(kind!.amount)} / ໜ່ວຍ`], ['ວິທີຈ່າຍ', method === 'cash' ? 'ເງິນສົດ' : method === 'transfer' ? 'ໂອນ' : 'QR'], ['ຄ້າງຄືນທັງໝົດ', `${r.qty} ໜ່ວຍ`]],
        big: ['ເງິນມັດຈຳ', kip(total)],
      });
    }
  };
  return (
    <Modal open onClose={onClose} title="ຮັບມັດຈຳຂວດ / ຄັງ" footer={<Button onClick={save} loading={busy} disabled={!cust || !kind || qty < 1}>ຮັບເງິນມັດຈຳ {total > 0 && kip(total)}</Button>}>
      <div className="space-y-4">
        <Field label="ລູກຄ້າ"><CustomerPicker value={cust} onPick={setCust} /></Field>
        {active.length === 0 && kinds && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">ຍັງບໍ່ມີປະເພດມັດຈຳ — ຜູ້ຈັດການຕັ້ງໄດ້ທີ່ "ປະເພດ/ລາຄາມັດຈຳ"</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="ປະເພດ">
            <Select value={kindId} onChange={(e) => setKindId(Number(e.target.value))}>
              <option value={0}>— ເລືອກ —</option>
              {active.map((k) => <option key={k.id} value={k.id}>{k.name} ({kip(k.amount)})</option>)}
            </Select>
          </Field>
          <Field label="ຈຳນວນ"><Input type="number" min={1} max={9999} value={qty || ''} onChange={(e) => setQty(Math.max(0, Math.round(Number(e.target.value) || 0)))} /></Field>
        </div>
        <Field label="ວິທີຮັບເງິນ">
          <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            <option value="cash">ເງິນສົດ (ເຂົ້າລິ້ນຊັກ)</option>
            <option value="transfer">ໂອນ</option>
            <option value="qr">QR</option>
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

function ReturnModal({ h, onClose, onDone, onSlip }: { h: Holding; onClose: () => void; onDone: () => void; onSlip: (s: Slip) => void }) {
  const staff = useSession((s) => s.user?.name ?? '');
  const [qty, setQty] = useState(h.qty);
  const { busy, run } = useAction();
  const refund = qty === h.qty ? h.amount : Math.round((h.amount / h.qty) * qty);
  const save = async () => {
    const r = await run(() => post<{ id: number; qty: number; refunded: number }>('/deposits/return', { customerId: h.customer_id, kindId: h.kind_id, qty }), `ຄືນເງິນມັດຈຳ ${kip(refund)} ແລ້ວ`);
    if (r) {
      onDone();
      onClose();
      onSlip({
        title: 'ໃບຄືນມັດຈຳ', no: `DP-${String(r.id).padStart(6, '0')}`, customer: h.name, phone: h.phone, staff, signatures: true,
        rows: [[`${h.kind} ຄືນ`, `${qty} ໜ່ວຍ`], ['ຍັງຄ້າງຄືນ', `${r.qty} ໜ່ວຍ`]],
        big: ['ຄືນເງິນ', kip(r.refunded)],
      });
    }
  };
  return (
    <Modal open onClose={onClose} title={`ຮັບຄືນ: ${h.name}`} footer={<Button onClick={save} loading={busy} disabled={qty < 1 || qty > h.qty}>ຄືນເງິນ {kip(refund)}</Button>}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{h.kind} ທີ່ຍັງຄ້າງ <b>{h.qty}</b> ໜ່ວຍ (ເງິນມັດຈຳ {kip(h.amount)})</p>
        <Field label="ຈຳນວນທີ່ຄືນ"><Input type="number" min={1} max={h.qty} value={qty || ''} onChange={(e) => setQty(Math.min(h.qty, Math.max(0, Math.round(Number(e.target.value) || 0))))} autoFocus /></Field>
        <p className="text-xs text-slate-500">ຄືນເງິນສົດຈາກລິ້ນຊັກຕາມທີ່ລູກຄ້າຈ່າຍມັດຈຳໄວ້</p>
      </div>
    </Modal>
  );
}

function KindsModal({ onClose }: { onClose: () => void }) {
  const [list, reload, loading] = useLoad(() => get<Kind[]>('/deposit-kinds'));
  const [f, setF] = useState({ name: '', amount: 0 });
  const { busy, run } = useAction();
  return (
    <Modal open onClose={onClose} title="ປະເພດ ແລະ ລາຄາມັດຈຳ">
      <div className="space-y-4">
        {loading || !list ? <Spinner /> : list.length === 0 ? <Empty>ຍັງບໍ່ມີປະເພດ</Empty> : (
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {list.map((k) => (
              <div key={k.id} className={cx('flex items-center gap-2 p-3 text-sm', !k.active && 'opacity-50')}>
                <span className="min-w-0 flex-1 truncate font-medium">{k.name}</span>
                <EditAmount k={k} onSaved={reload} />
                <Button size="sm" variant="ghost" className="text-rose-600" title="ລຶບ" onClick={async () => {
                  if (!(await ask(`ລຶບ ${k.name}?`))) return;
                  const r = await run(() => del<{ deactivated: boolean }>(`/deposit-kinds/${k.id}`));
                  if (r) { toast.ok(r.deactivated ? 'ເຄີຍໃຊ້ແລ້ວ ຈຶ່ງປິດໃຊ້ແທນການລຶບ' : 'ລຶບແລ້ວ'); reload(); }
                }}><Trash2 className="size-4" /></Button>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-[1fr_8rem_auto] items-end gap-2">
          <Field label="ເພີ່ມປະເພດ"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="ເຊັ່ນ ຄັງເບຍ, ຂວດ" maxLength={60} /></Field>
          <Field label="ເງິນມັດຈຳ/ໜ່ວຍ"><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
          <Button loading={busy} disabled={!f.name.trim() || !(f.amount > 0)} onClick={async () => {
            if (await run(() => post('/deposit-kinds', f), 'ເພີ່ມແລ້ວ')) { setF({ name: '', amount: 0 }); reload(); }
          }}>ເພີ່ມ</Button>
        </div>
        <p className="text-xs text-slate-500">ປ່ຽນລາຄາມີຜົນກັບການຮັບມັດຈຳຄັ້ງຕໍ່ໄປ; ການຄືນເງິນຍຶດຕາມທີ່ລູກຄ້າຈ່າຍໄວ້ແລ້ວ.</p>
      </div>
    </Modal>
  );
}

function EditAmount({ k, onSaved }: { k: Kind; onSaved: () => void }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(k.amount);
  const { busy, run } = useAction();
  if (!edit) return <><span className="tabular text-slate-600">{kip(k.amount)}</span><Button size="sm" variant="ghost" onClick={() => setEdit(true)}>ແກ້ລາຄາ</Button></>;
  return (
    <span className="flex items-center gap-1">
      <MoneyInput className="w-24!" value={v} onChange={setV} />
      <Button size="sm" loading={busy} disabled={!(v > 0)} onClick={async () => { if (await run(() => put(`/deposit-kinds/${k.id}`, { amount: v }), 'ບັນທຶກແລ້ວ')) { setEdit(false); onSaved(); } }}>ບັນທຶກ</Button>
    </span>
  );
}

// ---------------- beer stored for customers ----------------

function BeerStorage({ onSlip }: { onSlip: (s: Slip) => void }) {
  const admin = useSession((s) => can(s.user?.role, 'admin'));
  const [data, reload, loading] = useLoad(() => get<{ rows: Stored[]; totalQty: number; expired: number }>('/beer-storage'));
  const [store, setStore] = useState(false);
  const [act, setAct] = useState<{ row: Stored; kind: 'withdraw' | 'discard' } | null>(null);
  if (loading || !data) return <Spinner />;
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-slate-600">ເບຍຝາກທັງໝົດ <b className="tabular">{data.totalQty.toLocaleString('en-US')}</b> ຂວດ/ກະປ໋ອງ</span>
        {data.expired > 0 && <span className="flex items-center gap-1 text-sm text-rose-700"><AlertTriangle className="size-4" /> ໝົດອາຍຸແລ້ວ {data.expired} ລາຍການ</span>}
        <Button className="ml-auto" onClick={() => setStore(true)}><Plus className="size-4" /> ຝາກເບຍ</Button>
      </div>
      {data.rows.length === 0 ? (
        <Card><Empty>ບໍ່ມີເບຍຝາກ — ກົດ "ຝາກເບຍ" ເມື່ອລູກຄ້າດື່ມບໍ່ໝົດ</Empty></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.rows.map((s) => (
            <Card key={`${s.customer_id}-${s.item}`} className={cx('p-4', s.expired && 'border-rose-300')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{s.customer_name}</div>
                  {s.phone && <div className="text-xs text-slate-500">{s.phone}</div>}
                </div>
                {s.expired ? <Badge className="bg-rose-100 text-rose-700">ໝົດອາຍຸ</Badge> : s.next_expiry ? <Badge className="bg-slate-100 text-slate-600">ຮອດ {s.next_expiry}</Badge> : null}
              </div>
              <div className="mt-2 flex items-center gap-2 text-sm text-slate-600"><Beer className="size-4" />{s.item}</div>
              <div className="tabular mt-1 text-3xl font-bold text-brand-700">{s.qty}<span className="ml-1 text-sm font-normal text-slate-400">ຂວດ</span></div>
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-xs text-slate-500">
                <span>ຝາກຕັ້ງແຕ່ {dateTime(s.since)}</span>
                <span className="flex gap-1">
                  {admin && <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => setAct({ row: s, kind: 'discard' })}>ຖິ້ມ</Button>}
                  <Button size="sm" onClick={() => setAct({ row: s, kind: 'withdraw' })}><ArrowUpFromLine className="size-4" /> ເບີກ</Button>
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
      {store && <StoreModal onClose={() => setStore(false)} onDone={reload} onSlip={onSlip} items={[...new Set(data.rows.map((r) => r.item))]} />}
      {act && <TakeOutModal row={act.row} kind={act.kind} onClose={() => setAct(null)} onDone={reload} onSlip={onSlip} />}
    </>
  );
}

function StoreModal({ onClose, onDone, onSlip, items }: { onClose: () => void; onDone: () => void; onSlip: (s: Slip) => void; items: string[] }) {
  const staff = useSession((s) => s.user?.name ?? '');
  const [cust, setCust] = useState<Customer | null>(null);
  const [item, setItem] = useState('');
  const [qty, setQty] = useState(1);
  const [expiresOn, setExpiresOn] = useState('');
  const [note, setNote] = useState('');
  const { busy, run } = useAction();
  const save = async () => {
    const r = await run(() => post<{ id: number; item: string; qty: number }>('/beer-storage/store', { customerId: cust!.id, item, qty, expiresOn, note }), 'ຮັບຝາກເບຍແລ້ວ');
    if (r) {
      onDone();
      onClose();
      onSlip({
        title: 'ໃບຝາກເບຍ', no: `BS-${String(r.id).padStart(6, '0')}`, customer: cust!.name, phone: cust!.phone, staff, note, signatures: true,
        rows: [[r.item, `${qty} ຂວດ`], ['ຝາກໄດ້ເຖິງ', expiresOn || 'ບໍ່ກຳນົດ'], ['ຍອດຝາກລວມລາຍການນີ້', `${r.qty} ຂວດ`]],
        big: ['ຝາກໄວ້', `${qty} ຂວດ`],
      });
    }
  };
  return (
    <Modal open onClose={onClose} title="ຝາກເບຍ" footer={<Button onClick={save} loading={busy} disabled={!cust || !item.trim() || qty < 1}>ບັນທຶກການຝາກ</Button>}>
      <div className="space-y-4">
        <Field label="ລູກຄ້າ"><CustomerPicker value={cust} onPick={setCust} /></Field>
        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <Field label="ເບຍ / ເຄື່ອງດື່ມ">
            <Input value={item} onChange={(e) => setItem(e.target.value)} maxLength={80} list="stored-items" placeholder="ເຊັ່ນ ເບຍລາວ ຂວດໃຫຍ່" />
            <datalist id="stored-items">{items.map((i) => <option key={i} value={i} />)}</datalist>
          </Field>
          <Field label="ຈຳນວນ"><Input type="number" min={1} max={9999} value={qty || ''} onChange={(e) => setQty(Math.max(0, Math.round(Number(e.target.value) || 0)))} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ຝາກໄດ້ເຖິງວັນທີ (ບໍ່ບັງຄັບ)"><Input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} /></Field>
          <Field label="ໝາຍເຫດ"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></Field>
        </div>
      </div>
    </Modal>
  );
}

function TakeOutModal({ row, kind, onClose, onDone, onSlip }: { row: Stored; kind: 'withdraw' | 'discard'; onClose: () => void; onDone: () => void; onSlip: (s: Slip) => void }) {
  const staff = useSession((s) => s.user?.name ?? '');
  const [qty, setQty] = useState(kind === 'withdraw' ? Math.min(1, row.qty) : row.qty);
  const [note, setNote] = useState(kind === 'discard' ? 'ໝົດອາຍຸ' : '');
  const { busy, run } = useAction();
  const save = async () => {
    const r = await run(() => post<{ id: number; qty: number }>(`/beer-storage/${kind}`, { customerId: row.customer_id, item: row.item, qty, note }), kind === 'withdraw' ? 'ເບີກເບຍແລ້ວ' : 'ບັນທຶກການຖິ້ມແລ້ວ');
    if (r) {
      onDone();
      onClose();
      if (kind === 'withdraw') {
        onSlip({
          title: 'ໃບເບີກເບຍຝາກ', no: `BS-${String(r.id).padStart(6, '0')}`, customer: row.customer_name, phone: row.phone, staff, note, signatures: true,
          rows: [[row.item, `${qty} ຂວດ`], ['ຍັງຝາກເຫຼືອ', `${r.qty} ຂວດ`]],
          big: ['ເບີກໄປ', `${qty} ຂວດ`],
        });
      }
    }
  };
  return (
    <Modal open onClose={onClose} title={`${kind === 'withdraw' ? 'ເບີກເບຍ' : 'ຖິ້ມເບຍ'}: ${row.customer_name}`} footer={<Button onClick={save} loading={busy} disabled={qty < 1 || qty > row.qty} variant={kind === 'discard' ? 'danger' : 'primary'}>{kind === 'withdraw' ? 'ເບີກໃຫ້ລູກຄ້າ' : 'ຖິ້ມ'}</Button>}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{row.item} · ຝາກຢູ່ {row.qty}{row.expired && <span className="ml-2 text-rose-600">(ໝົດອາຍຸແລ້ວ)</span>}</p>
        <Field label="ຈຳນວນ"><Input type="number" min={1} max={row.qty} value={qty || ''} onChange={(e) => setQty(Math.min(row.qty, Math.max(0, Math.round(Number(e.target.value) || 0))))} autoFocus /></Field>
        <Field label="ໝາຍເຫດ"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></Field>
      </div>
    </Modal>
  );
}

/** After an action: show what was recorded and offer to print the slip. */
function SlipModal({ slip, onClose }: { slip: Slip; onClose: () => void }) {
  const { restaurant, branch } = useSession();
  return (
    <Modal open onClose={onClose} title={`${slip.title} · ${slip.no}`} footer={<><Button variant="secondary" onClick={onClose}>ປິດ</Button><Button onClick={() => { if (restaurant && branch) printSlip(slip, restaurant, branch); }}>ພິມໃບ</Button></>}>
      <div className="space-y-2 text-sm">
        <div className="font-semibold">{slip.customer}{slip.phone && <span className="ml-2 font-normal text-slate-500">{slip.phone}</span>}</div>
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {slip.rows.map(([k, v]) => <div key={k} className="flex justify-between gap-3 px-3 py-2"><span className="text-slate-500">{k}</span><span className="tabular font-medium">{v}</span></div>)}
          {slip.big && <div className="flex justify-between gap-3 bg-brand-50 px-3 py-2 text-base font-bold"><span>{slip.big[0]}</span><span className="tabular text-brand-700">{slip.big[1]}</span></div>}
        </div>
        <p className="text-xs text-slate-500">ບັນທຶກແລ້ວ — ກົດ "ພິມໃບ" ເພື່ອໃຫ້ລູກຄ້າເກັບໄວ້ເປັນຫຼັກຖານ (ພິມຄືນພາຍຫຼັງບໍ່ໄດ້ຈາກໜ້ານີ້)</p>
      </div>
    </Modal>
  );
}
