const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DEFAULT_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_BASELINE = path.join(__dirname, 'baselines/protected-activities-v822.json');
const DEFAULT_EXCEPTIONS = path.join(__dirname, 'protected-activity-exceptions.json');
const GALAXY_ORDER = Object.freeze({ englab: 0, 'code-space': 1, 'future-galaxy': 2 });
const ENGLAB_STYLES = Object.freeze({
    mathematics: 'pages/mathematics/mathematics.css',
    physics: 'pages/physics/physics.css',
    chemistry: 'pages/chemistry/chemistry.css',
    algorithms: 'pages/algorithms/algorithms.css',
    biology: 'pages/biology/biology.css'
});
const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

const normalizeText = (value) => String(value || '').replace(/\r\n?/g, '\n');
const stripQuery = (value) => String(value || '').split(/[?#]/, 1)[0].replaceAll('\\', '/');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const hashTextFile = (file) => sha256(normalizeText(fs.readFileSync(file, 'utf8')));
const cloneJson = (value) => JSON.parse(JSON.stringify(value));
const activityIdentity = (entry) => `${entry.galaxy_key}:${entry.activity_key}`;
const resourceIdentity = (resource) => `${resource.kind}:${resource.path}:${resource.selector || ''}`;

function readSource(root, relative) {
    return fs.readFileSync(path.join(root, relative), 'utf8');
}

function evaluateEnglab(root) {
    const context = { window: {} };
    vm.createContext(context);
    vm.runInContext(readSource(root, 'shared/js/config.js'), context, { filename: 'shared/js/config.js' });
    vm.runInContext(readSource(root, 'shared/js/experiment-registry.js'), context, { filename: 'shared/js/experiment-registry.js' });
    return {
        config: vm.runInContext('CONFIG.experiments', context),
        registry: Array.from(context.window.AstraExperimentRegistry.entries())
    };
}

function evaluateCodeSpace(root) {
    const context = { window: {} };
    vm.createContext(context);
    vm.runInContext(readSource(root, 'codevis/shared/js/course-manifest.js'), context, {
        filename: 'codevis/shared/js/course-manifest.js'
    });
    return context.window.CvCourseManifest;
}

function evaluateFuture(root) {
    const context = { window: {} };
    vm.createContext(context);
    vm.runInContext(readSource(root, 'pages/frontier/frontier-manifest.js'), context, {
        filename: 'pages/frontier/frontier-manifest.js'
    });
    return context.window.FrontierCourseManifest;
}

function evaluateUnifiedCatalog(root) {
    const context = { window: {} };
    vm.createContext(context);
    for (const relative of [
        'shared/js/config.js',
        'shared/js/experiment-registry.js',
        'shared/js/learning-activity-catalog.js'
    ]) {
        vm.runInContext(readSource(root, relative), context, { filename: relative });
    }
    return context.window.AstraLearningActivityCatalog;
}

function findModuleFragments(html, moduleId) {
    const escaped = moduleId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const opening = new RegExp(`<([a-z][a-z0-9:-]*)\\b[^>]*\\bdata-module=["']${escaped}["'][^>]*>`, 'gi');
    const fragments = [];
    let match;
    while ((match = opening.exec(html))) {
        const rootTag = match[1].toLowerCase();
        const tagPattern = /<!--[\s\S]*?-->|<\/?([a-z][a-z0-9:-]*)\b[^>]*>/gi;
        tagPattern.lastIndex = opening.lastIndex;
        let depth = 1;
        let token;
        let end = opening.lastIndex;
        while ((token = tagPattern.exec(html))) {
            if (!token[1] || token[1].toLowerCase() !== rootTag) continue;
            const raw = token[0];
            const closing = /^<\//.test(raw);
            const selfClosing = /\/>$/.test(raw) || VOID_ELEMENTS.has(rootTag);
            if (closing) depth -= 1;
            else if (!selfClosing) depth += 1;
            if (depth === 0) {
                end = tagPattern.lastIndex;
                break;
            }
        }
        if (depth !== 0) throw new Error(`Unbalanced data-module fragment: ${moduleId}`);
        fragments.push(normalizeText(html.slice(match.index, end)));
        opening.lastIndex = end;
    }
    return fragments;
}

function fileResource(root, relative, kind, selector = '') {
    const clean = stripQuery(relative);
    const file = path.join(root, clean);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        throw new Error(`Protected resource is missing: ${clean}`);
    }
    return Object.freeze({ path: clean, kind, selector, sha256: hashTextFile(file) });
}

function virtualResource(relative, kind, selector, content) {
    return Object.freeze({ path: relative, kind, selector, sha256: sha256(normalizeText(content)) });
}

function uniqueResources(resources) {
    const byIdentity = new Map(resources.map((resource) => [resourceIdentity(resource), resource]));
    return Object.freeze([...byIdentity.values()].sort((left, right) => resourceIdentity(left).localeCompare(resourceIdentity(right))));
}

function parseFutureOwners(source) {
    const owners = new Map();
    const pattern = /'([^']+)':\s*\{\s*script:\s*'([^']+)',\s*init:\s*'([^']+)',\s*destroy:\s*'([^']+)'\s*\}/g;
    let match;
    while ((match = pattern.exec(source))) {
        owners.set(match[1], Object.freeze({ script: match[2], init: match[3], destroy: match[4] }));
    }
    if (owners.size !== 6) throw new Error(`Expected six Future owner configurations, found ${owners.size}`);
    return owners;
}

function buildEnglabActivities(root) {
    const { config, registry } = evaluateEnglab(root);
    const runtimeByKey = new Map(registry.map((entry) => [`${entry.subject}:${entry.id}`, entry]));
    const html = readSource(root, 'index.html');
    const activities = [];
    for (const [subject, entries] of Object.entries(config)) {
        for (const entry of entries) {
            const runtime = runtimeByKey.get(`${subject}:${entry.id}`);
            if (!runtime) throw new Error(`Missing runtime for ${subject}.${entry.id}`);
            const fragments = findModuleFragments(html, entry.id);
            if (!fragments.length) throw new Error(`Missing data-module markup for ${subject}.${entry.id}`);
            const script = stripQuery(runtime.script);
            const style = ENGLAB_STYLES[subject];
            activities.push(Object.freeze({
                galaxy_key: 'englab',
                course_key: subject,
                activity_key: `${subject}.${entry.id}`,
                route: `#${subject}/${entry.id}`,
                title: String(entry.title || ''),
                owners: Object.freeze(Array.from(runtime.cleanup?.owners || [], String).sort()),
                init_hooks: Object.freeze([String(runtime.init?.hook || '')]),
                cleanup_hooks: Object.freeze(Array.from(runtime.cleanup?.owners || [], String).sort()),
                presentation: Object.freeze({
                    description: String(entry.description || ''),
                    icon: String(entry.icon || ''),
                    variant: String(entry.variant || ''),
                    anchor: String(entry.anchor || '')
                }),
                sources: Object.freeze([
                    `shared/js/config.js#${subject}.${entry.id}`,
                    `shared/js/experiment-registry.js#${subject}.${entry.id}`
                ]),
                resources: uniqueResources([
                    fileResource(root, script, 'runtime-script'),
                    fileResource(root, style, 'page-style'),
                    virtualResource('index.html', 'module-markup', `[data-module="${entry.id}"]`, fragments.join('\n<!-- ASTRA MODULE FRAGMENT -->\n'))
                ])
            }));
        }
    }
    return activities;
}

function buildCodeSpaceActivities(root) {
    const manifest = evaluateCodeSpace(root);
    const commonResources = uniqueResources([
        fileResource(root, 'codevis/shared/js/course-manifest.js', 'activity-manifest'),
        fileResource(root, 'codevis/pages/course-catalog/course-catalog.js', 'catalog-owner'),
        fileResource(root, 'codevis/pages/course-catalog/course-space.css', 'page-style'),
        fileResource(root, 'codevis/pages/course-challenge/course-challenge.js', 'challenge-owner')
    ]);
    return manifest.courses.flatMap((course) => course.activities.map((activity) => Object.freeze({
        galaxy_key: 'code-space',
        course_key: String(course.course_key),
        activity_key: String(activity.activity_key),
        route: `codevis/#challenge?activity=${encodeURIComponent(activity.activity_key)}`,
        title: String(activity.title || ''),
        owners: Object.freeze(['CvCourseManifest', 'CvCourseCatalog', 'CvCourseChallenge']),
        init_hooks: Object.freeze(['CvCourseCatalog.init', 'CvCourseChallenge.init']),
        cleanup_hooks: Object.freeze(['CvCourseCatalog.destroy', 'CvCourseChallenge.destroy']),
        presentation: Object.freeze({
            goal: String(activity.goal || ''),
            language: String(activity.language || ''),
            featured: activity.featured === true
        }),
        sources: Object.freeze([`codevis/shared/js/course-manifest.js#${activity.activity_key}`]),
        resources: commonResources
    })));
}

function buildFutureActivities(root) {
    const manifest = evaluateFuture(root);
    const ownerSource = readSource(root, 'shared/js/frontier-learning.js');
    const ownerConfigs = parseFutureOwners(ownerSource);
    return manifest.courses.flatMap((course) => {
        const owner = ownerConfigs.get(course.course_key);
        if (!owner) throw new Error(`Missing Future owner config: ${course.course_key}`);
        const style = course.page === 'engineering'
            ? 'pages/engineering/engineering.css'
            : 'pages/frontier/frontier.css';
        const commonResources = uniqueResources([
            fileResource(root, 'pages/frontier/frontier-manifest.js', 'activity-manifest'),
            fileResource(root, 'shared/js/frontier-learning.js', 'course-owner'),
            fileResource(root, owner.script, 'runtime-script'),
            fileResource(root, style, 'page-style')
        ]);
        return course.activities.map((activity) => Object.freeze({
            galaxy_key: 'future-galaxy',
            course_key: String(course.course_key),
            activity_key: String(activity.activity_key),
            route: `#${course.page}/${activity.route_slug}`,
            title: String(activity.title || ''),
            owners: Object.freeze([owner.init]),
            init_hooks: Object.freeze([owner.init]),
            cleanup_hooks: Object.freeze([owner.destroy]),
            presentation: Object.freeze({
                kind: String(activity.kind || ''),
                input: String(activity.input || ''),
                input_control: String(activity.input_control || '')
            }),
            sources: Object.freeze([`pages/frontier/frontier-manifest.js#${activity.activity_key}`]),
            resources: commonResources
        }));
    });
}

function buildCurrentProjection(root = DEFAULT_ROOT) {
    const repositoryRoot = path.resolve(root);
    const activities = [
        ...buildEnglabActivities(repositoryRoot),
        ...buildCodeSpaceActivities(repositoryRoot),
        ...buildFutureActivities(repositoryRoot)
    ].sort((left, right) => (
        GALAXY_ORDER[left.galaxy_key] - GALAXY_ORDER[right.galaxy_key]
        || left.activity_key.localeCompare(right.activity_key)
    ));
    const identities = new Set(activities.map(activityIdentity));
    if (activities.length < 124 || identities.size !== activities.length) {
        throw new Error(`Current projection must contain at least 124 unique activities, found ${activities.length}/${identities.size}`);
    }

    const unified = evaluateUnifiedCatalog(repositoryRoot);
    const unifiedIdentities = new Set(unified.entries().map((entry) => `${entry.galaxy_key}:${entry.activity_key}`));
    if (unifiedIdentities.size !== identities.size || [...identities].some((identity) => !unifiedIdentities.has(identity))) {
        throw new Error('Protected projection and unified activity catalog are not a bijection');
    }
    return Object.freeze(activities);
}

function createBaseline(activities, sourceRevision) {
    const counts = activities.reduce((result, activity) => {
        result[activity.galaxy_key] = (result[activity.galaxy_key] || 0) + 1;
        return result;
    }, {});
    return Object.freeze({
        schema_version: 1,
        baseline_id: 'V8.2.2-EXT-03',
        source_revision: String(sourceRevision || ''),
        purpose: 'Read-only projection of the 124 pre-existing activities; additions are allowed, protected changes require an exact approved exception.',
        counts: Object.freeze({
            total: activities.length,
            englab: counts.englab || 0,
            'code-space': counts['code-space'] || 0,
            'future-galaxy': counts['future-galaxy'] || 0
        }),
        generated_sources: Object.freeze([
            'shared/js/config.js',
            'shared/js/experiment-registry.js',
            'shared/js/learning-activity-catalog.js',
            'codevis/shared/js/course-manifest.js',
            'pages/frontier/frontier-manifest.js',
            'shared/js/frontier-learning.js',
            'index.html'
        ]),
        activities: Object.freeze(activities.map((activity) => cloneJson(activity)))
    });
}

function issueRecord(code, activity, file, before, after, detail) {
    const core = {
        code,
        galaxy_key: activity?.galaxy_key || '',
        activity_key: activity?.activity_key || '',
        file: file || '',
        before: before == null ? '' : String(before),
        after: after == null ? '' : String(after),
        detail: detail || ''
    };
    return Object.freeze({ ...core, signature: sha256(JSON.stringify(core)) });
}

function metadataProjection(activity) {
    return {
        galaxy_key: activity.galaxy_key,
        course_key: activity.course_key,
        activity_key: activity.activity_key,
        route: activity.route,
        title: activity.title,
        owners: activity.owners,
        init_hooks: activity.init_hooks,
        cleanup_hooks: activity.cleanup_hooks,
        presentation: activity.presentation,
        sources: activity.sources
    };
}

function validException(exception) {
    return exception
        && typeof exception.signature === 'string'
        && exception.signature.length === 64
        && typeof exception.task_id === 'string'
        && exception.task_id.length > 0
        && typeof exception.approved_by === 'string'
        && exception.approved_by.length > 0
        && /^\d{4}-\d{2}-\d{2}$/.test(exception.approved_on || '')
        && typeof exception.reason === 'string'
        && exception.reason.length > 0
        && exception.one_time === true;
}

function compareWithBaseline(currentActivities, baseline, exceptionDocument = { schema_version: 1, exceptions: [] }) {
    if (!baseline || baseline.schema_version !== 1 || !Array.isArray(baseline.activities)) {
        throw new Error('Invalid protected activity baseline');
    }
    if (!exceptionDocument || exceptionDocument.schema_version !== 1 || !Array.isArray(exceptionDocument.exceptions)) {
        throw new Error('Invalid protected activity exception document');
    }
    const invalidExceptions = exceptionDocument.exceptions.filter((exception) => !validException(exception));
    if (invalidExceptions.length) throw new Error(`Invalid protected activity exception: ${invalidExceptions.length}`);
    if (new Set(exceptionDocument.exceptions.map((exception) => exception.signature)).size !== exceptionDocument.exceptions.length) {
        throw new Error('Duplicate protected activity exception signature');
    }

    const currentByIdentity = new Map(currentActivities.map((activity) => [activityIdentity(activity), activity]));
    const baselineByIdentity = new Map(baseline.activities.map((activity) => [activityIdentity(activity), activity]));
    const issues = [];
    for (const [identity, protectedActivity] of baselineByIdentity) {
        const current = currentByIdentity.get(identity);
        if (!current) {
            issues.push(issueRecord('protected_activity_missing', protectedActivity, protectedActivity.sources?.[0], identity, '', 'protected activity no longer exists'));
            continue;
        }
        const beforeMetadata = JSON.stringify(metadataProjection(protectedActivity));
        const afterMetadata = JSON.stringify(metadataProjection(current));
        if (beforeMetadata !== afterMetadata) {
            issues.push(issueRecord('protected_metadata_changed', current, current.sources?.[0], sha256(beforeMetadata), sha256(afterMetadata), 'identity, route, title, owner or presentation changed'));
        }

        const beforeResources = new Map((protectedActivity.resources || []).map((resource) => [resourceIdentity(resource), resource]));
        const afterResources = new Map((current.resources || []).map((resource) => [resourceIdentity(resource), resource]));
        for (const [resourceKey, before] of beforeResources) {
            const after = afterResources.get(resourceKey);
            if (!after) {
                issues.push(issueRecord('protected_resource_missing', current, before.path, before.sha256, '', before.selector || before.kind));
            } else if (before.sha256 !== after.sha256) {
                issues.push(issueRecord('protected_resource_changed', current, before.path, before.sha256, after.sha256, before.selector || before.kind));
            }
        }
        for (const [resourceKey, after] of afterResources) {
            if (!beforeResources.has(resourceKey)) {
                issues.push(issueRecord('protected_resource_added', current, after.path, '', after.sha256, after.selector || after.kind));
            }
        }
    }

    const exceptionsBySignature = new Map(exceptionDocument.exceptions.map((exception) => [exception.signature, exception]));
    const approved = [];
    const blocking = [];
    for (const issue of issues) {
        const exception = exceptionsBySignature.get(issue.signature);
        if (exception) approved.push(Object.freeze({ issue, exception: Object.freeze({ ...exception }) }));
        else blocking.push(issue);
    }
    const additions = [...currentByIdentity.keys()].filter((identity) => !baselineByIdentity.has(identity)).sort();
    return Object.freeze({
        ok: blocking.length === 0,
        protectedCount: baseline.activities.length,
        currentCount: currentActivities.length,
        additions: Object.freeze(additions),
        issues: Object.freeze(blocking),
        approved: Object.freeze(approved)
    });
}

function parseCli(argv) {
    const options = {
        root: DEFAULT_ROOT,
        baseline: DEFAULT_BASELINE,
        exceptions: DEFAULT_EXCEPTIONS,
        writeBaseline: '',
        revision: '',
        help: false
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const next = () => {
            const value = argv[++index];
            if (!value) throw new Error(`Missing value for ${arg}`);
            return value;
        };
        if (arg === '--root') options.root = path.resolve(next());
        else if (arg === '--baseline') options.baseline = path.resolve(next());
        else if (arg === '--exceptions') options.exceptions = path.resolve(next());
        else if (arg === '--write-baseline') options.writeBaseline = path.resolve(next());
        else if (arg === '--revision') options.revision = next();
        else if (arg === '--help') options.help = true;
        else throw new Error(`Unknown argument: ${arg}`);
    }
    return options;
}

function runCli(argv = process.argv.slice(2)) {
    const options = parseCli(argv);
    if (options.help) {
        console.log('Usage: node tools/quality/check-protected-activity-changes.cjs [--baseline <json>] [--exceptions <json>] [--write-baseline <json> --revision <sha>]');
        return 0;
    }
    const current = buildCurrentProjection(options.root);
    if (options.writeBaseline) {
        if (!options.revision) throw new Error('--revision is required with --write-baseline');
        if (current.length !== 124) throw new Error(`initial protected baseline must contain exactly 124 activities, found ${current.length}`);
        const baseline = createBaseline(current, options.revision);
        fs.mkdirSync(path.dirname(options.writeBaseline), { recursive: true });
        fs.writeFileSync(options.writeBaseline, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
        console.log(`protected-activity-baseline: wrote ${baseline.counts.total} activities to ${options.writeBaseline}`);
        return 0;
    }
    const baseline = JSON.parse(fs.readFileSync(options.baseline, 'utf8'));
    const exceptions = JSON.parse(fs.readFileSync(options.exceptions, 'utf8'));
    const result = compareWithBaseline(current, baseline, exceptions);
    result.approved.forEach(({ issue, exception }) => {
        console.warn(`approved ${issue.code}: ${issue.galaxy_key}/${issue.activity_key}: ${issue.file} (${exception.task_id})`);
    });
    if (!result.ok) {
        result.issues.forEach((issue) => {
            console.error(`${issue.code}: ${issue.galaxy_key}/${issue.activity_key}: ${issue.file}: ${issue.detail}`);
        });
        return 1;
    }
    console.log(`protected-activity-change-alert: ${result.protectedCount} protected activities PASS; ${result.additions.length} unprotected addition(s) ignored`);
    return 0;
}

module.exports = Object.freeze({
    buildCurrentProjection,
    createBaseline,
    compareWithBaseline,
    findModuleFragments,
    issueRecord,
    runCli
});

if (require.main === module) {
    try {
        process.exitCode = runCli();
    } catch (error) {
        console.error(`protected-activity-change-alert: ${error.message}`);
        process.exitCode = 1;
    }
}
