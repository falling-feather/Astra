const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const manifestPath = path.join(root, 'codevis/shared/js/course-manifest.js');
const contextPath = path.join(root, 'codevis/shared/js/student-context.js');
const mainPath = path.join(root, 'codevis/shared/js/main.js');
const challengePath = path.join(root, 'codevis/pages/course-challenge/course-challenge.js');
const indexPath = path.join(root, 'codevis/index.html');

function documentStub() {
    return {
        body: { classList: { toggle() {} } },
        getElementById() { return null; }
    };
}

function coursesFor(manifest, classId) {
    return manifest.courses.map((course, index) => ({
        id: classId * 100 + index + 1,
        galaxy_key: manifest.galaxy_key,
        course_key: course.course_key,
        title: course.title
    }));
}

function unitsFor(manifest, courseId) {
    const course = manifest.courses.find((item, index) => courseId % 100 === index + 1);
    return course.activities.map((activity, index) => ({
        id: courseId * 10 + index + 1,
        activity_key: activity.activity_key,
        title: activity.title,
        position: index,
        effective_release_state: 'open',
        lock_reasons: []
    }));
}

function createHarness(routes) {
    const calls = [];
    const redirected = [];
    const context = {
        console,
        AbortController,
        URL,
        window: null,
        document: documentStub(),
        location: { origin: 'https://astra.test', assign: (url) => redirected.push(url) },
        AstraApiClient: {
            async request(pathname, options) {
                calls.push({ pathname, options });
                return routes({ pathname, options, context, calls });
            }
        }
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(manifestPath, 'utf8'), context, { filename: manifestPath });
    vm.runInContext(fs.readFileSync(contextPath, 'utf8'), context, { filename: contextPath });
    return { context, calls, redirected };
}

function standardRoutes(classes) {
    return ({ pathname, options, context }) => {
        if (pathname === '/api/users/me') return { id: 1, role: 'student' };
        if (pathname === '/api/classes') return classes;
        if (pathname === '/api/courses') return coursesFor(context.CvCourseManifest, Number(options.params.class_id));
        const match = pathname.match(/^\/api\/courses\/(\d+)\/units$/);
        if (match) return unitsFor(context.CvCourseManifest, Number(match[1]));
        throw new Error('unexpected path ' + pathname);
    };
}

async function main() {
    const source = fs.readFileSync(contextPath, 'utf8');
    const mainSource = fs.readFileSync(mainPath, 'utf8');
    const challengeSource = fs.readFileSync(challengePath, 'utf8');
    const index = fs.readFileSync(indexPath, 'utf8');
    assert.doesNotMatch(source, /localStorage|sessionStorage/, 'class selection must remain memory-only');
    assert.match(source, /\/api\/users\/me/, 'student context starts with the authoritative current user');
    assert.match(source, /\/api\/classes/, 'student context discovers the student class list');
    assert.match(source, /\/api\/courses/, 'student context discovers courses for an explicit class');
    assert.match(source, /AstraCodeSpaceStudentContext = Object\.freeze/, 'Code Space must own the formal submission context adapter');
    assert.match(index, /id="cv-class-select"/, 'multi-class selection must be present in the Code Space navbar');
    assert.ok(mainSource.indexOf('await window.CvStudentContext.start()') < mainSource.indexOf('CvRouter.init()'), 'first route rendering must wait for context bootstrap');
    const formalSubmitStart = challengeSource.indexOf('const formalSubmit = async () => {');
    const formalSubmitEnd = challengeSource.indexOf("root.querySelector('#challenge-run')", formalSubmitStart);
    assert.ok(formalSubmitStart >= 0 && formalSubmitEnd > formalSubmitStart, 'challenge must keep a bounded formal-submit handler');
    const formalSubmitSource = challengeSource.slice(formalSubmitStart, formalSubmitEnd);
    const tryStart = formalSubmitSource.indexOf('try {');
    const catchStart = formalSubmitSource.indexOf('} catch (_)', tryStart);
    assert.ok(tryStart >= 0 && catchStart > tryStart, 'formal submission must contain one recoverable request branch');
    const requestBranch = formalSubmitSource.slice(tryStart, catchStart);
    assert.match(requestBranch, /adapter\.refresh\(activity, previous/, 'retryable pending submissions must refresh inside the recoverable branch');
    assert.match(requestBranch, /adapter\.submit\(activity, sourceCode/, 'new formal submissions must submit inside the recoverable branch');
    const catchBranch = formalSubmitSource.slice(catchStart, formalSubmitSource.indexOf('if (generation !== challenge.submissionGeneration)', catchStart));
    assert.match(catchBranch, /response = \{ ok: false/, 'unexpected refresh or submit errors must produce an unconfirmed result');
    assert.match(formalSubmitSource, /challenge\.submissions\[stateKey\] = response;\s*render\(\);/,
        'every recovered formal-submit result must replace pending UI state and re-render');

    const single = createHarness(standardRoutes([{ id: 7, name: '一班' }]));
    assert.equal(await single.context.CvStudentContext.start(), true);
    const singleState = single.context.CvStudentContext.getState();
    assert.equal(singleState.phase, 'ready');
    assert.equal(singleState.class_id, 7, 'one class must be selected automatically');
    assert.equal(Object.keys(singleState.course_ids).length, 6, 'all six Code Space courses require a mapping');
    const activity = single.context.CvCourseManifest.getActivity('control-flow.loop-boundary');
    assert.deepEqual(JSON.parse(JSON.stringify(single.context.AstraCodeSpaceStudentContext.resolve(activity))), {
        authenticated: true,
        role: 'student',
        class_id: 7,
        course_id: 702
    });
    assert.equal(single.context.CvCourseStateAdapter.resolve(activity).status, 'available');
    assert.equal(single.calls.filter((call) => /\/units$/.test(call.pathname)).length, 6, 'release state must load once for every mapped course');

    const multi = createHarness(standardRoutes([{ id: 7, name: '一班' }, { id: 8, name: '二班' }]));
    assert.equal(await multi.context.CvStudentContext.start(), true);
    assert.equal(multi.context.CvStudentContext.getState().phase, 'selecting_class');
    assert.equal(multi.context.AstraCodeSpaceStudentContext.resolve(activity), null, 'multi-class users must not receive a guessed submission scope');
    assert.equal(multi.calls.some((call) => call.pathname === '/api/courses'), false, 'no course scope loads before explicit selection');
    assert.equal(multi.context.CvStudentContext.gate().blocked, true);
    assert.equal(await multi.context.CvStudentContext.selectClass(8), true);
    assert.equal(multi.context.CvStudentContext.getState().class_id, 8);
    assert.equal(multi.context.AstraCodeSpaceStudentContext.resolve(activity).course_id, 802, 'switching class must replace the activity course id');

    let releaseFirst;
    const racing = createHarness(({ pathname, options, context }) => {
        if (pathname === '/api/users/me') return { id: 1, role: 'student' };
        if (pathname === '/api/classes') return [{ id: 7, name: '一班' }, { id: 8, name: '二班' }];
        if (pathname === '/api/courses' && Number(options.params.class_id) === 7) {
            return new Promise((resolve) => { releaseFirst = () => resolve(coursesFor(context.CvCourseManifest, 7)); });
        }
        if (pathname === '/api/courses') return coursesFor(context.CvCourseManifest, Number(options.params.class_id));
        const match = pathname.match(/^\/api\/courses\/(\d+)\/units$/);
        if (match) return unitsFor(context.CvCourseManifest, Number(match[1]));
        throw new Error('unexpected path ' + pathname);
    });
    await racing.context.CvStudentContext.start();
    const firstSwitch = racing.context.CvStudentContext.selectClass(7);
    await Promise.resolve();
    const secondSwitch = racing.context.CvStudentContext.selectClass(8);
    await secondSwitch;
    releaseFirst();
    await firstSwitch;
    assert.equal(racing.context.CvStudentContext.getState().class_id, 8, 'late class responses must not overwrite a newer choice');

    const missing = createHarness(({ pathname, options, context }) => {
        if (pathname === '/api/users/me') return { id: 1, role: 'student' };
        if (pathname === '/api/classes') return [{ id: 7, name: '一班' }];
        if (pathname === '/api/courses') return coursesFor(context.CvCourseManifest, Number(options.params.class_id)).slice(0, 5);
        throw new Error('units must not load for an incomplete mapping');
    });
    assert.equal(await missing.context.CvStudentContext.start(), false);
    assert.equal(missing.context.CvStudentContext.getState().phase, 'unavailable');
    assert.equal(missing.context.AstraCodeSpaceStudentContext.resolve(activity), null);
    assert.equal(missing.context.CvCourseStateAdapter.resolve(activity).status, 'unavailable');

    const unauthorized = createHarness(({ pathname }) => {
        assert.equal(pathname, '/api/users/me');
        throw { status: 401 };
    });
    const unauthorizedClearReasons = [];
    unauthorized.context.AstraLearningEvidenceLoader = {
        async clearAuthority(reason) {
            unauthorizedClearReasons.push(reason);
        }
    };
    assert.equal(await unauthorized.context.CvStudentContext.start(), false);
    assert.deepEqual(unauthorizedClearReasons, ['unauthorized']);
    assert.deepEqual(unauthorized.redirected, ['../index.html'], '401 may return to login only after authority clear succeeds');

    const unauthorizedClearFailure = createHarness(({ pathname }) => {
        assert.equal(pathname, '/api/users/me');
        throw { status: 401 };
    });
    unauthorizedClearFailure.context.AstraLearningEvidenceLoader = {
        async clearAuthority() {
            const error = new Error('indexeddb clear failed');
            error.code = 'indexeddb_transaction_failed';
            throw error;
        }
    };
    assert.equal(await unauthorizedClearFailure.context.CvStudentContext.start(), false);
    assert.deepEqual(unauthorizedClearFailure.redirected, [], '401 must stay on Code Space when authority clear fails');
    assert.equal(unauthorizedClearFailure.context.CvStudentContext.getState().phase, 'authority_clear_failed');
    assert.equal(unauthorizedClearFailure.context.CvStudentContext.gate().blocked, true);

    const staticPreview = createHarness(({ pathname }) => {
        assert.equal(pathname, '/api/users/me');
        throw { status: 404 };
    });
    assert.equal(await staticPreview.context.CvStudentContext.start(), true);
    assert.equal(staticPreview.context.CvStudentContext.getState().phase, 'static_preview');
    assert.equal(staticPreview.context.CvCourseStateAdapter.resolve(activity).status, 'available', 'static previews retain the legacy open fallback while submission stays disabled');
    assert.equal(staticPreview.context.AstraCodeSpaceStudentContext.resolve(activity), null);

    process.stdout.write('codevis-student-context-contract: ok\n');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
