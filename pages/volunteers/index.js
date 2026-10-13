const api = require('../../utils/api'),
  ui = require('../../utils/page');
Page({
  data: { status: 'loading', items: [], filtered: [], query: '' },
  onShow() {
    this.load();
  },
  async load() {
    if (!(await ui.guard(this, ['admin']))) return;
    try {
      const items = (await api.volunteers()).map((v) => ({ ...v, initial: v.name.slice(0, 1) }));
      this.setData({ items, status: items.length ? 'ready' : 'empty', error: '' });
      this.apply();
    } catch (e) {
      if (ui.authError(this, e)) return;
      this.setData({
        status: ui.temporaryError(e) && this.data.items.length ? 'ready' : 'error',
        error: ui.errorMessage(e)
      });
    }
  },
  apply() {
    this.setData({
      filtered: this.data.items.filter((v) => (v.name + (v.org || '')).includes(this.data.query))
    });
  },
  search(e) {
    this.setData({ query: e.detail.value });
    this.apply();
  },
  clear() {
    this.setData({ query: '' });
    this.apply();
  },
  pending() {
    ui.info('阶段 1 管理骨架', '志愿者详情与结对分配将在下一阶段实现。当前不会修改关系。');
  }
});
