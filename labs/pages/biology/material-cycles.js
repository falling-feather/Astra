/* Ecosystem Material Cycles: carbon, nitrogen and greenhouse-effect teaching model */
const MaterialCycles = {
    canvas: null,
    ctx: null,
    W: 0,
    H: 0,
    animId: null,
    _listeners: [],
    _ro: null,
    mode: 'carbon',
    carbonRelease: 42,
    carbonUptake: 62,
    fertilizer: 28,
    speed: 1,
    t: 0,
    particles: [],
    modes: [
        {
            key: 'carbon',
            label: '碳循环',
            desc: '观察 CO2 如何通过光合作用进入生物群落，又通过呼吸、分解、海气交换、火山活动和燃烧回到无机环境。'
        },
        {
            key: 'nitrogen',
            label: '氮循环',
            desc: '追踪 N2 固氮、铵化、硝化、反硝化和肥料径流，理解细菌、真菌等微生物在氮循环中的核心作用。'
        },
        {
            key: 'greenhouse',
            label: '温室效应',
            desc: '用简化能量收支看太阳短波进入、地表红外辐射外逸，以及温室气体吸收并再辐射部分红外能量。'
        },
        {
            key: 'compare',
            label: '能量 vs 物质',
            desc: '能量沿营养级单向流动并以热散失；物质在生物群落和无机环境之间循环利用。'
        }
    ],

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        if (this.canvas) this.destroy();
        this.canvas = document.getElementById('cycles-canvas');
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
        const ctrl = document.getElementById('cycles-controls');
        if (ctrl) ctrl.innerHTML = '';
        this.canvas = null;
        this.ctx = null;
    },

    _resize() {
        if (!this.canvas || !this.canvas.parentElement || !this.ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const w = this.canvas.parentElement.getBoundingClientRect().width;
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
        const ctrl = document.getElementById('cycles-controls');
        if (!ctrl) return;
        ctrl.innerHTML = '';

        const modes = document.createElement('div');
        modes.className = 'cycles-mode-btns';
        modes.setAttribute('role', 'group');
        modes.setAttribute('aria-label', '生态系统物质循环观察模式');
        this.modes.forEach(item => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'cycles-btn' + (item.key === this.mode ? ' active' : '');
            btn.dataset.mode = item.key;
            btn.textContent = item.label;
            btn.setAttribute('aria-pressed', item.key === this.mode ? 'true' : 'false');
            this._on(btn, 'click', () => {
                this.mode = item.key;
                modes.querySelectorAll('.cycles-btn').forEach(b => {
                    b.classList.toggle('active', b === btn);
                    b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
                });
                this._updateInfo();
            });
            modes.appendChild(btn);
        });

        const sliders = document.createElement('div');
        sliders.className = 'cycles-sliders';
        sliders.appendChild(this._makeSlider('化石碳释放', '%', 0, 100, 5, 'carbonRelease'));
        sliders.appendChild(this._makeSlider('光合/海洋吸收', '%', 20, 100, 5, 'carbonUptake'));
        sliders.appendChild(this._makeSlider('肥料径流', '%', 0, 100, 5, 'fertilizer'));
        sliders.appendChild(this._makeSlider('速度', 'x', 0.4, 2.5, 0.1, 'speed'));
        ctrl.append(modes, sliders);
    },

    _makeSlider(labelText, unit, min, max, step, prop) {
        const label = document.createElement('label');
        label.className = 'cycles-slider';
        const caption = document.createElement('span');
        caption.textContent = labelText;
        const input = document.createElement('input');
        input.type = 'range';
        input.min = min;
        input.max = max;
        input.step = step;
        input.value = this[prop];
        const value = document.createElement('span');
        value.className = 'cycles-slider__value';
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
        if (unit === 'x') return value.toFixed(1) + unit;
        return Math.round(value) + unit;
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
        let count = 0;
        for (let i = 0; i < chars.length; i++) {
            if (maxLines && count >= maxLines) return;
            const ch = chars[i];
            const next = line + ch;
            if (ctx.measureText(next).width > maxWidth && line) {
                ctx.fillText(line, x, y + count * lineHeight);
                line = ch;
                count += 1;
            } else {
                line = next;
            }
            if (i === chars.length - 1 && line && (!maxLines || count < maxLines)) {
                ctx.fillText(line, x, y + count * lineHeight);
            }
        }
    },

    _drawBg() {
        const { ctx, W, H } = this;
        ctx.clearRect(0, 0, W, H);
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, 'rgba(13, 148, 136, 0.11)');
        g.addColorStop(0.48, 'rgba(37, 99, 235, 0.06)');
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
        this._fitText(title, W / 2, 30, W - 36, Math.max(18, Math.min(24, W * 0.03)), 15, '700');
        ctx.fillStyle = 'rgba(148, 163, 184, 0.84)';
        this._fitText(subtitle, W / 2, 52, W - 44, 12, 10, '');
    },

    _node(x, y, w, h, title, body, color) {
        const { ctx } = this;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.64)';
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.15;
        this._roundRect(x, y, w, h, 9);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = color;
        this._fitText(title, x + 12, y + 22, w - 24, 13, 10, '700', 'left');
        ctx.font = this._font('', 11.5);
        ctx.fillStyle = 'rgba(203, 213, 225, 0.76)';
        this._wrapText(body, x + 12, y + 43, w - 24, 16, Math.max(1, Math.floor((h - 46) / 16)));
    },

    _arrow(x1, y1, x2, y2, color, label) {
        const { ctx } = this;
        const angle = Math.atan2(y2 - y1, x2 - x1);
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 2.2;
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
            ctx.fillStyle = 'rgba(226,232,240,.86)';
            this._fitText(label, (x1 + x2) / 2, (y1 + y2) / 2 - 8, Math.abs(x2 - x1) + 42, 11, 9, '600');
        }
    },

    _curveArrow(x1, y1, cx, cy, x2, y2, color, label) {
        const { ctx } = this;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(cx, cy, x2, y2);
        ctx.stroke();
        const angle = Math.atan2(y2 - cy, x2 - cx);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - Math.cos(angle - 0.55) * 10, y2 - Math.sin(angle - 0.55) * 10);
        ctx.lineTo(x2 - Math.cos(angle + 0.55) * 10, y2 - Math.sin(angle + 0.55) * 10);
        ctx.closePath();
        ctx.fill();
        if (label) {
            ctx.fillStyle = 'rgba(226,232,240,.86)';
            this._fitText(label, cx, cy - 6, 120, 11, 9, '600');
        }
    },

    _metric(x, y, w, label, value, color) {
        const { ctx } = this;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.56)';
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
        this._roundRect(x, y, w, 58, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(148, 163, 184, 0.82)';
        this._fitText(label, x + 12, y + 20, w - 24, 12, 10, '', 'left');
        ctx.fillStyle = color;
        this._fitText(value, x + 12, y + 43, w - 24, 17, 12, '700', 'left');
    },

    _spawnParticles(points, color, countScale) {
        if (Math.random() > 0.45 * this.speed * countScale) return;
        const path = points[Math.floor(Math.random() * points.length)];
        this.particles.push({ path, color, p: 0, speed: 0.006 + Math.random() * 0.012 });
        if (this.particles.length > 120) this.particles.shift();
    },

    _drawParticles(dt) {
        const { ctx } = this;
        this.particles = this.particles.filter(part => {
            part.p += part.speed * dt * this.speed;
            if (part.p > 1) return false;
            const p = part.path;
            let x;
            let y;
            if (p.length === 4) {
                x = p[0] + (p[2] - p[0]) * part.p;
                y = p[1] + (p[3] - p[1]) * part.p;
            } else {
                const t = part.p;
                x = (1 - t) * (1 - t) * p[0] + 2 * (1 - t) * t * p[2] + t * t * p[4];
                y = (1 - t) * (1 - t) * p[1] + 2 * (1 - t) * t * p[3] + t * t * p[5];
            }
            ctx.fillStyle = part.color;
            ctx.beginPath();
            ctx.arc(x, y, 3.5, 0, Math.PI * 2);
            ctx.fill();
            return true;
        });
    },

    _drawCarbon(dt) {
        const { W, H } = this;
        const compact = W < 640;
        this._drawTitle('碳循环：快速生物循环与慢速地质循环', 'CO2 通过光合作用进入生物群落，也通过呼吸、分解和燃烧回到大气');
        const top = 78;
        if (compact) {
            this._node(28, top, W - 56, 58, '大气 / 水体 CO2', '海气交换、火山活动、呼吸和燃烧会改变 CO2 库。', 'rgba(96,165,250,.92)');
            this._node(28, top + 88, W * 0.42, 70, '生产者', '光合作用把 CO2 固定为有机物。', 'rgba(45,212,191,.92)');
            this._node(W * 0.53, top + 88, W * 0.39, 70, '消费者', '取食获得有机碳，呼吸释放 CO2。', 'rgba(251,191,36,.92)');
            this._node(28, top + 190, W * 0.42, 76, '土壤 / 分解者', '死亡残体经分解进入土壤碳库。', 'rgba(167,139,250,.90)');
            this._node(W * 0.53, top + 190, W * 0.39, 76, '化石燃料', '形成极慢，燃烧会快速释放古老碳。', 'rgba(248,113,113,.90)');
        } else {
            const atm = { x: W * 0.34, y: top, w: W * 0.32, h: 72 };
            const prod = { x: W * 0.08, y: H * 0.42, w: W * 0.22, h: 82 };
            const cons = { x: W * 0.39, y: H * 0.42, w: W * 0.22, h: 82 };
            const soil = { x: W * 0.70, y: H * 0.42, w: W * 0.22, h: 82 };
            const fossil = { x: W * 0.20, y: H * 0.75, w: W * 0.24, h: 76 };
            const ocean = { x: W * 0.56, y: H * 0.75, w: W * 0.24, h: 76 };
            this._node(atm.x, atm.y, atm.w, atm.h, '大气 CO2', '大气与海洋、水体和生物群落不断交换碳。', 'rgba(96,165,250,.92)');
            this._node(prod.x, prod.y, prod.w, prod.h, '生产者', '光合作用固定 CO2，形成有机碳。', 'rgba(45,212,191,.92)');
            this._node(cons.x, cons.y, cons.w, cons.h, '消费者', '取食转移有机碳，呼吸释放 CO2。', 'rgba(251,191,36,.92)');
            this._node(soil.x, soil.y, soil.w, soil.h, '土壤 / 分解者', '分解和土壤储存连接快速碳循环。', 'rgba(167,139,250,.90)');
            this._node(fossil.x, fossil.y, fossil.w, fossil.h, '化石燃料', '形成需百万年尺度，属于慢速碳库。', 'rgba(248,113,113,.90)');
            this._node(ocean.x, ocean.y, ocean.w, ocean.h, '海洋 / 碳酸盐', 'CO2 溶解后可形成碳酸氢盐与碳酸盐沉积。', 'rgba(56,189,248,.88)');
            this._curveArrow(atm.x + 10, atm.y + atm.h, prod.x + prod.w * 0.45, H * 0.28, prod.x + prod.w * 0.48, prod.y, 'rgba(45,212,191,.78)', '光合作用');
            this._arrow(prod.x + prod.w, prod.y + 38, cons.x, cons.y + 38, 'rgba(251,191,36,.76)', '取食');
            this._arrow(cons.x + cons.w, cons.y + 42, soil.x, soil.y + 42, 'rgba(167,139,250,.72)', '残体/粪便');
            this._curveArrow(cons.x + cons.w * 0.52, cons.y, W * 0.50, H * 0.23, atm.x + atm.w * 0.64, atm.y + atm.h, 'rgba(96,165,250,.74)', '呼吸');
            this._curveArrow(soil.x + 10, soil.y, W * 0.70, H * 0.22, atm.x + atm.w, atm.y + atm.h * 0.68, 'rgba(96,165,250,.64)', '分解');
            this._arrow(fossil.x + fossil.w * 0.62, fossil.y, atm.x + 24, atm.y + atm.h, 'rgba(248,113,113,.78)', '燃烧');
            this._arrow(ocean.x + ocean.w * 0.45, ocean.y, atm.x + atm.w - 18, atm.y + atm.h, 'rgba(56,189,248,.72)', '海气交换');
        }
        const co2Index = this._clamp(100 + this.carbonRelease * 1.2 - this.carbonUptake * 0.62, 50, 190);
        const y = H - 74;
        const w = (W - 72) / 3;
        this._metric(28, y, w, 'CO2 教学指数', Math.round(co2Index).toString(), 'rgba(96,165,250,.95)');
        this._metric(40 + w, y, w, '化石碳释放', Math.round(this.carbonRelease) + '%', 'rgba(248,113,113,.95)');
        this._metric(52 + w * 2, y, w, '吸收/固定', Math.round(this.carbonUptake) + '%', 'rgba(45,212,191,.95)');
        if (!compact) {
            this._spawnParticles([[W * 0.44, top + 72, W * 0.20, H * 0.42], [W * 0.56, H * 0.42, W * 0.49, top + 72]], 'rgba(45,212,191,.88)', 1);
            this._spawnParticles([[W * 0.32, H * 0.75, W * 0.41, top + 72], [W * 0.74, H * 0.75, W * 0.63, top + 72]], 'rgba(248,113,113,.86)', 0.8);
            this._drawParticles(dt);
        }
    },

    _drawNitrogen(dt) {
        const { ctx, W, H } = this;
        const compact = W < 640;
        this._drawTitle('氮循环：微生物把 N2 接入生命系统', '固氮、铵化、硝化、反硝化让氮在大气、土壤、水体和生物之间转换');
        const centerX = W / 2;
        const centerY = compact ? H * 0.45 : H * 0.47;
        const radius = Math.min(W, H) * (compact ? 0.25 : 0.28);
        const steps = [
            { label: 'N2 大气氮', sub: '78% 大气成分', a: -Math.PI / 2, c: 'rgba(96,165,250,.95)' },
            { label: '固氮', sub: '细菌/蓝细菌', a: -0.16, c: 'rgba(45,212,191,.95)' },
            { label: 'NH4+', sub: '铵化', a: Math.PI * 0.52, c: 'rgba(251,191,36,.95)' },
            { label: 'NO3-', sub: '硝化', a: Math.PI * 1.05, c: 'rgba(167,139,250,.92)' },
            { label: '反硝化', sub: '回到 N2', a: Math.PI * 1.58, c: 'rgba(248,113,113,.92)' }
        ];
        steps.forEach((step, i) => {
            const next = steps[(i + 1) % steps.length];
            const x1 = centerX + Math.cos(step.a) * radius;
            const y1 = centerY + Math.sin(step.a) * radius;
            const x2 = centerX + Math.cos(next.a) * radius;
            const y2 = centerY + Math.sin(next.a) * radius;
            this._curveArrow(x1, y1, centerX, centerY, x2, y2, 'rgba(148,163,184,.32)');
        });
        steps.forEach(step => {
            const x = centerX + Math.cos(step.a) * radius;
            const y = centerY + Math.sin(step.a) * radius;
            ctx.fillStyle = 'rgba(15,23,42,.74)';
            ctx.strokeStyle = step.c;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.arc(x, y, compact ? 30 : 38, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = step.c;
            this._fitText(step.label, x, y - 3, compact ? 54 : 68, compact ? 10.5 : 12, 8.5, '700');
            ctx.fillStyle = 'rgba(203,213,225,.72)';
            this._fitText(step.sub, x, y + 14, compact ? 54 : 68, compact ? 9.5 : 11, 8, '');
        });
        const runoff = this.fertilizer;
        const eutro = this._clamp(runoff * 0.95, 0, 100);
        const oxygen = this._clamp(100 - eutro * 0.72, 20, 100);
        const panelX = compact ? 28 : W * 0.68;
        const panelY = compact ? H - 138 : 92;
        const panelW = compact ? W - 56 : W * 0.25;
        const panelH = compact ? 108 : 170;
        ctx.fillStyle = 'rgba(15,23,42,.60)';
        ctx.strokeStyle = 'rgba(251,191,36,.30)';
        this._roundRect(panelX, panelY, panelW, panelH, 9);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(251,191,36,.94)';
        this._fitText('肥料径流影响', panelX + 14, panelY + 25, panelW - 28, 14, 11, '700', 'left');
        this._bar(panelX + 14, panelY + 48, panelW - 28, '藻类暴发风险', eutro, 'rgba(45,212,191,.90)');
        this._bar(panelX + 14, panelY + 86, panelW - 28, '溶解氧保留', oxygen, 'rgba(96,165,250,.90)');
        if (!compact) {
            ctx.font = this._font('', 11.5);
            ctx.fillStyle = 'rgba(203,213,225,.72)';
            this._wrapText('氮、磷过量进入水体会造成富营养化，微生物大量繁殖并消耗溶解氧。', panelX + 14, panelY + 128, panelW - 28, 16, 3);
        }
        this._spawnParticles([[centerX, centerY - radius, centerX + radius, centerY], [centerX + radius, centerY, centerX, centerY + radius]], 'rgba(251,191,36,.90)', 1);
        this._drawParticles(dt);
    },

    _bar(x, y, w, label, value, color) {
        const { ctx } = this;
        ctx.font = this._font('600', 11);
        ctx.fillStyle = 'rgba(203,213,225,.78)';
        this._fitText(label, x, y, w, 11, 9, '600', 'left');
        ctx.fillStyle = 'rgba(30,41,59,.82)';
        this._roundRect(x, y + 8, w, 10, 5);
        ctx.fill();
        ctx.fillStyle = color;
        this._roundRect(x, y + 8, w * this._clamp(value / 100, 0, 1), 10, 5);
        ctx.fill();
    },

    _drawGreenhouse() {
        const { ctx, W, H } = this;
        this._drawTitle('温室效应：热量进入与散失的平衡', '温室气体吸收部分地表红外辐射，减慢热量向太空散失');
        const surfaceY = H * 0.74;
        ctx.fillStyle = 'rgba(15,23,42,.62)';
        ctx.fillRect(0, surfaceY, W, H - surfaceY);
        const atmosphereY = H * 0.24;
        const gasDensity = this._clamp(0.22 + this.carbonRelease / 160 + this.fertilizer / 360, 0.18, 0.95);
        const grad = ctx.createLinearGradient(0, atmosphereY, 0, surfaceY);
        grad.addColorStop(0, `rgba(96,165,250,${0.07 + gasDensity * 0.08})`);
        grad.addColorStop(1, `rgba(251,191,36,${0.08 + gasDensity * 0.10})`);
        ctx.fillStyle = grad;
        this._roundRect(W * 0.06, atmosphereY, W * 0.88, surfaceY - atmosphereY, 14);
        ctx.fill();
        ctx.strokeStyle = 'rgba(148,163,184,.16)';
        ctx.stroke();
        const sunX = W * 0.16;
        const sunY = H * 0.14;
        ctx.fillStyle = 'rgba(251,191,36,.92)';
        ctx.beginPath();
        ctx.arc(sunX, sunY, 24, 0, Math.PI * 2);
        ctx.fill();
        for (let i = 0; i < 5; i++) {
            const x = sunX + i * W * 0.12;
            this._arrow(x, sunY + 34, x + W * 0.10, surfaceY - 14, 'rgba(251,191,36,.72)', i === 1 ? '太阳短波' : '');
        }
        const escape = this._clamp(82 - gasDensity * 48 + this.carbonUptake * 0.16, 20, 88);
        const trapped = 100 - escape;
        for (let i = 0; i < 6; i++) {
            const x = W * (0.22 + i * 0.11);
            const y1 = surfaceY - 18;
            const y2 = atmosphereY + 20 + Math.sin(this.t * 1.2 + i) * 10;
            this._curveArrow(x, y1, x + 24, H * 0.45, x + (i % 2 ? 52 : -24), y2, 'rgba(248,113,113,.68)', i === 3 ? '红外热辐射' : '');
        }
        for (let i = 0; i < 12; i++) {
            const x = W * 0.10 + (i / 11) * W * 0.80;
            const y = atmosphereY + 34 + Math.sin(this.t + i * 1.7) * 22 + (i % 3) * 34;
            ctx.fillStyle = i % 3 === 0 ? 'rgba(96,165,250,.72)' : i % 3 === 1 ? 'rgba(248,113,113,.66)' : 'rgba(45,212,191,.62)';
            ctx.beginPath();
            ctx.ellipse(x, y, 18, 9, Math.sin(i) * 0.4, 0, Math.PI * 2);
            ctx.fill();
            ctx.font = this._font('700', 9);
            ctx.fillStyle = 'rgba(15,23,42,.88)';
            ctx.textAlign = 'center';
            ctx.fillText(i % 3 === 0 ? 'CO2' : i % 3 === 1 ? 'CH4' : 'N2O', x, y + 3);
        }
        const y = H - 78;
        const w = (W - 72) / 3;
        this._metric(28, y, w, '外逸热量', Math.round(escape) + '%', 'rgba(96,165,250,.95)');
        this._metric(40 + w, y, w, '滞留热量', Math.round(trapped) + '%', 'rgba(248,113,113,.95)');
        this._metric(52 + w * 2, y, w, '温室气体指数', Math.round(gasDensity * 100).toString(), 'rgba(251,191,36,.95)');
    },

    _drawCompare() {
        const { ctx, W, H } = this;
        this._drawTitle('能量流动与物质循环不是同一件事', '生态系统需要持续能量输入；构成生命的元素则在生物和无机环境之间回收');
        const compact = W < 620;
        const left = 36;
        const top = 86;
        const gap = compact ? 14 : 24;
        const cardW = compact ? W - 72 : (W - 96) / 2;
        const cardH = compact ? (H - 144) / 2 : H - 158;
        this._compareCard(left, top, cardW, cardH, '能量流动', '太阳能 → 生产者 → 消费者 → 分解者，逐级传递并不断以热散失。', ['单向', '递减', '需持续输入'], 'rgba(251,191,36,.92)');
        const x2 = compact ? left : left + cardW + gap;
        const y2 = compact ? top + cardH + gap : top;
        this._compareCard(x2, y2, cardW, cardH, '物质循环', '碳、氮、磷等元素在生物群落、土壤、水体、大气和岩石圈之间转换。', ['循环', '有储库', '受微生物驱动'], 'rgba(45,212,191,.92)');
        if (!compact) {
            this._arrow(left + cardW * 0.50, top + cardH * 0.42, left + cardW * 0.50, top + cardH * 0.72, 'rgba(251,191,36,.75)', '热散失');
            this._curveArrow(x2 + cardW * 0.25, top + cardH * 0.68, x2 + cardW * 0.50, top + cardH * 0.92, x2 + cardW * 0.75, top + cardH * 0.68, 'rgba(45,212,191,.76)', '循环返回');
        }
        ctx.font = this._font('', 12);
        ctx.fillStyle = 'rgba(148,163,184,.80)';
        this._fitText('学习提示：生态系统图里箭头含义要先分清，能量箭头和元素循环箭头不能混用。', W / 2, H - 28, W - 48, 12, 9, '');
    },

    _compareCard(x, y, w, h, title, body, tags, color) {
        const { ctx } = this;
        ctx.fillStyle = 'rgba(15,23,42,.58)';
        ctx.strokeStyle = color;
        this._roundRect(x, y, w, h, 10);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = color;
        this._fitText(title, x + 18, y + 34, w - 36, 18, 13, '700', 'left');
        ctx.font = this._font('', 12.5);
        ctx.fillStyle = 'rgba(203,213,225,.76)';
        this._wrapText(body, x + 18, y + 62, w - 36, 18, 4);
        tags.forEach((tag, i) => {
            const tx = x + 18 + (i % 2) * 96;
            const ty = y + h - 70 + Math.floor(i / 2) * 32;
            ctx.fillStyle = 'rgba(15,23,42,.78)';
            ctx.strokeStyle = color;
            this._roundRect(tx, ty, 82, 24, 6);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = color;
            this._fitText(tag, tx + 41, ty + 16, 72, 11, 9, '700');
        });
    },

    _draw() {
        if (!this.ctx) return;
        const dt = 16.7;
        this._drawBg();
        if (this.mode === 'nitrogen') this._drawNitrogen(dt);
        else if (this.mode === 'greenhouse') this._drawGreenhouse();
        else if (this.mode === 'compare') this._drawCompare();
        else this._drawCarbon(dt);
    },

    _injectInfoPanel() {
        const el = document.getElementById('cycles-info');
        if (!el) return;
        el.innerHTML = `
            <div class="cycles-info__hd">生态系统物质循环知识点</div>
            <div class="cycles-info__grid">
                <div class="cycles-info__block">
                    <div class="cycles-info__sub">当前观察</div>
                    <div id="cycles-mode-title" class="cycles-info__val"></div>
                    <div id="cycles-mode-desc" class="cycles-info__desc"></div>
                </div>
                <div class="cycles-info__block">
                    <div class="cycles-info__sub">核心辨析</div>
                    <div class="cycles-info__row"><span class="cycles-info__key" style="--c:#fbbf24">能量</span>单向流动，逐级递减并以热散失。</div>
                    <div class="cycles-info__row"><span class="cycles-info__key" style="--c:#2dd4bf">物质</span>在生物群落与无机环境之间循环。</div>
                    <div class="cycles-info__row"><span class="cycles-info__key" style="--c:#60a5fa">储库</span>大气、海洋、土壤、岩石圈保存物质的时间不同。</div>
                </div>
                <div class="cycles-info__block">
                    <div class="cycles-info__sub">判读顺序</div>
                    <div class="cycles-info__note">先判断箭头表示能量传递还是元素转化，再看储库、通量和时间尺度；分析人类影响时区分燃烧、土地利用、肥料径流和农业温室气体。</div>
                </div>
                <div class="cycles-info__block">
                    <div class="cycles-info__sub">模型读数</div>
                    <div id="cycles-readout" class="cycles-info__desc"></div>
                </div>
                <div class="cycles-info__block">
                    <div class="cycles-info__sub">模型边界</div>
                    <div class="cycles-info__note">画布数值是教学指数，用来观察方向关系；它不代表真实碳收支、氮磷负荷、水体溶解氧监测或气候预测。</div>
                </div>
            </div>
            <div class="cycles-info__source">参考 OpenStax Biology 2e 46.3 Biogeochemical Cycles、NASA Science The Causes of Climate Change 与 EPA Sources and Solutions: Agriculture。</div>
        `;
        this._updateInfo();
    },

    _updateInfo() {
        const mode = this.modes.find(item => item.key === this.mode) || this.modes[0];
        const title = document.getElementById('cycles-mode-title');
        const desc = document.getElementById('cycles-mode-desc');
        const readout = document.getElementById('cycles-readout');
        if (title) title.textContent = mode.label;
        if (desc) desc.textContent = mode.desc;
        if (readout) {
            const co2Index = this._clamp(100 + this.carbonRelease * 1.2 - this.carbonUptake * 0.62, 50, 190);
            const oxygen = this._clamp(100 - this.fertilizer * 0.72, 20, 100);
            const runoffState = this.fertilizer > 55 ? '径流偏高，富营养化和低氧风险上升' : '径流较低，水体低氧压力较小';
            readout.textContent = `CO2 教学指数 ${Math.round(co2Index)} · 肥料径流 ${Math.round(this.fertilizer)}% · 溶解氧保留约 ${Math.round(oxygen)}% · 速度 ${this.speed.toFixed(1)}x。${runoffState}。`;
        }
    },

    _loop() {
        this.t = performance.now() / 1000;
        this._draw();
        this._updateInfo();
        this.animId = requestAnimationFrame(() => this._loop());
    }
};

function initMaterialCycles() {
    MaterialCycles.init();
}

window.MaterialCycles = MaterialCycles;
window.initMaterialCycles = initMaterialCycles;
