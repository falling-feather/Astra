const assert = require('node:assert/strict');

const probe = require('../qa/qa016-critical-journeys.cjs');

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
assert.ok(result.checks.length >= 4);

for (const issueId of probe.ISSUE_IDS) {
  const contract = probe.ISSUE_CONTRACTS[issueId];
  assert.ok(contract.owner);
  assert.ok(contract.preconditions.length > 0);
  assert.ok(contract.steps.length > 0);
  assert.ok(contract.expected);
  assert.match(contract.command, /qa016-critical-journeys\.cjs/);
}

console.log('QA-016 probe self-test contract: positive/negative evaluator and six issue records ok');
