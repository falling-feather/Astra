const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const ledgerPath = path.join(root, 'tools/quality/sqlite-qa-ledger.py');
const source = fs.readFileSync(ledgerPath, 'utf8');

assert.match(source, /def resolve_alembic_heads\(/);
assert.match(source, /Path\(__file__\)[\s\S]*"backend"[\s\S]*"alembic"/);
assert.match(source, /if len\(heads\) != 1/);
assert.match(source, /revisions == expected_alembic_heads/);
assert.match(source, /"expectedAlembicHeads": expected_alembic_heads/);
assert.doesNotMatch(source, /EXPECTED_REVISION\s*=/);
assert.doesNotMatch(source, /["']\d{8}_\d{4}["']/);
assert.match(source, /sqlite3\.connect\(f"\{resolved\.as_uri\(\)\}\?mode=ro", uri=True\)/);
assert.match(source, /os\.path\.normcase\(str\(resolved_output\)\)[\s\S]*os\.path\.normcase\(str\(resolved_database\)\)/);
assert.match(source, /output\.exists\(\) and output\.samefile\(resolved_database\)/);
assert.match(source, /tempfile\.mkstemp\([\s\S]*dir=output\.parent/);
assert.match(source, /os\.fsync\(handle\.fileno\(\)\)/);
assert.match(source, /os\.replace\(temporary, output\)/);
assert.doesNotMatch(source, /args\.output\.write_text/);

function findPython() {
  const candidates = [];
  if (process.env.PYTHON) candidates.push([process.env.PYTHON, []]);
  if (process.platform === 'win32') candidates.push(['py', ['-3']]);
  candidates.push(['python3', []], ['python', []]);
  const seen = new Set();
  for (const [command, prefix] of candidates) {
    const key = JSON.stringify([command, prefix]);
    if (seen.has(key)) continue;
    seen.add(key);
    const probe = spawnSync(command, [...prefix, '-c', 'import sqlite3'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    });
    if (!probe.error && probe.status === 0) return { command, prefix };
  }
  throw new Error('sqlite-qa-ledger contract requires a Python runtime with sqlite3');
}

const python = findPython();
const runPython = (args) => spawnSync(
  python.command,
  [...python.prefix, ...args],
  {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  },
);
const failureDetails = (result) => [
  `status=${result.status}`,
  `stdout=${result.stdout}`,
  `stderr=${result.stderr}`,
  result.error ? `error=${result.error.message}` : '',
].filter(Boolean).join('\n');

const resolveHeadsSource = String.raw`
import importlib.util
import json
from pathlib import Path
import sys

ledger_path = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("sqlite_qa_ledger", ledger_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
script_directory = Path(sys.argv[2]) if len(sys.argv) > 2 else module.ALEMBIC_SCRIPT_DIRECTORY
print(json.dumps(module.resolve_alembic_heads(script_directory)))
`;
const resolvedHeads = runPython(['-c', resolveHeadsSource, ledgerPath]);
assert.equal(resolvedHeads.status, 0, failureDetails(resolvedHeads));
const expectedHeads = JSON.parse(resolvedHeads.stdout);
assert.equal(expectedHeads.length, 1);
const expectedHead = expectedHeads[0];

const versionsDirectory = path.join(root, 'backend/alembic/versions');
let headMigrationSource = null;
for (const filename of fs.readdirSync(versionsDirectory).filter((name) => name.endsWith('.py'))) {
  const migrationSource = fs.readFileSync(path.join(versionsDirectory, filename), 'utf8');
  const revision = migrationSource.match(/^revision\s*=\s*["']([^"']+)["']/m)?.[1];
  if (revision === expectedHead) {
    headMigrationSource = migrationSource;
    break;
  }
}
assert.ok(headMigrationSource, `dynamic Alembic head ${expectedHead} must have a revision file`);
const staleRevision = headMigrationSource.match(/^down_revision\s*=\s*["']([^"']+)["']/m)?.[1];
assert.ok(staleRevision, 'current Alembic head must expose a parent for the stale-ledger contract');
assert.notEqual(staleRevision, expectedHead);

const createDatabaseSource = String.raw`
import sqlite3
import sys

connection = sqlite3.connect(sys.argv[1])
try:
    connection.executescript("""
        CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL);
        CREATE TABLE audit_chain_heads (
            id INTEGER PRIMARY KEY,
            current_audit_log_id INTEGER,
            current_hash VARCHAR(64)
        );
        CREATE TABLE security_control_locks (name VARCHAR(120) PRIMARY KEY);
    """)
    connection.execute("INSERT INTO alembic_version (version_num) VALUES (?)", (sys.argv[2],))
    connection.execute(
        "INSERT INTO audit_chain_heads (id, current_audit_log_id, current_hash) VALUES (1, NULL, NULL)"
    )
    connection.execute("INSERT INTO security_control_locks (name) VALUES ('admin-authority')")
    connection.commit()
finally:
    connection.close()
`;

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-sqlite-ledger-contract-'));
try {
  const currentDatabase = path.join(temporaryRoot, 'current-head.sqlite3');
  const staleDatabase = path.join(temporaryRoot, 'stale-head.sqlite3');
  const evidencePath = path.join(temporaryRoot, 'current-head-ledger.json');
  for (const [database, revision] of [
    [currentDatabase, expectedHead],
    [staleDatabase, staleRevision],
  ]) {
    const created = runPython(['-c', createDatabaseSource, database, revision]);
    assert.equal(created.status, 0, failureDetails(created));
  }

  const current = runPython([
    ledgerPath,
    '--database', currentDatabase,
    '--output', evidencePath,
    '--expect-empty-baseline',
  ]);
  assert.equal(current.status, 0, failureDetails(current));
  const currentLedger = JSON.parse(current.stdout);
  assert.deepEqual(currentLedger.expectedAlembicHeads, [expectedHead]);
  assert.deepEqual(currentLedger.alembicVersions, [expectedHead]);
  assert.equal(currentLedger.emptyBaselineOk, true);
  assert.equal(currentLedger.mode, 'read-only');
  assert.deepEqual(JSON.parse(fs.readFileSync(evidencePath, 'utf8')), currentLedger);

  const stale = runPython([
    ledgerPath,
    '--database', staleDatabase,
    '--expect-empty-baseline',
  ]);
  assert.equal(stale.status, 1, failureDetails(stale));
  const staleLedger = JSON.parse(stale.stdout);
  assert.deepEqual(staleLedger.expectedAlembicHeads, [expectedHead]);
  assert.deepEqual(staleLedger.alembicVersions, [staleRevision]);
  assert.equal(staleLedger.emptyBaselineOk, false);

  const multipleHeadsDirectory = path.join(temporaryRoot, 'multiple-heads');
  const multipleVersionsDirectory = path.join(multipleHeadsDirectory, 'versions');
  fs.mkdirSync(multipleVersionsDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(multipleVersionsDirectory, 'left.py'),
    'revision = "left"\ndown_revision = None\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(multipleVersionsDirectory, 'right.py'),
    'revision = "right"\ndown_revision = None\n',
    'utf8',
  );
  const multipleHeads = runPython([
    '-c',
    resolveHeadsSource,
    ledgerPath,
    multipleHeadsDirectory,
  ]);
  assert.notEqual(multipleHeads.status, 0, failureDetails(multipleHeads));
  assert.match(multipleHeads.stderr, /must have exactly one head/);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log(`sqlite-qa-ledger-contract: ok (dynamic head ${expectedHead}; stale ${staleRevision} rejected)`);
