const api = require('../../utils/api'),
  ui = require('../../utils/page'),
  idempotency = require('../../utils/idempotency'),
  cache = require('../../utils/cache');
const TTL = 60000;

Page({
  data: { status: 'loading', student: null, suggestion: null, busy: false, error: '' },
  lastLoadAt: 0,
  async onLoad(q) {
    this.id = q.id;
    if (!(await ui.guard(this))) return;
    const key = this.cacheKey();
    const cached = key ? cache.get(key) : null;
    if (cached) this.applyCached(cached);
    this.load(false);
  },
  cacheKey() {
    return this.id ? 'advice:' + this.id : '';
  },
  applyCached(data) {
    if (!data || !data.suggestion) return;
    this.setData({
      student: data.student,
      suggestion: data.suggestion,
      status: 'ready',
      error: ''
    });
  },
  async load(force) {
    if (this.data.busy || !(await ui.guard(this))) return;
    if (!this.id) {
      this.setData({ status: 'empty' });
      return;
    }
    if (!force && this.data.suggestion && this.cacheKey() && cache.get(this.cacheKey()) && Date.now() - this.lastLoadAt < TTL) return;
    this.setData({ busy: true });
    try {
      const [student, suggestion] = await Promise.all([
        api.student(this.id),
        api.suggest(
          this.id,
          idempotency.operation(this, 'suggestOperation', { studentId: this.id })
        )
      ]);
      this.suggestOperation = null;
      this.lastLoadAt = Date.now();
      if (suggestion) cache.set(this.cacheKey(), { student, suggestion }, TTL);
      this.setData({ status: suggestion ? 'ready' : 'empty', student, suggestion, error: '' });
    } catch (e) {
      if (ui.authError(this, e)) return;
      const suggestion = ui.temporaryError(e) ? this.data.suggestion : null;
      this.setData({
        status: suggestion ? 'ready' : 'error',
        suggestion,
        error: ui.errorMessage(e)
      });
    } finally {
      this.setData({ busy: false });
    }
  },
  copy() {
    const opener = this.data.suggestion && this.data.suggestion.openers[0];
    if (opener)
      wx.setClipboardData({
        data: opener,
        success: () => wx.showToast({ title: '已复制', icon: 'none' })
      });
  },
  log() {
    ui.navigate('log-create', { id: this.id });
  },
  back() {
    wx.navigateBack();
  }
});
