import { useState } from 'react';
import { CheckCircle2, AlertTriangle, Pencil, Plus, Printer as PrinterIcon, RefreshCw, Trash2, Wifi, Usb, Loader2 } from 'lucide-react';
import { del, get, post, put, type Printer, type PrintJob } from '../lib/api';
import { useSession, useSync } from '../lib/store';
import { dateTime, since } from '../lib/format';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, cx, toast, useAction, useLoad , ask } from '../components/ui';

const ROLE: Record<Printer['role'], string> = { kitchen: 'ຄົວ / ບາ (ໃບສັ່ງ)', bill: 'ໜ້າຮ້ານ (ບິນ + ໃບຮັບເງິນ)' };
const JOB: Record<PrintJob['type'], string> = { kitchen: 'ໃບຄົວ', bill: 'ໃບແຈ້ງຍອດ', receipt: 'ໃບຮັບເງິນ', test: 'ທົດສອບ' };
const JOB_STATUS: Record<PrintJob['status'], [string, string]> = {
  queued: ['ລໍຖ້າພິມ', 'bg-amber-100 text-amber-800'],
  printing: ['ກຳລັງພິມ', 'bg-sky-100 text-sky-800'],
  done: ['ພິມແລ້ວ', 'bg-emerald-100 text-emerald-800'],
  failed: ['ລົ້ມເຫຼວ', 'bg-rose-100 text-rose-700'],
};

export default function Printers() {
  const { branch, refresh } = useSession();
  const [printers, reload, loading] = useLoad(() => get<Printer[]>('/printers'));
  const [jobs, reloadJobs] = useLoad(() => get<PrintJob[]>('/print/jobs'));
  const [edit, setEdit] = useState<Partial<Printer> | null>(null);
  const [checking, setChecking] = useState<number | null>(null);
  const { run } = useAction();
  useSync(['print', 'settings'], () => {
    reload();
    reloadJobs();
  });

  const check = async (p: Printer) => {
    setChecking(p.id);
    try {
      const r = await post<{ ok: boolean; error?: string }>(`/printers/${p.id}/check`);
      r.ok ? toast.ok(`${p.name}: ເຊື່ອມຕໍ່ໄດ້`) : toast.err(`${p.name}: ${r.error}`);
    } catch (e) {
      toast.err(e);
    } finally {
      setChecking(null);
    }
  };

  if (loading || !printers) return <Spinner />;
  const kitchen = printers.filter((p) => p.role === 'kitchen' && p.active);
  const bill = printers.filter((p) => p.role === 'bill' && p.active);

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <PageHeader
        title="ເຄື່ອງພິມ"
        sub="ເຊີບເວີພິມໃສ່ເຄື່ອງພິມໃບບິນໂດຍກົງ (LAN ຫຼື USB) ບໍ່ຕ້ອງກົດຢືນຢັນ"
        actions={
          <Button onClick={() => setEdit({ name: '', role: kitchen.length ? 'kitchen' : 'kitchen', connection: 'lan', host: '', port: 9100, paper_mm: 80, cut: 1, copies: 1, active: 1 })}>
            <Plus className="size-4" /> ເພີ່ມເຄື່ອງພິມ
          </Button>
        }
      />

      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="text-sm">
          <div className="font-medium">ພິມໃບສັ່ງເຂົ້າຄົວອັດຕະໂນມັດ</div>
          <div className="text-slate-500">ເມື່ອກົດ "ສົ່ງຄົວ" ຫຼື ລູກຄ້າສັ່ງຜ່ານ QR, ໃບສັ່ງຈະອອກເຄື່ອງພິມຄົວ/ບາ ຕາມໝວດຂອງເມນູທັນທີ</div>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="size-5 accent-brand-600"
            checked={!!branch?.auto_kitchen_print}
            onChange={async (e) => {
              if (await run(() => put('/settings', { auto_kitchen_print: e.target.checked }), 'ບັນທຶກແລ້ວ')) refresh();
            }}
          />
          ເປີດ
        </label>
      </Card>

      {!kitchen.length && !bill.length && (
        <Card className="p-4 text-sm text-slate-600">
          ຍັງບໍ່ມີເຄື່ອງພິມ: ລະບົບຈະໃຊ້ໜ້າຕ່າງພິມຂອງ browser ແທນ. ແນະນຳ: ເຄື່ອງ 1 = ໜ້າຮ້ານ (ບິນ), ເຄື່ອງ 2 = ຄົວ, ເຄື່ອງ 3 = ບາ/ເຄື່ອງດື່ມ.
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {printers.map((p) => {
          const bad = p.active && p.last_error && (!p.last_ok_at || (p.last_error_at ?? '') > p.last_ok_at);
          return (
            <Card key={p.id} className={cx('p-4', !p.active && 'opacity-60')}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className={cx('flex size-10 items-center justify-center rounded-xl', bad ? 'bg-rose-100 text-rose-600' : 'bg-brand-50 text-brand-700')}>
                    <PrinterIcon className="size-5" />
                  </div>
                  <div>
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-xs text-slate-500">{ROLE[p.role]}</div>
                  </div>
                </div>
                <button onClick={() => setEdit(p)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" aria-label="ແກ້ໄຂ">
                  <Pencil className="size-4" />
                </button>
              </div>
              <div className="mt-3 space-y-1 text-sm text-slate-600">
                <div className="flex items-center gap-1.5">
                  {p.connection === 'lan' ? <Wifi className="size-4" /> : <Usb className="size-4" />}
                  {p.connection === 'lan' ? `LAN ${p.host}:${p.port}` : `USB · ${p.system_name}`}
                </div>
                <div>ກະດາດ {p.paper_mm}mm · {p.copies} ສະບັບ{p.cut ? ' · ຕັດກະດາດ' : ''}</div>
                {!p.active ? (
                  <Badge className="bg-slate-200 text-slate-600">ປິດໃຊ້</Badge>
                ) : bad ? (
                  <div className="flex items-start gap-1.5 text-rose-600"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{p.last_error}</div>
                ) : p.last_ok_at ? (
                  <div className="flex items-center gap-1.5 text-emerald-700"><CheckCircle2 className="size-4" />ພິມສຳເລັດລ່າສຸດ {since(p.last_ok_at)}ກ່ອນ</div>
                ) : (
                  <div className="text-slate-400">ຍັງບໍ່ເຄີຍພິມ</div>
                )}
                {(p.queued ?? 0) > 0 && <div className="text-amber-700">ລໍຖ້າພິມ {p.queued} ງານ</div>}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button size="sm" variant="secondary" onClick={() => check(p)} disabled={checking === p.id}>
                  {checking === p.id ? <Loader2 className="size-4 animate-spin" /> : <Wifi className="size-4" />} ກວດການເຊື່ອມຕໍ່
                </Button>
                <Button size="sm" onClick={async () => (await run(() => post(`/printers/${p.id}/test`), 'ສົ່ງໜ້າທົດສອບແລ້ວ')) && reloadJobs()} disabled={!p.active}>
                  <PrinterIcon className="size-4" /> ພິມທົດສອບ
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="overflow-x-auto">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <span className="font-semibold">ງານພິມລ່າສຸດ</span>
          <Button size="sm" variant="ghost" onClick={reloadJobs}><RefreshCw className="size-4" /></Button>
        </div>
        {!jobs?.length ? (
          <Empty>ຍັງບໍ່ມີ</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">ເວລາ</th>
                <th className="px-4 py-2 font-medium">ປະເພດ</th>
                <th className="px-4 py-2 font-medium">ລາຍການ</th>
                <th className="px-4 py-2 font-medium">ເຄື່ອງພິມ</th>
                <th className="px-4 py-2 font-medium">ສະຖານະ</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td className="px-4 py-2 text-slate-500">{dateTime(j.created_at)}</td>
                  <td className="px-4 py-2">{JOB[j.type]}</td>
                  <td className="px-4 py-2">{j.title}</td>
                  <td className="px-4 py-2">{j.printer_name}</td>
                  <td className="px-4 py-2">
                    <Badge className={JOB_STATUS[j.status][1]}>{JOB_STATUS[j.status][0]}</Badge>
                    {j.error && <div className="mt-0.5 max-w-72 text-xs text-rose-600">{j.error}{j.status === 'queued' ? ` (ລອງຄັ້ງທີ ${j.attempts})` : ''}</div>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {j.status === 'failed' && (
                      <Button size="sm" variant="secondary" onClick={async () => (await run(() => post(`/print/jobs/${j.id}/retry`), 'ສົ່ງພິມໃໝ່ແລ້ວ')) && reloadJobs()}>
                        ພິມໃໝ່
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {edit && <PrinterModal printer={edit} onClose={() => setEdit(null)} onSaved={() => { reload(); refresh(); }} />}
    </div>
  );
}

function PrinterModal({ printer, onClose, onSaved }: { printer: Partial<Printer>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: printer.name ?? '',
    role: printer.role ?? 'kitchen',
    connection: printer.connection ?? 'lan',
    host: printer.host ?? '',
    port: printer.port ?? 9100,
    system_name: printer.system_name ?? '',
    paper_mm: printer.paper_mm ?? 80,
    cut: printer.cut !== 0,
    copies: printer.copies ?? 1,
    active: printer.active !== 0,
  });
  const [system, , sysLoading] = useLoad(() => (f.connection === 'usb' ? get<string[]>('/printers/system') : Promise.resolve([] as string[])), [f.connection]);
  const { busy, run } = useAction();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    const r = await run(() => (printer.id ? put(`/printers/${printer.id}`, f) : post('/printers', f)), 'ບັນທຶກເຄື່ອງພິມແລ້ວ');
    if (r) {
      onSaved();
      onClose();
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={printer.id ? `ແກ້ໄຂ: ${printer.name}` : 'ເພີ່ມເຄື່ອງພິມ'}
      footer={
        <>
          {printer.id && (
            <Button
              variant="ghost"
              className="mr-auto text-rose-600"
              onClick={async () => {
                if (!(await ask(`ລຶບເຄື່ອງພິມ ${printer.name}?`))) return;
                if (await run(() => del(`/printers/${printer.id}`), 'ລຶບແລ້ວ')) {
                  onSaved();
                  onClose();
                }
              }}
            >
              <Trash2 className="size-4" /> ລຶບ
            </Button>
          )}
          <Button onClick={save} loading={busy} disabled={!f.name.trim()}>ບັນທຶກ</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="ຊື່">
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="ເຊັ່ນ ຄົວ, ບາ, ໜ້າຮ້ານ" autoFocus maxLength={60} />
        </Field>
        <Field label="ໜ້າທີ່">
          <div className="grid grid-cols-2 gap-2">
            {(['kitchen', 'bill'] as const).map((r) => (
              <button key={r} onClick={() => set('role', r)} className={cx('rounded-lg border-2 p-2 text-sm', f.role === r ? 'border-brand-600 bg-brand-50 font-medium' : 'border-slate-200')}>
                {ROLE[r]}
              </button>
            ))}
          </div>
        </Field>
        <Field label="ການເຊື່ອມຕໍ່">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => set('connection', 'lan')} className={cx('flex items-center justify-center gap-2 rounded-lg border-2 p-2 text-sm', f.connection === 'lan' ? 'border-brand-600 bg-brand-50 font-medium' : 'border-slate-200')}>
              <Wifi className="size-4" /> LAN / Wi-Fi (IP)
            </button>
            <button onClick={() => set('connection', 'usb')} className={cx('flex items-center justify-center gap-2 rounded-lg border-2 p-2 text-sm', f.connection === 'usb' ? 'border-brand-600 bg-brand-50 font-medium' : 'border-slate-200')}>
              <Usb className="size-4" /> USB (ສຽບເຄື່ອງນີ້)
            </button>
          </div>
        </Field>
        {f.connection === 'lan' ? (
          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <Field label="IP ເຄື່ອງພິມ" hint="ພິມໜ້າ self-test ຂອງເຄື່ອງພິມເພື່ອເບິ່ງ IP; ຄວນຕັ້ງ IP ຄົງທີ່">
              <Input value={f.host} onChange={(e) => set('host', e.target.value.trim())} placeholder="192.168.1.50" inputMode="decimal" />
            </Field>
            <Field label="Port">
              <Input type="number" value={f.port} onChange={(e) => set('port', Number(e.target.value) || 9100)} />
            </Field>
          </div>
        ) : (
          <Field label="ເຄື່ອງພິມທີ່ຕິດຕັ້ງໃນເຄື່ອງແມ່ຂ່າຍ" hint="ເຄື່ອງພິມ USB ຕ້ອງສຽບກັບເຄື່ອງທີ່ແລ່ນ LAZA ແລະ ຕິດຕັ້ງ driver ໃນ Windows ແລ້ວ">
            {sysLoading ? (
              <Spinner />
            ) : (
              <Select value={f.system_name} onChange={(e) => set('system_name', e.target.value)}>
                <option value="">— ເລືອກເຄື່ອງພິມ —</option>
                {(system ?? []).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
                {f.system_name && !(system ?? []).includes(f.system_name) && <option value={f.system_name}>{f.system_name} (ບໍ່ພົບ)</option>}
              </Select>
            )}
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="ຂະໜາດກະດາດ">
            <Select value={f.paper_mm} onChange={(e) => set('paper_mm', Number(e.target.value) as 58 | 80)}>
              <option value={80}>80 mm</option>
              <option value={58}>58 mm</option>
            </Select>
          </Field>
          <Field label="ຈຳນວນສະບັບ">
            <Input type="number" min={1} max={5} value={f.copies} onChange={(e) => set('copies', Math.min(5, Math.max(1, Number(e.target.value) || 1)))} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-brand-600" checked={f.cut} onChange={(e) => set('cut', e.target.checked)} /> ຕັດກະດາດອັດຕະໂນມັດ (ຖ້າເຄື່ອງມີມີດຕັດ)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-brand-600" checked={f.active} onChange={(e) => set('active', e.target.checked)} /> ເປີດໃຊ້ເຄື່ອງພິມນີ້
        </label>
        {f.role === 'kitchen' && (
          <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
            ເລືອກວ່າໝວດໃດອອກເຄື່ອງນີ້ໄດ້ທີ່ <b>ເມນູອາຫານ → ແກ້ໄຂໝວດ</b>. ໝວດທີ່ບໍ່ໄດ້ເລືອກ ຈະອອກເຄື່ອງພິມຄົວເຄື່ອງທຳອິດ.
          </p>
        )}
      </div>
    </Modal>
  );
}
