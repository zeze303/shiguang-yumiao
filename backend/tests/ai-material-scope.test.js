const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.DEEPSEEK_API_KEY = 'mock';
process.env.WX_CONTENT_SECURITY = 'false';
process.env.IMAGE_API_KEY = '';

test('AI materials respect own logs during shared pairing and handoff; late crisis survives truncation', async t => {
  const db = require('../services/database');
  const security = require('../services/contentSecurity');
  const images = require('../services/images');
  const ai = require('../services/ai');
  const { createApp } = require('../server');
  const dir = await fs.mkdtemp(path.join(__dirname, '..', 'data-test-'));
  const file = path.join(dir, 'db.json');
  db.setLocalFileForTests(file);
  const state = {
    app_volunteers: ['a', 'b', 'admin'].map(id => ({ id, openid: id, role: id === 'admin' ? 'admin' : 'volunteer', status: 'active' })),
    app_sessions: ['a', 'b', 'admin'].map((id, i) => ({ token: String(i + 1).repeat(64), volunteer_id: id, expires_at: '2099-01-01' })),
    growth_students: [{ id: 's', name: '某儿童' }],
    app_relations: ['a', 'b'].map(id => ({ id, volunteer_id: id, student_id: 's' })),
    app_companion_logs: [
      { id: 'la', volunteer_id: 'a', student_id: 's', content: 'A_PRIVATE_RECORD', type: '探访' },
      { id: 'lb', volunteer_id: 'b', student_id: 's', content: 'B_OWN_RECORD' + '记'.repeat(1500) + '不想活', type: '通话' }
    ]
  };
  await fs.writeFile(file, JSON.stringify(state));
  const originalFetch = global.fetch;
  let modelInputs = [];
  global.fetch = async (url, options) => {
    assert.equal(new URL(url).hostname, 'api.deepseek.com');
    const body = JSON.parse(options.body);
    modelInputs.push(body.messages[1].content);
    const system = body.messages[0].content;
    const output = system.includes('摘要') ? { summary: ['正在分享日常。', '记录了陪伴活动。'] } :
      system.includes('成长诗写作者') ? { title: '陪伴', content: '第一行\n第二行\n第三行\n第四行\n第五行\n第六行' } :
      { status: '耐心倾听', openers: ['想聊聊吗', '我在这里'], activities: ['画画', '折纸', '散步'], cautions: ['尊重意愿', '不强迫'] };
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(output) } }] }) };
  };
  security.setChecker(async () => ({ allowed: true }));
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => setImmediate(resolve));
    await images.waitForIdle();
    global.fetch = originalFetch;
    security.resetChecker();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const call = async (kind, token = '2') => {
    const response = await originalFetch(`http://127.0.0.1:${server.address().port}/api/app/ai/${kind}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token.repeat(64)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: 's', period: '本期' })
    });
    return { status: response.status, body: await response.json() };
  };
  const suggestion = await call('suggest');
  assert.equal(suggestion.status, 200);
  assert.ok(suggestion.body.data.status.includes(ai.CRISIS_GUIDANCE));
  assert.ok(suggestion.body.data.cautions.includes(ai.CRISIS_GUIDANCE));
  assert.equal(modelInputs.some(input => input.includes('不想活')), false, 'crisis text was truncated from model materials');
  assert.equal((await call('poem')).status, 200);
  assert.ok(modelInputs.some(input => input.includes('B_OWN_RECORD')));
  assert.equal(modelInputs.some(input => input.includes('A_PRIVATE_RECORD')), false);
  // Hand off A's pairing to B. A's records remain in storage, but are never B's materials.
  await new Promise(resolve => setImmediate(resolve));
  await images.waitForIdle();
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  saved.app_relations = saved.app_relations.filter(row => row.volunteer_id !== 'a');
  await fs.writeFile(file, JSON.stringify(saved));
  modelInputs = [];
  assert.equal((await call('suggest', '1')).status, 403);
  assert.equal(modelInputs.length, 0);
  assert.equal((await call('suggest')).status, 200);
  assert.equal((await call('poem')).status, 200);
  assert.equal(modelInputs.some(input => input.includes('A_PRIVATE_RECORD')), false);
  assert.ok(modelInputs.some(input => input.includes('B_OWN_RECORD')));
  modelInputs = [];
  assert.equal((await call('poem', '3')).status, 200);
  assert.ok(modelInputs.some(input => input.includes('A_PRIVATE_RECORD')));
  assert.ok(modelInputs.some(input => input.includes('B_OWN_RECORD')));
});
