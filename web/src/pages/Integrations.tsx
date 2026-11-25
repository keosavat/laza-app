import { useState } from 'react';
import { Copy, KeyRound, ListChecks, Pencil, Plus, RefreshCw, Send, Trash2, Webhook } from 'lucide-react';
import { del, get, post, put } from '../lib/api';
import { dateTime } from '../lib/format';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Spinner, ask, cx, toast, useAction, useLoad } from '../components/ui';

interface Meta { scopes: { id: string; label: string }[]; events: string[] }
interface Key { id: number; name: string; prefix: string; scopes: string[]; auto_confirm: boolean; active: boolean; created_at: string; last_used_at: string | null; revoked_at: string | null }
interface Hook { id: number; url: string; events: string[]; description: string; active: boolean; secret: string; created_at: string; stats: { ok: number | null; waiting: number | null; dead: number | null } }
interface Delivery { id: number; url: string; type: string; status: 'pending' | 'ok' | 'failed' | 'dead'; attempts: number; next_at: string | null; last_status: number | null; last_error: string; response_ms: number | null; created_at: string; delivered_at: string | null }

const EVENT_LABEL: Record<string, string> = {
  'order.created': 'ມີອໍເດີໃໝ່',
  'order.paid': 'ຊຳລະເງິນແລ້ວ',
  'order.cancelled': 'ຍົກເລີກອໍເດີ',
  'shift.closed': 'ປິດກະ',
  'reservation.created': 'ມີການຈອງໂຕະ',
};
const STATUS: Record<Delivery['status'], [string, string]> = {
  ok: ['ສຳເລັດ', 'bg-emerald-100 text-emerald-800'],
  pending: ['ລໍສົ່ງ', 'bg-sky-100 text-sky-800'],
  failed: ['ລົ້ມ-ຈະລອງໃໝ່', 'bg-amber-100 text-amber-800'],
  dead: ['ຍົກເລີກສົ່ງ', 'bg-rose-100 text-rose-700'],
};

export default function Integrations() {
  const [tab, setTab] = useState<'keys' | 'hooks'>('keys');
  return (
    <div className="space-y-4 p-4 lg:p-6">
      <PageHeader title="ການເຊື່ອມຕໍ່ (API / Webhook)" sub="ໃຫ້ແອັບ delivery, ເວັບໄຊ ຫຼື ລະບົບບັນຊີ ເຊື່ອມກັບ LAZA (ສະເພາະເຈົ້າຂອງຮ້ານ). ເບິ່ງວິທີໃຊ້ໃນ docs/API.md" />
      <div className="flex w-fit gap-1 rounded-lg bg-white p-1 shadow-sm">
        {([['keys', 'API keys', KeyRound], ['hooks', 'Webhooks', Webhook]] as const).map(([k, l, Icon]) => (
          <button key={k} onClick={() => setTab(k)} className={cx('flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm', tab === k ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')}><Icon className="size-4" />{l}</button>
        ))}
      </div>
      {tab === 'keys' ? <Keys /> : <Hooks />}
    </div>
  );
}

function useCopy() {
  return async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.ok('ກ໊ອບປີ້ແລ້ວ');
    } catch {
      toast.err('ກ໊ອບປີ້ບໍ່ໄດ້ — ເລືອກຂໍ້ຄວາມແລ້ວກ໊ອບເອງ');
    }
  };
}

/** Shows a secret once, with a copy button. */
function SecretModal({ title, label, value, onClose }: { title: string; label: string; value: string; onClose: () => void }) {
  const copy = useCopy();
  return (
    <Modal open onClose={onClose} title={title} footer={<Button onClick={onClose}>ຂ້ອຍເກັບໄວ້ແລ້ວ</Button>}>
      <div className="space-y-3">
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">ສະແດງ <b>ຄັ້ງດຽວເທົ່ານັ້ນ</b> — ກ໊ອບເກັບໄວ້ດຽວນີ້. ຖ້າເສຍ ຕ້ອງສ້າງໃໝ່. ຢ່າສົ່ງໃຫ້ໃຜທີ່ບໍ່ໄວ້ໃຈ.</p>
        <Field label={label}>
          <div className="flex gap-2">
            <Input readOnly value={value} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
            <Button variant="secondary" onClick={() => copy(value)}><Copy className="size-4" /></Button>
          </div>
        </Field>
      </div>
    </Modal>
  );
}

// ---------------- API keys ----------------

function Keys() {
  const [list, reload, loading] = useLoad(() => get<Key[]>('/integrations/keys'));
  const [meta] = useLoad(() => get<Meta>('/integrations/meta'));
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const { run } = useAction();
  if (loading || !list || !meta) return <Spinner />;
  const label = (s: string) => meta.scopes.find((x) => x.id === s)?.label ?? s;
  return (
    <>
      <div className="flex items-center gap-3">
        <p className="text-sm text-slate-500">API key ໃຫ້ລະບົບພາຍນອກເອີ້ນ <code className="rounded bg-slate-100 px-1">/api/v1/…</code> ໂດຍບໍ່ຕ້ອງໃຊ້ບັນຊີພະນັກງານ. ແຕ່ລະ key ຜູກກັບສາຂາປັດຈຸບັນ.</p>
        <Button className="ml-auto shrink-0" onClick={() => setAdding(true)}><Plus className="size-4" /> ສ້າງ key</Button>
      </div>
      {list.length === 0 ? (
        <Card><Empty>ຍັງບໍ່ມີ API key</Empty></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((k) => (
            <Card key={k.id} className={cx('p-4', !k.active && 'opacity-60')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{k.name}</div>
                  <div className="font-mono text-xs text-slate-500">{k.prefix}…</div>
                </div>
                {k.active ? <Badge className="bg-emerald-100 text-emerald-800">ໃຊ້ງານ</Badge> : <Badge className="bg-slate-200 text-slate-600">ຍົກເລີກແລ້ວ</Badge>}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">{k.scopes.map((s) => <span key={s} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{label(s)}</span>)}</div>
              {k.auto_confirm && <div className="mt-2 text-xs text-brand-700">ອໍເດີຈາກ key ນີ້ສົ່ງເຂົ້າຄົວທັນທີ (ບໍ່ລໍພະນັກງານຢືນຢັນ)</div>}
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-500">
                <span>{k.last_used_at ? `ໃຊ້ລ່າສຸດ ${dateTime(k.last_used_at)}` : 'ຍັງບໍ່ເຄີຍໃຊ້'}</span>
                {k.active && (
                  <Button size="sm" variant="ghost" className="text-rose-600" onClick={async () => {
                    if (!(await ask(`ຍົກເລີກ key "${k.name}"? ລະບົບທີ່ໃຊ້ key ນີ້ຈະເຂົ້າບໍ່ໄດ້ທັນທີ`))) return;
                    if (await run(() => del(`/integrations/keys/${k.id}`), 'ຍົກເລີກແລ້ວ')) reload();
                  }}><Trash2 className="size-4" /> ຍົກເລີກ</Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      {adding && <KeyModal meta={meta} onClose={() => setAdding(false)} onCreated={(key) => { setAdding(false); setShown(key); reload(); }} />}
      {shown && <SecretModal title="API key ໃໝ່" label="API key" value={shown} onClose={() => setShown(null)} />}
    </>
  );
}

function KeyModal({ meta, onClose, onCreated }: { meta: Meta; onClose: () => void; onCreated: (key: string) => void }) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['menu:read', 'orders:read']);
  const [autoConfirm, setAutoConfirm] = useState(false);
  const { busy, run } = useAction();
  const toggle = (s: string) => setScopes(scopes.includes(s) ? scopes.filter((x) => x !== s) : [...scopes, s]);
  const save = async () => {
    const r = await run(() => post<{ key: string }>('/integrations/keys', { name, scopes, autoConfirm }));
    if (r) onCreated(r.key);
  };
  return (
    <Modal open onClose={onClose} title="ສ້າງ API key" footer={<Button onClick={save} loading={busy} disabled={!name.trim() || !scopes.length}>ສ້າງ</Button>}>
      <div className="space-y-4">
        <Field label="ຊື່ (ໃຊ້ຈຳວ່າໃຫ້ໃຜ)"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={60} placeholder="ເຊັ່ນ ເວັບໄຊຮ້ານ, ແອັບ delivery" /></Field>
        <Field label="ສິດທີ່ອະນຸຍາດ" hint="ໃຫ້ສະເພາະສິດທີ່ຈຳເປັນ">
          <div className="space-y-1.5">
            {meta.scopes.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand-600" checked={scopes.includes(s.id)} onChange={() => toggle(s.id)} /> {s.label} <code className="text-xs text-slate-400">{s.id}</code></label>
            ))}
          </div>
        </Field>
        {scopes.includes('orders:write') && (
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={autoConfirm} onChange={(e) => setAutoConfirm(e.target.checked)} />
            <span>ສົ່ງອໍເດີເຂົ້າຄົວທັນທີ<span className="block text-xs text-slate-500">ຖ້າບໍ່ຕິກ: ອໍເດີຈາກ key ນີ້ຈະລໍໃຫ້ພະນັກງານຢືນຢັນກ່ອນ (ມີແຈ້ງເຕືອນ ແລະ ຍັງບໍ່ລວມໃນຍອດບິນ)</span></span>
          </label>
        )}
      </div>
    </Modal>
  );
}

// ---------------- webhooks ----------------

function Hooks() {
  const [list, reload, loading] = useLoad(() => get<Hook[]>('/integrations/webhooks'));
  const [meta] = useLoad(() => get<Meta>('/integrations/meta'));
  const [edit, setEdit] = useState<Partial<Hook> | null>(null);
  const [log, setLog] = useState<Hook | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const { busy, run } = useAction();
  if (loading || !list || !meta) return <Spinner />;

  const test = async (h: Hook) => {
    const r = await run(() => post<{ ok: boolean; last_status: number | null; last_error: string }>(`/integrations/webhooks/${h.id}/test`));
    if (!r) return;
    if (r.ok) toast.ok('ສົ່ງທົດສອບສຳເລັດ');
    else toast.err(`ສົ່ງບໍ່ສຳເລັດ: ${r.last_error || `HTTP ${r.last_status}`}`);
    reload();
  };
  return (
    <>
      <div className="flex items-center gap-3">
        <p className="text-sm text-slate-500">LAZA ສົ່ງຂໍ້ມູນໄປທີ່ URL ຂອງທ່ານເມື່ອມີເຫດການ (ອໍເດີໃໝ່, ຊຳລະ...). ມີລາຍເຊັນ HMAC ໃຫ້ກວດ ແລະ ລອງສົ່ງໃໝ່ອັດຕະໂນມັດເມື່ອລົ້ມ.</p>
        <Button className="ml-auto shrink-0" onClick={() => setEdit({ url: '', description: '', events: ['*'], active: true })}><Plus className="size-4" /> ເພີ່ມ webhook</Button>
      </div>
      {list.length === 0 ? (
        <Card><Empty>ຍັງບໍ່ມີ webhook</Empty></Card>
      ) : (
        <div className="space-y-3">
          {list.map((h) => (
            <Card key={h.id} className={cx('p-4', !h.active && 'opacity-60')}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="break-all font-mono text-sm">{h.url}</div>
                  {h.description && <div className="text-xs text-slate-500">{h.description}</div>}
                </div>
                {h.active ? <Badge className="bg-emerald-100 text-emerald-800">ເປີດ</Badge> : <Badge className="bg-slate-200 text-slate-600">ປິດ</Badge>}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {(h.events[0] === '*' ? meta.events : h.events).map((e) => <span key={e} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{EVENT_LABEL[e] ?? e}</span>)}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-2 text-xs text-slate-500">
                <span>ສຳເລັດ {h.stats.ok ?? 0} · ລໍ/ລອງໃໝ່ {h.stats.waiting ?? 0} · ຍົກເລີກສົ່ງ <b className={cx((h.stats.dead ?? 0) > 0 && 'text-rose-600')}>{h.stats.dead ?? 0}</b></span>
                <span className="ml-auto flex flex-wrap gap-1">
                  <Button size="sm" variant="secondary" loading={busy} onClick={() => test(h)}><Send className="size-4" /> ທົດສອບ</Button>
                  <Button size="sm" variant="ghost" onClick={() => setLog(h)}><ListChecks className="size-4" /> ປະຫວັດສົ່ງ</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEdit(h)}><Pencil className="size-4" /></Button>
                  <Button size="sm" variant="ghost" title="ສ້າງ secret ໃໝ່" onClick={async () => {
                    if (!(await ask('ສ້າງ secret ໃໝ່? secret ເກົ່າຈະໃຊ້ບໍ່ໄດ້ທັນທີ — ຕ້ອງແກ້ຝັ່ງຮັບດ້ວຍ'))) return;
                    const r = await run(() => post<Hook>(`/integrations/webhooks/${h.id}/rotate-secret`));
                    if (r) setSecret(r.secret);
                  }}><RefreshCw className="size-4" /></Button>
                  <Button size="sm" variant="ghost" className="text-rose-600" onClick={async () => {
                    if (!(await ask('ລຶບ webhook ນີ້ ແລະ ປະຫວັດການສົ່ງຂອງມັນ?'))) return;
                    if (await run(() => del(`/integrations/webhooks/${h.id}`), 'ລຶບແລ້ວ')) reload();
                  }}><Trash2 className="size-4" /></Button>
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
      {edit && <HookModal h={edit} meta={meta} onClose={() => setEdit(null)} onSaved={(created) => { setEdit(null); reload(); if (created) setSecret(created.secret); }} />}
      {log && <LogModal h={log} onClose={() => { setLog(null); reload(); }} />}
      {secret && <SecretModal title="Webhook secret" label="Secret (ໃຊ້ກວດລາຍເຊັນ)" value={secret} onClose={() => setSecret(null)} />}
    </>
  );
}

function HookModal({ h, meta, onClose, onSaved }: { h: Partial<Hook>; meta: Meta; onClose: () => void; onSaved: (created?: Hook) => void }) {
  const [url, setUrl] = useState(h.url ?? '');
  const [description, setDescription] = useState(h.description ?? '');
  const [all, setAll] = useState(!h.events || h.events[0] === '*');
  const [events, setEvents] = useState<string[]>(h.events && h.events[0] !== '*' ? h.events : meta.events.slice(0, 2));
  const [active, setActive] = useState(h.active !== false);
  const { busy, run } = useAction();
  const toggle = (e: string) => setEvents(events.includes(e) ? events.filter((x) => x !== e) : [...events, e]);
  const save = async () => {
    const body = { url, description, events: all ? ['*'] : events, active };
    const r = await run(() => (h.id ? put<Hook>(`/integrations/webhooks/${h.id}`, body) : post<Hook>('/integrations/webhooks', body)), 'ບັນທຶກແລ້ວ');
    if (r) onSaved(h.id ? undefined : r);
  };
  return (
    <Modal open onClose={onClose} title={h.id ? 'ແກ້ໄຂ webhook' : 'webhook ໃໝ່'} footer={<Button onClick={save} loading={busy} disabled={!url.trim() || (!all && !events.length)}>ບັນທຶກ</Button>}>
      <div className="space-y-4">
        <Field label="URL ປາຍທາງ" hint="ແນະນຳ https://. http:// ໃຊ້ໄດ້ສຳລັບລະບົບໃນເຄືອຂ່າຍຮ້ານ"><Input value={url} onChange={(e) => setUrl(e.target.value)} autoFocus placeholder="https://example.com/laza-webhook" inputMode="url" /></Field>
        <Field label="ຄຳອະທິບາຍ"><Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={100} placeholder="ເຊັ່ນ ລະບົບບັນຊີ" /></Field>
        <Field label="ເຫດການທີ່ຕ້ອງການ">
          <label className="mb-1.5 flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand-600" checked={all} onChange={(e) => setAll(e.target.checked)} /> ທຸກເຫດການ</label>
          {!all && (
            <div className="space-y-1.5 pl-6">
              {meta.events.map((e) => <label key={e} className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand-600" checked={events.includes(e)} onChange={() => toggle(e)} /> {EVENT_LABEL[e] ?? e} <code className="text-xs text-slate-400">{e}</code></label>)}
            </div>
          )}
        </Field>
        {h.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand-600" checked={active} onChange={(e) => setActive(e.target.checked)} /> ເປີດໃຊ້ງານ</label>}
      </div>
    </Modal>
  );
}

function LogModal({ h, onClose }: { h: Hook; onClose: () => void }) {
  const [rows, reload, loading] = useLoad(() => get<Delivery[]>(`/integrations/deliveries?endpointId=${h.id}`));
  const { busy, run } = useAction();
  return (
    <Modal open onClose={onClose} title="ປະຫວັດການສົ່ງ" footer={<Button variant="secondary" onClick={() => reload()}><RefreshCw className="size-4" /> ຣີເຟຣດ</Button>}>
      <div className="space-y-2">
        <div className="break-all font-mono text-xs text-slate-500">{h.url}</div>
        {loading || !rows ? <Spinner /> : rows.length === 0 ? <Empty>ຍັງບໍ່ມີການສົ່ງ</Empty> : (
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {rows.map((d) => {
              const [label, color] = STATUS[d.status];
              return (
                <div key={d.id} className="flex items-start gap-2 p-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><code className="text-xs">{d.type}</code><Badge className={color}>{label}</Badge></div>
                    <div className="text-xs text-slate-500">{dateTime(d.created_at)} · ລອງ {d.attempts} ຄັ້ງ{d.last_status ? ` · HTTP ${d.last_status}` : ''}{d.response_ms != null ? ` · ${d.response_ms}ms` : ''}</div>
                    {d.last_error && <div className="text-xs text-rose-600">{d.last_error}</div>}
                    {d.status === 'failed' && d.next_at && <div className="text-xs text-amber-700">ລອງໃໝ່ {dateTime(d.next_at)}</div>}
                  </div>
                  {(d.status === 'failed' || d.status === 'dead') && d.type !== 'ping' && (
                    <Button size="sm" variant="secondary" loading={busy} onClick={async () => { await run(() => post(`/integrations/deliveries/${d.id}/retry`)); reload(); }}>ລອງສົ່ງ</Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
