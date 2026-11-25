import express, { type NextFunction, type Request, type Response } from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Server as IOServer } from 'socket.io';
import { openDb, type Db } from './db.ts';
import { makeAuth, type Auth } from './auth.ts';
import { HttpError } from './lib/core.ts';
import { catalogRoutes } from './routes/catalog.ts';
import { orderRoutes } from './routes/orders.ts';
import { authRoutes, opsRoutes } from './routes/ops.ts';
import { qrPublicRoutes, qrStaffRoutes } from './routes/qr.ts';
import { printerRoutes } from './routes/printers.ts';
import { debtRoutes } from './routes/debts.ts';
import { promotionRoutes } from './routes/promotions.ts';
import { inventoryRoutes } from './routes/inventory.ts';
import { reservationRoutes } from './routes/reservations.ts';
import { purchasingRoutes } from './routes/purchasing.ts';
import { depositRoutes } from './routes/deposits.ts';
import { branchRoutes } from './routes/branches.ts';
import { ownerRoutes } from './routes/owner.ts';
import { timerRoutes } from './routes/timers.ts';
import { createPrintService, type PrintService } from './print/service.ts';
import { securityHeaders } from './lib/security.ts';

export type Topic = 'orders' | 'tables' | 'kitchen' | 'menu' | 'shift' | 'settings' | 'qr' | 'print';

export interface Ctx {
  db: Db;
  auth: Auth;
  /** Tell every client of a branch that some data changed so they refetch. */
  emit: (branchId: number, topics: Topic[]) => void;
  /** Tell the customers who scanned an order's QR code to refetch. */
  emitOrder: (orderId: number) => void;
  /** Server-side printing to LAN/USB thermal printers. */
  print: PrintService;
}

export interface AppOptions {
  dbFile: string;
  jwtSecret: string;
  webDist?: string;
}

export function createApp(opts: AppOptions) {
  const db = openDb(opts.dbFile);
  const auth = makeAuth(opts.jwtSecret);
  const app = express();
  const server = http.createServer(app);
  const io = new IOServer(server, { cors: { origin: true } });

  io.use((socket, next) => {
    // Customers connect with the secret token from their QR code and only ever join that order's room.
    const qrToken = socket.handshake.auth?.qrToken;
    if (qrToken !== undefined) {
      if (typeof qrToken === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(qrToken) && db.get('SELECT 1 FROM orders WHERE qr_token = ?', qrToken)) {
        socket.join(`qr:${qrToken}`);
        return next();
      }
      return next(new Error('unauthorized'));
    }
    try {
      const u = auth.verify(String(socket.handshake.auth?.token ?? ''));
      socket.join(`branch:${u.bid}`);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  const emit = (bid: number, topics: Topic[]) => void io.to(`branch:${bid}`).emit('sync', { topics });
  const ctx: Ctx = {
    db,
    auth,
    emit,
    print: createPrintService(db, emit),
    emitOrder: (orderId) => {
      const o = db.get('SELECT qr_token FROM orders WHERE id = ?', orderId);
      if (o?.qr_token) io.to(`qr:${o.qr_token}`).emit('sync');
    },
  };

  /** After any successful staff change to an order, refresh that table's customers too. */
  const customerSync = (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') {
      res.on('finish', () => {
        if (res.statusCode >= 300) return;
        const a = req.path.match(/^\/orders\/(\d+)/);
        const b = req.path.match(/^\/order-items\/(\d+)/);
        const id = a ? Number(a[1]) : b ? db.get('SELECT order_id AS v FROM order_items WHERE id = ?', Number(b[1]))?.v : undefined;
        if (id) ctx.emitOrder(id);
      });
    }
    next();
  };

  /**
   * Idempotency-Key: a device that queued a request while offline may send it twice (the first reply was lost).
   * The first outcome is stored and replayed for repeats, so nothing is ordered or changed twice.
   */
  const idempotency = (req: Request, res: Response, next: NextFunction) => {
    const key = req.method === 'POST' ? String(req.get('idempotency-key') ?? '').slice(0, 80) : '';
    if (!key || !req.user) return next();
    const prev = db.get('SELECT status, body FROM idempotency WHERE user_id = ? AND key = ?', req.user.uid, key);
    if (prev) return void res.status(prev.status).set('x-idempotent-replay', '1').type('json').send(prev.body);
    const send = res.json.bind(res);
    res.json = (body: unknown) => {
      // Only remember definite outcomes (success or a rejected request), never server crashes.
      if (res.statusCode < 500) {
        try {
          db.run('INSERT OR IGNORE INTO idempotency (key, user_id, status, body, created_at) VALUES (?,?,?,?,?)', key, req.user.uid, res.statusCode, JSON.stringify(body ?? null), new Date().toISOString());
        } catch { /* best effort */ }
      }
      return send(body);
    };
    next();
  };
  // Keys are only needed for a day or two.
  db.run("DELETE FROM idempotency WHERE created_at < ?", new Date(Date.now() - 3 * 86_400_000).toISOString());

  app.disable('x-powered-by');
  // Behind a local tunnel (cloudflared) the real client address arrives in X-Forwarded-For.
  app.set('trust proxy', 'loopback');
  app.use(securityHeaders);
  // Behind a local tunnel (cloudflared) the real client address arrives in X-Forwarded-For.
  app.set('trust proxy', 'loopback');
  app.use(securityHeaders);
  app.use(express.json({ limit: '3mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'LAZA app' }));
  app.use('/api/auth', authRoutes(ctx));
  app.use('/api/public/qr', qrPublicRoutes(ctx));
  app.use('/api', auth.middleware, idempotency, customerSync, catalogRoutes(ctx), orderRoutes(ctx), qrStaffRoutes(ctx), printerRoutes(ctx), inventoryRoutes(ctx), promotionRoutes(ctx), debtRoutes(ctx), reservationRoutes(ctx), purchasingRoutes(ctx), depositRoutes(ctx), branchRoutes(ctx), ownerRoutes(ctx), timerRoutes(ctx), opsRoutes(ctx));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'ບໍ່ພົບ API ນີ້')));

  // Serve the built web app (production) with SPA fallback.
  if (opts.webDist && fs.existsSync(opts.webDist)) {
    app.use(express.static(opts.webDist, { index: false, maxAge: '1h', setHeaders: (res, file) => { if (/sw\.js$/.test(file)) res.setHeader('Cache-Control', 'no-cache'); } }));
    app.get(/^\/(?!api|socket\.io).*/, (_req, res) => res.sendFile(path.join(opts.webDist!, 'index.html')));
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'ຂໍ້ມູນ JSON ບໍ່ຖືກຕ້ອງ' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'ຂໍ້ມູນໃຫຍ່ເກີນໄປ (ຮູບບໍ່ຄວນເກີນ 2MB)' });
    if (String(err?.message).includes('idx_orders_one_open_per_table')) return res.status(409).json({ error: 'ໂຕະນີ້ມີອໍເດີເປີດຢູ່ແລ້ວ' });
    console.error(err);
    res.status(500).json({ error: 'ເກີດຂໍ້ຜິດພາດໃນລະບົບ' });
  });

  return { app, server, io, db, ctx, print: ctx.print };
}
