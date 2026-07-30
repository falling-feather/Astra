const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const physicsSource = fs.readFileSync(path.join(root, 'pages/physics/physics.js'), 'utf8');
const physicsCss = fs.readFileSync(path.join(root, 'pages/physics/physics.css'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

class FakeElement {
  constructor(properties = {}) {
    this._listeners = new Map();
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.textContent = '';
    this.dataset = {};
    this.style = {};
    this.focusCalls = 0;
    Object.assign(this, properties);
  }

  focus() {
    this.focusCalls += 1;
  }

  addEventListener(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(handler);
  }

  removeEventListener(type, handler) {
    const handlers = this._listeners.get(type);
    if (!handlers) return;
    handlers.delete(handler);
    if (handlers.size === 0) this._listeners.delete(type);
  }

  listenerCount() {
    return [...this._listeners.values()].reduce((total, handlers) => total + handlers.size, 0);
  }

  closest() {
    return null;
  }
}

function createCourseHarness(options = {}) {
  const events = [];
  const canvasContext = {
    setTransform() {},
  };
  const canvasContainer = new FakeElement({
    layoutWidth: Number(options.containerWidth) || 640,
    getBoundingClientRect() {
      return { width: this.layoutWidth };
    },
  });
  const canvas = new FakeElement({
    parentElement: canvasContainer,
    getContext() {
      return canvasContext;
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: canvasContainer.layoutWidth };
    },
  });
  const elements = new Map([
    ['mechanics-prediction-choice', new FakeElement({ value: 'higher-080' })],
    ['mechanics-prediction-relation', new FakeElement({ value: 'four-times' })],
    ['mechanics-prediction-reason', new FakeElement({ value: '恢复系数改变反弹速度。' })],
    ['mechanics-prediction-submit', new FakeElement()],
    ['mechanics-trial-040', new FakeElement({ disabled: true })],
    ['mechanics-trial-080', new FakeElement({ disabled: true })],
    ['mechanics-correction-choice', new FakeElement({ value: 'height-follows-e-squared' })],
    ['mechanics-model-limit', new FakeElement({ checked: true })],
    ['mechanics-correction-submit', new FakeElement({ disabled: true })],
    ['mechanics-replay', new FakeElement({ disabled: true })],
    ['mechanics-course-feedback', new FakeElement()],
    ['mechanics-course-stage', new FakeElement()],
    ['mechanics-measure-h-040', new FakeElement()],
    ['mechanics-measure-ratio-040', new FakeElement()],
    ['mechanics-measure-h-080', new FakeElement()],
    ['mechanics-measure-ratio-080', new FakeElement()],
    ['mechanics-explanation-handoff', new FakeElement()],
    ['physics-canvas', canvas],
    ['gravity-slider', new FakeElement({ value: 980 })],
    ['gravity-value', new FakeElement({ textContent: '980' })],
    ['restitution-slider', new FakeElement({ value: 75 })],
    ['restitution-value', new FakeElement({ textContent: '0.75' })],
    ['friction-slider', new FakeElement({ value: 10 })],
    ['friction-value', new FakeElement({ textContent: '0.10' })],
    ['radius-slider', new FakeElement({ value: 16 })],
    ['radius-value', new FakeElement({ textContent: '16' })],
    ['physics-clear', new FakeElement()],
    ['physics-pause', new FakeElement({ textContent: '暂停' })],
    ['ball-count', new FakeElement({ textContent: '0' })],
    ['physics-fps', new FakeElement({ textContent: '0' })],
  ]);
  const windowObject = new FakeElement({
    dispatchEvent(event) {
      events.push(event.detail);
      return true;
    },
    devicePixelRatio: 1,
    PhysicsZoom: { movedCanvas: null },
  });
  const resizeObservers = [];
  const context = {
    window: windowObject,
    document: {
      getElementById(id) {
        return elements.get(id) || null;
      },
      querySelector(selector) {
        if (selector === '[data-evidence-command="explained"]') {
          return elements.get('mechanics-explanation-handoff');
        }
        return null;
      },
    },
    CustomEvent: class {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    ResizeObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.disconnected = false;
        resizeObservers.push(this);
      }

      observe() {}

      disconnect() {
        this.disconnected = true;
      }
    },
    cancelAnimationFrame() {},
    requestAnimationFrame() { return 1; },
    performance: { now: () => 0 },
    CF: { sans: 'sans-serif' },
    console: { log() {}, warn() {}, error() {} },
    setTimeout(callback) {
      callback();
      return 1;
    },
    clearTimeout() {},
  };
  vm.createContext(context);
  vm.runInContext(physicsSource, context, { filename: 'pages/physics/physics.js' });
  return {
    sim: vm.runInContext('PhysicsSim', context),
    elements,
    events,
    canvas,
    canvasContainer,
    resizeObservers,
    listenerCount() {
      return windowObject.listenerCount()
        + [...elements.values()].reduce((total, element) => total + element.listenerCount(), 0);
    },
  };
}

const harness = createCourseHarness();
const { sim, elements, events } = harness;

assert.equal(
  sim._submitCoursePrediction(),
  true,
  'the course must accept one explicit prediction before observation'
);
assert.equal(elements.get('mechanics-trial-040').disabled, false);
assert.equal(elements.get('mechanics-trial-080').disabled, false);
assert.equal(elements.get('mechanics-prediction-submit').disabled, true);

assert.equal(
  sim._recordControlledMeasurement(0.40, { dropHeight: 200, reboundHeight: 200.001 }),
  false,
  'an impossible rebound above the fixed drop height must be rejected, never clamped into evidence'
);
assert.deepEqual(events.map((event) => event.event_type), ['predicted']);

assert.equal(
  sim._recordControlledMeasurement(0.40, { dropHeight: 200, reboundHeight: 32 }),
  true,
  'the e=.40 controlled trial must create the first observation'
);
assert.equal(
  sim._recordControlledMeasurement(0.40, { dropHeight: 200, reboundHeight: 32 }),
  false,
  'replaying an already observed preset must not append a third attempt'
);
assert.equal(
  sim._recordControlledMeasurement(0.80, { dropHeight: 200, reboundHeight: 128 }),
  true,
  'the e=.80 controlled trial must create the second observation'
);
assert.equal(elements.get('mechanics-correction-submit').disabled, false);
assert.equal(elements.get('mechanics-replay').disabled, false);
assert.equal(elements.get('mechanics-measure-ratio-040').textContent, '0.16');
assert.equal(elements.get('mechanics-measure-ratio-080').textContent, '0.64');

assert.equal(
  sim._submitCourseCorrection(),
  true,
  'the learner must submit a structured correction after both measurements'
);
assert.deepEqual(
  events.map((event) => event.event_type),
  ['predicted', 'attempted', 'attempted', 'corrected'],
  'Physics owns the exact learner facts between started and the shared explained action'
);
assert.equal(events[0].evidence.prediction.expects_higher_080, true);
assert.equal(events[0].evidence.prediction.expected_height_multiplier, 4);
assert.equal(events[0].evidence.prediction.reason_size, 11);
assert.equal(
  Object.prototype.hasOwnProperty.call(events[0].evidence.prediction, 'reason'),
  false,
  'the required local prediction reason must not be copied into durable evidence'
);
assert.deepEqual(
  events.filter((event) => event.event_type === 'attempted').map((event) => event.evidence.cursor.preset.restitution),
  [0.4, 0.8],
  'attempts must be the two fixed recovery-coefficient presets only'
);
const eventFields = {
  predicted: new Set(['prediction', 'cursor']),
  attempted: new Set(['operation', 'reported_correct', 'cursor']),
  corrected: new Set(['correction', 'cursor']),
};
events.forEach((event) => {
  const unknown = Object.keys(event.evidence).filter((key) => !eventFields[event.event_type].has(key));
  assert.deepEqual(unknown, [], `${event.event_type} must obey the shared client top-level DTO`);
});
const durableStrings = [];
function collectStrings(value) {
  if (typeof value === 'string') {
    durableStrings.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(collectStrings);
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach(collectStrings);
  }
}
events.forEach((event) => collectStrings(event.evidence));
assert.deepEqual(
  [...new Set(durableStrings)].sort(),
  ['after-observation', 'after-repair', 'prediction-recorded', 'restitution_adjustment'].sort(),
  'all durable string leaves must reuse the queue-safe bounded enum contract'
);
assert.equal(elements.get('mechanics-explanation-handoff').focusCalls, 1);

const lifecycleHarness = createCourseHarness();
const lifecycleSim = lifecycleHarness.sim;
lifecycleSim.init();
const firstOwnerListenerCount = lifecycleHarness.listenerCount();
assert.ok(firstOwnerListenerCount > 0, 'the verified owner must bind its controls');
lifecycleHarness.elements.get('mechanics-prediction-choice').value = 'higher-080';
lifecycleHarness.elements.get('mechanics-prediction-relation').value = 'four-times';
lifecycleHarness.elements.get('mechanics-prediction-reason').value = '恢复系数改变反弹速度。';
assert.equal(lifecycleSim._submitCoursePrediction(), true);
assert.equal(
  lifecycleSim._recordControlledMeasurement(0.40, { dropHeight: 200, reboundHeight: 32 }),
  true
);
assert.equal(
  lifecycleSim._recordControlledMeasurement(0.80, { dropHeight: 200, reboundHeight: 128 }),
  true
);
lifecycleHarness.elements.get('mechanics-correction-choice').value = 'height-follows-e-squared';
lifecycleHarness.elements.get('mechanics-model-limit').checked = true;
assert.equal(lifecycleSim._submitCourseCorrection(), true);
lifecycleSim.balls = [{ oldOwnerBall: true }];
lifecycleSim.paused = true;
lifecycleSim.isDragging = true;
lifecycleSim.dragStart = { x: 1, y: 2 };
lifecycleSim.dragEnd = { x: 3, y: 4 };
lifecycleSim._comparisonOverlay = true;
const eventsBeforeOwnerReopen = lifecycleHarness.events.length;
lifecycleSim.destroy();
assert.equal(lifecycleHarness.listenerCount(), 0, 'destroy must release every owner listener');
assert.equal(lifecycleHarness.resizeObservers[0].disconnected, true);
lifecycleSim.init();
assert.equal(
  lifecycleHarness.listenerCount(),
  firstOwnerListenerCount,
  'reopen must bind one fresh listener set without leaking the old owner'
);
assert.equal(lifecycleHarness.events.length, eventsBeforeOwnerReopen, 'reopen must not append evidence');
assert.deepEqual(Array.from(lifecycleSim.balls), []);
assert.equal(lifecycleSim.paused, false);
assert.equal(lifecycleSim.isDragging, false);
assert.equal(lifecycleSim.dragStart, null);
assert.equal(lifecycleSim.dragEnd, null);
assert.equal(lifecycleSim._controlledTrial, null);
assert.equal(lifecycleSim._comparisonOverlay, false);
assert.equal(lifecycleSim._courseState.predicted, false);
assert.equal(lifecycleSim._courseState.corrected, false);
assert.deepEqual(Object.keys(lifecycleSim._courseState.measurements), []);
assert.equal(lifecycleHarness.elements.get('mechanics-prediction-choice').value, '');
assert.equal(lifecycleHarness.elements.get('mechanics-prediction-relation').value, '');
assert.equal(lifecycleHarness.elements.get('mechanics-prediction-reason').value, '');
assert.equal(lifecycleHarness.elements.get('mechanics-correction-choice').value, '');
assert.equal(lifecycleHarness.elements.get('mechanics-model-limit').checked, false);
assert.equal(lifecycleHarness.elements.get('mechanics-measure-h-040').textContent, '待测');
assert.equal(lifecycleHarness.elements.get('mechanics-measure-ratio-040').textContent, '待测');
assert.equal(lifecycleHarness.elements.get('mechanics-measure-h-080').textContent, '待测');
assert.equal(lifecycleHarness.elements.get('mechanics-measure-ratio-080').textContent, '待测');
assert.equal(lifecycleHarness.elements.get('mechanics-course-stage').textContent, '等待预测');
assert.equal(
  lifecycleHarness.elements.get('mechanics-course-feedback').textContent,
  '完成预测后再运行两组受控观察。'
);
assert.equal(
  lifecycleHarness.elements.get('mechanics-course-feedback').dataset.feedbackState,
  undefined
);
assert.equal(lifecycleHarness.elements.get('physics-pause').textContent, '暂停');
assert.equal(lifecycleHarness.elements.get('ball-count').textContent, '0');
assert.equal(lifecycleHarness.elements.get('mechanics-prediction-submit').disabled, false);
assert.equal(lifecycleHarness.elements.get('mechanics-trial-040').disabled, true);
assert.equal(lifecycleHarness.elements.get('mechanics-trial-080').disabled, true);
assert.equal(lifecycleHarness.elements.get('mechanics-correction-submit').disabled, true);
assert.equal(lifecycleHarness.elements.get('mechanics-replay').disabled, true);
lifecycleHarness.elements.get('mechanics-prediction-choice').value = 'higher-080';
lifecycleHarness.elements.get('mechanics-prediction-relation').value = 'four-times';
lifecycleHarness.elements.get('mechanics-prediction-reason').value = '重新从干净预测开始。';
assert.equal(lifecycleSim._submitCoursePrediction(), true);
assert.equal(lifecycleHarness.events.length, eventsBeforeOwnerReopen + 1);
lifecycleSim.destroy();
assert.equal(lifecycleHarness.listenerCount(), 0);

const resizeHarness = createCourseHarness({ containerWidth: 1000 });
const resizeSim = resizeHarness.sim;
resizeSim.init();
resizeSim.render = () => {};
resizeSim.updateStats = () => {};
resizeHarness.elements.get('mechanics-prediction-choice').value = 'higher-080';
resizeHarness.elements.get('mechanics-prediction-relation').value = 'four-times';
resizeHarness.elements.get('mechanics-prediction-reason').value = '比较固定落高的第一次峰值。';
assert.equal(resizeSim._submitCoursePrediction(), true);
assert.equal(resizeSim.H, 560);
assert.equal(resizeSim._startControlledTrial(0.40), true);
const fixedGeometryTrial = resizeSim._controlledTrial;
resizeSim.resizeCanvas();
assert.equal(
  resizeSim._controlledTrial,
  fixedGeometryTrial,
  'an unchanged logical canvas size must not cancel the controlled trial'
);
assert.equal(resizeHarness.events.filter((event) => event.event_type === 'attempted').length, 0);
resizeHarness.canvasContainer.layoutWidth = 390;
const resizedGeometry = resizeSim.resizeCanvas();
assert.equal(resizedGeometry.width, 390);
assert.equal(resizedGeometry.height, 320);
assert.equal(resizeSim._controlledTrial, null);
assert.deepEqual(Array.from(resizeSim.balls), []);
assert.equal(resizeHarness.events.filter((event) => event.event_type === 'attempted').length, 0);
assert.equal(resizeHarness.elements.get('mechanics-trial-040').disabled, false);
assert.equal(
  resizeHarness.elements.get('mechanics-course-feedback').dataset.feedbackState,
  'retry'
);
assert.equal(
  resizeSim._startControlledTrial(0.40),
  true,
  'the cancelled preset must be immediately retryable at the new stable geometry'
);
resizeSim.destroy();

const beforeFreeLaunch = events.length;
sim.canvas = {};
sim.W = 640;
sim.H = 360;
sim.ballRadius = 16;
sim.palette = ['#fff'];
sim.balls = [];
sim.updateStats = () => {};
sim.launchBall({ x: 80, y: 90 }, { x: 40, y: 60 });
assert.equal(
  events.length,
  beforeFreeLaunch,
  'free drag-launch exploration must never append learning evidence'
);

const runtimeHarness = createCourseHarness();
const runtimeSim = runtimeHarness.sim;
assert.equal(runtimeSim._submitCoursePrediction(), true);
runtimeSim.canvas = {};
runtimeSim.W = 640;
runtimeSim.H = 360;
runtimeSim.updateStats = () => {};
runtimeSim.render = () => {};
for (const restitution of [0.40, 0.80]) {
  assert.equal(runtimeSim._startControlledTrial(restitution), true);
  for (let frame = 0; frame < 1200 && runtimeSim._controlledTrial; frame += 1) {
    runtimeSim.update(1 / 240);
  }
  assert.equal(runtimeSim._controlledTrial, null, `e=${restitution.toFixed(2)} must reach its first peak`);
}
assert.equal(runtimeHarness.events.filter((event) => event.event_type === 'attempted').length, 2);
assert.ok(
  Math.abs(runtimeSim._courseState.measurements['0.40'].ratio - 0.16) < 0.02,
  'the rendered e=.40 first peak must remain close to h/H=e²'
);
assert.ok(
  Math.abs(runtimeSim._courseState.measurements['0.80'].ratio - 0.64) < 0.02,
  'the rendered e=.80 first peak must remain close to h/H=e²'
);

assert.doesNotMatch(
  physicsSource,
  /event_type:\s*['"]completed['"]/,
  'the client must never write completed'
);
assert.match(
  indexSource,
  /data-mechanics-course[\s\S]*id="mechanics-prediction-submit"[\s\S]*id="mechanics-trial-040"[\s\S]*id="mechanics-trial-080"[\s\S]*id="mechanics-measurements"[\s\S]*id="mechanics-correction-submit"/,
  'the mechanics page must expose prediction, two controlled trials, an equivalent measurement table, and correction'
);
assert.match(
  indexSource,
  /id="mechanics-prediction-choice"><option value="">请选择<\/option>[\s\S]*id="mechanics-prediction-relation"><option value="">请选择<\/option>/,
  'prediction controls must not preload the correct answer'
);
assert.match(
  indexSource,
  /id="mechanics-measurements"[\s\S]*?<caption>[^<]*等价测量表[^<]*<\/caption>/,
  'Canvas observations need a visible equivalent table'
);
assert.match(
  physicsCss,
  /\.mechanics-course__action[\s\S]*?min-height:\s*44px/,
  'course actions need at least 44px hit targets'
);
assert.match(
  physicsCss,
  /@media \(max-width:\s*480px\)[\s\S]*?\.mechanics-course__trial-grid[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  'the controlled comparison must collapse to one shrinkable column on 390px'
);

console.log('physics mechanics evidence contract: controlled sequence, owner reset, resize retry, and free-exploration isolation ok');
