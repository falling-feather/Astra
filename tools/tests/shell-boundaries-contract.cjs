const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SHELL_ENTRY_PATHS, shellBoundaryViolations } = require('../quality/shell-boundaries.cjs');

for (const relativePath of SHELL_ENTRY_PATHS) {
  const source = fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');
  assert.deepEqual(shellBoundaryViolations(relativePath, source), [],
    `${relativePath} must remain a boot/routing composition entry`);
  const inline = (code) => relativePath === 'index.html' ? `<script>${code}</script>` : code;
  for (const code of [
    "fetch('/api/ai-tutor/chat', { method: 'POST' });",
    'AstraApiClient.request(endpoint, payload);',
    'new XMLHttpRequest();',
  ]) {
    assert.ok(shellBoundaryViolations(relativePath, inline(code)).includes('business-network-authority'),
      `${relativePath} must reject business requests moved into the shell: ${code}`);
  }
  for (const code of [
    'window.AstraAiTutor = {};',
    "globalThis['AstraAiTutor'] = {};",
    "Object.defineProperty(window, 'AstraAiTutor', { value: {} });",
    'Object.assign(window, { AstraAiTutor: {} });',
    'Object . assign(window, { AstraAiTutor: {} });',
  ]) {
    assert.ok(shellBoundaryViolations(relativePath, inline(code)).includes('feature-global-owner'),
      `${relativePath} must reject feature ownership moved into the shell: ${code}`);
  }
  for (const code of ['window["fetch"](endpoint)', 'fetch.call(window, endpoint)']) {
    assert.ok(shellBoundaryViolations(relativePath, inline(code)).includes('network-outside-cache-warmer'),
      `${relativePath} must reject ordinary alternate fetch calls: ${code}`);
  }
  assert.deepEqual(shellBoundaryViolations(relativePath, inline(
    '// window.AstraAiTutor = {}; fetch(endpoint);\nconst description = "fetch(endpoint); Object.assign(window, {})";')), [],
  'comments and display strings must not be mistaken for runtime authority');
}
assert.deepEqual(shellBoundaryViolations('index.html',
  '<link rel="stylesheet" href="shared/css/ai-tutor.css?v=next"><script src="shared/js/router.js?v=next"></script>'), [],
  'adding a stylesheet or versioned module reference must remain an allowed composition change');
assert.ok(shellBoundaryViolations('shared/js/main.js', 'fetch(assetUrl);').includes('network-outside-cache-warmer'),
  'new bootstrap networking must not silently bypass the cache warmer boundary');
assert.ok(shellBoundaryViolations('index.html', '<button onclick="fetch(endpoint)">Send</button>')
  .includes('network-outside-cache-warmer'), 'inline event handlers must not become a second transport owner');
assert.ok(shellBoundaryViolations('index.html', '<button onclick=fetch(endpoint)>Send</button>')
  .includes('network-outside-cache-warmer'), 'unquoted event attributes must obey the same inline boundary');
console.log('shell-boundaries-contract: ok');
