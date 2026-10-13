const config = require('../config');
let loadingCount = 0;
function failure(message, status, code) { const e = new Error(message); e.status = status; e.code = code; return e; }
function request(path, options = {}) {
  const {method = 'GET', data = {}, auth = true, loading = false, headers = {}} = options;
  const token = wx.getStorageSync('shiguang-token');
  const epoch = typeof getApp === 'function' && getApp() ? getApp().globalData.sessionEpoch : 0;
  if (loading && ++loadingCount === 1) wx.showLoading({title: '正在加载', mask: false});
  const task = config.useMock ? require('../mock/index').request(path,{method,data,token}) : new Promise((resolve,reject) => {
    const localDev = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(config.baseURL);
    if (!config.baseURL.startsWith('https://') && !localDev) { reject(failure('请配置 HTTPS 接口基址')); return; }
    wx.request({url: (config.baseURL.endsWith('/') ? config.baseURL.slice(0,-1) : config.baseURL) + path, method, data, timeout: config.timeout,
      header: {...headers, 'content-type':'application/json', ...(auth && token ? {Authorization:'Bearer ' + token} : {})},
      success(res) {
        if (res.statusCode === 401) { reject(failure('登录已过期，请重新登录',401)); return; }
        if (res.statusCode === 403) { reject(failure('当前没有查看权限，结对关系可能已变更',403)); return; }
        const body = res.data;
        if (res.statusCode < 200 || res.statusCode >= 300 || !body || body.success !== true) { reject(failure(body && body.message || '暂时没能加载出来，请稍后重试',res.statusCode,body && body.code)); return; }
        resolve(body.data);
      }, fail(err) { reject(failure(/timeout/.test(err.errMsg || '') ? '暂时未能确认请求结果，请稍后刷新列表' : '连接暂时中断，请检查网络后重试')); }
    });
  });
  // 原生timeout之外的兜底：即使运行时遗漏回调，也让页面进入错误态。
  const timeout=Number.isFinite(config.timeout)&&config.timeout>0?config.timeout:30000;
  let timer;
  const bounded=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(failure('请求超时，请手动重试',408)),timeout+100);task.then(resolve,reject);});
  return bounded.then(result => { if (auth && typeof getApp === 'function' && getApp().globalData.sessionEpoch !== epoch) throw failure('会话已变更，请重新加载',401,'STALE_SESSION'); return result; }).catch(async err => {
    if (auth && typeof getApp === 'function' && getApp().globalData.sessionEpoch !== epoch) throw failure('会话已变更，请重新登录',401,'STALE_SESSION');
    // 同角色刷新也会换token：旧凭证的401只标为过时，不清理当前会话。
    if (auth && err.status === 401 && wx.getStorageSync('shiguang-token') !== token) throw failure('请求使用的登录凭证已更新',401,'STALE_SESSION');
    if (auth && err.status === 403 && typeof getApp === 'function' && getApp().globalData.session && !getApp().globalData.loggingOut) {
      try { await getApp().refreshRole(); } catch (_) {}
      if(getApp().globalData.sessionEpoch !== epoch) throw failure('身份已变更，已返回对应首页',401,'STALE_SESSION');
    }
    if (auth && err.status === 401 && typeof getApp === 'function') getApp().clearSession();
    throw err;
  }).finally(() => { clearTimeout(timer);if (loading && --loadingCount === 0) wx.hideLoading(); });
}
module.exports = request;
