const api = require('../../utils/api'),
  ui = require('../../utils/page'),
  share = require('../../utils/share');
Page({
  data: { status: 'loading', poem: null, showName: false, busy: false, error: '', denied: false },
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
  async save() {
    if (this.data.busy || !this.data.poem) return;
    if (this.data.denied) {
      this.setData({ error: '未保存，可点击“相册设置”允许相册权限。' });
      return;
    }
    this.setData({ busy: true, error: '' });
    try {
      const path = await share.render(this, this.data.poem, this.data.showName);
      await new Promise((resolve, reject) =>
        wx.saveImageToPhotosAlbum({
          filePath: path,
          success: resolve,
          fail: (e) => {
            if (/auth|deny|denied/.test(e.errMsg || '')) {
              this.setData({ denied: true });
              reject(new Error('未保存，可前往设置允许相册权限。'));
            } else reject(new Error('分享卡未保存，请稍后重试。'));
          }
        })
      );
      wx.showToast({ title: '分享卡已保存', icon: 'none' });
    } catch (e) {
      if (ui.authError(this, e)) return;
      this.setData({ error: ui.errorMessage(e) });
    } finally {
      this.setData({ busy: false });
    }
  },
  settings() {
    wx.openSetting({
      success: (r) => {
        if (r.authSetting['scope.writePhotosAlbum']) this.setData({ denied: false, error: '' });
      }
    });
  },
  back() {
    wx.navigateBack();
  }
});
