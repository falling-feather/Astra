'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n?/g, '\n');
const generation = '20260828v864RoleWorkbenchHarmonyP0';

const overview = read('shared/js/role-workbench-overview.js');
const overviewStyles = read('shared/css/role-workbench-overview.css');
const bridge = read('shared/js/role-workbench-bridge.js');
const registry = read('shared/js/page-registry.js');
const serviceWorker = read('sw.js');
const studentShell = read('pages/student/student-workbench.js');
const studentEnrollment = read('pages/student/student-course-enrollment.js');
const teacher = read('pages/teacher/teacher.js');
const adminGovernance = read('pages/admin/admin-course-governance.js');

for (const label of [
  '学生工作台 · LEARNER',
  '教师工作台 · TEACHING',
  '管理员工作台 · GOVERNANCE',
  '课程、任务与学习回执已从当前账号同步',
  '课程、成员与教学待办已从当前学校同步',
  '审核、课程与组织状态已从管理范围同步',
]) {
  assert.ok(overview.includes(label), `${label} must remain part of the shared role language`);
}

for (const label of [
  '完成作业', '查看反馈', '管理课程', '审批申请', '继续备课', '批改作业',
  '审核申请', '审核课程', '查看组织', '待审批', '待发布', '待批改', '待审核',
]) {
  assert.ok(overview.includes(label), `${label} must remain an explicit role action or state`);
}
assert.doesNotMatch(overview, /共享草稿 revision|>去完成<|>看回执<|>管理</);
assert.match(overview, /function statusBadge\(label, tone\)/);
assert.match(overviewStyles, /\.role-workbench-row__headline\s*\{/);
assert.match(overviewStyles, /\.role-workbench-row__status\s*\{/);
assert.match(overviewStyles, /\.role-workbench-cockpit__clear\s*\{[\s\S]*?min-height:\s*44px/);
assert.match(overviewStyles, /\.role-workbench-cockpit__all\s*\{[\s\S]*?min-height:\s*44px/);
assert.match(overviewStyles, /\.role-workbench-health-filters button\s*\{[\s\S]*?min-height:\s*44px/);
for (const tone of ['warning', 'info', 'success', 'danger', 'readonly']) {
  assert.ok(overviewStyles.includes(`[data-tone="${tone}"]`), `${tone} must have an explicit shared status treatment`);
}
assert.match(overviewStyles, /@media \(max-width: 700px\)/);
assert.doesNotMatch(overviewStyles, /100vw/);

assert.match(studentEnrollment, /课程加入 · COURSE ACCESS/);
assert.match(studentEnrollment, /galaxyLabel\(course\.galaxy_key\)/);
assert.match(studentEnrollment, /subjectLabel\(course\.subject_key\)/);
assert.doesNotMatch(studentEnrollment, /\$\{escapeHtml\(course\.galaxy_key\)\} \/ \$\{escapeHtml\(course\.subject_key\)\}/);
assert.match(studentShell, new RegExp(`STUDENT_COURSE_ENROLLMENT_VERSION = '${generation}'`));

assert.match(teacher, /课程编排 · COURSE ORCHESTRATION/);
assert.match(teacher, /课程与班级范围已同步/);
assert.doesNotMatch(teacher, /\$\{course\.galaxy_key\}\/\$\{course\.course_key\}/);

for (const label of [
  '课程信息审核 · 第 ', '课程学习容器', '课程状态治理', '对账编号',
  '<dt>操作</dt>', '<dt>对象</dt>', '<dt>执行结果</dt>', '<dt>生效状态</dt>', '<dt>记录时间</dt>',
]) {
  assert.ok(adminGovernance.includes(label), `${label} must remain part of the administrator presentation`);
}
assert.match(adminGovernance, /galaxyLabel\(course\.galaxy_key\)/);
assert.match(adminGovernance, /subjectLabel\(course\.subject_key \|\| course\.course_key\)/);
assert.doesNotMatch(adminGovernance, /<span>COURSE #|<dt>Action<\/dt>|<dt>Resource<\/dt>|<dt>Request ID<\/dt>|Request ID:/);
assert.doesNotMatch(adminGovernance, /再次点击[^<]+PATCH|正在提交一条课程状态 PATCH/);

assert.match(registry, new RegExp(`ROLE_WORKBENCH_OVERVIEW_VERSION = '${generation}'`));
assert.match(serviceWorker, new RegExp(`astra-static-v${generation}`));

const context = { window: {}, console, Date, Intl, AbortController, setTimeout, clearTimeout };
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(overview, context, { filename: 'shared/js/role-workbench-overview.js' });
vm.runInContext(bridge, context, { filename: 'shared/js/role-workbench-bridge.js' });
assert.equal(context.window.AstraRoleWorkbenchOverview.contract.VERSION, generation);
assert.equal(context.window.AstraRoleWorkbenchBridge.contract.VERSION, generation);

console.log('role-workbench-ui017-contract: ok');
