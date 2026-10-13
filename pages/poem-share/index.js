const api = require('../../utils/api'),
  ui = require('../../utils/page');
Page({
  data: { status: 'loading', poem: null, showName: false, error: '' },
  onLoad(q) {
    this.query = q;
    this.load();
  },
  async load() {
    if (!(await ui.guard(this))) return;
    try {
      const poems = await api.poems(this.query.studentId),
        poem = poems.find((p) => String(p.id) === this.query.id);
      this.setData({ poem, status: poem && poem.content ? 'ready' : 'empty', error: '' });
    } catch (e) {
      if (ui.authError(this, e)) return;
      this.setData({ status: 'error', error: ui.errorMessage(e) });
    }
  },
  toggle(e) {
    const checked = e.detail.value.length > 0;
    if (!checked) {
      this.setData({ showName: false });
      return;
    }
    wx.showModal({
      title: '确认昵称授权',
      content: '分享卡将显示孩子昵称。请确认已取得适用授权，不向不相关的人发送。',
      confirmText: '确认授权',
      success: (r) => this.setData({ showName: !!r.confirm })
    });
  },
  back() {
    wx.navigateBack();
  }
});
