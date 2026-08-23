const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const selector = read('shared/js/module-selector.js');
const physics = read('pages/physics/physics.js');
const html = read('index.html');

const mountStart = selector.indexOf('_mountEvidenceRuntime(page, moduleId, pageEl, sections, generation)');
const mountEnd = selector.indexOf('closeModule(page, options', mountStart);
assert.ok(mountStart >= 0 && mountEnd > mountStart);
const mountBody = selector.slice(mountStart, mountEnd);
assert.match(
  mountBody,
  /if \(page === 'physics' && moduleId === 'mechanics'\) return;/,
  'the restored mechanics owner must refuse an injected evidence panel',
);

const mechanics = html.slice(
  html.indexOf('<div class="content-section" data-module="mechanics">'),
  html.indexOf('<!-- ── 气体实验定律', html.indexOf('<div class="content-section" data-module="mechanics">')),
);
assert.doesNotMatch(mechanics, /data-evidence|learning-evidence|mechanics-course|学习证据|课程完成/);
assert.doesNotMatch(physics, /bindCourseEvidence|authorizeCourseRecord|recordCourseEvidence|blockCourseEvidence/);
assert.match(physics, /window\.PhysicsSim = PhysicsSim/);

console.log('physics-mechanics-binding-contract: restored owner rejects course binding PASS');
