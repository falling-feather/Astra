/* Enzyme Properties: activation energy, environmental factors, saturation, inhibition */
const EnzymeProperties = {
    canvas: null,
    ctx: null,
    W: 0,
    H: 0,
    animId: null,
    _listeners: [],
    _ro: null,
    mode: 'activation',
    temp: 37,
    ph: 7,
    substrate: 45,
    inhibitor: 25,
    t: 0,
    modes: [
        {
            key: 'activation',
            label: '活化能',
            desc: '酶降低达到过渡态所需的活化能，但反应物与产物的自由能差不变。'
        },
        {
            key: 'temperature',
            label: '温度曲线',
            desc: '温度升高先加快分子运动，超过适宜范围后活性部位结构可能受影响，活性下降。'
        },
        {
            key: 'ph',
            label: 'pH 曲线',
            desc: '不同酶有不同最适 pH；偏离过大时活性部位氨基酸侧链状态和空间结构会改变。'
        },
        {
            key: 'substrate',
            label: '底物浓度',
            desc: '底物浓度升高会提高速率，酶活性部位逐渐饱和后趋近最大速率。'
        },
        {
            key: 'inhibition',
            label: '抑制剂',
            desc: '竞争性抑制可被高底物浓度部分克服，非竞争性抑制会降低可达到的最大反应速率。'
        }
    ],

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        if (this.canvas) this.destroy();
        this.canvas = document.getElementById('enzyme-canvas');
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
        const ctrl = document.getElementById('enzyme-controls');
        if (ctrl) ctrl.innerHTML = '';
        this.canvas = null;
        this.ctx = null;
    },

    _resize() {
        if (!this.canvas || !this.canvas.parentElement) return;
        const dpr = window.devicePixelRatio || 1;
        const w = this.canvas.parentElement.getBoundingClientRect().width;
        const h = Math.min(Math.max(w * 0.5, 320), 460);
        this.canvas.width = Math.floor(w * dpr);
        this.canvas.height = Math.floor(h * dpr);
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w;
        this.H = h;
    },

    _buildControls() {
        const ctrl = document.getElementById('enzyme-controls');
        if (!ctrl) return;
        ctrl.innerHTML = '';

        const modeWrap = document.createElement('div');
        modeWrap.className = 'enzyme-mode-btns';
        modeWrap.setAttribute('role', 'group');
        modeWrap.setAttribute('aria-label', '酶特性观察模式');
        this.modes.forEach(item => {
            const b = document.createElement('button');
            b.className = 'enzyme-btn' + (item.key === this.mode ? ' active' : '');
            b.type = 'button';
            b.dataset.mode = item.key;
            b.setAttribute('aria-pressed', item.key === this.mode ? 'true' : 'false');
            b.textContent = item.label;
            this._on(b, 'click', () => {
                this.mode = item.key;
                modeWrap.querySelectorAll('.enzyme-btn').forEach(btn => {
                    btn.classList.toggle('active', btn === b);
                    btn.setAttribute('aria-pressed', btn === b ? 'true' : 'false');
                });
                this._updateInfo();
            });
            modeWrap.appendChild(b);
        });
        ctrl.appendChild(modeWrap);

        const sliders = document.createElement('div');
        sliders.className = 'enzyme-sliders';
        sliders.appendChild(this._makeSlider('温度', '℃', 0, 80, 1, 'temp'));
        sliders.appendChild(this._makeSlider('pH', '', 1, 13, 0.1, 'ph'));
        sliders.appendChild(this._makeSlider('底物', '%', 0, 100, 1, 'substrate'));
        sliders.appendChild(this._makeSlider('抑制剂', '%', 0, 90, 1, 'inhibitor'));
        ctrl.appendChild(sliders);
    },

    _makeSlider(labelText, unit, min, max, step, prop) {
        const label = document.createElement('label');
        label.className = 'enzyme-slider';
        const value = document.createElement('span');
        value.className = 'enzyme-slider__value';
        value.textContent = this._formatValue(this[prop], unit);
        const input = document.createElement('input');
        input.type = 'range';
        input.min = min;
        input.max = max;
        input.step = step;
        input.value = this[prop];
        this._on(input, 'input', () => {
            this[prop] = parseFloat(input.value);
            value.textContent = this._formatValue(this[prop], unit);
            this._updateInfo();
        });
        const caption = document.createElement('span');
        caption.textContent = labelText;
        label.append(caption, input, value);
        return label;
    },

    _formatValue(value, unit) {
        const rounded = Math.abs(value - Math.round(value)) < 0.01 ? Math.round(value) : value.toFixed(1);
        return rounded + unit;
    },

    _font(weight, size) {
        const family = (window.CF && CF.sans) || 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        return `${weight ? weight + ' ' : ''}${size}px ${family}`;
    },

    _drawBg() {
        const { ctx, W, H } = this;
        ctx.clearRect(0, 0, W, H);
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, 'rgba(14, 116, 144, 0.10)');
        g.addColorStop(0.55, 'rgba(20, 184, 166, 0.05)');
        g.addColorStop(1, 'rgba(251, 191, 36, 0.08)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.10)';
        ctx.lineWidth = 1;
        for (let x = 32; x < W; x += 36) {
            ctx.beginPath();
            ctx.moveTo(x, 44);
            ctx.lineTo(x, H - 38);
            ctx.stroke();
        }
        for (let y = 52; y < H - 32; y += 32) {
            ctx.beginPath();
            ctx.moveTo(36, y);
            ctx.lineTo(W - 28, y);
            ctx.stroke();
        }
    },

    _drawTitle(title, subtitle) {
        const { ctx, W } = this;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = 'rgba(226, 232, 240, 0.94)';
        this._fitText(title, W / 2, 30, W - 36, Math.max(18, W * 0.026), '700');
        ctx.fillStyle = 'rgba(148, 163, 184, 0.78)';
        this._fitText(subtitle, W / 2, 52, W - 44, Math.max(12, W * 0.013), '');
    },

    _fitText(text, x, y, maxWidth, size, weight) {
        const { ctx } = this;
        let fs = size;
        do {
            ctx.font = this._font(weight, fs);
            if (ctx.measureText(text).width <= maxWidth || fs <= 10) break;
            fs -= 1;
        } while (fs > 10);
        ctx.fillText(text, x, y);
    },

    _drawAxes(x, y, w, h, xLabel, yLabel) {
        const { ctx } = this;
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.32)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + h);
        ctx.lineTo(x + w, y + h);
        ctx.stroke();
        ctx.font = this._font('', 12);
        ctx.fillStyle = 'rgba(203, 213, 225, 0.75)';
        ctx.textAlign = 'center';
        ctx.fillText(xLabel, x + w / 2, y + h + 28);
        ctx.save();
        ctx.translate(x - 26, y + h / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(yLabel, 0, 0);
        ctx.restore();
    },

    _pointOnPlot(x, y, w, h, px, py) {
        return { x: x + px * w, y: y + h - py * h };
    },

    _drawCurve(x, y, w, h, samples, color, width) {
        const { ctx } = this;
        ctx.beginPath();
        samples.forEach((p, i) => {
            const pt = this._pointOnPlot(x, y, w, h, p[0], Math.max(0, Math.min(1, p[1])));
            if (i === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = width || 3;
        ctx.stroke();
    },

    _bell(value, optimum, spread) {
        return Math.exp(-Math.pow((value - optimum) / spread, 2));
    },

    _drawActivation() {
        const { ctx, W, H } = this;
        this._drawTitle('酶促反应降低活化能', '催化路径更低；反应物与产物的能量差保持不变');
        const x = W * 0.12, y = H * 0.18, w = W * 0.76, h = H * 0.62;
        this._drawAxes(x, y, w, h, '反应进程', '自由能');

        const uncatalyzed = [];
        const catalyzed = [];
        for (let i = 0; i <= 90; i++) {
            const p = i / 90;
            const base = 0.68 - 0.28 * p;
            uncatalyzed.push([p, base + 0.42 * Math.exp(-Math.pow((p - 0.46) / 0.16, 2))]);
            catalyzed.push([p, base + 0.20 * Math.exp(-Math.pow((p - 0.48) / 0.20, 2))]);
        }
        this._drawCurve(x, y, w, h, uncatalyzed, 'rgba(248, 113, 113, 0.82)', 3);
        this._drawCurve(x, y, w, h, catalyzed, 'rgba(45, 212, 191, 0.95)', 4);

        const reactant = this._pointOnPlot(x, y, w, h, 0.04, 0.68);
        const product = this._pointOnPlot(x, y, w, h, 0.94, 0.40);
        ctx.fillStyle = 'rgba(226, 232, 240, 0.9)';
        ctx.font = this._font('600', 13);
        ctx.textAlign = 'left';
        ctx.fillText('反应物', reactant.x - 4, reactant.y - 12);
        ctx.fillText('产物', product.x - 4, product.y + 22);
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)';
        ctx.beginPath();
        ctx.moveTo(reactant.x, reactant.y);
        ctx.lineTo(product.x, product.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(251, 191, 36, 0.9)';
        ctx.textAlign = 'center';
        ctx.fillText('ΔG 不因酶而改变', x + w * 0.55, y + h * 0.75);

        ctx.fillStyle = 'rgba(248, 113, 113, 0.85)';
        ctx.fillText('无酶：活化能高', x + w * 0.44, y + h * 0.08);
        ctx.fillStyle = 'rgba(45, 212, 191, 0.95)';
        ctx.fillText('有酶：活化能降低', x + w * 0.60, y + h * 0.27);
    },

    _drawTemperature() {
        const { ctx, W, H } = this;
        this._drawTitle('温度影响酶活性', '低温反应慢；过高温度会破坏蛋白质空间结构');
        const x = W * 0.12, y = H * 0.18, w = W * 0.76, h = H * 0.62;
        this._drawAxes(x, y, w, h, '温度 / ℃', '相对反应速率');
        const samples = [];
        for (let i = 0; i <= 120; i++) {
            const temp = i / 120 * 80;
            const rise = 1 / (1 + Math.exp(-(temp - 18) / 7));
            const denature = 1 / (1 + Math.exp((temp - 48) / 5));
            samples.push([i / 120, rise * denature]);
        }
        this._drawCurve(x, y, w, h, samples, 'rgba(45, 212, 191, 0.95)', 4);
        const tx = Math.max(0, Math.min(1, this.temp / 80));
        const activity = Math.max(0, Math.min(1, (1 / (1 + Math.exp(-(this.temp - 18) / 7))) * (1 / (1 + Math.exp((this.temp - 48) / 5)))));
        this._drawMarker(x, y, w, h, tx, activity, `${Math.round(this.temp)}℃`);
        this._drawRangeLabel(x + w * 0.36, y + h * 0.14, '适宜范围附近活性较高', '#2dd4bf');
        this._drawRangeLabel(x + w * 0.78, y + h * 0.40, '高温：可能变性', '#f87171');
    },

    _drawPh() {
        const { ctx, W, H } = this;
        this._drawTitle('pH 改变活性部位状态', '示例为近中性酶；胃蛋白酶等最适 pH 会不同');
        const x = W * 0.12, y = H * 0.18, w = W * 0.76, h = H * 0.62;
        this._drawAxes(x, y, w, h, 'pH', '相对反应速率');
        const samples = [];
        for (let i = 0; i <= 120; i++) {
            const ph = 1 + i / 120 * 12;
            samples.push([i / 120, this._bell(ph, 7, 2.1)]);
        }
        this._drawCurve(x, y, w, h, samples, 'rgba(96, 165, 250, 0.95)', 4);
        const px = (this.ph - 1) / 12;
        const activity = this._bell(this.ph, 7, 2.1);
        this._drawMarker(x, y, w, h, px, activity, `pH ${this.ph.toFixed(1)}`);
        this._drawRangeLabel(x + w * 0.50, y + h * 0.16, '最适 pH 附近', '#60a5fa');
        this._drawRangeLabel(x + w * 0.18, y + h * 0.45, '过酸会降低活性', '#f59e0b');
        this._drawRangeLabel(x + w * 0.82, y + h * 0.45, '过碱也会降低活性', '#f59e0b');
    },

    _drawSubstrate() {
        const { ctx, W, H } = this;
        this._drawTitle('底物浓度与饱和趋势', '底物足够多时，酶活性部位接近饱和，速率趋近 Vmax');
        const x = W * 0.12, y = H * 0.18, w = W * 0.76, h = H * 0.62;
        this._drawAxes(x, y, w, h, '底物浓度', '反应速率');
        const samples = [];
        for (let i = 0; i <= 120; i++) {
            const s = i / 120 * 100;
            samples.push([i / 120, s / (28 + s)]);
        }
        this._drawCurve(x, y, w, h, samples, 'rgba(34, 197, 94, 0.95)', 4);
        const s = this.substrate;
        const rate = s / (28 + s);
        this._drawMarker(x, y, w, h, s / 100, rate, `${Math.round(s)}%`);
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.46)';
        const vmax = this._pointOnPlot(x, y, w, h, 0, 0.92).y;
        ctx.beginPath();
        ctx.moveTo(x, vmax);
        ctx.lineTo(x + w, vmax);
        ctx.stroke();
        ctx.setLineDash([]);
        this._drawRangeLabel(x + w * 0.80, vmax - 8, 'Vmax 附近', '#fbbf24');
    },

    _drawInhibition() {
        const { ctx, W, H } = this;
        this._drawTitle('抑制剂改变反应速率曲线', '教学模型：竞争性影响结合，非竞争性降低最大速率');
        const x = W * 0.12, y = H * 0.18, w = W * 0.76, h = H * 0.62;
        this._drawAxes(x, y, w, h, '底物浓度', '反应速率');
        const control = [];
        const competitive = [];
        const nonCompetitive = [];
        const kFactor = 1 + this.inhibitor / 45;
        const vmaxFactor = 1 - this.inhibitor / 140;
        for (let i = 0; i <= 120; i++) {
            const s = i / 120 * 100;
            control.push([i / 120, s / (25 + s)]);
            competitive.push([i / 120, s / (25 * kFactor + s)]);
            nonCompetitive.push([i / 120, vmaxFactor * s / (25 + s)]);
        }
        this._drawCurve(x, y, w, h, control, 'rgba(148, 163, 184, 0.72)', 2.4);
        this._drawCurve(x, y, w, h, competitive, 'rgba(251, 191, 36, 0.94)', 3.5);
        this._drawCurve(x, y, w, h, nonCompetitive, 'rgba(248, 113, 113, 0.94)', 3.5);
        ctx.font = this._font('600', 12);
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
        ctx.fillText('无抑制', x + w * 0.62, y + h * 0.16);
        ctx.fillStyle = 'rgba(251, 191, 36, 0.94)';
        ctx.fillText('竞争性', x + w * 0.62, y + h * 0.28);
        ctx.fillStyle = 'rgba(248, 113, 113, 0.94)';
        ctx.fillText('非竞争性', x + w * 0.62, y + h * 0.40);
        this._drawRangeLabel(x + w * 0.30, y + h * 0.66, `抑制剂 ${Math.round(this.inhibitor)}%`, '#fbbf24');
    },

    _drawMarker(x, y, w, h, px, py, label) {
        const { ctx } = this;
        const p = this._pointOnPlot(x, y, w, h, px, py);
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.38)';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x, y + h);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7 + Math.sin(this.t * 2.5) * 1.2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(251, 191, 36, 0.92)';
        ctx.fill();
        ctx.font = this._font('600', 12);
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(254, 243, 199, 0.96)';
        ctx.fillText(label, p.x, p.y - 14);
    },

    _drawRangeLabel(x, y, text, color) {
        const { ctx } = this;
        ctx.textAlign = 'center';
        ctx.fillStyle = color;
        this._fitText(text, x, y, Math.max(90, this.W * 0.24), 12, '600');
    },

    _injectInfoPanel() {
        const el = document.getElementById('enzyme-info');
        if (!el) return;
        el.innerHTML = `
            <div class="enzyme-info__hd">酶的特性知识点</div>
            <div class="enzyme-info__grid">
                <div class="enzyme-info__block">
                    <div class="enzyme-info__sub">当前观察</div>
                    <div id="enzyme-mode-title" class="enzyme-info__val"></div>
                    <div id="enzyme-mode-desc" class="enzyme-info__desc"></div>
                </div>
                <div class="enzyme-info__block">
                    <div class="enzyme-info__sub">关键判断</div>
                    <div class="enzyme-info__row"><span class="enzyme-info__key" style="--c:#2dd4bf">催化</span>降低到达过渡态所需活化能，加快反应速率。</div>
                    <div class="enzyme-info__row"><span class="enzyme-info__key" style="--c:#fbbf24">不改变</span>不改变 ΔG、反应平衡位置或反应是否自发。</div>
                    <div class="enzyme-info__row"><span class="enzyme-info__key" style="--c:#60a5fa">专一性</span>活性部位与底物短暂结合，诱导契合模型比固定“锁钥”更贴近动态过程。</div>
                </div>
                <div class="enzyme-info__block">
                    <div class="enzyme-info__sub">曲线边界</div>
                    <div class="enzyme-info__note">温度、pH、底物浓度和抑制剂曲线是趋势模型。页面默认采用近中性、常温附近酶的教学模型，不代表所有酶的最适条件或真实动力学参数。</div>
                </div>
            </div>
            <div class="enzyme-info__source">参考 OpenStax Biology 2e 6.5 Enzymes：酶通过降低活化能催化反应，不改变反应的自由能变化；活性部位、诱导契合、温度、pH、竞争性与非竞争性抑制均据该章整理。</div>
        `;
        this._updateInfo();
    },

    _updateInfo() {
        const mode = this.modes.find(item => item.key === this.mode) || this.modes[0];
        const title = document.getElementById('enzyme-mode-title');
        const desc = document.getElementById('enzyme-mode-desc');
        if (title) title.textContent = mode.label;
        if (desc) desc.textContent = mode.desc;
    },

    _draw() {
        if (!this.ctx) return;
        this._drawBg();
        if (this.mode === 'activation') this._drawActivation();
        else if (this.mode === 'temperature') this._drawTemperature();
        else if (this.mode === 'ph') this._drawPh();
        else if (this.mode === 'substrate') this._drawSubstrate();
        else this._drawInhibition();
    },

    _loop() {
        this.t = performance.now() / 1000;
        this._draw();
        this.animId = requestAnimationFrame(() => this._loop());
    }
};

function initEnzymeProperties() {
    EnzymeProperties.init();
}

window.EnzymeProperties = EnzymeProperties;
