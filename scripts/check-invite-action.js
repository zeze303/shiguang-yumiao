const assert = require('assert');
const fs = require('fs');
const path = require('path');
module.exports = async function checkInviteAction() {
  const api = require('../utils/api');
  const ui = require('../utils/page');
  let definition;
  global.Page = (value) => (definition = value);
  const file = require.resolve('../pages/invite-codes/index');
  delete require.cache[file];
  require(file);
  const original = {
    guard: ui.guard,
    createInviteCode: api.createInviteCode,
    showModal: wx.showModal,
    showToast: wx.showToast
  };
  let modal = 0;
  let modalOptions;
  let toast = '';
  try {
    ui.guard = async () => true;
    wx.showModal = (options) => {
      modal += 1;
      modalOptions = options;
    };
    wx.showToast = (options) => {
      toast = options.title;
    };
    const page = {
      ...definition,
      data: { ...definition.data, role: 'admin', days: 7, targetIndex: 0 },
      setData(value) {
        Object.assign(this.data, value);
      }
    };
    await page.generate();
    assert.equal(modal, 1, 'number 类型 days 也必须进入确认弹窗');
    assert.equal(toast, '');
    assert(modalOptions && typeof modalOptions.fail === 'function');
    assert(modalOptions && typeof modalOptions.complete === 'function');
    modalOptions.complete();

    page.data.days = 'bad';
    await page.generate();
    assert.equal(modal, 1);
    assert.equal(toast, '请检查有效天数。');

    ui.guard = async () => false;
    page.data.days = '7';
    await page.generate();
    assert.equal(toast, '当前身份无权限或登录状态异常，请重新进入。');

    ui.guard = async () => true;
    page.data.busy = true;
    await page.generate();
    assert.equal(toast, '请稍候，上一项操作仍在处理中。');

    page.data.busy = false;
    page.data.targetIndex = 99;
    await page.generate();
    assert.equal(toast, '请选择有效的目标身份。');

    page.data.targetIndex = 0;
    page.data.busy = false;
    modalOptions = null;
    await page.generate();
    assert.equal(modal, 2);
    modalOptions.fail({ errMsg: 'showModal:fail mocked' });
    modalOptions.complete();
    assert.equal(toast, '确认框打开失败，请重试。');
    api.createInviteCode = async () => {
      throw new Error('生成请求失败');
    };
    page.create('volunteer', '7');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.data.busy, false, '请求异常后 busy 必须复位');
    assert.equal(page.data.error, '生成请求失败');
    assert.equal(toast, '生成请求失败');

    const wxml = fs.readFileSync(path.join(__dirname, '../pages/invite-codes/index.wxml'), 'utf8');
    assert(wxml.includes('bindtap="generate"'));
    assert(wxml.includes('hover-class="button-hover"'));
    assert(wxml.includes('disabled="{{busy}}"'));

    const paginationPage = {
      ...definition,
      data: {
        ...definition.data,
        items: Array.from({ length: 45 }, (_, index) => ({ id: String(index), state: index < 25 ? 'active' : 'used' })),
        filter: 'active',
        page: 1,
        pageSize: 20,
        visibleItems: [],
        pageStatus: 'done'
      },
      setData(value) {
        Object.assign(this.data, value);
      }
    };
    paginationPage.resetView();
    assert.equal(paginationPage.data.visibleItems.length, 20);
    assert.equal(paginationPage.data.pageStatus, 'more');
    paginationPage.loadMore();
    assert.equal(paginationPage.data.visibleItems.length, 25);
    assert.equal(paginationPage.data.pageStatus, 'done');
    paginationPage.filterTab({ currentTarget: { dataset: { state: 'used' } } });
    assert.equal(paginationPage.data.page, 1);
    assert.equal(paginationPage.data.visibleItems.length, 20);
    assert.equal(paginationPage.data.tabs.find((tab) => tab.state === 'active').count, 25);
    assert.equal(paginationPage.data.tabs.find((tab) => tab.state === 'used').count, 20);
    console.log('PASS: number days、权限失败、busy、目标身份异常、请求异常、点击绑定与视觉反馈');
  } finally {
    ui.guard = original.guard;
    api.createInviteCode = original.createInviteCode;
    wx.showModal = original.showModal;
    wx.showToast = original.showToast;
  }
};
