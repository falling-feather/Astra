import test from 'node:test';
import assert from 'node:assert/strict';
import { SceneCycle, AnimationClock, footRippleTimesBetween } from '../src/timeline.js';

test('all three scenes crossfade continuously and return to the first', () => {
  const cycle = new SceneCycle({ hold: 18, fade: 7 });
  cycle.advance(18);
  assert.deepEqual(cycle.weights, [1, 0, 0]);
  cycle.advance(3.5);
  assert.ok(Math.abs(cycle.weights[0] - 0.5) < 1e-9);
  assert.ok(Math.abs(cycle.weights[1] - 0.5) < 1e-9);
  cycle.advance(3.5);
  assert.deepEqual(cycle.weights, [0, 1, 0]);
  cycle.advance(50);
  assert.deepEqual(cycle.weights, [1, 0, 0]);
});

test('manual selection during a crossfade preserves the currently rendered mixture', () => {
  const cycle = new SceneCycle();
  cycle.advance(21);
  const before = [...cycle.weights];
  cycle.select(2);
  assert.deepEqual(cycle.weights, before);
  cycle.advance(2);
  assert.ok(cycle.weights.every(weight => weight >= 0 && weight <= 1));
  assert.ok(Math.abs(cycle.weights.reduce((a, b) => a + b) - 1) < 1e-9);
  cycle.advance(5);
  assert.deepEqual(cycle.weights, [0, 0, 1]);
});

test('a paused or reduced-motion user can still select a static scene', () => {
  const cycle = new SceneCycle();
  cycle.select(2, { immediate: true });
  assert.deepEqual(cycle.weights, [0, 0, 1]);
  assert.equal(cycle.index, 2);
  assert.throws(() => cycle.select(3), RangeError);
});

test('pause and hidden tabs freeze time; restoring does not fast-forward', () => {
  const clock = new AnimationClock();
  clock.advance(0.02);
  clock.paused = true;
  assert.equal(clock.advance(10), 0);
  clock.paused = false;
  clock.hidden = true;
  assert.equal(clock.advance(10), 0);
  clock.hidden = false;
  assert.equal(clock.advance(0.02), 0.02);
  assert.equal(clock.time, 0.04);
  assert.equal(clock.advance(10), 0.05);
});

test('foot ripple pulses never duplicate at a frame boundary', () => {
  assert.deepEqual(footRippleTimesBetween(0, 2.8), [2.8]);
  assert.deepEqual(footRippleTimesBetween(2.8, 5.6), [5.6]);
  assert.deepEqual(footRippleTimesBetween(5.6, 5.61), []);
  assert.equal(footRippleTimesBetween(0, 5.6).length, 2);
  assert.deepEqual(footRippleTimesBetween(10, 9), []);
});
