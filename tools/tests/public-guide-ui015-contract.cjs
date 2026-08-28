const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const guide = read('shared/js/public-guide.js');
const session = read('shared/js/app-session.js');
const css = read('shared/css/app-session.css');
const main = read('shared/js/main.js');
const serviceWorker = read('sw.js');

assert.match(
  html,
  /experiment-registry\.js\?v=20260824v832Show03P0[\s\S]*learning-activity-catalog\.js\?v=20260825v834Show04P0[\s\S]*public-guide\.js\?v=20260824v816ExperimentRestoreP2[\s\S]*app-session\.js\?v=20260828v863CourseHealthMatrixP0/,
  'the public guide must receive the verified catalog before session bootstrap',
);

assert.match(guide, /AstraLearningActivityCatalog/);
assert.match(guide, /catalog\.verify\(\)/);
assert.doesNotMatch(guide, /(?:88|18)\s*项活动/);
assert.match(guide, /item && item\.valid && Number\.isInteger\(item\.actual\)/);

for (const key of ['englab', 'code-space', 'future-galaxy']) {
  assert.ok(guide.includes(`key: '${key}'`), `missing real learning space: ${key}`);
}
assert.equal((guide.match(/key: '(?:englab|code-space|future-galaxy)'/g) || []).length, 3);

for (const copy of [
  '把抽象知识',
  '探索三大学习空间',
  '学生做什么，教师看什么，系统记录什么',
  '浏览器中的互动 ≠ 掌握',
  '三大学习空间，一条统一的教学主线',
  '两种代表性互动，快速看懂教学过程',
  '碰撞与反弹',
  '桁架载荷路径',
  '从真实身份进入你的星序',
  'HttpOnly Cookie',
]) {
  assert.ok(guide.includes(copy), `public guide is missing visible copy: ${copy}`);
}

for (const target of ['top', 'workflow', 'spaces', 'auth']) {
  assert.ok(guide.includes(`data-public-${target === 'top' ? 'section' : 'section'}="${target}"`) || guide.includes(`data-public-target="${target}"`));
}
assert.match(guide, /data-public-target="auth"/);
assert.doesNotMatch(guide, /重点课程|精品课程|普通课程/);
assert.doesNotMatch(guide, /AI 助教|智能诊断|已掌握|正式上线|生产可用/);
assert.doesNotMatch(guide, /public-hero[^\n]*kicker|public-hero[^\n]*eyebrow/i);

assert.match(session, /AstraPublicGuide\.render/);
assert.match(session, /AstraPublicGuide\.scrollTo/);
assert.match(session, /renderPortal\('auth'\)/);
assert.match(session, /HttpOnly Cookie/);
assert.doesNotMatch(session, /localStorage|sessionStorage|Authorization\s*:|\.access_token/);

for (const selector of [
  '.public-guide__header',
  '.public-hero',
  '.public-orbit',
  '.public-workflow__rail',
  '.public-spaces__rail',
  '.public-courses__layout',
  '.public-auth',
]) {
  assert.ok(css.includes(selector), `missing public guide layout selector: ${selector}`);
}
assert.match(css, /@media \(max-width: 860px\)[\s\S]*\.public-hero[\s\S]*grid-template-columns:\s*1fr/);
assert.match(css, /@media \(max-width: 860px\)[\s\S]*\.public-workflow__rail[\s\S]*grid-template-columns:\s*1fr/);
assert.match(css, /@media \(max-width: 860px\)[\s\S]*\.public-courses__layout[\s\S]*grid-template-columns:\s*1fr/);
assert.match(css, /prefers-reduced-motion[\s\S]*animation:\s*none\s*!important/);
assert.match(css, /prefers-reduced-motion[\s\S]*\.app-auth-overlay\s*,[\s\S]*scroll-behavior:\s*auto\s*!important/);
assert.match(css, /\.public-guide__login-link\s*\{[^}]*min-height:\s*44px/);

for (const asset of ['learning-activity-catalog.js', 'public-guide.js', 'app-session.js', 'app-session.css']) {
  assert.ok(main.includes(asset), `HTTP fallback is missing ${asset}`);
  assert.ok(serviceWorker.includes(asset), `service worker shell is missing ${asset}`);
}
assert.match(serviceWorker, /astra-static-v20260828v863CourseHealthMatrixP0/);

console.log('public-guide-ui015-contract: ok');
