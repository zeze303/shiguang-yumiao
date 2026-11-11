const api = require('../../utils/api'),
  ui = require('../../utils/page'),
  cache = require('../../utils/cache');
const KEY = 'logs:list';
const TTL = 60000;

Page({
  data: {
    status: 'loading',
    items: [],
    filtered: [],
    children: [],
    filter: 'all',
    filterOpen: false,
    filterLabel: '全部',
    error: ''
  },
  lastLoadAt: 0,
  async onShow() {
    if (!(await ui.guard(this, ['volunteer', 'admin']))) return;
    const cached = cache.get(KEY);
    if (cached) this.applyData(cached);
    if (cached && Date.now() - this.lastLoadAt < TTL) return;
    this.load(false);
  },
  onHide() {
    this.closeFilter();
  },
  toggleFilter() {
    this.setData({ filterOpen: !this.data.filterOpen });
  },
  closeFilter() {
    this.setData({ filterOpen: false });
  },
  preventMove() {},
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
      const [items, children] = await Promise.all([api.logs(), api.students()]);
      const data = {
        items: items.map((l) => ({ ...l, date: (l.created_at || '').slice(0, 10) })),
        children
      };
      this.lastLoadAt = Date.now();
      cache.set(KEY, data, TTL);
      this.applyData(data);
    } catch (e) {
      if (ui.authError(this, e)) return;
      this.setData({
        status: ui.temporaryError(e) && this.data.items.length ? 'ready' : 'error',
        error: ui.errorMessage(e)
      });
    }
  },
  applyData(data) {
    this.setData({
      items: data.items,
      children: data.children,
      status: data.items.length ? 'ready' : 'empty',
      error: ''
    });
    this.apply();
  },
  apply() {
    const selected = this.data.children.find((child) => child.id === this.data.filter);
    this.setData({
      filterLabel: this.data.filter === 'all' ? '全部' : selected ? selected.name : '当前对象',
      filtered: this.data.items.filter(
        (x) => this.data.filter === 'all' || x.student_id === this.data.filter
      )
    });
  },
  filter(e) {
    this.setData({ filter: e.currentTarget.dataset.id, filterOpen: false });
    this.apply();
  },
  clear() {
    this.setData({ filter: 'all', filterOpen: false });
    this.apply();
  },
  add() {
    ui.navigate('log-create');
  },
  open(e) {
    ui.navigate('log-detail', {
      id: e.currentTarget.dataset.id,
      studentId: e.currentTarget.dataset.student
    });
  },
  async onPullDownRefresh() {
    await this.load(true);
    wx.stopPullDownRefresh();
  }
});
