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
    this.load();
  },
  onUnload() {
    this.unloaded = true;
  },
  async load() {
    if (this.loading) return;
    this.loading = true;
    this.setData({ loading: true });
    try {
      if (!(await ui.guard(this, ['admin'])) || this.unloaded) return;
      const items = (await api.inviteCodes()).map(present);
      if (!this.unloaded)
        this.setData({ items, status: items.length ? 'ready' : 'empty', error: '' });
    } catch (e) {
      if (this.unloaded || ui.authError(this, e)) return;
      this.setData({ items: [], status: 'error', error: ui.errorMessage(e) });
    } finally {
      this.loading = false;
      if (!this.unloaded) this.setData({ loading: false });
    }
  },
  target(e) {
    this.setData({ targetIndex: +e.detail.value });
  },
  days(e) {
    this.setData({ days: e.detail.value });
  },
  async generate() {
    if (this.data.busy || !(await ui.guard(this, ['admin'])) || this.data.busy) return;
    const days = this.data.days.trim();
    if (days && (!Number.isInteger(Number(days)) || Number(days) < 1 || Number(days) > 365)) {
      this.setData({ error: '有效天数须为1至365的整数，留空表示长期有效。' });
      return;
    }
    const targetRole = this.data.targets[this.data.targetIndex].role;
    wx.showModal({
      title: '确认生成邀请码',
      content:
        '此邀请码可授予' +
        this.data.targets[this.data.targetIndex].label +
        '身份，请仅交给获得组织授权的人。',
      confirmText: '生成邀请码',
      success: (r) => {
        if (r.confirm) this.create(targetRole, days);
      }
    });
  },
  async create(targetRole, days) {
    if (this.data.busy || !(await ui.guard(this, ['admin'])) || this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      const data = { targetRole };
      if (days) data.expiresInDays = Number(days);
      const result = present(await api.createInviteCode(data));
      this.setData({ result });
      await this.load();
    } catch (e) {
      if (ui.authError(this, e)) return;
      this.setData({ error: ui.errorMessage(e) });
    } finally {
      this.setData({ busy: false });
    }
  },
  copy(e) {
    const code = e.currentTarget.dataset.code;
    if (code) wx.setClipboardData({ data: code });
  },
  async revoke(e) {
    if (this.data.busy || !(await ui.guard(this, ['admin'])) || this.data.busy) return;
    const item = this.data.items.find((i) => i.id === e.currentTarget.dataset.id);
    if (!item || item.state !== 'active') return;
    wx.showModal({
      title: '作废邀请码',
      content: '将作废 ' + item.code + '，此操作后该码不能用于认证。',
      confirmText: '作废邀请码',
      success: (r) => {
        if (r.confirm) this.confirmRevoke(item.id);
      }
    });
  },
  async confirmRevoke(id) {
    if (this.data.busy || !(await ui.guard(this, ['admin'])) || this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      await api.revokeInviteCode(id);
      if (this.data.result && this.data.result.id === id) this.setData({ result: null });
      await this.load();
    } catch (e) {
      if (ui.authError(this, e)) return;
      this.setData({ error: ui.errorMessage(e) });
    } finally {
      this.setData({ busy: false });
    }
  }
});
