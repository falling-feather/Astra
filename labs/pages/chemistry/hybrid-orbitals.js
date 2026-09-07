/* Hybrid orbitals and VSEPR: sp / sp2 / sp3 linkage */
const HybridOrbitals = {
    canvas: null,
    ctx: null,
    W: 0,
    H: 0,
    _listeners: [],
    _ro: null,
    _raf: null,
    _time: 0,
    active: 'ch4',
    showLonePairs: true,
    showPi: true,
    speed: 0.35,

    examples: [
        {
            key: 'co2',
            label: 'CO2 / C2H2',
            molecule: 'CO2',
            center: 'C',
            hybrid: 'sp',
            steric: 2,
            bonds: 2,
            lonePairs: 0,
            electron: '直线形',
            molecular: '直线形',
            angle: '180°',
            sigma: 2,
            pi: 2,
            note: '中心 C 周围有 2 个电子域；每个双键或三键在 VSEPR 中都按 1 个电子域计数。',
            domains: [
                { angle: 0, type: 'bond', label: 'O', bond: 'double', depth: 0.08 },
                { angle: Math.PI, type: 'bond', label: 'O', bond: 'double', depth: -0.08 }
            ],
            piOrbitals: 2
        },
        {
            key: 'bf3',
            label: 'BF3',
            molecule: 'BF3',
            center: 'B',
            hybrid: 'sp2',
            steric: 3,
            bonds: 3,
            lonePairs: 0,
            electron: '平面三角形',
            molecular: '平面三角形',
            angle: '约120°',
            sigma: 3,
            pi: 0,
            note: '3 个电子域给出平面三角电子域几何；没有孤对电子时，分子形状与电子域几何一致。',
            domains: [
                { angle: -Math.PI / 2, type: 'bond', label: 'F', bond: 'single', depth: 0 },
                { angle: Math.PI / 6, type: 'bond', label: 'F', bond: 'single', depth: 0 },
                { angle: 5 * Math.PI / 6, type: 'bond', label: 'F', bond: 'single', depth: 0 }
            ],
            piOrbitals: 0
        },
        {
            key: 'c2h4',
            label: 'C2H4 中的 C',
            molecule: 'C2H4',
            center: 'C',
            hybrid: 'sp2',
            steric: 3,
            bonds: 3,
            lonePairs: 0,
            electron: '平面三角形',
            molecular: '局部平面三角形',
            angle: '约120°',
            sigma: 3,
            pi: 1,
            note: '乙烯每个 C 用 3 个 sp2 轨道形成 σ 键，剩下 1 个未杂化 p 轨道侧向重叠形成 π 键。',
            domains: [
                { angle: -Math.PI / 2, type: 'bond', label: 'H', bond: 'single', depth: 0 },
                { angle: Math.PI / 6, type: 'bond', label: 'C', bond: 'double', depth: 0 },
                { angle: 5 * Math.PI / 6, type: 'bond', label: 'H', bond: 'single', depth: 0 }
            ],
            piOrbitals: 1
        },
        {
            key: 'ch4',
            label: 'CH4',
            molecule: 'CH4',
            center: 'C',
            hybrid: 'sp3',
            steric: 4,
            bonds: 4,
            lonePairs: 0,
            electron: '四面体',
            molecular: '正四面体',
            angle: '109.5°',
            sigma: 4,
            pi: 0,
            note: '4 个等价 sp3 杂化轨道指向四面体的 4 个顶点，形成 4 条 C-H σ 键。',
            domains: [
                { angle: -Math.PI / 2, type: 'bond', label: 'H', bond: 'single', depth: 0.55 },
                { angle: Math.PI / 7, type: 'bond', label: 'H', bond: 'single', depth: 0.22 },
                { angle: 5 * Math.PI / 6, type: 'bond', label: 'H', bond: 'single', depth: -0.3 },
                { angle: 1.34 * Math.PI, type: 'bond', label: 'H', bond: 'single', depth: -0.48 }
            ],
            piOrbitals: 0
        },
        {
            key: 'nh3',
            label: 'NH3',
            molecule: 'NH3',
            center: 'N',
            hybrid: 'sp3',
            steric: 4,
            bonds: 3,
            lonePairs: 1,
            electron: '四面体电子域',
            molecular: '三角锥形',
            angle: '约107°',
            sigma: 3,
            pi: 0,
            note: 'N 周围仍是 4 个电子域，但 1 个孤对电子不计入分子形状；孤对电子排斥更强，使键角小于 109.5°。',
            domains: [
                { angle: -Math.PI / 2, type: 'lone', label: '孤对', depth: 0.55 },
                { angle: Math.PI / 7, type: 'bond', label: 'H', bond: 'single', depth: 0.22 },
                { angle: 5 * Math.PI / 6, type: 'bond', label: 'H', bond: 'single', depth: -0.3 },
                { angle: 1.34 * Math.PI, type: 'bond', label: 'H', bond: 'single', depth: -0.48 }
            ],
            piOrbitals: 0
        },
        {
            key: 'h2o',
            label: 'H2O',
            molecule: 'H2O',
            center: 'O',
            hybrid: 'sp3',
            steric: 4,
            bonds: 2,
            lonePairs: 2,
            electron: '四面体电子域',
            molecular: 'V 形（角形）',
            angle: '104.5°',
            sigma: 2,
            pi: 0,
            note: 'O 周围 2 个成键电子域和 2 个孤对电子域近似四面体排布；分子形状只看原子位置，因此为 V 形。',
            domains: [
                { angle: -2.08, type: 'lone', label: '孤对', depth: 0.36 },
                { angle: -1.06, type: 'lone', label: '孤对', depth: 0.42 },
                { angle: 0.32, type: 'bond', label: 'H', bond: 'single', depth: -0.22 },
                { angle: 2.82, type: 'bond', label: 'H', bond: 'single', depth: -0.22 }
            ],
            piOrbitals: 0
        }
    ],

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        if (this.canvas) this.destroy();
        this.canvas = document.getElementById('hybrid-canvas');
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
        this._updateInfo();
        this._loop();
    },

    destroy() {
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = null;
        this._listeners.forEach(l => l.el.removeEventListener(l.evt, l.fn, l.opts));
        this._listeners.length = 0;
        if (this._ro) this._ro.disconnect();
        this._ro = null;
        const ctrl = document.getElementById('hybrid-controls');
        if (ctrl) ctrl.innerHTML = '';
        this.canvas = null;
        this.ctx = null;
    },

    _resize() {
        if (!this.canvas || !this.canvas.parentElement || !this.ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const w = this.canvas.parentElement.getBoundingClientRect().width;
        const h = Math.min(Math.max(w * 0.54, 380), 520);
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
        const ctrl = document.getElementById('hybrid-controls');
        if (!ctrl) return;
        ctrl.innerHTML = '';

        const group = document.createElement('div');
        group.className = 'hybrid-example-btns';
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', '选择杂化轨道示例');
        this.examples.forEach(item => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'hybrid-btn' + (item.key === this.active ? ' active' : '');
            btn.dataset.example = item.key;
            btn.setAttribute('aria-pressed', item.key === this.active ? 'true' : 'false');
            btn.textContent = item.label;
            this._on(btn, 'click', () => {
                this.active = item.key;
                group.querySelectorAll('.hybrid-btn').forEach(b => {
                    const on = b === btn;
                    b.classList.toggle('active', on);
                    b.setAttribute('aria-pressed', on ? 'true' : 'false');
                });
                this._updateInfo();
                this._draw();
            });
            group.appendChild(btn);
        });
        ctrl.appendChild(group);

        const toggles = document.createElement('div');
        toggles.className = 'hybrid-toggles';
        toggles.append(
            this._makeCheck('show-lone', '显示孤对电子域', this.showLonePairs, checked => {
                this.showLonePairs = checked;
                this._draw();
                this._updateInfo();
            }),
            this._makeCheck('show-pi', '显示未杂化 p / π 键', this.showPi, checked => {
                this.showPi = checked;
                this._draw();
                this._updateInfo();
            })
        );

        const slider = document.createElement('label');
        slider.className = 'hybrid-speed';
        slider.innerHTML = '<span>旋转</span>';
        const input = document.createElement('input');
        input.type = 'range';
        input.min = '0';
        input.max = '1.2';
        input.step = '0.05';
        input.value = String(this.speed);
        const value = document.createElement('span');
        value.className = 'hybrid-speed__value';
        value.textContent = this.speed.toFixed(2) + 'x';
        this._on(input, 'input', () => {
            this.speed = Number(input.value);
            value.textContent = this.speed.toFixed(2) + 'x';
        });
        slider.append(input, value);
        toggles.appendChild(slider);
        ctrl.appendChild(toggles);
    },

    _makeCheck(id, label, checked, onChange) {
        const wrap = document.createElement('label');
        wrap.className = 'hybrid-check';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = id;
        input.checked = checked;
        this._on(input, 'change', () => onChange(input.checked));
        const span = document.createElement('span');
        span.textContent = label;
        wrap.append(input, span);
        return wrap;
    },

    _current() {
        return this.examples.find(x => x.key === this.active) || this.examples[0];
    },

    _loop(now = 0) {
        this._time = now / 1000;
        this._draw();
        this._raf = requestAnimationFrame(t => this._loop(t));
    },

    _draw() {
        if (!this.ctx) return;
        const ctx = this.ctx;
        const data = this._current();
        ctx.clearRect(0, 0, this.W, this.H);
        this._drawBackground(ctx);

        const compact = this.W < 720;
        if (compact) {
            this._drawModel(ctx, data, this.W / 2, this.H * 0.36, Math.min(this.W * 0.25, 115), true);
            this._drawReasoning(ctx, data, 18, this.H * 0.63, this.W - 36, this.H * 0.31);
        } else {
            this._drawModel(ctx, data, this.W * 0.32, this.H * 0.54, Math.min(this.W * 0.16, 132), false);
            this._drawReasoning(ctx, data, this.W * 0.56, 48, this.W * 0.38, this.H - 86);
        }
    },

    _drawBackground(ctx) {
        const g = ctx.createLinearGradient(0, 0, this.W, this.H);
        g.addColorStop(0, 'rgba(77,158,126,.10)');
        g.addColorStop(0.5, 'rgba(255,255,255,.025)');
        g.addColorStop(1, 'rgba(91,141,206,.09)');
        ctx.fillStyle = g;
        this._roundRect(ctx, 0, 0, this.W, this.H, 14);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255,255,255,.055)';
        ctx.lineWidth = 1;
        for (let x = 24; x < this.W; x += 44) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, this.H);
            ctx.stroke();
        }
        for (let y = 24; y < this.H; y += 44) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(this.W, y);
            ctx.stroke();
        }
    },

    _drawModel(ctx, data, cx, cy, r, compact) {
        const orbitScale = 1 + Math.sin(this._time * this.speed * 1.7) * 0.025;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        this._drawPiOrbitals(ctx, data, cx, cy, r, orbitScale);

        const sorted = data.domains.slice().sort((a, b) => (a.depth || 0) - (b.depth || 0));
        sorted.forEach(domain => this._drawDomain(ctx, domain, cx, cy, r, orbitScale));

        const atomR = Math.max(22, r * 0.24);
        const core = ctx.createRadialGradient(cx - atomR * 0.35, cy - atomR * 0.35, 2, cx, cy, atomR);
        core.addColorStop(0, '#ffffff');
        core.addColorStop(0.23, '#6fd1a5');
        core.addColorStop(1, '#245b4d');
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(cx, cy, atomR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.45)';
        ctx.stroke();

        ctx.fillStyle = '#08130f';
        ctx.font = '700 ' + Math.round(atomR * 0.76) + 'px ' + this._fontFamily(false);
        ctx.fillText(data.center, cx, cy + 1);

        ctx.fillStyle = 'rgba(255,255,255,.88)';
        ctx.font = '700 18px ' + this._fontFamily(false);
        ctx.fillText(data.molecule + ' · ' + data.hybrid, cx, compact ? 34 : 38);
        ctx.fillStyle = 'rgba(255,255,255,.52)';
        ctx.font = '12px ' + this._fontFamily(false);
        ctx.fillText(data.electron + ' / ' + data.molecular, cx, compact ? 55 : 60);

        this._drawAngleArc(ctx, data, cx, cy, r);
        ctx.restore();
    },

    _drawDomain(ctx, domain, cx, cy, r, scale) {
        if (domain.type === 'lone' && !this.showLonePairs) return;
        const depth = domain.depth || 0;
        const len = r * (1.12 + depth * 0.1) * scale;
        const x = cx + Math.cos(domain.angle) * len;
        const y = cy + Math.sin(domain.angle) * len * 0.76;
        const alpha = 0.58 + Math.max(depth, -0.45) * 0.35;

        if (domain.type === 'bond') {
            ctx.save();
            ctx.strokeStyle = domain.bond === 'double' ? 'rgba(126,184,240,.72)' : 'rgba(255,255,255,.62)';
            ctx.lineWidth = domain.bond === 'double' ? 5 : 4;
            if (depth < -0.25) ctx.setLineDash([7, 6]);
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(x, y);
            ctx.stroke();
            ctx.setLineDash([]);
            if (domain.bond === 'double') {
                const nx = -Math.sin(domain.angle) * 4;
                const ny = Math.cos(domain.angle) * 4;
                ctx.strokeStyle = 'rgba(126,184,240,.42)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(cx + nx, cy + ny);
                ctx.lineTo(x + nx, y + ny);
                ctx.stroke();
            }
            this._drawTerminalAtom(ctx, x, y, domain.label, alpha);
            this._drawOrbitalLobe(ctx, cx, cy, domain.angle, r * 0.76, 'rgba(77,158,126,.28)', alpha, false);
            ctx.restore();
        } else {
            ctx.save();
            this._drawOrbitalLobe(ctx, cx, cy, domain.angle, r * 0.72, 'rgba(229,192,123,.34)', 0.9, true);
            ctx.fillStyle = 'rgba(229,192,123,.95)';
            ctx.beginPath();
            ctx.arc(x - 5, y, 3.5, 0, Math.PI * 2);
            ctx.arc(x + 5, y, 3.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(229,192,123,.82)';
            ctx.font = '12px ' + this._fontFamily(false);
            ctx.fillText('孤对', x, y + 19);
            ctx.restore();
        }
    },

    _drawTerminalAtom(ctx, x, y, label, alpha) {
        const rad = label === 'C' ? 20 : 17;
        const color = label === 'O' ? '#e06c75' : label === 'F' ? '#6fd1a5' : label === 'H' ? '#dfe8f2' : '#9aa0aa';
        const g = ctx.createRadialGradient(x - 5, y - 5, 1, x, y, rad);
        g.addColorStop(0, '#fff');
        g.addColorStop(0.32, color);
        g.addColorStop(1, color);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.3)';
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = label === 'H' ? '#1a1f27' : '#fff';
        ctx.font = '700 12px ' + this._fontFamily(false);
        ctx.fillText(label, x, y + 0.5);
    },

    _drawOrbitalLobe(ctx, cx, cy, angle, len, color, alpha, lone) {
        const px = cx + Math.cos(angle) * len * 0.58;
        const py = cy + Math.sin(angle) * len * 0.44;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(angle);
        ctx.globalAlpha = alpha;
        const g = ctx.createRadialGradient(-len * 0.18, 0, 2, len * 0.05, 0, len * 0.34);
        g.addColorStop(0, lone ? 'rgba(255,236,176,.8)' : 'rgba(138,222,180,.65)');
        g.addColorStop(1, color);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(0, 0, len * 0.38, len * 0.16, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    },

    _drawPiOrbitals(ctx, data, cx, cy, r, scale) {
        if (!this.showPi || !data.piOrbitals) return;
        const count = data.piOrbitals;
        ctx.save();
        ctx.globalAlpha = 0.72;
        for (let i = 0; i < count; i++) {
            const offset = (i - (count - 1) / 2) * r * 0.34;
            const color = i === 0 ? 'rgba(126,184,240,.35)' : 'rgba(178,155,220,.32)';
            ctx.fillStyle = color;
            this._drawPOrbitalPair(ctx, cx + offset, cy, r * 0.74 * scale, i === 1 ? Math.PI / 2 : 0);
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(126,184,240,.86)';
        ctx.font = '12px ' + this._fontFamily(false);
        ctx.fillText(data.pi + ' 个 π 键来自未杂化 p 轨道', cx, cy + r * 1.42);
        ctx.restore();
    },

    _drawPOrbitalPair(ctx, x, y, size, rot) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot);
        ctx.beginPath();
        ctx.ellipse(0, -size * 0.42, size * 0.18, size * 0.36, 0, 0, Math.PI * 2);
        ctx.ellipse(0, size * 0.42, size * 0.18, size * 0.36, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.2)';
        ctx.stroke();
        ctx.restore();
    },

    _drawAngleArc(ctx, data, cx, cy, r) {
        const bonds = data.domains.filter(d => d.type === 'bond');
        if (bonds.length < 2) return;
        const a1 = bonds[0].angle;
        const a2 = bonds[1].angle;
        const rr = r * 0.42;
        ctx.save();
        ctx.strokeStyle = 'rgba(229,192,123,.78)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, rr, Math.min(a1, a2), Math.max(a1, a2));
        ctx.stroke();
        ctx.fillStyle = 'rgba(229,192,123,.88)';
        ctx.font = '12px ' + this._fontFamily(false);
        ctx.fillText(data.angle, cx, cy - rr - 12);
        ctx.restore();
    },

    _drawReasoning(ctx, data, x, y, w, h) {
        if (!Number.isFinite(w) || !Number.isFinite(h) || w < 24 || h < 80) return;
        ctx.save();
        this._roundRect(ctx, x, y, w, h, 12);
        ctx.fillStyle = 'rgba(8,18,16,.68)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(77,158,126,.22)';
        ctx.stroke();

        ctx.fillStyle = 'rgba(255,255,255,.92)';
        ctx.font = '700 16px ' + this._fontFamily(false);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('VSEPR 推理链', x + 18, y + 16);

        const steps = [
            ['1', '数电子域', data.steric + ' 个（单/双/三键均按 1 个域）'],
            ['2', '匹配杂化', data.hybrid + ' · ' + data.steric + ' 个杂化轨道'],
            ['3', '电子域几何', data.electron],
            ['4', '分子形状', data.molecular + (data.lonePairs ? '，扣除孤对电子' : '')]
        ];
        const rowH = Math.max(28, Math.min(58, (h - 78) / 4));
        steps.forEach((step, idx) => {
            const yy = y + 52 + idx * rowH;
            ctx.fillStyle = idx % 2 ? 'rgba(255,255,255,.025)' : 'rgba(77,158,126,.055)';
            this._roundRect(ctx, x + 14, yy, w - 28, Math.max(10, rowH - 8), 8);
            ctx.fill();
            ctx.fillStyle = 'rgba(77,158,126,.95)';
            ctx.font = '700 14px ' + this._fontFamily(false);
            ctx.fillText(step[0], x + 28, yy + 12);
            ctx.fillStyle = 'rgba(255,255,255,.9)';
            ctx.font = '700 13px ' + this._fontFamily(false);
            ctx.fillText(step[1], x + 54, yy + 10);
            ctx.fillStyle = 'rgba(255,255,255,.58)';
            ctx.font = '12px ' + this._fontFamily(false);
            this._wrapText(ctx, step[2], x + 54, yy + 30, w - 80, 15, 2);
        });

        if (h > 176) {
            ctx.fillStyle = 'rgba(229,192,123,.86)';
            ctx.font = '12px ' + this._fontFamily(false);
            this._wrapText(ctx, '要点：VSEPR 预测电子域和分子形状；杂化轨道理论解释这些方向上的 σ 键与孤对电子占据。', x + 18, y + h - 42, w - 36, 16, 2);
        }
        ctx.restore();
    },

    _updateInfo() {
        const info = document.getElementById('hybrid-info');
        if (!info) return;
        const d = this._current();
        const loneLine = d.lonePairs
            ? `<div class="hybrid-info__row"><span>孤对电子</span><strong>${d.lonePairs} 对；分子形状不把孤对当作原子顶点</strong></div>`
            : '<div class="hybrid-info__row"><span>孤对电子</span><strong>0 对；电子域几何与分子形状一致</strong></div>';
        const piLine = d.pi
            ? `<div class="hybrid-info__row"><span>π 键</span><strong>${d.pi} 个，由未杂化 p 轨道侧向重叠形成</strong></div>`
            : '<div class="hybrid-info__row"><span>π 键</span><strong>0 个；主要显示 σ 键方向</strong></div>';
        info.innerHTML = `
            <div class="hybrid-info__head">
                <span class="hybrid-tag">${d.molecule}</span>
                <h3>${d.hybrid} 杂化 · ${d.molecular}</h3>
            </div>
            <div class="hybrid-info__grid">
                <div class="hybrid-info__row"><span>电子域数</span><strong>${d.steric} 个</strong></div>
                <div class="hybrid-info__row"><span>典型键角</span><strong>${d.angle}</strong></div>
                <div class="hybrid-info__row"><span>σ 键</span><strong>${d.sigma} 条</strong></div>
                ${piLine}
                ${loneLine}
            </div>
            <p class="hybrid-info__note">${d.note}</p>
            <p class="hybrid-info__source">参考 OpenStax Chemistry 2e 7.6 VSEPR 与 8.2 Hybrid Atomic Orbitals。</p>
        `;
    },

    _wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
        const chars = String(text).split('');
        let line = '';
        let lines = 0;
        for (let i = 0; i < chars.length; i++) {
            const test = line + chars[i];
            if (ctx.measureText(test).width > maxWidth && line) {
                ctx.fillText(line, x, y + lines * lineHeight);
                line = chars[i];
                lines++;
                if (maxLines && lines >= maxLines) return;
            } else {
                line = test;
            }
        }
        if (line && (!maxLines || lines < maxLines)) ctx.fillText(line, x, y + lines * lineHeight);
    },

    _roundRect(ctx, x, y, w, h, r) {
        if (![x, y, w, h, r].every(Number.isFinite)) {
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
        if (w === 0 || h === 0) {
            ctx.beginPath();
            return;
        }
        const radius = Math.max(0, Math.min(Math.abs(r), w / 2, h / 2));
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + w, y, x + w, y + h, radius);
        ctx.arcTo(x + w, y + h, x, y + h, radius);
        ctx.arcTo(x, y + h, x, y, radius);
        ctx.arcTo(x, y, x + w, y, radius);
        ctx.closePath();
    },

    _fontFamily(mono) {
        if (typeof CF !== 'undefined') return mono ? CF.mono : CF.sans;
        return mono ? 'monospace' : 'system-ui, sans-serif';
    }
};

function initHybridOrbitals() {
    HybridOrbitals.init();
}

window.HybridOrbitals = HybridOrbitals;
window.initHybridOrbitals = initHybridOrbitals;
