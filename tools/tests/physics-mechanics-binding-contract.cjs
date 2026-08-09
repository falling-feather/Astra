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
  const controller = options.controller === null ? null : {
    context: () => contextValue,
    ready: options.ready || (async () => contextValue),
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
    AstraLearningEvidenceLoader: {
      ensure: options.ensure || (() => Promise.resolve()),
      clearDomainCommands(...args) { clearCalls.push(args); },
    },
    AstraLearningEvidenceActivity: options.activityMissing ? null : {
      mount(settings) { mountOptions = settings; return controller; },
    },
    AstraEngineeringLabPublicationContext: options.providerMissing ? null : {
      async resolve(mapping, requestOptions) {
        providerCalls.push(mapping);
        providerOptions.push(requestOptions);
        return providerImpl(mapping, providerCalls.length, requestOptions);
      },
      sameLearningEvidenceAuthority: sameAuthority,
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
    document: {},
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
    setPendingImpl(next) { pendingImpl = next; },
    setProviderImpl(next) { providerImpl = next; },
    setPermit(next) { permit = Boolean(next); },
    setCommandReady(next) { commandReady = Boolean(next); },
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

  const unavailable = createMountHarness({
    ready: async () => { throw codedError('publication_context_unavailable'); },
  });
  await settle();
  assert.deepEqual(
    unavailable.ownerCalls.filter(call => call.type === 'blocked').map(call => call.code),
    ['publication_context_unavailable']
  );
  assert.equal(unavailable.controllerDestroyed, 1, 'authority failure must release its controller');

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
  await testPublicationAuthority();
  console.log('physics mechanics binding contract: mount/manual/provider/route/identity/generation gates ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
