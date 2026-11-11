const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const rule = (file, selector) => {
  const text = read(file), start = text.indexOf(selector + ' {');
  assert(start >= 0, '规则缺失：' + selector);
  return text.slice(start, text.indexOf('}', start) + 1);
};
module.exports = async function checkUiDetails() {
  for (const [page, icon] of [['logs', 'plus'], ['poems', 'star']]) {
    assert(read('pages/' + page + '/index.wxml').includes(icon + '-white.svg'));
    assert(read('assets/icons/' + icon + '-white.svg').includes('stroke="#fdf8f0"'));
  }
  for (const page of ['overview','students','volunteers']) {
    assert(!read('pages/' + page + '/index.wxml').includes('阶段 1 管理骨架'));
  }
  const card = read('components/child-card/index.wxml');
  const value = rule('components/child-card/index.wxss', '.mini-value');
  for (const declaration of ['font-weight: 600','font-size: 26rpx','color: var(--text-primary)','font-variant-numeric: tabular-nums']) assert(value.includes(declaration));
  for (const selector of ['.metadata','.tag','.card-footer','.signature']) assert(rule('app.wxss',selector).includes('font-size: 24rpx'));
  assert(rule('app.wxss','.eyebrow').includes('font-size: 22rpx'));
  assert(read('pages/log-create/index.wxml').includes("type===item.name?'-active':''"));
  assert(read('pages/child-detail/index.wxml').includes('alert-active.svg'));
  assert(rule('pages/bindings/index.wxss','.art').includes('opacity: .55'));
  assert(rule('pages/bindings/index.wxss','.hero-title').includes('max-width: 380rpx'));
  assert(rule('app.wxss','.btn.compact').includes('min-height: 72rpx'));
  assert(rule('app.wxss','.btn.compact').includes('padding: 12rpx 28rpx'));
  assert(rule('pages/poems/index.wxss','.generate').includes('margin: 32rpx 0 32rpx'));
  assert(rule('pages/poems/index.wxss','.poem-cover').includes('height: 220rpx'));
  assert(read('pages/poems/index.wxml').includes('cover-brand'));
  for(const page of ['guest','bindings','overview','poem-generate','profile']) assert(!read('pages/'+page+'/index.wxml').includes(' / '));
  assert(read('pages/invite-codes/index.wxml').includes('1 至 365'));
  const profile = read('pages/profile/index.wxml');
  assert(profile.includes('拾光育苗 · 成长有迹，心自成诗 · v1.0'));
  assert(!profile.includes('拾光系'));
  assert(rule('pages/child-detail/index.wxss','.with-action').includes('200rpx'));
  assert(!read('pages/redeem/index.wxml').includes('尚未填写邀请码'));
  assert(card.includes("student.level === '预警' || student.level === '高危' ? '需跟进'"));
  const stamp=rule('pages/poem-share/index.wxss','.stamp');
  assert(stamp.includes('background: var(--brand-deep)'));
  assert(stamp.includes('color: var(--accent-gold-light)'));
  assert(rule('app.wxss','.verse').includes('32rpx/2.05'));
  assert(rule('pages/poem-share/index.wxss','.verse').includes('line-height: 2.05'));
  assert(read('app.wxss').includes('font-variant-numeric: tabular-nums'));
  assert(!read('pages/logs/index.wxml').includes('的一次{{item.type}}'));
  assert(read('pages/advice/index.wxml').includes('>{{index+1}}</view>'));
  const saved={nextTick:wx.nextTick,createSelectorQuery:wx.createSelectorQuery,getWindowInfo:wx.getWindowInfo};
  try {
    for(const width of [320,375,390,430]) {
      const canvasWidth=(width-32-32)*1, height=232, texts=[];
      const ctx={scale(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},fill(){},arc(){},measureText(text){return {width:Array.from(text).length*12};},fillText(text,x,y){texts.push({text,x,y,align:this.textAlign});}};
      const canvas={getContext:()=>ctx};
      wx.nextTick=fn=>fn();wx.getWindowInfo=()=>({pixelRatio:2,windowWidth:width});
      wx.createSelectorQuery=()=>({in(){return this;},select(){return this;},fields(){return this;},exec(fn){fn([{node:canvas,width:canvasWidth,height},null]);}});
      require('../utils/charts').draw({data:{student:{hasScores:true,scores:[58,82,65,78]},records:[],dimension:0}});
      assert.equal(texts.length,4);
      assert.equal(texts[0].x,canvasWidth/2);
      assert.equal(texts[1].x,canvasWidth/2);
      assert.equal(texts[2].align,'left');assert.equal(texts[3].align,'right');
      texts.forEach(t=>{assert(t.x>=0&&t.x<=canvasWidth);assert(t.y>=0&&t.y<=height);});
    }
  } finally {Object.assign(wx,saved);}
  console.log('PASS: 20项UI细节断言、320/375/390/430宽Canvas雷达标签位置；不代替真机视觉验收');
};
