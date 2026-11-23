// Print queue: builds tickets, routes them to printers and delivers them in the background with retries.
import type { Db, Row } from '../db.ts';
import { now } from '../db.ts';
import { orderDetail } from '../lib/orders.ts';
import { billDoc, kitchenDoc, receiptDoc, testDoc, type DocOrder, type Shop } from './docs.ts';
import { encodeRaster } from './escpos.ts';
import { renderBlocks, type Block } from './render.ts';
import { sendBytes } from './transport.ts';

const MAX_ATTEMPTS = 5;
const BACKOFF_S = [2, 5, 15, 30]; // delay before retry n
export const dotsFor = (paperMm: number) => (paperMm === 58 ? 384 : 576);

export type PrintService = ReturnType<typeof createPrintService>;

export function createPrintService(db: Db, emit: (bid: number, topics: any[]) => void) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let busy = false;

  // A crash mid-print leaves jobs in "printing": give them another go.
  db.run("UPDATE print_jobs SET status = 'queued' WHERE status = 'printing'");
  db.run("DELETE FROM print_jobs WHERE status = 'done' AND created_at < ?", new Date(Date.now() - 7 * 86_400_000).toISOString());

  const shopOf = (bid: number): Shop => {
    const b = db.get('SELECT * FROM branches WHERE id = ?', bid)!;
    const r = db.get('SELECT name FROM restaurants WHERE id = ?', b.restaurant_id)!;
    return {
      restaurant: r.name,
      branch: b.name,
      address: b.address,
      phone: b.phone,
      header: b.receipt_header,
      footer: b.receipt_footer,
      bank: b.bank_info,
      rateUsd: b.rate_usd,
      rateThb: b.rate_thb,
      utcOffsetMin: b.utc_offset_min,
    };
  };
  const printersOf = (bid: number, role: 'kitchen' | 'bill'): Row[] =>
    db.all('SELECT * FROM printers WHERE branch_id = ? AND role = ? AND active = 1 ORDER BY id', bid, role);

  function enqueue(p: { bid: number; printerId: number; type: 'kitchen' | 'bill' | 'receipt' | 'test'; orderId: number | null; title: string; blocks: Block[] }): number {
    const { id } = db.run(
      `INSERT INTO print_jobs (branch_id, printer_id, type, order_id, title, payload_json, status, run_after, created_at)
       VALUES (?,?,?,?,?,?, 'queued', ?, ?)`,
      p.bid, p.printerId, p.type, p.orderId, p.title, JSON.stringify(p.blocks), now(), now(),
    );
    emit(p.bid, ['print']);
    return id;
  }

  const snapshot = (bid: number, orderId: number) => orderDetail(db, orderId, bid) as unknown as DocOrder & Row;

  return {
    hasPrinter: (bid: number, role: 'kitchen' | 'bill') => printersOf(bid, role).length > 0,

    /** Send these order lines to the kitchen/bar printers (routed by menu category). Returns the number of tickets queued. */
    kitchen(bid: number, orderId: number, itemIds: number[], opts: { reprint?: boolean } = {}): number {
      const printers = printersOf(bid, 'kitchen');
      if (!printers.length) return 0;
      const order = snapshot(bid, orderId);
      const items = order.items.filter((i) => itemIds.includes(i.id) && i.status !== 'cancelled');
      if (!items.length) return 0;
      const shop = shopOf(bid);
      const groups = new Map<number, typeof items>();
      for (const it of items) {
        const cat = db.get('SELECT printer_id FROM categories WHERE id = ?', (it as any).category_id);
        const target = printers.find((p) => p.id === cat?.printer_id) ?? printers[0];
        groups.set(target.id, [...(groups.get(target.id) ?? []), it]);
      }
      for (const [printerId, list] of groups) {
        const printer = printers.find((p) => p.id === printerId)!;
        const title = order.type === 'dine_in' ? `ໂຕະ ${order.table_name}` : `ຄິວ ${order.queue_no}`;
        enqueue({
          bid, printerId, type: 'kitchen', orderId, title,
          blocks: kitchenDoc(order, list, shop, { station: printer.name, reprint: !!opts.reprint, now: now() }),
        });
      }
      return groups.size;
    },

    bill(bid: number, orderId: number): number {
      const printer = printersOf(bid, 'bill')[0];
      if (!printer) return 0;
      const order = snapshot(bid, orderId);
      enqueue({ bid, printerId: printer.id, type: 'bill', orderId, title: `ບິນ ${order.type === 'dine_in' ? order.table_name : 'ຄິວ ' + order.queue_no}`, blocks: billDoc(order, shopOf(bid), now()) });
      return 1;
    },

    receipt(bid: number, orderId: number): number {
      const printer = printersOf(bid, 'bill')[0];
      if (!printer) return 0;
      const order = snapshot(bid, orderId);
      const payer = db.get('SELECT name FROM users WHERE id = ?', (order as any).paid_by);
      enqueue({ bid, printerId: printer.id, type: 'receipt', orderId, title: `ໃບຮັບເງິນ ${order.bill_no ?? ''}`, blocks: receiptDoc(order, shopOf(bid), payer?.name ?? '') });
      return 1;
    },

    test(bid: number, printerId: number): number {
      const p = db.get('SELECT * FROM printers WHERE id = ? AND branch_id = ?', printerId, bid)!;
      return enqueue({ bid, printerId, type: 'test', orderId: null, title: 'ທົດສອບ', blocks: testDoc(p.name, p.paper_mm, shopOf(bid), now()) });
    },

    /** Deliver due jobs. `force` ignores the retry delay (tests, manual retry). Returns how many jobs were attempted. */
    async processDue(opts: { force?: boolean; limit?: number } = {}): Promise<number> {
      if (busy) return 0;
      busy = true;
      let n = 0;
      try {
        const jobs = opts.force
          ? db.all("SELECT * FROM print_jobs WHERE status = 'queued' ORDER BY id LIMIT ?", opts.limit ?? 10)
          : db.all("SELECT * FROM print_jobs WHERE status = 'queued' AND run_after <= ? ORDER BY id LIMIT ?", now(), opts.limit ?? 10);
        for (const job of jobs) {
          n++;
          db.run("UPDATE print_jobs SET status = 'printing' WHERE id = ?", job.id);
          const printer = db.get('SELECT * FROM printers WHERE id = ?', job.printer_id);
          try {
            if (!printer || !printer.active) throw Object.assign(new Error('ເຄື່ອງພິມຖືກປິດ ຫຼື ຖືກລຶບແລ້ວ'), { fatal: true });
            const bitmap = renderBlocks(JSON.parse(job.payload_json), dotsFor(printer.paper_mm));
            const bytes = encodeRaster(bitmap, { cut: !!printer.cut, copies: job.type === 'test' ? 1 : printer.copies });
            await sendBytes(printer, bytes);
            db.run("UPDATE print_jobs SET status = 'done', printed_at = ?, error = '' WHERE id = ?", now(), job.id);
            db.run("UPDATE printers SET last_ok_at = ?, last_error = '' WHERE id = ?", now(), printer.id);
          } catch (e: any) {
            const attempts = job.attempts + 1;
            const give_up = e?.fatal || attempts >= MAX_ATTEMPTS;
            const delay = BACKOFF_S[attempts - 1] ?? 60;
            db.run(
              'UPDATE print_jobs SET status = ?, attempts = ?, error = ?, run_after = ? WHERE id = ?',
              give_up ? 'failed' : 'queued', attempts, e.message, new Date(Date.now() + delay * 1000).toISOString(), job.id,
            );
            if (printer) db.run('UPDATE printers SET last_error = ?, last_error_at = ? WHERE id = ?', e.message, now(), printer.id);
          }
          emit(job.branch_id, ['print']);
        }
      } finally {
        busy = false;
      }
      return n;
    },

    start(intervalMs = 1500) {
      if (timer) return;
      timer = setInterval(() => void this.processDue().catch((e) => console.error('print worker', e)), intervalMs);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },

    /** Summary for the "printer problem" indicator. */
    status(bid: number) {
      const q = db.get("SELECT COUNT(*) AS n FROM print_jobs WHERE branch_id = ? AND status IN ('queued','printing')", bid)!.n;
      const failed = db.get("SELECT COUNT(*) AS n FROM print_jobs WHERE branch_id = ? AND status = 'failed'", bid)!.n;
      const problems = db.all(
        "SELECT id, name, last_error FROM printers WHERE branch_id = ? AND active = 1 AND last_error != '' ORDER BY id",
        bid,
      );
      return { queued: q, failed, problems };
    },
  };
}
