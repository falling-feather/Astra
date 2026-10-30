/* ═══════════════════════════════════════════════════
   Meiosis – Cell Division Visualization
   ═══════════════════════════════════════════════════ */
const Meiosis = {
    _listeners: [],
    _on(el, evt, fn, opts) { el.addEventListener(evt, fn, opts); this._listeners.push({ el, evt, fn, opts }); },
    canvas: null, ctx: null, animId: null,
    phase: 0, // 0-7 phases of meiosis
    progress: 0,
    autoPlay: false,
    speed: 1,
    phases: [
        { name: '\u524D\u671F I', desc: '\u540C\u6E90\u67D3\u8272\u4F53\u8054\u4F1A\u3001\u4EA4\u53C9\u4E92\u6362' },
        { name: '\u4E2D\u671F I', desc: '\u540C\u6E90\u67D3\u8272\u4F53\u6392\u5217\u5728\u8D64\u9053\u677F\u4E24\u4FA7' },
        { name: '\u540E\u671F I', desc: '\u540C\u6E90\u67D3\u8272\u4F53\u5206\u79BB\u5411\u4E24\u6781' },
        { name: '\u672B\u671F I', desc: '\u7EC6\u80DE\u8D28\u5206\u88C2\uFF0C\u5F62\u6210\u4E24\u4E2A\u5B50\u7EC6\u80DE' },
        { name: '\u524D\u671F II', desc: '\u67D3\u8272\u4F53\u518D\u6B21\u8058\u7F29' },
        { name: '\u4E2D\u671F II', desc: '\u67D3\u8272\u4F53\u6392\u5217\u5728\u8D64\u9053\u677F' },
        { name: '\u540E\u671F II', desc: '\u59D0\u59B9\u67D3\u8272\u5355\u4F53\u5206\u5F00' },
        { name: '\u672B\u671F II', desc: '\u5F62\u6210\u56DB\u4E2A\u5355\u500D\u4F53\u7EC6\u80DE' }
    ],

    init() {
        this.canvas = document.getElementById('meiosis-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this._resize();
        if (typeof ResizeObserver !== 'undefined') {
            this._ro = new ResizeObserver(() => this._resize());
            this._ro.observe(this.canvas.parentElement);
        } else {
            this._on(window, 'resize', () => this._resize());
        }
        this._buildControls();
        this._injectInfoPanel();
        this.phase = 0;
        this.progress = 0;
        this._loop();
    },
    destroy() {
        if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
        this._listeners.forEach(l => l.el.removeEventListener(l.evt, l.fn, l.opts));
        this._listeners.length = 0;
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
        this.autoPlay = false;
        const c = document.getElementById('meiosis-controls');
        if (c) c.innerHTML = '';
    },
    _resize() {
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
        this.W = w;
        this.H = h;
    },
    _buildControls() {
        const ctrl = document.getElementById('meiosis-controls');
        if (!ctrl) return;
        ctrl.innerHTML = '';
        // step buttons
        const btnPrev = document.createElement('button');
        btnPrev.className = 'meio-btn';
        btnPrev.textContent = '\u25C0 \u4E0A\u4E00\u6B65';
        this._on(btnPrev, 'click', () => { if (this.phase > 0) { this.phase--; this.progress = 0; } });
        ctrl.appendChild(btnPrev);

        const btnPlay = document.createElement('button');
        btnPlay.className = 'meio-btn active';
        btnPlay.textContent = '\u25B6 \u64AD\u653E';
        this._on(btnPlay, 'click', () => {
            this.autoPlay = !this.autoPlay;
            btnPlay.textContent = this.autoPlay ? '\u275A\u275A \u6682\u505C' : '\u25B6 \u64AD\u653E';
            btnPlay.classList.toggle('active', this.autoPlay);
        });
        ctrl.appendChild(btnPlay);

        const btnNext = document.createElement('button');
        btnNext.className = 'meio-btn';
        btnNext.textContent = '\u4E0B\u4E00\u6B65 \u25B6';
        this._on(btnNext, 'click', () => { if (this.phase < 7) { this.phase++; this.progress = 0; } });
        ctrl.appendChild(btnNext);

        // speed
        const label = document.createElement('label');
        label.className = 'meio-speed';
        label.innerHTML = '<span>\u901F\u5EA6</span>';
        const inp = document.createElement('input');
        inp.type = 'range'; inp.min = 0.2; inp.max = 3; inp.step = 0.2; inp.value = 1;
        this._on(inp, 'input', () => { this.speed = parseFloat(inp.value); });
        label.appendChild(inp);
        ctrl.appendChild(label);
    },

    _drawCell(cx, cy, r, squeeze) {
        const ctx = this.ctx;
        // cell membrane
        ctx.beginPath();
        if (squeeze > 0) {
            const rx = r * (1 - squeeze * 0.3);
            const ry = r;
            ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        } else {
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
        }
        ctx.fillStyle = 'rgba(58,158,143,0.08)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(58,158,143,0.4)';
        ctx.lineWidth = 2;
        ctx.stroke();
    },
    _drawChromosome(x, y, angle, len, color, hasSister) {
        const ctx = this.ctx;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        if (hasSister) {
            // two sister chromatids joined at centromere
            ctx.beginPath();
            ctx.moveTo(-2, -len / 2);
            ctx.quadraticCurveTo(-5, 0, -2, len / 2);
            ctx.strokeStyle = color;
            ctx.lineWidth = 4;
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(2, -len / 2);
            ctx.quadraticCurveTo(5, 0, 2, len / 2);
            ctx.stroke();
            // centromere dot
            ctx.beginPath();
            ctx.arc(0, 0, 3, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
        } else {
            ctx.beginPath();
            ctx.moveTo(0, -len / 2);
            ctx.quadraticCurveTo(-3, 0, 0, len / 2);
            ctx.strokeStyle = color;
            ctx.lineWidth = 4;
            ctx.stroke();
        }
        ctx.restore();
    },
    _drawSpindle(cx, cy, r, progress) {
        const ctx = this.ctx;
        const poleTop = { x: cx, y: cy - r * 1.1 };
        const poleBot = { x: cx, y: cy + r * 1.1 };
        for (let i = -2; i <= 2; i++) {
            const offsetX = i * 12;
            ctx.beginPath();
            ctx.moveTo(poleTop.x, poleTop.y);
            ctx.quadraticCurveTo(cx + offsetX, cy, poleBot.x, poleBot.y);
            ctx.strokeStyle = 'rgba(200,200,200,0.15)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    },

    _draw(t) {
        const ctx = this.ctx, W = this.W, H = this.H;
        ctx.clearRect(0, 0, W, H);
        const fs = Math.max(13, W * 0.012);
        const ph = this.phase;
        const p = this.progress;

        // colors for homologous pairs
        const red = 'rgba(220,80,80,0.8)';
        const blue = 'rgba(80,140,220,0.8)';
        const chrLen = 28;

        const cx = W / 2, cy = H / 2;
        const cellR = Math.min(W, H) * 0.3;

        if (ph <= 3) {
            // ── Meiosis I ──
            if (ph === 0) {
                // Prophase I: synapsis + crossing over
                this._drawCell(cx, cy, cellR, 0);
                this._drawSpindle(cx, cy, cellR, p);
                // homologous pairs close together (synapsis)
                const sep = 8 - p * 5; // come together
                this._drawChromosome(cx - sep - 15, cy - 10, 0.1, chrLen, red, true);
                this._drawChromosome(cx + sep - 15, cy - 10, -0.1, chrLen, blue, true);
                this._drawChromosome(cx - sep + 15, cy + 10, 0.1, chrLen, red, true);
                this._drawChromosome(cx + sep + 15, cy + 10, -0.1, chrLen, blue, true);
                // crossing over visualization
                if (p > 0.5) {
                    ctx.beginPath();
                    ctx.moveTo(cx - 18, cy - 10);
                    ctx.lineTo(cx - 12, cy - 10);
                    ctx.strokeStyle = 'rgba(255,255,100,0.5)';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                    ctx.font = fs + 'px ' + CF.sans;
                    ctx.fillStyle = 'rgba(255,255,100,0.7)';
                    ctx.textAlign = 'center';
                    ctx.fillText('\u4EA4\u53C9\u4E92\u6362', cx - 15, cy - 30);
                }
            } else if (ph === 1) {
                // Metaphase I: tetrads align
                this._drawCell(cx, cy, cellR, 0);
                this._drawSpindle(cx, cy, cellR, 1);
                // equatorial plate (dashed line)
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(cx - cellR * 0.8, cy);
                ctx.lineTo(cx + cellR * 0.8, cy);
                ctx.strokeStyle = 'rgba(200,200,200,0.2)';
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.setLineDash([]);
                // chromosomes on plate
                this._drawChromosome(cx - 20, cy - 4, 0, chrLen, red, true);
                this._drawChromosome(cx - 20, cy + 4, 0, chrLen, blue, true);
                this._drawChromosome(cx + 20, cy - 4, 0, chrLen, red, true);
                this._drawChromosome(cx + 20, cy + 4, 0, chrLen, blue, true);
            } else if (ph === 2) {
                // Anaphase I: homologs separate
                this._drawCell(cx, cy, cellR, p * 0.3);
                this._drawSpindle(cx, cy, cellR, 1);
                const sep = p * cellR * 0.5;
                // red pair goes up, blue goes down
                this._drawChromosome(cx - 20, cy - sep - 5, 0, chrLen, red, true);
                this._drawChromosome(cx + 20, cy - sep + 5, 0, chrLen, red, true);
                this._drawChromosome(cx - 20, cy + sep - 5, 0, chrLen, blue, true);
                this._drawChromosome(cx + 20, cy + sep + 5, 0, chrLen, blue, true);
            } else {
                // Telophase I: two cells
                const splitDist = cellR * 0.7;
                const subR = cellR * 0.55;
                this._drawCell(cx, cy - splitDist * 0.5, subR, 0);
                this._drawCell(cx, cy + splitDist * 0.5, subR, 0);
                // cleavage furrow
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.moveTo(cx - subR, cy);
                ctx.lineTo(cx + subR, cy);
                ctx.strokeStyle = 'rgba(200,200,200,0.3)';
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.setLineDash([]);
                // chromosomes in each cell
                this._drawChromosome(cx - 12, cy - splitDist * 0.5, 0.2, chrLen, red, true);
                this._drawChromosome(cx + 12, cy - splitDist * 0.5, -0.2, chrLen, red, true);
                this._drawChromosome(cx - 12, cy + splitDist * 0.5, 0.2, chrLen, blue, true);
                this._drawChromosome(cx + 12, cy + splitDist * 0.5, -0.2, chrLen, blue, true);
            }
        } else {
            // ── Meiosis II ──
            const topY = cy - cellR * 0.45;
            const botY = cy + cellR * 0.45;
            const subR = cellR * 0.4;

            if (ph === 4) {
                // Prophase II
                this._drawCell(cx, topY, subR, 0);
                this._drawCell(cx, botY, subR, 0);
                this._drawSpindle(cx, topY, subR, p);
                this._drawSpindle(cx, botY, subR, p);
                this._drawChromosome(cx - 10, topY, 0.1, chrLen * 0.9, red, true);
                this._drawChromosome(cx + 10, topY, -0.1, chrLen * 0.9, red, true);
                this._drawChromosome(cx - 10, botY, 0.1, chrLen * 0.9, blue, true);
                this._drawChromosome(cx + 10, botY, -0.1, chrLen * 0.9, blue, true);
            } else if (ph === 5) {
                // Metaphase II
                this._drawCell(cx, topY, subR, 0);
                this._drawCell(cx, botY, subR, 0);
                this._drawSpindle(cx, topY, subR, 1);
                this._drawSpindle(cx, botY, subR, 1);
                // equatorial plate
                [topY, botY].forEach(yy => {
                    ctx.setLineDash([3, 3]);
                    ctx.beginPath();
                    ctx.moveTo(cx - subR * 0.7, yy);
                    ctx.lineTo(cx + subR * 0.7, yy);
                    ctx.strokeStyle = 'rgba(200,200,200,0.2)';
                    ctx.stroke();
                    ctx.setLineDash([]);
                });
                this._drawChromosome(cx - 10, topY, 0, chrLen * 0.9, red, true);
                this._drawChromosome(cx + 10, topY, 0, chrLen * 0.9, red, true);
                this._drawChromosome(cx - 10, botY, 0, chrLen * 0.9, blue, true);
                this._drawChromosome(cx + 10, botY, 0, chrLen * 0.9, blue, true);
            } else if (ph === 6) {
                // Anaphase II: sister chromatids separate
                this._drawCell(cx, topY, subR, p * 0.2);
                this._drawCell(cx, botY, subR, p * 0.2);
                const sep = p * subR * 0.4;
                // top cell
                this._drawChromosome(cx - 10, topY - sep, 0, chrLen * 0.7, red, false);
                this._drawChromosome(cx + 10, topY - sep, 0, chrLen * 0.7, red, false);
                this._drawChromosome(cx - 10, topY + sep, 0, chrLen * 0.7, red, false);
                this._drawChromosome(cx + 10, topY + sep, 0, chrLen * 0.7, red, false);
                // bottom cell
                this._drawChromosome(cx - 10, botY - sep, 0, chrLen * 0.7, blue, false);
                this._drawChromosome(cx + 10, botY - sep, 0, chrLen * 0.7, blue, false);
                this._drawChromosome(cx - 10, botY + sep, 0, chrLen * 0.7, blue, false);
                this._drawChromosome(cx + 10, botY + sep, 0, chrLen * 0.7, blue, false);
            } else {
                // Telophase II: four haploid cells
                const positions = [
                    { x: cx - cellR * 0.5, y: topY },
                    { x: cx + cellR * 0.5, y: topY },
                    { x: cx - cellR * 0.5, y: botY },
                    { x: cx + cellR * 0.5, y: botY }
                ];
                const smallR = subR * 0.6;
                const colors = [red, red, blue, blue];
                positions.forEach((pos, i) => {
                    this._drawCell(pos.x, pos.y, smallR, 0);
                    this._drawChromosome(pos.x - 6, pos.y, 0.2, chrLen * 0.6, colors[i], false);
                    this._drawChromosome(pos.x + 6, pos.y, -0.2, chrLen * 0.6, colors[i], false);
                    // ploidy label
                    ctx.font = fs + 'px ' + CF.mono;
                    ctx.textAlign = 'center';
                    ctx.fillStyle = 'rgba(200,200,200,0.5)';
                    ctx.fillText('n', pos.x, pos.y + smallR + 12);
                });
            }
        }

        // phase info
        const info = this.phases[ph];
        ctx.font = 'bold ' + (fs + 8) + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(58,158,143,0.9)';
        ctx.fillText((ph < 4 ? '\u51CF\u6570\u5206\u88C2 I - ' : '\u51CF\u6570\u5206\u88C2 II - ') + info.name, W / 2, 25);
        ctx.font = (fs + 5) + 'px ' + CF.sans;
        ctx.fillStyle = 'rgba(200,200,200,0.6)';
        ctx.fillText(info.desc, W / 2, 45);
        this._updateInfo();

        // phase progress indicator
        ctx.font = fs + 'px ' + CF.mono;
        ctx.textAlign = 'center';
        for (let i = 0; i < 8; i++) {
            const px = W / 2 - 70 + i * 20;
            const py = H - 20;
            ctx.beginPath();
            ctx.arc(px, py, 6, 0, Math.PI * 2);
            ctx.fillStyle = i === ph ? 'rgba(58,158,143,0.8)' : (i < ph ? 'rgba(58,158,143,0.3)' : 'rgba(200,200,200,0.15)');
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.fillText(i + 1, px, py + 3);
        }

        // chromosome legend
        ctx.font = fs + 'px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillStyle = red;
        ctx.fillRect(14, H - 40, 12, 3);
        ctx.fillText('\u6BCD\u65B9\u67D3\u8272\u4F53', 30, H - 36);
        ctx.fillStyle = blue;
        ctx.fillRect(14, H - 25, 12, 3);
        ctx.fillText('\u7236\u65B9\u67D3\u8272\u4F53', 30, H - 21);

        // auto-advance
        if (this.autoPlay) {
            this.progress += 0.003 * this.speed;
            if (this.progress >= 1) {
                this.progress = 0;
                if (this.phase < 7) this.phase++;
                else { this.phase = 0; }
            }
        }
    },
    _injectInfoPanel() {
        const el = document.getElementById('meiosis-info');
        if (!el) return;
        el.innerHTML = `
            <div class="meio-info__hd">📘 减数分裂知识点</div>
            <div class="meio-info__grid">
                <div class="meio-info__block">
                    <div class="meio-info__sub">当前阶段</div>
                    <div id="meio-phase-name" class="meio-info__val">前期 I</div>
                    <div id="meio-phase-desc" class="meio-info__desc">同源染色体联会、交叉互换</div>
                </div>
                <div class="meio-info__block">
                    <div class="meio-info__sub">染色体变化</div>
                    <div id="meio-chr-info" class="meio-info__val">减 I 后 2n → n</div>
                </div>
                <div class="meio-info__block">
                    <div class="meio-info__sub">关键概念</div>
                    <div class="meio-info__row"><span class="meio-info__key" style="--c:var(--color-teal,#3a9e8f)">减数分裂 I</span> 同源染色体分离，染色体数减半</div>
                    <div class="meio-info__row"><span class="meio-info__key" style="--c:var(--color-purple,#8b6fc0)">减数分裂 II</span> 着丝粒断裂，姐妹染色单体分开</div>
                    <div class="meio-info__row"><span class="meio-info__key" style="--c:#e5c07b">交叉互换</span> 增加遗传多样性</div>
                </div>
                <div class="meio-info__block">
                    <div class="meio-info__sub">💡 知识要点</div>
                    <div class="meio-info__note">减数分裂产生4个单倍体配子(n)，DNA复制一次，细胞分裂两次。交叉互换发生在前期I，是基因重组的重要来源。</div>
                </div>
            </div>
        `;
    },

    _updateInfo() {
        const phaseNames = ['前期 I','中期 I','后期 I','末期 I','前期 II','中期 II','后期 II','末期 II'];
        const nameEl = document.getElementById('meio-phase-name');
        const descEl = document.getElementById('meio-phase-desc');
        const chrEl = document.getElementById('meio-chr-info');
        if (nameEl) nameEl.textContent = phaseNames[this.phase] || '';
        if (descEl) descEl.textContent = this.phases[this.phase]?.desc || '';
        if (chrEl) {
            const chrInfo = [
                '2n，已复制；同源染色体联会',
                '2n，同源染色体成对排列',
                '同源染色体分离，减 I 后染色体数减半',
                '减 I 完成：每个子细胞为 n，染色体仍含姐妹染色单体',
                'n，准备第二次分裂',
                'n，染色体排列在赤道板',
                '姐妹染色单体分离',
                '形成 4 个 n 配子'
            ][this.phase] || '';
            chrEl.textContent = chrInfo;
        }
    },

    _loop() {
        const t = performance.now() / 1000;
        this._draw(t);
        this.animId = requestAnimationFrame(() => this._loop());
    }
};

function initMeiosis() { Meiosis.init(); }
window.Meiosis = Meiosis;
