(() => {
    'use strict';

    const PANEL_ID = 'astra-new-experiment-debug-panel';
    const REFRESH_INTERVAL_MS = 250;
    const MAX_MODEL_ROWS = 12;

    let host = null;
    let shadow = null;
    let timer = 0;
    let lifecycle = null;
    let ownerName = '';
    let updates = 0;
    let latest = null;

    const finite = (value, fallback = 0) => (
        Number.isFinite(Number(value)) ? Number(value) : fallback
    );

    const clone = (value) => {
        if (value === undefined) return null;
        return JSON.parse(JSON.stringify(value));
    };

    const formatNumber = (value, digits = 2) => {
        const number = finite(value, Number.NaN);
        return Number.isFinite(number) ? number.toFixed(digits) : '—';
    };

    const ownerDiagnostics = (owner) => {
        if (!owner) return null;
        if (typeof owner.debugSnapshot === 'function') {
            return owner.debugSnapshot();
        }
        return {
            state: owner.root?.dataset?.state || (owner.root ? 'mounted' : 'detached'),
            model: typeof owner.snapshot === 'function' ? owner.snapshot() : {},
            timing: { last_step_seconds: 0, maximum_step_seconds: 0 },
            resources: {
                animation_frames: owner.frame ? 1 : 0,
                resize_observers: owner.resizeObserver ? 1 : 0,
                control_scopes: owner.controls ? 1 : 0,
                canvas_bitmap: {
                    width: owner.canvas?.width || 0,
                    height: owner.canvas?.height || 0
                }
            }
        };
    };

    const inspect = () => {
        const owner = ownerName ? window[ownerName] : null;
        const diagnostics = ownerDiagnostics(owner);
        const harness = window.__newExperimentAcceptance?.debugMetrics?.() || {};
        const canvas = owner?.canvas || null;
        const rect = canvas?.getBoundingClientRect?.() || null;
        const model = diagnostics?.model && typeof diagnostics.model === 'object'
            ? diagnostics.model
            : {};
        return {
            mounted: Boolean(owner?.root),
            owner: ownerName,
            state: diagnostics?.state || 'owner-unavailable',
            model: clone(model),
            timing: {
                last_step_seconds: finite(diagnostics?.timing?.last_step_seconds),
                maximum_step_seconds: finite(diagnostics?.timing?.maximum_step_seconds),
                frame_interval_ms: finite(harness.lastFrameIntervalMs),
                frames_per_second: finite(harness.framesPerSecond)
            },
            resources: {
                animation_frames: finite(
                    harness.activeAnimationFrames,
                    diagnostics?.resources?.animation_frames || 0
                ),
                resize_observers: finite(
                    harness.activeResizeObservers,
                    diagnostics?.resources?.resize_observers || 0
                ),
                control_scopes: finite(diagnostics?.resources?.control_scopes),
                canvas_bitmap: {
                    width: finite(diagnostics?.resources?.canvas_bitmap?.width),
                    height: finite(diagnostics?.resources?.canvas_bitmap?.height)
                },
                canvas_css: {
                    width: finite(rect?.width),
                    height: finite(rect?.height)
                }
            },
            sampled_at: new Date().toISOString()
        };
    };

    const setText = (selector, value) => {
        const node = shadow?.querySelector(selector);
        if (node) node.textContent = String(value);
    };

    const renderModel = (model) => {
        const body = shadow?.querySelector('[data-debug-model]');
        if (!body) return;
        body.replaceChildren();
        const entries = Object.entries(model || {}).slice(0, MAX_MODEL_ROWS);
        if (!entries.length) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = 2;
            cell.textContent = '当前 owner 未提供模型变量';
            row.append(cell);
            body.append(row);
            return;
        }
        for (const [key, value] of entries) {
            const row = document.createElement('tr');
            const name = document.createElement('th');
            const output = document.createElement('td');
            name.scope = 'row';
            name.textContent = key;
            output.textContent = typeof value === 'number'
                ? String(Math.round(value * 10000) / 10000)
                : String(value);
            row.append(name, output);
            body.append(row);
        }
    };

    const render = () => {
        latest = inspect();
        updates += 1;
        if (!shadow) return latest;
        const state = shadow.querySelector('[data-debug-state]');
        if (state) {
            state.textContent = latest.state;
            state.dataset.state = latest.state;
        }
        setText(
            '[data-debug-step]',
            formatNumber(latest.timing.last_step_seconds * 1000, 2) + ' ms'
        );
        setText(
            '[data-debug-fps]',
            formatNumber(latest.timing.frames_per_second, 1) + ' fps'
        );
        setText(
            '[data-debug-raf]',
            String(latest.resources.animation_frames)
        );
        setText(
            '[data-debug-observers]',
            String(latest.resources.resize_observers)
        );
        setText(
            '[data-debug-controls]',
            String(latest.resources.control_scopes)
        );
        setText(
            '[data-debug-bitmap]',
            latest.resources.canvas_bitmap.width
                + ' × '
                + latest.resources.canvas_bitmap.height
        );
        setText(
            '[data-debug-css-size]',
            Math.round(latest.resources.canvas_css.width)
                + ' × '
                + Math.round(latest.resources.canvas_css.height)
        );
        setText('[data-debug-updates]', String(updates));
        renderModel(latest.model);
        return latest;
    };

    const destroy = () => {
        if (timer) window.clearInterval(timer);
        timer = 0;
        lifecycle?.abort();
        lifecycle = null;
        host?.remove();
        host = null;
        shadow = null;
        ownerName = '';
    };

    const mount = (options = {}) => {
        destroy();
        ownerName = String(options.ownerName || '');
        if (!ownerName || !window[ownerName]) return false;

        host = document.createElement('aside');
        host.id = PANEL_ID;
        host.dataset.newExperimentDebugPanel = 'true';
        host.dataset.debugOnly = 'true';
        host.setAttribute('aria-label', '新增实验开发调试面板');
        shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = [
            '<style>',
            ':host{position:fixed;z-index:2147483000;top:12px;right:12px;width:min(340px,calc(100vw - 24px));max-height:calc(100vh - 24px);color:#dfe8ff;font:13px/1.45 Inter,"Microsoft YaHei",sans-serif;pointer-events:auto}',
            '*{box-sizing:border-box}',
            '.panel{overflow:auto;max-height:inherit;border:1px solid rgba(115,224,255,.42);border-radius:10px;background:rgba(5,10,20,.96);box-shadow:0 18px 60px rgba(0,0,0,.48);backdrop-filter:blur(14px)}',
            'header{position:sticky;top:0;z-index:1;display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:12px;border-bottom:1px solid rgba(255,255,255,.1);background:rgba(5,10,20,.98)}',
            'h2,p,dl{margin:0}',
            'h2{font-size:15px;letter-spacing:.04em}',
            '.eyebrow{margin-bottom:2px;color:#73e0ff;font-size:11px;text-transform:uppercase}',
            'button{min-width:44px;min-height:44px;padding:8px 10px;border:1px solid rgba(255,255,255,.16);border-radius:6px;color:#dfe8ff;background:#151d30;cursor:pointer}',
            'button:focus-visible{outline:2px solid #73e0ff;outline-offset:2px}',
            '.body{display:grid;gap:12px;padding:12px}',
            'section{display:grid;gap:7px;padding:10px;border:1px solid rgba(255,255,255,.08);border-radius:7px;background:rgba(255,255,255,.025)}',
            'h3{margin:0;color:#aebfe0;font-size:12px;font-weight:600}',
            '.state{justify-self:start;padding:3px 7px;border-radius:999px;color:#73e0ff;background:rgba(115,224,255,.12)}',
            '.state[data-state="paused"],.state[data-state="reduced-motion"]{color:#f2b56b;background:rgba(242,181,107,.12)}',
            'dl{display:grid;grid-template-columns:1fr auto;gap:5px 10px}',
            'dt{color:#91a0bd}',
            'dd{margin:0;color:#f0f4ff;font-variant-numeric:tabular-nums}',
            'table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}',
            'th,td{padding:4px 0;border-bottom:1px solid rgba(255,255,255,.06);text-align:left;overflow-wrap:anywhere}',
            'th{width:48%;color:#91a0bd;font-weight:500}',
            'td{color:#f0f4ff}',
            'footer{padding:0 12px 12px;color:#75839e;font-size:11px}',
            '@media(max-width:760px){:host{top:auto;right:8px;bottom:8px;left:8px;width:auto;max-height:min(46vh,420px)}.panel{border-radius:10px}}',
            '@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;animation:none!important;transition:none!important}}',
            '</style>',
            '<div class="panel">',
            '<header>',
            '<div><p class="eyebrow">developer only · 250 ms</p><h2>新增实验开发调试</h2></div>',
            '<button type="button" data-debug-close aria-label="关闭开发调试面板">关闭</button>',
            '</header>',
            '<div class="body">',
            '<section><h3>运行状态</h3><output class="state" data-debug-state>读取中</output></section>',
            '<section><h3>模型变量</h3><table><tbody data-debug-model></tbody></table></section>',
            '<section><h3>模拟步长</h3><dl><dt>最近步长</dt><dd data-debug-step>—</dd><dt>步长上限</dt><dd>50.00 ms</dd></dl></section>',
            '<section><h3>帧率</h3><dl><dt>实时采样</dt><dd data-debug-fps>—</dd></dl></section>',
            '<section><h3>资源数量</h3><dl><dt>活跃 rAF</dt><dd data-debug-raf>0</dd><dt>ResizeObserver</dt><dd data-debug-observers>0</dd><dt>控制作用域</dt><dd data-debug-controls>0</dd></dl></section>',
            '<section><h3>画布尺寸</h3><dl><dt>bitmap</dt><dd data-debug-bitmap>0 × 0</dd><dt>CSS</dt><dd data-debug-css-size>0 × 0</dd></dl></section>',
            '</div>',
            '<footer>本地采样 <span data-debug-updates>0</span> 次；不进入生产、课程或竞赛画面。</footer>',
            '</div>'
        ].join('');
        document.body.append(host);

        lifecycle = new AbortController();
        shadow.querySelector('[data-debug-close]')?.addEventListener(
            'click',
            destroy,
            { signal: lifecycle.signal }
        );
        window.addEventListener('pagehide', destroy, {
            once: true,
            signal: lifecycle.signal
        });
        updates = 0;
        render();
        timer = window.setInterval(render, REFRESH_INTERVAL_MS);
        return true;
    };

    window.AstraNewExperimentDebugPanel = Object.freeze({
        version: 'V8.2.7',
        refreshIntervalMs: REFRESH_INTERVAL_MS,
        mount,
        destroy,
        refresh: render,
        snapshot: () => clone(latest),
        status: () => Object.freeze({
            mounted: Boolean(host?.isConnected),
            timerActive: Boolean(timer),
            ownerName,
            updates
        })
    });
})();
