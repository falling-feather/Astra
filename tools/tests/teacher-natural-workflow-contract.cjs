const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

// This fixture enters 09:00 China time and asserts the transmitted 01:00 UTC.
// Set its clock explicitly instead of inheriting the runner's local timezone.
process.env.TZ = 'Asia/Shanghai';

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const teacherSource = read('pages/teacher/teacher.js');
const ownerSource = read('shared/js/teacher-learning-evidence.js');
const clientSource = read('shared/js/learning-evidence-client.js');

assert.match(
  teacherSource,
  /const TEACHER_VIEWS = Object\.freeze\(\{\s*overview:\s*'教学总览',\s*curriculum:\s*'课程节奏',\s*grading:\s*'批改与学情'\s*\}\)/,
);
assert.match(teacherSource, /const classParams = \{ school_id: schoolId \};\s*if \(state\.user\.role === 'teacher'\) classParams\.mine = true;/);
assert.match(teacherSource, /fetchJson\('\/api\/courses', \{ params: \{ class_id: state\.selected\.classId \} \}\)/);
assert.match(
  teacherSource,
  /fetchJson\(`\/api\/courses\/\$\{courseId\}\/assignments`, \{ params: \{ class_id: courseScope\.classId \} \}\)/,
);
assert.match(teacherSource, /const submissionParams = \{ class_id: classId, course_id: courseId,/);
assert.match(teacherSource, /validateCourseScopedPage\(page, courseScope, PENDING_SUBMISSION_PAGE_LIMIT, 0, 'pending_submission_scope_invalid'\)/);
assert.match(teacherSource, /String\(item\.class_id\) === scope\.classId && String\(item\.course_id\) === scope\.courseId/);
assert.match(teacherSource, /const nextValue = target\.value;\s*invalidateRequests\(\);\s*if \(\['galaxyKey', 'schoolId', 'classId', 'courseId'\]\.includes\(key\)\) \{\s*clearPrivateDownstream\(\)/);
assert.match(teacherSource, /state\.selected\[key\] = nextValue;\s*renderWorkspace\(\);\s*setBusy\(true\)/);
assert.match(teacherSource, /const panels = \{\s*overview: renderOverviewPanel,\s*curriculum: renderCurriculumWorkspace,\s*grading: renderGradingWorkspace\s*\}/);
assert.match(teacherSource, /AstraTeacherLearningEvidence\.mount\(state\.root, \{\s*snapshot: teacherWorkflowSnapshot,\s*mutationState:/);
assert.match(teacherSource, /lockWrite: \(error, confirmed\) => \{\s*lockUnknownWrite\('追加式纠正', error, confirmed\)/);
assert.match(ownerSource, /querySelectorAll\('\[data-teacher-natural-workflow\]'\)/);
assert.match(clientSource, /async function teacherEvents\(/);
assert.match(clientSource, /async function appendTeacherCorrection\(/);
assert.doesNotMatch(teacherSource, /courseProgress|COURSE_PROGRESS_PAGE_LIMIT|data-learning-evidence-teacher-aggregate|\/api\/progress/);
assert.doesNotMatch(teacherSource, /\/api\/learning-evidence/);
assert.doesNotMatch(ownerSource, /\/api\/learning-evidence/);
for (const source of [teacherSource, ownerSource, clientSource]) {
  assert.doesNotMatch(source, /0051 aggregate|冻结 schema|rule version/i);
}
assert.ok((teacherSource.match(/\n/g) || []).length + 1 <= 2920, 'teacher.js must stay at or below the FE-038 host-integration ceiling');

const instrumented = teacherSource.replace(
  'window.initTeacher = initTeacher;',
  `window.__teacherNaturalTest = Object.freeze({
      state, loadSchoolScope, loadClassCourses, loadClassScope, loadCourseScope, handleScopeChange,
      captureReleaseDraft, parseReleaseDraft, releasePreview, validateReleasePlanResponse,
      updateReleasePlan, handleFormSubmit, applyWriteAvailability, clearWorkspace,
      applyApiBaseChange, loadCurriculumScope, clearPrivateDownstream, validateAssignmentSubmissionPage,
      changeCurriculumPage, loadCodeSubmissionDetails, renderSubmissionQueue, renderCodeSubmissionPanel,
      gradeSubmissionCommand, codeStatusOutcome, codeStatusMessage
  });
  window.initTeacher = initTeacher;`,
);
assert.notEqual(instrumented, teacherSource, 'teacher test instrumentation must apply');

const calls = [];
const responses = new Map();
const fakeRoot = {
  classList: { toggle() {} },
  querySelector() { return null; },
  querySelectorAll() { return []; },
};
const context = {
  AbortController,
  console,
  document: {},
  FormData,
  Intl,
  navigator: { onLine: true },
  setTimeout,
  clearTimeout,
  URL,
  URLSearchParams,
};
context.window = context;
context.AstraApiClient = {
  request(url, options = {}) {
    calls.push({ url, options });
    const response = responses.get(url);
    return Promise.resolve(typeof response === 'function' ? response(options) : response);
  },
  message(error) { return error && error.message || '请求失败'; },
  isAmbiguousMutation(error) { return Boolean(error && error.ambiguous); },
  normalizeBaseUrl(value) { return String(value || '').trim().replace(/\/+$/, ''); },
};
vm.createContext(context);
vm.runInContext(instrumented, context, { filename: 'pages/teacher/teacher.js' });
const api = context.__teacherNaturalTest;

const ownerInstrumented = ownerSource.replace(
  'global.AstraTeacherLearningEvidence = Object.freeze({',
  `global.__teacherOwnerTest = Object.freeze({
      validateProgressPage, progressRowsMarkup, studentPreviewMarkup,
      evidenceItemsMarkup, evidenceDialogMarkup, loadEvidence, applyEvidenceFilters,
      clearWorkflowState, blockForAuthority, releasePreviewMarkup, confirmReleasePlan,
      openDialog, closeDialog, trapDialogKeydown, handleClick, handleScopeChange,
      refreshSession, evaluate, submitCorrection, mount, destroy,
      activate(session) { active = session; }, current() { return active; }
  });
  global.AstraTeacherLearningEvidence = Object.freeze({`,
);
assert.notEqual(ownerInstrumented, ownerSource, 'owner test instrumentation must apply');
const documentListeners = new Map();
const ownerContext = {
  AbortController,
  console,
  document: {
    activeElement: null,
    addEventListener(type, listener, capture) { documentListeners.set(`${type}:${capture}`, listener); },
    removeEventListener(type, listener, capture) {
      if (documentListeners.get(`${type}:${capture}`) === listener) documentListeners.delete(`${type}:${capture}`);
    },
  },
  MutationObserver: class {
    observe() {}
    disconnect() {}
  },
  setTimeout,
  clearTimeout,
  Intl,
};
ownerContext.window = ownerContext;
ownerContext.AstraApiClient = {
  normalizeBaseUrl(value) { return String(value || '').replace(/\/+$/, ''); },
  request() { throw new Error('unexpected progress request'); },
};
ownerContext.AstraLearningEvidenceClient = {
  normalizeError(error) { return error; },
  subscribe() { return () => {}; },
  teacherAggregate() { throw new Error('unexpected aggregate request'); },
  teacherEvents() { throw new Error('teacherEvents stub not installed'); },
};
vm.createContext(ownerContext);
vm.runInContext(ownerInstrumented, ownerContext, { filename: 'shared/js/teacher-learning-evidence.js' });
const owner = ownerContext.__teacherOwnerTest;

const clientInstrumented = clientSource.replace(
  'global.AstraLearningEvidenceClient = Object.freeze({',
  `global.__teacherClientTest = Object.freeze({
      assertTeacherEventsResponse,
      activateAuthority() {
          configured = true;
          destroyed = false;
          authorityGeneration += 1;
          authorityAbortController = new AbortController();
      }
  });
  global.AstraLearningEvidenceClient = Object.freeze({`,
);
assert.notEqual(clientInstrumented, clientSource, 'client test instrumentation must apply');
const clientContext = {
  AbortController,
  console,
  crypto: webcrypto,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  TextEncoder,
  addEventListener() {},
  removeEventListener() {},
};
clientContext.window = clientContext;
vm.createContext(clientContext);
vm.runInContext(clientInstrumented, clientContext, { filename: 'shared/js/learning-evidence-client.js' });
const clientTest = clientContext.__teacherClientTest;

function reset(role) {
  calls.length = 0;
  responses.clear();
  api.state.active = true;
  api.state.root = fakeRoot;
  api.state.user = { id: 7, role };
  api.state.selected.schoolId = '1';
  api.state.selected.classId = '';
  api.state.selected.courseId = '';
  api.state.filters.galaxyKey = '';
  api.state.errors = {};
  api.state.lifecycleController = new AbortController();
  api.state.requestGeneration += 1;
  return api.state.requestGeneration;
}

function releaseForm(values, reason = '第二周开放练习') {
  const rows = values.map((value) => {
    const controls = {
      position: { value: String(value.position) },
      release_mode: { value: value.releaseMode },
      open_at: { value: value.openAt || '' },
      prerequisite_unit_id: { value: value.prerequisiteUnitId ? String(value.prerequisiteUnitId) : '' },
    };
    return {
      dataset: { unitId: String(value.courseUnitId) },
      querySelector(selector) {
        const field = selector.match(/data-teacher-plan-field="([^"]+)"/);
        return field ? controls[field[1]] : null;
      },
    };
  });
  const reasonField = { value: reason };
  return {
    querySelectorAll(selector) { return selector === '[data-teacher-plan-row]' ? rows : []; },
    querySelector(selector) { return selector === '[name="reason"]' ? reasonField : null; },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function scopedPage(items, limit, offset = 0, total = offset + items.length) {
  return { items, total, limit, offset, next_offset: offset + items.length < total ? offset + items.length : null };
}

function pendingSubmission(id, courseId, courseTitle, assignmentTitle = `${courseTitle} review`) {
  return {
    id, assignment_id: id + 1000, assignment_title: assignmentTitle, student_id: 31,
    student_username: 'student', student_display_name: '演示学生', class_id: 11, class_name: '一班',
    school_id: 1, course_id: courseId, course_title: courseTitle, status: 'submitted', score: null,
    submitted_at: '2026-08-09T01:00:00Z', graded_at: null, due_at: null,
  };
}

function codeSubmission(id, courseId, activityKey) {
  return {
    id, school_id: 1, course_id: courseId, class_id: 11, course_unit_id: courseId + 100,
    activity_key: activityKey, problem_id: id + 1000, problem_version_id: id + 2000, student_id: 31,
    language: 'javascript', status: 'accepted', result_summary: {}, source_sha256: `${id}`.padStart(64, '0'),
    created_at: '2026-08-09T01:00:00Z', judged_at: '2026-08-09T01:00:01Z', idempotent_replay: false,
  };
}

function codeAttempt(id, submissionId, errorCode) {
  return {
    id, submission_id: submissionId, attempt_number: id, status: 'accepted', adapter_name: 'runner', error_code: errorCode,
    created_at: '2026-08-09T01:00:00Z', started_at: null, finished_at: null,
  };
}

function releasePlan(classId, courseId) {
  return { course_id: courseId, class_id: classId, course_class_id: courseId + 400, plan_version: 1, changed: false, items: [] };
}

async function main() {
  let generation = reset('teacher');
  responses.set('/api/classes', [{ id: 11, name: '一班' }, { id: 12, name: '二班' }]);
  await api.loadSchoolScope(generation);
  const teacherClassCall = calls.find(call => call.url === '/api/classes');
  assert.deepEqual(
    JSON.parse(JSON.stringify(teacherClassCall.options.params)),
    { school_id: '1', mine: true },
    'teacher class discovery must carry mine=true',
  );
  assert.equal(api.state.selected.classId, '', 'multiple classes must not silently select the first class');
  assert.equal(calls.some(call => call.url === '/api/courses'), false, 'courses must wait for an explicit class');

  generation = reset('admin');
  responses.set('/api/classes', [{ id: 11, name: '一班' }, { id: 12, name: '二班' }]);
  await api.loadSchoolScope(generation);
  const adminClassCall = calls.find(call => call.url === '/api/classes');
  assert.deepEqual(
    JSON.parse(JSON.stringify(adminClassCall.options.params)),
    { school_id: '1' },
    'admin class discovery must omit the mine key entirely',
  );
  assert.equal(Object.hasOwn(adminClassCall.options.params, 'mine'), false);

  generation = reset('teacher');
  api.state.selected.classId = '11';
  responses.set('/api/courses', [{ id: 101, title: '课程甲' }, { id: 102, title: '课程乙' }]);
  await api.loadClassCourses(generation);
  const courseCall = calls.find(call => call.url === '/api/courses');
  assert.deepEqual(JSON.parse(JSON.stringify(courseCall.options.params)), { class_id: '11' });
  assert.equal(api.state.selected.courseId, '', 'multiple courses must not silently select the first course');

  api.state.selected.courseId = '101';
  responses.set('/api/courses/101/units', []);
  responses.set('/api/courses/101/assignments', []);
  responses.set('/api/courses/101/collaborators', []);
  await api.loadCourseScope(generation);
  const assignmentCall = calls.find(call => call.url === '/api/courses/101/assignments');
  assert.deepEqual(JSON.parse(JSON.stringify(assignmentCall.options.params)), { class_id: '11' });

  generation = reset('teacher');
  api.state.selected.classId = '11';
  api.state.selected.courseId = '';
  api.state.data.courses = [{ id: 101, title: 'Physics' }, { id: 202, title: 'Humanities Futures' }];
  const emptyMemberPage = scopedPage([], 50);
  responses.set('/api/classes/11/members/page', emptyMemberPage);
  responses.set('/api/classes/11/knowledge', { knowledge_stats: [{ activity_key: 'class.aggregate' }] });
  await api.loadClassScope(generation);
  assert.equal(calls.some(call => call.url === '/api/admin/submissions/pending'), false, 'empty course must not issue a private pending request');
  assert.equal(calls.filter(call => call.url === '/api/classes/11/members/page').length, 2, 'class-level roster reads must remain available without a course');
  for (const call of calls.filter(call => call.url === '/api/classes/11/members/page')) {
    assert.equal(Object.hasOwn(call.options.params, 'course_id'), false, 'class-level roster semantics must not acquire course_id');
  }
  const classKnowledgeCall = calls.find(call => call.url === '/api/classes/11/knowledge');
  assert.equal(classKnowledgeCall.options.params, undefined, 'true class-level knowledge aggregate must remain unfiltered without a course');
  assert.equal(api.state.data.submissions.length, 0);
  assert.match(api.renderSubmissionQueue(), /请选择班级与课程/);

  calls.length = 0;
  responses.clear();
  api.state.selected.courseId = '101';
  const physicsPending = scopedPage([pendingSubmission(901, 101, 'Physics')], 50);
  responses.set('/api/classes/11/members/page', emptyMemberPage);
  responses.set('/api/admin/submissions/pending', physicsPending);
  responses.set('/api/courses', [{ id: 101, title: 'Physics' }, { id: 202, title: 'Humanities Futures' }]);
  responses.set('/api/classes/11/knowledge', { knowledge_stats: [{ activity_key: 'physics.mechanics' }] });
  await api.loadClassScope(generation);
  const scopedPendingCall = calls.find(call => call.url === '/api/admin/submissions/pending');
  assert.deepEqual(JSON.parse(JSON.stringify(scopedPendingCall.options.params)), {
    class_id: '11', course_id: '101', status: 'submitted', limit: 50, offset: 0,
  });
  for (const call of calls.filter(call => call.url === '/api/classes/11/members/page')) {
    assert.equal(Object.hasOwn(call.options.params, 'course_id'), false, 'course selection must not narrow class-level roster reads');
  }
  assert.deepEqual(api.state.data.submissions.map(item => item.course_id), [101]);
  assert.match(api.renderSubmissionQueue(), /Physics/);
  assert.doesNotMatch(api.renderSubmissionQueue(), /Humanities Futures|Control Flow/);

  const mixedPending = scopedPage([
    pendingSubmission(901, 101, 'Physics'),
    pendingSubmission(902, 202, 'Humanities Futures', 'Control Flow review'),
  ], 50);
  responses.set('/api/admin/submissions/pending', mixedPending);
  await api.loadClassScope(generation);
  assert.equal(api.state.data.submissions.length, 0, 'one foreign pending row must reject the whole page before state write');
  assert.equal(api.state.errors.submissions.code, 'pending_submission_scope_invalid');
  assert.doesNotMatch(api.renderSubmissionQueue(), /Humanities Futures|Control Flow/);

  const invalidPendingCursorPages = [
    { marker: 'Pending Early Null', page: { ...scopedPage([pendingSubmission(903, 101, 'Physics', 'Pending Early Null')], 50, 0, 2), next_offset: null } },
    { marker: 'Pending Overlap', page: { ...scopedPage([
      pendingSubmission(904, 101, 'Physics', 'Pending Overlap A'),
      pendingSubmission(905, 101, 'Physics', 'Pending Overlap B'),
    ], 50, 0, 3), next_offset: 1 } },
    { marker: 'Pending Empty Gap', page: { ...scopedPage([], 50, 0, 1), next_offset: null } },
  ];
  for (const example of invalidPendingCursorPages) {
    responses.set('/api/admin/submissions/pending', example.page);
    await api.loadClassScope(generation);
    assert.equal(api.state.data.submissions.length, 0, `${example.marker} must not enter pending state`);
    assert.equal(api.state.errors.submissions.code, 'pending_submission_scope_invalid');
    assert.doesNotMatch(api.renderSubmissionQueue(), new RegExp(example.marker), `${example.marker} must not enter pending DOM`);
  }

  const denied = Object.assign(new Error('teacher scope denied'), { status: 403 });
  responses.set('/api/admin/submissions/pending', () => Promise.reject(denied));
  await api.loadClassScope(generation);
  assert.equal(api.state.data.submissions.length, 0, '403 must leave the course-sensitive queue empty');
  assert.equal(api.state.errors.submissions, denied);
  responses.set('/api/admin/submissions/pending', { ...physicsPending, offset: 50 });
  await api.loadClassScope(generation);
  assert.equal(api.state.data.submissions.length, 0, 'unexpected pending pagination metadata must fail closed');
  assert.equal(api.state.errors.submissions.code, 'pending_submission_scope_invalid');
  responses.set('/api/admin/submissions/pending', physicsPending);
  await api.loadClassScope(generation);
  assert.deepEqual(api.state.data.submissions.map(item => item.course_id), [101], 'a current-scope retry may repopulate the queue');

  const physicsCode = codeSubmission(911, 101, 'physics.mechanics');
  const foreignCode = codeSubmission(912, 202, 'control.flow');
  responses.set('/api/courses/101/classes/11/release-plan', releasePlan(11, 101));
  responses.set('/api/code-submissions', scopedPage([physicsCode, foreignCode], 100));
  await api.loadCurriculumScope(generation);
  const scopedCodeCall = calls.filter(call => call.url === '/api/code-submissions').at(-1);
  assert.deepEqual(JSON.parse(JSON.stringify(scopedCodeCall.options.params)), {
    class_id: '11', course_id: '101', limit: 100, offset: 0,
  });
  assert.equal(api.state.data.codeSubmissions, null, 'one foreign code row must reject the whole page before state write');
  assert.equal(api.state.errors.codeSubmissions.code, 'code_submission_scope_invalid');
  assert.doesNotMatch(api.renderCodeSubmissionPanel(), /Humanities Futures|Control Flow|control\.flow/);
  const invalidCodeCursorPages = [
    { marker: 'physics.early-null', page: { ...scopedPage([codeSubmission(914, 101, 'physics.early-null')], 100, 0, 2), next_offset: null } },
    { marker: 'physics.overlap', page: { ...scopedPage([
      codeSubmission(915, 101, 'physics.overlap'),
      codeSubmission(916, 101, 'physics.overlap-tail'),
    ], 100, 0, 3), next_offset: 1 } },
    { marker: 'physics.empty-gap', page: { ...scopedPage([], 100, 0, 1), next_offset: null } },
  ];
  for (const example of invalidCodeCursorPages) {
    responses.set('/api/code-submissions', example.page);
    await api.loadCurriculumScope(generation);
    assert.equal(api.state.data.codeSubmissions, null, `${example.marker} must not enter code state`);
    assert.equal(api.state.errors.codeSubmissions.code, 'code_submission_scope_invalid');
    assert.doesNotMatch(api.renderCodeSubmissionPanel(), new RegExp(example.marker.replace('.', '\\.')), `${example.marker} must not enter code DOM`);
  }
  responses.set('/api/code-submissions', scopedPage([physicsCode], 100));
  await api.loadCurriculumScope(generation);
  assert.deepEqual(api.state.data.codeSubmissions.items.map(item => item.course_id), [101]);
  assert.match(api.renderCodeSubmissionPanel(), /physics\.mechanics/);
  responses.set('/api/code-submissions', scopedPage([physicsCode], 100));
  await api.changeCurriculumPage('code', 100);
  assert.equal(api.state.errors.codeSubmissions.code, 'code_submission_scope_invalid', 'wrong code-page offset must fail closed');
  assert.doesNotMatch(api.renderCodeSubmissionPanel(), /physics\.mechanics/, 'pagination error must hide the prior page');
  const nextPhysicsCode = codeSubmission(913, 101, 'physics.energy');
  responses.set('/api/code-submissions', scopedPage([nextPhysicsCode], 100, 100, 101));
  await api.changeCurriculumPage('code', 100);
  assert.equal(api.state.errors.codeSubmissions, null);
  assert.deepEqual(api.state.data.codeSubmissions.items.map(item => item.course_id), [101]);
  api.state.selected.codeSubmissionId = '913';
  const validPhysicsSource = { submission_id: 913, language: 'javascript', source_code: 'const energy = true;', stdin: '' };
  const invalidAttemptCursorPages = [
    { marker: 'ATTEMPT_EARLY_NULL', page: { ...scopedPage([codeAttempt(3, 913, 'ATTEMPT_EARLY_NULL')], 20, 0, 2), next_offset: null } },
    { marker: 'ATTEMPT_OVERLAP', page: { ...scopedPage([
      codeAttempt(4, 913, 'ATTEMPT_OVERLAP'), codeAttempt(5, 913, 'ATTEMPT_OVERLAP_TAIL'),
    ], 20, 0, 3), next_offset: 1 } },
    { marker: 'ATTEMPT_EMPTY_GAP', page: { ...scopedPage([], 20, 0, 1), next_offset: null } },
  ];
  for (const example of invalidAttemptCursorPages) {
    responses.set('/api/code-submissions/913/source', validPhysicsSource);
    responses.set('/api/code-submissions/913/attempts/page', example.page);
    await api.loadCodeSubmissionDetails('913');
    assert.equal(api.state.data.codeSubmissionAttempts.length, 0, `${example.marker} must not enter attempt state`);
    assert.equal(api.state.errors.codeSubmissionAttempts.code, 'code_submission_attempt_scope_invalid');
    assert.doesNotMatch(api.renderCodeSubmissionPanel(), new RegExp(example.marker), `${example.marker} must not enter attempt DOM`);
  }
  responses.set('/api/code-submissions/913/source', { submission_id: 999, language: 'javascript', source_code: 'foreign', stdin: '' });
  responses.set('/api/code-submissions/913/attempts/page', scopedPage([{
    id: 1, submission_id: 999, attempt_number: 1, status: 'accepted', adapter_name: 'runner', error_code: null,
    created_at: '2026-08-09T01:00:00Z', started_at: null, finished_at: null,
  }], 20));
  await api.loadCodeSubmissionDetails('913');
  assert.equal(api.state.data.codeSubmissionSource, null);
  assert.equal(api.state.data.codeSubmissionAttempts.length, 0);
  assert.equal(api.state.errors.codeSubmissionSource.code, 'code_submission_source_scope_invalid');
  assert.equal(api.state.errors.codeSubmissionAttempts.code, 'code_submission_attempt_scope_invalid');
  responses.set('/api/code-submissions/913/source', validPhysicsSource);
  responses.set('/api/code-submissions/913/attempts/page', scopedPage([{
    id: 2, submission_id: 913, attempt_number: 1, status: 'accepted', adapter_name: 'runner', error_code: null,
    created_at: '2026-08-09T01:00:00Z', started_at: null, finished_at: null,
  }], 20));
  await api.loadCodeSubmissionDetails('913');
  assert.equal(api.state.data.codeSubmissionSource.submission_id, 913);
  assert.deepEqual(api.state.data.codeSubmissionAttempts.map(item => item.submission_id), [913]);

  generation = reset('teacher');
  api.state.selected.classId = '11';
  api.state.selected.courseId = '202';
  api.state.data.classes = [{ id: 11, name: '一班' }];
  api.state.data.courses = [{ id: 101, title: 'Physics' }, { id: 202, title: 'Humanities Futures' }];
  const stalePending = deferred(), staleCode = deferred();
  responses.set('/api/classes/11/members/page', emptyMemberPage);
  responses.set('/api/admin/submissions/pending', options => String(options.params.course_id) === '202'
    ? stalePending.promise : scopedPage([pendingSubmission(921, 101, 'Physics')], 50));
  responses.set('/api/courses', api.state.data.courses);
  responses.set('/api/classes/11/knowledge', { knowledge_stats: [] });
  responses.set('/api/courses/101/units', []);
  responses.set('/api/courses/101/assignments', []);
  responses.set('/api/courses/101/collaborators', []);
  responses.set('/api/courses/202/classes/11/release-plan', releasePlan(11, 202));
  responses.set('/api/courses/101/classes/11/release-plan', releasePlan(11, 101));
  responses.set('/api/code-submissions', options => String(options.params.course_id) === '202'
    ? staleCode.promise : scopedPage([codeSubmission(922, 101, 'physics.mechanics')], 100));
  const staleController = api.state.lifecycleController;
  const stalePendingLoad = api.loadClassScope(generation);
  const staleCodeLoad = api.loadCurriculumScope(generation);
  await new Promise(resolve => setTimeout(resolve, 0));
  await api.handleScopeChange({ dataset: { teacherScope: 'courseId' }, value: '101' });
  assert.equal(staleController.signal.aborted, true, 'course switch must abort the previous private-read generation');
  stalePending.resolve(scopedPage([pendingSubmission(923, 202, 'Humanities Futures', 'Control Flow review')], 50));
  staleCode.resolve(scopedPage([codeSubmission(924, 202, 'control.flow')], 100));
  await Promise.all([stalePendingLoad, staleCodeLoad]);
  assert.equal(api.state.selected.courseId, '101');
  assert.deepEqual(api.state.data.submissions.map(item => item.course_id), [101]);
  assert.deepEqual(api.state.data.codeSubmissions.items.map(item => item.course_id), [101]);
  assert.doesNotMatch(`${api.renderSubmissionQueue()}${api.renderCodeSubmissionPanel()}`, /Humanities Futures|Control Flow|control\.flow/,
    'late old-course rows must not enter current Physics state or DOM');

  const oldController = api.state.lifecycleController;
  api.state.data.units = [{ id: 1 }];
  api.state.data.assignments = [{ id: 2 }];
  api.state.data.submissions = [{ id: 3 }];
  api.state.data.codeSubmissionSource = { source_code: 'private' };
  await api.handleScopeChange({ dataset: { teacherScope: 'schoolId' }, value: '' });
  assert.equal(oldController.signal.aborted, true, 'scope switch must abort the previous request generation');
  assert.equal(api.state.data.units.length, 0);
  assert.equal(api.state.data.assignments.length, 0);
  assert.equal(api.state.data.submissions.length, 0);
  assert.equal(api.state.data.codeSubmissionSource, null);

  const staleAssignments = deferred();
  generation = api.state.requestGeneration;
  api.state.selected.classId = '11';
  api.state.selected.courseId = '101';
  responses.set('/api/courses/101/units', []);
  responses.set('/api/courses/101/assignments', () => staleAssignments.promise);
  responses.set('/api/courses/101/collaborators', []);
  const staleCourseLoad = api.loadCourseScope(generation);
  const oldSecret = 'old-scope-private-value';
  Object.assign(api.state.data, {
    members: [{ display_name: oldSecret }],
    activeStudents: [{ display_name: oldSecret }],
    units: [{ title: oldSecret }],
    assignments: [{ title: oldSecret }],
    submissions: [{ content: oldSecret }],
    collaborators: [{ name: oldSecret }],
    releasePlan: { secret: oldSecret },
    codeSubmissionSource: { source_code: oldSecret },
    codeSubmissionAttempts: [{ output: oldSecret }],
  });
  let evidenceDialogOpen = true;
  let authorityClears = 0;
  context.AstraTeacherLearningEvidence = {
    isMutationPending() { return false; },
    clearScope() { authorityClears += 1; evidenceDialogOpen = false; },
  };
  const panels = { innerHTML: oldSecret, dataset: {}, setAttribute() {} };
  api.state.root = {
    classList: { toggle() {} },
    querySelector(selector) { return selector === '[data-teacher-panels]' ? panels : null; },
    querySelectorAll() { return []; },
  };
  const newPlan = {
    course_id: 202, class_id: 12, course_class_id: 512, plan_version: 1, changed: false, items: [],
  };
  responses.set('/api/courses', options => options.params && String(options.params.class_id) === '12'
    ? [{ id: 202, title: '新课程' }]
    : []);
  responses.set('/api/classes/12/members/page', { items: [], total: 0, limit: 50, offset: 0, next_offset: null });
  responses.set('/api/admin/submissions/pending', { items: [], total: 0, limit: 50, offset: 0, next_offset: null });
  responses.set('/api/classes/12/knowledge', { knowledge_stats: [] });
  responses.set('/api/courses/202/units', []);
  responses.set('/api/courses/202/assignments', []);
  responses.set('/api/courses/202/collaborators', []);
  responses.set('/api/courses/202/classes/12/release-plan', newPlan);
  responses.set('/api/code-submissions', { items: [], total: 0, limit: 100, offset: 0, next_offset: null });
  const newScopeLoad = api.handleScopeChange({ dataset: { teacherScope: 'classId' }, value: '12' });
  for (const key of ['members', 'activeStudents', 'units', 'assignments', 'submissions', 'collaborators', 'codeSubmissionAttempts']) {
    assert.equal(api.state.data[key].length, 0, `${key} must clear before the new class request resolves`);
  }
  assert.equal(api.state.data.releasePlan, null);
  assert.equal(api.state.data.codeSubmissionSource, null);
  assert.equal(evidenceDialogOpen, false, 'scope change must close and clear the evidence owner synchronously');
  assert.ok(authorityClears >= 1);
  assert.doesNotMatch(panels.innerHTML, new RegExp(oldSecret));
  await newScopeLoad;
  staleAssignments.resolve([{ id: 999, title: oldSecret }]);
  await staleCourseLoad;
  assert.equal(api.state.selected.classId, '12');
  assert.equal(api.state.selected.courseId, '202');
  assert.equal(api.state.data.assignments.some(item => item.title === oldSecret), false, 'late old assignment response must not overwrite the new scope');
  api.state.root = fakeRoot;
  generation = api.state.requestGeneration;

  const planUrl = '/api/courses/101/classes/11/release-plan';
  const originalPlan = {
    course_id: 101,
    class_id: 11,
    course_class_id: 501,
    plan_version: 3,
    changed: false,
    items: [
      {
        id: 701, course_unit_id: 201, activity_key: 'physics.mechanics', position: 1,
        release_mode: 'open', open_at: null, prerequisite_unit_id: null,
        effective_release_state: 'open', lock_reasons: [],
      },
      {
        id: 702, course_unit_id: 202, activity_key: 'physics.gas-laws', position: 2,
        release_mode: 'locked', open_at: null, prerequisite_unit_id: 201,
        effective_release_state: 'locked', lock_reasons: ['manual_locked'],
      },
    ],
  };
  const changedItems = [
    { courseUnitId: 201, position: 1, releaseMode: 'open', openAt: '', prerequisiteUnitId: null },
    { courseUnitId: 202, position: 2, releaseMode: 'open', openAt: '2026-08-01T09:00', prerequisiteUnitId: 201 },
  ];
  const patchItems = [
    { course_unit_id: 201, position: 1, release_mode: 'open', open_at: null, prerequisite_unit_id: null },
    { course_unit_id: 202, position: 2, release_mode: 'open', open_at: '2026-08-01T01:00:00.000Z', prerequisite_unit_id: 201 },
  ];
  const patchPlan = {
    ...originalPlan,
    plan_version: 4,
    changed: true,
    items: originalPlan.items.map((item, index) => ({
      ...item,
      ...patchItems[index],
      effective_release_state: patchItems[index].release_mode,
      lock_reasons: [],
    })),
  };
  const authoritativePlan = { ...patchPlan, changed: false };
  api.state.selected.classId = '11';
  api.state.selected.courseId = '101';
  api.state.data.classes = [{ id: 11, name: '一班' }];
  api.state.data.courses = [{ id: 101, title: '力学实验' }];
  api.state.data.units = [{ id: 201, title: '机械能守恒' }, { id: 202, title: '气体状态' }];
  api.state.data.curriculumAttached = true;
  api.state.data.releasePlan = originalPlan;
  api.state.releaseDraft = null;
  api.state.writeLock = null;
  const codePage = { items: [], total: 0, limit: 100, offset: 0, next_offset: null };
  responses.set('/api/courses', [{ id: 101, title: '力学实验' }]);
  responses.set('/api/code-submissions', codePage);
  responses.set(planUrl, { ...originalPlan, class_id: 12 });
  await api.loadCurriculumScope(generation);
  assert.equal(api.state.data.releasePlan, null, 'initial release GET with a foreign class must fail closed');
  assert.equal(api.state.errors.releasePlan.code, 'release_plan_schema_invalid');
  responses.set(planUrl, { ...originalPlan, course_id: 202 });
  await api.loadCurriculumScope(generation);
  assert.equal(api.state.data.releasePlan, null, 'initial release GET with a foreign course must fail closed');
  assert.equal(api.state.errors.releasePlan.code, 'release_plan_schema_invalid');
  responses.set(planUrl, {
    ...originalPlan,
    items: [originalPlan.items[0], { ...originalPlan.items[1], course_unit_id: 201 }],
  });
  await api.loadCurriculumScope(generation);
  assert.equal(api.state.data.releasePlan, null, 'initial release GET with malformed items must fail closed');
  assert.equal(api.state.errors.releasePlan.code, 'release_plan_schema_invalid');
  responses.set(planUrl, originalPlan);
  await api.loadCurriculumScope(generation);
  assert.equal(api.state.data.releasePlan.plan_version, 3);
  let preview = null;
  context.AstraTeacherLearningEvidence = {
    async confirmReleasePlan(value) { preview = value; return false; },
    clearScope() {},
  };
  calls.length = 0;
  assert.equal(await api.updateReleasePlan(releaseForm(changedItems)), 'cancelled');
  assert.equal(calls.filter(call => call.options.method === 'PATCH').length, 0, 'preview cancel must not write');
  assert.ok(api.state.releaseDraft, 'preview cancel must retain the exact draft');
  assert.deepEqual(
    JSON.parse(JSON.stringify(preview.items[1])),
    {
      courseUnitId: 202,
      label: '气体状态',
      before: { position: 2, releaseMode: 'locked', openAt: null, prerequisiteLabel: '机械能守恒' },
      after: { position: 2, releaseMode: 'open', openAt: '2026-08-01T01:00:00.000Z', prerequisiteLabel: '机械能守恒' },
    },
  );
  assert.equal(preview.reason, '第二周开放练习');

  context.AstraTeacherLearningEvidence.confirmReleasePlan = async () => true;
  calls.length = 0;
  responses.set(planUrl, options => options.method === 'PATCH' ? patchPlan : authoritativePlan);
  api.state.data.releasePlan = originalPlan;
  api.state.writeLock = null;
  assert.equal(await api.updateReleasePlan(releaseForm(changedItems)), 'success');
  assert.equal(calls.filter(call => call.options.method === 'PATCH').length, 1);
  assert.equal(calls.filter(call => !call.options.method).length, 1);
  assert.equal(calls.find(call => call.options.method === 'PATCH').options.body.expected_version, 3);
  assert.equal(api.state.data.releasePlan.plan_version, 4);
  assert.equal(api.state.releaseDraft, null);

  calls.length = 0;
  api.state.data.releasePlan = originalPlan;
  api.state.writeLock = null;
  responses.set(planUrl, options => options.method === 'PATCH' ? { ...patchPlan, class_id: 99 } : originalPlan);
  assert.equal(await api.updateReleasePlan(releaseForm(changedItems)), 'locked');
  assert.equal(calls.filter(call => call.options.method === 'PATCH').length, 1, 'invalid 2xx must never replay PATCH');
  assert.equal(calls.filter(call => !call.options.method).length, 1, 'invalid 2xx must trigger one authority GET');
  assert.equal(api.state.writeLock.confirmed, true);

  calls.length = 0;
  api.state.data.releasePlan = originalPlan;
  api.state.writeLock = null;
  const conflict = Object.assign(new Error('conflict'), { status: 409 });
  responses.set(planUrl, options => options.method === 'PATCH' ? Promise.reject(conflict) : authoritativePlan);
  assert.equal(await api.updateReleasePlan(releaseForm(changedItems)), 'conflict');
  assert.equal(calls.filter(call => call.options.method === 'PATCH').length, 1);
  assert.equal(calls.filter(call => !call.options.method).length, 1);
  assert.equal(api.state.releaseDraft.conflict, true);
  assert.equal(api.state.writeLock, null);

  calls.length = 0;
  api.state.data.releasePlan = originalPlan;
  api.state.writeLock = null;
  const ambiguous = Object.assign(new Error('unknown'), { ambiguous: true, requestId: 'release-unknown-1' });
  responses.set(planUrl, options => options.method === 'PATCH' ? Promise.reject(ambiguous) : authoritativePlan);
  assert.equal(await api.updateReleasePlan(releaseForm(changedItems)), 'locked');
  assert.equal(calls.filter(call => call.options.method === 'PATCH').length, 1);
  assert.equal(calls.filter(call => !call.options.method).length, 1);
  assert.equal(api.state.writeLock.requestId, 'release-unknown-1');

  const gradeUrl = '/api/submissions/801/grade';
  const submissionsUrl = '/api/assignments/301/submissions/page';
  const authoritativeSubmission = {
    id: 801,
    assignment_id: 301,
    student_id: 31,
    class_id: 11,
    content: { answer: 'server-owned' },
    status: 'graded',
    score: 88,
    feedback: '权威反馈',
    graded_by_user_id: 7,
    submitted_at: '2026-07-30T01:00:00Z',
    graded_at: '2026-07-30T03:00:00Z',
  };
  const submissionPage = {
    items: [authoritativeSubmission],
    total: 1,
    limit: 50,
    offset: 0,
    next_offset: null,
  };
  api.state.selected.assignmentId = '301';
  api.state.selected.classId = '11';
  api.state.pagination.assignmentSubmissionOffset = 0;
  api.state.data.assignmentSubmissions = [{ ...authoritativeSubmission, status: 'submitted', score: null, feedback: null, graded_by_user_id: null, graded_at: null }];
  api.state.writeLock = null;
  calls.length = 0;
  responses.set(gradeUrl, { ...authoritativeSubmission, score: 99, feedback: '不得信任 PATCH 本地回显' });
  responses.set(submissionsUrl, submissionPage);
  assert.equal(await api.gradeSubmissionCommand({ submission_id: '801', score: '99', feedback: '本地表单值', status: 'graded' }), 'success');
  assert.equal(calls.filter(call => call.url === gradeUrl && call.options.method === 'PATCH').length, 1);
  assert.equal(calls.filter(call => call.url === submissionsUrl).length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.find(call => call.url === submissionsUrl).options.params)), {
    class_id: 11, limit: 50, offset: 0,
  });
  assert.match(api.state.flash.message, /得分 88/);
  assert.doesNotMatch(api.state.flash.message, /99|本地表单值/);

  calls.length = 0;
  api.state.writeLock = null;
  responses.set(gradeUrl, () => Promise.reject(Object.assign(new Error('grade conflict'), { status: 409 })));
  assert.equal(await api.gradeSubmissionCommand({ submission_id: '801', score: '70', feedback: '', status: 'returned' }), 'conflict');
  assert.equal(calls.filter(call => call.url === gradeUrl).length, 1);
  assert.equal(calls.filter(call => call.url === submissionsUrl).length, 1);
  assert.equal(api.state.writeLock, null);

  calls.length = 0;
  api.state.writeLock = null;
  responses.set(gradeUrl, () => Promise.reject(Object.assign(new Error('grade unknown'), { ambiguous: true, requestId: 'grade-unknown-1' })));
  assert.equal(await api.gradeSubmissionCommand({ submission_id: '801', score: '70', feedback: '', status: 'returned' }), 'locked');
  assert.equal(calls.filter(call => call.url === gradeUrl).length, 1);
  assert.equal(calls.filter(call => call.url === submissionsUrl).length, 1);
  assert.equal(api.state.writeLock.requestId, 'grade-unknown-1');

  assert.equal(api.codeStatusOutcome('accepted'), 'success');
  assert.equal(api.codeStatusOutcome('runner_unavailable'), 'neutral');
  assert.equal(api.codeStatusOutcome('queued'), 'processing');
  assert.equal(api.codeStatusOutcome('running'), 'processing');
  for (const status of ['wrong_answer', 'browser_runtime_error', 'unknown']) {
    assert.equal(api.codeStatusOutcome(status), 'failure');
  }
  assert.match(api.codeStatusMessage('runner_unavailable'), /浏览器预检不等同正式通过/);
  assert.doesNotMatch(teacherSource, /result_summary/);
  const storageLines = Array.from(teacherSource.matchAll(/(?:localStorage|sessionStorage)[^\n]*/g), match => match[0]).join('\n');
  assert.doesNotMatch(storageLines, /source_code|codeSubmission|attempt/i);
  let baseAuthorityClears = 0;
  context.AstraTeacherLearningEvidence = { clearScope() { baseAuthorityClears += 1; } };
  api.state.active = false;
  api.state.root = fakeRoot;
  api.state.busy = false;
  api.state.apiBase = 'https://old.example.test';
  api.state.user = { id: 7, role: 'teacher' };
  api.state.data.members = [{ display_name: 'must-clear-on-base-change' }];
  api.applyApiBaseChange({ value: 'https://new.example.test/' });
  assert.equal(api.state.apiBase, 'https://new.example.test');
  assert.equal(api.state.user, null);
  assert.equal(api.state.data.members.length, 0);
  assert.ok(baseAuthorityClears >= 1, 'apiBase change must clear the evidence authority scope');

  const blocks = [
    {
      course_unit_id: 201,
      activity_key: 'physics.mechanics',
      position: 1,
      started: true,
      completed: false,
      submitted: 2,
      graded: 1,
      recent_activity_at: '2026-07-30T01:00:00Z',
      effective_release_state: 'open',
    },
    {
      course_unit_id: 202,
      activity_key: 'physics.gas-laws',
      position: 2,
      started: false,
      completed: false,
      submitted: 0,
      graded: 0,
      recent_activity_at: null,
      effective_release_state: 'locked',
    },
    {
      course_unit_id: 203,
      activity_key: 'physics.thermodynamics',
      position: 3,
      started: true,
      completed: true,
      submitted: 1,
      graded: 1,
      recent_activity_at: '2026-07-30T02:00:00Z',
      effective_release_state: 'hidden',
    },
  ];
  const progressPayload = {
    class_id: 11,
    course_id: 101,
    plan_version: 3,
    total: 1,
    limit: 50,
    offset: 0,
    next_offset: null,
    items: [{ student_id: 31, display_name: '演示学生', blocks }],
  };
  const safeProgress = owner.validateProgressPage(progressPayload, { classId: 11, courseId: 101 }, 0);
  const progressMarkup = owner.progressRowsMarkup({ progress: safeProgress });
  assert.match(progressMarkup, /<table[\s\S]*<details/);
  for (const label of ['开始', '完成', '提交', '评分', '最近活动']) assert.match(progressMarkup, new RegExp(label));
  assert.match(progressMarkup, /课程分块 1[\s\S]*课程分块 2/);
  assert.match(progressMarkup, /1 个隐藏分块未显示名称、标识或历史/);

  assert.throws(
    () => owner.validateProgressPage(
      { ...progressPayload, total: 2, items: [progressPayload.items[0], progressPayload.items[0]] },
      { classId: 11, courseId: 101 },
      0,
    ),
    error => error && error.code === 'progress_schema_invalid',
  );
  assert.throws(
    () => owner.validateProgressPage(
      { ...progressPayload, items: [{ ...progressPayload.items[0], blocks: [blocks[0], blocks[0]] }] },
      { classId: 11, courseId: 101 },
      0,
    ),
    error => error && error.code === 'progress_schema_invalid',
  );
  assert.throws(
    () => owner.validateProgressPage({ ...progressPayload, total: 0 }, { classId: 11, courseId: 101 }, 0),
    error => error && error.code === 'progress_schema_invalid',
  );

  const previewMarkup = owner.studentPreviewMarkup(progressPayload.items[0]);
  assert.match(previewMarkup, /课程分块 1/);
  assert.match(previewMarkup, /当前条件未满足/);
  assert.match(previewMarkup, /1 个隐藏分块未显示名称、标识或历史/);
  for (const secret of blocks.map(block => block.activity_key)) assert.doesNotMatch(previewMarkup, new RegExp(secret.replace('.', '\\.')));
  assert.doesNotMatch(previewMarkup, /<dt>开始|<dt>完成|最近活动/);

  const titleNode = {
    hidden: false,
    focus() { ownerContext.document.activeElement = this; },
    getAttribute() { return null; },
  };
  const firstDialogControl = {
    hidden: false,
    focus() { ownerContext.document.activeElement = this; },
    getAttribute() { return null; },
  };
  const lastDialogControl = {
    hidden: false,
    focus() { ownerContext.document.activeElement = this; },
    getAttribute() { return null; },
  };
  const returnButton = {
    isConnected: true,
    disabled: false,
    focused: 0,
    focus() { this.focused += 1; ownerContext.document.activeElement = this; },
  };
  const releaseDialog = {
    isConnected: true,
    open: false,
    innerHTML: '',
    querySelector(selector) { return selector === '[data-teacher-dialog-title]' ? titleNode : null; },
    querySelectorAll() { return [firstDialogControl, lastDialogControl]; },
    showModal() { this.open = true; },
    close() { this.open = false; },
    setAttribute(name) { if (name === 'open') this.open = true; },
    removeAttribute(name) { if (name === 'open') this.open = false; },
  };
  const releaseSession = {
    bridge: { snapshot: () => ({ role: 'teacher', online: true, curriculumAttached: true, classId: 11, courseId: 101 }) },
    destroyed: false,
    dialog: releaseDialog,
    returnFocus: null,
    releaseResolver: null,
    dialogCaptureBound: false,
    onDocumentKeydown: null,
  };
  owner.activate(releaseSession);
  ownerContext.document.activeElement = returnButton;
  const cancelledDecision = owner.confirmReleasePlan(preview);
  assert.equal(ownerContext.document.activeElement, titleNode, 'dialog title must receive focus synchronously');
  for (const label of ['顺序', '呈现', '开放时间', '前置分块', '调整说明', '第二周开放练习']) {
    assert.match(releaseDialog.innerHTML, new RegExp(label));
  }
  assert.equal(documentListeners.size, 1, 'dialog must own exactly one document-capture keydown listener');
  let prevented = 0;
  let stopped = 0;
  documentListeners.get('keydown:true')({
    key: 'Escape',
    preventDefault() { prevented += 1; },
    stopImmediatePropagation() { stopped += 1; },
  });
  assert.equal(await cancelledDecision, false);
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
  assert.equal(returnButton.focused, 1, 'Escape must return focus to the exact launch control');
  assert.equal(documentListeners.size, 0, 'close must release the capture listener');

  ownerContext.document.activeElement = returnButton;
  const confirmedDecision = owner.confirmReleasePlan(preview);
  ownerContext.document.activeElement = lastDialogControl;
  documentListeners.get('keydown:true')({
    key: 'Tab',
    shiftKey: false,
    preventDefault() { prevented += 1; },
  });
  assert.equal(ownerContext.document.activeElement, firstDialogControl, 'Tab must wrap inside the dialog');
  const confirmTarget = {
    closest(selector) { return selector === '[data-teacher-release-confirm]' ? this : null; },
  };
  owner.handleClick(releaseSession, { target: confirmTarget });
  assert.equal(await confirmedDecision, true);
  assert.equal(returnButton.focused, 2, 'confirm must return focus to the exact launch control');
  assert.equal(documentListeners.size, 0);

  const evidencePage = {
    total: 4,
    limit: 50,
    offset: 0,
    next_offset: null,
    items: [
      {
        event_id: 9001,
        subject_user_id: 31,
        course_unit_id: 201,
        assignment_id: null,
        activity_key: 'physics.mechanics',
        event_type: 'attempted',
        producer_type: 'learner',
        occurred_at: '2026-07-30T01:00:00Z',
        evidence_summary: { facts: { observation: '第一次观察' }, truncated: false },
        corrects_event_id: null,
        corrected_by_event_id: null,
      },
      {
        event_id: 9002,
        subject_user_id: 31,
        course_unit_id: 202,
        assignment_id: null,
        activity_key: 'physics.gas-laws',
        event_type: 'attempted',
        producer_type: 'learner',
        occurred_at: '2026-07-30T01:05:00Z',
        evidence_summary: { facts: {}, truncated: true },
        corrects_event_id: null,
        corrected_by_event_id: null,
      },
      {
        event_id: 9003,
        subject_user_id: 31,
        course_unit_id: 201,
        assignment_id: null,
        activity_key: 'physics.mechanics',
        event_type: 'completed',
        producer_type: 'trusted_assessment',
        occurred_at: '2026-07-30T01:10:00Z',
        evidence_summary: { facts: {}, truncated: false },
        corrects_event_id: null,
        corrected_by_event_id: null,
      },
      {
        event_id: 9004,
        subject_user_id: 31,
        course_unit_id: 203,
        assignment_id: null,
        activity_key: 'physics.thermodynamics',
        event_type: 'attempted',
        producer_type: 'learner',
        occurred_at: '2026-07-30T01:15:00Z',
        evidence_summary: { facts: {}, truncated: true },
        corrects_event_id: null,
        corrected_by_event_id: null,
      },
    ],
  };
  const evidenceSession = {
    progress: safeProgress,
    selectedStudentId: 31,
    selectedStudentLabel: '演示学生',
    evidencePage,
    evidenceFilters: { activityKey: '', eventType: '' },
    eventTokens: new Map(),
  };
  const evidenceMarkup = owner.evidenceItemsMarkup(evidenceSession);
  assert.equal((evidenceMarkup.match(/data-teacher-evidence-correction=/g) || []).length, 1);
  assert.match(evidenceMarkup, /当前分块不是明确开放状态，历史可查看，但不能新增纠正/);
  assert.doesNotMatch(evidenceMarkup, /9001|9002|9003|9004/);
  assert.deepEqual(Array.from(evidenceSession.eventTokens.values()), [9001, 9002, 9003, 9004]);
  assert.match(owner.evidenceDialogMarkup({ ...evidenceSession, evidenceError: '', evidenceStatus: '', evidenceStatusType: '' }), /data-teacher-evidence-filters[\s\S]*name="activity_key"[\s\S]*name="event_type"/);

  const expectedEvents = {
    classId: 11,
    courseId: 101,
    subjectUserId: 31,
    activityKey: undefined,
    eventType: undefined,
    limit: 50,
    offset: 0,
  };
  const eventResponse = { class_id: 11, course_id: 101, subject_user_id: 31, ...evidencePage };
  clientTest.assertTeacherEventsResponse(eventResponse, expectedEvents);
  assert.throws(
    () => clientTest.assertTeacherEventsResponse(
      { ...eventResponse, total: 5, items: [...eventResponse.items, eventResponse.items[0]] },
      expectedEvents,
    ),
    error => error && error.code === 'teacher_events_schema_invalid',
  );
  assert.throws(
    () => clientTest.assertTeacherEventsResponse(
      {
        ...eventResponse,
        items: [{ ...eventResponse.items[0], evidence_summary: { facts: { unsafe: 'x'.repeat(241) }, truncated: true } }],
      },
      expectedEvents,
    ),
    error => error && error.code === 'teacher_events_schema_invalid',
  );
  assert.throws(
    () => clientTest.assertTeacherEventsResponse({ ...eventResponse, total: 2 }, expectedEvents),
    error => error && error.code === 'teacher_events_schema_invalid',
  );

  const aggregateResponse = {
    class_id: 11,
    course_id: 101,
    rule_version: 1,
    active_students: 1,
    generated_at: '2026-07-30T04:00:00Z',
    activities: [{
      course_unit_id: 201,
      activity_key: 'physics.mechanics',
      not_started: 0,
      in_progress: 1,
      completed: 0,
      transferred: 0,
      active_students: 1,
      completion_percent: 0,
    }],
  };
  const customBase = 'https://teacher-api.example.test/root';
  const correctionEvents = {
    ...eventResponse,
    items: eventResponse.items.map((item, index) => (
      index === 0 ? { ...item, corrected_by_event_id: 9100 } : item
    )),
  };
  function correctionSession(lockWrites, mutationStates) {
    const trigger = {
      isConnected: true,
      disabled: false,
      focused: 0,
      focus() { this.focused += 1; ownerContext.document.activeElement = this; },
    };
    const title = { focus() { ownerContext.document.activeElement = this; } };
    const dialog = {
      isConnected: true,
      open: true,
      innerHTML: '',
      querySelector(selector) { return selector === '[data-teacher-dialog-title]' ? title : null; },
      querySelectorAll() { return []; },
      showModal() { this.open = true; },
      close() { this.open = false; },
      setAttribute(name) { if (name === 'open') this.open = true; },
      removeAttribute(name) { if (name === 'open') this.open = false; },
    };
    const snapshot = {
      role: 'teacher',
      online: true,
      curriculumAttached: true,
      classId: 11,
      courseId: 101,
      classLabel: '一班',
      courseLabel: '力学实验',
      baseUrl: customBase,
    };
    return {
      root: { querySelectorAll() { return []; }, appendChild() {} },
      bridge: {
        snapshot: () => snapshot,
        mutationState(value) { mutationStates.push(value); },
        lockWrite(error, confirmed) { lockWrites.push({ error, confirmed }); },
      },
      destroyed: false,
      authorityReady: true,
      generation: 0,
      evidenceGeneration: 0,
      scopeKey: `${customBase}|11:101`,
      phase: 'ready',
      errorCode: '',
      progress: safeProgress,
      aggregate: aggregateResponse,
      progressOffset: 0,
      progressError: '',
      aggregateError: '',
      pendingRender: false,
      controller: null,
      evidenceController: null,
      correctionController: null,
      correctionInFlight: false,
      evidencePage,
      evidenceError: '',
      evidenceStatus: '',
      evidenceStatusType: '',
      selectedStudentId: 31,
      selectedStudentLabel: '演示学生',
      evidenceFilters: { activityKey: '', eventType: '' },
      eventTokens: new Map([['event-1', 9001]]),
      renderRevision: 0,
      timer: 0,
      dialog,
      dialogMode: 'evidence',
      dialogCloseRequested: false,
      returnFocus: trigger,
      releaseResolver: null,
      onDocumentKeydown: null,
      dialogCaptureBound: false,
    };
  }
  const correctionForm = {
    dataset: { teacherEvidenceCorrection: 'event-1' },
    querySelector(selector) {
      return selector === '[name="reason"]' ? { value: '教师核对后追加纠正', focus() {} } : null;
    },
  };
  async function runCorrectionCase(mode, closeDuringWrite) {
    const clientCalls = [];
    const progressCalls = [];
    const lockWrites = [];
    const mutationStates = [];
    const delayedReceipt = closeDuringWrite ? deferred() : null;
    clientTest.activateAuthority();
    clientContext.AstraApiClient = {
      normalizeBaseUrl(value) { return String(value || '').replace(/\/+$/, ''); },
      request(url, options = {}) {
        clientCalls.push({ url, options });
        if (url.endsWith('/events/9001/corrections')) {
          if (delayedReceipt) return delayedReceipt.promise;
          if (mode === '409') {
            throw Object.assign(new Error('already corrected'), {
              status: 409,
              code: 'event_already_corrected',
              mutation: true,
            });
          }
          if (mode === 'ambiguous') {
            throw Object.assign(new Error('transport result unknown'), {
              ambiguous: true,
              mutation: true,
              requestId: 'correction-unknown-1',
            });
          }
          if (mode === 'invalid2xx') {
            return {
              event_id: 9100,
              client_event_id: options.body.client_event_id,
              event_type: 'wrong-type',
              outcome: 'accepted',
              received_at: '2026-07-30T04:01:00Z',
            };
          }
          return {
            event_id: 9100,
            client_event_id: options.body.client_event_id,
            event_type: 'administrative_correction',
            outcome: mode === 'duplicate' ? 'duplicate' : 'accepted',
            received_at: '2026-07-30T04:01:00Z',
          };
        }
        if (url.endsWith('/classes/11/courses/101/events')) return correctionEvents;
        if (url.endsWith('/classes/11/courses/101/aggregate')) return aggregateResponse;
        throw new Error(`unexpected client request ${url}`);
      },
    };
    ownerContext.AstraLearningEvidenceClient = clientContext.AstraLearningEvidenceClient;
    ownerContext.AstraApiClient.request = (url, options = {}) => {
      progressCalls.push({ url, options });
      return Promise.resolve(progressPayload);
    };
    const session = correctionSession(lockWrites, mutationStates);
    const launchControl = session.returnFocus;
    const nextBase = `https://next-${mode}.example.test/root`;
    const apiBaseInput = { value: nextBase, disabled: false, dataset: {} };
    const scopeInput = { disabled: false, dataset: {} };
    let baseAuthorityClears = 0;
    if (closeDuringWrite) {
      api.state.active = false;
      api.state.root = {
        classList: { toggle() {} },
        querySelector(selector) { return selector === '[data-teacher-api-base]' ? apiBaseInput : null; },
        querySelectorAll(selector) {
          return selector === '[data-teacher-scope], [data-teacher-api-base]' ? [scopeInput, apiBaseInput] : [];
        },
      };
      api.state.busy = false;
      api.state.mutationInFlight = false;
      api.state.evidenceMutationInFlight = false;
      api.state.apiBase = customBase;
      api.state.user = { id: 7, role: 'teacher' };
      context.AstraTeacherLearningEvidence = {
        isMutationPending() { return session.correctionInFlight; },
        clearScope() { baseAuthorityClears += 1; },
      };
      session.bridge.mutationState = (value) => {
        mutationStates.push(value);
        api.state.evidenceMutationInFlight = Boolean(value);
        api.applyWriteAvailability();
      };
    }
    owner.activate(session);
    const write = owner.submitCorrection(session, correctionForm);
    assert.equal(session.correctionInFlight, true);
    const correctionControllerBeforeScope = session.correctionController;
    owner.handleScopeChange(session, {
      target: { matches() { return true; } },
    });
    assert.equal(session.scopeKey, `${customBase}|11:101`, 'owner scope must stay fixed during correction/readback');
    assert.equal(correctionControllerBeforeScope.signal.aborted, false);
    if (closeDuringWrite) {
      owner.closeDialog(session);
      assert.equal(session.dialog.open, false);
      assert.equal(session.dialogCloseRequested, true);
      assert.equal(session.returnFocus, null);
      assert.equal(apiBaseInput.disabled, true, 'API source must be disabled during correction/readback');
      assert.equal(scopeInput.disabled, true, 'scope must be disabled during correction/readback');
      apiBaseInput.value = nextBase;
      assert.equal(api.applyApiBaseChange(apiBaseInput), false);
      assert.equal(api.state.apiBase, customBase, 'programmatic API source change must fail closed');
      assert.equal(apiBaseInput.value, customBase, 'blocked API source input must restore the authoritative value');
      assert.equal(correctionControllerBeforeScope.signal.aborted, false, 'API source attempt must not abort correction');
      assert.equal(clientCalls.filter(call => call.url.endsWith('/events/9001/corrections')).length, 1);
      assert.equal(baseAuthorityClears, 0);
      const mutationError = mode === '409'
        ? Object.assign(new Error('already corrected'), { status: 409, code: 'event_already_corrected', mutation: true })
        : Object.assign(new Error('transport result unknown'), { ambiguous: true, mutation: true, requestId: 'correction-unknown-1' });
      if (mode === '409' || mode === 'ambiguous') delayedReceipt.reject(mutationError);
      else delayedReceipt.resolve({
        event_id: 9100,
        client_event_id: clientCalls[0].options.body.client_event_id,
        event_type: 'administrative_correction',
        outcome: mode === 'duplicate' ? 'duplicate' : 'accepted',
        received_at: '2026-07-30T04:01:00Z',
      });
    }
    await write;
    const posts = clientCalls.filter(call => call.url.endsWith('/events/9001/corrections'));
    const eventReads = clientCalls.filter(call => call.url.endsWith('/classes/11/courses/101/events'));
    const aggregateReads = clientCalls.filter(call => call.url.endsWith('/classes/11/courses/101/aggregate'));
    assert.equal(posts.length, 1, `${mode} must send exactly one correction POST`);
    assert.equal(posts[0].options.method, 'POST');
    assert.equal(eventReads.length, 1, `${mode} must read authoritative events exactly once`);
    assert.equal(aggregateReads.length, 1, `${mode} must read authoritative aggregate exactly once`);
    assert.equal(progressCalls.length, 1, `${mode} must read authoritative progress exactly once`);
    for (const call of [...clientCalls, ...progressCalls]) {
      assert.equal(call.options.baseUrl, customBase, `${mode} must preserve one normalized apiBase`);
    }
    assert.deepEqual(mutationStates, [true, false]);
    if (closeDuringWrite) {
      assert.equal(apiBaseInput.disabled, false);
      assert.equal(scopeInput.disabled, false);
      apiBaseInput.value = nextBase;
      assert.equal(api.applyApiBaseChange(apiBaseInput), true);
      assert.equal(api.state.apiBase, nextBase, 'API source may change only after correction readback settles');
      assert.equal(baseAuthorityClears, 1, 'settled API source change must clear prior authority once');
      assert.equal(posts.length, 1, 'API source fencing must never replay the correction');
    }
    if (mode === 'ambiguous') {
      assert.equal(lockWrites.length, 1);
      assert.equal(lockWrites[0].confirmed, false);
    } else if (mode === 'invalid2xx') {
      assert.equal(lockWrites.length, 1);
      assert.equal(lockWrites[0].confirmed, true);
    } else {
      assert.equal(lockWrites.length, 0);
    }
    if (closeDuringWrite) {
      assert.equal(session.dialog.open, false, 'close intent must not reopen the evidence dialog after readback');
      assert.equal(session.returnFocus, null, 'late readback must not steal focus');
      assert.equal(launchControl.focused, 1, 'close may restore focus once, but readback must not focus again');
      assert.equal(session.selectedStudentId, 0);
    } else {
      owner.closeDialog(session, { restoreFocus: false });
    }
    if (session.timer) ownerContext.clearTimeout(session.timer);
  }
  await runCorrectionCase('accepted', false);
  await runCorrectionCase('duplicate', false);
  await runCorrectionCase('409', false);
  await runCorrectionCase('ambiguous', false);
  await runCorrectionCase('invalid2xx', false);
  await runCorrectionCase('accepted', true);
  await runCorrectionCase('duplicate', true);
  await runCorrectionCase('409', true);
  await runCorrectionCase('ambiguous', true);

  let raceAttached = false;
  const raceProgressCalls = [];
  const raceAggregateCalls = [];
  const raceProgressGate = deferred();
  const raceAggregateGate = deferred();
  let resolveReadyMarkup;
  const readyMarkup = new Promise(resolve => { resolveReadyMarkup = resolve; });
  const raceContainer = {
    dataset: {},
    markup: '',
    setAttribute() {},
    contains() { return false; },
    set innerHTML(value) {
      this.markup = value;
      if (value.includes('teacher-natural-progress-table')) resolveReadyMarkup();
    },
    get innerHTML() { return this.markup; },
  };
  const raceMutationStates = [];
  const raceSession = correctionSession([], raceMutationStates);
  raceSession.bridge.snapshot = () => ({
    role: 'teacher',
    online: true,
    curriculumAttached: raceAttached,
    classId: 11,
    courseId: 101,
    classLabel: '一班',
    courseLabel: '力学实验',
    baseUrl: customBase,
  });
  raceSession.root = {
    querySelectorAll(selector) { return selector === '[data-teacher-natural-workflow]' ? [raceContainer] : []; },
    appendChild() {},
  };
  raceSession.consumedAttachment = true;
  raceSession.progress = safeProgress;
  raceSession.aggregate = aggregateResponse;
  raceSession.progressOffset = 50;
  raceSession.progressError = 'old-progress-error';
  raceSession.aggregateError = 'old-aggregate-error';
  raceSession.pendingRender = true;
  raceSession.phase = 'loading';
  raceSession.errorCode = 'old-owner-error';
  raceSession.evidencePage = evidencePage;
  raceSession.evidenceError = 'old-evidence-error';
  raceSession.evidenceStatus = 'old-feedback';
  raceSession.evidenceStatusType = 'error';
  raceSession.selectedStudentId = 31;
  raceSession.selectedStudentLabel = 'old-private-student';
  raceSession.evidenceFilters = { activityKey: 'physics.mechanics', eventType: 'attempted' };
  raceSession.eventTokens.set('old-private-token', 9001);
  raceSession.dialog.open = true;
  raceSession.dialog.innerHTML = 'old-private-fact';
  raceSession.dialogMode = 'evidence';
  raceSession.dialogCloseRequested = true;
  raceSession.correctionInFlight = true;
  const initialProgressController = new AbortController();
  const initialEvidenceController = new AbortController();
  const initialCorrectionController = new AbortController();
  raceSession.controller = initialProgressController;
  raceSession.evidenceController = initialEvidenceController;
  raceSession.correctionController = initialCorrectionController;
  raceSession.timer = setTimeout(() => {}, 60_000);
  ownerContext.AstraApiClient.request = (url, options = {}) => {
    raceProgressCalls.push({ url, options });
    return raceProgressGate.promise;
  };
  ownerContext.AstraLearningEvidenceClient = {
    normalizeError(error) { return error; },
    subscribe() { return () => {}; },
    teacherAggregate(scope, options = {}) {
      raceAggregateCalls.push({ scope, options });
      return raceAggregateGate.promise;
    },
  };
  owner.activate(raceSession);
  await owner.refreshSession(raceSession, { clear: true });
  assert.equal(raceSession.scopeKey, `${customBase}|11:101`);
  assert.equal(raceSession.consumedAttachment, false);
  assert.equal(raceSession.errorCode, 'course_not_attached');
  assert.equal(raceProgressCalls.length, 0, 'detached scope must not request private progress');
  assert.equal(raceAggregateCalls.length, 0, 'detached scope must not request private aggregate');
  assert.equal(raceSession.progress, null);
  assert.equal(raceSession.aggregate, null);
  assert.equal(raceSession.progressOffset, 0);
  assert.equal(raceSession.pendingRender, false);
  assert.equal(raceSession.progressError, '');
  assert.equal(raceSession.aggregateError, '');
  assert.equal(raceSession.evidencePage, null);
  assert.equal(raceSession.evidenceError, '');
  assert.equal(raceSession.evidenceStatus, '');
  assert.equal(raceSession.evidenceStatusType, '');
  assert.equal(raceSession.selectedStudentId, 0);
  assert.equal(raceSession.selectedStudentLabel, '');
  assert.deepEqual(raceSession.evidenceFilters, { activityKey: '', eventType: '' });
  assert.equal(raceSession.eventTokens.size, 0);
  assert.equal(raceSession.dialog.open, false);
  assert.equal(raceSession.dialog.innerHTML, '');
  assert.equal(raceSession.dialogCloseRequested, false);
  assert.equal(raceSession.correctionInFlight, false);
  assert.equal(initialProgressController.signal.aborted, true);
  assert.equal(initialEvidenceController.signal.aborted, true);
  assert.equal(initialCorrectionController.signal.aborted, true);
  assert.equal(raceSession.timer, 0);
  assert.doesNotMatch(raceContainer.markup, /old-private/);

  raceAttached = true;
  owner.evaluate(raceSession);
  owner.evaluate(raceSession);
  owner.evaluate(raceSession);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(raceProgressCalls.length, 1, 'false→true must coalesce to one progress request');
  assert.equal(raceAggregateCalls.length, 1, 'false→true must coalesce to one aggregate request');
  assert.equal(raceProgressCalls[0].url, '/api/progress/courses/101/classes/11/students');
  assert.equal(raceProgressCalls[0].options.baseUrl, customBase);
  assert.deepEqual(
    JSON.parse(JSON.stringify(raceProgressCalls[0].options.params)),
    { limit: 50, offset: 0 },
  );
  assert.ok(raceProgressCalls[0].options.signal instanceof AbortSignal);
  assert.deepEqual(
    JSON.parse(JSON.stringify(raceAggregateCalls[0].scope)),
    { class_id: 11, course_id: 101 },
  );
  assert.equal(raceAggregateCalls[0].options.baseUrl, customBase);
  assert.ok(raceAggregateCalls[0].options.signal instanceof AbortSignal);
  raceProgressGate.resolve(progressPayload);
  raceAggregateGate.resolve(aggregateResponse);
  await readyMarkup;
  assert.equal(raceSession.consumedAttachment, true);
  assert.equal(raceSession.errorCode, '');
  assert.equal(raceSession.phase, 'ready');
  assert.ok(raceSession.progress);
  assert.ok(raceSession.aggregate);
  assert.match(raceContainer.markup, /teacher-natural-progress-table/);
  assert.match(raceContainer.markup, /teacher-progress-disclosure/);
  const steadyPollTimer = raceSession.timer;
  owner.evaluate(raceSession);
  owner.evaluate(raceSession);
  assert.equal(raceSession.timer, steadyPollTimer, 'repeated true state must not replace the normal poll timer');
  assert.equal(raceProgressCalls.length, 1);
  assert.equal(raceAggregateCalls.length, 1);

  raceSession.progressOffset = 50;
  raceSession.progressError = 'old-progress-error';
  raceSession.aggregateError = 'old-aggregate-error';
  raceSession.pendingRender = true;
  raceSession.phase = 'loading';
  raceSession.evidencePage = evidencePage;
  raceSession.evidenceError = 'old-evidence-error';
  raceSession.evidenceStatus = 'old-feedback';
  raceSession.evidenceStatusType = 'error';
  raceSession.selectedStudentId = 31;
  raceSession.selectedStudentLabel = 'old-private-student';
  raceSession.evidenceFilters = { activityKey: 'physics.mechanics', eventType: 'attempted' };
  raceSession.eventTokens.set('old-private-token', 9001);
  raceSession.dialog.open = true;
  raceSession.dialog.innerHTML = 'old-private-fact';
  raceSession.dialogMode = 'evidence';
  raceSession.dialogCloseRequested = true;
  raceSession.correctionInFlight = true;
  const detachedProgressController = new AbortController();
  const detachedEvidenceController = new AbortController();
  const detachedCorrectionController = new AbortController();
  raceSession.controller = detachedProgressController;
  raceSession.evidenceController = detachedEvidenceController;
  raceSession.correctionController = detachedCorrectionController;
  raceAttached = false;
  owner.evaluate(raceSession);
  owner.evaluate(raceSession);
  owner.evaluate(raceSession);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(raceSession.consumedAttachment, false);
  assert.equal(raceSession.scopeKey, `${customBase}|11:101`);
  assert.equal(raceSession.errorCode, 'course_not_attached');
  assert.equal(raceSession.phase, 'partial');
  assert.equal(raceProgressCalls.length, 1, 'true→false must not request progress');
  assert.equal(raceAggregateCalls.length, 1, 'true→false must not request aggregate');
  assert.equal(raceSession.progress, null);
  assert.equal(raceSession.aggregate, null);
  assert.equal(raceSession.progressOffset, 0);
  assert.equal(raceSession.pendingRender, false);
  assert.equal(raceSession.progressError, '');
  assert.equal(raceSession.aggregateError, '');
  assert.equal(raceSession.evidencePage, null);
  assert.equal(raceSession.evidenceError, '');
  assert.equal(raceSession.evidenceStatus, '');
  assert.equal(raceSession.evidenceStatusType, '');
  assert.equal(raceSession.selectedStudentId, 0);
  assert.equal(raceSession.selectedStudentLabel, '');
  assert.deepEqual(raceSession.evidenceFilters, { activityKey: '', eventType: '' });
  assert.equal(raceSession.eventTokens.size, 0);
  assert.equal(raceSession.dialog.open, false);
  assert.equal(raceSession.dialog.innerHTML, '');
  assert.equal(raceSession.dialogCloseRequested, false);
  assert.equal(raceSession.correctionInFlight, false);
  assert.equal(detachedProgressController.signal.aborted, true);
  assert.equal(detachedEvidenceController.signal.aborted, true);
  assert.equal(detachedCorrectionController.signal.aborted, true);
  assert.equal(raceSession.timer, 0);
  assert.doesNotMatch(raceContainer.markup, /old-private/);
  owner.evaluate(raceSession);
  owner.evaluate(raceSession);
  assert.equal(raceSession.timer, 0, 'repeated false state must not schedule a request storm');
  assert.equal(raceProgressCalls.length, 1);
  assert.equal(raceAggregateCalls.length, 1);

  let workflowWrites = 0;
  const focusedWorkflowNode = {};
  const workflowContainer = {
    dataset: {},
    setAttribute() {},
    contains(node) { return node === focusedWorkflowNode; },
    set innerHTML(value) { workflowWrites += 1; this.markup = value; },
    get innerHTML() { return this.markup || ''; },
  };
  const pollSession = correctionSession([], []);
  pollSession.dialog.open = false;
  pollSession.dialogMode = '';
  pollSession.root = { querySelectorAll() { return [workflowContainer]; } };
  pollSession.progress = safeProgress;
  pollSession.aggregate = aggregateResponse;
  ownerContext.AstraApiClient.request = () => Promise.resolve({ ...progressPayload, plan_version: 4 });
  ownerContext.AstraLearningEvidenceClient = {
    normalizeError(error) { return error; },
    subscribe() { return () => {}; },
    teacherAggregate() { return Promise.resolve({ ...aggregateResponse, generated_at: '2026-07-30T04:02:00Z' }); },
  };
  owner.activate(pollSession);
  ownerContext.document.activeElement = focusedWorkflowNode;
  await owner.refreshSession(pollSession, { clear: false, background: true });
  assert.equal(workflowWrites, 0, 'background poll must preserve a focused workflow node');
  assert.equal(pollSession.pendingRender, true);
  ownerContext.document.activeElement = null;
  await owner.refreshSession(pollSession, { clear: false, background: true });
  assert.equal(workflowWrites, 1, 'deferred poll render must apply once focus leaves');
  if (pollSession.timer) ownerContext.clearTimeout(pollSession.timer);

  api.state.active = true;
  api.state.root = fakeRoot;
  api.state.selected.classId = '11';
  api.state.evidenceMutationInFlight = true;
  await api.handleScopeChange({ dataset: { teacherScope: 'classId' }, value: '12' });
  assert.equal(api.state.selected.classId, '11', 'main scope must fail closed while correction authority readback is pending');
  api.state.evidenceMutationInFlight = false;

  const pending = [];
  ownerContext.AstraLearningEvidenceClient.teacherEvents = (scope, filters, options) => new Promise(resolve => {
    pending.push({ scope, filters, signal: options.signal, resolve });
  });
  const fakeDialog = {
    isConnected: true,
    open: true,
    innerHTML: '',
    querySelector() { return { focus() {} }; },
    close() { this.open = false; },
    setAttribute() { this.open = true; },
    removeAttribute() { this.open = false; },
    removeEventListener() {},
    remove() {},
  };
  const asyncSession = {
    bridge: { snapshot: () => ({ role: 'teacher', online: true, curriculumAttached: true, classId: 11, courseId: 101 }) },
    destroyed: false,
    evidenceGeneration: 0,
    evidenceController: null,
    correctionController: null,
    controller: null,
    generation: 0,
    progress: safeProgress,
    selectedStudentId: 31,
    selectedStudentLabel: '演示学生',
    evidencePage: null,
    evidenceError: '',
    evidenceStatus: '',
    evidenceStatusType: '',
    evidenceFilters: { activityKey: '', eventType: '' },
    eventTokens: new Map(),
    dialog: fakeDialog,
    returnFocus: null,
    focusTimer: 0,
    timer: setTimeout(() => {}, 60_000),
    releaseResolver: null,
    renderRevision: 0,
  };
  owner.activate(asyncSession);
  const firstLoad = owner.loadEvidence(asyncSession, 31, { offset: 50 });
  assert.equal(pending.length, 1);
  const filteredLoad = owner.applyEvidenceFilters(asyncSession, {
    querySelector(selector) {
      return { value: selector.includes('activity_key') ? 'physics.mechanics' : 'attempted' };
    },
  });
  assert.equal(pending.length, 2);
  assert.equal(pending[0].signal.aborted, true, 'filter change must abort the previous event request');
  assert.deepEqual(
    JSON.parse(JSON.stringify(pending[1].filters)),
    { activity_key: 'physics.mechanics', event_type: 'attempted', limit: 50, offset: 0 },
  );
  pending[1].resolve({ ...evidencePage, total: 1, items: [evidencePage.items[0]] });
  await filteredLoad;
  pending[0].resolve(evidencePage);
  await firstLoad;
  assert.equal(asyncSession.evidencePage.total, 1, 'late pre-filter response must not overwrite the filtered page');
  const closeLoad = owner.loadEvidence(asyncSession, 31, { offset: 0 });
  const closingRequest = pending.at(-1);
  owner.closeDialog(asyncSession);
  assert.equal(closingRequest.signal.aborted, true, 'closing evidence dialog must abort its GET');
  closingRequest.resolve(evidencePage);
  await closeLoad;
  assert.equal(asyncSession.evidencePage, null, 'late GET after close must not restore private evidence');
  assert.equal(asyncSession.selectedStudentId, 0);
  assert.equal(fakeDialog.open, false);

  const progressController = new AbortController();
  const eventsController = new AbortController();
  const correctionController = new AbortController();
  asyncSession.controller = progressController;
  asyncSession.evidenceController = eventsController;
  asyncSession.correctionController = correctionController;
  asyncSession.eventTokens.set('event-1', 9001);
  asyncSession.scopeKey = '11:101';
  asyncSession.authorityReady = true;
  const previousGeneration = asyncSession.generation;
  const previousEvidenceGeneration = asyncSession.evidenceGeneration;
  owner.blockForAuthority(asyncSession);
  assert.equal(asyncSession.authorityReady, false);
  assert.equal(progressController.signal.aborted, true);
  assert.equal(eventsController.signal.aborted, true);
  assert.equal(correctionController.signal.aborted, true);
  assert.equal(asyncSession.generation, previousGeneration + 1);
  assert.ok(asyncSession.evidenceGeneration > previousEvidenceGeneration);
  assert.equal(asyncSession.timer, 0);
  assert.equal(asyncSession.eventTokens.size, 0);
  assert.equal(fakeDialog.open, false);

  const listeners = new Map();
  const destroyRoot = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    querySelectorAll() { return []; },
  };
  owner.mount(destroyRoot, { snapshot: () => ({ role: 'teacher', online: true }) });
  const destroySession = owner.current();
  const destroyProgress = new AbortController();
  const destroyEvents = new AbortController();
  const destroyCorrection = new AbortController();
  destroySession.controller = destroyProgress;
  destroySession.evidenceController = destroyEvents;
  destroySession.correctionController = destroyCorrection;
  destroySession.eventTokens.set('event-1', 9001);
  const destroyGeneration = destroySession.generation;
  const destroyEvidenceGeneration = destroySession.evidenceGeneration;
  owner.destroy();
  assert.equal(destroyProgress.signal.aborted, true);
  assert.equal(destroyEvents.signal.aborted, true);
  assert.equal(destroyCorrection.signal.aborted, true);
  assert.equal(destroySession.generation, destroyGeneration + 1);
  assert.equal(destroySession.evidenceGeneration, destroyEvidenceGeneration + 1);
  assert.equal(destroySession.eventTokens.size, 0);
  assert.equal(owner.current(), null);
  assert.equal(listeners.size, 0);

  console.log('teacher-natural-workflow-contract: class/course isolation, pagination, stale response, progress, evidence, and lifecycle gates ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
