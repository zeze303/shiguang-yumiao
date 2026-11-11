const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.WX_CONTENT_SECURITY = 'false';
const db = require('../services/database');
const companion = require('../services/companionAI');

test('AI HTTP exposes pending, failure, conflict, cached result and domain errors', async t => {
  const originals = [];
  const replace = (obj, key, value) => { originals.push([obj, key, obj[key]]); obj[key] = value; };
  t.after(() => { for (const [obj, key, value] of originals.reverse()) obj[key] = value; });
  replace(db, 'findSession', async () => ({ volunteerId: 'a', expiresAt: '2099-01-01' }));
  replace(db, 'findVolunteerById', async () => ({ id: 'a', role: 'admin', status: 'active' }));
  replace(db, 'findStudent', async id => ({ id }));
  let attempts = 0, release, started;
  const held = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { started = resolve; });
  replace(companion, 'generateSuggest', async () => {
    if (++attempts === 1) throw new Error('provider error');
    started(); await held; return { result: 'completed' };
  });
  const server = require('../server').createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const key = require('node:crypto').randomUUID();
  const call = async (studentId = 's') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/app/ai/suggest`, {
      method: 'POST', headers: { Authorization: `Bearer ${'1'.repeat(64)}`, 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify({ studentId })
    });
    return { status: response.status, body: await response.json() };
  };
  const failure = await call();
  assert.equal(failure.status, 502);
  assert.equal(failure.body.code, 'AI_FAILED');
  const retry = call();
  await ready;
  try {
    const pending = await call();
    assert.equal(pending.status, 202);
    assert.equal(pending.body.code, 'AI_PENDING');
    assert.deepEqual(pending.body.data, { status: 'pending' });
    const conflict = await call('other');
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.message, '操作键已被不同请求使用');
  } finally { release(); }
  assert.equal((await retry).status, 200);
  assert.deepEqual((await call()).body.data, { result: 'completed' });
  assert.equal(attempts, 2);
});
