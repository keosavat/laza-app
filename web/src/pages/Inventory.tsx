import { useState } from 'react';
import { AlertTriangle, ArrowDownToLine, ClipboardCheck, Pencil, Plus, Trash2 } from 'lucide-react';
import { del, get, post, put, type Ingredient, type StockMove } from '../lib/api';
import { useSync } from '../lib/store';
import { dateTime, kip } from '../lib/format';
import { Download } from 'lucide-react';
import { Badge, Button, Card, Empty, Field, Input, Modal, MoneyInput, PageHeader, Select, Spinner, cx, toast, useAction, useLoad , ask } from '../components/ui';

const MOVE: Record<StockMove['type'], [string, string]> = {
  in: ['ຮັບເຂົ້າ', 'bg-emerald-100 text-emerald-800'],
  adjust: ['ນັບສະຕັອກ', 'bg-sky-100 text-sky-800'],
  waste: ['ເສຍຫາຍ', 'bg-rose-100 text-rose-700'],
  sale: ['ຂາຍອອກ', 'bg-slate-200 text-slate-700'],
};
const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString('en-US');

export default function Inventory() {
  const [tab, setTab] = useState<'stock' | 'moves'>('stock');
  const [items, reload, loading] = useLoad(() => get<Ingredient[]>('/ingredients'));
  const [moves, reloadMoves] = useLoad(() => get<StockMove[]>('/stock/moves'));
  const [edit, setEdit] = useState<Partial<Ingredient> | null>(null);
  const [stockFor, setStockFor] = useState<{ ing: Ingredient; type: 'in' | 'adjust' | 'waste' } | null>(null);
  const [onlyLow, setOnlyLow] = useState(false);
  const [showOff, setShowOff] = useState(false);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [sum] = useLoad(() => get<{ missingRecipe: { id: number; name: string }[]; menuTotal: number }>('/inventory/summary'));
  const [showMissing, setShowMissing] = useState(false);
  const { run } = useAction();
  const remove = async (i: Ingredient) => {
    if (i.used_in > 0) return toast.err(`${i.name} ຢູ່ໃນສູດຂອງ ${i.used_in} ເມນູ — ເອົາອອກຈາກສູດກ່ອນ ຈຶ່ງລຶບໄດ້`);
    if (!(await ask(`ລຶບ ${i.name}?${i.stock > 0 ? `\nຍັງມີສະຕັອກ ${i.stock} ${i.unit} ຢູ່` : ''}`))) return;
    const r = await run(() => del<{ deactivated: boolean }>(`/ingredients/${i.id}`));
    if (r) {
      toast.ok(r.deactivated ? 'ມີປະຫວັດແລ້ວ ຈຶ່ງປິດໃຊ້ແທນການລຶບ' : 'ລຶບແລ້ວ');
      setEdit(null);
      refresh();
    }
  };
  const refresh = () => {
    reload();
    reloadMoves();
  };
  useSync(['menu', 'orders'], refresh);

  if (loading || !items) return <Spinner />;
  const cats = [...new Set(items.map((i) => i.category).filter(Boolean))].sort();
  const inactiveCount = items.filter((i) => !i.active).length;
  const shown = items.filter((i) => (showOff || i.active) && (!onlyLow || i.low) && (!cat || i.category === cat) && (!q.trim() || i.name.toLowerCase().includes(q.trim().toLowerCase())));
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const toBuy = items.filter((i) => i.suggest > 0);
  const exportCsv = () => {
    const rows = [['ຊື່', 'ໝວດ', 'ຫົວໜ່ວຍ', 'ສະຕັອກ', 'ເຕືອນເມື່ອເຫຼືອ', 'ເຕີມໃຫ້ເຖິງ', 'ຕົ້ນທຶນ/ຫົວໜ່ວຍ', 'ມູນຄ່າ'], ...items.map((i) => [i.name, i.category, i.unit, i.stock, i.low_at, i.refill_to, i.cost, i.value])];
    const csv = '\ufeff' + rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'stock-' + today + '.csv';
    a.click();
  };
  const lowCount = items.filter((i) => i.low).length;
  const value = items.reduce((s, i) => s + i.value, 0);

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <PageHeader
        title="ສະຕັອກ ແລະ ວັດຖຸດິບ"
        sub="ຂາຍແລ້ວຕັດສະຕັອກອັດຕະໂນມັດຕາມສູດອາຫານ (ຕັ້ງສູດໃນ ເມນູອາຫານ → ແກ້ໄຂເມນູ)"
        actions={
          <>
            <Button variant="secondary" onClick={exportCsv}><Download className="size-4" /> Excel (CSV)</Button>
            <Button onClick={() => setEdit({ name: '', unit: 'ກຣາມ', cost: 0, low_at: 0, active: 1 })}>
              <Plus className="size-4" /> ເພີ່ມວັດຖຸດິບ
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="ວັດຖຸດິບທັງໝົດ" value={String(items.filter((i) => i.active).length)} />
        <Stat label="ໃກ້ໝົດ / ໝົດ" value={String(lowCount)} bad={lowCount > 0} />
        <Stat label="ມູນຄ່າສະຕັອກ" value={kip(value)} />
        <Stat label="ການເຄື່ອນໄຫວວັນນີ້" value={String((moves ?? []).filter((m) => m.created_at.slice(0, 10) === new Date().toISOString().slice(0, 10)).length)} />
      </div>

      {sum && sum.menuTotal > 0 && sum.missingRecipe.length > 0 && (
        <Card className="border-sky-200 bg-sky-50 p-3 text-sm">
          <button onClick={() => setShowMissing(!showMissing)} className="flex w-full items-center justify-between gap-3 text-left">
            <span><b>{sum.menuTotal - sum.missingRecipe.length}/{sum.menuTotal}</b> ເມນູມີສູດອາຫານແລ້ວ — ອີກ {sum.missingRecipe.length} ເມນູຍັງບໍ່ມີສູດ (ຍັງບໍ່ຕັດສະຕັອກ / ບໍ່ຄິດຕົ້ນທຶນອັດຕະໂນມັດ)</span>
            <span className="shrink-0 text-sky-700 underline">{showMissing ? 'ເຊື່ອງ' : 'ເບິ່ງ'}</span>
          </button>
          {showMissing && <div className="mt-2 flex flex-wrap gap-1.5">{sum.missingRecipe.map((m) => <span key={m.id} className="rounded-full bg-white px-2.5 py-0.5">{m.name}</span>)}</div>}
        </Card>
      )}
      {toBuy.length > 0 && (
        <Card className="border-amber-300 bg-amber-50 p-3 text-sm">
          <div className="mb-1 font-semibold text-amber-900">ລາຍການທີ່ຄວນສັ່ງຊື້ ({toBuy.length})</div>
          <div className="flex flex-wrap gap-1.5">
            {toBuy.map((i) => (
              <span key={i.id} className="rounded-full bg-white px-2.5 py-0.5">
                {i.name}: <b>{fmt(i.suggest)} {i.unit}</b>
                {i.pack_size > 0 && <span className="text-slate-500"> (≈ {Math.ceil(i.suggest / i.pack_size)} {i.pack_name})</span>}
              </span>
            ))}
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(['stock', 'moves'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx('rounded-lg px-4 py-2 text-sm font-medium', tab === t ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 shadow-sm')}>
            {t === 'stock' ? 'ວັດຖຸດິບ' : 'ປະຫວັດສະຕັອກ'}
          </button>
        ))}
        {tab === 'stock' && (
          <>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ຄົ້ນຫາ..." className="ml-auto w-44" />
            {cats.length > 0 && (
              <Select value={cat} onChange={(e) => setCat(e.target.value)} className="w-36">
                <option value="">ທຸກໝວດ</option>
                {cats.map((c) => <option key={c}>{c}</option>)}
              </Select>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-brand-600" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> ສະເພາະໃກ້ໝົດ
            </label>
            {inactiveCount > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-brand-600" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} /> ສະແດງທີ່ປິດໃຊ້ ({inactiveCount})
              </label>
            )}
          </>
        )}
      </div>

      {tab === 'stock' ? (
        <Card className="overflow-x-auto">
          {shown.length === 0 ? (
            <Empty>{items.length ? 'ບໍ່ມີລາຍການໃກ້ໝົດ' : 'ຍັງບໍ່ມີວັດຖຸດິບ — ກົດ "ເພີ່ມວັດຖຸດິບ" (ເຊັ່ນ ຊີ້ນງົວ, ເສັ້ນເຝີ, ເບຍລາວ 1 ຂວດ)'}</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">ວັດຖຸດິບ</th>
                  <th className="px-4 py-2 text-right font-medium">ສະຕັອກ</th>
                  <th className="px-4 py-2 text-right font-medium">ເຕືອນເມື່ອເຫຼືອ</th>
                  <th className="px-4 py-2 text-right font-medium">ຕົ້ນທຶນ/ຫົວໜ່ວຍ</th>
                  <th className="px-4 py-2 text-right font-medium">ມູນຄ່າ</th>
                  <th className="px-4 py-2 font-medium">ໃຊ້ໃນ</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((i) => (
                  <tr key={i.id} className={cx(!i.active && 'opacity-50')}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{i.name}{i.category && <span className="ml-2 text-xs font-normal text-slate-400">{i.category}</span>}</div>
                      {i.next_expiry && (
                        <div className={cx('text-xs', i.next_expiry < today ? 'font-semibold text-rose-600' : i.next_expiry <= soon ? 'text-amber-600' : 'text-slate-400')}>
                          {i.next_expiry < today ? 'ມີລັອດໝົດອາຍຸແລ້ວ' : 'ໝົດອາຍຸໃກ້ສຸດ'} {i.next_expiry}
                        </div>
                      )}
                      {!i.active && <Badge className="bg-slate-200 text-slate-600">ປິດໃຊ້</Badge>}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={cx('tabular font-semibold', i.out ? 'text-rose-600' : i.low ? 'text-amber-600' : '')}>{fmt(i.stock)}</span> <span className="text-slate-400">{i.unit}</span>
                      {i.low && (
                        <div className={cx('flex items-center justify-end gap-1 text-xs', i.out ? 'text-rose-600' : 'text-amber-600')}>
                          <AlertTriangle className="size-3" />
                          {i.out ? 'ໝົດ' : 'ໃກ້ໝົດ'}
                        </div>
                      )}
                    </td>
                    <td className="tabular px-4 py-2.5 text-right text-slate-500">{fmt(i.low_at)}</td>
                    <td className="tabular px-4 py-2.5 text-right">{kip(i.cost)}</td>
                    <td className="tabular px-4 py-2.5 text-right">{kip(i.value)}</td>
                    <td className="px-4 py-2.5 text-slate-500">{i.used_in ? `${i.used_in} ເມນູ` : '—'}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="secondary" onClick={() => setStockFor({ ing: i, type: 'in' })}><ArrowDownToLine className="size-4" /> ຮັບເຂົ້າ</Button>
                        <Button size="sm" variant="ghost" onClick={() => setStockFor({ ing: i, type: 'adjust' })} title="ນັບສະຕັອກ"><ClipboardCheck className="size-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => setEdit(i)} title="ແກ້ໄຂ"><Pencil className="size-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => remove(i)} title="ລຶບ" className="text-rose-500!"><Trash2 className="size-4" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          {!moves?.length ? (
            <Empty>ຍັງບໍ່ມີການເຄື່ອນໄຫວ</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">ເວລາ</th>
                  <th className="px-4 py-2 font-medium">ວັດຖຸດິບ</th>
                  <th className="px-4 py-2 font-medium">ປະເພດ</th>
                  <th className="px-4 py-2 text-right font-medium">ຈຳນວນ</th>
                  <th className="px-4 py-2 text-right font-medium">ຄົງເຫຼືອ</th>
                  <th className="px-4 py-2 font-medium">ໝາຍເຫດ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {moves.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-2 text-slate-500">{dateTime(m.created_at)}</td>
                    <td className="px-4 py-2 font-medium">{m.ingredient_name}</td>
                    <td className="px-4 py-2"><Badge className={MOVE[m.type][1]}>{MOVE[m.type][0]}</Badge></td>
                    <td className={cx('tabular px-4 py-2 text-right font-medium', m.qty < 0 ? 'text-rose-600' : 'text-emerald-700')}>{m.qty > 0 ? '+' : ''}{fmt(m.qty)} {m.unit}</td>
                    <td className="tabular px-4 py-2 text-right">{fmt(m.balance)}</td>
                    <td className="px-4 py-2 text-slate-500">{m.note}{m.lot ? ` · ລັອດ ${m.lot}` : ''}{m.expires_at ? ` · ໝົດອາຍຸ ${m.expires_at}` : ''}{m.user_name ? ` · ${m.user_name}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {edit && (
        <IngredientModal
          ing={edit}
          onClose={() => setEdit(null)}
          onSaved={refresh}
          onDelete={edit.id ? () => remove(edit as Ingredient) : undefined}
        />
      )}
      {stockFor && <StockModal ing={stockFor.ing} type={stockFor.type} onClose={() => setStockFor(null)} onSaved={refresh} />}
    </div>
  );
}

function Stat({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className={cx('rounded-xl border p-4 shadow-sm', bad ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white')}>
      <div className="text-sm text-slate-500">{label}</div>
      <div className="tabular mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}

function IngredientModal({ ing, onClose, onSaved, onDelete }: { ing: Partial<Ingredient>; onClose: () => void; onSaved: () => void; onDelete?: () => void }) {
  const [f, setF] = useState({ name: ing.name ?? '', unit: ing.unit ?? 'ກຣາມ', cost: ing.cost ?? 0, lowAt: ing.low_at ?? 0, refillTo: ing.refill_to ?? 0, category: ing.category ?? '', packName: ing.pack_name ?? '', packSize: ing.pack_size ?? 0, stock: 0, active: ing.active !== 0, supplierId: ing.supplier_id ?? 0 });
  const [suppliers] = useLoad(() => get<{ id: number; name: string; active: number }[]>('/suppliers'));
  const { busy, run } = useAction();
  const save = async () => {
    const body = ing.id ? { name: f.name, unit: f.unit, cost: f.cost, lowAt: f.lowAt, refillTo: f.refillTo, category: f.category, packName: f.packName, packSize: f.packSize, active: f.active, supplierId: f.supplierId || null } : { ...f, supplierId: f.supplierId || null };
    if (await run(() => (ing.id ? put(`/ingredients/${ing.id}`, body) : post('/ingredients', body)), 'ບັນທຶກແລ້ວ')) {
      onSaved();
      onClose();
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={ing.id ? 'ແກ້ໄຂວັດຖຸດິບ' : 'ວັດຖຸດິບໃໝ່'}
      footer={
        <>
          {onDelete && <Button variant="ghost" className="mr-auto text-rose-600" onClick={onDelete}><Trash2 className="size-4" /> ລຶບ</Button>}
          <Button onClick={save} loading={busy} disabled={!f.name.trim() || !f.unit.trim()}>ບັນທຶກ</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="ຊື່">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus placeholder="ເຊັ່ນ ຊີ້ນງົວ, ເບຍລາວ (ຂວດ)" maxLength={80} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ຫົວໜ່ວຍ" hint="ກຣາມ, ມິນລິລິດ, ຂວດ, ຟອງ...">
            <Input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} maxLength={20} />
          </Field>
          <Field label="ຕົ້ນທຶນ/ຫົວໜ່ວຍ (ກີບ)">
            <MoneyInput value={f.cost} onChange={(v) => setF({ ...f, cost: v })} />
          </Field>
          <Field label="ແຈ້ງເຕືອນເມື່ອເຫຼືອ">
            <Input type="number" min={0} value={f.lowAt || ''} onChange={(e) => setF({ ...f, lowAt: Number(e.target.value) || 0 })} placeholder="0" />
          </Field>
          <Field label="ເຕີມໃຫ້ເຖິງ (ໃຊ້ຄຳນວນຈຳນວນສັ່ງຊື້)">
            <Input type="number" min={0} value={f.refillTo || ''} onChange={(e) => setF({ ...f, refillTo: Number(e.target.value) || 0 })} placeholder="0" />
          </Field>
          <Field label="ໝວດ" hint="ເຊັ່ນ ຊີ້ນ, ຜັກ, ເຄື່ອງດື່ມ">
            <Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} maxLength={40} list="ing-cats" />
            <datalist id="ing-cats">{['ຊີ້ນ', 'ຜັກ', 'ເຄື່ອງດື່ມ', 'ເຄື່ອງປຸງ', 'ແຫ້ງ'].map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label="ແພັກ/ຫີບ (ບໍ່ບັງຄັບ)" hint="ເຊັ່ນ ກິໂລ, ຫີບ, ໂຖ">
            <Input value={f.packName} onChange={(e) => setF({ ...f, packName: e.target.value })} maxLength={20} placeholder="ຊື່ແພັກ" />
          </Field>
          <Field label={`1 ${f.packName || 'ແພັກ'} = ກີ່ ${f.unit || 'ຫົວໜ່ວຍ'}`}>
            <Input type="number" min={0} value={f.packSize || ''} onChange={(e) => setF({ ...f, packSize: Number(e.target.value) || 0 })} placeholder="ເຊັ່ນ 1000" />
          </Field>
          <Field label="ຜູ້ສະໜອງປະຈຳ" hint="ໃຊ້ແບ່ງກຸ່ມໃບສັ່ງຊື້ແນະນຳ">
            <Select value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: Number(e.target.value) })}>
              <option value={0}>— ບໍ່ລະບຸ —</option>
              {(suppliers ?? []).filter((x) => x.active || x.id === f.supplierId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </Field>
          {!ing.id && (
            <Field label="ສະຕັອກເລີ່ມຕົ້ນ">
              <Input type="number" min={0} value={f.stock || ''} onChange={(e) => setF({ ...f, stock: Number(e.target.value) || 0 })} placeholder="0" />
            </Field>
          )}
        </div>
        {ing.id && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-brand-600" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> ເປີດໃຊ້ງານ
          </label>
        )}
      </div>
    </Modal>
  );
}

function StockModal({ ing, type, onClose, onSaved }: { ing: Ingredient; type: 'in' | 'adjust' | 'waste'; onClose: () => void; onSaved: () => void }) {
  const [mode, setMode] = useState(type);
  const [qty, setQty] = useState<number | ''>(mode === 'adjust' ? ing.stock : '');
  const [unitCost, setUnitCost] = useState(0);
  const [note, setNote] = useState('');
  const [byPack, setByPack] = useState(false);
  const [lot, setLot] = useState('');
  const [expires, setExpires] = useState('');
  const { busy, run } = useAction();
  const packOn = byPack && mode === 'in' && ing.pack_size > 0;
  const titles = { in: 'ຮັບສິນຄ້າເຂົ້າ', adjust: 'ນັບສະຕັອກ (ຕັ້ງຍອດຕາມທີ່ນັບໄດ້ຈິງ)', waste: 'ຕັດເສຍຫາຍ' };
  const n = Number(qty) || 0;
  const after = mode === 'in' ? ing.stock + n * (packOn ? ing.pack_size : 1) : mode === 'waste' ? ing.stock - n : n;
  return (
    <Modal
      open
      onClose={onClose}
      title={`${ing.name} · ${titles[mode]}`}
      footer={
        <Button
          loading={busy}
          disabled={qty === '' || (mode !== 'adjust' && n <= 0)}
          onClick={async () => {
            const body = { type: mode, qty: n, note, ...(mode === 'in' ? { byPack: packOn, lot, expiresAt: expires || undefined } : {}), ...(mode === 'in' && unitCost ? { unitCost } : {}) };
            if (await run(() => post(`/ingredients/${ing.id}/stock`, body), 'ບັນທຶກສະຕັອກແລ້ວ')) {
              onSaved();
              onClose();
            }
          }}
        >
          ບັນທຶກ
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {(['in', 'adjust', 'waste'] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setQty(m === 'adjust' ? ing.stock : '');
              }}
              className={cx('flex-1 rounded-md py-1.5 text-sm font-medium', mode === m ? 'bg-white shadow' : 'text-slate-500')}
            >
              {m === 'in' ? 'ຮັບເຂົ້າ' : m === 'adjust' ? 'ນັບສະຕັອກ' : 'ເສຍຫາຍ'}
            </button>
          ))}
        </div>
        <div className="text-sm text-slate-600">ສະຕັອກປັດຈຸບັນ: <b className="tabular">{fmt(ing.stock)} {ing.unit}</b></div>
        {mode === 'in' && ing.pack_size > 0 && (
          <div className="flex gap-1 rounded-lg bg-slate-50 p-1 text-sm">
            <button onClick={() => setByPack(false)} className={cx('flex-1 rounded-md py-1', !byPack && 'bg-white shadow')}>ເປັນ {ing.unit}</button>
            <button onClick={() => setByPack(true)} className={cx('flex-1 rounded-md py-1', byPack && 'bg-white shadow')}>ເປັນ {ing.pack_name} (1 = {fmt(ing.pack_size)} {ing.unit})</button>
          </div>
        )}
        <Field label={mode === 'adjust' ? `ຈຳນວນທີ່ນັບໄດ້ຈິງ (${ing.unit})` : `ຈຳນວນ (${packOn ? ing.pack_name : ing.unit})`}>
          <Input type="number" min={0} step="any" autoFocus value={qty} onChange={(e) => setQty(e.target.value === '' ? '' : Number(e.target.value))} />
        </Field>
        {mode === 'in' && (
          <Field label={`ລາຄາຊື້/${packOn ? ing.pack_name : ing.unit} (ກີບ) — ບໍ່ບັງຄັບ`} hint="ໃສ່ເພື່ອໃຫ້ຕົ້ນທຶນເປັນຄ່າສະເລ່ຍຖ່ວງນ້ຳໜັກ">
            <MoneyInput value={unitCost} onChange={setUnitCost} placeholder={String(ing.cost)} />
          </Field>
        )}
        {mode === 'in' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="ເລກລັອດ (ບໍ່ບັງຄັບ)"><Input value={lot} onChange={(e) => setLot(e.target.value)} maxLength={40} /></Field>
            <Field label="ວັນໝົດອາຍຸ (ບໍ່ບັງຄັບ)"><Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></Field>
          </div>
        )}
        <Field label="ໝາຍເຫດ">
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={mode === 'in' ? 'ເຊັ່ນ ຊື້ຈາກຕະຫຼາດ' : mode === 'waste' ? 'ເຊັ່ນ ໝົດອາຍຸ' : ''} />
        </Field>
        {qty !== '' && <div className={cx('rounded-lg p-2 text-sm', after < 0 ? 'bg-rose-50 text-rose-700' : 'bg-slate-50')}>ຍອດຫຼັງບັນທຶກ: <b className="tabular">{fmt(after)} {ing.unit}</b></div>}
      </div>
    </Modal>
  );
}
