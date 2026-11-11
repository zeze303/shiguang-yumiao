Component({
  properties: {
    type: { type: String, value: 'list' },
    rows: { type: Number, value: 3 }
  },
  data: {
    items: []
  },
  observers: {
    'type, rows': function (type, rows) {
      const n = Math.max(1, Math.min(Number(rows) || 3, 10));
      const list = [];
      for (let i = 0; i < n; i++) list.push(i);
      this.setData({ items: list, isDetail: type === 'detail' });
    }
  }
});
