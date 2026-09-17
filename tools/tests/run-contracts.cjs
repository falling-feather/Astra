const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const testsDirectory = __dirname;
const testFiles = fs.readdirSync(testsDirectory)
  .filter((name) => name.endsWith('.cjs') && name !== path.basename(__filename))
  .sort();
const failures = [];

for (const testFile of testFiles) {
  const result = spawnSync(process.execPath, [path.join(testsDirectory, testFile)], {
    cwd: path.resolve(testsDirectory, '..', '..'),
    encoding: 'utf8',
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || (result.signal ? `signal ${result.signal}` : `exit ${result.status}`);
    failures.push({ testFile, detail });
  }
}

if (failures.length) {
  console.error(`${failures.length} of ${testFiles.length} frontend contracts failed:`);
  for (const { testFile, detail } of failures) console.error(`- ${testFile}: ${detail}`);
  process.exitCode = 1;
} else {
  console.log(`all ${testFiles.length} frontend contracts passed`);
}
