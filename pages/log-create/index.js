const api = require('../../utils/api');
const ui = require('../../utils/page');
const config = require('../../config');
Page({
  data: {status:'loading', children:[], childIndex:0, type:'活动', content:'', images:[], busy:false, error:'', fieldError:'', types:[{name:'探访',icon:'heart'},{name:'通话',icon:'phone'},{name:'活动',icon:'leaf'},{name:'其他',icon:'pencil'}]},
  onLoad(q) {
    this.preselected = q.id;
    const draft = getApp().globalData.logDraft;
    if (draft && (!q.id || draft.studentId === q.id)) this.setData(draft);
    this.load();
  },
  async load() {
    if (!await ui.guard(this, ['volunteer'])) return;
    try {
      const children = await api.students();
      const childIndex = Math.max(0, children.findIndex(s => s.id === (this.preselected || this.data.studentId)));
      this.setData({children,childIndex,status:children.length?'ready':'empty',error:''});
    } catch(e){if(ui.authError(this,e))return; this.setData({status:'error',error:ui.errorMessage(e)}); }
  },
  child(e) { this.setData({childIndex:+e.detail.value}); this.draft(); },
  type(e) { this.setData({type:e.currentTarget.dataset.name}); this.draft(); },
  input(e) { this.setData({content:e.detail.value,fieldError:'',focus:false}); this.draft(); },
  draft() {
    if (!this.data.children.length) return;
    getApp().globalData.logDraft = {studentId:this.data.children[this.data.childIndex].id,type:this.data.type,content:this.data.content,images:this.data.images};
    if ((this.data.content || this.data.images.length) && wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({message:'内容尚未保存，草稿仅在本次登录会话中保留。'});
  },
  onUnload() { if (!this.saved) this.draft(); },
  upload() {
    if (this.data.busy || this.data.images.length >= 3) return;
    if (!config.useMock) { ui.info('图片上传尚未接通','接口文档未定义上传契约。真实模式可提交文字，不能提交本地临时图片路径。'); return; }
    wx.chooseMedia({count:3-this.data.images.length,mediaType:['image'],sizeType:['compressed'],success:r=>{
      if (r.tempFiles.some(f=>f.size>5*1024*1024)) { this.setData({error:'请选择每张不超过 5MB 的图片。'}); return; }
      this.setData({images:this.data.images.concat(r.tempFiles.map(f=>f.tempFilePath)),error:''}); this.draft();
    },fail:e=>{if (!/cancel/.test(e.errMsg||'')) this.setData({error:'图片暂时无法添加，请重试。'});}});
  },
  remove(e) { if(this.data.busy)return; this.setData({images:this.data.images.filter((_,i)=>i!==+e.currentTarget.dataset.i)}); this.draft(); },
  async submit() {
    if (this.data.busy || !this.data.children.length) return;
    if (this.data.content.trim().length < 10) { this.setData({fieldError:'请至少写下10个字的陪伴观察。',focus:true}); return; }
    if (!config.useMock && this.data.images.length) { this.setData({error:'图片上传尚未接通，请先移除演示图片。'}); return; }
    this.setData({busy:true,error:''});
    try {
      await api.createLog({student_id:this.data.children[this.data.childIndex].id,type:this.data.type,content:this.data.content.trim(),images:this.data.images});
      this.saved=true; getApp().globalData.logDraft=null; getApp().globalData.revision++;
      if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
      wx.showToast({title:'记录已保存',icon:'none'});
      wx.navigateBack({fail:()=>wx.switchTab({url:'/pages/logs/index'})});
    } catch(e){if(ui.authError(this,e))return; this.setData({error:ui.errorMessage(e)}); }
    finally { this.setData({busy:false}); }
  },
  help() { ui.info('结对说明','请联系组织管理者安排陪伴对象。'); }
});
