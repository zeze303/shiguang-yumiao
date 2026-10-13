const assert = require('assert');
const fs = require('fs');
const path = require('path');
module.exports = async function checkTextOnly() {
  const root = path.resolve(__dirname, '..');
  const calls = ['choose' + 'Media', 'choose' + 'Image', 'saveImageTo' + 'PhotosAlbum', 'preview' + 'Image'];
  function scan(dir) {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(file);
      else if (/\.(js|wxml)$/.test(file)) {
        const text = fs.readFileSync(path.join(root, file), 'utf8');
        calls.forEach(name => assert(!text.includes('wx.' + name), file + ' 不应包含设备图片接口'));
      }
    }
  }
  ['pages', 'scripts', 'utils', 'components', 'custom-tab-bar', 'mock'].forEach(scan);
  const api = require('../utils/api'), ui = require('../utils/page');
  const original = { guard: ui.guard, createLog: api.createLog, navigateBack: wx.navigateBack, toast: wx.showToast };
  let definition;
  global.Page = value => definition = value;
  const modulePath = require.resolve('../pages/log-create/index');
  delete require.cache[modulePath];
  require(modulePath);
  const page = {
    ...definition,
    data: { ...definition.data, children: [{ id: 'a' }], content: '短' },
    setData(value) { Object.assign(this.data, value); }
  };
  try {
    let submitted;
    api.createLog = async value => submitted = value;
    wx.navigateBack = () => {};
    wx.showToast = () => {};
    await page.submit();
    assert.equal(submitted, undefined);
    assert(page.data.fieldError);
    page.input({ detail: { value: '一起读了绘本，孩子主动分享了今天的心情。' } });
    assert.equal(getApp().globalData.logDraft.content, page.data.content);
    assert.equal(getApp().globalData.logDraft.images, undefined);
    await page.submit();
    assert.deepEqual(submitted.images, []);
    assert.equal(getApp().globalData.logDraft, null);
    assert.equal(definition.upload, undefined);
    assert.equal(definition.remove, undefined);
    for (const name of ['logs', 'log-detail']) {
      const html = fs.readFileSync(path.join(root, 'pages', name, 'index.wxml'), 'utf8');
      assert(!html.includes('item.images'));
      assert(!html.includes('item.illustration'));
    }
    const html = fs.readFileSync(path.join(root, 'pages/poem-share/index.wxml'), 'utf8');
    assert(html.includes('截图'));
    assert(!html.includes('bindtap="save"'));
    assert(!html.includes('shareCanvas'));
    console.log('PASS: 前端无设备选图/相册保存/图片预览调用，记录校验/文字草稿/空images提交，历史图不展示，分享仅预览与截图提示');
  } finally {
    api.createLog = original.createLog;
    ui.guard = original.guard;
    wx.navigateBack = original.navigateBack;
    wx.showToast = original.toast;
  }
};
