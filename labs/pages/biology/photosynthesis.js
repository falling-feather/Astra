// ===== Photosynthesis Visualization v3 =====
// Light/Dark Reaction + Respiration comparison + Light curve + Edu Panel
// Canvas-based, DPR-aware, ResizeObserver, event-cleanup

const Photosynthesis = {
    canvas: null, ctx: null, W: 0, H: 0,
    info: null, animId: null,
    _listeners: [],

    // Mode: 'simulation' | 'curve' | 'comparison'
    mode: 'simulation',

    // Simulation state
    running: false,
    time: 0,
    _lastTime: 0,
    _spawnAccum: 0,
    lightIntensity: 50,
    temperature: 25,      // Celsius
    co2Concentration: 0.04, // %

    // Particles
    particles: [],
    oxygenBubbles: [],
    atpParticles: [],
    glucoseCount: 0,

    // Light curve data
    curveData: [],
    curveTemp: 25,

    // Respiration comparison
    respRate: 0,

    slider: null,
    tempOutput: null,
    co2Output: null,

    /* ============ Init / Destroy ============ */

    init() {
        if (this.canvas) this.destroy();
        this.canvas = document.getElementById('photosynthesis-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.info = document.getElementById('photo-info');

        this.slider = document.getElementById('bio-light-intensity');
        this.tempOutput = document.getElementById('bio-photo-temp-value');
        this.co2Output = document.getElementById('bio-photo-co2-value');
        this.resize();
        this.bindControls();
        this._injectInfoPanel();
        this._updateInfo();
        this._updateCurveLabels();
        this.startLoop();
        this._generateCurveData();

        if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(() => this.resize());
            ro.observe(this.canvas.parentElement);
            this._ro = ro;
        }
        this._onResize = () => this.resize();
        window.addEventListener('resize', this._onResize);
    },

    destroy() {
        if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
        if (this._onResize) { window.removeEventListener('resize', this._onResize); }
        this._listeners.forEach(([el, evt, fn, opts]) => el.removeEventListener(evt, fn, opts));
        this._listeners = [];
    },

    _on(el, evt, fn, opts) {
        if (!el) return;
        el.addEventListener(evt, fn, opts);
        this._listeners.push([el, evt, fn, opts]);
    },

    resize() {
        const wrap = this.canvas.parentElement;
        if (!wrap) return;
        const w = wrap.clientWidth;
        if (w === 0) return;
        const h = Math.min(Math.max(w * 0.48, 300), 420);
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w; this.H = h;
    },

    bindControls() {
        const startBtn = document.getElementById('bio-photo-start');
        this._on(startBtn, 'click', () => {
            if (this.mode !== 'simulation') this.switchMode('simulation');
            if (this.running) {
                this.running = false;
                if (startBtn) startBtn.textContent = '\u5f00\u59cb\u6a21\u62df';
                if (this.info) this.info.textContent = '\u6a21\u62df\u5df2\u6682\u505c';
            } else {
                this.running = true;
                if (startBtn) startBtn.textContent = '\u6682\u505c';
                if (this.info) this.info.textContent = '\u5149\u5408\u4f5c\u7528\u8fdb\u884c\u4e2d...';
                this._lastTime = 0;
            }
        });

        const resetBtn = document.getElementById('bio-photo-reset');
        this._on(resetBtn, 'click', () => {
            this.running = false;
            this.particles = [];
            this.oxygenBubbles = [];
            this.atpParticles = [];
            this.glucoseCount = 0;
            this.time = 0;
            this._lastTime = 0;
            this._spawnAccum = 0;
            if (startBtn) startBtn.textContent = '\u5f00\u59cb\u6a21\u62df';
            if (this.slider) { this.slider.value = 50; this.lightIntensity = 50; }
            if (this.info) this.info.textContent = '\u8c03\u8282\u5149\u7167\u5f3a\u5ea6\uff0c\u89c2\u5bdf\u5149\u5408\u4f5c\u7528\u901f\u7387\u53d8\u5316';
        });

        this._on(this.slider, 'input', () => {
            this.lightIntensity = parseInt(this.slider.value) || 50;
        });

        // Inject mode buttons
        this._injectModeButtons();

        // Temperature slider
        this._on(document.getElementById('bio-photo-temp'), 'input', (e) => {
            this.temperature = parseInt(e.target.value) || 25;
            this._updateCurveLabels();
            this._generateCurveData();
        });

        // CO2 slider
        this._on(document.getElementById('bio-photo-co2'), 'input', (e) => {
            this.co2Concentration = parseFloat(e.target.value) || 0.04;
            this._updateCurveLabels();
            this._generateCurveData();
        });
    },

    _updateCurveLabels() {
        if (this.tempOutput) this.tempOutput.textContent = this.temperature + '\u00b0C';
        if (this.co2Output) this.co2Output.textContent = this.co2Concentration.toFixed(2) + '%';
    },

    _syncCurveInputs() {
        const tempInput = document.getElementById('bio-photo-temp');
        const co2Input = document.getElementById('bio-photo-co2');
        let changed = false;
        if (tempInput) {
            const nextTemp = parseInt(tempInput.value);
            if (Number.isFinite(nextTemp) && nextTemp !== this.temperature) {
                this.temperature = nextTemp;
                changed = true;
            }
        }
        if (co2Input) {
            const nextCo2 = parseFloat(co2Input.value);
            if (Number.isFinite(nextCo2) && Math.abs(nextCo2 - this.co2Concentration) > 0.0001) {
                this.co2Concentration = nextCo2;
                changed = true;
            }
        }
        if (changed) {
            this._updateCurveLabels();
            this._generateCurveData();
        }
    },

    _injectModeButtons() {
        const section = this.canvas?.closest('.demo-section');
        const controls = section?.querySelector('#bio-photo-sim-controls') || section?.querySelector('.viz-controls');
        if (!controls) return;

        let wrap = document.getElementById('bio-photo-modes');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.id = 'bio-photo-modes';
            wrap.className = 'photo-modes';
            wrap.innerHTML = '<button class="photo-mode-btn active" data-mode="simulation">\u53cd\u5e94\u6a21\u62df</button>'
                + '<button class="photo-mode-btn" data-mode="curve">\u5149\u5408\u66f2\u7ebf</button>'
                + '<button class="photo-mode-btn" data-mode="comparison">\u547c\u5438\u5bf9\u6bd4</button>';
            controls.parentElement.insertBefore(wrap, controls);
        }

        wrap.querySelectorAll('.photo-mode-btn').forEach(btn => {
            this._on(btn, 'click', () => {
                this.switchMode(btn.dataset.mode);
            });
        });
    },

    switchMode(mode) {
        this.mode = mode;
        document.querySelectorAll('.photo-mode-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.mode === mode);
        });

        // Show/hide simulation controls
        const simCtrls = document.getElementById('bio-photo-sim-controls');
        const curveCtrls = document.getElementById('bio-photo-curve-controls');
        if (simCtrls) simCtrls.style.display = mode === 'simulation' ? '' : 'none';
        if (curveCtrls) curveCtrls.style.display = mode === 'curve' ? '' : 'none';

        const msgs = {
            simulation: '\u8c03\u8282\u5149\u7167\u5f3a\u5ea6\uff0c\u89c2\u5bdf\u5149\u5408\u4f5c\u7528\u901f\u7387\u53d8\u5316',
            curve: '\u5149\u5408\u901f\u7387\u968f\u5149\u7167\u5f3a\u5ea6\u7684\u53d8\u5316\u66f2\u7ebf',
            comparison: '\u5149\u5408\u4f5c\u7528 vs \u7ec6\u80de\u547c\u5438 \u2014 \u89c2\u5bdf\u6c14\u4f53\u4ea4\u6362\u5e73\u8861\u70b9'
        };
        if (this.info) this.info.textContent = msgs[mode] || '';
        this._updateInfo();
    },

    _generateCurveData() {
        // Photosynthesis rate as a teaching model for light, temperature, and CO2 limitation.
        this.curveData = [];
        const tempFactor = Math.max(0.2, 1 - Math.abs(this.temperature - 28) * 0.025);
        const co2Factor = Math.max(0.35, Math.min(1.15, this.co2Concentration / 0.04));
        for (let light = 0; light <= 100; light += 2) {
            const vmax = 78 * tempFactor * co2Factor;
            const km = 25 + (1 - Math.min(co2Factor, 1)) * 18;
            const rate = (vmax * light) / (km + light);
            this.curveData.push({ light, rate });
        }
    },

    /* ============ Animation Loop ============ */

    startLoop() {
        const loop = (now) => {
            if (!now) now = performance.now();
            if (!this._lastTime) this._lastTime = now;
            const rawDt = (now - this._lastTime) / 1000;
            this._lastTime = now;
            const dt = Math.min(rawDt, 0.1);

            this.time += dt;
            if (this.mode === 'simulation' && this.running) {
                this._updateSimulation(dt);
            }
            this.draw();
            this.animId = requestAnimationFrame(loop);
        };
        this.animId = requestAnimationFrame(loop);
    },

    _updateSimulation(dt) {
        const f = dt * 60;

        // Spawn CO2 and H2O
        const spawnInterval = Math.max(0.033, 0.3 - this.lightIntensity * 0.0025);
        this._spawnAccum += dt;
        while (this._spawnAccum >= spawnInterval && this.particles.length < 40) {
            this._spawnAccum -= spawnInterval;
            this.particles.push(this._createParticle('co2'));
            this.particles.push(this._createParticle('h2o'));
        }
        if (this.particles.length >= 40) this._spawnAccum = 0;

        // Move particles
        this.particles.forEach(p => { p.x += p.vx * f; p.y += p.vy * f; });

        // Process particles in reaction zones
        this._processParticles(f);

        // Move ATP particles
        this.atpParticles.forEach(a => {
            a.x += a.vx * f; a.y += a.vy * f; a.life -= dt;
        });
        this.atpParticles = this.atpParticles.filter(a => a.life > 0);

        // Move O2 bubbles
        this.oxygenBubbles.forEach(b => { b.y += b.vy * f; b.alpha -= 0.24 * dt; });
        this.oxygenBubbles = this.oxygenBubbles.filter(b => b.alpha > 0 && b.y > -20);

        // Calculate respiration rate
        this.respRate = 5 + this.temperature * 0.15; // Simple temperature-dependent
    },

    _createParticle(type) {
        const { W, H } = this;
        if (type === 'co2') {
            return {
                type: 'co2',
                x: Math.random() * W * 0.15,
                y: H * 0.15 + Math.random() * H * 0.25,
                vx: 0.6 + Math.random() * 0.4,
                vy: (Math.random() - 0.5) * 0.3,
                r: 6, alpha: 0.85
            };
        }
        return {
            type: 'h2o',
            x: W * 0.15 + Math.random() * W * 0.08,
            y: H * 0.88 + Math.random() * 15,
            vx: (Math.random() - 0.5) * 0.2,
            vy: -0.4 - Math.random() * 0.3,
            r: 5, alpha: 0.75
        };
    },

    _processParticles(f) {
        const { W, H } = this;
        const lzCx = W * 0.30, lzCy = H * 0.50;
        const lzRx = W * 0.15, lzRy = H * 0.18;
        const dzCx = W * 0.65, dzCy = H * 0.50;

        this.particles = this.particles.filter(p => {
            const dx = p.x - lzCx, dy = p.y - lzCy;
            const inside = (dx * dx / (lzRx * lzRx) + dy * dy / (lzRy * lzRy)) < 0.85;

            if (inside) {
                if (p.type === 'h2o') {
                    if (Math.random() < 0.6) {
                        this.oxygenBubbles.push({
                            x: lzCx + (Math.random() - 0.5) * 40,
                            y: lzCy - 30,
                            vy: -0.5 - Math.random() * 0.8,
                            r: 3 + Math.random() * 3,
                            alpha: 0.85
                        });
                    }
                    if (Math.random() < 0.4) {
                        this.atpParticles.push({
                            x: lzCx + lzRx * 0.5,
                            y: lzCy + (Math.random() - 0.5) * 20,
                            vx: 1.2 + Math.random() * 0.5,
                            vy: (Math.random() - 0.5) * 0.3,
                            label: Math.random() < 0.5 ? 'ATP' : 'NADPH',
                            life: 2.0
                        });
                    }
                    return false;
                }
                if (p.type === 'co2') {
                    p.vx = 0.8;
                    p.vy += (dzCy - p.y) * 0.02 * f;
                    if (Math.abs(p.x - dzCx) < W * 0.08 && Math.abs(p.y - dzCy) < H * 0.15) {
                        this.glucoseCount++;
                        return false;
                    }
                }
            }
            return p.x < W + 20 && p.y > -20 && p.y < H + 20;
        });
    },

    /* ============ Main Draw ============ */

    draw() {
        const { ctx, W, H, mode } = this;
        if (!ctx || W === 0) return;
        this._syncCurveInputs();
        ctx.clearRect(0, 0, W, H);

        switch (mode) {
            case 'simulation':  this._drawSimulation(ctx, W, H); break;
            case 'curve':       this._drawCurve(ctx, W, H); break;
            case 'comparison':  this._drawComparison(ctx, W, H); break;
        }
    },

    /* ── Simulation Draw ── */

    _drawSimulation(ctx, W, H) {
        const fs = Math.max(11, W * 0.019);
        const sunBrightness = this.lightIntensity / 100;

        // Background
        ctx.fillStyle = '#0a0f15';
        ctx.fillRect(0, 0, W, H);

        // Sun & rays
        const sunX = W * 0.12, sunY = H * 0.08;
        const sunGrd = ctx.createRadialGradient(sunX, sunY, 3, sunX, sunY, 50 + sunBrightness * 30);
        sunGrd.addColorStop(0, 'rgba(255,230,80,' + sunBrightness + ')');
        sunGrd.addColorStop(0.5, 'rgba(255,180,50,' + (sunBrightness * 0.4) + ')');
        sunGrd.addColorStop(1, 'transparent');
        ctx.fillStyle = sunGrd;
        ctx.fillRect(0, 0, W * 0.4, H * 0.5);

        if (this.lightIntensity > 5) {
            ctx.strokeStyle = 'rgba(255,220,100,' + (sunBrightness * 0.12) + ')';
            ctx.lineWidth = 1.5;
            for (let i = 0; i < 6; i++) {
                const angle = Math.PI * 0.15 + i * 0.12 + Math.sin(this.time * 1.2 + i) * 0.03;
                ctx.beginPath();
                ctx.moveTo(sunX, sunY);
                ctx.lineTo(sunX + Math.cos(angle) * W * 0.35, sunY + Math.sin(angle) * H * 0.6);
                ctx.stroke();
            }
        }

        // Chloroplast outline
        ctx.beginPath();
        ctx.ellipse(W * 0.48, H * 0.50, W * 0.38, H * 0.30, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(30,80,65,0.15)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(58,158,143,0.3)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Light Reaction Zone
        const lzX = W * 0.18, lzY = H * 0.35, lzW = W * 0.24, lzH = H * 0.30;
        ctx.fillStyle = 'rgba(58,158,143,' + (0.06 + sunBrightness * 0.08) + ')';
        ctx.fillRect(lzX, lzY, lzW, lzH);
        ctx.strokeStyle = 'rgba(58,158,143,' + (0.2 + sunBrightness * 0.2) + ')';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(lzX, lzY, lzW, lzH);
        ctx.setLineDash([]);

        // Thylakoid stacks
        for (let i = 0; i < 3; i++) {
            const sx = lzX + lzW * 0.2 + i * lzW * 0.3;
            const sy = lzY + lzH * 0.4;
            for (let j = 0; j < 4; j++) {
                ctx.beginPath();
                ctx.ellipse(sx, sy + j * 10, 16, 4, 0, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(58,158,143,' + (0.25 + sunBrightness * 0.35) + ')';
                ctx.fill();
                ctx.strokeStyle = 'rgba(80,200,170,0.4)';
                ctx.lineWidth = 0.5;
                ctx.stroke();
            }
        }

        // Light zone labels
        ctx.fillStyle = 'rgba(100,220,190,0.6)';
        ctx.font = fs + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('\u5149\u53cd\u5e94', lzX + lzW / 2, lzY - 6);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = (fs - 3) + 'px ' + CF.sans;
        ctx.fillText('\u7c7b\u56ca\u4f53\u8584\u819c', lzX + lzW / 2, lzY + lzH + 14);

        // Dark Reaction Zone
        const dzX = W * 0.50, dzY = H * 0.35, dzW = W * 0.24, dzH = H * 0.30;
        ctx.fillStyle = 'rgba(80,60,30,0.08)';
        ctx.fillRect(dzX, dzY, dzW, dzH);
        ctx.strokeStyle = 'rgba(180,150,80,0.15)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(dzX, dzY, dzW, dzH);
        ctx.setLineDash([]);

        // Calvin Cycle
        const ccX = dzX + dzW / 2, ccY = dzY + dzH / 2;
        const ccR = Math.min(dzW, dzH) * 0.32;
        ctx.beginPath();
        ctx.arc(ccX, ccY, ccR, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(180,150,80,0.25)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        const cycleAngle = this.time * 0.9;
        for (let i = 0; i < 3; i++) {
            const a = cycleAngle + i * (Math.PI * 2 / 3);
            ctx.fillStyle = 'rgba(200,170,80,0.5)';
            ctx.beginPath();
            ctx.arc(ccX + Math.cos(a) * ccR, ccY + Math.sin(a) * ccR, 3, 0, Math.PI * 2);
            ctx.fill();
        }

        // Calvin cycle labels
        ctx.fillStyle = 'rgba(200,170,80,0.5)';
        ctx.font = (fs - 3) + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        // C3 and G3P labels on cycle
        const c3a = cycleAngle + Math.PI * 0.5;
        ctx.fillText('C\u2083', ccX + Math.cos(c3a) * ccR * 0.65, ccY + Math.sin(c3a) * ccR * 0.65);
        const g3pa = cycleAngle + Math.PI * 1.5;
        ctx.fillText('G3P', ccX + Math.cos(g3pa) * ccR * 0.65, ccY + Math.sin(g3pa) * ccR * 0.65);

        ctx.fillStyle = 'rgba(200,170,80,0.6)';
        ctx.font = fs + 'px ' + CF.sans;
        ctx.fillText('Calvin \u5faa\u73af', dzX + dzW / 2, dzY - 6);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = (fs - 3) + 'px ' + CF.sans;
        ctx.fillText('\u5149\u4e0d\u76f4\u63a5\u4f9d\u8d56', ccX, ccY);
        ctx.fillText('\u53f6\u7eff\u4f53\u57fa\u8d28', dzX + dzW / 2, dzY + dzH + 14);

        // Transfer arrow
        const arrowY = H * 0.50;
        ctx.strokeStyle = 'rgba(255,200,50,0.15)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(lzX + lzW + 4, arrowY);
        ctx.lineTo(dzX - 4, arrowY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,200,50,0.2)';
        ctx.beginPath();
        ctx.moveTo(dzX - 4, arrowY);
        ctx.lineTo(dzX - 10, arrowY - 4);
        ctx.lineTo(dzX - 10, arrowY + 4);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,200,50,0.4)';
        ctx.font = (fs - 3) + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('ATP+NADPH', (lzX + lzW + dzX) / 2, arrowY - 8);

        // Particles
        this.particles.forEach(p => {
            ctx.globalAlpha = p.alpha;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            if (p.type === 'co2') {
                ctx.fillStyle = '#666'; ctx.fill();
                ctx.fillStyle = '#aaa';
                ctx.font = 'bold ' + (fs - 3) + 'px ' + CF.mono;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText('CO\u2082', p.x, p.y);
            } else {
                ctx.fillStyle = '#4488cc'; ctx.fill();
                ctx.fillStyle = '#88bbee';
                ctx.font = 'bold ' + (fs - 3) + 'px ' + CF.mono;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText('H\u2082O', p.x, p.y);
            }
            ctx.globalAlpha = 1;
        });

        // ATP/NADPH
        this.atpParticles.forEach(a => {
            const alpha = Math.min(1, a.life / 0.5);
            ctx.fillStyle = 'rgba(255,200,50,' + (alpha * 0.7) + ')';
            ctx.beginPath(); ctx.arc(a.x, a.y, 3, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = 'rgba(255,220,100,' + (alpha * 0.6) + ')';
            ctx.font = 'bold ' + (fs - 3) + 'px ' + CF.mono;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(a.label, a.x, a.y - 6);
        });

        // O2 bubbles
        this.oxygenBubbles.forEach(b => {
            ctx.globalAlpha = b.alpha;
            ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(100,200,255,0.5)'; ctx.fill();
            ctx.strokeStyle = 'rgba(150,230,255,0.3)'; ctx.lineWidth = 0.5; ctx.stroke();
            ctx.fillStyle = 'rgba(220,240,255,0.8)';
            ctx.font = 'bold ' + (fs - 3) + 'px ' + CF.mono;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('O\u2082', b.x, b.y);
            ctx.globalAlpha = 1;
        });

        // Glucose output
        if (this.glucoseCount > 0) {
            const gx = dzX + dzW + 20, gy = dzY + dzH / 2;
            ctx.fillStyle = 'rgba(200,170,80,0.5)';
            ctx.font = fs + 'px ' + CF.sans;
            ctx.textAlign = 'left';
            ctx.fillText('C\u2086H\u2081\u2082O\u2086 \u00d7 ' + Math.floor(this.glucoseCount / 6), gx, gy);
        }

        // Input/output labels
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = (fs - 3) + 'px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText('CO\u2082 \u2192', 4, H * 0.28);
        ctx.fillText('H\u2082O \u2191', W * 0.16, H * 0.95);
        ctx.textAlign = 'right';
        ctx.fillText('\u2190 O\u2082 \u2191', lzX + lzW / 2 + 30, H * 0.18);

        // Equation
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.font = (fs + 5) + 'px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText('6CO\u2082 + 6H\u2082O  \u2500\u2500\u5149\u2500\u2500\u25b6  C\u2086H\u2081\u2082O\u2086 + 6O\u2082', W / 2, H * 0.78);

        // Rate bar
        const rate = Math.round(this.lightIntensity * 0.8);
        const barX = W * 0.02, barY = H * 0.78 + 12, barW = W * 0.12, barH = 6;
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(barX, barY, barW, barH);
        ctx.fillStyle = 'rgba(58,158,143,0.6)';
        ctx.fillRect(barX, barY, barW * (rate / 80), barH);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = (fs - 3) + 'px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText('\u5149\u5408\u901f\u7387 ' + rate + '%', barX, barY - 4);
    },

    /* ── Light Curve ── */

    _drawCurve(ctx, W, H) {
        const fs = Math.max(11, W * 0.019);
        ctx.fillStyle = '#0a0f15';
        ctx.fillRect(0, 0, W, H);

        const gx = W * 0.12, gy = 40, gw = W * 0.55, gh = H * 0.50;

        // Graph background
        ctx.fillStyle = 'rgba(255,255,255,0.03)';
        ctx.fillRect(gx, gy, gw, gh);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.strokeRect(gx, gy, gw, gh);

        // Title
        ctx.fillStyle = 'rgba(58,158,143,0.7)';
        ctx.font = (fs + 3) + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('\u5149\u5408\u901f\u7387 - \u5149\u7167\u5f3a\u5ea6\u66f2\u7ebf', gx + gw / 2, gy - 10);

        // Y axis label
        ctx.save();
        ctx.translate(gx - 30, gy + gh / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = fs + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('CO\u2082 \u5438\u6536\u91cf (\u76f8\u5bf9\u503c)', 0, 0);
        ctx.restore();

        // X axis label
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = fs + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('\u5149\u7167\u5f3a\u5ea6 (klux)', gx + gw / 2, gy + gh + 28);

        // Grid lines
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 0.5;
        for (let i = 1; i < 5; i++) {
            const y = gy + gh * i / 5;
            ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx + gw, y); ctx.stroke();
        }
        for (let i = 1; i < 5; i++) {
            const x = gx + gw * i / 5;
            ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, gy + gh); ctx.stroke();
        }

        // Respiration line (constant, below zero)
        const respOffset = gh * 0.15; // how much below the zero line
        const zeroY = gy + gh * 0.2; // zero line (net CO2 = 0)

        ctx.strokeStyle = 'rgba(196,121,58,0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(gx, zeroY + respOffset);
        ctx.lineTo(gx + gw, zeroY + respOffset);
        ctx.stroke();
        ctx.setLineDash([]);

        // Zero line
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(gx, zeroY);
        ctx.lineTo(gx + gw, zeroY);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.font = (fs - 3) + 'px ' + CF.sans;
        ctx.textAlign = 'right';
        ctx.fillText('0', gx - 4, zeroY + 3);

        // Draw photosynthesis curve
        if (this.curveData.length > 0) {
            const maxRate = Math.max(...this.curveData.map(d => d.rate));
            const scaleY = (gh - respOffset - (gh - (gy + gh - zeroY))) * 0.8;

            ctx.strokeStyle = '#3a9e8f';
            ctx.lineWidth = 2;
            ctx.beginPath();
            this.curveData.forEach((d, i) => {
                const x = gx + (d.light / 100) * gw;
                const netRate = d.rate - (5 + this.temperature * 0.15);  // net = gross - respiration
                const y = zeroY - (netRate / maxRate) * scaleY;
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            });
            ctx.stroke();

            // Light compensation point (where net = 0)
            const compPoint = this.curveData.find(d => {
                const net = d.rate - (5 + this.temperature * 0.15);
                return net >= 0;
            });
            if (compPoint) {
                const cpx = gx + (compPoint.light / 100) * gw;
                ctx.fillStyle = 'rgba(255,200,50,0.6)';
                ctx.beginPath(); ctx.arc(cpx, zeroY, 4, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = 'rgba(255,200,50,0.5)';
                ctx.font = (fs - 3) + 'px ' + CF.sans;
                ctx.textAlign = 'center';
                ctx.fillText('\u5149\u8865\u507f\u70b9', cpx, zeroY + 14);
            }

            // Light saturation point (where curve flattens)
            const satIdx = this.curveData.findIndex((d, i) => {
                if (i === 0) return false;
                const prev = this.curveData[i - 1];
                return (d.rate - prev.rate) < 0.5 && d.light > 20;
            });
            if (satIdx > 0) {
                const sp = this.curveData[satIdx];
                const spx = gx + (sp.light / 100) * gw;
                const netRate = sp.rate - (5 + this.temperature * 0.15);
                const spy = zeroY - (netRate / maxRate) * scaleY;
                ctx.fillStyle = 'rgba(139,111,192,0.6)';
                ctx.beginPath(); ctx.arc(spx, spy, 4, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = 'rgba(139,111,192,0.5)';
                ctx.font = (fs - 3) + 'px ' + CF.sans;
                ctx.textAlign = 'center';
                ctx.fillText('\u5149\u9971\u548c\u70b9', spx, spy - 10);
            }
        }

        // Current point indicator
        const curX = gx + (this.lightIntensity / 100) * gw;
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath(); ctx.moveTo(curX, gy); ctx.lineTo(curX, gy + gh); ctx.stroke();
        ctx.setLineDash([]);

        // Labels
        ctx.fillStyle = 'rgba(196,121,58,0.5)';
        ctx.font = (fs - 3) + 'px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText('\u547c\u5438\u901f\u7387', gx + gw + 5, zeroY + respOffset + 3);

        ctx.fillStyle = 'rgba(58,158,143,0.6)';
        ctx.fillText('\u51c0\u5149\u5408\u901f\u7387', gx + gw + 5, gy + 20);

        // Right panel: factor display
        const rx = W * 0.72, ry = 40;
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '600 ' + fs + 'px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText('\u5f53\u524d\u53c2\u6570', rx, ry);

        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = fs + 'px ' + CF.sans;
        ctx.fillText('\u5149\u7167: ' + this.lightIntensity + ' klux', rx, ry + 24);
        ctx.fillText('\u6e29\u5ea6: ' + this.temperature + '\u00b0C', rx, ry + 46);
        ctx.fillText('CO\u2082: ' + this.co2Concentration + '%', rx, ry + 68);

        // Temperature effect note
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = (fs - 3) + 'px ' + CF.sans;
        const tempNote = this.temperature < 15 ? '\u4f4e\u6e29\u2192\u9176\u6d3b\u6027\u4f4e' :
            this.temperature > 40 ? '\u9ad8\u6e29\u2192\u9176\u53d8\u6027' : '\u9002\u5b9c\u6e29\u5ea6';
        ctx.fillText(tempNote, rx, ry + 88);
    },

    /* ── Comparison Draw ── */

    _drawComparison(ctx, W, H) {
        const fs = Math.max(11, W * 0.019);
        ctx.fillStyle = '#0a0f15';
        ctx.fillRect(0, 0, W, H);

        const midX = W / 2;
        const boxW = W * 0.38, boxH = H * 0.45;
        const leftX = W * 0.05, rightX = W * 0.55;
        const topY = 50;

        // Title
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = (fs + 3) + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('\u5149\u5408\u4f5c\u7528 vs \u7ec6\u80de\u547c\u5438', midX, 24);

        // Photosynthesis box (left)
        ctx.fillStyle = 'rgba(58,158,143,0.06)';
        ctx.fillRect(leftX, topY, boxW, boxH);
        ctx.strokeStyle = 'rgba(58,158,143,0.3)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(leftX, topY, boxW, boxH);

        ctx.fillStyle = 'rgba(58,158,143,0.7)';
        ctx.font = (fs + 5) + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('\u5149\u5408\u4f5c\u7528', leftX + boxW / 2, topY + 20);

        // Photosynthesis diagram
        const pItems = [
            { label: 'CO\u2082 + H\u2082O', y: 0.3, color: '#5b8dce', arrow: 'down' },
            { label: '\u2193 \u5149\u80fd', y: 0.45, color: '#dca03c', arrow: null },
            { label: 'C\u2086H\u2081\u2082O\u2086 + O\u2082', y: 0.65, color: '#3a9e8f', arrow: null },
        ];
        pItems.forEach(item => {
            ctx.fillStyle = item.color;
            ctx.font = fs + 'px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillText(item.label, leftX + boxW / 2, topY + boxH * item.y);
        });

        // Location
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.font = (fs - 3) + 'px ' + CF.sans;
        ctx.fillText('\u573a\u6240: \u53f6\u7eff\u4f53', leftX + boxW / 2, topY + boxH * 0.82);
        ctx.fillText('\u80fd\u91cf\u8f6c\u5316: \u5149\u80fd \u2192 \u5316\u5b66\u80fd', leftX + boxW / 2, topY + boxH * 0.92);

        // Respiration box (right)
        ctx.fillStyle = 'rgba(196,121,58,0.06)';
        ctx.fillRect(rightX, topY, boxW, boxH);
        ctx.strokeStyle = 'rgba(196,121,58,0.3)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(rightX, topY, boxW, boxH);

        ctx.fillStyle = 'rgba(196,121,58,0.7)';
        ctx.font = (fs + 5) + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('\u7ec6\u80de\u547c\u5438', rightX + boxW / 2, topY + 20);

        const rItems = [
            { label: 'C\u2086H\u2081\u2082O\u2086 + O\u2082', y: 0.3, color: '#3a9e8f' },
            { label: '\u2193 \u9176\u4fc3', y: 0.45, color: '#dca03c' },
            { label: 'CO\u2082 + H\u2082O + ATP', y: 0.65, color: '#c4793a' },
        ];
        rItems.forEach(item => {
            ctx.fillStyle = item.color;
            ctx.font = fs + 'px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillText(item.label, rightX + boxW / 2, topY + boxH * item.y);
        });

        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.font = (fs - 3) + 'px ' + CF.sans;
        ctx.fillText('\u573a\u6240: \u7ebf\u7c92\u4f53 (\u6709\u6c27)', rightX + boxW / 2, topY + boxH * 0.82);
        ctx.fillText('\u80fd\u91cf\u8f6c\u5316: \u5316\u5b66\u80fd \u2192 ATP', rightX + boxW / 2, topY + boxH * 0.92);

        // Connecting arrows (bidirectional)
        const arrowMid = midX, arrowY1 = topY + boxH * 0.3, arrowY2 = topY + boxH * 0.65;

        ctx.strokeStyle = 'rgba(58,158,143,0.3)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(leftX + boxW + 5, arrowY1);
        ctx.lineTo(rightX - 5, arrowY1);
        ctx.stroke();
        ctx.fillStyle = 'rgba(58,158,143,0.4)';
        ctx.beginPath();
        ctx.moveTo(rightX - 5, arrowY1);
        ctx.lineTo(rightX - 11, arrowY1 - 4);
        ctx.lineTo(rightX - 11, arrowY1 + 4);
        ctx.closePath(); ctx.fill();

        ctx.strokeStyle = 'rgba(196,121,58,0.3)';
        ctx.beginPath();
        ctx.moveTo(rightX - 5, arrowY2);
        ctx.lineTo(leftX + boxW + 5, arrowY2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(196,121,58,0.4)';
        ctx.beginPath();
        ctx.moveTo(leftX + boxW + 5, arrowY2);
        ctx.lineTo(leftX + boxW + 11, arrowY2 - 4);
        ctx.lineTo(leftX + boxW + 11, arrowY2 + 4);
        ctx.closePath(); ctx.fill();

        // Arrow labels
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.font = (fs - 3) + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('O\u2082 + \u8461\u8404\u7cd6', midX, arrowY1 - 6);
        ctx.fillText('CO\u2082 + H\u2082O', midX, arrowY2 - 6);

        // Comparison table
        const tableY = topY + boxH + 30;
        const rows = [
            ['\u7269\u8d28\u53d8\u5316', '\u65e0\u673a\u7269 \u2192 \u6709\u673a\u7269', '\u6709\u673a\u7269 \u2192 \u65e0\u673a\u7269'],
            ['\u80fd\u91cf\u53d8\u5316', '\u5149\u80fd \u2192 \u5316\u5b66\u80fd', '\u5316\u5b66\u80fd \u2192 ATP'],
            ['\u6c14\u4f53', '\u91ca\u653e O\u2082\uff0c\u5438\u6536 CO\u2082', '\u91ca\u653e CO\u2082\uff0c\u5438\u6536 O\u2082'],
            ['\u53d1\u751f\u65f6\u95f4', '\u6709\u5149\u65f6', '\u59cb\u7ec8\u8fdb\u884c'],
        ];

        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(leftX, tableY, W * 0.9, rows.length * 20 + 22);

        // Header
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(leftX, tableY, W * 0.9, 20);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '600 ' + (fs - 3) + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('\u6bd4\u8f83\u9879\u76ee', leftX + W * 0.12, tableY + 14);
        ctx.fillStyle = 'rgba(58,158,143,0.7)';
        ctx.fillText('\u5149\u5408\u4f5c\u7528', leftX + W * 0.38, tableY + 14);
        ctx.fillStyle = 'rgba(196,121,58,0.7)';
        ctx.fillText('\u7ec6\u80de\u547c\u5438', leftX + W * 0.68, tableY + 14);

        rows.forEach((row, i) => {
            const y = tableY + 22 + i * 20;
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.font = fs + 'px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.fillText(row[0], leftX + W * 0.12, y + 14);
            ctx.fillStyle = 'rgba(58,158,143,0.5)';
            ctx.fillText(row[1], leftX + W * 0.38, y + 14);
            ctx.fillStyle = 'rgba(196,121,58,0.5)';
            ctx.fillText(row[2], leftX + W * 0.68, y + 14);

            // Row divider
            ctx.strokeStyle = 'rgba(255,255,255,0.05)';
            ctx.lineWidth = 0.5;
            ctx.beginPath(); ctx.moveTo(leftX, y + 20); ctx.lineTo(leftX + W * 0.9, y + 20); ctx.stroke();
        });
    },

    /* ── DOM Education Panel ── */

    _injectInfoPanel() {
        const box = document.getElementById('photosynth-info');
        if (!box) return;
        const P = 'photosynth-info';
        box.innerHTML = `
            <div class="${P}__hd" id="psy-panel-title">光合作用过程</div>
            <div class="${P}__grid" id="psy-panel-grid"></div>
            <div id="psy-panel-extra"></div>`;
    },

    _updateInfo() {
        const grid = document.getElementById('psy-panel-grid');
        const title = document.getElementById('psy-panel-title');
        const extra = document.getElementById('psy-panel-extra');
        if (!grid) return;
        const P = 'photosynth-info';
        const k = (c, t) => `<span class="${P}__key" style="--c:${c}">${t}</span>`;

        if (this.mode === 'simulation') {
            title.textContent = '光合作用过程';
            grid.innerHTML = `
                <div class="${P}__block">
                    <div class="${P}__sub">光反应（类囊体薄膜）</div>
                    <div class="${P}__row">${k('#3a9e8f','水的光解')} H₂O → [H] + O₂</div>
                    <div class="${P}__row">${k('#6fa8dc','ATP合成')} ADP + Pi → ATP（光合磷酸化）</div>
                    <div class="${P}__desc">需要光能驱动，产生 [H](NADPH) 和 ATP 供 Calvin 循环使用</div>
                </div>
                <div class="${P}__block">
                    <div class="${P}__sub">Calvin 循环（光不直接依赖反应，叶绿体基质）</div>
                    <div class="${P}__row">${k('#8b6fc0','CO₂固定')} CO₂ + C₅ → 2C₃</div>
                    <div class="${P}__row">${k('#c4793a','C₃还原')} C₃ + [H] + ATP → G3P（三碳糖磷酸/甘油醛-3-磷酸）→ 糖类</div>
                    <div class="${P}__desc">该过程不直接需要光，但依赖光反应提供的 ATP 和 NADPH</div>
                </div>`;
            extra.innerHTML = `
                <div class="${P}__note">总反应可写作：6CO₂ + 12H₂O →(光能/叶绿体) C₆H₁₂O₆ + 6O₂ + 6H₂O。O₂ 来自水的裂解；Calvin 循环不直接需要光，但需要光反应提供的 ATP 和 NADPH，所以不等于夜间才发生。</div>
                <div class="${P}__source">参考 OpenStax Biology 2e 8.1 Photosynthesis Overview、8.2 Light-Dependent Reactions 与 8.3 Using Light Energy to Make Organic Molecules。</div>`;
        } else if (this.mode === 'curve') {
            title.textContent = '光合速率影响因素';
            grid.innerHTML = `
                <div class="${P}__block">
                    <div class="${P}__sub">关键概念</div>
                    <div class="${P}__row">${k('#3a9e8f','光补偿点')} 光合速率 = 呼吸速率，净 O₂ 释放为 0</div>
                    <div class="${P}__row">${k('#c4793a','光饱和点')} 再增强光照，光合速率不再提高</div>
                    <div class="${P}__desc">超过饱和点后限制因素转变为 CO₂ 浓度或温度</div>
                </div>
                <div class="${P}__block">
                    <div class="${P}__sub">温度效应</div>
                    <div class="${P}__row">${k('#8b6fc0','温度窗口')} Calvin 循环涉及多种酶，适宜范围随植物和环境变化</div>
                    <div class="${P}__row">${k('#6fa8dc','高温抑制')} 高温、缺水或气孔关闭都会改变 CO₂ 供应和酶活性</div>
                    <div class="${P}__desc">温度同时影响呼吸作用，改变补偿点位置；曲线只表达趋势</div>
                </div>`;
            extra.innerHTML = `
                <div class="${P}__note">拖动温度与 CO₂ 滑块观察限制因素切换。页面曲线是相对教学模型，不代表某种植物的实测光合速率。</div>
                <div class="${P}__source">参考 OpenStax Biology 2e 8.1 对光合作用结构、底物与产物的说明，以及 8.3 对 Calvin 循环和气孔/水分限制的说明。</div>`;
        } else {
            title.textContent = '光合作用与呼吸作用';
            grid.innerHTML = `
                <div class="${P}__block">
                    <div class="${P}__sub">光合作用</div>
                    <div class="${P}__row">${k('#3a9e8f','场所')} 叶绿体（类囊体 + 基质）</div>
                    <div class="${P}__row">${k('#6fa8dc','本质')} 合成有机物，储存能量</div>
                    <div class="${P}__desc">将光能转变为有机物中的化学能</div>
                </div>
                <div class="${P}__block">
                    <div class="${P}__sub">呼吸作用</div>
                    <div class="${P}__row">${k('#c4793a','场所')} 细胞质基质 + 线粒体</div>
                    <div class="${P}__row">${k('#8b6fc0','本质')} 分解有机物，释放能量</div>
                    <div class="${P}__desc">将有机物中的化学能转变为 ATP 活跃化学能</div>
                </div>`;
            extra.innerHTML = `
                <div class="${P}__note">光合作用把光能储存在有机物中；呼吸作用释放有机物中的能量并合成 ATP。两者连接碳循环和能量流动，但不是简单“完全相反”的同一过程。</div>
                <div class="${P}__source">参考 OpenStax Biology 2e 第 8 章对光合作用能量流的说明，以及第 7 章对细胞呼吸的说明。</div>`;
        }
    },

    /* ── Edu Panel (Canvas – legacy, now DOM) ── */

    _drawEdu(ctx, W, H) {
        // Education content moved to DOM _injectInfoPanel()
    }
};

function initPhotosynthesis() {
    Photosynthesis.init();
}
