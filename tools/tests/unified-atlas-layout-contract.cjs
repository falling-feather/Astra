const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const html = read('index.html');
const planets = read('pages/planets/planets.js');
const planetsCss = read('pages/planets/planets.css');
const admin = read('pages/admin/admin.js');
const adminCourse = read('pages/admin/admin-course-governance.js');
const adminSecondary = read('pages/admin/admin-secondary-governance.js');
const adminCss = read('pages/admin/admin.css');
const registry = read('shared/js/page-registry.js');
const main = read('shared/js/main.js');
const serviceWorker = read('sw.js');

for (const galaxy of ['englab', 'codespace', 'frontier']) {
    assert.match(html, new RegExp(`details class="planets-galaxy-row[^"]*" data-galaxy="${galaxy}" open`));
}
assert.match(html, /三个星系，一处抵达/);
assert.match(html, /data-app-roles="student"[\s\S]*data-app-roles="teacher,admin"[\s\S]*data-app-roles="admin"/);
assert.match(html, /我的轨道[\s\S]*data-planets-route-copy/);
assert.doesNotMatch(html, /planets-starfield|planets-cursor-halo|planets-recommendation/);
assert.match(planets, /ROLE_VIEW[\s\S]*student[\s\S]*teacher[\s\S]*admin/);
assert.match(planets, /AstraApplicationSession[\s\S]*getUser/);
assert.match(planets, /data-planets-session-action[\s\S]*session\.logout\(\)/);
assert.match(planets, /window|global\.initPlanets/);
assert.match(planetsCss, /--atlas-bg:\s*#060a12/);
assert.match(planetsCss, /grid-template-columns:\s*204px minmax\(0, 1fr\)/);
assert.match(planetsCss, /@media \(max-width: 800px\)[\s\S]*\.planets-mobile-dock/);
assert.match(planetsCss, /@media \(max-width: 520px\)/);
assert.match(planetsCss, /@media \(max-width: 520px\)[\s\S]*\.planets-resource-links a\s*\{[\s\S]*min-height:\s*44px/);

for (const section of ['overview', 'organizations', 'identity', 'classes', 'courses', 'audit']) {
    assert.match(admin, new RegExp(`id: '${section}'`));
}
for (const panel of ['users', 'schools', 'classes', 'join-requests', 'audit-logs']) {
    assert.match(admin, new RegExp(`(?:^|\\s|')${panel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
}
for (const panel of ['content-drafts', 'script-assets', 'script-hosts', 'snapshot-runs', 'outbox', 'bugs']) {
    assert.match(adminSecondary, new RegExp(panel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}
assert.match(adminCourse, /course\.status\.patch/);
assert.match(admin, /全部星系[\s\S]*工科试验室[\s\S]*代码空间[\s\S]*未来星系/);
assert.match(admin, /data-admin-section-button/);
assert.match(admin, /function applyActiveSection/);
assert.match(admin, /setActiveSection\(panelId === 'classes' \? 'classes' : 'organizations'\)/);
assert.match(admin, /data-admin-secondary-open="more"[\s\S]*data-admin-secondary-open="advanced"/);
assert.match(adminCss, /V7\.4\.32 · 星序全局治理台/);
assert.match(adminCss, /\.admin-governance-layout\s*\{[\s\S]*grid-template-columns:\s*244px minmax\(0, 1fr\)/);
assert.match(adminCss, /\.admin-organization-dialog\s*\{[\s\S]*inset:\s*72px 0 0 auto/);
assert.match(adminCss, /V7\.4\.32 · 星序全局治理台[\s\S]*\.admin-icon-button\s*\{[\s\S]*min-height:\s*44px/);
assert.match(adminCss, /\.admin-panel__filters input,[\s\S]*\.admin-api-base input\s*\{[\s\S]*min-height:\s*44px/);
assert.doesNotMatch(admin, /textarea[^>]+sql|execute\s+sql/i);

for (const source of [html, planets, registry, main, serviceWorker]) {
    assert.match(source, /20260719v7437AstraWorkspaceP0/);
}
assert.match(registry, /20260731v7958AdminTouchTargetP0/, 'admin keeps its independently reviewed resource version');

console.log('unified-atlas-layout-contract: ok');
