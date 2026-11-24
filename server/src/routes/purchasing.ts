// Procurement: suppliers, purchase orders, receiving goods into stock, and payments to suppliers.
import { Router } from 'express';
import type { Ctx } from '../app.ts';
import { requirePerm } from '../auth.ts';
import { now } from '../db.ts';
import { bad, conflict, int, notFound, num, oneOf, str } from '../lib/core.ts';
import { moveStock } from '../lib/inventory.ts';

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function purchasingRoutes({ db, emit }: Ctx) {
  const r = Router();
  const changed = (bid: number) => emit(bid, ['menu']);

  // ---------- suppliers ----------

  /** What we owe a supplier: goods received minus payments made. */
  const owedSql = `COALESCE((SELECT SUM(l.received_value) FROM po_lines l JOIN purchase_orders p ON p.id = l.po_id WHERE p.supplier_id = s.id), 0)
                   - COALESCE((SELECT SUM(sp.amount) FROM supplier_payments sp JOIN purchase_orders p ON p.id = sp.po_id WHERE p.supplier_id = s.id), 0)`;

  r.get('/suppliers', requirePerm('admin'), (req, res) => {
    const rows = db.all(
      `SELECT s.*, ROUND(${owedSql}) AS owed,
              (SELECT COUNT(*) FROM purchase_orders p WHERE p.supplier_id = s.id AND p.status IN ('ordered','partial')) AS open_orders,
              (SELECT COUNT(*) FROM ingredients i WHERE i.supplier_id = s.id AND i.active = 1) AS ingredients
         FROM suppliers s WHERE s.branch_id = ? ORDER BY s.active DESC, s.name`,
      req.user.bid,
    );
    res.json(rows);
  });

  const readSupplier = (b: any, prev?: any) => ({
    name: str(b.name ?? prev?.name, 'ຊື່ຜູ້ສະໜອງ', { required: true, max: 80 }),
    contact: str(b.contact ?? prev?.contact ?? '', 'ຜູ້ຕິດຕໍ່', { max: 80 }),
    phone: str(b.phone ?? prev?.phone ?? '', 'ເບີໂທ', { max: 30 }),
    address: str(b.address ?? prev?.address ?? '', 'ທີ່ຢູ່', { max: 200 }),
    note: str(b.note ?? prev?.note ?? '', 'ໝາຍເຫດ', { max: 300 }),
    active: b.active === undefined ? (prev?.active ?? 1) : b.active ? 1 : 0,
  });
  const dupName = (bid: number, name: string, exceptId = 0) => {
    if (db.get('SELECT 1 FROM suppliers WHERE branch_id = ? AND LOWER(name) = LOWER(?) AND id != ?', bid, name, exceptId)) throw bad('ມີຜູ້ສະໜອງຊື່ນີ້ແລ້ວ');
  };
  const supplier = (id: number, bid: number) => {
    const s = db.get('SELECT * FROM suppliers WHERE id = ? AND branch_id = ?', id, bid);
    if (!s) throw notFound('ບໍ່ພົບຜູ້ສະໜອງ');
    return s;
  };

  r.post('/suppliers', requirePerm('admin'), (req, res) => {
    const v = readSupplier(req.body ?? {});
    dupName(req.user.bid, v.name);
    const { id } = db.run('INSERT INTO suppliers (branch_id, name, contact, phone, address, note, active, created_at) VALUES (?,?,?,?,?,?,?,?)', req.user.bid, v.name, v.contact, v.phone, v.address, v.note, v.active, now());
    db.audit(req.user.bid, req.user.uid, 'create', 'supplier', id, { name: v.name });
    res.status(201).json(db.get('SELECT * FROM suppliers WHERE id = ?', id));
  });

  r.put('/suppliers/:id', requirePerm('admin'), (req, res) => {
    const prev = supplier(int(req.params.id, 'id'), req.user.bid);
    const v = readSupplier(req.body ?? {}, prev);
    dupName(req.user.bid, v.name, prev.id);
    db.run('UPDATE suppliers SET name=?, contact=?, phone=?, address=?, note=?, active=? WHERE id=?', v.name, v.contact, v.phone, v.address, v.note, v.active, prev.id);
    db.audit(req.user.bid, req.user.uid, 'update', 'supplier', prev.id, { name: v.name, active: v.active });
    res.json(db.get('SELECT * FROM suppliers WHERE id = ?', prev.id));
  });

  r.delete('/suppliers/:id', requirePerm('admin'), (req, res) => {
    const s = supplier(int(req.params.id, 'id'), req.user.bid);
    const used = db.get('SELECT 1 FROM purchase_orders WHERE supplier_id = ? LIMIT 1', s.id);
    if (used) db.run('UPDATE suppliers SET active = 0 WHERE id = ?', s.id);
    else {
      db.run('UPDATE ingredients SET supplier_id = NULL WHERE supplier_id = ?', s.id);
      db.run('DELETE FROM suppliers WHERE id = ?', s.id);
    }
    db.audit(req.user.bid, req.user.uid, 'delete', 'supplier', s.id, { name: s.name });
    res.json({ deleted: !used, deactivated: !!used });
  });

  // ---------- purchase orders ----------

  const header = (id: number) =>
    db.get(
      `SELECT p.*, s.name AS supplier_name, s.phone AS supplier_phone, u.name AS user_name,
              (SELECT COALESCE(SUM(l.qty * l.unit_cost),0) FROM po_lines l WHERE l.po_id = p.id) AS total,
              (SELECT COALESCE(SUM(l.received_value),0) FROM po_lines l WHERE l.po_id = p.id) AS received_value,
              (SELECT COALESCE(SUM(sp.amount),0) FROM supplier_payments sp WHERE sp.po_id = p.id) AS paid,
              (SELECT COUNT(*) FROM po_lines l WHERE l.po_id = p.id) AS line_count
         FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ?`,
      id,
    );
  const shape = (h: any) => ({ ...h, total: Math.round(h.total), received_value: Math.round(h.received_value), owed: Math.round(h.received_value) - h.paid });
  const load = (id: number, bid: number) => {
    const p = db.get('SELECT * FROM purchase_orders WHERE id = ? AND branch_id = ?', id, bid);
    if (!p) throw notFound('ບໍ່ພົບໃບສັ່ງຊື້');
    return p;
  };
  const detail = (id: number) => ({
    ...shape(header(id)),
    lines: db.all(
      `SELECT l.*, i.name, i.unit, i.stock, i.pack_name, i.pack_size FROM po_lines l JOIN ingredients i ON i.id = l.ingredient_id WHERE l.po_id = ? ORDER BY l.id`,
      id,
    ),
    payments: db.all('SELECT sp.*, u.name AS user_name FROM supplier_payments sp LEFT JOIN users u ON u.id = sp.user_id WHERE sp.po_id = ? ORDER BY sp.id DESC', id),
  });

  r.get('/purchase-orders', requirePerm('admin'), (req, res) => {
    const where = ['p.branch_id = ?'];
    const params: any[] = [req.user.bid];
    if (req.query.status) {
      if (req.query.status === 'open') where.push("p.status IN ('draft','ordered','partial')");
      else {
        where.push('p.status = ?');
        params.push(oneOf(req.query.status, 'ສະຖານະ', ['draft', 'ordered', 'partial', 'received', 'cancelled']));
      }
    }
    if (req.query.supplierId) {
      where.push('p.supplier_id = ?');
      params.push(int(req.query.supplierId, 'ຜູ້ສະໜອງ'));
    }
    const ids = db.all(`SELECT p.id FROM purchase_orders p WHERE ${where.join(' AND ')} ORDER BY p.id DESC LIMIT 300`, ...params);
    res.json(ids.map((x) => shape(header(x.id))));
  });

  /** Low-stock ingredients grouped by their usual supplier, with a quantity that tops each one back up. */
  r.get('/purchase-orders/suggest', requirePerm('admin'), (req, res) => {
    const rows = db.all(
      `SELECT i.id, i.name, i.unit, i.stock, i.low_at, i.refill_to, i.cost, i.pack_name, i.pack_size, i.supplier_id, s.name AS supplier_name
         FROM ingredients i LEFT JOIN suppliers s ON s.id = i.supplier_id
        WHERE i.branch_id = ? AND i.active = 1 AND i.refill_to > i.stock AND (i.stock <= i.low_at OR i.low_at = 0) ORDER BY i.name`,
      req.user.bid,
    );
    // Ingredients already on an open purchase order are not suggested again.
    const onOrder = new Map(
      db
        .all(
          `SELECT l.ingredient_id AS id, SUM(l.qty - l.received_qty) AS qty FROM po_lines l JOIN purchase_orders p ON p.id = l.po_id
            WHERE p.branch_id = ? AND p.status IN ('ordered','partial') GROUP BY l.ingredient_id`,
          req.user.bid,
        )
        .map((x) => [x.id as number, x.qty as number]),
    );
    const groups = new Map<number | null, { supplierId: number | null; supplierName: string; lines: any[] }>();
    for (const i of rows) {
      const need = r3(i.refill_to - i.stock - (onOrder.get(i.id) ?? 0));
      if (need <= 0) continue;
      const qty = i.pack_size > 0 ? Math.ceil(need / i.pack_size) * i.pack_size : Math.ceil(need);
      const g = groups.get(i.supplier_id) ?? { supplierId: i.supplier_id, supplierName: i.supplier_name ?? '', lines: [] };
      g.lines.push({ ingredientId: i.id, name: i.name, unit: i.unit, stock: i.stock, qty, unitCost: i.cost });
      groups.set(i.supplier_id, g);
    }
    res.json([...groups.values()]);
  });

  r.get('/purchase-orders/:id', requirePerm('admin'), (req, res) => {
    res.json(detail(load(int(req.params.id, 'id'), req.user.bid).id));
  });

  function readLines(raw: unknown, bid: number) {
    if (!Array.isArray(raw) || !raw.length) throw bad('ກະລຸນາເພີ່ມຢ່າງໜ້ອຍ 1 ລາຍການ');
    if (raw.length > 100) throw bad('ລາຍການຫຼາຍເກີນໄປ');
    const seen = new Set<number>();
    return raw.map((l: any) => {
      const ingredientId = int(l?.ingredientId, 'ວັດຖຸດິບ', { required: true });
      if (seen.has(ingredientId)) throw bad('ມີວັດຖຸດິບຊ້ຳໃນໃບສັ່ງຊື້');
      seen.add(ingredientId);
      if (!db.get('SELECT 1 FROM ingredients WHERE id = ? AND branch_id = ?', ingredientId, bid)) throw bad('ບໍ່ພົບວັດຖຸດິບ');
      return { ingredientId, qty: r3(num(l?.qty, 'ຈຳນວນ', { min: 0.001, max: 1e9 })), unitCost: num(l?.unitCost ?? 0, 'ລາຄາ/ຫົວໜ່ວຍ', { min: 0, max: 1e9 }) };
    });
  }
  const date = (v: unknown) => {
    const s = v ? String(v) : '';
    if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw bad('ວັນທີບໍ່ຖືກຕ້ອງ');
    return s;
  };

  r.post('/purchase-orders', requirePerm('admin'), (req, res) => {
    const bid = req.user.bid;
    const sup = supplier(int(req.body.supplierId, 'ຜູ້ສະໜອງ', { required: true }), bid);
    if (!sup.active) throw bad('ຜູ້ສະໜອງນີ້ປິດໃຊ້ແລ້ວ');
    const lines = readLines(req.body.lines, bid);
    const id = db.tx(() => {
      const poNo = ((db.get('SELECT MAX(po_no) AS v FROM purchase_orders WHERE branch_id = ?', bid) as any).v ?? 0) + 1;
      const { id } = db.run('INSERT INTO purchase_orders (branch_id, po_no, supplier_id, status, expected_on, note, user_id, created_at) VALUES (?,?,?,?,?,?,?,?)', bid, poNo, sup.id, 'draft', date(req.body.expectedOn), str(req.body.note, 'ໝາຍເຫດ', { max: 300 }), req.user.uid, now());
      for (const l of lines) db.run('INSERT INTO po_lines (po_id, ingredient_id, qty, unit_cost) VALUES (?,?,?,?)', id, l.ingredientId, l.qty, l.unitCost);
      db.audit(bid, req.user.uid, 'create', 'purchase_order', id, { poNo, supplier: sup.name, lines: lines.length });
      return id;
    });
    res.status(201).json(detail(id));
  });

  /** Only a draft can be edited (supplier, lines, dates, note). */
  r.put('/purchase-orders/:id', requirePerm('admin'), (req, res) => {
    const bid = req.user.bid;
    const po = load(int(req.params.id, 'id'), bid);
    if (po.status !== 'draft') throw conflict('ແກ້ໄຂໄດ້ສະເພາະໃບສັ່ງຊື້ສະບັບຮ່າງ');
    const sup = req.body.supplierId === undefined ? supplier(po.supplier_id, bid) : supplier(int(req.body.supplierId, 'ຜູ້ສະໜອງ'), bid);
    const lines = req.body.lines === undefined ? null : readLines(req.body.lines, bid);
    db.tx(() => {
      db.run('UPDATE purchase_orders SET supplier_id=?, expected_on=?, note=? WHERE id=?', sup.id, req.body.expectedOn === undefined ? po.expected_on : date(req.body.expectedOn), req.body.note === undefined ? po.note : str(req.body.note, 'ໝາຍເຫດ', { max: 300 }), po.id);
      if (lines) {
        db.run('DELETE FROM po_lines WHERE po_id = ?', po.id);
        for (const l of lines) db.run('INSERT INTO po_lines (po_id, ingredient_id, qty, unit_cost) VALUES (?,?,?,?)', po.id, l.ingredientId, l.qty, l.unitCost);
      }
      db.audit(bid, req.user.uid, 'update', 'purchase_order', po.id, { poNo: po.po_no });
    });
    res.json(detail(po.id));
  });

  /** draft → ordered (sent to the supplier). */
  r.post('/purchase-orders/:id/order', requirePerm('admin'), (req, res) => {
    const po = load(int(req.params.id, 'id'), req.user.bid);
    if (po.status !== 'draft') throw conflict('ໃບສັ່ງຊື້ນີ້ບໍ່ແມ່ນສະບັບຮ່າງ');
    if (!db.get('SELECT 1 FROM po_lines WHERE po_id = ?', po.id)) throw bad('ໃບສັ່ງຊື້ບໍ່ມີລາຍການ');
    db.run("UPDATE purchase_orders SET status='ordered', ordered_at=? WHERE id=?", now(), po.id);
    db.audit(req.user.bid, req.user.uid, 'po_order', 'purchase_order', po.id, { poNo: po.po_no });
    res.json(detail(po.id));
  });

  /** Goods arrive (all or part): stock goes up, the average cost is updated, and what we owe the supplier grows. */
  r.post('/purchase-orders/:id/receive', requirePerm('admin'), (req, res) => {
    const bid = req.user.bid;
    const po = load(int(req.params.id, 'id'), bid);
    if (po.status !== 'ordered' && po.status !== 'partial') throw conflict('ຮັບເຄື່ອງໄດ້ສະເພາະໃບສັ່ງຊື້ທີ່ສັ່ງແລ້ວ');
    if (!Array.isArray(req.body.lines) || !req.body.lines.length) throw bad('ກະລຸນາໃສ່ຈຳນວນທີ່ຮັບ');
    const invoiceNo = str(req.body.invoiceNo, 'ເລກໃບສົ່ງເຄື່ອງ', { max: 40 });
    db.tx(() => {
      let any = false;
      const seen = new Set<number>();
      for (const x of req.body.lines) {
        const line = db.get('SELECT * FROM po_lines WHERE id = ? AND po_id = ?', int(x?.lineId, 'ລາຍການ', { required: true }), po.id);
        if (!line) throw bad('ບໍ່ພົບລາຍການໃນໃບສັ່ງຊື້');
        if (seen.has(line.id)) throw bad('ມີລາຍການຊ້ຳ');
        seen.add(line.id);
        const qty = r3(num(x?.qty ?? 0, 'ຈຳນວນ', { min: 0, max: 1e9 }));
        if (!qty) continue;
        const left = r3(line.qty - line.received_qty);
        if (qty > left) throw bad(`ຮັບເກີນທີ່ສັ່ງ (ເຫຼືອ ${left})`);
        const cost = x?.unitCost === undefined || x.unitCost === '' ? line.unit_cost : num(x.unitCost, 'ລາຄາ/ຫົວໜ່ວຍ', { min: 0, max: 1e9 });
        const expiresAt = x?.expiresAt ? String(x.expiresAt) : null;
        if (expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) throw bad('ວັນໝົດອາຍຸບໍ່ຖືກຕ້ອງ');
        moveStock(db, { bid, ingredientId: line.ingredient_id, type: 'in', qty, unitCost: cost, lot: str(x?.lot, 'ລັອດ', { max: 40 }), expiresAt, note: `ໃບສັ່ງຊື້ PO-${String(po.po_no).padStart(4, '0')}`, uid: req.user.uid });
        db.run('UPDATE po_lines SET received_qty = ?, received_value = received_value + ? WHERE id = ?', r3(line.received_qty + qty), qty * cost, line.id);
        any = true;
      }
      if (!any) throw bad('ກະລຸນາໃສ່ຈຳນວນທີ່ຮັບຢ່າງໜ້ອຍ 1 ລາຍການ');
      const open = db.get('SELECT 1 FROM po_lines WHERE po_id = ? AND received_qty < qty - 0.0005', po.id);
      db.run('UPDATE purchase_orders SET status=?, received_at=?, invoice_no=CASE WHEN ? != \'\' THEN ? ELSE invoice_no END WHERE id=?', open ? 'partial' : 'received', open ? null : now(), invoiceNo, invoiceNo, po.id);
      db.audit(bid, req.user.uid, 'po_receive', 'purchase_order', po.id, { poNo: po.po_no, complete: !open });
    });
    changed(bid);
    res.json(detail(po.id));
  });

  /** Close a partly delivered order: the supplier will not send the rest. */
  r.post('/purchase-orders/:id/close', requirePerm('admin'), (req, res) => {
    const po = load(int(req.params.id, 'id'), req.user.bid);
    if (po.status !== 'partial') throw conflict('ປິດໄດ້ສະເພາະໃບສັ່ງຊື້ທີ່ໄດ້ຮັບເຄື່ອງບາງສ່ວນ');
    db.run("UPDATE purchase_orders SET status='received', received_at=? WHERE id=?", now(), po.id);
    db.audit(req.user.bid, req.user.uid, 'po_close', 'purchase_order', po.id, { poNo: po.po_no });
    res.json(detail(po.id));
  });

  /** Cancel a draft or an order nothing has arrived for yet. */
  r.post('/purchase-orders/:id/cancel', requirePerm('admin'), (req, res) => {
    const po = load(int(req.params.id, 'id'), req.user.bid);
    if (po.status !== 'draft' && po.status !== 'ordered') throw conflict('ຍົກເລີກບໍ່ໄດ້ ເພາະໄດ້ຮັບເຄື່ອງແລ້ວ ຫຼື ປິດແລ້ວ');
    db.run("UPDATE purchase_orders SET status='cancelled', cancelled_at=? WHERE id=?", now(), po.id);
    db.audit(req.user.bid, req.user.uid, 'po_cancel', 'purchase_order', po.id, { poNo: po.po_no });
    res.json(detail(po.id));
  });

  /** Record a payment to the supplier. It cannot exceed what has been received and not yet paid. */
  r.post('/purchase-orders/:id/payments', requirePerm('admin'), (req, res) => {
    const bid = req.user.bid;
    const po = load(int(req.params.id, 'id'), bid);
    const amount = Math.round(num(req.body.amount, 'ຈຳນວນເງິນ', { min: 1, max: 1e12 }));
    const method = oneOf(req.body.method ?? 'cash', 'ວິທີຈ່າຍ', ['cash', 'transfer'] as const);
    db.tx(() => {
      const h = shape(header(po.id));
      if (amount > h.owed) throw bad(`ຈ່າຍເກີນຍອດຄ້າງ (${h.owed.toLocaleString('en-US')} ກີບ)`);
      db.run('INSERT INTO supplier_payments (branch_id, po_id, amount, method, note, user_id, created_at) VALUES (?,?,?,?,?,?,?)', bid, po.id, amount, method, str(req.body.note, 'ໝາຍເຫດ', { max: 200 }), req.user.uid, now());
      db.audit(bid, req.user.uid, 'supplier_payment', 'purchase_order', po.id, { amount, method, poNo: po.po_no });
    });
    res.status(201).json(detail(po.id));
  });

  return r;
}
