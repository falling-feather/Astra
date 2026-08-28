'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n?/g, '\n');

const ownerSource = read('shared/js/role-workbench-overview.js');
const bridgeSource = read('shared/js/role-workbench-bridge.js');
const styles = read('shared/css/role-workbench-overview.css');
const registry = read('shared/js/page-registry.js');

for (const phrase of ['课程健康矩阵', '星系视角', '课程视角', '教师责任动作', '定位处理']) {
  assert.ok(ownerSource.includes(phrase), `health matrix must explain ${phrase}`);
}
assert.doesNotMatch(ownerSource, /percent\s*>=\s*60/, 'frontend must not infer health from a progress threshold');
assert.match(ownerSource, /health\.reason/);
assert.match(ownerSource, /health\.facts\.map/);
assert.match(ownerSource, /health\.next_action\.label/);
assert.match(ownerSource, /data-course-health-galaxy/);
assert.match(ownerSource, /data-course-health-state/);

const states = [
  'awaiting_first_release',
  'pending_grading',
  'unpublished_changes',
  'no_learning_results',
  'healthy',
];
for (const state of states) {
  assert.ok(ownerSource.includes(`key: '${state}'`), `${state} must remain a supported fact state`);
  assert.ok(styles.includes(`[data-health-state="${state}"]`), `${state} must retain its own presentation tone`);
}
assert.match(styles, /\.role-workbench-health-filters\s*\{/);
assert.match(styles, /\.role-workbench-health-card__facts\s*\{/);
assert.match(styles, /\.role-workbench-health-card__action\s*\{[\s\S]*?min-height:\s*44px !important/);
assert.match(styles, /@media \(max-width: 700px\)[\s\S]*?\.role-workbench-health-card > footer/);
assert.doesNotMatch(styles, /100vw/);

for (const kind of ['open_course_content', 'open_course_grading', 'open_course_learning', 'open_course_governance']) {
  assert.ok(bridgeSource.includes(`'${kind}'`), `${kind} must route through the admin bridge`);
}
assert.match(bridgeSource, /data-admin-section-button="courses"/);
assert.match(bridgeSource, /data-admin-course-view="status"/);
assert.match(bridgeSource, /data-admin-course-select=/);
assert.match(registry, /ROLE_WORKBENCH_OVERVIEW_VERSION = '20260828v863CourseHealthMatrixP0'/);

const context = { window: {}, console, Date, Intl, AbortController, setTimeout, clearTimeout };
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(ownerSource, context, { filename: 'shared/js/role-workbench-overview.js' });
const contract = context.window.AstraRoleWorkbenchOverview.contract;

assert.equal(contract.VERSION, '20260828v863CourseHealthMatrixP0');
assert.deepEqual(Array.from(contract.healthStates, (item) => item.key), states);

const makeCourse = (courseId, galaxy, state, action) => ({
  course_id: courseId,
  title: `课程 ${courseId}`,
  galaxy_key: galaxy,
  subject_key: 'physics',
  current_release_number: state === 'awaiting_first_release' ? null : 1,
  active_student_count: 2,
  published_unit_count: 1,
  completed_activity_count: state === 'healthy' ? 1 : 0,
  pending_grading_count: state === 'pending_grading' ? 1 : 0,
  progress_percent: state === 'healthy' ? 50 : 0,
  health: {
    state,
    label: state,
    reason: `课程 ${courseId} 的真实原因`,
    facts: [
      { key: 'active_students', label: '在读学生', value: 2, unit: '人' },
      { key: 'release_count', label: '发布版本', value: state === 'awaiting_first_release' ? 0 : 1, unit: '个' },
    ],
    next_action: { kind: action, label: '下一步', section: 'teaching_snapshot', course_id: courseId },
  },
});

const courses = [
  makeCourse(1, 'englab', states[0], 'open_course_content'),
  makeCourse(2, 'englab', states[1], 'open_course_grading'),
  makeCourse(3, 'code-space', states[2], 'open_course_content'),
  makeCourse(4, 'future-galaxy', states[3], 'open_course_learning'),
  makeCourse(5, 'future-galaxy', states[4], 'open_course_governance'),
];
const snapshot = {
  published_courses: 5,
  draft_courses: 0,
  active_enrollments: 10,
  immutable_releases: 4,
  released_units: 4,
  completed_activities: 1,
  pending_grading: 1,
  galaxy_distribution: [],
  course_pulse: courses,
};

assert.doesNotThrow(() => contract.validateTeachingSnapshot(snapshot));
assert.deepEqual(
  Array.from(contract.filterCoursePulse(courses, { galaxy: 'englab', health: 'all' }), (item) => item.course_id),
  [1, 2],
);
assert.deepEqual(
  Array.from(contract.filterCoursePulse(courses, { galaxy: 'all', health: 'healthy' }), (item) => item.course_id),
  [5],
);
assert.throws(
  () => contract.validateTeachingSnapshot({ ...snapshot, course_pulse: [{ ...courses[0], health: { ...courses[0].health, facts: [] } }] }),
  /课程健康事实不完整/,
);
assert.throws(
  () => contract.validateTeachingSnapshot({ ...snapshot, course_pulse: [{ ...courses[0], health: { ...courses[0].health, next_action: { kind: 'delete_course', course_id: 1 } } }] }),
  /课程健康处理入口无法识别/,
);

console.log('course-health-fe044-contract: ok');
