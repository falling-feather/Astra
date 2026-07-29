const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const launcher = read('astra-local.ps1');
const preview = read('backend/app/local_preview.py');
const bootstrap = read('backend/scripts/local_preview_bootstrap_admin.py');
const apiClient = read('shared/js/api-client.js');

assert.match(launcher, /\[int\]\$Port = 9001/);
assert.match(launcher, /\[string\]\$PythonExecutable = ""/);
assert.match(launcher, /\[string\]\$VirtualEnvironmentPath = ""/);
assert.match(launcher, /\$DefaultVirtualEnvironment = Join-Path \$RepoRoot "\.venv"/);
assert.match(launcher, /Join-Path \$ManagedVirtualEnvironment "Scripts\\python\.exe"/);
assert.match(launcher, /selected virtual environment does not use Python 3\.12\+/);
assert.match(launcher, /& \$RuntimePython -m pip install --disable-pip-version-check --require-hashes -r \$RequirementsLock/);
assert.match(launcher, /& \$RuntimePython -m alembic -c alembic\.ini upgrade head/);
assert.match(launcher, /& \$RuntimePython -m uvicorn app\.local_preview:app --host 127\.0\.0\.1 --port \$Port/);
assert.match(launcher, /ASTRA_DATABASE_URL = "sqlite\+pysqlite:\/\/\/\$databaseUrlPath"/);
assert.match(launcher, /ASTRA_ADMIN_BOOTSTRAP_ENABLED = "false"/);
assert.match(launcher, /ASTRA_ADMIN_BOOTSTRAP_TOKEN = ""/);
for (const disabledFlag of [
    'ASTRA_AUDIT_ANCHOR_ENABLED',
    'ASTRA_EXTERNAL_ISSUE_SYNC_ENABLED',
    'ASTRA_ALERT_DELIVERY_ENABLED',
    'ASTRA_BACKGROUND_TASK_WORKER_ENABLED',
    'ASTRA_KNOWLEDGE_SNAPSHOT_SCHEDULER_ENABLED',
    'ASTRA_CONTENT_SCRIPT_REMOTE_DRIFT_SCHEDULER_ENABLED',
]) {
    assert.match(launcher, new RegExp(`${disabledFlag} = "false"`));
}
assert.match(launcher, /\[switch\]\$BootstrapAdmin/);
assert.match(launcher, /\$RuntimePython -X utf8 -m scripts\.local_preview_bootstrap_admin/);
assert.match(launcher, /\$OutputEncoding = \[Text\.UTF8Encoding\]::new\(\$false\)/);
assert.match(launcher, /if \(\$BootstrapAdmin\)[\s\S]*Stop it with Ctrl\+C[\s\S]*-BootstrapAdmin/);
assert.match(launcher, /Invoke-WebRequest[\s\S]*<title>\[\^<\]\*Astra/);
assert.match(launcher, /health\.environment -ne "development"/);
assert.match(launcher, /X-Astra-Local-Preview/);
assert.match(launcher, /Get-AstraLocalInstanceId/);
assert.match(launcher, /GetPathRoot\(\$DataDirectory\)[\s\S]*TrimEnd/);
assert.match(launcher, /Local\\AstraLocalPreviewData-\$\(\$instanceId\.Substring\(0, 32\)\)/);
assert.match(launcher, /WaitOne\(0\)/);
assert.match(launcher, /ReleaseMutex\(\)/);
assert.match(launcher, /ASTRA_LOCAL_PREVIEW_INSTANCE_ID = \$instanceId/);
assert.doesNotMatch(launcher, /deploy\.ps1|ASTRA_ENVIRONMENT\s*=\s*"(?:staging|production)"/);
assert.doesNotMatch(launcher, /password\s*=\s*"[^"$]+"/i);
assert.doesNotMatch(launcher, /\b(?:Start-Process|Invoke-Expression|mklink|uvicorn\.exe)\b/i);
assert.doesNotMatch(launcher, /New-Item[\s\S]{0,120}-ItemType\s+(?:Junction|SymbolicLink)/i);
assert.doesNotMatch(launcher, /\bCopy-Item\b/i);

for (const directory of ['pages', 'shared', 'UI', 'codevis']) {
    assert.match(preview, new RegExp(`\\("/${directory}", "${directory}"\\)`));
}
assert.doesNotMatch(preview, /StaticFiles\(directory=(?:PROJECT_ROOT|root)/);
for (const privateRoot of ['backend', 'doc', 'server', '.git']) {
    assert.doesNotMatch(preview, new RegExp(`\\("/${privateRoot}`));
}
assert.match(preview, /Service-Worker-Allowed/);
assert.match(preview, /key != "apiBase"/);
assert.match(preview, /RedirectResponse/);
assert.match(preview, /X-Astra-Local-Preview/);
assert.match(preview, /X-Astra-Local-Instance/);
assert.match(preview, /ASTRA_LOCAL_PREVIEW_SAME_ORIGIN = true/);
assert.match(preview, /localStorage\.removeItem\('astra-api-base'\)/);
assert.match(apiClient, /ASTRA_LOCAL_PREVIEW_SAME_ORIGIN === true[\s\S]*url\.origin === current\.origin/);
assert.match(bootstrap, /client\.post\("\/api\/admin\/bootstrap"/);
assert.match(bootstrap, /lstrip\("\\ufeff"\)/);
assert.match(bootstrap, /set\(payload\) != \{"username", "password", "display_name"\}/);
assert.doesNotMatch(bootstrap, /print\([^\n]*password/);

console.log('local-preview-contract: ok');
