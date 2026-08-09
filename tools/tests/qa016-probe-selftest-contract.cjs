const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const probe = require('../qa/qa016-critical-journeys.cjs');

const ROOT = path.resolve(__dirname, '../..');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function observationsWithTeacher(teacher, defectObserved) {
  return Object.fromEntries(probe.ISSUE_IDS.map((issueId) => [issueId, issueId === 'TEACH-01'
    ? teacher
    : {
      defect_observed: defectObserved,
      actual: `controlled ${issueId} observation`,
      request_response: { controlled: true },
      database_or_state_evidence: { controlled: true },
    }]));
}

function withTeacherSemantic(observation, evaluationSemantic) {
  const observationFacts = {
    ...clone(observation.observation_facts),
    evaluation_semantic: evaluationSemantic,
  };
  const observationEvaluation = probe.evaluateTeacherObservationFacts(observationFacts);
  return {
    ...observation,
    defect_observed: observationEvaluation.defect_observed,
    actual: probe.describeTeacherObservation(observationFacts),
    observation_facts: observationFacts,
    observation_evaluation: observationEvaluation,
  };
}

function assertRejectedMutation(report, mutate, expectedFailure) {
  const mutant = clone(report);
  mutate(mutant);
  const validation = probe.validateReportConsistency(mutant);
  assert.equal(validation.status, 'FAIL');
  assert.ok(validation.failures.includes(expectedFailure), JSON.stringify(validation.failures));
  assert.equal(probe.exitCodeForReport(mutant), 3);
}

async function main() {
  assert.deepEqual(probe.ISSUE_IDS, [
    'FUTURE-01',
    'FUTURE-02',
    'TEACH-01',
    'CODE-01',
    'MECH-01',
    'DEMO-01',
  ]);
  assert.equal(new Set(probe.ISSUE_IDS).size, 6);

  const result = probe.selfTest();
  assert.equal(result.status, 'PASS');
  assert.ok(result.checks.length >= 5);

  for (const issueId of probe.ISSUE_IDS) {
    const contract = probe.ISSUE_CONTRACTS[issueId];
    assert.ok(contract.owner);
    assert.ok(contract.preconditions.length > 0);
    assert.ok(contract.steps.length > 0);
    assert.ok(contract.expected);
    assert.match(contract.command, /qa016-critical-journeys\.cjs/);
  }

  const current = await probe.probeTeacher();
  const missingCourse = await probe.probeTeacher({ missingCourseParam: true });
  const mixedRows = await probe.probeTeacher({ acceptMixedPending: true });
  const restoredOldDefect = await probe.probeTeacher({
    missingCourseParam: true,
    acceptMixedPending: true,
  });

  assert.equal(current.defect_observed, false);
  assert.match(current.actual, /class_id=11 与 course_id=101/);
  assert.match(current.actual, /未观察到 foreign-course row/);
  assert.match(current.actual, /混课响应被整页拒绝/);
  assert.match(current.actual, /零行进入状态且 DOM 未渲染 submission row/);
  assert.doesNotMatch(current.actual, /均处于 Physics/);
  assert.doesNotMatch(current.actual, /只携带 class_id，返回并渲染/);
  assert.deepEqual(current.observation_facts.accepted_state_course_ids, []);
  assert.equal(current.observation_facts.foreign_course_row_rendered, false);
  assert.equal(current.observation_evaluation.selected_semantic, 'historical_combination');
  assert.equal(current.observation_evaluation.historical_issue_defect_observed, false);
  assert.equal(current.observation_evaluation.controlled_positive_defect_observed, false);

  assert.equal(missingCourse.defect_observed, true);
  assert.match(missingCourse.actual, /缺少 course_id/);
  assert.doesNotMatch(missingCourse.actual, /返回行混入|DOM 渲染/);
  assert.equal(missingCourse.observation_facts.request_course_id, null);
  assert.equal(missingCourse.observation_evaluation.selected_semantic, 'controlled_positive');
  assert.equal(missingCourse.observation_evaluation.controlled_positive_defect_observed, true);
  assert.equal(missingCourse.observation_evaluation.historical_issue_defect_observed, false);
  assert.equal(withTeacherSemantic(missingCourse, 'historical_combination').defect_observed, false);

  assert.equal(mixedRows.defect_observed, true);
  assert.match(mixedRows.actual, /返回行混入 foreign course_id=202/);
  assert.match(mixedRows.actual, /DOM 渲染了 foreign-course row/);
  assert.equal(mixedRows.observation_facts.request_course_id, '101');
  assert.deepEqual(mixedRows.observation_facts.accepted_state_course_ids, [101, 202]);
  assert.equal(mixedRows.observation_evaluation.selected_semantic, 'controlled_positive');
  assert.equal(mixedRows.observation_evaluation.controlled_positive_defect_observed, true);
  assert.equal(mixedRows.observation_evaluation.historical_issue_defect_observed, false);
  assert.equal(withTeacherSemantic(mixedRows, 'historical_combination').defect_observed, false);

  assert.equal(restoredOldDefect.defect_observed, true);
  assert.match(restoredOldDefect.actual, /缺少 course_id/);
  assert.match(restoredOldDefect.actual, /返回行混入 foreign course_id=202/);
  assert.match(restoredOldDefect.actual, /DOM 渲染了 foreign-course row/);
  assert.equal(restoredOldDefect.observation_evaluation.controlled_positive_defect_observed, true);
  assert.equal(restoredOldDefect.observation_evaluation.historical_issue_defect_observed, true);

  const historicalOldDefect = withTeacherSemantic(restoredOldDefect, 'historical_combination');
  assert.equal(historicalOldDefect.defect_observed, true);
  assert.equal(historicalOldDefect.observation_evaluation.selected_semantic, 'historical_combination');

  const baselineReport = probe.buildReport(
    'controlled-revision',
    observationsWithTeacher(historicalOldDefect, true),
    { controlled: true },
    'baseline',
  );
  assert.equal(baselineReport.overall.baseline_assertion, 'PASS');
  assert.equal(baselineReport.overall.desired_gate, 'FAIL');
  assert.equal(baselineReport.execution.status, 'PASS');
  assert.equal(probe.exitCodeForReport(baselineReport), 0);
  for (const issueId of probe.ISSUE_IDS) {
    assert.equal(baselineReport.issues[issueId].baseline_assertion, 'PASS');
  }

  const gateReport = probe.buildReport(
    'controlled-revision',
    observationsWithTeacher(current, false),
    { controlled: true },
    'gate',
  );
  assert.equal(gateReport.overall.baseline_assertion, 'FAIL');
  assert.equal(gateReport.overall.desired_gate, 'PASS');
  assert.equal(gateReport.execution.status, 'PASS');
  assert.equal(probe.exitCodeForReport(gateReport), 0);

  const failingGateReport = probe.buildReport(
    'controlled-revision',
    observationsWithTeacher(historicalOldDefect, true),
    { controlled: true },
    'gate',
  );
  assert.equal(failingGateReport.execution.status, 'FAIL');
  assert.equal(probe.exitCodeForReport(failingGateReport), 1);

  assertRejectedMutation(gateReport, (mutant) => {
    mutant.issues['TEACH-01'].defect_observed = true;
  }, 'teach_defect_not_derived_from_observation_facts');
  assertRejectedMutation(gateReport, (mutant) => {
    mutant.issues['TEACH-01'].actual = 'tampered historical failure sentence';
  }, 'teach_actual_not_derived_from_observation_facts');
  assertRejectedMutation(gateReport, (mutant) => {
    mutant.summary.desired_gate_passed = false;
  }, 'summary_not_derived_from_issue_facts');
  assertRejectedMutation(gateReport, (mutant) => {
    mutant.execution.exit_code = 1;
  }, 'exit_semantics_not_derived_from_selected_gate');
  assertRejectedMutation(gateReport, (mutant) => {
    mutant.human_summary = 'tampered terminal summary';
  }, 'human_summary_not_derived_from_report');

  const cli = spawnSync(process.execPath, [
    'tools/qa/qa016-critical-journeys.cjs',
    '--mode',
    'frontend',
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(cli.status, 2, cli.stderr || cli.stdout);
  const cliReport = JSON.parse(cli.stdout);
  assert.equal(probe.validateReportConsistency(cliReport).status, 'PASS');
  assert.equal(cliReport.issues['TEACH-01'].defect_observed, false);
  assert.equal(cliReport.execution.exit_code, cli.status);
  assert.equal(cli.stderr.trim(), cliReport.human_summary);

  console.log('QA-016 probe self-test contract: current TEACH facts, controlled old defects, and report/summary/exit tamper gates ok');
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
