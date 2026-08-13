const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const frontier = fs.readFileSync(path.join(root, 'pages/frontier/frontier.css'), 'utf8');
const engineering = fs.readFileSync(path.join(root, 'pages/engineering/engineering.css'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'pages/engineering/bridge-truss.js'), 'utf8');

const desktop = frontier.slice(
  frontier.indexOf('/* FE-036:'),
  frontier.indexOf('.fg-course-footer', frontier.indexOf('/* FE-036:'))
);
assert.match(desktop, /@media \(min-width: 761px\)/,
  'same-frame composition must be desktop-only');
assert.match(desktop, /data-activity-key="engineering\.load-path"[^}]*\.fg-stage[\s\S]*position: sticky;[\s\S]*top: 72px;/,
  'the real observation field must remain in the viewport on desktop');
assert.match(desktop, /data-activity-key="engineering\.load-path"[^}]*\.fg-load-path[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
  'the teaching flow must use a compact desktop grid');
assert.match(desktop, /data-activity-key="engineering\.load-path"[^}]*\.fg-load-path[\s\S]*grid-auto-flow: dense/,
  'the desktop flow must backfill the assessment card instead of reserving a blank column');
assert.match(desktop, /\.fg-load-path__step:nth-of-type\(2\)[\s\S]*grid-column: 1 \/ -1/,
  'the exact B/C/D table must retain a full-width evidence row');
assert.match(frontier, /@media \(max-width: 760px\)[\s\S]*\.fg-hero, \.fg-course-head, \.fg-lab \{ grid-template-columns: 1fr;/,
  'mobile must retain the existing single-column lab');
assert.match(frontier, /\.fg-load-path select,[\s\S]*\.fg-load-path button \{[^}]*min-height: 44px;/,
  'load-path actions must retain 44px targets');
assert.doesNotMatch(desktop, /transform\s*:\s*scale|zoom\s*:|position\s*:\s*fixed/,
  'same-frame proof must not use page scaling or a fixed fake layer');
assert.doesNotMatch(desktop, /canvas::|content\s*:/,
  'CSS must not counterfeit canvas or evidence values');
assert.doesNotMatch(engineering, /data-load-path-stage|same-frame|sameFrame/,
  'the general engineering page must not become a second stage owner');
assert.match(bridge, /const enabledAction = \{[\s\S]*predict: stage === 'prediction'[\s\S]*D: stage === 'assessed'/,
  'the unique action gate must remain owned by the existing flow');
assert.doesNotMatch(bridge, /event_type\s*:\s*['"]completed['"]|record\(\s*['"]completed['"]/,
  'Engineering must not emit completed');

console.log('fe036 engineering same-frame contract: desktop sticky + compact evidence + mobile isolation PASS');
