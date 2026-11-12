const api = require('../../utils/api'),
  ui = require('../../utils/page');
Page({
  data: { status: 'loading', overview: null, error: '', sessionError: '', lastLogin: null },
  onShow() {
    this.load();
    this.checkLastLogin();
  },
  checkLastLogin() {
    const app = getApp();
    const saved = wx.getStorageSync('last-login');
    if (app.globalData.loginRequired && saved && saved.role) {
      const at = saved.at ? new Date(saved.at) : null;
      this.setData({
        lastLogin: {
          ...saved,
          roleText: saved.role === 'admin' ? '管理员' : '志愿者',
          timeText: at
            ? String(at.getMonth() + 1).padStart(2, '0') +
              '-' +
              String(at.getDate()).padStart(2, '0') +
              ' ' +
              String(at.getHours()).padStart(2, '0') +
              ':' +
              String(at.getMinutes()).padStart(2, '0')
            : ''
        }
      });
      return;
    }
    if (!app.globalData.loginRequired) this.resolveRole();
  },
  async resume() {
    const app = getApp();
    if (this.resuming) return;
    this.resuming = true;
    this.setData({ sessionError: '' });
    try {
      app.globalData.loginRequired = false;
      const session = await app.ensureSession(true);
      if (session.role !== 'guest') ui.enter(session.role);
      else this.setData({ lastLogin: null });
    } catch (e) {
      app.globalData.loginRequired = true;
      this.setData({ sessionError: ui.errorMessage(e) });
    } finally {
      this.resuming = false;
    }
  },
  async resolveRole() {
    const app = getApp();
    if (app.globalData.loginRequired) return;
    try {
      const session = await app.ensureSession();
      if (session.role !== 'guest') ui.enter(session.role);
      else this.setData({ role: 'guest' });
    } catch (e) {
      this.setData({ sessionError: ui.errorMessage(e) });
    }
  },
  async load() {
    try {
      const overview = await api.publicOverview();
      this.setData({
        overview,
        status:
          overview.student_count || overview.school_count || overview.record_count
            ? 'ready'
            : 'empty',
        error: ''
      });
    } catch (e) {
      this.setData({ status: 'error', overview: null, error: ui.errorMessage(e) });
    }
  },
  certify() {
    ui.navigate('redeem');
  },
  async onPullDownRefresh() {
    await this.load();
    wx.stopPullDownRefresh();
  }
});
