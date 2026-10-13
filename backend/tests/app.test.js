const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

// Tests always use isolated local storage; no real provider is called.
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.WX_APPID = 'test-app';
process.env.WX_SECRET = 'test-secret';
const root = path.join(__dirname, '..');

test('login, scope, session expiry, masking and score responses', async (t) => {
  const db = require('../services/database');
  const { createApp } = require('../server');
  const temporary = await fs.mkdtemp(path.join(root, 'data-test-'));
  db.setLocalFileForTests(path.join(temporary, 'db.json'));
  const originalFetch = global.fetch;
  let wxCalls = 0;
  global.fetch = async (url) => {
    assert.equal(new URL(url).hostname, 'api.weixin.qq.com');
    wxCalls++;
    return { ok: true, json: async () => ({ openid: 'wx-test', session_key: 'never-return' }) };
  };
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/app`;
  t.after(async () => {
    global.fetch = originalFetch;
    await new Promise(resolve => server.close(resolve));
    await fs.rm(temporary, { recursive: true, force: true });
  });
  const request = async (route, token, body) => {
    const response = await originalFetch(base + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await request('/students')).status, 401);
  assert.equal((await request('/login', null, { code: '' })).status, 400);
  assert.equal(wxCalls, 0);
  const login = await request('/login', null, { code: 'valid-code' });
  assert.equal(login.status, 200);
  assert.equal(login.body.data.role, 'guest');
  assert.match(login.body.data.token, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(login.body.data.profile).sort(), ['avatar', 'id', 'name']);
  const token = login.body.data.token;
  const volunteerId = login.body.data.profile.id;
  const state = JSON.parse(await fs.readFile(path.join(temporary, 'db.json'), 'utf8'));
  // The remaining regression checks exercise an existing certified volunteer account.
  state.app_volunteers[0].role = 'volunteer';
  state.growth_students = [
    { id: 'child-1', name: '张小明', phone: '13812345678', guardian_phone: '13912345678', guardian: '家长姓名', address: '河北省某市某县某镇一村1号', home_address: '幸福路12号', note: '私人备注', id_card: '110101201001011234' },
    { id: 'child-2', name: '另一儿童' }
  ];
  state.app_relations = [{ id: 'pair', volunteer_id: volunteerId, student_id: 'child-1' }];
  state.growth_records = [
    { id: 'r1', student_id: 'child-1', period: '2026-01', created_at: '2026-01-01T00:00:00Z', psychology: 90, aesthetic: 90, finance: 90, behavior: 90 },
    { id: 'r2', student_id: 'child-1', period: '2026-02', created_at: '2026-02-01T00:00:00Z', psychology: 30, aesthetic: 80, finance: 70, behavior: 60 }
  ];
  await fs.writeFile(path.join(temporary, 'db.json'), JSON.stringify(state));
  const list = await request('/students', token);
  assert.equal(list.body.data.length, 1);
  assert.equal(list.body.data[0].latestRecord.id, 'r2');
  assert.equal(list.body.data[0].overall, 60);
  assert.equal(list.body.data[0].level, '关注');
  assert.equal(list.body.data[0].hasWarning, true);
  const detail = await request('/students/child-1', token);
  assert.equal(detail.body.data.name, '张*明');
  assert.equal(detail.body.data.phone, '138****5678');
  assert.equal(detail.body.data.guardianPhone, '139****5678');
  assert.equal(detail.body.data.guardian, '已隐藏');
  assert.equal(detail.body.data.note, undefined);
  assert.equal(detail.body.data.homeAddress, '已隐藏');
  assert.equal((await request('/students/child-2', token)).status, 403);
  assert.equal((await request('/students/child-2/records', token)).status, 403);
  assert.equal((await request('/students/child-1/records', token)).body.data[0].id, 'r2');
  state.growth_students[0].address = '幸福村一组镇西路12号';
  state.growth_students[0].home_address = '镇西路12号';
  await fs.writeFile(path.join(temporary, 'db.json'), JSON.stringify(state));
  const hiddenAddress = await request('/students/child-1', token);
  assert.equal(hiddenAddress.body.data.address, '已隐藏');
  assert.equal(hiddenAddress.body.data.homeAddress, '已隐藏');
  state.growth_students[0].county = '某县';
  state.growth_students[0].township = '某镇';
  await fs.writeFile(path.join(temporary, 'db.json'), JSON.stringify(state));
  const coarseAddress = await request('/students/child-1', token);
  assert.equal(coarseAddress.body.data.address, '某县某镇');
  assert.equal(coarseAddress.body.data.homeAddress, '某县某镇');
  assert.equal(coarseAddress.body.data.county, undefined);
  assert.equal(coarseAddress.body.data.township, undefined);
  state.app_volunteers[0].role = 'admin';
  await fs.writeFile(path.join(temporary, 'db.json'), JSON.stringify(state));
  assert.equal((await request('/students', token)).body.data.length, 2);
  assert.equal((await request('/students/child-2', token)).status, 200);
  assert.equal((await request('/students/missing', token)).status, 404);
  state.app_volunteers[0].status = 'disabled';
  await fs.writeFile(path.join(temporary, 'db.json'), JSON.stringify(state));
  assert.equal((await request('/students', token)).status, 403);
  assert.equal((await request('/login', null, { code: 'disabled' })).status, 403);
  state.app_volunteers[0].status = 'active';
  state.app_sessions[0].expires_at = '2000-01-01T00:00:00Z';
  await fs.writeFile(path.join(temporary, 'db.json'), JSON.stringify(state));
  assert.equal((await request('/students', token)).status, 401);
  assert.equal((await request('/logout', null, {})).status, 401);
  const newLogin = await request('/login', null, { code: 'logout-code' });
  const newToken = newLogin.body.data.token;
  const otherSession = await db.createSession(volunteerId);
  assert.equal((await request('/logout', newToken, {})).status, 200);
  assert.equal(await db.findSession(newToken), null);
  assert.equal((await request('/students', newToken)).status, 401);
  assert.equal((await request('/logout', newToken, {})).status, 401);
  assert.equal((await request('/students', otherSession.token)).status, 200);
  global.fetch = async () => ({ ok: true, json: async () => ({ errcode: 40029, errmsg: 'invalid code' }) });
  assert.equal((await request('/login', null, { code: 'bad' })).status, 401);
});
