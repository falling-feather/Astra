import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionLoop } from '../src/login/motion.js';

function harness() {
  const scheduled = new Map();
  let key = 0;
  const frames = [];
  const loop = new MotionLoop({
    render: time => frames.push(time),
    request: callback => { scheduled.set(++key, callback); return key; },
    cancel: id => scheduled.delete(id),
  });
  return { loop, scheduled, frames, tick(now) {
    const next = [...scheduled.values()]; scheduled.clear(); next.forEach(callback => callback(now));
  } };
}

test('pause and a hidden tab cancel all scheduled rendering, not only time advancement', () => {
  const app = harness();
  app.loop.start(); app.tick(0); app.tick(40);
  assert.ok(app.frames.at(-1) > 0);
  app.loop.setPaused(true);
  assert.equal(app.scheduled.size, 0);
  const time = app.loop.time;
  app.tick(80000);
  assert.equal(app.loop.time, time);
  app.loop.setPaused(false);
  app.tick(80000); app.tick(80040);
  assert.ok(app.loop.time - time < 0.05, 'resume does not advance through the paused interval');
  app.loop.setHidden(true);
  assert.equal(app.scheduled.size, 0);
  app.loop.dispose();
  app.loop.setHidden(false);
  assert.equal(app.scheduled.size, 0, 'disposed loops cannot restart');
});

test('a paused page still paints once after resize without restarting continuous animation', () => {
  const app = harness();
  app.loop.setPaused(true); app.loop.start(); app.loop.draw();
  assert.equal(app.frames.length, 1);
  assert.equal(app.frames[0], 0);
  assert.equal(app.scheduled.size, 0);
});

test('browser frame functions retain their global receiver when called by the loop', () => {
  const originalRequest = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  let requested = false, cancelled = false;
  globalThis.requestAnimationFrame = function () {
    assert.equal(this, globalThis, 'the browser requires the Window receiver');
    requested = true;
    return 17;
  };
  globalThis.cancelAnimationFrame = function (id) {
    assert.equal(this, globalThis);
    assert.equal(id, 17);
    cancelled = true;
  };
  try {
    const loop = new MotionLoop({ render() {} });
    loop.start(); loop.setPaused(true);
    assert.equal(requested && cancelled, true);
  } finally {
    if (originalRequest) globalThis.requestAnimationFrame = originalRequest;
    else delete globalThis.requestAnimationFrame;
    if (originalCancel) globalThis.cancelAnimationFrame = originalCancel;
    else delete globalThis.cancelAnimationFrame;
  }
});
