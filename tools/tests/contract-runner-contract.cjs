const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-contract-runner-'));
const directory = path.join(temporaryRoot, 'tools', 'tests');
try {
  fs.mkdirSync(directory, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'run-contracts.cjs'), path.join(directory, 'run-contracts.cjs'));
  for (const [name, status] of [['01-failure', 2], ['02-success', 0], ['03-failure', 3]]) {
    fs.writeFileSync(path.join(directory, `${name}.cjs`), [
      `require('node:fs').appendFileSync('executed.txt', '${name}\\n');`,
      `process.exitCode = ${status};`,
    ].join('\n'));
  }
  const failedRun = spawnSync(process.execPath, [path.join(directory, 'run-contracts.cjs')], { encoding: 'utf8' });
  assert.ifError(failedRun.error);
  assert.notEqual(failedRun.status, 0, 'a failing contract must leave the aggregate command red');
  assert.equal(fs.readFileSync(path.join(temporaryRoot, 'executed.txt'), 'utf8'),
    '01-failure\n02-success\n03-failure\n',
    'the runner must execute later contracts after an earlier failure');
  const report = failedRun.stdout + failedRun.stderr;
  assert.ok(report.includes('01-failure.cjs'), 'the aggregate report must identify the first failure');
  assert.ok(report.includes('03-failure.cjs'), 'the aggregate report must identify later failures');

  fs.unlinkSync(path.join(directory, '01-failure.cjs'));
  fs.unlinkSync(path.join(directory, '03-failure.cjs'));
  const passedRun = spawnSync(process.execPath, [path.join(directory, 'run-contracts.cjs')], { encoding: 'utf8' });
  assert.ifError(passedRun.error);
  assert.equal(passedRun.status, 0, passedRun.stderr);
  assert.match(passedRun.stdout, /all 1 frontend contracts passed/);
  console.log('contract-runner-contract: ok');
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
