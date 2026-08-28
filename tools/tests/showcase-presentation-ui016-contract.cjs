const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const generation = '20260828v861PresentationCleanupP3';
const roleHome = read('shared/js/role-home-client.js');
const authUi = read('shared/js/auth-ui.js');
const student = read('pages/student/student.js');
const studentWorkbench = read('pages/student/student-workbench.js');
const teacher = read('pages/teacher/teacher.js');
const teacherContent = read('pages/teacher/teacher-course-content.js');
const admin = read('pages/admin/admin.js');
const adminGovernance = read('pages/admin/admin-course-governance.js');
const manifest = read('backend/scripts/demo_data_manifest.py');
const initializer = read('backend/scripts/initialize_demo_data.py');
const registry = read('shared/js/page-registry.js');
const serviceWorker = read('sw.js');
const html = read('index.html');

assert.doesNotMatch(roleHome, /<strong>no_authoritative_task<\/strong>/);
assert.doesNotMatch(roleHome, /<strong>\$\{escapeHtml\(state\.issue\.code\)\}<\/strong>/);
assert.doesNotMatch(roleHome, /LEARNER PRIORITY|TEACHING PRIORITY|GOVERNANCE PRIORITY|Request ID \$\{requestId\}|课程 #\$\{course\.id\}/);
assert.match(roleHome, /学习优先级/);
assert.match(authUi, /ACCOUNT_STATUS_LABELS/);
assert.doesNotMatch(authUi, /\$\{escapeHtml\(user\.username \|\| ''\)\} · \$\{escapeHtml\(actual\.label\)\} · \$\{escapeHtml\(user\.status \|\| ''\)\}/);
for (const source of [student, studentWorkbench, teacher]) {
  assert.doesNotMatch(source, /RESOURCE FAIL-CLOSED/);
  assert.doesNotMatch(source, /<strong>\$\{escapeHtml\(issue\.code\)\}<\/strong>/);
}
for (const source of [student, studentWorkbench]) {
  assert.doesNotMatch(source, /JSON\.stringify\(content, null, 2\)/);
  assert.match(source, /已提交结构化作答/);
  assert.match(source, /LEGACY_DEMO_TEXT/);
}

assert.doesNotMatch(admin, /用户 #\$\{userId\}/);
assert.doesNotMatch(adminGovernance, /用户 #\$\{teacher\.user_id\}/);
assert.doesNotMatch(teacherContent, /用户 #\$\{escapeHtml\(release\.published_by_user_id\)\}/);
assert.doesNotMatch(teacher, /学生 #\$\{studentId\}|用户 #\$\{formatNumber\(item\.user_id\)\}|#\$\{member\.user_id\}|#\$\{item\.student_id\}/);
assert.doesNotMatch(adminGovernance, /创建者<\/dt><dd>#\$\{escapeHtml\(course\.creator_user_id/);
assert.match(teacherContent, /releasePublisherLabel/);
assert.doesNotMatch(teacherContent, /服务器 revision|保存为 revision|采用服务器 revision/);

assert.doesNotMatch(manifest, /Physics evidence review|Humanities claim review|Loop boundary review|Synthetic local-preview|Synthetic loop trace/);
assert.match(manifest, /机械运动证据回顾/);
assert.match(manifest, /人文观点证据辨析/);
assert.match(manifest, /循环边界过程回顾/);
assert.match(initializer, /"kind": "structured-response"/);
assert.match(initializer, /expected_feedback = "观察记录完整/);

assert.match(teacherContent, /contentChanged/);
assert.match(teacherContent, /completionChanged/);
assert.match(teacherContent, /data-tone="rule"><dt>完成规则/);
assert.match(teacherContent, /完成方式调整为/);

assert.match(registry, new RegExp(`ROLE_RESOURCE_VERSION = '${generation}'`));
assert.match(registry, new RegExp(`TEACHER_RESOURCE_VERSION = '${generation}'`));
assert.match(registry, new RegExp(`ADMIN_RESOURCE_VERSION = '${generation}'`));
assert.match(serviceWorker, new RegExp(`astra-static-v${generation}`));
assert.match(html, new RegExp(`app-session\\.js\\?v=${generation}`));
assert.match(html, new RegExp(`auth-ui\\.js\\?v=${generation}`));

console.log('showcase-presentation-ui016-contract: ok');
