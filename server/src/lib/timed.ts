// Time-billed tables (billiards, karaoke rooms, ping-pong…): the table earns by the hour instead of by the dish.
// A running session adds one "ຄ່າເວລາ" line to the order; the line's price follows the clock until the bill is paid.
import type { Db, Row } from '../db.ts';
import { now } from '../db.ts';
import { bad, conflict } from './core.ts';
import { recalc } from './orders.ts';

export const TIME_ITEM_NAME = 'ຄ່າເວລາ';
export const STEPS = [1, 5, 10, 15, 30, 60] as const;

export interface Sess {
  started_at: string;
  ended_at: string | null;
  paused_at: string | null;
  paused_sec: number;
  rate: number; // ₭ per hour, frozen when the session started
  step: number; // billed in blocks of this many minutes (rounded up)
  min_minutes: number;
}

/** Seconds actually played: pauses are not counted. */
export function activeSeconds(s: Sess, nowMs: number): number {
  const end = s.ended_at ? Date.parse(s.ended_at) : s.paused_at ? Date.parse(s.paused_at) : nowMs;
  return Math.max(0, Math.floor((end - Date.parse(s.started_at)) / 1000) - s.paused_sec);
}

/** Minutes billed (rounded up to the step, at least the minimum) and the charge in ₭. Nothing is charged before any time has passed. */
export function timeCharge(s: Sess, nowMs: number) {
  const seconds = activeSeconds(s, nowMs);
  if (seconds <= 0) return { seconds, billedMin: 0, charge: 0 };
  const minutes = Math.ceil(seconds / 60);
  const billedMin = Math.max(s.min_minutes, Math.ceil(minutes / s.step) * s.step);
  return { seconds, billedMin, charge: Math.round((billedMin * s.rate) / 60) };
}

const hhmm = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
const noteFor = (s: Sess, billedMin: number) => `${hhmm(billedMin)} ຊມ × ${s.rate.toLocaleString('en-US')}/ຊມ`;

export const sessionOf = (db: Db, orderId: number): Row | undefined => db.get('SELECT * FROM table_sessions WHERE order_id = ?', orderId);

/** Bring the time line (and the order total) up to date. Safe to call often; does nothing when nothing changed. */
export function syncTime(db: Db, orderId: number, nowMs = Date.now()) {
  const s = sessionOf(db, orderId);
  if (!s || !s.item_id) return;
  const o = db.get('SELECT status FROM orders WHERE id = ?', orderId);
  if (o?.status !== 'open') return;
  const it = db.get('SELECT * FROM order_items WHERE id = ?', s.item_id);
  if (!it || it.status === 'cancelled') return; // a manager waived the charge
  const { billedMin, charge } = timeCharge(s as Sess, nowMs);
  const note = noteFor(s as Sess, billedMin);
  if (it.unit_price === charge && it.note === note) return;
  db.run('UPDATE order_items SET unit_price = ?, note = ?, updated_at = ? WHERE id = ?', charge, note, now(), it.id);
  recalc(db, orderId);
}

/** Start counting on an order whose table is time-billed (or whose table was just changed to one). */
export function startSession(db: Db, p: { bid: number; uid: number | null; orderId: number; tableId: number; startedAt?: string }) {
  const t = db.get('SELECT * FROM tables WHERE id = ? AND branch_id = ?', p.tableId, p.bid);
  if (!t || !(t.rate_per_hour > 0)) throw bad('ໂຕະນີ້ບໍ່ໄດ້ຕັ້ງໃຫ້ຄິດຕາມເວລາ');
  if (sessionOf(db, p.orderId)) throw conflict('ອໍເດີນີ້ກຳລັງນັບເວລາຢູ່ແລ້ວ');
  const ts = now();
  const item = db.run(
    `INSERT INTO order_items (order_id, menu_item_id, category_id, name, unit_price, unit_cost, qty, options_json, note, status, created_by, created_at, updated_at, awaiting, source)
     VALUES (?,NULL,NULL,?,0,0,1,'[]','','served',?,?,?,0,'staff')`,
    p.orderId, TIME_ITEM_NAME, p.uid, ts, ts,
  );
  db.run(
    'INSERT INTO table_sessions (branch_id, order_id, table_id, started_at, paused_sec, rate, step, min_minutes, item_id, user_id, created_at) VALUES (?,?,?,?,0,?,?,?,?,?,?)',
    p.bid, p.orderId, t.id, p.startedAt ?? ts, t.rate_per_hour, t.time_step, t.time_min, item.id, p.uid, ts,
  );
  syncTime(db, p.orderId);
}

/** Stop the clock for good (the charge freezes). A pause in progress is counted as paused. */
export function endSession(db: Db, orderId: number, { sync = true } = {}) {
  const s = sessionOf(db, orderId);
  if (!s || s.ended_at) return;
  const ts = now();
  if (s.paused_at) {
    db.run('UPDATE table_sessions SET paused_sec = paused_sec + ?, paused_at = NULL WHERE id = ?', Math.max(0, Math.floor((Date.parse(ts) - Date.parse(s.paused_at)) / 1000)), s.id);
  }
  db.run('UPDATE table_sessions SET ended_at = ? WHERE id = ?', ts, s.id);
  if (sync) syncTime(db, orderId);
}

export function pauseSession(db: Db, orderId: number) {
  const s = sessionOf(db, orderId);
  if (!s) throw bad('ອໍເດີນີ້ບໍ່ໄດ້ນັບເວລາ');
  if (s.ended_at) throw conflict('ການນັບເວລາຈົບແລ້ວ');
  if (s.paused_at) throw conflict('ພັກເວລາຢູ່ແລ້ວ');
  syncTime(db, orderId); // charge up to this moment
  db.run('UPDATE table_sessions SET paused_at = ? WHERE id = ?', now(), s.id);
}

export function resumeSession(db: Db, orderId: number) {
  const s = sessionOf(db, orderId);
  if (!s) throw bad('ອໍເດີນີ້ບໍ່ໄດ້ນັບເວລາ');
  if (s.ended_at) throw conflict('ການນັບເວລາຈົບແລ້ວ');
  if (!s.paused_at) throw conflict('ກຳລັງນັບເວລາຢູ່ແລ້ວ');
  db.run('UPDATE table_sessions SET paused_sec = paused_sec + ?, paused_at = NULL WHERE id = ?', Math.max(0, Math.floor((Date.now() - Date.parse(s.paused_at)) / 1000)), s.id);
}

/** What the screen needs to draw the clock (it can keep ticking on its own from these). */
export function timerState(db: Db, orderId: number, nowMs = Date.now()) {
  const s = sessionOf(db, orderId);
  if (!s) return null;
  const c = timeCharge(s as Sess, nowMs);
  return {
    started_at: s.started_at,
    ended_at: s.ended_at,
    paused_at: s.paused_at,
    paused_sec: s.paused_sec,
    rate: s.rate,
    step: s.step,
    min_minutes: s.min_minutes,
    running: !s.ended_at && !s.paused_at,
    paused: !!s.paused_at && !s.ended_at,
    ended: !!s.ended_at,
    seconds: c.seconds,
    billedMin: c.billedMin,
    charge: c.charge,
    now: new Date(nowMs).toISOString(),
  };
}
