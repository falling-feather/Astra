// ===== Binomial Theorem =====
// (a+b)ⁿ 展开系数 = C(n,k)，杨辉三角可视化 + 帕斯卡递推交互
// 人教版选修二 第5章：二项式定理

const Binomial = {
    canvas: null, ctx: null, W: 0, H: 0,
    _listeners: [],
    _resizeObs: null,

    n: 5,                 // current exponent
    maxN: 12,
    showTerms: true,       // show full expansion terms a^(n-k)b^k
    pascalRule: true,      // click interior cell → show C(n,k)=C(n-1,k-1)+C(n-1,k)
    selCell: null,         // { i, k } selected cell
    animating: false,
    animId: 0,
    animRows: 0,           // rows revealed during build animation

    _cellRects: [],        // hit-test rects per draw
    _C: [],                // Pascal table cache

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    /* ── combinatorics ── */
    _buildPascal() {
        const N = this.maxN;
        const C = [];
        for (let i = 0; i <= N; i++) {
            C[i] = [];
            for (let k = 0; k <= i; k++) {
                C[i][k] = (k === 0 || k === i) ? 1 : C[i - 1][k - 1] + C[i - 1][k];
            }
        }
        this._C = C;
    },
    comb(i, k) { return (this._C[i] && this._C[i][k]) || 0; },

    /* ── lifecycle ── */
    init() {
        this.canvas = document.getElementById('bt-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this._buildPascal();
        this.animRows = this.n;
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
        this.H = Math.min(Math.max(rect.width * 0.5, 320), 460);
        if (this.W <= 0 || this.H <= 0) return;
        this.canvas.width = this.W * dpr;
        this.canvas.height = this.H * dpr;
        this.canvas.style.width = this.W + 'px';
        this.canvas.style.height = this.H + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.draw();
    },

    /* ── controls ── */
    _buildControls() {
        const ctrl = document.getElementById('bt-controls');
        if (!ctrl) return;
        ctrl.innerHTML = `
            <div class="bt-row">
                <div class="bt-n-group">
                    <label>指数 n = <span id="bt-n-val" class="bt-n-display">${this.n}</span></label>
                    <input type="range" id="bt-n" min="0" max="${this.maxN}" step="1" value="${this.n}" class="bt-slider">
                </div>
                <div class="bt-presets">
                    <button class="bt-preset" data-n="2">2</button>
                    <button class="bt-preset" data-n="3">3</button>
                    <button class="bt-preset active" data-n="5">5</button>
                    <button class="bt-preset" data-n="8">8</button>
                    <button class="bt-preset" data-n="12">12</button>
                </div>
            </div>
            <div class="bt-toggles">
                <label class="bt-toggle"><input type="checkbox" id="bt-chk-terms" checked>显示展开式各项</label>
                <label class="bt-toggle"><input type="checkbox" id="bt-chk-pascal" checked>点击单元格演示递推</label>
                <button class="bt-anim-btn" id="bt-anim-btn">▶ 逐行生成</button>
            </div>
            <div class="bt-hint">点击三角形内部数字，观察“两肩之和”帕斯卡递推法则</div>
        `;
    },

    _bindEvents() {
        const ctrl = document.getElementById('bt-controls');
        if (!ctrl) return;

        const slider = document.getElementById('bt-n');
        const valEl = document.getElementById('bt-n-val');
        if (slider) this._on(slider, 'input', () => {
            this.stopAnim();
            this.n = parseInt(slider.value, 10);
            this.animRows = this.n;
            this.selCell = null;
            if (valEl) valEl.textContent = this.n;
            this._updatePresetBtns();
            this.draw();
            this.updateInfo();
        });

        ctrl.querySelectorAll('.bt-preset').forEach(btn => {
            this._on(btn, 'click', () => {
                this.stopAnim();
                this.n = parseInt(btn.dataset.n, 10);
                this.animRows = this.n;
                this.selCell = null;
                if (slider) slider.value = this.n;
                if (valEl) valEl.textContent = this.n;
                this._updatePresetBtns();
                this.draw();
                this.updateInfo();
            });
        });

        const bind = (id, prop) => {
            const el = document.getElementById(id);
            if (el) this._on(el, 'change', () => {
                this[prop] = el.checked;
                if (prop === 'pascalRule' && !el.checked) this.selCell = null;
                this.draw();
                this.updateInfo();
            });
        };
        bind('bt-chk-terms', 'showTerms');
        bind('bt-chk-pascal', 'pascalRule');

        const animBtn = document.getElementById('bt-anim-btn');
        if (animBtn) this._on(animBtn, 'click', () => {
            if (this.animating) this.stopAnim();
            else this.startAnim();
        });

        // Click on canvas → hit-test cells
        this._on(this.canvas, 'click', (e) => {
            if (!this.pascalRule) return;
            const rect = this.canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            for (const c of this._cellRects) {
                if (mx >= c.x && mx <= c.x + c.w && my >= c.y && my <= c.y + c.h) {
                    // toggle selection
                    if (this.selCell && this.selCell.i === c.i && this.selCell.k === c.k) {
                        this.selCell = null;
                    } else {
                        this.selCell = { i: c.i, k: c.k };
                    }
                    this.draw();
                    this.updateInfo();
                    return;
                }
            }
        });

        const wrap = this.canvas.parentElement;
        if (wrap && window.ResizeObserver) {
            this._resizeObs = new ResizeObserver(() => this.resize());
            this._resizeObs.observe(wrap);
        }
    },

    _updatePresetBtns() {
        const ctrl = document.getElementById('bt-controls');
        if (!ctrl) return;
        ctrl.querySelectorAll('.bt-preset').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.n, 10) === this.n);
        });
    },

    /* ── animation: build triangle row by row ── */
    startAnim() {
        this.animating = true;
        this.animRows = 0;
        this.selCell = null;
        const btn = document.getElementById('bt-anim-btn');
        if (btn) btn.textContent = '⏸ 停止';
        let last = performance.now();
        let acc = 0;
        const step = (now) => {
            if (!this.animating) return;
            const dt = (now - last) / 1000;
            last = now;
            acc += dt;
            if (acc >= 0.28) {
                acc = 0;
                this.animRows = Math.min(this.animRows + 1, this.n);
                this.draw();
                if (this.animRows >= this.n) { this.stopAnim(); return; }
            }
            this.animId = requestAnimationFrame(step);
        };
        this.animId = requestAnimationFrame(step);
    },

    stopAnim() {
        if (this.animating) this.animRows = this.n;
        this.animating = false;
        cancelAnimationFrame(this.animId);
        const btn = document.getElementById('bt-anim-btn');
        if (btn) btn.textContent = '▶ 逐行生成';
        this.draw();
    },

    /* ══════════════════════════════════════════
       Drawing — Pascal's triangle
       ══════════════════════════════════════════ */
    draw() {
        const { ctx, W, H } = this;
        if (!ctx) return;
        ctx.clearRect(0, 0, W, H);
        this._cellRects = [];

        const n = this.n;
        const rows = n + 1;
        const topPad = 30, botPad = 18, sidePad = 16;

        // adaptive cell size
        const maxCellW = 58, maxCellH = 40, gap = 6;
        let cw = Math.min(maxCellW, (W - 2 * sidePad) / (n + 1) - gap);
        let ch = Math.min(maxCellH, (H - topPad - botPad) / rows - gap * 0.5);
        cw = Math.max(20, cw); ch = Math.max(16, ch);
        const stepX = cw + gap;
        const stepY = ch + gap * 0.6;

        const fs = Math.max(11, Math.min(17, cw * 0.36));

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const reveal = this.animating ? this.animRows : n;
        const sel = this.selCell;
        const parentA = sel ? { i: sel.i - 1, k: sel.k - 1 } : null;
        const parentB = sel ? { i: sel.i - 1, k: sel.k } : null;
        const selInterior = sel && sel.i > 0 && sel.k > 0 && sel.k < sel.i;

        // store positions for arrows
        const pos = {};

        for (let i = 0; i <= reveal; i++) {
            const rowW = (i + 1) * cw + i * gap;
            const startX = (W - rowW) / 2;
            const y = topPad + i * stepY;
            for (let k = 0; k <= i; k++) {
                const x = startX + k * stepX;
                const v = this.comb(i, k);
                pos[`${i},${k}`] = { cx: x + cw / 2, cy: y + ch / 2 };
                this._cellRects.push({ i, k, x, y, w: cw, h: ch });

                const isLastRow = (i === n);
                let fill, stroke, txt;
                if (sel && sel.i === i && sel.k === k) {
                    fill = 'rgba(229,192,123,0.30)'; stroke = 'rgba(229,192,123,0.85)'; txt = '#f0d9a8';
                } else if (selInterior && ((parentA && parentA.i === i && parentA.k === k) || (parentB && parentB.i === i && parentB.k === k))) {
                    fill = 'rgba(120,200,140,0.22)'; stroke = 'rgba(120,200,140,0.75)'; txt = '#9fe0b0';
                } else if (isLastRow) {
                    fill = 'rgba(91,155,213,0.22)'; stroke = 'rgba(91,155,213,0.7)'; txt = '#bcd9f5';
                } else {
                    fill = 'rgba(255,255,255,0.05)'; stroke = 'rgba(255,255,255,0.14)'; txt = 'rgba(255,255,255,0.7)';
                }

                this._roundRect(x, y, cw, ch, 6);
                ctx.fillStyle = fill; ctx.fill();
                ctx.lineWidth = 1.3; ctx.strokeStyle = stroke; ctx.stroke();

                ctx.fillStyle = txt;
                ctx.font = (isLastRow ? 'bold ' : '') + fs + 'px ' + CF.sans;
                ctx.fillText(String(v), x + cw / 2, y + ch / 2 + 1);
            }
        }

        // Pascal recurrence arrows (two parents → selected)
        if (selInterior && reveal >= sel.i) {
            const target = pos[`${sel.i},${sel.k}`];
            [parentA, parentB].forEach(p => {
                const ps = pos[`${p.i},${p.k}`];
                if (ps && target) this._arrow(ps.cx, ps.cy + ch * 0.32, target.cx, target.cy - ch * 0.42, 'rgba(120,200,140,0.85)');
            });
            // annotation
            const a = this.comb(parentA.i, parentA.k);
            const b = this.comb(parentB.i, parentB.k);
            const s = this.comb(sel.i, sel.k);
            ctx.fillStyle = '#9fe0b0';
            ctx.font = '13px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillText(`C(${sel.i},${sel.k}) = ${a} + ${b} = ${s}`, W / 2, H - 8);
        }

        // title
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.font = '13px ' + CF.sans;
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText('杨辉三角（帕斯卡三角）— 第 n 行即 (a+b)ⁿ 的系数', 14, 8);
    },

    _roundRect(x, y, w, h, r) {
        const { ctx } = this;
        r = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    },

    _arrow(x1, y1, x2, y2, color) {
        const { ctx } = this;
        ctx.save();
        ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const ah = 7;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - ah * Math.cos(ang - 0.4), y2 - ah * Math.sin(ang - 0.4));
        ctx.lineTo(x2 - ah * Math.cos(ang + 0.4), y2 - ah * Math.sin(ang + 0.4));
        ctx.closePath(); ctx.fill();
        ctx.restore();
    },

    /* ══════════════════════════════════════════
       Expansion term rendering
       ══════════════════════════════════════════ */
    _expansionHTML() {
        const n = this.n;
        const selK = (this.selCell && this.selCell.i === n) ? this.selCell.k : -1;
        const terms = [];
        for (let k = 0; k <= n; k++) {
            const c = this.comb(n, k);
            const ea = n - k, eb = k;
            let t = '';
            if (c !== 1 || (ea === 0 && eb === 0)) t += `<span class="bt-coef">${c}</span>`;
            if (ea > 0) t += 'a' + (ea > 1 ? `<sup>${ea}</sup>` : '');
            if (eb > 0) t += 'b' + (eb > 1 ? `<sup>${eb}</sup>` : '');
            if (ea === 0 && eb === 0) t = `<span class="bt-coef">${c}</span>`;
            const cls = (k === selK) ? 'bt-term bt-term--sel' : 'bt-term';
            terms.push(`<span class="${cls}">${t}</span>`);
        }
        return terms.join('<span class="bt-plus">+</span>');
    },

    /* ── Info / Edu panel ── */
    updateInfo() {
        const el = document.getElementById('bt-info');
        if (!el) return;
        const n = this.n;
        const rowSum = Math.pow(2, n);                  // ΣC(n,k) = 2ⁿ
        const coefList = [];
        for (let k = 0; k <= n; k++) coefList.push(this.comb(n, k));
        // central / max coefficient
        const maxC = Math.max(...coefList);

        let selBlock = '';
        if (this.selCell) {
            const { i, k } = this.selCell;
            const v = this.comb(i, k);
            if (i > 0 && k > 0 && k < i) {
                const a = this.comb(i - 1, k - 1), b = this.comb(i - 1, k);
                selBlock = `<div class="math-row"><span class="math-key--amber">选中递推</span>C(${i},${k}) = C(${i - 1},${k - 1}) + C(${i - 1},${k}) = ${a} + ${b} = <strong>${v}</strong></div>`;
            } else {
                selBlock = `<div class="math-row"><span class="math-key--amber">选中端点</span>C(${i},${k}) = ${v}（每行首尾系数恒为 1）</div>`;
            }
        }

        el.innerHTML = `
            <div class="bt-info-title">(a + b)<sup>${n}</sup> 的二项展开</div>
            <div class="bt-info-subtitle">二项式定理 · 杨辉三角</div>

            ${this.showTerms ? `<div class="bt-expansion">(a+b)<sup>${n}</sup> = ${this._expansionHTML()}</div>` : ''}

            <div class="math-row"><span class="math-key">系数序列</span>${coefList.join(', ')}</div>
            <div class="math-row"><span class="math-key">系数和</span>ΣC(${n},k) = 2<sup>${n}</sup> = ${rowSum}（令 a=b=1）</div>
            <div class="math-row"><span class="math-key">最大系数</span>${maxC}${n % 2 === 0 ? `（中间项 C(${n},${n / 2})）` : `（中间两项 C(${n},${(n - 1) / 2}) = C(${n},${(n + 1) / 2})）`}</div>
            ${selBlock}

            <div class="bt-edu">
                <div class="math-hd"><span class="math-tag">二项式定理</span>核心知识点</div>
                <div class="math-row"><span class="math-key">通项公式</span>T<sub>k+1</sub> = C(n,k)·a<sup>n−k</sup>·b<sup>k</sup>（k = 0,1,…,n）</div>
                <div class="math-row"><span class="math-key">系数对称</span>C(n,k) = C(n,n−k)，展开式首尾等距两项系数相等</div>
                <div class="math-row"><span class="math-key--amber">帕斯卡递推</span>C(n,k) = C(n−1,k−1) + C(n−1,k)，即杨辉三角“两肩相加”</div>
                <div class="math-row"><span class="math-key">系数和</span>ΣC(n,k) = 2ⁿ；奇偶项系数和相等，各为 2ⁿ⁻¹</div>
                <div class="math-row"><span class="math-key">交错和</span>ΣC(n,k)(−1)ᵏ = 0（令 a=1, b=−1，n≥1）</div>
                <div class="math-note">💡 拖动 n 滑块看杨辉三角逐行生长；点击内部数字，绿色箭头展示它由上一行“两肩”相加而来。</div>
            </div>
        `;
    }
};

function initBinomial() { Binomial.init(); }
window.initBinomial = initBinomial;
