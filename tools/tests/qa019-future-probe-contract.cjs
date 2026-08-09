'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const probePath = path.join(root, 'tools', 'qa', 'qa019-future-probe.cjs');
const backendPath = path.join(root, 'tools', 'qa', 'qa019_future_backend_probe.py');
const probe = require(probePath);

async function run() {
  assert.equal(fs.existsSync(backendPath), true, 'QA-019 FastAPI/SQLite companion probe is missing');

  const frontend = await probe.runFrontendProbe();
  assert.equal(frontend.runtime.execution, 'node-vm-current-product-source');
  assert.equal(frontend.runtime.flow_source, 'pages/engineering/bridge-truss.js');
  assert.equal(frontend.runtime.manifest_source, 'pages/frontier/frontier-manifest.js');
  assert.equal(frontend.runtime.authority_source, 'shared/js/frontier-publication-context.js');
  assert.deepEqual(frontend.target.representative_activity_keys, ['engineering.load-path']);
  assert.equal(frontend.target.future_activity_count, 18);
  assert.equal(frontend.target.route, '#engineering/load-path');

  assert.deepEqual(frontend.no_action.captured_events, []);
  assert.equal(frontend.no_action.sensitive_event_count, frontend.no_action.captured_events.length);
  assert.equal(
    frontend.no_action.client_completed_count,
    frontend.no_action.captured_events.filter((event) => event.event_type === 'completed').length,
  );
  assert.deepEqual(frontend.flow.event_types, [
    'predicted', 'attempted', 'attempted', 'attempted', 'corrected', 'explained',
  ]);
  assert.deepEqual(frontend.flow.observation_order, ['B', 'C', 'D']);
  assert.equal(frontend.flow.initial_judgement_id, 'single-load-path');
  assert.equal(frontend.flow.final_snapshot.stage, 'waiting-server');
  assert.equal(frontend.flow.client_completed_count, 0);
  assert.equal(frontend.refresh.declaration, 'safe-fallback');
  assert.equal(frontend.refresh.exact_recovery_claimed, false);

  assert.equal(frontend.authority_comparator.baseline_accepted, true);
  assert.equal(
    frontend.authority_comparator.changed_leaves.every((item) => item.accepted === false),
    true,
    'the current product comparator must reject every authority leaf mutation',
  );
  assert.equal(frontend.fail_closed.every((item) => item.result === false && item.record_calls === 0), true);
  assert.equal(frontend.fail_closed.find((item) => item.name === 'manual_intervention').blocked, true);
  assert.deepEqual(frontend.retry.results, [false, true]);
  assert.equal(frontend.retry.same_client_event_id, true);

  const callbackMutation = frontend.mutation_fixtures.comparator_fail_open_callback;
  assert.equal(callbackMutation.level, 'product-callback');
  assert.equal(callbackMutation.result, true, 'the controlled fail-open callback must really bypass the product flow gate');
  assert.equal(callbackMutation.record_calls, 1);
  assert.equal(callbackMutation.final_stage, 'predicted');

  const backend = probe.syntheticBackendPass();
  assert.equal(probe.evaluateBackendSuccess(backend).ok, true);
  assert.equal(
    probe.evaluateBackendSuccess(probe.syntheticBackendPass({ keepData: true })).ok,
    true,
    'explicit --keep-data mode must accept retained-by-explicit-flag',
  );
  assert.deepEqual(probe.invariantFailures(frontend, backend), []);
  const selfTest = probe.runMutationSelfTest(frontend, backend);
  assert.equal(selfTest.status, 'PASS');
  assert.equal(selfTest.baseline_status, 'PASS');
  assert.equal(selfTest.mutation_count, 38);
  assert.equal(selfTest.mutations.every((item) => item.status === 'PASS'), true);
  assert.equal(
    selfTest.mutations.find((item) => item.name === 'product_callback_comparator_fail_open').mutation_level,
    'product-callback',
  );
  for (const leaf of ['predicted', 'attempted_b', 'attempted_c', 'attempted_d', 'corrected', 'explained']) {
    assert.equal(selfTest.mutations.find((item) => item.name === `remove_sequence_${leaf}`).status, 'PASS');
  }
  assert.equal(selfTest.mutations.find((item) => item.name === 'remove_server_completion_owner').status, 'PASS');

  const backendMutationNames = [
    'child_exit_1_and_refused_cleanup',
    'refused_cleanup_in_default_mode',
    'witness_wrong_producer',
    'witness_wrong_event_type',
    'witness_mismatched_source_set',
    'witness_duplicate_receipt_ids',
    'database_revision_not_current_head',
    'teacher_wrong_subject',
    'teacher_wrong_event_ids',
    'teacher_wrong_item_subject',
    'teacher_wrong_event_multiset',
    'teacher_wrong_producer',
    'teacher_wrong_activity',
    'teacher_wrong_total',
    'teacher_wrong_projection',
    'teacher_wrong_completed_aggregate',
    'teacher_wrong_active_students',
    'transport_row_after_failure',
    'transport_accepted_outcome',
    'transport_duplicate_outcome',
    'transport_client_identity',
    'transport_receipt_identity',
  ];
  for (const name of backendMutationNames) {
    assert.equal(selfTest.mutations.find((item) => item.name === name).status, 'PASS', `${name} must be rejected`);
  }

  const browser = { status: 'NOT-RUN', reason: 'contract does not impersonate a browser journey' };
  const report = probe.buildReport(frontend, backend, selfTest, browser);
  assert.equal(report.overall_status, 'PASS', 'optional Browser NOT-RUN must remain distinct from core PASS');
  assert.equal(report.checks.browser_journey.required, false);
  assert.equal(report.checks.browser_journey.status, 'NOT-RUN');
  assert.equal(report.summary.verdict, report.overall_status);
  assert.equal(report.human_summary, report.summary.text);
  assert.match(report.human_summary, /^QA-019 PASS: PASS=10, FAIL=0, SKIP=0, NOT-RUN=1; Browser=NOT-RUN\.$/);
  assert.deepEqual(report.exit_code_contract, { PASS: 0, FAIL: 1, SKIP: 2, 'NOT-RUN': 2 });

  for (const mutation of probe.backendMutationCases(backend)) {
    const evaluation = probe.evaluateBackendSuccess(mutation.value);
    assert.equal(evaluation.ok, false, `${mutation.name} unexpectedly passed the unified backend evaluator`);
    const rejected = probe.buildReport(frontend, mutation.value, selfTest, browser);
    assert.equal(rejected.overall_status, 'FAIL', `${mutation.name} did not fail the overall report`);
    assert.equal(rejected.exit_code_contract[rejected.overall_status], 1);
    for (const name of [
      'first_failure_same_id',
      'server_completion_owner',
      'teacher_exact_scope_readback',
      'fresh_unseeded_sqlite',
    ]) {
      assert.equal(rejected.checks[name].status, 'FAIL', `${mutation.name} left ${name} green`);
    }
  }

  const falsePass = probe.syntheticBackendPass();
  falsePass.data_environment.cleanup = 'refused-unsafe-target';
  const falsePassResult = {
    status: 1,
    stdout: JSON.stringify(falsePass),
    stderr: 'controlled child exit 1',
    error: null,
  };
  const normalizedFalsePass = probe.normalizeBackendProcessResult(falsePassResult, {
    python: 'controlled-python',
    keepData: false,
  });
  assert.equal(normalizedFalsePass.reported_status, 'PASS');
  assert.equal(normalizedFalsePass.status, 'FAIL');
  assert.equal(normalizedFalsePass.exit_code, 1);
  assert.equal(normalizedFalsePass.backend_success.ok, false);

  const controlledCli = await probe.executeProbe({
    mode: 'probe',
    format: 'json',
    python: 'controlled-python',
    keepData: false,
    spawnSync: () => falsePassResult,
  });
  assert.equal(controlledCli.payload.backend.reported_status, 'PASS');
  assert.equal(controlledCli.payload.backend.status, 'FAIL');
  assert.equal(controlledCli.payload.overall_status, 'FAIL');
  assert.equal(controlledCli.exitCode, 1, 'the actual CLI orchestration path must return exit 1');

  const childScript = `
    const probe = require(${JSON.stringify(probePath)});
    const falsePass = probe.syntheticBackendPass();
    falsePass.data_environment.cleanup = 'refused-unsafe-target';
    const child = { status: 1, stdout: JSON.stringify(falsePass), stderr: 'controlled', error: null };
    probe.executeProbe({ mode: 'probe', format: 'json', python: 'controlled-python', keepData: false, spawnSync: () => child })
      .then((execution) => { process.exitCode = execution.exitCode; })
      .catch(() => { process.exitCode = 99; });
  `;
  const falsePassCli = childProcess.spawnSync(process.execPath, ['-e', childScript], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(falsePassCli.status, 1, falsePassCli.stderr || falsePassCli.stdout);

  const skipped = probe.buildReport(
    frontend,
    { status: 'SKIP', reason: 'contract status semantics' },
    selfTest,
    browser,
  );
  assert.equal(skipped.overall_status, 'SKIP');
  assert.equal(skipped.exit_code_contract[skipped.overall_status], 2);

  const cli = childProcess.spawnSync(process.execPath, [
    probePath, '--mode', 'self-test', '--format', 'json',
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr || cli.stdout);
  const cliReport = JSON.parse(cli.stdout);
  assert.equal(cliReport.status, 'PASS');
  assert.equal(cliReport.mutation_count, selfTest.mutation_count);

  console.log('qa019-future-probe-contract: ok');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
