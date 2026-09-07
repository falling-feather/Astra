// ===== Circular Motion Visualization =====
// Centripetal acceleration, velocity, force decomposition

const CircularMotion = {
    canvas: null, ctx: null, W: 0, H: 0,
    _listeners: [],
    _resizeObs: null,
    _raf: null,

    // Params
    radius: 120,
    angularSpeed: 1.5, // rad/s
    mass: 1.0,
    angle: 0,
    running: true,
    showVelocity: true,
    showAccel: true,
    showForce: true,
    lastTime: 0,

    colors: {
        orbit: 'rgba(139,111,192,0.25)',
        ball: '#8b6fc0',
        velocity: '#5b8dce',
        accel: '#e06c75',
        force: '#c678dd',
        trace: 'rgba(139,111,192,0.08)'
    },

    trace: [],

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        this.canvas = document.getElementById('circ-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.angle = 0;
        this.trace = [];
        this.running = true;
        this.lastTime = performance.now();
        this.resize();
        this.bindEvents();
        this.updateInfo();
        this.loop();
    },

    destroy() {
        this.running = false;
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
        for (const l of this._listeners) l.el.removeEventListener(l.evt, l.fn, l.opts);
        this._listeners = [];
        if (this._resizeObs) { this._resizeObs.disconnect(); this._resizeObs = null; }
    },

    resize() {
        if (window.PhysicsZoom && window.PhysicsZoom.movedCanvas === this.canvas) return;
        const wrap = this.canvas.parentElement;
        if (!wrap) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = wrap.getBoundingClientRect();
        const w = rect.width;
        const h = Math.min(w * 0.7, 480);
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w;
        this.H = h;
    },

    bindEvents() {
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver(() => { this.resize(); });
            this._resizeObs.observe(this.canvas.parentElement);
        }

        // Radius slider
        const rSlider = document.getElementById('circ-radius');
        if (rSlider) this._on(rSlider, 'input', () => {
            this.radius = parseFloat(rSlider.value);
            this.trace = [];
        });

        // Angular speed slider
        const wSlider = document.getElementById('circ-omega');
        if (wSlider) this._on(wSlider, 'input', () => {
            this.angularSpeed = parseFloat(wSlider.value);
        });

        // Mass slider
        const mSlider = document.getElementById('circ-mass');
        if (mSlider) this._on(mSlider, 'input', () => {
            this.mass = parseFloat(mSlider.value);
        });

        // Toggle checkboxes
        const chkV = document.getElementById('circ-show-v');
        const chkA = document.getElementById('circ-show-a');
        const chkF = document.getElementById('circ-show-f');
        if (chkV) this._on(chkV, 'change', () => { this.showVelocity = chkV.checked; });
        if (chkA) this._on(chkA, 'change', () => { this.showAccel = chkA.checked; });
        if (chkF) this._on(chkF, 'change', () => { this.showForce = chkF.checked; });

        // Play/Pause
        const playBtn = document.getElementById('circ-play');
        if (playBtn) this._on(playBtn, 'click', () => {
            this.running = !this.running;
            playBtn.textContent = this.running ? '\u23f8 \u6682\u505c' : '\u25b6 \u64ad\u653e';
            if (this.running) {
                this.lastTime = performance.now();
                this.loop();
            }
        });

        // Reset
        const resetBtn = document.getElementById('circ-reset');
        if (resetBtn) this._on(resetBtn, 'click', () => {
            this.angle = 0;
            this.trace = [];
            this.running = true;
            const pb = document.getElementById('circ-play');
            if (pb) pb.textContent = '\u23f8 \u6682\u505c';
            this.lastTime = performance.now();
            this.loop();
        });
    },

    loop() {
        if (!this.running) return;
        const now = performance.now();
        const dt = Math.min((now - this.lastTime) / 1000, 0.05);
        this.lastTime = now;

        this.angle += this.angularSpeed * dt;
        if (this.angle > Math.PI * 2) this.angle -= Math.PI * 2;

        const cx = this.W / 2;
        const cy = this.H / 2;
        const bx = cx + this.radius * Math.cos(this.angle);
        const by = cy - this.radius * Math.sin(this.angle);
        this.trace.push({ x: bx, y: by });
        if (this.trace.length > 300) this.trace.shift();

        this.draw();
        this.updateStats();
        this._raf = requestAnimationFrame(() => this.loop());
    },

    updateStats() {
        const w = this.angularSpeed;
        const r = this.radius / 100; // pseudo meters
        const m = this.mass;
        const v = w * r;
        const ac = w * w * r;
        const Fc = m * ac;
        const T = (2 * Math.PI / w).toFixed(2);

        const el = document.getElementById('circ-stats');
        if (el) {
            el.innerHTML =
                'v = \u03c9r = ' + v.toFixed(2) + ' m/s' +
                '&nbsp;&nbsp;&nbsp;a<sub>c</sub> = \u03c9\u00b2r = ' + ac.toFixed(2) + ' m/s\u00b2' +
                '&nbsp;&nbsp;&nbsp;F<sub>c</sub> = ma<sub>c</sub> = ' + Fc.toFixed(2) + ' N' +
                '&nbsp;&nbsp;&nbsp;T = 2\u03c0/\u03c9 = ' + T + ' s';
        }
    },

    draw() {
        const { ctx, W, H, radius, angle } = this;
        if (!ctx || W === 0) return;
        ctx.clearRect(0, 0, W, H);

        const cx = W / 2, cy = H / 2;

        // Trace
        if (this.trace.length > 1) {
            ctx.strokeStyle = this.colors.trace;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            this.trace.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
            ctx.stroke();
        }

        // Orbit circle
        ctx.strokeStyle = this.colors.orbit;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Center
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fill();

        // Ball position
        const bx = cx + radius * Math.cos(angle);
        const by = cy - radius * Math.sin(angle);

        // Radius line
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(bx, by);
        ctx.stroke();

        // Vectors
        const arrowLen = 50;

        if (this.showVelocity) {
            // Velocity: tangent direction
            const vx = -Math.sin(angle);
            const vy = -Math.cos(angle);
            this.drawArrow(bx, by, bx + vx * arrowLen, by + vy * arrowLen, this.colors.velocity, 'v');
        }

        if (this.showAccel) {
            // Centripetal acceleration: toward center
            const ax = cx - bx;
            const ay = cy - by;
            const len = Math.hypot(ax, ay);
            if (len > 0) {
                this.drawArrow(bx, by, bx + ax / len * arrowLen * 0.8, by + ay / len * arrowLen * 0.8, this.colors.accel, 'a');
            }
        }

        if (this.showForce) {
            // Force toward center (same direction as accel, scaled by mass)
            const fx = cx - bx;
            const fy = cy - by;
            const len = Math.hypot(fx, fy);
            if (len > 0) {
                const scale = Math.min(this.mass * 0.6, 1.5);
                this.drawArrow(bx, by, bx + fx / len * arrowLen * scale, by + fy / len * arrowLen * scale, this.colors.force, 'F');
            }
        }

        // Ball
        ctx.fillStyle = this.colors.ball;
        ctx.shadowColor = this.colors.ball;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(bx, by, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Angle indicator
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, 20, 0, -angle, true);
        ctx.stroke();

        // Legend
        this.drawLegend();
    },

    drawArrow(x1, y1, x2, y2, color, label) {
        const ctx = this.ctx;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        const angle = Math.atan2(y2 - y1, x2 - x1);
        const headLen = 8;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - headLen * Math.cos(angle - 0.35), y2 - headLen * Math.sin(angle - 0.35));
        ctx.lineTo(x2 - headLen * Math.cos(angle + 0.35), y2 - headLen * Math.sin(angle + 0.35));
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = color;
        ctx.font = 'bold 17px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText(label, x2 + 6, y2 - 4);
    },

    /* ── education panel ── */
    updateInfo() {
        const el = document.getElementById('circ-info');
        if (!el) return;
        const w = this.angularSpeed;
        const r = this.radius / 100;
        const v = (w * r).toFixed(2);
        const T = (2 * Math.PI / w).toFixed(2);
        el.innerHTML = `<div class="ac-hd"><span class="ac-tag">圆周</span>匀速圆周运动</div>
<div class="ac-row"><span class="ac-key">线速度</span>v = ωr = ${v} m/s — 速度大小不变，方向沿切线时刻改变</div>
<div class="ac-row"><span class="ac-key ac-key--purple">向心加速度</span>a<sub>c</sub> = v²/r = ω²r — 方向始终指向圆心，大小恒定</div>
<div class="ac-row"><span class="ac-key ac-key--amber">向心力</span>F<sub>c</sub> = ma<sub>c</sub> = mω²r = mv²/r — 不是新力，是合力的效果（提供向心加速度的合外力）</div>
<div class="ac-row"><span class="ac-key">周期与频率</span>T = 2π/ω = ${T} s — 转一圈的时间；f = 1/T；ω = 2πf</div>
<div class="ac-row"><span class="ac-key">关键关系</span>v = ωr, a = ω²r = v²/r, F = ma — 三组公式是圆周运动的核心工具</div>
<div class="ac-note">💡 人教版必修2：匀速圆周运动速度大小不变但方向改变，因此有加速度。调节 ω 和 r 观察各物理量的联动变化</div>`;
    },

    drawLegend() {
        const ctx = this.ctx;
        const items = [];
        if (this.showVelocity) items.push({ color: this.colors.velocity, label: 'v \u2014 \u7ebf\u901f\u5ea6' });
        if (this.showAccel) items.push({ color: this.colors.accel, label: 'a \u2014 \u5411\u5fc3\u52a0\u901f\u5ea6' });
        if (this.showForce) items.push({ color: this.colors.force, label: 'F \u2014 \u5411\u5fc3\u529b' });

        ctx.font = '16px ' + CF.sans;
        ctx.textAlign = 'left';
        let y = 16;
        items.forEach(item => {
            ctx.fillStyle = item.color;
            ctx.fillRect(10, y - 6, 14, 3);
            ctx.fillText(item.label, 28, y);
            y += 18;
        });
    }
};

function initCircularMotion() {
    CircularMotion.init();
}

window.CircularMotion = CircularMotion;
window.initCircularMotion = initCircularMotion;