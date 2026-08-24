const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const baselineFile = path.join(root, 'tools/quality/baselines/protected-activities-v822.json');
const exceptionFile = path.join(root, 'tools/quality/protected-activity-exceptions.json');
const {
    buildCurrentProjection,
    createBaseline,
    compareWithBaseline
} = require('../quality/check-protected-activity-changes.cjs');

const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
const exceptions = JSON.parse(fs.readFileSync(exceptionFile, 'utf8'));
const current = buildCurrentProjection(root);
assert.equal(current.length, 126);
assert.deepEqual(
    current.reduce((counts, activity) => {
        counts[activity.galaxy_key] = (counts[activity.galaxy_key] || 0) + 1;
        return counts;
    }, {}),
    { englab: 90, 'code-space': 18, 'future-galaxy': 18 }
);
assert.equal(new Set(current.map((activity) => `${activity.galaxy_key}:${activity.activity_key}`)).size, 126);
assert.deepEqual(
    createBaseline(current.filter((activity) => ![
        'physics.double-pendulum-chaos',
        'chemistry.chromatography-separation'
    ].includes(activity.activity_key)), baseline.source_revision),
    baseline,
    'baseline JSON must remain deterministic when the approved new activity is excluded'
);

const clean = compareWithBaseline(current, baseline, exceptions);
assert.equal(clean.ok, true, JSON.stringify(clean.issues));
assert.equal(clean.protectedCount, 124);
assert.deepEqual(Array.from(clean.additions), [
    'englab:chemistry.chromatography-separation',
    'englab:physics.double-pendulum-chaos'
]);

const newActivity = {
    galaxy_key: 'englab',
    course_key: 'physics',
    activity_key: 'physics.future-new-probe',
    route: '#physics/future-new-probe',
    title: '普通新增探针',
    owners: ['FutureNewProbe'],
    init_hooks: ['initFutureNewProbe'],
    cleanup_hooks: ['FutureNewProbe'],
    presentation: {},
    sources: ['pages/physics/future-new-probe/manifest.json'],
    resources: []
};
const withAddition = compareWithBaseline([...current, newActivity], baseline, exceptions);
assert.equal(withAddition.ok, true);
assert.deepEqual(Array.from(withAddition.additions), [
    'englab:chemistry.chromatography-separation',
    'englab:physics.double-pendulum-chaos',
    'englab:physics.future-new-probe'
]);

const changedResourceProjection = JSON.parse(JSON.stringify(current));
const mechanics = changedResourceProjection.find((activity) => activity.activity_key === 'physics.mechanics');
const mechanicsScript = mechanics.resources.find((resource) => resource.kind === 'runtime-script');
assert.equal(mechanicsScript.path, 'pages/physics/physics.js');
mechanicsScript.sha256 = '0'.repeat(64);
const changedResource = compareWithBaseline(changedResourceProjection, baseline, exceptions);
assert.equal(changedResource.ok, false);
const resourceIssue = changedResource.issues.find((issue) => issue.code === 'protected_resource_changed');
assert.ok(resourceIssue);
assert.equal(resourceIssue.galaxy_key, 'englab');
assert.equal(resourceIssue.activity_key, 'physics.mechanics');
assert.equal(resourceIssue.file, 'pages/physics/physics.js');

const approved = compareWithBaseline(changedResourceProjection, baseline, {
    schema_version: 1,
    exceptions: [{
        signature: resourceIssue.signature,
        task_id: 'KNOWLEDGE-FIX-PROBE',
        approved_by: 'project-owner',
        approved_on: '2026-08-24',
        reason: 'contract-only exact fingerprint exception',
        one_time: true
    }]
});
assert.equal(approved.ok, true);
assert.equal(approved.approved.length, 1);
assert.equal(approved.issues.length, 0);

const changedMetadataProjection = JSON.parse(JSON.stringify(current));
changedMetadataProjection.find((activity) => activity.activity_key === 'control-flow.loop-boundary').route = 'codevis/#challenge?activity=wrong';
const changedMetadata = compareWithBaseline(changedMetadataProjection, baseline, exceptions);
assert.equal(changedMetadata.ok, false);
const metadataIssue = changedMetadata.issues.find((issue) => issue.code === 'protected_metadata_changed');
assert.ok(metadataIssue);
assert.equal(metadataIssue.galaxy_key, 'code-space');
assert.equal(metadataIssue.activity_key, 'control-flow.loop-boundary');
assert.match(metadataIssue.file, /course-manifest\.js/);

assert.throws(
    () => compareWithBaseline(changedResourceProjection, baseline, { schema_version: 1, exceptions: [{ signature: resourceIssue.signature }] }),
    /Invalid protected activity exception/
);

const cli = spawnSync(process.execPath, ['tools/quality/check-protected-activity-changes.cjs'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true
});
assert.equal(cli.status, 0, cli.stderr);
assert.match(cli.stdout, /124 protected activities PASS; 2 unprotected addition\(s\) ignored/);

console.log('protected-activity-change-alert-contract: 124 protected identities plus 2 approved additions, alerts and exact exceptions PASS');
