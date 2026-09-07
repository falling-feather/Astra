// ===== 数学页面逻辑 =====

// ===== 数学页面初始化 =====
function initMathematics() {
    initFunctionGraph();
}

// ===== 函数图像绘制（增强版：缩放/平移/多曲线） =====

const _fgColors = ['#5b8dce', '#e06c75', '#4d9e7e', '#c4793a', '#8b6fc0', '#d19a66'];
let _fgExtraCurves = []; // [{expr, fn, color}]
let _fgDrag = null;      // pan state

function _readGraphBounds() {
    return {
        xmin: parseFloat(document.getElementById('graph-xmin')?.value) || -10,
        xmax: parseFloat(document.getElementById('graph-xmax')?.value) || 10,
        ymin: parseFloat(document.getElementById('graph-ymin')?.value) || -5,
        ymax: parseFloat(document.getElementById('graph-ymax')?.value) || 5,
    };
}

function _writeGraphBounds(b) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = parseFloat(v.toPrecision(6)); };
    set('graph-xmin', b.xmin); set('graph-xmax', b.xmax);
    set('graph-ymin', b.ymin); set('graph-ymax', b.ymax);
}
function convertPower(expr) {
    // Convert a^b to Math.pow(a,b) by finding ^ and extracting base & exponent
    while (expr.indexOf('^') !== -1) {
        const idx = expr.indexOf('^');
        // Find base: walk backwards from ^
        let baseStart = idx - 1;
        if (expr[baseStart] === ')') {
            // Match closing paren backwards
            let depth = 1;
            baseStart--;
            while (baseStart >= 0 && depth > 0) {
                if (expr[baseStart] === ')') depth++;
                if (expr[baseStart] === '(') depth--;
                baseStart--;
            }
            baseStart++;
            // Include function name before (
            while (baseStart > 0 && /[a-zA-Z._]/.test(expr[baseStart - 1])) baseStart--;
        } else {
            while (baseStart > 0 && /[a-zA-Z0-9._]/.test(expr[baseStart - 1])) baseStart--;
        }
        // Find exponent: walk forward from ^
        let expEnd = idx + 1;
        // Skip leading minus in exponent
        if (expr[expEnd] === '-') expEnd++;
        if (expr[expEnd] === '(') {
            let depth = 1;
            expEnd++;
            while (expEnd < expr.length && depth > 0) {
                if (expr[expEnd] === '(') depth++;
                if (expr[expEnd] === ')') depth--;
                expEnd++;
            }
        } else {
            while (expEnd < expr.length && /[a-zA-Z0-9._]/.test(expr[expEnd])) expEnd++;
        }
        const base = expr.substring(baseStart, idx);
        const exp = expr.substring(idx + 1, expEnd);
        expr = expr.substring(0, baseStart) + 'Math.pow(' + base + ',' + exp + ')' + expr.substring(expEnd);
    }
    return expr;
}

function compileExpression(exprStr) {
    let s = exprStr.trim();
    if (!s) return null;

    // Convert ^ to Math.pow(base, exp)
    s = convertPower(s);

    // Replace math functions with Math.xxx
    const funcs = {
        sin: 'Math.sin', cos: 'Math.cos', tan: 'Math.tan',
        asin: 'Math.asin', acos: 'Math.acos', atan: 'Math.atan',
        abs: 'Math.abs', sqrt: 'Math.sqrt', cbrt: 'Math.cbrt',
        log: 'Math.log10', ln: 'Math.log', exp: 'Math.exp',
        floor: 'Math.floor', ceil: 'Math.ceil', round: 'Math.round',
        sign: 'Math.sign'
    };
    for (const [k, v] of Object.entries(funcs)) {
        s = s.replace(new RegExp('\\b' + k + '\\s*\\(', 'g'), v + '(');
    }

    // Replace constants
    s = s.replace(/\bpi\b/gi, 'Math.PI');
    // Replace standalone 'e' (not part of 'exp' or other words)
    s = s.replace(/(?<![a-zA-Z])e(?![a-zA-Z\(])/g, 'Math.E');

    // Defense-in-depth: explicit blocklist for dangerous identifiers
    if (/\b(eval|Function|constructor|__proto__|prototype|globalThis|window|document|this|import|require|fetch|XMLHttpRequest)\b/i.test(s)) return null;
    // Max length guard
    if (s.length > 500) return null;

    // Validate: after replacements, strip all allowed tokens, check nothing remains
    // Use \b after Math tokens to prevent partial matches (e.g. Math.Eval)
    const stripped = s
        .replace(/Math\.(sin|cos|tan|asin|acos|atan|abs|sqrt|cbrt|log10|log|exp|floor|ceil|round|sign|PI|E|pow|min|max)\b/g, '')
        .replace(/[x\d\s\+\-\*\/\(\)\.\,\%]/g, '');
    if (stripped.length > 0) return null;

    try {
        return new Function('x', '"use strict"; return (' + s + ')');
    } catch (e) {
        return null;
    }
}

function drawFunctionGraph() {
    const canvas = document.getElementById('function-graph-canvas');
    const errorEl = document.getElementById('graph-error');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    // Size canvas to container
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(Math.max(w * 0.6, 300));
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Read parameters
    const exprStr = (document.getElementById('func-expr')?.value || '').trim();
    const { xmin, xmax, ymin, ymax } = _readGraphBounds();
    const showGrid = document.getElementById('graph-grid')?.checked !== false;

    // Compile main expression
    const fn = compileExpression(exprStr);
    if (errorEl) errorEl.textContent = '';
    if (!fn && exprStr) {
        if (errorEl) errorEl.textContent = '⚠ 无法解析表达式';
    }

    // Build curve list: main + extras
    const curves = [];
    if (fn) curves.push({ fn, color: _fgColors[0], label: exprStr });
    _fgExtraCurves.forEach((c, i) => {
        if (c.fn) curves.push({ fn: c.fn, color: c.color || _fgColors[(i + 1) % _fgColors.length], label: c.expr });
    });

    // Drawing helpers
    const mapX = (x) => ((x - xmin) / (xmax - xmin)) * w;
    const mapY = (y) => ((ymax - y) / (ymax - ymin)) * h;

    // Background
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--surface-2').trim() || '#151822';
    ctx.fillRect(0, 0, w, h);

    // Grid
    if (showGrid) {
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1;
        const gridStep = niceStep(xmax - xmin);
        for (let gx = Math.ceil(xmin / gridStep) * gridStep; gx <= xmax; gx += gridStep) {
            const px = mapX(gx);
            ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
        }
        const gridStepY = niceStep(ymax - ymin);
        for (let gy = Math.ceil(ymin / gridStepY) * gridStepY; gy <= ymax; gy += gridStepY) {
            const py = mapY(gy);
            ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
        }
    }

    // Axes
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1.5;
    if (ymin <= 0 && ymax >= 0) {
        const ay = mapY(0);
        ctx.beginPath(); ctx.moveTo(0, ay); ctx.lineTo(w, ay); ctx.stroke();
    }
    if (xmin <= 0 && xmax >= 0) {
        const ax = mapX(0);
        ctx.beginPath(); ctx.moveTo(ax, 0); ctx.lineTo(ax, h); ctx.stroke();
    }

    // Axis labels
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '16px ' + CF.mono;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const labelStepX = niceStep(xmax - xmin);
    for (let lx = Math.ceil(xmin / labelStepX) * labelStepX; lx <= xmax; lx += labelStepX) {
        if (Math.abs(lx) < 1e-10) continue;
        const px = mapX(lx);
        const ay = ymin <= 0 && ymax >= 0 ? mapY(0) : h;
        ctx.fillText(formatNum(lx), px, Math.min(ay + 4, h - 14));
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const labelStepY = niceStep(ymax - ymin);
    for (let ly = Math.ceil(ymin / labelStepY) * labelStepY; ly <= ymax; ly += labelStepY) {
        if (Math.abs(ly) < 1e-10) continue;
        const py = mapY(ly);
        const ax = xmin <= 0 && xmax >= 0 ? mapX(0) : 0;
        ctx.fillText(formatNum(ly), Math.max(ax - 4, 40), py);
    }

    // Origin label
    if (xmin <= 0 && xmax >= 0 && ymin <= 0 && ymax >= 0) {
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText('0', mapX(0) - 4, mapY(0) + 4);
    }

    // Draw all curves
    curves.forEach(curve => {
        ctx.strokeStyle = curve.color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        let drawing = false;
        const steps = w * 2;
        for (let i = 0; i <= steps; i++) {
            const x = xmin + (xmax - xmin) * (i / steps);
            let y;
            try { y = curve.fn(x); } catch (e) { drawing = false; continue; }
            if (!isFinite(y) || isNaN(y)) { drawing = false; continue; }
            if (y < ymin - (ymax - ymin) * 2 || y > ymax + (ymax - ymin) * 2) {
                drawing = false;
                continue;
            }
            const px = mapX(x);
            const py = mapY(y);
            if (!drawing) { ctx.moveTo(px, py); drawing = true; }
            else ctx.lineTo(px, py);
        }
        ctx.stroke();
    });

    // Curve legend (when multiple)
    if (curves.length > 1) {
        ctx.font = '16px ' + CF.mono;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        curves.forEach((c, i) => {
            const ly = 10 + i * 18;
            ctx.fillStyle = c.color;
            ctx.fillRect(10, ly, 14, 3);
            ctx.fillText(c.label, 28, ly - 5);
        });
    }

    // Store mapping for mouse tracking
    canvas._graphState = { xmin, xmax, ymin, ymax, w, h };
}

function niceStep(range) {
    const rough = range / 8;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / mag;
    if (norm < 1.5) return mag;
    if (norm < 3.5) return 2 * mag;
    if (norm < 7.5) return 5 * mag;
    return 10 * mag;
}

function formatNum(n) {
    return Math.abs(n) >= 1000 || (Math.abs(n) < 0.01 && n !== 0)
        ? n.toExponential(1)
        : parseFloat(n.toPrecision(4)).toString();
}

function setFunction(expr, ev) {
    const el = document.getElementById('func-expr');
    if (el) {
        el.value = expr;
        drawFunctionGraph();
    }
    // Update active button state
    document.querySelectorAll('.preset-functions .btn--ghost').forEach(btn => btn.classList.remove('active'));
    if (ev && ev.target) ev.target.classList.add('active');
}

function initFunctionGraph() {
    const canvas = document.getElementById('function-graph-canvas');
    if (!canvas) return;

    // Coordinate tracking helper
    const trackCoord = (clientX, clientY) => {
        const state = canvas._graphState;
        if (!state) return;
        const rect = canvas.getBoundingClientRect();
        const mx = clientX - rect.left;
        const my = clientY - rect.top;
        const x = state.xmin + (mx / state.w) * (state.xmax - state.xmin);
        const y = state.ymax - (my / state.h) * (state.ymax - state.ymin);
        const coordEl = document.getElementById('graph-coord-display');
        if (coordEl) coordEl.textContent = `(${x.toFixed(2)}, ${y.toFixed(2)})`;
    };

    // Mouse tracking (only when not dragging)
    canvas.addEventListener('mousemove', (e) => {
        if (_fgDrag) return;
        trackCoord(e.clientX, e.clientY);
    });
    canvas.addEventListener('touchmove', (e) => {
        if (_fgDrag) return;
        const t = e.touches[0];
        if (t) trackCoord(t.clientX, t.clientY);
    }, { passive: true });
    canvas.addEventListener('mouseleave', () => {
        const coordEl = document.getElementById('graph-coord-display');
        if (coordEl) coordEl.textContent = '';
    });
    canvas.addEventListener('touchend', () => {
        const coordEl = document.getElementById('graph-coord-display');
        if (coordEl) coordEl.textContent = '';
    });

    // ── Zoom (wheel) ──
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const b = _readGraphBounds();
        const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
        const rect = canvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left) / rect.width;
        const my = (e.clientY - rect.top) / rect.height;
        const cx = b.xmin + (b.xmax - b.xmin) * mx;
        const cy = b.ymax - (b.ymax - b.ymin) * my;
        const rx = (b.xmax - b.xmin) * factor;
        const ry = (b.ymax - b.ymin) * factor;
        _writeGraphBounds({
            xmin: cx - rx * mx, xmax: cx + rx * (1 - mx),
            ymin: cy - ry * (1 - my), ymax: cy + ry * my
        });
        drawFunctionGraph();
    }, { passive: false });

    // ── Pan (left-click drag) ──
    canvas.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const b = _readGraphBounds();
        _fgDrag = { sx: e.clientX, sy: e.clientY, ...b };
        canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('mousemove', (e) => {
        if (!_fgDrag) return;
        const rect = canvas.getBoundingClientRect();
        const dx = (e.clientX - _fgDrag.sx) / rect.width * (_fgDrag.xmax - _fgDrag.xmin);
        const dy = (e.clientY - _fgDrag.sy) / rect.height * (_fgDrag.ymax - _fgDrag.ymin);
        _writeGraphBounds({
            xmin: _fgDrag.xmin - dx, xmax: _fgDrag.xmax - dx,
            ymin: _fgDrag.ymin + dy, ymax: _fgDrag.ymax + dy
        });
        drawFunctionGraph();
    });
    window.addEventListener('mouseup', () => {
        if (_fgDrag) { _fgDrag = null; canvas.style.cursor = ''; }
    });

    // ── Multi-curve controls injection ──
    _injectMultiCurveControls();

    // ResizeObserver
    if (typeof ResizeObserver !== 'undefined') {
        window._functionGraphRO = new ResizeObserver(() => drawFunctionGraph());
        window._functionGraphRO.observe(canvas.parentElement);
    } else {
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(drawFunctionGraph, 150);
        });
    }

    // Initial draw
    drawFunctionGraph();
}

// ── Multi-curve controls ──
function _injectMultiCurveControls() {
    const wrap = document.querySelector('.graph-controls');
    if (!wrap || document.getElementById('fg-multi-curves')) return;

    const container = document.createElement('div');
    container.id = 'fg-multi-curves';
    container.className = 'fg-multi-curves';

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn--ghost btn--sm';
    addBtn.textContent = '+ 添加曲线';
    addBtn.onclick = () => _addExtraCurve(container);
    container.appendChild(addBtn);

    const hint = document.createElement('div');
    hint.className = 'fg-hint';
    hint.textContent = '💡 滚轮缩放 · 拖拽平移';
    container.appendChild(hint);

    wrap.appendChild(container);
}

function _addExtraCurve(container) {
    if (_fgExtraCurves.length >= 5) return;
    const idx = _fgExtraCurves.length;
    const color = _fgColors[(idx + 1) % _fgColors.length];
    const entry = { expr: '', fn: null, color };
    _fgExtraCurves.push(entry);

    const row = document.createElement('div');
    row.className = 'fg-curve-row';
    row.innerHTML = `<span class="fg-curve-dot" style="background:${color}"></span>` +
        `<input type="text" class="input fg-curve-input" placeholder="表达式…">` +
        `<button class="btn btn--ghost btn--sm fg-curve-remove">✕</button>`;

    const input = row.querySelector('input');
    input.addEventListener('input', () => {
        entry.expr = input.value;
        entry.fn = compileExpression(input.value);
        drawFunctionGraph();
    });
    row.querySelector('.fg-curve-remove').addEventListener('click', () => {
        const i = _fgExtraCurves.indexOf(entry);
        if (i >= 0) _fgExtraCurves.splice(i, 1);
        row.remove();
        drawFunctionGraph();
    });

    // Insert before the add button
    container.insertBefore(row, container.firstChild);
}

function destroyFunctionGraph() {
    if (window._functionGraphRO) {
        window._functionGraphRO.disconnect();
        window._functionGraphRO = null;
    }
}

// 导出全局
window.drawFunctionGraph = drawFunctionGraph;
window.setFunction = setFunction;
window.initFunctionGraph = initFunctionGraph;
window.destroyFunctionGraph = destroyFunctionGraph;

