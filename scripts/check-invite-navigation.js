const assert=require('assert');
module.exports=async function checkInviteNavigation(){
 const app=getApp(),ui=require('../utils/page'),api=require('../utils/api'),config=require('../config');
 const original={...config},saved={pages:global.getCurrentPages,request:wx.request,login:wx.login,reLaunch:wx.reLaunch,switchTab:wx.switchTab};
 let definition;global.Page=d=>definition=d;const file=require.resolve('../pages/invite-codes/index');delete require.cache[file];require(file);
 const makePage=()=>({...definition,route:'pages/invite-codes/index',data:{...definition.data},setData(v){Object.assign(this.data,v);},getTabBar(){throw new Error('非tab页不允许访问tabBar');},selectComponent(){return null;}});
 let pages=[],moves=[];
 global.getCurrentPages=()=>pages;
 wx.reLaunch=opts=>{moves.push(opts);};wx.switchTab=opts=>{moves.push(opts);};
 config.useMock=false;config.baseURL='https://example.test/api/app';config.timeout=25;
 wx.login=opts=>opts.success({code:'code'});
 const setup=()=>{pages=[];app.clearSession();app.globalData.session={token:'admin-token',role:'admin',profile:{id:'admin'}};app.globalData.role='admin';app.globalData.profile=app.globalData.session.profile;app.globalData.loginRequired=false;wx.setStorageSync('shiguang-token','admin-token');moves=[];};
 try{
  setup();let loginCallback;let lists=0;
  wx.request=opts=>{if(opts.url.endsWith('/login'))loginCallback=opts;else{lists++;opts.success({statusCode:200,data:{success:true,data:[]}});}};
  const refresh=app.refreshRole();await new Promise(resolve=>setImmediate(resolve));
  const p=makePage();pages=[p];let guarded=false;const guard=ui.guard(p,['admin']).then(r=>{guarded=true;return r;});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(guarded,false,'守卫必须等待在途角色刷新，不能使用缓存admin');
  loginCallback.success({statusCode:200,data:{success:true,data:{token:'guest-token',role:'guest',profile:{id:'admin'}}}});await refresh;assert.equal(await guard,false);assert.equal(lists,0);assert.equal(moves.length,1,'角色变化和守卫不得重复跳转');moves[0].complete&&moves[0].complete();
  setup();const page=makePage();pages=[page];let gets=0;
  wx.request=opts=>{gets++;opts.success({statusCode:200,data:{success:true,data:[]}});};
  await page.load();assert.equal(page.data.status,'empty','admin非tab页必须完成列表加载');assert.equal(gets,1);assert.equal(moves.length,0);
  let creates=0,revokes=0;const list=[{id:'i1',code:'DEMO',targetRole:'volunteer',status:'active',createdAt:'2026-10-01'}];
  wx.request=opts=>{if(opts.method==='POST'&&opts.url.endsWith('/revoke')){revokes++;list[0].status='revoked';opts.success({statusCode:200,data:{success:true,data:list[0]}});}else if(opts.method==='POST'){creates++;opts.success({statusCode:200,data:{success:true,data:{id:'i2',code:'NEW',targetRole:'admin',status:'active'}}});}else{gets++;opts.success({statusCode:200,data:{success:true,data:list}});}};
  await Promise.all([page.load(),page.load()]);assert.equal(gets,2,'并发刷新只发一次列表请求');assert.equal(page.data.status,'ready');await page.create('admin','7');await page.confirmRevoke('i1');assert.equal(creates,1);assert.equal(revokes,1);assert.equal(page.data.items[0].state,'revoked');assert.equal(page.data.busy,false);assert.equal(moves.length,0);
  wx.request=opts=>opts.success({statusCode:404,data:{success:false,message:'未部署邀请码路由'}});await page.load();assert.equal(page.data.status,'error');assert(page.data.error.includes('未部署'));assert.equal(moves.length,0);
  // wx.request没有任何回调也必须有限结束，禁止加载永远挂起。
  wx.request=()=>({abort(){}});await Promise.race([page.load(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('邀请码列表永久挂起')),250))]);assert.equal(page.data.status,'error');assert.equal(page.loading,false);
  setup();pages=[makePage()];app.clearSession();ui.toGuest();ui.authError(pages[0],Object.assign(new Error('expired'),{status:401}));assert.equal(moves.length,1,'clearSession/toGuest/authError同时触发只能跳一次');moves[0].complete&&moves[0].complete();
  console.log('PASS: 邀请码页等待角色刷新、非tab安全加载、生成/作废/刷新、404/无回调超时错误态、导航防重入');
 }finally{Object.assign(config,original);global.getCurrentPages=saved.pages;wx.request=saved.request;wx.login=saved.login;wx.reLaunch=saved.reLaunch;wx.switchTab=saved.switchTab;}
};
if(require.main===module){const store={};global.wx={getStorageSync:k=>store[k],setStorageSync:(k,v)=>store[k]=v,removeStorageSync:k=>delete store[k]};let app;global.App=d=>app=d;require('../app');global.getApp=()=>app;global.getCurrentPages=()=>[];module.exports().catch(e=>{console.error(e);process.exitCode=1;});}
