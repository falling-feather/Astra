// ===== Mathematical Modeling and Numerical Methods =====

const ModelingNumerical = {
    canvas: null,
    ctx: null,
    W: 0,
    H: 0,
    _listeners: [],
    _ro: null,
    mode: 'fit',
    fitN: 32,
    fitNoise: 0.8,
    fitCurve: 0.35,
    fitSeed: 7,
    showResiduals: true,
    eulerH: 0.4,
    eulerR: 0.62,
    eulerY0: 0.14,
    newtonC: 1.0,
    newtonX0: 1.8,
    newtonSteps: 5,
    _lastFit: null,
    _lastEuler: null,
    _lastNewton: null,

    modes: [
        { key: 'fit', label: '拟合与残差' },
        { key: 'euler', label: 'Euler 步长' },
        { key: 'newton', label: 'Newton 迭代' }
    ],

    _COL: {
        bg0: '#08111f',
        bg1: '#101827',
        panel: 'rgba(15, 23, 42, 0.72)',
        grid: 'rgba(148, 163, 184, 0.11)',
        axis: 'rgba(226, 232, 240, 0.34)',
        text: '#e7eef8',
        muted: 'rgba(226, 232, 240, 0.66)',
        dim: 'rgba(226, 232, 240, 0.42)',
        blue: '#60a5fa',
        cyan: '#22d3ee',
        green: '#34d399',
        amber: '#fbbf24',
        rose: '#fb7185',
        violet: '#a78bfa'
    },

    _on(el, evt, fn, opts) {
        if (!el) return;
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        this.destroy();
        this.canvas = document.getElementById('mn-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.canvas.setAttribute('role', 'img');
        this.canvas.setAttribute('aria-label', '数学建模、拟合误差、Euler 数值法与 Newton 迭代可视化');
        this._buildControls();
        this._bindEvents();
        this._resize();
        if (typeof ResizeObserver !== 'undefined') {
            this._ro = new ResizeObserver(() => this._resize());
            this._ro.observe(this.canvas.parentElement);
        } else {
            this._on(window, 'resize', () => this._resize());
        }
        this._render();
    },

    destroy() {
        this._listeners.forEach(l => l.el.removeEventListener(l.evt, l.fn, l.opts));
        this._listeners.length = 0;
        if (this._ro) this._ro.disconnect();
        this._ro = null;
        const ctrl = document.getElementById('mn-controls');
        if (ctrl) ctrl.innerHTML = '';
        const info = document.getElementById('mn-info');
        if (info) info.innerHTML = '';
        this.canvas = null;
        this.ctx = null;
    },

    _resize() {
        if (!this.canvas || !this.canvas.parentElement || !this.ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const w = this.canvas.parentElement.getBoundingClientRect().width || 640;
        const h = Math.min(Math.max(w * 0.54, 350), 540);
        this.canvas.width = Math.floor(w * dpr);
        this.canvas.height = Math.floor(h * dpr);
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w;
        this.H = h;
        this._render();
    },

    _buildControls() {
        const ctrl = document.getElementById('mn-controls');
        if (!ctrl) return;
        const tabs = this.modes.map(m => (
            `<button class="mn-mode-btn ${m.key === this.mode ? 'active' : ''}" type="button" data-mode="${m.key}">${m.label}</button>`
        )).join('');

        let body = '';
        if (this.mode === 'fit') {
            body = `
                <div class="mn-grid">
                    <label class="mn-field">样本量 n <span id="mn-fit-n-val">${this.fitN}</span>
                        <input id="mn-fit-n" class="mn-slider" type="range" min="12" max="80" step="2" value="${this.fitN}">
                    </label>
                    <label class="mn-field">噪声强度 <span id="mn-fit-noise-val">${this.fitNoise.toFixed(1)}</span>
                        <input id="mn-fit-noise" class="mn-slider" type="range" min="0" max="2.5" step="0.1" value="${this.fitNoise}">
                    </label>
                    <label class="mn-field">非线性偏离 <span id="mn-fit-curve-val">${this.fitCurve.toFixed(2)}</span>
                        <input id="mn-fit-curve" class="mn-slider" type="range" min="-1.2" max="1.2" step="0.05" value="${this.fitCurve}">
                    </label>
                </div>
                <div class="mn-switch-row">
                    <label class="mn-check"><input id="mn-fit-residuals" type="checkbox" ${this.showResiduals ? 'checked' : ''}>显示残差线</label>
                    <button class="mn-btn" type="button" data-action="resample">重新取样</button>
                </div>`;
        } else if (this.mode === 'euler') {
            body = `
                <div class="mn-grid">
                    <label class="mn-field">步长 h <span id="mn-euler-h-val">${this.eulerH.toFixed(2)}</span>
                        <input id="mn-euler-h" class="mn-slider" type="range" min="0.1" max="1.0" step="0.05" value="${this.eulerH}">
                    </label>
                    <label class="mn-field">增长率 r <span id="mn-euler-r-val">${this.eulerR.toFixed(2)}</span>
                        <input id="mn-euler-r" class="mn-slider" type="range" min="0.2" max="1.2" step="0.02" value="${this.eulerR}">
                    </label>
                    <label class="mn-field">初值 y₀ <span id="mn-euler-y0-val">${this.eulerY0.toFixed(2)}</span>
                        <input id="mn-euler-y0" class="mn-slider" type="range" min="0.05" max="0.55" step="0.01" value="${this.eulerY0}">
                    </label>
                </div>`;
        } else {
            body = `
                <div class="mn-grid">
                    <label class="mn-field">方程参数 c <span id="mn-newton-c-val">${this.newtonC.toFixed(2)}</span>
                        <input id="mn-newton-c" class="mn-slider" type="range" min="-1.4" max="1.4" step="0.05" value="${this.newtonC}">
                    </label>
                    <label class="mn-field">初值 x₀ <span id="mn-newton-x0-val">${this.newtonX0.toFixed(2)}</span>
                        <input id="mn-newton-x0" class="mn-slider" type="range" min="-2.2" max="2.2" step="0.05" value="${this.newtonX0}">
                    </label>
                    <label class="mn-field">迭代步数 <span id="mn-newton-steps-val">${this.newtonSteps}</span>
                        <input id="mn-newton-steps" class="mn-slider" type="range" min="1" max="8" step="1" value="${this.newtonSteps}">
                    </label>
                </div>`;
        }

        ctrl.innerHTML = `<div class="mn-mode-btns">${tabs}</div>${body}`;
    },

    _bindEvents() {
        const ctrl = document.getElementById('mn-controls');
        if (!ctrl) return;
        this._on(ctrl, 'click', (event) => {
            const modeBtn = event.target.closest('[data-mode]');
            if (modeBtn) {
                this.mode = modeBtn.dataset.mode;
                this._buildControls();
                this._render();
                return;
            }
            const actionBtn = event.target.closest('[data-action]');
            if (actionBtn && actionBtn.dataset.action === 'resample') {
                this.fitSeed += 1;
                this._render();
            }
        });

        this._on(ctrl, 'input', (event) => {
            if (this._syncControlValue(event.target)) this._render();
        });

        this._on(ctrl, 'change', (event) => {
            if (event.target && event.target.id === 'mn-fit-residuals') {
                this.showResiduals = event.target.checked;
                this._render();
                return;
            }
            if (this._syncControlValue(event.target)) this._render();
        });
    },

    _syncControlValue(target) {
        if (!target || !target.id) return false;
        const v = parseFloat(target.value);
        if (!Number.isFinite(v)) return false;
        switch (target.id) {
            case 'mn-fit-n':
                this.fitN = Math.round(v);
                this._setText('mn-fit-n-val', this.fitN);
                return true;
            case 'mn-fit-noise':
                this.fitNoise = v;
                this._setText('mn-fit-noise-val', this.fitNoise.toFixed(1));
                return true;
            case 'mn-fit-curve':
                this.fitCurve = v;
                this._setText('mn-fit-curve-val', this.fitCurve.toFixed(2));
                return true;
            case 'mn-euler-h':
                this.eulerH = v;
                this._setText('mn-euler-h-val', this.eulerH.toFixed(2));
                return true;
            case 'mn-euler-r':
                this.eulerR = v;
                this._setText('mn-euler-r-val', this.eulerR.toFixed(2));
                return true;
            case 'mn-euler-y0':
                this.eulerY0 = v;
                this._setText('mn-euler-y0-val', this.eulerY0.toFixed(2));
                return true;
            case 'mn-newton-c':
                this.newtonC = v;
                this._setText('mn-newton-c-val', this.newtonC.toFixed(2));
                return true;
            case 'mn-newton-x0':
                this.newtonX0 = v;
                this._setText('mn-newton-x0-val', this.newtonX0.toFixed(2));
                return true;
            case 'mn-newton-steps':
                this.newtonSteps = Math.round(v);
                this._setText('mn-newton-steps-val', this.newtonSteps);
                return true;
            default:
                return false;
        }
    },

    _setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    },

    _render() {
        if (!this.ctx || !this.W || !this.H) return;
        this._clear();
        if (this.mode === 'fit') this._drawFit();
        if (this.mode === 'euler') this._drawEuler();
        if (this.mode === 'newton') this._drawNewton();
        this._updateInfo();
    },

    _clear() {
        const { ctx, W, H } = this;
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, this._COL.bg0);
        g.addColorStop(1, this._COL.bg1);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = 'rgba(255,255,255,0.025)';
        for (let i = -H; i < W; i += 42) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i + H, H);
            ctx.lineWidth = 1;
            ctx.strokeStyle = 'rgba(255,255,255,0.035)';
            ctx.stroke();
        }
    },

    _plotBox() {
        const compact = this.W < 620;
        return {
            l: compact ? 42 : 56,
            r: this.W - (compact ? 18 : 28),
            t: compact ? 34 : 42,
            b: this.H - (compact ? 42 : 48)
        };
    },

    _pt(x, y, xr, yr, box) {
        const px = box.l + (x - xr[0]) / (xr[1] - xr[0]) * (box.r - box.l);
        const py = box.b - (y - yr[0]) / (yr[1] - yr[0]) * (box.b - box.t);
        return { x: px, y: py };
    },

    _drawGrid(box, xr, yr, labelX, labelY) {
        const { ctx } = this;
        ctx.save();
        ctx.strokeStyle = this._COL.grid;
        ctx.lineWidth = 1;
        for (let i = 0; i <= 8; i++) {
            const x = box.l + (box.r - box.l) * i / 8;
            ctx.beginPath();
            ctx.moveTo(x, box.t);
            ctx.lineTo(x, box.b);
            ctx.stroke();
        }
        for (let i = 0; i <= 6; i++) {
            const y = box.t + (box.b - box.t) * i / 6;
            ctx.beginPath();
            ctx.moveTo(box.l, y);
            ctx.lineTo(box.r, y);
            ctx.stroke();
        }
        if (xr[0] <= 0 && xr[1] >= 0) {
            const p = this._pt(0, yr[0], xr, yr, box);
            ctx.strokeStyle = this._COL.axis;
            ctx.beginPath();
            ctx.moveTo(p.x, box.t);
            ctx.lineTo(p.x, box.b);
            ctx.stroke();
        }
        if (yr[0] <= 0 && yr[1] >= 0) {
            const p = this._pt(xr[0], 0, xr, yr, box);
            ctx.strokeStyle = this._COL.axis;
            ctx.beginPath();
            ctx.moveTo(box.l, p.y);
            ctx.lineTo(box.r, p.y);
            ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(226,232,240,0.28)';
        ctx.strokeRect(box.l, box.t, box.r - box.l, box.b - box.t);
        ctx.fillStyle = this._COL.dim;
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillText(labelX, box.r - 54, box.b + 28);
        ctx.save();
        ctx.translate(box.l - 34, box.t + 58);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(labelY, 0, 0);
        ctx.restore();
        ctx.restore();
    },

    _mulberry(seed) {
        let t = seed >>> 0;
        return function() {
            t += 0x6D2B79F5;
            let r = Math.imul(t ^ (t >>> 15), 1 | t);
            r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
            return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
        };
    },

    _gauss(rand) {
        let u = 0;
        let v = 0;
        while (u === 0) u = rand();
        while (v === 0) v = rand();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },

    _fitData() {
        const rand = this._mulberry(20260618 + this.fitSeed * 97);
        const pts = [];
        const n = this.fitN;
        const fTrue = (x) => 1.1 + 0.72 * x + this.fitCurve * 0.18 * (x * x - 5);
        for (let i = 0; i < n; i++) {
            const base = n === 1 ? 0 : -4 + 8 * i / (n - 1);
            const x = base + (rand() - 0.5) * 0.34;
            const y = fTrue(x) + this.fitNoise * this._gauss(rand);
            pts.push({ x, y });
        }
        const sx = pts.reduce((s, p) => s + p.x, 0);
        const sy = pts.reduce((s, p) => s + p.y, 0);
        const xbar = sx / n;
        const ybar = sy / n;
        let sxx = 0;
        let sxy = 0;
        let tss = 0;
        pts.forEach(p => {
            sxx += (p.x - xbar) ** 2;
            sxy += (p.x - xbar) * (p.y - ybar);
            tss += (p.y - ybar) ** 2;
        });
        const slope = sxx ? sxy / sxx : 0;
        const intercept = ybar - slope * xbar;
        let sse = 0;
        pts.forEach(p => {
            p.yhat = intercept + slope * p.x;
            p.resid = p.y - p.yhat;
            sse += p.resid ** 2;
        });
        const r2 = tss ? Math.max(0, 1 - sse / tss) : 1;
        const yValues = pts.flatMap(p => [p.y, p.yhat]);
        for (let i = 0; i <= 60; i++) {
            const x = -4.4 + 8.8 * i / 60;
            yValues.push(fTrue(x));
        }
        const ymin = Math.min(...yValues);
        const ymax = Math.max(...yValues);
        const pad = Math.max((ymax - ymin) * 0.18, 1);
        return { pts, slope, intercept, sse, r2, xbar, ybar, fTrue, xr: [-4.5, 4.5], yr: [ymin - pad, ymax + pad] };
    },

    _drawFit() {
        const { ctx } = this;
        const box = this._plotBox();
        const fit = this._fitData();
        this._lastFit = fit;
        this._drawGrid(box, fit.xr, fit.yr, 'x', 'y');

        ctx.save();
        ctx.beginPath();
        ctx.rect(box.l, box.t, box.r - box.l, box.b - box.t);
        ctx.clip();

        ctx.setLineDash([8, 7]);
        ctx.strokeStyle = 'rgba(167, 139, 250, 0.86)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i <= 90; i++) {
            const x = fit.xr[0] + (fit.xr[1] - fit.xr[0]) * i / 90;
            const p = this._pt(x, fit.fTrue(x), fit.xr, fit.yr, box);
            if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        if (this.showResiduals) {
            fit.pts.forEach(p => {
                const a = this._pt(p.x, p.y, fit.xr, fit.yr, box);
                const b = this._pt(p.x, p.yhat, fit.xr, fit.yr, box);
                ctx.strokeStyle = Math.abs(p.resid) > this.fitNoise * 1.2 ? 'rgba(251, 113, 133, 0.58)' : 'rgba(251, 191, 36, 0.42)';
                ctx.lineWidth = 1.3;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
            });
        }

        const a = this._pt(fit.xr[0], fit.intercept + fit.slope * fit.xr[0], fit.xr, fit.yr, box);
        const b = this._pt(fit.xr[1], fit.intercept + fit.slope * fit.xr[1], fit.xr, fit.yr, box);
        ctx.strokeStyle = this._COL.cyan;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();

        fit.pts.forEach(p => {
            const q = this._pt(p.x, p.y, fit.xr, fit.yr, box);
            ctx.fillStyle = 'rgba(96, 165, 250, 0.88)';
            ctx.beginPath();
            ctx.arc(q.x, q.y, this.W < 620 ? 3 : 4, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.restore();

        this._legend([
            ['样本点', this._COL.blue],
            ['最小二乘线', this._COL.cyan],
            ['生成趋势', this._COL.violet]
        ], box);
        this._canvasBadge(`SSE ${fit.sse.toFixed(2)}  |  R² ${fit.r2.toFixed(3)}`, box);
    },

    _eulerData() {
        const K = 1;
        const T = 8;
        const r = this.eulerR;
        const y0 = this.eulerY0;
        const exact = (t) => K / (1 + ((K - y0) / y0) * Math.exp(-r * t));
        const euler = [{ t: 0, y: y0 }];
        let t = 0;
        let y = y0;
        while (t < T - 1e-9) {
            const dt = Math.min(this.eulerH, T - t);
            y = y + dt * r * y * (1 - y / K);
            t += dt;
            euler.push({ t, y });
        }
        const exactPts = [];
        for (let i = 0; i <= 160; i++) {
            const tt = T * i / 160;
            exactPts.push({ t: tt, y: exact(tt) });
        }
        const last = euler[euler.length - 1];
        const error = Math.abs(last.y - exact(T));
        return { K, T, r, y0, exact, exactPts, euler, error, steps: euler.length - 1, xr: [0, T], yr: [0, 1.12] };
    },

    _drawEuler() {
        const { ctx } = this;
        const box = this._plotBox();
        const data = this._eulerData();
        this._lastEuler = data;
        this._drawGrid(box, data.xr, data.yr, 't', 'y');

        ctx.save();
        ctx.beginPath();
        ctx.rect(box.l, box.t, box.r - box.l, box.b - box.t);
        ctx.clip();

        ctx.strokeStyle = 'rgba(148, 163, 184, 0.26)';
        ctx.lineWidth = 1;
        for (let gx = 0.5; gx < data.T; gx += 1) {
            for (let gy = 0.12; gy <= 1.0; gy += 0.18) {
                const slope = data.r * gy * (1 - gy / data.K);
                const p = this._pt(gx, gy, data.xr, data.yr, box);
                const len = this.W < 620 ? 13 : 18;
                const angle = Math.atan(slope);
                ctx.beginPath();
                ctx.moveTo(p.x - Math.cos(angle) * len / 2, p.y + Math.sin(angle) * len / 2);
                ctx.lineTo(p.x + Math.cos(angle) * len / 2, p.y - Math.sin(angle) * len / 2);
                ctx.stroke();
            }
        }

        ctx.strokeStyle = this._COL.green;
        ctx.lineWidth = 3;
        ctx.beginPath();
        data.exactPts.forEach((p, i) => {
            const q = this._pt(p.t, p.y, data.xr, data.yr, box);
            if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
        });
        ctx.stroke();

        ctx.strokeStyle = this._COL.amber;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        data.euler.forEach((p, i) => {
            const q = this._pt(p.t, p.y, data.xr, data.yr, box);
            if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
        });
        ctx.stroke();
        data.euler.forEach(p => {
            const q = this._pt(p.t, p.y, data.xr, data.yr, box);
            ctx.fillStyle = this._COL.amber;
            ctx.beginPath();
            ctx.arc(q.x, q.y, 3.8, 0, Math.PI * 2);
            ctx.fill();
        });

        const endEuler = data.euler[data.euler.length - 1];
        const pe = this._pt(data.T, endEuler.y, data.xr, data.yr, box);
        const px = this._pt(data.T, data.exact(data.T), data.xr, data.yr, box);
        ctx.strokeStyle = this._COL.rose;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(pe.x, pe.y);
        ctx.lineTo(px.x, px.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        this._legend([
            ['精确解', this._COL.green],
            ['Euler 折线', this._COL.amber],
            ['终点误差', this._COL.rose]
        ], box);
        this._canvasBadge(`${data.steps} 步  |  |误差| ${data.error.toFixed(4)}`, box);
    },

    _fNewton(x) {
        return x * x * x - x - this.newtonC;
    },

    _dfNewton(x) {
        return 3 * x * x - 1;
    },

    _newtonTrace() {
        const trace = [];
        const segments = [];
        let x = this.newtonX0;
        let status = '继续逼近';
        for (let i = 0; i <= this.newtonSteps; i++) {
            const y = this._fNewton(x);
            trace.push({ x, y });
            if (Math.abs(y) < 1e-5) {
                status = '已接近一个根';
                break;
            }
            if (i === this.newtonSteps) break;
            const d = this._dfNewton(x);
            if (Math.abs(d) < 0.04) {
                status = '导数接近 0，切线法容易失效';
                break;
            }
            const nx = x - y / d;
            segments.push({ x, y, d, nx });
            if (!Number.isFinite(nx) || Math.abs(nx) > 8) {
                status = '下一步跳出显示范围';
                break;
            }
            x = nx;
        }
        const roots = this._rootsForC();
        const last = trace[trace.length - 1];
        const nearest = roots.length ? roots.reduce((best, r) => Math.abs(r - last.x) < Math.abs(best - last.x) ? r : best, roots[0]) : null;
        const error = nearest == null ? NaN : Math.abs(last.x - nearest);
        return { trace, segments, roots, nearest, error, status, xr: [-2.4, 2.4], yr: [-5.5, 5.5] };
    },

    _rootsForC() {
        const roots = [];
        const xmin = -2.4;
        const xmax = 2.4;
        const steps = 480;
        const f = x => x * x * x - x - this.newtonC;
        let prevX = xmin;
        let prevY = f(prevX);
        const addRoot = (x) => {
            if (!roots.some(r => Math.abs(r - x) < 1e-4)) roots.push(x);
        };
        if (Math.abs(prevY) < 1e-6) addRoot(prevX);
        for (let i = 1; i <= steps; i++) {
            const x = xmin + (xmax - xmin) * i / steps;
            const y = f(x);
            if (Math.abs(y) < 1e-5) addRoot(x);
            if (prevY * y < 0) {
                let lo = prevX;
                let hi = x;
                let flo = prevY;
                for (let k = 0; k < 44; k++) {
                    const mid = (lo + hi) / 2;
                    const fm = f(mid);
                    if (flo * fm <= 0) {
                        hi = mid;
                    } else {
                        lo = mid;
                        flo = fm;
                    }
                }
                addRoot((lo + hi) / 2);
            }
            prevX = x;
            prevY = y;
        }
        return roots.sort((a, b) => a - b);
    },

    _drawNewton() {
        const { ctx } = this;
        const box = this._plotBox();
        const data = this._newtonTrace();
        this._lastNewton = data;
        this._drawGrid(box, data.xr, data.yr, 'x', 'f(x)');

        ctx.save();
        ctx.beginPath();
        ctx.rect(box.l, box.t, box.r - box.l, box.b - box.t);
        ctx.clip();

        ctx.strokeStyle = this._COL.cyan;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        for (let i = 0; i <= 180; i++) {
            const x = data.xr[0] + (data.xr[1] - data.xr[0]) * i / 180;
            const p = this._pt(x, this._fNewton(x), data.xr, data.yr, box);
            if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();

        data.roots.forEach(root => {
            const p = this._pt(root, 0, data.xr, data.yr, box);
            ctx.fillStyle = this._COL.green;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
            ctx.fill();
        });

        data.segments.forEach((seg, i) => {
            const alpha = Math.max(0.28, 0.84 - i * 0.08);
            const a = this._pt(seg.x, seg.y, data.xr, data.yr, box);
            const b = this._pt(seg.nx, 0, data.xr, data.yr, box);
            ctx.strokeStyle = `rgba(251, 191, 36, ${alpha})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            const nextY = this._fNewton(seg.nx);
            const c = this._pt(seg.nx, nextY, data.xr, data.yr, box);
            ctx.strokeStyle = `rgba(251, 113, 133, ${alpha})`;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(b.x, b.y);
            ctx.lineTo(c.x, c.y);
            ctx.stroke();
            ctx.setLineDash([]);
        });

        data.trace.forEach((p, i) => {
            const q = this._pt(p.x, p.y, data.xr, data.yr, box);
            ctx.fillStyle = i === 0 ? this._COL.violet : this._COL.amber;
            ctx.beginPath();
            ctx.arc(q.x, q.y, i === 0 ? 5 : 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = this._COL.text;
            ctx.font = '11px system-ui, sans-serif';
            ctx.fillText(`x${i}`, q.x + 6, q.y - 6);
        });
        ctx.restore();

        this._legend([
            ['函数 f(x)', this._COL.cyan],
            ['切线步', this._COL.amber],
            ['可达根', this._COL.green]
        ], box);
        const end = data.trace[data.trace.length - 1];
        this._canvasBadge(`末项 x=${end.x.toFixed(4)}  |  f(x)=${end.y.toFixed(4)}`, box);
    },

    _legend(items, box) {
        const { ctx } = this;
        ctx.save();
        let x = box.l + 8;
        const y = box.t - 16;
        ctx.font = '12px system-ui, sans-serif';
        items.forEach(([label, color]) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(x + 5, y - 3, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = this._COL.muted;
            ctx.fillText(label, x + 15, y);
            x += ctx.measureText(label).width + 54;
        });
        ctx.restore();
    },

    _canvasBadge(text, box) {
        const { ctx } = this;
        ctx.save();
        ctx.font = '12px "SFMono-Regular", Consolas, monospace';
        const w = Math.min(ctx.measureText(text).width + 24, box.r - box.l - 18);
        const x = box.r - w - 8;
        const y = box.t + 10;
        ctx.fillStyle = this._COL.panel;
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
        this._roundRect(ctx, x, y, w, 28, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = this._COL.text;
        ctx.fillText(text, x + 12, y + 19);
        ctx.restore();
    },

    _roundRect(ctx, x, y, w, h, r) {
        const rr = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.lineTo(x + w - rr, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
        ctx.lineTo(x + w, y + h - rr);
        ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
        ctx.lineTo(x + rr, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
        ctx.lineTo(x, y + rr);
        ctx.quadraticCurveTo(x, y, x + rr, y);
    },

    _updateInfo() {
        const info = document.getElementById('mn-info');
        if (!info) return;
        if (this.mode === 'fit') {
            const f = this._lastFit;
            info.innerHTML = `
                <div class="mn-info-title">线性拟合把“误差”变成可比较的量</div>
                <div class="mn-info-subtitle">ŷ = ${f.intercept.toFixed(3)} ${f.slope >= 0 ? '+' : '-'} ${Math.abs(f.slope).toFixed(3)}x</div>
                <div class="mn-equation">SSE = Σ(yᵢ−ŷᵢ)² = ${f.sse.toFixed(3)}，R² = ${f.r2.toFixed(3)}</div>
                <div class="mn-row"><span class="mn-key">当前观察</span><span>${Math.abs(this.fitCurve) < 0.08 ? '生成趋势接近线性，残差主要来自随机扰动。' : '生成趋势含有弯曲成分，线性模型会留下系统性残差。'}</span></div>
                <div class="mn-row"><span class="mn-key">适用范围</span><span>最小二乘线适合描述近似线性关系；R² 高不代表因果关系成立。</span></div>
                <div class="mn-note">参考依据：OpenStax Introductory Statistics 12.3。样本为教学生成数据，用来观察残差与平方误差，不替代真实建模流程。</div>`;
        } else if (this.mode === 'euler') {
            const e = this._lastEuler;
            info.innerHTML = `
                <div class="mn-info-title">Euler 方法用局部斜率拼出近似解</div>
                <div class="mn-info-subtitle">dy/dt = r y(1−y/K)，K=1，r=${e.r.toFixed(2)}</div>
                <div class="mn-equation">yₙ₊₁ = yₙ + h·f(tₙ,yₙ)，h=${this.eulerH.toFixed(2)}，共 ${e.steps} 步</div>
                <div class="mn-row"><span class="mn-key">误差读数</span><span>t=8 时 |Euler−精确解| ≈ ${e.error.toFixed(4)}。</span></div>
                <div class="mn-row"><span class="mn-key">适用范围</span><span>步长越大计算越少，但局部线性近似累积误差通常更明显。</span></div>
                <div class="mn-note">参考依据：OpenStax Calculus Volume 2 4.2。这里选用 logistic 方程展示步长影响，参数为无量纲教学模型。</div>`;
        } else {
            const n = this._lastNewton;
            const end = n.trace[n.trace.length - 1];
            const rootText = n.nearest == null ? '未在显示区找到可比较根' : `最近可达根 ${n.nearest.toFixed(5)}，|xₖ−root|≈${n.error.toExponential(2)}`;
            info.innerHTML = `
                <div class="mn-info-title">Newton 法把切线与 x 轴交点作为下一次猜测</div>
                <div class="mn-info-subtitle">f(x)=x³−x−c，c=${this.newtonC.toFixed(2)}，当前状态：${n.status}</div>
                <div class="mn-equation">xₙ₊₁ = xₙ − f(xₙ)/f′(xₙ)，末项 f(xₖ)=${end.y.toFixed(5)}</div>
                <div class="mn-row"><span class="mn-key">当前观察</span><span>${rootText}</span></div>
                <div class="mn-row"><span class="mn-key">适用范围</span><span>初值要靠近目标根，且迭代点处导数不能接近 0；否则可能跳到别的根或失效。</span></div>
                <div class="mn-note">参考依据：OpenStax Calculus Volume 1 4.9。图中切线链路展示迭代机制，不能只凭迭代次数判断一定收敛。</div>`;
        }
    }
};

function initModelingNumerical() {
    ModelingNumerical.init();
}

if (typeof window !== 'undefined') {
    window.ModelingNumerical = ModelingNumerical;
    window.initModelingNumerical = initModelingNumerical;
}
