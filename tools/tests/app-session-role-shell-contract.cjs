const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const html = read('index.html');
const session = read('shared/js/app-session.js');
const sessionCss = read('shared/css/app-session.css');
const main = read('shared/js/main.js');
const router = read('shared/js/router.js');
const admin = read('pages/admin/admin.js');
const serviceWorker = read('sw.js');

const PUBLIC_SHELL_VERSION = '20260731v7960AdminRegistryEntryP0';
const capture = (source, pattern, label) => {
    const match = source.match(pattern);
    assert.ok(match, `${label} must remain structurally inspectable`);
    return match[1];
};

assert.match(html, /shared\/css\/app-session\.css/);
assert.match(html, /api-client\.js[\s\S]*auth-ui\.js[\s\S]*app-session\.js[\s\S]*router\.js[\s\S]*main\.js/);
assert.match(html, /data-page="student" data-app-roles="student"/);
assert.match(html, /data-page="teacher" data-app-roles="teacher,admin"/);
assert.match(html, /data-page="admin" data-app-roles="admin"/);

for (const endpoint of [
    '/api/users/me', '/api/auth/login', '/api/auth/register',
    '/api/auth/password-reset/request', '/api/auth/password-reset/confirm', '/api/auth/logout'
]) {
    assert.ok(session.includes(endpoint), `application session must cover ${endpoint}`);
}

assert.match(session, /student:\s*new Set\(\['student'\]\)/);
assert.match(session, /teacher:\s*new Set\(\['teacher'\]\)/);
assert.match(session, /admin:\s*new Set\(\['teacher', 'admin'\]\)/);
assert.match(session, /ROLE_LANDING\s*=\s*Object\.freeze\(\{ student: 'planets', teacher: 'planets', admin: 'planets' \}\)/);
assert.match(session, /ROLE_WORKSPACE\s*=\s*Object\.freeze\(\{ student: 'student', teacher: 'teacher', admin: 'admin' \}\)/);
assert.match(session, /data-session-action="overview">返回星序总览/);
assert.match(session, /global\.Router\.navigateTo\(roleWorkspace\(state\.user && state\.user\.role\), true\)/);
assert.match(session, /roleWorkspace: roleWorkspace/);
assert.match(session, /PROTECTED_PAGES\.forEach/);
assert.match(session, /section\.hidden = !allowed/);
assert.match(session, /section\.inert = !allowed/);
assert.match(session, /HttpOnly Cookie/);
assert.doesNotMatch(session, /localStorage|sessionStorage|Authorization\s*:|\.access_token/);

assert.match(main, /await window\.AstraApplicationSession\.bootstrap\(\);\s*initApp\(\)/);
assert.match(main, /serviceWorker\.register\('\.\/sw\.js\?v=' \+ SHELL_RUNTIME_ASSET_VERSION\)/);
assert.match(main, /page-registry\.js\?v=' \+ PAGE_REGISTRY_ASSET_VERSION/);
assert.match(main, /main\.js\?v=' \+ SHELL_RUNTIME_ASSET_VERSION/);

const indexShellVersions = {
    pageRegistry: capture(html, /<script src="shared\/js\/page-registry\.js\?v=([^"]+)"><\/script>/, 'index page registry query'),
    router: capture(html, /<script src="shared\/js\/router\.js\?v=([^"]+)"><\/script>/, 'index router query'),
    main: capture(html, /<script src="shared\/js\/main\.js\?v=([^"]+)"><\/script>/, 'index main query')
};
const mainShellVersions = {
    pageRegistry: capture(main, /const PAGE_REGISTRY_ASSET_VERSION = '([^']+)'/, 'main page registry version'),
    runtime: capture(main, /const SHELL_RUNTIME_ASSET_VERSION = '([^']+)'/, 'main shell runtime version')
};
const appShell = capture(serviceWorker, /const APP_SHELL = \[([\s\S]*?)\n\];/, 'Service Worker APP_SHELL');
const serviceWorkerShellVersions = {
    cache: capture(serviceWorker, /const CACHE_NAME = 'astra-static-v([^']+)'/, 'Service Worker cache suffix'),
    pageRegistry: capture(appShell, /'\.\/shared\/js\/page-registry\.js\?v=([^']+)'/, 'Service Worker page registry query'),
    router: capture(appShell, /'\.\/shared\/js\/router\.js\?v=([^']+)'/, 'Service Worker router query'),
    main: capture(appShell, /'\.\/shared\/js\/main\.js\?v=([^']+)'/, 'Service Worker main query')
};
const shellVersions = [
    ...Object.values(indexShellVersions),
    ...Object.values(mainShellVersions),
    ...Object.values(serviceWorkerShellVersions)
];
assert.equal(shellVersions.length, 9);
assert.deepEqual(
    [...new Set(shellVersions)],
    [PUBLIC_SHELL_VERSION],
    'index, main and Service Worker must publish one atomic public shell generation'
);

assert.doesNotMatch(main, /\ninitApp\(\);\s*$/);
assert.match(router, /_guardParsedRoute\(this\._parseHash\(\)\)/);
assert.match(router, /AstraApplicationSession\.canAccessPage\(page\)/);
assert.match(router, /AstraApplicationSession\.guardPage\(page\)/);
assert.match(html, /data-planets-session-action="logout"/);
assert.match(html, /data-app-roles="student"[\s\S]*data-app-roles="teacher,admin"[\s\S]*data-app-roles="admin"/);

for (const endpoint of ['/api/admin/users', '/api/admin/schools', '/api/admin/classes', '/api/health']) {
    assert.ok(admin.includes(endpoint), `admin governance must expose ${endpoint}`);
}
assert.match(admin, /data-admin-database-map/);
assert.match(admin, /领域数据地图/);
assert.match(admin, /不开放任意 SQL/);
assert.match(admin, /\/api\/admin\/users\/\$\{userId\}/);
assert.match(admin, /state\.pendingUserUpdate/);
assert.match(admin, /再次点击同一保存按钮/);
assert.doesNotMatch(admin, /textarea[^>]+sql|execute\s+sql/i);

assert.match(sessionCss, /@media \(max-width: 860px\)/);
assert.match(sessionCss, /prefers-reduced-motion/);
assert.match(sessionCss, /app-auth-locked/);
assert.match(sessionCss, /\[data-app-roles\]\[hidden\][\s\S]*\.page\[hidden\][\s\S]*display:\s*none\s*!important/);
assert.match(sessionCss, /\.app-session-control__trigger\s*\{[^}]*min-height:\s*44px;/, 'the mobile identity trigger needs a 44px touch target');
assert.match(sessionCss, /\.app-session-control__menu button\s*\{[^}]*min-height:\s*44px;/, 'session menu actions need 44px touch targets');
assert.match(sessionCss, /\.nav-logo\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/, 'the compact galaxy logo needs a 44px touch target');
assert.match(sessionCss, /\.astra-workspace-mobile-header > div a\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/, 'the mobile Astra home link needs a 44px touch target');

console.log('app-session-role-shell-contract: ok');
