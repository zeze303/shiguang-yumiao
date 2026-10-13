const assert=require('assert');
module.exports=async function checkSession(){
 const app=getApp(),config=require('../config'),api=require('../utils/api'),ui=require('../utils/page');const original={...config};
 const saved={request:wx.request,login:wx.login,reLaunch:wx.reLaunch,pages:global.getCurrentPages};
 const makePage=(name,data)=>{let definition;global.Page=value=>definition=value;const file=require.resolve('../pages/'+name+'/index');delete require.cache[file];require(file);return {...definition,data:{...definition.data,...data},route:'pages/'+name+'/index',setData(next){Object.assign(this.data,next);}};};
 let pages=[],redirects=[];global.getCurrentPages=()=>pages;wx.reLaunch=opts=>redirects.push(opts.url);
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
  profile.logout();await new Promise(resolve=>setImmediate(resolve));assert.equal(profile.data.error,'本机已退出，服务器会话撤销未确认');wx.showModal=oldModal;
  // 登录已经发出，退出后旧结果到达不能写回。新登录也不能被旧task.finally移除。
  pages=[];app.clearSession();let pending=[];wx.request=opts=>{if(opts.url.endsWith('/login'))pending.push(opts);else opts.success({statusCode:200,data:{success:true,data:null}});};
  const oldLogin=app.ensureSession();const rejected=assert.rejects(oldLogin,e=>e.code==='STALE_SESSION');await new Promise(resolve=>setImmediate(resolve));assert.equal(pending.length,1);
  await app.logout();const newLogin=app.ensureSession();await new Promise(resolve=>setImmediate(resolve));assert.equal(pending.length,2);
  pending[0].success({statusCode:200,data:{success:true,data:{token:'old-token',role:'volunteer',profile:{id:'old'}}}});await rejected;assert.equal(app.loginTask,newLogin);assert(!wx.getStorageSync('shiguang-token'));
  pending[1].success({statusCode:200,data:{success:true,data:{token:'new-token',role:'volunteer',profile:{id:'new'}}}});await newLogin;assert.equal(wx.getStorageSync('shiguang-token'),'new-token');
  // 迟到的旧401也不得使新账号退出。
  let previousRequest;wx.request=opts=>previousRequest=opts;const oldCall=api.students();const stale=assert.rejects(oldCall,e=>e.code==='STALE_SESSION');app.clearSession();Object.assign(app.globalData,{session:{token:'latest',role:'volunteer',profile:{id:'latest'}},loginRequired:false});wx.setStorageSync('shiguang-token','latest');previousRequest.success({statusCode:401,data:{success:false}});await stale;assert.equal(wx.getStorageSync('shiguang-token'),'latest');
  const error=Object.assign(new Error('expired'),{status:401});
  for(const name of ['bindings','logs','poems','students','volunteers','pairing']){
   initialize();if(['students','volunteers'].includes(name)){app.globalData.session.role='admin';app.globalData.role='admin';}const page=makePage(name,{status:'ready',items:[{id:'old',name:'旧数据'}],filtered:[{id:'old'}],children:[{id:'old'}]});pages=[page];
   wx.request=opts=>opts.success({statusCode:403,data:{success:false}});await page.load();assert.equal(page.data.status,'error',name+' 403状态');assert.deepEqual(page.data.items,[],name+' 403清数据');assert.deepEqual(page.data.filtered,[]);assert(!app.globalData.loginRequired,'403不能清整个会话');
   initialize();if(['students','volunteers'].includes(name)){app.globalData.session.role='admin';app.globalData.role='admin';}page.sessionEpoch=app.globalData.sessionEpoch;page.setData({items:[{id:'old'}],filtered:[{id:'old'}],status:'ready'});wx.request=opts=>opts.fail({errMsg:'network error'});await page.load();assert.equal(page.data.status,'ready',name+' 网络失败保留内容');assert.equal(page.data.items.length,1);
  }
  initialize();const bindings=makePage('bindings',{items:[{id:'old'}],filtered:[{id:'old'}],status:'ready'});const logs=makePage('logs',{items:[{id:'old'}],filtered:[{id:'old'}]});pages=[bindings,logs];
  wx.request=opts=>opts.success({statusCode:401,data:{success:false}});await bindings.load();assert.deepEqual(bindings.data.items,[]);assert.deepEqual(logs.data.items,[]);assert(app.globalData.loginRequired);assert(redirects.includes('/pages/profile/index'));
  initialize();pages=[bindings];wx.request=opts=>opts.success({statusCode:200,data:{success:true,data:[]}});await bindings.load();assert.equal(bindings.data.status,'empty');assert.deepEqual(bindings.data.items,[]);assert.deepEqual(bindings.data.filtered,[]);
  assert.equal(ui.authError(bindings,error),true);
  console.log('PASS: logout成功/断网、本机清理与失败文案、登录epoch竞态、旧401隔离、6类列表403清理/网络保留、401账号清理与登录入口、新列表替换');
 }finally{Object.assign(config,original);wx.request=saved.request;wx.login=saved.login;wx.reLaunch=saved.reLaunch;global.getCurrentPages=saved.pages;}
};
