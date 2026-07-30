const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const teacherPath = path.resolve(__dirname, '../../pages/teacher/teacher.js');
const teacherSource = fs.readFileSync(teacherPath, 'utf8');
assert.match(
    teacherSource,
    /function canManageAssignmentClassPolicy\(\)\s*\{\s*return !isClassReadOnly\(\) && hasCourseCapability/,
    'archived class must disable assignment-class-policy PUT and DELETE controls'
);
const gradeStart = teacherSource.indexOf('async function gradeSubmissionCommand');
const gradeEnd = teacherSource.indexOf('async function updateMemberStatus', gradeStart);
assert.ok(gradeStart >= 0 && gradeEnd > gradeStart, 'grade owner must stay inspectable');
const gradeOwner = teacherSource.slice(gradeStart, gradeEnd);
assert.equal(
    (gradeOwner.match(/method:\s*'PATCH'/g) || []).length,
    1,
    'one grading action must issue exactly one mutation'
);
assert.match(gradeOwner, /assignmentId:\s*Number\(state\.selected\.assignmentId\)/);
assert.match(gradeOwner, /classId:\s*Number\(state\.selected\.classId\)/);
assert.match(gradeOwner, /offset:\s*state\.pagination\.assignmentSubmissionOffset/);
assert.match(gradeOwner, /record = await readSubmissionAuthority\(scope/);
assert.match(gradeOwner, /mutationState === 'conflict'[\s\S]*系统没有自动重发评分/);
assert.match(gradeOwner, /mutationState === 'locked'[\s\S]*系统不会自动重试/);

async function main() {
    global.window = global;
    global.navigator = { onLine: true };
    global.AstraApiClient = {
        message(error) {
            return error && error.message ? error.message : '请求失败';
        },
        offlineError() {
            return { code: 'offline', message: '当前处于离线状态' };
        }
    };

    delete require.cache[teacherPath];
    const teacher = require(teacherPath);
    const { state, reconcileConfirmedWrite, lockConfirmedWrite } = teacher;

    state.active = true;
    state.online = true;
    state.user = { id: 7, role: 'teacher' };
    state.lifecycleController = new AbortController();
    state.errors = {};
    state.writeLock = null;
    state.flash = null;

    const successful = await reconcileConfirmedWrite('创建学校', async () => {});
    assert.equal(successful, true, 'a complete authoritative refresh must keep writes available');
    assert.equal(state.writeLock, null);

    state.errors = {};
    const refreshError = new Error('权威读取失败');
    const reconciled = await reconcileConfirmedWrite('创建学校', async () => {
        state.errors.schools = refreshError;
    });
    assert.equal(reconciled, false, 'a swallowed reconciliation GET failure must be detected');
    assert.equal(state.writeLock.confirmed, true, 'confirmed writes must use the confirmed-refresh lock');
    assert.equal(state.writeLock.label, '创建学校');
    assert.match(state.flash.message, /已由服务器确认/);
    assert.match(state.flash.message, /系统不会重复发送/);

    state.writeLock = null;
    state.flash = null;
    lockConfirmedWrite('提交评分', { requestId: 'req-confirmed-1', message: '响应格式无效' });
    assert.deepEqual(
        {
            confirmed: state.writeLock.confirmed,
            label: state.writeLock.label,
            requestId: state.writeLock.requestId
        },
        { confirmed: true, label: '提交评分', requestId: 'req-confirmed-1' }
    );
    assert.match(state.flash.message, /权威数据刷新失败/);

    process.stdout.write('teacher-confirmed-write-contract: ok\n');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
