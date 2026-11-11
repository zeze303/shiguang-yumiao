const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.WX_CONTENT_SECURITY = 'false';
const db = require('../services/database');
const usage = require('../services/aiUsage');
const companion = require('../services/companionAI');
const ai = require('../services/ai');
const security = require('../services/contentSecurity');

test('companion log HTTP retries are atomic, scoped and payload checked', async t => {
  const dir = await fs.mkdtemp(path.join(__dirname, '..', 'data-test-'));
  const file = path.join(dir, 'db.json');
  db.setLocalFileForTests(file);
  await fs.writeFile(file, JSON.stringify({
    app_volunteers: ['a', 'b'].map(id => ({ id, role: 'admin', status: 'active' })),
    app_sessions: ['a', 'b'].map((id, i) => ({ token: String(i + 1).repeat(64), volunteer_id: id, expires_at: '2099-01-01' })),
    growth_students: [{ id: 's' }]
  }));
  security.setChecker(async () => ({ allowed: true }));
  const server = require('../server').createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { security.resetChecker(); await new Promise(resolve => server.close(resolve)); await fs.rm(dir, { recursive: true, force: true }); });
  const body = { studentId: 's', type: '探访', content: '一起画画', images: [] };
  const call = async (key, changes = {}, token = '1') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/app/companion-logs`, {
      method: 'POST', headers: { Authorization: `Bearer ${token.repeat(64)}`, 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify({ ...body, ...changes })
    });
    return { status: response.status, body: await response.json() };
  };
  const [first, retry] = await Promise.all([call('save-one'), call('save-one')]);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.data, retry.body.data);
  const conflict = await call('save-one', { content: '改过的内容' });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.message, '操作键已被不同请求使用');
  assert.equal((await call('save-one', {}, '2')).status, 200);
  const noKey = await call();
  assert.notEqual(noKey.body.data.id, (await call()).body.data.id);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).app_companion_logs.length, 4);
});

test('AI failed retry retains reason, pending returns immediately, done is cached', async () => {
  const account = crypto.randomUUID(), key = crypto.randomUUID(), payload = { kind: 'suggest' };
  await assert.rejects(usage.run(account, key, payload, async () => { throw new Error('provider unavailable'); }), e => e.code === 'AI_FAILED');
  const filename = path.join(__dirname, '..', 'data', `ai-usage-test-${process.pid}.json`);
  const id = crypto.createHash('sha256').update(account + ':' + key).digest('hex');
  let ledger = JSON.parse(await fs.readFile(filename, 'utf8'));
  assert.equal(ledger.requests[id].state, 'failed');
  assert.match(ledger.requests[id].error.message, /生成服务/);
  let release, started;
  const held = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { started = resolve; });
  let calls = 0;
  const task = async () => { calls++; started(); await held; return { result: 'ok' }; };
  const retry = usage.run(account, key, payload, task);
  await ready;
  try {
    await assert.rejects(usage.run(account, key, payload, task), e => e.status === 202 && e.code === 'AI_PENDING');
    await assert.rejects(usage.run(account, key, { kind: 'poem' }, task), e => e.status === 409 && e.code === 'IDEMPOTENCY_CONFLICT');
  } finally { release(); }
  assert.deepEqual(await retry, { result: 'ok' });
  assert.deepEqual(await usage.run(account, key, payload, task), { result: 'ok' });
  assert.equal(calls, 1);
  ledger = JSON.parse(await fs.readFile(filename, 'utf8'));
  ledger.requests[id].state = 'pending';
  await fs.writeFile(filename, JSON.stringify(ledger));
  await assert.rejects(usage.run(account, key, payload, task), e => e.status === 202 && e.code === 'AI_PENDING');
});

test('poem filters before truncation and respects Shanghai month boundaries', async t => {
  const originals = [];
  const replace = (obj, key, value) => { originals.push([obj, key, obj[key]]); obj[key] = value; };
  t.after(() => { for (const [obj, key, value] of originals.reverse()) obj[key] = value; security.resetChecker(); });
  security.setChecker(async () => ({ allowed: true }));
  let records = [1, 2, 3].map(id => ({ id, period: '2026-11', commentOverall: 'OUTSIDE_RECORD' }));
  records.push({ id: 'oct', period: '2026年10月', commentOverall: 'OCTOBER_RECORD' });
  let logs = Array.from({ length: 12 }, (_, i) => ({ id: i, content: 'OUTSIDE_LOG', createdAt: `2026-11-${String(i + 1).padStart(2, '0')}T00:00:00Z` }));
  logs.push({ content: 'START_INCLUDED', createdAt: '2026-09-30T16:00:00Z' }, { content: 'END_INCLUDED', createdAt: '2026-10-31T15:59:59Z' }, { content: 'BEFORE_EXCLUDED', createdAt: '2026-09-30T15:59:59Z' });
  replace(db, 'listRecords', async () => records);
  replace(db, 'listCompanionLogs', async () => logs);
  const inputs = [];
  replace(ai, 'generatePoem', async context => {
    inputs.push(context);
    throw new Error('stop before storage');
  });
  await companion.generatePoem({ id: 's' }, { id: 'v' }, '2026-10');
  await companion.generatePoem({ id: 's' }, { id: 'v' }, '2026年10月');
  assert.equal(inputs.length, 2);
  for (const context of inputs) {
    const text = JSON.stringify(context);
    assert.match(text, /OCTOBER_RECORD/);
    assert.match(text, /START_INCLUDED/);
    assert.match(text, /END_INCLUDED/);
    assert.doesNotMatch(text, /OUTSIDE|BEFORE_EXCLUDED/);
  }
  records = []; logs = [{ content: 'wrong month', createdAt: '2026-11-01T00:00:00Z' }];
  await assert.rejects(companion.generatePoem({ id: 's' }, { id: 'v' }, '2026-10'), e => e.status === 422 && e.code === 'NO_MATERIAL');
  await assert.rejects(companion.generatePoem({ id: 's' }, { id: 'v' }, '2026-13'), e => e.status === 400 && e.code === 'INVALID_PERIOD');
});
