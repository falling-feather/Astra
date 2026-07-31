const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(baseUrl) {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/index.html`, { cache: 'no-store' });
      if (response.status === 200) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError || new Error('static server did not become ready');
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const cppSource = fs.readFileSync(path.join(repoRoot, 'server', 'main.cpp'), 'utf8');
  assert.doesNotMatch(cppSource, /set_mount_point\(\s*["']\/["']\s*,/, 'C++ server must not mount the repository root');
  assert.doesNotMatch(cppSource, /Access-Control-Allow-Origin["']\s*,\s*["']\*/, 'C++ server must not emit wildcard CORS');
  assert.doesNotMatch(cppSource, /server\.(?:Get|Post)\(["']\/api\/(?:info|eval)["']/, 'C++ static server must not expose legacy business-shaped APIs');
  assert.match(cppSource, /server\.Get\(["']\/api\/health["']/, 'C++ static server must keep an internal liveness endpoint');
  assert.match(cppSource, /std::string host = "127\.0\.0\.1"/);
  for (const publicDirectory of ['pages', 'shared', 'UI', 'codevis']) {
    assert.match(cppSource, new RegExp(`"${publicDirectory}"`));
  }
  const baseUrlIndex = process.argv.indexOf('--base-url');
  const providedBaseUrl = baseUrlIndex >= 0 ? String(process.argv[baseUrlIndex + 1] || '').replace(/\/$/, '') : '';
  const port = providedBaseUrl ? null : await freePort();
  const child = providedBaseUrl ? null : spawn(process.execPath, ['server/dev-static-server.mjs', '--port', String(port)], {
    cwd: repoRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  if (child) child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const baseUrl = providedBaseUrl || `http://127.0.0.1:${port}`;
  try {
    await waitForServer(baseUrl);
    for (const publicPath of ['/index.html', '/sw.js', '/LICENSE.md', '/shared/js/api-client.js', '/pages/student/student-workbench.js']) {
      const response = await fetch(`${baseUrl}${publicPath}`, { cache: 'no-store' });
      assert.equal(response.status, 200, `${publicPath} should be public`);
      if (publicPath === '/LICENSE.md') {
        assert.match(response.headers.get('content-type') || '', /^text\/markdown\b/);
      }
    }
    for (const privatePath of [
      '/backend/app/main.py',
      '/%62ackend/app/main.py',
      '/pages/../backend/app/main.py',
      '/pages/%2e%2e/backend/app/main.py',
      '/shared/js/%2e%2e/%2e%2e/backend/app/main.py',
      '/deploy.ps1',
      '/tools/browser/script-sandbox-isolation-proof.cjs',
      '/doc/03-%E5%8F%91%E5%B8%83%E5%8E%86%E5%8F%B2.md',
      '/.git/config',
      '/README.md',
    ]) {
      const response = await fetch(`${baseUrl}${privatePath}`, { cache: 'no-store' });
      assert.equal(response.status, 404, `${privatePath} must not be public`);
    }
  } finally {
    if (child) {
      child.kill();
      await new Promise((resolve) => {
        child.once('exit', resolve);
        setTimeout(resolve, 1000);
      });
    }
  }
  assert.equal(stderr, '');
  console.log('static public surface contract passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
