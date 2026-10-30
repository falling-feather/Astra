// ===== Neural Regulation Visualization v2 =====
// Synapse: Ca²⁺ channel → vesicle exocytosis → neurotransmitter diffusion → receptor binding
// Action potential: Na⁺/K⁺ channel gating diagram + voltage curve + ion flow

const NeuralReg = {
    canvas: null, ctx: null, W: 0, H: 0,
    _listeners: [], _resizeObs: null, _raf: null,
    _prevT: 0, running: true, speed: 1,
    mode: 'synapse',
    phase: 0,           // 0→1 animation progress
    _replayWait: 0,     // pause time at end before auto-replay

    // Synapse entities
    vesicles: [], neurotransmitters: [], caIons: [], receptorStates: [],

    // Hover
    hoverX: -1, hoverY: -1, hoverLabel: '',

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        this.canvas = document.getElementById('neural-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this._prevT = performance.now();
        this.phase = 0;
        this._replayWait = 0;
        this.running = true;
        this.speed = 1;
        this.hoverLabel = '';
        this.resize();
        this.initSynapseState();
        this.bindEvents();
        this.updateInfo();
        this.canvas.setAttribute('role', 'img');
        this.canvas.setAttribute('aria-label', '神经调节可视化：化学突触传递与动作电位变化');
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
        const wrap = this.canvas.parentElement;
        if (!wrap) return;
        const dpr = window.devicePixelRatio || 1;
        const w = wrap.getBoundingClientRect().width;
        const h = Math.min(Math.max(w * 0.48, 280), 400);
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w; this.H = h;
    },

    initSynapseState() {
        this.vesicles = [];
        for (let i = 0; i < 6; i++) {
            this.vesicles.push({
                bx: 0.28 + (i % 3) * 0.04,
                by: 0.36 + Math.floor(i / 3) * 0.14 + Math.random() * 0.06,
                r: 4 + Math.random() * 2,
                released: false, fused: false, fuseP: 0
            });
        }
        this.neurotransmitters = [];
        this.caIons = [];
        this.receptorStates = [];
        for (let i = 0; i < 7; i++) this.receptorStates.push({ open: false, bindP: 0 });
    },

    bindEvents() {
        const wrap = this.canvas.parentElement;
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver(() => this.resize());
            this._resizeObs.observe(wrap);
        }

        // Mode buttons
        document.querySelectorAll('.neural-mode-btn').forEach(btn => {
            if (!btn.dataset.mode) return;
            this._on(btn, 'click', () => {
                document.querySelectorAll('.neural-mode-btn[data-mode]').forEach(b => {
                    b.classList.remove('active'); b.setAttribute('aria-pressed', 'false');
                });
                btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true');
                this.mode = btn.dataset.mode;
                this.phase = 0; this._replayWait = 0;
                this.initSynapseState();
                this.updateInfo();
            });
        });

        // Fire / replay
        const fireBtn = document.getElementById('neural-fire');
        if (fireBtn) {
            this._on(fireBtn, 'click', () => {
                this.phase = 0; this._replayWait = 0;
                this.initSynapseState();
            });
        }

        // Speed slider
        const speedSlider = document.getElementById('neural-speed');
        const speedVal = document.getElementById('neural-speed-val');
        if (speedSlider) {
            this._on(speedSlider, 'input', () => {
                this.speed = parseFloat(speedSlider.value);
                if (speedVal) speedVal.textContent = this.speed.toFixed(1) + 'x';
            });
        }

        // Pause
        const pauseBtn = document.getElementById('neural-pause');
        if (pauseBtn) {
            this._on(pauseBtn, 'click', () => {
                this.running = !this.running;
                pauseBtn.textContent = this.running ? '⏸ 暂停' : '▶ 继续';
                pauseBtn.setAttribute('aria-pressed', String(!this.running));
                if (this.running) { this._prevT = performance.now(); this.loop(); }
            });
        }

        // Hover
        this._on(this.canvas, 'mousemove', (e) => {
            const r = this.canvas.getBoundingClientRect();
            this.hoverX = e.clientX - r.left; this.hoverY = e.clientY - r.top;
        });
        this._on(this.canvas, 'mouseleave', () => { this.hoverX = -1; this.hoverLabel = ''; });
        this._on(this.canvas, 'touchmove', (e) => {
            const t = e.touches[0]; const r = this.canvas.getBoundingClientRect();
            this.hoverX = t.clientX - r.left; this.hoverY = t.clientY - r.top;
        }, { passive: true });
        this._on(this.canvas, 'touchend', () => { this.hoverX = -1; this.hoverLabel = ''; });
    },

    loop() {
        if (!this.running) return;
        const now = performance.now();
        const rawDt = (now - this._prevT) / 1000;
        this._prevT = now;
        const dt = Math.min(rawDt, 0.05) * this.speed;

        // Advance phase
        if (this.phase < 1) {
            this.phase = Math.min(1, this.phase + dt * 0.15);
        } else {
            this._replayWait += dt;
            if (this._replayWait > 2.5) {
                this.phase = 0; this._replayWait = 0;
                this.initSynapseState();
            }
        }

        this.update(dt);
        this.draw();
        this._raf = requestAnimationFrame(() => this.loop());
    },

    update(dt) {
        if (this.mode === 'synapse') this.updateSynapse(dt);
    },

    updateSynapse(dt) {
        const { phase, vesicles, neurotransmitters, caIons, receptorStates, W, H } = this;

        // Ca²⁺ influx (phase 0.3-0.55)
        if (phase > 0.3 && phase < 0.55 && caIons.length < 15) {
            if (Math.random() < dt * 8) {
                caIons.push({
                    x: W * 0.36, y: H * 0.15 + Math.random() * H * 0.7,
                    tx: W * 0.28 + Math.random() * W * 0.06,
                    ty: H * 0.35 + Math.random() * H * 0.3,
                    p: 0, spd: 0.8 + Math.random() * 0.5
                });
            }
        }
        for (const c of caIons) c.p = Math.min(1, c.p + dt * c.spd);

        // Vesicle fusion (phase 0.45+)
        if (phase > 0.45) {
            for (const v of vesicles) {
                if (!v.released && !v.fused) v.fused = true;
                if (v.fused && !v.released) {
                    v.fuseP = Math.min(1, v.fuseP + dt * 1.2);
                    if (v.fuseP >= 1) {
                        v.released = true;
                        const vx = v.bx * W, vy = v.by * H;
                        for (let n = 0; n < 3; n++) {
                            neurotransmitters.push({
                                x: vx, y: vy,
                                tx: W * 0.55, ty: H * (0.22 + Math.random() * 0.56),
                                p: 0, spd: 0.5 + Math.random() * 0.4, bound: false
                            });
                        }
                    }
                }
            }
        }

        // Neurotransmitter crossing
        for (const nt of neurotransmitters) {
            if (!nt.bound) { nt.p = Math.min(1, nt.p + dt * nt.spd); if (nt.p >= 1) nt.bound = true; }
        }

        // Receptor activation
        const bc = neurotransmitters.filter(nt => nt.bound).length;
        for (let i = 0; i < receptorStates.length; i++) {
            if (bc > i * 2) {
                receptorStates[i].open = true;
                receptorStates[i].bindP = Math.min(1, receptorStates[i].bindP + dt * 2);
            }
        }
    },

    draw() {
        const { ctx, W, H, mode } = this;
        if (!ctx || W === 0) return;
        ctx.clearRect(0, 0, W, H);
        if (mode === 'synapse') this.drawSynapse();
        else this.drawActionPotential();
        this.drawTooltip();
    },

    /* ─── Synapse drawing ─── */
    drawSynapse() {
        const { ctx, W, H, phase, vesicles, neurotransmitters, caIons, receptorStates } = this;
        const midY = H * 0.5;
        const fs = Math.max(14, W * 0.014);

        // Presynaptic cell body
        const cellGrad = ctx.createRadialGradient(W * 0.12, midY, 0, W * 0.12, midY, W * 0.16);
        cellGrad.addColorStop(0, 'rgba(139,111,192,0.18)');
        cellGrad.addColorStop(1, 'rgba(139,111,192,0.02)');
        ctx.fillStyle = cellGrad;
        ctx.beginPath();
        ctx.ellipse(W * 0.12, midY, W * 0.16, H * 0.38, 0, 0, Math.PI * 2);
        ctx.fill();

        // Axon
        ctx.strokeStyle = 'rgba(139,111,192,0.25)';
        ctx.lineWidth = 8;
        ctx.beginPath(); ctx.moveTo(W * 0.24, midY); ctx.lineTo(W * 0.36, midY); ctx.stroke();

        // Myelin sheath
        for (let i = 0; i < 3; i++) {
            ctx.fillStyle = 'rgba(200,200,200,0.07)';
            ctx.fillRect(W * (0.25 + i * 0.035), midY - 8, W * 0.025, 16);
        }

        // Presynaptic terminal
        const termX = W * 0.37;
        const tGrad = ctx.createRadialGradient(termX, midY, 0, termX, midY, 42);
        tGrad.addColorStop(0, 'rgba(139,111,192,0.28)');
        tGrad.addColorStop(1, 'rgba(139,111,192,0.04)');
        ctx.fillStyle = tGrad;
        ctx.beginPath(); ctx.arc(termX, midY, 42, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(139,111,192,0.2)'; ctx.lineWidth = 1.5; ctx.stroke();

        // Mitochondria
        ctx.strokeStyle = 'rgba(229,192,123,0.22)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(termX - 14, midY + 22, 10, 5, 0.3, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath();
        for (let i = 0; i < 3; i++) { ctx.moveTo(termX - 19 + i * 5, midY + 20); ctx.lineTo(termX - 19 + i * 5, midY + 24); }
        ctx.stroke();

        // Ca²⁺ channels
        const caChX = W * 0.37 + 40;
        for (let i = -2; i <= 2; i++) {
            const cy = midY + i * 16;
            const open = phase > 0.3;
            ctx.fillStyle = open ? 'rgba(229,192,123,0.5)' : 'rgba(229,192,123,0.18)';
            ctx.fillRect(caChX - 3, cy - 4, 6, 8);
            if (i === 0) {
                ctx.fillStyle = 'rgba(229,192,123,0.4)';
                ctx.font = Math.max(13, W * 0.024) + 'px ' + CF.mono;
                ctx.textAlign = 'left';
                ctx.fillText('Ca²⁺', caChX + 7, cy + 3);
            }
        }

        // Ca²⁺ ions
        ctx.fillStyle = 'rgba(229,192,123,0.6)';
        for (const c of caIons) {
            const cx = c.x + (c.tx - c.x) * c.p;
            const cy = c.y + (c.ty - c.y) * c.p;
            ctx.beginPath(); ctx.arc(cx, cy, 2, 0, Math.PI * 2); ctx.fill();
        }

        // Vesicles
        for (const v of vesicles) {
            const vx = v.bx * W, vy = v.by * H;
            if (v.released) continue;
            if (v.fused) {
                const a = 1 - v.fuseP * 0.7;
                ctx.fillStyle = `rgba(229,192,123,${(a * 0.5).toFixed(2)})`;
                ctx.beginPath();
                ctx.ellipse(vx + v.fuseP * 12, vy, v.r * (1 + v.fuseP * 0.5), Math.max(1, v.r * (1 - v.fuseP * 0.6)), 0, 0, Math.PI * 2);
                ctx.fill();
            } else {
                const vG = ctx.createRadialGradient(vx - 1, vy - 1, 0, vx, vy, v.r);
                vG.addColorStop(0, 'rgba(229,192,123,0.55)'); vG.addColorStop(1, 'rgba(229,192,123,0.15)');
                ctx.fillStyle = vG;
                ctx.beginPath(); ctx.arc(vx, vy, v.r, 0, Math.PI * 2); ctx.fill();
                // Dots inside
                ctx.fillStyle = 'rgba(224,108,117,0.45)';
                for (let d = 0; d < 3; d++) {
                    const a = d * Math.PI * 2 / 3 + phase * 2;
                    ctx.beginPath(); ctx.arc(vx + Math.cos(a) * 2, vy + Math.sin(a) * 2, 1, 0, Math.PI * 2); ctx.fill();
                }
            }
        }

        // Synaptic cleft
        const cleftL = W * 0.41, cleftR = W * 0.53;
        ctx.fillStyle = 'rgba(255,255,255,0.012)';
        ctx.fillRect(cleftL, H * 0.12, cleftR - cleftL, H * 0.76);
        ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 0.5; ctx.setLineDash([3, 5]);
        ctx.beginPath(); ctx.moveTo(cleftL, H * 0.12); ctx.lineTo(cleftL, H * 0.88);
        ctx.moveTo(cleftR, H * 0.12); ctx.lineTo(cleftR, H * 0.88); ctx.stroke(); ctx.setLineDash([]);

        // Neurotransmitters
        for (const nt of neurotransmitters) {
            const nx = nt.x + (nt.tx - nt.x) * nt.p;
            const ny = nt.y + (nt.ty - nt.y) * nt.p;
            ctx.fillStyle = nt.bound ? 'rgba(58,158,143,0.65)' : 'rgba(224,108,117,0.55)';
            ctx.beginPath();
            ctx.moveTo(nx, ny - 3); ctx.lineTo(nx + 2.5, ny); ctx.lineTo(nx, ny + 3); ctx.lineTo(nx - 2.5, ny);
            ctx.closePath(); ctx.fill();
        }

        // Postsynaptic membrane
        const pGrad = ctx.createRadialGradient(W * 0.72, midY, 0, W * 0.72, midY, W * 0.2);
        pGrad.addColorStop(0, 'rgba(58,158,143,0.14)'); pGrad.addColorStop(1, 'rgba(58,158,143,0.02)');
        ctx.fillStyle = pGrad;
        ctx.beginPath(); ctx.ellipse(W * 0.72, midY, W * 0.2, H * 0.38, 0, 0, Math.PI * 2); ctx.fill();

        // Receptors
        for (let i = 0; i < receptorStates.length; i++) {
            const ry = H * 0.18 + i * (H * 0.64 / (receptorStates.length - 1));
            const rs = receptorStates[i];
            ctx.strokeStyle = rs.open ? 'rgba(58,158,143,0.65)' : 'rgba(58,158,143,0.25)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(cleftR, ry); ctx.lineTo(cleftR + 8, ry - 3);
            ctx.moveTo(cleftR, ry); ctx.lineTo(cleftR + 8, ry + 3);
            ctx.stroke();
            if (rs.open) {
                ctx.fillStyle = 'rgba(58,158,143,0.4)';
                ctx.beginPath(); ctx.arc(cleftR + 10, ry, 3, 0, Math.PI * 2); ctx.fill();
                if (rs.bindP > 0.5) {
                    ctx.fillStyle = 'rgba(97,175,239,0.35)';
                    ctx.beginPath(); ctx.arc(cleftR + 10 + rs.bindP * 14, ry, 1.5, 0, Math.PI * 2); ctx.fill();
                }
            }
        }

        // Dendrites
        ctx.strokeStyle = 'rgba(58,158,143,0.12)'; ctx.lineWidth = 3;
        for (let d = 0; d < 4; d++) {
            const a = -0.5 + d * 0.35;
            ctx.beginPath();
            ctx.moveTo(W * 0.85, midY + Math.sin(a) * H * 0.3);
            ctx.quadraticCurveTo(W * 0.92, midY + Math.sin(a) * H * 0.35, W * 0.97, midY + Math.sin(a) * H * 0.4);
            ctx.stroke();
        }

        // Signal wave
        if (phase > 0 && phase < 0.4) {
            const wX = W * 0.05 + (phase / 0.4) * (W * 0.36 - W * 0.05);
            ctx.strokeStyle = 'rgba(229,192,123,0.5)'; ctx.lineWidth = 2;
            ctx.beginPath();
            for (let i = -15; i <= 15; i++) {
                const px = wX + i, py = midY + Math.sin(i * 0.3) * 6 * Math.exp(-i * i / 80);
                i === -15 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
            }
            ctx.stroke();
        }

        // Labels
        ctx.font = `${fs}px ${CF.sans}`; ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(139,111,192,0.45)'; ctx.fillText('突触前膜', W * 0.15, H * 0.93);
        ctx.fillStyle = 'rgba(58,158,143,0.45)'; ctx.fillText('突触后膜', W * 0.75, H * 0.93);
        ctx.fillStyle = 'rgba(255,255,255,0.13)'; ctx.fillText('突触间隙', (cleftL + cleftR) / 2, H * 0.08);

        // Status line
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = `${fs}px ${CF.sans}`; ctx.textAlign = 'left';
        let s = '';
        if (phase < 0.15) s = '① 静息状态 (膜电位 -70mV)';
        else if (phase < 0.35) s = '② 动作电位沿轴突传导 →';
        else if (phase < 0.5) s = '③ Ca²⁺内流 → 突触小泡向前膜移动';
        else if (phase < 0.65) s = '④ 突触小泡与前膜融合(胞吐) → 递质释放';
        else if (phase < 0.8) s = '⑤ 神经递质扩散穿越间隙 → 与受体结合';
        else s = '⑥ 受体通道改变 → 产生兴奋性或抑制性突触后电位';
        ctx.fillText(s, 8, H * 0.06);

        this.detectSynapseHover();
    },

    detectSynapseHover() {
        const { hoverX, hoverY, W, H } = this;
        if (hoverX < 0) { this.hoverLabel = ''; return; }
        const midY = H * 0.5;
        if (Math.hypot(hoverX - W * 0.37, hoverY - midY) < 42)
            { this.hoverLabel = '突触小体：含线粒体(供能ATP)和突触小泡(储存递质)'; return; }
        for (const v of this.vesicles) {
            if (!v.released && Math.hypot(hoverX - v.bx * W, hoverY - v.by * H) < 8)
            { this.hoverLabel = '突触小泡：储存神经递质；乙酰胆碱只是常见示例之一'; return; }
        }
        if (hoverX > W * 0.41 && hoverX < W * 0.53)
            { this.hoverLabel = '突触间隙：很窄的细胞间隙，递质通过扩散到达后膜受体'; return; }
        if (hoverX > W * 0.53 && hoverX < W * 0.85)
            { this.hoverLabel = '突触后膜：递质与受体结合，受体类型决定兴奋或抑制效应'; return; }
        this.hoverLabel = '';
    },

    /* ─── Action Potential drawing ─── */
    drawActionPotential() {
        const { ctx, W, H, phase } = this;
        const padL = 60, padR = 30, padT = 30, padB = 45;
        const gW = W - padL - padR, gH = H - padT - padB;
        const fs = Math.max(14, W * 0.013);

        const apCurve = (t) => {
            if (t < 0.15) return -70;
            if (t < 0.25) return -70 + (t - 0.15) / 0.1 * 15;
            if (t < 0.35) return -55 + (t - 0.25) / 0.1 * 95;
            if (t < 0.5) return 40 - (t - 0.35) / 0.15 * 130;
            if (t < 0.65) return -90 + (t - 0.5) / 0.15 * 20;
            return -70;
        };
        const vToY = (v) => padT + gH * (1 - (v + 90) / 130);
        const drawP = Math.min(1, phase / 0.8);

        // Grid
        ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 0.5;
        for (let i = 0; i <= 10; i++) {
            const x = padL + (gW / 10) * i;
            ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + gH); ctx.stroke();
        }

        // Axes
        ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + gH); ctx.lineTo(padL + gW, padT + gH); ctx.stroke();

        // Y labels
        ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = `${fs}px ${CF.mono}`; ctx.textAlign = 'right';
        for (const v of [40, 0, -55, -70, -90]) {
            const y = vToY(v);
            ctx.fillText(v + 'mV', padL - 5, y + 3);
            ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 0.5;
            ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + gW, y); ctx.stroke();
        }

        // Threshold
        const thY = vToY(-55);
        ctx.strokeStyle = 'rgba(229,192,123,0.3)'; ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(padL, thY); ctx.lineTo(padL + gW, thY); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(229,192,123,0.35)'; ctx.font = `${fs - 1}px ${CF.mono}`; ctx.textAlign = 'right';
        ctx.fillText('阈值 -55mV', padL + gW, thY - 4);

        // Axis labels
        ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = `${fs}px ${CF.sans}`; ctx.textAlign = 'center';
        ctx.fillText('时间 (ms)', padL + gW / 2, H - 5);
        ctx.save(); ctx.translate(12, padT + gH / 2); ctx.rotate(-Math.PI / 2);
        ctx.fillText('膜电位 (mV)', 0, 0); ctx.restore();

        // Area under curve
        if (drawP > 0.15) {
            const rY = vToY(-70);
            ctx.beginPath(); ctx.moveTo(padL + 0.15 * gW, rY);
            for (let t = 0.15; t <= drawP; t += 0.002) ctx.lineTo(padL + t * gW, vToY(apCurve(t)));
            ctx.lineTo(padL + drawP * gW, rY); ctx.closePath();
            const aG = ctx.createLinearGradient(0, padT, 0, padT + gH);
            aG.addColorStop(0, 'rgba(224,108,117,0.07)'); aG.addColorStop(0.5, 'rgba(224,108,117,0.02)'); aG.addColorStop(1, 'rgba(97,175,239,0.04)');
            ctx.fillStyle = aG; ctx.fill();
        }

        // Main curve
        ctx.strokeStyle = 'rgba(224,108,117,0.8)'; ctx.lineWidth = 2.5; ctx.beginPath();
        let first = true;
        for (let t = 0; t <= drawP; t += 0.002) {
            const x = padL + t * gW, y = vToY(apCurve(t));
            first ? ctx.moveTo(x, y) : ctx.lineTo(x, y); first = false;
        }
        ctx.stroke();

        // Moving dot
        if (drawP > 0) {
            const v = apCurve(drawP), dx = padL + drawP * gW, dy = vToY(v);
            ctx.shadowColor = '#e06c75'; ctx.shadowBlur = 8;
            ctx.fillStyle = '#e06c75'; ctx.beginPath(); ctx.arc(dx, dy, 4, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;
            ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = `${fs}px ${CF.mono}`; ctx.textAlign = 'left';
            ctx.fillText(v.toFixed(0) + 'mV', dx + 8, dy - 5);
        }

        // Phase annotations
        const phases = [
            { r: [0, 0.15], label: '静息电位', col: 'rgba(170,170,170,0.4)' },
            { r: [0.15, 0.25], label: '阈刺激', col: 'rgba(229,192,123,0.4)' },
            { r: [0.25, 0.35], label: '去极化', col: 'rgba(224,108,117,0.5)', desc: 'Na⁺通道开放' },
            { r: [0.35, 0.5], label: '复极化', col: 'rgba(97,175,239,0.5)', desc: 'K⁺通道开放' },
            { r: [0.5, 0.65], label: '超极化', col: 'rgba(139,111,192,0.4)', desc: 'K⁺延迟关闭' },
            { r: [0.65, 1], label: '恢复', col: 'rgba(170,170,170,0.3)' }
        ];
        for (const p of phases) {
            const mid = (p.r[0] + p.r[1]) / 2;
            if (mid <= drawP) {
                const px = padL + mid * gW;
                ctx.fillStyle = p.col; ctx.font = `${fs}px ${CF.sans}`; ctx.textAlign = 'center';
                ctx.fillText(p.label, px, padT - 10);
                if (p.desc) { ctx.font = `${fs - 1}px ${CF.mono}`; ctx.fillText(p.desc, px, padT - 1); }
            }
        }

        // Ion channel diagram (right side)
        this.drawIonChannels(padL + gW * 0.78, padT + gH * 0.72, drawP);

        // Hover detection
        this.detectAPHover(padL, padT, gW, gH, drawP, apCurve, vToY);
    },

    drawIonChannels(cx, cy, progress) {
        const { ctx } = this;
        const fs = Math.max(13, this.W * 0.024);
        const s = Math.min(this.W * 0.065, 46);

        // Na⁺ channel
        const naO = progress > 0.2 && progress < 0.45;
        ctx.strokeStyle = naO ? 'rgba(224,108,117,0.55)' : 'rgba(224,108,117,0.18)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - s, cy - s * 0.6); ctx.lineTo(cx - s * 0.3, cy - s * (naO ? 0.15 : 0.04));
        ctx.moveTo(cx - s, cy + s * 0.6); ctx.lineTo(cx - s * 0.3, cy + s * (naO ? 0.15 : 0.04));
        ctx.stroke();
        if (naO) {
            ctx.fillStyle = 'rgba(224,108,117,0.45)';
            ctx.font = fs + 'px ' + CF.mono; ctx.textAlign = 'center';
            ctx.fillText('Na⁺↓', cx - s * 0.65, cy + 3);
        }
        ctx.fillStyle = 'rgba(224,108,117,0.35)'; ctx.font = fs + 'px ' + CF.sans; ctx.textAlign = 'center';
        ctx.fillText('Na⁺通道', cx - s * 0.6, cy - s * 0.78);

        // K⁺ channel
        const kO = progress > 0.35 && progress < 0.65;
        ctx.strokeStyle = kO ? 'rgba(97,175,239,0.55)' : 'rgba(97,175,239,0.18)';
        ctx.lineWidth = 2; ctx.beginPath();
        ctx.moveTo(cx + s, cy - s * 0.6); ctx.lineTo(cx + s * 0.3, cy - s * (kO ? 0.15 : 0.04));
        ctx.moveTo(cx + s, cy + s * 0.6); ctx.lineTo(cx + s * 0.3, cy + s * (kO ? 0.15 : 0.04));
        ctx.stroke();
        if (kO) {
            ctx.fillStyle = 'rgba(97,175,239,0.45)';
            ctx.font = fs + 'px ' + CF.mono; ctx.textAlign = 'center';
            ctx.fillText('K⁺↑', cx + s * 0.65, cy + 3);
        }
        ctx.fillStyle = 'rgba(97,175,239,0.35)'; ctx.font = fs + 'px ' + CF.sans; ctx.textAlign = 'center';
        ctx.fillText('K⁺通道', cx + s * 0.6, cy - s * 0.78);
    },

    detectAPHover(padL, padT, gW, gH, drawP, apCurve, vToY) {
        const { hoverX, hoverY } = this;
        if (hoverX < 0) { this.hoverLabel = ''; return; }
        if (hoverX >= padL && hoverX <= padL + gW * drawP) {
            const t = (hoverX - padL) / gW;
            const v = apCurve(t), cy = vToY(v);
            if (Math.abs(hoverY - cy) < 15) {
                if (t < 0.15) this.hoverLabel = `静息电位 ${v.toFixed(0)}mV: Na⁺/K⁺-ATP酶长期维持离子梯度`;
                else if (t < 0.25) this.hoverLabel = '阈刺激: 膜电位达到-55mV时触发 (全或无定律)';
                else if (t < 0.35) this.hoverLabel = `去极化 ${v.toFixed(0)}mV: 电压门控Na⁺通道大量开放，Na⁺内流`;
                else if (t < 0.5) this.hoverLabel = `复极化 ${v.toFixed(0)}mV: Na⁺通道关闭，K⁺通道开放，K⁺外流`;
                else if (t < 0.65) this.hoverLabel = `超极化 ${v.toFixed(0)}mV: K⁺通道延迟关闭，膜电位低于静息`;
                else this.hoverLabel = '恢复阶段: 漏通道与Na⁺/K⁺泵共同维持静息状态和离子梯度';
                return;
            }
        }
        this.hoverLabel = '';
    },

    drawTooltip() {
        if (!this.hoverLabel || this.hoverX < 0) return;
        const { ctx, hoverX, hoverY, W } = this;
        const fs = Math.max(15, W * 0.015);
        ctx.font = `${fs}px ${CF.sans}`;
        const tw = ctx.measureText(this.hoverLabel).width;
        const px = Math.min(hoverX + 12, W - tw - 20);
        const py = Math.max(hoverY - 20, 16);
        const bw = tw + 14, bh = fs + 10;
        ctx.fillStyle = 'rgba(30,30,30,0.88)';
        ctx.beginPath(); ctx.roundRect(px - 7, py - fs - 2, bw, bh, 4); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 0.5; ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.textAlign = 'left';
        ctx.fillText(this.hoverLabel, px, py);
    },

    updateInfo() {
        const el = document.getElementById('neural-info');
        if (!el) return;
        if (this.mode === 'synapse') {
            el.innerHTML = `
                <div class="neur-info__hd">化学突触：电信号转为化学信号</div>
                <div class="neur-info__grid">
                    <div class="neur-info__block">
                        <div class="neur-info__sub">Ca²⁺ 触发释放</div>
                        <div class="neur-info__val" style="color:#e5c07b">电压门控 Ca²⁺ 通道</div>
                        <div class="neur-info__desc">动作电位到达突触末端后，Ca²⁺ 内流促使突触小泡与前膜融合，并以胞吐方式释放神经递质。</div>
                    </div>
                    <div class="neur-info__block">
                        <div class="neur-info__sub">递质与受体</div>
                        <div class="neur-info__val">结合后产生突触后电位</div>
                        <div class="neur-info__desc">递质跨过突触间隙并结合后膜受体；受体和离子通道类型决定兴奋性或抑制性效应。</div>
                    </div>
                    <div class="neur-info__block">
                        <div class="neur-info__sub">信号终止</div>
                        <div class="neur-info__row"><span class="neur-info__key" style="--c:var(--accent-teal,#3a9e8f)">扩散</span> 递质离开突触间隙。</div>
                        <div class="neur-info__row"><span class="neur-info__key" style="--c:#e06c75">降解/回收</span> 递质可被酶降解，或被突触前末端、胶质细胞回收。</div>
                    </div>
                    <div class="neur-info__block">
                        <div class="neur-info__sub">模型边界</div>
                        <div class="neur-info__note">画布演示典型化学突触；未完整呈现电突触、递质多样性、受体亚型、空间/时间总和和真实突触形态。</div>
                    </div>
                </div>
                <div class="neur-info__source">资料依据：OpenStax Anatomy & Physiology 2e 12.5 Communication Between Neurons。</div>`;
        } else {
            el.innerHTML = `
                <div class="neur-info__hd">动作电位：膜电位快速反转与恢复</div>
                <div class="neur-info__grid">
                    <div class="neur-info__block">
                        <div class="neur-info__sub">阈值与全或无</div>
                        <div class="neur-info__val" style="color:#e5c07b">达到阈值才触发</div>
                        <div class="neur-info__desc">刺激使膜电位接近阈值后，动作电位按全或无规律发生；幅度不是随刺激强度连续增大。</div>
                    </div>
                    <div class="neur-info__block">
                        <div class="neur-info__sub">去极化</div>
                        <div class="neur-info__val" style="color:#e06c75">-70 → +40 mV</div>
                        <div class="neur-info__desc">电压门控 Na⁺ 通道开放，Na⁺ 内流使膜内侧快速变得更正。</div>
                    </div>
                    <div class="neur-info__block">
                        <div class="neur-info__sub">复极化/超极化</div>
                        <div class="neur-info__val" style="color:#61afef">K⁺ 外流带回负电位</div>
                        <div class="neur-info__desc">Na⁺ 通道失活后，K⁺ 通道开放使 K⁺ 外流；K⁺ 通道延迟关闭可造成短暂超极化。</div>
                    </div>
                    <div class="neur-info__block">
                        <div class="neur-info__sub">模型边界</div>
                        <div class="neur-info__note">-70 mV、-55 mV、+40 mV、-90 mV 是常见教学近似；真实神经元阈值、峰值、离子通道动力学和髓鞘/节点结构会随细胞类型与条件变化。</div>
                    </div>
                </div>
                <div class="neur-info__source">资料依据：OpenStax Anatomy & Physiology 2e 12.4 The Action Potential。</div>`;
        }
    }
};

function initNeuralReg() { NeuralReg.init(); }
window.NeuralReg = NeuralReg;
window.initNeuralReg = initNeuralReg;
