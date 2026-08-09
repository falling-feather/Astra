const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const catalogSource = read('shared/js/learning-activity-catalog.js');
const activitySource = read('shared/js/learning-evidence-activity.js');
const clientSource = read('shared/js/learning-evidence-client.js');
const queueSource = read('shared/js/learning-evidence-queue.js');
const manifestSource = read('pages/frontier/frontier-manifest.js');
const publicationSource = read('shared/js/frontier-publication-context.js');
const frontierSource = read('shared/js/frontier-learning.js');
const bridgeSource = read('pages/engineering/bridge-truss.js');

function execute(source, context, filename) {
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename });
  return context;
}

function json(value) {
  return JSON.parse(JSON.stringify(value));
}

function response(payload, ok = true) {
  return { ok, json: async () => payload };
}

async function testUniqueRepresentativeAndDomainOnlyPanel() {
  const catalogContext = execute(catalogSource, {
    console,
    AstraExperimentRegistry: { entries: () => [] },
  }, 'learning-activity-catalog.js');
  const future = catalogContext.AstraLearningActivityCatalog.entries('future-galaxy');
  assert.equal(future.length, 18, 'Future catalog cardinality must stay frozen at 18');
  assert.deepEqual(
    Array.from(future.filter((entry) => entry.representative), (entry) => entry.activity_key),
    ['engineering.load-path'],
    'engineering.load-path must be the sole Future representative',
  );
  assert.equal(catalogContext.AstraLearningActivityCatalog.verify()['future-galaxy'].valid, true);

  const instrumented = activitySource.replace(
    'global.AstraLearningEvidenceActivity = Object.freeze({',
    'global.__fe024PanelMarkup = panelMarkup;\n    global.AstraLearningEvidenceActivity = Object.freeze({',
  );
  assert.notEqual(instrumented, activitySource, 'activity panel instrumentation must apply');
  const activityContext = execute(instrumented, { console }, 'learning-evidence-activity.js');
  const domainOnly = activityContext.__fe024PanelMarkup({ domainOnly: true, integrated: true });
  const physicsDefault = activityContext.__fe024PanelMarkup({ integrated: true });
  const codeDefault = activityContext.__fe024PanelMarkup({});
  assert.doesNotMatch(domainOnly, /data-evidence-command|data-evidence-free-text/, 'domain-only must be status/projection only');
  assert.match(physicsDefault, /data-evidence-command="explained"/, 'integrated Physics default keeps its structured explanation path');
  assert.match(physicsDefault, /data-evidence-free-text/, 'integrated default keeps its online text path');
  assert.match(codeDefault, /data-evidence-command="predicted"/, 'CodeVis/default panel keeps its prediction path');
  assert.match(codeDefault, /data-evidence-command="explained"/, 'CodeVis/default panel keeps its explanation path');
}

async function testBoundedPendingAccessor() {
  const records = [];
  let listDeferred = null;
  const queue = {
    async configureIdentity() {},
    subscribe() { return () => {}; },
    async list() {
      if (listDeferred) return listDeferred.promise;
      return records;
    },
    async clearAuthority() {},
    async releaseLease() {},
  };
  const listeners = new Map();
  const context = execute(clientSource, {
    console,
    TextEncoder,
    AbortController,
    URL,
    crypto: require('node:crypto').webcrypto,
    AstraLearningEvidenceQueue: queue,
    AstraApiClient: {
      isOffline: () => true,
      normalizeError: (error) => error,
    },
    addEventListener(name, handler) { listeners.set(name, handler); },
    removeEventListener(name) { listeners.delete(name); },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  }, 'learning-evidence-client.js');
  await context.AstraLearningEvidenceClient.configureIdentity({ id: 41, role: 'student' });
  const scope = { class_id: 7, course_id: 22, course_unit_id: 203, activity_key: 'engineering.load-path' };
  const base = {
    class_id: 7,
    course_id: 22,
    course_unit_id: 203,
    activity_key: 'engineering.load-path',
    rule_version: 3,
  };
  records.push(
    {
      state: 'local-pending', created_at: 30,
      payload: { ...base, assignment_id: 5, client_event_id: 'event-predicted-0001', event_type: 'predicted', occurred_at: '2026-08-09T08:00:02.000Z', evidence: { prediction: { reaction_balance_id: 'more-balanced', gh_change_id: 'absolute-increase', cd_change_id: 'absolute-increase', reason_size: 18 } } },
    },
    {
      state: 'syncing', created_at: 10,
      payload: { ...base, client_event_id: 'event-started-000001', event_type: 'started', occurred_at: '2026-08-09T08:00:00.000Z', evidence: { cursor: { surface: 'future-galaxy', stage: 'entered' } } },
    },
    {
      state: 'manual-intervention', created_at: 20,
      payload: { ...base, course_id: 99, client_event_id: 'event-other-scope-01', event_type: 'started', occurred_at: '2026-08-09T08:00:01.000Z', evidence: { cursor: { surface: 'future-galaxy', stage: 'entered' } } },
    },
  );
  const pending = await context.AstraLearningEvidenceClient.pendingFor(scope);
  assert.deepEqual(Array.from(pending, (record) => record.payload.event_type), ['started', 'predicted']);
  assert.equal(Object.isFrozen(pending), true);
  assert.equal(Object.isFrozen(pending[0].payload.evidence.cursor), true, 'returned pending evidence must be deeply frozen');
  assert.equal('assignment_id' in pending[0].payload, false, 'missing assignment_id must stay omitted');
  assert.equal(pending[1].payload.assignment_id, 5, 'a valid assignment_id must survive safe export');
  assert.equal('namespace' in pending[0], false, 'queue namespace/identity metadata must not escape the client');

  records.push({
    state: 'manual-intervention', created_at: 35,
    payload: { ...base, client_event_id: 'event-conflict-00001', event_type: 'attempted', occurred_at: '2026-08-09T08:00:02.500Z', evidence: { operation: { action_id: 'run-fixed-load-case', load_node_id: 'B', load_kn: 60 }, observation: { load_node_id: 'B', load_kn: 60, reaction_ay_kn: 45, reaction_ey_kn: 15, member_gh_kn: -30, member_cd_kn: 22.5, member_gh_type_id: 'compression', member_cd_type_id: 'tension', residual_fx_kn: 0, residual_fy_kn: 0 } } },
  });
  await assert.rejects(
    () => context.AstraLearningEvidenceClient.pendingFor(scope),
    (error) => error && error.code === 'pending_recovery_manual_intervention',
    'an exact-scope manual intervention must block recovery instead of disappearing from the accessor',
  );
  records.pop();

  records.push({
    state: 'local-pending', created_at: 40,
    payload: { ...base, client_event_id: 'event-sensitive-001', event_type: 'explained', occurred_at: '2026-08-09T08:00:03.000Z', evidence: { artifact: { comment: 'private prose' }, cursor: { stage: 'explained' } } },
  });
  await assert.rejects(() => context.AstraLearningEvidenceClient.pendingFor(scope), (error) => error && error.code === 'pending_recovery_schema_invalid');
  records.pop();

  let resolveList;
  listDeferred = { promise: new Promise((resolve) => { resolveList = resolve; }) };
  const stale = context.AstraLearningEvidenceClient.pendingFor(scope);
  await context.AstraLearningEvidenceClient.clearAuthority('identity-changed');
  resolveList(records);
  await assert.rejects(() => stale, (error) => error && error.code === 'cancelled', 'identity loss during read must discard pending payloads');
}

async function testPrivateFutureUnitAuthority() {
  const courseIds = {
    'earth-space': 101,
    'engineering-systems': 102,
    'data-ai': 103,
    'information-technology': 104,
    'materials-science': 105,
    'humanities-futures': 106,
  };
  const currentUser = { value: { id: 41, role: 'student' } };
  const context = {
    console,
    URL,
    AbortController,
    location: { origin: 'https://astra.test', hash: '#engineering/load-path' },
    history: { replaceState() {} },
    addEventListener() {},
    removeEventListener() {},
    AstraApplicationSession: { getUser: () => currentUser.value },
    AstraStudentCourseCatalogue: { allowsActivity: () => true },
  };
  context.fetch = async (url) => {
    const value = String(url);
    if (value.startsWith('/api/classes')) return response([{ id: 7 }]);
    if (value.startsWith('/api/courses?')) {
      return response(Object.entries(courseIds).map(([course_key, id]) => ({ id, galaxy_key: 'future-galaxy', course_key })));
    }
    const match = value.match(/^\/api\/courses\/(\d+)\/units/);
    if (!match) throw new Error(`unexpected request ${value}`);
    const courseId = Number(match[1]);
    if (courseId === 102) {
      return response([{ id: 203, activity_key: 'engineering.load-path', title: '载荷路径', position: 1, lock_reasons: [], effective_release_state: 'open' }]);
    }
    return response([]);
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(manifestSource, context, { filename: 'frontier-manifest.js' });
  vm.runInContext(publicationSource, context, { filename: 'frontier-publication-context.js' });
  await context.FutureGalaxyPublicationContext.bootstrap(currentUser.value);
  const mapping = { galaxy_key: 'future-galaxy', course_key: 'engineering-systems', activity_key: 'engineering.load-path' };
  const authority = await context.FutureGalaxyPublicationContext.resolveLearningEvidence(mapping);
  assert.equal(authority.available, true);
  assert.equal(authority.course_unit_id, 203, 'course_unit_id must come from the BE-004 unit response');
  assert.equal(authority.course_id, 102);
  assert.equal(authority.class_id, 7);
  assert.equal(authority.identity_id, '41');
  assert.equal(authority.access_state, 'open');
  assert.doesNotMatch(JSON.stringify(context.FrontierCourseManifest.resolveAvailability()), /203|course_unit_id/, 'public availability snapshot must not expose private unit ids');
  assert.equal(context.FutureGalaxyPublicationContext.sameLearningEvidenceAuthority(authority, authority), true);

  currentUser.value = { id: 42, role: 'student' };
  assert.equal((await context.FutureGalaxyPublicationContext.resolveLearningEvidence(mapping)).available, false, 'identity change must close old evidence authority');
  currentUser.value = { id: 41, role: 'student' };
  context.location.hash = '#engineering/member-choice';
  assert.equal((await context.FutureGalaxyPublicationContext.resolveLearningEvidence(mapping)).available, false, 'a no-longer-visible activity must not retain write authority');
  context.location.hash = '#engineering/load-path';
  context.FutureGalaxyPublicationContext.close();
  assert.equal((await context.FutureGalaxyPublicationContext.resolveLearningEvidence(mapping)).available, false, 'close must clear the private unit binding');
}

async function testRuntimeCleanupAndControlledFlow() {
  const instrumentedFrontier = frontierSource.replace(
    'Object.assign(FrontierLearning, {',
    'global.__fe024MountEvidence = mountRepresentativeEvidence;\n    global.__fe024MountOwnerVisual = mountOwnerVisual;\n    global.__fe024CleanupRuntime = cleanupRuntime;\n    global.__fe024SetActiveRuntime = (runtime) => { activeRuntime = runtime; };\n    Object.assign(FrontierLearning, {',
  );
  assert.notEqual(instrumentedFrontier, frontierSource, 'frontier lifecycle instrumentation must apply');
  let destroyCalls = 0;
  let recordCalls = 0;
  let mountCalls = 0;
  let manualAfterMount = false;
  let mountedApiRecordCalls = 0;
  let capturedActivityOptions = null;
  const host = { isConnected: true };
  const evidenceController = {
    async refresh() {},
    context: () => ({ available: true, class_id: 7, course_id: 102, course_unit_id: 203, activity_key: 'engineering.load-path', identity_id: '41', authority_generation: 3, access_state: 'open' }),
    async record() { mountedApiRecordCalls += 1; },
    destroy() { destroyCalls += 1; },
  };
  const frontierContext = execute(instrumentedFrontier, {
    console,
    location: { hash: '#engineering/load-path' },
    history: { replaceState() {} },
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (callback) => setTimeout(callback, 0),
    cancelAnimationFrame: clearTimeout,
    ResizeObserver: class { observe() {} disconnect() {} },
    document: {
      querySelectorAll: () => [],
      scripts: [],
      head: { appendChild() {} },
      body: { appendChild() {} },
      createElement: () => ({ addEventListener() {}, setAttribute() {}, remove() {}, dataset: {}, isConnected: true }),
      getElementById: () => null,
    },
    initBridgeTruss() {},
    destroyBridgeTruss() {},
    AstraLearningEvidenceLoader: { ensure: async () => ({ pendingFor: async () => {
      if (manualAfterMount) throw Object.assign(new Error('manual intervention'), { code: 'pending_recovery_manual_intervention' });
      return [];
    } }) },
    AstraLearningEvidenceActivity: { mount: (options) => { capturedActivityOptions = options; mountCalls += 1; return evidenceController; } },
    FutureGalaxyPublicationContext: {
      resolveLearningEvidence: async () => evidenceController.context(),
      sameLearningEvidenceAuthority: () => true,
    },
  }, 'frontier-learning.js');
  const runtime = { page: 'engineering', mount: { querySelector: () => host }, abort: new AbortController(), cleanups: [], visual: null, destroyed: false };
  const route = {
    course: { galaxy_key: 'future-galaxy', course_key: 'engineering-systems', title: '工程系统' },
    activity: { activity_key: 'engineering.load-path', title: '载荷路径' },
  };
  frontierContext.__fe024SetActiveRuntime(runtime);
  const binding = await frontierContext.__fe024MountEvidence(runtime, route);
  assert.equal(binding.controller, evidenceController);
  assert.equal(typeof binding.authorizeRecord, 'function');
  assert.equal(typeof capturedActivityOptions.authorizeRecord, 'function');
  manualAfterMount = true;
  await assert.rejects(
    () => capturedActivityOptions.authorizeRecord({ context: evidenceController.context() }),
    (error) => error && error.code === 'pending_recovery_manual_intervention',
    'the explicit Future authorization callback must recheck exact-scope manual state before every record',
  );
  assert.equal(mountedApiRecordCalls, 0, 'a cross-tab manual intervention must block the API record path');
  manualAfterMount = false;
  assert.equal(runtime.cleanups.length, 1, 'evidence controller must be owned by the runtime cleanup stack');
  frontierContext.__fe024CleanupRuntime(runtime);
  assert.equal(destroyCalls, 1, 'route cleanup must destroy the evidence controller exactly once');
  frontierContext.__fe024CleanupRuntime(runtime);
  assert.equal(destroyCalls, 1);

  let resolveEnsure;
  frontierContext.AstraLearningEvidenceLoader = { ensure: () => new Promise((resolve) => { resolveEnsure = resolve; }) };
  const staleHost = { isConnected: true };
  const staleRuntime = { page: 'engineering', mount: { querySelector: () => staleHost }, abort: new AbortController(), cleanups: [], visual: null, destroyed: false };
  frontierContext.__fe024SetActiveRuntime(staleRuntime);
  const staleMount = frontierContext.__fe024MountEvidence(staleRuntime, route);
  frontierContext.__fe024CleanupRuntime(staleRuntime);
  staleHost.isConnected = false;
  resolveEnsure({ pendingFor: async () => [] });
  await assert.rejects(() => staleMount, /superseded/);
  assert.equal(mountCalls, 1, 'late loader completion after route cleanup must not create another controller');

  function readonlyMountHarness() {
    const controls = [
      '[data-load-path-action]',
      '[data-load-path-action]',
      '[data-load-path-prediction]',
      '[data-load-path-reason]',
      '[data-load-path-judgement]',
      '[data-load-path-model-limit]',
    ].map((selector) => ({
      selector,
      disabled: false,
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = String(value); },
    }));
    const host = { isConnected: true };
    const status = { textContent: '' };
    const flow = { dataset: {}, setAttribute() {} };
    const mount = {
      querySelector(selector) {
        if (selector === '[data-fg-evidence-host]') return host;
        if (selector === '[data-load-path-status]') return status;
        if (selector === '[data-load-path-flow]') return flow;
        return null;
      },
      querySelectorAll(selector) {
        return controls.filter((control) => selector.includes(control.selector));
      },
    };
    const stageStatus = { textContent: '' };
    let canvasPrependCalls = 0;
    const stage = {
      isConnected: true,
      innerHTML: '',
      querySelector(selector) { return selector === '[data-fg-stage-status]' ? stageStatus : null; },
      querySelectorAll() { return []; },
      prepend() { canvasPrependCalls += 1; },
    };
    return { controls, host, status, flow, mount, stage, stageStatus, canvasPrependCalls: () => canvasPrependCalls };
  }

  const manualError = Object.assign(new Error('manual intervention'), { code: 'pending_recovery_manual_intervention' });
  frontierContext.AstraLearningEvidenceLoader = { ensure: async () => ({ pendingFor: async () => { throw manualError; } }) };
  const manualView = readonlyMountHarness();
  const manualRuntime = { page: 'engineering', mount: manualView.mount, abort: new AbortController(), cleanups: [], visual: null, destroyed: false };
  frontierContext.__fe024SetActiveRuntime(manualRuntime);
  manualRuntime.evidenceBindingPromise = frontierContext.__fe024MountEvidence(manualRuntime, route);
  await frontierContext.__fe024MountOwnerVisual(manualRuntime, route, manualView.stage);
  assert.equal(manualView.controls.every((control) => control.disabled), true, 'pre-mount manual intervention must disable every controlled-flow input and action');
  assert.equal(manualView.controls.every((control) => control.attributes['aria-disabled'] === 'true'), true, 'pre-mount manual intervention must expose the disabled state perceptibly');
  assert.equal(manualView.status.textContent, '证据冲突需处理，本活动只读。');
  assert.equal(manualView.flow.dataset.loadPathReadonly, 'true');
  assert.equal(manualView.canvasPrependCalls(), 0, 'pre-mount manual state must not be masked by a fallback canvas');
  assert.equal(mountCalls, 1, 'manual intervention must not mount a controller that could append started');
  assert.equal(mountedApiRecordCalls, 0, 'pre-mount manual intervention must make zero controller/API record calls');

  frontierContext.AstraLearningEvidenceLoader = { ensure: async () => { throw new Error('evidence provider unavailable'); } };
  const failureView = readonlyMountHarness();
  const failureRuntime = { page: 'engineering', mount: failureView.mount, abort: new AbortController(), cleanups: [], visual: null, destroyed: false };
  frontierContext.__fe024SetActiveRuntime(failureRuntime);
  failureRuntime.evidenceBindingPromise = frontierContext.__fe024MountEvidence(failureRuntime, route);
  await frontierContext.__fe024MountOwnerVisual(failureRuntime, route, failureView.stage);
  assert.equal(failureView.controls.every((control) => control.disabled), true, 'general evidence/authority failure must disable every controlled-flow input and action');
  assert.equal(failureView.status.textContent, '课程范围或证据服务暂不可用；本活动保持只读，请稍后重试。');
  assert.equal(failureView.flow.dataset.loadPathReadonly, 'true');
  assert.equal(failureView.canvasPrependCalls(), 0, 'general evidence failure must not mount a fallback canvas over the controlled flow');
  assert.equal(mountCalls, 1, 'general evidence failure must not initialize a writable controller');
  assert.equal(mountedApiRecordCalls, 0, 'general evidence failure must make zero controller/API record calls');

  frontierContext.AstraLearningEvidenceLoader = { ensure: async () => ({ pendingFor: async () => [] }) };
  frontierContext.FutureGalaxyPublicationContext = null;
  const missingProviderView = readonlyMountHarness();
  const missingProviderRuntime = { page: 'engineering', mount: missingProviderView.mount, abort: new AbortController(), cleanups: [], visual: null, destroyed: false };
  frontierContext.__fe024SetActiveRuntime(missingProviderRuntime);
  missingProviderRuntime.evidenceBindingPromise = frontierContext.__fe024MountEvidence(missingProviderRuntime, route);
  await frontierContext.__fe024MountOwnerVisual(missingProviderRuntime, route, missingProviderView.stage);
  assert.equal(missingProviderView.controls.every((control) => control.disabled), true, 'missing evidence provider/controller infrastructure must leave the activity read-only');
  assert.equal(missingProviderView.status.textContent, '课程范围或证据服务暂不可用；本活动保持只读，请稍后重试。');
  assert.equal(missingProviderView.canvasPrependCalls(), 0);
  assert.equal(mountCalls, 1);
  assert.equal(mountedApiRecordCalls, 0);

  const instrumentedBridge = bridgeSource.replace(
    'window.BridgeTruss = BridgeTruss;',
    'window.__fe024CreateLoadPathFlow = createLoadPathFlow;\n    window.__fe024RecoverLoadPathPrefix = recoverLoadPathPrefix;\n    window.__fe024NormalizeObservation = normalizeLoadPathObservation;\n    window.BridgeTruss = BridgeTruss;',
  );
  assert.notEqual(instrumentedBridge, bridgeSource, 'bridge flow instrumentation must apply');
  const bridgeContext = execute(instrumentedBridge, {
    console,
    document: { getElementById: () => null, querySelectorAll: () => [] },
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: (callback) => setTimeout(callback, 0),
    cancelAnimationFrame: clearTimeout,
    devicePixelRatio: 1,
    crypto: require('node:crypto').webcrypto,
  }, 'bridge-truss.js');
  const rows = Object.fromEntries(['B', 'C', 'D'].map((node) => [node, { innerHTML: `<td>stale-${node}</td>` }]));
  const judgementField = { value: 'single-load-path', disabled: false };
  const modelLimitField = { checked: true, disabled: false };
  const statusField = { textContent: '' };
  const actionButtons = [
    { dataset: { loadPathAction: 'predict' }, disabled: false },
    ...['B', 'C', 'D'].map((node) => ({ dataset: { loadPathAction: 'observe', loadPathNode: node }, disabled: false })),
    ...['assess', 'correct', 'explain', 'redo'].map((action) => ({ dataset: { loadPathAction: action }, disabled: false })),
  ];
  const predictionFields = [{ disabled: false }, { disabled: false }, { disabled: false }, { disabled: false }];
  bridgeContext.BridgeTruss.controlledRoot = {
    querySelectorAll(selector) {
      if (selector === '[data-load-path-action]') return actionButtons;
      if (selector === '[data-load-path-prediction], [data-load-path-reason]') return predictionFields;
      return [];
    },
    querySelector(selector) {
      const row = String(selector).match(/data-load-path-row="([BCD])"/);
      if (row) return rows[row[1]];
      if (selector === '[data-load-path-judgement]') return judgementField;
      if (selector === '[data-load-path-model-limit]') return modelLimitField;
      if (selector === '[data-load-path-status]') return statusField;
      return null;
    },
  };
  bridgeContext.BridgeTruss._renderControlledFlow({ stage: 'prediction', busy: false, judgement: '', observations: {} });
  ['B', 'C', 'D'].forEach((node) => assert.match(rows[node].innerHTML, /尚未运行/, `redo/prediction render must clear stale ${node} evidence`));
  assert.equal(judgementField.value, '');
  assert.equal(modelLimitField.checked, false);
  const authority = { available: true, class_id: 7, course_id: 102, course_unit_id: 203, activity_key: 'engineering.load-path', identity_id: '41', authority_generation: 3, access_state: 'open' };
  let currentAuthority = authority;
  const events = [];
  const stages = [];
  const controller = {
    context: () => authority,
    async record(eventType, evidence, settings) {
      recordCalls += 1;
      events.push(json({ eventType, evidence, client_event_id: settings.client_event_id }));
      return { outcome: 'confirmed', state: 'confirmed' };
    },
  };

  const manualIds = [];
  const manualController = {
    context: () => authority,
    async record(_type, _evidence, settings) {
      manualIds.push(settings.client_event_id);
      return { outcome: 'manual-intervention', state: 'manual-intervention' };
    },
  };
  const liveManualFlow = bridgeContext.__fe024CreateLoadPathFlow({
    controller: manualController,
    pendingRecords: [],
    resolveAuthority: async () => authority,
    sameAuthority: () => true,
    isActive: () => true,
  });
  assert.equal(await liveManualFlow.predict({ reaction_balance_id: 'more-balanced', gh_change_id: 'absolute-increase', cd_change_id: 'absolute-increase', reason_size: 18 }), false);
  assert.equal(liveManualFlow.snapshot().blocked, true, 'a newly returned manual intervention must lock the live flow');
  assert.equal(await liveManualFlow.redo(), false, 'redo must not clear an active manual intervention');
  assert.equal(await liveManualFlow.predict({ reaction_balance_id: 'more-balanced', gh_change_id: 'absolute-increase', cd_change_id: 'absolute-increase', reason_size: 18 }), false);
  assert.equal(manualIds.length, 1, 'a manual intervention must prevent all subsequent record attempts and new IDs');

  let guardedControllerCalls = 0;
  const guardedFlow = bridgeContext.__fe024CreateLoadPathFlow({
    controller: {
      context: () => authority,
      async record() { guardedControllerCalls += 1; return { outcome: 'confirmed', state: 'confirmed' }; },
    },
    pendingRecords: [],
    authorizeRecord: async () => { throw Object.assign(new Error('manual intervention'), { code: 'pending_recovery_manual_intervention' }); },
    resolveAuthority: async () => authority,
    sameAuthority: () => true,
    isActive: () => true,
    onChange: (state) => bridgeContext.BridgeTruss._renderControlledFlow(state),
  });
  assert.equal(await guardedFlow.predict({ reaction_balance_id: 'more-balanced', gh_change_id: 'absolute-increase', cd_change_id: 'absolute-increase', reason_size: 18 }), false);
  assert.equal(guardedFlow.snapshot().blocked, true, 'authorization manual errors must enter a durable read-only flow state');
  assert.equal(guardedControllerCalls, 0, 'a manual state injected after mount must stop the next action before controller.record');
  assert.equal(actionButtons.every((button) => button.disabled), true, 'manual read-only state must disable every action');
  assert.equal(predictionFields.every((field) => field.disabled), true, 'manual read-only state must disable prediction inputs');
  assert.equal(judgementField.disabled, true);
  assert.equal(modelLimitField.disabled, true);
  assert.equal(statusField.textContent, '证据冲突需处理，本活动只读。');
  assert.equal(await guardedFlow.predict({ reaction_balance_id: 'more-balanced', gh_change_id: 'absolute-increase', cd_change_id: 'absolute-increase', reason_size: 18 }), false);
  assert.equal(guardedControllerCalls, 0, 'manual read-only state must keep later actions at zero controller writes');
  bridgeContext.BridgeTruss.controlledRoot = null;
  const snapshots = {
    B: { load_node_id: 'B', load_kn: 60, reaction_ay_kn: 45, reaction_ey_kn: 15, member_gh_kn: -30, member_cd_kn: 22.5, member_gh_type_id: 'compression', member_cd_type_id: 'tension', residual_fx_kn: 0, residual_fy_kn: 0 },
    C: { load_node_id: 'C', load_kn: 60, reaction_ay_kn: 30, reaction_ey_kn: 30, member_gh_kn: -60, member_cd_kn: 45, member_gh_type_id: 'compression', member_cd_type_id: 'tension', residual_fx_kn: 0, residual_fy_kn: 0 },
    D: { load_node_id: 'D', load_kn: 60, reaction_ay_kn: 15, reaction_ey_kn: 45, member_gh_kn: -30, member_cd_kn: 37.5, member_gh_type_id: 'compression', member_cd_type_id: 'tension', residual_fx_kn: 0, residual_fy_kn: 0 },
  };
  const flow = bridgeContext.__fe024CreateLoadPathFlow({
    controller,
    resolveAuthority: async () => currentAuthority,
    sameAuthority: (left, right) => ['class_id', 'course_id', 'course_unit_id', 'activity_key', 'identity_id', 'authority_generation', 'access_state']
      .every((key) => String(left && left[key]) === String(right && right[key])),
    isActive: () => true,
    observe: (joint) => snapshots[joint],
    onChange: (state) => stages.push(state.stage),
  });
  assert.equal(await flow.observe('B'), false, 'no operation is allowed before prediction');
  assert.equal(recordCalls, 0);
  assert.equal(await flow.predict({ reaction_balance_id: 'more-balanced', gh_change_id: 'absolute-increase', cd_change_id: 'absolute-increase', reason_size: 18 }), true);
  assert.equal(await flow.observe('C'), false, 'C cannot skip the B baseline');
  assert.equal(await flow.observe('B'), true);
  assert.equal(await flow.assess('equilibrium-redistribution'), false, 'assessment requires both B and C snapshots');
  assert.equal(await flow.observe('C'), true);
  assert.equal(await flow.assess('equilibrium-redistribution'), true);
  assert.equal(await flow.observe('D'), true);
  assert.equal(await flow.correct(true), true);
  assert.equal(await flow.explain(), true);
  assert.deepEqual(events.map((event) => event.eventType), ['predicted', 'attempted', 'attempted', 'attempted', 'corrected', 'explained']);
  assert.deepEqual(events.slice(1, 4).map((event) => event.evidence.cursor.load_node_id), ['B', 'C', 'D']);
  assert.equal(events[2].evidence.cursor.reaction_ey_kn, 30, 'C floating point noise must be normalized to contract precision');
  assert.deepEqual(Object.keys(events[0].evidence.prediction).sort(), ['cd_change_id', 'gh_change_id', 'reaction_balance_id', 'reason_size']);
  assert.deepEqual(Object.keys(events[4].evidence.correction).sort(), ['conclusion_id', 'initial_judgement_id', 'mirror_check_passed', 'model_id', 'model_limit_acknowledged']);
  assert.equal(events.at(-1).evidence.artifact.model_limit_id, 'ideal-truss-not-safety');
  assert.equal(events.some((event) => event.eventType === 'completed'), false, 'client flow must never emit completed');

  for (const node of ['B', 'C', 'D']) {
    bridgeContext.BridgeTruss.state.load = 60;
    bridgeContext.BridgeTruss.state.loadJoint = node;
    bridgeContext.BridgeTruss.state.memberMode = 'full';
    const normalized = bridgeContext.__fe024NormalizeObservation(node, bridgeContext.BridgeTruss.solve());
    assert.deepEqual(json(normalized), snapshots[node], `${node} must normalize the real solver to the frozen 8.6 row`);
  }

  currentAuthority = { ...authority, authority_generation: 4 };
  const beforeStale = recordCalls;
  assert.equal(await flow.redo(), false, 'old controller must fail closed after authority generation changes');
  assert.equal(recordCalls, beforeStale, 'failed authority recheck must make zero controller.record calls');
  assert.ok(stages.includes('waiting-server'), 'local explanation ends in a server-projection waiting state');

  const prediction = { reaction_balance_id: 'more-balanced', gh_change_id: 'absolute-increase', cd_change_id: 'absolute-increase', reason_size: 18 };
  const retryIds = [];
  let retryAttempt = 0;
  const retryController = {
    context: () => authority,
    async record(_type, _evidence, settings) {
      retryIds.push(settings.client_event_id);
      retryAttempt += 1;
      if (retryAttempt === 1) throw Object.assign(new Error('network failed'), { code: 'network_error' });
      return { outcome: 'confirmed', state: 'confirmed' };
    },
  };
  currentAuthority = authority;
  const retryFlow = bridgeContext.__fe024CreateLoadPathFlow({
    controller: retryController,
    resolveAuthority: async () => currentAuthority,
    sameAuthority: (left, right) => left.authority_generation === right.authority_generation,
    isActive: () => true,
    observe: (node) => snapshots[node],
  });
  assert.equal(await retryFlow.predict(prediction), false);
  assert.equal(await retryFlow.predict(prediction), true);
  assert.equal(retryIds[0], retryIds[1], 'a failed action retry must reuse the same client_event_id');
  assert.equal(await retryFlow.redo(), true);
  assert.equal(await retryFlow.predict(prediction), true);
  assert.notEqual(retryIds[2], retryIds[1], 'explicit redo must create a new event identity');

  let releaseRecord;
  let concurrentCalls = 0;
  const queuedIds = [];
  const concurrentController = {
    context: () => authority,
    record(_type, _evidence, settings) {
      concurrentCalls += 1;
      queuedIds.push(settings.client_event_id);
      return new Promise((resolve) => { releaseRecord = resolve; });
    },
  };
  const concurrentFlow = bridgeContext.__fe024CreateLoadPathFlow({
    controller: concurrentController,
    resolveAuthority: async () => authority,
    sameAuthority: () => true,
    isActive: () => true,
    observe: (node) => snapshots[node],
  });
  const firstClick = concurrentFlow.predict(prediction);
  const secondClick = concurrentFlow.predict({ ...prediction, reason_size: 19 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(concurrentCalls, 1, 'concurrent double click must be atomically fenced before record');
  assert.equal(await secondClick, false);
  releaseRecord({ outcome: 'queued', state: 'local-pending' });
  assert.equal(await firstClick, true, 'queued/local-pending is a durable single advance');
  assert.equal(await concurrentFlow.predict(prediction), false, 'the advanced stage must not enqueue prediction twice');
  assert.equal(concurrentCalls, 1);

  let postRecordAuthority = authority;
  let postRecordCalls = 0;
  const lateAuthorityFlow = bridgeContext.__fe024CreateLoadPathFlow({
    controller: {
      context: () => authority,
      async record() {
        postRecordCalls += 1;
        postRecordAuthority = { ...authority, authority_generation: 9 };
        return { outcome: 'confirmed', state: 'confirmed' };
      },
    },
    resolveAuthority: async () => postRecordAuthority,
    sameAuthority: (left, right) => left.authority_generation === right.authority_generation,
    isActive: () => true,
  });
  assert.equal(await lateAuthorityFlow.predict(prediction), false, 'authority change after a response must prevent old UI progression');
  assert.equal(lateAuthorityFlow.snapshot().stage, 'prediction');
  assert.equal(postRecordCalls, 1);

  const deniedFlow = bridgeContext.__fe024CreateLoadPathFlow({
    controller: { context: () => authority, async record() { throw new Error('must not be called'); } },
    resolveAuthority: async () => ({ available: false, error_code: 'activity_locked' }),
    sameAuthority: () => false,
    isActive: () => true,
  });
  assert.equal(await deniedFlow.predict(prediction), false, 'locked/hidden/unavailable authority must fail before record');
}

function testOfflineApprovedEnums() {
  const instrumented = queueSource.replace(
    'global.AstraLearningEvidenceQueue = Object.freeze({',
    'global.__fe024AssertReplayPayload = assertReplayPayload;\n    global.AstraLearningEvidenceQueue = Object.freeze({',
  );
  assert.notEqual(instrumented, queueSource, 'queue contract instrumentation must apply');
  const context = execute(instrumented, {
    console,
    TextEncoder,
    crypto: require('node:crypto').webcrypto,
    BroadcastChannel: undefined,
    addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout,
  }, 'learning-evidence-queue.js');
  const base = { client_event_id: 'offline-event-00001', class_id: 7, course_id: 102, course_unit_id: 203, activity_key: 'engineering.load-path', rule_version: 3, occurred_at: '2026-08-09T08:00:00.000Z' };
  const approved = [
    { event_type: 'started', evidence: { cursor: { surface: 'future-galaxy', stage: 'entered' } } },
    { event_type: 'predicted', evidence: { prediction: { reaction_balance_id: 'more-balanced', gh_change_id: 'absolute-increase', cd_change_id: 'absolute-decrease', reason_size: 18 } } },
    { event_type: 'attempted', evidence: { operation: 'run-fixed-load-case', cursor: { load_node_id: 'B', load_kn: 60, reaction_ay_kn: 45, reaction_ey_kn: 15, member_gh_kn: -30, member_cd_kn: 22.5, member_gh_type_id: 'compression', member_cd_type_id: 'tension', residual_fx_kn: 0, residual_fy_kn: 0 } } },
    { event_type: 'corrected', evidence: { correction: { conclusion_id: 'load-redistributes-by-equilibrium', initial_judgement_id: 'equilibrium-redistribution', mirror_check_passed: true, model_id: 'ideal-2d-pin-jointed-truss', model_limit_acknowledged: true }, cursor: { stage: 'after-repair' } } },
    { event_type: 'explained', evidence: { artifact: { kind: 'load-path-conclusion', conclusion_id: 'joint-equilibrium-redistribution', evidence_pair_id: 'b-c-reactions-gh-cd', model_limit_id: 'ideal-truss-not-safety' }, cursor: { stage: 'explained' } } },
  ];
  approved.forEach((event, index) => assert.doesNotThrow(() => context.__fe024AssertReplayPayload({ ...base, client_event_id: `offline-event-${String(index).padStart(5, '0')}`, ...event })));
  assert.throws(
    () => context.__fe024AssertReplayPayload({ ...base, event_type: 'predicted', evidence: { prediction: { reaction_balance_id: 'invented-prose', gh_change_id: 'absolute-increase', cd_change_id: 'absolute-decrease', reason_size: 18 } } }),
    (error) => error && error.code === 'evidence_enum_not_queueable',
    'unapproved text must remain forbidden from the offline queue',
  );
}

async function testStrictPendingPrefix() {
  const instrumentedBridge = bridgeSource.replace(
    'window.BridgeTruss = BridgeTruss;',
    'window.__fe024RecoverLoadPathPrefix = recoverLoadPathPrefix;\n    window.BridgeTruss = BridgeTruss;',
  );
  const context = execute(instrumentedBridge, {
    console,
    document: { getElementById: () => null, querySelectorAll: () => [] },
    addEventListener() {}, removeEventListener() {}, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {}, devicePixelRatio: 1,
  }, 'bridge-truss.js');
  const scope = { class_id: 7, course_id: 102, course_unit_id: 203, activity_key: 'engineering.load-path' };
  const make = (event_type, evidence, index) => ({
    state: 'local-pending', created_at: index,
    payload: { ...scope, rule_version: 3, client_event_id: `pending-event-${String(index).padStart(4, '0')}`, event_type, occurred_at: `2026-08-09T08:00:0${index}.000Z`, evidence },
  });
  const prediction = { prediction: { reaction_balance_id: 'more-balanced', gh_change_id: 'absolute-increase', cd_change_id: 'absolute-increase', reason_size: 18 } };
  const attempt = (node, ay, ey, gh, cd) => ({ operation: 'run-fixed-load-case', cursor: { load_node_id: node, load_kn: 60, reaction_ay_kn: ay, reaction_ey_kn: ey, member_gh_kn: gh, member_cd_kn: cd, member_gh_type_id: 'compression', member_cd_type_id: 'tension', residual_fx_kn: 0, residual_fy_kn: 0 } });
  const records = [
    make('predicted', prediction, 1),
    make('attempted', attempt('B', 45, 15, -30, 22.5), 2),
    make('attempted', attempt('C', 30, 30, -60, 45), 3),
  ];
  assert.equal(context.__fe024RecoverLoadPathPrefix(records, scope).stage, 'observed-c');
  assert.equal(context.__fe024RecoverLoadPathPrefix(records.slice(1), scope).stage, 'prediction', 'an incomplete queue suffix cannot stand in for a full prefix');
  const invalidLeaves = json(records);
  invalidLeaves[2].payload.evidence.cursor.reference = 'invented';
  assert.equal(context.__fe024RecoverLoadPathPrefix(invalidLeaves, scope).stage, 'prediction', 'unapproved leaves must reject the pending prefix');
  const invalidOrder = [records[0], records[2], records[1]];
  assert.equal(context.__fe024RecoverLoadPathPrefix(invalidOrder, scope).stage, 'prediction', 'out-of-order B/C events must fail closed');
}

async function run() {
  await testUniqueRepresentativeAndDomainOnlyPanel();
  await testBoundedPendingAccessor();
  await testPrivateFutureUnitAuthority();
  await testRuntimeCleanupAndControlledFlow();
  await testStrictPendingPrefix();
  testOfflineApprovedEnums();
  assert.match(queueSource, /'future-galaxy'/, 'offline enum contract must include the Future surface');
  assert.doesNotMatch(bridgeSource, /event_type\s*:\s*['"]completed['"]|record\(\s*['"]completed['"]/, 'engineering producer must not emit completed');
  console.log('future-engineering-evidence-contract: ok');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
