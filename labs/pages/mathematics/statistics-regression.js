// ===== Statistics & Regression =====
// 双模式：线性回归（散点+最小二乘+相关系数）/ 统计分布（直方图+均值方差+正态+3σ）
// 人教版必修二第9章 + 选择性必修三第7-8章

const StatReg = {
    canvas: null, ctx: null, W: 0, H: 0,
    _listeners: [],
    _resizeObs: null,

    mode: 'regression',     // 'regression' | 'distribution'

    // regression params
    rn: 40, rNoise: 1.2, rSlope: 0.8, rIntercept: 1.0,
    showResiduals: true, showTrue: false,
    reg: null,              // { pts:[{x,y}], b, a, r, r2, xbar, ybar, xmin,xmax,ymin,ymax }

    // distribution params
    dn: 300, dMu: 50, dSigma: 10, bins: 24,
    showNormal: true, showSigma: true,
    dist: null,             // { sample:[], mean, std, hist:[], binW, xmin, xmax, maxDen }

    _on(el, evt, fn, opts) { el.addEventListener(evt, fn, opts); this._listeners.push({ el, evt, fn, opts }); },

    _gauss() {
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },

    /* ── lifecycle ── */
    init() {
        this.canvas = document.getElementById('sr-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this._genRegression();
        this._genDistribution();
        this._buildControls();
        this.resize();
        this._bindEvents();
        this.draw();
        this.updateInfo();
    },

    destroy() {
        for (const l of this._listeners) l.el.removeEventListener(l.evt, l.fn, l.opts);
        this._listeners = [];
        if (this._resizeObs) { this._resizeObs.disconnect(); this._resizeObs = null; }
    },

    resize() {
        const wrap = this.canvas.parentElement;
        if (!wrap) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = wrap.getBoundingClientRect();
        this.W = rect.width;
        this.H = Math.min(Math.max(rect.width * 0.52, 320), 440);
        if (this.W <= 0 || this.H <= 0) return;
        this.canvas.width = this.W * dpr;
        this.canvas.height = this.H * dpr;
        this.canvas.style.width = this.W + 'px';
        this.canvas.style.height = this.H + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.draw();
    },

    /* ── data generation ── */
    _genRegression() {
        const pts = [];
        for (let i = 0; i < this.rn; i++) {
            const x = 0.5 + Math.random() * 9;
            const y = this.rIntercept + this.rSlope * x + this.rNoise * this._gauss();
            pts.push({ x, y });
        }
        const n = pts.length;
        let sx = 0, sy = 0;
        pts.forEach(p => { sx += p.x; sy += p.y; });
        const xbar = sx / n, ybar = sy / n;
        let Sxx = 0, Syy = 0, Sxy = 0;
        pts.forEach(p => { const dx = p.x - xbar, dy = p.y - ybar; Sxx += dx * dx; Syy += dy * dy; Sxy += dx * dy; });
        const b = Sxx ? Sxy / Sxx : 0;
        const a = ybar - b * xbar;
        const r = (Sxx && Syy) ? Sxy / Math.sqrt(Sxx * Syy) : 0;
        let ymin = Infinity, ymax = -Infinity;
        pts.forEach(p => { if (p.y < ymin) ymin = p.y; if (p.y > ymax) ymax = p.y; });
        const pad = (ymax - ymin) * 0.12 || 1;
        this.reg = { pts, b, a, r, r2: r * r, xbar, ybar, xmin: 0, xmax: 10, ymin: ymin - pad, ymax: ymax + pad };
    },

    _genDistribution() {
        const sample = [];
        for (let i = 0; i < this.dn; i++) sample.push(this.dMu + this.dSigma * this._gauss());
        const n = sample.length;
        const mean = sample.reduce((s, v) => s + v, 0) / n;
        const variance = sample.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n;
        const std = Math.sqrt(variance);
        const xmin = this.dMu - 4 * this.dSigma, xmax = this.dMu + 4 * this.dSigma;
        const binW = (xmax - xmin) / this.bins;
        const hist = new Array(this.bins).fill(0);
        sample.forEach(v => {
            let idx = Math.floor((v - xmin) / binW);
            if (idx < 0) idx = 0; if (idx >= this.bins) idx = this.bins - 1;
            hist[idx]++;
        });
        // density per bin = count/(n*binW)
        const den = hist.map(c => c / (n * binW));
        const normPeak = 1 / (this.dSigma * Math.sqrt(2 * Math.PI));
        const maxDen = Math.max(Math.max(...den), normPeak) * 1.12;
        this.dist = { sample, mean, std, variance, hist, den, binW, xmin, xmax, maxDen };
    },

    /* ── controls ── */
    _buildControls() {
        const ctrl = document.getElementById('sr-controls');
        if (!ctrl) return;
        const tabs = `
            <div class="sr-tabs">
                <button class="sr-mode-btn ${this.mode === 'regression' ? 'active' : ''}" data-mode="regression">📈 线性回归</button>
                <button class="sr-mode-btn ${this.mode === 'distribution' ? 'active' : ''}" data-mode="distribution">📊 统计分布</button>
            </div>`;
        let body;
        if (this.mode === 'regression') {
            body = `
            <div class="sr-grid">
                <div class="sr-field"><label>样本量 n = <span id="sr-rn-val">${this.rn}</span></label><input type="range" id="sr-rn" min="8" max="120" step="1" value="${this.rn}" class="sr-slider"></div>
                <div class="sr-field"><label>噪声强度 = <span id="sr-noise-val">${this.rNoise.toFixed(1)}</span></label><input type="range" id="sr-noise" min="0" max="4" step="0.1" value="${this.rNoise}" class="sr-slider"></div>
                <div class="sr-field"><label>真实斜率 = <span id="sr-slope-val">${this.rSlope.toFixed(1)}</span></label><input type="range" id="sr-slope" min="-2" max="2" step="0.1" value="${this.rSlope}" class="sr-slider"></div>
            </div>
            <div class="sr-toggles">
                <label class="sr-toggle"><input type="checkbox" id="sr-chk-res" ${this.showResiduals ? 'checked' : ''}>显示残差线</label>
                <label class="sr-toggle"><input type="checkbox" id="sr-chk-true" ${this.showTrue ? 'checked' : ''}>显示真实直线</label>
                <button class="sr-btn" id="sr-regen">🔄 重新生成样本</button>
            </div>`;
        } else {
            body = `
            <div class="sr-grid">
                <div class="sr-field"><label>样本量 n = <span id="sr-dn-val">${this.dn}</span></label><input type="range" id="sr-dn" min="50" max="2000" step="50" value="${this.dn}" class="sr-slider"></div>
                <div class="sr-field"><label>总体标准差 σ = <span id="sr-sigma-val">${this.dSigma}</span></label><input type="range" id="sr-sigma" min="5" max="20" step="1" value="${this.dSigma}" class="sr-slider"></div>
                <div class="sr-field"><label>分组数 = <span id="sr-bins-val">${this.bins}</span></label><input type="range" id="sr-bins" min="10" max="40" step="2" value="${this.bins}" class="sr-slider"></div>
            </div>
            <div class="sr-toggles">
                <label class="sr-toggle"><input type="checkbox" id="sr-chk-norm" ${this.showNormal ? 'checked' : ''}>叠加正态曲线</label>
                <label class="sr-toggle"><input type="checkbox" id="sr-chk-sigma" ${this.showSigma ? 'checked' : ''}>显示 3σ 区间</label>
                <button class="sr-btn" id="sr-regen">🔄 重新抽样</button>
            </div>`;
        }
        ctrl.innerHTML = tabs + body;
    },

    _bindEvents() {
        const ctrl = document.getElementById('sr-controls');
        if (!ctrl) return;

        ctrl.querySelectorAll('.sr-mode-btn').forEach(btn => {
            this._on(btn, 'click', () => {
                if (this.mode === btn.dataset.mode) return;
                this.mode = btn.dataset.mode;
                this._buildControls();
                this._bindEvents();
                this.draw();
                this.updateInfo();
            });
        });

        const slider = (id, valId, prop, fmt, regen) => {
            const el = document.getElementById(id);
            const vEl = document.getElementById(valId);
            if (!el) return;
            this._on(el, 'input', () => {
                this[prop] = parseFloat(el.value);
                if (vEl) vEl.textContent = fmt ? fmt(this[prop]) : this[prop];
                regen();
                this.draw();
                this.updateInfo();
            });
        };

        if (this.mode === 'regression') {
            slider('sr-rn', 'sr-rn-val', 'rn', v => v | 0, () => this._genRegression());
            slider('sr-noise', 'sr-noise-val', 'rNoise', v => v.toFixed(1), () => this._genRegression());
            slider('sr-slope', 'sr-slope-val', 'rSlope', v => v.toFixed(1), () => this._genRegression());
            this._chk('sr-chk-res', 'showResiduals');
            this._chk('sr-chk-true', 'showTrue');
        } else {
            slider('sr-dn', 'sr-dn-val', 'dn', v => v | 0, () => this._genDistribution());
            slider('sr-sigma', 'sr-sigma-val', 'dSigma', v => v | 0, () => this._genDistribution());
            slider('sr-bins', 'sr-bins-val', 'bins', v => v | 0, () => this._genDistribution());
            this._chk('sr-chk-norm', 'showNormal');
            this._chk('sr-chk-sigma', 'showSigma');
        }

        const regen = document.getElementById('sr-regen');
        if (regen) this._on(regen, 'click', () => {
            if (this.mode === 'regression') this._genRegression(); else this._genDistribution();
            this.draw();
            this.updateInfo();
        });

        const wrap = this.canvas.parentElement;
        if (wrap && window.ResizeObserver) {
            this._resizeObs = new ResizeObserver(() => this.resize());
            this._resizeObs.observe(wrap);
        }
    },

    _chk(id, prop) {
        const el = document.getElementById(id);
        if (el) this._on(el, 'change', () => { this[prop] = el.checked; this.draw(); this.updateInfo(); });
    },

    /* ══════════════════════════════════════════ drawing ══════════════════════════════════════════ */
    _plotBox() {
        return { l: 48, r: this.W - 16, t: 26, b: this.H - 34 };
    },

    draw() {
        const { ctx, W, H } = this;
        if (!ctx) return;
        ctx.clearRect(0, 0, W, H);
        if (this.mode === 'regression') this._drawRegression();
        else this._drawDistribution();
    },

    _drawAxes(box, xmin, xmax, ymin, ymax, xlabel, ylabel) {
        const { ctx } = this;
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '11px ' + CF.sans;
        // grid + ticks (5 each)
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        for (let i = 0; i <= 5; i++) {
            const yy = box.b - (box.b - box.t) * i / 5;
            const yv = ymin + (ymax - ymin) * i / 5;
            ctx.beginPath(); ctx.moveTo(box.l, yy); ctx.lineTo(box.r, yy);
            ctx.strokeStyle = i === 0 ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.07)';
            ctx.stroke();
            ctx.fillText(yv.toFixed(this.mode === 'regression' ? 1 : 0), box.l - 5, yy);
        }
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        for (let i = 0; i <= 5; i++) {
            const xx = box.l + (box.r - box.l) * i / 5;
            const xv = xmin + (xmax - xmin) * i / 5;
            ctx.beginPath(); ctx.moveTo(xx, box.t); ctx.lineTo(xx, box.b);
            ctx.strokeStyle = i === 0 ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.07)';
            ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.fillText(xv.toFixed(0), xx, box.b + 5);
        }
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '12px ' + CF.sans;
        ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
        ctx.fillText(xlabel, box.r, box.b - 4 + 18);
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(ylabel, box.l + 2, box.t - 20);
    },

    _drawRegression() {
        const { ctx } = this;
        const r = this.reg;
        const box = this._plotBox();
        const { xmin, xmax, ymin, ymax } = r;
        const X = x => box.l + (box.r - box.l) * (x - xmin) / (xmax - xmin);
        const Y = y => box.b - (box.b - box.t) * (y - ymin) / (ymax - ymin);
        this._drawAxes(box, xmin, xmax, ymin, ymax, 'x', 'y');

        // residuals
        if (this.showResiduals) {
            ctx.strokeStyle = 'rgba(229,192,123,0.45)';
            ctx.lineWidth = 1;
            r.pts.forEach(p => {
                const yh = r.a + r.b * p.x;
                ctx.beginPath(); ctx.moveTo(X(p.x), Y(p.y)); ctx.lineTo(X(p.x), Y(yh)); ctx.stroke();
            });
        }
        // true line
        if (this.showTrue) {
            ctx.strokeStyle = 'rgba(120,200,140,0.6)';
            ctx.setLineDash([6, 5]); ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(X(xmin), Y(this.rIntercept + this.rSlope * xmin));
            ctx.lineTo(X(xmax), Y(this.rIntercept + this.rSlope * xmax));
            ctx.stroke(); ctx.setLineDash([]);
        }
        // regression line
        ctx.strokeStyle = '#e06c75'; ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(X(xmin), Y(r.a + r.b * xmin));
        ctx.lineTo(X(xmax), Y(r.a + r.b * xmax));
        ctx.stroke();
        // points
        ctx.fillStyle = '#5b9bd5';
        r.pts.forEach(p => {
            ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 3.2, 0, Math.PI * 2); ctx.fill();
        });
        // centroid
        ctx.fillStyle = '#f0d9a8';
        ctx.beginPath(); ctx.arc(X(r.xbar), Y(r.ybar), 5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1; ctx.stroke();

        // equation label
        ctx.fillStyle = '#e06c75';
        ctx.font = 'bold 13px ' + CF.mono;
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(`ŷ = ${r.a.toFixed(2)} ${r.b >= 0 ? '+' : '−'} ${Math.abs(r.b).toFixed(2)}x`, box.l + 8, box.t + 4);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '12px ' + CF.mono;
        ctx.fillText(`r = ${r.r.toFixed(3)}   R² = ${r.r2.toFixed(3)}`, box.l + 8, box.t + 22);
    },

    _drawDistribution() {
        const { ctx } = this;
        const d = this.dist;
        const box = this._plotBox();
        const { xmin, xmax, maxDen, binW } = d;
        const X = x => box.l + (box.r - box.l) * (x - xmin) / (xmax - xmin);
        const Yd = den => box.b - (box.b - box.t) * den / maxDen;
        this._drawAxes(box, xmin, xmax, 0, maxDen, 'x', '频率/组距');

        // 3σ bands
        if (this.showSigma) {
            const bands = [
                { k: 3, color: 'rgba(91,141,206,0.06)' },
                { k: 2, color: 'rgba(91,141,206,0.08)' },
                { k: 1, color: 'rgba(91,141,206,0.12)' },
            ];
            bands.forEach(bd => {
                const x1 = X(this.dMu - bd.k * this.dSigma), x2 = X(this.dMu + bd.k * this.dSigma);
                ctx.fillStyle = bd.color;
                ctx.fillRect(x1, box.t, x2 - x1, box.b - box.t);
            });
            // sigma boundary lines + labels
            ctx.font = '11px ' + CF.mono;
            ctx.textAlign = 'center'; ctx.textBaseline = 'top';
            [-3, -2, -1, 1, 2, 3].forEach(k => {
                const xx = X(this.dMu + k * this.dSigma);
                ctx.strokeStyle = 'rgba(91,141,206,0.3)';
                ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(xx, box.t); ctx.lineTo(xx, box.b); ctx.stroke(); ctx.setLineDash([]);
                ctx.fillStyle = 'rgba(188,217,245,0.7)';
                ctx.fillText((k > 0 ? '+' : '') + k + 'σ', xx, box.t + 2);
            });
        }

        // histogram bars
        d.den.forEach((den, i) => {
            const x1 = X(xmin + i * binW), x2 = X(xmin + (i + 1) * binW);
            const y = Yd(den);
            ctx.fillStyle = 'rgba(91,155,213,0.45)';
            ctx.fillRect(x1 + 0.5, y, (x2 - x1) - 1, box.b - y);
            ctx.strokeStyle = 'rgba(91,155,213,0.7)'; ctx.lineWidth = 1;
            ctx.strokeRect(x1 + 0.5, y, (x2 - x1) - 1, box.b - y);
        });

        // normal curve (using true mu/sigma)
        if (this.showNormal) {
            ctx.strokeStyle = '#e06c75'; ctx.lineWidth = 2.2;
            ctx.beginPath();
            const N = 120;
            for (let i = 0; i <= N; i++) {
                const x = xmin + (xmax - xmin) * i / N;
                const den = Math.exp(-((x - this.dMu) ** 2) / (2 * this.dSigma ** 2)) / (this.dSigma * Math.sqrt(2 * Math.PI));
                const px = X(x), py = Yd(den);
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.stroke();
        }

        // mean line
        ctx.strokeStyle = '#f0d9a8'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(X(d.mean), box.t); ctx.lineTo(X(d.mean), box.b); ctx.stroke();
        ctx.fillStyle = '#f0d9a8'; ctx.font = '11px ' + CF.mono;
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText('x̄', X(d.mean) + 3, box.t + 2);
    },

    /* ── proportion within k·σ of sample ── */
    _within(k) {
        const d = this.dist;
        const lo = this.dMu - k * this.dSigma, hi = this.dMu + k * this.dSigma;
        const c = d.sample.filter(v => v >= lo && v <= hi).length;
        return (c / d.sample.length * 100);
    },

    /* ── info / edu ── */
    updateInfo() {
        const el = document.getElementById('sr-info');
        if (!el) return;
        el.innerHTML = (this.mode === 'regression') ? this._infoRegression() : this._infoDistribution();
    },

    _infoRegression() {
        const r = this.reg;
        const strength = Math.abs(r.r) > 0.8 ? '强相关' : Math.abs(r.r) > 0.5 ? '中等相关' : Math.abs(r.r) > 0.3 ? '弱相关' : '几乎不相关';
        const dir = r.r > 0 ? '正' : '负';
        return `
            <div class="sr-info-title">线性回归分析</div>
            <div class="sr-info-subtitle">最小二乘法 · 相关系数</div>
            <div class="sr-eq">ŷ = ${r.a.toFixed(3)} ${r.b >= 0 ? '+' : '−'} ${Math.abs(r.b).toFixed(3)}·x</div>
            <div class="math-row"><span class="math-key">回归斜率 b̂</span>${r.b.toFixed(4)}（x 每增 1，ŷ 平均变化 ${r.b.toFixed(3)}）</div>
            <div class="math-row"><span class="math-key">截距 â</span>${r.a.toFixed(4)}</div>
            <div class="math-row"><span class="math-key--amber">相关系数 r</span>${r.r.toFixed(4)} → ${dir}${strength}</div>
            <div class="math-row"><span class="math-key">决定系数 R²</span>${r.r2.toFixed(4)}（回归可解释 ${(r.r2 * 100).toFixed(1)}% 的变异）</div>
            <div class="math-row"><span class="math-key">回归中心</span>(x̄, ȳ) = (${r.xbar.toFixed(2)}, ${r.ybar.toFixed(2)})，回归直线必过此点</div>
            <div class="sr-edu">
                <div class="math-hd"><span class="math-tag">最小二乘法</span>核心公式</div>
                <div class="math-row"><span class="math-key">斜率</span>b̂ = Σ(xᵢ−x̄)(yᵢ−ȳ) / Σ(xᵢ−x̄)²</div>
                <div class="math-row"><span class="math-key">截距</span>â = ȳ − b̂·x̄</div>
                <div class="math-row"><span class="math-key--amber">相关系数</span>r = Σ(xᵢ−x̄)(yᵢ−ȳ) / √[Σ(xᵢ−x̄)²·Σ(yᵢ−ȳ)²]，−1≤r≤1</div>
                <div class="math-row"><span class="math-key">残差</span>eᵢ = yᵢ − ŷᵢ，最小二乘使 Σeᵢ² 最小（图中橙色竖线）</div>
                <div class="math-note">💡 |r| 越接近 1 线性关系越强；R²=r² 衡量拟合优度。调大噪声看散点变散、r 下降、残差变长。</div>
            </div>
        `;
    },

    _infoDistribution() {
        const d = this.dist;
        const p1 = this._within(1), p2 = this._within(2), p3 = this._within(3);
        return `
            <div class="sr-info-title">统计分布与正态曲线</div>
            <div class="sr-info-subtitle">均值 / 方差 / 标准差 · 3σ 原则</div>
            <div class="math-row"><span class="math-key">样本均值 x̄</span>${d.mean.toFixed(3)}（总体 μ = ${this.dMu}）</div>
            <div class="math-row"><span class="math-key">样本方差 s²</span>${d.variance.toFixed(3)}</div>
            <div class="math-row"><span class="math-key--amber">样本标准差 s</span>${d.std.toFixed(3)}（总体 σ = ${this.dSigma}）</div>
            <div class="math-row"><span class="math-key">样本量 n</span>${this.dn}（n 越大，直方图越逼近正态曲线）</div>
            <div class="sr-band">
                <div class="sr-band-row"><span>μ ± 1σ 实测</span><strong>${p1.toFixed(1)}%</strong><span class="sr-band-th">理论 68.3%</span></div>
                <div class="sr-band-row"><span>μ ± 2σ 实测</span><strong>${p2.toFixed(1)}%</strong><span class="sr-band-th">理论 95.4%</span></div>
                <div class="sr-band-row"><span>μ ± 3σ 实测</span><strong>${p3.toFixed(1)}%</strong><span class="sr-band-th">理论 99.7%</span></div>
            </div>
            <div class="sr-edu">
                <div class="math-hd"><span class="math-tag">描述统计</span>核心公式</div>
                <div class="math-row"><span class="math-key">均值</span>x̄ = (1/n)Σxᵢ，反映数据集中趋势</div>
                <div class="math-row"><span class="math-key">方差</span>s² = (1/n)Σ(xᵢ−x̄)²，反映离散程度</div>
                <div class="math-row"><span class="math-key">标准差</span>s = √(s²)，与原数据同量纲</div>
                <div class="math-row"><span class="math-key--amber">3σ 原则</span>正态总体约 68.3% / 95.4% / 99.7% 落在 μ±1σ / 2σ / 3σ 内</div>
                <div class="math-note">💡 增大样本量 n 或分组数，直方图轮廓越贴合红色正态密度曲线；3σ 外的数据点通常视为异常值。</div>
            </div>
        `;
    }
};

function initStatReg() { StatReg.init(); }
window.initStatReg = initStatReg;
