const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const templateRoot = path.join(root, 'tools/templates/new-experiment');
const read = (name) => fs.readFileSync(path.join(templateRoot, name), 'utf8');

const templateContract = JSON.parse(read('template.contract.json'));
const visualContract = JSON.parse(read(templateContract.visual_contract));

assert.equal(visualContract.schema_version, 1);
assert.equal(visualContract.task, 'EXT-04');
assert.equal(visualContract.version, 'V8.2.3');
assert.equal(visualContract.scope, 'new-experiment-only');
assert.equal(visualContract.production_registration, false);
assert.equal(visualContract.minimum_touch_target_px, 44);
assert.equal(visualContract.mobile_breakpoint_px, 760);
assert.deepEqual(
    visualContract.viewports.map(({ name, width, height }) => `${name}:${width}x${height}`),
    ['desktop:1440x900', 'tablet:834x1112', 'mobile:390x844']
);
assert.deepEqual(
    visualContract.required_states,
    ['running', 'paused', 'reduced-motion']
);
assert.match(visualContract.content_policy, /course goals and long explanations stay outside/i);

const replacements = Object.freeze({
    __SUBJECT__: 'physics',
    __EXPERIMENT_ID__: 'visual-primitives-probe',
    __EXPERIMENT_TITLE__: '视觉基础件探针',
    __OWNER__: 'VisualPrimitivesProbe',
    __NAMESPACE__: 'visual-primitives-probe',
    __ASSET_VERSION__: '20260824v823Ext04P0',
    __PARAMETER_LABEL__: '位移',
    __PARAMETER_UNIT__: 'm',
    __PRIMARY_LEGEND__: '运动对象',
    __SECONDARY_LEGEND__: '参考位置',
    __ACCENT_TOKEN__: '--accent-purple',
    __ACCENT_RGB__: '139, 111, 192'
});
const render = (source) => Object.entries(replacements).reduce(
    (result, [token, value]) => result.split(token).join(value),
    source
);
const html = render(read('module.html.tpl'));
const css = render(read('styles.css.tpl'));
const runtime = render(read('index.js.tpl'));

for (const token of templateContract.placeholders) {
    assert.ok(Object.hasOwn(replacements, token), `visual renderer must know placeholder: ${token}`);
    for (const [kind, source] of [['html', html], ['css', css], ['runtime', runtime]]) {
        assert.doesNotMatch(source, new RegExp(token), `${kind} retains placeholder ${token}`);
    }
}

for (const primitive of visualContract.required_primitives) {
    assert.equal(typeof primitive.id, 'string');
    assert.match(primitive.selector, /^\[data-(role|control|action)=/);
    const attribute = primitive.selector.slice(1, -1);
    assert.ok(html.includes(attribute), `missing primitive ${primitive.id}: ${primitive.selector}`);
    assert.ok(primitive.purpose.length >= 24, `primitive purpose is too weak: ${primitive.id}`);
}
assert.match(html, /<details[\s\S]*data-role="control-drawer"[\s\S]*\sopen[\s\S]*>/);
assert.match(html, /<summary>[\s\S]*参数与控制[\s\S]*<\/summary>/);
assert.match(html, /<label for="visual-primitives-probe-parameter">位移<\/label>/);
assert.match(html, /<output[\s\S]*for="visual-primitives-probe-parameter"[\s\S]*data-role="parameter-value"/);
assert.match(html, /data-role="notice"[\s\S]*role="status"/);
assert.doesNotMatch(html, /课程目标|学习任务|教学步骤|提交证据|发布版本/);

const namespace = '#page-physics [data-module="visual-primitives-probe"] .astra-exp--visual-primitives-probe';
assert.equal(
    render(visualContract.namespace_prefix),
    namespace
);
const selectorLines = css.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    return trimmed.endsWith('{') && !trimmed.startsWith('@');
});
assert.ok(selectorLines.length >= 35, 'visual primitives need a complete but scoped style set');
for (const line of selectorLines) {
    assert.ok(
        line.trim().startsWith(namespace),
        `visual selector escaped the new experiment namespace: ${line.trim()}`
    );
}
assert.doesNotMatch(css, /(^|\n)\s*(?::root|body|html|\.content-section)\s*[{,]/);
assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\) minmax\(280px, 340px\)/);
assert.match(css, /height:\s*clamp\(380px, 58vh, 650px\)/);
assert.doesNotMatch(css, /min-height:\s*clamp\(380px, 58vh, 650px\)/);
assert.match(css, /@media \(max-width: 980px\)/);
assert.match(css, /@media \(max-width: 760px\)/);
assert.match(css, /@media \(max-width: 480px\)/);
assert.match(css, /min-height:\s*44px/);
assert.match(css, /min-width:\s*44px/);
assert.match(css, /:focus-visible/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(css, /\.astra-exp--visual-primitives-probe__drawer:not\(\[open\]\)/);
assert.match(css, /var\(--accent-purple, #5b8dce\)/);
assert.match(css, /rgba\(139, 111, 192, 0\.14\)/);

new vm.Script(runtime, { filename: 'rendered-visual-primitives/index.js' });
for (const state of visualContract.required_states) {
    assert.ok(runtime.includes(`'${state}'`), `runtime does not expose state ${state}`);
}
assert.match(runtime, /syncUi\(\)/);
assert.match(runtime, /stopLoop\(\)/);
assert.match(runtime, /motionPreference\.addEventListener\?\./);
assert.match(runtime, /parent\.clientWidth \|\| rect\.width/);
assert.match(runtime, /if \(width <= 0 \|\| height <= 0\) return/);

const listeners = new Map();
const createControl = () => ({
    value: '',
    textContent: '',
    disabled: false,
    attributes: {},
    addEventListener(type, listener) { listeners.set(this, { type, listener }); },
    setAttribute(name, value) { this.attributes[name] = value; }
});
const parameterControl = createControl();
const toggleControl = createControl();
const resetControl = createControl();
const parameterOutput = { value: '', textContent: '' };
const stateOutput = { value: '', textContent: '' };
const notice = { textContent: '' };
const readout = { textContent: '' };
const drawingContext = {
    setTransform() {},
    clearRect() {},
    fillRect() {},
    beginPath() {},
    arc() {},
    fill() {},
    fillStyle: ''
};
const parent = { getBoundingClientRect: () => ({ width: 720, height: 480 }) };
const canvas = {
    parentElement: parent,
    width: 0,
    height: 0,
    style: {},
    getContext: () => drawingContext
};
const rootElement = {
    dataset: {},
    querySelector(selector) {
        return ({
            '[data-role="canvas"]': canvas,
            '[data-role="readout"]': readout,
            '[data-control="parameter"]': parameterControl,
            '[data-role="parameter-value"]': parameterOutput,
            '[data-action="toggle"]': toggleControl,
            '[data-action="reset"]': resetControl,
            '[data-role="state"]': stateOutput,
            '[data-role="notice"]': notice
        })[selector] || null;
    }
};

let observerDisconnected = false;
class ResizeObserverProbe {
    constructor(callback) { this.callback = callback; }
    observe(target) { this.target = target; }
    disconnect() { observerDisconnected = true; }
}
let motionListener = null;
const motionPreference = {
    matches: true,
    addEventListener(type, listener) {
        assert.equal(type, 'change');
        motionListener = listener;
    }
};
let frameSequence = 0;
const cancelledFrames = [];
const runtimeContext = {
    window: {
        devicePixelRatio: 1,
        matchMedia: () => motionPreference
    },
    document: {
        querySelector: (selector) => selector.includes('visual-primitives-probe') ? rootElement : null
    },
    AbortController,
    ResizeObserver: ResizeObserverProbe,
    performance: { now: () => 100 },
    requestAnimationFrame: () => ++frameSequence,
    cancelAnimationFrame: (frame) => cancelledFrames.push(frame)
};
vm.createContext(runtimeContext);
vm.runInContext(runtime, runtimeContext, { filename: 'rendered-visual-primitives/index.js' });

const owner = runtimeContext.window.VisualPrimitivesProbe;
assert.ok(owner);
assert.equal(runtimeContext.window.initVisualPrimitivesProbe(), true);
assert.equal(canvas.width, 720);
assert.equal(canvas.height, 480);
assert.equal(owner.frame, 0, 'reduced-motion must not start continuous animation');
assert.equal(rootElement.dataset.state, 'reduced-motion');
assert.equal(stateOutput.textContent, '静态模式');
assert.equal(toggleControl.disabled, true);
assert.equal(parameterOutput.textContent, '50 m');
assert.match(readout.textContent, /位移 50 m · 时间 0\.0 s/);

listeners.get(parameterControl).listener({ target: { value: '72' } });
assert.equal(owner.snapshot().parameter, 72);
assert.equal(parameterOutput.textContent, '72 m');
assert.match(readout.textContent, /位移 72 m/);

assert.equal(typeof motionListener, 'function');
motionPreference.matches = false;
motionListener({ matches: false });
assert.equal(rootElement.dataset.state, 'running');
assert.equal(stateOutput.textContent, '运行中');
assert.equal(toggleControl.disabled, false);
assert.ok(owner.frame > 0, 'motion-enabled state must start the loop');

listeners.get(toggleControl).listener();
assert.equal(rootElement.dataset.state, 'paused');
assert.equal(stateOutput.textContent, '已暂停');
assert.equal(owner.frame, 0);
assert.ok(cancelledFrames.length >= 1);

listeners.get(toggleControl).listener();
assert.equal(rootElement.dataset.state, 'running');
assert.ok(owner.frame > 0);

listeners.get(resetControl).listener();
assert.equal(owner.snapshot().parameter, 50);
assert.equal(parameterControl.value, '50');
assert.equal(rootElement.dataset.state, 'running');

motionPreference.matches = true;
motionListener({ matches: true });
assert.equal(rootElement.dataset.state, 'reduced-motion');
assert.equal(owner.frame, 0);

const abortSignal = owner.controls.signal;
owner.destroy();
assert.equal(abortSignal.aborted, true);
assert.equal(observerDisconnected, true);
assert.equal(owner.root, null);
assert.equal(owner.motionPreference, null);

const productionFiles = [
    'shared/js/config.js',
    'shared/js/experiment-registry.js',
    'index.html',
    'sw.js'
].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
assert.doesNotMatch(productionFiles, /visual-primitives-probe|visual-primitives\.contract\.json/);

console.log('new-experiment-visual-primitives-contract: EXT-04 semantics, responsive CSS and runtime states PASS');
