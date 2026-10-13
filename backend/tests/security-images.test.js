const { test } = require('node:test');
const assert = require('node:assert/strict');
const security = require('../services/contentSecurity');
const images = require('../services/images');

test('content security skips without configuration and enabled checks fail closed', async t => {
  const originalFetch = global.fetch;
  const keys = ['WX_CONTENT_SECURITY', 'WX_APPID', 'WX_SECRET'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => {
    global.fetch = originalFetch;
    for (const key of keys) previous[key] === undefined ? delete process.env[key] : process.env[key] = previous[key];
    security.resetChecker();
  });
  process.env.WX_CONTENT_SECURITY = 'true';
  delete process.env.WX_SECRET;
  global.fetch = async () => { throw new Error('No network should be attempted'); };
  assert.deepEqual(await security.checkText('记录', 'user'), { allowed: true, skipped: true });
  process.env.WX_APPID = 'mock';
  process.env.WX_SECRET = 'mock';
  let tokenCalls = 0;
  let mode = 'pass';
  global.fetch = async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.hostname, 'api.weixin.qq.com');
    if (parsed.pathname === '/cgi-bin/token') {
      tokenCalls++;
      return { ok: true, json: async () => ({ access_token: 'mock-token', expires_in: 7200 }) };
    }
    assert.equal(JSON.parse(options.body).openid, 'user');
    if (mode === 'network') throw new Error('offline');
    return { ok: true, json: async () => mode === 'reject' ? { errcode: 87014 } : { errcode: 0, result: { suggest: mode } } };
  };
  assert.equal((await security.checkText('正常记录', 'user')).allowed, true);
  mode = 'review';
  assert.equal((await security.checkText('待复核', 'user')).allowed, false);
  mode = 'reject';
  assert.equal((await security.checkText('不通过', 'user')).allowed, false);
  assert.equal(tokenCalls, 1);
  mode = 'network';
  await assert.rejects(security.checkText('记录', 'user'), error => error.status === 503);
  security.setChecker(async () => ({ allowed: false }));
  assert.equal((await security.checkText('记录', 'user')).allowed, false);
});

test('completed cover deduplication is bounded and expires without evicting active work', async t => {
  const originalKey = process.env.IMAGE_API_KEY;
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  process.env.IMAGE_API_KEY = '';
  t.after(async () => {
    await images.waitForIdle();
    Date.now = originalNow;
    originalKey === undefined ? delete process.env.IMAGE_API_KEY : process.env.IMAGE_API_KEY = originalKey;
  });
  let updates = 0;
  const update = async () => { updates++; };
  images.enqueueCover('bounded-first', '诗', update);
  await images.waitForIdle();
  for (let i = 0; i < 1024; i++) {
    images.enqueueCover(`bounded-${i}`, '诗', update);
    await images.waitForIdle();
  }
  const before = updates;
  images.enqueueCover('bounded-1023', '诗', update);
  await images.waitForIdle();
  assert.equal(updates, before, 'recent completion stays deduplicated');
  images.enqueueCover('bounded-first', '诗', update);
  await images.waitForIdle();
  assert.equal(updates, before + 1, 'oldest completed entry is evicted at capacity');
  now += 24 * 60 * 60 * 1000 + 1;
  images.enqueueCover('bounded-1023', '诗', update);
  await images.waitForIdle();
  assert.equal(updates, before + 2, 'completed entry expires after TTL');
  let activeUpdates = 0;
  let releaseActive;
  const heldUpdate = new Promise(resolve => { releaseActive = resolve; });
  const activeUpdate = async () => { activeUpdates++; await heldUpdate; };
  images.enqueueCover('bounded-active', '诗', activeUpdate);
  now += 24 * 60 * 60 * 1000 + 1;
  images.enqueueCover('bounded-active', '诗', activeUpdate);
  releaseActive();
  await images.waitForIdle();
  assert.equal(activeUpdates, 1, 'TTL cannot evict an active job');
});

test('cover success updates once, duplicate enqueue reuses in-flight/completed work', async t => {
  const originalFetch = global.fetch;
  const originalKey = process.env.IMAGE_API_KEY;
  const originalBase = process.env.IMAGE_API_BASE;
  const originalUrl = process.env.SUPABASE_URL;
  const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://mock-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-key';
  t.after(async () => {
    await images.waitForIdle();
    global.fetch = originalFetch;
    originalUrl === undefined ? delete process.env.SUPABASE_URL : process.env.SUPABASE_URL = originalUrl;
    originalServiceKey === undefined ? delete process.env.SUPABASE_SERVICE_ROLE_KEY : process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
    originalKey === undefined ? delete process.env.IMAGE_API_KEY : process.env.IMAGE_API_KEY = originalKey;
    originalBase === undefined ? delete process.env.IMAGE_API_BASE : process.env.IMAGE_API_BASE = originalBase;
  });
  process.env.IMAGE_API_KEY = 'mock-key';
  process.env.IMAGE_API_BASE = 'https://quanzil.com/v1';
  let calls = 0;
  let updates = 0;
  global.fetch = async (url, options) => {
    if (new URL(url).hostname === 'mock-project.supabase.co') {
      if (new URL(url).pathname.includes('/bucket/')) return Response.json({ public: true });
      return Response.json({ Key: 'uploaded' });
    }
    assert.equal(url, 'https://quanzil.com/v1/images/generations');
    assert.equal(JSON.parse(options.body).model, 'gpt-image-2');
    calls++;
    return Response.json({ data: [{ b64_json: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64') }] });
  };
  const update = async (id, cover) => { updates++; assert.equal(id, 'cover-once'); assert.match(cover, /^https:\/\/mock-project\.supabase\.co\/storage\/v1\/object\/public\/shiguang-covers\/poems\/.+\.png$/); };
  images.enqueueCover('cover-once', '一首诗', update);
  images.enqueueCover('cover-once', '一首诗', update);
  await images.waitForIdle();
  images.enqueueCover('cover-once', '一首诗', update);
  await images.waitForIdle();
  assert.equal(calls, 1);
  assert.equal(updates, 1);
  global.fetch = async () => ({ ok: true, json: async () => ({ data: [{ b64_json: Buffer.from('<script>bad</script>').toString('base64') }] }) });
  assert.equal(await images.generateCover('测试'), images.DEFAULT_COVER);
  global.fetch = async () => { throw new Error('timeout'); };
  assert.equal(await images.generateCover('测试'), images.DEFAULT_COVER);
});
