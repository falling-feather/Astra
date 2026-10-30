// ===== Alternating Current v2 =====
// AC waveform + phasor diagram + transformer — dt-driven, hover, education panel

const ACCircuit = {
    canvas: null, ctx: null, W: 0, H: 0,
    _listeners: [], _resizeObs: null, _raf: null,
    running: true, paused: false, speed: 1,
    time: 0, _lastT: 0,

    mode: 'waveform', // 'waveform' | 'phasor' | 'transformer'
    freq: 50,      // Hz
    peakV: 311,    // V (220V RMS ≈ 311V peak)
    phase: 30,     // degrees  (u leads i)
    n1: 100, n2: 50,

    hoverX: -1, hoverY: -1,

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    /* ── lifecycle ── */
    init() {
        this.canvas = document.getElementById('ac-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.time = 0; this._lastT = 0;
        this.running = true; this.paused = false; this.speed = 1;
        this.hoverX = -1; this.hoverY = -1;
        this.resize();
        this.bindEvents();
        this.updateInfo();
        this._lastT = performance.now();
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
        const w = wrap.getBoundingClientRect().width;
        const h = Math.min(Math.max(w * 0.5, 280), 400);
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w; this.H = h;
    },

    /* ── events ── */
    bindEvents() {
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver(() => this.resize());
            this._resizeObs.observe(this.canvas.parentElement);
        }
        // mode buttons
        document.querySelectorAll('.ac-mode-btn').forEach(btn => {
            this._on(btn, 'click', () => {
                document.querySelectorAll('.ac-mode-btn').forEach(b => {
                    b.classList.remove('active'); b.setAttribute('aria-pressed', 'false');
                });
                btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true');
                this.mode = btn.dataset.mode;
                this.time = 0;
                this.updateInfo();
            });
        });
        // sliders with live value
        const bind = (id, prop, valId) => {
            const s = document.getElementById(id);
            const v = document.getElementById(valId);
            if (s) this._on(s, 'input', () => {
                this[prop] = parseFloat(s.value);
                if (v) v.textContent = s.value;
                this.updateInfo();
            });
        };
        bind('ac-freq', 'freq', 'ac-freq-val');
        bind('ac-phase', 'phase', 'ac-phase-val');
        bind('ac-n1', 'n1', 'ac-n1-val');
        bind('ac-n2', 'n2', 'ac-n2-val');
        // speed
        const spd = document.getElementById('ac-speed');
        if (spd) this._on(spd, 'input', () => { this.speed = parseFloat(spd.value); });
        // pause
        const pb = document.getElementById('ac-pause');
        if (pb) this._on(pb, 'click', () => {
            this.paused = !this.paused;
            pb.textContent = this.paused ? '▶' : '⏸';
            pb.setAttribute('aria-label', this.paused ? '继续' : '暂停');
        });
        const rb = document.getElementById('ac-reset');
        if (rb) this._on(rb, 'click', () => this.resetScene());
        // hover
        this._on(this.canvas, 'mousemove', e => {
            const r = this.canvas.getBoundingClientRect();
            this.hoverX = e.clientX - r.left; this.hoverY = e.clientY - r.top;
        });
        this._on(this.canvas, 'mouseleave', () => { this.hoverX = -1; this.hoverY = -1; });
        this._on(this.canvas, 'touchmove', e => {
            const t = e.touches[0], r = this.canvas.getBoundingClientRect();
            this.hoverX = t.clientX - r.left; this.hoverY = t.clientY - r.top;
        }, { passive: true });
        this._on(this.canvas, 'touchend', () => { this.hoverX = -1; this.hoverY = -1; });
    },

    /* ── loop ── */
    loop() {
        if (!this.running) return;
        const now = performance.now();
        if (!this.paused) {
            const dt = Math.min((now - this._lastT) / 1000, 0.05);
            this.time += dt * this.speed;
        }
        this._lastT = now;
        this.draw();
        this._raf = requestAnimationFrame(() => this.loop());
    },

    resetScene() {
        this.time = 0;
        this.mode = 'waveform';
        this.freq = 50;
        this.phase = 30;
        this.n1 = 100;
        this.n2 = 50;
        this.speed = 1;
        this.paused = false;

        const setVal = (id, value, outId) => {
            const el = document.getElementById(id);
            const out = document.getElementById(outId);
            if (el) el.value = value;
            if (out) out.textContent = String(value);
        };
        setVal('ac-freq', 50, 'ac-freq-val');
        setVal('ac-phase', 30, 'ac-phase-val');
        setVal('ac-n1', 100, 'ac-n1-val');
        setVal('ac-n2', 50, 'ac-n2-val');
        const speed = document.getElementById('ac-speed');
        if (speed) speed.value = '1';

        const pb = document.getElementById('ac-pause');
        if (pb) {
            pb.textContent = '⏸';
            pb.setAttribute('aria-label', '暂停');
        }

        document.querySelectorAll('.ac-mode-btn').forEach(btn => {
            const active = btn.dataset.mode === 'waveform';
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });

        this.updateInfo();
        this.draw();
    },

    draw() {
        const { ctx, W, H, mode } = this;
        if (!ctx || W === 0) return;
        ctx.clearRect(0, 0, W, H);
        if (mode === 'waveform') this.drawWaveform();
        else if (mode === 'phasor') this.drawPhasor();
        else this.drawTransformer();
    },

    /* ════════ WAVEFORM ════════ */
    drawWaveform() {
        const { ctx, W, H, time, freq, peakV, phase } = this;
        const padL = 55, padR = 20, padT = 30, padB = 35;
        const gW = W - padL - padR, gH = H - padT - padB;
        const omega = 2 * Math.PI * freq;
        const phiRad = phase * Math.PI / 180;
        const T = 1 / freq, tRange = T * 3;
        const zeroY = padT + gH / 2;

        // grid
        ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
        for (let i = 1; i < 6; i++) { const y = padT + gH / 6 * i; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + gW, y); ctx.stroke(); }
        for (let i = 1; i <= 6; i++) { const x = padL + gW / 6 * i; ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + gH); ctx.stroke(); }

        // axes
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + gH); ctx.lineTo(padL + gW, padT + gH); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath(); ctx.moveTo(padL, zeroY); ctx.lineTo(padL + gW, zeroY); ctx.stroke();

        // y labels
        ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '14px ' + CF.mono; ctx.textAlign = 'right';
        ctx.fillText('+' + peakV + 'V', padL - 5, padT + 12);
        ctx.fillText('0', padL - 5, zeroY + 3);
        ctx.fillText('-' + peakV + 'V', padL - 5, padT + gH - 3);

        // x label + period markers
        ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.font = '15px ' + CF.sans; ctx.textAlign = 'center';
        ctx.fillText('t (ms)', padL + gW / 2, H - 5);
        ctx.font = '13px ' + CF.mono; ctx.fillStyle = 'rgba(255,255,255,0.15)';
        for (let i = 0; i <= 3; i++) ctx.fillText((i * T * 1000).toFixed(1), padL + i / 3 * gW, padT + gH + 13);

        // voltage gradient fill
        ctx.save(); ctx.beginPath(); ctx.moveTo(padL, zeroY);
        for (let i = 0; i <= gW; i++) {
            const v = peakV * Math.sin(omega * ((i / gW) * tRange + time));
            ctx.lineTo(padL + i, zeroY - v / peakV * (gH / 2 - 5));
        }
        ctx.lineTo(padL + gW, zeroY); ctx.closePath();
        const grd = ctx.createLinearGradient(0, padT, 0, padT + gH);
        grd.addColorStop(0, 'rgba(91,141,206,0.12)'); grd.addColorStop(0.5, 'rgba(91,141,206,0)'); grd.addColorStop(1, 'rgba(91,141,206,0.12)');
        ctx.fillStyle = grd; ctx.fill(); ctx.restore();

        // voltage curve
        ctx.strokeStyle = 'rgba(91,141,206,0.85)'; ctx.lineWidth = 2; ctx.beginPath();
        for (let i = 0; i <= gW; i++) {
            const v = peakV * Math.sin(omega * ((i / gW) * tRange + time));
            const x = padL + i, y = zeroY - v / peakV * (gH / 2 - 5);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();

        // current curve (phase-shifted dashed)
        ctx.strokeStyle = 'rgba(224,108,117,0.7)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]); ctx.beginPath();
        for (let i = 0; i <= gW; i++) {
            const v = peakV * 0.7 * Math.sin(omega * ((i / gW) * tRange + time) - phiRad);
            const x = padL + i, y = zeroY - v / peakV * (gH / 2 - 5);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke(); ctx.setLineDash([]);

        // RMS lines
        const rmsV = peakV / Math.SQRT2;
        const rmsY1 = zeroY - rmsV / peakV * (gH / 2 - 5);
        const rmsY2 = zeroY + rmsV / peakV * (gH / 2 - 5);
        ctx.strokeStyle = 'rgba(229,192,123,0.22)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(padL, rmsY1); ctx.lineTo(padL + gW, rmsY1);
        ctx.moveTo(padL, rmsY2); ctx.lineTo(padL + gW, rmsY2); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(229,192,123,0.4)'; ctx.font = '14px ' + CF.mono; ctx.textAlign = 'left';
        ctx.fillText('RMS=' + rmsV.toFixed(0) + 'V', padL + gW - 72, rmsY1 - 4);

        // legend
        ctx.fillStyle = 'rgba(91,141,206,0.7)'; ctx.fillRect(padL + 8, padT + 4, 14, 2);
        ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '14px ' + CF.sans; ctx.textAlign = 'left';
        ctx.fillText('电压 u(t)', padL + 26, padT + 9);
        ctx.fillStyle = 'rgba(224,108,117,0.6)'; ctx.fillRect(padL + 8, padT + 16, 14, 2);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillText('电流 i(t)  φ=' + phase + '°', padL + 26, padT + 21);

        // top-right formula
        ctx.fillStyle = 'rgba(139,111,192,0.5)'; ctx.font = '15px ' + CF.mono; ctx.textAlign = 'right';
        ctx.fillText('f=' + freq + 'Hz  T=' + (T * 1000).toFixed(1) + 'ms  ω=' + omega.toFixed(0) + 'rad/s', padL + gW, padT + 10);

        // hover crosshair
        if (this.hoverX >= padL && this.hoverX <= padL + gW && this.hoverY >= padT && this.hoverY <= padT + gH) {
            const hx = this.hoverX;
            ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(hx, padT); ctx.lineTo(hx, padT + gH); ctx.stroke();
            const tH = ((hx - padL) / gW) * tRange + time;
            const vH = peakV * Math.sin(omega * tH);
            const iH = peakV * 0.7 * Math.sin(omega * tH - phiRad);
            const vyH = zeroY - vH / peakV * (gH / 2 - 5);
            const iyH = zeroY - iH / peakV * (gH / 2 - 5);
            // dots
            ctx.fillStyle = 'rgba(91,141,206,1)'; ctx.beginPath(); ctx.arc(hx, vyH, 4, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = 'rgba(224,108,117,1)'; ctx.beginPath(); ctx.arc(hx, iyH, 4, 0, Math.PI * 2); ctx.fill();
            // tooltip
            const tx = Math.min(hx + 10, W - 120), ty = Math.max(this.hoverY - 46, padT + 2);
            ctx.fillStyle = 'rgba(20,22,30,0.88)'; ctx.beginPath(); ctx.roundRect(tx, ty, 112, 40, 4); ctx.fill();
            ctx.font = '14px ' + CF.mono; ctx.textAlign = 'left';
            ctx.fillStyle = 'rgba(91,141,206,0.95)'; ctx.fillText('u = ' + vH.toFixed(1) + ' V', tx + 6, ty + 14);
            ctx.fillStyle = 'rgba(224,108,117,0.95)'; ctx.fillText('i ∝ ' + (iH / peakV * 100).toFixed(1) + '%', tx + 6, ty + 27);
            ctx.fillStyle = 'rgba(229,192,123,0.8)'; ctx.fillText('p ∝ ' + (vH * iH / peakV / peakV * 100).toFixed(1) + '%', tx + 6, ty + 39);
        }
    },

    /* ════════ PHASOR ════════ */
    drawPhasor() {
        const { ctx, W, H, time, freq, peakV, phase } = this;
        const omega = 2 * Math.PI * freq;
        const phiRad = phase * Math.PI / 180;
        const angle = omega * time;

        // ── left: phasor circle ──
        const cx = W * 0.28, cy = H * 0.50;
        const R = Math.min(W * 0.18, H * 0.34);

        // reference circle + axes
        ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - R - 8, cy); ctx.lineTo(cx + R + 8, cy);
        ctx.moveTo(cx, cy - R - 8); ctx.lineTo(cx, cy + R + 8); ctx.stroke();

        // voltage phasor
        const vx = cx + R * Math.cos(-angle), vy = cy + R * Math.sin(-angle);
        ctx.strokeStyle = 'rgba(91,141,206,0.9)'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(vx, vy); ctx.stroke();
        this._arrow(ctx, cx, cy, vx, vy, 'rgba(91,141,206,0.9)', 8);
        ctx.fillStyle = 'rgba(91,141,206,0.9)'; ctx.font = 'bold 17px ' + CF.sans; ctx.textAlign = 'center';
        const va = Math.atan2(vy - cy, vx - cx);
        ctx.fillText('U', vx + 12 * Math.cos(va), vy + 12 * Math.sin(va));

        // current phasor
        const iAngle = angle - phiRad;
        const iR = R * 0.7;
        const ix = cx + iR * Math.cos(-iAngle), iy = cy + iR * Math.sin(-iAngle);
        ctx.strokeStyle = 'rgba(224,108,117,0.8)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ix, iy); ctx.stroke();
        this._arrow(ctx, cx, cy, ix, iy, 'rgba(224,108,117,0.8)', 7);
        ctx.fillStyle = 'rgba(224,108,117,0.9)'; ctx.font = 'bold 17px ' + CF.sans;
        const iaA = Math.atan2(iy - cy, ix - cx);
        ctx.fillText('I', ix + 12 * Math.cos(iaA), iy + 12 * Math.sin(iaA));

        // phase arc
        if (Math.abs(phase) > 0.5) {
            ctx.strokeStyle = 'rgba(229,192,123,0.5)'; ctx.lineWidth = 1.5;
            const arcR = R * 0.28;
            const aStart = -angle, aEnd = -iAngle;
            ctx.beginPath(); ctx.arc(cx, cy, arcR, aStart, aEnd, phase > 0); ctx.stroke();
            const midA = -(angle - phiRad / 2);
            ctx.fillStyle = 'rgba(229,192,123,0.7)'; ctx.font = '15px ' + CF.mono;
            ctx.fillText('φ=' + phase + '°', cx + arcR * 1.4 * Math.cos(midA), cy + arcR * 1.4 * Math.sin(midA));
        }

        // ── right: sine projection ──
        const projX = W * 0.54, projW = W * 0.42, projCY = cy;
        const halfH = H * 0.34;

        // axes
        ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(projX, projCY - halfH - 5); ctx.lineTo(projX, projCY + halfH + 5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(projX, projCY); ctx.lineTo(projX + projW, projCY); ctx.stroke();

        // projection dashed line from phasor tip
        ctx.strokeStyle = 'rgba(91,141,206,0.2)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(vx, vy); ctx.lineTo(projX, vy); ctx.stroke(); ctx.setLineDash([]);

        // voltage sine
        ctx.strokeStyle = 'rgba(91,141,206,0.65)'; ctx.lineWidth = 1.5; ctx.beginPath();
        for (let i = 0; i <= projW; i++) {
            const a = angle + (i / projW) * Math.PI * 3;
            const py = projCY - Math.sin(a) * halfH;
            i === 0 ? ctx.moveTo(projX + i, py) : ctx.lineTo(projX + i, py);
        }
        ctx.stroke();

        // current sine
        ctx.strokeStyle = 'rgba(224,108,117,0.5)'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.beginPath();
        for (let i = 0; i <= projW; i++) {
            const a = iAngle + (i / projW) * Math.PI * 3;
            const py = projCY - 0.7 * Math.sin(a) * halfH;
            i === 0 ? ctx.moveTo(projX + i, py) : ctx.lineTo(projX + i, py);
        }
        ctx.stroke(); ctx.setLineDash([]);

        // dot at projection
        ctx.fillStyle = 'rgba(91,141,206,1)'; ctx.beginPath(); ctx.arc(projX, vy, 4, 0, Math.PI * 2); ctx.fill();

        // labels
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = '15px ' + CF.sans; ctx.textAlign = 'center';
        ctx.fillText('旋转相量', cx, H - 8);
        ctx.fillText('正弦投影', projX + projW / 2, H - 8);

        // ω info
        ctx.fillStyle = 'rgba(139,111,192,0.5)'; ctx.font = '15px ' + CF.mono; ctx.textAlign = 'left';
        ctx.fillText('ω = 2πf = ' + omega.toFixed(0) + ' rad/s', 10, 18);

        // rotation arrow hint
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx, cy, R + 8, -0.3, -1.2, true); ctx.stroke();
        this._arrow(ctx, cx + (R + 8) * Math.cos(-1.1), cy + (R + 8) * Math.sin(-1.1),
            cx + (R + 8) * Math.cos(-1.25), cy + (R + 8) * Math.sin(-1.25), 'rgba(255,255,255,0.12)', 5);
    },

    /* ════════ TRANSFORMER ════════ */
    drawTransformer() {
        const { ctx, W, H, time, n1, n2, peakV, freq } = this;
        const cx = W / 2, cy = H / 2;

        // iron core
        const coreW = W * 0.22, coreH = H * 0.38;
        const cg = ctx.createLinearGradient(cx - coreW / 2, 0, cx + coreW / 2, 0);
        cg.addColorStop(0, 'rgba(100,100,120,0.12)'); cg.addColorStop(0.5, 'rgba(100,100,120,0.22)'); cg.addColorStop(1, 'rgba(100,100,120,0.12)');
        ctx.fillStyle = cg; ctx.fillRect(cx - coreW / 2, cy - coreH / 2, coreW, coreH);
        ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 2;
        ctx.strokeRect(cx - coreW / 2, cy - coreH / 2, coreW, coreH);
        // lamination
        ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
        for (let i = 1; i < 5; i++) { const x = cx - coreW / 2 + coreW / 5 * i; ctx.beginPath(); ctx.moveTo(x, cy - coreH / 2 + 2); ctx.lineTo(x, cy + coreH / 2 - 2); ctx.stroke(); }

        // primary coil (blue)
        const pX = cx - coreW / 2 - 10, pTurns = 8, pH = coreH * 0.8;
        ctx.strokeStyle = 'rgba(91,141,206,0.6)'; ctx.lineWidth = 2.5;
        for (let i = 0; i < pTurns; i++) {
            const y = cy - pH / 2 + (i + 0.5) * pH / pTurns;
            ctx.beginPath(); ctx.arc(pX, y, 7, Math.PI * 0.5, Math.PI * 1.5); ctx.stroke();
        }

        // secondary coil (red)
        const sX = cx + coreW / 2 + 10;
        const sTurns = Math.max(2, Math.round(pTurns * n2 / n1));
        const sH = coreH * 0.8;
        ctx.strokeStyle = 'rgba(224,108,117,0.6)'; ctx.lineWidth = 2.5;
        for (let i = 0; i < sTurns; i++) {
            const y = cy - sH / 2 + (i + 0.5) * sH / sTurns;
            ctx.beginPath(); ctx.arc(sX, y, 7, -Math.PI * 0.5, Math.PI * 0.5); ctx.stroke();
        }

        // flux arrows
        const sinFlux = Math.sin(2 * Math.PI * freq * time);
        ctx.strokeStyle = `rgba(229,192,123,${(0.15 + 0.15 * Math.abs(sinFlux)).toFixed(2)})`;
        ctx.lineWidth = 1.5;
        const fluxDir = sinFlux >= 0 ? 1 : -1;
        for (let i = 0; i < 5; i++) {
            const raw = (i * 0.2 + time * freq * 0.08 * fluxDir) % 1;
            const yOff = (raw - 0.5) * coreH * 0.7;
            const fy = cy + yOff;
            ctx.beginPath(); ctx.moveTo(cx - 10, fy); ctx.lineTo(cx + 10, fy); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(cx + 6, fy - 3); ctx.lineTo(cx + 10, fy); ctx.lineTo(cx + 6, fy + 3); ctx.stroke();
        }

        // AC source
        const asX = pX - 55, asY = cy;
        ctx.strokeStyle = 'rgba(91,141,206,0.4)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(asX, asY, 14, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(asX - 7, asY); ctx.bezierCurveTo(asX - 3, asY - 7, asX + 3, asY + 7, asX + 7, asY); ctx.stroke();
        // wires
        ctx.strokeStyle = 'rgba(91,141,206,0.25)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(asX, asY - 14); ctx.lineTo(asX, cy - pH / 2); ctx.lineTo(pX - 7, cy - pH / 2 + pH / (2 * pTurns)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(asX, asY + 14); ctx.lineTo(asX, cy + pH / 2); ctx.lineTo(pX - 7, cy + pH / 2 - pH / (2 * pTurns)); ctx.stroke();
        // current arrow
        if (Math.abs(sinFlux) > 0.1) {
            const ay = cy - pH / 2 + 15, dy = sinFlux > 0 ? 15 : -15;
            this._arrow(ctx, asX, ay, asX, ay + dy, 'rgba(91,141,206,0.45)', 6);
        }

        // load
        const ldX = sX + 55;
        ctx.strokeStyle = 'rgba(224,108,117,0.25)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(sX + 7, cy - sH / 2 + sH / (2 * sTurns)); ctx.lineTo(ldX, cy - sH / 2 + sH / (2 * sTurns)); ctx.lineTo(ldX, cy - 18); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(sX + 7, cy + sH / 2 - sH / (2 * sTurns)); ctx.lineTo(ldX, cy + sH / 2 - sH / (2 * sTurns)); ctx.lineTo(ldX, cy + 18); ctx.stroke();
        // resistor
        ctx.strokeStyle = 'rgba(224,108,117,0.4)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(ldX, cy - 18);
        for (let i = 0; i < 5; i++) ctx.lineTo(ldX + (i % 2 === 0 ? 7 : -7), cy - 18 + (i + 1) * 7.2);
        ctx.lineTo(ldX, cy + 18); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.font = '14px ' + CF.sans; ctx.textAlign = 'center';
        ctx.fillText('R', ldX + 14, cy + 3);

        // labels
        ctx.font = '15px ' + CF.sans; ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(91,141,206,0.6)'; ctx.fillText('初级 N₁=' + n1, pX - 20, cy + coreH / 2 + 22);
        ctx.fillStyle = 'rgba(224,108,117,0.6)'; ctx.fillText('次级 N₂=' + n2, sX + 20, cy + coreH / 2 + 22);

        // voltage info
        const ratio = n2 / n1;
        const v1r = (peakV / Math.SQRT2).toFixed(0), v2r = (peakV * ratio / Math.SQRT2).toFixed(0);
        ctx.fillStyle = 'rgba(229,192,123,0.5)'; ctx.font = '16px ' + CF.mono;
        ctx.fillText('U₁/U₂ = N₁/N₂', cx, cy - coreH / 2 - 28);
        ctx.fillText(v1r + 'V → ' + v2r + 'V  (' + (ratio > 1 ? '升压' : ratio < 1 ? '降压' : '等压') + ')', cx, cy - coreH / 2 - 12);
        ctx.fillStyle = 'rgba(229,192,123,0.3)'; ctx.font = '14px ' + CF.sans; ctx.fillText('Φ', cx, cy + 2);

        // power
        ctx.fillStyle = 'rgba(139,111,192,0.4)'; ctx.font = '15px ' + CF.mono;
        ctx.fillText('理想变压器: P₁ = P₂  →  I₁/I₂ = N₂/N₁', cx, H - 10);

        // hover tooltip
        if (this.hoverX > 0 && this.hoverY > 0) {
            let tip = '';
            const d = (ax, ay, r) => Math.abs(this.hoverX - ax) < r && Math.abs(this.hoverY - ay) < r;
            if (Math.abs(this.hoverX - pX) < 20 && Math.abs(this.hoverY - cy) < pH / 2) tip = '初级线圈 N₁=' + n1 + '，接交流电源';
            else if (Math.abs(this.hoverX - sX) < 20 && Math.abs(this.hoverY - cy) < sH / 2) tip = '次级线圈 N₂=' + n2 + '，接负载';
            else if (Math.abs(this.hoverX - cx) < coreW / 2 && Math.abs(this.hoverY - cy) < coreH / 2) tip = '硅钢片铁芯: 减少涡流损耗+导磁';
            else if (d(asX, asY, 18)) tip = '交流电源 f=' + freq + 'Hz';
            else if (d(ldX, cy, 20)) tip = '负载电阻 R';
            if (tip) {
                const tw = ctx.measureText(tip).width + 16;
                const tx2 = Math.min(this.hoverX + 12, W - tw - 5), ty2 = Math.max(this.hoverY - 28, 5);
                ctx.fillStyle = 'rgba(20,22,30,0.88)'; ctx.beginPath(); ctx.roundRect(tx2, ty2, tw, 22, 4); ctx.fill();
                ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '14px ' + CF.sans; ctx.textAlign = 'left';
                ctx.fillText(tip, tx2 + 8, ty2 + 15);
            }
        }
    },

    /* ── helpers ── */
    _arrow(ctx, x1, y1, x2, y2, color, sz) {
        const a = Math.atan2(y2 - y1, x2 - x1);
        ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - sz * Math.cos(a - 0.35), y2 - sz * Math.sin(a - 0.35));
        ctx.lineTo(x2 - sz * Math.cos(a + 0.35), y2 - sz * Math.sin(a + 0.35));
        ctx.fill();
    },

    /* ── education panel ── */
    updateInfo() {
        const el = document.getElementById('ac-info');
        if (!el) return;
        const { mode, freq, peakV, phase, n1, n2 } = this;
        const T = 1 / freq, omega = 2 * Math.PI * freq;
        const rms = (peakV / Math.SQRT2).toFixed(0);
        let h = '';
        if (mode === 'waveform') {
            const phaseDesc = phase > 0 ? '电压超前电流（感性负载 L）' : phase < 0 ? '电流超前电压（容性负载 C）' : '同相位（纯电阻 R）';
            h = `<div class="ac-hd"><span class="ac-tag">波形</span>正弦交变电流</div>
<div class="ac-row"><span class="ac-key">瞬时表达式</span>u(t) = ${peakV}·sin(${omega.toFixed(0)}t) V</div>
<div class="ac-row"><span class="ac-key ac-key--purple">有效值</span>U<sub>rms</sub> = U<sub>m</sub>/√2 = ${rms} V（市电有效值 220V）</div>
<div class="ac-row"><span class="ac-key ac-key--amber">相位差</span>φ = ${phase}° — ${phaseDesc}</div>
<div class="ac-note">💡 交流电有效值：使同一电阻产生相同热量的等效直流值。T = ${(T * 1000).toFixed(1)}ms</div>`;
        } else if (mode === 'phasor') {
            h = `<div class="ac-hd"><span class="ac-tag ac-tag--amber">相量</span>旋转矢量法</div>
<div class="ac-row"><span class="ac-key">核心思想</span>匀速旋转矢量在纵轴的投影 = 正弦函数值</div>
<div class="ac-row"><span class="ac-key ac-key--purple">角速度</span>ω = 2πf = ${omega.toFixed(0)} rad/s</div>
<div class="ac-row"><span class="ac-key ac-key--amber">相位关系</span>U 与 I 夹角 φ = ${phase}°，投影波形产生相移</div>
<div class="ac-note">💡 相量图将含时正弦函数简化为静态矢量运算，是分析 RLC 电路的核心工具</div>`;
        } else {
            const ratio = n2 / n1, v2r = (peakV * ratio / Math.SQRT2).toFixed(0);
            const typeDesc = ratio > 1 ? '升压变压器' : ratio < 1 ? '降压变压器' : '隔离变压器';
            h = `<div class="ac-hd"><span class="ac-tag ac-tag--red">变压器</span>电磁感应原理</div>
<div class="ac-row"><span class="ac-key">电压比</span>U₁/U₂ = N₁/N₂ = ${n1}/${n2} = ${(n1 / n2).toFixed(2)}</div>
<div class="ac-row"><span class="ac-key ac-key--purple">输出电压</span>${rms}V → ${v2r}V（${typeDesc}）</div>
<div class="ac-row"><span class="ac-key ac-key--amber">功率守恒</span>P₁ = P₂ → I₁U₁ = I₂U₂ → I₁/I₂ = N₂/N₁</div>
<div class="ac-note">💡 变压器利用互感：初级交变电流 → 交变磁通Φ → 次级感应电动势。只能变换交流电</div>`;
        }
        el.innerHTML = h;
    }
};

function initACCircuit() { ACCircuit.init(); }
window.ACCircuit = ACCircuit;
window.initACCircuit = initACCircuit;