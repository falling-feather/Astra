/* Homeostasis: set point, negative feedback, glucose and temperature regulation */
const Homeostasis = {
    canvas: null,
    ctx: null,
    W: 0,
    H: 0,
    animId: null,
    _listeners: [],
    _ro: null,
    mode: 'glucose',
    disturbance: 55,
    speed: 1,
    glucose: 145,
    bodyTemp: 38.2,
    t: 0,
    modes: [
        {
            key: 'glucose',
            label: '血糖调节',
            desc: '血糖高于范围时，胰岛 β 细胞释放胰岛素，促进细胞摄取葡萄糖并储存为糖原；低于范围时，α 细胞释放胰高血糖素，使血糖回升。'
        },
        {
            key: 'temperature',
            label: '体温调节',
            desc: '下丘脑整合皮肤和体内温度信息；过热时皮肤血管舒张、出汗增强，过冷时血管收缩、寒战和代谢产热增强。'
        },
        {
            key: 'feedback',
            label: '负反馈链',
            desc: '感受器检测偏离，调节中枢比较设定点和正常范围，效应器产生反向响应，把变量拉回适宜范围。'
        },
        {
            key: 'positive',
            label: '正反馈',
            desc: '正反馈会继续放大变化，常见于分娩和凝血等有明确终止点的过程，不负责长期维持稳定状态。'
        }
    ],

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        if (this.canvas) this.destroy();
        this.canvas = document.getElementById('homeostasis-canvas');
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
        const ctrl = document.getElementById('homeostasis-controls');
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
        const ctrl = document.getElementById('homeostasis-controls');
        if (!ctrl) return;
        ctrl.innerHTML = '';

        const modeWrap = document.createElement('div');
        modeWrap.className = 'homeo-mode-btns';
        modeWrap.setAttribute('role', 'group');
        modeWrap.setAttribute('aria-label', '稳态观察模式');
        this.modes.forEach(item => {
            const b = document.createElement('button');
            b.className = 'homeo-btn' + (item.key === this.mode ? ' active' : '');
            b.type = 'button';
            b.dataset.mode = item.key;
            b.textContent = item.label;
            b.setAttribute('aria-pressed', item.key === this.mode ? 'true' : 'false');
            this._on(b, 'click', () => {
                this.mode = item.key;
                modeWrap.querySelectorAll('.homeo-btn').forEach(btn => {
                    btn.classList.toggle('active', btn === b);
                    btn.setAttribute('aria-pressed', btn === b ? 'true' : 'false');
                });
                this._resetState();
                this._updateInfo();
            });
            modeWrap.appendChild(b);
        });
        ctrl.appendChild(modeWrap);

        const sliders = document.createElement('div');
        sliders.className = 'homeo-sliders';
        const disturbance = document.createElement('label');
        disturbance.className = 'homeo-slider';
        const disValue = document.createElement('span');
        disValue.className = 'homeo-slider__value';
        disValue.textContent = this.disturbance > 0 ? `+${this.disturbance}` : String(this.disturbance);
        const disInput = document.createElement('input');
        disInput.type = 'range';
        disInput.min = -80;
        disInput.max = 120;
        disInput.step = 5;
        disInput.value = this.disturbance;
        this._on(disInput, 'input', () => {
            this.disturbance = parseFloat(disInput.value);
            disValue.textContent = this.disturbance > 0 ? `+${this.disturbance}` : String(this.disturbance);
            this._resetState();
        });
        disturbance.append('扰动', disInput, disValue);
        sliders.appendChild(disturbance);

        const speed = document.createElement('label');
        speed.className = 'homeo-slider';
        const spValue = document.createElement('span');
        spValue.className = 'homeo-slider__value';
        spValue.textContent = this.speed.toFixed(1) + 'x';
        const spInput = document.createElement('input');
        spInput.type = 'range';
        spInput.min = 0.4;
        spInput.max = 2.5;
        spInput.step = 0.1;
        spInput.value = this.speed;
        this._on(spInput, 'input', () => {
            this.speed = parseFloat(spInput.value);
            spValue.textContent = this.speed.toFixed(1) + 'x';
        });
        speed.append('速度', spInput, spValue);
        sliders.appendChild(speed);

        ctrl.appendChild(sliders);
    },

    _resetState() {
        if (this.mode === 'temperature') {
            this.bodyTemp = 37 + this.disturbance / 60;
        } else {
            this.glucose = 90 + this.disturbance;
        }
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

    _drawBg() {
        const { ctx, W, H } = this;
        ctx.clearRect(0, 0, W, H);
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, 'rgba(6, 95, 70, 0.13)');
        g.addColorStop(0.52, 'rgba(14, 116, 144, 0.06)');
        g.addColorStop(1, 'rgba(129, 140, 248, 0.09)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.10)';
        ctx.lineWidth = 1;
        for (let y = 54; y < H - 28; y += 34) {
            ctx.beginPath();
            ctx.moveTo(34, y);
            ctx.lineTo(W - 34, y);
            ctx.stroke();
        }
    },

    _drawTitle(title, subtitle) {
        const { ctx, W } = this;
        ctx.fillStyle = 'rgba(226, 232, 240, 0.94)';
        this._fitText(title, W / 2, 30, W - 36, Math.max(18, W * 0.026), 16, '700');
        ctx.fillStyle = 'rgba(148, 163, 184, 0.78)';
        this._fitText(subtitle, W / 2, 52, W - 36, Math.max(12, W * 0.013), 10, '');
    },

    _drawCard(x, y, w, h, title, body, color) {
        const { ctx } = this;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.54)';
        ctx.strokeStyle = color || 'rgba(45, 212, 191, 0.35)';
        ctx.lineWidth = 1.2;
        this._roundRect(x, y, w, h, 8);
        ctx.fill();
        ctx.stroke();
        ctx.font = this._font('700', 14);
        ctx.fillStyle = color || 'rgba(45, 212, 191, 0.9)';
        ctx.textAlign = 'left';
        ctx.fillText(title, x + 14, y + 24);
        ctx.font = this._font('', 12);
        ctx.fillStyle = 'rgba(203, 213, 225, 0.72)';
        this._wrapText(body, x + 14, y + 46, w - 28, 18);
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

    _wrapText(text, x, y, maxWidth, lineHeight) {
        const { ctx } = this;
        let line = '';
        let yy = y;
        for (const char of text) {
            const test = line + char;
            if (ctx.measureText(test).width > maxWidth && line) {
                ctx.fillText(line, x, yy);
                line = char;
                yy += lineHeight;
            } else {
                line = test;
            }
        }
        if (line) ctx.fillText(line, x, yy);
    },

    _arrow(x1, y1, x2, y2, color) {
        const { ctx } = this;
        const angle = Math.atan2(y2 - y1, x2 - x1);
        ctx.strokeStyle = color || 'rgba(45, 212, 191, 0.64)';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.fillStyle = color || 'rgba(45, 212, 191, 0.64)';
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - 9 * Math.cos(angle - 0.45), y2 - 9 * Math.sin(angle - 0.45));
        ctx.lineTo(x2 - 9 * Math.cos(angle + 0.45), y2 - 9 * Math.sin(angle + 0.45));
        ctx.closePath();
        ctx.fill();
    },

    _gauge(cx, cy, r, min, max, value, label, unit, color) {
        const { ctx } = this;
        const start = Math.PI * 0.78;
        const end = Math.PI * 2.22;
        const p = Math.max(0, Math.min(1, (value - min) / (max - min)));
        ctx.lineWidth = 15;
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
        ctx.beginPath();
        ctx.arc(cx, cy, r, start, end);
        ctx.stroke();
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(cx, cy, r, start, start + (end - start) * p);
        ctx.stroke();
        const angle = start + (end - start) * p;
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.82)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(angle) * (r - 8), cy + Math.sin(angle) * (r - 8));
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(226, 232, 240, 0.92)';
        ctx.fill();
        ctx.fillStyle = 'rgba(226, 232, 240, 0.94)';
        this._fitText(value.toFixed(unit === '℃' ? 1 : 0) + unit, cx, cy + r * 0.52, r * 1.55, 24, 16, '700');
        ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
        this._fitText(label, cx, cy + r * 0.78, r * 1.85, 13, 10, '');
    },

    _drawSetBand(x, y, w, h, center, range, min, max, label) {
        const { ctx } = this;
        const top = y + h - ((center + range - min) / (max - min)) * h;
        const bottom = y + h - ((center - range - min) / (max - min)) * h;
        ctx.fillStyle = 'rgba(45, 212, 191, 0.10)';
        ctx.fillRect(x, top, w, bottom - top);
        ctx.strokeStyle = 'rgba(45, 212, 191, 0.34)';
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.moveTo(x, (top + bottom) / 2);
        ctx.lineTo(x + w, (top + bottom) / 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = this._font('600', 12);
        ctx.fillStyle = 'rgba(45, 212, 191, 0.92)';
        ctx.textAlign = 'left';
        ctx.fillText(label, x + 8, top - 8);
    },

    _drawGlucose() {
        const { ctx, W, H } = this;
        this._drawTitle('血糖负反馈调节', '血糖偏高/偏低时，胰岛激素帮助变量回到设定范围');
        const target = 90;
        const dt = 0.018 * this.speed;
        this.glucose += (target - this.glucose) * dt;
        const high = this.glucose > target + 12;
        const low = this.glucose < target - 12;
        const color = high ? 'rgba(251, 191, 36, 0.95)' : low ? 'rgba(96, 165, 250, 0.95)' : 'rgba(45, 212, 191, 0.95)';
        this._gauge(W * 0.28, H * 0.48, Math.min(W, H) * 0.21, 40, 180, this.glucose, '血糖教学模型', ' mg/dL', color);
        const x = W * 0.54;
        const y = H * 0.20;
        const boxW = W * 0.36;
        this._drawCard(x, y, boxW, 72, '感受器', '胰岛细胞直接感知血糖变化，并把变化转化为激素释放。', 'rgba(96, 165, 250, 0.75)');
        this._drawCard(x, y + 92, boxW, 84, high ? '高血糖响应' : low ? '低血糖响应' : '接近设定点', high ? 'β 细胞释放胰岛素，促进肌肉、脂肪和肝细胞摄取或储存葡萄糖。' : low ? 'α 细胞释放胰高血糖素，促进肝糖原分解和糖异生。' : '激素分泌维持在基础水平，变量只在适宜范围内小幅波动。', color);
        this._drawCard(x, y + 196, boxW, 78, '效应结果', '调节方向与偏离方向相反，因此属于负反馈。', 'rgba(45, 212, 191, 0.75)');
        this._arrow(x + boxW / 2, y + 72, x + boxW / 2, y + 92, color);
        this._arrow(x + boxW / 2, y + 176, x + boxW / 2, y + 196, color);
        ctx.font = this._font('600', 13);
        ctx.fillStyle = 'rgba(45, 212, 191, 0.9)';
        ctx.textAlign = 'center';
        ctx.fillText('设定点附近', W * 0.28, H * 0.76);
    },

    _drawTemperature() {
        const { ctx, W, H } = this;
        this._drawTitle('体温负反馈调节', '下丘脑整合温度信号，启动散热或产热反应');
        const target = 37;
        this.bodyTemp += (target - this.bodyTemp) * 0.014 * this.speed;
        const hot = this.bodyTemp > 37.4;
        const cold = this.bodyTemp < 36.6;
        const color = hot ? 'rgba(248, 113, 113, 0.95)' : cold ? 'rgba(96, 165, 250, 0.95)' : 'rgba(45, 212, 191, 0.95)';
        this._gauge(W * 0.28, H * 0.48, Math.min(W, H) * 0.21, 34.5, 40.5, this.bodyTemp, '核心体温教学模型', '℃', color);
        const panelX = W * 0.52;
        const panelY = H * 0.19;
        this._drawCard(panelX, panelY, W * 0.38, 76, '调节中枢', '下丘脑比较当前温度与设定点。', 'rgba(129, 140, 248, 0.78)');
        this._drawCard(panelX, panelY + 96, W * 0.38, 86, hot ? '过热响应' : cold ? '过冷响应' : '稳定范围', hot ? '皮肤血管舒张、汗腺分泌增加，蒸发和辐射散热增强。' : cold ? '皮肤血管收缩、寒战和代谢产热增加，减少散热。' : '产热与散热保持动态平衡。', color);
        this._drawCard(panelX, panelY + 204, W * 0.38, 72, '反馈结果', '体温变化被反向调节，回到接近 37℃ 的范围。', 'rgba(45, 212, 191, 0.75)');
        this._arrow(panelX + W * 0.19, panelY + 76, panelX + W * 0.19, panelY + 96, color);
        this._arrow(panelX + W * 0.19, panelY + 182, panelX + W * 0.19, panelY + 204, color);
    },

    _drawFeedback() {
        const { ctx, W, H } = this;
        this._drawTitle('负反馈的通用结构', '变量偏离越大，反向调节越明显；回到范围后响应减弱');
        const cx = W / 2;
        const cy = H * 0.52;
        const r = Math.min(W, H) * 0.27;
        const nodes = [
            { a: -Math.PI / 2, title: '变量偏离', body: '血糖升高 / 体温降低', color: 'rgba(251, 191, 36, 0.9)' },
            { a: 0, title: '感受器', body: '检测变化', color: 'rgba(96, 165, 250, 0.9)' },
            { a: Math.PI / 2, title: '调节中枢', body: '比较设定点', color: 'rgba(129, 140, 248, 0.9)' },
            { a: Math.PI, title: '效应器', body: '产生反向响应', color: 'rgba(45, 212, 191, 0.9)' }
        ];
        nodes.forEach((n, i) => {
            const x = cx + Math.cos(n.a) * r;
            const y = cy + Math.sin(n.a) * r;
            const next = nodes[(i + 1) % nodes.length];
            const nx = cx + Math.cos(next.a) * r;
            const ny = cy + Math.sin(next.a) * r;
            this._arrow(x + Math.cos(next.a - n.a) * 36, y + Math.sin(next.a - n.a) * 22, nx - Math.cos(next.a - n.a) * 44, ny - Math.sin(next.a - n.a) * 22, 'rgba(45, 212, 191, 0.55)');
        });
        nodes.forEach(n => {
            const x = cx + Math.cos(n.a) * r;
            const y = cy + Math.sin(n.a) * r;
            this._drawCard(x - 82, y - 42, 164, 84, n.title, n.body, n.color);
        });
        ctx.font = this._font('700', 16);
        ctx.fillStyle = 'rgba(226, 232, 240, 0.92)';
        ctx.textAlign = 'center';
        ctx.fillText('设定点 set point', cx, cy - 8);
        ctx.font = this._font('', 12);
        ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
        ctx.fillText('稳态是动态平衡，不是数值永远不变', cx, cy + 16);
    },

    _drawPositive() {
        const { ctx, W, H } = this;
        this._drawTitle('正反馈用于放大过程', '它会加强原有变化，通常需要终止事件来停止');
        const x = W * 0.12;
        const y = H * 0.20;
        const w = W * 0.76;
        const h = H * 0.58;
        const amp = Math.min(1, 0.18 + (Math.sin(this.t * 1.4) + 1) * 0.35);
        ctx.strokeStyle = 'rgba(248, 113, 113, 0.25)';
        ctx.lineWidth = 16;
        ctx.beginPath();
        ctx.arc(x + w * 0.5, y + h * 0.48, Math.min(w, h) * 0.30 + amp * 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(248, 113, 113, 0.85)';
        ctx.beginPath();
        ctx.arc(x + w * 0.5, y + h * 0.48, Math.min(w, h) * 0.30 + amp * 14, -0.4, Math.PI * 1.55);
        ctx.stroke();
        this._arrow(x + w * 0.78, y + h * 0.24, x + w * 0.76, y + h * 0.22, 'rgba(248, 113, 113, 0.85)');
        this._drawCard(x, y + h * 0.08, w * 0.33, 94, '刺激增强', '子宫收缩或凝血启动后，会进一步促进同类反应。', 'rgba(248, 113, 113, 0.9)');
        this._drawCard(x + w * 0.34, y + h * 0.36, w * 0.32, 94, '信号放大', '更多激素或凝血因子被释放，变化被继续放大。', 'rgba(251, 191, 36, 0.9)');
        this._drawCard(x + w * 0.67, y + h * 0.08, w * 0.33, 94, '终止事件', '婴儿出生或血管破口封闭后，正反馈过程结束。', 'rgba(45, 212, 191, 0.9)');
        ctx.font = this._font('700', 15);
        ctx.fillStyle = 'rgba(226, 232, 240, 0.92)';
        ctx.textAlign = 'center';
        ctx.fillText('正反馈不是维持长期稳态的主要方式', W / 2, y + h + 30);
    },

    _draw() {
        if (!this.ctx) return;
        this._drawBg();
        if (this.mode === 'glucose') this._drawGlucose();
        else if (this.mode === 'temperature') this._drawTemperature();
        else if (this.mode === 'feedback') this._drawFeedback();
        else this._drawPositive();
    },

    _injectInfoPanel() {
        const el = document.getElementById('homeostasis-info');
        if (!el) return;
        el.innerHTML = `
            <div class="homeo-info__hd">内环境稳态知识点</div>
            <div class="homeo-info__grid">
                <div class="homeo-info__block">
                    <div class="homeo-info__sub">当前观察</div>
                    <div id="homeo-mode-title" class="homeo-info__val"></div>
                    <div id="homeo-mode-desc" class="homeo-info__desc"></div>
                </div>
                <div class="homeo-info__block">
                    <div class="homeo-info__sub">判读顺序</div>
                    <div class="homeo-info__row"><span class="homeo-info__key" style="--c:#60a5fa">变量</span>先判断血糖或体温偏离方向。</div>
                    <div class="homeo-info__row"><span class="homeo-info__key" style="--c:#818cf8">通路</span>再找感受器、调节中枢和效应器。</div>
                    <div class="homeo-info__row"><span class="homeo-info__key" style="--c:#2dd4bf">结果</span>最后看响应是否抵消偏离。</div>
                </div>
                <div class="homeo-info__block">
                    <div class="homeo-info__sub">结构模型</div>
                    <div class="homeo-info__row"><span class="homeo-info__key" style="--c:#60a5fa">感受器</span>检测偏离并传递信息。</div>
                    <div class="homeo-info__row"><span class="homeo-info__key" style="--c:#818cf8">调节中枢</span>比较设定点和正常范围。</div>
                    <div class="homeo-info__row"><span class="homeo-info__key" style="--c:#2dd4bf">效应器</span>执行反向调节或放大过程。</div>
                </div>
                <div class="homeo-info__block">
                    <div class="homeo-info__sub">模型边界</div>
                    <div class="homeo-info__note">数值和回归速度为教学模型，只帮助判断反馈方向；真实稳态会受饮食、运动、昼夜节律、疾病和药物等因素影响，不用于医学判断。</div>
                </div>
            </div>
            <div class="homeo-info__source">参考 OpenStax Biology 2e 33.3 Homeostasis、OpenStax Anatomy and Physiology 2e 1.5 Homeostasis 与 17.9 The Endocrine Pancreas。</div>
        `;
        this._updateInfo();
    },

    _updateInfo() {
        const mode = this.modes.find(item => item.key === this.mode) || this.modes[0];
        const title = document.getElementById('homeo-mode-title');
        const desc = document.getElementById('homeo-mode-desc');
        if (title) title.textContent = mode.label;
        if (desc) desc.textContent = mode.desc;
    },

    _loop() {
        this.t = performance.now() / 1000;
        this._draw();
        this.animId = requestAnimationFrame(() => this._loop());
    }
};

function initHomeostasis() {
    Homeostasis.init();
}

window.Homeostasis = Homeostasis;
