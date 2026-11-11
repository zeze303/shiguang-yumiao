const api = require('../../utils/api');
const ui = require('../../utils/page');
const cache = require('../../utils/cache');
const KEY = 'bindings:students';
const TTL = 60000;

Page({
  data: { status: 'loading', error: '', items: [], filtered: [], filter: 'all', urgentCount: 0 },
  lastLoadAt: 0,
  async onShow() {
    if (!(await ui.guard(this, ['volunteer', 'admin']))) return;
    const cached = cache.get(KEY);
    if (cached) this.applyItems(cached);
    if (cached && Date.now() - this.lastLoadAt < TTL) return;
    this.load(false);
  },
  load(force) {
    if (!force && this.inflight) return this.inflight;
    this.inflight = this.doLoad(force).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  },
  async doLoad(force) {
    if (!(await ui.guard(this, ['volunteer', 'admin']))) return;
    if (!force && cache.get(KEY) && Date.now() - this.lastLoadAt < TTL) return;
    try {
      const items = await api.students();
      this.lastLoadAt = Date.now();
      cache.set(KEY, items, TTL);
      this.applyItems(items);
    } catch (e) {
      if (ui.authError(this, e)) return;
      this.setData({
        status: ui.temporaryError(e) && this.data.items.length ? 'ready' : 'error',
        error: ui.errorMessage(e)
      });
    }
  },
  applyItems(items) {
    this.setData({
      items,
      status: items.length ? 'ready' : 'empty',
      error: '',
      urgentCount: items.filter((s) => s.urgent).length
    });
    this.apply();
  },
  apply() {
    this.setData({
      filtered: this.data.items.filter((s) => this.data.filter !== 'urgent' || s.urgent)
    });
  },
  filter(e) {
    this.setData({ filter: e.currentTarget.dataset.filter });
    this.apply();
  },
  open(e) {
    ui.navigate('child-detail', { id: e.detail.id });
  },
  inspire() {
    if (this.data.items.length)
      ui.navigate('advice', {
        id: (this.data.items.find((s) => s.urgent) || this.data.items[0]).id
      });
  },
  help() {
    ui.info('结对说明', '结对分配由组织管理者负责，请联系你的组织负责人。');
  },
  clear() {
    this.setData({ filter: 'all' });
    this.apply();
  },
  async onPullDownRefresh() {
    await this.load(true);
    wx.stopPullDownRefresh();
  }
});
