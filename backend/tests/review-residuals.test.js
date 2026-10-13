const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
const db = require('../services/database');
const ai = require('../services/ai');
const security = require('../services/contentSecurity');
const companion = require('../services/companionAI');

test('private intermediate candidate never enters a second model call', async t => {
  const originals = [];
  const replace = (obj, key, value) => { originals.push([obj, key, obj[key]]); obj[key] = value; };
  t.after(() => { for (const [obj, key, value] of originals.reverse()) obj[key] = value; security.resetChecker(); });
  replace(db, 'listRecords', async () => []);
  replace(db, 'listCompanionLogs', async () => [{ content: '分享画画' }]);
  replace(db, 'listAiSuggestions', async () => [{ content: { status: '旧建议' } }]);
  replace(ai, 'summarizeRecords', async () => ['分享画画', '记录作品']);
  replace(ai, 'tooSimilar', () => true);
  let calls = 0, writes = 0;
  replace(ai, 'generateSuggest', async () => { calls++; return { status: '联系138 1234 5678', openers: [], activities: [], cautions: [] }; });
  replace(db, 'createAiSuggestion', async () => { writes++; });
  security.setChecker(async () => ({ allowed: true }));
  const result = await companion.generateSuggest({ id: 's' }, { id: 'v' });
  assert.equal(calls, 1);
  assert.equal(writes, 0);
  assert.equal(JSON.stringify(result).includes('138'), false);
});

test('poem response whitelist hides private period and extra imported fields', async t => {
  const originals = [];
  const replace = (obj, key, value) => { originals.push([obj, key, obj[key]]); obj[key] = value; };
  t.after(() => { for (const [obj, key, value] of originals.reverse()) obj[key] = value; });
  replace(db, 'findSession', async () => ({ volunteerId: 'a', expiresAt: '2099-01-01' }));
  replace(db, 'findVolunteerById', async () => ({ id: 'a', role: 'admin', status: 'active' }));
  replace(db, 'findStudent', async () => ({ id: 's' }));
  replace(db, 'listGrowthPoems', async () => [{ id: 'p', studentId: 's', title: '安全标题', content: '安全正文', period: '138-1234-5678', internalNote: '私人备注', coverUrl: 'https://example.test/image.png' }]);
  const server = require('../server').createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const body = await (await fetch(`http://127.0.0.1:${server.address().port}/api/app/poems`, { headers: { Authorization: `Bearer ${'1'.repeat(64)}` } })).json();
  assert.equal(body.success, true);
  assert.equal(body.data[0].period, '已隐藏');
  assert.equal(body.data[0].internalNote, undefined);
  assert.equal(body.data[0].coverUrl, '/assets/default-poem-cover.svg');
  assert.equal(JSON.stringify(body).includes('138'), false);
});

test('cross-day idempotency survives counter reset and failed reservation releases slot', async t => {
  const usage = require('../services/aiUsage');
  const filename = path.join(__dirname, '..', 'data', `ai-usage-test-${process.pid}.json`);
  const previousLimit = process.env.AI_MAX_CONCURRENCY;
  process.env.AI_MAX_CONCURRENCY = '1';
  t.after(() => { previousLimit === undefined ? delete process.env.AI_MAX_CONCURRENCY : process.env.AI_MAX_CONCURRENCY = previousLimit; });
  const account = crypto.randomUUID(), key = crypto.randomUUID();
  let calls = 0;
  const task = async () => { calls++; return { title: '一次生成' }; };
  await usage.run(account, key, { kind: 'poem' }, task);
  const ledger = JSON.parse(await fs.readFile(filename, 'utf8'));
  ledger.day = '2000-01-01';
  await fs.writeFile(filename, JSON.stringify(ledger));
  await usage.run(account, key, { kind: 'poem' }, task);
  assert.equal(calls, 1);
  const originalRename = fs.rename;
  let fail = true;
  fs.rename = async (...args) => { if (fail && args[1] === filename) { fail = false; throw new Error('disk failure'); } return originalRename(...args); };
  try {
    await assert.rejects(usage.run(account, crypto.randomUUID(), {}, task), /disk failure/);
    await usage.run(account, crypto.randomUUID(), {}, task);
    assert.equal(calls, 2);
  } finally { fs.rename = originalRename; }
  const exhausted = JSON.parse(await fs.readFile(filename, 'utf8'));
  exhausted.requests = { retained: { hash: 'hash', state: 'done', expiresAt: Date.now() + 86400000, value: {} } };
  await fs.writeFile(filename, JSON.stringify(exhausted));
  process.env.AI_IDEMPOTENCY_MAX_RECORDS = '1';
  try { await assert.rejects(usage.run(account, crypto.randomUUID(), {}, task), e => e.status === 429); }
  finally { delete process.env.AI_IDEMPOTENCY_MAX_RECORDS; }
});
