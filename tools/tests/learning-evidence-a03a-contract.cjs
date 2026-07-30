const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const studentSource = read('pages/student/student.js');
const publicationSource = read('shared/js/engineering-lab-publication-context.js');
const experimentRegistrySource = read('shared/js/experiment-registry.js');
const moduleSelectorSource = read('shared/js/module-selector.js');
const routerSource = read('shared/js/router.js');
const physicsSource = read('pages/physics/physics.js');
const physicsZoomSource = read('pages/physics/physics-zoom.js');
const physicsCss = read('pages/physics/physics.css');
const fabCss = read('shared/css/fab-trigger.css');
const ratingCss = read('shared/css/experiment-rating.css');
const ratingSource = read('shared/js/experiment-rating.js');
const moduleSelectorCss = read('shared/css/module-selector.css');

const REGISTRY_UNAVAILABLE_WARNING =
  '[ModuleSelector] experiment registry unavailable; transition refused';
const REGISTRY_LOOKUP_WARNING =
  '[ModuleSelector] experiment registry lookup failed; transition refused';
const PUBLICATION_CLASSIFICATION_WARNING =
  '[ModuleSelector] publication classification failed; transition refused';
const UNKNOWN_MODULE_WARNING =
  '[ModuleSelector] refusing transition to unknown module';
const HOSTILE_MODULE_ID =
  'student-private-value_Bearer_sk_live_JWT_password_PRIVATE-KEY';
const SENSITIVE_ERROR_MESSAGE =
  'Bearer sk_live_SECRET student-private-value '
  + 'JWT eyJhbGciOi_SECRET publication-context password=hunter2 API key secret';
const SENSITIVE_ERROR_CODE =
  'api_key=secret -----BEGIN PRIVATE KEY----- '
  + 'function leakedSource(){return "student-private-value";}';

async function settlePromises(rounds = 16) {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

function createSensitiveDiagnosticError() {
  const error = new Error(SENSITIVE_ERROR_MESSAGE);
  error.code = SENSITIVE_ERROR_CODE;
  return error;
}

function createHostileSensitiveDiagnosticError(reads) {
  return Object.defineProperties({}, {
    message: {
      get() {
        reads.message += 1;
        return SENSITIVE_ERROR_MESSAGE;
      }
    },
    code: {
      get() {
        reads.code += 1;
        return SENSITIVE_ERROR_CODE;
      }
    }
  });
}

function assertFixedSafeWarning(warnings, expectedWarning, label) {
  assert.equal(warnings.length, 1, `${label}: exactly one warning is required`);
  assert.equal(warnings[0].length, 1, `${label}: warning must not carry dynamic parameters`);
  assert.equal(warnings[0][0], expectedWarning, `${label}: fixed warning summary`);
  const rendered = warnings[0].map(String).join(' ');
  for (const forbidden of [
    HOSTILE_MODULE_ID,
    SENSITIVE_ERROR_MESSAGE,
    SENSITIVE_ERROR_CODE,
    'Bearer',
    'JWT',
    'sk_live',
    'API key',
    'api_key',
    'PRIVATE KEY',
    'PRIVATE-KEY',
    'password',
    'student-private-value',
    'ordinary-unknown',
    'physics:ordinary-unknown',
    'physics.ordinary-unknown',
    'leakedSource'
  ]) {
    assert.equal(
      rendered.includes(forbidden),
      false,
      `${label}: warning must not expose ${forbidden}`
    );
  }
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

function createControlledTimers() {
  let nextId = 1;
  const tasks = new Map();
  return {
    tasks,
    setTimeout(callback, delay = 0) {
      const id = nextId++;
      tasks.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      tasks.delete(id);
    },
    async runNext() {
      const entry = tasks.entries().next().value;
      if (!entry) return false;
      const [id, task] = entry;
      tasks.delete(id);
      task.callback();
      await settlePromises();
      return true;
    },
    async drain(limit = 100) {
      let count = 0;
      while (count < limit && await this.runNext()) count += 1;
      assert.equal(tasks.size, 0, 'the Router/ModuleSelector timer harness must settle');
    }
  };
}

function createRouterPublicationHarness(options = {}) {
  class FakeClassList {
    constructor(...names) { this.values = new Set(names); }
    add(...names) { names.forEach((name) => this.values.add(name)); }
    remove(...names) { names.forEach((name) => this.values.delete(name)); }
    contains(name) { return this.values.has(name); }
    toggle(name, force) {
      const enabled = force === undefined ? !this.contains(name) : Boolean(force);
      if (enabled) this.add(name); else this.remove(name);
      return enabled;
    }
  }

  const timers = createControlledTimers();
  const warnings = [];
  const errors = [];
  const historyChanges = [];
  const apiCalls = [];
  const selectors = [];
  const gateStates = [];
  const events = new Map();
  let ownerInitializations = 0;
  const routePage = options.page || 'physics';
  const moduleIds = options.domModules || (
    routePage === 'physics' ? ['mechanics', 'gas-laws'] : ['periodic-table']
  );
  const sections = new Map(moduleIds.map((moduleId) => [moduleId, {
    dataset: { module: moduleId },
    classList: new FakeClassList(),
    isConnected: true,
    querySelector() { return null; }
  }]));
  const page = {
    id: `page-${routePage}`,
    isConnected: true,
    classList: new FakeClassList('page', 'active'),
    querySelectorAll(selector) {
      selectors.push(selector);
      const exact = selector.match(/^\[data-module="([^"]+)"\](?:\.module-active)?$/);
      if (exact) {
        const section = sections.get(exact[1]);
        if (!section) return [];
        if (selector.endsWith('.module-active') && !section.classList.contains('module-active')) return [];
        return [section];
      }
      if (selector === '[data-module]') return [...sections.values()];
      if (selector === '[data-module].module-active') {
        return [...sections.values()].filter((section) => section.classList.contains('module-active'));
      }
      if (selector === '.related-experiments') return [];
      return [];
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
  };
  const gallery = { style: { display: '' } };
  const toggle = { style: {}, classList: new FakeClassList() };
  const backdrop = { classList: new FakeClassList() };
  const moduleId = options.moduleId || 'hidden-qa-v7718';
  const studentUser = Object.prototype.hasOwnProperty.call(options, 'user')
    ? options.user
    : { id: 7, role: 'student' };
  const request = options.request || ((route, requestOptions = {}) => {
    if (route === '/api/classes') return Promise.resolve([{ id: 42, name: 'B 班' }]);
    if (route === '/api/courses') {
      return Promise.resolve([{ id: 92, galaxy_key: 'englab', course_key: 'physics' }]);
    }
    if (route === '/api/courses/92/units') {
      let units;
      if (Object.prototype.hasOwnProperty.call(options, 'units')) {
        units = options.units;
      } else if (options.releaseState === 'open' || options.releaseState === 'locked') {
        units = [{
          id: 103,
          activity_key: `physics.${moduleId}`,
          effective_release_state: options.releaseState
        }];
      } else {
        units = [];
      }
      if (!units.some(unit => unit.activity_key === 'physics.gas-laws')) {
        units = [...units, {
          id: 104,
          activity_key: 'physics.gas-laws',
          effective_release_state: 'open'
        }];
      }
      return Promise.resolve(units);
    }
    if (route === '/api/courses/92/unit-access') {
      assert.equal(requestOptions.params.class_id, 42);
      assert.equal(requestOptions.params.activity_key, `physics.${moduleId}`);
      if (Object.prototype.hasOwnProperty.call(options, 'unitAccess')) {
        if (typeof options.unitAccess === 'function') {
          return options.unitAccess(route, requestOptions);
        }
        return Promise.resolve(options.unitAccess);
      }
      if (options.releaseState === 'locked') {
        return Promise.resolve({ available: false, error_code: 'activity_locked' });
      }
      if (options.releaseState === 'open') {
        return Promise.resolve({ available: true, error_code: null });
      }
      if (options.releaseState === 'missing') {
        return Promise.resolve({ available: false, error_code: 'course_unit_missing' });
      }
      return Promise.resolve({ available: false, error_code: 'activity_hidden' });
    }
    throw new Error(`unexpected publication request: ${route}`);
  });
  const windowObject = {
    innerWidth: 1015,
    location: { hash: options.initialHash || `#${routePage}/${moduleId}` },
    scrollTo() {},
    dispatchEvent() {},
    addEventListener(type, handler) {
      if (!events.has(type)) events.set(type, new Set());
      events.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      events.get(type)?.delete(handler);
    },
    AstraApplicationSession: {
      getUser: () => studentUser,
      guardPage: (routePage) => routePage
    },
    AstraPageRegistry: {
      pagesByTag: (tag) => tag === 'course' ? ['physics', 'chemistry'] : [],
      galaxyFor: (pageName) => ['physics', 'chemistry'].includes(pageName) ? 'englab' : 'astra'
    },
    AstraApiClient: {
      request(route, requestOptions = {}) {
        apiCalls.push({ route, options: requestOptions });
        return request(route, requestOptions);
      },
      isCancelled: (error) => Boolean(error && error.name === 'AbortError')
    }
  };
  if (options.loaderMode !== 'missing') {
    windowObject.AstraLearningEvidenceLoader = {
      ensure: options.loaderEnsure || (options.loaderMode === 'reject'
        ? () => Promise.reject(
          options.loaderError
          || Object.assign(new Error('loader unavailable'), { code: 'loader_unavailable' })
        )
        : () => Promise.resolve())
    };
  }
  const documentObject = {
    body: { appendChild() {} },
    scripts: [],
    activeElement: null,
    createElement() {
      return { className: '', style: {}, classList: new FakeClassList() };
    },
    getElementById(id) {
      if (id === `page-${routePage}`) return page;
      if (id === `gallery-${routePage}`) return gallery;
      if (id === `sidebar-toggle-${routePage}`) return toggle;
      if (id === 'module-sidebar-backdrop') return backdrop;
      return null;
    },
    querySelector(selector) {
      if (selector === '.page.active') return page.classList.contains('active') ? page : null;
      return null;
    },
    querySelectorAll() { return []; }
  };
  const consoleObject = {
    log() {},
    warn(...args) { warnings.push(args); },
    error(...args) { errors.push(args); }
  };
  const context = {
    window: windowObject,
    document: documentObject,
    history: {
      replaceState(_state, _title, hash) {
        windowObject.location.hash = hash;
        historyChanges.push(hash);
      },
      pushState(_state, _title, hash) {
        windowObject.location.hash = hash;
        historyChanges.push(hash);
      }
    },
    Event: class { constructor(type) { this.type = type; } },
    CONFIG: {
      experiments: {
        [routePage]: [...sections.keys()].map((id) => ({ id }))
      }
    },
    AbortController,
    setTimeout: (callback, delay) => timers.setTimeout(callback, delay),
    clearTimeout: (id) => timers.clearTimeout(id),
    setInterval: () => 1,
    clearInterval() {},
    console: consoleObject
  };
  vm.createContext(context);
  if (options.registryMode === 'healthy' || !options.registryMode) {
    vm.runInContext(experimentRegistrySource, context, {
      filename: 'shared/js/experiment-registry.js'
    });
  } else if (options.registryMode === 'getter-throws') {
    Object.defineProperty(windowObject, 'AstraExperimentRegistry', {
      configurable: true,
      enumerable: true,
      get() {
        throw options.registryError || new Error('registry property unavailable');
      }
    });
  } else if (options.registryMode === 'invalid-api') {
    windowObject.AstraExperimentRegistry = {};
  } else if (options.registryMode === 'throws') {
    windowObject.AstraExperimentRegistry = {
      get() { throw options.registryError || new Error('registry lookup failed'); }
    };
  }
  vm.runInContext(publicationSource, context, {
    filename: 'shared/js/engineering-lab-publication-context.js'
  });
  if (options.contextMode === 'missing') {
    delete windowObject.AstraEngineeringLabPublicationContext;
  }
  vm.runInContext(moduleSelectorSource, context, {
    filename: 'shared/js/module-selector.js'
  });
  vm.runInContext(routerSource, context, {
    filename: 'shared/js/router.js'
  });
  const selector = vm.runInContext('ModuleSelector', context);
  const router = vm.runInContext('Router', context);
  selector.activeModule[routePage] = null;
  selector._transitionGeneration[routePage] = 0;
  selector._transitionTimers[routePage] = [];
  selector._sidebars[routePage] = null;
  selector._sidebarOpen[routePage] = false;
  selector._renderPublicationGate = (pageName, _page, state, code = '') => {
    selector._publicationGateNodes[pageName] = { state, code };
    gateStates.push({ state, code });
  };
  selector._clearPublicationGate = (pageName) => {
    delete selector._publicationGateNodes[pageName];
  };
  selector._initModule = () => { ownerInitializations += 1; };
  selector._mountEvidenceRuntime = (_page, targetModuleId) => {
    if (targetModuleId === 'mechanics') ownerInitializations += 1;
  };
  selector._focusExperiment = () => {};
  selector._showRelatedExperiments = () => {};

  return {
    selector,
    router,
    timers,
    warnings,
    errors,
    apiCalls,
    gateStates,
    selectors,
    historyChanges,
    windowObject,
    page,
    routePage,
    sections,
    getOwnerInitializations: () => ownerInitializations,
    restoreProductionRegistry() {
      vm.runInContext(experimentRegistrySource, context, {
        filename: 'shared/js/experiment-registry.js'
      });
    },
    async ready() {
      await settlePromises(32);
    },
    async startRoute() {
      router.updateNav = () => {};
      router._toggleGalaxyFooters = () => {};
      router._syncGalaxyRuntime = () => {};
      router._toggleRunningTime = () => {};
      router._startHashReconcile = () => {};
      router.onPageEnter = (routePage) => router._applyPendingModule(routePage);
      router.init();
      assert.equal(router.currentPage, routePage, 'production Router.init must parse the cold-start page');
      assert.equal(
        router._pendingModule,
        moduleId,
        'production Router.init must retain the cold-start module until ModuleSelector answers'
      );
      assert.equal(await timers.runNext(), true, 'Router must schedule the production pending-module open');
      await settlePromises(32);
    }
  };
}

function createStudentClassDriver(publication) {
  const handlers = {};
  class FakeElement {}
  class FakeSelect extends FakeElement {
    constructor(value) {
      super();
      this.value = value;
      this.dataset = { studentScope: 'classId' };
    }
  }
  const rootElement = {
    addEventListener(type, handler) { handlers[type] = handler; },
    querySelector() { return null; },
    classList: { toggle() {} }
  };
  const studentApi = {
    request: async (route) => {
      if (route.startsWith('/api/assignments/me') || route.includes('/snapshots')) {
        return { items: [], total: 0, limit: 8, offset: 0, next_offset: null };
      }
      if (route === '/api/progress/me' || route === '/api/knowledge/me') return {};
      return [];
    },
    isCancelled: (error) => Boolean(error && error.name === 'AbortError'),
    isAmbiguousMutation: () => false
  };
  const instrumentedStudent = studentSource.replace(
    /module\.exports = \{\r?\n            state,/,
    'module.exports = {\n            state,\n            bindEvents,'
  );
  assert.notEqual(instrumentedStudent, studentSource, 'student production event owner must remain instrumentable');
  const windowObject = { AstraEngineeringLabPublicationContext: publication };
  const context = {
    window: windowObject,
    navigator: { onLine: true },
    module: { exports: {} },
    console,
    AbortController,
    URLSearchParams,
    Intl,
    AstraApiClient: studentApi,
    Element: FakeElement,
    HTMLSelectElement: FakeSelect,
    HTMLTextAreaElement: class extends FakeElement {},
    HTMLFormElement: class extends FakeElement {}
  };
  vm.createContext(context);
  vm.runInContext(instrumentedStudent, context, { filename: 'pages/student/student.js' });
  const exported = context.module.exports;
  exported.state.root = rootElement;
  exported.state.active = true;
  exported.state.authorized = true;
  exported.state.user = { id: 7, role: 'student' };
  exported.state.data.classes = [{ id: 41, name: 'A 班' }, { id: 42, name: 'B 班' }];
  exported.bindEvents();
  assert.equal(typeof handlers.change, 'function');
  return {
    state: exported.state,
    async changeClass(value) {
      handlers.change({ target: new FakeSelect(value) });
      await settlePromises();
    }
  };
}

function createPublicationModuleHarness(publication, options = {}) {
  const defaultModules = options.knownModules || ['mechanics'];
  const registryModules = new Set(options.registryModules || defaultModules);
  const domModules = new Set(options.domModules || defaultModules);
  class FakeClassList {
    constructor() { this.values = new Set(); }
    add(...names) { names.forEach((name) => this.values.add(name)); }
    remove(...names) { names.forEach((name) => this.values.delete(name)); }
    contains(name) { return this.values.has(name); }
    toggle(name, force) {
      if (force) this.add(name); else this.remove(name);
    }
  }
  const sections = new Map([...domModules].map((moduleId) => [moduleId, {
    dataset: { module: moduleId },
    classList: new FakeClassList(),
    isConnected: true,
    querySelector() { return null; }
  }]));
  const page = {
    classList: new FakeClassList(),
    isConnected: true,
    querySelectorAll(selector) {
      const target = selector.match(/^\[data-module="([^"]+)"\]$/);
      if (target && sections.has(target[1])) return [sections.get(target[1])];
      if (selector === '[data-module]') return [...sections.values()];
      if (selector === '[data-module].module-active') {
        return [...sections.values()].filter((section) => section.classList.contains('module-active'));
      }
      return [];
    }
  };
  const gallery = { style: { display: '' } };
  const toggle = { style: {}, classList: new FakeClassList() };
  const gateStates = [];
  const warnings = [];
  const errors = [];
  let ownerInitializations = 0;
  const windowObject = {
    innerWidth: 1015,
    location: { hash: options.initialHash || '#physics/mechanics' },
    scrollTo() {},
    dispatchEvent() {},
    AstraApplicationSession: {
      getUser: () => Object.prototype.hasOwnProperty.call(options, 'user')
        ? options.user
        : ({ id: 7, role: 'student' })
    },
    AstraEngineeringLabPublicationContext: publication,
    AstraLearningEvidenceLoader: {
      ensure: options.loaderEnsure || (() => Promise.resolve())
    },
    AstraExperimentRegistry: {
      get: (_page, moduleId) => registryModules.has(moduleId)
        ? ({ cleanup: { verified: true } })
        : null
    }
  };
  if (options.registryMode === 'missing') {
    delete windowObject.AstraExperimentRegistry;
  } else if (options.registryMode === 'invalid-api') {
    windowObject.AstraExperimentRegistry = {};
  } else if (options.registryMode === 'throws') {
    windowObject.AstraExperimentRegistry = {
      get() { throw options.registryError || new Error('registry lookup failed'); }
    };
  }
  const consoleObject = {
    ...console,
    warn(...args) { warnings.push(args); },
    error(...args) { errors.push(args); }
  };
  const context = {
    window: windowObject,
    document: {
      getElementById(id) {
        if (id === 'page-physics') return page;
        if (id === 'gallery-physics') return gallery;
        if (id === 'sidebar-toggle-physics') return toggle;
        return null;
      },
      querySelectorAll() { return []; },
      scripts: [],
      body: {}
    },
    history: {
      replaceState(_state, _title, hash) { windowObject.location.hash = hash; }
    },
    Event: class { constructor(type) { this.type = type; } },
    AbortController,
    CONFIG: { experiments: { physics: [{ id: 'mechanics' }] } },
    setTimeout,
    clearTimeout,
    console: consoleObject
  };
  vm.createContext(context);
  vm.runInContext(moduleSelectorSource, context, { filename: 'shared/js/module-selector.js' });
  const selector = vm.runInContext('ModuleSelector', context);
  selector.activeModule.physics = null;
  selector._transitionGeneration.physics = 0;
  selector._transitionTimers.physics = [];
  selector._sidebars.physics = null;
  selector._sidebarOpen.physics = false;
  selector._renderPublicationGate = (pageName, _page, state, code = '') => {
    selector._publicationGateNodes[pageName] = { state, code };
    gateStates.push({ state, code });
  };
  selector._clearPublicationGate = (pageName) => {
    delete selector._publicationGateNodes[pageName];
  };
  selector._initModule = () => { ownerInitializations += 1; };
  selector._mountEvidenceRuntime = () => { ownerInitializations += 1; };
  selector._focusExperiment = () => {};
  selector._showRelatedExperiments = () => {};
  return {
    selector,
    gateStates,
    warnings,
    errors,
    windowObject,
    getOwnerInitializations: () => ownerInitializations
  };
}

async function runPublicationUnknownModuleDiagnosticContract() {
  for (const registryMode of ['missing', 'invalid-api', 'throws']) {
    let authorityResolutions = 0;
    const brokenRegistry = createPublicationModuleHarness({
      async resolve() {
        authorityResolutions += 1;
        return { available: false, error_code: 'activity_hidden' };
      }
    }, {
      initialHash: '#physics/hidden-qa-v7718',
      registryMode
    });
    assert.equal(
      brokenRegistry.selector.openModule('physics', 'hidden-qa-v7718'),
      false,
      `${registryMode} registry infrastructure must fail closed synchronously`
    );
    await settlePromises();
    assert.equal(authorityResolutions, 0, `${registryMode} registry must not enter authority resolution`);
    assert.equal(brokenRegistry.getOwnerInitializations(), 0);
    assert.equal(brokenRegistry.warnings.length, 1, `${registryMode} registry must emit one clear diagnostic`);
    assert.deepEqual(brokenRegistry.errors, []);
  }

  const sensitiveRegistry = createPublicationModuleHarness({
    async resolve() {
      throw new Error('registry failure must never reach authority resolution');
    }
  }, {
    initialHash: '#physics/hidden-qa-v7718',
    registryMode: 'throws',
    registryError: createSensitiveDiagnosticError()
  });
  assert.equal(sensitiveRegistry.selector.openModule('physics', 'hidden-qa-v7718'), false);
  assertFixedSafeWarning(
    sensitiveRegistry.warnings,
    REGISTRY_LOOKUP_WARNING,
    'sensitive registry lookup failure'
  );

  const sensitivePublication = createPublicationModuleHarness({
    async resolve() {
      throw createSensitiveDiagnosticError();
    }
  }, {
    initialHash: '#physics/private-publication-error'
  });
  assert.equal(sensitivePublication.selector.openModule('physics', 'private-publication-error'), true);
  await settlePromises();
  assert.equal(sensitivePublication.windowObject.location.hash, '#physics');
  assertFixedSafeWarning(
    sensitivePublication.warnings,
    PUBLICATION_CLASSIFICATION_WARNING,
    'sensitive publication rejection'
  );

  let loaderRejectedAuthorityCalls = 0;
  const sensitiveLoader = createPublicationModuleHarness({
    async resolve() {
      loaderRejectedAuthorityCalls += 1;
      return { available: false, error_code: 'activity_hidden' };
    }
  }, {
    initialHash: '#physics/private-loader-error',
    loaderEnsure: () => Promise.reject(createSensitiveDiagnosticError())
  });
  assert.equal(sensitiveLoader.selector.openModule('physics', 'private-loader-error'), true);
  await settlePromises();
  assert.equal(loaderRejectedAuthorityCalls, 0);
  assert.equal(sensitiveLoader.windowObject.location.hash, '#physics');
  assertFixedSafeWarning(
    sensitiveLoader.warnings,
    PUBLICATION_CLASSIFICATION_WARNING,
    'sensitive loader rejection'
  );

  const hiddenResolutions = [];
  const hidden = createPublicationModuleHarness({
    async resolve(activity) {
      hiddenResolutions.push(activity);
      return { available: false, error_code: 'activity_hidden' };
    }
  }, {
    initialHash: '#physics/hidden-qa-v7718'
  });
  assert.equal(hidden.selector.openModule('physics', 'hidden-qa-v7718'), true);
  await settlePromises();
  assert.deepEqual(
    hiddenResolutions.map((activity) => ({
      galaxy_key: activity.galaxy_key,
      course_key: activity.course_key,
      activity_key: activity.activity_key
    })),
    [{
      galaxy_key: 'englab',
      course_key: 'physics',
      activity_key: 'physics.hidden-qa-v7718'
    }],
    'the real unknown deep link must be classified through the authoritative publication context'
  );
  assert.equal(hidden.windowObject.location.hash, '#physics');
  assert.equal(hidden.selector.activeModule.physics, null);
  assert.equal(hidden.getOwnerInitializations(), 0);
  assert.deepEqual(hidden.gateStates, []);
  assert.deepEqual(hidden.warnings, [], 'an authoritative hidden rejection is expected and must not warn');
  assert.deepEqual(hidden.errors, []);

  const backendLocked = createPublicationModuleHarness({
    async resolve() {
      return { available: false, error_code: 'activity_locked' };
    }
  }, {
    initialHash: '#physics/locked-only-unit'
  });
  assert.equal(backendLocked.selector.openModule('physics', 'locked-only-unit'), true);
  await settlePromises();
  assert.equal(backendLocked.windowObject.location.hash, '#physics');
  assert.equal(backendLocked.selector.activeModule.physics, null);
  assert.equal(backendLocked.getOwnerInitializations(), 0);
  assert.deepEqual(backendLocked.gateStates, []);
  assert.deepEqual(backendLocked.warnings, [], 'an authoritative backend-only locked rejection must not warn');
  assert.deepEqual(backendLocked.errors, []);

  const unknownResolutions = [];
  const unknown = createPublicationModuleHarness({
    async resolve(activity) {
      unknownResolutions.push(activity.activity_key);
      return { available: false, error_code: 'course_unit_missing' };
    }
  }, {
    initialHash: '#physics/ordinary-unknown'
  });
  assert.equal(unknown.selector.openModule('physics', 'ordinary-unknown'), true);
  await settlePromises();
  assert.deepEqual(unknownResolutions, ['physics.ordinary-unknown']);
  assert.equal(unknown.windowObject.location.hash, '#physics');
  assert.equal(unknown.getOwnerInitializations(), 0);
  assert.equal(unknown.warnings.length, 1, 'an ordinary unknown module must retain a diagnostic');
  assert.match(String(unknown.warnings[0][0]), /refusing transition to unknown module/);
  assert.deepEqual(unknown.errors, []);

  let hashMismatchResolutions = 0;
  const hashMismatch = createPublicationModuleHarness({
    async resolve() {
      hashMismatchResolutions += 1;
      return { available: false, error_code: 'activity_hidden' };
    }
  }, {
    initialHash: '#physics'
  });
  assert.equal(hashMismatch.selector.openModule('physics', 'programmatic-unknown'), false);
  assert.equal(hashMismatchResolutions, 0, 'a hash mismatch must not enter authority resolution');
  assert.equal(hashMismatch.getOwnerInitializations(), 0);
  assert.equal(hashMismatch.warnings.length, 1);
  assert.deepEqual(hashMismatch.errors, []);

  let teacherResolutions = 0;
  const nonStudent = createPublicationModuleHarness({
    async resolve() {
      teacherResolutions += 1;
      return { available: false, error_code: 'activity_hidden' };
    }
  }, {
    initialHash: '#physics/teacher-unknown',
    user: { id: 8, role: 'teacher' }
  });
  assert.equal(nonStudent.selector.openModule('physics', 'teacher-unknown'), false);
  assert.equal(teacherResolutions, 0, 'a non-student unknown module must not enter authority resolution');
  assert.equal(nonStudent.getOwnerInitializations(), 0);
  assert.equal(nonStudent.warnings.length, 1);
  assert.deepEqual(nonStudent.errors, []);

  let domOnlyResolutions = 0;
  const domOnly = createPublicationModuleHarness({
    async resolve() {
      domOnlyResolutions += 1;
      return { available: false, error_code: 'activity_hidden' };
    }
  }, {
    initialHash: '#physics/dom-only',
    registryModules: ['mechanics'],
    domModules: ['mechanics', 'dom-only']
  });
  assert.equal(domOnly.selector.openModule('physics', 'dom-only'), false);
  assert.equal(domOnlyResolutions, 0, 'DOM without registry ownership must not enter authority resolution');
  assert.equal(domOnly.getOwnerInitializations(), 0);
  assert.equal(domOnly.warnings.length, 1, 'DOM without registry ownership must retain a diagnostic');
  assert.deepEqual(domOnly.errors, []);

  const missingDom = createPublicationModuleHarness({
    async resolve() {
      throw new Error('known modules with missing DOM must not enter publication resolution');
    }
  }, {
    initialHash: '#physics/known-missing-dom',
    registryModules: ['mechanics', 'known-missing-dom'],
    domModules: ['mechanics']
  });
  assert.equal(missingDom.selector.openModule('physics', 'known-missing-dom'), false);
  assert.equal(missingDom.getOwnerInitializations(), 0);
  assert.equal(missingDom.warnings.length, 1);
  assert.match(String(missingDom.warnings[0][0]), /module DOM is unavailable/);
  assert.deepEqual(missingDom.errors, []);

  let malformedResolutionCalls = 0;
  const malformed = createPublicationModuleHarness({
    async resolve() {
      malformedResolutionCalls += 1;
      return { available: false, error_code: 'activity_hidden' };
    }
  }, {
    initialHash: '#physics/malformed/key'
  });
  assert.equal(malformed.selector.openModule('physics', 'malformed/key'), false);
  await settlePromises();
  assert.equal(malformedResolutionCalls, 0, 'a malformed key must not enter authority resolution');
  assert.equal(malformed.selector.activeModule.physics, null);
  assert.equal(malformed.getOwnerInitializations(), 0);
  assert.equal(malformed.warnings.length, 1, 'a malformed module key must retain a diagnostic');
  assert.deepEqual(malformed.errors, []);

  const locked = createPublicationModuleHarness({
    async resolve() {
      return { available: false, error_code: 'activity_locked' };
    }
  });
  assert.equal(locked.selector.openModule('physics', 'mechanics'), true);
  await settlePromises();
  assert.equal(
    locked.gateStates.some(item => item.state === 'locked'),
    false,
    'known locked Physics modules must normalize silently without exposing the lock state'
  );
  assert.equal(locked.windowObject.location.hash, '#physics');
  assert.equal(locked.selector._publicationGateNodes.physics, undefined);
  assert.equal(locked.selector.activeModule.physics, null);
  assert.equal(locked.getOwnerInitializations(), 0);
  assert.deepEqual(locked.warnings, []);
  assert.deepEqual(locked.errors, []);

  const mechanicsHidden = createPublicationModuleHarness({
    async resolve() {
      return { available: false, error_code: 'activity_hidden' };
    }
  });
  assert.equal(mechanicsHidden.selector.openModule('physics', 'mechanics'), true);
  await settlePromises();
  assert.equal(mechanicsHidden.windowObject.location.hash, '#physics');
  assert.equal(mechanicsHidden.selector.activeModule.physics, null);
  assert.equal(mechanicsHidden.getOwnerInitializations(), 0);
  assert.deepEqual(mechanicsHidden.warnings, []);
  assert.deepEqual(mechanicsHidden.errors, []);

  const open = createPublicationModuleHarness({
    async resolve() {
      return {
        available: true,
        class_id: 42,
        course_id: 9,
        course_unit_id: 91,
        activity_key: 'physics.mechanics'
      };
    }
  });
  assert.equal(open.selector.openModule('physics', 'mechanics'), true);
  await settlePromises();
  assert.equal(open.selector.activeModule.physics, 'mechanics');
  assert.equal(open.getOwnerInitializations(), 2);
  assert.deepEqual(open.warnings, []);
  assert.deepEqual(open.errors, []);

  let activeOwnerResolutions = 0;
  const activeOwner = createPublicationModuleHarness({
    async resolve(activity) {
      activeOwnerResolutions += 1;
      if (activity.activity_key === 'physics.gas-laws') {
        return {
          available: true,
          class_id: 42,
          course_id: 9,
          course_unit_id: 92,
          activity_key: activity.activity_key
        };
      }
      return { available: false, error_code: 'activity_hidden' };
    }
  }, {
    initialHash: '#physics/gas-laws',
    knownModules: ['mechanics', 'gas-laws']
  });
  assert.equal(activeOwner.selector.openModule('physics', 'gas-laws'), true);
  await settlePromises();
  assert.equal(activeOwner.selector.activeModule.physics, 'gas-laws');
  assert.equal(activeOwner.getOwnerInitializations(), 2);
  activeOwner.windowObject.location.hash = '#physics/unknown-over-active';
  assert.equal(activeOwner.selector.openModule('physics', 'unknown-over-active'), false);
  assert.equal(activeOwnerResolutions, 1, 'the active known module must resolve once, while an unknown replacement stays local');
  assert.equal(activeOwner.selector.activeModule.physics, 'gas-laws');
  assert.equal(activeOwner.getOwnerInitializations(), 2);
  assert.equal(activeOwner.warnings.length, 1);
  assert.deepEqual(activeOwner.errors, []);

  let resolveLateHidden;
  const staleHidden = createPublicationModuleHarness({
    resolve(activity) {
      if (activity.activity_key === 'physics.stale-hidden') {
        return new Promise((resolve) => { resolveLateHidden = resolve; });
      }
      return Promise.resolve({
        available: true,
        class_id: 42,
        course_id: 9,
        course_unit_id: 92,
        activity_key: activity.activity_key
      });
    }
  }, {
    initialHash: '#physics/stale-hidden',
    knownModules: ['mechanics', 'gas-laws']
  });
  assert.equal(staleHidden.selector.openModule('physics', 'stale-hidden'), true);
  await settlePromises();
  assert.equal(typeof resolveLateHidden, 'function');
  assert.equal(staleHidden.selector.openModule('physics', 'gas-laws'), true);
  await settlePromises();
  assert.equal(staleHidden.selector.activeModule.physics, 'gas-laws');
  assert.equal(staleHidden.getOwnerInitializations(), 2);
  const replacementGeneration = staleHidden.selector._transitionGeneration.physics;
  resolveLateHidden({ available: false, error_code: 'activity_hidden' });
  await settlePromises();
  assert.equal(
    staleHidden.selector.activeModule.physics,
    'gas-laws',
    'a late hidden classification must not close a newer known module'
  );
  assert.equal(staleHidden.windowObject.location.hash, '#physics/gas-laws');
  assert.equal(staleHidden.selector._transitionGeneration.physics, replacementGeneration);
  assert.equal(staleHidden.selector._publicationGatePending.physics, undefined);
  assert.equal(staleHidden.getOwnerInitializations(), 2);
  assert.deepEqual(staleHidden.warnings, []);
  assert.deepEqual(staleHidden.errors, []);
}

function assertRouterPublicationQuiescent(harness, expected, label) {
  const routePage = harness.routePage;
  assert.equal(harness.router._pendingModule, null, `${label}: Router pending module must clear`);
  assert.equal(
    harness.selector._publicationGatePending[routePage],
    undefined,
    `${label}: publication classification must not remain pending`
  );
  assert.equal(
    harness.selector._publicationGateNodes[routePage],
    undefined,
    `${label}: backend-only classification must not leave a gate node`
  );
  assert.equal(
    (harness.selector._transitionTimers[routePage] || []).length,
    0,
    `${label}: ModuleSelector transition timers must clear`
  );
  assert.equal(harness.timers.tasks.size, 0, `${label}: Router timers must clear`);
  assert.equal(harness.windowObject.location.hash, expected.hash, `${label}: hash normalization`);
  assert.equal(
    harness.getOwnerInitializations(),
    expected.owners || 0,
    `${label}: owner initialization count`
  );
  assert.equal(harness.warnings.length, expected.warnings, `${label}: warning count`);
  assert.equal(harness.errors.length, 0, `${label}: console error count`);
}

function publicationAuthorityCallCount(harness) {
  return harness.apiCalls.filter((call) => (
    call.route === '/api/courses'
    || /^\/api\/courses\/\d+\/units$/.test(call.route)
    || /^\/api\/courses\/\d+\/unit-access$/.test(call.route)
  )).length;
}

function unitAccessCallCount(harness) {
  return harness.apiCalls.filter((call) => (
    /^\/api\/courses\/\d+\/unit-access$/.test(call.route)
  )).length;
}

async function assertKnownGasLawsRecovery(harness, label, { restoreRegistry = false } = {}) {
  if (restoreRegistry) harness.restoreProductionRegistry();
  const authorityCallsBefore = publicationAuthorityCallCount(harness);
  const ownersBefore = harness.getOwnerInitializations();
  const warningsBefore = harness.warnings.length;
  harness.windowObject.location.hash = '#physics/gas-laws';
  harness.router.handleHash();
  await settlePromises(32);
  await harness.timers.drain();
  await settlePromises(32);
  assertRouterPublicationQuiescent(
    harness,
    {
      hash: '#physics/gas-laws',
      warnings: warningsBefore,
      owners: ownersBefore + 1
    },
    `${label}: known-module recovery`
  );
  assert.equal(
    harness.selector.activeModule.physics,
    'gas-laws',
    `${label}: known module must become active`
  );
  assert.equal(
    publicationAuthorityCallCount(harness),
    authorityCallsBefore + 2,
    `${label}: known student Physics module must resolve /courses and /units before ownership`
  );
}

function deferredPublicationRequest(unitAccessDeferred, moduleId, observations = {}) {
  return (route, requestOptions = {}) => {
    if (route === '/api/classes') return Promise.resolve([{ id: 42, name: 'B 班' }]);
    if (route === '/api/courses') {
      observations.coursesSignal = requestOptions.signal;
      return Promise.resolve([{ id: 92, galaxy_key: 'englab', course_key: 'physics' }]);
    }
    if (route === '/api/courses/92/units') {
      observations.unitsSignal = requestOptions.signal;
      assert.equal(
        requestOptions.signal,
        observations.coursesSignal,
        'the publication lookup must reuse one internal signal from /courses through /units'
      );
      return Promise.resolve([{
        id: 104,
        activity_key: 'physics.gas-laws',
        effective_release_state: 'open'
      }]);
    }
    if (route === '/api/courses/92/unit-access') {
      observations.unitAccessSignal = requestOptions.signal;
      assert.equal(
        requestOptions.signal,
        observations.unitsSignal,
        'the exact unit-access fallback must reuse the /units AbortSignal'
      );
      assert.equal(requestOptions.params.class_id, 42);
      assert.equal(requestOptions.params.activity_key, `physics.${moduleId}`);
      return unitAccessDeferred.promise;
    }
    throw new Error(`unexpected deferred publication request for ${moduleId}: ${route}`);
  };
}

function sequencedDeferredPublicationRequest(unitAccessDeferreds, moduleId, observations = {}) {
  let activeSignal = null;
  let unitAccessIndex = 0;
  observations.unitAccessSignals = observations.unitAccessSignals || [];
  return (route, requestOptions = {}) => {
    if (route === '/api/classes') return Promise.resolve([{ id: 42, name: 'B class' }]);
    if (route === '/api/courses') {
      activeSignal = requestOptions.signal;
      return Promise.resolve([{ id: 92, galaxy_key: 'englab', course_key: 'physics' }]);
    }
    if (route === '/api/courses/92/units') {
      assert.equal(
        requestOptions.signal,
        activeSignal,
        'each publication attempt must reuse its own signal from /courses through /units'
      );
      return Promise.resolve([{
        id: 104,
        activity_key: 'physics.gas-laws',
        effective_release_state: 'open'
      }]);
    }
    if (route === '/api/courses/92/unit-access') {
      assert.equal(
        requestOptions.signal,
        activeSignal,
        'each exact unit-access fallback must reuse its attempt signal'
      );
      assert.equal(requestOptions.params.class_id, 42);
      assert.equal(requestOptions.params.activity_key, `physics.${moduleId}`);
      const deferred = unitAccessDeferreds[unitAccessIndex];
      assert.ok(deferred, 'each unit-access attempt must have a controlled response');
      unitAccessIndex += 1;
      observations.unitAccessSignals.push(requestOptions.signal);
      return deferred.promise;
    }
    throw new Error(`unexpected sequenced publication request for ${moduleId}: ${route}`);
  };
}

function deferredCoursesPublicationRequest(coursesDeferred, observations = {}) {
  return (route, requestOptions = {}) => {
    if (route === '/api/classes') return Promise.resolve([{ id: 42, name: 'B 班' }]);
    if (route === '/api/courses') {
      observations.signal = requestOptions.signal;
      return coursesDeferred.promise;
    }
    if (route === '/api/courses/92/units') {
      observations.downstreamRoutes.push(route);
      return Promise.resolve([{
        id: 104,
        activity_key: 'physics.gas-laws',
        effective_release_state: 'open'
      }]);
    }
    if (route === '/api/courses/92/unit-access') {
      observations.downstreamRoutes.push(route);
      return Promise.resolve({ available: false, error_code: 'activity_hidden' });
    }
    throw new Error(`unexpected cancelled-stage publication request: ${route}`);
  };
}

async function runProductionRouterPublicationContract() {
  const hostileGetterReads = { code: 0, message: 0 };
  const registryFailures = [
    [
      'getter-throws',
      REGISTRY_UNAVAILABLE_WARNING,
      HOSTILE_MODULE_ID,
      createHostileSensitiveDiagnosticError(hostileGetterReads)
    ],
    ['missing', REGISTRY_UNAVAILABLE_WARNING, 'hidden-qa-v7718'],
    ['invalid-api', REGISTRY_UNAVAILABLE_WARNING, 'hidden-qa-v7718'],
    ['throws', REGISTRY_LOOKUP_WARNING, 'hidden-qa-v7718', createSensitiveDiagnosticError()]
  ];
  for (const [registryMode, expectedWarning, moduleId, registryError] of registryFailures) {
    const harness = createRouterPublicationHarness({
      registryMode,
      registryError,
      moduleId
    });
    await harness.ready();
    await harness.startRoute();
    assertRouterPublicationQuiescent(
      harness,
      { hash: '#physics', warnings: 1 },
      `production Router with ${registryMode} registry`
    );
    assert.equal(
      publicationAuthorityCallCount(harness),
      0,
      `${registryMode} registry infrastructure must not query publication authority`
    );
    assertFixedSafeWarning(
      harness.warnings,
      expectedWarning,
      `production Router ${registryMode} registry failure`
    );
    if (registryMode === 'getter-throws') {
      assert.deepEqual(
        hostileGetterReads,
        { code: 0, message: 0 },
        'registry property failure must not inspect hostile error fields'
      );
    }
    await assertKnownGasLawsRecovery(
      harness,
      `production Router with ${registryMode} registry`,
      { restoreRegistry: true }
    );
  }

  const knownModule = createRouterPublicationHarness({ moduleId: 'gas-laws' });
  await knownModule.ready();
  const knownAuthorityCalls = publicationAuthorityCallCount(knownModule);
  await knownModule.startRoute();
  await knownModule.timers.drain();
  await settlePromises(32);
  assertRouterPublicationQuiescent(
    knownModule,
    { hash: '#physics/gas-laws', warnings: 0, owners: 1 },
    'known gas-laws production Router route'
  );
  assert.equal(knownModule.selector.activeModule.physics, 'gas-laws');
  assert.equal(
    publicationAuthorityCallCount(knownModule),
    knownAuthorityCalls + 2,
    'known gas-laws must resolve publication authority before activating its owner'
  );

  for (const role of ['teacher', 'admin']) {
    const privileged = createRouterPublicationHarness({
      moduleId: 'gas-laws',
      user: { id: role === 'teacher' ? 8 : 9, role }
    });
    await privileged.ready();
    await privileged.startRoute();
    await privileged.timers.drain();
    await settlePromises(32);
    assertRouterPublicationQuiescent(
      privileged,
      { hash: '#physics/gas-laws', warnings: 0, owners: 1 },
      `${role} known gas-laws route`
    );
    assert.equal(
      publicationAuthorityCallCount(privileged),
      0,
      `${role} routing must keep the existing non-student authority boundary`
    );
  }

  const listedOpen = createRouterPublicationHarness({
    moduleId: 'mechanics',
    units: [{
      id: 103,
      activity_key: 'physics.mechanics',
      effective_release_state: 'open'
    }]
  });
  await listedOpen.ready();
  await listedOpen.startRoute();
  await listedOpen.timers.drain();
  await settlePromises(32);
  assertRouterPublicationQuiescent(
    listedOpen,
    { hash: '#physics/mechanics', warnings: 0, owners: 2 },
    'listed open mechanics route'
  );
  assert.equal(unitAccessCallCount(listedOpen), 0, 'listed open must not probe unit-access');

  const listedLocked = createRouterPublicationHarness({
    moduleId: 'mechanics',
    units: [{
      id: 103,
      activity_key: 'physics.mechanics',
      effective_release_state: 'locked'
    }]
  });
  await listedLocked.ready();
  await listedLocked.startRoute();
  assertRouterPublicationQuiescent(
    listedLocked,
    { hash: '#physics', warnings: 0, owners: 0 },
    'listed locked mechanics route'
  );
  assert.equal(unitAccessCallCount(listedLocked), 0, 'listed locked must not probe unit-access');

  const backendHiddenKnown = createRouterPublicationHarness({
    moduleId: 'thermodynamics',
    domModules: ['mechanics', 'gas-laws', 'thermodynamics'],
    units: [],
    unitAccess: { available: false, error_code: 'activity_hidden' }
  });
  await backendHiddenKnown.ready();
  await backendHiddenKnown.startRoute();
  assertRouterPublicationQuiescent(
    backendHiddenKnown,
    { hash: '#physics', warnings: 0, owners: 0 },
    'backend-hidden known thermodynamics route'
  );
  assert.equal(
    unitAccessCallCount(backendHiddenKnown),
    1,
    'a known Physics unit omitted from /units must use exactly one unit-access classification'
  );

  const ambiguousListed = createRouterPublicationHarness({
    moduleId: 'mechanics',
    units: [
      {
        id: 103,
        activity_key: 'physics.mechanics',
        effective_release_state: 'open'
      },
      {
        id: 104,
        activity_key: 'physics.mechanics',
        effective_release_state: 'locked'
      }
    ]
  });
  await ambiguousListed.ready();
  await ambiguousListed.startRoute();
  assert.equal(ambiguousListed.selector._publicationGatePending.physics, undefined);
  assert.deepEqual(
    ambiguousListed.selector._publicationGateNodes.physics,
    { state: 'unavailable', code: 'course_unit_ambiguous' }
  );
  assert.equal(ambiguousListed.getOwnerInitializations(), 0);
  assert.equal(unitAccessCallCount(ambiguousListed), 0, 'ambiguous /units matches must fail without probing');

  const missingMechanics = createRouterPublicationHarness({
    moduleId: 'mechanics',
    units: [],
    releaseState: 'missing'
  });
  await missingMechanics.ready();
  await missingMechanics.startRoute();
  assertRouterPublicationQuiescent(
    missingMechanics,
    { hash: '#physics', warnings: 1 },
    'missing registered mechanics route'
  );
  assert.equal(unitAccessCallCount(missingMechanics), 1);
  assertFixedSafeWarning(
    missingMechanics.warnings,
    UNKNOWN_MODULE_WARNING,
    'missing registered mechanics route'
  );

  const nonPhysics = createRouterPublicationHarness({
    page: 'chemistry',
    moduleId: 'backend-only-unknown',
    domModules: ['periodic-table']
  });
  await nonPhysics.ready();
  const nonPhysicsAuthorityCalls = publicationAuthorityCallCount(nonPhysics);
  await nonPhysics.startRoute();
  assertRouterPublicationQuiescent(
    nonPhysics,
    { hash: '#chemistry', warnings: 1, owners: 0 },
    'non-physics production Router route'
  );
  assert.equal(
    publicationAuthorityCallCount(nonPhysics),
    nonPhysicsAuthorityCalls,
    'non-physics routing must add zero publication authority requests'
  );
  assertFixedSafeWarning(
    nonPhysics.warnings,
    UNKNOWN_MODULE_WARNING,
    'non-physics ordinary unknown'
  );

  const knownNonPhysics = createRouterPublicationHarness({
    page: 'chemistry',
    moduleId: 'periodic-table',
    domModules: ['periodic-table']
  });
  await knownNonPhysics.ready();
  await knownNonPhysics.startRoute();
  await knownNonPhysics.timers.drain();
  await settlePromises(32);
  assertRouterPublicationQuiescent(
    knownNonPhysics,
    { hash: '#chemistry/periodic-table', warnings: 0, owners: 1 },
    'known non-Physics student route'
  );
  assert.equal(publicationAuthorityCallCount(knownNonPhysics), 0);

  const nonStudent = createRouterPublicationHarness({
    moduleId: 'teacher-unknown',
    user: { id: 8, role: 'teacher' }
  });
  await nonStudent.ready();
  await nonStudent.startRoute();
  assertRouterPublicationQuiescent(
    nonStudent,
    { hash: '#physics', warnings: 1 },
    'non-student production Router route'
  );
  assert.equal(publicationAuthorityCallCount(nonStudent), 0);
  assertFixedSafeWarning(nonStudent.warnings, UNKNOWN_MODULE_WARNING, 'non-student route');

  const noCurrentClass = createRouterPublicationHarness({
    moduleId: 'no-class-unit',
    request(route) {
      if (route === '/api/classes') return Promise.resolve([]);
      throw new Error(`no-class route must not request ${route}`);
    }
  });
  await noCurrentClass.ready();
  await noCurrentClass.startRoute();
  assertRouterPublicationQuiescent(
    noCurrentClass,
    { hash: '#physics', warnings: 1 },
    'student without a current class'
  );
  assert.equal(
    noCurrentClass.apiCalls.filter((call) => call.route !== '/api/classes').length,
    0,
    'student without a current class must stop before course or unit access'
  );
  assertFixedSafeWarning(
    noCurrentClass.warnings,
    PUBLICATION_CLASSIFICATION_WARNING,
    'student without a current class'
  );

  const ambiguousPhysicsCourse = createRouterPublicationHarness({
    moduleId: 'ambiguous-course-unit',
    request(route) {
      if (route === '/api/classes') return Promise.resolve([{ id: 42, name: 'B 班' }]);
      if (route === '/api/courses') {
        return Promise.resolve([
          { id: 92, galaxy_key: 'englab', course_key: 'physics' },
          { id: 93, galaxy_key: 'englab', course_key: 'physics' }
        ]);
      }
      throw new Error(`ambiguous course route must not request ${route}`);
    }
  });
  await ambiguousPhysicsCourse.ready();
  await ambiguousPhysicsCourse.startRoute();
  assertRouterPublicationQuiescent(
    ambiguousPhysicsCourse,
    { hash: '#physics', warnings: 1 },
    'student with ambiguous physics courses'
  );
  assert.equal(unitAccessCallCount(ambiguousPhysicsCourse), 0);
  assertFixedSafeWarning(
    ambiguousPhysicsCourse.warnings,
    PUBLICATION_CLASSIFICATION_WARNING,
    'student with ambiguous physics courses'
  );

  for (const releaseState of ['hidden', 'locked']) {
    const moduleId = releaseState === 'hidden'
      ? 'hidden-qa-v7718'
      : 'locked-only-unit';
    const harness = createRouterPublicationHarness({
      moduleId,
      releaseState,
      units: []
    });
    await harness.ready();
    assert.ok(
      harness.windowObject.AstraExperimentRegistry.get('physics', 'mechanics'),
      'the cold-start contract must use the production experiment registry'
    );
    await harness.startRoute();
    assertRouterPublicationQuiescent(
      harness,
      { hash: '#physics', warnings: 0 },
      `authoritative ${releaseState} backend-only route`
    );
    assert.ok(
      harness.apiCalls.some((call) => call.route === '/api/courses/92/units'),
      `${releaseState} classification must use the production publication context`
    );
    assert.equal(
      unitAccessCallCount(harness),
      1,
      `${releaseState} omitted from /units must use one exact unit-access fallback`
    );
    assert.equal(
      harness.selectors.some((selector) => selector.includes(moduleId)),
      false,
      'an untrusted backend-only slug must never be interpolated into a CSS selector'
    );
  }

  const openUnknown = createRouterPublicationHarness({
    moduleId: 'open-backend-only',
    units: [],
    unitAccess: { available: true, error_code: null }
  });
  await openUnknown.ready();
  await openUnknown.startRoute();
  assertRouterPublicationQuiescent(
    openUnknown,
    { hash: '#physics', warnings: 1 },
    'authoritative open registry-absent route'
  );
  assertFixedSafeWarning(
    openUnknown.warnings,
    PUBLICATION_CLASSIFICATION_WARNING,
    'available unknown without a course unit id'
  );
  assert.equal(unitAccessCallCount(openUnknown), 1);
  await assertKnownGasLawsRecovery(openUnknown, 'authoritative open registry-absent route');

  const ordinaryMissing = createRouterPublicationHarness({
    moduleId: 'ordinary-unknown',
    units: [],
    releaseState: 'missing'
  });
  await ordinaryMissing.ready();
  await ordinaryMissing.startRoute();
  assertRouterPublicationQuiescent(
    ordinaryMissing,
    { hash: '#physics', warnings: 1 },
    'ordinary registry-absent route'
  );
  assertFixedSafeWarning(
    ordinaryMissing.warnings,
    UNKNOWN_MODULE_WARNING,
    'ordinary missing registry-absent route'
  );
  assert.equal(unitAccessCallCount(ordinaryMissing), 1);
  await assertKnownGasLawsRecovery(ordinaryMissing, 'ordinary registry-absent route');

  const invalidUnitAccessCases = [
    ['extra DTO key', { available: false, error_code: 'activity_hidden', title: 'secret' }],
    ['unknown error code', { available: false, error_code: 'future_private_state' }],
    ['contradictory DTO', { available: true, error_code: 'activity_hidden' }],
    ['request rejection', () => Promise.reject(createSensitiveDiagnosticError())]
  ];
  for (const [label, unitAccess] of invalidUnitAccessCases) {
    const harness = createRouterPublicationHarness({
      moduleId: `invalid-access-${label.replace(/\s+/g, '-').toLowerCase()}`,
      units: [],
      unitAccess
    });
    await harness.ready();
    await harness.startRoute();
    assertRouterPublicationQuiescent(
      harness,
      { hash: '#physics', warnings: 1 },
      label
    );
    assert.equal(unitAccessCallCount(harness), 1, `${label}: one exact fallback request`);
    assertFixedSafeWarning(
      harness.warnings,
      PUBLICATION_CLASSIFICATION_WARNING,
      label
    );
  }

  const malformed = createRouterPublicationHarness({
    moduleId: 'malformed/key',
    initialHash: '#physics/malformed/key'
  });
  await malformed.ready();
  await malformed.startRoute();
  assertRouterPublicationQuiescent(
    malformed,
    { hash: '#physics', warnings: 1 },
    'malformed production Router route'
  );
  assert.equal(
    malformed.apiCalls.filter((call) => call.route === '/api/courses').length,
    0,
    'a malformed module key must not enter authority resolution'
  );
  assertFixedSafeWarning(
    malformed.warnings,
    UNKNOWN_MODULE_WARNING,
    'malformed production Router route'
  );

  const contextFailures = [
    ['loader missing', { loaderMode: 'missing' }, PUBLICATION_CLASSIFICATION_WARNING],
    ['loader reject', {
      loaderMode: 'reject',
      loaderError: createSensitiveDiagnosticError()
    }, PUBLICATION_CLASSIFICATION_WARNING],
    ['publication context missing', {
      contextMode: 'missing'
    }, PUBLICATION_CLASSIFICATION_WARNING],
    ['publication resolve reject', {
      request(route) {
        if (route === '/api/classes') {
          return Promise.reject(createSensitiveDiagnosticError());
        }
        throw new Error(`unexpected request after class rejection: ${route}`);
      }
    }, PUBLICATION_CLASSIFICATION_WARNING]
  ];
  for (const [label, options, expectedWarning] of contextFailures) {
    const harness = createRouterPublicationHarness({
      ...options,
      moduleId: 'context-failure'
    });
    await harness.ready();
    await harness.startRoute();
    assertRouterPublicationQuiescent(
      harness,
      { hash: '#physics', warnings: 1 },
      label
    );
    assertFixedSafeWarning(harness.warnings, expectedWarning, label);
  }

  const repeatedAccess = createDeferred();
  const repeatedObservations = {};
  const repeated = createRouterPublicationHarness({
    moduleId: 'same-route-hidden',
    request: deferredPublicationRequest(
      repeatedAccess,
      'same-route-hidden',
      repeatedObservations
    )
  });
  await repeated.ready();
  await repeated.startRoute();
  assert.ok(repeated.selector._publicationGatePending.physics);
  const repeatedApiCalls = repeated.apiCalls.length;
  assert.equal(repeated.selector.openModule('physics', 'same-route-hidden'), true);
  assert.equal(
    repeated.apiCalls.length,
    repeatedApiCalls,
    'reopening the same pending backend-only route must reuse the classification'
  );
  assert.equal(unitAccessCallCount(repeated), 1);
  repeatedAccess.resolve({ available: false, error_code: 'activity_hidden' });
  await settlePromises(32);
  assertRouterPublicationQuiescent(
    repeated,
    { hash: '#physics', warnings: 0 },
    'repeated authoritative hidden route'
  );

  for (const lifecycle of ['close', 'reset', 'leave']) {
    const moduleId = `${lifecycle}-pending-hidden`;
    const accessDeferred = createDeferred();
    const observations = {};
    const harness = createRouterPublicationHarness({
      moduleId,
      request: deferredPublicationRequest(accessDeferred, moduleId, observations)
    });
    await harness.ready();
    await harness.startRoute();
    assert.ok(harness.selector._publicationGatePending.physics, `${lifecycle}: classification must be pending`);
    assert.equal(observations.unitAccessSignal.aborted, false, `${lifecycle}: unit-access starts live`);
    if (lifecycle === 'close') {
      assert.equal(harness.selector.closeModule('physics'), true);
    } else if (lifecycle === 'reset') {
      harness.selector.resetPage('physics');
    } else {
      harness.selector.leavePage('physics', { preserveHash: true });
    }
    assert.equal(
      observations.unitAccessSignal.aborted,
      true,
      `${lifecycle}: cancelling the pending publication gate must immediately abort unit-access`
    );
    const stableHash = lifecycle === 'close'
      ? '#physics'
      : harness.windowObject.location.hash;
    const stableGeneration = harness.selector._transitionGeneration.physics;
    assert.equal(harness.selector._publicationGatePending.physics, undefined);
    accessDeferred.resolve({ available: false, error_code: 'activity_hidden' });
    await settlePromises(32);
    assertRouterPublicationQuiescent(
      harness,
      { hash: stableHash, warnings: 0 },
      `${lifecycle} invalidates late authoritative hidden`
    );
    assert.equal(
      harness.selector._transitionGeneration.physics,
      stableGeneration,
      `${lifecycle}: a late classification must not advance transition generation`
    );
  }

  const abaModuleId = 'reset-aba-hidden';
  const abaFirstAccess = createDeferred();
  const abaSecondAccess = createDeferred();
  const abaObservations = {};
  const aba = createRouterPublicationHarness({
    moduleId: abaModuleId,
    request: sequencedDeferredPublicationRequest(
      [abaFirstAccess, abaSecondAccess],
      abaModuleId,
      abaObservations
    )
  });
  await aba.ready();
  await aba.startRoute();
  const abaFirstPending = aba.selector._publicationGatePending.physics;
  assert.ok(abaFirstPending, 'ABA A classification must be pending');
  assert.equal(abaObservations.unitAccessSignals.length, 1);
  assert.equal(abaObservations.unitAccessSignals[0].aborted, false);
  aba.selector.resetPage('physics');
  assert.equal(abaFirstPending.controller.signal.aborted, true, 'reset must abort ABA A controller');
  assert.equal(abaObservations.unitAccessSignals[0].aborted, true, 'reset must abort ABA A request');
  assert.equal(aba.selector._publicationGatePending.physics, undefined);
  assert.equal(aba.windowObject.location.hash, `#physics/${abaModuleId}`);
  assert.equal(aba.selector.openModule('physics', abaModuleId), true);
  await settlePromises(32);
  const abaSecondPending = aba.selector._publicationGatePending.physics;
  assert.ok(abaSecondPending, 'ABA B classification must start for the same slug');
  assert.notEqual(abaSecondPending.controller, abaFirstPending.controller);
  assert.equal(abaObservations.unitAccessSignals.length, 2);
  assert.equal(abaObservations.unitAccessSignals[1].aborted, false);
  const abaHashBeforeLateA = aba.windowObject.location.hash;
  const abaWarningsBeforeLateA = aba.warnings.length;
  abaFirstAccess.resolve({ available: false, error_code: 'activity_hidden' });
  await settlePromises(32);
  assert.equal(
    aba.selector._publicationGatePending.physics,
    abaSecondPending,
    'a late ABA A result must preserve the exact ABA B pending identity'
  );
  assert.equal(
    abaSecondPending.controller.signal.aborted,
    false,
    'a late ABA A result must not abort ABA B'
  );
  assert.equal(
    abaObservations.unitAccessSignals[1].aborted,
    false,
    'a late ABA A result must leave the ABA B request live'
  );
  assert.equal(aba.windowObject.location.hash, abaHashBeforeLateA);
  assert.equal(aba.warnings.length, abaWarningsBeforeLateA);
  assert.notEqual(
    abaSecondPending.generation,
    abaFirstPending.generation,
    'each post-reset unknown classification must own a fresh transition generation'
  );
  abaSecondAccess.resolve({ available: false, error_code: 'activity_hidden' });
  await settlePromises(32);
  assertRouterPublicationQuiescent(
    aba,
    { hash: '#physics', warnings: 0 },
    'same-slug ABA B authoritative hidden result'
  );

  for (const lifecycle of ['close', 'reset', 'leave']) {
    const moduleId = `${lifecycle}-cancel-before-units`;
    const coursesDeferred = createDeferred();
    const observations = { signal: null, downstreamRoutes: [] };
    const harness = createRouterPublicationHarness({
      moduleId,
      request: deferredCoursesPublicationRequest(coursesDeferred, observations)
    });
    await harness.ready();
    await harness.startRoute();
    assert.ok(harness.selector._publicationGatePending.physics);
    assert.equal(observations.signal.aborted, false, `${lifecycle}: /courses starts live`);
    if (lifecycle === 'close') {
      assert.equal(harness.selector.closeModule('physics'), true);
    } else if (lifecycle === 'reset') {
      harness.selector.resetPage('physics');
    } else {
      harness.selector.leavePage('physics', { preserveHash: true });
    }
    assert.equal(observations.signal.aborted, true, `${lifecycle}: /courses must abort synchronously`);
    coursesDeferred.resolve([{ id: 92, galaxy_key: 'englab', course_key: 'physics' }]);
    await settlePromises(32);
    assert.deepEqual(
      observations.downstreamRoutes,
      [],
      `${lifecycle}: a cancelled /courses response must not advance to /units or unit-access`
    );
    assert.equal(harness.getOwnerInitializations(), 0);
    assert.equal(harness.selector._publicationGatePending.physics, undefined);
    assert.deepEqual(harness.warnings, []);
    assert.deepEqual(harness.errors, []);
  }

  for (const lateState of ['hidden', 'locked', 'missing']) {
    const moduleId = `late-${lateState}`;
    const accessDeferred = createDeferred();
    const harness = createRouterPublicationHarness({
      moduleId,
      request: deferredPublicationRequest(accessDeferred, moduleId)
    });
    await harness.ready();
    await harness.startRoute();
    assert.ok(harness.selector._publicationGatePending.physics);
    assert.equal(harness.selector.openModule('physics', 'gas-laws'), true);
    await settlePromises(32);
    await harness.timers.drain();
    const replacementGeneration = harness.selector._transitionGeneration.physics;
    const replacementOwnerCount = harness.getOwnerInitializations();
    accessDeferred.resolve({
      available: false,
      error_code: lateState === 'missing' ? 'course_unit_missing' : `activity_${lateState}`
    });
    await settlePromises(32);
    assertRouterPublicationQuiescent(
      harness,
      { hash: '#physics/gas-laws', warnings: 0, owners: replacementOwnerCount },
      `late ${lateState} result behind a new owner`
    );
    assert.equal(harness.selector.activeModule.physics, 'gas-laws');
    assert.equal(harness.selector._transitionGeneration.physics, replacementGeneration);
  }

  const loaderDeferred = createDeferred();
  let loaderEnsureCalls = 0;
  const lateReject = createRouterPublicationHarness({
    moduleId: 'late-reject',
    loaderEnsure: () => {
      loaderEnsureCalls += 1;
      return loaderEnsureCalls === 1 ? loaderDeferred.promise : Promise.resolve();
    }
  });
  await lateReject.ready();
  await lateReject.startRoute();
  assert.ok(lateReject.selector._publicationGatePending.physics);
  assert.equal(lateReject.selector.openModule('physics', 'gas-laws'), true);
  await settlePromises(32);
  await lateReject.timers.drain();
  const lateRejectGeneration = lateReject.selector._transitionGeneration.physics;
  const lateRejectOwners = lateReject.getOwnerInitializations();
  loaderDeferred.reject(Object.assign(new Error('late loader rejection'), { code: 'loader_unavailable' }));
  await settlePromises(32);
  assertRouterPublicationQuiescent(
    lateReject,
    { hash: '#physics/gas-laws', warnings: 0, owners: lateRejectOwners },
    'late rejection behind a new owner'
  );
  assert.equal(lateReject.selector.activeModule.physics, 'gas-laws');
  assert.equal(lateReject.selector._transitionGeneration.physics, lateRejectGeneration);
}

function runMechanicsZoomRestoreContract() {
  function createEventTarget(properties = {}) {
    const listeners = new Map();
    return Object.assign(properties, {
      listeners,
      addEventListener(type, handler) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(handler);
      },
      removeEventListener(type, handler) {
        listeners.get(type)?.delete(handler);
      },
      dispatchEvent(event) {
        for (const handler of listeners.get(event.type) || []) handler(event);
        return true;
      }
    });
  }

  let parentWidth = 863;
  const parent = {
    getBoundingClientRect: () => ({ width: parentWidth })
  };
  const context2d = {
    setTransform() {}
  };
  const canvas = createEventTarget({
    id: 'physics-canvas',
    parentElement: parent,
    style: {},
    width: 0,
    height: 0,
    getContext: () => context2d
  });
  const windowTarget = createEventTarget({
    devicePixelRatio: 2,
    PhysicsZoom: { movedCanvas: null },
    dispatchEvent() {}
  });
  const resizeObservers = [];
  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      resizeObservers.push(this);
    }
    observe(target) {
      this.target = target;
    }
    disconnect() {
      this.disconnected = true;
    }
  }
  const physicsContext = {
    window: windowTarget,
    document: {
      getElementById: (id) => id === 'physics-canvas' ? canvas : null
    },
    ResizeObserver: FakeResizeObserver,
    cancelAnimationFrame() {},
    requestAnimationFrame() {},
    CustomEvent: class {
      constructor(type, options) {
        this.type = type;
        this.detail = options?.detail;
      }
    },
    console
  };
  vm.createContext(physicsContext);
  vm.runInContext(physicsSource, physicsContext, { filename: 'pages/physics/physics.js' });
  const physics = windowTarget.PhysicsSim;
  physics.init();
  assert.equal(canvas.style.width, '863px');
  assert.equal(canvas.width, 1726, 'the mechanics bitmap must include DPR at its initial width');
  assert.equal(resizeObservers[0].target, parent);

  windowTarget.PhysicsZoom.movedCanvas = canvas;
  parentWidth = 318;
  for (const handler of windowTarget.listeners.get('resize') || []) handler({ type: 'resize' });
  assert.equal(canvas.width, 1726, 'viewport resize must not rewrite a canvas while zoom owns it');

  windowTarget.PhysicsZoom.movedCanvas = null;
  canvas.dispatchEvent({ type: 'astra:physics-zoom-restored' });
  assert.equal(canvas.style.width, '318px');
  assert.equal(canvas.width, 636, 'zoom restoration must immediately realign bitmap width with DPR');
  assert.equal(physics.W, 318);

  parentWidth = 500;
  for (const handler of windowTarget.listeners.get('resize') || []) handler({ type: 'resize' });
  assert.equal(canvas.style.width, '500px');
  assert.equal(canvas.width, 1000, 'a later viewport resize must keep the restored canvas aligned');
  physics.destroy();
  assert.equal(resizeObservers[0].disconnected, true);
  assert.equal(windowTarget.listeners.get('resize').size, 0);
  assert.equal(canvas.listeners.get('astra:physics-zoom-restored').size, 0);

  let zoomActiveElement = null;
  function createZoomTarget(properties = {}) {
    const target = createEventTarget(properties);
    target.isConnected = properties.isConnected ?? true;
    target.hidden = properties.hidden ?? false;
    target.disabled = properties.disabled ?? false;
    target.attributes = properties.attributes || new Map();
    target.focusCalls = 0;
    target.focus = () => {
      target.focusCalls += 1;
      zoomActiveElement = target;
    };
    target.getAttribute = properties.getAttribute || ((name) => target.attributes.get(name) || null);
    target.setAttribute = properties.setAttribute || ((name, value) => target.attributes.set(name, value));
    target.removeAttribute = properties.removeAttribute || ((name) => target.attributes.delete(name));
    target.closest = properties.closest || (() => null);
    target.getClientRects = properties.getClientRects || (() => [{}]);
    return target;
  }

  const zoomWindow = createEventTarget({});
  const modalClasses = new Set();
  const closeBtn = createZoomTarget();
  const zoomHost = createZoomTarget({
    getBoundingClientRect: () => ({ width: 1000, height: 600 }),
    appendChild(node) {
      this.child = node;
      node.parentElement = this;
    }
  });
  const zoomTitle = createZoomTarget({ textContent: '' });
  let zoomCanvas = null;
  const zoomModal = createZoomTarget({
    classList: {
      add(name) { modalClasses.add(name); },
      remove(name) { modalClasses.delete(name); },
      contains(name) { return modalClasses.has(name); }
    },
    querySelectorAll() {
      return [closeBtn];
    },
    contains(node) {
      return node === this || node === closeBtn || node === zoomHost || node === zoomCanvas;
    }
  });
  const zoomElements = new Map([
    ['physics-zoom-modal', zoomModal],
    ['physics-zoom-host', zoomHost],
    ['physics-zoom-title', zoomTitle],
    ['physics-zoom-close', closeBtn]
  ]);
  const zoomDocument = createEventTarget({
    getElementById: (id) => zoomElements.get(id) || null,
    querySelectorAll: () => [],
    createComment: () => ({ nodeType: 8 }),
    body: { appendChild() {} }
  });
  Object.defineProperty(zoomDocument, 'activeElement', {
    get: () => zoomActiveElement
  });
  const zoomContext = {
    window: zoomWindow,
    document: zoomDocument,
    Event: class {
      constructor(type) { this.type = type; }
    },
    console
  };
  vm.createContext(zoomContext);
  vm.runInContext(physicsZoomSource, zoomContext, { filename: 'pages/physics/physics-zoom.js' });
  const zoom = zoomWindow.PhysicsZoom;
  const restoredEvents = [];
  const zoomTrigger = createZoomTarget();
  const secondZoomTrigger = createZoomTarget();
  zoomCanvas = createZoomTarget({
    parentElement: null,
    style: {},
    getBoundingClientRect: () => ({ width: 863, height: 483.28 }),
    attributes: new Map([['style', 'width: 863px; height: 483.28px;']]),
  });
  const originalParent = {
    placeholderInsertions: 0,
    canvasRestorations: 0,
    placeholderRemovals: 0,
    insertBefore(node, placeholder) {
      if (node === zoomCanvas) {
        assert.equal(placeholder, zoom.movedPlaceholder);
        this.canvasRestorations += 1;
        zoomCanvas.parentElement = this;
      } else {
        assert.equal(placeholder, zoomCanvas);
        this.placeholderInsertions += 1;
      }
    },
    removeChild(placeholder) {
      assert.equal(placeholder, zoom.movedPlaceholder);
      this.placeholderRemovals += 1;
    }
  };
  zoomCanvas.parentElement = originalParent;
  zoomCanvas.addEventListener('astra:physics-zoom-restored', (event) => {
    restoredEvents.push({
      type: event.type,
      movedCanvas: zoom.movedCanvas
    });
  });

  const countListener = (target, type) => target.listeners.get(type)?.size || 0;
  const assertModalListenerCount = (expected) => {
    assert.equal(countListener(closeBtn, 'click'), expected);
    assert.equal(countListener(zoomModal, 'click'), expected);
    assert.equal(countListener(zoomDocument, 'keydown'), expected);
    assert.equal(countListener(zoomWindow, 'resize'), expected);
  };
  const keyEvent = (key, shiftKey = false) => ({
    type: 'keydown',
    key,
    shiftKey,
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; }
  });

  zoom.init();
  zoom.init();
  assertModalListenerCount(1);
  zoomActiveElement = zoomTrigger;
  zoom.open(zoomCanvas, 'Mechanics', zoomTrigger);
  assert.equal(modalClasses.has('open'), true);
  assert.equal(zoomActiveElement, closeBtn, 'opening zoom must move focus into the dialog');
  assertModalListenerCount(1);

  const tab = keyEvent('Tab');
  zoomDocument.dispatchEvent(tab);
  assert.equal(tab.prevented, true);
  assert.equal(tab.stopped, true);
  assert.equal(zoomActiveElement, closeBtn, 'Tab must stay within the one-control dialog');
  const shiftTab = keyEvent('Tab', true);
  zoomActiveElement = zoomTrigger;
  zoomDocument.dispatchEvent(shiftTab);
  assert.equal(shiftTab.prevented, true);
  assert.equal(shiftTab.stopped, true);
  assert.equal(zoomActiveElement, closeBtn, 'Shift+Tab from outside must return to the dialog');

  const escape = keyEvent('Escape');
  zoomDocument.dispatchEvent(escape);
  assert.equal(escape.prevented, true);
  assert.equal(escape.stopped, true);
  assert.equal(modalClasses.has('open'), false);
  assert.equal(zoomActiveElement, zoomTrigger, 'Escape close must restore the initiating zoom button');
  assertModalListenerCount(0);
  assert.deepEqual(restoredEvents, [{
    type: 'astra:physics-zoom-restored',
    movedCanvas: null
  }]);

  zoom.init();
  assertModalListenerCount(1);
  zoom.close();
  assertModalListenerCount(0);
  assert.equal(modalClasses.has('open'), false, 'page leave close must tear down listeners even without an open canvas');

  zoom.init();
  zoomActiveElement = secondZoomTrigger;
  zoom.open(zoomCanvas, 'Mechanics', secondZoomTrigger);
  closeBtn.dispatchEvent({ type: 'click', target: closeBtn });
  assert.equal(zoomActiveElement, secondZoomTrigger, 'close button must restore its initiating trigger');
  assertModalListenerCount(0);

  zoom.init();
  const disconnectedTrigger = createZoomTarget({ isConnected: false });
  zoom.open(zoomCanvas, 'Mechanics', disconnectedTrigger);
  zoom.destroy();
  assertModalListenerCount(0);
  assert.equal(disconnectedTrigger.focusCalls, 0, 'destroy must not focus a detached trigger');
  assert.doesNotThrow(() => zoom.destroy());
  assertModalListenerCount(0);
  assert.equal(zoom.movedCanvas, null);

  zoom.init();
  const cssHiddenTrigger = createZoomTarget({ getClientRects: () => [] });
  zoom.open(zoomCanvas, 'Mechanics', cssHiddenTrigger);
  zoom.destroy();
  assert.equal(cssHiddenTrigger.focusCalls, 0, 'destroy must not focus a trigger hidden by route layout');
  assertModalListenerCount(0);
  assert.equal(originalParent.placeholderInsertions, 4);
  assert.equal(originalParent.canvasRestorations, 4);
  assert.equal(originalParent.placeholderRemovals, 4);

  let responsiveWidth = 390;
  let responsiveHostWidth = 360;
  let responsiveHostHeight = 720;
  const combinedTransforms = [];
  const combinedFrames = [];
  const combinedBaseScales = [];
  let combinedPinchCreates = 0;
  let combinedPinchDestroys = 0;
  const combinedContext2d = {
    setTransform(...args) { combinedTransforms.push(args); },
    clearRect(...args) { combinedFrames.push(args); },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fillText() {}
  };
  const combinedWindow = createEventTarget({ devicePixelRatio: 2 });
  const combinedModalClasses = new Set();
  const combinedClose = createZoomTarget();
  const combinedTitle = createZoomTarget({ textContent: '' });
  const combinedHost = createZoomTarget({
    getBoundingClientRect: () => ({
      width: responsiveHostWidth,
      height: responsiveHostHeight
    }),
    appendChild(node) {
      this.child = node;
      node.parentElement = this;
    }
  });
  let combinedCanvas = null;
  const combinedModal = createZoomTarget({
    classList: {
      add(name) { combinedModalClasses.add(name); },
      remove(name) { combinedModalClasses.delete(name); },
      contains(name) { return combinedModalClasses.has(name); }
    },
    querySelectorAll: () => [combinedClose],
    contains(node) {
      return node === this || node === combinedClose || node === combinedHost || node === combinedCanvas;
    }
  });
  const combinedOriginalParent = {
    getBoundingClientRect: () => ({ width: responsiveWidth }),
    insertBefore(node, reference) {
      if (node === combinedCanvas) {
        assert.equal(reference, combinedZoom.movedPlaceholder);
        combinedCanvas.parentElement = this;
      } else {
        assert.equal(reference, combinedCanvas);
      }
    },
    removeChild(node) {
      assert.equal(node, combinedZoom.movedPlaceholder);
    }
  };
  combinedCanvas = createZoomTarget({
    id: 'physics-canvas',
    parentElement: combinedOriginalParent,
    style: {},
    width: 0,
    height: 0,
    getContext: () => combinedContext2d,
    getBoundingClientRect: () => ({
      width: responsiveWidth,
      height: Math.min(Math.max(responsiveWidth * 0.56, 320), 560)
    }),
    attributes: new Map()
  });
  const combinedElements = new Map([
    ['physics-canvas', combinedCanvas],
    ['physics-zoom-modal', combinedModal],
    ['physics-zoom-host', combinedHost],
    ['physics-zoom-title', combinedTitle],
    ['physics-zoom-close', combinedClose]
  ]);
  [
    'gravity-slider', 'restitution-slider', 'friction-slider', 'radius-slider',
    'physics-clear', 'physics-pause', 'gravity-value', 'restitution-value',
    'friction-value', 'radius-value'
  ].forEach((id) => {
    const element = createEventTarget({ value: '0', textContent: '' });
    combinedElements.set(id, element);
  });
  const combinedDocument = createEventTarget({
    getElementById: (id) => combinedElements.get(id) || null,
    querySelectorAll: () => [],
    createComment: () => ({ nodeType: 8 }),
    body: { appendChild() {} }
  });
  Object.defineProperty(combinedDocument, 'activeElement', {
    get: () => zoomActiveElement
  });
  const combinedContext = {
    window: combinedWindow,
    document: combinedDocument,
    ResizeObserver: FakeResizeObserver,
    cancelAnimationFrame() {},
    requestAnimationFrame: () => 1,
    Event: class {
      constructor(type) { this.type = type; }
    },
    CustomEvent: class {
      constructor(type, options) {
        this.type = type;
        this.detail = options?.detail;
      }
    },
    TouchGestures: {
      enablePinchZoom() {
        combinedPinchCreates += 1;
        return {
          setBaseScale(scale) { combinedBaseScales.push(scale); },
          reset() {},
          destroy() { combinedPinchDestroys += 1; }
        };
      }
    },
    CF: { sans: 'sans-serif' },
    console
  };
  vm.createContext(combinedContext);
  vm.runInContext(physicsSource, combinedContext, { filename: 'pages/physics/physics.js' });
  vm.runInContext(physicsZoomSource, combinedContext, { filename: 'pages/physics/physics-zoom.js' });
  const combinedPhysics = combinedWindow.PhysicsSim;
  const combinedZoom = combinedWindow.PhysicsZoom;
  combinedPhysics.init();
  const combinedResizeObserver = resizeObservers.at(-1);
  const combinedResizeObserverCount = resizeObservers.length;
  assert.equal(combinedResizeObserver.target, combinedOriginalParent);
  combinedZoom.init();
  assert.equal(combinedCanvas.style.width, '390px');
  assert.equal(combinedCanvas.width, 780);
  const combinedTrigger = createZoomTarget();
  zoomActiveElement = combinedTrigger;
  combinedZoom.open(combinedCanvas, 'Mechanics', combinedTrigger);
  assert.equal(combinedModalClasses.has('open'), true);
  assert.equal(countListener(combinedWindow, 'resize'), 2, 'PhysicsSim and PhysicsZoom retain one resize owner each');
  assert.equal(combinedCanvas.style.width, '390px');
  assert.equal(combinedCanvas.style.height, '320px');
  assert.equal(combinedCanvas.width, 780);
  assert.equal(combinedCanvas.height, 640);
  assert.equal(combinedPhysics.W, 390);
  assert.equal(combinedPhysics.H, 320);
  assert.deepEqual(combinedTransforms.at(-1), [2, 0, 0, 2, 0, 0]);
  assert.equal(combinedZoom.originalRect.width, 390);
  assert.equal(combinedZoom.originalRect.height, 320);
  assert.equal(
    combinedBaseScales.at(-1),
    Math.min(1, 360 / 390, 720 / 320),
    'opening Zoom at the mobile width must preserve fit-only base scaling'
  );
  assert.equal(combinedZoom.syncOriginalParentResize({}, combinedOriginalParent), false);
  assert.equal(combinedZoom.syncOriginalParentResize(combinedCanvas, {}), false);

  responsiveWidth = 863;
  responsiveHostWidth = 943;
  responsiveHostHeight = 712.2;
  combinedWindow.devicePixelRatio = 1;
  combinedWindow.dispatchEvent({ type: 'resize' });
  assert.equal(combinedCanvas.style.width, '863px');
  assert.equal(combinedCanvas.width, 863);
  assert.equal(
    combinedBaseScales.at(-1),
    1,
    'a transient 863px bitmap must not be auto-upscaled into the settled 943px host'
  );

  responsiveWidth = 943;
  combinedResizeObserver.callback([{ target: combinedOriginalParent }]);
  assert.equal(resizeObservers.length, combinedResizeObserverCount, 'Zoom must reuse the mechanics ResizeObserver');
  assert.equal(combinedCanvas.style.width, '943px');
  assert.ok(Math.abs(Number.parseFloat(combinedCanvas.style.height) - 528.08) < 0.001);
  assert.equal(combinedCanvas.width, 943);
  assert.equal(combinedCanvas.height, 528);
  assert.equal(combinedPhysics.W, 943);
  assert.ok(Math.abs(combinedPhysics.H - 528.08) < 0.001);
  assert.equal(combinedZoom.originalRect.width, 943);
  assert.ok(Math.abs(combinedZoom.originalRect.height - 528.08) < 0.001);
  assert.deepEqual(combinedFrames.at(-1), [0, 0, 943, 528.08]);
  assert.equal(combinedBaseScales.at(-1), 1);

  combinedZoom.close();
  assert.equal(combinedCanvas.parentElement, combinedOriginalParent);
  assert.equal(combinedCanvas.style.width, '943px');
  assert.equal(combinedCanvas.width, 943, 'the restored canvas must retain the settled desktop calibration');
  combinedZoom.open(combinedCanvas, 'Mechanics', combinedTrigger);
  assert.equal(combinedZoom.originalRect.width, 943);
  assert.equal(combinedCanvas.width, 943);
  assert.equal(combinedBaseScales.at(-1), 1, 'direct desktop reopen must match the settled resize path');
  combinedZoom.close();
  assert.equal(combinedCanvas.parentElement, combinedOriginalParent);
  combinedZoom.destroy();
  combinedPhysics.destroy();
  assert.equal(combinedPinchCreates, 2);
  assert.equal(combinedPinchDestroys, 2);
  assert.equal(combinedResizeObserver.disconnected, true);
  assert.equal(combinedZoom.movedCanvas, null);
  assert.equal(countListener(combinedWindow, 'resize'), 0);
  assert.equal(countListener(combinedDocument, 'keydown'), 0);
}

(async () => {
  runMechanicsZoomRestoreContract();
  await runPublicationUnknownModuleDiagnosticContract();
  await runProductionRouterPublicationContract();

  let prepareSessionUser = null;
  let settlePrepareClasses;
  const prepareAbortCalls = [];
  const prepareAbortWindow = {
    addEventListener() {},
    AstraApplicationSession: { getUser: () => prepareSessionUser },
    AstraApiClient: {
      request(route, options = {}) {
        prepareAbortCalls.push({ route, signal: options.signal });
        if (route === '/api/classes') {
          return new Promise((resolve) => { settlePrepareClasses = resolve; });
        }
        throw new Error(`cancelled prepare must not advance to ${route}`);
      },
      isCancelled: (error) => Boolean(error && error.name === 'AbortError')
    }
  };
  const prepareAbortContext = { window: prepareAbortWindow, console, AbortController };
  vm.createContext(prepareAbortContext);
  vm.runInContext(publicationSource, prepareAbortContext, {
    filename: 'shared/js/engineering-lab-publication-context.js'
  });
  prepareSessionUser = { id: 7, role: 'student' };
  const prepareAbortController = new AbortController();
  const prepareAbortResolution = prepareAbortWindow.AstraEngineeringLabPublicationContext.resolve({
    galaxy_key: 'englab',
    course_key: 'physics',
    activity_key: 'physics.mechanics'
  }, { signal: prepareAbortController.signal });
  await settlePromises(8);
  assert.equal(prepareAbortCalls.length, 1);
  assert.equal(prepareAbortCalls[0].route, '/api/classes');
  assert.equal(prepareAbortCalls[0].signal.aborted, false);
  prepareAbortController.abort();
  assert.equal(prepareAbortCalls[0].signal.aborted, true, 'external cancellation must bridge into prepare');
  settlePrepareClasses([{ id: 42, name: 'B 班' }]);
  assert.equal((await prepareAbortResolution).error_code, 'cancelled');
  assert.equal(prepareAbortCalls.length, 1, 'cancelled prepare must not advance into course resolution');

  const publicationWindow = {
    addEventListener() {},
    location: { hash: '' },
    AstraApplicationSession: { getUser: () => null },
    AstraApiClient: {
      request: async (route) => {
        assert.equal(route, '/api/classes');
        return [{ id: 42, name: 'A 班' }];
      },
      isCancelled: () => false
    }
  };
  const publicationContext = { window: publicationWindow, console, AbortController };
  vm.createContext(publicationContext);
  vm.runInContext(publicationSource, publicationContext, {
    filename: 'shared/js/engineering-lab-publication-context.js'
  });
  const publication = publicationWindow.AstraEngineeringLabPublicationContext;
  assert.equal(typeof publication.describeStudentUnit, 'function');
  assert.equal(typeof publication.navigateStudent, 'function');
  assert.equal(publication.describeStudentUnit({
    title: '隐藏力学',
    content_slug: 'physics/mechanics',
    effective_release_state: 'hidden'
  }, 2), null);
  assert.equal(publication.describeStudentUnit({
    title: '缺少权威发布态',
    content_slug: 'physics/mechanics',
    release_state: 'open'
  }, 3), null);
  assert.equal(publication.describeStudentUnit({
    title: '异常发布态',
    effective_release_state: 'unexpected'
  }, 4), null);

  const studentContext = {
    window: { AstraEngineeringLabPublicationContext: publication },
    navigator: { onLine: true },
    module: { exports: {} },
    console,
    AbortController,
    URLSearchParams,
    Intl
  };
  vm.createContext(studentContext);
  vm.runInContext(studentSource, studentContext, { filename: 'pages/student/student.js' });
  const { state, renderCoursePanel } = studentContext.module.exports;
  const coursePanel = { innerHTML: '' };
  state.root = {
    querySelector: (selector) => selector === '[data-student-panel="course"]' ? coursePanel : null
  };
  state.selected.classId = '42';
  state.selected.courseId = '9';
  state.data.courses = [{ id: 9, title: '物理课程', summary: '' }];
  state.data.units = [
    {
      title: '开放力学',
      activity_key: 'physics.mechanics',
      content_slug: 'physics/mechanics',
      effective_release_state: 'open'
    },
    {
      title: '锁定力学',
      activity_key: 'physics.mechanics',
      content_slug: 'physics/mechanics',
      effective_release_state: 'locked'
    },
    {
      title: '隐藏力学',
      content_slug: 'physics/mechanics',
      effective_release_state: 'hidden'
    },
    {
      title: '伪开放力学',
      content_slug: 'physics/mechanics',
      release_state: 'open'
    }
  ];
  renderCoursePanel();
  const openMarkup = coursePanel.innerHTML.match(/<li data-student-unit-state="open">[\s\S]*?<\/li>/)[0];
  const lockedMarkup = coursePanel.innerHTML.match(/<li data-student-unit-state="locked">[\s\S]*?<\/li>/)[0];
  assert.match(openMarkup, /<small>开放学习<\/small>/);
  assert.match(openMarkup, /href="#physics\/mechanics"/);
  assert.match(openMarkup, /data-student-englab-activity="physics\.mechanics"/);
  assert.match(lockedMarkup, /<small>教师已锁定<\/small>/);
  assert.match(lockedMarkup, /暂不可进入/);
  assert.doesNotMatch(lockedMarkup, /href=/, 'locked units must not create an executable link');
  assert.doesNotMatch(coursePanel.innerHTML, /隐藏力学|伪开放力学/);

  await publication.navigateStudent({ id: 7, role: 'student' }, 42, '#physics/mechanics');
  assert.equal(publicationWindow.location.hash, '#physics/mechanics');

  const navigationRequests = [];
  const navigationWindow = {
    addEventListener() {},
    location: { hash: '' },
    AstraApplicationSession: { getUser: () => null },
    AstraApiClient: {
      request: (route, options) => {
        assert.equal(route, '/api/classes');
        return new Promise((resolve) => navigationRequests.push({ resolve, signal: options.signal }));
      },
      isCancelled: (error) => Boolean(error && error.name === 'AbortError')
    }
  };
  const navigationContext = { window: navigationWindow, console, AbortController };
  vm.createContext(navigationContext);
  vm.runInContext(publicationSource, navigationContext, {
    filename: 'shared/js/engineering-lab-publication-context.js'
  });
  const navigationPublication = navigationWindow.AstraEngineeringLabPublicationContext;
  const firstNavigation = navigationPublication.navigateStudent(
    { id: 7, role: 'student' }, 41, '#physics/mechanics'
  );
  const secondNavigation = navigationPublication.navigateStudent(
    { id: 7, role: 'student' }, 42, '#physics/gas-laws'
  );
  assert.equal(navigationRequests.length, 2);
  assert.equal(navigationRequests[0].signal.aborted, true, 'a newer navigation must abort the older prepare request');
  navigationRequests[1].resolve([{ id: 41, name: 'A 班' }, { id: 42, name: 'B 班' }]);
  assert.equal(await secondNavigation, true);
  assert.equal(navigationWindow.location.hash, '#physics/gas-laws');
  navigationRequests[0].resolve([{ id: 41, name: 'A 班' }, { id: 42, name: 'B 班' }]);
  const firstResult = await firstNavigation.then(
    () => ({ code: 'unexpected_success' }),
    (error) => ({ code: error && error.code })
  );
  assert.equal(firstResult.code, 'cancelled');
  assert.equal(navigationWindow.location.hash, '#physics/gas-laws', 'late A-class prepare must not overwrite the B-class route');

  const classSwitchNavigation = navigationPublication.navigateStudent(
    { id: 7, role: 'student' }, 41, '#physics/mechanics'
  );
  assert.equal(navigationPublication.selectClass(42), true);
  assert.equal(navigationRequests[2].signal.aborted, true, 'an explicit class switch must abort pending navigation');
  navigationRequests[2].resolve([{ id: 41, name: 'A 班' }, { id: 42, name: 'B 班' }]);
  const classSwitchResult = await classSwitchNavigation.then(
    () => ({ code: 'unexpected_success' }),
    (error) => ({ code: error && error.code })
  );
  assert.equal(classSwitchResult.code, 'cancelled');
  assert.equal(navigationWindow.location.hash, '#physics/gas-laws');
  assert.match(
    studentSource,
    /const navigationGeneration = state\.scopeGeneration;[\s\S]*const navigationSignal = state\.scopeController && state\.scopeController\.signal;[\s\S]*state\.scopeGeneration !== navigationGeneration[\s\S]*navigateStudent\([\s\S]*\{ signal: navigationSignal \}/,
    'student navigation must be fenced by the active class-scope generation and AbortSignal'
  );

  const productionCalls = [];
  let settleLateA;
  let deferNextA = false;
  let settleLateUnitAccess;
  let deferNextHiddenUnitAccess = false;
  const productionWindow = {
    addEventListener() {},
    location: { hash: '' },
    AstraApplicationSession: { getUser: () => null },
    AstraApiClient: {
      request: (route, options = {}) => {
        const classId = Number(options.params && options.params.class_id || 0);
        const activityKey = String(options.params && options.params.activity_key || '');
        productionCalls.push({ route, classId, activityKey, signal: options.signal });
        if (route === '/api/classes') {
          return Promise.resolve([{ id: 41, name: 'A 班' }, { id: 42, name: 'B 班' }]);
        }
        if (route === '/api/courses' && classId === 41 && deferNextA) {
          deferNextA = false;
          return new Promise((resolve) => { settleLateA = resolve; });
        }
        if (route === '/api/courses') {
          return Promise.resolve([{
            id: classId === 41 ? 91 : 92,
            galaxy_key: 'englab',
            course_key: 'physics'
          }]);
        }
        if (route === '/api/courses/91/units') {
          return Promise.resolve([{
            id: 101,
            activity_key: 'physics.mechanics',
            effective_release_state: 'open'
          }]);
        }
        if (route === '/api/courses/92/units') {
          return Promise.resolve([{
            id: 102,
            activity_key: 'physics.mechanics',
            effective_release_state: 'locked'
          }]);
        }
        if (route === '/api/courses/92/unit-access') {
          if (activityKey === 'physics.hidden-qa-v7718') {
            if (deferNextHiddenUnitAccess) {
              deferNextHiddenUnitAccess = false;
              return new Promise((resolve) => { settleLateUnitAccess = resolve; });
            }
            return Promise.resolve({ available: false, error_code: 'activity_hidden' });
          }
          if (activityKey === 'physics.locked-only-unit') {
            return Promise.resolve({ available: false, error_code: 'activity_locked' });
          }
          return Promise.resolve({ available: false, error_code: 'course_unit_missing' });
        }
        throw new Error(`unexpected production publication route: ${route}`);
      },
      isCancelled: (error) => Boolean(error && error.name === 'AbortError')
    }
  };
  const productionContext = { window: productionWindow, console, AbortController };
  vm.createContext(productionContext);
  vm.runInContext(publicationSource, productionContext, {
    filename: 'shared/js/engineering-lab-publication-context.js'
  });
  const productionPublication = productionWindow.AstraEngineeringLabPublicationContext;
  const studentUser = { id: 7, role: 'student' };
  assert.equal((await productionPublication.switchClass(studentUser, 41)).class_id, 41);
  const classDriver = createStudentClassDriver(productionPublication);
  classDriver.state.selected.classId = '41';
  const activity = {
    galaxy_key: 'englab',
    course_key: 'physics',
    activity_key: 'physics.mechanics'
  };
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  const callsBeforeAbortedResolve = productionCalls.length;
  assert.equal(
    (await productionPublication.resolve(activity, { signal: alreadyAborted.signal })).error_code,
    'cancelled',
    'an already-aborted external scope must cancel before any publication request'
  );
  assert.equal(productionCalls.length, callsBeforeAbortedResolve);
  deferNextA = true;
  const lateAResolution = productionPublication.resolve(activity);
  await settlePromises();
  assert.equal(typeof settleLateA, 'function');
  const lateACall = productionCalls.find((call) => call.route === '/api/courses' && call.classId === 41);
  assert.equal(lateACall.signal.aborted, false);
  await classDriver.changeClass('42');
  assert.equal(lateACall.signal.aborted, true, 'the production A→B switch must abort the in-flight A resolve');
  assert.equal(productionPublication.snapshot().class_id, 42, 'the production class change must synchronize B');
  const bHarness = createPublicationModuleHarness(productionPublication);
  assert.equal(bHarness.selector.openModule('physics', 'mechanics'), true);
  await settlePromises();
  assert.equal(
    bHarness.gateStates.some(item => item.state === 'locked'),
    false,
    'B locked known Physics route must close without exposing its state'
  );
  assert.equal(bHarness.windowObject.location.hash, '#physics');
  assert.equal(bHarness.selector._publicationGateNodes.physics, undefined);
  assert.equal(bHarness.getOwnerInitializations(), 0, 'B locked must initialize no experiment or evidence owner');
  assert.ok(
    productionCalls.some((call) => call.route === '/api/courses' && call.classId === 42),
    'the direct deep link after A→B must query B'
  );
  const productionHidden = createPublicationModuleHarness(productionPublication, {
    initialHash: '#physics/hidden-qa-v7718'
  });
  assert.equal(productionHidden.selector.openModule('physics', 'hidden-qa-v7718'), true);
  await settlePromises();
  assert.equal(productionHidden.windowObject.location.hash, '#physics');
  assert.equal(productionHidden.selector.activeModule.physics, null);
  assert.equal(productionHidden.getOwnerInitializations(), 0);
  assert.equal(
    productionCalls.filter((call) => (
      call.route === '/api/courses/92/unit-access'
      && call.activityKey === 'physics.hidden-qa-v7718'
    )).length,
    1,
    'the production hidden unit omitted from /units must use one exact fallback'
  );
  assert.deepEqual(productionHidden.warnings, []);
  assert.deepEqual(productionHidden.errors, []);
  const productionLocked = createPublicationModuleHarness(productionPublication, {
    initialHash: '#physics/locked-only-unit'
  });
  assert.equal(productionLocked.selector.openModule('physics', 'locked-only-unit'), true);
  await settlePromises();
  assert.equal(productionLocked.windowObject.location.hash, '#physics');
  assert.equal(productionLocked.selector.activeModule.physics, null);
  assert.equal(productionLocked.getOwnerInitializations(), 0);
  assert.equal(
    productionCalls.filter((call) => (
      call.route === '/api/courses/92/unit-access'
      && call.activityKey === 'physics.locked-only-unit'
    )).length,
    1,
    'the production backend-only locked unit must use one exact fallback'
  );
  assert.deepEqual(productionLocked.warnings, []);
  assert.deepEqual(productionLocked.errors, []);
  settleLateA([{ id: 91, galaxy_key: 'englab', course_key: 'physics' }]);
  assert.equal((await lateAResolution).error_code, 'cancelled');
  assert.equal(productionPublication.snapshot().class_id, 42, 'late A must not restore the old class');

  deferNextHiddenUnitAccess = true;
  const pendingUnitAccess = productionPublication.resolve({
    galaxy_key: 'englab',
    course_key: 'physics',
    activity_key: 'physics.hidden-qa-v7718'
  });
  await settlePromises(32);
  assert.equal(typeof settleLateUnitAccess, 'function');
  const pendingUnitAccessCall = productionCalls.findLast((call) => (
    call.route === '/api/courses/92/unit-access'
    && call.activityKey === 'physics.hidden-qa-v7718'
  ));
  assert.equal(pendingUnitAccessCall.signal.aborted, false);
  await classDriver.changeClass('41');
  assert.equal(
    pendingUnitAccessCall.signal.aborted,
    true,
    'class switching must abort an exact unit-access fallback in flight'
  );
  settleLateUnitAccess({ available: false, error_code: 'activity_hidden' });
  assert.equal((await pendingUnitAccess).error_code, 'cancelled');
  assert.equal(productionPublication.snapshot().class_id, 41);

  await classDriver.changeClass('41');
  assert.equal(productionPublication.snapshot().class_id, 41);
  const courseCallsBeforeEmpty = productionCalls.filter((call) => call.route === '/api/courses').length;
  await classDriver.changeClass('');
  assert.equal(productionPublication.snapshot().class_id, null, 'A→empty must clear selectedClassId');
  const emptyHarness = createPublicationModuleHarness(productionPublication);
  assert.equal(emptyHarness.selector.openModule('physics', 'mechanics'), true);
  await settlePromises();
  assert.deepEqual(
    emptyHarness.gateStates.at(-1),
    { state: 'unavailable', code: 'class_selection_required' }
  );
  assert.equal(emptyHarness.getOwnerInitializations(), 0);
  assert.equal(
    productionCalls.filter((call) => call.route === '/api/courses').length,
    courseCallsBeforeEmpty,
    'empty class must fail closed before a course publication request'
  );
  assert.match(
    studentSource,
    /async function refreshClassScope\(\) \{\s*const scope = beginScopeRequest\(\);[\s\S]*publication\.switchClass\(state\.user, state\.selected\.classId, \{ signal: scope\.signal \}\);[\s\S]*if \(!state\.authorized \|\| !state\.selected\.classId\)/,
    'the production class refresh must clear/switch publication authority before the empty-scope early return'
  );

  assert.match(
    physicsCss,
    /#gravity-slider,\s*#restitution-slider,\s*#friction-slider,\s*#radius-slider\s*\{[^}]*height:\s*44px;[^}]*min-height:\s*44px;/,
    'the four mechanics range inputs need a real 44px input box'
  );
  assert.match(
    physicsCss,
    /#physics-clear,\s*#physics-pause\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/,
    'clear and pause need 44px targets'
  );
  assert.match(
    physicsCss,
    /#page-physics \[data-module="mechanics"\] \.demo-section\s*\{[^}]*--experiment-control-height:\s*44px;/,
    'mechanics must override the later shared 34px experiment-control token'
  );
  assert.match(
    physicsCss,
    /\.physics-zoom-btn\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/,
    'the injected mechanics zoom button needs a 44px target'
  );
  assert.match(
    physicsCss,
    /@media \(max-width: 1024px\)\s*\{[\s\S]*?#page-physics \[data-module="mechanics"\] \.demo-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/,
    'the single-column mechanics grid must permit real track shrinkage'
  );
  assert.match(
    physicsCss,
    /@media \(max-width: 1024px\)\s*\{[\s\S]*?#page-physics \[data-module="mechanics"\] \.demo-controls-panel,[\s\S]*?#page-physics \[data-module="mechanics"\] \.demo-visualization\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/,
    'the mechanics controls and visualization must not preserve desktop min-content width'
  );
  assert.match(
    physicsCss,
    /@media \(max-width: 1024px\)\s*\{[\s\S]*?#page-physics \[data-module="mechanics"\] \.physics-canvas\s*\{[^}]*display:\s*block;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/,
    'the mechanics canvas display box must stay inside the shrinkable track'
  );
  assert.match(physicsCss, /\.range::-webkit-slider-runnable-track\s*\{[^}]*height:\s*4px;/);
  assert.match(physicsCss, /\.range::-moz-range-track\s*\{[^}]*height:\s*4px;/);
  assert.match(physicsCss, /\.range:focus-visible\s*\{[^}]*outline:\s*2px solid/);
  assert.match(
    physicsCss,
    /\.physics-publication-gate button\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/,
    'the locked-state safe return action needs a 44px target'
  );
  assert.match(
    fabCss,
    /body:has\(#page-physics\.active \[data-module="mechanics"\]\.module-active\) \.fab-scrim\s*\{[^}]*display:\s*none;/,
    'the mechanics FAB must use a non-modal layout instead of a full-screen hit-test scrim'
  );
  assert.match(
    fabCss,
    /body:has\(#page-physics\.active \[data-module="mechanics"\]\.module-active\) \.fab-trigger,[\s\S]*?left:\s*calc\(224px \+ env\(safe-area-inset-left, 0px\)\);[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/,
    'the mobile mechanics FAB trigger needs a safe-area-aware 44px dock position'
  );
  assert.match(
    fabCss,
    /body:has\(#page-physics\.active \[data-module="mechanics"\]\.module-active\) \.experiment-guide-help-btn,[\s\S]*?min-width:\s*44px;[\s\S]*?min-height:\s*44px;/,
    'every expanded mechanics FAB action needs a 44px target'
  );
  assert.match(
    fabCss,
    /\[data-fab-expanded="false"\][\s\S]*?\.experiment-export-btn\s*\{[^}]*transform:\s*translateY\(12px\) scale\(1\) !important;/,
    'the mobile mechanics dock transition must not shrink an action below its 44px box'
  );
  for (const left of [16, 68, 120, 172]) {
    assert.match(
      fabCss,
      new RegExp(`left:\\s*calc\\(${left}px \\+ env\\(safe-area-inset-left, 0px\\)\\);`),
      `the mechanics FAB dock needs its ${left}px non-overlapping column`
    );
  }
  assert.match(
    ratingCss,
    /\.rating-card--mechanics-inline\s*\{[^}]*position:\s*relative;[^}]*top:\s*auto;[^}]*right:\s*auto;[^}]*bottom:\s*auto;[^}]*left:\s*auto;[^}]*z-index:\s*auto;[^}]*width:\s*fit-content;/,
    'the mechanics rating card must occupy document flow instead of a viewport hit-test layer'
  );
  assert.match(
    ratingSource,
    /moduleId === 'mechanics'[\s\S]*?#page-physics\.active \[data-module="mechanics"\]\.module-active > \.demo-section[\s\S]*?card\.classList\.add\('rating-card--mechanics-inline'\)[\s\S]*?mechanicsHost\.insertBefore\(card, mechanicsLayout \|\| null\)/,
    'the rating owner must mount mechanics scoring before its demo layout'
  );
  assert.match(
    ratingSource,
    /else\s*\{\s*document\.body\.appendChild\(card\);/,
    'non-mechanics ratings must retain the body fallback'
  );
  assert.match(
    moduleSelectorCss,
    /\.module-sidebar-toggle\s*\{[^}]*top:\s*76px;[^}]*left:\s*var\(--space-3\);[^}]*z-index:\s*101;[^}]*width:\s*36px;[^}]*height:\s*36px;/,
    'the reserved rating slot is tied to the current body-level module toggle geometry'
  );
  assert.match(moduleSelectorCss, /\.module-sidebar\s*\{[^}]*z-index:\s*100;/);
  assert.match(moduleSelectorCss, /\.module-sidebar-backdrop\s*\{[^}]*z-index:\s*99;/);
  const navigationLayerSelector =
    'body:has(#page-physics.active [data-module="mechanics"].module-active):has(#sidebar-physics.open)';
  const navigationLayerStart = fabCss.indexOf(navigationLayerSelector);
  const navigationLayerEnd = fabCss.indexOf('}', navigationLayerStart);
  assert.ok(navigationLayerStart >= 0 && navigationLayerEnd > navigationLayerStart);
  const navigationLayerBlock = fabCss.slice(navigationLayerStart, navigationLayerEnd + 1);
  for (const selector of [
    '.fab-trigger',
    '.fab-trigger-halo',
    '.fab-trace',
    '.experiment-guide-help-btn',
    '.favorite-fab',
    '.back-to-top-fab',
    '.experiment-export-btn',
    '.experiment-export-menu',
  ]) {
    assert.ok(
      navigationLayerBlock.includes(selector),
      `open module navigation must layer above ${selector}`
    );
  }
  assert.match(navigationLayerBlock, /z-index:\s*98 !important;/);
  const reducedMotionStart = fabCss.indexOf('@media (prefers-reduced-motion: reduce)');
  const reducedMotionEnd = fabCss.indexOf('}', reducedMotionStart);
  assert.ok(reducedMotionStart >= 0 && reducedMotionEnd > reducedMotionStart);
  const reducedMotionBlock = fabCss.slice(reducedMotionStart, reducedMotionEnd + 1);
  for (const selector of [
    '.fab-trigger.is-rippling::before',
    '.experiment-guide-help-btn.is-rippling::before',
    '.favorite-fab.is-rippling::before',
    '.back-to-top-fab.is-rippling::before',
  ]) {
    assert.ok(
      reducedMotionBlock.includes(selector),
      `reduced motion must suppress ${selector}`
    );
  }
  assert.match(reducedMotionBlock, /animation:\s*none !important;/);
  assert.match(ratingCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.rating-card/);

  console.log('learning-evidence-a03a-contract: release states, production Router diagnostics, guarded deep link, 44px controls, and non-overlap dock ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
