import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post, type CurrentShift, type Shift } from '../lib/api';
import { useSession, useSync } from '../lib/store';
import { dateTime, kip, METHOD_LABEL, since } from '../lib/format';
import { Button, Card, Empty, Field, MoneyInput, PageHeader, Spinner, Textarea, cx, useAction, useLoad } from '../components/ui';

export default function ShiftPage() {
  const nav = useNavigate();
  const refresh = useSession((s) => s.refresh);
  const [cur, reload, loading] = useLoad(() => get<CurrentShift | null>('/shifts/current'));
  const [history, reloadHistory] = useLoad(() => get<(Shift & { opened_by_name: string; closed_by_name: string })[]>('/shifts'));
  const [opening, setOpening] = useState(0);
  const [counted, setCounted] = useState(0);
  const [note, setNote] = useState('');
  const [closedResult, setClosedResult] = useState<{ variance: number; expected: number } | null>(null);
  const { busy, run } = useAction();
  useSync(['shift', 'orders'], () => {
    reload();
    reloadHistory();
  });

  async function open() {
    if (await run(() => post('/shifts/open', { openingCash: opening }), 'ເປີດກະແລ້ວ')) {
      setClosedResult(null);
      await Promise.all([reload(), reloadHistory(), refresh()]);
    }
  }
  async function close() {
    const r = await run(() => post<{ variance: number; summary: { expectedCash: number } }>('/shifts/close', { countedCash: counted, note }), 'ປິດກະແລ້ວ');
    if (r) {
      setClosedResult({ variance: r.variance, expected: r.summary.expectedCash });
      setCounted(0);
      setNote('');
      await Promise.all([reload(), reloadHistory(), refresh()]);
    }
  }

  if (loading) return <Spinner />;
  const s = cur?.summary;
  const variance = s ? counted - s.expectedCash : 0;

  return (
    <div className="space-y-6 p-4 lg:p-6">
      <PageHeader title="ກະ ແລະ ລິ້ນຊັກເງິນ" sub={cur ? `ເປີດໂດຍ ${cur.opened_by_name} · ${dateTime(cur.opened_at)} (${since(cur.opened_at)})` : 'ຍັງບໍ່ມີກະທີ່ເປີດຢູ່'} />

      {closedResult && (
        <Card className={cx('p-4', closedResult.variance === 0 ? 'border-emerald-300 bg-emerald-50' : 'border-amber-300 bg-amber-50')}>
          <div className="font-semibold">ປິດກະສຳເລັດ</div>
          <div className="text-sm">
            ເງິນທີ່ຄວນມີ {kip(closedResult.expected)} · ສ່ວນຕ່າງ{' '}
            <b className={closedResult.variance < 0 ? 'text-rose-600' : 'text-emerald-700'}>{kip(closedResult.variance)}</b>
          </div>
        </Card>
      )}

      {!cur ? (
        <Card className="max-w-md space-y-4 p-5">
          <h2 className="text-lg font-semibold">ເປີດກະໃໝ່</h2>
          <Field label="ເງິນທອນຕັ້ງຕົ້ນໃນລິ້ນຊັກ (ກີບ)">
            <MoneyInput value={opening} onChange={setOpening} placeholder="0" />
          </Field>
          <Button size="lg" className="w-full" onClick={open} loading={busy}>
            ເປີດກະ
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="space-y-3 p-5">
            <h2 className="text-lg font-semibold">ສະຫຼຸບກະປັດຈຸບັນ</h2>
            <Stat l="ຈຳນວນບິນ" v={String(s!.bills)} />
            <Stat l="ຍອດຂາຍ" v={kip(s!.salesTotal)} />
            {!!s!.debtCharged && <Stat l="ໃນນີ້ຕິດໜີ້ (ຍັງບໍ່ໄດ້ເກັບ)" v={kip(s!.debtCharged)} />}
            {!!s!.debtCollected && <Stat l="ຮັບຊຳລະໜີ້ເກົ່າ" v={kip(s!.debtCollected)} />}
            <div className="border-t border-slate-100 pt-2 text-sm font-semibold text-slate-600">ແຍກຕາມວິທີຊຳລະ</div>
            {s!.byMethod.length === 0 && <div className="text-sm text-slate-400">ຍັງບໍ່ມີການຊຳລະ</div>}
            {s!.byMethod.map((m) => (
              <Stat key={m.method + m.currency} l={`${METHOD_LABEL[m.method]} ${m.currency !== 'LAK' ? `(${m.currency} ${m.amount.toLocaleString('en-US')})` : ''} · ${m.n}`} v={kip(m.amount_lak)} />
            ))}
            <div className="border-t border-slate-100 pt-2 text-sm font-semibold text-slate-600">ລິ້ນຊັກເງິນສົດ</div>
            <Stat l="ເງິນທອນຕັ້ງຕົ້ນ" v={kip(s!.openingCash)} />
            <Stat l="+ ຮັບເງິນສົດ" v={kip(s!.cashIn)} />
            <Stat l="− ທອນໃຫ້ລູກຄ້າ" v={kip(s!.change)} />
            {!!s!.depositCash && <Stat l={s!.depositCash > 0 ? '+ ມັດຈຳຂວດ/ຄັງ (ຮັບ − ຄືນ)' : '− ຄືນມັດຈຳຂວດ/ຄັງ (ສຸດທິ)'} v={kip(Math.abs(s!.depositCash))} />}
            <Stat l="= ເງິນທີ່ຄວນມີໃນລິ້ນຊັກ" v={kip(s!.expectedCash)} strong />
          </Card>
          <Card className="space-y-4 p-5">
            <h2 className="text-lg font-semibold">ປິດກະ</h2>
            {cur.openOrders.n > 0 && (
              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                ຍັງມີ {cur.openOrders.n} ອໍເດີທີ່ບໍ່ໄດ້ຊຳລະ ({kip(cur.openOrders.total)}). ອໍເດີເຫຼົ່ານີ້ຈະຍັງເປີດຢູ່ ແລະ ນັບເຂົ້າກະຖັດໄປເມື່ອຊຳລະ.
                <button onClick={() => nav('/tables')} className="ml-1 font-semibold underline">ເບິ່ງໂຕະ</button>
              </div>
            )}
            <Field label="ເງິນສົດທີ່ນັບໄດ້ຈິງ (ທຽບເທົ່າກີບ)" hint="ນັບເງິນໃນລິ້ນຊັກ ລວມເງິນຕາຕ່າງປະເທດ ແປງເປັນກີບ">
              <MoneyInput value={counted} onChange={setCounted} placeholder="0" />
            </Field>
            {counted > 0 && (
              <div className={cx('rounded-lg p-3 text-sm font-medium', variance === 0 ? 'bg-emerald-50 text-emerald-700' : variance < 0 ? 'bg-rose-50 text-rose-700' : 'bg-sky-50 text-sky-700')}>
                {variance === 0 ? 'ເງິນຖືກຕ້ອງ' : variance < 0 ? `ເງິນຂາດ ${kip(-variance)}` : `ເງິນເກີນ ${kip(variance)}`}
              </div>
            )}
            <Field label="ໝາຍເຫດ">
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
            </Field>
            <Button variant="danger" size="lg" className="w-full" onClick={close} loading={busy}>
              ປິດກະ
            </Button>
          </Card>
        </div>
      )}

      <Card className="overflow-x-auto">
        <div className="border-b border-slate-100 px-4 py-3 font-semibold">ປະຫວັດກະ</div>
        {!history?.length ? (
          <Empty>ຍັງບໍ່ມີ</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">ເປີດ</th>
                <th className="px-4 py-2 font-medium">ປິດ</th>
                <th className="px-4 py-2 text-right font-medium">ຕັ້ງຕົ້ນ</th>
                <th className="px-4 py-2 text-right font-medium">ຄວນມີ</th>
                <th className="px-4 py-2 text-right font-medium">ນັບໄດ້</th>
                <th className="px-4 py-2 text-right font-medium">ສ່ວນຕ່າງ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.map((h) => {
                const v = h.counted_cash != null && h.expected_cash != null ? h.counted_cash - h.expected_cash : null;
                return (
                  <tr key={h.id}>
                    <td className="px-4 py-2">{dateTime(h.opened_at)}<div className="text-xs text-slate-400">{h.opened_by_name}</div></td>
                    <td className="px-4 py-2">{h.status === 'open' ? <span className="text-emerald-600">ເປີດຢູ່</span> : <>{dateTime(h.closed_at)}<div className="text-xs text-slate-400">{h.closed_by_name}</div></>}</td>
                    <td className="tabular px-4 py-2 text-right">{kip(h.opening_cash)}</td>
                    <td className="tabular px-4 py-2 text-right">{h.expected_cash != null ? kip(h.expected_cash) : '—'}</td>
                    <td className="tabular px-4 py-2 text-right">{h.counted_cash != null ? kip(h.counted_cash) : '—'}</td>
                    <td className={cx('tabular px-4 py-2 text-right font-medium', v != null && v < 0 && 'text-rose-600', v != null && v > 0 && 'text-sky-600')}>{v != null ? kip(v) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function Stat({ l, v, strong }: { l: string; v: string; strong?: boolean }) {
  return (
    <div className={cx('flex justify-between text-sm', strong && 'text-base font-bold text-brand-700')}>
      <span>{l}</span>
      <span className="tabular">{v}</span>
    </div>
  );
}
