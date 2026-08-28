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
const student = read('pages/student/student-workbench.js');
const teacher = read('pages/teacher/teacher.js');
const teacherCourseGrading = read('pages/teacher/teacher-course-grading.js');
const admin = read('pages/admin/admin.js');

assert.equal((ownerSource.match(/'\/api\/v1\/workbench'/g) || []).length, 1, 'the overview owner must expose one aggregate read path');
assert.doesNotMatch(ownerSource, /method:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/i, 'the overview owner must remain read-only');
assert.match(ownerSource, /params:\s*\{\s*limit:\s*6,\s*offset:\s*0\s*\}/);
assert.match(ownerSource, /data-role-workbench-action="retry"/);
assert.match(ownerSource, /section_errors/);
assert.match(ownerSource, /当前唯一下一步/);
assert.match(ownerSource, /课程、任务与学习回执已从当前账号同步/);
assert.match(ownerSource, /课程、成员与教学待办已从当前学校同步/);
assert.match(ownerSource, /审核、课程与组织状态已从管理范围同步/);
assert.match(ownerSource, /教学运行驾驶舱/);
assert.match(ownerSource, /TEACHING OPERATIONS/);
assert.match(ownerSource, /teaching_snapshot/);
assert.match(ownerSource, /galaxy_distribution/);
assert.match(ownerSource, /course_pulse/);
assert.match(ownerSource, /progress_percent/);
assert.match(ownerSource, /课程健康矩阵/);
assert.match(ownerSource, /教师责任动作/);

for (const [label, source, host] of [
  ['student', student, 'data-student-role-overview'],
  ['teacher', teacher, 'data-teacher-role-overview'],
  ['admin', admin, 'data-admin-role-overview'],
]) {
  assert.match(source, /import\('\.\.\/\.\.\/shared\/js\/role-workbench-bridge\.js\?v=20260828v864RoleWorkbenchHarmonyP0'\)/, `${label} must lazy-load the shared bridge`);
  assert.ok(source.includes(host), `${label} must provide its overview host`);
  assert.match(source, /roleWorkbench\('destroy'\)/, `${label} must destroy the overview owner on leave`);
  assert.match(source, /roleWorkbench\('reset'\)/, `${label} must clear stale role data before refresh`);
  assert.match(source, /roleWorkbench\('refresh'\)/, `${label} must refresh after server-side role confirmation`);
  assert.match(source, /if \(command !== 'refresh'\) return Promise\.resolve\(false\)/, `${label} must not lazy-load a stale reset or destroy command`);
}

assert.match(bridgeSource, /import\(OWNER_PATH\)/, 'the bridge must own the shared overview lazy-load');
assert.match(bridgeSource, /owner\.destroy\(\)/, 'the bridge must destroy its owner');
assert.match(bridgeSource, /owner\.reset\(\)/, 'the bridge must clear stale aggregate state');
assert.doesNotMatch(bridgeSource, /method:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/i, 'the bridge must remain navigation and read orchestration only');

assert.match(registry, /ROLE_WORKBENCH_OVERVIEW_VERSION = '20260828v864RoleWorkbenchHarmonyP0'/);
assert.equal((registry.match(/shared\/css\/role-workbench-overview\.css\?v=\$\{ROLE_WORKBENCH_OVERVIEW_VERSION\}/g) || []).length, 3);
assert.equal((registry.match(/shared\/js\/role-workbench-overview\.js\?v=\$\{ROLE_WORKBENCH_OVERVIEW_VERSION\}/g) || []).length, 3);
assert.equal((registry.match(/shared\/js\/role-workbench-bridge\.js\?v=\$\{ROLE_WORKBENCH_OVERVIEW_VERSION\}/g) || []).length, 3);

const studentOrder = ['我的课程', '最近任务', '继续上次学习', '提交与反馈', '课程入口'];
const teacherOrder = ['我的授课课程', '待审批学生', '有未发布修改的草稿', '待批改作业'];
const adminOrder = ['教师身份申请', '课程信息审核', '学校与班级提醒'];
for (const labels of [studentOrder, teacherOrder, adminOrder]) {
  let cursor = -1;
  for (const label of labels) {
    const next = ownerSource.indexOf(label, cursor + 1);
    assert.ok(next > cursor, `${label} must remain in the planned role information order`);
    cursor = next;
  }
}

for (const action of [
  'join_course', 'continue_assignment', 'continue_learning',
  'review_course_join_request', 'continue_course_draft', 'grade_submission',
  'review_teacher_application', 'review_course_information', 'review_organization_alert',
]) {
  assert.ok(ownerSource.includes(`'${action}'`), `overview must expose ${action}`);
}
assert.match(bridgeSource, /#student-course-enrollment-host/);
assert.match(bridgeSource, /data-teacher-course-membership/);
assert.match(bridgeSource, /data-teacher-course-content/);
assert.match(
  bridgeSource,
  /focusLater\(record, '\[data-teacher-course-authoring\]', '\[data-course-authoring-action="open"\]', true\)/,
  'the create shortcut must activate the nested V8.4 course wizard control',
);
assert.match(bridgeSource, /focusTeacherLegacyCourse\(record, action\.course_id\)/, 'legacy teaching courses must retain a visible management fallback');
assert.match(bridgeSource, /AstraTeacherWorkbenchScope\.openGrading\(action\)/, 'course-cohort grading must enter the existing teacher grading owner');
assert.match(teacher, /teacher-course-grading\.js\?v=\$\{TEACHER_ASSET_VERSION\}/);
assert.match(teacher, /AstraTeacherWorkbenchScope = Object\.freeze\(\{ openGrading:/);
assert.match(teacherCourseGrading, /课程直属名单（不关联行政班）/);
assert.match(teacherCourseGrading, /state\.data\.curriculumAttached = true;/);
assert.match(teacherCourseGrading, /AstraTeacherCourseGrading = Object\.freeze\(\{ open \}\)/);
assert.match(bridgeSource, /if \(String\(select\.value\) === normalized\) return false;/, 'a navigation shortcut must not emit duplicate scope changes');
assert.match(bridgeSource, /AdminSecondaryGovernance\.open/);
assert.match(bridgeSource, /data-admin-section-button=\"courses\"/);
assert.match(bridgeSource, /data-admin-section-button=\"organizations\"/);

assert.match(styles, /\.role-workbench-overview button\s*\{[\s\S]*?min-height:\s*44px/);
assert.match(styles, /@media \(max-width: 700px\)/);
assert.match(styles, /grid-template-columns:\s*1fr/);
assert.match(styles, /container-type:\s*inline-size/);
assert.match(styles, /@container \(max-width: 760px\)/);
assert.match(styles, /@container \(max-width: 560px\)/);
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
assert.doesNotMatch(styles, /100vw/);
assert.match(styles, /\.role-workbench-cockpit\s*\{/);
assert.match(styles, /\.role-workbench-cockpit__stage\s*\{[\s\S]*?grid-template-columns:/);
assert.match(styles, /\.role-workbench-health-card\s*\{/);
for (const state of ['awaiting_first_release', 'pending_grading', 'unpublished_changes', 'no_learning_results', 'healthy']) {
  assert.ok(styles.includes(`[data-health-state="${state}"]`), `${state} must have an explicit visual state`);
}

const context = { window: {}, console, Date, Intl, AbortController, setTimeout, clearTimeout };
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(ownerSource, context, { filename: 'shared/js/role-workbench-overview.js' });
const contract = context.window.AstraRoleWorkbenchOverview.contract;
assert.equal(contract.VERSION, '20260828v864RoleWorkbenchHarmonyP0');
assert.deepEqual(Array.from(contract.roles), ['student', 'teacher', 'admin']);
vm.runInContext(bridgeSource, context, { filename: 'shared/js/role-workbench-bridge.js' });
assert.equal(context.window.AstraRoleWorkbenchBridge.contract.VERSION, '20260828v864RoleWorkbenchHarmonyP0');
assert.deepEqual(
  JSON.parse(JSON.stringify(context.window.AstraRoleWorkbenchBridge.contract.HOST_SELECTORS)),
  {
    student: '[data-student-role-overview]',
    teacher: '[data-teacher-role-overview]',
    admin: '[data-admin-role-overview]',
  },
);

const page = (items = []) => ({ items, total: items.length, limit: 6, offset: 0, next_offset: null });
const primary = { kind: 'join_course', label: '加入一门课程', section: 'courses' };
const studentPayload = {
  role: 'student', generated_at: '2026-08-25T12:00:00Z', primary_action: primary,
  courses: page([]), assignments: page([]), continue_learning: null,
  submissions: { submitted: 0, graded: 0, returned: 0 }, homerooms: page([]), section_errors: [],
};
const teacherPayload = {
  role: 'teacher', generated_at: '2026-08-25T12:00:00Z',
  primary_action: { kind: 'create_course', label: '创建授课课程', section: 'courses' },
  courses: page([]), pending_students: page([]), unpublished_drafts: page([]), pending_grading: page([]), section_errors: [],
};
const adminPayload = {
  role: 'admin', generated_at: '2026-08-25T12:00:00Z',
  primary_action: { kind: 'open_governance', label: '查看治理总览', section: 'catalog_totals' },
  pending_teacher_applications: page([]), pending_course_revisions: page([]), organization_alerts: page([]),
  catalog_totals: { users: 0, courses: 0, active_schools: 0, active_homerooms: 0 }, section_errors: [],
};
assert.equal(contract.validatePayload(studentPayload, 'student'), studentPayload);
assert.equal(contract.validatePayload(teacherPayload, 'teacher'), teacherPayload);
assert.equal(contract.validatePayload(adminPayload, 'admin'), adminPayload);
assert.throws(() => contract.validatePayload(studentPayload, 'teacher'), /角色与当前身份不一致/);
assert.throws(() => contract.validatePayload({ ...adminPayload, catalog_totals: null }, 'admin'), /治理总数/);

const action = contract.actionFromControl({ dataset: {
  roleWorkbenchAction: 'grade_submission', section: 'pending_grading', courseId: '7',
  courseUnitId: '8', assignmentId: '9', classId: '10', submissionId: '11', requestId: '', revisionId: '', resourceId: '', activityKey: ''
} });
assert.deepEqual(JSON.parse(JSON.stringify(action)), {
  kind: 'grade_submission', section: 'pending_grading', course_id: 7, course_unit_id: 8,
  assignment_id: 9, class_id: 10, submission_id: 11, request_id: 0, revision_id: 0, resource_id: 0, activity_key: '',
});

console.log('role-workbench-fe042-contract: ok');
