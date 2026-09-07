// ===== Mechanical Energy Conservation =====
// Roller coaster with PE/KE bar chart

const EnergyConservation = {
    canvas: null, ctx: null, W: 0, H: 0,
    root: null,
    _listeners: [],
    _resizeObs: null,
    _resizeRaf: null,
    _raf: null,

    running: true,
    time: 0,
    g: 9.8,
    mass: 1.0,
    friction: 0,
    ballPos: 0, // position along track (0-1)
    ballSpeed: 0,
    lastTime: 0,
    // v4.6.0-α2：摩擦耗散累计 + 初始总能量基准
    internalEnergy: 0,
    initialE: null,
    _peakKE: 0,        // 高亮 KE 峰值
    _peakPE: 0,        // 高亮 PE 峰值

    // Track is a series of y-values (heights)
    trackPoints: [],

    colors: {
        track: 'rgba(139,111,192,0.4)',
        ball: '#8b6fc0',
        pe: '#5b8dce',
        ke: '#e06c75',
        total: '#e5c07b',
        internal: '#f39c12'  // v4.6.0-α2：内能（橙色 = 热）
    },

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    _find(id) {
        if (!this.root) return null;
        if (typeof this.root.getElementById === 'function') return this.root.getElementById(id);
        return this.root.querySelector(`#${id}`);
    },

    _font(kind) {
        if (typeof CF !== 'undefined' && CF && CF[kind]) return CF[kind];
        const cssName = kind === 'mono' ? '--font-mono' : '--font-sans';
        const fallback = kind === 'mono' ? 'monospace' : 'sans-serif';
        try {
            return getComputedStyle(document.documentElement).getPropertyValue(cssName).trim() || fallback;
        } catch (_) {
            return fallback;
        }
    },

    init(options = {}) {
        this.destroy();
        this.root = options && options.root ? options.root : document;
        const requiredIds = [
            'energy-canvas',
            'energy-friction',
            'energy-play',
            'energy-reset',
            'energy-info'
        ];
        const missingIds = requiredIds.filter((id) => !this._find(id));
        if (missingIds.length) {
            throw new Error(`Energy conservation template is missing required nodes: ${missingIds.join(', ')}`);
        }

        this.canvas = this._find('energy-canvas');
        this.ctx = this.canvas.getContext('2d');
        if (!this.ctx) throw new Error('Energy conservation canvas context is unavailable.');
        const configuredFriction = options && options.config
            ? Number(options.config.defaultFriction)
            : Number(this._find('energy-friction').value);
        if (!Number.isFinite(configuredFriction) || configuredFriction < 0 || configuredFriction > 0.3) {
            throw new Error('Energy conservation default friction is invalid.');
        }
        this.friction = configuredFriction;
        this._find('energy-friction').value = String(configuredFriction);
        this._updateFrictionValue();
        this.running = true;
        this.lastTime = performance.now();
        this.buildTrack();
        this.ballPos = 0;
        this.ballSpeed = 0;
        this.internalEnergy = 0;
        this.initialE = null;
        this._peakKE = 0;
        this._peakPE = 0;
        this.resize();
        this.bindEvents();
        this.updateInfo();
        this._startLoop();
        return { ready: true };
    },

    destroy() {
        this.running = false;
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
        if (this._resizeRaf) { cancelAnimationFrame(this._resizeRaf); this._resizeRaf = null; }
        for (const l of this._listeners) l.el.removeEventListener(l.evt, l.fn, l.opts);
        this._listeners = [];
        if (this._resizeObs) { this._resizeObs.disconnect(); this._resizeObs = null; }
        this.canvas = null;
        this.ctx = null;
        this.root = null;
        this.W = 0;
        this.H = 0;
    },

    resize() {
        if (window.PhysicsZoom && window.PhysicsZoom.movedCanvas === this.canvas) return;
        const wrap = this.canvas.parentElement;
        if (!wrap) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = wrap.getBoundingClientRect();
        const w = Math.max(1, rect.width);
        const h = Math.max(1, Math.min(w * 0.55, 380));
        const bitmapWidth = Math.max(1, Math.round(w * dpr));
        const bitmapHeight = Math.max(1, Math.round(h * dpr));
        if (this.canvas.width !== bitmapWidth) this.canvas.width = bitmapWidth;
        if (this.canvas.height !== bitmapHeight) this.canvas.height = bitmapHeight;
        const cssWidth = `${w}px`;
        const cssHeight = `${h}px`;
        if (this.canvas.style.width !== cssWidth) this.canvas.style.width = cssWidth;
        if (this.canvas.style.height !== cssHeight) this.canvas.style.height = cssHeight;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w;
        this.H = h;
    },

    buildTrack() {
        // Generate a roller coaster track as height values
        const n = 200;
        this.trackPoints = [];
        for (let i = 0; i <= n; i++) {
            const t = i / n;
            // Custom roller coaster profile
            const h = 0.8 * Math.sin(t * Math.PI) * (1 - 0.3 * Math.sin(t * 3 * Math.PI))
                    + 0.15 * Math.sin(t * 5 * Math.PI);
            this.trackPoints.push(Math.max(0, h));
        }
        // Ensure start is high, end is low
        this.trackPoints[0] = 0.85;
    },

    bindEvents() {
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver(() => {
                if (this._resizeRaf) return;
                this._resizeRaf = requestAnimationFrame(() => {
                    this._resizeRaf = null;
                    this.resize();
                });
            });
            this._resizeObs.observe(this.canvas.parentElement);
        }

        const fricSlider = this._find('energy-friction');
        if (fricSlider) this._on(fricSlider, 'input', () => {
            this.friction = parseFloat(fricSlider.value);
            this._updateFrictionValue();
            this.updateInfo();
        });

        const playBtn = this._find('energy-play');
        if (playBtn) this._on(playBtn, 'click', () => {
            if (this.running) {
                this.running = false;
                if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
                playBtn.textContent = '\u25b6 \u64ad\u653e';
            } else {
                playBtn.textContent = '\u23f8 \u6682\u505c';
                this._startLoop();
            }
        });

        const resetBtn = this._find('energy-reset');
        if (resetBtn) this._on(resetBtn, 'click', () => {
            this.ballPos = 0;
            this.ballSpeed = 0;
            this.internalEnergy = 0;
            this.initialE = null;
            this._peakKE = 0;
            this._peakPE = 0;
            const pb = this._find('energy-play');
            if (pb) pb.textContent = '\u23f8 \u6682\u505c';
            this._startLoop();
            this.updateInfo();
        });

        // v4.6.0-α2：摩擦改变即时刷新教学面板（说明文案随 μ 变化）
        if (fricSlider) this._on(fricSlider, 'change', () => this.updateInfo());
    },

    _updateFrictionValue() {
        const output = this._find('energy-friction-value');
        if (output) output.textContent = Number(this.friction).toFixed(2);
    },

    _startLoop() {
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
        this.running = true;
        this.lastTime = performance.now();
        this.loop();
    },

    getHeight(pos) {
        const n = this.trackPoints.length - 1;
        const i = pos * n;
        const i0 = Math.floor(i);
        const i1 = Math.min(i0 + 1, n);
        const t = i - i0;
        return this.trackPoints[i0] * (1 - t) + this.trackPoints[i1] * t;
    },

    getSlope(pos) {
        const dp = 0.002;
        const h1 = this.getHeight(Math.max(0, pos - dp));
        const h2 = this.getHeight(Math.min(1, pos + dp));
        return (h2 - h1) / (dp * 2);
    },

    loop() {
        if (!this.running) return;
        this._raf = null;
        const now = performance.now();
        const dt = Math.min((now - this.lastTime) / 1000, 0.03);
        this.lastTime = now;

        // Physics: energy-based approach
        const slope = this.getSlope(this.ballPos);
        const trackScale = 5; // world height scale
        const accel = -this.g * slope * trackScale;
        const frictionDecel = this.friction * (this.ballSpeed > 0 ? 1 : -1) * this.g;

        const prevSpeed = this.ballSpeed;
        this.ballSpeed += (accel - frictionDecel) * dt;
        this.ballPos += this.ballSpeed * dt * 0.15;

        // Clamp
        if (this.ballPos < 0) { this.ballPos = 0; this.ballSpeed = Math.abs(this.ballSpeed) * 0.8; }
        if (this.ballPos > 1) { this.ballPos = 1; this.ballSpeed = -Math.abs(this.ballSpeed) * 0.8; }

        // v4.6.0-α2：摩擦耗散功累积到内能（Q += f·|Δs| ≈ μmg·|v|·dt）
        if (this.friction > 0) {
            // 用本帧平均速度 (m/s 域)，速度域换算系数 0.15*5 = 0.75
            const vMid = Math.abs((prevSpeed + this.ballSpeed) * 0.5) * 0.75;
            const fricForce = this.friction * this.mass * this.g;     // μN，简化 N≈mg
            this.internalEnergy += fricForce * vMid * dt;
        }

        // v4.6.0-α2：首帧记录初始机械能作为守恒基准
        if (this.initialE === null) {
            const h0 = this.getHeight(this.ballPos) * 5;
            this.initialE = this.mass * this.g * h0;  // 起始 v=0 → KE=0，全部为 PE
        }

        // 实时记录 KE / PE 峰值（用于教学高亮）
        const hCur = this.getHeight(this.ballPos) * 5;
        const vCur = Math.abs(this.ballSpeed) * 0.75;
        const PE = this.mass * this.g * hCur;
        const KE = 0.5 * this.mass * vCur * vCur;
        if (KE > this._peakKE) this._peakKE = KE;
        if (PE > this._peakPE) this._peakPE = PE;

        this.draw();
        if (this.running) this._raf = requestAnimationFrame(() => this.loop());
    },

    draw() {
        const { ctx, W, H } = this;
        if (!ctx || W === 0) return;
        ctx.clearRect(0, 0, W, H);

        const trackArea = { x: 20, y: 20, w: W * 0.65, h: H - 40 };
        const barArea = { x: W * 0.7, y: 20, w: W * 0.25, h: H - 60 };

        this.drawTrack(trackArea);
        this.drawBall(trackArea);
        this.drawEnergyBars(barArea);
        this.drawStats(trackArea);
    },

    drawTrack(area) {
        const { ctx } = this;
        const n = this.trackPoints.length;

        ctx.strokeStyle = this.colors.track;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
            const x = area.x + (i / (n - 1)) * area.w;
            const y = area.y + area.h - this.trackPoints[i] * area.h;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Fill below track
        ctx.lineTo(area.x + area.w, area.y + area.h);
        ctx.lineTo(area.x, area.y + area.h);
        ctx.closePath();
        ctx.fillStyle = 'rgba(139,111,192,0.05)';
        ctx.fill();
    },

    drawBall(area) {
        const { ctx } = this;
        const h = this.getHeight(this.ballPos);
        const x = area.x + this.ballPos * area.w;
        const y = area.y + area.h - h * area.h;

        ctx.fillStyle = this.colors.ball;
        ctx.shadowColor = this.colors.ball;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(x, y - 6, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Height dashed line
        ctx.strokeStyle = 'rgba(91,141,206,0.2)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, area.y + area.h);
        ctx.stroke();
        ctx.setLineDash([]);

        // h label
        ctx.fillStyle = 'rgba(91,141,206,0.5)';
        ctx.font = '15px ' + this._font('mono');
        ctx.textAlign = 'left';
        ctx.fillText('h=' + (h * 5).toFixed(1) + 'm', x + 8, (y + area.y + area.h) / 2);
    },

    drawEnergyBars(area) {
        const { ctx } = this;
        const h = this.getHeight(this.ballPos);
        const heightM = h * 5;
        const v = Math.abs(this.ballSpeed) * 0.75;
        const m = this.mass;

        const PE = m * this.g * heightM;
        const KE = 0.5 * m * v * v;
        const Q = this.internalEnergy;
        const total = PE + KE + Q;
        // v4.6.0-α2：用初始机械能 E₀ 作为守恒基准（约等于轨道最高点 mgh_max）
        const E0 = this.initialE !== null ? this.initialE : (m * this.g * 0.85 * 5);
        const maxE = Math.max(total, E0) * 1.15;

        // 4 columns: KE / PE / Q / E_total
        const labels = ['E\u2096', 'E\u209a', 'Q', '\u03a3'];   // KE / PE / Q / Σ
        const colors = [this.colors.ke, this.colors.pe, this.colors.internal, this.colors.total];
        const values = [KE, PE, Q, total];
        const peaks = [this._peakKE, this._peakPE, 0, 0];
        const barW = 24;
        const gap = 12;

        // v4.6.0-α2：守恒基准虚线（横跨所有柱子）— E₀ 高度
        const e0Y = area.y + area.h - (E0 / maxE) * area.h;
        ctx.save();
        ctx.strokeStyle = 'rgba(229,192,123,0.55)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(area.x - 4, e0Y);
        ctx.lineTo(area.x + (barW + gap) * labels.length - gap + 4, e0Y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(229,192,123,0.85)';
        ctx.font = '10px ' + this._font('mono');
        ctx.textAlign = 'left';
        ctx.fillText('E\u2080=' + E0.toFixed(1) + 'J', area.x - 2, e0Y - 4);
        ctx.restore();

        labels.forEach((label, i) => {
            const x = area.x + i * (barW + gap);
            const barH = (values[i] / maxE) * area.h;
            const y = area.y + area.h - barH;

            // 主柱
            ctx.fillStyle = colors[i];
            ctx.globalAlpha = 0.75;
            ctx.fillRect(x, y, barW, barH);
            ctx.globalAlpha = 1;

            // 峰值印记（仅 KE/PE）
            if (peaks[i] > 0 && peaks[i] > values[i]) {
                const peakY = area.y + area.h - (peaks[i] / maxE) * area.h;
                ctx.strokeStyle = colors[i];
                ctx.globalAlpha = 0.55;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(x - 1, peakY);
                ctx.lineTo(x + barW + 1, peakY);
                ctx.stroke();
                ctx.globalAlpha = 1;
            }

            // Label（柱底）
            ctx.fillStyle = colors[i];
            ctx.font = 'bold 13px ' + this._font('sans');
            ctx.textAlign = 'center';
            ctx.fillText(label, x + barW / 2, area.y + area.h + 14);

            // Value（柱顶）
            ctx.font = '11px ' + this._font('mono');
            ctx.fillText(values[i].toFixed(1), x + barW / 2, y - 4);
        });

        // v4.6.0-α2：能量守恒检查（在右下角显示 ΔE/E₀）
        const deviation = Math.abs(total - E0) / Math.max(E0, 0.01) * 100;
        ctx.save();
        ctx.fillStyle = deviation < 3 ? 'rgba(46,204,113,0.85)' : 'rgba(231,76,60,0.75)';
        ctx.font = '10px ' + this._font('mono');
        ctx.textAlign = 'left';
        ctx.fillText('|\u0394E/E\u2080|=' + deviation.toFixed(1) + '%', area.x, area.y + area.h + 30);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillText('\u03a3 = E\u2096+E\u209a+Q ' + (this.friction > 0 ? '(\u4e0d\u53d8)' : '(\u5b88\u6052)'), area.x, area.y + area.h + 44);
        ctx.restore();
    },

    drawStats(area) {
        const { ctx } = this;
        const v = Math.abs(this.ballSpeed) * 0.75;
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '15px ' + this._font('mono');
        ctx.textAlign = 'left';
        ctx.fillText('v = ' + v.toFixed(2) + ' m/s', area.x, area.y + area.h + 16);
        // v4.6.0-α2：摩擦工况下显示已耗散的热量
        if (this.friction > 0 && this.internalEnergy > 0.05) {
            ctx.fillStyle = 'rgba(243,156,18,0.85)';
            ctx.fillText('Q = ' + this.internalEnergy.toFixed(2) + ' J  (\u70ed)', area.x + 130, area.y + area.h + 16);
        }
    },

    /* ── education panel ── */
    updateInfo() {
        const el = this._find('energy-info');
        if (!el) return;
        const fricDesc = this.friction > 0
            ? `摩擦系数 μ = ${this.friction.toFixed(2)}（<span style="color:#f39c12">非守恒系统</span>）：机械能 E<sub>k</sub>+E<sub>p</sub> 持续减少，转化为内能 Q（轨道生热）。但<b>能量总量 Σ = E<sub>k</sub>+E<sub>p</sub>+Q 仍守恒</b>（黄色虚线）`
            : `μ = 0（<span style="color:#5b8dce">守恒系统</span>）：仅重力做功，机械能 E<sub>k</sub>+E<sub>p</sub> = 常数。Q 柱保持为 0`;
        el.innerHTML = `<div class="ac-hd"><span class="ac-tag">能量</span>能量守恒定律 ⇋ 机械能守恒定律</div>
<div class="ac-row"><span class="ac-key">动能</span>E<sub>k</sub> = ½mv² — 由运动状态决定（红柱）</div>
<div class="ac-row"><span class="ac-key ac-key--purple">重力势能</span>E<sub>p</sub> = mgh — 由相对高度决定（蓝柱，零势面取轨道最低点）</div>
<div class="ac-row"><span class="ac-key" style="background:rgba(243,156,18,0.18);color:#f39c12;border-color:rgba(243,156,18,0.4)">内能</span>Q = ∫f<sub>摩</sub>·d|s| ≈ μmg·路程 — 摩擦做的负功转化为热（橙柱）</div>
<div class="ac-row"><span class="ac-key ac-key--amber">守恒条件</span>仅当只有重力/弹力做功时机械能守恒；摩擦力做功时机械能减少 ΔE = -W<sub>摩</sub> = Q</div>
<div class="ac-row"><span class="ac-key">能量总量</span>Σ = E<sub>k</sub> + E<sub>p</sub> + Q 始终等于初始机械能 E₀（图右下角 |ΔE/E₀| 检验）</div>
<div class="ac-note">💡 人教版必修2：${fricDesc}。柱顶上的横线是 E<sub>k</sub> / E<sub>p</sub> 出现过的<b>峰值印记</b>，用于直观对比转化幅度</div>`;
    }
};

function initEnergyConservation(options) {
    return EnergyConservation.init(options);
}

window.EnergyConservation = EnergyConservation;
window.initEnergyConservation = initEnergyConservation;
