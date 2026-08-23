const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const templateRoot = path.join(root, 'tools/templates/new-experiment');
const {
    loadProductionBaseline,
    validateCandidateManifests,
    discoverCandidateManifests
} = require('../quality/check-new-experiment-registration.cjs');

const read = (file) => fs.readFileSync(file, 'utf8');
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const protectedFiles = [
    path.join(root, 'shared/js/config.js'),
    path.join(root, 'shared/js/experiment-registry.js'),
    path.join(root, 'index.html')
];
const beforeHashes = protectedFiles.map(sha256);
const baseline = loadProductionBaseline(root);
assert.equal(baseline.count, 88);
assert.deepEqual([...baseline.subjects].sort(), ['algorithms', 'biology', 'chemistry', 'mathematics', 'physics']);
assert.equal(baseline.keys.size, 88);
assert.equal(baseline.routes.size, 88);
assert.ok(baseline.owners.has('PhysicsSim'));
assert.ok(baseline.scripts.has('pages/physics/physics.js'));

const replacements = Object.freeze({
    __SUBJECT__: 'physics',
    __EXPERIMENT_ID__: 'registration-probe',
    __EXPERIMENT_TITLE__: '新增实验注册探针',
    __OWNER__: 'RegistrationProbe',
    __NAMESPACE__: 'registration-probe',
    __ASSET_VERSION__: '20260824v821Ext02P0',
    __PARAMETER_LABEL__: '主变量',
    __PARAMETER_UNIT__: 'm',
    __PRIMARY_LEGEND__: '运动对象',
    __SECONDARY_LEGEND__: '参考位置',
    __ACCENT_TOKEN__: '--accent-purple',
    __ACCENT_RGB__: '139, 111, 192'
});
const render = (source) => Object.entries(replacements).reduce(
    (result, [token, value]) => result.split(token).join(value),
    source
);

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-ext02-'));
try {
    const candidateDirectory = path.join(temporaryRoot, 'pages/physics/registration-probe');
    const modelDocumentDirectory = path.join(temporaryRoot, 'doc/01-子文档');
    fs.mkdirSync(candidateDirectory, { recursive: true });
    fs.mkdirSync(modelDocumentDirectory, { recursive: true });
    fs.writeFileSync(path.join(candidateDirectory, 'index.js'), render(read(path.join(templateRoot, 'index.js.tpl'))));
    fs.writeFileSync(path.join(candidateDirectory, 'styles.css'), render(read(path.join(templateRoot, 'styles.css.tpl'))));
    const modelDocument = read(path.join(templateRoot, 'model-notes.example.md'))
        .replaceAll('model-model-document-probe', 'model-registration-probe')
        .replaceAll('physics.model-document-probe', 'physics.registration-probe')
        .replaceAll('匀速运动校核样例', '新增实验注册探针')
        .replaceAll('pages/physics/model-document-probe', 'pages/physics/registration-probe');
    fs.writeFileSync(
        path.join(modelDocumentDirectory, '15-学科实验与内容开发指南.md'),
        modelDocument
    );
    const validManifest = JSON.parse(render(read(path.join(templateRoot, 'manifest.json.tpl'))));
    const validate = (...manifests) => validateCandidateManifests({
        manifests: manifests.map((data, index) => ({ source: `fixture-${index + 1}.json`, data })),
        root: temporaryRoot,
        baseline
    });
    const codes = (result) => new Set(result.errors.map((error) => error.code));

    const valid = validate(validManifest);
    assert.equal(valid.ok, true, JSON.stringify(valid.errors));
    assert.equal(valid.checked, 1);
    assert.equal(valid.protectedExperiments, 88);

    const missingModelDocument = {
        ...validManifest,
        model_document: 'doc/01-子文档/missing.md#model-registration-probe'
    };
    assert.ok(codes(validate(missingModelDocument)).has('model_document_missing'));

    const duplicateIdentity = {
        ...validManifest,
        id: 'mechanics',
        activity_key: 'physics.mechanics',
        route: '#physics/mechanics',
        namespace: 'astra-exp--mechanics'
    };
    const duplicateCodes = codes(validate(duplicateIdentity));
    assert.ok(duplicateCodes.has('key_conflict'));
    assert.ok(duplicateCodes.has('activity_key_conflict'));
    assert.ok(duplicateCodes.has('route_conflict'));

    const duplicateTitle = { ...validManifest, title: '恢复系数与反弹高度' };
    assert.ok(codes(validate(duplicateTitle)).has('title_conflict'));

    const missingOwner = {
        ...validManifest,
        owner: '',
        init_hook: '',
        cleanup: { ...validManifest.cleanup, owner: '' }
    };
    assert.ok(codes(validate(missingOwner)).has('owner_required'));

    const missingResource = { ...validManifest, script: 'pages/physics/registration-probe/missing.js?v=20260824v821Ext02P0' };
    assert.ok(codes(validate(missingResource)).has('resource_missing'));

    const traversal = { ...validManifest, style: '../styles.css?v=20260824v821Ext02P0' };
    assert.ok(codes(validate(traversal)).has('resource_outside_root'));

    const runtimeFile = path.join(candidateDirectory, 'index.js');
    const validRuntime = read(runtimeFile);
    fs.writeFileSync(runtimeFile, 'window.initRegistrationProbe = () => true; window.RegistrationProbe = {};');
    assert.ok(codes(validate(validManifest)).has('cleanup_method_missing'));
    fs.writeFileSync(runtimeFile, 'window.initRegistrationProbe = () => true;');
    assert.ok(codes(validate(validManifest)).has('owner_export_missing'));
    fs.writeFileSync(runtimeFile, 'window.initRegistrationProbe = () => true; window.RegistrationProbe = { destroy() { throw new Error("unsafe cleanup"); } };');
    assert.ok(codes(validate(validManifest)).has('cleanup_smoke_failed'));
    fs.writeFileSync(runtimeFile, validRuntime);

    const secondManifest = {
        ...validManifest,
        title: '批内重复注册',
        owner: 'SecondRegistrationProbe',
        init_hook: 'initSecondRegistrationProbe',
        cleanup: { ...validManifest.cleanup, owner: 'SecondRegistrationProbe' }
    };
    const batchCodes = codes(validate(validManifest, secondManifest));
    assert.ok(batchCodes.has('key_conflict'));
    assert.ok(batchCodes.has('route_conflict'));

    assert.deepEqual(discoverCandidateManifests(root), [], 'production tree must not contain a registered candidate manifest yet');
    const cli = spawnSync(process.execPath, ['tools/quality/check-new-experiment-registration.cjs'], {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true
    });
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /no candidate manifest found; protected baseline unchanged/);
} finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

assert.deepEqual(protectedFiles.map(sha256), beforeHashes, 'EXT-02 checker must not mutate production registry surfaces');
console.log('new-experiment-registration-contract: conflicts, resources, model document, owner and cleanup PASS');
