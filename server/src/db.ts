import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export type Row = Record<string, any>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS restaurants (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  vat_rate REAL NOT NULL DEFAULT 0,
  service_rate REAL NOT NULL DEFAULT 0,
  rate_usd REAL NOT NULL DEFAULT 21500,
  rate_thb REAL NOT NULL DEFAULT 650,
  utc_offset_min INTEGER NOT NULL DEFAULT 420,
  receipt_header TEXT NOT NULL DEFAULT '',
  receipt_footer TEXT NOT NULL DEFAULT 'ຂອບໃຈທີ່ໃຊ້ບໍລິການ',
  bank_info TEXT NOT NULL DEFAULT '',
  order_seq INTEGER NOT NULL DEFAULT 0,
  bill_seq INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','manager','cashier','waiter','kitchen')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  category_id INTEGER REFERENCES categories(id),
  name TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  cost INTEGER NOT NULL DEFAULT 0,
  image_url TEXT NOT NULL DEFAULT '',
  options_json TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS zones (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tables (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  seats INTEGER NOT NULL DEFAULT 4,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  status TEXT NOT NULL CHECK (status IN ('open','closed')),
  opened_by INTEGER NOT NULL REFERENCES users(id),
  opened_at TEXT NOT NULL,
  opening_cash INTEGER NOT NULL DEFAULT 0,
  closed_by INTEGER REFERENCES users(id),
  closed_at TEXT,
  counted_cash INTEGER,
  expected_cash INTEGER,
  note TEXT NOT NULL DEFAULT '',
  queue_seq INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  shift_id INTEGER REFERENCES shifts(id),
  order_no TEXT NOT NULL,
  bill_no TEXT,
  type TEXT NOT NULL CHECK (type IN ('dine_in','takeaway')),
  table_id INTEGER REFERENCES tables(id),
  queue_no INTEGER,
  status TEXT NOT NULL CHECK (status IN ('open','paid','cancelled')),
  customer_name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  discount_type TEXT NOT NULL DEFAULT 'none' CHECK (discount_type IN ('none','percent','amount')),
  discount_value REAL NOT NULL DEFAULT 0,
  subtotal INTEGER NOT NULL DEFAULT 0,
  discount INTEGER NOT NULL DEFAULT 0,
  service INTEGER NOT NULL DEFAULT 0,
  vat INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  paid_total INTEGER NOT NULL DEFAULT 0,
  change_lak INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  bill_printed_at TEXT,
  paid_at TEXT,
  paid_by INTEGER REFERENCES users(id),
  cancelled_at TEXT,
  cancel_reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_orders_branch_status ON orders(branch_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_paid_at ON orders(branch_id, paid_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_one_open_per_table ON orders(table_id) WHERE status = 'open' AND table_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  menu_item_id INTEGER REFERENCES menu_items(id),
  category_id INTEGER,
  name TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL DEFAULT 0,
  qty INTEGER NOT NULL CHECK (qty > 0),
  options_json TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending','preparing','ready','served','cancelled')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancel_reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_status ON order_items(status);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  shift_id INTEGER NOT NULL REFERENCES shifts(id),
  method TEXT NOT NULL CHECK (method IN ('cash','transfer','qr','card')),
  currency TEXT NOT NULL CHECK (currency IN ('LAK','USD','THB')),
  amount REAL NOT NULL,
  rate REAL NOT NULL,
  amount_lak INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_shift ON payments(shift_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
`;

export function now(): string {
  return new Date().toISOString();
}

export function openDb(file: string): Db {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  raw.exec(SCHEMA);
  migrate(raw);
  return createDb(raw);
}

function addColumn(raw: DatabaseSync, table: string, col: string, ddl: string) {
  const cols = (raw.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((c) => c.name);
  if (!cols.includes(col)) raw.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
}

/** Additive migrations so databases created by earlier versions keep working. */
function migrate(raw: DatabaseSync) {
  // QR self-ordering: a dine-in order owns a secret token for its customers.
  addColumn(raw, 'orders', 'qr_token', 'TEXT');
  addColumn(raw, 'orders', 'qr_expires_at', 'TEXT');
  addColumn(raw, 'orders', 'guest_count', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(raw, 'order_items', 'awaiting', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(raw, 'order_items', 'source', "TEXT NOT NULL DEFAULT 'staff'");
  addColumn(raw, 'branches', 'qr_enabled', 'INTEGER NOT NULL DEFAULT 1');
  addColumn(raw, 'branches', 'qr_auto_confirm', 'INTEGER NOT NULL DEFAULT 1');
  addColumn(raw, 'branches', 'public_url', "TEXT NOT NULL DEFAULT ''");
  // Inventory: ingredients with stock, recipes (menu item → ingredient quantities), and a stock movement log.
  addColumn(raw, 'menu_items', 'cost_from_recipe', 'INTEGER NOT NULL DEFAULT 0');
  raw.exec(`
    CREATE TABLE IF NOT EXISTS ingredients (
      id INTEGER PRIMARY KEY,
      branch_id INTEGER NOT NULL REFERENCES branches(id),
      name TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'ອັນ',
      cost REAL NOT NULL DEFAULT 0,
      stock REAL NOT NULL DEFAULT 0,
      low_at REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS recipe_lines (
      menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
      ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
      qty REAL NOT NULL CHECK (qty > 0),
      PRIMARY KEY (menu_item_id, ingredient_id)
    );
    CREATE TABLE IF NOT EXISTS stock_moves (
      id INTEGER PRIMARY KEY,
      branch_id INTEGER NOT NULL REFERENCES branches(id),
      ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
      type TEXT NOT NULL CHECK (type IN ('in','adjust','waste','sale')),
      qty REAL NOT NULL,
      unit_cost REAL NOT NULL DEFAULT 0,
      balance REAL NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      order_id INTEGER REFERENCES orders(id),
      user_id INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stock_moves_ing ON stock_moves(ingredient_id, id);
  `);
  addColumn(raw, 'ingredients', 'category', "TEXT NOT NULL DEFAULT ''");
  addColumn(raw, 'ingredients', 'pack_name', "TEXT NOT NULL DEFAULT ''");
  addColumn(raw, 'ingredients', 'pack_size', 'REAL NOT NULL DEFAULT 0');
  addColumn(raw, 'ingredients', 'refill_to', 'REAL NOT NULL DEFAULT 0');
  addColumn(raw, 'stock_moves', 'lot', "TEXT NOT NULL DEFAULT ''");
  addColumn(raw, 'stock_moves', 'expires_at', 'TEXT');
  // Customers and their credit accounts (debts).
  addColumn(raw, 'orders', 'debt_customer_id', 'INTEGER');
  addColumn(raw, 'orders', 'debt_amount', 'INTEGER NOT NULL DEFAULT 0');
  raw.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY,
      branch_id INTEGER NOT NULL REFERENCES branches(id),
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      credit_limit INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS debt_entries (
      id INTEGER PRIMARY KEY,
      branch_id INTEGER NOT NULL REFERENCES branches(id),
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      type TEXT NOT NULL CHECK (type IN ('charge','payment')),
      amount INTEGER NOT NULL CHECK (amount > 0),
      order_id INTEGER REFERENCES orders(id),
      method TEXT NOT NULL DEFAULT '',
      shift_id INTEGER REFERENCES shifts(id),
      note TEXT NOT NULL DEFAULT '',
      user_id INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_debt_entries_cust ON debt_entries(customer_id, id);
  `);
  // Promotions / coupons.
  addColumn(raw, 'orders', 'promo_id', 'INTEGER');
  addColumn(raw, 'orders', 'promo_name', "TEXT NOT NULL DEFAULT ''");
  raw.exec(`
    CREATE TABLE IF NOT EXISTS promotions (
      id INTEGER PRIMARY KEY,
      branch_id INTEGER NOT NULL REFERENCES branches(id),
      name TEXT NOT NULL,
      code TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL CHECK (type IN ('percent','amount')),
      value REAL NOT NULL,
      min_subtotal INTEGER NOT NULL DEFAULT 0,
      max_discount INTEGER NOT NULL DEFAULT 0,
      starts_on TEXT NOT NULL DEFAULT '',
      ends_on TEXT NOT NULL DEFAULT '',
      days TEXT NOT NULL DEFAULT '0123456',
      time_from TEXT NOT NULL DEFAULT '',
      time_to TEXT NOT NULL DEFAULT '',
      order_type TEXT NOT NULL DEFAULT 'all',
      max_uses INTEGER NOT NULL DEFAULT 0,
      used_count INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);
  // Printing: category → kitchen printer routing, auto-print switch.
  addColumn(raw, 'categories', 'printer_id', 'INTEGER');
  addColumn(raw, 'branches', 'auto_kitchen_print', 'INTEGER NOT NULL DEFAULT 1');
  raw.exec(`
    CREATE TABLE IF NOT EXISTS printers (
      id INTEGER PRIMARY KEY,
      branch_id INTEGER NOT NULL REFERENCES branches(id),
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('kitchen','bill')),
      connection TEXT NOT NULL CHECK (connection IN ('lan','usb')),
      host TEXT NOT NULL DEFAULT '',
      port INTEGER NOT NULL DEFAULT 9100,
      system_name TEXT NOT NULL DEFAULT '',
      paper_mm INTEGER NOT NULL DEFAULT 80 CHECK (paper_mm IN (58,80)),
      cut INTEGER NOT NULL DEFAULT 1,
      copies INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      last_ok_at TEXT,
      last_error TEXT NOT NULL DEFAULT '',
      last_error_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS print_jobs (
      id INTEGER PRIMARY KEY,
      branch_id INTEGER NOT NULL REFERENCES branches(id),
      printer_id INTEGER NOT NULL REFERENCES printers(id),
      type TEXT NOT NULL CHECK (type IN ('kitchen','bill','receipt','test')),
      order_id INTEGER REFERENCES orders(id),
      title TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued','printing','done','failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT '',
      run_after TEXT NOT NULL,
      created_at TEXT NOT NULL,
      printed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_print_jobs_due ON print_jobs(status, run_after);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_qr_token ON orders(qr_token) WHERE qr_token IS NOT NULL;
    CREATE TABLE IF NOT EXISTS qr_calls (
      id INTEGER PRIMARY KEY,
      branch_id INTEGER NOT NULL REFERENCES branches(id),
      order_id INTEGER NOT NULL REFERENCES orders(id),
      type TEXT NOT NULL CHECK (type IN ('waiter','bill')),
      created_at TEXT NOT NULL,
      handled_at TEXT,
      handled_by INTEGER REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_qr_calls_open ON qr_calls(branch_id, handled_at);
  `);
}

export type Db = ReturnType<typeof createDb>;

function createDb(raw: DatabaseSync) {
  let depth = 0;
  const db = {
    raw,
    all(sql: string, ...params: any[]): Row[] {
      return raw.prepare(sql).all(...params) as Row[];
    },
    get(sql: string, ...params: any[]): Row | undefined {
      return raw.prepare(sql).get(...params) as Row | undefined;
    },
    run(sql: string, ...params: any[]): { id: number; changes: number } {
      const r = raw.prepare(sql).run(...params);
      return { id: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    /** Run fn inside a transaction (nested calls join the outer one). */
    tx<T>(fn: () => T): T {
      if (depth > 0) return fn();
      depth++;
      raw.exec('BEGIN IMMEDIATE');
      try {
        const out = fn();
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      } finally {
        depth--;
      }
    },
    audit(branchId: number | null, userId: number | null, action: string, entity: string, entityId: number | null, data: unknown = {}) {
      raw
        .prepare('INSERT INTO audit_log (branch_id, user_id, action, entity, entity_id, data_json, created_at) VALUES (?,?,?,?,?,?,?)')
        .run(branchId, userId, action, entity, entityId, JSON.stringify(data), now());
    },
  };
  return db;
}
