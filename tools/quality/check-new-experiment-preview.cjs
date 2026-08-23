const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_CONTRACT_FILE = path.join(
    DEFAULT_ROOT,
    'tools/templates/new-experiment/preview-assets.contract.json'
);

const stripQuery = (value) => String(value || '').split(/[?#]/, 1)[0].replaceAll('\\', '/');
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const readUInt24LE = (buffer, offset) => (
    buffer[offset]
    | (buffer[offset + 1] << 8)
    | (buffer[offset + 2] << 16)
);

function loadContract(file = DEFAULT_CONTRACT_FILE) {
    const contract = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (contract.schema_version !== 1 || contract.task !== 'EXT-06') {
        throw new Error('Unsupported preview-assets contract');
    }
    return contract;
}

function addError(errors, code, message) {
    errors.push(Object.freeze({ code, message }));
}

function readWebPMetadata(input) {
    const buffer = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
    if (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
        throw new Error('file is not a RIFF WebP container');
    }
    const declaredBytes = buffer.readUInt32LE(4) + 8;
    if (declaredBytes !== buffer.length) {
        throw new Error(`RIFF byte length mismatch: declared ${declaredBytes}, actual ${buffer.length}`);
    }

    let width = 0;
    let height = 0;
    let offset = 12;
    let hasAnimationHeader = false;
    let frameCount = 0;
    let durationMs = 0;
    const chunks = [];

    while (offset + 8 <= buffer.length) {
        const type = buffer.toString('ascii', offset, offset + 4);
        const size = buffer.readUInt32LE(offset + 4);
        const dataOffset = offset + 8;
        const dataEnd = dataOffset + size;
        if (dataEnd > buffer.length) throw new Error(`WebP chunk ${type} exceeds file length`);
        chunks.push(type);

        if (type === 'VP8X') {
            if (size < 10) throw new Error('VP8X chunk is truncated');
            width = readUInt24LE(buffer, dataOffset + 4) + 1;
            height = readUInt24LE(buffer, dataOffset + 7) + 1;
        } else if (type === 'VP8 ') {
            if (
                size < 10
                || buffer[dataOffset + 3] !== 0x9d
                || buffer[dataOffset + 4] !== 0x01
                || buffer[dataOffset + 5] !== 0x2a
            ) throw new Error('VP8 frame header is invalid');
            if (!width) width = buffer.readUInt16LE(dataOffset + 6) & 0x3fff;
            if (!height) height = buffer.readUInt16LE(dataOffset + 8) & 0x3fff;
        } else if (type === 'VP8L') {
            if (size < 5 || buffer[dataOffset] !== 0x2f) throw new Error('VP8L frame header is invalid');
            const bits = buffer.readUInt32LE(dataOffset + 1);
            if (!width) width = (bits & 0x3fff) + 1;
            if (!height) height = ((bits >>> 14) & 0x3fff) + 1;
        } else if (type === 'ANIM') {
            if (size < 6) throw new Error('ANIM chunk is truncated');
            hasAnimationHeader = true;
        } else if (type === 'ANMF') {
            if (size < 16) throw new Error('ANMF chunk is truncated');
            frameCount += 1;
            durationMs += readUInt24LE(buffer, dataOffset + 12);
        }
        offset = dataEnd + (size % 2);
    }

    if (!width || !height) throw new Error('WebP dimensions are unavailable');
    if (offset !== buffer.length) throw new Error('WebP chunk alignment does not match file length');
    return Object.freeze({
        width,
        height,
        bytes: buffer.length,
        sha256: sha256(buffer),
        animated: hasAnimationHeader && frameCount > 0,
        frameCount,
        durationMs,
        chunks: Object.freeze(chunks)
    });
}

function resolveCandidateFile(root, value, expectedPrefix) {
    const relative = stripQuery(value);
    const repositoryRoot = path.resolve(root);
    const absolute = path.resolve(repositoryRoot, relative.replaceAll('/', path.sep));
    const rootPrefix = repositoryRoot.endsWith(path.sep) ? repositoryRoot : `${repositoryRoot}${path.sep}`;
    if (
        !relative
        || path.isAbsolute(relative)
        || !absolute.startsWith(rootPrefix)
        || !relative.startsWith(expectedPrefix)
    ) {
        return { ok: false, reason: 'outside-candidate', relative, absolute };
    }
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
        return { ok: false, reason: 'missing', relative, absolute };
    }
    return { ok: true, relative, absolute };
}

function meaningful(value, contract) {
    const text = String(value || '').trim();
    return Boolean(text) && !new RegExp(contract.unresolved_marker_pattern, 'i').test(text);
}

function validatePreviewAssets({ manifest, root = DEFAULT_ROOT, contract = loadContract() }) {
    const errors = [];
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        addError(errors, 'manifest_invalid', 'manifest must be an object');
        return Object.freeze({ ok: false, errors: Object.freeze(errors), stats: Object.freeze({}) });
    }

    const subject = String(manifest.subject || '');
    const id = String(manifest.id || '');
    const expectedPrefix = `pages/${subject}/${id}/`;
    const preview = manifest.preview;
    if (!preview || typeof preview !== 'object' || Array.isArray(preview)) {
        addError(errors, 'preview_required', 'manifest.preview is required');
        return Object.freeze({ ok: false, errors: Object.freeze(errors), stats: Object.freeze({}) });
    }

    const expectedRecord = `${expectedPrefix}preview.json`;
    if (preview.record !== expectedRecord) {
        addError(errors, 'record_path_invalid', `preview.record must equal ${expectedRecord}`);
    }
    const recordFile = resolveCandidateFile(root, preview.record, expectedPrefix);
    if (!recordFile.ok) {
        addError(
            errors,
            recordFile.reason === 'missing' ? 'record_missing' : 'record_outside_candidate',
            `preview record is unavailable: ${recordFile.relative || '<empty>'}`
        );
        return Object.freeze({ ok: false, errors: Object.freeze(errors), stats: Object.freeze({}) });
    }

    let record;
    try {
        record = JSON.parse(fs.readFileSync(recordFile.absolute, 'utf8'));
    } catch (error) {
        addError(errors, 'record_json_invalid', error.message);
        return Object.freeze({ ok: false, errors: Object.freeze(errors), stats: Object.freeze({}) });
    }
    if (new RegExp(contract.unresolved_marker_pattern, 'i').test(JSON.stringify(record))) {
        addError(errors, 'record_unresolved_marker', 'preview record still contains an unresolved marker');
    }
    if (record.schema_version !== 1) addError(errors, 'record_schema_invalid', 'preview record schema_version must equal 1');
    if (record.subject !== subject || record.id !== id) {
        addError(errors, 'record_identity_mismatch', `preview record identity must equal ${subject}.${id}`);
    }

    const alt = String(preview.alt || '').trim();
    if (alt !== String(record.alt || '').trim()) {
        addError(errors, 'alt_mismatch', 'manifest and preview record alt text must match');
    }
    if (
        !meaningful(alt, contract)
        || [...alt].length < contract.alt.minimum_characters
        || [...alt].length > contract.alt.maximum_characters
        || contract.alt.forbidden_generic_terms.some((term) => alt.toLocaleLowerCase('zh-CN').includes(term.toLocaleLowerCase('zh-CN')))
    ) {
        addError(errors, 'alt_invalid', 'alt text must describe the visible model result instead of naming a generic image asset');
    }
    if (alt === String(manifest.title || '').trim()) {
        addError(errors, 'alt_title_only', 'alt text cannot repeat only the experiment title');
    }

    if (preview.reduced_motion !== contract.reduced_motion || record.reduced_motion !== contract.reduced_motion) {
        addError(errors, 'reduced_motion_invalid', `reduced-motion fallback must equal ${contract.reduced_motion}`);
    }

    const source = record.source;
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        addError(errors, 'source_required', 'preview source record is required');
    } else {
        if (!contract.source.allowed_methods.includes(source.method)) {
            addError(errors, 'source_method_invalid', `source.method is not allowed: ${source.method || '<empty>'}`);
        }
        if (!contract.source.allowed_rights.includes(source.rights)) {
            addError(errors, 'source_rights_invalid', `source.rights is not allowed: ${source.rights || '<empty>'}`);
        }
        if (source.route !== manifest.route) addError(errors, 'source_route_mismatch', 'source.route must equal manifest.route');
        if (!meaningful(source.captured_by, contract)) addError(errors, 'source_author_missing', 'source.captured_by is required');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(source.captured_on || ''))) {
            addError(errors, 'source_date_invalid', 'source.captured_on must use YYYY-MM-DD');
        }
        if (
            Number(source.viewport?.width) !== contract.source.required_viewport.width
            || Number(source.viewport?.height) !== contract.source.required_viewport.height
        ) {
            addError(errors, 'source_viewport_invalid', 'source viewport must match the poster capture viewport');
        }
        if (source.method === 'browser-capture' && !String(source.selector || '').includes(`[data-module="${id}"]`)) {
            addError(errors, 'source_selector_invalid', 'browser capture selector must target the new experiment module');
        }
        if (!Array.isArray(source.source_files) || source.source_files.length === 0) {
            addError(errors, 'source_files_required', 'at least one new-experiment source file is required');
        } else {
            for (const sourceFile of source.source_files) {
                const resolved = resolveCandidateFile(root, sourceFile, expectedPrefix);
                if (!resolved.ok) {
                    addError(errors, 'source_file_invalid', `source file must exist inside ${expectedPrefix}: ${sourceFile}`);
                }
            }
        }
    }

    const content = record.content || {};
    for (const [field, expected] of Object.entries(contract.content_policy)) {
        if (content[field] !== expected) {
            addError(errors, 'content_policy_invalid', `content.${field} must equal ${expected}`);
        }
    }

    const posterContract = contract.poster;
    const expectedPoster = `${expectedPrefix}${posterContract.filename}`;
    const posterBare = stripQuery(preview.poster);
    if (posterBare !== expectedPoster || !String(preview.poster || '').includes('?v=') || String(preview.poster || '').endsWith('?v=')) {
        addError(errors, 'poster_manifest_path_invalid', `preview.poster must be a versioned ${expectedPoster}`);
    }
    if (!record.poster || record.poster.path !== expectedPoster) {
        addError(errors, 'poster_record_path_invalid', `record.poster.path must equal ${expectedPoster}`);
    }
    const posterFile = resolveCandidateFile(root, preview.poster, expectedPrefix);
    let posterMetadata = null;
    if (!posterFile.ok) {
        addError(
            errors,
            posterFile.reason === 'missing' ? 'poster_missing' : 'poster_outside_candidate',
            `poster is unavailable: ${posterFile.relative || '<empty>'}`
        );
    } else {
        try {
            posterMetadata = readWebPMetadata(posterFile.absolute);
        } catch (error) {
            addError(errors, 'poster_webp_invalid', error.message);
        }
    }
    if (posterMetadata) {
        if (posterMetadata.width !== posterContract.width || posterMetadata.height !== posterContract.height) {
            addError(errors, 'poster_dimensions_invalid', `poster must be ${posterContract.width}x${posterContract.height}`);
        }
        if (posterMetadata.bytes < posterContract.minimum_bytes || posterMetadata.bytes > posterContract.maximum_bytes) {
            addError(errors, 'poster_size_invalid', `poster byte size must be within ${posterContract.minimum_bytes}-${posterContract.maximum_bytes}`);
        }
        if (posterMetadata.animated !== posterContract.animated) {
            addError(errors, 'poster_animation_invalid', 'poster must be a still WebP');
        }
        if (
            Number(record.poster?.width) !== posterMetadata.width
            || Number(record.poster?.height) !== posterMetadata.height
            || Number(record.poster?.bytes) !== posterMetadata.bytes
        ) {
            addError(errors, 'poster_metadata_mismatch', 'record poster width, height and bytes must match the file');
        }
        if (String(record.poster?.sha256 || '').toLowerCase() !== posterMetadata.sha256) {
            addError(errors, 'poster_hash_mismatch', 'record poster sha256 must match the file');
        }
    }

    const manifestMotion = preview.motion;
    const recordMotion = record.motion;
    let motionMetadata = null;
    if ((manifestMotion == null) !== (recordMotion == null)) {
        addError(errors, 'motion_record_mismatch', 'manifest and preview record must both omit or both declare motion');
    } else if (manifestMotion != null && recordMotion != null) {
        const motionContract = contract.motion;
        const expectedMotion = `${expectedPrefix}${motionContract.filename}`;
        const motionBare = stripQuery(manifestMotion);
        if (motionBare !== expectedMotion || !String(manifestMotion).includes('?v=') || String(manifestMotion).endsWith('?v=')) {
            addError(errors, 'motion_manifest_path_invalid', `preview.motion must be a versioned ${expectedMotion}`);
        }
        if (recordMotion.path !== expectedMotion) {
            addError(errors, 'motion_record_path_invalid', `record.motion.path must equal ${expectedMotion}`);
        }
        const motionFile = resolveCandidateFile(root, manifestMotion, expectedPrefix);
        if (!motionFile.ok) {
            addError(errors, motionFile.reason === 'missing' ? 'motion_missing' : 'motion_outside_candidate', 'motion asset is unavailable');
        } else {
            try {
                motionMetadata = readWebPMetadata(motionFile.absolute);
            } catch (error) {
                addError(errors, 'motion_webp_invalid', error.message);
            }
        }
        if (motionMetadata) {
            if (!motionMetadata.animated) addError(errors, 'motion_not_animated', 'motion asset must be an animated WebP');
            if (motionMetadata.width !== motionContract.width || motionMetadata.height !== motionContract.height) {
                addError(errors, 'motion_dimensions_invalid', `motion must be ${motionContract.width}x${motionContract.height}`);
            }
            if (motionMetadata.bytes > motionContract.maximum_bytes) addError(errors, 'motion_size_invalid', 'motion exceeds its byte budget');
            if (
                motionMetadata.durationMs < motionContract.minimum_duration_ms
                || motionMetadata.durationMs > motionContract.maximum_duration_ms
            ) addError(errors, 'motion_duration_invalid', 'motion duration is outside the allowed range');
            if (motionMetadata.frameCount > motionContract.maximum_frames) addError(errors, 'motion_frames_invalid', 'motion has too many frames');
            if (
                Number(recordMotion.width) !== motionMetadata.width
                || Number(recordMotion.height) !== motionMetadata.height
                || Number(recordMotion.bytes) !== motionMetadata.bytes
                || Number(recordMotion.duration_ms) !== motionMetadata.durationMs
                || Number(recordMotion.frames) !== motionMetadata.frameCount
            ) addError(errors, 'motion_metadata_mismatch', 'record motion metadata must match the file');
            if (String(recordMotion.sha256 || '').toLowerCase() !== motionMetadata.sha256) {
                addError(errors, 'motion_hash_mismatch', 'record motion sha256 must match the file');
            }
        }
    }

    return Object.freeze({
        ok: errors.length === 0,
        errors: Object.freeze(errors),
        stats: Object.freeze({
            posterBytes: posterMetadata?.bytes || 0,
            posterWidth: posterMetadata?.width || 0,
            posterHeight: posterMetadata?.height || 0,
            motion: Boolean(motionMetadata),
            motionFrames: motionMetadata?.frameCount || 0,
            motionDurationMs: motionMetadata?.durationMs || 0
        })
    });
}

function parseCli(argv) {
    let root = DEFAULT_ROOT;
    let manifest = '';
    let inspect = '';
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--root') root = path.resolve(argv[++index] || '');
        else if (argument === '--manifest') manifest = path.resolve(argv[++index] || '');
        else if (argument === '--inspect') inspect = path.resolve(argv[++index] || '');
        else if (argument === '--help') return { help: true, root, manifest, inspect };
        else throw new Error(`Unknown argument: ${argument}`);
    }
    return { help: false, root, manifest, inspect };
}

function runCli(argv = process.argv.slice(2)) {
    const options = parseCli(argv);
    if (options.help) {
        console.log('Usage: node tools/quality/check-new-experiment-preview.cjs (--manifest <manifest.json> [--root <repository>] | --inspect <preview.webp>)');
        return 0;
    }
    if (options.inspect) {
        if (options.manifest) throw new Error('--inspect and --manifest are mutually exclusive');
        if (!fs.existsSync(options.inspect)) throw new Error(`preview asset does not exist: ${options.inspect}`);
        const metadata = readWebPMetadata(options.inspect);
        console.log(JSON.stringify({
            width: metadata.width,
            height: metadata.height,
            bytes: metadata.bytes,
            sha256: metadata.sha256,
            animated: metadata.animated,
            frames: metadata.frameCount,
            duration_ms: metadata.durationMs
        }, null, 2));
        return 0;
    }
    if (!options.manifest) throw new Error('--manifest is required');
    if (!fs.existsSync(options.manifest)) throw new Error(`manifest does not exist: ${options.manifest}`);
    const manifest = JSON.parse(fs.readFileSync(options.manifest, 'utf8'));
    const result = validatePreviewAssets({ manifest, root: options.root });
    if (!result.ok) {
        result.errors.forEach((error) => console.error(`${error.code}: ${error.message}`));
        return 1;
    }
    console.log(
        `new-experiment-preview: ${manifest.subject}.${manifest.id} PASS; `
        + `${result.stats.posterWidth}x${result.stats.posterHeight}, ${result.stats.posterBytes} bytes, `
        + `${result.stats.motion ? 'motion + poster fallback' : 'still poster'}`
    );
    return 0;
}

module.exports = Object.freeze({
    loadContract,
    readWebPMetadata,
    resolveCandidateFile,
    validatePreviewAssets,
    runCli
});

if (require.main === module) {
    try {
        process.exitCode = runCli();
    } catch (error) {
        console.error(`new-experiment-preview: ${error.message}`);
        process.exitCode = 1;
    }
}
