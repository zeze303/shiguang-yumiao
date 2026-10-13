const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const security = require('./contentSecurity');
const file = path.join(__dirname, '..', 'data', process.env.NODE_TEST_CONTEXT ? `ai-usage-test-${process.pid}.json` : 'ai-usage.json');
let queue = Promise.resolve();
let active = 0;
const running = new Map();
function number(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
function error(status, message) { return Object.assign(new Error(message), { status }); }
function assertConfiguration() {
  if (process.env.NODE_ENV === 'production' && process.env.AI_SINGLE_INSTANCE !== 'true') throw error(503, '配额账本要求单实例和持久磁盘');
}
function transaction(change) {
  const result = queue.then(async () => {
    let ledger;
    try { ledger = JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; ledger = {}; }
    const day = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    ledger.requests ||= {};
    // Daily counters reset independently. Legacy records get a conservative retention deadline.
    for (const [id, request] of Object.entries(ledger.requests)) {
      request.expiresAt ||= now + number('AI_IDEMPOTENCY_TTL_DAYS', 7) * 86400000;
      if (request.expiresAt <= now && !running.has(id)) delete ledger.requests[id];
    }
    if (ledger.day !== day) Object.assign(ledger, { day, accounts: {}, units: 0 });
    const value = change(ledger);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file + '.tmp', JSON.stringify(ledger), { mode: 0o600 });
    await fs.rename(file + '.tmp', file);
    return value;
  });
  queue = result.catch(() => {});
  return result;
}
async function run(accountId, key, payload, task) {
  security.assertConfiguration();
  assertConfiguration();
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) throw error(400, '请提供8到128位 Idempotency-Key');
  const id = crypto.createHash('sha256').update(accountId + ':' + key).digest('hex');
  const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const current = running.get(id);
  if (current) {
    if (current.hash !== hash) throw error(409, '幂等键已用于其他请求');
    return current.promise;
  }
  const promise = (async () => {
    let acquired = false;
    try {
    const result = await transaction(ledger => {
      const prior = ledger.requests[id];
      if (prior) {
        if (prior.hash !== hash) throw error(409, '幂等键已用于其他请求');
        if (prior.state !== 'done') throw error(409, '请求已受理或失败，请勿重复付费');
        return { cached: true, value: prior.value };
      }
      if (active >= number('AI_MAX_CONCURRENCY', 3)) throw error(429, '生成请求繁忙');
      if ((ledger.accounts[accountId] || 0) >= number('AI_ACCOUNT_DAILY_LIMIT', 20)) throw error(429, '账号今日配额已用完');
      if (ledger.units >= number('AI_GLOBAL_DAILY_UNITS', 500)) throw error(429, '今日生成预算已熔断');
      if (Object.keys(ledger.requests).length >= number('AI_IDEMPOTENCY_MAX_RECORDS', 10000)) throw error(429, '幂等记录容量已满');
      ledger.accounts[accountId] = (ledger.accounts[accountId] || 0) + 1;
      ledger.requests[id] = { hash, state: 'pending', expiresAt: Date.now() + number('AI_IDEMPOTENCY_TTL_DAYS', 7) * 86400000 };
      active++;
      acquired = true;
      return { cached: false };
    });
    if (result.cached) return result.value;
    try {
      const value = await task();
      await transaction(ledger => { if (ledger.requests[id]) Object.assign(ledger.requests[id], { state: 'done', value }); });
      return value;
    } catch (e) {
      await transaction(ledger => { if (ledger.requests[id]) ledger.requests[id].state = 'failed'; });
      throw e;
    }
    } finally { if (acquired) active--; }
  })();
  running.set(id, { hash, promise });
  try { return await promise; }
  finally { running.delete(id); }
}
// Shared limit for every paid provider call, including retries and async image jobs.
let providerActive = 0;
async function paidCall(task) {
  security.assertConfiguration();
  assertConfiguration();
  if (providerActive >= number('AI_MAX_CONCURRENCY', 3)) throw error(429, '外部生成服务并发已满');
  providerActive++;
  try {
    await transaction(ledger => {
      if (ledger.units >= number('AI_GLOBAL_DAILY_UNITS', 500)) throw error(429, '今日生成预算已熔断');
      ledger.units++;
    });
    return await task();
  } finally { providerActive--; }
}
module.exports = { run, paidCall, assertConfiguration };
