const tabs = [
  ['bindings', 'sprout', '我的结对'],
  ['poems', 'book', '成长诗'],
  ['logs', 'pencil', '记录'],
  ['profile', 'user', '我的']
];
Component({
  data: { items: [], selected: '' },
  lifetimes: {
    attached() {
      this.sync();
    }
  },
  methods: {
    sync() {
      const pages = getCurrentPages(),
        route = pages.length ? pages[pages.length - 1].route : '';
      const role = getApp().globalData.role;
      this.setData({
        items: ['volunteer', 'admin'].includes(role)
          ? tabs.map(([name, icon, text]) => ({
              name,
              icon,
              text,
              url: '/pages/' + name + '/index'
            }))
          : [],
        selected: '/' + route
      });
    },
    change(e) {
      const url = e.currentTarget.dataset.url;
      if (url !== this.data.selected) wx.switchTab({ url });
    }
  }
});
