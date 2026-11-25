// Clock controls for time-billed tables.
import { Router } from 'express';
import type { Ctx } from '../app.ts';
import { requirePerm } from '../auth.ts';
import { now } from '../db.ts';
import { bad, conflict, int } from '../lib/core.ts';
import { loadOrder, requireOpen } from '../lib/orders.ts';
import { endSession, pauseSession, resumeSession, sessionOf, startSession, syncTime, timerState } from '../lib/timed.ts';

export function timerRoutes({ db, emit }: Ctx) {
  const r = Router();
  const changed = (bid: number) => emit(bid, ['orders', 'tables']);
  const open = (req: any) => {
    const o = loadOrder(db, int(req.params.id, 'id'), req.user.bid);
    requireOpen(o);
    return o;
  };

  r.get('/orders/:id/timer', (req, res) => {
    const o = loadOrder(db, int(req.params.id, 'id'), req.user.bid);
    if (o.status === 'open') syncTime(db, o.id);
    res.json(timerState(db, o.id));
  });

  /** For an order on a time-billed table that is not counting yet (e.g. it was moved there). */
  r.post('/orders/:id/timer/start', requirePerm('pos'), (req, res) => {
    const o = open(req);
    if (!o.table_id) throw bad('ອໍເດີນີ້ບໍ່ມີໂຕະ');
    db.tx(() => {
      startSession(db, { bid: req.user.bid, uid: req.user.uid, orderId: o.id, tableId: o.table_id });
      db.audit(req.user.bid, req.user.uid, 'timer_start', 'order', o.id);
    });
    changed(req.user.bid);
    res.status(201).json(timerState(db, o.id));
  });

  r.post('/orders/:id/timer/pause', requirePerm('pos'), (req, res) => {
    const o = open(req);
    db.tx(() => {
      pauseSession(db, o.id);
      db.audit(req.user.bid, req.user.uid, 'timer_pause', 'order', o.id);
    });
    changed(req.user.bid);
    res.json(timerState(db, o.id));
  });

  r.post('/orders/:id/timer/resume', requirePerm('pos'), (req, res) => {
    const o = open(req);
    db.tx(() => {
      resumeSession(db, o.id);
      syncTime(db, o.id);
      db.audit(req.user.bid, req.user.uid, 'timer_resume', 'order', o.id);
    });
    changed(req.user.bid);
    res.json(timerState(db, o.id));
  });

  /** The players are done: freeze the charge (the bill can then be printed and paid). */
  r.post('/orders/:id/timer/stop', requirePerm('pos'), (req, res) => {
    const o = open(req);
    db.tx(() => {
      if (!sessionOf(db, o.id)) throw bad('ອໍເດີນີ້ບໍ່ໄດ້ນັບເວລາ');
      endSession(db, o.id);
      db.audit(req.user.bid, req.user.uid, 'timer_stop', 'order', o.id);
    });
    changed(req.user.bid);
    res.json(timerState(db, o.id));
  });

  /** Fix the start time when staff forgot to start the clock (manager only, never into the future). */
  r.post('/orders/:id/timer/adjust', requirePerm('voidItem'), (req, res) => {
    const o = open(req);
    const at = Date.parse(String(req.body.startedAt ?? ''));
    if (!Number.isFinite(at)) throw bad('ເວລາເລີ່ມບໍ່ຖືກຕ້ອງ');
    if (at > Date.now()) throw bad('ເວລາເລີ່ມຕ້ອງບໍ່ແມ່ນອະນາຄົດ');
    if (Date.now() - at > 24 * 3_600_000) throw bad('ແກ້ເວລາເລີ່ມຍ້ອນຫຼັງໄດ້ບໍ່ເກີນ 24 ຊົ່ວໂມງ');
    const reason = String(req.body.reason ?? '').trim().slice(0, 200);
    db.tx(() => {
      const s = sessionOf(db, o.id);
      if (!s) throw bad('ອໍເດີນີ້ບໍ່ໄດ້ນັບເວລາ');
      if (s.ended_at) throw conflict('ການນັບເວລາຈົບແລ້ວ');
      db.run('UPDATE table_sessions SET started_at = ? WHERE id = ?', new Date(at).toISOString(), s.id);
      syncTime(db, o.id);
      db.audit(req.user.bid, req.user.uid, 'timer_adjust', 'order', o.id, { from: s.started_at, to: new Date(at).toISOString(), reason, at: now() });
    });
    changed(req.user.bid);
    res.json(timerState(db, o.id));
  });

  return r;
}
