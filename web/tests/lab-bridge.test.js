import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/labs-host/bridge.js',import.meta.url),'utf8');

function setup({embedded=true,code=false}={}){
  const origin='https://example.test';
  const location=new URL(code?'/astra/labs/codevis/index.html#lesson/demo':'/astra/labs/index.html#physics/double-pendulum-chaos',origin);
  function anchor(href,page){
    const attributes=new Map([['href',href],...(page?[['data-page',page]]:[])]);
    return {
      get href(){return new URL(attributes.get('href'),location).href;},
      set href(value){attributes.set('href',value);},
      getAttribute:name=>attributes.get(name)??null,
      removeAttribute:name=>attributes.delete(name),
      closest(){return this;},
    };
  }
  const overview=anchor(code?'../index.html#planets':'#planets','planets');
  const subject=anchor('#physics','physics');
  const messages=[],listeners=new Map();
  const history={
    pushState(state,unused,href){if(href)location.href=new URL(href,location).href;return 'push-result';},
    replaceState(state,unused,href){if(href)location.href=new URL(href,location).href;return 'replace-result';},
  };
  const document={
    currentScript:{src:origin+'/astra/labs-host/bridge.js'},readyState:'complete',
    querySelectorAll:()=>[overview,subject],
    addEventListener:(type,handler,options)=>listeners.set(type,{handler,options}),
  };
  const window={addEventListener(){}};
  const parent=embedded?{postMessage:(data,target)=>messages.push({data,target})}:window;
  window.parent=parent;
  vm.runInNewContext(source,{window,parent,document,location,history,URL});
  messages.length=0;
  function click(modifiers={}){
    const event={target:overview,button:0,defaultPrevented:false,propagationStopped:false,
      preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.propagationStopped=true;},...modifiers};
    const listener=listeners.get('click');
    listener.handler(event);
    // The original experiment router intercepts data-page links on the target.
    if(!event.propagationStopped&&overview.getAttribute('data-page'))event.preventDefault();
    return event;
  }
  return {overview,subject,messages,listeners,click,history};
}

test('原实验与代码空间的星序入口指向本站主页面，保留学科内部导航',()=>{
  for(const code of [false,true]){
    const {overview,subject}=setup({code});
    assert.equal(overview.href,'https://example.test/astra/observatory.html');
    assert.equal(overview.target,'_top');
    assert.equal(overview.getAttribute('data-page'),null);
    assert.equal(subject.getAttribute('data-page'),'physics');
    assert.ok(subject.href.endsWith('#physics'));
  }
});

test('普通返回在原路由之前捕获，由实验宿主页恢复观星状态',()=>{
  const {click,listeners,messages}=setup();
  const event=click();
  assert.equal(listeners.get('click').options,true);
  assert.equal(event.defaultPrevented,true);
  assert.equal(event.propagationStopped,true);
  assert.equal(messages.length,1);
  assert.equal(messages[0].target,'https://example.test');
  assert.equal(messages[0].data.namespace,'astra-lab-explorer');
  assert.equal(messages[0].data.type,'return');
});

test('修饰键和中键打开星序时保留浏览器行为，不被原实验路由阻断',()=>{
  for(const modifiers of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1}]){
    const {click,messages}=setup();
    assert.equal(click(modifiers).defaultPrevented,false);
    assert.equal(messages.length,0);
  }
});

test('直接打开实验副本时，原星序链接也正常返回主页面',()=>{
  const {overview,click,messages}=setup({embedded:false});
  assert.equal(overview.href,'https://example.test/astra/observatory.html');
  assert.equal(click().defaultPrevented,false);
  assert.equal(messages.length,0);
});

test('原路由用 pushState 和 replaceState 切换时同步通知宿主页，保持原历史语义',()=>{
  const {history,messages}=setup();
  assert.equal(history.pushState(null,'','#mathematics'),'push-result');
  assert.equal(messages.length,1);assert.equal(messages[0].data.type,'route');
  assert.ok(messages[0].data.href.endsWith('#mathematics'));
  assert.equal(history.replaceState(null,'','#mathematics/functions'),'replace-result');
  assert.equal(messages.length,2);assert.ok(messages[1].data.href.endsWith('#mathematics/functions'));
  history.replaceState(null,'','#mathematics/functions');
  assert.equal(messages.length,2);
});

const hostSource=readFileSync(new URL('../src/experiments/main.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
function setupHost({fromObservatory=true}={}){
  const listeners=new Map(),destinations=[];
  const location=new URL('https://example.test/astra/experiment.html?activity=physics.double-pendulum-chaos');
  location.assign=href=>destinations.push(href);
  const frame={contentWindow:{}},status={},error={};
  const document={referrer:fromObservatory?'https://example.test/astra/observatory.html':'',
    querySelector:selector=>({'#experiment-frame':frame,'#experiment-load-status':status,'#experiment-error':error})[selector]};
  const activity={key:'physics.double-pendulum-chaos',title:'双摆',href:'labs/index.html#physics/double-pendulum-chaos'};
  const route={activity,iframeUrl:new URL(activity.href,'https://example.test/astra/').href,returnHref:'https://example.test/astra/observatory.html#galaxy=engineering&subject=physics'};
  const history={length:3,backs:0,back(){this.backs++;}};
  const window={addEventListener:(type,handler)=>listeners.set(type,handler)};
  vm.runInNewContext(hostSource,{document,location,history,window,URL,URLSearchParams,AbortController,
    LAB_SPACES:[{topics:[{activities:[activity]}]}],findLabActivity:()=>activity,resolveExperimentRoute:()=>route,
    setTimeout:()=>1,clearTimeout(){}});
  const message=(type,href=activity.href)=>listeners.get('message')({source:frame.contentWindow,origin:location.origin,data:{namespace:'astra-lab-explorer',type,href}});
  return {history,destinations,message,route};
}

test('从观星直接进入实验时，星序返回保留原星图历史状态',()=>{
  const host=setupHost();host.message('ready');host.message('return');
  assert.equal(host.history.backs,1);assert.equal(host.destinations.length,0);
});

test('实验内切换学科后，星序直接回到主页面，避免只退回上一个实验',()=>{
  const host=setupHost();host.message('ready');host.history.length++;
  host.message('route','/astra/labs/index.html#mathematics');host.message('return');
  assert.equal(host.history.backs,0);assert.deepEqual(host.destinations,[host.route.returnHref]);
});

test('直接进入实验工作区也能从原导航返回观星主页面',()=>{
  const host=setupHost({fromObservatory:false});host.message('return');
  assert.equal(host.history.backs,0);assert.deepEqual(host.destinations,[host.route.returnHref]);
});
