'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function engineeringPage(html) {
  const match = html.match(/<section id="page-engineering"[\s\S]*?<section id="page-mathematics"/);
  assert.ok(match, 'engineering page boundary is missing');
  return match[0];
}

function registryEntry(source) {
  const match = source.match(/engineering:\s*definePage\(\{[\s\S]*?\n\s*\}\),/);
  assert.ok(match, 'engineering page registry entry is missing');
  return match[0];
}

function loadBridge(source) {
  const context = {
    console,
    document: {
      getElementById: () => null,
      querySelectorAll: () => [],
    },
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    devicePixelRatio: 1,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'pages/engineering/bridge-truss.js' });
  assert.ok(context.BridgeTruss, 'restored bridge runtime is not exported');
  return context.BridgeTruss;
}

function solveAt(bridge, joint, load = 60) {
  bridge.state.loadJoint = joint;
  bridge.state.load = load;
  return bridge.solve();
}

function near(actual, expected, epsilon = 1e-7) {
  return Math.abs(actual - expected) <= epsilon;
}

function run() {
  const html = read('index.html');
  const page = engineeringPage(html);
  const bridgeSource = read('pages/engineering/bridge-truss.js');
  const registry = registryEntry(read('shared/js/page-registry.js'));
  const frontierRuntime = read('shared/js/frontier-learning.js');
  const frontierContext = read('shared/js/frontier-publication-context.js');

  for (const marker of [
    'id="frontier-engineering-lab"',
    'id="truss-load"',
    'data-truss-joint="B"',
    'data-truss-joint="C"',
    'data-truss-joint="D"',
    'id="bridge-truss-canvas"',
    'id="truss-info"',
  ]) {
    assert.match(page, new RegExp(marker), `restored engineering control missing: ${marker}`);
  }

  for (const retiredMarker of [
    'data-frontier-runtime-mount="engineering"',
    'engineering-course-stage',
    'load-path-prediction',
    'load-path-correction',
    'learning-evidence',
  ]) {
    assert.doesNotMatch(page, new RegExp(retiredMarker), `retired course wrapper leaked into engineering page: ${retiredMarker}`);
    assert.doesNotMatch(bridgeSource, new RegExp(retiredMarker), `retired course wrapper leaked into bridge runtime: ${retiredMarker}`);
  }

  assert.match(registry, /pages\/engineering\/bridge-truss\.js/);
  assert.match(registry, /ready:\s*'initBridgeTruss'/);
  assert.match(registry, /leave:\s*'destroyBridgeTruss'/);
  assert.doesNotMatch(registry, /frontier-learning\.js|initFrontierCourse|destroyFrontierCourse/);
  const runtimeManagedPages = frontierRuntime.match(/const MANAGED_PAGES = new Set\(\[([^\]]*)\]\)/)?.[1] || '';
  const contextManagedPages = frontierContext.match(/const MANAGED_PAGES = new Set\(\[([^\]]*)\]\)/)?.[1] || '';
  assert.doesNotMatch(runtimeManagedPages, /engineering/, 'Future runtime must not own the restored engineering page');
  assert.doesNotMatch(contextManagedPages, /engineering/, 'Future publication refresh must not replace the restored engineering page');

  const bridge = loadBridge(bridgeSource);
  const left = solveAt(bridge, 'B');
  const centre = solveAt(bridge, 'C');
  const right = solveAt(bridge, 'D');
  for (const result of [left, centre, right]) {
    assert.equal(result.memberForces.length, bridge.members.length);
    assert.equal(near(result.reactions.Ay + result.reactions.Ey, 60), true, 'support reactions must balance the applied load');
    assert.ok(result.critical && Number.isFinite(result.critical.force));
  }
  assert.ok(left.reactions.Ay > left.reactions.Ey, 'left load should increase the left reaction');
  assert.equal(near(centre.reactions.Ay, centre.reactions.Ey), true, 'centre load should produce balanced reactions');
  assert.ok(right.reactions.Ey > right.reactions.Ay, 'right load should increase the right reaction');

  const doubleLoad = solveAt(bridge, 'C', 120);
  assert.equal(near(doubleLoad.maxForce, centre.maxForce * 2, 1e-6), true, 'member forces should scale with the applied load');

  console.log('qa019-future-probe-contract: historical course-flow gate retired; restored direct bridge experiment PASS');
}

run();
