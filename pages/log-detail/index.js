const api = require('../../utils/api'),
  ui = require('../../utils/page');
Page({
  data: { status: 'loading', item: null, error: '' },
  onLoad(q) {
    this.query = q;
    this.load();
  },
  async load() {
    if (!(await ui.guard(this))) return;
    try {
      const items = await api.logs(this.query.studentId);
      const item = items.find((x) => String(x.id) === this.query.id);
      this.setData({ item, status: item ? 'ready' : 'empty', error: '' });
    } catch (e) {
      if (ui.authError(this, e)) return;
      this.setData({ status: 'error', error: ui.errorMessage(e) });
    }
  },
  preview(e) {
    wx.previewImage({ urls: this.data.item.images, current: e.currentTarget.dataset.src });
  },
  back() {
    wx.navigateBack();
  }
});
