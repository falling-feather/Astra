const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const templateRoot = path.join(root, 'tools/templates/new-experiment');
const read = (name) => fs.readFileSync(path.join(templateRoot, name), 'utf8');

const contract = JSON.parse(read('template.contract.json'));
assert.equal(contract.schema_version, 1);
assert.equal(contract.production_registration, false);
assert.equal(contract.copy_target, 'pages/__SUBJECT__/__EXPERIMENT_ID__/');
assert.equal(contract.validation, 'node tools/tests/new-experiment-template-contract.cjs');
assert.equal(
    contract.registration_validation,
    'node tools/quality/check-new-experiment-registration.cjs --manifest <pages/subject/experiment/manifest.json>'
);
assert.equal(contract.visual_contract, 'visual-primitives.contract.json');
assert.equal(contract.visual_validation, 'node tools/tests/new-experiment-visual-primitives-contract.cjs');
assert.deepEqual(contract.required_files, [
    'manifest.json.tpl',
    'module.html.tpl',
    'index.js.tpl',
    'styles.css.tpl',
    'model-notes.md.tpl'
]);
for (const file of contract.required_files) {
    assert.ok(fs.existsSync(path.join(templateRoot, file)), `template file must exist: ${file}`);
}

const replacements = Object.freeze({
    __SUBJECT__: 'physics',
    __EXPERIMENT_ID__: 'showcase-template-probe',
    __EXPERIMENT_TITLE__: '展示实验模板探针',
    __OWNER__: 'ShowcaseTemplateProbe',
    __NAMESPACE__: 'showcase-template-probe',
    __ASSET_VERSION__: '20260824v820Ext01P0',
    __MODEL_DOC_ANCHOR__: 'model-showcase-template-probe',
    __PARAMETER_LABEL__: '主变量',
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

for (const token of contract.placeholders) {
    assert.ok(Object.hasOwn(replacements, token), `test renderer must know placeholder: ${token}`);
}

const manifestSource = read('manifest.json.tpl');
const manifest = JSON.parse(render(manifestSource));
assert.equal(manifest.activity_key, 'physics.showcase-template-probe');
assert.equal(manifest.route, '#physics/showcase-template-probe');
assert.equal(manifest.owner, 'ShowcaseTemplateProbe');
assert.equal(manifest.init_hook, 'initShowcaseTemplateProbe');
assert.equal(manifest.cleanup.owner, 'ShowcaseTemplateProbe');
assert.equal(manifest.cleanup.method, 'destroy');
assert.equal(manifest.cleanup.verified, true);
assert.equal(manifest.registration_state, 'candidate-unregistered');

const html = render(read('module.html.tpl'));
assert.match(html, /data-module="showcase-template-probe"/);
assert.match(html, /class="astra-exp astra-exp--showcase-template-probe"/);
assert.match(html, /data-role="canvas"/);
assert.match(html, /data-role="state"/);
assert.match(html, /data-role="legend"/);
assert.match(html, /data-role="parameter-value"/);
assert.match(html, /data-role="notice"/);
assert.match(html, /data-role="control-drawer"/);
assert.match(html, /data-control="parameter"/);
assert.match(html, /data-action="toggle"/);
assert.match(html, /data-action="reset"/);

const runtime = render(read('index.js.tpl'));
new vm.Script(runtime, { filename: 'rendered-new-experiment/index.js' });
assert.match(runtime, /const ShowcaseTemplateProbe = \{/);
assert.match(runtime, /window\.ShowcaseTemplateProbe = ShowcaseTemplateProbe/);
assert.match(runtime, /window\.initShowcaseTemplateProbe = \(\) => ShowcaseTemplateProbe\.init\(\)/);
assert.match(runtime, /new AbortController\(\)/);
assert.match(runtime, /new ResizeObserver\(/);
assert.match(runtime, /requestAnimationFrame\(/);
assert.match(runtime, /cancelAnimationFrame\(/);
assert.match(runtime, /\.controls\?\.abort\(\)/);
assert.match(runtime, /\.resizeObserver\?\.disconnect\(\)/);
assert.match(runtime, /prefers-reduced-motion: reduce/);
assert.match(runtime, /devicePixelRatio/);

const listeners = new Map();
const createControl = () => ({
    value: '',
    textContent: '',
    attributes: {},
    addEventListener(type, listener) { listeners.set(this, { type, listener }); },
    setAttribute(name, value) { this.attributes[name] = value; }
});
const parameterControl = createControl();
const toggleControl = createControl();
const resetControl = createControl();
const readout = { textContent: '' };
const parameterOutput = { value: '', textContent: '' };
const stateOutput = { value: '', textContent: '' };
const notice = { textContent: '' };
const drawingContext = {
    setTransform() {},
    clearRect() {},
    fillRect() {},
    beginPath() {},
    arc() {},
    fill() {},
    fillStyle: ''
};
const parent = { getBoundingClientRect: () => ({ width: 640, height: 360 }) };
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
            '[data-role="parameter-value"]': parameterOutput,
            '[data-role="state"]': stateOutput,
            '[data-role="notice"]': notice,
            '[data-control="parameter"]': parameterControl,
            '[data-action="toggle"]': toggleControl,
            '[data-action="reset"]': resetControl
        })[selector] || null;
    }
};
let observerDisconnected = false;
class ResizeObserverProbe {
    constructor(callback) { this.callback = callback; }
    observe(target) { this.target = target; }
    disconnect() { observerDisconnected = true; }
}
const runtimeContext = {
    window: {
        devicePixelRatio: 1,
        matchMedia: () => ({ matches: true, addEventListener() {} })
    },
    document: {
        querySelector: (selector) => selector.includes('showcase-template-probe') ? rootElement : null
    },
    AbortController,
    ResizeObserver: ResizeObserverProbe,
    performance: { now: () => 100 },
    requestAnimationFrame: () => { throw new Error('reduced-motion init must not start a frame'); },
    cancelAnimationFrame: () => {}
};
vm.createContext(runtimeContext);
vm.runInContext(runtime, runtimeContext, { filename: 'rendered-new-experiment/index.js' });
const owner = runtimeContext.window.ShowcaseTemplateProbe;
assert.ok(owner, 'rendered owner must be exposed');
assert.equal(runtimeContext.window.initShowcaseTemplateProbe(), true);
assert.equal(canvas.width, 640);
assert.equal(canvas.height, 360);
assert.match(readout.textContent, /主变量 50 m · 时间 0\.0 s/);
assert.equal(parameterOutput.textContent, '50 m');
assert.equal(stateOutput.textContent, '静态模式');
assert.match(notice.textContent, /减少动态效果/);
assert.equal(toggleControl.disabled, true);
assert.equal(rootElement.dataset.state, 'reduced-motion');
assert.equal(owner.snapshot().parameter, 50);
const abortSignal = owner.controls.signal;
listeners.get(parameterControl).listener({ target: { value: '80' } });
assert.equal(owner.snapshot().parameter, 80);
assert.equal(parameterOutput.textContent, '80 m');
owner.destroy();
assert.equal(abortSignal.aborted, true, 'destroy must abort control listeners');
assert.equal(observerDisconnected, true, 'destroy must disconnect ResizeObserver');
assert.equal(owner.root, null);
assert.equal(owner.canvas, null);

const css = render(read('styles.css.tpl'));
const selectorLines = css.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    return trimmed.endsWith('{') && !trimmed.startsWith('@');
});
assert.ok(selectorLines.length >= 10, 'template must provide a useful responsive visual shell');
for (const line of selectorLines) {
    assert.match(
        line.trim(),
        /^#page-physics \[data-module="showcase-template-probe"\] \.astra-exp--showcase-template-probe/,
        `CSS selector must stay inside the new experiment namespace: ${line}`
    );
}
assert.match(css, /@media \(max-width: 760px\)/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);

const modelNotes = render(read('model-notes.md.tpl'));
for (const requiredLabel of [
    '自变量与单位',
    '因变量与单位',
    '核心关系',
    '适用条件',
    '简化假设',
    '误差来源',
    '参考依据',
    '已知限制',
    '画面映射',
    '验证样例'
]) {
    assert.match(modelNotes, new RegExp(requiredLabel));
}

const productionFiles = [
    'shared/js/config.js',
    'shared/js/experiment-registry.js',
    'index.html'
].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
assert.doesNotMatch(productionFiles, /showcase-template-probe/);
assert.doesNotMatch(productionFiles, /__EXPERIMENT_ID__|__OWNER__|__NAMESPACE__/);

console.log('new-experiment-template-contract: EXT-01 copyable template PASS');
