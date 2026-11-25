// AI analytics endpoints. Rule-based insights are free; the AI features need the owner's consent and a Claude API key.
import { Router } from 'express';
import type { Ctx } from '../app.ts';
import { requirePerm } from '../auth.ts';
import { now } from '../db.ts';
import { HttpError, bad, int, str } from '../lib/core.ts';
import { buildInsights, CLASS_LABEL, rangeOf } from '../lib/analytics.ts';
import { DEFAULT_DAILY_LIMIT, DEFAULT_MODEL, ask, getConfig, makeAnthropicClient, maskKey, summarize, usage, type AiClientFactory } from '../lib/ai.ts';

/** Express 4 ignores rejected promises from async handlers: forward them so the client always gets an answer. */
const safe = (fn: (req: any, res: any) => Promise<void>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

export function aiRoutes({ db }: Ctx, makeClient: AiClientFactory = makeAnthropicClient) {
  const r = Router();

  const status = (rid: number) => {
    const c = getConfig(db, rid);
    return { enabled: c.enabled, hasKey: !!c.apiKey, keySource: c.keySource, keyPreview: c.keySource === 'db' ? maskKey(c.apiKey) : null, model: c.model, dailyLimit: c.dailyLimit, defaultModel: DEFAULT_MODEL, usage: usage(db, rid), ready: c.enabled && !!c.apiKey };
  };

  r.get('/ai/status', requirePerm('admin'), (req, res) => res.json(status(req.user.rid)));

  /** Owner: consent switch, API key (stored on the server, never sent back), model and daily limit. */
  r.put('/ai/settings', requirePerm('owner'), (req, res) => {
    const cur = db.get('SELECT * FROM ai_settings WHERE restaurant_id = ?', req.user.rid);
    const enabled = req.body.enabled === undefined ? !!cur?.enabled : !!req.body.enabled;
    let apiKey: string = cur?.api_key ?? '';
    if (req.body.apiKey !== undefined) {
      const k = str(req.body.apiKey, 'API key', { max: 300 });
      if (k && !/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k)) throw bad('API key ຕ້ອງຂຶ້ນຕົ້ນດ້ວຍ sk-ant- (ເອົາຈາກ console.anthropic.com)');
      apiKey = k;
    }
    let model: string = cur?.model ?? DEFAULT_MODEL;
    if (req.body.model !== undefined) {
      model = str(req.body.model, 'ໂມເດລ', { max: 60 }) || DEFAULT_MODEL;
      if (!/^claude-[a-z0-9.-]+$/.test(model)) throw bad('ຊື່ໂມເດລບໍ່ຖືກຕ້ອງ (ເຊັ່ນ claude-opus-5-5)');
    }
    const dailyLimit = req.body.dailyLimit === undefined ? (cur?.daily_limit ?? DEFAULT_DAILY_LIMIT) : int(req.body.dailyLimit, 'ຂີດຈຳກັດຕໍ່ມື້', { min: 1, max: 500 });
    if (enabled && !apiKey && !getConfig(db, req.user.rid).apiKey) throw bad('ກະລຸນາໃສ່ API key ກ່ອນເປີດໃຊ້ AI');
    db.run(
      `INSERT INTO ai_settings (restaurant_id, enabled, api_key, model, daily_limit, updated_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(restaurant_id) DO UPDATE SET enabled=excluded.enabled, api_key=excluded.api_key, model=excluded.model, daily_limit=excluded.daily_limit, updated_at=excluded.updated_at`,
      req.user.rid, enabled ? 1 : 0, apiKey, model, dailyLimit, now(),
    );
    db.audit(req.user.bid, req.user.uid, 'ai_settings', 'restaurant', req.user.rid, { enabled, model, dailyLimit, keyChanged: req.body.apiKey !== undefined });
    res.json(status(req.user.rid));
  });

  /** Free, no AI: charts' data and rule-based findings for the period. */
  r.get('/ai/insights', requirePerm('admin'), (req, res) => {
    const range = rangeOf(db, req.user.bid, req.query.from, req.query.to, 30);
    const { insights, data } = buildInsights(db, req.user.bid, range);
    res.json({ insights, ...data, classLabels: CLASS_LABEL });
  });

  const ctx = (req: any) => {
    const cfg = getConfig(db, req.user.rid);
    if (!cfg.enabled) throw new HttpError(403, 'ຍັງບໍ່ໄດ້ເປີດໃຊ້ AI — ເຈົ້າຂອງຮ້ານຕ້ອງເປີດໃນການຕັ້ງຄ່າ AI ກ່ອນ');
    if (!cfg.apiKey) throw new HttpError(409, 'ຍັງບໍ່ໄດ້ໃສ່ API key ຂອງ Claude');
    return { db, rid: req.user.rid, bid: req.user.bid, uid: req.user.uid, cfg, client: makeClient(cfg.apiKey) };
  };

  r.post('/ai/summary', requirePerm('admin'), safe(async (req, res) => {
    const c = ctx(req);
    const range = rangeOf(db, req.user.bid, req.body.from, req.body.to, 30);
    const out = await summarize(c, range);
    db.audit(req.user.bid, req.user.uid, 'ai_summary', 'branch', req.user.bid, { from: range.from, to: range.to });
    res.json({ ...out, model: c.cfg.model, range: { from: range.from, to: range.to }, usage: usage(db, req.user.rid) });
  }));

  r.post('/ai/ask', requirePerm('admin'), safe(async (req, res) => {
    const c = ctx(req);
    const question = str(req.body.question, 'ຄຳຖາມ', { required: true, max: 500 });
    const range = rangeOf(db, req.user.bid, req.body.from, req.body.to, 30);
    const out = await ask(c, question, range);
    db.audit(req.user.bid, req.user.uid, 'ai_ask', 'branch', req.user.bid, { question: question.slice(0, 120), tools: out.toolCalls.length });
    res.json({ ...out, model: c.cfg.model, usage: usage(db, req.user.rid) });
  }));

  return r;
}
