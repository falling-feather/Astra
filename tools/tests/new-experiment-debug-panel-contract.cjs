const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
    loadDebugContract,
    runJourney
} = require('../browser/check-new-experiment-journey.cjs');

const root = path.resolve(__dirname, '../..');
const templateRoot = path.join(root, 'tools/templates/new-experiment');
const contractFile = path.join(templateRoot, 'debug-panel.contract.json');
const readTemplate = (name) => fs.readFileSync(path.join(templateRoot, name), 'utf8');
const contract = loadDebugContract(contractFile);

assert.equal(contract.schema_version, 1);
assert.equal(contract.task, 'EXT-08');
assert.equal(contract.version, 'V8.2.7');
assert.equal(contract.scope, 'new-experiment-only');
assert.equal(contract.delivery, 'development-tool-only');
assert.equal(contract.production_registration, false);
assert.equal(contract.default_enabled, false);
assert.equal(contract.activation.cli_flag, '--debug');
assert.equal(
    contract.activation.script_request,
    '/__astra_new_experiment_debug_panel.js?v=V8.2.7'
);
assert.deepEqual(contract.provider, {
    method: 'debugSnapshot',
    polling: false,
    dom_nodes: 0,
    timers: 0,
    network_requests: 0,
    mutable_owner_references: false
});
assert.equal(contract.refresh_interval_ms, 250);
assert.equal(contract.maximum_refresh_hz, 4);
assert.deepEqual(contract.required_sections, [
    '运行状态',
    '模型变量',
    '模拟步长',
    '帧率',
    '资源数量',
    '画布尺寸'
]);
assert.deepEqual(contract.required_snapshot_fields, [
    'state',
    'model',
    'timing.last_step_seconds',
    'timing.frames_per_second',
    'resources.animation_frames',
    'resources.resize_observers',
    'resources.control_scopes',
    'resources.canvas_bitmap'
]);
assert.deepEqual(contract.off_mode, {
    script_requests: 0,
    global_export: false,
    panel_nodes: 0,
    panel_timers: 0
});
assert.equal(contract.on_mode.script_requests, 1);
assert.equal(contract.on_mode.panel_nodes, 1);
assert.equal(contract.on_mode.model_updates_after_operation, true);
assert.equal(contract.on_mode.reduced_motion_fps, 0);
assert.equal(contract.responsive.minimum_action_height_px, 44);
assert.equal(contract.cleanup.destroy_on_candidate_leave, true);
assert.equal(contract.cleanup.panel_nodes_after_destroy, 0);
assert.equal(contract.cleanup.panel_timers_after_destroy, 0);
assert.match(contract.content_policy, /developer instrument/);
assert.match(contract.old_activity_policy, /never be linked from existing activity pages/);

const templateContract = JSON.parse(readTemplate('template.contract.json'));
assert.equal(templateContract.debug_panel_contract, 'debug-panel.contract.json');
assert.equal(templateContract.debug_panel_command, contract.activation.interactive_command);
assert.ok(!templateContract.required_files.includes('debug-panel.contract.json'));

const runtimeTemplate = readTemplate('index.js.tpl');
assert.match(runtimeTemplate, /debugSnapshot\(\)/);
assert.match(runtimeTemplate, /last_step_seconds/);
assert.match(runtimeTemplate, /canvas_bitmap/);
assert.doesNotMatch(
    runtimeTemplate,
    /AstraNewExperimentDebugPanel|astra-new-experiment-debug-panel|__astra_new_experiment_debug_panel|setInterval/
);

const panelSource = fs.readFileSync(
    path.join(root, 'tools/browser/new-experiment-debug-panel.js'),
    'utf8'
);
assert.match(panelSource, /const PANEL_ID = 'astra-new-experiment-debug-panel'/);
assert.match(panelSource, /const REFRESH_INTERVAL_MS = 250/);
assert.match(panelSource, /attachShadow\(\{ mode: 'open' \}\)/);
assert.match(panelSource, /window\.setInterval\(render, REFRESH_INTERVAL_MS\)/);
assert.match(panelSource, /window\.clearInterval\(timer\)/);
assert.match(panelSource, /window\.AstraNewExperimentDebugPanel = Object\.freeze/);
assert.match(panelSource, /developer only/);
for (const section of contract.required_sections) {
    assert.match(panelSource, new RegExp('<h3>' + section + '</h3>'));
}

const productionFiles = [
    'index.html',
    'sw.js',
    'shared/js/config.js',
    'shared/js/experiment-registry.js'
].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
assert.doesNotMatch(
    productionFiles,
    /AstraNewExperimentDebugPanel|astra-new-experiment-debug-panel|__astra_new_experiment_debug_panel/
);

const replacements = Object.freeze({
    __SUBJECT__: 'physics',
    __EXPERIMENT_ID__: 'debug-panel-probe',
    __EXPERIMENT_TITLE__: '新增实验调试面板探针',
    __OWNER__: 'DebugPanelProbe',
    __NAMESPACE__: 'debug-panel-probe',
    __ASSET_VERSION__: '20260824v827Ext08P0',
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

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-ext08-debug-'));
const evidenceRoot = process.env.ASTRA_EXT08_EVIDENCE_OUT
    ? path.resolve(process.env.ASTRA_EXT08_EVIDENCE_OUT)
    : temporaryRoot;

const findCheck = (run, id) => {
    const check = run.checks.find((entry) => entry.id === id);
    assert.ok(check, run.name + ' must include ' + id);
    return check;
};

const assertRelease = (release, debugExported) => {
    assert.equal(release.signalAborted, true);
    assert.equal(release.moduleRemoved, true);
    assert.equal(release.metrics.activeAnimationFrames, 0);
    assert.equal(release.metrics.activeResizeObservers, 0);
    assert.equal(release.debugPanel.exported, debugExported);
    assert.equal(release.debugPanel.panelNodes, 0);
    if (debugExported) {
        assert.equal(release.debugPanel.status.mounted, false);
        assert.equal(release.debugPanel.status.timerActive, false);
    } else {
        assert.equal(release.debugPanel.status, null);
    }
};

(async () => {
    try {
        const candidateDirectory = path.join(
            temporaryRoot,
            'pages/physics/debug-panel-probe'
        );
        fs.mkdirSync(candidateDirectory, { recursive: true });
        fs.writeFileSync(
            path.join(candidateDirectory, 'module.html'),
            render(readTemplate('module.html.tpl'))
        );
        fs.writeFileSync(
            path.join(candidateDirectory, 'styles.css'),
            render(readTemplate('styles.css.tpl'))
        );
        fs.writeFileSync(
            path.join(candidateDirectory, 'index.js'),
            render(runtimeTemplate)
        );
        const manifest = JSON.parse(render(readTemplate('manifest.json.tpl')));
        const manifestFile = path.join(candidateDirectory, 'manifest.json');
        fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');

        await assert.rejects(
            runJourney({
                root: temporaryRoot,
                manifest: manifestFile,
                debugHoldMs: 1
            }),
            /--debug-hold requires --debug/
        );

        const offDirectory = path.join(evidenceRoot, 'off');
        const off = await runJourney({
            root: temporaryRoot,
            manifest: manifestFile,
            out: offDirectory
        });
        assert.equal(off.report.ok, true, JSON.stringify(off.validation.errors, null, 2));
        assert.equal(off.report.debug_mode, false);
        assert.equal(off.report.debug_contract, null);
        for (const run of off.report.runs) {
            assert.equal(run.ok, true, JSON.stringify(run.checks, null, 2));
            assert.equal(run.debug_mode, false);
            assert.equal(run.debug_script_requests, contract.off_mode.script_requests);
            assert.equal(findCheck(run, 'debug-off').ok, true);
            assert.equal(run.checks.some((check) => check.id === 'debug-panel'), false);
            assertRelease(findCheck(run, 'leave-release').evidence, false);
            assert.equal(findCheck(run, 'final-release').ok, true);
            assertRelease(run.final_release, false);
            assert.ok(fs.existsSync(path.join(offDirectory, run.screenshot)));
            assert.doesNotMatch(run.screenshot, /-debug\.png$/);
        }

        const onDirectory = path.join(evidenceRoot, 'on');
        const on = await runJourney({
            root: temporaryRoot,
            manifest: manifestFile,
            out: onDirectory,
            debug: true,
            debugContractFile: contractFile
        });
        assert.equal(on.report.ok, true, JSON.stringify({
            validation: on.validation.errors,
            runs: on.report.runs.map((run) => ({
                name: run.name,
                checks: run.checks.filter((check) => !check.ok),
                console: run.console,
                page_errors: run.page_errors,
                network_failures: run.network_failures
            }))
        }, null, 2));
        assert.equal(on.report.debug_mode, true);
        assert.deepEqual(on.report.debug_contract, {
            task: 'EXT-08',
            version: 'V8.2.7',
            delivery: 'development-tool-only'
        });
        for (const run of on.report.runs) {
            assert.equal(run.ok, true, JSON.stringify(run.checks, null, 2));
            assert.equal(run.debug_mode, true);
            assert.equal(run.debug_script_requests, contract.on_mode.script_requests);
            assert.equal(run.console.length, 0);
            assert.equal(run.page_errors.length, 0);
            assert.equal(run.network_failures.length, 0);
            const debug = findCheck(run, 'debug-panel');
            assert.equal(debug.ok, true, JSON.stringify(debug.evidence, null, 2));
            assert.equal(debug.evidence.panel.status.mounted, true);
            assert.equal(debug.evidence.panel.status.timerActive, true);
            assert.equal(debug.evidence.panel.panelCount, 1);
            assert.deepEqual(debug.evidence.panel.sections, contract.required_sections);
            assert.equal(debug.evidence.panel.snapshot.model.parameter, 72);
            assert.equal(debug.evidence.panel.snapshot.resources.resize_observers, 1);
            assert.equal(debug.evidence.panel.snapshot.resources.control_scopes, 1);
            assert.ok(debug.evidence.panel.snapshot.resources.canvas_bitmap.width > 0);
            assert.ok(debug.evidence.panel.snapshot.resources.canvas_bitmap.height > 0);
            assert.equal(debug.evidence.hostWithinViewport, true);
            assertRelease(findCheck(run, 'leave-release').evidence, true);
            const reentry = findCheck(run, 're-enter');
            assert.equal(reentry.ok, true, JSON.stringify(reentry.evidence, null, 2));
            assert.equal(reentry.evidence.debugRemounted, true);
            assert.equal(reentry.evidence.debugPanel.snapshot.model.parameter, 64);
            assert.equal(reentry.evidence.debugPanel.status.timerActive, true);
            assert.equal(findCheck(run, 'final-release').ok, true);
            assertRelease(run.final_release, true);
            assert.equal(
                run.debug_before_screenshot.snapshot.model.parameter,
                50
            );
            assert.equal(
                run.debug_before_screenshot.snapshot.state,
                run.reduced_motion ? 'reduced-motion' : 'running'
            );
            assert.match(run.screenshot, /-debug\.png$/);
            assert.ok(fs.existsSync(path.join(onDirectory, run.screenshot)));

            const timing = debug.evidence.panel.snapshot.timing;
            if (run.reduced_motion) {
                assert.equal(debug.evidence.panel.snapshot.state, 'reduced-motion');
                assert.equal(timing.frames_per_second, contract.on_mode.reduced_motion_fps);
                assert.equal(timing.last_step_seconds, 0);
                assert.equal(
                    debug.evidence.panel.snapshot.resources.animation_frames,
                    0
                );
            } else {
                assert.equal(debug.evidence.panel.snapshot.state, 'running');
                assert.ok(timing.frames_per_second > 0);
                assert.ok(timing.last_step_seconds > 0);
                assert.ok(debug.evidence.panel.snapshot.resources.animation_frames > 0);
            }
        }

        const mobile = on.report.runs.find((run) => run.name === 'mobile');
        const mobileEvidence = findCheck(mobile, 'debug-panel').evidence;
        assert.equal(mobileEvidence.mobileLayoutOk, true);
        assert.ok(
            mobileEvidence.panel.layout.closeButton.width
                >= contract.responsive.minimum_action_height_px
        );
        assert.ok(
            mobileEvidence.panel.layout.closeButton.height
                >= contract.responsive.minimum_action_height_px
        );
        assert.equal(mobileEvidence.panel.layout.panelScrollable, true);

        const help = spawnSync(
            process.execPath,
            [path.join(root, 'tools/browser/check-new-experiment-journey.cjs'), '--help'],
            { cwd: root, encoding: 'utf8', windowsHide: true }
        );
        assert.equal(help.status, 0, help.stderr);
        assert.match(help.stdout, /--debug \[--headed\] \[--debug-hold/);

        console.log(
            'new-experiment-debug-panel-contract: EXT-08 off/on, responsive metrics and cleanup PASS'
        );
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
})().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
