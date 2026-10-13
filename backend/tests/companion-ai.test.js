const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
const db = require('../services/database');
const ai = require('../services/ai');
const security = require('../services/contentSecurity');
const service = require('../services/companionAI');

test('suggestion workflow takes only latest three, redacts identifiers, preserves crisis guidance and blocks rejected output', async t => {
  const originals = new Map();
  const replace = (object, key, value) => { originals.set([object, key], object[key]); object[key] = value; };
  t.after(() => { for (const [[object, key], value] of originals) object[key] = value; security.resetChecker(); });
  replace(db, 'listRecords', async () => [{ psychology: 60, aesthetic: 60, finance: 60, behavior: 60 }]);
  replace(db, 'listCompanionLogs', async () => [{ content: '张小明说不想活，联系方式13812345678，住在幸福路12号', type: '探访' }]);
  const history = [1, 2, 3, 4].map(i => ({ createdAt: `2026-01-0${i}`, id: String(i), content: { status: `旧建议${i}`, openers: [], activities: [], cautions: [] } }));
  replace(db, 'listAiSuggestions', async filters => { assert.deepEqual(filters, { studentId: 's', kind: 'suggest' }); return history; });
  replace(ai, 'summarizeRecords', async context => {
    const content = JSON.stringify(context);
    assert.equal(content.includes('张小明'), false);
    assert.equal(content.includes('13812345678'), false);
    assert.equal(content.includes('幸福路12号'), false);
    return ['记录出现需要共同关注的表达。', '建议联系老师。'];
  });
  replace(ai, 'generateSuggest', async (context, previous) => {
    assert.deepEqual(previous.map(row => row.status), ['旧建议4', '旧建议3', '旧建议2']);
    return { status: '倾听孩子', openers: ['想聊聊吗', '我在这里'], activities: ['散步', '画画', '折纸'], cautions: ['不强迫', '尊重意愿'], disclaimer: ai.DISCLAIMER };
  });
  let stored = 0;
  replace(db, 'createAiSuggestion', async value => { stored++; assert.ok(value.content.cautions.includes(ai.CRISIS_GUIDANCE)); return value; });
  security.setChecker(async () => ({ allowed: true }));
  const student = { id: 's', name: '张小明', phone: '13812345678', address: '幸福路12号' };
  const result = await service.generateSuggest(student, { id: 'v', openid: 'o' });
  assert.ok(result.status.includes(ai.CRISIS_GUIDANCE));
  assert.equal(stored, 1);
  security.setChecker(async ({ content }) => ({ allowed: !content.includes('倾听孩子') }));
  const fallback = await service.generateSuggest(student, { id: 'v', openid: 'o' });
  assert.ok(fallback.status.startsWith(service.FALLBACK.status));
  assert.ok(fallback.cautions.includes(ai.CRISIS_GUIDANCE));
  assert.equal(stored, 1);
  security.setChecker(async () => ({ allowed: true }));
  replace(ai, 'generateSuggest', async () => ({ status: '联系138-1234-5678', openers: ['聊聊', '看看'], activities: ['画画', '散步', '折纸'], cautions: ['倾听', '不强迫'] }));
  const privateOutput = await service.generateSuggest(student, { id: 'v', openid: 'o' });
  assert.equal(privateOutput.status.includes('138'), false);
  assert.equal(stored, 1, 'private output must not persist');
});
