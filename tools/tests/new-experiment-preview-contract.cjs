const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
    loadContract,
    readWebPMetadata,
    validatePreviewAssets
} = require('../quality/check-new-experiment-preview.cjs');

const root = path.resolve(__dirname, '../..');
const contract = loadContract();
assert.equal(contract.version, 'V8.2.5');
assert.equal(contract.scope, 'new-experiment-only');
assert.equal(contract.production_registration, false);
assert.deepEqual(contract.poster, {
    filename: 'preview.webp',
    format: 'webp',
    width: 1600,
    height: 900,
    minimum_bytes: 1024,
    maximum_bytes: 122880,
    animated: false
});
assert.equal(contract.motion.optional, true);
assert.equal(contract.reduced_motion, 'poster');

const binaryFixture = path.join(root, 'UI/future-galaxy/orbit-observatory.webp');
const fixtureMetadata = readWebPMetadata(binaryFixture);
assert.deepEqual(
    {
        width: fixtureMetadata.width,
        height: fixtureMetadata.height,
        bytes: fixtureMetadata.bytes,
        animated: fixtureMetadata.animated
    },
    { width: 1600, height: 900, bytes: 53210, animated: false }
);
assert.equal(fixtureMetadata.sha256, '1a69ad8d1139127575892fa9360255ac789c02c88dfcbe01ee62aba605b1c3bc');
assert.throws(() => readWebPMetadata(Buffer.from('not-webp')), /not a RIFF WebP/);

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-ext06-preview-'));
try {
    const candidateDirectory = path.join(temporaryRoot, 'pages/physics/preview-probe');
    fs.mkdirSync(candidateDirectory, { recursive: true });
    fs.writeFileSync(path.join(candidateDirectory, 'index.js'), 'window.PreviewProbe = {};');
    fs.writeFileSync(path.join(candidateDirectory, 'styles.css'), '.preview-probe {}');
    // The repository image is copied only as a deterministic WebP binary fixture inside this temp directory.
    const previewFile = path.join(candidateDirectory, 'preview.webp');
    fs.copyFileSync(binaryFixture, previewFile);

    const manifest = {
        subject: 'physics',
        id: 'preview-probe',
        title: '位移轨迹预览探针',
        route: '#physics/preview-probe',
        preview: {
            record: 'pages/physics/preview-probe/preview.json',
            poster: 'pages/physics/preview-probe/preview.webp?v=20260824v825Ext06P0',
            alt: '青色质点随位移参数向右移动并显示相对参考线的位置变化',
            motion: null,
            reduced_motion: 'poster'
        }
    };
    const record = {
        schema_version: 1,
        subject: 'physics',
        id: 'preview-probe',
        alt: manifest.preview.alt,
        poster: {
            path: 'pages/physics/preview-probe/preview.webp',
            width: fixtureMetadata.width,
            height: fixtureMetadata.height,
            bytes: fixtureMetadata.bytes,
            sha256: fixtureMetadata.sha256
        },
        motion: null,
        reduced_motion: 'poster',
        source: {
            method: 'browser-capture',
            route: '#physics/preview-probe',
            selector: '[data-module="preview-probe"] [data-role="stage"]',
            viewport: { width: 1600, height: 900 },
            captured_by: '前端视觉复核角色',
            captured_on: '2026-08-24',
            rights: 'project-original',
            source_files: [
                'pages/physics/preview-probe/index.js',
                'pages/physics/preview-probe/styles.css'
            ]
        },
        content: {
            shows_interaction_result: true,
            decorative_only: false,
            old_activity_source: false,
            embedded_title: false
        }
    };
    const recordFile = path.join(candidateDirectory, 'preview.json');
    const writeRecord = (value) => fs.writeFileSync(recordFile, `${JSON.stringify(value, null, 2)}\n`);
    const codes = (result) => new Set(result.errors.map((error) => error.code));
    const validate = (recordValue = record, manifestValue = manifest, contractValue = contract) => {
        writeRecord(recordValue);
        return validatePreviewAssets({ manifest: manifestValue, root: temporaryRoot, contract: contractValue });
    };

    const valid = validate();
    assert.equal(valid.ok, true, JSON.stringify(valid.errors, null, 2));
    assert.deepEqual(valid.stats, {
        posterBytes: 53210,
        posterWidth: 1600,
        posterHeight: 900,
        motion: false,
        motionFrames: 0,
        motionDurationMs: 0
    });

    assert.ok(codes(validate(record, { ...manifest, preview: null })).has('preview_required'));
    assert.ok(codes(validate({ ...record, id: 'wrong-id' })).has('record_identity_mismatch'));
    assert.ok(codes(validate({ ...record, alt: '一张图片' }, {
        ...manifest,
        preview: { ...manifest.preview, alt: '一张图片' }
    })).has('alt_invalid'));
    assert.ok(codes(validate({ ...record, reduced_motion: 'motion' })).has('reduced_motion_invalid'));
    assert.ok(codes(validate({
        ...record,
        source: { ...record.source, captured_by: '[待填写：责任人]' }
    })).has('record_unresolved_marker'));
    assert.ok(codes(validate({
        ...record,
        source: { ...record.source, source_files: ['pages/physics/other/index.js'] }
    })).has('source_file_invalid'));
    assert.ok(codes(validate({
        ...record,
        content: { ...record.content, old_activity_source: true }
    })).has('content_policy_invalid'));
    assert.ok(codes(validate({
        ...record,
        poster: { ...record.poster, bytes: 1 }
    })).has('poster_metadata_mismatch'));
    assert.ok(codes(validate({
        ...record,
        poster: { ...record.poster, sha256: '0'.repeat(64) }
    })).has('poster_hash_mismatch'));
    const tinyBudget = JSON.parse(JSON.stringify(contract));
    tinyBudget.poster.maximum_bytes = 100;
    assert.ok(codes(validate(record, manifest, tinyBudget)).has('poster_size_invalid'));

    fs.copyFileSync(binaryFixture, path.join(candidateDirectory, 'preview-motion.webp'));
    const motionManifest = {
        ...manifest,
        preview: {
            ...manifest.preview,
            motion: 'pages/physics/preview-probe/preview-motion.webp?v=20260824v825Ext06P0'
        }
    };
    const motionRecord = {
        ...record,
        motion: {
            path: 'pages/physics/preview-probe/preview-motion.webp',
            width: fixtureMetadata.width,
            height: fixtureMetadata.height,
            bytes: fixtureMetadata.bytes,
            sha256: fixtureMetadata.sha256,
            duration_ms: 0,
            frames: 0
        }
    };
    assert.ok(codes(validate(motionRecord, motionManifest)).has('motion_not_animated'));

    writeRecord(record);
    const manifestFile = path.join(candidateDirectory, 'manifest.json');
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    const cli = spawnSync(
        process.execPath,
        [
            path.join(root, 'tools/quality/check-new-experiment-preview.cjs'),
            '--root',
            temporaryRoot,
            '--manifest',
            manifestFile
        ],
        { encoding: 'utf8', windowsHide: true }
    );
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /physics\.preview-probe PASS; 1600x900, 53210 bytes, still poster/);

    const inspect = spawnSync(
        process.execPath,
        [path.join(root, 'tools/quality/check-new-experiment-preview.cjs'), '--inspect', previewFile],
        { encoding: 'utf8', windowsHide: true }
    );
    assert.equal(inspect.status, 0, inspect.stderr);
    assert.deepEqual(JSON.parse(inspect.stdout), {
        width: 1600,
        height: 900,
        bytes: 53210,
        sha256: fixtureMetadata.sha256,
        animated: false,
        frames: 0,
        duration_ms: 0
    });
} finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

const productionFiles = [
    'shared/js/config.js',
    'shared/js/experiment-registry.js',
    'index.html'
].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
assert.doesNotMatch(productionFiles, /preview-probe/);

console.log('new-experiment-preview-contract: EXT-06 poster, provenance and still fallback PASS');
