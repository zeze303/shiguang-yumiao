// 脱敏样例结构来自 backend/routes/app.js 与数据库实体契约；不修改/运行后端。
const assert=require('assert');
module.exports=async function checkFields(){
 const config=require('../config'),api=require('../utils/api');const original={...config};const previousRequest=wx.request;
 config.useMock=false;config.baseURL='https://example.test/api/app';
 const student={id:'s1',name:'小禾',school:'青溪小学',gradeClass:'四年级',latestRecord:{id:'rec1',studentId:'s1',period:'2026-10',psychology:58,aesthetic:82,finance:65,behavior:78,overall:71,level:'关注'},scores:{psychology:58,aesthetic:82,finance:65,behavior:78},overall:71,level:'关注',warnings:[{dimension:'心理',severity:'预警'}],hasWarning:true};
 const sample={
 '/students':[student],'/students/s1':student,'/students/s1/records':[student.latestRecord],
 '/admin/students':[student,{...student,id:'s2',name:'阿远',hasWarning:false}],
 '/admin/relations':[{id:'r1',studentId:'s1',volunteerId:'v1',createdAt:'2026-10-01'}],
 '/admin/volunteers':[{id:'v1',name:'林知夏',org:'青溪志愿服务队',relationCount:1,createdAt:'2026-10-01'}],
 '/admin/overview':{studentCount:2,volunteerCount:1,averageScore:71,alertCount:1,unscoredCount:0,levelDistribution:{优秀:0,关注:2,预警:0,高危:0}},
 '/admin/alerts':[student],
 '/poems':[{id:'p1',studentId:'s1',studentName:'小禾',title:'微光',content:'完整诗文',coverUrl:'https://example.test/cover.png',createdBy:'v1',createdAt:'2026-10-11T10:00:00Z',period:'2026-10'}],
 '/companion-logs':[{id:'l1',studentId:'s1',studentName:'小禾',volunteerId:'v1',volunteerName:'林知夏',type:'活动',content:'我们一起阅读绘本，并分享今天的心情。',images:[],createdAt:'2026-10-10T10:00:00Z'}]
 };
 const calls=[];
 wx.request=opts=>{const route=opts.url.slice(config.baseURL.length);calls.push({route,data:opts.data});assert(route in sample,'未知测试路径 '+route);opts.success({statusCode:200,data:{success:true,data:sample[route]}});};
 try{
  const children=await api.adminStudents();assert.equal(children[0].grade,'四年级');assert.equal(children[0].total,71);assert.equal(children[0].urgent,true);assert.equal(children[0].is_paired,true);assert.equal(children[1].is_paired,false);assert.equal(children.filter(s=>s.is_paired===false).length,1);
  const child=await api.student('s1');assert.equal(child.is_paired,null,'缺少明确关系时不得猜未结对');assert.equal(child.period,'2026-10');
  const record=(await api.records('s1'))[0];assert.equal(record.student_id,'s1');
  const poem=(await api.poems('s1'))[0];assert.equal(poem.student_id,'s1');assert.equal(poem.cover_url,'https://example.test/cover.png');assert.equal(poem.created_at,'2026-10-11T10:00:00Z');assert.equal(poem.created_by,'v1');
  // 真实封面相对路径须以接口origin解析，列表与生成返回共用适配。
  for(const [raw,expected] of [['/assets/generated/example.png','https://example.test/assets/generated/example.png'],['/assets/default-poem-cover.svg','https://example.test/assets/default-poem-cover.svg'],['https://cdn.example.test/cover.png','https://cdn.example.test/cover.png'],['http://localhost:9000/cover.png','http://localhost:9000/cover.png'],['',''],[null,'']]){
    sample['/poems'][0].coverUrl=raw;assert.equal((await api.poems('s1'))[0].cover_url,expected);
  }
  delete sample['/poems'][0].coverUrl;sample['/poems'][0].cover_url='/assets/generated/snake.png';assert.equal((await api.poems())[0].cover_url,'https://example.test/assets/generated/snake.png');
  sample['/ai/poem']={...sample['/poems'][0],coverUrl:'/assets/generated/new.png'};assert.equal((await api.generatePoem({studentId:'s1',period:'2026-10'})).cover_url,'https://example.test/assets/generated/new.png');
  const mock=require('../mock'),originalMockRequest=mock.request;
  try{config.useMock=true;mock.request=async()=>[{...sample['/poems'][0],coverUrl:'/assets/landscape.svg'}];assert.equal((await api.poems())[0].cover_url,'/assets/landscape.svg');}
  finally{config.useMock=false;mock.request=originalMockRequest;}
  const logs=await api.logs('s1');assert.equal(logs.filter(l=>l.student_id==='s1').length,1);assert.equal(logs[0].created_at,'2026-10-10T10:00:00Z');assert.equal(logs[0].volunteer_id,'v1');assert.equal(calls.find(c=>c.route==='/companion-logs').data.student_id,'s1');
  assert.equal((await api.volunteers())[0].relation_count,1);assert.equal((await api.relations())[0].volunteer_id,'v1');
  const overview=await api.overview();assert.equal(overview.student_count,2);assert.equal(overview.volunteer_count,1);assert.equal(overview.average_score,71);assert.equal(overview.alert_count,1);assert.equal(overview.unpaired_count,1);assert.equal(overview.distribution.find(d=>d.label==='关注').count,2);assert.equal(overview.distribution.reduce((a,d)=>a+d.count,0),2);assert.equal(overview.alerts[0].id,'s1');
  console.log('PASS: 真实 camelCase 响应样例，经API端到端适配孩子、记录、诗、志愿者、关系、总览及未结对判断、真实相对封面URL/绝对URL/空值/mock本地封面');
 }finally{Object.assign(config,original);wx.request=previousRequest;}
};
if(require.main===module){global.wx={getStorageSync:()=>''};global.getApp=()=>({globalData:{sessionEpoch:0}});module.exports().catch(e=>{console.error(e);process.exitCode=1;});}
