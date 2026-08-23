const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const registry = read('shared/js/page-registry.js');
const engineering = read('pages/engineering/engineering.css');
const bridge = read('pages/engineering/bridge-truss.js');

const engineeringPage = html.slice(
  html.indexOf('<section id="page-engineering"'),
  html.indexOf('<!-- ────────── MATHEMATICS', html.indexOf('<section id="page-engineering"')),
);

assert.match(engineeringPage, /id="frontier-engineering-lab"/);
assert.match(engineeringPage, /id="truss-load"[^>]*type="range"/);
assert.match(engineeringPage, /data-truss-joint="B"[\s\S]*data-truss-joint="C"[\s\S]*data-truss-joint="D"/);
assert.match(engineeringPage, /id="bridge-truss-canvas"/);
assert.match(engineeringPage, /id="truss-info"/);
assert.doesNotMatch(engineeringPage, /data-frontier-runtime-mount="engineering"|data-load-path-flow|学习证据|先预测/);

const engineeringDefinition = registry.match(/engineering: definePage\([\s\S]*?\n\s*\}\),/);
assert.ok(engineeringDefinition);
assert.match(engineeringDefinition[0], /pages\/engineering\/bridge-truss\.js/);
assert.match(engineeringDefinition[0], /ready: 'initBridgeTruss'[\s\S]*leave: 'destroyBridgeTruss'/);
assert.doesNotMatch(engineeringDefinition[0], /frontier-learning|initFrontierCourse/);

assert.match(bridge, /loadInput\.addEventListener\('input'/);
assert.match(bridge, /data-truss-joint/);
assert.match(bridge, /_solveLinearSystem/);
assert.match(bridge, /memberForces/);
assert.doesNotMatch(bridge, /learning-domain-command|evidence|prediction|data-load-path|course/i);
assert.match(engineering, /@media \(max-width: 640px\)[\s\S]*#bridge-truss-canvas/);

console.log('fe036-engineering-same-frame-contract: restored direct engineering experiment PASS');
