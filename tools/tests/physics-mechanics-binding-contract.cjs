const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const moduleSelectorSource = fs.readFileSync(path.join(root, 'shared/js/module-selector.js'), 'utf8');
const publicationSource = fs.readFileSync(path.join(root, 'shared/js/engineering-lab-publication-context.js'), 'utf8');

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function settle(turns = 24) {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function exactContext(overrides = {}) {
  return Object.freeze({
    available: true,
    class_id: 12,
    course_id: 23,
    course_unit_id: 34,
    activity_key: 'physics.mechanics',
    galaxy_key: 'englab',
    course_key: 'physics',
    identity_id: 'student-7',
    authority_generation: 5,
    access_state: 'open',
    ...overrides,
  });
}

function createMountHarness(options = {}) {
  const contextValue = exactContext();
  const pendingCalls = [];
  const providerCalls = [];
  const providerOptions = [];
  const ownerCalls = [];
  const clearCalls = [];
  let mountOptions = null;
  let pendingImpl = options.pending || (async () => []);
  let providerImpl = options.resolve || (async () => contextValue);
  let permit = false;
  let commandReady = false;
  let controllerDestroyed = 0;
  let readyCalls = 0;
  let mountCalls = 0;
  let sessionUser = { id: 7, role: 'student' };
  let providerSnapshotImpl = options.providerSnapshot || (() => Object.freeze({
    class_id: 12,
    classes: Object.freeze([{ id: 12 }]),
    identity_id: '7',
    authority_generation: 5,
  }));
  const eventHandlers = new Map();
  const readyImpl = options.ready || (async () => contextValue);
  const controller = options.controller === null ? null : {
    context: () => contextValue,
    ready(...args) { readyCalls += 1; return readyImpl(...args); },
    refreshCommands() { ownerCalls.push('refresh-commands'); },
    destroy() { controllerDestroyed += 1; },
  };
  const host = {
    isConnected: true,
    classList: { contains: value => value === 'module-active' },
  };
  const pageEl = { isConnected: true };
  const owner = {
    blockCourseEvidence(error) { ownerCalls.push({ type: 'blocked', code: error && error.code }); },
    authorizeCourseRecord(eventType, evidence) {
      ownerCalls.push({ type: 'permit-check', eventType, evidence });
      return permit;
    },
    canUseCourseEvidenceCommand(command) {
      ownerCalls.push({ type: 'command-check', command });
      return commandReady;
    },
    beginCourseEvidenceCommand(detail) {
      ownerCalls.push({ type: 'command-begin', detail });
      return Object.freeze({ client_event_id: 'explained-fixed', owner_generation: 9 });
    },
    completeCourseEvidenceCommand(detail) {
      ownerCalls.push({ type: 'command-complete', detail });
      return true;
    },
    failCourseEvidenceCommand(error) {
      ownerCalls.push({ type: 'command-fail', code: error && error.code });
      return false;
    },
    bindCourseEvidence(boundController, binding) {
      ownerCalls.push({ type: 'bound', controller: boundController, binding });
      return options.bindResult !== false;
    },
  };
  const sameAuthority = (expected, current) => [
    'class_id', 'course_id', 'course_unit_id', 'activity_key',
    'identity_id', 'authority_generation', 'access_state',
  ].every(key => String(expected && expected[key]) === String(current && current[key]));
  const windowObject = {
    location: { hash: '#physics/mechanics' },
    AstraApplicationSession: { getUser: () => sessionUser },
    AstraStudentCourseCatalogue: {
      snapshot: () => Object.freeze({ phase: 'ready', role: 'student' }),
      allowsActivity: () => true,
    },
    addEventListener(type, handler) {
      if (!eventHandlers.has(type)) eventHandlers.set(type, new Set());
      eventHandlers.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      eventHandlers.get(type)?.delete(handler);
    },
    dispatchEvent(event) {
      for (const handler of eventHandlers.get(event && event.type) || []) handler(event);
    },
    AstraLearningEvidenceLoader: {
      ensure: options.ensure || (() => Promise.resolve()),
      clearDomainCommands(...args) { clearCalls.push(args); },
    },
    AstraLearningEvidenceActivity: options.activityMissing ? null : {
      mount(settings) { mountCalls += 1; mountOptions = settings; return controller; },
    },
    AstraEngineeringLabPublicationContext: options.providerMissing ? null : {
      async resolve(mapping, requestOptions) {
        providerCalls.push(mapping);
        providerOptions.push(requestOptions);
        return providerImpl(mapping, providerCalls.length, requestOptions);
      },
      sameLearningEvidenceAuthority: sameAuthority,
      snapshot() { return providerSnapshotImpl(); },
    },
    AstraLearningEvidenceClient: {
      async pendingFor(scope) {
        pendingCalls.push(scope);
        return pendingImpl(scope, pendingCalls.length);
      },
    },
    AstraLearningActivityCatalog: {
      resolve() {
        return Object.freeze({
          galaxy_key: 'englab',
          course_key: 'physics',
          activity_key: 'physics.mechanics',
          representative: true,
        });
      },
    },
    PhysicsSim: owner,
  };
  const context = {
    window: windowObject,
    globalThis: null,
    document: { getElementById: () => null },
    CONFIG: { experiments: { physics: [] } },
    console: { warn() {} },
    AbortController,
    setTimeout,
    clearTimeout,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(moduleSelectorSource, context, { filename: 'shared/js/module-selector.js' });
  const selector = vm.runInContext('ModuleSelector', context);
  selector.activeModule.physics = 'mechanics';
  selector._transitionGeneration.physics = 7;
  selector._mountEvidenceRuntime('physics', 'mechanics', pageEl, [host], 7);
  return {
    selector,
    windowObject,
    host,
    pageEl,
    ownerCalls,
    pendingCalls,
    providerCalls,
    providerOptions,
    clearCalls,
    contextValue,
    controller,
    get mountOptions() { return mountOptions; },
    get controllerDestroyed() { return controllerDestroyed; },
    get readyCalls() { return readyCalls; },
    get mountCalls() { return mountCalls; },
    setPendingImpl(next) { pendingImpl = next; },
    setProviderImpl(next) { providerImpl = next; },
    setProviderSnapshotImpl(next) { providerSnapshotImpl = next; },
    setPermit(next) { permit = Boolean(next); },
    setCommandReady(next) { commandReady = Boolean(next); },
    setUser(next) { sessionUser = next; },
  };
}

function createColdReloadRaceHarness() {
  const handlers = new Map();
  const apiCalls = [];
  const evidencePosts = [];
  const ownerCalls = [];
  const clearCalls = [];
  const warnings = [];
  let cataloguePhase = 'loading';
  let firstClassesAborted = 0;
  let settleFirstClasses = null;
  let classRequests = 0;
  let readyCalls = 0;
  let mountCalls = 0;
  let controllerDestroyed = 0;
  let controllerContext = null;
  let mountOptions = null;
  const sessionUser = { id: 7, role: 'student' };
  const mapping = Object.freeze({
    galaxy_key: 'englab',
    course_key: 'physics',
    activity_key: 'physics.mechanics',
    representative: true,
  });
  const windowObject = {
    location: { hash: '#physics/mechanics' },
    AstraApplicationSession: { getUser: () => sessionUser },
    addEventListener(type, handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      handlers.get(type)?.delete(handler);
    },
    dispatchEvent(event) {
      for (const handler of handlers.get(event && event.type) || []) handler(event);
      return true;
    },
    AstraApiClient: {
      request(route, options = {}) {
        apiCalls.push({ route, signal: options.signal, params: options.params || {} });
        if (route === '/api/classes') {
          classRequests += 1;
          if (classRequests === 1) {
            return new Promise((resolve, reject) => {
              settleFirstClasses = () => resolve([{ id: 12, name: 'A 班' }]);
              const rejectCancelled = () => {
                firstClassesAborted += 1;
                const error = new Error('initial classes request aborted');
                error.name = 'AbortError';
                reject(error);
              };
              if (options.signal.aborted) rejectCancelled();
              else options.signal.addEventListener('abort', rejectCancelled, { once: true });
            });
          }
          if (classRequests === 2) {
            return Promise.reject(new Error('publication authority is still warming'));
          }
          return Promise.resolve([{ id: 12, name: 'A 班' }]);
        }
        if (route === '/api/courses') {
          return Promise.resolve([{ id: 23, galaxy_key: 'englab', course_key: 'physics' }]);
        }
        if (route === '/api/courses/23/units') {
          return Promise.resolve([{
            id: 34,
            activity_key: 'physics.mechanics',
            effective_release_state: 'open',
          }]);
        }
        throw new Error(`unexpected cold reload route: ${route}`);
      },
      isCancelled: error => Boolean(error && error.name === 'AbortError'),
    },
  };
  const context = {
    window: windowObject,
    globalThis: null,
    document: { getElementById: () => null },
    CONFIG: { experiments: { physics: [] } },
    console: { warn(...args) { warnings.push(args); } },
    AbortController,
    setTimeout,
    clearTimeout,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(publicationSource, context, {
    filename: 'shared/js/engineering-lab-publication-context.js',
  });
  const publication = windowObject.AstraEngineeringLabPublicationContext;
  windowObject.AstraStudentCourseCatalogue = {
    snapshot: () => Object.freeze({ phase: cataloguePhase, role: 'student' }),
    allowsActivity: (page, moduleId) => cataloguePhase === 'ready'
      && page === 'physics'
      && moduleId === 'mechanics',
  };
  windowObject.AstraLearningEvidenceLoader = {
    ensure: () => Promise.resolve(),
    clearDomainCommands(...args) { clearCalls.push(args); },
  };
  windowObject.AstraLearningEvidenceClient = {
    pendingFor: async () => [],
  };
  windowObject.AstraLearningActivityCatalog = {
    resolve: () => mapping,
  };
  const controller = {
    async ready() {
      readyCalls += 1;
      const resolved = await mountOptions.resolveContext(mapping);
      if (!resolved || resolved.available !== true) {
        throw codedError(resolved && resolved.error_code || 'publication_context_unavailable');
      }
      controllerContext = resolved;
      return resolved;
    },
    context: () => controllerContext,
    record(...args) { evidencePosts.push(args); },
    consumeCommandReceipt() {},
    refreshCommands() { ownerCalls.push('refresh-commands'); },
    destroy() { controllerDestroyed += 1; },
  };
  windowObject.AstraLearningEvidenceActivity = {
    mount(settings) {
      mountCalls += 1;
      mountOptions = settings;
      return controller;
    },
  };
  windowObject.PhysicsSim = {
    evidenceReady: false,
    blockCourseEvidence(error) { ownerCalls.push({ type: 'blocked', code: error && error.code }); },
    authorizeCourseRecord() { return false; },
    canUseCourseEvidenceCommand() { return false; },
    beginCourseEvidenceCommand() { return null; },
    completeCourseEvidenceCommand() { return false; },
    failCourseEvidenceCommand() { return false; },
    bindCourseEvidence(boundController, binding) {
      this.evidenceReady = true;
      ownerCalls.push({ type: 'bound', controller: boundController, binding });
      return true;
    },
  };
  vm.runInContext(moduleSelectorSource, context, { filename: 'shared/js/module-selector.js' });
  const selector = vm.runInContext('ModuleSelector', context);
  const host = {
    isConnected: true,
    classList: { contains: value => value === 'module-active' },
  };
  const pageEl = { isConnected: true };
  selector.activeModule.physics = 'mechanics';
  selector._transitionGeneration.physics = 11;
  selector._mountEvidenceRuntime('physics', 'mechanics', pageEl, [host], 11);
  return {
    selector,
    windowObject,
    ownerCalls,
    clearCalls,
    warnings,
    apiCalls,
    evidencePosts,
    get classRequests() { return classRequests; },
    get firstClassesAborted() { return firstClassesAborted; },
    get readyCalls() { return readyCalls; },
    get mountCalls() { return mountCalls; },
    get controllerDestroyed() { return controllerDestroyed; },
    setCatalogueReady() {
      cataloguePhase = 'ready';
      windowObject.dispatchEvent({
        type: 'astra:student-catalogue-ready',
        detail: { role: 'student', phase: 'ready' },
      });
      settleFirstClasses();
    },
  };
}

async function createPublicationOwnerContentionHarness(seed = 1) {
  const handlers = new Map();
  const trace = [];
  const evidencePosts = [];
  const ownerCalls = [];
  const clearCalls = [];
  let sessionUser = null;
  let publication = null;
  let mountOptions = null;
  let controllerContext = null;
  let readyCalls = 0;
  let mountCalls = 0;
  let controllerDestroyed = 0;
  let courseRequests = 0;
  let competitorCalls = 0;
  let randomState = Number(seed) || 1;
  const jitter = maximum => {
    randomState = (randomState * 48271) % 0x7fffffff;
    return randomState % maximum;
  };
  const mapping = Object.freeze({
    galaxy_key: 'englab',
    course_key: 'physics',
    activity_key: 'physics.mechanics',
    representative: true,
  });
  const windowObject = {
    location: { hash: '#physics/mechanics' },
    AstraApplicationSession: { getUser: () => sessionUser },
    addEventListener(type, handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      handlers.get(type)?.delete(handler);
    },
    AstraApiClient: {
      request(route, options = {}) {
        if (route === '/api/classes') {
          trace.push({ type: 'classes', aborted: options.signal.aborted });
          return Promise.resolve([{ id: 12, name: 'A 班' }]);
        }
        if (route === '/api/courses') {
          courseRequests += 1;
          const requestNumber = courseRequests;
          const responseDelay = 9 + jitter(7);
          const competitorDelay = jitter(4);
          trace.push({ type: 'course-start', requestNumber, responseDelay, competitorDelay });
          if (requestNumber === 1 || requestNumber === 3) {
            setTimeout(() => {
              competitorCalls += 1;
              trace.push({ type: 'competitor-start', requestNumber });
              publication.resolve(mapping).then(result => {
                trace.push({
                  type: 'competitor-result',
                  requestNumber,
                  available: result && result.available === true,
                  code: result && result.error_code || '',
                });
              });
            }, competitorDelay);
          }
          return new Promise((resolve, reject) => {
            let settled = false;
            const finish = (callback, value) => {
              if (settled) return;
              settled = true;
              options.signal.removeEventListener('abort', onAbort);
              callback(value);
            };
            const onAbort = () => {
              const error = new Error(`course request ${requestNumber} aborted`);
              error.name = 'AbortError';
              trace.push({ type: 'course-abort', requestNumber });
              finish(reject, error);
            };
            options.signal.addEventListener('abort', onAbort, { once: true });
            setTimeout(() => {
              trace.push({ type: 'course-resolve', requestNumber });
              finish(resolve, [{ id: 23, galaxy_key: 'englab', course_key: 'physics' }]);
            }, responseDelay);
          });
        }
        if (route === '/api/courses/23/units') {
          trace.push({ type: 'units', aborted: options.signal.aborted });
          return Promise.resolve([{
            id: 34,
            activity_key: 'physics.mechanics',
            effective_release_state: 'open',
          }]);
        }
        throw new Error(`unexpected contention route: ${route}`);
      },
      isCancelled: error => Boolean(error && error.name === 'AbortError'),
    },
  };
  const context = {
    window: windowObject,
    globalThis: null,
    document: { getElementById: () => null },
    CONFIG: { experiments: { physics: [] } },
    console: { warn(...args) { trace.push({ type: 'warning', args }); } },
    AbortController,
    setTimeout,
    clearTimeout,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(publicationSource, context, {
    filename: 'shared/js/engineering-lab-publication-context.js',
  });
  publication = windowObject.AstraEngineeringLabPublicationContext;
  sessionUser = { id: 7, role: 'student' };
  const prepared = await publication.prepare(sessionUser);
  assert.equal(prepared.available, true);
  trace.push({ type: 'prepared', snapshot: publication.snapshot() });
  windowObject.AstraStudentCourseCatalogue = {
    snapshot: () => Object.freeze({ phase: 'ready', role: 'student' }),
    allowsActivity: (page, moduleId) => page === 'physics' && moduleId === 'mechanics',
  };
  windowObject.AstraLearningEvidenceLoader = {
    ensure: () => Promise.resolve(),
    clearDomainCommands(...args) { clearCalls.push(args); },
  };
  windowObject.AstraLearningEvidenceClient = { pendingFor: async () => [] };
  windowObject.AstraLearningActivityCatalog = { resolve: () => mapping };
  const controller = {
    async ready() {
      readyCalls += 1;
      trace.push({ type: 'ready-start', readyCalls, snapshot: publication.snapshot() });
      const resolved = await mountOptions.resolveContext(mapping);
      trace.push({ type: 'ready-result', readyCalls, resolved });
      if (!resolved || resolved.available !== true) {
        throw codedError('publication_context_unavailable');
      }
      controllerContext = resolved;
      return resolved;
    },
    context: () => controllerContext,
    record(...args) { evidencePosts.push(args); },
    consumeCommandReceipt() {},
    refreshCommands() { ownerCalls.push('refresh-commands'); },
    destroy() { controllerDestroyed += 1; },
  };
  windowObject.AstraLearningEvidenceActivity = {
    mount(settings) {
      mountCalls += 1;
      mountOptions = settings;
      return controller;
    },
  };
  windowObject.PhysicsSim = {
    blockCourseEvidence(error) { ownerCalls.push({ type: 'blocked', code: error && error.code }); },
    authorizeCourseRecord() { return false; },
    canUseCourseEvidenceCommand() { return false; },
    beginCourseEvidenceCommand() { return null; },
    completeCourseEvidenceCommand() { return false; },
    failCourseEvidenceCommand() { return false; },
    bindCourseEvidence(boundController, binding) {
      ownerCalls.push({ type: 'bound', controller: boundController, binding });
      return true;
    },
  };
  vm.runInContext(moduleSelectorSource, context, { filename: 'shared/js/module-selector.js' });
  const selector = vm.runInContext('ModuleSelector', context);
  const host = {
    isConnected: true,
    classList: { contains: value => value === 'module-active' },
  };
  const pageEl = { isConnected: true };
  selector.activeModule.physics = 'mechanics';
  selector._transitionGeneration.physics = 19;
  selector._mountEvidenceRuntime('physics', 'mechanics', pageEl, [host], 19);
  return {
    trace,
    evidencePosts,
    ownerCalls,
    clearCalls,
    get courseRequests() { return courseRequests; },
    get competitorCalls() { return competitorCalls; },
    get readyCalls() { return readyCalls; },
    get mountCalls() { return mountCalls; },
    get controllerDestroyed() { return controllerDestroyed; },
  };
}

function createPublicationFlightHarness() {
  const handlers = new Map();
  const requests = [];
  let sessionUser = null;
  const windowObject = {
    location: { hash: '#physics/mechanics' },
    AstraApplicationSession: { getUser: () => sessionUser },
    addEventListener(type, handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(handler);
    },
    dispatchEvent(event) {
      for (const handler of handlers.get(event && event.type) || []) handler(event);
    },
    AstraApiClient: {
      request(route, options = {}) {
        if (route.startsWith('/api/courses/') && route.endsWith('/units')) {
          return Promise.resolve([
            { id: 34, activity_key: 'physics.mechanics', effective_release_state: 'open' },
            { id: 35, activity_key: 'physics.gas-laws', effective_release_state: 'open' },
          ]);
        }
        if (route !== '/api/classes' && route !== '/api/courses') {
          throw new Error(`unexpected publication flight route: ${route}`);
        }
        return new Promise((resolve, reject) => {
          let settled = false;
          const request = {
            route,
            signal: options.signal,
            params: options.params || {},
            resolve(value) {
              if (settled) return;
              settled = true;
              options.signal.removeEventListener('abort', onAbort);
              resolve(value);
            },
          };
          const onAbort = () => {
            if (settled) return;
            settled = true;
            const error = new Error(`${route} aborted`);
            error.name = 'AbortError';
            reject(error);
          };
          options.signal.addEventListener('abort', onAbort, { once: true });
          requests.push(request);
        });
      },
      isCancelled: error => Boolean(error && error.name === 'AbortError'),
    },
  };
  const context = { window: windowObject, console, AbortController };
  vm.createContext(context);
  vm.runInContext(publicationSource, context, {
    filename: 'shared/js/engineering-lab-publication-context.js',
  });
  return {
    publication: windowObject.AstraEngineeringLabPublicationContext,
    windowObject,
    requests,
    setUser(user) { sessionUser = user; },
    requestsFor(route) { return requests.filter(request => request.route === route); },
  };
}

async function testMountBinding() {
  const harness = createMountHarness();
  await settle();
  assert.ok(harness.mountOptions, 'the exact mechanics owner must mount its evidence panel');
  assert.equal(harness.mountOptions.integrated, true);
  assert.equal(harness.mountOptions.structuredOnly, true, 'Physics must expose no free-text shortcut');
  assert.equal(harness.mountOptions.reusePendingStarted, true);
  assert.equal(harness.mountOptions.authorizeAfterRecord, true);
  assert.equal(harness.mountOptions.requireAuthoritativeResult, true, 'Physics alone waits for an authoritative terminal result');
  assert.equal(harness.ownerCalls.filter(call => call.type === 'bound').length, 1);
  assert.equal(harness.pendingCalls.length, 1, 'binding must preflight exact-scope manual state');
  assert.equal(harness.providerCalls.length, 1, 'binding must re-resolve current open authority');

  const binding = harness.ownerCalls.find(call => call.type === 'bound').binding;
  assert.equal(typeof binding.resolveAuthority, 'function');
  assert.equal(binding.isActive(), true);
  assert.equal(binding.sameAuthority(harness.contextValue, harness.contextValue), true);

  assert.equal(harness.mountOptions.commandEnabled('explained'), false);
  harness.setCommandReady(true);
  assert.equal(harness.mountOptions.commandEnabled('explained'), true);
  const evidence = { artifact: { kind: 'claim-evidence-link', value: 'claim-supported' }, cursor: { stage: 'explained' } };
  const commandPermit = harness.mountOptions.beforeCommand({ event_type: 'explained', evidence });
  assert.equal(commandPermit.client_event_id, 'explained-fixed');
  await harness.mountOptions.onCommandResult({ result: { outcome: 'confirmed' }, permit: commandPermit });
  await harness.mountOptions.onCommandError(codedError('network_error'));
  assert.ok(harness.ownerCalls.some(call => call.type === 'command-complete'));
  assert.ok(harness.ownerCalls.some(call => call.type === 'command-fail'));

  const callsBeforeStarted = harness.pendingCalls.length;
  const recordAuthority = new AbortController();
  assert.equal((await harness.mountOptions.authorizeRecord({
    context: harness.contextValue,
    event_type: 'started',
    evidence: { cursor: { stage: 'entered' } },
    signal: recordAuthority.signal,
  })).activity_key, 'physics.mechanics');
  assert.equal(harness.pendingCalls.length, callsBeforeStarted + 1);
  assert.equal(
    harness.providerOptions.at(-1).signal,
    recordAuthority.signal,
    'the activity request signal must reach the cancellable publication provider'
  );

  let releasePending;
  harness.setPendingImpl(() => new Promise(resolve => { releasePending = resolve; }));
  const staleAuthority = new AbortController();
  const staleProviderCount = harness.providerCalls.length;
  const staleAuthorization = harness.mountOptions.authorizeRecord({
    context: harness.contextValue,
    event_type: 'started',
    evidence: { cursor: { stage: 'entered' } },
    signal: staleAuthority.signal,
  });
  await settle(4);
  staleAuthority.abort();
  releasePending([]);
  await assert.rejects(staleAuthorization, error => error && error.code === 'cancelled');
  assert.equal(
    harness.providerCalls.length,
    staleProviderCount,
    'an ignored pendingFor signal is checked before a late provider call'
  );
  harness.setPendingImpl(async () => []);

  await assert.rejects(
    harness.mountOptions.authorizeRecord({
      context: harness.contextValue,
      event_type: 'predicted',
      evidence: { cursor: { stage: 'prediction-recorded' } },
    }),
    error => error && error.code === 'publication_context_unavailable',
    'a direct controller.record without an owner permit must fail before API authority work'
  );
  harness.setPermit(true);
  harness.setPendingImpl(async () => { throw codedError('pending_recovery_manual_intervention'); });
  const providerCount = harness.providerCalls.length;
  await assert.rejects(
    harness.mountOptions.authorizeRecord({
      context: harness.contextValue,
      event_type: 'predicted',
      evidence: { cursor: { stage: 'prediction-recorded' } },
    }),
    error => error && error.code === 'pending_recovery_manual_intervention'
  );
  assert.equal(
    harness.providerCalls.length,
    providerCount,
    'a newly injected manual record must block before provider/API recording can continue'
  );
}

async function testMountFailures() {
  const manual = createMountHarness({
    ready: async () => { throw codedError('pending_recovery_manual_intervention'); },
  });
  await settle();
  assert.deepEqual(
    manual.ownerCalls.filter(call => call.type === 'blocked').map(call => call.code),
    ['pending_recovery_manual_intervention']
  );
  assert.equal(manual.ownerCalls.some(call => call.type === 'bound'), false);
  assert.equal(manual.clearCalls.length, 1);
  assert.equal(manual.controllerDestroyed, 1, 'failed initialization must release its controller');

  for (const code of ['identity_required', 'activity_hidden', 'activity_locked']) {
    const denied = createMountHarness({ ready: async () => { throw codedError(code); } });
    await settle();
    assert.equal(denied.readyCalls, 1, `${code} must not enter transient recovery`);
    assert.equal(denied.ownerCalls.some(call => call.type === 'bound'), false);
    assert.deepEqual(
      denied.ownerCalls.filter(call => call.type === 'blocked').map(call => call.code),
      [code]
    );
    assert.equal(denied.controllerDestroyed, 1);
  }

  const unavailable = createMountHarness({
    ready: async () => { throw codedError('publication_context_unavailable'); },
  });
  await wait(180);
  await settle();
  assert.deepEqual(
    unavailable.ownerCalls.filter(call => call.type === 'blocked').map(call => call.code),
    ['publication_context_unavailable']
  );
  assert.equal(unavailable.readyCalls, 2, 'permanent unavailability must receive exactly one bounded retry');
  assert.equal(unavailable.mountCalls, 1, 'bounded recovery must reuse the same evidence controller DOM');
  assert.equal(unavailable.controllerDestroyed, 1, 'authority failure must release its controller');
  await wait(160);
  assert.equal(unavailable.readyCalls, 2, 'permanent failure must not enter an unbounded retry loop');

  const missingProvider = createMountHarness({ providerMissing: true });
  await settle();
  assert.deepEqual(
    missingProvider.ownerCalls.filter(call => call.type === 'blocked').map(call => call.code),
    ['publication_context_unavailable']
  );

  const readyGate = (() => {
    let resolve;
    return { promise: new Promise(yes => { resolve = yes; }), resolve };
  })();
  const stale = createMountHarness({ ready: () => readyGate.promise });
  await settle(4);
  stale.selector.activeModule.physics = null;
  stale.windowObject.location.hash = '#physics';
  readyGate.resolve(stale.contextValue);
  await settle();
  assert.equal(stale.ownerCalls.some(call => call.type === 'bound'), false);
  assert.equal(stale.controllerDestroyed, 1, 'late mount completion must destroy its stale controller');
}

async function testBoundedRecoveryCancellation() {
  let alreadyReadyAttempts = 0;
  const alreadyReady = createMountHarness({
    ready: async () => {
      alreadyReadyAttempts += 1;
      if (alreadyReadyAttempts === 1) throw codedError('publication_context_unavailable');
      return exactContext();
    },
  });
  await wait(180);
  await settle();
  assert.equal(alreadyReady.readyCalls, 2, 'a catalogue-ready snapshot must close the lost-event window');
  assert.equal(alreadyReady.mountCalls, 1);
  assert.equal(alreadyReady.ownerCalls.filter(call => call.type === 'bound').length, 1);
  assert.equal(alreadyReady.ownerCalls.some(call => call.type === 'blocked'), false);
  alreadyReady.selector._beginModuleTransition('physics');

  const routeLeave = createMountHarness({
    ready: async () => { throw codedError('publication_context_unavailable'); },
  });
  await settle();
  assert.equal(routeLeave.readyCalls, 1);
  routeLeave.selector._beginModuleTransition('physics');
  routeLeave.selector.activeModule.physics = null;
  routeLeave.windowObject.location.hash = '#physics';
  await wait(180);
  assert.equal(routeLeave.readyCalls, 1, 'route leave must cancel the scheduled recovery');
  assert.equal(routeLeave.ownerCalls.some(call => call.type === 'bound'), false);
  assert.equal(routeLeave.ownerCalls.some(call => call.type === 'blocked'), false, 'stale route must not rewrite owner state');
  assert.equal(routeLeave.controllerDestroyed, 1);

  const reset = createMountHarness({
    ready: async () => { throw codedError('publication_context_unavailable'); },
  });
  await settle();
  reset.selector.resetPage('physics');
  await wait(180);
  assert.equal(reset.readyCalls, 1, 'page reset must cancel the scheduled recovery');
  assert.equal(reset.ownerCalls.some(call => call.type === 'bound' || call.type === 'blocked'), false);
  assert.equal(reset.controllerDestroyed, 1);

  const identitySwitch = createMountHarness({
    ready: async () => { throw codedError('publication_context_unavailable'); },
  });
  await settle();
  identitySwitch.setUser({ id: 8, role: 'student' });
  await wait(180);
  assert.equal(identitySwitch.readyCalls, 1, 'identity change must fence the old retry before controller.ready');
  assert.equal(identitySwitch.ownerCalls.some(call => call.type === 'bound'), false);
  assert.equal(identitySwitch.ownerCalls.some(call => call.type === 'blocked'), false);
  assert.equal(identitySwitch.controllerDestroyed, 1);

  let releaseLateRetry;
  let lateReadyCalls = 0;
  const lateGeneration = createMountHarness({
    ready: async () => {
      lateReadyCalls += 1;
      if (lateReadyCalls === 1) throw codedError('publication_context_unavailable');
      return new Promise(resolve => { releaseLateRetry = resolve; });
    },
  });
  await wait(220);
  assert.equal(typeof releaseLateRetry, 'function', 'the single retry must be observable before generation invalidation');
  lateGeneration.selector._beginModuleTransition('physics');
  lateGeneration.selector.activeModule.physics = null;
  lateGeneration.windowObject.location.hash = '#physics';
  releaseLateRetry(lateGeneration.contextValue);
  await settle();
  assert.equal(lateGeneration.ownerCalls.some(call => call.type === 'bound'), false, 'late old-generation success must not bind');
  assert.equal(lateGeneration.ownerCalls.some(call => call.type === 'blocked'), false);
  assert.equal(lateGeneration.controllerDestroyed, 1);
}

async function testFirstCanonicalLoadWaitsForPublicationAuthority() {
  let publicationReady = false;
  let attempts = 0;
  const warmingSnapshot = () => Object.freeze({
    class_id: publicationReady ? 12 : null,
    classes: Object.freeze(publicationReady ? [{ id: 12 }] : []),
    identity_id: '7',
    authority_generation: publicationReady ? 5 : 4,
  });
  const coldLoad = createMountHarness({
    providerSnapshot: warmingSnapshot,
    ready: async () => {
      attempts += 1;
      if (!publicationReady) throw codedError('publication_context_unavailable');
      return exactContext();
    },
  });
  await settle();
  assert.equal(coldLoad.readyCalls, 1);
  setTimeout(() => { publicationReady = true; }, 320);
  await wait(250);
  assert.equal(
    coldLoad.readyCalls,
    1,
    'a lost catalogue-ready event must not spend the only retry before publication authority is ready'
  );
  await wait(300);
  await settle();
  assert.equal(coldLoad.readyCalls, 2, 'the existing controller may initialize once after authority stabilizes');
  assert.equal(coldLoad.mountCalls, 1, 'first-load recovery must not duplicate the evidence DOM mount');
  assert.equal(coldLoad.ownerCalls.filter(call => call.type === 'bound').length, 1);
  assert.equal(coldLoad.ownerCalls.some(call => call.type === 'blocked'), false);
  assert.equal(attempts, 2);

  const permanentlyWarming = createMountHarness({
    providerSnapshot: () => Object.freeze({
      class_id: null,
      classes: Object.freeze([]),
      identity_id: '7',
      authority_generation: 4,
    }),
    ready: async () => { throw codedError('publication_context_unavailable'); },
  });
  await wait(2700);
  await settle();
  assert.equal(permanentlyWarming.readyCalls, 1, 'an unstable publication owner must not be polled through controller.ready');
  assert.deepEqual(
    permanentlyWarming.ownerCalls.filter(call => call.type === 'blocked').map(call => call.code),
    ['publication_context_unavailable']
  );

  for (const invalidation of ['route', 'identity']) {
    const cancelled = createMountHarness({
      providerSnapshot: () => Object.freeze({
        class_id: null,
        classes: Object.freeze([]),
        identity_id: '7',
        authority_generation: 4,
      }),
      ready: async () => { throw codedError('publication_context_unavailable'); },
    });
    await settle();
    if (invalidation === 'route') {
      cancelled.selector._beginModuleTransition('physics');
      cancelled.selector.activeModule.physics = null;
      cancelled.windowObject.location.hash = '#physics';
    } else {
      cancelled.setUser({ id: 8, role: 'student' });
    }
    await wait(180);
    assert.equal(cancelled.readyCalls, 1, `${invalidation} invalidation must cancel provider readiness waiting`);
    assert.equal(cancelled.ownerCalls.some(call => call.type === 'bound' || call.type === 'blocked'), false);
    assert.equal(cancelled.controllerDestroyed, 1);
  }
}

async function testSameScopePublicationOwnerIsSingleFlight() {
  for (const seed of [3, 11, 29, 47, 83]) {
    const harness = await createPublicationOwnerContentionHarness(seed);
    await wait(420);
    await settle();
    assert.equal(
      harness.ownerCalls.filter(call => call.type === 'bound').length,
      1,
      `same-scope publication readers must converge on one owner flight; seed=${seed}; trace=${JSON.stringify(harness.trace)}`
    );
    assert.equal(harness.ownerCalls.some(call => call.type === 'blocked'), false);
    assert.equal(harness.readyCalls, 1, 'same-scope contention must not consume the evidence ready retry');
    assert.equal(harness.mountCalls, 1);
    assert.equal(harness.evidencePosts.length, 0);
    assert.equal(harness.competitorCalls, 1);
    assert.equal(harness.courseRequests, 2, 'ready and authority recheck each use one non-duplicated GET flight');
  }
}

async function testPublicationFlightWaitersAndInvalidation() {
  const harness = createPublicationFlightHarness();
  const user7 = { id: 7, role: 'student' };
  const user8 = { id: 8, role: 'student' };
  const mechanics = Object.freeze({
    galaxy_key: 'englab',
    course_key: 'physics',
    activity_key: 'physics.mechanics',
  });
  const gasLaws = Object.freeze({
    galaxy_key: 'englab',
    course_key: 'physics',
    activity_key: 'physics.gas-laws',
  });
  harness.setUser(user7);

  const prepareAbortA = new AbortController();
  const prepareAbortB = new AbortController();
  const prepareA = harness.publication.prepare(user7, { signal: prepareAbortA.signal });
  const prepareB = harness.publication.prepare(user7, { signal: prepareAbortB.signal });
  assert.equal(harness.requestsFor('/api/classes').length, 1, 'same identity must share one classes request');
  const sharedPrepareRequest = harness.requestsFor('/api/classes')[0];
  prepareAbortA.abort();
  assert.equal((await prepareA).error_code, 'cancelled');
  assert.equal(sharedPrepareRequest.signal.aborted, false, 'one detached prepare waiter must preserve the owner');
  sharedPrepareRequest.resolve([{ id: 12, name: 'A 班' }]);
  assert.equal((await prepareB).available, true);

  const resolveAbortA = new AbortController();
  const resolveAbortB = new AbortController();
  const resolveA = harness.publication.resolve(mechanics, { signal: resolveAbortA.signal });
  const resolveB = harness.publication.resolve(mechanics, { signal: resolveAbortB.signal });
  assert.equal(harness.requestsFor('/api/courses').length, 1, 'same authority readers must share one courses request');
  const sharedResolveRequest = harness.requestsFor('/api/courses')[0];
  resolveAbortA.abort();
  assert.equal((await resolveA).error_code, 'cancelled');
  assert.equal(sharedResolveRequest.signal.aborted, false, 'one detached resolve waiter must preserve the owner');
  sharedResolveRequest.resolve([{ id: 23, galaxy_key: 'englab', course_key: 'physics' }]);
  assert.equal((await resolveB).available, true);

  const allAbortA = new AbortController();
  const allAbortB = new AbortController();
  const allA = harness.publication.resolve(mechanics, { signal: allAbortA.signal });
  const allB = harness.publication.resolve(mechanics, { signal: allAbortB.signal });
  const allAbortRequest = harness.requestsFor('/api/courses')[1];
  allAbortA.abort();
  assert.equal(allAbortRequest.signal.aborted, false);
  allAbortB.abort();
  assert.equal(allAbortRequest.signal.aborted, true, 'the final resolve waiter must abort the owner request');
  assert.equal((await allA).error_code, 'cancelled');
  assert.equal((await allB).error_code, 'cancelled');

  const crossResolve = harness.publication.resolve(mechanics);
  const crossResolveRequest = harness.requestsFor('/api/courses')[2];
  const crossPrepare = harness.publication.prepare(user7);
  const crossPrepareRequest = harness.requestsFor('/api/classes')[1];
  assert.equal(
    crossResolveRequest.signal.aborted,
    false,
    'same-identity prepare must not cancel an authority-stable resolve flight'
  );
  crossPrepareRequest.resolve([{ id: 12, name: 'A 班' }]);
  assert.equal((await crossPrepare).available, true);
  assert.equal(crossResolveRequest.signal.aborted, false);
  crossResolveRequest.resolve([{ id: 23, galaxy_key: 'englab', course_key: 'physics' }]);
  assert.equal((await crossResolve).available, true);

  const staleIdentityResolve = harness.publication.resolve(mechanics);
  const staleIdentityRequest = harness.requestsFor('/api/courses')[3];
  const identityPrepare = harness.publication.prepare(user8);
  assert.equal(staleIdentityRequest.signal.aborted, true, 'identity change must abort the old resolve owner');
  const user8Classes = harness.requestsFor('/api/classes')[2];
  user8Classes.resolve([{ id: 12, name: 'A 班' }]);
  assert.equal((await staleIdentityResolve).error_code, 'cancelled');
  assert.equal((await identityPrepare).available, true);
  assert.equal(harness.publication.snapshot().identity_id, '8');

  const prepareAllAbortA = new AbortController();
  const prepareAllAbortB = new AbortController();
  const prepareAllA = harness.publication.prepare(user8, { signal: prepareAllAbortA.signal });
  const prepareAllB = harness.publication.prepare(user8, { signal: prepareAllAbortB.signal });
  const prepareAllRequest = harness.requestsFor('/api/classes')[3];
  prepareAllAbortA.abort();
  prepareAllAbortB.abort();
  await settle(4);
  assert.equal(prepareAllRequest.signal.aborted, true, 'all prepare waiters leaving must abort the owner request');
  assert.equal((await prepareAllA).error_code, 'cancelled');
  assert.equal((await prepareAllB).error_code, 'cancelled');

  const delayedCanonicalResolve = harness.publication.resolve(mechanics);
  const delayedCanonicalRequest = harness.requestsFor('/api/courses').at(-1);
  harness.windowObject.dispatchEvent({
    type: 'hashchange',
    oldURL: 'http://127.0.0.1:9001/#physics',
    newURL: 'http://127.0.0.1:9001/#physics/mechanics',
  });
  assert.equal(
    harness.windowObject.location.hash,
    '#physics/mechanics',
    'the production route remains canonical when a delayed hashchange is delivered'
  );
  assert.equal(
    delayedCanonicalRequest.signal.aborted,
    false,
    'a delayed same-route hashchange must not cancel the current authority owner'
  );
  delayedCanonicalRequest.resolve([{ id: 23, galaxy_key: 'englab', course_key: 'physics' }]);
  assert.equal((await delayedCanonicalResolve).available, true);

  const staleRouteResolve = harness.publication.resolve(mechanics);
  const staleRouteRequest = harness.requestsFor('/api/courses').at(-1);
  harness.windowObject.location.hash = '#physics/gas-laws';
  harness.windowObject.dispatchEvent({
    type: 'hashchange',
    oldURL: 'http://127.0.0.1:9001/#physics/mechanics',
    newURL: 'http://127.0.0.1:9001/#physics/gas-laws',
  });
  assert.equal(staleRouteRequest.signal.aborted, true, 'route owner change must abort the old resolve flight');
  const nextRouteResolve = harness.publication.resolve(gasLaws);
  const nextRouteRequest = harness.requestsFor('/api/courses').at(-1);
  assert.notEqual(nextRouteRequest, staleRouteRequest, 'different route/activity keys must not share a flight');
  nextRouteRequest.resolve([{ id: 23, galaxy_key: 'englab', course_key: 'physics' }]);
  assert.equal((await staleRouteResolve).error_code, 'cancelled');
  const nextRouteContext = await nextRouteResolve;
  assert.equal(nextRouteContext.available, true);
  assert.equal(nextRouteContext.activity_key, 'physics.gas-laws');

  const leaveRouteResolve = harness.publication.resolve(gasLaws);
  const leaveRouteRequest = harness.requestsFor('/api/courses').at(-1);
  harness.windowObject.location.hash = '#planets';
  harness.windowObject.dispatchEvent({
    type: 'hashchange',
    oldURL: 'http://127.0.0.1:9001/#physics/gas-laws',
    newURL: 'http://127.0.0.1:9001/#planets',
  });
  assert.equal(leaveRouteRequest.signal.aborted, true, 'leaving the course route must abort the resolve owner');
  assert.equal((await leaveRouteResolve).error_code, 'cancelled');
}

async function testColdReloadPublicationRecovery() {
  const harness = createColdReloadRaceHarness();
  await settle(48);
  assert.equal(harness.classRequests, 1, 'cold load must join the existing same-identity classes owner');
  assert.equal(harness.firstClassesAborted, 0, 'same-identity publication readers must not abort the owner classes request');
  assert.equal(harness.readyCalls, 1, 'the evidence initialization may wait on the shared owner flight');
  assert.equal(harness.windowObject.PhysicsSim.evidenceReady, false);
  assert.equal(harness.windowObject.location.hash, '#physics/mechanics');
  assert.equal(harness.ownerCalls.some(call => call.type === 'blocked'), false, 'transient failure must remain recoverable');

  harness.setCatalogueReady();
  await wait(220);
  await settle();
  assert.equal(harness.windowObject.location.hash, '#physics/mechanics', 'recovery must not require route churn');
  assert.equal(harness.windowObject.PhysicsSim.evidenceReady, true, 'stable authority must bind the existing Physics owner');
  assert.equal(harness.readyCalls, 1, 'single-flight authority must avoid consuming controller.ready recovery');
  assert.equal(harness.mountCalls, 1, 'recovery must reuse one evidence controller and one DOM mount');
  assert.equal(harness.evidencePosts.length, 0, 'ModuleSelector recovery must issue no evidence POST or duplicate started');
  assert.equal(harness.clearCalls.length, 0, 'a recovered mount must preserve buffered domain commands');
  assert.equal(harness.warnings.length, 0, 'a recovered transient must not emit the terminal unavailable warning');
  assert.equal(harness.ownerCalls.filter(call => call.type === 'bound').length, 1);
  assert.ok(
    harness.apiCalls.every(call => /^\/api\/(?:classes|courses)/.test(call.route)),
    'the recovery may only re-read publication authority'
  );

  harness.selector._beginModuleTransition('physics');
  assert.equal(harness.controllerDestroyed, 1, 'later route teardown must release the recovered controller once');
}

async function testPublicationAuthority() {
  let sessionUser = { id: 7, role: 'student' };
  const calls = [];
  const windowObject = {
    location: { hash: '#physics/mechanics' },
    addEventListener() {},
    AstraApplicationSession: { getUser: () => sessionUser },
    AstraApiClient: {
      async request(route, options = {}) {
        calls.push({ route, options });
        if (route === '/api/classes') return [{ id: 12, name: 'A' }];
        if (route === '/api/courses') return [{ id: 23, galaxy_key: 'englab', course_key: 'physics' }];
        if (route === '/api/courses/23/units') {
          return [{ id: 34, activity_key: 'physics.mechanics', effective_release_state: 'open' }];
        }
        throw new Error(`unexpected ${route}`);
      },
      isCancelled: () => false,
    },
  };
  const context = { window: windowObject, console, AbortController };
  vm.createContext(context);
  vm.runInContext(publicationSource, context, { filename: 'shared/js/engineering-lab-publication-context.js' });
  const provider = windowObject.AstraEngineeringLabPublicationContext;
  const mapping = { galaxy_key: 'englab', course_key: 'physics', activity_key: 'physics.mechanics' };
  const first = await provider.resolve(mapping);
  assert.equal(first.available, true);
  assert.equal(first.identity_id, '7');
  assert.equal(first.access_state, 'open');
  assert.ok(Number.isInteger(first.authority_generation) && first.authority_generation > 0);
  assert.equal(provider.sameLearningEvidenceAuthority(first, first), true);

  const callCount = calls.length;
  windowObject.location.hash = '#physics/gas-laws';
  const wrongRoute = await provider.resolve(mapping);
  assert.equal(wrongRoute.error_code, 'activity_hidden');
  assert.equal(calls.length, callCount, 'wrong route must fail before publication requests');

  provider.close();
  sessionUser = { id: 8, role: 'student' };
  windowObject.location.hash = '#physics/mechanics';
  const second = await provider.resolve(mapping);
  assert.equal(second.identity_id, '8');
  assert.notEqual(second.authority_generation, first.authority_generation);
  assert.equal(provider.sameLearningEvidenceAuthority(first, second), false);
}

(async () => {
  await testMountBinding();
  await testMountFailures();
  await testBoundedRecoveryCancellation();
  await testSameScopePublicationOwnerIsSingleFlight();
  await testPublicationFlightWaitersAndInvalidation();
  await testFirstCanonicalLoadWaitsForPublicationAuthority();
  await testColdReloadPublicationRecovery();
  await testPublicationAuthority();
  console.log('physics mechanics binding contract: mount/reload-recovery/manual/provider/route/identity/generation gates ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
