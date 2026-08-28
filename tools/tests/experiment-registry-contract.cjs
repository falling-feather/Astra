const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const configSource = read('shared/js/config.js');
const registrySource = read('shared/js/experiment-registry.js');
const moduleSelector = read('shared/js/module-selector.js');
const router = read('shared/js/router.js');
const html = read('index.html');
const main = read('shared/js/main.js');
const serviceWorker = read('sw.js');
const context = { window: {} };

vm.createContext(context);
vm.runInContext(configSource, context, { filename: 'shared/js/config.js' });
vm.runInContext(registrySource, context, { filename: 'shared/js/experiment-registry.js' });

const registry = context.window.AstraExperimentRegistry;
assert.ok(registry, 'experiment registry must be attached before ModuleSelector starts');
assert.ok(Object.isFrozen(registry), 'public experiment registry API must be immutable');
const registryDescriptor = Object.getOwnPropertyDescriptor(context.window, 'AstraExperimentRegistry');
assert.equal(registryDescriptor.configurable, false, 'experiment registry binding must not be reconfigured');
assert.equal(registryDescriptor.writable, false, 'experiment registry binding must not be replaced');

const configIds = vm.runInContext(
    'Object.fromEntries(Object.entries(CONFIG.experiments).map(([subject, entries]) => [subject, entries.map(entry => entry.id)]))',
    context
);
const subjects = ['mathematics', 'physics', 'chemistry', 'algorithms', 'biology'];
const expectedCounts = {
    mathematics: 20,
    physics: 21,
    chemistry: 18,
    algorithms: 12,
    biology: 19
};
const definitions = Array.from(registry.entries());
const doublePendulumConfig = vm.runInContext(
    "CONFIG.experiments.physics.find(entry => entry.id === 'double-pendulum-chaos')",
    context
);
const chromatographyConfig = vm.runInContext(
    "CONFIG.experiments.chemistry.find(entry => entry.id === 'chromatography-separation')",
    context
);

assert.equal(definitions.length, 90);
assert.equal(new Set(definitions.map(entry => `${entry.subject}:${entry.id}`)).size, 90);
assert.equal(doublePendulumConfig.guide, false, 'the showcase module must bypass the legacy first-visit course guide');
assert.equal(chromatographyConfig.guide, false, 'the chemistry showcase must bypass the legacy first-visit course guide');
for (const subject of subjects) {
    const entries = Array.from(registry.entries(subject));
    assert.equal(entries.length, expectedCounts[subject], `${subject} count must remain stable`);
    assert.deepEqual(
        entries.map(entry => entry.id),
        Array.from(configIds[subject]),
        `${subject} runtime order must follow CONFIG.experiments`
    );
}

const domModules = Array.from(html.matchAll(/data-module="([a-z0-9-]+)"/g), match => match[1]);
const registeredIds = new Set(definitions.map(entry => entry.id));
const registeredDomModules = domModules.filter(id => registeredIds.has(id));
assert.equal(registeredDomModules.length, 92, 'Englab DOM keeps three searching sections and one section for every other registered experiment');
assert.equal(new Set(registeredDomModules).size, 90);
assert.equal(registeredDomModules.filter(id => id === 'searching').length, 3);
assert.deepEqual(
    [...new Set(definitions.map(entry => entry.id))].sort(),
    [...new Set(registeredDomModules)].sort(),
    'registry and DOM experiment identities must be a bijection'
);

for (const definition of definitions) {
    assert.ok(Object.isFrozen(definition));
    assert.ok(Object.isFrozen(definition.init));
    assert.ok(Object.isFrozen(definition.cleanup));
    assert.ok(Object.isFrozen(definition.cleanup.owners));
    const scriptPath = definition.script.split('?')[0];
    assert.ok(fs.existsSync(path.join(root, scriptPath)), `${definition.id} script must exist: ${scriptPath}`);
    assert.equal(
        definition.cleanup.verified,
        definition.cleanup.state === 'validated-callback',
        `${definition.id} verified flag must match its validated state`
    );
}

const initModeCounts = definitions.reduce((counts, entry) => {
    counts[entry.init.mode] = (counts[entry.init.mode] || 0) + 1;
    return counts;
}, {});
assert.deepEqual(initModeCounts, { 'global-hook': 90 });
const sorting = registry.get('algorithms', 'sorting');
assert.equal(sorting.init.hook, 'initAlgorithms');
assert.equal(sorting.init.invoke, true);
context.window.initAlgorithms = () => { context.sortingInitCalls = (context.sortingInitCalls || 0) + 1; };
assert.equal(registry.init('algorithms', 'sorting'), true);
assert.equal(context.sortingInitCalls, 1);

context.window.initFunctionGraph = () => { context.initCalls = (context.initCalls || 0) + 1; };
assert.equal(registry.init('mathematics', 'function-graph'), true);
assert.equal(context.initCalls, 1);
assert.equal(registry.init('mathematics', 'unknown'), false);

const cleanupStateCounts = definitions.reduce((counts, entry) => {
    counts[entry.cleanup.state] = (counts[entry.cleanup.state] || 0) + 1;
    return counts;
}, {});
assert.deepEqual(cleanupStateCounts, {
    'legacy-callback': 65,
    'validated-callback': 25
});

const expectedValidated = {
    'mathematics:modeling-numerical': {
        script: 'pages/mathematics/modeling-numerical.js?v=20260618mathModelP1',
        initHook: 'initModelingNumerical',
        owner: 'ModelingNumerical'
    },
    'physics:mechanics': {
        script: 'pages/physics/physics.js?v=20260824v816ExperimentRestoreP2',
        initHook: 'initPhysics',
        owner: 'PhysicsSim'
    },
    'physics:double-pendulum-chaos': {
        script: 'pages/physics/double-pendulum-chaos/index.js?v=20260824v831Show02P0',
        initHook: 'initDoublePendulumChaos',
        owner: 'DoublePendulumChaos'
    },
    'physics:gas-laws': {
        script: 'pages/physics/gas-laws.js?v=20260618publicClean1',
        initHook: 'initGasLaws',
        owner: 'GasLaws'
    },
    'physics:thermodynamics': {
        script: 'pages/physics/thermodynamics.js?v=20260618thermoP1',
        initHook: 'initThermodynamics',
        owner: 'Thermodynamics'
    },
    'physics:atomic-physics': {
        script: 'pages/physics/atomic-physics.js?v=20260618publicClean1',
        initHook: 'initAtomicPhysics',
        owner: 'AtomicPhysics'
    },
    'chemistry:chromatography-separation': {
        script: 'pages/chemistry/chromatography-separation/index.js?v=20260824v832Show03P0',
        initHook: 'initChromatographySeparation',
        owner: 'ChromatographySeparation'
    },
    'chemistry:hybrid-orbitals': {
        script: 'pages/chemistry/hybrid-orbitals.js?v=20260618hybFix1',
        initHook: 'initHybridOrbitals',
        owner: 'HybridOrbitals'
    },
    'chemistry:crystal-structures': {
        script: 'pages/chemistry/crystal-structures.js?v=20260617crystalP2',
        initHook: 'initCrystalStructures',
        owner: 'CrystalStructures'
    },
    'chemistry:experiments': {
        script: 'pages/chemistry/virtual-experiments.js?v=20260618refsP1',
        initHook: 'initChemVirtualExperiments',
        owner: 'ChemVirtualExperiments'
    },
    'algorithms:sorting': {
        script: 'pages/algorithms/algorithms.js?v=20260715v7418MissingCleanupP3',
        initHook: 'initAlgorithms',
        owner: 'SortingLab'
    },
    'algorithms:hash-tables': {
        script: 'pages/algorithms/hash-tables.js?v=20260617bstP1b',
        initHook: 'initHashTablesLab',
        owner: 'HashTablesLab'
    },
    'algorithms:bst-avl': {
        script: 'pages/algorithms/bst-avl.js?v=20260617bstP1b',
        initHook: 'initBSTAVL',
        owner: 'BSTAVL'
    },
    'algorithms:mst-compare': {
        script: 'pages/algorithms/mst-compare.js?v=20260618mstP1',
        initHook: 'initMSTCompare',
        owner: 'MSTCompare'
    },
    'algorithms:greedy-scheduling': {
        script: 'pages/algorithms/greedy-scheduling.js?v=20260618refsP1',
        initHook: 'initGreedyScheduling',
        owner: 'GreedyScheduling'
    },
    'biology:cell-structure': {
        script: 'pages/biology/cell-structure.js?v=20260715v7418MissingCleanupP3',
        initHook: 'initCellStructure',
        owner: 'CellStructure'
    },
    'biology:dna': {
        script: 'pages/biology/dna-helix.js?v=20260715v7419BiologyModeMountP1',
        initHook: 'initDNAHelix',
        owner: 'DNAHelix'
    },
    'biology:photosynthesis': {
        script: 'pages/biology/photosynthesis.js?v=20260715v7417CandidateCleanupP1',
        initHook: 'initPhotosynthesis',
        owner: 'Photosynthesis'
    },
    'biology:enzyme-properties': {
        script: 'pages/biology/enzyme-properties.js?v=20260618enzymeSourceP1b',
        initHook: 'initEnzymeProperties',
        owner: 'EnzymeProperties'
    },
    'biology:homeostasis': {
        script: 'pages/biology/homeostasis.js?v=20260618homeostasisP1',
        initHook: 'initHomeostasis',
        owner: 'Homeostasis'
    },
    'biology:humoral-regulation': {
        script: 'pages/biology/humoral-regulation.js?v=20260618humoralP2',
        initHook: 'initHumoralRegulation',
        owner: 'HumoralRegulation'
    },
    'biology:genetics': {
        script: 'pages/biology/genetics.js?v=20260715v7419BiologyModeMountP1',
        initHook: 'initGenetics',
        owner: 'Genetics'
    },
    'biology:population-community': {
        script: 'pages/biology/population-community.js?v=20260618popcommP1',
        initHook: 'initPopulationCommunity',
        owner: 'PopulationCommunity'
    },
    'biology:material-cycles': {
        script: 'pages/biology/material-cycles.js?v=20260618cyclesP1',
        initHook: 'initMaterialCycles',
        owner: 'MaterialCycles'
    },
    'biology:gene-engineering': {
        script: 'pages/biology/gene-engineering.js?v=20260618gengP1',
        initHook: 'initGeneEngineering',
        owner: 'GeneEngineering'
    }
};

const exactContext = { window: {}, console };
vm.createContext(exactContext);
vm.runInContext(registrySource, exactContext, { filename: 'shared/js/experiment-registry.js' });
const exactRegistry = exactContext.window.AstraExperimentRegistry;
const unknownExact = exactRegistry.cleanupModule('physics', 'not-found');
assert.equal(unknownExact.outcome, 'unknown');
assert.equal(unknownExact.eligible, 0);
assert.equal(unknownExact.skipped, 1);
assert.equal(unknownExact.attempted, 0);
assert.equal(unknownExact.executed, 0);
assert.equal(unknownExact.failed, 0);
assert.ok(Object.isFrozen(unknownExact));

vm.runInContext(`
    globalThis.legacyExactCalls = 0;
    function destroyFunctionGraph() { globalThis.legacyExactCalls += 1; }
`, exactContext);
const unverifiedExact = exactRegistry.cleanupModule('mathematics', 'function-graph');
assert.equal(unverifiedExact.outcome, 'unverified');
assert.equal(unverifiedExact.eligible, 0);
assert.equal(unverifiedExact.skipped, 1);
assert.equal(unverifiedExact.attempted, 0);
assert.equal(unverifiedExact.executed, 0);
assert.equal(unverifiedExact.failed, 0);
assert.equal(exactContext.legacyExactCalls, 0, 'module cleanup must never execute a legacy callback');

const unavailableExact = exactRegistry.cleanupModule('physics', 'mechanics');
assert.equal(unavailableExact.outcome, 'owner-unavailable');
assert.equal(unavailableExact.eligible, 1);
assert.equal(unavailableExact.attempted, 1);
assert.equal(unavailableExact.executed, 0);
assert.equal(unavailableExact.failed, 0);

vm.runInContext(`
    globalThis.modelExactCalls = 0;
    globalThis.otherExactCalls = 0;
    const ModelingNumerical = { destroy() { globalThis.modelExactCalls += 1; } };
    const Thermodynamics = { destroy() { globalThis.otherExactCalls += 1; } };
    const GasLaws = { destroy() { throw new Error('destroy probe'); } };
`, exactContext);
const failedExact = exactRegistry.cleanupModule('physics', 'gas-laws');
assert.equal(failedExact.outcome, 'failed');
assert.equal(failedExact.eligible, 1);
assert.equal(failedExact.attempted, 1);
assert.equal(failedExact.executed, 0);
assert.equal(failedExact.failed, 1);

const cleanedExact = exactRegistry.cleanupModule('mathematics', 'modeling-numerical');
assert.equal(cleanedExact.outcome, 'cleaned');
assert.equal(cleanedExact.eligible, 1);
assert.equal(cleanedExact.skipped, 0);
assert.equal(cleanedExact.attempted, 1);
assert.equal(cleanedExact.executed, 1);
assert.equal(cleanedExact.failed, 0);
assert.equal(exactContext.modelExactCalls, 1);
assert.equal(exactContext.otherExactCalls, 0, 'exact cleanup must not execute another verified owner');
assert.ok(Object.isFrozen(cleanedExact));

assert.deepEqual(
    definitions
        .filter(entry => entry.cleanup.state === 'validated-callback')
        .map(entry => `${entry.subject}:${entry.id}`)
        .sort(),
    Object.keys(expectedValidated).sort()
);
for (const [key, expected] of Object.entries(expectedValidated)) {
    const [subject, id] = key.split(':');
    const definition = registry.get(subject, id);
    assert.equal(definition.script, expected.script, `${key} script must remain exact`);
    assert.equal(definition.init.hook, expected.initHook, `${key} init hook must remain exact`);
    assert.deepEqual(Array.from(definition.cleanup.owners), [expected.owner], `${key} owner must remain exact`);
    assert.equal(definition.cleanup.kind, 'object');
    assert.equal(definition.cleanup.verified, true);
    assert.equal(typeof definition.cleanup.run, 'function');
}
assert.deepEqual(
    definitions
        .filter(entry => entry.cleanup.state === 'missing')
        .map(entry => `${entry.subject}:${entry.id}`)
        .sort(),
    []
);

const searching = registry.get('algorithms', 'searching');
assert.equal(searching.cleanup.kind, 'composite');
assert.deepEqual(Array.from(searching.cleanup.owners), ['SearchComparison', 'TreeTraversal', 'HashSearch']);
assert.equal(typeof searching.cleanup.run, 'function');
assert.equal(registry.get('mathematics', 'function-graph').cleanup.kind, 'function');

context.destroyFunctionGraph = () => { context.destroyCalls = (context.destroyCalls || 0) + 1; };
vm.runInContext(
    'const Calculus = { destroy() { globalThis.calculusDestroyCalls = (globalThis.calculusDestroyCalls || 0) + 1; } };',
    context
);
context.validatedDestroyCalls = {};
vm.runInContext(
    Object.entries(expectedValidated).map(([key, expected]) => (
        `const ${expected.owner} = { destroy() { `
        + `globalThis.validatedDestroyCalls[${JSON.stringify(key)}] = `
        + `(globalThis.validatedDestroyCalls[${JSON.stringify(key)}] || 0) + 1; } };`
    )).join('\n'),
    context
);
const cleanupReport = registry.cleanupPage('mathematics');
assert.equal(cleanupReport.attempted, 20);
assert.equal(cleanupReport.executed, 3);
assert.equal(cleanupReport.failed, 0);
assert.equal(context.destroyCalls, 1);
assert.equal(context.calculusDestroyCalls, 1, 'cleanup closure must resolve a later global lexical binding');
const expectedAttempts = { mathematics: 20, physics: 21, chemistry: 18, algorithms: 12, biology: 19 };
for (const subject of subjects.slice(1)) {
    const report = registry.cleanupPage(subject);
    assert.equal(report.attempted, expectedAttempts[subject], `${subject} executable cleanup count must remain exact`);
    assert.equal(report.failed, 0);
}
for (const key of Object.keys(expectedValidated)) {
    assert.equal(context.validatedDestroyCalls[key], 1, `${key} must execute its exact lexical owner once`);
}

assert.doesNotMatch(registrySource, /destroyPhysics|Biology\.destroy/);
assert.doesNotMatch(moduleSelector, /\b_moduleScripts\s*:|\bconst initMap\s*=/);
assert.match(moduleSelector, /AstraExperimentRegistry\?\.scriptFor\(page, moduleId\)/);
assert.match(moduleSelector, /AstraExperimentRegistry\?\.init\(page, moduleId\)/);
assert.match(moduleSelector, /registry\.cleanupModule\(page, moduleId\)/);
assert.match(moduleSelector, /const guideEnabled = experiment\?\.guide !== false/);
assert.match(moduleSelector, /guide && guideEnabled/);
assert.match(moduleSelector, /guide\.hideHelpButton\(\)/);
assert.match(moduleSelector, /leavePage\(page, options = \{\}\)/);
assert.match(moduleSelector, /AstraExperimentRegistry\?\.cleanupPage\(page\)/);
const leavePageStart = moduleSelector.indexOf('leavePage(page, options = {})');
const leavePageSource = moduleSelector.slice(
    leavePageStart,
    moduleSelector.indexOf('toggleSidebar(page)', leavePageStart)
);
assert.match(leavePageSource, /try \{[\s\S]*this\.closeModule\(page, \{/);
assert.match(leavePageSource, /skipExperimentCleanup: true/);
assert.match(leavePageSource, /try \{[\s\S]*AstraExperimentRegistry\?\.cleanupPage\(page\)/);
assert.match(leavePageSource, /try \{ this\.resetPage\(page\); \} catch/);
const openModuleStart = moduleSelector.indexOf('openModule(page, moduleId, options = {})');
const openModuleEnd = moduleSelector.indexOf('_hideModuleTools()');
assert.ok(openModuleStart >= 0 && openModuleEnd > openModuleStart);
const openModuleSource = moduleSelector.slice(openModuleStart, openModuleEnd);
const closeModuleSource = moduleSelector.slice(
    moduleSelector.indexOf('closeModule(page, options = {})'),
    moduleSelector.indexOf('leavePage(page, options = {})')
);
assert.match(openModuleSource, /_releaseModuleRuntime\(page, prevModule\)/);
assert.match(openModuleSource, /_releaseModuleRuntime\(page, previousModule\)/);
assert.match(closeModuleSource, /_releaseModuleRuntime\(page, activeModule, options\)/);
assert.doesNotMatch(openModuleSource, /cleanupPage|\.cleanup\.run/);
assert.doesNotMatch(closeModuleSource, /cleanupPage|\.cleanup\.run/);
assert.match(moduleSelector, /skipExperimentCleanup: true/);
assert.match(router, /skipExperimentCleanup: true/);

const isolationContext = {
    window: {
        PhysicsZoom: {
            close: () => { isolationContext.order.push('physics-zoom'); }
        },
        BiologyZoom: {
            close: () => { isolationContext.order.push('biology-zoom'); }
        },
        AstraExperimentRegistry: {
            cleanupPage: (page) => {
                isolationContext.order.push(`cleanup:${page}`);
                isolationContext.cleanupCalls = (isolationContext.cleanupCalls || 0) + 1;
                return Object.freeze({ attempted: 1, executed: 1, failed: 0 });
            }
        }
    },
    order: []
};
vm.createContext(isolationContext);
vm.runInContext(moduleSelector, isolationContext, { filename: 'shared/js/module-selector.js' });
const selector = vm.runInContext('ModuleSelector', isolationContext);
selector.activeModule.physics = 'energy-conservation';
selector.closeModule = () => { throw new Error('close failure probe'); };
selector._hideModuleTools = () => { isolationContext.hideCalls = (isolationContext.hideCalls || 0) + 1; };
selector.resetPage = () => { isolationContext.resetCalls = (isolationContext.resetCalls || 0) + 1; };
const isolatedLeaveReport = selector.leavePage('physics', { preserveHash: true });
assert.equal(isolationContext.hideCalls, 1, 'tool hiding must continue after closeModule fails');
assert.equal(isolationContext.cleanupCalls, 1, 'cleanup must continue after closeModule fails');
assert.equal(isolationContext.resetCalls, 1, 'state reset must continue after closeModule fails');
assert.equal(isolatedLeaveReport.executed, 1);
assert.ok(
    isolationContext.order.indexOf('physics-zoom') < isolationContext.order.indexOf('cleanup:physics'),
    'PhysicsZoom must restore its canvas before experiment cleanup'
);
selector.leavePage('biology', { preserveHash: true });
assert.ok(
    isolationContext.order.indexOf('biology-zoom') < isolationContext.order.indexOf('cleanup:biology'),
    'BiologyZoom must restore its canvas before experiment cleanup'
);

assert.doesNotMatch(router, /\bconst destroyMap\s*=/);
assert.match(router, /ModuleSelector\.leavePage\(page, \{ preserveHash: true \}\)/);
assert.match(html, /config\.js[\s\S]*experiment-registry\.js[\s\S]*page-registry\.js[\s\S]*router\.js[\s\S]*main\.js/);
assert.match(main, /experiment-registry\.js\?v=20260824v832Show03P0/);
assert.match(main, /module-selector\.js\?v=20260824v832Show03P0/);
assert.match(serviceWorker, /experiment-registry\.js\?v=20260824v832Show03P0/);
assert.match(serviceWorker, /astra-static-v20260828v866StudentProjectionP0/);

console.log('experiment-registry-contract: ok');
