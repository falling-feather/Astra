const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const html = read('index.html');
const serviceWorker = read('sw.js');
const registrySource = read('shared/js/page-registry.js');
const router = read('shared/js/router.js');
const moduleSelector = read('shared/js/module-selector.js');
const main = read('shared/js/main.js');
const context = { window: {} };

vm.runInNewContext(registrySource, context, { filename: 'shared/js/page-registry.js' });
const registry = context.window.AstraPageRegistry;

assert.ok(registry, 'page registry must be attached before Router starts');
assert.ok(Object.isFrozen(registry), 'public registry API must be immutable');
const registeredPages = Array.from(registry.pages()).sort();
const sectionPages = Array.from(html.matchAll(/id="page-([a-z]+)"/g), (match) => match[1]).sort();
const navigationPages = Array.from(new Set(
    Array.from(html.matchAll(/data-page="([a-z]+)"/g), (match) => match[1])
)).sort();
assert.deepEqual(registeredPages, sectionPages, 'registry and page sections must be a bijection');
assert.deepEqual(registeredPages, navigationPages, 'registry and navigation identities must be a bijection');
for (const page of registry.pages()) {
    const definition = registry.get(page);
    assert.ok(Object.isFrozen(definition), `${page} definition must be immutable`);
    if (!definition.script) continue;
    const scriptPath = definition.script.split('?')[0];
    assert.ok(fs.existsSync(path.join(root, scriptPath)), `${page} script must exist: ${scriptPath}`);
}
assert.deepEqual(
    Array.from(registry.pagesByTag('course')),
    ['mathematics', 'physics', 'chemistry', 'algorithms', 'biology']
);
assert.deepEqual(
    Array.from(registry.pagesByTag('frontier')),
    ['frontier', 'cosmos', 'engineering', 'datascience', 'infotech', 'materials', 'humanities']
);
assert.equal(registry.galaxyFor('planets'), 'astra');
assert.equal(registry.galaxyFor('student'), 'astra');
assert.equal(registry.galaxyFor('teacher'), 'astra');
assert.equal(registry.galaxyFor('admin'), 'astra');
assert.equal(registry.galaxyFor('cosmos'), 'frontier');
assert.equal(registry.galaxyFor('unknown-page'), 'englab');
assert.equal(registry.scriptFor('student'), 'pages/student/student-workbench.js?v=20260824v816ExperimentRestoreP2');
assert.equal(registry.scriptFor('teacher'), 'pages/teacher/teacher.js?v=20260825v841CourseAuthoringP0');
assert.equal(registry.scriptFor('engineering'), 'pages/engineering/engineering-page.js?v=20260825v834Show04P0');
assert.equal(registry.scriptFor('planets'), 'pages/planets/planets.js?v=20260825v840TeacherApplicationP0');
assert.equal(registry.scriptFor('admin'), 'pages/admin/admin.js?v=20260825v840TeacherApplicationP0');
assert.equal(registry.isReady('teacher'), false);

let entered = 0;
let left = 0;
context.window.initTeacher = () => { entered += 1; };
context.window.destroyTeacher = () => { left += 1; };
assert.equal(registry.isReady('teacher'), true);
assert.equal(registry.enter('teacher'), true);
assert.equal(registry.leave('teacher'), true);
assert.equal(entered, 1);
assert.equal(left, 1);
assert.equal(registry.enter('mathematics'), false);
assert.equal(registry.leave('mathematics'), false);

assert.match(
  html,
  /app-session\.js[\s\S]*experiment-registry\.js[\s\S]*frontier-manifest\.js[\s\S]*page-registry\.js[\s\S]*router\.js[\s\S]*main\.js/,
);
assert.match(serviceWorker, /page-registry\.js\?v=20260825v840TeacherApplicationP0/);
assert.match(router, /AstraPageRegistry\.pagesByTag\('course'\)/);
assert.match(router, /AstraPageRegistry\.galaxyFor\(page\)/);
assert.match(router, /AstraPageRegistry\.scriptFor\(page\)/);
assert.match(router, /AstraPageRegistry\.enter\(page\)/);
assert.match(router, /AstraPageRegistry\.leave\(page\)/);
assert.doesNotMatch(router, /\bpageScripts\s*:|\bpageReadyChecks\s*:|\b_galaxyPageMap\s*:/);
assert.doesNotMatch(router, /\['mathematics', 'physics', 'chemistry', 'algorithms', 'biology'\]/);
assert.match(router, /ModuleSelector\.leavePage\(page, \{ preserveHash: true \}\)/);
assert.match(moduleSelector, /closeModule\(page, options = \{\}\)/);
assert.match(moduleSelector, /if \(!options\.preserveHash\)/);
assert.match(router, /module-selector\.js\?v=20260824v832Show03P0/);
assert.match(main, /module-selector\.js\?v=20260824v832Show03P0/);
assert.match(main, /page-registry\.js\?v=' \+ PAGE_REGISTRY_ASSET_VERSION/);
assert.match(main, /AstraPageRegistry\.galaxyFor\(hash\)/);
assert.match(main, /const ENGLAB_ASSET_VERSION = '20260731v7969StudentUiP0'/);
assert.doesNotMatch(main, /const frontierPages = \[|const englabPages = \[/);

console.log('page-registry-contract: ok');
