const assert = require('node:assert/strict');
const path = require('node:path');

const studentPath = path.resolve(__dirname, '../../pages/student/student-workbench.js');

function main() {
    global.window = global;
    global.AstraApiClient = {
        scrubLegacyTokens() {},
    };

    delete require.cache[studentPath];
    const student = require(studentPath);
    const {
        state,
        applyConfirmedSubmission,
        updateJoinReconciliationLock,
        updateSubmissionReconciliationLock,
    } = student;

    assert.equal(updateJoinReconciliationLock(27, false), false);
    assert.equal(state.uncertainJoinClassId, '27', 'confirmed join missing from authority must keep the join entry locked');
    assert.equal(updateJoinReconciliationLock(27, true), true);
    assert.equal(state.uncertainJoinClassId, '', 'authority must observe the joined class before unlocking');

    assert.equal(updateSubmissionReconciliationLock(81, false), false);
    assert.equal(state.uncertainSubmissions.has('81'), true, 'confirmed submission missing from authority must stay locked');
    applyConfirmedSubmission('81', null);
    assert.equal(state.uncertainSubmissions.has('81'), true, 'a 204/null confirmed response must not clear the reconciliation lock');
    assert.equal(updateSubmissionReconciliationLock(81, true), true);
    assert.equal(state.uncertainSubmissions.has('81'), false, 'authority must observe the submission before unlocking');

    process.stdout.write('student-confirmed-write-contract: ok\n');
}

try {
    main();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
