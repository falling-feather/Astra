const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const generation = '20260828v861PresentationCleanupP3';
const legacyShellGeneration = '20260824v816ExperimentRestoreP2';
const showcaseGeneration = '20260824v832Show03P0';
const show04Generation = '20260825v834Show04P0';
const v834Generation = '20260813v834ShowcaseLayoutP0';
const moduleGeneration = showcaseGeneration;
const studentGeneration = generation;
const teacherGeneration = '20260828v861PresentationCleanupP3';
const physicsGeneration = legacyShellGeneration;
const frontierGeneration = legacyShellGeneration;

const html = read('index.html');
const router = read('shared/js/router.js');
const session = read('shared/js/app-session.js');
const loader = read('shared/js/learning-evidence-loader.js');
const experimentRegistry = read('shared/js/experiment-registry.js');
const pageRegistry = read('shared/js/page-registry.js');
const frontierLearning = read('shared/js/frontier-learning.js');
const studentLearningEvidence = read('shared/js/student-learning-evidence.js');
const main = read('shared/js/main.js');
const serviceWorker = read('sw.js');
const developerDoc = read('doc/01-开发者手册.md');
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
  for (const asset of ['app-session']) {
    assert.match(
      html,
      new RegExp(`shared/js/${asset}\\.js\\?v=${generation}`),
      `index direct boot must request ${asset}.js from the V840 generation`,
    );
  }
  for (const asset of ['experiment-registry']) {
    assert.match(
      html,
      new RegExp(`shared/js/${asset}\\.js\\?v=${showcaseGeneration}`),
      `index direct boot must request ${asset}.js from the SHOW-03 generation`,
    );
  }
  assert.match(html, new RegExp(`shared/js/router\\.js\\?v=${generation}`));
  for (const asset of ['config', 'page-registry', 'main']) {
    assert.match(html, new RegExp(`shared/js/${asset}\\.js\\?v=${generation}`));
  }
  assert.match(router, new RegExp(`shared/js/module-selector\\.js\\?v=${moduleGeneration}`));
  assert.match(router, new RegExp(`shared/js/frontier-learning\\.js\\?v=${frontierGeneration}`));
  assert.match(experimentRegistry, new RegExp(`pages/physics/physics\\.js\\?v=${physicsGeneration}`));
  assert.match(html, new RegExp(`pages/engineering/engineering\\.css\\?v=${physicsGeneration}`));
  assert.match(html, new RegExp(`pages/physics/physics\\.css\\?v=${physicsGeneration}`));
  assert.match(pageRegistry, new RegExp(`const ROLE_RESOURCE_VERSION = '${studentGeneration}'`));
  assert.match(pageRegistry, new RegExp(`const TEACHER_RESOURCE_VERSION = '${teacherGeneration}'`));
  assert.match(pageRegistry, new RegExp(`const FUTURE_RESOURCE_VERSION = '${frontierGeneration}'`));
  assert.match(frontierLearning, new RegExp(`pages/frontier/frontier\\.css\\?v=${frontierGeneration}`));
  assert.match(frontierLearning, new RegExp(`pages/engineering/bridge-truss\\.js\\?v=${physicsGeneration}`));
  assert.match(main, new RegExp(`pages/physics/physics\\.css\\?v=${physicsGeneration}`));
  assert.match(main, new RegExp(`pages/frontier/frontier\\.css\\?v=${frontierGeneration}`));
  assert.match(main, new RegExp(`shared/js/frontier-learning\\.js\\?v=${frontierGeneration}`));
  assert.doesNotMatch(studentLearningEvidence, /0051 RECOVERY|权威学习投影|SERVER PROJECTION ONLY/);
  assert.match(studentLearningEvidence, /学习进度[\s\S]*进度同步[\s\S]*学习活动记录[\s\S]*课程记录/);
  assert.match(main, new RegExp(`const SHELL_RUNTIME_ASSET_VERSION = '${generation}'`));
  assert.match(main, new RegExp(`const PAGE_REGISTRY_ASSET_VERSION = '${generation}'`));
  assert.match(main, /'\.\/shared\/js\/app-session\.js\?v=' \+ SHELL_RUNTIME_ASSET_VERSION/);
  assert.match(main, /'\.\/shared\/js\/config\.js\?v=' \+ PAGE_REGISTRY_ASSET_VERSION/);
  assert.match(main, new RegExp(`'\\./shared/js/experiment-registry\\.js\\?v=${showcaseGeneration}'`));
  assert.match(main, new RegExp(`'\\./shared/js/module-selector\\.js\\?v=${showcaseGeneration}'`));
  assert.match(main, /serviceWorker\.register\('\.\/sw\.js\?v=' \+ SHELL_RUNTIME_ASSET_VERSION\)/);
  assert.match(serviceWorker, new RegExp(`const CACHE_NAME = 'astra-static-v${generation}'`));
  for (const asset of ['app-session', 'router']) {
    assert.match(
      serviceWorker,
      new RegExp(`'\\./shared/js/${asset}\\.js\\?v=${generation}'`),
      `service-worker app shell must precache ${asset}.js from the V840 generation`,
    );
  }
  const experimentRegistryShellVersion = serviceWorker.match(/'\.\/shared\/js\/experiment-registry\.js\?v=([^']+)'/)?.[1];
  assert.ok(
    [legacyShellGeneration, showcaseGeneration].includes(experimentRegistryShellVersion),
    'service-worker experiment registry must stay on an explicitly reviewed generation',
  );
  for (const document of [developerDoc, frontendDoc]) {
    assert.match(document, new RegExp(v834Generation));
    assert.match(document, /app-session[\s\S]*loader[\s\S]*(?:queue|client)[\s\S]*(?:catalog|activity)/);
    assert.match(document, /ARCH-004/);
    const v834EvidenceLine = document
      .split(/\r?\n/)
      .find((line) => line.includes('V8.0.34') && line.includes(v834Generation));
    assert.ok(v834EvidenceLine, 'V8.0.34 documentation must identify the exact V834 cache generation');
    assert.match(v834EvidenceLine, /QA-023/);
    assert.match(v834EvidenceLine, /V832[\s\S]*V833[\s\S]*V834/);
    assert.match(v834EvidenceLine, /待同 revision 复验/);
  }
  for (const asset of ['page-registry', 'main']) {
    assert.match(serviceWorker, new RegExp(`'\\./shared/js/${asset}\\.js\\?v=${generation}'`));
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
  ], 'app-session must propagate its exact V840 query to the loader it actually creates');
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
  )), 'loader must propagate V840 to every queue/client/status/catalog/engineering-context/activity script it creates');
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
