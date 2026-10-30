// ===== Trigonometry Visualization =====
// Unit circle linked to sine/cosine curves

const TrigVis = {
    canvas: null, ctx: null, W: 0, H: 0,
    angle: 0,            // current angle in radians
    mode: 'sin-cos',     // 'sin-cos' | 'tan' | 'all'
    animating: false,
    animId: 0,
    animSpeed: 1,        // radians per second
    trailAngles: [],     // array of past angle values for curve drawing
    showSpecialAngles: true,
    showGrid: true,
    dragging: false,
    _listeners: [],
    _resizeObs: null,

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        this.canvas = document.getElementById('trig-canvas');
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
        const wrap = this.canvas.parentElement;
        if (!wrap) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = wrap.getBoundingClientRect();
        const w = rect.width;
        const h = Math.min(rect.width * 0.52, 480);
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w;
        this.H = h;
    },

    bindEvents() {
        // Resize observer
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver(() => { this.resize(); this.draw(); });
            this._resizeObs.observe(this.canvas.parentElement);
        } else {
            this._on(window, 'resize', () => { this.resize(); this.draw(); });
        }

        // Angle slider
        const slider = document.getElementById('trig-angle');
        if (slider) {
            this._on(slider, 'input', () => {
                this.angle = parseFloat(slider.value);
                this.updateAngleDisplay();
                this.draw();
            });
        }

        // Mode buttons
        document.querySelectorAll('.trig-mode-btn').forEach(btn => {
            this._on(btn, 'click', () => {
                document.querySelectorAll('.trig-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.mode = btn.dataset.mode;
                this.draw();
                this.updateInfo();
            });
        });

        // Animate button
        const animBtn = document.getElementById('trig-anim-btn');
        if (animBtn) {
            this._on(animBtn, 'click', () => this.toggleAnim());
        }

        // Speed control
        const speedSlider = document.getElementById('trig-speed');
        if (speedSlider) {
            this._on(speedSlider, 'input', () => {
                this.animSpeed = parseFloat(speedSlider.value);
            });
        }

        // Special angles toggle
        const specBtn = document.getElementById('trig-special');
        if (specBtn) {
            this._on(specBtn, 'change', () => {
                this.showSpecialAngles = specBtn.checked;
                this.draw();
            });
        }

        // Canvas pointer interaction (drag on unit circle to set angle)
        this._on(this.canvas, 'pointerdown', (e) => {
            const pos = this.getCirclePos(e);
            if (pos) {
                this.dragging = true;
                this.setAngleFromPos(pos);
                this.canvas.setPointerCapture(e.pointerId);
            }
        });
        this._on(this.canvas, 'pointermove', (e) => {
            if (!this.dragging) return;
            const pos = this.getCirclePos(e);
            if (pos) this.setAngleFromPos(pos);
        });
        this._on(this.canvas, 'pointerup', () => { this.dragging = false; });

        // Preset angle buttons
        document.querySelectorAll('.trig-preset-btn').forEach(btn => {
            this._on(btn, 'click', () => {
                const deg = parseFloat(btn.dataset.deg);
                this.angle = deg * Math.PI / 180;
                this.syncSlider();
                this.updateAngleDisplay();
                this.draw();
            });
        });
    },

    getCirclePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        // Unit circle center
        const cx = this.getCircleCenterX();
        const cy = this.H / 2;
        const r = this.getCircleRadius();
        const dx = x - cx, dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < r * 1.5) return { x: dx, y: dy };
        return null;
    },

    setAngleFromPos(pos) {
        this.angle = Math.atan2(-pos.y, pos.x);
        if (this.angle < 0) this.angle += Math.PI * 2;
        this.syncSlider();
        this.updateAngleDisplay();
        this.draw();
    },

    syncSlider() {
        const slider = document.getElementById('trig-angle');
        if (slider) slider.value = this.angle;
    },

    updateAngleDisplay() {
        const el = document.getElementById('trig-angle-val');
        if (el) {
            const deg = (this.angle * 180 / Math.PI).toFixed(1);
            el.textContent = deg + '\u00b0 (' + this.angle.toFixed(3) + ' rad)';
        }
        const infoEl = document.getElementById('trig-info');
        if (infoEl) {
            const s = Math.sin(this.angle);
            const c = Math.cos(this.angle);
            const t = Math.cos(this.angle) !== 0 ? Math.tan(this.angle) : Infinity;
            const tStr = Math.abs(t) > 1e6 ? '\u221e' : t.toFixed(4);
            infoEl.innerHTML =
                '<span class="ti-sin">sin \u03b8 = ' + s.toFixed(4) + '</span>' +
                '<span class="ti-cos">cos \u03b8 = ' + c.toFixed(4) + '</span>' +
                '<span class="ti-tan">tan \u03b8 = ' + tStr + '</span>';
        }
    },

    getCircleCenterX() { return Math.min(this.W * 0.28, 220); },
    getCircleRadius() { return Math.min(this.H * 0.38, this.W * 0.18, 150); },

    toggleAnim() {
        if (this.animating) {
            this.stopAnim();
        } else {
            this.startAnim();
        }
    },

    startAnim() {
        this.animating = true;
        this.trailAngles = [];
        const btn = document.getElementById('trig-anim-btn');
        if (btn) btn.textContent = '\u25a0 \u505c\u6b62';
        let last = performance.now();
        const step = (now) => {
            if (!this.animating) return;
            const dt = (now - last) / 1000;
            last = now;
            this.angle += this.animSpeed * dt;
            if (this.angle > Math.PI * 2) this.angle -= Math.PI * 2;
            this.trailAngles.push(this.angle);
            if (this.trailAngles.length > 600) this.trailAngles.shift();
            this.syncSlider();
            this.updateAngleDisplay();
            this.draw();
            this.animId = requestAnimationFrame(step);
        };
        this.animId = requestAnimationFrame(step);
    },

    stopAnim() {
        this.animating = false;
        cancelAnimationFrame(this.animId);
        const btn = document.getElementById('trig-anim-btn');
        if (btn) btn.textContent = '\u25b6 \u52a8\u753b';
    },

    draw() {
        const { ctx, W, H } = this;
        if (!ctx || W === 0) return;
        ctx.clearRect(0, 0, W, H);

        const cx = this.getCircleCenterX();
        const cy = H / 2;
        const r = this.getCircleRadius();

        // --- Graph area (right side) ---
        const graphLeft = cx + r + 40;
        const graphRight = W - 20;
        const graphW = graphRight - graphLeft;
        const graphCy = cy;
        const graphAmpY = r * 0.85;

        this.drawGraph(graphLeft, graphRight, graphCy, graphAmpY);

        // --- Unit circle ---
        this.drawUnitCircle(cx, cy, r);

        // --- Connection lines ---
        const px = cx + r * Math.cos(this.angle);
        const py = cy - r * Math.sin(this.angle);
        const sinVal = Math.sin(this.angle);
        const cosVal = Math.cos(this.angle);

        // Dashed connection from circle point to graph
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(91,141,206,0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(graphLeft, graphCy - sinVal * graphAmpY);
        ctx.stroke();
        ctx.restore();
    },

    drawUnitCircle(cx, cy, r) {
        const { ctx, angle } = this;
        const sinVal = Math.sin(angle);
        const cosVal = Math.cos(angle);

        // Background grid
        if (this.showGrid) {
            ctx.strokeStyle = 'rgba(255,255,255,0.04)';
            ctx.lineWidth = 0.5;
            for (let i = -1; i <= 1; i += 0.5) {
                ctx.beginPath();
                ctx.moveTo(cx + i * r, cy - r * 1.2);
                ctx.lineTo(cx + i * r, cy + r * 1.2);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(cx - r * 1.2, cy + i * r);
                ctx.lineTo(cx + r * 1.2, cy + i * r);
                ctx.stroke();
            }
        }

        // Axes
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - r * 1.3, cy);
        ctx.lineTo(cx + r * 1.3, cy);
        ctx.moveTo(cx, cy - r * 1.3);
        ctx.lineTo(cx, cy + r * 1.3);
        ctx.stroke();

        // Unit circle
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();

        // Special angles markers
        if (this.showSpecialAngles) {
            const specials = [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330];
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            for (const deg of specials) {
                const a = deg * Math.PI / 180;
                const sx = cx + r * Math.cos(a);
                const sy = cy - r * Math.sin(a);
                ctx.beginPath();
                ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Angle arc
        ctx.strokeStyle = 'rgba(91,141,206,0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.2, 0, -angle, true);
        ctx.stroke();

        // Angle label
        if (r > 60) {
            const labelAngle = angle / 2;
            const lx = cx + r * 0.28 * Math.cos(labelAngle);
            const ly = cy - r * 0.28 * Math.sin(labelAngle);
            ctx.fillStyle = 'rgba(91,141,206,0.8)';
            ctx.font = '17px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillText((angle * 180 / Math.PI).toFixed(0) + '\u00b0', lx, ly);
        }

        // Radius line to point
        const px = cx + r * cosVal;
        const py = cy - r * sinVal;
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(px, py);
        ctx.stroke();

        // Sin line (vertical, red)
        ctx.strokeStyle = '#e06c75';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, cy);
        ctx.lineTo(px, py);
        ctx.stroke();

        // Cos line (horizontal, blue)
        ctx.strokeStyle = '#61afef';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(px, cy);
        ctx.stroke();

        // Tan line (if mode includes tan)
        if (this.mode === 'tan' || this.mode === 'all') {
            if (Math.abs(cosVal) > 0.01) {
                const tanVal = sinVal / cosVal;
                const tanY = cy - tanVal * r;
                // Tangent line from (cx+r, cy) down
                ctx.strokeStyle = '#e5c07b';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(cx + r, cy);
                ctx.lineTo(cx + r, tanY);
                ctx.stroke();
                // Extended radius to tangent
                ctx.strokeStyle = 'rgba(229,192,123,0.3)';
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.lineTo(cx + r, tanY);
                ctx.stroke();
                ctx.setLineDash([]);
                // Tan endpoint dot
                ctx.fillStyle = '#e5c07b';
                ctx.beginPath();
                ctx.arc(cx + r, tanY, 3, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Point on circle
        ctx.fillStyle = '#5b8dce';
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Labels
        ctx.font = '16px ' + CF.mono;
        ctx.textAlign = 'center';
        // sin label
        ctx.fillStyle = '#e06c75';
        ctx.fillText('sin', px + 14, (cy + py) / 2);
        // cos label
        ctx.fillStyle = '#61afef';
        ctx.fillText('cos', (cx + px) / 2, cy + 14);

        // Axis labels
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '16px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText('1', cx + r + 10, cy + 12);
        ctx.fillText('-1', cx - r - 10, cy + 12);
        ctx.fillText('1', cx + 6, cy - r - 6);
        ctx.fillText('-1', cx + 8, cy + r + 14);
    },

    drawGraph(left, right, cy, ampY) {
        const { ctx, angle, mode } = this;
        const graphW = right - left;
        if (graphW < 50) return;

        // Graph background
        ctx.fillStyle = 'rgba(255,255,255,0.02)';
        ctx.fillRect(left - 5, cy - ampY - 20, graphW + 10, ampY * 2 + 40);

        // Graph axes
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(left, cy);
        ctx.lineTo(right, cy);
        ctx.stroke();

        // Vertical grid lines at pi intervals
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.font = '17px ' + CF.mono;
        ctx.textAlign = 'center';
        const piMarks = [0, 0.5, 1, 1.5, 2];
        const piLabels = ['0', '\u03c0/2', '\u03c0', '3\u03c0/2', '2\u03c0'];
        for (let i = 0; i < piMarks.length; i++) {
            const xPos = left + (piMarks[i] / 2) * graphW;
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.beginPath();
            ctx.moveTo(xPos, cy - ampY - 10);
            ctx.lineTo(xPos, cy + ampY + 10);
            ctx.stroke();
            ctx.fillText(piLabels[i], xPos, cy + ampY + 22);
        }

        // Amplitude labels
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.textAlign = 'right';
        ctx.fillText('1', left - 6, cy - ampY + 4);
        ctx.fillText('-1', left - 6, cy + ampY + 4);
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.beginPath();
        ctx.moveTo(left, cy - ampY);
        ctx.lineTo(right, cy - ampY);
        ctx.moveTo(left, cy + ampY);
        ctx.lineTo(right, cy + ampY);
        ctx.stroke();

        // Draw curves
        const drawCurve = (fn, color, label) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (let px = 0; px <= graphW; px++) {
                const a = (px / graphW) * Math.PI * 2;
                const val = fn(a);
                const clampedVal = Math.max(-1.5, Math.min(1.5, val));
                const y = cy - clampedVal * ampY;
                if (px === 0) ctx.moveTo(left + px, y);
                else ctx.lineTo(left + px, y);
            }
            ctx.stroke();
        };

        if (mode === 'sin-cos' || mode === 'all') {
            drawCurve(Math.sin, '#e06c75', 'sin');
            drawCurve(Math.cos, '#61afef', 'cos');
        }
        if (mode === 'tan' || mode === 'all') {
            // Draw tan with discontinuity handling
            ctx.strokeStyle = '#e5c07b';
            ctx.lineWidth = 2;
            ctx.beginPath();
            let moved = false;
            for (let px = 0; px <= graphW; px++) {
                const a = (px / graphW) * Math.PI * 2;
                const val = Math.tan(a);
                if (Math.abs(val) > 1.5) { moved = false; continue; }
                const y = cy - val * ampY;
                if (!moved) { ctx.moveTo(left + px, y); moved = true; }
                else ctx.lineTo(left + px, y);
            }
            ctx.stroke();
        }

        // Current angle marker (vertical line)
        const markerX = left + (angle / (Math.PI * 2)) * graphW;
        ctx.strokeStyle = 'rgba(91,141,206,0.6)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(markerX, cy - ampY - 10);
        ctx.lineTo(markerX, cy + ampY + 10);
        ctx.stroke();
        ctx.setLineDash([]);

        // Current value dots on curves
        if (mode === 'sin-cos' || mode === 'all') {
            // sin dot
            ctx.fillStyle = '#e06c75';
            ctx.beginPath();
            ctx.arc(markerX, cy - Math.sin(angle) * ampY, 4, 0, Math.PI * 2);
            ctx.fill();
            // cos dot
            ctx.fillStyle = '#61afef';
            ctx.beginPath();
            ctx.arc(markerX, cy - Math.cos(angle) * ampY, 4, 0, Math.PI * 2);
            ctx.fill();
        }
        if (mode === 'tan' || mode === 'all') {
            const tanVal = Math.tan(angle);
            if (Math.abs(tanVal) <= 1.5) {
                ctx.fillStyle = '#e5c07b';
                ctx.beginPath();
                ctx.arc(markerX, cy - tanVal * ampY, 4, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Graph legend
        ctx.font = '17px ' + CF.sans;
        ctx.textAlign = 'left';
        let legendX = left + 8;
        const legendY = cy - ampY - 6;
        if (mode === 'sin-cos' || mode === 'all') {
            ctx.fillStyle = '#e06c75';
            ctx.fillText('sin \u03b8', legendX, legendY);
            legendX += 48;
            ctx.fillStyle = '#61afef';
            ctx.fillText('cos \u03b8', legendX, legendY);
            legendX += 48;
        }
        if (mode === 'tan' || mode === 'all') {
            ctx.fillStyle = '#e5c07b';
            ctx.fillText('tan \u03b8', legendX, legendY);
        }
    },

    /* ── education panel ── */
    updateInfo() {
        const el = document.getElementById('trig-edu-info');
        if (!el) return;
        const modeLabels = { 'sin-cos': '正弦 / 余弦', 'tan': '正切', 'all': '全部函数' };
        let h = `<div class="math-hd"><span class="math-tag">${modeLabels[this.mode]}</span>三角函数知识点</div>
<div class="math-row"><span class="math-key">单位圆定义</span>角 θ 终边与单位圆交点 P(cos θ, sin θ)，tan θ = sin θ / cos θ</div>
<div class="math-row"><span class="math-key math-key--red">基本恒等式</span>sin²θ + cos²θ = 1；1 + tan²θ = sec²θ</div>`;
        if (this.mode === 'sin-cos' || this.mode === 'all') {
            h += `<div class="math-row"><span class="math-key">正弦曲线</span>y = sin x，周期 2π，振幅 1，过原点递增</div>
<div class="math-row"><span class="math-key">余弦曲线</span>y = cos x，周期 2π，振幅 1，cos x = sin(x + π/2)</div>`;
        }
        if (this.mode === 'tan' || this.mode === 'all') {
            h += `<div class="math-row"><span class="math-key math-key--amber">正切曲线</span>y = tan x，周期 π，x = π/2 + kπ 处无定义（渐近线）</div>`;
        }
        h += `<div class="math-row"><span class="math-key">诱导公式</span>"奇变偶不变，符号看象限" — 如 sin(π−θ) = sin θ，cos(π+θ) = −cos θ</div>
<div class="math-note">💡 人教版必修1：单位圆是理解三角函数定义的核心工具。拖动圆上的点观察 sin/cos/tan 随角度的变化</div>`;
        el.innerHTML = h;
    }
};

function initTrigVis() {
    TrigVis.init();
}

window.TrigVis = TrigVis;
window.initTrigVis = initTrigVis;