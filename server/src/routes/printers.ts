// Printer setup, print queue status and manual (re)print actions.
import net from 'node:net';
import { Router } from 'express';
import type { Ctx } from '../app.ts';
import { requirePerm } from '../auth.ts';
import { now } from '../db.ts';
import { bad, conflict, int, notFound, oneOf, str } from '../lib/core.ts';
import { loadOrder } from '../lib/orders.ts';
import { checkTarget, listSystemPrinters } from '../print/transport.ts';

/** LAN printers must live on the shop's own network: private or loopback IPv4, or a local hostname. */
function lanHost(v: unknown): string {
  const h = str(v, 'IP ເຄື່ອງພິມ', { required: true, max: 100 });
  if (net.isIPv4(h)) {
    const [a, b] = h.split('.').map(Number);
    const ok = a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
    if (!ok) throw bad('IP ເຄື່ອງພິມຕ້ອງເປັນ IP ພາຍໃນຮ້ານ ເຊັ່ນ 192.168.x.x ຫຼື 10.x.x.x');
    return h;
  }
  if (/^[a-z0-9-]{1,63}(\.local)?$/i.test(h)) return h;
  throw bad('IP ເຄື່ອງພິມບໍ່ຖືກຕ້ອງ (ເຊັ່ນ 192.168.1.50)');
}

export function printerRoutes({ db, emit, print }: Ctx) {
  const r = Router();

  const read = (body: any, prev?: any) => {
    const connection = oneOf(body.connection ?? prev?.connection, 'ການເຊື່ອມຕໍ່', ['lan', 'usb'] as const);
    return {
      name: str(body.name ?? prev?.name, 'ຊື່ເຄື່ອງພິມ', { required: true, max: 60 }),
      role: oneOf(body.role ?? prev?.role, 'ໜ້າທີ່', ['kitchen', 'bill'] as const),
      connection,
      host: connection === 'lan' ? lanHost(body.host ?? prev?.host) : '',
      port: connection === 'lan' ? int(body.port ?? prev?.port ?? 9100, 'Port', { min: 1, max: 65535 }) : 9100,
      system_name: connection === 'usb' ? str(body.system_name ?? prev?.system_name, 'ເຄື່ອງພິມ USB', { required: true, max: 200 }) : '',
      paper_mm: oneOf(String(body.paper_mm ?? prev?.paper_mm ?? 80), 'ຂະໜາດກະດາດ', ['58', '80'] as const) === '58' ? 58 : 80,
      cut: body.cut === undefined ? (prev?.cut ?? 1) : body.cut ? 1 : 0,
      copies: int(body.copies ?? prev?.copies ?? 1, 'ຈຳນວນສະບັບ', { min: 1, max: 5 }),
      active: body.active === undefined ? (prev?.active ?? 1) : body.active ? 1 : 0,
    };
  };

  r.get('/printers', requirePerm('admin'), (req, res) => {
    res.json(
      db.all(
        `SELECT p.*,
                (SELECT COUNT(*) FROM print_jobs j WHERE j.printer_id = p.id AND j.status IN ('queued','printing')) AS queued,
                (SELECT COUNT(*) FROM print_jobs j WHERE j.printer_id = p.id AND j.status = 'failed') AS failed
           FROM printers p WHERE p.branch_id = ? ORDER BY p.id`,
        req.user.bid,
      ),
    );
  });

  r.get('/printers/system', requirePerm('admin'), async (_req, res, next) => {
    try {
      res.json(await listSystemPrinters());
    } catch (e) {
      next(e);
    }
  });

  r.post('/printers', requirePerm('admin'), (req, res) => {
    const v = read(req.body ?? {});
    const { id } = db.run(
      `INSERT INTO printers (branch_id, name, role, connection, host, port, system_name, paper_mm, cut, copies, active, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      req.user.bid, v.name, v.role, v.connection, v.host, v.port, v.system_name, v.paper_mm, v.cut, v.copies, v.active, now(),
    );
    db.audit(req.user.bid, req.user.uid, 'create', 'printer', id, v);
    emit(req.user.bid, ['print', 'settings']);
    res.status(201).json(db.get('SELECT * FROM printers WHERE id = ?', id));
  });

  r.put('/printers/:id', requirePerm('admin'), (req, res) => {
    const prev = db.get('SELECT * FROM printers WHERE id = ? AND branch_id = ?', int(req.params.id, 'id'), req.user.bid);
    if (!prev) throw notFound('ບໍ່ພົບເຄື່ອງພິມ');
    const v = read(req.body ?? {}, prev);
    db.tx(() => {
      db.run(
        'UPDATE printers SET name=?, role=?, connection=?, host=?, port=?, system_name=?, paper_mm=?, cut=?, copies=?, active=? WHERE id=?',
        v.name, v.role, v.connection, v.host, v.port, v.system_name, v.paper_mm, v.cut, v.copies, v.active, prev.id,
      );
      // A printer that stopped being a kitchen printer can no longer receive category tickets.
      if (v.role !== 'kitchen') db.run('UPDATE categories SET printer_id = NULL WHERE printer_id = ?', prev.id);
      db.audit(req.user.bid, req.user.uid, 'update', 'printer', prev.id, v);
    });
    emit(req.user.bid, ['print', 'settings', 'menu']);
    res.json(db.get('SELECT * FROM printers WHERE id = ?', prev.id));
  });

  r.delete('/printers/:id', requirePerm('admin'), (req, res) => {
    const id = int(req.params.id, 'id');
    db.tx(() => {
      if (!db.get('SELECT 1 FROM printers WHERE id = ? AND branch_id = ?', id, req.user.bid)) throw notFound('ບໍ່ພົບເຄື່ອງພິມ');
      db.run('UPDATE categories SET printer_id = NULL WHERE printer_id = ?', id);
      db.run('DELETE FROM print_jobs WHERE printer_id = ?', id);
      db.run('DELETE FROM printers WHERE id = ?', id);
      db.audit(req.user.bid, req.user.uid, 'delete', 'printer', id);
    });
    emit(req.user.bid, ['print', 'settings', 'menu']);
    res.status(204).end();
  });

  r.post('/printers/:id/test', requirePerm('admin'), (req, res) => {
    const p = db.get('SELECT * FROM printers WHERE id = ? AND branch_id = ?', int(req.params.id, 'id'), req.user.bid);
    if (!p) throw notFound('ບໍ່ພົບເຄື່ອງພິມ');
    res.status(201).json({ jobId: print.test(req.user.bid, p.id) });
  });

  r.post('/printers/:id/check', requirePerm('admin'), async (req, res, next) => {
    try {
      const p = db.get('SELECT * FROM printers WHERE id = ? AND branch_id = ?', int(req.params.id, 'id'), req.user.bid);
      if (!p) throw notFound('ບໍ່ພົບເຄື່ອງພິມ');
      res.json(await checkTarget(p as any));
    } catch (e) {
      next(e);
    }
  });

  // ----- queue -----
  r.get('/print/status', requirePerm('kitchen'), (req, res) => {
    res.json({ ...print.status(req.user.bid), kitchen: print.hasPrinter(req.user.bid, 'kitchen'), bill: print.hasPrinter(req.user.bid, 'bill') });
  });

  r.get('/print/jobs', requirePerm('admin'), (req, res) => {
    res.json(
      db.all(
        `SELECT j.id, j.type, j.title, j.status, j.attempts, j.error, j.created_at, j.printed_at, j.order_id, p.name AS printer_name
           FROM print_jobs j JOIN printers p ON p.id = j.printer_id
          WHERE j.branch_id = ? ORDER BY j.id DESC LIMIT 50`,
        req.user.bid,
      ),
    );
  });

  r.post('/print/jobs/:id/retry', requirePerm('admin'), (req, res) => {
    const { changes } = db.run(
      "UPDATE print_jobs SET status = 'queued', attempts = 0, error = '', run_after = ? WHERE id = ? AND branch_id = ? AND status = 'failed'",
      now(), int(req.params.id, 'id'), req.user.bid,
    );
    if (!changes) throw notFound('ບໍ່ພົບງານພິມທີ່ລົ້ມເຫຼວນີ້');
    emit(req.user.bid, ['print']);
    res.json({ ok: true });
  });

  // ----- manual prints from the order screen -----
  r.post('/orders/:id/print/kitchen', requirePerm('kitchen'), (req, res) => {
    const o = loadOrder(db, int(req.params.id, 'id'), req.user.bid);
    if (!Array.isArray(req.body?.itemIds) || !req.body.itemIds.length) throw bad('ກະລຸນາເລືອກລາຍການ');
    if (!print.hasPrinter(req.user.bid, 'kitchen')) throw conflict('ຍັງບໍ່ໄດ້ຕັ້ງເຄື່ອງພິມຄົວ');
    const ids = req.body.itemIds.slice(0, 200).map((x: unknown) => int(x, 'ລາຍການ'));
    res.status(201).json({ tickets: print.kitchen(req.user.bid, o.id, ids, { reprint: true }) });
  });

  r.post('/orders/:id/print/receipt', requirePerm('pos'), (req, res) => {
    const o = loadOrder(db, int(req.params.id, 'id'), req.user.bid);
    if (o.status !== 'paid') throw conflict('ອໍເດີນີ້ຍັງບໍ່ໄດ້ຊຳລະ');
    if (!print.hasPrinter(req.user.bid, 'bill')) throw conflict('ຍັງບໍ່ໄດ້ຕັ້ງເຄື່ອງພິມບິນ');
    res.status(201).json({ tickets: print.receipt(req.user.bid, o.id) });
  });

  return r;
}
