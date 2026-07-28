const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'tools/quality/sqlite-qa-ledger.py'), 'utf8');

assert.match(source, /EXPECTED_REVISION = "20260727_0051"/);
assert.match(source, /sqlite3\.connect\(f"\{resolved\.as_uri\(\)\}\?mode=ro", uri=True\)/);
assert.match(source, /os\.path\.normcase\(str\(resolved_output\)\)[\s\S]*os\.path\.normcase\(str\(resolved_database\)\)/);
assert.match(source, /output\.exists\(\) and output\.samefile\(resolved_database\)/);
assert.match(source, /tempfile\.mkstemp\([\s\S]*dir=output\.parent/);
assert.match(source, /os\.fsync\(handle\.fileno\(\)\)/);
assert.match(source, /os\.replace\(temporary, output\)/);
assert.doesNotMatch(source, /args\.output\.write_text/);

console.log('sqlite-qa-ledger-contract: ok');
