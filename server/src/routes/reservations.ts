// Table reservations: book a table for a date/time, seat the party (opens the order), cancel or mark no-show.
import { Router } from 'express';
import type { Ctx } from '../app.ts';
import { now } from '../db.ts';
import { requirePerm } from '../auth.ts';
import { bad, conflict, int, notFound, oneOf, str } from '../lib/core.ts';
import { getCustomer } from '../lib/debts.ts';
import { createOrder, getBranch, orderDetail } from '../lib/orders.ts';

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Local "now" for a branch as { date: YYYY-MM-DD, time: HH:MM }. */
export function localNow(offsetMin: number) {
  const iso = new Date(Date.now() + offsetMin * 60_000).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

export function reservationRoutes({ db, emit }: Ctx) {
  const r = Router();
  const changed = (bid: number) => emit(bid, ['tables', 'orders']);

  const SELECT = `SELECT r.*, t.name AS table_name, t.seats AS table_seats, u.name AS created_by_name
                    FROM reservations r LEFT JOIN tables t ON t.id = r.table_id LEFT JOIN users u ON u.id = r.user_id`;
  const one = (id: number) => db.get(`${SELECT} WHERE r.id = ?`, id);

  /** A table cannot be promised to two parties at overlapping times on the same day. */
  function requireFree(bid: number, tableId: number | null, date: string, time: string, duration: number, exceptId = 0) {
    if (!tableId) return;
    const start = toMin(time);
    const end = start + duration;
    const clash = db
      .all("SELECT * FROM reservations WHERE branch_id = ? AND table_id = ? AND reserved_date = ? AND status IN ('booked','seated') AND id != ?", bid, tableId, date, exceptId)
      .find((x) => toMin(x.reserved_time) < end && start < toMin(x.reserved_time) + x.duration_min);
    if (clash) throw conflict(`ໂຕະນີ້ມີຄົນຈອງແລ້ວ ເວລາ ${clash.reserved_time} (${clash.name})`);
  }

  function read(b: any, bid: number, prev?: any) {
    const date = String(b.date ?? prev?.reserved_date ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw bad('ວັນທີບໍ່ຖືກຕ້ອງ');
    const time = String(b.time ?? prev?.reserved_time ?? '');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw bad('ເວລາບໍ່ຖືກຕ້ອງ');
    const tableId = b.tableId === undefined ? (prev?.table_id ?? null) : b.tableId ? int(b.tableId, 'ໂຕະ') : null;
    if (tableId && !db.get('SELECT 1 FROM tables WHERE id = ? AND branch_id = ? AND active = 1', tableId, bid)) throw notFound('ບໍ່ພົບໂຕະ');
    const phone = str(b.phone ?? prev?.phone ?? '', 'ເບີໂທ', { max: 30 });
    let customerId: number | null = prev?.customer_id ?? null;
    if (b.customerId !== undefined) customerId = b.customerId ? getCustomer(db, int(b.customerId, 'ລູກຄ້າ'), bid).id : null;
    else if (!customerId && phone) customerId = db.get('SELECT id FROM customers WHERE branch_id = ? AND phone = ? AND active = 1', bid, phone)?.id ?? null;
    return {
      date,
      time,
      tableId,
      customerId,
      phone,
      name: str(b.name ?? prev?.name, 'ຊື່ຜູ້ຈອງ', { required: true, max: 80 }),
      party: int(b.partySize ?? prev?.party_size ?? 2, 'ຈຳນວນຄົນ', { min: 1, max: 200 }),
      duration: int(b.durationMin ?? prev?.duration_min ?? 90, 'ໄລຍະເວລາ', { min: 15, max: 480 }),
      note: str(b.note ?? prev?.note ?? '', 'ໝາຍເຫດ', { max: 300 }),
    };
  }

  const load = (id: number, bid: number) => {
    const x = db.get('SELECT * FROM reservations WHERE id = ? AND branch_id = ?', id, bid);
    if (!x) throw notFound('ບໍ່ພົບການຈອງ');
    return x;
  };

  /** ?date=YYYY-MM-DD for one day, or ?from=&to= for a range; ?status= filters. Default: today onwards. */
  r.get('/reservations', requirePerm('pos'), (req, res) => {
    const bid = req.user.bid;
    const today = localNow(getBranch(db, bid).utc_offset_min).date;
    const where = ['r.branch_id = ?'];
    const params: any[] = [bid];
    if (req.query.date) {
      where.push('r.reserved_date = ?');
      params.push(String(req.query.date));
    } else {
      where.push('r.reserved_date >= ?');
      params.push(String(req.query.from ?? today));
      if (req.query.to) {
        where.push('r.reserved_date <= ?');
        params.push(String(req.query.to));
      }
    }
    if (req.query.status) {
      where.push('r.status = ?');
      params.push(oneOf(req.query.status, 'ສະຖານະ', ['booked', 'seated', 'cancelled', 'no_show']));
    }
    res.json(db.all(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY r.reserved_date, r.reserved_time, r.id LIMIT 500`, ...params));
  });

  r.post('/reservations', requirePerm('pos'), (req, res) => {
    const bid = req.user.bid;
    const v = read(req.body ?? {}, bid);
    const n = localNow(getBranch(db, bid).utc_offset_min);
    if (v.date < n.date) throw bad('ບໍ່ສາມາດຈອງຍ້ອນຫຼັງໄດ້');
    const id = db.tx(() => {
      requireFree(bid, v.tableId, v.date, v.time, v.duration);
      const { id } = db.run(
        `INSERT INTO reservations (branch_id, customer_id, name, phone, party_size, table_id, reserved_date, reserved_time, duration_min, note, status, user_id, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,'booked',?,?,?)`,
        bid, v.customerId, v.name, v.phone, v.party, v.tableId, v.date, v.time, v.duration, v.note, req.user.uid, now(), now(),
      );
      db.audit(bid, req.user.uid, 'create', 'reservation', id, { name: v.name, date: v.date, time: v.time, party: v.party });
      return id;
    });
    changed(bid);
    res.status(201).json(one(id));
  });

  r.put('/reservations/:id', requirePerm('pos'), (req, res) => {
    const bid = req.user.bid;
    const prev = load(int(req.params.id, 'id'), bid);
    if (prev.status !== 'booked') throw conflict('ແກ້ໄຂໄດ້ສະເພາະການຈອງທີ່ຍັງລໍຖ້າ');
    const v = read(req.body ?? {}, bid, prev);
    db.tx(() => {
      requireFree(bid, v.tableId, v.date, v.time, v.duration, prev.id);
      db.run(
        'UPDATE reservations SET customer_id=?, name=?, phone=?, party_size=?, table_id=?, reserved_date=?, reserved_time=?, duration_min=?, note=?, updated_at=? WHERE id=?',
        v.customerId, v.name, v.phone, v.party, v.tableId, v.date, v.time, v.duration, v.note, now(), prev.id,
      );
      db.audit(bid, req.user.uid, 'update', 'reservation', prev.id, { name: v.name, date: v.date, time: v.time });
    });
    changed(bid);
    res.json(one(prev.id));
  });

  /** cancelled / no_show for a waiting booking; booked puts a cancelled or no-show one back (if the table is still free). */
  r.post('/reservations/:id/status', requirePerm('pos'), (req, res) => {
    const bid = req.user.bid;
    const prev = load(int(req.params.id, 'id'), bid);
    const status = oneOf(req.body.status, 'ສະຖານະ', ['booked', 'cancelled', 'no_show'] as const);
    if (prev.status === 'seated') throw conflict('ແຂກນັ່ງແລ້ວ — ປ່ຽນສະຖານະບໍ່ໄດ້');
    if (status === prev.status) return void res.json(one(prev.id));
    db.tx(() => {
      if (status === 'booked') requireFree(bid, prev.table_id, prev.reserved_date, prev.reserved_time, prev.duration_min, prev.id);
      db.run('UPDATE reservations SET status=?, updated_at=? WHERE id=?', status, now(), prev.id);
      db.audit(bid, req.user.uid, `reservation_${status}`, 'reservation', prev.id, { name: prev.name });
    });
    changed(bid);
    res.json(one(prev.id));
  });

  /** The party arrived: open an order on the table and link it to the booking (and to the customer, for loyalty). */
  r.post('/reservations/:id/seat', requirePerm('pos'), (req, res) => {
    const bid = req.user.bid;
    const prev = load(int(req.params.id, 'id'), bid);
    if (prev.status !== 'booked') throw conflict('ການຈອງນີ້ບໍ່ຢູ່ໃນສະຖານະລໍຖ້າ');
    const tableId = req.body.tableId ? int(req.body.tableId, 'ໂຕະ') : prev.table_id;
    if (!tableId) throw bad('ກະລຸນາເລືອກໂຕະກ່ອນ');
    const orderId = db.tx(() => {
      // Seating at a different table than booked must not take a table promised to someone else right now.
      if (tableId !== prev.table_id) {
        const n = localNow(getBranch(db, bid).utc_offset_min);
        requireFree(bid, tableId, n.date, n.time, prev.duration_min, prev.id);
      }
      const id = createOrder(db, { bid, uid: req.user.uid, type: 'dine_in', tableId, customerName: prev.name, guestCount: prev.party_size });
      if (prev.customer_id) db.run('UPDATE orders SET customer_id = ? WHERE id = ?', prev.customer_id, id);
      db.run("UPDATE reservations SET status='seated', table_id=?, order_id=?, updated_at=? WHERE id=?", tableId, id, now(), prev.id);
      db.audit(bid, req.user.uid, 'reservation_seat', 'reservation', prev.id, { name: prev.name, orderId: id });
      return id;
    });
    changed(bid);
    res.status(201).json({ reservation: one(prev.id), order: orderDetail(db, orderId, bid) });
  });

  /** Booked and seated parties still on the books for today, for the floor plan badges. */
  r.get('/reservations/today', requirePerm('pos'), (req, res) => {
    const n = localNow(getBranch(db, req.user.bid).utc_offset_min);
    res.json({ ...n, list: db.all(`${SELECT} WHERE r.branch_id = ? AND r.reserved_date = ? AND r.status = 'booked' ORDER BY r.reserved_time`, req.user.bid, n.date) });
  });

  return r;
}
