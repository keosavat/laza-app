// Menu (categories + items) and floor (zones + tables) management.
import { Router } from 'express';
import type { Ctx } from '../app.ts';
import { requirePerm } from '../auth.ts';
import { now } from '../db.ts';
import { bad, bool, int, notFound, str } from '../lib/core.ts';
import { portionsMap } from '../lib/inventory.ts';

function parseOptions(v: unknown): string {
  if (v === undefined || v === null) return '[]';
  if (!Array.isArray(v)) throw bad('ຕົວເລືອກບໍ່ຖືກຕ້ອງ');
  const groups = v.map((g: any) => {
    const name = str(g?.name, 'ຊື່ກຸ່ມຕົວເລືອກ', { required: true, max: 60 });
    if (!Array.isArray(g.choices) || !g.choices.length) throw bad(`ກຸ່ມ "${name}" ຕ້ອງມີຢ່າງໜ້ອຍ 1 ຕົວເລືອກ`);
    const choices = g.choices.map((c: any) => ({
      name: str(c?.name, 'ຊື່ຕົວເລືອກ', { required: true, max: 60 }),
      price: int(c?.price ?? 0, 'ລາຄາຕົວເລືອກ', { min: 0 }),
    }));
    return { name, required: !!g.required, multiple: !!g.multiple, choices };
  });
  return JSON.stringify(groups);
}

const itemOut = (r: any) => ({ ...r, options: JSON.parse(r.options_json || '[]'), options_json: undefined });

export function catalogRoutes({ db, emit }: Ctx) {
  const r = Router();

  // ----- Categories -----
  /** Which kitchen/bar printer gets this category's tickets (null = the default kitchen printer). */
  const kitchenPrinter = (bid: number, v: unknown, prev: number | null = null): number | null => {
    if (v === undefined) return prev;
    if (v === null || v === '' || v === 0) return null;
    const id = int(v, 'ເຄື່ອງພິມ');
    if (!db.get("SELECT 1 FROM printers WHERE id = ? AND branch_id = ? AND role = 'kitchen'", id, bid)) throw bad('ເລືອກໄດ້ສະເພາະເຄື່ອງພິມຄົວ/ບາ');
    return id;
  };
  r.get('/categories', (req, res) => {
    res.json(db.all('SELECT * FROM categories WHERE branch_id = ? ORDER BY sort, id', req.user.bid));
  });
  r.post('/categories', requirePerm('admin'), (req, res) => {
    const { id } = db.run(
      'INSERT INTO categories (branch_id, name, sort, active, printer_id) VALUES (?,?,?,?,?)',
      req.user.bid,
      str(req.body.name, 'ຊື່ໝວດ', { required: true, max: 80 }),
      int(req.body.sort, 'ລຳດັບ'),
      req.body.active === undefined ? 1 : bool(req.body.active),
      kitchenPrinter(req.user.bid, req.body.printerId),
    );
    emit(req.user.bid, ['menu']);
    res.status(201).json(db.get('SELECT * FROM categories WHERE id = ?', id));
  });
  r.put('/categories/:id', requirePerm('admin'), (req, res) => {
    const c = db.get('SELECT * FROM categories WHERE id = ? AND branch_id = ?', int(req.params.id, 'id'), req.user.bid);
    if (!c) throw notFound();
    db.run(
      'UPDATE categories SET name=?, sort=?, active=?, printer_id=? WHERE id=?',
      str(req.body.name ?? c.name, 'ຊື່ໝວດ', { required: true, max: 80 }),
      int(req.body.sort ?? c.sort, 'ລຳດັບ'),
      req.body.active === undefined ? c.active : bool(req.body.active),
      kitchenPrinter(req.user.bid, req.body.printerId, c.printer_id),
      c.id,
    );
    emit(req.user.bid, ['menu']);
    res.json(db.get('SELECT * FROM categories WHERE id = ?', c.id));
  });
  r.delete('/categories/:id', requirePerm('admin'), (req, res) => {
    const id = int(req.params.id, 'id');
    const n = db.get('SELECT COUNT(*) AS n FROM menu_items WHERE category_id = ?', id)!.n;
    if (n) throw bad(`ໝວດນີ້ຍັງມີ ${n} ເມນູ ກະລຸນາຍ້າຍ ຫຼື ລຶບເມນູກ່ອນ`);
    const { changes } = db.run('DELETE FROM categories WHERE id = ? AND branch_id = ?', id, req.user.bid);
    if (!changes) throw notFound();
    emit(req.user.bid, ['menu']);
    res.status(204).end();
  });

  // ----- Menu items -----
  r.get('/menu-items', (req, res) => {
    // `portions`: how many more can be made from stock (null = no recipe, not tracked).
    const left = portionsMap(db, req.user.bid);
    res.json(db.all('SELECT * FROM menu_items WHERE branch_id = ? ORDER BY sort, id', req.user.bid).map((r) => ({ ...itemOut(r), portions: left.get(r.id) ?? null })));
  });
  const readItem = (body: any, prev?: any) => {
    const categoryId = body.categoryId === undefined ? prev?.category_id : body.categoryId === null ? null : int(body.categoryId, 'ໝວດ');
    return {
      name: str(body.name ?? prev?.name, 'ຊື່ເມນູ', { required: true, max: 120 }),
      categoryId: categoryId ?? null,
      price: int(body.price ?? prev?.price, 'ລາຄາ', { min: 0, required: true }),
      cost: int(body.cost ?? prev?.cost ?? 0, 'ຕົ້ນທຶນ', { min: 0 }),
      imageUrl: str(body.imageUrl ?? prev?.image_url ?? '', 'ຮູບ', { max: 2_000_000 }),
      options: body.options === undefined ? (prev?.options_json ?? '[]') : parseOptions(body.options),
      active: body.active === undefined ? (prev?.active ?? 1) : bool(body.active),
      sort: int(body.sort ?? prev?.sort ?? 0, 'ລຳດັບ'),
    };
  };
  const checkCategory = (bid: number, id: number | null) => {
    if (id !== null && !db.get('SELECT id FROM categories WHERE id = ? AND branch_id = ?', id, bid)) throw bad('ບໍ່ພົບໝວດ');
  };
  r.post('/menu-items', requirePerm('admin'), (req, res) => {
    const v = readItem(req.body);
    checkCategory(req.user.bid, v.categoryId);
    const { id } = db.run(
      'INSERT INTO menu_items (branch_id, category_id, name, price, cost, image_url, options_json, active, sort, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      req.user.bid,
      v.categoryId,
      v.name,
      v.price,
      v.cost,
      v.imageUrl,
      v.options,
      v.active,
      v.sort,
      now(),
    );
    emit(req.user.bid, ['menu']);
    res.status(201).json(itemOut(db.get('SELECT * FROM menu_items WHERE id = ?', id)));
  });
  r.put('/menu-items/:id', requirePerm('admin'), (req, res) => {
    const prev = db.get('SELECT * FROM menu_items WHERE id = ? AND branch_id = ?', int(req.params.id, 'id'), req.user.bid);
    if (!prev) throw notFound();
    const v = readItem(req.body, prev);
    checkCategory(req.user.bid, v.categoryId);
    db.run(
      'UPDATE menu_items SET category_id=?, name=?, price=?, cost=?, image_url=?, options_json=?, active=?, sort=? WHERE id=?',
      v.categoryId,
      v.name,
      v.price,
      v.cost,
      v.imageUrl,
      v.options,
      v.active,
      v.sort,
      prev.id,
    );
    db.audit(req.user.bid, req.user.uid, 'update', 'menu_item', prev.id, { price: [prev.price, v.price] });
    emit(req.user.bid, ['menu']);
    res.json(itemOut(db.get('SELECT * FROM menu_items WHERE id = ?', prev.id)));
  });
  r.delete('/menu-items/:id', requirePerm('admin'), (req, res) => {
    const id = int(req.params.id, 'id');
    const used = db.get('SELECT 1 FROM order_items WHERE menu_item_id = ? LIMIT 1', id);
    // Items already sold are kept for history and simply deactivated.
    const { changes } = used
      ? db.run('UPDATE menu_items SET active = 0 WHERE id = ? AND branch_id = ?', id, req.user.bid)
      : db.run('DELETE FROM menu_items WHERE id = ? AND branch_id = ?', id, req.user.bid);
    if (!changes) throw notFound();
    emit(req.user.bid, ['menu']);
    res.json({ deleted: !used, deactivated: !!used });
  });

  // ----- Zones -----
  r.get('/zones', (req, res) => {
    res.json(db.all('SELECT * FROM zones WHERE branch_id = ? ORDER BY sort, id', req.user.bid));
  });
  r.post('/zones', requirePerm('admin'), (req, res) => {
    const { id } = db.run(
      'INSERT INTO zones (branch_id, name, sort) VALUES (?,?,?)',
      req.user.bid,
      str(req.body.name, 'ຊື່ໂຊນ', { required: true, max: 60 }),
      int(req.body.sort, 'ລຳດັບ'),
    );
    emit(req.user.bid, ['tables']);
    res.status(201).json(db.get('SELECT * FROM zones WHERE id = ?', id));
  });
  r.put('/zones/:id', requirePerm('admin'), (req, res) => {
    const z = db.get('SELECT * FROM zones WHERE id = ? AND branch_id = ?', int(req.params.id, 'id'), req.user.bid);
    if (!z) throw notFound();
    db.run('UPDATE zones SET name=?, sort=? WHERE id=?', str(req.body.name ?? z.name, 'ຊື່ໂຊນ', { required: true }), int(req.body.sort ?? z.sort, 'ລຳດັບ'), z.id);
    emit(req.user.bid, ['tables']);
    res.json(db.get('SELECT * FROM zones WHERE id = ?', z.id));
  });
  r.delete('/zones/:id', requirePerm('admin'), (req, res) => {
    const id = int(req.params.id, 'id');
    db.tx(() => {
      db.run('UPDATE tables SET zone_id = NULL WHERE zone_id = ? AND branch_id = ?', id, req.user.bid);
      if (!db.run('DELETE FROM zones WHERE id = ? AND branch_id = ?', id, req.user.bid).changes) throw notFound();
    });
    emit(req.user.bid, ['tables']);
    res.status(204).end();
  });

  // ----- Tables -----
  const checkZone = (bid: number, id: number | null) => {
    if (id !== null && !db.get('SELECT id FROM zones WHERE id = ? AND branch_id = ?', id, bid)) throw bad('ບໍ່ພົບໂຊນ');
  };
  r.get('/tables', (req, res) => {
    res.json(db.all('SELECT * FROM tables WHERE branch_id = ? ORDER BY sort, id', req.user.bid));
  });
  r.post('/tables', requirePerm('admin'), (req, res) => {
    const zoneId = req.body.zoneId ? int(req.body.zoneId, 'ໂຊນ') : null;
    checkZone(req.user.bid, zoneId);
    const { id } = db.run(
      'INSERT INTO tables (branch_id, zone_id, name, seats, sort, active) VALUES (?,?,?,?,?,1)',
      req.user.bid,
      zoneId,
      str(req.body.name, 'ຊື່ໂຕະ', { required: true, max: 40 }),
      int(req.body.seats ?? 4, 'ຈຳນວນບ່ອນນັ່ງ', { min: 1, max: 100 }),
      int(req.body.sort, 'ລຳດັບ'),
    );
    emit(req.user.bid, ['tables']);
    res.status(201).json(db.get('SELECT * FROM tables WHERE id = ?', id));
  });
  r.post('/tables/bulk', requirePerm('admin'), (req, res) => {
    const prefix = str(req.body.prefix, 'ຊື່ນຳໜ້າ', { required: true, max: 30 });
    const from = int(req.body.from, 'ເລີ່ມຈາກ', { min: 0, required: true });
    const count = int(req.body.count, 'ຈຳນວນ', { min: 1, max: 200, required: true });
    const seats = int(req.body.seats ?? 4, 'ຈຳນວນບ່ອນນັ່ງ', { min: 1, max: 100 });
    const zoneId = req.body.zoneId ? int(req.body.zoneId, 'ໂຊນ') : null;
    checkZone(req.user.bid, zoneId);
    db.tx(() => {
      for (let i = 0; i < count; i++) {
        const n = from + i;
        db.run(
          'INSERT INTO tables (branch_id, zone_id, name, seats, sort, active) VALUES (?,?,?,?,?,1)',
          req.user.bid,
          zoneId,
          `${prefix} ${String(n).padStart(2, '0')}`,
          seats,
          n,
        );
      }
    });
    emit(req.user.bid, ['tables']);
    res.status(201).json({ created: count });
  });
  r.put('/tables/:id', requirePerm('admin'), (req, res) => {
    const t = db.get('SELECT * FROM tables WHERE id = ? AND branch_id = ?', int(req.params.id, 'id'), req.user.bid);
    if (!t) throw notFound();
    const zoneId = req.body.zoneId === undefined ? t.zone_id : req.body.zoneId ? int(req.body.zoneId, 'ໂຊນ') : null;
    checkZone(req.user.bid, zoneId);
    db.run(
      'UPDATE tables SET zone_id=?, name=?, seats=?, sort=?, active=? WHERE id=?',
      zoneId,
      str(req.body.name ?? t.name, 'ຊື່ໂຕະ', { required: true, max: 40 }),
      int(req.body.seats ?? t.seats, 'ຈຳນວນບ່ອນນັ່ງ', { min: 1, max: 100 }),
      int(req.body.sort ?? t.sort, 'ລຳດັບ'),
      req.body.active === undefined ? t.active : bool(req.body.active),
      t.id,
    );
    emit(req.user.bid, ['tables']);
    res.json(db.get('SELECT * FROM tables WHERE id = ?', t.id));
  });
  r.delete('/tables/:id', requirePerm('admin'), (req, res) => {
    const id = int(req.params.id, 'id');
    if (db.get("SELECT 1 FROM orders WHERE table_id = ? AND status = 'open'", id)) throw bad('ໂຕະນີ້ມີອໍເດີເປີດຢູ່');
    const used = db.get('SELECT 1 FROM orders WHERE table_id = ? LIMIT 1', id);
    const { changes } = used
      ? db.run('UPDATE tables SET active = 0 WHERE id = ? AND branch_id = ?', id, req.user.bid)
      : db.run('DELETE FROM tables WHERE id = ? AND branch_id = ?', id, req.user.bid);
    if (!changes) throw notFound();
    emit(req.user.bid, ['tables']);
    res.json({ deleted: !used, deactivated: !!used });
  });

  return r;
}
