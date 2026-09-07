/* ═══════════════════════════════════════════════════
   Gene Expression – Transcription & Translation
   ═══════════════════════════════════════════════════ */
const GeneExpression = {
    _listeners: [],
    _on(el, evt, fn, opts) { el.addEventListener(evt, fn, opts); this._listeners.push({ el, evt, fn, opts }); },
    canvas: null, ctx: null, animId: null,
    mode: 'transcription', // transcription | translation
    progress: 0,
    autoPlay: true,
    speed: 1,
    // DNA template strand
    dnaTemplate: ['T','A','C','G','A','T','C','C','A','T','A','G','G','C','T','A','C','T'],
    // Codon table entries needed by the teaching sequence plus common examples.
    codonTable: {
        'AUG': 'Met', 'GCU': 'Ala', 'GCC': 'Ala', 'GAU': 'Asp',
        'UUU': 'Phe', 'UUC': 'Phe', 'CCA': 'Pro', 'GGU': 'Gly',
        'UAC': 'Tyr', 'CUA': 'Leu', 'GUA': 'Val', 'AGA': 'Arg',
        'AUC': 'Ile', 'CGA': 'Arg',
        'UAA': 'Stop', 'UAG': 'Stop', 'UGA': 'Stop'
    },
    modeMeta: {
        transcription: {
            label: '转录 (DNA→mRNA)',
            title: '转录：DNA 信息被拷贝成 RNA',
            desc: 'RNA 聚合酶沿模板链读取 DNA，并按互补配对合成 5′→3′ 方向的 RNA；真核细胞中蛋白编码转录产物还要加工成熟。'
        },
        translation: {
            label: '翻译 (mRNA→蛋白质)',
            title: '翻译：核糖体按密码子连接氨基酸',
            desc: '核糖体从 mRNA 的起始密码子开始，以三个碱基为一组读取密码子，tRNA 带来对应氨基酸，直到遇到终止密码子。'
        }
    },

    init() {
        this.canvas = document.getElementById('gene-expression-canvas');
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
        this._loop();
    },
    destroy() {
        if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
        this._listeners.forEach(l => l.el.removeEventListener(l.evt, l.fn, l.opts));
        this._listeners.length = 0;
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
        this.autoPlay = true;
        const c = document.getElementById('gene-expression-controls');
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
        const ctrl = document.getElementById('gene-expression-controls');
        if (!ctrl) return;
        ctrl.innerHTML = '';
        const btnWrap = document.createElement('div');
        btnWrap.className = 'genexp-mode-btns';
        btnWrap.setAttribute('role', 'group');
        btnWrap.setAttribute('aria-label', '基因表达观察模式');
        Object.entries(this.modeMeta).forEach(([id, m]) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'genexp-btn' + (id === this.mode ? ' active' : '');
            b.dataset.mode = id;
            b.textContent = m.label;
            b.setAttribute('aria-pressed', id === this.mode ? 'true' : 'false');
            this._on(b, 'click', () => {
                this.mode = id;
                this.progress = 0;
                btnWrap.querySelectorAll('.genexp-btn').forEach(x => {
                    x.classList.toggle('active', x === b);
                    x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
                });
                this._updateInfo();
            });
            btnWrap.appendChild(b);
        });
        ctrl.appendChild(btnWrap);
        // speed
        const label = document.createElement('label');
        label.className = 'genexp-speed';
        label.innerHTML = '<span>\u901F\u5EA6</span>';
        const inp = document.createElement('input');
        inp.type = 'range'; inp.min = 0.3; inp.max = 3; inp.step = 0.1; inp.value = 1;
        const speedVal = document.createElement('span');
        speedVal.className = 'genexp-speed__value';
        speedVal.textContent = '1.0x';
        this._on(inp, 'input', () => {
            this.speed = parseFloat(inp.value);
            speedVal.textContent = this.speed.toFixed(1) + 'x';
        });
        label.appendChild(inp);
        label.appendChild(speedVal);
        ctrl.appendChild(label);
        const playBtn = document.createElement('button');
        playBtn.type = 'button';
        playBtn.className = 'genexp-btn genexp-btn--utility';
        playBtn.textContent = '暂停';
        this._on(playBtn, 'click', () => {
            this.autoPlay = !this.autoPlay;
            playBtn.textContent = this.autoPlay ? '暂停' : '播放';
        });
        ctrl.appendChild(playBtn);
        // replay
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'genexp-btn genexp-btn--utility';
        btn.textContent = '重播';
        this._on(btn, 'click', () => { this.progress = 0; });
        ctrl.appendChild(btn);
    },
    _complement(base) {
        return { 'A': 'U', 'T': 'A', 'C': 'G', 'G': 'C' }[base] || '?';
    },
    _dnaComplement(base) {
        return { 'A': 'T', 'T': 'A', 'C': 'G', 'G': 'C' }[base] || '?';
    },
    _baseColor(base) {
        return { 'A': 'rgba(100,200,100,0.8)', 'T': 'rgba(220,80,80,0.8)', 'U': 'rgba(255,150,50,0.8)', 'C': 'rgba(100,150,255,0.8)', 'G': 'rgba(255,200,50,0.8)' }[base] || 'rgba(200,200,200,0.5)';
    },
    _molecules() {
        const template = this.dnaTemplate.join('');
        const coding = this.dnaTemplate.map(b => this._dnaComplement(b)).join('');
        const mrna = this.dnaTemplate.map(b => this._complement(b)).join('');
        const codons = [];
        for (let i = 0; i < mrna.length - 2; i += 3) {
            codons.push(mrna.slice(i, i + 3));
        }
        const aminoAcids = [];
        for (const codon of codons) {
            const aa = this.codonTable[codon] || '未定';
            if (aa === 'Stop') break;
            aminoAcids.push(aa);
        }
        return { template, coding, mrna, codons, aminoAcids };
    },

    _drawTranscription(t) {
        const ctx = this.ctx, W = this.W, H = this.H;
        const compact = W < 520;
        const fs = Math.max(13, W * 0.012);
        const dna = this.dnaTemplate;
        const n = dna.length;
        const bw = Math.min(36, (W - (compact ? 34 : 80)) / n);
        const startX = (W - n * bw) / 2;
        const dnaY = H * 0.3;
        const mrnaY = H * 0.6;

        // title
        ctx.font = 'bold ' + (compact ? fs + 4 : fs + 8) + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(58,158,143,0.9)';
        ctx.fillText(compact ? '\u8F6C\u5F55\uFF1ADNA \u2192 mRNA' : '\u8F6C\u5F55\u8FC7\u7A0B: DNA \u2192 mRNA', W / 2, 24);

        // labels
        ctx.font = (fs + 5) + 'px ' + CF.sans;
        ctx.fillStyle = 'rgba(200,200,200,0.6)';
        if (compact) {
            ctx.textAlign = 'left';
            ctx.fillText('\u7F16\u7801\u94FE 5\u2032\u21923\u2032', startX, dnaY - 40);
            ctx.fillText('\u6A21\u677F\u94FE 3\u2032\u21925\u2032', startX, dnaY + 38);
            ctx.fillText('mRNA 5\u2032\u21923\u2032', startX, mrnaY - 8);
        } else {
            ctx.textAlign = 'right';
            ctx.fillText('DNA \u6A21\u677F\u94FE (3\u2032\u21925\u2032)', startX - 8, dnaY + 5);
            ctx.fillText('DNA \u7F16\u7801\u94FE (5\u2032\u21923\u2032)', startX - 8, dnaY - 25);
            ctx.fillText('mRNA (5\u2032\u21923\u2032)', startX - 8, mrnaY + 5);
        }

        // RNA polymerase position
        const polyPos = Math.floor(this.progress * n);

        // draw DNA double strand
        for (let i = 0; i < n; i++) {
            const x = startX + i * bw;
            const base = dna[i];
            const comp = this._dnaComplement(base);

            // coding strand (top)
            ctx.fillStyle = i < polyPos ? 'rgba(200,200,200,0.2)' : this._baseColor(comp);
            ctx.fillRect(x + 1, dnaY - 30, bw - 2, 18);
            ctx.font = 'bold ' + fs + 'px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillStyle = i < polyPos ? 'rgba(200,200,200,0.3)' : 'rgba(255,255,255,0.9)';
            ctx.fillText(comp, x + bw / 2, dnaY - 18);

            // template strand (bottom)
            const isUnwound = (i >= polyPos - 2 && i <= polyPos + 2);
            const templateOffsetY = isUnwound ? 10 : 0;
            ctx.fillStyle = this._baseColor(base);
            ctx.fillRect(x + 1, dnaY + templateOffsetY, bw - 2, 18);
            ctx.font = 'bold ' + fs + 'px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.fillText(base, x + bw / 2, dnaY + templateOffsetY + 12);

            // hydrogen bonds
            if (!isUnwound) {
                ctx.beginPath();
                ctx.moveTo(x + bw / 2, dnaY - 12);
                ctx.lineTo(x + bw / 2, dnaY);
                ctx.strokeStyle = 'rgba(200,200,200,0.15)';
                ctx.lineWidth = 1;
                ctx.setLineDash([2, 2]);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            // mRNA being synthesized
            if (i < polyPos) {
                const mrnaBase = this._complement(base);
                ctx.fillStyle = this._baseColor(mrnaBase);
                ctx.fillRect(x + 1, mrnaY, bw - 2, 18);
                ctx.font = 'bold ' + fs + 'px ' + CF.mono;
                ctx.textAlign = 'center';
                ctx.fillStyle = 'rgba(255,255,255,0.9)';
                ctx.fillText(mrnaBase, x + bw / 2, mrnaY + 12);
            }
        }

        // RNA polymerase
        if (polyPos < n) {
            const px = startX + polyPos * bw;
            ctx.beginPath();
            ctx.ellipse(px, dnaY + 5, 20, 14, 0, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(58,158,143,0.3)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(58,158,143,0.6)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.font = (fs - 3) + 'px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(58,158,143,0.9)';
            ctx.fillText('RNA\u805A\u5408\u9176', px, dnaY + 8);
        }

        // direction arrow
        ctx.beginPath();
        ctx.moveTo(startX + polyPos * bw + 25, (dnaY + mrnaY) / 2);
        ctx.lineTo(startX + polyPos * bw + 25, mrnaY - 5);
        ctx.strokeStyle = 'rgba(58,158,143,0.4)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // legend
        ctx.font = fs + 'px ' + CF.mono;
        ctx.textAlign = 'left';
        const bases = ['A', 'T', 'U', 'C', 'G'];
        bases.forEach((b, i) => {
            ctx.fillStyle = this._baseColor(b);
            ctx.fillRect(14 + i * 40, H - 25, 12, 12);
            ctx.fillStyle = 'rgba(200,200,200,0.6)';
            ctx.fillText(b, 28 + i * 40, H - 15);
        });
    },

    _drawTranslation(t) {
        const ctx = this.ctx, W = this.W, H = this.H;
        const compact = W < 520;
        const fs = Math.max(13, W * 0.012);
        const dna = this.dnaTemplate;
        // generate mRNA from DNA template
        const mrna = dna.map(b => this._complement(b));
        const n = mrna.length;
        const bw = Math.min(30, (W - (compact ? 34 : 80)) / n);
        const startX = (W - n * bw) / 2;
        const mrnaY = H * 0.35;
        const proteinY = H * 0.72;

        ctx.font = 'bold ' + (compact ? fs + 4 : fs + 8) + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(58,158,143,0.9)';
        ctx.fillText(compact ? '\u7FFB\u8BD1\uFF1AmRNA \u2192 \u86CB\u767D\u8D28' : '\u7FFB\u8BD1\u8FC7\u7A0B: mRNA \u2192 \u86CB\u767D\u8D28 (\u6C28\u57FA\u9178\u94FE)', W / 2, 24);

        // draw mRNA strand
        ctx.font = fs + 'px ' + CF.sans;
        ctx.fillStyle = 'rgba(200,200,200,0.5)';
        if (compact) {
            ctx.textAlign = 'left';
            ctx.fillText('mRNA', startX, mrnaY - 8);
        } else {
            ctx.textAlign = 'right';
            ctx.fillText('mRNA', startX - 6, mrnaY + 12);
        }

        for (let i = 0; i < n; i++) {
            const x = startX + i * bw;
            ctx.fillStyle = this._baseColor(mrna[i]);
            ctx.fillRect(x + 1, mrnaY, bw - 2, 18);
            ctx.font = 'bold ' + fs + 'px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.fillText(mrna[i], x + bw / 2, mrnaY + 12);
        }

        // codon grouping
        const codons = [];
        for (let i = 0; i < n - 2; i += 3) {
            codons.push(mrna[i] + mrna[i + 1] + mrna[i + 2]);
        }

        // ribosome position (codon index)
        const riboPos = Math.floor(this.progress * codons.length);

        // draw codon brackets
        for (let i = 0; i < codons.length; i++) {
            const x1 = startX + i * 3 * bw;
            const x2 = x1 + 3 * bw;
            ctx.beginPath();
            ctx.moveTo(x1 + 2, mrnaY + 20);
            ctx.lineTo(x1 + 2, mrnaY + 26);
            ctx.lineTo(x2 - 2, mrnaY + 26);
            ctx.lineTo(x2 - 2, mrnaY + 20);
            ctx.strokeStyle = i < riboPos ? 'rgba(58,158,143,0.5)' : 'rgba(200,200,200,0.15)';
            ctx.lineWidth = 1;
            ctx.stroke();
            // codon text
            ctx.font = (fs - 3) + 'px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillStyle = i < riboPos ? 'rgba(58,158,143,0.7)' : 'rgba(200,200,200,0.3)';
            ctx.fillText(codons[i], (x1 + x2) / 2, mrnaY + 38);
        }

        // ribosome
        if (riboPos < codons.length) {
            const rx = startX + riboPos * 3 * bw + 1.5 * bw;
            // large subunit
            ctx.beginPath();
            ctx.ellipse(rx, mrnaY - 10, 22, 12, 0, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(58,158,143,0.15)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(58,158,143,0.4)';
            ctx.lineWidth = 1;
            ctx.stroke();
            // small subunit
            ctx.beginPath();
            ctx.ellipse(rx, mrnaY + 26, 20, 8, 0, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(58,158,143,0.1)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(58,158,143,0.3)';
            ctx.stroke();
            ctx.font = (fs - 3) + 'px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(58,158,143,0.8)';
            ctx.fillText('\u6838\u7CD6\u4F53', rx, mrnaY - 7);
        }

        // tRNA + amino acid chain
        ctx.font = fs + 'px ' + CF.sans;
        ctx.fillStyle = 'rgba(200,200,200,0.5)';
        if (compact) {
            ctx.textAlign = 'left';
            ctx.fillText('\u6C28\u57FA\u9178\u94FE', startX, proteinY - 30);
        } else {
            ctx.textAlign = 'right';
            ctx.fillText('\u6C28\u57FA\u9178\u94FE', startX - 6, proteinY + 5);
        }

        const aaColors = [
            'rgba(100,200,100,0.7)', 'rgba(200,100,100,0.7)', 'rgba(100,150,255,0.7)',
            'rgba(255,200,50,0.7)', 'rgba(200,100,200,0.7)', 'rgba(100,200,200,0.7)'
        ];

        for (let i = 0; i < Math.min(riboPos, codons.length); i++) {
            const codon = codons[i];
            const aa = this.codonTable[codon] || '未定';
            if (aa === 'Stop') break;
            const ax = startX + i * 40 + 20;
            // amino acid circle
            ctx.beginPath();
            ctx.arc(ax, proteinY, 16, 0, Math.PI * 2);
            ctx.fillStyle = aaColors[i % aaColors.length];
            ctx.fill();
            ctx.font = 'bold ' + (fs - 3) + 'px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.fillText(aa, ax, proteinY + 3);
            // peptide bond
            if (i > 0) {
                ctx.beginPath();
                ctx.moveTo(ax - 16, proteinY);
                ctx.lineTo(ax - 24, proteinY);
                ctx.strokeStyle = 'rgba(200,200,200,0.4)';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
            // codon label
            ctx.font = (fs - 3) + 'px ' + CF.mono;
            ctx.fillStyle = 'rgba(200,200,200,0.4)';
            ctx.fillText(codon, ax, proteinY + 26);
        }

        // tRNA delivery
        if (riboPos < codons.length) {
            const codon = codons[riboPos];
            const anticodon = codon.split('').map(b => {
                return { 'A': 'U', 'U': 'A', 'C': 'G', 'G': 'C' }[b] || '?';
            }).join('');
            const tx = startX + riboPos * 3 * bw + 1.5 * bw;
            // tRNA shape (inverted L)
            ctx.beginPath();
            ctx.moveTo(tx - 10, mrnaY + 42);
            ctx.lineTo(tx - 10, mrnaY + 55);
            ctx.lineTo(tx, mrnaY + 65);
            ctx.lineTo(tx + 10, mrnaY + 55);
            ctx.lineTo(tx + 10, mrnaY + 42);
            ctx.strokeStyle = 'rgba(255,200,100,0.5)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.font = (fs - 3) + 'px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(255,200,100,0.7)';
            ctx.fillText('tRNA', tx, mrnaY + 50);
            ctx.fillText(anticodon, tx, mrnaY + 62);
        }
    },

    _draw(t) {
        const ctx = this.ctx, W = this.W, H = this.H;
        ctx.clearRect(0, 0, W, H);
        if (this.mode === 'transcription') {
            this._drawTranscription(t);
        } else {
            this._drawTranslation(t);
        }
        if (this.autoPlay) {
            this.progress += 0.002 * this.speed;
            if (this.progress > 1.1) this.progress = 0;
        }
    },
    _injectInfoPanel() {
        const el = document.getElementById('genexp-info');
        if (!el) return;
        el.innerHTML = `
            <div class="genexp-info__hd">基因表达知识点</div>
            <div class="genexp-info__grid">
                <div class="genexp-info__block">
                    <div class="genexp-info__sub">当前过程</div>
                    <div id="genexp-mode-display" class="genexp-info__val"></div>
                    <div id="genexp-mode-desc" class="genexp-info__desc"></div>
                </div>
                <div class="genexp-info__block">
                    <div class="genexp-info__sub">中心法则</div>
                    <div class="genexp-info__row"><span class="genexp-info__key" style="--c:var(--color-teal,#3a9e8f)">转录</span> DNA 信息被拷贝到 RNA。</div>
                    <div class="genexp-info__row"><span class="genexp-info__key" style="--c:var(--color-purple,#8b6fc0)">翻译</span> mRNA 密码子指定氨基酸顺序。</div>
                </div>
                <div class="genexp-info__block">
                    <div class="genexp-info__sub">读码规则</div>
                    <div class="genexp-info__row"><span class="genexp-info__key" style="--c:#e06c75">配对</span>转录时 A-U、T-A、C-G、G-C。</div>
                    <div class="genexp-info__row"><span class="genexp-info__key" style="--c:#e5c07b">三联体</span>翻译时每 3 个 mRNA 碱基构成 1 个密码子。</div>
                </div>
                <div class="genexp-info__block">
                    <div class="genexp-info__sub">当前位置</div>
                    <div id="genexp-readout" class="genexp-info__desc"></div>
                </div>
                <div class="genexp-info__block">
                    <div class="genexp-info__sub">真核细胞边界</div>
                    <div class="genexp-info__note">真核蛋白编码基因通常先转录为 pre-mRNA，经 5′ 端加帽、3′ poly-A 尾和剪接后，成熟 mRNA 才进入细胞质参与翻译。</div>
                </div>
                <div class="genexp-info__block">
                    <div class="genexp-info__sub">模型边界</div>
                    <div class="genexp-info__note">画布展示的是概念流程：未呈现启动子、增强子、完整转录因子网络、翻译后修饰，也不表示所有基因都表达为蛋白质。</div>
                </div>
            </div>
            <div class="genexp-info__source">资料依据：OpenStax Biology 2e 15.1、15.3、15.4、15.5。</div>
        `;
        this._updateInfo();
    },

    _updateInfo() {
        const meta = this.modeMeta[this.mode] || this.modeMeta.transcription;
        const title = document.getElementById('genexp-mode-display');
        const desc = document.getElementById('genexp-mode-desc');
        const readout = document.getElementById('genexp-readout');
        if (title) title.textContent = meta.title;
        if (desc) desc.textContent = meta.desc;
        if (readout) {
            const data = this._molecules();
            if (this.mode === 'translation') {
                readout.textContent = `mRNA ${data.mrna} · 密码子 ${data.codons.join(' | ')} · 多肽链 ${data.aminoAcids.join('-')}，遇到 ${data.codons[data.aminoAcids.length]} 终止。`;
            } else {
                readout.textContent = `模板链 ${data.template} · 编码链 ${data.coding} · 转录产物 mRNA ${data.mrna}。`;
            }
        }
    },

    _loop() {
        const t = performance.now() / 1000;
        this._draw(t);
        this.animId = requestAnimationFrame(() => this._loop());
    }
};

function initGeneExpression() { GeneExpression.init(); }
window.GeneExpression = GeneExpression;
