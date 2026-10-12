'use strict';
// DOWNBEAT web prototype – Matrix level. All timing from AudioContext.currentTime (sample-accurate scheduling).
const $=id=>document.getElementById(id);
let CFG, ctx, buf={}, gains={}, srcs=[], t0=0, BEAT, BAR, LOOP, LEAD=0;
let offsetMs=+(localStorage.downbeatOffset||0); $('off').value=offsetMs; $('offv').textContent=offsetMs+' ms';
$('off').oninput=e=>{offsetMs=+e.target.value;$('offv').textContent=offsetMs+' ms';localStorage.downbeatOffset=offsetMs};
const canOgg=(()=>{const a=document.createElement('audio');return !!a.canPlayType&&a.canPlayType('audio/ogg; codecs="vorbis"')!==''})();
const EXT=canOgg?'ogg':'m4a';
const STEMS=['calm','alert','firefight'];
function err(m){$('err').textContent+=m+' ';console.error(m)}
async function load(name){
  const r=await fetch('audio/'+name+'.'+EXT); if(!r.ok) throw new Error(name+' '+r.status);
  const ab=await r.arrayBuffer(); return await new Promise((res,rej)=>ctx.decodeAudioData(ab,res,rej));
}
async function init(){
  CFG=await (await fetch('level.json')).json();
  BEAT=60/CFG.bpm; BAR=4*BEAT; LOOP=CFG.loopSeconds;
  const AC=window.AudioContext||window.webkitAudioContext; ctx=new AC({latencyHint:'interactive'});
  // iOS unlock: play a silent buffer inside the tap handler
  const s=ctx.createBufferSource(); s.buffer=ctx.createBuffer(1,1,22050); s.connect(ctx.destination); s.start(0);
  if(ctx.state!=='running') await ctx.resume();
  const names=STEMS.map(s=>'matrix-loop-stem-'+s).concat(['matrix-bullettime','matrix-gun-t1','matrix-gun-t2','matrix-gun-t3','matrix-gun-t4']);
  let n=0; for(const nm of names){ $('load').textContent='loading '+(++n)+'/'+names.length+' ('+EXT+')'; buf[nm]=await load(nm); }
  // AAC adds encoder priming; if the decoded loop is longer than the musical loop, skip the leading extra.
  const L=buf['matrix-loop-stem-calm'].duration; LEAD = L>LOOP+0.001 ? Math.min(L-LOOP, 2112/44100) : 0;
  const master=ctx.createGain(); master.gain.value=0.9; master.connect(ctx.destination);
  const comp=ctx.createDynamicsCompressor(); comp.threshold.value=-6; comp.connect(master);
  t0=ctx.currentTime+0.25;
  for(const k of STEMS.concat(['bt'])){
    const g=ctx.createGain(); g.gain.value=(k==='calm')?1:0; g.connect(comp); gains[k]=g;
    const src=ctx.createBufferSource(); src.buffer=buf[k==='bt'?'matrix-bullettime':'matrix-loop-stem-'+k];
    src.loop=true; src.loopStart=LEAD; src.loopEnd=LEAD+LOOP; src.connect(g); src.start(t0,LEAD); srcs.push(src);
  }
  gunGain=ctx.createGain(); gunGain.gain.value=0.55; gunGain.connect(comp);
  $('start').style.display='none'; running=true; requestAnimationFrame(frame);
}
$('go').addEventListener('click',e=>{e.stopPropagation();$('go').disabled=true;init().catch(x=>{err(String(x));$('go').disabled=false})});

// ---------------- gameplay ----------------
let running=false, gunGain, score=0, combo=0, best=0, tier=1, level=0, bt=null, nextBtCombo=45;
const targets=[]; let spawnedUntil=-1; const fx=[];
const songTime=()=>ctx.currentTime-t0-offsetMs/1000;
const TIER_AT=[0,10,25,45], INT_AT=[0,8,24];
function setIntensity(){
  const lvl=combo>=INT_AT[2]?2:combo>=INT_AT[1]?1:0; if(lvl===level||bt) {level=lvl;return}
  level=lvl; const t=ctx.currentTime;
  STEMS.forEach((k,i)=>{const g=gains[k].gain; g.cancelScheduledValues(t); g.setValueAtTime(g.value,t); g.linearRampToValueAtTime(i<=lvl?1:0,t+BEAT);});
}
function nextBarTime(){const st=ctx.currentTime-t0; return t0+Math.ceil((st+0.05)/BAR)*BAR;}
function startBulletTime(){
  const tb=nextBarTime(), te=tb+4*BAR; bt={start:tb-t0,end:te-t0};
  for(const k of STEMS){const g=gains[k].gain; g.cancelScheduledValues(ctx.currentTime); g.setValueAtTime(g.value,ctx.currentTime); g.setValueAtTime(g.value,tb-0.01); g.linearRampToValueAtTime(0,tb); g.setValueAtTime(0,te-0.01); g.linearRampToValueAtTime(STEMS.indexOf(k)<=level?1:0,te);}
  const g=gains.bt.gain; g.setValueAtTime(0,tb-0.01); g.linearRampToValueAtTime(1,tb); g.setValueAtTime(1,te-0.01); g.linearRampToValueAtTime(0,te);
  setTimeout(()=>{bt=null;setIntensity()},(te-ctx.currentTime)*1000+50);
}
function updateTier(){
  const t=combo>=TIER_AT[3]?4:combo>=TIER_AT[2]?3:combo>=TIER_AT[1]?2:1;
  if(t===4&&!bt&&combo>=nextBtCombo){startBulletTime(); nextBtCombo=combo+32; flash('BULLET TIME',1.5)}
  tier=t;
}
function spawn(){ // schedule targets one bar ahead on the beat grid + player gap slots
  const W=innerWidth,H=innerHeight;
  const horizon=songTime()+2*BAR;
  while(spawnedUntil<horizon){
    spawnedUntil=spawnedUntil<0?Math.ceil(Math.max(0,songTime()+BAR)/BAR)*BAR:spawnedUntil+BAR;
    const bar=Math.round(spawnedUntil/BAR); const half=bt&&spawnedUntil>=bt.start&&spawnedUntil<bt.end;
    const slots=half?[0,2]:(bar%4===3?[0,1,2,3].concat(CFG.gaps):[0,2].concat(CFG.gaps));
    for(const s of slots){ targets.push({t:spawnedUntil+s*BEAT,x:W*(0.15+0.7*Math.random()),y:H*(0.22+0.55*Math.random()),gap:!Number.isInteger(s),done:false}); }
  }
}
function judge(){
  if(!running) return; const now=songTime();
  const gun=buf['matrix-gun-t'+tier]; const s=ctx.createBufferSource(); s.buffer=gun; s.connect(gunGain); s.start();
  let best=null,bd=1e9; for(const tg of targets){ if(tg.done) continue; const d=Math.abs(tg.t-now); if(d<bd){bd=d;best=tg} }
  const win=bt?1.6:1;
  if(best&&bd<=0.13*win){
    best.done=true; const perfect=bd<=0.05*win; combo++; score+=(perfect?300:100)*tier*(1+Math.floor(combo/10));
    fx.push({x:best.x,y:best.y,txt:perfect?'PERFECT':'GOOD',life:1,c:perfect?'#aff':'#3f6'});
  } else { fx.push({x:innerWidth/2,y:innerHeight*0.85,txt:'MISS',life:1,c:'#f44'}); combo=0; }
  updateTier(); setIntensity();
}
addEventListener('pointerdown',e=>{ if(e.target.id==='off'||e.target.id==='go') return; e.preventDefault(); judge(); },{passive:false});
addEventListener('touchmove',e=>e.preventDefault(),{passive:false});
document.addEventListener('gesturestart',e=>e.preventDefault());
let banner=null; function flash(t,d){banner={t,life:d}}

// ---------------- visuals ----------------
const cv=$('c'), g2=cv.getContext('2d'); let DPR=1, cols=[];
function resize(){DPR=Math.min(devicePixelRatio||1,2); cv.width=innerWidth*DPR; cv.height=innerHeight*DPR; g2.setTransform(DPR,0,0,DPR,0,0);
  cols=Array.from({length:Math.ceil(innerWidth/16)},()=>Math.random()*innerHeight)}
addEventListener('resize',resize); resize();
let lastT=performance.now();
function frame(now){
  const dtReal=(now-lastT)/1000; lastT=now; const st=songTime(); const slow=bt&&st>=bt.start&&st<bt.end; const dt=slow?dtReal*0.35:dtReal;
  spawn(); const W=innerWidth,H=innerHeight;
  g2.fillStyle=slow?'rgba(0,8,4,0.18)':'rgba(0,0,0,0.25)'; g2.fillRect(0,0,W,H);
  g2.font='14px monospace'; g2.fillStyle=slow?'#7fffd4':'#0f4';
  cols.forEach((y,i)=>{g2.globalAlpha=0.35; g2.fillText(String.fromCharCode(0x30A0+((i*7+Math.floor(y))%96)),i*16,y); cols[i]=y>H?0:y+(40+i%5*20)*dt*(1+level)});
  g2.globalAlpha=1;
  const beatPhase=((st%BEAT)+BEAT)%BEAT/BEAT; // pulse on beat
  g2.strokeStyle='#0f4'; g2.lineWidth=2; g2.globalAlpha=0.25+0.5*(1-beatPhase);
  g2.strokeRect(6,6,W-12,H-12); g2.globalAlpha=1;
  const APPROACH=slow?2*BEAT*2:2*BEAT;
  for(const tg of targets){
    if(tg.done) continue; const dtt=tg.t-st;
    if(dtt<-0.14*(bt?1.6:1)){ tg.done=true; combo=0; updateTier(); setIntensity(); fx.push({x:tg.x,y:tg.y,txt:'MISS',life:1,c:'#f44'}); continue; }
    if(dtt>APPROACH) continue;
    const k=Math.max(0,dtt/APPROACH); const R=26;
    g2.shadowColor='#0f4'; g2.shadowBlur=14;
    g2.strokeStyle=tg.gap?'#9ff':'#3f6'; g2.lineWidth=3; g2.beginPath(); g2.arc(tg.x,tg.y,R,0,7); g2.stroke();
    g2.lineWidth=2; g2.globalAlpha=1-k*0.6; g2.beginPath(); g2.arc(tg.x,tg.y,R+k*110,0,7); g2.stroke(); g2.globalAlpha=1;
    g2.fillStyle=tg.gap?'#9ff':'#3f6'; g2.beginPath(); g2.arc(tg.x,tg.y,5,0,7); g2.fill(); g2.shadowBlur=0;
  }
  while(targets.length&&targets[0].done&&targets[0].t<st-1) targets.shift();
  g2.textAlign='center';
  for(const f of fx){ g2.globalAlpha=Math.max(0,f.life); g2.fillStyle=f.c; g2.font='bold 20px monospace'; g2.fillText(f.txt,f.x,f.y-30*(1-f.life)); f.life-=dtReal*1.6; }
  while(fx.length&&fx[0].life<=0) fx.shift(); g2.globalAlpha=1;
  if(slow){ g2.fillStyle='rgba(120,255,220,0.08)'; g2.fillRect(0,0,W,H); g2.fillStyle='#aff'; g2.font='bold 28px monospace'; g2.fillText('BULLET TIME',W/2,H*0.12+30); }
  else if(banner&&banner.life>0){ g2.fillStyle='#aff'; g2.font='bold 28px monospace'; g2.fillText(banner.t,W/2,H*0.12+30); banner.life-=dtReal; }
  $('score').textContent=score; $('combo').textContent='x'+combo; $('tier').textContent='T'+tier+' '+['CALM','ALERT','FIREFIGHT'][level];
  requestAnimationFrame(frame);
}
window.__downbeat={get state(){return {running,ctxState:ctx&&ctx.state,ext:EXT,lead:LEAD,targets:targets.length,tier,combo}}};
