const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'pages/admin/admin.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'pages/admin/admin.css'), 'utf8');
const browserProof = fs.readFileSync(path.join(root, 'tools/browser/role-workflows-proof.cjs'), 'utf8');
const context = {
    window: {},
    navigator: { onLine: true },
    console
};

vm.runInNewContext(source, context, { filename: 'pages/admin/admin.js' });
const contract = context.window.AdminGovernance && context.window.AdminGovernance.contract;
assert.ok(contract, 'admin governance must expose deterministic contract helpers');

assert.deepEqual(
    Array.from(contract.organizationFields('school')),
    ['name', 'region', 'description'],
    'school metadata whitelist must remain explicit'
);
assert.deepEqual(
    Array.from(contract.organizationFields('class')),
    ['name', 'grade', 'term', 'description'],
    'class metadata whitelist must remain explicit'
);

const school = {
    id: 7,
    name: '星序学校',
    region: '华北',
    description: null,
    status: 'active',
    version: 3
};
const schoolPayload = contract.buildOrganizationMutation('school', school, {
    name: ' 星序实验学校 ',
    region: ' ',
    description: ' 受限治理 ',
    reason: ' 组织信息校准 ',
    school_id: '999',
    sql: 'drop table users'
}, 'metadata');
assert.deepEqual(JSON.parse(JSON.stringify(schoolPayload)), {
    expected_version: 3,
    reason: '组织信息校准',
    name: '星序实验学校',
    region: null,
    description: '受限治理'
});
assert.equal('school_id' in schoolPayload, false, 'school ownership cannot be submitted');
assert.equal('sql' in schoolPayload, false, 'non-domain input cannot enter payload');

const classGroup = {
    id: 11,
    school_id: 7,
    name: '一班',
    grade: '高一',
    term: '上学期',
    description: '历史',
    status: 'archived',
    version: 8
};
const restorePayload = contract.buildOrganizationMutation('class', classGroup, {
    name: '任意未提交草稿',
    grade: '高二',
    term: '下学期',
    description: '',
    reason: '恢复教学组织',
    school_id: '12'
}, 'status');
assert.deepEqual(JSON.parse(JSON.stringify(restorePayload)), {
    expected_version: 8,
    reason: '恢复教学组织',
    status: 'active'
});

assert.throws(
    () => contract.buildOrganizationMutation('school', school, {
        name: school.name,
        region: school.region,
        description: '',
        reason: '没有字段变化'
    }, 'metadata'),
    /没有变化/
);
assert.throws(
    () => contract.buildOrganizationMutation('class', classGroup, {
        name: classGroup.name,
        grade: classGroup.grade,
        term: classGroup.term,
        description: classGroup.description,
        reason: '   '
    }, 'metadata'),
    /原因不能为空/
);

assert.equal(contract.organizationMutationMatches({
    ...school,
    ...schoolPayload,
    version: 4
}, schoolPayload, 3), true, 'exact version+1 authority read must prove the mutation');
assert.equal(contract.organizationMutationMatches({
    ...school,
    ...schoolPayload,
    version: 5
}, schoolPayload, 3), false, 'later version cannot be attributed to the original mutation');
assert.equal(contract.organizationMutationMatches({
    ...school,
    name: '并发名称',
    version: 4
}, schoolPayload, 3), false, 'mismatched authority values cannot prove the mutation');

const signature = contract.organizationMutationSignature('school', 7, 'metadata', schoolPayload);
assert.equal(signature, contract.organizationMutationSignature('school', 7, 'metadata', schoolPayload));
assert.notEqual(signature, contract.organizationMutationSignature('school', 7, 'status', schoolPayload));

for (const selector of [
    'data-admin-organization-edit',
    'data-admin-organization-form',
    'data-admin-organization-reason',
    'data-admin-organization-version',
    'data-admin-organization-confirm',
    'data-admin-organization-reconcile',
    'data-admin-organization-unlock',
    'data-admin-organization-status',
    'data-admin-organization-lock',
    'data-admin-organization-title',
    'data-admin-organization-readonly'
]) {
    assert.ok(source.includes(selector), `stable selector missing: ${selector}`);
}

assert.match(source, /if \(!pending \|\| pending\.signature !== signature\)[\s\S]*return;[\s\S]*commitOrganizationUpdate\(pending\)/);
assert.match(source, /method:\s*'PATCH'[\s\S]*body:\s*submission\.payload/);
assert.match(source, /error\.status === 409[\s\S]*handleOrganizationConflict/);
assert.match(source, /AstraApiClient\.isAmbiguousMutation\(error\)[\s\S]*reconcileOrganizationWrite\(false, operationOwner\)/);
assert.match(source, /loadOrganizationAuthority\(submission\.kind, submission\.id/);
assert.match(source, /loadOrganizationAuthority\(submission\.kind, submission\.id[\s\S]*if \(!organizationMutationMatches\(authority, submission\.payload, submission\.payload\.expected_version\)\)[\s\S]*confirmed-authority-mismatch/);
assert.match(source, /Number\(resource\.version\) !== Number\(expectedVersion\) \+ 1/);
assert.match(source, /setBusy\(true\)[\s\S]*AstraApiClient\.request\(organizationEndpoint/);
assert.match(source, /const operationOwner = captureLifecycleOwner\(\)[\s\S]*signal: operationOwner\.controller\.signal/);
assert.match(source, /function isLifecycleOwner\(owner\)[\s\S]*owner\.controller === state\.lifecycleController/);
assert.match(source, /finally \{[\s\S]*if \(isLifecycleOwner\(operationOwner\)\)[\s\S]*setBusy\(false\)/);
assert.match(source, /addEventListener\('cancel',[\s\S]*preventDefault\(\)[\s\S]*capture:\s*true[\s\S]*signal:\s*state\.eventController\.signal/);
assert.match(source, /if \(state\.eventController\) state\.eventController\.abort\(\)/);
assert.match(source, /state\.rafIds\.forEach\(\(id\) => window\.cancelAnimationFrame\(id\)\)/);
assert.match(source, /function organizationOutcomeFocusSelector\(\)[\s\S]*data-admin-organization-unlock[\s\S]*data-admin-organization-status/);
assert.match(source, /requestAnimationFrame\([\s\S]*dialog\.contains|requestAnimationFrame\([\s\S]*target\.focus/);
assert.match(source, /const currentTrigger = editor && state\.root && state\.root\.querySelector\([\s\S]*data-admin-organization-edit[\s\S]*originalTrigger && originalTrigger\.isConnected \? originalTrigger : currentTrigger/);
assert.match(browserProof, /in-flight PATCH route destroy preserves lock across admin re-entry/);
assert.match(browserProof, /waitForEvent\('requestfailed'[\s\S]*window\.location\.hash = 'teacher'[\s\S]*window\.location\.hash = 'admin'/);
assert.match(browserProof, /reentryBusyEvidence\.rootBusy[\s\S]*reentryBusyEvidence\.refreshDisabled/);
assert.match(browserProof, /lifecyclePatchBeforeReconcile[\s\S]*must not resend the destroyed PATCH/);
assert.match(styles, /\.admin-organization-dialog \.admin-icon-button\s*\{[\s\S]*min-width:\s*44px;[\s\S]*min-height:\s*44px/);
assert.doesNotMatch(source, /name="(?:version|school_id|table|sql)"/i);
assert.doesNotMatch(source, /textarea[^>]+(?:sql|json|table)/i);

console.log('admin-organization-governance-contract: ok');
