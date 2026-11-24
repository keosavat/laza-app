import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { del, get, post, put, type Table, type Zone } from '../lib/api';
import { useSync } from '../lib/store';
import { Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, toast, useAction, useLoad , ask } from '../components/ui';

export default function FloorAdmin() {
  const [data, reload, loading] = useLoad(async () => {
    const [zones, tables] = await Promise.all([get<Zone[]>('/zones'), get<Table[]>('/tables')]);
    return { zones, tables: tables.filter((t) => t.active) };
  });
  useSync(['tables'], reload);
  const [editTable, setEditTable] = useState<Partial<Table> | null>(null);
  const [editZone, setEditZone] = useState<Partial<Zone> | null>(null);
  const [bulk, setBulk] = useState(false);
  const { run } = useAction();

  if (loading || !data) return <Spinner />;
  const groups = [...data.zones.map((z) => ({ zone: z as Zone | null })), { zone: null }];

  return (
    <div className="p-4 lg:p-6">
      <PageHeader
        title="ຈັດການໂຕະ"
        sub={`${data.tables.length} ໂຕະ · ${data.zones.length} ໂຊນ`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditZone({ name: '', sort: data.zones.length + 1 })}>
              <Plus className="size-4" /> ໂຊນ
            </Button>
            <Button variant="secondary" onClick={() => setBulk(true)}>ເພີ່ມຫຼາຍໂຕະ</Button>
            <Button onClick={() => setEditTable({ name: '', seats: 4, zone_id: data.zones[0]?.id ?? null, sort: data.tables.length + 1 })}>
              <Plus className="size-4" /> ໂຕະ
            </Button>
          </>
        }
      />
      <div className="space-y-4">
        {groups.map(({ zone }) => {
          const tables = data.tables.filter((t) => t.zone_id === (zone?.id ?? null));
          if (!zone && tables.length === 0) return null;
          return (
            <Card key={zone?.id ?? 'none'} className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold">
                  {zone?.name ?? 'ບໍ່ມີໂຊນ'} <span className="text-sm font-normal text-slate-400">({tables.length})</span>
                </h2>
                {zone && (
                  <button onClick={() => setEditZone(zone)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" aria-label="ແກ້ໄຂໂຊນ">
                    <Pencil className="size-4" />
                  </button>
                )}
              </div>
              {tables.length === 0 ? (
                <Empty>ຍັງບໍ່ມີໂຕະ</Empty>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                  {tables.map((t) => (
                    <div key={t.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                      <div>
                        <div className="font-semibold">{t.name}</div>
                        <div className="text-xs text-slate-400">{t.seats} ບ່ອນນັ່ງ</div>
                      </div>
                      <div className="flex">
                        <button onClick={() => setEditTable(t)} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="ແກ້ໄຂ">
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          onClick={async () => {
                            if (!(await ask(`ລຶບໂຕະ ${t.name}?`))) return;
                            if (await run(() => del(`/tables/${t.id}`), 'ລຶບໂຕະແລ້ວ')) reload();
                          }}
                          className="rounded p-1 text-rose-500 hover:bg-rose-50"
                          aria-label="ລຶບ"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>
      {editTable && <TableModal table={editTable} zones={data.zones} onClose={() => setEditTable(null)} onSaved={reload} />}
      {editZone && <ZoneModal zone={editZone} onClose={() => setEditZone(null)} onSaved={reload} />}
      {bulk && <BulkModal zones={data.zones} onClose={() => setBulk(false)} onSaved={reload} />}
    </div>
  );
}

function TableModal({ table, zones, onClose, onSaved }: { table: Partial<Table>; zones: Zone[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(table.name ?? '');
  const [seats, setSeats] = useState(table.seats ?? 4);
  const [zoneId, setZoneId] = useState<number | null>(table.zone_id ?? null);
  const [sort, setSort] = useState(table.sort ?? 0);
  const { busy, run } = useAction();
  const save = async () => {
    const body = { name, seats, zoneId, sort };
    if (await run(() => (table.id ? put(`/tables/${table.id}`, body) : post('/tables', body)), 'ບັນທຶກແລ້ວ')) {
      onSaved();
      onClose();
    }
  };
  return (
    <Modal open onClose={onClose} title={table.id ? 'ແກ້ໄຂໂຕະ' : 'ໂຕະໃໝ່'} footer={<Button onClick={save} loading={busy} disabled={!name.trim()}>ບັນທຶກ</Button>}>
      <div className="space-y-4">
        <Field label="ຊື່ໂຕະ">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={40} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ບ່ອນນັ່ງ">
            <Input type="number" min={1} value={seats} onChange={(e) => setSeats(Number(e.target.value) || 1)} />
          </Field>
          <Field label="ລຳດັບ">
            <Input type="number" value={sort} onChange={(e) => setSort(Number(e.target.value) || 0)} />
          </Field>
        </div>
        <Field label="ໂຊນ">
          <Select value={zoneId ?? ''} onChange={(e) => setZoneId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">— ບໍ່ມີໂຊນ —</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>{z.name}</option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

function ZoneModal({ zone, onClose, onSaved }: { zone: Partial<Zone>; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(zone.name ?? '');
  const [sort, setSort] = useState(zone.sort ?? 0);
  const { busy, run } = useAction();
  return (
    <Modal
      open
      onClose={onClose}
      title={zone.id ? 'ແກ້ໄຂໂຊນ' : 'ໂຊນໃໝ່'}
      footer={
        <>
          {zone.id && (
            <Button
              variant="ghost"
              className="mr-auto text-rose-600"
              onClick={async () => {
                if (!(await ask('ລຶບໂຊນນີ້? ໂຕະໃນໂຊນຈະຍ້າຍໄປ "ບໍ່ມີໂຊນ"'))) return;
                if (await run(() => del(`/zones/${zone.id}`), 'ລຶບໂຊນແລ້ວ')) {
                  onSaved();
                  onClose();
                }
              }}
            >
              ລຶບ
            </Button>
          )}
          <Button
            loading={busy}
            disabled={!name.trim()}
            onClick={async () => {
              if (await run(() => (zone.id ? put(`/zones/${zone.id}`, { name, sort }) : post('/zones', { name, sort })), 'ບັນທຶກແລ້ວ')) {
                onSaved();
                onClose();
              }
            }}
          >
            ບັນທຶກ
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="ຊື່ໂຊນ">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={60} placeholder="ເຊັ່ນ: ໃນຮ້ານ, ຊັ້ນ 2, ສວນ" />
        </Field>
        <Field label="ລຳດັບ">
          <Input type="number" value={sort} onChange={(e) => setSort(Number(e.target.value) || 0)} />
        </Field>
      </div>
    </Modal>
  );
}

function BulkModal({ zones, onClose, onSaved }: { zones: Zone[]; onClose: () => void; onSaved: () => void }) {
  const [prefix, setPrefix] = useState('ໂຕະ');
  const [from, setFrom] = useState(1);
  const [count, setCount] = useState(10);
  const [seats, setSeats] = useState(4);
  const [zoneId, setZoneId] = useState<number | null>(zones[0]?.id ?? null);
  const { busy, run } = useAction();
  return (
    <Modal
      open
      onClose={onClose}
      title="ເພີ່ມຫຼາຍໂຕະພ້ອມກັນ"
      footer={
        <Button
          loading={busy}
          onClick={async () => {
            if (await run(() => post('/tables/bulk', { prefix, from, count, seats, zoneId }))) {
              toast.ok(`ເພີ່ມ ${count} ໂຕະແລ້ວ`);
              onSaved();
              onClose();
            }
          }}
        >
          ເພີ່ມ {count} ໂຕະ
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="ຊື່ນຳໜ້າ">
          <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        </Field>
        <Field label="ໂຊນ">
          <Select value={zoneId ?? ''} onChange={(e) => setZoneId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">— ບໍ່ມີ —</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>{z.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="ເລີ່ມເລກ">
          <Input type="number" min={0} value={from} onChange={(e) => setFrom(Number(e.target.value) || 0)} />
        </Field>
        <Field label="ຈຳນວນ">
          <Input type="number" min={1} max={200} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} />
        </Field>
        <Field label="ບ່ອນນັ່ງ/ໂຕະ">
          <Input type="number" min={1} value={seats} onChange={(e) => setSeats(Number(e.target.value) || 1)} />
        </Field>
      </div>
      <p className="mt-3 text-sm text-slate-500">
        ຕົວຢ່າງ: {prefix} {String(from).padStart(2, '0')} … {prefix} {String(from + count - 1).padStart(2, '0')}
      </p>
    </Modal>
  );
}
