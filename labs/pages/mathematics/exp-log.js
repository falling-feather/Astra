// ===== Exponential & Logarithmic Functions =====
// Base-a exponential and logarithm, inverse function relationship

const ExpLog = {
    canvas: null, ctx: null, W: 0, H: 0,
    _listeners: [],
    _resizeObs: null,

    scale: 40,
    origin: { x: 0, y: 0 },

    base: 2,           // current base a
    showExp: true,      // show y = a^x
    showLog: true,      // show y = log_a(x)
    showMirror: true,   // show y = x line
    showAsymptotes: true,
    animating: false,
    animId: 0,
    animDir: 1,

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    /* ── lifecycle ── */
    init() {
        this.canvas = document.getElementById('el-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this._buildControls();
        this.resize();
        this._bindEvents();
        this.draw();
        this.updateInfo();
    },

    destroy() {
        this.stopAnim();
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
        this.origin = { x: this.W * 0.38, y: this.H * 0.55 };
        this.draw();
    },

    /* ── controls ── */
    _buildControls() {
        const ctrl = document.getElementById('el-controls');
        if (!ctrl) return;
        ctrl.innerHTML = `
            <div class="el-row">
                <div class="el-base-group">
                    <label>底数 a = <span id="el-base-val" class="el-base-display">2.00</span></label>
                    <input type="range" id="el-base" min="0.1" max="5" step="0.05" value="2" class="el-slider">
                </div>
                <div class="el-presets">
                    <button class="el-preset" data-base="0.5">½</button>
                    <button class="el-preset active" data-base="2">2</button>
                    <button class="el-preset" data-base="2.718">e</button>
                    <button class="el-preset" data-base="10">10</button>
                </div>
            </div>
            <div class="el-toggles">
                <label class="el-toggle"><input type="checkbox" id="el-chk-exp" checked><span class="el-swatch el-swatch--exp"></span>y = aˣ</label>
                <label class="el-toggle"><input type="checkbox" id="el-chk-log" checked><span class="el-swatch el-swatch--log"></span>y = log<sub>a</sub>x</label>
                <label class="el-toggle"><input type="checkbox" id="el-chk-mirror" checked><span class="el-swatch el-swatch--mirror"></span>y = x</label>
                <label class="el-toggle"><input type="checkbox" id="el-chk-asy" checked><span class="el-swatch el-swatch--asy"></span>渐近线</label>
                <button class="el-anim-btn" id="el-anim-btn">▶ 动画演示</button>
            </div>
        `;
    },

    _bindEvents() {
        const ctrl = document.getElementById('el-controls');
        if (!ctrl) return;

        // Base slider
        const slider = document.getElementById('el-base');
        const valEl = document.getElementById('el-base-val');
        if (slider) this._on(slider, 'input', () => {
            this.base = parseFloat(slider.value);
            if (valEl) valEl.textContent = this.base.toFixed(2);
            this._updatePresetBtns();
            this.draw();
            this.updateInfo();
        });

        // Preset buttons
        ctrl.querySelectorAll('.el-preset').forEach(btn => {
            this._on(btn, 'click', () => {
                this.base = parseFloat(btn.dataset.base);
                if (slider) slider.value = this.base;
                if (valEl) valEl.textContent = this.base.toFixed(2);
                this._updatePresetBtns();
                this.draw();
                this.updateInfo();
            });
        });

        // Checkboxes
        const bind = (id, prop) => {
            const el = document.getElementById(id);
            if (el) this._on(el, 'change', () => {
                this[prop] = el.checked;
                this.draw();
            });
        };
        bind('el-chk-exp', 'showExp');
        bind('el-chk-log', 'showLog');
        bind('el-chk-mirror', 'showMirror');
        bind('el-chk-asy', 'showAsymptotes');

        // Animation button
        const animBtn = document.getElementById('el-anim-btn');
        if (animBtn) this._on(animBtn, 'click', () => {
            if (this.animating) this.stopAnim();
            else this.startAnim();
        });

        // ResizeObserver
        const wrap = this.canvas.parentElement;
        if (wrap && window.ResizeObserver) {
            this._resizeObs = new ResizeObserver(() => this.resize());
            this._resizeObs.observe(wrap);
        }
    },

    _updatePresetBtns() {
        const ctrl = document.getElementById('el-controls');
        if (!ctrl) return;
        ctrl.querySelectorAll('.el-preset').forEach(btn => {
            const bv = parseFloat(btn.dataset.base);
            btn.classList.toggle('active', Math.abs(bv - this.base) < 0.06);
        });
    },

    /* ── animation ── */
    startAnim() {
        this.animating = true;
        this.animDir = 1;
        const btn = document.getElementById('el-anim-btn');
        if (btn) btn.textContent = '⏸ 暂停';
        const slider = document.getElementById('el-base');
        const valEl = document.getElementById('el-base-val');
        let last = performance.now();
        const step = (now) => {
            if (!this.animating) return;
            const dt = (now - last) / 1000;
            last = now;
            this.base += this.animDir * dt * 0.8;
            if (this.base >= 4.5) { this.base = 4.5; this.animDir = -1; }
            if (this.base <= 0.15) { this.base = 0.15; this.animDir = 1; }
            if (slider) slider.value = this.base;
            if (valEl) valEl.textContent = this.base.toFixed(2);
            this._updatePresetBtns();
            this.draw();
            this.updateInfo();
            this.animId = requestAnimationFrame(step);
        };
        this.animId = requestAnimationFrame(step);
    },

    stopAnim() {
        this.animating = false;
        cancelAnimationFrame(this.animId);
        const btn = document.getElementById('el-anim-btn');
        if (btn) btn.textContent = '▶ 动画演示';
    },

    /* ── coordinate helpers ── */
    toScreen(x, y) {
        return { sx: this.origin.x + x * this.scale, sy: this.origin.y - y * this.scale };
    },

    /* ══════════════════════════════════════════
       Drawing
       ══════════════════════════════════════════ */
    draw() {
        const { ctx, W, H } = this;
        ctx.clearRect(0, 0, W, H);
        this._drawGrid();

        const a = this.base;

        // y = x mirror line
        if (this.showMirror) {
            this._plotFunc(x => x, 'rgba(255,255,255,0.18)', [8, 5], 1.2);
        }

        // Asymptotes
        if (this.showAsymptotes) {
            // Exponential: y = 0 (x-axis already drawn, add highlight)
            if (this.showExp) {
                const { sy } = this.toScreen(0, 0);
                ctx.save();
                ctx.strokeStyle = 'rgba(91,155,213,0.25)';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([6, 4]);
                ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
                ctx.restore();
            }
            // Logarithm: x = 0 (y-axis highlight)
            if (this.showLog) {
                const { sx } = this.toScreen(0, 0);
                ctx.save();
                ctx.strokeStyle = 'rgba(224,108,117,0.25)';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([6, 4]);
                ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
                ctx.restore();
            }
        }

        // Exponential curve y = a^x
        if (this.showExp) {
            this._plotFunc(x => Math.pow(a, x), '#5b9bd5', null, 2.5);
            // Mark (0, 1)
            this._drawDot(0, 1, '#5b9bd5', '(0, 1)');
        }

        // Logarithm curve y = log_a(x)
        if (this.showLog) {
            this._plotFunc(x => {
                if (x <= 0.01) return NaN;
                return Math.log(x) / Math.log(a);
            }, '#e06c75', null, 2.5);
            // Mark (1, 0)
            this._drawDot(1, 0, '#e06c75', '(1, 0)');
        }

        // Legend
        this._drawLegend();
    },

    _drawGrid() {
        const { ctx, W, H, origin, scale } = this;
        const xMin = -Math.ceil(origin.x / scale);
        const xMax = Math.ceil((W - origin.x) / scale);
        const yMin = -Math.ceil((H - origin.y) / scale);
        const yMax = Math.ceil(origin.y / scale);

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

        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(0, origin.y); ctx.lineTo(W, origin.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(origin.x, 0); ctx.lineTo(origin.x, H); ctx.stroke();

        // Arrows
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        // x-arrow
        ctx.beginPath(); ctx.moveTo(W - 2, origin.y); ctx.lineTo(W - 10, origin.y - 4); ctx.lineTo(W - 10, origin.y + 4); ctx.closePath(); ctx.fill();
        // y-arrow
        ctx.beginPath(); ctx.moveTo(origin.x, 2); ctx.lineTo(origin.x - 4, 10); ctx.lineTo(origin.x + 4, 10); ctx.closePath(); ctx.fill();

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
        // Axis labels
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = 'italic 20px ' + CF.sans;
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText('x', W - 14, origin.y + 8);
        ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
        ctx.fillText('y', origin.x - 8, 8);
    },

    _plotFunc(f, color, dash, lw) {
        const { ctx, W, H, origin, scale } = this;
        if (W <= 0) return;
        const xMin = (0 - origin.x) / scale;
        const xMax = (W - origin.x) / scale;
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
            if (y === undefined || isNaN(y) || !isFinite(y) || Math.abs(y) > 60) { pen = false; continue; }
            const { sx, sy } = this.toScreen(x, y);
            if (sy < -30 || sy > H + 30) { pen = false; continue; }
            if (!pen) { ctx.moveTo(sx, sy); pen = true; }
            else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
        ctx.restore();
    },

    _drawDot(x, y, color, label) {
        const { ctx } = this;
        const { sx, sy } = this.toScreen(x, y);
        ctx.beginPath();
        ctx.arc(sx, sy, 5, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
        if (label) {
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            ctx.font = 'bold 17px ' + CF.sans;
            ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
            ctx.fillText(label, sx + 8, sy - 4);
        }
    },

    _drawLegend() {
        const { ctx, W } = this;
        const a = this.base;
        const x0 = W - 160, y0 = 16;
        ctx.font = '18px ' + CF.sans;
        let row = 0;
        if (this.showExp) {
            ctx.fillStyle = '#5b9bd5';
            ctx.fillText(`● y = ${a === Math.E ? 'e' : a.toFixed(2)}ˣ`, x0, y0 + row * 18);
            row++;
        }
        if (this.showLog) {
            ctx.fillStyle = '#e06c75';
            const aStr = Math.abs(a - Math.E) < 0.01 ? 'e' : a.toFixed(2);
            ctx.fillText(`● y = log${aStr}(x)`, x0, y0 + row * 18);
            row++;
        }
        if (this.showMirror) {
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.fillText('- - y = x', x0, y0 + row * 18);
        }
    },

    /* ══════════════════════════════════════════
       Info / Edu panel
       ══════════════════════════════════════════ */
    updateInfo() {
        const el = document.getElementById('el-info');
        if (!el) return;
        const a = this.base;
        const aStr = Math.abs(a - Math.E) < 0.01 ? 'e' : a.toFixed(2);
        const isGrowth = a > 1;
        const isDecay = a > 0 && a < 1;
        const isOne = Math.abs(a - 1) < 0.06;

        const trendLabel = isOne ? '常数函数 y = 1' :
            isGrowth ? '指数增长（单调递增）' : '指数衰减（单调递减）';
        const trendColor = isOne ? 'math-key--amber' : 'math-key';

        const logTrend = isOne ? '无意义（a=1 时 logₐ 无定义）' :
            isGrowth ? '单调递增' : '单调递减';

        el.innerHTML = `
            <div class="el-info-title">y = ${aStr}ˣ 与 y = log<sub>${aStr}</sub>x</div>
            <div class="el-info-subtitle">指数函数与对数函数</div>

            <div class="math-row"><span class="math-key">底数 a</span>${aStr}${Math.abs(a - Math.E) < 0.01 ? ' (自然常数 e ≈ 2.718)' : ''}</div>
            <div class="math-row"><span class="${trendColor}">指数函数</span>${trendLabel}</div>
            <div class="math-row"><span class="math-key">过定点</span>(0, 1)，渐近线 y = 0</div>
            <div class="math-row"><span class="math-key">对数函数</span>${logTrend}</div>
            <div class="math-row"><span class="math-key">过定点</span>(1, 0)，渐近线 x = 0</div>

            <div class="el-edu">
                <div class="math-hd"><span class="math-tag">指数与对数</span>核心知识点</div>

                <div class="math-row"><span class="math-key">反函数关系</span>y = aˣ ⟺ x = logₐ(y)，图像关于 y = x 对称</div>
                <div class="math-row"><span class="math-key">指数定义域</span>x ∈ R，值域 (0, +∞)；a &gt; 1 → 递增，0 &lt; a &lt; 1 → 递减</div>
                <div class="math-row"><span class="math-key">对数定义域</span>x ∈ (0, +∞)，值域 R；底数 a ≠ 1 且 a &gt; 0</div>
                <div class="math-row"><span class="math-key">运算法则</span>logₐ(MN) = logₐM + logₐN；logₐ(M/N) = logₐM − logₐN</div>
                <div class="math-row"><span class="math-key--amber">换底公式</span>logₐb = ln b / ln a = lg b / lg a</div>
                <div class="math-row"><span class="math-key">常见底数</span>e→自然对数 ln；10→常用对数 lg；2→信息论 lb</div>
                <div class="math-note">💡 拖动底数滑块观察：a 从 0.5→2 过程中，指数函数从"衰减"翻转为"增长"，两条曲线始终关于 y=x 对称</div>
            </div>
        `;
    }
};

function initExpLog() { ExpLog.init(); }
window.initExpLog = initExpLog;
