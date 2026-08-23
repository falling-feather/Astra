const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const physicsSource = read('pages/physics/physics.js');
const physicsCss = read('pages/physics/physics.css');
const html = read('index.html');

assert.doesNotMatch(
  physicsSource,
  /learning-domain-command|evidence|prediction|correction|course/i,
  'restored mechanics must stay an experiment instead of an evidence course',
);
assert.match(physicsSource, /gravity:\s*980/);
assert.match(physicsSource, /restitution:\s*0\.75/);
assert.match(physicsSource, /friction:\s*0\.10/);
assert.match(physicsSource, /launchBall\(start, end\)/);

const context = {
  window: { devicePixelRatio: 1, PhysicsZoom: null },
  document: { getElementById() { return null; } },
  performance: { now: () => 0 },
  requestAnimationFrame: () => 1,
  cancelAnimationFrame() {},
  console,
};
vm.createContext(context);
vm.runInContext(physicsSource, context, { filename: 'physics.js' });
const physics = context.window.PhysicsSim;
physics.W = 800;
physics.H = 450;
physics.launchBall({ x: 120, y: 120 }, { x: 80, y: 90 });
assert.equal(physics.balls.length, 1);
assert.ok(Number.isFinite(physics.balls[0].vx));
assert.ok(Number.isFinite(physics.balls[0].vy));
physics.update(0.016);
assert.ok(physics.balls[0].vy > 0);

const mechanics = html.slice(
  html.indexOf('<div class="content-section" data-module="mechanics">'),
  html.indexOf('<!-- ── 气体实验定律', html.indexOf('<div class="content-section" data-module="mechanics">')),
);
assert.match(mechanics, /id="physics-canvas"/);
assert.match(mechanics, /id="physics-clear"[\s\S]*id="physics-pause"/);
assert.doesNotMatch(mechanics, /学习目标|先预测|受控对照|学习证据|修正/);
assert.match(physicsCss, /#gravity-slider,[\s\S]*#radius-slider[\s\S]*min-height:\s*44px/);
assert.doesNotMatch(physicsCss, /mechanics-course|mechanics-free-explore/);

console.log('physics-mechanics-evidence-contract: direct simulation and anti-course boundary PASS');
