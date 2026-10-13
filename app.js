const config = require('./config');
const request = require('./utils/request');
App({
  globalData: {role:null,profile:null,session:null,revision:0,sessionEpoch:0,logDraft:null,loginRequired:false,loggingOut:false},
  onLaunch() { this.ensureSession().catch(() => {}); },
  ensureSession() {
    if (this.globalData.loggingOut) return Promise.reject(new Error('正在退出登录，请稍候'));
    if (this.globalData.session) return Promise.resolve(this.globalData.session);
    if (this.loginTask) return this.loginTask;
    const epoch=this.globalData.sessionEpoch;
    const task=(config.useMock ? Promise.resolve('mock-code') : new Promise((resolve,reject)=>wx.login({success:r=>r.code?resolve(r.code):reject(new Error('微信登录未取得凭证，请重试')),fail:reject})))
      .then(code => {
        if(epoch!==this.globalData.sessionEpoch) throw Object.assign(new Error('登录已取消，请重新登录'),{status:401,code:'STALE_SESSION'});
        return request('/login',{method:'POST',data:{code},auth:false});
      })
      .then(session => {
        // 退出或401会递增 epoch，旧登录结果不得写回凭证。
        if(epoch!==this.globalData.sessionEpoch || this.globalData.loggingOut) throw Object.assign(new Error('登录已取消，请重新登录'),{status:401,code:'STALE_SESSION'});
        if(!session.token || !['volunteer','admin'].includes(session.role)) throw new Error('登录响应缺少有效会话或角色');
        wx.setStorageSync('shiguang-token',session.token);
        this.globalData.session=session;this.globalData.role=session.role;this.globalData.profile=session.profile;
        this.globalData.loginRequired=false;
        return session;
      }).finally(()=>{if(this.loginTask===task)this.loginTask=null;});
    this.loginTask=task;
    return task;
  },
  async logout() {
    if(this.logoutTask)return this.logoutTask;
    this.globalData.loggingOut=true;
    this.globalData.sessionEpoch++; // 立即使在途登录失效，logout仍使用现有token。
    this.loginTask=null;
    const task=(async()=>{
      let confirmed=false;
      try{await require('./utils/api').logout();confirmed=true;}
      catch(e){confirmed=e.status===401;}
      finally{this.clearSession();this.globalData.loggingOut=false;}
      return confirmed;
    })().finally(()=>{if(this.logoutTask===task)this.logoutTask=null;});
    this.logoutTask=task;
    return task;
  },
  clearSession() {
    wx.removeStorageSync('shiguang-token');
    this.globalData.session=null;this.globalData.role=null;this.globalData.profile=null;
    this.globalData.logDraft=null;this.globalData.revision++;this.globalData.sessionEpoch++;
    this.globalData.loginRequired=true;this.loginTask=null;
    require('./utils/page').clearAccountPages('登录已过期，请重新登录');
    require('./mock/index').reset();
  }
});
