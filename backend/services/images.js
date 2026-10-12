const fs = require('node:fs/promises');
const path = require('node:path');
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
async function generateCover(prompt) {
  if (!process.env.IMAGE_API_KEY) return DEFAULT_COVER;
  const base = (process.env.IMAGE_API_BASE || 'https://quanzil.com/v1').replace(/\/$/, '');
  try {
    const response = await fetch(`${base}/images/generations`, {
      method: 'POST', signal: AbortSignal.timeout(60000),
      headers: { Authorization: `Bearer ${process.env.IMAGE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt: `童趣手绘、暖色、与红金体系协调，画面不出现文字或水印。${prompt}`, size: '1024x1024' })
    });
    if (!response.ok) return DEFAULT_COVER;
    const body = await response.json();
    const item = body.data?.[0];
    if (typeof item?.b64_json === 'string' && item.b64_json.length <= 16 * 1024 * 1024) {
      const bytes = Buffer.from(item.b64_json, 'base64');
      const extension = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png' :
        bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpg' :
        bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null;
      if (!extension) return DEFAULT_COVER;
      const filename = `${crypto.randomUUID()}.${extension}`;
      const directory = path.join(__dirname, '..', 'public', 'assets', 'generated');
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, filename), bytes, { flag: 'wx' });
      return `/assets/generated/${filename}`;
    }
    if (typeof item?.url !== 'string') return DEFAULT_COVER;
    const url = new URL(item.url);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : DEFAULT_COVER;
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
