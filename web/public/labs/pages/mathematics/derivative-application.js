// ===== Derivative Applications =====
// 导数应用：切线、单调性（导数符号）、极值与最值
// 高中数学/选择性必修相关内容：一元函数导数及其应用

const DerivApp = {
    canvas: null, ctx: null, W: 0, H: 0,
    _listeners: [],
    _resizeObs: null,

    funcs: {
        cubic: { label: 'f(x)=x³−3x', f: x => x ** 3 - 3 * x, df: x => 3 * x * x - 3, dfStr: "f′(x)=3x²−3", xmin: -3, xmax: 3 },
        cubic2: { label: 'f(x)=x³−6x²+9x', f: x => x ** 3 - 6 * x * x + 9 * x, df: x => 3 * x * x - 12 * x + 9, dfStr: "f′(x)=3x²−12x+9", xmin: -1, xmax: 5 },
        quartic: { label: 'f(x)=¼x⁴−2x²', f: x => 0.25 * x ** 4 - 2 * x * x, df: x => x ** 3 - 4 * x, dfStr: "f′(x)=x³−4x", xmin: -3, xmax: 3 },
        sine: { label: 'f(x)=sin x', f: x => Math.sin(x), df: x => Math.cos(x), dfStr: "f′(x)=cos x", xmin: -4, xmax: 4 },
    },
    fkey: 'cubic',
    x0: 0.6,
    showDeriv: true, showTangent: true, showMono: true, showExtrema: true,
    _drag: false,

    _on(el, evt, fn, opts) { el.addEventListener(evt, fn, opts); this._listeners.push({ el, evt, fn, opts }); },

    get fn() { return this.funcs[this.fkey]; },

    /* ── lifecycle ── */
    init() {
        this.canvas = document.getElementById('da-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
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
        this.H = Math.min(Math.max(rect.width * 0.55, 320), 460);
        if (this.W <= 0 || this.H <= 0) return;
        this.canvas.width = this.W * dpr;
        this.canvas.height = this.H * dpr;
        this.canvas.style.width = this.W + 'px';
        this.canvas.style.height = this.H + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this._computeRange();
        this.draw();
    },

    /* ── domain / range ── */
    _computeRange() {
        const fn = this.fn;
        let ymin = Infinity, ymax = -Infinity;
        const N = 240;
        for (let i = 0; i <= N; i++) {
            const x = fn.xmin + (fn.xmax - fn.xmin) * i / N;
            const y = fn.f(x);
            if (y < ymin) ymin = y; if (y > ymax) ymax = y;
        }
        const pad = (ymax - ymin) * 0.15 || 1;
        this._yr = { ymin: ymin - pad, ymax: ymax + pad };
        if (this.x0 < fn.xmin) this.x0 = fn.xmin;
        if (this.x0 > fn.xmax) this.x0 = fn.xmax;
    },

    /* ── numeric extrema (zeros of f' classified by nearby signs) ── */
    _extrema() {
        const fn = this.fn;
        return this._criticalPoints().map(x => {
            const type = this._criticalPointType(x);
            return type ? { x, y: fn.f(x), type } : null;
        }).filter(Boolean);
    },

    _criticalPoints() {
        const fn = this.fn;
        const res = [];
        const N = 800;
        const step = (fn.xmax - fn.xmin) / N;
        const eps = 1e-7;
        const add = (x) => {
            if (!Number.isFinite(x)) return;
            if (x < fn.xmin - eps || x > fn.xmax + eps) return;
            const xr = Math.max(fn.xmin, Math.min(fn.xmax, x));
            if (!res.some(v => Math.abs(v - xr) < step * 0.5)) res.push(xr);
        };

        let prevX = fn.xmin;
        let prev = fn.df(prevX);
        if (Math.abs(prev) < eps) add(prevX);

        for (let i = 1; i <= N; i++) {
            const x = fn.xmin + i * step;
            const cur = fn.df(x);
            if (Math.abs(cur) < eps) {
                add(x);
            } else if (prev * cur < 0) {
                let lo = prevX, hi = x;
                for (let k = 0; k < 40; k++) {
                    const mid = (lo + hi) / 2;
                    if (fn.df(lo) * fn.df(mid) <= 0) hi = mid; else lo = mid;
                }
                add((lo + hi) / 2);
            }
            prevX = x;
            prev = cur;
        }

        return res.sort((a, b) => a - b);
    },

    _criticalPointType(x) {
        const fn = this.fn;
        const span = fn.xmax - fn.xmin;
        const baseStep = Math.max(span * 1e-4, 1e-4);
        const eps = 1e-7;
        const signNear = (dir) => {
            for (let k = 1; k <= 24; k++) {
                const t = x + dir * baseStep * k;
                if (t <= fn.xmin || t >= fn.xmax) break;
                const v = fn.df(t);
                if (Math.abs(v) > eps) return Math.sign(v);
            }
            return 0;
        };
        const left = signNear(-1);
        const right = signNear(1);
        if (left > 0 && right < 0) return 'max';
        if (left < 0 && right > 0) return 'min';
        return null;
    },

    /* ── controls ── */
    _buildControls() {
        const ctrl = document.getElementById('da-controls');
        if (!ctrl) return;
        const btns = Object.keys(this.funcs).map(k =>
            `<button class="da-fbtn ${k === this.fkey ? 'active' : ''}" data-k="${k}">${this.funcs[k].label}</button>`).join('');
        ctrl.innerHTML = `
            <div class="da-fbtns">${btns}</div>
            <div class="da-row">
                <label>切点 x₀ = <span id="da-x0-val">${this.x0.toFixed(2)}</span></label>
                <input type="range" id="da-x0" min="${this.fn.xmin}" max="${this.fn.xmax}" step="0.01" value="${this.x0}" class="da-slider">
            </div>
            <div class="da-toggles">
                <label class="da-toggle"><input type="checkbox" id="da-chk-tan" ${this.showTangent ? 'checked' : ''}>切线</label>
                <label class="da-toggle"><input type="checkbox" id="da-chk-mono" ${this.showMono ? 'checked' : ''}>单调性着色</label>
                <label class="da-toggle"><input type="checkbox" id="da-chk-ext" ${this.showExtrema ? 'checked' : ''}>极值点</label>
                <label class="da-toggle"><input type="checkbox" id="da-chk-df" ${this.showDeriv ? 'checked' : ''}>导函数 f′(x)</label>
            </div>
            <div class="da-hint">🖱 在画布上拖拽可移动切点 x₀；红=切线，绿/红曲线=递增/递减</div>
        `;
    },

    _bindEvents() {
        const ctrl = document.getElementById('da-controls');
        if (!ctrl) return;
        ctrl.querySelectorAll('.da-fbtn').forEach(btn => {
            this._on(btn, 'click', () => {
                this.fkey = btn.dataset.k;
                this.x0 = (this.fn.xmin + this.fn.xmax) / 2;
                this._buildControls();
                this._bindEvents();
                this._computeRange();
                this.draw(); this.updateInfo();
            });
        });
        const slider = document.getElementById('da-x0');
        const vEl = document.getElementById('da-x0-val');
        if (slider) this._on(slider, 'input', () => {
            this.x0 = parseFloat(slider.value);
            if (vEl) vEl.textContent = this.x0.toFixed(2);
            this.draw(); this.updateInfo();
        });
        const chk = (id, prop) => {
            const el = document.getElementById(id);
            if (el) this._on(el, 'change', () => { this[prop] = el.checked; this.draw(); this.updateInfo(); });
        };
        chk('da-chk-tan', 'showTangent');
        chk('da-chk-mono', 'showMono');
        chk('da-chk-ext', 'showExtrema');
        chk('da-chk-df', 'showDeriv');

        const setFromEvt = (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const fn = this.fn;
            const box = this._box();
            let x = fn.xmin + (fn.xmax - fn.xmin) * (mx - box.l) / (box.r - box.l);
            x = Math.max(fn.xmin, Math.min(fn.xmax, x));
            this.x0 = x;
            if (slider) slider.value = x;
            if (vEl) vEl.textContent = x.toFixed(2);
            this.draw(); this.updateInfo();
        };
        this._on(this.canvas, 'pointerdown', (e) => { this._drag = true; this.canvas.setPointerCapture(e.pointerId); setFromEvt(e); });
        this._on(this.canvas, 'pointermove', (e) => { if (this._drag) setFromEvt(e); });
        const end = () => { this._drag = false; };
        this._on(this.canvas, 'pointerup', end);
        this._on(this.canvas, 'pointercancel', end);

        const wrap = this.canvas.parentElement;
        if (wrap && window.ResizeObserver) {
            this._resizeObs = new ResizeObserver(() => this.resize());
            this._resizeObs.observe(wrap);
        }
    },

    /* ══════════════════════════════════════════ drawing ══════════════════════════════════════════ */
    _box() { return { l: 46, r: this.W - 14, t: 18, b: this.H - 28 }; },

    draw() {
        const { ctx, W, H } = this;
        if (!ctx) return;
        if (!this._yr) this._computeRange();
        ctx.clearRect(0, 0, W, H);
        const fn = this.fn;
        const box = this._box();
        const { ymin, ymax } = this._yr;
        const X = x => box.l + (box.r - box.l) * (x - fn.xmin) / (fn.xmax - fn.xmin);
        const Y = y => box.b - (box.b - box.t) * (y - ymin) / (ymax - ymin);
        this._grid(box, fn.xmin, fn.xmax, ymin, ymax, X, Y);

        // derivative curve
        if (this.showDeriv) {
            ctx.strokeStyle = 'rgba(180,140,230,0.7)'; ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 4]); ctx.beginPath();
            const N = 300;
            let started = false;
            for (let i = 0; i <= N; i++) {
                const x = fn.xmin + (fn.xmax - fn.xmin) * i / N;
                const y = fn.df(x);
                if (y < ymin || y > ymax) { started = false; continue; }
                const px = X(x), py = Y(y);
                if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
            }
            ctx.stroke(); ctx.setLineDash([]);
        }

        // main curve (colored by f' sign if mono)
        const N = 320;
        ctx.lineWidth = 2.4;
        let px0 = null, py0 = null;
        for (let i = 0; i <= N; i++) {
            const x = fn.xmin + (fn.xmax - fn.xmin) * i / N;
            const y = fn.f(x);
            const px = X(x), py = Y(y);
            if (px0 !== null) {
                const inc = fn.df((x + (fn.xmin + (fn.xmax - fn.xmin) * (i - 1) / N)) / 2) >= 0;
                ctx.strokeStyle = this.showMono ? (inc ? '#78c88c' : '#e06c75') : '#5b9bd5';
                ctx.beginPath(); ctx.moveTo(px0, py0); ctx.lineTo(px, py); ctx.stroke();
            }
            px0 = px; py0 = py;
        }

        // extrema
        if (this.showExtrema) {
            this._extrema().forEach(e => {
                ctx.fillStyle = e.type === 'max' ? '#e5c07b' : '#61afef';
                ctx.beginPath(); ctx.arc(X(e.x), Y(e.y), 5, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1; ctx.stroke();
                ctx.fillStyle = e.type === 'max' ? '#f0d9a8' : '#a5d4f5';
                ctx.font = '11px ' + CF.sans; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
                ctx.fillText(e.type === 'max' ? '极大' : '极小', X(e.x), Y(e.y) - (e.type === 'max' ? 8 : -20));
            });
        }

        // tangent at x0
        const fy0 = fn.f(this.x0), slope = fn.df(this.x0);
        if (this.showTangent) {
            const span = (fn.xmax - fn.xmin);
            const xa = this.x0 - span, xb = this.x0 + span;
            ctx.strokeStyle = '#e06c75'; ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.moveTo(X(xa), Y(fy0 + slope * (xa - this.x0)));
            ctx.lineTo(X(xb), Y(fy0 + slope * (xb - this.x0)));
            ctx.stroke();
        }
        // tangent point
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(X(this.x0), Y(fy0), 5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#e06c75'; ctx.lineWidth = 2; ctx.stroke();
    },

    _grid(box, xmin, xmax, ymin, ymax, X, Y) {
        const { ctx } = this;
        ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
        ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '11px ' + CF.sans;
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        for (let i = 0; i <= 4; i++) {
            const yy = box.b - (box.b - box.t) * i / 4;
            const yv = ymin + (ymax - ymin) * i / 4;
            ctx.beginPath(); ctx.moveTo(box.l, yy); ctx.lineTo(box.r, yy); ctx.stroke();
            ctx.fillText(yv.toFixed(1), box.l - 4, yy);
        }
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        for (let i = 0; i <= 6; i++) {
            const xx = box.l + (box.r - box.l) * i / 6;
            const xv = xmin + (xmax - xmin) * i / 6;
            ctx.beginPath(); ctx.moveTo(xx, box.t); ctx.lineTo(xx, box.b); ctx.stroke();
            ctx.fillText(xv.toFixed(1), xx, box.b + 4);
        }
        // axes
        if (ymin < 0 && ymax > 0) {
            const y0 = Y(0);
            ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.moveTo(box.l, y0); ctx.lineTo(box.r, y0); ctx.stroke();
        }
        if (xmin < 0 && xmax > 0) {
            const x0 = X(0);
            ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.moveTo(x0, box.t); ctx.lineTo(x0, box.b); ctx.stroke();
        }
    },

    /* ── monotonic intervals from extrema ── */
    _monoIntervals() {
        const fn = this.fn;
        const ex = this._extrema().map(e => e.x).sort((a, b) => a - b);
        const bounds = [fn.xmin, ...ex, fn.xmax];
        const out = [];
        for (let i = 0; i < bounds.length - 1; i++) {
            const mid = (bounds[i] + bounds[i + 1]) / 2;
            const inc = fn.df(mid) >= 0;
            out.push({ a: bounds[i], b: bounds[i + 1], inc });
        }
        return out;
    },

    /* ── info / edu ── */
    updateInfo() {
        const el = document.getElementById('da-info');
        if (!el) return;
        const fn = this.fn;
        const fy0 = fn.f(this.x0), slope = fn.df(this.x0);
        const f = n => (Math.round(n * 1000) / 1000);
        const tb = fy0 - slope * this.x0;
        const tanEq = `y = ${f(slope)}·x ${tb >= 0 ? '+' : '−'} ${f(Math.abs(tb))}`;
        const mono = this._monoIntervals().map(m =>
            `(${f(m.a)}, ${f(m.b)}) ${m.inc ? '↗ 递增' : '↘ 递减'}`).join('　');
        const ex = this._extrema().map(e =>
            `${e.type === 'max' ? '极大值' : '极小值'} f(${f(e.x)}) = ${f(e.y)}`).join('　') || '无极值';
        const trend = slope > 0.001 ? '递增（f′>0）' : slope < -0.001 ? '递减（f′<0）' : '驻点（f′=0）';

        el.innerHTML = `
            <div class="da-info-title">${fn.label}</div>
            <div class="da-info-subtitle">导数的几何意义 · 单调性 · 极值</div>
            <div class="math-row"><span class="math-key">导函数</span>${fn.dfStr}</div>
            <div class="math-row"><span class="math-key--amber">切点 x₀</span>x₀ = ${f(this.x0)}，f(x₀) = ${f(fy0)}</div>
            <div class="math-row"><span class="math-key">切线斜率</span>f′(${f(this.x0)}) = ${f(slope)} → ${trend}</div>
            <div class="math-row"><span class="math-key">切线方程</span>${tanEq}</div>
            <div class="math-row"><span class="math-key">单调区间</span>${mono}</div>
            <div class="math-row"><span class="math-key--amber">极值</span>${ex}</div>
            <div class="da-edu">
                <div class="math-hd"><span class="math-tag">导数应用</span>核心结论</div>
                <div class="math-row"><span class="math-key">几何意义</span>f′(x₀) = 曲线在 (x₀, f(x₀)) 处切线的斜率</div>
                <div class="math-row"><span class="math-key--amber">单调性</span>f′(x)>0 ⇒ 递增；f′(x)<0 ⇒ 递减（在区间内恒成立）</div>
                <div class="math-row"><span class="math-key">极值必要条件</span>x₀ 为极值点 ⇒ f′(x₀)=0（可导时）</div>
                <div class="math-row"><span class="math-key">极值判定</span>f′ 在 x₀ 左正右负 ⇒ 极大；左负右正 ⇒ 极小</div>
                <div class="math-note">💡 拖动切点观察斜率正负与曲线升降的对应；f′=0 处即图中黄/蓝极值点。求最值还需比较极值与区间端点函数值。</div>
            </div>
        `;
    }
};

function initDerivApp() { DerivApp.init(); }
window.initDerivApp = initDerivApp;
