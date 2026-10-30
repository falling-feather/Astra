import {LAB_SPACES,findLabActivity,resolveExperimentRoute} from '../observatory/lab-catalog.js';
import './style.css';

const $=selector=>document.querySelector(selector),frame=$('#experiment-frame');
const events=new AbortController(),{signal}=events;
const base=new URL('./',location.href),route=resolveExperimentRoute(location.search,base);
const arrivalHistoryLength=history.length;
const all=LAB_SPACES.flatMap(space=>space.topics.flatMap(topic=>topic.activities));
let current=route?.activity||null,loadTimer=null,frameNavigated=false;

function reflectCurrent(){
  document.title=current.title+' · 星序 Astra';
  frame.title=current.title+'实验';
}

const navigationFromObservatory=(()=>{try{const from=new URL(document.referrer);return from.origin===location.origin&&from.pathname===new URL('observatory.html',base).pathname;}catch{return false;}})();
function returnToObservatory(){
  // Child-frame routes also add browser history; one step back may still be an experiment.
  if(navigationFromObservatory&&!frameNavigated&&history.length===arrivalHistoryLength&&history.length>1)history.back();
  else location.assign(resolveExperimentRoute(new URLSearchParams({activity:current.key}),base).returnHref);
}

if(route){
  reflectCurrent();frame.hidden=false;frame.src=route.iframeUrl;
  loadTimer=setTimeout(()=>{
    if($('#experiment-load-status').hidden)return;
    $('#experiment-load-status').textContent='实验尚未完成载入。';
    const retry=document.createElement('button');retry.type='button';retry.textContent='重新载入';retry.addEventListener('click',()=>location.reload());$('#experiment-load-status').append(retry);
  },15000);
}else{
  document.title='实验入口不可用 · 星序 Astra';$('#experiment-error').hidden=false;$('#experiment-load-status').hidden=true;
}
window.addEventListener('message',event=>{
  if(event.source!==frame.contentWindow||event.origin!==location.origin||!event.data||event.data.namespace!=='astra-lab-explorer')return;
  if(event.data.type==='return'){returnToObservatory();return;}
  if(event.data.type!=='ready'&&event.data.type!=='route')return;
  if(event.data.type==='route')frameNavigated=true;
  clearTimeout(loadTimer);$('#experiment-load-status').hidden=true;
  if(typeof event.data.href!=='string')return;
  const received=new URL(event.data.href,base);
  const match=all.find(item=>{
    const expected=new URL(item.href,base);
    const normalized=pathname=>pathname.replace(/\/index\.html$/,'/');
    return normalized(received.pathname)===normalized(expected.pathname)&&received.hash===expected.hash;
  });
  if(match&&match.key!==current?.key){current=findLabActivity(match.key);reflectCurrent();}
},{signal});
window.addEventListener('pagehide',event=>{clearTimeout(loadTimer);if(!event.persisted)events.abort();},{signal});
