const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const bridge = fs.readFileSync(path.join(root, 'pages/engineering/bridge-truss.js'), 'utf8');
const frontier = fs.readFileSync(path.join(root, 'pages/frontier/frontier.css'), 'utf8');
const physics = fs.readFileSync(path.join(root, 'pages/physics/physics.js'), 'utf8');
const physicsCss = fs.readFileSync(path.join(root, 'pages/physics/physics.css'), 'utf8');

for (const selector of ['data-load-path-brief', 'data-load-path-coach', 'data-load-path-conclusion']) {
    assert.match(bridge, new RegExp(selector), `engineering presentation must mount ${selector}`);
}
assert.match(bridge, /const complete = hasB && hasC && hasD;/,
    'engineering conclusion must require exact B/C/D observations');
assert.match(bridge, /此刻只提交推理，不读取反力、杆力或趋势答案/,
    'prediction coach must explicitly keep answers hidden');
assert.match(bridge, /数值来自上方两次完整求解；颜色和过渡动画不作为学习证据/,
    'delta must preserve exact-solve ownership');
assert.match(bridge, /不能直接作为真实结构安全结论/,
    'conclusion must state the ideal-model boundary');
assert.doesNotMatch(
    bridge.slice(bridge.indexOf('function buildLoadPathStory'), bridge.indexOf('function validPrediction')),
    /recordLearningEvidence|requestAnimationFrame|this\.|\.solve\(/,
    'story projection must remain stateless and side-effect free'
);
for (const cssSelector of ['.fg-load-path__brief', '.fg-load-path__coach', '.fg-load-path__conclusion']) {
    assert.match(frontier, new RegExp(cssSelector.replace('.', '\\.')),
        `frontier stylesheet must include ${cssSelector}`);
}
assert.match(frontier, /@media \(max-width: 760px\)[\s\S]*\.fg-load-path__brief dl \{ grid-template-columns: 1fr; \}/,
    'engineering brief must collapse for the 390px presentation');

const bridgeProjection = bridge.slice(
    bridge.indexOf('const FIXED_ROWS'),
    bridge.indexOf('function validPrediction')
);
const bridgeContext = {};
vm.runInNewContext(`${bridgeProjection}\nglobalThis.buildStory = buildLoadPathStory;`, bridgeContext);
const observation = (node, ay, ey, gh, cd) => ({
    load_node_id: node,
    load_kn: 60,
    reaction_ay_kn: ay,
    reaction_ey_kn: ey,
    member_gh_kn: gh,
    member_cd_kn: cd,
    member_gh_type_id: 'compression',
    member_cd_type_id: 'tension',
    residual_fx_kn: 0,
    residual_fy_kn: 0
});
const observationsBC = {
    B: observation('B', 45, 15, -30, 22.5),
    C: observation('C', 30, 30, -60, 45)
};
const predictionStory = bridgeContext.buildStory('prediction', {});
assert.equal(predictionStory.conclusion, null,
    'engineering prediction must not expose the exact conclusion');
assert.doesNotMatch(
    `${predictionStory.title} ${predictionStory.cue} ${predictionStory.checks.join(' ')}`,
    /45|30|22\.5|37\.5|增大|减小|更均衡/,
    'engineering prediction teaching copy must not leak exact values or trends'
);
assert.equal(bridgeContext.buildStory('observed-c', observationsBC).conclusion, null,
    'engineering conclusion stays hidden until exact B/C/D are all present');
const observationsBCD = {
    ...observationsBC,
    D: observation('D', 15, 45, -30, 37.5)
};
const observedDStory = bridgeContext.buildStory('observed-d', observationsBCD);
assert.ok(observedDStory.conclusion, 'exact B/C/D may produce the read-only teaching conclusion');
assert.match(observedDStory.conclusion.receipt, /纠正、解释与 completed 尚未完成/,
    'observed-D conclusion must not claim course completion');

for (const selector of [
    'data-mechanics-brief', 'data-mechanics-coach',
    'data-mechanics-comparison', 'data-mechanics-conclusion'
]) {
    assert.match(physics, new RegExp(selector), `mechanics presentation must mount ${selector}`);
}
const mechanicsStory = physics.slice(
    physics.indexOf('function buildMechanicsStory'),
    physics.indexOf('const PhysicsSim =')
);
assert.doesNotMatch(mechanicsStory, /recordCourseEvidence|requestAnimationFrame|document\.|\.render\(/,
    'mechanics story projection must remain stateless and side-effect free');
assert.match(mechanicsStory, /const hasPair = Boolean\(measure040 && measure080\)/,
    'measurement comparison must require both real loop snapshots');
assert.match(mechanicsStory, /预测提交前不展示峰值、比例或理论关系/,
    'prediction coach must not reveal mechanics answers');
assert.match(physics, /buildMechanicsStory\(state\.stage, state\.measurements\)/,
    'showcase must consume the existing measurement owner');
assert.match(physics, /参照值不覆盖真实峰值/,
    'ideal e-squared reference must not replace measured peaks');
assert.match(physics, /H=200 px、g=980 px\/s²、r=16 px、vₓ=0、阻尼=0/,
    'mechanics conclusion must preserve every fixed quantity');
for (const cssSelector of [
    '.mechanics-course__brief', '.mechanics-course__coach',
    '.mechanics-course__comparison', '.mechanics-course__conclusion'
]) {
    assert.match(physicsCss, new RegExp(cssSelector.replace('.', '\\.')),
        `physics stylesheet must include ${cssSelector}`);
}

const mechanicsProjection = physics.slice(
    physics.indexOf('const MECHANICS_STAGE'),
    physics.indexOf('const PhysicsSim =')
);
const mechanicsContext = {};
vm.runInNewContext(
    `${mechanicsProjection}\nglobalThis.buildStory = buildMechanicsStory; globalThis.STAGE = MECHANICS_STAGE;`,
    mechanicsContext
);
const mechanicsPrediction = mechanicsContext.buildStory(mechanicsContext.STAGE.P0, {});
assert.equal(mechanicsPrediction.comparison, null,
    'mechanics prediction must not expose measured or ideal comparison values');
assert.equal(mechanicsPrediction.conclusion, null,
    'mechanics prediction must not expose the conclusion');
assert.doesNotMatch(
    `${mechanicsPrediction.title} ${mechanicsPrediction.cue} ${mechanicsPrediction.checks.join(' ')}`,
    /0\.16|0\.64|e²|四倍|4 倍/,
    'mechanics prediction teaching copy must not leak the ideal answer'
);
const real040 = Object.freeze({ restitution: 0.40, dropHeight: 200, reboundHeight: 31.6, ratio: 0.16 });
const real080 = Object.freeze({ restitution: 0.80, dropHeight: 200, reboundHeight: 126.2, ratio: 0.63 });
assert.equal(
    mechanicsContext.buildStory(mechanicsContext.STAGE.P3, { '0.40': real040 }).comparison,
    null,
    'mechanics comparison stays hidden until both real-loop measurements exist'
);
const pairedMeasurements = { '0.40': real040, '0.80': real080 };
const comparisonStory = mechanicsContext.buildStory(mechanicsContext.STAGE.P5, pairedMeasurements);
assert.deepEqual(
    Array.from(comparisonStory.comparison.actual, item => [item.height, item.ratio]),
    [[31.6, 0.16], [126.2, 0.63]],
    'mechanics comparison must preserve the two owner measurements'
);
assert.deepEqual(
    Array.from(comparisonStory.comparison.ideal, item => item.ratio),
    [0.16, 0.64],
    'mechanics ideal reference must remain separate from the real 0.63 measurement'
);
assert.equal(comparisonStory.conclusion, null,
    'mechanics conclusion stays hidden before the corrected stage');
const explanationStory = mechanicsContext.buildStory(mechanicsContext.STAGE.P7, pairedMeasurements);
assert.match(explanationStory.conclusion.receipt, /解释待提交；completed 仍只由服务端规则投影/,
    'P7 conclusion must distinguish teaching closure from completion ownership');
assert.equal(
    mechanicsContext.buildStory(mechanicsContext.STAGE.P7, {
        '0.40': real040,
        '0.80': { ...real080, ratio: 0.64 }
    }).comparison,
    null,
    'a mismatched ratio cannot enter the teaching comparison'
);

console.log('flagship storytelling contract: engineering + mechanics PASS');
