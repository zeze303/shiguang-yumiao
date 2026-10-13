// 运行 node scripts/check-frontend.js；只读检查，不依赖 npm。
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const appConfig=JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8'));
const files=[];
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(['backend','design','.git','node_modules'].includes(entry.name))continue;const p=path.join(dir,entry.name);entry.isDirectory()?walk(p):files.push(p);}}
walk(root);
for(const file of files){const content=fs.readFileSync(file,'utf8');if(file.endsWith('.js'))new vm.Script(content,{filename:file});if(file.endsWith('.json'))JSON.parse(content);if(/\.(js|wxml|wxss|svg)$/.test(file))assert(!/\p{Extended_Pictographic}/u.test(content),'禁止 emoji: '+file);}
assert(appConfig.tabBar.list.length>=2&&appConfig.tabBar.list.length<=5,'微信 tabBar 配置必须为2–5项');
const store={};global.wx={getStorageSync:k=>store[k],setStorageSync:(k,v)=>store[k]=v,removeStorageSync:k=>delete store[k],showLoading(){},hideLoading(){},getWindowInfo:()=>({pixelRatio:2})};
let app;global.App=obj=>app=obj;require('../app');global.getApp=()=>app;global.getCurrentPages=()=>[];
for(const route of appConfig.pages){for(const extension of ['js','json','wxml','wxss'])assert(fs.existsSync(path.join(root,route+'.'+extension)),route+'.'+extension+' 缺失');
 let definition;global.Page=obj=>definition=obj;require(path.join(root,route+'.js'));
 const html=fs.readFileSync(path.join(root,route+'.wxml'),'utf8');assert(html.includes('state-view'),route+' 没有状态组件');
 for(const match of html.matchAll(/(?:bind|catch)(?::)?(?:tap|input|change|error|touchend|retry|action|open)="([A-Za-z]\w*)"/g))assert(typeof definition[match[1]]==='function',route+' 事件方法不存在: '+match[1]);
 for(const match of html.matchAll(/src="(\/[^"{}]+)"/g))assert(fs.existsSync(path.join(root,match[1])),route+' 资源缺失: '+match[1]);
 // 验证标签结构，先删除模板表达式，避免比较运算符误判成标签。
 const markup=html.replace(/{{[\s\S]*?}}/g,'');const stack=[];
 for(const match of markup.matchAll(/<\/?([a-z][\w-]*)\b[^>]*>/g)){const token=match[0],tag=match[1];if(token.startsWith('</'))assert.strictEqual(stack.pop(),tag,route+' 标签未闭合 '+tag);else if(!token.endsWith('/>'))stack.push(tag);}
 assert(!stack.length,route+' 未闭合标签 '+stack.join(','));
}
for(const [name,route] of Object.entries(appConfig.usingComponents)){for(const ext of ['js','json','wxml','wxss'])assert(fs.existsSync(path.join(root,route+'.'+ext)),name+' 组件文件缺失');}
const project=JSON.parse(fs.readFileSync(path.join(root,'project.config.json'),'utf8'));assert.strictEqual(project.appid,'wxcc4fb5516852d560');
async function behavior(){
 const config=require('../config'),api=require('../utils/api'),mock=require('../mock');const original={...config};config.useMock=true;config.mockDelay=0;config.mockRole='volunteer';config.mockState='normal';
 const session=await app.ensureSession();assert.equal(session.role,'volunteer');assert.equal((await api.students()).length,2);await assert.rejects(()=>api.student('d'),e=>e.status===403);await assert.rejects(()=>api.adminStudents(),e=>e.status===403);
 const child=await api.student('a');assert.equal(child.total,71);assert(child.urgent);assert.equal((await api.records('a')).length,4);
 const log=await api.createLog({student_id:'a',type:'活动',content:'我们一起画了一幅画，孩子主动分享了今天的心情。',images:[]});assert.equal((await api.logs('a'))[0].id,log.id);
 await assert.rejects(()=>api.createLog({student_id:'a',type:'活动',content:'短',images:[]}));
 const poem=await api.generatePoem({studentId:'a',period:'2026-10'});assert.equal((await api.poems('a'))[0].id,poem.id);await assert.rejects(()=>api.generatePoem({studentId:'a',period:'2025-01'}));
 config.mockState='empty';assert.deepEqual(await api.students(),[]);assert.deepEqual(await api.logs(),[]);assert.deepEqual(await api.records('a'),[]);config.mockState='error';await assert.rejects(()=>api.poems(),e=>e.status===503);
 config.mockState='normal';app.clearSession();config.mockRole='admin';await app.ensureSession();assert.equal((await api.adminStudents()).length,5);const o=await api.overview();assert.equal(o.distribution.reduce((n,d)=>n+d.count,0),o.student_count);assert.equal(o.alert_count,2);
 // 真实传输契约：完整基址、Bearer、请求字段、401/403、业务错误。
 config.useMock=false;config.baseURL='https://example.test/api/app/';store['shiguang-token']='test-token';const request=require('../utils/request');let seen;
 wx.request=opts=>{seen=opts;opts.success({statusCode:200,data:{success:true,data:{ok:true}}});};assert.deepEqual(await request('/ai/poem',{method:'POST',data:{studentId:'a',period:'2026-10'}}),{ok:true});assert.equal(seen.url,'https://example.test/api/app/ai/poem');assert.equal(seen.header.Authorization,'Bearer test-token');assert.equal(seen.data.studentId,'a');
 wx.request=opts=>opts.success({statusCode:403,data:{success:false}});await assert.rejects(()=>request('/students'),e=>e.status===403);
 wx.request=opts=>opts.success({statusCode:200,data:{success:false,message:'审核未通过'}});await assert.rejects(()=>request('/students'),/审核未通过/);
 wx.request=opts=>opts.success({statusCode:401,data:{success:false}});await assert.rejects(()=>request('/students'),e=>e.status===401);assert.equal(app.globalData.session,null);assert(!store['shiguang-token']);
 const {wrap}=require('../utils/share');const lines=wrap({measureText:t=>({width:Array.from(t).length*10})},'很长的诗句需要换行\n\n尾行',40);assert.deepEqual(lines,['很长的诗','句需要换','行','','尾行']);
 await require('./check-fields')();await require('./check-session')();await require('./check-roles')();await require('./check-invite-navigation')();await require('./check-idempotency')();await require('./check-text-only')();
 Object.assign(config,original);mock.reset();console.log('PASS: '+appConfig.pages.length+' 页四件套、JS/JSON语法、WXML标签/事件、组件与静态资源、无emoji、角色权限、记录提交、诗歌生成、三态、真实请求契约、长诗换行');
}
behavior().catch(e=>{console.error(e);process.exitCode=1;});
