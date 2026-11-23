// Ingredients, stock movements and recipes.
import { Router } from 'express';
import type { Ctx } from '../app.ts';
import { requirePerm } from '../auth.ts';
import { now } from '../db.ts';
import { bad, int, notFound, num, oneOf, str } from '../lib/core.ts';
import { moveStock, saveRecipe, syncCostsForIngredient } from '../lib/inventory.ts';

export function inventoryRoutes({ db, emit }: Ctx) {
  const r = Router();
  const changed = (bid: number) => emit(bid, ['menu', 'orders']);

  const out = (i: any) => ({ ...i, low: i.active && i.stock <= i.low_at, out: i.active && i.stock <= 0, value: Math.round(Math.max(i.stock, 0) * i.cost), suggest: i.active && i.refill_to > i.stock && (i.stock <= i.low_at || i.low_at === 0) ? Math.round((i.refill_to - i.stock) * 1000) / 1000 : 0 });

  r.get('/ingredients', requirePerm('admin'), (req, res) => {
    res.json(
      db
        .all(
          `SELECT i.*, (SELECT COUNT(*) FROM recipe_lines rl WHERE rl.ingredient_id = i.id) AS used_in,
                    (SELECT MIN(m.expires_at) FROM stock_moves m WHERE m.ingredient_id = i.id AND m.type = 'in' AND m.expires_at IS NOT NULL AND i.stock > 0) AS next_expiry
             FROM ingredients i WHERE i.branch_id = ? ORDER BY i.active DESC, i.name`,
          req.user.bid,
        )
        .map(out),
    );
  });

  const read = (body: any, prev?: any) => ({
    name: str(body.name ?? prev?.name, 'ຊື່ວັດຖຸດິບ', { required: true, max: 80 }),
    unit: str(body.unit ?? prev?.unit ?? 'ອັນ', 'ຫົວໜ່ວຍ', { required: true, max: 20 }),
    cost: num(body.cost ?? prev?.cost ?? 0, 'ຕົ້ນທຶນ/ຫົວໜ່ວຍ', { min: 0, max: 1e9 }),
    low_at: num(body.lowAt ?? prev?.low_at ?? 0, 'ແຈ້ງເຕືອນເມື່ອເຫຼືອ', { min: 0, max: 1e9 }),
    category: str(body.category ?? prev?.category ?? '', 'ໝວດ', { max: 40 }),
    pack_name: str(body.packName ?? prev?.pack_name ?? '', 'ຫົວໜ່ວຍແພັກ', { max: 20 }),
    pack_size: num(body.packSize ?? prev?.pack_size ?? 0, 'ຂະໜາດແພັກ', { min: 0, max: 1e9 }),
    refill_to: num(body.refillTo ?? prev?.refill_to ?? 0, 'ເຕີມໃຫ້ເຖິງ', { min: 0, max: 1e9 }),
    active: body.active === undefined ? (prev?.active ?? 1) : body.active ? 1 : 0,
  });

  const checkRead = (v: ReturnType<typeof read>) => {
    if (!!v.pack_name !== v.pack_size > 0) throw bad('ກະລຸນາໃສ່ທັງຊື່ແພັກ ແລະ ຂະໜາດແພັກ (ຫຼື ປ່ອຍວ່າງທັງສອງ)');
    if (v.refill_to > 0 && v.refill_to < v.low_at) throw bad('"ເຕີມໃຫ້ເຖິງ" ຕ້ອງບໍ່ໜ້ອຍກວ່າ "ແຈ້ງເຕືອນເມື່ອເຫຼືອ"');
  };

  r.post('/ingredients', requirePerm('admin'), (req, res) => {
    const v = read(req.body ?? {});
    checkRead(v);
    const start = req.body.stock === undefined ? 0 : num(req.body.stock, 'ສະຕັອກເລີ່ມຕົ້ນ', { min: 0, max: 1e9 });
    const id = db.tx(() => {
      const { id } = db.run('INSERT INTO ingredients (branch_id, name, unit, cost, stock, low_at, active, created_at, category, pack_name, pack_size, refill_to) VALUES (?,?,?,?,0,?,?,?,?,?,?,?)', req.user.bid, v.name, v.unit, v.cost, v.low_at, v.active, now(), v.category, v.pack_name, v.pack_size, v.refill_to);
      if (start > 0) moveStock(db, { bid: req.user.bid, ingredientId: id, type: 'adjust', qty: start, note: 'ສະຕັອກເລີ່ມຕົ້ນ', uid: req.user.uid });
      db.audit(req.user.bid, req.user.uid, 'create', 'ingredient', id, v);
      return id;
    });
    changed(req.user.bid);
    res.status(201).json(out(db.get('SELECT * FROM ingredients WHERE id = ?', id)));
  });

  r.put('/ingredients/:id', requirePerm('admin'), (req, res) => {
    const prev = db.get('SELECT * FROM ingredients WHERE id = ? AND branch_id = ?', int(req.params.id, 'id'), req.user.bid);
    if (!prev) throw notFound('ບໍ່ພົບວັດຖຸດິບ');
    const v = read(req.body ?? {}, prev);
    checkRead(v);
    db.tx(() => {
      db.run('UPDATE ingredients SET name=?, unit=?, cost=?, low_at=?, active=?, category=?, pack_name=?, pack_size=?, refill_to=? WHERE id=?', v.name, v.unit, v.cost, v.low_at, v.active, v.category, v.pack_name, v.pack_size, v.refill_to, prev.id);
      if (v.cost !== prev.cost) syncCostsForIngredient(db, prev.id);
      db.audit(req.user.bid, req.user.uid, 'update', 'ingredient', prev.id, v);
    });
    changed(req.user.bid);
    res.json(out(db.get('SELECT * FROM ingredients WHERE id = ?', prev.id)));
  });

  r.delete('/ingredients/:id', requirePerm('admin'), (req, res) => {
    const id = int(req.params.id, 'id');
    const ing = db.get('SELECT * FROM ingredients WHERE id = ? AND branch_id = ?', id, req.user.bid);
    if (!ing) throw notFound('ບໍ່ພົບວັດຖຸດິບ');
    if (db.get('SELECT 1 FROM recipe_lines WHERE ingredient_id = ? LIMIT 1', id)) throw bad('ວັດຖຸດິບນີ້ຢູ່ໃນສູດອາຫານ ກະລຸນາເອົາອອກຈາກສູດກ່ອນ ຫຼື ປິດໃຊ້ງານແທນ');
    const used = db.get('SELECT 1 FROM stock_moves WHERE ingredient_id = ? LIMIT 1', id);
    if (used) db.run('UPDATE ingredients SET active = 0 WHERE id = ?', id);
    else db.run('DELETE FROM ingredients WHERE id = ?', id);
    changed(req.user.bid);
    res.json({ deleted: !used, deactivated: !!used });
  });

  /** Receive stock (in), count it (adjust = set to the counted amount) or write off waste. */
  r.post('/ingredients/:id/stock', requirePerm('admin'), (req, res) => {
    const ing = db.get('SELECT * FROM ingredients WHERE id = ? AND branch_id = ?', int(req.params.id, 'id'), req.user.bid);
    if (!ing) throw notFound('ບໍ່ພົບວັດຖຸດິບ');
    const type = oneOf(req.body.type, 'ປະເພດ', ['in', 'adjust', 'waste'] as const);
    const byPack = req.body.byPack === true;
    if (byPack && !(ing.pack_size > 0)) throw bad('ວັດຖຸດິບນີ້ຍັງບໍ່ໄດ້ຕັ້ງຂະໜາດແພັກ');
    const mult = byPack && type === 'in' ? ing.pack_size : 1;
    const qty = num(req.body.qty, 'ຈຳນວນ', { min: type === 'adjust' ? 0 : 0.001, max: 1e9 }) * mult;
    const lot = str(req.body.lot, 'ລັອດ', { max: 40 });
    const expiresAt = req.body.expiresAt ? String(req.body.expiresAt) : null;
    if (expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) throw bad('ວັນໝົດອາຍຸບໍ່ຖືກຕ້ອງ');
    const note = str(req.body.note, 'ໝາຍເຫດ', { max: 200 });
    const delta = type === 'in' ? qty : type === 'waste' ? -qty : qty - ing.stock;
    const result = moveStock(db, {
      bid: req.user.bid,
      ingredientId: ing.id,
      type,
      qty: delta,
      unitCost: type === 'in' && req.body.unitCost !== undefined && req.body.unitCost !== '' ? num(req.body.unitCost, 'ລາຄາຊື້/ຫົວໜ່ວຍ', { min: 0, max: 1e9 }) / mult : undefined,
      lot: type === 'in' ? lot : '',
      expiresAt: type === 'in' ? expiresAt : null,
      note,
      uid: req.user.uid,
    });
    db.audit(req.user.bid, req.user.uid, `stock_${type}`, 'ingredient', ing.id, { qty: delta, note });
    changed(req.user.bid);
    res.status(201).json({ ...result, ingredient: out(db.get('SELECT * FROM ingredients WHERE id = ?', ing.id)) });
  });

  r.get('/stock/moves', requirePerm('admin'), (req, res) => {
    const where = ['m.branch_id = ?'];
    const params: any[] = [req.user.bid];
    if (req.query.ingredientId) {
      where.push('m.ingredient_id = ?');
      params.push(int(req.query.ingredientId, 'ingredientId'));
    }
    res.json(
      db.all(
        `SELECT m.*, i.name AS ingredient_name, i.unit, u.name AS user_name
           FROM stock_moves m JOIN ingredients i ON i.id = m.ingredient_id LEFT JOIN users u ON u.id = m.user_id
          WHERE ${where.join(' AND ')} ORDER BY m.id DESC LIMIT 200`,
        ...params,
      ),
    );
  });

  /** Counts for dashboards and the sidebar warning. Visible to anyone who sells (not just admins). */
  r.get('/inventory/summary', requirePerm('pos'), (req, res) => {
    const rows = db.all('SELECT * FROM ingredients WHERE branch_id = ? AND active = 1', req.user.bid).map(out);
    const low = rows.filter((i) => i.low).sort((a, b) => a.stock - b.stock);
    res.json({
      lowCount: low.length,
      outCount: rows.filter((i) => i.out).length,
      stockValue: rows.reduce((s, i) => s + i.value, 0),
      missingRecipe: db.all(
        `SELECT id, name FROM menu_items WHERE branch_id = ? AND active = 1 AND NOT EXISTS (SELECT 1 FROM recipe_lines rl WHERE rl.menu_item_id = menu_items.id) ORDER BY name`,
        req.user.bid,
      ),
      menuTotal: (db.get('SELECT COUNT(*) AS c FROM menu_items WHERE branch_id = ? AND active = 1', req.user.bid) as any).c,
      low: low.slice(0, 20).map((i) => ({ id: i.id, name: i.name, unit: i.unit, stock: i.stock, low_at: i.low_at })),
    });
  });

  // ----- recipes -----
  r.get('/menu-items/:id/recipe', requirePerm('admin'), (req, res) => {
    const id = int(req.params.id, 'id');
    const m = db.get('SELECT id, name, price, cost, cost_from_recipe FROM menu_items WHERE id = ? AND branch_id = ?', id, req.user.bid);
    if (!m) throw notFound('ບໍ່ພົບເມນູ');
    const lines = db.all(
      `SELECT rl.ingredient_id AS ingredientId, rl.qty, i.name, i.unit, i.cost, i.stock, ROUND(rl.qty * i.cost) AS line_cost
         FROM recipe_lines rl JOIN ingredients i ON i.id = rl.ingredient_id WHERE rl.menu_item_id = ? ORDER BY i.name`,
      id,
    );
    res.json({ item: m, costFromRecipe: !!m.cost_from_recipe, lines, recipeCost: lines.reduce((s, l) => s + l.line_cost, 0) });
  });

  r.put('/menu-items/:id/recipe', requirePerm('admin'), (req, res) => {
    const id = int(req.params.id, 'id');
    if (!Array.isArray(req.body.lines) || req.body.lines.length > 60) throw bad('ສູດບໍ່ຖືກຕ້ອງ');
    const lines = req.body.lines.map((l: any) => ({ ingredientId: int(l?.ingredientId, 'ວັດຖຸດິບ', { required: true }), qty: num(l?.qty, 'ຈຳນວນ', { min: 0.001, max: 1e9 }) }));
    saveRecipe(db, req.user.bid, id, lines, !!req.body.costFromRecipe);
    db.audit(req.user.bid, req.user.uid, 'recipe', 'menu_item', id, { lines: lines.length });
    changed(req.user.bid);
    res.json({ ok: true });
  });

  return r;
}
