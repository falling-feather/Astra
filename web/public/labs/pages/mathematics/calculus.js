// ===== 微积分可视化 (v2 — Riemann 和 · Taylor 级数 · 临界点) =====

const Calculus = {
    canvas: null,
    ctx: null,
    _listeners: [],
    // ── state ──
    expr: 'sin(x)',
    fn: null,
    mode: 'derivative',        // 'derivative' | 'integral' | 'taylor'
    param: 0,                  // x-position for tangent / integral upper bound / Taylor centre
    xmin: -8, xmax: 8,
    ymin: -3, ymax: 3,
    animating: false,
    animId: null,
    showFunction: true,
    showDerivative: true,
    // integral sub-options
    riemannN: 20,              // number of rectangles
    riemannType: 'left',       // 'left' | 'right' | 'mid' | 'trapezoid' | 'none'
    // taylor sub-options
    taylorDeg: 5,
    taylorCentre: 0,
    // pan / zoom
    _drag: null,

    /* ══════════════ init ══════════════ */
    init() {
        this.canvas = document.getElementById('calculus-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.compileExpr();
        this.bindControls();
        this._injectExtraControls();

        if (typeof ResizeObserver !== 'undefined') {
            this._ro = new ResizeObserver(() => this.draw());
            this._ro.observe(this.canvas.parentElement);
        }

        this.draw();
    },

    destroy() {
        this.stopAnimate();
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
        this._listeners.forEach(([el, evt, fn, opts]) => el.removeEventListener(evt, fn, opts));
        this._listeners = [];
    },

    _on(el, evt, fn, opts) {
        if (!el) return;
        el.addEventListener(evt, fn, opts);
        this._listeners.push([el, evt, fn, opts]);
    },

    /* ══════════════ controls ══════════════ */
    bindControls() {
        const exprInput = document.getElementById('calc-expr');
        if (exprInput) {
            this._on(exprInput, 'input', () => {
                this.expr = exprInput.value;
                this.compileExpr();
                this.draw();
            });
        }

        const slider = document.getElementById('calc-param');
        if (slider) {
            this._on(slider, 'input', (e) => {
                this.param = parseFloat(e.target.value);
                const lbl = document.getElementById('calc-param-value');
                if (lbl) lbl.textContent = this.param.toFixed(2);
                this.draw();
            });
        }

        if (!this.canvas) return;

        // Mouse → move tangent / integral bound (only without drag)
        this._on(this.canvas, 'mousemove', (e) => {
            if (this.animating || this._drag) return;
            const rect = this.canvas.getBoundingClientRect();
            const mx = (e.clientX - rect.left) / rect.width;
            const x = this.xmin + (this.xmax - this.xmin) * mx;
            this.param = Math.round(x * 100) / 100;
            this._syncSlider();
            this.draw();
        });

        // Wheel → zoom
        this._on(this.canvas, 'wheel', (e) => {
            e.preventDefault();
            const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
            const rect = this.canvas.getBoundingClientRect();
            const mx = (e.clientX - rect.left) / rect.width;
            const my = (e.clientY - rect.top) / rect.height;
            const cx = this.xmin + (this.xmax - this.xmin) * mx;
            const cy = this.ymax - (this.ymax - this.ymin) * my;
            const rx = (this.xmax - this.xmin) * factor;
            const ry = (this.ymax - this.ymin) * factor;
            this.xmin = cx - rx * mx; this.xmax = cx + rx * (1 - mx);
            this.ymin = cy - ry * (1 - my); this.ymax = cy + ry * my;
            this._updateParamRange();
            this.draw();
        }, { passive: false });

        // Right-click drag → pan
        this._on(this.canvas, 'mousedown', (e) => {
            if (e.button !== 2) return;
            e.preventDefault();
            this._drag = { sx: e.clientX, sy: e.clientY,
                xmin0: this.xmin, xmax0: this.xmax, ymin0: this.ymin, ymax0: this.ymax };
        });
        this._on(this.canvas, 'contextmenu', (e) => e.preventDefault());
        this._onWindowMouseMove = (e) => {
            if (!this._drag) return;
            const rect = this.canvas.getBoundingClientRect();
            const dx = (e.clientX - this._drag.sx) / rect.width * (this._drag.xmax0 - this._drag.xmin0);
            const dy = (e.clientY - this._drag.sy) / rect.height * (this._drag.ymax0 - this._drag.ymin0);
            this.xmin = this._drag.xmin0 - dx; this.xmax = this._drag.xmax0 - dx;
            this.ymin = this._drag.ymin0 + dy; this.ymax = this._drag.ymax0 + dy;
            this._updateParamRange();
            this.draw();
        };
        this._onWindowMouseUp = () => { this._drag = null; };
        this._on(window, 'mousemove', this._onWindowMouseMove);
        this._on(window, 'mouseup', this._onWindowMouseUp);
    },

    _syncSlider() {
        const slider = document.getElementById('calc-param');
        if (slider) {
            slider.min = this.xmin; slider.max = this.xmax;
            slider.value = this.param;
        }
        const lbl = document.getElementById('calc-param-value');
        if (lbl) lbl.textContent = this.param.toFixed(2);
    },

    _updateParamRange() {
        const slider = document.getElementById('calc-param');
        if (slider) { slider.min = this.xmin; slider.max = this.xmax; }
    },

    /* ── dynamic controls injected after the mode buttons ── */
    _injectExtraControls() {
        const modeBtns = document.querySelector('.calc-mode-btns');
        if (!modeBtns) return;

        // Add Taylor mode button
        const taylorBtn = document.createElement('button');
        taylorBtn.className = 'calc-mode-btn';
        taylorBtn.textContent = 'Taylor 级数';
        taylorBtn.onclick = () => this.setMode('taylor');
        modeBtns.appendChild(taylorBtn);

        // ── Riemann controls (shown in integral mode) ──
        const rPanel = document.createElement('div');
        rPanel.id = 'calc-riemann-panel';
        rPanel.className = 'calc-dyn-panel';
        rPanel.innerHTML =
            '<label>Riemann 和:</label>' +
            '<select id="calc-riemann-type">' +
            '  <option value="left">左端点</option><option value="right">右端点</option>' +
            '  <option value="mid">中点</option><option value="trapezoid">梯形</option>' +
            '  <option value="none">隐藏</option>' +
            '</select>' +
            '<label>矩形数 N =</label>' +
            '<input id="calc-riemann-n" type="range" min="2" max="200" value="20">' +
            '<span id="calc-riemann-n-val" class="mono-val">20</span>';
        const canvasWrap = this.canvas.parentElement;
        canvasWrap.parentElement.insertBefore(rPanel, canvasWrap);

        this._on(document.getElementById('calc-riemann-type'), 'change', (e) => {
            this.riemannType = e.target.value; this.draw();
        });
        this._on(document.getElementById('calc-riemann-n'), 'input', (e) => {
            this.riemannN = parseInt(e.target.value);
            document.getElementById('calc-riemann-n-val').textContent = this.riemannN;
            this.draw();
        });

        // ── Taylor controls (shown in taylor mode) ──
        const tPanel = document.createElement('div');
        tPanel.id = 'calc-taylor-panel';
        tPanel.className = 'calc-dyn-panel';
        tPanel.innerHTML =
            '<label>展开阶数 n =</label>' +
            '<input id="calc-taylor-deg" type="range" min="1" max="20" value="5">' +
            '<span id="calc-taylor-deg-val" class="mono-val">5</span>' +
            '<label style="margin-left:var(--space-3)">展开中心 a =</label>' +
            '<input id="calc-taylor-a" type="number" value="0" step="0.5">';
        canvasWrap.parentElement.insertBefore(tPanel, canvasWrap);

        this._on(document.getElementById('calc-taylor-deg'), 'input', (e) => {
            this.taylorDeg = parseInt(e.target.value);
            document.getElementById('calc-taylor-deg-val').textContent = this.taylorDeg;
            this.draw();
        });
        this._on(document.getElementById('calc-taylor-a'), 'input', (e) => {
            this.taylorCentre = parseFloat(e.target.value) || 0;
            this.draw();
        });
    },

    /* ══════════════ expression compiler ══════════════ */
    compileExpr() {
        if (typeof compileExpression === 'function') {
            this.fn = compileExpression(this.expr);
        } else {
            this.fn = this._basicCompile(this.expr);
        }
    },

    _basicCompile(exprStr) {
        let s = exprStr.trim();
        if (!s) return null;
        const funcs = {
            sin: 'Math.sin', cos: 'Math.cos', tan: 'Math.tan',
            abs: 'Math.abs', sqrt: 'Math.sqrt', exp: 'Math.exp',
            log: 'Math.log10', ln: 'Math.log'
        };
        for (const [k, v] of Object.entries(funcs)) {
            s = s.replace(new RegExp('\\b' + k + '\\s*\\(', 'g'), v + '(');
        }
        s = s.replace(/\bpi\b/gi, 'Math.PI');
        s = s.replace(/\^/g, '**');
        const stripped = s
            .replace(/Math\.(sin|cos|tan|abs|sqrt|exp|log10|log|PI|E|pow)/g, '')
            .replace(/[x\d\s\+\-\*\/\(\)\.\,\%]/g, '');
        if (stripped.length > 0) return null;
        try { return new Function('x', '"use strict"; return (' + s + ')'); }
        catch (e) { return null; }
    },

    evaluate(x) {
        if (!this.fn) return NaN;
        try { const y = this.fn(x); return isFinite(y) ? y : NaN; }
        catch (e) { return NaN; }
    },

    /* ══════════════ numerical calculus ══════════════ */
    derivative(x) {
        const h = 1e-6;
        const yp = this.evaluate(x + h);
        const ym = this.evaluate(x - h);
        if (isNaN(yp) || isNaN(ym)) return NaN;
        return (yp - ym) / (2 * h);
    },

    secondDerivative(x) {
        const h = 1e-5;
        const yp = this.derivative(x + h);
        const ym = this.derivative(x - h);
        if (isNaN(yp) || isNaN(ym)) return NaN;
        return (yp - ym) / (2 * h);
    },

    numericalIntegral(a, b) {
        const n = 200;
        const dx = (b - a) / n;
        let sum = this.evaluate(a) + this.evaluate(b);
        for (let i = 1; i < n; i++) {
            const x = a + i * dx;
            sum += this.evaluate(x) * (i % 2 === 0 ? 2 : 4);
        }
        return sum * dx / 3;
    },

    /** Compute n-th order Taylor coefficients around a */
    taylorCoeffs(a, n) {
        const coeffs = [this.evaluate(a)];
        let factorial = 1;
        const eps = 2.220446049250313e-16;
        // numerical higher derivatives via finite differences
        for (let k = 1; k <= n; k++) {
            factorial *= k;
            // adaptive h: optimal step for k-th order central difference
            const h = Math.max(1e-3, Math.pow(eps, 1 / (k + 2)));
            // k-th derivative via central difference of order k
            let sum = 0;
            for (let j = 0; j <= k; j++) {
                const sign = (j % 2 === 0) ? 1 : -1;
                const binom = this._binom(k, j);
                const val = this.evaluate(a + (k / 2 - j) * h);
                if (isNaN(val)) return coeffs;
                sum += sign * binom * val;
            }
            coeffs.push(sum / (Math.pow(h, k) * factorial));
        }
        return coeffs;
    },

    _binom(n, k) {
        if (k < 0 || k > n) return 0;
        if (k === 0 || k === n) return 1;
        let r = 1;
        for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1);
        return Math.round(r);
    },

    taylorEval(coeffs, a, x) {
        let sum = 0, t = 1;
        for (let i = 0; i < coeffs.length; i++) {
            sum += coeffs[i] * t;
            t *= (x - a);
        }
        return sum;
    },

    /** Find zeros of fn in [xmin, xmax] by sign-change scanning */
    _findZeros(fn, lo, hi, steps) {
        const zeros = [];
        const dx = (hi - lo) / steps;
        let prev = fn(lo);
        for (let i = 1; i <= steps; i++) {
            const x = lo + i * dx;
            const cur = fn(x);
            if (isNaN(prev) || isNaN(cur)) { prev = cur; continue; }
            if (prev * cur <= 0) {
                // bisect
                let a = x - dx, b = x;
                for (let j = 0; j < 40; j++) {
                    const m = (a + b) / 2;
                    const fm = fn(m);
                    if (isNaN(fm)) break;
                    if (fm * fn(a) <= 0) b = m; else a = m;
                }
                const z = (a + b) / 2;
                if (zeros.length === 0 || Math.abs(z - zeros[zeros.length - 1]) > dx * 0.5) {
                    zeros.push(z);
                }
            }
            prev = cur;
        }
        return zeros;
    },

    /* ══════════════ canvas sizing ══════════════ */
    sizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const w = Math.round(rect.width);
        const h = Math.round(Math.max(w * 0.55, 280));
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { w, h };
    },

    mapX(x, w) { return ((x - this.xmin) / (this.xmax - this.xmin)) * w; },
    mapY(y, h) { return ((this.ymax - y) / (this.ymax - this.ymin)) * h; },

    /* ══════════════ main draw loop ══════════════ */
    draw() {
        if (!this.ctx) return;
        const { w, h } = this.sizeCanvas();
        const ctx = this.ctx;

        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--surface-2').trim() || '#151822';
        ctx.fillRect(0, 0, w, h);

        this.drawGrid(ctx, w, h);
        this.drawAxes(ctx, w, h);

        if (!this.fn) { this.setInfo('无法解析表达式'); return; }

        // ── mode-specific layers (below main curve) ──
        if (this.mode === 'integral') {
            this.drawIntegralArea(ctx, w, h);
            if (this.riemannType !== 'none') this.drawRiemann(ctx, w, h);
        }
        if (this.mode === 'taylor') {
            this.drawTaylorPoly(ctx, w, h);
        }

        // ── main curve ──
        if (this.showFunction) {
            this.drawCurve(ctx, w, h, (x) => this.evaluate(x), '#5b8dce', 2.5);
        }

        // ── mode-specific overlays (above main curve) ──
        if (this.mode === 'derivative') {
            if (this.showDerivative) {
                this.drawCurve(ctx, w, h, (x) => this.derivative(x), 'rgba(196,121,58,0.5)', 1.5);
            }
            this.drawCriticalPoints(ctx, w, h);
            this.drawTangent(ctx, w, h);
        }
        if (this.mode === 'taylor') {
            this.drawTaylorCentreMark(ctx, w, h);
        }

        this.updateInfo();
    },

    /* ══════════════ grid & axes ══════════════ */
    drawGrid(ctx, w, h) {
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1;
        const step = this.niceStep(this.xmax - this.xmin);
        for (let gx = Math.ceil(this.xmin / step) * step; gx <= this.xmax; gx += step) {
            const px = this.mapX(gx, w);
            ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
        }
        const stepY = this.niceStep(this.ymax - this.ymin);
        for (let gy = Math.ceil(this.ymin / stepY) * stepY; gy <= this.ymax; gy += stepY) {
            const py = this.mapY(gy, h);
            ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
        }
    },

    drawAxes(ctx, w, h) {
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1.5;
        if (this.ymin <= 0 && this.ymax >= 0) {
            const ay = this.mapY(0, h);
            ctx.beginPath(); ctx.moveTo(0, ay); ctx.lineTo(w, ay); ctx.stroke();
        }
        if (this.xmin <= 0 && this.xmax >= 0) {
            const ax = this.mapX(0, w);
            ctx.beginPath(); ctx.moveTo(ax, 0); ctx.lineTo(ax, h); ctx.stroke();
        }
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '16px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const step = this.niceStep(this.xmax - this.xmin);
        for (let lx = Math.ceil(this.xmin / step) * step; lx <= this.xmax; lx += step) {
            if (Math.abs(lx) < 1e-10) continue;
            const px = this.mapX(lx, w);
            const ay = this.ymin <= 0 && this.ymax >= 0 ? this.mapY(0, h) : h;
            ctx.fillText(this.fmt(lx), px, Math.min(ay + 3, h - 12));
        }
        const stepY = this.niceStep(this.ymax - this.ymin);
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        for (let ly = Math.ceil(this.ymin / stepY) * stepY; ly <= this.ymax; ly += stepY) {
            if (Math.abs(ly) < 1e-10) continue;
            const py = this.mapY(ly, h);
            const ax = this.xmin <= 0 && this.xmax >= 0 ? this.mapX(0, w) : 0;
            ctx.fillText(this.fmt(ly), Math.max(ax - 4, 40), py);
        }
    },

    /* ══════════════ curve drawing ══════════════ */
    drawCurve(ctx, w, h, fn, color, lineWidth) {
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        let drawing = false;
        const steps = w * 2;
        const yRange = this.ymax - this.ymin;
        for (let i = 0; i <= steps; i++) {
            const x = this.xmin + (this.xmax - this.xmin) * (i / steps);
            const y = fn(x);
            if (isNaN(y) || !isFinite(y) || y < this.ymin - yRange * 2 || y > this.ymax + yRange * 2) {
                drawing = false; continue;
            }
            const px = this.mapX(x, w), py = this.mapY(y, h);
            if (!drawing) { ctx.moveTo(px, py); drawing = true; }
            else ctx.lineTo(px, py);
        }
        ctx.stroke();
    },

    /* ══════════════ DERIVATIVE mode ══════════════ */
    drawTangent(ctx, w, h) {
        const x0 = this.param;
        const y0 = this.evaluate(x0);
        const slope = this.derivative(x0);
        if (isNaN(y0) || isNaN(slope)) return;

        const px = this.mapX(x0, w);
        const py = this.mapY(y0, h);

        const len = (this.xmax - this.xmin) * 0.3;
        const x1 = x0 - len, y1 = y0 - slope * len;
        const x2 = x0 + len, y2 = y0 + slope * len;

        ctx.strokeStyle = '#c4793a';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(this.mapX(x1, w), this.mapY(y1, h));
        ctx.lineTo(this.mapX(x2, w), this.mapY(y2, h));
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#c4793a';
        ctx.shadowColor = '#c4793a'; ctx.shadowBlur = 12;
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '18px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText(`斜率 = ${slope.toFixed(3)}`, px + 10, py - 10);
    },

    /** Auto-detect and mark critical points (f'=0) and inflection points (f''=0) */
    drawCriticalPoints(ctx, w, h) {
        const dFn = (x) => this.derivative(x);
        const ddFn = (x) => this.secondDerivative(x);

        // Critical points: f'(x) = 0
        const crits = this._findZeros(dFn, this.xmin, this.xmax, 400);
        for (const xc of crits) {
            const yc = this.evaluate(xc);
            if (isNaN(yc)) continue;
            const px = this.mapX(xc, w), py = this.mapY(yc, h);
            if (py < -20 || py > h + 20) continue;

            const dd = this.secondDerivative(xc);
            const isMax = dd < -1e-4;
            const isMin = dd > 1e-4;
            const color = isMax ? '#e06c75' : isMin ? '#4d9e7e' : '#d4a156';
            const label = isMax ? '极大' : isMin ? '极小' : '驻点';

            // diamond marker
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(Math.PI / 4);
            ctx.fillStyle = color;
            ctx.shadowColor = color; ctx.shadowBlur = 8;
            ctx.fillRect(-5, -5, 10, 10);
            ctx.shadowBlur = 0;
            ctx.restore();

            ctx.fillStyle = color;
            ctx.font = 'bold 16px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.fillText(label, px, py - 14);
        }

        // Inflection points: f''(x) = 0
        const inflections = this._findZeros(ddFn, this.xmin, this.xmax, 400);
        for (const xi of inflections) {
            const yi = this.evaluate(xi);
            if (isNaN(yi)) continue;
            const px = this.mapX(xi, w), py = this.mapY(yi, h);
            if (py < -20 || py > h + 20) continue;

            // triangle marker
            ctx.beginPath();
            ctx.moveTo(px, py - 7);
            ctx.lineTo(px - 5, py + 4);
            ctx.lineTo(px + 5, py + 4);
            ctx.closePath();
            ctx.fillStyle = '#8b6fc0';
            ctx.shadowColor = '#8b6fc0'; ctx.shadowBlur = 6;
            ctx.fill();
            ctx.shadowBlur = 0;

            ctx.fillStyle = '#8b6fc0';
            ctx.font = 'bold 16px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.fillText('拐点', px, py - 14);
        }
    },

    /* ══════════════ INTEGRAL mode ══════════════ */
    drawIntegralArea(ctx, w, h) {
        const a = 0, b = this.param;
        if (Math.abs(b - a) < 0.01) return;

        const lo = Math.min(a, b), hi = Math.max(a, b);
        const sign = b >= a ? 1 : -1;
        const steps = Math.max(Math.round(Math.abs(hi - lo) / ((this.xmax - this.xmin) / w)), 2);
        const dx = (hi - lo) / steps;

        ctx.beginPath();
        ctx.moveTo(this.mapX(lo, w), this.mapY(0, h));
        for (let i = 0; i <= steps; i++) {
            const x = lo + i * dx;
            const y = this.evaluate(x);
            if (isNaN(y)) continue;
            ctx.lineTo(this.mapX(x, w), this.mapY(y, h));
        }
        ctx.lineTo(this.mapX(hi, w), this.mapY(0, h));
        ctx.closePath();

        const area = this.numericalIntegral(lo, hi) * sign;
        ctx.fillStyle = area >= 0 ? 'rgba(77,158,126,0.15)' : 'rgba(184,84,80,0.15)';
        ctx.fill();

        // boundary lines
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        [lo, hi].forEach(bx => {
            const px = this.mapX(bx, w);
            ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
        });
        ctx.setLineDash([]);

        // area label
        const midX = this.mapX((lo + hi) / 2, w);
        const midY = this.mapY(0, h) - 20;
        ctx.fillStyle = area >= 0 ? '#4d9e7e' : '#b85450';
        ctx.font = 'bold 20px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText(`∫ = ${area.toFixed(4)}`, midX, midY);
    },

    /** Draw Riemann sum rectangles / trapezoids */
    drawRiemann(ctx, w, h) {
        const a = 0, b = this.param;
        if (Math.abs(b - a) < 0.05) return;
        const lo = Math.min(a, b), hi = Math.max(a, b);
        const N = this.riemannN;
        const dx = (hi - lo) / N;
        const type = this.riemannType;
        const baseY = this.mapY(0, h);

        let riemannSum = 0;

        for (let i = 0; i < N; i++) {
            const xLeft = lo + i * dx;
            const xRight = xLeft + dx;
            let yL, yR, yH;

            if (type === 'left') {
                yH = this.evaluate(xLeft);
                if (isNaN(yH)) continue;
                riemannSum += yH * dx;
                // draw rectangle
                const px = this.mapX(xLeft, w);
                const pw = this.mapX(xRight, w) - px;
                const pyTop = this.mapY(yH, h);
                ctx.fillStyle = yH >= 0 ? 'rgba(91,141,206,0.18)' : 'rgba(184,84,80,0.18)';
                ctx.strokeStyle = 'rgba(91,141,206,0.5)';
                ctx.lineWidth = 0.8;
                ctx.fillRect(px, Math.min(pyTop, baseY), pw, Math.abs(pyTop - baseY));
                ctx.strokeRect(px, Math.min(pyTop, baseY), pw, Math.abs(pyTop - baseY));
            } else if (type === 'right') {
                yH = this.evaluate(xRight);
                if (isNaN(yH)) continue;
                riemannSum += yH * dx;
                const px = this.mapX(xLeft, w);
                const pw = this.mapX(xRight, w) - px;
                const pyTop = this.mapY(yH, h);
                ctx.fillStyle = yH >= 0 ? 'rgba(91,141,206,0.18)' : 'rgba(184,84,80,0.18)';
                ctx.strokeStyle = 'rgba(91,141,206,0.5)';
                ctx.lineWidth = 0.8;
                ctx.fillRect(px, Math.min(pyTop, baseY), pw, Math.abs(pyTop - baseY));
                ctx.strokeRect(px, Math.min(pyTop, baseY), pw, Math.abs(pyTop - baseY));
            } else if (type === 'mid') {
                yH = this.evaluate((xLeft + xRight) / 2);
                if (isNaN(yH)) continue;
                riemannSum += yH * dx;
                const px = this.mapX(xLeft, w);
                const pw = this.mapX(xRight, w) - px;
                const pyTop = this.mapY(yH, h);
                ctx.fillStyle = yH >= 0 ? 'rgba(91,141,206,0.18)' : 'rgba(184,84,80,0.18)';
                ctx.strokeStyle = 'rgba(91,141,206,0.5)';
                ctx.lineWidth = 0.8;
                ctx.fillRect(px, Math.min(pyTop, baseY), pw, Math.abs(pyTop - baseY));
                ctx.strokeRect(px, Math.min(pyTop, baseY), pw, Math.abs(pyTop - baseY));
            } else if (type === 'trapezoid') {
                yL = this.evaluate(xLeft);
                yR = this.evaluate(xRight);
                if (isNaN(yL) || isNaN(yR)) continue;
                riemannSum += (yL + yR) / 2 * dx;
                const pxL = this.mapX(xLeft, w);
                const pxR = this.mapX(xRight, w);
                const pyL = this.mapY(yL, h);
                const pyR = this.mapY(yR, h);
                ctx.beginPath();
                ctx.moveTo(pxL, baseY);
                ctx.lineTo(pxL, pyL);
                ctx.lineTo(pxR, pyR);
                ctx.lineTo(pxR, baseY);
                ctx.closePath();
                const avg = (yL + yR) / 2;
                ctx.fillStyle = avg >= 0 ? 'rgba(91,141,206,0.18)' : 'rgba(184,84,80,0.18)';
                ctx.fill();
                ctx.strokeStyle = 'rgba(91,141,206,0.5)';
                ctx.lineWidth = 0.8;
                ctx.stroke();
            }
        }

        // Sign correction
        if (b < a) riemannSum = -riemannSum;

        // Riemann sum value label
        const exactArea = this.numericalIntegral(Math.min(a, b), Math.max(a, b)) * (b >= a ? 1 : -1);
        const error = Math.abs(riemannSum - exactArea);
        ctx.fillStyle = 'rgba(91,141,206,0.8)';
        ctx.font = '17px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText(`Riemann(${type}, N=${N}) = ${riemannSum.toFixed(4)}  误差 ≈ ${error.toFixed(6)}`, 10, 16);
    },

    /* ══════════════ TAYLOR mode ══════════════ */
    drawTaylorPoly(ctx, w, h) {
        const a = this.taylorCentre;
        const n = this.taylorDeg;
        const coeffs = this.taylorCoeffs(a, n);

        // Draw the Taylor approximation curve
        this.drawCurve(ctx, w, h, (x) => this.taylorEval(coeffs, a, x), '#e06c75', 2);

        // Build polynomial string for info
        let polyStr = '';
        for (let k = 0; k < coeffs.length; k++) {
            const c = coeffs[k];
            if (isNaN(c)) break;
            const absC = Math.abs(c);
            const cStr = absC === 1 && k > 0 ? '' : absC.toFixed(4).replace(/\.?0+$/, '');
            if (k > 0 && (absC < 1e-10 || cStr === '0')) continue;
            if (k === 0 && cStr === '0') continue;
            const sign = c >= 0 ? (polyStr ? ' + ' : '') : (polyStr ? ' − ' : '−');
            let term = '';
            if (k === 0) term = cStr || '0';
            else if (k === 1) term = cStr + (a === 0 ? 'x' : `(x−${a})`);
            else term = cStr + (a === 0 ? `x^${k}` : `(x−${a})^${k}`);
            polyStr += sign + term;
        }
        this._taylorPolyStr = polyStr || '0';

        // Convergence radius visualization: shade region where approximation is close
        const threshold = (this.ymax - this.ymin) * 0.1;
        let rLeft = a, rRight = a;
        const step = (this.xmax - this.xmin) / 400;
        for (let x = a; x >= this.xmin; x -= step) {
            const diff = Math.abs(this.evaluate(x) - this.taylorEval(coeffs, a, x));
            if (isNaN(diff) || diff > threshold) break;
            rLeft = x;
        }
        for (let x = a; x <= this.xmax; x += step) {
            const diff = Math.abs(this.evaluate(x) - this.taylorEval(coeffs, a, x));
            if (isNaN(diff) || diff > threshold) break;
            rRight = x;
        }

        // shade convergence region
        if (rRight - rLeft > step * 2) {
            const pxL = this.mapX(rLeft, w);
            const pxR = this.mapX(rRight, w);
            ctx.fillStyle = 'rgba(224,108,117,0.06)';
            ctx.fillRect(pxL, 0, pxR - pxL, h);
        }
    },

    drawTaylorCentreMark(ctx, w, h) {
        const a = this.taylorCentre;
        const ya = this.evaluate(a);
        if (isNaN(ya)) return;
        const px = this.mapX(a, w);
        const py = this.mapY(ya, h);

        // vertical dashed line at centre
        ctx.strokeStyle = 'rgba(224,108,117,0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
        ctx.setLineDash([]);

        // point
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#e06c75';
        ctx.shadowColor = '#e06c75'; ctx.shadowBlur = 10;
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '17px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText(`a = ${a}`, px + 8, py - 8);
    },

    /* ══════════════ info update ══════════════ */
    updateInfo() {
        const x = this.param;
        const y = this.evaluate(x);
        const el = document.getElementById('calc-info');
        if (!el) return;
        let html = '';
        if (this.mode === 'derivative') {
            const slope = this.derivative(x);
            const d2 = this.secondDerivative(x);
            const yStr = isNaN(y) ? '—' : y.toFixed(4);
            const sStr = isNaN(slope) ? '—' : slope.toFixed(4);
            const d2Str = isNaN(d2) ? '—' : d2.toFixed(4);
            const concavity = isNaN(d2) ? '—' : (d2 > 0.001 ? '凹（上凸）' : d2 < -0.001 ? '凸（下凸）' : '拐点附近');
            const monotone = isNaN(slope) ? '—' : (slope > 0.001 ? '↑ 递增' : slope < -0.001 ? '↓ 递减' : '≈ 极值点');
            html = `<div class="calc-edu">
<div class="math-hd"><span class="math-tag">导数</span>微分学 — 函数的局部性质分析</div>
<div class="math-row"><span class="math-key">f(${x.toFixed(2)})</span>= ${yStr}</div>
<div class="math-row"><span class="math-key">f'(${x.toFixed(2)})</span>= ${sStr} &nbsp;→ 切线斜率 → ${monotone}</div>
<div class="math-row"><span class="math-key math-key--amber">f''(${x.toFixed(2)})</span>= ${d2Str} &nbsp;→ 曲率变化 → ${concavity}</div>
<div class="math-row"><span class="math-key math-key--red">几何意义</span>f'(x₀) 是曲线在 x₀ 处切线的斜率；切线方程 y − f(x₀) = f'(x₀)(x − x₀)</div>
<div class="math-note">💡 f'(x₀)=0 且 f''(x₀)>0 → 极小值；f''(x₀)<0 → 极大值（二阶判定法）。导数的本质是函数的瞬时变化率 lim[Δx→0] Δy/Δx</div>
</div>`;
        } else if (this.mode === 'integral') {
            const area = this.numericalIntegral(0, x);
            const yStr = isNaN(y) ? '—' : y.toFixed(4);
            const aStr = isNaN(area) ? '—' : area.toFixed(4);
            html = `<div class="calc-edu">
<div class="math-hd"><span class="math-tag">积分</span>积分学 — 函数的累积效应</div>
<div class="math-row"><span class="math-key">f(${x.toFixed(2)})</span>= ${yStr}</div>
<div class="math-row"><span class="math-key">∫₀<sup>${x.toFixed(1)}</sup> f(t)dt</span>= ${aStr}（有向面积，N=${this.riemannN} 矩形逼近）</div>
<div class="math-row"><span class="math-key math-key--amber">牛顿-莱布尼茨</span>∫ₐᵇ f(x)dx = F(b) − F(a)，其中 F'(x) = f(x)</div>
<div class="math-row"><span class="math-key math-key--red">几何意义</span>定积分 = x 轴上方面积 − 下方面积（有向面积）</div>
<div class="math-note">💡 增大矩形数 N → Riemann 和趋于精确积分值。微积分基本定理将求面积问题转化为求原函数问题，是微积分的核心桥梁</div>
</div>`;
        } else if (this.mode === 'taylor') {
            const n = this.taylorDeg;
            html = `<div class="calc-edu">
<div class="math-hd"><span class="math-tag">Taylor</span>Taylor 展开 — 多项式逼近</div>
<div class="math-row"><span class="math-key">T<sub>${n}</sub>(x)</span>≈ ${this._taylorPolyStr || '...'}</div>
<div class="math-row"><span class="math-key math-key--amber">通式</span>f(x) ≈ Σₖ₌₀ⁿ f⁽ᵏ⁾(a)/k! · (x−a)ᵏ，展开中心 a</div>
<div class="math-row"><span class="math-key math-key--red">余项</span>Rₙ(x) = f⁽ⁿ⁺¹⁾(ξ)/(n+1)! · (x−a)ⁿ⁺¹（Lagrange 余项）</div>
<div class="math-note">💡 增大展开阶数 n → 多项式在 a 附近更精确地逼近原函数。常见展开：eˣ = Σ xⁿ/n!，sin x = x − x³/3! + x⁵/5! − ...</div>
</div>`;
        }
        el.innerHTML = html;
    },

    /* ══════════════ mode / preset / animate ══════════════ */
    setMode(mode) {
        this.mode = mode;
        document.querySelectorAll('.calc-mode-btn').forEach(b => {
            b.classList.remove('active');
            const t = b.textContent.trim().toLowerCase();
            if ((mode === 'derivative' && t.includes('导'))
                || (mode === 'integral' && t.includes('积'))
                || (mode === 'taylor' && t.includes('taylor'))) {
                b.classList.add('active');
            }
        });
        // Toggle sub-panels visibility
        const rPanel = document.getElementById('calc-riemann-panel');
        const tPanel = document.getElementById('calc-taylor-panel');
        if (rPanel) rPanel.style.display = mode === 'integral' ? 'flex' : 'none';
        if (tPanel) tPanel.style.display = mode === 'taylor' ? 'flex' : 'none';
        this.draw();
    },

    setPreset(name) {
        const presets = {
            'sin(x)': { expr: 'sin(x)', xmin: -8, xmax: 8, ymin: -2, ymax: 2 },
            'x^2': { expr: 'x^2', xmin: -4, xmax: 4, ymin: -1, ymax: 8 },
            'x^3-3*x': { expr: 'x^3-3*x', xmin: -3, xmax: 3, ymin: -5, ymax: 5 },
            'exp(-x^2)': { expr: 'exp(-x^2)', xmin: -4, xmax: 4, ymin: -0.5, ymax: 1.5 },
            '1/(1+x^2)': { expr: '1/(1+x^2)', xmin: -6, xmax: 6, ymin: -0.5, ymax: 1.5 },
            'cos(x)*x': { expr: 'cos(x)*x', xmin: -10, xmax: 10, ymin: -8, ymax: 8 }
        };
        const p = presets[name];
        if (!p) return;
        this.expr = p.expr;
        this.xmin = p.xmin; this.xmax = p.xmax;
        this.ymin = p.ymin; this.ymax = p.ymax;
        const exprInput = document.getElementById('calc-expr');
        if (exprInput) exprInput.value = p.expr;
        this.compileExpr();
        this.param = 0;
        this._syncSlider();
        this._updateParamRange();
        document.querySelectorAll('.calc-presets .btn--ghost').forEach(b => {
            b.classList.remove('active');
            if (b.textContent.trim().includes(name)) b.classList.add('active');
        });
        this.draw();
    },

    animate() {
        if (this.animating) { this.stopAnimate(); return; }
        this.animating = true;
        let t = this.xmin;
        this._animLastTime = performance.now();
        const animBtn = document.getElementById('calc-animate-btn');
        if (animBtn) animBtn.textContent = '⏸ 暂停';

        const step = (now) => {
            if (!this.animating) return;
            const rawDt = (now - this._animLastTime) / 1000;
            this._animLastTime = now;
            const dt = Math.min(rawDt, 0.1);

            t += 3.0 * dt;
            if (t > this.xmax) t = this.xmin;
            this.param = Math.round(t * 100) / 100;
            this._syncSlider();
            this.draw();
            this.animId = requestAnimationFrame(step);
        };
        this.animId = requestAnimationFrame(step);
    },

    stopAnimate() {
        this.animating = false;
        if (this.animId) cancelAnimationFrame(this.animId);
        this.animId = null;
        const animBtn = document.getElementById('calc-animate-btn');
        if (animBtn) animBtn.textContent = '▶ 动画';
    },

    /* ══════════════ helpers ══════════════ */
    niceStep(range) {
        const rough = range / 8;
        const mag = Math.pow(10, Math.floor(Math.log10(rough)));
        const norm = rough / mag;
        if (norm < 1.5) return mag;
        if (norm < 3.5) return 2 * mag;
        if (norm < 7.5) return 5 * mag;
        return 10 * mag;
    },

    fmt(n) {
        return Math.abs(n) >= 1000 || (Math.abs(n) < 0.01 && n !== 0)
            ? n.toExponential(1) : parseFloat(n.toPrecision(4)).toString();
    }
};

// ── 初始化 ──
function initCalculus() {
    Calculus.init();
}

window.Calculus = Calculus;
window.initCalculus = initCalculus;
