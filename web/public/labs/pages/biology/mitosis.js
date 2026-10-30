// ===== Mitosis Visualization =====
// Animated cell division phases: Interphase, Prophase, Metaphase, Anaphase, Telophase, Cytokinesis

const Mitosis = {
    canvas: null, ctx: null, W: 0, H: 0,
    phase: 0,          // 0=cell-cycle interphase, 1=prophase, 2=metaphase, 3=anaphase, 4=telophase, 5=cytokinesis
    phaseProgress: 0,  // 0-1 within current phase
    animating: false,
    animId: 0,
    speed: 1,
    chromosomeCount: 4, // diploid: 4 chromosomes (2 pairs)
    _listeners: [],
    _resizeObs: null,

    phases: [
        { name: '\u95f4\u671f\uff08\u7ec6\u80de\u5468\u671f\u51c6\u5907\uff09', desc: 'DNA\u590d\u5236\u3001\u7ec6\u80de\u751f\u957f\uff1b\u5c5e\u4e8e\u7ec6\u80de\u5468\u671f\uff0c\u4e0d\u5c5e\u4e8e\u6709\u4e1d\u5206\u88c2\u671f\u672c\u8eab' },
        { name: '\u524d\u671f (Prophase)', desc: '\u67d3\u8272\u8d28\u7f29\u5408\u6210\u67d3\u8272\u4f53\uff0c\u7eba\u9524\u4f53\u5f62\u6210\uff0c\u6838\u819c\u89e3\u4f53' },
        { name: '\u4e2d\u671f (Metaphase)', desc: '\u67d3\u8272\u4f53\u6392\u5217\u5728\u8d64\u9053\u677f\u4e0a\uff0c\u7eba\u9524\u4e1d\u8fde\u63a5\u7740\u4e1d\u7c92' },
        { name: '\u540e\u671f (Anaphase)', desc: '\u7740\u4e1d\u7c92\u5206\u88c2\uff0c\u59d0\u59b9\u67d3\u8272\u5355\u4f53\u5206\u5f00\uff0c\u79fb\u5411\u4e24\u6781' },
        { name: '\u672b\u671f (Telophase)', desc: '\u67d3\u8272\u4f53\u89e3\u65cb\uff0c\u6838\u819c\u91cd\u65b0\u5f62\u6210\uff0c\u7eba\u9524\u4e1d\u6d88\u5931' },
        { name: '\u80de\u8d28\u5206\u88c2 (Cytokinesis)', desc: '\u7ec6\u80de\u8d28\u4e00\u5206\u4e3a\u4e8c\uff0c\u5f62\u6210\u4e24\u4e2a\u5b50\u7ec6\u80de' }
    ],

    colors: {
        membrane: '#3a9e8f',
        nucleus: 'rgba(58,158,143,0.3)',
        chromosome: '#e06c75',
        chromatid: '#c678dd',
        spindle: 'rgba(229,192,123,0.4)',
        centrosome: '#e5c07b'
    },

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        this.canvas = document.getElementById('mitosis-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        this.bindEvents();
        this._injectInfoPanel();
        this.draw();
        this.updatePhaseInfo();
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
        const h = Math.min(w * 0.6, 500);
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

        const playBtn = document.getElementById('mito-play-btn');
        if (playBtn) this._on(playBtn, 'click', () => this.toggleAnim());

        const resetBtn = document.getElementById('mito-reset-btn');
        if (resetBtn) this._on(resetBtn, 'click', () => this.resetPhase());

        const speedSlider = document.getElementById('mito-speed');
        if (speedSlider) this._on(speedSlider, 'input', () => { this.speed = parseFloat(speedSlider.value); });

        // Phase step buttons
        const prevBtn = document.getElementById('mito-prev');
        if (prevBtn) this._on(prevBtn, 'click', () => this.stepPhase(-1));
        const nextBtn = document.getElementById('mito-next');
        if (nextBtn) this._on(nextBtn, 'click', () => this.stepPhase(1));

        // Phase progress slider
        const progSlider = document.getElementById('mito-progress');
        if (progSlider) {
            this._on(progSlider, 'input', () => {
                const totalProgress = parseFloat(progSlider.value);
                this.phase = Math.min(5, Math.floor(totalProgress * 6));
                this.phaseProgress = (totalProgress * 6) - this.phase;
                if (this.phase >= 6) { this.phase = 5; this.phaseProgress = 1; }
                this.draw();
                this.updatePhaseInfo();
            });
        }
    },

    stepPhase(dir) {
        this.phase = Math.max(0, Math.min(5, this.phase + dir));
        this.phaseProgress = 0;
        this.draw();
        this.updatePhaseInfo();
        this.syncProgressSlider();
    },

    resetPhase() {
        this.phase = 0;
        this.phaseProgress = 0;
        this.stopAnim();
        this.draw();
        this.updatePhaseInfo();
        this.syncProgressSlider();
    },

    syncProgressSlider() {
        const s = document.getElementById('mito-progress');
        if (s) s.value = (this.phase + this.phaseProgress) / 6;
    },

    toggleAnim() {
        if (this.animating) this.stopAnim();
        else this.startAnim();
    },

    startAnim() {
        this.animating = true;
        const btn = document.getElementById('mito-play-btn');
        if (btn) btn.textContent = '\u25a0 \u6682\u505c';
        let last = performance.now();
        const step = (now) => {
            if (!this.animating) return;
            const dt = (now - last) / 1000;
            last = now;
            this.phaseProgress += dt * this.speed * 0.3;
            if (this.phaseProgress >= 1) {
                this.phaseProgress = 0;
                this.phase++;
                if (this.phase > 5) {
                    this.phase = 5;
                    this.phaseProgress = 1;
                    this.stopAnim();
                }
            }
            this.syncProgressSlider();
            this.draw();
            this.updatePhaseInfo();
            if (this.animating) this.animId = requestAnimationFrame(step);
        };
        this.animId = requestAnimationFrame(step);
    },

    stopAnim() {
        this.animating = false;
        cancelAnimationFrame(this.animId);
        const btn = document.getElementById('mito-play-btn');
        if (btn) btn.textContent = '\u25b6 \u64ad\u653e';
    },

    updatePhaseInfo() {
        const info = this.phases[this.phase];
        const nameEl = document.getElementById('mito-phase-name');
        const descEl = document.getElementById('mito-phase-desc');
        if (nameEl) nameEl.textContent = info.name;
        if (descEl) descEl.textContent = info.desc;

        // Update phase indicators
        document.querySelectorAll('.mito-phase-dot').forEach((dot, i) => {
            dot.classList.toggle('active', i === this.phase);
            dot.classList.toggle('done', i < this.phase);
        });

        this._updateInfo();
    },

    draw() {
        const { ctx, W, H, phase, phaseProgress: p } = this;
        if (!ctx || W === 0) return;
        ctx.clearRect(0, 0, W, H);

        const cx = W / 2;
        const cy = H / 2;
        const cellR = Math.min(W * 0.2, H * 0.35, 120);

        switch (phase) {
            case 0: this.drawInterphase(cx, cy, cellR, p); break;
            case 1: this.drawProphase(cx, cy, cellR, p); break;
            case 2: this.drawMetaphase(cx, cy, cellR, p); break;
            case 3: this.drawAnaphase(cx, cy, cellR, p); break;
            case 4: this.drawTelophase(cx, cy, cellR, p); break;
            case 5: this.drawCytokinesis(cx, cy, cellR, p); break;
        }

        // Phase timeline bar
        this.drawTimeline(cx, H - 25);
    },

    drawCell(cx, cy, rx, ry, squeeze) {
        const ctx = this.ctx;
        squeeze = squeeze || 0;
        ctx.strokeStyle = this.colors.membrane;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        if (squeeze > 0) {
            // Pinched cell
            const pinch = squeeze * ry * 0.6;
            ctx.moveTo(cx, cy - ry);
            ctx.bezierCurveTo(cx + rx, cy - ry, cx + rx, cy - pinch, cx + rx * (1 - squeeze * 0.3), cy);
            ctx.bezierCurveTo(cx + rx, cy + pinch, cx + rx, cy + ry, cx, cy + ry);
            ctx.bezierCurveTo(cx - rx, cy + ry, cx - rx, cy + pinch, cx - rx * (1 - squeeze * 0.3), cy);
            ctx.bezierCurveTo(cx - rx, cy - pinch, cx - rx, cy - ry, cx, cy - ry);
        } else {
            ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        }
        ctx.fillStyle = 'rgba(58,158,143,0.06)';
        ctx.fill();
        ctx.stroke();
    },

    drawNucleus(cx, cy, r, opacity) {
        if (opacity <= 0) return;
        const ctx = this.ctx;
        ctx.globalAlpha = opacity;
        ctx.strokeStyle = 'rgba(58,158,143,0.5)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = this.colors.nucleus;
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
    },

    drawChromatin(cx, cy, r) {
        // Loose chromatin strands
        const ctx = this.ctx;
        ctx.strokeStyle = 'rgba(224,108,117,0.3)';
        ctx.lineWidth = 1.5;
        const seed = 42;
        for (let i = 0; i < 8; i++) {
            const a1 = (seed + i * 47) % 360 * Math.PI / 180;
            const a2 = a1 + 1.5;
            const r1 = r * 0.3;
            const r2 = r * 0.7;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a1) * r1, cy + Math.sin(a1) * r1);
            ctx.quadraticCurveTo(
                cx + Math.cos((a1 + a2) / 2) * r2 * 1.2,
                cy + Math.sin((a1 + a2) / 2) * r2 * 1.2,
                cx + Math.cos(a2) * r1, cy + Math.sin(a2) * r1
            );
            ctx.stroke();
        }
    },

    drawChromosome(x, y, size, angle, color, duplicated) {
        const ctx = this.ctx;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        const hw = size * 0.12;
        const hh = size * 0.4;

        if (duplicated) {
            // X-shaped sister chromatids
            for (const dx of [-hw * 0.8, hw * 0.8]) {
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.ellipse(dx, 0, hw, hh, 0, 0, Math.PI * 2);
                ctx.fill();
            }
            // Centromere
            ctx.fillStyle = '#e5c07b';
            ctx.beginPath();
            ctx.arc(0, 0, hw * 0.6, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // Single chromatid
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    },

    drawSpindleFibers(cx, cy, cellR, targets) {
        const ctx = this.ctx;
        ctx.strokeStyle = this.colors.spindle;
        ctx.lineWidth = 0.8;
        // Centrosomes at poles
        const poleY1 = cy - cellR * 0.85;
        const poleY2 = cy + cellR * 0.85;
        for (const pole of [poleY1, poleY2]) {
            ctx.fillStyle = this.colors.centrosome;
            ctx.beginPath();
            ctx.arc(cx, pole, 4, 0, Math.PI * 2);
            ctx.fill();
        }
        // Fibers to targets
        for (const t of targets) {
            ctx.beginPath();
            ctx.moveTo(cx, poleY1);
            ctx.quadraticCurveTo(cx + (t.x - cx) * 0.3, (poleY1 + t.y) / 2, t.x, t.y);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(cx, poleY2);
            ctx.quadraticCurveTo(cx + (t.x - cx) * 0.3, (poleY2 + t.y) / 2, t.x, t.y);
            ctx.stroke();
        }
    },

    drawInterphase(cx, cy, r, p) {
        this.drawCell(cx, cy, r, r, 0);
        this.drawNucleus(cx, cy, r * 0.55, 1);
        this.drawChromatin(cx, cy, r * 0.45);

        // DNA replication indicator
        if (p > 0.3) {
            const ctx = this.ctx;
            const fs = Math.max(13, this.W * 0.024);
            ctx.fillStyle = 'rgba(86,182,194,0.4)';
            ctx.font = fs + 'px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.fillText('DNA \u590d\u5236\u4e2d...', cx, cy + r * 0.75);

            // Replication fork icon
            const forkP = Math.min(1, (p - 0.3) / 0.5);
            ctx.strokeStyle = 'rgba(86,182,194,0.5)';
            ctx.lineWidth = 1.5;
            const forkX = cx - 20 + forkP * 40;
            ctx.beginPath();
            ctx.moveTo(cx - 20, cy + r * 0.55);
            ctx.lineTo(forkX, cy + r * 0.55);
            ctx.stroke();
        }
    },

    drawProphase(cx, cy, r, p) {
        this.drawCell(cx, cy, r, r, 0);
        // Nucleus fading
        this.drawNucleus(cx, cy, r * 0.55, 1 - p);

        // Chromosomes condensing
        const chrSize = 15 + p * 15;
        const positions = this.getChromosomePositions(cx, cy, r * 0.35, this.chromosomeCount);
        const chromColors = ['#e06c75', '#c678dd', '#61afef', '#e5c07b'];
        for (let i = 0; i < positions.length; i++) {
            const blend = p;
            const ix = cx + (positions[i].x - cx) * (0.5 + 0.5 * blend);
            const iy = cy + (positions[i].y - cy) * (0.5 + 0.5 * blend);
            this.drawChromosome(ix, iy, chrSize, positions[i].angle, chromColors[i % 4], p > 0.5);
        }

        // Spindle forming
        if (p > 0.6) {
            const spAlpha = (p - 0.6) / 0.4;
            this.ctx.globalAlpha = spAlpha;
            this.drawSpindleFibers(cx, cy, r, []);
            this.ctx.globalAlpha = 1;
        }
    },

    drawMetaphase(cx, cy, r, p) {
        this.drawCell(cx, cy, r, r, 0);

        // Chromosomes aligned at equator
        const n = this.chromosomeCount;
        const chromColors = ['#e06c75', '#c678dd', '#61afef', '#e5c07b'];
        const targets = [];
        const spacing = r * 0.5 / (n / 2);
        for (let i = 0; i < n; i++) {
            const row = i < n / 2 ? 0 : 1;
            const col = i < n / 2 ? i : i - n / 2;
            const x = cx - spacing * ((n / 2 - 1) / 2) + col * spacing;
            const y = cy + (row === 0 ? -8 : 8);
            targets.push({ x, y });
            this.drawChromosome(x, y, 30, 0, chromColors[i % 4], true);
        }

        this.drawSpindleFibers(cx, cy, r, targets);

        // Equator plate line
        const ctx = this.ctx;
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.6, cy);
        ctx.lineTo(cx + r * 0.6, cy);
        ctx.stroke();
        ctx.setLineDash([]);
    },

    drawAnaphase(cx, cy, r, p) {
        this.drawCell(cx, cy, r, r * (1 + p * 0.15), 0);

        const n = this.chromosomeCount;
        const chromColors = ['#e06c75', '#c678dd', '#61afef', '#e5c07b'];
        const sep = p * r * 0.55; // separation distance

        for (let i = 0; i < n; i++) {
            const col = i < n / 2 ? i : i - n / 2;
            const spacing = r * 0.4 / (n / 2);
            const x = cx - spacing * ((n / 2 - 1) / 2) + col * spacing;

            // Moving up (toward north pole)
            this.drawChromosome(x, cy - sep, 22, 0, chromColors[i % 4], false);
            // Moving down (toward south pole)
            this.drawChromosome(x, cy + sep, 22, Math.PI, chromColors[i % 4], false);
        }

        // Spindle fibers stretching
        const targets = [];
        for (let i = 0; i < n / 2; i++) {
            const spacing = r * 0.4 / (n / 2);
            const x = cx - spacing * ((n / 2 - 1) / 2) + i * spacing;
            targets.push({ x, y: cy - sep });
            targets.push({ x, y: cy + sep });
        }
        this.drawSpindleFibers(cx, cy, r, targets);
    },

    drawTelophase(cx, cy, r, p) {
        const squeeze = p * 0.3;
        this.drawCell(cx, cy, r, r * 1.15, squeeze);

        const n = this.chromosomeCount;
        const chromColors = ['#e06c75', '#c678dd', '#61afef', '#e5c07b'];
        const sep = r * 0.55;

        // Nuclei reforming
        this.drawNucleus(cx, cy - sep, r * 0.35 * p, p * 0.8);
        this.drawNucleus(cx, cy + sep, r * 0.35 * p, p * 0.8);

        // Chromosomes decondensing
        const chrSize = 22 - p * 8;
        for (let i = 0; i < n / 2; i++) {
            const spacing = r * 0.35 / (n / 2);
            const x = cx - spacing * ((n / 2 - 1) / 2) + i * spacing;
            this.drawChromosome(x, cy - sep, chrSize, 0, chromColors[i % 4], false);
            this.drawChromosome(x, cy + sep, chrSize, 0, chromColors[(i + 2) % 4], false);
        }
    },

    drawCytokinesis(cx, cy, r, p) {
        const ctx = this.ctx;

        // Two separating daughter cells
        const sepX = p * r * 0.5;
        const cellRY = r * (1 - p * 0.15);

        // Left daughter
        this.drawCell(cx - sepX, cy, r * (0.7 + p * 0.15), cellRY * 0.85, 0);
        this.drawNucleus(cx - sepX, cy, r * 0.3, 0.8);

        // Right daughter
        this.drawCell(cx + sepX, cy, r * (0.7 + p * 0.15), cellRY * 0.85, 0);
        this.drawNucleus(cx + sepX, cy, r * 0.3, 0.8);

        // Chromatin in each
        const n = this.chromosomeCount / 2;
        const chromColors = ['#e06c75', '#c678dd', '#61afef', '#e5c07b'];
        for (let i = 0; i < n; i++) {
            const chrSize = 14 - p * 4;
            const spacing = r * 0.2 / n;
            const x = -spacing * ((n - 1) / 2) + i * spacing;
            this.drawChromosome(cx - sepX + x, cy, chrSize, i * 0.5, chromColors[i % 4], false);
            this.drawChromosome(cx + sepX + x, cy, chrSize, i * 0.5, chromColors[(i + 2) % 4], false);
        }

        // Cleavage furrow remains
        if (p < 0.8) {
            ctx.strokeStyle = 'rgba(58,158,143,0.3)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cx, cy - cellRY * (1 - p * 0.5));
            ctx.lineTo(cx, cy + cellRY * (1 - p * 0.5));
            ctx.stroke();
        }
    },

    drawTimeline(cx, y) {
        const ctx = this.ctx;
        const totalW = Math.min(this.W * 0.8, 500);
        const left = cx - totalW / 2;

        for (let i = 0; i < 6; i++) {
            const x = left + (i / 5) * totalW;
            const isCurrent = i === this.phase;
            const isDone = i < this.phase;

            ctx.fillStyle = isCurrent ? '#3a9e8f' : isDone ? 'rgba(58,158,143,0.5)' : 'rgba(255,255,255,0.15)';
            ctx.beginPath();
            ctx.arc(x, y, isCurrent ? 5 : 3.5, 0, Math.PI * 2);
            ctx.fill();

            if (i < 5) {
                ctx.strokeStyle = isDone || isCurrent ? 'rgba(58,158,143,0.4)' : 'rgba(255,255,255,0.08)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x + 6, y);
                ctx.lineTo(left + ((i + 1) / 5) * totalW - 6, y);
                ctx.stroke();
            }
        }
    },

    _injectInfoPanel() {
        const el = document.getElementById('mito-edu-info');
        if (!el) return;
        el.innerHTML = `
            <div class="mito-edu-info__hd">🔬 有丝分裂知识点</div>
            <div class="mito-edu-info__grid">
                <div class="mito-edu-info__block">
                    <div class="mito-edu-info__sub">当前阶段</div>
                    <div id="mito-edu-phase" class="mito-edu-info__val">间期（细胞周期准备）</div>
                    <div id="mito-edu-desc" class="mito-edu-info__desc">DNA复制、细胞生长；属于细胞周期，不属于有丝分裂期本身</div>
                </div>
                <div class="mito-edu-info__block">
                    <div class="mito-edu-info__sub">染色体变化</div>
                    <div id="mito-edu-chr" class="mito-edu-info__val">2n → DNA复制 → 2n(含姐妹染色单体)</div>
                </div>
                <div class="mito-edu-info__block">
                    <div class="mito-edu-info__sub">各时期关键事件</div>
                    <div class="mito-edu-info__row"><span class="mito-edu-info__key" style="--c:#3a9e8f">间期</span> 细胞周期准备阶段：DNA复制、蛋白质合成，为分裂做准备</div>
                    <div class="mito-edu-info__row"><span class="mito-edu-info__key" style="--c:#e06c75">前期</span> 染色质→染色体，纺锤体形成，核膜解体</div>
                    <div class="mito-edu-info__row"><span class="mito-edu-info__key" style="--c:#c678dd">中期</span> 染色体排列在赤道板上，纺锤丝连接着丝粒</div>
                    <div class="mito-edu-info__row"><span class="mito-edu-info__key" style="--c:#e5c07b">后期</span> 着丝粒分裂，姐妹染色单体分开移向两极</div>
                    <div class="mito-edu-info__row"><span class="mito-edu-info__key" style="--c:#61afef">末期</span> 染色体解旋，核膜重新形成，纺锤丝消失</div>
                    <div class="mito-edu-info__row"><span class="mito-edu-info__key" style="--c:#56b6c2">胞质分裂</span> 细胞质一分为二，形成两个子细胞</div>
                </div>
                <div class="mito-edu-info__block">
                    <div class="mito-edu-info__sub">💡 知识要点</div>
                    <div class="mito-edu-info__note">有丝分裂保证了亲代与子代细胞遗传信息的一致性。DNA复制在间期完成；随后有丝分裂与胞质分裂使子细胞染色体数=母细胞。典型动物细胞由中心体发出星射线形成纺锤体，植物细胞由细胞两极发出纺锤丝形成纺锤体。</div>
                </div>
            </div>
        `;
    },

    _updateInfo() {
        const info = this.phases[this.phase];
        const phaseEl = document.getElementById('mito-edu-phase');
        const descEl = document.getElementById('mito-edu-desc');
        const chrEl = document.getElementById('mito-edu-chr');
        if (phaseEl) phaseEl.textContent = info.name;
        if (descEl) descEl.textContent = info.desc;
        if (chrEl) {
            const chrTexts = [
                '2n → DNA复制 → 2n(含姐妹染色单体)',
                '染色质螺旋化→染色体(每条含2条姐妹染色单体)',
                '着丝粒排列在赤道板，染色体数=2n',
                '着丝粒分裂，染色体数暂时加倍 4n → 2n',
                '染色体解旋为染色质，恢复为 2n',
                '两个子细胞各含 2n 条染色体'
            ];
            chrEl.textContent = chrTexts[this.phase] || '';
        }
    },

    getChromosomePositions(cx, cy, radius, count) {
        const positions = [];
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            positions.push({
                x: cx + Math.cos(angle) * radius,
                y: cy + Math.sin(angle) * radius,
                angle: angle + Math.PI / 4
            });
        }
        return positions;
    }
};

function initMitosis() {
    Mitosis.init();
}

window.Mitosis = Mitosis;
window.initMitosis = initMitosis;
