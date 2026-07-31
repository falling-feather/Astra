const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');
}

function main() {
    const teacher = read('pages/teacher/teacher.js');
    const student = read('pages/student/student-workbench.js');
    const studentEvidence = read('shared/js/student-learning-evidence.js');
    const admin = read('pages/admin/admin.js');

    for (const token of [
        '/students/batch-import',
        '/students/${Number(data.membership_id)}/transfer',
        '/collaborators/batch',
        "'content_editor'",
        "'assessment_editor'",
        "'viewer'",
        '/classes/${state.selected.classId}/policy',
        '/audience',
        'result.failed_count',
    ]) {
        assert.ok(teacher.includes(token), `teacher workbench must expose ${token}`);
    }
    assert.match(teacher, /软移除：保留提交、积分和审计历史/);
    assert.match(teacher, /恢复继承/);
    assert.match(teacher, /statistics|统计口径/);
    assert.match(teacher, /hasCourseCapability\(\['editor', 'content_editor'\]\)/);
    assert.match(teacher, /hasCourseCapability\(\['editor', 'content_editor', 'assessment_editor'\]\)/);
    assert.match(teacher, /hasCourseCapability\(\['editor', 'assessment_editor'\]\)/);
    assert.match(teacher, /canManageCourseOwnership\(\)/);
    assert.match(teacher, /fetchClassKnowledge\(classId\)/);
    assert.match(teacher, /params:\s*\{\s*class_id:\s*classId\s*\}/);
    assert.match(teacher, /attachedCourses\.some/);

    assert.match(student, /\/api\/knowledge\/me/);
    assert.match(student, /data-student-panel="knowledge"/);
    assert.doesNotMatch(student, /knowledge\.rule_version/);
    assert.match(studentEvidence, /recovery\.rule_version/);
    assert.match(studentEvidence, /旧 knowledge 统计仅属历史兼容数据/);

    assert.match(admin, /\/api\/admin\/class-join-requests\/\$\{Number\(authority\.id\)\}/);
    assert.match(admin, /AstraApiClient\.isAmbiguousMutation/);
    assert.match(admin, /系统不会自动重发/);
    assert.match(admin, /state\.writeLock/);
    assert.match(admin, /state\.pendingJoinReview/);
    assert.match(admin, /再次点击同一按钮以确认/);
    assert.match(admin, /rerenderJoinRequestsPanel/);
    assert.match(admin, /createConfirmedJoinReviewExecutor/);
    assert.match(admin, /\/api\/classes\/\$\{Number\(authority\.class_id\)\}\/members\/page/);
    assert.match(admin, /\/api\/admin\/stats/);
    assert.match(admin, /class\.join\.request\.approve/);
    assert.match(admin, /class\.join\.request\.reject/);
    assert.match(admin, /request_id:\s*requestId/);
    assert.doesNotMatch(admin, /Authorization\s*:/i, 'admin mutations must remain cookie-only');

    process.stdout.write('v6653-permission-analytics-contract: ok\n');
}

try {
    main();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
