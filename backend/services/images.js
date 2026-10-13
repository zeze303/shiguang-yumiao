const { createClient } = require('@supabase/supabase-js');
const crypto = require('node:crypto');
const DEFAULT_COVER = '/assets/default-poem-cover.svg';
const MODEL = process.env.IMAGE_MODEL || 'gpt-image-2';
const pending = new Set();
// Active jobs cannot be evicted. Completed jobs have bounded, temporary deduplication;
// persisted covers remain the source of truth and GET never enqueues image work.
const activePoems = new Set();
const completedPoems = new Map();
const COMPLETED_LIMIT = 1024;
const COMPLETED_TTL_MS = 24 * 60 * 60 * 1000;
function pruneCompleted() {
  const now = Date.now();
  for (const [id, expiresAt] of completedPoems) {
    if (expiresAt <= now) completedPoems.delete(id);
  }
  while (completedPoems.size > COMPLETED_LIMIT) {
    completedPoems.delete(completedPoems.keys().next().value);
  }
}
function waitForIdle() { return Promise.allSettled([...pending]); }
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
async function uploadCover(bytes) {
  const extension = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png' :
    bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpg' :
    bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null;
  if (!extension || bytes.length > MAX_IMAGE_BYTES) return DEFAULT_COVER;
  const bucket = process.env.SUPABASE_COVERS_BUCKET || 'shiguang-covers';
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(bucket)) return DEFAULT_COVER;
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) }) }
  });
  let result = await client.storage.getBucket(bucket);
  if (result.error) {
    if (!['404', 'Bucket not found'].includes(String(result.error.statusCode)) && !/bucket not found/i.test(result.error.message)) return DEFAULT_COVER;
    const created = await client.storage.createBucket(bucket, { public: true, fileSizeLimit: MAX_IMAGE_BYTES, allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] });
    // Re-read after a creation race; never change an existing private bucket to public.
    if (created.error) {
      result = await client.storage.getBucket(bucket);
      if (result.error || result.data?.public !== true) return DEFAULT_COVER;
    }
  } else if (result.data?.public !== true) return DEFAULT_COVER;
  const filename = `poems/${crypto.randomUUID()}.${extension}`;
  const uploaded = await client.storage.from(bucket).upload(filename, bytes, {
    contentType: extension === 'jpg' ? 'image/jpeg' : `image/${extension}`, upsert: false, cacheControl: '31536000'
  });
  if (uploaded.error) return DEFAULT_COVER;
  const { data } = client.storage.from(bucket).getPublicUrl(filename);
  return data.publicUrl;
}
async function downloadCover(rawUrl, apiBase) {
  const url = new URL(rawUrl);
  // Provider URLs are untrusted. Only explicitly trusted image hosts, no redirects or private URLs.
  const hosts = (process.env.IMAGE_DOWNLOAD_HOSTS || new URL(apiBase).hostname).split(',').map(host => host.trim().toLowerCase());
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts.includes(url.hostname.toLowerCase())) throw new Error('不允许的图片来源');
  const response = await fetch(url.href, { signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!response.ok || Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) throw new Error('图片下载失败');
  const chunks = [];
  let size = 0;
  if (!response.body) throw new Error('图片内容为空');
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_IMAGE_BYTES) throw new Error('图片过大');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
async function generateCover(prompt) {
  // No paid generation when durable storage cannot be used.
  if (!process.env.IMAGE_API_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return DEFAULT_COVER;
  const base = (process.env.IMAGE_API_BASE || 'https://quanzil.com/v1').replace(/\/$/, '');
  try {
    if (!require('./privacy').isSafe(prompt)) return DEFAULT_COVER;
    const response = await require('./aiUsage').paidCall(() => fetch(`${base}/images/generations`, {
      method: 'POST', signal: AbortSignal.timeout(60000),
      headers: { Authorization: `Bearer ${process.env.IMAGE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt: `童趣手绘、暖色、与红金体系协调，画面不出现文字或水印。${prompt}`, size: '1024x1024' })
    }));
    if (!response.ok) return DEFAULT_COVER;
    const body = await response.json();
    const item = body.data?.[0];
    if (typeof item?.b64_json === 'string') {
      if (item.b64_json.length > 16 * 1024 * 1024) return DEFAULT_COVER;
      return await uploadCover(Buffer.from(item.b64_json, 'base64'));
    }
    if (typeof item?.url !== 'string') return DEFAULT_COVER;
    return await uploadCover(await downloadCover(item.url, base));
  } catch { return DEFAULT_COVER; }
}
function enqueueCover(poemId, prompt, update) {
  pruneCompleted();
  if (activePoems.has(poemId) || completedPoems.has(poemId)) return DEFAULT_COVER;
  activePoems.add(poemId);
  const task = (async () => {
    const cover = await generateCover(prompt);
    try { await update(poemId, cover); } catch (error) { console.error('诗歌封面更新失败', { code: error.code || 'INTERNAL_ERROR' }); }
    return cover;
  })();
  pending.add(task);
  const finish = () => {
    pending.delete(task);
    activePoems.delete(poemId);
    completedPoems.set(poemId, Date.now() + COMPLETED_TTL_MS);
    pruneCompleted();
  };
  task.then(finish, finish);
  return DEFAULT_COVER;
}
module.exports = { DEFAULT_COVER, MODEL, generateCover, enqueueCover, waitForIdle };
