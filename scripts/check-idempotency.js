const assert=require('assert');
module.exports=async function checkIdempotency(){
 const config=require('../config'),api=require('../utils/api'),ui=require('../utils/page'),app=getApp(),idempotency=require('../utils/idempotency');
 const original={...config},saved={request:wx.request,redirectTo:wx.redirectTo,guard:ui.guard,authError:ui.authError};
 const valid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
 let captured=[];config.useMock=false;config.baseURL='https://example.test/api/app';
 wx.request=opts=>{captured.push(opts);opts.success({statusCode:200,data:{success:true,data:{id:'p1',title:'光',content:'成长诗'}}});};
 const makePage=(name,data)=>{let definition;global.Page=d=>definition=d;const file=require.resolve('../pages/'+name+'/index');delete require.cache[file];require(file);return {...definition,id:'a',data:{...definition.data,...data},setData(v){Object.assign(this.data,v);}};};
 try{
  await api.suggest('a');await api.generatePoem({studentId:'a',period:'2026-10'});assert(valid.test(captured[0].header['Idempotency-Key']));assert(valid.test(captured[1].header['Idempotency-Key']));assert.notEqual(captured[0].header['Idempotency-Key'],captured[1].header['Idempotency-Key']);
  const explicit=idempotency.uuid();await api.suggest('a',explicit);await api.suggest('a',explicit);assert.equal(captured[2].header['Idempotency-Key'],explicit);assert.equal(captured[3].header['Idempotency-Key'],explicit);
  ui.guard=async()=>true;ui.authError=()=>false;
  for(const name of ['advice','child-detail']){
   const page=makePage(name),keys=[];let fail=true;
   wx.request=opts=>{if(opts.url.endsWith('/ai/suggest')){keys.push(opts.header['Idempotency-Key']);fail?opts.fail({errMsg:'network error'}):opts.success({statusCode:200,data:{success:true,data:{status:'状态',openers:['问候'],activities:[],cautions:[]}}});}else opts.success({statusCode:200,data:{success:true,data:{id:'a',name:'小禾'}}});};
   const generate=()=>name==='advice'?page.load():page.loadAdvice();
   await generate();await generate();assert.equal(keys[0],keys[1],name+'失败重试复用');fail=false;await generate();assert.equal(keys[1],keys[2]);await generate();assert.notEqual(keys[2],keys[3],name+'成功后新操作换key');
  }
  const page=makePage('poem-generate',{children:[{id:'a'}],basis:{period:'2026-10'},status:'ready'}),keys=[];let failed=true;
  wx.redirectTo=()=>{};
  wx.request=opts=>{if(opts.url.endsWith('/ai/poem')){keys.push(opts.header['Idempotency-Key']);failed?opts.fail({errMsg:'network error'}):opts.success({statusCode:200,data:{success:true,data:{id:'p1',studentId:'a',title:'光',content:'成长诗',period:'2026-10'}}});}else opts.success({statusCode:200,data:{success:true,data:[{id:'p1',studentId:'a',title:'光',content:'成长诗',period:'2026-10'}]}});};
  await page.submit();await page.submit();assert.equal(keys[0],keys[1]);failed=false;await page.submit();assert.equal(keys[1],keys[2]);await page.submit();assert.notEqual(keys[2],keys[3]);
  const scoped={};const key=idempotency.operation(scoped,'operation',{studentId:'a'});assert.equal(key,idempotency.operation(scoped,'operation',{studentId:'a'}));assert.notEqual(key,idempotency.operation(scoped,'operation',{studentId:'b'}));
  const epochKey=idempotency.operation(scoped,'operation',{studentId:'b'});const epoch=app.globalData.sessionEpoch;app.globalData.sessionEpoch++;assert.notEqual(epochKey,idempotency.operation(scoped,'operation',{studentId:'b'}));app.globalData.sessionEpoch=epoch;
  console.log('PASS: AI请求UUID v4头、显式key复用、建议/详情/诗歌失败重试同key、成功后新key、对象与会话隔离');
 }finally{Object.assign(config,original);wx.request=saved.request;wx.redirectTo=saved.redirectTo;ui.guard=saved.guard;ui.authError=saved.authError;}
};
