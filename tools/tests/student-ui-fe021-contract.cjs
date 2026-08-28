const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const html = read('index.html');
const student = read('pages/student/student-workbench.js');
const studentCss = read('pages/student/student.css');
const planets = read('pages/planets/planets.js');
const planetsCss = read('pages/planets/planets.css');
const roleHome = read('shared/js/role-home-client.js');
const search = read('shared/js/global-search.js');
const moduleSelector = read('shared/js/module-selector.js');
const moduleCss = read('shared/css/module-selector.css');
const navbarCss = read('shared/css/navbar.css');
const pageLayoutCss = read('shared/css/page-layout.css');
const scrollAnimations = read('shared/js/scroll-animations.js');
const router = read('shared/js/router.js');

assert.match(html, /data-student-rail-toggle[\s\S]*aria-expanded="true"[\s\S]*aria-controls="student-role-navigation"/);
assert.match(student, /railCollapsed:[ ]*false/);
assert.match(student, /button\.setAttribute\('aria-expanded', String\(!state\.railCollapsed\)\)/);
assert.match(student, /removeEventListener\('click', state\.onRailToggle\)/);
assert.match(studentCss, /grid-template-columns: var\(--student-rail-width\) minmax\(0, 1fr\)/);
assert.match(studentCss, /container: student-stage \/ inline-size/);
assert.match(studentCss, /\.student-workbench\s*\{[\s\S]*width: min\(1480px, calc\(100% - 48px\)\)/);
assert.doesNotMatch(studentCss, /\.student-workbench\s*\{[^}]*100vw/);
assert.match(studentCss, /\.student-layout\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\)[\s\S]*"context"[\s\S]*"points"/);
assert.match(studentCss, /@container student-stage \(min-width: 1180px\)[\s\S]*"context context"[\s\S]*"assignments points"/);
assert.match(studentCss, /is-student-rail-collapsed[\s\S]*--student-rail-width: 76px/);

assert.match(planets, /AstraStudentScopeSelection = Object\.freeze/);
assert.match(student, /rememberedScope\.classId === String\(classId\)/);
assert.match(student, /!state\.selected\.courseId && state\.data\.courses\.length/);
assert.match(roleHome, /const preferredCourse = rememberedCourse \|\| courses\[0\]/);
assert.match(roleHome, /rememberStudentScope\(classId, preferredCourse\.id\)/);
assert.match(roleHome, /request\('\/api\/v1\/workbench'/);
assert.match(roleHome, /授课课程已就绪/);
assert.match(roleHome, /if \(state\.joinDialog\) removeJoinPrompt\(\)/);
assert.match(planets, /allowsPersonalPage\(\)[\s\S]*catalogueState\.phase === 'ready'/);
assert.match(planets, /request\('\/api\/courses', \{ signal \}\)/);
assert.match(student, /行政班只用于身份、准入与名单展示，不是课程学习的前置条件/);
assert.match(planetsCss, /grid-template-columns: repeat\(auto-fit, minmax\(220px, 1fr\)\)/);

assert.match(navbarCss, /\.nav-item\[hidden\]\s*\{\s*display: none !important/);
assert.match(search, /this\.items\.filter\(\(item\) => this\._isDiscoverable\(item\)\)/);
assert.match(search, /catalogue\.allowsPage\(item\.subjectId\) === true[\s\S]*catalogue\.allowsActivity\(item\.subjectId, item\.id\) === true/);
assert.match(search, /if \(!it \|\| !this\._isDiscoverable\(it\)\)/);
assert.doesNotMatch(moduleSelector, /<span>学习方式<\/span>|<span>练习入口<\/span>/);
assert.match(moduleCss, /\.module-card\[hidden\],[\s\S]*display: none !important/);

assert.match(router, /englab:[\s\S]*scroll-animations\.js\?v=20260731v7969StudentUiP0/);
assert.match(scrollAnimations, /activeEnglabPage[\s\S]*Router\._galaxyForPage\(page\) === 'englab'[\s\S]*initHeroVisual\(page\)/);
assert.match(scrollAnimations, /prefers-reduced-motion: reduce[\s\S]*delete HeroVisualRuntime\.frames\[page\]/);
assert.match(scrollAnimations, /hero-visual--fallback/);
assert.match(pageLayoutCss, /\.page-hero__visual\.hero-visual--fallback::before/);
assert.match(pageLayoutCss, /\.page-hero__canvas\s*\{[\s\S]*opacity: 0\.74/);

const planetsContext = {
    window: null,
    document: {},
    console,
    CustomEvent: class CustomEvent {
        constructor(type, init) {
            this.type = type;
            this.detail = init && init.detail;
        }
    }
};
planetsContext.window = planetsContext;
planetsContext.dispatchEvent = () => true;
vm.runInNewContext(planets, planetsContext, { filename: 'pages/planets/planets.js' });
const learner = { id: 7, role: 'student' };
assert.equal(planetsContext.AstraStudentScopeSelection.update(learner, 11, 23), true);
assert.deepEqual(
    JSON.parse(JSON.stringify(planetsContext.AstraStudentScopeSelection.read(learner))),
    { class_id: 11, course_id: 23 }
);
assert.deepEqual(
    JSON.parse(JSON.stringify(planetsContext.AstraStudentScopeSelection.read({ id: 8, role: 'student' }))),
    { class_id: 0, course_id: 0 },
    'remembered scope must never leak across student identities'
);

const searchContext = { window: null, console };
searchContext.window = searchContext;
searchContext.AstraApplicationSession = { getUser: () => ({ id: 7, role: 'student' }) };
searchContext.AstraStudentCourseCatalogue = {
    allowsPage: page => page === 'mathematics',
    allowsActivity: (page, activity) => page === 'mathematics' && activity === 'function-graph'
};
vm.runInNewContext(search, searchContext, { filename: 'shared/js/global-search.js' });
assert.equal(searchContext.GlobalSearch._isDiscoverable({ subjectId: 'mathematics', id: 'function-graph' }), true);
assert.equal(searchContext.GlobalSearch._isDiscoverable({ subjectId: 'mathematics', id: 'calculus' }), false);
assert.equal(searchContext.GlobalSearch._isDiscoverable({ subjectId: 'physics', id: 'mechanics' }), false);
searchContext.AstraApplicationSession.getUser = () => ({ id: 9, role: 'teacher' });
assert.equal(searchContext.GlobalSearch._isDiscoverable({ subjectId: 'physics', id: 'mechanics' }), true);

console.log('student-ui-fe021-contract: ok');
