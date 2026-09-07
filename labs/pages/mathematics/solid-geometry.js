// ===== Solid Geometry v2 =====
// 3D polyhedra with drag rotation, cross-section, face shading, education panel

const SolidGeom = {
    canvas: null, ctx: null, W: 0, H: 0,
    _listeners: [], _resizeObs: null, _raf: null,
    running: true, paused: false, speed: 1,
    time: 0, _lastT: 0,

    shape: 'cube',
    rotX: 0.4, rotY: 0.6,
    autoRotate: true,
    crossSection: 0.5,
    dragging: false, _dragX: 0, _dragY: 0, _dragRX: 0, _dragRY: 0,
    hoverX: -1, hoverY: -1,

    LIGHT: [0.25, 0.5, 0.7],   // view-space light direction (normalised later)
    SHAPES: null,

    _on(el, evt, fn, opts) { el.addEventListener(evt, fn, opts); this._listeners.push({ el, evt, fn, opts }); },

    /* ─── lifecycle ─── */
    init() {
        this.canvas = document.getElementById('solidgeom-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.time = 0; this._lastT = 0;
        this.running = true; this.paused = false; this.speed = 1;
        this.rotX = 0.4; this.rotY = 0.6;
        this.hoverX = -1; this.hoverY = -1;
        this.buildShapes();
        this.resize();
        this.bindEvents();
        this.updateInfo();
        const L = this.LIGHT, m = Math.hypot(L[0], L[1], L[2]);
        this.LIGHT = [L[0] / m, L[1] / m, L[2] / m];
        this._lastT = performance.now();
        this.loop();
    },
    destroy() {
        this.running = false;
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
        for (const l of this._listeners) l.el.removeEventListener(l.evt, l.fn, l.opts);
        this._listeners = [];
        if (this._resizeObs) { this._resizeObs.disconnect(); this._resizeObs = null; }
    },
    resize() {
        const wrap = this.canvas.parentElement;
        if (!wrap) return;
        const dpr = window.devicePixelRatio || 1;
        const w = wrap.getBoundingClientRect().width;
        const h = Math.min(Math.max(w * 0.52, 300), 420);
        this.canvas.width = w * dpr; this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w; this.H = h;
    },

    /* ─── shapes ─── */
    buildShapes() {
        const s = 1, sq89 = Math.sqrt(8 / 9), sq23 = Math.sqrt(2 / 3), sq29 = Math.sqrt(2 / 9);
        this.SHAPES = {
            cube: { name: '正方体', V: 8, E: 12, F: 6, vol: 'V = a³', surf: 'S = 6a²',
                verts: [[-s,-s,-s],[s,-s,-s],[s,s,-s],[-s,s,-s],[-s,-s,s],[s,-s,s],[s,s,s],[-s,s,s]],
                edges: [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]],
                faces: [[0,1,2,3],[7,6,5,4],[0,4,5,1],[3,2,6,7],[0,3,7,4],[1,5,6,2]],
                csDesc: '正方形' },
            tetrahedron: { name: '正四面体', V: 4, E: 6, F: 4, vol: 'V = √2/12·a³', surf: 'S = √3·a²',
                verts: [[0,s,0],[sq89*s,-s/3,0],[-sq29*s,-s/3,sq23*s],[-sq29*s,-s/3,-sq23*s]],
                edges: [[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]],
                faces: [[0,1,2],[0,2,3],[0,3,1],[1,3,2]],
                csDesc: '三角形' },
            octahedron: { name: '正八面体', V: 6, E: 12, F: 8, vol: 'V = √2/3·a³', surf: 'S = 2√3·a²',
                verts: [[s,0,0],[-s,0,0],[0,s,0],[0,-s,0],[0,0,s],[0,0,-s]],
                edges: [[0,2],[0,3],[0,4],[0,5],[1,2],[1,3],[1,4],[1,5],[2,4],[2,5],[3,4],[3,5]],
                faces: [[0,2,4],[0,4,3],[0,3,5],[0,5,2],[1,4,2],[1,3,4],[1,5,3],[1,2,5]],
                csDesc: '正方形 / 六边形' }
        };
        // cylinder
        const N = 20, r = 0.8, h = 1;
        const cv = [], ce = [];
        for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2; cv.push([r * Math.cos(a), -h, r * Math.sin(a)]); }
        for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2; cv.push([r * Math.cos(a), h, r * Math.sin(a)]); }
        for (let i = 0; i < N; i++) { ce.push([i, (i + 1) % N]); ce.push([i + N, (i + 1) % N + N]); ce.push([i, i + N]); }
        const cf = []; // side quads
        for (let i = 0; i < N; i++) cf.push([i, (i + 1) % N, (i + 1) % N + N, i + N]);
        this.SHAPES.cylinder = { name: '圆柱体', V: '∞', E: '∞', F: 3, vol: 'V = πr²h', surf: 'S = 2πr(r+h)',
            verts: cv, edges: ce, faces: cf, topRing: N, csDesc: '圆 / 矩形' };
        // cone
        const cnv = [[0, h * 1.2, 0]]; const cne = [], cnf = [];
        for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2; cnv.push([r * 0.9 * Math.cos(a), -h, r * 0.9 * Math.sin(a)]); }
        for (let i = 0; i < N; i++) { cne.push([0, i + 1]); cne.push([i + 1, i % N + 2 > N ? 1 : i + 2]); }
        for (let i = 0; i < N; i++) cnf.push([0, i + 1, (i + 1) % N + 1]);
        this.SHAPES.cone = { name: '圆锥体', V: '∞', E: '∞', F: 2, vol: 'V = πr²h/3', surf: 'S = πr(r+l)',
            verts: cnv, edges: cne, faces: cnf, csDesc: '圆 / 三角形' };
    },

    /* ─── events ─── */
    bindEvents() {
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver(() => this.resize());
            this._resizeObs.observe(this.canvas.parentElement);
        }
        // shape buttons
        document.querySelectorAll('.sg-shape-btn').forEach(btn => {
            this._on(btn, 'click', () => {
                document.querySelectorAll('.sg-shape-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
                btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true');
                this.shape = btn.dataset.shape;
                this.updateInfo();
            });
        });
        // cross-section slider
        const cs = document.getElementById('sg-cross');
        const csv = document.getElementById('sg-cross-val');
        if (cs) this._on(cs, 'input', () => {
            this.crossSection = parseFloat(cs.value);
            if (csv) csv.textContent = (this.crossSection * 100).toFixed(0) + '%';
            this.updateInfo();
        });
        // speed
        const spd = document.getElementById('sg-speed');
        if (spd) this._on(spd, 'input', () => { this.speed = parseFloat(spd.value); });
        // pause
        const pb = document.getElementById('sg-pause');
        if (pb) this._on(pb, 'click', () => {
            this.paused = !this.paused;
            pb.textContent = this.paused ? '▶' : '⏸';
            pb.setAttribute('aria-label', this.paused ? '继续' : '暂停');
        });
        // drag rotation
        const startDrag = (x, y) => { this.dragging = true; this.autoRotate = false; this._dragX = x; this._dragY = y; this._dragRX = this.rotX; this._dragRY = this.rotY; };
        const moveDrag = (x, y) => { if (!this.dragging) return; this.rotY = this._dragRY + (x - this._dragX) * 0.008; this.rotX = this._dragRX + (y - this._dragY) * 0.008; this.rotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.rotX)); };
        const endDrag = () => { this.dragging = false; };
        this._on(this.canvas, 'mousedown', e => { startDrag(e.clientX, e.clientY); });
        this._on(window, 'mousemove', e => { moveDrag(e.clientX, e.clientY); });
        this._on(window, 'mouseup', endDrag);
        this._on(this.canvas, 'touchstart', e => { const t = e.touches[0]; startDrag(t.clientX, t.clientY); }, { passive: true });
        this._on(window, 'touchmove', e => { if (!this.dragging) return; const t = e.touches[0]; moveDrag(t.clientX, t.clientY); }, { passive: true });
        this._on(window, 'touchend', endDrag);
        // hover
        this._on(this.canvas, 'mousemove', e => { const r = this.canvas.getBoundingClientRect(); this.hoverX = e.clientX - r.left; this.hoverY = e.clientY - r.top; });
        this._on(this.canvas, 'mouseleave', () => { this.hoverX = -1; this.hoverY = -1; });
        // double-click to re-enable auto rotate
        this._on(this.canvas, 'dblclick', () => { this.autoRotate = true; });
    },

    /* ─── 3D ─── */
    _rot(x, y, z) {
        const cX = Math.cos(this.rotX), sX = Math.sin(this.rotX), cY = Math.cos(this.rotY), sY = Math.sin(this.rotY);
        const x1 = x * cY - z * sY, z1 = x * sY + z * cY;
        return [x1, y * cX - z1 * sX, y * sX + z1 * cX];
    },
    project(x, y, z) {
        const [rx, ry, rz] = this._rot(x, y, z);
        const sc = Math.min(this.W, this.H) * 0.28;
        return { x: this.W / 2 + rx * sc, y: this.H / 2 - ry * sc, z: rz };
    },
    faceNormalZ(projs, face) {
        const a = projs[face[0]], b = projs[face[1]], c = projs[face[2]];
        return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    },

    /* ─── loop ─── */
    loop() {
        if (!this.running) return;
        const now = performance.now();
        if (!this.paused) {
            const dt = Math.min((now - this._lastT) / 1000, 0.05);
            this.time += dt * this.speed;
            if (this.autoRotate) this.rotY += dt * this.speed * 0.5;
        }
        this._lastT = now;
        this.draw();
        this._raf = requestAnimationFrame(() => this.loop());
    },

    draw() {
        const { ctx, W, H } = this;
        if (!ctx || W === 0) return;
        ctx.clearRect(0, 0, W, H);
        const data = this.SHAPES[this.shape];
        if (!data) return;
        const projs = data.verts.map(v => this.project(v[0], v[1], v[2]));
        this.drawFaces(data, projs);
        this.drawEdges(data, projs);
        this.drawVertices(data, projs);
        this.drawCrossSection(data);
        this.drawHover(data, projs);
    },

    drawFaces(data, projs) {
        const { ctx } = this;
        const L = this.LIGHT;
        const sorted = data.faces.map((f, i) => ({
            f, z: f.reduce((s, vi) => s + projs[vi].z, 0) / f.length
        })).sort((a, b) => a.z - b.z);
        for (const { f } of sorted) {
            const nz = this.faceNormalZ(projs, f);
            if (nz <= 0) continue; // backface cull
            // simple shading based on normal-Z (camera-facing brightness)
            const brightness = 0.08 + Math.min(nz / 50000, 0.12);
            ctx.fillStyle = `rgba(91,141,206,${brightness.toFixed(3)})`;
            ctx.beginPath();
            f.forEach((vi, i) => i === 0 ? ctx.moveTo(projs[vi].x, projs[vi].y) : ctx.lineTo(projs[vi].x, projs[vi].y));
            ctx.closePath(); ctx.fill();
        }
    },
    drawEdges(data, projs) {
        const { ctx } = this;
        ctx.strokeStyle = 'rgba(91,141,206,0.4)'; ctx.lineWidth = 1.2;
        for (const [a, b] of data.edges) {
            ctx.beginPath(); ctx.moveTo(projs[a].x, projs[a].y); ctx.lineTo(projs[b].x, projs[b].y); ctx.stroke();
        }
    },
    drawVertices(data, projs) {
        const { ctx } = this;
        // Only for polyhedra (not cylinder/cone with many verts)
        if (data.verts.length > 30) return;
        for (let i = 0; i < projs.length; i++) {
            const p = projs[i];
            const sz = 2 + (p.z + 1) * 0.8; // depth-based size
            ctx.fillStyle = `rgba(91,141,206,${(0.4 + (p.z + 1) * 0.15).toFixed(2)})`;
            ctx.beginPath(); ctx.arc(p.x, p.y, sz, 0, Math.PI * 2); ctx.fill();
        }
    },

    /* ─── cross section ─── */
    drawCrossSection(data) {
        const { ctx, W, H, crossSection } = this;
        const yLevel = (crossSection * 2 - 1); // -1 to 1

        // compute edge-plane intersections
        const pts3d = [];
        for (const [a, b] of data.edges) {
            const y1 = data.verts[a][1], y2 = data.verts[b][1];
            if ((y1 - yLevel) * (y2 - yLevel) < 0) {
                const t = (yLevel - y1) / (y2 - y1);
                pts3d.push([
                    data.verts[a][0] + t * (data.verts[b][0] - data.verts[a][0]),
                    yLevel,
                    data.verts[a][2] + t * (data.verts[b][2] - data.verts[a][2])
                ]);
            }
        }
        if (pts3d.length < 3) {
            // draw dashed line anyway
            const py = this.project(0, yLevel, 0).y;
            ctx.strokeStyle = 'rgba(224,108,117,0.2)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.moveTo(W * 0.12, py); ctx.lineTo(W * 0.88, py); ctx.stroke(); ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(224,108,117,0.3)'; ctx.font = '17px ' + CF.mono; ctx.textAlign = 'left';
            ctx.fillText('截面 h=' + (crossSection * 100).toFixed(0) + '%', W * 0.12, py - 5);
            return;
        }
        // sort by angle around centroid in 3D xz-plane
        const cx3 = pts3d.reduce((s, p) => s + p[0], 0) / pts3d.length;
        const cz3 = pts3d.reduce((s, p) => s + p[2], 0) / pts3d.length;
        pts3d.sort((a, b) => Math.atan2(a[2] - cz3, a[0] - cx3) - Math.atan2(b[2] - cz3, b[0] - cx3));

        const proj2d = pts3d.map(p => this.project(p[0], p[1], p[2]));

        // filled cross-section polygon
        ctx.fillStyle = 'rgba(224,108,117,0.18)';
        ctx.strokeStyle = 'rgba(224,108,117,0.55)'; ctx.lineWidth = 1.8;
        ctx.beginPath();
        proj2d.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
        ctx.closePath(); ctx.fill(); ctx.stroke();

        // label
        const labelP = proj2d[0];
        ctx.fillStyle = 'rgba(224,108,117,0.6)'; ctx.font = '17px ' + CF.mono; ctx.textAlign = 'left';
        ctx.fillText('截面 (' + pts3d.length + '边)', labelP.x + 6, labelP.y - 4);
    },

    /* ─── hover ─── */
    drawHover(data, projs) {
        if (this.hoverX < 0 || data.verts.length > 30) return;
        const { ctx } = this;
        let best = -1, bestD = 18;
        for (let i = 0; i < projs.length; i++) {
            const d = Math.hypot(this.hoverX - projs[i].x, this.hoverY - projs[i].y);
            if (d < bestD) { bestD = d; best = i; }
        }
        if (best < 0) return;
        const p = projs[best], v = data.verts[best];
        // highlight
        ctx.strokeStyle = 'rgba(229,192,123,0.7)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.stroke();
        // tooltip
        const label = `(${v[0].toFixed(2)}, ${v[1].toFixed(2)}, ${v[2].toFixed(2)})`;
        const tw = ctx.measureText(label).width + 14;
        const tx = Math.min(p.x + 10, this.W - tw - 4), ty = Math.max(p.y - 26, 4);
        ctx.fillStyle = 'rgba(20,22,30,0.88)'; ctx.beginPath(); ctx.roundRect(tx, ty, tw, 20, 4); ctx.fill();
        ctx.fillStyle = 'rgba(229,192,123,0.9)'; ctx.font = '17px ' + CF.mono; ctx.textAlign = 'left';
        ctx.fillText(label, tx + 7, ty + 14);
    },

    /* ─── education panel ─── */
    updateInfo() {
        const el = document.getElementById('sg-info');
        if (!el) return;
        const d = this.SHAPES[this.shape];
        if (!d) return;
        const euler = typeof d.V === 'number' ? `${d.V} - ${d.E} + ${d.F} = ${d.V - d.E + d.F}` : '(光滑曲面不适用)';
        const csH = (this.crossSection * 100).toFixed(0);
        let h = `<div class="sg-hd"><span class="sg-tag">${d.name}</span>三维几何体</div>
<div class="sg-row"><span class="sg-key">体积</span>${d.vol}</div>
<div class="sg-row"><span class="sg-key sg-key--purple">表面积</span>${d.surf}</div>
<div class="sg-row"><span class="sg-key sg-key--amber">欧拉公式</span>V - E + F = ${euler}</div>
<div class="sg-row"><span class="sg-key">截面形状</span>${d.csDesc}（h = ${csH}%）</div>
<div class="sg-note">💡 拖拽画布旋转，双击恢复自动旋转。${typeof d.V === 'number' ? '所有凸多面体满足欧拉公式 V-E+F=2' : '圆柱/圆锥母线为直线，侧面可展开为平面图形'}</div>`;
        el.innerHTML = h;
    }
};

function initSolidGeom() { SolidGeom.init(); }
window.SolidGeom = SolidGeom;
window.initSolidGeom = initSolidGeom;