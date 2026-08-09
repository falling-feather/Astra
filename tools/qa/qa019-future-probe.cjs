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
  const representatives = futureEntries.filter((entry) => entry.representative);
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
      representative_activity_keys: representatives.map((entry) => entry.activity_key),
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

function syntheticBackendPass() {
  return {
    status: 'PASS',
    transport_retry: { first_status: 503, accepted_status: 201, duplicate_status: 200, row_count: 1 },
    sqlite: {
      learner_event_types: {
        predicted: 1,
        attempted: 3,
        corrected: 1,
        explained: 1,
      },
      learner_completed_count: 0,
      rule_completed_count: 1,
      projection_status: 'completed',
      foreign_key_violations: [],
    },
    teacher_readback: {
      exact_class_course: true,
      total: 6,
      aggregate_completed: 1,
    },
    data_environment: {
      repository_external: true,
      initially_empty_evidence: true,
      demo_initializer_called: false,
      cleanup: 'verified-removed',
    },
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
  if (backend.status !== 'PASS') failures.push('backend_probe');
  if (backend.transport_retry?.first_status !== 503
      || backend.transport_retry?.accepted_status !== 201
      || backend.transport_retry?.duplicate_status !== 200
      || backend.transport_retry?.row_count !== 1) failures.push('backend_retry_idempotency');
  if (backend.sqlite?.learner_completed_count !== 0
      || backend.sqlite?.rule_completed_count !== 1
      || backend.sqlite?.projection_status !== 'completed') failures.push('server_completion_owner');
  if (backend.teacher_readback?.exact_class_course !== true
      || backend.teacher_readback?.total !== 6
      || backend.teacher_readback?.aggregate_completed !== 1) failures.push('teacher_scope_readback');
  if (backend.data_environment?.repository_external !== true
      || backend.data_environment?.initially_empty_evidence !== true
      || backend.data_environment?.demo_initializer_called !== false) failures.push('fresh_unseeded_data');
  return failures;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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
  if (process.env.ASTRA_QA019_PYTHON) return process.env.ASTRA_QA019_PYTHON;
  const local = path.join(ROOT, '.venv', 'Scripts', 'python.exe');
  if (fs.existsSync(local)) return local;
  return process.platform === 'win32' ? 'python.exe' : 'python3';
}

function runBackendProbe(frontend, options = {}) {
  const python = findPython(options.python);
  const script = path.join(__dirname, 'qa019_future_backend_probe.py');
  const args = ['-X', 'utf8', script];
  if (options.keepData) args.push('--keep-data');
  const result = childProcess.spawnSync(python, args, {
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
  if (result.error) {
    return { status: 'FAIL', error: result.error.message, python, exit_code: null };
  }
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch (error) {
    return {
      status: 'FAIL',
      error: `backend probe emitted invalid JSON: ${error.message}`,
      python,
      exit_code: result.status,
      stdout_tail: result.stdout.slice(-2000),
      stderr_tail: result.stderr.slice(-2000),
    };
  }
  payload.python = python;
  payload.exit_code = result.status;
  if (result.status !== 0) payload.stderr_tail = result.stderr.slice(-2000);
  return payload;
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
  const backendPass = backend.status === 'PASS';
  return {
    current_representative: check(
      frontend.target.future_activity_count === 18
        && JSON.stringify(frontend.target.representative_activity_keys) === JSON.stringify([ACTIVITY_KEY])
        && frontend.target.activity_key === ACTIVITY_KEY
        && frontend.target.route === '#engineering/load-path' ? 'PASS' : 'FAIL',
      '18 Future activities and engineering.load-path at #engineering/load-path as the sole representative',
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
        && (!backendPass || (
          backend.transport_retry.first_status === 503
          && backend.transport_retry.accepted_status === 201
          && backend.transport_retry.duplicate_status === 200
          && backend.transport_retry.row_count === 1
        )) ? (backendPass ? 'PASS' : backend.status) : 'FAIL',
      'first failure reuses the same ID; accepted replay is idempotent in SQLite',
      { frontend: frontend.retry, backend: backend.transport_retry || null },
      backendPass ? 'actual FastAPI endpoint plus one-shot ASGI transport fixture' : backend,
    ),
    server_completion_owner: check(
      backendPass
        && backend.sqlite.learner_completed_count === 0
        && backend.sqlite.rule_completed_count === 1
        && backend.sqlite.projection_status === 'completed' ? 'PASS' : backend.status,
      'learner emits no completed; rule producer creates exactly one completed projection',
      backendPass ? backend.sqlite : backend,
      backendPass ? backend.sqlite.rule_witness : null,
    ),
    teacher_exact_scope_readback: check(
      backendPass
        && backend.teacher_readback.exact_class_course === true
        && backend.teacher_readback.total === 6
        && backend.teacher_readback.aggregate_completed === 1 ? 'PASS' : backend.status,
      'teacher class+course readback agrees with the SQLite scope and completed projection',
      backendPass ? backend.teacher_readback : backend,
      backendPass ? backend.scope : null,
    ),
    fresh_unseeded_sqlite: check(
      backendPass
        && backend.data_environment.repository_external === true
        && backend.data_environment.initially_empty_evidence === true
        && backend.data_environment.demo_initializer_called === false
        && backend.sqlite.foreign_key_violations.length === 0 ? 'PASS' : backend.status,
      'fresh repository-external SQLite, no demo initializer and no FK violations',
      backendPass ? backend.data_environment : backend,
      backendPass ? { revision: backend.sqlite.alembic_revision, cleanup: backend.data_environment.cleanup } : null,
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

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
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
    const rendered = options.format === 'summary'
      ? `QA-019 mutation self-test ${payload.status}: ${payload.mutation_count} controlled mutations rejected.`
      : `${JSON.stringify(payload, null, 2)}\n`;
    writeOwnedOutput(options.output, `${JSON.stringify(payload, null, 2)}\n`);
    writeOwnedOutput(options.summaryOutput, `QA-019 mutation self-test ${payload.status}: ${payload.mutation_count} controlled mutations rejected.\n`);
    process.stdout.write(rendered.endsWith('\n') ? rendered : `${rendered}\n`);
    return payload.status === 'PASS' ? 0 : 1;
  }

  const backend = options.mode === 'probe'
    ? runBackendProbe(frontend, options)
    : { status: 'SKIP', reason: 'frontend-only mode explicitly selected' };
  const selfTest = runMutationSelfTest(frontend, backend.status === 'PASS' ? backend : syntheticBackendPass());
  const browser = {
    status: 'NOT-RUN',
    reason: 'No new stable QA-019 external Edge journey was produced; V8.0.4 manual evidence is historical context only and is not inherited as this probe result.',
  };
  const report = buildReport(frontend, backend, selfTest, browser);
  const jsonText = `${JSON.stringify(report, null, 2)}\n`;
  const summaryText = `${report.human_summary}\n`;
  writeOwnedOutput(options.output, jsonText);
  writeOwnedOutput(options.summaryOutput, summaryText);
  process.stdout.write(options.format === 'summary' ? summaryText : jsonText);
  return report.exit_code_contract[report.overall_status];
}

module.exports = {
  ACTIVITY_KEY,
  REPORT_SCHEMA,
  buildReport,
  invariantFailures,
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
