const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const manifestSource = read('pages/frontier/frontier-manifest.js');
const frontierCss = read('pages/frontier/frontier.css');

function manifestFor(window) {
  const context = vm.createContext({ window, Object, Set, Error, Number });
  vm.runInContext(manifestSource, context, { filename: 'frontier-manifest.js' });
  return window.FrontierCourseManifest;
}

function ownerFor(file, name) {
  const window = {};
  const context = vm.createContext({ window, Array, Date, Map, Math, Number, Object, RegExp, Set, String, console });
  vm.runInContext(read(file), context, { filename: file });
  return window[name];
}

const localWindow = {};
const localManifest = manifestFor(localWindow);
assert.equal(localManifest.galaxy_key, 'future-galaxy');
assert.equal(localManifest.courses.length, 6, 'six future directions are required');
localManifest.courses.forEach((course) => {
  assert.equal(course.galaxy_key, 'future-galaxy');
  assert.equal(course.activities.length, 3, `${course.course_key} needs three independent child lessons`);
  course.activities.forEach((activity) => {
    assert.equal(activity.galaxy_key, 'future-galaxy');
    assert.equal(activity.course_key, course.course_key);
    assert.match(activity.activity_key, /^[a-z]+\.[a-z-]+$/, 'activity keys must be stable dot segments');
    assert.match(activity.route_slug, /^[a-z][a-z-]+$/, 'hash route slugs must remain separate from stable activity keys');
    ['prompt', 'observation', 'decision', 'input'].forEach((field) => assert.ok(activity[field], `${activity.activity_key} missing ${field}`));
  });
});
assert.equal(localManifest.getActivity('earth-space', 'cosmos.orbital-scale').kind, 'webgl');
assert.equal(localManifest.resolveAvailability().availability, 'default-open', 'only missing adapter enables legacy local default-open');
const beUnits = localManifest.adaptBe004Units('earth-space', [{ id: 'u-1', activity_key: 'cosmos.day-season', title: '昼夜与季节', position: 1, effective_release_state: 'open', lock_reasons: [] }]);
assert.equal(beUnits['cosmos.day-season'].state, 'open');
assert.equal(beUnits['cosmos.orbital-scale'].state, 'hidden', 'BE-004 omission maps only known manifest keys to hidden');
assert.equal(localManifest.adaptBe004Units('earth-space', [{ id: 'bad', activity_key: 'not-in-manifest', title: 'bad', position: 1, effective_release_state: 'open', lock_reasons: [] }]), null, 'unknown BE activity must fail closed');

const noMethodManifest = manifestFor({ AstraCourseStateAdapter: {} });
assert.equal(noMethodManifest.resolveAvailability().availability, 'unavailable', 'adapter without contract must fail closed');
const invalidManifest = manifestFor({ AstraCourseStateAdapter: { getFutureGalaxyState() { return null; } } });
assert.equal(invalidManifest.resolveAvailability().availability, 'unavailable', 'invalid adapter responses must fail closed');
const allAccess = Object.fromEntries(localManifest.courses.flatMap((course) => course.activities.map((activity) => [activity.activity_key, 'hidden'])).concat([
  ['cosmos.day-season', 'open'],
  ['engineering.load-path', 'locked'],
  ['datascience.model-fit', { state: 'locked', progress: 0.35 }],
  ['infotech.packet-route', 'unexpected']
]));
const validManifest = manifestFor({ AstraCourseStateAdapter: { getFutureGalaxyState() { return { availability: 'available', activity_access: allAccess }; } } });
const validState = validManifest.resolveAvailability();
assert.equal(validState.availability, 'available');
assert.equal(validState.course_access['earth-space'].state, 'open');
assert.equal(validState.course_access['engineering-systems'].state, 'locked');
assert.equal(validState.activity_access['datascience.model-fit'].progress, 0.35);
assert.equal(validState.activity_access['infotech.packet-route'].state, 'unavailable');

const runtime = read('shared/js/frontier-learning.js');
const index = read('index.html');
const ownerEvidence = {
  'cosmos.day-season': ['pages/cosmos/earth-sun.js', 'cosmos-day', 'declination'],
  'cosmos.orbital-scale': ['shared/js/frontier-learning.js', 'fg-orbit-position', 'earth.position.set'],
  'cosmos.evidence-log': ['pages/cosmos/earth-sun.js', 'cosmos-hour', 'shadowRatio'],
  'engineering.load-path': ['pages/engineering/bridge-truss.js', 'truss-joint', 'memberForces'],
  'engineering.member-choice': ['pages/engineering/bridge-truss.js', 'truss-member', 'structuralStatus'],
  'engineering.safety-check': ['pages/engineering/bridge-truss.js', 'truss-safety', 'utilization'],
  'datascience.model-fit': ['pages/datascience/linear-regression.js', 'regression-slope', 'state.slope'],
  'datascience.outlier-test': ['pages/datascience/linear-regression.js', 'regression-dataset', 'datasetId'],
  'datascience.evidence-claim': ['pages/datascience/linear-regression.js', 'regression-dataset', 'datasetId'],
  'infotech.packet-route': ['pages/infotech/network-layers.js', 'network-hops', 'pathBytes'],
  'infotech.layer-contract': ['pages/infotech/network-layers.js', 'network-payload', 'segments'],
  'infotech.fault-trace': ['pages/infotech/network-layers.js', 'network-fault', 'fault.active'],
  'materials.grain-boundary': ['pages/materials/materials-lab.js', 'materials-grain-size', 'boundaryIndex'],
  'materials.defect-path': ['pages/materials/materials-lab.js', 'materials-defect', 'defectDensity'],
  'materials.process-window': ['pages/materials/materials-lab.js', 'materials-cooling', 'observedGrainSize'],
  'humanities.context-map': ['pages/humanities/text-lab.js', 'humanities-threshold', 'connectionThreshold'],
  'humanities.voice-shift': ['pages/humanities/text-lab.js', 'humanities-sample', 'sampleId'],
  'humanities.claim-review': ['pages/humanities/text-lab.js', 'humanities-threshold', 'connectionThreshold']
};
const retiredEngineeringWrappers = new Set([
  'engineering.member-choice',
  'engineering.safety-check',
]);
localManifest.courses.forEach((course) => course.activities.forEach((activity) => {
  const expected = ownerEvidence[activity.activity_key];
  assert.ok(expected, `${activity.activity_key} needs an explicit owner evidence contract`);
  const [ownerPath, control, observable] = expected;
  assert.equal(activity.input_control, control, `${activity.activity_key} must declare its real learning input`);
  if (retiredEngineeringWrappers.has(activity.activity_key)) {
    assert.doesNotMatch(
      read(ownerPath),
      new RegExp(control),
      `${activity.activity_key} remains historical manifest data and must not re-enter the restored experiment owner`,
    );
    return;
  }
  assert.ok(runtime.includes(control), `${activity.activity_key} control must be rendered by the route runtime`);
  assert.ok(read(ownerPath).includes(observable), `${activity.activity_key} control must change an owner observation or reading`);
  assert.ok(runtime.includes(`'${activity.activity_key}'`), `${activity.activity_key} needs its own route preset and answer feedback`);
}));

const seasons = ownerFor('pages/cosmos/earth-sun.js', 'CosmosSeasons');
const noonObservation = seasons._calculate();
seasons.state.hour = 9;
const morningObservation = seasons._calculate();
assert.notEqual(morningObservation.currentAltitude, noonObservation.currentAltitude, 'evidence-log time input must change the solar observation');
assert.notEqual(morningObservation.shadowRatio, noonObservation.shadowRatio, 'evidence-log time input must change the shadow reading');

const truss = ownerFor('pages/engineering/bridge-truss.js', 'BridgeTruss');
const centerTruss = truss.solve();
truss.state.loadJoint = 'B';
const leftTruss = truss.solve();
assert.notEqual(leftTruss.reactions.Ay, centerTruss.reactions.Ay, 'restored load-joint control must change the support reaction');
truss.state.load = 100;
const heavierTruss = truss.solve();
assert.ok(heavierTruss.maxForce > leftTruss.maxForce, 'restored load slider must change the calculated member force');
assert.doesNotMatch(read('pages/engineering/bridge-truss.js'), /transferred\s*\/\s*2/, 'member removal must not hard-code a half-force transfer');
assert.doesNotMatch(read('pages/engineering/bridge-truss.js'), /memberMode|safetyFactor|utilization|structuralStatus/);

const regression = ownerFor('pages/datascience/linear-regression.js', 'LinearRegressionLab');
const baselineRegression = regression._calculate();
regression.state.slope += 5;
assert.notEqual(regression._calculate().current.mse, baselineRegression.current.mse, 'model-fit slope must change residual evidence');
regression.datasetId = 'outlier';
assert.notEqual(regression._calculate().dataset.label, baselineRegression.dataset.label, 'outlier-test must switch to the actual outlier dataset');
regression.datasetId = 'climate';
assert.notEqual(regression._calculate().dataset.label, baselineRegression.dataset.label, 'evidence-claim must switch to its evidence dataset');

const network = ownerFor('pages/infotech/network-layers.js', 'NetworkLayersLab');
const baselineNetwork = network._calculate();
network.state.hops = 7;
assert.notEqual(network._calculate().pathBytes, baselineNetwork.pathBytes, 'packet-route hops must change path-byte evidence');
network.state.payload = 5400;
assert.ok(network._calculate().segments > baselineNetwork.segments, 'layer-contract payload must change segmentation evidence');
network.state.faultNode = 'transit';
assert.equal(network._calculate().fault.active, true, 'fault-trace must create a visible fault state');

const materials = ownerFor('pages/materials/materials-lab.js', 'MaterialsLab');
const baselineMaterial = materials._calculate({});
materials.defectDensity = 8;
assert.ok(materials._calculate({}).defectCount > baselineMaterial.defectCount, 'defect-path density must change the visible defect count');
materials.coolingRate = 100;
assert.ok(materials._calculate({}).observedGrainSize < baselineMaterial.observedGrainSize, 'process-window cooling rate must refine the observed grain size');

const humanities = ownerFor('pages/humanities/text-lab.js', 'HumanitiesLab');
const baselineHumanities = humanities._buildModel();
humanities.sampleId = 'city';
humanities.focusTerm = '';
assert.notEqual(humanities._buildModel().sample.label, baselineHumanities.sample.label, 'voice-shift must change the inspected material');
humanities.connectionThreshold = 3;
assert.ok(humanities._buildModel().coTerms.length <= baselineHumanities.coTerms.length, 'claim-review threshold must filter relationship evidence');
[
  'AbortController', 'ResizeObserver', 'runtime.abort.signal.aborted', 'cancelAnimationFrame',
  'geometry.dispose', 'material.dispose', 'texture.dispose', 'target.dispose', 'bitmap.close',
  'renderer.renderLists.dispose', 'renderer.dispose', 'renderer.forceContextLoss', 'setAnimationLoop(null)',
  "import('../../shared/vendor/three-r185/three.module.js')", 'mountCanvasVisual'
].forEach((token) => assert.ok(runtime.includes(token), `future lifecycle must include ${token}`));
assert.match(runtime, /course\.activities\.find\(\(activity\) => activityAccess\(availability, activity\)\.state === 'open'\)/, 'courses without an open activity must not render in catalogue');
assert.ok(runtime.includes('activityAccess(route.availability, item)'), 'activity access must drive child lesson links');
assert.ok(runtime.includes('route_slug'), 'hash routes must use manifest route slugs');
assert.ok(!runtime.includes('href="#${esc(course.page)}/${esc(item.activity_key)}"'), 'stable activity keys must not leak into hashes');
assert.ok(runtime.includes('mountOwnerVisual'), 'Canvas owners must be the normal non-WebGL path');
assert.ok(runtime.includes('data-fg-view') && runtime.includes('setView(next)') && runtime.includes('viewAzimuth'), 'orbit view input must drive the camera');
assert.ok(runtime.includes('new THREE.PointLight') && runtime.includes('Earth day/night boundary visible'), 'orbit lighting must illuminate the Earth from the fixed teaching sun');
assert.match(runtime, /orbitFocusX\s*=\s*-Math\.sqrt\(orbitMajorRadius \*\* 2 - orbitMinorRadius \*\* 2\)/, 'the Three teaching sun must occupy an ellipse focus');
assert.match(runtime, /sun\.position\.set\(orbitFocusX, 0, 0\)/, 'the Three light source must follow the focal teaching sun');
assert.match(runtime, /focusX\s*=\s*cx - Math\.sqrt/, 'the Canvas fallback must preserve the same focal model');
assert.match(runtime, /runtime\.abort\.signal\.aborted \|\| activeRuntime !== runtime \|\| !canvas\.isConnected\) \{\s*if \(canvas\.isConnected\) canvas\.remove\(\);\s*return;/, 'a route left during dynamic Three import must remove its provisional canvas');
assert.ok(runtime.includes('global.destroyFrontierCourse = () => FrontierLearning.destroy()'), 'leave cleanup must not infer a page from a changed hash');
assert.ok(runtime.includes("route.access.state === 'locked'") && runtime.includes('教师正在按班级学习节奏开放课程'), 'locked child routes must explain the teacher-paced release state');
['earth-sun.js', 'bridge-truss.js', 'linear-regression.js', 'network-layers.js', 'materials-lab.js', 'text-lab.js'].forEach((owner) => assert.ok(runtime.includes(owner), `owner ${owner} must remain lazy-loadable`));
assert.ok(runtime.length < 60000, 'the replaced long-page runtime must not remain in the future entry bundle');
assert.ok(!runtime.includes('sectionPlans:'), 'legacy long-page section plans must be removed');
assert.match(runtime, /const FrontierLearning = global\.FrontierLearning \|\| \{\};/, 'new runtime must retain the public lifecycle object itself');

const frontierMounts = [
  ['frontier', 'page-frontier'], ['cosmos', 'page-cosmos'],
  ['datascience', 'page-datascience'], ['infotech', 'page-infotech'], ['materials', 'page-materials'], ['humanities', 'page-humanities']
];
frontierMounts.forEach(([page, id]) => {
  const section = new RegExp(`<section\\b[^>]*id="${id}"[^>]*>\\s*<div class="frontier-runtime-mount" data-frontier-runtime-mount="${page}" aria-live="polite"></div>\\s*</section>`);
  assert.match(index, section, `${id} must be a minimal runtime mount, not a prebuilt long page`);
});
['earth-sun-canvas', 'linear-regression-canvas', 'network-layers-canvas', 'materials-canvas', 'humanities-canvas', 'frontier-materials-deep-panels'].forEach((legacyNode) => {
  assert.ok(!index.includes(legacyNode), `${legacyNode} must be created by its lazy course owner, not parsed at first paint`);
});
assert.match(index, /id="page-engineering"[\s\S]*id="bridge-truss-canvas"/, 'engineering must keep its restored independent experiment page');
assert.doesNotMatch(index, /data-frontier-runtime-mount="engineering"/);
assert.ok(!index.includes('#frontier-frontier-route'), 'the resource index must not link to a removed legacy frontier anchor');
assert.match(index, /href="#frontier" data-page="frontier"/, 'the resource index must enter the new catalogue route');
assert.equal((index.match(/class="frontier-footer__container"/g) || []).length, 1, 'the future footer must have one real layout container');
assert.equal((index.match(/class="frontier-footer__bottom"/g) || []).length, 1, 'the future footer must retain the shared copyright row');
['返回星序', '开源协议', '更新日志'].forEach((label) => assert.ok(index.includes(label), `future footer must preserve the valid ${label} entry`));
assert.doesNotMatch(index, /<script src="shared\/js\/frontier-learning\.js/, 'Future runtime must be loaded by the route registry, not parsed for every role');

const main = read('shared/js/main.js');
assert.ok(main.includes("'./pages/frontier/frontier-manifest.js?v=20260809v804FutureEvidenceP0'"));
assert.ok(main.includes("'./pages/frontier/frontier.css?v=20260824v816ExperimentRestoreP2'"));
assert.ok(main.includes("'./shared/js/frontier-publication-context.js?v=20260824v816ExperimentRestoreP2'"));
assert.ok(main.includes("'./shared/js/frontier-learning.js?v=20260824v816ExperimentRestoreP2'"));
assert.ok(!main.includes("'./pages/cosmos/earth-sun.js?v=20260630mainV64'"), 'future galaxy must not warm every legacy activity');
const registry = read('shared/js/page-registry.js');
assert.ok(registry.includes("ready: 'initFrontierCourse'"));
assert.ok(registry.includes("leave: 'destroyFrontierCourse'"));
assert.ok(registry.includes('FUTURE_RESOURCE_VERSION'), 'the route registry must own the Future runtime cache generation');

const asset = path.join(root, 'UI', 'future-galaxy', 'orbit-observatory.webp');
assert.ok(fs.existsSync(asset), 'observatory asset must ship locally');
assert.ok(fs.statSync(asset).size < 550 * 1024, 'observatory asset must stay inside the image budget');
assert.match(frontierCss, /\.fg-owner-controls input\[type="range"\]\s*\{[^}]*height:\s*44px;/, 'Future range inputs need a 44px touch target');
assert.match(frontierCss, /\.fg-owner-controls button\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/, 'Future learning presets need 44px touch targets');
assert.match(frontierCss, /\.fg-answer\s*\{[^}]*min-height:\s*44px;/, 'Future answer rows need 44px touch targets');
assert.match(frontierCss, /\.fg-answer input\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*width:\s*100%;[^}]*height:\s*100%;/, 'the native answer control must own the complete answer hit area');
assert.match(frontierCss, /\.fg-submit\s*\{[^}]*min-height:\s*44px;/, 'Future answer submission must remain touch accessible');
const baseCss = read('shared/css/base.css');
const serviceWorker = read('sw.js');
['future-galaxy-hero-sky.webp', 'future-galaxy-hero-nebula.webp'].forEach((name) => {
  const optimized = path.join(root, 'UI', 'future-galaxy', name);
  assert.ok(fs.existsSync(optimized), `${name} must ship in a browser-efficient format`);
  assert.ok(fs.statSync(optimized).size < 180 * 1024, `${name} must remain inside the background image budget`);
  assert.ok(baseCss.includes(name), `${name} must be the active base background`);
});
assert.doesNotMatch(baseCss, /future-galaxy-hero-(?:sky|nebula)\.png/);
assert.doesNotMatch(serviceWorker, /future-galaxy-hero-(?:sky|nebula)\.(?:png|webp)/, 'future-only backgrounds must not inflate the global app shell');
assert.match(frontierCss, /\.frontier-overview-page\.active\s*\{[\s\S]*?height:\s*100dvh;[\s\S]*?padding-top:\s*0;[\s\S]*?overflow:\s*hidden;/, 'the star catalogue must remain a single non-scrolling viewport');
assert.match(main, /const showFrontier = frontierPages\.has\(page\) && page !== 'frontier'/, 'the single-screen catalogue must not render a second footer below the viewport');
const networkRuntime = read('pages/infotech/network-layers.js');
assert.match(networkRuntime, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
assert.match(networkRuntime, /Math\.min\(window\.devicePixelRatio \|\| 1, this\.reducedMotion \? 1 : 1\.5\)/, 'Canvas DPR must be bounded');
assert.match(networkRuntime, /if \(!this\.ctx \|\| this\.reducedMotion\) return;/, 'reduced-motion must disable the continuous RAF loop');
assert.match(read('shared/vendor/three-r185/LICENSE'), /MIT License/);
assert.ok(fs.statSync(path.join(root, 'shared/vendor/three-r185/three.module.js')).size > 600000, 'auditable local Three ESM is required');
assert.match(read('shared/vendor/three-r185/three.module.js'), /from '.\/three\.core\.js'/, 'r185 module dependency must remain explicit');
assert.ok(fs.statSync(path.join(root, 'shared/vendor/three-r185/three.core.js')).size > 1400000, 'the exact local r185 core imported by three.module.js is required');
const threeSource = read('shared/vendor/three-r185/SOURCE.md');
['three@0.185.1', 'three.module.js', 'three.core.js', 'LICENSE', 'sha512-5aojFCXKwnjBRZvUnt3WFfEcvUJgkN5LlijRFN95hMy8WVkG4I0QNcJE+OuWvuJ0bOdStrbfXn0pkd6/QyiAlg=='].forEach((token) => {
  assert.ok(threeSource.includes(token), `Three provenance must record ${token}`);
});

(async () => {
  const httpWindow = {};
  const httpManifest = manifestFor(httpWindow);
  const courseIds = Object.fromEntries(httpManifest.courses.map((course) => [course.course_key, `course-${course.page}`]));
  const unitsByCourseId = Object.fromEntries(httpManifest.courses.map((course) => [
    `course-${course.page}`,
    [{ id: `unit-${course.page}`, activity_key: course.activities[0].activity_key, title: course.activities[0].title, position: 1, effective_release_state: 'open', lock_reasons: [] }]
  ]));
  assert.equal(httpManifest.configureHttp({ course_ids: courseIds, class_id: 'class-a', fetcher: async (url) => {
    const courseId = decodeURIComponent(url.match(/\/courses\/([^/]+)\/units/)[1]);
    return { ok: true, json: async () => unitsByCourseId[courseId] };
  } }), true);
  assert.equal(httpManifest.resolveAvailability().availability, 'unavailable', 'render reads pending cache and never awaits fetch synchronously');
  const hydrated = await httpManifest.refresh();
  assert.equal(hydrated.availability, 'available');
  assert.equal(hydrated.activity_access['cosmos.day-season'].state, 'open');
  assert.equal(hydrated.activity_access['cosmos.orbital-scale'].state, 'hidden');

  const failedWindow = {};
  const failedManifest = manifestFor(failedWindow);
  assert.equal(failedManifest.configureHttp({ course_ids: courseIds, class_id: 'class-a', fetcher: async () => ({ ok: false, json: async () => [] }) }), true);
  assert.equal((await failedManifest.refresh()).availability, 'unavailable', 'one failed BE response closes the whole catalogue');

  const raceWindow = {};
  const raceManifest = manifestFor(raceWindow);
  const staleResolvers = [];
  assert.equal(raceManifest.configureHttp({
    course_ids: courseIds,
    class_id: 'class-old',
    fetcher: (url) => new Promise((resolve) => staleResolvers.push(() => resolve({
      ok: true,
      json: async () => {
        const course = raceManifest.courses.find((item) => url.includes(`course-${item.page}`));
        return [{ id: `old-${course.page}`, activity_key: course.activities[0].activity_key, title: course.activities[0].title, position: 1, effective_release_state: 'open', lock_reasons: [] }];
      }
    })))
  }), true);
  const staleRefresh = raceManifest.refresh();
  assert.equal(staleResolvers.length, 6, 'a refresh must capture each course request before a class switch');
  assert.equal(raceManifest.configureHttp({
    course_ids: courseIds,
    class_id: 'class-new',
    fetcher: async (url) => {
      const course = raceManifest.courses.find((item) => url.includes(`course-${item.page}`));
      return { ok: true, json: async () => [{ id: `new-${course.page}`, activity_key: course.activities[0].activity_key, title: course.activities[0].title, position: 1, effective_release_state: 'open', lock_reasons: [] }] };
    }
  }), true);
  const freshSnapshot = await raceManifest.refresh();
  staleResolvers.forEach((resolve) => resolve());
  assert.equal(await staleRefresh, freshSnapshot, 'a superseded class refresh must not overwrite the latest availability snapshot');
  console.log('frontier-course-lifecycle-contract: ok');
})().catch((error) => { process.nextTick(() => { throw error; }); });
