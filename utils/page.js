function errorMessage(err) { return err && err.message || '暂时没能加载出来，请检查连接后重试'; }
function home(role) { return '/pages/' + (['volunteer','admin'].includes(role) ? 'bindings' : 'guest') + '/index'; }
const empty = {items:[],filtered:[],children:[],records:[],logs:[],poems:[],metrics:[],counts:[0,0,0],menus:[],helpMenus:[],images:[],periods:[],trend:[],student:null,poem:null,item:null,suggestion:null,advice:null,overview:null,basis:null,invite:null,code:'',codes:[],result:null,profile:null,role:null,content:'',studentId:null,initial:'',urgentCount:0,trendText:'',pointNote:'',query:'',filter:'all',error:'',aiError:'',recordsError:'',logsError:'',poemsError:''};
function clearPage(page,message) {
  if(!page || !page.setData)return;
  const data={status:'error',error:message};
  for(const key of Object.keys(empty))if(page.data && Object.prototype.hasOwnProperty.call(page.data,key))data[key]=empty[key];
  data.error=message;
  page.setData(data);
  page.accountKey=undefined;
}
function clearAccountPages(message) {
  const pages=typeof getCurrentPages==='function'?getCurrentPages():[];
  pages.forEach(page=>clearPage(page,message));
}
let navigationLock={url:'',epoch:-1,at:0};
function navigateHome(role){
  const url=home(role),now=Date.now(),epoch=getApp().globalData.sessionEpoch;
  const pages=typeof getCurrentPages==='function'?getCurrentPages():[];
  if(!pages.length || '/'+pages[pages.length-1].route===url)return false;
  if(navigationLock.url===url&&navigationLock.epoch===epoch&&now-navigationLock.at<1000)return false;
  navigationLock={url,epoch,at:now};
  (['volunteer','admin'].includes(role)?wx.switchTab:wx.reLaunch)({url,fail:()=>{if(navigationLock.url===url&&navigationLock.epoch===epoch)navigationLock={url:'',epoch:-1,at:0};}});
  return true;
}
function toGuest(){return navigateHome('guest');}
function authError(page,err) {
  if(!err || ![401,403].includes(err.status))return false;
  if(err.code==='STALE_SESSION'){return true;}
  if(err.status===401){
    const app=getApp();if(!app.globalData.loginRequired)app.clearSession();
    clearPage(page,'登录已过期，请重新登录');toGuest();
  }else clearPage(page,'当前访问权限已失效，结对范围可能已变更，请重新加载或返回列表。');
  return true;
}
function temporaryError(err){return !err.status || err.status>=500 || err.status===408 || err.status===429;}
async function guard(page,roles=['volunteer','admin']) {
  const app=getApp();
  if(app.globalData.loginRequired){clearPage(page,'请重新登录后查看授权范围的数据');toGuest();return false;}
  try {
    const session=await app.ensureSession();
    if(!roles.includes(session.role)){if(page._guardRedirecting)return false;page._guardRedirecting=true;clearPage(page,'当前身份没有访问权限');navigateHome(session.role);return false;}
    const accountKey=session.profile && session.profile.id;
    if((page.accountKey!==undefined && page.accountKey!==accountKey) || (page.sessionEpoch!==undefined && page.sessionEpoch!==app.globalData.sessionEpoch))clearPage(page,'');
    page._guardRedirecting=false;page.sessionEpoch=app.globalData.sessionEpoch;page.accountKey=accountKey;page.setData({role:session.role,profile:session.profile});syncTab(page);return true;
  }catch(err){if(!authError(page,err))page.setData({status:'error',error:errorMessage(err)});return false;}
}
function enter(role){return navigateHome(role);}
function syncTab(page){try{const tab=page.getTabBar&&page.getTabBar();if(tab&&typeof tab.sync==='function')tab.sync();}catch(_){}try{const inline=page.selectComponent&&page.selectComponent('role-tabs');if(inline&&typeof inline.sync==='function')inline.sync();}catch(_){} }
function navigate(name,params={}) {wx.navigateTo({url:'/pages/'+name+'/index?'+Object.keys(params).map(k=>k+'='+encodeURIComponent(params[k])).join('&')});}
function info(title,content) {wx.showModal({title,content,showCancel:false,confirmText:'知道了'});}
module.exports={guard,syncTab,errorMessage,navigate,info,home,enter,authError,clearPage,clearAccountPages,temporaryError,toGuest};
