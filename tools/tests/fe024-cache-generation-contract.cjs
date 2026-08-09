const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const generation = '20260809v805MechanicsSequenceP0';
const frontierGeneration = '20260809v804FutureEvidenceP0';

const html = read('index.html');
const router = read('shared/js/router.js');
const session = read('shared/js/app-session.js');
const loader = read('shared/js/learning-evidence-loader.js');
const experimentRegistry = read('shared/js/experiment-registry.js');
const main = read('shared/js/main.js');
const serviceWorker = read('sw.js');
const developerDoc = read('doc/01-开发者文档.md');
const frontendDoc = read('doc/08-前端页面实现索引.md');

class FakeResource {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.dataset = {};
    this.listeners = new Map();
    this.src = '';
    this.href = '';
    this.async = false;
    this.isConnected = true;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }

  emit(type) {
    const listener = this.listeners.get(type);
    if (listener) listener.call(this, { type, target: this });
  }

  remove() {
    this.isConnected = false;
  }
}

function testStaticGenerationChain() {
  for (const asset of ['app-session', 'experiment-registry', 'page-registry', 'router', 'main']) {
    assert.match(
      html,
      new RegExp(`shared/js/${asset}\\.js\\?v=${generation}`),
      `index direct boot must request ${asset}.js from the V805 generation`,
    );
  }
  assert.match(router, new RegExp(`shared/js/module-selector\\.js\\?v=${generation}`));
  assert.match(router, new RegExp(`shared/js/frontier-learning\\.js\\?v=${frontierGeneration}`));
  assert.match(experimentRegistry, new RegExp(`pages/physics/physics\\.js\\?v=${generation}`));
  assert.match(main, new RegExp(`const SHELL_RUNTIME_ASSET_VERSION = '${generation}'`));
  assert.match(main, new RegExp(`const PAGE_REGISTRY_ASSET_VERSION = '${generation}'`));
  assert.match(main, /'\.\/shared\/js\/app-session\.js\?v=' \+ SHELL_RUNTIME_ASSET_VERSION/);
  assert.match(main, /'\.\/shared\/js\/experiment-registry\.js\?v=' \+ SHELL_RUNTIME_ASSET_VERSION/);
  assert.match(main, /'\.\/shared\/js\/module-selector\.js\?v=' \+ SHELL_RUNTIME_ASSET_VERSION/);
  assert.match(main, /serviceWorker\.register\('\.\/sw\.js\?v=' \+ SHELL_RUNTIME_ASSET_VERSION\)/);
  assert.match(serviceWorker, new RegExp(`const CACHE_NAME = 'astra-static-v${generation}'`));
  for (const asset of ['app-session', 'experiment-registry', 'page-registry', 'router', 'main']) {
    assert.match(
      serviceWorker,
      new RegExp(`'\\./shared/js/${asset}\\.js\\?v=${generation}'`),
      `service-worker app shell must precache ${asset}.js from the V805 generation`,
    );
  }
  for (const document of [developerDoc, frontendDoc]) {
    assert.match(document, new RegExp(generation));
    assert.match(document, /app-session[\s\S]*loader[\s\S]*(?:queue|client)[\s\S]*(?:catalog|activity)/);
    assert.match(document, /ARCH-004/);
    assert.match(document, /Browser[^\n]*NOT-RUN|Browser NOT-RUN/);
  }
}

async function testAppSessionCreatesVersionedLoader() {
  const createdScripts = [];
  const scripts = [];
  let context;
  const document = {
    baseURI: 'https://astra.test/',
    currentScript: { src: `https://astra.test/shared/js/app-session.js?v=${generation}` },
    scripts,
    head: {
      appendChild(resource) {
        scripts.push(resource);
        createdScripts.push(resource.src);
        queueMicrotask(() => {
          context.AstraLearningEvidenceLoader = Object.freeze({});
          resource.emit('load');
        });
        return resource;
      },
    },
    createElement: (tagName) => new FakeResource(tagName),
  };
  const instrumented = session.replace(
    'global.AstraApplicationSession = Object.freeze({',
    'global.__fe024EnsureLearningEvidenceLoader = ensureLearningEvidenceLoader;\n    global.AstraApplicationSession = Object.freeze({',
  );
  assert.notEqual(instrumented, session, 'app-session loader instrumentation must apply');
  context = {
    console,
    URL,
    URLSearchParams,
    document,
    location: { href: 'https://astra.test/', search: '' },
    addEventListener() {},
    dispatchEvent() {},
    setTimeout,
    clearTimeout,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(instrumented, context, { filename: 'app-session.js' });
  await context.__fe024EnsureLearningEvidenceLoader();
  assert.deepEqual(createdScripts, [
    `https://astra.test/shared/js/learning-evidence-loader.js?v=${generation}`,
  ], 'app-session must propagate its exact V805 query to the loader it actually creates');
}

async function testLoaderCreatesVersionedChildren() {
  const childScripts = [];
  const scripts = [];
  const storage = {
    getItem() { return null; },
    setItem() {},
    removeItem() {},
  };
  let cookie = '';
  let context;
  const ownerByFile = {
    'learning-evidence-queue.js': 'AstraLearningEvidenceQueue',
    'learning-evidence-client.js': 'AstraLearningEvidenceClient',
    'learning-evidence-status.js': 'AstraLearningEvidenceStatus',
    'learning-activity-catalog.js': 'AstraLearningActivityCatalog',
    'engineering-lab-publication-context.js': 'AstraEngineeringLabPublicationContext',
    'learning-evidence-activity.js': 'AstraLearningEvidenceActivity',
  };
  const document = {
    baseURI: 'https://astra.test/',
    currentScript: { src: `https://astra.test/shared/js/learning-evidence-loader.js?v=${generation}` },
    scripts,
    querySelectorAll() { return []; },
    createElement: (tagName) => new FakeResource(tagName),
    head: {
      appendChild(resource) {
        if (resource.tagName !== 'SCRIPT') return resource;
        scripts.push(resource);
        childScripts.push(resource.src);
        const file = path.posix.basename(new URL(resource.src).pathname);
        queueMicrotask(() => {
          context[ownerByFile[file]] = Object.freeze({});
          resource.emit('load');
        });
        return resource;
      },
    },
  };
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get() { return cookie; },
    set(value) { cookie = String(value); },
  });
  context = {
    console: { warn() {}, error() {} },
    URL,
    document,
    location: { origin: 'https://astra.test' },
    localStorage: storage,
    BroadcastChannel: undefined,
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(loader, context, { filename: 'learning-evidence-loader.js' });
  await context.AstraLearningEvidenceLoader.ensure({ activity: true, engineeringContext: true });
  assert.deepEqual(childScripts, Object.keys(ownerByFile).map((file) => (
    `https://astra.test/shared/js/${file}?v=${generation}`
  )), 'loader must propagate V805 to every queue/client/status/catalog/engineering-context/activity script it creates');
}

async function run() {
  testStaticGenerationChain();
  await testAppSessionCreatesVersionedLoader();
  await testLoaderCreatesVersionedChildren();
  console.log('fe024-cache-generation-contract: ok');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
