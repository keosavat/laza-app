import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import Anthropic from '@anthropic-ai/sdk';
import { createApp } from '../src/app.ts';
import { seedIfEmpty, DEMO_USERS } from '../src/seed.ts';

const PW = DEMO_USERS[0].password;
let base = '';
let close: () => void;
let db: ReturnType<typeof createApp>['db'];

// ---- a fake Claude client: records every request (deep-copied, because the caller keeps appending to messages) ----
type Reply = any | ((params: any) => any);
const calls: any[] = [];
const keysSeen: string[] = [];
let script: Reply[] = [];
const text = (t: string, extra: any = {}) => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 50 }, ...extra });
const fake = {
  beta: {
    messages: {
      create: async (params: any) => {
        calls.push(JSON.parse(JSON.stringify(params)));
        const next = script.shift();
        if (!next) throw new Error('no scripted reply');
        const r = typeof next === 'function' ? next(params) : next;
        if (r instanceof Error) throw r;
        return r;
      },
    },
  },
};

async function call(method: string, url: string, body?: unknown, token?: string) {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await res.text();
  return { status: res.status, body: t ? JSON.parse(t) : null };
}
const login = async (u: string) => (await call('POST', '/api/auth/login', { username: u, password: PW })).body.token as string;

before(async () => {
  const app = createApp({ dbFile: ':memory:', jwtSecret: 'test-secret', aiClientFactory: (key) => (keysSeen.push(key), fake) });
  db = app.db;
  seedIfEmpty(app.db, { withMenu: false });
  await new Promise<void>((ok) => app.server.listen(0, ok));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  close = () => app.server.close();
});
after(() => close());

describe('analytics (no AI)', () => {
  let owner = '';
  let cashier = '';
  const ids: Record<string, number> = {};
  const KEY = 'sk-ant-test_abcdefghijklmnopqrstuvwxyz0123456789';

  const sell = async (name: string, qty: number, extra: any = {}) => {
    const o = (await call('POST', '/api/orders', { type: 'takeaway' }, owner)).body.id;
    await call('POST', `/api/orders/${o}/items`, { items: [{ menuItemId: ids[name], qty }], print: false }, owner);
    const total = (await call('GET', `/api/orders/${o}`, undefined, owner)).body.total;
    const r = await call('POST', `/api/orders/${o}/pay`, { payments: [{ method: 'cash', currency: 'LAK', amount: total }], ...extra }, owner);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return total as number;
  };

  test('setup: menu with known costs and a few sales', async () => {
    owner = await login('admin');
    cashier = await login('cashier');
    for (const [name, price, cost] of [['A ຂາຍດີ ກຳໄລດີ', 50000, 10000], ['B ຂາຍດີ ກຳໄລຕ່ຳ', 30000, 25000], ['C ຂາຍນ້ອຍ ກຳໄລດີ', 80000, 20000], ['D ຂາຍນ້ອຍ ກຳໄລຕ່ຳ', 10000, 9000], ['E ບໍ່ຂາຍ', 20000, 5000]] as const) {
      ids[name] = (await call('POST', '/api/menu-items', { name, price, cost }, owner)).body.id;
    }
    await call('POST', '/api/shifts/open', { openingCash: 0 }, owner);
    const cust = (await call('POST', '/api/customers', { name: 'ນາງ ລັບສະເພາະ', phone: '020777000999' }, owner)).body.id;
    await sell('A ຂາຍດີ ກຳໄລດີ', 6, { customerId: cust });
    await sell('A ຂາຍດີ ກຳໄລດີ', 4);
    await sell('B ຂາຍດີ ກຳໄລຕ່ຳ', 10);
    await sell('C ຂາຍນ້ອຍ ກຳໄລດີ', 1);
    await sell('D ຂາຍນ້ອຍ ກຳໄລຕ່ຳ', 1);
  });

  test('insights: only managers; menu engineering classes; unsold items; numbers add up', async () => {
    assert.equal((await call('GET', '/api/ai/insights', undefined, cashier)).status, 403);
    const r = await call('GET', '/api/ai/insights', undefined, owner);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const d = r.body;
    assert.equal(d.summary.bills, 5);
    assert.equal(d.summary.sales, 10 * 50000 + 10 * 30000 + 80000 + 10000);
    assert.equal(d.summary.cost, 10 * 10000 + 10 * 25000 + 20000 + 9000);
    assert.equal(d.summary.grossProfit, d.summary.sales - d.summary.cost);
    const cls = Object.fromEntries(d.items.map((i: any) => [i.name[0], i.class]));
    assert.deepEqual(cls, { A: 'star', B: 'plowhorse', C: 'puzzle', D: 'dog' });
    assert.deepEqual(d.unsold.map((i: any) => i.name[0]), ['E']);
    assert.equal(d.items.find((i: any) => i.name[0] === 'A').qty, 10, 'two orders of the same dish are added together');
    assert.equal(d.byHour.reduce((s: number, h: any) => s + h.sales, 0), d.summary.sales);
    assert.equal(d.byWeekday.reduce((s: number, w: any) => s + w.sales, 0), d.summary.sales);
    assert.equal(d.byDay.length, 30);
    assert.equal(d.byDay[29].sales, d.summary.sales, 'all of it was sold today');
    const text = d.insights.map((i: any) => i.text).join('\n');
    assert.match(text, /A ຂາຍດີ ກຳໄລດີ/);
    assert.match(text, /B ຂາຍດີ ກຳໄລຕ່ຳ/);
    assert.match(text, /E ບໍ່ຂາຍ/);
    assert.ok(d.insights.some((i: any) => i.level === 'warn'));
    const cats = d.categories.reduce((s: number, c: any) => s + c.sharePct, 0);
    assert.ok(Math.abs(cats - 100) < 0.5);
  });

  test('periods: validation, previous period, empty range', async () => {
    assert.equal((await call('GET', '/api/ai/insights?from=nope', undefined, owner)).status, 400);
    assert.equal((await call('GET', '/api/ai/insights?from=2026-02-02&to=2026-02-01', undefined, owner)).status, 400);
    assert.equal((await call('GET', '/api/ai/insights?from=2020-01-01&to=2026-01-01', undefined, owner)).status, 400);
    const empty = (await call('GET', '/api/ai/insights?from=2020-01-01&to=2020-01-07', undefined, owner)).body;
    assert.equal(empty.summary.bills, 0);
    assert.equal(empty.items.length, 0);
    assert.match(empty.insights[0].text, /ຍັງບໍ່ມີການຂາຍ/);
    const wk = (await call('GET', '/api/ai/insights?from=2020-01-01&to=2020-01-07', undefined, owner)).body;
    assert.equal(wk.previous.from, '2019-12-25');
    assert.equal(wk.previous.to, '2019-12-31');
  });

  test('AI is off until the owner opts in; settings are owner-only and validated; the key is never returned', async () => {
    const off = await call('POST', '/api/ai/summary', {}, owner);
    assert.equal(off.status, 403);
    assert.equal(calls.length, 0, 'nothing is sent to the API while disabled');
    const st = (await call('GET', '/api/ai/status', undefined, owner)).body;
    assert.deepEqual({ enabled: st.enabled, hasKey: st.hasKey, ready: st.ready }, { enabled: false, hasKey: false, ready: false });
    assert.equal(st.model, 'claude-opus-5-5');
    assert.equal((await call('PUT', '/api/ai/settings', { enabled: true, apiKey: KEY }, await login('manager'))).status, 403);
    assert.equal((await call('PUT', '/api/ai/settings', { enabled: true }, owner)).status, 400, 'no key yet');
    assert.equal((await call('PUT', '/api/ai/settings', { apiKey: 'not-a-key' }, owner)).status, 400);
    assert.equal((await call('PUT', '/api/ai/settings', { model: 'gpt-4' }, owner)).status, 400);
    assert.equal((await call('PUT', '/api/ai/settings', { dailyLimit: 0 }, owner)).status, 400);
    const on = await call('PUT', '/api/ai/settings', { enabled: true, apiKey: KEY }, owner);
    assert.equal(on.status, 200, JSON.stringify(on.body));
    assert.equal(on.body.ready, true);
    assert.equal(on.body.keySource, 'db');
    assert.ok(!JSON.stringify(on.body).includes(KEY), 'the full key is not in the response');
    assert.match(on.body.keyPreview, /^sk-ant-…6789$/);
    assert.ok(!JSON.stringify((await call('GET', '/api/ai/status', undefined, owner)).body).includes(KEY));
    // a manager can use AI but not see/change the key
    assert.equal((await call('GET', '/api/ai/status', undefined, await login('manager'))).body.ready, true);
    // the audit log records that settings changed, not the key
    const audit = JSON.stringify(db.all("SELECT data_json FROM audit_log WHERE action = 'ai_settings'"));
    assert.ok(!audit.includes(KEY));
  });

  test('summary: sends only aggregated data (no customers or staff), uses the right request shape, records tokens', async () => {
    calls.length = 0;
    script = [text('## ສະຫຼຸບ\nຍອດດີ **₭890,000**')];
    const r = await call('POST', '/api/ai/summary', {}, owner);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body.text, /ສະຫຼຸບ/);
    assert.equal(r.body.refused, false);
    assert.equal(r.body.usage.today, 1);
    assert.equal(r.body.usage.monthInputTokens, 100);
    assert.equal(r.body.usage.monthOutputTokens, 50);
    assert.deepEqual(keysSeen.at(-1), 'sk-ant-test_abcdefghijklmnopqrstuvwxyz0123456789', 'the saved key is used');

    const req = calls[0];
    assert.equal(req.model, 'claude-opus-5-5');
    assert.ok(req.max_tokens >= 1000);
    assert.equal(req.temperature, undefined, 'sampling parameters are not sent (rejected by current models)');
    assert.equal(req.thinking, undefined, 'thinking is left to the model default');
    assert.deepEqual(req.betas, ['server-side-fallback-2026-07-01']);
    assert.equal(req.fallbacks, 'default');
    assert.match(req.system, /Lao/);
    const prompt = req.messages[0].content as string;
    assert.match(prompt, /<data>/);
    assert.ok(prompt.includes('A ຂາຍດີ ກຳໄລດີ'), 'dish names are part of the data');
    for (const secret of ['ນາງ ລັບສະເພາະ', '020777000999', 'ເຈົ້າຂອງຮ້ານ', 'ແຄັດເຊຍ', 'admin', 'cashier']) assert.ok(!prompt.includes(secret), `"${secret}" must not be sent`);
    const pack = JSON.parse(prompt.slice(prompt.indexOf('<data>') + 7, prompt.indexOf('</data>')));
    assert.equal(pack.summary.bills, 5);
    assert.ok(pack.topItems.length >= 4);
  });

  test('summary: an empty period is refused without calling the API or using up the allowance', async () => {
    calls.length = 0;
    const before = (await call('GET', '/api/ai/status', undefined, owner)).body.usage.today;
    const r = await call('POST', '/api/ai/summary', { from: '2020-01-01', to: '2020-01-31' }, owner);
    assert.equal(r.status, 400);
    assert.equal(calls.length, 0);
    assert.equal((await call('GET', '/api/ai/status', undefined, owner)).body.usage.today, before);
  });

  test('ask: a tool loop — tools run on the server, parallel results go back in one message, bad input becomes an error result', async () => {
    calls.length = 0;
    const today = new Date().toISOString().slice(0, 10);
    script = [
      { content: [{ type: 'text', text: 'ຂໍກວດຂໍ້ມູນ' }, { type: 'tool_use', id: 'tu_1', name: 'get_item_performance', input: { from: today, to: today, sort_by: 'qty', order: 'desc', limit: 2 } }], stop_reason: 'tool_use', usage: { input_tokens: 200, output_tokens: 30 } },
      { content: [
          { type: 'tool_use', id: 'tu_2', name: 'get_unsold_items', input: { from: today, to: today } },
          { type: 'tool_use', id: 'tu_3', name: 'get_sales_summary', input: { from: 'not-a-date', to: today } },
          { type: 'tool_use', id: 'tu_4', name: 'get_stock_alerts', input: {} },
        ], stop_reason: 'tool_use', usage: { input_tokens: 300, output_tokens: 40 } },
      text('ເມນູທີ່ຂາຍດີສຸດແມ່ນ A ແລະ B', { usage: { input_tokens: 400, output_tokens: 60 } }),
    ];
    const r = await call('POST', '/api/ai/ask', { question: 'ເມນູໃດຂາຍດີສຸດ?' }, owner);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body.text, /A ແລະ B/);
    assert.deepEqual(r.body.toolCalls, ['get_item_performance', 'get_unsold_items', 'get_sales_summary', 'get_stock_alerts']);
    assert.equal(calls.length, 3);

    // tool definitions: read-only, strict, closed schemas
    const tools = calls[0].tools as any[];
    assert.ok(tools.length >= 7);
    assert.ok(tools.every((t) => t.strict === true && t.input_schema.additionalProperties === false));
    assert.ok(tools.every((t) => /^get_/.test(t.name)), 'only read tools exist');
    assert.ok(calls[0].tool_choice === undefined, 'forced tool use is rejected by this model');
    assert.match(calls[0].messages[0].content, /ເມນູໃດຂາຍດີສຸດ/);

    // call 2: the whole assistant turn was kept, then ONE user message with the result
    const m2 = calls[1].messages;
    assert.equal(m2.length, 3);
    assert.equal(m2[1].role, 'assistant');
    assert.deepEqual(m2[1].content.map((b: any) => b.type), ['text', 'tool_use']);
    assert.equal(m2[2].role, 'user');
    assert.equal(m2[2].content[0].type, 'tool_result');
    assert.equal(m2[2].content[0].tool_use_id, 'tu_1');
    const top = JSON.parse(m2[2].content[0].content);
    assert.equal(top.length, 2);
    assert.deepEqual(top.map((i: any) => i.name[0]).sort(), ['A', 'B'], 'the two best sellers by quantity');
    assert.ok(top[0].qty >= top[1].qty, 'sorted by quantity, highest first');

    // call 3: three results in a single message; the bad date is an error result, the others are fine
    const m3 = calls[2].messages;
    const results = m3[m3.length - 1].content;
    assert.deepEqual(results.map((x: any) => x.tool_use_id), ['tu_2', 'tu_3', 'tu_4']);
    assert.equal(results[0].is_error, undefined);
    assert.equal(results[1].is_error, true);
    assert.match(results[1].content, /ວັນທີ/);
    assert.deepEqual(JSON.parse(results[0].content).map((i: any) => i.name[0]), ['E']);

    assert.equal(r.body.usage.monthInputTokens, 100 + 200 + 300 + 400, 'tokens of every round are counted');
  });

  test('ask: item sorting and a runaway tool loop is cut off', async () => {
    calls.length = 0;
    const today = new Date().toISOString().slice(0, 10);
    const loop = () => ({ content: [{ type: 'tool_use', id: `tu_${Math.random()}`, name: 'get_stock_alerts', input: {} }], stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 } });
    script = [loop, loop, loop, loop, loop, loop, loop, loop];
    const r = await call('POST', '/api/ai/ask', { question: 'x'.repeat(10), from: today, to: today }, owner);
    assert.equal(r.status, 200);
    assert.equal(calls.length, 6, 'at most 6 rounds');
    assert.equal(r.body.truncated, true);
    assert.equal((await call('POST', '/api/ai/ask', { question: '' }, owner)).status, 400);
    assert.equal((await call('POST', '/api/ai/ask', { question: 'x'.repeat(501) }, owner)).status, 400);
  });

  test('errors from the API become clear messages (and never leak the key); refusals are reported', async () => {
    const mk = (status: number, type: string) => Anthropic.APIError.generate(status, { type: 'error', error: { type, message: `secret ${KEY}` } }, `secret ${KEY}`, new Headers());
    for (const [status, type, code, re] of [[401, 'authentication_error', 400, /API key/], [429, 'rate_limit_error', 429, /ຈຳກັດ/], [404, 'not_found_error', 400, /ໂມເດລ/], [500, 'api_error', 502, /Claude API/]] as const) {
      script = [mk(status, type)];
      const r = await call('POST', '/api/ai/summary', {}, owner);
      assert.equal(r.status, code, `${status} -> ${code}: ${JSON.stringify(r.body)}`);
      assert.match(r.body.error, re);
      assert.ok(!JSON.stringify(r.body).includes(KEY));
    }
    script = [{ content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: null }, usage: { input_tokens: 5, output_tokens: 0 } }];
    const ref = await call('POST', '/api/ai/summary', {}, owner);
    assert.equal(ref.body.refused, true);
    assert.match(ref.body.text, /ປະຕິເສດ/);
    script = [text('ຕັດທອນ', { stop_reason: 'max_tokens' })];
    assert.equal((await call('POST', '/api/ai/summary', {}, owner)).body.truncated, true);
  });

  test('the daily allowance is enforced and an env key takes over', async () => {
    const used = (await call('GET', '/api/ai/status', undefined, owner)).body.usage.today;
    await call('PUT', '/api/ai/settings', { dailyLimit: used + 1 }, owner);
    script = [text('ok'), text('ok')];
    assert.equal((await call('POST', '/api/ai/summary', {}, owner)).status, 200);
    calls.length = 0;
    const over = await call('POST', '/api/ai/summary', {}, owner);
    assert.equal(over.status, 429);
    assert.match(over.body.error, /ຕໍ່ມື້/);
    assert.equal(calls.length, 0, 'no API call once the allowance is used');

    process.env.LAZA_ANTHROPIC_API_KEY = 'sk-ant-from-env-0123456789abcdefghij';
    try {
      const st = (await call('GET', '/api/ai/status', undefined, owner)).body;
      assert.equal(st.keySource, 'env');
      assert.equal(st.keyPreview, null);
      await call('PUT', '/api/ai/settings', { dailyLimit: 50 }, owner);
      script = [text('ok')];
      await call('POST', '/api/ai/summary', {}, owner);
      assert.equal(keysSeen.at(-1), 'sk-ant-from-env-0123456789abcdefghij');
    } finally {
      delete process.env.LAZA_ANTHROPIC_API_KEY;
    }
    // switching it off again stops everything
    await call('PUT', '/api/ai/settings', { enabled: false }, owner);
    assert.equal((await call('POST', '/api/ai/ask', { question: 'hi' }, owner)).status, 403);
  });
});
