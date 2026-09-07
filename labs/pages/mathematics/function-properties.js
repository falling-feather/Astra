// ===== Function Properties Explorer =====
// Monotonicity, Parity, and Periodicity analysis

const FuncProps = {
    canvas: null, ctx: null, W: 0, H: 0,
    _listeners: [],
    _resizeObs: null,

    scale: 45,
    origin: { x: 0, y: 0 },

    mode: 'monotone',   // 'monotone' | 'parity' | 'period'
    funcIdx: 0,

    // Monotonicity draggable interval [a, b]
    intA: -2, intB: 2,
    dragging: null,      // 'a' | 'b' | null

    FUNCS: [
        {
            name: 'f(x) = x²', label: 'x²',
            f: x => x * x,
            df: x => 2 * x,
            parity: 'even', period: null, domain: 'R',
            monoDesc: '(-∞, 0) 上单调递减，(0, +∞) 上单调递增',
            parityDesc: '偶函数：f(-x) = (-x)² = x² = f(x)，图像关于 y 轴对称',
            periodDesc: '非周期函数'
        },
        {
            name: 'f(x) = x³', label: 'x³',
            f: x => x * x * x,
            df: x => 3 * x * x,
            parity: 'odd', period: null, domain: 'R',
            monoDesc: '在 R 上单调递增，f\'(x) = 3x² ≥ 0',
            parityDesc: '奇函数：f(-x) = (-x)³ = -x³ = -f(x)，图像关于原点对称',
            periodDesc: '非周期函数'
        },
        {
            name: 'f(x) = 1/x', label: '1/x',
            f: x => (Math.abs(x) < 0.02 ? NaN : 1 / x),
            df: x => (Math.abs(x) < 0.02 ? NaN : -1 / (x * x)),
            parity: 'odd', period: null, domain: 'x ≠ 0',
            monoDesc: '在 (-∞, 0) 和 (0, +∞) 上分别单调递减',
            parityDesc: '奇函数：f(-x) = 1/(-x) = -1/x = -f(x)，图像关于原点对称',
            periodDesc: '非周期函数'
        },
        {
            name: 'f(x) = sin(x)', label: 'sin x',
            f: x => Math.sin(x),
            df: x => Math.cos(x),
            parity: 'odd', period: 2 * Math.PI, domain: 'R',
            monoDesc: '[-π/2+2kπ, π/2+2kπ] 上递增，[π/2+2kπ, 3π/2+2kπ] 上递减',
            parityDesc: '奇函数：sin(-x) = -sin(x)，图像关于原点对称',
            periodDesc: '最小正周期 T = 2π ≈ 6.283'
        },
        {
            name: 'f(x) = cos(x)', label: 'cos x',
            f: x => Math.cos(x),
            df: x => -Math.sin(x),
            parity: 'even', period: 2 * Math.PI, domain: 'R',
            monoDesc: '[2kπ-π, 2kπ] 上递增，[2kπ, 2kπ+π] 上递减',
            parityDesc: '偶函数：cos(-x) = cos(x)，图像关于 y 轴对称',
            periodDesc: '最小正周期 T = 2π ≈ 6.283'
        },
        {
            name: 'f(x) = 2ˣ', label: '2ˣ',
            f: x => Math.pow(2, x),
            df: x => Math.pow(2, x) * Math.LN2,
            parity: 'neither', period: null, domain: 'R',
            monoDesc: '在 R 上单调递增，f\'(x) = 2ˣ·ln2 > 0',
            parityDesc: '非奇非偶：f(-x) = 2⁻ˣ ≠ f(x)，且 f(-x) ≠ -f(x)',
            periodDesc: '非周期函数'
        },
        {
            name: 'f(x) = |x|', label: '|x|',
            f: x => Math.abs(x),
            df: x => (x > 0 ? 1 : x < 0 ? -1 : 0),
            parity: 'even', period: null, domain: 'R',
            monoDesc: '(-∞, 0) 上单调递减，(0, +∞) 上单调递增',
            parityDesc: '偶函数：f(-x) = |-x| = |x| = f(x)，图像关于 y 轴对称',
            periodDesc: '非周期函数'
        },
        {
            name: 'f(x) = ln|x|', label: 'ln|x|',
            f: x => (Math.abs(x) < 0.02 ? NaN : Math.log(Math.abs(x))),
            df: x => (Math.abs(x) < 0.02 ? NaN : 1 / x),
            parity: 'even', period: null, domain: 'x ≠ 0',
            monoDesc: '在 (-∞, 0) 上单调递减，在 (0, +∞) 上单调递增',
            parityDesc: '偶函数：f(-x) = ln|-x| = ln|x| = f(x)，图像关于 y 轴对称',
            periodDesc: '非周期函数'
        }
    ],

    get func() { return this.FUNCS[this.funcIdx]; },

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    /* ── lifecycle ── */
    init() {
        this.canvas = document.getElementById('fp-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this._buildControls();
        this.resize();
        this._bindEvents();
        this.draw();
        this.updateInfo();
    },

    destroy() {
        cancelAnimationFrame(this.animId);
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
        this.H = Math.min(rect.width * 0.55, 500);
        if (this.W <= 0 || this.H <= 0) return;
        this.canvas.width = this.W * dpr;
        this.canvas.height = this.H * dpr;
        this.canvas.style.width = this.W + 'px';
        this.canvas.style.height = this.H + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.origin = { x: this.W / 2, y: this.H / 2 };
        this.draw();
    },

    /* ── controls ── */
    _buildControls() {
        const ctrl = document.getElementById('fp-controls');
        if (!ctrl) return;
        ctrl.innerHTML = `
            <div class="fp-modes">
                <button class="fp-mode-btn active" data-mode="monotone">📈 单调性</button>
                <button class="fp-mode-btn" data-mode="parity">🔄 奇偶性</button>
                <button class="fp-mode-btn" data-mode="period">🔁 周期性</button>
            </div>
            <div class="fp-funcs">
                ${this.FUNCS.map((fn, i) =>
                    `<button class="fp-func-btn${i === 0 ? ' active' : ''}" data-idx="${i}">${fn.label}</button>`
                ).join('')}
            </div>
            <div class="fp-interval" id="fp-interval-ctrl">
                <span>分析区间: [</span>
                <input type="number" id="fp-int-a" value="${this.intA}" step="0.5" class="fp-int-input">
                <span>, </span>
                <input type="number" id="fp-int-b" value="${this.intB}" step="0.5" class="fp-int-input">
                <span>]</span>
                <span class="fp-hint">（可拖拽画布上的菱形标记）</span>
            </div>
        `;
    },

    _bindEvents() {
        const ctrl = document.getElementById('fp-controls');
        if (!ctrl) return;

        // Mode buttons
        ctrl.querySelectorAll('.fp-mode-btn').forEach(btn => {
            this._on(btn, 'click', () => {
                ctrl.querySelectorAll('.fp-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.mode = btn.dataset.mode;
                const intCtrl = document.getElementById('fp-interval-ctrl');
                if (intCtrl) intCtrl.style.display = this.mode === 'monotone' ? '' : 'none';
                this.draw();
                this.updateInfo();
            });
        });

        // Function buttons
        ctrl.querySelectorAll('.fp-func-btn').forEach(btn => {
            this._on(btn, 'click', () => {
                ctrl.querySelectorAll('.fp-func-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.funcIdx = parseInt(btn.dataset.idx);
                this.draw();
                this.updateInfo();
            });
        });

        // Interval inputs
        const intA = document.getElementById('fp-int-a');
        const intB = document.getElementById('fp-int-b');
        if (intA) this._on(intA, 'input', () => {
            this.intA = parseFloat(intA.value) || -2;
            this.draw(); this.updateInfo();
        });
        if (intB) this._on(intB, 'input', () => {
            this.intB = parseFloat(intB.value) || 2;
            this.draw(); this.updateInfo();
        });

        // Canvas drag for interval markers
        this._on(this.canvas, 'mousedown', e => this._onDown(e));
        this._on(this.canvas, 'mousemove', e => this._onMove(e));
        this._on(this.canvas, 'mouseup', () => { this.dragging = null; });
        this._on(this.canvas, 'mouseleave', () => { this.dragging = null; });
        this._on(this.canvas, 'touchstart', e => { e.preventDefault(); this._onDown(e.touches[0]); }, { passive: false });
        this._on(this.canvas, 'touchmove', e => { e.preventDefault(); this._onMove(e.touches[0]); }, { passive: false });
        this._on(this.canvas, 'touchend', () => { this.dragging = null; });

        // ResizeObserver
        const wrap = this.canvas.parentElement;
        if (wrap && window.ResizeObserver) {
            this._resizeObs = new ResizeObserver(() => this.resize());
            this._resizeObs.observe(wrap);
        }
    },

    /* ── coordinate conversion ── */
    toScreen(x, y) {
        return { sx: this.origin.x + x * this.scale, sy: this.origin.y - y * this.scale };
    },
    fromScreen(sx) {
        return (sx - this.origin.x) / this.scale;
    },

    /* ── pointer drag ── */
    _onDown(e) {
        if (this.mode !== 'monotone') return;
        const rect = this.canvas.getBoundingClientRect();
        const x = this.fromScreen(e.clientX - rect.left);
        if (Math.abs(x - this.intA) < 0.4) this.dragging = 'a';
        else if (Math.abs(x - this.intB) < 0.4) this.dragging = 'b';
    },

    _onMove(e) {
        if (!this.dragging) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = this.fromScreen(e.clientX - rect.left);
        const snap = Math.round(x * 4) / 4;
        const clamped = Math.max(-10, Math.min(10, snap));
        if (this.dragging === 'a') {
            this.intA = Math.min(clamped, this.intB - 0.25);
            const el = document.getElementById('fp-int-a');
            if (el) el.value = this.intA;
        } else {
            this.intB = Math.max(clamped, this.intA + 0.25);
            const el = document.getElementById('fp-int-b');
            if (el) el.value = this.intB;
        }
        this.draw();
        this.updateInfo();
    },

    /* ══════════════════════════════════════════
       Drawing
       ══════════════════════════════════════════ */
    draw() {
        const { ctx, W, H } = this;
        ctx.clearRect(0, 0, W, H);
        this._drawGrid();
        switch (this.mode) {
            case 'monotone': this._drawMonotone(); break;
            case 'parity':   this._drawParity(); break;
            case 'period':   this._drawPeriod(); break;
        }
    },

    _drawGrid() {
        const { ctx, W, H, origin, scale } = this;
        const xMin = -Math.ceil(origin.x / scale);
        const xMax = Math.ceil((W - origin.x) / scale);
        const yMin = -Math.ceil((H - origin.y) / scale);
        const yMax = Math.ceil(origin.y / scale);

        // Grid
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        for (let i = xMin; i <= xMax; i++) {
            const sx = origin.x + i * scale;
            ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
        }
        for (let j = yMin; j <= yMax; j++) {
            const sy = origin.y - j * scale;
            ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
        }

        // Axes
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(0, origin.y); ctx.lineTo(W, origin.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(origin.x, 0); ctx.lineTo(origin.x, H); ctx.stroke();

        // Labels
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '17px ' + CF.sans;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        for (let i = xMin; i <= xMax; i++) {
            if (i === 0) continue;
            ctx.fillText(i, origin.x + i * scale, origin.y + 4);
        }
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        for (let j = yMin; j <= yMax; j++) {
            if (j === 0) continue;
            ctx.fillText(j, origin.x - 6, origin.y - j * scale);
        }
        ctx.textAlign = 'right'; ctx.textBaseline = 'top';
        ctx.fillText('O', origin.x - 4, origin.y + 4);
    },

    _plotFunc(f, color, dash, lw, xRange) {
        const { ctx, W, origin, scale, H } = this;
        if (W <= 0) return;
        const xMin = xRange ? xRange[0] : (0 - origin.x) / scale;
        const xMax = xRange ? xRange[1] : (W - origin.x) / scale;
        const step = (xMax - xMin) / Math.max(W * 2, 800);
        if (step <= 0) return;

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = lw || 2;
        if (dash) ctx.setLineDash(dash);
        ctx.beginPath();
        let pen = false;

        for (let x = xMin; x <= xMax; x += step) {
            const y = f(x);
            if (y === undefined || isNaN(y) || !isFinite(y) || Math.abs(y) > 50) { pen = false; continue; }
            const { sx, sy } = this.toScreen(x, y);
            if (sy < -20 || sy > H + 20) { pen = false; continue; }
            if (!pen) { ctx.moveTo(sx, sy); pen = true; }
            else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
        ctx.restore();
    },

    /* ── Monotonicity mode ── */
    _sampleMonotone() {
        const fn = this.func;
        const N = 80;
        let allInc = true, allDec = true, undef = false;
        for (let i = 0; i < N; i++) {
            const x = this.intA + (this.intB - this.intA) * i / N;
            const d = fn.df(x);
            if (isNaN(d) || !isFinite(d)) { undef = true; allInc = false; allDec = false; break; }
            if (d < -1e-6) allInc = false;
            if (d > 1e-6) allDec = false;
        }
        return { allInc, allDec, undef };
    },

    _drawMonotone() {
        const fn = this.func;
        const { ctx, origin, scale, intA, intB, H, W } = this;
        const { allInc, allDec } = this._sampleMonotone();

        // Shade interval
        const sxA = origin.x + intA * scale;
        const sxB = origin.x + intB * scale;
        ctx.fillStyle = allInc ? 'rgba(80,200,120,0.10)' :
                        allDec ? 'rgba(220,80,80,0.10)' :
                        'rgba(200,200,80,0.07)';
        ctx.fillRect(sxA, 0, sxB - sxA, H);

        // Main function
        this._plotFunc(fn.f, '#5b9bd5', null, 2.5);

        // Derivative curve (dashed)
        this._plotFunc(fn.df, 'rgba(229,192,123,0.55)', [5, 4], 1.5);

        // Markers
        const mColor = allInc ? '#50c878' : allDec ? '#dc5050' : '#c8c850';
        this._drawMarker(intA, mColor);
        this._drawMarker(intB, mColor);

        // Interval verdict
        const verdict = allInc ? '↗ 单调递增' : allDec ? '↘ 单调递减' : '⚡ 非单调';
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = 'bold 20px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText(`[${intA}, ${intB}] ${verdict}`, (sxA + sxB) / 2, 18);

        // f'(x) legend
        ctx.fillStyle = 'rgba(229,192,123,0.8)';
        ctx.font = '17px ' + CF.sans;
        ctx.textAlign = 'right';
        ctx.fillText("f'(x)", W - 12, 18);
    },

    _drawMarker(x, color) {
        const { ctx, origin, scale, H } = this;
        const sx = origin.x + x * scale;
        const sy = origin.y;

        // Vertical dashed line
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
        ctx.restore();

        // Diamond handle
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(sx, sy - 9);
        ctx.lineTo(sx + 7, sy);
        ctx.lineTo(sx, sy + 9);
        ctx.lineTo(sx - 7, sy);
        ctx.closePath();
        ctx.fill();

        // Value label
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 16px ' + CF.sans;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(x % 1 === 0 ? x : x.toFixed(2), sx, sy - 12);
    },

    /* ── Parity mode ── */
    _drawParity() {
        const fn = this.func;
        const { ctx, W, H, origin } = this;

        // f(x) solid blue
        this._plotFunc(fn.f, '#5b9bd5', null, 2.5);

        // f(-x) dashed pink
        this._plotFunc(x => fn.f(-x), '#e06c75', [6, 4], 2);

        // -f(x) dotted green (for odd)
        if (fn.parity === 'odd') {
            this._plotFunc(x => -fn.f(x), 'rgba(80,200,120,0.45)', [3, 3], 1.5);
        }

        // Symmetry guide
        if (fn.parity === 'even') {
            ctx.save();
            ctx.strokeStyle = 'rgba(224,108,117,0.35)';
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(origin.x, 0); ctx.lineTo(origin.x, H); ctx.stroke();
            ctx.restore();
        } else if (fn.parity === 'odd') {
            ctx.beginPath();
            ctx.arc(origin.x, origin.y, 8, 0, 2 * Math.PI);
            ctx.fillStyle = 'rgba(80,200,120,0.45)';
            ctx.fill();
        }

        // Legend
        ctx.font = '18px ' + CF.sans;
        ctx.textAlign = 'left';
        const lx = 12;
        ctx.fillStyle = '#5b9bd5'; ctx.fillText('● f(x)', lx, 20);
        ctx.fillStyle = '#e06c75'; ctx.fillText('- - f(-x)', lx, 38);
        if (fn.parity === 'odd') {
            ctx.fillStyle = 'rgba(80,200,120,0.8)'; ctx.fillText('· · -f(x)', lx, 56);
        }

        // Verdict
        const v = fn.parity === 'even' ? '偶函数 — f(-x) = f(x)' :
                  fn.parity === 'odd'  ? '奇函数 — f(-x) = -f(x)' :
                  '非奇非偶函数';
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.font = 'bold 20px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText(v, W / 2, H - 12);
    },

    /* ── Periodicity mode ── */
    _drawPeriod() {
        const fn = this.func;
        const { ctx, W, H, origin, scale } = this;

        this._plotFunc(fn.f, '#5b9bd5', null, 2.5);

        if (fn.period) {
            const T = fn.period;

            // Highlight one period [0, T]
            const sx0 = origin.x;
            const sxT = origin.x + T * scale;
            ctx.fillStyle = 'rgba(91,155,213,0.12)';
            ctx.fillRect(sx0, 0, sxT - sx0, H);

            // Boundary dashes
            ctx.save();
            ctx.strokeStyle = 'rgba(91,155,213,0.5)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 3]);
            [sx0, sxT].forEach(sx => {
                ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
            });
            ctx.restore();

            // T arrow + label
            const arrowY = H - 32;
            ctx.strokeStyle = 'rgba(91,155,213,0.7)';
            ctx.fillStyle = 'rgba(91,155,213,0.7)';
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(sx0, arrowY); ctx.lineTo(sxT, arrowY); ctx.stroke();
            [sx0, sxT].forEach((sx, i) => {
                const d = i === 0 ? 1 : -1;
                ctx.beginPath();
                ctx.moveTo(sx, arrowY);
                ctx.lineTo(sx + d * 7, arrowY - 4);
                ctx.lineTo(sx + d * 7, arrowY + 4);
                ctx.closePath(); ctx.fill();
            });
            ctx.font = 'bold 20px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(91,155,213,0.9)';
            ctx.fillText('T = ' + (T === 2 * Math.PI ? '2π' : T.toFixed(2)), (sx0 + sxT) / 2, arrowY - 8);

            // Shifted copies
            this._plotFunc(x => fn.f(x - T), 'rgba(229,192,123,0.45)', [4, 3], 1.5);
            this._plotFunc(x => fn.f(x + T), 'rgba(80,200,120,0.45)', [4, 3], 1.5);
        } else {
            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.font = 'bold 22px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.fillText('该函数不具有周期性', W / 2, H - 14);
        }
    },

    /* ══════════════════════════════════════════
       Info / Edu panel
       ══════════════════════════════════════════ */
    updateInfo() {
        const el = document.getElementById('fp-info');
        if (!el) return;
        const fn = this.func;
        let title, body;

        switch (this.mode) {
            case 'monotone': {
                const { allInc, allDec, undef } = this._sampleMonotone();
                const verdict = undef ? '区间内含间断点' :
                    allInc ? '单调递增' : allDec ? '单调递减' : '非单调（先增后减或先减后增）';
                const vc = allInc ? 'math-key' : allDec ? 'math-key--red' : 'math-key--amber';
                title = '单调性分析';
                body = `
                    <div class="math-row"><span class="math-key">函数</span>${fn.name}，定义域 ${fn.domain}</div>
                    <div class="math-row"><span class="math-key">分析区间</span>[${this.intA}, ${this.intB}]</div>
                    <div class="math-row"><span class="${vc}">判定结果</span>${verdict}</div>
                    <div class="math-row"><span class="math-key">完整单调区间</span>${fn.monoDesc}</div>
                    <div class="fp-edu">
                        <div class="math-hd"><span class="math-tag">单调性</span>定义与判定方法</div>
                        <div class="math-row"><span class="math-key">定义法</span>∀x₁,x₂∈D, x₁&lt;x₂ ⇒ f(x₁)&lt;f(x₂) 则 f 在 D 上递增</div>
                        <div class="math-row"><span class="math-key">导数法</span>f'(x)&gt;0 在 (a,b) 上恒成立 ⇒ f 在 [a,b] 上递增</div>
                        <div class="math-row"><span class="math-key--amber">注意</span>单调性需在连续区间上讨论，不能跨间断点</div>
                        <div class="math-note">💡 拖动画布上的菱形标记或修改输入框来改变分析区间；黄色虚线为 f'(x)</div>
                    </div>`;
                break;
            }
            case 'parity': {
                const pLabel = fn.parity === 'even' ? '偶函数' : fn.parity === 'odd' ? '奇函数' : '非奇非偶';
                const pc = fn.parity === 'neither' ? 'math-key--amber' : 'math-key';
                title = '奇偶性分析';
                body = `
                    <div class="math-row"><span class="math-key">函数</span>${fn.name}，定义域 ${fn.domain}</div>
                    <div class="math-row"><span class="${pc}">判定结果</span>${pLabel}</div>
                    <div class="math-row"><span class="math-key">证明</span>${fn.parityDesc}</div>
                    <div class="fp-edu">
                        <div class="math-hd"><span class="math-tag">奇偶性</span>定义与判定条件</div>
                        <div class="math-row"><span class="math-key">前提</span>定义域必须关于原点对称（必要条件）</div>
                        <div class="math-row"><span class="math-key">偶函数</span>f(-x) = f(x)，图像关于 y 轴对称</div>
                        <div class="math-row"><span class="math-key">奇函数</span>f(-x) = -f(x)，图像关于原点对称；若 0∈D 则 f(0)=0</div>
                        <div class="math-row"><span class="math-key--amber">常见陷阱</span>f(x)=x²(x∈[0,+∞)) 不是偶函数——定义域不对称！</div>
                        <div class="math-note">💡 蓝色实线为 f(x)，红色虚线为 f(-x)；两者完全重合则为偶函数</div>
                    </div>`;
                break;
            }
            case 'period': {
                const pStr = fn.period ? 'T = ' + (fn.period === 2 * Math.PI ? '2π' : fn.period.toFixed(3)) : '无周期';
                title = '周期性分析';
                body = `
                    <div class="math-row"><span class="math-key">函数</span>${fn.name}，定义域 ${fn.domain}</div>
                    <div class="math-row"><span class="math-key">周期</span>${pStr}</div>
                    <div class="math-row"><span class="math-key">分析</span>${fn.periodDesc}</div>
                    <div class="fp-edu">
                        <div class="math-hd"><span class="math-tag">周期性</span>定义与判定方法</div>
                        <div class="math-row"><span class="math-key">定义</span>∃T&gt;0，∀x∈D，f(x+T) = f(x) 则 f 为周期函数</div>
                        <div class="math-row"><span class="math-key">最小正周期</span>满足条件的最小正数 T</div>
                        <div class="math-row"><span class="math-key">常见周期</span>sin(x)/cos(x)→T=2π；tan(x)→T=π；sin(2x)→T=π</div>
                        <div class="math-row"><span class="math-key--amber">拓展</span>若 f(x+a)=-f(x) 则 T=2a（如 sin(x+π)=-sin(x)）</div>
                        <div class="math-note">💡 蓝色高亮区域为一个完整周期，黄色/绿色虚线为平移后的函数</div>
                    </div>`;
                break;
            }
        }

        el.innerHTML = `
            <div class="fp-info-title">${fn.name}</div>
            <div class="fp-info-subtitle">${title}</div>
            ${body}
        `;
    }
};

function initFuncProps() { FuncProps.init(); }
window.initFuncProps = initFuncProps;
