const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const catalogPath = path.join(root, 'shared/js/learning-activity-catalog.js');
const publicationPath = path.join(root, 'shared/js/engineering-lab-publication-context.js');
const studentPath = path.join(root, 'pages/student/student-workbench.js');
const teacherPath = path.join(root, 'pages/teacher/teacher.js');

function busyRoot(selectors = {}) {
    const attributes = new Map();
    const classes = new Set();
    return {
        attributes,
        classes,
        classList: {
            toggle(name, enabled) {
                if (enabled) classes.add(name);
                else classes.delete(name);
            }
        },
        setAttribute(name, value) {
            attributes.set(name, String(value));
        },
        removeAttribute(name) {
            attributes.delete(name);
        },
        querySelector(selector) {
            return selectors[selector] || null;
        },
        querySelectorAll() {
            return [];
        }
    };
}

function setDirectory(records, allowedActivities) {
    const allowed = new Set(allowedActivities);
    global.AstraStudentCourseCatalogue = {
        snapshot() {
            return {
                role: 'student',
                phase: 'ready',
                records
            };
        },
        allowsActivity(page, moduleId) {
            return allowed.has(`${page}.${moduleId}`);
        }
    };
}

function setScope(state, course, unit) {
    state.authorized = true;
    state.user = { id: 17, role: 'student' };
    state.selected = {
        classId: '7',
        courseId: String(course.id),
        assignmentId: ''
    };
    state.data.courses = [course];
    state.data.units = [unit];
    state.data.recovery = null;
    state.data.todayAssignments = { items: [] };
}

function futureRecord(courseKey, page, activityKey, classIds = [7]) {
    return {
        galaxy_key: 'future-galaxy',
        course_key: courseKey,
        page,
        activity_keys: [activityKey],
        class_ids: classIds
    };
}

function main() {
    global.window = global;
    global.addEventListener = () => {};
    global.removeEventListener = () => {};
    global.AstraApiClient = { scrubLegacyTokens() {} };
    global.AstraExperimentRegistry = { entries: () => [] };
    delete global.AstraLearningActivityCatalog;
    delete global.AstraEngineeringLabPublicationContext;
    delete require.cache[catalogPath];
    delete require.cache[publicationPath];
    delete require.cache[studentPath];
    delete require.cache[teacherPath];
    require(catalogPath);
    require(publicationPath);
    const student = require(studentPath);
    const {
        state,
        scopedFutureCourseUnitHref,
        visibleCourseUnits,
        primaryLearningTarget,
        renderLearningFocus,
        syncWorkbenchBusyState,
        renderCoursePanel
    } = student;

    const engineeringCourse = {
        id: 42,
        galaxy_key: 'future-galaxy',
        course_key: 'engineering-systems',
        title: 'Engineering Systems'
    };
    const loadPathUnit = {
        id: 105,
        course_id: 42,
        activity_key: 'engineering.load-path',
        content_slug: null,
        effective_release_state: 'open',
        title: '受力路径'
    };
    setScope(state, engineeringCourse, loadPathUnit);
    setDirectory(
        [futureRecord('engineering-systems', 'engineering', 'engineering.load-path')],
        ['engineering.load-path']
    );

    assert.equal(
        scopedFutureCourseUnitHref(loadPathUnit),
        '#engineering/load-path',
        'the workbench must reuse the real catalogue route for the same open scoped activity'
    );
    const engineeringUnits = visibleCourseUnits();
    assert.equal(engineeringUnits.length, 1);
    assert.equal(engineeringUnits[0].executable, true);
    assert.equal(engineeringUnits[0].content_slug, 'engineering/load-path');
    assert.deepEqual(
        { href: primaryLearningTarget().href, activityKey: primaryLearningTarget().activityKey },
        { href: '#engineering/load-path', activityKey: '' },
        'Future Galaxy navigation must stay a normal router link and must not impersonate the Physics owner'
    );

    const coursePanel = { innerHTML: '' };
    state.root = {
        querySelector(selector) {
            return selector === '[data-student-panel="course"]' ? coursePanel : null;
        }
    };
    renderCoursePanel();
    assert.match(coursePanel.innerHTML, /href="#engineering\/load-path"/);
    assert.doesNotMatch(coursePanel.innerHTML, /待绑定/);

    setDirectory(
        [futureRecord('engineering-systems', 'engineering', 'engineering.load-path', [99])],
        ['engineering.load-path']
    );
    assert.equal(scopedFutureCourseUnitHref(loadPathUnit), '', 'another class directory record must not open this scope');
    assert.equal(visibleCourseUnits()[0].executable, false);

    setDirectory(
        [futureRecord('engineering-systems', 'engineering', 'engineering.load-path')],
        []
    );
    assert.equal(scopedFutureCourseUnitHref(loadPathUnit), '', 'a directory guard denial must remain fail-closed');

    const lockedLoadPath = { ...loadPathUnit, effective_release_state: 'locked' };
    setScope(state, engineeringCourse, lockedLoadPath);
    setDirectory(
        [futureRecord('engineering-systems', 'engineering', 'engineering.load-path')],
        ['engineering.load-path']
    );
    assert.equal(scopedFutureCourseUnitHref(lockedLoadPath), '', 'a locked server unit must never gain a primary link');
    assert.equal(visibleCourseUnits()[0].executable, false);

    const cosmosCourse = {
        id: 43,
        galaxy_key: 'future-galaxy',
        course_key: 'earth-space',
        title: 'Earth and Space'
    };
    setScope(state, cosmosCourse, { ...loadPathUnit, id: 106, course_id: 43 });
    setDirectory(
        [futureRecord('earth-space', 'cosmos', 'engineering.load-path')],
        ['engineering.load-path']
    );
    assert.equal(
        scopedFutureCourseUnitHref(state.data.units[0]),
        '',
        'an activity belonging to another Future course must not be released by route shape alone'
    );

    const daySeasonUnit = {
        id: 107,
        course_id: 43,
        activity_key: 'cosmos.day-season',
        content_slug: null,
        effective_release_state: 'open',
        title: '昼夜与季节'
    };
    setScope(state, cosmosCourse, daySeasonUnit);
    setDirectory(
        [futureRecord('earth-space', 'cosmos', 'cosmos.day-season')],
        ['cosmos.day-season']
    );
    assert.equal(
        scopedFutureCourseUnitHref(daySeasonUnit),
        '#cosmos/day-season',
        'another Future course may open only through its own exact catalogue and class scope'
    );

    const physicsCourse = {
        id: 51,
        galaxy_key: 'englab',
        course_key: 'physics',
        title: '物理'
    };
    const mechanicsUnit = {
        id: 108,
        course_id: 51,
        activity_key: 'physics.mechanics',
        content_slug: 'physics/mechanics',
        effective_release_state: 'open',
        title: '力学'
    };
    setScope(state, physicsCourse, mechanicsUnit);
    setDirectory([], []);
    const physicsUnit = visibleCourseUnits()[0];
    assert.equal(physicsUnit.executable, true, 'the existing Physics content_slug path must not regress');
    assert.equal(physicsUnit.content_slug, 'physics/mechanics');
    assert.equal(primaryLearningTarget().activityKey, 'physics.mechanics');

    setScope(state, engineeringCourse, loadPathUnit);
    state.data.classes = [{ id: 7, name: '工程一班' }];
    setDirectory(
        [futureRecord('engineering-systems', 'engineering', 'engineering.load-path')],
        ['engineering.load-path']
    );
    const focusStage = { hidden: false, innerHTML: '' };
    const studentRoot = busyRoot({ '[data-student-focus-stage]': focusStage });
    state.root = studentRoot;
    state.loadingScope = true;
    renderLearningFocus();
    syncWorkbenchBusyState();
    assert.equal(studentRoot.attributes.get('aria-busy'), 'true');
    assert.equal(studentRoot.classes.has('is-busy'), true);
    assert.match(focusStage.innerHTML, /正在同步可进入的学习任务/);
    assert.match(focusStage.innerHTML, /正在读取学习任务/);
    assert.doesNotMatch(focusStage.innerHTML, /当前没有可进入的学习任务|等待教师开放|href="#engineering\/load-path"/);

    state.loadingScope = false;
    renderLearningFocus();
    syncWorkbenchBusyState();
    assert.equal(studentRoot.attributes.has('aria-busy'), false, 'student settled state must clear aria-busy');
    assert.match(focusStage.innerHTML, /href="#engineering\/load-path"/);

    state.loadingScope = true;
    syncWorkbenchBusyState();
    state.loadingScope = false;
    state.errors.units = new Error('scope failed');
    syncWorkbenchBusyState();
    assert.equal(studentRoot.attributes.has('aria-busy'), false, 'student failed state must also clear aria-busy');

    const teacher = require(teacherPath);
    const teacherRoot = busyRoot();
    teacher.state.root = teacherRoot;
    teacher.setBusy(true);
    assert.equal(teacherRoot.attributes.get('aria-busy'), 'true');
    assert.equal(teacherRoot.classes.has('is-busy'), true);
    teacher.setBusy(false);
    assert.equal(teacherRoot.attributes.has('aria-busy'), false, 'teacher settled state must clear aria-busy');
    assert.equal(teacherRoot.classes.has('is-busy'), false);

    process.stdout.write('student-engineering-entry-ui005-contract: ok\n');
}

try {
    main();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
