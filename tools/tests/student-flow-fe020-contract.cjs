const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const html = read('index.html');
const planets = read('pages/planets/planets.js');
const planetsCss = read('pages/planets/planets.css');
const student = read('pages/student/student-workbench.js');
const studentCss = read('pages/student/student.css');
const roleHome = read('shared/js/role-home-client.js');
const router = read('shared/js/router.js');
const moduleSelector = read('shared/js/module-selector.js');
const moduleCss = read('shared/css/module-selector.css');
const frontier = read('shared/js/frontier-learning.js');
const frontierCss = read('pages/frontier/frontier.css');
const main = read('shared/js/main.js');

assert.match(
  html,
  /pages\/planets\/planets\.js\?v=20260828v861PresentationCleanupP3[\s\S]*page-registry\.js\?v=20260828v861PresentationCleanupP3/,
  'the authoritative student catalogue must load before Router cold-start restoration'
);
assert.match(planets, /AstraStudentCourseCatalogue = Object\.freeze\(\{[\s\S]*refresh: refreshCatalogue/);
assert.match(planets, /request\('\/api\/classes'[\s\S]*mine: true/);
assert.match(planets, /request\('\/api\/courses'[\s\S]*class_id: classId/);
assert.match(planets, /request\(`\/api\/courses\/\$\{courseId\}\/units`[\s\S]*effective_release_state === 'open'/);
assert.match(planets, /classIds = classes\.map\(\(item\) => positiveId\(item\.id\)\)/);
assert.match(planets, /allowsPersonalPage\(\)[\s\S]*catalogueState\.phase === 'ready'/);
assert.match(planets, /if \(!classes\.length\)[\s\S]*request\('\/api\/courses', \{ signal \}\)[\s\S]*request\(`\/api\/courses\/\$\{courseId\}\/units`, \{ signal \}\)/);
assert.match(planets, /guardRoute\(route, coursePages, frontierPages\)[\s\S]*personalBlocked[\s\S]*courseBlocked[\s\S]*history\.replaceState/);
assert.match(planets, /a\[href="#student"\], a\[href\^="#student\/"\]/);
assert.match(planets, /class_ids: Object\.freeze\(Array\.from\(catalogueState\.classIds\)\)/);
assert.match(planets, /class_ids: Object\.freeze\(\(record\.classIds \|\| \[\]\)\.slice\(\)\)/);
assert.match(planets, /detail\.hidden = visible\.length === 0/);
assert.match(planets, /direct\.href = first \? first\.entry\.href : group\.overviewHref/);
assert.match(html, /data-planets-galaxy-direct="englab"/);
assert.match(html, /data-planets-course-list="englab"/);
assert.match(planetsCss, /\.planets-galaxy-row__name:focus-visible/);

assert.match(roleHome, /student-class-join-dialog/);
assert.match(roleHome, /request\(`\/api\/classes\/\$\{classId\}\/join`/);
assert.match(roleHome, /request\('\/api\/classes'[\s\S]*mine: true/);
assert.match(roleHome, /isAmbiguousMutation[\s\S]*request\('\/api\/classes'[\s\S]*mine: true/);
assert.match(roleHome, /addEventListener\('cancel', state\.joinCancelHandler\)/);
assert.match(roleHome, /state\.joinCancelHandler = \(event\) => \{\s*event\.preventDefault\(\)/);
assert.doesNotMatch(roleHome, /data-role-home-join-dismiss|稍后处理/);
assert.match(roleHome, /astra:class-membership-changed/);
assert.match(roleHome, /request\('\/api\/v1\/workbench'/);
assert.match(roleHome, /行政班不是课程学习的前置条件/);
assert.match(planetsCss, /\.student-class-join-dialog::backdrop/);
assert.match(planetsCss, /\.student-class-join-dialog button\s*\{[^}]*min-height:\s*44px/);

assert.match(
  student,
  /<label class="student-scope-control">\s*<i data-lucide="users"[\s\S]*?<label class="student-scope-control" data-student-course-control>\s*<i data-lucide="book-open"/,
  'only the course control may disappear when no discoverable course exists'
);
assert.match(student, /courseControl\.hidden = !state\.data\.courses\.length/);
assert.doesNotMatch(student, /<option[^>]*>暂无已发布课程<\/option>/);
assert.match(student, /filterDiscoverableCourses\(state\.data\.courses, classId\)/);
assert.match(student, /record\.class_ids\.some\(\(candidate\) => Number\(candidate\) === selectedClassId\)/);
assert.match(student, /data-student-action="join-class"/);
assert.match(student, /data-student-add-class-dialog/);
assert.match(student, /await refreshStudentCatalogue\(\);\s*await refreshAll\(\)/);
assert.match(studentCss, /\.student-add-class-dialog::backdrop/);

assert.match(router, /this\._pendingModule = page === 'student'[\s\S]*this\.currentPage : null/);
assert.match(router, /const desiredHash = this\._pendingAnchor \|\| \(this\._pendingModule \? `\$\{page\}\/\$\{this\._pendingModule\}` : page\)/);
assert.match(router, /AstraStudentCourseCatalogue\.guardRoute\(route, this\.coursePages, this\.frontierPages\)/);
assert.match(student, /COURSE_CONTEXT = Object\.freeze\(\{[\s\S]*mathematics:[\s\S]*humanities:/);
assert.match(student, /AstraLearningEvidenceClient\.recovery\([\s\S]*class_id: Number\(classId\)[\s\S]*course_id: Number\(courseId\)/);
assert.match(student, /COURSE LEARNING OVERVIEW/);
assert.match(student, /学习进度[\s\S]*学习比例[\s\S]*评分概况[\s\S]*临时笔记板/);
assert.match(studentCss, /\.student-layout\s*\{[\s\S]*"context context"/);
assert.match(studentCss, /\.student-course-note textarea/);
assert.match(html, /data-student-rail-name/);

assert.doesNotMatch(moduleSelector, /className = 'learning-overview__method'/);
assert.doesNotMatch(moduleSelector, /className = 'learning-overview__note'/);
assert.match(moduleSelector, /createLearningSources\(page, pageEl\)/);
assert.match(moduleSelector, /gallery\.insertAdjacentElement\('afterend', sources\)/);
assert.match(moduleCss, /\.learning-sources-section/);
assert.equal(
  (moduleSelector.match(/this\._renderPublicationGate\(/g) || []).length,
  0,
  'unavailable or locked activity authority must never render a replacement course gate'
);

assert.match(frontier, /class="fg-star-route"/);
assert.match(frontier, /const visibleCourses = manifest\.courses\.map/);
assert.match(frontier, /activityAccess\(availability, activity\)\.state === 'open'/);
assert.match(frontierCss, /\.frontier-overview-page\.active\s*\{[^}]*height:\s*100dvh;[^}]*padding-top:\s*0;[^}]*overflow:\s*hidden/);
assert.match(frontierCss, /\.fg-overview\s*\{[^}]*height:\s*100dvh;[^}]*overflow:\s*hidden/);
assert.match(frontierCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none/);
assert.match(main, /const showFrontier = frontierPages\.has\(page\) && page !== 'frontier'/);

console.log('student-flow-fe020-contract: ok');
