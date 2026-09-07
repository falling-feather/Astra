// ===== 力的合成与分解 =====
// 3 模式: 平行四边形合成 · 正交分解 · 斜面受力分析
// 人教版必修一 第3章

const ForceComposition = {
    canvas: null, ctx: null, W: 0, H: 0,
    mode: 'composition', // 'composition' | 'decomposition' | 'incline'
    _listeners: [],
    _resizeObs: null,

    // ── 力的合成（v4.6.0-α1：升级为多力合成，2-6 个力） ──
    // 颜色调色板（按 force 索引取色）
    _forceColors: ['#e74c3c', '#3498db', '#9b59b6', '#e67e22', '#1abc9c', '#f1c40f'],
    _forceLabels: ['F₁', 'F₂', 'F₃', 'F₄', 'F₅', 'F₆'],
    forces: [
        { mag: 100, angle: 30 },
        { mag: 80, angle: 120 },
        { mag: 60, angle: 220 }
    ],
    compMethod: 'polygon',          // 'parallelogram'（仅 2 力可用）| 'polygon'（首尾相接，任意力数）
    _dragForceIdx: -1,              // 当前拖拽的 force 索引；-1 表示无

    // ── 正交分解 ──
    fd: { mag: 120, angle: 50 },
    _dragDecomp: false,

    // ── 斜面分析 ──
    incAngle: 30,       // 斜面倾角 (°)
    mass: 5,            // kg
    mu: 0.3,            // 摩擦系数 μ
    g: 9.8,

    // ── 通用 ──
    origin: { x: 0, y: 0 },
    scale: 1.5,
    _mouse: { x: 0, y: 0, down: false },

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        this.canvas = document.getElementById('fc-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this._resize();
        this._buildControls();
        this._bindMouse();
        this._injectEduPanel();

        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver(() => { this._resize(); this.draw(); });
            this._resizeObs.observe(this.canvas.parentElement);
        }
        this.draw();
    },

    destroy() {
        for (const l of this._listeners) l.el.removeEventListener(l.evt, l.fn, l.opts);
        this._listeners = [];
        if (this._resizeObs) { this._resizeObs.disconnect(); this._resizeObs = null; }
        const ctrl = document.getElementById('fc-controls');
        if (ctrl) ctrl.innerHTML = '';
        const info = document.getElementById('fc-info');
        if (info) info.innerHTML = '';
        const edu = document.getElementById('fc-edu');
        if (edu) edu.innerHTML = '';
    },

    /* ══════════════════ 尺寸 ══════════════════ */
    _resize() {
        if (window.PhysicsZoom && window.PhysicsZoom.movedCanvas === this.canvas) return;
        const wrap = this.canvas.parentElement;
        if (!wrap) return;
        const w = wrap.clientWidth;
        if (w === 0) return;
        const h = Math.min(w * 0.6, 500);
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w; this.H = h;
        this.scale = Math.min(w, h) / 180;
        this._updateOrigin();
    },

    _updateOrigin() {
        if (this.mode === 'incline') {
            this.origin = { x: this.W * 0.12, y: this.H * 0.82 };
        } else {
            this.origin = { x: this.W * 0.35, y: this.H * 0.55 };
        }
    },

    /* ══════════════════ 控件 ══════════════════ */
    _buildControls() {
        const ctrl = document.getElementById('fc-controls');
        if (!ctrl) return;
        ctrl.innerHTML = '';

        // 模式按钮
        const modes = [
            { id: 'composition', label: '力的合成', icon: '⊕' },
            { id: 'decomposition', label: '正交分解', icon: '⊗' },
            { id: 'incline', label: '斜面分析', icon: '△' }
        ];
        const btnRow = document.createElement('div');
        btnRow.className = 'fc-mode-btns';
        btnRow.setAttribute('role', 'group');
        btnRow.setAttribute('aria-label', '模式选择');
        this._modeBtns = [];
        modes.forEach(m => {
            const b = document.createElement('button');
            b.className = 'fc-mode-btn' + (m.id === this.mode ? ' active' : '');
            b.textContent = m.icon + ' ' + m.label;
            b.setAttribute('aria-pressed', m.id === this.mode);
            this._on(b, 'click', () => this._setMode(m.id));
            btnRow.appendChild(b);
            this._modeBtns.push({ id: m.id, el: b });
        });
        ctrl.appendChild(btnRow);

        // 参数面板（各模式不同）
        this._paramWrap = document.createElement('div');
        this._paramWrap.className = 'fc-params';
        ctrl.appendChild(this._paramWrap);
        this._rebuildParams();
    },

    _setMode(m) {
        this.mode = m;
        this._modeBtns.forEach(b => {
            b.el.classList.toggle('active', b.id === m);
            b.el.setAttribute('aria-pressed', b.id === m);
        });
        this._updateOrigin();
        this._rebuildParams();
        this.draw();
        this._updateInfo();
        this._injectEduPanel();
    },

    _rebuildParams() {
        const wrap = this._paramWrap;
        if (!wrap) return;
        wrap.innerHTML = '';

        if (this.mode === 'composition') {
            // v4.6.0-α1：多力合成 — 顶部行：➕ ➖ 力数量 + 法则切换；下方：每个力一行；末尾：合力
            const n = this.forces.length;
            const canPara = (n === 2);
            const isPara = (this.compMethod === 'parallelogram' && canPara);
            let html = `
                <div class="fc-hint">拖拽端点改大小/方向，🖋 ➕➖ 增减力的个数（2~6），切换合成法则</div>
                <div class="fc-multiforce-toolbar">
                    <button id="fc-add-force" class="fc-mini-btn" title="添加一个力" ${n >= 6 ? 'disabled' : ''}>➕ 添加力</button>
                    <button id="fc-rm-force"  class="fc-mini-btn" title="删除最后一个力" ${n <= 2 ? 'disabled' : ''}>➖ 删除力</button>
                    <span class="fc-force-count">当前力数：<b>${n}</b></span>
                    <span class="fc-method-sep">|</span>
                    <button id="fc-method-poly" class="fc-mini-btn ${isPara ? '' : 'active'}" title="首尾相接：F₁→F₂→…→Fn 顺次相接，合力 = 起点→终点">⛓ 多边形法</button>
                    <button id="fc-method-para" class="fc-mini-btn ${isPara ? 'active' : ''}" title="平行四边形定则（仅 2 个力时可用）" ${canPara ? '' : 'disabled'}>▱ 平行四边形</button>
                </div>`;
            this.forces.forEach((f, i) => {
                const c = this._forceColors[i];
                const lab = this._forceLabels[i];
                html += `
                <div class="fc-row fc-force-row">
                    <span class="fc-color-dot" style="background:${c}"></span>
                    <span class="fc-label" style="color:${c}">${lab} = <b id="fc-fi-mag-${i}">${f.mag.toFixed(0)}</b> N，θ = <b id="fc-fi-ang-${i}">${f.angle.toFixed(0)}</b>°</span>
                </div>`;
            });
            html += `
                <div class="fc-row" style="margin-top:.4rem;border-top:1px dashed rgba(255,255,255,.15);padding-top:.4rem">
                    <span class="fc-label" style="color:#2ecc71">合力 R = <b id="fc-r-mag">0</b> N，θ = <b id="fc-r-ang">0</b>°</span>
                </div>`;
            wrap.innerHTML = html;
            // 事件绑定
            const addBtn = wrap.querySelector('#fc-add-force');
            const rmBtn  = wrap.querySelector('#fc-rm-force');
            const polyBtn = wrap.querySelector('#fc-method-poly');
            const paraBtn = wrap.querySelector('#fc-method-para');
            if (addBtn) this._on(addBtn, 'click', () => this._addForce());
            if (rmBtn)  this._on(rmBtn, 'click', () => this._removeForce());
            if (polyBtn) this._on(polyBtn, 'click', () => this._setCompMethod('polygon'));
            if (paraBtn && !paraBtn.disabled) this._on(paraBtn, 'click', () => this._setCompMethod('parallelogram'));
        } else if (this.mode === 'decomposition') {
            wrap.innerHTML = `
                <div class="fc-hint">拖拽箭头端点改变力的大小和方向</div>
                <div class="fc-row">
                    <span class="fc-label" style="color:#e67e22">F = <b id="fc-fd-mag">${this.fd.mag.toFixed(0)}</b> N，θ = <b id="fc-fd-ang">${this.fd.angle.toFixed(0)}</b>°</span>
                </div>
                <div class="fc-row">
                    <span class="fc-label" style="color:#e74c3c">Fx = F·cosθ = <b id="fc-fx">0</b> N</span>
                </div>
                <div class="fc-row">
                    <span class="fc-label" style="color:#3498db">Fy = F·sinθ = <b id="fc-fy">0</b> N</span>
                </div>`;
        } else {
            // 斜面
            wrap.innerHTML = `
                <div class="fc-slider-row">
                    <label>斜面角 α = <b id="fc-inc-val">${this.incAngle}</b>°</label>
                    <input type="range" id="fc-inc-slider" min="5" max="75" step="1" value="${this.incAngle}">
                </div>
                <div class="fc-slider-row">
                    <label>质量 m = <b id="fc-mass-val">${this.mass}</b> kg</label>
                    <input type="range" id="fc-mass-slider" min="1" max="20" step="0.5" value="${this.mass}">
                </div>
                <div class="fc-slider-row">
                    <label>摩擦系数 μ = <b id="fc-mu-val">${this.mu.toFixed(2)}</b></label>
                    <input type="range" id="fc-mu-slider" min="0" max="1" step="0.05" value="${this.mu}">
                </div>
                <div class="fc-row">
                    <span class="fc-label">重力 mg = <b id="fc-mg">0</b> N</span>
                </div>
                <div class="fc-row">
                    <span class="fc-label" style="color:#2ecc71">支持力 N = mg·cosα = <b id="fc-N">0</b> N</span>
                </div>
                <div class="fc-row">
                    <span class="fc-label" style="color:#e74c3c">沿斜面分力 = mg·sinα = <b id="fc-para">0</b> N</span>
                </div>
                <div class="fc-row">
                    <span class="fc-label" style="color:#9b59b6">摩擦力 f = μN = <b id="fc-fric">0</b> N</span>
                </div>`;
            const incSlider = wrap.querySelector('#fc-inc-slider');
            const massSlider = wrap.querySelector('#fc-mass-slider');
            const muSlider = wrap.querySelector('#fc-mu-slider');
            if (incSlider) this._on(incSlider, 'input', () => {
                this.incAngle = +incSlider.value;
                wrap.querySelector('#fc-inc-val').textContent = this.incAngle;
                this.draw(); this._updateInfo();
            });
            if (massSlider) this._on(massSlider, 'input', () => {
                this.mass = +massSlider.value;
                wrap.querySelector('#fc-mass-val').textContent = this.mass;
                this.draw(); this._updateInfo();
            });
            if (muSlider) this._on(muSlider, 'input', () => {
                this.mu = +muSlider.value;
                wrap.querySelector('#fc-mu-val').textContent = this.mu.toFixed(2);
                this.draw(); this._updateInfo();
            });
        }
        this._updateInfo();
    },

    /* ══════════════════ 鼠标交互 ══════════════════ */
    _bindMouse() {
        const getPos = (e) => {
            const r = this.canvas.getBoundingClientRect();
            const t = e.touches ? e.touches[0] || e.changedTouches[0] : e;
            return { x: t.clientX - r.left, y: t.clientY - r.top };
        };

        const onDown = (e) => {
            e.preventDefault();
            const p = getPos(e);
            this._mouse = { ...p, down: true };

            if (this.mode === 'composition') {
                // v4.6.0-α1：遍历所有 force，找最近的端点
                this._dragForceIdx = -1;
                let best = 19;
                this.forces.forEach((f, i) => {
                    const tip = this._forceTip(f);
                    const d = this._dist(p, tip);
                    if (d < best) { best = d; this._dragForceIdx = i; }
                });
            } else if (this.mode === 'decomposition') {
                const tip = this._forceTip(this.fd);
                this._dragDecomp = this._dist(p, tip) < 18;
            }
        };

        const onMove = (e) => {
            if (!this._mouse.down) {
                // Hover cursor
                const p = getPos(e);
                if (this.mode === 'composition') {
                    let near = false;
                    for (const f of this.forces) {
                        if (this._dist(p, this._forceTip(f)) < 18) { near = true; break; }
                    }
                    this.canvas.style.cursor = near ? 'grab' : 'default';
                } else if (this.mode === 'decomposition') {
                    const t = this._forceTip(this.fd);
                    this.canvas.style.cursor = this._dist(p, t) < 18 ? 'grab' : 'default';
                }
                return;
            }
            e.preventDefault();
            const p = getPos(e);
            const ox = this.origin.x, oy = this.origin.y;

            if (this.mode === 'composition' && this._dragForceIdx >= 0) {
                const dx = p.x - ox, dy = oy - p.y;
                const mag = Math.max(10, Math.sqrt(dx * dx + dy * dy) / this.scale);
                const angle = Math.atan2(dy, dx) * 180 / Math.PI;
                this.forces[this._dragForceIdx].mag = mag;
                this.forces[this._dragForceIdx].angle = angle;
                this.draw(); this._updateInfo();
            } else if (this.mode === 'decomposition' && this._dragDecomp) {
                const dx = p.x - ox, dy = oy - p.y;
                this.fd.mag = Math.max(10, Math.sqrt(dx * dx + dy * dy) / this.scale);
                this.fd.angle = Math.atan2(dy, dx) * 180 / Math.PI;
                this.draw(); this._updateInfo();
            }
        };

        const onUp = () => {
            this._mouse.down = false;
            this._dragForceIdx = -1;
            this._dragDecomp = false;
            this.canvas.style.cursor = 'default';
        };

        this._on(this.canvas, 'mousedown', onDown);
        this._on(this.canvas, 'mousemove', onMove);
        this._on(window, 'mouseup', onUp);
        this._on(this.canvas, 'touchstart', onDown, { passive: false });
        this._on(this.canvas, 'touchmove', onMove, { passive: false });
        this._on(window, 'touchend', onUp);
    },

    _forceTip(f) {
        const rad = f.angle * Math.PI / 180;
        return {
            x: this.origin.x + Math.cos(rad) * f.mag * this.scale,
            y: this.origin.y - Math.sin(rad) * f.mag * this.scale
        };
    },

    _dist(a, b) {
        const dx = a.x - b.x, dy = a.y - b.y;
        return Math.sqrt(dx * dx + dy * dy);
    },

    /* ══════════════════ 绘制 ══════════════════ */
    draw() {
        const { ctx, W, H } = this;
        if (!ctx) return;
        ctx.clearRect(0, 0, W, H);
        this._drawGrid();

        if (this.mode === 'composition') this._drawComposition();
        else if (this.mode === 'decomposition') this._drawDecomposition();
        else this._drawIncline();
    },

    _drawGrid() {
        const { ctx, W, H } = this;
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 0.5;
        const step = 40;
        for (let x = 0; x < W; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
        for (let y = 0; y < H; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
        ctx.restore();
    },

    _drawAxes(ox, oy, labelX, labelY) {
        const { ctx, W, H } = this;
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1;
        // X axis
        ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(W, oy); ctx.stroke();
        // Y axis
        ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox, H); ctx.stroke();
        // Labels
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '13px ' + CF.sans;
        ctx.textAlign = 'left';
        if (labelX) ctx.fillText(labelX, W - 20, oy - 6);
        ctx.textAlign = 'center';
        if (labelY) ctx.fillText(labelY, ox + 12, 16);
        ctx.restore();
    },

    /* ── 力的合成（v4.6.0-α1：多力，多边形/平行四边形两种法则） ── */
    _drawComposition() {
        const { ctx, origin, scale, forces, compMethod } = this;
        const ox = origin.x, oy = origin.y;
        this._drawAxes(ox, oy, 'x', 'y');

        // 累计每个 force 的 (fx, fy)
        const proj = forces.map(f => {
            const r = f.angle * Math.PI / 180;
            return { fx: Math.cos(r) * f.mag * scale, fy: -Math.sin(r) * f.mag * scale, rad: r };
        });

        const usePara = (compMethod === 'parallelogram' && forces.length === 2);

        if (usePara) {
            // 平行四边形辅助线
            const f1x = proj[0].fx, f1y = proj[0].fy;
            const f2x = proj[1].fx, f2y = proj[1].fy;
            ctx.save();
            ctx.setLineDash([6, 4]);
            ctx.strokeStyle = 'rgba(255,255,255,0.22)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(ox + f1x, oy + f1y);
            ctx.lineTo(ox + f1x + f2x, oy + f1y + f2y);
            ctx.lineTo(ox + f2x, oy + f2y);
            ctx.stroke();
            ctx.restore();
            // 平行四边形填充
            ctx.save();
            ctx.fillStyle = 'rgba(46,204,113,0.06)';
            ctx.beginPath();
            ctx.moveTo(ox, oy);
            ctx.lineTo(ox + f1x, oy + f1y);
            ctx.lineTo(ox + f1x + f2x, oy + f1y + f2y);
            ctx.lineTo(ox + f2x, oy + f2y);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        } else {
            // 多边形法（首尾相接）— 半透明灰色辅助链
            ctx.save();
            ctx.setLineDash([5, 4]);
            ctx.strokeStyle = 'rgba(255,255,255,0.18)';
            ctx.lineWidth = 1.2;
            let cx = ox, cy = oy;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            for (let i = 0; i < proj.length; i++) {
                cx += proj[i].fx;
                cy += proj[i].fy;
                ctx.lineTo(cx, cy);
            }
            ctx.stroke();
            ctx.restore();
            // 在每个虚线节点画小圆点
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            cx = ox; cy = oy;
            for (let i = 0; i < proj.length - 1; i++) {
                cx += proj[i].fx;
                cy += proj[i].fy;
                ctx.beginPath();
                ctx.arc(cx, cy, 3, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }

        // 画每个分力（从原点出发）+ 拖拽端点
        forces.forEach((f, i) => {
            const c = this._forceColors[i];
            const lab = this._forceLabels[i];
            const fx = proj[i].fx, fy = proj[i].fy;
            this._drawArrow(ox, oy, ox + fx, oy + fy, c, 2.5);
            this._drawLabel(ox + fx * 0.55 + 8, oy + fy * 0.55 - 10, lab, c);
            this._drawHandle(ox + fx, oy + fy, c);
            // 角度弧（仅前 4 个，避免重叠）
            if (i < 4) this._drawAngleArc(ox, oy, 0, proj[i].rad, 30 + i * 8, c);
        });

        // 合力 R = Σ(fx, fy)
        let rx = 0, ry = 0;
        for (const p of proj) { rx += p.fx; ry += p.fy; }
        if (Math.hypot(rx, ry) > 1) {
            this._drawArrow(ox, oy, ox + rx, oy + ry, '#2ecc71', 3.8);
            this._drawLabel(ox + rx * 0.55 + 14, oy + ry * 0.55 + 4, 'R', '#2ecc71');
        } else {
            // 合力近 0：在原点画一个绿色平衡环
            ctx.save();
            ctx.strokeStyle = '#2ecc71';
            ctx.globalAlpha = 0.7;
            ctx.lineWidth = 2;
            ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.arc(ox, oy, 14, 0, Math.PI * 2); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#2ecc71';
            ctx.font = 'bold 12px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.fillText('R ≈ 0  平衡', ox, oy + 30);
            ctx.restore();
        }

        // 右上角法则提示
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '12px ' + CF.sans;
        ctx.textAlign = 'right';
        const methodTxt = usePara ? '▱ 平行四边形定则' : ('⛓ 多边形法（' + forces.length + ' 个力首尾相接）');
        ctx.fillText(methodTxt, this.W - 10, 18);
        ctx.restore();
    },

    /* ── 正交分解 ── */
    _drawDecomposition() {
        const { ctx, origin, scale, fd } = this;
        const ox = origin.x, oy = origin.y;
        this._drawAxes(ox, oy, 'x', 'y');

        const rad = fd.angle * Math.PI / 180;
        const fx = Math.cos(rad) * fd.mag * scale;
        const fy = -Math.sin(rad) * fd.mag * scale;

        // 投影虚线
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1;
        // 垂直投影线 (F端→x轴)
        ctx.beginPath(); ctx.moveTo(ox + fx, oy + fy); ctx.lineTo(ox + fx, oy); ctx.stroke();
        // 水平投影线 (F端→y轴)
        ctx.beginPath(); ctx.moveTo(ox + fx, oy + fy); ctx.lineTo(ox, oy + fy); ctx.stroke();
        ctx.restore();

        // Fx 分量
        this._drawArrow(ox, oy, ox + fx, oy, '#e74c3c', 2.5);
        this._drawLabel(ox + fx * 0.5, oy + 18, 'Fx', '#e74c3c');

        // Fy 分量
        this._drawArrow(ox, oy, ox, oy + fy, '#3498db', 2.5);
        this._drawLabel(ox - 30, oy + fy * 0.5, 'Fy', '#3498db');

        // F
        this._drawArrow(ox, oy, ox + fx, oy + fy, '#e67e22', 3.5);
        this._drawLabel(ox + fx * 0.5 + 10, oy + fy * 0.5 - 10, 'F', '#e67e22');

        // 拖拽手柄
        this._drawHandle(ox + fx, oy + fy, '#e67e22');

        // 角度弧
        this._drawAngleArc(ox, oy, 0, rad, 35, '#e67e22');

        // 直角标记
        this._drawRightAngle(ox + fx, oy, fx > 0 ? -1 : 1, fy < 0 ? 1 : -1);
    },

    /* ── 斜面受力分析 ── */
    _drawIncline() {
        const { ctx, W, H, incAngle, mass, mu, g } = this;
        const rad = incAngle * Math.PI / 180;
        const mg = mass * g;

        // 斜面几何
        const baseLen = W * 0.7;
        const bx = W * 0.1, by = H * 0.85;
        const topX = bx + baseLen * Math.cos(rad) * Math.cos(rad);
        const topY = by - baseLen * Math.cos(rad) * Math.sin(rad);

        // 斜面
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + baseLen, by);
        ctx.lineTo(topX, topY);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        // 物体位置（斜面中点）
        const t = 0.45;
        const objX = bx + (topX - bx) * t + (baseLen - (topX - bx)) * t;
        const objSurfaceX = bx + t * (topX - bx) + t * (bx + baseLen - topX);
        // 沿斜面的位置
        const px = bx + t * (topX - bx);
        const py = by + t * (topY - by);

        // 物块
        const boxSize = 28;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(-rad);
        ctx.fillStyle = 'rgba(150, 180, 220, 0.5)';
        ctx.strokeStyle = 'rgba(200,220,255,0.8)';
        ctx.lineWidth = 1.5;
        ctx.fillRect(-boxSize / 2, -boxSize, boxSize, boxSize);
        ctx.strokeRect(-boxSize / 2, -boxSize, boxSize, boxSize);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('m', 0, -boxSize / 2);
        ctx.restore();

        // 力的缩放（相对 mg）
        const forceScale = Math.min(W, H) * 0.25 / mg;
        const cx = px, cy = py - boxSize * Math.cos(rad) * 0.5;

        // ① 重力 mg（竖直向下）
        const mgLen = mg * forceScale;
        this._drawArrow(cx, cy, cx, cy + mgLen, '#f39c12', 2.5);
        this._drawLabel(cx + 10, cy + mgLen * 0.5 + 5, 'mg', '#f39c12');

        // ② 重力沿斜面分量 mg·sinα
        const paraLen = mg * Math.sin(rad) * forceScale;
        const paraX = cx + paraLen * Math.cos(rad);
        const paraY = cy + paraLen * Math.sin(rad);
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = 'rgba(231,76,60,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx, cy + mgLen); ctx.lineTo(paraX, paraY); ctx.stroke();
        ctx.restore();
        this._drawArrow(cx, cy, paraX, paraY, '#e74c3c', 2);
        this._drawLabel(paraX + 8, paraY + 5, 'mg sinα', '#e74c3c');

        // ③ 重力垂直斜面分量 mg·cosα
        const perpLen = mg * Math.cos(rad) * forceScale;
        const perpX = cx - perpLen * Math.sin(rad);
        const perpY = cy + perpLen * Math.cos(rad);
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = 'rgba(46,204,113,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx, cy + mgLen); ctx.lineTo(perpX, perpY); ctx.stroke();
        ctx.restore();

        // ④ 支持力 N（垂直斜面向外）
        const nX = cx + perpLen * Math.sin(rad);
        const nY = cy - perpLen * Math.cos(rad);
        this._drawArrow(cx, cy, nX, nY, '#2ecc71', 2.5);
        this._drawLabel(nX - 5, nY - 10, 'N', '#2ecc71');

        // ⑤ 摩擦力（沿斜面向上）
        const fric = mu * mg * Math.cos(rad);
        const fricLen = fric * forceScale;
        const fricX = cx - fricLen * Math.cos(rad);
        const fricY = cy - fricLen * Math.sin(rad);
        if (mu > 0) {
            this._drawArrow(cx, cy, fricX, fricY, '#9b59b6', 2);
            this._drawLabel(fricX - 10, fricY - 10, 'f', '#9b59b6');
        }

        // 角度标注
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1;
        ctx.font = '12px ' + CF.sans;
        const arcR = 45;
        ctx.beginPath();
        ctx.arc(bx + baseLen, by, arcR, Math.PI, Math.PI + rad, true);
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.fillText('α', bx + baseLen - arcR * 0.7, by - arcR * Math.sin(rad / 2) * 0.5 - 3);
        ctx.restore();
    },

    /* ══════════════════ 绘制工具 ══════════════════ */
    _drawArrow(x1, y1, x2, y2, color, width) {
        const ctx = this.ctx;
        const headLen = Math.min(12, Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2) * 0.2);
        const angle = Math.atan2(y2 - y1, x2 - x1);
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        // Shaft
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        // Arrowhead
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - headLen * Math.cos(angle - 0.4), y2 - headLen * Math.sin(angle - 0.4));
        ctx.lineTo(x2 - headLen * Math.cos(angle + 0.4), y2 - headLen * Math.sin(angle + 0.4));
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    },

    _drawLabel(x, y, text, color) {
        const ctx = this.ctx;
        ctx.save();
        ctx.fillStyle = color;
        ctx.font = 'bold 14px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x, y);
        ctx.restore();
    },

    _drawHandle(x, y, color) {
        const ctx = this.ctx;
        ctx.save();
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
    },

    _drawAngleArc(cx, cy, startAngle, endAngle, radius, color) {
        const ctx = this.ctx;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        // Canvas y is inverted, so negate angles
        ctx.arc(cx, cy, radius, -endAngle, -startAngle);
        ctx.stroke();
        // Angle text
        const midAngle = (startAngle + endAngle) / 2;
        const tx = cx + Math.cos(midAngle) * (radius + 14);
        const ty = cy - Math.sin(midAngle) * (radius + 14);
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = color;
        ctx.font = '12px ' + CF.sans;
        ctx.textAlign = 'center';
        const deg = Math.abs(endAngle - startAngle) * 180 / Math.PI;
        ctx.fillText(deg.toFixed(0) + '°', tx, ty);
        ctx.restore();
    },

    _drawRightAngle(x, y, dirX, dirY) {
        const ctx = this.ctx;
        const s = 8;
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + s * dirX, y);
        ctx.lineTo(x + s * dirX, y + s * dirY);
        ctx.lineTo(x, y + s * dirY);
        ctx.stroke();
        ctx.restore();
    },

    /* ══════════════════ 数据更新 ══════════════════ */
    _updateInfo() {
        if (this.mode === 'composition') {
            // v4.6.0-α1：多力合成
            let rx = 0, ry = 0;
            this.forces.forEach((f, i) => {
                const r = f.angle * Math.PI / 180;
                rx += f.mag * Math.cos(r);
                ry += f.mag * Math.sin(r);
                this._setText('fc-fi-mag-' + i, f.mag.toFixed(0));
                this._setText('fc-fi-ang-' + i, f.angle.toFixed(0));
            });
            const rMag = Math.sqrt(rx * rx + ry * ry);
            const rAng = Math.atan2(ry, rx) * 180 / Math.PI;
            this._setText('fc-r-mag', rMag.toFixed(1));
            this._setText('fc-r-ang', rMag < 1 ? '—' : rAng.toFixed(1));
        } else if (this.mode === 'decomposition') {
            const rad = this.fd.angle * Math.PI / 180;
            const fx = this.fd.mag * Math.cos(rad);
            const fy = this.fd.mag * Math.sin(rad);
            this._setText('fc-fd-mag', this.fd.mag.toFixed(0));
            this._setText('fc-fd-ang', this.fd.angle.toFixed(0));
            this._setText('fc-fx', fx.toFixed(1));
            this._setText('fc-fy', fy.toFixed(1));
        } else {
            const mg = this.mass * this.g;
            const rad = this.incAngle * Math.PI / 180;
            this._setText('fc-mg', mg.toFixed(1));
            this._setText('fc-N', (mg * Math.cos(rad)).toFixed(1));
            this._setText('fc-para', (mg * Math.sin(rad)).toFixed(1));
            this._setText('fc-fric', (this.mu * mg * Math.cos(rad)).toFixed(1));
        }
    },

    _setText(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    },

    /* v4.6.0-α1：多力合成 — 增减力 + 法则切换 */
    _addForce() {
        if (this.forces.length >= 6) return;
        // 新力默认放一个观感不重叠的角度（在已有力之间均匀填）
        const used = this.forces.map(f => f.angle);
        let bestAng = 0, bestGap = -1;
        for (let test = 0; test < 360; test += 15) {
            let minDelta = 360;
            for (const a of used) {
                let d = Math.abs(((test - a + 540) % 360) - 180);
                if (d < minDelta) minDelta = d;
            }
            if (minDelta > bestGap) { bestGap = minDelta; bestAng = test; }
        }
        this.forces.push({ mag: 70, angle: bestAng });
        // 力数 ≥3 时强制 polygon 法则
        if (this.forces.length >= 3) this.compMethod = 'polygon';
        this._rebuildParams();
        this.draw();
    },

    _removeForce() {
        if (this.forces.length <= 2) return;
        this.forces.pop();
        this._rebuildParams();
        this.draw();
    },

    _setCompMethod(m) {
        if (m === 'parallelogram' && this.forces.length !== 2) return;
        this.compMethod = m;
        this._rebuildParams();
        this.draw();
    },

    /* ══════════════════ 教育面板 ══════════════════ */
    _injectEduPanel() {
        const edu = document.getElementById('fc-edu');
        if (!edu) return;

        const content = {
            composition: `
                <h4>📐 力的合成 — 平行四边形定则 / 多边形法（首尾相接）</h4>
                <p>多个共点力的合力 <b style="color:#2ecc71">R = ΣF<sub>i</sub></b>，在二维分量上即 R<sub>x</sub> = ΣF<sub>i</sub>·cosθ<sub>i</sub>，R<sub>y</sub> = ΣF<sub>i</sub>·sinθ<sub>i</sub>。</p>
                <ul>
                    <li><b>▱ 平行四边形定则</b>（两力情形）：合力 R 是以 F₁、F₂ 为邻边的平行四边形对角线 → R = √(F₁² + F₂² + 2F₁F₂ cosθ)</li>
                    <li><b>⛓ 多边形法（首尾相接）</b>（任意力数）：把各分力首尾相接画成多边形，从起点画到终点的有向线段即合力 R</li>
                    <li>θ = 0°（同向）R = F₁ + F₂；θ = 180°（反向）R = |F₁ − F₂|；θ = 90° R = √(F₁² + F₂²)</li>
                    <li>当所有分力首尾相接构成 <b>闭合多边形</b> 时 R = 0，物体处于 <b style="color:#2ecc71">共点力平衡态</b></li>
                </ul>
                <p class="fc-tip">💡 ➕ 增加到 3、4、5 个力，调整方向使首尾闭合 → 体验"力的平衡"几何意义</p>
            `,
            decomposition: `
                <h4>📏 力的正交分解</h4>
                <p>将一个力 <b>F</b> 分解为沿 x 轴和 y 轴两个互相垂直的分力。</p>
                <ul>
                    <li>x 分量：Fx = F · cosθ</li>
                    <li>y 分量：Fy = F · sinθ</li>
                    <li>验证：F = √(Fx² + Fy²)，tanθ = Fy / Fx</li>
                </ul>
                <p>正交分解是分析复杂受力问题的基本方法，将力沿选定的坐标轴分解，简化计算。</p>
                <p class="fc-tip">💡 拖动箭头端点观察分量变化</p>
            `,
            incline: `
                <h4>⛰️ 斜面受力分析</h4>
                <p>物体在斜面上受到重力 <b>mg</b>、支持力 <b>N</b> 和摩擦力 <b>f</b>。</p>
                <ul>
                    <li>沿斜面方向：mg·sinα（下滑趋势）</li>
                    <li>垂直斜面方向：N = mg·cosα（平衡支持力）</li>
                    <li>摩擦力：f = μN = μ·mg·cosα</li>
                    <li>下滑条件：mg·sinα > μ·mg·cosα → tanα > μ</li>
                </ul>
                <p class="fc-tip">💡 调整斜面角度和摩擦系数，观察各力变化</p>
            `
        };

        edu.innerHTML = content[this.mode] || '';
    }
};

function initForceComposition() { ForceComposition.init(); }
window.ForceComposition = ForceComposition;
