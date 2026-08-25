'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n?/g, '\n');
const teacher = read('pages/teacher/teacher.js');
const authoring = read('pages/teacher/teacher-course-authoring.js');
const styles = read('pages/teacher/teacher-course-authoring.css');
const registrySource = read('shared/js/page-registry.js');

assert.match(teacher, /mountTeacherCourseAuthoring\(\)/);
assert.match(teacher, /import\(`\.\/teacher-course-authoring\.js\?v=\$\{TEACHER_COURSE_AUTHORING_ASSET_VERSION\}`\)/);
assert.match(teacher, /renderOperation\('course-authoring'[^\n]+renderCourseAuthoringSurface\(\), true\)/);
assert.doesNotMatch(teacher, /data-teacher-form="course"/);
assert.doesNotMatch(teacher, /async function createCourse\(form\)/);

for (const endpoint of [
  '/api/v1/courses/authoring-options',
  '/api/v1/courses',
  '/information-revisions/${revisionId}/submit',
]) {
  assert.ok(authoring.includes(endpoint), `FE-038 must call ${endpoint}`);
}
assert.match(authoring, /const STEPS = Object\.freeze\([\s\S]*基本信息[\s\S]*共同教师[\s\S]*分类与准入[\s\S]*预览提交/);
assert.match(authoring, /课程分类只用于目录归类和默认筛选，不会限制教师后续引用其他学科/);
assert.match(authoring, /课程已创建并提交管理员审核/);
assert.match(authoring, /草稿已创建，但提交审核未完成/);
assert.match(authoring, /status === 'draft'[\s\S]*data-course-authoring-submit-draft/);
assert.match(authoring, /class_restricted[\s\S]*admission_class_ids/);

const context = {
  window: {},
  Date,
  console,
  requestAnimationFrame() {},
};
context.window.window = context.window;
vm.runInNewContext(authoring, context, { filename: 'pages/teacher/teacher-course-authoring.js' });
const contract = context.window.AstraTeacherCourseAuthoring.contract;
assert.equal(contract.VERSION, '20260825v841CourseAuthoringP0');
assert.deepEqual(Array.from(contract.STEPS, item => item.label), ['基本信息', '共同教师', '分类与准入', '预览提交']);
assert.deepEqual(
  JSON.parse(JSON.stringify(contract.buildPayload({
    title: '  高一物理实验  ',
    summary: '  力学与能量  ',
    academic_year: ' 2026—2027 ',
    schedule_text: ' 每周二 14:00 ',
    total_hours: '32',
    galaxy_key: 'englab',
    subject_key: 'physics',
    admission_mode: 'class_restricted',
    collaborator_user_ids: [9, 9, 12],
    admission_class_ids: [7, 7, 8],
  }, '3'))),
  {
    school_id: 3,
    title: '高一物理实验',
    summary: '力学与能量',
    academic_year: '2026—2027',
    schedule_text: '每周二 14:00',
    total_hours: 32,
    galaxy_key: 'englab',
    subject_key: 'physics',
    admission_mode: 'class_restricted',
    collaborator_user_ids: [9, 12],
    admission_class_ids: [7, 8],
  },
);

const registryContext = { window: {} };
vm.runInNewContext(registrySource, registryContext, { filename: 'shared/js/page-registry.js' });
const registry = registryContext.window.AstraPageRegistry;
const teacherResources = Array.from(registry.resourcesForRole('teacher'));
assert.ok(teacherResources.includes('pages/teacher/teacher-course-authoring.css?v=20260825v841CourseAuthoringP0'));
assert.ok(teacherResources.includes('pages/teacher/teacher-course-authoring.js?v=20260825v841CourseAuthoringP0'));
assert.match(styles, /\.teacher-course-wizard__steps/);
assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.teacher-course-wizard__fields/);
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);

console.log('teacher-course-authoring-fe038-contract: ok');
