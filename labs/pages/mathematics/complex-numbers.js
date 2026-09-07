// ===== Complex Numbers Visualization =====
const ComplexVis = {
    canvas: null, ctx: null, W: 0, H: 0, dpr: 1,
    mode: 'ops', // 'ops' | 'roots' | 'domain'

    /* ── Operations mode ── */
    z1: { re: 2, im: 1 }, z2: { re: -1, im: 2 },
    operation: 'add',
    dragging: null,
    eulerTheta: 0, eulerAnimId: null,

    /* ── View ── */
    viewRange: 6,

    /* ── Roots mode ── */
    rootN: 5,
    rootAnimId: null,
    rootPhase: 0,

    /* ── Domain coloring ── */
    domainFunc: 'z2',
    _domainDirty: true,
    _offscreen: null,

    _ro: null,
    _listeners: [],

    /* ── Adaptive grid step ── */
    get _gridStep() {
        const t = this.viewRange / 6;
        const p = Math.pow(10, Math.floor(Math.log10(t)));
        const f = t / p;
        return p * (f > 5 ? 10 : f > 2 ? 5 : f > 1 ? 2 : 1);
    },

    // ═══════════════════════════════════════════
    // Initialization
    // ═══════════════════════════════════════════
    init() {
        this.canvas = document.getElementById('complex-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this._ro = new ResizeObserver(() => {
            this.resize();
            this._domainDirty = true;
            this.draw();
        });
        this._ro.observe(this.canvas.parentElement);
        this._injectModeButtons();
        this.bindControls();
        this.resize();
        this.setMode('ops');
    },

    destroy() {
        if (this.eulerAnimId) { cancelAnimationFrame(this.eulerAnimId); this.eulerAnimId = null; }
        if (this.rootAnimId) { cancelAnimationFrame(this.rootAnimId); this.rootAnimId = null; }
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
        this._listeners.forEach(([el, evt, fn, opts]) => el.removeEventListener(evt, fn, opts));
        this._listeners = [];
    },

    _on(el, evt, fn, opts) {
        if (!el) return;
        el.addEventListener(evt, fn, opts);
        this._listeners.push([el, evt, fn, opts]);
    },

    _injectModeButtons() {
        const header = this.canvas.closest('.demo-section')?.querySelector('.section-header');
        if (!header || document.getElementById('cx-mode-btns')) return;
        const div = document.createElement('div');
        div.id = 'cx-mode-btns';
        div.style.cssText = 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;';
        div.innerHTML = [['ops','运算'],['roots','单位根'],['domain','域着色']]
            .map(([m,t]) => `<button class="cx-mode-btn${m==='ops'?' active':''}" data-mode="${m}">${t}</button>`)
            .join('');
        header.appendChild(div);
        div.querySelectorAll('.cx-mode-btn').forEach(btn =>
            this._on(btn, 'click', () => this.setMode(btn.dataset.mode))
        );
    },

    // ═══════════════════════════════════════════
    // Mode management
    // ═══════════════════════════════════════════
    setMode(m) {
        this.mode = m;
        document.querySelectorAll('.cx-mode-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.mode === m));

        // Stop running animations
        if (this.eulerAnimId) { cancelAnimationFrame(this.eulerAnimId); this.eulerAnimId = null; }
        if (this.rootAnimId) { cancelAnimationFrame(this.rootAnimId); this.rootAnimId = null; }

        const show = (sel, vis) => {
            const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
            if (el) el.style.display = vis ? '' : 'none';
        };
        const isEuler = this.operation === 'euler';
        show('.cx-controls', m === 'ops');
        show('.cx-inputs', m === 'ops' && !isEuler);
        show('.cx-presets', m === 'ops' && !isEuler);
        show('#cx-euler-panel', m === 'ops' && isEuler);

        let rootsP = document.getElementById('cx-roots-panel');
        if (m === 'roots' && !rootsP) rootsP = this._createPanel('roots');
        show(rootsP, m === 'roots');

        let domainP = document.getElementById('cx-domain-panel');
        if (m === 'domain' && !domainP) domainP = this._createPanel('domain');
        show(domainP, m === 'domain');
        if (m === 'domain') this._domainDirty = true;

        this._updateLegend();
        this.draw();
        this.updateInfo();
    },

    _createPanel(type) {
        const wrap = this.canvas.closest('.demo-content');
        const before = wrap.querySelector('.cx-canvas-wrap');
        const panel = document.createElement('div');
        if (type === 'roots') {
            panel.id = 'cx-roots-panel';
            panel.className = 'cx-roots-panel';
            panel.innerHTML = `
                <label>n = <span id="cx-root-n-val">${this.rootN}</span></label>
                <input type="range" id="cx-root-n" min="2" max="12" value="${this.rootN}" step="1">
                <button class="btn-primary" id="cx-roots-anim">动画演示</button>`;
            wrap.insertBefore(panel, before);
            panel.querySelector('#cx-root-n').addEventListener('input', e => {
                this.rootN = +e.target.value;
                document.getElementById('cx-root-n-val').textContent = this.rootN;
                this.draw(); this.updateInfo();
            });
            panel.querySelector('#cx-roots-anim').addEventListener('click', () => this.animateRoots());
        } else {
            panel.id = 'cx-domain-panel';
            panel.className = 'cx-domain-panel';
            const fns = [['z2','z²'],['z3','z³'],['inv','1/z'],['exp','eᶻ'],['sin','sin z'],['z3m1','z³−1']];
            panel.innerHTML = `<div class="cx-domain-funcs">${fns.map(([k,t]) =>
                `<button class="cx-domain-btn${k===this.domainFunc?' active':''}" data-fn="${k}">${t}</button>`
            ).join('')}</div>`;
            wrap.insertBefore(panel, before);
            panel.querySelectorAll('.cx-domain-btn').forEach(btn =>
                btn.addEventListener('click', () => {
                    panel.querySelectorAll('.cx-domain-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.domainFunc = btn.dataset.fn;
                    this._domainDirty = true;
                    this.draw(); this.updateInfo();
                })
            );
        }
        return panel;
    },

    _updateLegend() {
        const legend = document.querySelector('.cx-legend');
        if (!legend) return;
        if (this.mode === 'ops') {
            legend.innerHTML = '<span class="cxl-z1">z₁</span><span class="cxl-z2">z₂</span><span class="cxl-result">结果 w</span>';
        } else if (this.mode === 'roots') {
            legend.innerHTML = '<span class="cxl-z1">单位根</span><span class="cxl-result">正多边形</span>';
        } else {
            legend.innerHTML = '<span style="font-size:0.8rem;color:rgba(255,255,255,0.5)">色相 = arg(w)，亮度 = |w| 等高线</span>';
        }
    },

    // ═══════════════════════════════════════════
    // Resize
    // ═══════════════════════════════════════════
    resize() {
        const wrap = this.canvas.parentElement;
        const w = wrap.clientWidth;
        if (w < 1) return;
        const h = Math.min(w, 520);
        this.dpr = window.devicePixelRatio || 1;
        this.canvas.width = w * this.dpr;
        this.canvas.height = h * this.dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this.W = w; this.H = h;
        this._domainDirty = true;
    },

    // ═══════════════════════════════════════════
    // Controls binding
    // ═══════════════════════════════════════════
    bindControls() {
        document.querySelectorAll('.cx-op-btn').forEach(btn =>
            this._on(btn, 'click', () => {
                document.querySelectorAll('.cx-op-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.operation = btn.dataset.op;
                this.toggleEulerPanel();
                this.draw(); this.updateInfo();
            })
        );

        ['z1-re','z1-im','z2-re','z2-im'].forEach(id => {
            const el = document.getElementById('cx-' + id);
            if (el) this._on(el, 'input', () => {
                const v = parseFloat(el.value);
                if (isNaN(v)) return;
                const [which, part] = id.split('-');
                this[which][part] = v;
                this.draw(); this.updateInfo();
            });
        });

        const thetaSlider = document.getElementById('cx-theta');
        if (thetaSlider) this._on(thetaSlider, 'input', () => {
            this.eulerTheta = parseFloat(thetaSlider.value);
            const valEl = document.getElementById('cx-theta-val');
            if (valEl) valEl.textContent = (this.eulerTheta * 180 / Math.PI).toFixed(0);
            this.draw(); this.updateInfo();
        });

        const animBtn = document.getElementById('cx-euler-anim');
        if (animBtn) this._on(animBtn, 'click', () => this.animateEuler());

        document.querySelectorAll('.cx-preset-btn').forEach(btn =>
            this._on(btn, 'click', () => this.loadPreset(btn.dataset.preset))
        );

        // Canvas pointer events
        this._on(this.canvas, 'mousedown', e => this.onPointerDown(e));
        this._on(this.canvas, 'mousemove', e => this.onPointerMove(e));
        this._on(this.canvas, 'mouseup', () => this.dragging = null);
        this._on(this.canvas, 'mouseleave', () => this.dragging = null);
        this._on(this.canvas, 'touchstart', e => { e.preventDefault(); this.onPointerDown(e.touches[0]); }, { passive: false });
        this._on(this.canvas, 'touchmove', e => { e.preventDefault(); this.onPointerMove(e.touches[0]); }, { passive: false });
        this._on(this.canvas, 'touchend', () => this.dragging = null);

        // Scroll-to-zoom
        this._on(this.canvas, 'wheel', e => {
            e.preventDefault();
            const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
            this.viewRange = Math.max(1, Math.min(50, this.viewRange * factor));
            this._domainDirty = true;
            this.draw();
        }, { passive: false });
    },

    toggleEulerPanel() {
        const isEuler = this.operation === 'euler';
        const euler = document.getElementById('cx-euler-panel');
        const inputs = document.querySelector('.cx-inputs');
        const presets = document.querySelector('.cx-presets');
        if (euler) euler.style.display = isEuler ? 'flex' : 'none';
        if (inputs) inputs.style.display = isEuler ? 'none' : '';
        if (presets) presets.style.display = isEuler ? 'none' : '';
    },

    // ═══════════════════════════════════════════
    // Coordinate conversion
    // ═══════════════════════════════════════════
    screenToComplex(px, py) {
        const r = this.viewRange;
        return {
            re: (px / this.W - 0.5) * 2 * r,
            im: -(py / this.H - 0.5) * 2 * r * (this.H / this.W)
        };
    },

    complexToScreen(re, im) {
        const r = this.viewRange;
        return {
            x: (re / (2 * r) + 0.5) * this.W,
            y: (-im / (2 * r * (this.H / this.W)) + 0.5) * this.H
        };
    },

    // ═══════════════════════════════════════════
    // Pointer events
    // ═══════════════════════════════════════════
    onPointerDown(e) {
        if (this.mode !== 'ops') return;
        const rect = this.canvas.getBoundingClientRect();
        const c = this.screenToComplex(e.clientX - rect.left, e.clientY - rect.top);
        const d1 = Math.hypot(c.re - this.z1.re, c.im - this.z1.im);
        const d2 = Math.hypot(c.re - this.z2.re, c.im - this.z2.im);
        const thr = this.viewRange * 0.08;
        if (d1 < thr && d1 <= d2) this.dragging = 'z1';
        else if (d2 < thr) this.dragging = 'z2';
    },

    onPointerMove(e) {
        if (!this.dragging || this.mode !== 'ops') return;
        const rect = this.canvas.getBoundingClientRect();
        const c = this.screenToComplex(e.clientX - rect.left, e.clientY - rect.top);
        const snap = v => Math.round(v * 2) / 2;
        this[this.dragging].re = snap(c.re);
        this[this.dragging].im = snap(c.im);
        this.syncInputs();
        this.draw(); this.updateInfo();
    },

    syncInputs() {
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        set('cx-z1-re', this.z1.re); set('cx-z1-im', this.z1.im);
        set('cx-z2-re', this.z2.re); set('cx-z2-im', this.z2.im);
    },

    // ═══════════════════════════════════════════
    // Main draw dispatcher
    // ═══════════════════════════════════════════
    draw() {
        const { ctx, W, H } = this;
        if (!W || !H) return;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#0d1017';
        ctx.fillRect(0, 0, W, H);

        if (this.mode === 'domain') {
            this.drawDomain();
        } else {
            this.drawGrid();
            this.drawAxes();
            if (this.mode === 'ops') {
                if (this.operation === 'euler') this.drawEuler();
                else this.drawVectors();
            } else if (this.mode === 'roots') {
                this.drawRoots();
            }
        }
    },

    // ═══════════════════════════════════════════
    // Grid & Axes (shared by ops & roots)
    // ═══════════════════════════════════════════
    drawGrid() {
        const { ctx, W, H } = this;
        const r = this.viewRange;
        const step = this._gridStep;
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        for (let v = Math.ceil(-r / step) * step; v <= r; v += step) {
            const { x } = this.complexToScreen(v, 0);
            const { y } = this.complexToScreen(0, v);
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }
    },

    drawAxes() {
        const { ctx, W, H } = this;
        const r = this.viewRange;
        const step = this._gridStep;
        const origin = this.complexToScreen(0, 0);

        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(0, origin.y); ctx.lineTo(W, origin.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(origin.x, 0); ctx.lineTo(origin.x, H); ctx.stroke();

        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '18px ' + CF.mono;
        const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
        ctx.textAlign = 'center';
        for (let v = Math.ceil(-r / step) * step; v <= r; v += step) {
            if (Math.abs(v) < step * 0.01) continue;
            const { x } = this.complexToScreen(v, 0);
            ctx.fillText(Number(v.toFixed(dec)), x, origin.y + 14);
        }
        ctx.textAlign = 'right';
        for (let v = Math.ceil(-r / step) * step; v <= r; v += step) {
            if (Math.abs(v) < step * 0.01) continue;
            const { y } = this.complexToScreen(0, v);
            ctx.fillText(Number(v.toFixed(dec)) + 'i', origin.x - 6, y + 4);
        }
        ctx.fillText('Re', W - 8, origin.y - 6);
        ctx.textAlign = 'left';
        ctx.fillText('Im', origin.x + 6, 14);

        // Unit circle reference
        const uc = this.complexToScreen(1, 0);
        const ucR = uc.x - origin.x;
        if (ucR > 5) {
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.arc(origin.x, origin.y, ucR, 0, Math.PI * 2); ctx.stroke();
            ctx.setLineDash([]);
        }
    },

    // ═══════════════════════════════════════════
    // Operations mode drawing
    // ═══════════════════════════════════════════
    drawVectors() {
        const result = this.compute();
        this.drawArrow(0, 0, this.z1.re, this.z1.im, '#5b8dce');
        this.drawArrow(0, 0, this.z2.re, this.z2.im, '#8b6fc0');
        if (!isNaN(result.re)) this.drawArrow(0, 0, result.re, result.im, '#4d9e7e');

        if (this.operation === 'add') {
            this.drawDashed(this.z1.re, this.z1.im, result.re, result.im, '#4d9e7e');
            this.drawDashed(this.z2.re, this.z2.im, result.re, result.im, '#4d9e7e');
        } else if (this.operation === 'sub') {
            this.drawDashed(this.z2.re, this.z2.im, this.z1.re, this.z1.im, '#c4793a');
        } else if (this.operation === 'mul' || this.operation === 'div') {
            this.drawAngleArc();
            this._drawModulusCircle(this.z1, 'rgba(91,141,206,0.15)');
            this._drawModulusCircle(this.z2, 'rgba(139,111,192,0.15)');
            if (!isNaN(result.re)) this._drawModulusCircle(result, 'rgba(77,158,126,0.2)');
        }

        this.drawPointLabel(this.z1, '#5b8dce', 'z₁');
        this.drawPointLabel(this.z2, '#8b6fc0', 'z₂');
        if (!isNaN(result.re)) this.drawPointLabel(result, '#4d9e7e', 'w');
    },

    _drawModulusCircle(z, color) {
        const { ctx } = this;
        const origin = this.complexToScreen(0, 0);
        const mod = Math.hypot(z.re, z.im);
        const p = this.complexToScreen(mod, 0);
        const radius = p.x - origin.x;
        if (radius < 3 || radius > this.W * 2) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(origin.x, origin.y, radius, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
    },

    drawEuler() {
        const { ctx } = this;
        const origin = this.complexToScreen(0, 0);
        const uc = this.complexToScreen(1, 0);
        const unitR = uc.x - origin.x;
        const t = this.eulerTheta;
        const px = Math.cos(t), py = Math.sin(t);
        const pt = this.complexToScreen(px, py);

        ctx.strokeStyle = 'rgba(91,141,206,0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(origin.x, origin.y, unitR, 0, Math.PI * 2); ctx.stroke();

        ctx.strokeStyle = '#c4793a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(origin.x, origin.y, unitR * 0.3, 0, -t, t < 0); ctx.stroke();

        const la = t / 2;
        ctx.fillStyle = '#c4793a';
        ctx.font = '20px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText('θ', origin.x + unitR * 0.38 * Math.cos(-la), origin.y + unitR * 0.38 * Math.sin(-la));

        this.drawArrow(0, 0, px, py, '#4d9e7e');

        const cosP = this.complexToScreen(px, 0);
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = '#5b8dce'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(origin.x, origin.y); ctx.lineTo(cosP.x, cosP.y); ctx.stroke();
        ctx.strokeStyle = '#8b6fc0';
        ctx.beginPath(); ctx.moveTo(pt.x, pt.y); ctx.lineTo(cosP.x, cosP.y); ctx.stroke();
        ctx.setLineDash([]);

        ctx.font = '17px ' + CF.mono;
        ctx.fillStyle = '#5b8dce'; ctx.textAlign = 'center';
        ctx.fillText('cos θ = ' + px.toFixed(2), (origin.x + cosP.x) / 2, origin.y + 18);
        ctx.fillStyle = '#8b6fc0'; ctx.textAlign = 'left';
        ctx.fillText('sin θ = ' + py.toFixed(2), pt.x + 6, (pt.y + cosP.y) / 2);

        ctx.fillStyle = '#4d9e7e';
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = '18px ' + CF.sans; ctx.textAlign = 'left';
        ctx.fillText(`(${px.toFixed(2)}, ${py.toFixed(2)}i)`, pt.x + 10, pt.y - 8);
    },

    // ═══════════════════════════════════════════
    // Roots of Unity mode
    // ═══════════════════════════════════════════
    drawRoots() {
        const { ctx } = this;
        const n = this.rootN;
        const origin = this.complexToScreen(0, 0);
        const uc = this.complexToScreen(1, 0);
        const unitR = uc.x - origin.x;

        // Unit circle
        ctx.strokeStyle = 'rgba(91,141,206,0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(origin.x, origin.y, unitR, 0, Math.PI * 2); ctx.stroke();

        // Compute roots
        const roots = [];
        for (let k = 0; k < n; k++) {
            const angle = 2 * Math.PI * k / n + this.rootPhase;
            roots.push({ re: Math.cos(angle), im: Math.sin(angle), angle, k });
        }

        // Polygon fill + stroke
        ctx.beginPath();
        roots.forEach((r, i) => {
            const p = this.complexToScreen(r.re, r.im);
            i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
        });
        ctx.closePath();
        ctx.fillStyle = 'rgba(77,158,126,0.06)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(77,158,126,0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Spokes from origin
        roots.forEach(r => {
            const p = this.complexToScreen(r.re, r.im);
            ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(origin.x, origin.y); ctx.lineTo(p.x, p.y); ctx.stroke();
        });

        // Root points
        const colors = ['#5b8dce','#8b6fc0','#4d9e7e','#c4793a','#e06c75',
                         '#d19a66','#61afef','#c678dd','#98c379','#be5046','#56b6c2','#e5c07b'];
        roots.forEach((r, i) => {
            const p = this.complexToScreen(r.re, r.im);
            const color = colors[i % colors.length];
            ctx.shadowColor = color; ctx.shadowBlur = 10;
            ctx.fillStyle = color;
            ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;

            // Label
            const label = i === 0 ? '1' : i === 1 ? 'ω' : 'ω' + this._sup(i);
            ctx.fillStyle = '#fff';
            ctx.font = '17px ' + CF.mono;
            ctx.textAlign = 'center';
            const lr = unitR + 18;
            ctx.fillText(label, origin.x + lr * Math.cos(-r.angle), origin.y + lr * Math.sin(-r.angle) + 4);
        });

        // Rotation angle arc
        if (n >= 2) {
            const dAngle = 2 * Math.PI / n;
            const arcR = unitR * 0.4;
            ctx.strokeStyle = '#c4793a'; ctx.lineWidth = 2;
            const start = -(this.rootPhase);
            ctx.beginPath(); ctx.arc(origin.x, origin.y, arcR, start, start - dAngle, true); ctx.stroke();
            const mid = start - dAngle / 2;
            ctx.fillStyle = '#c4793a';
            ctx.font = '18px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillText(`${(360/n).toFixed(1)}°`, origin.x + (arcR + 14) * Math.cos(mid), origin.y + (arcR + 14) * Math.sin(mid) + 4);
        }
    },

    _sup(n) {
        const s = '⁰¹²³⁴⁵⁶⁷⁸⁹';
        return String(n).split('').map(c => s[+c]).join('');
    },

    animateRoots() {
        if (this.rootAnimId) {
            cancelAnimationFrame(this.rootAnimId); this.rootAnimId = null;
            this.rootPhase = 0;
            const btn = document.getElementById('cx-roots-anim');
            if (btn) btn.textContent = '动画演示';
            this.draw(); return;
        }
        const btn = document.getElementById('cx-roots-anim');
        if (btn) btn.textContent = '停止';
        const t0 = performance.now();
        const loop = now => {
            this.rootPhase = ((now - t0) / 2000) * (2 * Math.PI / this.rootN) % (2 * Math.PI);
            this.draw();
            this.rootAnimId = requestAnimationFrame(loop);
        };
        this.rootAnimId = requestAnimationFrame(loop);
    },

    // ═══════════════════════════════════════════
    // Domain Coloring mode
    // ═══════════════════════════════════════════
    drawDomain() {
        const { ctx, W, H } = this;
        if (this._domainDirty) {
            this._renderDomainToOffscreen();
            this._domainDirty = false;
        }
        if (this._offscreen) ctx.drawImage(this._offscreen, 0, 0, W, H);
        this.drawAxes();
        this._drawSpecialPoints();
    },

    _renderDomainToOffscreen() {
        const { W, H } = this;
        const scale = 2; // half-res for performance
        const w = Math.ceil(W / scale), h = Math.ceil(H / scale);
        if (!this._offscreen) this._offscreen = document.createElement('canvas');
        this._offscreen.width = w; this._offscreen.height = h;
        const octx = this._offscreen.getContext('2d');
        const imgData = octx.createImageData(w, h);
        const data = imgData.data;
        const r = this.viewRange, aspect = H / W;

        for (let py = 0; py < h; py++) {
            const im = -((py / h) - 0.5) * 2 * r * aspect;
            for (let px = 0; px < w; px++) {
                const re = ((px / w) - 0.5) * 2 * r;
                const [wRe, wIm] = this._evalDomainFunc(re, im);
                const [cr, cg, cb] = this._domainColor(wRe, wIm);
                const idx = (py * w + px) * 4;
                data[idx] = cr; data[idx+1] = cg; data[idx+2] = cb; data[idx+3] = 255;
            }
        }
        octx.putImageData(imgData, 0, 0);
    },

    _evalDomainFunc(re, im) {
        switch (this.domainFunc) {
            case 'z2': return [re*re - im*im, 2*re*im];
            case 'z3': return [re*re*re - 3*re*im*im, 3*re*re*im - im*im*im];
            case 'inv': {
                const d = re*re + im*im;
                if (d < 1e-20) return [1e10, 0];
                return [re/d, -im/d];
            }
            case 'exp': {
                const er = Math.exp(re);
                return [er * Math.cos(im), er * Math.sin(im)];
            }
            case 'sin': return [Math.sin(re) * Math.cosh(im), Math.cos(re) * Math.sinh(im)];
            case 'z3m1': return [re*re*re - 3*re*im*im - 1, 3*re*re*im - im*im*im];
            default: return [re, im];
        }
    },

    _domainColor(wRe, wIm) {
        const arg = Math.atan2(wIm, wRe);
        const hue = (arg / Math.PI + 1) / 2; // [0, 1]
        const mod = Math.sqrt(wRe * wRe + wIm * wIm);
        const logMod = Math.log2(Math.max(mod, 1e-30));
        const frac = logMod - Math.floor(logMod);
        const lightness = 0.5 + 0.15 * (2 * frac - 1);
        return this._hsl2rgb(hue, 0.85, lightness);
    },

    _hsl2rgb(h, s, l) {
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs((h * 6) % 2 - 1));
        const m = l - c / 2;
        let r, g, b;
        const h6 = h * 6;
        if      (h6 < 1) { r = c; g = x; b = 0; }
        else if (h6 < 2) { r = x; g = c; b = 0; }
        else if (h6 < 3) { r = 0; g = c; b = x; }
        else if (h6 < 4) { r = 0; g = x; b = c; }
        else if (h6 < 5) { r = x; g = 0; b = c; }
        else              { r = c; g = 0; b = x; }
        return [Math.round((r+m)*255), Math.round((g+m)*255), Math.round((b+m)*255)];
    },

    _drawSpecialPoints() {
        const { ctx } = this;
        const pts = [];
        const r = this.viewRange;
        switch (this.domainFunc) {
            case 'z2': pts.push({ re:0, im:0, type:'zero', ord:2 }); break;
            case 'z3': pts.push({ re:0, im:0, type:'zero', ord:3 }); break;
            case 'inv': pts.push({ re:0, im:0, type:'pole', ord:1 }); break;
            case 'z3m1':
                for (let k = 0; k < 3; k++) {
                    const a = 2 * Math.PI * k / 3;
                    pts.push({ re: Math.cos(a), im: Math.sin(a), type:'zero', ord:1 });
                }
                break;
            case 'sin':
                for (let n = Math.ceil(-r/Math.PI); n <= Math.floor(r/Math.PI); n++)
                    pts.push({ re: n*Math.PI, im:0, type:'zero', ord:1 });
                break;
        }
        pts.forEach(pt => {
            const p = this.complexToScreen(pt.re, pt.im);
            if (p.x < -10 || p.x > this.W+10 || p.y < -10 || p.y > this.H+10) return;
            if (pt.type === 'zero') {
                ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2); ctx.stroke();
                ctx.fillStyle = '#fff'; ctx.font = '16px ' + CF.mono; ctx.textAlign = 'left';
                ctx.fillText(pt.ord > 1 ? `零点(${pt.ord}阶)` : '零点', p.x + 12, p.y + 4);
            } else {
                ctx.strokeStyle = '#ff6b6b'; ctx.lineWidth = 2;
                const s = 7;
                ctx.beginPath(); ctx.moveTo(p.x-s, p.y-s); ctx.lineTo(p.x+s, p.y+s); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(p.x+s, p.y-s); ctx.lineTo(p.x-s, p.y+s); ctx.stroke();
                ctx.fillStyle = '#ff6b6b'; ctx.font = '16px ' + CF.mono; ctx.textAlign = 'left';
                ctx.fillText(pt.ord > 1 ? `极点(${pt.ord}阶)` : '极点', p.x + 12, p.y + 4);
            }
        });
    },

    // ═══════════════════════════════════════════
    // Shared drawing helpers
    // ═══════════════════════════════════════════
    drawArrow(fromRe, fromIm, toRe, toIm, color) {
        const { ctx } = this;
        const from = this.complexToScreen(fromRe, fromIm);
        const to = this.complexToScreen(toRe, toIm);
        const dx = to.x - from.x, dy = to.y - from.y;
        const len = Math.hypot(dx, dy);
        if (len < 2) return;
        ctx.strokeStyle = color; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
        const hl = Math.min(12, len * 0.3), a = Math.atan2(dy, dx);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(to.x, to.y);
        ctx.lineTo(to.x - hl*Math.cos(a-0.3), to.y - hl*Math.sin(a-0.3));
        ctx.lineTo(to.x - hl*Math.cos(a+0.3), to.y - hl*Math.sin(a+0.3));
        ctx.closePath(); ctx.fill();
    },

    drawDashed(fromRe, fromIm, toRe, toIm, color) {
        const { ctx } = this;
        const from = this.complexToScreen(fromRe, fromIm);
        const to = this.complexToScreen(toRe, toIm);
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
    },

    drawAngleArc() {
        const { ctx } = this;
        const origin = this.complexToScreen(0, 0);
        const a1 = Math.atan2(this.z1.im, this.z1.re);
        const a2 = Math.atan2(this.z2.im, this.z2.re);
        const result = this.compute();
        const aR = Math.atan2(result.im, result.re);
        const arcR = 25;
        ctx.strokeStyle = 'rgba(91,141,206,0.4)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(origin.x, origin.y, arcR, 0, -a1, a1 > 0); ctx.stroke();
        ctx.strokeStyle = 'rgba(139,111,192,0.4)';
        ctx.beginPath(); ctx.arc(origin.x, origin.y, arcR+6, 0, -a2, a2 > 0); ctx.stroke();
        ctx.strokeStyle = 'rgba(77,158,126,0.6)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(origin.x, origin.y, arcR+12, 0, -aR, aR > 0); ctx.stroke();
        // Angle degree label
        ctx.font = '16px ' + CF.mono;
        ctx.fillStyle = 'rgba(91,141,206,0.6)'; ctx.textAlign = 'left';
        ctx.fillText(`${(a1*180/Math.PI).toFixed(0)}°`, origin.x + arcR + 2, origin.y - 2);
    },

    drawPointLabel(z, color, label) {
        const { ctx } = this;
        const pt = this.complexToScreen(z.re, z.im);
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2); ctx.fill();
        ctx.shadowColor = color; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = color;
        ctx.font = '18px ' + CF.sans; ctx.textAlign = 'left';
        ctx.fillText(label, pt.x + 8, pt.y - 8);
    },

    // ═══════════════════════════════════════════
    // Computation
    // ═══════════════════════════════════════════
    compute() {
        const { re: a, im: b } = this.z1;
        const { re: c, im: d } = this.z2;
        switch (this.operation) {
            case 'add': return { re: a+c, im: b+d };
            case 'sub': return { re: a-c, im: b-d };
            case 'mul': return { re: a*c-b*d, im: a*d+b*c };
            case 'div': {
                const den = c*c + d*d;
                if (den < 1e-12) return { re: NaN, im: NaN };
                return { re: (a*c+b*d)/den, im: (b*c-a*d)/den };
            }
            case 'pow': {
                const r = Math.hypot(a, b);
                if (r < 1e-12) return { re: 0, im: 0 };
                const theta = Math.atan2(b, a);
                const lnR = Math.log(r);
                const wRe = c*lnR - d*theta, wIm = d*lnR + c*theta;
                const eW = Math.exp(wRe);
                return { re: eW*Math.cos(wIm), im: eW*Math.sin(wIm) };
            }
            case 'euler': return { re: Math.cos(this.eulerTheta), im: Math.sin(this.eulerTheta) };
            default: return { re: 0, im: 0 };
        }
    },

    fmtComplex(z) {
        const re = z.re.toFixed(2);
        const im = Math.abs(z.im).toFixed(2);
        const sign = z.im >= 0 ? '+' : '−';
        return `${re} ${sign} ${im}i`;
    },

    fmtPolar(z) {
        const r = Math.hypot(z.re, z.im).toFixed(2);
        const theta = (Math.atan2(z.im, z.re) * 180 / Math.PI).toFixed(1);
        return `${r}∠${theta}°`;
    },

    // ═══════════════════════════════════════════
    // Presets & Euler animation
    // ═══════════════════════════════════════════
    loadPreset(name) {
        switch (name) {
            case 'unit-roots':
                this.z1 = { re: 1, im: 0 }; this.z2 = { re: -0.5, im: 0.866 };
                this.operation = 'mul'; break;
            case 'conjugate':
                this.z1 = { re: 3, im: 2 }; this.z2 = { re: 3, im: -2 };
                this.operation = 'mul'; break;
            case 'rotation':
                this.z1 = { re: 2, im: 1 }; this.z2 = { re: 0, im: 1 };
                this.operation = 'mul'; break;
            case 'inverse':
                this.z1 = { re: 1, im: 0 }; this.z2 = { re: 2, im: 1 };
                this.operation = 'div'; break;
        }
        this.syncInputs();
        document.querySelectorAll('.cx-op-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.op === this.operation));
        this.toggleEulerPanel();
        this.draw(); this.updateInfo();
    },

    animateEuler() {
        if (this.eulerAnimId) {
            cancelAnimationFrame(this.eulerAnimId); this.eulerAnimId = null;
            const btn = document.getElementById('cx-euler-anim');
            if (btn) btn.textContent = '旋转动画';
            return;
        }
        const btn = document.getElementById('cx-euler-anim');
        if (btn) btn.textContent = '停止';
        this.operation = 'euler';
        document.querySelectorAll('.cx-op-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.op === 'euler'));
        this.toggleEulerPanel();
        const t0 = performance.now();
        const loop = now => {
            this.eulerTheta = ((now - t0) / 3000 * 2 * Math.PI) % (2 * Math.PI);
            const slider = document.getElementById('cx-theta');
            if (slider) slider.value = this.eulerTheta;
            const valEl = document.getElementById('cx-theta-val');
            if (valEl) valEl.textContent = (this.eulerTheta * 180 / Math.PI).toFixed(0);
            this.draw(); this.updateInfo();
            this.eulerAnimId = requestAnimationFrame(loop);
        };
        this.eulerAnimId = requestAnimationFrame(loop);
    },

    // ═══════════════════════════════════════════
    // Info panel
    // ═══════════════════════════════════════════
    updateInfo() {
        const el = document.getElementById('cx-info');
        if (!el) return;
        if (this.mode === 'ops') this._updateOpsInfo(el);
        else if (this.mode === 'roots') this._updateRootsInfo(el);
        else this._updateDomainInfo(el);
    },

    _updateOpsInfo(el) {
        if (this.operation === 'euler') {
            const t = this.eulerTheta, deg = (t * 180 / Math.PI).toFixed(1);
            el.innerHTML = `
                <div class="cx-info-row"><span class="cx-label">θ</span><span>= ${t.toFixed(3)} rad (${deg}°)</span></div>
                <div class="cx-info-row"><span class="cx-label">e<sup>iθ</sup></span><span>= ${Math.cos(t).toFixed(4)} + ${Math.sin(t).toFixed(4)}i</span></div>
                <div class="cx-info-row"><span class="cx-label">cos θ</span><span>= ${Math.cos(t).toFixed(4)}</span></div>
                <div class="cx-info-row"><span class="cx-label">sin θ</span><span>= ${Math.sin(t).toFixed(4)}</span></div>
                <div class="cx-formula">e<sup>iθ</sup> = cos θ + i sin θ</div>`;
            return;
        }
        const result = this.compute();
        const opSym = {add:'+',sub:'−',mul:'×',div:'÷',pow:'^'}[this.operation] || '?';
        let html = `
            <div class="cx-info-row"><span class="cx-label">z₁</span><span>= ${this.fmtComplex(this.z1)} &nbsp;(${this.fmtPolar(this.z1)})</span></div>
            <div class="cx-info-row"><span class="cx-label">z₂</span><span>= ${this.fmtComplex(this.z2)} &nbsp;(${this.fmtPolar(this.z2)})</span></div>
            <div class="cx-info-row cx-result"><span class="cx-label">z₁ ${opSym} z₂</span><span>= ${isNaN(result.re)?'未定义':this.fmtComplex(result)} &nbsp;(${isNaN(result.re)?'—':this.fmtPolar(result)})</span></div>`;
        html += `<div class="cx-info-row"><span class="cx-label">|z₁|</span><span>= ${Math.hypot(this.z1.re,this.z1.im).toFixed(3)}</span></div>`;
        html += `<div class="cx-info-row"><span class="cx-label">|z₂|</span><span>= ${Math.hypot(this.z2.re,this.z2.im).toFixed(3)}</span></div>`;
        if (!isNaN(result.re))
            html += `<div class="cx-info-row"><span class="cx-label">|w|</span><span>= ${Math.hypot(result.re,result.im).toFixed(3)}</span></div>`;
        if (this.operation === 'mul')
            html += `<div class="cx-formula">|z₁·z₂| = |z₁|·|z₂|, arg(z₁·z₂) = arg(z₁) + arg(z₂)</div>`;
        else if (this.operation === 'div')
            html += `<div class="cx-formula">|z₁/z₂| = |z₁|/|z₂|, arg(z₁/z₂) = arg(z₁) − arg(z₂)</div>`;
        else if (this.operation === 'pow')
            html += `<div class="cx-formula">z₁^z₂ = exp(z₂ · ln z₁) = exp(z₂ · (ln|z₁| + i·arg(z₁)))</div>`;
        el.innerHTML = html;
    },

    _updateRootsInfo(el) {
        const n = this.rootN;
        let html = `<div class="cx-info-row"><span class="cx-label">方程</span><span>z<sup>${n}</sup> = 1 的 ${n} 个根</span></div>`;
        html += `<div class="cx-info-row"><span class="cx-label">通式</span><span>z<sub>k</sub> = e<sup>i·2πk/${n}</sup>, k = 0,1,…,${n-1}</span></div>`;
        html += `<div class="cx-info-row"><span class="cx-label">旋转角</span><span>= 360°/${n} = ${(360/n).toFixed(1)}°</span></div>`;
        const max = Math.min(n, 6);
        for (let k = 0; k < max; k++) {
            const a = 2 * Math.PI * k / n;
            html += `<div class="cx-info-row"><span class="cx-label">ω${this._sup(k)}</span><span>= ${Math.cos(a).toFixed(3)} + ${Math.sin(a).toFixed(3)}i</span></div>`;
        }
        if (n > max) html += `<div class="cx-info-row" style="color:rgba(255,255,255,0.4)"><span>…共 ${n} 个根</span></div>`;
        html += `<div class="cx-formula">单位根构成正 ${n} 边形，乘以 ω 等价于旋转 ${(360/n).toFixed(1)}°</div>`;
        el.innerHTML = html;
    },

    _updateDomainInfo(el) {
        const names = {z2:'z²',z3:'z³',inv:'1/z',exp:'eᶻ',sin:'sin(z)',z3m1:'z³−1'};
        const fn = names[this.domainFunc] || this.domainFunc;
        let html = `<div class="cx-info-row"><span class="cx-label">函数</span><span>f(z) = ${fn}</span></div>`;
        html += `<div class="cx-info-row"><span class="cx-label">色相</span><span>= arg(f(z)) — 辐角映射为颜色</span></div>`;
        html += `<div class="cx-info-row"><span class="cx-label">亮度</span><span>= log|f(z)| — 等模线（明暗环）</span></div>`;
        html += `<div class="cx-info-row"><span class="cx-label">视野</span><span>±${this.viewRange.toFixed(1)} (滚轮缩放)</span></div>`;
        const descs = {
            z2: '二次映射：角度加倍，模长平方。零点在原点（二阶）。',
            z3: '三次映射：角度三倍，模长立方。零点在原点（三阶）。',
            inv: '取逆：|w| = 1/|z|，arg(w) = −arg(z)。原点处有一阶极点。',
            exp: '指数映射：将水平线映射为射线，竖直线映射为圆。无零点，无极点。',
            sin: '正弦函数的复数推广：零点在 nπ (n∈ℤ)。',
            z3m1: '零点为三个三次单位根 1, ω, ω²，均匀分布在单位圆上。'
        };
        html += `<div class="cx-formula">${descs[this.domainFunc] || ''}</div>`;
        el.innerHTML = html;
    }
};

function initComplexVis() {
    ComplexVis.init();
}
