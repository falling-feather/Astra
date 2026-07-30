const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const html = read('index.html');
const registrySource = read('shared/js/page-registry.js');
const session = read('shared/js/app-session.js');
const router = read('shared/js/router.js');
const main = read('shared/js/main.js');
const serviceWorker = read('sw.js');
const context = { window: {} };

vm.runInNewContext(registrySource, context, { filename: 'shared/js/page-registry.js' });
const registry = context.window.AstraPageRegistry;
const normalize = (items) => Array.from(items);
const studentVersion = '20260719v757StudentPublicationP0';
const teacherVersion = '20260730v785TeacherNaturalWorkflowP0';
const adminVersion = '20260729v794AdminGovernanceP0';
const student = [
    `pages/student/student.css?v=${studentVersion}`,
    `pages/student/student.js?v=${studentVersion}`
];
const teacher = [
    `pages/teacher/teacher-foundation.css?v=${teacherVersion}`,
    `pages/teacher/teacher-workbench.css?v=${teacherVersion}`,
    `pages/teacher/teacher-curriculum.css?v=${teacherVersion}`,
    `pages/teacher/teacher.js?v=${teacherVersion}`
];
const admin = [
    ...teacher,
    `pages/admin/admin.css?v=${adminVersion}`,
    `pages/admin/admin.js?v=${adminVersion}`
];

assert.deepEqual(normalize(registry.resourcesForRole('student')), student);
assert.deepEqual(normalize(registry.resourcesForRole('teacher')), teacher);
assert.deepEqual(normalize(registry.resourcesForRole('admin')), admin);
assert.deepEqual(normalize(registry.resourcesForRole('anonymous')), []);
assert.deepEqual(normalize(registry.stylesForRole('student')), student.slice(0, 1));
assert.deepEqual(normalize(registry.rolesFor('teacher')), ['teacher', 'admin']);
assert.equal(new Set(normalize(registry.allRoleResources())).size, 8);
for (const owner of ['admin-course-governance.js', 'admin-secondary-governance.js']) {
    assert.equal(
        normalize(registry.allRoleResources()).some((resource) => resource.includes(owner)),
        false,
        `${owner} must remain behind the post-/api/users/me admin authority gate`
    );
}

const roleAssetPattern = /pages\/(?:student|teacher|admin)\/[^?'"\s]+\.(?:css|js)/;
assert.doesNotMatch(html, /<link[^>]+href="pages\/(?:student|teacher|admin)\//);

const appShell = serviceWorker.match(/const APP_SHELL = \[([\s\S]*?)\n\];/);
assert.ok(appShell, 'service-worker APP_SHELL must remain inspectable');
assert.doesNotMatch(appShell[1], roleAssetPattern, 'APP_SHELL must not pre-cache any role resource');
assert.match(serviceWorker, /astra-static-v20260719v75ReviewTeacherLayersP0/);

const coreFallback = main.match(/const CORE_HTTP_FALLBACK_ASSETS = \[([\s\S]*?)\n\];/);
const galaxyFallback = main.match(/const GALAXY_HTTP_FALLBACK_ASSETS = \{([\s\S]*?)\n\};/);
assert.ok(coreFallback && galaxyFallback, 'HTTP fallback manifests must remain inspectable');
assert.doesNotMatch(coreFallback[1], roleAssetPattern);
assert.doesNotMatch(galaxyFallback[1], roleAssetPattern);
assert.doesNotMatch(main, /AstraPageRegistry\.resourcesForRole\(/, 'network-only role resources must not be prewarmed');
assert.match(
    main,
    /window\.warmGalaxyCache = function \(galaxy\)[\s\S]*cacheMode === 'service-worker'[\s\S]*cacheMode === 'service-worker-pending'[\s\S]*return;/,
    'HTTP fallback warming must not overwrite diagnostics or duplicate warming while Service Worker owns caching'
);
assert.match(
    html,
    /forcedServiceWorker[\s\S]*if \(!isLocalhost \|\| !\('serviceWorker' in navigator\) \|\| forcedServiceWorker\) return;[\s\S]*navigator\.serviceWorker\.getRegistrations\(\)/,
    'forced Service Worker mode must not be unregistered by the localhost fallback owner'
);
assert.match(
    main,
    /registerServiceWorker\(\);[\s\S]*await window\.AstraApplicationSession\.bootstrap\(\);[\s\S]*initApp\(\);/,
    'the public Service Worker shell must become ready while the authentication gate owns the page'
);
assert.match(
    main,
    /if \(forcedServiceWorker\) \{[\s\S]*doRegister\(\);[\s\S]*\} else if \(window\.requestIdleCallback\)/,
    'forced QA mode must register the Service Worker immediately instead of waiting for an idle callback'
);

assert.match(session, /await prepareRoleResources\(user\.role\)[\s\S]*state\.user =/);
assert.match(session, /document\.querySelectorAll\('link\[rel="stylesheet"\]'\)/);
assert.match(session, /rolePaths\.has\(linkUrl\.pathname\)/);
assert.match(session, /角色样式加载超时/);
assert.match(session, /const cacheNames = await global\.caches\.keys\(\);[\s\S]*Promise\.all\(cacheNames\.map\(async function \(name\)/);
assert.doesNotMatch(session, /cacheNames\.filter\(/, 'legacy/custom same-origin caches must also be scanned for exact role paths');
assert.match(session, /rolePaths\.has\(cachedUrl\.pathname\)/);
assert.match(session, /async function reloadAfterRoleResourceCleanup\(\)[\s\S]*state\.reloadPending = true;[\s\S]*await pruneRoleResourceCaches\(null\)[\s\S]*state\.user = null;[\s\S]*global\.location\.reload\(\)/);
assert.match(session, /if \(state\.appStarted\) \{[\s\S]*await reloadAfterRoleResourceCleanup\(\);[\s\S]*return true;[\s\S]*\}[\s\S]*await prepareRoleResources\(user\.role\)/);
assert.match(session, /function requireAuthentication\(\)[\s\S]*state\.appStarted = Boolean[\s\S]*if \(state\.appStarted\) \{[\s\S]*reloadAfterRoleResourceCleanup\(\);[\s\S]*return true;[\s\S]*\}[\s\S]*ensurePortal\(\)/);
assert.match(session, /function handleSignedOut\(\)[\s\S]*state\.explicitSignedOut = true;[\s\S]*reloadAfterRoleResourceCleanup\(\)/);
assert.doesNotMatch(session, /function handleSignedOut\(\)[\s\S]*requireAuthentication\(\)/);
assert.match(session, /request\('\/api\/users\/me'[\s\S]*\.catch\(async function \(error\)[\s\S]*await pruneRoleResourceCaches\(null\)[\s\S]*applyRoleUI\(\)[\s\S]*ensurePortal\(\)/);
assert.match(router, /if \(window\.AstraApplicationSession && !window\.AstraApplicationSession\.canAccessPage\(page\)\)[\s\S]*AstraPageRegistry\.scriptFor\(page\)/);
assert.match(serviceWorker, /isRoleResource[\s\S]*fetch\(request, \{ cache: 'no-store' \}\)/);

console.log('role-resource-pruning-contract: ok');
