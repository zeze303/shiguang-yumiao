const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
const scoring = require('../services/scoring');
const security = require('../services/contentSecurity');

test('invalid dimensions never become zero, levels or alerts', () => {
  for (const invalid of [undefined, null, '', ' ', true, NaN, Infinity, -1, 101]) {
    const record = { psychology: invalid, aesthetic: 80, finance: 80, behavior: 80 };
    assert.equal(scoring.extractDims(record), null);
    assert.equal(scoring.calcOverallFromRecord(record), null);
    assert.deepEqual(scoring.detectWarningsFromRecord(record), []);
  }
  assert.equal(scoring.getLevel(null), null);
  assert.equal(scoring.calcOverall(80, 80, undefined, 80), null);
  assert.deepEqual(scoring.extractDims({ psychology: 0, aesthetic: '80', finance: 80, behavior: 80 }), { psychology: 0, aesthetic: 80, finance: 80, behavior: 80 });
});

test('production cannot skip required content checks', async t => {
  const prior = Object.fromEntries(['NODE_ENV', 'WX_CONTENT_SECURITY', 'WX_APPID', 'WX_SECRET'].map(k => [k, process.env[k]]));
  t.after(() => { for (const [k, v] of Object.entries(prior)) v === undefined ? delete process.env[k] : process.env[k] = v; security.resetChecker(); });
  process.env.NODE_ENV = 'production';
  for (const flag of [undefined, 'false', 'typo', 'true']) {
    flag === undefined ? delete process.env.WX_CONTENT_SECURITY : process.env.WX_CONTENT_SECURITY = flag;
    delete process.env.WX_SECRET;
    await assert.rejects(security.checkText('记录', 'o'), error => error.status === 503);
  }
});

test('privacy filter covers separators and unnumbered rural addresses', () => {
  const { redact } = require('../services/companionAI');
  for (const value of ['联系138 1234 5678', '电话138-1234-5678', '住在幸福村一组', '地址幸福村', '张 小 明的电话010-12345678']) {
    const safe = redact(value, { name: '张小明' });
    assert.equal(/138|1234|幸福村|张\s*小\s*明/.test(safe), false, safe);
  }
});
