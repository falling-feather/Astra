const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'shared/js/module-selector.js'), 'utf8');
const routerSource = fs.readFileSync(path.join(root, 'shared/js/router.js'), 'utf8');
const guideSource = fs.readFileSync(path.join(root, 'shared/js/experiment-guide.js'), 'utf8');

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach(name => this.values.add(name)); }
  remove(...names) { names.forEach(name => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.contains(name) : Boolean(force);
    if (enabled) this.add(name); else this.remove(name);
    return enabled;
  }
}

class FakeSection {
  constructor(id) {
    this.dataset = { module: id };
    this.classList = new FakeClassList();
    this.focusTarget = { focusCalls: 0, focus() { this.focusCalls += 1; } };
  }
  querySelector() { return this.focusTarget; }
}

class FakePage {
  constructor(sections) {
    this.sections = sections;
    this.classList = new FakeClassList();
    this.related = [];
  }
  querySelectorAll(selector) {
    const exact = selector.match(/^\[data-module="([^"]+)"\](\.module-active)?$/);
    if (exact) {
      const section = this.sections[exact[1]];
      if (!section || (exact[2] && !section.classList.contains('module-active'))) return [];
      return [section];
    }
    if (selector === '[data-module].module-active') {
      return Object.values(this.sections).filter(section => section.classList.contains('module-active'));
    }
    if (selector === '.related-experiments') return this.related;
    return [];
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function createTimers() {
  let nextId = 1;
  const tasks = new Map();
  return {
    tasks,
    setTimeout(callback, delay) {
      const id = nextId++;
      tasks.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { tasks.delete(id); },
    async runNext() {
      const next = tasks.entries().next().value;
      if (!next) return false;
      const [id, task] = next;
      tasks.delete(id);
      task.callback();
      await Promise.resolve();
      return true;
    },
    async drain(limit = 100) {
      let count = 0;
      while (count < limit && await this.runNext()) count += 1;
      assert.equal(tasks.size, 0, 'timer harness must settle within its safety limit');
    }
  };
}

function createHarness() {
  const order = [];
  const warnings = [];
  const timers = createTimers();
  const sections = {
    mechanics: new FakeSection('mechanics'),
    'gas-laws': new FakeSection('gas-laws'),
    waves: new FakeSection('waves')
  };
  const page = new FakePage(sections);
  const gallery = { style: { display: 'none' } };
  const toggle = { style: {}, classList: new FakeClassList() };
  const definitions = {
    mechanics: { cleanup: { verified: true } },
    'gas-laws': { cleanup: { verified: true } },
    waves: { cleanup: { verified: false } }
  };
  const cleanupOutcomes = { mechanics: 'cleaned', 'gas-laws': 'cleaned' };
  const cleanupCalls = [];
  const pageCleanupReport = { attempted: 3, executed: 2, failed: 0 };
  let pageCleanupCalls = 0;
  let initCalls = 0;
  const registry = {
    get: (_page, id) => definitions[id] || null,
    cleanupModule: (subject, id) => {
      order.push(`cleanup:${subject}:${id}`);
      cleanupCalls.push(`${subject}:${id}`);
      const outcome = cleanupOutcomes[id] || 'owner-unavailable';
      return Object.freeze({
        outcome,
        eligible: 1,
        skipped: 0,
        attempted: 1,
        executed: outcome === 'cleaned' ? 1 : 0,
        failed: outcome === 'failed' ? 1 : 0
      });
    },
    cleanupPage: (subject) => {
      order.push(`cleanup-page:${subject}`);
      pageCleanupCalls += 1;
      return Object.freeze({ ...pageCleanupReport });
    },
    init: (_page, id) => {
      order.push(`registry-init:${id}`);
      initCalls += 1;
      return true;
    },
    scriptFor: () => null
  };
  const backend = {
    destroyExperimentSchema(subject, id) { order.push(`schema-destroy:${subject}:${id}`); },
    applyExperimentSchema(subject, id) { order.push(`schema-apply:${subject}:${id}`); }
  };
  const zoom = {
    close() { order.push('zoom-close'); },
    init() { order.push('zoom-init'); }
  };
  const windowObject = {
    innerWidth: 1280,
    location: { hash: '#physics/mechanics' },
    scrollTo() {},
    dispatchEvent(event) { order.push(`event:${event.type}`); },
    AstraExperimentRegistry: registry,
    BackendContent: backend,
    PhysicsZoom: zoom,
    AstraLearningEvidenceActivity: {
      mount() {},
      destroyWithin() { order.push('evidence-destroy'); }
    },
    AstraLearningEvidenceLoader: {
      ensure() { return Promise.resolve(); },
      clearDomainCommands() { order.push('evidence-clear'); }
    }
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
      body: { appendChild() {} }
    },
    history: {
      replaceState(_state, _title, hash) {
        windowObject.location.hash = hash;
        order.push(`hash:${hash}`);
      }
    },
    Event: class { constructor(type) { this.type = type; } },
    CONFIG: { experiments: { physics: Object.keys(sections).map(id => ({ id })) } },
    BackendContent: backend,
    setTimeout: (callback, delay) => timers.setTimeout(callback, delay),
    clearTimeout: id => timers.clearTimeout(id),
    console: {
      log() {},
      error() {},
      warn(...args) { warnings.push(args); }
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'shared/js/module-selector.js' });
  const selector = vm.runInContext('ModuleSelector', context);
  selector._transitionGeneration.physics = 0;
  selector._transitionTimers.physics = [];
  selector._sidebars.physics = null;
  selector._sidebarOpen.physics = false;
  return {
    selector, sections, page, gallery, toggle, registry, backend, zoom, windowObject, context,
    cleanupOutcomes, cleanupCalls, pageCleanupReport, timers, order, warnings,
    getPageCleanupCalls: () => pageCleanupCalls,
    getInitCalls: () => initCalls
  };
}

function activate(harness, id, initialized = true) {
  Object.values(harness.sections).forEach(section => section.classList.remove('module-active'));
  harness.sections[id].classList.add('module-active');
  harness.selector.activeModule.physics = id;
  harness.gallery.style.display = 'none';
  harness.page.classList.remove('module-gallery-active');
  if (initialized) harness.selector._initialized[`physics:${id}`] = true;
}

(async () => {
  const success = createHarness();
  activate(success, 'mechanics');
  success.selector._initModule = (page, id) => success.order.push(`init:${page}:${id}`);
  success.selector._focusExperiment = () => {};
  assert.equal(success.selector.openModule('physics', 'gas-laws'), true);
  assert.ok(success.order.indexOf('zoom-close') < success.order.indexOf('cleanup:physics:mechanics'));
  assert.ok(success.order.indexOf('cleanup:physics:mechanics') < success.order.indexOf('evidence-destroy'));
  assert.ok(success.order.indexOf('cleanup:physics:mechanics') < success.order.indexOf('schema-destroy:physics:mechanics'));
  assert.ok(success.order.indexOf('schema-destroy:physics:mechanics') < success.order.indexOf('init:physics:gas-laws'));
  assert.equal(success.selector._initialized['physics:mechanics'], undefined);
  assert.equal(success.selector.activeModule.physics, 'gas-laws');
  assert.equal(success.sections.mechanics.classList.contains('module-active'), false);
  assert.equal(success.sections['gas-laws'].classList.contains('module-active'), true);
  assert.equal(success.gallery.style.display, 'none');
  assert.equal(success.selector.activeModule.physics, 'gas-laws');
  assert.equal(success.windowObject.location.hash, '#physics/gas-laws');

  success.selector._initialized['physics:gas-laws'] = true;
  assert.equal(success.selector.closeModule('physics'), true);
  assert.equal(success.selector._initialized['physics:gas-laws'], undefined);
  assert.equal(success.selector.activeModule.physics, null);
  assert.equal(success.gallery.style.display, '');
  assert.equal(success.windowObject.location.hash, '#physics');
  assert.equal(success.cleanupCalls.filter(key => key === 'physics:gas-laws').length, 1);
  assert.equal(success.selector.openModule('physics', 'mechanics'), true);
  assert.ok(success.order.includes('init:physics:mechanics'), 'gallery to verified module must initialize again');

  const legacy = createHarness();
  activate(legacy, 'waves');
  legacy.selector._initModule = () => {};
  legacy.selector._focusExperiment = () => {};
  assert.equal(legacy.selector.openModule('physics', 'gas-laws'), true);
  assert.equal(legacy.cleanupCalls.length, 0, 'legacy switch must not execute exact cleanup');
  assert.equal(legacy.selector._initialized['physics:waves'], true, 'legacy init marker must remain fail closed');
  assert.equal(legacy.order.filter(item => item === 'zoom-close').length, 1, 'shared zoom must still close for legacy UI isolation');

  const invalid = createHarness();
  activate(invalid, 'mechanics');
  invalid.selector._scheduleModuleTask('physics', 'mechanics', 0, 200, () => invalid.order.push('preserved-task'));
  assert.equal(invalid.selector.openModule('physics', 'not-found'), false);
  assert.equal(invalid.cleanupCalls.length, 0, 'invalid target must be rejected before current cleanup');
  assert.equal(invalid.selector._transitionGeneration.physics, 0, 'invalid target must not advance generation');
  assert.equal(invalid.timers.tasks.size, 1, 'invalid target must preserve current module tasks');
  assert.equal(invalid.selector.activeModule.physics, 'mechanics');

  const failed = createHarness();
  activate(failed, 'mechanics');
  failed.selector._scheduleModuleTask('physics', 'mechanics', 0, 200, () => failed.order.push('preserved-task'));
  failed.cleanupOutcomes.mechanics = 'owner-unavailable';
  failed.selector._initModule = () => failed.order.push('unexpected-init');
  failed.selector._focusExperiment = () => failed.order.push('unexpected-focus');
  assert.equal(failed.selector.openModule('physics', 'gas-laws'), false);
  assert.equal(failed.selector.activeModule.physics, 'mechanics');
  assert.equal(failed.sections.mechanics.classList.contains('module-active'), true);
  assert.equal(failed.sections['gas-laws'].classList.contains('module-active'), false);
  assert.equal(failed.selector._initialized['physics:mechanics'], true);
  assert.equal(failed.order.includes('evidence-destroy'), false, 'failed owner cleanup must preserve the evidence controller');
  assert.equal(failed.order.some(item => item.startsWith('schema-destroy')), false);
  assert.equal(failed.order.includes('unexpected-init'), false);
  assert.equal(failed.selector._transitionGeneration.physics, 0, 'failed cleanup must not advance generation');
  assert.equal(failed.timers.tasks.size, 1, 'failed cleanup must preserve current module tasks');

  const zoomFailed = createHarness();
  activate(zoomFailed, 'mechanics');
  zoomFailed.zoom.close = () => { throw new Error('zoom probe'); };
  assert.equal(zoomFailed.selector.openModule('physics', 'gas-laws'), false);
  assert.equal(zoomFailed.cleanupCalls.length, 0, 'cleanup must not run after zoom close failure');
  assert.equal(zoomFailed.selector.activeModule.physics, 'mechanics');

  const stale = createHarness();
  activate(stale, 'mechanics', false);
  const generation = stale.selector._beginModuleTransition('physics');
  let resolveAssets;
  stale.selector._loadModuleAssets = () => new Promise(resolve => { resolveAssets = resolve; });
  stale.selector._showModuleTools = () => stale.order.push('tools');
  stale.selector._initModule('physics', 'mechanics', generation);
  stale.selector._beginModuleTransition('physics');
  stale.selector.activeModule.physics = null;
  resolveAssets();
  await Promise.resolve();
  await Promise.resolve();
  await stale.timers.drain();
  assert.equal(stale.getInitCalls(), 0, 'stale asset resolution must not initialize');
  assert.equal(stale.selector._initialized['physics:mechanics'], undefined);
  assert.equal(stale.order.includes('tools'), false);

  const retry = createHarness();
  activate(retry, 'mechanics', false);
  const retryGeneration = retry.selector._beginModuleTransition('physics');
  retry.selector._loadModuleAssets = () => Promise.resolve();
  let retryInitCalls = 0;
  retry.registry.init = () => { retryInitCalls += 1; return false; };
  retry.selector._initModule('physics', 'mechanics', retryGeneration);
  await Promise.resolve();
  await Promise.resolve();
  await retry.timers.runNext();
  assert.equal(retryInitCalls, 1);
  assert.equal(retry.timers.tasks.size, 1, 'failed init must schedule one guarded retry');
  retry.selector._beginModuleTransition('physics');
  retry.selector.activeModule.physics = 'gas-laws';
  await retry.timers.drain();
  assert.equal(retryInitCalls, 1, 'stale retry must not execute after a transition');

  const dirty = createHarness();
  activate(dirty, 'mechanics', false);
  const dirtyGeneration = dirty.selector._beginModuleTransition('physics');
  dirty.selector._loadModuleAssets = () => Promise.resolve();
  dirty.registry.init = () => { throw new Error('partial init'); };
  dirty.selector._initModule('physics', 'mechanics', dirtyGeneration);
  await Promise.resolve();
  await Promise.resolve();
  await dirty.timers.drain();
  assert.equal(dirty.selector._runtimeDirty['physics:mechanics'], true, 'verified init failure must mark runtime dirty');
  dirty.selector._initModule = () => {};
  dirty.selector._focusExperiment = () => {};
  assert.equal(dirty.selector.openModule('physics', 'gas-laws'), true);
  assert.equal(dirty.cleanupCalls.filter(key => key === 'physics:mechanics').length, 1, 'dirty runtime must use exact cleanup');
  assert.equal(dirty.selector._runtimeDirty['physics:mechanics'], undefined);

  const legacyDirty = createHarness();
  activate(legacyDirty, 'waves', false);
  const legacyDirtyGeneration = legacyDirty.selector._beginModuleTransition('physics');
  legacyDirty.selector._loadModuleAssets = () => Promise.resolve();
  legacyDirty.registry.init = () => { throw new Error('legacy partial init'); };
  legacyDirty.selector._initModule('physics', 'waves', legacyDirtyGeneration);
  await Promise.resolve();
  await Promise.resolve();
  await legacyDirty.timers.drain();
  assert.equal(legacyDirty.selector._runtimeDirty['physics:waves'], true, 'legacy init failure must mark runtime dirty');
  let legacyReinitCalls = 0;
  legacyDirty.registry.init = () => { legacyReinitCalls += 1; return true; };
  legacyDirty.selector._showModuleTools = () => {};
  legacyDirty.selector._initModule('physics', 'waves', legacyDirtyGeneration);
  await Promise.resolve();
  await legacyDirty.timers.drain();
  assert.equal(legacyReinitCalls, 0, 'legacy dirty runtime must not initialize again before page cleanup');

  const focus = createHarness();
  activate(focus, 'mechanics');
  const detachedFocusTarget = focus.sections.mechanics.focusTarget;
  focus.selector._focusExperiment('physics', 'mechanics', focus.selector._transitionGeneration.physics);
  const currentFocusTarget = { focusCalls: 0, focus() { this.focusCalls += 1; } };
  focus.sections.mechanics.focusTarget = currentFocusTarget;
  await focus.timers.drain();
  assert.equal(detachedFocusTarget.focusCalls, 0, 'focus must not target a node replaced by backend schema');
  assert.equal(currentFocusTarget.focusCalls, 1, 'focus target must be resolved from the current module DOM');

  const schemaFocus = createHarness();
  activate(schemaFocus, 'mechanics');
  let settleSchema;
  const schemaReady = new Promise(resolve => { settleSchema = resolve; });
  const preSchemaTarget = schemaFocus.sections.mechanics.focusTarget;
  schemaFocus.selector._focusExperiment('physics', 'mechanics', 0, schemaReady);
  await schemaFocus.timers.runNext();
  assert.equal(preSchemaTarget.focusCalls, 1);
  const postSchemaTarget = { focusCalls: 0, focus() { this.focusCalls += 1; } };
  schemaFocus.sections.mechanics.focusTarget = postSchemaTarget;
  settleSchema();
  await Promise.resolve();
  await Promise.resolve();
  await schemaFocus.timers.drain();
  assert.equal(postSchemaTarget.focusCalls, 1, 'schema settlement must refocus the current replacement DOM when focus was lost');

  const related = createHarness();
  activate(related, 'mechanics');
  let relatedShowCalls = 0;
  related.selector._showRelatedExperiments('physics', 'mechanics', 0);
  await related.timers.runNext();
  assert.equal(related.timers.tasks.size, 1, 'related panel must retry while deferred support is unavailable');
  related.context.RelatedExperiments = { show() { relatedShowCalls += 1; } };
  await related.timers.drain();
  assert.equal(relatedShowCalls, 1, 'related panel must render once deferred support becomes ready');

  const leave = createHarness();
  activate(leave, 'mechanics');
  leave.selector.resetPage = () => leave.order.push('reset');
  const leaveReport = leave.selector.leavePage('physics', { preserveHash: true });
  assert.equal(leave.cleanupCalls.length, 0, 'page leave must skip exact module cleanup');
  assert.equal(leave.getPageCleanupCalls(), 1);
  assert.equal(leave.order.filter(item => item === 'zoom-close').length, 1);
  assert.ok(leave.order.indexOf('schema-destroy:physics:mechanics') < leave.order.indexOf('zoom-close'));
  assert.ok(leave.order.indexOf('zoom-close') < leave.order.indexOf('cleanup-page:physics'));
  assert.ok(leave.order.indexOf('cleanup-page:physics') < leave.order.indexOf('evidence-destroy'));
  assert.ok(leave.order.indexOf('cleanup-page:physics') < leave.order.indexOf('reset'));
  assert.equal(leaveReport.executed, 2);

  const leaveFailed = createHarness();
  activate(leaveFailed, 'mechanics');
  leaveFailed.pageCleanupReport.executed = 1;
  leaveFailed.pageCleanupReport.failed = 1;
  leaveFailed.selector.resetPage = () => leaveFailed.order.push('reset');
  const leaveFailedReport = leaveFailed.selector.leavePage('physics', { preserveHash: true });
  assert.equal(leaveFailedReport.failed, 1);
  assert.equal(
    leaveFailed.order.includes('evidence-destroy'),
    false,
    'page cleanup failure must preserve the evidence controller instead of committing a half-state'
  );

  const routeTimers = createTimers();
  const routeHistory = [];
  let activeRoutePage = 'physics';
  const routeWindow = {
    AstraPageRegistry: {
      pagesByTag(tag) { return tag === 'course' ? ['physics'] : []; }
    },
    location: { hash: '#physics/not-found' }
  };
  const routeModuleSelector = {
    activeModule: { physics: 'mechanics' },
    openModule() { return false; }
  };
  const routeContext = {
    window: routeWindow,
    ModuleSelector: routeModuleSelector,
    document: {
      querySelector(selector) {
        return selector === '.page.active' ? { id: `page-${activeRoutePage}` } : null;
      }
    },
    history: {
      replaceState(_state, _title, hash) {
        routeWindow.location.hash = hash;
        routeHistory.push(hash);
      }
    },
    setTimeout: (callback, delay) => routeTimers.setTimeout(callback, delay),
    clearTimeout: id => routeTimers.clearTimeout(id),
    setInterval() { return 1; },
    clearInterval() {},
    console: { log() {}, warn() {}, error() {} }
  };
  vm.createContext(routeContext);
  vm.runInContext(routerSource, routeContext, { filename: 'shared/js/router.js' });
  const router = vm.runInContext('Router', routeContext);
  router.currentPage = 'physics';
  router._pendingModule = 'not-found';
  router._applyPendingModule('physics');
  await routeTimers.drain();
  assert.equal(router._pendingModule, null);
  assert.equal(routeWindow.location.hash, '#physics/mechanics', 'failed deep link must restore active module route');
  assert.deepEqual(routeHistory, ['#physics/mechanics']);
  assert.match(routerSource, /if \(!closed\) \{\s*this\._restoreModuleRoute\(page\);\s*return;/);

  let staleOpenCalls = 0;
  routeModuleSelector.openModule = () => { staleOpenCalls += 1; return false; };
  routeWindow.location.hash = '#physics/not-found';
  router._pendingModule = 'not-found';
  router._applyPendingModule('physics');
  router.currentPage = 'chemistry';
  activeRoutePage = 'chemistry';
  routeWindow.location.hash = '#chemistry';
  await routeTimers.drain();
  assert.equal(staleOpenCalls, 0, 'stale pending module must not open on a different page');
  assert.equal(routeWindow.location.hash, '#chemistry', 'stale pending module must not restore an old subject route');

  const guideTimers = createTimers();
  const guideFocusTarget = { focusCalls: 0, focus() { this.focusCalls += 1; } };
  const guideSection = { querySelector() { return guideFocusTarget; } };
  const guideContext = {
    window: {},
    document: {
      querySelector(selector) {
        return selector === '#page-physics [data-module="mechanics"].module-active' ? guideSection : null;
      }
    },
    setTimeout: (callback, delay) => guideTimers.setTimeout(callback, delay),
    clearTimeout: id => guideTimers.clearTimeout(id),
    console: { log() {}, warn() {}, error() {} }
  };
  vm.createContext(guideContext);
  vm.runInContext(guideSource, guideContext, { filename: 'shared/js/experiment-guide.js' });
  const guide = vm.runInContext('ExperimentGuide', guideContext);
  guide._overlay = { classList: new FakeClassList() };
  guide._overlay.classList.add('active');
  guide._currentModule = { page: 'physics', moduleId: 'mechanics' };
  const hiddenDismissTarget = { focusCalls: 0, focus() { this.focusCalls += 1; } };
  guide._focusTimer = guideTimers.setTimeout(() => hiddenDismissTarget.focus(), 100);
  guide._dismiss({ restoreFocus: true });
  await guideTimers.drain();
  assert.equal(hiddenDismissTarget.focusCalls, 0, 'dismiss must cancel delayed focus on the hidden guide button');
  assert.equal(guideFocusTarget.focusCalls, 1, 'dismissing the guide must restore focus to the active module');
  assert.match(guideSource, /e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*this\._dismiss\(\{ restoreFocus: true \}\);/);

  console.log('module-switch-lifecycle-contract: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
