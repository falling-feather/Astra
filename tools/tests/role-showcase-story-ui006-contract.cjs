const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const studentSource = read('pages/student/student-workbench.js');
const studentCss = read('pages/student/student.css');
const teacherSource = read('pages/teacher/teacher.js');
const teacherCss = read('pages/teacher/teacher-workbench.css');

const sortedUnique = (values) => Array.from(new Set(values)).sort();
const digest = (values) => crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex');
function surfaceSets(source) {
  return {
    data: sortedUnique(source.match(/data-[a-z0-9-]+/g) || []),
    api: sortedUnique(source.match(/\/api\/[A-Za-z0-9_./:${}?=&-]+/g) || []),
    fetches: sortedUnique(Array.from(source.matchAll(/\b(fetchJson|fetch)\s*\(\s*(`[^`]*`|'[^']*'|"[^"]*")/g), (match) => `${match[1]}:${match[2]}`)),
  };
}
function assertSurfaceSets(source, expected, owner) {
  const sets = surfaceSets(source);
  for (const [kind, fingerprint] of Object.entries(expected)) {
    assert.equal(digest(sets[kind]), fingerprint, `${owner} ${kind} surface must stay unchanged by UI-006`);
  }
}

for (const className of ['story', 'goal', 'output', 'action', 'receipt']) {
  assert.match(studentSource, new RegExp(`student-focus-stage__${className}`));
}
for (const className of ['story', 'goal', 'output', 'action', 'receipt']) {
  assert.match(teacherSource, new RegExp(`teacher-focus-stage__${className}`));
}
for (const className of ['goal', 'output']) assert.match(studentCss, new RegExp(`\\.student-focus-stage__${className}`));
for (const className of ['goal', 'output', 'action', 'receipt']) assert.match(teacherCss, new RegExp(`\\.teacher-focus-stage__${className}`));

const studentFocus = studentSource.slice(studentSource.indexOf('function renderLearningFocus()'), studentSource.indexOf('function renderHeaderControls()'));
assert.match(studentFocus, /selectedCourse\(\)[\s\S]*selectedClass\(\)[\s\S]*authoritativeCourseProgress\(\)[\s\S]*primaryLearningTarget\(\)/);
assert.match(studentFocus, /本节目标[\s\S]*预计产出[\s\S]*下一步[\s\S]*完成回执/);
assert.match(studentFocus, /将形成本次作业提交与教师反馈记录[\s\S]*将形成本节操作、观察与结论记录[\s\S]*将形成可保存的学习过程记录/);
assert.doesNotMatch(studentFocus, /已掌握|掌握率|误区率|优秀率|学习成效已达成/);

const teacherFocus = teacherSource.slice(teacherSource.indexOf('function renderTeachingFocus()'), teacherSource.indexOf('function renderWriteLock()'));
assert.match(teacherFocus, /selectedCourse\(\)[\s\S]*selectedClass\(\)[\s\S]*releasePlan[\s\S]*state\.data\.units[\s\S]*state\.data\.assignments[\s\S]*state\.selected\.assignmentId/);
assert.match(teacherFocus, /本节目标[\s\S]*预计产出[\s\S]*下一教学动作[\s\S]*完成回执/);
assert.match(teacherFocus, /将形成“\$\{selectedAssignment\.title\}”的学生提交与教师反馈记录[\s\S]*将形成“\$\{focusUnit\.title\}”的开放、学习过程与反馈记录/);
assert.equal((teacherFocus.match(/class="teacher-focus-stage__action"/g) || []).length, 1, 'teacher focus stage must expose one primary action');
assert.doesNotMatch(teacherFocus, /已掌握|掌握率|误区率|优秀率|教学成效已达成/);

assert.match(studentCss, /@media \(max-width: 840px\)[\s\S]*\.student-focus-stage\s*\{\s*grid-template-columns:\s*1fr/);
assert.match(studentCss, /@media \(max-width: 600px\)[\s\S]*\.student-workbench\s*\{[\s\S]*width:\s*min\(100% - 20px, 520px\)/);
assert.match(studentCss, /@media \(max-width: 600px\)[\s\S]*\.student-focus-stage__course p\s*\{[\s\S]*font-size:\s*0\.7rem/);
assert.match(studentCss, /@media \(max-width: 600px\)[\s\S]*\.student-focus-stage__primary\s*\{[\s\S]*min-height:\s*46px/);
assert.match(studentCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.student-workbench \*[\s\S]*transition-duration:\s*0\.01ms/);
assert.match(teacherCss, /\.teacher-page\s*\{[\s\S]*overflow-x:\s*clip/);
assert.match(teacherCss, /@media \(max-width: 900px\)[\s\S]*\.teacher-focus-stage\s*\{\s*grid-template-columns:\s*1fr/);
assert.match(teacherCss, /@media \(max-width: 760px\)[\s\S]*\.teacher-focus-stage__context,[\s\S]*\.teacher-focus-stage__action\s*\{[\s\S]*min-height:\s*104px/);
assert.match(teacherCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.teacher-focus-stage__action[\s\S]*transition:\s*none/);

assertSurfaceSets(studentSource, {
  data: '6a2ee7aaa9254470891c6da21cc791965836372de2c3b9e47a9ae7ce1221f79b',
  api: '7547c324ab41468da6ec12a838666f8b0645fa0a4c638c75c81aaafdc29ab872',
  fetches: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
}, 'student');
assertSurfaceSets(teacherSource, {
  data: '4799ff4b77be0259db959b66a5001d8166b6f0f89cdc2f91ec24137830cb9ac2',
  api: '7b0d128bb4ca0987260a492f7cc58a6acd304c578224d2b05ad346722212f730',
  fetches: 'ed688ac8b33bb1c2fb53f4ebfb54880479df151371ba907d94b5c7a1f7ed38df',
}, 'teacher');

global.window = global;
global.addEventListener = () => {};
global.removeEventListener = () => {};
global.AstraApiClient = { scrubLegacyTokens() {} };
global.AstraExperimentRegistry = { entries: () => [] };
const student = require(path.join(root, 'pages/student/student-workbench.js'));
const focusStage = { hidden: false, innerHTML: '' };
Object.assign(student.state, {
  root: { querySelector: (selector) => selector === '[data-student-focus-stage]' ? focusStage : null },
  selected: { classId: '7', courseId: '42', assignmentId: '' },
  busy: false,
  loadingScope: false,
  online: true,
});
student.state.data.classes = [{ id: 7, name: '工程一班' }];
student.state.data.courses = [{ id: 42, title: '工程系统', summary: '' }];
student.state.data.units = [];
student.state.data.todayAssignments = { items: [] };
student.state.data.recovery = { activities: [{ activity_key: 'engineering.load-path', status: 'completed' }] };
student.renderLearningFocus();
assert.equal((focusStage.innerHTML.match(/class="[^"]*student-focus-stage__primary/g) || []).length, 1, 'student focus stage must render one primary CTA');
for (const className of ['story', 'goal', 'output', 'action', 'receipt']) assert.match(focusStage.innerHTML, new RegExp(`student-focus-stage__${className}`));
assert.match(focusStage.innerHTML, /工程系统[\s\S]*工程一班[\s\S]*等待教师开放具体学习任务[\s\S]*将形成可保存的学习过程记录/);

assert.ok((teacherSource.match(/\n/g) || []).length + 1 <= 2883, 'teacher.js must stay within its frozen line ceiling');
console.log('role-showcase-story-ui006-contract: ok');
