const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const bridgeSource = read('pages/engineering/bridge-truss.js');
const registrySource = read('shared/js/page-registry.js');

assert.match(html, /id="page-engineering"[\s\S]*id="truss-load"[\s\S]*id="bridge-truss-canvas"/);
assert.doesNotMatch(html, /data-frontier-runtime-mount="engineering"|data-fg-evidence-host[^>]*engineering/);
assert.doesNotMatch(
  bridgeSource,
  /learning-domain-command|learning evidence|recordLearningEvidence|createLoadPathFlow|data-load-path|prediction|course/i,
);
assert.match(bridgeSource, /window\.initBridgeTruss = initBridgeTruss/);
assert.match(bridgeSource, /window\.destroyBridgeTruss = destroyBridgeTruss/);

const context = {
  window: {
    addEventListener() {},
    removeEventListener() {},
    devicePixelRatio: 1,
  },
  Array,
  Date,
  Map,
  Math,
  Number,
  Object,
  RegExp,
  Set,
  String,
  console,
  requestAnimationFrame: () => 1,
  cancelAnimationFrame() {},
};
vm.createContext(context);
vm.runInContext(bridgeSource, context, { filename: 'bridge-truss.js' });
const bridge = context.window.BridgeTruss;
assert.ok(bridge);
const center = bridge.solve();
bridge.state.loadJoint = 'B';
const left = bridge.solve();
assert.notEqual(left.reactions.Ay, center.reactions.Ay);
bridge.state.load = 100;
assert.ok(bridge.solve().maxForce > left.maxForce);

const registryContext = { window: {} };
vm.runInNewContext(registrySource, registryContext, { filename: 'page-registry.js' });
assert.equal(
  registryContext.window.AstraPageRegistry.scriptFor('engineering'),
  'pages/engineering/bridge-truss.js?v=20260824v816ExperimentRestoreP2',
);

console.log('future-engineering-evidence-contract: rejected evidence flow stays detached PASS');
