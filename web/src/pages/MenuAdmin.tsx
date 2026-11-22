import { useState } from 'react';
import { Pencil, Plus, Trash2, ImagePlus, X } from 'lucide-react';
import { del, get, post, put, type Category, type MenuItem, type OptionGroup } from '../lib/api';
import { useSync } from '../lib/store';
import { kip } from '../lib/format';
import { Badge, Button, Card, Empty, Field, Input, Modal, MoneyInput, PageHeader, Select, Spinner, cx, toast, useAction, useLoad } from '../components/ui';

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
                            if (!confirm(`ລຶບ "${i.name}"?`)) return;
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
  const { busy, run } = useAction();
  const save = async () => {
    const body = { name, sort, active };
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
                if (!confirm('ລຶບໝວດນີ້?')) return;
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
    </Modal>
  );
}
