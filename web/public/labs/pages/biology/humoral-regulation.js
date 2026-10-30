/* Humoral Regulation: hypothalamus-pituitary-thyroid axis teaching model */
const HumoralRegulation = {
    canvas: null,
    ctx: null,
    W: 0,
    H: 0,
    animId: null,
    _listeners: [],
    _ro: null,
    mode: 'axis',
    cold: 35,
    iodine: 80,
    sensitivity: 75,
    speed: 1,
    setPoint: 58,
    trh: 46,
    tsh: 48,
    thyroid: 56,
    metabolism: 58,
    t: 0,
    modes: [
        {
            key: 'axis',
            label: 'HPT 轴',
            desc: '下丘脑通过 TRH 指令垂体前叶，垂体前叶以 TSH 刺激甲状腺滤泡细胞合成并释放 T3/T4。'
        },
        {
            key: 'feedback',
            label: '负反馈',
            desc: '血液中 T3/T4 偏高时会抑制 TRH 与 TSH 释放；偏低时抑制减弱，上游驱动随之增强。'
        },
        {
            key: 'cold',
            label: '寒冷刺激',
            desc: '寒冷会提高维持体温的需求，本模型用神经-内分泌整合后的 TRH/TSH 驱动变化表示产热调节。'
        },
        {
            key: 'iodine',
            label: '碘供应',
            desc: '碘是合成 T3/T4 的必要原料，T3 含 3 个碘原子，T4 含 4 个碘原子；供应不足会限制输出。'
        }
    ],

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        if (this.canvas) this.destroy();
        this.canvas = document.getElementById('humoral-canvas');
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
        this._resetState();
        this._loop();
    },

    destroy() {
        if (this.animId) cancelAnimationFrame(this.animId);
        this.animId = null;
        this._listeners.forEach(l => l.el.removeEventListener(l.evt, l.fn, l.opts));
        this._listeners.length = 0;
        if (this._ro) this._ro.disconnect();
        this._ro = null;
        const ctrl = document.getElementById('humoral-controls');
        if (ctrl) ctrl.innerHTML = '';
        this.canvas = null;
        this.ctx = null;
    },

    _resize() {
        if (!this.canvas || !this.canvas.parentElement || !this.ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const w = this.canvas.parentElement.getBoundingClientRect().width;
        const h = Math.min(Math.max(w * 0.52, 340), 500);
        this.canvas.width = Math.floor(w * dpr);
        this.canvas.height = Math.floor(h * dpr);
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w;
        this.H = h;
        this._draw();
    },

    _buildControls() {
        const ctrl = document.getElementById('humoral-controls');
        if (!ctrl) return;
        ctrl.innerHTML = '';

        const modes = document.createElement('div');
        modes.className = 'humoral-mode-btns';
        modes.setAttribute('role', 'group');
        modes.setAttribute('aria-label', '体液调节观察模式');
        this.modes.forEach(item => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'humoral-btn' + (item.key === this.mode ? ' active' : '');
            btn.dataset.mode = item.key;
            btn.textContent = item.label;
            btn.setAttribute('aria-pressed', item.key === this.mode ? 'true' : 'false');
            this._on(btn, 'click', () => {
                this.mode = item.key;
                modes.querySelectorAll('.humoral-btn').forEach(b => {
                    b.classList.toggle('active', b === btn);
                    b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
                });
                this._updateInfo();
            });
            modes.appendChild(btn);
        });
        ctrl.appendChild(modes);

        const sliders = document.createElement('div');
        sliders.className = 'humoral-sliders';
        sliders.appendChild(this._makeSlider('寒冷刺激', '%', 0, 100, 5, 'cold'));
        sliders.appendChild(this._makeSlider('碘供应', '%', 5, 100, 5, 'iodine'));
        sliders.appendChild(this._makeSlider('甲状腺敏感性', '%', 20, 120, 5, 'sensitivity'));
        sliders.appendChild(this._makeSlider('速度', 'x', 0.4, 2.5, 0.1, 'speed'));
        ctrl.appendChild(sliders);
    },

    _makeSlider(labelText, unit, min, max, step, prop) {
        const label = document.createElement('label');
        label.className = 'humoral-slider';
        const caption = document.createElement('span');
        caption.textContent = labelText;
        const input = document.createElement('input');
        input.type = 'range';
        input.min = min;
        input.max = max;
        input.step = step;
        input.value = this[prop];
        const value = document.createElement('span');
        value.className = 'humoral-slider__value';
        value.textContent = this._formatValue(this[prop], unit);
        this._on(input, 'input', () => {
            this[prop] = parseFloat(input.value);
            value.textContent = this._formatValue(this[prop], unit);
            this._updateInfo();
        });
        label.append(caption, input, value);
        return label;
    },

    _formatValue(value, unit) {
        const rounded = Math.abs(value - Math.round(value)) < 0.01 ? Math.round(value) : value.toFixed(1);
        return unit === 'x' ? rounded + unit : rounded + unit;
    },

    _resetState() {
        this.trh = 46;
        this.tsh = 48;
        this.thyroid = 56;
        this.metabolism = 58;
    },

    _clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    },

    _font(weight, size) {
        const family = (window.CF && CF.sans) || 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        return `${weight ? weight + ' ' : ''}${size}px ${family}`;
    },

    _fitText(text, x, y, maxWidth, maxSize, minSize, weight, align = 'center') {
        const { ctx } = this;
        let size = maxSize;
        ctx.textAlign = align;
        while (size > minSize) {
            ctx.font = this._font(weight, size);
            if (ctx.measureText(text).width <= maxWidth) break;
            size -= 1;
        }
        ctx.fillText(text, x, y);
    },

    _step() {
        const coldDrive = this.cold / 100;
        const iodineFactor = this.iodine / 100;
        const glandFactor = this.sensitivity / 100;
        const deficit = Math.max(0, this.setPoint - this.thyroid);
        const excess = Math.max(0, this.thyroid - this.setPoint);
        const targetTRH = this._clamp(32 + coldDrive * 34 + deficit * 0.85 - excess * 0.72, 8, 96);
        const targetTSH = this._clamp(16 + this.trh * 0.74 - this.thyroid * 0.22, 6, 98);
        const synthesisCeiling = this._clamp(16 + iodineFactor * 84, 12, 100);
        const targetThyroid = this._clamp((this.tsh * 0.74 + 18) * iodineFactor * (0.38 + glandFactor * 0.78), 5, synthesisCeiling);
        const targetMetabolism = this._clamp(24 + this.thyroid * 0.68 + coldDrive * 8, 20, 100);
        const k = 0.018 * this.speed;
        this.trh += (targetTRH - this.trh) * k;
        this.tsh += (targetTSH - this.tsh) * k;
        this.thyroid += (targetThyroid - this.thyroid) * k;
        this.metabolism += (targetMetabolism - this.metabolism) * k;
    },

    _drawBg() {
        const { ctx, W, H } = this;
        ctx.clearRect(0, 0, W, H);
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, 'rgba(13, 148, 136, 0.13)');
        g.addColorStop(0.54, 'rgba(59, 130, 246, 0.055)');
        g.addColorStop(1, 'rgba(251, 191, 36, 0.075)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.10)';
        ctx.lineWidth = 1;
        for (let x = 34; x < W; x += 42) {
            ctx.beginPath();
            ctx.moveTo(x, 54);
            ctx.lineTo(x, H - 34);
            ctx.stroke();
        }
        for (let y = 58; y < H - 28; y += 38) {
            ctx.beginPath();
            ctx.moveTo(34, y);
            ctx.lineTo(W - 34, y);
            ctx.stroke();
        }
    },

    _drawTitle(title, subtitle) {
        const { ctx, W } = this;
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = 'rgba(226, 232, 240, 0.95)';
        this._fitText(title, W / 2, 30, W - 36, Math.max(18, W * 0.025), 16, '700');
        ctx.fillStyle = 'rgba(148, 163, 184, 0.82)';
        this._fitText(subtitle, W / 2, 53, W - 44, Math.max(12, W * 0.013), 10, '');
    },

    _roundRect(x, y, w, h, r) {
        const { ctx } = this;
        if (![x, y, w, h, r].every(Number.isFinite) || w === 0 || h === 0) {
            ctx.beginPath();
            return;
        }
        if (w < 0) {
            x += w;
            w = Math.abs(w);
        }
        if (h < 0) {
            y += h;
            h = Math.abs(h);
        }
        r = Math.max(0, Math.min(Math.abs(r), w / 2, h / 2));
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

    _wrapText(text, x, y, maxWidth, lineHeight, maxLines) {
        const { ctx } = this;
        let line = '';
        let lines = 0;
        for (const char of String(text)) {
            const test = line + char;
            if (ctx.measureText(test).width > maxWidth && line) {
                ctx.fillText(line, x, y + lines * lineHeight);
                line = char;
                lines++;
                if (maxLines && lines >= maxLines) return;
            } else {
                line = test;
            }
        }
        if (line && (!maxLines || lines < maxLines)) ctx.fillText(line, x, y + lines * lineHeight);
    },

    _arrow(x1, y1, x2, y2, color, dashed) {
        const { ctx } = this;
        const angle = Math.atan2(y2 - y1, x2 - x1);
        ctx.save();
        ctx.strokeStyle = color || 'rgba(45, 212, 191, 0.72)';
        ctx.fillStyle = color || 'rgba(45, 212, 191, 0.72)';
        ctx.lineWidth = 2.4;
        if (dashed) ctx.setLineDash([7, 6]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - 10 * Math.cos(angle - 0.45), y2 - 10 * Math.sin(angle - 0.45));
        ctx.lineTo(x2 - 10 * Math.cos(angle + 0.45), y2 - 10 * Math.sin(angle + 0.45));
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    },

    _curveArrow(x1, y1, cx, cy, x2, y2, color) {
        const { ctx } = this;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 2.2;
        ctx.setLineDash([7, 6]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(cx, cy, x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
        const angle = Math.atan2(y2 - cy, x2 - cx);
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - 10 * Math.cos(angle - 0.48), y2 - 10 * Math.sin(angle - 0.48));
        ctx.lineTo(x2 - 10 * Math.cos(angle + 0.48), y2 - 10 * Math.sin(angle + 0.48));
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    },

    _node(x, y, r, title, hormone, value, color) {
        const { ctx } = this;
        ctx.save();
        const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, 2, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,.90)');
        g.addColorStop(0.25, color);
        g.addColorStop(1, 'rgba(15,23,42,.82)');
        ctx.fillStyle = g;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(226,232,240,.94)';
        this._fitText(title, x, y - 7, r * 1.45, 13, 11, '700');
        ctx.fillStyle = 'rgba(226,232,240,.72)';
        this._fitText(hormone, x, y + 12, r * 1.55, 12, 10, '');
        this._miniBar(x - r * 0.56, y + r + 12, r * 1.12, 7, value, color);
        ctx.restore();
    },

    _miniBar(x, y, w, h, value, color) {
        const { ctx } = this;
        const p = this._clamp(value / 100, 0, 1);
        ctx.fillStyle = 'rgba(15,23,42,.72)';
        this._roundRect(x, y, w, h, h / 2);
        ctx.fill();
        ctx.fillStyle = color;
        this._roundRect(x, y, w * p, h, h / 2);
        ctx.fill();
    },

    _metric(x, y, w, label, value, color) {
        const { ctx } = this;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
        this._roundRect(x, y, w, 58, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(148, 163, 184, 0.82)';
        this._fitText(label, x + 12, y + 20, w - 24, 12, 10, '', 'left');
        ctx.fillStyle = color;
        this._fitText(value, x + 12, y + 44, w - 24, 18, 13, '700', 'left');
    },

    _drawAxisNodes(yOffset) {
        const { W, H } = this;
        const compact = W < 520;
        const y = yOffset || H * 0.43;
        const r = compact ? Math.min(Math.max(W * 0.075, 22), 30) : Math.min(Math.max(W * 0.046, 36), 52);
        const xs = compact ? [W * 0.14, W * 0.38, W * 0.62, W * 0.86] : [W * 0.15, W * 0.38, W * 0.61, W * 0.84];
        this._arrow(xs[0] + r + 8, y, xs[1] - r - 8, y, 'rgba(45, 212, 191, 0.80)');
        this._arrow(xs[1] + r + 8, y, xs[2] - r - 8, y, 'rgba(45, 212, 191, 0.80)');
        this._arrow(xs[2] + r + 8, y, xs[3] - r - 8, y, 'rgba(45, 212, 191, 0.80)');
        this._node(xs[0], y, r, '下丘脑', 'TRH', this.trh, 'rgba(96,165,250,.92)');
        this._node(xs[1], y, r, '垂体前叶', 'TSH', this.tsh, 'rgba(129,140,248,.92)');
        this._node(xs[2], y, r, '甲状腺', 'T3 / T4', this.thyroid, 'rgba(45,212,191,.92)');
        this._node(xs[3], y, r, '靶组织', '代谢产热', this.metabolism, 'rgba(251,191,36,.90)');
        if (!compact) {
            this._curveArrow(xs[2], y - r - 18, W * 0.44, y - r - 96, xs[0], y - r - 18, 'rgba(248,113,113,.78)');
            this._curveArrow(xs[2] - 10, y - r - 6, W * 0.52, y - r - 70, xs[1], y - r - 10, 'rgba(248,113,113,.66)');
            const ctx = this.ctx;
            ctx.fillStyle = 'rgba(248,113,113,.86)';
            this._fitText('T3/T4 升高后抑制 TRH / TSH', W * 0.44, y - r - 74, W * 0.48, 12, 10, '600');
        }
    },

    _drawAxis() {
        const { W, H } = this;
        this._drawTitle('下丘脑-垂体-甲状腺轴', 'TRH → TSH → T3/T4；甲状腺激素通过负反馈限制上游释放');
        this._drawAxisNodes(H * 0.43);
        const mW = Math.min(170, W * 0.19);
        const startX = W * 0.10;
        const y = H * 0.76;
        this._metric(startX, y, mW, 'TRH 驱动', this.trh.toFixed(0) + '%', 'rgba(96,165,250,.95)');
        this._metric(startX + mW + 12, y, mW, 'TSH 驱动', this.tsh.toFixed(0) + '%', 'rgba(129,140,248,.95)');
        this._metric(startX + (mW + 12) * 2, y, mW, 'T3/T4', this.thyroid.toFixed(0) + '%', 'rgba(45,212,191,.95)');
        this._metric(startX + (mW + 12) * 3, y, mW, '代谢产热', this.metabolism.toFixed(0) + '%', 'rgba(251,191,36,.95)');
    },

    _drawFeedback() {
        const { ctx, W, H } = this;
        this._drawTitle('甲状腺激素的负反馈', '变量升高时，上游信号被压低；变量偏低时，上游信号增强');
        this._drawAxisNodes(H * 0.39);
        if (W < 520) {
            const status = this.thyroid > this.setPoint + 6 ? '当前：反馈抑制增强' : this.thyroid < this.setPoint - 6 ? '当前：上游驱动增强' : '当前：接近设定范围';
            ctx.fillStyle = 'rgba(226,232,240,.92)';
            this._fitText(status, W / 2, H * 0.67, W - 36, 16, 12, '700');
            this._textCard(W * 0.08, H * 0.72, W * 0.84, 88, '反馈方向', 'T3/T4 偏低时 TRH/TSH 驱动增强；偏高时 TRH/TSH 释放下降。', 'rgba(248,113,113,.82)');
            return;
        }
        const left = W * 0.11;
        const top = H * 0.70;
        const cardW = W * 0.36;
        this._textCard(left, top, cardW, 94, 'T3/T4 偏低', '下丘脑 TRH 与垂体前叶 TSH 驱动增强，促使甲状腺提高分泌。', 'rgba(96,165,250,.85)');
        this._textCard(W - left - cardW, top, cardW, 94, 'T3/T4 偏高', '负反馈使 TRH/TSH 释放下降，甲状腺刺激减弱，激素水平回落。', 'rgba(248,113,113,.85)');
        ctx.textAlign = 'center';
        ctx.font = this._font('700', 18);
        ctx.fillStyle = 'rgba(226,232,240,.92)';
        ctx.fillText(this.thyroid > this.setPoint + 6 ? '当前：反馈抑制增强' : this.thyroid < this.setPoint - 6 ? '当前：上游驱动增强' : '当前：接近设定范围', W / 2, top + 34);
        ctx.font = this._font('', 12);
        ctx.fillStyle = 'rgba(148,163,184,.78)';
        ctx.fillText('教学模型会把 T3/T4 与 TRH/TSH 的方向关系简化为连续变量。', W / 2, top + 58);
    },

    _drawCold() {
        const { ctx, W, H } = this;
        this._drawTitle('寒冷刺激与代谢产热', '寒冷提高产热需求，HPT 轴可参与基础代谢与产热调节');
        if (W < 520) {
            this._textCard(W * 0.08, 72, W * 0.84, 94, '寒冷刺激 ' + this.cold.toFixed(0) + '%', '神经-内分泌整合提高产热需求；T3/T4 可提高基础代谢与耗氧。', 'rgba(96,165,250,.85)');
            this._drawAxisNodes(H * 0.70);
            return;
        }
        const coldP = this.cold / 100;
        const x = W * 0.10;
        const y = H * 0.25;
        ctx.strokeStyle = 'rgba(96,165,250,.85)';
        ctx.lineWidth = 8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x + 24, y + 22);
        ctx.lineTo(x + 24, y + 146);
        ctx.stroke();
        ctx.fillStyle = 'rgba(15,23,42,.7)';
        ctx.beginPath();
        ctx.arc(x + 24, y + 168, 24, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(96,165,250,.92)';
        ctx.fillRect(x + 18, y + 146 - coldP * 118, 12, coldP * 118 + 22);
        ctx.beginPath();
        ctx.arc(x + 24, y + 168, 16 + coldP * 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = this._font('700', 14);
        ctx.fillStyle = 'rgba(226,232,240,.92)';
        ctx.textAlign = 'left';
        ctx.fillText('寒冷刺激 ' + this.cold.toFixed(0) + '%', x + 60, y + 60);
        ctx.font = this._font('', 12);
        ctx.fillStyle = 'rgba(148,163,184,.78)';
        this._wrapText('寒冷不是直接生成甲状腺激素；这里用神经-内分泌整合后的产热需求表示趋势。', x + 60, y + 84, W * 0.28, 17, 3);
        this._drawAxisNodes(H * 0.49);
        this._textCard(W * 0.62, H * 0.72, W * 0.28, 80, '产热结果', 'T3/T4 提高基础代谢率，细胞耗氧和 ATP 周转增加，同时释放更多热量。', 'rgba(251,191,36,.90)');
    },

    _drawIodine() {
        const { ctx, W, H } = this;
        this._drawTitle('碘供应限制 T3/T4 合成', 'T3/T4 合成需要碘；TSH 促进甲状腺摄取碘并释放激素');
        if (W < 520) {
            const cx = W * 0.50;
            const cy = H * 0.42;
            const r = Math.min(W, H) * 0.14;
            ctx.strokeStyle = 'rgba(45,212,191,.34)';
            ctx.lineWidth = 2;
            ctx.fillStyle = 'rgba(15,23,42,.55)';
            ctx.beginPath();
            ctx.ellipse(cx, cy, r * 1.45, r * 1.05, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            for (let i = 0; i < 16; i++) {
                const a = i * 2.399 + this.t * 0.2;
                const px = cx + Math.cos(a) * r * (0.15 + (i % 4) * 0.20);
                const py = cy + Math.sin(a) * r * (0.12 + (i % 3) * 0.20);
                ctx.fillStyle = i / 16 < this.iodine / 100 ? 'rgba(251,191,36,.86)' : 'rgba(148,163,184,.20)';
                ctx.beginPath();
                ctx.arc(px, py, 3.6, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.fillStyle = 'rgba(226,232,240,.94)';
            this._fitText('甲状腺滤泡模型', cx, cy - r - 16, W * 0.74, 15, 12, '700');
            const metricY = H * 0.58;
            this._metric(W * 0.06, metricY, W * 0.27, '碘供应', this.iodine.toFixed(0) + '%', 'rgba(251,191,36,.95)');
            this._metric(W * 0.365, metricY, W * 0.27, 'TSH 驱动', this.tsh.toFixed(0) + '%', 'rgba(129,140,248,.95)');
            this._metric(W * 0.67, metricY, W * 0.27, 'T3/T4', this.thyroid.toFixed(0) + '%', 'rgba(45,212,191,.95)');
            this._textCard(W * 0.08, H * 0.78, W * 0.84, 74, this.iodine < 35 ? '当前：碘供应不足' : '当前：原料较充足', this.iodine < 35 ? 'TSH 升高也会受原料限制，长期缺碘可能导致甲状腺肿。' : 'TSH 促进滤泡细胞摄取碘并释放 T3/T4。', this.iodine < 35 ? 'rgba(248,113,113,.85)' : 'rgba(45,212,191,.85)');
            return;
        }
        const cx = W * 0.33;
        const cy = H * 0.47;
        const r = Math.min(W, H) * 0.20;
        ctx.strokeStyle = 'rgba(45,212,191,.32)';
        ctx.lineWidth = 2;
        ctx.fillStyle = 'rgba(15,23,42,.55)';
        ctx.beginPath();
        ctx.ellipse(cx, cy, r * 0.92, r * 1.06, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(cx - r * 0.72, cy, r * 0.38, r * 0.78, -0.16, 0, Math.PI * 2);
        ctx.ellipse(cx + r * 0.72, cy, r * 0.38, r * 0.78, 0.16, 0, Math.PI * 2);
        ctx.stroke();
        for (let i = 0; i < 18; i++) {
            const a = i * 2.399 + this.t * 0.2;
            const px = cx + Math.cos(a) * r * (0.15 + (i % 5) * 0.13);
            const py = cy + Math.sin(a) * r * (0.15 + (i % 4) * 0.16);
            ctx.fillStyle = i / 18 < this.iodine / 100 ? 'rgba(251,191,36,.86)' : 'rgba(148,163,184,.20)';
            ctx.beginPath();
            ctx.arc(px, py, 4, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.textAlign = 'center';
        ctx.font = this._font('700', 16);
        ctx.fillStyle = 'rgba(226,232,240,.94)';
        ctx.fillText('甲状腺滤泡教学模型', cx, cy - r - 20);
        this._arrow(W * 0.12, H * 0.47, cx - r * 0.95, H * 0.47, 'rgba(251,191,36,.82)');
        this._arrow(cx + r * 0.95, H * 0.47, W * 0.58, H * 0.47, 'rgba(45,212,191,.82)');
        this._metric(W * 0.08, H * 0.68, W * 0.22, '碘供应', this.iodine.toFixed(0) + '%', 'rgba(251,191,36,.95)');
        this._metric(W * 0.39, H * 0.68, W * 0.22, 'TSH 驱动', this.tsh.toFixed(0) + '%', 'rgba(129,140,248,.95)');
        this._metric(W * 0.70, H * 0.68, W * 0.22, 'T3/T4 输出', this.thyroid.toFixed(0) + '%', 'rgba(45,212,191,.95)');
        this._textCard(W * 0.60, H * 0.24, W * 0.32, 104, this.iodine < 35 ? '当前：碘供应不足' : '当前：原料较充足', this.iodine < 35 ? '即使 TSH 驱动升高，T3/T4 合成仍会受原料限制；长期缺碘可能导致甲状腺肿。' : 'TSH 能有效促进滤泡细胞摄取碘并释放 T3/T4。', this.iodine < 35 ? 'rgba(248,113,113,.85)' : 'rgba(45,212,191,.85)');
    },

    _textCard(x, y, w, h, title, body, color) {
        const { ctx } = this;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.58)';
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.1;
        this._roundRect(x, y, w, h, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = color;
        this._fitText(title, x + 14, y + 24, w - 28, 14, 11, '700', 'left');
        ctx.font = this._font('', 12);
        ctx.fillStyle = 'rgba(203, 213, 225, 0.76)';
        this._wrapText(body, x + 14, y + 48, w - 28, 17, Math.floor((h - 50) / 17));
    },

    _draw() {
        if (!this.ctx) return;
        this._step();
        this._drawBg();
        if (this.mode === 'feedback') this._drawFeedback();
        else if (this.mode === 'cold') this._drawCold();
        else if (this.mode === 'iodine') this._drawIodine();
        else this._drawAxis();
    },

    _injectInfoPanel() {
        const el = document.getElementById('humoral-info');
        if (!el) return;
        el.innerHTML = `
            <div class="humoral-info__hd">体液调节知识点</div>
            <div class="humoral-info__grid">
                <div class="humoral-info__block">
                    <div class="humoral-info__sub">当前观察</div>
                    <div id="humoral-mode-title" class="humoral-info__val"></div>
                    <div id="humoral-mode-desc" class="humoral-info__desc"></div>
                </div>
                <div class="humoral-info__block">
                    <div class="humoral-info__sub">激素级联</div>
                    <div class="humoral-info__row"><span class="humoral-info__key" style="--c:#60a5fa">TRH</span>下丘脑释放，经垂体门脉系统作用于垂体前叶。</div>
                    <div class="humoral-info__row"><span class="humoral-info__key" style="--c:#818cf8">TSH</span>垂体前叶释放，刺激甲状腺合成并释放 T3/T4。</div>
                    <div class="humoral-info__row"><span class="humoral-info__key" style="--c:#2dd4bf">T3/T4</span>提高基础代谢率，影响耗氧、ATP 周转和产热。</div>
                </div>
                <div class="humoral-info__block">
                    <div class="humoral-info__sub">判读顺序</div>
                    <div class="humoral-info__note">先看 T3/T4 是否接近设定范围，再看 TRH/TSH 是在补偿不足还是被负反馈压低，最后结合碘供应判断合成是否受限。</div>
                </div>
                <div class="humoral-info__block">
                    <div class="humoral-info__sub">模型读数</div>
                    <div id="humoral-readout" class="humoral-info__desc"></div>
                </div>
                <div class="humoral-info__block">
                    <div class="humoral-info__sub">模型边界</div>
                    <div class="humoral-info__note">画布数值是教学指数，用来观察方向关系；它不是化验结果，也不用于疾病判断、用药或诊断。</div>
                </div>
            </div>
            <div class="humoral-info__source">参考 OpenStax Anatomy and Physiology 2e 17.3 The Pituitary Gland and Hypothalamus 与 17.4 The Thyroid Gland。</div>
        `;
        this._updateInfo();
    },

    _formatHormoneState() {
        if (this.thyroid > this.setPoint + 6) return 'T3/T4 高于设定范围，负反馈正在压低 TRH/TSH';
        if (this.thyroid < this.setPoint - 6) return 'T3/T4 低于设定范围，上游 TRH/TSH 驱动增强';
        return 'T3/T4 接近设定范围，上下游信号趋于平衡';
    },

    _updateInfo() {
        const mode = this.modes.find(item => item.key === this.mode) || this.modes[0];
        const title = document.getElementById('humoral-mode-title');
        const desc = document.getElementById('humoral-mode-desc');
        const readout = document.getElementById('humoral-readout');
        if (title) title.textContent = mode.label;
        if (desc) desc.textContent = mode.desc;
        if (readout) {
            const iodineState = this.iodine < 35 ? '碘供应偏低，T3/T4 合成可能受限' : '碘供应能支持当前合成需求';
            readout.textContent = `${this._formatHormoneState()}；TRH ${this.trh.toFixed(0)}% · TSH ${this.tsh.toFixed(0)}% · T3/T4 ${this.thyroid.toFixed(0)}% · 碘供应 ${this.iodine.toFixed(0)}%。${iodineState}。`;
        }
    },

    _loop() {
        this.t = performance.now() / 1000;
        this._draw();
        this._updateInfo();
        this.animId = requestAnimationFrame(() => this._loop());
    }
};

function initHumoralRegulation() {
    HumoralRegulation.init();
}

window.HumoralRegulation = HumoralRegulation;
window.initHumoralRegulation = initHumoralRegulation;
