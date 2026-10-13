const api = require('../../utils/api');
const ui = require('../../utils/page');
const charts = require('../../utils/charts');
Page({
 data:{status:'loading',student:null,records:[],logs:[],poems:[],dimension:0,advice:null,aiBusy:false,aiError:'',recordsError:'',logsError:'',poemsError:'',pointNote:'点击节点查看周期分数 · 0–100 分'},
 onLoad(q){this.id=q.id;},
 onShow(){this.load();},
 onUnload(){this.unloaded=true;},
 async load(){
  if(!await ui.guard(this))return;
  if(!this.id){this.setData({status:'empty',error:'请从结对或孩子列表选择档案。'});return;}
  try{const student=await api.student(this.id);this.setData({student,status:'ready',error:''});charts.draw(this);await Promise.all([this.loadRecords(),this.loadLogs(),this.loadPoems(),this.loadAdvice()]);}
  catch(e){if(ui.authError(this,e))return;this.setData({status:'error',student:null,records:[],logs:[],poems:[],advice:null,error:ui.errorMessage(e)});}
 },
 async loadRecords(){try{const records=(await api.records(this.id)).sort((a,b)=>a.period.localeCompare(b.period)).slice(-4);this.setData({records,recordsError:'',trendText:this.values(records,this.data.dimension)});charts.draw(this);}catch(e){if(ui.authError(this,e))return;this.setData({recordsError:ui.errorMessage(e)});}},
 async loadLogs(){try{const logs=(await api.logs(this.id)).map(l=>({...l,date:(l.created_at||'').slice(0,10),excerpt:l.content.slice(0,60)}));this.setData({logs,logsError:''});}catch(e){if(ui.authError(this,e))return;this.setData({logsError:ui.errorMessage(e)});}},
 async loadPoems(){try{this.setData({poems:await api.poems(this.id),poemsError:''});}catch(e){if(ui.authError(this,e))return;this.setData({poemsError:ui.errorMessage(e)});}},
 async loadAdvice(){if(this.data.aiBusy)return;this.setData({aiBusy:true});try{this.setData({advice:await api.suggest(this.id),aiError:''});}catch(e){if(ui.authError(this,e))return;this.setData({aiError:ui.errorMessage(e)});}finally{this.setData({aiBusy:false});}},
 values(records,dimension){return records.map(r=>r.period+' · '+(['psychology','aesthetic','finance','behavior'].map(k=>r[k])[dimension]===null?'暂无观察':(['psychology','aesthetic','finance','behavior'].map(k=>r[k])[dimension] === undefined?'暂无观察':['psychology','aesthetic','finance','behavior'].map(k=>r[k])[dimension]+' 分'))).join(' / ');},
 dim(e){const dimension=+e.currentTarget.dataset.i;this.setData({dimension,trendText:this.values(this.data.records,dimension),pointNote:'点击节点查看周期分数 · 0–100 分'});charts.draw(this);},
 point(e){const touch=e.changedTouches&&e.changedTouches[0];if(!touch)return;const index=charts.hit(this,touch.x,touch.y);if(index!==null){const record=this.data.records[index],value=record[['psychology','aesthetic','finance','behavior'][this.data.dimension]];this.setData({pointNote:record.period+' · '+this.data.student.dimensions[this.data.dimension].label+' '+value+' 分'});}},
 advice(){ui.navigate('advice',{id:this.id});},
 log(){if(this.data.role==='volunteer')ui.navigate('log-create',{id:this.id});},
 poem(){if(this.data.poems.length)ui.navigate('poem-detail',{id:this.data.poems[0].id,studentId:this.id});else ui.navigate('poem-generate',{id:this.id});},
 logDetail(e){ui.navigate('log-detail',{id:e.currentTarget.dataset.id,studentId:this.id});},
 contact(){ui.info('跟进联系人','结对志愿者：'+(this.data.student.volunteer_name||'待分配')+'。请通过组织已授权渠道跟进，当前接口没有电话号码。');},
 back(){wx.navigateBack({fail:()=>{const role=getApp().globalData.role;(role==='admin'?wx.reLaunch:wx.switchTab)({url:ui.home(role)});}});},
 async onPullDownRefresh(){await this.load();wx.stopPullDownRefresh();}
});