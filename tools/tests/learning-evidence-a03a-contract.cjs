const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const studentSource = read('pages/student/student.js');
const publicationSource = read('shared/js/engineering-lab-publication-context.js');
const moduleSelectorSource = read('shared/js/module-selector.js');
const physicsCss = read('pages/physics/physics.css');
const fabCss = read('shared/css/fab-trigger.css');
const ratingCss = read('shared/css/experiment-rating.css');
const ratingSource = read('shared/js/experiment-rating.js');
const moduleSelectorCss = read('shared/css/module-selector.css');

async function settlePromises(rounds = 16) {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
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

function createPublicationModuleHarness(publication) {
  class FakeClassList {
    constructor() { this.values = new Set(); }
    add(...names) { names.forEach((name) => this.values.add(name)); }
    remove(...names) { names.forEach((name) => this.values.delete(name)); }
    contains(name) { return this.values.has(name); }
    toggle(name, force) {
      if (force) this.add(name); else this.remove(name);
    }
  }
  const section = {
    classList: new FakeClassList(),
    isConnected: true,
    querySelector() { return null; }
  };
  const page = {
    classList: new FakeClassList(),
    isConnected: true,
    querySelectorAll(selector) {
      if (selector === '[data-module="mechanics"]') return [section];
      if (selector === '[data-module].module-active') {
        return section.classList.contains('module-active') ? [section] : [];
      }
      return [];
    }
  };
  const gallery = { style: { display: '' } };
  const toggle = { style: {}, classList: new FakeClassList() };
  const gateStates = [];
  let ownerInitializations = 0;
  const windowObject = {
    innerWidth: 1015,
    location: { hash: '#physics/mechanics' },
    scrollTo() {},
    dispatchEvent() {},
    AstraApplicationSession: { getUser: () => ({ id: 7, role: 'student' }) },
    AstraEngineeringLabPublicationContext: publication,
    AstraLearningEvidenceLoader: { ensure: () => Promise.resolve() },
    AstraExperimentRegistry: {
      get: () => ({ cleanup: { verified: true } })
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
      body: {}
    },
    history: {
      replaceState(_state, _title, hash) { windowObject.location.hash = hash; }
    },
    Event: class { constructor(type) { this.type = type; } },
    CONFIG: { experiments: { physics: [{ id: 'mechanics' }] } },
    setTimeout,
    clearTimeout,
    console
  };
  vm.createContext(context);
  vm.runInContext(moduleSelectorSource, context, { filename: 'shared/js/module-selector.js' });
  const selector = vm.runInContext('ModuleSelector', context);
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
    getOwnerInitializations: () => ownerInitializations
  };
}

(async () => {
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
  const productionWindow = {
    addEventListener() {},
    location: { hash: '' },
    AstraApplicationSession: { getUser: () => null },
    AstraApiClient: {
      request: (route, options = {}) => {
        const classId = Number(options.params && options.params.class_id || 0);
        productionCalls.push({ route, classId, signal: options.signal });
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
  assert.deepEqual(
    bHarness.gateStates.at(-1),
    { state: 'locked', code: 'activity_locked' }
  );
  assert.equal(bHarness.getOwnerInitializations(), 0, 'B locked must initialize no experiment or evidence owner');
  assert.ok(
    productionCalls.some((call) => call.route === '/api/courses' && call.classId === 42),
    'the direct deep link after A→B must query B'
  );
  settleLateA([{ id: 91, galaxy_key: 'englab', course_key: 'physics' }]);
  assert.equal((await lateAResolution).error_code, 'cancelled');
  assert.equal(productionPublication.snapshot().class_id, 42, 'late A must not restore the old class');

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

  console.log('learning-evidence-a03a-contract: release states, guarded deep link, 44px controls, and non-overlap dock ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
