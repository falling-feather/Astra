const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const studentSource = read('pages/student/student-workbench.js');
const teacherSource = read('pages/teacher/teacher.js');
const studentCss = read('pages/student/student.css');
const teacherCss = read('pages/teacher/teacher-workbench.css');
const mobileBlock = (css, width) => css.slice(css.indexOf(`@media (max-width: ${width}px)`));

const studentMobile = mobileBlock(studentCss, 600);
assert.match(studentMobile, /\.student-focus-stage\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1\.35fr\) minmax\(132px, 0\.65fr\)/);
assert.match(studentMobile, /\.student-focus-stage__context\s*\{[\s\S]*?grid-column:\s*1 \/ -1/);
assert.match(studentMobile, /\.student-focus-stage__next\s*\{[\s\S]*?grid-column:\s*1/);
assert.match(studentMobile, /\.student-focus-stage__progress\s*\{[\s\S]*?grid-column:\s*2/);
assert.match(studentMobile, /\.student-focus-stage__primary\s*\{[\s\S]*?min-height:\s*46px/);
assert.match(studentMobile, /\.student-focus-stage__next\s*\{[\s\S]*?grid-template-columns:\s*auto minmax\(0, 1fr\)/);
assert.match(studentMobile, /\.student-focus-stage__progress > div\s*\{[\s\S]*?grid-column:\s*1/);
assert.match(studentMobile, /\.student-focus-stage__progress > small\s*\{[\s\S]*?grid-column:\s*2/);

const teacherMobile = mobileBlock(teacherCss, 760);
assert.match(teacherMobile, /\.teacher-focus-stage\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1\.45fr\) minmax\(116px, 0\.65fr\)/);
assert.match(teacherMobile, /\.teacher-focus-stage__context\s*\{[\s\S]*?grid-column:\s*1 \/ -1/);
assert.match(teacherMobile, /\.teacher-focus-stage__action\s*\{[\s\S]*?grid-column:\s*1[\s\S]*?grid-row:\s*2[\s\S]*?min-height:\s*60px/);
assert.match(teacherMobile, /\.teacher-focus-stage__receipt\s*\{[\s\S]*?grid-column:\s*2[\s\S]*?grid-row:\s*2[\s\S]*?min-height:\s*60px/);
assert.match(teacherMobile, /\.teacher-focus-stage__rail\s*\{[\s\S]*?grid-row:\s*3/);

for (const css of [studentMobile, teacherMobile]) {
  assert.doesNotMatch(css, /(?:student|teacher)-focus-stage(?:__[-a-z]+)?\s*\{[^}]*display:\s*none/s, 'focus semantics must remain rendered');
  assert.doesNotMatch(css, /(?:student|teacher)-focus-stage(?:__[-a-z]+)?\s*\{[^}]*position:\s*(?:fixed|absolute)/s, 'focus semantics must remain in document flow');
}

const sortedUnique = (values) => Array.from(new Set(values)).sort();
const digest = (values) => crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex');
function surfaceSets(source) {
  return {
    data: sortedUnique(source.match(/data-[a-z0-9-]+/g) || []),
    api: sortedUnique(source.match(/\/api\/[A-Za-z0-9_./:${}?=&-]+/g) || []),
    fetches: sortedUnique(Array.from(source.matchAll(/\b(fetchJson|fetch)\s*\(\s*(`[^`]*`|'[^']*'|"[^"]*")/g), (match) => `${match[1]}:${match[2]}`)),
  };
}
const expected = {
  student: {
    data: 'ad92069201a5dfd955176dc36ae1662e8ba19070555f51e1329288fa7be822ca',
    api: '7547c324ab41468da6ec12a838666f8b0645fa0a4c638c75c81aaafdc29ab872',
    fetches: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
  },
  teacher: {
    data: '68c7f820771f948b1ea4ab9ac7a2dc3ed026a707e8b2636a703cb63c733e38c7',
    api: '7b0d128bb4ca0987260a492f7cc58a6acd304c578224d2b05ad346722212f730',
    fetches: 'ed688ac8b33bb1c2fb53f4ebfb54880479df151371ba907d94b5c7a1f7ed38df',
  },
};
for (const [owner, source] of [['student', studentSource], ['teacher', teacherSource]]) {
  const sets = surfaceSets(source);
  for (const kind of Object.keys(expected[owner])) assert.equal(digest(sets[kind]), expected[owner][kind], `${owner} ${kind} surface changed`);
}
assert.equal((teacherSource.match(/\n/g) || []).length + 1, 2884, 'teacher.js line ceiling changed');
assert.equal((studentSource.match(/class="student-focus-stage__primary/g) || []).length, 4, 'student primary-state branches changed');
assert.equal((teacherSource.match(/class="teacher-focus-stage__action"/g) || []).length, 1, 'teacher focus must retain one action');

console.log('role-mobile-receipt-ui007-contract: ok');
