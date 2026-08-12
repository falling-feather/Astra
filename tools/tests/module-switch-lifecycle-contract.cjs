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
    AbortController,
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

async function settlePromises(rounds = 8) {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

function configureStudentPublication(harness, access) {
  harness.publicationSignals = [];
  harness.windowObject.AstraApplicationSession = {
    getUser: () => ({ id: 7, role: 'student' })
  };
  harness.windowObject.AstraEngineeringLabPublicationContext = {
    resolve: (activity, options = {}) => {
      harness.publicationSignals.push(options.signal);
      return Promise.resolve(
        typeof access === 'function' ? access(activity, options) : access
      );
    }
  };
  harness.selector._renderPublicationGate = (page, _pageEl, state, code = '') => {
    delete harness.selector._publicationGateNodes[page];
    harness.selector._publicationGateNodes[page] = { state, code };
    harness.order.push(`publication-gate:${state}:${code}`);
  };
  harness.selector._clearPublicationGate = (page) => {
    delete harness.selector._publicationGateNodes[page];
    harness.order.push('publication-gate:clear');
  };
  harness.selector._focusExperiment = () => {};
  harness.selector._showRelatedExperiments = () => {};
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

  const lockedPublication = createHarness();
  activate(lockedPublication, 'mechanics');
  configureStudentPublication(lockedPublication, {
    available: false,
    error_code: 'activity_locked'
  });
  lockedPublication.selector._initModule = () => lockedPublication.order.push('unexpected-locked-init');
  lockedPublication.selector._loadModuleAssets = () => {
    lockedPublication.order.push('unexpected-locked-assets');
    return Promise.resolve();
  };
  lockedPublication.selector._mountEvidenceRuntime = () => lockedPublication.order.push('unexpected-locked-evidence');
  assert.equal(lockedPublication.selector.openModule('physics', 'mechanics'), true);
  assert.equal(
    lockedPublication.cleanupCalls.filter(key => key === 'physics:mechanics').length,
    1,
    'a publication recheck must synchronously release an already running mechanics owner'
  );
  assert.equal(lockedPublication.selector.activeModule.physics, null);
  assert.equal(lockedPublication.sections.mechanics.classList.contains('module-active'), false);
  assert.ok(lockedPublication.order.includes('evidence-destroy'));
  await settlePromises();
  assert.equal(lockedPublication.order.includes('unexpected-locked-init'), false);
  assert.equal(lockedPublication.order.includes('unexpected-locked-assets'), false);
  assert.equal(lockedPublication.order.includes('unexpected-locked-evidence'), false);
  assert.equal(
    lockedPublication.order.some(item => item === 'publication-gate:locked:activity_locked'),
    false,
    'known locked Physics routes must close silently without exposing their state'
  );
  assert.equal(lockedPublication.selector._publicationGateNodes.physics, undefined);
  assert.equal(lockedPublication.windowObject.location.hash, '#physics');
  assert.equal(lockedPublication.selector._initialized['physics:mechanics'], undefined);

  const openPublication = createHarness();
  configureStudentPublication(openPublication, {
    available: true,
    class_id: 12,
    course_id: 23,
    course_unit_id: 34,
    activity_key: 'physics.mechanics'
  });
  openPublication.selector._initModule = (page, id) => openPublication.order.push(`guarded-init:${page}:${id}`);
  assert.equal(openPublication.selector.openModule('physics', 'mechanics'), true);
  assert.equal(openPublication.selector.activeModule.physics, null, 'owner must stay stopped while publication state is pending');
  assert.equal(openPublication.order.includes('guarded-init:physics:mechanics'), false);
  await settlePromises();
  assert.equal(openPublication.selector.activeModule.physics, 'mechanics');
  assert.equal(openPublication.sections.mechanics.classList.contains('module-active'), true);
  assert.ok(openPublication.order.includes('guarded-init:physics:mechanics'), 'open publication state must preserve the teaching runtime path');

  const hiddenPublication = createHarness();
  configureStudentPublication(hiddenPublication, {
    available: false,
    error_code: 'activity_hidden'
  });
  hiddenPublication.selector._initModule = () => hiddenPublication.order.push('unexpected-hidden-init');
  assert.equal(hiddenPublication.selector.openModule('physics', 'mechanics'), true);
  await settlePromises();
  assert.equal(hiddenPublication.selector.activeModule.physics, null);
  assert.equal(hiddenPublication.order.includes('unexpected-hidden-init'), false);
  assert.equal(hiddenPublication.sections.mechanics.classList.contains('module-active'), false);
  assert.equal(hiddenPublication.gallery.style.display, '');
  assert.equal(hiddenPublication.windowObject.location.hash, '#physics', 'hidden activity must normalize back to the undiscoverable gallery route');
  assert.equal(hiddenPublication.selector._isUndiscoverablePublicationAccess('activity_hidden'), true);
  assert.equal(hiddenPublication.selector._isUndiscoverablePublicationAccess('course_scope_missing'), true);
  assert.equal(hiddenPublication.selector._isUndiscoverablePublicationAccess('course_unit_missing'), false);
  assert.equal(hiddenPublication.selector._isUndiscoverablePublicationAccess('course_scope_ambiguous'), false);

  const missingPublication = createHarness();
  configureStudentPublication(missingPublication, {
    available: false,
    error_code: 'course_unit_missing'
  });
  missingPublication.selector._initModule = () => missingPublication.order.push('unexpected-missing-init');
  assert.equal(missingPublication.selector.openModule('physics', 'mechanics'), true);
  await settlePromises();
  assert.equal(missingPublication.selector.activeModule.physics, null);
  assert.equal(missingPublication.order.includes('unexpected-missing-init'), false);
  assert.equal(missingPublication.windowObject.location.hash, '#physics');
  assert.deepEqual(
    missingPublication.warnings,
    [['[ModuleSelector] refusing transition to unknown module']],
    'a real missing unit must retain one fixed safe diagnostic'
  );

  let settlePendingAccess;
  const pendingAccess = new Promise(resolve => { settlePendingAccess = resolve; });
  const pendingSwitch = createHarness();
  configureStudentPublication(pendingSwitch, activity => (
    activity.activity_key === 'physics.mechanics'
      ? pendingAccess
      : {
          available: true,
          class_id: 12,
          course_id: 23,
          course_unit_id: 35,
          activity_key: activity.activity_key
        }
  ));
  pendingSwitch.selector._initModule = (page, id) => pendingSwitch.order.push(`pending-switch-init:${page}:${id}`);
  assert.equal(pendingSwitch.selector.openModule('physics', 'mechanics'), true);
  assert.ok(pendingSwitch.selector._publicationGatePending.physics);
  assert.equal(
    pendingSwitch.selector._publicationGateNodes.physics,
    undefined,
    'authority checks stay behind the discoverable list instead of rendering a course gate'
  );
  const pendingSwitchSignal = pendingSwitch.selector._publicationGatePending.physics.controller.signal;
  assert.equal(pendingSwitchSignal.aborted, false);
  assert.equal(pendingSwitch.selector.openModule('physics', 'gas-laws'), true);
  assert.equal(pendingSwitchSignal.aborted, true);
  assert.equal(pendingSwitch.selector.activeModule.physics, null);
  assert.equal(pendingSwitch.sections['gas-laws'].classList.contains('module-active'), false);
  await settlePromises();
  assert.equal(pendingSwitch.selector._publicationGatePending.physics, undefined);
  assert.equal(pendingSwitch.selector._publicationGateNodes.physics, undefined);
  assert.equal(pendingSwitch.selector.activeModule.physics, 'gas-laws');
  assert.equal(pendingSwitch.sections['gas-laws'].classList.contains('module-active'), true);
  settlePendingAccess({ available: false, error_code: 'activity_locked' });
  await settlePromises();
  assert.equal(pendingSwitch.selector.activeModule.physics, 'gas-laws');
  assert.equal(pendingSwitch.selector._publicationGateNodes.physics, undefined);
  assert.equal(
    pendingSwitch.order.filter(item => item === 'publication-gate:locked:activity_locked').length,
    0,
    'a stale publication result must not reattach a gate over the newer module'
  );

  let settlePendingClose;
  const pendingClose = createHarness();
  configureStudentPublication(pendingClose, new Promise(resolve => { settlePendingClose = resolve; }));
  assert.equal(pendingClose.selector.openModule('physics', 'mechanics'), true);
  assert.equal(pendingClose.selector.openModule('physics', 'mechanics'), true);
  assert.equal(
    pendingClose.order.filter(item => item === 'publication-gate:checking:').length,
    0,
    'reopening the same pending module must keep authority work invisible'
  );
  const pendingCloseSignal = pendingClose.selector._publicationGatePending.physics.controller.signal;
  assert.equal(pendingCloseSignal.aborted, false);
  assert.equal(pendingClose.selector.closeModule('physics'), true);
  assert.equal(pendingCloseSignal.aborted, true, 'close must abort known publication work');
  assert.equal(pendingClose.selector._publicationGatePending.physics, undefined);
  assert.equal(pendingClose.selector._publicationGateNodes.physics, undefined);
  settlePendingClose({ available: true });
  await settlePromises();
  assert.equal(pendingClose.selector.activeModule.physics, null);

  let settlePendingReset;
  const pendingReset = createHarness();
  configureStudentPublication(pendingReset, new Promise(resolve => { settlePendingReset = resolve; }));
  assert.equal(pendingReset.selector.openModule('physics', 'mechanics'), true);
  const pendingResetSignal = pendingReset.selector._publicationGatePending.physics.controller.signal;
  assert.equal(pendingResetSignal.aborted, false);
  pendingReset.selector.resetPage('physics');
  assert.equal(pendingResetSignal.aborted, true, 'reset must abort known publication work');
  assert.equal(pendingReset.selector._publicationGatePending.physics, undefined);
  assert.equal(pendingReset.selector._publicationGateNodes.physics, undefined);
  settlePendingReset({ available: true });
  await settlePromises();
  assert.equal(pendingReset.selector.activeModule.physics, null);

  let settlePendingLeave;
  const pendingLeave = createHarness();
  configureStudentPublication(pendingLeave, new Promise(resolve => { settlePendingLeave = resolve; }));
  assert.equal(pendingLeave.selector.openModule('physics', 'mechanics'), true);
  const pendingLeaveSignal = pendingLeave.selector._publicationGatePending.physics.controller.signal;
  assert.equal(pendingLeaveSignal.aborted, false);
  pendingLeave.selector.leavePage('physics', { preserveHash: true });
  assert.equal(pendingLeaveSignal.aborted, true, 'leave must abort known publication work');
  assert.equal(pendingLeave.selector._publicationGatePending.physics, undefined);
  assert.equal(pendingLeave.selector._publicationGateNodes.physics, undefined);
  settlePendingLeave({ available: true });
  await settlePromises();
  assert.equal(pendingLeave.selector.activeModule.physics, null);
  assert.deepEqual(pendingLeave.warnings, []);

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

  const coldBindingOrder = createHarness();
  let coldOwnerReady = false;
  let coldInitCalls = 0;
  let coldMountCalls = 0;
  let resolveColdAssets;
  coldBindingOrder.selector._loadModuleAssets = () => new Promise(resolve => { resolveColdAssets = resolve; });
  coldBindingOrder.registry.init = () => {
    coldInitCalls += 1;
    coldBindingOrder.order.push('cold-owner-init');
    coldOwnerReady = true;
    return true;
  };
  coldBindingOrder.selector._mountEvidenceRuntime = () => {
    coldMountCalls += 1;
    coldBindingOrder.order.push(coldOwnerReady ? 'cold-evidence-mount' : 'cold-evidence-before-owner');
  };
  coldBindingOrder.selector._focusExperiment = () => {};
  coldBindingOrder.selector._showRelatedExperiments = () => {};
  assert.equal(coldBindingOrder.selector.openModule('physics', 'mechanics'), true);
  assert.equal(coldBindingOrder.selector.openModule('physics', 'mechanics'), true);
  await settlePromises();
  assert.equal(coldMountCalls, 0, 'cold mechanics evidence must wait while owner assets are loading');
  resolveColdAssets();
  await settlePromises();
  await coldBindingOrder.timers.drain();
  assert.equal(coldInitCalls, 1, 'cold mechanics entry must initialize the owner once');
  assert.equal(
    coldMountCalls,
    1,
    'cold mechanics entry must mount one evidence runtime'
  );
  assert.equal(
    coldBindingOrder.order.includes('cold-evidence-before-owner'),
    false,
    'cold mechanics entry must not mount evidence before the owner initializes'
  );
  assert.ok(
    coldBindingOrder.order.indexOf('cold-owner-init') < coldBindingOrder.order.indexOf('cold-evidence-mount'),
    'cold mechanics owner initialization must complete before evidence binding starts'
  );

  const reloadBindingOrder = createHarness();
  let reloadEvidenceReady = false;
  let reloadInitCalls = 0;
  let reloadMountCalls = 0;
  reloadBindingOrder.selector._loadModuleAssets = () => Promise.resolve();
  reloadBindingOrder.registry.init = () => {
    reloadInitCalls += 1;
    reloadBindingOrder.order.push('reload-owner-init-reset');
    reloadEvidenceReady = false;
    return true;
  };
  reloadBindingOrder.selector._mountEvidenceRuntime = () => {
    reloadMountCalls += 1;
    reloadBindingOrder.order.push('reload-evidence-bind');
    reloadEvidenceReady = true;
  };
  reloadBindingOrder.selector._focusExperiment = () => {};
  reloadBindingOrder.selector._showRelatedExperiments = () => {};
  assert.equal(reloadBindingOrder.selector.openModule('physics', 'mechanics'), true);
  assert.equal(reloadBindingOrder.selector.openModule('physics', 'mechanics'), true);
  await settlePromises();
  await reloadBindingOrder.timers.drain();
  assert.equal(reloadInitCalls, 1, 'cached mechanics entry must initialize the owner once');
  assert.equal(reloadMountCalls, 1, 'reload mechanics entry must mount one evidence runtime');
  assert.equal(reloadEvidenceReady, true, 'late owner initialization must not erase an established evidence binding');
  assert.ok(
    reloadBindingOrder.order.indexOf('reload-owner-init-reset') < reloadBindingOrder.order.indexOf('reload-evidence-bind'),
    'reload mechanics owner reset must finish before evidence binding starts'
  );

  const initializedCompletion = createHarness();
  activate(initializedCompletion, 'mechanics');
  let initializedCompletionCalls = 0;
  initializedCompletion.selector._initModule('physics', 'mechanics', 0, () => {
    initializedCompletionCalls += 1;
  });
  assert.equal(initializedCompletionCalls, 1, 'an initialized current owner must complete synchronously');
  assert.equal(initializedCompletion.getInitCalls(), 0, 'an initialized owner must not initialize twice');

  const dirtyCompletion = createHarness();
  activate(dirtyCompletion, 'mechanics', false);
  dirtyCompletion.selector._runtimeDirty['physics:mechanics'] = true;
  let dirtyCompletionCalls = 0;
  dirtyCompletion.selector._initModule('physics', 'mechanics', 0, () => {
    dirtyCompletionCalls += 1;
  });
  assert.equal(dirtyCompletionCalls, 0, 'a dirty owner must not authorize evidence mounting');

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
  let staleCompletionCalls = 0;
  stale.selector._initModule('physics', 'mechanics', generation, () => {
    staleCompletionCalls += 1;
  });
  stale.selector._beginModuleTransition('physics');
  stale.selector.activeModule.physics = null;
  resolveAssets();
  await Promise.resolve();
  await Promise.resolve();
  await stale.timers.drain();
  assert.equal(stale.getInitCalls(), 0, 'stale asset resolution must not initialize');
  assert.equal(stale.selector._initialized['physics:mechanics'], undefined);
  assert.equal(stale.order.includes('tools'), false);
  assert.equal(staleCompletionCalls, 0, 'a stale transition must not authorize evidence mounting');

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
  const guideDocumentListeners = new Map();
  const guideListenerOperations = [];
  let guideZoomOpen = false;
  const guideContext = {
    window: {},
    document: {
      querySelector(selector) {
        if (selector === '.physics-zoom-modal.open, .biology-zoom-modal.open') {
          return guideZoomOpen ? {} : null;
        }
        return selector === '#page-physics [data-module="mechanics"].module-active' ? guideSection : null;
      },
      addEventListener(type, handler, options) {
        if (!guideDocumentListeners.has(type)) guideDocumentListeners.set(type, new Set());
        guideDocumentListeners.get(type).add(handler);
        guideListenerOperations.push({ action: 'add', type, handler, options });
      },
      removeEventListener(type, handler, options) {
        guideDocumentListeners.get(type)?.delete(handler);
        guideListenerOperations.push({ action: 'remove', type, handler, options });
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

  guide._overlay.classList.add('active');
  guide._attachEscapeOwner();
  guide._attachEscapeOwner();
  assert.equal(
    (guideDocumentListeners.get('keydown') || new Set()).size,
    1,
    'guide Escape ownership must attach idempotently at document level'
  );
  guideZoomOpen = true;
  const zoomEscape = {
    key: 'Escape',
    defaultPrevented: false,
    immediatePropagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.immediatePropagationStopped = true; }
  };
  for (const handler of guideDocumentListeners.get('keydown') || []) handler(zoomEscape);
  assert.equal(guide._overlay.classList.contains('active'), true, 'Zoom must outrank Guide');
  assert.equal(zoomEscape.defaultPrevented, false);

  guideZoomOpen = false;
  const firstGuideEscape = {
    key: 'Escape',
    target: { id: 'fab-trigger' },
    defaultPrevented: false,
    immediatePropagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.immediatePropagationStopped = true; }
  };
  for (const handler of [...(guideDocumentListeners.get('keydown') || [])]) handler(firstGuideEscape);
  await guideTimers.drain();
  assert.equal(guide._overlay.classList.contains('active'), false);
  assert.equal(firstGuideEscape.defaultPrevented, true);
  assert.equal(firstGuideEscape.immediatePropagationStopped, true);
  assert.equal(
    (guideDocumentListeners.get('keydown') || new Set()).size,
    0,
    'dismiss must synchronously release the document Escape owner'
  );
  const guideKeyAdds = guideListenerOperations.filter((operation) => (
    operation.action === 'add' && operation.type === 'keydown'
  ));
  const guideKeyRemoves = guideListenerOperations.filter((operation) => (
    operation.action === 'remove' && operation.type === 'keydown'
  ));
  assert.equal(guideKeyAdds.length, 1);
  assert.equal(guideKeyRemoves.length, 1);
  assert.equal(guideKeyAdds[0].handler, guideKeyRemoves[0].handler);
  assert.equal(guideKeyAdds[0].options, true);
  assert.equal(guideKeyRemoves[0].options, true);
  assert.match(source, /教师尚未开放“力学模拟”[\s\S]*实验画布与交互资源均未启动/);
  assert.match(source, /data-module-access-return[\s\S]*安全返回物理实验列表/);

  console.log('module-switch-lifecycle-contract: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
