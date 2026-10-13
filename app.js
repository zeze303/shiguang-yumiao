const config = require('./config');
const request = require('./utils/request');
App({
  globalData: {
    role: null,
    profile: null,
    session: null,
    revision: 0,
    sessionEpoch: 0,
    logDraft: null,
    loginRequired: false,
    loggingOut: false
  },
  onLaunch() {
    this.ensureSession().catch(() => {});
  },
  onHide() {
    this.wasHidden = true;
  },
  onShow() {
    if (!this.wasHidden) return;
    this.wasHidden = false;
    if (this.globalData.session && !this.globalData.loginRequired && !this.globalData.loggingOut)
      this.refreshRole().catch(() => {});
  },
  async refreshRole() {
    const epoch = this.globalData.sessionEpoch;
    try {
      return await this.ensureSession(true);
    } catch (error) {
      if (
        epoch === this.globalData.sessionEpoch &&
        [401, 403].includes(error.status) &&
        error.code !== 'STALE_SESSION'
      )
        this.clearSession();
      throw error;
    }
  },
  ensureSession(refresh = false) {
    if (this.globalData.loggingOut) return Promise.reject(new Error('正在退出登录，请稍候'));
    // 先等待在途登录/角色刷新，防止页面守卫拿到过期缓存角色。
    if (this.loginTask) return this.loginTask;
    if (this.globalData.session && !refresh) return Promise.resolve(this.globalData.session);
    const epoch = this.globalData.sessionEpoch;
    const previousRole = this.globalData.role;
    const task = (
      config.useMock
        ? Promise.resolve('mock-code')
        : new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('微信登录超时，请重试')), 10000);
            try {
              wx.login({
                timeout: 10000,
                success: (r) => {
                  clearTimeout(timer);
                  r.code ? resolve(r.code) : reject(new Error('微信登录未取得凭证，请重试'));
                },
                fail: (e) => {
                  clearTimeout(timer);
                  reject(e);
                }
              });
            } catch (e) {
              clearTimeout(timer);
              reject(e);
            }
          })
    )
      .then((code) => {
        if (epoch !== this.globalData.sessionEpoch)
          throw Object.assign(new Error('登录已取消，请重新登录'), {
            status: 401,
            code: 'STALE_SESSION'
          });
        return request('/login', { method: 'POST', data: { code }, auth: false });
      })
      .then((session) => {
        // 退出或401会递增 epoch，旧登录结果不得写回凭证。
        if (epoch !== this.globalData.sessionEpoch || this.globalData.loggingOut)
          throw Object.assign(new Error('登录已取消，请重新登录'), {
            status: 401,
            code: 'STALE_SESSION'
          });
        if (!session.token || !['guest', 'volunteer', 'admin'].includes(session.role))
          throw new Error('登录响应缺少有效会话或角色');
        wx.setStorageSync('shiguang-token', session.token);
        this.globalData.session = session;
        this.globalData.role = session.role;
        this.globalData.profile = session.profile;
        this.globalData.loginRequired = false;
        if (previousRole && previousRole !== session.role) {
          this.globalData.sessionEpoch++;
          this.globalData.revision++;
          this.globalData.logDraft = null;
          require('./utils/page').clearAccountPages('身份已更新，正在返回对应首页');
          require('./utils/page').enter(session.role);
        }
        return session;
      })
      .finally(() => {
        if (this.loginTask === task) this.loginTask = null;
      });
    this.loginTask = task;
    return task;
  },
  applyRole(role, epoch) {
    if (
      epoch !== this.globalData.sessionEpoch ||
      !this.globalData.session ||
      this.globalData.loggingOut
    )
      throw Object.assign(new Error('会话已变更，请重新认证'), {
        status: 401,
        code: 'STALE_SESSION'
      });
    if (!['guest', 'volunteer', 'admin'].includes(role))
      throw new Error('认证响应缺少有效角色，请重新登录确认');
    require('./utils/page').clearAccountPages('身份已更新，正在进入服务');
    this.globalData.sessionEpoch++;
    this.globalData.revision++;
    this.globalData.logDraft = null;
    this.globalData.role = role;
    this.globalData.session = { ...this.globalData.session, role };
    require('./utils/page').enter(role);
  },
  async logout() {
    if (this.logoutTask) return this.logoutTask;
    this.globalData.loggingOut = true;
    this.globalData.sessionEpoch++; // 立即使在途登录失效，logout仍使用现有token。
    this.loginTask = null;
    const task = (async () => {
      let confirmed = false;
      try {
        await require('./utils/api').logout();
        confirmed = true;
      } catch (e) {
        confirmed = e.status === 401;
      } finally {
        this.clearSession();
        this.globalData.loggingOut = false;
      }
      return confirmed;
    })().finally(() => {
      if (this.logoutTask === task) this.logoutTask = null;
    });
    this.logoutTask = task;
    return task;
  },
  clearSession() {
    wx.removeStorageSync('shiguang-token');
    this.globalData.session = null;
    this.globalData.role = null;
    this.globalData.profile = null;
    this.globalData.logDraft = null;
    this.globalData.revision++;
    this.globalData.sessionEpoch++;
    this.globalData.loginRequired = true;
    this.loginTask = null;
    require('./utils/page').clearAccountPages('登录已过期，请重新登录');
    require('./mock/index').reset();
    require('./utils/page').toGuest();
  }
});
