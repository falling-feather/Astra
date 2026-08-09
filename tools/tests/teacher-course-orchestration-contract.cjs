const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const teacher = read('pages/teacher/teacher.js');
const teacherOwner = read('shared/js/teacher-learning-evidence.js');
const teacherCss = [
  'pages/teacher/teacher-foundation.css',
  'pages/teacher/teacher-workbench.css',
  'pages/teacher/teacher-curriculum.css',
].map(read).join('');

assert.ok(teacher.includes('id="teacher-tab-${key}"'), 'teacher tabs need stable ids');
assert.ok(teacher.includes('aria-controls="teacher-workbench-panel"'), 'teacher tabs must own the shared panel');
assert.ok(teacher.includes('tabindex="${state.activeView === key ? \'0\' : \'-1\'}"'), 'teacher tabs need roving tabindex');
assert.ok(teacher.includes('aria-labelledby="teacher-tab-${state.activeView}"'), 'teacher panel must name its selected tab');
assert.match(teacher, /function handleViewNavigationKeydown\(event\)[\s\S]*ArrowRight[\s\S]*ArrowLeft[\s\S]*Home[\s\S]*End[\s\S]*setActiveView\(nextTab\.dataset\.teacherView\);[\s\S]*nextTab\.focus\(\);/, 'teacher tabs must support keyboard roving selection');
assert.match(teacherCss, /\.teacher-api-base input\s*\{[^}]*min-height:\s*44px;/, 'teacher API source input needs a 44px touch target');

assert.match(teacher, /curriculum:\s*'课程节奏'/);
assert.match(teacher, /curriculum:\s*renderCurriculumWorkspace/);
assert.match(teacher, /data-teacher-scope="galaxyKey"/);
assert.match(teacher, /const GALAXY_LABELS/);
assert.match(teacher, /function filteredCourses\(\)/);
assert.match(teacher, /async function loadCurriculumScope/);
assert.match(teacher, /\/api\/courses\/\$\{courseId\}\/classes\/\$\{classId\}\/release-plan/);
assert.match(teacherOwner, /`\/api\/progress\/courses\/\$\{snapshot\.courseId\}\/classes\/\$\{snapshot\.classId\}\/students`/);
assert.match(teacher, /fetchJson\('\/api\/code-submissions'/);
assert.match(teacherOwner, /limit:\s*PROGRESS_PAGE_LIMIT,\s*offset/);
assert.match(teacher, /codeOffset = state\.pagination\.codeSubmissionsOffset/);
assert.match(teacher, /limit:\s*CODE_SUBMISSION_PAGE_LIMIT,\s*offset:\s*codeOffset/);
assert.match(teacher, /validateCourseScopedPage\([\s\S]*CODE_SUBMISSION_PAGE_LIMIT, codeOffset, 'code_submission_scope_invalid'/);
assert.match(teacher, /data-teacher-curriculum-page=/);
assert.match(teacherOwner, /data-teacher-natural-page=/);
assert.match(teacherOwner, /page\.next_offset/);
assert.match(teacher, /data-teacher-natural-workflow/);
assert.match(teacherOwner, /teacherAggregate/);
assert.match(teacherOwner, /学生完成状态以本页学生进度和服务端投影为准/);
assert.doesNotMatch(teacher, /(?:本页|全班)完成度/);

assert.match(teacher, /data-teacher-form="release-plan"/);
assert.match(teacher, /confirmReleasePlan\(releasePreview\(plan, command\)\)/);
assert.match(teacher, /method:\s*'PATCH'[\s\S]*expected_version:\s*Number\(plan\.plan_version\)/);
assert.match(teacher, /new Set\(items\.map\(\(item\) => item\.position\)\)\.size !== items\.length/);
assert.match(teacher, /prerequisite\.position >= item\.position/);
assert.match(teacher, /releaseErrorStatus\(error\) === 409/);
assert.match(teacher, /await readReleasePlanAuthority\(\)[\s\S]*草稿没有自动重发/);
assert.match(teacher, /AstraApiClient\.isAmbiguousMutation\(error\)[\s\S]*系统不会自动重试/);
assert.match(teacher, /提交内容与权威版本 v\$\{updated\.plan_version\} 一致，无需重复写入/);

for (const endpoint of [
  '/api/code-submissions/${submissionId}/source',
  '/api/code-submissions/${submissionId}/attempts/page'
]) {
  assert.ok(teacher.includes(endpoint), `teacher workbench must consume ${endpoint}`);
}
assert.match(teacher, /escapeHtml\(source\.source_code\)/);
assert.match(teacher, /CODE_STATUS_LABELS/);
const storageLines = Array.from(
  teacher.matchAll(/(?:localStorage|sessionStorage)[^\n]*/g),
  (match) => match[0]
).join('\n');
assert.doesNotMatch(storageLines, /source_code|codeSubmission|submissionSource/i);

for (const stableField of ['name="galaxy_key"', 'name="course_key"', 'name="activity_key"']) {
  assert.ok(teacher.includes(stableField), `teacher authoring must expose ${stableField}`);
}
assert.match(teacher, /galaxy_key:\s*optional\(data\.galaxy_key\)/);
assert.match(teacher, /course_key:\s*optional\(data\.course_key\)/);
assert.match(teacher, /activity_key:\s*optional\(data\.activity_key\)/);

assert.match(teacherCss, /V7\.5\.7 · 三星系课程节奏与学情轨道/);
for (const selector of [
  '.teacher-orbit-context',
  '.teacher-release-plan',
  '.teacher-natural-progress-table',
  '.teacher-progress-disclosure',
  '.teacher-code-station',
  '.teacher-source-code'
]) {
  assert.ok(teacherCss.includes(selector), `teacher curriculum styling must include ${selector}`);
}
assert.match(teacherCss, /@media \(max-width: 760px\)/);
assert.match(teacherCss, /@media \(prefers-reduced-motion: reduce\)/);

console.log('teacher-course-orchestration-contract: ok');
