import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { AnimationClock, SceneCycle } from '../src/timeline.js';

// Execute the real entry point without loading CSS or requiring a browser GPU.
const entry = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  .replace(/^import [^\n]+;\r?\n/gm, '');

class Element extends EventTarget {
  style = {};
  dataset = {};
  children = new Set();
  parts = new Map();
  hidden = true;

  setAttribute(name, value) { this[name] = value; }
  querySelector(selector) {
    if (!this.parts.has(selector)) this.parts.set(selector, new Element());
    return this.parts.get(selector);
  }
  appendChild(element) { this.children.add(element); element.parentElement = this; }
  remove() { this.parentElement?.children.delete(this); }
  decode() { return Promise.resolve(); }
  closest(selector) { return this.controlTag && selector.includes(this.controlTag) ? this : null; }
  focus() { this.focused = true; }
}

async function loadExperience() {
  const document = new Element();
  document.body = new Element();
  document.hidden = false;
  const navigations=[];
  const gateway=document.querySelector('#enter-gateway');gateway.href='./login.html';gateway.click=()=>navigations.push(gateway.href);
  const buttons = [new Element(), new Element(), new Element()];
  document.querySelectorAll = () => buttons;
  const window = new EventTarget();
  const preference = new EventTarget();
  preference.matches = false;
  const callbacks = new Map();
  let now = 1000, nextFrame = 0;

  // These surfaces retain the production attach/remove/render side effects;
  // lifecycle decisions and event handlers come entirely from main.js.
  class MirrorLake {
    constructor(container) {
      this.renderer = {
        domElement: new Element(),
        capabilities: { isWebGL2: true },
        info: { render: { calls: 0 } },
      };
      container.appendChild(this.renderer.domElement);
      this.textures = [];
      this.renderCount = 0;
      this.rippleCount = 0;
    }
    async load() {}
    resize() {}
    render() { this.renderCount++; }
    dispose() { this.renderer.domElement.remove(); }
  }

  runInNewContext(entry, {
    console, document, window, AnimationClock, SceneCycle,
    createStarTrail: () => ({ setPaused() {}, dispose() {} }),
    MirrorLake,
    matchMedia: () => preference,
    performance: { now: () => now },
    requestAnimationFrame(callback) { callbacks.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame(id) { callbacks.delete(id); },
  }, { filename: 'src/main.js' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(document.body.dataset.ready, 'true', 'the real entry point must finish initialization');
  assert.equal(document.querySelector('#error').hidden, true, 'initialization must not enter the error path');

  const dispatch = (target, type, fields = {}) => target.dispatchEvent(Object.assign(new Event(type), fields));
  return {
    get state() { return window.__ASTRA__.state; },
    get canvasCount() { return document.querySelector('#scene').children.size; },
    frame(milliseconds = 20) {
      now += milliseconds;
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(now);
    },
    elapse(milliseconds) { now += milliseconds; },
    pageEvent(type, persisted) { dispatch(window, type, { persisted }); },
    pause() { dispatch(document.querySelector('#pause'), 'click'); },
    get navigations() { return navigations; },
    key(key,{target='',...fields}={}) {
      document.controlTag=target;
      dispatch(document,'keydown',{key,code:key===' '?'Space':key,repeat:false,isComposing:false,...fields});
      document.controlTag='';
    },
    get ambience() { return document.querySelector('#ambience'); },
    setReducedMotion(matches) {
      preference.matches = matches;
      dispatch(preference, 'change', { matches });
    },
  };
}

test('游戏式开场按 Enter 进入账号登录，长按和组合键不重复触发',async()=>{
  const app=await loadExperience();
  app.key('Enter');assert.deepEqual(app.navigations,['./login.html']);
  app.key('Enter',{repeat:true});app.key('Enter',{ctrlKey:true});app.key('Enter',{isComposing:true});
  assert.equal(app.navigations.length,1);
});

test('画面控件与景观菜单中的键盘操作不触发登录跳转或场景快捷键',async()=>{
  const app=await loadExperience();
  for(const target of ['button','summary','a']){app.key('Enter',{target});app.key('ArrowRight',{target});}
  assert.equal(app.navigations.length,0);assert.equal(app.state.scene,0);
});

test('Escape 收起景观菜单并归还焦点',async()=>{
  const app=await loadExperience();app.ambience.open=true;
  app.key('Escape',{target:'button'});
  assert.equal(app.ambience.open,false);assert.equal(app.ambience.querySelector('summary').focused,true);
});

test('returning from the back-forward cache keeps canvases and resumes animation frames', async () => {
  const app = await loadExperience();
  app.frame();
  assert.equal(app.canvasCount, 1);
  assert.ok(app.state.time > 0, 'animation must be running before navigating away');
  const before = app.state;

  app.pageEvent('pagehide', true);
  app.elapse(60_000); // A cached page receives no animation frames while away.
  app.pageEvent('pageshow', true);
  await new Promise(resolve => setImmediate(resolve));
  app.frame();

  assert.deepEqual({
    canvases: app.canvasCount,
    timeAdvancing: app.state.time > before.time,
    rendering: app.state.frames > before.frames,
  }, { canvases: 1, timeAdvancing: true, rendering: true });
  assert.ok(app.state.time - before.time <= 0.051, 'restoring must not fast-forward the cached interval');
});

test('turning reduced motion off preserves an explicit user pause', async () => {
  const app = await loadExperience();
  app.frame();
  app.pause();
  assert.equal(app.state.paused, true, 'the user pause must take effect first');
  const pausedAt = app.state.time;

  app.setReducedMotion(true);
  app.setReducedMotion(false);
  app.frame();

  assert.deepEqual({ paused: app.state.paused, time: app.state.time }, {
    paused: true, time: pausedAt,
  });
});

for (const refreshRate of [60, 120, 144]) {
  test(`a ${refreshRate} Hz animation callback renders about 600 frames over 10 seconds`, async () => {
    const app = await loadExperience();
    for (let tick = 0; tick < refreshRate * 10; tick++) app.frame(1000 / refreshRate);

    assert.ok(Math.abs(app.state.time - 10) < 1e-8, 'the animation clock must advance for the full 10 seconds');
    assert.ok(Math.abs(app.state.frames - 600) <= 2,
      `expected 598–602 renders at ${refreshRate} Hz, received ${app.state.frames}`);
  });
}
