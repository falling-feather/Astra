// ===== Kinematics: Uniform Acceleration Motion =====
// Linked v-t and s-t graphs with animated particle

const Kinematics = {
    canvas: null, ctx: null, W: 0, H: 0,
    // Parameters
    v0: 2,          // initial velocity (m/s)
    a: 1,           // acceleration (m/s^2)
    tMax: 8,        // time range (s)
    t: 0,           // current time
    animating: false,
    animId: 0,
    mode: 'free',   // 'free' | 'play'
    _listeners: [],
    _resizeObs: null,

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        this.canvas = document.getElementById('kin-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.resize();
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
        const h = Math.min(w * 0.55, 500);
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
            this._resizeObs = new ResizeObserver(() => { this.resize(); this.draw(); });
            this._resizeObs.observe(this.canvas.parentElement);
        } else {
            this._on(window, 'resize', () => { this.resize(); this.draw(); });
        }

        // Parameter sliders
        const v0Slider = document.getElementById('kin-v0');
        const aSlider = document.getElementById('kin-a');
        const tSlider = document.getElementById('kin-t');

        if (v0Slider) {
            this._on(v0Slider, 'input', () => {
                this.v0 = parseFloat(v0Slider.value);
                document.getElementById('kin-v0-val').textContent = this.v0.toFixed(1);
                this.draw();
                this.updateInfo();
            });
        }
        if (aSlider) {
            this._on(aSlider, 'input', () => {
                this.a = parseFloat(aSlider.value);
                document.getElementById('kin-a-val').textContent = this.a.toFixed(1);
                this.draw();
                this.updateInfo();
            });
        }
        if (tSlider) {
            this._on(tSlider, 'input', () => {
                this.t = parseFloat(tSlider.value);
                document.getElementById('kin-t-val').textContent = this.t.toFixed(1);
                this.draw();
                this.updateInfo();
            });
        }

        // Play/pause button
        const playBtn = document.getElementById('kin-play-btn');
        if (playBtn) {
            this._on(playBtn, 'click', () => this.toggleAnim());
        }

        // Reset button
        const resetBtn = document.getElementById('kin-reset-btn');
        if (resetBtn) {
            this._on(resetBtn, 'click', () => {
                this.t = 0;
                const tSlider2 = document.getElementById('kin-t');
                if (tSlider2) tSlider2.value = 0;
                document.getElementById('kin-t-val').textContent = '0.0';
                this.stopAnim();
                this.draw();
                this.updateInfo();
            });
        }
    },

    toggleAnim() {
        if (this.animating) {
            this.stopAnim();
        } else {
            this.startAnim();
        }
    },

    startAnim() {
        this.animating = true;
        const btn = document.getElementById('kin-play-btn');
        if (btn) btn.textContent = '\u25a0 \u6682\u505c';
        let last = performance.now();
        const step = (now) => {
            if (!this.animating) return;
            const dt = (now - last) / 1000;
            last = now;
            this.t += dt * 0.8;
            if (this.t > this.tMax) { this.t = 0; }
            const tSlider = document.getElementById('kin-t');
            if (tSlider) tSlider.value = this.t;
            document.getElementById('kin-t-val').textContent = this.t.toFixed(1);
            this.draw();
            this.updateInfo();
            this.animId = requestAnimationFrame(step);
        };
        this.animId = requestAnimationFrame(step);
    },

    stopAnim() {
        this.animating = false;
        cancelAnimationFrame(this.animId);
        const btn = document.getElementById('kin-play-btn');
        if (btn) btn.textContent = '\u25b6 \u64ad\u653e';
    },

    updateInfo() {
        const infoEl = document.getElementById('kin-info');
        if (!infoEl) return;
        const v = this.v0 + this.a * this.t;
        const s = this.v0 * this.t + 0.5 * this.a * this.t * this.t;
        infoEl.innerHTML =
            '<div class="ki-item"><span class="ki-label">v(t)</span> = v\u2080 + at = <strong>' + v.toFixed(2) + '</strong> m/s</div>' +
            '<div class="ki-item"><span class="ki-label">s(t)</span> = v\u2080t + \u00bdat\u00b2 = <strong>' + s.toFixed(2) + '</strong> m</div>' +
            '<div class="ki-item ki-formula">v = ' + this.v0.toFixed(1) + ' + ' + this.a.toFixed(1) + ' \u00d7 ' + this.t.toFixed(1) + ' = ' + v.toFixed(2) + '</div>';

        /* education panel */
        const eduEl = document.getElementById('kin-edu');
        if (eduEl) {
            const aDir = this.a > 0 ? '加速' : this.a < 0 ? '减速' : '匀速';
            eduEl.innerHTML = `<div class="ac-hd"><span class="ac-tag">${aDir}</span>匀变速直线运动</div>
<div class="ac-row"><span class="ac-key">速度公式</span>v = v₀ + at — 当前 v₀=${this.v0.toFixed(1)} m/s, a=${this.a.toFixed(1)} m/s²</div>
<div class="ac-row"><span class="ac-key ac-key--purple">位移公式</span>s = v₀t + ½at² — t=${this.t.toFixed(1)}s 时 s=${s.toFixed(2)} m</div>
<div class="ac-row"><span class="ac-key ac-key--amber">速度位移</span>v² − v₀² = 2as — 不含时间的推导公式，常用于刹车问题</div>
<div class="ac-row"><span class="ac-key">v-t 图像</span>斜率 = 加速度 a；图线下面积 = 位移 s</div>
<div class="ac-row"><span class="ac-key">中间时刻速度</span>v(t/2) = (v₀+v)/2 = 平均速度 — 匀变速运动的重要推论</div>
<div class="ac-note">💡 人教版必修1：调整 v₀ 和 a 的滑块观察粒子运动和图像变化。a 与 v 同向为加速，反向为减速</div>`;
        }
    },

    draw() {
        const { ctx, W, H, v0, a, tMax, t } = this;
        if (!ctx || W === 0) return;
        ctx.clearRect(0, 0, W, H);

        // Layout: top half = particle track, bottom split = v-t (left) + s-t (right)
        const trackH = H * 0.22;
        const graphH = H * 0.65;
        const graphY = trackH + 20;
        const graphBot = graphY + graphH;
        const midX = W / 2;
        const pad = 50;

        // ─── Particle Track ───
        this.drawTrack(pad, trackH, W - pad * 2);

        // ─── v-t Graph (left) ───
        this.drawVTGraph(pad, graphY, midX - pad - 10, graphH);

        // ─── s-t Graph (right) ───
        this.drawSTGraph(midX + 10, graphY, W - midX - pad - 10, graphH);
    },

    drawTrack(x, y, w) {
        const { ctx, v0, a, t, tMax } = this;
        const trackY = y;
        const trackH = 30;

        // Track background
        ctx.fillStyle = 'rgba(139,111,192,0.06)';
        ctx.fillRect(x, trackY - trackH / 2, w, trackH);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, trackY - trackH / 2, w, trackH);

        // Scale markings
        const sMax = v0 * tMax + 0.5 * a * tMax * tMax;
        const sMaxAbs = Math.max(Math.abs(sMax), Math.abs(v0 * tMax + 0.5 * a * tMax * tMax), 1);
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '14px ' + CF.mono;
        ctx.textAlign = 'center';
        for (let i = 0; i <= 5; i++) {
            const sx = x + (i / 5) * w;
            const sVal = (i / 5) * sMaxAbs;
            ctx.beginPath();
            ctx.moveTo(sx, trackY - trackH / 2);
            ctx.lineTo(sx, trackY - trackH / 2 + 5);
            ctx.stroke();
            ctx.fillText(sVal.toFixed(0) + 'm', sx, trackY + trackH / 2 + 12);
        }

        // Particle position
        const s = v0 * t + 0.5 * a * t * t;
        const ratio = sMaxAbs > 0 ? Math.min(Math.max(s / sMaxAbs, 0), 1) : 0;
        const px = x + ratio * w;

        // Velocity arrow
        const v = v0 + a * t;
        const vArrowLen = Math.min(Math.abs(v) * 8, 60) * Math.sign(v);

        ctx.strokeStyle = '#8b6fc0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, trackY);
        ctx.lineTo(px + vArrowLen, trackY);
        ctx.stroke();
        if (Math.abs(vArrowLen) > 5) {
            const arrowDir = Math.sign(vArrowLen);
            ctx.beginPath();
            ctx.moveTo(px + vArrowLen, trackY);
            ctx.lineTo(px + vArrowLen - 6 * arrowDir, trackY - 4);
            ctx.lineTo(px + vArrowLen - 6 * arrowDir, trackY + 4);
            ctx.closePath();
            ctx.fillStyle = '#8b6fc0';
            ctx.fill();
        }

        // Particle dot
        ctx.fillStyle = '#c678dd';
        ctx.beginPath();
        ctx.arc(px, trackY, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Label
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '15px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText('\u8fd0\u52a8\u8f68\u8ff9', x, trackY - trackH / 2 - 6);
    },

    drawVTGraph(x, y, w, h) {
        const { ctx, v0, a, tMax, t } = this;
        if (w < 40) return;

        // Calculate v range
        const vEnd = v0 + a * tMax;
        const vMin = Math.min(0, v0, vEnd) - 1;
        const vMax = Math.max(0, v0, vEnd) + 1;
        const vRange = vMax - vMin;

        const padL = 35, padR = 10, padT = 20, padB = 25;
        const gx = x + padL, gy = y + padT;
        const gw = w - padL - padR, gh = h - padT - padB;

        // Background
        ctx.fillStyle = 'rgba(139,111,192,0.04)';
        ctx.fillRect(gx, gy, gw, gh);

        // Axes
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx, gy + gh);
        ctx.lineTo(gx + gw, gy + gh);
        ctx.stroke();

        // v=0 line
        const zeroY = gy + gh - (-vMin / vRange) * gh;
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath();
        ctx.moveTo(gx, zeroY);
        ctx.lineTo(gx + gw, zeroY);
        ctx.stroke();

        // Grid
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '14px ' + CF.mono;
        ctx.textAlign = 'right';
        const vStep = Math.ceil(vRange / 4);
        for (let vv = Math.ceil(vMin); vv <= Math.floor(vMax); vv += Math.max(1, vStep)) {
            const yy = gy + gh - ((vv - vMin) / vRange) * gh;
            ctx.fillText(vv, gx - 4, yy + 3);
            ctx.strokeStyle = 'rgba(255,255,255,0.04)';
            ctx.beginPath();
            ctx.moveTo(gx, yy);
            ctx.lineTo(gx + gw, yy);
            ctx.stroke();
        }

        // t-axis labels
        ctx.textAlign = 'center';
        for (let tt = 0; tt <= tMax; tt += Math.max(1, Math.ceil(tMax / 4))) {
            const xx = gx + (tt / tMax) * gw;
            ctx.fillText(tt + 's', xx, gy + gh + 14);
        }

        // v-t line (linear: v = v0 + a*t)
        ctx.strokeStyle = '#c678dd';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let px = 0; px <= gw; px++) {
            const tt = (px / gw) * tMax;
            const vv = v0 + a * tt;
            const yy = gy + gh - ((vv - vMin) / vRange) * gh;
            if (px === 0) ctx.moveTo(gx + px, yy);
            else ctx.lineTo(gx + px, yy);
        }
        ctx.stroke();

        // Shaded area (displacement = integral of v)
        const tPx = (t / tMax) * gw;
        ctx.fillStyle = 'rgba(198,120,221,0.12)';
        ctx.beginPath();
        ctx.moveTo(gx, zeroY);
        for (let px = 0; px <= tPx; px++) {
            const tt = (px / gw) * tMax;
            const vv = v0 + a * tt;
            const yy = gy + gh - ((vv - vMin) / vRange) * gh;
            ctx.lineTo(gx + px, yy);
        }
        ctx.lineTo(gx + tPx, zeroY);
        ctx.closePath();
        ctx.fill();

        // Current time marker
        const curX = gx + tPx;
        const curV = v0 + a * t;
        const curVY = gy + gh - ((curV - vMin) / vRange) * gh;
        ctx.strokeStyle = 'rgba(198,120,221,0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(curX, gy);
        ctx.lineTo(curX, gy + gh);
        ctx.stroke();
        ctx.setLineDash([]);

        // Current point
        ctx.fillStyle = '#c678dd';
        ctx.beginPath();
        ctx.arc(curX, curVY, 4, 0, Math.PI * 2);
        ctx.fill();

        // Title
        ctx.fillStyle = 'rgba(198,120,221,0.8)';
        ctx.font = '16px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText('v-t \u56fe', gx + 4, gy - 6);

        // Axis label
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '14px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText('t/s', gx + gw + 8, gy + gh + 4);
        ctx.save();
        ctx.translate(gx - 28, gy + gh / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('v (m/s)', 0, 0);
        ctx.restore();
    },

    drawSTGraph(x, y, w, h) {
        const { ctx, v0, a, tMax, t } = this;
        if (w < 40) return;

        // Calculate s range
        let sMin = 0, sMax = 0;
        for (let tt = 0; tt <= tMax; tt += 0.1) {
            const ss = v0 * tt + 0.5 * a * tt * tt;
            if (ss < sMin) sMin = ss;
            if (ss > sMax) sMax = ss;
        }
        sMin = Math.min(sMin, 0) - 1;
        sMax = sMax + 1;
        const sRange = sMax - sMin;

        const padL = 35, padR = 10, padT = 20, padB = 25;
        const gx = x + padL, gy = y + padT;
        const gw = w - padL - padR, gh = h - padT - padB;

        // Background
        ctx.fillStyle = 'rgba(139,111,192,0.04)';
        ctx.fillRect(gx, gy, gw, gh);

        // Axes
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx, gy + gh);
        ctx.lineTo(gx + gw, gy + gh);
        ctx.stroke();

        // Grid & labels
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '14px ' + CF.mono;
        ctx.textAlign = 'right';
        const sStep = Math.max(1, Math.ceil(sRange / 5));
        for (let ss = Math.ceil(sMin); ss <= Math.floor(sMax); ss += sStep) {
            const yy = gy + gh - ((ss - sMin) / sRange) * gh;
            ctx.fillText(ss, gx - 4, yy + 3);
            ctx.strokeStyle = 'rgba(255,255,255,0.04)';
            ctx.beginPath();
            ctx.moveTo(gx, yy);
            ctx.lineTo(gx + gw, yy);
            ctx.stroke();
        }

        ctx.textAlign = 'center';
        for (let tt = 0; tt <= tMax; tt += Math.max(1, Math.ceil(tMax / 4))) {
            const xx = gx + (tt / tMax) * gw;
            ctx.fillText(tt + 's', xx, gy + gh + 14);
        }

        // s-t curve (parabola: s = v0*t + 0.5*a*t^2)
        ctx.strokeStyle = '#56b6c2';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let px = 0; px <= gw; px++) {
            const tt = (px / gw) * tMax;
            const ss = v0 * tt + 0.5 * a * tt * tt;
            const yy = gy + gh - ((ss - sMin) / sRange) * gh;
            if (px === 0) ctx.moveTo(gx + px, yy);
            else ctx.lineTo(gx + px, yy);
        }
        ctx.stroke();

        // Current time marker
        const tPx = (t / tMax) * gw;
        const curX = gx + tPx;
        const curS = v0 * t + 0.5 * a * t * t;
        const curSY = gy + gh - ((curS - sMin) / sRange) * gh;

        ctx.strokeStyle = 'rgba(86,182,194,0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(curX, gy);
        ctx.lineTo(curX, gy + gh);
        ctx.stroke();
        ctx.setLineDash([]);

        // Current point
        ctx.fillStyle = '#56b6c2';
        ctx.beginPath();
        ctx.arc(curX, curSY, 4, 0, Math.PI * 2);
        ctx.fill();

        // Tangent line (slope = v at current t)
        const curV = v0 + a * t;
        const slope = curV; // ds/dt
        const dx = 30;
        const dsPx = slope * (dx / gw * tMax) / sRange * gh;
        ctx.strokeStyle = 'rgba(86,182,194,0.4)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(curX - dx, curSY + dsPx);
        ctx.lineTo(curX + dx, curSY - dsPx);
        ctx.stroke();

        // Title
        ctx.fillStyle = 'rgba(86,182,194,0.8)';
        ctx.font = '16px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText('s-t \u56fe', gx + 4, gy - 6);

        // Axis label
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '14px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText('t/s', gx + gw + 8, gy + gh + 4);
        ctx.save();
        ctx.translate(gx - 28, gy + gh / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('s (m)', 0, 0);
        ctx.restore();
    }
};

function initKinematics() {
    Kinematics.init();
}

window.Kinematics = Kinematics;
window.initKinematics = initKinematics;