// ===== Astra Experiment Registry =====
// Single source of truth for experiment scripts, init hooks, and the current
// page-leave cleanup compatibility boundary. CONFIG.experiments remains the
// presentation/order authority; this registry owns runtime wiring only.

(() => {
    const invokeFunction = (getter) => () => {
        let fn;
        try { fn = getter(); } catch (error) { return false; }
        if (typeof fn !== 'function') return false;
        fn();
        return true;
    };

    const invokeMethod = (getter, method = 'destroy') => () => {
        let target;
        try { target = getter(); } catch (error) { return false; }
        if (!target || typeof target[method] !== 'function') return false;
        target[method]();
        return true;
    };

    const invokeComposite = (...runners) => () => {
        let executed = false;
        runners.forEach((run) => {
            try { executed = run() || executed; } catch (error) { /* keep legacy best-effort cleanup */ }
        });
        return executed;
    };

    const legacyFunction = (owner, getter) => ({
        state: 'legacy-callback',
        kind: 'function',
        owners: [owner],
        verified: false,
        run: invokeFunction(getter)
    });

    const legacyMethod = (owner, getter) => ({
        state: 'legacy-callback',
        kind: 'object',
        owners: [owner],
        verified: false,
        run: invokeMethod(getter)
    });

    const legacyComposite = (owners, runners) => ({
        state: 'legacy-callback',
        kind: 'composite',
        owners,
        verified: false,
        run: invokeComposite(...runners)
    });

    const validatedMethod = (owner, getter) => ({
        state: 'validated-callback',
        kind: 'object',
        owners: [owner],
        verified: true,
        run: invokeMethod(getter)
    });

    const missing = (owner) => ({
        state: 'missing',
        kind: 'none',
        owners: [owner],
        verified: false,
        run: null
    });

    const define = (subject, id, script, initHook, cleanup, initMode = 'global-hook') => {
        const init = Object.freeze({
            mode: initMode,
            hook: initHook,
            invoke: initMode === 'global-hook'
        });
        const frozenCleanup = Object.freeze({
            ...cleanup,
            owners: Object.freeze([...cleanup.owners])
        });
        return Object.freeze({ id, subject, script, init, cleanup: frozenCleanup });
    };

    const definitions = Object.freeze([
        // Mathematics — CONFIG order
        define('mathematics', 'function-graph', 'pages/mathematics/mathematics.js', 'initFunctionGraph', legacyFunction('destroyFunctionGraph', () => destroyFunctionGraph)),
        define('mathematics', 'calculus', 'pages/mathematics/calculus.js', 'initCalculus', legacyMethod('Calculus', () => Calculus)),
        define('mathematics', 'geometry', 'pages/mathematics/geometry.js', 'initGeoTransform', legacyMethod('GeoTransform', () => GeoTransform)),
        define('mathematics', 'complex', 'pages/mathematics/complex-numbers.js', 'initComplexVis', legacyMethod('ComplexVis', () => ComplexVis)),
        define('mathematics', 'trigonometry', 'pages/mathematics/trigonometry.js', 'initTrigVis', legacyMethod('TrigVis', () => TrigVis)),
        define('mathematics', 'set-operations', 'pages/mathematics/set-operations.js', 'initSetOps', legacyMethod('SetOps', () => SetOps)),
        define('mathematics', 'probability', 'pages/mathematics/probability.js', 'initProbability', legacyMethod('Probability', () => Probability)),
        define('mathematics', 'vector-ops', 'pages/mathematics/vector-ops.js', 'initVectorOps', legacyMethod('VectorOps', () => VectorOps)),
        define('mathematics', 'inequality', 'pages/mathematics/inequality.js', 'initInequality', legacyMethod('Inequality', () => Inequality)),
        define('mathematics', 'conic-sections', 'pages/mathematics/conic-sections.js', 'initConicSections', legacyMethod('ConicSections', () => ConicSections)),
        define('mathematics', 'solid-geometry', 'pages/mathematics/solid-geometry.js', 'initSolidGeom', legacyMethod('SolidGeom', () => SolidGeom)),
        define('mathematics', 'permutation-combination', 'pages/mathematics/permutation-combination.js', 'initPermComb', legacyMethod('PermComb', () => PermComb)),
        define('mathematics', 'sequences', 'pages/mathematics/sequences.js', 'initSequences', legacyMethod('Sequences', () => Sequences)),
        define('mathematics', 'function-properties', 'pages/mathematics/function-properties.js', 'initFuncProps', legacyMethod('FuncProps', () => FuncProps)),
        define('mathematics', 'exp-log', 'pages/mathematics/exp-log.js', 'initExpLog', legacyMethod('ExpLog', () => ExpLog)),
        define('mathematics', 'binomial-theorem', 'pages/mathematics/binomial-theorem.js', 'initBinomial', legacyMethod('Binomial', () => Binomial)),
        define('mathematics', 'statistics-regression', 'pages/mathematics/statistics-regression.js', 'initStatReg', legacyMethod('StatReg', () => StatReg)),
        define('mathematics', 'modeling-numerical', 'pages/mathematics/modeling-numerical.js?v=20260618mathModelP1', 'initModelingNumerical', validatedMethod('ModelingNumerical', () => ModelingNumerical)),
        define('mathematics', 'spatial-vector', 'pages/mathematics/spatial-vector.js', 'initSpatialVec', legacyMethod('SpatialVec', () => SpatialVec)),
        define('mathematics', 'derivative-application', 'pages/mathematics/derivative-application.js?v=20260606fix1', 'initDerivApp', legacyMethod('DerivApp', () => DerivApp)),

        // Physics — CONFIG order
        define('physics', 'mechanics', 'pages/physics/physics.js?v=20260824v816ExperimentRestoreP2', 'initPhysics', validatedMethod('PhysicsSim', () => PhysicsSim)),
        define('physics', 'double-pendulum-chaos', 'pages/physics/double-pendulum-chaos/index.js?v=20260824v831Show02P0', 'initDoublePendulumChaos', validatedMethod('DoublePendulumChaos', () => DoublePendulumChaos)),
        define('physics', 'gas-laws', 'pages/physics/gas-laws.js?v=20260618publicClean1', 'initGasLaws', validatedMethod('GasLaws', () => GasLaws)),
        define('physics', 'thermodynamics', 'pages/physics/thermodynamics.js?v=20260618thermoP1', 'initThermodynamics', validatedMethod('Thermodynamics', () => Thermodynamics)),
        define('physics', 'electromagnetism', 'pages/physics/electromagnetic.js', 'initElectromagnetic', legacyMethod('EMField', () => EMField)),
        define('physics', 'waves', 'pages/physics/waves.js', 'initWaves', legacyMethod('WaveDemo', () => WaveDemo)),
        define('physics', 'relativity', 'pages/physics/relativity.js', 'initRelativity', legacyMethod('RelativityDemo', () => RelativityDemo)),
        define('physics', 'kinematics', 'pages/physics/kinematics.js', 'initKinematics', legacyMethod('Kinematics', () => Kinematics)),
        define('physics', 'projectile', 'pages/physics/projectile.js', 'initProjectile', legacyMethod('Projectile', () => Projectile)),
        define('physics', 'circular-motion', 'pages/physics/circular-motion.js', 'initCircularMotion', legacyMethod('CircularMotion', () => CircularMotion)),
        define('physics', 'energy-conservation', 'pages/physics/energy-conservation.js?v=20260424v46b', 'initEnergyConservation', legacyMethod('EnergyConservation', () => EnergyConservation)),
        define('physics', 'circuit-analysis', 'pages/physics/circuit-analysis.js', 'initCircuitAnalysis', legacyMethod('CircuitAnalysis', () => CircuitAnalysis)),
        define('physics', 'em-induction', 'pages/physics/electromagnetic-induction.js', 'initEMInduction', legacyMethod('EMInduction', () => EMInduction)),
        define('physics', 'alternating-current', 'pages/physics/alternating-current.js', 'initACCircuit', legacyMethod('ACCircuit', () => ACCircuit)),
        define('physics', 'fluid-dynamics', 'pages/physics/fluid-dynamics.js?v=20260424v46e', 'initFluidDynamics', legacyMethod('FluidSim', () => FluidSim)),
        define('physics', 'optics', 'pages/physics/optics.js', 'initOptics', legacyMethod('OpticsLab', () => OpticsLab)),
        define('physics', 'gravitation', 'pages/physics/gravitation.js?v=20260424v46d', 'initGravitation', legacyMethod('Gravitation', () => Gravitation)),
        define('physics', 'force-composition', 'pages/physics/force-composition.js?v=20260424v46a', 'initForceComposition', legacyMethod('ForceComposition', () => ForceComposition)),
        define('physics', 'momentum-conservation', 'pages/physics/momentum-conservation.js?v=20260424v46c', 'initMomentumConservation', legacyMethod('MomentumConservation', () => MomentumConservation)),
        define('physics', 'charged-particle', 'pages/physics/charged-particle.js', 'initChargedParticle', legacyMethod('ChargedParticle', () => ChargedParticle)),
        define('physics', 'atomic-physics', 'pages/physics/atomic-physics.js?v=20260618publicClean1', 'initAtomicPhysics', validatedMethod('AtomicPhysics', () => AtomicPhysics)),

        // Chemistry — CONFIG order
        define('chemistry', 'chromatography-separation', 'pages/chemistry/chromatography-separation/index.js?v=20260824v832Show03P0', 'initChromatographySeparation', validatedMethod('ChromatographySeparation', () => ChromatographySeparation)),
        define('chemistry', 'periodic-table', 'pages/chemistry/periodic-table.js?v=20260618ptNames1', 'initPeriodicTable', legacyMethod('PeriodicTable', () => PeriodicTable)),
        define('chemistry', 'molecular-structure', 'pages/chemistry/molecular-structure.js?v=20260424v45e', 'initMoleculeVis', legacyMethod('MoleculeVis', () => MoleculeVis)),
        define('chemistry', 'hybrid-orbitals', 'pages/chemistry/hybrid-orbitals.js?v=20260618hybFix1', 'initHybridOrbitals', validatedMethod('HybridOrbitals', () => HybridOrbitals)),
        define('chemistry', 'crystal-structures', 'pages/chemistry/crystal-structures.js?v=20260617crystalP2', 'initCrystalStructures', validatedMethod('CrystalStructures', () => CrystalStructures)),
        define('chemistry', 'reactions', 'pages/chemistry/chemical-reactions.js?v=20260424v45g', 'initChemReaction', legacyMethod('ChemReaction', () => ChemReaction)),
        define('chemistry', 'chemical-equilibrium', 'pages/chemistry/chemical-equilibrium.js?v=20260606chem1', 'initChemEquilibrium', legacyMethod('ChemEquilibrium', () => ChemEquilibrium)),
        define('chemistry', 'electrochemistry', 'pages/chemistry/electrochemistry.js?v=20260606chem1', 'initElectrochemistry', legacyMethod('Electrochemistry', () => Electrochemistry)),
        define('chemistry', 'chemical-bond', 'pages/chemistry/chemical-bond.js?v=20260424v45h', 'initChemBond', legacyMethod('ChemBond', () => ChemBond)),
        define('chemistry', 'organic-chemistry', 'pages/chemistry/organic-chemistry.js?v=20260424v45i', 'initOrganicChem', legacyMethod('OrganicChem', () => OrganicChem)),
        define('chemistry', 'reaction-rate', 'pages/chemistry/reaction-rate.js?v=20260618rateP1', 'initReactionRate', legacyMethod('ReactionRate', () => ReactionRate)),
        define('chemistry', 'solution-ionization', 'pages/chemistry/solution-ionization.js?v=20260618ionP1', 'initSolutionIon', legacyMethod('SolutionIon', () => SolutionIon)),
        define('chemistry', 'ionic-reaction', 'pages/chemistry/ionic-reaction.js', 'initIonicReaction', legacyMethod('IonicReaction', () => IonicReaction)),
        define('chemistry', 'redox', 'pages/chemistry/redox.js?v=20260618redoxP1', 'initRedox', legacyMethod('Redox', () => Redox)),
        define('chemistry', 'atomic-structure', 'pages/chemistry/atomic-structure.js', 'initAtomicStructure', legacyMethod('AtomicStructure', () => AtomicStructure)),
        define('chemistry', 'element-compounds', 'pages/chemistry/element-compounds.js?v=20260530v62a', 'initElementCompounds', legacyMethod('ElementCompounds', () => ElementCompounds)),
        define('chemistry', 'intermolecular-forces', 'pages/chemistry/intermolecular-forces.js?v=20260617gasP1b', 'initIntermolecular', legacyMethod('Intermolecular', () => Intermolecular)),
        define('chemistry', 'experiments', 'pages/chemistry/virtual-experiments.js?v=20260618refsP1', 'initChemVirtualExperiments', validatedMethod('ChemVirtualExperiments', () => ChemVirtualExperiments)),

        // Algorithms — CONFIG order
        define('algorithms', 'sorting', 'pages/algorithms/algorithms.js?v=20260715v7418MissingCleanupP3', 'initAlgorithms', validatedMethod('SortingLab', () => SortingLab)),
        define('algorithms', 'searching', 'pages/algorithms/search-algorithms.js', 'initSearchAlgorithms', legacyComposite(
            ['SearchComparison', 'TreeTraversal', 'HashSearch'],
            [invokeMethod(() => SearchComparison), invokeMethod(() => TreeTraversal), invokeMethod(() => HashSearch)]
        )),
        define('algorithms', 'hash-tables', 'pages/algorithms/hash-tables.js?v=20260617bstP1b', 'initHashTablesLab', validatedMethod('HashTablesLab', () => HashTablesLab)),
        define('algorithms', 'bst-avl', 'pages/algorithms/bst-avl.js?v=20260617bstP1b', 'initBSTAVL', validatedMethod('BSTAVL', () => BSTAVL)),
        define('algorithms', 'graph', 'pages/algorithms/graph-algo.js', 'initGraphAlgo', legacyMethod('GraphAlgo', () => GraphAlgo)),
        define('algorithms', 'mst-compare', 'pages/algorithms/mst-compare.js?v=20260618mstP1', 'initMSTCompare', validatedMethod('MSTCompare', () => MSTCompare)),
        define('algorithms', 'greedy-scheduling', 'pages/algorithms/greedy-scheduling.js?v=20260618refsP1', 'initGreedyScheduling', validatedMethod('GreedyScheduling', () => GreedyScheduling)),
        define('algorithms', 'data-structures', 'pages/algorithms/data-structures.js', 'initDataStructVis', legacyMethod('DataStructVis', () => DataStructVis)),
        define('algorithms', 'sorting-compare', 'pages/algorithms/sorting-compare.js', 'initSortCompare', legacyMethod('SortCompare', () => SortCompare)),
        define('algorithms', 'recursion-vis', 'pages/algorithms/recursion-vis.js', 'initRecursionVis', legacyMethod('RecursionVis', () => RecursionVis)),
        define('algorithms', 'dynamic-programming', 'pages/algorithms/dynamic-programming.js?v=20260618algoTextP1', 'initDPVis', legacyMethod('DPVis', () => DPVis)),
        define('algorithms', 'string-matching', 'pages/algorithms/string-matching.js?v=20260618algoTextP1', 'initStringMatch', legacyMethod('StringMatch', () => StringMatch)),

        // Biology — CONFIG order
        define('biology', 'cell-structure', 'pages/biology/cell-structure.js?v=20260715v7418MissingCleanupP3', 'initCellStructure', validatedMethod('CellStructure', () => CellStructure)),
        define('biology', 'dna', 'pages/biology/dna-helix.js?v=20260715v7419BiologyModeMountP1', 'initDNAHelix', validatedMethod('DNAHelix', () => DNAHelix)),
        define('biology', 'photosynthesis', 'pages/biology/photosynthesis.js?v=20260715v7417CandidateCleanupP1', 'initPhotosynthesis', validatedMethod('Photosynthesis', () => Photosynthesis)),
        define('biology', 'enzyme-properties', 'pages/biology/enzyme-properties.js?v=20260618enzymeSourceP1b', 'initEnzymeProperties', validatedMethod('EnzymeProperties', () => EnzymeProperties)),
        define('biology', 'homeostasis', 'pages/biology/homeostasis.js?v=20260618homeostasisP1', 'initHomeostasis', validatedMethod('Homeostasis', () => Homeostasis)),
        define('biology', 'humoral-regulation', 'pages/biology/humoral-regulation.js?v=20260618humoralP2', 'initHumoralRegulation', validatedMethod('HumoralRegulation', () => HumoralRegulation)),
        define('biology', 'genetics', 'pages/biology/genetics.js?v=20260715v7419BiologyModeMountP1', 'initGenetics', validatedMethod('Genetics', () => Genetics)),
        define('biology', 'mitosis', 'pages/biology/mitosis.js?v=20260617gasP1b', 'initMitosis', legacyMethod('Mitosis', () => Mitosis)),
        define('biology', 'neural-regulation', 'pages/biology/neural-regulation.js?v=20260618neuralP1', 'initNeuralReg', legacyMethod('NeuralReg', () => NeuralReg)),
        define('biology', 'immune-system', 'pages/biology/immune-system.js?v=20260618immuneP2', 'initImmuneSystem', legacyMethod('ImmuneSystem', () => ImmuneSystem)),
        define('biology', 'population-community', 'pages/biology/population-community.js?v=20260618popcommP1', 'initPopulationCommunity', validatedMethod('PopulationCommunity', () => PopulationCommunity)),
        define('biology', 'material-cycles', 'pages/biology/material-cycles.js?v=20260618cyclesP1', 'initMaterialCycles', validatedMethod('MaterialCycles', () => MaterialCycles)),
        define('biology', 'ecosystem', 'pages/biology/ecosystem.js?v=20260423a', 'initEcosystem', legacyMethod('Ecosystem', () => Ecosystem)),
        define('biology', 'meiosis', 'pages/biology/meiosis.js?v=20260617gasP1b', 'initMeiosis', legacyMethod('Meiosis', () => Meiosis)),
        define('biology', 'gene-expression', 'pages/biology/gene-expression.js?v=20260618genexpP1', 'initGeneExpression', legacyMethod('GeneExpression', () => GeneExpression)),
        define('biology', 'gene-engineering', 'pages/biology/gene-engineering.js?v=20260618gengP1', 'initGeneEngineering', validatedMethod('GeneEngineering', () => GeneEngineering)),
        define('biology', 'cellular-respiration', 'pages/biology/cellular-respiration.js?v=20260618cellRespSourceP1', 'initCellularResp', legacyMethod('CellularResp', () => CellularResp)),
        define('biology', 'substance-transport', 'pages/biology/substance-transport.js?v=20260618transportSourceP1', 'initSubstanceTransport', legacyMethod('SubstanceTransport', () => SubstanceTransport)),
        define('biology', 'gene-mutation', 'pages/biology/gene-mutation.js?v=20260618gmutP3', 'initGeneMutation', legacyMethod('GeneMutation', () => GeneMutation))
    ]);

    const byKey = new Map();
    const bySubject = new Map();
    definitions.forEach((definition) => {
        const key = `${definition.subject}:${definition.id}`;
        if (byKey.has(key)) throw new Error(`Duplicate experiment registry key: ${key}`);
        byKey.set(key, definition);
        if (!bySubject.has(definition.subject)) bySubject.set(definition.subject, []);
        bySubject.get(definition.subject).push(definition);
    });
    bySubject.forEach((entries, subject) => bySubject.set(subject, Object.freeze([...entries])));

    const get = (subject, id) => byKey.get(`${subject}:${id}`) || null;

    const moduleCleanupReport = (outcome, overrides = {}) => Object.freeze({
        outcome,
        eligible: 0,
        skipped: 0,
        attempted: 0,
        executed: 0,
        failed: 0,
        ...overrides
    });

    const api = Object.freeze({
        entries: (subject = null) => subject
            ? (bySubject.get(subject) || Object.freeze([]))
            : definitions,
        get,
        scriptFor: (subject, id) => get(subject, id)?.script || null,
        init: (subject, id) => {
            const definition = get(subject, id);
            if (!definition) return false;
            if (!definition.init.invoke) return true;
            const fn = window[definition.init.hook];
            if (typeof fn !== 'function') return false;
            fn();
            return true;
        },
        cleanupModule: (subject, id) => {
            const definition = get(subject, id);
            if (!definition) {
                return moduleCleanupReport('unknown', { skipped: 1 });
            }
            if (definition.cleanup.verified !== true) {
                return moduleCleanupReport('unverified', { skipped: 1 });
            }
            const run = definition.cleanup.run;
            if (typeof run !== 'function') {
                return moduleCleanupReport('owner-unavailable', { eligible: 1 });
            }
            try {
                if (!run()) {
                    return moduleCleanupReport('owner-unavailable', {
                        eligible: 1,
                        attempted: 1
                    });
                }
                return moduleCleanupReport('cleaned', {
                    eligible: 1,
                    attempted: 1,
                    executed: 1
                });
            } catch (error) {
                return moduleCleanupReport('failed', {
                    eligible: 1,
                    attempted: 1,
                    failed: 1
                });
            }
        },
        cleanupPage: (subject) => {
            const report = { attempted: 0, executed: 0, failed: 0 };
            (bySubject.get(subject) || []).forEach((definition) => {
                const run = definition.cleanup.run;
                if (typeof run !== 'function') return;
                report.attempted += 1;
                try {
                    if (run()) report.executed += 1;
                } catch (error) {
                    report.failed += 1;
                }
            });
            return Object.freeze(report);
        }
    });

    Object.defineProperty(window, 'AstraExperimentRegistry', {
        value: api,
        configurable: false,
        enumerable: true,
        writable: false
    });
})();
