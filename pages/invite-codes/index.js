const api = require('../../utils/api'),
  ui = require('../../utils/page');
function present(item) {
  const expired = item.expires_at && Date.parse(item.expires_at) <= Date.now();
  const state =
    item.status === 'used' || item.used_at || item.used_by
      ? 'used'
      : item.status === 'revoked'
        ? 'revoked'
        : expired
          ? 'expired'
          : item.status;
  return {
    ...item,
    state,
    roleText: item.target_role === 'admin' ? '管理员' : '志愿者',
    stateText:
      { active: '可使用', used: '已使用', revoked: '已作废', expired: '已过期' }[state] ||
      '状态待确认',
    createdText: (item.created_at || '').slice(0, 10),
    expiresText: item.expires_at ? item.expires_at.slice(0, 10) : '长期有效'
  };
}
Page({
  data: {
    status: 'loading',
    items: [],
    visibleItems: [],
    filter: 'active',
    tabs: [
      { state: 'all', label: '全部', count: 0 },
      { state: 'active', label: '可用', count: 0 },
      { state: 'used', label: '已使用', count: 0 },
      { state: 'expired', label: '已过期', count: 0 },
      { state: 'revoked', label: '已作废', count: 0 }
    ],
    page: 1,
    pageSize: 20,
    pageStatus: 'done',
    targetIndex: 0,
    targets: [
      { role: 'volunteer', label: '志愿者' },
      { role: 'admin', label: '管理员' }
    ],
    days: '7',
    busy: false,
    error: '',
    result: null
  },
  onLoad() {
    this.setData({ busy: false, error: '', result: null, filter: 'active', page: 1 });
    this.load();
  },
  onReachBottom() {
    this.loadMore();
  },
  onUnload() {
    this.unloaded = true;
    this.modalOpen = false;
  },
  async load() {
    if (this.loading) return;
    this.loading = true;
    this.setData({ loading: true });
    try {
      if (!(await ui.guard(this, ['admin'])) || this.unloaded) return;
      const items = (await api.inviteCodes()).map(present);
      if (!this.unloaded) {
        this.setData({ items, status: items.length ? 'ready' : 'empty', error: '' });
        this.resetView();
      }
    } catch (e) {
      if (this.unloaded || ui.authError(this, e)) return;
      this.setData({ items: [], status: 'error', error: ui.errorMessage(e) });
    } finally {
      this.loading = false;
      if (!this.unloaded) this.setData({ loading: false });
    }
  },
  resetView() {
    const source = this.data.filter === 'all'
      ? this.data.items
      : this.data.items.filter((item) => item.state === this.data.filter);
    const page = Math.max(1, this.data.page || 1);
    const visibleItems = source.slice(0, page * this.data.pageSize);
    const tabs = ['all', 'active', 'used', 'expired', 'revoked'].map((state) => ({
      state,
      label: { all: '全部', active: '可用', used: '已使用', expired: '已过期', revoked: '已作废' }[state],
      count: state === 'all' ? this.data.items.length : this.data.items.filter((item) => item.state === state).length
    }));
    this.setData({
      tabs,
      visibleItems,
      page,
      pageStatus: source.length > visibleItems.length ? 'more' : source.length ? 'done' : 'empty'
    });
  },
  filterTab(e) {
    const filter = e.currentTarget.dataset.state;
    this.setData({ filter, page: 1 });
    this.resetView();
    if (typeof wx.pageScrollTo === 'function') wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  loadMore() {
    if (this.data.pageStatus !== 'more' || this.loadingMore) return;
    this.loadingMore = true;
    this.setData({ pageStatus: 'loading' });
    const source = this.data.filter === 'all'
      ? this.data.items
      : this.data.items.filter((item) => item.state === this.data.filter);
    const page = this.data.page + 1;
    const visibleItems = source.slice(0, page * this.data.pageSize);
    this.setData({
      visibleItems,
      page,
      pageStatus: source.length > visibleItems.length ? 'more' : 'done'
    });
    this.loadingMore = false;
  },
  target(e) {
    this.setData({ targetIndex: +e.detail.value });
  },
  days(e) {
    this.setData({ days: e.detail.value });
  },
  async generate() {
    if (this.data.busy) {
      this.notify('请稍候，上一项操作仍在处理中。');
      return;
    }
    try {
      const allowed = await ui.guard(this, ['admin']);
      if (!allowed) {
        this.notify('当前身份无权限或登录状态异常，请重新进入。');
        return;
      }
      if (this.data.busy) {
        this.notify('请稍候，上一项操作仍在处理中。');
        return;
      }
      const rawDays = this.data.days;
      const days = String(rawDays ?? '').trim();
      const validDays = !days || (Number.isInteger(Number(days)) && Number(days) >= 1 && Number(days) <= 365);
      if (!validDays) {
        this.setData({ error: '有效天数须为1至365的整数，留空表示长期有效。' });
        this.notify('请检查有效天数。');
        return;
      }
      const targetIndex = Number(this.data.targetIndex);
      const target = Number.isInteger(targetIndex) ? this.data.targets[targetIndex] : null;
      if (!target) {
        this.setData({ error: '请选择有效的目标身份。' });
        this.notify('请选择有效的目标身份。');
        return;
      }
      if (this.modalOpen) {
        this.notify('已有确认框打开，请先完成当前操作。');
        return;
      }
      this.modalOpen = true;
      wx.showModal({
        title: '确认生成邀请码',
        content: '此邀请码可授予' + target.label + '身份，请仅交给获得组织授权的人。',
        confirmText: '确认生成',
        success: (result) => {
          if (result && result.confirm) this.create(target.role, days);
        },
        fail: (error) => {
          this.setData({ error: '确认框打开失败，请重试。' });
          this.notify('确认框打开失败，请重试。');
        },
        complete: () => {
          this.modalOpen = false;
        }
      });
    } catch (error) {
      this.modalOpen = false;
      if (ui.authError(this, error)) {
        this.notify('当前身份无权限或登录状态异常，请重新进入。');
        return;
      }
      const message = ui.errorMessage(error);
      this.setData({ error: message });
      this.notify(message);
    }
  },
  notify(message) {
    try {
      wx.showToast({ title: String(message).slice(0, 32), icon: 'none', duration: 2400 });
    } catch (error) {
    }
  },
  async create(targetRole, days) {
    if (this.data.busy) {
      this.notify('请稍候，上一项操作仍在处理中。');
      return;
    }
    try {
      if (!(await ui.guard(this, ['admin']))) {
        this.notify('当前身份无权限或登录状态异常，请重新进入。');
        return;
      }
      if (this.data.busy) {
        this.notify('请稍候，上一项操作仍在处理中。');
        return;
      }
      this.setData({ busy: true, error: '' });
      const data = { targetRole };
      if (days) data.expiresInDays = Number(days);
      const result = present(await api.createInviteCode(data));
      this.setData({ result });
      await this.load();
    } catch (e) {
      if (ui.authError(this, e)) return;
      this.setData({ error: ui.errorMessage(e) });
      this.notify(ui.errorMessage(e));
    } finally {
      this.setData({ busy: false });
    }
  },
  copy(e) {
    const code = e.currentTarget.dataset.code;
    if (code) wx.setClipboardData({ data: code });
  },
  async revoke(e) {
    if (this.data.busy) {
      this.notify('请稍候，上一项操作仍在处理中。');
      return;
    }
    try {
      if (!(await ui.guard(this, ['admin']))) {
        this.notify('当前身份无权限或登录状态异常，请重新进入。');
        return;
      }
      if (this.data.busy) {
        this.notify('请稍候，上一项操作仍在处理中。');
        return;
      }
      const item = this.data.items.find((i) => i.id === e.currentTarget.dataset.id);
      if (!item || item.state !== 'active') {
        this.notify('该邀请码已不可作废。');
        return;
      }
      wx.showModal({
        title: '作废邀请码',
      content: '将作废 ' + item.code + '，此操作后该码不能用于认证。',
        confirmText: '确认作废',
        success: (r) => {
          if (r.confirm) this.confirmRevoke(item.id);
        }
      });
    } catch (e) {
      if (ui.authError(this, e)) return;
      this.setData({ error: ui.errorMessage(e) });
      this.notify(ui.errorMessage(e));
    }
  },
  async confirmRevoke(id) {
    if (this.data.busy) {
      this.notify('请稍候，上一项操作仍在处理中。');
      return;
    }
    try {
      if (!(await ui.guard(this, ['admin']))) {
        this.notify('当前身份无权限或登录状态异常，请重新进入。');
        return;
      }
      if (this.data.busy) {
        this.notify('请稍候，上一项操作仍在处理中。');
        return;
      }
      this.setData({ busy: true, error: '' });
      await api.revokeInviteCode(id);
      if (this.data.result && this.data.result.id === id) this.setData({ result: null });
      await this.load();
    } catch (e) {
      if (ui.authError(this, e)) return;
      this.setData({ error: ui.errorMessage(e) });
      this.notify(ui.errorMessage(e));
    } finally {
      this.setData({ busy: false });
    }
  }
});
