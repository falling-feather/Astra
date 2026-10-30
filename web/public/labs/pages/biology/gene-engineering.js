/* Gene Engineering: restriction digestion, ligation, transformation and screening teaching model */
const GeneEngineering = {
    canvas: null,
    ctx: null,
    W: 0,
    H: 0,
    animId: null,
    _listeners: [],
    _ro: null,
    mode: 'cut',
    enzymeMatch: 82,
    ligase: 68,
    selection: 74,
    induction: 58,
    speed: 1,
    t: 0,
    modes: [
        {
            key: 'cut',
            label: '限制酶切割',
            desc: '限制性内切酶通常识别特定短序列并切开 DNA；同一种酶切出的互补黏性末端更容易与载体退火。'
        },
        {
            key: 'ligate',
            label: '连接载体',
            desc: 'DNA 连接酶催化磷酸二酯键形成，把目的片段接入质粒，生成需要进一步筛选的重组 DNA。'
        },
        {
            key: 'transform',
            label: '转化筛选',
            desc: '感受态细菌吸收外源质粒；抗性标记保留含质粒细胞，但不能单独证明插入片段正确。'
        },
        {
            key: 'screen',
            label: '蓝白斑筛选',
            desc: '插入片段破坏 lacZ 报告基因时常见白色菌落；蓝色多提示 lacZ 仍完整，常对应空载体。'
        },
        {
            key: 'express',
            label: '表达验证',
            desc: '不是所有重组质粒都会表达目标蛋白；表达还取决于启动子、宿主、诱导条件、方向和读码框。'
        }
    ],

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        if (this.canvas) this.destroy();
        this.canvas = document.getElementById('gene-engineering-canvas');
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
        const ctrl = document.getElementById('gene-engineering-controls');
        if (ctrl) ctrl.innerHTML = '';
        this.canvas = null;
        this.ctx = null;
    },

    _resize() {
        if (!this.canvas || !this.canvas.parentElement || !this.ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const w = Math.max(280, rect.width || this.canvas.parentElement.clientWidth || 640);
        const h = Math.min(Math.max(w * 0.54, 360), 520);
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
        const ctrl = document.getElementById('gene-engineering-controls');
        if (!ctrl) return;
        ctrl.innerHTML = '';

        const modes = document.createElement('div');
        modes.className = 'geng-mode-btns';
        modes.setAttribute('role', 'group');
        modes.setAttribute('aria-label', '基因工程流程观察模式');
        this.modes.forEach(item => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'geng-btn' + (item.key === this.mode ? ' active' : '');
            btn.dataset.mode = item.key;
            btn.textContent = item.label;
            btn.setAttribute('aria-pressed', item.key === this.mode ? 'true' : 'false');
            this._on(btn, 'click', () => {
                this.mode = item.key;
                modes.querySelectorAll('.geng-btn').forEach(b => {
                    b.classList.toggle('active', b === btn);
                    b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
                });
                this._updateInfo();
            });
            modes.appendChild(btn);
        });

        const sliders = document.createElement('div');
        sliders.className = 'geng-sliders';
        sliders.appendChild(this._makeSlider('末端匹配', '%', 0, 100, 5, 'enzymeMatch'));
        sliders.appendChild(this._makeSlider('连接酶活性', '%', 20, 100, 5, 'ligase'));
        sliders.appendChild(this._makeSlider('筛选清晰度', '%', 20, 100, 5, 'selection'));
        sliders.appendChild(this._makeSlider('诱导表达', '%', 0, 100, 5, 'induction'));
        sliders.appendChild(this._makeSlider('速度', 'x', 0.4, 2.4, 0.1, 'speed'));
        ctrl.append(modes, sliders);
    },

    _makeSlider(labelText, unit, min, max, step, prop) {
        const label = document.createElement('label');
        label.className = 'geng-slider';
        const caption = document.createElement('span');
        caption.textContent = labelText;
        const input = document.createElement('input');
        input.type = 'range';
        input.min = min;
        input.max = max;
        input.step = step;
        input.value = this[prop];
        const value = document.createElement('span');
        value.className = 'geng-slider__value';
        value.textContent = unit === 'x' ? Number(this[prop]).toFixed(1) + unit : Math.round(this[prop]) + unit;
        this._on(input, 'input', () => {
            this[prop] = parseFloat(input.value);
            value.textContent = unit === 'x' ? this[prop].toFixed(1) + unit : Math.round(this[prop]) + unit;
            this._updateInfo();
        });
        label.append(caption, input, value);
        return label;
    },

    _font(weight, size) {
        const family = (window.CF && CF.sans) || 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        return `${weight ? weight + ' ' : ''}${size}px ${family}`;
    },

    _clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    },

    _score() {
        const sticky = this.enzymeMatch / 100;
        const lig = this.ligase / 100;
        const sel = this.selection / 100;
        const recomb = this._clamp((sticky * 0.62 + lig * 0.38) * 100, 5, 98);
        const transform = this._clamp(18 + recomb * 0.45, 10, 72);
        const white = this._clamp(8 + recomb * (0.62 + sel * 0.18), 8, 96);
        const expression = this._clamp(10 + recomb * 0.35 + this.induction * 0.52, 8, 96);
        return { recomb, transform, white, expression };
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
        this._measureLines(text, maxWidth, maxLines).forEach((line, index) => {
            ctx.fillText(line, x, y + index * lineHeight);
        });
    },

    _measureLines(text, maxWidth, maxLines) {
        const { ctx } = this;
        const chars = Array.from(text);
        const lines = [];
        let line = '';
        chars.forEach(ch => {
            const next = line + ch;
            if (ctx.measureText(next).width > maxWidth && line) {
                lines.push(line);
                line = ch;
            } else {
                line = next;
            }
        });
        if (line) lines.push(line);
        if (lines.length > maxLines) {
            const clipped = lines.slice(0, maxLines);
            let last = clipped[clipped.length - 1];
            while (last.length > 1 && ctx.measureText(last + '...').width > maxWidth) {
                last = last.slice(0, -1);
            }
            clipped[clipped.length - 1] = last + '...';
            return clipped;
        }
        return lines;
    },

    _drawBg() {
        const { ctx, W, H } = this;
        ctx.clearRect(0, 0, W, H);
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, 'rgba(20, 184, 166, 0.11)');
        g.addColorStop(0.52, 'rgba(99, 102, 241, 0.06)');
        g.addColorStop(1, 'rgba(251, 191, 36, 0.06)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.09)';
        ctx.lineWidth = 1;
        for (let x = 36; x < W; x += 48) {
            ctx.beginPath();
            ctx.moveTo(x, 58);
            ctx.lineTo(x, H - 28);
            ctx.stroke();
        }
        for (let y = 64; y < H - 28; y += 42) {
            ctx.beginPath();
            ctx.moveTo(30, y);
            ctx.lineTo(W - 30, y);
            ctx.stroke();
        }
    },

    _drawTitle(title, subtitle) {
        const { ctx, W } = this;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        const compact = W < 520;
        const maxWidth = Math.max(220, W - 44);
        const titleSize = compact ? 16 : Math.max(18, Math.min(23, W * 0.029));
        ctx.font = this._font('700', titleSize);
        ctx.fillStyle = 'rgba(226, 232, 240, 0.96)';
        const titleLines = compact ? this._measureLines(title, maxWidth, 2) : [title];
        titleLines.forEach((line, i) => ctx.fillText(line, W / 2, 27 + i * 19));
        const subtitleY = 30 + titleLines.length * 19;
        ctx.font = this._font('', compact ? 10.5 : 12);
        ctx.fillStyle = 'rgba(148, 163, 184, 0.84)';
        const subtitleLines = compact ? this._measureLines(subtitle, maxWidth, 2) : [subtitle];
        subtitleLines.forEach((line, i) => ctx.fillText(line, W / 2, subtitleY + i * 15));
    },

    _panel(x, y, w, h, title, body, color) {
        const { ctx } = this;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.62)';
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.1;
        this._roundRect(x, y, w, h, 9);
        ctx.fill();
        ctx.stroke();
        ctx.textAlign = 'left';
        ctx.font = this._font('700', 13);
        ctx.fillStyle = color;
        ctx.fillText(title, x + 12, y + 22);
        ctx.font = this._font('', 11.5);
        ctx.fillStyle = 'rgba(203, 213, 225, 0.76)';
        this._wrapText(body, x + 12, y + 43, w - 24, 16, Math.max(1, Math.floor((h - 48) / 16)));
    },

    _arrow(x1, y1, x2, y2, color, label) {
        const { ctx } = this;
        const angle = Math.atan2(y2 - y1, x2 - x1);
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 2.1;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - Math.cos(angle - 0.55) * 10, y2 - Math.sin(angle - 0.55) * 10);
        ctx.lineTo(x2 - Math.cos(angle + 0.55) * 10, y2 - Math.sin(angle + 0.55) * 10);
        ctx.closePath();
        ctx.fill();
        if (label) {
            ctx.font = this._font('600', 11);
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(226,232,240,.86)';
            ctx.fillText(label, (x1 + x2) / 2, (y1 + y2) / 2 - 8);
        }
    },

    _metric(x, y, w, label, value, color) {
        const { ctx } = this;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.58)';
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
        this._roundRect(x, y, w, 58, 8);
        ctx.fill();
        ctx.stroke();
        ctx.textAlign = 'left';
        ctx.font = this._font('', 12);
        ctx.fillStyle = 'rgba(148, 163, 184, 0.82)';
        ctx.fillText(label, x + 12, y + 20);
        ctx.font = this._font('700', 17);
        ctx.fillStyle = color;
        ctx.fillText(value, x + 12, y + 43);
    },

    _drawDNA(x, y, w, label, color, cut) {
        const { ctx } = this;
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + w, y);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(226,232,240,.36)';
        ctx.lineWidth = 1.4;
        for (let i = 0; i <= 11; i++) {
            const px = x + (w / 11) * i;
            ctx.beginPath();
            ctx.moveTo(px, y - 9);
            ctx.lineTo(px + 8, y + 9);
            ctx.stroke();
        }
        if (cut) {
            const cx = x + w * 0.52;
            ctx.strokeStyle = 'rgba(248,113,113,.9)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cx - 10, y - 24);
            ctx.lineTo(cx + 4, y + 22);
            ctx.moveTo(cx + 8, y - 24);
            ctx.lineTo(cx - 6, y + 22);
            ctx.stroke();
            ctx.fillStyle = 'rgba(15,23,42,.78)';
            ctx.strokeStyle = 'rgba(248,113,113,.45)';
            this._roundRect(cx - 38, y - 54, 76, 24, 6);
            ctx.fill();
            ctx.stroke();
            ctx.font = this._font('700', 11);
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(248,113,113,.95)';
            ctx.fillText(this.enzymeMatch >= 55 ? 'EcoRI' : 'HaeIII', cx, y - 38);
        }
        ctx.font = this._font('700', 12);
        ctx.textAlign = 'center';
        ctx.fillStyle = color;
        ctx.fillText(label, x + w / 2, y + 32);
    },

    _drawPlasmid(cx, cy, r, label, openGap) {
        const { ctx } = this;
        ctx.strokeStyle = 'rgba(45,212,191,.92)';
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        if (openGap) {
            ctx.arc(cx, cy, r, 0.3, Math.PI * 1.7);
        } else {
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
        }
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(251,191,36,.9)';
        ctx.beginPath();
        ctx.arc(cx, cy, r, Math.PI * 1.68, Math.PI * 1.95);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(96,165,250,.86)';
        ctx.beginPath();
        ctx.arc(cx, cy, r, Math.PI * 0.25, Math.PI * 0.58);
        ctx.stroke();
        ctx.font = this._font('700', 12);
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(226,232,240,.92)';
        ctx.fillText(label, cx, cy + 4);
        ctx.font = this._font('', 10.5);
        ctx.fillStyle = 'rgba(251,191,36,.92)';
        ctx.fillText('ampR', cx - r * 0.18, cy - r - 8);
        ctx.fillStyle = 'rgba(96,165,250,.88)';
        ctx.fillText('lacZ/MCS', cx + r * 0.58, cy + r * 0.26);
    },

    _drawCut() {
        const { ctx, W, H } = this;
        const compact = W < 640;
        this._drawTitle('限制酶切割：找到识别位点再切开 DNA', '同一限制酶切割目的片段和质粒，可产生互补末端，便于后续连接');
        if (compact) {
            this._drawDNA(46, 105, W - 92, '目的基因片段', 'rgba(96,165,250,.94)', true);
            this._drawPlasmid(W / 2, 228, 56, '质粒载体', true);
            this._panel(32, 312, W - 64, 86, '末端匹配', this.enzymeMatch >= 55 ? '末端互补度较高，黏性末端可以先通过碱基配对靠近。' : '末端匹配较差，连接效率下降，需更换酶切位点或连接策略。', 'rgba(251,191,36,.92)');
        } else {
            this._drawDNA(W * 0.08, H * 0.38, W * 0.38, '目的基因片段', 'rgba(96,165,250,.94)', true);
            this._drawPlasmid(W * 0.70, H * 0.43, 78, '质粒载体', true);
            this._arrow(W * 0.48, H * 0.38, W * 0.59, H * 0.41, 'rgba(251,191,36,.76)', '相同酶切位点');
            this._panel(W * 0.08, H * 0.62, W * 0.36, 94, '限制酶', '常识别 4-6 bp 左右的特定序列，可产生黏性末端或平末端。', 'rgba(248,113,113,.9)');
            this._panel(W * 0.52, H * 0.62, W * 0.38, 94, '载体结构', '质粒载体常含复制起点、抗性标记、报告基因和多克隆位点。', 'rgba(45,212,191,.92)');
        }
        this._drawBottomMetrics();
    },

    _drawLigate() {
        const { ctx, W, H } = this;
        const compact = W < 640;
        const score = this._score();
        this._drawTitle('连接载体：DNA 连接酶封闭糖-磷酸骨架', '互补黏性末端先退火，DNA 连接酶再催化形成磷酸二酯键');
        const cx = compact ? W / 2 : W * 0.34;
        const cy = compact ? 180 : H * 0.45;
        const r = compact ? 62 : 88;
        this._drawPlasmid(cx, cy, r, '重组质粒', false);
        ctx.strokeStyle = 'rgba(96,165,250,.94)';
        ctx.lineWidth = compact ? 7 : 9;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(cx, cy, r, Math.PI * 1.90, Math.PI * 0.32);
        ctx.stroke();
        for (let i = 0; i < 5; i++) {
            const a = this.t * this.speed + i * 1.26;
            const x = cx + Math.cos(a) * (r + 24);
            const y = cy + Math.sin(a) * (r + 24);
            ctx.fillStyle = i % 2 ? 'rgba(251,191,36,.86)' : 'rgba(45,212,191,.86)';
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();
        }
        const panelX = compact ? 32 : W * 0.58;
        const panelY = compact ? 278 : 108;
        const panelW = compact ? W - 64 : W * 0.32;
        this._panel(panelX, panelY, panelW, compact ? 94 : 128, '连接效率', `根据当前末端匹配与连接酶活性，重组质粒形成指数约 ${Math.round(score.recomb)}%。实际实验还受 DNA 浓度、温度、片段方向和载体自连影响。`, 'rgba(251,191,36,.92)');
        this._drawBottomMetrics();
    },

    _drawTransform() {
        const { ctx, W, H } = this;
        const compact = W < 640;
        const score = this._score();
        this._drawTitle('转化筛选：让重组质粒进入宿主细胞', '感受态细菌吸收外源质粒；抗生素平板保留带有抗性标记的细胞');
        const y = compact ? 126 : H * 0.34;
        this._drawPlasmid(compact ? W * 0.24 : W * 0.18, y, compact ? 34 : 44, '质粒', false);
        this._arrow(compact ? W * 0.35 : W * 0.26, y, compact ? W * 0.55 : W * 0.48, y, 'rgba(251,191,36,.74)', '转化');
        const cellX = compact ? W * 0.70 : W * 0.58;
        for (let i = 0; i < 7; i++) {
            const px = cellX + Math.cos(i * 0.9 + this.t) * (compact ? 34 : 58);
            const py = y + Math.sin(i * 0.9 + this.t * 0.8) * (compact ? 28 : 46);
            this._cell(px, py, i % 3 === 0);
        }
        const plateX = compact ? W / 2 : W * 0.75;
        const plateY = compact ? 278 : H * 0.62;
        this._plate(plateX, plateY, compact ? 96 : 122, score.transform, false);
        this._panel(compact ? 32 : W * 0.08, compact ? 354 : H * 0.62, compact ? W - 64 : W * 0.34, compact ? 86 : 116, '筛选逻辑', '抗生素平板主要区分是否含有质粒；是否带有正确插入片段，还要结合报告基因或后续确认。', 'rgba(45,212,191,.92)');
        this._drawBottomMetrics();
    },

    _drawScreen() {
        const { W, H } = this;
        const compact = W < 640;
        const score = this._score();
        this._drawTitle('蓝白斑筛选：区分插入片段与空载体', '白色菌落常提示 lacZ 被插入片段破坏；蓝色菌落通常是 lacZ 仍完整的非重组载体');
        const cx = compact ? W / 2 : W * 0.38;
        const cy = compact ? 182 : H * 0.47;
        this._plate(cx, cy, compact ? 126 : 162, score.white, true);
        const panelX = compact ? 32 : W * 0.62;
        const panelY = compact ? 330 : 120;
        const panelW = compact ? W - 64 : W * 0.30;
        this._panel(panelX, panelY, panelW, compact ? 94 : 152, '蓝白斑筛选', '蓝白斑是筛选工具，不等于最终确认。白色菌落还应通过 PCR、酶切分析或测序确认插入片段是否正确。', 'rgba(96,165,250,.92)');
        this._drawBottomMetrics();
    },

    _drawExpress() {
        const { ctx, W, H } = this;
        const compact = W < 640;
        const score = this._score();
        this._drawTitle('表达验证：重组 DNA 不等于一定表达目标蛋白', '启动子、读码框、宿主系统和诱导条件都会影响蛋白表达');
        const cellX = compact ? W / 2 : W * 0.30;
        const cellY = compact ? 170 : H * 0.46;
        this._cell(cellX, cellY, true, compact ? 88 : 118);
        this._drawPlasmid(cellX - 22, cellY - 6, compact ? 28 : 36, 'pDNA', false);
        for (let i = 0; i < 5; i++) {
            const y = cellY - 54 + i * (compact ? 20 : 24);
            const x1 = cellX + 28;
            const x2 = cellX + 104 + Math.sin(this.t * this.speed + i) * 12;
            ctx.strokeStyle = i % 2 ? 'rgba(96,165,250,.88)' : 'rgba(45,212,191,.88)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(x1, y);
            ctx.quadraticCurveTo((x1 + x2) / 2, y - 14, x2, y);
            ctx.stroke();
            ctx.fillStyle = 'rgba(251,191,36,.88)';
            ctx.beginPath();
            ctx.arc(x2 + 10, y, 5, 0, Math.PI * 2);
            ctx.fill();
        }
        const panelX = compact ? 32 : W * 0.58;
        const panelY = compact ? 300 : 114;
        const panelW = compact ? W - 64 : W * 0.33;
        this._panel(panelX, panelY, panelW, compact ? 98 : 140, '表达指数', `当前诱导表达 ${Math.round(this.induction)}%，目标蛋白表达指数约 ${Math.round(score.expression)}%。真实表达需要合适启动子、宿主、读码框和检测方法。`, 'rgba(251,191,36,.92)');
        this._drawBottomMetrics();
    },

    _cell(x, y, hasPlasmid, size) {
        const { ctx } = this;
        const r = size ? size / 2 : 20;
        ctx.fillStyle = 'rgba(15,23,42,.78)';
        ctx.strokeStyle = hasPlasmid ? 'rgba(45,212,191,.9)' : 'rgba(148,163,184,.42)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.ellipse(x, y, r * 1.34, r, 0.12, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (hasPlasmid) {
            ctx.strokeStyle = 'rgba(251,191,36,.92)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x - r * 0.30, y, r * 0.32, 0, Math.PI * 2);
            ctx.stroke();
        }
    },

    _plate(cx, cy, r, whitePercent, showBlue) {
        const { ctx } = this;
        ctx.fillStyle = 'rgba(226,232,240,.10)';
        ctx.strokeStyle = 'rgba(226,232,240,.22)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * 0.66, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        const total = 26;
        for (let i = 0; i < total; i++) {
            const a = i * 2.399 + this.t * 0.05;
            const rr = r * 0.10 + (r * 0.50) * ((i * 37) % 100) / 100;
            const x = cx + Math.cos(a) * rr;
            const y = cy + Math.sin(a) * rr * 0.62;
            const isWhite = (i / total) * 100 < whitePercent;
            ctx.fillStyle = showBlue && !isWhite ? 'rgba(96,165,250,.88)' : 'rgba(248,250,252,.92)';
            ctx.strokeStyle = isWhite ? 'rgba(203,213,225,.62)' : 'rgba(96,165,250,.9)';
            ctx.beginPath();
            ctx.arc(x, y, Math.max(3, r * 0.045), 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
        ctx.font = this._font('700', 12);
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(226,232,240,.88)';
        ctx.fillText(showBlue ? 'X-gal + 抗生素平板' : '抗生素平板', cx, cy + r * 0.86);
    },

    _drawBottomMetrics() {
        const { W, H } = this;
        const score = this._score();
        const y = H - 74;
        const w = (W - 72) / 3;
        this._metric(28, y, w, '重组指数', Math.round(score.recomb) + '%', 'rgba(45,212,191,.95)');
        this._metric(40 + w, y, w, '候选白斑', Math.round(score.white) + '%', 'rgba(96,165,250,.95)');
        this._metric(52 + w * 2, y, w, '表达指数', Math.round(score.expression) + '%', 'rgba(251,191,36,.95)');
    },

    _draw() {
        if (!this.ctx) return;
        this._drawBg();
        if (this.mode === 'ligate') this._drawLigate();
        else if (this.mode === 'transform') this._drawTransform();
        else if (this.mode === 'screen') this._drawScreen();
        else if (this.mode === 'express') this._drawExpress();
        else this._drawCut();
    },

    _injectInfoPanel() {
        const el = document.getElementById('gene-engineering-info');
        if (!el) return;
        el.innerHTML = `
            <div class="geng-info__hd">基因工程知识点</div>
            <div class="geng-info__grid">
                <div class="geng-info__block">
                    <div class="geng-info__sub">当前观察</div>
                    <div id="geng-mode-title" class="geng-info__val"></div>
                    <div id="geng-mode-desc" class="geng-info__desc"></div>
                </div>
                <div class="geng-info__block">
                    <div class="geng-info__sub">观察顺序</div>
                    <div class="geng-info__row"><span class="geng-info__key" style="--c:#f87171">构建</span>目的片段与载体用相容末端连接。</div>
                    <div class="geng-info__row"><span class="geng-info__key" style="--c:#2dd4bf">筛选</span>抗性和报告基因先找候选菌落。</div>
                    <div class="geng-info__row"><span class="geng-info__key" style="--c:#fbbf24">确认</span>PCR、酶切分析或测序判断插入是否正确。</div>
                </div>
                <div class="geng-info__block">
                    <div class="geng-info__sub">核心工具</div>
                    <div class="geng-info__row"><span class="geng-info__key" style="--c:#f87171">限制酶</span>识别特定位点并切开 DNA。</div>
                    <div class="geng-info__row"><span class="geng-info__key" style="--c:#fbbf24">连接酶</span>连接 DNA 片段的糖-磷酸骨架。</div>
                    <div class="geng-info__row"><span class="geng-info__key" style="--c:#2dd4bf">质粒</span>常带复制起点、抗性标记、多克隆位点和报告基因。</div>
                </div>
                <div class="geng-info__block">
                    <div class="geng-info__sub">模型读数</div>
                    <div id="geng-readout" class="geng-info__desc"></div>
                </div>
                <div class="geng-info__block">
                    <div class="geng-info__sub">模型边界</div>
                    <div class="geng-info__note">这里展示的是分子克隆的概念流程；数值为教学指数，不代表真实实验成功率，也不构成实验操作方案。</div>
                </div>
            </div>
            <div class="geng-info__source">资料依据：OpenStax Biology 2e 17.1、OpenStax Microbiology 12.1、NHGRI Genetic Engineering。</div>
        `;
        this._updateInfo();
    },

    _updateInfo() {
        const mode = this.modes.find(item => item.key === this.mode) || this.modes[0];
        const title = document.getElementById('geng-mode-title');
        const desc = document.getElementById('geng-mode-desc');
        const readout = document.getElementById('geng-readout');
        if (title) title.textContent = mode.label;
        if (desc) desc.textContent = mode.desc;
        if (readout) {
            const score = this._score();
            readout.textContent = `末端匹配 ${Math.round(this.enzymeMatch)}% · 重组指数 ${Math.round(score.recomb)}% · 候选白斑约 ${Math.round(score.white)}% · 目标表达指数约 ${Math.round(score.expression)}%。抗性和颜色筛选之后，仍要确认插入片段。`;
        }
    },

    _loop() {
        this.t = performance.now() / 1000;
        this._draw();
        this._updateInfo();
        this.animId = requestAnimationFrame(() => this._loop());
    }
};

function initGeneEngineering() {
    GeneEngineering.init();
}

window.GeneEngineering = GeneEngineering;
window.initGeneEngineering = initGeneEngineering;
