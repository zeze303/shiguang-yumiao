// 小程序兼容 UUID v4；幂等标识不作为安全凭证使用。
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    return (char === 'x' ? random : (random & 3) | 8).toString(16);
  });
}

// 失败保留本次操作；对象、参数或登录身份变化时开始新操作。
// 键持久化到 storage，页面关闭重开后可复用，避免重复扣费/重复生成。
function operation(page, name, payload) {
  const app = getApp();
  const scope = JSON.stringify([
    app.globalData.sessionEpoch,
    app.globalData.profile && app.globalData.profile.id,
    payload
  ]);
  const storageKey = 'op:' + name;
  const remembered = wx.getStorageSync(storageKey);
  if (remembered && remembered.scope === scope && remembered.key) {
    page[name] = remembered;
    return remembered.key;
  }
  const record = { scope, key: uuid() };
  page[name] = record;
  wx.setStorageSync(storageKey, record);
  return record.key;
}

// 操作已明确完成（或需要放弃）时清除，下一次会生成新键。
function clear(page, name) {
  if (page) page[name] = null;
  wx.removeStorageSync('op:' + name);
}

module.exports = { uuid, operation, clear };
