const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
    loadContract,
    loadCandidate,
    validateJourneyReport,
    runJourney
} = require('../browser/check-new-experiment-journey.cjs');

const root = path.resolve(__dirname, '../..');
const templateRoot = path.join(root, 'tools/templates/new-experiment');
const contractFile = path.join(templateRoot, 'browser-journey.contract.json');
const readTemplate = (name) => fs.readFileSync(path.join(templateRoot, name), 'utf8');
const contract = loadContract(contractFile);

assert.equal(contract.schema_version, 1);
assert.equal(contract.task, 'EXT-07');
assert.equal(contract.version, 'V8.2.6');
assert.equal(contract.scope, 'new-experiment-only');
assert.equal(contract.production_registration, false);
assert.deepEqual(
    contract.viewports.map((profile) => (
        profile.name
        + ':'
        + profile.width
        + 'x'
        + profile.height
        + ':'
        + String(profile.reduced_motion)
    )),
    [
        'desktop:1440x900:false',
        'mobile:390x844:false',
        'reduced-motion:1440x900:true'
    ]
);
assert.deepEqual(contract.required_checks, [
    'enter',
    'first-draw',
    'operate',
    'mode-control',
    'reset',
    'horizontal-overflow',
    'leave-release',
    're-enter',
    'console-clean'
]);
assert.deepEqual(contract.mobile_checks, ['drawer-toggle', 'touch-targets']);
assert.equal(contract.minimum_touch_target_px, 44);
assert.deepEqual(contract.operation, {
    parameter_value: 72,
    reentry_parameter_value: 64,
    reset_parameter_value: 50
});
assert.equal(contract.resource_release.active_animation_frames, 0);
assert.equal(contract.resource_release.active_resize_observers, 0);
assert.equal(contract.console_policy.request_failures, 0);
assert.equal(contract.console_policy.http_errors, 0);
assert.equal(contract.evidence.required_screenshots.length, 3);
assert.match(contract.old_activity_policy, /Existing activities are not mounted/);

const replacements = Object.freeze({
    __SUBJECT__: 'physics',
    __EXPERIMENT_ID__: 'browser-journey-probe',
    __EXPERIMENT_TITLE__: '新增实验浏览器旅程探针',
    __OWNER__: 'BrowserJourneyProbe',
    __NAMESPACE__: 'browser-journey-probe',
    __ASSET_VERSION__: '20260824v826Ext07P0',
    __PARAMETER_LABEL__: '位移',
    __PARAMETER_UNIT__: 'm',
    __PRIMARY_LEGEND__: '运动对象',
    __SECONDARY_LEGEND__: '参考位置',
    __ACCENT_TOKEN__: '--accent-purple',
    __ACCENT_RGB__: '139, 111, 192',
    __PREVIEW_ALT__: '青色质点随位移参数移动并显示相对参考位置的实时变化'
});
const render = (source) => Object.entries(replacements).reduce(
    (result, [token, value]) => result.split(token).join(value),
    source
);

const productionFiles = [
    'shared/js/config.js',
    'shared/js/experiment-registry.js',
    'index.html',
    'sw.js'
].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
assert.doesNotMatch(productionFiles, /browser-journey-probe/);

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-ext07-journey-'));

(async () => {
    try {
        const candidateDirectory = path.join(
            temporaryRoot,
            'pages/physics/browser-journey-probe'
        );
        const evidenceDirectory = process.env.ASTRA_EXT07_EVIDENCE_OUT
            ? path.resolve(process.env.ASTRA_EXT07_EVIDENCE_OUT)
            : path.join(temporaryRoot, 'evidence');
        fs.mkdirSync(candidateDirectory, { recursive: true });
        const moduleMarkup = render(readTemplate('module.html.tpl')).replace(
            '</section>',
            '<img src="./asset-probe.svg" alt="" width="1" height="1" aria-hidden="true">\n</section>'
        );
        fs.writeFileSync(path.join(candidateDirectory, 'module.html'), moduleMarkup);
        fs.writeFileSync(
            path.join(candidateDirectory, 'asset-probe.svg'),
            '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path fill="#73e0ff" d="M0 0h1v1H0z"/></svg>'
        );
        fs.writeFileSync(
            path.join(candidateDirectory, 'styles.css'),
            render(readTemplate('styles.css.tpl'))
        );
        fs.writeFileSync(
            path.join(candidateDirectory, 'index.js'),
            render(readTemplate('index.js.tpl'))
        );
        const manifest = JSON.parse(render(readTemplate('manifest.json.tpl')));
        const manifestFile = path.join(candidateDirectory, 'manifest.json');
        fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');

        const candidate = loadCandidate({
            root: temporaryRoot,
            manifest: manifestFile
        });
        assert.equal(candidate.manifest.activity_key, 'physics.browser-journey-probe');
        assert.equal(candidate.moduleFile, path.join(candidateDirectory, 'module.html'));
        assert.throws(
            () => loadCandidate({
                root: temporaryRoot,
                manifest: path.join(candidateDirectory, 'missing.json')
            }),
            /ENOENT/
        );
        fs.writeFileSync(path.join(temporaryRoot, 'outside.css'), '.outside {}');
        const outsideManifestFile = path.join(candidateDirectory, 'outside-manifest.json');
        fs.writeFileSync(
            outsideManifestFile,
            JSON.stringify({
                ...manifest,
                style: 'outside.css?v=20260824v826Ext07P0'
            }, null, 2)
        );
        assert.throws(
            () => loadCandidate({
                root: temporaryRoot,
                manifest: outsideManifestFile
            }),
            /must stay inside the candidate directory/
        );

        const result = await runJourney({
            root: temporaryRoot,
            manifest: manifestFile,
            out: evidenceDirectory
        });
        assert.equal(result.report.ok, true, JSON.stringify(result.validation.errors, null, 2));
        assert.equal(result.report.harness, 'isolated-candidate');
        assert.equal(result.report.production_registration, false);
        assert.equal(result.report.runs.length, 3);
        assert.equal(result.validation.ok, true);
        assert.ok(fs.existsSync(result.reportPath));
        for (const run of result.report.runs) {
            assert.equal(run.ok, true, JSON.stringify(run.checks, null, 2));
            assert.equal(run.console.length, 0);
            assert.equal(run.page_errors.length, 0);
            assert.equal(run.network_failures.length, 0);
            assert.ok(
                fs.existsSync(path.join(evidenceDirectory, run.screenshot)),
                run.screenshot
            );
            const required = contract.required_checks.concat(
                run.name === 'mobile' ? contract.mobile_checks : []
            );
            for (const id of required) {
                assert.equal(
                    run.checks.find((check) => check.id === id)?.ok,
                    true,
                    run.name + ' must pass ' + id
                );
            }
            const release = run.checks.find((check) => check.id === 'leave-release');
            assert.equal(release.evidence.signalAborted, true);
            assert.equal(release.evidence.moduleRemoved, true);
            assert.equal(release.evidence.metrics.activeAnimationFrames, 0);
            assert.equal(release.evidence.metrics.activeResizeObservers, 0);
        }

        const mobile = result.report.runs.find((run) => run.name === 'mobile');
        assert.equal(mobile.viewport.width, 390);
        assert.equal(mobile.viewport.height, 844);
        assert.equal(
            mobile.checks.find((check) => check.id === 'drawer-toggle').ok,
            true
        );
        assert.equal(
            mobile.checks.find((check) => check.id === 'touch-targets').ok,
            true
        );
        const reduced = result.report.runs.find((run) => run.name === 'reduced-motion');
        assert.equal(reduced.reduced_motion, true);
        assert.equal(
            reduced.checks.find((check) => check.id === 'mode-control').evidence
                .metrics.activeAnimationFrames,
            0
        );

        const validated = validateJourneyReport(result.report, {
            contract,
            manifest,
            checkFiles: true,
            evidenceRoot: evidenceDirectory
        });
        assert.equal(validated.ok, true, JSON.stringify(validated.errors, null, 2));

        const tampered = JSON.parse(JSON.stringify(result.report));
        tampered.runs.find((run) => run.name === 'desktop')
            .checks.find((check) => check.id === 'reset').ok = false;
        const tamperedValidation = validateJourneyReport(tampered, {
            contract,
            manifest,
            checkFiles: true,
            evidenceRoot: evidenceDirectory
        });
        assert.equal(tamperedValidation.ok, false);
        assert.ok(tamperedValidation.errors.some((error) => error.code === 'check_failed'));

        const cli = spawnSync(
            process.execPath,
            [
                path.join(root, 'tools/browser/check-new-experiment-journey.cjs'),
                '--validate-report',
                result.reportPath,
                '--manifest',
                manifestFile,
                '--root',
                temporaryRoot,
                '--contract',
                contractFile
            ],
            {
                cwd: root,
                encoding: 'utf8',
                windowsHide: true,
                env: process.env
            }
        );
        assert.equal(cli.status, 0, cli.stderr);
        const cliResult = JSON.parse(cli.stdout);
        assert.equal(cliResult.ok, true);

        console.log(
            'new-experiment-browser-journey-contract: EXT-07 desktop, mobile, reduced-motion and lifecycle PASS'
        );
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
})().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
