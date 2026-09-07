// ===== 带电粒子运动 =====
// 3 模式: 洛伦兹力偏转 · 质谱仪 · 速度选择器
// 人教版必修三 第3章 / 选择性必修二

const ChargedParticle = {
    canvas: null, ctx: null, W: 0, H: 0,
    mode: 'lorentz',        // 'lorentz' | 'spectrometer' | 'selector'
    _listeners: [],
    _resizeObs: null,
    _raf: null,
    _running: false,
    _phase: 'ready',        // 'ready' | 'running' | 'done'

    /* ── 物理参数 ── */
    q: 2, m: 3, v0: 4, B: 1.0,  // 洛伦兹 (归一化单位)
    accV: 500,                     // 质谱仪加速电压
    E: 5,                          // 速度选择器电场
    _lastTime: 0,
    _simTime: 0,

    /* ── 粒子数据 ── */
    _particles: [],
    // { x, y, vx, vy, trail:[], color, label, active, elapsed, cx?, cy?, rPx?, omega?, startAngle? }

    /* ── 常量 ── */
    _COL: {
        fieldBg: 'rgba(70,130,220,0.06)',
        fieldSym: 'rgba(100,150,255,0.22)',
        particle: ['#ff6b6b', '#4ecdc4', '#ffd93d', '#b8e986', '#dda0dd'],
        velocity: '#4ecdc4',
        force: '#ffd93d',
        radius: 'rgba(255,255,255,0.2)',
        text: '#e0e0e0',
        dim: '#888',
        accent: '#6c9ce8',
        platePlus: '#ff6b6b',
        plateMinus: '#4ecdc4',
        eArrow: 'rgba(255,159,67,0.45)',
        detector: '#43b581',
    },

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    /* ═══════════════════ 生命周期 ═══════════════════ */
    init() {
        this.canvas = document.getElementById('cp-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this._resize();
        this._buildControls();
        this._injectEduPanel();
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver(() => { this._resize(); if (this._phase === 'ready') this._draw(); });
            this._resizeObs.observe(this.canvas.parentElement);
        }
        this._reset();
    },

    destroy() {
        this._stop();
        for (const l of this._listeners) l.el.removeEventListener(l.evt, l.fn, l.opts);
        this._listeners = [];
        if (this._resizeObs) { this._resizeObs.disconnect(); this._resizeObs = null; }
        const ctrl = document.getElementById('cp-controls');
        if (ctrl) ctrl.innerHTML = '';
        const edu = document.getElementById('cp-edu');
        if (edu) edu.innerHTML = '';
    },

    /* ═══════════════════ 尺寸 ═══════════════════ */
    _resize() {
        if (window.PhysicsZoom && window.PhysicsZoom.movedCanvas === this.canvas) return;
        const wrap = this.canvas.parentElement;
        if (!wrap) return;
        const w = wrap.clientWidth;
        if (w === 0) return;
        const h = Math.min(w * 0.6, 520);
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w; this.H = h;
    },

    /* ═══════════════════ 像素缩放 ═══════════════════ */
    _scale() {
        return Math.min(this.W, this.H) * 0.065;
    },

    /* ═══════════════════ 控件 ═══════════════════ */
    _buildControls() {
        const ctrl = document.getElementById('cp-controls');
        if (!ctrl) return;

        const modes = [
            { key: 'lorentz',      label: '⚡ 洛伦兹力偏转' },
            { key: 'spectrometer', label: '🔬 质谱仪' },
            { key: 'selector',     label: '🎯 速度选择器' },
        ];

        let h = '<fieldset class="cp-mode-btns" role="group" aria-label="模式选择">';
        modes.forEach(m => {
            h += `<button class="cp-mode-btn${m.key === this.mode ? ' active' : ''}" data-mode="${m.key}">${m.label}</button>`;
        });
        h += '</fieldset><div class="cp-params" id="cp-params"></div>';
        h += '<div class="cp-actions">';
        h += '  <button class="cp-btn cp-play" id="cp-play">▶ 开始</button>';
        h += '  <button class="cp-btn cp-reset" id="cp-reset">↺ 重置</button>';
        h += '</div>';
        h += '<div class="cp-info" id="cp-info"></div>';
        ctrl.innerHTML = h;

        ctrl.querySelectorAll('.cp-mode-btn').forEach(btn => {
            this._on(btn, 'click', () => this._switchMode(btn.dataset.mode));
        });
        this._on(document.getElementById('cp-play'), 'click', () => this._togglePlay());
        this._on(document.getElementById('cp-reset'), 'click', () => this._fullReset());
        this._buildParams();
        this._updateInfo();
    },

    _buildParams() {
        const wrap = document.getElementById('cp-params');
        if (!wrap) return;
        let h = '';
        if (this.mode === 'lorentz') {
            h += this._slider('q', '电荷量 q', this.q, 1, 5, 1, '');
            h += this._slider('m', '质量 m', this.m, 1, 5, 1, '');
            h += this._slider('v0', '初速度 v₀', this.v0, 1, 8, 0.5, '');
            h += this._slider('B', '磁感应强度 B', this.B, 0.2, 2, 0.1, 'T');
        } else if (this.mode === 'spectrometer') {
            h += this._slider('accV', '加速电压 V', this.accV, 100, 2000, 50, 'V');
            h += this._slider('B', '磁感应强度 B', this.B, 0.2, 2, 0.1, 'T');
        } else {
            h += this._slider('E', '电场强度 E', this.E, 1, 10, 0.5, '');
            h += this._slider('B', '磁感应强度 B', this.B, 0.2, 2, 0.1, 'T');
        }
        wrap.innerHTML = h;
        wrap.querySelectorAll('.cp-slider').forEach(sl => {
            this._on(sl, 'input', () => {
                const key = sl.dataset.key;
                this[key] = parseFloat(sl.value);
                const unit = sl.dataset.unit || '';
                sl.parentElement.querySelector('strong').textContent = sl.value + (unit ? ' ' + unit : '');
                if (this._phase === 'ready') { this._initParticles(); this._draw(); }
                this._updateInfo();
            });
        });
    },

    _slider(key, label, val, min, max, step, unit) {
        const disp = val + (unit ? ' ' + unit : '');
        return `<div class="cp-slider-row">
            <div class="cp-label">${label} = <strong>${disp}</strong></div>
            <input type="range" class="cp-slider" data-key="${key}" data-unit="${unit}"
                   min="${min}" max="${max}" step="${step}" value="${val}">
        </div>`;
    },

    _updateInfo() {
        const info = document.getElementById('cp-info');
        if (!info) return;
        let h = '';
        if (this.mode === 'lorentz') {
            const r = this.m * this.v0 / (this.q * this.B);
            const T = 2 * Math.PI * this.m / (this.q * this.B);
            h += '<div class="cp-mode-tag">洛伦兹力偏转</div>';
            h += `<div class="cp-data-row">轨道半径：r = mv₀/(qB) = <strong>${r.toFixed(2)}</strong></div>`;
            h += `<div class="cp-data-row">运动周期：T = 2πm/(qB) = <strong>${T.toFixed(2)}</strong></div>`;
            h += '<div class="cp-data-row cp-tip">💡 周期 T 与速度 v₀ 无关！</div>';
        } else if (this.mode === 'spectrometer') {
            const masses = [1, 2, 4];
            const labels = ['H⁺', 'D⁺', 'He⁺'];
            h += '<div class="cp-mode-tag">质谱仪</div>';
            masses.forEach((mm, i) => {
                const v = Math.sqrt(2 * this.accV / mm);
                const r = mm * v / this.B;
                h += `<div class="cp-data-row" style="color:${this._COL.particle[i]}">${labels[i]}(m=${mm}): r = <strong>${r.toFixed(1)}</strong></div>`;
            });
            h += '<div class="cp-data-row cp-tip">💡 r = (1/B)·√(2mV/q)，质量越大半径越大</div>';
        } else {
            const vSel = (this.E / this.B).toFixed(2);
            h += '<div class="cp-mode-tag">速度选择器</div>';
            h += `<div class="cp-data-row">选择速度：v = E/B = <strong>${vSel}</strong></div>`;
            if (Math.abs(this.E / this.B - this.v0) < 0.3) {
                h += '<div class="cp-data-row cp-tip" style="color:#43b581">✓ qE = qvB，粒子直线通过！</div>';
            } else {
                h += '<div class="cp-data-row cp-tip">⚠ v ≠ E/B，粒子将偏转</div>';
            }
        }
        info.innerHTML = h;
    },

    /* ═══════════════════ 教育面板 ═══════════════════ */
    _injectEduPanel() {
        const wrap = document.getElementById('cp-edu');
        if (!wrap) return;
        wrap.innerHTML = `
            <h4>📚 带电粒子在电磁场中的运动</h4>
            <p>带电粒子在磁场中受<strong>洛伦兹力</strong>作用，方向由左手定则（负电荷）或右手定则（正电荷）判断：</p>
            <p class="cp-formula">F = qvB （v ⊥ B 时），方向始终垂直于速度</p>
            <ul>
                <li><strong>匀强磁场偏转</strong>：洛伦兹力提供向心力 → 匀速圆周运动。
                    r = mv/(qB)，T = 2πm/(qB)（周期与速度无关！）</li>
                <li><strong>质谱仪</strong>：离子经电压 V 加速后进入磁场，
                    r = (1/B)√(2mV/q)，不同质量离子偏转半径不同 → 分离同位素</li>
                <li><strong>速度选择器</strong>：电场力 qE 与磁场力 qvB 方向相反，
                    仅 v = E/B 的粒子可直线通过（力平衡）</li>
            </ul>
            <p>💡 洛伦兹力始终 ⊥ 速度 → 只改变方向不改变速率 → 不做功</p>`;
    },

    /* ═══════════════════ 粒子初始化 ═══════════════════ */
    _initParticles() {
        this._particles = [];
        this._simTime = 0;
        if (this.mode === 'lorentz') this._initLorentz();
        else if (this.mode === 'spectrometer') this._initSpectrometer();
        else this._initSelector();
    },

    _initLorentz() {
        const r = this.m * this.v0 / (this.q * this.B);
        const sc = this._scale();
        const rPx = r * sc;
        const startX = this.W * 0.25;
        const startY = this.H * 0.6;
        // 正电荷向右 + B 向纸面里 → 洛伦兹力向上
        // 圆心在粒子正上方
        const cx = startX;
        const cy = startY - rPx;
        const omega = this.q * this.B / this.m;
        this._particles.push({
            x: startX, y: startY,
            vx: this.v0, vy: 0,
            trail: [{ x: startX, y: startY }],
            color: this._COL.particle[0],
            label: 'q⁺',
            active: true, elapsed: 0,
            cx, cy, rPx,
            startAngle: Math.PI / 2, // 从圆心看，粒子在正下方 (π/2)
            omega,
        });
    },

    _initSpectrometer() {
        const masses = [1, 2, 4];
        const labels = ['H⁺', 'D⁺', 'He⁺'];
        const slitX = this.W * 0.15;
        const slitY = this.H * 0.8;

        // 计算最大半径用于缩放
        const rMax = masses[2] * Math.sqrt(2 * this.accV / masses[2]) / this.B;
        const scaleF = Math.min(this.W * 0.35, this.H * 0.33) / rMax;

        masses.forEach((mm, i) => {
            const v = Math.sqrt(2 * this.accV / mm);
            const r = mm * v / this.B;
            const rPx = r * scaleF;
            // 粒子从 slit 向上进入，在磁场中向右偏转做半圆
            // 圆心在 slit 右边 rPx 处，同一高度
            const cx = slitX + rPx;
            const cy = slitY;
            const omega = v / r; // ω = v/r = qB/m
            this._particles.push({
                x: slitX, y: slitY,
                vx: 0, vy: -v,
                trail: [{ x: slitX, y: slitY }],
                color: this._COL.particle[i],
                label: labels[i],
                active: true, elapsed: 0,
                cx, cy, rPx,
                // 起始角度：从圆心看，粒子在左侧 (π)
                startAngle: Math.PI,
                omega,
                mass: mm,
            });
        });
    },

    _initSelector() {
        const vSel = this.E / this.B;
        // 5 个粒子，不同速度
        const factors = [0.5, 0.75, 1.0, 1.25, 1.5];
        const startX = this.W * 0.08;
        const centerY = this.H * 0.5;
        factors.forEach((f, i) => {
            const spd = vSel * f;
            this._particles.push({
                x: startX, y: centerY,
                vx: spd, vy: 0,
                trail: [{ x: startX, y: centerY }],
                color: this._COL.particle[i],
                label: i === 2 ? `v=E/B ✓` : `${f.toFixed(2)}v₀`,
                active: true, elapsed: 0,
                speed: spd,
            });
        });
    },

    /* ═══════════════════ 动画 ═══════════════════ */
    _animate(ts) {
        if (!this._running) return;
        let dt = this._lastTime ? (ts - this._lastTime) / 1000 : 0.016;
        dt = Math.min(dt, 0.05);
        this._lastTime = ts;
        this._simTime += dt;

        if (this.mode === 'lorentz') this._stepLorentz(dt);
        else if (this.mode === 'spectrometer') this._stepSpectrometer(dt);
        else this._stepSelector(dt);

        this._draw();

        const allDone = this._particles.every(p => !p.active);
        if (allDone) {
            this._phase = 'done';
            this._running = false;
            const btn = document.getElementById('cp-play');
            if (btn) btn.textContent = '↺ 重来';
            return;
        }
        this._raf = requestAnimationFrame(t => this._animate(t));
    },

    _stepLorentz(dt) {
        const speed = 1.8;
        this._particles.forEach(p => {
            if (!p.active) return;
            p.elapsed += dt * speed;
            const angle = p.startAngle - p.omega * p.elapsed; // 顺时针旋转（向上弯曲）
            p.x = p.cx + p.rPx * Math.cos(angle);
            p.y = p.cy + p.rPx * Math.sin(angle);
            p.trail.push({ x: p.x, y: p.y });
            // 完成整圆后停止
            if (p.omega * p.elapsed >= 2 * Math.PI) p.active = false;
            // 出界停止
            if (p.x < -20 || p.x > this.W + 20 || p.y < -20 || p.y > this.H + 20) p.active = false;
        });
    },

    _stepSpectrometer(dt) {
        const speed = 2.0;
        this._particles.forEach(p => {
            if (!p.active) return;
            p.elapsed += dt * speed;
            // 半圆轨迹：从 π 向上经 3π/2 到 2π（即 0）
            const angle = p.startAngle + p.omega * p.elapsed;
            p.x = p.cx + p.rPx * Math.cos(angle);
            p.y = p.cy + p.rPx * Math.sin(angle);
            p.trail.push({ x: p.x, y: p.y });
            // 完成半圆 (π rad) 后停止
            if (p.omega * p.elapsed >= Math.PI) {
                p.active = false;
                // 精确落点
                p.x = p.cx + p.rPx * Math.cos(p.startAngle + Math.PI);
                p.y = p.cy + p.rPx * Math.sin(p.startAngle + Math.PI);
                p.trail.push({ x: p.x, y: p.y });
            }
        });
    },

    _stepSelector(dt) {
        const speed = 50;
        const plateL = this.W * 0.2;
        const plateR = this.W * 0.8;
        const vSel = this.E / this.B;
        this._particles.forEach(p => {
            if (!p.active) return;
            // 在极板区域内受电场力和磁场力
            if (p.x >= plateL && p.x <= plateR) {
                // F_y = q(E - v_x · B)，向下为正
                const netF = this.E - p.speed * this.B;
                p.vy += netF * dt * speed * 1.5;
            }
            p.x += p.speed * dt * speed * this._scale() * 0.15;
            p.y += p.vy * dt * speed;
            p.trail.push({ x: p.x, y: p.y });
            if (p.x > this.W + 10 || p.y < -10 || p.y > this.H + 10) p.active = false;
        });
    },

    /* ═══════════════════ 绘制 ═══════════════════ */
    _draw() {
        const c = this.ctx;
        c.clearRect(0, 0, this.W, this.H);
        if (this.mode === 'lorentz') this._drawLorentz();
        else if (this.mode === 'spectrometer') this._drawSpectrometer();
        else this._drawSelector();
    },

    /* ── 洛伦兹力偏转 ── */
    _drawLorentz() {
        const c = this.ctx;
        // 磁场区域 (整个画布)
        this._drawBField(0, 0, this.W, this.H, 'into');

        // 粒子
        this._particles.forEach(p => {
            this._drawTrail(p.trail, p.color);
            this._drawDot(p.x, p.y, p.color, p.label);

            // 半径虚线
            if (this._phase !== 'ready' && p.cx !== undefined) {
                c.save();
                c.beginPath();
                c.setLineDash([4, 4]);
                c.strokeStyle = this._COL.radius;
                c.lineWidth = 1;
                c.moveTo(p.cx, p.cy);
                c.lineTo(p.x, p.y);
                c.stroke();
                c.setLineDash([]);
                // 圆心标记
                c.beginPath();
                c.arc(p.cx, p.cy, 3, 0, Math.PI * 2);
                c.fillStyle = this._COL.radius;
                c.fill();
                c.restore();
            }

            // 速度矢量 & 力矢量
            if (p.active && this._running) {
                const angle = p.startAngle - p.omega * p.elapsed;
                // 速度方向 = 切线（顺时针旋转时切线）
                const vDir = { x: Math.sin(angle), y: -Math.cos(angle) };
                // 但因为是顺时针(angle减小)，切线要反向
                // dx/dt ∝ sin(angle), dy/dt ∝ -cos(angle) (从 cos(angle) 的导数 = -sin * dθ/dt, dθ/dt<0)
                // 实际: dx/dt = -rPx*sin(angle)*(-ω) = rPx*ω*sin(angle)
                //        dy/dt = rPx*cos(angle)*(-ω) = -rPx*ω*cos(angle)
                const vx = Math.sin(angle);
                const vy = -Math.cos(angle);
                this._drawArrow(p.x, p.y, p.x + vx * 45, p.y + vy * 45, this._COL.velocity, 'v', 2);
                // 向心力 = 指向圆心
                const fx = p.cx - p.x;
                const fy = p.cy - p.y;
                const fLen = Math.sqrt(fx * fx + fy * fy) || 1;
                this._drawArrow(p.x, p.y, p.x + fx / fLen * 35, p.y + fy / fLen * 35, this._COL.force, 'F', 2);
            }
        });

        // 公式
        c.font = 'bold 14px ' + CF.sans;
        c.fillStyle = this._COL.accent;
        c.textAlign = 'left';
        const r = this.m * this.v0 / (this.q * this.B);
        c.fillText(`r = mv/(qB) = ${r.toFixed(2)}`, 12, this.H - 32);
        c.fillText(`T = 2πm/(qB) = ${(2 * Math.PI * this.m / (this.q * this.B)).toFixed(2)}  (与 v 无关)`, 12, this.H - 12);
    },

    /* ── 质谱仪 ── */
    _drawSpectrometer() {
        const c = this.ctx;
        const slitX = this.W * 0.15;
        const slitY = this.H * 0.8;

        // 磁场区域 (上部)
        this._drawBField(0, 0, this.W, slitY + 10, 'into');

        // 入射缝标记
        c.save();
        c.strokeStyle = this._COL.detector;
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(slitX, slitY - 8);
        c.lineTo(slitX, slitY + 8);
        c.stroke();
        c.font = '12px ' + CF.sans;
        c.fillStyle = this._COL.dim;
        c.textAlign = 'center';
        c.fillText('入射缝', slitX, slitY + 24);
        c.restore();

        // 检测器线
        c.save();
        c.strokeStyle = this._COL.detector;
        c.lineWidth = 2;
        c.setLineDash([6, 3]);
        c.beginPath();
        c.moveTo(slitX, slitY);
        c.lineTo(this.W * 0.95, slitY);
        c.stroke();
        c.setLineDash([]);
        c.font = '12px ' + CF.sans;
        c.fillStyle = this._COL.detector;
        c.textAlign = 'right';
        c.fillText('检测板', this.W * 0.95, slitY + 24);
        c.restore();

        // 加速区域 (底部)
        c.save();
        c.fillStyle = 'rgba(255,159,67,0.08)';
        c.fillRect(slitX - 30, slitY + 30, 60, this.H - slitY - 30);
        c.font = '11px ' + CF.sans;
        c.fillStyle = this._COL.dim;
        c.textAlign = 'center';
        c.fillText(`加速电压 V = ${this.accV} V`, slitX, this.H - 8);
        c.restore();

        // 粒子轨迹
        this._particles.forEach(p => {
            this._drawTrail(p.trail, p.color);
            this._drawDot(p.x, p.y, p.color, p.label);

            // 落点标记
            if (!p.active && p.trail.length > 2) {
                const last = p.trail[p.trail.length - 1];
                c.save();
                c.beginPath();
                c.moveTo(last.x, last.y - 10);
                c.lineTo(last.x, last.y + 10);
                c.strokeStyle = p.color;
                c.lineWidth = 2;
                c.stroke();
                c.font = 'bold 12px ' + CF.sans;
                c.fillStyle = p.color;
                c.textAlign = 'center';
                c.fillText(p.label, last.x, last.y + 26);
                c.restore();
            }
        });

        // 公式
        c.font = 'bold 14px ' + CF.sans;
        c.fillStyle = this._COL.accent;
        c.textAlign = 'right';
        c.fillText('r = (1/B)·√(2mV/q)', this.W - 12, 24);
    },

    /* ── 速度选择器 ── */
    _drawSelector() {
        const c = this.ctx;
        const plateL = this.W * 0.2;
        const plateR = this.W * 0.8;
        const plateTop = this.H * 0.2;
        const plateBot = this.H * 0.8;

        // 磁场区域 (极板之间)
        this._drawBField(plateL, plateTop, plateR - plateL, plateBot - plateTop, 'into');

        // 上极板 (+)
        c.fillStyle = this._COL.platePlus;
        c.fillRect(plateL, plateTop - 6, plateR - plateL, 6);
        c.font = 'bold 13px sans-serif';
        c.textAlign = 'center';
        c.fillStyle = this._COL.platePlus;
        c.fillText('+ 极板', (plateL + plateR) / 2, plateTop - 12);

        // 下极板 (−)
        c.fillStyle = this._COL.plateMinus;
        c.fillRect(plateL, plateBot, plateR - plateL, 6);
        c.fillStyle = this._COL.plateMinus;
        c.fillText('− 极板', (plateL + plateR) / 2, plateBot + 22);

        // E 场箭头 (从 + 到 −, 即向下)
        c.save();
        const arrowGap = 60;
        for (let ax = plateL + 30; ax < plateR; ax += arrowGap) {
            this._drawArrow(ax, plateTop + 15, ax, plateBot - 15, this._COL.eArrow, '', 1.5);
        }
        c.font = '12px ' + CF.sans;
        c.fillStyle = this._COL.eArrow;
        c.textAlign = 'left';
        c.fillText('E ↓', plateR + 8, this.H * 0.5);
        c.restore();

        // 入口和出口标记
        c.font = '12px ' + CF.sans;
        c.fillStyle = this._COL.dim;
        c.textAlign = 'right';
        c.fillText('入口 →', plateL - 8, this.H * 0.5 + 4);
        c.textAlign = 'left';
        c.fillText('→ 出口', plateR + 8, this.H * 0.5 + 4);

        // 粒子
        this._particles.forEach((p, i) => {
            this._drawTrail(p.trail, p.color);
            this._drawDot(p.x, p.y, p.color, '');
            // 标注
            if (p.trail.length > 0) {
                const last = p.trail[p.trail.length - 1];
                c.font = '11px ' + CF.sans;
                c.fillStyle = p.color;
                c.textAlign = 'left';
                const offsetY = (i - 2) * 14;
                c.fillText(p.label, Math.min(last.x + 10, this.W - 60), last.y + offsetY);
            }
        });

        // 公式
        c.font = 'bold 14px ' + CF.sans;
        c.fillStyle = this._COL.accent;
        c.textAlign = 'left';
        const vSel = this.E / this.B;
        c.fillText(`v = E/B = ${vSel.toFixed(2)}（直线通过）`, 12, this.H - 12);
    },

    /* ═══════════════════ 绘制辅助 ═══════════════════ */
    _drawBField(x, y, w, h, dir) {
        const c = this.ctx;
        c.save();
        c.fillStyle = this._COL.fieldBg;
        c.fillRect(x, y, w, h);
        const gap = 38;
        c.font = '13px monospace';
        c.fillStyle = this._COL.fieldSym;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        const sym = dir === 'into' ? '×' : '·';
        for (let gx = x + gap / 2; gx < x + w; gx += gap) {
            for (let gy = y + gap / 2; gy < y + h; gy += gap) {
                c.fillText(sym, gx, gy);
            }
        }
        c.restore();
    },

    _drawTrail(trail, color) {
        if (trail.length < 2) return;
        const c = this.ctx;
        c.save();
        // 外发光
        c.beginPath();
        c.moveTo(trail[0].x, trail[0].y);
        for (let i = 1; i < trail.length; i++) c.lineTo(trail[i].x, trail[i].y);
        c.strokeStyle = color.replace(')', ',0.15)').replace('rgb', 'rgba');
        c.lineWidth = 8;
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.stroke();
        // 实线
        c.beginPath();
        c.moveTo(trail[0].x, trail[0].y);
        for (let i = 1; i < trail.length; i++) c.lineTo(trail[i].x, trail[i].y);
        c.strokeStyle = color;
        c.lineWidth = 2.5;
        c.stroke();
        c.restore();
    },

    _drawDot(x, y, color, label) {
        const c = this.ctx;
        // 光晕
        const grad = c.createRadialGradient(x, y, 3, x, y, 14);
        grad.addColorStop(0, color);
        grad.addColorStop(1, 'transparent');
        c.fillStyle = grad;
        c.beginPath();
        c.arc(x, y, 14, 0, Math.PI * 2);
        c.fill();
        // 实心
        c.beginPath();
        c.arc(x, y, 5, 0, Math.PI * 2);
        c.fillStyle = color;
        c.fill();
        c.strokeStyle = '#fff';
        c.lineWidth = 1.5;
        c.stroke();
        // 标签
        if (label) {
            c.font = 'bold 11px ' + CF.sans;
            c.fillStyle = '#fff';
            c.textAlign = 'center';
            c.textBaseline = 'bottom';
            c.fillText(label, x, y - 14);
        }
    },

    _drawArrow(x1, y1, x2, y2, color, label, lw) {
        const c = this.ctx;
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 3) return;
        c.save();
        c.beginPath();
        c.moveTo(x1, y1);
        c.lineTo(x2, y2);
        c.strokeStyle = color;
        c.lineWidth = lw || 2;
        c.stroke();
        // 箭头
        const angle = Math.atan2(dy, dx);
        const hl = 7;
        c.beginPath();
        c.moveTo(x2, y2);
        c.lineTo(x2 - hl * Math.cos(angle - 0.4), y2 - hl * Math.sin(angle - 0.4));
        c.lineTo(x2 - hl * Math.cos(angle + 0.4), y2 - hl * Math.sin(angle + 0.4));
        c.closePath();
        c.fillStyle = color;
        c.fill();
        // 标签
        if (label) {
            c.font = 'bold 12px sans-serif';
            c.fillStyle = color;
            c.textAlign = 'center';
            c.fillText(label, x2 + 14 * Math.cos(angle + Math.PI / 2), y2 + 14 * Math.sin(angle + Math.PI / 2));
        }
        c.restore();
    },

    /* ═══════════════════ 播放控制 ═══════════════════ */
    _togglePlay() {
        const btn = document.getElementById('cp-play');
        if (this._phase === 'ready') {
            this._phase = 'running';
            this._running = true;
            this._lastTime = 0;
            if (btn) btn.textContent = '⏸ 暂停';
            this._raf = requestAnimationFrame(t => this._animate(t));
        } else if (this._phase === 'running') {
            if (this._running) {
                this._running = false;
                if (btn) btn.textContent = '▶ 继续';
            } else {
                this._running = true;
                this._lastTime = 0;
                if (btn) btn.textContent = '⏸ 暂停';
                this._raf = requestAnimationFrame(t => this._animate(t));
            }
        } else if (this._phase === 'done') {
            this._initParticles();
            this._phase = 'running';
            this._running = true;
            this._lastTime = 0;
            if (btn) btn.textContent = '⏸ 暂停';
            this._raf = requestAnimationFrame(t => this._animate(t));
        }
    },

    _fullReset() {
        this._stop();
        this._phase = 'ready';
        this._initParticles();
        this._draw();
        const btn = document.getElementById('cp-play');
        if (btn) btn.textContent = '▶ 开始';
        this._updateInfo();
    },

    _stop() {
        this._running = false;
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    },

    _reset() {
        this._phase = 'ready';
        this._initParticles();
        this._draw();
    },

    _switchMode(newMode) {
        if (newMode === this.mode) return;
        this._stop();
        this.mode = newMode;
        this._phase = 'ready';
        document.querySelectorAll('.cp-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === this.mode));
        this._buildParams();
        this._initParticles();
        this._draw();
        this._updateInfo();
        const btn = document.getElementById('cp-play');
        if (btn) btn.textContent = '▶ 开始';
    },
};

window.ChargedParticle = ChargedParticle;
function initChargedParticle() { ChargedParticle.init(); }
window.initChargedParticle = initChargedParticle;
