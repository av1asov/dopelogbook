const {chromium}=require('playwright');
const D=[[440,956,3],[420,912,3],[402,874,3],[430,932,3],[393,852,3],[428,926,3],[390,844,3],[375,812,3],[414,896,3],[414,896,2],[375,667,2],[414,736,3]];
(async()=>{const b=await chromium.launch();
for(const [w,h,r] of D) for(const t of ['dark','light']){
 const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:r});
 await p.goto('file://'+__dirname+'/splash.html?t='+t);await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(300);
 await p.screenshot({path:`${__dirname}/../../public/splash/splash-${w*r}x${h*r}-${t}.png`});await p.close();}
await b.close()})()
