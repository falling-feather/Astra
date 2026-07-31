const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'shared/js/module-selector.js'), 'utf8');

assert.match(source, /window\.addEventListener\('astra:student-catalogue-ready', this\._catalogueHandler\)/);
assert.match(source, /if \(this\._booted\) return;/);
assert.match(source, /document\.querySelectorAll\(`\[id="\$\{id\}"\]`\)\.forEach\(node => node\.remove\(\)\)/);
assert.match(source, /const experiments = this\._visibleExperiments\(page\);/);
assert.match(source, /if \(!visibleExperiments\.length \|\| !hero \|\| !subject\) return;/);

const windowListeners = new Map();
const documentListeners = new Map();
const appended = [];
let currentUser = { id: 6, role: 'student' };
let allowedActivities = new Set(['biology.cell-structure']);

const context = {
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    CONFIG: {
        experiments: {
            mathematics: [],
            physics: [],
            chemistry: [],
            algorithms: [],
            biology: [
                { id: 'cell-structure', variant: 'featured' },
                { id: 'dna', variant: 'featured' },
                { id: 'future-topic', variant: 'upcoming' }
            ]
        }
    },
    document: {
        body: {
            appendChild(node) {
                appended.push(node);
            }
        },
        getElementById() {
            return null;
        },
        querySelectorAll() {
            return [];
        },
        createElement() {
            return {
                id: '',
                className: '',
                addEventListener() {}
            };
        },
        addEventListener(type, handler) {
            if (!documentListeners.has(type)) documentListeners.set(type, new Set());
            documentListeners.get(type).add(handler);
        }
    },
    addEventListener(type, handler) {
        if (!windowListeners.has(type)) windowListeners.set(type, new Set());
        windowListeners.get(type).add(handler);
    },
    AstraApplicationSession: {
        getUser() {
            return currentUser;
        }
    },
    AstraStudentCourseCatalogue: {
        allowsActivity(page, moduleId) {
            return allowedActivities.has(`${page}.${moduleId}`);
        }
    }
};
context.window = context;
context.globalThis = context;

vm.runInNewContext(`${source}\n;globalThis.__ModuleSelector = ModuleSelector;`, context, {
    filename: 'shared/js/module-selector.js'
});

const selector = context.__ModuleSelector;
selector.init();
selector.init();

assert.equal(windowListeners.get('astra:student-catalogue-ready').size, 1, 'catalogue listener must be singleton');
assert.equal(documentListeners.get('keydown').size, 1, 'keyboard listener must be singleton');
assert.equal(appended.length, 1, 'mobile backdrop must be singleton');
assert.deepEqual(
    Array.from(selector._visibleExperiments('biology'), item => item.id),
    ['cell-structure'],
    'only exact-open, non-upcoming activities may enter generated course DOM'
);

const pageEl = {
    classList: {
        remove() {}
    }
};
const calls = {
    remove: 0,
    sidebar: 0,
    overview: 0,
    gallery: 0,
    sources: 0,
    close: 0
};
selector._pageNames = ['biology'];
context.document.getElementById = id => id === 'page-biology' ? pageEl : null;
selector._removeCatalogueSurface = () => { calls.remove += 1; };
selector.createSidebar = () => { calls.sidebar += 1; };
selector.createLearningOverview = () => { calls.overview += 1; };
selector.createGallery = () => { calls.gallery += 1; };
selector.createLearningSources = () => { calls.sources += 1; };
selector.closeModule = page => {
    calls.close += 1;
    selector.activeModule[page] = null;
    return true;
};

const catalogueReady = Array.from(windowListeners.get('astra:student-catalogue-ready'))[0];
catalogueReady();
assert.deepEqual(
    { remove: calls.remove, sidebar: calls.sidebar, overview: calls.overview, gallery: calls.gallery, sources: calls.sources },
    { remove: 1, sidebar: 1, overview: 1, gallery: 1, sources: 1 },
    'a ready snapshot must atomically replace every generated catalogue surface'
);

selector.activeModule.biology = 'cell-structure';
currentUser = { id: 8, role: 'student' };
allowedActivities = new Set();
catalogueReady();
assert.equal(calls.close, 1, 'identity replacement must close the prior student module before rebuilding');
assert.equal(selector.activeModule.biology, null);
assert.equal(calls.remove, 2);

catalogueReady();
assert.equal(calls.close, 1, 'repeated ready events must not close an already cleared module again');
assert.equal(calls.remove, 3, 'repeated ready events rebuild in place without duplicate generated nodes');

console.log('student-catalogue-reconcile-fe022-contract: ok');
