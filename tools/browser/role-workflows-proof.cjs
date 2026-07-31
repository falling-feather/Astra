#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { isIP } = require('node:net');
const {
  buildTargetBrowserEvidence,
  createTargetReleaseChecks,
} = require('./target-browser-evidence.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const REQUIRED_BROWSER_CHANNEL = 'msedge';
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_WORKFLOW_TIMEOUT_MS = 15 * 60_000;
const TARGET_BROWSER_EVIDENCE_FILENAME = 'target-browser-smoke.json';
const EXAMPLE_DOMAIN_ROOTS = Object.freeze(['example.com', 'example.net', 'example.org', 'example.edu']);
const ADMIN_DOMAINS = Object.freeze([
  'overview',
  'organizations',
  'identity',
  'classes',
  'courses',
  'audit',
]);
const ADMIN_OWNER_SCRIPT_PATHS = Object.freeze([
  '/pages/admin/admin-course-governance.js',
  '/pages/admin/admin-secondary-governance.js',
]);
const ADMIN_DIAGNOSTIC_PATHS = Object.freeze([
  '/api/health',
  '/api/admin/content/script-assets',
  '/api/admin/content/script-host-policies',
  '/api/admin/knowledge-snapshot-runs',
  '/api/admin/alert-outbox',
  '/api/admin/bugs',
]);
const ROLE_RESOURCE_PATHS = Object.freeze([
  '/pages/student/student.css',
  '/pages/student/student-workbench.js',
  '/pages/teacher/teacher-foundation.css',
  '/pages/teacher/teacher-workbench.css',
  '/pages/teacher/teacher-curriculum.css',
  '/pages/teacher/teacher.js',
  '/pages/admin/admin.css',
  '/pages/admin/admin.js',
]);
const ROLE_RESOURCE_EXPECTATIONS = Object.freeze({
  student: Object.freeze({
    styles: Object.freeze(['/pages/student/student.css']),
    scripts: Object.freeze(['/pages/student/student-workbench.js']),
  }),
  teacher: Object.freeze({
    styles: Object.freeze([
      '/pages/teacher/teacher-foundation.css',
      '/pages/teacher/teacher-workbench.css',
      '/pages/teacher/teacher-curriculum.css',
    ]),
    scripts: Object.freeze(['/pages/teacher/teacher.js']),
  }),
  admin: Object.freeze({
    styles: Object.freeze([
      '/pages/teacher/teacher-foundation.css',
      '/pages/teacher/teacher-workbench.css',
      '/pages/teacher/teacher-curriculum.css',
      '/pages/admin/admin.css',
    ]),
    scripts: Object.freeze(['/pages/admin/admin.js']),
  }),
});

let playwright;
try {
  playwright = require('playwright');
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: 'playwright_missing',
    message: 'Install Playwright or run with NODE_PATH pointing at a Playwright installation.',
    detail: error && error.message ? error.message : String(error),
  }, null, 2));
  process.exit(2);
}

const { chromium } = playwright;

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const raw = item.slice(2);
    const equals = raw.indexOf('=');
    if (equals >= 0) {
      parsed[raw.slice(0, equals)] = raw.slice(equals + 1);
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) parsed[raw] = true;
    else {
      parsed[raw] = next;
      index += 1;
    }
  }
  return parsed;
}

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function isLocalUrl(value) {
  try {
    const parsed = new URL(value);
    return ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)
      && ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function isExactTargetHttpsOrigin(value) {
  try {
    const raw = String(value || '').trim();
    if (!/^https:\/\/[^/?#]+$/iu.test(raw)) {
      return false;
    }
    const parsed = new URL(raw);
    const hostname = parsed.hostname.toLowerCase();
    const authority = raw.slice(raw.indexOf('://') + 3).toLowerCase();
    const labels = hostname.split('.');
    const reservedSuffixes = ['.example', '.invalid', '.localhost', '.local', '.test'];
    const exampleDomain = EXAMPLE_DOMAIN_ROOTS.some(
      (root) => hostname === root || hostname.endsWith(`.${root}`)
    );
    const publicDnsName = labels.length >= 2
      && labels.every((label) => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/u.test(label))
      && /[a-z]/u.test(labels.at(-1))
      && !reservedSuffixes.some((suffix) => hostname.endsWith(suffix))
      && !exampleDomain
      && isIP(hostname) === 0;
    const exactAuthority = authority === hostname || authority === `${hostname}:443`;
    return parsed.protocol === 'https:'
      && exactAuthority
      && parsed.username === ''
      && parsed.password === ''
      && parsed.port === ''
      && parsed.pathname === '/'
      && parsed.search === ''
      && parsed.hash === ''
      && publicDnsName;
  } catch {
    return false;
  }
}

function isPathWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function prepareProofDirectory(outDir, options = {}) {
  const targetMode = options.targetMode === true;
  if (targetMode) {
    assert(typeof options.explicitOut === 'string' && options.explicitOut.trim(), 'Target role workflow proof requires an explicit --out directory');
    assert(!isPathWithin(REPO_ROOT, outDir), 'Target role workflow proof output must be outside the Git worktree');
  }

  let existing = null;
  try {
    existing = await fs.stat(outDir);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
  if (existing) {
    assert(existing.isDirectory(), 'Role workflow proof output must be a directory');
    if (targetMode) {
      const entries = await fs.readdir(outDir);
      assert(entries.length === 0, 'Target role workflow proof output must start empty');
    }
  } else {
    await fs.mkdir(outDir, { recursive: true });
  }

  if (targetMode) {
    const [realRepoRoot, realOutDir] = await Promise.all([
      fs.realpath(REPO_ROOT),
      fs.realpath(outDir),
    ]);
    assert(!isPathWithin(realRepoRoot, realOutDir), 'Target role workflow proof output resolves inside the Git worktree');
  }
}

function safeName(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80);
}

function currentGitHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function currentGitStatusShort() {
  try {
    return execFileSync('git', ['status', '--short'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().split(/\r?\n/).filter(Boolean);
  } catch {
    return null;
  }
}

async function fileSha256(relativePath) {
  const bytes = await fs.readFile(path.join(REPO_ROOT, relativePath));
  return createHash('sha256').update(bytes).digest('hex');
}

async function criticalArtifactHashes() {
  const files = [
    'tools/browser/role-workflows-proof.cjs',
    'tools/browser/target-browser-evidence.cjs',
    'tools/tests/role-workflows-proof-contract.cjs',
    'tools/tests/target-browser-evidence-contract.cjs',
    'index.html',
    'shared/js/app-session.js',
    'shared/js/main.js',
    'shared/js/page-registry.js',
    'shared/js/router.js',
    'pages/student/student-workbench.js',
    'pages/teacher/teacher-foundation.css',
    'pages/teacher/teacher-workbench.css',
    'pages/teacher/teacher-curriculum.css',
    'pages/teacher/teacher.js',
    'pages/admin/admin.js',
    'sw.js',
  ];
  return Object.fromEntries(await Promise.all(files.map(async (file) => [file, await fileSha256(file)])));
}

function sortedUnique(values) {
  return Array.from(new Set(values || [])).sort();
}

function assertSamePaths(actual, expected, label) {
  const actualPaths = sortedUnique(actual);
  const expectedPaths = sortedUnique(expected);
  assert(
    JSON.stringify(actualPaths) === JSON.stringify(expectedPaths),
    `${label}: expected ${JSON.stringify(expectedPaths)}, got ${JSON.stringify(actualPaths)}`
  );
}

function assertOrderedPaths(actual, expected, label) {
  const actualPaths = Array.from(actual || []);
  const expectedPaths = Array.from(expected || []);
  assert(
    JSON.stringify(actualPaths) === JSON.stringify(expectedPaths),
    `${label}: expected ordered ${JSON.stringify(expectedPaths)}, got ${JSON.stringify(actualPaths)}`
  );
}

function isRoleResourcePath(pathname) {
  return ROLE_RESOURCE_PATHS.includes(String(pathname || ''));
}

async function launchBrowser(args) {
  const requested = String(args.channel || process.env.ASTRA_BROWSER_CHANNEL || REQUIRED_BROWSER_CHANNEL).toLowerCase();
  assert(
    requested === REQUIRED_BROWSER_CHANNEL,
    `QA-007 requires the real Microsoft Edge channel (${REQUIRED_BROWSER_CHANNEL}), got ${requested || 'empty'}`
  );
  const browser = await chromium.launch({
    headless: !args.headed,
    channel: REQUIRED_BROWSER_CHANNEL,
  });
  return { browser, channel: REQUIRED_BROWSER_CHANNEL };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(Number(options.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS)),
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  return { status: response.status, body, text };
}

async function serviceWorkerSourceEvidence(webBase) {
  const url = `${webBase}/sw.js`;
  const response = await fetch(url, {
    headers: { Accept: 'application/javascript,text/javascript;q=0.9,*/*;q=0.1' },
    cache: 'no-store',
    signal: AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS),
  });
  const source = await response.text();
  assert(response.status === 200, `Service Worker source failed with ${response.status}`);
  const cacheName = source.match(/const\s+CACHE_NAME\s*=\s*['"]([^'"]+)['"]/u)?.[1] || '';
  assert(cacheName.startsWith('astra-static-'), 'Service Worker source must expose the expected astra-static cache version');
  return {
    url,
    status: response.status,
    cacheName,
    sha256: createHash('sha256').update(source, 'utf8').digest('hex'),
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function roleUrl(webBase, apiBase, role) {
  return `${webBase}/?cacheMode=service-worker&apiBase=${encodeURIComponent(apiBase)}#${role}`;
}

function attachDiagnostics(page, bucket, label) {
  page.__astraInflightRequests = new Set();
  page.__astraDiagnosticsFrozen = false;
  page.__astraBrowserAuthorizationHeaderSeen = false;
  page.on('request', (request) => {
    page.__astraInflightRequests.add(request);
    try {
      const resource = new URL(request.url());
      if (resource.pathname.startsWith('/api/') && request.headers().authorization) {
        page.__astraBrowserAuthorizationHeaderSeen = true;
      }
    } catch {}
  });
  page.on('requestfinished', (request) => {
    page.__astraInflightRequests.delete(request);
  });
  page.on('console', (message) => {
    if (page.__astraDiagnosticsFrozen) return;
    if (/^Failed to load resource:/.test(message.text())) return;
    if (['warning', 'error'].includes(message.type())) {
      bucket.push({ kind: 'console', label, level: message.type(), message: message.text() });
    }
  });
  page.on('pageerror', (error) => {
    if (page.__astraDiagnosticsFrozen) return;
    bucket.push({ kind: 'pageerror', label, message: String(error && error.message || error) });
  });
  page.on('requestfailed', (request) => {
    page.__astraInflightRequests.delete(request);
    if (page.__astraDiagnosticsFrozen) return;
    if (/\/favicon\.ico(?:$|\?)/.test(request.url())) return;
    if ((page.__astraExpectedRequestFailurePaths || []).some((item) => (
      request.method() === item.method && new URL(request.url()).pathname === item.path
    ))) return;
    bucket.push({
      kind: 'requestfailed',
      label,
      url: request.url(),
      message: request.failure() && request.failure().errorText,
    });
  });
  page.on('response', (response) => {
    if (page.__astraDiagnosticsFrozen) return;
    if (response.status() < 400) return;
    const resource = new URL(response.url());
    if ((page.__astraExpectedHttpResponses || []).some((item) => (
      response.request().method() === item.method
      && response.status() === item.status
      && resource.pathname === item.path
    ))) return;
    const expectedAuthChallenge = response.status() === 401 && resource.pathname === '/api/users/me';
    const expectedPermissionDenial = response.status() === 403 && (
      resource.pathname === '/api/admin/stats'
      || resource.pathname === '/api/admin/class-join-requests'
      || /^\/api\/assignments\/\d+\/review$/.test(resource.pathname)
    );
    const expectedUnboundLearningEvidence = response.status() === 409 && (
      /^\/api\/learning-evidence\/classes\/\d+\/courses\/\d+\/aggregate$/.test(resource.pathname)
      || resource.pathname === '/api/learning-evidence/me/recovery'
    );
    if (expectedAuthChallenge || expectedPermissionDenial || expectedUnboundLearningEvidence) return;
    bucket.push({ kind: 'http', label, status: response.status(), url: response.url() });
  });
}

async function cookieSessionEvidence(roleRuntimes, apiBase, targetMode) {
  const evidence = {};
  for (const [role, runtime] of Object.entries(roleRuntimes)) {
    const sessionCookie = (await runtime.context.cookies(apiBase))
      .find((cookie) => cookie.name === 'astra_session');
    assert(sessionCookie, `${role} browser session cookie is missing`);
    assert(sessionCookie.httpOnly === true, `${role} browser session cookie must be HttpOnly`);
    assert(sessionCookie.sameSite === 'Lax', `${role} browser session cookie must use SameSite=Lax`);
    if (targetMode) {
      assert(sessionCookie.secure === true, `${role} target browser session cookie must be Secure`);
    }
    const authorizationHeaderSeen = runtime.context.pages().some(
      (page) => page.__astraBrowserAuthorizationHeaderSeen === true
    );
    assert(!authorizationHeaderSeen, `${role} browser requests must remain cookie-only`);
    evidence[role] = {
      cookieName: sessionCookie.name,
      httpOnly: sessionCookie.httpOnly,
      sameSite: sessionCookie.sameSite,
      secure: sessionCookie.secure,
      authorizationHeaderSeen: false,
    };
  }
  return evidence;
}

async function waitForNetworkQuiet(page, quietMs = 500, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const startedAt = Date.now();
  let quietSince = null;
  while (Date.now() - startedAt < timeoutMs) {
    const pending = page.__astraInflightRequests ? page.__astraInflightRequests.size : 0;
    if (pending === 0) {
      if (quietSince === null) quietSince = Date.now();
      if (Date.now() - quietSince >= quietMs) return;
    } else {
      quietSince = null;
    }
    await page.waitForTimeout(50);
  }
  throw new Error(`Network did not remain quiet for ${quietMs}ms; pending requests: ${page.__astraInflightRequests?.size || 0}`);
}

async function freezeDiagnostics(contexts) {
  const pages = contexts.flatMap((context) => context.pages());
  for (const page of pages) {
    await waitForNetworkQuiet(page);
    page.__astraDiagnosticsFrozen = true;
  }
}

async function createRolePage(browser, report, webBase, apiBase, role, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.__astraRoleResponses = [];
  page.on('response', (response) => {
    const resource = new URL(response.url());
    if (!isRoleResourcePath(resource.pathname)) return;
    page.__astraRoleResponses.push({
      path: resource.pathname,
      status: response.status(),
      fromServiceWorker: response.fromServiceWorker(),
    });
  });
  attachDiagnostics(page, report.browserIssues, role);
  await page.goto(roleUrl(webBase, apiBase, role), { waitUntil: 'domcontentloaded' });
  await page.locator('[data-app-auth-overlay]:not([hidden])').waitFor({ state: 'visible' });
  await page.locator('[data-app-auth-form="login"]').waitFor({ state: 'visible' });
  try {
    await page.waitForFunction(() => {
      const state = window.__englabCache;
      return Boolean(state && (
        (state.cacheMode === 'service-worker' && state.swRegistered && state.swReady)
        || state.swError
        || state.cacheMode === 'http-fallback'
      ));
    }, null, { timeout: 20_000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      cache: window.__englabCache || null,
      controller: navigator.serviceWorker && navigator.serviceWorker.controller
        ? navigator.serviceWorker.controller.scriptURL
        : null,
    }));
    throw new Error(`${role} Service Worker readiness timed out: ${JSON.stringify(diagnostics)}`, { cause: error });
  }
  const readiness = await page.evaluate(() => ({
    cache: window.__englabCache || null,
    controller: navigator.serviceWorker && navigator.serviceWorker.controller
      ? navigator.serviceWorker.controller.scriptURL
      : null,
  }));
  assert(
    readiness.cache
      && readiness.cache.cacheMode === 'service-worker'
      && readiness.cache.swRegistered
      && readiness.cache.swReady,
    `${role} Service Worker readiness failed: ${JSON.stringify(readiness)}`
  );
  const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker && navigator.serviceWorker.controller));
  if (!controlled) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('[data-app-auth-overlay]:not([hidden])').waitFor({ state: 'visible' });
    await page.locator('[data-app-auth-form="login"]').waitFor({ state: 'visible' });
  }
  await page.waitForFunction(() => Boolean(navigator.serviceWorker && navigator.serviceWorker.controller), null, { timeout: 20_000 });
  return { context, page, serviceWorkerReadiness: readiness };
}

async function registerFromUi(page, role, account) {
  const registerTab = page.locator('[data-app-auth-view="register"]');
  assert(await registerTab.count() === 1, `${role} registration tab must exist exactly once`);
  await registerTab.click();
  const form = page.locator('[data-app-auth-form="register"]');
  await form.locator('[name="username"]').fill(account.username);
  await form.locator('[name="display_name"]').fill(account.displayName);
  await form.locator('[name="role"]').selectOption(role);
  await form.locator('[name="password"]').fill(account.password);
  await form.locator('[name="password_confirm"]').fill(account.password);
  await form.locator('button[type="submit"]').click();
  await page.locator(`[data-auth-ui="account"][data-auth-role="${role}"]`).waitFor({ state: 'visible' });
}

async function loginFromUi(page, role, account) {
  const form = page.locator('[data-app-auth-form="login"]');
  await form.locator('[name="username"]').fill(account.username);
  await form.locator('[name="password"]').fill(account.password);
  await form.locator('button[type="submit"]').click();
  await page.locator(`[data-auth-ui="account"][data-auth-role="${role}"]`).waitFor({ state: 'visible' });
}

async function registerThenLogout(browser, report, webBase, apiBase, role, account) {
  const runtime = await createRolePage(browser, report, webBase, apiBase, role);
  try {
    await registerFromUi(runtime.page, role, account);
    const logout = await pageApi(runtime.page, apiBase, '/api/auth/logout', { method: 'POST' });
    assert(
      logout.status === 200 && logout.body && logout.body.status === 'ok',
      `${role} registration logout expected 200 status=ok, got ${logout.status}: ${JSON.stringify(logout.body)}`
    );
  } finally {
    await runtime.context.close();
  }
}

async function pageApi(page, apiBase, apiPath, options = {}) {
  return page.evaluate(async ({ base, resource, request, timeoutMs }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
    try {
      const response = await fetch(base + resource, {
        method: request.method || 'GET',
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(request.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: request.body ? JSON.stringify(request.body) : undefined,
      });
      const text = await response.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = null; }
      return { status: response.status, body };
    } finally {
      clearTimeout(timeout);
    }
  }, {
    base: apiBase,
    resource: apiPath,
    request: options,
    timeoutMs: Number(options.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS),
  });
}

async function createAdminCourseFixture(page, apiBase, schoolId, classId, runId) {
  const course = await pageApi(page, apiBase, '/api/courses', {
    method: 'POST',
    body: {
      school_id: Number(schoolId),
      galaxy_key: 'englab',
      course_key: `admin-governance-${runId}`,
      title: `Admin Governance ${runId}`,
      summary: 'Created through the formal teacher API for isolated admin governance proof.',
      status: 'draft',
    },
  });
  assert(course.status === 201 && course.body && course.body.id, `admin governance course creation failed: ${JSON.stringify(course)}`);
  const courseId = String(course.body.id);
  const attached = await pageApi(page, apiBase, `/api/courses/${courseId}/classes`, {
    method: 'POST',
    body: { class_id: Number(classId) },
  });
  assert(attached.status === 201, `admin governance class attachment failed: ${JSON.stringify(attached)}`);

  const unitIds = [];
  for (const [position, suffix] of [[1, 'one'], [2, 'two']]) {
    const unit = await pageApi(page, apiBase, `/api/courses/${courseId}/units`, {
      method: 'POST',
      body: {
        activity_key: `admin.governance.${runId}.${suffix}`,
        title: `Governed Unit ${position} ${runId}`,
        position,
        status: 'published',
      },
    });
    assert(unit.status === 201 && unit.body && unit.body.id, `admin governance unit ${position} creation failed: ${JSON.stringify(unit)}`);
    unitIds.push(String(unit.body.id));
  }

  const assignment = await pageApi(page, apiBase, `/api/courses/${courseId}/units/${unitIds[0]}/assignments`, {
    method: 'POST',
    body: {
      title: `Governed Assignment ${runId}`,
      description: 'Formal API fixture for the course status impact count.',
      max_score: 100,
      status: 'active',
      audience_mode: 'all_attached_classes',
    },
  });
  assert(assignment.status === 201 && assignment.body && assignment.body.id, `admin governance assignment creation failed: ${JSON.stringify(assignment)}`);
  const releasePlan = await pageApi(page, apiBase, `/api/courses/${courseId}/classes/${classId}/release-plan`);
  assert(releasePlan.status === 200 && releasePlan.body, `admin governance release plan read failed: ${JSON.stringify(releasePlan)}`);
  assert(releasePlan.body.items.length === 2, `admin governance release plan expected two units: ${JSON.stringify(releasePlan.body)}`);
  return {
    courseId,
    classId: String(classId),
    unitIds,
    assignmentId: String(assignment.body.id),
    releasePlan: releasePlan.body,
    expectedImpact: {
      attached_class_count: 1,
      course_unit_count: 2,
      assignment_count: 1,
    },
  };
}

async function serviceWorkerRoleEvidence(page, role, options = {}) {
  const expectation = ROLE_RESOURCE_EXPECTATIONS[role];
  assert(expectation, `Unknown role resource expectation: ${role}`);
  const expectedScripts = role === 'admin' && options.teacherWorkspaceVisited
    ? expectation.scripts.concat('/pages/teacher/teacher.js')
    : expectation.scripts.slice();
  const expectedResources = expectation.styles.concat(expectedScripts);
  await page.waitForFunction(({ styles, scripts }) => {
    const loadedStyles = Array.from(document.querySelectorAll('link[data-astra-role-resource]'))
      .map((node) => new URL(node.href).pathname);
    const loadedScripts = Array.from(document.querySelectorAll('script[data-router-page-script]'))
      .map((node) => new URL(node.src).pathname);
    return styles.every((value) => loadedStyles.includes(value))
      && scripts.every((value) => loadedScripts.includes(value));
  }, { styles: expectation.styles, scripts: expectedScripts });
  await page.waitForTimeout(150);
  const browserEvidence = await page.evaluate(async ({ rolePaths }) => {
    const cacheNames = await caches.keys();
    const entries = [];
    for (const cacheName of cacheNames) {
      const cache = await caches.open(cacheName);
      const requests = await cache.keys();
      requests.forEach((request) => entries.push({
        cacheName,
        url: request.url,
        path: new URL(request.url).pathname,
        method: request.method,
      }));
    }
    const registrations = await navigator.serviceWorker.getRegistrations();
    const controllerUrl = navigator.serviceWorker.controller && new URL(navigator.serviceWorker.controller.scriptURL);
    return {
      pageOrigin: location.origin,
      cacheMode: window.__englabCache && window.__englabCache.cacheMode,
      swReady: Boolean(window.__englabCache && window.__englabCache.swReady),
      controller: Boolean(navigator.serviceWorker.controller),
      controllerScript: navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL,
      controllerOrigin: controllerUrl && controllerUrl.origin,
      controllerPath: controllerUrl && controllerUrl.pathname,
      registrations: registrations.map((registration) => ({
        scope: registration.scope,
        activeScript: registration.active && registration.active.scriptURL,
      })),
      cacheNames,
      totalCacheEntries: entries.length,
      apiEntries: entries.filter((item) => item.path === '/api' || item.path.startsWith('/api/')),
      roleEntries: entries.filter((item) => rolePaths.includes(item.path)),
      loadedStyles: Array.from(document.querySelectorAll('link[data-astra-role-resource]'))
        .map((node) => new URL(node.href).pathname),
      loadedScripts: Array.from(document.querySelectorAll('script[data-router-page-script]'))
        .map((node) => new URL(node.src).pathname)
        .filter((resourcePath) => rolePaths.includes(resourcePath)),
    };
  }, { rolePaths: ROLE_RESOURCE_PATHS });
  const responses = (page.__astraRoleResponses || []).map((item) => ({ ...item }));
  const responsePaths = responses.map((item) => item.path);
  assert(browserEvidence.cacheMode === 'service-worker', `${role} must force service-worker cache mode`);
  assert(browserEvidence.swReady && browserEvidence.controller, `${role} must have a ready controlling Service Worker`);
  assert(browserEvidence.controllerOrigin === browserEvidence.pageOrigin, `${role} Service Worker controller origin mismatch`);
  assert(browserEvidence.controllerPath === '/sw.js', `${role} Service Worker controller must be /sw.js`);
  assert(browserEvidence.registrations.length === 1, `${role} must retain exactly one Service Worker registration`);
  assert(
    browserEvidence.registrations[0].scope === `${browserEvidence.pageOrigin}/`
      && browserEvidence.registrations[0].activeScript
      && new URL(browserEvidence.registrations[0].activeScript).pathname === '/sw.js',
    `${role} Service Worker scope or active script mismatch`
  );
  assert(
    browserEvidence.cacheNames.filter((name) => name.startsWith('astra-static-')).length === 1
      && browserEvidence.cacheNames.includes(options.expectedCacheName),
    `${role} Service Worker cache version mismatch: ${JSON.stringify(browserEvidence.cacheNames)}`
  );
  assert(browserEvidence.apiEntries.length === 0, `${role} CacheStorage must not contain API entries`);
  assert(browserEvidence.roleEntries.length === 0, `${role} CacheStorage must not contain role resources`);
  assertOrderedPaths(browserEvidence.loadedStyles, expectation.styles, `${role} loaded role styles`);
  assertSamePaths(browserEvidence.loadedScripts, expectedScripts, `${role} loaded role scripts`);
  assertSamePaths(responsePaths, expectedResources, `${role} role resource responses`);
  assert(responsePaths.length === expectedResources.length, `${role} role resources must load exactly once`);
  assert(responses.every((item) => item.status === 200), `${role} role resource responses must be 200`);
  assert(responses.every((item) => item.fromServiceWorker), `${role} role resources must traverse the controlling Service Worker network-only branch`);
  return { ...browserEvidence, responses };
}

async function stableUiEvidence(page, role) {
  await waitForNetworkQuiet(page, 500);
  await page.waitForTimeout(300);
  const evidence = await page.evaluate(({ currentRole }) => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const errorSelectors = [
      '.teacher-error',
      '.admin-error',
      '.admin-summary--error',
      '.admin-organization-alert--error',
      '.admin-organization-form__notice--error',
      '.student-panel-state--error',
      '.student-flash--error',
      '.teacher-flash--error',
      '.admin-notice--error',
      '[data-student-network]:not([hidden])',
      '[data-teacher-write-lock]:not([hidden])',
      '[data-admin-organization-lock]',
    ];
    const loadingSelectors = [
      '.student-loading',
      '.teacher-loading',
      '.admin-loading',
      '[aria-busy="true"]',
    ];
    const readVisible = (selectors, requireText = true) => Array.from(document.querySelectorAll(selectors.join(',')))
      .filter((element) => visible(element) && (!requireText || String(element.textContent || '').trim()))
      .map((element) => ({
        selector: element.className || element.tagName,
        text: String(element.textContent || '').trim().slice(0, 160),
      }));
    const dashboardSelector = {
      student: '[data-student-dashboard]:not([hidden])',
      teacher: '[data-teacher-dashboard]:not([hidden])',
      admin: '[data-admin-dashboard]:not([hidden])',
    }[currentRole];
    return {
      activePages: document.querySelectorAll('.page.active').length,
      dashboardCount: dashboardSelector ? document.querySelectorAll(dashboardSelector).length : 0,
      authOverlayVisible: Array.from(document.querySelectorAll('[data-app-auth-overlay]')).some(visible),
      visibleErrors: readVisible(errorSelectors),
      visibleLoading: readVisible(loadingSelectors, false),
    };
  }, { currentRole: role });
  assert(evidence.activePages === 1, `${role} must have one active page`);
  assert(evidence.dashboardCount === 1, `${role} must have one visible dashboard`);
  assert(!evidence.authOverlayVisible, `${role} auth overlay must be hidden after login`);
  assert(evidence.visibleErrors.length === 0, `${role} has visible error UI: ${JSON.stringify(evidence.visibleErrors)}`);
  assert(evidence.visibleLoading.length === 0, `${role} has a stuck loading UI: ${JSON.stringify(evidence.visibleLoading)}`);
  return evidence;
}

async function mobileRoleInteraction(page, role, options = {}) {
  if (role === 'student') {
    const assignmentId = String(options.assignmentId || '');
    assert(assignmentId, 'student mobile interaction requires the graded assignment id');
    for (const filter of ['feedback', 'all']) {
      const responsePromise = page.waitForResponse((response) => {
        const resource = new URL(response.url());
        return response.request().method() === 'GET'
          && resource.pathname === '/api/assignments/me'
          && resource.searchParams.get('filter') === filter
          && response.status() === 200;
      }, { timeout: DEFAULT_REQUEST_TIMEOUT_MS });
      await Promise.all([
        responsePromise,
        page.locator(`[data-student-assignment-filter="${filter}"]`).click(),
      ]);
      await page.locator(`[data-student-assignment-filter="${filter}"][aria-selected="true"]`).waitFor({ state: 'visible' });
      await page.locator(
        `[data-student-panel="assignments"] [data-student-assignment-id="${assignmentId}"]`
      ).waitFor({ state: 'visible' });
      await waitForNetworkQuiet(page, 300);
    }
  }
  if (role === 'teacher') {
    await page.locator('[data-teacher-action="refresh"]:not([disabled])').click();
    await page.locator('[data-teacher-action="refresh"]:not([disabled])').waitFor({ state: 'visible' });
  }
  if (role === 'admin') {
    await page.locator('[data-admin-action="refresh"]:not([disabled])').click();
    await page.locator('[data-admin-action="refresh"]:not([disabled])').waitFor({ state: 'visible' });
    await selectAdminSection(page, 'organizations', '[data-admin-panel="schools"]');
    await page.locator('[data-admin-panel="schools"]').focus();
    await page.waitForFunction(() => document.activeElement?.matches('[data-admin-panel="schools"]'));
  }
  return page.evaluate(({ currentRole }) => ({
    role: currentRole,
    hash: location.hash,
    activeElement: document.activeElement && (
      document.activeElement.getAttribute('data-admin-panel')
      || document.activeElement.getAttribute('data-student-assignment-filter')
      || document.activeElement.getAttribute('data-teacher-action')
      || document.activeElement.tagName
    ),
  }), { currentRole: role });
}

async function teacherForm(page, type, fields, successText) {
  const viewByForm = {
    school: 'structure', class: 'structure', course: 'structure', attach: 'structure',
    'student-batch-import': 'structure', 'student-transfer': 'structure',
    unit: 'assignments', assignment: 'assignments', 'assignment-audience': 'assignments',
    'assignment-class-policy': 'assignments', 'point-rule': 'assignments',
    collaborator: 'assignments', 'collaborator-batch': 'assignments',
    grade: 'grading',
  };
  const targetView = viewByForm[type];
  if (targetView) {
    const viewButton = page.locator(`[data-teacher-view="${targetView}"]`);
    if (await viewButton.count()) await viewButton.click();
  }
  const form = page.locator(`[data-teacher-form="${type}"]`);
  await form.waitFor({ state: 'attached' });
  await form.evaluate((node) => {
    const disclosure = node.closest('details');
    if (disclosure) disclosure.open = true;
  });
  await form.waitFor({ state: 'visible' });
  for (const [name, value] of Object.entries(fields || {})) {
    const control = form.locator(`[name="${name}"]`);
    if (typeof value === 'object' && value && value.select !== undefined) {
      await control.selectOption(String(value.select));
    } else {
      await control.fill(String(value));
    }
  }
  await form.locator('button[type="submit"]').click();
  await page.locator('[data-teacher-flash]').filter({ hasText: successText }).waitFor({ state: 'visible' });
}

async function selectedValue(page, selector) {
  return page.locator(selector).inputValue();
}

async function responsiveEvidence(page, role, outDir, options = {}) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(`[data-auth-ui="account"][data-auth-role="${role}"]`).waitFor({ state: 'visible' });
  const interaction = await mobileRoleInteraction(page, role, options);
  const stableUi = await stableUiEvidence(page, role);
  const layout = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    bodyScrollWidth: document.body.scrollWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    clippedAuthNodes: Array.from(document.querySelectorAll('[data-auth-ui] *'))
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .slice(0, 10)
      .map((element) => ({
        tag: element.tagName,
        className: String(element.className || ''),
        text: String(element.textContent || '').trim().slice(0, 80),
      })),
  }));
  const screenshot = path.join(outDir, `${safeName(role)}-390x844.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  assert(layout.bodyScrollWidth <= layout.innerWidth, `${role} body overflows 390px viewport`);
  assert(layout.documentScrollWidth <= layout.innerWidth, `${role} document overflows 390px viewport`);
  assert(layout.clippedAuthNodes.length === 0, `${role} auth UI contains clipped nodes at 390px`);
  return { ...layout, interaction, stableUi, screenshot };
}

async function adminDomainKeyboardEvidence(page) {
  await selectAdminSection(page, 'overview', '[data-admin-overview]');
  const overview = page.locator('[data-admin-section-button="overview"]');
  await overview.focus();
  const trace = [];
  for (const [key, expected] of [
    ['ArrowRight', 'organizations'],
    ['ArrowLeft', 'overview'],
    ['End', 'audit'],
    ['Home', 'overview'],
    ['ArrowLeft', 'audit'],
    ['ArrowRight', 'overview'],
  ]) {
    await page.keyboard.press(key);
    const active = await page.evaluate(() => document.activeElement?.getAttribute('data-admin-section-button'));
    assert(active === expected, `admin ${key} expected focused domain ${expected}, got ${active}`);
    const selected = await page.locator(`[data-admin-section-button="${expected}"]`).getAttribute('aria-selected');
    assert(selected === 'true', `admin ${key} expected selected domain ${expected}`);
    trace.push({ key, expected, active });
  }
  return trace;
}

async function adminGovernanceLayoutEvidence(page, outDir, width, height) {
  await page.setViewportSize({ width, height });
  await page.locator('[data-admin-dashboard]:not([hidden])').waitFor({ state: 'visible' });
  const domainNavigation = page.locator('.admin-section-nav');
  if (width <= 820) {
    await domainNavigation.evaluate((element) => {
      element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    });
  } else {
    await domainNavigation.scrollIntoViewIfNeeded();
  }
  const targets = [];
  for (const domain of ADMIN_DOMAINS) {
    const button = page.locator(`[data-admin-section-button="${domain}"]`);
    await button.scrollIntoViewIfNeeded();
    const evidence = await button.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const points = [
        [rect.left + rect.width / 2, rect.top + rect.height / 2],
        [rect.left + 2, rect.top + 2],
        [rect.right - 2, rect.bottom - 2],
      ];
      return {
        domain: element.getAttribute('data-admin-section-button'),
        width: rect.width,
        height: rect.height,
        completeHit: points.every(([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          return Boolean(hit && element.contains(hit));
        }),
      };
    });
    assert(evidence.width >= 44 && evidence.height >= 44, `admin ${domain} target is smaller than 44px at ${width}x${height}: ${JSON.stringify(evidence)}`);
    assert(evidence.completeHit, `admin ${domain} target is not fully hittable at ${width}x${height}`);
    targets.push(evidence);
  }
  const keyboard = await adminDomainKeyboardEvidence(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const layout = await page.evaluate(({ domains }) => {
    const root = document.querySelector('[data-admin-dashboard]:not([hidden])');
    const rootRect = root && root.getBoundingClientRect();
    const tabIds = domains.map((domain) => {
      const tab = document.querySelector(`[data-admin-section-button="${domain}"]`);
      const panelId = tab && tab.getAttribute('aria-controls');
      return {
        domain,
        panelId,
        matches: panelId ? document.querySelectorAll(`#${CSS.escape(panelId)}`).length : 0,
      };
    });
    const motionSample = getComputedStyle(document.querySelector('[data-admin-section-button="overview"]'));
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      bodyScrollWidth: document.body.scrollWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      rootLeft: rootRect && rootRect.left,
      rootRight: rootRect && rootRect.right,
      rootWidth: rootRect && rootRect.width,
      tabIds,
      transitionDuration: motionSample.transitionDuration,
      animationDuration: motionSample.animationDuration,
      animationIterationCount: motionSample.animationIterationCount,
    };
  }, { domains: ADMIN_DOMAINS });
  assert(layout.bodyScrollWidth <= layout.innerWidth, `admin body overflows ${width}x${height}`);
  assert(layout.documentScrollWidth <= layout.innerWidth, `admin document overflows ${width}x${height}`);
  assert(layout.rootLeft >= 0 && layout.rootRight <= layout.innerWidth + 1, `admin root exceeds ${width}px viewport: ${JSON.stringify(layout)}`);
  assert(layout.tabIds.every((item) => item.matches === 1), `admin tab aria-controls mismatch: ${JSON.stringify(layout.tabIds)}`);
  assert(parseFloat(layout.transitionDuration) <= 0.001, `admin reduced-motion transition remains active: ${layout.transitionDuration}`);
  assert(parseFloat(layout.animationDuration) <= 0.001, `admin reduced-motion animation remains active: ${layout.animationDuration}`);
  assert(layout.animationIterationCount === '1', `admin reduced-motion iteration count mismatch: ${layout.animationIterationCount}`);
  const screenshot = path.join(outDir, `admin-governance-${width}x${height}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  return { ...layout, targets, keyboard, screenshot };
}

async function adminOrganizationResponsiveEvidence(page, outDir) {
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = page.locator('[data-admin-organization-dialog]');
  await dialog.waitFor({ state: 'visible' });
  const layout = await page.evaluate(() => {
    const activeDialog = document.querySelector('[data-admin-organization-dialog][open]');
    const rect = activeDialog && activeDialog.getBoundingClientRect();
    const form = activeDialog && activeDialog.querySelector('[data-admin-organization-form]');
    const actionBoxes = Array.from(activeDialog.querySelectorAll([
      '[data-admin-organization-close]',
      '[data-admin-organization-confirm]',
      '[data-admin-organization-reconcile]',
      '[data-admin-organization-unlock]'
    ].join(','))).filter((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
    }).map((element) => {
      const box = element.getBoundingClientRect();
      return {
        action: element.getAttribute('data-admin-organization-confirm')
          || Array.from(element.attributes).find((attribute) => attribute.name.startsWith('data-admin-organization-'))?.name
          || element.tagName,
        width: box.width,
        height: box.height,
      };
    });
    return {
      innerWidth: window.innerWidth,
      bodyScrollWidth: document.body.scrollWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      dialogLeft: rect && rect.left,
      dialogRight: rect && rect.right,
      dialogScrollWidth: activeDialog && activeDialog.scrollWidth,
      dialogClientWidth: activeDialog && activeDialog.clientWidth,
      formScrollWidth: form && form.scrollWidth,
      formClientWidth: form && form.clientWidth,
      actionBoxes,
    };
  });
  const screenshot = path.join(outDir, 'admin-organization-390x844.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  assert(layout.bodyScrollWidth <= layout.innerWidth, 'admin organization body overflows 390px viewport');
  assert(layout.documentScrollWidth <= layout.innerWidth, 'admin organization document overflows 390px viewport');
  assert(layout.dialogLeft >= 0 && layout.dialogRight <= layout.innerWidth, 'admin organization dialog is outside viewport');
  assert(layout.dialogScrollWidth <= layout.dialogClientWidth + 1, 'admin organization dialog has horizontal overflow');
  assert(layout.formScrollWidth <= layout.formClientWidth + 1, 'admin organization form has horizontal overflow');
  assert(layout.actionBoxes.length >= 3, 'admin organization dialog must expose visible governance actions');
  assert(layout.actionBoxes.every((box) => box.width >= 44 && box.height >= 44), `admin organization touch targets are smaller than 44px: ${JSON.stringify(layout.actionBoxes)}`);
  return { ...layout, screenshot };
}

async function organizationFocusEvidence(page, label, expectedSelector = '') {
  await page.waitForFunction(({ selector }) => {
    const dialog = document.querySelector('[data-admin-organization-dialog][open]');
    const active = document.activeElement;
    return Boolean(dialog && active && dialog.contains(active) && (!selector || active.matches(selector)));
  }, { selector: expectedSelector });
  const evidence = await page.evaluate(() => {
    const dialog = document.querySelector('[data-admin-organization-dialog][open]');
    const active = document.activeElement;
    return {
      insideDialog: Boolean(dialog && active && dialog.contains(active)),
      tag: active && active.tagName,
      name: active && active.getAttribute('name'),
      action: active && (
        active.getAttribute('data-admin-organization-confirm')
        || Array.from(active.attributes).find((attribute) => attribute.name.startsWith('data-admin-organization-'))?.name
      ),
      text: String(active && active.textContent || '').trim().slice(0, 120),
    };
  });
  assert(evidence.insideDialog, `${label}: focus escaped the open organization dialog`);
  return evidence;
}

async function openOrganizationEditor(page, panelId, entityName) {
  const sectionId = panelId === 'classes' ? 'classes' : 'organizations';
  await selectAdminSection(page, sectionId, `[data-admin-panel="${panelId}"]`);
  const row = page.locator(`[data-admin-panel="${panelId}"] tbody tr`).filter({ hasText: entityName }).first();
  await row.waitFor({ state: 'visible' });
  await row.locator('[data-admin-organization-edit]').click();
  const dialog = page.locator('[data-admin-organization-dialog]');
  await dialog.waitFor({ state: 'visible' });
  await dialog.locator('[data-admin-organization-form]').waitFor({ state: 'visible' });
  await organizationFocusEvidence(page, `open ${panelId} organization editor`);
  return dialog;
}

async function selectAdminSection(page, sectionId, visibleSelector) {
  const button = page.locator(`[data-admin-section-button="${sectionId}"]`);
  await button.waitFor({ state: 'visible' });
  if (await button.getAttribute('aria-current') !== 'page') await button.click();
  if (visibleSelector) await page.locator(visibleSelector).first().waitFor({ state: 'visible' });
}

async function exerciseAdminCourseGovernance(page, apiBase, fixture, outDir) {
  const coursePath = `/api/courses/${fixture.courseId}/status`;
  const patchRequests = [];
  const capturePatch = (request) => {
    const resource = new URL(request.url());
    if (request.method() !== 'PATCH' || resource.pathname !== coursePath) return;
    let body = null;
    try { body = request.postDataJSON(); } catch {}
    patchRequests.push({
      base: resource.origin,
      path: resource.pathname,
      requestId: request.headers()['x-request-id'] || '',
      body,
    });
  };
  page.on('request', capturePatch);

  await page.setViewportSize({ width: 390, height: 844 });
  await selectAdminSection(page, 'courses', '[data-admin-course-workbench]');
  const filter = page.locator('[data-admin-course-filters] [name="q"]');
  await filter.fill(fixture.courseId);
  const courseTrigger = page.locator(`[data-admin-course-select="${fixture.courseId}"]`);
  await courseTrigger.waitFor({ state: 'visible' });
  await courseTrigger.click();
  const compactDialog = page.locator('[data-admin-course-dialog]');
  await compactDialog.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.activeElement?.matches('[data-admin-course-dialog] [data-admin-course-title]'));
  const compactLayout = await compactDialog.evaluate((dialog) => {
    const rect = dialog.getBoundingClientRect();
    const actionBoxes = Array.from(dialog.querySelectorAll('[data-admin-course-close], [data-admin-course-confirm]'))
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      })
      .map((element) => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return {
          width: box.width,
          height: box.height,
          centerHit: Boolean(hit && element.contains(hit)),
        };
      });
    return {
      left: rect.left,
      right: rect.right,
      width: rect.width,
      scrollWidth: dialog.scrollWidth,
      clientWidth: dialog.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      actionBoxes,
    };
  });
  assert(compactLayout.left >= 0 && compactLayout.right <= 390, `admin course dialog exceeds 390px viewport: ${JSON.stringify(compactLayout)}`);
  assert(compactLayout.scrollWidth <= compactLayout.clientWidth + 1, 'admin course dialog has horizontal overflow');
  assert(compactLayout.bodyScrollWidth <= 390 && compactLayout.documentScrollWidth <= 390, 'admin course dialog causes root horizontal overflow');
  assert(
    compactLayout.actionBoxes.length >= 2
      && compactLayout.actionBoxes.every((box) => box.width >= 44 && box.height >= 44 && box.centerHit),
    `admin course dialog actions fail 44px center-hit contract: ${JSON.stringify(compactLayout.actionBoxes)}`
  );
  const dialogScreenshot = path.join(outDir, 'admin-course-dialog-390x844.png');
  await page.screenshot({ path: dialogScreenshot, fullPage: true });
  await page.keyboard.press('Escape');
  await compactDialog.waitFor({ state: 'hidden' });
  await page.waitForFunction((courseId) => (
    document.activeElement?.getAttribute('data-admin-course-select') === String(courseId)
  ), fixture.courseId);

  await page.setViewportSize({ width: 1015, height: 898 });
  await courseTrigger.click();
  let form = page.locator('[data-admin-course-inspector] [data-admin-course-form]');
  await form.waitFor({ state: 'visible' });
  await form.locator('[name="status"]').selectOption('published');
  const reason = `Publish isolated admin governance fixture ${fixture.courseId}.`;
  await form.locator('[data-admin-course-reason]').fill(reason);
  await form.locator('[data-admin-course-confirm]').click();
  await page.locator('[data-admin-course-inspector] [data-admin-course-preview]').waitFor({ state: 'visible' });
  assert(patchRequests.length === 0, `first course confirmation sent PATCH: ${JSON.stringify(patchRequests)}`);

  const patchResponse = page.waitForResponse((response) => {
    const resource = new URL(response.url());
    return response.request().method() === 'PATCH'
      && resource.pathname === coursePath
      && response.status() === 200;
  }, { timeout: DEFAULT_REQUEST_TIMEOUT_MS });
  form = page.locator('[data-admin-course-inspector] [data-admin-course-form]');
  await form.locator('[data-admin-course-confirm]').click();
  await patchResponse;
  const result = page.locator('[data-admin-course-inspector] [data-admin-course-result]');
  await result.waitFor({ state: 'visible' });
  await waitForNetworkQuiet(page, 300);
  assert(patchRequests.length === 1, `course publish expected exactly one PATCH, got ${patchRequests.length}`);
  assert(patchRequests[0].base === new URL(apiBase).origin, `course PATCH base mismatch: ${JSON.stringify(patchRequests[0])}`);
  assert(
    JSON.stringify(patchRequests[0].body) === JSON.stringify({
      expected_status: 'draft',
      status: 'published',
      reason,
    }),
    `course PATCH body mismatch: ${JSON.stringify(patchRequests[0].body)}`
  );
  assert(/^admin-course-[a-z0-9-]+$/u.test(patchRequests[0].requestId), `course Request ID missing or invalid: ${patchRequests[0].requestId}`);
  const resultEvidence = await result.evaluate((element) => ({
    requestId: String(element.querySelector('code')?.textContent || '').replace(/^Request ID:\s*/u, ''),
    impact: Array.from(element.querySelectorAll('[data-admin-course-impact] dd')).map((item) => Number(item.textContent)),
    text: String(element.textContent || '').trim(),
  }));
  assert(resultEvidence.requestId === patchRequests[0].requestId, `course UI Request ID mismatch: ${JSON.stringify(resultEvidence)}`);
  assert(
    JSON.stringify(resultEvidence.impact) === JSON.stringify(Object.values(fixture.expectedImpact)),
    `course impact UI mismatch: ${JSON.stringify(resultEvidence.impact)}`
  );

  const auditPath = `/api/admin/audit-logs?action=course.status.patch&resource_type=course&resource_id=${fixture.courseId}&request_id=${encodeURIComponent(resultEvidence.requestId)}&limit=25&offset=0`;
  const audit = await pageApi(page, apiBase, auditPath);
  assert(audit.status === 200 && audit.body && audit.body.total === 1, `course exact audit reread failed: ${JSON.stringify(audit)}`);
  const auditRow = audit.body.items[0];
  const snapshot = typeof auditRow.snapshot_json === 'string'
    ? JSON.parse(auditRow.snapshot_json)
    : auditRow.snapshot_json;
  assert(
    auditRow.action === 'course.status.patch'
      && auditRow.resource_type === 'course'
      && String(auditRow.resource_id) === fixture.courseId
      && auditRow.request_id === resultEvidence.requestId
      && auditRow.event_result === 'success'
      && snapshot && snapshot.after && snapshot.after.status === 'published',
    `course exact audit evidence mismatch: ${JSON.stringify(auditRow)}`
  );

  const createdAt = Date.parse(auditRow.created_at);
  assert(Number.isFinite(createdAt), `course audit timestamp is invalid: ${auditRow.created_at}`);
  const from = new Date(createdAt - 60_000).toISOString();
  const to = new Date(createdAt + 60_000).toISOString();
  await selectAdminSection(page, 'audit', '[data-admin-panel="audit-logs"]');
  const auditForm = page.locator('[data-admin-panel-form="audit-logs"]');
  await auditForm.locator('[name="action"]').fill('course.status.patch');
  await auditForm.locator('[name="resource_type"]').fill('course');
  await auditForm.locator('[name="resource_id"]').fill(fixture.courseId);
  await auditForm.locator('[name="request_id"]').fill(resultEvidence.requestId);
  await auditForm.locator('[name="from"]').fill(from);
  await auditForm.locator('[name="to"]').fill(to);
  const filteredAuditResponse = page.waitForResponse((response) => {
    const resource = new URL(response.url());
    return response.request().method() === 'GET'
      && resource.pathname === '/api/admin/audit-logs'
      && resource.searchParams.get('action') === 'course.status.patch'
      && resource.searchParams.get('resource_type') === 'course'
      && resource.searchParams.get('resource_id') === fixture.courseId
      && resource.searchParams.get('request_id') === resultEvidence.requestId
      && resource.searchParams.get('from') === from
      && resource.searchParams.get('to') === to
      && response.status() === 200;
  }, { timeout: DEFAULT_REQUEST_TIMEOUT_MS });
  await auditForm.locator('button[type="submit"]').click();
  const filteredResponse = await filteredAuditResponse;
  const filteredBody = await filteredResponse.json();
  assert(filteredBody.total === 1, `course audit UI filter expected one row: ${JSON.stringify(filteredBody)}`);
  await page.locator('[data-admin-panel="audit-logs"] tbody tr')
    .filter({ hasText: resultEvidence.requestId })
    .filter({ hasText: 'course.status.patch' })
    .waitFor({ state: 'visible' });

  const releasePlanAfter = await pageApi(page, apiBase, `/api/courses/${fixture.courseId}/classes/${fixture.classId}/release-plan`);
  assert(releasePlanAfter.status === 200, `course release plan reread failed: ${JSON.stringify(releasePlanAfter)}`);
  assert(
    JSON.stringify(releasePlanAfter.body) === JSON.stringify(fixture.releasePlan),
    `course status governance changed Unit release plan: ${JSON.stringify({ before: fixture.releasePlan, after: releasePlanAfter.body })}`
  );

  await selectAdminSection(page, 'courses', '[data-admin-course-workbench]');
  await page.locator(`[data-admin-course-select="${fixture.courseId}"]`).click();
  form = page.locator('[data-admin-course-inspector] [data-admin-course-form]');
  await form.locator('[name="status"]').selectOption('archived');
  await form.locator('[data-admin-course-reason]').fill(`Leave-page ambiguity proof for ${fixture.courseId}.`);
  await form.locator('[data-admin-course-confirm]').click();
  assert(patchRequests.length === 1, 'unknown-lock preview must not send a second course PATCH');

  let releaseIntercept;
  const interceptGate = new Promise((resolve) => { releaseIntercept = resolve; });
  let markIntercepted;
  const intercepted = new Promise((resolve) => { markIntercepted = resolve; });
  await page.route(`**${coursePath}`, async (route) => {
    markIntercepted();
    await interceptGate;
    await route.abort('connectionreset');
  });
  page.__astraExpectedRequestFailurePaths = [{ method: 'PATCH', path: coursePath }];
  form = page.locator('[data-admin-course-inspector] [data-admin-course-form]');
  await form.locator('[data-admin-course-confirm]').click();
  await intercepted;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { window.location.hash = 'planets'; });
  await page.waitForURL(/#planets$/);
  releaseIntercept();
  await page.locator('[data-astra-role-home]').waitFor({ state: 'visible' });
  await page.unroute(`**${coursePath}`);
  await page.evaluate(() => { window.location.hash = 'admin'; });
  await page.waitForURL(/#admin$/);
  await page.locator('[data-admin-dashboard]:not([hidden])').waitFor({ state: 'visible' });
  await selectAdminSection(page, 'courses', '[data-admin-course-workbench]');
  const lockedCourseTrigger = page.locator(`[data-admin-course-select="${fixture.courseId}"]`);
  const courseFilter = page.locator('[data-admin-course-filters] [name="q"]');
  await courseFilter.fill('__locked_course_filter_miss__');
  await lockedCourseTrigger.waitFor({ state: 'visible' });
  assert(await lockedCourseTrigger.getAttribute('aria-pressed') === 'true', 'locked course A must stay pinned when the current filter would otherwise hide it');
  await courseFilter.fill('');
  const otherCourseTrigger = page.locator(
    `[data-admin-course-select]:not([data-admin-course-select="${fixture.courseId}"])`
  ).first();
  await lockedCourseTrigger.waitFor({ state: 'visible' });
  await otherCourseTrigger.waitFor({ state: 'visible' });
  assert(await lockedCourseTrigger.getAttribute('aria-pressed') === 'true', 'course A lock must be auto-selected after mobile re-entry');
  assert(!(await lockedCourseTrigger.isDisabled()), 'selected locked course A must remain a read-only reconciliation entry');
  assert(await otherCourseTrigger.isDisabled(), 'course B must remain disabled while course A owns the global lock');
  const lockPatchCount = patchRequests.length;
  await otherCourseTrigger.evaluate((element) => element.click());
  assert(await lockedCourseTrigger.getAttribute('aria-pressed') === 'true', 'disabled course B click must not change locked course A selection');
  assert(patchRequests.length === lockPatchCount, 'course B click while A is locked must send zero PATCH requests');
  await lockedCourseTrigger.focus();
  await page.keyboard.press('Enter');
  const compactLockDialog = page.locator('[data-admin-course-dialog]');
  const lock = compactLockDialog.locator('[data-admin-course-lock="unchanged"]');
  await compactLockDialog.waitFor({ state: 'visible' });
  await lock.waitFor({ state: 'visible' });
  assert(patchRequests.length === lockPatchCount, 'opening locked course A details must send zero PATCH requests');
  await page.keyboard.press('Escape');
  await compactLockDialog.waitFor({ state: 'hidden' });
  await page.waitForFunction((courseId) => (
    document.activeElement?.getAttribute('data-admin-course-select') === String(courseId)
  ), fixture.courseId);
  await page.keyboard.press('Enter');
  await compactLockDialog.waitFor({ state: 'visible' });
  await lock.waitFor({ state: 'visible' });
  assert(patchRequests.length === lockPatchCount, 'reopening locked course A with keyboard must send zero PATCH requests');
  assert(await page.locator('[data-admin-action="refresh"]').isDisabled(), 'admin top refresh must remain disabled while course unknown lock exists');
  assert(await page.locator('[data-admin-api-base]').isDisabled(), 'admin API Base must remain disabled while course unknown lock exists');
  assert(patchRequests.length === 2, `unknown-lock action expected one sent PATCH, got ${patchRequests.length - 1}`);
  await lock.locator('[data-admin-course-reconcile]').click();
  await lock.locator('[data-admin-course-unlock]').waitFor({ state: 'visible' });
  assert(patchRequests.length === lockPatchCount, 'read-only course reconciliation must not resend PATCH');
  await lock.locator('[data-admin-course-unlock]').click();
  await lock.waitFor({ state: 'hidden' });
  await page.keyboard.press('Escape');
  await compactLockDialog.waitFor({ state: 'hidden' });
  await page.waitForFunction((courseId) => (
    document.activeElement?.getAttribute('data-admin-course-select') === String(courseId)
  ), fixture.courseId);
  assert(!(await otherCourseTrigger.isDisabled()), 'course B must become selectable only after explicit reconciliation and unlock');
  await page.setViewportSize({ width: 1015, height: 898 });
  page.__astraExpectedRequestFailurePaths = [];
  page.off('request', capturePatch);
  return {
    patchRequests,
    requestId: resultEvidence.requestId,
    impact: resultEvidence.impact,
    audit: {
      id: auditRow.id,
      action: auditRow.action,
      resourceType: auditRow.resource_type,
      resourceId: auditRow.resource_id,
      requestId: auditRow.request_id,
      eventResult: auditRow.event_result,
      afterStatus: snapshot.after.status,
      filter: { from, to },
    },
    releasePlanUnchanged: true,
    dialog: { ...compactLayout, screenshot: dialogScreenshot, escapeFocusReturned: true },
    unknownLeaveLock: {
      requestCount: patchRequests.length,
      outcome: 'unchanged',
      refreshBlocked: true,
      apiBaseBlocked: true,
      selectedLockRowReopened: true,
      otherCourseBlockedUntilUnlock: true,
      closeReopenKeyboard: true,
      reconciliationPatchCount: 0,
      focusReturned: true,
      manuallyUnlocked: true,
    },
  };
}

async function exerciseAdvancedLazyLoading(page, diagnosticRequests) {
  assert(diagnosticRequests.length === 0, `advanced diagnostics were prefetched: ${JSON.stringify(diagnosticRequests)}`);
  const trigger = page.locator('[data-admin-secondary-open="advanced"]');
  await trigger.click();
  const dialog = page.locator('[data-admin-secondary-dialog]');
  await dialog.waitFor({ state: 'visible' });
  await waitForNetworkQuiet(page, 300);
  assert(
    JSON.stringify(diagnosticRequests.slice().sort()) === JSON.stringify(ADMIN_DIAGNOSTIC_PATHS.slice().sort()),
    `advanced diagnostic request ledger mismatch: ${JSON.stringify(diagnosticRequests)}`
  );
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.matches('[data-admin-secondary-open="advanced"]'));
  return {
    beforeEntry: 0,
    afterEntry: diagnosticRequests.length,
    paths: diagnosticRequests.slice(),
    escapeFocusReturned: true,
  };
}

async function closeOrganizationEditor(dialog) {
  await dialog.locator('[data-admin-organization-close]').click();
  await dialog.waitFor({ state: 'hidden' });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const localMode = args['confirm-isolated-environment'] === true;
  const targetMode = args['confirm-target-staging'] === true;
  const rawApiBase = String(args.api || '').trim();
  const rawWebBase = String(args.web || '').trim();
  const localAdminUsername = String(process.env.ASTRA_QA_ADMIN_USERNAME || '').trim();
  const localAdminPassword = String(process.env.ASTRA_QA_ADMIN_PASSWORD || '');
  const hasLocalAdminUsername = localAdminUsername.length > 0;
  const hasLocalAdminPassword = localAdminPassword.length > 0;
  const usePreProvisionedLocalAdmin = localMode && hasLocalAdminUsername && hasLocalAdminPassword;
  let apiBase = localMode ? stripTrailingSlash(rawApiBase) : rawApiBase;
  let webBase = localMode ? stripTrailingSlash(rawWebBase) : rawWebBase;
  const outDir = path.resolve(args.out || path.join('test-screenshots', 'role-workflows'));
  const report = {
    ok: false,
    generatedAt: new Date().toISOString(),
    environment: {
      apiBase,
      webBase,
      browserChannel: null,
      browserVersion: null,
      mode: null,
      isolatedConfirmation: false,
      targetConfirmation: false,
      gitHead: currentGitHead(),
      gitStatusShort: currentGitStatusShort(),
      artifactSha256: null,
      serviceWorkerSource: null,
      adminProvisioning: null,
    },
    checks: [],
    entities: {},
    accounts: {},
    serviceWorker: {},
    cookieSession: {},
    targetReleaseChecks: createTargetReleaseChecks(),
    timeline: {
      swReadyAt: null,
      firstMutationAt: null,
    },
    stableUi: {},
    responsive: {},
    externalGates: {
      databaseDirectReconciliation: localMode
        ? 'required-sqlite-after-browser-proof'
        : 'required-mysql-after-browser-proof',
      targetEnvironmentRelease: targetMode ? 'required-after-browser-proof' : 'not-in-scope',
    },
    browserIssues: [],
    failure: null,
  };
  const contexts = [];
  let browser = null;
  let workflowCompleted = false;
  let watchdogExpired = false;
  let watchdogTimer = null;
  let proofDirectoryReady = false;
  const workflowTimeoutMs = Number(args['workflow-timeout-ms'] || DEFAULT_WORKFLOW_TIMEOUT_MS);

  function record(name, evidence = {}) {
    report.checks.push({ name, ok: true, evidence });
  }

  function markTargetReleaseCheck(name) {
    assert(Object.hasOwn(report.targetReleaseChecks, name), `Unknown target-release-v2 browser check: ${name}`);
    report.targetReleaseChecks[name] = true;
  }

  try {
    assert(Number.isFinite(workflowTimeoutMs) && workflowTimeoutMs >= 60_000 && workflowTimeoutMs <= 30 * 60_000, 'Workflow timeout must be between 60000 and 1800000 ms');
    assert(localMode !== targetMode, 'Pass exactly one of --confirm-isolated-environment or --confirm-target-staging');
    if (localMode) {
      assert(isLocalUrl(apiBase) && isLocalUrl(webBase), 'Local role workflow proof only accepts local API and web URLs');
      assert(
        hasLocalAdminUsername === hasLocalAdminPassword,
        'Local pre-provisioned admin requires both ASTRA_QA_ADMIN_USERNAME and ASTRA_QA_ADMIN_PASSWORD'
      );
    } else {
      assert(
        isExactTargetHttpsOrigin(rawApiBase)
          && isExactTargetHttpsOrigin(rawWebBase)
          && new URL(rawApiBase).origin === new URL(rawWebBase).origin,
        'Target role workflow proof requires one exact non-local HTTPS origin for API and web',
      );
      apiBase = new URL(rawApiBase).origin;
      webBase = new URL(rawWebBase).origin;
      report.environment.apiBase = apiBase;
      report.environment.webBase = webBase;
    }
    assert(report.environment.gitHead, 'QA-007 requires an exact Git HEAD');
    assert(Array.isArray(report.environment.gitStatusShort), 'QA-007 requires readable Git working-tree provenance');
    if (targetMode) {
      assert(report.environment.gitStatusShort.length === 0, 'Target role workflow proof requires a clean frozen Git worktree');
    }
    report.environment.mode = targetMode ? 'target-staging' : 'isolated-local';
    report.environment.isolatedConfirmation = localMode;
    report.environment.targetConfirmation = targetMode;
    await prepareProofDirectory(outDir, { targetMode, explicitOut: args.out });
    proofDirectoryReady = true;
    report.environment.artifactSha256 = await criticalArtifactHashes();
    report.environment.serviceWorkerSource = await serviceWorkerSourceEvidence(webBase);
    record('exact Git and critical artifact provenance', {
      gitHead: report.environment.gitHead,
      dirtyPaths: report.environment.gitStatusShort,
      serviceWorkerSha256: report.environment.serviceWorkerSource.sha256,
      serviceWorkerCacheName: report.environment.serviceWorkerSource.cacheName,
    });

    const health = await fetchJson(`${apiBase}/api/health`);
    assert(health.status === 200, `API health failed with ${health.status}`);
    if (localMode) {
      assert(['development', 'test', 'testing'].includes(health.body && health.body.environment), 'Local API must report development/test/testing');
      record('isolated local environment guard', { environment: health.body.environment });
    } else {
      assert(['staging', 'production'].includes(health.body && health.body.environment), 'Target API must report staging or production');
      record('target staging HTTPS and production-like environment guard', { environment: health.body.environment });
    }

    const launched = await launchBrowser(args);
    browser = launched.browser;
    report.environment.browserChannel = launched.channel;
    report.environment.browserVersion = await browser.version();
    watchdogTimer = setTimeout(() => {
      watchdogExpired = true;
      if (browser) browser.close().catch(() => {});
    }, workflowTimeoutMs);

    const anonymousPreflight = await createRolePage(browser, report, webBase, apiBase, 'student');
    try {
      const anonymousEvidence = await anonymousPreflight.page.evaluate(() => ({
        authOverlayVisible: Boolean(document.querySelector('[data-app-auth-overlay]:not([hidden])')),
        loginFormVisible: Boolean(document.querySelector('[data-app-auth-form="login"]')),
        controller: navigator.serviceWorker && navigator.serviceWorker.controller
          ? navigator.serviceWorker.controller.scriptURL
          : null,
      }));
      const anonymousRoleResponses = (anonymousPreflight.page.__astraRoleResponses || []).map((item) => ({ ...item }));
      assert(anonymousEvidence.authOverlayVisible && anonymousEvidence.loginFormVisible, 'anonymous preflight must remain inside the login gate');
      assert(anonymousRoleResponses.length === 0, `anonymous preflight loaded role resources: ${JSON.stringify(anonymousRoleResponses)}`);
      report.serviceWorker.anonymous = {
        ...anonymousEvidence,
        cache: anonymousPreflight.serviceWorkerReadiness.cache,
        roleResponses: anonymousRoleResponses,
      };
      report.timeline.swReadyAt = new Date().toISOString();
      record('anonymous authentication gate and Service Worker preflight before any business mutation', report.serviceWorker.anonymous);
      markTargetReleaseCheck('login_before_shell');
    } finally {
      await anonymousPreflight.context.close();
    }

    const runId = Date.now().toString(36);
    const password = `Astra!${runId}Aa9`;
    const accounts = {
      teacher: { username: `e2e_teacher_${runId}`, displayName: '端到端教师', password },
      student: { username: `e2e_student_${runId}`, displayName: '端到端学生', password },
      batchStudent: { username: `e2e_batch_${runId}`, displayName: '批量导入学生', password },
      governed: { username: `e2e_governed_${runId}`, displayName: '用户治理对象', password },
      applicant: { username: `e2e_applicant_${runId}`, displayName: '审批申请学生', password },
      outsider: { username: `e2e_outsider_${runId}`, displayName: '越权验证学生', password },
      admin: usePreProvisionedLocalAdmin
        ? { username: localAdminUsername, displayName: '预置验收管理员', password: localAdminPassword }
        : { username: `e2e_admin_${runId}`, displayName: '端到端管理员', password },
    };

    report.timeline.firstMutationAt = new Date().toISOString();
    assert(
      Date.parse(report.timeline.swReadyAt) <= Date.parse(report.timeline.firstMutationAt),
      `Service Worker preflight must precede the first mutation: ${JSON.stringify(report.timeline)}`
    );
    if (targetMode) {
      assert(!args['admin-bootstrap-token'], 'Target staging bootstrap token must be injected through ASTRA_ADMIN_BOOTSTRAP_TOKEN');
      assert(process.env.ASTRA_ADMIN_BOOTSTRAP_TOKEN, 'Target staging requires ASTRA_ADMIN_BOOTSTRAP_TOKEN');
    }
    if (usePreProvisionedLocalAdmin) {
      report.environment.adminProvisioning = 'pre-provisioned-local-environment';
      report.accounts.admin = { username: accounts.admin.username, id: null };
      record('pre-provisioned local admin selected without runtime bootstrap', {
        username: accounts.admin.username,
        credentialSource: 'process-environment',
      });
    } else {
      const adminBootstrapToken = targetMode
        ? process.env.ASTRA_ADMIN_BOOTSTRAP_TOKEN
        : (args['admin-bootstrap-token'] || process.env.ASTRA_ADMIN_BOOTSTRAP_TOKEN);
      const bootstrap = await fetchJson(`${apiBase}/api/admin/bootstrap`, {
        method: 'POST',
        body: {
          username: accounts.admin.username,
          display_name: accounts.admin.displayName,
          password: accounts.admin.password,
          ...(adminBootstrapToken ? { bootstrap_token: String(adminBootstrapToken) } : {}),
        },
      });
      assert(bootstrap.status === 201, `Admin bootstrap failed with ${bootstrap.status}: ${bootstrap.text}`);
      report.environment.adminProvisioning = targetMode ? 'target-runtime-bootstrap' : 'isolated-runtime-bootstrap';
      report.accounts.admin = { username: accounts.admin.username, id: String(bootstrap.body && bootstrap.body.id) };
      record('controlled admin bootstrap', { role: bootstrap.body && bootstrap.body.role });
    }

    const auxiliaryRegistrations = {};
    for (const key of ['batchStudent', 'governed']) {
      const account = accounts[key];
      const registration = await fetchJson(`${apiBase}/api/auth/register`, {
        method: 'POST',
        body: {
          username: account.username,
          display_name: account.displayName,
          password: account.password,
          role: 'student',
        },
      });
      assert(registration.status === 201, `${key} registration failed with ${registration.status}: ${registration.text}`);
      auxiliaryRegistrations[key] = registration.body;
      report.accounts[key] = { username: account.username, id: String(registration.body && registration.body.id) };
    }

    await registerThenLogout(browser, report, webBase, apiBase, 'teacher', accounts.teacher);
    const teacherRuntime = await createRolePage(browser, report, webBase, apiBase, 'teacher');
    contexts.push(teacherRuntime.context);
    await loginFromUi(teacherRuntime.page, 'teacher', accounts.teacher);
    await teacherRuntime.page.locator('[data-teacher-dashboard]:not([hidden])').waitFor({ state: 'visible' });
    const teacherIdentity = await pageApi(teacherRuntime.page, apiBase, '/api/users/me');
    assert(teacherIdentity.status === 200 && teacherIdentity.body.role === 'teacher', 'teacher explicit login identity mismatch');
    report.accounts.teacher = { username: accounts.teacher.username, id: String(teacherIdentity.body.id) };
    report.serviceWorker.teacher = await serviceWorkerRoleEvidence(teacherRuntime.page, 'teacher', {
      expectedCacheName: report.environment.serviceWorkerSource.cacheName,
    });
    record('teacher first-party registration, logout, explicit login and dashboard');

    const schoolName = `E2E School ${runId}`;
    const className = `E2E Class ${runId}`;
    await teacherForm(teacherRuntime.page, 'school', {
      name: schoolName,
      region: 'Shanghai',
    }, '学校已创建');
    const schoolId = await selectedValue(teacherRuntime.page, '[data-teacher-scope="schoolId"]');

    await teacherForm(teacherRuntime.page, 'class', {
      name: className,
      grade: '10',
      term: '2026A',
    }, '班级已创建');
    const classId = await selectedValue(teacherRuntime.page, '[data-teacher-scope="classId"]');

    await teacherForm(teacherRuntime.page, 'course', {
      title: `E2E Course ${runId}`,
      status: { select: 'published' },
      summary: '隔离三角色端到端验收课程',
    }, '课程已创建');
    const courseId = await selectedValue(teacherRuntime.page, '[data-teacher-scope="courseId"]');

    await teacherForm(teacherRuntime.page, 'attach', {}, '课程已挂接班级');
    await teacherForm(teacherRuntime.page, 'unit', {
      title: `E2E Unit ${runId}`,
      position: '1',
      status: { select: 'published' },
      content_slug: 'physics/energy-conservation',
    }, '单元已创建');
    const unitId = await selectedValue(teacherRuntime.page, '[data-teacher-scope="unitId"]');

    await teacherForm(teacherRuntime.page, 'assignment', {
      unit_id: { select: unitId },
      title: `E2E Assignment ${runId}`,
      max_score: '20',
      status: { select: 'active' },
      audience_mode: { select: 'all_attached_classes' },
      description: '提交能量守恒推导过程。',
    }, '作业已创建');
    const assignmentId = await selectedValue(teacherRuntime.page, '[data-teacher-scope="assignmentId"]');
    await teacherForm(
      teacherRuntime.page,
      'assignment-class-policy',
      {},
      '当前班级作业与积分覆盖策略已保存'
    );
    await teacherRuntime.page.waitForFunction(() => {
      const reset = document.querySelector('[data-teacher-class-policy-reset]');
      return reset instanceof HTMLButtonElement && !reset.disabled;
    });
    report.entities = { schoolId, classId, courseId, unitId, assignmentId };
    record('teacher creates published course workflow and persisted class policy', { ...report.entities });
    const adminCourseFixture = await createAdminCourseFixture(
      teacherRuntime.page,
      apiBase,
      schoolId,
      classId,
      runId
    );
    Object.assign(report.entities, {
      adminCourseId: adminCourseFixture.courseId,
      adminCourseUnitIds: adminCourseFixture.unitIds,
      adminCourseAssignmentId: adminCourseFixture.assignmentId,
    });
    record('teacher creates isolated draft course governance fixture through formal APIs', {
      courseId: adminCourseFixture.courseId,
      classId: adminCourseFixture.classId,
      unitIds: adminCourseFixture.unitIds,
      assignmentId: adminCourseFixture.assignmentId,
      expectedImpact: adminCourseFixture.expectedImpact,
      releasePlanVersion: adminCourseFixture.releasePlan.plan_version,
    });

    const eligibilityClass = await pageApi(teacherRuntime.page, apiBase, '/api/classes', {
      method: 'POST',
      body: {
        school_id: Number(schoolId),
        name: `E2E Eligibility ${runId}`,
        grade: '10',
        term: '2026A',
      },
    });
    assert(
      eligibilityClass.status === 201 && eligibilityClass.body && eligibilityClass.body.id,
      `batch import eligibility class creation failed with ${eligibilityClass.status}: ${JSON.stringify(eligibilityClass.body)}`
    );
    const eligibilityClassId = String(eligibilityClass.body.id);
    const batchStudentLogin = await fetchJson(`${apiBase}/api/auth/login`, {
      method: 'POST',
      body: {
        username: accounts.batchStudent.username,
        password: accounts.batchStudent.password,
      },
    });
    assert(
      batchStudentLogin.status === 200 && batchStudentLogin.body && batchStudentLogin.body.access_token,
      `batch student eligibility login failed with ${batchStudentLogin.status}: ${batchStudentLogin.text}`
    );
    const batchStudentAuthorization = {
      Authorization: `Bearer ${batchStudentLogin.body.access_token}`,
    };
    const eligibilityJoin = await fetchJson(`${apiBase}/api/classes/${eligibilityClassId}/join`, {
      method: 'POST',
      headers: batchStudentAuthorization,
      body: { role: 'student' },
    });
    assert(
      eligibilityJoin.status === 201 && eligibilityJoin.body && eligibilityJoin.body.role === 'student',
      `batch student school eligibility setup failed with ${eligibilityJoin.status}: ${eligibilityJoin.text}`
    );
    const eligibilityLogout = await fetchJson(`${apiBase}/api/auth/logout`, {
      method: 'POST',
      headers: batchStudentAuthorization,
    });
    assert(
      eligibilityLogout.status === 200 && eligibilityLogout.body && eligibilityLogout.body.status === 'ok',
      `batch student eligibility logout failed with ${eligibilityLogout.status}: ${eligibilityLogout.text}`
    );
    report.entities.eligibilityClassId = eligibilityClassId;
    record('batch import prerequisite uses public class join to establish same-school eligibility', {
      eligibilityClassId,
      username: accounts.batchStudent.username,
      eligibilityMembershipId: String(eligibilityJoin.body.id),
    });

    let batchImportRequests = 0;
    teacherRuntime.page.on('request', (request) => {
      const resource = new URL(request.url());
      if (request.method() === 'POST' && resource.pathname === `/api/classes/${classId}/students/batch-import`) {
        batchImportRequests += 1;
      }
    });
    await teacherForm(teacherRuntime.page, 'student-batch-import', {
      usernames: accounts.batchStudent.username,
    }, '批量导入已处理');
    assert(batchImportRequests === 1, `teacher batch import expected one POST, got ${batchImportRequests}`);
    const batchResult = teacherRuntime.page.locator('.teacher-member-import-result');
    await batchResult.filter({ hasText: accounts.batchStudent.username }).waitFor({ state: 'visible' });
    assert(await batchResult.filter({ hasText: '新增 1' }).count() === 1, 'teacher batch import must create one membership');
    assert(await batchResult.filter({ hasText: '失败 0' }).count() === 1, 'teacher batch import must have zero failed rows');
    await teacherRuntime.page.locator('.teacher-table tbody tr').filter({ hasText: accounts.batchStudent.username }).waitFor({ state: 'visible' });
    report.entities.batchStudentId = String(auxiliaryRegistrations.batchStudent.id);
    record('teacher performs one real batch student import and reconciles the member table', {
      requestCount: batchImportRequests,
      username: accounts.batchStudent.username,
      userId: report.entities.batchStudentId,
    });

    await registerThenLogout(browser, report, webBase, apiBase, 'student', accounts.student);
    const studentRuntime = await createRolePage(browser, report, webBase, apiBase, 'student');
    contexts.push(studentRuntime.context);
    await loginFromUi(studentRuntime.page, 'student', accounts.student);
    await studentRuntime.page.locator('[data-student-dashboard]:not([hidden])').waitFor({ state: 'visible' });
    const studentIdentity = await pageApi(studentRuntime.page, apiBase, '/api/users/me');
    assert(studentIdentity.status === 200 && studentIdentity.body.role === 'student', 'student explicit login identity mismatch');
    report.accounts.student = { username: accounts.student.username, id: String(studentIdentity.body.id) };
    report.serviceWorker.student = await serviceWorkerRoleEvidence(studentRuntime.page, 'student', {
      expectedCacheName: report.environment.serviceWorkerSource.cacheName,
    });
    record('student first-party registration, logout and explicit login');
    const joinForm = studentRuntime.page.locator('[data-student-join-form]');
    await joinForm.locator('[name="class_id"]').fill(classId);
    await joinForm.locator('button[type="submit"]').click();
    await studentRuntime.page.locator('[data-student-layout]:not([hidden])').waitFor({ state: 'visible' });
    const assignmentButton = studentRuntime.page.locator(`[data-student-panel="assignments"] [data-student-assignment-id="${assignmentId}"]`);
    await assignmentButton.waitFor({ state: 'visible' });
    record('student joins class and sees assignment', { classId, assignmentId });

    assert(await assignmentButton.count() === 1, 'Student assignment action must be unique inside assignment panel');
    await assignmentButton.click();
    const submissionForm = studentRuntime.page.locator(`[data-student-submission-form][data-assignment-id="${assignmentId}"]`);
    await submissionForm.waitFor({ state: 'visible' });
    const answer = `E2E answer ${runId}: energy before equals energy after.`;
    let submissionWriteCount = 0;
    studentRuntime.page.on('request', (request) => {
      const resource = new URL(request.url());
      if (request.method() === 'POST' && resource.pathname === `/api/assignments/${assignmentId}/submissions`) {
        submissionWriteCount += 1;
      }
    });
    await submissionForm.locator('textarea').fill(answer);
    await submissionForm.locator('button[type="submit"]').click();
    await studentRuntime.page.locator('[data-student-panel="submission"] .student-review-block').filter({ hasText: answer }).waitFor({ state: 'visible' });
    assert(submissionWriteCount === 1, `student submission expected one POST, got ${submissionWriteCount}`);
    record('student submits assignment without retry', { assignmentId, requestCount: submissionWriteCount });

    const teacherRefresh = teacherRuntime.page.locator('[data-teacher-action="refresh"]');
    await teacherRefresh.click();
    await teacherRuntime.page.locator('[data-teacher-view="grading"]').click();
    const gradeForm = teacherRuntime.page.locator('[data-teacher-form="grade"]');
    await gradeForm.locator('[name="submission_id"]:not([disabled])').waitFor({ state: 'visible' });
    const submissionId = await gradeForm.locator('[name="submission_id"]').inputValue();
    await gradeForm.locator('[name="score"]').fill('18');
    await gradeForm.locator('[name="status"]').selectOption('graded');
    await gradeForm.locator('[name="feedback"]').fill(`E2E feedback ${runId}`);
    await gradeForm.locator('button[type="submit"]').click();
    await teacherRuntime.page.locator('[data-teacher-flash]').filter({ hasText: '评分已提交' }).waitFor({ state: 'visible' });
    report.entities.submissionId = String(submissionId);
    record('teacher grades submission', { submissionId, score: 18 });

    await studentRuntime.page.locator('[data-student-action="refresh"]').click();
    await studentRuntime.page.locator('[data-student-panel="submission"] .student-review-block').filter({ hasText: `E2E feedback ${runId}` }).waitFor({ state: 'visible' });
    record('student receives authoritative grade feedback');

    const studentAdminDenied = await pageApi(studentRuntime.page, apiBase, '/api/admin/stats');
    assert(studentAdminDenied.status === 403, `Student admin access expected 403, got ${studentAdminDenied.status}`);
    const teacherAdminDenied = await pageApi(teacherRuntime.page, apiBase, '/api/admin/class-join-requests');
    assert(teacherAdminDenied.status === 403, `Teacher admin queue expected 403, got ${teacherAdminDenied.status}`);
    studentRuntime.page.__astraExpectedHttpResponses = [
      { method: 'GET', status: 403, path: `/api/admin/schools/${schoolId}` },
      { method: 'PATCH', status: 403, path: `/api/admin/schools/${schoolId}` },
      { method: 'PATCH', status: 403, path: `/api/courses/${adminCourseFixture.courseId}/status` },
    ];
    teacherRuntime.page.__astraExpectedHttpResponses = [
      { method: 'GET', status: 403, path: `/api/admin/classes/${classId}` },
      { method: 'PATCH', status: 403, path: `/api/admin/classes/${classId}` },
      { method: 'PATCH', status: 403, path: `/api/courses/${adminCourseFixture.courseId}/status` },
    ];
    const studentSchoolReadDenied = await pageApi(studentRuntime.page, apiBase, `/api/admin/schools/${schoolId}`);
    const studentSchoolPatchDenied = await pageApi(studentRuntime.page, apiBase, `/api/admin/schools/${schoolId}`, {
      method: 'PATCH',
      body: { expected_version: 1, reason: 'student denial proof', name: 'denied' },
    });
    const teacherClassReadDenied = await pageApi(teacherRuntime.page, apiBase, `/api/admin/classes/${classId}`);
    const teacherClassPatchDenied = await pageApi(teacherRuntime.page, apiBase, `/api/admin/classes/${classId}`, {
      method: 'PATCH',
      body: { expected_version: 1, reason: 'teacher denial proof', name: 'denied' },
    });
    const forbiddenCourseStatusBody = {
      expected_status: 'draft',
      status: 'published',
      reason: 'Non-admin course governance denial proof.',
    };
    const studentCourseStatusDenied = await pageApi(
      studentRuntime.page,
      apiBase,
      `/api/courses/${adminCourseFixture.courseId}/status`,
      { method: 'PATCH', body: forbiddenCourseStatusBody }
    );
    const teacherCourseStatusDenied = await pageApi(
      teacherRuntime.page,
      apiBase,
      `/api/courses/${adminCourseFixture.courseId}/status`,
      { method: 'PATCH', body: forbiddenCourseStatusBody }
    );
    assert(studentSchoolReadDenied.status === 403 && studentSchoolPatchDenied.status === 403, 'student organization governance must be denied');
    assert(teacherClassReadDenied.status === 403 && teacherClassPatchDenied.status === 403, 'teacher organization governance must be denied');
    assert(
      studentCourseStatusDenied.status === 403 && teacherCourseStatusDenied.status === 403,
      `student/teacher course status governance must be denied: ${JSON.stringify({
        student: studentCourseStatusDenied.status,
        teacher: teacherCourseStatusDenied.status,
      })}`
    );
    studentRuntime.page.__astraExpectedHttpResponses = [];
    teacherRuntime.page.__astraExpectedHttpResponses = [];
    record('role permission denials', {
      studentAdmin: 403,
      teacherAdminQueue: 403,
      studentOrganization: [403, 403],
      teacherOrganization: [403, 403],
      courseStatus: { student: 403, teacher: 403 },
    });
    await teacherRuntime.page.goto(roleUrl(webBase, apiBase, 'admin'), { waitUntil: 'domcontentloaded' });
    await teacherRuntime.page.waitForURL(/#planets$/);
    await teacherRuntime.page.locator('#page-planets.page.active').waitFor({ state: 'visible' });
    const forbiddenAdminResources = await teacherRuntime.page.evaluate(() => ({
      scripts: document.querySelectorAll('script[data-router-page-script="admin"]').length,
      styles: Array.from(document.querySelectorAll('link[data-astra-role-resource]'))
        .filter((node) => new URL(node.href).pathname.startsWith('/pages/admin/')).length,
    }));
    assert(
      forbiddenAdminResources.scripts === 0 && forbiddenAdminResources.styles === 0,
      `teacher must not load admin resources: ${JSON.stringify(forbiddenAdminResources)}`
    );
    record('teacher forbidden admin hash falls back to planets before admin CSS or script load', forbiddenAdminResources);
    await teacherRuntime.page.evaluate(() => { window.location.hash = 'teacher'; });
    await teacherRuntime.page.waitForURL(/#teacher$/);
    await teacherRuntime.page.locator('[data-teacher-dashboard]:not([hidden])').waitFor({ state: 'visible' });

    const applicantRuntime = await createRolePage(browser, report, webBase, apiBase, 'student');
    contexts.push(applicantRuntime.context);
    await registerFromUi(applicantRuntime.page, 'student', accounts.applicant);
    const applicantIdentity = await pageApi(applicantRuntime.page, apiBase, '/api/users/me');
    assert(applicantIdentity.status === 200, 'applicant identity reread failed');
    report.accounts.applicant = { username: accounts.applicant.username, id: String(applicantIdentity.body.id) };
    const joinRequest = await pageApi(applicantRuntime.page, apiBase, `/api/classes/${classId}/join-requests`, {
      method: 'POST',
      body: { role: 'student', message: `E2E approval ${runId}` },
    });
    assert(joinRequest.status === 201, `Join request expected 201, got ${joinRequest.status}`);
    const joinRequestId = String(joinRequest.body.id);
    report.entities.joinRequestId = joinRequestId;

    const governedRuntime = await createRolePage(browser, report, webBase, apiBase, 'student');
    contexts.push(governedRuntime.context);
    await loginFromUi(governedRuntime.page, 'student', accounts.governed);
    await governedRuntime.page.locator('[data-student-dashboard]:not([hidden])').waitFor({ state: 'visible' });
    const governedIdentity = await pageApi(governedRuntime.page, apiBase, '/api/users/me');
    assert(
      governedIdentity.status === 200
      && Number(governedIdentity.body && governedIdentity.body.id) === Number(auxiliaryRegistrations.governed.id),
      'governed user session identity mismatch'
    );
    report.entities.governedUserId = String(auxiliaryRegistrations.governed.id);
    record('dedicated governed user has an active pre-governance session', {
      userId: report.entities.governedUserId,
      role: governedIdentity.body.role,
      status: governedIdentity.body.status,
    });

    const adminRuntime = await createRolePage(browser, report, webBase, apiBase, 'admin');
    contexts.push(adminRuntime.context);
    const adminDiagnosticRequests = [];
    const adminOwnerLoads = [];
    let adminAuthorityConfirmed = false;
    adminRuntime.page.on('response', (response) => {
      const resource = new URL(response.url());
      if (resource.pathname === '/api/users/me' && response.status() === 200) {
        adminAuthorityConfirmed = true;
      }
    });
    adminRuntime.page.on('request', (request) => {
      const resource = new URL(request.url());
      if (ADMIN_DIAGNOSTIC_PATHS.includes(resource.pathname)) {
        adminDiagnosticRequests.push(resource.pathname);
      }
      if (ADMIN_OWNER_SCRIPT_PATHS.includes(resource.pathname)) {
        adminOwnerLoads.push({ path: resource.pathname, authorityConfirmed: adminAuthorityConfirmed });
      }
    });
    assert(
      await adminRuntime.page.locator('script[data-admin-owner]').count() === 0,
      'anonymous admin route must not preload admin owner scripts'
    );
    await loginFromUi(adminRuntime.page, 'admin', accounts.admin);
    await adminRuntime.page.locator('[data-admin-dashboard]:not([hidden])').waitFor({ state: 'visible' });
    await adminRuntime.page.waitForFunction(() => document.querySelectorAll('script[data-admin-owner]').length === 2);
    assert(
      adminOwnerLoads.length === 2
        && adminOwnerLoads.every((item) => item.authorityConfirmed)
        && JSON.stringify(adminOwnerLoads.map((item) => item.path).sort()) === JSON.stringify(ADMIN_OWNER_SCRIPT_PATHS.slice().sort()),
      `admin owners must load exactly once after authoritative admin identity: ${JSON.stringify(adminOwnerLoads)}`
    );
    const adminIdentity = await pageApi(adminRuntime.page, apiBase, '/api/users/me');
    assert(adminIdentity.status === 200 && adminIdentity.body.role === 'admin', 'admin login identity mismatch');
    report.accounts.admin.id = String(adminIdentity.body.id);
    await adminRuntime.page.evaluate(() => { window.location.hash = 'planets'; });
    await adminRuntime.page.waitForURL(/#planets$/);
    const adminBusinessTask = adminRuntime.page.locator('[data-astra-role-home] .planets-priority__task');
    await adminBusinessTask.waitFor({ state: 'visible' });
    const adminBusinessTaskEvidence = await adminBusinessTask.evaluate((element) => ({
      text: String(element.textContent || '').trim(),
      href: element.querySelector('a')?.getAttribute('href') || '',
    }));
    assert(adminBusinessTaskEvidence.href === '#admin', `admin business task href must remain #admin: ${JSON.stringify(adminBusinessTaskEvidence)}`);
    assert(
      adminBusinessTaskEvidence.text.includes(joinRequestId),
      `admin business home must prioritize the real pending join request: ${JSON.stringify(adminBusinessTaskEvidence)}`
    );
    await adminBusinessTask.locator('a[href="#admin"]').click();
    await adminRuntime.page.locator('[data-admin-dashboard]:not([hidden])').waitFor({ state: 'visible' });
    record('admin business home prioritizes the authoritative pending join request', adminBusinessTaskEvidence);
    await adminRuntime.page.locator('a[href="#teacher"]:visible').first().click();
    await adminRuntime.page.locator('[data-teacher-dashboard]:not([hidden])').waitFor({ state: 'visible' });
    await adminRuntime.page.locator('a[href="#admin"]:visible').first().click();
    await adminRuntime.page.locator('[data-admin-dashboard]:not([hidden])').waitFor({ state: 'visible' });
    report.serviceWorker.admin = await serviceWorkerRoleEvidence(adminRuntime.page, 'admin', {
      teacherWorkspaceVisited: true,
      expectedCacheName: report.environment.serviceWorkerSource.cacheName,
    });
    report.cookieSession = await cookieSessionEvidence({
      student: studentRuntime,
      teacher: teacherRuntime,
      admin: adminRuntime,
    }, apiBase, targetMode);
    markTargetReleaseCheck('cookie_session');
    markTargetReleaseCheck('service_worker_api_no_store');
    record('admin reaches teacher workspace and returns to global governance', {
      loadedScripts: report.serviceWorker.admin.loadedScripts,
      cookieSession: report.cookieSession,
      ownerLoads: adminOwnerLoads,
    });
    report.responsive.adminGovernance1015 = await adminGovernanceLayoutEvidence(
      adminRuntime.page,
      outDir,
      1015,
      898
    );
    report.responsive.adminGovernance390 = await adminGovernanceLayoutEvidence(
      adminRuntime.page,
      outDir,
      390,
      844
    );
    record('admin six-domain roving navigation, reduced motion, 44px hit targets and root width', {
      desktop: report.responsive.adminGovernance1015,
      mobile: report.responsive.adminGovernance390,
    });
    const joinReviewPatches = [];
    adminRuntime.page.on('request', (request) => {
      const resource = new URL(request.url());
      if (request.method() !== 'PATCH' || resource.pathname !== `/api/admin/class-join-requests/${joinRequestId}`) return;
      let body = null;
      try { body = request.postDataJSON(); } catch {}
      joinReviewPatches.push({
        path: resource.pathname,
        base: resource.origin,
        requestId: request.headers()['x-request-id'] || '',
        body,
      });
    });
    await selectAdminSection(adminRuntime.page, 'identity', '[data-admin-panel="join-requests"]');
    const approve = adminRuntime.page.locator(`[data-admin-join-review="approved"][data-join-request-id="${joinRequestId}"]`);
    await approve.waitFor({ state: 'visible' });
    await approve.click();
    assert(joinReviewPatches.length === 0, 'first join approval confirmation must not send PATCH');
    const joinPatchResponse = adminRuntime.page.waitForResponse((response) => {
      const resource = new URL(response.url());
      return response.request().method() === 'PATCH'
        && resource.pathname === `/api/admin/class-join-requests/${joinRequestId}`
        && response.status() === 200;
    }, { timeout: DEFAULT_REQUEST_TIMEOUT_MS });
    await approve.click();
    await joinPatchResponse;
    const joinNotice = adminRuntime.page.locator('[data-admin-notice]').filter({ hasText: /Request ID/u });
    await joinNotice.waitFor({ state: 'visible' });
    await waitForNetworkQuiet(adminRuntime.page, 300);
    assert(joinReviewPatches.length === 1, `join approval expected exactly one PATCH, got ${joinReviewPatches.length}`);
    const joinNoticeText = String(await joinNotice.textContent() || '');
    const joinRequestIdMatch = joinNoticeText.match(/Request ID\s+([a-z0-9-]+)/iu);
    assert(joinRequestIdMatch, `join approval notice did not expose Request ID: ${joinNoticeText}`);
    const joinAuditRequestId = joinRequestIdMatch[1];
    assert(
      joinReviewPatches[0].base === new URL(apiBase).origin
        && joinReviewPatches[0].requestId === joinAuditRequestId
        && JSON.stringify(joinReviewPatches[0].body) === JSON.stringify({
          status: 'approved',
          note: 'reviewed from admin governance UI',
        }),
      `join approval request mismatch: ${JSON.stringify(joinReviewPatches[0])}`
    );

    const approvedPage = await pageApi(
      adminRuntime.page,
      apiBase,
      `/api/admin/class-join-requests?status=approved&class_id=${classId}&user_id=${applicantIdentity.body.id}&role=student&limit=200&offset=0`
    );
    const approvedRow = approvedPage.body && approvedPage.body.items
      && approvedPage.body.items.find((item) => String(item.id) === joinRequestId);
    assert(
      approvedPage.status === 200
        && approvedRow
        && Number(approvedRow.school_id) === Number(schoolId)
        && Number(approvedRow.class_id) === Number(classId)
        && Number(approvedRow.user_id) === Number(applicantIdentity.body.id)
        && approvedRow.role === 'student'
        && approvedRow.status === 'approved',
      `approved join request authority mismatch: ${JSON.stringify(approvedPage)}`
    );
    const approvedMembers = await pageApi(
      adminRuntime.page,
      apiBase,
      `/api/classes/${classId}/members/page?role=student&status=active&limit=200&offset=0`
    );
    const approvedMember = approvedMembers.body && approvedMembers.body.items
      && approvedMembers.body.items.find((item) => (
        Number(item.class_id) === Number(classId)
        && Number(item.user_id) === Number(applicantIdentity.body.id)
        && item.role === 'student'
        && item.status === 'active'
      ));
    assert(approvedMembers.status === 200 && approvedMember, `approved membership authority mismatch: ${JSON.stringify(approvedMembers)}`);
    const joinStats = await pageApi(adminRuntime.page, apiBase, '/api/admin/stats');
    assert(
      joinStats.status === 200
        && Number.isInteger(joinStats.body && joinStats.body.pending_class_join_requests)
        && joinStats.body.pending_class_join_requests >= 0,
      `join approval stats reread failed: ${JSON.stringify(joinStats)}`
    );
    const audit = await pageApi(
      adminRuntime.page,
      apiBase,
      `/api/admin/audit-logs?action=class.join.request.approve&resource_type=class_join_request&resource_id=${joinRequestId}&request_id=${encodeURIComponent(joinAuditRequestId)}&limit=25&offset=0`
    );
    const joinAuditRow = audit.body && audit.body.items && audit.body.items[0];
    const joinAuditSnapshot = joinAuditRow && (
      typeof joinAuditRow.snapshot_json === 'string'
        ? JSON.parse(joinAuditRow.snapshot_json)
        : joinAuditRow.snapshot_json
    );
    assert(
      audit.status === 200
        && audit.body.total === 1
        && joinAuditRow.action === 'class.join.request.approve'
        && joinAuditRow.resource_type === 'class_join_request'
        && String(joinAuditRow.resource_id) === joinRequestId
        && joinAuditRow.request_id === joinAuditRequestId
        && joinAuditRow.event_result === 'success'
        && Number(joinAuditSnapshot.after.class_id) === Number(classId)
        && Number(joinAuditSnapshot.after.user_id) === Number(applicantIdentity.body.id)
        && joinAuditSnapshot.after.role === 'student'
        && joinAuditSnapshot.after.status === 'approved',
      `Admin approval exact audit reconciliation failed: ${JSON.stringify(audit)}`
    );
    const joinFilter = adminRuntime.page.locator('[data-admin-panel-form="join-requests"]');
    await joinFilter.locator('[name="status"]').selectOption('approved');
    await adminRuntime.page.locator('[data-admin-panel="join-requests"] tbody tr')
      .filter({ hasText: joinRequestId })
      .waitFor({ state: 'visible' });
    await selectAdminSection(adminRuntime.page, 'overview', '[data-admin-overview]');
    const pendingStatText = await adminRuntime.page.locator('[data-admin-stats] .admin-kpi').first().locator('strong').textContent();
    assert(
      Number(String(pendingStatText || '').replace(/[^0-9]/gu, '')) === joinStats.body.pending_class_join_requests,
      `join approval stats UI mismatch: ${JSON.stringify({ ui: pendingStatText, api: joinStats.body.pending_class_join_requests })}`
    );
    record('admin double-confirms one join PATCH and reconciles request, member page, stats and exact audit', {
      joinRequestId,
      requestId: joinAuditRequestId,
      patchCount: joinReviewPatches.length,
      approvedUserId: String(approvedMember.user_id),
      pendingCount: joinStats.body.pending_class_join_requests,
      auditTotal: audit.body.total,
    });
    report.adminCourseGovernance = await exerciseAdminCourseGovernance(
      adminRuntime.page,
      apiBase,
      adminCourseFixture,
      outDir
    );
    assert(adminDiagnosticRequests.length === 0, `normal governance prefetched advanced diagnostics: ${JSON.stringify(adminDiagnosticRequests)}`);
    record('admin course draft-to-published governance, exact audit filters and leave-page unknown lock', report.adminCourseGovernance);

    const batchAudit = await pageApi(adminRuntime.page, apiBase, `/api/admin/audit-logs?action=class.student.batch_import&resource_id=${classId}`);
    assert(batchAudit.status === 200 && batchAudit.body && batchAudit.body.total === 1, 'Teacher batch import audit reconciliation failed');
    record('teacher batch import audit is visible to admin', { total: batchAudit.body.total });

    const governedUserId = String(auxiliaryRegistrations.governed.id);
    await selectAdminSection(adminRuntime.page, 'identity', '[data-admin-panel="users"]');
    const governedUserFilter = adminRuntime.page.locator('[data-admin-panel-form="users"]');
    await governedUserFilter.locator('[name="q"]').fill(accounts.governed.username);
    await governedUserFilter.locator('button[type="submit"]').click();
    const governedControls = adminRuntime.page.locator(`[data-admin-user-governance="${governedUserId}"]`);
    await governedControls.waitFor({ state: 'visible' });
    let governedPatchCount = 0;
    const governedPatchBodies = [];
    adminRuntime.page.on('request', (request) => {
      const resource = new URL(request.url());
      if (request.method() !== 'PATCH' || resource.pathname !== `/api/admin/users/${governedUserId}`) return;
      governedPatchCount += 1;
      try { governedPatchBodies.push(request.postDataJSON()); } catch { governedPatchBodies.push(null); }
    });
    await governedControls.locator('[data-admin-user-role]').selectOption('teacher');
    await governedControls.locator('[data-admin-user-status]').selectOption('disabled');
    await governedControls.locator('[data-admin-user-update]').click();
    const governedConfirm = adminRuntime.page.locator(
      `[data-admin-user-governance="${governedUserId}"] [data-admin-user-update][aria-label="再次点击确认用户权限变更"]`
    );
    await governedConfirm.waitFor({ state: 'visible' });
    await governedConfirm.click();
    await adminRuntime.page.locator('[data-admin-notice]').filter({
      hasText: `用户 #${governedUserId} 已更新为 teacher / disabled`,
    }).waitFor({ state: 'visible' });
    assert(governedPatchCount === 1, `admin user governance expected one PATCH, got ${governedPatchCount}`);
    assert(
      JSON.stringify(governedPatchBodies[0]) === JSON.stringify({ role: 'teacher', status: 'disabled' }),
      `admin user governance PATCH body mismatch: ${JSON.stringify(governedPatchBodies[0])}`
    );
    const governedUserPage = await pageApi(
      adminRuntime.page,
      apiBase,
      `/api/admin/users?q=${encodeURIComponent(accounts.governed.username)}&limit=10&offset=0`
    );
    assert(governedUserPage.status === 200 && governedUserPage.body.total === 1, 'governed user authoritative list reread failed');
    assert(
      governedUserPage.body.items[0].role === 'teacher' && governedUserPage.body.items[0].status === 'disabled',
      'governed user authoritative role/status mismatch'
    );
    const governedSessionAfter = await pageApi(governedRuntime.page, apiBase, '/api/users/me');
    assert(governedSessionAfter.status === 401, `governed user session must be revoked, got ${governedSessionAfter.status}`);
    const governedAudit = await pageApi(
      adminRuntime.page,
      apiBase,
      `/api/admin/audit-logs?action=admin.user.update&resource_id=${governedUserId}`
    );
    assert(governedAudit.status === 200 && governedAudit.body.total === 1, 'admin user governance audit reconciliation failed');
    await selectAdminSection(adminRuntime.page, 'audit', '[data-admin-panel="audit-logs"]');
    await adminRuntime.page.locator('[data-admin-panel="audit-logs"] tbody tr')
      .filter({ hasText: 'admin.user.update' })
      .filter({ hasText: governedUserId })
      .first()
      .waitFor({ state: 'visible' });
    record('admin double-confirms user role and status governance with session revocation and audit reread', {
      userId: governedUserId,
      requestCount: governedPatchCount,
      role: 'teacher',
      status: 'disabled',
      revokedSessionStatus: governedSessionAfter.status,
      auditTotal: governedAudit.body.total,
    });

    const organizationPatches = [];
    adminRuntime.page.on('request', (request) => {
      const resource = new URL(request.url());
      if (request.method() !== 'PATCH' || !/^\/api\/admin\/(schools|classes)\/\d+$/.test(resource.pathname)) return;
      let body = null;
      try { body = request.postDataJSON(); } catch {}
      organizationPatches.push({ path: resource.pathname, body });
    });
    const schoolPath = `/api/admin/schools/${schoolId}`;
    const classPath = `/api/admin/classes/${classId}`;

    const activeSchoolPage = await pageApi(adminRuntime.page, apiBase, '/api/admin/schools?status=active&limit=1&offset=0');
    const archivedSchoolPage = await pageApi(adminRuntime.page, apiBase, '/api/admin/schools?status=archived&limit=1&offset=0');
    const activeClassPage = await pageApi(adminRuntime.page, apiBase, '/api/admin/classes?status=active&limit=1&offset=0');
    const archivedClassPage = await pageApi(adminRuntime.page, apiBase, '/api/admin/classes?status=archived&limit=1&offset=0');
    const authoritativeStats = await pageApi(adminRuntime.page, apiBase, '/api/admin/stats');
    const pendingRelationshipPage = await pageApi(adminRuntime.page, apiBase, '/api/admin/class-join-requests?status=pending&limit=1&offset=0');
    const disabledAccountPage = await pageApi(adminRuntime.page, apiBase, '/api/admin/users?status=disabled&limit=1&offset=0');
    const overviewCourses = await pageApi(adminRuntime.page, apiBase, '/api/courses');
    const overviewAudit = await pageApi(adminRuntime.page, apiBase, '/api/admin/audit-logs?limit=10&offset=0');
    assert(authoritativeStats.status === 200, `admin stats reread failed with ${authoritativeStats.status}`);
    assert(
      [pendingRelationshipPage, disabledAccountPage, overviewCourses, overviewAudit].every((response) => response.status === 200),
      'admin business overview authority reread failed'
    );
    await selectAdminSection(adminRuntime.page, 'overview', '[data-admin-overview]');
    await adminRuntime.page.locator('[data-admin-business-overview-state="ready"]').waitFor({ state: 'visible' });
    const businessResources = new Set([
      'class_join_request', 'course', 'user', 'school', 'class',
      'class_member', 'assignment', 'submission',
    ]);
    const expectedRecentBusinessAudits = overviewAudit.body.items.filter((item) => (
      businessResources.has(String(item.resource_type || ''))
      && /^(class\.join\.request\.|course\.status\.|admin\.user\.|admin\.(?:school|class)\.|school\.|class\.|assignment\.|submission\.)/.test(String(item.action || ''))
    )).slice(0, 3);
    const expectedCourseStatuses = overviewCourses.body.reduce((counts, course) => {
      if (Object.prototype.hasOwnProperty.call(counts, course.status)) counts[course.status] += 1;
      return counts;
    }, { draft: 0, published: 0, archived: 0 });
    const businessOverview = await adminRuntime.page.evaluate(() => {
      const numberAt = (selector) => Number(String(document.querySelector(selector)?.textContent || '').replace(/[^0-9]/g, '')) || 0;
      const business = document.querySelector('[data-admin-business-overview]');
      const dataMap = document.querySelector('[data-admin-database-map]');
      return {
        pending: numberAt('[data-admin-overview-kind="pending-relationships"] [data-admin-overview-total]'),
        disabled: numberAt('[data-admin-overview-kind="disabled-accounts"] [data-admin-overview-total]'),
        courses: Object.fromEntries(['draft', 'published', 'archived'].map((status) => [
          status,
          numberAt(`[data-admin-course-status="${status}"]`),
        ])),
        recentAuditActions: Array.from(document.querySelectorAll('[data-admin-recent-audit] strong'))
          .map((element) => String(element.textContent || '').trim()),
        beforeDataMap: Boolean(
          business
          && dataMap
          && (business.compareDocumentPosition(dataMap) & Node.DOCUMENT_POSITION_FOLLOWING)
        ),
      };
    });
    assert(businessOverview.pending === pendingRelationshipPage.body.total, 'pending relationship overview must match authoritative total');
    assert(businessOverview.disabled === disabledAccountPage.body.total, 'disabled account overview must match authoritative total');
    assert(
      JSON.stringify(businessOverview.courses) === JSON.stringify(expectedCourseStatuses),
      `course status overview mismatch: ${JSON.stringify({ actual: businessOverview.courses, expected: expectedCourseStatuses })}`
    );
    assert(
      JSON.stringify(businessOverview.recentAuditActions) === JSON.stringify(expectedRecentBusinessAudits.map((item) => item.action)),
      'recent business audit overview must match the authoritative filtered order'
    );
    assert(businessOverview.beforeDataMap, 'business governance summary must precede the data map');
    record('admin frozen business overview matches pending, disabled, organization, course and audit authority', businessOverview);
    const entityCounts = await adminRuntime.page.evaluate(() => Object.fromEntries(
      Array.from(document.querySelectorAll('[data-admin-database-map] [data-entity]')).map((item) => [
        item.getAttribute('data-entity'),
        Number(String(item.querySelector('strong')?.textContent || '').replace(/[^0-9]/g, '')) || 0,
      ])
    ));
    const entityStatKeys = {
      users: 'total_users',
      schools: 'total_schools',
      classes: 'total_classes',
      courses: 'total_courses',
      assignments: 'total_assignments',
      submissions: 'total_submissions',
      events: 'total_learning_events',
      audits: 'total_audit_logs',
    };
    for (const [entity, statKey] of Object.entries(entityStatKeys)) {
      assert(
        entityCounts[entity] === Number(authoritativeStats.body[statKey] || 0),
        `admin data map ${entity} expected ${authoritativeStats.body[statKey]}, got ${entityCounts[entity]}`
      );
    }
    record('admin full domain data map matches authoritative stats', entityCounts);
    const visualCounts = await adminRuntime.page.evaluate(() => {
      const read = (kind) => Array.from(document.querySelectorAll(`[data-admin-organization-summary-kind="${kind}"] dd`))
        .map((item) => Number(String(item.textContent || '').replace(/[^0-9]/g, '')) || 0);
      return { schools: read('schools'), classes: read('classes') };
    });
    assert(visualCounts.schools[0] === activeSchoolPage.body.total, 'active school visual total must match API');
    assert(visualCounts.schools[1] === archivedSchoolPage.body.total, 'archived school visual total must match API');
    assert(visualCounts.classes[0] === activeClassPage.body.total, 'active class visual total must match API');
    assert(visualCounts.classes[1] === archivedClassPage.body.total, 'archived class visual total must match API');
    record('admin organization status visualization matches authoritative totals', visualCounts);

    await selectAdminSection(adminRuntime.page, 'organizations', '[data-admin-panel="schools"]');
    const schoolRow = adminRuntime.page.locator('[data-admin-panel="schools"] tbody tr').filter({ hasText: schoolName }).first();
    const schoolEditorTrigger = schoolRow.locator('[data-admin-organization-edit]');
    let releaseSchoolRead;
    const schoolReadGate = new Promise((resolve) => { releaseSchoolRead = resolve; });
    await adminRuntime.page.route(`**${schoolPath}`, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await schoolReadGate;
      await route.continue();
    });
    await schoolEditorTrigger.click();
    let organizationDialog = adminRuntime.page.locator('[data-admin-organization-dialog]');
    await organizationDialog.waitFor({ state: 'visible' });
    const loadingFocus = await organizationFocusEvidence(adminRuntime.page, 'busy exact GET', '[data-admin-organization-title]');
    await adminRuntime.page.keyboard.press('Escape');
    assert(await organizationDialog.isVisible(), 'Escape must not close organization dialog during exact GET');
    releaseSchoolRead();
    await organizationDialog.locator('[data-admin-organization-form]').waitFor({ state: 'visible' });
    await adminRuntime.page.unroute(`**${schoolPath}`);
    const loadedFocus = await organizationFocusEvidence(adminRuntime.page, 'completed exact GET', '[data-admin-organization-title]');
    await adminRuntime.page.keyboard.press('Escape');
    await organizationDialog.waitFor({ state: 'hidden' });
    await adminRuntime.page.waitForFunction(() => document.activeElement?.hasAttribute('data-admin-organization-edit'));
    assert(await schoolEditorTrigger.evaluate((element) => document.activeElement === element), 'idle Escape must restore focus to the organization editor trigger');
    record('organization dialog Escape and focus lifecycle', { loadingFocus, loadedFocus, triggerRestored: true });

    organizationDialog = await openOrganizationEditor(adminRuntime.page, 'schools', schoolName);
    const initialSchoolVersion = Number(await organizationDialog.locator('[data-admin-organization-version]').getAttribute('data-admin-organization-version'));
    const schoolForm = organizationDialog.locator('[data-admin-organization-form]');
    const schoolPatchStart = organizationPatches.filter((item) => item.path === schoolPath).length;
    await schoolForm.locator('[name="description"]').fill(`治理说明 ${runId}`);
    await schoolForm.locator('[data-admin-organization-reason]').fill(`E2E 学校治理 ${runId}`);
    await schoolForm.locator('[data-admin-organization-confirm="metadata"]').click();
    await schoolForm.locator('[data-admin-organization-preview]').waitFor({ state: 'visible' });
    assert(organizationPatches.filter((item) => item.path === schoolPath).length === schoolPatchStart, 'first organization confirmation must send zero PATCH requests');
    await schoolForm.locator('[name="region"]').fill('Shanghai Governance');
    await schoolForm.locator('[data-admin-organization-preview]').waitFor({ state: 'detached' });
    await schoolForm.locator('[data-admin-organization-confirm="metadata"]').click();
    await schoolForm.locator('[data-admin-organization-preview]').waitFor({ state: 'visible' });
    assert(organizationPatches.filter((item) => item.path === schoolPath).length === schoolPatchStart, 'changed input must require a fresh zero-write preview');
    const previewFocus = await organizationFocusEvidence(adminRuntime.page, 'school metadata preview', '[data-admin-organization-confirm="metadata"]');
    let releaseSchoolPatch;
    const schoolPatchGate = new Promise((resolve) => { releaseSchoolPatch = resolve; });
    await adminRuntime.page.route(`**${schoolPath}`, async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.continue();
        return;
      }
      await schoolPatchGate;
      await route.continue();
    });
    await schoolForm.locator('[data-admin-organization-confirm="metadata"]').click();
    await schoolForm.waitFor({ state: 'visible' });
    await adminRuntime.page.waitForFunction(() => document.querySelector('[data-admin-organization-form]')?.getAttribute('aria-busy') === 'true');
    const busyPatchFocus = await organizationFocusEvidence(adminRuntime.page, 'busy school PATCH', '[data-admin-organization-title]');
    await adminRuntime.page.keyboard.press('Escape');
    assert(await organizationDialog.isVisible(), 'Escape must not close organization dialog during PATCH reconciliation');
    assert(organizationPatches.filter((item) => item.path === schoolPath).length === schoolPatchStart + 1, 'busy PATCH Escape path must still send exactly one request');
    releaseSchoolPatch();
    await adminRuntime.page.locator('[data-admin-notice]').filter({ hasText: `学校 #${schoolId} 已更新` }).waitFor({ state: 'visible' });
    await adminRuntime.page.unroute(`**${schoolPath}`);
    await organizationDialog.locator(`[data-admin-organization-version="${initialSchoolVersion + 1}"]`).waitFor({ state: 'visible' });
    const successFocus = await organizationFocusEvidence(adminRuntime.page, 'school metadata success', '[data-admin-organization-status]');
    const schoolUiPatches = organizationPatches.filter((item) => item.path === schoolPath).slice(schoolPatchStart);
    assert(schoolUiPatches.length === 1, `school metadata expected exactly one PATCH, got ${schoolUiPatches.length}`);
    assert(
      JSON.stringify(Object.keys(schoolUiPatches[0].body).sort()) === JSON.stringify(['description', 'expected_version', 'reason', 'region']),
      `school PATCH contains unexpected fields: ${JSON.stringify(schoolUiPatches[0].body)}`
    );
    assert(schoolUiPatches[0].body.expected_version === initialSchoolVersion, 'school PATCH must use exact GET version');
    const schoolAudit = await pageApi(adminRuntime.page, apiBase, `/api/admin/audit-logs?action=admin.school.update&resource_id=${schoolId}`);
    assert(schoolAudit.status === 200 && schoolAudit.body.total >= 1, 'school governance audit reconciliation failed');
    record('admin school metadata double-confirm and authoritative reread', {
      versionBefore: initialSchoolVersion,
      versionAfter: initialSchoolVersion + 1,
      patchCount: schoolUiPatches.length,
      auditTotal: schoolAudit.body.total,
      focus: { previewFocus, busyPatchFocus, successFocus },
    });

    const lifecycleVersion = initialSchoolVersion + 1;
    const lifecycleForm = organizationDialog.locator('[data-admin-organization-form]');
    await lifecycleForm.locator('[name="description"]').fill(`生命周期切换不落库 ${runId}`);
    await lifecycleForm.locator('[data-admin-organization-reason]').fill(`E2E 路由生命周期竞态 ${runId}`);
    await lifecycleForm.locator('[data-admin-organization-confirm="metadata"]').click();
    await lifecycleForm.locator('[data-admin-organization-preview]').waitFor({ state: 'visible' });
    const lifecyclePatchStart = organizationPatches.filter((item) => item.path === schoolPath).length;
    let releaseLifecyclePatch;
    let lifecycleRouteOutcome = 'pending';
    const lifecyclePatchGate = new Promise((resolve) => { releaseLifecyclePatch = resolve; });
    adminRuntime.page.__astraExpectedRequestFailurePaths = [{ method: 'PATCH', path: schoolPath }];
    const lifecyclePatchFailure = adminRuntime.page.waitForEvent('requestfailed', {
      predicate: (request) => request.method() === 'PATCH' && new URL(request.url()).pathname === schoolPath,
      timeout: 10000,
    });
    await adminRuntime.page.route(`**${schoolPath}`, async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.continue();
        return;
      }
      await lifecyclePatchGate;
      try {
        await route.abort('connectionreset');
        lifecycleRouteOutcome = 'aborted';
      } catch {
        lifecycleRouteOutcome = 'already-cancelled';
      }
    });
    await lifecycleForm.locator('[data-admin-organization-confirm="metadata"]').click();
    await adminRuntime.page.waitForFunction(() => document.querySelector('[data-admin-organization-form]')?.getAttribute('aria-busy') === 'true');
    assert(
      organizationPatches.filter((item) => item.path === schoolPath).length === lifecyclePatchStart + 1,
      'lifecycle race must send exactly one PATCH before route destroy'
    );

    await adminRuntime.page.evaluate(() => { window.location.hash = 'teacher'; });
    await adminRuntime.page.waitForURL(/#teacher$/);
    await adminRuntime.page.locator('[data-teacher-dashboard]:not([hidden])').waitFor({ state: 'visible' });

    let releaseReentryStats;
    let markReentryStatsStarted;
    const reentryStatsGate = new Promise((resolve) => { releaseReentryStats = resolve; });
    const reentryStatsStarted = new Promise((resolve) => { markReentryStatsStarted = resolve; });
    await adminRuntime.page.route('**/api/admin/stats', async (route) => {
      markReentryStatsStarted();
      await reentryStatsGate;
      await route.continue();
    });
    await adminRuntime.page.evaluate(() => { window.location.hash = 'admin'; });
    await adminRuntime.page.waitForURL(/#admin$/);
    await reentryStatsStarted;
    await adminRuntime.page.locator('[data-admin-governance].is-busy').waitFor({ state: 'visible' });

    releaseLifecyclePatch();
    await lifecyclePatchFailure;
    await adminRuntime.page.waitForTimeout(150);
    const reentryBusyEvidence = await adminRuntime.page.evaluate(() => ({
      rootBusy: document.querySelector('[data-admin-governance]')?.classList.contains('is-busy') === true,
      refreshDisabled: document.querySelector('[data-admin-refresh-control]')?.disabled === true,
    }));
    assert(reentryBusyEvidence.rootBusy, 'old PATCH completion must not clear the re-entered admin lifecycle busy state');
    assert(reentryBusyEvidence.refreshDisabled, 'old PATCH completion must not re-enable controls owned by the new lifecycle');

    releaseReentryStats();
    await adminRuntime.page.unroute('**/api/admin/stats');
    await adminRuntime.page.unroute(`**${schoolPath}`);
    adminRuntime.page.__astraExpectedRequestFailurePaths = [];
    await adminRuntime.page.waitForFunction(() => !document.querySelector('[data-admin-governance]')?.classList.contains('is-busy'));
    await adminRuntime.page.waitForFunction(({ targetId }) => {
      const target = document.querySelector(`[data-admin-organization-edit][data-organization-kind="school"][data-organization-id="${targetId}"]`);
      const other = document.querySelector('[data-admin-organization-edit][data-organization-kind="class"]');
      return Boolean(target && !target.disabled && other && other.disabled);
    }, { targetId: String(schoolId) });

    organizationDialog = await openOrganizationEditor(adminRuntime.page, 'schools', schoolName);
    await organizationDialog.locator('[data-admin-organization-lock]').waitFor({ state: 'visible' });
    await organizationDialog.locator('[data-admin-organization-reconcile]').waitFor({ state: 'visible' });
    assert(
      Number(await organizationDialog.locator('[data-admin-organization-version]').getAttribute('data-admin-organization-version')) === lifecycleVersion,
      'destroyed lifecycle PATCH must not silently change the authoritative resource'
    );
    const lifecyclePatchBeforeReconcile = organizationPatches.filter((item) => item.path === schoolPath).length;
    await organizationDialog.locator('[data-admin-organization-reconcile]').click();
    await organizationDialog.locator('[data-admin-organization-unlock]').waitFor({ state: 'visible' });
    assert(
      organizationPatches.filter((item) => item.path === schoolPath).length === lifecyclePatchBeforeReconcile,
      'new lifecycle reconciliation must not resend the destroyed PATCH'
    );
    await organizationDialog.locator('[data-admin-organization-unlock]').click();
    await organizationDialog.locator('[data-admin-organization-status]').filter({ hasText: '人工解除锁定' }).waitFor({ state: 'visible' });
    record('in-flight PATCH route destroy preserves lock across admin re-entry', {
      version: lifecycleVersion,
      patchCount: organizationPatches.filter((item) => item.path === schoolPath).length - lifecyclePatchStart,
      routeOutcome: lifecycleRouteOutcome,
      reentryBusyEvidence,
      reconciledWithoutReplay: true,
    });
    await closeOrganizationEditor(organizationDialog);

    organizationDialog = await openOrganizationEditor(adminRuntime.page, 'schools', schoolName);
    const mismatchVersion = initialSchoolVersion + 1;
    const mismatchForm = organizationDialog.locator('[data-admin-organization-form]');
    await mismatchForm.locator('[name="description"]').fill(`伪成功未落库 ${runId}`);
    await mismatchForm.locator('[data-admin-organization-reason]').fill(`E2E 2xx 权威不一致 ${runId}`);
    await mismatchForm.locator('[data-admin-organization-confirm="metadata"]').click();
    await mismatchForm.locator('[data-admin-organization-preview]').waitFor({ state: 'visible' });
    let mismatchPatchCount = 0;
    await adminRuntime.page.route(`**${schoolPath}`, async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.continue();
        return;
      }
      mismatchPatchCount += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: Number(schoolId), version: mismatchVersion, status: 'active' }),
      });
    });
    await mismatchForm.locator('[data-admin-organization-confirm="metadata"]').click();
    await organizationDialog.locator('[data-admin-organization-unlock]').waitFor({ state: 'visible' });
    await organizationDialog.locator('[data-admin-organization-status]').filter({ hasText: '精确权威资源不是预期的 version+1' }).waitFor({ state: 'visible' });
    const mismatchFocus = await organizationFocusEvidence(adminRuntime.page, '2xx authority mismatch', '[data-admin-organization-unlock]');
    assert(Number(await organizationDialog.locator('[data-admin-organization-version]').getAttribute('data-admin-organization-version')) === mismatchVersion, '2xx mismatch must retain the unchanged authority version');
    assert(mismatchPatchCount === 1, `2xx mismatch expected exactly one PATCH, got ${mismatchPatchCount}`);
    await adminRuntime.page.waitForTimeout(300);
    assert(mismatchPatchCount === 1, '2xx mismatch must not retry PATCH');
    assert(!String(await adminRuntime.page.locator('[data-admin-notice]').textContent()).includes('已更新，权威资源'), '2xx mismatch must not claim governance success');
    await adminRuntime.page.unroute(`**${schoolPath}`);
    await organizationDialog.locator('[data-admin-organization-unlock]').click();
    await organizationDialog.locator('[data-admin-organization-status]').filter({ hasText: '人工解除锁定' }).waitFor({ state: 'visible' });
    record('2xx response with unchanged authority remains locked without retry', {
      authorityVersion: mismatchVersion,
      patchCount: mismatchPatchCount,
      focus: mismatchFocus,
    });
    await closeOrganizationEditor(organizationDialog);

    organizationDialog = await openOrganizationEditor(adminRuntime.page, 'classes', className);
    const classForm = organizationDialog.locator('[data-admin-organization-form]');
    const classVersion = Number(await organizationDialog.locator('[data-admin-organization-version]').getAttribute('data-admin-organization-version'));
    await classForm.locator('[name="grade"]').fill('11');
    await classForm.locator('[data-admin-organization-reason]').fill(`E2E 冲突草稿 ${runId}`);
    await classForm.locator('[data-admin-organization-confirm="metadata"]').click();
    await classForm.locator('[data-admin-organization-preview]').waitFor({ state: 'visible' });
    const concurrentClass = await pageApi(adminRuntime.page, apiBase, classPath, {
      method: 'PATCH',
      body: { expected_version: classVersion, reason: `E2E 并发推进 ${runId}`, term: `2026B-${runId}` },
    });
    assert(concurrentClass.status === 200, `concurrent class update expected 200, got ${concurrentClass.status}`);
    adminRuntime.page.__astraExpectedHttpResponses = [{ method: 'PATCH', status: 409, path: classPath }];
    const classPatchBeforeConflict = organizationPatches.filter((item) => item.path === classPath).length;
    await classForm.locator('[data-admin-organization-confirm="metadata"]').click();
    await organizationDialog.locator('.admin-organization-alert').filter({ hasText: '检测到版本冲突' }).waitFor({ state: 'visible' });
    await organizationDialog.locator(`[data-admin-organization-version="${classVersion + 1}"]`).waitFor({ state: 'visible' });
    assert(await organizationDialog.locator('[name="grade"]').inputValue() === '11', '409 reconciliation must preserve user draft');
    assert(organizationPatches.filter((item) => item.path === classPath).length === classPatchBeforeConflict + 1, '409 flow must send one UI PATCH');
    await adminRuntime.page.waitForTimeout(300);
    assert(organizationPatches.filter((item) => item.path === classPath).length === classPatchBeforeConflict + 1, '409 flow must not retry PATCH');
    adminRuntime.page.__astraExpectedHttpResponses = [];
    record('admin organization 409 conflict rereads authority without retry', {
      staleVersion: classVersion,
      authorityVersion: classVersion + 1,
      uiPatchCount: 1,
    });
    markTargetReleaseCheck('organization_stale_version_409');
    await closeOrganizationEditor(organizationDialog);

    organizationDialog = await openOrganizationEditor(adminRuntime.page, 'classes', className);
    let governedClassVersion = Number(await organizationDialog.locator('[data-admin-organization-version]').getAttribute('data-admin-organization-version'));
    let governedClassForm = organizationDialog.locator('[data-admin-organization-form]');
    await governedClassForm.locator('[data-admin-organization-reason]').fill(`E2E 归档班级 ${runId}`);
    const classPatchBeforeArchive = organizationPatches.filter((item) => item.path === classPath).length;
    await governedClassForm.locator('[data-admin-organization-confirm="status"]').click();
    await governedClassForm.locator('[data-admin-organization-preview]').waitFor({ state: 'visible' });
    assert(organizationPatches.filter((item) => item.path === classPath).length === classPatchBeforeArchive, 'class archive preview must send zero PATCH requests');
    await governedClassForm.locator('[data-admin-organization-confirm="status"]').click();
    await adminRuntime.page.locator('[data-admin-notice]').filter({ hasText: `班级 #${classId} 已更新` }).waitFor({ state: 'visible' });
    await organizationDialog.locator(`[data-admin-organization-version="${governedClassVersion + 1}"]`).waitFor({ state: 'visible' });
    await organizationDialog.locator('[data-admin-organization-readonly="archived"]').waitFor({ state: 'visible' });
    const archivedFocus = await organizationFocusEvidence(adminRuntime.page, 'class archive success', '[data-admin-organization-status]');
    const archiveVisual = await organizationDialog.evaluate((dialog) => {
      const badge = dialog.querySelector('[data-admin-organization-readonly="archived"] .admin-status-pill');
      const restore = dialog.querySelector('[data-admin-organization-confirm="status"]');
      const style = restore && getComputedStyle(restore);
      const box = restore && restore.getBoundingClientRect();
      return {
        badgeText: String(badge && badge.textContent || '').trim(),
        restoreText: String(restore && restore.textContent || '').trim(),
        restoreClass: String(restore && restore.className || ''),
        restoreColor: style && style.color,
        restoreWidth: box && box.width,
        restoreHeight: box && box.height,
      };
    });
    assert(archiveVisual.badgeText.includes('已归档 · 教学只读'), `archived organization wording missing: ${JSON.stringify(archiveVisual)}`);
    assert(archiveVisual.restoreText.includes('恢复') && archiveVisual.restoreClass.includes('admin-icon-button--restore'), 'archived organization must expose the green restore action');
    assert(archiveVisual.restoreColor === 'rgb(191, 245, 213)', `restore action must use the green semantic color, got ${archiveVisual.restoreColor}`);
    assert(archiveVisual.restoreWidth >= 44 && archiveVisual.restoreHeight >= 44, 'restore action must be at least 44x44');
    const archivePatches = organizationPatches.filter((item) => item.path === classPath).slice(classPatchBeforeArchive);
    assert(archivePatches.length === 1 && archivePatches[0].body.status === 'archived', 'class archive must send one constrained status PATCH');
    const archivedClassStats = await pageApi(adminRuntime.page, apiBase, `/api/admin/classes/${classId}/stats`);
    assert(archivedClassStats.status === 200, 'archived class history statistics must remain readable');
    const classArchiveAudit = await pageApi(adminRuntime.page, apiBase, `/api/admin/audit-logs?action=admin.class.archive&resource_id=${classId}`);
    assert(classArchiveAudit.status === 200 && classArchiveAudit.body.total >= 1, 'class archive audit must exist');
    await teacherRuntime.page.locator('[data-teacher-action="refresh"]').click();
    await teacherRuntime.page.locator('[data-teacher-scope="classId"] option:checked').filter({ hasText: 'archived' }).waitFor({ state: 'attached' });
    assert(await teacherRuntime.page.locator('[data-teacher-form="student-batch-import"] button[type="submit"]').isDisabled(), 'archived class must disable teacher membership writes');
    assert(await teacherRuntime.page.locator('[data-teacher-form="grade"] button[type="submit"]').isDisabled(), 'archived class must disable teacher grading writes');
    assert(await teacherRuntime.page.locator('[data-teacher-form="assignment-class-policy"] button[type="submit"]').isDisabled(), 'archived class must disable teacher assignment-class-policy PUT');
    assert(await teacherRuntime.page.locator('[data-teacher-class-policy-reset]').isDisabled(), 'archived class must disable teacher assignment-class-policy DELETE');

    governedClassVersion += 1;
    governedClassForm = organizationDialog.locator('[data-admin-organization-form]');
    await governedClassForm.locator('[data-admin-organization-reason]').fill(`E2E 恢复班级 ${runId}`);
    const classPatchBeforeRestore = organizationPatches.filter((item) => item.path === classPath).length;
    await governedClassForm.locator('[data-admin-organization-confirm="status"]').click();
    await governedClassForm.locator('[data-admin-organization-preview]').waitFor({ state: 'visible' });
    assert(organizationPatches.filter((item) => item.path === classPath).length === classPatchBeforeRestore, 'class restore preview must send zero PATCH requests');
    await governedClassForm.locator('[data-admin-organization-confirm="status"]').click();
    await organizationDialog.locator(`[data-admin-organization-version="${governedClassVersion + 1}"]`).waitFor({ state: 'visible' });
    await organizationDialog.locator('[data-admin-organization-readonly="active"]').waitFor({ state: 'visible' });
    const restoredFocus = await organizationFocusEvidence(adminRuntime.page, 'class restore success', '[data-admin-organization-status]');
    const restorePatches = organizationPatches.filter((item) => item.path === classPath).slice(classPatchBeforeRestore);
    assert(restorePatches.length === 1 && restorePatches[0].body.status === 'active', 'class restore must send one constrained status PATCH');
    const classRestoreAudit = await pageApi(adminRuntime.page, apiBase, `/api/admin/audit-logs?action=admin.class.restore&resource_id=${classId}`);
    assert(classRestoreAudit.status === 200 && classRestoreAudit.body.total >= 1, 'class restore audit must exist');
    await teacherRuntime.page.locator('[data-teacher-action="refresh"]').click();
    await teacherRuntime.page.waitForFunction(({ expectedClassName }) => {
      const selected = document.querySelector('[data-teacher-scope="classId"] option:checked');
      const membershipWrite = document.querySelector('[data-teacher-form="student-batch-import"] button[type="submit"]');
      const policyWrite = document.querySelector('[data-teacher-form="assignment-class-policy"] button[type="submit"]');
      const policyReset = document.querySelector('[data-teacher-class-policy-reset]');
      return selected
        && String(selected.textContent || '').includes(expectedClassName)
        && !String(selected.textContent || '').includes('archived')
        && membershipWrite
        && !membershipWrite.disabled
        && policyWrite
        && !policyWrite.disabled
        && policyReset
        && !policyReset.disabled;
    }, { expectedClassName: className });
    assert(!(await teacherRuntime.page.locator('[data-teacher-form="student-batch-import"] button[type="submit"]').isDisabled()), 'restored class must re-enable eligible teacher membership writes');
    record('admin archives and restores class with historical read and teacher readonly boundary', {
      archivePatchCount: archivePatches.length,
      restorePatchCount: restorePatches.length,
      archivedStatsStatus: archivedClassStats.status,
      archiveAuditTotal: classArchiveAudit.body.total,
      restoreAuditTotal: classRestoreAudit.body.total,
      archiveVisual,
      focus: { archivedFocus, restoredFocus },
    });
    markTargetReleaseCheck('organization_archive');
    markTargetReleaseCheck('organization_restore');
    await closeOrganizationEditor(organizationDialog);

    organizationDialog = await openOrganizationEditor(adminRuntime.page, 'schools', schoolName);
    let currentSchoolVersion = Number(await organizationDialog.locator('[data-admin-organization-version]').getAttribute('data-admin-organization-version'));
    let currentSchoolForm = organizationDialog.locator('[data-admin-organization-form]');
    await currentSchoolForm.locator('[name="description"]').fill(`响应丢失但已落库 ${runId}`);
    await currentSchoolForm.locator('[data-admin-organization-reason]').fill(`E2E 未知结果已生效 ${runId}`);
    await currentSchoolForm.locator('[data-admin-organization-confirm="metadata"]').click();
    let appliedUnknownCount = 0;
    adminRuntime.page.__astraExpectedRequestFailurePaths = [{ method: 'PATCH', path: schoolPath }];
    await adminRuntime.page.route(`**${schoolPath}`, async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.continue();
        return;
      }
      appliedUnknownCount += 1;
      await route.fetch();
      await route.abort('connectionreset');
    });
    await currentSchoolForm.locator('[data-admin-organization-confirm="metadata"]').click();
    await adminRuntime.page.locator('[data-admin-notice]').filter({ hasText: '已由权威回读确认生效' }).waitFor({ state: 'visible' });
    await organizationDialog.locator(`[data-admin-organization-version="${currentSchoolVersion + 1}"]`).waitFor({ state: 'visible' });
    const appliedUnknownFocus = await organizationFocusEvidence(adminRuntime.page, 'applied unknown reconciliation', '[data-admin-organization-status]');
    assert(appliedUnknownCount === 1, `applied unknown result expected one PATCH, got ${appliedUnknownCount}`);
    await adminRuntime.page.unroute(`**${schoolPath}`);
    adminRuntime.page.__astraExpectedRequestFailurePaths = [];
    record('unknown response with committed mutation resolves by exact GET without retry', {
      patchCount: appliedUnknownCount,
      versionBefore: currentSchoolVersion,
      versionAfter: currentSchoolVersion + 1,
      focus: appliedUnknownFocus,
    });

    currentSchoolVersion += 1;
    currentSchoolForm = organizationDialog.locator('[data-admin-organization-form]');
    await currentSchoolForm.locator('[name="description"]').fill(`响应丢失且未落库 ${runId}`);
    await currentSchoolForm.locator('[data-admin-organization-reason]').fill(`E2E 未知结果未生效 ${runId}`);
    await currentSchoolForm.locator('[data-admin-organization-confirm="metadata"]').click();
    let unappliedUnknownCount = 0;
    adminRuntime.page.__astraExpectedRequestFailurePaths = [{ method: 'PATCH', path: schoolPath }];
    await adminRuntime.page.route(`**${schoolPath}`, async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.continue();
        return;
      }
      unappliedUnknownCount += 1;
      await route.abort('connectionreset');
    });
    await currentSchoolForm.locator('[data-admin-organization-confirm="metadata"]').click();
    await organizationDialog.locator('[data-admin-organization-unlock]').waitFor({ state: 'visible' });
    assert(unappliedUnknownCount === 1, `unapplied unknown result expected one PATCH, got ${unappliedUnknownCount}`);
    await adminRuntime.page.unroute(`**${schoolPath}`);
    adminRuntime.page.__astraExpectedRequestFailurePaths = [];
    const lockedFocus = await organizationFocusEvidence(adminRuntime.page, 'unapplied unknown reconciliation', '[data-admin-organization-unlock]');
    const patchCountBeforeManualReconcile = organizationPatches.filter((item) => item.path === schoolPath).length;
    await organizationDialog.locator('[data-admin-organization-reconcile]').click();
    await organizationDialog.locator('[data-admin-organization-unlock]').waitFor({ state: 'visible' });
    const manualReconcileFocus = await organizationFocusEvidence(adminRuntime.page, 'manual authoritative reconciliation', '[data-admin-organization-unlock]');
    assert(organizationPatches.filter((item) => item.path === schoolPath).length === patchCountBeforeManualReconcile, 'manual reconciliation must not resend PATCH');
    await organizationDialog.locator('[data-admin-organization-unlock]').click();
    await organizationDialog.locator('.admin-organization-alert').filter({ hasText: '人工解除锁定' }).waitFor({ state: 'visible' });
    const patchCountBeforeFreshPreview = organizationPatches.filter((item) => item.path === schoolPath).length;
    await organizationDialog.locator('[data-admin-organization-confirm="metadata"]').click();
    await organizationDialog.locator('[data-admin-organization-preview]').waitFor({ state: 'visible' });
    assert(organizationPatches.filter((item) => item.path === schoolPath).length === patchCountBeforeFreshPreview, 'manual unlock must require a fresh zero-write preview');
    report.responsive.adminOrganization = await adminOrganizationResponsiveEvidence(adminRuntime.page, outDir);
    record('unapplied unknown result remains locked until explicit reconciliation', {
      patchCount: unappliedUnknownCount,
      version: currentSchoolVersion,
      focus: { lockedFocus, manualReconcileFocus },
    });
    await closeOrganizationEditor(organizationDialog);
    await adminRuntime.page.setViewportSize({ width: 1440, height: 1000 });
    report.advancedDiagnostics = await exerciseAdvancedLazyLoading(
      adminRuntime.page,
      adminDiagnosticRequests
    );
    record('admin advanced diagnostics remain zero before first entry and release focus on Escape', report.advancedDiagnostics);

    const outsiderRuntime = await createRolePage(browser, report, webBase, apiBase, 'student');
    contexts.push(outsiderRuntime.context);
    await registerFromUi(outsiderRuntime.page, 'student', accounts.outsider);
    const outsiderIdentity = await pageApi(outsiderRuntime.page, apiBase, '/api/users/me');
    assert(outsiderIdentity.status === 200, 'outsider identity reread failed');
    report.accounts.outsider = { username: accounts.outsider.username, id: String(outsiderIdentity.body.id) };
    const outsiderReview = await pageApi(outsiderRuntime.page, apiBase, `/api/assignments/${assignmentId}/review`);
    assert(outsiderReview.status === 403, `Outsider assignment review expected 403, got ${outsiderReview.status}`);
    record('outsider assignment denial', { status: outsiderReview.status });
    markTargetReleaseCheck('unauthorized_requests_denied');

    await studentRuntime.page.goto(roleUrl(webBase, apiBase, 'teacher'), { waitUntil: 'domcontentloaded' });
    await studentRuntime.page.waitForURL(/#planets$/);
    const deniedRoleScripts = await studentRuntime.page.locator('script[data-router-page-script="teacher"], script[data-router-page-script="admin"]').count();
    const deniedRoleStyles = await studentRuntime.page.evaluate(() => Array.from(
      document.querySelectorAll('link[data-astra-role-resource]')
    ).filter((node) => /\/pages\/(teacher|admin)\//.test(new URL(node.href).pathname)).length);
    assert(deniedRoleScripts === 0 && deniedRoleStyles === 0, 'Student must not load teacher or admin page resources');
    await studentRuntime.page.locator('#page-planets.page.active').waitFor({ state: 'visible' });
    record('role shell falls back to planets before protected CSS or script load', {
      forbiddenScripts: deniedRoleScripts,
      forbiddenStyles: deniedRoleStyles,
    });
    markTargetReleaseCheck('role_navigation_isolation');
    markTargetReleaseCheck('role_resource_isolation');
    await studentRuntime.page.goto(roleUrl(webBase, apiBase, 'student'), { waitUntil: 'domcontentloaded' });
    await studentRuntime.page.locator('[data-auth-ui="account"][data-auth-role="student"]').waitFor({ state: 'visible' });

    report.stableUi.desktop = {
      student: await stableUiEvidence(studentRuntime.page, 'student'),
      teacher: await stableUiEvidence(teacherRuntime.page, 'teacher'),
      admin: await stableUiEvidence(adminRuntime.page, 'admin'),
    };
    record('three-role desktop stable UI has no visible error or stuck loading state', report.stableUi.desktop);

    report.responsive.student = await responsiveEvidence(studentRuntime.page, 'student', outDir, { assignmentId });
    report.responsive.teacher = await responsiveEvidence(teacherRuntime.page, 'teacher', outDir);
    report.responsive.admin = await responsiveEvidence(adminRuntime.page, 'admin', outDir);
    assert(report.responsive.adminOrganization, 'Admin organization responsive evidence is missing');
    markTargetReleaseCheck('no_horizontal_overflow');
    record('three-role 390x844 responsive evidence');

    await studentRuntime.page.setViewportSize({ width: 1440, height: 1000 });
    const desktopScreenshot = path.join(outDir, 'student-feedback-desktop.png');
    await studentRuntime.page.screenshot({ path: desktopScreenshot, fullPage: true });
    report.responsive.desktopScreenshot = desktopScreenshot;

    await freezeDiagnostics(contexts);
    const browserAuthorizationHeaderPages = contexts.flatMap((context) => context.pages())
      .filter((page) => page.__astraBrowserAuthorizationHeaderSeen === true);
    assert(browserAuthorizationHeaderPages.length === 0, 'Browser role workflows must not send Authorization headers');
    assert(report.browserIssues.length === 0, `Browser issues detected: ${JSON.stringify(report.browserIssues)}`);
    assert(!report.browserIssues.some((issue) => issue.kind === 'console'), 'Browser console diagnostics must remain clean');
    assert(!report.browserIssues.some((issue) => issue.kind === 'pageerror'), 'Browser page errors must remain clean');
    markTargetReleaseCheck('no_console_errors');
    markTargetReleaseCheck('no_page_errors');
    record('browser console and request diagnostics clean');
    workflowCompleted = true;
  } catch (error) {
    report.failure = {
      message: watchdogExpired
        ? `QA-007 workflow watchdog exceeded ${workflowTimeoutMs}ms`
        : String(error && error.message || error),
      stack: String(error && error.stack || '').split('\n').slice(0, 12),
    };
  } finally {
    if (watchdogTimer) clearTimeout(watchdogTimer);
    for (const context of contexts.reverse()) {
      try { await context.close(); } catch {}
    }
    if (browser) {
      try { await browser.close(); } catch {}
    }
    report.ok = Boolean(workflowCompleted && !watchdogExpired && !report.failure && report.browserIssues.length === 0);
    report.completedAt = new Date().toISOString();
    let targetBrowserEvidence = null;
    if (report.ok && targetMode) {
      try {
        targetBrowserEvidence = buildTargetBrowserEvidence(report);
      } catch (error) {
        report.ok = false;
        report.failure = {
          message: String(error && error.message || error),
          stack: String(error && error.stack || '').split('\n').slice(0, 12),
        };
      }
    }
    if (proofDirectoryReady) {
      await fs.writeFile(path.join(outDir, 'role-workflows-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      if (targetBrowserEvidence) {
        await fs.writeFile(
          path.join(outDir, TARGET_BROWSER_EVIDENCE_FILENAME),
          `${JSON.stringify(targetBrowserEvidence, null, 2)}\n`,
          'utf8'
        );
      }
    }
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main();
