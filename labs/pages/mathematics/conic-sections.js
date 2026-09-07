// ===== Conic Sections Visualization =====
// Ellipse, Hyperbola, Parabola with foci & directrix

const ConicSections = {
    canvas: null, ctx: null, W: 0, H: 0,
    _listeners: [],
    _resizeObs: null,
    _raf: null,
    time: 0,
    running: true,

    curve: 'ellipse', // 'ellipse', 'hyperbola', 'parabola'
    a: 3, b: 2, p: 2, // parameters
    traceAngle: 0,

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        this.canvas = document.getElementById('conic-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.time = 0;
        this.traceAngle = 0;
        this.running = true;
        this.resize();
        this.bindEvents();
        this.loop();
        this.updateInfo();
    },

    destroy() {
        this.running = false;
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
        for (const l of this._listeners) l.el.removeEventListener(l.evt, l.fn, l.opts);
        this._listeners = [];
        if (this._resizeObs) { this._resizeObs.disconnect(); this._resizeObs = null; }
    },

    resize() {
        const wrap = this.canvas.parentElement;
        if (!wrap) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = wrap.getBoundingClientRect();
        const w = rect.width;
        const h = Math.min(w * 0.6, 400);
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w;
        this.H = h;
    },

    bindEvents() {
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver(() => this.resize());
            this._resizeObs.observe(this.canvas.parentElement);
        }

        document.querySelectorAll('.conic-type-btn').forEach(btn => {
            this._on(btn, 'click', () => {
                document.querySelectorAll('.conic-type-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.curve = btn.dataset.type;
                this.traceAngle = 0;
                this.updateInfo();
            });
        });

        const bindSlider = (id, prop) => {
            const el = document.getElementById(id);
            if (!el) return;
            this._on(el, 'input', () => {
                this[prop] = parseFloat(el.value);
                const disp = document.getElementById(id + '-val');
                if (disp) disp.textContent = el.value;
                this.traceAngle = 0;
                this.updateInfo();
            });
        };
        bindSlider('conic-a', 'a');
        bindSlider('conic-b', 'b');
        bindSlider('conic-p', 'p');
    },

    updateInfo() {
        const el = document.getElementById('conic-info');
        if (!el) return;
        let html = '';
        if (this.curve === 'ellipse') {
            const c = Math.sqrt(Math.abs(this.a * this.a - this.b * this.b));
            const e = (c / this.a).toFixed(3);
            html = `<div class="math-hd"><span class="math-tag">椭圆</span>圆锥曲线知识点</div>
<div class="math-row"><span class="math-key">标准方程</span>x²/${this.a}² + y²/${this.b}² = 1 &nbsp; a=${this.a}, b=${this.b}, c=${c.toFixed(2)}</div>
<div class="math-row"><span class="math-key math-key--red">离心率</span>e = c/a = ${e} — 0 < e < 1，e 越小越接近圆</div>
<div class="math-row"><span class="math-key math-key--amber">焦点与准线</span>焦点 (±${c.toFixed(2)}, 0)；准线 x = ±a²/c — 焦点到准线距离 = a/e − c</div>
<div class="math-row"><span class="math-key">焦点距离</span>|PF₁| + |PF₂| = 2a — 椭圆的第一定义（到两焦点距离之和为常数）</div>
<div class="math-note">💡 人教版选择性必修1：椭圆的 a²=b²+c² 区别于双曲线。拖动滑块改变 a、b 观察形状和离心率的变化</div>`;
        } else if (this.curve === 'hyperbola') {
            const c = Math.sqrt(this.a * this.a + this.b * this.b);
            const e = (c / this.a).toFixed(3);
            html = `<div class="math-hd"><span class="math-tag">双曲线</span>圆锥曲线知识点</div>
<div class="math-row"><span class="math-key">标准方程</span>x²/${this.a}² − y²/${this.b}² = 1 &nbsp; a=${this.a}, b=${this.b}, c=${c.toFixed(2)}</div>
<div class="math-row"><span class="math-key math-key--red">离心率</span>e = c/a = ${e} — e > 1，e 越大开口越大</div>
<div class="math-row"><span class="math-key math-key--amber">渐近线</span>y = ±(b/a)x = ±${(this.b/this.a).toFixed(2)}x — 双曲线无限趋近但不相交</div>
<div class="math-row"><span class="math-key">焦点距离</span>||PF₁| − |PF₂|| = 2a — 双曲线的第一定义（到两焦点距离之差的绝对值为常数）</div>
<div class="math-note">💡 人教版选择性必修1：双曲线 c²=a²+b²。渐近线方程 y=±(b/a)x 是解题的关键辅助线</div>`;
        } else {
            html = `<div class="math-hd"><span class="math-tag">抛物线</span>圆锥曲线知识点</div>
<div class="math-row"><span class="math-key">标准方程</span>y² = ${(2*this.p).toFixed(1)}x &nbsp; p=${this.p}（焦点到准线距离）</div>
<div class="math-row"><span class="math-key math-key--red">焦点与准线</span>焦点 (${(this.p/2).toFixed(1)}, 0)；准线 x = −${(this.p/2).toFixed(1)}</div>
<div class="math-row"><span class="math-key math-key--amber">焦点距离</span>|PF| = x + p/2 — 抛物线上任意点到焦点的距离等于到准线的距离</div>
<div class="math-row"><span class="math-key">离心率</span>e = 1 — 抛物线只有一个焦点，开口大小由 p 决定</div>
<div class="math-note">💡 人教版选择性必修1：抛物线是 e=1 的圆锥曲线，光学反射镜和卫星天线都利用其焦点聚焦性质</div>`;
        }
        el.innerHTML = html;
    },

    loop() {
        if (!this.running) return;
        this.time += 0.016;
        this.traceAngle += 0.008;
        if (this.traceAngle > Math.PI * 2) this.traceAngle -= Math.PI * 2;
        this.draw();
        this._raf = requestAnimationFrame(() => this.loop());
    },

    draw() {
        const { ctx, W, H, curve } = this;
        if (!ctx || W === 0) return;
        ctx.clearRect(0, 0, W, H);

        const cx = W / 2, cy = H / 2;
        const scale = Math.min(W, H) / 12;

        // Grid
        this.drawGrid(cx, cy, scale);

        if (curve === 'ellipse') this.drawEllipse(cx, cy, scale);
        else if (curve === 'hyperbola') this.drawHyperbola(cx, cy, scale);
        else this.drawParabola(cx, cy, scale);
    },

    drawGrid(cx, cy, s) {
        const { ctx, W, H } = this;
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        for (let i = -6; i <= 6; i++) {
            ctx.beginPath();
            ctx.moveTo(cx + i * s, 0); ctx.lineTo(cx + i * s, H);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(0, cy + i * s); ctx.lineTo(W, cy + i * s);
            ctx.stroke();
        }
        // Axes
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
    },

    drawEllipse(cx, cy, s) {
        const { ctx, a, b, traceAngle } = this;
        const c = Math.sqrt(Math.abs(a * a - b * b));

        // Curve
        ctx.strokeStyle = 'rgba(91,141,206,0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let t = 0; t <= Math.PI * 2 + 0.01; t += 0.02) {
            const x = cx + a * Math.cos(t) * s;
            const y = cy + b * Math.sin(t) * s;
            t === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Foci
        [[-c, 0], [c, 0]].forEach(([fx, fy], i) => {
            ctx.fillStyle = '#e5c07b';
            ctx.beginPath();
            ctx.arc(cx + fx * s, cy + fy * s, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(229,192,123,0.6)';
            ctx.font = '16px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillText(i === 0 ? 'F\u2081' : 'F\u2082', cx + fx * s, cy + fy * s + 14);
        });

        // Tracing point
        const px = a * Math.cos(traceAngle);
        const py = b * Math.sin(traceAngle);
        const sx = cx + px * s, sy = cy + py * s;
        ctx.fillStyle = '#e06c75';
        ctx.beginPath();
        ctx.arc(sx, sy, 5, 0, Math.PI * 2);
        ctx.fill();

        // Lines to foci
        ctx.strokeStyle = 'rgba(229,192,123,0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        [[-c, 0], [c, 0]].forEach(([fx]) => {
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(cx + fx * s, cy);
            ctx.stroke();
        });
        ctx.setLineDash([]);

        // |PF1| + |PF2| = 2a label
        const d1 = Math.hypot(px + c, py);
        const d2 = Math.hypot(px - c, py);
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '16px ' + CF.mono;
        ctx.textAlign = 'left';
        ctx.fillText('|PF\u2081|+|PF\u2082| = ' + d1.toFixed(2) + '+' + d2.toFixed(2) + ' = ' + (d1 + d2).toFixed(2), 10, 20);
        ctx.fillText('2a = ' + (2 * a).toFixed(2), 10, 34);
    },

    drawHyperbola(cx, cy, s) {
        const { ctx, a, b, traceAngle } = this;
        const c = Math.sqrt(a * a + b * b);

        // Asymptotes
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        const slope = b / a;
        ctx.beginPath(); ctx.moveTo(cx - 6 * s, cy - 6 * s * slope); ctx.lineTo(cx + 6 * s, cy + 6 * s * slope); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - 6 * s, cy + 6 * s * slope); ctx.lineTo(cx + 6 * s, cy - 6 * s * slope); ctx.stroke();
        ctx.setLineDash([]);

        // Right branch
        ctx.strokeStyle = 'rgba(91,141,206,0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let t = -1.3; t <= 1.3; t += 0.02) {
            const x = cx + a * (1 / Math.cos(t)) * s;
            const y = cy + b * Math.tan(t) * s;
            if (x > cx - 0.5 * this.W && x < cx + 0.5 * this.W) {
                t === -1.3 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
        }
        ctx.stroke();

        // Left branch
        ctx.beginPath();
        for (let t = -1.3; t <= 1.3; t += 0.02) {
            const x = cx - a * (1 / Math.cos(t)) * s;
            const y = cy - b * Math.tan(t) * s;
            if (x > cx - 0.5 * this.W && x < cx + 0.5 * this.W) {
                t === -1.3 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
        }
        ctx.stroke();

        // Foci
        [[-c, 0], [c, 0]].forEach(([fx, fy], i) => {
            ctx.fillStyle = '#e5c07b';
            ctx.beginPath();
            ctx.arc(cx + fx * s, cy, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(229,192,123,0.6)';
            ctx.font = '16px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillText(i === 0 ? 'F\u2081' : 'F\u2082', cx + fx * s, cy + 14);
        });

        // Tracing point (right branch)
        const tParam = traceAngle % (Math.PI * 2);
        const tt = -1.2 + (tParam / (Math.PI * 2)) * 2.4;
        const px = a / Math.cos(tt);
        const py = b * Math.tan(tt);
        const sx = cx + px * s, sy = cy + py * s;
        ctx.fillStyle = '#e06c75';
        ctx.beginPath();
        ctx.arc(sx, sy, 5, 0, Math.PI * 2);
        ctx.fill();

        // ||PF1| - |PF2|| = 2a
        const d1 = Math.hypot(px + c, py);
        const d2 = Math.hypot(px - c, py);
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '16px ' + CF.mono;
        ctx.textAlign = 'left';
        ctx.fillText('||PF\u2081|-|PF\u2082|| = |' + d1.toFixed(2) + '-' + d2.toFixed(2) + '| = ' + Math.abs(d1 - d2).toFixed(2), 10, 20);
        ctx.fillText('2a = ' + (2 * a).toFixed(2), 10, 34);
    },

    drawParabola(cx, cy, s) {
        const { ctx, p, traceAngle } = this;

        // Curve y^2 = 2px
        ctx.strokeStyle = 'rgba(91,141,206,0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let y = -5; y <= 5; y += 0.05) {
            const x = y * y / (2 * p);
            const sx = cx + x * s;
            const sy = cy + y * s;
            y === -5 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
        }
        ctx.stroke();

        // Directrix x = -p/2
        ctx.strokeStyle = 'rgba(224,108,117,0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        const dx = cx + (-p / 2) * s;
        ctx.beginPath();
        ctx.moveTo(dx, 0);
        ctx.lineTo(dx, this.H);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(224,108,117,0.4)';
        ctx.font = '16px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText('\u51c6\u7ebf x=-p/2', dx, 14);

        // Focus
        const fx = p / 2;
        ctx.fillStyle = '#e5c07b';
        ctx.beginPath();
        ctx.arc(cx + fx * s, cy, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(229,192,123,0.6)';
        ctx.font = '16px ' + CF.mono;
        ctx.fillText('F(' + (p / 2).toFixed(1) + ',0)', cx + fx * s, cy + 14);

        // Tracing point
        const yP = 4 * Math.sin(traceAngle);
        const xP = yP * yP / (2 * p);
        const sx = cx + xP * s, sy = cy + yP * s;
        ctx.fillStyle = '#e06c75';
        ctx.beginPath();
        ctx.arc(sx, sy, 5, 0, Math.PI * 2);
        ctx.fill();

        // Distance to focus = distance to directrix
        const dF = Math.hypot(xP - fx, yP);
        const dD = xP + p / 2;
        ctx.strokeStyle = 'rgba(229,192,123,0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(cx + fx * s, cy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(dx, sy); ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '16px ' + CF.mono;
        ctx.textAlign = 'left';
        ctx.fillText('|PF| = ' + dF.toFixed(2) + '  \u51c6\u7ebf\u8ddd = ' + dD.toFixed(2), 10, 20);
    }
};

function initConicSections() {
    ConicSections.init();
}

window.ConicSections = ConicSections;
window.initConicSections = initConicSections;