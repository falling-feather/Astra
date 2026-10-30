// ===== 波动演示引擎 (v2) =====
// 3 模式：叠加 | 驻波分析 | 多普勒效应

const WaveDemo = {
    canvas: null, ctx: null, animId: null,
    time: 0, running: true,
    dt: 0,
    W: 0, H: 0,

    // ── 模式 ──
    mode: 'superposition', // 'superposition' | 'standing' | 'doppler'

    // ── 波 1/2 参数 ──
    A1: 60, f1: 1.2, λ1: 200, φ1: 0,
    A2: 60, f2: 1.2, λ2: 200, φ2: 0,
    showWave1: true, showWave2: true, showSum: true,
    showEnvelope: true,
    showEnergy: false,

    // ── 驻波参数 ──
    swHarmonic: 3, // 第 n 次谐波
    swAmplitude: 60,

    // ── 多普勒参数 ──
    dpSourceSpeed: 0.4, // 声源速度 / 波速
    dpFreq: 2.0,        // 声源频率
    dpWavefronts: [],    // [{cx, cy, r}]
    dpLastEmit: 0,
    dpSourceX: 0,
    dpWaveSpeed: 160,    // px/s

    // ── 探测光标 ──
    probeX: -1,

    // ── 颜色 ──
    COLOR_W1: '#ef4444',
    COLOR_W2: '#3b82f6',
    COLOR_SUM: '#a78bfa',
    COLOR_ENV: '#fbbf24',
    COLOR_NODE: '#22c55e',

    _ro: null,

    // ════════════════════════════════════════
    // 初始化
    // ════════════════════════════════════════
    init() {
        this.canvas = document.getElementById('wave-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.resizeCanvas();
        this.bindControls();
        this.bindProbe();
        this._injectModeButtons();
        this._injectStandingPanel();
        this._injectDopplerPanel();

        this._ro = new ResizeObserver(() => { this.resizeCanvas(); });
        this._ro.observe(this.canvas.parentElement);
        this.start();
        this.updateInfo();
    },

    destroy() {
        this.running = false;
        if (this.animId) {
            cancelAnimationFrame(this.animId);
            this.animId = null;
        }
        if (this._ro) {
            this._ro.disconnect();
            this._ro = null;
        }
    },

    resizeCanvas() {
        if (!this.canvas) return;
        if (window.PhysicsZoom && window.PhysicsZoom.movedCanvas === this.canvas) return;
        const container = this.canvas.parentElement;
        if (!container) return;
        const w = container.clientWidth;
        if (w === 0) return;
        const h = Math.min(Math.max(Math.round(w * 0.54), 320), 520);
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w; this.H = h;
    },

    // ════════════════════════════════════════
    // 模式按钮注入
    // ════════════════════════════════════════
    _injectModeButtons() {
        const header = this.canvas.closest('.demo-section')?.querySelector('.section-header');
        if (!header || document.getElementById('wave-mode-btns')) return;
        const div = document.createElement('div');
        div.id = 'wave-mode-btns';
        div.style.cssText = 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;';
        div.innerHTML = [['superposition','叠加'],['standing','驻波分析'],['doppler','多普勒效应']]
            .map(([m,t]) => `<button class="wave-mode-btn${m==='superposition'?' active':''}" data-mode="${m}">${t}</button>`)
            .join('');
        header.appendChild(div);
        div.querySelectorAll('.wave-mode-btn').forEach(btn =>
            btn.addEventListener('click', () => this.setMode(btn.dataset.mode))
        );
    },

    // ════════════════════════════════════════
    // 驻波面板注入
    // ════════════════════════════════════════
    _injectStandingPanel() {
        const ctrl = document.querySelector('.wave-controls');
        if (!ctrl || document.getElementById('wave-sw-panel')) return;
        const div = document.createElement('div');
        div.id = 'wave-sw-panel';
        div.className = 'wave-sw-panel';
        div.style.display = 'none';
        div.innerHTML = `
            <div class="control-group">
                <label>谐波次数 n</label>
                <div class="range-group">
                    <input type="range" id="wave-sw-n" class="range" min="1" max="8" step="1" value="3">
                    <span class="range-value" id="wave-sw-n-value">3</span>
                </div>
            </div>
            <div class="control-group">
                <label>振幅</label>
                <div class="range-group">
                    <input type="range" id="wave-sw-amp" class="range" min="10" max="100" step="5" value="60">
                    <span class="range-value" id="wave-sw-amp-value">60</span>
                    <span class="range-unit">px</span>
                </div>
            </div>
            <div id="wave-sw-info" style="font-size:0.78rem;color:rgba(255,255,255,0.5);margin-top:6px;line-height:1.5"></div>`;
        ctrl.appendChild(div);
        document.getElementById('wave-sw-n').addEventListener('input', e => {
            this.swHarmonic = parseInt(e.target.value);
            document.getElementById('wave-sw-n-value').textContent = this.swHarmonic;
        });
        document.getElementById('wave-sw-amp').addEventListener('input', e => {
            this.swAmplitude = parseInt(e.target.value);
            document.getElementById('wave-sw-amp-value').textContent = this.swAmplitude;
        });
    },

    // ════════════════════════════════════════
    // 多普勒面板注入
    // ════════════════════════════════════════
    _injectDopplerPanel() {
        const ctrl = document.querySelector('.wave-controls');
        if (!ctrl || document.getElementById('wave-dp-panel')) return;
        const div = document.createElement('div');
        div.id = 'wave-dp-panel';
        div.className = 'wave-dp-panel';
        div.style.display = 'none';
        div.innerHTML = `
            <div class="control-group">
                <label>声源速度 (v<sub>s</sub>/v)</label>
                <div class="range-group">
                    <input type="range" id="wave-dp-speed" class="range" min="0" max="1.5" step="0.05" value="0.4">
                    <span class="range-value" id="wave-dp-speed-value">0.40</span>
                </div>
            </div>
            <div class="control-group">
                <label>声源频率</label>
                <div class="range-group">
                    <input type="range" id="wave-dp-freq" class="range" min="0.5" max="5" step="0.1" value="2.0">
                    <span class="range-value" id="wave-dp-freq-value">2.0</span>
                    <span class="range-unit">Hz</span>
                </div>
            </div>
            <div id="wave-dp-info" style="font-size:0.78rem;color:rgba(255,255,255,0.5);margin-top:6px;line-height:1.5"></div>`;
        ctrl.appendChild(div);
        document.getElementById('wave-dp-speed').addEventListener('input', e => {
            this.dpSourceSpeed = parseFloat(e.target.value);
            document.getElementById('wave-dp-speed-value').textContent = this.dpSourceSpeed.toFixed(2);
        });
        document.getElementById('wave-dp-freq').addEventListener('input', e => {
            this.dpFreq = parseFloat(e.target.value);
            document.getElementById('wave-dp-freq-value').textContent = this.dpFreq.toFixed(1);
        });
    },

    // ════════════════════════════════════════
    // 模式切换
    // ════════════════════════════════════════
    setMode(mode) {
        this.mode = mode;
        this.time = 0;
        this.dpWavefronts = [];
        this.dpLastEmit = 0;
        this.dpSourceX = 0;

        document.querySelectorAll('.wave-mode-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.mode === mode));

        // 切换面板可见性
        const mainParams = document.querySelectorAll('.wave-controls > .wave-param-group');
        const swPanel = document.getElementById('wave-sw-panel');
        const dpPanel = document.getElementById('wave-dp-panel');
        const toggles = document.querySelector('.wave-toggles');
        const actions = document.querySelector('.physics-actions');

        mainParams.forEach(el => el.style.display = mode === 'superposition' ? '' : 'none');
        if (toggles) toggles.style.display = mode === 'superposition' ? '' : 'none';
        if (swPanel) swPanel.style.display = mode === 'standing' ? '' : 'none';
        if (dpPanel) dpPanel.style.display = mode === 'doppler' ? '' : 'none';
        if (actions) actions.style.display = mode === 'doppler' ? 'none' : '';

        if (!this.running) {
            this.running = true;
            const pauseBtn = document.getElementById('wave-pause');
            if (pauseBtn) pauseBtn.textContent = '暂停';
            this.start();
        }
        this.updateInfo();
    },

    // ════════════════════════════════════════
    // 探测光标
    // ════════════════════════════════════════
    bindProbe() {
        this.canvas.addEventListener('mousemove', e => {
            const r = this.canvas.getBoundingClientRect();
            this.probeX = e.clientX - r.left;
        });
        this.canvas.addEventListener('mouseleave', () => { this.probeX = -1; });
        this.canvas.addEventListener('touchmove', e => {
            const r = this.canvas.getBoundingClientRect();
            this.probeX = e.touches[0].clientX - r.left;
        });
        this.canvas.addEventListener('touchend', () => { this.probeX = -1; });
    },

    // ════════════════════════════════════════
    // 控件绑定
    // ════════════════════════════════════════
    bindControls() {
        const bind = (id, prop, displayId, format) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', e => {
                this[prop] = parseFloat(e.target.value);
                const d = document.getElementById(displayId);
                if (d) d.textContent = format ? format(this[prop]) : this[prop];
            });
        };
        bind('wave-a1', 'A1', 'wave-a1-value');
        bind('wave-f1', 'f1', 'wave-f1-value', v => v.toFixed(1));
        bind('wave-l1', 'λ1', 'wave-l1-value');
        bind('wave-a2', 'A2', 'wave-a2-value');
        bind('wave-f2', 'f2', 'wave-f2-value', v => v.toFixed(1));
        bind('wave-l2', 'λ2', 'wave-l2-value');

        const t1 = document.getElementById('wave-show1');
        const t2 = document.getElementById('wave-show2');
        const ts = document.getElementById('wave-show-sum');
        if (t1) t1.addEventListener('change', e => { this.showWave1 = e.target.checked; });
        if (t2) t2.addEventListener('change', e => { this.showWave2 = e.target.checked; });
        if (ts) ts.addEventListener('change', e => { this.showSum = e.target.checked; });

        document.querySelectorAll('[data-wave-preset]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.applyPreset(btn.dataset.wavePreset);
                document.querySelectorAll('[data-wave-preset]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        const pauseBtn = document.getElementById('wave-pause');
        if (pauseBtn) pauseBtn.addEventListener('click', () => {
            this.running = !this.running;
            pauseBtn.textContent = this.running ? '暂停' : '继续';
            if (this.running) this.start();
        });
        const resetBtn = document.getElementById('wave-reset');
        if (resetBtn) resetBtn.addEventListener('click', () => { this.time = 0; });
    },

    // ════════════════════════════════════════
    // 预设
    // ════════════════════════════════════════
    applyPreset(name) {
        const presets = {
            standing:     { A1:60, f1:1.5, λ1:200, A2:60, f2:1.5, λ2:200, φ2:Math.PI },
            beat:         { A1:60, f1:1.0, λ1:200, A2:60, f2:1.2, λ2:200, φ2:0 },
            constructive: { A1:60, f1:1.2, λ1:200, A2:60, f2:1.2, λ2:200, φ2:0 },
            destructive:  { A1:60, f1:1.2, λ1:200, A2:60, f2:1.2, λ2:200, φ2:Math.PI },
        };
        const p = presets[name];
        if (!p) return;
        Object.assign(this, { A1:p.A1, f1:p.f1, λ1:p.λ1, φ1:0, A2:p.A2, f2:p.f2, λ2:p.λ2, φ2:p.φ2 });
        this.time = 0;
        this.syncSlider('wave-a1', p.A1, 'wave-a1-value');
        this.syncSlider('wave-f1', p.f1, 'wave-f1-value', v => v.toFixed(1));
        this.syncSlider('wave-l1', p.λ1, 'wave-l1-value');
        this.syncSlider('wave-a2', p.A2, 'wave-a2-value');
        this.syncSlider('wave-f2', p.f2, 'wave-f2-value', v => v.toFixed(1));
        this.syncSlider('wave-l2', p.λ2, 'wave-l2-value');
    },

    syncSlider(id, value, displayId, format) {
        const el = document.getElementById(id);
        if (el) el.value = value;
        const d = document.getElementById(displayId);
        if (d) d.textContent = format ? format(value) : value;
    },

    // ════════════════════════════════════════
    // 波函数
    // ════════════════════════════════════════
    waveY(x, A, f, λ, φ, t) {
        return A * Math.sin(2 * Math.PI * (x / λ - f * t) + φ);
    },

    // ════════════════════════════════════════
    // 动画循环
    // ════════════════════════════════════════
    start() {
        if (this.animId) cancelAnimationFrame(this.animId);
        let last = performance.now();
        const loop = now => {
            if (!this.running) return;
            const dt = Math.min((now - last) / 1000, 0.05);
            last = now;
            this.dt = dt;
            this.time += dt;
            this.render();
            this.animId = requestAnimationFrame(loop);
        };
        this.animId = requestAnimationFrame(loop);
    },

    // ════════════════════════════════════════
    // 主渲染
    // ════════════════════════════════════════
    render() {
        const ctx = this.ctx;
        if (!ctx || !this.W) return;
        ctx.clearRect(0, 0, this.W, this.H);
        this.drawGrid();

        switch (this.mode) {
            case 'superposition': this.renderSuperposition(); break;
            case 'standing':      this.renderStanding(); break;
            case 'doppler':       this.renderDoppler(); break;
        }
    },

    // ════════════════════════════════════════
    // 背景网格
    // ════════════════════════════════════════
    drawGrid() {
        const ctx = this.ctx;
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.lineWidth = 0.5;
        for (let x = 40; x < this.W; x += 40) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.H); ctx.stroke();
        }
        for (let y = 40; y < this.H; y += 40) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.W, y); ctx.stroke();
        }
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  MODE 1: 叠加
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    renderSuperposition() {
        const ctx = this.ctx;
        const midY = this.H / 2;

        // 中轴线
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(this.W, midY); ctx.stroke();
        ctx.setLineDash([]);

        // 各波
        if (this.showWave1) this.drawWaveCurve(this.A1, this.f1, this.λ1, this.φ1, this.COLOR_W1, 0.5, midY);
        if (this.showWave2) this.drawWaveCurve(this.A2, this.f2, this.λ2, this.φ2, this.COLOR_W2, 0.5, midY);

        // 叠加波
        if (this.showSum && (this.showWave1 || this.showWave2)) {
            this.drawSumWave(midY);
        }

        // 拍频包络线
        if (this.showSum && this.showWave1 && this.showWave2) {
            this.drawBeatEnvelope(midY);
        }

        // 能量密度
        if (this.showEnergy && this.showSum) {
            this.drawEnergyDensity(midY);
        }

        // 振幅标注
        this.drawAmplitudeMarkers(midY);

        // 探测光标
        if (this.probeX >= 0 && this.probeX <= this.W) {
            this.drawSuperpositionProbe(midY);
        }
    },

    drawWaveCurve(A, f, λ, φ, color, alpha, midY) {
        const ctx = this.ctx;
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 2;
        for (let px = 0; px <= this.W; px += 2) {
            const y = midY - this.waveY(px, A, f, λ, φ, this.time);
            px === 0 ? ctx.moveTo(px, y) : ctx.lineTo(px, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
    },

    drawSumWave(midY) {
        const ctx = this.ctx;
        ctx.beginPath();
        ctx.strokeStyle = this.COLOR_SUM;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = this.COLOR_SUM;
        ctx.shadowBlur = 8;
        for (let px = 0; px <= this.W; px += 2) {
            let y = 0;
            if (this.showWave1) y += this.waveY(px, this.A1, this.f1, this.λ1, this.φ1, this.time);
            if (this.showWave2) y += this.waveY(px, this.A2, this.f2, this.λ2, this.φ2, this.time);
            const sy = midY - y;
            px === 0 ? ctx.moveTo(px, sy) : ctx.lineTo(px, sy);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
    },

    drawBeatEnvelope(midY) {
        // 仅当两波振幅相近且频率差较小时显示明显包络
        const df = Math.abs(this.f1 - this.f2);
        if (df < 0.05 || df > 1.5) return;
        const avgA = (this.A1 + this.A2) / 2;
        const fBeat = df / 2;
        const avgλ = (this.λ1 + this.λ2) / 2;
        const dλ = Math.abs(this.λ1 - this.λ2);
        // 包络波长 = λ1*λ2/|λ1-λ2|
        const envλ = dλ > 1 ? this.λ1 * this.λ2 / dλ : this.W * 10;

        const ctx = this.ctx;
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.5;

        // 上包络
        ctx.strokeStyle = this.COLOR_ENV;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        for (let px = 0; px <= this.W; px += 3) {
            const env = (this.A1 + this.A2) * Math.abs(Math.cos(Math.PI * (px / envλ - fBeat * this.time)));
            const y = midY - env;
            px === 0 ? ctx.moveTo(px, y) : ctx.lineTo(px, y);
        }
        ctx.stroke();
        // 下包络
        ctx.beginPath();
        for (let px = 0; px <= this.W; px += 3) {
            const env = (this.A1 + this.A2) * Math.abs(Math.cos(Math.PI * (px / envλ - fBeat * this.time)));
            const y = midY + env;
            px === 0 ? ctx.moveTo(px, y) : ctx.lineTo(px, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
    },

    drawEnergyDensity(midY) {
        // 简化：能量 ∝ y²，在底部画薄条
        const ctx = this.ctx;
        const barH = 6;
        const barY = this.H - 10;
        for (let px = 0; px < this.W; px += 2) {
            let y = 0;
            if (this.showWave1) y += this.waveY(px, this.A1, this.f1, this.λ1, this.φ1, this.time);
            if (this.showWave2) y += this.waveY(px, this.A2, this.f2, this.λ2, this.φ2, this.time);
            const maxA = this.A1 + this.A2;
            const intensity = Math.min(1, (y * y) / (maxA * maxA));
            ctx.fillStyle = `rgba(167,139,250,${0.1 + intensity * 0.7})`;
            ctx.fillRect(px, barY - barH * intensity, 2, barH * intensity);
        }
    },

    drawAmplitudeMarkers(midY) {
        const ctx = this.ctx;
        ctx.font = '500 16px ' + CF.mono;
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.textAlign = 'left';
        const maxA = Math.max(this.A1, this.A2);
        if (maxA > 10) {
            ctx.fillText('+A', 6, midY - maxA + 4);
            ctx.fillText('−A', 6, midY + maxA + 12);
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 0.5;
            ctx.setLineDash([2, 6]);
            ctx.beginPath(); ctx.moveTo(0, midY - maxA); ctx.lineTo(this.W, midY - maxA); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, midY + maxA); ctx.lineTo(this.W, midY + maxA); ctx.stroke();
            ctx.setLineDash([]);
        }
    },

    drawSuperpositionProbe(midY) {
        const ctx = this.ctx;
        const px = this.probeX;
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, this.H); ctx.stroke();
        ctx.setLineDash([]);

        const y1 = this.showWave1 ? this.waveY(px, this.A1, this.f1, this.λ1, this.φ1, this.time) : 0;
        const y2 = this.showWave2 ? this.waveY(px, this.A2, this.f2, this.λ2, this.φ2, this.time) : 0;
        const ySum = y1 + y2;
        const vals = [];

        if (this.showWave1) {
            ctx.beginPath(); ctx.arc(px, midY - y1, 4, 0, Math.PI * 2);
            ctx.fillStyle = this.COLOR_W1; ctx.fill();
            vals.push({ label: 'y₁', val: y1, color: this.COLOR_W1 });
        }
        if (this.showWave2) {
            ctx.beginPath(); ctx.arc(px, midY - y2, 4, 0, Math.PI * 2);
            ctx.fillStyle = this.COLOR_W2; ctx.fill();
            vals.push({ label: 'y₂', val: y2, color: this.COLOR_W2 });
        }
        if (this.showSum && (this.showWave1 || this.showWave2)) {
            ctx.beginPath(); ctx.arc(px, midY - ySum, 5, 0, Math.PI * 2);
            ctx.fillStyle = this.COLOR_SUM; ctx.fill();
            vals.push({ label: '∑', val: ySum, color: this.COLOR_SUM });
        }

        const tx = px < this.W - 120 ? px + 10 : px - 110;
        ctx.font = '500 15px ' + CF.mono;
        ctx.textAlign = 'left';
        vals.forEach((v, i) => {
            ctx.fillStyle = v.color;
            ctx.fillText(`${v.label} = ${v.val.toFixed(1)}`, tx, 20 + i * 16);
        });
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  MODE 2: 驻波分析
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    renderStanding() {
        const ctx = this.ctx;
        const midY = this.H / 2;
        const n = this.swHarmonic;
        const A = this.swAmplitude;
        const W = this.W;
        // 弦长 = canvas 宽度, n 个半波长
        // λ = 2W/n, k = 2π/λ = nπ/W
        const k = n * Math.PI / W;
        const ω = n * Math.PI * 1.5 / W; // f ∝ n

        // 中轴线
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(W, midY); ctx.stroke();
        ctx.setLineDash([]);

        // ── 振幅包络 ±2A sin(kx) ──
        ctx.setLineDash([3, 4]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        for (let px = 0; px <= W; px += 2) {
            const env = 2 * A * Math.abs(Math.sin(k * px));
            px === 0 ? ctx.moveTo(px, midY - env) : ctx.lineTo(px, midY - env);
        }
        ctx.stroke();
        ctx.beginPath();
        for (let px = 0; px <= W; px += 2) {
            const env = 2 * A * Math.abs(Math.sin(k * px));
            px === 0 ? ctx.moveTo(px, midY + env) : ctx.lineTo(px, midY + env);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // ── 入射波（淡红，右行）──
        ctx.globalAlpha = 0.25;
        ctx.strokeStyle = this.COLOR_W1;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let px = 0; px <= W; px += 2) {
            const y = midY - A * Math.sin(k * px - ω * this.time);
            px === 0 ? ctx.moveTo(px, y) : ctx.lineTo(px, y);
        }
        ctx.stroke();

        // ── 反射波（淡蓝，左行）──
        ctx.strokeStyle = this.COLOR_W2;
        ctx.beginPath();
        for (let px = 0; px <= W; px += 2) {
            const y = midY - A * Math.sin(k * px + ω * this.time);
            px === 0 ? ctx.moveTo(px, y) : ctx.lineTo(px, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;

        // ── 驻波（紫色合成）y = 2A sin(kx) cos(ωt) ──
        ctx.strokeStyle = this.COLOR_SUM;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = this.COLOR_SUM;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        const cosωt = Math.cos(ω * this.time);
        for (let px = 0; px <= W; px += 2) {
            const y = midY - 2 * A * Math.sin(k * px) * cosωt;
            px === 0 ? ctx.moveTo(px, y) : ctx.lineTo(px, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // ── 波节（nodes）：sin(kx) = 0 → kx = mπ → x = mW/n ──
        for (let m = 0; m <= n; m++) {
            const nx = m * W / n;
            ctx.beginPath(); ctx.arc(nx, midY, 6, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(34,197,94,0.3)'; ctx.fill();
            ctx.strokeStyle = this.COLOR_NODE; ctx.lineWidth = 1.5; ctx.stroke();
            // 标签
            if (m > 0 && m < n) {
                ctx.font = '500 14px ' + CF.mono;
                ctx.fillStyle = this.COLOR_NODE;
                ctx.textAlign = 'center';
                ctx.fillText('N', nx, midY + 18);
            }
        }

        // ── 波腹（antinodes）：sin(kx) = ±1 → x = (m+0.5)W/n ──
        for (let m = 0; m < n; m++) {
            const ax = (m + 0.5) * W / n;
            // 双向箭头指示最大振幅
            const arr = Math.min(2 * A, this.H * 0.35);
            ctx.strokeStyle = 'rgba(251,191,36,0.4)';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 3]);
            ctx.beginPath(); ctx.moveTo(ax, midY - arr); ctx.lineTo(ax, midY + arr); ctx.stroke();
            ctx.setLineDash([]);
            // 标签
            ctx.font = '500 14px ' + CF.mono;
            ctx.fillStyle = this.COLOR_ENV;
            ctx.textAlign = 'center';
            ctx.fillText('A', ax, midY - arr - 6);
        }

        // ── 两端固定点标记 ──
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.beginPath(); ctx.arc(0, midY, 4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(W, midY, 4, 0, Math.PI * 2); ctx.fill();

        // ── 信息面板 ──
        this._updateStandingInfo(n, A, k, ω);

        // 探针
        if (this.probeX >= 0 && this.probeX <= W) {
            this.drawStandingProbe(midY, k, ω, A);
        }
    },

    _updateStandingInfo(n, A, k, ω) {
        const el = document.getElementById('wave-sw-info');
        if (!el) return;
        const λ = 2 * this.W / n;
        el.innerHTML = `第 <strong>${n}</strong> 次谐波<br>` +
            `λ = 2L/${n} = ${λ.toFixed(0)} px<br>` +
            `波节 ${n + 1} 个 · 波腹 ${n} 个<br>` +
            `<span style="color:rgba(255,255,255,0.35)">y = 2A sin(${n}πx/L) cos(ωt)</span>`;
    },

    drawStandingProbe(midY, k, ω, A) {
        const ctx = this.ctx;
        const px = this.probeX;
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, this.H); ctx.stroke();
        ctx.setLineDash([]);

        const yVal = 2 * A * Math.sin(k * px) * Math.cos(ω * this.time);
        const env = 2 * A * Math.abs(Math.sin(k * px));

        ctx.beginPath(); ctx.arc(px, midY - yVal, 5, 0, Math.PI * 2);
        ctx.fillStyle = this.COLOR_SUM; ctx.fill();

        const tx = px < this.W - 140 ? px + 10 : px - 140;
        ctx.font = '500 15px ' + CF.mono;
        ctx.textAlign = 'left';
        ctx.fillStyle = this.COLOR_SUM;
        ctx.fillText(`y = ${yVal.toFixed(1)}`, tx, 20);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillText(`|envelope| = ${env.toFixed(1)}`, tx, 36);
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  MODE 3: 多普勒效应
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    renderDoppler() {
        const ctx = this.ctx;
        const W = this.W, H = this.H;
        const midY = H / 2;
        const v = this.dpWaveSpeed;
        const vs = this.dpSourceSpeed * v;
        const f = this.dpFreq;
        const period = 1 / f;

        // 声源运动（来回弹跳）
        this.dpSourceX += vs * this.dt;
        if (this.dpSourceX > W - 20) { this.dpSourceX = W - 20; this.dpSourceSpeed = -Math.abs(this.dpSourceSpeed); this.syncDopplerSlider(); }
        if (this.dpSourceX < 20) { this.dpSourceX = 20; this.dpSourceSpeed = Math.abs(this.dpSourceSpeed); this.syncDopplerSlider(); }

        // 发射新波前
        if (this.time - this.dpLastEmit >= period) {
            this.dpWavefronts.push({ cx: this.dpSourceX, cy: midY, r: 0 });
            this.dpLastEmit = this.time;
        }

        // 更新并绘制波前同心圆
        const alive = [];
        for (const wf of this.dpWavefronts) {
            wf.r += v * this.dt;
            if (wf.r > W * 1.5) continue; // 丢弃远处波前
            alive.push(wf);

            const alpha = Math.max(0.05, 0.3 - wf.r / (W * 1.2));
            ctx.strokeStyle = `rgba(167,139,250,${alpha})`;
            ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.arc(wf.cx, wf.cy, wf.r, 0, Math.PI * 2); ctx.stroke();
        }
        this.dpWavefronts = alive;

        // 马赫角（超音速）
        if (Math.abs(this.dpSourceSpeed) > 1) {
            const sinθ = 1 / Math.abs(this.dpSourceSpeed);
            const θ = Math.asin(sinθ);
            const dir = this.dpSourceSpeed > 0 ? Math.PI : 0;
            ctx.strokeStyle = 'rgba(239,68,68,0.3)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 5]);
            const len = W;
            ctx.beginPath();
            ctx.moveTo(this.dpSourceX, midY);
            ctx.lineTo(this.dpSourceX + len * Math.cos(dir + θ), midY + len * Math.sin(dir + θ));
            ctx.moveTo(this.dpSourceX, midY);
            ctx.lineTo(this.dpSourceX + len * Math.cos(dir - θ), midY + len * Math.sin(dir - θ));
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // 声源
        ctx.beginPath(); ctx.arc(this.dpSourceX, midY, 8, 0, Math.PI * 2);
        const srcGrad = ctx.createRadialGradient(this.dpSourceX-2, midY-2, 1, this.dpSourceX, midY, 8);
        srcGrad.addColorStop(0, '#fbbf24');
        srcGrad.addColorStop(1, '#d97706');
        ctx.fillStyle = srcGrad;
        ctx.fill();
        ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 1; ctx.stroke();

        // 速度箭头
        if (Math.abs(vs) > 5) {
            const ax = this.dpSourceX + (vs > 0 ? 30 : -30);
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(this.dpSourceX + (vs > 0 ? 12 : -12), midY); ctx.lineTo(ax, midY); ctx.stroke();
            const dir = vs > 0 ? 0 : Math.PI;
            ctx.fillStyle = '#fbbf24';
            ctx.beginPath();
            ctx.moveTo(ax, midY);
            ctx.lineTo(ax - 6 * Math.cos(dir - 0.4), midY - 6 * Math.sin(dir - 0.4));
            ctx.lineTo(ax - 6 * Math.cos(dir + 0.4), midY - 6 * Math.sin(dir + 0.4));
            ctx.closePath(); ctx.fill();
        }

        // 两侧观测者
        this.drawDopplerObserver(ctx, 30, midY, '←');
        this.drawDopplerObserver(ctx, W - 30, midY, '→');

        // 公式 & 信息
        this._updateDopplerInfo();
    },

    syncDopplerSlider() {
        const el = document.getElementById('wave-dp-speed');
        if (el) el.value = Math.abs(this.dpSourceSpeed).toFixed(2);
        const d = document.getElementById('wave-dp-speed-value');
        if (d) d.textContent = Math.abs(this.dpSourceSpeed).toFixed(2);
    },

    drawDopplerObserver(ctx, x, midY, symbol) {
        ctx.beginPath(); ctx.arc(x, midY, 10, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(59,130,246,0.2)'; ctx.fill();
        ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.font = '15px ' + CF.sans;
        ctx.fillStyle = '#93c5fd';
        ctx.textAlign = 'center';
        ctx.fillText('O', x, midY + 3.5);

        // 计算该观测者接收频率
        const v = this.dpWaveSpeed;
        const vs = this.dpSourceSpeed * v;
        const f0 = this.dpFreq;
        const approaching = (x > this.dpSourceX && vs > 0) || (x < this.dpSourceX && vs < 0);
        let fObs;
        if (Math.abs(vs) >= v) {
            fObs = approaching ? Infinity : f0 * v / (v + Math.abs(vs));
        } else {
            fObs = approaching ? f0 * v / (v - Math.abs(vs)) : f0 * v / (v + Math.abs(vs));
        }
        const fStr = isFinite(fObs) ? fObs.toFixed(2) : '∞';
        ctx.font = '500 15px ' + CF.mono;
        ctx.fillStyle = approaching ? '#ef4444' : '#3b82f6';
        ctx.fillText(`f'=${fStr}`, x, midY + 26);
    },

    _updateDopplerInfo() {
        const el = document.getElementById('wave-dp-info');
        if (!el) return;
        const ratio = Math.abs(this.dpSourceSpeed);
        const regime = ratio > 1 ? '超音速 (马赫锥)' : ratio > 0.8 ? '接近音速' : '亚音速';
        el.innerHTML = `<span style="color:${ratio>1?'#ef4444':'#a78bfa'}">${regime}</span><br>` +
            `f' = f₀ · v / (v ${this.dpSourceSpeed >= 0 ? '∓' : '±'} v<sub>s</sub>)<br>` +
            `<span style="color:rgba(255,255,255,0.35)">v<sub>s</sub>/v = ${ratio.toFixed(2)}</span>` +
            (ratio > 1 ? `<br>马赫数 M = ${ratio.toFixed(2)}, 锥角 θ = ${(Math.asin(1/ratio)*180/Math.PI).toFixed(1)}°` : '');
    },

    /* ── education panel ── */
    updateInfo() {
        const el = document.getElementById('wave-info');
        if (!el) return;
        const labels = { superposition:'波的叠加', standing:'驻波分析', doppler:'多普勒效应' };
        const data = {
            superposition: [
                ['叠加原理','合位移 = 各分位移的矢量和，同相加强、反相减弱'],
                ['拍频波','两列频率接近的波叠加，拍频 f_beat = |f₁ − f₂|，产生包络线'],
                ['能量分布','叠加波能量正比于振幅的平方，加强区 > 单波 > 减弱区']
            ],
            standing: [
                ['驻波形成','两列同频反向波叠加，y = 2A sin(kx) cos(ωt)'],
                ['波节 / 波腹','波节位移始终为零，波腹振幅最大；相邻波节距 = λ/2'],
                ['谐波','两端固定弦：基频 f₁ = v/2L，第 n 次谐波 f_n = n·f₁']
            ],
            doppler: [
                ['多普勒公式','f\' = f₀ · v/(v ∓ v_s)，声源靠近时频率升高，远离时降低'],
                ['超音速','声源速度 > 波速时形成马赫锥，锥角 sinθ = v/v_s'],
                ['应用','多普勒雷达测速、天文学红移/蓝移、医学超声血流检测']
            ]
        };
        const items = data[this.mode] || data.superposition;
        let h = `<div class="ac-hd"><span class="ac-tag">${labels[this.mode]}</span>波动知识点</div>`;
        items.forEach(([k, v]) => h += `<div class="ac-row"><span class="ac-key">${k}</span>${v}</div>`);
        h += `<div class="ac-note">💡 人教版选择性必修1：切换上方模式探索波的叠加、驻波与多普勒三大现象</div>`;
        el.innerHTML = h;
    },
};

function initWaves() {
    WaveDemo.init();
}
