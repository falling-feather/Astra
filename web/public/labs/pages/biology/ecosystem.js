/* ═══════════════════════════════════════════════════
   Ecosystem v2 – Energy Flow & Population Dynamics
   ResizeObserver · dt-driven · Parameter Sliders ·
   Hover Tooltip · Education Panel · Touch · ARIA
   ═══════════════════════════════════════════════════ */
const Ecosystem = {
    _listeners: [],
    _on(el, evt, fn, opts) { el.addEventListener(evt, fn, opts); this._listeners.push({ el, evt, fn, opts }); },
    canvas: null, ctx: null, animId: null, _ro: null,
    _prevT: 0, _paused: false, _speed: 1,
    mode: 'food-chain',
    /* food chain */
    producers: [], primaryConsumers: [], secondaryConsumers: [],
    decomposers: [], energyParticles: [],
    _hover: null, _mouse: { x: -999, y: -999 },
    /* population */
    popData: { prey: [], predator: [] },
    popParams: { alpha: 0.04, beta: 0.0005, gamma: 0.03, delta: 0.0003 },
    popState: { prey: 200, predator: 50 },
    popTime: 0, maxPopHistory: 400,
    _sliderEls: {},

    init() {
        this.canvas = document.getElementById('ecosystem-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this._resize();
        this._ro = new ResizeObserver(() => this._resize());
        this._ro.observe(this.canvas.parentElement);
        this._buildControls();
        this._initFoodChain();
        this._initPopulation();
        this._bindMouse();
        this._prevT = performance.now();
        this._loop();
    },
    destroy() {
        if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
        this._listeners.forEach(l => l.el.removeEventListener(l.evt, l.fn, l.opts));
        this._listeners.length = 0;
        const ctrl = document.getElementById('ecosystem-controls');
        if (ctrl) ctrl.innerHTML = '';
        const info = document.getElementById('ecosystem-info');
        if (info) info.innerHTML = '';
    },
    _resize() {
        const p = this.canvas.parentElement;
        const dpr = window.devicePixelRatio || 1;
        const w = p.clientWidth;
        const h = Math.min(Math.max(w * 0.45, 380), 520);
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w; this.H = h;
    },

    /* ── Controls ── */
    _buildControls() {
        const ctrl = document.getElementById('ecosystem-controls');
        if (!ctrl) return;
        ctrl.innerHTML = '';
        /* mode buttons */
        const modes = [
            { id: 'food-chain', label: '食物链与能量流' },
            { id: 'population', label: '种群动态模型' }
        ];
        const btnWrap = document.createElement('div');
        btnWrap.className = 'eco-mode-btns';
        btnWrap.setAttribute('role', 'group');
        btnWrap.setAttribute('aria-label', '模式选择');
        this._modeBtns = [];
        modes.forEach(m => {
            const b = document.createElement('button');
            b.className = 'eco-mode-btn' + (m.id === this.mode ? ' active' : '');
            b.textContent = m.label;
            b.setAttribute('aria-pressed', m.id === this.mode);
            this._on(b, 'click', () => this._setMode(m.id));
            btnWrap.appendChild(b);
            this._modeBtns.push({ id: m.id, btn: b });
        });
        ctrl.appendChild(btnWrap);

        /* speed + pause row */
        const row = document.createElement('div');
        row.className = 'eco-ctrl-row';
        // pause
        this._pauseBtn = document.createElement('button');
        this._pauseBtn.className = 'eco-mode-btn';
        this._pauseBtn.textContent = '⏸ 暂停';
        this._pauseBtn.setAttribute('aria-label', '暂停/继续');
        this._on(this._pauseBtn, 'click', () => this._togglePause());
        row.appendChild(this._pauseBtn);
        // speed
        const sLabel = document.createElement('span');
        sLabel.className = 'eco-slider-label';
        sLabel.textContent = '速度';
        row.appendChild(sLabel);
        const sSlider = document.createElement('input');
        sSlider.type = 'range'; sSlider.min = '0.3'; sSlider.max = '3'; sSlider.step = '0.1'; sSlider.value = '1';
        sSlider.className = 'eco-slider';
        sSlider.setAttribute('aria-label', '模拟速度');
        const sVal = document.createElement('span');
        sVal.className = 'eco-slider-val';
        sVal.textContent = '1.0x';
        this._on(sSlider, 'input', () => { this._speed = +sSlider.value; sVal.textContent = (+sSlider.value).toFixed(1) + 'x'; });
        row.appendChild(sSlider);
        row.appendChild(sVal);
        ctrl.appendChild(row);

        /* population parameter sliders (initially hidden) */
        this._paramWrap = document.createElement('div');
        this._paramWrap.className = 'eco-param-wrap';
        this._paramWrap.style.display = this.mode === 'population' ? '' : 'none';
        const params = [
            { key: 'alpha', label: 'α 猎物增长率', min: 0.01, max: 0.1, step: 0.005, fmt: v => v.toFixed(3) },
            { key: 'beta', label: 'β 捕食率', min: 0.0001, max: 0.002, step: 0.0001, fmt: v => v.toFixed(4) },
            { key: 'gamma', label: 'γ 捕食者死亡率', min: 0.01, max: 0.1, step: 0.005, fmt: v => v.toFixed(3) },
            { key: 'delta', label: 'δ 捕食者增长率', min: 0.0001, max: 0.001, step: 0.0001, fmt: v => v.toFixed(4) }
        ];
        params.forEach(p => {
            const r = document.createElement('div');
            r.className = 'eco-ctrl-row';
            const lb = document.createElement('span');
            lb.className = 'eco-slider-label';
            lb.textContent = p.label;
            r.appendChild(lb);
            const sl = document.createElement('input');
            sl.type = 'range'; sl.min = p.min; sl.max = p.max; sl.step = p.step;
            sl.value = this.popParams[p.key];
            sl.className = 'eco-slider';
            sl.setAttribute('aria-label', p.label);
            const vl = document.createElement('span');
            vl.className = 'eco-slider-val';
            vl.textContent = p.fmt(this.popParams[p.key]);
            this._on(sl, 'input', () => {
                this.popParams[p.key] = +sl.value;
                vl.textContent = p.fmt(+sl.value);
                this._updateInfo();
            });
            r.appendChild(sl);
            r.appendChild(vl);
            this._paramWrap.appendChild(r);
            this._sliderEls[p.key] = sl;
        });
        /* reset button */
        const resetBtn = document.createElement('button');
        resetBtn.className = 'eco-mode-btn';
        resetBtn.textContent = '🔄 重置种群';
        this._on(resetBtn, 'click', () => this._resetPopulation());
        this._paramWrap.appendChild(resetBtn);
        ctrl.appendChild(this._paramWrap);
    },

    _setMode(id) {
        this.mode = id;
        this._modeBtns.forEach(m => {
            m.btn.classList.toggle('active', m.id === id);
            m.btn.setAttribute('aria-pressed', m.id === id);
        });
        if (this._paramWrap) this._paramWrap.style.display = id === 'population' ? '' : 'none';
        if (id === 'population') this._resetPopulation();
        this._updateInfo();
    },
    _togglePause() {
        this._paused = !this._paused;
        this._pauseBtn.textContent = this._paused ? '▶ 继续' : '⏸ 暂停';
        if (!this._paused) { this._prevT = performance.now(); this._loop(); }
    },

    /* ── Mouse / Touch ── */
    _bindMouse() {
        const move = (x, y) => {
            const r = this.canvas.getBoundingClientRect();
            this._mouse = { x: x - r.left, y: y - r.top };
        };
        this._on(this.canvas, 'mousemove', e => move(e.clientX, e.clientY));
        this._on(this.canvas, 'touchmove', e => { e.preventDefault(); const t = e.touches[0]; move(t.clientX, t.clientY); }, { passive: false });
        this._on(this.canvas, 'mouseleave', () => { this._mouse = { x: -999, y: -999 }; this._hover = null; });
        this._on(this.canvas, 'touchend', () => { this._mouse = { x: -999, y: -999 }; this._hover = null; });
    },

    /* ── Food Chain ── */
    _initFoodChain() {
        this.producers = [];
        this.primaryConsumers = [];
        this.secondaryConsumers = [];
        this.decomposers = [];
        this.energyParticles = [];
        for (let i = 0; i < 6; i++) {
            this.producers.push({ x: 60 + i * 55, baseY: this.H * 0.55, size: 16 + Math.random() * 10, phase: Math.random() * Math.PI * 2, label: '生产者', trophic: 1 });
        }
        for (let i = 0; i < 3; i++) {
            this.primaryConsumers.push({ x: 80 + i * 120, y: this.H * 0.38, vx: 30 + Math.random() * 20, size: 12, dir: 1, label: '初级消费者', trophic: 2 });
        }
        this.secondaryConsumers.push({ x: this.W * 0.45, y: this.H * 0.2, vx: 40, size: 16, dir: 1, label: '高级消费者', trophic: 3 });
        for (let i = 0; i < 4; i++) {
            this.decomposers.push({ x: 50 + i * 90, y: this.H * 0.75, size: 8, phase: Math.random() * Math.PI * 2, label: '分解者', trophic: 0 });
        }
    },

    _drawFoodChain(dt, t) {
        const ctx = this.ctx, W = this.W, H = this.H;
        const fs = Math.max(14, Math.min(22, W * 0.018));
        const spd = this._speed;
        /* sky */
        const sky = ctx.createLinearGradient(0, 0, 0, H);
        sky.addColorStop(0, 'rgba(135,206,235,0.15)');
        sky.addColorStop(1, 'rgba(34,139,34,0.08)');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, W, H);
        /* ground */
        ctx.fillStyle = 'rgba(101,67,33,0.2)';
        ctx.fillRect(0, H * 0.65, W, H * 0.35);

        /* sun */
        const sunX = W * 0.85, sunY = H * 0.1, sunR = 28;
        const sunGlow = ctx.createRadialGradient(sunX, sunY, sunR * 0.3, sunX, sunY, sunR * 1.4);
        sunGlow.addColorStop(0, 'rgba(255,220,80,0.8)');
        sunGlow.addColorStop(0.6, 'rgba(255,200,50,0.3)');
        sunGlow.addColorStop(1, 'rgba(255,200,50,0)');
        ctx.fillStyle = sunGlow;
        ctx.fillRect(sunX - sunR * 1.5, sunY - sunR * 1.5, sunR * 3, sunR * 3);
        ctx.beginPath();
        ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,210,60,0.85)';
        ctx.fill();
        for (let i = 0; i < 10; i++) {
            const a = (Math.PI * 2 / 10) * i + t * 0.4;
            ctx.beginPath();
            ctx.moveTo(sunX + Math.cos(a) * (sunR + 4), sunY + Math.sin(a) * (sunR + 4));
            ctx.lineTo(sunX + Math.cos(a) * (sunR + 14 + Math.sin(t * 3 + i) * 4), sunY + Math.sin(a) * (sunR + 14 + Math.sin(t * 3 + i) * 4));
            ctx.strokeStyle = 'rgba(255,200,50,0.5)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        /* spawn energy particles */
        if (!this._paused) {
            if (Math.random() < 0.1 * spd) {
                this.energyParticles.push({ sx: sunX, sy: sunY + sunR, targetIdx: Math.floor(Math.random() * this.producers.length), progress: 0, type: 'solar' });
            }
            if (Math.random() < 0.04 * spd && this.primaryConsumers.length) {
                const pi = Math.floor(Math.random() * this.producers.length);
                this.energyParticles.push({ sx: this.producers[pi].x, sy: this.producers[pi].baseY - this.producers[pi].size, targetIdx: Math.floor(Math.random() * this.primaryConsumers.length), progress: 0, type: 'herb' });
            }
            if (Math.random() < 0.025 * spd && this.secondaryConsumers.length) {
                const pi = Math.floor(Math.random() * this.primaryConsumers.length);
                this.energyParticles.push({ sx: this.primaryConsumers[pi].x, sy: this.primaryConsumers[pi].y, targetIdx: 0, progress: 0, type: 'pred' });
            }
            if (Math.random() < 0.02 * spd) {
                const pi = Math.floor(Math.random() * this.decomposers.length);
                this.energyParticles.push({ sx: this.decomposers[pi].x, sy: this.decomposers[pi].y, targetIdx: Math.floor(Math.random() * this.producers.length), progress: 0, type: 'decomp' });
            }
        }
        /* update & draw particles */
        const pColors = { solar: [255, 200, 50], herb: [50, 200, 50], pred: [220, 80, 80], decomp: [160, 120, 80] };
        this.energyParticles = this.energyParticles.filter(p => {
            p.progress += dt * 0.8 * spd;
            if (p.progress >= 1) return false;
            let ex, ey;
            if (p.type === 'solar') { const tgt = this.producers[p.targetIdx]; ex = tgt.x; ey = tgt.baseY - tgt.size; }
            else if (p.type === 'herb') { const tgt = this.primaryConsumers[p.targetIdx]; ex = tgt.x; ey = tgt.y; }
            else if (p.type === 'pred') { const tgt = this.secondaryConsumers[p.targetIdx]; ex = tgt.x; ey = tgt.y; }
            else { const tgt = this.producers[p.targetIdx]; ex = tgt.x; ey = tgt.baseY; }
            const cx = p.sx + (ex - p.sx) * p.progress;
            const cy = p.sy + (ey - p.sy) * p.progress;
            const c = pColors[p.type];
            const alpha = 0.9 - p.progress * 0.4;
            ctx.beginPath();
            ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
            ctx.fill();
            /* glow */
            ctx.beginPath();
            ctx.arc(cx, cy, 7, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha * 0.2})`;
            ctx.fill();
            return true;
        });

        /* draw producers (trees with shadow) */
        this.producers.forEach(p => {
            const sway = Math.sin(t * 1.2 + p.phase) * 3;
            ctx.fillStyle = 'rgba(80,50,25,0.7)';
            ctx.fillRect(p.x - 3, p.baseY - p.size * 0.5, 6, p.size * 0.5 + 5);
            const g = ctx.createRadialGradient(p.x + sway, p.baseY - p.size, 0, p.x + sway, p.baseY - p.size, p.size * 0.9);
            g.addColorStop(0, 'rgba(60,180,60,0.85)');
            g.addColorStop(1, 'rgba(30,120,30,0.6)');
            ctx.beginPath();
            ctx.arc(p.x + sway, p.baseY - p.size, p.size * 0.8, 0, Math.PI * 2);
            ctx.fillStyle = g;
            ctx.fill();
        });

        /* draw primary consumers (rabbits) */
        this.primaryConsumers.forEach(c => {
            if (!this._paused) {
                c.x += c.vx * c.dir * dt * spd;
                if (c.x > W - 40 || c.x < 40) c.dir *= -1;
            }
            ctx.beginPath();
            ctx.ellipse(c.x, c.y, c.size, c.size * 0.7, 0, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(180,140,100,0.85)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(140,100,60,0.4)';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.beginPath();
            ctx.ellipse(c.x + c.dir * 4, c.y - c.size, 3, 8, c.dir * 0.2, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(200,170,130,0.7)';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(c.x + c.dir * 6, c.y - 2, 2, 0, Math.PI * 2);
            ctx.fillStyle = '#222';
            ctx.fill();
        });

        /* draw secondary consumers (fox) */
        this.secondaryConsumers.forEach(c => {
            if (!this._paused) {
                c.x += c.vx * c.dir * dt * spd;
                if (c.x > W - 50 || c.x < 50) c.dir *= -1;
            }
            ctx.beginPath();
            ctx.ellipse(c.x, c.y, c.size * 1.2, c.size * 0.8, 0, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(210,110,50,0.85)';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(c.x + c.dir * c.size, c.y - 4, c.size * 0.5, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(210,110,50,0.9)';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(c.x + c.dir * (c.size + 4), c.y - 6, 2, 0, Math.PI * 2);
            ctx.fillStyle = '#222';
            ctx.fill();
            /* tail */
            ctx.beginPath();
            ctx.ellipse(c.x - c.dir * c.size * 1.1, c.y + 2, 6, 4, -c.dir * 0.4, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(230,160,80,0.7)';
            ctx.fill();
        });

        /* draw decomposers (mushrooms) */
        this.decomposers.forEach(d => {
            const bob = Math.sin(t * 2 + d.phase) * 2;
            ctx.fillStyle = 'rgba(120,80,40,0.6)';
            ctx.fillRect(d.x - 2, d.y + bob, 4, 10);
            ctx.beginPath();
            ctx.arc(d.x, d.y + bob, d.size, Math.PI, 0);
            const mg = ctx.createRadialGradient(d.x, d.y + bob - 2, 0, d.x, d.y + bob, d.size);
            mg.addColorStop(0, 'rgba(200,80,80,0.7)');
            mg.addColorStop(1, 'rgba(140,50,50,0.5)');
            ctx.fillStyle = mg;
            ctx.fill();
            /* spots */
            ctx.beginPath();
            ctx.arc(d.x - 3, d.y + bob - 3, 1.5, 0, Math.PI * 2);
            ctx.arc(d.x + 3, d.y + bob - 2, 1.2, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.fill();
        });

        /* trophic labels */
        ctx.font = 'bold ' + (fs + 5) + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        const labels = [
            { text: '☀ 太阳能', x: sunX, y: sunY + sunR + 22, color: 'rgba(255,200,50,0.9)' },
            { text: '生产者（植物）', x: W * 0.3, y: H * 0.52, color: 'rgba(50,180,50,0.9)' },
            { text: '初级消费者（草食）', x: W * 0.3, y: H * 0.34, color: 'rgba(180,140,100,0.9)' },
            { text: '高级消费者（肉食）', x: W * 0.45, y: H * 0.14, color: 'rgba(210,110,50,0.9)' },
            { text: '分解者（真菌/细菌）', x: W * 0.3, y: H * 0.73, color: 'rgba(200,80,80,0.9)' }
        ];
        labels.forEach(l => { ctx.fillStyle = l.color; ctx.fillText(l.text, l.x, l.y); });

        /* animated dashed energy arrows */
        const dashOff = -t * 40 * spd;
        ctx.setLineDash([6, 4]);
        ctx.lineDashOffset = dashOff;
        ctx.lineWidth = 1.8;
        const arrows = [
            { x1: sunX, y1: sunY + sunR + 8, x2: W * 0.3, y2: H * 0.48, color: 'rgba(255,200,50,0.45)', lbl: '光合作用' },
            { x1: W * 0.3, y1: H * 0.50, x2: W * 0.3, y2: H * 0.40, color: 'rgba(50,200,50,0.45)', lbl: '摄食' },
            { x1: W * 0.3, y1: H * 0.36, x2: W * 0.45, y2: H * 0.22, color: 'rgba(200,150,50,0.45)', lbl: '捕食' },
            { x1: W * 0.45, y1: H * 0.24, x2: W * 0.3, y2: H * 0.7, color: 'rgba(160,120,80,0.35)', lbl: '分解' }
        ];
        arrows.forEach(a => {
            ctx.beginPath(); ctx.moveTo(a.x1, a.y1); ctx.lineTo(a.x2, a.y2);
            ctx.strokeStyle = a.color; ctx.stroke();
            const mx = (a.x1 + a.x2) / 2, my = (a.y1 + a.y2) / 2;
            ctx.font = fs + 'px ' + CF.sans;
            ctx.fillStyle = a.color.replace('0.45', '0.7').replace('0.35', '0.6');
            ctx.fillText(a.lbl, mx + 10, my - 5);
        });
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;

        /* energy pyramid (right side) */
        const px = W * 0.78, py = H * 0.33, pw = Math.min(130, W * 0.18), ph = H * 0.48;
        const levels = [
            { ratio: 0.25, color: 'rgba(210,110,50,0.25)', label: '~1%', name: '三级营养级' },
            { ratio: 0.45, color: 'rgba(180,140,100,0.25)', label: '~10%', name: '二级营养级' },
            { ratio: 0.75, color: 'rgba(50,180,50,0.25)', label: '~100%', name: '一级营养级' }
        ];
        ctx.font = fs + 'px ' + CF.sans;
        levels.forEach((lv, i) => {
            const ly = py + (ph / 3) * i;
            const lw = pw * lv.ratio;
            ctx.fillStyle = lv.color;
            ctx.beginPath();
            ctx.moveTo(px - lw / 2, ly); ctx.lineTo(px + lw / 2, ly);
            ctx.lineTo(px + lw / 2, ly + ph / 3 - 3);
            ctx.lineTo(px - lw / 2, ly + ph / 3 - 3);
            ctx.closePath(); ctx.fill();
            ctx.strokeStyle = lv.color.replace('0.25', '0.5');
            ctx.lineWidth = 1; ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.textAlign = 'center';
            ctx.fillText(lv.label + ' ' + lv.name, px, ly + ph / 6 + 3);
        });
        ctx.fillStyle = 'rgba(58,158,143,0.8)';
        ctx.font = 'bold ' + fs + 'px ' + CF.sans;
        ctx.fillText('能量金字塔', px, py - 12);

        /* hover detection */
        this._hover = null;
        const mx = this._mouse.x, my = this._mouse.y;
        const allCreatures = [
            ...this.producers.map(p => ({ cx: p.x, cy: p.baseY - p.size, r: p.size, info: p })),
            ...this.primaryConsumers.map(c => ({ cx: c.x, cy: c.y, r: c.size * 1.2, info: c })),
            ...this.secondaryConsumers.map(c => ({ cx: c.x, cy: c.y, r: c.size * 1.5, info: c })),
            ...this.decomposers.map(d => ({ cx: d.x, cy: d.y, r: d.size * 1.2, info: d }))
        ];
        for (const c of allCreatures) {
            if ((mx - c.cx) ** 2 + (my - c.cy) ** 2 < (c.r + 8) ** 2) {
                this._hover = c.info;
                /* highlight ring */
                ctx.beginPath();
                ctx.arc(c.cx, c.cy, c.r + 4, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(58,158,143,0.6)';
                ctx.lineWidth = 2;
                ctx.stroke();
                break;
            }
        }
        /* hover tooltip */
        if (this._hover) {
            const h = this._hover;
            const trophicNames = { 0: '分解者', 1: '生产者（第一营养级）', 2: '初级消费者（第二营养级）', 3: '高级消费者（第三营养级）' };
            const tip = trophicNames[h.trophic] || h.label;
            ctx.font = (fs + 5) + 'px ' + CF.sans;
            const tw = ctx.measureText(tip).width + 16;
            const tx = Math.min(mx + 12, W - tw - 4), ty = Math.max(my - 28, 10);
            ctx.fillStyle = 'rgba(20,25,35,0.85)';
            if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(tx, ty, tw, 24, 6); ctx.fill(); }
            else { ctx.fillRect(tx, ty, tw, 24); }
            ctx.fillStyle = 'rgba(58,158,143,1)';
            ctx.textAlign = 'left';
            ctx.fillText(tip, tx + 8, ty + 16);
        }
    },

    /* ── Population Dynamics (Lotka-Volterra) ── */
    _initPopulation() {
        this.popData = { prey: [], predator: [] };
        this.popState = { prey: 200, predator: 50 };
        this.popTime = 0;
    },
    _resetPopulation() {
        this._initPopulation();
        this._updateInfo();
    },
    _stepPopulation(dt) {
        const s = this.popState, p = this.popParams;
        const steps = Math.max(1, Math.round(dt * 60 * this._speed));
        for (let i = 0; i < steps; i++) {
            const dPrey = s.prey * (p.alpha - p.beta * s.predator);
            const dPred = s.predator * (p.delta * s.prey - p.gamma);
            s.prey = Math.max(1, Math.min(5000, s.prey + dPrey));
            s.predator = Math.max(1, Math.min(5000, s.predator + dPred));
        }
        this.popData.prey.push(s.prey);
        this.popData.predator.push(s.predator);
        if (this.popData.prey.length > this.maxPopHistory) {
            this.popData.prey.shift();
            this.popData.predator.shift();
        }
        this.popTime += steps;
    },
    _drawPopulation(dt) {
        const ctx = this.ctx, W = this.W, H = this.H;
        const fs = Math.max(14, Math.min(22, W * 0.018));
        if (!this._paused) this._stepPopulation(dt);

        const margin = { top: 50, right: 30, bottom: 55, left: 60 };
        const gw = W - margin.left - margin.right;
        const gh = H - margin.top - margin.bottom;

        ctx.fillStyle = 'rgba(20,22,30,0.04)';
        ctx.fillRect(margin.left, margin.top, gw, gh);

        /* title */
        ctx.font = 'bold ' + (fs + 8) + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(58,158,143,0.9)';
        ctx.fillText('Lotka-Volterra 种群动态模型', W / 2, 30);

        /* axes */
        ctx.strokeStyle = 'rgba(200,200,200,0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(margin.left, margin.top);
        ctx.lineTo(margin.left, margin.top + gh);
        ctx.lineTo(margin.left + gw, margin.top + gh);
        ctx.stroke();

        /* axis labels */
        ctx.save();
        ctx.translate(18, H / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.font = fs + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(200,200,200,0.6)';
        ctx.fillText('种群数量', 0, 0);
        ctx.restore();
        ctx.font = fs + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(200,200,200,0.6)';
        ctx.fillText('时间步', margin.left + gw / 2, H - 8);

        if (this.popData.prey.length < 2) return;

        const allVals = this.popData.prey.concat(this.popData.predator);
        const maxVal = Math.max(...allVals, 10);

        /* grid */
        ctx.font = fs + 'px ' + CF.mono;
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(200,200,200,0.5)';
        for (let i = 0; i <= 4; i++) {
            const val = Math.round(maxVal * i / 4);
            const yy = margin.top + gh - (gh * i / 4);
            ctx.fillText(val, margin.left - 6, yy + 3);
            ctx.beginPath();
            ctx.moveTo(margin.left, yy);
            ctx.lineTo(margin.left + gw, yy);
            ctx.strokeStyle = 'rgba(200,200,200,0.08)';
            ctx.stroke();
        }

        /* area fill under curves */
        const drawArea = (data, rgba) => {
            const n = data.length;
            ctx.beginPath();
            ctx.moveTo(margin.left, margin.top + gh);
            for (let i = 0; i < n; i++) {
                const px = margin.left + (i / (this.maxPopHistory - 1)) * gw;
                const py = margin.top + gh - (data[i] / maxVal) * gh;
                ctx.lineTo(px, py);
            }
            ctx.lineTo(margin.left + ((n - 1) / (this.maxPopHistory - 1)) * gw, margin.top + gh);
            ctx.closePath();
            ctx.fillStyle = rgba;
            ctx.fill();
        };
        drawArea(this.popData.prey, 'rgba(50,180,50,0.08)');
        drawArea(this.popData.predator, 'rgba(220,80,80,0.08)');

        /* lines */
        const drawLine = (data, color) => {
            ctx.beginPath();
            const n = data.length;
            for (let i = 0; i < n; i++) {
                const px = margin.left + (i / (this.maxPopHistory - 1)) * gw;
                const py = margin.top + gh - (data[i] / maxVal) * gh;
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.stroke();
        };
        drawLine(this.popData.prey, 'rgba(50,180,50,0.85)');
        drawLine(this.popData.predator, 'rgba(220,80,80,0.85)');

        /* end dots */
        const n = this.popData.prey.length;
        const lastX = margin.left + ((n - 1) / (this.maxPopHistory - 1)) * gw;
        [{ v: this.popData.prey[n - 1], c: 'rgba(50,180,50,1)' }, { v: this.popData.predator[n - 1], c: 'rgba(220,80,80,1)' }].forEach(d => {
            const py = margin.top + gh - (d.v / maxVal) * gh;
            ctx.beginPath(); ctx.arc(lastX, py, 4, 0, Math.PI * 2);
            ctx.fillStyle = d.c; ctx.fill();
        });

        /* legend */
        ctx.font = (fs + 5) + 'px ' + CF.sans;
        ctx.textAlign = 'left';
        const lx = margin.left + gw - 160, ly = margin.top + 20;
        ctx.fillStyle = 'rgba(50,180,50,0.8)';
        ctx.fillRect(lx, ly - 8, 16, 3);
        ctx.fillText('猎物 x = ' + Math.round(this.popState.prey), lx + 22, ly - 2);
        ctx.fillStyle = 'rgba(220,80,80,0.8)';
        ctx.fillRect(lx, ly + 14, 16, 3);
        ctx.fillText('捕食者 y = ' + Math.round(this.popState.predator), lx + 22, ly + 20);

        /* equations */
        ctx.font = (fs + 5) + 'px ' + CF.mono;
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(200,200,200,0.55)';
        ctx.fillText('dx/dt = αx − βxy', margin.left + gw, margin.top + gh + 28);
        ctx.fillText('dy/dt = δxy − γy', margin.left + gw, margin.top + gh + 44);

        /* time */
        ctx.textAlign = 'left';
        ctx.fillText('t = ' + this.popTime, margin.left + 8, margin.top + gh + 28);

        /* hover crosshair */
        if (this._mouse.x > margin.left && this._mouse.x < margin.left + gw &&
            this._mouse.y > margin.top && this._mouse.y < margin.top + gh) {
            const idx = Math.round(((this._mouse.x - margin.left) / gw) * (this.maxPopHistory - 1));
            if (idx >= 0 && idx < this.popData.prey.length) {
                const px = margin.left + (idx / (this.maxPopHistory - 1)) * gw;
                ctx.beginPath(); ctx.moveTo(px, margin.top); ctx.lineTo(px, margin.top + gh);
                ctx.strokeStyle = 'rgba(200,200,200,0.2)'; ctx.lineWidth = 1; ctx.stroke();
                const pv = Math.round(this.popData.prey[idx]);
                const cv = Math.round(this.popData.predator[idx]);
                ctx.font = fs + 'px ' + CF.sans;
                ctx.textAlign = 'left';
                ctx.fillStyle = 'rgba(20,25,35,0.85)';
                const tipW = 120, tipH = 40;
                const tipX = Math.min(px + 8, W - tipW - 8), tipY = this._mouse.y - tipH - 8;
                if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(tipX, tipY, tipW, tipH, 6); ctx.fill(); }
                else ctx.fillRect(tipX, tipY, tipW, tipH);
                ctx.fillStyle = 'rgba(50,180,50,1)';
                ctx.fillText('猎物: ' + pv, tipX + 8, tipY + 16);
                ctx.fillStyle = 'rgba(220,80,80,1)';
                ctx.fillText('捕食者: ' + cv, tipX + 8, tipY + 32);
            }
        }
    },

    /* ── Education Panel ── */
    _updateInfo() {
        const el = document.getElementById('ecosystem-info');
        if (!el) return;
        if (this.mode === 'food-chain') {
            el.innerHTML = `
                <div class="eco-info__hd">📘 食物链与能量流</div>
                <div class="eco-info__grid">
                    <div class="eco-info__block">
                        <div class="eco-info__sub">营养级</div>
                        <div class="eco-info__val">太阳 → 生产者 → 消费者 → 分解者</div>
                        <div class="eco-info__desc">生产者固定太阳能 → 化学能沿食物链单向流动、逐级递减</div>
                    </div>
                    <div class="eco-info__block">
                        <div class="eco-info__sub">能量传递</div>
                        <div class="eco-info__val" style="color:#4ade80">效率 ≈ 10%~20%</div>
                        <div class="eco-info__desc">林德曼十分之一定律：相邻营养级间能量传递效率约10%-20%</div>
                    </div>
                    <div class="eco-info__block">
                        <div class="eco-info__sub">物质循环</div>
                        <div class="eco-info__row"><span class="eco-info__key" style="--c:#4ade80">分解者</span> 将有机物分解为无机物，归还给无机环境</div>
                        <div class="eco-info__row"><span class="eco-info__key" style="--c:#60a5fa">物质循环</span> 物质在生物群落与无机环境间往复循环</div>
                    </div>
                    <div class="eco-info__block">
                        <div class="eco-info__sub">💡 知识要点</div>
                        <div class="eco-info__note">能量沿食物链流动时逐级递减，因此高营养级生物数量最少，形成能量金字塔。能量流动是单向流动、逐级递减的。</div>
                    </div>
                </div>`;
        } else {
            const p = this.popParams;
            el.innerHTML = `
                <div class="eco-info__hd">📘 Lotka-Volterra 种群动态模型</div>
                <div class="eco-info__grid">
                    <div class="eco-info__block">
                        <div class="eco-info__sub">猎物方程</div>
                        <div class="eco-info__val">dx/dt = αx − βxy</div>
                        <div class="eco-info__desc">α=${p.alpha.toFixed(3)} β=${p.beta.toFixed(4)} — 猎物自然增长 − 被捕食消耗</div>
                    </div>
                    <div class="eco-info__block">
                        <div class="eco-info__sub">捕食者方程</div>
                        <div class="eco-info__val">dy/dt = δxy − γy</div>
                        <div class="eco-info__desc">δ=${p.delta.toFixed(4)} γ=${p.gamma.toFixed(3)} — 捕食增长 − 自然死亡</div>
                    </div>
                    <div class="eco-info__block">
                        <div class="eco-info__sub">当前状态</div>
                        <div class="eco-info__row"><span class="eco-info__key" style="--c:#4ade80">猎物 x</span> ${Math.round(this.popState.prey)}</div>
                        <div class="eco-info__row"><span class="eco-info__key" style="--c:#f87171">捕食者 y</span> ${Math.round(this.popState.predator)}</div>
                    </div>
                    <div class="eco-info__block">
                        <div class="eco-info__sub">💡 知识要点</div>
                        <div class="eco-info__note">两个种群数量呈周期性振荡：猎物增多→捕食者增多→猎物减少→捕食者减少→循环。这体现了负反馈调节机制。</div>
                    </div>
                </div>`;
        }
    },

    /* ── Main Loop ── */
    _loop() {
        if (this._paused) return;
        const now = performance.now();
        const dt = Math.min((now - this._prevT) / 1000, 0.05);
        this._prevT = now;
        const t = now / 1000;
        this.ctx.clearRect(0, 0, this.W, this.H);
        if (this.mode === 'food-chain') {
            this._drawFoodChain(dt, t);
        } else {
            this._drawPopulation(dt);
        }
        this.animId = requestAnimationFrame(() => this._loop());
    }
};

function initEcosystem() { Ecosystem.init(); Ecosystem._updateInfo(); }
window.Ecosystem = Ecosystem;