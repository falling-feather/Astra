/* ═══════════════════════════════════════════════════
   Sequences – Arithmetic & Geometric Visualization  v2
   ResizeObserver · Smooth Lerp · Education Panel
   ═══════════════════════════════════════════════════ */
const Sequences = {
    _listeners: [],
    _resizeObs: null,
    canvas: null, ctx: null, animId: null,
    W: 0, H: 0,
    running: false,
    mode: 'arithmetic',
    params: { a1: 2, d: 3, r: 1.5, n: 12 },
    hoverIdx: -1,
    displayH: [],   // current animated heights (lerp toward targets)
    targetH: [],    // computed real term values
    introT: 0,      // 0→1 intro animation
    lastTs: 0,

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        this.canvas = document.getElementById('sequences-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.running = true;
        this.introT = 0;
        this.lastTs = 0;
        this.displayH = [];
        this._resize();
        this._buildControls();
        this._syncTargets();
        this._bindEvents();
        this._updateInfo();
        this.animId = requestAnimationFrame(ts => this._loop(ts));
    },

    destroy() {
        this.running = false;
        if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
        for (const l of this._listeners) l.el.removeEventListener(l.evt, l.fn, l.opts);
        this._listeners = [];
        if (this._resizeObs) { this._resizeObs.disconnect(); this._resizeObs = null; }
        const c = document.getElementById('sequences-controls');
        if (c) c.innerHTML = '';
        const info = document.getElementById('sequences-info');
        if (info) info.innerHTML = '';
    },

    _resize() {
        const wrap = this.canvas.parentElement;
        if (!wrap) return;
        const dpr = window.devicePixelRatio || 1;
        const w = wrap.clientWidth;
        const h = Math.min(w * 0.58, 440);
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w;
        this.H = h;
    },

    _bindEvents() {
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver(() => this._resize());
            this._resizeObs.observe(this.canvas.parentElement);
        }
        this._on(this.canvas, 'mousemove', e => this._onPointer(e));
        this._on(this.canvas, 'touchmove', e => {
            e.preventDefault();
            if (e.touches.length) this._onPointer(e.touches[0]);
        }, { passive: false });
        this._on(this.canvas, 'mouseleave', () => { this.hoverIdx = -1; });
        this._on(this.canvas, 'touchend', () => { this.hoverIdx = -1; });
    },

    _buildControls() {
        const ctrl = document.getElementById('sequences-controls');
        if (!ctrl) return;
        ctrl.innerHTML = '';

        // mode buttons
        const modes = [
            { id: 'arithmetic', label: '\u7b49\u5dee\u6570\u5217' },
            { id: 'geometric', label: '\u7b49\u6bd4\u6570\u5217' }
        ];
        const btnWrap = document.createElement('div');
        btnWrap.className = 'seq-mode-btns';
        btnWrap.setAttribute('role', 'group');
        btnWrap.setAttribute('aria-label', '\u6570\u5217\u7c7b\u578b');
        modes.forEach(m => {
            const b = document.createElement('button');
            b.className = 'seq-mode-btn' + (m.id === this.mode ? ' active' : '');
            b.textContent = m.label;
            b.setAttribute('aria-pressed', String(m.id === this.mode));
            this._on(b, 'click', () => {
                this.mode = m.id;
                btnWrap.querySelectorAll('.seq-mode-btn').forEach(x => {
                    x.classList.remove('active');
                    x.setAttribute('aria-pressed', 'false');
                });
                b.classList.add('active');
                b.setAttribute('aria-pressed', 'true');
                this._updateParamVisibility();
                this._syncTargets();
                this._updateInfo();
            });
            btnWrap.appendChild(b);
        });
        ctrl.appendChild(btnWrap);

        // sliders
        const mkSlider = (label, key, min, max, step) => {
            const wrap = document.createElement('label');
            wrap.className = 'seq-param';
            const sp = document.createElement('span');
            sp.textContent = label;
            sp.className = 'seq-label';
            const inp = document.createElement('input');
            inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step;
            inp.value = this.params[key];
            inp.setAttribute('aria-label', label);
            const val = document.createElement('span');
            val.className = 'seq-val';
            val.textContent = this.params[key];
            this._on(inp, 'input', () => {
                this.params[key] = parseFloat(inp.value);
                val.textContent = inp.value;
                this._syncTargets();
                this._updateInfo();
            });
            wrap.appendChild(sp);
            wrap.appendChild(inp);
            wrap.appendChild(val);
            return wrap;
        };
        this._ctrlA1 = mkSlider('a\u2081=', 'a1', 1, 10, 1);
        this._ctrlD  = mkSlider('d=', 'd', 1, 8, 1);
        this._ctrlR  = mkSlider('r=', 'r', 1.1, 3, 0.1);
        this._ctrlN  = mkSlider('n=', 'n', 4, 20, 1);
        ctrl.appendChild(this._ctrlA1);
        ctrl.appendChild(this._ctrlD);
        ctrl.appendChild(this._ctrlR);
        ctrl.appendChild(this._ctrlN);
        this._updateParamVisibility();
    },

    _updateParamVisibility() {
        if (this.mode === 'arithmetic') {
            this._ctrlD.style.display = '';
            this._ctrlR.style.display = 'none';
        } else {
            this._ctrlD.style.display = 'none';
            this._ctrlR.style.display = '';
        }
    },

    _getTerms() {
        const { a1, d, r, n } = this.params;
        const terms = [];
        for (let i = 0; i < n; i++) {
            terms.push(this.mode === 'arithmetic' ? a1 + i * d : a1 * Math.pow(r, i));
        }
        return terms;
    },

    _syncTargets() {
        this.targetH = this._getTerms();
        while (this.displayH.length < this.targetH.length) this.displayH.push(0);
        while (this.displayH.length > this.targetH.length) this.displayH.pop();
    },

    _updateInfo() {
        const info = document.getElementById('sequences-info');
        if (!info) return;
        const { a1, d, r, n } = this.params;
        const terms = this._getTerms();
        const sn = terms.reduce((a, b) => a + b, 0);
        const an = terms[terms.length - 1];
        if (this.mode === 'arithmetic') {
            info.innerHTML =
                '<div class="seq-info__row">' +
                    '<span class="seq-info__tag">\u7b49\u5dee\u6570\u5217</span>' +
                    '<span class="seq-info__detail">\u516c\u5dee d = ' + d + '</span>' +
                '</div>' +
                '<div class="seq-info__formulas">' +
                    '<code>a\u2099 = a\u2081 + (n\u22121)d = ' + a1 + ' + (n\u22121)\u00d7' + d + '</code>' +
                    '<code>S\u2099 = n(a\u2081+a\u2099)/2 = ' + sn.toFixed(1) + '</code>' +
                    '<code>a\u2099 = a\u2099\u208b\u2081 + d\uff0c\u7b2c ' + n + ' \u9879 = ' + an.toFixed(1) + '</code>' +
                '</div>' +
                '<p class="seq-info__note">\ud83d\udca1 \u7b49\u5dee\u6570\u5217\u7684\u7279\u5f81\uff1a\u76f8\u90bb\u4e24\u9879\u4e4b\u5dee\u6052\u7b49\u4e8e\u516c\u5dee d\uff0c\u901a\u9879\u516c\u5f0f\u4e0e\u6c42\u548c\u516c\u5f0f\u662f\u6570\u5217\u89e3\u9898\u7684\u6838\u5fc3\u5de5\u5177</p>';
        } else {
            info.innerHTML =
                '<div class="seq-info__row">' +
                    '<span class="seq-info__tag">\u7b49\u6bd4\u6570\u5217</span>' +
                    '<span class="seq-info__detail">\u516c\u6bd4 q = ' + r + '</span>' +
                '</div>' +
                '<div class="seq-info__formulas">' +
                    '<code>a\u2099 = a\u2081\u00b7q\u207f\u207b\u00b9 = ' + a1 + '\u00d7' + r + '\u207f\u207b\u00b9</code>' +
                    '<code>S\u2099 = a\u2081(1\u2212q\u207f)/(1\u2212q) = ' + sn.toFixed(1) + '</code>' +
                    '<code>a\u2099 = a\u2099\u208b\u2081\u00b7q\uff0c\u7b2c ' + n + ' \u9879 = ' + an.toFixed(1) + '</code>' +
                '</div>' +
                '<p class="seq-info__note">\ud83d\udca1 \u7b49\u6bd4\u6570\u5217\u7684\u7279\u5f81\uff1a\u76f8\u90bb\u4e24\u9879\u4e4b\u6bd4\u6052\u7b49\u4e8e\u516c\u6bd4 q\uff0c\u5f53 |q|<1 \u65f6\u6570\u5217\u6536\u655b\uff0c|q|>1 \u65f6\u53d1\u6563</p>';
        }
    },

    _onPointer(e) {
        const rect = this.canvas.getBoundingClientRect();
        const mx = (e.clientX || e.pageX) - rect.left;
        const n = this.params.n;
        const margin = { left: 60, right: 30 };
        const gw = this.W - margin.left - margin.right;
        const barW = gw / n;
        const idx = Math.floor((mx - margin.left) / barW);
        this.hoverIdx = (idx >= 0 && idx < n) ? idx : -1;
    },

    _loop(ts) {
        if (!this.running) return;
        this.animId = requestAnimationFrame(t => this._loop(t));

        const dt = this.lastTs ? Math.min((ts - this.lastTs) / 1000, 0.05) : 0.016;
        this.lastTs = ts;

        // intro animation
        if (this.introT < 1) this.introT = Math.min(1, this.introT + dt * 1.5);

        // smooth lerp displayH toward targetH
        const lerpSpeed = dt * 8;
        for (let i = 0; i < this.displayH.length; i++) {
            const diff = (this.targetH[i] || 0) - this.displayH[i];
            if (Math.abs(diff) > 0.05) {
                this.displayH[i] += diff * Math.min(1, lerpSpeed);
            } else {
                this.displayH[i] = this.targetH[i] || 0;
            }
        }

        this._draw();
    },

    _draw() {
        const ctx = this.ctx, W = this.W, H = this.H;
        if (!W || !H) return;
        ctx.clearRect(0, 0, W, H);

        const terms = this._getTerms();
        const n = terms.length;
        const dh = this.displayH;
        const maxVal = Math.max(...terms, 1);
        const margin = { top: 60, right: 30, bottom: 70, left: 60 };
        const gw = W - margin.left - margin.right;
        const gh = H - margin.top - margin.bottom;
        const barW = gw / n;
        const intro = this.introT < 0.5 ? 2 * this.introT * this.introT : 1 - Math.pow(-2 * this.introT + 2, 2) / 2;
        const blue = this.mode === 'arithmetic' ? [91, 141, 206] : [155, 120, 206];
        const accentRgba = (a) => 'rgba(' + blue[0] + ',' + blue[1] + ',' + blue[2] + ',' + a + ')';

        // axes
        ctx.strokeStyle = 'rgba(200,200,200,0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(margin.left, margin.top);
        ctx.lineTo(margin.left, margin.top + gh);
        ctx.lineTo(margin.left + gw, margin.top + gh);
        ctx.stroke();

        // y-axis ticks
        ctx.font = '16px ' + CF.mono;
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(200,200,200,0.45)';
        for (let i = 0; i <= 4; i++) {
            const val = (maxVal * i / 4).toFixed(1);
            const yy = margin.top + gh - (gh * i / 4);
            ctx.fillText(val, margin.left - 6, yy + 3);
            if (i > 0) {
                ctx.beginPath();
                ctx.moveTo(margin.left, yy);
                ctx.lineTo(margin.left + gw, yy);
                ctx.strokeStyle = 'rgba(200,200,200,0.06)';
                ctx.stroke();
            }
        }

        // partial sum shaded area (under connecting line)
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
            const x = margin.left + i * barW + barW * 0.5;
            const barH = (dh[i] / maxVal) * gh * intro;
            const y = margin.top + gh - barH;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.lineTo(margin.left + (n - 1) * barW + barW * 0.5, margin.top + gh);
        ctx.lineTo(margin.left + barW * 0.5, margin.top + gh);
        ctx.closePath();
        const areaGrad = ctx.createLinearGradient(0, margin.top, 0, margin.top + gh);
        areaGrad.addColorStop(0, accentRgba(0.12));
        areaGrad.addColorStop(1, accentRgba(0.02));
        ctx.fillStyle = areaGrad;
        ctx.fill();

        // bars
        for (let i = 0; i < n; i++) {
            const barH = (dh[i] / maxVal) * gh * intro;
            const x = margin.left + i * barW + barW * 0.15;
            const y = margin.top + gh - barH;
            const w = barW * 0.7;
            const isHover = (i === this.hoverIdx);

            // bar gradient
            const bg = ctx.createLinearGradient(x, y, x, y + barH);
            bg.addColorStop(0, accentRgba(isHover ? 0.85 : 0.6));
            bg.addColorStop(1, accentRgba(isHover ? 0.55 : 0.3));
            ctx.fillStyle = bg;
            ctx.fillRect(x, y, w, barH);

            if (isHover) {
                ctx.strokeStyle = accentRgba(0.9);
                ctx.lineWidth = 1.5;
                ctx.strokeRect(x, y, w, barH);
            }

            // value on top
            ctx.fillStyle = 'rgba(200,200,200,0.7)';
            ctx.font = (barW > 35 ? '16' : '13') + 'px ' + CF.mono;
            ctx.textAlign = 'center';
            if (barH > 14) ctx.fillText(terms[i].toFixed(1), x + w / 2, y - 4);

            // x-axis index label
            ctx.fillStyle = 'rgba(200,200,200,0.45)';
            ctx.fillText('a' + (i + 1), x + w / 2, margin.top + gh + 14);
        }

        // connecting line + dots
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
            const x = margin.left + i * barW + barW * 0.5;
            const barH = (dh[i] / maxVal) * gh * intro;
            const y = margin.top + gh - barH;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = accentRgba(0.6);
        ctx.lineWidth = 2;
        ctx.stroke();

        for (let i = 0; i < n; i++) {
            const x = margin.left + i * barW + barW * 0.5;
            const barH = (dh[i] / maxVal) * gh * intro;
            const y = margin.top + gh - barH;
            ctx.beginPath();
            ctx.arc(x, y, i === this.hoverIdx ? 5 : 3, 0, Math.PI * 2);
            ctx.fillStyle = accentRgba(0.85);
            ctx.fill();
        }

        // formulas (top)
        const fs = Math.max(18, W * 0.033);
        ctx.font = 'bold ' + fs + 'px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillStyle = accentRgba(0.9);
        const { a1, d, r } = this.params;
        const sn = terms.reduce((a, b) => a + b, 0);
        if (this.mode === 'arithmetic') {
            ctx.fillText('a\u2099 = ' + a1 + ' + (n\u22121)\u00d7' + d, margin.left + 10, 24);
            ctx.fillText('S\u2099 = ' + sn.toFixed(1), margin.left + 10, 24 + fs + 4);
        } else {
            ctx.fillText('a\u2099 = ' + a1 + ' \u00d7 ' + r + '\u207f\u207b\u00b9', margin.left + 10, 24);
            ctx.fillText('S\u2099 = ' + sn.toFixed(1), margin.left + 10, 24 + fs + 4);
        }

        // hover tooltip
        if (this.hoverIdx >= 0 && this.hoverIdx < n) {
            const i = this.hoverIdx;
            const val = terms[i];
            const partialSum = terms.slice(0, i + 1).reduce((a, b) => a + b, 0);
            const tx = margin.left + i * barW + barW * 0.5;
            const ty = margin.top + gh + 32;

            // background pill
            const txt = 'a' + (i + 1) + ' = ' + val.toFixed(2) + '   S' + (i + 1) + ' = ' + partialSum.toFixed(2);
            ctx.font = '18px ' + CF.sans;
            const tm = ctx.measureText(txt);
            const pw = tm.width + 16, ph = 22;
            const px = Math.max(margin.left, Math.min(W - margin.right - pw, tx - pw / 2));
            ctx.fillStyle = 'rgba(30,30,40,0.85)';
            ctx.beginPath();
            ctx.roundRect(px, ty - ph / 2 - 2, pw, ph, 4);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.textAlign = 'center';
            ctx.fillText(txt, px + pw / 2, ty + 3);
        }
    }
};

function initSequences() { Sequences.init(); }
window.Sequences = Sequences;
