const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const indexSource = read('codevis/index.html');
const routerSource = read('codevis/shared/js/router.js');
const manifestSource = read('codevis/shared/js/course-manifest.js');
const publicationAdapterSource = read('codevis/shared/js/course-publication-adapter.js');
const catalogSource = read('codevis/pages/course-catalog/course-catalog.js');
const challengeSource = read('codevis/pages/course-challenge/course-challenge.js');
const cppSource = read('codevis/shared/js/runtimes/runtime-cpp.js');
const loaderSource = read('codevis/shared/js/runtime-loader.js');
const navbarCss = read('codevis/shared/css/navbar.css');

const versionedShellAssets = Array.from(indexSource.matchAll(/(?:href|src)="(?!\.\.\/shared\/js\/api-client\.js)([^"]+\?v=([^"]+))"/g));
assert.ok(versionedShellAssets.length >= 18, 'code space must version every local course shell asset');
versionedShellAssets.forEach((match) => {
  assert.equal(match[2], '759r3', `${match[1]} must use the V7.5.9 cache generation`);
});
assert.match(navbarCss, /\.cv-navbar__brand\s*\{[^}]*min-height:\s*44px;/, 'Code Space mobile brand needs a 44px touch target');
assert.match(navbarCss, /\.cv-nav-item\s*\{[^}]*min-height:\s*44px;/, 'Code Space primary navigation needs 44px touch targets');

for (const id of ['cv-page-catalog', 'cv-page-lesson', 'cv-page-challenge']) {
  assert.match(indexSource, new RegExp(`id=["']${id}["']`), `${id} must be a real route surface`);
}
assert.doesNotMatch(
  indexSource,
  /JS-Interpreter|Skulpt|JSCPP|JavaScript\s+由|Python\s+由|C\/C\+\+\s+由/,
  'student-facing shell must not expose runtime implementation copy',
);
assert.match(indexSource, /class=["']cv-footer["']/);
assert.match(indexSource, /工科试验室/);
assert.match(indexSource, /返回星序总览/);
assert.match(routerSource, /currentParams:\s*new URLSearchParams\(\)/);
assert.match(routerSource, /nextHash[\s\S]*search\.toString\(\)/);
assert.match(catalogSource, /navigateTo\(['"]lesson['"],\s*\{\s*activity:/);
assert.match(catalogSource, /#challenge\?activity=/);
assert.match(challengeSource, /#lesson\?activity=/);

const sandbox = { window: {} };
vm.runInNewContext(manifestSource, sandbox, { filename: 'course-manifest.js' });
vm.runInNewContext(publicationAdapterSource, sandbox, { filename: 'course-publication-adapter.js' });
const { CvCourseManifest: manifest, CvCourseStateAdapter: stateAdapter } = sandbox.window;
assert.equal(manifest.galaxy_key, 'code-space');
assert.equal(manifest.courses.length, 6, 'course directory must expose six ordered course groups');

const activities = manifest.courses.flatMap(course => course.activities);
assert.equal(activities.length, 18, 'each course group must contain three playable activities');
assert.deepEqual(
  [...new Set(activities.map(activity => activity.language))].sort(),
  ['c', 'cpp', 'javascript', 'python'],
);
assert.equal(new Set(activities.map(activity => activity.activity_key)).size, activities.length);
for (const activity of activities) {
  assert.match(activity.activity_key, /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/);
  assert.equal(activity.galaxy_key, 'code-space');
  assert.ok(activity.course_key);
  assert.ok(activity.prediction && activity.trace_prompt && activity.repair_hint);
}

assert.equal(
  stateAdapter.contract.endpoint,
  '/api/courses/{course_id}/units?class_id={class_id}',
);
assert.equal(stateAdapter.contract.maps.absent_from_authoritative_response, 'hidden');
assert.equal(stateAdapter.contract.maps.invalid_or_failed_adapter, 'unavailable');
assert.doesNotMatch(publicationAdapterSource, /lock_reason:\s*unit\.lock_reasons\.join/, 'student Code Space must not expose backend lock reason codes');
assert.match(publicationAdapterSource, /manual_locked:\s*'教师暂未开放'/, 'known release reasons need student-facing Chinese copy');
assert.match(indexSource, /shared\/js\/course-publication-adapter\.js\?v=759r3/, 'the release adapter must load after the protected activity manifest');

assert.match(challengeSource, /预测[\s\S]*运行[\s\S]*追踪[\s\S]*修正/);
assert.match(challengeSource, /仅用于学习反馈/);
assert.match(challengeSource, /正式提交/);
assert.match(challengeSource, /const formalDisabled = !submitState\.available/);
assert.match(challengeSource, /formalDisabled \? ['"] disabled aria-disabled=/);
assert.doesNotMatch(challengeSource, /accepted\s*:\s*true|status\s*:\s*["']accepted["']/i);

assert.match(cppSource, /new Worker\(WORKER_URL\)/, 'C and C++ must execute in a Worker');
assert.match(cppSource, /setTimeout\([^]*4200\)/, 'main thread must own a hard Worker deadline');
assert.match(cppSource, /worker\.terminate\(\)/, 'timeout and cancellation must terminate the Worker');
assert.doesNotMatch(cppSource, /\beval\s*\(|\bnew\s+Function\s*\(/);
assert.doesNotMatch(loaderSource, /https?:\/\//, 'runtime loader must use audited same-origin assets only');

console.log('code-space-course-contract: ok');
