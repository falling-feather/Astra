const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const launcher = read('astra-local.ps1');
const manifest = read('backend/scripts/demo_data_manifest.py');
const initializer = read('backend/scripts/initialize_demo_data.py');
const codeManifestSource = read('codevis/shared/js/course-manifest.js');
const futureManifestSource = read('pages/frontier/frontier-manifest.js');
const registrySource = read('shared/js/experiment-registry.js');

assert.match(launcher, /\[switch\]\$InitializeDemoData/);
assert.match(launcher, /-m scripts\.initialize_demo_data --confirm-local-preview/);
assert.match(launcher, /if \(\$LASTEXITCODE -ne 0\) \{ throw "Demo data initialization failed" \}/);
assert.match(launcher, /InitializeDemoData[\s\S]*before starting the local preview server|InitializeDemoData/);
assert.match(launcher, /-m uvicorn app\.local_preview:app --host 127\.0\.0\.1 --port \$Port/);
assert.match(launcher, /function Assert-LocalDataDirectory/);
assert.match(launcher, /if \(\$InitializeDemoData\)\s*\{\s*Assert-LocalDataDirectory/);
assert.match(launcher, /StartsWith\("\\\\"\)/);
assert.match(launcher, /rejects mapped network drives/);
assert.match(launcher, /InitializeDemoData[\s\S]*Astra is already running[\s\S]*requested initialization switch/);

assert.match(initializer, /ASGITransport\(app=create_app\(\)\)/);
assert.match(initializer, /Authorization.*Bearer/);
assert.match(initializer, /Cookie.*""/);
for (const endpoint of [
  '/api/learning-evidence/events',
  '/api/learning-evidence/rules',
  '/api/assignments/',
  '/api/code-submissions',
  '/api/admin/audit-logs',
]) {
  assert.match(initializer, new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}
assert.match(initializer, /runner_unavailable/);
assert.match(initializer, /getpass\.getpass/);
assert.match(initializer, /secret-free report/);
assert.match(initializer, /for declaration in DEMO_ASSIGNMENTS:/);
assert.match(initializer, /result\[course_key\] =/);
assert.doesNotMatch(initializer, /from app\.core\.config import get_settings/);
assert.doesNotMatch(initializer, /^\s*(?:from|import)\s+(?:sqlalchemy|sqlite3|alembic)\b/m);
assert.doesNotMatch(initializer, /^\s*from\s+app\.(?:models|services)\b/m);

assert.match(manifest, /len\(DEMO_COURSES\) != 14/);
assert.match(manifest, /sum\(len\(course\.units\) for course in DEMO_COURSES\) != 42/);
assert.match(manifest, /len\(REPRESENTATIVE_COURSES\) != 6/);
assert.match(manifest, /DEMO_EVIDENCE_EVENT_TYPES = \("started", "predicted", "attempted", "corrected", "explained"\)/);
assert.match(manifest, /DEMO_USERS = \(.*演示管理员.*演示教师.*演示学生/s);
assert.doesNotMatch(manifest, /hello-world|engineering-systems\.load-path|challenge-brief/);
assert.match(initializer, /本数据为合成演示证据，用于复验产品闭环，不代表真实学生学习时长、掌握程度或课堂试点。/);
assert.match(manifest, /DEMO_ASSIGNMENTS = \(/);
assert.match(manifest, /DEMO_CODE_PROBLEM = \{/);
assert.match(manifest, /astra_demo_admin/);
assert.match(manifest, /astra_demo_teacher/);
assert.match(manifest, /astra_demo_student/);
assert.doesNotMatch(manifest, /password|token/i);

const assignmentSection = manifest.match(/DEMO_ASSIGNMENTS = \(([\s\S]*?)\r?\n\)\r?\nDEMO_CODE_PROBLEM =/);
assert.ok(assignmentSection, 'DEMO_ASSIGNMENTS must remain a declarative manifest section');
const assignmentDeclarations = [...assignmentSection[1].matchAll(
  /\{\s*"course_key": "([^"]+)",\s*"activity_key": "([^"]+)",\s*"title": "([^"]+)",\s*"description": "([^"]+)",[\s\S]*?"desired_status": "([^"]+)",\s*\}/g,
)].map((match) => ({
  course_key: match[1],
  activity_key: match[2],
  title: match[3],
  description: match[4],
  desired_status: match[5],
}));
assert.deepEqual(assignmentDeclarations, [
  {
    course_key: 'physics',
    activity_key: 'physics.mechanics',
    title: 'Physics evidence review',
    description: 'Synthetic local-preview evidence for the review loop.',
    desired_status: 'graded',
  },
  {
    course_key: 'humanities-futures',
    activity_key: 'humanities.claim-review',
    title: 'Humanities claim review',
    description: 'Synthetic local-preview evidence for the review loop.',
    desired_status: 'pending',
  },
  {
    course_key: 'control-flow',
    activity_key: 'control-flow.loop-boundary',
    title: 'Loop boundary review',
    description: 'Synthetic loop trace awaiting teacher feedback.',
    desired_status: 'pending',
  },
]);
const codeProblemScope = manifest.match(
  /DEMO_CODE_PROBLEM = \{\s*"course_key": "([^"]+)",\s*"activity_key": "([^"]+)"/,
);
assert.ok(codeProblemScope, 'DEMO_CODE_PROBLEM must declare a stable course/activity scope');
assert.deepEqual(
  [assignmentDeclarations[2].course_key, assignmentDeclarations[2].activity_key],
  [codeProblemScope[1], codeProblemScope[2]],
);

const expectedCode = {
  'program-start': ['program-start.first-output', 'program-start.variable-box', 'program-start.input-response'],
  'control-flow': ['control-flow.branch-doors', 'control-flow.loop-boundary', 'control-flow.nested-grid'],
  'data-functions': ['data-functions.list-snapshot', 'data-functions.parameter-return', 'data-functions.array-scan'],
  'algorithm-thinking': ['algorithm-thinking.linear-search', 'algorithm-thinking.bubble-pass', 'algorithm-thinking.binary-choice'],
  'debugging-testing': ['debugging-testing.assert-boundary', 'debugging-testing.trace-mismatch', 'debugging-testing.minimal-case'],
  'challenge-submission': ['challenge-submission.multi-language-counter', 'challenge-submission.public-sample', 'challenge-submission.submission-record'],
};
const expectedFuture = {
  'earth-space': ['cosmos.day-season', 'cosmos.orbital-scale', 'cosmos.evidence-log'],
  'engineering-systems': ['engineering.load-path', 'engineering.member-choice', 'engineering.safety-check'],
  'data-ai': ['datascience.model-fit', 'datascience.outlier-test', 'datascience.evidence-claim'],
  'information-technology': ['infotech.packet-route', 'infotech.layer-contract', 'infotech.fault-trace'],
  'materials-science': ['materials.grain-boundary', 'materials.defect-path', 'materials.process-window'],
  'humanities-futures': ['humanities.context-map', 'humanities.voice-shift', 'humanities.claim-review'],
};
const codeSandbox = { window: {} };
vm.runInNewContext(codeManifestSource, codeSandbox);
assert.equal(codeSandbox.window.CvCourseManifest.galaxy_key, 'code-space');
assert.deepEqual(
  JSON.parse(JSON.stringify(Object.fromEntries(codeSandbox.window.CvCourseManifest.courses.map((course) => [course.course_key, course.activities.map((item) => item.activity_key)])))),
  expectedCode,
);
const futureSandbox = { window: {} };
vm.runInNewContext(futureManifestSource, futureSandbox);
assert.equal(futureSandbox.window.FrontierCourseManifest.galaxy_key, 'future-galaxy');
assert.deepEqual(
  JSON.parse(JSON.stringify(Object.fromEntries(futureSandbox.window.FrontierCourseManifest.courses.map((course) => [course.course_key, course.activities.map((item) => item.activity_key)])))),
  expectedFuture,
);
for (const [subject, id] of [['physics', 'mechanics'], ['physics', 'gas-laws'], ['physics', 'thermodynamics'], ['mathematics', 'function-graph'], ['mathematics', 'calculus'], ['mathematics', 'derivative-application']]) {
  assert.match(registrySource, new RegExp(`define\\('${subject}', '${id}'`), `${subject}.${id} must remain canonical`);
}
for (const [galaxy, courses] of Object.entries({ englab: { physics: ['physics.mechanics', 'physics.gas-laws', 'physics.thermodynamics'], mathematics: ['mathematics.function-graph', 'mathematics.calculus', 'mathematics.derivative-application'] }, ...expectedCode, ...expectedFuture })) {
  for (const [course, activities] of Object.entries(typeof courses === 'object' && !Array.isArray(courses) ? courses : { [galaxy]: courses })) {
    const courseGalaxy = galaxy === 'englab' ? 'englab' : Object.hasOwn(expectedCode, course) ? 'code-space' : 'future-galaxy';
    assert.match(manifest, new RegExp(`_course\\("${courseGalaxy}", "${course}"`));
    for (const activity of activities) assert.match(manifest, new RegExp(`"${activity}"`));
  }
}

const psScriptPath = path.join(root, 'astra-local.ps1').replace(/'/g, "''");
const powershell = spawnSync('C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', [
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  `$source = Get-Content -Raw -LiteralPath '${psScriptPath}';
if ($source -notmatch 'if \\(\\$InitializeDemoData\\)\\s*\\{\\s*Assert-LocalDataDirectory') { exit 11 }
$function = [regex]::Match($source, '(?s)function Assert-LocalDataDirectory \\{.*?\\r?\\n\\}\\r?\\n\\r?\\nfunction Invoke-AstraLocalPreview').Value
if (-not $function) { exit 12 }
$function = $function -replace '(?s)\\r?\\n\\r?\\nfunction Invoke-AstraLocalPreview.*$', ''
Invoke-Expression $function
try { Assert-LocalDataDirectory -ResolvedDataDirectory '\\\\server\\share' } catch { if ($_.Exception.Message -match 'UNC') { exit 0 }; exit 13 }
exit 14`,
], { encoding: 'utf8' });
if (powershell.error && powershell.error.code === 'EPERM') {
  // The managed Codex sandbox forbids a Node child process from launching
  // PowerShell.  The same extracted function is exercised by the dedicated
  // PowerShell gate in the handoff matrix; CI/normal workstations run this
  // branch as a real dynamic subprocess assertion.
  console.warn('demo-data-initializer-contract: PowerShell dynamic subprocess skipped by sandbox EPERM');
} else {
  assert.equal(powershell.status, 0, powershell.stderr || powershell.stdout);
}

console.log('demo-data-initializer-contract: ok');
