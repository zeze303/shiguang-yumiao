const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.WX_CONTENT_SECURITY = 'false';
process.env.DEEPSEEK_API_KEY = 'mock-key';
process.env.IMAGE_API_KEY = 'mock-key';

test('stage2 permissions, suggestion deduplication, async cover fallback and admin endpoints', async t => {
  const db = require('../services/database');
  const { createApp } = require('../server');
  // Database was initialized in JSON mode; only image storage configuration is mocked below.
  process.env.SUPABASE_URL = 'https://mock-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-key';
  const dir = await fs.mkdtemp(path.join(__dirname, '..', 'data-test-'));
  const file = path.join(dir, 'db.json');
  db.setLocalFileForTests(file);
  await fs.writeFile(file, JSON.stringify({
    app_volunteers: [{ id: 'v', openid: 'openid-v', role: 'volunteer', status: 'active', name: '志愿者' }, { id: 'a', openid: 'secret-openid', role: 'admin', status: 'active' }],
    app_sessions: [{ token: '1'.repeat(64), volunteer_id: 'v', expires_at: '2099-01-01' }, { token: '2'.repeat(64), volunteer_id: 'a', expires_at: '2099-01-01' }],
    growth_students: [{ id: 's1', name: '张小明', age: 10 }, { id: 's2', name: '李小红' }],
    app_relations: [{ id: 'r', volunteer_id: 'v', student_id: 's1' }],
    growth_records: [{ id: 'gr', student_id: 's1', psychology: 30, aesthetic: 70, finance: 80, behavior: 80, created_at: '2026-01-01' }]
  }));
  const originalFetch = global.fetch;
  let suggestions = 0;
  let releaseImage;
  let imageStarted;
  const started = new Promise(resolve => { imageStarted = resolve; });
  const heldImage = new Promise(resolve => { releaseImage = resolve; });
  const first = { status: '从画画聊起', openers: ['我们画画好吗', '想用什么颜色'], activities: ['画一棵树', '画一朵花', '画一座桥'], cautions: ['尊重意愿', '耐心倾听'] };
  const fresh = { status: '试着一起做手工', openers: ['一起折纸吧', '你喜欢什么形状'], activities: ['折纸船', '折纸鹤', '剪纸窗花'], cautions: ['注意剪刀安全', '让孩子自己选择'] };
  global.fetch = async (url, options) => {
    const host = new URL(url).hostname;
    assert.ok(['api.deepseek.com', 'quanzil.com'].includes(host), `unexpected paid/provider host: ${host}`);
    if (host === 'quanzil.com') { imageStarted(); await heldImage; return { ok: false, status: 500 }; }
    const body = JSON.parse(options.body);
    const system = body.messages[0].content;
    let output;
    if (system.includes('摘要')) output = { summary: ['孩子记录了画画活动。', '愿意分享作品。'] };
    else if (system.includes('成长诗写作者')) output = { title: '纸上的桥', content: '纸上有座桥\n一笔接一笔\n颜色慢慢铺开\n作品摆在桌上\n我们静静看着\n把这一天记下' };
    else {
      suggestions++;
      output = suggestions <= 2 ? first : fresh;
      if (suggestions > 1) {
        assert.match(body.messages[1].content, /避免与以下雷同/);
        assert.ok(body.messages[1].content.includes(first.activities[0]));
      }
    }
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(output) } }] }) };
  };
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    releaseImage();
    await require('../services/images').waitForIdle();
    require('../services/contentSecurity').resetChecker();
    global.fetch = originalFetch;
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const call = async (route, role = 'v', method = 'GET', body) => {
    const response = await originalFetch(`http://127.0.0.1:${server.address().port}/api/app${route}`, {
      method, headers: { 'Idempotency-Key': require('node:crypto').randomUUID(), 'Content-Type': 'application/json', ...(role ? { Authorization: `Bearer ${(role === 'a' ? '2' : '1').repeat(64)}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await call('/companion-logs', 'v', 'POST', { studentId: 's2', type: '探访', content: '画画', images: [] })).status, 403);
  assert.equal((await call('/companion-logs', 'v', 'POST', { studentId: 's1', type: '非法', content: '画画', images: [] })).status, 400);
  assert.equal((await call('/companion-logs', 'v', 'POST', { studentId: 's1', type: '探访', content: '画画', images: ['javascript:alert(1)'] })).status, 400);
  assert.equal((await call('/companion-logs', 'v', 'POST', { studentId: 's1', type: '探访', content: '孩子画了一座桥', images: [] })).status, 200);
  assert.equal((await call('/companion-logs', 'a', 'POST', { studentId: 's2', type: '通话', content: '分享作品', images: [] })).status, 200);
  assert.equal((await call('/companion-logs')).body.data.length, 1);
  assert.equal((await call('/companion-logs?student_id=s2')).status, 403);
  assert.equal((await call('/companion-logs', 'a')).body.data.length, 2);
  assert.equal((await call('/ai/suggest', 'v', 'POST', { studentId: 's2' })).status, 403);
  const one = await call('/ai/suggest', 'v', 'POST', { studentId: 's1' });
  assert.equal(one.status, 200);
  assert.equal(one.body.data.disclaimer, '仅供参考，非专业诊断');
  const two = await call('/ai/suggest', 'v', 'POST', { studentId: 's1' });
  assert.equal(two.status, 200);
  assert.equal(suggestions, 3);
  assert.deepEqual(two.body.data.activities, fresh.activities);
  assert.equal((await db.listAiSuggestions({ kind: 'suggest' })).length, 2);
  const repeated = await call('/ai/suggest', 'v', 'POST', { studentId: 's1' });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.data.status, require('../services/companionAI').FALLBACK.status);
  assert.equal((await db.listAiSuggestions({ kind: 'suggest' })).length, 2);
  const poem = await call('/ai/poem', 'v', 'POST', { studentId: 's1', period: '2026年秋' });
  assert.equal(poem.status, 200);
  assert.equal(poem.body.data.title, '纸上的桥');
  assert.ok(poem.body.data.id);
  await started;
  assert.equal((await call('/poems')).body.data[0].coverUrl, '/assets/default-poem-cover.svg');
  releaseImage();
  await require('../services/images').waitForIdle();
  assert.equal((await call('/poems')).body.data[0].coverUrl, '/assets/default-poem-cover.svg');
  assert.equal((await call('/poems?student_id=s2')).status, 403);
  assert.equal((await call('/poems?student_id=s2', 'a')).body.data.length, 0);
  const contentSecurity = require('../services/contentSecurity');
  contentSecurity.setChecker(async () => ({ allowed: false }));
  assert.equal((await call('/companion-logs', 'v', 'POST', { studentId: 's1', type: '探访', content: '拒绝内容', images: [] })).status, 422);
  assert.equal((await call('/companion-logs')).body.data.length, 1);
  assert.equal((await call('/ai/suggest', 'v', 'POST', { studentId: 's1' })).status, 422);
  contentSecurity.setChecker(async ({ content }) => ({ allowed: !content.includes('纸上的桥') }));
  const rejectedPoem = await call('/ai/poem', 'v', 'POST', { studentId: 's1', period: '2026年秋' });
  assert.equal(rejectedPoem.status, 200);
  assert.equal(rejectedPoem.body.data.title, '静待成长');
  assert.equal((await db.listGrowthPoems()).length, 1);
  contentSecurity.resetChecker();
  const adminRoutes = ['/admin/overview', '/admin/students', '/admin/volunteers', '/admin/relations', '/admin/alerts'];
  for (const route of adminRoutes) {
    assert.equal((await call(route, null)).status, 401);
    assert.equal((await call(route)).status, 403);
    assert.equal((await call(route, 'a')).status, 200);
  }
  assert.equal((await call('/admin/overview', 'a')).body.data.studentCount, 2);
  assert.equal((await call('/admin/alerts', 'a')).body.data.length, 1);
  assert.equal(JSON.stringify((await call('/admin/volunteers', 'a')).body).includes('secret-openid'), false);
  assert.equal((await call('/admin/relations', 'v', 'POST', { volunteerId: 'v', studentId: 's2' })).status, 403);
  const pair = await call('/admin/relations', 'a', 'POST', { volunteerId: 'v', studentId: 's2' });
  assert.equal(pair.status, 200);
  assert.equal((await call('/admin/relations', 'a', 'POST', { volunteerId: 'v', studentId: 's2' })).status, 409);
  assert.equal((await call(`/admin/relations/${pair.body.data.id}`, 'v', 'DELETE')).status, 403);
  assert.equal((await call(`/admin/relations/${pair.body.data.id}`, 'a', 'DELETE')).status, 200);
  assert.equal((await call('/companion-logs?student_id=s2')).status, 403);
  const invalidState = JSON.parse(await fs.readFile(file, 'utf8'));
  invalidState.growth_records[0].psychology = null;
  await fs.writeFile(file, JSON.stringify(invalidState));
  const detail = await call('/students/s1');
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.overall, null);
  assert.equal(detail.body.data.level, null);
  assert.equal(detail.body.data.latestRecord.psychology, null);
  assert.deepEqual(detail.body.data.warnings, []);
  const invalidOverview = await call('/admin/overview', 'a');
  assert.equal(invalidOverview.body.data.averageScore, null);
  assert.equal(invalidOverview.body.data.unscoredCount, 2);
  assert.equal((await call('/admin/alerts', 'a')).body.data.length, 0);
});
