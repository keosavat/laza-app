import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { seedIfEmpty } from './seed.ts';
import { backupDb, usersWithDefaultPassword } from './lib/security.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.LAZA_DATA_DIR ?? path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });

// A random JWT secret is generated once and kept next to the database.
function loadSecret(): string {
  if (process.env.LAZA_JWT_SECRET) return process.env.LAZA_JWT_SECRET;
  const file = path.join(dataDir, 'jwt-secret');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}

const { server, db, print } = createApp({
  dbFile: process.env.LAZA_DB ?? path.join(dataDir, 'laza.db'),
  jwtSecret: loadSecret(),
  webDist: path.join(root, '..', 'web', 'dist'),
});

print.start();

// One consistent copy of the database per day (kept 14 days). Copy the folder to a USB drive / cloud storage too.
const backupDir = process.env.LAZA_BACKUP_DIR ?? path.join(dataDir, 'backups');
const runBackup = () => {
  try {
    const f = backupDb(db, backupDir, Number(process.env.LAZA_BACKUP_KEEP ?? 14));
    if (f) console.log(`Backup saved → ${f}`);
  } catch (e) {
    console.error('Backup failed:', e);
  }
};
runBackup();
setInterval(runBackup, 3_600_000).unref();

const weak = usersWithDefaultPassword(db);
if (weak.length) console.warn(`⚠ ເຕືອນ: ${weak.map((u) => u.username).join(', ')} ຍັງໃຊ້ລະຫັດຜ່ານທົດລອງ — ປ່ຽນໃນໜ້າ "ພະນັກງານ" ກ່ອນເປີດໃຫ້ເຂົ້າຈາກອິນເຕີເນັດ`);
if (seedIfEmpty(db)) console.log('First run: demo restaurant created (see README for demo logins).');

const port = Number(process.env.PORT ?? 4000);
server.listen(port, () => console.log(`LAZA app server → http://localhost:${port}`));
