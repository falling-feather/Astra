const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { validateModelDocumentReference } = require('./check-new-experiment-model-document.cjs');
const { validatePreviewAssets } = require('./check-new-experiment-preview.cjs');

const DEFAULT_ROOT = path.resolve(__dirname, '../..');
const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const OWNER_PATTERN = /^[A-Z][A-Za-z0-9]*$/;

const stripQuery = (value) => String(value || '').split(/[?#]/, 1)[0];
const normalizeTitle = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN');
const canonicalKey = (subject, id) => `${subject}:${id}`;
const canonicalActivityKey = (subject, id) => `${subject}.${id}`;
const canonicalRoute = (subject, id) => `#${subject}/${id}`;

function readUtf8(file) {
    return fs.readFileSync(file, 'utf8');
}

function loadProductionBaseline(root = DEFAULT_ROOT) {
    const repositoryRoot = path.resolve(root);
    const configFile = path.join(repositoryRoot, 'shared/js/config.js');
    const registryFile = path.join(repositoryRoot, 'shared/js/experiment-registry.js');
    const context = { window: {} };
    vm.createContext(context);
    vm.runInContext(readUtf8(configFile), context, { filename: 'shared/js/config.js' });
    vm.runInContext(readUtf8(registryFile), context, { filename: 'shared/js/experiment-registry.js' });

    const configExperiments = vm.runInContext('CONFIG.experiments', context);
    const runtimeRegistry = context.window.AstraExperimentRegistry;
    if (!runtimeRegistry || typeof runtimeRegistry.entries !== 'function') {
        throw new Error('Production experiment registry is unavailable');
    }

    const catalogue = [];
    for (const [subject, entries] of Object.entries(configExperiments)) {
        for (const entry of entries) {
            catalogue.push(Object.freeze({
                subject,
                id: String(entry.id),
                title: String(entry.title || '')
            }));
        }
    }

    const runtimes = Array.from(runtimeRegistry.entries(), (entry) => Object.freeze({
        subject: String(entry.subject),
        id: String(entry.id),
        script: String(entry.script || ''),
        initHook: String(entry.init?.hook || ''),
        owners: Object.freeze(Array.from(entry.cleanup?.owners || [], String)),
        cleanupVerified: entry.cleanup?.verified === true
    }));
    const futureContext = { window: {} };
    vm.createContext(futureContext);
    vm.runInContext(
        readUtf8(path.join(repositoryRoot, 'pages/frontier/frontier-manifest.js')),
        futureContext,
        { filename: 'pages/frontier/frontier-manifest.js' }
    );
    const futureManifest = futureContext.window.FrontierCourseManifest;
    if (!futureManifest || !Array.isArray(futureManifest.courses)) {
        throw new Error('Future Galaxy production manifest is unavailable');
    }
    const futureCatalogue = futureManifest.courses.flatMap((course) => (
        Array.from(course.activities || [], (activity) => Object.freeze({
            subject: String(course.page || ''),
            id: String(activity.route_slug || ''),
            title: String(activity.title || ''),
            activityKey: String(activity.activity_key || ''),
            route: `#${String(course.page || '')}/${String(activity.route_slug || '')}`
        }))
    ));
    const catalogueKeys = new Set(catalogue.map((entry) => canonicalKey(entry.subject, entry.id)));
    const runtimeKeys = new Set(runtimes.map((entry) => canonicalKey(entry.subject, entry.id)));
    if (catalogueKeys.size !== runtimeKeys.size || [...catalogueKeys].some((key) => !runtimeKeys.has(key))) {
        throw new Error('Production catalogue and runtime registry identities are not a bijection');
    }

    const allCatalogue = catalogue.concat(futureCatalogue);
    return Object.freeze({
        count: catalogue.length,
        subjects: Object.freeze(new Set(catalogue.map((entry) => entry.subject))),
        candidateSubjects: Object.freeze(new Set(allCatalogue.map((entry) => entry.subject))),
        keys: Object.freeze(new Set(allCatalogue.map((entry) => canonicalKey(entry.subject, entry.id)))),
        activityKeys: Object.freeze(new Set(allCatalogue.map((entry) => (
            entry.activityKey || canonicalActivityKey(entry.subject, entry.id)
        )))),
        routes: Object.freeze(new Set(allCatalogue.map((entry) => entry.route || canonicalRoute(entry.subject, entry.id)))),
        titles: Object.freeze(new Set(allCatalogue.map((entry) => `${entry.subject}:${normalizeTitle(entry.title)}`))),
        owners: Object.freeze(new Set(runtimes.flatMap((entry) => entry.owners))),
        scripts: Object.freeze(new Set(runtimes.map((entry) => stripQuery(entry.script)))),
        catalogue: Object.freeze(catalogue),
        futureCatalogue: Object.freeze(futureCatalogue),
        runtimes: Object.freeze(runtimes)
    });
}

function resolveResource(root, value) {
    const relative = stripQuery(value).replaceAll('/', path.sep);
    const repositoryRoot = path.resolve(root);
    const absolute = path.resolve(repositoryRoot, relative);
    const prefix = repositoryRoot.endsWith(path.sep) ? repositoryRoot : `${repositoryRoot}${path.sep}`;
    if (!relative || path.isAbsolute(relative) || !absolute.startsWith(prefix)) {
        return { ok: false, relative, absolute, reason: 'outside-root' };
    }
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
        return { ok: false, relative, absolute, reason: 'missing' };
    }
    return { ok: true, relative: relative.replaceAll(path.sep, '/'), absolute };
}

function inspectRuntime(scriptFile, ownerName, initHook) {
    const source = readUtf8(scriptFile);
    try {
        new vm.Script(source, { filename: scriptFile });
    } catch (error) {
        return { error: 'runtime_syntax_invalid', detail: error.message };
    }

    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        document: {},
        AbortController,
        performance: { now: () => 0 },
        requestAnimationFrame: () => 1,
        cancelAnimationFrame() {},
        ResizeObserver: class {
            observe() {}
            disconnect() {}
        }
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    try {
        vm.runInContext(source, sandbox, { filename: scriptFile, timeout: 1000 });
    } catch (error) {
        return { error: 'runtime_load_failed', detail: error.message };
    }

    const owner = sandbox[ownerName];
    if (!owner || typeof owner !== 'object') {
        return { error: 'owner_export_missing', detail: `window.${ownerName} is not an object` };
    }
    if (typeof sandbox[initHook] !== 'function') {
        return { error: 'init_hook_missing', detail: `window.${initHook} is not a function` };
    }
    if (typeof owner.destroy !== 'function') {
        return { error: 'cleanup_method_missing', detail: `window.${ownerName}.destroy is not a function` };
    }
    try {
        owner.destroy();
    } catch (error) {
        return { error: 'cleanup_smoke_failed', detail: error.message };
    }
    return { owner, init: sandbox[initHook] };
}

function normalizeManifestRecord(item, index) {
    if (item && typeof item === 'object' && Object.hasOwn(item, 'data')) {
        return { source: String(item.source || `candidate-${index + 1}`), data: item.data };
    }
    return { source: `candidate-${index + 1}`, data: item };
}

function validateCandidateManifests({ manifests, root = DEFAULT_ROOT, baseline = loadProductionBaseline(root) }) {
    if (!Array.isArray(manifests)) throw new TypeError('manifests must be an array');
    const records = manifests.map(normalizeManifestRecord);
    const errors = [];
    const reserved = {
        keys: new Set(baseline.keys),
        activityKeys: new Set(baseline.activityKeys),
        routes: new Set(baseline.routes),
        titles: new Set(baseline.titles),
        owners: new Set(baseline.owners),
        scripts: new Set(baseline.scripts)
    };
    const addError = (source, code, message) => errors.push(Object.freeze({ source, code, message }));
    const reserve = (source, bucket, value, code, label) => {
        if (!value) return;
        if (reserved[bucket].has(value)) addError(source, code, `${label} already exists: ${value}`);
        else reserved[bucket].add(value);
    };

    for (const record of records) {
        const { source } = record;
        const manifest = record.data;
        if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
            addError(source, 'manifest_invalid', 'manifest must be a JSON object');
            continue;
        }
        if (/__[A-Z0-9_]+__/.test(JSON.stringify(manifest))) {
            addError(source, 'placeholder_unresolved', 'manifest still contains template placeholders');
        }
        if (manifest.schema_version !== 1) {
            addError(source, 'schema_version_invalid', 'schema_version must equal 1');
        }

        const subject = String(manifest.subject || '').trim();
        const id = String(manifest.id || '').trim();
        const title = String(manifest.title || '').trim();
        const owner = String(manifest.owner || '').trim();
        const namespace = String(manifest.namespace || '').trim();
        const initHook = String(manifest.init_hook || '').trim();
        const candidateSubjects = baseline.candidateSubjects || baseline.subjects;
        if (!ID_PATTERN.test(subject)) addError(source, 'subject_invalid', 'subject must use lowercase kebab-case');
        else if (!candidateSubjects.has(subject)) addError(source, 'subject_unknown', `subject is not a registered production subject: ${subject}`);
        if (!ID_PATTERN.test(id)) addError(source, 'id_invalid', 'id must use lowercase kebab-case');
        if (!title) addError(source, 'title_required', 'title is required');
        if (!OWNER_PATTERN.test(owner)) addError(source, 'owner_required', 'owner must be a non-empty PascalCase identifier');
        if (namespace !== `astra-exp--${id}`) {
            addError(source, 'namespace_invalid', `namespace must equal astra-exp--${id}`);
        }

        const key = ID_PATTERN.test(subject) && ID_PATTERN.test(id) ? canonicalKey(subject, id) : '';
        const activityKey = key ? canonicalActivityKey(subject, id) : '';
        const route = key ? canonicalRoute(subject, id) : '';
        reserve(source, 'keys', key, 'key_conflict', 'experiment key');
        reserve(source, 'activityKeys', String(manifest.activity_key || ''), 'activity_key_conflict', 'activity key');
        reserve(source, 'routes', String(manifest.route || ''), 'route_conflict', 'route');
        reserve(source, 'titles', title && subject ? `${subject}:${normalizeTitle(title)}` : '', 'title_conflict', 'subject title');
        reserve(source, 'owners', owner, 'owner_conflict', 'owner');

        if (manifest.activity_key !== activityKey) {
            addError(source, 'activity_key_invalid', `activity_key must equal ${activityKey || '<valid subject>.<valid id>'}`);
        }
        if (manifest.route !== route) {
            addError(source, 'route_invalid', `route must equal ${route || '#<subject>/<id>'}`);
        }
        if (initHook !== `init${owner}`) {
            addError(source, 'init_hook_invalid', `init_hook must equal init${owner || '<Owner>'}`);
        }
        if (manifest.registration_state !== 'candidate-unregistered') {
            addError(source, 'registration_state_invalid', 'registration_state must remain candidate-unregistered before production wiring');
        }

        const modelDocument = validateModelDocumentReference({ manifest, root });
        for (const error of modelDocument.errors) {
            addError(source, `model_${error.code}`, error.message);
        }
        const previewAssets = validatePreviewAssets({ manifest, root });
        for (const error of previewAssets.errors) {
            addError(source, `preview_${error.code}`, error.message);
        }

        const cleanup = manifest.cleanup;
        if (!cleanup || typeof cleanup !== 'object') {
            addError(source, 'cleanup_required', 'cleanup contract is required');
        } else {
            if (cleanup.owner !== owner) addError(source, 'cleanup_owner_invalid', 'cleanup.owner must equal owner');
            if (cleanup.method !== 'destroy') addError(source, 'cleanup_method_invalid', 'cleanup.method must equal destroy');
            if (cleanup.verified !== true) addError(source, 'cleanup_unverified', 'cleanup.verified must be true');
        }

        const expectedPrefix = key ? `pages/${subject}/${id}/` : '';
        const script = String(manifest.script || '');
        const style = String(manifest.style || '');
        const moduleMarkup = String(manifest.module || '');
        for (const [kind, value, extension] of [
            ['script', script, '.js'],
            ['style', style, '.css'],
            ['module', moduleMarkup, '.html']
        ]) {
            const bare = stripQuery(value);
            if (!value.includes('?v=') || value.endsWith('?v=')) {
                addError(source, 'asset_version_missing', `${kind} must include a non-empty ?v= resource version`);
            }
            if (expectedPrefix && !bare.startsWith(expectedPrefix)) {
                addError(source, 'resource_location_invalid', `${kind} must stay inside ${expectedPrefix}`);
            }
            if (!bare.endsWith(extension)) {
                addError(source, 'resource_extension_invalid', `${kind} must end with ${extension}`);
            }
            const resource = resolveResource(root, value);
            if (!resource.ok) {
                addError(
                    source,
                    resource.reason === 'outside-root' ? 'resource_outside_root' : 'resource_missing',
                    `${kind} resource is not a local file: ${bare || '<empty>'}`
                );
            } else if (kind === 'script') {
                reserve(source, 'scripts', resource.relative, 'script_conflict', 'script resource');
                if (OWNER_PATTERN.test(owner) && initHook) {
                    const runtime = inspectRuntime(resource.absolute, owner, initHook);
                    if (runtime.error) addError(source, runtime.error, runtime.detail);
                }
            }
        }
    }

    return Object.freeze({
        ok: errors.length === 0,
        checked: records.length,
        protectedExperiments: baseline.count,
        errors: Object.freeze(errors)
    });
}

function discoverCandidateManifests(root = DEFAULT_ROOT) {
    const pagesRoot = path.join(path.resolve(root), 'pages');
    if (!fs.existsSync(pagesRoot)) return [];
    const found = [];
    for (const subject of fs.readdirSync(pagesRoot, { withFileTypes: true })) {
        if (!subject.isDirectory()) continue;
        const subjectRoot = path.join(pagesRoot, subject.name);
        for (const experiment of fs.readdirSync(subjectRoot, { withFileTypes: true })) {
            if (!experiment.isDirectory()) continue;
            const manifest = path.join(subjectRoot, experiment.name, 'manifest.json');
            if (fs.existsSync(manifest)) found.push(manifest);
        }
    }
    return found.sort();
}

function parseCli(argv) {
    let root = DEFAULT_ROOT;
    const manifests = [];
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--root') root = path.resolve(argv[++index] || '');
        else if (arg === '--manifest') manifests.push(path.resolve(argv[++index] || ''));
        else if (arg === '--help') return { help: true, root, manifests };
        else throw new Error(`Unknown argument: ${arg}`);
    }
    return { help: false, root, manifests };
}

function runCli(argv = process.argv.slice(2)) {
    const options = parseCli(argv);
    if (options.help) {
        console.log('Usage: node tools/quality/check-new-experiment-registration.cjs [--manifest <manifest.json>] [--root <repository>]');
        return 0;
    }
    const manifestFiles = options.manifests.length ? options.manifests : discoverCandidateManifests(options.root);
    if (!manifestFiles.length) {
        console.log('new-experiment-registration: no candidate manifest found; protected baseline unchanged');
        return 0;
    }
    const manifests = manifestFiles.map((file) => ({ source: path.relative(options.root, file), data: JSON.parse(readUtf8(file)) }));
    const result = validateCandidateManifests({ manifests, root: options.root });
    if (!result.ok) {
        result.errors.forEach((error) => console.error(`${error.code}: ${error.source}: ${error.message}`));
        return 1;
    }
    console.log(
        `new-experiment-registration: ${result.checked} candidate(s) PASS against `
        + `${result.protectedExperiments} protected experiments; preview assets and model documents reviewed`
    );
    return 0;
}

module.exports = Object.freeze({
    loadProductionBaseline,
    validateCandidateManifests,
    discoverCandidateManifests,
    inspectRuntime,
    runCli
});

if (require.main === module) {
    try {
        process.exitCode = runCli();
    } catch (error) {
        console.error(`new-experiment-registration: ${error.message}`);
        process.exitCode = 1;
    }
}
