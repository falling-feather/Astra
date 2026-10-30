/* Gas Laws: Boyle, Charles, Gay-Lussac, Avogadro and ideal gas model */
const GasLaws = {
    canvas: null,
    ctx: null,
    W: 0,
    H: 0,
    animId: null,
    _listeners: [],
    _ro: null,
    mode: 'boyle',
    pressure: 1.0,
    volume: 24.6,
    tempC: 27,
    amount: 1.0,
    t: 0,
    particles: [],
    modes: [
        {
            key: 'boyle',
            label: 'Boyle 定律',
            formula: 'P ∝ 1/V',
            hold: 'T、n 保持不变',
            desc: '温度和物质的量恒定时，气体压强与体积成反比。'
        },
        {
            key: 'charles',
            label: 'Charles 定律',
            formula: 'V ∝ T',
            hold: 'P、n 保持不变',
            desc: '压强和物质的量恒定时，气体体积与热力学温度成正比。'
        },
        {
            key: 'gaylussac',
            label: 'Gay-Lussac 定律',
            formula: 'P ∝ T',
            hold: 'V、n 保持不变',
            desc: '体积和物质的量恒定时，气体压强与热力学温度成正比。'
        },
        {
            key: 'avogadro',
            label: 'Avogadro 定律',
            formula: 'V ∝ n',
            hold: 'P、T 保持不变',
            desc: '温度和压强恒定时，气体体积与物质的量成正比。'
        }
    ],

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        if (this.canvas) this.destroy();
        this.canvas = document.getElementById('gas-laws-canvas');
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
        this._seedParticles();
        this._loop();
    },

    destroy() {
        if (this.animId) cancelAnimationFrame(this.animId);
        this.animId = null;
        this._listeners.forEach(l => l.el.removeEventListener(l.evt, l.fn, l.opts));
        this._listeners.length = 0;
        if (this._ro) this._ro.disconnect();
        this._ro = null;
        const ctrl = document.getElementById('gas-laws-controls');
        if (ctrl) ctrl.innerHTML = '';
        this.canvas = null;
        this.ctx = null;
    },

    _resize() {
        if (!this.canvas || !this.canvas.parentElement) return;
        const dpr = window.devicePixelRatio || 1;
        const w = this.canvas.parentElement.getBoundingClientRect().width;
        const h = Math.min(Math.max(w * 0.48, 330), 460);
        this.canvas.width = Math.floor(w * dpr);
        this.canvas.height = Math.floor(h * dpr);
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w;
        this.H = h;
        this._seedParticles();
    },

    _buildControls() {
        const ctrl = document.getElementById('gas-laws-controls');
        if (!ctrl) return;
        ctrl.innerHTML = '';

        const modeWrap = document.createElement('div');
        modeWrap.className = 'gas-mode-btns';
        modeWrap.setAttribute('role', 'group');
        modeWrap.setAttribute('aria-label', '选择气体定律');
        this.modes.forEach(item => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'gas-btn' + (item.key === this.mode ? ' active' : '');
            b.dataset.mode = item.key;
            b.setAttribute('aria-pressed', item.key === this.mode ? 'true' : 'false');
            b.textContent = item.label;
            this._on(b, 'click', () => {
                this.mode = item.key;
                modeWrap.querySelectorAll('.gas-btn').forEach(btn => {
                    btn.classList.toggle('active', btn === b);
                    btn.setAttribute('aria-pressed', btn === b ? 'true' : 'false');
                });
                this._applyLawDefaults();
                this._updateSliders();
                this._seedParticles();
                this._updateInfo();
            });
            modeWrap.appendChild(b);
        });
        ctrl.appendChild(modeWrap);

        this.sliderWrap = document.createElement('div');
        this.sliderWrap.className = 'gas-sliders';
        this.sliderInputs = {};
        [
            ['pressure', '压强', ' atm', 0.5, 4, 0.1],
            ['volume', '体积', ' L', 8, 80, 0.5],
            ['tempC', '温度', ' ℃', -20, 180, 1],
            ['amount', '物质的量', ' mol', 0.5, 3, 0.1]
        ].forEach(([prop, label, unit, min, max, step]) => {
            const row = document.createElement('label');
            row.className = 'gas-slider';
            const caption = document.createElement('span');
            caption.textContent = label;
            const input = document.createElement('input');
            input.type = 'range';
            input.min = min;
            input.max = max;
            input.step = step;
            input.value = this[prop];
            const value = document.createElement('span');
            value.className = 'gas-slider__value';
            value.textContent = this._fmt(this[prop], unit);
            this._on(input, 'input', () => {
                this[prop] = parseFloat(input.value);
                value.textContent = this._fmt(this[prop], unit);
                this._seedParticles();
                this._updateInfo();
            });
            row.append(caption, input, value);
            this.sliderInputs[prop] = { input, value, row, unit };
            this.sliderWrap.appendChild(row);
        });
        ctrl.appendChild(this.sliderWrap);
        this._applyLawDefaults();
        this._updateSliders();
    },

    _applyLawDefaults() {
        if (this.mode === 'boyle') {
            this.tempC = 27;
            this.amount = 1;
            this.pressure = 1;
            this.volume = 24.6;
        } else if (this.mode === 'charles') {
            this.pressure = 1;
            this.amount = 1;
            this.tempC = 27;
            this.volume = 24.6;
        } else if (this.mode === 'gaylussac') {
            this.volume = 24.6;
            this.amount = 1;
            this.tempC = 27;
            this.pressure = 1;
        } else {
            this.pressure = 1;
            this.tempC = 27;
            this.amount = 1;
            this.volume = 24.6;
        }
    },

    _updateSliders() {
        const disabled = {
            boyle: ['pressure', 'tempC', 'amount'],
            charles: ['pressure', 'volume', 'amount'],
            gaylussac: ['pressure', 'volume', 'amount'],
            avogadro: ['pressure', 'volume', 'tempC']
        }[this.mode] || [];
        Object.keys(this.sliderInputs || {}).forEach(prop => {
            const s = this.sliderInputs[prop];
            s.input.value = this[prop];
            s.value.textContent = this._fmt(this[prop], s.unit);
            s.input.disabled = disabled.includes(prop);
            s.row.classList.toggle('is-locked', disabled.includes(prop));
        });
    },

    _fmt(v, unit) {
        const decimals = unit.includes('℃') ? 0 : 1;
        return Number(v).toFixed(decimals) + unit;
    },

    _kelvin() {
        return this.tempC + 273.15;
    },

    _idealPressure(volume = this.volume, tempK = this._kelvin(), amount = this.amount) {
        const R = 0.082057;
        return amount * R * tempK / volume;
    },

    _font(weight, size) {
        const family = (window.CF && CF.sans) || 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        return `${weight ? weight + ' ' : ''}${size}px ${family}`;
    },

    _seedParticles() {
        if (!this.W || !this.H) return;
        const count = Math.round(20 + this.amount * 18);
        this.particles = Array.from({ length: count }, () => ({
            x: Math.random(),
            y: Math.random(),
            vx: (Math.random() - 0.5) * 0.012,
            vy: (Math.random() - 0.5) * 0.012,
            r: 2.6 + Math.random() * 1.8
        }));
    },

    _boxDimensions() {
        const maxW = this.W * 0.34;
        const minW = this.W * 0.16;
        const boxW = minW + (this.volume - 8) / 72 * (maxW - minW);
        const boxH = Math.min(this.H * 0.58, 260);
        return { x: this.W * 0.08, y: this.H * 0.24, w: boxW, h: boxH };
    },

    _drawBg() {
        const { ctx, W, H } = this;
        ctx.clearRect(0, 0, W, H);
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, 'rgba(91, 141, 206, 0.14)');
        g.addColorStop(0.55, 'rgba(46, 213, 115, 0.06)');
        g.addColorStop(1, 'rgba(229, 192, 123, 0.08)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.10)';
        for (let y = 52; y < H - 30; y += 34) {
            ctx.beginPath();
            ctx.moveTo(32, y);
            ctx.lineTo(W - 32, y);
            ctx.stroke();
        }
    },

    _drawTitle() {
        const { ctx, W } = this;
        const mode = this._modeData();
        ctx.textAlign = 'center';
        ctx.font = this._font('700', Math.max(18, W * 0.025));
        ctx.fillStyle = 'rgba(226,232,240,0.94)';
        ctx.fillText(mode.label + ' · ' + mode.formula, W / 2, 30);
        ctx.font = this._font('', Math.max(12, W * 0.013));
        ctx.fillStyle = 'rgba(148,163,184,0.82)';
        ctx.fillText(mode.hold + '；温度计算使用 K = ℃ + 273.15', W / 2, 53);
    },

    _modeData() {
        return this.modes.find(m => m.key === this.mode) || this.modes[0];
    },

    _drawContainer() {
        const { ctx } = this;
        const box = this._boxDimensions();
        ctx.fillStyle = 'rgba(15,23,42,0.52)';
        ctx.strokeStyle = 'rgba(91,141,206,0.55)';
        ctx.lineWidth = 2;
        this._roundRect(box.x, box.y, box.w, box.h, 8);
        ctx.fill();
        ctx.stroke();

        const tempFactor = Math.sqrt(Math.max(120, this._kelvin()) / 300);
        this.particles.forEach(p => {
            p.x += p.vx * tempFactor;
            p.y += p.vy * tempFactor;
            if (p.x < 0.03 || p.x > 0.97) p.vx *= -1;
            if (p.y < 0.04 || p.y > 0.96) p.vy *= -1;
            p.x = Math.max(0.03, Math.min(0.97, p.x));
            p.y = Math.max(0.04, Math.min(0.96, p.y));
            ctx.beginPath();
            ctx.arc(box.x + p.x * box.w, box.y + p.y * box.h, p.r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(125, 211, 252, 0.78)';
            ctx.fill();
        });

        const pistonX = box.x + box.w;
        ctx.strokeStyle = 'rgba(229,192,123,0.9)';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(pistonX, box.y - 8);
        ctx.lineTo(pistonX, box.y + box.h + 8);
        ctx.stroke();
        ctx.font = this._font('600', 12);
        ctx.fillStyle = 'rgba(229,192,123,0.9)';
        ctx.textAlign = 'center';
        ctx.fillText('可移动活塞', pistonX, box.y + box.h + 28);
    },

    _drawStateCards() {
        const { ctx, W, H } = this;
        const values = [
            ['P', this.pressure.toFixed(2) + ' atm'],
            ['V', this.volume.toFixed(1) + ' L'],
            ['T', this._kelvin().toFixed(0) + ' K'],
            ['n', this.amount.toFixed(1) + ' mol']
        ];
        const x = W * 0.08;
        const y = W < 560 ? H * 0.80 : H * 0.85;
        const compact = W < 560;
        const cardW = compact ? (W * 0.50 - 12) / 2 : Math.min(94, (W * 0.42) / 4);
        values.forEach((v, i) => {
            const cx = compact ? x + (i % 2) * (cardW + 8) : x + i * (cardW + 8);
            const cy = compact ? y + Math.floor(i / 2) * 48 : y;
            ctx.fillStyle = 'rgba(15,23,42,0.52)';
            ctx.strokeStyle = 'rgba(148,163,184,0.18)';
            this._roundRect(cx, cy, cardW, 44, 6);
            ctx.fill();
            ctx.stroke();
            ctx.font = this._font('700', 14);
            ctx.fillStyle = 'rgba(125,211,252,0.92)';
            ctx.textAlign = 'center';
            ctx.fillText(v[0], cx + cardW / 2, cy + 17);
            ctx.font = this._font('', 11);
            ctx.fillStyle = 'rgba(226,232,240,0.78)';
            ctx.fillText(v[1], cx + cardW / 2, cy + 34);
        });
    },

    _roundRect(x, y, w, h, r) {
        const { ctx } = this;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    },

    _plotArea() {
        return { x: this.W * 0.52, y: this.H * 0.22, w: this.W * 0.38, h: this.H * 0.54 };
    },

    _drawAxes(xLabel, yLabel) {
        const { ctx } = this;
        const p = this._plotArea();
        ctx.strokeStyle = 'rgba(226,232,240,0.32)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x, p.y + p.h);
        ctx.lineTo(p.x + p.w, p.y + p.h);
        ctx.stroke();
        ctx.font = this._font('', 12);
        ctx.fillStyle = 'rgba(203,213,225,0.78)';
        ctx.textAlign = 'center';
        ctx.fillText(xLabel, p.x + p.w / 2, p.y + p.h + 28);
        ctx.save();
        ctx.translate(p.x - 26, p.y + p.h / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(yLabel, 0, 0);
        ctx.restore();
        return p;
    },

    _drawCurve(samples, color) {
        const { ctx } = this;
        const p = this._plotArea();
        ctx.beginPath();
        samples.forEach((s, i) => {
            const x = p.x + s[0] * p.w;
            const y = p.y + p.h - s[1] * p.h;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = 3.5;
        ctx.stroke();
    },

    _drawMarker(px, py, text) {
        const { ctx } = this;
        const p = this._plotArea();
        const x = p.x + px * p.w;
        const y = p.y + p.h - py * p.h;
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(226,232,240,0.32)';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, p.y + p.h);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(x, y, 7 + Math.sin(this.t * 2.2) * 1.2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(229,192,123,0.95)';
        ctx.fill();
        ctx.font = this._font('600', 12);
        ctx.fillStyle = 'rgba(254,243,199,0.96)';
        ctx.textAlign = 'center';
        ctx.fillText(text, x, y - 14);
    },

    _drawPlot() {
        const samples = [];
        if (this.mode === 'boyle') {
            this._drawAxes('体积 V', '压强 P');
            const pAtMin = this._idealPressure(8);
            const pAtMax = this._idealPressure(80);
            for (let i = 0; i <= 100; i++) {
                const v = 8 + i / 100 * 72;
                const p = this._idealPressure(v);
                samples.push([i / 100, (p - pAtMax) / (pAtMin - pAtMax)]);
            }
            this._drawCurve(samples, 'rgba(125,211,252,0.95)');
            this._drawMarker((this.volume - 8) / 72, (this.pressure - pAtMax) / (pAtMin - pAtMax), `${this.volume.toFixed(1)} L`);
        } else if (this.mode === 'charles') {
            this._drawAxes('热力学温度 T', '体积 V');
            const vMin = this.amount * 0.082057 * (253.15) / this.pressure;
            const vMax = this.amount * 0.082057 * (453.15) / this.pressure;
            for (let i = 0; i <= 100; i++) samples.push([i / 100, 0.1 + i / 100 * 0.8]);
            this._drawCurve(samples, 'rgba(46,213,115,0.95)');
            const px = (this.tempC + 20) / 200;
            this._drawMarker(px, 0.1 + ((this.volume - vMin) / (vMax - vMin)) * 0.8, `${this._kelvin().toFixed(0)} K`);
        } else if (this.mode === 'gaylussac') {
            this._drawAxes('热力学温度 T', '压强 P');
            const pMin = this._idealPressure(this.volume, 253.15, this.amount);
            const pMax = this._idealPressure(this.volume, 453.15, this.amount);
            for (let i = 0; i <= 100; i++) samples.push([i / 100, 0.1 + i / 100 * 0.8]);
            this._drawCurve(samples, 'rgba(229,192,123,0.95)');
            const px = (this.tempC + 20) / 200;
            this._drawMarker(px, 0.1 + ((this.pressure - pMin) / (pMax - pMin)) * 0.8, `${this.pressure.toFixed(1)} atm`);
        } else {
            this._drawAxes('物质的量 n', '体积 V');
            const vMin = 0.5 * 0.082057 * this._kelvin() / this.pressure;
            const vMax = 3 * 0.082057 * this._kelvin() / this.pressure;
            for (let i = 0; i <= 100; i++) samples.push([i / 100, 0.12 + i / 100 * 0.78]);
            this._drawCurve(samples, 'rgba(167,139,250,0.95)');
            const px = (this.amount - 0.5) / 2.5;
            this._drawMarker(px, 0.12 + ((this.volume - vMin) / (vMax - vMin)) * 0.78, `${this.amount.toFixed(1)} mol`);
        }
    },

    _syncStateForMode() {
        const tempK = this._kelvin();
        if (this.mode === 'boyle') {
            this.pressure = this._idealPressure(this.volume, tempK, this.amount);
        } else if (this.mode === 'charles') {
            this.volume = this.amount * 0.082057 * tempK / this.pressure;
            this.volume = Math.max(8, Math.min(80, this.volume));
        } else if (this.mode === 'gaylussac') {
            this.pressure = this._idealPressure(this.volume, tempK, this.amount);
        } else if (this.mode === 'avogadro') {
            this.volume = this.amount * 0.082057 * tempK / this.pressure;
            this.volume = Math.max(8, Math.min(80, this.volume));
        }
        this._updateSliders();
    },

    _draw() {
        if (!this.ctx) return;
        this._syncStateForMode();
        this._drawBg();
        this._drawTitle();
        this._drawContainer();
        this._drawStateCards();
        this._drawPlot();
    },

    _injectInfoPanel() {
        const el = document.getElementById('gas-laws-info');
        if (!el) return;
        el.innerHTML = `
            <div class="gas-info__hd">气体实验定律知识点</div>
            <div class="gas-info__grid">
                <div class="gas-info__block">
                    <div class="gas-info__sub">当前观察</div>
                    <div id="gas-mode-title" class="gas-info__val"></div>
                    <div id="gas-mode-desc" class="gas-info__desc"></div>
                </div>
                <div class="gas-info__block">
                    <div class="gas-info__sub">核心限制</div>
                    <div class="gas-info__row"><span class="gas-info__key" style="--c:#7dd3fc">Kelvin</span>气体定律用热力学温度，T(K)=t(℃)+273.15。</div>
                    <div class="gas-info__row"><span class="gas-info__key" style="--c:#2ed573">控制变量</span>每次只比较两个变量，其余条件要恒定。</div>
                    <div class="gas-info__row"><span class="gas-info__key" style="--c:#e5c07b">近似</span>低压、较高温时更接近理想气体。</div>
                </div>
                <div class="gas-info__block">
                    <div class="gas-info__sub">参考依据</div>
                    <div class="gas-info__note">依据 OpenStax Chemistry 2e 气体状态方程与分子动理论章节整理；数值为教学模型，帮助理解趋势。</div>
                </div>
            </div>
        `;
        this._updateInfo();
    },

    _updateInfo() {
        const mode = this._modeData();
        const title = document.getElementById('gas-mode-title');
        const desc = document.getElementById('gas-mode-desc');
        if (title) title.textContent = `${mode.label} · ${mode.formula}`;
        if (desc) desc.textContent = `${mode.desc} ${mode.hold}。`;
    },

    _loop() {
        this.t = performance.now() / 1000;
        this._draw();
        this.animId = requestAnimationFrame(() => this._loop());
    }
};

function initGasLaws() {
    GasLaws.init();
}

window.GasLaws = GasLaws;
