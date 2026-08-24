#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const TASK = 'QA-019';
const VERSION = 'V8.0.7';
const ACTIVITY_KEY = 'engineering.load-path';
const REPORT_SCHEMA = 'astra.qa019.future-current.v1';
const STATUSES = new Set(['PASS', 'FAIL', 'SKIP', 'NOT-RUN']);
const AUTHORITY_KEYS = Object.freeze([
  'class_id',
  'course_id',
  'course_unit_id',
  'activity_key',
  'identity_id',
  'authority_generation',
  'access_state',
]);

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function execute(source, context, filename) {
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename });
  return context;
}

function loadCurrentProduct() {
  const catalogContext = execute(read('shared/js/learning-activity-catalog.js'), {
    console,
    AstraExperimentRegistry: { entries: () => [] },
  }, 'shared/js/learning-activity-catalog.js');
  const manifestContext = execute(read('pages/frontier/frontier-manifest.js'), {
    console,
  }, 'pages/frontier/frontier-manifest.js');

  const original = read('pages/engineering/bridge-truss.js');
  const marker = 'window.BridgeTruss = BridgeTruss;';
  const instrumented = original.replace(
    marker,
    [
      'window.__qa019CreateLoadPathFlow = createLoadPathFlow;',
      'window.__qa019RecoverLoadPathPrefix = recoverLoadPathPrefix;',
      'window.__qa019NormalizeObservation = normalizeLoadPathObservation;',
      marker,
    ].join('\n'),
  );
  assert.notEqual(instrumented, original, 'QA-019 bridge instrumentation marker drifted');
  const bridgeContext = execute(instrumented, {
    console,
    document: { getElementById: () => null, querySelectorAll: () => [] },
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: (callback) => setTimeout(callback, 0),
    cancelAnimationFrame: clearTimeout,
    devicePixelRatio: 1,
    crypto: crypto.webcrypto,
  }, 'pages/engineering/bridge-truss.js');
  const publicationContext = execute(read('shared/js/frontier-publication-context.js'), {
    console,
    location: { origin: 'https://qa019.invalid', hash: '#engineering/load-path' },
    addEventListener() {},
    removeEventListener() {},
    AbortController,
    URL,
  }, 'shared/js/frontier-publication-context.js');
  const sameAuthority = publicationContext.FutureGalaxyPublicationContext
    .sameLearningEvidenceAuthority;
  assert.equal(typeof sameAuthority, 'function', 'current product authority comparator is unavailable');
  return { catalogContext, manifestContext, bridgeContext, sameAuthority };
}

function prediction() {
  return {
    reaction_balance_id: 'more-balanced',
    gh_change_id: 'absolute-increase',
    cd_change_id: 'absolute-increase',
    reason_size: 24,
  };
}

function deriveSolverRows(bridgeContext) {
  const rows = {};
  for (const node of ['B', 'C', 'D']) {
    bridgeContext.BridgeTruss.state.load = 60;
    bridgeContext.BridgeTruss.state.loadJoint = node;
    bridgeContext.BridgeTruss.state.memberMode = 'full';
    rows[node] = plain(
      bridgeContext.__qa019NormalizeObservation(
        node,
        bridgeContext.BridgeTruss.solve(),
      ),
    );
  }
  return rows;
}

function createFlow(bridgeContext, options = {}) {
  const authority = options.authority;
  assert.equal(typeof options.sameAuthority, 'function', 'QA-019 requires the current product authority comparator');
  return bridgeContext.__qa019CreateLoadPathFlow({
    controller: options.controller,
    pendingRecords: options.pendingRecords || [],
    authorizeRecord: options.authorizeRecord,
    resolveAuthority: options.resolveAuthority || (async () => authority),
    sameAuthority: options.sameAuthority,
    isActive: options.isActive || (() => true),
    observe: options.observe,
    onChange: options.onChange,
  });
}

async function runFailClosedMatrix(bridgeContext, authority, rows, sameAuthority) {
  const cases = [
    ['unauthenticated', { available: false, error_code: 'not_authenticated' }, () => true],
    ['identity_mismatch', { ...authority, identity_id: 'student-elsewhere' }, () => true],
    ['class_scope_invalid', { ...authority, class_id: 7008 }, () => true],
    ['course_scope_invalid', { ...authority, course_id: 9103 }, () => true],
    ['unit_scope_invalid', { ...authority, course_unit_id: 9204 }, () => true],
    ['generation_invalid', { ...authority, authority_generation: 12 }, () => true],
    ['route_inactive', authority, () => false],
  ];
  const results = [];
  for (const [name, resolved, isActive] of cases) {
    let recordCalls = 0;
    const flow = createFlow(bridgeContext, {
      authority,
      sameAuthority,
      controller: {
        context: () => authority,
        async record() {
          recordCalls += 1;
          return { outcome: 'confirmed', state: 'confirmed' };
        },
      },
      resolveAuthority: async () => resolved,
      isActive,
      observe: (node) => rows[node],
    });
    const result = await flow.predict(prediction());
    results.push({ name, result, record_calls: recordCalls, blocked: flow.snapshot().blocked });
    flow.destroy();
  }

  let manualRecordCalls = 0;
  const manualFlow = createFlow(bridgeContext, {
    authority,
    sameAuthority,
    controller: {
      context: () => authority,
      async record() {
        manualRecordCalls += 1;
        return { outcome: 'confirmed', state: 'confirmed' };
      },
    },
    authorizeRecord: async () => {
      throw Object.assign(new Error('manual intervention'), {
        code: 'pending_recovery_manual_intervention',
      });
    },
    observe: (node) => rows[node],
  });
  const manualResult = await manualFlow.predict(prediction());
  results.push({
    name: 'manual_intervention',
    result: manualResult,
    record_calls: manualRecordCalls,
    blocked: manualFlow.snapshot().blocked,
  });
  manualFlow.destroy();
  return results;
}

async function runFrontendProbe() {
  const {
    catalogContext, manifestContext, bridgeContext, sameAuthority,
  } = loadCurrentProduct();
  const futureEntries = plain(catalogContext.AstraLearningActivityCatalog.entries('future-galaxy'));
  const showcase = catalogContext.AstraShowcaseActivitySelection;
  const showcaseActivities = futureEntries.filter((entry) => showcase.matches(entry));
  const manifestCourse = manifestContext.FrontierCourseManifest.getCourse('engineering-systems');
  const manifestActivity = manifestContext.FrontierCourseManifest
    .getActivity('engineering-systems', ACTIVITY_KEY);
  const rows = deriveSolverRows(bridgeContext);
  const authority = {
    available: true,
    class_id: 7001,
    course_id: 9102,
    course_unit_id: 9203,
    activity_key: ACTIVITY_KEY,
    identity_id: 'student-qa019',
    authority_generation: 11,
    access_state: 'open',
  };

  const preActionEvents = [];
  const preActionFlow = createFlow(bridgeContext, {
    authority,
    sameAuthority,
    controller: {
      context: () => authority,
      async record(eventType, evidence, settings) {
        preActionEvents.push(plain({
          event_type: eventType,
          evidence,
          client_event_id: settings.client_event_id,
        }));
        return { outcome: 'confirmed', state: 'confirmed' };
      },
    },
    observe: (node) => rows[node],
  });
  const initialSnapshot = plain(preActionFlow.snapshot());
  const outOfOrderBeforePrediction = await preActionFlow.observe('B');
  const explanationBeforePrediction = await preActionFlow.explain();
  const afterNoActionSnapshot = plain(preActionFlow.snapshot());
  preActionFlow.destroy();

  const events = [];
  const stages = [];
  const flow = createFlow(bridgeContext, {
    authority,
    sameAuthority,
    controller: {
      context: () => authority,
      async record(eventType, evidence, settings) {
        events.push(plain({
          event_type: eventType,
          evidence,
          client_event_id: settings.client_event_id,
        }));
        return { outcome: 'confirmed', state: 'confirmed' };
      },
    },
    observe: (node) => rows[node],
    onChange: (state) => stages.push(state.stage),
  });
  const transitionResults = {
    prediction: await flow.predict(prediction()),
    skip_b: await flow.observe('C'),
    observe_b: await flow.observe('B'),
    assess_before_c: await flow.assess('single-load-path'),
    observe_c: await flow.observe('C'),
    wrong_judgement: await flow.assess('single-load-path'),
    correct_before_d: await flow.correct(true),
    observe_d: await flow.observe('D'),
    correction: await flow.correct(true),
    explanation: await flow.explain(),
  };
  const finalSnapshot = plain(flow.snapshot());
  flow.destroy();

  const retryCalls = [];
  let retryAttempt = 0;
  const retryFlow = createFlow(bridgeContext, {
    authority,
    sameAuthority,
    controller: {
      context: () => authority,
      async record(eventType, evidence, settings) {
        retryAttempt += 1;
        retryCalls.push(plain({
          attempt: retryAttempt,
          event_type: eventType,
          evidence,
          client_event_id: settings.client_event_id,
        }));
        if (retryAttempt === 1) {
          throw Object.assign(new Error('controlled first transport failure'), {
            code: 'network_error',
          });
        }
        return { outcome: 'confirmed', state: 'confirmed' };
      },
    },
    observe: (node) => rows[node],
  });
  const retryResults = [
    await retryFlow.predict(prediction()),
    await retryFlow.predict(prediction()),
  ];
  retryFlow.destroy();

  const failClosed = await runFailClosedMatrix(bridgeContext, authority, rows, sameAuthority);
  const comparatorLeaves = AUTHORITY_KEYS.map((key) => {
    const changed = {
      ...authority,
      [key]: key === 'access_state' ? 'locked' : `${authority[key]}-changed`,
    };
    return { key, accepted: sameAuthority(authority, changed) };
  });
  comparatorLeaves.push(
    { key: 'expected_unavailable', accepted: sameAuthority({ ...authority, available: false }, authority) },
    { key: 'current_unavailable', accepted: sameAuthority(authority, { ...authority, available: false }) },
  );

  let bypassRecordCalls = 0;
  const bypassEvents = [];
  const bypassFlow = createFlow(bridgeContext, {
    authority,
    sameAuthority: () => true,
    controller: {
      context: () => authority,
      async record(eventType, evidence, settings) {
        bypassRecordCalls += 1;
        bypassEvents.push(plain({ event_type: eventType, evidence, client_event_id: settings.client_event_id }));
        return { outcome: 'confirmed', state: 'confirmed' };
      },
    },
    resolveAuthority: async () => ({ ...authority, class_id: 7008 }),
    observe: (node) => rows[node],
  });
  const bypassResult = await bypassFlow.predict(prediction());
  const bypassStage = bypassFlow.snapshot().stage;
  bypassFlow.destroy();
  const recovered = plain(bridgeContext.__qa019RecoverLoadPathPrefix([], authority));

  return {
    status: 'PASS',
    runtime: {
      catalog_source: 'shared/js/learning-activity-catalog.js',
      manifest_source: 'pages/frontier/frontier-manifest.js',
      flow_source: 'pages/engineering/bridge-truss.js',
      authority_source: 'shared/js/frontier-publication-context.js',
      execution: 'node-vm-current-product-source',
    },
    target: {
      galaxy_key: 'future-galaxy',
      course_key: 'engineering-systems',
      activity_key: ACTIVITY_KEY,
      future_activity_count: futureEntries.length,
      showcase_activity_keys: showcaseActivities.map((entry) => entry.activity_key),
      route: manifestCourse && manifestActivity
        ? `#${manifestCourse.page}/${manifestActivity.route_slug}`
        : null,
    },
    no_action: {
      initial_snapshot: initialSnapshot,
      after_negative_actions: afterNoActionSnapshot,
      captured_events: preActionEvents,
      sensitive_event_count: preActionEvents.length,
      client_completed_count: preActionEvents.filter((event) => event.event_type === 'completed').length,
      out_of_order_result: outOfOrderBeforePrediction,
      early_explanation_result: explanationBeforePrediction,
    },
    solver_rows: rows,
    flow: {
      transitions: transitionResults,
      stages,
      final_snapshot: finalSnapshot,
      events,
      event_types: events.map((event) => event.event_type),
      observation_order: events
        .filter((event) => event.event_type === 'attempted')
        .map((event) => event.evidence.cursor.load_node_id),
      client_completed_count: events.filter((event) => event.event_type === 'completed').length,
      initial_judgement_id: events.find((event) => event.event_type === 'corrected')
        ?.evidence?.correction?.initial_judgement_id || null,
    },
    retry: {
      fixture: 'controller throws network_error before durable receipt on first call',
      results: retryResults,
      calls: retryCalls,
      same_client_event_id: retryCalls.length === 2
        && retryCalls[0].client_event_id === retryCalls[1].client_event_id,
    },
    fail_closed: failClosed,
    authority_comparator: {
      implementation: 'FutureGalaxyPublicationContext.sameLearningEvidenceAuthority',
      baseline_accepted: sameAuthority(authority, { ...authority }),
      changed_leaves: comparatorLeaves,
    },
    mutation_fixtures: {
      comparator_fail_open_callback: {
        level: 'product-callback',
        description: 'actual createLoadPathFlow with sameAuthority replaced by an always-true callback',
        invalid_leaf: 'class_id',
        result: bypassResult,
        record_calls: bypassRecordCalls,
        captured_events: bypassEvents,
        final_stage: bypassStage,
      },
    },
    refresh: {
      input: 'no local-pending prefix remains after confirmed writes',
      recovered_stage: recovered.stage,
      declaration: 'safe-fallback',
      exact_recovery_claimed: false,
      architecture_owner: 'ARCH-004',
    },
  };
}

function syntheticBackendPass(options = {}) {
  const keepDataRequested = options.keepData === true;
  return {
    status: 'PASS',
    exit_code: 0,
    keep_data_requested: keepDataRequested,
    scope: {
      class_id: 1,
      course_id: 1,
      course_unit_id: 1,
      activity_key: ACTIVITY_KEY,
      rule_version: 1,
      subject_user_id: 2,
    },
    transport_retry: {
      first_status: 503,
      row_count_after_failure: 0,
      accepted_status: 201,
      duplicate_status: 200,
      accepted_outcome: 'accepted',
      duplicate_outcome: 'duplicate',
      same_client_event_id: true,
      same_event_id: true,
      row_count: 1,
    },
    sqlite: {
      alembic_revision: 'synthetic-current-head',
      expected_alembic_head: 'synthetic-current-head',
      learner_event_types: {
        predicted: 1,
        attempted: 3,
        corrected: 1,
        explained: 1,
      },
      learner_completed_count: 0,
      rule_completed_count: 1,
      projection_status: 'completed',
      rule_witness: {
        producer_type: 'rule',
        event_type: 'completed',
        source_event_ids: [1, 2, 3, 4, 5, 6],
        learner_receipt_event_ids: [1, 2, 3, 4, 5, 6],
      },
      foreign_key_violations: [],
    },
    teacher_readback: {
      exact_class_course: true,
      subject_user_id: 2,
      total: 6,
      event_ids: [6, 5, 4, 3, 2, 1],
      item_subject_user_ids: [2, 2, 2, 2, 2, 2],
      event_types: ['explained', 'corrected', 'attempted', 'attempted', 'attempted', 'predicted'],
      producer_types: ['learner', 'learner', 'learner', 'learner', 'learner', 'learner'],
      activity_keys: [ACTIVITY_KEY, ACTIVITY_KEY, ACTIVITY_KEY, ACTIVITY_KEY, ACTIVITY_KEY, ACTIVITY_KEY],
      aggregate_completed: 1,
      aggregate_active_students: 1,
      projection_status: 'completed',
    },
    data_environment: {
      repository_external: true,
      initially_empty_evidence: true,
      demo_initializer_called: false,
      cleanup: keepDataRequested ? 'retained-by-explicit-flag' : 'verified-removed',
    },
  };
}

function sameIntegerSet(left, right, expectedSize) {
  if (!Array.isArray(left) || !Array.isArray(right)
      || left.length !== expectedSize || right.length !== expectedSize
      || left.some((value) => !Number.isInteger(value) || value <= 0)
      || right.some((value) => !Number.isInteger(value) || value <= 0)) return false;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === expectedSize
    && rightSet.size === expectedSize
    && [...leftSet].every((value) => rightSet.has(value));
}

function exactEventCounts(value) {
  const expected = { attempted: 3, corrected: 1, explained: 1, predicted: 1 };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const normalized = Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
  return JSON.stringify(normalized) === JSON.stringify(expected);
}

function eventTypeCounts(values) {
  if (!Array.isArray(values)) return null;
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function evaluateBackendSuccess(backend) {
  const failures = [];
  const fail = (group, code, expected, actual) => {
    failures.push({ group, code, expected, actual });
  };
  if (!backend || typeof backend !== 'object') {
    fail('process', 'backend_result_missing', 'object', backend);
    return { ok: false, status: 'FAIL', expected_cleanup: 'verified-removed', failures };
  }
  if (backend.status !== 'PASS') fail('process', 'reported_status', 'PASS', backend.status);
  if (backend.exit_code !== 0) fail('process', 'child_exit_code', 0, backend.exit_code);
  if (typeof backend.keep_data_requested !== 'boolean') {
    fail('process', 'keep_data_mode_missing', 'boolean', backend.keep_data_requested);
  }
  const expectedCleanup = backend.keep_data_requested === true
    ? 'retained-by-explicit-flag'
    : 'verified-removed';
  if (backend.data_environment?.cleanup !== expectedCleanup) {
    fail('cleanup', 'cleanup_status', expectedCleanup, backend.data_environment?.cleanup);
  }

  const transport = backend.transport_retry || {};
  const transportExpected = {
    first_status: 503,
    row_count_after_failure: 0,
    accepted_status: 201,
    duplicate_status: 200,
    accepted_outcome: 'accepted',
    duplicate_outcome: 'duplicate',
    same_client_event_id: true,
    same_event_id: true,
    row_count: 1,
  };
  for (const [key, expected] of Object.entries(transportExpected)) {
    if (transport[key] !== expected) fail('transport', `transport_${key}`, expected, transport[key]);
  }

  const scope = backend.scope || {};
  for (const key of ['class_id', 'course_id', 'course_unit_id', 'rule_version', 'subject_user_id']) {
    if (!Number.isInteger(scope[key]) || scope[key] <= 0) fail('ledger', `scope_${key}`, 'positive integer', scope[key]);
  }
  if (scope.activity_key !== ACTIVITY_KEY) fail('ledger', 'scope_activity_key', ACTIVITY_KEY, scope.activity_key);

  const sqlite = backend.sqlite || {};
  if (typeof sqlite.expected_alembic_head !== 'string' || !sqlite.expected_alembic_head) {
    fail('ledger', 'expected_alembic_head', 'non-empty current script head', sqlite.expected_alembic_head);
  }
  if (sqlite.alembic_revision !== sqlite.expected_alembic_head) {
    fail('ledger', 'database_revision_not_current_head', sqlite.expected_alembic_head, sqlite.alembic_revision);
  }
  if (!exactEventCounts(sqlite.learner_event_types)) {
    fail('ledger', 'learner_event_multiset', { predicted: 1, attempted: 3, corrected: 1, explained: 1 }, sqlite.learner_event_types);
  }
  if (sqlite.learner_completed_count !== 0) fail('ledger', 'learner_completed_count', 0, sqlite.learner_completed_count);
  if (sqlite.rule_completed_count !== 1) fail('owner', 'rule_completed_count', 1, sqlite.rule_completed_count);
  if (sqlite.projection_status !== 'completed') fail('owner', 'projection_status', 'completed', sqlite.projection_status);
  if (!Array.isArray(sqlite.foreign_key_violations) || sqlite.foreign_key_violations.length !== 0) {
    fail('ledger', 'foreign_key_violations', [], sqlite.foreign_key_violations);
  }
  const witness = sqlite.rule_witness || {};
  if (witness.producer_type !== 'rule') fail('owner', 'witness_producer_type', 'rule', witness.producer_type);
  if (witness.event_type !== 'completed') fail('owner', 'witness_event_type', 'completed', witness.event_type);
  if (!sameIntegerSet(witness.source_event_ids, witness.learner_receipt_event_ids, 6)) {
    fail('owner', 'witness_receipt_exact_set', 'same six unique positive integer IDs', {
      source_event_ids: witness.source_event_ids,
      learner_receipt_event_ids: witness.learner_receipt_event_ids,
    });
  }

  const teacher = backend.teacher_readback || {};
  if (teacher.exact_class_course !== true) fail('teacher', 'exact_class_course', true, teacher.exact_class_course);
  if (teacher.subject_user_id !== scope.subject_user_id) {
    fail('teacher', 'subject_user_id', scope.subject_user_id, teacher.subject_user_id);
  }
  if (!exactEventCounts(eventTypeCounts(teacher.event_types))) {
    fail('teacher', 'event_type_multiset', { predicted: 1, attempted: 3, corrected: 1, explained: 1 }, teacher.event_types);
  }
  if (!sameIntegerSet(teacher.event_ids, witness.learner_receipt_event_ids, 6)) {
    fail('teacher', 'event_ids_match_learner_receipts', 'same six unique positive integer IDs', {
      event_ids: teacher.event_ids,
      learner_receipt_event_ids: witness.learner_receipt_event_ids,
    });
  }
  if (!Array.isArray(teacher.item_subject_user_ids)
      || teacher.item_subject_user_ids.length !== 6
      || teacher.item_subject_user_ids.some((value) => value !== scope.subject_user_id)) {
    fail('teacher', 'item_subject_user_ids', `six occurrences of ${scope.subject_user_id}`, teacher.item_subject_user_ids);
  }
  if (!Array.isArray(teacher.producer_types)
      || teacher.producer_types.length !== 6
      || teacher.producer_types.some((value) => value !== 'learner')) {
    fail('teacher', 'producer_types', 'six learner values', teacher.producer_types);
  }
  if (!Array.isArray(teacher.activity_keys)
      || teacher.activity_keys.length !== 6
      || teacher.activity_keys.some((value) => value !== ACTIVITY_KEY)) {
    fail('teacher', 'activity_keys', `six ${ACTIVITY_KEY} values`, teacher.activity_keys);
  }
  if (teacher.total !== 6) fail('teacher', 'total', 6, teacher.total);
  if (teacher.projection_status !== 'completed') fail('teacher', 'projection_status', 'completed', teacher.projection_status);
  if (teacher.aggregate_completed !== 1) fail('teacher', 'aggregate_completed', 1, teacher.aggregate_completed);
  if (teacher.aggregate_active_students !== 1) fail('teacher', 'aggregate_active_students', 1, teacher.aggregate_active_students);

  const data = backend.data_environment || {};
  if (data.repository_external !== true) fail('data', 'repository_external', true, data.repository_external);
  if (data.initially_empty_evidence !== true) fail('data', 'initially_empty_evidence', true, data.initially_empty_evidence);
  if (data.demo_initializer_called !== false) fail('data', 'demo_initializer_called', false, data.demo_initializer_called);
  return {
    ok: failures.length === 0,
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    expected_cleanup: expectedCleanup,
    failures,
  };
}

function invariantFailures(frontend, backend) {
  const failures = [];
  const eventTypes = frontend.flow.event_types;
  const expectedTypes = ['predicted', 'attempted', 'attempted', 'attempted', 'corrected', 'explained'];
  if (JSON.stringify(eventTypes) !== JSON.stringify(expectedTypes)) failures.push('ordered_event_types');
  if (JSON.stringify(frontend.flow.observation_order) !== JSON.stringify(['B', 'C', 'D'])) failures.push('ordered_observations');
  if (frontend.flow.initial_judgement_id !== 'single-load-path') failures.push('wrong_judgement_correction');
  if (frontend.flow.final_snapshot.stage !== 'waiting-server') failures.push('waiting_server_stage');
  if (frontend.flow.client_completed_count !== 0) failures.push('client_completed_forbidden');
  if (frontend.no_action.sensitive_event_count !== 0) failures.push('preaction_sensitive_fact');
  for (const item of frontend.fail_closed) {
    if (item.result !== false || item.record_calls !== 0) failures.push(`fail_closed:${item.name}`);
    if (item.name === 'manual_intervention' && item.blocked !== true) failures.push('manual_not_blocked');
  }
  if (frontend.authority_comparator.baseline_accepted !== true
      || frontend.authority_comparator.changed_leaves.some((item) => item.accepted !== false)) {
    failures.push('product_authority_comparator');
  }
  if (frontend.refresh.declaration !== 'safe-fallback'
      || frontend.refresh.recovered_stage !== 'prediction'
      || frontend.refresh.exact_recovery_claimed !== false) failures.push('refresh_semantics');
  if (frontend.retry.same_client_event_id !== true
      || JSON.stringify(frontend.retry.results) !== JSON.stringify([false, true])) failures.push('frontend_retry_identity');
  for (const failure of evaluateBackendSuccess(backend).failures) {
    failures.push(`backend:${failure.group}:${failure.code}`);
  }
  return failures;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function backendMutationCases(backend) {
  const definitions = [
    ['child_exit_1_and_refused_cleanup', (value) => {
      value.exit_code = 1;
      value.data_environment.cleanup = 'refused-unsafe-target';
    }],
    ['refused_cleanup_in_default_mode', (value) => { value.data_environment.cleanup = 'refused-unsafe-target'; }],
    ['witness_wrong_producer', (value) => { value.sqlite.rule_witness.producer_type = 'learner'; }],
    ['witness_wrong_event_type', (value) => { value.sqlite.rule_witness.event_type = 'explained'; }],
    ['witness_mismatched_source_set', (value) => { value.sqlite.rule_witness.source_event_ids = [11, 12, 13, 14, 15, 16]; }],
    ['witness_duplicate_receipt_ids', (value) => { value.sqlite.rule_witness.learner_receipt_event_ids = [1, 2, 3, 4, 5, 5]; }],
    ['database_revision_not_current_head', (value) => { value.sqlite.alembic_revision = 'stale-revision'; }],
    ['teacher_wrong_subject', (value) => { value.teacher_readback.subject_user_id += 100; }],
    ['teacher_wrong_event_ids', (value) => { value.teacher_readback.event_ids = [101, 102, 103, 104, 105, 106]; }],
    ['teacher_wrong_item_subject', (value) => { value.teacher_readback.item_subject_user_ids[0] += 100; }],
    ['teacher_wrong_event_multiset', (value) => { value.teacher_readback.event_types[0] = 'attempted'; }],
    ['teacher_wrong_producer', (value) => { value.teacher_readback.producer_types[0] = 'trusted_assessment'; }],
    ['teacher_wrong_activity', (value) => { value.teacher_readback.activity_keys[0] = 'engineering.member-choice'; }],
    ['teacher_wrong_total', (value) => { value.teacher_readback.total = 5; }],
    ['teacher_wrong_projection', (value) => { value.teacher_readback.projection_status = 'in_progress'; }],
    ['teacher_wrong_completed_aggregate', (value) => { value.teacher_readback.aggregate_completed = 0; }],
    ['teacher_wrong_active_students', (value) => { value.teacher_readback.aggregate_active_students = 2; }],
    ['transport_row_after_failure', (value) => { value.transport_retry.row_count_after_failure = 1; }],
    ['transport_accepted_outcome', (value) => { value.transport_retry.accepted_outcome = 'duplicate'; }],
    ['transport_duplicate_outcome', (value) => { value.transport_retry.duplicate_outcome = 'accepted'; }],
    ['transport_client_identity', (value) => { value.transport_retry.same_client_event_id = false; }],
    ['transport_receipt_identity', (value) => { value.transport_retry.same_event_id = false; }],
  ];
  return definitions.map(([name, mutate]) => {
    const value = clone(backend);
    mutate(value);
    return { name, value };
  });
}

function runMutationSelfTest(frontend, backend = syntheticBackendPass()) {
  const baselineFailures = invariantFailures(frontend, backend);
  const mutations = [];
  const sequenceLeaves = [
    ['predicted', (event) => event.event_type === 'predicted'],
    ['attempted_b', (event) => event.event_type === 'attempted' && event.evidence.cursor.load_node_id === 'B'],
    ['attempted_c', (event) => event.event_type === 'attempted' && event.evidence.cursor.load_node_id === 'C'],
    ['attempted_d', (event) => event.event_type === 'attempted' && event.evidence.cursor.load_node_id === 'D'],
    ['corrected', (event) => event.event_type === 'corrected'],
    ['explained', (event) => event.event_type === 'explained'],
  ];
  for (const [name, predicate] of sequenceLeaves) {
    const mutated = clone(frontend);
    const index = mutated.flow.events.findIndex(predicate);
    mutated.flow.events.splice(index, 1);
    mutated.flow.event_types = mutated.flow.events.map((event) => event.event_type);
    mutated.flow.observation_order = mutated.flow.events
      .filter((event) => event.event_type === 'attempted')
      .map((event) => event.evidence.cursor.load_node_id);
    const failures = invariantFailures(mutated, backend);
    mutations.push({
      name: `remove_sequence_${name}`,
      mutation_level: 'structured-report',
      status: failures.length ? 'PASS' : 'FAIL',
      observed_failures: failures,
    });
  }
  for (let index = 0; index < frontend.fail_closed.length; index += 1) {
    const mutated = clone(frontend);
    const name = mutated.fail_closed[index].name;
    mutated.fail_closed[index].result = true;
    mutated.fail_closed[index].record_calls = 1;
    const failures = invariantFailures(mutated, backend);
    mutations.push({
      name: `scope_fail_open_${name}`,
      mutation_level: 'structured-report',
      status: failures.length ? 'PASS' : 'FAIL',
      observed_failures: failures,
    });
  }
  const callbackMutated = clone(frontend);
  const callbackFixture = frontend.mutation_fixtures.comparator_fail_open_callback;
  const callbackCase = callbackMutated.fail_closed.find((item) => item.name === 'class_scope_invalid');
  callbackCase.result = callbackFixture.result;
  callbackCase.record_calls = callbackFixture.record_calls;
  const callbackFailures = invariantFailures(callbackMutated, backend);
  mutations.push({
    name: 'product_callback_comparator_fail_open',
    mutation_level: callbackFixture.level,
    status: callbackFailures.includes('fail_closed:class_scope_invalid') ? 'PASS' : 'FAIL',
    actual_product_flow: {
      result: callbackFixture.result,
      record_calls: callbackFixture.record_calls,
      final_stage: callbackFixture.final_stage,
    },
    observed_failures: callbackFailures,
  });
  const withoutOwner = clone(backend);
  withoutOwner.sqlite.rule_completed_count = 0;
  withoutOwner.sqlite.projection_status = 'in_progress';
  withoutOwner.teacher_readback.aggregate_completed = 0;
  const ownerFailures = invariantFailures(frontend, withoutOwner);
  mutations.push({
    name: 'remove_server_completion_owner',
    mutation_level: 'structured-backend-result',
    status: ownerFailures.length ? 'PASS' : 'FAIL',
    observed_failures: ownerFailures,
  });
  for (const item of backendMutationCases(backend)) {
    const evaluation = evaluateBackendSuccess(item.value);
    const observedFailures = invariantFailures(frontend, item.value);
    mutations.push({
      name: item.name,
      mutation_level: 'structured-backend-result',
      status: evaluation.ok === false && observedFailures.some((failure) => failure.startsWith('backend:'))
        ? 'PASS'
        : 'FAIL',
      backend_failures: evaluation.failures,
      observed_failures: observedFailures,
    });
  }

  const status = baselineFailures.length === 0 && mutations.every((item) => item.status === 'PASS')
    ? 'PASS'
    : 'FAIL';
  return {
    status,
    baseline_status: baselineFailures.length ? 'FAIL' : 'PASS',
    baseline_failures: baselineFailures,
    mutation_count: mutations.length,
    mutations,
  };
}

function findPython(explicit) {
  if (explicit) return explicit;
  const configured = process.env.ASTRA_QA019_PYTHON;
  if (configured) return configured;
  const local = path.join(ROOT, '.venv', 'Scripts', 'python.exe');
  if (fs.existsSync(local)) return local;
  return process.platform === 'win32' ? 'python.exe' : 'python3';
}

function normalizeBackendProcessResult(result, metadata = {}) {
  const python = metadata.python || 'unknown';
  const keepDataRequested = metadata.keepData === true;
  if (result.error) {
    return {
      status: 'FAIL',
      error: result.error.message,
      python,
      exit_code: null,
      keep_data_requested: keepDataRequested,
      backend_success: {
        ok: false,
        status: 'FAIL',
        expected_cleanup: keepDataRequested ? 'retained-by-explicit-flag' : 'verified-removed',
        failures: [{ group: 'process', code: 'spawn_error', expected: 'successful child process', actual: result.error.message }],
      },
    };
  }
  let payload;
  try {
    payload = JSON.parse(String(result.stdout || ''));
  } catch (error) {
    return {
      status: 'FAIL',
      error: `backend probe emitted invalid JSON: ${error.message}`,
      python,
      exit_code: result.status,
      keep_data_requested: keepDataRequested,
      stdout_tail: String(result.stdout || '').slice(-2000),
      stderr_tail: String(result.stderr || '').slice(-2000),
      backend_success: {
        ok: false,
        status: 'FAIL',
        expected_cleanup: keepDataRequested ? 'retained-by-explicit-flag' : 'verified-removed',
        failures: [{ group: 'process', code: 'invalid_json', expected: 'valid backend JSON', actual: error.message }],
      },
    };
  }
  const reportedStatus = payload.status;
  payload.python = python;
  payload.exit_code = result.status;
  payload.keep_data_requested = keepDataRequested;
  const evaluation = evaluateBackendSuccess(payload);
  payload.backend_success = evaluation;
  if (!evaluation.ok) {
    payload.reported_status = reportedStatus;
    payload.status = 'FAIL';
  }
  if (result.status !== 0) payload.stderr_tail = String(result.stderr || '').slice(-2000);
  return payload;
}

function runBackendProbe(frontend, options = {}) {
  const python = findPython(options.python);
  const script = path.join(__dirname, 'qa019_future_backend_probe.py');
  const args = ['-X', 'utf8', script];
  if (options.keepData) args.push('--keep-data');
  const spawn = options.spawnSync || childProcess.spawnSync;
  const result = spawn(python, args, {
    cwd: ROOT,
    input: JSON.stringify({
      schema: REPORT_SCHEMA,
      task: TASK,
      activity_key: ACTIVITY_KEY,
      frontend_events: frontend.flow.events,
    }),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      PYTHONDONTWRITEBYTECODE: '1',
    },
  });
  return normalizeBackendProcessResult(result, { python, keepData: options.keepData });
}

function check(status, expected, actual, evidence, required = true) {
  assert(STATUSES.has(status), `unsupported QA-019 status ${status}`);
  return { status, required, expected, actual, evidence };
}

function buildChecks(frontend, backend, selfTest, browser) {
  const expectedEvents = ['predicted', 'attempted', 'attempted', 'attempted', 'corrected', 'explained'];
  const failClosedPass = frontend.fail_closed.every((item) => item.result === false && item.record_calls === 0)
    && frontend.fail_closed.find((item) => item.name === 'manual_intervention')?.blocked === true
    && frontend.authority_comparator.baseline_accepted === true
    && frontend.authority_comparator.changed_leaves.every((item) => item.accepted === false);
  const backendEvaluation = evaluateBackendSuccess(backend);
  const backendPass = backendEvaluation.ok;
  const backendGateStatus = backendPass
    ? 'PASS'
    : (['SKIP', 'NOT-RUN'].includes(backend.status) ? backend.status : 'FAIL');
  const backendEvidence = { evaluation: backendEvaluation, result: backend };
  return {
    current_showcase: check(
      frontend.target.future_activity_count === 19
        && JSON.stringify(frontend.target.showcase_activity_keys) === JSON.stringify([ACTIVITY_KEY])
        && frontend.target.activity_key === ACTIVITY_KEY
        && frontend.target.route === '#engineering/load-path' ? 'PASS' : 'FAIL',
      '19 Future activities and engineering.load-path at #engineering/load-path as the dedicated showcase sample',
      frontend.target,
      frontend.runtime,
    ),
    no_action_zero_sensitive_facts: check(
      frontend.no_action.sensitive_event_count === 0
        && frontend.no_action.client_completed_count === 0
        && frontend.no_action.initial_snapshot.stage === 'prediction'
        && frontend.no_action.after_negative_actions.stage === 'prediction' ? 'PASS' : 'FAIL',
      'P0 remains inert: zero evidence writes and zero client completed',
      frontend.no_action,
      'actual createLoadPathFlow instance',
    ),
    ordered_observation_and_correction: check(
      JSON.stringify(frontend.flow.event_types) === JSON.stringify(expectedEvents)
        && JSON.stringify(frontend.flow.observation_order) === JSON.stringify(['B', 'C', 'D'])
        && frontend.flow.initial_judgement_id === 'single-load-path'
        && frontend.flow.final_snapshot.stage === 'waiting-server' ? 'PASS' : 'FAIL',
      'prediction -> B -> C -> wrong judgement -> D -> correction -> explanation -> waiting-server',
      {
        transitions: frontend.flow.transitions,
        event_types: frontend.flow.event_types,
        observation_order: frontend.flow.observation_order,
        initial_judgement_id: frontend.flow.initial_judgement_id,
        final_stage: frontend.flow.final_snapshot.stage,
      },
      { solver_rows: frontend.solver_rows },
    ),
    refresh_semantics: check(
      frontend.refresh.declaration === 'safe-fallback'
        && frontend.refresh.recovered_stage === 'prediction'
        && frontend.refresh.exact_recovery_claimed === false ? 'PASS' : 'FAIL',
      'refresh is declared only as a safe P0 fallback; exact recovery remains ARCH-004',
      frontend.refresh,
      'actual recoverLoadPathPrefix with no remaining pending prefix',
    ),
    authority_fail_closed: check(
      failClosedPass ? 'PASS' : 'FAIL',
      'unauthenticated, identity, class/course/unit, generation, route and manual faults write nothing',
      frontend.fail_closed,
      {
        flow_fixture: 'fresh product-flow instance per negative case',
        comparator: frontend.authority_comparator,
      },
    ),
    first_failure_same_id: check(
      frontend.retry.same_client_event_id === true
        && JSON.stringify(frontend.retry.results) === JSON.stringify([false, true])
        ? backendGateStatus
        : 'FAIL',
      'first failure reuses the same ID; accepted replay is idempotent in SQLite',
      { frontend: frontend.retry, backend: backend.transport_retry || null },
      backendEvidence,
    ),
    server_completion_owner: check(
      backendGateStatus,
      'learner emits no completed; rule producer creates exactly one completed projection',
      backendPass ? backend.sqlite : backend,
      backendEvidence,
    ),
    teacher_exact_scope_readback: check(
      backendGateStatus,
      'teacher class+course readback agrees with the SQLite scope and completed projection',
      backendPass ? backend.teacher_readback : backend,
      backendEvidence,
    ),
    fresh_unseeded_sqlite: check(
      backendGateStatus,
      'fresh repository-external SQLite, no demo initializer and no FK violations',
      backendPass ? backend.data_environment : backend,
      backendEvidence,
    ),
    mutation_self_test: check(
      selfTest.status,
      'each removed sequence leaf, fail-open authority case, or missing server owner is rejected',
      { baseline_status: selfTest.baseline_status, mutation_count: selfTest.mutation_count },
      selfTest.mutations,
    ),
    browser_journey: check(
      browser.status,
      'new QA-019 external-browser journey, if stably automated',
      browser.reason,
      browser.evidence || null,
      false,
    ),
  };
}

function reportSummary(overall, checks) {
  const counts = { PASS: 0, FAIL: 0, SKIP: 0, 'NOT-RUN': 0 };
  Object.values(checks).forEach((item) => { counts[item.status] += 1; });
  const browser = checks.browser_journey.status;
  return {
    verdict: overall,
    counts,
    browser,
    text: `QA-019 ${overall}: PASS=${counts.PASS}, FAIL=${counts.FAIL}, SKIP=${counts.SKIP}, NOT-RUN=${counts['NOT-RUN']}; Browser=${browser}.`,
  };
}

function gitValue(args) {
  const result = childProcess.spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

function buildReport(frontend, backend, selfTest, browser) {
  const checks = buildChecks(frontend, backend, selfTest, browser);
  const required = Object.values(checks).filter((item) => item.required);
  let overall = 'PASS';
  if (required.some((item) => item.status === 'FAIL')) overall = 'FAIL';
  else if (required.some((item) => item.status === 'NOT-RUN')) overall = 'NOT-RUN';
  else if (required.some((item) => item.status === 'SKIP')) overall = 'SKIP';
  const summary = reportSummary(overall, checks);
  return {
    schema: REPORT_SCHEMA,
    task: TASK,
    version: VERSION,
    target: ACTIVITY_KEY,
    revision: gitValue(['rev-parse', 'HEAD']),
    generated_at: new Date().toISOString(),
    overall_status: overall,
    exit_code_contract: { PASS: 0, FAIL: 1, SKIP: 2, 'NOT-RUN': 2 },
    checks,
    summary,
    human_summary: summary.text,
    frontend,
    backend,
    mutation_self_test: selfTest,
    browser,
  };
}

function parseArgs(argv) {
  const options = {
    mode: 'probe',
    format: 'json',
    python: null,
    output: null,
    summaryOutput: null,
    keepData: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--mode') options.mode = argv[++index];
    else if (value === '--format') options.format = argv[++index];
    else if (value === '--python') options.python = argv[++index];
    else if (value === '--output') options.output = argv[++index];
    else if (value === '--summary-output') options.summaryOutput = argv[++index];
    else if (value === '--keep-data') options.keepData = true;
    else throw new Error(`unknown argument: ${value}`);
  }
  if (!['probe', 'frontend', 'self-test'].includes(options.mode)) throw new Error(`unsupported mode: ${options.mode}`);
  if (!['json', 'summary'].includes(options.format)) throw new Error(`unsupported format: ${options.format}`);
  return options;
}

function writeOwnedOutput(filename, contents) {
  if (!filename) return;
  const resolved = path.resolve(filename);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, contents, 'utf8');
}

async function executeProbe(options) {
  const frontend = await runFrontendProbe();
  if (options.mode === 'self-test') {
    const selfTest = runMutationSelfTest(frontend, syntheticBackendPass());
    const payload = {
      schema: 'astra.qa019.mutation-self-test.v1',
      task: TASK,
      status: selfTest.status,
      frontend_runtime: frontend.runtime,
      ...selfTest,
    };
    const summaryText = `QA-019 mutation self-test ${payload.status}: ${payload.mutation_count} controlled mutations rejected.\n`;
    return {
      payload,
      jsonText: `${JSON.stringify(payload, null, 2)}\n`,
      summaryText,
      exitCode: payload.status === 'PASS' ? 0 : 1,
    };
  }

  const backend = options.mode === 'probe'
    ? runBackendProbe(frontend, options)
    : { status: 'SKIP', reason: 'frontend-only mode explicitly selected' };
  const selfTest = runMutationSelfTest(
    frontend,
    evaluateBackendSuccess(backend).ok ? backend : syntheticBackendPass(),
  );
  const browser = {
    status: 'NOT-RUN',
    reason: 'No new stable QA-019 external Edge journey was produced; V8.0.4 manual evidence is historical context only and is not inherited as this probe result.',
  };
  const report = buildReport(frontend, backend, selfTest, browser);
  return {
    payload: report,
    jsonText: `${JSON.stringify(report, null, 2)}\n`,
    summaryText: `${report.human_summary}\n`,
    exitCode: report.exit_code_contract[report.overall_status],
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const execution = await executeProbe(options);
  writeOwnedOutput(options.output, execution.jsonText);
  writeOwnedOutput(options.summaryOutput, execution.summaryText);
  process.stdout.write(options.format === 'summary' ? execution.summaryText : execution.jsonText);
  return execution.exitCode;
}

module.exports = {
  ACTIVITY_KEY,
  REPORT_SCHEMA,
  backendMutationCases,
  buildReport,
  evaluateBackendSuccess,
  executeProbe,
  invariantFailures,
  normalizeBackendProcessResult,
  runBackendProbe,
  runFrontendProbe,
  runMutationSelfTest,
  syntheticBackendPass,
};

if (require.main === module) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
