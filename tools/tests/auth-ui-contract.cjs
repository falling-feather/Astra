const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const html = read('index.html');
const authUi = read('shared/js/auth-ui.js');
const authCss = read('shared/css/auth-ui.css');
const student = read('pages/student/student-workbench.js');
const teacher = read('pages/teacher/teacher.js');
const admin = read('pages/admin/admin.js');

assert.match(html, /shared\/css\/auth-ui\.css/);
assert.match(html, /shared\/js\/api-client\.js[\s\S]*shared\/js\/auth-ui\.js[\s\S]*shared\/js\/router\.js/);

for (const endpoint of [
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/password-reset/request',
    '/api/auth/password-reset/confirm',
    '/api/auth/logout',
    '/api/auth/sessions',
    '/api/users/me'
]) {
    assert.ok(authUi.includes(endpoint), 'auth UI must cover ' + endpoint);
}

assert.match(authUi, /student:\s*\{[^}]*registration:\s*true/);
assert.match(authUi, /teacher:\s*\{[^}]*registration:\s*true/);
assert.match(authUi, /admin:\s*\{[^}]*registration:\s*false/);
assert.match(authUi, /管理员不开放公开注册/);
assert.match(authUi, /HttpOnly Cookie/);
assert.match(authUi, /AstraApiClient\.isAmbiguousMutation/);
assert.match(authUi, /dispatchAuthRequired:\s*state\.view === 'account'/);
assert.equal((authUi.match(/reconcileSession\(state, \{ fromMutation: true,/g) || []).length, 2);
assert.doesNotMatch(authUi, /localStorage|sessionStorage|Authorization\s*:/);
assert.doesNotMatch(authUi, /\.access_token/);

for (const [name, source, role] of [
    ['student', student, 'student'],
    ['teacher', teacher, 'teacher'],
    ['admin', admin, 'admin']
]) {
    assert.match(source, /AstraAuthUI\.mountGate/);
    assert.match(source, /AstraAuthUI\.mountAccount/);
    assert.match(source, new RegExp("role:\\s*['\"]" + role + "['\"]"));
    assert.match(source, /onSignedOut:\s*\(\)\s*=>\s*refreshAll/);
    assert.match(source, /onAuthenticated:\s*\(\)\s*=>\s*refreshAll/);
    assert.match(source, /AstraAuthUI\.unmount/);
    assert.ok(source.includes('error.status === 401'), name + ' must expose login only for unauthenticated state');
}

assert.match(authCss, /@media \(max-width: 640px\)/);
assert.match(authCss, /:focus-visible/);
assert.match(authCss, /prefers-reduced-motion/);

console.log('auth-ui-contract: ok');
