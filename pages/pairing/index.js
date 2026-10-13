const api = require('../../utils/api');
const ui = require('../../utils/page');
Page({
  data: { status: 'loading', error: '', items: [] },
  onShow() {
    this.load();
  },
  async load() {
    if (!(await ui.guard(this, ['volunteer', 'admin']))) return;
    try {
      const items = await api.students();
      this.setData({ items, status: items.length ? 'ready' : 'empty', error: '' });
    } catch (e) {
      if (ui.authError(this, e)) return;
      this.setData({
        status: ui.temporaryError(e) && this.data.items.length ? 'ready' : 'error',
        error: ui.errorMessage(e)
      });
    }
  },
  open(e) {
    ui.navigate('child-detail', { id: e.detail.id });
  },
  help() {
    ui.info('调整结对', '结对分配由组织管理员负责。如需调整，请联系组织负责人。');
  }
});
