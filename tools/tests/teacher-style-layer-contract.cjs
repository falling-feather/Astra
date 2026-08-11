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
const version = '20260730v785TeacherNaturalWorkflowP0';
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

function specificity(selector) {
  const ids = (selector.match(/#[\w-]+/g) || []).length;
  const classes = (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length;
  const elements = (selector.match(/(?:^|[\s>+~])([a-z][\w-]*)/gi) || []).length;
  return [ids, classes, elements];
}

function wins(left, right) {
  if (!right) return true;
  if (left.important !== right.important) return left.important;
  for (let index = 0; index < 3; index += 1) {
    if (left.specificity[index] !== right.specificity[index]) {
      return left.specificity[index] > right.specificity[index];
    }
  }
  return left.order > right.order;
}

function cascadedMinHeight(matchingSelectors) {
  const matches = new Set(matchingSelectors);
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let rule;
  let order = 0;
  let winner = null;
  while ((rule = rulePattern.exec(normalizedCascade))) {
    order += 1;
    const declaration = rule[2].match(/min-height\s*:\s*(\d+)px\s*(!important)?/i);
    if (!declaration) continue;
    for (const rawSelector of rule[1].replace(/\/\*[\s\S]*?\*\//g, '').split(',')) {
      const selector = rawSelector.trim();
      if (!matches.has(selector)) continue;
      const candidate = {
        value: Number(declaration[1]),
        important: Boolean(declaration[2]),
        specificity: specificity(selector),
        order,
      };
      if (wins(candidate, winner)) winner = candidate;
    }
  }
  return winner && winner.value;
}

assert.equal(
  crypto.createHash('sha256').update(normalizedCascade).digest('hex'),
  '02048f69134e5c22f0fbce78643b323c5e79c682ad4478509a581b34715134b9',
  'teacher style layers must preserve the reviewed V8.0.13 showcase cascade byte order',
);

assert.match(foundation, /^\.teacher-page\s*\{/);
assert.doesNotMatch(foundation, /V7\.4\.37|V7\.5\.7/);
assert.match(workbench, /V7\.4\.37/);
assert.match(workbench, /\.teacher-overview-layout/);
assert.doesNotMatch(workbench, /V7\.5\.7/);
assert.match(curriculum, /V7\.5\.7/);
assert.match(curriculum, /\.teacher-curriculum-grid/);
assert.match(curriculum, /\.teacher-code-station/);
assert.match(foundation, /V7\.8\.5 · 教师自然工作流的全局边界与命中区/);
assert.match(foundation, /\.teacher-page button,[\s\S]*min-height:\s*44px/);
assert.match(workbench, /V7\.8\.5 · 三个主入口之外的低频流程统一收进二级折叠区/);
assert.match(workbench, /\.teacher-secondary-workflow/);
assert.match(curriculum, /V7\.8\.5 · 教师自然工作流/);
assert.match(curriculum, /\.teacher-progress-desktop[\s\S]*\.teacher-progress-mobile/);
assert.match(curriculum, /@media \(max-width: 760px\)[\s\S]*\.teacher-progress-desktop\s*\{[\s\S]*display:\s*none/);
assert.match(curriculum, /\.teacher-natural-dialog[\s\S]*max-height:\s*min\(820px, calc\(100dvh - 32px\)\)/);
assert.match(curriculum, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.teacher-natural-dialog \*/);
const floorIndex = curriculum.lastIndexOf('.teacher-page button,');
for (const legacyRule of ['min-height: 32px', 'min-height: 37px', 'min-height: 42px']) {
  assert.ok(curriculum.indexOf(legacyRule) < floorIndex, `${legacyRule} must precede the final 44px floor`);
}
const coreControls = {
  planPreset: ['.teacher-plan-presets button', '.teacher-page button'],
  planReset: ['.teacher-plan-presets button', '.teacher-page button'],
  planInput: ['.teacher-plan-row input', '.teacher-page input'],
  planSelect: ['.teacher-plan-row select', '.teacher-page select'],
  planReason: ['.teacher-plan-actions input', '.teacher-page input'],
  publish: ['.teacher-plan-actions button', '.teacher-page button'],
  evidenceCorrection: ['.teacher-evidence-event form button', '.teacher-page button'],
  pagination: ['.teacher-natural-pagination button', '.teacher-page button'],
  releaseConfirm: ['.teacher-natural-dialog button', '.teacher-natural-dialog__surface > footer button', '.teacher-page button'],
  scopeSummary: ['.teacher-page summary'],
  accountAction: [
    '.teacher-auth-state .astra-account__actions button',
    '.teacher-page button',
    '.teacher-page .teacher-auth-state .astra-account__actions button',
  ],
};
for (const [label, selectors] of Object.entries(coreControls)) {
  assert.ok(cascadedMinHeight(selectors) >= 44, `${label} computed cascade min-height must be at least 44px`);
}

console.log('teacher-style-layer-contract: ok');
