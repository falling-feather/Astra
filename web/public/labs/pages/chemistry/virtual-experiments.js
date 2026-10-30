// ===== Chemistry Virtual Experiments =====
// Concept-first simulations for titration, precipitation, and indicators.

const ChemVirtualExperiments = {
    canvas: null,
    ctx: null,
    W: 0,
    H: 0,
    _listeners: [],
    _resizeObs: null,

    mode: 'titration',
    acid: 'strong',
    volume: 25,
    precip: 'agcl',
    mix: 70,
    indicator: 'phenolphthalein',
    ph: 8.8,

    MODES: {
        titration: { label: '酸碱滴定', icon: '曲线' },
        precipitation: { label: '沉淀观察', icon: '离子' },
        indicator: { label: '指示剂颜色', icon: 'pH' }
    },

    ACIDS: {
        strong: {
            label: 'HCl 强酸',
            short: '强酸 + 强碱',
            formula: 'HCl + NaOH -> NaCl + H2O',
            eq: '等量点 pH = 7.00',
            key: '强酸和强碱几乎完全电离，等量点主要由水的自电离决定。'
        },
        weak: {
            label: 'CH3COOH 弱酸',
            short: '弱酸 + 强碱',
            formula: 'CH3COOH + NaOH -> CH3COONa + H2O',
            eq: '等量点 pH > 7',
            key: '半等量点 pH = pKa；等量点因 CH3COO- 水解而偏碱性。'
        }
    },

    PRECIPITATES: {
        agcl: {
            label: 'Ag+ + Cl-',
            product: 'AgCl(s)',
            color: '#eef6f8',
            tone: '#dbeafe',
            result: '白色沉淀',
            rule: '多数氯化物可溶，但 AgCl 难溶，会从溶液中析出。',
            precip: true
        },
        caco3: {
            label: 'Ca2+ + CO3^2-',
            product: 'CaCO3(s)',
            color: '#f3f4f6',
            tone: '#e0f2fe',
            result: '白色沉淀',
            rule: '多数碳酸盐难溶；碳酸钙以固体形式析出。',
            precip: true
        },
        cuoh2: {
            label: 'Cu2+ + OH-',
            product: 'Cu(OH)2(s)',
            color: '#59b6d7',
            tone: '#bae6fd',
            result: '蓝色沉淀',
            rule: 'Cu2+ 与 OH- 生成难溶氢氧化铜，常表现为蓝色沉淀。',
            precip: true
        },
        nano3: {
            label: 'Na+ + NO3-',
            product: '无沉淀',
            color: '#7dd3fc',
            tone: '#dff7ff',
            result: '仍为澄清溶液',
            rule: '钠盐和硝酸盐通常可溶，混合后没有难溶固体生成。',
            precip: false
        }
    },

    INDICATORS: {
        methylOrange: {
            label: '甲基橙',
            low: 3.1,
            high: 4.4,
            colors: ['#f15b5b', '#f59e0b', '#facc15'],
            note: '酸性红，过渡橙，较高 pH 时呈黄。'
        },
        bromothymolBlue: {
            label: '溴百里酚蓝',
            low: 6.0,
            high: 7.6,
            colors: ['#facc15', '#4ade80', '#38bdf8'],
            note: '酸性黄，中性附近绿，碱性蓝。'
        },
        phenolphthalein: {
            label: '酚酞',
            low: 8.3,
            high: 10.0,
            colors: ['rgba(240,248,255,.18)', '#f9a8d4', '#ec4899'],
            note: '酸性和中性近无色，碱性范围变粉红。'
        }
    },

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        this.destroy();
        this.canvas = document.getElementById('vexp-canvas');
        if (!this.canvas) return;

        this.ctx = this.canvas.getContext('2d');
        this.canvas.setAttribute('role', 'img');
        this.canvas.setAttribute('aria-label', '化学虚拟实验：酸碱滴定、沉淀反应和指示剂颜色变化');
        this.resize();
        this.bindEvents();
        this.renderControls();
        this.updateInfo();
        this.draw();
    },

    destroy() {
        for (const l of this._listeners) l.el.removeEventListener(l.evt, l.fn, l.opts);
        this._listeners = [];
        if (this._resizeObs) {
            this._resizeObs.disconnect();
            this._resizeObs = null;
        }
    },

    resize() {
        if (!this.canvas) return;
        const wrap = this.canvas.parentElement;
        if (!wrap) return;
        const dpr = window.devicePixelRatio || 1;
        const w = wrap.getBoundingClientRect().width || 640;
        const h = Math.min(Math.max(w * 0.54, 320), 480);
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w;
        this.H = h;
        this.draw();
    },

    bindEvents() {
        const controls = document.getElementById('vexp-controls');
        if (controls) {
            this._on(controls, 'click', (e) => {
                const modeBtn = e.target.closest('[data-vexp-mode]');
                if (modeBtn) {
                    this.mode = modeBtn.dataset.vexpMode;
                    this.renderControls();
                    this.updateInfo();
                    this.draw();
                    return;
                }

                const acidBtn = e.target.closest('[data-vexp-acid]');
                if (acidBtn) {
                    this.acid = acidBtn.dataset.vexpAcid;
                    this.renderControls();
                    this.updateInfo();
                    this.draw();
                    return;
                }

                const precipBtn = e.target.closest('[data-vexp-precip]');
                if (precipBtn) {
                    this.precip = precipBtn.dataset.vexpPrecip;
                    this.renderControls();
                    this.updateInfo();
                    this.draw();
                    return;
                }

                const indicatorBtn = e.target.closest('[data-vexp-indicator]');
                if (indicatorBtn) {
                    this.indicator = indicatorBtn.dataset.vexpIndicator;
                    this.renderControls();
                    this.updateInfo();
                    this.draw();
                }
            });

            this._on(controls, 'input', (e) => {
                if (e.target.id === 'vexp-volume') {
                    this.volume = Number(e.target.value);
                    this.renderControls();
                    this.updateInfo();
                    this.draw();
                }
                if (e.target.id === 'vexp-mix') {
                    this.mix = Number(e.target.value);
                    this.renderControls();
                    this.updateInfo();
                    this.draw();
                }
                if (e.target.id === 'vexp-ph') {
                    this.ph = Number(e.target.value);
                    this.renderControls();
                    this.updateInfo();
                    this.draw();
                }
            });
        }

        if (typeof ResizeObserver !== 'undefined' && this.canvas.parentElement) {
            this._resizeObs = new ResizeObserver(() => this.resize());
            this._resizeObs.observe(this.canvas.parentElement);
        } else {
            this._on(window, 'resize', () => this.resize());
        }
    },

    renderControls() {
        const controls = document.getElementById('vexp-controls');
        if (!controls) return;

        const modeButtons = Object.entries(this.MODES).map(([id, item]) => `
            <button class="vexp-mode ${this.mode === id ? 'active' : ''}" type="button"
                data-vexp-mode="${id}" aria-pressed="${this.mode === id}">
                <span>${item.icon}</span>${item.label}
            </button>
        `).join('');

        let detail = '';
        if (this.mode === 'titration') {
            const acidButtons = Object.entries(this.ACIDS).map(([id, item]) => `
                <button class="vexp-chip ${this.acid === id ? 'active' : ''}" type="button"
                    data-vexp-acid="${id}" aria-pressed="${this.acid === id}">${item.label}</button>
            `).join('');
            detail = `
                <div class="vexp-control-row" role="group" aria-label="选择滴定类型">${acidButtons}</div>
                <label class="vexp-range">NaOH 加入体积
                    <input id="vexp-volume" type="range" min="0" max="50" value="${this.volume}" step="0.5">
                    <span>${this.volume.toFixed(1)} mL</span>
                </label>
            `;
        } else if (this.mode === 'precipitation') {
            const pairButtons = Object.entries(this.PRECIPITATES).map(([id, item]) => `
                <button class="vexp-chip ${this.precip === id ? 'active' : ''}" type="button"
                    data-vexp-precip="${id}" aria-pressed="${this.precip === id}">${item.label}</button>
            `).join('');
            detail = `
                <div class="vexp-control-row" role="group" aria-label="选择离子组合">${pairButtons}</div>
                <label class="vexp-range">混合比例
                    <input id="vexp-mix" type="range" min="0" max="100" value="${this.mix}" step="5">
                    <span>${this.mix}%</span>
                </label>
            `;
        } else {
            const indicatorButtons = Object.entries(this.INDICATORS).map(([id, item]) => `
                <button class="vexp-chip ${this.indicator === id ? 'active' : ''}" type="button"
                    data-vexp-indicator="${id}" aria-pressed="${this.indicator === id}">${item.label}</button>
            `).join('');
            detail = `
                <div class="vexp-control-row" role="group" aria-label="选择酸碱指示剂">${indicatorButtons}</div>
                <label class="vexp-range">溶液 pH
                    <input id="vexp-ph" type="range" min="0" max="14" value="${this.ph}" step="0.1">
                    <span>${this.ph.toFixed(1)}</span>
                </label>
            `;
        }

        controls.innerHTML = `
            <div class="vexp-modebar" role="group" aria-label="选择虚拟实验">${modeButtons}</div>
            <div class="vexp-control-panel">${detail}</div>
        `;
    },

    getTitrationState(volumeMl = this.volume, acidType = this.acid) {
        const ca = 0.100;
        const cb = 0.100;
        const va = 0.025;
        const vb = volumeMl / 1000;
        const total = va + vb;
        const nAcid = ca * va;
        const nBase = cb * vb;
        const eps = 1e-9;
        const clamp = v => Math.max(0, Math.min(14, v));

        if (acidType === 'strong') {
            if (Math.abs(nAcid - nBase) < eps) {
                return { pH: 7, stage: '等量点', species: 'H+ 与 OH- 恰好中和', ratio: 1 };
            }
            if (nAcid > nBase) {
                const h = (nAcid - nBase) / total;
                return { pH: clamp(-Math.log10(h)), stage: '等量点前', species: '酸过量', ratio: nBase / nAcid };
            }
            const oh = (nBase - nAcid) / total;
            return { pH: clamp(14 + Math.log10(oh)), stage: '等量点后', species: 'OH- 过量', ratio: nBase / nAcid };
        }

        const ka = 1.8e-5;
        const pka = -Math.log10(ka);
        if (nBase < eps) {
            const h = (-ka + Math.sqrt(ka * ka + 4 * ka * ca)) / 2;
            return { pH: clamp(-Math.log10(h)), stage: '初始弱酸', species: 'CH3COOH 部分电离', ratio: 0 };
        }
        if (Math.abs(nAcid - nBase) < eps) {
            const kb = 1e-14 / ka;
            const cSalt = nAcid / total;
            const oh = Math.sqrt(kb * cSalt);
            return { pH: clamp(14 + Math.log10(oh)), stage: '等量点', species: 'CH3COO- 水解', ratio: 1 };
        }
        if (nBase < nAcid) {
            const nHa = nAcid - nBase;
            const nA = nBase;
            const pH = pka + Math.log10(nA / nHa);
            const nearHalf = Math.abs(nBase / nAcid - 0.5) < 0.025;
            return {
                pH: clamp(pH),
                stage: nearHalf ? '半等量点' : '缓冲区',
                species: nearHalf ? 'pH = pKa' : 'CH3COOH / CH3COO- 缓冲',
                ratio: nBase / nAcid
            };
        }
        const oh = (nBase - nAcid) / total;
        return { pH: clamp(14 + Math.log10(oh)), stage: '等量点后', species: '强碱过量', ratio: nBase / nAcid };
    },

    getIndicatorColor(pH = this.ph, id = this.indicator) {
        const item = this.INDICATORS[id];
        if (pH < item.low) return { color: item.colors[0], label: '低 pH 颜色' };
        if (pH > item.high) return { color: item.colors[2], label: '高 pH 颜色' };
        return { color: item.colors[1], label: '变色区间' };
    },

    updateInfo() {
        const info = document.getElementById('vexp-info');
        if (!info) return;

        let rows = [];
        if (this.mode === 'titration') {
            const state = this.getTitrationState();
            const acid = this.ACIDS[this.acid];
            rows = [
                ['当前观察', `${acid.short}；NaOH = ${this.volume.toFixed(1)} mL，pH ≈ ${state.pH.toFixed(2)}，${state.stage}。`],
                ['关键判断', `${acid.eq}。${state.species}，所以曲线在等量点附近快速跃迁。`],
                ['适用范围', '25 mL、0.100 mol/L 的教学模型；仅用于虚拟观察，不提供线下实验步骤。'],
                ['参考依据', 'OpenStax Chemistry 2e 14.7：滴定曲线、等量点、半等量点与指示剂变色区间。']
            ];
        } else if (this.mode === 'precipitation') {
            const item = this.PRECIPITATES[this.precip];
            rows = [
                ['当前观察', `${item.label} 混合后：${item.result}。`],
                ['关键判断', `${item.precip ? item.product + ' 从溶液中析出' : '没有难溶产物形成'}，净离子现象取决于溶解性。`],
                ['适用范围', '以常见溶解性规则做定性演示；不代表真实试剂浓度、用量或操作流程。'],
                ['参考依据', 'OpenStax Chemistry 2e 4.2：沉淀反应、酸碱反应与溶解性规则的分类方式。']
            ];
        } else {
            const item = this.INDICATORS[this.indicator];
            const color = this.getIndicatorColor();
            rows = [
                ['当前观察', `${item.label} 在 pH ${this.ph.toFixed(1)} 附近呈现“${color.label}”。`],
                ['关键判断', `${item.note} 指示剂终点应尽量落在滴定突跃范围内。`],
                ['适用范围', '颜色按常见变色区间近似显示；真实颜色会受浓度、光照和溶液背景影响。'],
                ['参考依据', 'OpenStax Chemistry 2e 14.7：酸碱指示剂的颜色变化与滴定终点选择。']
            ];
        }

        info.innerHTML = `
            <div class="vexp-info__head">虚拟实验观察卡</div>
            <div class="vexp-info__grid">
                ${rows.map(([key, val]) => `
                    <div class="vexp-info__row">
                        <span>${key}</span>
                        <p>${val}</p>
                    </div>
                `).join('')}
            </div>
        `;
    },

    draw() {
        const { ctx, W, H } = this;
        if (!ctx || !W || !H) return;
        ctx.clearRect(0, 0, W, H);

        const grad = ctx.createLinearGradient(0, 0, W, H);
        grad.addColorStop(0, '#071210');
        grad.addColorStop(0.5, '#0d1f1b');
        grad.addColorStop(1, '#111827');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
        this.drawGrid();

        if (this.mode === 'titration') this.drawTitration();
        if (this.mode === 'precipitation') this.drawPrecipitation();
        if (this.mode === 'indicator') this.drawIndicator();
    },

    drawGrid() {
        const { ctx, W, H } = this;
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,.035)';
        ctx.lineWidth = 1;
        for (let x = 0; x < W; x += 36) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, H);
            ctx.stroke();
        }
        for (let y = 0; y < H; y += 36) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(W, y);
            ctx.stroke();
        }
        ctx.restore();
    },

    drawTitration() {
        const { ctx, W, H } = this;
        const compact = W < 640;
        const graphW = compact ? W - 62 : Math.max(300, W * 0.58);
        const gx = 48;
        const gy = 42;
        const gh = compact ? H - 132 : H - 92;
        const gw = graphW - 66;
        const mapX = v => gx + (v / 50) * gw;
        const mapY = pH => gy + gh - (pH / 14) * gh;
        const current = this.getTitrationState();
        const acid = this.ACIDS[this.acid];

        this.drawPanel(gx - 18, gy - 22, gw + 56, gh + 62, 'rgba(255,255,255,.035)');
        ctx.strokeStyle = 'rgba(255,255,255,.18)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx, gy + gh);
        ctx.lineTo(gx + gw, gy + gh);
        ctx.stroke();

        ctx.font = '12px Inter, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        for (let p = 0; p <= 14; p += 2) {
            const y = mapY(p);
            ctx.strokeStyle = 'rgba(255,255,255,.055)';
            ctx.beginPath();
            ctx.moveTo(gx, y);
            ctx.lineTo(gx + gw, y);
            ctx.stroke();
            ctx.fillText(String(p), gx - 26, y + 4);
        }
        for (let v = 0; v <= 50; v += 10) {
            const x = mapX(v);
            ctx.fillText(String(v), x - 8, gy + gh + 20);
        }

        ctx.fillStyle = '#a7f3d0';
        ctx.font = '700 13px Inter, sans-serif';
        ctx.fillText('pH', gx - 28, gy - 8);
        ctx.fillText('NaOH / mL', gx + gw - 58, gy + gh + 38);

        ctx.strokeStyle = this.acid === 'strong' ? '#4ade80' : '#38bdf8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let v = 0; v <= 50; v += 0.5) {
            const p = this.getTitrationState(v, this.acid).pH;
            const x = mapX(v);
            const y = mapY(p);
            if (v === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        const mx = mapX(this.volume);
        const my = mapY(current.pH);
        ctx.strokeStyle = 'rgba(250,204,21,.7)';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 6]);
        ctx.beginPath();
        ctx.moveTo(mx, gy);
        ctx.lineTo(mx, gy + gh);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#facc15';
        ctx.beginPath();
        ctx.arc(mx, my, 5, 0, Math.PI * 2);
        ctx.fill();

        if (compact) {
            ctx.fillStyle = 'rgba(255,255,255,.9)';
            ctx.font = '700 14px Inter, sans-serif';
            ctx.fillText(acid.short, gx, H - 74);
            ctx.fillStyle = 'rgba(255,255,255,.62)';
            ctx.font = '12px Inter, sans-serif';
            ctx.fillText(acid.formula, gx, H - 52);
            this.drawBadge(`pH ${current.pH.toFixed(2)}`, gx, H - 34, '#4ade80');
            this.drawBadge(current.stage, gx + 92, H - 34, '#facc15');
        } else {
            const bx = gx + gw + 82;
            const by = gy + 38;
            this.drawBeaker(bx, by + 54, Math.min(150, W - bx - 28), 174, this.solutionColor(current.pH), '待测溶液');
            this.drawDropper(bx + 52, by, '#4ade80');

            ctx.fillStyle = 'rgba(255,255,255,.9)';
            ctx.font = '700 16px Inter, sans-serif';
            ctx.fillText(acid.short, bx, by + 250);
            ctx.fillStyle = 'rgba(255,255,255,.62)';
            ctx.font = '12px Inter, sans-serif';
            this.wrapText(acid.formula, bx, by + 272, 190, 18);
            this.drawBadge(`pH ${current.pH.toFixed(2)}`, bx, by + 302, '#4ade80');
            this.drawBadge(current.stage, bx + 92, by + 302, '#facc15');
        }
    },

    drawPrecipitation() {
        const { ctx, W, H } = this;
        const item = this.PRECIPITATES[this.precip];
        const cx = W / 2;
        const beakerW = Math.min(150, W * 0.24);
        const beakerH = Math.min(180, H * 0.52);
        const y = H * 0.28;
        const leftX = Math.max(28, cx - beakerW - 116);
        const rightX = Math.min(W - beakerW - 28, cx + 116);

        this.drawBeaker(leftX, y, beakerW, beakerH, 'rgba(56,189,248,.28)', '溶液 A');
        this.drawBeaker(rightX, y, beakerW, beakerH, 'rgba(74,222,128,.24)', '溶液 B');

        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,.55)';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.moveTo(leftX + beakerW + 22, y + beakerH * 0.45);
        ctx.quadraticCurveTo(cx, y - 30, rightX - 22, y + beakerH * 0.45);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        this.drawPanel(cx - 125, y + 14, 250, beakerH + 20, 'rgba(255,255,255,.045)');
        this.drawBeaker(cx - 62, y + 46, 124, beakerH - 20, item.precip ? 'rgba(77,158,126,.18)' : 'rgba(125,211,252,.12)', '混合后');

        if (item.precip) {
            const amount = Math.round(this.mix / 5);
            for (let i = 0; i < amount; i++) {
                const px = cx - 44 + (i * 19) % 88;
                const py = y + beakerH + 6 - Math.floor(i / 5) * 8;
                ctx.fillStyle = item.color;
                ctx.globalAlpha = 0.55 + (i % 3) * 0.12;
                ctx.beginPath();
                ctx.arc(px, py, 4 + (i % 2), 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
        }

        ctx.fillStyle = '#e5f7ef';
        ctx.font = '700 18px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(item.label, cx, 56);
        ctx.font = '700 24px Inter, sans-serif';
        ctx.fillText(item.precip ? '↓ ' + item.product : item.product, cx, 88);
        ctx.font = '13px Inter, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,.66)';
        this.wrapText(item.rule, cx - 170, H - 66, 340, 18, 'center');
        ctx.textAlign = 'start';
    },

    drawIndicator() {
        const { ctx, W, H } = this;
        const item = this.INDICATORS[this.indicator];
        const color = this.getIndicatorColor();
        const cx = W * 0.36;
        const by = H * 0.2;
        this.drawBeaker(cx - 72, by + 46, 144, 190, color.color, item.label);

        ctx.fillStyle = 'rgba(255,255,255,.9)';
        ctx.font = '700 18px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${item.label} · pH ${this.ph.toFixed(1)}`, cx, by + 282);
        ctx.textAlign = 'start';

        const sx = Math.min(W * 0.62, W - 260);
        const sy = by + 62;
        const sw = Math.max(210, W - sx - 42);
        const sh = 34;
        const grad = ctx.createLinearGradient(sx, sy, sx + sw, sy);
        grad.addColorStop(0, '#ef4444');
        grad.addColorStop(0.5, '#facc15');
        grad.addColorStop(0.58, '#4ade80');
        grad.addColorStop(1, '#38bdf8');
        ctx.fillStyle = grad;
        this.roundRect(sx, sy, sw, sh, 8);
        ctx.fill();

        for (let p = 0; p <= 14; p += 2) {
            const x = sx + (p / 14) * sw;
            ctx.strokeStyle = 'rgba(255,255,255,.48)';
            ctx.beginPath();
            ctx.moveTo(x, sy + sh + 4);
            ctx.lineTo(x, sy + sh + 12);
            ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,.68)';
            ctx.font = '11px Inter, sans-serif';
            ctx.fillText(String(p), x - 4, sy + sh + 28);
        }

        const px = sx + (this.ph / 14) * sw;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(px, sy - 9);
        ctx.lineTo(px - 7, sy - 20);
        ctx.lineTo(px + 7, sy - 20);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = 'rgba(255,255,255,.86)';
        ctx.font = '700 14px Inter, sans-serif';
        ctx.fillText('变色区间', sx, sy + 92);
        const ix1 = sx + (item.low / 14) * sw;
        const ix2 = sx + (item.high / 14) * sw;
        ctx.fillStyle = 'rgba(250,204,21,.2)';
        this.roundRect(ix1, sy + 102, ix2 - ix1, 20, 6);
        ctx.fill();
        ctx.strokeStyle = '#facc15';
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.68)';
        ctx.font = '12px Inter, sans-serif';
        ctx.fillText(`${item.low.toFixed(1)} - ${item.high.toFixed(1)}`, ix1, sy + 140);
        this.wrapText(item.note, sx, sy + 168, sw, 18);
    },

    solutionColor(pH) {
        if (pH < 3) return 'rgba(248,113,113,.42)';
        if (pH < 6.5) return 'rgba(251,191,36,.32)';
        if (pH < 7.5) return 'rgba(74,222,128,.28)';
        if (pH < 10) return 'rgba(56,189,248,.30)';
        return 'rgba(168,85,247,.34)';
    },

    drawBeaker(x, y, w, h, liquid, label) {
        const { ctx } = this;
        ctx.save();
        ctx.strokeStyle = 'rgba(220,252,231,.52)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 12, y);
        ctx.lineTo(x + 24, y + h);
        ctx.lineTo(x + w - 24, y + h);
        ctx.lineTo(x + w - 12, y);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(220,252,231,.28)';
        ctx.beginPath();
        ctx.moveTo(x + 8, y);
        ctx.lineTo(x + w - 8, y);
        ctx.stroke();
        ctx.fillStyle = liquid;
        ctx.beginPath();
        ctx.moveTo(x + 22, y + h * 0.45);
        ctx.lineTo(x + w - 22, y + h * 0.45);
        ctx.lineTo(x + w - 29, y + h - 10);
        ctx.lineTo(x + 29, y + h - 10);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.20)';
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h * 0.45, w * 0.35, 7, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.68)';
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(label, x + w / 2, y + h + 22);
        ctx.textAlign = 'start';
        ctx.restore();
    },

    drawDropper(x, y, color) {
        const { ctx } = this;
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,.6)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x + 18, y);
        ctx.lineTo(x + 52, y + 54);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.ellipse(x + 58, y + 64, 8, 13, -0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    },

    drawPanel(x, y, w, h, fill) {
        const { ctx } = this;
        ctx.save();
        ctx.fillStyle = fill;
        ctx.strokeStyle = 'rgba(77,158,126,.18)';
        ctx.lineWidth = 1;
        this.roundRect(x, y, w, h, 10);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    },

    drawBadge(text, x, y, color) {
        const { ctx } = this;
        ctx.save();
        ctx.font = '700 12px Inter, sans-serif';
        const w = ctx.measureText(text).width + 18;
        ctx.fillStyle = color + '22';
        ctx.strokeStyle = color + 'aa';
        this.roundRect(x, y, w, 26, 7);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.88)';
        ctx.fillText(text, x + 9, y + 17);
        ctx.restore();
    },

    roundRect(x, y, w, h, r) {
        const { ctx } = this;
        const rr = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.arcTo(x + w, y, x + w, y + h, rr);
        ctx.arcTo(x + w, y + h, x, y + h, rr);
        ctx.arcTo(x, y + h, x, y, rr);
        ctx.arcTo(x, y, x + w, y, rr);
        ctx.closePath();
    },

    wrapText(text, x, y, maxWidth, lineHeight, align = 'start') {
        const { ctx } = this;
        const chars = String(text).split('');
        let line = '';
        let yy = y;
        ctx.textAlign = align;
        const drawX = align === 'center' ? x + maxWidth / 2 : x;
        for (let i = 0; i < chars.length; i++) {
            const test = line + chars[i];
            if (ctx.measureText(test).width > maxWidth && line) {
                ctx.fillText(line, drawX, yy);
                line = chars[i];
                yy += lineHeight;
            } else {
                line = test;
            }
        }
        if (line) ctx.fillText(line, drawX, yy);
        ctx.textAlign = 'start';
    }
};

function initChemVirtualExperiments() {
    ChemVirtualExperiments.init();
}

if (typeof window !== 'undefined') {
    window.ChemVirtualExperiments = ChemVirtualExperiments;
    window.initChemVirtualExperiments = initChemVirtualExperiments;
}
