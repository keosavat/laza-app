import { useState, type ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Bot, CheckCircle2, Info, KeyRound, Lightbulb, Send, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react';
import { get, post, put } from '../lib/api';
import { useSession } from '../lib/store';
import { kip } from '../lib/format';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Spinner, cx, useAction, useLoad } from '../components/ui';

type Class = 'star' | 'plowhorse' | 'puzzle' | 'dog';
interface Item { id: number; name: string; qty: number; revenue: number; cost: number; profit: number; marginPct: number; unitProfit: number; class: Class | null }
interface Summary { bills: number; sales: number; avgBill: number; discount: number; discountPct: number; cancelled: number; cancelledPct: number; cost: number; grossProfit: number; marginPct: number }
interface Insights {
  insights: { level: 'good' | 'warn' | 'info'; text: string }[];
  range: { from: string; to: string; days: number };
  summary: Summary;
  previous: Summary;
  byHour: { hour: number; bills: number; sales: number }[];
  byWeekday: { weekday: number; name: string; days: number; sales: number; avgPerDay: number }[];
  items: Item[];
  unsold: { id: number; name: string }[];
  categories: { name: string; revenue: number; sharePct: number; marginPct: number }[];
  classLabels: Record<Class, string>;
}
interface Status {
  enabled: boolean; hasKey: boolean; keySource: 'env' | 'db' | null; keyPreview: string | null; model: string; defaultModel: string; dailyLimit: number; ready: boolean;
  usage: { today: number; monthRequests: number; monthInputTokens: number; monthOutputTokens: number };
}
interface AiOut { text: string; truncated: boolean; refused: boolean; model: string; usage: Status['usage']; toolCalls?: string[] }

const CLASS_STYLE: Record<Class, string> = { star: 'bg-emerald-100 text-emerald-800', plowhorse: 'bg-amber-100 text-amber-800', puzzle: 'bg-sky-100 text-sky-800', dog: 'bg-slate-200 text-slate-600' };
const SUGGESTIONS = ['ເມນູໃດຂາຍດີສຸດ ແລະ ກຳໄລດີສຸດ?', 'ມື້ໃດຂອງອາທິດຂາຍເບົາ ແລະ ຄວນເຮັດຫຍັງ?', 'ເມນູໃດຄວນເອົາອອກ ຫຼື ປັບລາຄາ?', 'ຊ່ວງເວລາໃດຄວນເພີ່ມພະນັກງານ?'];
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export default function AiInsights() {
  const branch = useSession((s) => s.branch);
  const today = isoDay(new Date(Date.now() + (branch?.utc_offset_min ?? 420) * 60_000));
  const [days, setDays] = useState(30);
  const from = isoDay(new Date(Date.parse(today) - (days - 1) * 86_400_000));
  const [d, , loading] = useLoad(() => get<Insights>(`/ai/insights?from=${from}&to=${today}`), [from, today]);
  const [filter, setFilter] = useState<Class | 'all'>('all');

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <PageHeader title="AI ວິເຄາະທຸລະກິດ" sub="ສະຫຼຸບຍອດຂາຍ ວິເຄາະເມນູ ແລະ ໃຫ້ຄຳແນະນຳ — ສ່ວນຂໍ້ສັງເກດອັດຕະໂນມັດບໍ່ຕ້ອງໃຊ້ AI ແລະ ບໍ່ເສຍເງິນ" />
      <div className="flex flex-wrap items-center gap-2">
        {[7, 30, 90].map((n) => (
          <button key={n} onClick={() => setDays(n)} className={cx('rounded-full border px-3 py-1 text-sm', days === n ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-300 bg-white text-slate-600')}>{n} ວັນຜ່ານມາ</button>
        ))}
        <span className="text-xs text-slate-500">{from} → {today}</span>
      </div>

      {loading || !d ? <Spinner /> : d.summary.bills === 0 ? (
        <Card><Empty>ຍັງບໍ່ມີການຂາຍໃນໄລຍະນີ້ — ເມື່ອມີບິນທີ່ຊຳລະແລ້ວ ຈະວິເຄາະໃຫ້ອັດຕະໂນມັດ</Empty></Card>
      ) : (
        <>
          <Kpis d={d} />
          <Card className="p-4">
            <h2 className="mb-2 flex items-center gap-2 font-semibold"><Lightbulb className="size-4 text-amber-500" /> ຂໍ້ສັງເກດອັດຕະໂນມັດ</h2>
            <ul className="space-y-2">
              {d.insights.map((i, k) => (
                <li key={k} className={cx('flex items-start gap-2 rounded-lg px-3 py-2 text-sm', i.level === 'warn' ? 'bg-amber-50 text-amber-900' : i.level === 'good' ? 'bg-emerald-50 text-emerald-900' : 'bg-slate-50 text-slate-700')}>
                  {i.level === 'warn' ? <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" /> : i.level === 'good' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <Info className="mt-0.5 size-4 shrink-0 text-slate-400" />}
                  <span>{i.text}</span>
                </li>
              ))}
            </ul>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4"><h2 className="mb-3 font-semibold">ຍອດຂາຍຕາມຊົ່ວໂມງ</h2><Bars data={d.byHour.map((h) => ({ label: String(h.hour), value: h.sales }))} /></Card>
            <Card className="p-4"><h2 className="mb-3 font-semibold">ສະເລ່ຍຕໍ່ມື້ ຕາມວັນໃນອາທິດ</h2><Bars data={d.byWeekday.map((w) => ({ label: w.name, value: w.avgPerDay }))} tall /></Card>
          </div>
          <MenuTable d={d} filter={filter} setFilter={setFilter} />
        </>
      )}
      <AiPanel days={days} from={from} to={today} hasSales={!!d && d.summary.bills > 0} />
    </div>
  );
}

function Kpis({ d }: { d: Insights }) {
  const ch = d.previous.sales > 0 ? Math.round(((d.summary.sales - d.previous.sales) / d.previous.sales) * 100) : null;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <div className="rounded-xl border border-brand-200 bg-brand-50 p-4">
        <div className="text-sm text-slate-500">ຍອດຂາຍ {d.range.days} ວັນ</div>
        <div className="tabular mt-1 text-xl font-bold text-brand-700">{kip(d.summary.sales)}</div>
        {ch !== null && <div className={cx('mt-0.5 flex items-center text-xs font-medium', ch >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{ch >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}{Math.abs(ch)}% ທຽບໄລຍະກ່ອນ</div>}
      </div>
      <Kpi k="ຈຳນວນບິນ" v={d.summary.bills.toLocaleString('en-US')} />
      <Kpi k="ສະເລ່ຍ/ບິນ" v={kip(d.summary.avgBill)} />
      <Kpi k="ກຳໄລເບື້ອງຕົ້ນ" v={kip(d.summary.grossProfit)} sub={`${d.summary.marginPct}%`} />
    </div>
  );
}
const Kpi = ({ k, v, sub }: { k: string; v: string; sub?: string }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-sm text-slate-500">{k}</div><div className="tabular mt-1 text-xl font-bold">{v}</div>{sub && <div className="text-xs text-slate-500">{sub}</div>}</div>
);

function Bars({ data, tall }: { data: { label: string; value: number }[]; tall?: boolean }) {
  const max = Math.max(1, ...data.map((x) => x.value));
  return (
    <div className={cx('flex items-end gap-1', tall ? 'h-36' : 'h-28')}>
      {data.map((x) => (
        <div key={x.label} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${x.label}: ${kip(x.value)}`}>
          <div className={cx('rounded-t', x.value === max && x.value > 0 ? 'bg-brand-600' : 'bg-brand-300')} style={{ height: `${x.value ? Math.max(3, (x.value / max) * 100) : 0}%` }} />
          <div className="mt-1 truncate text-center text-[10px] text-slate-400">{x.label}</div>
        </div>
      ))}
    </div>
  );
}

function MenuTable({ d, filter, setFilter }: { d: Insights; filter: Class | 'all'; setFilter: (c: Class | 'all') => void }) {
  const rows = d.items.filter((i) => filter === 'all' || i.class === filter);
  const count = (c: Class) => d.items.filter((i) => i.class === c).length;
  return (
    <Card className="p-4">
      <h2 className="mb-1 font-semibold">ວິເຄາະເມນູ (ຍອດຂາຍ × ກຳໄລ)</h2>
      <p className="mb-3 text-xs text-slate-500">ແບ່ງເມນູຕາມຄວາມນິຍົມ ແລະ ກຳໄລຕໍ່ຈານ. ເມນູທີ່ບໍ່ໄດ້ໃສ່ຕົ້ນທຶນ ຈະບໍ່ຖືກຈັດກຸ່ມ.</p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <button onClick={() => setFilter('all')} className={cx('rounded-full border px-3 py-1 text-xs', filter === 'all' ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-300 bg-white text-slate-600')}>ທັງໝົດ {d.items.length}</button>
        {(Object.keys(d.classLabels) as Class[]).map((c) => (
          <button key={c} onClick={() => setFilter(c)} className={cx('rounded-full border px-3 py-1 text-xs', filter === c ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-300 bg-white text-slate-600')}>{d.classLabels[c]} {count(c)}</button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead><tr className="border-b border-slate-200 text-left text-xs text-slate-500"><th className="py-1.5">ເມນູ</th><th className="text-right">ຂາຍ</th><th className="text-right">ລາຍຮັບ</th><th className="text-right">ກຳໄລ</th><th className="text-right">%</th><th className="pl-3">ກຸ່ມ</th></tr></thead>
          <tbody>
            {rows.slice(0, 40).map((i) => (
              <tr key={i.id} className="border-b border-slate-50">
                <td className="max-w-[14rem] truncate py-1.5">{i.name}</td>
                <td className="tabular text-right">{i.qty}</td>
                <td className="tabular text-right">{kip(i.revenue)}</td>
                <td className="tabular text-right">{i.cost > 0 ? kip(i.profit) : '—'}</td>
                <td className="tabular text-right">{i.cost > 0 ? `${i.marginPct}%` : '—'}</td>
                <td className="pl-3">{i.class ? <Badge className={CLASS_STYLE[i.class]}>{d.classLabels[i.class].split(' (')[0]}</Badge> : <span className="text-xs text-slate-400">ບໍ່ມີຕົ້ນທຶນ</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="py-4 text-center text-sm text-slate-400">ບໍ່ມີເມນູໃນກຸ່ມນີ້</div>}
      </div>
      {d.unsold.length > 0 && filter === 'all' && <p className="mt-3 text-xs text-slate-500">ບໍ່ມີການຂາຍເລີຍ ({d.unsold.length}): {d.unsold.slice(0, 12).map((u) => u.name).join(', ')}{d.unsold.length > 12 && '…'}</p>}
    </Card>
  );
}

// ---------------- AI ----------------

/** Minimal, safe rendering of the model's text: "##" headings, "-" bullets, **bold**. No HTML is ever injected. */
function Md({ text }: { text: string }) {
  const inline = (s: string): ReactNode[] => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p));
  const out: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) out.push(<ul key={`u${out.length}`} className="ml-5 list-disc space-y-1">{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
    list = [];
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (/^[-*•]\s+/.test(line)) list.push(line.replace(/^[-*•]\s+/, ''));
    else {
      flush();
      if (/^#{1,3}\s+/.test(line)) out.push(<h3 key={out.length} className="mt-3 font-semibold text-slate-800">{inline(line.replace(/^#{1,3}\s+/, ''))}</h3>);
      else if (line) out.push(<p key={out.length}>{inline(line)}</p>);
    }
  }
  flush();
  return <div className="space-y-2 text-sm leading-relaxed text-slate-700">{out}</div>;
}

function AiPanel({ days, from, to, hasSales }: { days: number; from: string; to: string; hasSales: boolean }) {
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const [st, reload, loading] = useLoad(() => get<Status>('/ai/status'));
  const [setup, setSetup] = useState(false);
  const [summary, setSummary] = useState<AiOut | null>(null);
  const [answer, setAnswer] = useState<(AiOut & { q: string }) | null>(null);
  const [q, setQ] = useState('');
  const { busy, run } = useAction();
  if (loading || !st) return <Spinner />;

  const doSummary = async () => {
    const r = await run(() => post<AiOut>('/ai/summary', { from, to }));
    if (r) { setSummary(r); reload(); }
  };
  const doAsk = async (question: string) => {
    if (!question.trim()) return;
    const r = await run(() => post<AiOut>('/ai/ask', { question, from, to }));
    if (r) { setAnswer({ ...r, q: question }); reload(); }
  };

  return (
    <Card className="border-violet-200 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 font-semibold"><Bot className="size-5 text-violet-600" /> ຜູ້ຊ່ວຍ AI (Claude)</h2>
        {st.ready ? <Badge className="bg-emerald-100 text-emerald-800">ພ້ອມໃຊ້</Badge> : <Badge className="bg-slate-200 text-slate-600">ຍັງບໍ່ເປີດ</Badge>}
        {isOwner && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSetup(true)}><KeyRound className="size-4" /> ຕັ້ງຄ່າ AI</Button>}
      </div>

      {!st.ready ? (
        <div className="mt-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
          <p>AI ຊ່ວຍອ່ານຂໍ້ມູນຂ້າງເທິງ ແລ້ວຂຽນສະຫຼຸບ ແລະ ຕອບຄຳຖາມເປັນພາສາລາວ. ຕ້ອງເປີດໃຊ້ ແລະ ໃສ່ API key ຂອງ Claude (ມີຄ່າໃຊ້ຈ່າຍຕາມການໃຊ້ງານ ກັບ Anthropic).</p>
          <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-500"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" /> ສົ່ງໃຫ້ AI ສະເພາະຕົວເລກລວມ ແລະ ຊື່ເມນູ — ບໍ່ສົ່ງຊື່/ເບີໂທລູກຄ້າ ຫຼື ຊື່ພະນັກງານ.</p>
          {isOwner ? <Button className="mt-3" onClick={() => setSetup(true)}><Sparkles className="size-4" /> ເປີດໃຊ້ AI</Button> : <p className="mt-2 text-xs">ໃຫ້ເຈົ້າຂອງຮ້ານເປີດໃຊ້ໃນ "ຕັ້ງຄ່າ AI"</p>}
        </div>
      ) : (
        <div className="mt-3 space-y-5">
          <div>
            <Button onClick={doSummary} loading={busy} disabled={!hasSales}><Sparkles className="size-4" /> ໃຫ້ AI ສະຫຼຸບ ແລະ ແນະນຳ ({days} ວັນ)</Button>
            {summary && (
              <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/40 p-4">
                {summary.refused && <Badge className="mb-2 bg-rose-100 text-rose-700">AI ປະຕິເສດ</Badge>}
                <Md text={summary.text} />
                {summary.truncated && <p className="mt-2 text-xs text-amber-700">ຄຳຕອບຖືກຕັດທອນ ເພາະຍາວເກີນ</p>}
              </div>
            )}
          </div>
          <div>
            <div className="mb-1 text-sm font-medium">ຖາມກ່ຽວກັບຮ້ານຂອງທ່ານ</div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void doAsk(q); }}>
              <Input value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} placeholder="ເຊັ່ນ ເມນູໃດຂາຍບໍ່ດີ ແລະ ຄວນເຮັດແນວໃດ?" />
              <Button type="submit" loading={busy} disabled={!q.trim()}><Send className="size-4" /> ຖາມ</Button>
            </form>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => <button key={s} onClick={() => { setQ(s); void doAsk(s); }} disabled={busy} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:border-violet-400 disabled:opacity-50">{s}</button>)}
            </div>
            {answer && (
              <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/40 p-4">
                <div className="mb-2 text-xs text-slate-500">ຄຳຖາມ: {answer.q}</div>
                <Md text={answer.text} />
              </div>
            )}
          </div>
          <p className="text-xs text-slate-500">
            ໂມເດລ {st.model} · ໃຊ້ມື້ນີ້ {st.usage.today}/{st.dailyLimit} ຄັ້ງ · ເດືອນນີ້ {st.usage.monthRequests} ຄັ້ງ ({(st.usage.monthInputTokens + st.usage.monthOutputTokens).toLocaleString('en-US')} tokens). AI ອາດຜິດພາດ — ກວດຕົວເລກກ່ອນຕັດສິນໃຈ.
          </p>
        </div>
      )}
      {setup && <SetupModal st={st} onClose={() => setSetup(false)} onSaved={() => { setSetup(false); reload(); }} />}
    </Card>
  );
}

function SetupModal({ st, onClose, onSaved }: { st: Status; onClose: () => void; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(st.enabled);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(st.model);
  const [limit, setLimit] = useState(st.dailyLimit);
  const { busy, run } = useAction();
  const save = async () => {
    const body: Record<string, unknown> = { enabled, model, dailyLimit: limit };
    if (apiKey.trim()) body.apiKey = apiKey.trim();
    if (await run(() => put('/ai/settings', body), 'ບັນທຶກແລ້ວ')) onSaved();
  };
  return (
    <Modal open onClose={onClose} title="ຕັ້ງຄ່າ AI" footer={<Button onClick={save} loading={busy}>ບັນທຶກ</Button>}>
      <div className="space-y-4">
        <label className="flex items-start gap-3 rounded-xl border-2 border-slate-200 p-3">
          <input type="checkbox" className="mt-1 size-4 accent-brand-600" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span className="text-sm">
            <b>ເປີດໃຊ້ AI ວິເຄາະ</b>
            <span className="mt-1 block text-xs text-slate-500">ເມື່ອເປີດ ເຊີບເວີຈະສົ່ງຕົວເລກລວມ (ຍອດຂາຍ, ຈຳນວນບິນ, ຍອດຕາມຊົ່ວໂມງ/ເມນູ, ຕົ້ນທຶນ) ແລະ ຊື່ເມນູ ໄປຍັງ Anthropic (Claude API) ເພື່ອປະມວນຜົນ. <b>ບໍ່ສົ່ງ</b>ຊື່/ເບີໂທລູກຄ້າ, ຊື່ພະນັກງານ ຫຼື ລະຫັດຜ່ານ.</span>
          </span>
        </label>
        <Field label="Claude API key" hint={st.keySource === 'env' ? 'ເຊີບເວີຕັ້ງ key ຜ່ານ environment (LAZA_ANTHROPIC_API_KEY) ແລ້ວ — ໃຊ້ອັນນັ້ນກ່ອນ' : st.keyPreview ? `ມີ key ເກັບໄວ້ແລ້ວ (${st.keyPreview}) — ປ່ອຍວ່າງຖ້າບໍ່ປ່ຽນ` : 'ເອົາຈາກ console.anthropic.com → API keys. ເກັບໃນຖານຂໍ້ມູນຂອງເຊີບເວີ ແລະ ບໍ່ສົ່ງກັບມາສະແດງອີກ'}>
          <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-ant-…" autoComplete="off" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ໂມເດລ" hint={`ຄ່າເລີ່ມຕົ້ນ ${st.defaultModel}. ໂມເດລນ້ອຍກວ່າ (ເຊັ່ນ claude-sonnet-5-5) ຖືກກວ່າ`}><Input value={model} onChange={(e) => setModel(e.target.value)} /></Field>
          <Field label="ຂີດຈຳກັດຕໍ່ມື້ (ຄັ້ງ)" hint="ກັນຄ່າໃຊ້ຈ່າຍບານປາຍ"><Input type="number" min={1} max={500} value={limit} onChange={(e) => setLimit(Number(e.target.value) || 1)} /></Field>
        </div>
      </div>
    </Modal>
  );
}
