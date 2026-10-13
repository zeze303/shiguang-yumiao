const colors = ['#6b4c8a','#c0392b','#d4a74a','#2d7d46'];
const fields = ['psychology','aesthetic','finance','behavior'];
function context(item) {
  if (!item || !item.node) return null;
  const ratio = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio;
  const canvas=item.node, ctx=canvas.getContext('2d');
  canvas.width=item.width*ratio; canvas.height=item.height*ratio; ctx.scale(ratio,ratio);
  return {ctx,w:item.width,h:item.height};
}
function draw(page) {
  wx.nextTick(() => {
    if (!page.data.student) return;
    const q=wx.createSelectorQuery().in(page);
    q.select('#radar').fields({node:true,size:true});
    q.select('#trend').fields({node:true,size:true});
    q.exec(items => {
      const radar=context(items[0]);
      if (radar && page.data.student.hasScores) {
        const {ctx,w,h}=radar,cx=w/2,cy=h/2,r=Math.min(w,h)*.34;
        const point=(i,v)=>[cx+Math.sin(i*Math.PI/2)*r*v/100,cy-Math.cos(i*Math.PI/2)*r*v/100];
        const polygon=values=>{ctx.beginPath();values.forEach((v,i)=>{const p=point(i,v);i?ctx.lineTo(...p):ctx.moveTo(...p);});ctx.closePath();};
        ctx.strokeStyle='rgba(44,24,16,.12)';ctx.lineWidth=.8;
        [20,40,60,80,100].forEach(v=>{polygon([v,v,v,v]);ctx.stroke();});
        [0,1,2,3].forEach(i=>{ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(...point(i,100));ctx.stroke();});
        polygon(page.data.student.scores);ctx.fillStyle='rgba(192,57,43,.1)';ctx.fill();ctx.strokeStyle='#c0392b';ctx.lineWidth=1.8;ctx.stroke();
        page.data.student.scores.forEach((v,i)=>{const p=point(i,v);ctx.beginPath();ctx.arc(p[0],p[1],3.3,0,Math.PI*2);ctx.fillStyle=colors[i];ctx.fill();});
      }
      const trend=context(items[1]); if (!trend) return;
      const {ctx,w,h}=trend,records=page.data.records,dim=page.data.dimension,key=fields[dim];
      const x=i=>35+i*(w-60)/Math.max(records.length-1,1),y=v=>h-25-v*(h-45)/100;
      ctx.font='10px sans-serif';ctx.fillStyle='#6c5d56';ctx.lineWidth=.8;
      [0,50,100].forEach(v=>{ctx.strokeStyle='rgba(44,24,16,.12)';ctx.beginPath();ctx.moveTo(35,y(v));ctx.lineTo(w-15,y(v));ctx.stroke();ctx.fillText(String(v),8,y(v)+4);});
      let previous=null; page.chartPoints=[];
      records.forEach((record,i)=>{
        ctx.fillStyle='#6c5d56';ctx.textAlign='center';ctx.fillText(record.period.slice(5)+'月',x(i),h-5);
        const v=record[key];if(typeof v!=='number'||v<0||v>100){previous=null;return;}
        const p={x:x(i),y:y(v),index:i};page.chartPoints.push(p);
        // 缺失周期断线，不补零。财商加深色外描边。
        const consecutive=previous && (new Date(record.period+'-01')-new Date(previous.period+'-01'))<32*86400000;
        if(consecutive){const line=(color,width)=>{ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(previous.x,previous.y);ctx.lineTo(p.x,p.y);ctx.stroke();};if(dim===2)line('#2c1810',3.8);line(colors[dim],2.4);}
        ctx.strokeStyle=dim===2?'#2c1810':colors[dim];ctx.lineWidth=2;ctx.fillStyle='#fdf8f0';ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fill();ctx.stroke();previous={...p,period:record.period};
      });
    });
  });
}
function hit(page,x,y){const p=(page.chartPoints||[]).find(p=>Math.hypot(p.x-x,p.y-y)<=22);return p?p.index:null;}
module.exports={draw,hit};
