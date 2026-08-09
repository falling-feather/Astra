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
    this._attributes = new Map();
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.isConnected = true;
    this.textContent = '';
    this.dataset = {};
    this.style = {};
    this.focusCalls = 0;
    Object.assign(this, properties);
  }

  focus() { this.focusCalls += 1; }
  setAttribute(name, value) { this._attributes.set(name, String(value)); }
  getAttribute(name) { return this._attributes.has(name) ? this._attributes.get(name) : null; }
  removeAttribute(name) { this._attributes.delete(name); }

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

  emit(type, properties = {}) {
    const event = Object.assign({
      type,
      target: this,
      preventDefault() {},
      clientX: 0,
      clientY: 0,
    }, properties);
    for (const handler of this._listeners.get(type) || []) handler(event);
    return event;
  }

  listenerCount() {
    return [...this._listeners.values()].reduce((total, handlers) => total + handlers.size, 0);
  }

  closest() { return null; }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function evidenceResult(overrides = {}) {
  return Object.freeze({ outcome: 'confirmed', state: 'confirmed', ...overrides });
}

function createCourseHarness(options = {}) {
  const recordCalls = [];
  const authorityCalls = [];
  const resizeObservers = [];
  const commandReceipts = new WeakMap();
  let idSequence = 0;
  let active = true;
  let recordImpl = options.record || (async () => evidenceResult());
  let authorityImpl = options.authorize || (async expected => expected);
  let sim = null;

  const canvasContext = { setTransform() {} };
  const canvasContainer = new FakeElement({
    layoutWidth: Number(options.containerWidth) || 640,
    getBoundingClientRect() { return { width: this.layoutWidth }; },
  });
  const canvas = new FakeElement({
    parentElement: canvasContainer,
    getContext() { return canvasContext; },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: canvasContainer.layoutWidth };
    },
  });
  const explanation = new FakeElement({ disabled: true });
  const elements = new Map([
    ['mechanics-prediction-choice', new FakeElement()],
    ['mechanics-prediction-relation', new FakeElement()],
    ['mechanics-prediction-reason', new FakeElement()],
    ['mechanics-prediction-submit', new FakeElement()],
    ['mechanics-trial-040', new FakeElement({ disabled: true })],
    ['mechanics-trial-080', new FakeElement({ disabled: true })],
    ['mechanics-correction-choice', new FakeElement()],
    ['mechanics-model-limit', new FakeElement()],
    ['mechanics-correction-submit', new FakeElement({ disabled: true })],
    ['mechanics-replay', new FakeElement({ disabled: true })],
    ['mechanics-course-feedback', new FakeElement()],
    ['mechanics-course-stage', new FakeElement()],
    ['mechanics-measure-h-040', new FakeElement()],
    ['mechanics-measure-ratio-040', new FakeElement()],
    ['mechanics-measure-h-080', new FakeElement()],
    ['mechanics-measure-ratio-080', new FakeElement()],
    ['mechanics-measurements', new FakeElement()],
    ['mechanics-explanation-handoff', explanation],
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
  const contextValue = Object.freeze({
    available: true,
    class_id: 12,
    course_id: 23,
    course_unit_id: 34,
    activity_key: 'physics.mechanics',
    identity_id: 'student-7',
    authority_generation: 5,
    access_state: 'open',
  });
  const controller = {
    context: () => contextValue,
    async record(eventType, evidence, settings = {}) {
      assert.equal(
        sim.authorizeCourseRecord(eventType, evidence),
        true,
        'controller.record must only run under the exact owner permit'
      );
      const call = { event_type: eventType, evidence, settings: { ...settings } };
      recordCalls.push(call);
      const rawResult = await recordImpl(call, recordCalls.length);
      if (!rawResult || typeof rawResult !== 'object' || Array.isArray(rawResult)) return rawResult;
      const result = { ...rawResult };
      if (!Object.hasOwn(rawResult, 'client_event_id')) {
        result.client_event_id = settings.client_event_id;
      }
      if (!Object.hasOwn(rawResult, 'event_type')) result.event_type = eventType;
      return Object.freeze(result);
    },
    consumeCommandReceipt(receipt, expected) {
      const record = receipt && commandReceipts.get(receipt);
      if (
        !record
        || !expected
        || record.permit !== expected.permit
        || record.result !== expected.result
        || record.evidence !== expected.evidence
        || record.event_type !== expected.event_type
        || record.client_event_id !== expected.client_event_id
        || record.owner_generation !== expected.owner_generation
        || record.binding_generation !== expected.binding_generation
        || record.authority_generation !== expected.authority_generation
      ) return null;
      commandReceipts.delete(receipt);
      return record;
    },
    refreshCommands() {
      if (!sim) return;
      explanation.disabled = !sim.canUseCourseEvidenceCommand('explained');
      explanation.setAttribute('aria-disabled', explanation.disabled ? 'true' : 'false');
    },
  };
  const windowObject = new FakeElement({
    devicePixelRatio: 1,
    PhysicsZoom: { movedCanvas: null },
    crypto: { randomUUID: () => `mechanics-event-${++idSequence}` },
  });
  const context = {
    window: windowObject,
    document: {
      getElementById(id) { return elements.get(id) || null; },
      querySelector(selector) {
        return selector === '[data-evidence-command="explained"]' ? explanation : null;
      },
    },
    ResizeObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.disconnected = false;
        resizeObservers.push(this);
      }
      observe() {}
      disconnect() { this.disconnected = true; }
    },
    cancelAnimationFrame() {},
    requestAnimationFrame() { return 1; },
    performance: { now: () => 0 },
    CF: { sans: 'sans-serif' },
    console: { log() {}, warn() {}, error() {} },
    setTimeout(callback) { callback(); return 1; },
    clearTimeout() {},
    Date,
    Math,
  };
  vm.createContext(context);
  vm.runInContext(physicsSource, context, { filename: 'pages/physics/physics.js' });
  sim = vm.runInContext('PhysicsSim', context);
  sim.init();
  sim.render = () => {};
  sim.updateStats = () => {};

  const sameAuthority = (expected, current) => [
    'class_id', 'course_id', 'course_unit_id', 'activity_key',
    'identity_id', 'authority_generation', 'access_state',
  ].every(key => String(expected && expected[key]) === String(current && current[key]));
  const binding = {
    resolveAuthority: async expected => {
      authorityCalls.push(expected);
      return authorityImpl(expected, authorityCalls.length);
    },
    sameAuthority,
    isActive: () => active,
  };

  return {
    sim,
    elements,
    explanation,
    controller,
    binding,
    contextValue,
    recordCalls,
    authorityCalls,
    canvas,
    canvasContainer,
    resizeObservers,
    bind() { return sim.bindCourseEvidence(controller, binding); },
    setPrediction(choice = 'higher-080', relation = 'four-times', reason = '恢复系数改变反弹速度。') {
      elements.get('mechanics-prediction-choice').value = choice;
      elements.get('mechanics-prediction-relation').value = relation;
      elements.get('mechanics-prediction-reason').value = reason;
    },
    setRecordImpl(next) { recordImpl = next; },
    setAuthorityImpl(next) { authorityImpl = next; },
    setActive(next) { active = Boolean(next); },
    async recordExplanation(permit, evidence) {
      const result = await controller.record('explained', evidence, {
        client_event_id: permit.client_event_id,
      });
      const receipt = Object.freeze({});
      commandReceipts.set(receipt, Object.freeze({
        permit,
        result,
        evidence,
        event_type: 'explained',
        client_event_id: permit.client_event_id,
        owner_generation: permit.owner_generation,
        binding_generation: permit.binding_generation,
        authority_generation: permit.authority_generation,
      }));
      return Object.freeze({
        event_type: 'explained',
        evidence,
        result,
        permit,
        client_event_id: permit.client_event_id,
        receipt,
      });
    },
    listenerCount() {
      return windowObject.listenerCount()
        + [...elements.values()].reduce((total, element) => total + element.listenerCount(), 0);
    },
  };
}

async function completeTrial(harness, restitution, reboundHeight) {
  assert.equal(await harness.sim._startControlledTrial(restitution), true);
  const trial = harness.sim._controlledTrial;
  trial.completed = true;
  return harness.sim._recordControlledMeasurement(
    restitution,
    { dropHeight: 200, reboundHeight },
    trial
  );
}

function attemptedCalls(harness) {
  return harness.recordCalls.filter(call => call.event_type === 'attempted');
}

async function advanceToExplanation(harness) {
  harness.bind();
  harness.setPrediction();
  assert.equal(await harness.sim._submitCoursePrediction(), true);
  assert.equal(await completeTrial(harness, 0.40, 32), true);
  assert.equal(await completeTrial(harness, 0.80, 128), true);
  harness.elements.get('mechanics-correction-choice').value = 'height-follows-e-squared';
  harness.elements.get('mechanics-model-limit').checked = true;
  assert.equal(await harness.sim._submitCourseCorrection(), true);
  assert.equal(harness.sim._courseState.stage, 'P7_EXPLAIN');
}

async function main() {
  const harness = createCourseHarness();
  const { sim, elements, recordCalls } = harness;

  assert.equal(elements.get('mechanics-prediction-submit').disabled, true);
  assert.equal(elements.get('mechanics-prediction-choice').disabled, true);
  assert.equal(elements.get('mechanics-trial-040').disabled, true);
  assert.equal(elements.get('mechanics-trial-080').disabled, true);
  harness.setPrediction();
  assert.equal(await sim._submitCoursePrediction(), false, 'an unmounted owner must be fail closed');
  assert.equal(recordCalls.length, 0);

  assert.equal(harness.bind(), true);
  assert.equal(elements.get('mechanics-prediction-submit').disabled, false);
  assert.equal(elements.get('mechanics-prediction-choice').disabled, false);
  assert.match(elements.get('mechanics-course-feedback').textContent, /不会把离散历史拼成/);
  assert.equal(await sim._startControlledTrial(0.40), false, 'prediction is required before either trial');
  assert.equal(await sim._startControlledTrial(0.80), false, 'e=.80 cannot run before prediction');

  harness.setPrediction();
  assert.equal(await sim._submitCoursePrediction(), true);
  assert.equal(sim._courseState.stage, 'P1_READY_040');
  assert.equal(elements.get('mechanics-trial-040').disabled, false);
  assert.equal(elements.get('mechanics-trial-040').getAttribute('aria-disabled'), 'false');
  assert.equal(elements.get('mechanics-trial-080').disabled, true);
  assert.equal(elements.get('mechanics-trial-080').getAttribute('aria-disabled'), 'true');
  assert.equal(await sim._startControlledTrial(0.80), false, 'MECH-01: direct e=.80 must fail before e=.40');
  assert.deepEqual(recordCalls.map(call => call.event_type), ['predicted']);

  assert.equal(await sim._startControlledTrial(0.40), true);
  assert.equal(sim._courseState.stage, 'P2_RUNNING_040');
  const trial040 = sim._controlledTrial;
  const controlledBall040 = sim.balls[0];
  assert.deepEqual(
    {
      dropHeight: trial040.dropHeight,
      gravity: controlledBall040.gravity,
      radius: controlledBall040.r,
      vx: controlledBall040.vx,
      damping: controlledBall040.friction,
      restitution: controlledBall040.restitution,
    },
    { dropHeight: 200, gravity: 980, radius: 16, vx: 0, damping: 0, restitution: 0.4 }
  );
  assert.equal(await sim._startControlledTrial(0.40), false, 'the running preset cannot duplicate');
  assert.equal(await sim._startControlledTrial(0.80), false, 'the later preset cannot overlap');
  trial040.completed = true;
  assert.equal(
    await sim._recordControlledMeasurement(0.40, { dropHeight: 200, reboundHeight: 32 }, trial040),
    true
  );
  assert.equal(sim._courseState.stage, 'P3_SNAPSHOT_040');
  assert.equal(elements.get('mechanics-trial-040').disabled, true);
  assert.equal(elements.get('mechanics-trial-080').disabled, false);
  assert.equal(
    await sim._recordControlledMeasurement(0.40, { dropHeight: 200, reboundHeight: 32 }, trial040),
    false,
    'an accepted preset cannot append twice'
  );

  assert.equal(await completeTrial(harness, 0.80, 128), true);
  assert.equal(sim._courseState.stage, 'P5_COMPARE');
  assert.equal(elements.get('mechanics-measure-h-040').textContent, '32.0 px');
  assert.equal(elements.get('mechanics-measure-ratio-040').textContent, '0.16');
  assert.equal(elements.get('mechanics-measure-h-080').textContent, '128.0 px');
  assert.equal(elements.get('mechanics-measure-ratio-080').textContent, '0.64');
  assert.equal(elements.get('mechanics-correction-choice').disabled, false);
  assert.equal(elements.get('mechanics-model-limit').disabled, false);
  assert.equal(harness.explanation.disabled, true, 'explanation remains closed before correction');

  elements.get('mechanics-correction-choice').value = 'height-follows-e-squared';
  elements.get('mechanics-model-limit').checked = true;
  assert.equal(await sim._submitCourseCorrection(), true);
  assert.equal(sim._courseState.stage, 'P7_EXPLAIN');
  assert.equal(elements.get('mechanics-correction-choice').disabled, true);
  assert.equal(elements.get('mechanics-model-limit').disabled, true);
  assert.equal(harness.explanation.disabled, false);
  assert.equal(harness.explanation.getAttribute('aria-disabled'), 'false');
  assert.equal(harness.explanation.focusCalls, 1);

  const explainedEvidence = {
    artifact: { kind: 'claim-evidence-link', value: 'claim-supported' },
    cursor: { stage: 'explained' },
  };
  const explanationPermit = sim.beginCourseEvidenceCommand({
    event_type: 'explained',
    evidence: explainedEvidence,
  });
  assert.ok(explanationPermit && explanationPermit.client_event_id);
  assert.equal(
    sim.beginCourseEvidenceCommand({ event_type: 'explained', evidence: explainedEvidence }),
    null,
    'double click must not open a second explanation request'
  );
  const forgedResult = evidenceResult();
  assert.equal(sim.completeCourseEvidenceCommand({
    event_type: 'explained',
    evidence: explainedEvidence,
    result: forgedResult,
    permit: explanationPermit,
    client_event_id: explanationPermit.client_event_id,
  }), false, 'a plain confirmed result without the activity record receipt is not authoritative');
  assert.equal(sim._courseState.stage, 'P7_EXPLAIN');
  assert.equal(recordCalls.length, 4, 'a forged callback cannot invent the explained event');

  const explainedCompletion = await harness.recordExplanation(explanationPermit, explainedEvidence);
  assert.equal(sim.completeCourseEvidenceCommand({
    ...explainedCompletion,
    client_event_id: 'wrong-event-id',
  }), false, 'a receipt cannot authorize a different client_event_id');
  assert.equal(sim.completeCourseEvidenceCommand({
    ...explainedCompletion,
    evidence: { ...explainedEvidence },
  }), false, 'a receipt cannot authorize different evidence');
  assert.equal(sim.completeCourseEvidenceCommand({
    ...explainedCompletion,
    result: evidenceResult(),
  }), false, 'a receipt cannot authorize a different result object');
  assert.equal(sim.completeCourseEvidenceCommand({
    ...explainedCompletion,
    event_type: 'corrected',
  }), false, 'a receipt cannot authorize a different event type');
  assert.equal(sim._courseState.stage, 'P7_EXPLAIN');
  assert.equal(sim.completeCourseEvidenceCommand(explainedCompletion), true);
  assert.equal(
    sim.completeCourseEvidenceCommand(explainedCompletion),
    false,
    'the activity-issued receipt is one-use and a duplicate callback cannot advance twice'
  );
  assert.equal(sim._courseState.stage, 'P8_AWAIT_COMPLETION');
  assert.match(elements.get('mechanics-course-feedback').textContent, /最终状态只认.*服务端/);
  assert.equal(harness.explanation.disabled, true);
  assert.equal(elements.get('mechanics-prediction-submit').disabled, false);
  assert.match(elements.get('mechanics-prediction-submit').textContent, /重新开始/);

  const firstGroupIds = recordCalls.map(call => call.settings.client_event_id);
  assert.equal(await sim._redoCourseGroup(), true);
  assert.equal(sim._courseState.stage, 'P0_AWAIT_PREDICTION');
  assert.equal(elements.get('mechanics-measure-h-040').textContent, '待测');
  assert.equal(elements.get('mechanics-measure-h-080').textContent, '待测');
  harness.setPrediction('higher-040', 'two-times', '我要开始一个新的受控组。');
  assert.equal(await sim._submitCoursePrediction(), true);
  const secondPredictionId = recordCalls.at(-1).settings.client_event_id;
  assert.notEqual(secondPredictionId, firstGroupIds[0], 'explicit redo must use a new event id');
  assert.equal(recordCalls.length, 6, 'redo must append instead of replacing earlier events');

  assert.deepEqual(
    recordCalls.slice(0, 5).map(call => call.event_type),
    ['predicted', 'attempted', 'attempted', 'corrected', 'explained']
  );
  const attempted = attemptedCalls(harness);
  assert.deepEqual(attempted.map(call => call.evidence.cursor.trial), [40, 80]);
  assert.deepEqual(JSON.parse(JSON.stringify(attempted.map(call => call.evidence.cursor.preset))), [
    {
      restitution: 0.4,
      drop_height_px: 200,
      gravity_px_s2: 980,
      radius_px: 16,
      horizontal_velocity_px_s: 0,
      damping: 0,
    },
    {
      restitution: 0.8,
      drop_height_px: 200,
      gravity_px_s2: 980,
      radius_px: 16,
      horizontal_velocity_px_s: 0,
      damping: 0,
    },
  ]);
  attempted.forEach(call => {
    assert.equal(Object.keys(call.evidence.cursor).length, 4);
    assert.equal(call.evidence.operation, 'restitution_adjustment');
    assert.equal(call.evidence.cursor.stage, 'after-observation');
  });
  assert.equal(recordCalls[0].evidence.prediction.reason_size, 11);
  assert.equal(Object.hasOwn(recordCalls[0].evidence.prediction, 'reason'), false);
  assert.equal(recordCalls.some(call => call.event_type === 'completed'), false);

  const retry = createCourseHarness();
  retry.bind();
  retry.setPrediction();
  let retryAttempt = 0;
  retry.setRecordImpl(async () => {
    retryAttempt += 1;
    if (retryAttempt === 1) {
      const error = new Error('offline');
      error.code = 'network_error';
      throw error;
    }
    return evidenceResult();
  });
  assert.equal(await retry.sim._submitCoursePrediction(), false);
  assert.equal(retry.sim._courseState.stage, 'P0_AWAIT_PREDICTION');
  assert.equal(await retry.sim._submitCoursePrediction(), true);
  assert.equal(retry.recordCalls.length, 2);
  assert.equal(
    retry.recordCalls[0].settings.client_event_id,
    retry.recordCalls[1].settings.client_event_id,
    'a failed request retry must reuse client_event_id'
  );

  const concurrent = createCourseHarness();
  concurrent.bind();
  concurrent.setPrediction();
  const pendingRecord = deferred();
  concurrent.setRecordImpl(() => pendingRecord.promise);
  const firstPrediction = concurrent.sim._submitCoursePrediction();
  const duplicatePrediction = concurrent.sim._submitCoursePrediction();
  assert.equal(await duplicatePrediction, false);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(concurrent.recordCalls.length, 1, 'double click must create one request only');
  assert.equal(concurrent.elements.get('mechanics-prediction-submit').disabled, true);
  assert.equal(concurrent.elements.get('mechanics-trial-040').disabled, true);
  assert.equal(concurrent.elements.get('mechanics-trial-080').disabled, true);
  assert.equal(concurrent.elements.get('mechanics-correction-submit').disabled, true);
  assert.equal(concurrent.elements.get('gravity-slider').disabled, false, 'free exploration remains available while authority is pending');
  pendingRecord.resolve(evidenceResult());
  assert.equal(await firstPrediction, true);

  const invalidExplanationResults = [
    ['wrong client id', call => evidenceResult({
      client_event_id: `${call.settings.client_event_id}-wrong`,
      event_type: call.event_type,
    })],
    ['missing client id', call => evidenceResult({
      client_event_id: undefined,
      event_type: call.event_type,
    })],
    ['wrong event type', call => evidenceResult({
      client_event_id: call.settings.client_event_id,
      event_type: 'corrected',
    })],
    ['missing event type', call => evidenceResult({
      client_event_id: call.settings.client_event_id,
      event_type: undefined,
    })],
    ['contradictory terminal', call => evidenceResult({
      outcome: 'manual-intervention',
      state: 'confirmed',
      client_event_id: call.settings.client_event_id,
      event_type: call.event_type,
    })],
  ];
  for (const [label, invalidResult] of invalidExplanationResults) {
    const strict = createCourseHarness({
      record: async call => call.event_type === 'explained'
        ? invalidResult(call)
        : evidenceResult(),
    });
    await advanceToExplanation(strict);
    const invalidPermit = strict.sim.beginCourseEvidenceCommand({
      event_type: 'explained',
      evidence: explainedEvidence,
    });
    const invalidCompletion = await strict.recordExplanation(invalidPermit, explainedEvidence);
    assert.equal(strict.sim.completeCourseEvidenceCommand(invalidCompletion), false, `${label} cannot advance P7`);
    assert.equal(strict.sim._courseState.stage, 'P7_EXPLAIN');
    assert.equal(strict.sim._courseActionInFlight, false, `${label} releases owner busy`);
    assert.equal(strict.explanation.disabled, false, `${label} leaves an explicit retry available`);
    const retainedId = invalidPermit.client_event_id;
    strict.setRecordImpl(async () => evidenceResult());
    const retryPermit = strict.sim.beginCourseEvidenceCommand({
      event_type: 'explained',
      evidence: explainedEvidence,
    });
    assert.equal(retryPermit.client_event_id, retainedId, `${label} retry reuses the exact event id`);
    const retryCompletion = await strict.recordExplanation(retryPermit, explainedEvidence);
    assert.equal(strict.sim.completeCourseEvidenceCommand(retryCompletion), true, `${label} correct retry advances once`);
    assert.equal(strict.sim._courseState.stage, 'P8_AWAIT_COMPLETION');
  }

  for (const contradictoryResult of [
    evidenceResult({ outcome: 'queued', state: 'confirmed' }),
    evidenceResult({ outcome: 'confirmed', state: 'local-pending' }),
  ]) {
    const contradictory = createCourseHarness({ record: async () => contradictoryResult });
    contradictory.bind();
    contradictory.setPrediction();
    assert.equal(await contradictory.sim._submitCoursePrediction(), false);
    assert.equal(contradictory.sim._courseState.stage, 'P0_AWAIT_PREDICTION');
    assert.equal(contradictory.elements.get('mechanics-trial-040').disabled, true);
  }

  let queuedPredictionCalls = 0;
  const queued = createCourseHarness({
    record: async call => {
      if (call.event_type === 'predicted' && queuedPredictionCalls++ === 0) {
        return evidenceResult({ outcome: 'queued', state: 'local-pending' });
      }
      return evidenceResult();
    },
  });
  queued.bind();
  queued.setPrediction();
  assert.equal(await queued.sim._submitCoursePrediction(), false);
  assert.equal(queued.sim._courseState.stage, 'P0_AWAIT_PREDICTION');
  assert.equal(queued.elements.get('mechanics-trial-040').disabled, true);
  assert.equal(queued.elements.get('mechanics-trial-080').disabled, true);
  assert.equal(queued.elements.get('mechanics-correction-submit').disabled, true);
  assert.equal(queued.elements.get('gravity-slider').disabled, false, 'free exploration remains independent while evidence is queued');
  queued.elements.get('gravity-slider').value = 900;
  queued.elements.get('gravity-slider').emit('input');
  assert.equal(queued.sim._courseState.stage, 'P0_AWAIT_PREDICTION');
  assert.equal(queued.recordCalls.length, 1, 'free exploration cannot append or advance a queued course action');
  assert.equal(await queued.sim._submitCoursePrediction(), true);
  assert.equal(queued.sim._courseState.stage, 'P1_READY_040');
  assert.equal(queued.recordCalls[0].settings.client_event_id, queued.recordCalls[1].settings.client_event_id);

  let queuedAttemptCalls = 0;
  queued.setRecordImpl(async call => {
    if (call.event_type === 'attempted' && queuedAttemptCalls++ === 0) {
      return evidenceResult({ outcome: 'queued', state: 'local-pending' });
    }
    return evidenceResult();
  });
  assert.equal(await completeTrial(queued, 0.40, 32), false);
  assert.equal(queued.sim._courseState.stage, 'P1_READY_040');
  assert.equal(queued.sim._courseState.measurements['0.40'], undefined);
  assert.equal(queued.elements.get('mechanics-trial-080').disabled, true);
  assert.equal(attemptedCalls(queued).length, 1);
  assert.equal(await completeTrial(queued, 0.40, 32), true);
  assert.equal(queued.sim._courseState.stage, 'P3_SNAPSHOT_040');
  assert.equal(attemptedCalls(queued).length, 2);
  assert.equal(
    attemptedCalls(queued)[0].settings.client_event_id,
    attemptedCalls(queued)[1].settings.client_event_id,
    'queued retry must preserve the original controlled-attempt client_event_id'
  );

  let queuedManualCalls = 0;
  const queuedManual = createCourseHarness({
    record: async () => queuedManualCalls++ === 0
      ? evidenceResult({ outcome: 'queued', state: 'local-pending' })
      : evidenceResult({ outcome: 'manual-intervention', state: 'manual-intervention' }),
  });
  queuedManual.bind();
  queuedManual.setPrediction();
  assert.equal(await queuedManual.sim._submitCoursePrediction(), false);
  assert.equal(await queuedManual.sim._submitCoursePrediction(), false);
  assert.equal(queuedManual.sim._courseState.stage, 'P0_AWAIT_PREDICTION');
  assert.equal(queuedManual.sim._courseState.blocked, true, 'queued to manual must fail closed');
  assert.equal(queuedManual.elements.get('mechanics-prediction-submit').disabled, true);

  const queuedStale = createCourseHarness({
    record: async () => evidenceResult({ outcome: 'queued', state: 'local-pending' }),
  });
  queuedStale.bind();
  queuedStale.setPrediction();
  assert.equal(await queuedStale.sim._submitCoursePrediction(), false);
  queuedStale.setActive(false);
  assert.equal(await queuedStale.sim._submitCoursePrediction(), false);
  assert.equal(queuedStale.recordCalls.length, 1, 'a queued action cannot retry after route/identity authority is stale');
  assert.equal(queuedStale.sim._courseState.stage, 'P0_AWAIT_PREDICTION');
  assert.equal(queuedStale.elements.get('mechanics-prediction-submit').disabled, true);

  const queuedReload = createCourseHarness({
    record: async () => evidenceResult({ outcome: 'queued', state: 'local-pending' }),
  });
  queuedReload.bind();
  queuedReload.setPrediction();
  assert.equal(await queuedReload.sim._submitCoursePrediction(), false);
  const queuedReloadId = queuedReload.recordCalls[0].settings.client_event_id;
  queuedReload.sim.destroy();
  queuedReload.sim.init();
  assert.equal(queuedReload.sim._courseState.stage, 'P0_AWAIT_PREDICTION');
  assert.equal(queuedReload.sim._courseState.prediction, null);
  assert.equal(queuedReload.recordCalls.length, 1);
  assert.equal(queuedReload.recordCalls[0].settings.client_event_id, queuedReloadId, 'the queued record keeps its client id outside page state');

  const manual = createCourseHarness();
  manual.bind();
  manual.setPrediction();
  manual.setAuthorityImpl(async () => {
    const error = new Error('manual');
    error.code = 'pending_recovery_manual_intervention';
    throw error;
  });
  assert.equal(await manual.sim._submitCoursePrediction(), false);
  assert.equal(manual.recordCalls.length, 0, 'manual intervention must block before controller/API record');
  assert.equal(manual.sim._courseState.blocked, true);
  assert.match(manual.elements.get('mechanics-course-stage').textContent, /只读/);
  assert.equal(manual.elements.get('mechanics-course-feedback').getAttribute('role'), 'alert');
  for (const id of [
    'mechanics-prediction-choice', 'mechanics-prediction-relation', 'mechanics-prediction-reason',
    'mechanics-prediction-submit', 'mechanics-trial-040', 'mechanics-trial-080',
    'mechanics-correction-choice', 'mechanics-model-limit', 'mechanics-correction-submit',
  ]) assert.equal(manual.elements.get(id).disabled, true, `${id} must be really disabled`);
  assert.equal(manual.sim.beginCourseEvidenceCommand({ event_type: 'explained', evidence: explainedEvidence }), null);

  const lateExplanation = createCourseHarness();
  await advanceToExplanation(lateExplanation);
  const latePermit = lateExplanation.sim.beginCourseEvidenceCommand({
    event_type: 'explained',
    evidence: explainedEvidence,
  });
  const lateCompletion = await lateExplanation.recordExplanation(latePermit, explainedEvidence);
  lateExplanation.setActive(false);
  lateExplanation.sim._courseGeneration += 1;
  assert.equal(
    lateExplanation.sim.completeCourseEvidenceCommand(lateCompletion),
    false,
    'a terminal explanation callback from an old owner/authority generation is ignored'
  );
  assert.equal(lateExplanation.sim._courseState.stage, 'P7_EXPLAIN');

  const stale = createCourseHarness();
  stale.bind();
  stale.setPrediction();
  const staleRecord = deferred();
  stale.setRecordImpl(() => staleRecord.promise);
  const staleAction = stale.sim._submitCoursePrediction();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stale.recordCalls.length, 1);
  stale.setActive(false);
  staleRecord.resolve(evidenceResult());
  assert.equal(await staleAction, false);
  assert.equal(stale.sim._courseState.stage, 'P0_AWAIT_PREDICTION', 'late success cannot advance an inactive owner');
  assert.equal(stale.elements.get('mechanics-prediction-submit').disabled, true);

  const cancelled = createCourseHarness();
  cancelled.bind();
  cancelled.setPrediction();
  assert.equal(await cancelled.sim._submitCoursePrediction(), true);
  assert.equal(await cancelled.sim._startControlledTrial(0.40), true);
  cancelled.sim.resetScene();
  assert.equal(cancelled.sim._courseState.stage, 'P1_READY_040');
  assert.equal(attemptedCalls(cancelled).length, 0);
  assert.equal(await cancelled.sim._startControlledTrial(0.40), true);
  cancelled.elements.get('gravity-slider').value = 900;
  cancelled.elements.get('gravity-slider').emit('input');
  assert.equal(cancelled.sim._courseState.stage, 'P1_READY_040');
  assert.equal(attemptedCalls(cancelled).length, 0);
  assert.equal(await cancelled.sim._startControlledTrial(0.40), true);
  assert.equal(cancelled.sim.launchBall({ x: 80, y: 90 }, { x: 40, y: 60 }), false);
  assert.equal(cancelled.sim._courseState.stage, 'P1_READY_040');
  assert.equal(attemptedCalls(cancelled).length, 0);
  assert.equal(await cancelled.sim._startControlledTrial(0.40), true);
  cancelled.canvasContainer.layoutWidth = 390;
  cancelled.sim.resizeCanvas();
  assert.equal(cancelled.sim._courseState.stage, 'P1_READY_040');
  assert.equal(cancelled.sim._controlledTrial, null);
  assert.equal(attemptedCalls(cancelled).length, 0);
  assert.equal(await cancelled.sim._startControlledTrial(0.40), true);
  const tamperedTrial = cancelled.sim._controlledTrial;
  tamperedTrial.completed = true;
  tamperedTrial.gravity = 981;
  assert.equal(
    await cancelled.sim._recordControlledMeasurement(0.40, { dropHeight: 200, reboundHeight: 32 }, tamperedTrial),
    false
  );
  assert.equal(attemptedCalls(cancelled).length, 0, 'tampered fixed conditions never write attempted');
  assert.equal(cancelled.sim._courseState.stage, 'P1_READY_040');

  const free = createCourseHarness();
  free.bind();
  free.setPrediction();
  assert.equal(await free.sim._submitCoursePrediction(), true);
  assert.equal(await completeTrial(free, 0.40, 32), true);
  const beforeFree = free.recordCalls.length;
  const stageBeforeFree = free.sim._courseState.stage;
  free.sim.ballRadius = 16;
  free.sim.palette = ['#fff'];
  assert.equal(free.sim.launchBall({ x: 80, y: 90 }, { x: 40, y: 60 }), true);
  assert.equal(free.recordCalls.length, beforeFree);
  assert.equal(free.sim._courseState.stage, stageBeforeFree);

  const runtime = createCourseHarness();
  runtime.bind();
  runtime.setPrediction();
  assert.equal(await runtime.sim._submitCoursePrediction(), true);
  for (const restitution of [0.40, 0.80]) {
    assert.equal(await runtime.sim._startControlledTrial(restitution), true);
    for (let frame = 0; frame < 1200 && !runtime.sim._controlledTrial?.completed; frame += 1) {
      runtime.sim.update(1 / 240);
    }
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(runtime.sim._controlledTrial, null, `e=${restitution.toFixed(2)} must finish one first peak`);
  }
  assert.ok(Math.abs(runtime.sim._courseState.measurements['0.40'].ratio - 0.16) < 0.02);
  assert.ok(Math.abs(runtime.sim._courseState.measurements['0.80'].ratio - 0.64) < 0.02);

  const lifecycle = createCourseHarness();
  const firstListenerCount = lifecycle.listenerCount();
  assert.ok(firstListenerCount > 0);
  lifecycle.bind();
  lifecycle.setPrediction();
  assert.equal(await lifecycle.sim._submitCoursePrediction(), true);
  const callsBeforeDestroy = lifecycle.recordCalls.length;
  lifecycle.sim.destroy();
  assert.equal(lifecycle.listenerCount(), 0);
  assert.equal(lifecycle.resizeObservers[0].disconnected, true);
  lifecycle.sim.init();
  assert.equal(lifecycle.listenerCount(), firstListenerCount);
  assert.equal(lifecycle.recordCalls.length, callsBeforeDestroy);
  assert.equal(lifecycle.sim._courseState.stage, 'P0_AWAIT_PREDICTION');
  assert.equal(lifecycle.elements.get('mechanics-prediction-submit').disabled, true);
  assert.equal(lifecycle.elements.get('mechanics-measure-h-040').textContent, '待测');

  assert.doesNotMatch(physicsSource, /event_type:\s*['"]completed['"]/);
  assert.match(
    indexSource,
    /data-mechanics-course[\s\S]*id="mechanics-prediction-submit"[\s\S]*id="mechanics-trial-040"[\s\S]*id="mechanics-trial-080"[\s\S]*id="mechanics-measurements"[\s\S]*id="mechanics-correction-submit"/
  );
  assert.match(
    indexSource,
    /id="mechanics-prediction-choice"><option value="">请选择<\/option>[\s\S]*id="mechanics-prediction-relation"><option value="">请选择<\/option>/
  );
  assert.match(indexSource, /id="mechanics-measurements"[\s\S]*?<caption>[^<]*等价测量表[^<]*<\/caption>/);
  assert.match(physicsCss, /\.mechanics-course__action[\s\S]*?min-height:\s*44px/);
  assert.match(
    physicsCss,
    /@media \(max-width:\s*480px\)[\s\S]*?\.mechanics-course__trial-grid[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/
  );

  console.log('physics mechanics evidence contract: P0-P8 sequence, authoritative terminal retry, receipt integrity, redo, cancellation, a11y, and free isolation ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
