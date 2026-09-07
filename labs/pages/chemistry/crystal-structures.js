/* Crystal structures: solid types, unit cells, and property links */
const CrystalStructures = {
    canvas: null,
    ctx: null,
    W: 0,
    H: 0,
    _listeners: [],
    _ro: null,
    _raf: null,
    _time: 0,
    active: 'nacl',
    showCell: true,
    showBonds: true,
    showDefects: false,

    examples: [
        {
            key: 'nacl',
            label: 'NaCl',
            sample: 'NaCl',
            title: '氯化钠 · 离子晶体',
            type: '离子晶体',
            particles: 'Na+ 与 Cl-',
            attraction: '离子键 / 强静电引力',
            structure: 'Cl- 构成 FCC；Na+ 位于八面体空隙',
            unit: '4 Na+ + 4 Cl- / 晶胞',
            coordination: '6:6 配位',
            properties: '硬而脆；固态不导电，熔融或水溶液导电',
            note: '晶胞计数给出 1:1 化学计量比；图中的一个晶胞不是孤立分子，而是无限晶格的一段。'
        },
        {
            key: 'copper',
            label: 'Cu',
            sample: 'Cu',
            title: '铜 · 金属晶体',
            type: '金属晶体',
            particles: '金属原子 / 金属阳离子骨架',
            attraction: '金属键与离域电子海',
            structure: 'FCC / 立方最密堆积',
            unit: '4 Cu / 晶胞',
            coordination: '12 配位',
            properties: '导电、导热、有金属光泽和延展性',
            note: '金属晶体的延展性来自非定向金属键；层间错动时离域电子仍可维系整体吸引。'
        },
        {
            key: 'diamond',
            label: '金刚石',
            sample: 'C',
            title: '金刚石 · 共价网络晶体',
            type: '共价网络晶体',
            particles: '碳原子',
            attraction: '连续三维共价键网络',
            structure: '每个 C 与 4 个 C 近似四面体连接',
            unit: '重复单元延伸成整体网络',
            coordination: '4 配位',
            properties: '极硬、高熔点，通常不导电',
            note: '金刚石不是由独立 C4 或 Cn 分子堆成；要熔化或破坏晶体，需要破坏大量共价键。'
        },
        {
            key: 'dryice',
            label: '干冰 CO2',
            sample: 'CO2',
            title: '干冰 · 分子晶体',
            type: '分子晶体',
            particles: '中性 CO2 分子',
            attraction: '分子间作用力',
            structure: '离散线形 CO2 分子规则排列',
            unit: 'CO2 分子为重复粒子',
            coordination: '分子间弱吸引',
            properties: '低温升华，熔点低，不导电',
            note: '分子内 C=O 是共价键；晶体中不同 CO2 分子之间主要靠分子间作用力维系。'
        }
    ],

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        if (this.canvas) this.destroy();
        this.canvas = document.getElementById('crystal-canvas');
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
        const ctrl = document.getElementById('crystal-controls');
        if (ctrl) ctrl.innerHTML = '';
        this.canvas = null;
        this.ctx = null;
    },

    _resize() {
        if (!this.canvas || !this.canvas.parentElement || !this.ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const w = this.canvas.parentElement.getBoundingClientRect().width;
        const h = w < 560 ? Math.min(Math.max(w * 1.04, 360), 460) : Math.min(Math.max(w * 0.54, 390), 520);
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
        const ctrl = document.getElementById('crystal-controls');
        if (!ctrl) return;
        ctrl.innerHTML = '';

        const group = document.createElement('div');
        group.className = 'crystal-buttons';
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', '选择晶体结构示例');
        this.examples.forEach(item => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'crystal-btn' + (item.key === this.active ? ' active' : '');
            btn.dataset.example = item.key;
            btn.setAttribute('aria-pressed', item.key === this.active ? 'true' : 'false');
            btn.textContent = item.label;
            this._on(btn, 'click', () => {
                this.active = item.key;
                group.querySelectorAll('.crystal-btn').forEach(b => {
                    b.classList.toggle('active', b === btn);
                    b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
                });
                this._updateInfo();
                this._draw();
            });
            group.appendChild(btn);
        });
        ctrl.appendChild(group);

        const toggles = document.createElement('div');
        toggles.className = 'crystal-toggles';
        toggles.append(
            this._checkbox('显示晶胞边界', 'showCell'),
            this._checkbox('显示作用力/键', 'showBonds'),
            this._checkbox('显示缺陷示意', 'showDefects')
        );
        ctrl.appendChild(toggles);
    },

    _checkbox(label, prop) {
        const wrap = document.createElement('label');
        wrap.className = 'crystal-check';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!this[prop];
        this._on(input, 'change', () => {
            this[prop] = input.checked;
            this._draw();
        });
        const span = document.createElement('span');
        span.textContent = label;
        wrap.append(input, span);
        return wrap;
    },

    _loop() {
        this._time += 0.016;
        this._draw();
        this._raf = requestAnimationFrame(() => this._loop());
    },

    _activeData() {
        return this.examples.find(item => item.key === this.active) || this.examples[0];
    },

    _draw() {
        if (!this.ctx || !this.W || !this.H) return;
        const ctx = this.ctx;
        const data = this._activeData();
        const compact = this.W < 650;
        ctx.clearRect(0, 0, this.W, this.H);
        this._drawBackground(ctx);

        const scene = compact
            ? { x: 20, y: 34, w: this.W - 40, h: this.H * 0.66 }
            : { x: 26, y: 40, w: this.W * 0.62, h: this.H - 78 };
        const panel = compact
            ? { x: 20, y: this.H - 122, w: this.W - 40, h: 98 }
            : { x: this.W * 0.66, y: 42, w: this.W * 0.29, h: this.H - 84 };

        this._drawSceneFrame(ctx, scene, data);
        if (this.showCell && data.key !== 'diamond') this._drawCube(ctx, scene, data);

        if (data.key === 'nacl') this._drawNaCl(ctx, scene);
        if (data.key === 'copper') this._drawCopper(ctx, scene);
        if (data.key === 'diamond') this._drawDiamond(ctx, scene);
        if (data.key === 'dryice') this._drawDryIce(ctx, scene);

        if (this.showDefects) this._drawDefectCue(ctx, scene, data);
        this._drawPanel(ctx, panel, data, compact);
    },

    _drawBackground(ctx) {
        const bg = ctx.createLinearGradient(0, 0, this.W, this.H);
        bg.addColorStop(0, 'rgba(12, 25, 23, 0.98)');
        bg.addColorStop(0.55, 'rgba(15, 34, 31, 0.98)');
        bg.addColorStop(1, 'rgba(8, 18, 22, 0.98)');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, this.W, this.H);

        ctx.save();
        ctx.strokeStyle = 'rgba(111, 209, 165, 0.055)';
        ctx.lineWidth = 1;
        const step = 32;
        for (let x = -step; x < this.W + step; x += step) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x + this.H * 0.42, this.H);
            ctx.stroke();
        }
        for (let y = 12; y < this.H; y += step) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(this.W, y - this.W * 0.16);
            ctx.stroke();
        }
        ctx.restore();
    },

    _drawSceneFrame(ctx, box, data) {
        ctx.save();
        this._roundRect(ctx, box.x, box.y, box.w, box.h, 16);
        ctx.fillStyle = 'rgba(255,255,255,0.025)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(111,209,165,0.14)';
        ctx.stroke();

        ctx.font = `700 14px ${this._fontFamily(true)}`;
        ctx.fillStyle = 'rgba(111,209,165,0.95)';
        ctx.fillText(data.sample + ' · ' + data.type, box.x + 18, box.y + 28);
        ctx.font = `500 12px ${this._fontFamily(false)}`;
        ctx.fillStyle = 'rgba(226,241,234,0.68)';
        this._wrapText(ctx, data.structure, box.x + 18, box.y + 50, box.w - 36, 18, 2);
        ctx.restore();
    },

    _drawCube(ctx, box, data) {
        const setup = this._cubeSetup(box);
        const edges = [
            [[0,0,0], [1,0,0]], [[0,1,0], [1,1,0]], [[0,0,1], [1,0,1]], [[0,1,1], [1,1,1]],
            [[0,0,0], [0,1,0]], [[1,0,0], [1,1,0]], [[0,0,1], [0,1,1]], [[1,0,1], [1,1,1]],
            [[0,0,0], [0,0,1]], [[1,0,0], [1,0,1]], [[0,1,0], [0,1,1]], [[1,1,0], [1,1,1]]
        ];
        ctx.save();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = data.key === 'dryice' ? 'rgba(136,188,255,0.3)' : 'rgba(111,209,165,0.35)';
        edges.forEach(edge => {
            const a = this._project({ x: edge[0][0], y: edge[0][1], z: edge[0][2] }, setup);
            const b = this._project({ x: edge[1][0], y: edge[1][1], z: edge[1][2] }, setup);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
        });
        ctx.restore();
    },

    _drawNaCl(ctx, box) {
        const setup = this._cubeSetup(box);
        const pts = [];
        [0, 1].forEach(x => [0, 1].forEach(y => [0, 1].forEach(z => pts.push({ x, y, z, ion: 'Cl-', r: 17, color: '#6fd1a5' }))));
        [[0.5,0.5,0], [0.5,0.5,1], [0.5,0,0.5], [0.5,1,0.5], [0,0.5,0.5], [1,0.5,0.5]]
            .forEach(p => pts.push({ x: p[0], y: p[1], z: p[2], ion: 'Cl-', r: 19, color: '#77ddb1' }));
        const edgeNa = [];
        [0, 1].forEach(a => [0, 1].forEach(b => {
            edgeNa.push([0.5, a, b], [a, 0.5, b], [a, b, 0.5]);
        }));
        edgeNa.push([0.5, 0.5, 0.5]);
        edgeNa.forEach(p => pts.push({ x: p[0], y: p[1], z: p[2], ion: 'Na+', r: 10.5, color: '#e7c66b' }));

        if (this.showBonds) {
            ctx.save();
            ctx.setLineDash([5, 5]);
            ctx.strokeStyle = 'rgba(231,198,107,0.32)';
            ctx.lineWidth = 1.2;
            const center = this._project({ x: 0.5, y: 0.5, z: 0.5 }, setup);
            [[0.5,0.5,0], [0.5,0.5,1], [0.5,0,0.5], [0.5,1,0.5], [0,0.5,0.5], [1,0.5,0.5]].forEach(p => {
                const q = this._project({ x: p[0], y: p[1], z: p[2] }, setup);
                ctx.beginPath();
                ctx.moveTo(center.x, center.y);
                ctx.lineTo(q.x, q.y);
                ctx.stroke();
            });
            ctx.restore();
        }
        this._drawParticles(ctx, pts, setup);
        this._drawCrystalCaption(ctx, box, 'Cl- 面心立方 + Na+ 八面体空隙', '4 Na+ + 4 Cl- / 晶胞');
    },

    _drawCopper(ctx, box) {
        const setup = this._cubeSetup(box);
        const pts = [];
        [0, 1].forEach(x => [0, 1].forEach(y => [0, 1].forEach(z => pts.push({ x, y, z, ion: 'Cu', r: 17, color: '#d78a56' }))));
        [[0.5,0.5,0], [0.5,0.5,1], [0.5,0,0.5], [0.5,1,0.5], [0,0.5,0.5], [1,0.5,0.5]]
            .forEach(p => pts.push({ x: p[0], y: p[1], z: p[2], ion: 'Cu', r: 19, color: '#e09159' }));

        ctx.save();
        ctx.fillStyle = 'rgba(111,209,165,0.42)';
        for (let i = 0; i < 42; i++) {
            const x = (Math.sin(i * 12.989 + this._time * 0.7) * 43758.5453) % 1;
            const y = (Math.sin(i * 78.233 + this._time * 0.5) * 24634.6345) % 1;
            const z = (Math.sin(i * 4.631 + this._time * 0.4) * 17321.928) % 1;
            const p = this._project({ x: Math.abs(x), y: Math.abs(y), z: Math.abs(z) }, setup);
            ctx.beginPath();
            ctx.arc(p.x, p.y, 2.1, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();

        if (this.showBonds) this._drawMetalSlip(ctx, box);
        this._drawParticles(ctx, pts, setup);
        this._drawCrystalCaption(ctx, box, 'FCC / CCP；每个原子接触 12 个近邻', '离域电子海解释导电与延展性');
    },

    _drawDiamond(ctx, box) {
        const setup = this._cubeSetup(box, 0.86);
        const nodes = [
            { x: 0.5, y: 0.5, z: 0.52, ion: 'C', r: 15, color: '#d8dee9' },
            { x: 0.22, y: 0.22, z: 0.22, ion: 'C', r: 13, color: '#aeb8c6' },
            { x: 0.78, y: 0.78, z: 0.22, ion: 'C', r: 13, color: '#aeb8c6' },
            { x: 0.22, y: 0.78, z: 0.82, ion: 'C', r: 13, color: '#aeb8c6' },
            { x: 0.78, y: 0.22, z: 0.82, ion: 'C', r: 13, color: '#aeb8c6' },
            { x: 0.08, y: 0.52, z: 0.52, ion: 'C', r: 10, color: '#8f9aa8' },
            { x: 0.92, y: 0.48, z: 0.52, ion: 'C', r: 10, color: '#8f9aa8' }
        ];
        const bonds = [[0,1], [0,2], [0,3], [0,4], [1,5], [2,6], [3,5], [4,6]];
        ctx.save();
        ctx.strokeStyle = 'rgba(216,222,233,0.45)';
        ctx.lineWidth = 2;
        bonds.forEach(([a, b]) => {
            const p = this._project(nodes[a], setup);
            const q = this._project(nodes[b], setup);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.stroke();
        });
        ctx.restore();
        this._drawParticles(ctx, nodes, setup);
        this._drawCrystalCaption(ctx, box, '连续共价网络：每个 C 近似四面体连接 4 个 C', '不是分子晶体');
    },

    _drawDryIce(ctx, box) {
        const setup = this._cubeSetup(box, 0.92);
        const centers = [
            [0.18,0.24,0.25], [0.78,0.18,0.22], [0.28,0.72,0.32], [0.78,0.76,0.34],
            [0.24,0.30,0.78], [0.74,0.26,0.72], [0.28,0.76,0.82], [0.82,0.72,0.78]
        ];
        const projected = centers.map((p, i) => {
            const q = this._project({ x: p[0], y: p[1], z: p[2] }, setup);
            q.angle = i % 2 ? -0.15 : 0.2;
            q.depth = p[0] + p[1] + p[2];
            return q;
        }).sort((a, b) => a.depth - b.depth);

        if (this.showBonds) {
            ctx.save();
            ctx.setLineDash([4, 6]);
            ctx.strokeStyle = 'rgba(136,188,255,0.28)';
            ctx.lineWidth = 1.1;
            for (let i = 0; i < projected.length - 1; i++) {
                ctx.beginPath();
                ctx.moveTo(projected[i].x, projected[i].y);
                ctx.lineTo(projected[i + 1].x, projected[i + 1].y);
                ctx.stroke();
            }
            ctx.restore();
        }
        projected.forEach(p => this._drawCO2(ctx, p.x, p.y, p.angle, this.W < 520 ? 0.72 : 1));
        this._drawCrystalCaption(ctx, box, '离散 CO2 分子规则排列', '分子内共价键；分子间作用力维系晶体');
    },

    _drawParticles(ctx, pts, setup) {
        pts.map(p => ({ ...p, screen: this._project(p, setup) }))
            .sort((a, b) => a.screen.depth - b.screen.depth)
            .forEach(p => {
                const s = p.screen;
                const grad = ctx.createRadialGradient(s.x - p.r * 0.35, s.y - p.r * 0.45, 2, s.x, s.y, p.r * 1.2);
                grad.addColorStop(0, 'rgba(255,255,255,0.95)');
                grad.addColorStop(0.2, p.color);
                grad.addColorStop(1, 'rgba(7,15,18,0.72)');
                ctx.save();
                ctx.shadowColor = p.color;
                ctx.shadowBlur = 12;
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(s.x, s.y, p.r, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
                ctx.strokeStyle = 'rgba(255,255,255,0.28)';
                ctx.stroke();
                ctx.fillStyle = p.ion === 'Cl-' ? 'rgba(7,20,16,0.78)' : 'rgba(255,255,255,0.88)';
                ctx.font = `700 ${Math.max(8, p.r * 0.7)}px ${this._fontFamily(true)}`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                if (p.r > 10) ctx.fillText(p.ion, s.x, s.y + 0.5);
                ctx.restore();
            });
    },

    _drawCO2(ctx, cx, cy, angle, scale) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        const d = 26 * scale;
        ctx.strokeStyle = 'rgba(234,240,247,0.72)';
        ctx.lineWidth = 4 * scale;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-d, 0);
        ctx.lineTo(d, 0);
        ctx.stroke();
        this._atom2D(ctx, -d, 0, 10 * scale, '#d95f5f', 'O');
        this._atom2D(ctx, 0, 0, 9 * scale, '#d8dee9', 'C');
        this._atom2D(ctx, d, 0, 10 * scale, '#d95f5f', 'O');
        ctx.restore();
    },

    _atom2D(ctx, x, y, r, color, label) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.stroke();
        ctx.fillStyle = 'rgba(6,12,15,0.78)';
        ctx.font = `700 ${Math.max(7, r * 0.82)}px ${this._fontFamily(true)}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x, y);
    },

    _drawMetalSlip(ctx, box) {
        ctx.save();
        const y = box.y + box.h - 72;
        ctx.strokeStyle = 'rgba(231,198,107,0.28)';
        ctx.lineWidth = 2;
        ctx.setLineDash([7, 7]);
        ctx.beginPath();
        ctx.moveTo(box.x + 46, y);
        ctx.lineTo(box.x + box.w - 46, y - 18);
        ctx.stroke();
        ctx.fillStyle = 'rgba(231,198,107,0.78)';
        ctx.font = `600 12px ${this._fontFamily(false)}`;
        ctx.fillText('层可错动但金属键不易中断', box.x + 48, y + 22);
        ctx.restore();
    },

    _drawDefectCue(ctx, box, data) {
        ctx.save();
        const x = box.x + box.w - 86;
        const y = box.y + box.h - 96;
        this._roundRect(ctx, x - 18, y - 18, 112, 62, 12);
        ctx.fillStyle = 'rgba(14,24,28,0.82)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,175,80,0.38)';
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,175,80,0.82)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#ffaf50';
        ctx.beginPath();
        ctx.arc(x + 52, y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = `700 11px ${this._fontFamily(false)}`;
        ctx.fillStyle = 'rgba(255,236,210,0.86)';
        ctx.fillText(data.key === 'copper' ? '空位 / 杂质' : '空位 / 替位', x - 8, y + 32);
        ctx.restore();
    },

    _drawCrystalCaption(ctx, box, line1, line2) {
        ctx.save();
        const x = box.x + 18;
        const y = box.y + box.h - 54;
        ctx.font = `700 12px ${this._fontFamily(false)}`;
        ctx.fillStyle = 'rgba(111,209,165,0.95)';
        this._wrapText(ctx, line1, x, y, box.w - 36, 18, 1);
        ctx.font = `500 11px ${this._fontFamily(false)}`;
        ctx.fillStyle = 'rgba(226,241,234,0.66)';
        this._wrapText(ctx, line2, x, y + 20, box.w - 36, 17, 1);
        ctx.restore();
    },

    _drawPanel(ctx, box, data, compact) {
        ctx.save();
        this._roundRect(ctx, box.x, box.y, box.w, box.h, 16);
        ctx.fillStyle = 'rgba(8,18,22,0.78)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(111,209,165,0.16)';
        ctx.stroke();

        let y = box.y + 24;
        ctx.fillStyle = 'rgba(111,209,165,0.95)';
        ctx.font = `800 ${compact ? 12 : 14}px ${this._fontFamily(true)}`;
        ctx.fillText(data.sample, box.x + 18, y);
        y += compact ? 18 : 26;
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.font = `700 ${compact ? 13 : 16}px ${this._fontFamily(false)}`;
        this._wrapText(ctx, data.type + ' / ' + data.coordination, box.x + 18, y, box.w - 36, compact ? 16 : 20, compact ? 1 : 2);
        y += compact ? 24 : 48;

        const rows = compact
            ? [['粒子', data.particles], ['作用力', data.attraction]]
            : [['粒子', data.particles], ['作用力', data.attraction], ['晶胞', data.unit], ['性质', data.properties]];
        rows.forEach(([k, v]) => {
            ctx.fillStyle = 'rgba(111,209,165,0.76)';
            ctx.font = `700 11px ${this._fontFamily(false)}`;
            ctx.fillText(k, box.x + 18, y);
            ctx.fillStyle = 'rgba(226,241,234,0.74)';
            ctx.font = `500 12px ${this._fontFamily(false)}`;
            this._wrapText(ctx, v, box.x + 64, y, box.w - 82, 17, 2);
            y += compact ? 20 : 40;
        });
        ctx.restore();
    },

    _cubeSetup(box, factor) {
        const scale = Math.min(box.w * 0.38, box.h * 0.45, 162) * (factor || 1);
        return {
            scale,
            origin: {
                x: box.x + box.w * 0.5,
                y: box.y + box.h * 0.56
            }
        };
    },

    _project(p, setup) {
        const x = setup.origin.x + (p.x - p.y) * setup.scale * 0.82;
        const y = setup.origin.y + (p.x + p.y - 1) * setup.scale * 0.4 - (p.z - 0.5) * setup.scale * 0.82;
        return { x, y, depth: p.x + p.y + p.z };
    },

    _updateInfo() {
        const info = document.getElementById('crystal-info');
        if (!info) return;
        const d = this._activeData();
        info.innerHTML = `
            <div class="crystal-info__head">
                <span class="crystal-tag">${this._escape(d.sample)}</span>
                <h3>${this._escape(d.title)}</h3>
            </div>
            <div class="crystal-info__grid">
                <div class="crystal-info__row"><span>晶体类型</span><strong>${this._escape(d.type)}</strong></div>
                <div class="crystal-info__row"><span>粒子</span><strong>${this._escape(d.particles)}</strong></div>
                <div class="crystal-info__row"><span>主要作用力</span><strong>${this._escape(d.attraction)}</strong></div>
                <div class="crystal-info__row"><span>结构要点</span><strong>${this._escape(d.structure)}</strong></div>
                <div class="crystal-info__row"><span>晶胞计数</span><strong>${this._escape(d.unit)}</strong></div>
                <div class="crystal-info__row"><span>配位/性质</span><strong>${this._escape(d.coordination)}；${this._escape(d.properties)}</strong></div>
            </div>
            <p class="crystal-info__note">${this._escape(d.note)}</p>
            <p class="crystal-info__source">参考 OpenStax Chemistry 2e 10.5 The Solid State of Matter 与 10.6 Lattice Structures in Crystalline Solids。</p>
        `;
    },

    _escape(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
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
        const radius = Math.min(r, w / 2, h / 2);
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

function initCrystalStructures() {
    CrystalStructures.init();
}

window.CrystalStructures = CrystalStructures;
window.initCrystalStructures = initCrystalStructures;
