import './style.css';
import { AnimationClock, SceneCycle } from './timeline.js';
import { MirrorLake } from './scene.js';
import { createStarTrail } from './shared/star-trail.js';

const container=document.querySelector('#scene');
const pauseButton=document.querySelector('#pause');
const fullscreenButton=document.querySelector('#fullscreen');
const sceneButtons=[...document.querySelectorAll('[data-scene]')];
const labels=['镜湖','星火','极光'];
const motionPreference=matchMedia('(prefers-reduced-motion: reduce)');
const clock=new AnimationClock({paused:motionPreference.matches});
const starTrail=createStarTrail({paused:clock.paused});
let userPaused=false;
const cycle=new SceneCycle();
const FRAME_INTERVAL=1/60;
let lake,frameId,lastTime=performance.now(),renderBudget=0,dirty=true,activeIndex=-1;

function updateControls() {
  starTrail.setPaused(clock.paused);
  document.body.dataset.paused=String(clock.paused);
  const label=clock.paused?'继续动效':'暂停动效';
  pauseButton.setAttribute('aria-label',label);
  pauseButton.title=`${label} · 空格`;
  if(activeIndex!==cycle.index){
    activeIndex=cycle.index;
    sceneButtons.forEach((button,index)=>button.setAttribute('aria-pressed',String(index===activeIndex)));
    document.querySelector('#scene-status').textContent=`当前场景：${labels[activeIndex]}`;
    document.body.dataset.scene=labels[activeIndex];
    document.querySelector('#ambience-label').textContent=labels[activeIndex];
  }
  sceneButtons[cycle.index].querySelector('i').style.transform=`scaleX(${cycle.progress})`;
}

function togglePause(){clock.paused=!clock.paused;userPaused=clock.paused;lastTime=performance.now();updateControls();}
async function toggleFullscreen(){
  try{
    if(document.fullscreenElement)await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  }catch(error){fullscreenButton.title='此浏览器暂不支持全屏';console.info('[Astra] Fullscreen unavailable:',error.message);}
}
function showError(message){
  starTrail.setPaused(true);
  document.body.dataset.ready='true';
  const panel=document.querySelector('#error');
  panel.querySelector('p').textContent=message;
  panel.hidden=false;
  pauseButton.disabled=true;
  sceneButtons.forEach(button=>button.disabled=true);
}

pauseButton.addEventListener('click',togglePause);
fullscreenButton.addEventListener('click',toggleFullscreen);
sceneButtons.forEach((button,index)=>button.addEventListener('click',()=>{
  cycle.select(index,{immediate:clock.paused});dirty=true;updateControls();
}));
document.addEventListener('keydown',event=>{
  if(event.isComposing||event.repeat||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;
  const ambience=document.querySelector('#ambience');
  if(event.key==='Escape'&&ambience.open){ambience.open=false;ambience.querySelector('summary').focus();event.preventDefault();return;}
  if(event.target.closest('a,button,summary,input,textarea,select,[contenteditable]'))return;
  if(event.key==='Enter'){event.preventDefault();document.querySelector('#enter-gateway').click();return;}
  if(event.code==='Space'){event.preventDefault();togglePause();}
  if(event.key.toLowerCase()==='f')toggleFullscreen();
  if(event.key==='ArrowRight'||event.key==='ArrowLeft'){
    event.preventDefault();cycle.select((cycle.index+(event.key==='ArrowRight'?1:2))%3,{immediate:clock.paused});dirty=true;updateControls();
  }
});
document.addEventListener('fullscreenchange',()=>{
  const label=document.fullscreenElement?'退出全屏':'全屏欣赏';
  fullscreenButton.setAttribute('aria-label',label);fullscreenButton.title=`${label} · F`;
});
document.addEventListener('visibilitychange',()=>{clock.hidden=document.hidden;lastTime=performance.now();});
motionPreference.addEventListener('change',event=>{clock.paused=userPaused||event.matches;lastTime=performance.now();updateControls();});

function frame(now){
  const dt=clock.advance((now-lastTime)/1000);
  lastTime=now;
  renderBudget+=dt;
  if(dt>0){
    cycle.advance(dt);
  }
  const framesDue=Math.floor((renderBudget+1e-7)/FRAME_INTERVAL);
  if(framesDue>0||dirty){
    lake.render(clock.time,cycle.weights);updateControls();dirty=false;
    renderBudget=Math.max(0,renderBudget-framesDue*FRAME_INTERVAL);
  }
  frameId=requestAnimationFrame(frame);
}

async function start(){
  updateControls();
  try{
    lake=new MirrorLake(container);
    lake.renderer.domElement.addEventListener('webglcontextlost',event=>{
      event.preventDefault();clock.paused=true;cancelAnimationFrame(frameId);
      showError('图形上下文暂时中断，请重新加载恢复星空。');
    });
    await Promise.all([lake.load(),document.querySelector('.brand img').decode()]);
    const resize=()=>{lake.resize();dirty=true;};
    window.addEventListener('resize',resize);
    window.addEventListener('pagehide',event=>{
      cancelAnimationFrame(frameId);
      if(event.persisted){clock.hidden=true;return;}
      window.removeEventListener('resize',resize);lake.dispose();
    });
    window.addEventListener('pageshow',event=>{
      if(!event.persisted)return;
      clock.hidden=document.hidden;lastTime=performance.now();dirty=true;
      frameId=requestAnimationFrame(frame);
    });
    Object.defineProperty(window,'__ASTRA__',{value:Object.freeze({get state(){return {
      time:clock.time,paused:clock.paused,hidden:clock.hidden,scene:cycle.index,weights:[...cycle.weights],
      transitioning:!!cycle.from,ripples:lake.rippleCount,frames:lake.renderCount,
      textures:lake.textures.length,webgl:lake.renderer.capabilities.isWebGL2,drawCalls:lake.renderer.info.render.calls,...lake.diagnostics,
    };}})});
    document.body.dataset.ready='true';
    lastTime=performance.now();
    frameId=requestAnimationFrame(frame);
  }catch(error){
    console.error('[Astra] Scene initialization failed',error);
    showError('动态场景未能加载。请检查网络，并使用支持 WebGL 2 的现代浏览器重试。');
  }
}
start();
