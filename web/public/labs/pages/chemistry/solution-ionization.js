// ===== Solution & Ionization Visualization v2 =====
// 6 substances, Ka/Kb pH, learning panel, hover, speed/pause

const SolutionIon = {
    canvas: null, ctx: null, W: 0, H: 0,
    _listeners: [], _resizeObs: null, _raf: null,
    _prevT: 0, running: true, speed: 1,

    substance: 'hcl',
    concentration: 0.1,
    particles: [],
    hoverX: -1, hoverY: -1, hoverLabel: '',

    SUBS: {
        hcl:      { name: '盐酸 HCl',       type: '强酸', eq: 'HCl → H⁺ + Cl⁻',
                    ions: [{s:'H⁺',c:'#e06c75',r:1},{s:'Cl⁻',c:'#5b8dce',r:1}],
                    pH: c => -Math.log10(c), deg: 1 },
        naoh:     { name: '氢氧化钠 NaOH',  type: '强碱', eq: 'NaOH → Na⁺ + OH⁻',
                    ions: [{s:'Na⁺',c:'#e5c07b',r:1},{s:'OH⁻',c:'#5b8dce',r:1}],
                    pH: c => 14 + Math.log10(c), deg: 1 },
        ch3cooh:  { name: '醋酸 CH₃COOH',   type: '弱酸', eq: 'CH₃COOH ⇌ H⁺ + CH₃COO⁻',
                    Ka: 1.8e-5,
                    ions: [{s:'H⁺',c:'#e06c75',r:.13},{s:'CH₃COO⁻',c:'#4d9e7e',r:.13},{s:'CH₃COOH',c:'rgba(200,200,200,0.35)',r:.87}],
                    pH: c => { const Ka = 1.8e-5; const h = (-Ka + Math.sqrt(Ka*Ka + 4*Ka*c)) / 2; return -Math.log10(h); },
                    deg: c => { const Ka = 1.8e-5; const h = (-Ka + Math.sqrt(Ka*Ka + 4*Ka*c)) / 2; return h / c; } },
        nh3h2o:   { name: '氨水 NH₃·H₂O',   type: '弱碱', eq: 'NH₃·H₂O ⇌ NH₄⁺ + OH⁻',
                    Kb: 1.8e-5,
                    ions: [{s:'NH₄⁺',c:'#e5c07b',r:.13},{s:'OH⁻',c:'#5b8dce',r:.13},{s:'NH₃·H₂O',c:'rgba(200,200,200,0.35)',r:.87}],
                    pH: c => { const Kb = 1.8e-5; const oh = (-Kb + Math.sqrt(Kb*Kb + 4*Kb*c)) / 2; return 14 + Math.log10(oh); },
                    deg: c => { const Kb = 1.8e-5; const oh = (-Kb + Math.sqrt(Kb*Kb + 4*Kb*c)) / 2; return oh / c; } },
        nacl:     { name: '氯化钠 NaCl',     type: '强电解质盐', eq: 'NaCl → Na⁺ + Cl⁻',
                    ions: [{s:'Na⁺',c:'#e5c07b',r:1},{s:'Cl⁻',c:'#5b8dce',r:1}],
                    pH: () => 7, deg: 1 },
        nahco3:   { name: '碳酸氢钠 NaHCO₃', type: '两性弱酸根盐(水解呈弱碱性)', eq: 'NaHCO₃ → Na⁺ + HCO₃⁻；HCO₃⁻ 既可电离又可水解',
                    ions: [{s:'Na⁺',c:'#e5c07b',r:1},{s:'HCO₃⁻',c:'#4d9e7e',r:1}],
                    pH: () => 8.3, deg: 1 }
    },

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    _isCompact() {
        return this.W < 520;
    },

    _bounds() {
        return this._isCompact()
            ? { cL: 0.08, cR: 0.92, cT: 0.32, cB: 0.88 }
            : { cL: 0.05, cR: 0.55, cT: 0.2, cB: 0.88 };
    },

    _degreeLabel() {
        return (this.substance === 'nacl' || this.substance === 'nahco3') ? '解离度' : '电离度';
    },

    init() {
        this.canvas = document.getElementById('solution-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this._prevT = performance.now();
        this.running = true; this.speed = 1;
        this.hoverLabel = '';
        this.resize();
        this.generateParticles();
        this.bindEvents();
        this.updateInfo();
        this.canvas.setAttribute('role','img');
        this.canvas.setAttribute('aria-label','溶液电离可视化：离子运动与pH');
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
        const compact = w < 520;
        const h = compact
            ? Math.min(Math.max(w * 0.62, 260), 320)
            : Math.min(Math.max(w * 0.48, 280), 400);
        this.canvas.width = w * dpr; this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w; this.H = h;
    },

    getInfo() {
        const s = this.SUBS[this.substance];
        if (!s) return this.SUBS.hcl;
        const c = this.concentration;
        const pH = typeof s.pH === 'function' ? s.pH(c) : s.pH;
        const deg = typeof s.deg === 'function' ? s.deg(c) : s.deg;
        const ions = s.ions.map(i => ({
            s: i.s, c: i.c,
            r: typeof i.r === 'function' ? i.r(c) : i.r
        }));
        return { ...s, ions, pH: Math.max(0, Math.min(14, pH)), degree: Math.min(1, deg) };
    },

    generateParticles() {
        this.particles = [];
        const info = this.getInfo();
        const maxP = 65;
        const { cL, cR, cT, cB } = this._bounds();

        // Water molecules (background)
        for (let i = 0; i < 12; i++) {
            this.particles.push({
                x: cL + Math.random() * (cR - cL),
                y: cT + Math.random() * (cB - cT),
                vx: (Math.random() - 0.5) * 0.0005,
                vy: (Math.random() - 0.5) * 0.0005,
                symbol: 'H₂O', color: 'rgba(97,175,239,0.15)', rad: 2, isWater: true
            });
        }

        for (const ion of info.ions) {
            const count = Math.round(maxP * this.concentration * 2 * ion.r);
            for (let i = 0; i < Math.min(count, 28); i++) {
                this.particles.push({
                    x: cL + Math.random() * (cR - cL),
                    y: cT + Math.random() * (cB - cT),
                    vx: (Math.random() - 0.5) * 0.0008,
                    vy: (Math.random() - 0.5) * 0.0008,
                    symbol: ion.s, color: ion.c,
                    rad: ion.s.length > 5 ? 5 : (ion.s.length > 3 ? 4 : 3),
                    isWater: false
                });
            }
        }
    },

    bindEvents() {
        const wrap = this.canvas.parentElement;
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver(() => this.resize());
            this._resizeObs.observe(wrap);
        }

        document.querySelectorAll('.sol-substance-btn').forEach(btn => {
            this._on(btn, 'click', () => {
                document.querySelectorAll('.sol-substance-btn').forEach(b => {
                    b.classList.remove('active'); b.setAttribute('aria-pressed','false');
                });
                btn.classList.add('active'); btn.setAttribute('aria-pressed','true');
                this.substance = btn.dataset.sub;
                this.generateParticles();
                this.updateInfo();
            });
        });

        const concS = document.getElementById('sol-conc');
        const concVal = document.getElementById('sol-conc-val');
        if (concS) {
            this._on(concS, 'input', () => {
                this.concentration = parseFloat(concS.value);
                if (concVal) concVal.textContent = this.concentration.toFixed(2);
                this.generateParticles();
                this.updateInfo();
            });
        }

        // Speed
        const spd = document.getElementById('sol-speed');
        const spdV = document.getElementById('sol-speed-val');
        if (spd) {
            this._on(spd, 'input', () => {
                this.speed = parseFloat(spd.value);
                if (spdV) spdV.textContent = this.speed.toFixed(1) + 'x';
            });
        }

        // Pause
        const pauseBtn = document.getElementById('sol-pause');
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

        this.updateParticles(dt);
        this.draw();
        this._raf = requestAnimationFrame(() => this.loop());
    },

    updateParticles(dt) {
        const { cL, cR, cT, cB } = this._bounds();
        const f = dt * 60; // normalize to ~60fps feel
        for (const p of this.particles) {
            p.vx += (Math.random() - 0.5) * 0.0003 * f;
            p.vy += (Math.random() - 0.5) * 0.0003 * f;
            p.vx *= 0.97; p.vy *= 0.97;
            p.x += p.vx * f; p.y += p.vy * f;
            if (p.x < cL) { p.x = cL; p.vx = Math.abs(p.vx); }
            if (p.x > cR) { p.x = cR; p.vx = -Math.abs(p.vx); }
            if (p.y < cT) { p.y = cT; p.vy = Math.abs(p.vy); }
            if (p.y > cB) { p.y = cB; p.vy = -Math.abs(p.vy); }
        }
    },

    draw() {
        const { ctx, W, H } = this;
        if (!ctx || W === 0) return;
        ctx.clearRect(0, 0, W, H);
        this.drawContainer();
        this.drawParticles();
        this.drawPHScale();
        this.drawCanvasInfo();
        this.detectHover();
        this.drawTooltip();
    },

    drawContainer() {
        const { ctx, W, H } = this;
        const bounds = this._bounds();
        const cL = W * bounds.cL, cR = W * bounds.cR, cT = H * bounds.cT, cB = H * bounds.cB;
        const info = this.getInfo();
        const pH = info.pH;
        const t = performance.now() / 1000;

        // Solution fill
        let sc;
        if (pH < 3) sc = 'rgba(224,108,117,0.06)';
        else if (pH < 6) sc = 'rgba(229,192,123,0.04)';
        else if (pH < 8) sc = 'rgba(255,255,255,0.02)';
        else if (pH < 11) sc = 'rgba(91,141,206,0.04)';
        else sc = 'rgba(91,141,206,0.06)';
        ctx.fillStyle = sc;
        ctx.fillRect(cL + 1, cT, cR - cL - 2, cB - cT);

        // Beaker
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cL, cT - 5); ctx.lineTo(cL, cB);
        ctx.lineTo(cR, cB); ctx.lineTo(cR, cT - 5); ctx.stroke();

        // Spout
        ctx.beginPath(); ctx.moveTo(cL, cT - 5); ctx.quadraticCurveTo(cL - 8, cT - 12, cL + 3, cT - 16); ctx.stroke();

        // Water surface wave
        ctx.strokeStyle = 'rgba(91,141,206,0.15)'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = cL + 1; x < cR; x += 2) {
            const y = cT + Math.sin((x - cL) * 0.03 + t * 2) * 2;
            x <= cL + 1 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Volume markings
        ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 0.5;
        for (let i = 1; i <= 3; i++) {
            const my = cT + (cB - cT) * i / 4;
            ctx.beginPath(); ctx.moveTo(cL + 2, my); ctx.lineTo(cL + 10, my); ctx.stroke();
        }
    },

    drawParticles() {
        const { ctx, W, H } = this;
        const fs = Math.max(12, W * 0.012);
        for (const p of this.particles) {
            const px = p.x * W, py = p.y * H;
            if (p.isWater) {
                ctx.fillStyle = p.color;
                ctx.beginPath(); ctx.arc(px, py, p.rad, 0, Math.PI * 2); ctx.fill();
                continue;
            }
            // Ion with gradient
            const g = ctx.createRadialGradient(px - 1, py - 1, 0, px, py, p.rad + 1);
            g.addColorStop(0, p.color); g.addColorStop(1, p.color.replace(/[\d.]+\)$/, '0.1)'));
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(px, py, p.rad, 0, Math.PI * 2); ctx.fill();

            // Label
            if (p.symbol.length <= 6) {
                ctx.fillStyle = typeof p.color === 'string' && p.color.startsWith('rgba') ?
                    p.color.replace(/[\d.]+\)$/, '0.85)') : p.color;
                ctx.font = `${fs}px ${CF.mono}`;
                ctx.textAlign = 'center';
                ctx.fillText(p.symbol, px, py - p.rad - 2);
            }
        }
    },

    drawPHScale() {
        const { ctx, W, H } = this;
        const info = this.getInfo();
        const pH = info.pH;
        const compact = this._isCompact();
        const fs = compact ? 11 : Math.max(13, W * 0.013);

        const barL = W * (compact ? 0.08 : 0.62);
        const barR = W * (compact ? 0.92 : 0.95);
        const barY = H * (compact ? 0.09 : 0.14);
        const barH = compact ? 12 : 14;

        // Gradient
        const grad = ctx.createLinearGradient(barL, 0, barR, 0);
        grad.addColorStop(0, 'rgba(224,108,117,0.5)');
        grad.addColorStop(0.25, 'rgba(229,192,123,0.45)');
        grad.addColorStop(0.5, 'rgba(77,158,126,0.5)');
        grad.addColorStop(0.75, 'rgba(91,141,206,0.45)');
        grad.addColorStop(1, 'rgba(139,111,192,0.5)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.roundRect(barL, barY, barR - barL, barH, 3); ctx.fill();

        // Ticks
        ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = `${fs - 1}px ${CF.mono}`; ctx.textAlign = 'center';
        const tickStep = compact ? 2 : 1;
        for (let i = 0; i <= 14; i += tickStep) {
            const x = barL + (i / 14) * (barR - barL);
            ctx.fillText(i, x, barY + barH + (compact ? 9 : 10));
        }

        // Indicator triangle
        const indX = barL + (pH / 14) * (barR - barL);
        ctx.fillStyle = '#fff'; ctx.beginPath();
        ctx.moveTo(indX - 5, barY - 2); ctx.lineTo(indX + 5, barY - 2); ctx.lineTo(indX, barY + 5); ctx.fill();

        // pH value
        ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = `${compact ? fs + 2 : fs + 3}px ${CF.mono}`; ctx.textAlign = 'center';
        ctx.fillText('pH = ' + pH.toFixed(2), (barL + barR) / 2, barY - (compact ? 8 : 10));

        // Labels
        ctx.font = `${fs}px ${CF.sans}`;
        const labelY = barY + barH + (compact ? 22 : 24);
        ctx.fillStyle = 'rgba(224,108,117,0.4)'; ctx.textAlign = 'left'; ctx.fillText('酸性', barL, labelY);
        ctx.fillStyle = 'rgba(139,111,192,0.4)'; ctx.textAlign = 'right'; ctx.fillText('碱性', barR, labelY);
        ctx.fillStyle = 'rgba(77,158,126,0.4)'; ctx.textAlign = 'center'; ctx.fillText('中性', (barL + barR) / 2, labelY);
    },

    drawCanvasInfo() {
        const { ctx, W, H } = this;
        const info = this.getInfo();
        const compact = this._isCompact();
        const fs = compact ? 12 : Math.max(14, W * 0.014);
        if (compact) {
            const x0 = W * 0.08, y0 = H * 0.22;
            ctx.fillStyle = 'rgba(255,255,255,0.48)';
            ctx.font = `${fs + 1}px ${CF.sans}`;
            ctx.textAlign = 'left';
            ctx.fillText(`${info.name} · pH ${info.pH.toFixed(2)}`, x0, y0);
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.font = `${fs}px ${CF.mono}`;
            ctx.fillText(`${info.type} · ${this._degreeLabel()} ${(info.degree * 100).toFixed(1)}%`, x0, y0 + 17);
            return;
        }
        const x0 = W * 0.62, y0 = H * 0.45;

        ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = `${fs + 1}px ${CF.sans}`; ctx.textAlign = 'left';
        ctx.fillText(info.name, x0, y0);
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = `${fs}px ${CF.mono}`;
        ctx.fillText('类型: ' + info.type, x0, y0 + 18);
        ctx.fillText('c = ' + this.concentration.toFixed(2) + ' mol/L', x0, y0 + 36);
        ctx.fillText('pH = ' + info.pH.toFixed(2), x0, y0 + 54);
        ctx.fillText(this._degreeLabel() + ': ' + (info.degree * 100).toFixed(1) + '%', x0, y0 + 72);

        // Equation
        ctx.fillStyle = 'rgba(77,158,126,0.45)'; ctx.font = `${fs}px ${CF.mono}`;
        ctx.fillText(info.eq, x0, y0 + 96);

        // Ion count
        const ionCounts = this.particles.filter(p => !p.isWater);
        const groups = {};
        for (const p of ionCounts) groups[p.symbol] = (groups[p.symbol] || 0) + 1;
        let cy = y0 + 120;
        ctx.font = `${fs - 1}px ${CF.mono}`;
        for (const [sym, cnt] of Object.entries(groups)) {
            const p = ionCounts.find(pp => pp.symbol === sym);
            ctx.fillStyle = p ? p.color : 'rgba(255,255,255,0.3)';
            ctx.fillText(`${sym}: ${cnt}个`, x0, cy);
            cy += 16;
        }
    },

    detectHover() {
        const { hoverX, hoverY, W, H, particles } = this;
        if (hoverX < 0) { this.hoverLabel = ''; return; }
        for (const p of particles) {
            if (p.isWater) continue;
            const px = p.x * W, py = p.y * H;
            if (Math.hypot(hoverX - px, hoverY - py) < 10) {
                const tips = {
                    'H⁺': '氢离子：酸性溶液的特征离子，浓度越大pH越小',
                    'OH⁻': '氢氧根离子：碱性溶液的特征离子',
                    'Cl⁻': '氯离子：盐酸/NaCl完全电离产生',
                    'Na⁺': '钠离子：NaOH/NaCl/NaHCO₃完全电离产生',
                    'CH₃COO⁻': '醋酸根：弱酸部分电离产物，存在电离平衡',
                    'CH₃COOH': '醋酸分子：弱电解质，仅部分电离',
                    'NH₄⁺': '铵根离子：氨水部分电离产物',
                    'NH₃·H₂O': '氨水分子：弱碱，仅部分电离',
                    'HCO₃⁻': '碳酸氢根：既可电离(Ka₂)又可水解，水解为主→碱性'
                };
                this.hoverLabel = tips[p.symbol] || p.symbol;
                return;
            }
        }
        // pH scale region
        const inScale = this._isCompact()
            ? hoverY < this.H * 0.2
            : hoverX > this.W * 0.62 && hoverY < this.H * 0.35;
        if (inScale) {
            this.hoverLabel = 'pH = -lg[H₃O⁺]；25°C水溶液中 pH+pOH=14';
            return;
        }
        this.hoverLabel = '';
    },

    drawTooltip() {
        if (!this.hoverLabel || this.hoverX < 0) return;
        const { ctx, hoverX, hoverY, W } = this;
        const fs = Math.max(15, W * 0.016);
        ctx.font = `${fs}px ${CF.sans}`;
        const tw = ctx.measureText(this.hoverLabel).width;
        const px = Math.min(hoverX + 12, W - tw - 20);
        const py = Math.max(hoverY - 20, 16);
        ctx.fillStyle = 'rgba(30,30,30,0.88)';
        ctx.beginPath(); ctx.roundRect(px - 7, py - fs - 2, tw + 14, fs + 10, 4); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 0.5; ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.textAlign = 'left';
        ctx.fillText(this.hoverLabel, px, py);
    },

    updateInfo() {
        const el = document.getElementById('sol-info');
        if (!el) return;
        const info = this.getInfo();
        const isWeak = info.degree < 1;
        const isHydro = this.substance === 'nahco3';
        const pOH = Math.max(0, Math.min(14, 14 - info.pH));
        const degree = info.degree * 100;
        const degreeText = degree < 0.1 ? degree.toFixed(3) : degree < 10 ? degree.toFixed(2) : degree.toFixed(1);
        const pHText = info.pH.toFixed(2);
        const pOHText = pOH.toFixed(2);
        let calcText = '';
        if (this.substance === 'hcl') calcText = '强酸模型近似完全电离，pH = -lg[H₃O⁺]，且 [H₃O⁺]≈c(HCl)。';
        else if (this.substance === 'naoh') calcText = '强碱模型近似完全电离，pOH = -lg[OH⁻]，25°C 时 pH = 14 - pOH。';
        else if (this.substance === 'ch3cooh') calcText = 'Ka = [H₃O⁺][CH₃COO⁻]/[CH₃COOH] = 1.8×10⁻⁵，按一元弱酸平衡估算 pH。';
        else if (this.substance === 'nh3h2o') calcText = 'Kb = [NH₄⁺][OH⁻]/[NH₃·H₂O] = 1.8×10⁻⁵，先求 [OH⁻] 再换算 pH。';
        else if (this.substance === 'nacl') calcText = '强酸强碱盐通常不水解，理想 25°C 水溶液近似 pH = 7。';
        else if (this.substance === 'nahco3') calcText = 'HCO₃⁻ 是两性离子，水解与电离竞争；教学模型取弱碱性近似，pH 约 8.3。';
        const ideaText = isWeak
            ? '弱电解质只部分电离，稀释会提高电离度，但对应离子浓度未必同步增大。'
            : isHydro
                ? '盐类水解来自弱酸根或弱碱阳离子与水的反应，溶液酸碱性取决于竞争过程。'
                : '强电解质在这个模型中按完全电离处理，因此没有电离平衡滑动。';
        let html = `<div class="sol-hd"><span class="sol-tag${isWeak ? ' sol-tag--amber' : ''}">${info.type}</span>${info.name}</div>`;
        html += `<div class="sol-summary">
            <div class="sol-summary__card"><span>pH</span><strong>${pHText}</strong></div>
            <div class="sol-summary__card"><span>pOH</span><strong>${pOHText}</strong></div>
            <div class="sol-summary__card"><span>${this._degreeLabel()}</span><strong>${degreeText}%</strong></div>
            <div class="sol-summary__card"><span>浓度</span><strong>${this.concentration.toFixed(2)} mol/L</strong></div>
        </div>`;
        html += `<div class="sol-row"><span class="sol-key">电离方程式</span>${info.eq}</div>`;
        html += `<div class="sol-row"><span class="sol-key sol-key--purple">pH 计算</span>${calcText}</div>`;
        if (isWeak) {
            html += `<div class="sol-row"><span class="sol-key sol-key--amber">电离平衡</span>电离和结合同时发生，达到动态平衡；加水稀释通常使电离度增大。</div>`;
        }
        if (isHydro) {
            html += `<div class="sol-row"><span class="sol-key sol-key--teal">盐类水解</span>HCO₃⁻ + H₂O ⇌ H₂CO₃ + OH⁻；同时 HCO₃⁻ ⇌ H⁺ + CO₃²⁻，两条路径共同影响 pH。</div>`;
        }
        html += `<div class="sol-note"><strong>学习要点：</strong>${ideaText}</div>`;
        html += `<div class="sol-note sol-note--boundary"><strong>模型边界：</strong>pH+pOH=14 使用 25°C 水溶液常用近似；弱酸、弱碱和盐类水解数值按单一平衡教学模型估算，未展开活度系数、离子强度、多级平衡、温度变化和 CO₂ 交换。</div>`;
        html += `<div class="sol-source">资料依据：OpenStax Chemistry 2e 的 pH and pOH、Relative Strengths of Acids and Bases、Hydrolysis of Salts。</div>`;
        el.innerHTML = html;
    }
};

function initSolutionIon() { SolutionIon.init(); }
window.SolutionIon = SolutionIon;
window.initSolutionIon = initSolutionIon;
