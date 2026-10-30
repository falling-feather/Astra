// ===== Projectile Motion Visualization =====
// Trajectory, range, max height with adjustable v0, angle, gravity

const Projectile = {
    canvas: null, ctx: null, W: 0, H: 0,
    // Parameters
    v0: 20,          // initial speed m/s
    theta: 45,       // launch angle deg
    g: 9.8,          // gravity m/s^2
    t: 0,            // current time
    tFlight: 0,      // total flight time
    animating: false,
    animId: 0,
    trail: [],       // {x,y} trail points
    showVectors: true,
    showEnvelope: false,
    _listeners: [],
    _resizeObs: null,

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        this.canvas = document.getElementById('proj-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        this.compute();
        this.bindEvents();
        this.draw();
        this.updateInfo();
    },

    destroy() {
        this.stopAnim();
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
        const h = Math.min(w * 0.55, 480);
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w;
        this.H = h;
    },

    compute() {
        const rad = this.theta * Math.PI / 180;
        const vx = this.v0 * Math.cos(rad);
        const vy = this.v0 * Math.sin(rad);
        this.tFlight = 2 * vy / this.g;
        this.range = vx * this.tFlight;
        this.maxH = vy * vy / (2 * this.g);
    },

    bindEvents() {
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver(() => { this.resize(); this.draw(); });
            this._resizeObs.observe(this.canvas.parentElement);
        } else {
            this._on(window, 'resize', () => { this.resize(); this.draw(); });
        }

        const bind = (id, prop, valId, factor) => {
            const el = document.getElementById(id);
            if (!el) return;
            this._on(el, 'input', () => {
                this[prop] = parseFloat(el.value) * (factor || 1);
                document.getElementById(valId).textContent = this[prop].toFixed(prop === 'g' ? 1 : 0);
                this.compute();
                this.trail = [];
                this.t = 0;
                this.draw();
                this.updateInfo();
            });
        };

        bind('proj-v0', 'v0', 'proj-v0-val');
        bind('proj-angle', 'theta', 'proj-angle-val');
        bind('proj-g', 'g', 'proj-g-val');

        const tSlider = document.getElementById('proj-t');
        if (tSlider) {
            this._on(tSlider, 'input', () => {
                this.t = parseFloat(tSlider.value) * this.tFlight;
                this.draw();
                this.updateInfo();
            });
        }

        const playBtn = document.getElementById('proj-play-btn');
        if (playBtn) this._on(playBtn, 'click', () => this.toggleAnim());

        const resetBtn = document.getElementById('proj-reset-btn');
        if (resetBtn) this._on(resetBtn, 'click', () => this.reset());

        const vecCb = document.getElementById('proj-vectors');
        if (vecCb) this._on(vecCb, 'change', () => { this.showVectors = vecCb.checked; this.draw(); });

        const envCb = document.getElementById('proj-envelope');
        if (envCb) this._on(envCb, 'change', () => { this.showEnvelope = envCb.checked; this.draw(); });

        // Preset angles
        document.querySelectorAll('.proj-preset-btn').forEach(btn => {
            this._on(btn, 'click', () => {
                this.theta = parseFloat(btn.dataset.angle);
                const slider = document.getElementById('proj-angle');
                if (slider) slider.value = this.theta;
                document.getElementById('proj-angle-val').textContent = this.theta.toFixed(0);
                this.compute();
                this.trail = [];
                this.t = 0;
                this.draw();
                this.updateInfo();
            });
        });
    },

    reset() {
        this.t = 0;
        this.trail = [];
        this.stopAnim();
        const tSlider = document.getElementById('proj-t');
        if (tSlider) tSlider.value = 0;
        this.draw();
        this.updateInfo();
    },

    toggleAnim() {
        if (this.animating) this.stopAnim();
        else this.startAnim();
    },

    startAnim() {
        this.animating = true;
        this.t = 0;
        this.trail = [];
        const btn = document.getElementById('proj-play-btn');
        if (btn) btn.textContent = '\u25a0 \u505c\u6b62';
        let last = performance.now();
        const step = (now) => {
            if (!this.animating) return;
            const dt = (now - last) / 1000;
            last = now;
            this.t += dt * 3;
            if (this.t > this.tFlight) {
                this.t = this.tFlight;
                this.animating = false;
                if (btn) btn.textContent = '\u25b6 \u53d1\u5c04';
            }
            // Record trail
            const pos = this.getPos(this.t);
            this.trail.push(pos);
            if (this.trail.length > 2000) this.trail.shift();
            const tSlider = document.getElementById('proj-t');
            if (tSlider) tSlider.value = this.t / this.tFlight;
            this.draw();
            this.updateInfo();
            if (this.animating) this.animId = requestAnimationFrame(step);
        };
        this.animId = requestAnimationFrame(step);
    },

    stopAnim() {
        this.animating = false;
        cancelAnimationFrame(this.animId);
        const btn = document.getElementById('proj-play-btn');
        if (btn) btn.textContent = '\u25b6 \u53d1\u5c04';
    },

    getPos(t) {
        const rad = this.theta * Math.PI / 180;
        const vx = this.v0 * Math.cos(rad);
        const vy = this.v0 * Math.sin(rad);
        return {
            x: vx * t,
            y: vy * t - 0.5 * this.g * t * t
        };
    },

    getVel(t) {
        const rad = this.theta * Math.PI / 180;
        return {
            vx: this.v0 * Math.cos(rad),
            vy: this.v0 * Math.sin(rad) - this.g * t
        };
    },

    updateInfo() {
        const el = document.getElementById('proj-info');
        if (!el) return;
        const pos = this.getPos(this.t);
        const vel = this.getVel(this.t);
        const speed = Math.sqrt(vel.vx * vel.vx + vel.vy * vel.vy);
        el.innerHTML =
            '<div class="pi-row">' +
            '<span class="pi-item"><span class="pi-label">t</span> = ' + this.t.toFixed(2) + ' s</span>' +
            '<span class="pi-item"><span class="pi-label">x</span> = ' + pos.x.toFixed(2) + ' m</span>' +
            '<span class="pi-item"><span class="pi-label">y</span> = ' + Math.max(0, pos.y).toFixed(2) + ' m</span>' +
            '<span class="pi-item"><span class="pi-label">v</span> = ' + speed.toFixed(2) + ' m/s</span>' +
            '</div>' +
            '<div class="pi-row pi-summary">' +
            '<span>\u5c04\u7a0b R = ' + this.range.toFixed(2) + ' m</span>' +
            '<span>\u6700\u9ad8\u70b9 H = ' + this.maxH.toFixed(2) + ' m</span>' +
            '<span>\u6eda\u65f6 T = ' + this.tFlight.toFixed(2) + ' s</span>' +
            '</div>';

        /* education panel */
        const eduEl = document.getElementById('proj-edu');
        if (eduEl) {
            const rad = this.theta * Math.PI / 180;
            const v0x = (this.v0 * Math.cos(rad)).toFixed(1);
            const v0y = (this.v0 * Math.sin(rad)).toFixed(1);
            eduEl.innerHTML = `<div class="ac-hd"><span class="ac-tag">θ=${this.theta}°</span>抛体运动</div>
<div class="ac-row"><span class="ac-key">运动分解</span>水平方向匀速 v₀x = v₀cosθ = ${v0x} m/s；竖直方向自由落体 v₀y = v₀sinθ = ${v0y} m/s</div>
<div class="ac-row"><span class="ac-key ac-key--purple">位移公式</span>x = v₀cosθ·t &emsp; y = v₀sinθ·t − ½gt² — 水平与竖直独立叠加</div>
<div class="ac-row"><span class="ac-key ac-key--amber">射程公式</span>R = v₀²sin2θ/g — θ=45° 时射程最大；互余角（如 30°/60°）射程相同</div>
<div class="ac-row"><span class="ac-key">最高点</span>H = v₀²sin²θ/(2g) — 竖直分速度为零时达到最高点</div>
<div class="ac-row"><span class="ac-key">飞行时间</span>T = 2v₀sinθ/g — 上升与下降时间对称（忽略空气阻力）</div>
<div class="ac-note">💡 人教版必修2：抛体运动的核心方法是"运动的分解与合成"。调整角度和初速度，观察抛物线轨迹的变化</div>`;
        }
    },

    draw() {
        const { ctx, W, H } = this;
        if (!ctx || W === 0) return;
        ctx.clearRect(0, 0, W, H);

        const pad = { l: 50, r: 20, t: 20, b: 40 };
        const gw = W - pad.l - pad.r;
        const gh = H - pad.t - pad.b;

        // Scale: fit range and maxH
        const scaleX = this.range > 0 ? gw / (this.range * 1.1) : gw / 100;
        const scaleY = this.maxH > 0 ? gh / (this.maxH * 1.3) : gh / 50;
        const scale = Math.min(scaleX, scaleY);

        const ox = pad.l;
        const oy = H - pad.b;

        const toScreen = (wx, wy) => ({
            sx: ox + wx * scale,
            sy: oy - wy * scale
        });

        // Ground
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ox + gw, oy);
        ctx.stroke();

        // Y axis
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ox, pad.t);
        ctx.stroke();

        // Grid
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '14px ' + CF.mono;

        // X grid
        const xStep = this.niceStep(this.range * 1.1, 5);
        ctx.textAlign = 'center';
        for (let x = 0; x <= this.range * 1.1; x += xStep) {
            const { sx, sy } = toScreen(x, 0);
            if (sx > ox + gw) break;
            ctx.strokeStyle = 'rgba(255,255,255,0.05)';
            ctx.beginPath();
            ctx.moveTo(sx, oy);
            ctx.lineTo(sx, pad.t);
            ctx.stroke();
            ctx.fillText(x.toFixed(0), sx, oy + 14);
        }

        // Y grid
        const yStep = this.niceStep(this.maxH * 1.3, 4);
        ctx.textAlign = 'right';
        for (let y = 0; y <= this.maxH * 1.3; y += yStep) {
            const { sx, sy } = toScreen(0, y);
            if (sy < pad.t) break;
            ctx.strokeStyle = 'rgba(255,255,255,0.05)';
            ctx.beginPath();
            ctx.moveTo(ox, sy);
            ctx.lineTo(ox + gw, sy);
            ctx.stroke();
            ctx.fillText(y.toFixed(0), ox - 6, sy + 3);
        }

        // Axis labels
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '15px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText('x (m)', ox + gw / 2, oy + 30);
        ctx.save();
        ctx.translate(ox - 35, pad.t + gh / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('y (m)', 0, 0);
        ctx.restore();

        // Safety envelope (max height envelope for all angles at same v0)
        if (this.showEnvelope) {
            ctx.strokeStyle = 'rgba(139,111,192,0.2)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            const envRange = this.v0 * this.v0 / this.g;
            for (let px = 0; px <= gw; px++) {
                const wx = (px / scale);
                // Envelope: y = v0^2/(2g) - g*x^2/(2*v0^2)
                const wy = this.v0 * this.v0 / (2 * this.g) - this.g * wx * wx / (2 * this.v0 * this.v0);
                if (wy < 0) break;
                const { sx, sy } = toScreen(wx, wy);
                if (px === 0) ctx.moveTo(sx, sy);
                else ctx.lineTo(sx, sy);
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Full trajectory (theoretical curve)
        ctx.strokeStyle = 'rgba(139,111,192,0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let ti = 0; ti <= this.tFlight; ti += this.tFlight / 200) {
            const pos = this.getPos(ti);
            const { sx, sy } = toScreen(pos.x, Math.max(0, pos.y));
            if (ti === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
        }
        ctx.stroke();

        // Animated trail
        if (this.trail.length > 1) {
            ctx.strokeStyle = '#c678dd';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            for (let i = 0; i < this.trail.length; i++) {
                const { sx, sy } = toScreen(this.trail[i].x, Math.max(0, this.trail[i].y));
                if (i === 0) ctx.moveTo(sx, sy);
                else ctx.lineTo(sx, sy);
            }
            ctx.stroke();
        }

        // Current position
        const pos = this.getPos(this.t);
        const pScreen = toScreen(pos.x, Math.max(0, pos.y));

        // Dashed lines to axes
        ctx.strokeStyle = 'rgba(198,120,221,0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(pScreen.sx, pScreen.sy);
        ctx.lineTo(pScreen.sx, oy);
        ctx.moveTo(pScreen.sx, pScreen.sy);
        ctx.lineTo(ox, pScreen.sy);
        ctx.stroke();
        ctx.setLineDash([]);

        // Velocity vectors
        if (this.showVectors && this.t < this.tFlight) {
            const vel = this.getVel(this.t);
            const vScale = 1.5;

            // vx component (horizontal, blue)
            this.drawArrow(pScreen.sx, pScreen.sy, pScreen.sx + vel.vx * vScale, pScreen.sy, '#61afef', 1.5);
            // vy component (vertical, red)
            this.drawArrow(pScreen.sx, pScreen.sy, pScreen.sx, pScreen.sy - vel.vy * vScale, '#e06c75', 1.5);
            // v total (purple)
            this.drawArrow(pScreen.sx, pScreen.sy, pScreen.sx + vel.vx * vScale, pScreen.sy - vel.vy * vScale, '#c678dd', 2);

            // Labels
            ctx.font = '14px ' + CF.mono;
            ctx.textAlign = 'left';
            ctx.fillStyle = '#61afef';
            ctx.fillText('v\u2093', pScreen.sx + vel.vx * vScale + 4, pScreen.sy + 4);
            ctx.fillStyle = '#e06c75';
            ctx.fillText('v\u1d67', pScreen.sx + 4, pScreen.sy - vel.vy * vScale - 4);
        }

        // Max height marker
        const maxHScreen = toScreen(this.range / 2, this.maxH);
        ctx.strokeStyle = 'rgba(229,192,123,0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(ox, maxHScreen.sy);
        ctx.lineTo(ox + gw, maxHScreen.sy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(229,192,123,0.5)';
        ctx.font = '14px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText('H\u2098\u2090\u2093 = ' + this.maxH.toFixed(1) + 'm', maxHScreen.sx + 6, maxHScreen.sy - 4);

        // Range marker
        const rangeScreen = toScreen(this.range, 0);
        ctx.fillStyle = 'rgba(86,182,194,0.5)';
        ctx.beginPath();
        ctx.arc(rangeScreen.sx, rangeScreen.sy, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillText('R = ' + this.range.toFixed(1) + 'm', rangeScreen.sx - 20, rangeScreen.sy + 16);

        // Projectile dot
        ctx.fillStyle = '#c678dd';
        ctx.shadowColor = '#c678dd';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(pScreen.sx, pScreen.sy, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Launch angle indicator
        const angRad = this.theta * Math.PI / 180;
        const angLen = Math.min(60, gw * 0.15);
        ctx.strokeStyle = 'rgba(198,120,221,0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(ox, oy, angLen, -angRad, 0);
        ctx.stroke();
        ctx.fillStyle = 'rgba(198,120,221,0.6)';
        ctx.font = '15px ' + CF.mono;
        ctx.textAlign = 'left';
        ctx.fillText(this.theta + '\u00b0', ox + angLen * 0.7, oy - angLen * 0.25);
    },

    drawArrow(x1, y1, x2, y2, color, lw) {
        const ctx = this.ctx;
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 3) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        // Arrowhead
        const headLen = Math.min(8, len * 0.3);
        const angle = Math.atan2(dy, dx);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - headLen * Math.cos(angle - 0.4), y2 - headLen * Math.sin(angle - 0.4));
        ctx.lineTo(x2 - headLen * Math.cos(angle + 0.4), y2 - headLen * Math.sin(angle + 0.4));
        ctx.closePath();
        ctx.fill();
    },

    niceStep(range, targetTicks) {
        if (range <= 0) return 1;
        const rough = range / targetTicks;
        const pow = Math.pow(10, Math.floor(Math.log10(rough)));
        const norm = rough / pow;
        let step;
        if (norm < 1.5) step = 1;
        else if (norm < 3) step = 2;
        else if (norm < 7) step = 5;
        else step = 10;
        return step * pow;
    }
};

function initProjectile() {
    Projectile.init();
}

window.Projectile = Projectile;
window.initProjectile = initProjectile;