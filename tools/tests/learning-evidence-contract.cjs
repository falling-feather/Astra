const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const root = path.resolve(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const clientSource = read('shared/js/learning-evidence-client.js');
const queueSource = read('shared/js/learning-evidence-queue.js');
const loaderSource = read('shared/js/learning-evidence-loader.js');
const activitySource = read('shared/js/learning-evidence-activity.js');
const catalogSource = read('shared/js/learning-activity-catalog.js');
const roleHomeSource = read('shared/js/role-home-client.js');
const teacherOwnerSource = read('shared/js/teacher-learning-evidence.js');
const moduleSelectorSource = read('shared/js/module-selector.js');
const physicsSource = read('pages/physics/physics.js');
const challengeSource = read('codevis/pages/course-challenge/course-challenge.js');
const studentSource = read('pages/student/student-workbench.js');
const teacherSource = read('pages/teacher/teacher.js');
const appSessionSource = read('shared/js/app-session.js');
const planetsSource = read('pages/planets/planets.js');

function receipt(payload, outcome = 'accepted', overrides = {}) {
  return Object.assign({
    event_id: 101,
    client_event_id: payload.client_event_id,
    event_type: payload.event_type,
    outcome,
    received_at: '2026-07-28T08:00:00Z',
  }, overrides);
}

function command(overrides = {}) {
  return Object.assign({
    client_event_id: 'event-0001',
    class_id: 3,
    course_id: 4,
    course_unit_id: 5,
    activity_key: 'physics.mechanics',
    rule_version: 2,
    event_type: 'attempted',
    evidence: {
      operation: 'simulation_launch',
      reported_correct: false,
      cursor: { stage: 'after-observation' },
    },
    occurred_at: '2026-07-28T08:00:00+08:00',
  }, overrides);
}

function createClientHarness(handler, initialRecords = []) {
  const calls = [];
  const events = [];
  const records = initialRecords.slice();
  const queueListeners = new Set();
  const queue = {
    async configureIdentity() {},
    async clearAuthority() {
      records.length = 0;
      queueListeners.forEach((listener) => listener({ type: 'authority-cleared', source: 'queue' }));
    },
    subscribe(listener) {
      queueListeners.add(listener);
      return () => queueListeners.delete(listener);
    },
    async enqueue(payload) {
      const existing = records.find((item) => item.client_event_id === payload.client_event_id);
      if (existing) return existing;
      const record = {
        client_event_id: payload.client_event_id,
        payload,
        state: 'local-pending',
        attempts: 0,
        next_attempt_at: 0,
      };
      records.push(record);
      return record;
    },
    async updateState(clientEventId, state) {
      const record = records.find((item) => item.client_event_id === clientEventId);
      if (!record) throw new Error('missing queued record');
      record.state = state;
      if (state === 'syncing') record.attempts += 1;
      return record;
    },
    async remove(clientEventId) {
      const index = records.findIndex((item) => item.client_event_id === clientEventId);
      if (index >= 0) records.splice(index, 1);
    },
    async list(options = {}) {
      return records.filter((item) => !options.states || options.states.includes(item.state));
    },
    async stats() {
      return { count: records.length, bytes: 0, oldest_at: null };
    },
    async acquireLease() { return true; },
    async renewLease() { return true; },
    async releaseLease() {},
  };
  const context = {
    console,
    TextEncoder,
    AbortController,
    crypto: webcrypto,
    AstraLearningEvidenceQueue: queue,
    AstraApiClient: {
      isOffline: () => false,
      async request(pathname, options) {
        calls.push({ pathname, options });
        return handler({ pathname, options, calls, records });
      },
    },
    addEventListener() {},
    removeEventListener() {},
    setTimeout() { return 1; },
    clearTimeout() {},
    setInterval() { return 1; },
    clearInterval() {},
    window: null,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(clientSource, context, { filename: 'learning-evidence-client.js' });
  context.AstraLearningEvidenceClient.subscribe((event) => events.push(event));
  return { context, client: context.AstraLearningEvidenceClient, calls, records, events };
}

async function testClientDtoAndReceipts() {
  const harness = createClientHarness(({ options }) => receipt(options.body));
  await harness.client.configureIdentity({ id: 17, role: 'student' });

  const mutableEvidence = {
    operation: 'simulation_launch',
    reported_correct: false,
    cursor: { stage: 'after-observation' },
  };
  const pending = harness.client.record(command({
    activity_key: ' Physics.Mechanics ',
    evidence: mutableEvidence,
  }));
  mutableEvidence.operation = 'tampered-after-record';
  mutableEvidence.cursor.stage = 'tampered-after-record';
  const result = await pending;
  assert.equal(result.outcome, 'confirmed');
  assert.equal(harness.calls[0].options.body.activity_key, 'physics.mechanics');
  assert.equal(harness.calls[0].options.body.evidence.operation, 'simulation_launch');
  assert.equal(harness.calls[0].options.body.evidence.cursor.stage, 'after-observation');

  assert.throws(
    () => harness.client.normalizeEvent(command({ event_type: 'completed' })),
    (error) => error.code === 'server_projection_only',
  );
  assert.throws(
    () => harness.client.normalizeEvent(command({ class_id: '3' })),
    (error) => error.code === 'invalid_scope',
  );
  assert.throws(
    () => harness.client.normalizeEvent(command({ client_event_id: 'short' })),
    (error) => error.code === 'invalid_client_event_id',
  );
  assert.throws(
    () => harness.client.normalizeEvent(command({
      evidence: { operation: 'browser_precheck', score: 100 },
    })),
    (error) => error.code === 'invalid_evidence',
  );
  assert.throws(
    () => harness.client.normalizeEvent(command({
      evidence: { operation: 'browser_precheck', cursor: { blob: 'x'.repeat(17 * 1024) } },
    })),
    (error) => error.code === 'evidence_too_large',
  );
  harness.client.suspendAuthority();
  await assert.rejects(
    harness.client.record(command({ client_event_id: 'event-suspended-0001' })),
    (error) => error && error.code === 'identity_required',
    'a suspended client must reject new evidence before any physical clear outcome',
  );
  assert.equal((await harness.client.flush()).outcome, 'skipped');

  let attempt = 0;
  const ambiguous = createClientHarness(({ options }) => {
    attempt += 1;
    return attempt === 1
      ? receipt(options.body, 'accepted', { client_event_id: 'different-event' })
      : receipt(options.body, 'duplicate');
  });
  await ambiguous.client.configureIdentity({ id: 17, role: 'student' });
  const reconciled = await ambiguous.client.record(command({ client_event_id: 'event-0002' }));
  assert.equal(reconciled.outcome, 'reconciled');
  assert.equal(ambiguous.calls.length, 2);
  assert.equal(ambiguous.calls[0].options.body.client_event_id, 'event-0002');
  assert.equal(ambiguous.calls[1].options.body.client_event_id, 'event-0002');
}

async function testBatchFailClosedAndRecoverySubject() {
  const payloads = [
    command({ client_event_id: 'queued-0001' }),
    command({
      client_event_id: 'queued-0002',
      activity_key: 'control-flow.loop-boundary',
      evidence: { operation: 'browser_precheck', reported_correct: true },
    }),
  ];
  const initial = payloads.map((payload) => ({
    client_event_id: payload.client_event_id,
    payload,
    state: 'local-pending',
    attempts: 0,
    next_attempt_at: 0,
  }));
  const harness = createClientHarness(({ pathname, options }) => {
    if (pathname.endsWith('/events/batch')) return { results: [] };
    return receipt(options.body, 'duplicate');
  }, initial);
  await harness.client.configureIdentity({ id: 17, role: 'student' });
  await harness.client.flush();
  assert.equal(harness.calls.filter((call) => call.pathname.endsWith('/events/batch')).length, 1);
  const replayIds = harness.calls
    .filter((call) => call.pathname.endsWith('/events'))
    .map((call) => call.options.body.client_event_id)
    .sort();
  assert.deepEqual(replayIds, ['queued-0001', 'queued-0002']);
  assert.equal(harness.records.length, 0);

  const mismatch = createClientHarness(({ pathname }) => {
    if (!pathname.endsWith('/me/recovery')) throw new Error('unexpected endpoint');
    return {
      subject_user_id: 99,
      class_id: 3,
      course_id: 4,
      rule_version: 2,
      resume: null,
      activities: [],
    };
  });
  await mismatch.client.configureIdentity({ id: 17, role: 'student' });
  await assert.rejects(
    mismatch.client.recovery({ class_id: 3, course_id: 4 }),
    (error) => error.code === 'recovery_schema_invalid',
  );
}

function testCatalog() {
  const experimentEntries = Array.from({ length: 88 }, (_, index) => (
    index === 0
      ? { subject: 'physics', id: 'mechanics' }
      : { subject: `subject-${Math.floor(index / 10)}`, id: `activity-${index}` }
  ));
  const context = {
    AstraExperimentRegistry: { entries: () => experimentEntries },
    window: null,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(catalogSource, context, { filename: 'learning-activity-catalog.js' });
  const catalog = context.AstraLearningActivityCatalog;
  const verification = catalog.verify();
  assert.equal(verification.englab.valid, true);
  assert.equal(verification['code-space'].valid, true);
  assert.equal(verification['future-galaxy'].valid, true);
  assert.deepEqual(Object.keys(catalog.representatives).sort(), ['code-space', 'englab', 'future-galaxy']);
  assert.equal(catalog.resolve('future-galaxy', 'engineering.load-path').representative, true);
  assert.equal(catalog.entries('future-galaxy').length, 18);
  assert.equal(new Set(catalog.futureKeys).size, 18);

  const englab = catalog.resolve('englab', 'physics.mechanics');
  assert.equal(
    catalog.recoveryHref(englab, {
      activity_key: 'physics.mechanics',
      content_slug: 'physics/mechanics',
    }),
    '#physics/mechanics',
  );
  const code = catalog.resolve('code-space', 'control-flow.loop-boundary');
  assert.equal(
    catalog.recoveryHref(code, { activity_key: 'control-flow.loop-boundary' }),
    'codevis/#challenge?activity=control-flow.loop-boundary',
  );
  assert.equal(
    catalog.recoveryHref(englab, {
      activity_key: 'physics.mechanics',
      content_slug: 'physics/not-mechanics',
    }),
    '',
  );
}

function testStaticOwnershipAndSemantics() {
  assert.match(queueSource, /const MAX_AGE_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(queueSource, /const MAX_EVENTS = 256/);
  assert.match(queueSource, /const MAX_BYTES = 1024 \* 1024/);
  assert.match(queueSource, /const MAX_EVIDENCE_BYTES = 16 \* 1024/);
  assert.match(queueSource, /maxBatch: 50/);
  assert.match(queueSource, /function measuredRecordBytes/);
  const queueClearStart = queueSource.indexOf('async function clearAuthority()');
  const queueClearEnd = queueSource.indexOf('function subscribe', queueClearStart);
  const queueClearBody = queueSource.slice(queueClearStart, queueClearEnd);
  assert.ok(queueClearBody.indexOf('await clearStoredAuthorityData()') < queueClearBody.indexOf("emit({ type: 'authority-cleared'"));
  assert.doesNotMatch(queueClearBody, /finally/);
  assert.doesNotMatch(queueSource, /load_magnitude_adjustment|member_configuration_change|after-load-path-observation|after-model-observation/);
  assert.match(queueSource, /'future-galaxy'/);

  assert.doesNotMatch(loaderSource, /future-galaxy|FutureGalaxy|bridge-truss/);
  assert.match(activitySource, /FutureGalaxyPublicationContext/);
  assert.doesNotMatch(activitySource, /bridge-truss|run-fixed-load-case/, 'the shared panel must not own Future domain facts');
  assert.match(clientSource, /const API_ROOT = '\/api\/learning-evidence'/);
  for (const [name, source] of [
    ['role-home', roleHomeSource],
    ['student-owner', read('shared/js/student-learning-evidence.js')],
    ['teacher-owner', teacherOwnerSource],
    ['physics', physicsSource],
    ['challenge', challengeSource],
  ]) {
    assert.doesNotMatch(source, /\/api\/learning-evidence/, `${name} must not bypass the shared client`);
  }

  const openStart = moduleSelectorSource.indexOf('openModule(page, moduleId, options = {})');
  const closeStart = moduleSelectorSource.indexOf('closeModule(page, options');
  assert.ok(openStart >= 0 && closeStart > openStart, 'openModule ownership boundary must remain discoverable');
  const openBody = moduleSelectorSource.slice(openStart, closeStart);
  assert.ok(openBody.indexOf('_releaseModuleRuntime') < openBody.indexOf('_releaseEvidenceRuntime'));
  const publicationGateStart = moduleSelectorSource.indexOf('_openPublicationGuardedModule(page, moduleId, pageEl, sections)');
  const publicationGateEnd = moduleSelectorSource.indexOf('_isCurrentPublicationGate(page, moduleId, generation)', publicationGateStart);
  assert.ok(
    publicationGateStart >= 0 && publicationGateEnd > publicationGateStart,
    'publication-gated ownership boundary must remain discoverable'
  );
  const publicationGateBody = moduleSelectorSource.slice(publicationGateStart, publicationGateEnd);
  assert.ok(
    publicationGateBody.indexOf('_releaseModuleRuntime') < publicationGateBody.indexOf('_releaseEvidenceRuntime'),
    'publication recheck must release the experiment owner before evidence'
  );
  const leaveStart = moduleSelectorSource.indexOf('leavePage(page, options');
  const closeBody = moduleSelectorSource.slice(closeStart, leaveStart);
  assert.ok(closeBody.indexOf('_releaseModuleRuntime') < closeBody.indexOf('_releaseEvidenceRuntime'));
  assert.match(moduleSelectorSource.slice(leaveStart), /skipEvidenceCleanup: true/);
  assert.doesNotMatch(moduleSelectorSource, /LearningProgress\.markVisited/);

  assert.match(physicsSource, /_recordCourseEvidence\('prediction', 'predicted'/);
  assert.match(physicsSource, /_recordCourseEvidence\([\s\S]*`attempt-\$\{key\}`,[\s\S]*'attempted'/);
  assert.match(physicsSource, /_recordCourseEvidence\('correction', 'corrected'/);
  assert.match(physicsSource, /authorizeCourseRecord\(eventType, evidence\)/);
  assert.doesNotMatch(physicsSource, /astra:learning-domain-command/);
  assert.doesNotMatch(physicsSource, /event_type:\s*'completed'/);
  assert.match(challengeSource, /typeof previousSource === 'string' && previousSource !== sourceCode/);
  assert.match(challengeSource, /reported_correct: Boolean\(localPass\)/);
  assert.doesNotMatch(challengeSource, /evidence:\s*\{[^}]*sourceCode/s);

  const recoveryStart = roleHomeSource.indexOf('function recoveryTask');
  const recoveryEnd = roleHomeSource.indexOf('function primaryOpenUnit');
  const recoveryBody = roleHomeSource.slice(recoveryStart, recoveryEnd);
  assert.match(recoveryBody, /catalog\.recoveryHref/);
  assert.match(recoveryBody, /item\.rule_version === resume\.rule_version/);
  assert.doesNotMatch(recoveryBody, /href:\s*'#student'/);
  assert.match(roleHomeSource, /recovery_route_unavailable/);

  assert.doesNotMatch(studentSource, /points\.reduce/);
  assert.match(studentSource, /state\.data\.progress && state\.data\.progress\.total_points/);
  assert.equal((teacherSource.match(/<article[^>]*data-teacher-natural-workflow/g) || []).length, 1);
  assert.match(teacherSource, /AstraTeacherLearningEvidence\.mount/);
  assert.match(teacherOwnerSource, /概况只作班级趋势参考；学生完成状态以本页学生进度和服务端投影为准/);

  const signedOutStart = appSessionSource.indexOf('async function handleSignedOut');
  const signedOutBody = appSessionSource.slice(signedOutStart, appSessionSource.indexOf('function bootstrap', signedOutStart));
  assert.ok(signedOutBody.indexOf('clearLearningAuthority') < signedOutBody.indexOf('reloadAfterRoleResourceCleanup'));
  assert.match(appSessionSource, /consumeLearningEvidenceFreshProof/);
  assert.match(appSessionSource, /learning-evidence-loader\.js/);
  assert.match(planetsSource, /roleHomeGeneration/);

  const changedRuntime = [
    clientSource,
    queueSource,
    loaderSource,
    activitySource,
    catalogSource,
    roleHomeSource,
    moduleSelectorSource,
    physicsSource,
    challengeSource,
    studentSource,
    teacherSource,
    appSessionSource,
    planetsSource,
  ].join('\n');
  assert.doesNotMatch(changedRuntime, /V7\.6\.6|20260727v766LearningEvidenceP0/);
  assert.doesNotMatch(changedRuntime, /event_type:\s*['"](?:completed|transferred)['"]/);
}

(async () => {
  await testClientDtoAndReceipts();
  await testBatchFailClosedAndRecoverySubject();
  testCatalog();
  testStaticOwnershipAndSemantics();
  process.stdout.write('learning-evidence-contract: core, authority, DTO, recovery, routes, and representative events ok\n');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
