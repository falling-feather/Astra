// ===== Immune System Visualization v2 =====
// Innate/adaptive immunity · phagocytosis · antibody binding · education panel

const ImmuneSystem = {
    canvas: null, ctx: null, W: 0, H: 0,
    _ls: [], _ro: null, _raf: null, _lastT: 0,
    time: 0, running: true, paused: false, speed: 1,
    mode: 'innate',
    pathogens: [], immuneCells: [], antibodies: [], signals: [],
    _mx: -999, _my: -999, _hitType: null, _hitIdx: -1,
    killed: 0,

    _on(el, ev, fn, o) { el.addEventListener(ev, fn, o); this._ls.push({ el, ev, fn, o }); },

    init() {
        this.canvas = document.getElementById('immune-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.time = 0; this.running = true; this.paused = false;
        this.killed = 0; this._hitType = null; this._hitIdx = -1;
        this._mx = -999; this._my = -999;
        this.resize();
        this.resetSimulation();
        this.bindEvents();
        this._lastT = performance.now();
        this.loop();
        this.updateInfo();
    },

    destroy() {
        this.running = false;
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
        for (const l of this._ls) l.el.removeEventListener(l.ev, l.fn, l.o);
        this._ls = [];
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
    },

    resize() {
        const p = this.canvas.parentElement;
        if (!p) return;
        const dpr = window.devicePixelRatio || 1;
        const w = p.getBoundingClientRect().width;
        const h = Math.min(Math.max(w * 0.48, 300), 420);
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w; this.H = h;
    },

    resetSimulation() {
        this.pathogens = []; this.immuneCells = [];
        this.antibodies = []; this.signals = []; this.killed = 0;
        const rnd = (a, b) => a + Math.random() * (b - a);

        for (let i = 0; i < 8; i++) {
            this.pathogens.push({
                x: rnd(0.3, 0.85), y: rnd(0.15, 0.85),
                vx: (Math.random() - 0.5) * 0.001, vy: (Math.random() - 0.5) * 0.001,
                r: 9 + Math.random() * 3, alive: true, engulfed: false,
                engulfProg: 0, bound: false, hp: 1,
                type: Math.random() < 0.5 ? 'virus' : 'bacteria',
                spikes: 6 + Math.floor(Math.random() * 4),
                phase: Math.random() * Math.PI * 2
            });
        }

        if (this.mode === 'innate') {
            for (let i = 0; i < 3; i++) {
                this.immuneCells.push({
                    x: rnd(0.05, 0.2), y: rnd(0.2, 0.8),
                    vx: 0.0005 + Math.random() * 0.001, vy: (Math.random() - 0.5) * 0.0003,
                    r: 18, type: 'macrophage', target: null, engulfing: false, digested: 0
                });
            }
            this.immuneCells.push({
                x: 0.05, y: 0.5, vx: 0.001, vy: 0,
                r: 13, type: 'neutrophil', target: null, engulfing: false
            });
        } else {
            const adaptiveCells = [
                { x: 0.09, y: 0.28, type: 'bcell' },
                { x: 0.14, y: 0.72, type: 'bcell' },
                { x: 0.08, y: 0.48, type: 'thelper' },
                { x: 0.17, y: 0.58, type: 'tkiller' }
            ];
            adaptiveCells.forEach(cell => {
                this.immuneCells.push({
                    x: cell.x, y: cell.y,
                    vx: cell.type === 'tkiller' ? 0.0006 : cell.type === 'thelper' ? 0.0004 : 0.0003,
                    vy: cell.type === 'bcell' ? (Math.random() - 0.5) * 0.00012 : 0,
                    r: cell.type === 'tkiller' ? 14 : cell.type === 'thelper' ? 12 : 13,
                    type: cell.type,
                    target: null,
                    attacking: false,
                    prodTimer: 0,
                    abProduced: 0
                });
            });
        }
        this.updateInfo();
    },

    bindEvents() {
        if (typeof ResizeObserver !== 'undefined') {
            this._ro = new ResizeObserver(() => this.resize());
            this._ro.observe(this.canvas.parentElement);
        }
        document.querySelectorAll('.immune-mode-btn').forEach(btn => {
            if (!btn.dataset.mode) return;
            this._on(btn, 'click', () => {
                document.querySelectorAll('.immune-mode-btn[data-mode]').forEach(b => {
                    b.classList.remove('active');
                    b.setAttribute('aria-pressed', 'false');
                });
                btn.classList.add('active');
                btn.setAttribute('aria-pressed', 'true');
                this.mode = btn.dataset.mode;
                this.time = 0; this.resetSimulation();
            });
        });
        const resetBtn = document.getElementById('immune-reset');
        if (resetBtn) this._on(resetBtn, 'click', () => { this.time = 0; this.resetSimulation(); });
        const pauseBtn = document.getElementById('immune-pause');
        if (pauseBtn) {
            this._on(pauseBtn, 'click', () => {
                this.paused = !this.paused;
                pauseBtn.textContent = this.paused ? '▶ 继续' : '⏸ 暂停';
                pauseBtn.setAttribute('aria-pressed', String(this.paused));
            });
        }
        const speedEl = document.getElementById('immune-speed');
        const speedVal = document.getElementById('immune-speed-val');
        if (speedEl) this._on(speedEl, 'input', () => {
            this.speed = parseFloat(speedEl.value);
            if (speedVal) speedVal.textContent = this.speed.toFixed(1) + 'x';
        });
        this._on(this.canvas, 'mousemove', e => {
            const r = this.canvas.getBoundingClientRect();
            this._mx = e.clientX - r.left; this._my = e.clientY - r.top;
        });
        this._on(this.canvas, 'mouseleave', () => {
            this._mx = -999; this._my = -999; this._hitType = null; this._hitIdx = -1;
        });
        this._on(this.canvas, 'touchstart', e => {
            if (e.touches.length === 1) {
                const t = e.touches[0], r = this.canvas.getBoundingClientRect();
                this._mx = t.clientX - r.left; this._my = t.clientY - r.top;
            }
        }, { passive: true });
        this._on(this.canvas, 'touchend', () => { this._mx = -999; this._my = -999; });
        this.canvas.setAttribute('role', 'img');
        this.canvas.setAttribute('aria-label', '免疫系统可视化：病原体入侵与免疫细胞应答');
    },

    updateInfo() {
        const el = document.getElementById('immune-info');
        if (!el) return;
        if (this.mode === 'innate') {
            el.innerHTML = `
                <div class="imm-info__hd">先天免疫 / 非特异性免疫</div>
                <div class="imm-info__grid">
                    <div class="imm-info__block">
                        <div class="imm-info__sub">识别方式</div>
                        <div class="imm-info__val">PRR 识别 PAMP</div>
                        <div class="imm-info__desc">巨噬细胞、树突状细胞等用模式识别受体识别病原体常见分子模式，启动炎症和吞噬。</div>
                    </div>
                    <div class="imm-info__block">
                        <div class="imm-info__sub">快速应答</div>
                        <div class="imm-info__val">屏障、炎症、吞噬、补体</div>
                        <div class="imm-info__desc">皮肤和黏膜先阻挡；病原体进入后，中性粒细胞和巨噬细胞可迁移到感染部位并吞噬病原体。</div>
                    </div>
                    <div class="imm-info__block">
                        <div class="imm-info__sub">桥接适应性免疫</div>
                        <div class="imm-info__row"><span class="imm-info__key" style="--c:#e5c07b">树突状细胞</span>吞噬并呈递抗原，迁移到淋巴结激活 T 细胞。</div>
                        <div class="imm-info__row"><span class="imm-info__key" style="--c:var(--accent-teal,#3a9e8f)">细胞因子</span>协调炎症、发热、白细胞募集和后续免疫协作。</div>
                    </div>
                    <div class="imm-info__block">
                        <div class="imm-info__sub">模型边界</div>
                        <div class="imm-info__note">画布强调“快速识别与清除”这一主线；未完整呈现补体级联、干扰素、NK 细胞和不同组织微环境。</div>
                    </div>
                </div>
                <div class="imm-info__source">资料依据：OpenStax Biology 2e 42.1 Innate Immune Response。</div>`;
        } else {
            el.innerHTML = `
                <div class="imm-info__hd">适应性免疫 / 特异性免疫</div>
                <div class="imm-info__grid">
                    <div class="imm-info__block">
                        <div class="imm-info__sub">体液免疫</div>
                        <div class="imm-info__val" style="color:#b48eed">B 细胞 → 浆细胞 → 抗体</div>
                        <div class="imm-info__desc">B 细胞经抗原识别和辅助信号后克隆扩增，浆细胞分泌抗体，抗体可中和、标记或协助补体清除病原体。</div>
                    </div>
                    <div class="imm-info__block">
                        <div class="imm-info__sub">细胞免疫</div>
                        <div class="imm-info__val" style="color:#4d9e7e">CD8 T 细胞清除异常细胞</div>
                        <div class="imm-info__desc">细胞毒性 T 细胞识别呈递异常抗原的靶细胞，可诱导病毒感染细胞或肿瘤细胞凋亡。</div>
                    </div>
                    <div class="imm-info__block">
                        <div class="imm-info__sub">协作节点</div>
                        <div class="imm-info__row"><span class="imm-info__key" style="--c:#4d9e7e">CD4 辅助 T 细胞</span>识别 MHC II-抗原复合物，帮助 B 细胞和其他 T 细胞充分激活。</div>
                        <div class="imm-info__row"><span class="imm-info__key" style="--c:#e5c07b">免疫记忆</span>部分 B/T 细胞成为记忆细胞，再次遇到同一抗原时反应更快更强。</div>
                    </div>
                    <div class="imm-info__block">
                        <div class="imm-info__sub">模型边界</div>
                        <div class="imm-info__note">图中把复杂激活网络压缩为 B 细胞、辅助 T 细胞、杀伤 T 细胞和抗体的协作关系；真实免疫应答还受抗原呈递、共刺激、细胞因子和免疫耐受调控。</div>
                    </div>
                </div>
                <div class="imm-info__source">资料依据：OpenStax Biology 2e 42.2 Adaptive Immune Response 与 42.3 Antibodies。</div>`;
        }
    },

    /* ── Animation ── */
    loop() {
        if (!this.running) return;
        const now = performance.now();
        const raw = (now - this._lastT) / 1000;
        this._lastT = now;
        const dt = Math.min(raw, 0.05) * this.speed;
        if (!this.paused) { this.time += dt; this.update(dt); }
        this.draw();
        this._raf = requestAnimationFrame(() => this.loop());
    },

    update(dt) {
        const { pathogens, immuneCells, antibodies, signals, mode } = this;
        const s = dt * 60;

        for (const p of pathogens) {
            if (!p.alive || p.engulfed) continue;
            p.vx += (Math.random() - 0.5) * 0.0003 * s;
            p.vy += (Math.random() - 0.5) * 0.0003 * s;
            p.vx *= Math.pow(0.97, s); p.vy *= Math.pow(0.97, s);
            p.x += p.vx * s; p.y += p.vy * s;
            if (p.x < 0.05) { p.x = 0.05; p.vx = Math.abs(p.vx); }
            if (p.x > 0.95) { p.x = 0.95; p.vx = -Math.abs(p.vx); }
            if (p.y < 0.1) { p.y = 0.1; p.vy = Math.abs(p.vy); }
            if (p.y > 0.9) { p.y = 0.9; p.vy = -Math.abs(p.vy); }
        }

        for (const ic of immuneCells) {
            if (mode === 'innate' && (ic.type === 'macrophage' || ic.type === 'neutrophil')) {
                let nearest = null, minD = Infinity;
                for (const p of pathogens) {
                    if (!p.alive || p.engulfed) continue;
                    const d = Math.hypot(p.x - ic.x, p.y - ic.y);
                    if (d < minD) { minD = d; nearest = p; }
                }
                if (nearest) {
                    const dx = nearest.x - ic.x, dy = nearest.y - ic.y;
                    const d = Math.hypot(dx, dy) || 1;
                    const accel = ic.type === 'macrophage' ? 0.00018 : 0.00025;
                    ic.vx += (dx / d) * accel * s; ic.vy += (dy / d) * accel * s;
                    if (d < 0.04 && !ic.engulfing) {
                        nearest.engulfed = true; nearest.engulfProg = 0;
                        ic.engulfing = true; ic.target = nearest;
                        signals.push({ x: ic.x, y: ic.y, vx: (Math.random() - 0.5) * 0.003,
                            vy: (Math.random() - 0.5) * 0.003, life: 1 });
                    }
                }
                if (ic.engulfing && ic.target) {
                    ic.target.engulfProg += 0.012 * s;
                    if (ic.target.engulfProg >= 1) {
                        ic.target.alive = false; ic.engulfing = false;
                        ic.target = null; ic.digested = (ic.digested || 0) + 1; this.killed++;
                    }
                }
            }
            if (mode === 'adaptive' && ic.type === 'bcell') {
                ic.prodTimer += dt;
                if (ic.prodTimer > 1.2) {
                    ic.prodTimer = 0; ic.abProduced = (ic.abProduced || 0) + 1;
                    antibodies.push({ x: ic.x, y: ic.y, vx: 0.002 + Math.random() * 0.001,
                        vy: (Math.random() - 0.5) * 0.002, bound: false, target: null, age: 0 });
                }
            }
            if (mode === 'adaptive' && ic.type === 'tkiller') {
                ic.attacking = false;
                for (const p of pathogens) {
                    if (p.alive && p.bound && !p.engulfed) {
                        const d = Math.hypot(p.x - ic.x, p.y - ic.y);
                        if (d < 0.04) {
                            p.hp -= 0.025 * s; ic.attacking = true;
                            if (p.hp <= 0) { p.alive = false; this.killed++; }
                        } else {
                            ic.vx += ((p.x - ic.x) / d) * 0.00012 * s;
                            ic.vy += ((p.y - ic.y) / d) * 0.00012 * s;
                        }
                    }
                }
            }
            if (mode === 'adaptive' && ic.type === 'thelper') ic.vx += 0.00005 * s;
            ic.vx *= Math.pow(0.96, s); ic.vy *= Math.pow(0.96, s);
            ic.x += ic.vx * s; ic.y += ic.vy * s;
            ic.x = Math.max(0.05, Math.min(0.95, ic.x));
            ic.y = Math.max(0.1, Math.min(0.9, ic.y));
        }

        for (let i = antibodies.length - 1; i >= 0; i--) {
            const ab = antibodies[i];
            if (ab.bound) continue;
            ab.x += ab.vx * s; ab.y += ab.vy * s;
            for (const p of pathogens) {
                if (!p.alive || p.bound || p.engulfed) continue;
                if (Math.hypot(p.x - ab.x, p.y - ab.y) < 0.03) {
                    ab.bound = true; ab.target = p; p.bound = true; break;
                }
            }
            if (ab.x > 1.1 || ab.x < -0.1 || ab.y > 1.1 || ab.y < -0.1) antibodies.splice(i, 1);
        }

        for (let i = signals.length - 1; i >= 0; i--) {
            const sig = signals[i];
            sig.x += sig.vx * s; sig.y += sig.vy * s;
            sig.life -= 0.008 * s;
            if (sig.life <= 0) signals.splice(i, 1);
        }
    },

    /* ── Rendering ── */
    draw() {
        const { ctx, W, H, mode, time } = this;
        if (!ctx || W === 0) return;
        ctx.clearRect(0, 0, W, H);
        const fs = Math.max(14, Math.min(22, W * 0.018));

        // Tissue bg
        const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.6);
        bg.addColorStop(0, 'rgba(58,158,143,0.03)'); bg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

        // Hover detection
        this._hitType = null; this._hitIdx = -1;
        if (this._mx > 0 && this._my > 0) {
            for (let i = 0; i < this.immuneCells.length; i++) {
                const ic = this.immuneCells[i];
                if (Math.hypot(ic.x * W - this._mx, ic.y * H - this._my) < ic.r + 8) {
                    this._hitType = 'cell'; this._hitIdx = i; break;
                }
            }
            if (!this._hitType) {
                for (let i = 0; i < this.pathogens.length; i++) {
                    const p = this.pathogens[i];
                    if (!p.alive) continue;
                    if (Math.hypot(p.x * W - this._mx, p.y * H - this._my) < p.r + 6) {
                        this._hitType = 'pathogen'; this._hitIdx = i; break;
                    }
                }
            }
        }

        // Signals
        for (const sig of this.signals) {
            ctx.fillStyle = 'rgba(229,192,123,' + (sig.life * 0.3).toFixed(2) + ')';
            ctx.beginPath(); ctx.arc(sig.x * W, sig.y * H, 3, 0, Math.PI * 2); ctx.fill();
        }
        // Antibodies
        for (const ab of this.antibodies) {
            if (ab.bound && ab.target && !ab.target.alive) continue;
            const ax = (ab.bound && ab.target ? ab.target.x : ab.x) * W;
            const ay = (ab.bound && ab.target ? ab.target.y : ab.y) * H;
            this._drawAb(ax, ay, ab.bound);
        }
        // Pathogens
        for (let i = 0; i < this.pathogens.length; i++) {
            const p = this.pathogens[i];
            if (!p.alive) continue;
            this._drawPath(p.x * W, p.y * H, p, this._hitType === 'pathogen' && this._hitIdx === i);
        }
        // Immune cells
        for (let i = 0; i < this.immuneCells.length; i++) {
            const ic = this.immuneCells[i];
            this._drawCell(ic.x * W, ic.y * H, ic, this._hitType === 'cell' && this._hitIdx === i);
        }

        // HUD
        const alive = this.pathogens.filter(p => p.alive).length;
        ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = fs + 'px ' + CF.sans; ctx.textAlign = 'left';
        ctx.fillText(mode === 'innate' ? '非特异性免疫 (巨噬细胞吞噬)' : '特异性免疫 (抗体 + T 细胞)', 8, 16);
        ctx.fillStyle = 'rgba(224,108,117,0.85)'; ctx.font = fs + 'px ' + CF.mono;
        ctx.fillText('病原体: ' + alive + '/' + this.pathogens.length + '  已清除: ' + this.killed, 8, 30);
        if (mode === 'adaptive') {
            ctx.fillStyle = 'rgba(229,192,123,0.85)';
            ctx.fillText('抗体: ' + this.antibodies.filter(a => !a.bound || (a.target && a.target.alive)).length, 8, 44);
        }
        if (alive === 0) {
            ctx.fillStyle = 'rgba(77,158,126,0.95)'; ctx.font = (fs + 8) + 'px ' + CF.sans; ctx.textAlign = 'center';
            ctx.fillText('✅ 免疫成功！病原体已清除', W / 2, H - 12);
        }

        // Tooltip
        if (this._hitType === 'cell' && this._hitIdx >= 0) {
            const ic = this.immuneCells[this._hitIdx];
            const nm = { macrophage: '巨噬细胞', neutrophil: '中性粒细胞', bcell: 'B 淋巴细胞', thelper: 'T 辅助细胞', tkiller: 'T 杀伤细胞' }[ic.type];
            const extra = ic.type === 'macrophage' ? '已吞噬: ' + (ic.digested || 0) :
                          ic.type === 'bcell' ? '已产生抗体: ' + (ic.abProduced || 0) : '';
            this._drawTip(ic.x * W, ic.y * H - ic.r - 12, [nm, extra].filter(Boolean));
        }
        if (this._hitType === 'pathogen' && this._hitIdx >= 0) {
            const p = this.pathogens[this._hitIdx];
            const st = p.engulfed ? '被吞噬中' : p.bound ? '已被抗体标记' : '活动中';
            this._drawTip(p.x * W, p.y * H - p.r - 12, [p.type === 'virus' ? '病毒' : '细菌', st]);
        }
    },

    _drawPath(px, py, p, hover) {
        const ctx = this.ctx;
        const a = p.engulfed ? (1 - p.engulfProg) * 0.6 : 0.6;
        if (hover) { ctx.save(); ctx.shadowColor = 'rgba(224,108,117,0.5)'; ctx.shadowBlur = 12; }
        ctx.fillStyle = p.type === 'virus' ? 'rgba(224,108,117,' + a + ')' : 'rgba(200,130,100,' + a + ')';
        ctx.beginPath();
        for (let i = 0; i < p.spikes * 2; i++) {
            const ang = (i / (p.spikes * 2)) * Math.PI * 2 + p.phase;
            const r = i % 2 === 0 ? p.r * 1.35 : p.r * 0.75;
            const sx = px + r * Math.cos(ang + this.time * 0.5);
            const sy = py + r * Math.sin(ang + this.time * 0.5);
            i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
        }
        ctx.closePath(); ctx.fill();
        if (p.bound) { ctx.strokeStyle = 'rgba(229,192,123,0.5)'; ctx.lineWidth = 2; ctx.stroke(); }
        if (hover) ctx.restore();
        const g = ctx.createRadialGradient(px, py, 0, px, py, p.r * 0.7);
        g.addColorStop(0, 'rgba(255,200,200,' + (a * 0.3) + ')'); g.addColorStop(1, 'rgba(224,108,117,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, p.r * 0.7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,' + (a * 0.75) + ')';
        ctx.font = (Math.max(14, Math.min(22, this.W * 0.018)) - 3) + 'px ' + CF.mono; ctx.textAlign = 'center';
        ctx.fillText('抗原', px, py + 3);
    },

    _drawCell(ix, iy, ic, hover) {
        const ctx = this.ctx;
        if (hover) { ctx.save(); ctx.shadowColor = 'rgba(91,141,206,0.5)'; ctx.shadowBlur = 14; }

        if (ic.type === 'macrophage') {
            ctx.beginPath();
            for (let i = 0; i < 12; i++) {
                const a = (i / 12) * Math.PI * 2;
                const r = ic.r + Math.sin(a * 3 + this.time * 2) * 4;
                ctx.lineTo(ix + r * Math.cos(a), iy + r * Math.sin(a));
            }
            ctx.closePath();
            const g = ctx.createRadialGradient(ix, iy, 0, ix, iy, ic.r);
            g.addColorStop(0, 'rgba(91,141,206,0.15)'); g.addColorStop(1, 'rgba(91,141,206,0.25)');
            ctx.fillStyle = g; ctx.fill();
            ctx.strokeStyle = 'rgba(91,141,206,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.fillStyle = 'rgba(91,141,206,0.35)';
            ctx.beginPath(); ctx.arc(ix - 3, iy - 1, 5, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(ix + 2, iy + 2, 4, 0, Math.PI * 2); ctx.fill();
            if (ic.engulfing && ic.target) {
                ctx.strokeStyle = 'rgba(224,108,117,0.3)'; ctx.lineWidth = 1; ctx.setLineDash([3, 2]);
                ctx.beginPath(); ctx.arc(ix, iy, ic.r + 4, 0, Math.PI * 2 * ic.target.engulfProg); ctx.stroke();
                ctx.setLineDash([]);
            }
            this._lbl(ix, iy, ic.r, '巨噬');
        } else if (ic.type === 'neutrophil') {
            ctx.beginPath();
            for (let i = 0; i < 10; i++) {
                const a = (i / 10) * Math.PI * 2;
                ctx.lineTo(ix + (ic.r + Math.sin(a * 2 + this.time * 3) * 2) * Math.cos(a),
                           iy + (ic.r + Math.sin(a * 2 + this.time * 3) * 2) * Math.sin(a));
            }
            ctx.closePath();
            ctx.fillStyle = 'rgba(120,180,220,0.18)'; ctx.fill();
            ctx.strokeStyle = 'rgba(120,180,220,0.3)'; ctx.lineWidth = 1; ctx.stroke();
            ctx.fillStyle = 'rgba(120,180,220,0.3)';
            for (let i = 0; i < 3; i++) {
                const a = (i / 3) * Math.PI * 2 + 0.3;
                ctx.beginPath(); ctx.arc(ix + 3 * Math.cos(a), iy + 3 * Math.sin(a), 3, 0, Math.PI * 2); ctx.fill();
            }
            this._lbl(ix, iy, ic.r, '中性');
        } else if (ic.type === 'bcell') {
            ctx.fillStyle = 'rgba(139,111,192,0.2)';
            ctx.beginPath(); ctx.arc(ix, iy, ic.r, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = 'rgba(139,111,192,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
            for (let i = 0; i < 5; i++) {
                const a = (i / 5) * Math.PI * 2 + this.time * 0.3;
                const ex = ix + (ic.r + 3) * Math.cos(a), ey = iy + (ic.r + 3) * Math.sin(a);
                ctx.strokeStyle = 'rgba(229,192,123,0.35)'; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.moveTo(ex, ey);
                const tx = ex + 5 * Math.cos(a), ty = ey + 5 * Math.sin(a);
                ctx.lineTo(tx, ty); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + 2 * Math.cos(a - 0.5), ty + 2 * Math.sin(a - 0.5));
                ctx.moveTo(tx, ty); ctx.lineTo(tx + 2 * Math.cos(a + 0.5), ty + 2 * Math.sin(a + 0.5)); ctx.stroke();
            }
            this._lbl(ix, iy, ic.r, 'B细胞', -10, 12);
        } else if (ic.type === 'thelper') {
            ctx.fillStyle = 'rgba(77,158,126,0.15)';
            ctx.beginPath(); ctx.arc(ix, iy, ic.r, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = 'rgba(77,158,126,0.3)'; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.fillStyle = 'rgba(77,158,126,0.75)'; ctx.font = (Math.max(14, Math.min(22, this.W * 0.018)) - 3) + 'px ' + CF.mono;
            ctx.textAlign = 'center'; ctx.fillText('CD4', ix, iy + 2);
            this._lbl(ix, iy, ic.r, 'Th', -18, -18);
        } else if (ic.type === 'tkiller') {
            ctx.fillStyle = 'rgba(77,158,126,0.2)';
            ctx.beginPath(); ctx.arc(ix, iy, ic.r, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = 'rgba(77,158,126,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.fillStyle = 'rgba(77,158,126,0.85)'; ctx.font = (Math.max(14, Math.min(22, this.W * 0.018)) - 3) + 'px ' + CF.mono;
            ctx.textAlign = 'center'; ctx.fillText('CD8', ix, iy + 2);
            if (ic.attacking) {
                ctx.save(); ctx.shadowColor = 'rgba(224,108,117,0.4)'; ctx.shadowBlur = 10;
                ctx.strokeStyle = 'rgba(224,108,117,0.2)'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(ix, iy, ic.r + 3, 0, Math.PI * 2); ctx.stroke();
                ctx.restore();
            }
            this._lbl(ix, iy, ic.r, 'Tc', 16, 12);
        }
        if (hover) ctx.restore();
    },

    _lbl(x, y, r, t, dx = 0, dy = 11) {
        this.ctx.fillStyle = 'rgba(255,255,255,0.7)'; this.ctx.font = Math.max(14, Math.min(22, this.W * 0.018)) + 'px ' + CF.sans;
        this.ctx.textAlign = 'center'; this.ctx.fillText(t, x + dx, y + r + dy);
    },

    _drawAb(ax, ay, bound) {
        const ctx = this.ctx;
        ctx.strokeStyle = bound ? 'rgba(229,192,123,0.6)' : 'rgba(229,192,123,0.35)';
        ctx.lineWidth = bound ? 2 : 1.5;
        ctx.beginPath(); ctx.moveTo(ax, ay + 7); ctx.lineTo(ax, ay);
        ctx.lineTo(ax - 4, ay - 5); ctx.moveTo(ax, ay);
        ctx.lineTo(ax + 4, ay - 5); ctx.stroke();
        ctx.fillStyle = bound ? 'rgba(229,192,123,0.6)' : 'rgba(229,192,123,0.3)';
        ctx.beginPath(); ctx.arc(ax - 4, ay - 5, 1.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(ax + 4, ay - 5, 1.5, 0, Math.PI * 2); ctx.fill();
    },

    _drawTip(x, y, lines) {
        const ctx = this.ctx;
        ctx.font = Math.max(14, Math.min(22, this.W * 0.018)) + 'px ' + CF.sans;
        const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 16;
        const h = lines.length * 16 + 8;
        const tx = Math.max(4, Math.min(x - w / 2, this.W - w - 4));
        const ty = Math.max(4, y - h);
        ctx.fillStyle = 'rgba(25,25,35,0.88)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(tx, ty, w, h, 5); else ctx.rect(tx, ty, w, h);
        ctx.fill();
        ctx.strokeStyle = 'rgba(58,158,143,0.35)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        lines.forEach((l, i) => ctx.fillText(l, tx + 8, ty + 4 + i * 16));
    }
};

function initImmuneSystem() { ImmuneSystem.init(); }
window.ImmuneSystem = ImmuneSystem;
window.initImmuneSystem = initImmuneSystem;
