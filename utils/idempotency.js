// 小程序兼容 UUID v4；幂等标识不作为安全凭证使用。
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const random = Math.floor(Math.random() * 16);
    return (char === 'x' ? random : (random & 3) | 8).toString(16);
  });
}
// 失败保留本次操作；对象、参数或登录身份变化时开始新操作。
function operation(page, name, payload) {
  const app = getApp();
  const scope = JSON.stringify([app.globalData.sessionEpoch, app.globalData.profile && app.globalData.profile.id, payload]);
  const previous = page[name];
  if (!previous || previous.scope !== scope) page[name] = {scope, key:uuid()};
  return page[name].key;
}
module.exports = {uuid, operation};
