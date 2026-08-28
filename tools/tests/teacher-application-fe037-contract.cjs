'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n?/g, '\n');

const html = read('index.html');
const session = read('shared/js/app-session.js');
const loader = read('shared/js/learning-evidence-loader.js');
const planets = read('pages/planets/planets.js');
const admin = read('pages/admin/admin.js');
const governance = read('pages/admin/admin-secondary-governance.js');
const authStyles = read('shared/css/auth-ui.css');
const adminStyles = read('pages/admin/admin.css');
const registry = read('shared/js/page-registry.js');
const main = read('shared/js/main.js');
const serviceWorker = read('sw.js');
const guard = read('backend/app/api/deps/auth.py');
const endpoint = read('backend/app/api/endpoints/teacher_applications.py');

assert.match(session, /name="account_intent"[\s\S]*value="student"[\s\S]*value="teacher"/);
assert.match(session, /submitRegister[\s\S]*wantsTeacherApplication[\s\S]*role:\s*'student'[\s\S]*request\('\/api\/v1\/teacher-applications'/);
assert.doesNotMatch(session, /submitRegister[\s\S]{0,900}role:\s*formValue\(form,\s*'role'\)/);
assert.match(session, /hydrateTeacherApplication[\s\S]*'\/api\/v1\/teacher-applications\/me'/);
assert.match(session, /isPendingTeacherApplicant[\s\S]*application\.status === 'pending'/);
assert.match(session, /target === 'student' && isPendingTeacherApplicant\(state\.user\)[\s\S]*return false/);
assert.match(session, /learning_evidence_disabled:\s*pendingApplicant/);
assert.match(session, /openTeacherApplicationDialog[\s\S]*refreshTeacherApplicationIdentity/);

assert.match(loader, /isTeacherApplicantPending[\s\S]*return null/);
assert.match(loader, /detail\.learning_evidence_disabled === true[\s\S]*clearAuthority\('teacher-application-pending'\)/);

assert.match(planets, /'teacher-applicant'[\s\S]*READ-ONLY PREVIEW/);
assert.match(planets, /isPendingTeacherApplicant\(currentUser\)[\s\S]*allCatalogueRecords\(\)/);
assert.match(planets, /isPendingTeacherApplicant\(user\)[\s\S]*AstraRoleHomeClient\.destroy/);

assert.match(admin, /data-admin-secondary-open="identity"[\s\S]*教师身份审核/);
assert.match(governance, /identity:[\s\S]*'\/api\/v1\/admin\/teacher-applications'[\s\S]*status:\s*'pending'/);
assert.match(governance, /pendingTeacherReview[\s\S]*再次点击“批准”[\s\S]*再次点击“拒绝”/);
assert.match(governance, /request\(`\/api\/v1\/admin\/teacher-applications\/\$\{applicationId\}`[\s\S]*method:\s*'PATCH'[\s\S]*status:\s*decision/);
assert.match(governance, /loadGroup\('identity',\s*true\)[\s\S]*loadOverview\(\{ force:\s*true \}\)/);

assert.match(authStyles, /\.teacher-application-banner\s*\{/);
assert.match(authStyles, /\.teacher-application-dialog\s*\{/);
assert.match(authStyles, /@media \(max-width:\s*640px\)[\s\S]*\.teacher-application-banner/);
assert.match(adminStyles, /\.admin-teacher-application-card\s*\{/);
assert.match(adminStyles, /\.admin-teacher-application-card__actions/);

assert.match(endpoint, /@router\.post\([\s\S]*"\/teacher-applications"/);
assert.match(endpoint, /@router\.get\("\/teacher-applications\/me"/);
assert.match(endpoint, /@router\.get\("\/admin\/teacher-applications"/);
assert.match(endpoint, /@router\.patch\("\/admin\/teacher-applications\/\{application_id\}"/);
assert.match(guard, /has_pending_teacher_application/);
assert.match(guard, /request\.method in \{"GET", "HEAD", "OPTIONS"\}/);

const generation = '20260828v861PresentationCleanupP3';
for (const source of [html, registry, main, serviceWorker]) {
  assert.match(source, new RegExp(generation), 'FE-037 assets must expose the same cache generation');
}
assert.match(admin, /ADMIN_ASSET_VERSION = '20260828v861PresentationCleanupP3'/);
assert.match(registry, /ADMIN_RESOURCE_VERSION = '20260828v861PresentationCleanupP3'/);
assert.match(html, new RegExp(`auth-ui\\.css\\?v=${generation}`));
assert.match(html, new RegExp(`app-session\\.js\\?v=${generation}`));
assert.match(html, new RegExp(`planets\\.js\\?v=${generation}`));
assert.match(serviceWorker, new RegExp(`astra-static-v${generation}`));

console.log('teacher-application-fe037-contract: ok');
