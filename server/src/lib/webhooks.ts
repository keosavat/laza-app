// Outgoing webhooks: events are written to an outbox first (so nothing is lost if the receiver is down),
// then a worker delivers them with a signature and retries with growing delays.
import crypto from 'node:crypto';
import type { Db } from '../db.ts';
import { now } from '../db.ts';

export const EVENTS = ['order.created', 'order.paid', 'order.cancelled', 'shift.closed', 'reservation.created'] as const;
export type EventType = (typeof EVENTS)[number] | 'ping';

/** Seconds to wait after the 1st, 2nd, 3rd… failed attempt. After the last one the delivery is given up ("dead"). */
export const RETRY_DELAYS = [60, 300, 1800, 7200, 43200];
export const MAX_ATTEMPTS = RETRY_DELAYS.length + 1;

/** `X-Laza-Signature: t=<unix seconds>,v1=<hex>` where v1 = HMAC-SHA256(secret, `${t}.${body}`). */
export function signBody(secret: string, body: string, tSec: number): string {
  return `t=${tSec},v1=${crypto.createHmac('sha256', secret).update(`${tSec}.${body}`).digest('hex')}`;
}

/** What receivers (and the public API) see of an order: no costs, no internal ids of staff. */
export function publicOrder(db: Db, orderId: number) {
  const o = db.get(
    `SELECT o.id, o.order_no, o.bill_no, o.type, o.queue_no, o.status, o.customer_name, o.note, o.subtotal, o.discount, o.service, o.vat, o.total,
            o.paid_total, o.change_lak, o.created_at, o.paid_at, o.cancelled_at, o.cancel_reason, o.external_source, o.external_ref, t.name AS table_name
       FROM orders o LEFT JOIN tables t ON t.id = o.table_id WHERE o.id = ?`,
    orderId,
  );
  if (!o) return null;
  const items = db
    .all('SELECT id, name, qty, unit_price, options_json, note, status, awaiting FROM order_items WHERE order_id = ? ORDER BY id', orderId)
    .map((i) => ({ id: i.id, name: i.name, qty: i.qty, unit_price: i.unit_price, options: JSON.parse(i.options_json || '[]'), note: i.note, status: i.status, awaiting_confirmation: !!i.awaiting }));
  const payments = db.all('SELECT method, currency, amount, amount_lak FROM payments WHERE order_id = ? ORDER BY id', orderId);
  return { ...o, items, payments };
}

/** Write one event for every active endpoint of the branch that wants it. Never throws: a webhook problem must not break a sale. */
export function queueEvent(db: Db, bid: number, type: EventType, data: unknown): number {
  try {
    const eps = db.all('SELECT id, events FROM webhook_endpoints WHERE branch_id = ? AND active = 1', bid).filter((e) => e.events === '*' || String(e.events).split(',').includes(type));
    if (!eps.length) return 0;
    const ts = now();
    const eventId = 'evt_' + crypto.randomBytes(12).toString('hex');
    const payload = JSON.stringify({ id: eventId, type, created_at: ts, branch_id: bid, data });
    for (const e of eps) {
      db.run("INSERT INTO webhook_deliveries (endpoint_id, branch_id, event_id, type, payload, status, attempts, next_at, created_at) VALUES (?,?,?,?,?,'pending',0,?,?)", e.id, bid, eventId, type, payload, ts, ts);
    }
    return eps.length;
  } catch (e) {
    console.error('webhook queue failed:', e);
    return 0;
  }
}

export type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ status: number }>;

/** Send one delivery now. Updates its row with the outcome and schedules the next attempt when it failed. */
export async function deliverOne(db: Db, id: number, opts: { fetchFn?: FetchFn; nowMs?: number; timeoutMs?: number } = {}): Promise<'ok' | 'failed' | 'dead' | 'skipped'> {
  const d = db.get('SELECT * FROM webhook_deliveries WHERE id = ?', id);
  if (!d || d.status === 'ok' || d.status === 'dead') return 'skipped';
  const ep = db.get('SELECT * FROM webhook_endpoints WHERE id = ?', d.endpoint_id);
  const nowMs = opts.nowMs ?? Date.now();
  if (!ep || !ep.active) {
    db.run("UPDATE webhook_deliveries SET status='dead', last_error=? WHERE id=?", 'ປາຍທາງຖືກປິດ ຫຼື ລຶບແລ້ວ', d.id);
    return 'dead';
  }
  const fetchFn = opts.fetchFn ?? ((url, init) => fetch(url, init as RequestInit));
  const tSec = Math.floor(nowMs / 1000);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 10_000);
  const started = Date.now();
  let status = 0;
  let error = '';
  try {
    const res = await fetchFn(ep.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'LAZA-Webhook/1',
        'x-laza-event': d.type,
        'x-laza-delivery': String(d.id),
        'x-laza-signature': signBody(ep.secret, d.payload, tSec),
      },
      body: d.payload,
      signal: ctl.signal,
    });
    status = res.status;
    if (status < 200 || status >= 300) error = `HTTP ${status}`;
  } catch (e: any) {
    error = e?.name === 'AbortError' ? 'ໝົດເວລາລໍຖ້າ (10 ວິນາທີ)' : String(e?.cause?.code ?? e?.message ?? e).slice(0, 200);
  } finally {
    clearTimeout(timer);
  }
  const attempts = d.attempts + 1;
  const ms = Date.now() - started;
  if (!error) {
    db.run("UPDATE webhook_deliveries SET status='ok', attempts=?, last_status=?, last_error='', response_ms=?, delivered_at=?, next_at=NULL WHERE id=?", attempts, status, ms, new Date(nowMs).toISOString(), d.id);
    return 'ok';
  }
  if (attempts >= MAX_ATTEMPTS) {
    db.run("UPDATE webhook_deliveries SET status='dead', attempts=?, last_status=?, last_error=?, response_ms=?, next_at=NULL WHERE id=?", attempts, status || null, error, ms, d.id);
    return 'dead';
  }
  const next = new Date(nowMs + RETRY_DELAYS[attempts - 1] * 1000).toISOString();
  db.run("UPDATE webhook_deliveries SET status='failed', attempts=?, last_status=?, last_error=?, response_ms=?, next_at=? WHERE id=?", attempts, status || null, error, ms, next, d.id);
  return 'failed';
}

/** Deliver everything that is due. Returns how many were attempted. */
export async function deliverDue(db: Db, opts: { fetchFn?: FetchFn; nowMs?: number; limit?: number } = {}): Promise<number> {
  const nowIso = new Date(opts.nowMs ?? Date.now()).toISOString();
  const due = db.all("SELECT id FROM webhook_deliveries WHERE status IN ('pending','failed') AND next_at <= ? ORDER BY id LIMIT ?", nowIso, opts.limit ?? 20);
  for (const d of due) await deliverOne(db, d.id, opts);
  return due.length;
}

/** Background worker: looks for due deliveries every few seconds. */
export function startWebhookWorker(db: Db, everyMs = 5000) {
  let busy = false;
  const t = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await deliverDue(db);
      // forget old finished deliveries after 30 days
      db.run("DELETE FROM webhook_deliveries WHERE status IN ('ok','dead') AND created_at < ?", new Date(Date.now() - 30 * 86_400_000).toISOString());
    } catch (e) {
      console.error('webhook worker:', e);
    } finally {
      busy = false;
    }
  }, everyMs);
  t.unref();
  return () => clearInterval(t);
}

/** Reject URLs that cannot be a real receiver or that would reach the cloud metadata service. */
export function checkWebhookUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('URL ບໍ່ຖືກຕ້ອງ');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('URL ຕ້ອງຂຶ້ນຕົ້ນດ້ວຍ https:// (ຫຼື http:// ສຳລັບເຄືອຂ່າຍພາຍໃນ)');
  if (u.username || u.password) throw new Error('ຢ່າໃສ່ຊື່ຜູ້ໃຊ້/ລະຫັດໃນ URL');
  const h = u.hostname.toLowerCase();
  if (h === 'metadata.google.internal' || h.startsWith('169.254.')) throw new Error('URL ນີ້ບໍ່ອະນຸຍາດ');
  return u.toString();
}
