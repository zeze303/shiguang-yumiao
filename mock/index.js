const config=require('../config');
const seed=require('./data');
let db; function reset(){db=JSON.parse(JSON.stringify(seed));} reset();
function fail(message,status){const e=new Error(message);e.status=status;throw e;}
function visible(token){if(!token)fail('登录已过期，请重新登录',401);return config.mockRole==='admin'?db.students:db.students.filter(s=>s.volunteer_id==='v1');}
function dispatch(path,{method,data,token}){
 if(path==='/login')return {token:'mock-'+config.mockRole,role:config.mockRole,profile:config.mockRole==='admin'?{id:'admin',name:'青溪项目管理',org:'青溪志愿服务队'}:{id:'v1',name:'林知夏',org:'青溪志愿服务队'}};
 const students=visible(token);const allowed=id=>{const s=students.find(x=>x.id===id);if(!s)fail('当前没有查看权限',403);return s;};
 if(path.startsWith('/admin/')&&config.mockRole!=='admin')fail('当前没有管理权限',403);
 if(config.mockState==='error')fail('演示网络暂时中断，请检查连接后重试',503);
 if(config.mockState==='empty'){
   if(path==='/admin/overview')return {student_count:0,volunteer_count:0,average_score:null,alert_count:0,distribution:[],alerts:[],unpaired_count:0,period:''};
   if(path==='/ai/suggest')return null;
   if(method==='GET'&&path.split('/').filter(Boolean).length !== 2)return [];
 }
 if(path==='/students'||path==='/admin/students')return students;
 const parts=path.split('/'); const match=parts[1]==='students' && parts[2] && (parts.length===3 || parts.length===4 && parts[3]==='records') ? [path,parts[2],parts[3]] : null;
 if(match){const id=decodeURIComponent(match[1]);const s=allowed(id);if(!match[2])return s;return db.records[id].map((a,i)=>({id:id+'-'+i,student_id:id,period:'2026-'+String(i+7).padStart(2,'0'),psychology:a[0],aesthetic:a[1],finance:a[2],behavior:a[3]})).reverse();}
 if(path==='/poems')return db.poems.filter(p=>students.some(s=>s.id===p.student_id)&&(!data.student_id||p.student_id===data.student_id));
 if(path==='/logout'&&method==='POST')return null;
 if(path==='/companion-logs'){
  if(method==='POST'){
   if(config.mockRole!=='volunteer')fail('管理角色不能提交志愿者记录',403);
   data={...data,student_id:data.studentId || data.student_id};const s=allowed(data.student_id);if(!['探访','通话','活动','其他'].includes(data.type)||typeof data.content!=='string'||data.content.trim().length<10||data.content.length>1000||!Array.isArray(data.images)||data.images.length>3)fail('请核对陪伴方式、正文与图片数量',400);
   const log={...data,id:'l'+Date.now(),student_name:s.name,volunteer_name:'林知夏',created_at:new Date().toISOString()};db.logs.unshift(log);s.last=log.created_at.slice(5,10).replace('-','.');return log;
  }
  return db.logs.filter(l=>students.some(s=>s.id===l.student_id)&&(!data.student_id||l.student_id===data.student_id));
 }
 if(path==='/ai/suggest'){const child=allowed(data.studentId);return {status:child.name+'在近期观察中展现了自己的兴趣。可以用开放的问题了解感受，从愿意参与的活动开始，记录具体的表达与尝试。',sourcePeriod:child.period,openers:['这周有没有哪件小事，让你觉得开心？如果不想说，我们也可以先一起画下来。'],activities:['秋叶拼贴：15 分钟，落叶、纸、胶棒。让孩子自己选叶片，拼出今天的心情。','三件小小的好事：10 分钟，纸和彩笔。各自画出这周开心的小事，不比较多少。','故事接一接：15 分钟，一本绘本。轮流添一句话，可以讲述、画画或只听。'],cautions:['不要把分数当作孩子的评价。少用“你应该”，多问“你愿意吗”。','持续明显变化请与组织负责人、监护人或老师共同跟进。']};}
 if(path==='/ai/poem'){const s=allowed(data.studentId);if(!db.records[s.id].some((r,i)=>'2026-'+String(i+7).padStart(2,'0')===data.period))fail('该周期暂无成长观察',400);const poem={...seed.poems[0],id:'p'+Date.now(),student_id:s.id,student_name:s.name,period:data.period,created_at:new Date().toISOString()};db.poems.unshift(poem);return poem;}
 if(path==='/admin/volunteers')return db.volunteers;
 if(path==='/admin/relations')return db.students.filter(s=>s.volunteer_id).map(s=>({id:'r-'+s.id,student_id:s.id,volunteer_id:s.volunteer_id}));
 const fields=['psychology','aesthetic','finance','behavior'];const urgent=db.students.filter(s=>fields.some(k=>s[k]<60));
 if(path==='/admin/alerts')return urgent;
 if(path==='/admin/overview')return {student_count:5,volunteer_count:3,average_score:72,alert_count:2,period:'2026-10',unpaired_count:1,alerts:urgent,distribution:[{label:'优秀',count:2,color:'#2d7d46'},{label:'关注',count:2,color:'#d4a74a'},{label:'预警',count:1,color:'#c0392b'},{label:'高危',count:0,color:'#8b1a1a'}]};
 fail('该能力尚未开放',404);
}
module.exports={reset,request(path,options){return new Promise((resolve,reject)=>setTimeout(()=>{try{resolve(JSON.parse(JSON.stringify(dispatch(path,options))));}catch(e){reject(e);}},config.mockDelay));}};
