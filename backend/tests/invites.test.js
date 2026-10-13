const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.WX_APPID = 'mock';
process.env.WX_SECRET = 'mock';

test('guest restrictions, private-free overview and single-use role upgrades', async t => {
  const db = require('../services/database');
  const { createApp } = require('../server');
  const dir = await fs.mkdtemp(path.join(__dirname, '..', 'data-test-'));
  db.setLocalFileForTests(path.join(dir, 'db.json'));
  await fs.writeFile(path.join(dir, 'db.json'), JSON.stringify({
    app_volunteers: [{ id: 'a', openid: 'admin-private', role: 'admin', status: 'active' }, { id: 'v', openid: 'old-volunteer', role: 'volunteer', status: 'active' }],
    app_sessions: [{ token: 'a'.repeat(64), volunteer_id: 'a', expires_at: '2099-01-01' }, { token: 'b'.repeat(64), volunteer_id: 'v', expires_at: '2099-01-01' }],
    growth_students: [{ id: 'private-id', name: '私人孩子姓名', school: '私人学校名称', phone: '13812345678' }, { id: 's2', name: '第二孩子', school: '私人学校名称' }],
    growth_records: [{ id: 'r1', student_id: 'private-id', psychology: 20, aesthetic: 40, finance: 60, behavior: 80, created_at: '2026-01-01' }, { id: 'r2', student_id: 'private-id', psychology: 80, aesthetic: 80, finance: 80, behavior: 80, created_at: '2026-02-01' }]
  }));
  const realFetch = global.fetch;
  global.fetch = async url => {
    assert.equal(new URL(url).hostname, 'api.weixin.qq.com');
    return { ok: true, json: async () => ({ openid: new URL(url).searchParams.get('js_code') }) };
  };
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { global.fetch = realFetch; await new Promise(resolve => server.close(resolve)); await fs.rm(dir, { recursive: true, force: true }); });
  const call = async (route, token, body) => {
    const response = await realFetch(`http://127.0.0.1:${server.address().port}/api/app${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  const login = await call('/login', null, { code: 'guest-new' });
  assert.equal(login.status, 200);
  assert.equal(login.body.data.role, 'guest');
  const token = login.body.data.token;
  assert.equal((await call('/login', null, { code: 'old-volunteer' })).body.data.role, 'volunteer');
  const overview = await call('/public/overview', token);
  assert.equal(overview.status, 200);
  assert.equal((await call('/public/overview')).status, 200);
  assert.deepEqual(overview.body.data, { studentCount: 2, schoolCount: 1, recordCount: 2 });
  for (const secret of ['私人孩子姓名', '私人学校名称', '13812345678', 'private-id', 'openid']) assert.equal(JSON.stringify(overview.body).includes(secret), false);
  const routes = ['/students', '/students/private-id', '/students/private-id/records', '/companion-logs', '/poems', '/admin/overview', '/admin/invite-codes'];
  for (const route of routes) {
    const result = await call(route, token);
    assert.equal(result.status, 403, route);
    assert.match(result.body.message, /游客身份/);
  }
  for (const route of ['/companion-logs', '/ai/suggest', '/ai/poem']) assert.equal((await call(route, token, {})).status, 403);
  assert.equal((await call('/redeem', null, { code: 'NOPE' })).status, 401);
  assert.equal((await call('/redeem', token, { code: 'NOPE' })).status, 400);
  assert.equal((await call('/admin/invite-codes', token, { targetRole: 'admin' })).status, 403);
  assert.equal((await call('/admin/invite-codes', 'a'.repeat(64), { targetRole: 'guest' })).status, 400);
  assert.equal((await call('/admin/invite-codes', 'a'.repeat(64), { targetRole: 'volunteer', expiresInDays: -1 })).status, 400);
  const create = async targetRole => (await call('/admin/invite-codes', 'a'.repeat(64), { targetRole, expiresInDays: 7 })).body.data;
  const invite = await create('volunteer');
  assert.match(invite.code, /^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}$/);
  assert.equal(invite.status, 'active');
  const upgrade = await call('/redeem', token, { code: invite.code.toLowerCase() });
  assert.equal(upgrade.status, 200);
  assert.equal(upgrade.body.data.role, 'volunteer');
  assert.equal((await call('/students', token)).status, 200);
  assert.equal((await call('/redeem', token, { code: invite.code })).status, 400);
  const listed = (await call('/admin/invite-codes', 'a'.repeat(64))).body.data;
  assert.equal(listed[0].usedBy, login.body.data.profile.id);
  assert.equal(listed[0].status, 'used');
  assert.ok(listed[0].usedAt);
  assert.equal((await call(`/admin/invite-codes/${invite.id}/revoke`, 'a'.repeat(64), {})).status, 409);
  const revoked = await create('admin');
  assert.equal((await call(`/admin/invite-codes/${revoked.id}/revoke`, 'a'.repeat(64), {})).status, 200);
  assert.equal((await call('/redeem', token, { code: revoked.code })).status, 400);
  const expired = await create('admin');
  const state = JSON.parse(await fs.readFile(path.join(dir, 'db.json'), 'utf8'));
  state.app_invite_codes.find(row => row.id === expired.id).expires_at = '2000-01-01';
  await fs.writeFile(path.join(dir, 'db.json'), JSON.stringify(state));
  assert.equal((await call('/redeem', token, { code: expired.code })).status, 400);
  const adminInvite = await create('admin');
  assert.equal((await call('/redeem', token, { code: adminInvite.code })).body.data.role, 'admin');
  assert.equal((await call('/admin/invite-codes', token)).status, 200);
  const lower = await create('volunteer');
  assert.equal((await call('/redeem', token, { code: lower.code })).status, 409);
  assert.equal((await db.listInviteCodes()).find(row => row.id === lower.id).status, 'active');
  const guest2 = (await call('/login', null, { code: 'guest2' })).body.data;
  const guest3 = (await call('/login', null, { code: 'guest3' })).body.data;
  const race = await create('volunteer');
  const attempts = await Promise.all([call('/redeem', guest2.token, { code: race.code }), call('/redeem', guest3.token, { code: race.code })]);
  assert.deepEqual(attempts.map(result => result.status).sort(), [200, 400]);
  const roles = await Promise.all([db.findVolunteerById(guest2.profile.id), db.findVolunteerById(guest3.profile.id)]);
  assert.deepEqual(roles.map(row => row.role).sort(), ['guest', 'volunteer']);
});
