const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const progressSource = fs.readFileSync(path.join(root, 'shared/js/learning-progress.js'), 'utf8');
const selectorSource = fs.readFileSync(path.join(root, 'shared/js/module-selector.js'), 'utf8');
const homeSource = fs.readFileSync(path.join(root, 'pages/home/home.js'), 'utf8');
const planetsSource = fs.readFileSync(path.join(root, 'pages/planets/planets.js'), 'utf8');
const studentWorkbenchSource = fs.readFileSync(path.join(root, 'pages/student/student-workbench.js'), 'utf8');
const roleHomeSource = fs.readFileSync(path.join(root, 'shared/js/role-home-client.js'), 'utf8');
const engineeringContextSource = fs.readFileSync(path.join(root, 'shared/js/engineering-lab-publication-context.js'), 'utf8');

assert.match(selectorSource, /const overviewCopy = page === 'physics'[\s\S]*?\? ''/);
assert.match(selectorSource, /createLearningSources\(page, pageEl\) \{\s*if \(page === 'physics'\) return;/);
assert.doesNotMatch(homeSource, /工科试验室 · 90 个交互实验/);
assert.match(planetsSource, /course\.subject_key \|\| course\.course_key/, 'shared content identity must prefer backend subject_key');
assert.match(planetsSource, /visibleCourses = list\(await client\.request\('\/api\/courses'/, 'class-bound catalogue refresh must also reconcile direct course enrollments');
assert.match(planetsSource, /course_ids: Object\.freeze/, 'the catalogue snapshot must retain real course instance ids');
assert.match(studentWorkbenchSource, /course\.subject_key \|\| course\.course_key/, 'student workbench must not compare a random course instance key with a subject key');
assert.match(roleHomeSource, /mapping\.subject_key === \(course\.subject_key \|\| course\.course_key\)/, 'continue-learning routes must use the subject taxonomy');
assert.match(engineeringContextSource, /course\.subject_key \|\| course\.course_key/, 'engineering publication lookup must accept teacher-created physics courses');

const listeners = new Map();
let user = { id: 3, role: 'student' };
let allowed = new Set(['physics.mechanics']);
const context = {
    console,
    CONFIG: {
        experiments: {
            physics: [
                { id: 'mechanics', variant: 'featured' },
                { id: 'gas-laws', variant: 'featured' },
                { id: 'future-topic', variant: 'upcoming' }
            ]
        }
    },
    document: {
        getElementById() { return null; },
        querySelector() { return null; }
    },
    setTimeout(callback) {
        callback();
        return 1;
    },
    addEventListener(type, handler) {
        listeners.set(type, handler);
    },
    AstraApplicationSession: {
        getUser() { return user; }
    },
    AstraStudentCourseCatalogue: {
        allowsActivity(page, moduleId) {
            return allowed.has(`${page}.${moduleId}`);
        }
    }
};
context.window = context;
context.globalThis = context;

vm.runInNewContext(`${progressSource}\n;globalThis.__LearningProgress = LearningProgress;`, context, {
    filename: 'shared/js/learning-progress.js'
});

const progress = context.__LearningProgress;
progress.init();
assert.deepEqual(
    { ...progress.getSubjectProgress('physics') },
    { visited: 0, total: 1, percent: 0 },
    'student progress denominator must use only backend-authorized activities'
);
progress.markVisited('mechanics');
assert.deepEqual(
    { ...progress.getSubjectProgress('physics') },
    { visited: 1, total: 1, percent: 100 },
    'visited progress must stay inside the same authorized activity set'
);

allowed = new Set(['physics.mechanics', 'physics.gas-laws']);
listeners.get('astra:student-catalogue-ready')();
assert.deepEqual(
    { ...progress.getSubjectProgress('physics') },
    { visited: 1, total: 2, percent: 50 },
    'catalogue refresh must immediately update the visible denominator'
);

user = { id: 2, role: 'teacher' };
assert.equal(progress.getSubjectProgress('physics').total, 2, 'non-students retain the full published catalogue');

console.log('student-visible-progress-v866-contract: ok');
