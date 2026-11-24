import { useState } from 'react';
import { Ban, CheckCheck, HandCoins, PackageCheck, Pencil, Phone, Plus, Send, Sparkles, Trash2 } from 'lucide-react';
import { del, get, post, put, type Ingredient } from '../lib/api';
import { dateTime, kip } from '../lib/format';
import { IngredientPicker, QuickIngredient } from './MenuAdmin';
import { Badge, Button, Card, Empty, Field, Input, Modal, MoneyInput, PageHeader, Select, Spinner, ask, cx, toast, useAction, useLoad } from '../components/ui';

interface Supplier { id: number; name: string; contact: string; phone: string; address: string; note: string; active: number; owed: number; open_orders: number; ingredients: number }
type PoStatus = 'draft' | 'ordered' | 'partial' | 'received' | 'cancelled';
interface PoLine { id: number; ingredient_id: number; name: string; unit: string; stock: number; qty: number; unit_cost: number; received_qty: number; received_value: number }
interface Po {
  id: number; po_no: number; supplier_id: number; supplier_name: string; supplier_phone: string; status: PoStatus; expected_on: string; note: string; invoice_no: string;
  created_at: string; ordered_at: string | null; received_at: string | null; total: number; received_value: number; paid: number; owed: number; line_count: number; user_name: string;
  lines?: PoLine[]; payments?: { id: number; amount: number; method: string; note: string; created_at: string; user_name: string }[];
}
interface Suggestion { supplierId: number | null; supplierName: string; lines: { ingredientId: number; name: string; unit: string; stock: number; qty: number; unitCost: number }[] }

const STATUS: Record<PoStatus, [string, string]> = {
  draft: ['ສະບັບຮ່າງ', 'bg-slate-200 text-slate-700'],
  ordered: ['ສັ່ງແລ້ວ', 'bg-sky-100 text-sky-800'],
  partial: ['ໄດ້ບາງສ່ວນ', 'bg-amber-100 text-amber-800'],
  received: ['ຮັບຄົບ', 'bg-emerald-100 text-emerald-800'],
  cancelled: ['ຍົກເລີກ', 'bg-rose-100 text-rose-700'],
};
const poCode = (n: number) => `PO-${String(n).padStart(4, '0')}`;

export default function Purchasing() {
  const [tab, setTab] = useState<'po' | 'sup'>('po');
  return (
    <div className="space-y-4 p-4 lg:p-6">
      <PageHeader title="ຈັດຊື້ / ຜູ້ສະໜອງ" sub="ສັ່ງຊື້ວັດຖຸດິບ ຮັບເຄື່ອງເຂົ້າສະຕັອກ ແລະ ຕິດຕາມຍອດຄ້າງຈ່າຍ" />
      <div className="flex gap-1 rounded-lg bg-white p-1 shadow-sm w-fit">
        {([['po', 'ໃບສັ່ງຊື້'], ['sup', 'ຜູ້ສະໜອງ']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cx('rounded-md px-4 py-1.5 text-sm', tab === k ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')}>{l}</button>
        ))}
      </div>
      {tab === 'po' ? <Orders /> : <Suppliers />}
    </div>
  );
}

// ---------------- purchase orders ----------------

function Orders() {
  const [filter, setFilter] = useState<'open' | 'received' | 'cancelled' | ''>('open');
  const [list, reload, loading] = useLoad(() => get<Po[]>(`/purchase-orders${filter ? `?status=${filter}` : ''}`), [filter]);
  const [edit, setEdit] = useState<{ po?: Po; seed?: { supplierId: number; lines: EditLine[] } } | null>(null);
  const [view, setView] = useState<number | null>(null);
  const [sugg, setSugg] = useState<Suggestion[] | null>(null);
  const { run } = useAction();

  const suggest = async () => {
    const s = await run(() => get<Suggestion[]>('/purchase-orders/suggest'));
    if (!s) return;
    if (!s.length) toast.ok('ບໍ່ມີວັດຖຸດິບທີ່ຕ້ອງສັ່ງເພີ່ມ (ຕັ້ງ "ເຕີມໃຫ້ເຖິງ" ໃນສະຕັອກ)');
    else setSugg(s);
  };
  const owed = (list ?? []).reduce((s, p) => s + p.owed, 0);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {([['open', 'ຄ້າງຢູ່'], ['received', 'ຮັບຄົບແລ້ວ'], ['cancelled', 'ຍົກເລີກ'], ['', 'ທັງໝົດ']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} className={cx('rounded-full border px-3 py-1 text-sm', filter === k ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-300 bg-white text-slate-600')}>{l}</button>
          ))}
        </div>
        {owed > 0 && <span className="text-sm text-amber-700">ຄ້າງຈ່າຍໃນລາຍການນີ້ {kip(owed)}</span>}
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={suggest}><Sparkles className="size-4" /> ແນະນຳຈາກສະຕັອກ</Button>
          <Button onClick={() => setEdit({})}><Plus className="size-4" /> ສ້າງໃບສັ່ງຊື້</Button>
        </div>
      </div>
      {loading || !list ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Card><Empty>ບໍ່ມີໃບສັ່ງຊື້ — ກົດ "ແນະນຳຈາກສະຕັອກ" ຫຼື "ສ້າງໃບສັ່ງຊື້"</Empty></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => {
            const [label, color] = STATUS[p.status];
            return (
              <Card key={p.id} className="cursor-pointer p-4 hover:border-brand-400" >
                <button className="block w-full text-left" onClick={() => setView(p.id)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono text-sm text-slate-500">{poCode(p.po_no)}</div>
                      <div className="truncate font-semibold">{p.supplier_name}</div>
                    </div>
                    <Badge className={color}>{label}</Badge>
                  </div>
                  <div className="tabular mt-2 text-xl font-bold text-brand-700">{kip(p.total)}</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500">
                    <span>{p.line_count} ລາຍການ</span>
                    <span>ສ້າງ {dateTime(p.created_at)}</span>
                    {p.expected_on && p.status !== 'received' && p.status !== 'cancelled' && <span>ຄາດວ່າຮັບ {p.expected_on}</span>}
                  </div>
                  {p.owed > 0 && <div className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800">ຄ້າງຈ່າຍ {kip(p.owed)}</div>}
                </button>
              </Card>
            );
          })}
        </div>
      )}
      {sugg && (
        <Modal open onClose={() => setSugg(null)} title="ໃບສັ່ງຊື້ແນະນຳ (ວັດຖຸດິບທີ່ໃກ້ໝົດ)">
          <div className="space-y-3">
            {sugg.map((g) => (
              <Card key={g.supplierId ?? 0} className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold">{g.supplierId ? g.supplierName : 'ຍັງບໍ່ລະບຸຜູ້ສະໜອງ'}</div>
                  <Button size="sm" onClick={() => { setSugg(null); setEdit({ seed: { supplierId: g.supplierId ?? 0, lines: g.lines.map((l) => ({ ingredientId: l.ingredientId, qty: l.qty, unitCost: l.unitCost })) } }); }}>ສ້າງໃບສັ່ງຊື້</Button>
                </div>
                <ul className="mt-2 space-y-0.5 text-sm text-slate-600">
                  {g.lines.map((l) => <li key={l.ingredientId} className="flex justify-between gap-2"><span>{l.name} <span className="text-xs text-slate-400">(ເຫຼືອ {l.stock})</span></span><span className="tabular">{l.qty} {l.unit}</span></li>)}
                </ul>
              </Card>
            ))}
          </div>
        </Modal>
      )}
      {edit && <PoModal po={edit.po} seed={edit.seed} onClose={() => setEdit(null)} onSaved={(id) => { reload(); setView(id); }} />}
      {view && <PoDetail id={view} onClose={() => setView(null)} onChanged={reload} onEdit={(po) => { setView(null); setEdit({ po }); }} />}
    </>
  );
}

interface EditLine { ingredientId: number; qty: number; unitCost: number }

function PoModal({ po, seed, onClose, onSaved }: { po?: Po; seed?: { supplierId: number; lines: EditLine[] }; onClose: () => void; onSaved: (id: number) => void }) {
  const [suppliers] = useLoad(() => get<Supplier[]>('/suppliers'));
  const [ings, reloadIngs] = useLoad(() => get<Ingredient[]>('/ingredients'));
  const [creating, setCreating] = useState(false);
  const [supplierId, setSupplierId] = useState(po?.supplier_id ?? seed?.supplierId ?? 0);
  const [expectedOn, setExpectedOn] = useState(po?.expected_on ?? '');
  const [note, setNote] = useState(po?.note ?? '');
  const [lines, setLines] = useState<EditLine[]>(seed?.lines ?? po?.lines?.map((l) => ({ ingredientId: l.ingredient_id, qty: l.qty, unitCost: l.unit_cost })) ?? []);
  const { busy, run } = useAction();
  const byId = new Map((ings ?? []).map((i) => [i.id, i]));
  const total = lines.reduce((s, l) => s + l.qty * l.unitCost, 0);
  const setLine = (i: number, v: Partial<EditLine>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...v } : l)));

  const add = (id: number) => {
    const ing = byId.get(id);
    if (!ing || lines.some((l) => l.ingredientId === id)) return;
    setLines([...lines, { ingredientId: id, qty: ing.suggest > 0 ? ing.suggest : 1, unitCost: ing.cost }]);
  };
  const save = async () => {
    const body = { supplierId, expectedOn, note, lines };
    const r = await run(() => (po ? put<Po>(`/purchase-orders/${po.id}`, body) : post<Po>('/purchase-orders', body)), 'ບັນທຶກແລ້ວ');
    if (r) {
      onSaved(r.id);
      onClose();
    }
  };
  const available = (ings ?? []).filter((i) => i.active && !lines.some((l) => l.ingredientId === i.id));

  return (
    <Modal open onClose={onClose} title={po ? `ແກ້ໄຂ ${poCode(po.po_no)}` : 'ໃບສັ່ງຊື້ໃໝ່'} footer={<Button onClick={save} loading={busy} disabled={!supplierId || !lines.length || lines.some((l) => !(l.qty > 0))}>ບັນທຶກເປັນສະບັບຮ່າງ</Button>}>
      <div className="space-y-4">
        <Field label="ຜູ້ສະໜອງ">
          <Select value={supplierId} onChange={(e) => setSupplierId(Number(e.target.value))}>
            <option value={0}>— ເລືອກຜູ້ສະໜອງ —</option>
            {(suppliers ?? []).filter((s) => s.active || s.id === supplierId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ຄາດວ່າຈະໄດ້ຮັບ"><Input type="date" value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} /></Field>
          <Field label="ໝາຍເຫດ"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></Field>
        </div>
        <div>
          <div className="mb-1 text-sm font-medium">ລາຍການ</div>
          <div className="space-y-2">
            {lines.map((l, i) => {
              const ing = byId.get(l.ingredientId);
              return (
                <div key={l.ingredientId} className="grid grid-cols-[1fr_5rem_7rem_2rem] items-center gap-2">
                  <div className="min-w-0 truncate text-sm">{ing?.name ?? '…'}<span className="text-xs text-slate-400"> ({ing?.unit}, ເຫຼືອ {ing?.stock})</span></div>
                  <Input type="number" min={0} step="any" value={l.qty || ''} onChange={(e) => setLine(i, { qty: Number(e.target.value) || 0 })} aria-label="ຈຳນວນ" />
                  <MoneyInput value={l.unitCost} onChange={(v) => setLine(i, { unitCost: v })} aria-label="ລາຄາ" />
                  <button className="text-rose-500" onClick={() => setLines(lines.filter((_, k) => k !== i))} aria-label="ລຶບ"><Trash2 className="size-4" /></button>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex">
            <IngredientPicker inline value={0} ings={available} onPick={add} onCreate={() => setCreating(true)} placeholder="+ ເພີ່ມວັດຖຸດິບ (ຄົ້ນຫາ ຫຼື ສ້າງໃໝ່)…" />
          </div>
        </div>
        {creating && (
          <QuickIngredient
            cta="ສ້າງ ແລະ ເພີ່ມໃນໃບສັ່ງຊື້"
            onClose={() => setCreating(false)}
            onCreated={async (ing) => {
              await reloadIngs();
              setLines((cur) => [...cur, { ingredientId: ing.id, qty: 1, unitCost: ing.cost }]);
              setCreating(false);
            }}
          />
        )}
        <div className="flex justify-between border-t border-slate-100 pt-3 text-sm"><span className="text-slate-500">ລວມປະມານ</span><b className="tabular text-lg">{kip(total)}</b></div>
      </div>
    </Modal>
  );
}

function PoDetail({ id, onClose, onChanged, onEdit }: { id: number; onClose: () => void; onChanged: () => void; onEdit: (po: Po) => void }) {
  const [po, reload, loading] = useLoad(() => get<Po>(`/purchase-orders/${id}`), [id]);
  const [recv, setRecv] = useState<Record<number, { qty: number; unitCost: number; lot: string; expiresAt: string }> | null>(null);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [payAmt, setPayAmt] = useState(0);
  const [payMethod, setPayMethod] = useState<'cash' | 'transfer'>('cash');
  const { busy, run } = useAction();
  if (loading || !po) return <Modal open onClose={onClose} title="ໃບສັ່ງຊື້"><Spinner /></Modal>;
  const lines = po.lines ?? [];
  const [label, color] = STATUS[po.status];

  const act = async (path: string, body: unknown = {}, okText?: string) => {
    if (await run(() => post(`/purchase-orders/${id}/${path}`, body), okText)) {
      await reload();
      onChanged();
      return true;
    }
    return false;
  };
  const startReceive = () => setRecv(Object.fromEntries(lines.filter((l) => l.qty - l.received_qty > 0.0005).map((l) => [l.id, { qty: Math.round((l.qty - l.received_qty) * 1000) / 1000, unitCost: l.unit_cost, lot: '', expiresAt: '' }])));
  const confirmReceive = async () => {
    const body = { invoiceNo, lines: Object.entries(recv ?? {}).map(([lineId, v]) => ({ lineId: Number(lineId), ...v, expiresAt: v.expiresAt || undefined })) };
    if (await act('receive', body, 'ຮັບເຄື່ອງເຂົ້າສະຕັອກແລ້ວ')) setRecv(null);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`${poCode(po.po_no)} · ${po.supplier_name}`}
      footer={
        recv ? (
          <>
            <Button variant="ghost" onClick={() => setRecv(null)}>ຍົກເລີກ</Button>
            <Button onClick={confirmReceive} loading={busy}><PackageCheck className="size-4" /> ຢືນຢັນຮັບເຄື່ອງ</Button>
          </>
        ) : (
          <>
            {(po.status === 'draft' || po.status === 'ordered') && (
              <Button variant="ghost" className="mr-auto text-rose-600" onClick={async () => { if (await ask(`ຍົກເລີກ ${poCode(po.po_no)}?`)) await act('cancel', {}, 'ຍົກເລີກແລ້ວ'); }}><Ban className="size-4" /> ຍົກເລີກ</Button>
            )}
            {po.status === 'draft' && <Button variant="secondary" onClick={() => onEdit(po)}><Pencil className="size-4" /> ແກ້ໄຂ</Button>}
            {po.status === 'draft' && <Button onClick={() => act('order', {}, 'ສັ່ງຊື້ແລ້ວ')} loading={busy}><Send className="size-4" /> ສັ່ງຊື້</Button>}
            {(po.status === 'ordered' || po.status === 'partial') && <Button onClick={startReceive}><PackageCheck className="size-4" /> ຮັບເຄື່ອງ</Button>}
            {po.status === 'partial' && <Button variant="secondary" onClick={async () => { if (await ask('ປິດໃບສັ່ງຊື້ນີ້ (ຜູ້ສະໜອງບໍ່ສົ່ງສ່ວນທີ່ເຫຼືອ)?')) await act('close', {}, 'ປິດແລ້ວ'); }}><CheckCheck className="size-4" /> ປິດ (ບໍ່ຮັບເພີ່ມ)</Button>}
          </>
        )
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <Badge className={color}>{label}</Badge>
          <span>ສ້າງ {dateTime(po.created_at)} ໂດຍ {po.user_name}</span>
          {po.supplier_phone && <span className="flex items-center gap-1"><Phone className="size-3" />{po.supplier_phone}</span>}
          {po.expected_on && <span>ຄາດວ່າຮັບ {po.expected_on}</span>}
          {po.invoice_no && <span>ໃບສົ່ງເຄື່ອງ {po.invoice_no}</span>}
        </div>
        {po.note && <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">{po.note}</div>}

        {recv && (
          <Field label="ເລກໃບສົ່ງເຄື່ອງ / ໃບແຈ້ງໜີ້ (ບໍ່ບັງຄັບ)"><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} maxLength={40} /></Field>
        )}
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {lines.map((l) => {
            const left = Math.round((l.qty - l.received_qty) * 1000) / 1000;
            const r = recv?.[l.id];
            return (
              <div key={l.id} className="p-3 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{l.name}</span>
                  <span className="tabular text-slate-500">{l.qty} {l.unit} × {kip(l.unit_cost)}</span>
                </div>
                <div className="mt-0.5 flex justify-between text-xs text-slate-500">
                  <span>ໄດ້ຮັບແລ້ວ {l.received_qty}/{l.qty} · ສະຕັອກ {l.stock}</span>
                  <span className="tabular">{kip(l.qty * l.unit_cost)}</span>
                </div>
                {r && (
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Field label={`ຮັບ (ເຫຼືອ ${left})`}><Input type="number" min={0} max={left} step="any" value={r.qty || ''} onChange={(e) => setRecv({ ...recv!, [l.id]: { ...r, qty: Number(e.target.value) || 0 } })} /></Field>
                    <Field label="ລາຄາຈິງ/ຫົວໜ່ວຍ"><MoneyInput value={r.unitCost} onChange={(v) => setRecv({ ...recv!, [l.id]: { ...r, unitCost: v } })} /></Field>
                    <Field label="ລັອດ"><Input value={r.lot} onChange={(e) => setRecv({ ...recv!, [l.id]: { ...r, lot: e.target.value } })} maxLength={40} /></Field>
                    <Field label="ໝົດອາຍຸ"><Input type="date" value={r.expiresAt} onChange={(e) => setRecv({ ...recv!, [l.id]: { ...r, expiresAt: e.target.value } })} /></Field>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-slate-500">ຍອດສັ່ງ</span><span className="tabular">{kip(po.total)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">ມູນຄ່າທີ່ຮັບແລ້ວ</span><span className="tabular">{kip(po.received_value)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">ຈ່າຍແລ້ວ</span><span className="tabular">{kip(po.paid)}</span></div>
          <div className="flex justify-between font-semibold"><span>ຄ້າງຈ່າຍ</span><span className={cx('tabular', po.owed > 0 && 'text-amber-700')}>{kip(po.owed)}</span></div>
        </div>

        {po.owed > 0 && !recv && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-amber-900"><HandCoins className="size-4" /> ຈ່າຍເງິນຜູ້ສະໜອງ</div>
            <div className="grid grid-cols-[1fr_7rem_auto] gap-2">
              <MoneyInput value={payAmt} onChange={setPayAmt} placeholder="ຈຳນວນເງິນ" />
              <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value as 'cash' | 'transfer')}><option value="cash">ເງິນສົດ</option><option value="transfer">ໂອນ</option></Select>
              <Button disabled={!(payAmt > 0)} loading={busy} onClick={async () => { if (await act('payments', { amount: payAmt, method: payMethod }, 'ບັນທຶກການຈ່າຍແລ້ວ')) setPayAmt(0); }}>ບັນທຶກ</Button>
            </div>
            <button className="mt-1 text-xs text-amber-800 underline" onClick={() => setPayAmt(po.owed)}>ຈ່າຍເຕັມຍອດຄ້າງ ({kip(po.owed)})</button>
            <p className="mt-1 text-xs text-amber-700">ບັນທຶກເພື່ອຕິດຕາມໜີ້ເທົ່ານັ້ນ — ບໍ່ຫັກອອກຈາກລິ້ນຊັກເງິນ</p>
          </div>
        )}
        {!!po.payments?.length && (
          <div className="text-xs text-slate-500">
            {po.payments.map((p) => <div key={p.id} className="flex justify-between"><span>{dateTime(p.created_at)} · {p.method === 'cash' ? 'ເງິນສົດ' : 'ໂອນ'} · {p.user_name}</span><span className="tabular">{kip(p.amount)}</span></div>)}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------- suppliers ----------------

function Suppliers() {
  const [list, reload, loading] = useLoad(() => get<Supplier[]>('/suppliers'));
  const [edit, setEdit] = useState<Partial<Supplier> | null>(null);
  const { run } = useAction();
  if (loading || !list) return <Spinner />;
  const owed = list.reduce((s, x) => s + Math.max(x.owed, 0), 0);
  return (
    <>
      <div className="flex items-center gap-3">
        {owed > 0 && <span className="text-sm text-amber-700">ຄ້າງຈ່າຍທຸກຜູ້ສະໜອງ {kip(owed)}</span>}
        <Button className="ml-auto" onClick={() => setEdit({ name: '', contact: '', phone: '', address: '', note: '', active: 1 })}><Plus className="size-4" /> ເພີ່ມຜູ້ສະໜອງ</Button>
      </div>
      {list.length === 0 ? (
        <Card><Empty>ຍັງບໍ່ມີຜູ້ສະໜອງ — ກົດ "ເພີ່ມຜູ້ສະໜອງ"</Empty></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((s) => (
            <Card key={s.id} className={cx('p-4', !s.active && 'opacity-60')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{s.name}</div>
                  {s.contact && <div className="text-xs text-slate-500">{s.contact}</div>}
                </div>
                {!s.active && <Badge className="bg-slate-200 text-slate-600">ປິດໃຊ້</Badge>}
              </div>
              <div className="mt-2 space-y-0.5 text-sm text-slate-600">
                {s.phone && <div className="flex items-center gap-1"><Phone className="size-3.5" />{s.phone}</div>}
                {s.address && <div className="text-xs text-slate-500">{s.address}</div>}
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-500">
                <span>{s.ingredients} ວັດຖຸດິບ · ຄ້າງສັ່ງ {s.open_orders}</span>
                <span className={cx('tabular', s.owed > 0 && 'font-semibold text-amber-700')}>{s.owed > 0 ? `ຄ້າງຈ່າຍ ${kip(s.owed)}` : 'ບໍ່ມີຍອດຄ້າງ'}</span>
                <Button size="sm" variant="ghost" onClick={() => setEdit(s)} title="ແກ້ໄຂ"><Pencil className="size-4" /></Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {edit && (
        <SupplierModal
          s={edit}
          onClose={() => setEdit(null)}
          onSaved={reload}
          onDelete={
            edit.id
              ? async () => {
                  if (!(await ask(`ລຶບ ${edit.name}?`))) return;
                  const r = await run(() => del<{ deactivated: boolean }>(`/suppliers/${edit.id}`));
                  if (r) {
                    toast.ok(r.deactivated ? 'ເຄີຍມີໃບສັ່ງຊື້ ຈຶ່ງປິດໃຊ້ແທນການລຶບ' : 'ລຶບແລ້ວ');
                    setEdit(null);
                    reload();
                  }
                }
              : undefined
          }
        />
      )}
    </>
  );
}

function SupplierModal({ s, onClose, onSaved, onDelete }: { s: Partial<Supplier>; onClose: () => void; onSaved: () => void; onDelete?: () => void }) {
  const [f, setF] = useState(s);
  const { busy, run } = useAction();
  const save = async () => {
    const body = { name: f.name, contact: f.contact, phone: f.phone, address: f.address, note: f.note, active: !!f.active };
    if (await run(() => (s.id ? put(`/suppliers/${s.id}`, body) : post('/suppliers', body)), 'ບັນທຶກແລ້ວ')) {
      onSaved();
      onClose();
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={s.id ? 'ແກ້ໄຂຜູ້ສະໜອງ' : 'ຜູ້ສະໜອງໃໝ່'}
      footer={
        <>
          {onDelete && <Button variant="ghost" className="mr-auto text-rose-600" onClick={onDelete}><Trash2 className="size-4" /> ລຶບ</Button>}
          <Button onClick={save} loading={busy} disabled={!f.name?.trim()}>ບັນທຶກ</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="ຊື່ຜູ້ສະໜອງ / ຮ້ານ"><Input value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus maxLength={80} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ຜູ້ຕິດຕໍ່"><Input value={f.contact ?? ''} onChange={(e) => setF({ ...f, contact: e.target.value })} maxLength={80} /></Field>
          <Field label="ເບີໂທ"><Input value={f.phone ?? ''} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={30} inputMode="tel" /></Field>
        </div>
        <Field label="ທີ່ຢູ່"><Input value={f.address ?? ''} onChange={(e) => setF({ ...f, address: e.target.value })} maxLength={200} /></Field>
        <Field label="ໝາຍເຫດ"><Input value={f.note ?? ''} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={300} placeholder="ເຊັ່ນ ສົ່ງທຸກເຊົ້າວັນຈັນ-ພະຫັດ" /></Field>
        {s.id && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-brand-600" checked={!!f.active} onChange={(e) => setF({ ...f, active: e.target.checked ? 1 : 0 })} /> ເປີດໃຊ້ງານ
          </label>
        )}
      </div>
    </Modal>
  );
}
