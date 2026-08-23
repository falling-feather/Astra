#!/usr/bin/env node

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const DEFAULT_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_CONTRACT = path.join(
    DEFAULT_ROOT,
    'tools/templates/new-experiment/browser-journey.contract.json'
);
const DEFAULT_DEBUG_CONTRACT = path.join(
    DEFAULT_ROOT,
    'tools/templates/new-experiment/debug-panel.contract.json'
);
const DEBUG_PANEL_SCRIPT = path.join(__dirname, 'new-experiment-debug-panel.js');
const SERIOUS_CONSOLE_TYPES = new Set(['warning', 'warn', 'error']);

function parseArgs(argv) {
    const parsed = {};
    for (let index = 0; index < argv.length; index += 1) {
        const item = argv[index];
        if (!item.startsWith('--')) throw new Error('Unexpected argument: ' + item);
        const name = item.slice(2);
        const next = argv[index + 1];
        if (!next || next.startsWith('--')) {
            parsed[name] = true;
        } else {
            parsed[name] = next;
            index += 1;
        }
    }
    return parsed;
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadContract(file = DEFAULT_CONTRACT) {
    return readJson(path.resolve(file));
}

function loadDebugContract(file = DEFAULT_DEBUG_CONTRACT) {
    return readJson(path.resolve(file));
}

function normalizeDebugHold(value) {
    if (value === undefined || value === null || value === '') return 0;
    if (typeof value === 'boolean') {
        throw new Error('--debug-hold requires an integer number of milliseconds');
    }
    const milliseconds = Number(value);
    if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > 3600000) {
        throw new Error('--debug-hold must be an integer from 0 to 3600000 milliseconds');
    }
    return milliseconds;
}

function stripQuery(value) {
    return String(value || '').split(/[?#]/, 1)[0];
}

function insideRoot(root, file) {
    const repositoryRoot = path.resolve(root);
    const absolute = path.resolve(file);
    const prefix = repositoryRoot.endsWith(path.sep)
        ? repositoryRoot
        : repositoryRoot + path.sep;
    return absolute === repositoryRoot || absolute.startsWith(prefix);
}

function resolveLocalResource(root, value, label) {
    const relative = stripQuery(value).replaceAll('/', path.sep);
    if (!relative || path.isAbsolute(relative)) {
        throw new Error(label + ' must be a repository-relative path');
    }
    const absolute = path.resolve(root, relative);
    if (!insideRoot(root, absolute)) {
        throw new Error(label + ' escapes the selected root: ' + value);
    }
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
        throw new Error(label + ' is missing: ' + value);
    }
    return absolute;
}

function loadCandidate(options = {}) {
    const root = path.resolve(options.root || DEFAULT_ROOT);
    if (!options.manifest) throw new Error('--manifest is required');
    const manifestFile = path.resolve(options.manifest);
    if (!insideRoot(root, manifestFile)) {
        throw new Error('manifest escapes the selected root');
    }
    const manifest = readJson(manifestFile);
    if (/__[A-Z0-9_]+__/.test(JSON.stringify(manifest))) {
        throw new Error('manifest contains unresolved template placeholders');
    }
    const requiredStrings = [
        'subject',
        'id',
        'activity_key',
        'owner',
        'init_hook',
        'module',
        'script',
        'style'
    ];
    for (const field of requiredStrings) {
        if (typeof manifest[field] !== 'string' || !manifest[field].trim()) {
            throw new Error('manifest.' + field + ' is required');
        }
    }
    if (manifest.activity_key !== manifest.subject + '.' + manifest.id) {
        throw new Error('manifest.activity_key does not match subject and id');
    }
    if (manifest.registration_state !== 'candidate-unregistered') {
        throw new Error('isolated journey only accepts candidate-unregistered experiments');
    }
    const moduleFile = options.module
        ? path.resolve(options.module)
        : resolveLocalResource(root, manifest.module, 'manifest.module');
    if (!insideRoot(root, moduleFile) || !fs.existsSync(moduleFile)) {
        throw new Error('module file is outside the selected root or missing');
    }
    const candidateDirectory = path.dirname(manifestFile);
    const scriptFile = resolveLocalResource(root, manifest.script, 'manifest.script');
    const styleFile = resolveLocalResource(root, manifest.style, 'manifest.style');
    for (const [label, file] of [
        ['manifest.module', moduleFile],
        ['manifest.script', scriptFile],
        ['manifest.style', styleFile]
    ]) {
        if (!insideRoot(candidateDirectory, file)) {
            throw new Error(label + ' must stay inside the candidate directory');
        }
    }
    const candidate = {
        root,
        candidateDirectory,
        manifestFile,
        manifest,
        moduleFile,
        scriptFile,
        styleFile,
        moduleSource: fs.readFileSync(moduleFile, 'utf8')
    };
    if (candidate.moduleSource.includes('</template>')) {
        throw new Error('candidate module may not close the isolated harness template element');
    }
    const exactModule = 'data-module="' + manifest.id + '"';
    if (!candidate.moduleSource.includes(exactModule)) {
        throw new Error('candidate module does not expose ' + exactModule);
    }
    return Object.freeze(candidate);
}

function harnessScript(candidate, contract) {
    const manifest = candidate.manifest;
    const ownerName = JSON.stringify(manifest.owner);
    const initHook = JSON.stringify(manifest.init_hook);
    const hostId = JSON.stringify('page-' + manifest.subject);
    const moduleSelector = JSON.stringify('[data-module="' + manifest.id + '"]');
    const ownerReferences = JSON.stringify(
        contract.resource_release.owner_references_null
    );
    return [
        '(() => {',
        "  'use strict';",
        '  const metrics = { activeFrames: new Set(), activeObservers: new Set(), framesCreated: 0, framesExecuted: 0, observersCreated: 0, lastFrameTime: 0, lastFrameIntervalMs: 0, fpsWindowStart: 0, fpsWindowFrames: 0, framesPerSecond: 0 };',
        '  const nativeRequest = window.requestAnimationFrame.bind(window);',
        '  const nativeCancel = window.cancelAnimationFrame.bind(window);',
        '  window.requestAnimationFrame = (callback) => {',
        '    let frame = 0;',
        '    frame = nativeRequest((time) => {',
        '      metrics.activeFrames.delete(frame);',
        '      metrics.framesExecuted += 1;',
        '      if (metrics.lastFrameTime) metrics.lastFrameIntervalMs = Math.max(0, time - metrics.lastFrameTime);',
        '      metrics.lastFrameTime = time;',
        '      if (!metrics.fpsWindowStart) metrics.fpsWindowStart = time;',
        '      metrics.fpsWindowFrames += 1;',
        '      const fpsElapsed = time - metrics.fpsWindowStart;',
        '      if (fpsElapsed >= 250) {',
        '        metrics.framesPerSecond = metrics.fpsWindowFrames * 1000 / fpsElapsed;',
        '        metrics.fpsWindowStart = time;',
        '        metrics.fpsWindowFrames = 0;',
        '      }',
        '      callback(time);',
        '    });',
        '    metrics.activeFrames.add(frame);',
        '    metrics.framesCreated += 1;',
        '    return frame;',
        '  };',
        '  window.cancelAnimationFrame = (frame) => { metrics.activeFrames.delete(frame); nativeCancel(frame); };',
        '  const NativeResizeObserver = window.ResizeObserver;',
        '  window.ResizeObserver = class TrackedResizeObserver {',
        '    constructor(callback) { this.inner = new NativeResizeObserver(callback); this.active = false; metrics.observersCreated += 1; }',
        '    observe(target, options) { this.inner.observe(target, options); this.active = true; metrics.activeObservers.add(this); }',
        '    unobserve(target) { this.inner.unobserve(target); }',
        '    disconnect() { this.inner.disconnect(); this.active = false; metrics.activeObservers.delete(this); }',
        '  };',
        '  const ownerName = ' + ownerName + ';',
        '  const initHook = ' + initHook + ';',
        '  const host = () => document.getElementById(' + hostId + ');',
        "  const template = () => document.getElementById('candidate-template');",
        '  const ownerRefs = ' + ownerReferences + ';',
        '  const moduleSelector = ' + moduleSelector + ';',
        '  const metricsSnapshot = () => ({',
        '    activeAnimationFrames: metrics.activeFrames.size,',
        '    activeResizeObservers: metrics.activeObservers.size,',
        '    framesCreated: metrics.framesCreated,',
        '    framesExecuted: metrics.framesExecuted,',
        '    lastFrameIntervalMs: metrics.lastFrameIntervalMs,',
        '    framesPerSecond: metrics.framesPerSecond,',
        '    observersCreated: metrics.observersCreated',
        '  });',
        '  const ownerState = () => {',
        '    const owner = window[ownerName];',
        '    if (!owner) return null;',
        '    const references = Object.fromEntries(ownerRefs.map((name) => [name, owner[name] === null]));',
        '    let snapshot = null;',
        "    try { snapshot = typeof owner.snapshot === 'function' ? owner.snapshot() : null; } catch (error) { snapshot = { error: error.message }; }",
        '    return { references, frame: Number(owner.frame || 0), snapshot };',
        '  };',
        '  const fingerprint = (canvas) => {',
        "    if (!canvas || typeof canvas.toDataURL !== 'function') return { length: 0, checksum: 0 };",
        "    const value = canvas.toDataURL('image/png');",
        '    let checksum = 0;',
        '    for (let index = 0; index < value.length; index += Math.max(1, Math.floor(value.length / 256))) {',
        '      checksum = (checksum * 33 + value.charCodeAt(index)) >>> 0;',
        '    }',
        '    return { length: value.length, checksum };',
        '  };',
        '  window.__newExperimentAcceptance = {',
        '    mount() {',
        '      const target = host();',
        '      target.replaceChildren(template().content.cloneNode(true));',
        '      const init = window[initHook];',
        "      return typeof init === 'function' ? init() !== false : false;",
        '    },',
        '    leave() {',
        '      const debugPanel = window.AstraNewExperimentDebugPanel || null;',
        '      debugPanel?.destroy?.();',
        '      const owner = window[ownerName];',
        '      const oldSignal = owner && owner.controls ? owner.controls.signal : null;',
        "      if (owner && typeof owner.destroy === 'function') owner.destroy();",
        '      host().replaceChildren();',
        '      return {',
        '        signalAborted: Boolean(oldSignal && oldSignal.aborted),',
        '        moduleRemoved: !document.querySelector(moduleSelector),',
        '        owner: ownerState(),',
        '        metrics: metricsSnapshot(),',
        '        debugPanel: {',
        '          exported: Boolean(debugPanel),',
        '          panelNodes: document.querySelectorAll("#astra-new-experiment-debug-panel").length,',
        '          status: debugPanel?.status?.() || null',
        '        }',
        '      };',
        '    },',
        '    debugMetrics() { return metricsSnapshot(); },',
        '    inspect() {',
        '      const module = document.querySelector(moduleSelector);',
        "      const root = module && module.querySelector('.astra-exp');",
        "      const canvas = root && root.querySelector('[data-role=\"canvas\"]');",
        "      const readout = root && root.querySelector('[data-role=\"readout\"]');",
        "      const parameter = root && root.querySelector('[data-control=\"parameter\"]');",
        "      const parameterOutput = root && root.querySelector('[data-role=\"parameter-value\"]');",
        "      const toggle = root && root.querySelector('[data-action=\"toggle\"]');",
        "      const reset = root && root.querySelector('[data-action=\"reset\"]');",
        "      const details = root && root.querySelector('[data-role=\"control-drawer\"]');",
        "      const summary = details && details.querySelector('summary');",
        "      const drawerBody = details && details.querySelector(':scope > div');",
        '      const canvasRect = canvas && canvas.getBoundingClientRect();',
        '      const rootRect = root && root.getBoundingClientRect();',
        '      const targetSizes = [parameter, toggle, reset, summary].filter(Boolean).map((element) => {',
        '        const rect = element.getBoundingClientRect();',
        '        return { tag: element.tagName.toLowerCase(), role: element.dataset.action || element.dataset.control || "summary", width: rect.width, height: rect.height };',
        '      });',
        '      return {',
        '        modulePresent: Boolean(module),',
        '        rootPresent: Boolean(root),',
        "        state: root ? root.dataset.state || '' : '',",
        '        canvas: canvas ? {',
        '          bitmapWidth: canvas.width, bitmapHeight: canvas.height,',
        '          clientWidth: canvasRect.width, clientHeight: canvasRect.height,',
        "          hasContext: Boolean(canvas.getContext('2d')), fingerprint: fingerprint(canvas)",
        '        } : null,',
        "        readout: readout ? readout.textContent.trim() : '',",
        "        parameterValue: parameter ? parameter.value : '',",
        "        parameterOutput: parameterOutput ? parameterOutput.textContent.trim() : '',",
        '        toggle: toggle ? { disabled: toggle.disabled, text: toggle.textContent.trim() } : null,',
        '        details: details ? {',
        '          open: details.open,',
        "          summaryDisplay: summary ? getComputedStyle(summary).display : '',",
        "          bodyDisplay: drawerBody ? getComputedStyle(drawerBody).display : ''",
        '        } : null,',
        '        targetSizes,',
        '        layout: {',
        '          innerWidth: window.innerWidth, innerHeight: window.innerHeight,',
        '          documentWidth: document.documentElement.scrollWidth,',
        '          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,',
        '          rootWithinViewport: Boolean(rootRect) && rootRect.left >= -1 && rootRect.right <= window.innerWidth + 1,',
        '          rootRect: rootRect ? { left: rootRect.left, right: rootRect.right, width: rootRect.width } : null',
        '        },',
        '        owner: ownerState(),',
        '        metrics: metricsSnapshot()',
        '      };',
        '    }',
        '  };',
        '})();'
    ].join('\n');
}

function escapeHtmlAttribute(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

function contentType(file) {
    return ({
        '.css': 'text/css; charset=utf-8',
        '.gif': 'image/gif',
        '.glb': 'model/gltf-binary',
        '.gltf': 'model/gltf+json',
        '.html': 'text/html; charset=utf-8',
        '.jpeg': 'image/jpeg',
        '.jpg': 'image/jpeg',
        '.js': 'text/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.mjs': 'text/javascript; charset=utf-8',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
        '.wasm': 'application/wasm',
        '.webp': 'image/webp'
    })[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function buildHarnessHtml(candidate, contract, options = {}) {
    const manifest = candidate.manifest;
    const moduleDirectory = path.posix.dirname(stripQuery(manifest.module));
    const baseHref = '/' + (moduleDirectory === '.' ? '' : moduleDirectory + '/');
    const styleHref = '/' + manifest.style.replace(/^\/+/, '');
    const scriptSrc = '/' + manifest.script.replace(/^\/+/, '');
    const debugScript = options.debug && options.debugContract
        ? '<script src="'
            + escapeHtmlAttribute(options.debugContract.activation.script_request)
            + '"></script>'
        : '';
    return [
        '<!doctype html>',
        '<html lang="zh-CN">',
        '<head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<title>' + escapeHtmlAttribute(manifest.title) + '｜新增实验隔离验收</title>',
        '<base href="' + escapeHtmlAttribute(baseHref) + '">',
        '<style>',
        ':root{--text-primary:#d8dce6;--text-secondary:#8a90a0;--surface-1:#0e1019;--border-default:rgba(255,255,255,.07);--border-hover:rgba(255,255,255,.12);--radius-default:4px;--radius-lg:8px;--text-sm:.875rem;--accent-purple:#8b6fc0}',
        '*,*::before,*::after{box-sizing:border-box}',
        'html,body{margin:0;min-width:0;background:#070b14;color:#d8dce6;font-family:Inter,"Microsoft YaHei",sans-serif}',
        'body{min-height:100vh}',
        '</style>',
        '<link rel="stylesheet" href="' + escapeHtmlAttribute(styleHref) + '">',
        '</head>',
        '<body>',
        '<template id="candidate-template">',
        candidate.moduleSource,
        '</template>',
        '<main id="page-' + manifest.subject + '"></main>',
        '<script>' + harnessScript(candidate, contract).replaceAll('</script', '<\\/script') + '</script>',
        '<script src="' + escapeHtmlAttribute(scriptSrc) + '"></script>',
        debugScript,
        '</body>',
        '</html>'
    ].join('\n');
}

async function startHarnessServer(candidate, contract, options = {}) {
    const debugScriptRequest = options.debug && options.debugContract
        ? options.debugContract.activation.script_request
        : null;
    const debugPathname = debugScriptRequest
        ? new URL(debugScriptRequest, 'http://127.0.0.1').pathname
        : null;
    const debugSource = debugPathname
        ? await fsp.readFile(DEBUG_PANEL_SCRIPT)
        : null;
    const page = buildHarnessHtml(candidate, contract, options);
    const server = http.createServer(async (request, response) => {
        const url = new URL(request.url || '/', 'http://127.0.0.1');
        if (url.pathname === '/' || url.pathname === '/index.html') {
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            response.end(page);
            return;
        }
        if (url.pathname === '/favicon.ico') {
            response.writeHead(204);
            response.end();
            return;
        }
        if (debugPathname && url.pathname === debugPathname) {
            response.writeHead(200, {
                'Content-Type': 'text/javascript; charset=utf-8',
                'Content-Length': debugSource.length,
                'Cache-Control': 'no-store'
            });
            response.end(debugSource);
            return;
        }
        try {
            const decoded = decodeURIComponent(url.pathname).replace(/^\/+/, '');
            const file = path.resolve(candidate.root, decoded.replaceAll('/', path.sep));
            if (!insideRoot(candidate.candidateDirectory, file)) {
                throw new Error('outside candidate directory');
            }
            const stat = await fsp.stat(file);
            if (!stat.isFile()) throw new Error('not a file');
            response.writeHead(200, {
                'Content-Type': contentType(file),
                'Content-Length': stat.size,
                'Cache-Control': 'no-store'
            });
            fs.createReadStream(file).pipe(response);
        } catch {
            response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end('not found');
        }
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    return {
        url: 'http://127.0.0.1:' + address.port + '/',
        debugPathname,
        close: () => new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        })
    };
}

function requirePlaywright() {
    try {
        return require('playwright');
    } catch (error) {
        const wrapped = new Error(
            'Playwright is unavailable. Run npm ci or set NODE_PATH to the approved workspace dependency directory.'
        );
        wrapped.code = 'playwright_missing';
        wrapped.cause = error;
        throw wrapped;
    }
}

async function launchBrowser(options = {}) {
    const { chromium } = requirePlaywright();
    const attempts = [];
    const requestedExecutable = options.executable || process.env.ASTRA_BROWSER_EXECUTABLE;
    const requestedChannel = options.channel || process.env.ASTRA_BROWSER_CHANNEL;
    const candidates = [];
    if (requestedExecutable) candidates.push({ label: requestedExecutable, options: { executablePath: requestedExecutable } });
    if (requestedChannel) candidates.push({ label: requestedChannel, options: { channel: requestedChannel } });
    candidates.push({ label: 'playwright-chromium', options: {} });
    candidates.push({ label: 'msedge', options: { channel: 'msedge' } });
    candidates.push({ label: 'chrome', options: { channel: 'chrome' } });
    if (process.platform === 'win32') {
        for (const executablePath of [
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
        ]) {
            if (fs.existsSync(executablePath)) {
                candidates.push({ label: executablePath, options: { executablePath } });
            }
        }
    }
    const seen = new Set();
    for (const candidate of candidates) {
        const key = JSON.stringify(candidate.options);
        if (seen.has(key)) continue;
        seen.add(key);
        try {
            const browser = await chromium.launch({
                headless: options.headed ? false : true,
                ...candidate.options
            });
            return { browser, label: candidate.label };
        } catch (error) {
            attempts.push(candidate.label + ': ' + String(error.message || error).split('\n')[0]);
        }
    }
    throw new Error('Unable to launch an approved Chromium browser. ' + attempts.join(' | '));
}

function addCheck(run, id, ok, evidence) {
    run.checks.push({ id, ok: Boolean(ok), evidence: evidence || {} });
}

async function inspect(page) {
    return page.evaluate(() => window.__newExperimentAcceptance.inspect());
}

async function inspectDebugPanel(page, refresh = false) {
    return page.evaluate((forceRefresh) => {
        const api = window.AstraNewExperimentDebugPanel || null;
        const host = document.getElementById('astra-new-experiment-debug-panel');
        const root = host?.shadowRoot || null;
        const panel = root?.querySelector('.panel') || null;
        const close = root?.querySelector('[data-debug-close]') || null;
        const rectOf = (element) => {
            if (!element) return null;
            const rect = element.getBoundingClientRect();
            return {
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                left: rect.left,
                width: rect.width,
                height: rect.height
            };
        };
        const snapshot = api
            ? (forceRefresh ? api.refresh() : api.snapshot())
            : null;
        return {
            globalExport: Boolean(api),
            panelCount: document.querySelectorAll('#astra-new-experiment-debug-panel').length,
            status: api?.status?.() || null,
            snapshot,
            sections: Array.from(root?.querySelectorAll('h3') || [], (node) => (
                node.textContent.trim()
            )),
            layout: {
                viewport: { width: window.innerWidth, height: window.innerHeight },
                host: rectOf(host),
                panel: rectOf(panel),
                closeButton: rectOf(close),
                panelClientHeight: panel?.clientHeight || 0,
                panelScrollHeight: panel?.scrollHeight || 0,
                panelScrollable: Boolean(panel && panel.scrollHeight > panel.clientHeight)
            }
        };
    }, refresh);
}

async function runViewport(browser, harness, candidate, contract, profile, outDir, options = {}) {
    const context = await browser.newContext({
        viewport: { width: profile.width, height: profile.height },
        reducedMotion: profile.reduced_motion ? 'reduce' : 'no-preference',
        colorScheme: 'dark',
        locale: 'zh-CN'
    });
    const page = await context.newPage();
    const clickCandidateControl = async (selector) => {
        const locator = page.locator(selector);
        if (options.debug) {
            await locator.evaluate((element) => element.click());
        } else {
            await locator.click();
        }
    };
    const run = {
        name: profile.name,
        viewport: { width: profile.width, height: profile.height },
        reduced_motion: profile.reduced_motion,
        checks: [],
        console: [],
        page_errors: [],
        network_failures: [],
        debug_mode: Boolean(options.debug),
        debug_script_requests: 0,
        screenshot: ''
    };
    page.on('request', (request) => {
        if (
            harness.debugPathname
            && new URL(request.url()).pathname === harness.debugPathname
        ) {
            run.debug_script_requests += 1;
        }
    });
    page.on('console', (message) => {
        if (SERIOUS_CONSOLE_TYPES.has(message.type())) {
            run.console.push({ type: message.type(), text: message.text().slice(0, 1000) });
        }
    });
    page.on('pageerror', (error) => {
        run.page_errors.push({ name: error.name, message: error.message.slice(0, 1000) });
    });
    page.on('requestfailed', (request) => {
        run.network_failures.push({
            type: 'requestfailed',
            url: request.url(),
            detail: request.failure()?.errorText || ''
        });
    });
    page.on('response', (response) => {
        if (response.status() >= 400) {
            run.network_failures.push({
                type: 'http',
                url: response.url(),
                status: response.status()
            });
        }
    });
    try {
        await page.goto(harness.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        const mounted = await page.evaluate(() => window.__newExperimentAcceptance.mount());
        let debugMounted = false;
        if (options.debug) {
            debugMounted = await page.evaluate((ownerName) => (
                window.AstraNewExperimentDebugPanel?.mount?.({ ownerName }) === true
            ), candidate.manifest.owner);
        }
        await page.waitForFunction(() => {
            const state = window.__newExperimentAcceptance.inspect();
            return Boolean(
                state.canvas
                && state.canvas.bitmapWidth > 0
                && state.canvas.bitmapHeight > 0
                && state.readout
            );
        }, undefined, { timeout: 5000 });
        await page.waitForTimeout(120);
        const initial = await inspect(page);
        if (!options.debug) {
            const debugOff = await inspectDebugPanel(page);
            addCheck(
                run,
                'debug-off',
                run.debug_script_requests === 0
                    && debugOff.globalExport === false
                    && debugOff.panelCount === 0
                    && debugOff.status === null,
                {
                    scriptRequests: run.debug_script_requests,
                    globalExport: debugOff.globalExport,
                    panelCount: debugOff.panelCount,
                    status: debugOff.status
                }
            );
        }
        addCheck(
            run,
            'enter',
            mounted
                && initial.modulePresent
                && initial.rootPresent
                && initial.owner
                && Object.values(initial.owner.references).some((value) => value === false),
            { mounted, state: initial.state, metrics: initial.metrics }
        );

        addCheck(
            run,
            'first-draw',
            initial.canvas
                && initial.canvas.bitmapWidth > 0
                && initial.canvas.bitmapHeight > 0
                && initial.canvas.clientWidth > 0
                && initial.canvas.clientHeight > 0
                && initial.canvas.hasContext
                && initial.canvas.fingerprint.length > 100
                && initial.readout.length > 0,
            { canvas: initial.canvas, readout: initial.readout }
        );

        const operationValue = contract.operation.parameter_value;
        await page.evaluate((value) => {
            const control = document.querySelector('[data-control="parameter"]');
            control.value = String(value);
            control.dispatchEvent(new Event('input', { bubbles: true }));
        }, operationValue);
        await page.waitForTimeout(60);
        const operated = await inspect(page);
        addCheck(
            run,
            'operate',
            operated.owner
                && Number(operated.owner.snapshot.parameter) === operationValue
                && operated.parameterValue === String(operationValue)
                && operated.parameterOutput.includes(String(operationValue))
                && operated.readout.includes(String(operationValue))
                && operated.canvas.fingerprint.checksum !== initial.canvas.fingerprint.checksum,
            {
                requested: operationValue,
                snapshot: operated.owner && operated.owner.snapshot,
                parameterOutput: operated.parameterOutput,
                readout: operated.readout,
                beforeCanvas: initial.canvas.fingerprint,
                afterCanvas: operated.canvas.fingerprint
            }
        );

        if (options.debug) {
            await page.waitForTimeout(options.debugContract.refresh_interval_ms + 80);
            const debugState = await inspectDebugPanel(page, true);
            const debugSnapshot = debugState.snapshot;
            const expectedState = profile.reduced_motion ? 'reduced-motion' : 'running';
            const motionMetricsOk = profile.reduced_motion
                ? debugSnapshot?.timing?.frames_per_second === 0
                    && debugSnapshot?.timing?.last_step_seconds === 0
                    && debugSnapshot?.resources?.animation_frames === 0
                : debugSnapshot?.timing?.frames_per_second > 0
                    && debugSnapshot?.timing?.last_step_seconds > 0
                    && debugSnapshot?.resources?.animation_frames > 0;
            const layout = debugState.layout;
            const hostWithinViewport = layout.host
                && layout.host.left >= -1
                && layout.host.right <= layout.viewport.width + 1
                && layout.host.top >= -1
                && layout.host.bottom <= layout.viewport.height + 1;
            const mobileLayoutOk = profile.name !== 'mobile'
                || (
                    layout.closeButton
                    && layout.closeButton.width >= options.debugContract.responsive.minimum_action_height_px
                    && layout.closeButton.height >= options.debugContract.responsive.minimum_action_height_px
                    && layout.panelScrollable
                );
            addCheck(
                run,
                'debug-panel',
                debugMounted
                    && run.debug_script_requests === options.debugContract.on_mode.script_requests
                    && debugState.globalExport
                    && debugState.panelCount === options.debugContract.on_mode.panel_nodes
                    && debugState.status?.mounted === true
                    && debugState.status?.timerActive === true
                    && debugState.status?.ownerName === candidate.manifest.owner
                    && debugState.sections.length === options.debugContract.required_sections.length
                    && options.debugContract.required_sections.every((section) => (
                        debugState.sections.includes(section)
                    ))
                    && debugSnapshot?.state === expectedState
                    && Number(debugSnapshot?.model?.parameter) === operationValue
                    && debugSnapshot?.resources?.resize_observers === 1
                    && debugSnapshot?.resources?.control_scopes === 1
                    && debugSnapshot?.resources?.canvas_bitmap?.width > 0
                    && debugSnapshot?.resources?.canvas_bitmap?.height > 0
                    && motionMetricsOk
                    && hostWithinViewport
                    && mobileLayoutOk,
                {
                    mounted: debugMounted,
                    scriptRequests: run.debug_script_requests,
                    panel: debugState,
                    expectedState,
                    motionMetricsOk,
                    hostWithinViewport,
                    mobileLayoutOk
                }
            );
        }

        if (profile.reduced_motion) {
            const beforeStaticWait = operated.owner.snapshot.elapsed_seconds;
            await page.waitForTimeout(180);
            const staticState = await inspect(page);
            const afterStaticWait = staticState.owner.snapshot.elapsed_seconds;
            addCheck(
                run,
                'mode-control',
                staticState.state === 'reduced-motion'
                    && staticState.toggle
                    && staticState.toggle.disabled
                    && staticState.metrics.activeAnimationFrames === 0
                    && Math.abs(afterStaticWait - beforeStaticWait) < 0.01,
                {
                    state: staticState.state,
                    toggle: staticState.toggle,
                    elapsedBefore: beforeStaticWait,
                    elapsedAfter: afterStaticWait,
                    metrics: staticState.metrics
                }
            );
        } else {
            await clickCandidateControl('[data-action="toggle"]');
            await page.waitForTimeout(80);
            const paused = await inspect(page);
            const pausedElapsed = paused.owner.snapshot.elapsed_seconds;
            await page.waitForTimeout(140);
            const pausedAgain = await inspect(page);
            await clickCandidateControl('[data-action="toggle"]');
            await page.waitForTimeout(140);
            const resumed = await inspect(page);
            addCheck(
                run,
                'mode-control',
                paused.state === 'paused'
                    && paused.metrics.activeAnimationFrames === 0
                    && Math.abs(pausedAgain.owner.snapshot.elapsed_seconds - pausedElapsed) < 0.01
                    && resumed.state === 'running'
                    && resumed.metrics.activeAnimationFrames > 0
                    && resumed.owner.snapshot.elapsed_seconds > pausedElapsed,
                {
                    pausedState: paused.state,
                    pausedElapsed,
                    pausedElapsedAfterWait: pausedAgain.owner.snapshot.elapsed_seconds,
                    resumedState: resumed.state,
                    resumedElapsed: resumed.owner.snapshot.elapsed_seconds,
                    pausedMetrics: paused.metrics,
                    resumedMetrics: resumed.metrics
                }
            );
        }

        await clickCandidateControl('[data-action="reset"]');
        await page.waitForTimeout(30);
        const reset = await inspect(page);
        addCheck(
            run,
            'reset',
            reset.owner
                && Number(reset.owner.snapshot.parameter) === contract.operation.reset_parameter_value
                && Number(reset.owner.snapshot.elapsed_seconds) <= 0.2
                && reset.parameterValue === String(contract.operation.reset_parameter_value)
                && reset.parameterOutput.includes(String(contract.operation.reset_parameter_value))
                && reset.readout.includes(String(contract.operation.reset_parameter_value)),
            {
                expectedParameter: contract.operation.reset_parameter_value,
                snapshot: reset.owner && reset.owner.snapshot,
                parameterValue: reset.parameterValue,
                parameterOutput: reset.parameterOutput,
                readout: reset.readout
            }
        );
        addCheck(
            run,
            'horizontal-overflow',
            !reset.layout.horizontalOverflow && reset.layout.rootWithinViewport,
            reset.layout
        );

        if (profile.name === 'mobile') {
            const beforeDrawer = reset.details;
            await clickCandidateControl('[data-role="control-drawer"] > summary');
            const closedDrawer = (await inspect(page)).details;
            await clickCandidateControl('[data-role="control-drawer"] > summary');
            const openedDrawer = (await inspect(page)).details;
            addCheck(
                run,
                'drawer-toggle',
                beforeDrawer
                    && beforeDrawer.summaryDisplay !== 'none'
                    && closedDrawer
                    && closedDrawer.open === false
                    && closedDrawer.bodyDisplay === 'none'
                    && openedDrawer
                    && openedDrawer.open === true
                    && openedDrawer.bodyDisplay !== 'none',
                { before: beforeDrawer, closed: closedDrawer, opened: openedDrawer }
            );
            const mobileState = await inspect(page);
            addCheck(
                run,
                'touch-targets',
                mobileState.targetSizes.length >= 4
                    && mobileState.targetSizes.every((target) => target.height >= contract.minimum_touch_target_px)
                    && mobileState.targetSizes
                        .filter((target) => target.tag === 'button')
                        .every((target) => target.width >= contract.minimum_touch_target_px),
                {
                    minimum: contract.minimum_touch_target_px,
                    targets: mobileState.targetSizes
                }
            );
        }

        if (options.debug) {
            await page.waitForTimeout(options.debugContract.refresh_interval_ms + 20);
            run.debug_before_screenshot = await inspectDebugPanel(page, true);
        }
        if (options.debug && profile.name === 'desktop' && options.debugHoldMs > 0) {
            await page.waitForTimeout(options.debugHoldMs);
        }
        const screenshotName = candidate.manifest.activity_key
            + '-'
            + profile.name
            + (options.debug ? '-debug' : '')
            + '.png';
        const screenshot = path.join(outDir, screenshotName);
        await page.screenshot({
            path: screenshot,
            fullPage: profile.name === 'mobile'
        });
        run.screenshot = screenshotName;

        const released = await page.evaluate(() => window.__newExperimentAcceptance.leave());
        const releaseReferences = released.owner ? released.owner.references : {};
        addCheck(
            run,
            'leave-release',
            released.signalAborted
                && released.moduleRemoved
                && released.owner
                && Object.values(releaseReferences).every(Boolean)
                && released.owner.frame === 0
                && released.metrics.activeResizeObservers === 0
                && released.metrics.activeAnimationFrames === 0
                && (
                    !options.debug
                    || (
                        released.debugPanel
                        && released.debugPanel.exported === true
                        && released.debugPanel.panelNodes === 0
                        && released.debugPanel.status?.mounted === false
                        && released.debugPanel.status?.timerActive === false
                    )
                ),
            released
        );

        const remounted = await page.evaluate(() => window.__newExperimentAcceptance.mount());
        const debugRemounted = options.debug
            ? await page.evaluate((ownerName) => (
                window.AstraNewExperimentDebugPanel?.mount?.({ ownerName }) === true
            ), candidate.manifest.owner)
            : false;
        await page.waitForTimeout(100);
        await page.evaluate((value) => {
            const control = document.querySelector('[data-control="parameter"]');
            control.value = String(value);
            control.dispatchEvent(new Event('input', { bubbles: true }));
        }, contract.operation.reentry_parameter_value);
        await page.waitForTimeout(30);
        const reentered = await inspect(page);
        const reenteredDebug = options.debug
            ? await inspectDebugPanel(page, true)
            : null;
        addCheck(
            run,
            're-enter',
            remounted
                && reentered.rootPresent
                && reentered.owner
                && Number(reentered.owner.snapshot.parameter) === contract.operation.reentry_parameter_value
                && reentered.readout.includes(String(contract.operation.reentry_parameter_value))
                && reentered.metrics.activeResizeObservers === 1
                && (
                    profile.reduced_motion
                        ? reentered.metrics.activeAnimationFrames === 0
                        : reentered.metrics.activeAnimationFrames > 0
                )
                && (
                    !options.debug
                    || (
                        debugRemounted
                        && reenteredDebug?.status?.mounted === true
                        && reenteredDebug?.status?.timerActive === true
                        && Number(reenteredDebug?.snapshot?.model?.parameter)
                            === contract.operation.reentry_parameter_value
                    )
                ),
            {
                remounted,
                state: reentered.state,
                snapshot: reentered.owner && reentered.owner.snapshot,
                readout: reentered.readout,
                metrics: reentered.metrics,
                debugRemounted,
                debugPanel: reenteredDebug
            }
        );
        run.final_release = await page.evaluate(() => window.__newExperimentAcceptance.leave());
        addCheck(
            run,
            'final-release',
            run.final_release.signalAborted
                && run.final_release.moduleRemoved
                && run.final_release.metrics.activeResizeObservers === 0
                && run.final_release.metrics.activeAnimationFrames === 0
                && (
                    !options.debug
                    || (
                        run.final_release.debugPanel?.panelNodes === 0
                        && run.final_release.debugPanel?.status?.mounted === false
                        && run.final_release.debugPanel?.status?.timerActive === false
                    )
                ),
            run.final_release
        );
        addCheck(
            run,
            'console-clean',
            run.console.length === 0
                && run.page_errors.length === 0
                && run.network_failures.length === 0,
            {
                console: run.console,
                pageErrors: run.page_errors,
                networkFailures: run.network_failures
            }
        );
    } catch (error) {
        addCheck(run, 'runner-crash', false, {
            message: error && error.message ? error.message : String(error),
            stack: error && error.stack ? error.stack : ''
        });
    } finally {
        await context.close();
    }
    run.ok = run.checks.every((check) => check.ok);
    return run;
}

function validateJourneyReport(report, options = {}) {
    const contract = options.contract || loadContract(options.contractFile);
    const expectedManifest = options.manifest || null;
    const errors = [];
    const add = (code, message) => errors.push({ code, message });
    if (!report || typeof report !== 'object' || Array.isArray(report)) {
        return { ok: false, errors: [{ code: 'report_invalid', message: 'report must be an object' }] };
    }
    if (report.schema_version !== contract.schema_version) add('schema_version_invalid', 'report schema version mismatch');
    if (report.task !== contract.task || report.version !== contract.version) {
        add('version_invalid', 'report task/version mismatch');
    }
    if (!report.candidate || typeof report.candidate !== 'object') {
        add('candidate_missing', 'candidate identity is missing');
    } else if (expectedManifest) {
        for (const field of ['subject', 'id', 'activity_key', 'owner', 'init_hook']) {
            if (report.candidate[field] !== expectedManifest[field]) {
                add('candidate_identity_mismatch', 'candidate.' + field + ' does not match manifest');
            }
        }
    }
    if (!Array.isArray(report.runs)) {
        add('runs_missing', 'viewport runs are missing');
    } else {
        for (const profile of contract.viewports) {
            const run = report.runs.find((entry) => entry && entry.name === profile.name);
            if (!run) {
                add('viewport_missing', 'missing viewport run: ' + profile.name);
                continue;
            }
            if (
                !run.viewport
                || run.viewport.width !== profile.width
                || run.viewport.height !== profile.height
                || run.reduced_motion !== profile.reduced_motion
            ) {
                add('viewport_mismatch', 'viewport profile mismatch: ' + profile.name);
            }
            if (run.ok !== true) add('viewport_status_failed', profile.name + ' run status is not PASS');
            const required = contract.required_checks.concat(
                profile.name === 'mobile' ? contract.mobile_checks : []
            );
            for (const checkId of required) {
                const check = Array.isArray(run.checks)
                    ? run.checks.find((entry) => entry && entry.id === checkId)
                    : null;
                if (!check || check.ok !== true) {
                    add('check_failed', profile.name + ' failed or omitted ' + checkId);
                }
            }
            if (!Array.isArray(run.console) || run.console.length !== 0) {
                add('console_not_clean', profile.name + ' contains serious console messages');
            }
            if (!Array.isArray(run.page_errors) || run.page_errors.length !== 0) {
                add('page_error_present', profile.name + ' contains page errors');
            }
            if (!Array.isArray(run.network_failures) || run.network_failures.length !== 0) {
                add('network_failure_present', profile.name + ' contains failed resource requests');
            }
            if (typeof run.screenshot !== 'string' || !run.screenshot) {
                add('screenshot_missing', profile.name + ' screenshot path is missing');
            } else if (options.checkFiles) {
                const evidenceRoot = path.resolve(options.evidenceRoot || process.cwd());
                const screenshotFile = path.isAbsolute(run.screenshot)
                    ? run.screenshot
                    : path.resolve(evidenceRoot, run.screenshot);
                if (!insideRoot(evidenceRoot, screenshotFile) || !fs.existsSync(screenshotFile)) {
                    add('screenshot_file_missing', profile.name + ' screenshot file is missing');
                }
            }
        }
    }
    if (report.old_activity_policy !== contract.old_activity_policy) {
        add('old_activity_policy_mismatch', 'report must preserve the old-activity smoke-only policy');
    }
    if (report.ok !== true) add('report_status_failed', 'report status is not PASS');
    return { ok: errors.length === 0, errors };
}

async function runJourney(options = {}) {
    const contract = loadContract(options.contractFile || DEFAULT_CONTRACT);
    const debugMode = options.debug === true;
    const debugHoldMs = normalizeDebugHold(options.debugHoldMs);
    if (!debugMode && debugHoldMs > 0) {
        throw new Error('--debug-hold requires --debug');
    }
    const debugContract = debugMode
        ? loadDebugContract(options.debugContractFile || DEFAULT_DEBUG_CONTRACT)
        : null;
    const candidate = loadCandidate(options);
    const outDir = path.resolve(
        options.out
        || path.join('test-screenshots', 'new-experiment', candidate.manifest.activity_key)
    );
    await fsp.mkdir(outDir, { recursive: true });
    const report = {
        schema_version: contract.schema_version,
        task: contract.task,
        version: contract.version,
        generated_at: new Date().toISOString(),
        scope: contract.scope,
        production_registration: false,
        debug_mode: debugMode,
        debug_contract: debugContract
            ? {
                task: debugContract.task,
                version: debugContract.version,
                delivery: debugContract.delivery
            }
            : null,
        candidate: {
            subject: candidate.manifest.subject,
            id: candidate.manifest.id,
            activity_key: candidate.manifest.activity_key,
            title: candidate.manifest.title,
            owner: candidate.manifest.owner,
            init_hook: candidate.manifest.init_hook,
            manifest: path.relative(candidate.root, candidate.manifestFile).replaceAll(path.sep, '/'),
            module: path.relative(candidate.root, candidate.moduleFile).replaceAll(path.sep, '/')
        },
        browser: null,
        harness: 'isolated-candidate',
        old_activity_policy: contract.old_activity_policy,
        runs: [],
        ok: false
    };
    let launched = null;
    let harness = null;
    let fatalError = null;
    try {
        harness = await startHarnessServer(candidate, contract, {
            debug: debugMode,
            debugContract
        });
        launched = await launchBrowser(options);
        report.browser = {
            target: launched.label,
            version: launched.browser.version()
        };
        for (const profile of contract.viewports) {
            report.runs.push(
                await runViewport(
                    launched.browser,
                    harness,
                    candidate,
                    contract,
                    profile,
                    outDir,
                    {
                        debug: debugMode,
                        debugContract,
                        debugHoldMs
                    }
                )
            );
        }
    } catch (error) {
        fatalError = error;
        report.fatal_error = {
            code: error && error.code ? error.code : 'browser_journey_failed',
            message: error && error.message ? error.message : String(error)
        };
    } finally {
        if (launched) await launched.browser.close();
        if (harness) await harness.close();
    }
    report.ok = !fatalError && report.runs.every((run) => run.ok === true);
    const validation = fatalError
        ? {
            ok: false,
            errors: [{
                code: report.fatal_error.code,
                message: report.fatal_error.message
            }]
        }
        : validateJourneyReport(report, {
            contract,
            manifest: candidate.manifest,
            checkFiles: true,
            evidenceRoot: outDir
        });
    report.validation_errors = validation.errors;
    report.ok = validation.ok;
    const reportPath = path.join(outDir, contract.evidence.report_filename);
    await fsp.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
    return { report, reportPath, validation };
}

function printHelp() {
    console.log([
        'Usage:',
        '  node tools/browser/check-new-experiment-journey.cjs --manifest <manifest.json> [--root <repository>] [--out <directory>] [--debug]',
        '  node tools/browser/check-new-experiment-journey.cjs --validate-report <report.json> [--manifest <manifest.json>] [--contract <contract.json>]',
        '',
        'Development inspector: --debug [--headed] [--debug-hold <0..3600000 milliseconds>]',
        'Optional browser selection: --channel msedge | --executable <browser.exe> | --headed'
    ].join('\n'));
}

async function main(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    if (args.help) {
        printHelp();
        return 0;
    }
    const root = path.resolve(args.root || DEFAULT_ROOT);
    const contractFile = args.contract
        ? path.resolve(args.contract)
        : path.join(root, 'tools/templates/new-experiment/browser-journey.contract.json');
    const debugMode = args.debug === true;
    if (args.debug !== undefined && !debugMode) {
        throw new Error('--debug is a flag and does not accept a value');
    }
    const debugHoldMs = normalizeDebugHold(args['debug-hold']);
    if (!debugMode && debugHoldMs > 0) {
        throw new Error('--debug-hold requires --debug');
    }
    if (args['validate-report']) {
        const reportFile = path.resolve(String(args['validate-report']));
        const report = readJson(reportFile);
        const manifest = args.manifest ? readJson(path.resolve(args.manifest)) : null;
        const validation = validateJourneyReport(report, {
            contract: loadContract(contractFile),
            manifest,
            checkFiles: true,
            evidenceRoot: path.dirname(reportFile)
        });
        console.log(JSON.stringify({
            ok: validation.ok,
            report: reportFile,
            errors: validation.errors
        }, null, 2));
        return validation.ok ? 0 : 1;
    }
    const result = await runJourney({
        root,
        manifest: args.manifest,
        module: args.module,
        out: args.out,
        contractFile,
        channel: args.channel,
        executable: args.executable,
        headed: args.headed === true,
        debug: debugMode,
        debugHoldMs,
        debugContractFile: args['debug-contract']
            ? path.resolve(args['debug-contract'])
            : path.join(root, 'tools/templates/new-experiment/debug-panel.contract.json')
    });
    console.log(JSON.stringify({
        ok: result.report.ok,
        report: result.reportPath,
        browser: result.report.browser,
        runs: result.report.runs.map((run) => ({
            name: run.name,
            ok: run.ok,
            screenshot: run.screenshot,
            failed: run.checks.filter((check) => !check.ok).map((check) => check.id)
        })),
        validation_errors: result.validation.errors
    }, null, 2));
    return result.report.ok ? 0 : 1;
}

module.exports = Object.freeze({
    loadContract,
    loadDebugContract,
    loadCandidate,
    validateJourneyReport,
    runJourney,
    main
});

if (require.main === module) {
    main().then(
        (status) => { process.exitCode = status; },
        (error) => {
            console.error(JSON.stringify({
                ok: false,
                code: error.code || 'new_experiment_journey_crashed',
                message: error && error.message ? error.message : String(error)
            }, null, 2));
            process.exitCode = 1;
        }
    );
}
