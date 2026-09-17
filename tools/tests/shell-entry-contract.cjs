const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const assetKey = (value) => {
  const url = new URL(value.replaceAll('&amp;', '&'), 'https://astra.test/');
  return url.pathname + url.search;
};

async function testCacheWarmupUsesTheBootRouter() {
  const routerSrc = html.match(/<script\b[^>]*\bsrc="([^"]*shared\/js\/router\.js[^\"]*)"/i)?.[1];
  assert.ok(routerSrc, 'the public entry must load the router');
  const wantedRouter = assetKey(routerSrc);
  const requested = [];
  const context = {
    window: {
      // The public explorer owns its bootstrap. Exercise only the real cache warmer here.
      AstraResourceExplorer: { start: () => true },
      requestIdleCallback: (callback) => callback(),
    },
    fetch: async (url, options) => {
      requested.push({ url: assetKey(url), options });
      return { ok: true, url };
    },
  };
  vm.createContext(context);
  vm.runInContext(read('shared/js/main.js'), context);
  for (const galaxy of ['astra', 'englab', 'frontier']) {
    requested.length = 0;
    context.warmHttpCacheFallback(galaxy);
    assert.ok(requested.some(({ url }) => url === wantedRouter),
      `${galaxy} HTTP fallback must warm the exact boot router URL, including its patch`);
    for (const { url, options } of requested) {
      assert.doesNotMatch(url, /^\/api(?:\/|\?|$)/, 'shell warmup must never fetch business API data');
      assert.equal(options.cache, 'force-cache');
    }
  }

  const handlers = new Map();
  const precached = [];
  vm.runInNewContext(read('sw.js'), {
    self: { addEventListener: (name, handler) => handlers.set(name, handler), skipWaiting() {} },
    caches: { open: async () => ({ addAll: async (requests) => precached.push(...requests) }) },
    Request: class { constructor(url) { this.url = assetKey(url); } },
  });
  let installed;
  handlers.get('install')({ waitUntil: (promise) => { installed = promise; } });
  await installed;
  assert.ok(precached.some(({ url }) => url === wantedRouter),
    'service-worker installation must cache the exact boot router URL, including its patch');
}

async function testAiTutorLoadsOnlyWithEnglabSupport() {
  const scripts = [];
  const context = {
    window: {}, location: { search: '' }, URLSearchParams,
    document: {
      scripts,
      createElement: () => {
        const listeners = new Map();
        return {
          dataset: {},
          getAttribute(name) { return this[name]; },
          addEventListener: (event, callback) => listeners.set(event, callback),
          loaded: () => listeners.get('load')?.(),
        };
      },
      body: { appendChild: (script) => { scripts.push(script); queueMicrotask(() => script.loaded()); } },
    },
  };
  vm.createContext(context);
  vm.runInContext(read('shared/js/page-registry.js'), context);
  vm.runInContext(read('shared/js/router.js'), context);
  const router = context.window.Router;
  await router._loadGalaxySupport('astra', 'student');
  await router._loadGalaxySupport('frontier', 'frontier');
  assert.equal(scripts.filter((script) => script.src.includes('/ai-tutor.js')).length, 0,
    'role and frontier entry must not load the engineering AI module');
  await Promise.all([
    router._loadGalaxySupport('englab', 'physics'),
    router._loadGalaxySupport('englab', 'chemistry'),
  ]);
  const tutorScripts = scripts.filter((script) => script.src.includes('/ai-tutor.js'));
  assert.equal(tutorScripts.length, 1, 'repeated engineering entry must load the tutor module only once');
  assert.ok(fs.existsSync(path.join(root, new URL(tutorScripts[0].src, 'https://astra.test/').pathname)),
    'the lazy-loaded AI module must exist');
  assert.match(html, /<link\b[^>]*href="shared\/css\/ai-tutor\.css\?v=[^"]+"/,
    'the entry must provide the external tutor stylesheet');
  assert.doesNotMatch(html, /<script\b[^>]*src="shared\/js\/ai-tutor\.js/,
    'the tutor script must remain behind the engineering support loader');
}

(async () => {
  await testCacheWarmupUsesTheBootRouter();
  await testAiTutorLoadsOnlyWithEnglabSupport();
  console.log('shell-entry-contract: ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
