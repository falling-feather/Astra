const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const registrySource = read('shared/js/page-registry.js');
const context = { window: {} };

vm.runInNewContext(registrySource, context, { filename: 'shared/js/page-registry.js' });
const styles = Array.from(context.window.AstraPageRegistry.stylesFor('teacher'));
const version = '20260719v75ReviewTeacherLayersP0';
const expected = [
  `pages/teacher/teacher-foundation.css?v=${version}`,
  `pages/teacher/teacher-workbench.css?v=${version}`,
  `pages/teacher/teacher-curriculum.css?v=${version}`,
];

assert.deepEqual(styles, expected, 'teacher style layers must keep their cascade order');
assert.deepEqual(
  Array.from(context.window.AstraPageRegistry.stylesForRole('admin')),
  [...expected, 'pages/admin/admin.css?v=20260729v794AdminGovernanceP0'],
  'admin must reuse the complete teacher cascade before its governance overrides',
);
for (const resource of styles) {
  const file = resource.split('?')[0];
  assert.ok(fs.existsSync(path.join(root, file)), `teacher style layer must exist: ${file}`);
}
assert.equal(fs.existsSync(path.join(root, 'pages/teacher/teacher.css')), false, 'legacy monolithic style must stay removed');

const foundation = read('pages/teacher/teacher-foundation.css');
const workbench = read('pages/teacher/teacher-workbench.css');
const curriculum = read('pages/teacher/teacher-curriculum.css');
const normalizedCascade = `${foundation}${workbench}${curriculum}`.replace(/\r\n?/g, '\n');

assert.equal(
  crypto.createHash('sha256').update(normalizedCascade).digest('hex'),
  'e0e38848a702fd66f906f57eb29c7d32ae0a977734c11abd03e42264ee397028',
  'teacher style split must preserve the frozen pre-split cascade byte order',
);

assert.match(foundation, /^\.teacher-page\s*\{/);
assert.doesNotMatch(foundation, /V7\.4\.37|V7\.5\.7/);
assert.match(workbench, /V7\.4\.37/);
assert.match(workbench, /\.teacher-overview-layout/);
assert.doesNotMatch(workbench, /V7\.5\.7/);
assert.match(curriculum, /V7\.5\.7/);
assert.match(curriculum, /\.teacher-curriculum-grid/);
assert.match(curriculum, /\.teacher-code-station/);

console.log('teacher-style-layer-contract: ok');
