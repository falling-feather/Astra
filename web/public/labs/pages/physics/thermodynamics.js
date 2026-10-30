// ===== Thermodynamics: first law, PV work, heat engines and entropy =====
// Teaching model uses the sign convention ΔU = Q - W, where W is work done by the system.

const Thermodynamics = {
    canvas: null,
    ctx: null,
    W: 0,
    H: 0,
    animId: null,
    _listeners: [],
    _ro: null,
    mode: 'firstlaw',
    processType: 'isobaric',
    heatIn: 600,
    heatOut: 150,
    workBy: 260,
    workOn: 40,
    p1: 140,
    v1: 2.0,
    ratio: 1.8,
    th: 650,
    tc: 300,
    qh: 1200,
    engineQuality: 72,
    entropyQ: 500,
    entropyHot: 650,
    entropyCold: 300,
    t: 0,

    modes: [
        { key: 'firstlaw', label: '第一定律' },
        { key: 'processes', label: 'PV 过程' },
        { key: 'engine', label: '热机效率' },
        { key: 'entropy', label: '熵增方向' }
    ],

    processDefs: [
        { key: 'isobaric', label: '等压', desc: '压强恒定，气体膨胀做功 W=PΔV。' },
        { key: 'isochoric', label: '等容', desc: '体积恒定，PV 图上没有面积，W=0。' },
        { key: 'isothermal', label: '等温', desc: '理想气体温度恒定，PV 保持常量。' },
        { key: 'adiabatic', label: '绝热', desc: '近似无热交换，膨胀做功来自内能降低。' }
    ],

    _COL: {
        bg0: '#0b1020',
        bg1: '#101827',
        panel: 'rgba(15, 23, 42, 0.74)',
        border: 'rgba(148, 163, 184, 0.24)',
        grid: 'rgba(148, 163, 184, 0.09)',
        text: '#e5edf7',
        muted: 'rgba(226, 232, 240, 0.66)',
        dim: 'rgba(226, 232, 240, 0.42)',
        heat: '#fb7185',
        work: '#60a5fa',
        energy: '#34d399',
        amber: '#fbbf24',
        violet: '#a78bfa',
        cyan: '#7dd3fc'
    },

    _on(el, evt, fn, opts) {
        if (!el) return;
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        if (this.canvas) this.destroy();
        this.canvas = document.getElementById('thermodynamics-canvas');
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
        const ctrl = document.getElementById('thermodynamics-controls');
        if (ctrl) ctrl.innerHTML = '';
        const info = document.getElementById('thermodynamics-info');
        if (info) info.innerHTML = '';
        this.canvas = null;
        this.ctx = null;
    },

    _resize() {
        if (!this.canvas || !this.canvas.parentElement) return;
        const dpr = window.devicePixelRatio || 1;
        const w = this.canvas.parentElement.getBoundingClientRect().width;
        if (!w) return;
        const h = Math.min(Math.max(w * 0.52, 350), 520);
        this.canvas.width = Math.floor(w * dpr);
        this.canvas.height = Math.floor(h * dpr);
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w;
        this.H = h;
    },

    _buildControls() {
        const ctrl = document.getElementById('thermodynamics-controls');
        if (!ctrl) return;
        ctrl.innerHTML = '';

        const modeWrap = document.createElement('div');
        modeWrap.className = 'thermo-mode-btns';
        modeWrap.setAttribute('role', 'group');
        modeWrap.setAttribute('aria-label', '选择热力学观察模式');
        this.modes.forEach(item => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'thermo-btn' + (item.key === this.mode ? ' active' : '');
            btn.dataset.mode = item.key;
            btn.setAttribute('aria-pressed', item.key === this.mode ? 'true' : 'false');
            btn.textContent = item.label;
            this._on(btn, 'click', () => {
                this.mode = item.key;
                modeWrap.querySelectorAll('.thermo-btn').forEach(el => {
                    el.classList.toggle('active', el === btn);
                    el.setAttribute('aria-pressed', el === btn ? 'true' : 'false');
                });
                this._renderModeControls();
                this._updateInfo();
            });
            modeWrap.appendChild(btn);
        });
        ctrl.appendChild(modeWrap);

        this.dynamicControls = document.createElement('div');
        this.dynamicControls.className = 'thermo-dynamic-controls';
        ctrl.appendChild(this.dynamicControls);
        this._renderModeControls();
    },

    _renderModeControls() {
        if (!this.dynamicControls) return;
        this.dynamicControls.innerHTML = '';

        if (this.mode === 'processes') {
            const processWrap = document.createElement('div');
            processWrap.className = 'thermo-process-btns';
            processWrap.setAttribute('role', 'group');
            processWrap.setAttribute('aria-label', '选择热力学过程');
            this.processDefs.forEach(item => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'thermo-mini-btn' + (item.key === this.processType ? ' active' : '');
                btn.setAttribute('aria-pressed', item.key === this.processType ? 'true' : 'false');
                btn.textContent = item.label;
                this._on(btn, 'click', () => {
                    this.processType = item.key;
                    processWrap.querySelectorAll('.thermo-mini-btn').forEach(el => {
                        el.classList.toggle('active', el === btn);
                        el.setAttribute('aria-pressed', el === btn ? 'true' : 'false');
                    });
                    this._updateInfo();
                });
                processWrap.appendChild(btn);
            });
            this.dynamicControls.appendChild(processWrap);
        }

        const sliderWrap = document.createElement('div');
        sliderWrap.className = 'thermo-sliders';
        this.sliderRefs = {};
        this._slidersForMode().forEach(spec => this._makeSlider(sliderWrap, spec));
        this.dynamicControls.appendChild(sliderWrap);
    },

    _slidersForMode() {
        if (this.mode === 'firstlaw') {
            return [
                ['heatIn', '吸热 Q入', ' J', 0, 1200, 10],
                ['heatOut', '放热 Q出', ' J', 0, 800, 10],
                ['workBy', '对外做功', ' J', 0, 900, 10],
                ['workOn', '外界做功', ' J', 0, 600, 10]
            ];
        }
        if (this.mode === 'processes') {
            return [
                ['p1', '初始压强', ' kPa', 60, 260, 5],
                ['v1', '初始体积', ' L', 0.8, 4.0, 0.1],
                ['ratio', '变化倍率', '×', 0.55, 2.4, 0.05]
            ];
        }
        if (this.mode === 'engine') {
            return [
                ['th', '热源温度', ' K', 360, 1000, 10],
                ['tc', '冷源温度', ' K', 260, 520, 10],
                ['qh', '吸收热量', ' J', 200, 2400, 20],
                ['engineQuality', '实际程度', '%', 35, 92, 1]
            ];
        }
        return [
            ['entropyQ', '传热量', ' J', 100, 1200, 10],
            ['entropyHot', '高温物体', ' K', 360, 1000, 10],
            ['entropyCold', '低温物体', ' K', 260, 520, 10]
        ];
    },

    _makeSlider(parent, [prop, label, unit, min, max, step]) {
        const row = document.createElement('label');
        row.className = 'thermo-slider';

        const caption = document.createElement('span');
        caption.textContent = label;

        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.value = String(this[prop]);

        const value = document.createElement('span');
        value.className = 'thermo-slider__value';
        value.textContent = this._format(prop, this[prop]) + unit;

        this._on(input, 'input', () => {
            this[prop] = Number(input.value);
            if ((prop === 'tc' && this.tc >= this.th - 20) || (prop === 'th' && this.th <= this.tc + 20)) {
                this.th = Math.max(this.th, this.tc + 20);
                input.value = String(this[prop]);
            }
            if ((prop === 'entropyCold' && this.entropyCold >= this.entropyHot - 20) || (prop === 'entropyHot' && this.entropyHot <= this.entropyCold + 20)) {
                this.entropyHot = Math.max(this.entropyHot, this.entropyCold + 20);
                input.value = String(this[prop]);
            }
            value.textContent = this._format(prop, this[prop]) + unit;
            this._syncSliderLabels();
            this._updateInfo();
        });

        row.append(caption, input, value);
        parent.appendChild(row);
        this.sliderRefs[prop] = { input, value, unit };
    },

    _syncSliderLabels() {
        Object.entries(this.sliderRefs || {}).forEach(([prop, ref]) => {
            ref.input.value = String(this[prop]);
            ref.value.textContent = this._format(prop, this[prop]) + ref.unit;
        });
    },

    _format(prop, value) {
        if (['v1', 'ratio'].includes(prop)) return Number(value).toFixed(2);
        if (['engineQuality'].includes(prop)) return Math.round(value);
        return Math.round(value);
    },

    _injectInfoPanel() {
        const info = document.getElementById('thermodynamics-info');
        if (!info) return;
        info.innerHTML = `
            <div class="thermo-info__hd">热力学知识点</div>
            <div class="thermo-info__grid">
                <div class="thermo-info__block">
                    <div class="thermo-info__sub">当前观察</div>
                    <div id="thermo-mode-title" class="thermo-info__val"></div>
                    <div id="thermo-mode-desc" class="thermo-info__desc"></div>
                </div>
                <div class="thermo-info__block">
                    <div class="thermo-info__sub">关键计算</div>
                    <div id="thermo-calcs"></div>
                </div>
                <div class="thermo-info__block">
                    <div class="thermo-info__sub">适用范围</div>
                    <div class="thermo-info__row"><span class="thermo-info__key" style="--c:#34d399">符号</span>本模块用 ΔU=Q-W，W 为系统对外做功。</div>
                    <div class="thermo-info__row"><span class="thermo-info__key" style="--c:#fbbf24">温标</span>热机与熵计算必须使用 Kelvin 温度。</div>
                    <div class="thermo-info__row"><span class="thermo-info__key" style="--c:#a78bfa">模型</span>Carnot 效率是可逆热机上限，真实热机低于该值。</div>
                </div>
                <div class="thermo-info__block thermo-info__block--wide">
                    <div class="thermo-info__sub">参考依据</div>
                    <div class="thermo-info__note">依据 OpenStax College Physics 2e 第 15 章整理；PV 图和热机数值为教学模型，帮助区分能量守恒与过程方向。</div>
                </div>
            </div>
        `;
        this._updateInfo();
    },

    _updateInfo() {
        const title = document.getElementById('thermo-mode-title');
        const desc = document.getElementById('thermo-mode-desc');
        const calcs = document.getElementById('thermo-calcs');
        if (!title || !desc || !calcs) return;

        const data = this._modeSummary();
        title.textContent = data.title;
        desc.textContent = data.desc;
        calcs.innerHTML = data.rows.map(row => `
            <div class="thermo-info__row"><span class="thermo-info__key" style="--c:${row.color}">${row.key}</span>${row.text}</div>
        `).join('');
    },

    _modeSummary() {
        if (this.mode === 'firstlaw') {
            const { Q, W, dU } = this._firstLaw();
            return {
                title: `ΔU = ${dU.toFixed(0)} J`,
                desc: dU >= 0 ? '系统内能增加，吸热和外界做功的贡献大于对外输出。' : '系统内能减少，对外做功和放热带走了更多能量。',
                rows: [
                    { key: 'Q', color: this._COL.heat, text: `净热量 Q = Q入 - Q出 = ${Q.toFixed(0)} J` },
                    { key: 'W', color: this._COL.work, text: `净做功 W = 对外做功 - 外界做功 = ${W.toFixed(0)} J` },
                    { key: 'ΔU', color: this._COL.energy, text: `第一定律：ΔU = Q - W = ${dU.toFixed(0)} J` }
                ]
            };
        }
        if (this.mode === 'processes') {
            const p = this._processState();
            const def = this.processDefs.find(item => item.key === this.processType);
            return {
                title: `${def.label}过程 · W≈${p.work.toFixed(0)} J`,
                desc: def.desc,
                rows: [
                    { key: '起点', color: this._COL.cyan, text: `P₁=${this.p1.toFixed(0)} kPa，V₁=${this.v1.toFixed(2)} L` },
                    { key: '终点', color: this._COL.violet, text: `P₂≈${p.p2.toFixed(0)} kPa，V₂≈${p.v2.toFixed(2)} L` },
                    { key: '面积', color: this._COL.work, text: `PV 图下方面积代表气体对外做功；1 kPa·L = 1 J。` }
                ]
            };
        }
        if (this.mode === 'engine') {
            const e = this._engineState();
            return {
                title: `η实际≈${(e.actualEff * 100).toFixed(1)}%`,
                desc: '热机每个循环吸收高温热源的热量，只能把其中一部分转化为有用功，剩余热量排向低温热源。',
                rows: [
                    { key: 'Carnot', color: this._COL.amber, text: `ηC = 1 - Tc/Th = ${(e.carnotEff * 100).toFixed(1)}%` },
                    { key: 'W', color: this._COL.work, text: `实际输出功 W≈${e.work.toFixed(0)} J，排出热量 Qc≈${e.qc.toFixed(0)} J` },
                    { key: '限制', color: this._COL.violet, text: '降低冷源温度或提高热源温度会提高理论上限，但真实装置还受耗散限制。' }
                ]
            };
        }
        const s = this._entropyState();
        return {
            title: `ΔS总≈${s.total.toFixed(3)} J/K`,
            desc: s.total > 0 ? '热量自发从高温流向低温时，两物体总熵增加，过程不可逆。' : '若温度相同，净熵变接近 0，才接近可逆热交换的极限。',
            rows: [
                { key: '热端', color: this._COL.heat, text: `ΔS热 = -Q/Th = ${s.hot.toFixed(3)} J/K` },
                { key: '冷端', color: this._COL.cyan, text: `ΔS冷 = Q/Tc = ${s.cold.toFixed(3)} J/K` },
                { key: '方向', color: this._COL.energy, text: `ΔS总 = ΔS热 + ΔS冷 = ${s.total.toFixed(3)} J/K` }
            ]
        };
    },

    _firstLaw() {
        const Q = this.heatIn - this.heatOut;
        const W = this.workBy - this.workOn;
        return { Q, W, dU: Q - W };
    },

    _processState() {
        const gamma = 1.4;
        const p1 = this.p1;
        const v1 = this.v1;
        let p2 = p1;
        let v2 = v1 * this.ratio;
        let work = 0;

        if (this.processType === 'isobaric') {
            work = p1 * (v2 - v1);
        } else if (this.processType === 'isochoric') {
            v2 = v1;
            p2 = p1 * this.ratio;
            work = 0;
        } else if (this.processType === 'isothermal') {
            p2 = p1 * v1 / v2;
            work = p1 * v1 * Math.log(v2 / v1);
        } else {
            p2 = p1 * Math.pow(v1 / v2, gamma);
            work = (p1 * v1 - p2 * v2) / (gamma - 1);
        }
        return { p1, v1, p2, v2, work };
    },

    _engineState() {
        const th = Math.max(this.th, this.tc + 20);
        const tc = Math.min(this.tc, th - 20);
        const carnotEff = Math.max(0, 1 - tc / th);
        const actualEff = Math.min(carnotEff * this.engineQuality / 100, 0.98);
        const work = this.qh * actualEff;
        const qc = this.qh - work;
        return { th, tc, carnotEff, actualEff, work, qc };
    },

    _entropyState() {
        const hotT = Math.max(this.entropyHot, this.entropyCold + 20);
        const coldT = Math.min(this.entropyCold, hotT - 20);
        const hot = -this.entropyQ / hotT;
        const cold = this.entropyQ / coldT;
        return { hotT, coldT, hot, cold, total: hot + cold };
    },

    _loop() {
        this.t += 0.012;
        this._draw();
        this.animId = requestAnimationFrame(() => this._loop());
    },

    _draw() {
        if (!this.ctx) return;
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.W, this.H);
        this._background();
        if (this.mode === 'firstlaw') this._drawFirstLaw();
        else if (this.mode === 'processes') this._drawProcesses();
        else if (this.mode === 'engine') this._drawEngine();
        else this._drawEntropy();
    },

    _background() {
        const ctx = this.ctx;
        const g = ctx.createLinearGradient(0, 0, this.W, this.H);
        g.addColorStop(0, this._COL.bg0);
        g.addColorStop(1, this._COL.bg1);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, this.W, this.H);
        ctx.strokeStyle = this._COL.grid;
        ctx.lineWidth = 1;
        for (let x = 28; x < this.W; x += 36) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, this.H);
            ctx.stroke();
        }
        for (let y = 24; y < this.H; y += 36) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(this.W, y);
            ctx.stroke();
        }
    },

    _drawFirstLaw() {
        const ctx = this.ctx;
        const { Q, W, dU } = this._firstLaw();
        const cx = this.W * 0.5;
        const cy = this.H * 0.46;
        const boxW = Math.min(260, this.W * 0.42);
        const boxH = 132;

        this._panel(cx - boxW / 2, cy - boxH / 2, boxW, boxH, '系统');
        this._meter(cx - 92, cy + 8, 184, 16, dU, 800, this._COL.energy, '内能变化');
        this._arrow(cx - boxW / 2 - 110, cy - 34, cx - boxW / 2 - 8, cy - 34, this._COL.heat, `Q入 ${this.heatIn}J`);
        this._arrow(cx + boxW / 2 + 8, cy - 34, cx + boxW / 2 + 110, cy - 34, this._COL.heat, `Q出 ${this.heatOut}J`);
        this._arrow(cx + boxW / 2 + 8, cy + 32, cx + boxW / 2 + 118, cy + 32, this._COL.work, `W出 ${this.workBy}J`);
        this._arrow(cx - boxW / 2 - 118, cy + 32, cx - boxW / 2 - 8, cy + 32, this._COL.work, `W入 ${this.workOn}J`);
        this._caption(`Q=${Q.toFixed(0)} J, W=${W.toFixed(0)} J, ΔU=${dU.toFixed(0)} J`, 24, this.H - 28);
        this._formula('ΔU = Q - W', cx, cy - 8);
    },

    _drawProcesses() {
        const ctx = this.ctx;
        const state = this._processState();
        const padL = 64;
        const padB = 54;
        const top = 42;
        const right = 32;
        const w = this.W - padL - right;
        const h = this.H - top - padB;
        const maxV = Math.max(state.v1, state.v2, 4) * 1.25;
        const maxP = Math.max(state.p1, state.p2, 260) * 1.18;
        const x = v => padL + (v / maxV) * w;
        const y = p => top + h - (p / maxP) * h;

        ctx.strokeStyle = 'rgba(226,232,240,.42)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(padL, top);
        ctx.lineTo(padL, top + h);
        ctx.lineTo(padL + w, top + h);
        ctx.stroke();
        this._text('P / kPa', padL - 42, top + 10, this._COL.muted, 12);
        this._text('V / L', padL + w - 32, top + h + 34, this._COL.muted, 12);

        const points = this._processPoints(state, 54);
        ctx.beginPath();
        points.forEach((pt, idx) => {
            const px = x(pt.v);
            const py = y(pt.p);
            if (idx === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        });
        ctx.lineTo(x(state.v2), top + h);
        ctx.lineTo(x(state.v1), top + h);
        ctx.closePath();
        ctx.fillStyle = 'rgba(96,165,250,.12)';
        ctx.fill();

        ctx.beginPath();
        points.forEach((pt, idx) => {
            const px = x(pt.v);
            const py = y(pt.p);
            if (idx === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        });
        ctx.strokeStyle = this._COL.cyan;
        ctx.lineWidth = 3;
        ctx.stroke();

        this._dot(x(state.v1), y(state.p1), this._COL.heat, '1');
        this._dot(x(state.v2), y(state.p2), this._COL.energy, '2');
        this._caption(`PV 图下方面积表示做功：W≈${state.work.toFixed(0)} J`, 24, this.H - 24);
    },

    _processPoints(state, n) {
        const pts = [];
        for (let i = 0; i <= n; i++) {
            const k = i / n;
            const v = state.v1 + (state.v2 - state.v1) * k;
            let p = state.p1;
            if (this.processType === 'isochoric') {
                p = state.p1 + (state.p2 - state.p1) * k;
                pts.push({ v: state.v1, p });
                continue;
            }
            if (this.processType === 'isothermal') p = state.p1 * state.v1 / v;
            else if (this.processType === 'adiabatic') p = state.p1 * Math.pow(state.v1 / v, 1.4);
            pts.push({ v, p });
        }
        return pts;
    },

    _drawEngine() {
        const e = this._engineState();
        const ctx = this.ctx;
        const cx = this.W * 0.5;
        const topY = 56;
        const engineY = this.H * 0.47;
        const coldY = this.H - 86;

        this._reservoir(cx - 140, topY, 280, 54, this._COL.heat, `热源 ${e.th.toFixed(0)} K`);
        this._reservoir(cx - 140, coldY, 280, 54, this._COL.cyan, `冷源 ${e.tc.toFixed(0)} K`);
        this._panel(cx - 86, engineY - 48, 172, 96, '热机');
        this._arrow(cx, topY + 62, cx, engineY - 54, this._COL.heat, `Qh ${this.qh}J`);
        this._arrow(cx, engineY + 56, cx, coldY - 8, this._COL.cyan, `Qc ${e.qc.toFixed(0)}J`);
        this._arrow(cx + 92, engineY, cx + 210, engineY, this._COL.work, `W ${e.work.toFixed(0)}J`);
        this._meter(34, this.H - 42, this.W * 0.38, 14, e.carnotEff, 1, this._COL.amber, 'Carnot 上限');
        this._meter(this.W - this.W * 0.38 - 34, this.H - 42, this.W * 0.38, 14, e.actualEff, 1, this._COL.work, '实际效率');
        this._formula('ηC = 1 - Tc / Th', cx, engineY - 4);
    },

    _drawEntropy() {
        const s = this._entropyState();
        const ctx = this.ctx;
        const hotX = this.W * 0.18;
        const coldX = this.W * 0.62;
        const y = this.H * 0.34;
        this._reservoir(hotX, y, this.W * 0.24, 72, this._COL.heat, `高温 ${s.hotT.toFixed(0)} K`);
        this._reservoir(coldX, y, this.W * 0.24, 72, this._COL.cyan, `低温 ${s.coldT.toFixed(0)} K`);
        this._arrow(hotX + this.W * 0.25, y + 36, coldX - 10, y + 36, this._COL.amber, `Q ${this.entropyQ}J`);
        this._entropyBar(hotX, y + 112, s.hot, this._COL.heat, '热端熵变');
        this._entropyBar(coldX, y + 112, s.cold, this._COL.cyan, '冷端熵变');
        this._entropyBar(this.W * 0.38, y + 190, s.total, this._COL.energy, '总熵变');
        this._caption('自发传热方向：高温 → 低温；孤立整体的熵不会减少。', 24, this.H - 24);
    },

    _panel(x, y, w, h, label) {
        const ctx = this.ctx;
        ctx.fillStyle = this._COL.panel;
        ctx.strokeStyle = this._COL.border;
        ctx.lineWidth = 1;
        this._roundRect(x, y, w, h, 12);
        ctx.fill();
        ctx.stroke();
        this._text(label, x + 18, y + 26, this._COL.text, 15, 700);
    },

    _reservoir(x, y, w, h, color, label) {
        const ctx = this.ctx;
        ctx.fillStyle = 'rgba(15,23,42,.76)';
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        this._roundRect(x, y, w, h, 12);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.16;
        this._roundRect(x + 6, y + 6, w - 12, h - 12, 9);
        ctx.fill();
        ctx.globalAlpha = 1;
        this._text(label, x + 16, y + h / 2 + 5, this._COL.text, 14, 700);
    },

    _meter(x, y, w, h, value, max, color, label) {
        const ctx = this.ctx;
        const ratio = Math.min(Math.abs(value) / max, 1);
        ctx.fillStyle = 'rgba(226,232,240,.12)';
        this._roundRect(x, y, w, h, h / 2);
        ctx.fill();
        ctx.fillStyle = color;
        this._roundRect(x, y, w * ratio, h, h / 2);
        ctx.fill();
        this._text(label, x, y - 6, this._COL.muted, 11);
    },

    _entropyBar(x, y, value, color, label) {
        const ctx = this.ctx;
        const w = Math.min(210, this.W * 0.26);
        const h = 16;
        const mid = x + w / 2;
        ctx.fillStyle = 'rgba(226,232,240,.12)';
        this._roundRect(x, y, w, h, 8);
        ctx.fill();
        const bw = Math.min(Math.abs(value) * 90, w / 2 - 4);
        ctx.fillStyle = color;
        this._roundRect(value >= 0 ? mid : mid - bw, y, bw, h, 8);
        ctx.fill();
        this._text(`${label}: ${value.toFixed(3)} J/K`, x, y - 8, this._COL.muted, 11);
    },

    _arrow(x1, y1, x2, y2, color, label) {
        const ctx = this.ctx;
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const pulse = 0.5 + 0.5 * Math.sin(this.t * 5);
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.68 + pulse * 0.2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - 12 * Math.cos(angle - 0.45), y2 - 12 * Math.sin(angle - 0.45));
        ctx.lineTo(x2 - 12 * Math.cos(angle + 0.45), y2 - 12 * Math.sin(angle + 0.45));
        ctx.closePath();
        ctx.fill();
        const lx = (x1 + x2) / 2;
        const ly = (y1 + y2) / 2 - 10;
        this._text(label, lx - ctx.measureText(label).width / 2, ly, this._COL.text, 12, 650);
    },

    _dot(x, y, color, label) {
        const ctx = this.ctx;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fill();
        this._text(label, x + 10, y - 10, this._COL.text, 12, 700);
    },

    _formula(text, x, y) {
        const ctx = this.ctx;
        ctx.font = `700 20px ${(window.CF && CF.sans) || 'system-ui, sans-serif'}`;
        ctx.fillStyle = this._COL.text;
        ctx.fillText(text, x - ctx.measureText(text).width / 2, y);
    },

    _caption(text, x, y) {
        this._text(text, x, y, this._COL.muted, 13);
    },

    _text(text, x, y, color, size = 12, weight = 500) {
        const ctx = this.ctx;
        ctx.fillStyle = color;
        ctx.font = `${weight} ${size}px ${(window.CF && CF.sans) || 'system-ui, sans-serif'}`;
        ctx.fillText(text, x, y);
    },

    _roundRect(x, y, w, h, r) {
        const ctx = this.ctx;
        const rr = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.arcTo(x + w, y, x + w, y + h, rr);
        ctx.arcTo(x + w, y + h, x, y + h, rr);
        ctx.arcTo(x, y + h, x, y, rr);
        ctx.arcTo(x, y, x + w, y, rr);
        ctx.closePath();
    }
};

function initThermodynamics() {
    Thermodynamics.init();
}

window.Thermodynamics = Thermodynamics;
window.initThermodynamics = initThermodynamics;
