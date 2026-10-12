// Pluggable checker contract: async ({ content, openid }) => { allowed, skipped? }.
// Missing configuration skips checks as requested. Enabled provider failures fail closed.
let cachedToken = null;
let tokenRequest = null;
async function accessToken() {
  if (cachedToken && cachedToken.until > Date.now()) return cachedToken.value;
  if (tokenRequest) return tokenRequest;
  tokenRequest = (async () => {
    const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
    url.search = new URLSearchParams({ grant_type: 'client_credential', appid: process.env.WX_APPID, secret: process.env.WX_SECRET }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    if (!response.ok || data.errcode || !data.access_token || !Number.isFinite(data.expires_in)) throw new Error('微信 access_token 获取失败');
    cachedToken = { value: data.access_token, until: Date.now() + Math.max(0, data.expires_in - 120) * 1000 };
    return cachedToken.value;
  })();
  try { return await tokenRequest; }
  finally { tokenRequest = null; }
}
async function wechatChecker({ content, openid }) {
  if (process.env.WX_CONTENT_SECURITY !== 'true' || !process.env.WX_APPID || !process.env.WX_SECRET) return { allowed: true, skipped: true };
  if (!openid) throw Object.assign(new Error('审核缺少用户身份'), { status: 503 });
  try {
    const token = await accessToken();
    const url = new URL('https://api.weixin.qq.com/wxa/msg_sec_check');
    url.searchParams.set('access_token', token);
    const response = await fetch(url, {
      method: 'POST', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 2, scene: 2, openid, content })
    });
    const result = await response.json();
    if (result.errcode === 87014) return { allowed: false };
    if (!response.ok || result.errcode) {
      if ([40001, 42001].includes(result.errcode)) cachedToken = null;
      throw new Error('微信内容审核不可用');
    }
    return { allowed: result.result?.suggest === 'pass' };
  } catch { throw Object.assign(new Error('内容审核服务暂不可用'), { status: 503 }); }
}
let checker = wechatChecker;
async function checkText(content, openid) {
  if (typeof content !== 'string') throw new TypeError('审核内容必须为字符串');
  // Keep each request below provider text limits; any rejected chunk rejects the whole value.
  const characters = [...content];
  let skipped = true;
  for (let offset = 0; offset < Math.max(1, characters.length); offset += 600) {
    const result = await checker({ content: characters.slice(offset, offset + 600).join(''), openid });
    if (!result || result.allowed !== true) return { allowed: false };
    skipped = skipped && result.skipped === true;
  }
  return skipped ? { allowed: true, skipped: true } : { allowed: true };
}
function setChecker(customChecker) {
  if (typeof customChecker !== 'function') throw new TypeError('checker 必须为函数');
  checker = customChecker;
}
function resetChecker() { checker = wechatChecker; cachedToken = null; }
module.exports = { checkText, setChecker, resetChecker };
