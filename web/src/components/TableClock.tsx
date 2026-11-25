// The clock of a time-billed table: live time, running charge, pause / resume / stop, and (managers) fixing the start time.
import { useEffect, useMemo, useState } from 'react';
import { Pause, Play, Square, TimerReset, Timer as TimerIcon } from 'lucide-react';
import { post, type Order } from '../lib/api';
import { useSession } from '../lib/store';
import { can, kip, time } from '../lib/format';
import { clock, timeCharge, useNow } from '../lib/timed';
import { Button, Field, Input, Modal, cx, useAction } from './ui';

const pad = (n: number) => String(n).padStart(2, '0');
/** Value for <input type="datetime-local"> in the browser's own timezone. */
const localInput = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function TableClock({ order, onChanged }: { order: Order; onChanged: () => void }) {
  const role = useSession((s) => s.user?.role);
  const { busy, run } = useAction();
  const [adjust, setAdjust] = useState(false);
  const t = order.timer;
  const live = !!t && !t.ended && !t.paused;
  const nowMs = useNow(live);
  // The server's clock may differ a little from this device's: tick relative to the server time we were given.
  const skew = useMemo(() => (t ? Date.parse(t.now) - Date.now() : 0), [t?.now]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the order total (which includes the time line) in step with the clock.
  useEffect(() => {
    if (!live) return;
    const x = setInterval(onChanged, 30_000);
    return () => clearInterval(x);
  }, [live, onChanged]);

  const open = order.status === 'open';
  const act = async (path: string) => {
    if (await run(() => post(`/orders/${order.id}/timer/${path}`))) onChanged();
  };

  if (!t) {
    if (!open || !order.table_rate) return null;
    return (
      <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">
        <span className="flex items-center gap-2 text-amber-900"><TimerIcon className="size-4" /> ໂຕະຄິດເວລາ ({kip(order.table_rate)}/ຊມ) ຍັງບໍ່ໄດ້ເລີ່ມນັບ</span>
        <Button size="sm" loading={busy} onClick={() => act('start')}><Play className="size-4" /> ເລີ່ມນັບເວລາ</Button>
      </div>
    );
  }

  const c = timeCharge(t, nowMs + skew);
  const state = t.ended ? 'ຈົບແລ້ວ' : t.paused ? 'ພັກເວລາ' : 'ກຳລັງນັບ';
  return (
    <div className={cx('mt-3 rounded-xl border-2 p-3', t.ended ? 'border-slate-300 bg-slate-50' : t.paused ? 'border-amber-400 bg-amber-50' : 'border-brand-500 bg-brand-50')}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600"><TimerIcon className="size-3.5" /> {state} · ເລີ່ມ {time(t.started_at)}</div>
          <div className={cx('tabular text-3xl font-bold leading-tight', t.paused && 'text-amber-700', live && 'text-brand-700')}>{clock(c.seconds)}</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">ຄ່າເວລາຕອນນີ້</div>
          <div className="tabular text-xl font-bold">{kip(c.charge)}</div>
          <div className="text-[11px] text-slate-500">{kip(t.rate)}/ຊມ · ຄິດເປັນຊ່ວງ {t.step} ນາທີ{t.min_minutes > 0 && ` · ຂັ້ນຕ່ຳ ${t.min_minutes} ນາທີ`}</div>
        </div>
      </div>
      {open && !t.ended && (
        <div className="mt-3 flex flex-wrap gap-2">
          {t.paused ? (
            <Button size="sm" loading={busy} onClick={() => act('resume')}><Play className="size-4" /> ສືບຕໍ່</Button>
          ) : (
            <Button size="sm" variant="secondary" loading={busy} onClick={() => act('pause')}><Pause className="size-4" /> ພັກເວລາ</Button>
          )}
          <Button size="sm" variant="secondary" loading={busy} onClick={() => act('stop')}><Square className="size-4" /> ຢຸດນັບ</Button>
          {can(role, 'voidItem') && (
            <Button size="sm" variant="ghost" onClick={() => setAdjust(true)}><TimerReset className="size-4" /> ແກ້ເວລາເລີ່ມ</Button>
          )}
        </div>
      )}
      {t.ended && open && <div className="mt-2 text-xs text-slate-500">ຢຸດນັບແລ້ວ — ຍອດຄ່າເວລາຄົງທີ່. ພິມບິນ ແລະ ຊຳລະໄດ້ເລີຍ.</div>}
      {adjust && <AdjustModal order={order} onClose={() => setAdjust(false)} onDone={onChanged} />}
    </div>
  );
}

function AdjustModal({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const [at, setAt] = useState(localInput(order.timer!.started_at));
  const [reason, setReason] = useState('');
  const { busy, run } = useAction();
  const save = async () => {
    if (await run(() => post(`/orders/${order.id}/timer/adjust`, { startedAt: new Date(at).toISOString(), reason }), 'ແກ້ເວລາເລີ່ມແລ້ວ')) {
      onDone();
      onClose();
    }
  };
  return (
    <Modal open onClose={onClose} title="ແກ້ເວລາເລີ່ມ" footer={<Button onClick={save} loading={busy} disabled={!at}>ບັນທຶກ</Button>}>
      <div className="space-y-4">
        <Field label="ເວລາເລີ່ມ" hint="ໃຊ້ເມື່ອພະນັກງານລືມກົດເລີ່ມ. ຕັ້ງໄດ້ຍ້ອນຫຼັງບໍ່ເກີນ 24 ຊົ່ວໂມງ ແລະ ບໍ່ເປັນອະນາຄົດ. ການແກ້ຖືກບັນທຶກໃນປະຫວັດການກະທຳ.">
          <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </Field>
        <Field label="ເຫດຜົນ"><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="ເຊັ່ນ ລືມກົດເລີ່ມ" /></Field>
      </div>
    </Modal>
  );
}
