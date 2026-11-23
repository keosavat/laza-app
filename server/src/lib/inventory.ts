// Stock logic: ingredients, recipes, automatic deduction when an order is paid.
import type { Db } from '../db.ts';
import { now } from '../db.ts';
import { bad, notFound } from './core.ts';

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export type MoveType = 'in' | 'adjust' | 'waste' | 'sale';

/** Apply a signed quantity to an ingredient and log it. For purchases (`in`) the unit cost is averaged in. */
export function moveStock(
  db: Db,
  p: { bid: number; ingredientId: number; type: MoveType; qty: number; unitCost?: number; note?: string; lot?: string; expiresAt?: string | null; orderId?: number | null; uid?: number | null },
) {
  return db.tx(() => {
    const ing = db.get('SELECT * FROM ingredients WHERE id = ? AND branch_id = ?', p.ingredientId, p.bid);
    if (!ing) throw notFound('ບໍ່ພົບວັດຖຸດິບ');
    const balance = r3(ing.stock + p.qty);
    let cost = ing.cost;
    if (p.type === 'in' && p.unitCost !== undefined && p.qty > 0) {
      // Weighted average of what is on the shelf and what was just bought.
      cost = ing.stock > 0 ? (ing.stock * ing.cost + p.qty * p.unitCost) / (ing.stock + p.qty) : p.unitCost;
      cost = Math.round(cost * 100) / 100;
    }
    db.run('UPDATE ingredients SET stock = ?, cost = ? WHERE id = ?', balance, cost, ing.id);
    db.run(
      'INSERT INTO stock_moves (branch_id, ingredient_id, type, qty, unit_cost, balance, note, order_id, user_id, created_at, lot, expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      p.bid, ing.id, p.type, r3(p.qty), p.unitCost ?? cost, balance, p.note ?? '', p.orderId ?? null, p.uid ?? null, now(), p.lot ?? '', p.expiresAt ?? null,
    );
    if (cost !== ing.cost) syncCostsForIngredient(db, ing.id);
    return { balance, cost };
  });
}

/** Menu items whose "cost from recipe" switch is on get cost = sum(qty × ingredient cost). */
export function syncRecipeCost(db: Db, menuItemId: number) {
  const m = db.get('SELECT cost_from_recipe FROM menu_items WHERE id = ?', menuItemId);
  if (!m?.cost_from_recipe) return;
  const c = db.get(
    'SELECT COALESCE(SUM(rl.qty * i.cost), 0) AS v FROM recipe_lines rl JOIN ingredients i ON i.id = rl.ingredient_id WHERE rl.menu_item_id = ?',
    menuItemId,
  )!.v;
  db.run('UPDATE menu_items SET cost = ? WHERE id = ?', Math.round(c), menuItemId);
}

export function syncCostsForIngredient(db: Db, ingredientId: number) {
  for (const r of db.all('SELECT DISTINCT menu_item_id AS id FROM recipe_lines WHERE ingredient_id = ?', ingredientId)) syncRecipeCost(db, r.id);
}

/** How many portions of each menu item the current stock allows. Items without a recipe are not tracked (absent). */
export function portionsMap(db: Db, bid: number): Map<number, number> {
  const rows = db.all(
    `SELECT rl.menu_item_id AS id, MIN(CASE WHEN i.stock <= 0 THEN 0 ELSE CAST(i.stock / rl.qty AS INTEGER) END) AS portions
       FROM recipe_lines rl JOIN ingredients i ON i.id = rl.ingredient_id
      WHERE i.branch_id = ? AND i.active = 1 GROUP BY rl.menu_item_id`,
    bid,
  );
  return new Map(rows.map((r) => [r.id as number, r.portions as number]));
}

/** Portions left for one item, or null when the item has no recipe (not stock-tracked). */
export function portionsFor(db: Db, bid: number, menuItemId: number): number | null {
  return portionsMap(db, bid).get(menuItemId) ?? null;
}

/** Take the ingredients used by a paid order out of stock (once, inside the payment transaction). */
export function deductForOrder(db: Db, bid: number, orderId: number, uid: number | null) {
  const o = db.get('SELECT order_no FROM orders WHERE id = ?', orderId)!;
  const used = db.all(
    `SELECT rl.ingredient_id AS id, SUM(rl.qty * oi.qty) AS qty
       FROM order_items oi JOIN recipe_lines rl ON rl.menu_item_id = oi.menu_item_id
      WHERE oi.order_id = ? AND oi.status != 'cancelled' GROUP BY rl.ingredient_id`,
    orderId,
  );
  for (const u of used) moveStock(db, { bid, ingredientId: u.id, type: 'sale', qty: -u.qty, note: `ອໍເດີ #${o.order_no}`, orderId, uid });
}

/** Validates and replaces a menu item's recipe. */
export function saveRecipe(db: Db, bid: number, menuItemId: number, lines: { ingredientId: number; qty: number }[], costFromRecipe: boolean) {
  return db.tx(() => {
    if (!db.get('SELECT 1 FROM menu_items WHERE id = ? AND branch_id = ?', menuItemId, bid)) throw notFound('ບໍ່ພົບເມນູ');
    const seen = new Set<number>();
    for (const l of lines) {
      if (seen.has(l.ingredientId)) throw bad('ມີວັດຖຸດິບຊ້ຳໃນສູດ');
      seen.add(l.ingredientId);
      if (!db.get('SELECT 1 FROM ingredients WHERE id = ? AND branch_id = ?', l.ingredientId, bid)) throw bad('ບໍ່ພົບວັດຖຸດິບໃນສູດ');
      if (!(l.qty > 0)) throw bad('ຈຳນວນໃນສູດຕ້ອງຫຼາຍກວ່າ 0');
    }
    db.run('DELETE FROM recipe_lines WHERE menu_item_id = ?', menuItemId);
    for (const l of lines) db.run('INSERT INTO recipe_lines (menu_item_id, ingredient_id, qty) VALUES (?,?,?)', menuItemId, l.ingredientId, r3(l.qty));
    db.run('UPDATE menu_items SET cost_from_recipe = ? WHERE id = ?', costFromRecipe && lines.length ? 1 : 0, menuItemId);
    syncRecipeCost(db, menuItemId);
  });
}
