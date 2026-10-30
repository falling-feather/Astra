// ===== 动量守恒 =====
// 3 模式: 弹性碰撞 · 非弹性碰撞 · 完全非弹性碰撞
// 人教版选择性必修一 第1章

const MomentumConservation = {
    canvas: null, ctx: null, W: 0, H: 0,
    mode: 'elastic',        // 'elastic' | 'inelastic' | 'perfectly'
    dimension: '1D',        // v4.6.0-α3：'1D' | '2D'
    _listeners: [],
    _resizeObs: null,
    _raf: null,
    _running: false,
    _phase: 'ready',        // 'ready' | 'running' | 'done'

    /* ── 物理参数 ── */
    m1: 3, m2: 2,           // kg
    v1i: 4, v2i: -2,        // m/s (1D 模式：右为正)
    restitution: 0.5,       // 恢复系数 e (非弹性模式)
    v1f: 0, v2f: 0,         // 1D 碰后速度

    /* ── v4.6.0-α3：2D 物理参数 ── */
    v1x: 4, v1y: 0,         // 球 A 初速 (m/s)
    v2x: -2, v2y: 0.6,      // 球 B 初速 (m/s)
    _2d: {
        // 当前位置 (m)
        x1: 0, y1: 0, x2: 0, y2: 0,
        // 当前速度
        vx1: 0, vy1: 0, vx2: 0, vy2: 0,
        // 半径 (m)，由质量决定
        r1: 0.4, r2: 0.4,
        // 碰前/碰后总动量分量
        pxBefore: 0, pyBefore: 0, pxAfter: 0, pyAfter: 0,
        kBefore: 0, kAfter: 0,
        // 轨迹（最多 N 点）
        trail1: [], trail2: [],
        // 拖拽
        dragging: -1   // -1 / 0=A / 1=B
    },
    _trackHeight: 6,         // 2D 区高（m）

    /* ── 动画参数 ── */
    _t: 0,
    _x1: 0, _x2: 0,         // 当前 x 位置 (逻辑坐标, m)
    _v1: 0, _v2: 0,          // 当前速度
    _collided: false,
    _trackLen: 10,           // 轨道逻辑长度 (m)
    _blockW: 0.6,            // 物块宽度 (m)
    _lastTime: 0,

    /* ── 动量/动能记录 ── */
    _pBefore: { p1: 0, p2: 0, total: 0 },
    _pAfter:  { p1: 0, p2: 0, total: 0 },
    _kBefore: { k1: 0, k2: 0, total: 0 },
    _kAfter:  { k1: 0, k2: 0, total: 0 },

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    /* ═══════════════════ 生命周期 ═══════════════════ */
    init() {
        this.canvas = document.getElementById('mc-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this._resize();
        this._buildControls();
        this._injectEduPanel();

        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver(() => { this._resize(); this._draw(); });
            this._resizeObs.observe(this.canvas.parentElement);
        }
        this._reset();
    },

    destroy() {
        this._stop();
        for (const l of this._listeners) l.el.removeEventListener(l.evt, l.fn, l.opts);
        this._listeners = [];
        if (this._resizeObs) { this._resizeObs.disconnect(); this._resizeObs = null; }
        const ctrl = document.getElementById('mc-controls');
        if (ctrl) ctrl.innerHTML = '';
        const edu = document.getElementById('mc-edu');
        if (edu) edu.innerHTML = '';
    },

    /* ═══════════════════ 尺寸 ═══════════════════ */
    _resize() {
        if (window.PhysicsZoom && window.PhysicsZoom.movedCanvas === this.canvas) return;
        const wrap = this.canvas.parentElement;
        if (!wrap) return;
        const w = wrap.clientWidth;
        if (w === 0) return;
        const h = Math.min(w * 0.55, 480);
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w; this.H = h;
    },

    /* ═══════════════════ 坐标映射 ═══════════════════ */
    _trackArea() {
        const pad = 40;
        return { x: pad, y: 40, w: this.W - pad * 2, h: this.H * 0.35 };
    },
    _barArea() {
        return { x: 40, y: this.H * 0.48, w: this.W - 80, h: this.H * 0.48 };
    },
    _logicToCanvas(lx) {
        const t = this._trackArea();
        return t.x + (lx / this._trackLen) * t.w;
    },

    /* ═══════════════════ 控件 ═══════════════════ */
    _buildControls() {
        const ctrl = document.getElementById('mc-controls');
        if (!ctrl) return;

        const self = this;
        const modes = [
            { key: 'elastic',    label: '⚡ 弹性碰撞' },
            { key: 'inelastic',  label: '💥 非弹性碰撞' },
            { key: 'perfectly',  label: '🧲 完全非弹性' }
        ];

        // v4.6.0-α3：维度切换按钮组
        let html = '<div class="mc-dim-btns" role="group" aria-label="维度选择">';
        html += `<button class="mc-dim-btn${this.dimension === '1D' ? ' active' : ''}" data-dim="1D">📏 一维碰撞</button>`;
        html += `<button class="mc-dim-btn${this.dimension === '2D' ? ' active' : ''}" data-dim="2D">🎯 二维碰撞</button>`;
        html += '</div>';

        html += '<div class="mc-mode-btns" role="group" aria-label="型式选择">';
        modes.forEach(m => {
            html += `<button class="mc-mode-btn${m.key === self.mode ? ' active' : ''}" data-mode="${m.key}">${m.label}</button>`;
        });
        html += '</div>';

        html += '<div class="mc-params">';
        html += this._sliderHTML('mc-m1', '物块 A 质量 m₁', 'kg', 1, 10, this.m1, 0.5);
        html += this._sliderHTML('mc-m2', '物块 B 质量 m₂', 'kg', 1, 10, this.m2, 0.5);
        // v4.6.0-α3：1D / 2D 速度控件分组
        html += '<div id="mc-1d-velocity" class="mc-vel-group">';
        html += this._sliderHTML('mc-v1', 'A 初速度 v₁', 'm/s', -8, 8, this.v1i, 0.5);
        html += this._sliderHTML('mc-v2', 'B 初速度 v₂', 'm/s', -8, 8, this.v2i, 0.5);
        html += '</div>';
        html += '<div id="mc-2d-velocity" class="mc-vel-group">';
        html += this._sliderHTML('mc-v1x', 'A 初速度 v₁ₓ', 'm/s', -6, 6, this.v1x, 0.5);
        html += this._sliderHTML('mc-v1y', 'A 初速度 v₁ᵧ', 'm/s', -4, 4, this.v1y, 0.5);
        html += this._sliderHTML('mc-v2x', 'B 初速度 v₂ₓ', 'm/s', -6, 6, this.v2x, 0.5);
        html += this._sliderHTML('mc-v2y', 'B 初速度 v₂ᵧ', 'm/s', -4, 4, this.v2y, 0.5);
        html += '<div class="mc-2d-tip">💡 二维模式可<b>拖动</b>球设置初始位置（暂停时）</div>';
        html += '</div>';
        html += '<div class="mc-e-row" id="mc-e-row">';
        html += this._sliderHTML('mc-e', '恢复系数 e', '', 0, 1, this.restitution, 0.05);
        html += '</div>';
        html += '</div>';

        html += '<div class="mc-actions">';
        html += '<button class="mc-btn mc-play" id="mc-play-btn">▶ 开始</button>';
        html += '<button class="mc-btn mc-reset" id="mc-reset-btn">↺ 重置</button>';
        html += '</div>';

        html += '<div id="mc-info" class="mc-info"></div>';
        ctrl.innerHTML = html;

        // v4.6.0-α3：维度切换
        ctrl.querySelectorAll('.mc-dim-btn').forEach(btn => {
            this._on(btn, 'click', () => {
                self.dimension = btn.dataset.dim;
                ctrl.querySelectorAll('.mc-dim-btn').forEach(b => b.classList.toggle('active', b === btn));
                self._updateDimVisibility();
                self._reset();
            });
        });

        // 模式切换
        ctrl.querySelectorAll('.mc-mode-btn').forEach(btn => {
            this._on(btn, 'click', () => {
                self.mode = btn.dataset.mode;
                ctrl.querySelectorAll('.mc-mode-btn').forEach(b => b.classList.toggle('active', b === btn));
                self._updateERowVisibility();
                self._reset();
            });
        });

        // 滑块绑定
        const bindSlider = (id, prop, isFloat) => {
            const slider = document.getElementById(id);
            if (!slider) return;
            this._on(slider, 'input', () => {
                self[prop] = isFloat ? parseFloat(slider.value) : parseInt(slider.value);
                self._updateSliderLabel(id);
                self._reset();
            });
        };
        bindSlider('mc-m1', 'm1', true);
        bindSlider('mc-m2', 'm2', true);
        bindSlider('mc-v1', 'v1i', true);
        bindSlider('mc-v2', 'v2i', true);
        bindSlider('mc-v1x', 'v1x', true);
        bindSlider('mc-v1y', 'v1y', true);
        bindSlider('mc-v2x', 'v2x', true);
        bindSlider('mc-v2y', 'v2y', true);
        bindSlider('mc-e', 'restitution', true);

        // 播放/重置
        const playBtn = document.getElementById('mc-play-btn');
        const resetBtn = document.getElementById('mc-reset-btn');
        this._on(playBtn, 'click', () => {
            if (self._phase === 'done') self._reset();
            if (self._phase === 'ready') self._start();
            else if (self._running) self._pause();
            else self._resume();
        });
        this._on(resetBtn, 'click', () => self._reset());

        // v4.6.0-α3：2D 球体拖拽
        this._bindCanvasDrag();

        this._updateDimVisibility();
        this._updateERowVisibility();
    },

    _updateSliderLabel(id) {
        const slider = document.getElementById(id);
        const lbl = document.getElementById(id + '-lbl');
        if (!slider || !lbl) return;
        const map = {
            'mc-m1':  ['物块 A 质量 m₁', 'kg'],
            'mc-m2':  ['物块 B 质量 m₂', 'kg'],
            'mc-v1':  ['A 初速度 v₁', 'm/s'],
            'mc-v2':  ['B 初速度 v₂', 'm/s'],
            'mc-v1x': ['A 初速度 v₁ₓ', 'm/s'],
            'mc-v1y': ['A 初速度 v₁ᵧ', 'm/s'],
            'mc-v2x': ['B 初速度 v₂ₓ', 'm/s'],
            'mc-v2y': ['B 初速度 v₂ᵧ', 'm/s'],
            'mc-e':   ['恢复系数 e', '']
        };
        const [name, unit] = map[id] || ['', ''];
        const v = parseFloat(slider.value);
        lbl.innerHTML = `${name} = <strong>${unit ? v + ' ' + unit : v}</strong>`;
    },

    _updateDimVisibility() {
        const v1d = document.getElementById('mc-1d-velocity');
        const v2d = document.getElementById('mc-2d-velocity');
        if (v1d) v1d.style.display = this.dimension === '1D' ? '' : 'none';
        if (v2d) v2d.style.display = this.dimension === '2D' ? '' : 'none';
    },

    _sliderHTML(id, label, unit, min, max, val, step) {
        const display = unit ? `${val} ${unit}` : val;
        return `<div class="mc-slider-row">
            <label class="mc-label" id="${id}-lbl">${label} = <strong>${display}</strong></label>
            <input type="range" id="${id}" class="mc-slider" min="${min}" max="${max}" value="${val}" step="${step}">
        </div>`;
    },

    _updateERowVisibility() {
        const row = document.getElementById('mc-e-row');
        if (row) row.style.display = this.mode === 'inelastic' ? '' : 'none';
    },

    /* ═══════════════════ 物理计算 ═══════════════════ */
    _calcPostCollision() {
        const { m1, m2, v1i, v2i, mode, restitution } = this;
        let v1f, v2f, e;

        if (mode === 'elastic') {
            e = 1;
        } else if (mode === 'perfectly') {
            e = 0;
        } else {
            e = restitution;
        }

        // 一般公式  v1' = ((m1 - e·m2)v1 + (1+e)m2·v2) / (m1+m2)
        //           v2' = ((m2 - e·m1)v2 + (1+e)m1·v1) / (m1+m2)
        const M = m1 + m2;
        v1f = ((m1 - e * m2) * v1i + (1 + e) * m2 * v2i) / M;
        v2f = ((m2 - e * m1) * v2i + (1 + e) * m1 * v1i) / M;

        this.v1f = v1f;
        this.v2f = v2f;

        this._pBefore = { p1: m1 * v1i, p2: m2 * v2i, total: m1 * v1i + m2 * v2i };
        this._pAfter  = { p1: m1 * v1f, p2: m2 * v2f, total: m1 * v1f + m2 * v2f };
        this._kBefore = { k1: 0.5 * m1 * v1i * v1i, k2: 0.5 * m2 * v2i * v2i, total: 0.5 * m1 * v1i * v1i + 0.5 * m2 * v2i * v2i };
        this._kAfter  = { k1: 0.5 * m1 * v1f * v1f, k2: 0.5 * m2 * v2f * v2f, total: 0.5 * m1 * v1f * v1f + 0.5 * m2 * v2f * v2f };
    },

    // v4.6.0-α3：2D 模式恢复系数选择
    _modeE() {
        if (this.mode === 'elastic') return 1;
        if (this.mode === 'perfectly') return 0;
        return this.restitution;
    },

    // v4.6.0-α3：2D 圆球碰撞（沿连心线方向应用 e，切向不变）
    _collide2D() {
        const d = this._2d;
        const dx = d.x2 - d.x1, dy = d.y2 - d.y1;
        const dist = Math.hypot(dx, dy) || 1e-6;
        const nx = dx / dist, ny = dy / dist;     // 单位法向（A→B）
        // 法向速度
        const v1n = d.vx1 * nx + d.vy1 * ny;
        const v2n = d.vx2 * nx + d.vy2 * ny;
        if (v1n - v2n <= 0) return false;          // 已经在分离，不碰
        const e = this._modeE();
        const M = this.m1 + this.m2;
        const v1nF = ((this.m1 - e * this.m2) * v1n + (1 + e) * this.m2 * v2n) / M;
        const v2nF = ((this.m2 - e * this.m1) * v2n + (1 + e) * this.m1 * v1n) / M;
        // 切向不变 → 速度更新只改法向分量
        d.vx1 += (v1nF - v1n) * nx;
        d.vy1 += (v1nF - v1n) * ny;
        d.vx2 += (v2nF - v2n) * nx;
        d.vy2 += (v2nF - v2n) * ny;
        // 修正穿透：把两球分离到相切
        const overlap = (d.r1 + d.r2) - dist;
        if (overlap > 0) {
            d.x1 -= nx * overlap * 0.5;
            d.y1 -= ny * overlap * 0.5;
            d.x2 += nx * overlap * 0.5;
            d.y2 += ny * overlap * 0.5;
        }
        return true;
    },

    /* ═══════════════════ 动画控制 ═══════════════════ */
    _reset() {
        this._stop();
        this._phase = 'ready';
        this._collided = false;
        this._t = 0;
        if (this.dimension === '2D') {
            // v4.6.0-α3：2D 初始化
            const d = this._2d;
            d.r1 = 0.25 + 0.06 * this.m1;   // 半径随质量微增（视觉提示）
            d.r2 = 0.25 + 0.06 * this.m2;
            // 保留拖拽过的位置；初次或越界时归位
            const inX = (x) => x > 0.5 && x < this._trackLen - 0.5;
            const inY = (y) => y > 0.5 && y < this._trackHeight - 0.5;
            if (!inX(d.x1) || !inY(d.y1)) { d.x1 = 1.8; d.y1 = this._trackHeight * 0.5; }
            if (!inX(d.x2) || !inY(d.y2)) { d.x2 = 8.2; d.y2 = this._trackHeight * 0.5 + 0.6; }
            d.vx1 = this.v1x; d.vy1 = this.v1y;
            d.vx2 = this.v2x; d.vy2 = this.v2y;
            d.trail1 = []; d.trail2 = [];
            // 碰前总动量/动能
            d.pxBefore = this.m1 * this.v1x + this.m2 * this.v2x;
            d.pyBefore = this.m1 * this.v1y + this.m2 * this.v2y;
            d.kBefore = 0.5 * this.m1 * (this.v1x ** 2 + this.v1y ** 2)
                      + 0.5 * this.m2 * (this.v2x ** 2 + this.v2y ** 2);
            d.pxAfter = d.pxBefore; d.pyAfter = d.pyBefore;  // 守恒——尚未碰
            d.kAfter = d.kBefore;
            d.dragging = -1;
            // 兼容信息面板：把 1D 用的统计字段也填上等价值
            this._pBefore = { p1: this.m1 * this.v1x, p2: this.m2 * this.v2x, total: d.pxBefore };
            this._pAfter  = { ...this._pBefore };
            this._kBefore = { k1: 0.5 * this.m1 * (this.v1x ** 2 + this.v1y ** 2),
                              k2: 0.5 * this.m2 * (this.v2x ** 2 + this.v2y ** 2),
                              total: d.kBefore };
            this._kAfter = { ...this._kBefore };
        } else {
            // 1D
            this._x1 = this._trackLen * 0.3;
            this._x2 = this._trackLen * 0.7;
            this._v1 = this.v1i;
            this._v2 = this.v2i;
            this._calcPostCollision();
        }
        this._updateInfo();
        this._draw();
        const btn = document.getElementById('mc-play-btn');
        if (btn) btn.textContent = '▶ 开始';
    },

    _start() {
        this._phase = 'running';
        this._running = true;
        this._lastTime = performance.now();
        const btn = document.getElementById('mc-play-btn');
        if (btn) btn.textContent = '⏸ 暂停';
        this._tick();
    },

    _pause() {
        this._running = false;
        const btn = document.getElementById('mc-play-btn');
        if (btn) btn.textContent = '▶ 继续';
    },

    _resume() {
        this._running = true;
        this._lastTime = performance.now();
        const btn = document.getElementById('mc-play-btn');
        if (btn) btn.textContent = '⏸ 暂停';
        this._tick();
    },

    _stop() {
        this._running = false;
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    },

    _tick() {
        if (!this._running) return;
        const now = performance.now();
        const dt = Math.min((now - this._lastTime) / 1000, 0.05); // cap dt
        this._lastTime = now;

        if (this.dimension === '2D') {
            // v4.6.0-α3：2D tick
            const d = this._2d;
            d.x1 += d.vx1 * dt; d.y1 += d.vy1 * dt;
            d.x2 += d.vx2 * dt; d.y2 += d.vy2 * dt;
            // 碰撞检测
            const dx = d.x2 - d.x1, dy = d.y2 - d.y1;
            const dist = Math.hypot(dx, dy);
            if (!this._collided && dist <= d.r1 + d.r2) {
                if (this._collide2D()) {
                    this._collided = true;
                    // 记录碰后总动量/能量
                    d.pxAfter = this.m1 * d.vx1 + this.m2 * d.vx2;
                    d.pyAfter = this.m1 * d.vy1 + this.m2 * d.vy2;
                    d.kAfter = 0.5 * this.m1 * (d.vx1 ** 2 + d.vy1 ** 2)
                             + 0.5 * this.m2 * (d.vx2 ** 2 + d.vy2 ** 2);
                    // 同步 1D 风格字段以更新教学面板
                    this._pAfter = { p1: this.m1 * d.vx1, p2: this.m2 * d.vx2, total: d.pxAfter };
                    this._kAfter = { k1: 0.5 * this.m1 * (d.vx1 ** 2 + d.vy1 ** 2),
                                     k2: 0.5 * this.m2 * (d.vx2 ** 2 + d.vy2 ** 2),
                                     total: d.kAfter };
                    this._updateInfo();
                }
            }
            // 轨迹（≤ 80 点）
            d.trail1.push([d.x1, d.y1]);
            d.trail2.push([d.x2, d.y2]);
            if (d.trail1.length > 80) d.trail1.shift();
            if (d.trail2.length > 80) d.trail2.shift();
            // 边界检测：碰后任一球出界即结束
            if (this._collided) {
                const out = (x, y, r) => x < -r || x > this._trackLen + r || y < -r || y > this._trackHeight + r;
                if (out(d.x1, d.y1, d.r1) || out(d.x2, d.y2, d.r2)) {
                    this._phase = 'done';
                    this._stop();
                    const btn = document.getElementById('mc-play-btn');
                    if (btn) btn.textContent = '↺ 重来';
                    this._draw();
                    return;
                }
            }
            this._draw();
            this._raf = requestAnimationFrame(() => this._tick());
            return;
        }

        // 1D
        this._x1 += this._v1 * dt;
        this._x2 += this._v2 * dt;

        // 碰撞检测
        if (!this._collided) {
            const gap = this._x2 - this._x1 - this._blockW;
            if (gap <= 0) {
                this._collided = true;
                // 修正穿透
                const overlap = -gap;
                this._x1 -= overlap * 0.5;
                this._x2 += overlap * 0.5;
                // 应用碰后速度
                this._v1 = this.v1f;
                this._v2 = this.v2f;
            }
        }

        // 边界检测 - 碰撞后物块超出轨道范围则结束
        if (this._collided) {
            const outLeft = this._x1 < -0.5 || this._x2 < -0.5;
            const outRight = this._x1 + this._blockW > this._trackLen + 0.5 || this._x2 + this._blockW > this._trackLen + 0.5;
            if (outLeft || outRight) {
                this._phase = 'done';
                this._stop();
                const btn = document.getElementById('mc-play-btn');
                if (btn) btn.textContent = '↺ 重来';
                this._draw();
                return;
            }
        }

        this._draw();
        this._raf = requestAnimationFrame(() => this._tick());
    },

    /* ═══════════════════ 信息面板 ═══════════════════ */
    _updateInfo() {
        const info = document.getElementById('mc-info');
        if (!info) return;
        const { m1, m2, _pBefore: pb, _pAfter: pa, _kBefore: kb, _kAfter: ka } = this;
        const modeLabel = { elastic: '弹性碰撞', inelastic: '非弹性碰撞', perfectly: '完全非弹性碰撞' }[this.mode];
        const dimLabel = this.dimension === '2D' ? '二维' : '一维';
        const kLoss = kb.total - ka.total;
        const kLossPct = kb.total > 0 ? (kLoss / kb.total * 100).toFixed(1) : '0';

        if (this.dimension === '2D') {
            const d = this._2d;
            const pBeforeMag = Math.hypot(d.pxBefore, d.pyBefore);
            const pAfterMag = Math.hypot(d.pxAfter, d.pyAfter);
            const dpx = Math.abs(d.pxAfter - d.pxBefore);
            const dpy = Math.abs(d.pyAfter - d.pyBefore);
            const cons = (dpx + dpy) < 0.05;
            info.innerHTML = `
                <div class="mc-mode-tag">${dimLabel} · ${modeLabel}</div>
                <div class="mc-data-row"><span>碰前 A：</span> v₁ = (<strong>${this.v1x.toFixed(1)}</strong>, <strong>${this.v1y.toFixed(1)}</strong>) m/s</div>
                <div class="mc-data-row"><span>碰前 B：</span> v₂ = (<strong>${this.v2x.toFixed(1)}</strong>, <strong>${this.v2y.toFixed(1)}</strong>) m/s</div>
                <div class="mc-data-row"><span>碰后 A：</span> v₁' = (<strong>${d.vx1.toFixed(2)}</strong>, <strong>${d.vy1.toFixed(2)}</strong>) m/s</div>
                <div class="mc-data-row"><span>碰后 B：</span> v₂' = (<strong>${d.vx2.toFixed(2)}</strong>, <strong>${d.vy2.toFixed(2)}</strong>) m/s</div>
                <div class="mc-data-row mc-momentum">动量守恒：Σpₓ = <strong>${d.pxBefore.toFixed(1)}</strong>→<strong>${d.pxAfter.toFixed(1)}</strong>，Σpᵧ = <strong>${d.pyBefore.toFixed(1)}</strong>→<strong>${d.pyAfter.toFixed(1)}</strong>（|p| ${pBeforeMag.toFixed(1)}→${pAfterMag.toFixed(1)} kg·m/s${cons ? ' ✓' : ''}）</div>
                <div class="mc-data-row mc-energy">动能损失：ΔEk = <strong>${kLoss.toFixed(1)}</strong> J（${kLossPct}%）</div>`;
            return;
        }
        info.innerHTML = `
            <div class="mc-mode-tag">${dimLabel} · ${modeLabel}</div>
            <div class="mc-data-row"><span>碰前：</span> v₁ = <strong>${this.v1i}</strong> m/s，v₂ = <strong>${this.v2i}</strong> m/s</div>
            <div class="mc-data-row"><span>碰后：</span> v₁' = <strong>${this.v1f.toFixed(2)}</strong> m/s，v₂' = <strong>${this.v2f.toFixed(2)}</strong> m/s</div>
            <div class="mc-data-row mc-momentum">动量守恒：p = m₁v₁+m₂v₂ = <strong>${pb.total.toFixed(1)}</strong> kg·m/s（碰前=碰后）</div>
            <div class="mc-data-row mc-energy">动能损失：ΔEk = <strong>${kLoss.toFixed(1)}</strong> J（${kLossPct}%）</div>`;
    },

    /* ═══════════════════ 绘图 ═══════════════════ */
    _draw() {
        const { ctx, W, H } = this;
        if (!ctx) return;
        ctx.clearRect(0, 0, W, H);

        if (this.dimension === '2D') {
            this._drawArena2D();
            this._drawBalls2D();
            this._drawBarCharts();
            return;
        }

        this._drawTrack();
        this._drawBlocks();
        this._drawVelocityArrows();
        this._drawBarCharts();
    },

    /* ── v4.6.0-α3：2D 绘制 ── */
    _2dArea() {
        const pad = 40;
        return { x: pad, y: 30, w: this.W - pad * 2, h: this.H * 0.5 };
    },
    _logicX2D(lx) { const a = this._2dArea(); return a.x + (lx / this._trackLen) * a.w; },
    _logicY2D(ly) { const a = this._2dArea(); return a.y + (ly / this._trackHeight) * a.h; },
    _scaleR2D(r)  { const a = this._2dArea(); return (r / this._trackLen) * a.w; },

    _drawArena2D() {
        const { ctx } = this;
        const a = this._2dArea();
        ctx.save();
        // 边框
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        ctx.strokeRect(a.x, a.y, a.w, a.h);
        // 网格
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        for (let i = 1; i < this._trackLen; i++) {
            const cx = this._logicX2D(i);
            ctx.beginPath(); ctx.moveTo(cx, a.y); ctx.lineTo(cx, a.y + a.h); ctx.stroke();
        }
        for (let j = 1; j < this._trackHeight; j++) {
            const cy = this._logicY2D(j);
            ctx.beginPath(); ctx.moveTo(a.x, cy); ctx.lineTo(a.x + a.w, cy); ctx.stroke();
        }
        // 标签
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '11px ' + CF.sans;
        ctx.fillText('x↗ (m)', a.x + a.w - 40, a.y + a.h - 4);
        ctx.save();
        ctx.translate(a.x + 4, a.y + 12); ctx.fillText('y↘', 0, 0);
        ctx.restore();
        ctx.restore();
    },

    _drawBalls2D() {
        const { ctx } = this;
        const d = this._2d;
        // 轨迹
        const drawTrail = (pts, color) => {
            if (pts.length < 2) return;
            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            for (let i = 0; i < pts.length; i++) {
                const px = this._logicX2D(pts[i][0]);
                const py = this._logicY2D(pts[i][1]);
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.globalAlpha = 0.35;
            ctx.stroke();
            ctx.restore();
        };
        drawTrail(d.trail1, '#6495ED');
        drawTrail(d.trail2, '#EB5757');

        // 球
        const drawBall = (cx, cy, r, fill, stroke, label, mass) => {
            ctx.save();
            ctx.fillStyle = fill;
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 13px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, cx, cy - 5);
            ctx.font = '11px ' + CF.sans;
            ctx.fillText(mass + 'kg', cx, cy + 9);
            ctx.restore();
        };
        const cx1 = this._logicX2D(d.x1), cy1 = this._logicY2D(d.y1);
        const cx2 = this._logicX2D(d.x2), cy2 = this._logicY2D(d.y2);
        const r1px = this._scaleR2D(d.r1), r2px = this._scaleR2D(d.r2);
        drawBall(cx1, cy1, r1px, 'rgba(100,149,237,0.85)', '#6495ED', 'A', this.m1);
        drawBall(cx2, cy2, r2px, 'rgba(235,87,87,0.85)', '#EB5757', 'B', this.m2);

        // 速度箭头（按速度大小自适应）
        const arrowScale = this._scaleR2D(0.35);   // 1 m/s = 0.35m 长度
        if (Math.hypot(d.vx1, d.vy1) > 0.05) {
            this._drawArrow(ctx, cx1, cy1, cx1 + d.vx1 * arrowScale, cy1 + d.vy1 * arrowScale, '#6495ED', 2);
        }
        if (Math.hypot(d.vx2, d.vy2) > 0.05) {
            this._drawArrow(ctx, cx2, cy2, cx2 + d.vx2 * arrowScale, cy2 + d.vy2 * arrowScale, '#EB5757', 2);
        }
        // 拖拽提示
        if (this._phase === 'ready') {
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.font = '11px ' + CF.sans;
            ctx.textAlign = 'center';
            const a = this._2dArea();
            ctx.fillText('🖱 可拖动小球到任意位置（仅在「开始」前）', a.x + a.w / 2, a.y - 8);
            ctx.restore();
        }
    },

    // v4.6.0-α3：2D 球体拖拽绑定
    _bindCanvasDrag() {
        const c = this.canvas;
        if (!c) return;
        const self = this;
        const pickBall = (ex, ey) => {
            if (self.dimension !== '2D' || self._phase !== 'ready') return -1;
            const rect = c.getBoundingClientRect();
            const px = (ex - rect.left), py = (ey - rect.top);
            const d = self._2d;
            const cx1 = self._logicX2D(d.x1), cy1 = self._logicY2D(d.y1);
            const cx2 = self._logicX2D(d.x2), cy2 = self._logicY2D(d.y2);
            const r1 = self._scaleR2D(d.r1) + 4;
            const r2 = self._scaleR2D(d.r2) + 4;
            const d1 = Math.hypot(px - cx1, py - cy1);
            const d2 = Math.hypot(px - cx2, py - cy2);
            if (d1 < r1 && d1 < d2) return 0;
            if (d2 < r2) return 1;
            return -1;
        };
        const moveBall = (idx, ex, ey) => {
            const a = self._2dArea();
            const rect = c.getBoundingClientRect();
            const px = (ex - rect.left), py = (ey - rect.top);
            // 转换回逻辑坐标
            const lx = ((px - a.x) / a.w) * self._trackLen;
            const ly = ((py - a.y) / a.h) * self._trackHeight;
            const d = self._2d;
            const r = idx === 0 ? d.r1 : d.r2;
            const clampX = Math.max(r, Math.min(self._trackLen - r, lx));
            const clampY = Math.max(r, Math.min(self._trackHeight - r, ly));
            if (idx === 0) { d.x1 = clampX; d.y1 = clampY; }
            else { d.x2 = clampX; d.y2 = clampY; }
            self._draw();
        };
        this._on(c, 'mousedown', (e) => {
            const i = pickBall(e.clientX, e.clientY);
            if (i >= 0) { self._2d.dragging = i; e.preventDefault(); }
        });
        this._on(window, 'mousemove', (e) => {
            if (self._2d.dragging >= 0) moveBall(self._2d.dragging, e.clientX, e.clientY);
        });
        this._on(window, 'mouseup', () => { self._2d.dragging = -1; });
        // touch
        this._on(c, 'touchstart', (e) => {
            const t = e.touches[0]; if (!t) return;
            const i = pickBall(t.clientX, t.clientY);
            if (i >= 0) { self._2d.dragging = i; e.preventDefault(); }
        }, { passive: false });
        this._on(window, 'touchmove', (e) => {
            if (self._2d.dragging < 0) return;
            const t = e.touches[0]; if (!t) return;
            moveBall(self._2d.dragging, t.clientX, t.clientY);
        }, { passive: true });
        this._on(window, 'touchend', () => { self._2d.dragging = -1; });
    },

    _drawTrack() {
        const { ctx } = this;
        const t = this._trackArea();
        const trackY = t.y + t.h;

        // 轨道线
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(t.x, trackY);
        ctx.lineTo(t.x + t.w, trackY);
        ctx.stroke();

        // 刻度
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '12px ' + CF.sans;
        ctx.textAlign = 'center';
        for (let i = 0; i <= this._trackLen; i += 2) {
            const cx = this._logicToCanvas(i);
            ctx.beginPath();
            ctx.moveTo(cx, trackY);
            ctx.lineTo(cx, trackY + 6);
            ctx.stroke();
            ctx.fillText(i + 'm', cx, trackY + 16);
        }
        ctx.restore();
    },

    _drawBlocks() {
        const { ctx } = this;
        const t = this._trackArea();
        const trackY = t.y + t.h;

        // 物块尺寸（根据质量缩放）
        const bw1 = this._blockW / this._trackLen * t.w;
        const bw2 = this._blockW / this._trackLen * t.w;
        const baseH = t.h * 0.5;
        const bh1 = baseH * (0.6 + 0.4 * this.m1 / 10);
        const bh2 = baseH * (0.6 + 0.4 * this.m2 / 10);

        const cx1 = this._logicToCanvas(this._x1);
        const cx2 = this._logicToCanvas(this._x2);

        // 物块 A (蓝色)
        ctx.save();
        ctx.fillStyle = 'rgba(100, 149, 237, 0.85)';
        ctx.strokeStyle = '#6495ED';
        ctx.lineWidth = 2;
        const r = 4;
        this._roundRect(ctx, cx1, trackY - bh1, bw1, bh1, r);
        ctx.fill();
        ctx.stroke();
        // 标签
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 13px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('A', cx1 + bw1 / 2, trackY - bh1 / 2 - 7);
        ctx.font = '12px ' + CF.sans;
        ctx.fillText(this.m1 + 'kg', cx1 + bw1 / 2, trackY - bh1 / 2 + 9);
        ctx.restore();

        // 物块 B (红色)
        ctx.save();
        ctx.fillStyle = 'rgba(235, 87, 87, 0.85)';
        ctx.strokeStyle = '#EB5757';
        ctx.lineWidth = 2;
        this._roundRect(ctx, cx2, trackY - bh2, bw2, bh2, r);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 13px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('B', cx2 + bw2 / 2, trackY - bh2 / 2 - 7);
        ctx.font = '12px ' + CF.sans;
        ctx.fillText(this.m2 + 'kg', cx2 + bw2 / 2, trackY - bh2 / 2 + 9);
        ctx.restore();
    },

    _drawVelocityArrows() {
        const { ctx } = this;
        const t = this._trackArea();
        const trackY = t.y + t.h;
        const bw = this._blockW / this._trackLen * t.w;
        const arrowScale = t.w / this._trackLen * 0.12;
        const arrowY = t.y + 12;

        // A 的速度箭头
        const cx1 = this._logicToCanvas(this._x1) + bw / 2;
        if (Math.abs(this._v1) > 0.01) {
            this._drawArrow(ctx, cx1, arrowY, cx1 + this._v1 * arrowScale, arrowY, '#6495ED', 2);
            ctx.save();
            ctx.fillStyle = '#6495ED';
            ctx.font = '12px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.fillText(`v₁=${this._v1.toFixed(1)}`, cx1 + this._v1 * arrowScale * 0.5, arrowY - 10);
            ctx.restore();
        }

        // B 的速度箭头
        const cx2 = this._logicToCanvas(this._x2) + bw / 2;
        if (Math.abs(this._v2) > 0.01) {
            this._drawArrow(ctx, cx2, arrowY, cx2 + this._v2 * arrowScale, arrowY, '#EB5757', 2);
            ctx.save();
            ctx.fillStyle = '#EB5757';
            ctx.font = '12px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.fillText(`v₂=${this._v2.toFixed(1)}`, cx2 + this._v2 * arrowScale * 0.5, arrowY - 10);
            ctx.restore();
        }
    },

    _drawBarCharts() {
        const { ctx, _pBefore: pb, _pAfter: pa, _kBefore: kb, _kAfter: ka } = this;
        const area = this._barArea();
        const midX = area.x + area.w * 0.5;
        const leftW = area.w * 0.45;
        const rightW = area.w * 0.45;

        // 标题
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = 'bold 12px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('动量 p (kg·m/s)', area.x + leftW * 0.5, area.y);
        ctx.fillText('动能 Ek (J)', midX + rightW * 0.5 + 20, area.y);
        ctx.restore();

        // 动量柱状图
        const pMax = Math.max(Math.abs(pb.p1), Math.abs(pb.p2), Math.abs(pb.total), Math.abs(pa.p1), Math.abs(pa.p2), Math.abs(pa.total), 1);
        this._drawBarGroup(area.x, area.y + 16, leftW, area.h - 20, [
            { label: 'p₁ 碰前', value: pb.p1, color: '#6495ED' },
            { label: 'p₂ 碰前', value: pb.p2, color: '#EB5757' },
            { label: '∑p 碰前', value: pb.total, color: '#2ED573' },
            { label: 'p₁ 碰后', value: pa.p1, color: '#6495ED88' },
            { label: 'p₂ 碰后', value: pa.p2, color: '#EB575788' },
            { label: '∑p 碰后', value: pa.total, color: '#2ED57388' }
        ], pMax);

        // 动能柱状图
        const kMax = Math.max(kb.k1, kb.k2, kb.total, ka.k1, ka.k2, ka.total, 1);
        this._drawBarGroup(midX + 20, area.y + 16, rightW, area.h - 20, [
            { label: 'Ek₁ 碰前', value: kb.k1, color: '#6495ED' },
            { label: 'Ek₂ 碰前', value: kb.k2, color: '#EB5757' },
            { label: '∑Ek 碰前', value: kb.total, color: '#FFD93D' },
            { label: 'Ek₁ 碰后', value: ka.k1, color: '#6495ED88' },
            { label: 'Ek₂ 碰后', value: ka.k2, color: '#EB575788' },
            { label: '∑Ek 碰后', value: ka.total, color: '#FFD93D88' }
        ], kMax);
    },

    _drawBarGroup(x, y, w, h, bars, maxVal) {
        const { ctx } = this;
        const n = bars.length;
        const barW = Math.min(w / n * 0.7, 28);
        const gap = (w - barW * n) / (n + 1);
        const baseY = y + h * 0.6; // 零线 (允许负值)
        const scaleH = h * 0.5;

        // 零线
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, baseY);
        ctx.lineTo(x + w, baseY);
        ctx.stroke();

        bars.forEach((bar, i) => {
            const bx = x + gap + i * (barW + gap);
            const barH = (bar.value / maxVal) * scaleH;

            // 柱
            ctx.fillStyle = bar.color;
            if (barH >= 0) {
                this._roundRect(ctx, bx, baseY - barH, barW, barH, 2);
            } else {
                this._roundRect(ctx, bx, baseY, barW, -barH, 2);
            }
            ctx.fill();

            // 数值
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            ctx.font = '12px ' + CF.sans;
            ctx.textAlign = 'center';
            const valY = barH >= 0 ? baseY - barH - 4 : baseY - barH + 10;
            ctx.fillText(bar.value.toFixed(1), bx + barW / 2, valY);

            // 标签
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = '12px ' + CF.sans;
            ctx.save();
            ctx.translate(bx + barW / 2, baseY + 8);
            ctx.rotate(-Math.PI / 6);
            ctx.textAlign = 'right';
            ctx.fillText(bar.label, 0, 0);
            ctx.restore();
        });
        ctx.restore();
    },

    /* ═══════════════════ 绘图工具 ═══════════════════ */
    _drawArrow(ctx, x1, y1, x2, y2, color, lineW) {
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len < 2) return;
        const headLen = Math.min(10, len * 0.3);
        const angle = Math.atan2(y2 - y1, x2 - x1);

        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = lineW;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2 - headLen * Math.cos(angle), y2 - headLen * Math.sin(angle));
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - headLen * Math.cos(angle - 0.35), y2 - headLen * Math.sin(angle - 0.35));
        ctx.lineTo(x2 - headLen * Math.cos(angle + 0.35), y2 - headLen * Math.sin(angle + 0.35));
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    },

    _roundRect(ctx, x, y, w, h, r) {
        if (w < 0) { x += w; w = -w; }
        if (h < 0) { y += h; h = -h; }
        r = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    },

    /* ═══════════════════ 教育面板 ═══════════════════ */
    _injectEduPanel() {
        const edu = document.getElementById('mc-edu');
        if (!edu) return;
        edu.innerHTML = `
            <h4>📚 动量守恒定律</h4>
            <p>一个系统不受外力（或所受合外力为零）时，系统总动量守恒：</p>
            <p class="mc-formula">m₁v₁ + m₂v₂ = m₁v₁' + m₂v₂'</p>
            <ul>
                <li><strong>弹性碰撞</strong>（e = 1）：动量、动能均守恒。v₁' = [(m₁−m₂)v₁ + 2m₂v₂]/(m₁+m₂)</li>
                <li><strong>完全非弹性碰撞</strong>（e = 0）：两物体碰后粘合，共速 v' = (m₁v₁+m₂v₂)/(m₁+m₂)，动能损失最大</li>
                <li><strong>非弹性碰撞</strong>（0 < e < 1）：恢复系数 e = |v₂'−v₁'| / |v₁−v₂|</li>
            </ul>
            <p class="mc-tip">💡 调整质量和速度，观察碰前碰后动量守恒与动能变化</p>`;
    }
};

window.MomentumConservation = MomentumConservation;

function initMomentumConservation() {
    MomentumConservation.init();
}
window.initMomentumConservation = initMomentumConservation;
