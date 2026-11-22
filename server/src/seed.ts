import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Db } from './db.ts';
import { now, openDb } from './db.ts';
import { hashPassword } from './auth.ts';

/** Demo accounts created on first run. Change these passwords in Staff settings before going live. */
export const DEMO_USERS = [
  { username: 'admin', password: 'laza1234', name: 'ເຈົ້າຂອງຮ້ານ', role: 'owner' },
  { username: 'manager', password: 'laza1234', name: 'ຜູ້ຈັດການ', role: 'manager' },
  { username: 'cashier', password: 'laza1234', name: 'ແຄັດເຊຍ', role: 'cashier' },
  { username: 'waiter', password: 'laza1234', name: 'ພະນັກງານເສີບ', role: 'waiter' },
  { username: 'kitchen', password: 'laza1234', name: 'ຄົວ', role: 'kitchen' },
] as const;

/** Create the demo restaurant if the database is empty. Returns true when data was created. */
export function seedIfEmpty(db: Db, opts: { withMenu?: boolean } = {}): boolean {
  if (db.get('SELECT id FROM restaurants LIMIT 1')) return false;
  const withMenu = opts.withMenu ?? true;
  db.tx(() => {
    const ts = now();
    const rid = db.run('INSERT INTO restaurants (name, created_at) VALUES (?,?)', 'LAZA Restaurant', ts).id;
    const bid = db.run(
      `INSERT INTO branches (restaurant_id, name, address, phone, vat_rate, service_rate, receipt_header, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      rid, 'ສາຂາຫຼັກ', 'ນະຄອນຫຼວງວຽງຈັນ', '020 0000 0000', 0, 0, 'ຍິນດີຕ້ອນຮັບ', ts,
    ).id;
    for (const u of DEMO_USERS) {
      db.run(
        'INSERT INTO users (restaurant_id, branch_id, name, username, password_hash, role, active, created_at) VALUES (?,?,?,?,?,?,1,?)',
        rid, bid, u.name, u.username, hashPassword(u.password), u.role, ts,
      );
    }
    if (!withMenu) return;

    const zoneIn = db.run('INSERT INTO zones (branch_id, name, sort) VALUES (?,?,?)', bid, 'ໃນຮ້ານ', 1).id;
    const zoneOut = db.run('INSERT INTO zones (branch_id, name, sort) VALUES (?,?,?)', bid, 'ນອກຮ້ານ', 2).id;
    for (let i = 1; i <= 8; i++) {
      db.run('INSERT INTO tables (branch_id, zone_id, name, seats, sort) VALUES (?,?,?,?,?)', bid, zoneIn, `A${String(i).padStart(2, '0')}`, 4, i);
    }
    for (let i = 1; i <= 4; i++) {
      db.run('INSERT INTO tables (branch_id, zone_id, name, seats, sort) VALUES (?,?,?,?,?)', bid, zoneOut, `B${String(i).padStart(2, '0')}`, 6, 10 + i);
    }

    const sweet = { name: 'ລະດັບຫວານ', required: false, multiple: false, choices: [{ name: 'ຫວານໜ້ອຍ', price: 0 }, { name: 'ຫວານປົກກະຕິ', price: 0 }, { name: 'ຫວານຫຼາຍ', price: 0 }] };
    const size = { name: 'ຂະໜາດ', required: true, multiple: false, choices: [{ name: 'ກາງ', price: 0 }, { name: 'ໃຫຍ່', price: 10000 }] };
    const spicy = { name: 'ລະດັບເຜັດ', required: false, multiple: false, choices: [{ name: 'ບໍ່ເຜັດ', price: 0 }, { name: 'ເຜັດກາງ', price: 0 }, { name: 'ເຜັດຫຼາຍ', price: 0 }] };
    const extra = { name: 'ເພີ່ມ', required: false, multiple: true, choices: [{ name: 'ໄຂ່ດາວ', price: 5000 }, { name: 'ເພີ່ມຊີ້ນ', price: 15000 }] };

    const menu: [string, [string, number, number, object[]][]][] = [
      ['ອາຫານລາວ', [
        ['ຕຳໝາກຫຸ່ງ', 25000, 8000, [spicy]],
        ['ລາບໄກ່', 45000, 18000, [spicy]],
        ['ປີ້ງໄກ່', 60000, 25000, []],
        ['ເຂົ້າໜຽວ', 5000, 1500, []],
        ['ເຝີຊີ້ນງົວ', 35000, 14000, [size, extra]],
      ]],
      ['ອາຫານຈານດຽວ', [
        ['ເຂົ້າຜັດໝູ', 30000, 11000, [extra]],
        ['ກະເພົາໝູສັບ', 35000, 13000, [spicy, extra]],
        ['ເຂົ້າມັນໄກ່', 30000, 12000, []],
      ]],
      ['ເຄື່ອງດື່ມ', [
        ['ກາເຟລາວເຢັນ', 20000, 6000, [sweet, size]],
        ['ຊາໄທ', 20000, 6000, [sweet]],
        ['ນ້ຳໝາກນາວ', 15000, 4000, [sweet]],
        ['ນ້ຳດື່ມ', 5000, 2500, []],
        ['ເບຍລາວ', 15000, 11000, []],
      ]],
    ];
    let sort = 0;
    menu.forEach(([cat, items], ci) => {
      const cid = db.run('INSERT INTO categories (branch_id, name, sort, active) VALUES (?,?,?,1)', bid, cat, ci + 1).id;
      for (const [name, price, cost, opts] of items) {
        db.run(
          'INSERT INTO menu_items (branch_id, category_id, name, price, cost, options_json, active, sort, created_at) VALUES (?,?,?,?,?,?,1,?,?)',
          bid, cid, name, price, cost, JSON.stringify(opts), ++sort, ts,
        );
      }
    });
  });
  return true;
}

// `npm run seed` → seed the default database file.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.env.LAZA_DB ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'laza.db');
  const db = openDb(file);
  console.log(seedIfEmpty(db) ? `Seeded demo data into ${file}` : `Database ${file} already has data; nothing to do.`);
}
