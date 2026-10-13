const api = require('../../utils/api'),
  ui = require('../../utils/page');
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
  onShow() {
    this.load();
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
  async load() {
    if (!(await ui.guard(this, ['volunteer', 'admin']))) return;
    try {
      const [items, children] = await Promise.all([api.logs(), api.students()]);
      this.setData({
        items: items.map((l) => ({ ...l, date: (l.created_at || '').slice(0, 10) })),
        children,
        status: items.length ? 'ready' : 'empty',
        error: ''
      });
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
    await this.load();
    wx.stopPullDownRefresh();
  }
});
