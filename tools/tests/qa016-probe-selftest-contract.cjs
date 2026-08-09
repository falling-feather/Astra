const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const probe = require('../qa/qa016-critical-journeys.cjs');
const provenance = require('../qa/qa016-provenance-verifier.cjs');

const ROOT = path.resolve(__dirname, '../..');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

function observationsFromReport(report) {
  return Object.fromEntries(probe.ISSUE_IDS.map((issueId) => {
    const issue = report.issues[issueId];
    return [issueId, {
      defect_observed: issue.defect_observed,
      actual: clone(issue.actual),
      request_response: clone(issue.request_response),
      database_or_state_evidence: clone(issue.database_or_state_evidence),
      ...(issue.observation_facts ? { observation_facts: clone(issue.observation_facts) } : {}),
      ...(issue.observation_evaluation ? { observation_evaluation: clone(issue.observation_evaluation) } : {}),
      raw_records: report.provenance.raw_records
        .filter((record) => record.payload.issue_id === issueId)
        .map(clone),
    }];
  }));
}

function findRaw(report, issueId, channel) {
  const record = report.provenance.raw_records.find(
    (candidate) => candidate.payload.issue_id === issueId
      && candidate.payload.channel === channel,
  );
  assert.ok(record, `missing raw fixture ${issueId}:${channel}`);
  return record;
}

function findFact(report, issueId) {
  const candidate = report.provenance.canonical_facts.find(
    (fact) => fact.fact_id === `qa016.${issueId}.observation`,
  );
  assert.ok(candidate, `missing canonical fact ${issueId}`);
  return candidate;
}

function synchronizeDerivedLayers(report, facts) {
  const layers = probe.reportLayersFromCanonicalFacts(report, facts);
  report.issues = clone(layers.issues);
  report.summary = clone(layers.summary);
  report.overall = clone(layers.overall);
  report.execution = clone(layers.execution);
  report.human_summary = layers.human_summary;
}

function childExitForReport(report) {
  const child = spawnSync(process.execPath, ['-e', [
    "const probe=require('./tools/qa/qa016-critical-journeys.cjs');",
    "let input='';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data',(chunk)=>{input+=chunk;});",
    "process.stdin.on('end',()=>{process.exit(probe.exitCodeForReport(JSON.parse(input)));});",
  ].join('')], {
    cwd: ROOT,
    input: JSON.stringify(report),
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (child.error) throw child.error;
  return child.status;
}

function assertRejectedMutation(report, mutate, expectedFailure) {
  const mutant = clone(report);
  mutate(mutant);
  const validation = probe.validateReportConsistency(mutant);
  assert.equal(validation.status, 'FAIL');
  const expectedFailures = Array.isArray(expectedFailure) ? expectedFailure : [expectedFailure];
  assert.ok(
    expectedFailures.some((failure) => validation.failures.includes(failure)),
    JSON.stringify(validation.failures),
  );
  assert.equal(probe.exitCodeForReport(mutant), 3);
  assert.equal(childExitForReport(mutant), 3);
  return mutant;
}

function fakeTeacherFacts(report) {
  const facts = clone(report.provenance.canonical_facts);
  const teacher = facts.find((fact) => fact.fact_id === 'qa016.TEACH-01.observation');
  teacher.value.observation_facts.request_course_id_present = false;
  teacher.value.observation_facts.request_course_id = null;
  teacher.value.observation_facts.accepted_state_course_ids = [101, 202];
  teacher.value.observation_facts.foreign_course_row_rendered = true;
  teacher.value.observation_facts.evaluation_semantic = 'historical_combination';
  teacher.value.observation_evaluation = probe.evaluateTeacherObservationFacts(
    teacher.value.observation_facts,
  );
  teacher.value.defect_observed = teacher.value.observation_evaluation.defect_observed;
  teacher.value.actual = probe.describeTeacherObservation(teacher.value.observation_facts);
  return facts;
}

function assertNoDerivedClaimsInRaw(report) {
  const forbidden = new Set([
    'canonical_facts',
    'defect_observed',
    'actual',
    'summary',
    'overall',
    'execution',
    'human_summary',
  ]);
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbidden.has(key), false, `raw record leaked derived field ${key}`);
      visit(child);
    }
  };
  report.provenance.raw_records.forEach((record) => visit(record.payload));
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
  assert.doesNotMatch(missingCourse.actual, /返回行混入.*DOM 渲染/);
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
  assert.equal(withTeacherSemantic(restoredOldDefect, 'historical_combination').defect_observed, true);

  const currentRun = await probe.run({
    mode: 'frontend',
    python: 'python',
    output: '',
    keepData: false,
  });
  assert.equal(currentRun.exitCode, 2);
  assert.equal(probe.validateReportConsistency(currentRun.report).status, 'PASS');
  assert.equal(currentRun.report.provenance.status, 'PASS');
  assert.equal(currentRun.report.provenance.assurance, 'consistency-only');
  assert.match(currentRun.report.provenance.limitation, /external source-authenticity/);
  assert.equal(currentRun.report.provenance.canonical_facts.length, 6);
  assertNoDerivedClaimsInRaw(currentRun.report);

  const currentObservations = observationsFromReport(currentRun.report);
  const baselineReport = probe.buildReport(
    'controlled-revision',
    currentObservations,
    { controlled: true },
    'baseline',
  );
  const gateReport = probe.buildReport(
    'controlled-revision',
    currentObservations,
    { controlled: true },
    'gate',
  );
  assert.equal(baselineReport.execution.status, 'FAIL');
  assert.equal(probe.exitCodeForReport(baselineReport), 2);
  assert.equal(gateReport.execution.status, 'FAIL');
  assert.equal(probe.exitCodeForReport(gateReport), 1);

  const recomputeInput = {
    schema_version: gateReport.provenance.schema_version,
    envelope_id: gateReport.provenance.envelope_id,
    raw_records: clone(gateReport.provenance.raw_records),
  };
  assert.equal(provenance.QA016_PROVENANCE_VERIFIER.recompute(recomputeInput).length, 6);
  assert.throws(
    () => provenance.QA016_PROVENANCE_VERIFIER.recompute({
      ...recomputeInput,
      canonical_facts: gateReport.provenance.canonical_facts,
    }),
    (error) => error && error.code === 'recompute_input_forbidden_field',
  );

  assertRejectedMutation(gateReport, (mutant) => {
    findFact(mutant, 'TEACH-01').value.defect_observed = true;
  }, 'provenance:canonical_facts_not_recomputed_from_raw');
  assertRejectedMutation(gateReport, (mutant) => {
    delete findRaw(mutant, 'TEACH-01', 'frontend-pending-request').payload.data.params.course_id;
  }, 'provenance:canonical_facts_not_recomputed_from_raw');
  assertRejectedMutation(gateReport, (mutant) => {
    mutant.issues['TEACH-01'].actual = 'single derived layer tampered';
  }, 'teach_actual_not_derived_from_observation_facts');
  assertRejectedMutation(gateReport, (mutant) => {
    synchronizeDerivedLayers(mutant, fakeTeacherFacts(mutant));
  }, 'issue_not_derived_from_canonical_fact:TEACH-01');
  assertRejectedMutation(gateReport, (mutant) => {
    const facts = fakeTeacherFacts(mutant);
    mutant.provenance.canonical_facts = clone(facts);
    synchronizeDerivedLayers(mutant, facts);
  }, 'provenance:canonical_facts_not_recomputed_from_raw');
  assertRejectedMutation(gateReport, (mutant) => {
    findFact(mutant, 'FUTURE-01').source_ids = ['qa016-missing-source'];
  }, 'provenance:canonical_fact_source_missing');
  assertRejectedMutation(gateReport, (mutant) => {
    const fact = findFact(mutant, 'FUTURE-01');
    fact.source_ids.push(fact.source_ids[0]);
  }, 'provenance:canonical_fact_source_duplicate');
  assertRejectedMutation(gateReport, (mutant) => {
    mutant.provenance.raw_records[1].source_id = mutant.provenance.raw_records[0].source_id;
  }, 'provenance:raw_source_id_duplicate');
  assertRejectedMutation(gateReport, (mutant) => {
    mutant.provenance.raw_records[0].captured_at = '2026-08-10T00:00:00Z';
  }, 'provenance:raw_timestamp_not_canonical');
  assertRejectedMutation(gateReport, (mutant) => {
    mutant.provenance.verifier.id = 'untrusted-verifier';
  }, 'provenance:provenance_verifier_identity_invalid');
  assertRejectedMutation(gateReport, (mutant) => {
    mutant.summary.desired_gate_passed = true;
  }, 'summary_not_derived_from_canonical_facts');
  assertRejectedMutation(gateReport, (mutant) => {
    mutant.execution.exit_code = 0;
  }, 'exit_semantics_not_derived_from_selected_gate');
  assertRejectedMutation(gateReport, (mutant) => {
    mutant.human_summary = 'tampered terminal summary';
  }, 'human_summary_not_derived_from_report');

  const coordinated = clone(gateReport);
  delete findRaw(coordinated, 'TEACH-01', 'frontend-pending-request').payload.data.params.course_id;
  findRaw(coordinated, 'TEACH-01', 'frontend-scope-state').payload.data.accepted_state_course_ids = [101, 202];
  findRaw(coordinated, 'TEACH-01', 'frontend-pending-dom').payload.data.rendered_html = '<article>Control Flow</article>';
  const coordinatedFacts = provenance.QA016_PROVENANCE_VERIFIER.recompute({
    schema_version: coordinated.provenance.schema_version,
    envelope_id: coordinated.provenance.envelope_id,
    raw_records: clone(coordinated.provenance.raw_records),
  });
  coordinated.provenance.canonical_facts = clone(coordinatedFacts);
  synchronizeDerivedLayers(coordinated, coordinatedFacts);
  assert.equal(probe.validateReportConsistency(coordinated).status, 'PASS');
  assert.equal(coordinated.provenance.assurance, 'consistency-only');
  assert.match(coordinated.provenance.limitation, /external source-authenticity/);
  assert.equal(findFact(coordinated, 'TEACH-01').value.defect_observed, true);

  const cli = spawnSync(process.execPath, [
    'tools/qa/qa016-critical-journeys.cjs',
    '--mode',
    'frontend',
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(cli.status, 2, cli.stderr || cli.stdout);
  const cliReport = JSON.parse(cli.stdout);
  assert.equal(probe.validateReportConsistency(cliReport).status, 'PASS');
  assert.equal(cliReport.issues['TEACH-01'].defect_observed, false);
  assert.equal(cliReport.execution.exit_code, cli.status);
  assert.equal(cli.stderr.trim(), cliReport.human_summary);

  console.log('QA-016 probe self-test contract: raw-only recomputation, derived-layer tamper gates, controlled TEACH facts, and consistency-only limitation ok');
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
