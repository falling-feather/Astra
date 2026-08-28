const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const contextPath = path.join(root, 'shared', 'js', 'frontier-publication-context.js');
const contextSource = fs.readFileSync(contextPath, 'utf8');
const studentSource = fs.readFileSync(path.join(root, 'pages', 'student', 'student.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const courseKeys = [
  'earth-space', 'engineering-systems', 'data-ai',
  'information-technology', 'materials-science', 'humanities-futures'
];
const courses = courseKeys.map((course_key, index) => ({
  id: index + 101,
  galaxy_key: 'future-galaxy',
  subject_key: course_key,
  course_key: `course-${index + 101}`
}));

const listeners = new Map();
const fetchCalls = [];
const configurations = [];
const renders = [];
let scenario = 'single';
let activeConfig = null;
let manifestAvailability = 'default-open';
let pendingClassResponse = null;

function response(payload, ok = true) {
  return { ok, json: async () => payload };
}

global.window = global;
global.navigator = { onLine: true };
global.location = { origin: 'https://astra.test', hash: '#cosmos/day-season' };
global.addEventListener = (name, handler) => listeners.set(name, handler);
global.removeEventListener = (name) => listeners.delete(name);
global.FrontierLearning = { renderRoute: (page) => renders.push({ page, availability: manifestAvailability }) };
global.AstraApplicationSession = { getUser: () => null };
global.FrontierCourseManifest = {
  galaxy_key: 'future-galaxy',
  courses: courseKeys.map((course_key) => ({ course_key })),
  configureHttp(config) {
    configurations.push(config);
    const valid = Boolean(config && config.course_ids && config.course_class_ids && config.class_id !== undefined && typeof config.fetcher === 'function');
    activeConfig = valid ? config : null;
    manifestAvailability = 'unavailable';
    return valid;
  },
  async refresh() {
    if (!activeConfig) return { availability: 'unavailable' };
    const classId = activeConfig.course_class_ids['earth-space'];
    await activeConfig.fetcher(`/api/courses/${activeConfig.course_ids['earth-space']}/units${classId == null ? '' : `?class_id=${classId}`}`, { credentials: 'same-origin' });
    manifestAvailability = 'available';
    return { availability: 'available', source: 'http-cache' };
  }
};
global.fetch = async (url, options = {}) => {
  fetchCalls.push({ url: String(url), options });
  if (String(url).startsWith('/api/classes')) {
    if (scenario === 'classes-pending') return new Promise((resolve) => { pendingClassResponse = resolve; });
    if (scenario === 'multi') return response([{ id: 7 }, { id: 8 }]);
    if (scenario === 'classes-fail') return response({}, false);
    if (scenario === 'direct') return response([]);
    return response([{ id: 7 }]);
  }
  if (String(url) === '/api/courses' || String(url).startsWith('/api/courses?')) {
    if (scenario === 'courses-fail') return response({}, false);
    if (scenario === 'mixed') {
      return response(String(url).includes('class_id=7') ? courses.slice(0, 1) : [courses[0], courses[1]]);
    }
    return response(scenario === 'missing-course' ? courses.slice(0, -1) : scenario === 'direct' ? courses.slice(0, 1) : courses);
  }
  if (String(url).startsWith('/api/courses/')) return response([]);
  throw new Error(`Unexpected request ${url}`);
};

delete require.cache[contextPath];
const publication = require(contextPath);

async function run() {
  assert.ok(listeners.has('astra:session-ready'), 'the globally loaded publication controller must bridge direct Future Galaxy entry');
  assert.ok(listeners.has('astra:api-auth-required'), 'authority loss must close the future release snapshot');
  assert.ok(listeners.has('astra:session-signed-out'), 'sign-out must close the future release snapshot');

  scenario = 'classes-pending';
  const pendingBootstrap = publication.bootstrap({ id: 11, role: 'student' });
  assert.equal(manifestAvailability, 'unavailable', 'student bootstrap must close legacy default-open before its first await');
  assert.deepEqual(configurations.at(-1), {}, 'a pending class lookup must configure no authority course map');
  assert.deepEqual(renders.at(-1), { page: 'cosmos', availability: 'unavailable' }, 'the active direct route must rerender closed before owners can mount');
  pendingClassResponse(response([{ id: 7 }]));
  const pendingResult = await pendingBootstrap;
  assert.equal(pendingResult.availability, 'available', 'one resolved class may open only after its course map and unit refresh');

  scenario = 'single';
  fetchCalls.length = 0;
  listeners.get('astra:session-ready')({ detail: { user: { id: 11, role: 'student' } } });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  const singleConfig = configurations.at(-1);
  assert.equal(singleConfig.class_id, 7, 'one class may become the automatic authority context');
  assert.deepEqual(singleConfig.course_ids, Object.fromEntries(courses.map((course) => [course.subject_key, course.id])));
  assert.deepEqual(singleConfig.course_class_ids, Object.fromEntries(courses.map((course) => [course.subject_key, 7])));
  assert.equal(fetchCalls[0].url, '/api/classes?mine=true');
  assert.equal(fetchCalls[0].options.credentials, 'same-origin');
  assert.equal(fetchCalls[1].url, '/api/courses');
  assert.equal(fetchCalls[2].url, '/api/courses?class_id=7');
  const unitFetch = fetchCalls.find((call) => call.url.startsWith('/api/courses/101/units'));
  assert.ok(unitFetch, 'manifest refresh must use the configured course map');
  assert.equal(unitFetch.options.credentials, 'same-origin');
  assert.ok(renders.some((entry) => entry.page === 'cosmos' && entry.availability === 'available'), 'a completed authority refresh must rerender the active future route');

  scenario = 'multi';
  fetchCalls.length = 0;
  const multi = await publication.bootstrap({ id: 11, role: 'student' });
  assert.equal(multi.source, 'class-selection-required');
  assert.deepEqual(configurations.at(-1), {}, 'multiple classes must close availability instead of guessing one');
  assert.equal(fetchCalls.length, 1, 'multiple classes must not request a guessed course map');

  scenario = 'missing-course';
  const missing = await publication.bootstrap({ id: 11, role: 'student' });
  assert.equal(missing.source, 'http-cache');
  assert.equal(Object.keys(configurations.at(-1).course_ids).length, 5, 'a partial Future Galaxy selection must remain usable');

  scenario = 'direct';
  const direct = await publication.bootstrap({ id: 11, role: 'student' });
  assert.equal(direct.source, 'http-cache', 'direct course enrollment may render without a homeroom');
  assert.equal(configurations.at(-1).class_id, null);
  assert.deepEqual(configurations.at(-1).course_ids, { 'earth-space': 101 });
  assert.deepEqual(configurations.at(-1).course_class_ids, { 'earth-space': null });

  scenario = 'mixed';
  const mixed = await publication.bootstrap({ id: 11, role: 'student' });
  assert.equal(mixed.source, 'http-cache', 'direct Future courses must coexist with an unrelated homeroom');
  assert.deepEqual(configurations.at(-1).course_ids, { 'earth-space': 101, 'engineering-systems': 102 });
  assert.deepEqual(configurations.at(-1).course_class_ids, { 'earth-space': 7, 'engineering-systems': null });

  scenario = 'courses-fail';
  const failed = await publication.bootstrap({ id: 11, role: 'student' });
  assert.equal(failed.source, 'course-context-unavailable');
  assert.deepEqual(configurations.at(-1), {}, 'a failed course endpoint must fail closed');

  const admin = await publication.bootstrap({ id: 99, role: 'admin' });
  assert.equal(admin.availability, 'legacy-boundary', 'non-student sessions must not configure student publication context');

  assert.doesNotMatch(contextSource, /localStorage|sessionStorage/, 'future class and course context must remain in memory only');
  assert.match(contextSource, /AstraStudentScopeSelection/, 'multi-class learners may reuse an explicit workbench selection');
  assert.match(contextSource, /item\.galaxy_key !== GALAXY_KEY/, 'course IDs must be filtered by Future Galaxy identity');
  assert.match(contextSource, /item\.subject_key \|\| item\.course_key/, 'teacher-created course instances must map through subject_key');
  assert.match(contextSource, /credentials: 'same-origin'/, 'authority requests must keep same-origin cookies');
  assert.match(studentSource, /window\.FutureGalaxyPublicationContext/, 'the student workbench must delegate class switches to the shared controller');
  assert.doesNotMatch(studentSource, /addEventListener\('astra:session-ready'/, 'the lazy student asset must not own the direct-entry session listener');

  const manifestIndex = indexSource.indexOf('pages/frontier/frontier-manifest.js');
  const contextIndex = indexSource.indexOf('shared/js/frontier-publication-context.js');
  const runtimeIndex = indexSource.indexOf('shared/js/frontier-learning.js');
  const registryIndex = indexSource.indexOf('shared/js/page-registry.js');
  assert.ok(manifestIndex >= 0 && manifestIndex < contextIndex && contextIndex < registryIndex,
    'the direct-entry controller must load after the manifest and before route startup');
  assert.equal(runtimeIndex, -1, 'the Future runtime must remain route-lazy on direct and non-Future entries');

  console.log('student-frontier-publication-context-contract: ok');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
