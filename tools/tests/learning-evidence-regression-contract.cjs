const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const root = path.resolve(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const queueSource = read('shared/js/learning-evidence-queue.js');
const clientSource = read('shared/js/learning-evidence-client.js');
const loaderSource = read('shared/js/learning-evidence-loader.js');
const appSessionSource = read('shared/js/app-session.js');
const roleHomeSource = read('shared/js/role-home-client.js');
const studentOwnerSource = read('shared/js/student-learning-evidence.js');
const challengeSource = read('codevis/pages/course-challenge/course-challenge.js');
const codeSpaceStudentContextSource = read('codevis/shared/js/student-context.js');
const studentPageSource = read('pages/student/student-workbench.js');
const teacherPageSource = read('pages/teacher/teacher.js');
const teacherOwnerSource = read('shared/js/teacher-learning-evidence.js');
const capabilitiesSource = read('shared/js/product-capabilities.js');
const authorityClearMarkerKey = 'astra-learning-evidence-authority-clear-pending-v1';
const authorityClearCookieKey = 'astra_learning_evidence_authority_clear_pending_v1';
const authorityClearEpochKey = 'astra-learning-evidence-authority-clear-epoch-v1';
const authorityClearEpochCookieKey = 'astra_learning_evidence_authority_clear_epoch_v1';
const authorityClearChannelName = 'astra-learning-evidence-authority-clear-v1';
const authorityClearMessage = Object.freeze({
  type: 'authority-clear-pending',
  marker: '1',
});

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = String(tagName).toUpperCase();
    this.dataset = {};
    this.children = [];
    this.listeners = new Map();
    this.innerHTML = '';
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.isConnected = true;
    this.parentNode = null;
    this.classList = {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; },
    };
  }

  setAttribute(name, value) {
    this[name] = String(value);
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }

  appendChild(child) {
    child.parentNode = this;
    child.isConnected = true;
    this.children.push(child);
    return child;
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  replaceChildren(...children) {
    this.children.forEach((child) => {
      child.parentNode = null;
      child.isConnected = false;
    });
    this.children = [];
    this.append(...children);
  }

  prepend(child) {
    child.parentNode = this;
    child.isConnected = true;
    this.children.unshift(child);
  }

  insertAdjacentElement(_position, child) {
    return this.appendChild(child);
  }

  remove() {
    this.isConnected = false;
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    }
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }

  closest() {
    return null;
  }
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function assertOutcome(actual, outcome, state) {
  assert.equal(actual && actual.outcome, outcome);
  if (state !== undefined) assert.equal(actual && actual.state, state);
}

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [String(key), String(value)]));
  const failures = { read: false, write: false, remove: false };
  return {
    getItem(key) {
      if (failures.read) throw new Error('localStorage read failed');
      const normalized = String(key);
      return values.has(normalized) ? values.get(normalized) : null;
    },
    setItem(key, value) {
      if (failures.write) throw new Error('localStorage write failed');
      values.set(String(key), String(value));
    },
    removeItem(key) {
      if (failures.remove) throw new Error('localStorage remove failed');
      values.delete(String(key));
    },
    setFailure(operation, active = true) {
      assert.ok(Object.hasOwn(failures, operation), `unknown storage failure operation: ${operation}`);
      failures[operation] = Boolean(active);
    },
    entries() {
      return Array.from(values.entries());
    },
  };
}

function createCookieJar(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [String(key), String(value)]));
  const failures = { read: false, write: false };
  return {
    read() {
      if (failures.read) throw new Error('cookie read failed');
      return Array.from(values.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
    },
    write(serialized) {
      if (failures.write) throw new Error('cookie write failed');
      const parts = String(serialized || '').split(';').map((part) => part.trim());
      const pair = parts.shift() || '';
      const separator = pair.indexOf('=');
      if (separator < 0) return;
      const key = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      const maxAge = parts.find((part) => /^max-age=/i.test(part));
      if (!value || (maxAge && Number(maxAge.slice(maxAge.indexOf('=') + 1)) <= 0)) values.delete(key);
      else values.set(key, value);
    },
    setFailure(operation, active = true) {
      assert.ok(Object.hasOwn(failures, operation), `unknown cookie failure operation: ${operation}`);
      failures[operation] = Boolean(active);
    },
    entries() {
      return Array.from(values.entries());
    },
  };
}

function createEvidencePageRuntime({
  storage,
  clearState,
  cookieJar = createCookieJar(),
  BroadcastChannel,
}) {
  const metrics = {
    clearCalls: 0,
    clearReasons: [],
    configureCalls: 0,
    suspendCalls: 0,
    apiCalls: [],
    reloads: 0,
    redirects: [],
  };
  const listeners = new Map();
  const body = new FakeElement('body');
  const document = {
    baseURI: 'https://astra.test/',
    currentScript: { src: 'https://astra.test/shared/js/learning-evidence-loader.js' },
    scripts: [],
    body,
    head: new FakeElement('head'),
    documentElement: new FakeElement('html'),
    createElement(tagName) { return new FakeElement(tagName); },
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get() { return cookieJar.read(); },
    set(value) { cookieJar.write(value); },
  });
  const location = {
    origin: 'https://astra.test',
    href: 'https://astra.test/',
    search: '',
    assign(target) {
      metrics.redirects.push(String(target));
      this.href = new URL(String(target), this.href).href;
    },
    reload() {
      metrics.reloads += 1;
    },
  };
  const evidenceClient = {
    subscribe() { return () => {}; },
    suspendAuthority() {
      metrics.suspendCalls += 1;
    },
    async clearAuthority(reason) {
      metrics.clearCalls += 1;
      metrics.clearReasons.push(reason);
      if (typeof clearState.run === 'function') return clearState.run(reason);
      if (clearState.fail) {
        const error = new Error('indexeddb clear failed');
        error.code = 'indexeddb_transaction_failed';
        throw error;
      }
    },
    async configureIdentity() {
      metrics.configureCalls += 1;
    },
  };
  const context = {
    console: { warn() {}, error() {} },
    URL,
    URLSearchParams,
    AbortController,
    document,
    location,
    localStorage: storage,
    BroadcastChannel,
    Element: FakeElement,
    HTMLFormElement: FakeElement,
    FormData: class {},
    CustomEvent: class {
      constructor(type, options) {
        this.type = type;
        this.detail = options && options.detail;
      }
    },
    AstraLearningEvidenceQueue: {},
    AstraLearningEvidenceClient: evidenceClient,
    AstraLearningEvidenceStatus: {},
    AstraLearningActivityCatalog: {},
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      if (listeners.has(type)) listeners.get(type).delete(listener);
    },
    dispatchEvent(event) {
      Array.from(listeners.get(event && event.type) || []).forEach((listener) => listener.call(context, event));
      return true;
    },
    alert() {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    window: null,
  };
  context.window = context;
  const instrumentedLoader = loaderSource.replace(
    'global.AstraLearningEvidenceLoader = Object.freeze({',
    'global.__learningEvidenceFreshAuthority = FRESH_SESSION_AUTHORITY;\n    global.AstraLearningEvidenceLoader = Object.freeze({',
  );
  assert.notEqual(instrumentedLoader, loaderSource, 'loader fresh authority instrumentation must apply');
  vm.createContext(context);
  vm.runInContext(instrumentedLoader, context, { filename: 'learning-evidence-loader.js' });
  return { context, document, metrics, cookieJar };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createBroadcastBus() {
  const channels = new Set();
  const messages = [];
  const pendingDeliveries = [];
  let closeCalls = 0;
  let deliveryPaused = false;

  const deliver = (peer, data) => {
    const operation = () => {
      if (!peer.closed) peer.listeners.forEach((listener) => listener({ data }));
    };
    if (deliveryPaused) pendingDeliveries.push(operation);
    else Promise.resolve().then(operation);
  };

  class TestBroadcastChannel {
    constructor(name) {
      this.name = String(name);
      this.closed = false;
      this.listeners = new Set();
      channels.add(this);
    }

    addEventListener(type, listener) {
      if (type === 'message' && typeof listener === 'function') this.listeners.add(listener);
    }

    removeEventListener(type, listener) {
      if (type === 'message') this.listeners.delete(listener);
    }

    postMessage(data) {
      if (this.closed) throw new Error('BroadcastChannel is closed');
      messages.push(JSON.parse(JSON.stringify(data)));
      for (const peer of channels) {
        if (peer === this || peer.closed || peer.name !== this.name) continue;
        deliver(peer, data);
      }
    }

    close() {
      if (this.closed) return;
      this.closed = true;
      this.listeners.clear();
      channels.delete(this);
      closeCalls += 1;
    }
  }

  return {
    BroadcastChannel: TestBroadcastChannel,
    broadcast(name, data) {
      for (const channel of channels) {
        if (channel.closed || channel.name !== name) continue;
        deliver(channel, data);
      }
    },
    pause() {
      deliveryPaused = true;
    },
    deliverAll() {
      deliveryPaused = false;
      pendingDeliveries.splice(0).forEach((operation) => operation());
    },
    pendingCount() { return pendingDeliveries.length; },
    activeCount() { return channels.size; },
    listenerCount() {
      return Array.from(channels).reduce((count, channel) => count + channel.listeners.size, 0);
    },
    closeCalls() { return closeCalls; },
    messages,
  };
}

function createLiveClientRuntime({
  storage,
  cookieJar,
  BroadcastChannel,
  initialRecords = [],
  acquireLease,
}) {
  const records = initialRecords.slice();
  const queueListeners = new Set();
  const eventListeners = new Map();
  const timeouts = new Map();
  const intervals = new Map();
  let timerId = 0;
  const metrics = {
    aborts: 0,
    apiCalls: [],
    queueConfigureCalls: 0,
    releaseLeaseCalls: 0,
    renewLeaseCalls: 0,
    suspendCalls: 0,
    inFlightSignal: null,
    writeRequests: [],
  };
  const document = {
    baseURI: 'https://astra.test/',
    currentScript: { src: 'https://astra.test/shared/js/learning-evidence-loader.js' },
    scripts: [],
    body: new FakeElement('body'),
    head: new FakeElement('head'),
    documentElement: new FakeElement('html'),
    createElement(tagName) { return new FakeElement(tagName); },
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get() { return cookieJar.read(); },
    set(value) { cookieJar.write(value); },
  });
  const queue = {
    async configureIdentity() {
      metrics.queueConfigureCalls += 1;
    },
    async clearAuthority() {
      records.length = 0;
    },
    subscribe(listener) {
      queueListeners.add(listener);
      return () => queueListeners.delete(listener);
    },
    async enqueue(payload) {
      const record = {
        client_event_id: payload.client_event_id,
        payload,
        state: 'local-pending',
        attempts: 0,
        next_attempt_at: 0,
      };
      records.push(record);
      return record;
    },
    async updateState(clientEventId, state) {
      const record = records.find((item) => item.client_event_id === clientEventId);
      if (record) record.state = state;
      return record;
    },
    async remove(clientEventId) {
      const index = records.findIndex((item) => item.client_event_id === clientEventId);
      if (index >= 0) records.splice(index, 1);
    },
    async list(options = {}) {
      return records.filter((record) => !options.states || options.states.includes(record.state));
    },
    async stats() {
      return { count: records.length, bytes: 0, oldest_at: null };
    },
    async acquireLease() {
      return typeof acquireLease === 'function' ? acquireLease() : true;
    },
    async renewLease() {
      metrics.renewLeaseCalls += 1;
      return true;
    },
    async releaseLease() {
      metrics.releaseLeaseCalls += 1;
    },
  };
  const context = {
    console: { warn() {}, error() {} },
    URL,
    URLSearchParams,
    TextEncoder,
    AbortController,
    crypto: webcrypto,
    document,
    location: {
      origin: 'https://astra.test',
      href: 'https://astra.test/',
      search: '',
    },
    localStorage: storage,
    BroadcastChannel,
    AstraLearningEvidenceQueue: queue,
    AstraLearningEvidenceStatus: {},
    AstraLearningActivityCatalog: {},
    AstraApiClient: {
      isOffline() { return false; },
      async request(pathname, options) {
        metrics.apiCalls.push(pathname);
        if (pathname.endsWith('/events/batch') || pathname.endsWith('/events')) {
          const request = {
            pathname,
            signal: options && options.signal || null,
            aborted: false,
          };
          metrics.writeRequests.push(request);
          metrics.inFlightSignal = request.signal;
          return new Promise((resolve, reject) => {
            if (!options || !options.signal) return;
            if (options.signal.aborted) {
              request.aborted = true;
              metrics.aborts += 1;
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
              return;
            }
            options.signal.addEventListener('abort', () => {
              request.aborted = true;
              metrics.aborts += 1;
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            }, { once: true });
          });
        }
        throw new Error(`unexpected evidence request: ${pathname}`);
      },
    },
    addEventListener(type, listener) {
      if (!eventListeners.has(type)) eventListeners.set(type, new Set());
      eventListeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      if (eventListeners.has(type)) eventListeners.get(type).delete(listener);
    },
    dispatchEvent(event) {
      Array.from(eventListeners.get(event && event.type) || []).forEach((listener) => listener.call(context, event));
      return true;
    },
    setTimeout(callback) {
      const id = ++timerId;
      timeouts.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timeouts.delete(id);
    },
    setInterval(callback) {
      const id = ++timerId;
      intervals.set(id, callback);
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    window: null,
  };
  context.window = context;
  vm.createContext(context);
  const instrumentedClient = clientSource.replace(
    /function suspendAuthority\(\) \{(\r?\n)        invalidateAuthority\(\);/,
    'function suspendAuthority() {$1        global.__liveSuspendCalls = (global.__liveSuspendCalls || 0) + 1;$1        invalidateAuthority();',
  );
  assert.notEqual(instrumentedClient, clientSource, 'client suspend instrumentation must apply');
  vm.runInContext(instrumentedClient, context, { filename: 'learning-evidence-client.js' });
  const instrumentedLoader = loaderSource.replace(
    'global.AstraLearningEvidenceLoader = Object.freeze({',
    'global.__learningEvidenceFreshAuthority = FRESH_SESSION_AUTHORITY;\n    global.AstraLearningEvidenceLoader = Object.freeze({',
  );
  assert.notEqual(instrumentedLoader, loaderSource, 'loader fresh authority instrumentation must apply');
  vm.runInContext(instrumentedLoader, context, { filename: 'learning-evidence-loader.js' });
  return {
    context,
    client: context.AstraLearningEvidenceClient,
    loader: context.AstraLearningEvidenceLoader,
    metrics,
    records,
    timeouts,
    intervals,
  };
}

function installAppSessionHarness(runtime, server) {
  runtime.context.FormData = class {
    constructor(form) {
      this.values = form && form.values || {};
    }

    get(name) {
      return this.values[name];
    }
  };
  runtime.context.AstraPageRegistry = {
    resourcesForRole() { return []; },
    allRoleResources() { return []; },
    stylesForRole() { return []; },
  };
  runtime.context.AstraApiClient = {
    normalizeBaseUrl() { return ''; },
    message(error) { return error && error.message || 'error'; },
    async request(pathname) {
      runtime.metrics.apiCalls.push(pathname);
      if (pathname === '/api/auth/login') {
        server.loginCalls += 1;
        server.session = true;
        return {};
      }
      if (pathname === '/api/auth/register') {
        server.registerCalls += 1;
        return {};
      }
      if (pathname === '/api/users/me') {
        server.meCalls += 1;
        if (!server.session) {
          const error = new Error('unauthorized');
          error.status = 401;
          throw error;
        }
        return { id: 17, role: 'student', username: 'authority-test-student' };
      }
      return {};
    },
  };
  const instrumented = appSessionSource.replace(
    'global.AstraApplicationSession = Object.freeze({',
    [
      'global.__applicationSessionTest = Object.freeze({',
      '    state, submitLogin, submitRegister, reconcileSession,',
      '    retryLearningAuthorityClear, completeAuthentication',
      '});',
      'global.AstraApplicationSession = Object.freeze({',
    ].join('\n'),
  );
  assert.notEqual(instrumented, appSessionSource, 'app session auth instrumentation must apply');
  runtime.document.currentScript = { src: 'https://astra.test/shared/js/app-session.js' };
  vm.runInContext(instrumented, runtime.context, { filename: 'app-session.js' });
  return runtime.context.__applicationSessionTest;
}

function authForm(values) {
  return { values: Object.assign({}, values) };
}

function eventPayload(key, value = 17) {
  return {
    client_event_id: 'event-identity-0001',
    class_id: 3,
    course_id: 4,
    course_unit_id: 5,
    activity_key: 'physics.mechanics',
    rule_version: 2,
    event_type: 'attempted',
    evidence: {
      operation: 'simulation_launch',
      cursor: { stage: 'after-observation', nested: { [key]: value } },
    },
    occurred_at: '2026-07-28T08:00:00+08:00',
  };
}

async function testOfflineSensitiveKeysExecuteEnqueueValidator() {
  const instrumented = queueSource.replace(
    "let activeNamespace = '';",
    "let activeNamespace = 'test-namespace';",
  );
  assert.notEqual(instrumented, queueSource, 'queue namespace instrumentation must apply');
  const context = {
    console,
    TextEncoder,
    crypto: webcrypto,
    location: { origin: 'https://astra.test' },
    BroadcastChannel: undefined,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    window: null,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(instrumented, context, { filename: 'learning-evidence-queue.js' });

  const sensitiveSegments = [
    ['user', 'id'],
    ['account', 'id'],
    ['student', 'id'],
    ['teacher', 'id'],
    ['subject', 'user', 'id'],
    ['actor', 'id'],
    ['member', 'id'],
    ['person', 'id'],
    ['api', 'key'],
    ['session', 'id'],
    ['session', 'key'],
    ['access', 'key'],
    ['client', 'secret'],
  ];
  const forbidden = new Set();
  sensitiveSegments.forEach((segments) => {
    forbidden.add(segments.join('_'));
    forbidden.add(segments.join('-'));
    forbidden.add(segments.join('.'));
    forbidden.add(segments.join(''));
    forbidden.add(segments[0] + segments.slice(1).map(
      (segment) => segment[0].toUpperCase() + segment.slice(1),
    ).join(''));
  });
  for (const key of forbidden) {
    for (const value of [17, 'sensitive-value']) {
      await assert.rejects(
        context.AstraLearningEvidenceQueue.enqueue(eventPayload(key, value)),
        (error) => error && error.code === 'sensitive_evidence_rejected',
        `${key} must be rejected for ${typeof value} values through the real enqueue validator`,
      );
    }
  }

  let authorityClearedEvents = 0;
  context.AstraLearningEvidenceQueue.subscribe((change) => {
    if (change && change.type === 'authority-cleared') authorityClearedEvents += 1;
  });
  await assert.rejects(
    context.AstraLearningEvidenceQueue.clearAuthority('signed-out'),
    (error) => error && error.code === 'indexeddb_unavailable',
    'a physical IndexedDB clear failure must reject',
  );
  assert.equal(authorityClearedEvents, 0, 'a failed physical clear must not publish authority-cleared');
}

async function testLoaderClearFailureLatch() {
  let clearShouldFail = true;
  let clearCalls = 0;
  let configureCalls = 0;
  const localStorage = createMemoryStorage();
  const client = {
    subscribe() { return () => {}; },
    async clearAuthority() {
      clearCalls += 1;
      if (clearShouldFail) {
        const error = new Error('indexeddb clear failed');
        error.code = 'indexeddb_transaction_failed';
        throw error;
      }
    },
    async configureIdentity() {
      configureCalls += 1;
    },
  };
  const document = {
    baseURI: 'https://astra.test/',
    currentScript: { src: 'https://astra.test/shared/js/learning-evidence-loader.js' },
    scripts: [],
    head: new FakeElement('head'),
    querySelectorAll() { return []; },
    createElement(tagName) { return new FakeElement(tagName); },
  };
  const instrumented = loaderSource.replace(
    'global.AstraLearningEvidenceLoader = Object.freeze({',
    'global.__learningEvidenceFreshAuthority = FRESH_SESSION_AUTHORITY;\n    global.AstraLearningEvidenceLoader = Object.freeze({',
  );
  assert.notEqual(instrumented, loaderSource, 'loader fresh authority instrumentation must apply');
  const context = {
    console: { warn() {}, error() {} },
    URL,
    document,
    location: { origin: 'https://astra.test' },
    localStorage,
    AstraLearningEvidenceQueue: {},
    AstraLearningEvidenceClient: client,
    AstraLearningEvidenceStatus: {},
    AstraLearningActivityCatalog: {},
    addEventListener() {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    window: null,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(instrumented, context, { filename: 'learning-evidence-loader.js' });

  await assert.rejects(
    context.AstraLearningEvidenceLoader.clearAuthority('signed-out'),
    (error) => error && error.code === 'indexeddb_transaction_failed',
  );
  assert.equal(clearCalls, 1);
  assert.equal(localStorage.getItem(authorityClearMarkerKey), '1');
  assert.ok(localStorage.getItem(authorityClearEpochKey), 'failed clear must retain a non-sensitive epoch');

  await assert.rejects(
    context.AstraLearningEvidenceLoader.configureIdentity(
      { id: 17, role: 'student' },
      context.__learningEvidenceFreshAuthority,
    ),
    (error) => error && error.code === 'indexeddb_transaction_failed',
    'fresh proof must not bypass a failed physical clear',
  );
  assert.equal(clearCalls, 2, 'configure must retry physical clear while the failure latch is set');
  assert.equal(configureCalls, 0, 'identity and flush must stay disabled before clear succeeds');

  clearShouldFail = false;
  await context.AstraLearningEvidenceLoader.configureIdentity(
    { id: 17, role: 'student' },
    context.__learningEvidenceFreshAuthority,
  );
  assert.equal(clearCalls, 3, 'successful retry must physically clear before configure');
  assert.equal(configureCalls, 1);
  assert.equal(localStorage.getItem(authorityClearMarkerKey), null, 'successful physical clear must remove the transient marker');
  assert.ok(localStorage.getItem(authorityClearEpochKey), 'successful clear must retain its non-sensitive epoch');
}

async function testMarkerWriteFailureIsFailClosed() {
  const storage = createMemoryStorage();
  const cookieJar = createCookieJar();
  storage.setFailure('write');
  cookieJar.setFailure('write');
  const runtime = createEvidencePageRuntime({
    storage,
    cookieJar,
    clearState: { fail: false },
  });

  await assert.rejects(
    runtime.context.AstraLearningEvidenceLoader.clearAuthority('explicit-authentication'),
    (error) => error && error.code === 'learning_evidence_authority_marker_write_failed',
    'marker write failure must be visible to the caller',
  );
  assert.equal(runtime.metrics.clearCalls, 0, 'physical clear must not begin before the marker is durable');
  assert.ok(runtime.metrics.suspendCalls >= 1, 'marker failure must synchronously suspend an already loaded client');

  await assert.rejects(
    runtime.context.AstraLearningEvidenceLoader.configureIdentity(
      { id: 17, role: 'student' },
      runtime.context.__learningEvidenceFreshAuthority,
    ),
    (error) => error && error.code === 'learning_evidence_authority_marker_write_failed',
    'fresh proof must not bypass a marker write failure latch',
  );
  assert.equal(runtime.metrics.configureCalls, 0, 'identity and queue flush must remain disabled after marker failure');
}

async function testCookieFallbackBroadcastSuspendsLivePeer() {
  const sharedStorage = createMemoryStorage();
  const sharedCookieJar = createCookieJar();
  const bus = createBroadcastBus();
  sharedStorage.setFailure('write');
  const queuedPayload = eventPayload('queued_phase', 1);
  queuedPayload.client_event_id = 'event-batch-peer-0001';
  const peer = createLiveClientRuntime({
    storage: sharedStorage,
    cookieJar: sharedCookieJar,
    BroadcastChannel: bus.BroadcastChannel,
    initialRecords: [{
      client_event_id: queuedPayload.client_event_id,
      payload: queuedPayload,
      state: 'local-pending',
      attempts: 0,
      next_attempt_at: 0,
    }],
  });
  const physicalClear = createDeferred();
  const origin = createEvidencePageRuntime({
    storage: sharedStorage,
    cookieJar: sharedCookieJar,
    BroadcastChannel: bus.BroadcastChannel,
    clearState: {
      run() { return physicalClear.promise; },
    },
  });
  assert.equal(bus.activeCount(), 2, 'both live pages must own one pending-clear listener');
  assert.equal(bus.listenerCount(), 2, 'each pending-clear channel must have one message listener');

  await peer.loader.configureIdentity(
    { id: 17, role: 'student' },
    peer.context.__learningEvidenceFreshAuthority,
  );
  assert.equal(peer.metrics.queueConfigureCalls, 1);
  assert.ok(peer.timeouts.size > 0, 'configured peer must have a scheduled flush before revocation');

  const onlinePayload = eventPayload('online_phase', 2);
  onlinePayload.client_event_id = 'event-online-peer-0001';
  const flushPromise = peer.client.flush();
  const recordPromise = peer.client.record(onlinePayload);
  await waitFor(
    () => peer.metrics.writeRequests.length === 2,
    'peer batch and direct record requests',
  );
  assert.ok(
    peer.metrics.writeRequests.every((request) => request.signal && !request.signal.aborted),
    'both session-bound writes must begin with live authority signals',
  );

  let physicalClearSettled = false;
  const clearPromise = origin.context.AstraLearningEvidenceLoader
    .clearAuthority('explicit-authentication');
  clearPromise.then(
    () => { physicalClearSettled = true; },
    () => { physicalClearSettled = true; },
  );
  await waitFor(
    () => sharedCookieJar.entries().some(([key]) => key === authorityClearCookieKey),
    'cookie fallback marker',
  );
  await waitFor(
    () => peer.metrics.writeRequests.every((request) => request.signal.aborted),
    'peer authority write aborts',
  );

  assert.equal(physicalClearSettled, false, 'peer suspension must precede the origin physical clear result');
  assert.ok((peer.context.__liveSuspendCalls || 0) >= 1, 'peer loader must synchronously suspend its client');
  assert.equal(peer.timeouts.size, 0, 'peer scheduled flush must be cancelled');
  assert.equal(peer.intervals.size, 0, 'peer lease renewal must be cancelled');
  assert.ok(peer.metrics.writeRequests.every((request) => request.aborted), 'no in-flight write remains committable');
  assertOutcome(await flushPromise, 'cancelled', '');
  assertOutcome(await recordPromise, 'cancelled', '');
  await assert.rejects(
    peer.client.record(eventPayload('after_marker', 3)),
    (error) => error && error.code === 'identity_required',
    'peer record must fail closed before the origin physical clear finishes',
  );
  assertOutcome(await peer.client.flush(), 'skipped');
  await waitFor(() => peer.metrics.releaseLeaseCalls >= 1, 'peer lease release after suspension');

  assert.ok(bus.messages.length >= 1, 'durable cookie fallback must be followed by a peer notice');
  bus.messages.forEach((message) => assert.deepEqual(message, authorityClearMessage));
  const serializedMessages = JSON.stringify(bus.messages);
  assert.doesNotMatch(serializedMessages, /student|user|account|reason|credential|17/i);

  const suspendCalls = peer.context.__liveSuspendCalls;
  const activeBeforeDuplicate = bus.activeCount();
  const listenersBeforeDuplicate = bus.listenerCount();
  bus.broadcast(authorityClearChannelName, authorityClearMessage);
  bus.broadcast(authorityClearChannelName, authorityClearMessage);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(peer.context.__liveSuspendCalls, suspendCalls, 'duplicate pending notices must be idempotent');
  assert.equal(bus.activeCount(), activeBeforeDuplicate, 'duplicate notices must not allocate channels');
  assert.equal(bus.listenerCount(), listenersBeforeDuplicate, 'duplicate notices must not leak listeners');

  const closeCallsBefore = bus.closeCalls();
  peer.context.dispatchEvent({ type: 'pagehide' });
  peer.context.dispatchEvent({ type: 'pagehide' });
  assert.equal(bus.activeCount(), 1, 'pagehide must close exactly the peer channel');
  assert.equal(bus.closeCalls(), closeCallsBefore + 1, 'repeated pagehide must close once');
  peer.context.dispatchEvent({ type: 'pageshow' });
  peer.context.dispatchEvent({ type: 'pageshow' });
  assert.equal(bus.activeCount(), 2, 'pageshow must reopen exactly one peer channel');
  assert.equal(bus.listenerCount(), 2);

  physicalClear.resolve();
  await clearPromise;
  peer.context.dispatchEvent({ type: 'pagehide' });
  origin.context.dispatchEvent({ type: 'pagehide' });
  assert.equal(bus.activeCount(), 0, 'both page lifecycles must release their channels');
}

async function testDelayedBroadcastStillRevokesAfterMarkerRemoval() {
  const sharedStorage = createMemoryStorage();
  const sharedCookieJar = createCookieJar();
  const bus = createBroadcastBus();
  const peer = createLiveClientRuntime({
    storage: sharedStorage,
    cookieJar: sharedCookieJar,
    BroadcastChannel: bus.BroadcastChannel,
  });
  const origin = createEvidencePageRuntime({
    storage: sharedStorage,
    cookieJar: sharedCookieJar,
    BroadcastChannel: bus.BroadcastChannel,
    clearState: { fail: false },
  });
  await peer.loader.configureIdentity(
    { id: 17, role: 'student' },
    peer.context.__learningEvidenceFreshAuthority,
  );
  const payload = eventPayload('delayed_broadcast', 6);
  payload.client_event_id = 'event-delayed-broadcast-0001';
  const recordPromise = peer.client.record(payload);
  await waitFor(() => peer.metrics.writeRequests.length === 1, 'delayed-broadcast online write');
  const request = peer.metrics.writeRequests[0];

  bus.pause();
  await origin.context.AstraLearningEvidenceLoader.clearAuthority('explicit-authentication');
  assert.equal(sharedStorage.getItem(authorityClearMarkerKey), null, 'source must already remove the transient marker');
  assert.equal(sharedCookieJar.entries().some(([key]) => key === authorityClearCookieKey), false);
  assert.ok(bus.pendingCount() >= 1, 'the pending-clear notice must still be queued');
  assert.equal(request.signal.aborted, false, 'paused delivery models a still-active old peer');

  bus.deliverAll();
  await waitFor(() => request.signal.aborted, 'delayed pending-clear delivery');
  assert.equal(request.aborted, true);
  assertOutcome(await recordPromise, 'cancelled', '');
  await assert.rejects(
    peer.client.record(eventPayload('after_delayed_broadcast', 7)),
    (error) => error && error.code === 'identity_required',
  );
  peer.context.dispatchEvent({ type: 'pagehide' });
  origin.context.dispatchEvent({ type: 'pagehide' });
}

async function testPageshowDetectsClearCompletedWhileChannelClosed() {
  const sharedStorage = createMemoryStorage();
  const sharedCookieJar = createCookieJar();
  const bus = createBroadcastBus();
  sharedStorage.setFailure('write');
  const peer = createLiveClientRuntime({
    storage: sharedStorage,
    cookieJar: sharedCookieJar,
    BroadcastChannel: bus.BroadcastChannel,
  });
  const origin = createEvidencePageRuntime({
    storage: sharedStorage,
    cookieJar: sharedCookieJar,
    BroadcastChannel: bus.BroadcastChannel,
    clearState: {
      run() {
        sharedStorage.setFailure('read', false);
      },
    },
  });
  await peer.loader.configureIdentity(
    { id: 17, role: 'student' },
    peer.context.__learningEvidenceFreshAuthority,
  );
  const configureCallsBefore = peer.metrics.queueConfigureCalls;
  peer.context.dispatchEvent({ type: 'pagehide' });
  assert.equal(bus.activeCount(), 1, 'hidden peer must release its BroadcastChannel');

  sharedStorage.setFailure('read');
  await origin.context.AstraLearningEvidenceLoader.clearAuthority('explicit-authentication');
  sharedStorage.setFailure('read');
  assert.equal(sharedStorage.entries().some(([key]) => key === authorityClearMarkerKey), false);
  assert.ok(
    sharedCookieJar.entries().some(([key, value]) => key === authorityClearEpochCookieKey && value),
    'cookie-only clear must retain a non-sensitive epoch token',
  );
  assert.equal(
    sharedStorage.entries().some(([key]) => key === authorityClearEpochKey),
    false,
    'localStorage write failure must be genuine',
  );

  peer.context.dispatchEvent({ type: 'pageshow' });
  await assert.rejects(
    peer.client.record(eventPayload('after_hidden_clear', 8)),
    (error) => error && error.code === 'identity_required',
    'restored peer must not reuse its old record authority',
  );
  assertOutcome(await peer.client.flush(), 'skipped');
  sharedStorage.setFailure('read', false);
  await assert.rejects(
    peer.loader.configureIdentity({ id: 17, role: 'student' }),
    (error) => error && error.code === 'identity_required',
    'restored peer must require a genuinely fresh session proof before configure',
  );
  assert.equal(peer.metrics.queueConfigureCalls, configureCallsBefore, 'old identity must not be configured again');
  sharedStorage.setFailure('read', false);
  sharedStorage.setFailure('write', false);
  peer.context.dispatchEvent({ type: 'pagehide' });
  origin.context.dispatchEvent({ type: 'pagehide' });
}

async function testDelayedStorageEventRevokesAfterMarkerRemoval() {
  const sharedStorage = createMemoryStorage();
  const sharedCookieJar = createCookieJar();
  const peer = createLiveClientRuntime({
    storage: sharedStorage,
    cookieJar: sharedCookieJar,
    BroadcastChannel: undefined,
  });
  const origin = createEvidencePageRuntime({
    storage: sharedStorage,
    cookieJar: sharedCookieJar,
    BroadcastChannel: undefined,
    clearState: { fail: false },
  });
  await peer.loader.configureIdentity(
    { id: 17, role: 'student' },
    peer.context.__learningEvidenceFreshAuthority,
  );
  const payload = eventPayload('delayed_storage_event', 9);
  payload.client_event_id = 'event-delayed-storage-0001';
  const recordPromise = peer.client.record(payload);
  await waitFor(() => peer.metrics.writeRequests.length === 1, 'delayed-storage online write');
  const request = peer.metrics.writeRequests[0];

  await origin.context.AstraLearningEvidenceLoader.clearAuthority('explicit-authentication');
  assert.equal(sharedStorage.getItem(authorityClearMarkerKey), null);
  assert.equal(request.signal.aborted, false, 'delayed storage delivery keeps the old request active until its event');
  peer.context.dispatchEvent({
    type: 'storage',
    key: authorityClearMarkerKey,
    newValue: '1',
  });
  await waitFor(() => request.signal.aborted, 'delayed marker-set storage event');
  assert.equal(request.aborted, true);
  assertOutcome(await recordPromise, 'cancelled', '');
}

async function testPersistentMarkerGuardsOperationsWithoutBroadcastChannel() {
  const sharedStorage = createMemoryStorage();
  const sharedCookieJar = createCookieJar();
  sharedStorage.setFailure('write');
  const peer = createLiveClientRuntime({
    storage: sharedStorage,
    cookieJar: sharedCookieJar,
    BroadcastChannel: undefined,
  });
  const physicalClear = createDeferred();
  const origin = createEvidencePageRuntime({
    storage: sharedStorage,
    cookieJar: sharedCookieJar,
    BroadcastChannel: undefined,
    clearState: {
      run() { return physicalClear.promise; },
    },
  });
  await peer.loader.configureIdentity(
    { id: 17, role: 'student' },
    peer.context.__learningEvidenceFreshAuthority,
  );
  assert.ok(peer.timeouts.size > 0);

  const clearPromise = origin.context.AstraLearningEvidenceLoader.clearAuthority('explicit-authentication');
  await waitFor(
    () => sharedCookieJar.entries().some(([key]) => key === authorityClearCookieKey),
    'fallback marker without BroadcastChannel',
  );
  assert.equal(peer.context.__liveSuspendCalls || 0, 0, 'no channel means no proactive peer callback');
  await assert.rejects(
    peer.client.record(eventPayload('guarded_operation', 4)),
    (error) => error && error.code === 'identity_required',
    'operation guard must read the durable marker before a new write',
  );
  assert.equal(peer.metrics.apiCalls.length, 0, 'guarded record must not reach the API');
  assert.equal(peer.timeouts.size, 0, 'operation guard must synchronously cancel scheduled flush work');
  assertOutcome(await peer.client.flush(), 'skipped');

  physicalClear.resolve();
  await clearPromise;
}

async function testAuthorityEventsAbortOnlineRecordWrites() {
  for (const eventType of ['astra:api-auth-required', 'astra:session-signed-out']) {
    const runtime = createLiveClientRuntime({
      storage: createMemoryStorage(),
      cookieJar: createCookieJar(),
      BroadcastChannel: undefined,
    });
    await runtime.loader.configureIdentity(
      { id: 17, role: 'student' },
      runtime.context.__learningEvidenceFreshAuthority,
    );
    const payload = eventPayload('authority_event', eventType);
    payload.client_event_id = eventType === 'astra:api-auth-required'
      ? 'event-online-unauthorized-0001'
      : 'event-online-signed-out-0001';
    const recordPromise = runtime.client.record(payload);
    await waitFor(() => runtime.metrics.writeRequests.length === 1, `${eventType} online write`);
    const request = runtime.metrics.writeRequests[0];
    assert.ok(request.signal && !request.signal.aborted);

    runtime.context.dispatchEvent({ type: eventType });
    await waitFor(() => request.signal.aborted, `${eventType} authority abort`);
    assert.equal(request.aborted, true, `${eventType} must stop the transport before it can commit`);
    assertOutcome(await recordPromise, 'cancelled', '');
    await assert.rejects(
      runtime.client.record(eventPayload('after_authority_event', 5)),
      (error) => error && error.code === 'identity_required',
    );
    await waitFor(
      () => runtime.context.localStorage.getItem(authorityClearMarkerKey) === null,
      `${eventType} physical clear completion`,
    );
  }
}

async function testLeaseAcquiredAfterSuspendIsReleased() {
  const lease = createDeferred();
  let acquireCalls = 0;
  const runtime = createLiveClientRuntime({
    storage: createMemoryStorage(),
    cookieJar: createCookieJar(),
    BroadcastChannel: undefined,
    acquireLease() {
      acquireCalls += 1;
      return lease.promise;
    },
  });
  await runtime.loader.configureIdentity(
    { id: 17, role: 'student' },
    runtime.context.__learningEvidenceFreshAuthority,
  );
  const flushPromise = runtime.client.flush();
  await waitFor(() => acquireCalls === 1, 'delayed lease acquisition');

  runtime.client.suspendAuthority();
  await Promise.resolve();
  const releasesBeforeLease = runtime.metrics.releaseLeaseCalls;
  lease.resolve(true);
  assertOutcome(await flushPromise, 'cancelled', '');
  assert.ok(
    runtime.metrics.releaseLeaseCalls > releasesBeforeLease,
    'a lease obtained after authority invalidation must still be released',
  );
}

async function testExplicitAuthenticationClearsBeforeCreatingSession() {
  const sharedStorage = createMemoryStorage();
  const sharedCookieJar = createCookieJar();
  sharedStorage.setFailure('write');
  sharedCookieJar.setFailure('write');
  const server = {
    session: false,
    loginCalls: 0,
    registerCalls: 0,
    meCalls: 0,
  };
  const firstPage = createEvidencePageRuntime({
    storage: sharedStorage,
    cookieJar: sharedCookieJar,
    clearState: { fail: false },
  });
  const firstApp = installAppSessionHarness(firstPage, server);
  await firstApp.submitLogin(authForm({
    username: 'authority-test-student',
    password: 'secret',
  }));
  assert.equal(server.loginCalls, 0, 'dual marker failure must prevent the login POST');
  assert.equal(server.session, false, 'no new server session may exist after marker failure');
  assert.equal(firstPage.metrics.clearCalls, 0, 'physical clear cannot run before a durable marker exists');
  assert.equal(firstPage.metrics.configureCalls, 0);
  assert.equal(firstApp.state.status.code, 'learning_evidence_clear_failed');

  await firstApp.submitRegister(authForm({
    username: 'authority-test-student',
    display_name: 'Authority Test',
    password: 'secret',
    password_confirm: 'secret',
    role: 'student',
  }));
  assert.equal(server.registerCalls, 0, 'registration must also stop before mutating server auth state');
  assert.equal(server.loginCalls, 0);

  sharedStorage.setFailure('write', false);
  sharedCookieJar.setFailure('write', false);
  const secondPage = createEvidencePageRuntime({
    storage: sharedStorage,
    cookieJar: sharedCookieJar,
    clearState: { fail: false },
  });
  const secondApp = installAppSessionHarness(secondPage, server);
  secondPage.context.AstraApplicationSession.bootstrap();
  await waitFor(() => server.meCalls === 1, 'reloaded page session check');
  assert.equal(server.session, false, 'storage recovery must not invent a server session');
  assert.equal(secondPage.metrics.configureCalls, 0, 'reload without a created session must not configure evidence');
  assert.equal(secondApp.state.user, null);

  const successfulServer = {
    session: false,
    loginCalls: 0,
    registerCalls: 0,
    meCalls: 0,
  };
  const successfulPage = createEvidencePageRuntime({
    storage: createMemoryStorage(),
    cookieJar: createCookieJar(),
    clearState: { fail: false },
  });
  const successfulApp = installAppSessionHarness(successfulPage, successfulServer);
  await successfulApp.submitLogin(authForm({
    username: 'authority-test-student',
    password: 'secret',
  }));
  await waitFor(() => successfulPage.metrics.configureCalls === 1, 'successful login evidence configure');
  assert.equal(successfulPage.metrics.clearCalls, 1, 'successful explicit login must clear exactly once');
  assert.equal(successfulServer.loginCalls, 1);
  assert.equal(successfulServer.meCalls, 1);
  assert.equal(successfulApp.state.user.id, 17);

  const registerServer = {
    session: false,
    loginCalls: 0,
    registerCalls: 0,
    meCalls: 0,
  };
  const registerPage = createEvidencePageRuntime({
    storage: createMemoryStorage(),
    cookieJar: createCookieJar(),
    clearState: { fail: false },
  });
  const registerApp = installAppSessionHarness(registerPage, registerServer);
  await registerApp.submitRegister(authForm({
    username: 'authority-test-student',
    display_name: 'Authority Test',
    password: 'secret',
    password_confirm: 'secret',
    role: 'student',
  }));
  await waitFor(() => registerPage.metrics.configureCalls === 1, 'successful register-login evidence configure');
  assert.equal(registerPage.metrics.clearCalls, 1, 'successful register-login must clear exactly once');
  assert.equal(registerServer.registerCalls, 1);
  assert.equal(registerServer.loginCalls, 1);
}

async function testCodeSpaceAuthorityClearFailureIsTerminal() {
  const runtime = createEvidencePageRuntime({
    storage: createMemoryStorage(),
    cookieJar: createCookieJar(),
    clearState: { fail: true },
  });
  const controls = new FakeElement('div');
  const select = new FakeElement('select');
  const status = new FakeElement('span');
  runtime.document.getElementById = (id) => ({
    'cv-class-context': controls,
    'cv-class-select': select,
    'cv-class-status': status,
  }[id] || null);
  runtime.document.currentScript = {
    src: 'https://astra.test/codevis/shared/js/student-context.js',
  };
  runtime.context.AstraApiClient = {
    async request(pathname) {
      runtime.metrics.apiCalls.push(pathname);
      if (pathname === '/api/users/me') return { id: 17, role: 'student' };
      if (pathname === '/api/classes') {
        return [
          { id: 31, name: 'Class A' },
          { id: 32, name: 'Class B' },
        ];
      }
      if (pathname === '/api/courses') {
        const error = new Error('unauthorized');
        error.status = 401;
        throw error;
      }
      throw new Error(`unexpected Code Space request: ${pathname}`);
    },
  };
  vm.runInContext(codeSpaceStudentContextSource, runtime.context, {
    filename: 'codevis/shared/js/student-context.js',
  });

  assert.equal(await runtime.context.CvStudentContext.start(), true);
  assert.equal(runtime.context.CvStudentContext.getState().phase, 'selecting_class');
  assert.equal(await runtime.context.CvStudentContext.selectClass(31), false);
  assert.equal(runtime.context.CvStudentContext.getState().phase, 'authority_clear_failed');
  assert.equal(runtime.context.CvStudentContext.gate().blocked, true);
  assert.equal(controls.hidden, true, 'fatal authority state must hide the multi-class selector');
  assert.equal(select.disabled, true, 'fatal authority state must disable stale selector controls');
  assert.equal(select.onchange, null, 'fatal authority state must detach selector actions');
  const requestCountAfterFailure = runtime.metrics.apiCalls.length;

  assert.equal(await runtime.context.CvStudentContext.selectClass(32), false);
  assert.equal(runtime.metrics.apiCalls.length, requestCountAfterFailure, 'second selection must not reach the backend');
  assert.equal(runtime.context.CvStudentContext.getState().phase, 'authority_clear_failed');
  assert.equal(runtime.context.CvStudentContext.gate().blocked, true);
  assert.equal(
    runtime.context.AstraCodeSpaceStudentContext.resolveLearningEvidence({
      galaxy_key: 'code-space',
      course_key: 'control-flow',
      activity_key: 'control-flow.loop-boundary',
    }).available,
    false,
    'route/action evidence context must remain unavailable after fatal clear failure',
  );
}

async function testPersistentClearMarkerAcrossCodeSpaceAndRootContexts() {
  const sharedStorage = createMemoryStorage();
  const sharedCookieJar = createCookieJar();
  sharedStorage.setFailure('write');
  const codeSpaceClear = { fail: true };
  const codeSpacePage = createEvidencePageRuntime({
    storage: sharedStorage,
    cookieJar: sharedCookieJar,
    clearState: codeSpaceClear,
  });

  await assert.rejects(
    codeSpacePage.context.AstraLearningEvidenceLoader.clearAuthority('explicit-authentication'),
    (error) => error && error.code === 'indexeddb_transaction_failed',
    'the first page must persist the marker before its explicit-auth clear fails',
  );
  assert.equal(codeSpacePage.metrics.clearCalls, 1, 'the verified cookie fallback may precede the physical clear');
  assert.deepEqual(
    sharedStorage.entries(),
    [],
    'the first context models a transient localStorage marker write failure',
  );
  assert.equal(
    sharedCookieJar.entries().find(([key]) => key === authorityClearCookieKey)[1],
    '1',
    'the durable fallback must contain the fixed boolean marker',
  );
  assert.ok(
    sharedCookieJar.entries().some(([key, value]) => key === authorityClearEpochCookieKey && value),
    'the durable fallback must also retain a non-sensitive clear epoch',
  );

  codeSpacePage.document.currentScript = {
    src: 'https://astra.test/codevis/shared/js/student-context.js',
  };
  codeSpacePage.context.AstraApiClient = {
    async request(pathname) {
      codeSpacePage.metrics.apiCalls.push(pathname);
      const error = new Error('unauthorized');
      error.status = 401;
      throw error;
    },
  };
  vm.runInContext(codeSpaceStudentContextSource, codeSpacePage.context, {
    filename: 'codevis/shared/js/student-context.js',
  });
  assert.equal(await codeSpacePage.context.CvStudentContext.start(), false);
  assert.equal(codeSpacePage.context.CvStudentContext.getState().phase, 'authority_clear_failed');
  assert.equal(codeSpacePage.context.CvStudentContext.gate().blocked, true);
  assert.equal(codeSpacePage.metrics.redirects.length, 0, 'Code Space must not redirect after authority clear fails');
  assert.deepEqual(
    codeSpacePage.metrics.clearReasons,
    ['explicit-authentication', 'unauthorized'],
    'Code Space 401 must retry the shared physical-clear owner before any navigation',
  );
  assert.ok(
    sharedCookieJar.entries().some(([key, value]) => key === authorityClearCookieKey && value === '1'),
    'Code Space 401 failure must leave the fallback marker set for the next page',
  );

  sharedStorage.setFailure('write', false);
  const rootClear = { fail: true };
  const rootPage = createEvidencePageRuntime({
    storage: sharedStorage,
    cookieJar: sharedCookieJar,
    clearState: rootClear,
  });
  assert.ok(rootPage.metrics.suspendCalls >= 1, 'the second page must detect the fallback marker during loader startup');
  const appInstrumented = appSessionSource.replace(
    'global.AstraApplicationSession = Object.freeze({',
    'global.__applicationSessionTest = Object.freeze({ state, retryLearningAuthorityClear, completeAuthentication });\n    global.AstraApplicationSession = Object.freeze({',
  );
  assert.notEqual(appInstrumented, appSessionSource, 'app session instrumentation must apply');
  rootPage.document.currentScript = { src: 'https://astra.test/shared/js/app-session.js' };
  rootPage.context.AstraPageRegistry = {
    resourcesForRole() { return []; },
    allRoleResources() { return []; },
    stylesForRole() { return []; },
  };
  rootPage.context.AstraApiClient = {
    normalizeBaseUrl() { return ''; },
    message(error) { return error && error.message || 'error'; },
    async request(pathname) {
      rootPage.metrics.apiCalls.push(pathname);
      if (pathname === '/api/users/me') {
        return { id: 17, role: 'student', username: 'shared-cookie-student' };
      }
      return {};
    },
  };
  vm.runInContext(appInstrumented, rootPage.context, { filename: 'app-session.js' });

  const bootPromise = rootPage.context.AstraApplicationSession.bootstrap();
  await waitFor(
    () => rootPage.context.__applicationSessionTest.state.status
      && rootPage.context.__applicationSessionTest.state.status.code === 'learning_evidence_clear_failed',
    'root portal persistent-clear failure',
  );
  assert.deepEqual(rootPage.metrics.apiCalls, ['/api/users/me'], 'the same server cookie may still restore /me');
  assert.equal(rootPage.metrics.configureCalls, 0, 'a successful /me response must not configure identity while the marker is set');
  assert.equal(rootPage.context.__applicationSessionTest.state.user, null, 'the root portal must remain locked');
  assert.equal(rootPage.metrics.reloads, 0, 'persistent clear failure must not reload the root page');
  assert.equal(sharedStorage.getItem(authorityClearMarkerKey), '1');
  assert.ok(sharedStorage.getItem(authorityClearEpochKey));
  assert.ok(sharedCookieJar.entries().some(([key, value]) => key === authorityClearCookieKey && value === '1'));
  assert.ok(sharedCookieJar.entries().some(([key, value]) => key === authorityClearEpochCookieKey && value));

  rootClear.fail = false;
  assert.equal(
    await rootPage.context.__applicationSessionTest.retryLearningAuthorityClear(),
    true,
    'the visible retry may unlock only after physical clear succeeds',
  );
  assert.equal(await bootPromise, true);
  await waitFor(() => rootPage.metrics.configureCalls === 1, 'identity configure after persistent clear retry');
  assert.equal(sharedStorage.getItem(authorityClearMarkerKey), null, 'successful retry must remove the shared transient marker');
  assert.ok(sharedStorage.getItem(authorityClearEpochKey), 'successful retry must retain the shared clear epoch');
  assert.equal(
    sharedCookieJar.entries().some(([key]) => key === authorityClearCookieKey),
    false,
    'successful retry must remove the fallback marker',
  );
  assert.ok(
    sharedCookieJar.entries().some(([key, value]) => key === authorityClearEpochCookieKey && value),
    'successful retry must retain the fallback clear epoch',
  );
  assert.equal(rootPage.metrics.reloads, 0);
}

async function testAppSessionNoReloadUntilClearRetry() {
  let clearShouldFail = true;
  let reloads = 0;
  const body = new FakeElement('body');
  const document = {
    baseURI: 'https://astra.test/',
    currentScript: { src: 'https://astra.test/shared/js/app-session.js' },
    scripts: [],
    body,
    head: new FakeElement('head'),
    documentElement: new FakeElement('html'),
    createElement(tagName) { return new FakeElement(tagName); },
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const instrumented = appSessionSource.replace(
    'global.AstraApplicationSession = Object.freeze({',
    'global.__applicationSessionTest = Object.freeze({ state, handleSignedOut, retryLearningAuthorityClear });\n    global.AstraApplicationSession = Object.freeze({',
  );
  assert.notEqual(instrumented, appSessionSource, 'app session instrumentation must apply');
  const context = {
    console: { warn() {} },
    URL,
    URLSearchParams,
    document,
    Element: FakeElement,
    HTMLFormElement: FakeElement,
    FormData: class {},
    CustomEvent: class {
      constructor(type, options) {
        this.type = type;
        this.detail = options && options.detail;
      }
    },
    location: {
      href: 'https://astra.test/',
      search: '',
      reload() { reloads += 1; },
    },
    AstraLearningEvidenceLoader: {
      async clearAuthority() {
        if (clearShouldFail) {
          const error = new Error('clear rejected');
          error.code = 'indexeddb_transaction_failed';
          throw error;
        }
      },
    },
    AstraPageRegistry: {
      resourcesForRole() { return []; },
      allRoleResources() { return []; },
      stylesForRole() { return []; },
    },
    AstraApiClient: {
      normalizeBaseUrl() { return ''; },
      message(error) { return error && error.message || 'error'; },
      async request() { return {}; },
    },
    addEventListener() {},
    dispatchEvent() {},
    setTimeout,
    clearTimeout,
    window: null,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(instrumented, context, { filename: 'app-session.js' });

  const first = await context.__applicationSessionTest.handleSignedOut();
  assert.equal(first, false);
  assert.equal(reloads, 0, 'clear rejection must not reload');
  assert.equal(context.__applicationSessionTest.state.status.code, 'learning_evidence_clear_failed');
  assert.match(context.__applicationSessionTest.state.overlay.innerHTML, /data-learning-authority-retry/);

  clearShouldFail = false;
  const retried = await context.__applicationSessionTest.retryLearningAuthorityClear();
  assert.equal(retried, true);
  assert.equal(reloads, 1, 'reload is allowed only after the retry physically clears authority data');
}

function createRoleHomeHarness(identityInitiallyReady) {
  let identityReady = identityInitiallyReady;
  let recoveryCalls = 0;
  let evidenceListener = null;
  let host = null;
  const main = new FakeElement('main');
  main.prepend = (node) => {
    host = node;
    FakeElement.prototype.prepend.call(main, node);
  };
  const rootElement = new FakeElement('section');
  rootElement.querySelector = (selector) => selector === '.planets-main' ? main : null;
  const document = {
    createElement(tagName) { return new FakeElement(tagName); },
    getElementById() { return null; },
  };
  const evidenceClient = {
    subscribe(listener) {
      evidenceListener = listener;
      return () => { evidenceListener = null; };
    },
    async recovery() {
      recoveryCalls += 1;
      if (!identityReady) {
        const error = new Error('identity required');
        error.code = 'identity_required';
        throw error;
      }
      return { subject_user_id: 17, class_id: 7, course_id: 701, rule_version: 2, resume: null, activities: [] };
    },
    async pendingSummary() { return { count: 0, bytes: 0, oldest_at: null }; },
    normalizeError(error) { return error; },
  };
  const context = {
    console,
    document,
    Element: FakeElement,
    AbortController,
    setTimeout,
    clearTimeout,
    AstraApiClient: {
      isCancelled() { return false; },
      async request(pathname) {
        if (pathname === '/api/classes') return [{ id: 7, name: '一班' }];
        if (pathname === '/api/courses') {
          return [{ id: 701, title: '力学课程', galaxy_key: 'englab', course_key: 'physics' }];
        }
        if (pathname === '/api/assignments/me') return [];
        if (pathname === '/api/courses/701/units') {
          return [{
            id: 7011,
            title: '力学实验',
            activity_key: 'physics.mechanics',
            effective_release_state: 'open',
            status: 'active',
            position: 1,
          }];
        }
        throw new Error(`unexpected role-home route ${pathname}`);
      },
    },
    AstraLearningEvidenceClient: evidenceClient,
    AstraLearningActivityCatalog: {
      resolve(galaxyKey, activityKey) {
        if (galaxyKey === 'englab' && activityKey === 'physics.mechanics') {
          return { galaxy_key: galaxyKey, course_key: 'physics', activity_key: activityKey };
        }
        return null;
      },
      recoveryHref() { return '#physics/mechanics'; },
    },
    window: null,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(roleHomeSource, context, { filename: 'role-home-client.js' });
  return {
    context,
    rootElement,
    get host() { return host; },
    setIdentityReady(value) { identityReady = value; },
    emit(change) { evidenceListener(change); },
    recoveryCalls() { return recoveryCalls; },
  };
}

async function testRoleHomeIdentityRaceAndPlaceholder() {
  const mountedBeforeIdentity = createRoleHomeHarness(false);
  assert.equal(
    mountedBeforeIdentity.context.AstraRoleHomeClient.mount(
      mountedBeforeIdentity.rootElement,
      { id: 17, role: 'student' },
    ),
    true,
  );
  await waitFor(
    () => mountedBeforeIdentity.recoveryCalls() === 1
      && mountedBeforeIdentity.context.AstraRoleHomeClient.snapshot().phase !== 'loading',
    'role-home pre-identity failure',
  );
  mountedBeforeIdentity.setIdentityReady(true);
  mountedBeforeIdentity.emit({ type: 'identity-configured' });
  await waitFor(
    () => mountedBeforeIdentity.recoveryCalls() === 2
      && mountedBeforeIdentity.context.AstraRoleHomeClient.snapshot().phase === 'ready',
    'role-home reload after identity configuration',
  );
  assert.match(mountedBeforeIdentity.host.innerHTML, /<option value="" disabled>/);

  const mountedAfterIdentity = createRoleHomeHarness(true);
  mountedAfterIdentity.context.AstraRoleHomeClient.mount(
    mountedAfterIdentity.rootElement,
    { id: 17, role: 'student' },
  );
  await waitFor(
    () => mountedAfterIdentity.recoveryCalls() === 1
      && mountedAfterIdentity.context.AstraRoleHomeClient.snapshot().phase === 'ready',
    'role-home initial load after identity configuration',
  );
  assert.equal(mountedAfterIdentity.recoveryCalls(), 1);
}

async function testStudentOwnerExplicitRefresh() {
  let recoveryCalls = 0;
  const scheduled = [];
  const classSelect = new FakeElement('select');
  classSelect.value = '7';
  const courseSelect = new FakeElement('select');
  courseSelect.value = '701';
  const progress = new FakeElement('section');
  const knowledge = new FakeElement('section');
  const rootElement = new FakeElement('section');
  rootElement.querySelector = (selector) => ({
    '[data-student-scope="classId"]': classSelect,
    '[data-student-scope="courseId"]': courseSelect,
    '[data-student-panel="progress"]': progress,
    '[data-student-panel="knowledge"]': knowledge,
  }[selector] || null);
  const context = {
    console,
    Element: FakeElement,
    HTMLSelectElement: FakeElement,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    AbortController,
    setTimeout(callback) {
      scheduled.push(callback);
      return scheduled.length;
    },
    clearTimeout() {},
    addEventListener() {},
    removeEventListener() {},
    AstraLearningEvidenceClient: {
      subscribe() { return () => {}; },
      normalizeError(error) { return error; },
      async recovery() {
        recoveryCalls += 1;
        return { class_id: 7, course_id: 701, rule_version: 2, resume: null, activities: [] };
      },
      async pendingSummary() { return { count: 0, bytes: 0, oldest_at: null }; },
    },
    window: null,
  };
  context.window = context;
  vm.createContext(context);
  const instrumentedOwner = studentOwnerSource.replace(
    'global.AstraStudentLearningEvidence = Object.freeze({',
    'global.__studentOwnerRefreshTest = Object.freeze({ active: () => active, refresh });\n    global.AstraStudentLearningEvidence = Object.freeze({',
  );
  assert.notEqual(instrumentedOwner, studentOwnerSource, 'student owner instrumentation must apply');
  vm.runInContext(instrumentedOwner, context, { filename: 'student-learning-evidence.js' });
  assert.ok(context.AstraStudentLearningEvidence.mount(rootElement));
  assert.equal(scheduled.length, 1);
  const firstSession = context.__studentOwnerRefreshTest.active();
  await context.__studentOwnerRefreshTest.refresh(firstSession);
  assert.equal(recoveryCalls, 1, `initial owner render: ${progress.innerHTML}`);
  scheduled.length = 0;
  assert.equal(context.AstraStudentLearningEvidence.refresh(), true);
  assert.equal(scheduled.length, 1);
  await scheduled.shift()();
  assert.equal(recoveryCalls, 2);
  assert.match(studentPageSource, /AstraStudentLearningEvidence\.refresh\(\)/);
  context.AstraStudentLearningEvidence.destroy();
}

async function testPageOwnerResourceFailureFallbacks() {
  const instrumentedStudent = studentPageSource.replace(
    'window.initStudent = initStudent;',
    'window.__studentEvidenceResourceTest = Object.freeze({ state, mountStudentLearningEvidence });\n    window.initStudent = initStudent;',
  );
  assert.notEqual(instrumentedStudent, studentPageSource, 'student page instrumentation must apply');
  const studentProgress = new FakeElement('section');
  const studentKnowledge = new FakeElement('section');
  const studentRoot = new FakeElement('section');
  studentRoot.querySelector = (selector) => ({
    '[data-student-panel="progress"]': studentProgress,
    '[data-student-panel="knowledge"]': studentKnowledge,
  }[selector] || null);
  const studentContext = {
    console: { warn() {} },
    navigator: { onLine: true },
    Element: FakeElement,
    HTMLInputElement: FakeElement,
    HTMLSelectElement: FakeElement,
    HTMLFormElement: FakeElement,
    window: null,
  };
  studentContext.window = studentContext;
  vm.createContext(studentContext);
  vm.runInContext(instrumentedStudent, studentContext, { filename: 'student.js' });
  studentContext.__studentEvidenceResourceTest.state.active = true;
  studentContext.__studentEvidenceResourceTest.state.root = studentRoot;
  studentContext.AstraLearningEvidenceLoader = {
    async ensure() {
      const error = new Error('404');
      error.code = 'learning_evidence_resource_404';
      throw error;
    },
  };
  assert.equal(await studentContext.__studentEvidenceResourceTest.mountStudentLearningEvidence(), false);
  assert.equal(studentContext.__studentEvidenceResourceTest.state.learningEvidenceResourceError.code, 'learning_evidence_resource_404');
  assert.doesNotMatch(studentProgress.innerHTML, /learning_evidence_resource_404/);
  assert.match(studentProgress.innerHTML, /学习记录暂时无法载入/);
  assert.match(studentProgress.innerHTML, /data-student-evidence-resource-retry/);
  assert.match(studentKnowledge.innerHTML, /data-student-evidence-resource-retry/);
  let studentMounts = 0;
  studentContext.AstraLearningEvidenceLoader.ensure = async () => {};
  studentContext.AstraStudentLearningEvidence = {
    destroy() {},
    mount() { studentMounts += 1; },
  };
  assert.equal(await studentContext.__studentEvidenceResourceTest.mountStudentLearningEvidence(), true);
  assert.equal(studentMounts, 1);

  const instrumentedTeacher = teacherPageSource.replace(
    'window.initTeacher = initTeacher;',
    'window.__teacherEvidenceResourceTest = Object.freeze({ state, mountTeacherLearningEvidence });\n    window.initTeacher = initTeacher;',
  );
  assert.notEqual(instrumentedTeacher, teacherPageSource, 'teacher page instrumentation must apply');
  const teacherAggregate = new FakeElement('article');
  const teacherRoot = new FakeElement('section');
  teacherRoot.querySelectorAll = (selector) => (
    selector === '[data-teacher-natural-workflow]' ? [teacherAggregate] : []
  );
  const teacherContext = {
    console: { warn() {} },
    navigator: { onLine: true },
    Element: FakeElement,
    HTMLInputElement: FakeElement,
    HTMLSelectElement: FakeElement,
    HTMLFormElement: FakeElement,
    window: null,
  };
  teacherContext.window = teacherContext;
  vm.createContext(teacherContext);
  vm.runInContext(instrumentedTeacher, teacherContext, { filename: 'teacher.js' });
  teacherContext.__teacherEvidenceResourceTest.state.active = true;
  teacherContext.__teacherEvidenceResourceTest.state.root = teacherRoot;
  teacherContext.AstraLearningEvidenceLoader = {
    async ensure() {
      const error = new Error('timeout');
      error.code = 'learning_evidence_resource_timeout';
      throw error;
    },
  };
  assert.equal(await teacherContext.__teacherEvidenceResourceTest.mountTeacherLearningEvidence(), false);
  assert.equal(teacherContext.__teacherEvidenceResourceTest.state.learningEvidenceResourceError.code, 'learning_evidence_resource_timeout');
  assert.doesNotMatch(teacherAggregate.innerHTML, /learning_evidence_resource_timeout/);
  assert.match(teacherAggregate.innerHTML, /教学记录暂时无法载入/);
  assert.match(teacherAggregate.innerHTML, /data-teacher-evidence-resource-retry/);
  let teacherMounts = 0;
  teacherContext.AstraLearningEvidenceLoader.ensure = async () => {};
  teacherContext.AstraTeacherLearningEvidence = {
    destroy() {},
    mount() { teacherMounts += 1; },
  };
  assert.equal(await teacherContext.__teacherEvidenceResourceTest.mountTeacherLearningEvidence(), true);
  assert.equal(teacherMounts, 1);
}

async function testCodeChallengeScopeIsolationAndEvidenceRemount() {
  let currentScope = { class_id: 7, course_id: 702 };
  let clears = 0;
  let destroys = 0;
  const mountedContexts = [];
  const host = new FakeElement('section');
  const activity = {
    galaxy_key: 'code-space',
    course_key: 'control-flow',
    activity_key: 'control-flow.loop-boundary',
  };
  const instrumented = challengeSource.replace(
    'global.CvCourseChallenge = {',
    'global.__challengeScopeTest = Object.freeze({ challenge, scopeDescriptor, localStateFor, transitionScope, syncEvidence, recordEvidence });\n    global.CvCourseChallenge = {',
  );
  assert.notEqual(instrumented, challengeSource, 'challenge instrumentation must apply');
  const evidenceCommands = [];
  const context = {
    console: { warn() {} },
    document: {
      getElementById(id) { return id === 'cv-page-challenge' ? host : null; },
    },
    AstraCodeSpaceStudentContext: {
      resolve() {
        return {
          authenticated: true,
          role: 'student',
          class_id: currentScope.class_id,
          course_id: currentScope.course_id,
        };
      },
    },
    AstraLearningEvidenceLoader: {
      async ensure() {},
      clearDomainCommands() { clears += 1; },
    },
    AstraLearningEvidenceActivity: {
      destroyWithin() { destroys += 1; },
      mount() {
        mountedContexts.push(Object.assign({}, currentScope));
        return { destroy() {} };
      },
    },
    CvCourseSession: { activityKey: activity.activity_key },
    AbortController,
    CustomEvent: class {
      constructor(type, options) {
        this.type = type;
        this.detail = options && options.detail;
      }
    },
    dispatchEvent(event) {
      if (event && event.type === 'astra:learning-domain-command') evidenceCommands.push(event.detail);
    },
    window: null,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(instrumented, context, { filename: 'course-challenge.js' });
  const internals = context.__challengeScopeTest;
  const template = { starter_code: 'starter' };

  const scopeA = internals.scopeDescriptor(activity);
  internals.transitionScope(scopeA.key);
  internals.challenge.drafts[scopeA.key] = 'class-a-source';
  internals.challenge.predictions[scopeA.key] = 'class-a-prediction';
  internals.challenge.result[scopeA.key] = { steps: [{ stdout: ['A'] }] };
  internals.challenge.submissions[scopeA.key] = { ok: true, status: 'accepted' };
  internals.challenge.lastRunSources[scopeA.key] = 'class-a-source';
  internals.challenge.predictionRecorded[scopeA.key] = true;
  internals.challenge.repairingKey = scopeA.key;
  internals.recordEvidence(activity, scopeA, 'predicted', { prediction: { choice: 'prediction-recorded' } });
  internals.syncEvidence(activity, scopeA);
  await waitFor(() => mountedContexts.length === 1, 'class A evidence mount');

  currentScope = { class_id: 8, course_id: 802 };
  const scopeB = internals.scopeDescriptor(activity);
  internals.transitionScope(scopeB.key);
  internals.recordEvidence(activity, scopeA, 'attempted', { operation: 'browser_precheck' });
  internals.recordEvidence(activity, scopeB, 'predicted', { prediction: { choice: 'prediction-recorded' } });
  internals.recordEvidence(activity, scopeB, 'attempted', { operation: 'browser_precheck' });
  internals.recordEvidence(activity, scopeB, 'corrected', { correction: { kind: 'code-revision' } });
  internals.recordEvidence(activity, scopeB, 'attempted', { operation: 'formal_oj_submission' });
  const localB = internals.localStateFor(scopeB.key, template);
  assert.notEqual(scopeA.key, scopeB.key);
  assert.equal(localB.draft, 'starter');
  assert.equal(localB.prediction, '');
  assert.equal(localB.result, null);
  assert.equal(localB.submission, null);
  assert.equal(localB.repairing, false);
  assert.equal(internals.challenge.lastRunSources[scopeB.key], undefined);
  assert.equal(internals.challenge.predictionRecorded[scopeB.key], undefined);
  internals.syncEvidence(activity, scopeB);
  await waitFor(() => mountedContexts.length === 2, 'class B evidence remount');
  assert.deepEqual(mountedContexts, [
    { class_id: 7, course_id: 702 },
    { class_id: 8, course_id: 802 },
  ]);
  assert.deepEqual(
    evidenceCommands.map((command) => ({
      class_id: command.class_id,
      course_id: command.course_id,
      event_type: command.event_type,
      operation: command.evidence && command.evidence.operation || '',
    })),
    [
      { class_id: 7, course_id: 702, event_type: 'predicted', operation: '' },
      { class_id: 8, course_id: 802, event_type: 'predicted', operation: '' },
      { class_id: 8, course_id: 802, event_type: 'attempted', operation: 'browser_precheck' },
      { class_id: 8, course_id: 802, event_type: 'corrected', operation: '' },
      { class_id: 8, course_id: 802, event_type: 'attempted', operation: 'formal_oj_submission' },
    ],
    'stale class A commands must be rejected after the class B transition',
  );
  assert.ok(destroys >= 2, 'scope transition must destroy the old evidence consumer/controller');
  assert.ok(clears >= 2, 'scope transition must clear the old in-memory domain command buffer');
  assert.doesNotMatch(challengeSource, /challenge\.(?:drafts|predictions|submissions|lastRunSources|predictionRecorded)\[activity\.activity_key\]/);
  assert.match(challengeSource, /class_id:\s*descriptor\.class_id/);
  assert.match(challengeSource, /course_id:\s*descriptor\.course_id/);
}

function testTeacherPollingClaim() {
  assert.match(teacherOwnerSource, /const POLL_MS = 4000/);
  assert.match(teacherOwnerSource, /schedule\(session, POLL_MS\)/);
  assert.match(teacherOwnerSource, /if \(session\.dialog && session\.dialog\.open && !request\.force\) \{\s*schedule\(session, POLL_MS\);\s*return false;/);
  assert.doesNotMatch(capabilitiesSource, /不超过 5 秒刷新|≤\s*5\s*秒/);
  assert.match(capabilitiesSource, /约每 4 秒发起轮询，显示时延另含接口耗时/);
  assert.match(loaderSource, /code: 'learning_evidence_resource_load_failed'/);
  assert.match(loaderSource, /code: 'learning_evidence_resource_timeout'/);
}

(async () => {
  await testOfflineSensitiveKeysExecuteEnqueueValidator();
  await testLoaderClearFailureLatch();
  await testMarkerWriteFailureIsFailClosed();
  await testCookieFallbackBroadcastSuspendsLivePeer();
  await testDelayedBroadcastStillRevokesAfterMarkerRemoval();
  await testPageshowDetectsClearCompletedWhileChannelClosed();
  await testDelayedStorageEventRevokesAfterMarkerRemoval();
  await testPersistentMarkerGuardsOperationsWithoutBroadcastChannel();
  await testAuthorityEventsAbortOnlineRecordWrites();
  await testLeaseAcquiredAfterSuspendIsReleased();
  await testExplicitAuthenticationClearsBeforeCreatingSession();
  await testCodeSpaceAuthorityClearFailureIsTerminal();
  await testPersistentClearMarkerAcrossCodeSpaceAndRootContexts();
  await testAppSessionNoReloadUntilClearRetry();
  await testRoleHomeIdentityRaceAndPlaceholder();
  await testStudentOwnerExplicitRefresh();
  await testPageOwnerResourceFailureFallbacks();
  await testCodeChallengeScopeIsolationAndEvidenceRemount();
  testTeacherPollingClaim();
  process.stdout.write('learning-evidence-regression-contract: authority fencing, scope isolation, persistent clear latch, sensitive keys, resource fallback, refresh, and identity race ok\n');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
