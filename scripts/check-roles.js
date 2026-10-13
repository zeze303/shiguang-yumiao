const assert=require('assert');
module.exports=async function checkRoles(){
 const config=require('../config'),api=require('../utils/api'),ui=require('../utils/page'),app=getApp();const original={...config},oldSwitch=wx.switchTab,oldLaunch=wx.reLaunch,oldRequest=wx.request,oldPages=global.getCurrentPages;
 let destinations=[];global.getCurrentPages=()=>[{route:'pages/invite-codes/index'}];wx.switchTab=o=>destinations.push(o.url);wx.reLaunch=o=>destinations.push(o.url);
 try{
  app.clearSession();config.useMock=true;config.mockRole='guest';config.mockDelay=0;config.mockState='normal';
  const session=await app.ensureSession();assert.equal(session.role,'guest');
  const overview=await api.publicOverview();assert.equal(overview.student_count,5);assert.equal(overview.school_count,2);assert.equal(overview.record_count,20);assert(overview.suppressed);assert.equal(overview.average_scores,null);assert.equal(overview.level_distribution,null);assert.equal(overview.items,undefined);
  await assert.rejects(()=>api.students(),e=>e.status===403);await assert.rejects(()=>api.inviteCodes(),e=>e.status===403);
  const page={data:{},setData(v){Object.assign(this.data,v);}};assert.equal(await ui.guard(page),false);assert.equal(destinations.pop(),'/pages/guest/index');
  await assert.rejects(()=>api.redeem('BAD-CODE'),e=>e.status===400);await assert.rejects(()=>api.redeem('DEMO-EXPIRED'),e=>e.status===400);await assert.rejects(()=>api.redeem('DEMO-USED'),e=>e.status===400);
  const epoch=app.globalData.sessionEpoch,result=await api.redeem(' DEMO-VOLUNTEER ');app.applyRole(result.role,epoch);assert.equal(app.globalData.role,'volunteer');assert.equal(app.globalData.session.role,'volunteer');assert.equal((await api.students()).length,2);ui.enter('volunteer');assert.equal(destinations.pop(),'/pages/bindings/index');await assert.rejects(()=>api.redeem('DEMO-VOLUNTEER'),e=>e.status===400);
  const admin=await api.redeem('DEMO-ADMIN');app.applyRole(admin.role,app.globalData.sessionEpoch);assert.equal(app.globalData.role,'admin');
  const code=await api.createInviteCode({targetRole:'admin',expiresInDays:7});assert.equal(code.target_role,'admin');assert(code.expires_at);assert.equal((await api.inviteCodes()).find(i=>i.id===code.id).status,'active');await assert.rejects(()=>api.redeem(code.code),e=>e.status===409);assert.equal((await api.inviteCodes()).find(i=>i.id===code.id).status,'active');await api.revokeInviteCode(code.id);assert.equal((await api.inviteCodes()).find(i=>i.id===code.id).status,'revoked');
  config.useMock=false;config.baseURL='https://example.test/api/app';let seen;
  wx.request=opts=>{seen=opts;opts.success({statusCode:200,data:{success:true,data:{studentCount:0,schoolCount:0,recordCount:0,averageScores:{psychology:80},levelDistribution:{优秀:1},suppressed:true}}});};const hidden=await api.publicOverview();assert.equal(seen.header.Authorization,undefined);assert.equal(hidden.average_scores,null);assert.equal(hidden.level_distribution,null);
  wx.request=opts=>{seen=opts;opts.success({statusCode:200,data:{success:true,data:{id:'c1',code:'ABCD',targetRole:'volunteer',createdAt:'2026-10-01',expiresAt:null,usedAt:null,status:'active'}}});};const real=await api.createInviteCode({targetRole:'volunteer'});assert.equal(seen.method,'POST');assert.equal(seen.data.targetRole,'volunteer');assert.equal(real.target_role,'volunteer');assert.equal(real.created_at,'2026-10-01');await api.revokeInviteCode('c1');assert(seen.url.endsWith('/admin/invite-codes/c1/revoke'));
  console.log('PASS: guest公开脱敏/评分抑制/业务拦截、邀请码无效过期已用同级、认证升级与导航、admin生成列表作废、camelCase邀请码适配');
 }finally{Object.assign(config,original);wx.switchTab=oldSwitch;wx.reLaunch=oldLaunch;wx.request=oldRequest;global.getCurrentPages=oldPages;app.clearSession();}
};
