const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

class FakeTarget {
  constructor() {
    this._listeners = [];
    this.added = 0;
    this.removed = 0;
  }

  addEventListener(event, handler, options) {
    this._listeners.push({ event, handler, options });
    this.added += 1;
  }

  removeEventListener(event, handler) {
    const index = this._listeners.findIndex(item => item.event === event && item.handler === handler);
    if (index >= 0) {
      this._listeners.splice(index, 1);
      this.removed += 1;
    }
  }

  liveListeners() {
    return this._listeners.length;
  }
}

const physicsSource = read('pages/physics/physics.js');
assert.equal(
  (physicsSource.match(/\.addEventListener\(/g) || []).length,
  1,
  'PhysicsSim must register every runtime listener through its single tracker helper'
);
assert.match(physicsSource, /this\._raf\s*=\s*requestAnimationFrame\(/);
assert.match(physicsSource, /cancelAnimationFrame\(this\._raf\)/);
assert.match(physicsSource, /init\(\)\s*\{\s*this\.destroy\(\);/);

const fakeWindow = new FakeTarget();
fakeWindow.devicePixelRatio = 1;
const physicsElements = {};
const physicsParent = {
  getBoundingClientRect: () => ({ width: 960 })
};
const physicsContext2d = { setTransform() {} };
const physicsCanvas = new FakeTarget();
physicsCanvas.parentElement = physicsParent;
physicsCanvas.style = {};
physicsCanvas.getContext = () => physicsContext2d;
physicsCanvas.getBoundingClientRect = () => ({ left: 0, top: 0 });
physicsElements['physics-canvas'] = physicsCanvas;
[
  'gravity-slider', 'restitution-slider', 'friction-slider', 'radius-slider',
  'physics-clear', 'physics-pause', 'gravity-value', 'restitution-value',
  'friction-value', 'radius-value'
].forEach((id) => {
  const element = new FakeTarget();
  element.value = '0';
  element.textContent = '';
  physicsElements[id] = element;
});

const cancelledFrames = [];
const physicsContext = {
  window: fakeWindow,
  document: { getElementById: id => physicsElements[id] || null },
  performance: { now: () => 1000 },
  requestAnimationFrame: () => 123,
  cancelAnimationFrame: id => cancelledFrames.push(id),
  console
};
vm.createContext(physicsContext);
vm.runInContext(physicsSource, physicsContext, { filename: 'pages/physics/physics.js' });
const physicsSim = physicsContext.window.PhysicsSim;
assert.ok(physicsSim);

const livePhysicsListeners = () => [fakeWindow, ...Object.values(physicsElements)]
  .reduce((count, target) => count + (typeof target.liveListeners === 'function' ? target.liveListeners() : 0), 0);

physicsSim.init();
assert.equal(physicsSim._listeners.length, 14, 'restored mechanics must track only its direct controls, pointer/touch, viewport resize, and zoom restoration');
assert.equal(livePhysicsListeners(), 14);
assert.equal(
  fakeWindow._listeners.filter(item => item.event === 'resize').length,
  1,
  'mechanics must own exactly one viewport resize listener'
);
assert.equal(
  physicsCanvas._listeners.filter(item => item.event === 'astra:physics-zoom-restored').length,
  1,
  'mechanics must own exactly one zoom restoration listener'
);
physicsSim.init();
assert.equal(physicsSim._listeners.length, 14, 're-init must replace rather than accumulate listeners');
assert.equal(livePhysicsListeners(), 14);
physicsSim.running = true;
physicsSim._raf = 777;
physicsSim.destroy();
assert.equal(livePhysicsListeners(), 0);
assert.deepEqual(cancelledFrames, [777]);
assert.equal(physicsSim.canvas, null);
assert.equal(physicsSim.ctx, null);
assert.doesNotThrow(() => physicsSim.destroy(), 'mechanics destroy must be idempotent');

class FakeButton extends FakeTarget {
  constructor(mode) {
    super();
    this.dataset = { mode };
    this.classList = { toggle() {} };
  }
}

class FakeWrapper {
  constructor() {
    this.id = '';
    this.className = '';
    this.buttons = [];
  }

  set innerHTML(value) {
    this._innerHTML = value;
    const modes = {
      'bio-dna-modes': ['helix', 'replication', 'transcription', 'mutation'],
      'bio-photo-modes': ['simulation', 'curve', 'comparison'],
      'bio-genetics-modes': ['punnett', 'population', 'pedigree']
    };
    this.buttons = (modes[this.id] || []).map(mode => new FakeButton(mode));
  }

  get innerHTML() {
    return this._innerHTML;
  }

  querySelectorAll() {
    return this.buttons;
  }
}

const verifyModeButtonRebind = ({ file, owner, wrapperId, buttonCount, canvasShape }) => {
  const source = read(file);
  assert.match(source, /init\(\)\s*\{\s*if \(this\.canvas\) this\.destroy\(\);/);
  assert.doesNotMatch(
    source,
    new RegExp(`if \\(.*getElementById\\('${wrapperId}'\\).*\\) return`),
    `${owner} must not skip rebinding an existing mode wrapper`
  );

  const nodes = {};
  const controls = { parentElement: { insertBefore: wrapper => { nodes[wrapper.id] = wrapper; } } };
  const canvas = canvasShape(controls);
  const fakeDocument = {
    getElementById: id => nodes[id] || null,
    createElement: () => new FakeWrapper(),
    querySelectorAll: () => []
  };
  const context = {
    window: new FakeTarget(),
    document: fakeDocument,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    console,
    testCanvas: canvas
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: file });
  const target = vm.runInContext(owner, context);
  target.canvas = canvas;
  target._injectModeButtons();
  const firstWrapper = nodes[wrapperId];
  assert.ok(firstWrapper, `${owner} must create its mode wrapper`);
  assert.equal(firstWrapper.buttons.length, buttonCount);
  target.destroy();
  target._injectModeButtons();
  assert.equal(nodes[wrapperId], firstWrapper, `${owner} must reuse one mode wrapper`);
  firstWrapper.buttons.forEach((button) => {
    assert.equal(button.added, 2, `${owner} mode button must be rebound after page re-entry`);
    assert.equal(button.removed, 1, `${owner} old mode listener must be removed on destroy`);
    assert.equal(button.liveListeners(), 1, `${owner} mode button must keep exactly one live listener`);
  });
};

verifyModeButtonRebind({
  file: 'pages/biology/dna-helix.js',
  owner: 'DNAHelix',
  wrapperId: 'bio-dna-modes',
  buttonCount: 4,
  canvasShape: controls => ({
    closest: selector => selector === '.demo-section' ? { querySelector: () => controls } : null
  })
});
verifyModeButtonRebind({
  file: 'pages/biology/photosynthesis.js',
  owner: 'Photosynthesis',
  wrapperId: 'bio-photo-modes',
  buttonCount: 3,
  canvasShape: controls => ({ closest: () => ({ querySelector: () => controls }) })
});
verifyModeButtonRebind({
  file: 'pages/biology/genetics.js',
  owner: 'Genetics',
  wrapperId: 'bio-genetics-modes',
  buttonCount: 3,
  canvasShape: controls => ({
    closest: selector => selector === '.demo-section' ? { querySelector: () => controls } : null
  })
});

console.log('candidate-cleanup-contract: ok');
