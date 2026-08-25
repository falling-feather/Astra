'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n?/g, '\n');

const studentShell = read('pages/student/student-workbench.js');
const studentOwnerSource = read('pages/student/student-course-enrollment.js');
const studentStyles = read('pages/student/student.css');
const teacherAuthoring = read('pages/teacher/teacher-course-authoring.js');
const teacherOwnerSource = read('pages/teacher/teacher-course-membership.js');
const teacherStyles = read('pages/teacher/teacher-course-authoring.css');

assert.match(studentShell, /import\(`\.\/student-course-enrollment\.js\?v=\$\{STUDENT_COURSE_ENROLLMENT_VERSION\}`\)/);
assert.match(studentShell, /student-course-enrollment-host/);
assert.match(studentShell, /courseEnrollmentOwner\.destroy\(\)/);
assert.match(teacherAuthoring, /import\(`\.\/teacher-course-membership\.js\?v=\$\{COURSE_MEMBERSHIP_VERSION\}`\)/);
assert.match(teacherAuthoring, /data-teacher-course-membership/);
assert.match(teacherAuthoring, /courseMembershipOwner\.destroy\(\)/);

for (const endpoint of [
  '/api/v1/courses/by-code/',
  '/join-requests',
  '/enrollments/',
]) {
  assert.ok(studentOwnerSource.includes(endpoint), `student FE-040 owner must call ${endpoint}`);
}
for (const endpoint of [
  '/join-requests',
  '/enrollments',
  '/enrollments/batch',
]) {
  assert.ok(teacherOwnerSource.includes(endpoint), `teacher FE-040 owner must call ${endpoint}`);
}

assert.match(studentOwnerSource, /再次点击“确认退出”/);
assert.match(studentOwnerSource, /申请待教师审核/);
assert.match(studentOwnerSource, /未关联班级/);
assert.match(teacherOwnerSource, /再次点击“批准”|再次点击“退回”|再次点击“确认批量加入”/);
assert.match(teacherOwnerSource, /曾退出或不符合资格的学生不会被自动恢复/);
assert.match(teacherOwnerSource, /source_class_name/);
assert.match(studentStyles, /\.student-course-enrollment/);
assert.match(studentStyles, /@media \(max-width: 760px\)[\s\S]*\.student-course-code/);
assert.match(teacherStyles, /\.teacher-course-membership__grid/);
assert.match(teacherStyles, /@media \(max-width: 900px\)[\s\S]*\.teacher-course-membership__grid/);
assert.match(teacherStyles, /@media \(max-width: 440px\)[\s\S]*\.teacher-course-roster/);

function loadOwner(source, filename, key) {
  const context = { window: {}, console, Date, Intl, AbortController };
  context.window.window = context.window;
  vm.runInNewContext(source, context, { filename });
  assert.ok(context.window[key], `${key} must be installed`);
  return context.window[key].contract;
}

const student = loadOwner(
  studentOwnerSource,
  'pages/student/student-course-enrollment.js',
  'AstraStudentCourseEnrollment',
);
assert.equal(student.VERSION, '20260825v843CourseEnrollmentP0');
assert.equal(student.normalizeCourseCode(' ab-cd 2345 '), 'ABCD2345');
assert.equal(student.eligibilityLabel('eligible'), '可以申请');
assert.equal(student.eligibilityLabel('already_enrolled'), '已加入课程');

const discovery = {
  course_id: 12,
  school_id: 3,
  course_code: 'ABCD2345',
  title: '高一物理实验',
  galaxy_key: 'englab',
  subject_key: 'physics',
  admission_mode: 'class_restricted',
  teachers: [{ user_id: 7, display_name: '林老师', is_creator: true }],
  eligible_source_classes: [{ class_id: 8, name: '高一（3）班' }],
  can_request: true,
  eligibility_reason: 'eligible',
  latest_join_request: null,
  enrollment: null,
};
assert.equal(student.discoveryMatches(discovery), true);
assert.deepEqual(
  JSON.parse(JSON.stringify(student.buildJoinPayload(discovery, '8', '  希望加入  '))),
  { source_class_id: 8, message: '希望加入' },
);
assert.throws(() => student.buildJoinPayload(discovery, '9', ''), /请选择/);
assert.deepEqual(
  JSON.parse(JSON.stringify(student.buildJoinPayload({
    ...discovery,
    admission_mode: 'open',
    eligible_source_classes: [],
  }, '', ''))),
  { source_class_id: null, message: null },
);

const teacher = loadOwner(
  teacherOwnerSource,
  'pages/teacher/teacher-course-membership.js',
  'AstraTeacherCourseMembership',
);
assert.equal(teacher.VERSION, '20260825v843CourseEnrollmentP0');
assert.equal(teacher.approvedCourse({ id: 12, course_code: 'ABCD2345' }), true);
assert.equal(teacher.approvedCourse({ id: 12, course_code: null }), false);
assert.deepEqual(
  JSON.parse(JSON.stringify(teacher.buildReviewPayload('approved', '  欢迎加入  '))),
  { status: 'approved', note: '欢迎加入' },
);
assert.throws(() => teacher.buildReviewPayload('pending', ''), /批准或退回/);
assert.deepEqual(
  JSON.parse(JSON.stringify(teacher.batchResultSummary({
    created_count: 4,
    already_enrolled_count: 2,
    previously_left_count: 1,
    ineligible_count: 3,
  }))),
  { created: 4, already: 2, left: 1, ineligible: 3 },
);
assert.equal(teacher.pageMatches({ items: [{ id: 1, status: 'pending' }], total: 1 }, 'requests'), true);
assert.equal(teacher.pageMatches({ items: [{ id: 2, status: 'active' }], total: 1 }, 'enrollments'), true);
assert.equal(teacher.pageMatches({ items: [{ id: 2, status: 'pending' }], total: 1 }, 'enrollments'), false);

const homerooms = [
  { class_id: 8, name: '高一（3）班' },
  { class_id: 9, name: '高一（4）班' },
];
assert.deepEqual(
  Array.from(teacher.batchClassOptions({
    admission_mode: 'class_restricted',
    admission_classes: [{ class_id: 8, status: 'active' }],
  }, { homerooms }), item => item.class_id),
  [8],
);
assert.deepEqual(
  Array.from(teacher.batchClassOptions({ admission_mode: 'open' }, { homerooms }), item => item.class_id),
  [8, 9],
);

console.log('course-enrollment-fe040-contract: ok');
