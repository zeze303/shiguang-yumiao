const volunteer=[['bindings','sprout','我的结对'],['poems','book','成长诗'],['logs','pencil','记录'],['profile','user','我的']];
const admin=[['overview','grid','总览'],['students','sprout','孩子'],['volunteers','users','志愿者'],['profile','user','我的']];
Component({data:{items:[],selected:''},lifetimes:{attached(){this.sync();}},methods:{
 sync(){const pages=getCurrentPages();const route=pages.length?pages[pages.length-1].route:'';const role=getApp().globalData.role;this.setData({items:(role==='admin'?admin:volunteer).map(([name,icon,text])=>({name,icon,text,url:'/pages/'+name+'/index'})),selected:'/'+route});},
 change(e){const url=e.currentTarget.dataset.url;if(url!==this.data.selected){ if(getApp().globalData.role==='admin' && !url.includes('/profile/')) wx.reLaunch({url}); else wx.switchTab({url}); }}
}});
