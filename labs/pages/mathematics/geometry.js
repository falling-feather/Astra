// ===== 几何可视化（变换 + 三角形几何） =====

const GeoTransform = {
    canvas: null,
    ctx: null,
    mode: 'transform', // 'transform' | 'triangle'

    // ── Transform mode ──
    shape: [[-1, -1], [1, -1], [1, 1], [-1, 1]],
    tx: 0, ty: 0, angle: 0, sx: 1, sy: 1, shx: 0,
    mirror: 'none',
    viewRange: 6,
    viewCenterX: 0, viewCenterY: 0,
    _panning: false, _panStartX: 0, _panStartY: 0,
    _panCX0: 0, _panCY0: 0,
    animating: false, animId: null, animTime: 0,

    // ── Triangle mode ──
    triVerts: [[-2, -1.5], [3, -1], [0.5, 3]],
    dragIdx: -1,
    showCircumcircle: true,
    showIncircle: true,
    showCentroid: true,
    showOrthocenter: true,
    showEulerLine: true,
    showAngles: true,
    showSideLengths: true,
    showMedians: false,
    showAltitudes: false,

    _resObs: null,
    _listeners: [],

    // ── Init ──
    init() {
        this.canvas = document.getElementById('geo-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this._injectModeButtons();
        this.bindControls();
        this._bindCanvasEvents();
        if (typeof ResizeObserver !== 'undefined') {
            this._resObs = new ResizeObserver(() => this.draw());
            this._resObs.observe(this.canvas.parentElement);
        }
        this.draw();
        this.updateEdu();
    },

    destroy() {
        if (this._resObs) { this._resObs.disconnect(); this._resObs = null; }
        this.stopAnimate();
        this._listeners.forEach(([el, evt, fn, opts]) => el.removeEventListener(evt, fn, opts));
        this._listeners = [];
    },

    _on(el, evt, fn, opts) {
        if (!el) return;
        el.addEventListener(evt, fn, opts);
        this._listeners.push([el, evt, fn, opts]);
    },

    // ── Mode switching ──
    _injectModeButtons() {
        const header = this.canvas.closest('.demo-section')?.querySelector('.section-header');
        if (!header || document.getElementById('geo-mode-btns')) return;
        const div = document.createElement('div');
        div.id = 'geo-mode-btns';
        div.className = 'geo-mode-btns';
        div.innerHTML = `
            <button class="geo-mode-btn active" data-mode="transform">仿射变换</button>
            <button class="geo-mode-btn" data-mode="triangle">三角形几何</button>`;
        header.appendChild(div);
        div.querySelectorAll('button').forEach(b => {
            this._on(b, 'click', () => {
                this.stopAnimate();
                this.mode = b.dataset.mode;
                div.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
                this._updateMode();
                this.draw();
                this.updateEdu();
            });
        });
    },

    _updateMode() {
        const ctrlEl = document.getElementById('geo-controls');
        if (!ctrlEl) return;
        if (this.mode === 'triangle') {
            ctrlEl.style.display = 'none';
            this._ensureTrianglePanel();
            const tp = document.getElementById('geo-tri-panel');
            if (tp) tp.style.display = '';
        } else {
            ctrlEl.style.display = '';
            const tp = document.getElementById('geo-tri-panel');
            if (tp) tp.style.display = 'none';
        }
        this._updateLegend();
    },

    _ensureTrianglePanel() {
        if (document.getElementById('geo-tri-panel')) return;
        const ctrlEl = document.getElementById('geo-controls');
        if (!ctrlEl) return;
        const panel = document.createElement('div');
        panel.id = 'geo-tri-panel';
        panel.className = 'geo-tri-panel';
        const opts = [
            ['showCircumcircle', '外接圆', true],
            ['showIncircle', '内切圆', true],
            ['showCentroid', '重心', true],
            ['showOrthocenter', '垂心', true],
            ['showEulerLine', '欧拉线', true],
            ['showAngles', '角度', true],
            ['showSideLengths', '边长', true],
            ['showMedians', '中线', false],
            ['showAltitudes', '高线', false],
        ];
        opts.forEach(([key, label, def]) => {
            const lbl = document.createElement('label');

            lbl.innerHTML = `<input type="checkbox" ${def ? 'checked' : ''}> ${label}`;
            this._on(lbl.querySelector('input'), 'change', (e) => {
                this[key] = e.target.checked;
                this.draw();
            });
            panel.appendChild(lbl);
        });
        const hint = document.createElement('div');
        hint.className = 'geo-tri-hint';
        hint.textContent = '💡 拖拽顶点移动三角形 · 滚轮缩放 · 空白处拖拽平移 · 双击重置视图';
        panel.appendChild(hint);
        ctrlEl.parentElement.insertBefore(panel, ctrlEl);
    },

    _updateLegend() {
        const wrap = this.canvas.closest('.geo-canvas-wrap');
        if (!wrap) return;
        let legend = wrap.querySelector('.geo-legend');
        if (!legend) return;
        if (this.mode === 'triangle') {
            legend.innerHTML = `
                <span style="color:#5b8dce">● 外接圆</span>
                <span style="color:#4d9e7e">● 内切圆</span>
                <span style="color:#e06c75">● 重心</span>
                <span style="color:#8b6fc0">● 垂心</span>
                <span style="color:#d4a843">— 欧拉线</span>
                <span style="color:#5b8dce">○ 外心</span>`;
        } else {
            legend.innerHTML = '<span class="gl-orig">原始</span><span class="gl-trans">变换后</span>';
        }
    },

    // ── Controls ──
    bindControls() {
        const sliders = {
            'geo-tx': (v) => { this.tx = v; },
            'geo-ty': (v) => { this.ty = v; },
            'geo-angle': (v) => { this.angle = v; },
            'geo-sx': (v) => { this.sx = v; },
            'geo-sy': (v) => { this.sy = v; },
            'geo-shx': (v) => { this.shx = v; }
        };
        for (const [id, setter] of Object.entries(sliders)) {
            const el = document.getElementById(id);
            if (el) {
                this._on(el, 'input', (e) => {
                    setter(parseFloat(e.target.value));
                    const lbl = document.getElementById(id + '-val');
                    if (lbl) lbl.textContent = parseFloat(e.target.value).toFixed(id === 'geo-angle' ? 0 : 2);
                    this.draw();
                });
            }
        }
    },

    // ── Canvas mouse events (Triangle drag + zoom/pan) ──
    _bindCanvasEvents() {
        const c = this.canvas;
        const getPos = (e) => {
            const rect = c.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            const cx = clientX - rect.left, cy = clientY - rect.top;
            const w = rect.width, h = rect.height;
            const vr = this.viewRange;
            return [
                (cx / w) * 2 * vr - vr + this.viewCenterX,
                vr - (cy / h) * 2 * vr + this.viewCenterY
            ];
        };
        const startDrag = (e) => {
            if (e.button !== undefined && e.button !== 0) return;
            const [mx, my] = getPos(e);
            // In triangle mode, first check vertex hit
            if (this.mode === 'triangle') {
                let best = -1, bestD = 0.5;
                this.triVerts.forEach((v, i) => {
                    const d = Math.hypot(v[0] - mx, v[1] - my);
                    if (d < bestD) { bestD = d; best = i; }
                });
                if (best >= 0) { this.dragIdx = best; c.style.cursor = 'grabbing'; return; }
            }
            // Otherwise start pan
            this._panning = true;
            this._panStartX = e.touches ? e.touches[0].clientX : e.clientX;
            this._panStartY = e.touches ? e.touches[0].clientY : e.clientY;
            this._panCX0 = this.viewCenterX;
            this._panCY0 = this.viewCenterY;
            c.style.cursor = 'grabbing';
        };
        const moveDrag = (e) => {
            if (this.dragIdx >= 0) {
                if (e.cancelable) e.preventDefault();
                const [mx, my] = getPos(e);
                this.triVerts[this.dragIdx] = [mx, my];
                this.draw();
            } else if (this._panning) {
                if (e.cancelable) e.preventDefault();
                const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                const clientY = e.touches ? e.touches[0].clientY : e.clientY;
                const rect = c.getBoundingClientRect();
                const dx = clientX - this._panStartX;
                const dy = clientY - this._panStartY;
                this.viewCenterX = this._panCX0 - (dx / rect.width) * 2 * this.viewRange;
                this.viewCenterY = this._panCY0 + (dy / rect.height) * 2 * this.viewRange;
                this.draw();
            } else if (!e.touches && this.mode === 'triangle') {
                const [mx, my] = getPos(e);
                let hover = false;
                this.triVerts.forEach(v => {
                    if (Math.hypot(v[0] - mx, v[1] - my) < 0.5) hover = true;
                });
                c.style.cursor = hover ? 'grab' : 'default';
            }
        };
        const endDrag = () => { this.dragIdx = -1; this._panning = false; c.style.cursor = 'grab'; };

        // Mouse
        this._on(c, 'mousedown', startDrag);
        this._on(c, 'mousemove', moveDrag);
        this._on(c, 'mouseup', endDrag);
        this._on(c, 'mouseleave', endDrag);

        // Wheel zoom
        this._on(c, 'wheel', (e) => {
            e.preventDefault();
            const factor = e.deltaY > 0 ? 1.1 : 1 / 1.1;
            this.viewRange = Math.max(1, Math.min(50, this.viewRange * factor));
            this.draw();
        }, { passive: false });

        // Touch
        this._on(c, 'touchstart', (e) => { startDrag(e); }, { passive: true });
        this._on(c, 'touchmove', (e) => { moveDrag(e); }, { passive: false });
        this._on(c, 'touchend', endDrag);
        this._on(c, 'touchcancel', endDrag);

        // Double-click to reset view
        this._on(c, 'dblclick', () => {
            this.viewRange = 6; this.viewCenterX = 0; this.viewCenterY = 0;
            this.draw();
        });

        c.style.cursor = 'grab';
    },

    // ── Transform matrix ──
    getMatrix() {
        const rad = this.angle * Math.PI / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        let mx = 1, my = 1;
        if (this.mirror === 'x') my = -1;
        if (this.mirror === 'y') mx = -1;
        const sm = [[mx + this.shx * 0, this.shx * my], [0, my]];
        const ssm = [[this.sx * sm[0][0], this.sx * sm[0][1]], [this.sy * sm[1][0], this.sy * sm[1][1]]];
        const rssm = [
            [cos * ssm[0][0] - sin * ssm[1][0], cos * ssm[0][1] - sin * ssm[1][1]],
            [sin * ssm[0][0] + cos * ssm[1][0], sin * ssm[0][1] + cos * ssm[1][1]]
        ];
        return { a: rssm[0][0], b: rssm[0][1], c: rssm[1][0], d: rssm[1][1], tx: this.tx, ty: this.ty };
    },

    transformPoint(pt, mat) {
        return [mat.a * pt[0] + mat.b * pt[1] + mat.tx, mat.c * pt[0] + mat.d * pt[1] + mat.ty];
    },

    // ── Canvas sizing ──
    sizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const w = Math.round(rect.width);
        const h = Math.round(Math.max(w * 0.75, 300));
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { w, h };
    },

    mapX(x, w) { return ((x - this.viewCenterX + this.viewRange) / (2 * this.viewRange)) * w; },
    mapY(y, h) { return ((this.viewRange - (y - this.viewCenterY)) / (2 * this.viewRange)) * h; },

    // ── Main draw ──
    draw() {
        if (!this.ctx) return;
        const { w, h } = this.sizeCanvas();
        const ctx = this.ctx;
        const vr = this.viewRange;

        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--surface-2').trim() || '#151822';
        ctx.fillRect(0, 0, w, h);

        // Grid
        const gxMin = Math.floor(this.viewCenterX - vr);
        const gxMax = Math.ceil(this.viewCenterX + vr);
        const gyMin = Math.floor(this.viewCenterY - vr);
        const gyMax = Math.ceil(this.viewCenterY + vr);
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1;
        for (let g = gxMin; g <= gxMax; g++) {
            const px = this.mapX(g, w);
            ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
        }
        for (let g = gyMin; g <= gyMax; g++) {
            const py = this.mapY(g, h);
            ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
        }
        // Axes
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1.5;
        const ox = this.mapX(0, w), oy = this.mapY(0, h);
        ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(w, oy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox, h); ctx.stroke();
        // Axis labels
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '16px ' + CF.mono;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        for (let g = gxMin; g <= gxMax; g++) {
            if (g === 0) continue;
            ctx.fillText(g, this.mapX(g, w), oy + 3);
        }
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        for (let g = gyMin; g <= gyMax; g++) {
            if (g === 0) continue;
            ctx.fillText(g, ox - 5, this.mapY(g, h));
        }
        // Origin
        ctx.beginPath();
        ctx.arc(ox, oy, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fill();

        if (this.mode === 'transform') this._drawTransformMode(ctx, w, h);
        else this._drawTriangleMode(ctx, w, h);
    },

    // ══════════════════ TRANSFORM MODE ══════════════════
    _drawTransformMode(ctx, w, h) {
        // Original shape (ghost)
        this._drawShapePoly(ctx, w, h, this.shape, 'rgba(91,141,206,0.15)', 'rgba(91,141,206,0.3)', true);
        // Transformed
        const mat = this.getMatrix();
        const transformed = this.shape.map(pt => this.transformPoint(pt, mat));
        this._drawShapePoly(ctx, w, h, transformed, 'rgba(196,121,58,0.15)', '#c4793a', false);
        // Center of transform
        const center = this.transformPoint([0, 0], mat);
        const cx = this.mapX(center[0], w), cy = this.mapY(center[1], h);
        ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#c4793a'; ctx.shadowColor = '#c4793a'; ctx.shadowBlur = 8;
        ctx.fill(); ctx.shadowBlur = 0;
        // Matrix + determinant + eigenvalues info
        this._drawMatrixInfo(ctx, w, h, mat);
    },

    _drawShapePoly(ctx, w, h, pts, fillColor, strokeColor, dashed) {
        if (pts.length < 2) return;
        ctx.beginPath();
        pts.forEach((pt, i) => {
            const px = this.mapX(pt[0], w), py = this.mapY(pt[1], h);
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.fillStyle = fillColor; ctx.fill();
        if (dashed) ctx.setLineDash([4, 3]);
        ctx.strokeStyle = strokeColor; ctx.lineWidth = dashed ? 1.5 : 2.5;
        ctx.stroke();
        if (dashed) ctx.setLineDash([]);
        // Vertices
        const labels = 'ABCDEFGHIJ';
        pts.forEach((pt, i) => {
            const px = this.mapX(pt[0], w), py = this.mapY(pt[1], h);
            ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2);
            ctx.fillStyle = strokeColor; ctx.fill();
            if (!dashed && i < labels.length) {
                ctx.fillStyle = 'rgba(255,255,255,0.6)';
                ctx.font = '16px ' + CF.sans;
                ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
                ctx.fillText(labels[i] + "'", px + 5, py - 3);
            }
        });
    },

    _drawMatrixInfo(ctx, w, h, mat) {
        const pad = 12;
        const x0 = w - 200, y0 = pad;
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(x0 - 8, y0 - 4, 200, 80);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '16px ' + CF.mono;
        ctx.textAlign = 'left';
        ctx.fillText('变换矩阵:', x0, y0 + 10);
        ctx.fillText(`[ ${mat.a.toFixed(2)}  ${mat.b.toFixed(2)}  ${mat.tx.toFixed(2)} ]`, x0, y0 + 24);
        ctx.fillText(`[ ${mat.c.toFixed(2)}  ${mat.d.toFixed(2)}  ${mat.ty.toFixed(2)} ]`, x0, y0 + 38);
        // Determinant
        const det = mat.a * mat.d - mat.b * mat.c;
        ctx.fillText(`det = ${det.toFixed(3)}  (面积×${Math.abs(det).toFixed(2)})`, x0, y0 + 54);
        // Eigenvalues of 2x2 [a,b;c,d]
        const tr = mat.a + mat.d;
        const disc = tr * tr - 4 * det;
        let eigStr;
        if (disc >= 0) {
            const e1 = (tr + Math.sqrt(disc)) / 2;
            const e2 = (tr - Math.sqrt(disc)) / 2;
            eigStr = `λ = ${e1.toFixed(2)}, ${e2.toFixed(2)}`;
        } else {
            const re = tr / 2, im = Math.sqrt(-disc) / 2;
            eigStr = `λ = ${re.toFixed(2)} ± ${im.toFixed(2)}i`;
        }
        ctx.fillText(eigStr, x0, y0 + 68);
    },

    // ══════════════════ TRIANGLE MODE ══════════════════
    _drawTriangleMode(ctx, w, h) {
        const [A, B, C] = this.triVerts;

        // Draw triangle
        ctx.beginPath();
        ctx.moveTo(this.mapX(A[0], w), this.mapY(A[1], h));
        ctx.lineTo(this.mapX(B[0], w), this.mapY(B[1], h));
        ctx.lineTo(this.mapX(C[0], w), this.mapY(C[1], h));
        ctx.closePath();
        ctx.fillStyle = 'rgba(91,141,206,0.08)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(91,141,206,0.7)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Medians
        if (this.showMedians) {
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = 'rgba(230,180,80,0.5)'; ctx.lineWidth = 1;
            [[A, this._midpoint(B, C)], [B, this._midpoint(A, C)], [C, this._midpoint(A, B)]].forEach(([p, m]) => {
                ctx.beginPath();
                ctx.moveTo(this.mapX(p[0], w), this.mapY(p[1], h));
                ctx.lineTo(this.mapX(m[0], w), this.mapY(m[1], h));
                ctx.stroke();
            });
            ctx.setLineDash([]);
        }

        // Altitudes
        if (this.showAltitudes) {
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = 'rgba(180,100,220,0.5)'; ctx.lineWidth = 1;
            [[A, B, C], [B, A, C], [C, A, B]].forEach(([V, P, Q]) => {
                const foot = this._footOfAltitude(V, P, Q);
                ctx.beginPath();
                ctx.moveTo(this.mapX(V[0], w), this.mapY(V[1], h));
                ctx.lineTo(this.mapX(foot[0], w), this.mapY(foot[1], h));
                ctx.stroke();
            });
            ctx.setLineDash([]);
        }

        // Circumscribed circle
        if (this.showCircumcircle) {
            const cc = this._circumcenter(A, B, C);
            if (cc) {
                const r = Math.hypot(cc[0] - A[0], cc[1] - A[1]);
                const cxp = this.mapX(cc[0], w), cyp = this.mapY(cc[1], h);
                const rPx = (r / (2 * this.viewRange)) * w;
                ctx.beginPath(); ctx.arc(cxp, cyp, rPx, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(91,141,206,0.5)'; ctx.lineWidth = 1.5;
                ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
                // Circumcenter dot
                ctx.beginPath(); ctx.arc(cxp, cyp, 4, 0, Math.PI * 2);
                ctx.fillStyle = '#5b8dce'; ctx.fill();
                this._drawLabel(ctx, cxp, cyp, '外心', '#5b8dce');
            }
        }

        // Inscribed circle
        if (this.showIncircle) {
            const ic = this._incenter(A, B, C);
            const r = this._inradius(A, B, C);
            if (ic && r > 0) {
                const cxp = this.mapX(ic[0], w), cyp = this.mapY(ic[1], h);
                const rPx = (r / (2 * this.viewRange)) * w;
                ctx.beginPath(); ctx.arc(cxp, cyp, rPx, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(77,158,126,0.6)'; ctx.lineWidth = 1.5;
                ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
                ctx.beginPath(); ctx.arc(cxp, cyp, 4, 0, Math.PI * 2);
                ctx.fillStyle = '#4d9e7e'; ctx.fill();
                this._drawLabel(ctx, cxp, cyp, '内心', '#4d9e7e');
            }
        }

        // Centroid
        if (this.showCentroid) {
            const G = this._centroid(A, B, C);
            const gx = this.mapX(G[0], w), gy = this.mapY(G[1], h);
            ctx.beginPath(); ctx.arc(gx, gy, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#e06c75'; ctx.fill();
            this._drawLabel(ctx, gx, gy, '重心', '#e06c75');
        }

        // Orthocenter
        if (this.showOrthocenter) {
            const H = this._orthocenter(A, B, C);
            if (H) {
                const hx = this.mapX(H[0], w), hy = this.mapY(H[1], h);
                ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2);
                ctx.fillStyle = '#8b6fc0'; ctx.fill();
                this._drawLabel(ctx, hx, hy, '垂心', '#8b6fc0');
            }
        }

        // Euler Line (circumcenter → centroid → orthocenter)
        if (this.showEulerLine) {
            const cc = this._circumcenter(A, B, C);
            const H = this._orthocenter(A, B, C);
            if (cc && H) {
                ctx.beginPath();
                ctx.moveTo(this.mapX(cc[0], w), this.mapY(cc[1], h));
                ctx.lineTo(this.mapX(H[0], w), this.mapY(H[1], h));
                ctx.strokeStyle = '#d4a843'; ctx.lineWidth = 1.5;
                ctx.setLineDash([8, 4]); ctx.stroke(); ctx.setLineDash([]);
            }
        }

        // Side lengths
        if (this.showSideLengths) {
            [[A, B, 'a'], [B, C, 'b'], [C, A, 'c']].forEach(([P, Q, name]) => {
                const len = Math.hypot(P[0] - Q[0], P[1] - Q[1]);
                const mx = (P[0] + Q[0]) / 2, my = (P[1] + Q[1]) / 2;
                const px = this.mapX(mx, w), py = this.mapY(my, h);
                ctx.fillStyle = 'rgba(255,255,255,0.5)';
                ctx.font = '17px ' + CF.mono;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(`${name}=${len.toFixed(2)}`, px, py - 10);
            });
        }

        // Angles
        if (this.showAngles) {
            [[A, B, C, 'A'], [B, C, A, 'B'], [C, A, B, 'C']].forEach(([V, P, Q, name]) => {
                const ang = this._angle(P, V, Q);
                const deg = ang * 180 / Math.PI;
                const vx = this.mapX(V[0], w), vy = this.mapY(V[1], h);
                // Draw arc — correctly handle ±π boundary
                const a1 = Math.atan2(-(P[1] - V[1]), P[0] - V[0]);
                const a2 = Math.atan2(-(Q[1] - V[1]), Q[0] - V[0]);
                let sweep = a2 - a1;
                if (sweep > Math.PI) sweep -= 2 * Math.PI;
                if (sweep < -Math.PI) sweep += 2 * Math.PI;
                const r = 20;
                ctx.beginPath();
                ctx.arc(vx, vy, r, a1, a1 + sweep, sweep < 0);
                ctx.strokeStyle = 'rgba(228,200,100,0.6)'; ctx.lineWidth = 1.5;
                ctx.stroke();
                // Angle text
                const amid = a1 + sweep / 2;
                ctx.fillStyle = '#e4c864';
                ctx.font = '16px ' + CF.mono;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(`${deg.toFixed(1)}°`, vx + Math.cos(amid) * (r + 14), vy + Math.sin(amid) * (r + 14));
            });
        }

        // Vertex labels & dots
        const names = ['A', 'B', 'C'];
        this.triVerts.forEach((v, i) => {
            const px = this.mapX(v[0], w), py = this.mapY(v[1], h);
            ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2);
            ctx.fillStyle = '#5b8dce';
            ctx.shadowColor = '#5b8dce'; ctx.shadowBlur = 6;
            ctx.fill(); ctx.shadowBlur = 0;
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 18px ' + CF.sans;
            ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
            ctx.fillText(names[i], px, py - 10);
        });

        // Info panel
        this._drawTriangleInfo(ctx, w, h, A, B, C);
    },

    _drawLabel(ctx, x, y, text, color) {
        ctx.fillStyle = color;
        ctx.font = '16px ' + CF.sans;
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillText(text, x + 6, y - 4);
    },

    _drawTriangleInfo(ctx, w, h, A, B, C) {
        const area = this._triangleArea(A, B, C);
        const perimeter = Math.hypot(A[0]-B[0], A[1]-B[1]) + Math.hypot(B[0]-C[0], B[1]-C[1]) + Math.hypot(C[0]-A[0], C[1]-A[1]);
        const x0 = 12, y0 = 12;
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(x0 - 4, y0 - 4, 180, 42);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '16px ' + CF.mono;
        ctx.textAlign = 'left';
        ctx.fillText(`面积 = ${area.toFixed(3)}`, x0, y0 + 10);
        ctx.fillText(`周长 = ${perimeter.toFixed(3)}`, x0, y0 + 24);
    },

    // ── Geometry helpers ──
    _midpoint(P, Q) { return [(P[0] + Q[0]) / 2, (P[1] + Q[1]) / 2]; },

    _circumcenter(A, B, C) {
        const ax = A[0], ay = A[1], bx = B[0], by = B[1], cx = C[0], cy = C[1];
        const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
        if (Math.abs(D) < 1e-12) return null;
        const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D;
        const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D;
        return [ux, uy];
    },

    _incenter(A, B, C) {
        const a = Math.hypot(B[0] - C[0], B[1] - C[1]);
        const b = Math.hypot(A[0] - C[0], A[1] - C[1]);
        const c = Math.hypot(A[0] - B[0], A[1] - B[1]);
        const p = a + b + c;
        if (p < 1e-12) return null;
        return [(a * A[0] + b * B[0] + c * C[0]) / p, (a * A[1] + b * B[1] + c * C[1]) / p];
    },

    _inradius(A, B, C) {
        const area = this._triangleArea(A, B, C);
        const a = Math.hypot(B[0] - C[0], B[1] - C[1]);
        const b = Math.hypot(A[0] - C[0], A[1] - C[1]);
        const c = Math.hypot(A[0] - B[0], A[1] - B[1]);
        return (2 * area) / (a + b + c);
    },

    _centroid(A, B, C) {
        return [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3];
    },

    _orthocenter(A, B, C) {
        // H = A + B + C - 2*O (where O is circumcenter)
        const O = this._circumcenter(A, B, C);
        if (!O) return null;
        return [A[0] + B[0] + C[0] - 2 * O[0], A[1] + B[1] + C[1] - 2 * O[1]];
    },

    _footOfAltitude(V, P, Q) {
        const dx = Q[0] - P[0], dy = Q[1] - P[1];
        const t = ((V[0] - P[0]) * dx + (V[1] - P[1]) * dy) / (dx * dx + dy * dy);
        return [P[0] + t * dx, P[1] + t * dy];
    },

    _triangleArea(A, B, C) {
        return Math.abs((B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1])) / 2;
    },

    _angle(P, V, Q) {
        const v1 = [P[0] - V[0], P[1] - V[1]];
        const v2 = [Q[0] - V[0], Q[1] - V[1]];
        const dot = v1[0] * v2[0] + v1[1] * v2[1];
        const cross = v1[0] * v2[1] - v1[1] * v2[0];
        return Math.abs(Math.atan2(cross, dot));
    },

    // ── Transform mode controls ──
    setMirror(axis) {
        this.mirror = axis;
        document.querySelectorAll('.geo-mirror-btn').forEach(b => {
            b.classList.remove('active');
            if (b.dataset.v === axis) b.classList.add('active');
        });
        this.draw();
    },

    setShape(name) {
        const shapes = {
            square: [[-1,-1],[1,-1],[1,1],[-1,1]],
            triangle: [[0,1.5],[-1.3,-0.75],[1.3,-0.75]],
            arrow: [[0,1.5],[0.8,0],[0.3,0],[0.3,-1.5],[-0.3,-1.5],[-0.3,0],[-0.8,0]],
            star: (() => {
                const pts = [];
                for (let i = 0; i < 10; i++) {
                    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
                    const r = i % 2 === 0 ? 1.5 : 0.6;
                    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
                }
                return pts;
            })()
        };
        this.shape = shapes[name] || shapes.square;
        document.querySelectorAll('.geo-shape-btn').forEach(b => {
            b.classList.remove('active');
            if (b.dataset.shape === name) b.classList.add('active');
        });
        this.draw();
    },

    resetAll() {
        this.tx = 0; this.ty = 0; this.angle = 0;
        this.sx = 1; this.sy = 1; this.shx = 0;
        this.mirror = 'none';
        this.viewRange = 6; this.viewCenterX = 0; this.viewCenterY = 0;
        const defaults = { 'geo-tx': 0, 'geo-ty': 0, 'geo-angle': 0, 'geo-sx': 1, 'geo-sy': 1, 'geo-shx': 0 };
        for (const [id, val] of Object.entries(defaults)) {
            const el = document.getElementById(id);
            if (el) el.value = val;
            const lbl = document.getElementById(id + '-val');
            if (lbl) lbl.textContent = id === 'geo-angle' ? '0' : val.toFixed(2);
        }
        document.querySelectorAll('.geo-mirror-btn').forEach(b => b.classList.remove('active'));
        const noneBtn = document.querySelector('.geo-mirror-btn[data-v="none"]');
        if (noneBtn) noneBtn.classList.add('active');
        this.draw();
    },

    animate() {
        if (this.animating) { this.stopAnimate(); return; }
        this.animating = true;
        this.animTime = 0;
        const btn = document.getElementById('geo-animate-btn');
        if (btn) btn.textContent = '⏸ 暂停';
        const loop = () => {
            if (!this.animating) return;
            this.animTime += 0.02;
            this.angle = (this.animTime * 60) % 360;
            this.sx = 1 + 0.5 * Math.sin(this.animTime * 2);
            this.sy = 1 + 0.5 * Math.cos(this.animTime * 1.5);
            this.tx = 2 * Math.sin(this.animTime * 0.8);
            this.ty = 1.5 * Math.cos(this.animTime * 0.6);
            const updates = { 'geo-tx': this.tx, 'geo-ty': this.ty, 'geo-angle': this.angle, 'geo-sx': this.sx, 'geo-sy': this.sy };
            for (const [id, val] of Object.entries(updates)) {
                const el = document.getElementById(id);
                if (el) el.value = val;
                const lbl = document.getElementById(id + '-val');
                if (lbl) lbl.textContent = id === 'geo-angle' ? Math.round(val) : val.toFixed(2);
            }
            this.draw();
            this.animId = requestAnimationFrame(loop);
        };
        this.animId = requestAnimationFrame(loop);
    },

    stopAnimate() {
        this.animating = false;
        if (this.animId) cancelAnimationFrame(this.animId);
        this.animId = null;
        const btn = document.getElementById('geo-animate-btn');
        if (btn) btn.textContent = '▶ 动画演示';
    },

    /* ── education panel ── */
    updateEdu() {
        let el = document.getElementById('geo-edu');
        if (!el) {
            const wrap = this.canvas?.closest('.demo-content');
            if (!wrap) return;
            el = document.createElement('div');
            el.id = 'geo-edu';
            el.className = 'geo-edu';
            wrap.appendChild(el);
        }
        if (this.mode === 'transform') {
            const det = (this.sx * Math.cos(this.angle * Math.PI / 180)) *
                        (this.sy * Math.cos(this.angle * Math.PI / 180)) -
                        (-this.sx * Math.sin(this.angle * Math.PI / 180) + this.shx) *
                        (this.sy * Math.sin(this.angle * Math.PI / 180));
            el.innerHTML =
                '<b>仿射变换</b>：线性变换 + 平移，保持共线性与比例不变。' +
                '<br>变换矩阵 <code>M = T · R · S · Sh</code>：平移 T、旋转 R、缩放 S、剪切 Sh 依次复合。' +
                '<br>• <b>行列式 det(M)</b> = 面积缩放因子，det < 0 表示翻转方向（镜像）。' +
                '<br>• <b>特征值</b>描述变换的主方向拉伸量，特征向量是不变方向。' +
                '<br>💡 旋转矩阵 R(θ) = [[cos θ, −sin θ], [sin θ, cos θ]]，行列式恒为 1。';
        } else {
            el.innerHTML =
                '<b>三角形五心</b>：外心、内心、重心、垂心、旁心是三角形核心几何要素。' +
                '<br>• <b>外心</b>：三边垂直平分线交点，到三顶点等距（外接圆圆心）。' +
                '<br>• <b>内心</b>：三角平分线交点，到三边等距（内切圆圆心）。' +
                '<br>• <b>重心</b>：三中线交点，分中线为 2:1，坐标 = 三顶点坐标均值。' +
                '<br>• <b>垂心</b>：三高线交点；<b>欧拉线</b>：外心、重心、垂心共线。' +
                '<br>💡 拖拽顶点观察五心如何随三角形形状变化而移动。';
        }
    }
};

// ── 初始化 ──
function initGeoTransform() {
    GeoTransform.init();
}

window.GeoTransform = GeoTransform;
window.initGeoTransform = initGeoTransform;
