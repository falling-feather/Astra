/* ═══════════════════════════════════════════════════
   Cellular Respiration – Three Stages Visualization
   ═══════════════════════════════════════════════════ */
const CellularResp = {
    _listeners: [],
    _on(el, evt, fn, opts) { el.addEventListener(evt, fn, opts); this._listeners.push({ el, evt, fn, opts }); },
    canvas: null, ctx: null, animId: null,
    stage: 0, // 0=glycolysis, 1=krebs, 2=etc
    progress: 0,
    autoPlay: true,
    speed: 1,
    stages: [
        { name: '\u7CD6\u9175\u89E3', loc: '\u7EC6\u80DE\u8D28\u57FA\u8D28', input: 'C\u2086H\u2081\u2082O\u2086', output: '2 \u4E19\u916E\u9178 + 2ATP + 2NADH', color: 'rgba(100,200,100,0.8)' },
        { name: '\u67E0\u6AAC\u9178\u5FAA\u73AF', loc: '\u7EBF\u7C92\u4F53\u57FA\u8D28', input: '2 \u4E19\u916E\u9178', output: '6CO\u2082 + 2ATP + 8NADH + 2FADH\u2082', color: 'rgba(255,180,50,0.8)' },
        { name: '\u7535\u5B50\u4F20\u9012\u94FE', loc: '\u7EBF\u7C92\u4F53\u5185\u819C', input: '10NADH + 2FADH\u2082 + O\u2082', output: 'ATP（氧化磷酸化，产量会变动） + H\u2082O', color: 'rgba(100,150,255,0.8)' }
    ],
    particles: [],

    init() {
        this.canvas = document.getElementById('cell-resp-canvas');
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
        this._initParticles();
        this._loop();
    },
    destroy() {
        if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
        this._listeners.forEach(l => l.el.removeEventListener(l.evt, l.fn, l.opts));
        this._listeners.length = 0;
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
        this.autoPlay = true;
        const c = document.getElementById('cell-resp-controls');
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
        const ctrl = document.getElementById('cell-resp-controls');
        if (!ctrl) return;
        ctrl.innerHTML = '';
        const btnWrap = document.createElement('div');
        btnWrap.className = 'cellresp-stage-btns';
        this.stages.forEach((s, i) => {
            const b = document.createElement('button');
            b.className = 'cellresp-btn' + (i === this.stage ? ' active' : '');
            b.textContent = s.name;
            this._on(b, 'click', () => {
                this.stage = i;
                this.progress = 0;
                this._initParticles();
                btnWrap.querySelectorAll('.cellresp-btn').forEach(x => x.classList.remove('active'));
                b.classList.add('active');
                this._updateInfo();
            });
            btnWrap.appendChild(b);
        });
        ctrl.appendChild(btnWrap);
        // speed
        const label = document.createElement('label');
        label.className = 'cellresp-speed';
        label.innerHTML = '<span>\u901F\u5EA6</span>';
        const inp = document.createElement('input');
        inp.type = 'range'; inp.min = 0.3; inp.max = 3; inp.step = 0.1; inp.value = 1;
        this._on(inp, 'input', () => { this.speed = parseFloat(inp.value); });
        label.appendChild(inp);
        ctrl.appendChild(label);
    },
    _initParticles() {
        this.particles = [];
        const W = this.W, H = this.H;
        if (this.stage === 0) {
            // glucose -> 2 pyruvate + ATP + NADH
            this.particles.push({ x: W * 0.15, y: H * 0.5, label: 'C\u2086H\u2081\u2082O\u2086', color: 'rgba(100,200,100,0.8)', r: 22, type: 'input' });
        } else if (this.stage === 1) {
            this.particles.push({ x: W * 0.15, y: H * 0.4, label: '\u4E19\u916E\u9178', color: 'rgba(200,150,50,0.8)', r: 18, type: 'input' });
            this.particles.push({ x: W * 0.15, y: H * 0.6, label: '\u4E19\u916E\u9178', color: 'rgba(200,150,50,0.8)', r: 18, type: 'input' });
        } else {
            for (let i = 0; i < 5; i++) {
                this.particles.push({ x: W * 0.1 + i * 15, y: H * 0.35, label: 'NADH', color: 'rgba(100,150,255,0.7)', r: 10, type: 'carrier' });
            }
        }
    },
    _drawGlycolysis(t) {
        const ctx = this.ctx, W = this.W, H = this.H, p = this.progress;
        const fs = Math.max(14, Math.min(22, W * 0.018));
        // cytoplasm background
        ctx.fillStyle = 'rgba(100,200,100,0.04)';
        ctx.fillRect(20, 50, W - 40, H - 80);
        ctx.strokeStyle = 'rgba(100,200,100,0.2)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(20, 50, W - 40, H - 80);
        ctx.font = fs + 'px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(100,200,100,0.5)';
        ctx.fillText('\u7EC6\u80DE\u8D28\u57FA\u8D28', 28, 68);

        const gx = W * 0.2, gy = H * 0.5;
        // glucose
        ctx.beginPath();
        const sides = 6;
        for (let i = 0; i < sides; i++) {
            const a = (Math.PI * 2 / sides) * i - Math.PI / 2;
            const rx = gx + Math.cos(a) * 25 * (1 - p * 0.3);
            const ry = gy + Math.sin(a) * 25 * (1 - p * 0.3);
            if (i === 0) ctx.moveTo(rx, ry);
            else ctx.lineTo(rx, ry);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(100,200,100,' + (0.5 - p * 0.3) + ')';
        ctx.fill();
        ctx.strokeStyle = 'rgba(100,200,100,0.6)';
        ctx.stroke();
        ctx.font = 'bold ' + fs + 'px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        if (p < 0.5) ctx.fillText('C\u2086H\u2081\u2082O\u2086', gx, gy + 4);

        // arrow
        const arrowX = W * 0.42;
        ctx.beginPath();
        ctx.moveTo(gx + 30, gy);
        ctx.lineTo(arrowX, gy);
        ctx.strokeStyle = 'rgba(200,200,200,0.3)';
        ctx.lineWidth = 2;
        ctx.stroke();
        // enzyme label
        ctx.font = fs + 'px ' + CF.sans;
        ctx.fillStyle = 'rgba(200,200,200,0.5)';
        ctx.fillText('\u2193 10\u6B65\u9176\u4FC3\u53CD\u5E94', (gx + 30 + arrowX) / 2, gy - 15);

        // products (2 pyruvate)
        const px1 = W * 0.6, px2 = W * 0.6;
        const py1 = H * 0.38, py2 = H * 0.62;
        const prodAlpha = Math.min(1, p * 2);
        // pyruvate 1
        ctx.beginPath();
        ctx.ellipse(px1, py1, 18, 12, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(200,150,50,' + (prodAlpha * 0.6) + ')';
        ctx.fill();
        ctx.font = fs + 'px ' + CF.mono;
        ctx.fillStyle = 'rgba(255,255,255,' + prodAlpha * 0.8 + ')';
        ctx.fillText('\u4E19\u916E\u9178', px1, py1 + 4);
        // pyruvate 2
        ctx.beginPath();
        ctx.ellipse(px2, py2, 18, 12, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(200,150,50,' + (prodAlpha * 0.6) + ')';
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,' + prodAlpha * 0.8 + ')';
        ctx.fillText('\u4E19\u916E\u9178', px2, py2 + 4);

        // ATP production
        const atpX = W * 0.82;
        ['2 ATP', '2 NADH'].forEach((label, i) => {
            const ay = H * 0.38 + i * 50;
            ctx.beginPath();
            ctx.arc(atpX, ay, 16, 0, Math.PI * 2);
            ctx.fillStyle = i === 0 ? 'rgba(255,200,50,' + (prodAlpha * 0.6) + ')' : 'rgba(100,150,255,' + (prodAlpha * 0.6) + ')';
            ctx.fill();
            ctx.font = 'bold ' + fs + 'px ' + CF.mono;
            ctx.fillStyle = 'rgba(255,255,255,' + prodAlpha * 0.8 + ')';
            ctx.fillText(label, atpX, ay + 4);
        });

        // net equation
        ctx.font = fs + 'px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(100,200,100,0.7)';
        ctx.fillText('C\u2086H\u2081\u2082O\u2086 + 2NAD\u207A + 2ADP \u2192 2CH\u2083COCOO\u207B + 2NADH + 2ATP', W / 2, H - 20);
    },
    _drawKrebs(t) {
        const ctx = this.ctx, W = this.W, H = this.H, p = this.progress;
        const fs = Math.max(14, Math.min(22, W * 0.018));
        // mitochondria matrix background
        ctx.fillStyle = 'rgba(255,180,50,0.04)';
        ctx.beginPath();
        ctx.ellipse(W / 2, H / 2, W * 0.42, H * 0.38, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,180,50,0.2)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.font = fs + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,180,50,0.5)';
        ctx.fillText('\u7EBF\u7C92\u4F53\u57FA\u8D28', W / 2, H * 0.15);

        // cycle circle
        const cx = W * 0.45, cy = H * 0.52, cr = Math.min(W, H) * 0.22;
        ctx.beginPath();
        ctx.arc(cx, cy, cr, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,180,50,0.2)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // cycle intermediates
        const intermediates = [
            '\u67E0\u6AAC\u9178', '\u5F02\u67E0\u6AAC\u9178', '\u03B1-\u916E\u6208\u4E8C\u9178',
            '\u7425\u73C0\u9170CoA', '\u7425\u73C0\u9178', '\u5EF6\u80E1\u7D22\u9178',
            '\u82F9\u679C\u9178', '\u8349\u9170\u4E59\u9178'
        ];
        const activeIdx = Math.floor(p * intermediates.length) % intermediates.length;
        intermediates.forEach((name, i) => {
            const a = (Math.PI * 2 / intermediates.length) * i - Math.PI / 2;
            const ix = cx + Math.cos(a) * cr;
            const iy = cy + Math.sin(a) * cr;
            ctx.beginPath();
            ctx.arc(ix, iy, 6, 0, Math.PI * 2);
            ctx.fillStyle = i === activeIdx ? 'rgba(255,180,50,0.8)' : 'rgba(255,180,50,0.3)';
            ctx.fill();
            ctx.font = (fs - 3) + 'px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.fillStyle = i === activeIdx ? 'rgba(255,180,50,0.9)' : 'rgba(200,200,200,0.4)';
            const tx = cx + Math.cos(a) * (cr + 20);
            const ty = cy + Math.sin(a) * (cr + 20);
            ctx.fillText(name, tx, ty + 3);
        });

        // rotating marker
        const markerA = p * Math.PI * 2 - Math.PI / 2;
        const mx = cx + Math.cos(markerA) * cr;
        const my = cy + Math.sin(markerA) * cr;
        ctx.beginPath();
        ctx.arc(mx, my, 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,100,0.8)';
        ctx.fill();

        // products on right side
        const prods = ['CO\u2082 \u00D76', 'NADH \u00D78', 'FADH\u2082 \u00D72', 'ATP \u00D72'];
        const prodColors = ['rgba(200,200,200,0.6)', 'rgba(100,150,255,0.7)', 'rgba(200,100,200,0.7)', 'rgba(255,200,50,0.7)'];
        prods.forEach((pr, i) => {
            const py = H * 0.3 + i * 35;
            const px = W * 0.82;
            ctx.beginPath();
            ctx.arc(px, py, 14, 0, Math.PI * 2);
            ctx.fillStyle = prodColors[i].replace('0.7', '0.3').replace('0.6', '0.3');
            ctx.fill();
            ctx.font = 'bold ' + (fs - 3) + 'px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillStyle = prodColors[i];
            ctx.fillText(pr, px, py + 3);
        });

        // acetyl-CoA input arrow
        ctx.beginPath();
        ctx.moveTo(W * 0.12, H * 0.3);
        ctx.lineTo(cx - cr - 5, cy - cr * 0.5);
        ctx.strokeStyle = 'rgba(200,150,50,0.3)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.font = fs + 'px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(200,150,50,0.7)';
        ctx.fillText('\u4E59\u9170CoA', W * 0.08, H * 0.28);
    },
    _drawETC(t) {
        const ctx = this.ctx, W = this.W, H = this.H, p = this.progress;
        const fs = Math.max(14, Math.min(22, W * 0.018));
        // inner membrane
        ctx.fillStyle = 'rgba(100,150,255,0.04)';
        ctx.fillRect(30, H * 0.25, W - 60, H * 0.5);
        ctx.strokeStyle = 'rgba(100,150,255,0.3)';
        ctx.lineWidth = 2;
        // wavy membrane
        ctx.beginPath();
        for (let x = 30; x < W - 30; x += 2) {
            const y = H * 0.45 + Math.sin(x * 0.05 + t * 2) * 5;
            if (x === 30) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.font = fs + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(100,150,255,0.5)';
        ctx.fillText('\u7EBF\u7C92\u4F53\u5185\u819C', W / 2, H * 0.22);
        ctx.fillStyle = 'rgba(200,200,200,0.4)';
        ctx.fillText('\u819C\u95F4\u8154 (H\u207A \u6D53\u5EA6\u9AD8)', W / 2, H * 0.32);
        ctx.fillText('\u57FA\u8D28 (H\u207A \u6D53\u5EA6\u4F4E)', W / 2, H * 0.62);

        // complexes I-IV + ATP synthase
        const complexes = [
            { name: '\u590D\u5408\u4F53 I', x: W * 0.15 },
            { name: '\u590D\u5408\u4F53 II', x: W * 0.3 },
            { name: '\u590D\u5408\u4F53 III', x: W * 0.5 },
            { name: '\u590D\u5408\u4F53 IV', x: W * 0.68 },
            { name: 'ATP\u5408\u9176', x: W * 0.85 }
        ];
        complexes.forEach((c, i) => {
            const cy = H * 0.45;
            ctx.fillStyle = i === 4 ? 'rgba(255,200,50,0.3)' : 'rgba(100,150,255,0.2)';
            ctx.fillRect(c.x - 18, cy - 20, 36, 40);
            ctx.strokeStyle = i === 4 ? 'rgba(255,200,50,0.5)' : 'rgba(100,150,255,0.4)';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(c.x - 18, cy - 20, 36, 40);
            ctx.font = (fs - 3) + 'px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.fillText(c.name, c.x, cy + 4);
        });

        // electron flow arrows
        for (let i = 0; i < 3; i++) {
            const x1 = complexes[i].x + 18;
            const x2 = complexes[i + 1].x - 18;
            ctx.beginPath();
            ctx.moveTo(x1, H * 0.45);
            ctx.lineTo(x2, H * 0.45);
            ctx.strokeStyle = 'rgba(100,200,255,0.3)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            // electron particles
            const ep = (p * 3 + i * 0.3) % 1;
            const ex = x1 + (x2 - x1) * ep;
            ctx.beginPath();
            ctx.arc(ex, H * 0.45, 4, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(100,200,255,0.8)';
            ctx.fill();
            ctx.font = (fs - 3) + 'px ' + CF.mono;
            ctx.fillStyle = '#fff';
            ctx.fillText('e\u207B', ex, H * 0.45 + 2);
        }

        // H+ ions pumped up
        for (let i = 0; i < 4; i++) {
            const hx = complexes[i].x;
            const hp = (p * 2 + i * 0.25) % 1;
            const hy = H * 0.45 - hp * (H * 0.12);
            ctx.beginPath();
            ctx.arc(hx, hy, 5, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,100,100,' + (0.6 - hp * 0.4) + ')';
            ctx.fill();
            ctx.font = (fs - 3) + 'px ' + CF.mono;
            ctx.fillStyle = 'rgba(255,255,255,' + (0.8 - hp * 0.5) + ')';
            ctx.fillText('H\u207A', hx, hy + 2);
        }

        // H+ flowing through ATP synthase
        const ashp = (p * 1.5) % 1;
        const ashy = H * 0.33 + ashp * (H * 0.25);
        ctx.beginPath();
        ctx.arc(complexes[4].x, ashy, 5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,200,50,0.7)';
        ctx.fill();
        ctx.font = (fs - 3) + 'px ' + CF.mono;
        ctx.fillStyle = '#fff';
        ctx.fillText('H\u207A', complexes[4].x, ashy + 2);

        // ATP output
        ctx.font = 'bold ' + (fs + 5) + 'px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,200,50,0.8)';
        ctx.fillText('ATP 产出', complexes[4].x, H * 0.75);

        // O2 + H+ -> H2O
        ctx.font = fs + 'px ' + CF.mono;
        ctx.fillStyle = 'rgba(200,200,200,0.5)';
        ctx.fillText('O\u2082 + 4H\u207A + 4e\u207B \u2192 2H\u2082O', complexes[3].x, H * 0.75);
    },
    _draw(t) {
        const ctx = this.ctx, W = this.W, H = this.H;
        const fs = Math.max(14, Math.min(22, W * 0.018));
        ctx.clearRect(0, 0, W, H);
        const s = this.stages[this.stage];
        ctx.font = 'bold ' + (fs + 8) + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(58,158,143,0.9)';
        ctx.fillText('\u6709\u6C27\u547C\u5438 - ' + s.name + ' (' + s.loc + ')', W / 2, 25);

        if (this.stage === 0) this._drawGlycolysis(t);
        else if (this.stage === 1) this._drawKrebs(t);
        else this._drawETC(t);

        if (this.autoPlay) {
            this.progress += 0.002 * this.speed;
            if (this.progress > 1) this.progress = 0;
        }
    },
    _injectInfoPanel() {
        const el = document.getElementById('cellresp-info');
        if (!el) return;
        el.innerHTML = `
            <div class="cellresp-info__hd">细胞呼吸知识点</div>
            <div class="cellresp-info__grid">
                <div class="cellresp-info__block">
                    <div class="cellresp-info__sub">当前阶段</div>
                    <div id="cellresp-stage-display" class="cellresp-info__val">糖酵解</div>
                    <div id="cellresp-stage-loc" class="cellresp-info__desc">场所：细胞质基质</div>
                </div>
                <div class="cellresp-info__block">
                    <div class="cellresp-info__sub">三阶段总览</div>
                    <div class="cellresp-info__row"><span class="cellresp-info__key" style="--c:#64c864">糖酵解</span> C₆H₁₂O₆ → 2丙酮酸 + 2ATP + 2NADH</div>
                    <div class="cellresp-info__row"><span class="cellresp-info__key" style="--c:#ffb432">柠檬酸循环</span> 2丙酮酸 → 6CO₂ + 2ATP + 8NADH + 2FADH₂</div>
                    <div class="cellresp-info__row"><span class="cellresp-info__key" style="--c:#6496ff">电子传递链</span> NADH/FADH₂ + O₂ → ATP + H₂O（氧化磷酸化，产量会变动）</div>
                </div>
                <div class="cellresp-info__block">
                    <div class="cellresp-info__sub">能量产出</div>
                    <div id="cellresp-atp-info" class="cellresp-info__val">教材估算可用 34/38 ATP；真实产量随系统变化</div>
                </div>
                <div class="cellresp-info__block">
                    <div class="cellresp-info__sub">知识要点</div>
                    <div class="cellresp-info__note">有氧呼吸总反应式常写作：C₆H₁₂O₆ + 6O₂ → 6CO₂ + 6H₂O + 能量。34/38 ATP 是便于计算的教材近似；实际 ATP 产量会受物种、电子穿梭系统、质子泵效率和中间产物用途影响。O₂ 是电子传递链末端电子受体，最终与 H⁺ 结合生成水；糖酵解不需要 O₂，无氧条件下常通过发酵再生 NAD⁺。</div>
                </div>
            </div>
            <div class="cellresp-info__source">参考 OpenStax Biology 2e 7.4 Oxidative Phosphorylation 与 7.5 Metabolism without Oxygen；本页数值用于学习模型，不用于真实细胞能量收支计算。</div>
        `;
    },

    _updateInfo() {
        const s = this.stages[this.stage];
        const nameEl = document.getElementById('cellresp-stage-display');
        const locEl = document.getElementById('cellresp-stage-loc');
        if (nameEl) nameEl.textContent = s.name;
        if (locEl) locEl.textContent = '场所：' + s.loc;
    },

    _loop() {
        const t = performance.now() / 1000;
        this._draw(t);
        this.animId = requestAnimationFrame(() => this._loop());
    }
};

function initCellularResp() { CellularResp.init(); }
window.CellularResp = CellularResp;
