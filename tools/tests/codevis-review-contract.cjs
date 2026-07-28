const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const challenge = fs.readFileSync(path.join(root, 'codevis/pages/course-challenge/course-challenge.js'), 'utf8');
const submissionAdapter = fs.readFileSync(path.join(root, 'codevis/shared/js/submission-adapter.js'), 'utf8');
const codevisRoot = path.join(root, 'codevis');
const codevisIndex = fs.readFileSync(path.join(codevisRoot, 'index.html'), 'utf8');
const codevisMain = fs.readFileSync(path.join(codevisRoot, 'shared/js/main.js'), 'utf8');

function sourceFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const entryPath = path.join(directory, entry.name);
        return entry.isDirectory() ? sourceFiles(entryPath) : [entryPath];
    });
}

assert.match(challenge, /function restoreResultFocus\(intent, generation\)/,
    'challenge results need an explicit, user-action-only focus restoration path');
assert.match(challenge, /render\(\);\s*restoreResultFocus\('run', runGeneration\);/,
    'run completion must restore focus after the result is rendered');
assert.match(challenge, /render\(\);\s*restoreResultFocus\('submit', generation\);/,
    'formal-submit completion must restore focus after the status is rendered');
assert.match(challenge, /generation !== challenge\.runGeneration/, 'stale repeated runs must not reclaim focus');
assert.match(challenge, /generation !== challenge\.submissionGeneration/, 'stale submissions must not reclaim focus');
assert.match(challenge, /#challenge-repair/, 'run completion must land on the repair action');
assert.match(challenge, /#challenge-submit:not\(\[disabled\]\).*#challenge-submission-status/s,
    'formal completion must prefer a next action and fall back to the semantic status');
assert.match(challenge, /id="challenge-submission-status"[^>]*tabindex="-1"/,
    'the formal result status must be programmatically focusable');
assert.match(challenge, /code\.addEventListener\('keydown',[\s\S]*event\.key === 'Enter'[\s\S]*run\(\)/,
    'Ctrl/Cmd+Enter must share the user-triggered run completion path');
assert.equal((challenge.match(/\.focus\(/g) || []).length, 2,
    'only result completion and the explicit repair action may move challenge focus');
assert.match(challenge, /#challenge-repair[\s\S]*requestAnimationFrame\(\(\) => root\.querySelector\('#challenge-code'\)\.focus\(\)\)/,
    'the existing repair action may keep its explicit editor focus behavior');
assert.match(challenge, /if \(generation !== challenge\.submissionGeneration \|\| challenge\.activeScopeKey !== stateKey\) return;/,
    'a prior formal submission or prior class/course scope must not overwrite a newer result');
assert.match(challenge, /previous && previous\.can_retry && typeof adapter\.refresh === 'function'/,
    'a budget-exhausted pending status must offer a direct formal re-query path');
assert.match(submissionAdapter, /signal: options && options\.signal/, 'the formal adapter must receive the challenge cancellation signal');
assert.match(submissionAdapter, /active_version\.resource_policy\.wall_time_ms/,
    'polling must derive its bounded window from the formal problem resource policy');
assert.match(submissionAdapter, /signal\r?\n\s*}\);/, 'poll requests must receive the same cancellation signal');
assert.doesNotMatch(submissionAdapter, /setInterval\(/, 'polling must not leave periodic timers behind');
assert.equal(fs.existsSync(path.join(codevisRoot, 'pages/home')), false,
    'the retired Code Space home page directory must not remain as an orphaned production asset');
assert.doesNotMatch(codevisIndex, /pages\/home|cv-page-home|data-page="home"|#home/,
    'the Code Space shell must not load or expose a retired home page');
assert.doesNotMatch(codevisMain, /register\('home'|CvHome/,
    'the Code Space router must not retain a retired home route');
for (const file of sourceFiles(codevisRoot)) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /pages\/home|CvHome|cv-page-home/,
        'no Code Space production source may reference retired home assets: ' + path.relative(root, file));
}

process.stdout.write('codevis-review-contract: re3 focus, re4 polling, re5 orphan-resource contracts ok\n');
