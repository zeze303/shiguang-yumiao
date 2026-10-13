const assert=require('assert');
module.exports=async function checkSession(){
 const app=getApp(),config=require('../config'),api=require('../utils/api'),ui=require('../utils/page');const original={...config};
 const saved={request:wx.request,login:wx.login,reLaunch:wx.reLaunch,switchTab:wx.switchTab,pages:global.getCurrentPages};
 const makePage=(name,data)=>{let definition;global.Page=value=>definition=value;const file=require.resolve('../pages/'+name+'/index');delete require.cache[file];require(file);return {...definition,data:{...definition.data,...data},route:'pages/'+name+'/index',setData(next){Object.assign(this.data,next);}};};
 let pages=[],redirects=[];global.getCurrentPages=()=>pages;wx.reLaunch=opts=>redirects.push(opts.url);wx.switchTab=opts=>redirects.push(opts.url);
 config.useMock=false;config.baseURL='https://example.test/api/app';wx.login=opts=>opts.success({code:'test-code'});
 const initialize=()=>{app.clearSession();const session={token:'current',role:'volunteer',profile:{id:'v1',name:'林知夏'}};wx.setStorageSync('shiguang-token',session.token);Object.assign(app.globalData,{session,profile:session.profile,role:session.role,loginRequired:false,loggingOut:false});};
 try{
  initialize();
  let headers;wx.request=opts=>{headers=opts.header;if(opts.url.endsWith('/logout'))opts.success({statusCode:200,data:{success:true,data:null}});else throw new Error('意外请求');};
  pages=[makePage('bindings',{items:[{id:'old'}],filtered:[{id:'old'}]}),makePage('logs',{items:[{id:'old'}],children:[{id:'old'}]})];
  assert.equal(await app.logout(),true);assert.equal(headers.Authorization,'Bearer current');assert(!wx.getStorageSync('shiguang-token'));assert.equal(pages[0].data.items.length,0);assert.equal(pages[1].data.children.length,0);assert(app.globalData.loginRequired);
  initialize();wx.request=opts=>opts.fail({errMsg:'network error'});assert.equal(await app.logout(),false);assert(!wx.getStorageSync('shiguang-token'));assert.equal(app.globalData.session,null);
  // profile展示要求的失败文案，不论注销失败都已经清掉本地数据。
  initialize();const profile=makePage('profile',{status:'ready'});pages=[profile];const oldModal=wx.showModal;wx.showModal=opts=>opts.success({confirm:true});
  const oldToast=wx.showToast;let toast;wx.showToast=opts=>toast=opts.title;profile.logout();await new Promise(resolve=>setImmediate(resolve));assert.equal(toast,'本机已退出，服务器会话撤销未确认');assert.equal(redirects[redirects.length-1],'/pages/guest/index');wx.showToast=oldToast;wx.showModal=oldModal;
  // 登录已经发出，退出后旧结果到达不能写回。新登录也不能被旧task.finally移除。
  pages=[];app.clearSession();let pending=[];wx.request=opts=>{if(opts.url.endsWith('/login'))pending.push(opts);else opts.success({statusCode:200,data:{success:true,data:null}});};
  const oldLogin=app.ensureSession();const rejected=assert.rejects(oldLogin,e=>e.code==='STALE_SESSION');await new Promise(resolve=>setImmediate(resolve));assert.equal(pending.length,1);
  await app.logout();const newLogin=app.ensureSession();await new Promise(resolve=>setImmediate(resolve));assert.equal(pending.length,2);
  pending[0].success({statusCode:200,data:{success:true,data:{token:'old-token',role:'volunteer',profile:{id:'old'}}}});await rejected;assert.equal(app.loginTask,newLogin);assert(!wx.getStorageSync('shiguang-token'));
  pending[1].success({statusCode:200,data:{success:true,data:{token:'new-token',role:'volunteer',profile:{id:'new'}}}});await newLogin;assert.equal(wx.getStorageSync('shiguang-token'),'new-token');
  // 迟到的旧401也不得使新账号退出。
  let previousRequest;wx.request=opts=>previousRequest=opts;const oldCall=api.students();const stale=assert.rejects(oldCall,e=>e.code==='STALE_SESSION');app.clearSession();Object.assign(app.globalData,{session:{token:'latest',role:'volunteer',profile:{id:'latest'}},loginRequired:false});wx.setStorageSync('shiguang-token','latest');previousRequest.success({statusCode:401,data:{success:false}});await stale;assert.equal(wx.getStorageSync('shiguang-token'),'latest');
  // 同角色刷新只更换token、不变epoch：旧401不得撤销刚建立的新会话。
  initialize();pages=[makePage('profile',{status:'ready'})];let oldTokenRequest;
  wx.request=opts=>{if(opts.url.endsWith('/login'))opts.success({statusCode:200,data:{success:true,data:{token:'same-role-new-token',role:'volunteer',profile:{id:'v1',name:'林知夏'}}}});else oldTokenRequest=opts;};
  const tokenEpoch=app.globalData.sessionEpoch;const tokenCall=api.students();const tokenStale=assert.rejects(tokenCall,e=>e.code==='STALE_SESSION');
  await app.refreshRole();assert.equal(app.globalData.sessionEpoch,tokenEpoch);const movesBefore401=redirects.length;
  oldTokenRequest.success({statusCode:401,data:{success:false}});await tokenStale;
  assert.equal(wx.getStorageSync('shiguang-token'),'same-role-new-token');assert.equal(app.globalData.session.token,'same-role-new-token');assert.equal(app.globalData.role,'volunteer');assert.equal(app.globalData.loginRequired,false);assert.equal(redirects.length,movesBefore401);
  const error=Object.assign(new Error('expired'),{status:401});
  for(const name of ['bindings','logs','poems','students','volunteers','pairing']){
   initialize();if(['students','volunteers'].includes(name)){app.globalData.session.role='admin';app.globalData.role='admin';}const page=makePage(name,{status:'ready',items:[{id:'old',name:'旧数据'}],filtered:[{id:'old'}],children:[{id:'old'}]});pages=[page];
   wx.request=opts=>opts.url.endsWith('/login')?opts.success({statusCode:200,data:{success:true,data:{...app.globalData.session,token:'refreshed'}}}):opts.success({statusCode:403,data:{success:false}});await page.load();assert.equal(page.data.status,'error',name+' 403状态');assert.deepEqual(page.data.items,[],name+' 403清数据');assert.deepEqual(page.data.filtered,[]);assert(!app.globalData.loginRequired,'403不能清整个会话');
   initialize();if(['students','volunteers'].includes(name)){app.globalData.session.role='admin';app.globalData.role='admin';}page.sessionEpoch=app.globalData.sessionEpoch;page.setData({items:[{id:'old'}],filtered:[{id:'old'}],status:'ready'});wx.request=opts=>opts.fail({errMsg:'network error'});await page.load();assert.equal(page.data.status,'ready',name+' 网络失败保留内容');assert.equal(page.data.items.length,1);
  }
  initialize();const bindings=makePage('bindings',{items:[{id:'old'}],filtered:[{id:'old'}],status:'ready'});const logs=makePage('logs',{items:[{id:'old'}],filtered:[{id:'old'}]});pages=[bindings,logs];
  wx.request=opts=>opts.success({statusCode:401,data:{success:false}});await bindings.load();assert.deepEqual(bindings.data.items,[]);assert.deepEqual(logs.data.items,[]);assert(app.globalData.loginRequired);assert(redirects.includes('/pages/guest/index'));
  initialize();pages=[bindings];wx.request=opts=>opts.success({statusCode:200,data:{success:true,data:[]}});await bindings.load();assert.equal(bindings.data.status,'empty');assert.deepEqual(bindings.data.items,[]);assert.deepEqual(bindings.data.filtered,[]);
  assert.equal(ui.authError(bindings,error),true);
  // 服务端降级：业务403触发登录复核，不能保留空导航的业务页。
  initialize();app.globalData.role='admin';app.globalData.session.role='admin';pages=[makePage('profile',{status:'ready',items:[{id:'private'}]})];
  wx.request=opts=>opts.url.endsWith('/login')?opts.success({statusCode:200,data:{success:true,data:{token:'guest-token',role:'guest',profile:{id:'v1'}}}}):opts.success({statusCode:403,data:{success:false}});
  await assert.rejects(()=>api.students(),e=>e.code==='STALE_SESSION');assert.equal(app.globalData.role,'guest');assert.equal(redirects[redirects.length-1],'/pages/guest/index');assert.deepEqual(pages[0].data.items,[]);
  initialize();pages=[makePage('profile',{status:'ready'})];wx.request=opts=>opts.success({statusCode:200,data:{success:true,data:{token:'guest-token',role:'guest',profile:{id:'v1'}}}});app.onHide();app.onShow();await app.loginTask;assert.equal(app.globalData.role,'guest');assert.equal(redirects[redirects.length-1],'/pages/guest/index');
  initialize();app.applyRole('guest',app.globalData.sessionEpoch);assert.equal(redirects[redirects.length-1],'/pages/guest/index');
  initialize();app.applyRole('admin',app.globalData.sessionEpoch);assert.equal(redirects[redirects.length-1],'/pages/bindings/index');
  initialize();wx.request=opts=>opts.success({statusCode:403,data:{success:false}});await assert.rejects(()=>app.refreshRole(),e=>e.status===403);assert.equal(app.globalData.session,null);assert.equal(redirects[redirects.length-1],'/pages/guest/index');
  assert.equal(ui.home(null),'/pages/guest/index');
  const guestMarkup=require('fs').readFileSync(require('path').join(__dirname,'../pages/guest/index.wxml'),'utf8');assert(!guestMarkup.includes('role-tabs'));assert(guestMarkup.includes('bindtap="certify"'));assert(guestMarkup.includes('面向乡村留守儿童帮扶志愿者'));
  console.log('PASS: logout成功/断网回游客、401/clearSession回游客、登录竞态与旧401隔离、同角色token刷新迟到401隔离、列表清理、403/前台角色降级、applyRole正确首页、guest独立介绍与认证');
 }finally{Object.assign(config,original);wx.request=saved.request;wx.login=saved.login;wx.reLaunch=saved.reLaunch;wx.switchTab=saved.switchTab;global.getCurrentPages=saved.pages;}
};
