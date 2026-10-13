const api = require('../../utils/api'),
  ui = require('../../utils/page');
Page({
  data: { status: 'loading', overview: null, metrics: [] },
  onShow() {
    this.load();
  },
  async load() {
    if (!(await ui.guard(this, ['admin']))) return;
    try {
      const o = await api.overview();
      o.distribution = (o.distribution || []).map((d) => ({
        ...d,
        percent: o.student_count ? Math.round((d.count / o.student_count) * 100) : 0
      }));
      o.alerts = (o.alerts || []).map((s) => ({
        ...s,
        initial: s.name.slice(-1),
        severe: ['psychology', 'aesthetic', 'finance', 'behavior'].some((k) => s[k] < 40)
      }));
      this.setData({
        overview: o,
        status: o.student_count ? 'ready' : 'empty',
        error: '',
        metrics: [
          { label: '孩子总数', value: o.student_count, unit: '人', note: '已纳入成长档案' },
          { label: '志愿者', value: o.volunteer_count, unit: '人', note: '参与结对陪伴' },
          {
            label: '平均观察分',
            value: o.average_score === null ? '—' : o.average_score,
            unit: '分',
            note: '基于最新四维均值'
          },
          { label: '需跟进孩子', value: o.alert_count, unit: '人', note: '至少一维低于 60 分' }
        ]
      });
    } catch (e) {
      if (ui.authError(this, e)) return;
      this.setData({ status: 'error', error: ui.errorMessage(e) });
    }
  },
  open(e) {
    ui.navigate('child-detail', { id: e.currentTarget.dataset.id });
  },
  pending() {
    ui.info('阶段 1 管理骨架', '预警汇总与分配流程留待下一阶段，当前不会修改关系。');
  }
});
