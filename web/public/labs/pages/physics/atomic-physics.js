// ===== Atomic Physics: Bohr levels, spectra and photoelectric effect =====
// Teaching model based on hydrogen / hydrogen-like atoms and Einstein's photoelectric equation.

const AtomicPhysics = {
    canvas: null,
    ctx: null,
    W: 0,
    H: 0,
    animId: null,
    _listeners: [],
    _ro: null,
    mode: 'spectrum',
    nInitial: 4,
    nFinal: 2,
    photonEnergy: 3.4,
    workFunction: 2.46,
    intensity: 65,
    speed: 1.0,
    t: 0,

    modes: [
        { key: 'bohr', label: '玻尔能级' },
        { key: 'spectrum', label: '光谱跃迁' },
        { key: 'photoelectric', label: '光电效应' },
        { key: 'limits', label: '模型边界' }
    ],

    _COL: {
        bg0: '#0b1020',
        bg1: '#101827',
        panel: 'rgba(15, 23, 42, 0.72)',
        border: 'rgba(148, 163, 184, 0.22)',
        grid: 'rgba(148, 163, 184, 0.08)',
        text: '#e5edf7',
        muted: 'rgba(226, 232, 240, 0.66)',
        dim: 'rgba(226, 232, 240, 0.42)',
        cyan: '#7dd3fc',
        blue: '#60a5fa',
        green: '#34d399',
        amber: '#fbbf24',
        pink: '#fb7185',
        violet: '#a78bfa'
    },

    _on(el, evt, fn, opts) {
        if (!el) return;
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        if (this.canvas) this.destroy();
        this.canvas = document.getElementById('atomic-physics-canvas');
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
        if (this.animId) cancelAnimationFrame(this.animId);
        this.animId = null;
        this._listeners.forEach(l => l.el.removeEventListener(l.evt, l.fn, l.opts));
        this._listeners.length = 0;
        if (this._ro) this._ro.disconnect();
        this._ro = null;
        const ctrl = document.getElementById('atomic-physics-controls');
        if (ctrl) ctrl.innerHTML = '';
        const info = document.getElementById('atomic-physics-info');
        if (info) info.innerHTML = '';
        this.canvas = null;
        this.ctx = null;
    },

    _resize() {
        if (!this.canvas || !this.canvas.parentElement) return;
        const dpr = window.devicePixelRatio || 1;
        const w = this.canvas.parentElement.getBoundingClientRect().width;
        if (!w) return;
        const h = Math.min(Math.max(w * 0.52, 340), 520);
        this.canvas.width = Math.floor(w * dpr);
        this.canvas.height = Math.floor(h * dpr);
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w;
        this.H = h;
    },

    _buildControls() {
        const ctrl = document.getElementById('atomic-physics-controls');
        if (!ctrl) return;
        ctrl.innerHTML = '';

        const modeWrap = document.createElement('div');
        modeWrap.className = 'atomphys-mode-btns';
        modeWrap.setAttribute('role', 'group');
        modeWrap.setAttribute('aria-label', '选择原子物理观察模式');
        this.modes.forEach(item => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'atomphys-btn' + (item.key === this.mode ? ' active' : '');
            btn.dataset.mode = item.key;
            btn.setAttribute('aria-pressed', item.key === this.mode ? 'true' : 'false');
            btn.textContent = item.label;
            this._on(btn, 'click', () => {
                this.mode = item.key;
                modeWrap.querySelectorAll('.atomphys-btn').forEach(el => {
                    el.classList.toggle('active', el === btn);
                    el.setAttribute('aria-pressed', el === btn ? 'true' : 'false');
                });
                this._updateInfo();
            });
            modeWrap.appendChild(btn);
        });
        ctrl.appendChild(modeWrap);

        this.sliderWrap = document.createElement('div');
        this.sliderWrap.className = 'atomphys-sliders';
        this.sliderRefs = {};
        [
            ['nInitial', '起始能级 nᵢ', '', 2, 7, 1],
            ['nFinal', '终态能级 n_f', '', 1, 6, 1],
            ['photonEnergy', '光子能量', ' eV', 1.5, 8, 0.1],
            ['workFunction', '逸出功 φ', ' eV', 1.8, 6.4, 0.1],
            ['intensity', '光强', '%', 10, 100, 5],
            ['speed', '演示速度', 'x', 0.4, 2.4, 0.1]
        ].forEach(([prop, label, unit, min, max, step]) => {
            const row = document.createElement('label');
            row.className = 'atomphys-slider';
            const caption = document.createElement('span');
            caption.textContent = label;
            const input = document.createElement('input');
            input.type = 'range';
            input.min = min;
            input.max = max;
            input.step = step;
            input.value = this[prop];
            const value = document.createElement('span');
            value.className = 'atomphys-slider__value';
            value.textContent = this._fmtSlider(prop, unit);
            this._on(input, 'input', () => {
                this[prop] = parseFloat(input.value);
                this._sanitizeLevels();
                this._syncSliderValues();
                this._updateInfo();
            });
            row.append(caption, input, value);
            this.sliderRefs[prop] = { input, value, unit };
            this.sliderWrap.appendChild(row);
        });
        ctrl.appendChild(this.sliderWrap);
        this._sanitizeLevels();
        this._syncSliderValues();
    },

    _fmtSlider(prop, unit) {
        const val = this[prop];
        if (prop === 'nInitial' || prop === 'nFinal') return String(Math.round(val));
        if (prop === 'speed') return val.toFixed(1) + unit;
        if (prop === 'intensity') return Math.round(val) + unit;
        return val.toFixed(1) + unit;
    },

    _sanitizeLevels() {
        this.nInitial = Math.round(this.nInitial);
        this.nFinal = Math.round(this.nFinal);
        if (this.nFinal >= this.nInitial) this.nFinal = this.nInitial - 1;
        if (this.nFinal < 1) this.nFinal = 1;
    },

    _syncSliderValues() {
        Object.entries(this.sliderRefs || {}).forEach(([prop, ref]) => {
            ref.input.value = this[prop];
            ref.value.textContent = this._fmtSlider(prop, ref.unit);
        });
    },

    _energy(n) {
        return -13.6 / (n * n);
    },

    _transitionEnergy() {
        return this._energy(this.nInitial) - this._energy(this.nFinal);
    },

    _wavelengthNm(ev) {
        return ev > 0 ? 1240 / ev : 0;
    },

    _seriesName(n) {
        if (n === 1) return 'Lyman 紫外';
        if (n === 2) return 'Balmer 可见/近紫外';
        if (n === 3) return 'Paschen 红外';
        return `n=${n} 系列，主要在红外`;
    },

    _photonState() {
        const kinetic = this.photonEnergy - this.workFunction;
        return {
            kinetic: Math.max(0, kinetic),
            emits: kinetic >= 0,
            stopping: Math.max(0, kinetic),
            current: kinetic >= 0 ? this.intensity / 100 : 0
        };
    },

    _injectInfoPanel() {
        const info = document.getElementById('atomic-physics-info');
        if (!info) return;
        info.innerHTML = `
            <div class="atomphys-info__hd">原子物理知识点</div>
            <div class="atomphys-info__grid">
                <div class="atomphys-info__block">
                    <div class="atomphys-info__sub">当前观察</div>
                    <div id="atomphys-mode-title" class="atomphys-info__val"></div>
                    <div id="atomphys-mode-desc" class="atomphys-info__desc"></div>
                </div>
                <div class="atomphys-info__block">
                    <div class="atomphys-info__sub">核心公式</div>
                    <div class="atomphys-info__row"><span class="atomphys-info__key" style="--c:#7dd3fc">Bohr</span>Eₙ = -13.6/n² eV，仅用于氢原子/类氢离子的教学近似。</div>
                    <div class="atomphys-info__row"><span class="atomphys-info__key" style="--c:#34d399">跃迁</span>向低能级跃迁放出光子，ΔE = hf = hc/λ。</div>
                    <div class="atomphys-info__row"><span class="atomphys-info__key" style="--c:#fbbf24">光电</span>Kmax = hf - φ；强度影响光电流，频率决定最大动能。</div>
                </div>
                <div class="atomphys-info__block">
                    <div class="atomphys-info__sub">参考依据</div>
                    <div class="atomphys-info__note">依据 OpenStax College Physics 2e 30.3 与 University Physics Vol.3 6.2 整理；图中数值为教学模型，不代表真实多电子原子轨道。</div>
                </div>
            </div>
        `;
        this._updateInfo();
    },

    _updateInfo() {
        const title = document.getElementById('atomphys-mode-title');
        const desc = document.getElementById('atomphys-mode-desc');
        if (!title || !desc) return;

        const delta = this._transitionEnergy();
        const lambda = this._wavelengthNm(delta);
        const photo = this._photonState();
        if (this.mode === 'bohr') {
            title.textContent = `玻尔能级 · n=${this.nInitial} 到 n=${this.nFinal}`;
            desc.textContent = `氢原子能级取离散值：E${this.nInitial}=${this._energy(this.nInitial).toFixed(2)} eV，E${this.nFinal}=${this._energy(this.nFinal).toFixed(2)} eV。`;
        } else if (this.mode === 'spectrum') {
            title.textContent = `光谱跃迁 · ${this._seriesName(this.nFinal)}`;
            desc.textContent = `ΔE=${delta.toFixed(2)} eV，对应 λ≈${lambda.toFixed(0)} nm；跃迁终点决定 Lyman/Balmer/Paschen 等系列。`;
        } else if (this.mode === 'photoelectric') {
            title.textContent = `光电效应 · ${photo.emits ? '可逸出电子' : '低于阈值'}`;
            desc.textContent = photo.emits
                ? `Kmax=${photo.kinetic.toFixed(2)} eV，遏止电压约 ${photo.stopping.toFixed(2)} V；提高光强会增加光电流。`
                : `光子能量 ${this.photonEnergy.toFixed(1)} eV 小于逸出功 ${this.workFunction.toFixed(1)} eV，不发生光电子发射。`;
        } else {
            title.textContent = '模型边界 · 历史模型与量子证据';
            desc.textContent = '玻尔模型解释氢光谱很有力，但电子并非沿经典圆轨道运动；多电子原子需要量子力学轨道/概率云模型。';
        }
    },

    _loop() {
        this.t = performance.now() / 1000;
        this._draw();
        this.animId = requestAnimationFrame(() => this._loop());
    },

    _draw() {
        if (!this.ctx) return;
        this._drawBackground();
        this._drawTitle();
        if (this.mode === 'bohr') this._drawBohr();
        else if (this.mode === 'spectrum') this._drawSpectrum();
        else if (this.mode === 'photoelectric') this._drawPhotoelectric();
        else this._drawLimits();
    },

    _drawBackground() {
        const ctx = this.ctx;
        const g = ctx.createLinearGradient(0, 0, this.W, this.H);
        g.addColorStop(0, this._COL.bg0);
        g.addColorStop(1, this._COL.bg1);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, this.W, this.H);
        ctx.strokeStyle = this._COL.grid;
        ctx.lineWidth = 1;
        const gap = 38;
        for (let x = 0; x <= this.W; x += gap) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, this.H);
            ctx.stroke();
        }
        for (let y = 0; y <= this.H; y += gap) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(this.W, y);
            ctx.stroke();
        }
    },

    _drawTitle() {
        const ctx = this.ctx;
        const data = {
            bohr: ['玻尔能级模型', '离散轨道是历史模型；能量量子化才是核心。'],
            spectrum: ['光谱跃迁', '能级差决定光子能量，跃迁终态决定谱线系列。'],
            photoelectric: ['光电效应', '阈频和逸出功说明光以能量包形式交换。'],
            limits: ['模型适用边界', '把模型能解释什么、不能解释什么分开看。']
        }[this.mode];
        ctx.fillStyle = this._COL.text;
        ctx.font = `700 ${this.W < 560 ? 18 : 22}px ${CF.sans}`;
        ctx.fillText(data[0], 24, 34);
        ctx.fillStyle = this._COL.muted;
        ctx.font = `12px ${CF.sans}`;
        this._wrapText(data[1], 24, 55, Math.min(520, this.W - 48), 17, 2);
    },

    _drawBohr() {
        const ctx = this.ctx;
        const compact = this.W < 680;
        const cx = compact ? this.W * 0.5 : this.W * 0.35;
        const cy = compact ? this.H * 0.52 : this.H * 0.55;
        const maxR = Math.min(this.W, this.H) * (compact ? 0.28 : 0.31);
        const levels = [1, 2, 3, 4, 5];
        const pulse = 0.5 + 0.5 * Math.sin(this.t * this.speed * 2.3);

        levels.forEach(n => {
            const r = maxR * (0.22 + n * 0.15);
            ctx.strokeStyle = n === this.nInitial || n === this.nFinal ? 'rgba(125,211,252,0.76)' : 'rgba(148,163,184,0.24)';
            ctx.lineWidth = n === this.nInitial || n === this.nFinal ? 2 : 1;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = this._COL.dim;
            ctx.font = `11px ${CF.mono}`;
            ctx.fillText(`n=${n}`, cx + r + 6, cy - 3);
        });

        const nucleusR = 16 + pulse * 3;
        ctx.fillStyle = 'rgba(251,113,133,0.16)';
        ctx.beginPath();
        ctx.arc(cx, cy, nucleusR + 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = this._COL.pink;
        ctx.beginPath();
        ctx.arc(cx, cy, nucleusR, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = `700 12px ${CF.sans}`;
        ctx.textAlign = 'center';
        ctx.fillText('p+', cx, cy + 4);
        ctx.textAlign = 'left';

        this._drawElectron(cx, cy, maxR, this.nInitial, this._COL.cyan, this.t * this.speed);
        this._drawElectron(cx, cy, maxR, this.nFinal, this._COL.green, -this.t * this.speed * 0.9 + 1.3);

        const delta = this._transitionEnergy();
        const lambda = this._wavelengthNm(delta);
        const panelX = compact ? 24 : this.W * 0.64;
        const panelY = compact ? this.H - 132 : 90;
        const panelW = compact ? this.W - 48 : this.W * 0.31;
        this._panel(panelX, panelY, panelW, compact ? 108 : 168);
        this._metric(panelX + 16, panelY + 24, 'Eₙ', '-13.6/n² eV', this._COL.cyan);
        this._metric(panelX + 16, panelY + 54, `E${this.nInitial}`, `${this._energy(this.nInitial).toFixed(2)} eV`, this._COL.violet);
        this._metric(panelX + 16, panelY + 84, `E${this.nFinal}`, `${this._energy(this.nFinal).toFixed(2)} eV`, this._COL.green);
        if (!compact) {
            this._metric(panelX + 16, panelY + 114, 'ΔE', `${delta.toFixed(2)} eV`, this._COL.amber);
            this._metric(panelX + 16, panelY + 144, 'λ', `${lambda.toFixed(0)} nm`, this._COL.blue);
        }
        this._caption('允许半径随 n² 增大；图中半径为压缩显示。', 24, this.H - 20);
    },

    _drawElectron(cx, cy, maxR, n, color, phase) {
        const r = maxR * (0.22 + n * 0.15);
        const x = cx + Math.cos(phase) * r;
        const y = cy + Math.sin(phase) * r;
        const ctx = this.ctx;
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = this._COL.text;
        ctx.font = `11px ${CF.sans}`;
        ctx.fillText(`e- n=${n}`, x + 10, y - 10);
    },

    _drawSpectrum() {
        const ctx = this.ctx;
        const compact = this.W < 650;
        const left = compact ? 44 : 76;
        const right = compact ? this.W - 36 : this.W * 0.6;
        const top = 82;
        const bottom = this.H - (compact ? 118 : 90);
        const h = bottom - top;
        const yFor = n => top + (0 - this._energy(n)) / 13.6 * h;
        const delta = this._transitionEnergy();
        const lambda = this._wavelengthNm(delta);
        const color = this._spectralColor(lambda);

        ctx.strokeStyle = 'rgba(226,232,240,0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(left - 20, top);
        ctx.lineTo(left - 20, bottom);
        ctx.stroke();
        ctx.fillStyle = this._COL.dim;
        ctx.font = `11px ${CF.sans}`;
        ctx.fillText('Energy', left - 38, top - 10);

        [1, 2, 3, 4, 5, 6].forEach(n => {
            const y = yFor(n);
            ctx.strokeStyle = n === this.nInitial || n === this.nFinal ? 'rgba(125,211,252,0.95)' : 'rgba(148,163,184,0.35)';
            ctx.lineWidth = n === this.nInitial || n === this.nFinal ? 2 : 1;
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(right, y);
            ctx.stroke();
            ctx.fillStyle = this._COL.text;
            ctx.font = `12px ${CF.mono}`;
            ctx.fillText(`n=${n}`, right + 10, y + 4);
            ctx.fillStyle = this._COL.dim;
            ctx.fillText(`${this._energy(n).toFixed(2)} eV`, left + 8, y - 5);
        });

        const yStart = yFor(this.nInitial);
        const yEnd = yFor(this.nFinal);
        const arrowX = left + (right - left) * (0.42 + 0.12 * Math.sin(this.t * this.speed));
        this._arrow(arrowX, yStart - 4, arrowX, yEnd + 6, color);
        ctx.fillStyle = color;
        ctx.font = `700 13px ${CF.sans}`;
        ctx.fillText(`hν = ${delta.toFixed(2)} eV`, arrowX + 14, (yStart + yEnd) / 2);

        const barX = compact ? 34 : this.W * 0.66;
        const barY = compact ? this.H - 88 : 128;
        const barW = compact ? this.W - 68 : this.W * 0.25;
        this._drawSpectrumBar(barX, barY, barW, 20, lambda);
        const panelY = barY + 46;
        this._panel(barX, panelY, barW, compact ? 58 : 118);
        this._metric(barX + 14, panelY + 24, '系列', this._seriesName(this.nFinal), this._COL.cyan);
        this._metric(barX + 14, panelY + 52, '波长', `${lambda.toFixed(0)} nm`, color);
        if (!compact) this._metric(barX + 14, panelY + 80, '可见性', lambda >= 380 && lambda <= 780 ? '可见光范围' : (lambda < 380 ? '紫外区' : '红外区'), this._COL.amber);
        this._caption('向低能级跃迁释放光子；向高能级跃迁需要吸收能量。', 24, this.H - 20);
    },

    _drawSpectrumBar(x, y, w, h, lambda) {
        const ctx = this.ctx;
        const grad = ctx.createLinearGradient(x, y, x + w, y);
        grad.addColorStop(0, '#7c3aed');
        grad.addColorStop(0.2, '#2563eb');
        grad.addColorStop(0.42, '#22c55e');
        grad.addColorStop(0.62, '#facc15');
        grad.addColorStop(0.82, '#f97316');
        grad.addColorStop(1, '#ef4444');
        ctx.fillStyle = 'rgba(15,23,42,0.9)';
        ctx.fillRect(x - 8, y - 26, w + 16, h + 58);
        ctx.fillStyle = grad;
        this._roundRect(x, y, w, h, 8);
        ctx.fill();
        ctx.fillStyle = this._COL.dim;
        ctx.font = `11px ${CF.sans}`;
        ctx.fillText('380 nm', x, y + h + 18);
        ctx.fillText('780 nm', x + w - 44, y + h + 18);
        const pos = Math.max(0, Math.min(1, (lambda - 380) / 400));
        const markerX = x + pos * w;
        ctx.strokeStyle = lambda >= 380 && lambda <= 780 ? '#fff' : this._COL.amber;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(markerX, y - 8);
        ctx.lineTo(markerX, y + h + 8);
        ctx.stroke();
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fillText(lambda < 380 ? 'UV' : (lambda > 780 ? 'IR' : `${lambda.toFixed(0)} nm`), markerX - 14, y - 12);
    },

    _drawPhotoelectric() {
        const ctx = this.ctx;
        const compact = this.W < 650;
        const plateX = compact ? this.W * 0.18 : this.W * 0.42;
        const plateY = this.H * 0.32;
        const plateW = compact ? this.W * 0.64 : this.W * 0.12;
        const plateH = compact ? 32 : this.H * 0.4;
        const photo = this._photonState();
        const photons = Math.round(4 + this.intensity / 18);
        const phase = this.t * this.speed * 70;

        ctx.fillStyle = 'rgba(96,165,250,0.12)';
        for (let i = 0; i < photons; i++) {
            const px = compact ? 48 + i * 28 : 44 + (i % 4) * 36;
            const py = compact ? plateY - 92 + (i % 3) * 22 : plateY + 20 + i * 28;
            const tx = compact ? plateX + 20 + i * 18 : plateX - 8;
            const ty = compact ? plateY + plateH / 2 : py + Math.sin((phase + i * 20) / 22) * 8;
            this._arrow(px, py, tx, ty, this._COL.amber);
            ctx.fillStyle = this._COL.amber;
            ctx.font = `10px ${CF.sans}`;
            ctx.fillText('hf', px - 6, py - 8);
        }

        const metalGrad = ctx.createLinearGradient(plateX, plateY, plateX + plateW, plateY + plateH);
        metalGrad.addColorStop(0, 'rgba(148,163,184,0.95)');
        metalGrad.addColorStop(1, 'rgba(71,85,105,0.95)');
        ctx.fillStyle = metalGrad;
        this._roundRect(plateX, plateY, plateW, plateH, 10);
        ctx.fill();
        ctx.strokeStyle = 'rgba(226,232,240,0.35)';
        ctx.stroke();
        ctx.fillStyle = '#0f172a';
        ctx.font = `700 13px ${CF.sans}`;
        ctx.fillText('metal', plateX + 12, plateY + (compact ? 21 : 24));

        if (photo.emits) {
            const count = Math.round(2 + this.intensity / 22);
            for (let i = 0; i < count; i++) {
                const startX = compact ? plateX + plateW * (0.25 + i * 0.1) : plateX + plateW + 2;
                const startY = compact ? plateY + plateH + 6 : plateY + 30 + i * 44;
                const len = 74 + photo.kinetic * 22;
                const endX = compact ? startX + Math.cos(-0.72 + i * 0.16) * len : startX + len;
                const endY = compact ? startY + Math.sin(-0.72 + i * 0.16) * len : startY - 22 + Math.sin(this.t * 2 + i) * 10;
                this._arrow(startX, startY, endX, endY, this._COL.green);
                ctx.fillStyle = this._COL.green;
                ctx.beginPath();
                ctx.arc(endX, endY, 4, 0, Math.PI * 2);
                ctx.fill();
            }
        } else {
            ctx.fillStyle = 'rgba(251,113,133,0.18)';
            this._roundRect(plateX + plateW + 18, compact ? plateY - 10 : plateY + 80, 118, 46, 8);
            ctx.fill();
            ctx.fillStyle = this._COL.pink;
            ctx.font = `700 13px ${CF.sans}`;
            ctx.fillText('低于阈值', plateX + plateW + 32, compact ? plateY + 18 : plateY + 108);
        }

        const panelX = compact ? 24 : this.W * 0.66;
        const panelY = compact ? this.H - 128 : 104;
        const panelW = compact ? this.W - 48 : this.W * 0.29;
        this._panel(panelX, panelY, panelW, compact ? 104 : 162);
        this._metric(panelX + 16, panelY + 26, 'hf', `${this.photonEnergy.toFixed(1)} eV`, this._COL.amber);
        this._metric(panelX + 16, panelY + 56, 'φ', `${this.workFunction.toFixed(1)} eV`, this._COL.blue);
        this._metric(panelX + 16, panelY + 86, 'Kmax', `${photo.kinetic.toFixed(2)} eV`, photo.emits ? this._COL.green : this._COL.pink);
        if (!compact) {
            this._metric(panelX + 16, panelY + 116, '遏止电压', `${photo.stopping.toFixed(2)} V`, this._COL.violet);
            this._metric(panelX + 16, panelY + 146, '相对光电流', `${Math.round(photo.current * 100)}%`, this._COL.cyan);
        }
        this._caption('光强增加的是单位时间到达的光子数；单个电子最大动能由光子频率决定。', 24, this.H - 20);
    },

    _drawLimits() {
        const compact = this.W < 680;
        const margin = 24;
        const gap = 14;
        const cardW = compact ? this.W - margin * 2 : (this.W - margin * 2 - gap * 2) / 3;
        const y = compact ? 82 : 112;
        const cards = [
            {
                title: 'Bohr 模型能解释',
                color: this._COL.cyan,
                lines: ['氢原子离散光谱', '能级差与光子能量', '13.6 eV 电离能级标尺']
            },
            {
                title: '必须加上的边界',
                color: this._COL.pink,
                lines: ['不适用于多电子原子精确计算', '电子不是沿真实圆轨道飞行', '真实图像是概率云/量子态']
            },
            {
                title: '光电效应的证据',
                color: this._COL.amber,
                lines: ['存在截止频率', 'Kmax 随频率线性增加', '光强主要改变光电流']
            }
        ];

        cards.forEach((card, i) => {
            const x = compact ? margin : margin + i * (cardW + gap);
            const cy = compact ? y + i * 126 : y;
            this._panel(x, cy, cardW, compact ? 108 : 180);
            this.ctx.fillStyle = card.color;
            this.ctx.font = `700 ${compact ? 14 : 16}px ${CF.sans}`;
            this.ctx.fillText(card.title, x + 16, cy + 28);
            this.ctx.fillStyle = this._COL.muted;
            this.ctx.font = `13px ${CF.sans}`;
            card.lines.forEach((line, idx) => {
                this.ctx.fillStyle = 'rgba(226,232,240,0.72)';
                this.ctx.fillText(`${idx + 1}. ${line}`, x + 16, cy + 58 + idx * 28);
            });
        });
        this._caption('学习重点：用模型解释现象，同时记录模型适用范围。', 24, this.H - 20);
    },

    _metric(x, y, label, value, color) {
        const ctx = this.ctx;
        ctx.fillStyle = this._COL.dim;
        ctx.font = `11px ${CF.sans}`;
        ctx.fillText(label, x, y);
        ctx.fillStyle = color;
        ctx.font = `700 13px ${CF.sans}`;
        this._wrapText(value, x + 78, y, Math.max(86, this.W - x - 96), 16, 2);
    },

    _panel(x, y, w, h) {
        const ctx = this.ctx;
        ctx.fillStyle = this._COL.panel;
        this._roundRect(x, y, w, h, 12);
        ctx.fill();
        ctx.strokeStyle = this._COL.border;
        ctx.lineWidth = 1;
        ctx.stroke();
    },

    _caption(text, x, y) {
        const ctx = this.ctx;
        ctx.fillStyle = this._COL.dim;
        ctx.font = `12px ${CF.sans}`;
        this._wrapText(text, x, y, this.W - 48, 16, 1);
    },

    _arrow(x1, y1, x2, y2, color) {
        const ctx = this.ctx;
        const a = Math.atan2(y2 - y1, x2 - x1);
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - Math.cos(a - 0.45) * 10, y2 - Math.sin(a - 0.45) * 10);
        ctx.lineTo(x2 - Math.cos(a + 0.45) * 10, y2 - Math.sin(a + 0.45) * 10);
        ctx.closePath();
        ctx.fill();
    },

    _spectralColor(lambda) {
        if (lambda < 380) return this._COL.violet;
        if (lambda < 450) return '#6366f1';
        if (lambda < 495) return '#38bdf8';
        if (lambda < 570) return '#22c55e';
        if (lambda < 590) return '#facc15';
        if (lambda < 620) return '#fb923c';
        if (lambda <= 780) return '#ef4444';
        return this._COL.pink;
    },

    _roundRect(x, y, w, h, r) {
        const ctx = this.ctx;
        const rr = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.lineTo(x + w - rr, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
        ctx.lineTo(x + w, y + h - rr);
        ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
        ctx.lineTo(x + rr, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
        ctx.lineTo(x, y + rr);
        ctx.quadraticCurveTo(x, y, x + rr, y);
        ctx.closePath();
    },

    _wrapText(text, x, y, maxWidth, lineHeight, maxLines) {
        const ctx = this.ctx;
        const chars = String(text).split('');
        let line = '';
        let lines = 0;
        for (let i = 0; i < chars.length; i++) {
            const test = line + chars[i];
            if (ctx.measureText(test).width > maxWidth && line) {
                ctx.fillText(line, x, y + lines * lineHeight);
                lines += 1;
                if (maxLines && lines >= maxLines) return;
                line = chars[i];
            } else {
                line = test;
            }
        }
        if (line && (!maxLines || lines < maxLines)) ctx.fillText(line, x, y + lines * lineHeight);
    }
};

function initAtomicPhysics() {
    AtomicPhysics.init();
}

window.AtomicPhysics = AtomicPhysics;
