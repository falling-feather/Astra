// ===== 流体力学可视化引擎 =====
// 3 模式: 势流叠加、圆柱绕流(Magnus)、伯努利管

const FluidSim = {
    canvas: null, ctx: null, W: 0, H: 0,
    mode: 'potential',   // 'potential' | 'cylinder' | 'bernoulli' | 'airfoil' (v4.6.0-α5)
    paused: false,

    // 势流元素 [{type:'source'|'sink'|'vortex', x, y, m}]
    elements: [],
    uniformU: 60,        // 均匀来流速度 px/s
    _elDragIndex: -1,
    _elDragOffX: 0,
    _elDragOffY: 0,
    _addType: 'source',  // 下一个放置的类型
    _probePos: null,      // 探针位置

    // 圆柱绕流
    cylRadius: 0,
    cylCirculation: 0,   // Γ, + 逆时针 (产生正升力)
    _cylDragging: false,

    // 伯努利管
    _bernoulliT: 0,
    _bernoulliLastTime: 0,
    _bernoulliRunning: false,
    _bernoulliAnimId: null,
    _bernoulliParticles: [],
    _bernoulliConstrict: 0.4, // 0~1 收窄程度

    // v4.6.0-α5：机翼升力模式
    _airfoilT: 0,
    _airfoilLastTime: 0,
    _airfoilRunning: false,
    _airfoilAnimId: null,
    _airfoilParticles: [],
    _airfoilAttack: 8,        // 迎角 ° (-15~+25)
    _airfoilThickness: 0.18,  // 相对厚度 0.05~0.30

    // 通用
    _lastTime: 0,

    init() {
        this.canvas = document.getElementById('fluid-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');

        this.resize();
        this._injectModeButtons();
        this._injectPotentialPanel();
        this._injectCylinderPanel();
        this._injectBernoulliPanel();
        this._injectAirfoilPanel();
        this._injectGlobalActions();
        this.bindCanvas();
        this.setMode('potential');

        if (typeof ResizeObserver !== 'undefined') {
            this._ro = new ResizeObserver(() => {
                this.resize();
                this.cylRadius = Math.min(this.W, this.H) * 0.12;
                this.render();
            });
            this._ro.observe(this.canvas.parentElement);
        }
    },

    destroy() {
        if (this._bernoulliAnimId) { cancelAnimationFrame(this._bernoulliAnimId); this._bernoulliAnimId = null; }
        if (this._airfoilAnimId) { cancelAnimationFrame(this._airfoilAnimId); this._airfoilAnimId = null; }
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
    },

    resize() {
        if (window.PhysicsZoom && window.PhysicsZoom.movedCanvas === this.canvas) return;
        const wrap = this.canvas.parentElement;
        if (!wrap) return;
        const w = wrap.clientWidth;
        if (w === 0) return;
        const h = Math.min(w * 0.55, 440);
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w; this.H = h;
        this.cylRadius = Math.min(w, h) * 0.12;
    },

    // ═══════════════════════════════════════════
    // UI 面板
    // ═══════════════════════════════════════════
    _injectModeButtons() {
        const wrap = document.getElementById('fluid-controls');
        if (!wrap) return;
        const bar = document.createElement('div');
        bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;';
        [['potential', '势流叠加'], ['cylinder', '圆柱绕流'], ['bernoulli', '伯努利管'], ['airfoil', '✈️ 机翼升力']].forEach(([key, label]) => {
            const btn = document.createElement('button');
            btn.className = 'btn btn--ghost fluid-mode-btn';
            btn.dataset.mode = key;
            btn.textContent = label;
            btn.addEventListener('click', () => this.setMode(key));
            bar.appendChild(btn);
        });
        wrap.prepend(bar);
    },

    _injectGlobalActions() {
        const wrap = document.getElementById('fluid-controls');
        if (!wrap || document.getElementById('fluid-global-actions')) return;
        const row = document.createElement('div');
        row.id = 'fluid-global-actions';
        row.className = 'physics-actions';
        row.innerHTML = `
            <button id="fluid-pause" class="btn btn--ghost">暂停</button>
            <button id="fluid-reset" class="btn btn--ghost">重置</button>
        `;
        wrap.appendChild(row);

        const pauseBtn = document.getElementById('fluid-pause');
        const resetBtn = document.getElementById('fluid-reset');
        if (pauseBtn) pauseBtn.addEventListener('click', () => {
            this.paused = !this.paused;
            pauseBtn.textContent = this.paused ? '继续' : '暂停';
        });
        if (resetBtn) resetBtn.addEventListener('click', () => this.resetScene());
    },

    resetScene() {
        this.paused = false;
        const pauseBtn = document.getElementById('fluid-pause');
        if (pauseBtn) pauseBtn.textContent = '暂停';

        this.mode = 'potential';
        this.elements = [];
        this.uniformU = 60;
        this._addType = 'source';
        this._probePos = null;
        this._elDragIndex = -1;

        this.cylCirculation = 0;
        this._cylDragging = false;

        this._bernoulliRunning = false;
        this._bernoulliT = 0;
        this._bernoulliParticles = [];
        this._bernoulliConstrict = 0.4;
        if (this._bernoulliAnimId) { cancelAnimationFrame(this._bernoulliAnimId); this._bernoulliAnimId = null; }

        const fu = document.getElementById('fluid-uniform-u');
        const fuv = document.getElementById('fluid-u-val');
        if (fu) fu.value = '60';
        if (fuv) fuv.textContent = '60';
        const gamma = document.getElementById('fluid-cyl-gamma');
        const gammaVal = document.getElementById('fluid-cyl-gamma-val');
        if (gamma) gamma.value = '0';
        if (gammaVal) gammaVal.textContent = '0';
        const constrict = document.getElementById('fluid-bern-constrict');
        const constrictVal = document.getElementById('fluid-bern-constrict-val');
        if (constrict) constrict.value = '0.4';
        if (constrictVal) constrictVal.textContent = '0.40';
        const bernToggle = document.getElementById('fluid-bern-toggle');
        if (bernToggle) bernToggle.textContent = '开始';

        this.setMode('potential');
    },

    _injectPotentialPanel() {
        const wrap = document.getElementById('fluid-controls');
        if (!wrap || document.getElementById('fluid-potential-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'fluid-potential-panel';
        panel.style.cssText = 'display:none;padding:8px 12px;background:rgba(30,41,59,.55);border-radius:8px;font-size:13px;color:#e2e8f0;';
        panel.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <label style="display:flex;align-items:center;gap:4px;cursor:pointer">
                    <input type="radio" name="fluid-el-type" value="source" checked> <span style="color:#f59e0b">⊕</span> 源
                </label>
                <label style="display:flex;align-items:center;gap:4px;cursor:pointer">
                    <input type="radio" name="fluid-el-type" value="sink"> <span style="color:#8b5cf6">⊖</span> 汇
                </label>
                <label style="display:flex;align-items:center;gap:4px;cursor:pointer">
                    <input type="radio" name="fluid-el-type" value="vortex"> <span style="color:#38bdf8">↻</span> 涡
                </label>
                <div style="margin-left:12px">
                    <label style="font-size:12px;color:#94a3b8">来流 U</label>
                    <input type="range" id="fluid-uniform-u" min="0" max="150" step="5" value="60" style="width:100px;vertical-align:middle">
                    <span id="fluid-u-val" style="font-size:12px;color:#cbd5e1">60</span>
                </div>
                <button id="fluid-clear-el" style="padding:2px 10px;border-radius:4px;border:1px solid #64748b;background:transparent;color:#cbd5e1;cursor:pointer;font-size:12px;margin-left:8px">清空</button>
            </div>
            <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
                <span style="font-size:11px;color:#94a3b8;line-height:24px">预设：</span>
                <button class="fluid-preset-btn" data-preset="rankine" style="padding:1px 8px;border-radius:4px;border:1px solid #475569;background:transparent;color:#cbd5e1;cursor:pointer;font-size:11px">Rankine半体</button>
                <button class="fluid-preset-btn" data-preset="dipole" style="padding:1px 8px;border-radius:4px;border:1px solid #475569;background:transparent;color:#cbd5e1;cursor:pointer;font-size:11px">偶极子</button>
                <button class="fluid-preset-btn" data-preset="doublet" style="padding:1px 8px;border-radius:4px;border:1px solid #475569;background:transparent;color:#cbd5e1;cursor:pointer;font-size:11px">双源</button>
                <button class="fluid-preset-btn" data-preset="vortexpair" style="padding:1px 8px;border-radius:4px;border:1px solid #475569;background:transparent;color:#cbd5e1;cursor:pointer;font-size:11px">涡对</button>
                <button class="fluid-preset-btn" data-preset="sourcevortex" style="padding:1px 8px;border-radius:4px;border:1px solid #475569;background:transparent;color:#cbd5e1;cursor:pointer;font-size:11px">源+涡</button>
            </div>
            <div style="margin-top:4px;color:#94a3b8;font-size:12px">点击放置流体元素，拖拽移动，双击删除</div>
        `;
        wrap.appendChild(panel);

        panel.querySelectorAll('input[name="fluid-el-type"]').forEach(r => {
            r.addEventListener('change', () => { this._addType = r.value; });
        });
        document.getElementById('fluid-uniform-u').addEventListener('input', e => {
            this.uniformU = parseFloat(e.target.value);
            document.getElementById('fluid-u-val').textContent = this.uniformU;
            this.render();
        });
        document.getElementById('fluid-clear-el').addEventListener('click', () => {
            this.elements = [];
            this.render();
        });

        // 预设
        const presets = {
            rankine: () => {
                // Rankine 半体: 均匀流 + 单源
                this.uniformU = 60;
                document.getElementById('fluid-uniform-u').value = 60;
                document.getElementById('fluid-u-val').textContent = '60';
                this.elements = [
                    { type: 'source', x: this.W * 0.35, y: this.H / 2, m: 80 }
                ];
            },
            dipole: () => {
                // 偶极子(源 + 汇)
                const d = Math.min(this.W, this.H) * 0.12;
                this.elements = [
                    { type: 'source', x: this.W / 2 - d, y: this.H / 2, m: 80 },
                    { type: 'sink', x: this.W / 2 + d, y: this.H / 2, m: -80 }
                ];
            },
            doublet: () => {
                // 双源
                const d = Math.min(this.W, this.H) * 0.15;
                this.elements = [
                    { type: 'source', x: this.W / 2 - d, y: this.H / 2, m: 80 },
                    { type: 'source', x: this.W / 2 + d, y: this.H / 2, m: 80 }
                ];
            },
            vortexpair: () => {
                // 涡对(反向)
                this.uniformU = 0;
                document.getElementById('fluid-uniform-u').value = 0;
                document.getElementById('fluid-u-val').textContent = '0';
                const d = Math.min(this.W, this.H) * 0.12;
                this.elements = [
                    { type: 'vortex', x: this.W / 2 - d, y: this.H / 2, m: 80 },
                    { type: 'vortex', x: this.W / 2 + d, y: this.H / 2, m: -80 }
                ];
            },
            sourcevortex: () => {
                // 螺旋流: 源 + 涡 叠加
                this.uniformU = 0;
                document.getElementById('fluid-uniform-u').value = 0;
                document.getElementById('fluid-u-val').textContent = '0';
                this.elements = [
                    { type: 'source', x: this.W / 2, y: this.H / 2, m: 80 },
                    { type: 'vortex', x: this.W / 2, y: this.H / 2, m: 80 }
                ];
            }
        };
        panel.querySelectorAll('.fluid-preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const fn = presets[btn.dataset.preset];
                if (fn) { fn(); this.render(); }
            });
        });
    },

    _injectCylinderPanel() {
        const wrap = document.getElementById('fluid-controls');
        if (!wrap || document.getElementById('fluid-cylinder-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'fluid-cylinder-panel';
        panel.style.cssText = 'display:none;padding:8px 12px;background:rgba(30,41,59,.55);border-radius:8px;font-size:13px;color:#e2e8f0;';
        panel.innerHTML = `
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
                <div>
                    <label style="font-size:12px;color:#94a3b8">来流 U</label>
                    <input type="range" id="fluid-cyl-u" min="10" max="150" step="5" value="60" style="width:90px;vertical-align:middle">
                    <span id="fluid-cyl-u-val" style="font-size:12px;color:#cbd5e1">60</span>
                </div>
                <div>
                    <label style="font-size:12px;color:#94a3b8">环量 Γ</label>
                    <input type="range" id="fluid-cyl-gamma" min="-5000" max="5000" step="100" value="0" style="width:120px;vertical-align:middle">
                    <span id="fluid-cyl-gamma-val" style="font-size:12px;color:#cbd5e1">0</span>
                </div>
                <button id="fluid-cyl-reset-gamma" style="padding:2px 10px;border-radius:4px;border:1px solid #64748b;background:transparent;color:#cbd5e1;cursor:pointer;font-size:12px">Γ=0</button>
            </div>
            <div style="margin-top:6px;color:#94a3b8;font-size:12px">拖动环量滑块观察 Magnus 效应（升力方向）</div>
        `;
        wrap.appendChild(panel);

        const uSlider = document.getElementById('fluid-cyl-u');
        uSlider.addEventListener('input', e => {
            this.uniformU = parseFloat(e.target.value);
            document.getElementById('fluid-cyl-u-val').textContent = this.uniformU;
            this.render();
        });
        const gSlider = document.getElementById('fluid-cyl-gamma');
        gSlider.addEventListener('input', e => {
            this.cylCirculation = parseFloat(e.target.value);
            document.getElementById('fluid-cyl-gamma-val').textContent = this.cylCirculation;
            this.render();
        });
        document.getElementById('fluid-cyl-reset-gamma').addEventListener('click', () => {
            this.cylCirculation = 0;
            gSlider.value = 0;
            document.getElementById('fluid-cyl-gamma-val').textContent = '0';
            this.render();
        });
    },

    _injectBernoulliPanel() {
        const wrap = document.getElementById('fluid-controls');
        if (!wrap || document.getElementById('fluid-bernoulli-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'fluid-bernoulli-panel';
        panel.style.cssText = 'display:none;padding:8px 12px;background:rgba(30,41,59,.55);border-radius:8px;font-size:13px;color:#e2e8f0;';
        panel.innerHTML = `
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
                <div>
                    <label style="font-size:12px;color:#94a3b8">收窄程度</label>
                    <input type="range" id="fluid-constrict" min="0.1" max="0.8" step="0.05" value="0.4" style="width:100px;vertical-align:middle">
                    <span id="fluid-constrict-val" style="font-size:12px;color:#cbd5e1">0.40</span>
                </div>
                <button id="fluid-bern-toggle" class="btn btn--ghost" style="font-size:12px;padding:2px 12px">开始</button>
                <button id="fluid-bern-reset" class="btn btn--ghost" style="font-size:12px;padding:2px 12px">重置</button>
            </div>
            <div style="margin-top:6px;color:#94a3b8;font-size:12px">P + ½ρv² = const — 截面越窄速度越大，压强越小</div>
        `;
        wrap.appendChild(panel);

        document.getElementById('fluid-constrict').addEventListener('input', e => {
            this._bernoulliConstrict = parseFloat(e.target.value);
            document.getElementById('fluid-constrict-val').textContent = this._bernoulliConstrict.toFixed(2);
            this.render();
        });
        document.getElementById('fluid-bern-toggle').addEventListener('click', () => {
            if (this._bernoulliRunning) {
                this._bernoulliRunning = false;
                document.getElementById('fluid-bern-toggle').textContent = '开始';
            } else {
                this._bernoulliRunning = true;
                document.getElementById('fluid-bern-toggle').textContent = '暂停';
                this._bernoulliLastTime = 0;
                this._startBernoulliLoop();
            }
        });
        document.getElementById('fluid-bern-reset').addEventListener('click', () => {
            this._bernoulliRunning = false;
            this._bernoulliParticles = [];
            this._bernoulliT = 0;
            document.getElementById('fluid-bern-toggle').textContent = '开始';
            this.render();
        });
    },

    // ═══════════════════════════════════════════
    // 模式切换
    // ═══════════════════════════════════════════
    setMode(mode) {
        this.mode = mode;
        // 按钮高亮
        document.querySelectorAll('.fluid-mode-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.mode === mode);
        });
        // 面板显隐
        const pp = document.getElementById('fluid-potential-panel');
        const cp = document.getElementById('fluid-cylinder-panel');
        const bp = document.getElementById('fluid-bernoulli-panel');
        const ap = document.getElementById('fluid-airfoil-panel');
        if (pp) pp.style.display = mode === 'potential' ? '' : 'none';
        if (cp) cp.style.display = mode === 'cylinder' ? '' : 'none';
        if (bp) bp.style.display = mode === 'bernoulli' ? '' : 'none';
        if (ap) ap.style.display = mode === 'airfoil' ? '' : 'none';

        // 停止伯努利动画
        if (mode !== 'bernoulli') {
            this._bernoulliRunning = false;
            if (this._bernoulliAnimId) { cancelAnimationFrame(this._bernoulliAnimId); this._bernoulliAnimId = null; }
        }
        // v4.6.0-α5：停止机翼动画
        if (mode !== 'airfoil') {
            this._airfoilRunning = false;
            if (this._airfoilAnimId) { cancelAnimationFrame(this._airfoilAnimId); this._airfoilAnimId = null; }
        }

        this.render();
    },

    // ═══════════════════════════════════════════
    // Canvas 交互
    // ═══════════════════════════════════════════
    bindCanvas() {
        const getPos = e => {
            const rect = this.canvas.getBoundingClientRect();
            if (e.touches) return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
            return { x: e.clientX - rect.left, y: e.clientY - rect.top };
        };

        const onDown = e => {
            e.preventDefault();
            const pos = getPos(e);

            if (this.mode === 'potential') {
                // 检查是否点中已有元素
                for (let i = this.elements.length - 1; i >= 0; i--) {
                    const el = this.elements[i];
                    if ((pos.x - el.x) ** 2 + (pos.y - el.y) ** 2 < 400) {
                        this._elDragIndex = i;
                        this._elDragOffX = pos.x - el.x;
                        this._elDragOffY = pos.y - el.y;
                        this.canvas.style.cursor = 'grabbing';
                        return;
                    }
                }
                // 放置新元素
                if (this.elements.length < 12) {
                    const m = this._addType === 'sink' ? -80 : 80;
                    this.elements.push({ type: this._addType, x: pos.x, y: pos.y, m });
                    this.render();
                }
            }
        };

        const onMove = e => {
            const pos = getPos(e);
            if (this.mode === 'potential' && this._elDragIndex >= 0) {
                e.preventDefault();
                this.elements[this._elDragIndex].x = pos.x - this._elDragOffX;
                this.elements[this._elDragIndex].y = pos.y - this._elDragOffY;
                this._probePos = pos;
                this.render();
                return;
            }
            // 探针跟踪（势流和圆柱模式）
            if (this.mode === 'potential' || this.mode === 'cylinder') {
                this._probePos = pos;
                this.render();
            }
        };

        const onUp = () => {
            this._elDragIndex = -1;
            this.canvas.style.cursor = 'default';
        };

        this.canvas.addEventListener('mousedown', onDown);
        this.canvas.addEventListener('mousemove', onMove);
        this.canvas.addEventListener('mouseup', onUp);
        this.canvas.addEventListener('mouseleave', () => {
            onUp();
            if (this._probePos) { this._probePos = null; this.render(); }
        });
        this.canvas.addEventListener('touchstart', onDown, { passive: false });
        this.canvas.addEventListener('touchmove', onMove, { passive: false });
        this.canvas.addEventListener('touchend', onUp);

        this.canvas.addEventListener('dblclick', e => {
            if (this.mode !== 'potential') return;
            const pos = getPos(e);
            for (let i = this.elements.length - 1; i >= 0; i--) {
                if ((pos.x - this.elements[i].x) ** 2 + (pos.y - this.elements[i].y) ** 2 < 400) {
                    this.elements.splice(i, 1);
                    this.render();
                    return;
                }
            }
        });
    },

    // ═══════════════════════════════════════════
    // 势流场计算
    // ═══════════════════════════════════════════
    velocityAtPotential(px, py) {
        // 均匀来流
        let vx = this.uniformU, vy = 0;

        for (const el of this.elements) {
            const dx = px - el.x, dy = py - el.y;
            const r2 = dx * dx + dy * dy;
            if (r2 < 25) continue;

            if (el.type === 'source' || el.type === 'sink') {
                // v = m/(2πr²) * (dx, dy)
                const factor = el.m / (2 * Math.PI * r2);
                vx += factor * dx;
                vy += factor * dy;
            } else if (el.type === 'vortex') {
                // v_θ = Γ/(2πr), tangential: (-dy, dx)/r
                const factor = el.m / (2 * Math.PI * r2);
                vx += factor * (-dy);
                vy += factor * dx;
            }
        }
        return { x: vx, y: vy };
    },

    // ═══════════════════════════════════════════
    // 圆柱绕流场计算
    // ═══════════════════════════════════════════
    velocityAtCylinder(px, py) {
        const cx = this.W / 2, cy = this.H / 2;
        const R = this.cylRadius;
        const U = this.uniformU;
        const Gamma = this.cylCirculation;

        const dx = px - cx, dy = py - cy;
        const r2 = dx * dx + dy * dy;
        const R2 = R * R;

        // 内部
        if (r2 < R2) return { x: 0, y: 0 };

        const r4 = r2 * r2;
        // 无环量叠加 doublet:
        // vx = U * (1 - R²*(x²-y²)/r⁴)
        // vy = U * (-2R²*x*y/r⁴)
        let vx = U * (1 - R2 * (dx * dx - dy * dy) / r4);
        let vy = U * (-2 * R2 * dx * dy / r4);

        // 环量贡献 (tangential)
        if (Gamma !== 0) {
            const factor = Gamma / (2 * Math.PI * r2);
            vx += factor * (-dy);
            vy += factor * dx;
        }

        return { x: vx, y: vy };
    },

    // ═══════════════════════════════════════════
    // 渲染入口
    // ═══════════════════════════════════════════
    render() {
        const { ctx, W, H } = this;
        if (W === 0) return;

        ctx.clearRect(0, 0, W, H);
        // 背景
        ctx.fillStyle = '#0c1222';
        ctx.fillRect(0, 0, W, H);

        switch (this.mode) {
            case 'potential': this.drawPotentialFlow(); break;
            case 'cylinder': this.drawCylinderFlow(); break;
            case 'bernoulli': this.drawBernoulli(); break;
            case 'airfoil': this.drawAirfoil(); break;  // v4.6.0-α5
        }
    },

    // ═══════════════════════════════════════════
    // 势流叠加绘制
    // ═══════════════════════════════════════════
    drawPotentialFlow() {
        const { ctx, W, H } = this;

        if (this.elements.length === 0 && this.uniformU === 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.font = '19px ' + CF.sans;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('点击画布放置流体元素（源、汇、涡）', W / 2, H / 2);
            return;
        }

        // 速度矢量颜色背景
        this._drawVelocityField('potential');

        // 流线 (从左侧和顶部释放)
        ctx.lineWidth = 1.2;
        const seeds = [];
        for (let y = 20; y < H; y += 28) seeds.push({ x: 2, y });
        if (this.uniformU < 10) {
            for (let x = 20; x < W; x += 28) seeds.push({ x, y: 2 });
        }
        for (const seed of seeds) {
            this._traceStreamline(seed.x, seed.y, 'potential');
        }

        // 绘制元素
        this._drawFlowElements();

        // 探针
        if (this._probePos) this._drawFluidProbe('potential');
    },
    _drawVelocityField(mode) {
        const { ctx, W, H } = this;
        const step = 20;

        // 先算最大速度用于归一化
        let maxV = 0;
        for (let y = step / 2; y < H; y += step) {
            for (let x = step / 2; x < W; x += step) {
                const v = mode === 'potential' ? this.velocityAtPotential(x, y) : this.velocityAtCylinder(x, y);
                const mag = Math.hypot(v.x, v.y);
                if (mag > maxV) maxV = mag;
            }
        }
        if (maxV < 1) maxV = 1;

        for (let y = step / 2; y < H; y += step) {
            for (let x = step / 2; x < W; x += step) {
                const v = mode === 'potential' ? this.velocityAtPotential(x, y) : this.velocityAtCylinder(x, y);
                const mag = Math.hypot(v.x, v.y);
                if (mag < 0.5) continue;
                const norm = Math.min(mag / maxV, 1);

                // 颜色从蓝(慢) → 青 → 黄(快)
                const r = Math.round(norm * 250);
                const g = Math.round(100 + norm * 150);
                const b = Math.round(250 - norm * 200);
                ctx.fillStyle = `rgba(${r},${g},${b},0.12)`;
                ctx.fillRect(x - step / 2, y - step / 2, step, step);
            }
        }
    },

    _traceStreamline(sx, sy, mode) {
        const { ctx, W, H } = this;
        const maxSteps = 600;
        const ds = 3; // 步长
        let x = sx, y = sy;

        ctx.beginPath();
        ctx.moveTo(x, y);

        let prevAngle = null;
        for (let i = 0; i < maxSteps; i++) {
            const v = mode === 'potential' ? this.velocityAtPotential(x, y) : this.velocityAtCylinder(x, y);
            const mag = Math.hypot(v.x, v.y);
            if (mag < 0.5) break;

            // 归一化步进
            const nx = v.x / mag, ny = v.y / mag;
            x += nx * ds;
            y += ny * ds;

            if (x < -10 || x > W + 10 || y < -10 || y > H + 10) break;

            // 圆柱模式下不画进圆柱内
            if (mode === 'cylinder') {
                const cx = W / 2, cy = H / 2;
                if ((x - cx) ** 2 + (y - cy) ** 2 < this.cylRadius ** 2) break;
            }

            ctx.lineTo(x, y);

            // 角度突变检测（避免绕奇点画圈）
            const angle = Math.atan2(ny, nx);
            if (prevAngle !== null) {
                let da = angle - prevAngle;
                if (da > Math.PI) da -= 2 * Math.PI;
                if (da < -Math.PI) da += 2 * Math.PI;
                if (Math.abs(da) > 1.0) break;
            }
            prevAngle = angle;
        }

        const normMag = Math.min(Math.hypot(
            (mode === 'potential' ? this.velocityAtPotential(sx, sy) : this.velocityAtCylinder(sx, sy)).x,
            (mode === 'potential' ? this.velocityAtPotential(sx, sy) : this.velocityAtCylinder(sx, sy)).y
        ) / 80, 1);
        ctx.strokeStyle = `rgba(56,189,248,${0.15 + normMag * 0.35})`;
        ctx.stroke();
    },

    _drawFlowElements() {
        const ctx = this.ctx;
        for (const el of this.elements) {
            const r = 12;
            ctx.beginPath();
            ctx.arc(el.x, el.y, r, 0, Math.PI * 2);

            if (el.type === 'source') {
                ctx.fillStyle = 'rgba(245,158,11,0.2)';
                ctx.fill();
                ctx.strokeStyle = '#f59e0b';
            } else if (el.type === 'sink') {
                ctx.fillStyle = 'rgba(139,92,246,0.2)';
                ctx.fill();
                ctx.strokeStyle = '#8b5cf6';
            } else {
                ctx.fillStyle = 'rgba(56,189,248,0.2)';
                ctx.fill();
                ctx.strokeStyle = '#38bdf8';
            }
            ctx.lineWidth = 2;
            ctx.stroke();

            // 符号
            ctx.fillStyle = ctx.strokeStyle;
            ctx.font = 'bold 19px ' + CF.sans;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            if (el.type === 'source') ctx.fillText('+', el.x, el.y);
            else if (el.type === 'sink') ctx.fillText('−', el.x, el.y);
            else ctx.fillText('↻', el.x, el.y + 1);

            // 标签
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.font = '15px ' + CF.sans;
            const labels = { source: '源', sink: '汇', vortex: '涡' };
            ctx.fillText(labels[el.type], el.x, el.y - r - 5);
        }
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    },

    // ═══════════════════════════════════════════
    // 圆柱绕流绘制
    // ═══════════════════════════════════════════
    drawCylinderFlow() {
        const { ctx, W, H } = this;
        const cx = W / 2, cy = H / 2;
        const R = this.cylRadius;

        // 速度背景
        this._drawVelocityField('cylinder');

        // 流线
        ctx.lineWidth = 1.2;
        for (let y = 15; y < H; y += 22) {
            this._traceStreamline(2, y, 'cylinder');
        }

        // 圆柱体
        const grad = ctx.createRadialGradient(cx - R * 0.2, cy - R * 0.2, R * 0.1, cx, cy, R);
        grad.addColorStop(0, 'rgba(100,116,139,0.6)');
        grad.addColorStop(1, 'rgba(51,65,85,0.8)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(148,163,184,0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 升力指示
        if (this.cylCirculation !== 0) {
            const liftDir = this.cylCirculation > 0 ? -1 : 1; // 正环量 → 向上升力
            const liftMag = Math.abs(this.cylCirculation) / 5000;
            const arrowLen = R * 0.6 + liftMag * R * 1.5;

            ctx.strokeStyle = '#f43f5e';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx, cy + liftDir * arrowLen);
            ctx.stroke();

            // 箭头
            const ey = cy + liftDir * arrowLen;
            ctx.fillStyle = '#f43f5e';
            ctx.beginPath();
            ctx.moveTo(cx, ey);
            ctx.lineTo(cx - 6, ey - liftDir * 10);
            ctx.lineTo(cx + 6, ey - liftDir * 10);
            ctx.closePath();
            ctx.fill();

            // 标签
            ctx.fillStyle = '#f43f5e';
            ctx.font = '17px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.fillText('升力 F_L', cx, ey + liftDir * 16);

            // 旋转方向
            ctx.strokeStyle = 'rgba(251,191,36,0.4)';
            ctx.lineWidth = 1.5;
            const rotDir = this.cylCirculation > 0 ? -1 : 1;
            ctx.beginPath();
            ctx.arc(cx, cy, R + 8, 0.2 * rotDir, (Math.PI * 1.6) * rotDir, rotDir < 0);
            ctx.stroke();
        }

        // 驻点
        this._drawStagnationPoints();

        // 信息
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '16px ' + CF.mono;
        ctx.textAlign = 'left';
        ctx.fillText(`U = ${this.uniformU} px/s`, 8, H - 24);
        ctx.fillText(`Γ = ${this.cylCirculation}`, 8, H - 10);
        if (this.cylCirculation !== 0) {
            ctx.fillStyle = '#f43f5e';
            ctx.fillText(`F_L = ρUΓ (Kutta-Joukowski)`, 8, H - 38);
        }

        // 探针
        if (this._probePos) this._drawFluidProbe('cylinder');
    },

    _drawStagnationPoints() {
        const { ctx, W, H } = this;
        const cx = W / 2, cy = H / 2;
        const R = this.cylRadius;
        const U = this.uniformU;
        const Gamma = this.cylCirculation;

        if (U === 0) return;

        // sin(θ) = -Γ/(4πUR)
        const sinTheta = -Gamma / (4 * Math.PI * U * R);
        if (Math.abs(sinTheta) > 1) return; // 驻点脱离表面

        const theta1 = Math.asin(sinTheta);
        const theta2 = Math.PI - theta1;

        const points = [theta1, theta2];
        for (const theta of points) {
            const sx = cx + R * Math.cos(theta);
            const sy = cy - R * Math.sin(theta); // canvas y flipped
            ctx.beginPath();
            ctx.arc(sx, sy, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#22d3ee';
            ctx.fill();
            ctx.strokeStyle = 'rgba(34,211,238,0.5)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    },

    // ═══════════════════════════════════════════
    // 流场探针
    // ═══════════════════════════════════════════
    _drawFluidProbe(mode) {
        const { ctx, W, H } = this;
        const { x: px, y: py } = this._probePos;

        const v = mode === 'potential' ? this.velocityAtPotential(px, py) : this.velocityAtCylinder(px, py);
        const vMag = Math.hypot(v.x, v.y);
        const vAngle = Math.atan2(v.y, v.x);

        // 伯努利压强 (P + ½ρv² = P₀ + ½ρU²)
        const P_ref = 0.5 * this.uniformU * this.uniformU;
        const P = P_ref - 0.5 * vMag * vMag;

        // 十字线
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke();
        ctx.setLineDash([]);

        // 速度箭头
        if (vMag > 0.5) {
            const arrowLen = Math.min(50, 10 * Math.log(1 + vMag * 0.5));
            const ax = px + arrowLen * Math.cos(vAngle);
            const ay = py + arrowLen * Math.sin(vAngle);
            ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ax, ay); ctx.stroke();
            const hl = 6;
            ctx.fillStyle = '#38bdf8';
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(ax - hl * Math.cos(vAngle - 0.4), ay - hl * Math.sin(vAngle - 0.4));
            ctx.lineTo(ax - hl * Math.cos(vAngle + 0.4), ay - hl * Math.sin(vAngle + 0.4));
            ctx.closePath(); ctx.fill();
        }

        // 信息标签
        const tx = px < W - 185 ? px + 14 : px - 180;
        const ty = py > 80 ? py - 14 : py + 60;
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.beginPath();
        ctx.roundRect(tx - 6, ty - 18, 175, 62, 6);
        ctx.fill();

        ctx.font = '500 16px ' + CF.mono;
        ctx.textAlign = 'left';
        ctx.fillStyle = '#38bdf8';
        ctx.fillText(`|v| = ${vMag.toFixed(1)} px/s`, tx, ty);
        ctx.fillStyle = '#fbbf24';
        ctx.fillText(`\u03b8 = ${(vAngle * 180 / Math.PI).toFixed(1)}\u00b0`, tx, ty + 16);
        ctx.fillStyle = '#f43f5e';
        ctx.fillText(`P = ${P.toFixed(1)}  (Bernoulli)`, tx, ty + 32);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '15px ' + CF.sans;
        ctx.fillText(`vx=${v.x.toFixed(1)}  vy=${v.y.toFixed(1)}`, tx, ty + 46);
    },

    // ═══════════════════════════════════════════
    // 伯努利管
    // ═══════════════════════════════════════════
    drawBernoulli() {
        const { ctx, W, H } = this;

        const pipeTop = H * 0.2;
        const pipeBot = H * 0.8;
        const pipeH = pipeBot - pipeTop;
        const constrict = this._bernoulliConstrict;

        // 管壁轮廓
        const cx = W / 2;
        const halfNarrow = pipeH / 2 * (1 - constrict);

        // 上壁
        ctx.beginPath();
        ctx.moveTo(0, pipeTop);
        ctx.bezierCurveTo(cx * 0.6, pipeTop, cx * 0.8, H / 2 - halfNarrow, cx, H / 2 - halfNarrow);
        ctx.bezierCurveTo(cx * 1.2, H / 2 - halfNarrow, cx * 1.4, pipeTop, W, pipeTop);
        ctx.strokeStyle = 'rgba(148,163,184,0.6)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 下壁
        ctx.beginPath();
        ctx.moveTo(0, pipeBot);
        ctx.bezierCurveTo(cx * 0.6, pipeBot, cx * 0.8, H / 2 + halfNarrow, cx, H / 2 + halfNarrow);
        ctx.bezierCurveTo(cx * 1.2, H / 2 + halfNarrow, cx * 1.4, pipeBot, W, pipeBot);
        ctx.strokeStyle = 'rgba(148,163,184,0.6)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 管壁填充
        ctx.fillStyle = 'rgba(30,41,59,0.3)';
        ctx.beginPath();
        ctx.moveTo(0, pipeTop);
        ctx.bezierCurveTo(cx * 0.6, pipeTop, cx * 0.8, H / 2 - halfNarrow, cx, H / 2 - halfNarrow);
        ctx.bezierCurveTo(cx * 1.2, H / 2 - halfNarrow, cx * 1.4, pipeTop, W, pipeTop);
        ctx.lineTo(W, pipeBot);
        ctx.bezierCurveTo(cx * 1.4, pipeBot, cx * 1.2, H / 2 + halfNarrow, cx, H / 2 + halfNarrow);
        ctx.bezierCurveTo(cx * 0.8, H / 2 + halfNarrow, cx * 0.6, pipeBot, 0, pipeBot);
        ctx.closePath();
        ctx.fill();

        // 计算管截面高度函数
        const pipeHalfAt = (xPos) => {
            // 简化：用 cos 插值
            const t = (xPos - cx) / (W * 0.4);
            const clampT = Math.max(-1, Math.min(1, t));
            const narrowFactor = (1 + Math.cos(clampT * Math.PI)) / 2; // 1 at center, 0 at edges
            return pipeH / 2 * (1 - constrict * narrowFactor);
        };

        // 速度/压强标注
        const sections = [
            { x: W * 0.1, label: 'A₁ (宽处)' },
            { x: cx, label: 'A₂ (窄处)' },
            { x: W * 0.9, label: 'A₃ (宽处)' }
        ];

        const baseArea = pipeH;
        const rho = 1; // 归一化密度

        for (const sec of sections) {
            const halfH = pipeHalfAt(sec.x);
            const area = halfH * 2;
            // 连续性: A₁v₁ = A₂v₂
            const v = (baseArea / area) * 40; // base velocity 40
            // 伯努利: P + ½ρv² = const
            const P = 100 - 0.5 * rho * v * v / 80; // 归一化

            const yTop = H / 2 - halfH;
            const yBot = H / 2 + halfH;

            // 标注线
            ctx.strokeStyle = 'rgba(255,255,255,0.15)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3,3]);
            ctx.beginPath(); ctx.moveTo(sec.x, yTop - 10); ctx.lineTo(sec.x, yBot + 10); ctx.stroke();
            ctx.setLineDash([]);

            // 数值
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = '15px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillText(sec.label, sec.x, pipeTop - 20);
            ctx.fillStyle = '#38bdf8';
            ctx.fillText(`v = ${v.toFixed(0)}`, sec.x, pipeTop - 8);
            ctx.fillStyle = '#f59e0b';
            ctx.fillText(`P = ${P.toFixed(0)}`, sec.x, pipeBot + 18);

            // 速度箭头（大小表示速度）
            const arrowLen = Math.min(30, v * 0.3);
            ctx.strokeStyle = `rgba(56,189,248,0.5)`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(sec.x - arrowLen / 2, H / 2);
            ctx.lineTo(sec.x + arrowLen / 2, H / 2);
            ctx.stroke();
            ctx.fillStyle = `rgba(56,189,248,0.5)`;
            ctx.beginPath();
            ctx.moveTo(sec.x + arrowLen / 2, H / 2);
            ctx.lineTo(sec.x + arrowLen / 2 - 5, H / 2 - 3);
            ctx.lineTo(sec.x + arrowLen / 2 - 5, H / 2 + 3);
            ctx.closePath(); ctx.fill();
        }

        // 粒子
        for (const p of this._bernoulliParticles) {
            const halfH = pipeHalfAt(p.x);
            const area = halfH * 2;
            const speed = (baseArea / area) * 40;
            const norm = Math.min(speed / 120, 1);

            ctx.fillStyle = `rgba(${Math.round(56 + norm * 200)},${Math.round(189 - norm * 80)},248,${0.5 + norm * 0.3})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }

        // 方程
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '18px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText('P₁ + ½ρv₁² = P₂ + ½ρv₂²', W / 2, H - 10);
        ctx.font = '16px ' + CF.sans;
        ctx.fillText('A₁v₁ = A₂v₂  (连续性方程)', W / 2, H - 26);
    },

    _startBernoulliLoop() {
        if (!this._bernoulliRunning) return;
        if (this.paused) {
            this._bernoulliAnimId = requestAnimationFrame(() => this._startBernoulliLoop());
            return;
        }
        const now = performance.now();
        if (!this._bernoulliLastTime) this._bernoulliLastTime = now;
        const rawDt = (now - this._bernoulliLastTime) / 1000;
        this._bernoulliLastTime = now;
        const dt = Math.min(rawDt, 0.1);

        this._bernoulliT += dt;

        const { W, H } = this;
        const pipeH = H * 0.6;
        const baseArea = pipeH;
        const constrict = this._bernoulliConstrict;
        const cx = W / 2;

        const pipeHalfAt = (xPos) => {
            const t = (xPos - cx) / (W * 0.4);
            const clampT = Math.max(-1, Math.min(1, t));
            const narrowFactor = (1 + Math.cos(clampT * Math.PI)) / 2;
            return pipeH / 2 * (1 - constrict * narrowFactor);
        };

        // 生成粒子
        if (this._bernoulliT > 0.03) {
            this._bernoulliT -= 0.03;
            const halfH = pipeHalfAt(0);
            this._bernoulliParticles.push({
                x: 0,
                y: H / 2 + (Math.random() - 0.5) * halfH * 1.6
            });
        }

        // 移动粒子
        for (const p of this._bernoulliParticles) {
            const halfH = pipeHalfAt(p.x);
            const area = halfH * 2;
            const speed = (baseArea / area) * 40;
            p.x += speed * dt * 3;

            // 上下约束
            const top = H / 2 - halfH + 3;
            const bot = H / 2 + halfH - 3;
            if (p.y < top) p.y = top;
            if (p.y > bot) p.y = bot;
        }
        this._bernoulliParticles = this._bernoulliParticles.filter(p => p.x < W + 10);

        this.render();
        this._bernoulliAnimId = requestAnimationFrame(t => this._startBernoulliLoop());
    },

    // ═══════════════════════════════════════════
    // v4.6.0-α5：机翼升力（NACA 4 位翼型简化 + 上下流速对比 + 升力箭头）
    // ═══════════════════════════════════════════
    _injectAirfoilPanel() {
        const wrap = document.getElementById('fluid-controls');
        if (!wrap || document.getElementById('fluid-airfoil-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'fluid-airfoil-panel';
        panel.style.cssText = 'display:none;padding:8px 12px;background:rgba(30,41,59,.55);border-radius:8px;font-size:13px;color:#e2e8f0;';
        panel.innerHTML = `
            <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
                <div>
                    <label style="font-size:12px;color:#94a3b8">迎角 α</label>
                    <input type="range" id="fluid-attack" min="-15" max="25" step="1" value="8" style="width:110px;vertical-align:middle">
                    <span id="fluid-attack-val" style="font-size:12px;color:#cbd5e1">8°</span>
                </div>
                <div>
                    <label style="font-size:12px;color:#94a3b8">翼型厚度</label>
                    <input type="range" id="fluid-thick" min="0.05" max="0.30" step="0.01" value="0.18" style="width:90px;vertical-align:middle">
                    <span id="fluid-thick-val" style="font-size:12px;color:#cbd5e1">0.18</span>
                </div>
                <button id="fluid-air-toggle" class="btn btn--ghost" style="font-size:12px;padding:2px 12px">开始</button>
                <button id="fluid-air-reset" class="btn btn--ghost" style="font-size:12px;padding:2px 12px">重置</button>
            </div>
            <div style="margin-top:6px;color:#94a3b8;font-size:12px">上表面流速更快 → 压强更小 → 净压差产生升力 L = ½·ρ·v²·S·C_L</div>
        `;
        wrap.appendChild(panel);
        document.getElementById('fluid-attack').addEventListener('input', e => {
            this._airfoilAttack = parseFloat(e.target.value);
            document.getElementById('fluid-attack-val').textContent = this._airfoilAttack.toFixed(0) + '°';
            this.render();
        });
        document.getElementById('fluid-thick').addEventListener('input', e => {
            this._airfoilThickness = parseFloat(e.target.value);
            document.getElementById('fluid-thick-val').textContent = this._airfoilThickness.toFixed(2);
            this.render();
        });
        document.getElementById('fluid-air-toggle').addEventListener('click', () => {
            if (this._airfoilRunning) {
                this._airfoilRunning = false;
                document.getElementById('fluid-air-toggle').textContent = '开始';
            } else {
                this._airfoilRunning = true;
                document.getElementById('fluid-air-toggle').textContent = '暂停';
                this._airfoilLastTime = 0;
                this._startAirfoilLoop();
            }
        });
        document.getElementById('fluid-air-reset').addEventListener('click', () => {
            this._airfoilRunning = false;
            this._airfoilParticles = [];
            this._airfoilT = 0;
            document.getElementById('fluid-air-toggle').textContent = '开始';
            this.render();
        });
    },

    // 翼型上下表面 y 坐标（chord = 1，翼型在 [0,1] 区间，使用 NACA 00xx 简化对称型）
    // 返回相对厚度（半厚），最终绘制时按弦长缩放并旋转迎角
    _airfoilY(xRel, t) {
        // NACA 4-digit 厚度分布：5t·(0.2969√x − 0.1260x − 0.3516x² + 0.2843x³ − 0.1015x⁴)
        const x = Math.max(0, Math.min(1, xRel));
        return 5 * t * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1015 * x * x * x * x);
    },

    drawAirfoil() {
        const { ctx, W, H } = this;
        const cx = W / 2, cy = H / 2;
        const chord = Math.min(W, H) * 0.55;       // 弦长
        const t = this._airfoilThickness;
        const alpha = this._airfoilAttack * Math.PI / 180;

        // 翼型局部坐标 → 屏幕坐标（绕翼型中点旋转 −α，使来流水平 = 翼下偏 α）
        const toScreen = (xLocal, yLocal) => {
            // xLocal ∈ [0,1] 弦向；yLocal 厚度方向
            const x0 = (xLocal - 0.5) * chord;
            const y0 = yLocal * chord;
            const xr = x0 * Math.cos(-alpha) - y0 * Math.sin(-alpha);
            const yr = x0 * Math.sin(-alpha) + y0 * Math.cos(-alpha);
            return { x: cx + xr, y: cy + yr };
        };

        // 流线（条带）：上下表面附近的流线 + 远场流线
        const strands = [];
        const yLevels = [-0.45, -0.32, -0.22, -0.14, -0.08, 0.08, 0.14, 0.22, 0.32, 0.45];
        for (const yL of yLevels) strands.push(yL);

        // 简化流线：来流从左 → 在翼附近上方加速、下方减速
        // 用 sin 包络模拟翼周围速度场，仅用于视觉
        ctx.lineWidth = 1.2;
        for (const yLevel of strands) {
            ctx.beginPath();
            const samples = 80;
            for (let i = 0; i <= samples; i++) {
                const xRel = i / samples;          // 0..1 屏幕水平比
                const xLocal = xRel * 1.6 - 0.3;   // 翼弦扩展坐标 [-0.3, 1.3]
                // 距离翼影响因子：在 0..1 范围内最大
                const inWing = xLocal >= 0 && xLocal <= 1 ? 1 : Math.max(0, 1 - Math.min(Math.abs(xLocal), Math.abs(xLocal - 1)) * 3);
                // 上下偏转
                const sign = yLevel > 0 ? 1 : -1;
                const upperBoost = yLevel < 0 ? 0.18 : -0.10; // 上方流线被向上推 + 加速；下方略下推
                const yOff = yLevel + sign * inWing * 0.04 * Math.sin(Math.PI * Math.max(0, Math.min(1, xLocal))) * (1 + alpha * 2);
                const sp = toScreen(xLocal, yOff);
                if (i === 0) ctx.moveTo(sp.x, sp.y);
                else ctx.lineTo(sp.x, sp.y);
            }
            // 上方流线偏蓝（高速低压），下方偏琥珀（低速高压）
            ctx.strokeStyle = yLevel < 0 ? 'rgba(91,141,206,0.55)' : 'rgba(229,192,123,0.45)';
            ctx.stroke();
        }

        // 翼型轮廓
        ctx.beginPath();
        const N = 60;
        for (let i = 0; i <= N; i++) {
            const xL = i / N;
            const yT = this._airfoilY(xL, t);
            const sp = toScreen(xL, -yT);
            if (i === 0) ctx.moveTo(sp.x, sp.y); else ctx.lineTo(sp.x, sp.y);
        }
        for (let i = N; i >= 0; i--) {
            const xL = i / N;
            const yT = this._airfoilY(xL, t);
            const sp = toScreen(xL, yT);
            ctx.lineTo(sp.x, sp.y);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(155,141,206,0.30)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(155,141,206,0.90)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 弦线（虚线）
        ctx.save();
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const p1 = toScreen(0, 0), p2 = toScreen(1, 0);
        ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.restore();

        // 上下流速 / 压强标签
        const upperPt = toScreen(0.4, -t - 0.05);
        const lowerPt = toScreen(0.4, t + 0.05);
        ctx.font = '13px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(91,141,206,0.95)';
        ctx.fillText('v\u2191 \u00b7 P\u2193 (\u4e0a\u8868\u9762)', upperPt.x, upperPt.y);
        ctx.fillStyle = 'rgba(229,192,123,0.95)';
        ctx.fillText('v\u2193 \u00b7 P\u2191 (\u4e0b\u8868\u9762)', lowerPt.x, lowerPt.y + 12);

        // 升力箭头：从翼面中点向上（垂直来流方向）
        const liftBase = toScreen(0.4, 0);
        const liftMag = 60 + alpha * 80 + t * 100;   // 视觉化量
        const liftDirX = -Math.sin(alpha);
        const liftDirY = -Math.cos(alpha);  // 垂直弦线，指向"升力面"
        const liftEnd = { x: liftBase.x + liftDirX * liftMag, y: liftBase.y + liftDirY * liftMag };
        ctx.strokeStyle = '#5b8dce';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(liftBase.x, liftBase.y); ctx.lineTo(liftEnd.x, liftEnd.y); ctx.stroke();
        const ang = Math.atan2(liftDirY, liftDirX);
        ctx.fillStyle = '#5b8dce';
        ctx.beginPath();
        ctx.moveTo(liftEnd.x, liftEnd.y);
        ctx.lineTo(liftEnd.x - 10 * Math.cos(ang - 0.4), liftEnd.y - 10 * Math.sin(ang - 0.4));
        ctx.lineTo(liftEnd.x - 10 * Math.cos(ang + 0.4), liftEnd.y - 10 * Math.sin(ang + 0.4));
        ctx.closePath(); ctx.fill();
        ctx.font = 'bold 14px ' + CF.sans;
        ctx.fillStyle = '#5b8dce';
        ctx.textAlign = 'left';
        ctx.fillText('L \u5347\u529b', liftEnd.x + 6, liftEnd.y);

        // 来流箭头（左侧）
        const arrY = [cy - 70, cy, cy + 70];
        ctx.strokeStyle = 'rgba(148,163,184,0.6)';
        ctx.lineWidth = 1.5;
        arrY.forEach(y => {
            ctx.beginPath(); ctx.moveTo(20, y); ctx.lineTo(80, y); ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(80, y); ctx.lineTo(74, y - 4); ctx.lineTo(74, y + 4); ctx.closePath();
            ctx.fillStyle = 'rgba(148,163,184,0.6)'; ctx.fill();
        });
        ctx.fillStyle = 'rgba(148,163,184,0.85)';
        ctx.font = '13px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText('\u6765\u6d41 V\u221e', 22, cy - 78);

        // 烟流粒子
        for (const p of this._airfoilParticles) {
            const a = Math.max(0.3, 1 - p.age * 0.6);
            ctx.fillStyle = p.upper ? `rgba(91,141,206,${a})` : `rgba(229,192,123,${a * 0.85})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
            ctx.fill();
        }

        // 信息面板（右上）
        ctx.save();
        ctx.font = 'bold 15px ' + CF.sans;
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(155,141,206,0.95)';
        ctx.fillText('\u2708\ufe0f \u673a\u7ffc\u5347\u529b', W - 14, 22);
        ctx.font = '12px ' + CF.mono;
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        const liftCoef = 2 * Math.PI * alpha;   // 薄翼理论 C_L = 2πα
        const lines = [
            `\u8fce\u89d2 \u03b1 = ${this._airfoilAttack.toFixed(0)}\u00b0`,
            `\u539a\u5ea6 t/c = ${t.toFixed(2)}`,
            `C_L \u2248 2\u03c0\u03b1 = ${liftCoef.toFixed(2)}`,
            `L = \u00bd\u03c1V\u00b2\u00b7S\u00b7C_L`,
            ``,
            `\u4e0a\u8868\u9762\u8def\u957f > \u4e0b\u8868\u9762`,
            `\u2192 v\u4e0a > v\u4e0b`,
            `\u2192 P\u4e0a < P\u4e0b (\u4f2f\u52aa\u5229)`,
            `\u2192 \u51c0\u538b\u5dee\u4ea7\u751f\u5347\u529b`
        ];
        lines.forEach((ln, i) => ctx.fillText(ln, W - 14, 44 + i * 16));
        if (alpha > 18 * Math.PI / 180) {
            ctx.fillStyle = 'rgba(231,76,60,0.95)';
            ctx.fillText('\u26a0 \u8fce\u89d2\u8fc7\u5927 \u00b7 \u53ef\u80fd\u5931\u901f', W - 14, 44 + lines.length * 16 + 4);
        }
        ctx.restore();
    },

    _startAirfoilLoop() {
        if (!this._airfoilRunning) return;
        if (this.paused) {
            this._airfoilAnimId = requestAnimationFrame(() => this._startAirfoilLoop());
            return;
        }
        const now = performance.now();
        if (!this._airfoilLastTime) this._airfoilLastTime = now;
        const rawDt = (now - this._airfoilLastTime) / 1000;
        this._airfoilLastTime = now;
        const dt = Math.min(rawDt, 0.1);
        this._airfoilT += dt;

        const { W, H } = this;
        const cy = H / 2;

        // 生成粒子（左侧 entry）
        if (this._airfoilT > 0.04) {
            this._airfoilT -= 0.04;
            for (let i = 0; i < 4; i++) {
                const yOff = (Math.random() - 0.5) * H * 0.7;
                this._airfoilParticles.push({ x: 0, y: cy + yOff, age: 0, upper: yOff < 0 });
            }
        }
        // 移动 — 上方更快（×1.35），下方略慢（×0.92）
        for (const p of this._airfoilParticles) {
            const baseV = 90;
            const vx = p.upper ? baseV * 1.35 : baseV * 0.92;
            p.x += vx * dt;
            p.age += dt;
        }
        this._airfoilParticles = this._airfoilParticles.filter(p => p.x < W + 10 && p.age < 4);

        this.render();
        this._airfoilAnimId = requestAnimationFrame(() => this._startAirfoilLoop());
    },
};

function initFluidDynamics() {
    FluidSim.init();
}
