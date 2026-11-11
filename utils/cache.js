const store = new Map();

const DEFAULT_TTL = 60000;

function set(key, data, ttlMs = DEFAULT_TTL) {
  if (typeof key !== 'string' || !key) return;
  store.set(key, { data: data, at: Date.now(), ttl: Math.max(0, Number(ttlMs) || DEFAULT_TTL) });
}

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > entry.ttl) {
    store.delete(key);
    return null;
  }
  return entry.data;
}

function has(key) {
  return get(key) !== null;
}

function invalidate(key) {
  store.delete(key);
}

function clear(prefix) {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const key of Array.from(store.keys())) {
    if (key.indexOf(prefix) === 0) store.delete(key);
  }
}

module.exports = { set, get, has, invalidate, clear };
