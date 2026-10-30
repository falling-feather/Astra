// ===== Spatial Vectors (3D) =====
// 空间向量：3D 视角可拖拽，演示加法/数量积/向量积/夹角/投影
// 人教版选择性必修一第1章：空间向量与立体几何

const SpatialVec = {
    canvas: null, ctx: null, W: 0, H: 0,
    _listeners: [],
    _resizeObs: null,

    a: { x: 3, y: 1, z: 2 },
    b: { x: 1, y: 3, z: 1 },
    range: 5,
    yaw: -0.6, pitch: 0.5,
    showSum: true, showCross: false, showProj: false,
    autoRotate: false,
    _raf: 0,
    _drag: null,

    _on(el, evt, fn, opts) { el.addEventListener(evt, fn, opts); this._listeners.push({ el, evt, fn, opts }); },

    /* ── lifecycle ── */
    init() {
        this.canvas = document.getElementById('sv-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this._buildControls();
        this.resize();
        this._bindEvents();
        this.draw();
        this.updateInfo();
    },

    destroy() {
        this.stopAuto();
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
        this.H = Math.min(Math.max(rect.width * 0.6, 340), 480);
        if (this.W <= 0 || this.H <= 0) return;
        this.canvas.width = this.W * dpr;
        this.canvas.height = this.H * dpr;
        this.canvas.style.width = this.W + 'px';
        this.canvas.style.height = this.H + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.draw();
    },

    /* ── 3D → 2D projection ── */
    _scale() { return Math.min(this.W, this.H) / (2 * this.range * 1.5); },
    project(p) {
        const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
        const x1 = p.x * cy - p.y * sy;
        const y1 = p.x * sy + p.y * cy;
        const z1 = p.z;
        const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
        const y2 = y1 * cp - z1 * sp;
        const z2 = y1 * sp + z1 * cp;
        const s = this._scale();
        return { sx: this.W / 2 + x1 * s, sy: this.H / 2 + 14 - z2 * s, depth: y2 };
    },

    /* ── vector ops ── */
    _dot(u, v) { return u.x * v.x + u.y * v.y + u.z * v.z; },
    _cross(u, v) { return { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x }; },
    _mag(u) { return Math.sqrt(this._dot(u, u)); },

    /* ── controls ── */
    _buildControls() {
        const ctrl = document.getElementById('sv-controls');
        if (!ctrl) return;
        const comp = (vec, axis, label, color) =>
            `<div class="sv-comp"><label style="color:${color}">${label}</label><input type="range" id="sv-${vec}${axis}" min="-5" max="5" step="1" value="${this[vec][axis]}" class="sv-slider"><span id="sv-${vec}${axis}-val">${this[vec][axis]}</span></div>`;
        ctrl.innerHTML = `
            <div class="sv-vec-group">
                <div class="sv-vec-title sv-a">向量 a</div>
                ${comp('a', 'x', 'x', '#5b9bd5')}${comp('a', 'y', 'y', '#5b9bd5')}${comp('a', 'z', 'z', '#5b9bd5')}
            </div>
            <div class="sv-vec-group">
                <div class="sv-vec-title sv-b">向量 b</div>
                ${comp('b', 'x', 'x', '#e06c75')}${comp('b', 'y', 'y', '#e06c75')}${comp('b', 'z', 'z', '#e06c75')}
            </div>
            <div class="sv-toggles">
                <label class="sv-toggle"><input type="checkbox" id="sv-chk-sum" ${this.showSum ? 'checked' : ''}>a + b（平行四边形）</label>
                <label class="sv-toggle"><input type="checkbox" id="sv-chk-cross" ${this.showCross ? 'checked' : ''}>a × b（向量积）</label>
                <label class="sv-toggle"><input type="checkbox" id="sv-chk-proj" ${this.showProj ? 'checked' : ''}>a 在 b 上的投影</label>
                <label class="sv-toggle"><input type="checkbox" id="sv-chk-auto" ${this.autoRotate ? 'checked' : ''}>自动旋转</label>
            </div>
            <div class="sv-hint">🖱 在画布上拖拽可旋转 3D 视角</div>
        `;
    },

    _bindEvents() {
        ['a', 'b'].forEach(v => ['x', 'y', 'z'].forEach(ax => {
            const el = document.getElementById(`sv-${v}${ax}`);
            const vEl = document.getElementById(`sv-${v}${ax}-val`);
            if (el) this._on(el, 'input', () => {
                this[v][ax] = parseInt(el.value, 10);
                if (vEl) vEl.textContent = this[v][ax];
                this.draw(); this.updateInfo();
            });
        }));
        const chk = (id, prop, after) => {
            const el = document.getElementById(id);
            if (el) this._on(el, 'change', () => { this[prop] = el.checked; if (after) after(); this.draw(); this.updateInfo(); });
        };
        chk('sv-chk-sum', 'showSum');
        chk('sv-chk-cross', 'showCross');
        chk('sv-chk-proj', 'showProj');
        chk('sv-chk-auto', 'autoRotate', () => { if (this.autoRotate) this.startAuto(); else this.stopAuto(); });

        // drag to rotate
        this._on(this.canvas, 'pointerdown', (e) => {
            this._drag = { x: e.clientX, y: e.clientY };
            this.canvas.setPointerCapture(e.pointerId);
        });
        this._on(this.canvas, 'pointermove', (e) => {
            if (!this._drag) return;
            const dx = e.clientX - this._drag.x, dy = e.clientY - this._drag.y;
            this._drag = { x: e.clientX, y: e.clientY };
            this.yaw += dx * 0.01;
            this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + dy * 0.01));
            this.draw();
        });
        const end = () => { this._drag = null; };
        this._on(this.canvas, 'pointerup', end);
        this._on(this.canvas, 'pointercancel', end);

        const wrap = this.canvas.parentElement;
        if (wrap && window.ResizeObserver) {
            this._resizeObs = new ResizeObserver(() => this.resize());
            this._resizeObs.observe(wrap);
        }
        if (this.autoRotate) this.startAuto();
    },

    startAuto() {
        this.stopAuto();
        const step = () => {
            this.yaw += 0.006;
            this.draw();
            this._raf = requestAnimationFrame(step);
        };
        this._raf = requestAnimationFrame(step);
    },
    stopAuto() { cancelAnimationFrame(this._raf); this._raf = 0; },

    /* ══════════════════════════════════════════ drawing ══════════════════════════════════════════ */
    draw() {
        const { ctx, W, H } = this;
        if (!ctx) return;
        ctx.clearRect(0, 0, W, H);
        this._drawGrid();
        this._drawAxes();

        const O = { x: 0, y: 0, z: 0 };
        // sum parallelogram
        if (this.showSum) {
            const sum = { x: this.a.x + this.b.x, y: this.a.y + this.b.y, z: this.a.z + this.b.z };
            this._drawPolyline([this.a, sum], 'rgba(120,200,140,0.5)', true);
            this._drawPolyline([this.b, sum], 'rgba(120,200,140,0.5)', true);
            this._arrow3(O, sum, '#78c88c', 'a+b');
        }
        // projection of a onto b
        if (this.showProj) {
            const bb = this._dot(this.b, this.b);
            if (bb > 1e-9) {
                const t = this._dot(this.a, this.b) / bb;
                const proj = { x: this.b.x * t, y: this.b.y * t, z: this.b.z * t };
                this._drawPolyline([this.a, proj], 'rgba(229,192,123,0.6)', true);
                this._arrow3(O, proj, '#e5c07b', 'projᵦa');
            }
        }
        // cross product
        if (this.showCross) {
            const c = this._cross(this.a, this.b);
            this._arrow3(O, c, '#b48ce6', 'a×b');
        }
        // main vectors
        this._arrow3(O, this.a, '#5b9bd5', 'a');
        this._arrow3(O, this.b, '#e06c75', 'b');
    },

    _drawGrid() {
        const { ctx } = this;
        const R = this.range;
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        for (let i = -R; i <= R; i++) {
            const p1 = this.project({ x: i, y: -R, z: 0 }), p2 = this.project({ x: i, y: R, z: 0 });
            const p3 = this.project({ x: -R, y: i, z: 0 }), p4 = this.project({ x: R, y: i, z: 0 });
            ctx.beginPath(); ctx.moveTo(p1.sx, p1.sy); ctx.lineTo(p2.sx, p2.sy); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(p3.sx, p3.sy); ctx.lineTo(p4.sx, p4.sy); ctx.stroke();
        }
    },

    _drawAxes() {
        const { ctx } = this;
        const R = this.range;
        const axes = [
            { v: { x: R, y: 0, z: 0 }, c: 'rgba(255,120,120,0.6)', n: 'x' },
            { v: { x: 0, y: R, z: 0 }, c: 'rgba(120,255,120,0.6)', n: 'y' },
            { v: { x: 0, y: 0, z: R }, c: 'rgba(120,160,255,0.6)', n: 'z' },
        ];
        const O = this.project({ x: 0, y: 0, z: 0 });
        ctx.font = '13px ' + CF.sans;
        axes.forEach(ax => {
            const neg = this.project({ x: -ax.v.x, y: -ax.v.y, z: -ax.v.z });
            const pos = this.project(ax.v);
            ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(neg.sx, neg.sy); ctx.lineTo(O.sx, O.sy); ctx.stroke();
            ctx.strokeStyle = ax.c; ctx.lineWidth = 1.4;
            ctx.beginPath(); ctx.moveTo(O.sx, O.sy); ctx.lineTo(pos.sx, pos.sy); ctx.stroke();
            ctx.fillStyle = ax.c; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(ax.n, pos.sx + (pos.sx - O.sx) * 0.06, pos.sy + (pos.sy - O.sy) * 0.06);
        });
    },

    _drawPolyline(pts3, color, dashed) {
        const { ctx } = this;
        ctx.strokeStyle = color; ctx.lineWidth = 1.3;
        if (dashed) ctx.setLineDash([5, 4]);
        ctx.beginPath();
        pts3.forEach((p, i) => { const s = this.project(p); if (i === 0) ctx.moveTo(s.sx, s.sy); else ctx.lineTo(s.sx, s.sy); });
        ctx.stroke();
        if (dashed) ctx.setLineDash([]);
    },

    _arrow3(from3, to3, color, label) {
        const { ctx } = this;
        const f = this.project(from3), t = this.project(to3);
        ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(f.sx, f.sy); ctx.lineTo(t.sx, t.sy); ctx.stroke();
        const ang = Math.atan2(t.sy - f.sy, t.sx - f.sx);
        const ah = 9;
        ctx.beginPath();
        ctx.moveTo(t.sx, t.sy);
        ctx.lineTo(t.sx - ah * Math.cos(ang - 0.4), t.sy - ah * Math.sin(ang - 0.4));
        ctx.lineTo(t.sx - ah * Math.cos(ang + 0.4), t.sy - ah * Math.sin(ang + 0.4));
        ctx.closePath(); ctx.fill();
        if (label) {
            ctx.font = 'bold 13px ' + CF.sans;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(label, t.sx + (t.sx - f.sx) * 0.08 + 6, t.sy + (t.sy - f.sy) * 0.08 - 6);
        }
    },

    /* ── info / edu ── */
    updateInfo() {
        const el = document.getElementById('sv-info');
        if (!el) return;
        const a = this.a, b = this.b;
        const dot = this._dot(a, b);
        const ma = this._mag(a), mb = this._mag(b);
        const cross = this._cross(a, b);
        const mc = this._mag(cross);
        const cosT = (ma && mb) ? dot / (ma * mb) : 0;
        const ang = Math.acos(Math.max(-1, Math.min(1, cosT))) * 180 / Math.PI;
        const f = n => (Math.round(n * 100) / 100);
        const vstr = v => `(${v.x}, ${v.y}, ${v.z})`;
        const perp = Math.abs(dot) < 1e-9 ? '（a⊥b，互相垂直）' : '';
        return el.innerHTML = `
            <div class="sv-info-title">空间向量运算</div>
            <div class="sv-info-subtitle">a = ${vstr(a)}　b = ${vstr(b)}</div>
            <div class="math-row"><span class="math-key">模长 |a|</span>√${f(this._dot(a, a))} = ${f(ma)}</div>
            <div class="math-row"><span class="math-key">模长 |b|</span>√${f(this._dot(b, b))} = ${f(mb)}</div>
            <div class="math-row"><span class="math-key--amber">数量积 a·b</span>${a.x}×${b.x} + ${a.y}×${b.y} + ${a.z}×${b.z} = ${dot} ${perp}</div>
            <div class="math-row"><span class="math-key">夹角 θ</span>cosθ = ${f(cosT)} → θ ≈ ${f(ang)}°</div>
            <div class="math-row"><span class="math-key--amber">向量积 a×b</span>(${cross.x}, ${cross.y}, ${cross.z})，|a×b| = ${f(mc)}</div>
            <div class="math-row"><span class="math-key">a×b 几何意义</span>垂直于 a、b，模长 = 以 a,b 为邻边的平行四边形面积</div>
            <div class="sv-edu">
                <div class="math-hd"><span class="math-tag">空间向量</span>核心公式</div>
                <div class="math-row"><span class="math-key">数量积</span>a·b = a₁b₁+a₂b₂+a₃b₃ = |a||b|cosθ</div>
                <div class="math-row"><span class="math-key--amber">垂直判定</span>a⊥b ⇔ a·b = 0</div>
                <div class="math-row"><span class="math-key">夹角</span>cosθ = a·b / (|a|·|b|)</div>
                <div class="math-row"><span class="math-key">向量积</span>a×b = (a₂b₃−a₃b₂, a₃b₁−a₁b₃, a₁b₂−a₂b₁)，方向遵循右手定则</div>
                <div class="math-row"><span class="math-key">投影</span>a 在 b 上的投影向量 = (a·b / |b|²)·b</div>
                <div class="math-note">💡 拖拽画布旋转视角观察三维结构；勾选「a×b」可见其始终垂直于 a、b 所在平面（右手定则）。</div>
            </div>
        `;
    }
};

function initSpatialVec() { SpatialVec.init(); }
window.initSpatialVec = initSpatialVec;
