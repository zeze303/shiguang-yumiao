const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateSuggest, generatePoem } = require('../services/ai');

test('DeepSeek wrapper validates structured output and adds disclaimer', async (t) => {
  const originalFetch = global.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  t.after(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  });
  delete process.env.DEEPSEEK_API_KEY;
  await assert.rejects(generatePoem({}), /未配置/);
  process.env.DEEPSEEK_API_KEY = 'test-key';
  let output = { status: '需要陪伴', openers: ['最近怎样', '想聊什么'], activities: ['一起画画', '一起散步', '折纸'], cautions: ['尊重意愿', '耐心倾听'] };
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(JSON.parse(options.body).model, 'deepseek-chat');
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(output) } }] }) };
  };
  assert.equal((await generateSuggest({ name: '张*明' })).disclaimer, '仅供参考，非专业诊断');
  output = { title: '成长', content: '一笔画下\n纸上有光\n颜色铺开\n作品在桌上\n一起看看\n记住今天' };
  assert.deepEqual(await generatePoem({}), output);
  output = { status: 42 };
  await assert.rejects(generateSuggest({}), /结构无效/);
  global.fetch = async () => ({ ok: false, status: 429 });
  await assert.rejects(generatePoem({}), /HTTP 429/);
});
