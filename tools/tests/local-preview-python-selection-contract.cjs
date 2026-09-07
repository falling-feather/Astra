const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const launcherPath = path.join(root, 'astra-local.ps1');
const requirementsLock = path.join(root, 'backend', 'requirements.lock');
const launcher = fs.readFileSync(launcherPath, 'utf8');
const powershell = 'C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

assert.match(launcher, /\[string\]\$PythonExecutable = ""/);
assert.match(launcher, /\[string\]\$VirtualEnvironmentPath = ""/);
assert.match(launcher, /\$DefaultVirtualEnvironment = Join-Path \$RepoRoot "\.venv"/);
assert.match(
  launcher,
  /\$PythonExecutableSpecified -and \$VirtualEnvironmentPathSpecified[\s\S]*mutually exclusive/,
);
assert.match(
  launcher,
  /\$PythonExecutableSpecified -and -not \$SkipDependencyInstall[\s\S]*requires -SkipDependencyInstall/,
);
assert.match(
  launcher,
  /Resolve-ExecutableApplication[\s\S]*-CommandType Application[\s\S]*CommandTypes\]::Application/,
);
assert.match(
  launcher,
  /Assert-ExternalVirtualEnvironmentPath[\s\S]*Equals\(\$RepoRoot, \[StringComparison\]::OrdinalIgnoreCase\)[\s\S]*StartsWith\(\$repoPrefix, \[StringComparison\]::OrdinalIgnoreCase\)/,
);
assert.match(
  launcher,
  /Assert-StandardWindowsPathNamespace[\s\S]*Windows device namespace/,
);
assert.match(
  launcher,
  /Assert-NoReparsePointInPath[\s\S]*FileAttributes\]::ReparsePoint[\s\S]*junction, symbolic link, or volume mount/,
);
assert.match(
  launcher,
  /Assert-PythonRuntimePrefix[\s\S]*base64\.b64encode[\s\S]*FromBase64String[\s\S]*sys\.prefix does not match -VirtualEnvironmentPath/,
);
assert.match(
  launcher,
  /Join-Path \$VirtualEnvironment "Lib\\site-packages"/,
);
assert.match(launcher, /-ExternalVirtualEnvironment/);
assert.match(
  launcher,
  /& \$RuntimePython -m pip --isolated --disable-pip-version-check --no-cache-dir install --dry-run --no-index --require-hashes -r \$RequirementsLock/,
);
assert.match(launcher, /& \$RuntimePython -m pip --isolated check/);
assert.match(
  launcher,
  /Get-AstraFileSha256[\s\S]*SHA256\]::Create\(\)[\s\S]*ComputeHash\(\$stream\)/,
);
assert.doesNotMatch(launcher, /\bGet-FileHash\b/);
assert.match(
  launcher,
  /\$ManagedRequirementsMarker = Join-Path \$ManagedVirtualEnvironment "\.astra-requirements\.sha256"/,
);
assert.match(
  launcher,
  /& \$RuntimePython -m pip install --disable-pip-version-check --require-hashes -r \$RequirementsLock \| Out-Host/,
);
assert.match(
  launcher,
  /& \$launcher\.Command @\(\$launcher\.Arguments\) -m venv \$VirtualEnvironment \| Out-Host/,
);
for (const invocation of [
  /& \$RuntimePython -m alembic -c alembic\.ini upgrade head/,
  /& \$RuntimePython -X utf8 -m scripts\.local_preview_bootstrap_admin --confirm-local-preview/,
  /& \$RuntimePython -X utf8 -m scripts\.initialize_demo_data --confirm-local-preview/,
  /& \$RuntimePython -m uvicorn app\.local_preview:app --host 127\.0\.0\.1 --port \$Port/,
]) {
  assert.match(launcher, invocation);
}
assert.doesNotMatch(launcher, /&\s+\$(?:VirtualPython|ManagedVirtualPython)\s+-m\s+(?:pip|alembic|uvicorn)\b/);
assert.doesNotMatch(launcher, /&\s+(?:python|python3|py|uvicorn(?:\.exe)?)\s/i);
assert.doesNotMatch(launcher, /\b(?:Start-Process|Invoke-Expression|mklink|uvicorn\.exe)\b/i);
assert.doesNotMatch(launcher, /New-Item[\s\S]{0,120}-ItemType\s+(?:Junction|SymbolicLink)/i);
assert.doesNotMatch(launcher, /\bCopy-Item\b/i);

const managedRuntimeBody = launcher.slice(
  launcher.indexOf('function Initialize-ManagedPythonRuntime'),
  launcher.indexOf('function Test-LocalPort'),
);
const managedVenvCreation = managedRuntimeBody.indexOf(
  '& $launcher.Command @($launcher.Arguments) -m venv $VirtualEnvironment',
);
const postCreateGuard = managedRuntimeBody.indexOf(
  'Assert-ExternalManagedRuntimePaths',
  managedVenvCreation,
);
const managedRuntimeResolution = managedRuntimeBody.indexOf(
  '$RuntimePython = Resolve-ExecutableApplication',
);
assert.ok(managedVenvCreation >= 0);
assert.ok(postCreateGuard > managedVenvCreation);
assert.ok(
  postCreateGuard < managedRuntimeResolution,
  'post-create reparse validation must run before external Python is resolved or executed',
);

const invocationBody = launcher.slice(launcher.indexOf('function Invoke-AstraLocalPreview'));
const dataDirectoryCreation = invocationBody.indexOf(
  'New-Item -ItemType Directory -Path $DataDirectory -Force',
);
assert.ok(dataDirectoryCreation > 0, 'the data directory creation point must remain explicit');
for (const prerequisite of [
  'Invoke-ExplicitPythonDependencyValidation -RuntimePython $RuntimePython',
  'Assert-ExternalVirtualEnvironmentPath -ResolvedVirtualEnvironment $ManagedVirtualEnvironment',
  '$RuntimePython = Initialize-ManagedPythonRuntime',
]) {
  const prerequisiteIndex = invocationBody.indexOf(prerequisite);
  assert.ok(prerequisiteIndex >= 0, `${prerequisite} must remain in Invoke-AstraLocalPreview`);
  assert.ok(
    prerequisiteIndex < dataDirectoryCreation,
    `${prerequisite} must run before the data directory is created`,
  );
}
for (const sideEffect of [
  '$saltPath = Join-Path $DataDirectory ".audit-salt"',
  '$env:ASTRA_ENVIRONMENT = "development"',
  '& $RuntimePython -m alembic',
  '& $RuntimePython -X utf8 -m scripts.initialize_demo_data',
  '& $RuntimePython -m uvicorn',
]) {
  assert.ok(
    invocationBody.indexOf(sideEffect) > dataDirectoryCreation,
    `${sideEffect} must remain after runtime validation`,
  );
}

const tempBase = path.resolve(os.tmpdir());
const tempRoot = fs.mkdtempSync(path.join(tempBase, 'astra-tools-002-'));
assert.ok(
  path.resolve(tempRoot).startsWith(`${tempBase}${path.sep}`),
  'the contract test may clean only its own OS temporary directory',
);
const temporaryJunctions = [];

function createTemporaryJunction(target, junctionPath) {
  fs.symlinkSync(target, junctionPath, 'junction');
  const stat = fs.lstatSync(junctionPath);
  assert.equal(stat.isSymbolicLink(), true, `${junctionPath} must be a junction/reparse link`);
  temporaryJunctions.push(junctionPath);
}

const fakeBin = path.join(tempRoot, '假 Python 工具');
const fakeSourcePath = path.join(tempRoot, 'FakePython.cs');
const fakePython = path.join(fakeBin, 'python.exe');
const nonApplication = path.join(tempRoot, 'not-an-application.ps1');
fs.mkdirSync(fakeBin, { recursive: true });
// This contract isolates Python selection. Frontend builds have their own Vite/packaging gates.
fs.writeFileSync(path.join(fakeBin, 'npm.cmd'), '@echo off\r\nexit /b 0\r\n');
fs.writeFileSync(nonApplication, 'exit 0\r\n', 'utf8');

const fakeRuntimeSource = String.raw`using System;
using System.IO;
using System.Reflection;
using System.Text;

public static class FakePython
{
    private static int RequestedExitCode(string variableName)
    {
        int value;
        return int.TryParse(Environment.GetEnvironmentVariable(variableName), out value) ? value : 0;
    }

    private static void Record(string[] args)
    {
        string logPath = Environment.GetEnvironmentVariable("ASTRA_FAKE_PYTHON_LOG");
        if (String.IsNullOrEmpty(logPath))
        {
            return;
        }
        string executable = Assembly.GetExecutingAssembly().Location;
        string line = executable + "\t" + String.Join(((char)31).ToString(), args) + Environment.NewLine;
        File.AppendAllText(logPath, line, new UTF8Encoding(false));
    }

    public static int Main(string[] args)
    {
        Record(args);

        if (Array.IndexOf(args, "-0p") >= 0)
        {
            Console.WriteLine("-V:3.12 * " + Assembly.GetExecutingAssembly().Location);
            return 0;
        }

        int commandIndex = Array.IndexOf(args, "-c");
        if (commandIndex >= 0)
        {
            string command = commandIndex + 1 < args.Length ? args[commandIndex + 1] : "";
            if (command.IndexOf("sys.prefix", StringComparison.Ordinal) >= 0)
            {
                string prefix = Environment.GetEnvironmentVariable("ASTRA_FAKE_PREFIX");
                if (String.IsNullOrEmpty(prefix))
                {
                    DirectoryInfo scripts = Directory.GetParent(Assembly.GetExecutingAssembly().Location);
                    prefix = scripts == null || scripts.Parent == null
                        ? ""
                        : scripts.Parent.FullName;
                }
                Console.WriteLine(Convert.ToBase64String(Encoding.UTF8.GetBytes(prefix)));
                return RequestedExitCode("ASTRA_FAKE_PREFIX_EXIT");
            }
            Console.WriteLine(Environment.GetEnvironmentVariable("ASTRA_FAKE_VERSION") ?? "3.12");
            return RequestedExitCode("ASTRA_FAKE_VERSION_EXIT");
        }

        int moduleIndex = Array.IndexOf(args, "-m");
        if (moduleIndex >= 0 && moduleIndex + 1 < args.Length)
        {
            string module = args[moduleIndex + 1];
            if (module == "venv" && moduleIndex + 2 < args.Length)
            {
                string scripts = Path.Combine(args[moduleIndex + 2], "Scripts");
                Directory.CreateDirectory(scripts);
                File.Copy(Assembly.GetExecutingAssembly().Location, Path.Combine(scripts, "python.exe"), true);
                Console.WriteLine("fake venv created");
                return RequestedExitCode("ASTRA_FAKE_VENV_EXIT");
            }

            if (module == "pip")
            {
                bool isDryRun = Array.IndexOf(args, "--dry-run") >= 0;
                bool isCheck = Array.IndexOf(args, "check") >= 0;
                if (isDryRun)
                {
                    return RequestedExitCode("ASTRA_FAKE_DRY_RUN_EXIT");
                }
                if (isCheck)
                {
                    return RequestedExitCode("ASTRA_FAKE_CHECK_EXIT");
                }
                Console.WriteLine("fake locked install complete");
                return RequestedExitCode("ASTRA_FAKE_INSTALL_EXIT");
            }
        }

        return RequestedExitCode("ASTRA_FAKE_MODULE_EXIT");
    }
}
`;
fs.writeFileSync(fakeSourcePath, fakeRuntimeSource, 'utf8');

function escapePowerShellLiteral(value) {
  return value.replace(/'/g, "''");
}

function cleanEnvironment(overrides = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'path') {
      delete env[key];
    }
  }
  env.Path = `${fakeBin};${process.env.SystemRoot}\\System32`;
  Object.assign(env, {
    ASTRA_FAKE_VERSION: '3.12',
    ASTRA_FAKE_VERSION_EXIT: '0',
    ASTRA_FAKE_PREFIX: '',
    ASTRA_FAKE_PREFIX_EXIT: '0',
    ASTRA_FAKE_VENV_EXIT: '0',
    ASTRA_FAKE_DRY_RUN_EXIT: '0',
    ASTRA_FAKE_CHECK_EXIT: '0',
    ASTRA_FAKE_INSTALL_EXIT: '0',
    ASTRA_FAKE_MODULE_EXIT: '0',
  }, overrides);
  return env;
}

function compileFakeRuntime() {
  return spawnSync(powershell, [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `Add-Type -Path '${escapePowerShellLiteral(fakeSourcePath)}' -OutputAssembly '${escapePowerShellLiteral(fakePython)}' -OutputType ConsoleApplication`,
  ], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
}

function runLauncher(label, args, overrides = {}) {
  const logPath = path.join(tempRoot, `${label}.log`);
  const result = spawnSync(powershell, [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    launcherPath,
    ...args,
  ], {
    cwd: root,
    encoding: 'utf8',
    env: cleanEnvironment({ ASTRA_FAKE_PYTHON_LOG: logPath, ...overrides }),
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.ifError(result.error);
  return { ...result, logPath };
}

const allocatedPorts = [];
function allocateLoopbackPort(label) {
  const result = spawnSync(powershell, [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$port = 0
try {
  $listener.Start()
  $port = $listener.LocalEndpoint.Port
} finally {
  $listener.Stop()
}
$probe = [Net.Sockets.TcpClient]::new()
try {
  $task = $probe.ConnectAsync([Net.IPAddress]::Loopback, $port)
  if ($task.Wait(150) -and $probe.Connected) { exit 71 }
} catch {
} finally {
  $probe.Dispose()
}
[Console]::Out.Write($port)`,
  ], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const port = Number.parseInt(result.stdout.trim(), 10);
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535 && port !== 9001);
  allocatedPorts.push({ label, port });
  return port;
}

function assertPureExternalPathValidationRejects(fakeRepo, reparsePath) {
  const scriptPath = escapePowerShellLiteral(launcherPath);
  const fakeRepoPath = escapePowerShellLiteral(fakeRepo);
  const directPath = escapePowerShellLiteral(reparsePath);
  const descendantPath = escapePowerShellLiteral(path.join(reparsePath, 'missing', 'venv'));
  const result = spawnSync(powershell, [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile('${scriptPath}', [ref]$tokens, [ref]$errors)
if ($errors.Count -ne 0) { exit 61 }
foreach ($name in @('Assert-StandardWindowsPathNamespace', 'Assert-NoReparsePointInPath', 'Assert-ExternalVirtualEnvironmentPath')) {
  $definition = $ast.Find(
    { param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name },
    $true
  )
  if (-not $definition) { exit 62 }
  Set-Item -LiteralPath ('Function:\\' + $name) -Value $definition.Body.GetScriptBlock()
}
$RepoRoot = [IO.Path]::GetFullPath('${fakeRepoPath}')
foreach ($candidate in @('${directPath}', '${descendantPath}')) {
  $rejected = $false
  try {
    Assert-ExternalVirtualEnvironmentPath -ResolvedVirtualEnvironment ([IO.Path]::GetFullPath($candidate))
  } catch {
    if ($_.Exception.Message -match 'junction|symbolic link|volume mount') {
      $rejected = $true
    } else {
      Write-Error $_.Exception.Message
      exit 63
    }
  }
  if (-not $rejected) { exit 64 }
}
exit 0`,
  ], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function assertPureRepositoryBoundaryRejects(fakeRepo) {
  const scriptPath = escapePowerShellLiteral(launcherPath);
  const fakeRepoPath = escapePowerShellLiteral(fakeRepo);
  const fakeRepoSubtree = escapePowerShellLiteral(
    path.join(fakeRepo, 'candidate', '..', 'candidate'),
  );
  const result = spawnSync(powershell, [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile('${scriptPath}', [ref]$tokens, [ref]$errors)
if ($errors.Count -ne 0) { exit 65 }
foreach ($name in @('Assert-StandardWindowsPathNamespace', 'Assert-NoReparsePointInPath', 'Assert-ExternalVirtualEnvironmentPath')) {
  $definition = $ast.Find(
    { param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name },
    $true
  )
  if (-not $definition) { exit 66 }
  Set-Item -LiteralPath ('Function:\\' + $name) -Value $definition.Body.GetScriptBlock()
}
$RepoRoot = [IO.Path]::GetFullPath('${fakeRepoPath}')
foreach ($candidate in @('${fakeRepoPath}', '${fakeRepoSubtree}')) {
  $rejected = $false
  try {
    Assert-ExternalVirtualEnvironmentPath -ResolvedVirtualEnvironment ([IO.Path]::GetFullPath($candidate))
  } catch {
    if ($_.Exception.Message -match 'outside the repository') {
      $rejected = $true
    } else {
      Write-Error $_.Exception.Message
      exit 67
    }
  }
  if (-not $rejected) { exit 68 }
}
exit 0`,
  ], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function readInvocations(logPath) {
  if (!fs.existsSync(logPath)) {
    return [];
  }
  return fs.readFileSync(logPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf('\t');
      assert.ok(separator >= 0, `fake runtime log line must include an executable: ${line}`);
      return {
        executable: line.slice(0, separator),
        args: line.slice(separator + 1).split(String.fromCharCode(31)),
      };
    });
}

function snapshotDefaultVenv() {
  const defaultVenv = path.join(root, '.venv');
  let rootStat;
  try {
    rootStat = fs.lstatSync(defaultVenv);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { exists: false };
    }
    throw error;
  }
  if (!rootStat) {
    return { exists: false };
  }

  const entries = [];
  const visit = (absolutePath, relativePath) => {
    const stat = fs.lstatSync(absolutePath);
    const entry = {
      path: relativePath || '.',
      type: stat.isSymbolicLink()
        ? 'reparse-link'
        : stat.isDirectory()
          ? 'directory'
          : stat.isFile()
            ? 'file'
            : 'other',
      size: stat.size,
      mode: stat.mode,
    };
    if (stat.isSymbolicLink()) {
      entry.linkTarget = fs.readlinkSync(absolutePath);
      entries.push(entry);
      return;
    }
    if (stat.isFile()) {
      entry.sha256 = crypto
        .createHash('sha256')
        .update(fs.readFileSync(absolutePath))
        .digest('hex');
      entries.push(entry);
      return;
    }

    entries.push(entry);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(absolutePath).sort()) {
        visit(
          path.join(absolutePath, child),
          relativePath ? path.join(relativePath, child) : child,
        );
      }
    }
  };
  visit(defaultVenv, '');
  return { exists: true, entries };
}

function assertFailureBeforeData(result, dataDirectory, message) {
  assert.notEqual(result.status, 0, `${message}: launcher unexpectedly succeeded`);
  assert.equal(fs.existsSync(dataDirectory), false, `${message}: data directory was created`);
}

function hasModule(invocation, moduleName) {
  const moduleIndex = invocation.args.indexOf('-m');
  return moduleIndex >= 0 && invocation.args[moduleIndex + 1] === moduleName;
}

function assertNoRuntimeSideEffects(invocations, message) {
  assert.equal(
    invocations.some((item) => hasModule(item, 'alembic')),
    false,
    `${message}: Alembic ran`,
  );
  assert.equal(
    invocations.some((item) => hasModule(item, 'scripts.local_preview_bootstrap_admin')),
    false,
    `${message}: administrator bootstrap ran`,
  );
  assert.equal(
    invocations.some((item) => hasModule(item, 'scripts.initialize_demo_data')),
    false,
    `${message}: demo initializer ran`,
  );
  assert.equal(
    invocations.some((item) => hasModule(item, 'uvicorn')),
    false,
    `${message}: Uvicorn ran`,
  );
}

function normalized(value) {
  // Windows runner TEMP can use an 8.3 alias while .NET reports the long path.
  // Compare the existing executable's canonical path, not its input spelling.
  return fs.realpathSync.native(value).toLowerCase();
}

try {
  const compile = compileFakeRuntime();
  assert.ifError(compile.error);
  assert.equal(compile.status, 0, compile.stderr || compile.stdout);
  assert.equal(fs.existsSync(fakePython), true, 'fake Python executable was not compiled');

  const repoVenvBefore = snapshotDefaultVenv();
  const fakeRepo = path.join(tempRoot, 'fake repository boundary');
  const fakeRepoSentinel = path.join(fakeRepo, 'sentinel.txt');
  const fakeRepoJunction = path.join(tempRoot, 'external junction to fake repository');
  fs.mkdirSync(fakeRepo, { recursive: true });
  fs.writeFileSync(fakeRepoSentinel, 'must remain unchanged\r\n', 'utf8');
  const fakeRepoSentinelHash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(fakeRepoSentinel))
    .digest('hex');
  assertPureRepositoryBoundaryRejects(fakeRepo);
  createTemporaryJunction(fakeRepo, fakeRepoJunction);
  assertPureExternalPathValidationRejects(fakeRepo, fakeRepoJunction);
  const danglingTarget = path.join(tempRoot, 'temporary dangling target');
  const danglingJunction = path.join(tempRoot, 'dangling external junction');
  fs.mkdirSync(danglingTarget, { recursive: true });
  createTemporaryJunction(danglingTarget, danglingJunction);
  assert.ok(path.resolve(danglingTarget).startsWith(`${path.resolve(tempRoot)}${path.sep}`));
  fs.rmdirSync(danglingTarget);
  assertPureExternalPathValidationRejects(fakeRepo, danglingJunction);
  assert.equal(
    crypto.createHash('sha256').update(fs.readFileSync(fakeRepoSentinel)).digest('hex'),
    fakeRepoSentinelHash,
    'pure reparse validation must not modify its TEMP decoy repository',
  );

    const bothData = path.join(tempRoot, 'both 参数 data');
    const both = runLauncher('both-parameters', [
      '-PythonExecutable', fakePython,
      '-VirtualEnvironmentPath', path.join(tempRoot, 'unused external venv'),
      '-SkipDependencyInstall',
      '-DataDirectory', bothData,
      '-Port', String(allocateLoopbackPort('both-parameters')),
    ]);
    assertFailureBeforeData(both, bothData, 'mutually exclusive parameters');
    assert.equal(readInvocations(both.logPath).length, 0);

    const noSkipData = path.join(tempRoot, 'explicit without skip data');
    const noSkip = runLauncher('explicit-without-skip', [
      '-PythonExecutable', fakePython,
      '-DataDirectory', noSkipData,
      '-Port', String(allocateLoopbackPort('explicit-without-skip')),
    ]);
    assertFailureBeforeData(noSkip, noSkipData, 'explicit Python without skip');
    assert.equal(readInvocations(noSkip.logPath).length, 0);

    const nonApplicationData = path.join(tempRoot, 'non application data');
    const nonApplicationResult = runLauncher('non-application', [
      '-PythonExecutable', nonApplication,
      '-SkipDependencyInstall',
      '-DataDirectory', nonApplicationData,
      '-Port', String(allocateLoopbackPort('non-application')),
    ]);
    assertFailureBeforeData(nonApplicationResult, nonApplicationData, 'non-Application Python');
    assert.equal(readInvocations(nonApplicationResult.logPath).length, 0);

    const oldPythonData = path.join(tempRoot, 'Python 3.11 data');
    const oldPython = runLauncher('python-311', [
      '-PythonExecutable', fakePython,
      '-SkipDependencyInstall',
      '-DataDirectory', oldPythonData,
      '-Port', String(allocateLoopbackPort('python-311')),
    ], { ASTRA_FAKE_VERSION: '3.11' });
    assertFailureBeforeData(oldPython, oldPythonData, 'Python 3.11');
    const oldPythonInvocations = readInvocations(oldPython.logPath);
    assert.equal(oldPythonInvocations.length, 1);
    assert.ok(oldPythonInvocations[0].args.includes('-c'));
    assertNoRuntimeSideEffects(oldPythonInvocations, 'Python 3.11 rejection');

    const dryRunData = path.join(tempRoot, 'dry run failure data');
    const dryRunFailure = runLauncher('dry-run-failure', [
      '-PythonExecutable', fakePython,
      '-SkipDependencyInstall',
      '-InitializeDemoData',
      '-DataDirectory', dryRunData,
      '-Port', String(allocateLoopbackPort('dry-run-failure')),
    ], { ASTRA_FAKE_DRY_RUN_EXIT: '23' });
    assertFailureBeforeData(dryRunFailure, dryRunData, 'locked dry-run failure');
    const dryRunInvocations = readInvocations(dryRunFailure.logPath);
    assert.equal(dryRunInvocations.length, 2);
    assert.deepEqual(dryRunInvocations[1].args, [
      '-m', 'pip',
      '--isolated',
      '--disable-pip-version-check',
      '--no-cache-dir',
      'install',
      '--dry-run',
      '--no-index',
      '--require-hashes',
      '-r',
      requirementsLock,
    ]);
    assert.equal(dryRunInvocations.some((item) => item.args.includes('check')), false);
    assertNoRuntimeSideEffects(dryRunInvocations, 'locked dry-run failure');
    assert.equal(fs.existsSync(path.join(path.dirname(fakePython), '.astra-requirements.sha256')), false);

    const pipCheckData = path.join(tempRoot, 'pip check failure data');
    const pipCheckFailure = runLauncher('pip-check-failure', [
      '-PythonExecutable', fakePython,
      '-SkipDependencyInstall',
      '-InitializeDemoData',
      '-DataDirectory', pipCheckData,
      '-Port', String(allocateLoopbackPort('pip-check-failure')),
    ], { ASTRA_FAKE_CHECK_EXIT: '24' });
    assertFailureBeforeData(pipCheckFailure, pipCheckData, 'pip check failure');
    const pipCheckInvocations = readInvocations(pipCheckFailure.logPath);
    assert.equal(pipCheckInvocations.length, 3);
    assert.deepEqual(pipCheckInvocations[2].args, ['-m', 'pip', '--isolated', 'check']);
    assertNoRuntimeSideEffects(pipCheckInvocations, 'pip check failure');
    assert.equal(fs.existsSync(path.join(path.dirname(fakePython), '.astra-requirements.sha256')), false);

    const explicitData = path.join(tempRoot, '显式 Python success data');
    const explicitSuccess = runLauncher('explicit-success', [
      '-PythonExecutable', fakePython,
      '-SkipDependencyInstall',
      '-InitializeDemoData',
      '-DataDirectory', explicitData,
      '-Port', String(allocateLoopbackPort('explicit-success')),
    ], { ASTRA_FAKE_VERSION: '3.14' });
    assert.equal(explicitSuccess.status, 0, explicitSuccess.stderr || explicitSuccess.stdout);
    assert.equal(fs.existsSync(path.join(explicitData, '.audit-salt')), true);
    const explicitInvocations = readInvocations(explicitSuccess.logPath);
    assert.ok(explicitInvocations.every((item) => normalized(item.executable) === normalized(fakePython)));
    for (const moduleName of ['alembic', 'scripts.initialize_demo_data', 'uvicorn']) {
      assert.ok(
        explicitInvocations.some((item) => hasModule(item, moduleName)),
        `explicit Python did not run ${moduleName}`,
      );
    }
    assert.equal(
      explicitInvocations.some((item) => (
        hasModule(item, 'pip') &&
        item.args.includes('install') &&
        !item.args.includes('--dry-run')
      )),
      false,
      'caller-managed Python must not install dependencies',
    );
    assert.equal(fs.existsSync(path.join(path.dirname(fakePython), '.astra-requirements.sha256')), false);

    const deviceNamespacePaths = [
      ['win32-device-question', `\\\\?\\${fakeRepo}\\device-subtree`],
      ['win32-device-dot', `\\\\.\\${fakeRepo}\\device-subtree`],
      ['nt-device-question', `\\??\\${fakeRepo}\\device-subtree`],
    ];
    for (const [label, devicePath] of deviceNamespacePaths) {
      const deviceData = path.join(tempRoot, `${label} data`);
      const deviceResult = runLauncher(label, [
        '-VirtualEnvironmentPath', devicePath,
        '-DataDirectory', deviceData,
        '-Port', String(allocateLoopbackPort(label)),
      ]);
      assertFailureBeforeData(deviceResult, deviceData, `${label} namespace`);
      assert.equal(readInvocations(deviceResult.logPath).length, 0);
    }

    const reparseScriptsVenv = path.join(tempRoot, 'external venv with reparse Scripts');
    const reparseScriptsTarget = path.join(tempRoot, 'decoy Scripts target');
    const reparseScriptsSentinel = path.join(reparseScriptsTarget, 'sentinel.txt');
    fs.mkdirSync(reparseScriptsVenv, { recursive: true });
    fs.mkdirSync(reparseScriptsTarget, { recursive: true });
    fs.copyFileSync(fakePython, path.join(reparseScriptsTarget, 'python.exe'));
    fs.writeFileSync(reparseScriptsSentinel, 'scripts sentinel\r\n', 'utf8');
    const reparseScriptsSentinelHash = crypto
      .createHash('sha256')
      .update(fs.readFileSync(reparseScriptsSentinel))
      .digest('hex');
    createTemporaryJunction(
      reparseScriptsTarget,
      path.join(reparseScriptsVenv, 'Scripts'),
    );
    const reparseScriptsData = path.join(tempRoot, 'reparse Scripts data');
    const reparseScriptsResult = runLauncher('reparse-scripts', [
      '-VirtualEnvironmentPath', reparseScriptsVenv,
      '-DataDirectory', reparseScriptsData,
      '-Port', String(allocateLoopbackPort('reparse-scripts')),
    ]);
    assertFailureBeforeData(reparseScriptsResult, reparseScriptsData, 'reparse Scripts venv');
    assert.equal(readInvocations(reparseScriptsResult.logPath).length, 0);
    assert.equal(
      crypto.createHash('sha256').update(fs.readFileSync(reparseScriptsSentinel)).digest('hex'),
      reparseScriptsSentinelHash,
      'reparse rejection must not modify the TEMP Scripts decoy',
    );

    const mismatchedVenv = path.join(tempRoot, 'existing venv wrong prefix');
    const mismatchedPython = path.join(mismatchedVenv, 'Scripts', 'python.exe');
    const mismatchedPrefix = path.join(tempRoot, 'different reported prefix');
    fs.mkdirSync(path.dirname(mismatchedPython), { recursive: true });
    fs.mkdirSync(mismatchedPrefix, { recursive: true });
    fs.copyFileSync(fakePython, mismatchedPython);
    const mismatchData = path.join(tempRoot, 'prefix mismatch data');
    const mismatchResult = runLauncher('prefix-mismatch', [
      '-VirtualEnvironmentPath', mismatchedVenv,
      '-InitializeDemoData',
      '-DataDirectory', mismatchData,
      '-Port', String(allocateLoopbackPort('prefix-mismatch')),
    ], { ASTRA_FAKE_PREFIX: mismatchedPrefix });
    assertFailureBeforeData(mismatchResult, mismatchData, 'external sys.prefix mismatch');
    const mismatchInvocations = readInvocations(mismatchResult.logPath);
    assert.equal(mismatchInvocations.length, 2);
    assert.ok(mismatchInvocations[0].args.includes('-c'));
    assert.ok(mismatchInvocations[1].args.includes('-I'));
    assert.equal(
      mismatchInvocations.some((item) => hasModule(item, 'pip')),
      false,
      'sys.prefix mismatch must fail before dependency installation',
    );
    assertNoRuntimeSideEffects(mismatchInvocations, 'external sys.prefix mismatch');
    assert.equal(fs.existsSync(path.join(mismatchedVenv, '.astra-requirements.sha256')), false);

    const failingExternal = path.join(tempRoot, '外置 venv install failure');
    const failingExternalData = path.join(tempRoot, 'external failure data');
    const externalFailure = runLauncher('external-install-failure', [
      '-VirtualEnvironmentPath', failingExternal,
      '-InitializeDemoData',
      '-DataDirectory', failingExternalData,
      '-Port', String(allocateLoopbackPort('external-install-failure')),
    ], { ASTRA_FAKE_INSTALL_EXIT: '25' });
    assertFailureBeforeData(externalFailure, failingExternalData, 'external venv install failure');
    assert.equal(fs.existsSync(path.join(failingExternal, 'Scripts', 'python.exe')), true);
    assert.equal(fs.existsSync(path.join(failingExternal, '.astra-requirements.sha256')), false);
    const externalFailureInvocations = readInvocations(externalFailure.logPath);
    assert.ok(
      externalFailureInvocations.some((item) => (
        normalized(item.executable) === normalized(path.join(failingExternal, 'Scripts', 'python.exe')) &&
        hasModule(item, 'pip') &&
        item.args.includes('install') &&
        !item.args.includes('--dry-run')
      )),
      `external venv dependency install must use its resolved Python: ${JSON.stringify({
        status: externalFailure.status,
        stdout: externalFailure.stdout,
        stderr: externalFailure.stderr,
        invocations: externalFailureInvocations,
      })}`,
    );
    assertNoRuntimeSideEffects(externalFailureInvocations, 'external venv install failure');

    const externalVenv = path.join(tempRoot, '外置 venv success');
    const externalData = path.join(tempRoot, 'external success data');
    const externalSuccess = runLauncher('external-success', [
      '-VirtualEnvironmentPath', externalVenv,
      '-InitializeDemoData',
      '-DataDirectory', externalData,
      '-Port', String(allocateLoopbackPort('external-success')),
    ]);
    assert.equal(externalSuccess.status, 0, externalSuccess.stderr || externalSuccess.stdout);
    const externalPython = path.join(externalVenv, 'Scripts', 'python.exe');
    const externalMarker = path.join(externalVenv, '.astra-requirements.sha256');
    assert.equal(fs.existsSync(externalPython), true);
    assert.equal(fs.existsSync(externalMarker), true);
    assert.equal(fs.existsSync(path.join(externalData, '.audit-salt')), true);
    const expectedLockHash = crypto
      .createHash('sha256')
      .update(fs.readFileSync(requirementsLock))
      .digest('hex');
    assert.equal(fs.readFileSync(externalMarker, 'utf8').trim(), expectedLockHash);
    const externalSuccessInvocations = readInvocations(externalSuccess.logPath);
    for (const moduleName of ['pip', 'alembic', 'scripts.initialize_demo_data', 'uvicorn']) {
      const matching = externalSuccessInvocations.filter((item) => hasModule(item, moduleName));
      assert.ok(matching.length > 0, `external venv did not run ${moduleName}`);
      assert.ok(
        matching.every((item) => normalized(item.executable) === normalized(externalPython)),
        `${moduleName} bypassed the external venv Python`,
      );
    }

  assert.ok(allocatedPorts.length >= 14, 'each dynamic launcher case must record a port-0 allocation');
  assert.deepEqual(
    snapshotDefaultVenv(),
    repoVenvBefore,
    'explicit/external modes must not create or modify the repository .venv',
  );
} finally {
  for (const junctionPath of [...temporaryJunctions].reverse()) {
    let stat;
    try {
      stat = fs.lstatSync(junctionPath);
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      throw error;
    }
    assert.equal(
      stat.isSymbolicLink(),
      true,
      `refusing to recursively clean unexpected non-link path: ${junctionPath}`,
    );
    fs.unlinkSync(junctionPath);
  }
  if (
    path.resolve(tempRoot).startsWith(`${tempBase}${path.sep}`) &&
    path.basename(tempRoot).startsWith('astra-tools-002-')
  ) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

console.log('local-preview-python-selection-contract: ok');
