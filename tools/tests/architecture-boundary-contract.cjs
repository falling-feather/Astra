const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const manifestPath = path.join(root, 'tools/architecture/v76-module-boundaries.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const normalizePath = (filePath) => path.relative(root, filePath).replace(/\\/g, '/');
const lineCount = (source) => source.replace(/\r\n?/g, '\n').split('\n').length - (
  source.endsWith('\n') || source.endsWith('\r') ? 1 : 0
);

function walk(directory, predicate = () => true) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'vendor', '.venv', '__pycache__'].includes(entry.name)) return [];
      return walk(fullPath, predicate);
    }
    return predicate(fullPath) ? [fullPath] : [];
  });
}

function normalizedModelImportBlocks(source) {
  const blocks = [];
  for (const match of source.matchAll(/from\s+app\.models(?:\.[A-Za-z_][A-Za-z0-9_]*)*\s+import\s*\(([\s\S]*?)\)/g)) {
    blocks.push(match[0].replace(/\s+/g, ' ').trim());
  }
  for (const match of source.matchAll(/from\s+\.{2,}models(?:\.[A-Za-z_][A-Za-z0-9_]*)*\s+import\s*\(([\s\S]*?)\)/g)) {
    blocks.push(match[0].replace(/\s+/g, ' ').trim());
  }
  for (const match of source.matchAll(/^from\s+app\.models(?:\.[A-Za-z_][A-Za-z0-9_]*)*\s+import\s+([^\r\n]+)/gm)) {
    if (!match[0].includes('(')) blocks.push(match[0].replace(/\s+/g, ' ').trim());
  }
  for (const match of source.matchAll(/^from\s+\.{2,}models(?:\.[A-Za-z_][A-Za-z0-9_]*)*\s+import\s+([^\r\n]+)/gm)) {
    if (!match[0].includes('(')) blocks.push(match[0].replace(/\s+/g, ' ').trim());
  }
  for (const match of source.matchAll(/^import\s+app\.models(?:\.[A-Za-z_][A-Za-z0-9_]*)*(?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?[^\r\n]*$/gm)) {
    blocks.push(match[0].replace(/\s+/g, ' ').trim());
  }
  for (const match of source.matchAll(/^from\s+app\s+import\s+([^\r\n]*\bmodels\b[^\r\n]*)$/gm)) {
    blocks.push(match[0].replace(/\s+/g, ' ').trim());
  }
  for (const match of source.matchAll(/^from\s+\.{2,}\s+import\s+([^\r\n]*\bmodels\b[^\r\n]*)$/gm)) {
    blocks.push(match[0].replace(/\s+/g, ' ').trim());
  }
  return blocks;
}

function hashImportBlocks(blocks) {
  return crypto.createHash('sha256').update(blocks.join('\n')).digest('hex');
}

function endpointModelImportIsAllowed(relativePath, source) {
  const blocks = normalizedModelImportBlocks(source);
  if (!blocks.length) return true;
  const expectedHash = manifest.legacy_endpoint_model_import_hashes[relativePath];
  return Boolean(expectedHash && hashImportBlocks(blocks) === expectedHash);
}

function forbiddenBackendImports(relativePath, source) {
  const forbiddenImports = relativePath.startsWith('backend/app/api/endpoints/')
    ? [
      /^(?:from|import)\s+app\.api\.endpoints(?:\.|\s|$)/,
      /^from\s+\.(?:\s+import|[A-Za-z_][A-Za-z0-9_.]*\s+import)/,
    ]
    : relativePath.startsWith('backend/app/models/')
      || relativePath.startsWith('backend/app/schemas/')
      || relativePath.startsWith('backend/app/services/')
      ? [
        /^(?:from|import)\s+app\.api(?:\.|\s|$)/,
        /^from\s+\.{2,}api(?:\.|\s|$)/,
        /^from\s+\.{2,}\s+import\s+[^\r\n]*\bapi\b/,
      ]
      : null;
  if (!forbiddenImports) return [];
  return source
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => forbiddenImports.some((pattern) => pattern.test(line)));
}

function backendImportsAreAllowed(relativePath, source) {
  const observed = forbiddenBackendImports(relativePath, source);
  const legacy = manifest.legacy_backend_upward_imports[relativePath] || [];
  return observed.every((line) => legacy.includes(line));
}

function learningEvidenceApiIsAllowed(relativePath, source) {
  return manifest.learning_evidence_api_fragments.every(
    (fragment) => !source.includes(fragment) || manifest.learning_evidence_api_owners.includes(relativePath),
  );
}

function ownedGlobalDefinitions(relativePath, source) {
  const definitions = [];
  for (const [symbol, owner] of Object.entries(manifest.frontend_single_owner_globals)) {
    const assignmentPatterns = [
      new RegExp(`(?:globalThis|global|window)(?:\\.${symbol}|\\[['"]${symbol}['"]\\])\\s*(?:=|\\|\\|=|&&=|\\?\\?=)`),
      new RegExp(`Object\\.defineProperty\\((?:globalThis|global|window),\\s*['"]${symbol}['"]`),
      new RegExp(`Object\\.defineProperties\\((?:globalThis|global|window),\\s*\\{[\\s\\S]{0,1000}?\\b${symbol}\\s*:`),
      new RegExp(`Object\\.assign\\((?:globalThis|global|window),\\s*\\{[\\s\\S]{0,1000}?(?:\\b${symbol}\\b\\s*(?::|[,}])|['"]${symbol}['"]\\s*:)`),
      new RegExp(`Reflect\\.(?:set|defineProperty)\\((?:globalThis|global|window),\\s*['"]${symbol}['"]`),
    ];
    if (assignmentPatterns.some((pattern) => pattern.test(source))) {
      definitions.push({ symbol, owner, valid: relativePath === owner });
    }
  }
  return definitions;
}

const versionDeclaration = /\b(?:const|let|var)\s+([A-Z0-9_]+_(?:ASSET|RESOURCE)_VERSION)\s*=|^\s*(_galaxyCacheVersion)\s*:|^\s*const\s+(CACHE_NAME)\s*=/gm;
function resourceVersionDeclarations(relativePath, source) {
  return [...source.matchAll(versionDeclaration)]
    .map((match) => `${relativePath}:${match[1] || match[2] || match[3]}`);
}

function quotedValues(source) {
  return [...source.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

function pythonLiteralValues(source, alias) {
  const match = new RegExp(`${alias}\\s*=\\s*Literal\\[([^\\]]+)\\]`).exec(source);
  return match ? quotedValues(match[1]) : [];
}

function learnerDerivedEvidenceWrites(source) {
  const eventTypes = [];
  const patterns = [
    /\b(?:record|emitEvidence)\s*\(\s*['"](completed|transferred)['"]/g,
    /\b(?:event_type|eventType)\s*:\s*['"](completed|transferred)['"]/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) eventTypes.push(match[1]);
  }
  return eventTypes;
}

function contentModuleViolations(relativePath, source) {
  if (!/^pages\/frontier\/content\/.*\.(?:[cm]?js)$/i.test(relativePath)) return [];
  const violations = [];
  if (/\bfetch\s*\(|\bXMLHttpRequest\b|\bAstraApiClient\s*\.\s*request\s*\(/.test(source)) {
    violations.push('network-authority');
  }
  if (/\b(?:localStorage|sessionStorage)\b/.test(source)) violations.push('browser-progress-authority');
  const directGlobalRegistration = /(?:globalThis|global|window)(?:\.[A-Za-z_$][A-Za-z0-9_$]*|\[\s*['"][^'"]+['"]\s*\])\s*(?:=(?!=)|\|\|=|&&=|\?\?=)/;
  const indirectGlobalRegistration = /(?:Object\.(?:assign|defineProperty|defineProperties)|Reflect\.(?:set|defineProperty))\(\s*(?:globalThis|global|window)\b/;
  if (directGlobalRegistration.test(source) || indirectGlobalRegistration.test(source)) {
    violations.push('runtime-global-registration');
  }
  return violations;
}

const architectureContract = manifest.architecture_contract;
const activityRuntimeContract = manifest.activity_runtime_contract;
const learningActivityContract = manifest.learning_activity_contract;
const contractDocument = read(architectureContract.document);

assert.equal(manifest.schema_version, 'astra-architecture-boundaries-v2');
assert.match(manifest.baseline_revision, /^[0-9a-f]{40}$/);
assert.equal(manifest.baseline_revision, architectureContract.frozen_at_revision);
assert.equal(architectureContract.task_id, 'ARCH-003');
assert.equal(architectureContract.version_token, 'V8.0.0');
assert.deepEqual(Object.keys(architectureContract.decision_vocabulary), [
  'direct_absorb',
  'reimplement',
  'reference_only',
  'unusable',
]);
assert.deepEqual(architectureContract.allowed_write_paths, [
  'doc/02-子文档/24-V7.6全栈模块边界契约.md',
  'tools/architecture/v76-module-boundaries.json',
  'tools/tests/architecture-boundary-contract.cjs',
]);
assert.equal(activityRuntimeContract.task_id, 'ARCH-004');
assert.equal(activityRuntimeContract.version_token, 'V8.0.9');
assert.equal(activityRuntimeContract.baseline_revision, 'f925f658442352cdc93f81768f1d7fb93553b863');
assert.equal(activityRuntimeContract.owner_global, 'AstraLearningActivity');
assert.equal(activityRuntimeContract.owner_path, 'shared/js/learning-activity.js');
assert.equal(activityRuntimeContract.runtime_test, 'tools/tests/learning-activity-runtime-contract.cjs');
assert.equal(activityRuntimeContract.schema_version, 'astra-learning-activity-v1');
assert.equal(activityRuntimeContract.recovery_schema_version, 'astra-learning-activity-recovery-v1');
assert.equal(activityRuntimeContract.event_envelope_schema_version, 'astra-learning-activity-event-v1');
assert.equal(activityRuntimeContract.provenance_schema_version, 'astra-raw-evidence-provenance-v1');
assert.deepEqual(activityRuntimeContract.allowed_write_paths, [
  'shared/js/learning-activity.js',
  'tools/architecture/v76-module-boundaries.json',
  'tools/tests/architecture-boundary-contract.cjs',
  'tools/tests/learning-activity-runtime-contract.cjs',
  'doc/02-子文档/24-V7.6全栈模块边界契约.md',
]);
assert.deepEqual(activityRuntimeContract.runtime_identity_fields, [
  'class_id',
  'course_id',
  'course_unit_id',
  'activity_key',
  'subject_identity',
  'run_id',
  'group_id',
  'manifest_version',
  'content_version',
  'event_schema_version',
  'rule_version',
  'generation',
]);
assert.deepEqual(activityRuntimeContract.manifest_canonical_fields, [
  'identity.galaxy_key',
  'identity.course_key',
  'identity.activity_key',
  'identity.manifest_version',
  'identity.content_version',
  'identity.event_schema_version',
  'route.canonical',
  'owner_adapter.id',
  'content.state_schema_version',
  'assessment.rubric_id',
  'assessment.rubric_version',
]);
assert.deepEqual(activityRuntimeContract.manifest_release_scope_contract, {
  required: ['class_id', 'course_id', 'course_unit_id'],
  optional: ['activity_key'],
  unique: true,
});
assert.deepEqual(activityRuntimeContract.subject_identity_kinds, ['learner', 'session']);
assert.equal(activityRuntimeContract.caller_abort_code, 'operation_aborted');
assert.equal(activityRuntimeContract.dispose_code, 'activity_disposed');
assert.deepEqual(activityRuntimeContract.release_scope_fields, [
  'class_id',
  'course_id',
  'course_unit_id',
]);
assert.deepEqual(activityRuntimeContract.release_optional_scope_fields, ['activity_key']);
assert.deepEqual(activityRuntimeContract.release_forbidden_identity_fields, [
  'subject_identity',
  'run_id',
  'group_id',
  'manifest_version',
  'content_version',
  'event_schema_version',
  'rule_version',
  'generation',
]);
assert.match(activityRuntimeContract.manual_latch, /identity-bound/);
assert.match(activityRuntimeContract.manual_latch, /same-identity resolution or dispose/);
assert.deepEqual(activityRuntimeContract.required_injected_ports, {
  authority: 'verify',
  release: 'resolve',
  recovery: 'load',
  evaluation: 'assess',
  evidence: 'emit',
});
assert.deepEqual(
  activityRuntimeContract.required_adapter_methods,
  ['restore', 'predict', 'observe', 'dispose'],
);
assert.deepEqual(activityRuntimeContract.adapter_effect_contract, {
  atomicity_scope: 'runtime-state-only',
  prepare_phase: 'adapter methods prepare and return domain state; they must not commit DOM, Canvas, storage or other external state before the runtime promise succeeds',
  commit_phase: 'the page owner commits prepared external effects only after the runtime promise succeeds',
  long_lived_effects: 'an adapter that starts a long-lived effect must observe the injected AbortSignal and release that effect from dispose',
  known_limit: 'the kernel discards late adapter results but cannot roll back external effects produced by an adapter that ignores AbortSignal',
  negative_fixture: 'adapter-side-effect-after-abort',
});
assert.deepEqual(activityRuntimeContract.binding_query_contract, {
  rounds: 'pre-operation and post-operation',
  within_round: 'authority.verify and release.resolve start concurrently and keep independent owners',
  failure: 'each port validates its resolved result inside its own promise chain; resolved denial, malformed result or rejected error aborts the peer and fails closed with the original business error',
  performance_claim: 'concurrent scheduling is contracted; real network latency, cache behavior and p95 remain NOT-RUN',
});
assert.deepEqual(activityRuntimeContract.manual_resolution_actions, [
  'apply-atomic-snapshot',
  'verified-safe-restart',
]);
assert.ok(activityRuntimeContract.recovery_guards.includes('causal_completion_witness'));
assert.deepEqual(activityRuntimeContract.raw_source_kinds, ['request', 'response', 'state', 'dom']);
assert.equal(activityRuntimeContract.provenance_assurance, 'consistency-only');
assert.deepEqual(activityRuntimeContract.reference_adapter_kinds, ['simulation', 'code', 'future']);
assert.match(activityRuntimeContract.current_backend_recovery_capability, /projection-only/);
assert.ok(activityRuntimeContract.forbidden_runtime_dependencies.length >= 6);
assert.equal(
  manifest.current_learning_architecture.activity_runtime,
  activityRuntimeContract.owner_path,
);

const activityRuntimeSource = read(activityRuntimeContract.owner_path);
const activityRuntimeTestSource = read(activityRuntimeContract.runtime_test);
assert.ok(
  lineCount(activityRuntimeSource) <= activityRuntimeContract.runtime_line_ceiling,
  'AstraLearningActivity exceeds its architecture ceiling',
);
assert.doesNotMatch(
  activityRuntimeSource,
  /\b(?:fetch|XMLHttpRequest|localStorage|sessionStorage|indexedDB)\b/,
  'the architecture kernel cannot own HTTP or browser storage',
);
assert.doesNotMatch(
  activityRuntimeSource,
  /AstraLearningEvidence(?:Client|Activity|Queue)/,
  'the architecture kernel must consume injected ports instead of product globals',
);
const activityRuntimeContext = { window: {}, AbortController, Date };
vm.runInNewContext(activityRuntimeSource, activityRuntimeContext, {
  filename: activityRuntimeContract.owner_path,
});
const activityRuntimeApi = activityRuntimeContext.window.AstraLearningActivity;
assert.ok(activityRuntimeApi && Object.isFrozen(activityRuntimeApi));
assert.equal(activityRuntimeApi.schemaVersion, activityRuntimeContract.schema_version);
assert.equal(activityRuntimeApi.recoverySchemaVersion, activityRuntimeContract.recovery_schema_version);
assert.equal(
  activityRuntimeApi.eventEnvelopeSchemaVersion,
  activityRuntimeContract.event_envelope_schema_version,
);
assert.equal(activityRuntimeApi.provenanceSchemaVersion, activityRuntimeContract.provenance_schema_version);
assert.deepEqual(Array.from(activityRuntimeApi.runtimeStates), learningActivityContract.runtime_states);
assert.deepEqual(Array.from(activityRuntimeApi.projectionStates), learningActivityContract.projection_states);
assert.deepEqual(Array.from(activityRuntimeApi.learnerEventTypes), learningActivityContract.learner_event_types);
assert.deepEqual(
  Array.from(activityRuntimeApi.serverDerivedEventTypes),
  learningActivityContract.server_derived_event_types,
);
assert.deepEqual(Array.from(activityRuntimeApi.rawSourceKinds), activityRuntimeContract.raw_source_kinds);
assert.ok(
  activityRuntimeTestSource.includes(activityRuntimeContract.adapter_effect_contract.negative_fixture),
  'runtime contract must execute the adapter side-effect limitation fixture',
);
assert.ok(
  activityRuntimeTestSource.includes('binding-round-concurrent-start')
    && activityRuntimeTestSource.includes('binding-peer-failure-aborts-round'),
  'runtime contract must execute concurrent binding and peer-failure fixtures',
);
assert.ok(
  activityRuntimeTestSource.includes('binding-resolved-authority-denial-fail-fast')
    && activityRuntimeTestSource.includes('binding-resolved-release-denial-fail-fast'),
  'runtime contract must execute resolved-negative fail-fast fixtures in both directions',
);
assert.ok(
  activityRuntimeTestSource.includes('manifest-whitespace-fail-closed')
    && activityRuntimeTestSource.includes('manifest-release-scope-exact')
    && activityRuntimeTestSource.includes('completion-witness-causal-order'),
  'runtime contract must execute factory canonicalization and causal witness fixtures',
);
for (const fixtureKind of activityRuntimeContract.reference_adapter_kinds) {
  assert.ok(
    activityRuntimeTestSource.includes("['" + fixtureKind + "'")
      || activityRuntimeTestSource.includes("'" + fixtureKind + "'"),
    'runtime contract must execute the ' + fixtureKind + ' conformance fixture',
  );
}

for (const token of [
  architectureContract.task_id,
  architectureContract.version_token,
  architectureContract.frozen_at_revision,
  ...Object.values(architectureContract.decision_vocabulary),
]) {
  assert.ok(contractDocument.includes(token), `architecture document must contain ${token}`);
}
for (const token of [
  activityRuntimeContract.task_id,
  activityRuntimeContract.version_token,
  activityRuntimeContract.baseline_revision,
  activityRuntimeContract.schema_version,
  activityRuntimeContract.recovery_schema_version,
  activityRuntimeContract.event_envelope_schema_version,
  activityRuntimeContract.provenance_schema_version,
  ...activityRuntimeContract.runtime_identity_fields,
  activityRuntimeContract.caller_abort_code,
  activityRuntimeContract.dispose_code,
  ...Object.keys(activityRuntimeContract.required_injected_ports),
  ...activityRuntimeContract.manual_resolution_actions,
  ...activityRuntimeContract.raw_source_kinds,
]) {
  const tick = String.fromCharCode(96);
  assert.ok(
    contractDocument.includes(tick + token + tick),
    'architecture document must explain ARCH-004 token ' + token,
  );
}
const arch004Document = contractDocument.slice(contractDocument.indexOf('## 17. ARCH-004'));
assert.ok(arch004Document.length > 0, 'architecture document must contain the ARCH-004 section');
for (const phrase of [
  'subgraph Ports["五个显式注入端口"]',
  'ready --> interacting: predict() / observe()',
  'Kernel->>Adapter: restore(frozen prepared input, signal)',
  'subgraph RawBoundary["共同 raw 来源边界（本片不证明真实性）"]',
  'prepare/return',
  'runtime Promise 成功后 commit',
  '必须由 `Promise.all` 并发启动',
  '每个 port promise 必须在自己的 chain 内立即执行 `authorityResult` / `releaseResult` 语义校验',
  '网络时延和 p95 均为 **NOT-RUN**',
  '`manifest-whitespace-fail-closed`',
  'manifest 的 `release.scope_fields` 必须唯一且精确包含',
  '每个 source sequence 必须严格早于 derived sequence',
]) {
  assert.ok(arch004Document.includes(phrase), `ARCH-004 layered analysis must contain ${phrase}`);
}
assert.ok(
  arch004Document.includes('`' + activityRuntimeContract.adapter_effect_contract.atomicity_scope + '`')
    && arch004Document.includes('`' + activityRuntimeContract.adapter_effect_contract.negative_fixture + '`'),
  'architecture document must freeze the adapter atomicity scope and its negative fixture',
);
for (const heading of ['**当前能证明**', '**当前不能证明**', '**后续接入点**']) {
  assert.ok(
    arch004Document.split(heading).length - 1 >= 4,
    `each ARCH-004 layered diagram must explain ${heading}`,
  );
}

for (const relativePath of Object.values(manifest.current_learning_architecture)) {
  if (typeof relativePath !== 'string' || !relativePath.includes('/')) continue;
  assert.ok(fs.existsSync(path.join(root, relativePath)), `current architecture path is missing: ${relativePath}`);
}

assert.equal(learningActivityContract.schema_version, 'astra-learning-activity-v1');
assert.equal(
  manifest.frontend_single_owner_globals.AstraLearningActivity,
  learningActivityContract.reserved_runtime_owner,
);
assert.deepEqual(learningActivityContract.runtime_methods, [
  'restore',
  'predict',
  'observe',
  'assess',
  'emitEvidence',
  'dispose',
]);
assert.deepEqual(learningActivityContract.runtime_states, [
  'created',
  'restoring',
  'ready',
  'interacting',
  'assessing',
  'blocked',
  'disposed',
]);
assert.deepEqual(learningActivityContract.projection_states, [
  'not_started',
  'in_progress',
  'completed',
  'transferred',
]);
assert.deepEqual(learningActivityContract.learner_event_types, [
  'started',
  'predicted',
  'attempted',
  'corrected',
  'explained',
]);
assert.deepEqual(learningActivityContract.server_derived_event_types, ['completed', 'transferred']);
assert.equal(
  learningActivityContract.learner_event_types.some(
    (eventType) => learningActivityContract.server_derived_event_types.includes(eventType),
  ),
  false,
  'learner facts and server-derived projection facts must remain disjoint',
);
assert.ok(
  learningActivityContract.transitions.some(
    (transition) => transition.from === '*' && transition.trigger === 'dispose' && transition.to === 'disposed',
  ),
  'every live runtime state must have an idempotent disposal path',
);
assert.deepEqual(
  learningActivityContract.ports.map((port) => port.id),
  ['manifest', 'state-machine', 'evidence', 'recovery', 'evaluation', 'release', 'teacher-projection'],
);
for (const port of learningActivityContract.ports) {
  assert.ok(port.owner && port.delivery && port.direction, `${port.id} must declare owner, delivery and direction`);
  assert.ok(port.minimum_contract && port.forbidden_authority, `${port.id} must declare its minimum and forbidden authority`);
}
assert.deepEqual(Object.keys(learningActivityContract.team_boundaries), ['ARCH', 'FE', 'BE', 'CONTENT', 'QA']);
for (const [team, boundary] of Object.entries(learningActivityContract.team_boundaries)) {
  assert.ok(boundary.may_own.length > 0, `${team} must have an owned surface`);
  assert.ok(boundary.must_not.length > 0, `${team} must have a forbidden surface`);
}
for (const token of [
  ...learningActivityContract.identity_fields,
  ...learningActivityContract.manifest_required_sections,
  ...learningActivityContract.runtime_methods,
  ...learningActivityContract.runtime_states,
  ...learningActivityContract.projection_states,
  ...learningActivityContract.ports.map((port) => port.id),
]) {
  assert.ok(contractDocument.includes(`\`${token}\``), `architecture document must explain ${token}`);
}

const noTouchPaths = [
  ...manifest.v8_first_wave_no_touch.legacy_shell_paths,
  ...manifest.v8_first_wave_no_touch.legacy_role_paths,
  ...manifest.v8_first_wave_no_touch.legacy_fact_paths,
];
for (const relativePath of noTouchPaths) {
  assert.ok(fs.existsSync(path.join(root, relativePath)), `first-wave no-touch path is missing: ${relativePath}`);
  assert.ok(
    Object.hasOwn(manifest.legacy_line_ceilings, relativePath),
    `first-wave no-touch path must also be guarded by a legacy ceiling: ${relativePath}`,
  );
  assert.ok(contractDocument.includes(`\`${relativePath}\``), `architecture document must list no-touch path ${relativePath}`);
}

const candidateAudit = manifest.legacy_candidate_audit.candidates;
const candidateIds = ['f017', 'f017a', 'f017b', 'f017c', 'fr89', 'ux64', 'u358', 'c003'];
assert.deepEqual(candidateAudit.map((candidate) => candidate.id), candidateIds);
assert.deepEqual(manifest.v8_first_wave_no_touch.candidate_worktrees, candidateIds);
const expectedCandidateStatus = {
  f017: [36, 0, 22],
  f017a: [4, 0, 6],
  f017b: [4, 0, 6],
  f017c: [4, 0, 6],
  fr89: [7, 0, 0],
  ux64: [4, 0, 1],
  u358: [0, 0, 0],
};
const dispositionKeys = new Set(Object.keys(architectureContract.decision_vocabulary));
for (const candidate of candidateAudit) {
  assert.match(candidate.head, /^[0-9a-f]{40}$/);
  assert.match(candidate.fingerprint, /^[0-9a-f]{64}$/);
  assert.ok(dispositionKeys.has(candidate.overall_decision), `${candidate.id} has an unknown disposition`);
  assert.ok(candidate.path_decisions.length > 0, `${candidate.id} must have path-level decisions`);
  for (const decision of candidate.path_decisions) {
    assert.ok(dispositionKeys.has(decision.decision), `${candidate.id} has an unknown path decision`);
    assert.ok(decision.paths && decision.evidence && decision.risk && decision.owner, `${candidate.id} decision is incomplete`);
  }
  if (candidate.status) {
    assert.deepEqual(
      [candidate.status.tracked_modified, candidate.status.staged, candidate.status.untracked],
      expectedCandidateStatus[candidate.id],
      `${candidate.id} audit counts changed`,
    );
  } else {
    assert.equal(candidate.id, 'c003');
    assert.equal(candidate.snapshot_kind, 'git_metadata_only');
  }
  assert.ok(contractDocument.includes(`\`${candidate.id}\``), `architecture document must list ${candidate.id}`);
  assert.ok(contractDocument.includes(candidate.fingerprint), `architecture document must contain ${candidate.id} fingerprint`);
}
assert.deepEqual(
  candidateAudit.filter((candidate) => candidate.overall_decision === 'direct_absorb').map((candidate) => candidate.id),
  ['c003'],
  'only the already-identical c003 document blob may be classified as directly absorbed',
);

const catalogSource = read(manifest.current_learning_architecture.catalog);
const evidenceClientSource = read(manifest.current_learning_architecture.evidence_client);
const evidenceSchemaSource = read(manifest.current_learning_architecture.backend_schema);
const catalogEventDeclaration = /const ALLOWED_EVENTS = Object\.freeze\(\[([^\]]+)\]\)/.exec(catalogSource);
const clientEventDeclaration = /const EVENT_TYPES = new Set\(\[([^\]]+)\]\)/.exec(evidenceClientSource);
const clientProjectionDeclaration = /const SERVER_PROJECTION_TYPES = new Set\(\[([^\]]+)\]\)/.exec(evidenceClientSource);
assert.ok(catalogEventDeclaration && clientEventDeclaration && clientProjectionDeclaration);
assert.deepEqual(quotedValues(catalogEventDeclaration[1]), learningActivityContract.learner_event_types);
assert.deepEqual(quotedValues(clientEventDeclaration[1]), learningActivityContract.learner_event_types);
assert.deepEqual(quotedValues(clientProjectionDeclaration[1]), learningActivityContract.server_derived_event_types);
assert.deepEqual(
  pythonLiteralValues(evidenceSchemaSource, 'LearnerEvidenceEventType'),
  learningActivityContract.learner_event_types,
);
assert.deepEqual(
  pythonLiteralValues(evidenceSchemaSource, 'DerivedEvidenceEventType'),
  learningActivityContract.server_derived_event_types,
);
assert.deepEqual(
  pythonLiteralValues(evidenceSchemaSource, 'LearningProjectionStatus'),
  learningActivityContract.projection_states,
);

for (const [relativePath, ceiling] of Object.entries(manifest.legacy_line_ceilings)) {
  const source = read(relativePath);
  assert.ok(
    lineCount(source) <= ceiling,
    `${relativePath} is a frozen legacy surface (${lineCount(source)} > ${ceiling}); move new behavior into its owning module`,
  );
}

const endpointFiles = walk(path.join(root, 'backend/app/api/endpoints'), (file) => file.endsWith('.py'));
for (const file of endpointFiles) {
  const relativePath = normalizePath(file);
  const source = fs.readFileSync(file, 'utf8');
  const blocks = normalizedModelImportBlocks(source);
  if (!blocks.length) continue;
  assert.ok(
    endpointModelImportIsAllowed(relativePath, source),
    `${relativePath} added or changed a direct persistence-model import; depend on a domain service instead`,
  );
}

const backendPythonFiles = walk(path.join(root, 'backend/app'), (file) => file.endsWith('.py'));
for (const file of backendPythonFiles) {
  const relativePath = normalizePath(file);
  if (relativePath === 'backend/app/api/router.py' || relativePath === 'backend/app/main.py') continue;
  const source = fs.readFileSync(file, 'utf8');
  assert.ok(
    backendImportsAreAllowed(relativePath, source),
    `${relativePath} added a dependency on the HTTP adapter layer or a peer endpoint`,
  );
}

for (const file of walk(path.join(root, 'backend/app/models'), (candidate) => candidate.endsWith('.py'))) {
  const source = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(
    source,
    /^(?:(?:from|import)\s+app\.(?:api|schemas|services)(?:\.|\s|$)|from\s+\.\.(?:api|schemas|services)(?:\.|\s|$)|from\s+\.\.\s+import\s+[^\r\n]*\b(?:api|schemas|services)\b)/m,
    `${normalizePath(file)} must remain a persistence-layer module`,
  );
}
for (const file of walk(path.join(root, 'backend/app/schemas'), (candidate) => candidate.endsWith('.py'))) {
  const source = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(
    source,
    /^(?:(?:from|import)\s+app\.(?:api|models|services)(?:\.|\s|$)|from\s+\.\.(?:api|models|services)(?:\.|\s|$)|from\s+\.\.\s+import\s+[^\r\n]*\b(?:api|models|services)\b)/m,
    `${normalizePath(file)} must remain a transport DTO module`,
  );
}

const frontendRoots = ['shared', 'pages', 'codevis']
  .map((directory) => path.join(root, directory))
  .filter((directory) => fs.existsSync(directory));
const isFrontendScript = (file) => /\.(?:[cm]?js)$/i.test(file);
const frontendFiles = frontendRoots.flatMap((directory) => walk(directory, isFrontendScript));
for (const file of frontendFiles) {
  const relativePath = normalizePath(file);
  const source = fs.readFileSync(file, 'utf8');
  assert.ok(
    learningEvidenceApiIsAllowed(relativePath, source),
    `learning-evidence API paths must be owned only by the shared client, found in ${relativePath}`,
  );
  assert.deepEqual(
    learnerDerivedEvidenceWrites(source),
    [],
    `learner-side code cannot emit server-derived completed/transferred facts: ${relativePath}`,
  );
  assert.deepEqual(
    contentModuleViolations(relativePath, source),
    [],
    `content modules must remain immutable data without runtime authority: ${relativePath}`,
  );
}

for (const [symbol, owner] of Object.entries(manifest.frontend_single_owner_globals)) {
  const definingFiles = [];
  for (const file of frontendFiles) {
    const relativePath = normalizePath(file);
    const source = fs.readFileSync(file, 'utf8');
    const definitions = ownedGlobalDefinitions(relativePath, source);
    if (definitions.some((definition) => definition.symbol === symbol)) definingFiles.push(relativePath);
  }
  assert.deepEqual(
    definingFiles,
    fs.existsSync(path.join(root, owner)) ? [owner] : [],
    `${symbol} must have one owner: ${owner}`,
  );
}

const progressCallOwners = [];
for (const file of frontendFiles) {
  if (fs.readFileSync(file, 'utf8').includes('LearningProgress.markVisited')) {
    progressCallOwners.push(normalizePath(file));
  }
}
for (const owner of progressCallOwners) {
  assert.ok(
    manifest.legacy_learning_progress_call_owners.includes(owner),
    `legacy visit tracking cannot gain a new caller: ${owner}`,
  );
}

const observedVersionDeclarations = [];
for (const file of [...frontendFiles, path.join(root, 'sw.js')]) {
  const relativePath = normalizePath(file);
  const source = fs.readFileSync(file, 'utf8');
  observedVersionDeclarations.push(...resourceVersionDeclarations(relativePath, source));
}
for (const declaration of observedVersionDeclarations) {
  assert.ok(
    manifest.legacy_resource_version_declarations.includes(declaration),
    `new resource-version tables are forbidden: ${declaration}`,
  );
}

const capabilitySource = read('shared/js/product-capabilities.js');
const capabilityContext = { window: {} };
vm.runInNewContext(capabilitySource, capabilityContext, { filename: 'shared/js/product-capabilities.js' });
const capabilities = capabilityContext.window.AstraProductCapabilities;
assert.ok(capabilities);
assert.ok(Object.isFrozen(capabilities));
assert.deepEqual(Array.from(capabilities.statuses), ['available', 'partial', 'planned', 'unavailable']);
const records = Array.from(capabilities.all());
assert.equal(new Set(records.map((record) => record.key)).size, records.length, 'capability keys must be unique');
assert.deepEqual(
  Object.fromEntries(records.map((record) => [record.key, record.status])),
  manifest.product_capability_statuses,
  'the capability registry must exactly implement the frozen PM-009 key/status ledger',
);
assert.equal(capabilities.get('formal-oj').status, 'unavailable');
assert.equal(capabilities.get('authoritative-learning-evidence').status, 'partial');
assert.equal(capabilities.get('browser-precheck').status, 'available');
assert.equal(capabilities.get('last-learning-position').status, 'planned');
assert.equal(capabilities.canPresentAsPrimary('browser-precheck'), true);
assert.equal(capabilities.canPresentAsPrimary('formal-oj'), false);
assert.equal(capabilities.canPresentAsPrimary('last-learning-position'), false);
for (const record of records) {
  assert.ok(Object.isFrozen(record), `${record.key} must be immutable`);
  assert.ok(capabilities.statuses.includes(record.status), `${record.key} has an invalid status`);
  assert.ok(record.roles.length > 0, `${record.key} must declare roles`);
  assert.ok(record.evidenceSource, `${record.key} must declare its evidence source`);
  assert.ok(record.allowedClaim, `${record.key} must declare its allowed claim`);
  assert.ok(record.prohibitedClaims.length > 0, `${record.key} must declare prohibited claims`);
}

// Synthetic counterexamples keep the scanners honest without mutating the repository.
assert.equal(
  endpointModelImportIsAllowed(
    'backend/app/api/endpoints/architecture_negative_fixture.py',
    'from app.models import LearningEvent\n',
  ),
  false,
  'a new endpoint -> ORM dependency must be rejected',
);
assert.equal(
  endpointModelImportIsAllowed(
    'backend/app/api/endpoints/architecture_negative_fixture.py',
    'from app.models.learning_evidence import LearningEvidence\n',
  ),
  false,
  'a new endpoint -> ORM submodule dependency must be rejected',
);
assert.equal(
  endpointModelImportIsAllowed(
    'backend/app/api/endpoints/architecture_negative_fixture.py',
    'from ...models.learning_evidence import LearningEvidence\n',
  ),
  false,
  'a new endpoint -> ORM relative submodule dependency must be rejected',
);
assert.equal(
  backendImportsAreAllowed(
    'backend/app/services/architecture_negative_fixture.py',
    'from app.api.endpoints import learning_evidence\n',
  ),
  false,
  'a service -> HTTP adapter dependency must be rejected',
);
assert.equal(
  backendImportsAreAllowed(
    'backend/app/services/architecture_negative_fixture.py',
    'from ..api.endpoints import learning_evidence\n',
  ),
  false,
  'a relative service -> HTTP adapter dependency must be rejected',
);
assert.equal(
  backendImportsAreAllowed(
    'backend/app/api/endpoints/architecture_negative_fixture.py',
    'from app.api.endpoints import progress\n',
  ),
  false,
  'an endpoint -> peer endpoint dependency must be rejected',
);
assert.equal(
  backendImportsAreAllowed(
    'backend/app/api/endpoints/architecture_negative_fixture.py',
    'from .progress import read_progress\n',
  ),
  false,
  'a relative endpoint -> peer endpoint dependency must be rejected',
);
assert.equal(
  learningEvidenceApiIsAllowed(
    'pages/planets/architecture-negative-fixture.js',
    "fetch('/api/learning-evidence')",
  ),
  false,
  'a page-owned learning-evidence request must be rejected',
);
assert.equal(
  learningEvidenceApiIsAllowed(
    'pages/planets/architecture-negative-fixture.mjs',
    "fetch('/api/learning-evidence')",
  ),
  false,
  'an ES module page-owned learning-evidence request must be rejected',
);
assert.deepEqual(
  learnerDerivedEvidenceWrites("activity.emitEvidence('completed', evidence);"),
  ['completed'],
  'a learner-authored completed event must be detectable',
);
assert.deepEqual(
  learnerDerivedEvidenceWrites("const payload = { event_type: 'transferred' };"),
  ['transferred'],
  'a learner-authored transferred payload must be detectable',
);
assert.deepEqual(
  contentModuleViolations(
    'pages/frontier/content/engineering/load-path.js',
    "window.CourseContent = {}; fetch('/api/learning-evidence'); localStorage.setItem('progress', '1');",
  ),
  ['network-authority', 'browser-progress-authority', 'runtime-global-registration'],
  'content that owns network, progress or runtime registration must be rejected',
);
assert.deepEqual(
  contentModuleViolations(
    'pages/frontier/content/engineering/read-only-context.js',
    "const isCanonical = window.location.hash === '#frontier/engineering/load-path';",
  ),
  [],
  'a read-only global comparison must not be mistaken for runtime registration',
);
assert.deepEqual(
  ownedGlobalDefinitions(
    'pages/planets/architecture-negative-fixture.js',
    'globalThis.AstraLearningEvidenceClient = {};',
  ),
  [{
    symbol: 'AstraLearningEvidenceClient',
    owner: 'shared/js/learning-evidence-client.js',
    valid: false,
  }],
  'a duplicate global state-machine owner must be detectable',
);
assert.deepEqual(
  ownedGlobalDefinitions(
    'pages/planets/architecture-negative-fixture.mjs',
    "Object.assign(globalThis, { AstraLearningEvidenceClient: {} });",
  ),
  [{
    symbol: 'AstraLearningEvidenceClient',
    owner: 'shared/js/learning-evidence-client.js',
    valid: false,
  }],
  'an indirect duplicate global state-machine owner must be detectable',
);
assert.deepEqual(
  ownedGlobalDefinitions(
    'pages/frontier/architecture-negative-fixture.js',
    'window.AstraLearningActivity = {};',
  ),
  [{
    symbol: 'AstraLearningActivity',
    owner: 'shared/js/learning-activity.js',
    valid: false,
  }],
  'a duplicate LearningActivity runtime owner must remain detectable after implementation',
);
assert.equal(isFrontendScript('pages/planets/architecture-negative-fixture.mjs'), true);
assert.equal(isFrontendScript('pages/planets/architecture-negative-fixture.cjs'), true);
assert.deepEqual(
  resourceVersionDeclarations(
    'pages/planets/architecture-negative-fixture.js',
    "const PLANETS_NEW_RESOURCE_VERSION = 'v2';",
  ),
  ['pages/planets/architecture-negative-fixture.js:PLANETS_NEW_RESOURCE_VERSION'],
  'a new resource-version declaration must be detectable',
);

console.log('architecture-boundary-contract: ok');
