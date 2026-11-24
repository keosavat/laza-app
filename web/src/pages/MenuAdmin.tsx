import { useState } from 'react';
import { Pencil, Plus, Trash2, ImagePlus, X, Search, ChevronsUpDown, Check } from 'lucide-react';
import { del, get, post, put, type Category, type Ingredient, type MenuItem, type OptionGroup, type Printer, type Recipe } from '../lib/api';
import { useSync } from '../lib/store';
import { kip } from '../lib/format';
import { Badge, Button, Card, Empty, Field, Input, Modal, MoneyInput, PageHeader, Select, Spinner, cx, toast, useAction, useLoad , ask } from '../components/ui';

export default function MenuAdmin() {
  const [data, reload, loading] = useLoad(async () => {
    const [cats, items] = await Promise.all([get<Category[]>('/categories'), get<MenuItem[]>('/menu-items')]);
    return { cats, items };
  });
  useSync(['menu'], reload);
  const [cat, setCat] = useState<number | 'all'>('all');
  const [editItem, setEditItem] = useState<Partial<MenuItem> | null>(null);
  const [editCat, setEditCat] = useState<Partial<Category> | null>(null);
  const { run } = useAction();

  if (loading || !data) return <Spinner />;
  const items = data.items.filter((i) => cat === 'all' || i.category_id === cat);
  const catName = (id: number | null) => data.cats.find((c) => c.id === id)?.name ?? '—';

  return (
    <div className="p-4 lg:p-6">
      <PageHeader
        title="ເມນູອາຫານ"
        sub={`${data.items.length} ເມນູ · ${data.cats.length} ໝວດ`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditCat({ name: '', sort: data.cats.length + 1, active: 1 })}>
              <Plus className="size-4" /> ໝວດ
            </Button>
            <Button onClick={() => setEditItem({ name: '', price: 0, cost: 0, category_id: cat === 'all' ? (data.cats[0]?.id ?? null) : cat, options: [], active: 1, image_url: '' })}>
              <Plus className="size-4" /> ເມນູໃໝ່
            </Button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <Card className="h-fit p-2">
          <CatRow active={cat === 'all'} onClick={() => setCat('all')} label="ທັງໝົດ" count={data.items.length} />
          {data.cats.map((c) => (
            <CatRow
              key={c.id}
              active={cat === c.id}
              onClick={() => setCat(c.id)}
              label={c.name}
              muted={!c.active}
              count={data.items.filter((i) => i.category_id === c.id).length}
              onEdit={() => setEditCat(c)}
            />
          ))}
        </Card>
        <Card className="overflow-x-auto">
          {items.length === 0 ? (
            <Empty>ຍັງບໍ່ມີເມນູໃນໝວດນີ້</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">ເມນູ</th>
                  <th className="px-4 py-2 font-medium">ໝວດ</th>
                  <th className="px-4 py-2 text-right font-medium">ລາຄາ</th>
                  <th className="px-4 py-2 text-right font-medium">ຕົ້ນທຶນ</th>
                  <th className="px-4 py-2 text-right font-medium">ກຳໄລ</th>
                  <th className="px-4 py-2 font-medium">ສະຖານະ</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((i) => {
                  const margin = i.price ? Math.round(((i.price - i.cost) / i.price) * 100) : 0;
                  return (
                    <tr key={i.id} className={cx(!i.active && 'opacity-50')}>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-3">
                          <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 text-xs font-bold text-slate-400">
                            {i.image_url ? <img src={i.image_url} alt="" className="size-full object-cover" /> : i.name.slice(0, 2)}
                          </div>
                          <div>
                            <div className="font-medium">{i.name}</div>
                            {i.options.length > 0 && <div className="text-xs text-slate-400">{i.options.map((g) => g.name).join(', ')}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-slate-600">{catName(i.category_id)}</td>
                      <td className="tabular px-4 py-2 text-right">{kip(i.price)}</td>
                      <td className="tabular px-4 py-2 text-right text-slate-500">{kip(i.cost)}</td>
                      <td className="tabular px-4 py-2 text-right">{margin}%</td>
                      <td className="px-4 py-2">
                        <Badge className={i.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}>{i.active ? 'ເປີດຂາຍ' : 'ປິດ'}</Badge>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button onClick={() => setEditItem(i)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" aria-label="ແກ້ໄຂ">
                          <Pencil className="size-4" />
                        </button>
                        <button
                          onClick={async () => {
                            if (!(await ask(`ລຶບ "${i.name}"?`))) return;
                            const r = await run(() => del<{ deactivated: boolean }>(`/menu-items/${i.id}`));
                            if (r) toast.ok(r.deactivated ? 'ເມນູນີ້ເຄີຍຂາຍແລ້ວ ຈຶ່ງປິດການຂາຍແທນການລຶບ' : 'ລຶບແລ້ວ');
                            reload();
                          }}
                          className="rounded p-1.5 text-rose-500 hover:bg-rose-50"
                          aria-label="ລຶບ"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>
      {editItem && <ItemModal item={editItem} cats={data.cats} onClose={() => setEditItem(null)} onSaved={reload} />}
      {editCat && <CategoryModal cat={editCat} onClose={() => setEditCat(null)} onSaved={reload} />}
    </div>
  );
}

function CatRow({ active, onClick, label, count, muted, onEdit }: { active: boolean; onClick: () => void; label: string; count: number; muted?: boolean; onEdit?: () => void }) {
  return (
    <div className={cx('group flex items-center rounded-lg', active ? 'bg-brand-50 text-brand-800' : 'hover:bg-slate-50', muted && 'opacity-50')}>
      <button onClick={onClick} className="flex flex-1 justify-between px-3 py-2 text-left text-sm">
        <span className="truncate">{label}</span>
        <span className="text-xs text-slate-400">{count}</span>
      </button>
      {onEdit && (
        <button onClick={onEdit} className="mr-1 rounded p-1 text-slate-400 opacity-0 hover:bg-white group-hover:opacity-100" aria-label="ແກ້ໄຂໝວດ">
          <Pencil className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function CategoryModal({ cat, onClose, onSaved }: { cat: Partial<Category>; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(cat.name ?? '');
  const [sort, setSort] = useState(cat.sort ?? 0);
  const [active, setActive] = useState(cat.active !== 0);
  const [printerId, setPrinterId] = useState<number | null>(cat.printer_id ?? null);
  const [printers] = useLoad(() => get<Printer[]>('/printers'));
  const { busy, run } = useAction();
  const save = async () => {
    const body = { name, sort, active, printerId };
    const r = await run(() => (cat.id ? put(`/categories/${cat.id}`, body) : post('/categories', body)), 'ບັນທຶກແລ້ວ');
    if (r) {
      onSaved();
      onClose();
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={cat.id ? 'ແກ້ໄຂໝວດ' : 'ໝວດໃໝ່'}
      footer={
        <>
          {cat.id && (
            <Button
              variant="ghost"
              className="mr-auto text-rose-600"
              onClick={async () => {
                if (!(await ask('ລຶບໝວດນີ້?'))) return;
                if (await run(() => del(`/categories/${cat.id}`), 'ລຶບແລ້ວ')) {
                  onSaved();
                  onClose();
                }
              }}
            >
              ລຶບ
            </Button>
          )}
          <Button onClick={save} loading={busy} disabled={!name.trim()}>ບັນທຶກ</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="ຊື່ໝວດ">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} />
        </Field>
        <Field label="ລຳດັບການສະແດງ">
          <Input type="number" value={sort} onChange={(e) => setSort(Number(e.target.value) || 0)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4 accent-brand-600" /> ສະແດງໃນໜ້າຂາຍ
        </label>
        <Field label="ສົ່ງໃບສັ່ງໄປເຄື່ອງພິມ" hint="ເຊັ່ນ ເຄື່ອງດື່ມ → ບາ, ອາຫານ → ຄົວ">
          <Select value={printerId ?? ''} onChange={(e) => setPrinterId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">ເຄື່ອງພິມຄົວຫຼັກ (ຄ່າເລີ່ມຕົ້ນ)</option>
            {(printers ?? []).filter((p) => p.role === 'kitchen').map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.active ? '' : ' (ປິດ)'}</option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

/** Downscale an image file to a JPEG data URL (max 800px) so it stays small. */
function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 800 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => reject(new Error('ອ່ານຮູບບໍ່ໄດ້'));
    img.src = URL.createObjectURL(file);
  });
}

function ItemModal({ item, cats, onClose, onSaved }: { item: Partial<MenuItem>; cats: Category[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: item.name ?? '',
    categoryId: item.category_id ?? null,
    price: item.price ?? 0,
    cost: item.cost ?? 0,
    imageUrl: item.image_url ?? '',
    active: item.active !== 0,
    options: (item.options ?? []) as OptionGroup[],
  });
  const { busy, run } = useAction();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const setGroup = (i: number, g: Partial<OptionGroup>) => set('options', f.options.map((x, j) => (j === i ? { ...x, ...g } : x)));

  const save = async () => {
    const r = await run(() => (item.id ? put(`/menu-items/${item.id}`, f) : post('/menu-items', f)), 'ບັນທຶກເມນູແລ້ວ');
    if (r) {
      onSaved();
      onClose();
    }
  };

  return (
    <Modal open onClose={onClose} title={item.id ? 'ແກ້ໄຂເມນູ' : 'ເມນູໃໝ່'} wide footer={<Button onClick={save} loading={busy} disabled={!f.name.trim()}>ບັນທຶກ</Button>}>
      <div className="grid gap-5 md:grid-cols-[180px_1fr]">
        <div>
          <label className="flex aspect-square cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500 hover:border-brand-500">
            {f.imageUrl ? (
              <img src={f.imageUrl} alt="" className="size-full object-cover" />
            ) : (
              <>
                <ImagePlus className="mb-1 size-6" /> ເພີ່ມຮູບ
              </>
            )}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  set('imageUrl', await readImage(file));
                } catch (err) {
                  toast.err(err);
                }
              }}
            />
          </label>
          {f.imageUrl && (
            <button onClick={() => set('imageUrl', '')} className="mt-1 text-xs text-rose-600">
              ລຶບຮູບ
            </button>
          )}
        </div>
        <div className="space-y-4">
          <Field label="ຊື່ເມນູ">
            <Input value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus maxLength={120} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="ໝວດ">
              <Select value={f.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value ? Number(e.target.value) : null)}>
                <option value="">— ບໍ່ມີໝວດ —</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="ສະຖານະ">
              <Select value={f.active ? '1' : '0'} onChange={(e) => set('active', e.target.value === '1')}>
                <option value="1">ເປີດຂາຍ</option>
                <option value="0">ປິດການຂາຍ</option>
              </Select>
            </Field>
            <Field label="ລາຄາຂາຍ (ກີບ)">
              <MoneyInput value={f.price} onChange={(v) => set('price', v)} />
            </Field>
            <Field label="ຕົ້ນທຶນ (ກີບ)" hint="ໃຊ້ຄິດໄລ່ກຳໄລ">
              <MoneyInput value={f.cost} onChange={(v) => set('cost', v)} />
            </Field>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-semibold">ຕົວເລືອກ (ຂະໜາດ, ລະດັບຫວານ, ທັອບປິ້ງ...)</h3>
          <Button size="sm" variant="secondary" onClick={() => set('options', [...f.options, { name: '', required: false, multiple: false, choices: [{ name: '', price: 0 }] }])}>
            <Plus className="size-4" /> ກຸ່ມຕົວເລືອກ
          </Button>
        </div>
        {f.options.length === 0 && <div className="text-sm text-slate-400">ບໍ່ມີຕົວເລືອກ</div>}
        <div className="space-y-3">
          {f.options.map((g, gi) => (
            <div key={gi} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <Input value={g.name} onChange={(e) => setGroup(gi, { name: e.target.value })} placeholder="ຊື່ກຸ່ມ ເຊັ່ນ ຂະໜາດ" className="max-w-56" />
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={g.required} onChange={(e) => setGroup(gi, { required: e.target.checked })} className="accent-brand-600" /> ຕ້ອງເລືອກ
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={g.multiple} onChange={(e) => setGroup(gi, { multiple: e.target.checked })} className="accent-brand-600" /> ເລືອກໄດ້ຫຼາຍ
                </label>
                <button onClick={() => set('options', f.options.filter((_, j) => j !== gi))} className="ml-auto text-sm text-rose-600">
                  ລຶບກຸ່ມ
                </button>
              </div>
              <div className="mt-2 space-y-2">
                {g.choices.map((c, ci) => (
                  <div key={ci} className="flex items-center gap-2">
                    <Input value={c.name} onChange={(e) => setGroup(gi, { choices: g.choices.map((x, j) => (j === ci ? { ...x, name: e.target.value } : x)) })} placeholder="ຕົວເລືອກ" />
                    <MoneyInput value={c.price} onChange={(v) => setGroup(gi, { choices: g.choices.map((x, j) => (j === ci ? { ...x, price: v } : x)) })} placeholder="+ລາຄາ" className="w-32" />
                    <button onClick={() => setGroup(gi, { choices: g.choices.filter((_, j) => j !== ci) })} className="p-1 text-slate-400 hover:text-rose-600" aria-label="ລຶບ">
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
                <button onClick={() => setGroup(gi, { choices: [...g.choices, { name: '', price: 0 }] })} className="text-sm text-brand-700">
                  + ເພີ່ມຕົວເລືອກ
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      {item.id ? (
        <RecipeEditor itemId={item.id} price={f.price} onSaved={onSaved} />
      ) : (
        <p className="mt-6 rounded-lg bg-slate-50 p-3 text-sm text-slate-500">ບັນທຶກເມນູກ່ອນ ຈຶ່ງຕັ້ງສູດອາຫານ (ວັດຖຸດິບທີ່ຕັດສະຕັອກ) ໄດ້</p>
      )}
    </Modal>
  );
}

/** Recipe: which ingredients (and how much) one portion uses. Saved separately from the item. */
function RecipeEditor({ itemId, price, onSaved }: { itemId: number; price: number; onSaved: () => void }) {
  const [data, reloadRecipe, loading] = useLoad(() => get<Recipe>(`/menu-items/${itemId}/recipe`), [itemId]);
  const [ings, reloadIngs] = useLoad(() => get<Ingredient[]>('/ingredients'));
  const [lines, setLines] = useState<{ ingredientId: number; qty: number }[] | null>(null);
  const [creatingFor, setCreatingFor] = useState<number | null>(null);
  const [fromRecipe, setFromRecipe] = useState<boolean | null>(null);
  const { busy, run } = useAction();
  if (loading || !data || !ings) return <div className="mt-6 text-sm text-slate-400">ກຳລັງໂຫຼດສູດ...</div>;
  const cur = lines ?? data.lines.map((l) => ({ ingredientId: l.ingredientId, qty: l.qty }));
  const useCost = fromRecipe ?? data.costFromRecipe;
  const byId = new Map(ings.map((i) => [i.id, i]));
  const cost = Math.round(cur.reduce((s, l) => s + l.qty * (byId.get(l.ingredientId)?.cost ?? 0), 0));
  const set = (i: number, patch: Partial<{ ingredientId: number; qty: number }>) => setLines(cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const margin = price ? Math.round(((price - cost) / price) * 100) : 0;

  return (
    <div className="mt-6 rounded-xl border border-slate-200 p-4">
      <h3 className="font-semibold">ສູດອາຫານ (ຕັດສະຕັອກອັດຕະໂນມັດເມື່ອຂາຍ)</h3>
      <p className="mb-3 text-xs text-slate-500">ວັດຖຸດິບທີ່ໃຊ້ຕໍ່ 1 ຈານ. ຖ້າບໍ່ໃສ່ສູດ ເມນູນີ້ຈະບໍ່ຕັດສະຕັອກ.</p>
      <div className="space-y-2">
        {cur.map((l, i) => {
          const ing = byId.get(l.ingredientId);
          return (
            <div key={i} className="flex items-center gap-2">
              <IngredientPicker
                value={l.ingredientId}
                ings={ings.filter((o) => o.active && (o.id === l.ingredientId || !cur.some((x) => x.ingredientId === o.id)))}
                onPick={(id) => set(i, { ingredientId: id })}
                onCreate={() => setCreatingFor(i)}
              />
              <Input type="number" min={0} step="any" value={l.qty || ''} onChange={(e) => set(i, { qty: Number(e.target.value) || 0 })} className="w-24! text-right" />
              <span className="w-14 text-sm text-slate-500">{ing?.unit}</span>
              <span className="tabular w-24 text-right text-sm text-slate-500">{kip(Math.round(l.qty * (ing?.cost ?? 0)))}</span>
              <button onClick={() => setLines(cur.filter((_, j) => j !== i))} className="p-1 text-slate-400 hover:text-rose-600" aria-label="ລຶບ">
                <X className="size-4" />
              </button>
            </div>
          );
        })}
        {cur.length === 0 && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">ຍັງບໍ່ມີວັດຖຸດິບໃນສູດ — ກົດ "ເພີ່ມວັດຖຸດິບ" ແລ້ວເລືອກ ຫຼື ສ້າງວັດຖຸດິບໃໝ່</p>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" disabled={cur.some((l) => !l.ingredientId)} onClick={() => setLines([...cur, { ingredientId: 0, qty: 1 }])}>
          <Plus className="size-4" /> ເພີ່ມວັດຖຸດິບ
        </Button>
        <span className="ml-auto text-sm">ຕົ້ນທຶນຕາມສູດ <b className="tabular">{kip(cost)}</b> · ກຳໄລ <b className="tabular">{margin}%</b></span>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-brand-600" checked={useCost} onChange={(e) => setFromRecipe(e.target.checked)} /> ໃຊ້ຕົ້ນທຶນຈາກສູດ (ອັບເດດອັດຕະໂນມັດເມື່ອລາຄາວັດຖຸດິບປ່ຽນ)
      </label>
      <Button
        className="mt-3"
        loading={busy}
        disabled={cur.some((l) => !(l.qty > 0) || !l.ingredientId)}
        onClick={async () => {
          if (await run(() => put(`/menu-items/${itemId}/recipe`, { lines: cur, costFromRecipe: useCost }), 'ບັນທຶກສູດແລ້ວ')) {
            await reloadRecipe();
            setLines(null);
            setFromRecipe(null);
            onSaved();
          }
        }}
      >
        ບັນທຶກສູດ
      </Button>
      {creatingFor !== null && (
        <QuickIngredient
          onClose={() => setCreatingFor(null)}
          onCreated={async (ing) => {
            await reloadIngs();
            set(creatingFor, { ingredientId: ing.id });
            setCreatingFor(null);
          }}
        />
      )}
    </div>
  );
}

/** Searchable ingredient dropdown with a "create new" shortcut. */
export function IngredientPicker({ value, ings, onPick, onCreate, placeholder, inline }: { value: number; ings: Ingredient[]; onPick: (id: number) => void; onCreate: () => void; placeholder?: string; inline?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const cur = ings.find((i) => i.id === value);
  const shown = ings.filter((i) => !q.trim() || i.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="relative min-w-0 flex-1">
      <button type="button" onClick={() => { setOpen(!open); setQ(''); }} className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 text-left text-sm">
        <span className={cx('truncate', !cur && 'text-slate-400')}>{cur?.name ?? placeholder ?? 'ເລືອກວັດຖຸດິບ...'}</span>
        <ChevronsUpDown className="size-4 shrink-0 text-slate-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className={cx('z-20 rounded-lg border border-slate-200 bg-white p-2 shadow-lg', inline ? 'relative mt-1 w-full' : 'absolute left-0 top-11 w-72 max-w-[80vw]')}>
            <div className="relative mb-1">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="ຄົ້ນຫາ..." className="pl-8" />
            </div>
            <div className="max-h-48 overflow-y-auto">
              {shown.length === 0 && <div className="px-2 py-3 text-center text-sm text-slate-400">ບໍ່ພົບວັດຖຸດິບ</div>}
              {shown.map((i) => (
                <button key={i.id} type="button" onClick={() => { onPick(i.id); setOpen(false); }} className="flex w-full items-center justify-between rounded px-2 py-2 text-left text-sm hover:bg-slate-100">
                  <span>{i.name} <span className="text-xs text-slate-400">({i.unit})</span></span>
                  {i.id === value && <Check className="size-4 text-brand-600" />}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => { setOpen(false); onCreate(); }} className="mt-1 flex w-full items-center gap-2 border-t border-slate-100 px-2 pt-2 text-sm font-medium text-brand-700">
              <Plus className="size-4" /> ສ້າງວັດຖຸດິບໃໝ່
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Create an ingredient without leaving the recipe. */
export function QuickIngredient({ onClose, onCreated, cta }: { onClose: () => void; onCreated: (i: Ingredient) => void; cta?: string }) {
  const [f, setF] = useState({ name: '', unit: 'ກຣາມ', cost: 0 });
  const { busy, run } = useAction();
  return (
    <Modal
      open
      onClose={onClose}
      title="ວັດຖຸດິບໃໝ່"
      footer={
        <Button
          loading={busy}
          disabled={!f.name.trim() || !f.unit.trim()}
          onClick={async () => {
            const r = await run(() => post<Ingredient>('/ingredients', f), 'ສ້າງວັດຖຸດິບແລ້ວ');
            if (r) onCreated(r);
          }}
        >
          {cta ?? 'ສ້າງ ແລະ ໃຊ້ໃນສູດ'}
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="ຊື່"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus maxLength={80} placeholder="ເຊັ່ນ ຊີ້ນງົວ, ເສັ້ນເຝີ" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ຫົວໜ່ວຍ" hint="ກຣາມ, ມິນລິລິດ, ຂວດ, ຟອງ...">
            <Input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} maxLength={20} />
          </Field>
          <Field label="ຕົ້ນທຶນ/ຫົວໜ່ວຍ (₭)"><MoneyInput value={f.cost} onChange={(v) => setF({ ...f, cost: v })} /></Field>
        </div>
        <p className="text-xs text-slate-500">ໝວດ, ແພັກ ແລະ ສະຕັອກເລີ່ມຕົ້ນ ຕັ້ງຕໍ່ໄດ້ທີ່ໜ້າ "ສະຕັອກ"</p>
      </div>
    </Modal>
  );
}
