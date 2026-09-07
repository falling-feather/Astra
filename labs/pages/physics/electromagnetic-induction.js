// ===== Electromagnetic Induction Visualization =====
// Faraday's law: magnet + coil, EMF generation

const EMInduction = {
    canvas: null, ctx: null, W: 0, H: 0,
    _listeners: [],
    _resizeObs: null,
    _raf: null,
    time: 0,
    running: true,
    playing: true,

    magnetX: 0.3,   // normalized 0-1 position
    magnetVx: 0,
    dragging: false,
    mode: 'manual',  // 'manual' or 'auto'
    autoDir: 1,

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        this.canvas = document.getElementById('eminduction-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.time = 0;
        this.magnetX = 0.3;
        this.magnetVx = 0;
        this.running = true;
        this.playing = true;
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
        const h = Math.min(w * 0.55, 360);
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
            this._resizeObs = new ResizeObserver(() => this.resize());
            this._resizeObs.observe(this.canvas.parentElement);
        }

        // Drag magnet
        const getX = (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            return (clientX - rect.left) / rect.width;
        };

        this._on(this.canvas, 'mousedown', (e) => {
            if (this.mode === 'manual') { this.dragging = true; this.magnetX = getX(e); }
        });
        this._on(this.canvas, 'touchstart', (e) => {
            if (this.mode === 'manual') { this.dragging = true; this.magnetX = getX(e); e.preventDefault(); }
        }, { passive: false });
        this._on(window, 'mousemove', (e) => {
            if (this.dragging) {
                const newX = getX(e);
                this.magnetVx = (newX - this.magnetX) / 0.016;
                this.magnetX = Math.max(0.05, Math.min(0.95, newX));
            }
        });
        this._on(window, 'touchmove', (e) => {
            if (this.dragging) {
                const newX = getX(e);
                this.magnetVx = (newX - this.magnetX) / 0.016;
                this.magnetX = Math.max(0.05, Math.min(0.95, newX));
            }
        });
        this._on(window, 'mouseup', () => { this.dragging = false; });
        this._on(window, 'touchend', () => { this.dragging = false; });

        document.querySelectorAll('.emi-mode-btn').forEach(btn => {
            this._on(btn, 'click', () => {
                document.querySelectorAll('.emi-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.mode = btn.dataset.mode;
                if (this.mode === 'auto') { this.magnetX = 0.2; this.autoDir = 1; }
            });
        });

        const pauseBtn = document.getElementById('emi-pause');
        if (pauseBtn) {
            pauseBtn.textContent = '暂停';
            this._on(pauseBtn, 'click', () => {
                this.playing = !this.playing;
                pauseBtn.textContent = this.playing ? '暂停' : '继续';
            });
        }

        const resetBtn = document.getElementById('emi-reset');
        if (resetBtn) {
            this._on(resetBtn, 'click', () => {
                this.playing = true;
                if (pauseBtn) pauseBtn.textContent = '暂停';
                this.time = 0;
                this.magnetX = 0.3;
                this.magnetVx = 0;
                this.dragging = false;
                this.mode = 'manual';
                this.autoDir = 1;
                document.querySelectorAll('.emi-mode-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.mode === 'manual');
                });
            });
        }
    },

    loop() {
        if (!this.running) return;
        if (this.playing) {
            this.time += 0.016;

            if (this.mode === 'auto') {
                this.magnetX += this.autoDir * 0.003;
                this.magnetVx = this.autoDir * 0.19;
                if (this.magnetX > 0.85) this.autoDir = -1;
                if (this.magnetX < 0.15) this.autoDir = 1;
            }

            if (!this.dragging && this.mode === 'manual') {
                this.magnetVx *= 0.92; // damping
            }
        }

        this.draw();
        this._raf = requestAnimationFrame(() => this.loop());
    },

    draw() {
        const { ctx, W, H, magnetX, magnetVx } = this;
        if (!ctx || W === 0) return;
        ctx.clearRect(0, 0, W, H);

        const cy = H / 2;
        const coilX = W * 0.55;
        const coilW = W * 0.12;
        const coilH = H * 0.5;
        const mx = magnetX * W;

        // Coil (solenoid)
        this.drawCoil(coilX, cy, coilW, coilH);

        // Magnet
        this.drawMagnet(mx, cy);

        // Magnetic field lines
        this.drawFieldLines(mx, cy, coilX);

        // EMF indicator
        const emf = -magnetVx * 50; // simplified Faraday
        this.drawEMFMeter(W * 0.85, cy, emf);

        // Flux indicator
        const dist = Math.abs(mx - coilX);
        const flux = 1 / (1 + (dist / (W * 0.15)) * (dist / (W * 0.15)));
        this.drawFluxBar(W * 0.85, H * 0.15, flux);

        // Labels
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '15px ' + CF.sans;
        ctx.textAlign = 'center';
        if (this.mode === 'manual') {
            ctx.fillText('\u62d6\u62fd\u78c1\u94c1\u2190\u2192', mx, cy + H * 0.35);
        }

        // Faraday's law
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '16px ' + CF.mono;
        ctx.textAlign = 'left';
        ctx.fillText('\u03b5 = -d\u03a6/dt', 10, H - 10);
    },

    drawMagnet(x, cy) {
        const ctx = this.ctx;
        const mw = 60, mh = 28;

        // N pole (red)
        ctx.fillStyle = '#e06c75';
        ctx.beginPath();
        ctx.roundRect(x - mw / 2, cy - mh / 2, mw / 2, mh, [4, 0, 0, 4]);
        ctx.fill();

        // S pole (blue)
        ctx.fillStyle = '#5b8dce';
        ctx.beginPath();
        ctx.roundRect(x, cy - mh / 2, mw / 2, mh, [0, 4, 4, 0]);
        ctx.fill();

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 17px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('N', x - mw / 4, cy);
        ctx.fillText('S', x + mw / 4, cy);
    },

    drawCoil(x, cy, w, h) {
        const ctx = this.ctx;
        const nTurns = 6;

        ctx.strokeStyle = 'rgba(196,149,102,0.5)';
        ctx.lineWidth = 2;

        for (let i = 0; i < nTurns; i++) {
            const t = i / (nTurns - 1);
            const cx = x - w / 2 + t * w;
            ctx.beginPath();
            ctx.ellipse(cx, cy, 4, h / 2, 0, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Connecting wires (top/bottom)
        ctx.strokeStyle = 'rgba(196,149,102,0.3)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - w / 2, cy - h / 2);
        ctx.lineTo(x - w / 2 - 20, cy - h / 2 - 15);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + w / 2, cy - h / 2);
        ctx.lineTo(x + w / 2 + 20, cy - h / 2 - 15);
        ctx.stroke();

        ctx.fillStyle = 'rgba(196,149,102,0.4)';
        ctx.font = '15px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('\u7ebf\u5708', x, cy + h / 2 + 14);
    },

    drawFieldLines(mx, cy, coilX) {
        const ctx = this.ctx;
        ctx.strokeStyle = 'rgba(139,111,192,0.15)';
        ctx.lineWidth = 1;

        for (let i = -2; i <= 2; i++) {
            const yOff = i * 18;
            ctx.beginPath();
            ctx.moveTo(mx + 30, cy + yOff);
            // Curved line toward coil
            const cpx = (mx + 30 + coilX) / 2;
            ctx.quadraticCurveTo(cpx, cy + yOff - i * 8, coilX, cy + yOff * 0.3);
            ctx.stroke();

            // Arrow
            const ax = coilX - 5;
            const ay = cy + yOff * 0.3;
            ctx.fillStyle = 'rgba(139,111,192,0.2)';
            ctx.beginPath();
            ctx.moveTo(ax, ay - 3);
            ctx.lineTo(ax + 6, ay);
            ctx.lineTo(ax, ay + 3);
            ctx.fill();
        }
    },

    drawEMFMeter(x, cy, emf) {
        const ctx = this.ctx;
        const r = 28;

        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, cy, r, 0, Math.PI * 2);
        ctx.stroke();

        // Needle
        const clampedEMF = Math.max(-1, Math.min(1, emf / 8));
        const angle = -Math.PI / 2 + clampedEMF * Math.PI / 3;
        ctx.strokeStyle = '#e06c75';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, cy);
        ctx.lineTo(x + Math.cos(angle) * (r - 5), cy + Math.sin(angle) * (r - 5));
        ctx.stroke();

        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '14px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText('\u03b5=' + emf.toFixed(1), x, cy + r + 12);
        ctx.fillText('EMF', x, cy - r - 4);
    },

    drawFluxBar(x, y, flux) {
        const ctx = this.ctx;
        const barW = 12, barH = 60;

        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - barW / 2, y, barW, barH);

        const fillH = flux * barH;
        ctx.fillStyle = 'rgba(139,111,192,0.4)';
        ctx.fillRect(x - barW / 2, y + barH - fillH, barW, fillH);

        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '14px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText('\u03a6', x, y - 4);
        ctx.fillText((flux * 100).toFixed(0) + '%', x, y + barH + 12);
    },

    /* ── education panel ── */
    updateInfo() {
        const el = document.getElementById('emi-info');
        if (!el) return;
        el.innerHTML = `<div class="ac-hd"><span class="ac-tag">电磁感应</span>法拉第电磁感应定律</div>
<div class="ac-row"><span class="ac-key">法拉第定律</span>ε = -dΦ/dt — 感应电动势等于磁通量变化率的负值</div>
<div class="ac-row"><span class="ac-key ac-key--purple">磁通量</span>Φ = BS·cosθ — 磁感应强度 × 面积 × cosθ（Wb）</div>
<div class="ac-row"><span class="ac-key ac-key--amber">楞次定律</span>感应电流的磁场总是阻碍引起它的磁通量的变化（"来拒去留"）</div>
<div class="ac-row"><span class="ac-key">导体切割</span>ε = BLv — 导体以速度 v 垂直切割磁力线时的感应电动势</div>
<div class="ac-row"><span class="ac-key ac-key--purple">右手定则</span>四指指向电流方向，大拇指指向导体运动方向（判断感应电流方向）</div>
<div class="ac-note">💡 人教版选择性必修2：磁铁越快穿过线圈 → 磁通量变化率越大 → 感应电动势越大。${this.mode === 'manual' ? '拖拽磁铁感受快慢对 ε 的影响' : '自动模式展示匀速往复'}</div>`;
    }
};

function initEMInduction() {
    EMInduction.init();
}

window.EMInduction = EMInduction;
window.initEMInduction = initEMInduction;