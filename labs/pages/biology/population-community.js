/* Population & Community Ecology: growth curves, regulation and species interactions */
const PopulationCommunity = {
    canvas: null,
    ctx: null,
    W: 0,
    H: 0,
    animId: null,
    _listeners: [],
    _ro: null,
    mode: 'growth',
    relation: 'competition',
    growthRate: 0.08,
    carryingCapacity: 260,
    pressure: 25,
    speed: 1,
    expN: 18,
    logisticN: 18,
    regulatedN: 150,
    speciesA: 150,
    speciesB: 122,
    historyExp: [],
    historyLog: [],
    historyReg: [],
    historyA: [],
    historyB: [],
    t: 0,
    modes: [
        {
            key: 'growth',
            label: 'J/S 增长',
            desc: '资源充足、个体较少时可近似指数式 J 型增长；资源受限时，逻辑斯蒂增长会逐渐接近环境容纳量 K。'
        },
        {
            key: 'regulation',
            label: '密度制约',
            desc: '捕食、竞争、疾病和废物积累常随种群密度增强；天气、灾害和污染等非密度因素也会改变种群规模。'
        },
        {
            key: 'interactions',
            label: '种间关系',
            desc: '用 +、-、0 描述两个物种受到的影响，比较竞争、捕食、互利共生、寄生和偏利共生等群落关系。'
        },
        {
            key: 'diversity',
            label: '群落结构',
            desc: '群落由同一生境中的多个种群组成；物种丰富度、相对多度、基础种和关键种会影响群落结构。'
        }
    ],
    relations: [
        {
            key: 'competition',
            label: '竞争',
            signs: ['-', '-'],
            desc: '两个物种争夺相同资源时都会受到抑制；生态位完全重叠会触发竞争排斥。'
        },
        {
            key: 'predation',
            label: '捕食',
            signs: ['-', '+'],
            desc: '猎物数量变化会影响捕食者，捕食者数量峰值常滞后于猎物峰值。'
        },
        {
            key: 'mutualism',
            label: '互利共生',
            signs: ['+', '+'],
            desc: '两个物种都获得收益，但收益通常受资源或种群规模上限限制。'
        },
        {
            key: 'parasitism',
            label: '寄生',
            signs: ['-', '+'],
            desc: '寄生者受益，宿主受损；宿主种群过低也会限制寄生者继续增长。'
        },
        {
            key: 'commensalism',
            label: '偏利共生',
            signs: ['+', '0'],
            desc: '一方受益，另一方在教学模型中近似不受明显影响。'
        }
    ],

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        if (this.canvas) this.destroy();
        this.canvas = document.getElementById('popcomm-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this._resize();
        if (typeof ResizeObserver !== 'undefined') {
            this._ro = new ResizeObserver(() => this._resize());
            this._ro.observe(this.canvas.parentElement);
        } else {
            this._on(window, 'resize', () => this._resize());
        }
        this._resetState();
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
        const ctrl = document.getElementById('popcomm-controls');
        if (ctrl) ctrl.innerHTML = '';
        this.canvas = null;
        this.ctx = null;
    },

    _resize() {
        if (!this.canvas || !this.canvas.parentElement || !this.ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const w = this.canvas.parentElement.getBoundingClientRect().width;
        const h = Math.min(Math.max(w * 0.56, 360), 520);
        this.canvas.width = Math.floor(w * dpr);
        this.canvas.height = Math.floor(h * dpr);
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w;
        this.H = h;
        this._draw();
    },

    _resetState() {
        const start = 18;
        this.expN = start;
        this.logisticN = start;
        this.regulatedN = this.carryingCapacity * 0.56;
        this.speciesA = this.carryingCapacity * 0.54;
        this.speciesB = this.carryingCapacity * 0.42;
        this.historyExp = [this.expN];
        this.historyLog = [this.logisticN];
        this.historyReg = [this.regulatedN];
        this.historyA = [this.speciesA];
        this.historyB = [this.speciesB];
    },

    _buildControls() {
        const ctrl = document.getElementById('popcomm-controls');
        if (!ctrl) return;
        ctrl.innerHTML = '';

        const modes = document.createElement('div');
        modes.className = 'popcomm-mode-btns';
        modes.setAttribute('role', 'group');
        modes.setAttribute('aria-label', '种群与群落观察模式');
        this.modes.forEach(item => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'popcomm-btn' + (item.key === this.mode ? ' active' : '');
            btn.dataset.mode = item.key;
            btn.textContent = item.label;
            btn.setAttribute('aria-pressed', item.key === this.mode ? 'true' : 'false');
            this._on(btn, 'click', () => {
                this.mode = item.key;
                modes.querySelectorAll('.popcomm-btn').forEach(b => {
                    b.classList.toggle('active', b === btn);
                    b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
                });
                this._updateInfo();
            });
            modes.appendChild(btn);
        });

        const relations = document.createElement('div');
        relations.className = 'popcomm-relation-btns';
        relations.setAttribute('role', 'group');
        relations.setAttribute('aria-label', '种间关系类型');
        this.relations.forEach(item => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'popcomm-btn popcomm-relation-btn' + (item.key === this.relation ? ' active' : '');
            btn.dataset.relation = item.key;
            btn.textContent = item.label;
            btn.setAttribute('aria-pressed', item.key === this.relation ? 'true' : 'false');
            this._on(btn, 'click', () => {
                this.relation = item.key;
                relations.querySelectorAll('.popcomm-relation-btn').forEach(b => {
                    b.classList.toggle('active', b === btn);
                    b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
                });
                this._updateInfo();
            });
            relations.appendChild(btn);
        });

        const sliders = document.createElement('div');
        sliders.className = 'popcomm-sliders';
        sliders.appendChild(this._makeSlider('r 增长率', '', 0.02, 0.16, 0.01, 'growthRate'));
        sliders.appendChild(this._makeSlider('K 容纳量', '', 120, 420, 20, 'carryingCapacity'));
        sliders.appendChild(this._makeSlider('资源压力', '%', 0, 100, 5, 'pressure'));
        sliders.appendChild(this._makeSlider('速度', 'x', 0.4, 2.5, 0.1, 'speed'));

        ctrl.append(modes, relations, sliders);
    },

    _makeSlider(labelText, unit, min, max, step, prop) {
        const label = document.createElement('label');
        label.className = 'popcomm-slider';
        const caption = document.createElement('span');
        caption.textContent = labelText;
        const input = document.createElement('input');
        input.type = 'range';
        input.min = min;
        input.max = max;
        input.step = step;
        input.value = this[prop];
        const value = document.createElement('span');
        value.className = 'popcomm-slider__value';
        value.textContent = this._formatValue(this[prop], unit);
        this._on(input, 'input', () => {
            this[prop] = parseFloat(input.value);
            value.textContent = this._formatValue(this[prop], unit);
            if (prop === 'carryingCapacity' && this.regulatedN > this._effectiveK() * 1.25) {
                this.regulatedN = this._effectiveK() * 1.05;
            }
            this._updateInfo();
        });
        label.append(caption, input, value);
        return label;
    },

    _formatValue(value, unit) {
        if (unit === 'x') return value.toFixed(1) + unit;
        if (unit === '%') return Math.round(value) + unit;
        if (Math.abs(value) < 1) return value.toFixed(2);
        return Math.round(value).toString();
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

    _clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    },

    _effectiveK() {
        return this.carryingCapacity * (1 - this.pressure * 0.0032);
    },

    _pushHistory(arr, value) {
        arr.push(value);
        const max = this.W < 560 ? 120 : 170;
        if (arr.length > max) arr.shift();
    },

    _step() {
        const dt = 0.38 * this.speed;
        const r = this.growthRate;
        const k = this._effectiveK();
        this.expN += r * this.expN * dt;
        this.logisticN += r * this.logisticN * (1 - this.logisticN / k) * dt;
        this.expN = this._clamp(this.expN, 5, k * 1.65);
        this.logisticN = this._clamp(this.logisticN, 5, k * 1.12);
        if (this.expN >= k * 1.64 && this.historyExp.length > 45) {
            this.expN = 18;
            this.logisticN = 18;
            this.historyExp.length = 0;
            this.historyLog.length = 0;
        }
        this._pushHistory(this.historyExp, this.expN);
        this._pushHistory(this.historyLog, this.logisticN);

        const seasonalK = k * (0.9 + Math.sin(this.t * 0.48) * 0.08);
        const densityStress = Math.max(0, this.regulatedN / seasonalK - 0.76);
        const independentPulse = (this.pressure / 100) * (0.12 + Math.max(0, Math.sin(this.t * 0.72)) * 0.22);
        const densityLoss = densityStress * this.regulatedN * 0.11;
        const independentLoss = independentPulse * 4.2;
        const regGrowth = r * this.regulatedN * (1 - this.regulatedN / seasonalK);
        this.regulatedN += (regGrowth - densityLoss - independentLoss) * dt;
        this.regulatedN = this._clamp(this.regulatedN, 12, k * 1.22);
        this._pushHistory(this.historyReg, this.regulatedN);

        this._stepInteraction(dt, r, k);
    },

    _stepInteraction(dt, r, k) {
        const A = this.speciesA;
        const B = this.speciesB;
        const rel = this.relation;
        let dA = r * A * (1 - A / (k * 0.95));
        let dB = r * B * (1 - B / (k * 0.82));
        if (rel === 'competition') {
            dA -= 0.0018 * A * B;
            dB -= 0.0015 * A * B;
        } else if (rel === 'predation') {
            dA -= 0.0021 * A * B;
            dB += 0.00095 * A * B - 0.06 * B;
        } else if (rel === 'mutualism') {
            const benefit = 0.00062 * A * B * (1 - (A + B) / (k * 1.85));
            dA += benefit;
            dB += benefit * 0.86;
        } else if (rel === 'parasitism') {
            dA -= 0.00145 * A * B;
            dB += 0.00075 * A * B - 0.055 * B;
        } else if (rel === 'commensalism') {
            dA += 0.00072 * A * B * (1 - A / (k * 1.05));
        }
        const pressureLoss = this.pressure * 0.006;
        this.speciesA += (dA - pressureLoss * A) * dt;
        this.speciesB += (dB - pressureLoss * 0.8 * B) * dt;
        this.speciesA = this._clamp(this.speciesA, 8, k * 1.18);
        this.speciesB = this._clamp(this.speciesB, 8, k * 1.05);
        if (this.speciesA < 10 || this.speciesB < 10) {
            this.speciesA += 0.25 * this.speed;
            this.speciesB += 0.22 * this.speed;
        }
        this._pushHistory(this.historyA, this.speciesA);
        this._pushHistory(this.historyB, this.speciesB);
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
        const chars = Array.from(text);
        let line = '';
        let lineCount = 0;
        for (let i = 0; i < chars.length; i++) {
            if (maxLines && lineCount >= maxLines) return;
            const ch = chars[i];
            const next = line + ch;
            if (ctx.measureText(next).width > maxWidth && line) {
                ctx.fillText(line, x, y + lineCount * lineHeight);
                line = ch;
                lineCount += 1;
            } else {
                line = next;
            }
            if (i === chars.length - 1 && line && (!maxLines || lineCount < maxLines)) {
                ctx.fillText(line, x, y + lineCount * lineHeight);
            }
        }
    },

    _drawBg() {
        const { ctx, W, H } = this;
        ctx.clearRect(0, 0, W, H);
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, 'rgba(13, 148, 136, 0.12)');
        g.addColorStop(0.52, 'rgba(37, 99, 235, 0.06)');
        g.addColorStop(1, 'rgba(245, 158, 11, 0.08)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.10)';
        ctx.lineWidth = 1;
        for (let x = 34; x < W; x += 42) {
            ctx.beginPath();
            ctx.moveTo(x, 54);
            ctx.lineTo(x, H - 30);
            ctx.stroke();
        }
        for (let y = 58; y < H - 28; y += 38) {
            ctx.beginPath();
            ctx.moveTo(30, y);
            ctx.lineTo(W - 30, y);
            ctx.stroke();
        }
    },

    _drawTitle(title, subtitle) {
        const { ctx, W } = this;
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = 'rgba(226, 232, 240, 0.95)';
        this._fitText(title, W / 2, 30, W - 36, Math.max(18, Math.min(24, W * 0.032)), 15, '700');
        ctx.fillStyle = 'rgba(148, 163, 184, 0.84)';
        this._fitText(subtitle, W / 2, 52, W - 44, 12, 10, '');
    },

    _drawLegend(items, x, y) {
        const { ctx } = this;
        ctx.textAlign = 'left';
        ctx.font = this._font('600', 12);
        let cx = x;
        items.forEach(item => {
            ctx.fillStyle = item.color;
            ctx.beginPath();
            ctx.arc(cx + 5, y - 4, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(203, 213, 225, 0.82)';
            ctx.fillText(item.label, cx + 14, y);
            cx += Math.max(76, ctx.measureText(item.label).width + 34);
        });
    },

    _drawLineChart(x, y, w, h, series, maxY, options = {}) {
        const { ctx } = this;
        if (w < 80 || h < 70) return;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.50)';
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
        this._roundRect(x, y, w, h, 8);
        ctx.fill();
        ctx.stroke();
        ctx.save();
        ctx.beginPath();
        this._roundRect(x + 1, y + 1, w - 2, h - 2, 8);
        ctx.clip();
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
        ctx.lineWidth = 1;
        for (let i = 1; i < 4; i++) {
            const gy = y + (h * i) / 4;
            ctx.beginPath();
            ctx.moveTo(x + 10, gy);
            ctx.lineTo(x + w - 10, gy);
            ctx.stroke();
        }
        if (options.kLine) {
            const ky = y + h - (options.kLine / maxY) * h;
            ctx.strokeStyle = 'rgba(251, 191, 36, 0.58)';
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(x + 10, ky);
            ctx.lineTo(x + w - 10, ky);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.font = this._font('700', 11);
            ctx.fillStyle = 'rgba(251, 191, 36, 0.88)';
            ctx.textAlign = 'right';
            ctx.fillText('K', x + w - 14, ky - 6);
        }
        series.forEach(s => {
            const data = s.data;
            if (!data || data.length < 2) return;
            ctx.strokeStyle = s.color;
            ctx.lineWidth = s.width || 2.5;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.beginPath();
            data.forEach((v, i) => {
                const px = x + 12 + (i / Math.max(1, data.length - 1)) * (w - 24);
                const py = y + h - this._clamp(v / maxY, 0, 1) * (h - 18) - 9;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            });
            ctx.stroke();
        });
        ctx.restore();
        ctx.font = this._font('', 11);
        ctx.fillStyle = 'rgba(148, 163, 184, 0.72)';
        ctx.textAlign = 'left';
        ctx.fillText(options.yLabel || '种群数量 N', x + 12, y + 18);
        ctx.textAlign = 'right';
        ctx.fillText(options.xLabel || '时间', x + w - 12, y + h - 10);
    },

    _metric(x, y, w, label, value, color) {
        const { ctx } = this;
        if (w < 60) return;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.56)';
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
        this._roundRect(x, y, w, 58, 8);
        ctx.fill();
        ctx.stroke();
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(148, 163, 184, 0.82)';
        this._fitText(label, x + 12, y + 20, w - 24, 12, 10, '', 'left');
        ctx.fillStyle = color;
        this._fitText(value, x + 12, y + 44, w - 24, 18, 13, '700', 'left');
    },

    _textCard(x, y, w, h, title, body, color) {
        const { ctx } = this;
        if (w < 90 || h < 58) return;
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
        this._wrapText(body, x + 14, y + 48, w - 28, 17, Math.max(1, Math.floor((h - 52) / 17)));
    },

    _drawGrowth() {
        const { W, H } = this;
        const k = this._effectiveK();
        this._drawTitle('J 型与 S 型种群增长', '指数增长依赖理想资源条件；资源受限时增长会被 K 值压低');
        const x = W < 560 ? 30 : 54;
        const y = 76;
        const w = W - x * 2;
        const h = H * 0.54;
        this._drawLineChart(x, y, w, h, [
            { data: this.historyExp, color: 'rgba(251, 191, 36, 0.95)', width: 2.4 },
            { data: this.historyLog, color: 'rgba(45, 212, 191, 0.95)', width: 3 }
        ], Math.max(k * 1.65, 80), { kLine: k, yLabel: 'N', xLabel: '代数/时间' });
        this._drawLegend([
            { label: 'J 型指数增长', color: 'rgba(251, 191, 36, 0.95)' },
            { label: 'S 型逻辑斯蒂增长', color: 'rgba(45, 212, 191, 0.95)' }
        ], x + 10, y - 10);
        const metricY = y + h + 20;
        const gap = 10;
        const cardW = (w - gap * 2) / 3;
        this._metric(x, metricY, cardW, '有效 K', Math.round(k).toString(), 'rgba(251, 191, 36, .95)');
        this._metric(x + cardW + gap, metricY, cardW, '指数 N', Math.round(this.expN).toString(), 'rgba(251, 191, 36, .95)');
        this._metric(x + (cardW + gap) * 2, metricY, cardW, '逻辑斯蒂 N', Math.round(this.logisticN).toString(), 'rgba(45, 212, 191, .95)');
        if (W >= 700) {
            this._textCard(W * 0.12, H - 72, W * 0.76, 48, '判读提示', '当 N 接近 K 时，(K-N)/K 项变小，增长率下降；N 超过 K 时种群可能回落。', 'rgba(96, 165, 250, .78)');
        }
    },

    _drawRegulation() {
        const { ctx, W, H } = this;
        const k = this._effectiveK();
        this._drawTitle('种群动态与调节因素', '密度制约因素随 N 改变；非密度因素可由天气、灾害或污染触发');
        const compact = W < 620;
        const x = compact ? 30 : 54;
        const y = 78;
        const chartW = compact ? W - 60 : W * 0.55;
        const chartH = compact ? Math.min(H * 0.34, 130) : H * 0.58;
        this._drawLineChart(x, y, chartW, chartH, [
            { data: this.historyReg, color: 'rgba(45, 212, 191, 0.95)', width: 3 }
        ], Math.max(k * 1.25, 100), { kLine: k, yLabel: 'N 与 K', xLabel: '时间' });
        const panelX = compact ? x : x + chartW + 24;
        const panelY = compact ? y + chartH + 18 : y + 8;
        const panelW = compact ? chartW : W - panelX - 54;
        const panelH = compact ? H - panelY - 24 : chartH - 16;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
        this._roundRect(panelX, panelY, panelW, panelH, 8);
        ctx.fill();
        ctx.stroke();
        const density = this._clamp(this.regulatedN / k, 0, 1.4);
        const densityBar = this._clamp(density / 1.2, 0, 1);
        const independentBar = this._clamp(this.pressure / 100, 0, 1);
        const bars = [
            { label: '密度制约', value: densityBar, color: 'rgba(248, 113, 113, .88)', desc: '竞争 / 捕食 / 疾病 / 废物' },
            { label: '非密度制约', value: independentBar, color: 'rgba(251, 191, 36, .88)', desc: '天气 / 灾害 / 污染' }
        ];
        ctx.textAlign = 'left';
        ctx.font = this._font('700', 15);
        ctx.fillStyle = 'rgba(226,232,240,.92)';
        ctx.fillText('调节强度', panelX + 18, panelY + 28);
        bars.forEach((bar, i) => {
            const by = panelY + (compact ? 44 : 58) + i * (compact ? 48 : 70);
            ctx.font = this._font('600', 12);
            ctx.fillStyle = 'rgba(203,213,225,.82)';
            ctx.fillText(bar.label, panelX + 18, by);
            ctx.fillStyle = 'rgba(30,41,59,.82)';
            this._roundRect(panelX + 18, by + 12, panelW - 36, 12, 6);
            ctx.fill();
            ctx.fillStyle = bar.color;
            this._roundRect(panelX + 18, by + 12, (panelW - 36) * bar.value, 12, 6);
            ctx.fill();
            ctx.font = this._font('', 11);
            ctx.fillStyle = 'rgba(148,163,184,.78)';
            ctx.fillText(bar.desc, panelX + 18, by + 42);
        });
        const status = this.regulatedN > k ? 'N 已超过 K，资源压力会使种群回落。' : 'N 低于 K，仍有增长空间但受扰动影响。';
        if (!compact || panelH > 150) {
            ctx.font = this._font('', 12);
            ctx.fillStyle = 'rgba(203,213,225,.76)';
            this._wrapText(status, panelX + 18, panelY + panelH - 44, panelW - 36, 17, 2);
        }
    },

    _drawInteractions() {
        const { ctx, W, H } = this;
        const rel = this.relations.find(item => item.key === this.relation) || this.relations[0];
        const k = this._effectiveK();
        this._drawTitle('种间关系与群落动态', '同一生境中的多个种群通过竞争、捕食、共生等关系相互影响');
        const compact = W < 620;
        const x = compact ? 30 : 54;
        const y = 78;
        const chartW = compact ? W - 60 : W * 0.53;
        const chartH = compact ? Math.min(H * 0.33, 126) : H * 0.56;
        this._drawLineChart(x, y, chartW, chartH, [
            { data: this.historyA, color: 'rgba(45, 212, 191, 0.95)', width: 3 },
            { data: this.historyB, color: 'rgba(96, 165, 250, 0.95)', width: 3 }
        ], Math.max(k * 1.2, 100), { yLabel: '两个物种的 N', xLabel: '时间' });
        this._drawLegend([
            { label: '物种 A', color: 'rgba(45, 212, 191, 0.95)' },
            { label: '物种 B', color: 'rgba(96, 165, 250, 0.95)' }
        ], x + 10, y - 10);
        const mx = compact ? x : x + chartW + 24;
        const my = compact ? y + chartH + 18 : y + 8;
        const mw = compact ? chartW : W - mx - 54;
        const mh = compact ? H - my - 24 : chartH - 16;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.58)';
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
        this._roundRect(mx, my, mw, mh, 8);
        ctx.fill();
        ctx.stroke();
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(226,232,240,.94)';
        this._fitText(rel.label + '关系', mx + 18, my + 30, mw - 36, 16, 12, '700', 'left');
        const signY = my + 66;
        const badgeW = compact ? Math.min(108, (mw - 50) / 2) : 100;
        this._signBadge(mx + 20, signY, badgeW, '物种 A', rel.signs[0], 'rgba(45, 212, 191, .92)');
        this._signBadge(mx + 34 + badgeW, signY, badgeW, '物种 B', rel.signs[1], 'rgba(96, 165, 250, .92)');
        ctx.font = this._font('', 12);
        ctx.fillStyle = 'rgba(203,213,225,.76)';
        this._wrapText(rel.desc, mx + 18, signY + 58, mw - 36, 18, compact ? 2 : 4);
        const nicheY = my + mh - 64;
        if (nicheY > signY + 118) {
            ctx.font = this._font('700', 12);
            ctx.fillStyle = 'rgba(251,191,36,.90)';
            this._fitText('生态位提示', mx + 18, nicheY, mw - 36, 12, 10, '700', 'left');
            ctx.font = this._font('', 12);
            ctx.fillStyle = 'rgba(148,163,184,.78)';
            this._wrapText('资源分割可降低生态位重叠，让相似物种在同一群落中共存。', mx + 18, nicheY + 22, mw - 36, 17, 2);
        }
    },

    _signBadge(x, y, w, label, sign, color) {
        const { ctx } = this;
        ctx.fillStyle = 'rgba(15,23,42,.72)';
        ctx.strokeStyle = color;
        this._roundRect(x, y, w, 42, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(148,163,184,.82)';
        this._fitText(label, x + 12, y + 16, w - 42, 11, 10, '', 'left');
        ctx.fillStyle = sign === '-' ? 'rgba(248,113,113,.92)' : sign === '+' ? color : 'rgba(203,213,225,.80)';
        this._fitText(sign, x + w - 24, y + 28, 24, 22, 16, '800', 'center');
    },

    _drawDiversity() {
        const { ctx, W, H } = this;
        this._drawTitle('群落结构：丰富度、均匀度与关键种', '群落不是单一物种的总和，物种组成会影响稳定性和能量路径');
        const x = W < 560 ? 30 : 54;
        const y = 78;
        const w = W - x * 2;
        const h = H - y - 36;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.52)';
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
        this._roundRect(x, y, w, h, 8);
        ctx.fill();
        ctx.stroke();
        const species = [
            { name: '生产者', value: 0.92 - this.pressure / 260, color: 'rgba(45,212,191,.92)' },
            { name: '草食者', value: 0.66 + Math.sin(this.t * 0.7) * 0.08, color: 'rgba(96,165,250,.92)' },
            { name: '捕食者', value: 0.42 + Math.sin(this.t * 0.52 + 1) * 0.08, color: 'rgba(251,191,36,.92)' },
            { name: '分解者', value: 0.58 + this.pressure / 360, color: 'rgba(167,139,250,.88)' }
        ];
        const barX = x + 24;
        const barY = y + 46;
        const barW = Math.min(w * 0.42, 260);
        ctx.textAlign = 'left';
        ctx.font = this._font('700', 15);
        ctx.fillStyle = 'rgba(226,232,240,.94)';
        ctx.fillText('相对多度', barX, y + 28);
        species.forEach((item, i) => {
            const by = barY + i * 48;
            ctx.font = this._font('600', 12);
            ctx.fillStyle = 'rgba(203,213,225,.82)';
            ctx.fillText(item.name, barX, by);
            ctx.fillStyle = 'rgba(30,41,59,.84)';
            this._roundRect(barX, by + 12, barW, 12, 6);
            ctx.fill();
            ctx.fillStyle = item.color;
            this._roundRect(barX, by + 12, barW * this._clamp(item.value, 0.08, 1), 12, 6);
            ctx.fill();
        });
        const compact = W < 620;
        const netX = x + Math.max(w * 0.50, 330);
        const netY = y + 64;
        const netW = x + w - netX - 24;
        if (!compact && netW > 150) {
            const nodes = [
                { label: '关键种', x: netX + netW * 0.5, y: netY + 20, c: 'rgba(251,191,36,.96)' },
                { label: '生产者', x: netX + netW * 0.18, y: netY + 96, c: 'rgba(45,212,191,.92)' },
                { label: '消费者', x: netX + netW * 0.72, y: netY + 104, c: 'rgba(96,165,250,.92)' },
                { label: '分解者', x: netX + netW * 0.46, y: netY + 170, c: 'rgba(167,139,250,.90)' }
            ];
            ctx.strokeStyle = 'rgba(148,163,184,.22)';
            ctx.lineWidth = 1.3;
            [[0, 1], [0, 2], [1, 2], [1, 3], [2, 3]].forEach(([a, b]) => {
                ctx.beginPath();
                ctx.moveTo(nodes[a].x, nodes[a].y);
                ctx.lineTo(nodes[b].x, nodes[b].y);
                ctx.stroke();
            });
            nodes.forEach(node => {
                ctx.fillStyle = 'rgba(15,23,42,.76)';
                ctx.strokeStyle = node.c;
                ctx.lineWidth = 1.4;
                ctx.beginPath();
                ctx.arc(node.x, node.y, 27, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                ctx.textAlign = 'center';
                ctx.fillStyle = node.c;
                this._fitText(node.label, node.x, node.y + 4, 46, 11, 9, '700');
            });
        }
        const bottomY = y + h - 72;
        if (bottomY > y + 240) {
            this._textCard(x + 22, bottomY, w - 44, 52, '结构提示', '关键种对群落结构有不成比例的影响；基础种通过创造或维持生境支撑其他物种。', 'rgba(96,165,250,.82)');
        }
    },

    _draw() {
        if (!this.ctx) return;
        this._step();
        this._drawBg();
        if (this.mode === 'regulation') this._drawRegulation();
        else if (this.mode === 'interactions') this._drawInteractions();
        else if (this.mode === 'diversity') this._drawDiversity();
        else this._drawGrowth();
    },

    _injectInfoPanel() {
        const el = document.getElementById('popcomm-info');
        if (!el) return;
        el.innerHTML = `
            <div class="popcomm-info__hd">种群与群落知识点</div>
            <div class="popcomm-info__grid">
                <div class="popcomm-info__block">
                    <div class="popcomm-info__sub">当前观察</div>
                    <div id="popcomm-mode-title" class="popcomm-info__val"></div>
                    <div id="popcomm-mode-desc" class="popcomm-info__desc"></div>
                </div>
                <div class="popcomm-info__block">
                    <div class="popcomm-info__sub">核心变量</div>
                    <div class="popcomm-info__row"><span class="popcomm-info__key" style="--c:#2dd4bf">N</span>种群数量，随出生、死亡、迁入迁出改变。</div>
                    <div class="popcomm-info__row"><span class="popcomm-info__key" style="--c:#fbbf24">K</span>环境容纳量，资源、空间与环境压力会改变它。</div>
                    <div class="popcomm-info__row"><span class="popcomm-info__key" style="--c:#60a5fa">r</span>内禀增长率，描述理想条件下的增长潜力。</div>
                </div>
                <div class="popcomm-info__block">
                    <div class="popcomm-info__sub">关系与调节</div>
                    <div id="popcomm-relation-readout" class="popcomm-info__desc"></div>
                    <div class="popcomm-info__note">竞争排斥原理指出：两个物种若以完全相同方式竞争完全相同资源，难以长期占据同一生态位；资源分割可促进共存。</div>
                </div>
                <div class="popcomm-info__block">
                    <div class="popcomm-info__sub">判读顺序</div>
                    <div class="popcomm-info__note">先看 N 与 K 的相对位置，再判断限制来自资源、密度相关因素还是非密度扰动；分析群落时同时看物种丰富度和相对多度。</div>
                </div>
                <div class="popcomm-info__block">
                    <div class="popcomm-info__sub">模型边界</div>
                    <div class="popcomm-info__note">画布数值是教学指数，用来观察方向关系；它不代表特定物种，也不替代野外调查或长期监测数据。</div>
                </div>
            </div>
            <div class="popcomm-info__source">参考 OpenStax Biology 2e 45.3 Environmental Limits to Population Growth、45.4 Population Dynamics and Regulation 与 45.6 Community Ecology。</div>
        `;
        this._updateInfo();
    },

    _updateInfo() {
        const mode = this.modes.find(item => item.key === this.mode) || this.modes[0];
        const rel = this.relations.find(item => item.key === this.relation) || this.relations[0];
        const title = document.getElementById('popcomm-mode-title');
        const desc = document.getElementById('popcomm-mode-desc');
        const relation = document.getElementById('popcomm-relation-readout');
        if (title) title.textContent = mode.label;
        if (desc) desc.textContent = mode.desc;
        if (relation) {
            relation.textContent = `当前 ${rel.label}：物种 A ${rel.signs[0]}，物种 B ${rel.signs[1]}。有效 K≈${Math.round(this._effectiveK())}，N(logistic)≈${Math.round(this.logisticN)}，资源压力 ${Math.round(this.pressure)}%。`;
        }
    },

    _loop() {
        this.t = performance.now() / 1000;
        this._draw();
        this._updateInfo();
        this.animId = requestAnimationFrame(() => this._loop());
    }
};

function initPopulationCommunity() {
    PopulationCommunity.init();
}

window.PopulationCommunity = PopulationCommunity;
window.initPopulationCommunity = initPopulationCommunity;
