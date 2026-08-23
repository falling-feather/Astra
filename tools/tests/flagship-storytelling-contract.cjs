const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const bridge = read('pages/engineering/bridge-truss.js');
const engineeringCss = read('pages/engineering/engineering.css');
const physics = read('pages/physics/physics.js');
const physicsCss = read('pages/physics/physics.css');

const mechanics = html.slice(
  html.indexOf('<div class="content-section" data-module="mechanics">'),
  html.indexOf('<!-- ── 气体实验定律', html.indexOf('<div class="content-section" data-module="mechanics">')),
);
assert.match(mechanics, /<h2>力学模拟<\/h2>/);
assert.match(mechanics, /id="gravity-slider"[\s\S]*id="restitution-slider"[\s\S]*id="friction-slider"[\s\S]*id="radius-slider"/);
assert.match(mechanics, /id="physics-clear"[\s\S]*id="physics-pause"[\s\S]*id="physics-canvas"/);
assert.doesNotMatch(mechanics, /mechanics-course|学习目标|先预测|受控对照|学习证据|不计课程完成/);
assert.doesNotMatch(physics, /buildMechanicsStory|recordCourseEvidence|bindCourseEvidence|learning-domain-command|mechanics-course/);
assert.doesNotMatch(physicsCss, /mechanics-course|mechanics-free-explore/);
assert.match(physics, /bindControls\(\)[\s\S]*bindCanvas\(\)/);
assert.match(physics, /launchBall\(start, end\)/);

assert.match(html, /id="frontier-engineering-lab"[\s\S]*id="truss-load"[\s\S]*id="bridge-truss-canvas"/);
assert.doesNotMatch(bridge, /buildLoadPathStory|recordLearningEvidence|data-load-path|learning-domain-command|evidence/i);
assert.doesNotMatch(engineeringCss, /data-load-path|same-frame|fg-load-path/);
assert.match(bridge, /solve\(\)[\s\S]*_solveLinearSystem/);
assert.match(bridge, /updateInfo\(result\)/);

console.log('flagship-storytelling-contract: rejected storytelling layers stay removed PASS');
