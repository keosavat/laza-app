// Owner screens for the public API: API keys and webhook receivers (+ their delivery log).
import crypto from 'node:crypto';
import { Router } from 'express';
import type { Ctx } from '../app.ts';
import { requirePerm } from '../auth.ts';
import { now } from '../db.ts';
import { bad, int, notFound, oneOf, str } from '../lib/core.ts';
import { SCOPES, SCOPE_LABEL, generateKey, type Scope } from '../lib/apikeys.ts';
import { EVENTS, checkWebhookUrl, deliverOne } from '../lib/webhooks.ts';

/** Express 4 does not catch a rejected promise from an async handler: forward it so the client gets an answer. */
const safe = (fn: (req: any, res: any) => Promise<void>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

export function integrationRoutes({ db }: Ctx) {
  const r = Router();

  r.get('/integrations/meta', requirePerm('owner'), (_req, res) => {
    res.json({ scopes: SCOPES.map((s) => ({ id: s, label: SCOPE_LABEL[s] })), events: EVENTS });
  });

  // ---------- API keys ----------
  const keyOut = (k: any) => ({ id: k.id, name: k.name, prefix: k.prefix, scopes: String(k.scopes).split(',').filter(Boolean), auto_confirm: !!k.auto_confirm, active: !!k.active, created_at: k.created_at, last_used_at: k.last_used_at, revoked_at: k.revoked_at });

  r.get('/integrations/keys', requirePerm('owner'), (req, res) => {
    res.json(db.all('SELECT * FROM api_keys WHERE branch_id = ? ORDER BY active DESC, id DESC', req.user.bid).map(keyOut));
  });

  /** The full key is returned once, here. Only its hash is stored. */
  r.post('/integrations/keys', requirePerm('owner'), (req, res) => {
    const name = str(req.body.name, 'ຊື່', { required: true, max: 60 });
    const scopes = (Array.isArray(req.body.scopes) ? req.body.scopes : []).map((s: unknown) => oneOf(s, 'ສິດ', SCOPES as readonly Scope[]));
    if (!scopes.length) throw bad('ກະລຸນາເລືອກຢ່າງໜ້ອຍ 1 ສິດ');
    const { key, prefix, hash } = generateKey();
    const { id } = db.run('INSERT INTO api_keys (branch_id, name, prefix, key_hash, scopes, auto_confirm, active, created_by, created_at) VALUES (?,?,?,?,?,?,1,?,?)', req.user.bid, name, prefix, hash, [...new Set<string>(scopes)].join(','), req.body.autoConfirm ? 1 : 0, req.user.uid, now());
    db.audit(req.user.bid, req.user.uid, 'create', 'api_key', id, { name, scopes });
    res.status(201).json({ ...keyOut(db.get('SELECT * FROM api_keys WHERE id = ?', id)), key });
  });

  r.delete('/integrations/keys/:id', requirePerm('owner'), (req, res) => {
    const k = db.get('SELECT * FROM api_keys WHERE id = ? AND branch_id = ?', int(req.params.id, 'id'), req.user.bid);
    if (!k) throw notFound('ບໍ່ພົບ API key');
    db.run('UPDATE api_keys SET active = 0, revoked_at = ? WHERE id = ?', now(), k.id);
    db.audit(req.user.bid, req.user.uid, 'revoke', 'api_key', k.id, { name: k.name });
    res.json({ revoked: true });
  });

  // ---------- webhook receivers ----------
  const hookOut = (e: any, withSecret = false) => ({
    id: e.id, url: e.url, events: e.events === '*' ? ['*'] : String(e.events).split(','), description: e.description, active: !!e.active, created_at: e.created_at,
    secret: withSecret ? e.secret : `${String(e.secret).slice(0, 6)}…`,
    stats: db.get("SELECT SUM(status='ok') AS ok, SUM(status IN ('pending','failed')) AS waiting, SUM(status='dead') AS dead FROM webhook_deliveries WHERE endpoint_id = ?", e.id),
  });
  const readEvents = (v: unknown): string => {
    if (v === undefined || (Array.isArray(v) && v.includes('*'))) return '*';
    if (!Array.isArray(v) || !v.length) throw bad('ກະລຸນາເລືອກ event ຢ່າງໜ້ອຍ 1 ອັນ');
    return [...new Set<string>(v.map((x) => oneOf(x, 'event', EVENTS as readonly string[])))].join(',');
  };
  const url = (v: unknown) => {
    try {
      return checkWebhookUrl(str(v, 'URL', { required: true, max: 300 }));
    } catch (e: any) {
      throw bad(e.message);
    }
  };
  const load = (id: number, bid: number) => {
    const e = db.get('SELECT * FROM webhook_endpoints WHERE id = ? AND branch_id = ?', id, bid);
    if (!e) throw notFound('ບໍ່ພົບ webhook');
    return e;
  };

  r.get('/integrations/webhooks', requirePerm('owner'), (req, res) => {
    res.json(db.all('SELECT * FROM webhook_endpoints WHERE branch_id = ? ORDER BY id DESC', req.user.bid).map((e) => hookOut(e)));
  });

  r.post('/integrations/webhooks', requirePerm('owner'), (req, res) => {
    const secret = 'whsec_' + crypto.randomBytes(24).toString('base64url');
    const { id } = db.run('INSERT INTO webhook_endpoints (branch_id, url, secret, events, description, active, created_at) VALUES (?,?,?,?,?,1,?)', req.user.bid, url(req.body.url), secret, readEvents(req.body.events), str(req.body.description, 'ຄຳອະທິບາຍ', { max: 100 }), now());
    db.audit(req.user.bid, req.user.uid, 'create', 'webhook', id, { url: req.body.url });
    res.status(201).json(hookOut(db.get('SELECT * FROM webhook_endpoints WHERE id = ?', id), true)); // the secret is shown here (and when rotated)
  });

  r.put('/integrations/webhooks/:id', requirePerm('owner'), (req, res) => {
    const e = load(int(req.params.id, 'id'), req.user.bid);
    db.run('UPDATE webhook_endpoints SET url=?, events=?, description=?, active=? WHERE id=?', req.body.url === undefined ? e.url : url(req.body.url), req.body.events === undefined ? e.events : readEvents(req.body.events), req.body.description === undefined ? e.description : str(req.body.description, 'ຄຳອະທິບາຍ', { max: 100 }), req.body.active === undefined ? e.active : req.body.active ? 1 : 0, e.id);
    db.audit(req.user.bid, req.user.uid, 'update', 'webhook', e.id, { active: req.body.active });
    res.json(hookOut(db.get('SELECT * FROM webhook_endpoints WHERE id = ?', e.id)));
  });

  r.post('/integrations/webhooks/:id/rotate-secret', requirePerm('owner'), (req, res) => {
    const e = load(int(req.params.id, 'id'), req.user.bid);
    db.run('UPDATE webhook_endpoints SET secret = ? WHERE id = ?', 'whsec_' + crypto.randomBytes(24).toString('base64url'), e.id);
    db.audit(req.user.bid, req.user.uid, 'rotate_secret', 'webhook', e.id);
    res.json(hookOut(db.get('SELECT * FROM webhook_endpoints WHERE id = ?', e.id), true));
  });

  r.delete('/integrations/webhooks/:id', requirePerm('owner'), (req, res) => {
    const e = load(int(req.params.id, 'id'), req.user.bid);
    db.run('DELETE FROM webhook_deliveries WHERE endpoint_id = ?', e.id);
    db.run('DELETE FROM webhook_endpoints WHERE id = ?', e.id);
    db.audit(req.user.bid, req.user.uid, 'delete', 'webhook', e.id, { url: e.url });
    res.json({ deleted: true });
  });

  /** Send a "ping" event to this receiver right now and report what happened. */
  r.post('/integrations/webhooks/:id/test', requirePerm('owner'), safe(async (req, res) => {
    const e = load(int(req.params.id, 'id'), req.user.bid);
    // a ping goes only to this receiver, whatever events it listens to
    const eventId = 'evt_' + crypto.randomBytes(12).toString('hex');
    const ts = now();
    const payload = JSON.stringify({ id: eventId, type: 'ping', created_at: ts, branch_id: req.user.bid, data: { message: 'ທົດສອບຈາກ LAZA app' } });
    const { id } = db.run("INSERT INTO webhook_deliveries (endpoint_id, branch_id, event_id, type, payload, status, attempts, next_at, created_at) VALUES (?,?,?,?,?,'pending',0,?,?)", e.id, req.user.bid, eventId, 'ping', payload, ts, ts);
    const outcome = await deliverOne(db, id, { timeoutMs: 8000 });
    const d = db.get('SELECT id, status, attempts, last_status, last_error, response_ms FROM webhook_deliveries WHERE id = ?', id);
    // a failed test is not worth retrying later
    if (outcome !== 'ok') db.run("UPDATE webhook_deliveries SET status='dead', next_at=NULL WHERE id=?", id);
    res.json({ ok: outcome === 'ok', ...d, status: outcome === 'ok' ? 'ok' : 'dead' });
  }));

  // ---------- delivery log ----------
  r.get('/integrations/deliveries', requirePerm('owner'), (req, res) => {
    const where = ['d.branch_id = ?'];
    const params: any[] = [req.user.bid];
    if (req.query.endpointId) {
      where.push('d.endpoint_id = ?');
      params.push(int(req.query.endpointId, 'endpointId'));
    }
    if (req.query.status) {
      where.push('d.status = ?');
      params.push(oneOf(req.query.status, 'status', ['pending', 'ok', 'failed', 'dead'] as const));
    }
    res.json(
      db.all(
        `SELECT d.id, d.endpoint_id, e.url, d.event_id, d.type, d.status, d.attempts, d.next_at, d.last_status, d.last_error, d.response_ms, d.created_at, d.delivered_at
           FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id WHERE ${where.join(' AND ')} ORDER BY d.id DESC LIMIT 100`,
        ...params,
      ),
    );
  });

  /** Try a failed/dead delivery again now. */
  r.post('/integrations/deliveries/:id/retry', requirePerm('owner'), safe(async (req, res) => {
    const d = db.get('SELECT * FROM webhook_deliveries WHERE id = ? AND branch_id = ?', int(req.params.id, 'id'), req.user.bid);
    if (!d) throw notFound('ບໍ່ພົບລາຍການ');
    if (d.status === 'ok') throw bad('ສົ່ງສຳເລັດແລ້ວ');
    db.run("UPDATE webhook_deliveries SET status='failed', next_at=?, attempts=MIN(attempts, 5) WHERE id=?", now(), d.id);
    const outcome = await deliverOne(db, d.id, { timeoutMs: 8000 });
    res.json({ ok: outcome === 'ok', ...db.get('SELECT id, status, attempts, last_status, last_error FROM webhook_deliveries WHERE id = ?', d.id) });
  }));

  return r;
}
