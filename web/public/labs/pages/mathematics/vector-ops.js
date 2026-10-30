// ===== Vector Operations Visualization =====
// 2D vector addition, subtraction, dot product, projection

const VectorOps = {
    canvas: null, ctx: null, W: 0, H: 0,
    vecA: { x: 3, y: 2 },
    vecB: { x: -1, y: 3 },
    operation: 'add', // add, sub, dot, projection
    dragging: null, // 'A' or 'B'
    scale: 40, // pixels per unit
    origin: { x: 0, y: 0 },
    _listeners: [],
    _resizeObs: null,

    opInfo: {
        add:        { symbol: 'A + B',       name: '\u5411\u91cf\u52a0\u6cd5', desc: '\u5e73\u884c\u56db\u8fb9\u5f62\u6cd5\u5219 / \u4e09\u89d2\u5f62\u6cd5\u5219' },
        sub:        { symbol: 'A \u2212 B',       name: '\u5411\u91cf\u51cf\u6cd5', desc: '\u4ece B \u7684\u7ec8\u70b9\u6307\u5411 A \u7684\u7ec8\u70b9' },
        dot:        { symbol: 'A \u00b7 B',       name: '\u6570\u91cf\u79ef', desc: '|A||B|cos\u03b8\uff0c\u7ed3\u679c\u4e3a\u6807\u91cf' },
        projection: { symbol: 'proj_B A',  name: '\u6295\u5f71', desc: 'A \u5728 B \u65b9\u5411\u4e0a\u7684\u6295\u5f71\u5411\u91cf' }
    },

    colors: {
        vecA: '#5b8dce',
        vecB: '#c678dd',
        result: '#98c379',
        grid: 'rgba(255,255,255,0.04)',
        axis: 'rgba(255,255,255,0.12)',
        text: 'rgba(255,255,255,0.7)'
    },

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        this.canvas = document.getElementById('vecops-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        this.bindEvents();
        this.draw();
        this.updateInfo();
    },

    destroy() {
        for (const l of this._listeners) l.el.removeEventListener(l.evt, l.fn, l.opts);
        this._listeners = [];
        if (this._resizeObs) { this._resizeObs.disconnect(); this._resizeObs = null; }
    },

    resize() {
        const wrap = this.canvas.parentElement;
        if (!wrap) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = wrap.getBoundingClientRect();
        const w = rect.width;
        const h = Math.min(w * 0.65, 450);
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w;
        this.H = h;
        this.origin = { x: w / 2, y: h / 2 };
    },

    bindEvents() {
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver(() => { this.resize(); this.draw(); });
            this._resizeObs.observe(this.canvas.parentElement);
        } else {
            this._on(window, 'resize', () => { this.resize(); this.draw(); });
        }

        // Operation buttons
        document.querySelectorAll('.vecops-op-btn').forEach(btn => {
            this._on(btn, 'click', () => {
                document.querySelectorAll('.vecops-op-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.operation = btn.dataset.op;
                this.draw();
                this.updateInfo();
            });
        });

        // Drag vectors on canvas
        this._on(this.canvas, 'mousedown', (e) => this.onPointerDown(e));
        this._on(this.canvas, 'mousemove', (e) => this.onPointerMove(e));
        this._on(this.canvas, 'mouseup', () => this.dragging = null);
        this._on(this.canvas, 'mouseleave', () => this.dragging = null);

        // Touch support
        this._on(this.canvas, 'touchstart', (e) => { e.preventDefault(); this.onPointerDown(e.touches[0]); }, { passive: false });
        this._on(this.canvas, 'touchmove', (e) => { e.preventDefault(); this.onPointerMove(e.touches[0]); }, { passive: false });
        this._on(this.canvas, 'touchend', () => this.dragging = null);
    },

    screenToWorld(sx, sy) {
        return {
            x: (sx - this.origin.x) / this.scale,
            y: -(sy - this.origin.y) / this.scale
        };
    },

    worldToScreen(wx, wy) {
        return {
            x: this.origin.x + wx * this.scale,
            y: this.origin.y - wy * this.scale
        };
    },

    onPointerDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const w = this.screenToWorld(sx, sy);

        // Check proximity to vector tips
        const dA = Math.hypot(w.x - this.vecA.x, w.y - this.vecA.y);
        const dB = Math.hypot(w.x - this.vecB.x, w.y - this.vecB.y);
        if (dA < 1) this.dragging = 'A';
        else if (dB < 1) this.dragging = 'B';
    },

    onPointerMove(e) {
        if (!this.dragging) return;
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const w = this.screenToWorld(sx, sy);

        // Snap to 0.5
        const snap = (v) => Math.round(v * 2) / 2;
        if (this.dragging === 'A') {
            this.vecA.x = snap(w.x);
            this.vecA.y = snap(w.y);
        } else {
            this.vecB.x = snap(w.x);
            this.vecB.y = snap(w.y);
        }
        this.draw();
        this.updateInfo();
    },

    updateInfo() {
        const info = this.opInfo[this.operation];
        const nameEl = document.getElementById('vecops-op-name');
        const descEl = document.getElementById('vecops-op-desc');
        const resultEl = document.getElementById('vecops-result');
        if (nameEl) nameEl.textContent = info.symbol + ' \u2014 ' + info.name;
        if (descEl) descEl.textContent = info.desc;

        const A = this.vecA, B = this.vecB;
        let resultText = '';
        switch (this.operation) {
            case 'add': {
                const r = { x: A.x + B.x, y: A.y + B.y };
                resultText = 'A + B = (' + r.x.toFixed(1) + ', ' + r.y.toFixed(1) + ')  |A+B| = ' + Math.hypot(r.x, r.y).toFixed(2);
                break;
            }
            case 'sub': {
                const r = { x: A.x - B.x, y: A.y - B.y };
                resultText = 'A \u2212 B = (' + r.x.toFixed(1) + ', ' + r.y.toFixed(1) + ')  |A\u2212B| = ' + Math.hypot(r.x, r.y).toFixed(2);
                break;
            }
            case 'dot': {
                const dp = A.x * B.x + A.y * B.y;
                const angle = Math.acos(dp / (Math.hypot(A.x, A.y) * Math.hypot(B.x, B.y) + 0.0001)) * 180 / Math.PI;
                resultText = 'A \u00b7 B = ' + dp.toFixed(2) + '  \u03b8 = ' + angle.toFixed(1) + '\u00b0';
                break;
            }
            case 'projection': {
                const dp = A.x * B.x + A.y * B.y;
                const lenB2 = B.x * B.x + B.y * B.y;
                if (lenB2 < 0.001) { resultText = 'B \u4e3a\u96f6\u5411\u91cf'; break; }
                const scalar = dp / lenB2;
                const proj = { x: scalar * B.x, y: scalar * B.y };
                resultText = 'proj = (' + proj.x.toFixed(2) + ', ' + proj.y.toFixed(2) + ')  |proj| = ' + Math.hypot(proj.x, proj.y).toFixed(2);
                break;
            }
        }
        const aInfo = 'A = (' + A.x.toFixed(1) + ', ' + A.y.toFixed(1) + ')  |A| = ' + Math.hypot(A.x, A.y).toFixed(2);
        const bInfo = 'B = (' + B.x.toFixed(1) + ', ' + B.y.toFixed(1) + ')  |B| = ' + Math.hypot(B.x, B.y).toFixed(2);
        if (resultEl) resultEl.textContent = aInfo + '    ' + bInfo + '    ' + resultText;

        /* education panel */
        const eduEl = document.getElementById('vecops-edu');
        if (eduEl) {
            const opEdu = {
                add: '<div class="math-row"><span class="math-key">加法法则</span>三角形法则：首尾相接；平行四边形法则：共起点取对角线</div><div class="math-row"><span class="math-key math-key--amber">坐标运算</span>(x₁+x₂, y₁+y₂) — 对应分量相加</div>',
                sub: '<div class="math-row"><span class="math-key">减法法则</span>A−B 的方向：从 B 的终点指向 A 的终点（共起点时）</div><div class="math-row"><span class="math-key math-key--amber">坐标运算</span>(x₁−x₂, y₁−y₂) — 对应分量相减</div>',
                dot: '<div class="math-row"><span class="math-key">数量积</span>A·B = |A||B|cosθ — 结果是标量，不是向量</div><div class="math-row"><span class="math-key math-key--amber">坐标公式</span>A·B = x₁x₂ + y₁y₂ &nbsp; cosθ = A·B/(|A||B|)</div>',
                projection: '<div class="math-row"><span class="math-key">投影向量</span>A 在 B 方向上的投影向量 = (A·B/|B|²)·B</div><div class="math-row"><span class="math-key math-key--amber">投影长度</span>|proj| = |A|cosθ = A·B/|B| — 可正可负</div>'
            };
            eduEl.innerHTML = `<div class="math-hd"><span class="math-tag">${info.symbol}</span>向量运算知识点</div>
${opEdu[this.operation]}
<div class="math-row"><span class="math-key math-key--red">向量共线</span>A∥B ⇔ x₁y₂ − x₂y₁ = 0（叉积为零）</div>
<div class="math-row"><span class="math-key">向量垂直</span>A⊥B ⇔ A·B = 0 ⇔ x₁x₂ + y₁y₂ = 0</div>
<div class="math-note">💡 人教版必修2：拖拽箭头端点改变向量，观察运算结果的几何意义。向量是"既有大小又有方向"的量</div>`;
        }
    },

    draw() {
        const { ctx, W, H } = this;
        if (!ctx || W === 0) return;
        ctx.clearRect(0, 0, W, H);

        this.drawGrid();
        this.drawResult();
        this.drawVector(this.vecA, this.colors.vecA, 'A');
        this.drawVector(this.vecB, this.colors.vecB, 'B');
        this.drawDragHints();
    },

    drawGrid() {
        const { ctx, W, H, origin, scale } = this;

        // Grid
        ctx.strokeStyle = this.colors.grid;
        ctx.lineWidth = 0.5;
        const step = scale;
        for (let x = origin.x % step; x < W; x += step) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        }
        for (let y = origin.y % step; y < H; y += step) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }

        // Axes
        ctx.strokeStyle = this.colors.axis;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, origin.y); ctx.lineTo(W, origin.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(origin.x, 0); ctx.lineTo(origin.x, H); ctx.stroke();

        // Origin label
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '16px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText('O', origin.x + 4, origin.y + 14);
    },

    drawVector(vec, color, label) {
        const ctx = this.ctx;
        const s = this.worldToScreen(vec.x, vec.y);
        const o = this.origin;

        // Line
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(o.x, o.y);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();

        // Arrowhead
        const angle = Math.atan2(s.y - o.y, s.x - o.x);
        const headLen = 12;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x - headLen * Math.cos(angle - 0.3), s.y - headLen * Math.sin(angle - 0.3));
        ctx.lineTo(s.x - headLen * Math.cos(angle + 0.3), s.y - headLen * Math.sin(angle + 0.3));
        ctx.closePath();
        ctx.fill();

        // Label
        ctx.fillStyle = color;
        ctx.font = 'bold 22px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(label, s.x + 12 * Math.cos(angle + 0.5), s.y + 12 * Math.sin(angle + 0.5) - 4);

        // Draggable dot
        ctx.beginPath();
        ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.4;
        ctx.fill();
        ctx.globalAlpha = 1;
    },

    drawResult() {
        const { ctx, operation, vecA: A, vecB: B } = this;
        const o = this.origin;

        switch (operation) {
            case 'add': {
                const r = { x: A.x + B.x, y: A.y + B.y };
                const sr = this.worldToScreen(r.x, r.y);
                const sA = this.worldToScreen(A.x, A.y);
                const sB = this.worldToScreen(B.x, B.y);

                // Parallelogram dashed lines
                ctx.strokeStyle = 'rgba(255,255,255,0.12)';
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.beginPath(); ctx.moveTo(sA.x, sA.y); ctx.lineTo(sr.x, sr.y); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(sB.x, sB.y); ctx.lineTo(sr.x, sr.y); ctx.stroke();
                ctx.setLineDash([]);

                // Result vector
                this.drawResultArrow(o.x, o.y, sr.x, sr.y, this.colors.result, 'A+B');
                break;
            }
            case 'sub': {
                const r = { x: A.x - B.x, y: A.y - B.y };
                const sr = this.worldToScreen(r.x, r.y);
                const sA = this.worldToScreen(A.x, A.y);
                const sB = this.worldToScreen(B.x, B.y);

                // B tip to A tip dashed
                ctx.strokeStyle = 'rgba(152,195,121,0.3)';
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.beginPath(); ctx.moveTo(sB.x, sB.y); ctx.lineTo(sA.x, sA.y); ctx.stroke();
                ctx.setLineDash([]);

                this.drawResultArrow(o.x, o.y, sr.x, sr.y, this.colors.result, 'A\u2212B');
                break;
            }
            case 'dot': {
                // Show angle arc
                const sA = this.worldToScreen(A.x, A.y);
                const sB = this.worldToScreen(B.x, B.y);
                const angleA = Math.atan2(-(A.y), A.x);
                const angleB = Math.atan2(-(B.y), B.x);
                ctx.strokeStyle = 'rgba(152,195,121,0.4)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                const arcR = 30;
                ctx.arc(o.x, o.y, arcR, Math.min(angleA, angleB), Math.max(angleA, angleB));
                ctx.stroke();

                // Dot product value at arc
                const midAngle = (angleA + angleB) / 2;
                const dp = A.x * B.x + A.y * B.y;
                ctx.fillStyle = this.colors.result;
                ctx.font = '17px ' + CF.mono;
                ctx.textAlign = 'center';
                ctx.fillText(dp.toFixed(1), o.x + 45 * Math.cos(midAngle), o.y + 45 * Math.sin(midAngle));
                break;
            }
            case 'projection': {
                const dp = A.x * B.x + A.y * B.y;
                const lenB2 = B.x * B.x + B.y * B.y;
                if (lenB2 < 0.001) return;
                const scalar = dp / lenB2;
                const proj = { x: scalar * B.x, y: scalar * B.y };
                const sp = this.worldToScreen(proj.x, proj.y);
                const sA = this.worldToScreen(A.x, A.y);

                // Perpendicular dashed line from A tip to projection
                ctx.strokeStyle = 'rgba(255,255,255,0.2)';
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 3]);
                ctx.beginPath(); ctx.moveTo(sA.x, sA.y); ctx.lineTo(sp.x, sp.y); ctx.stroke();
                ctx.setLineDash([]);

                // Right angle marker
                const px = sp.x - sA.x, py = sp.y - sA.y;
                const len = Math.hypot(px, py);
                if (len > 5) {
                    const nx = px / len * 8, ny = py / len * 8;
                    const bx = sp.x - o.x, by = sp.y - o.y;
                    const blen = Math.hypot(bx, by);
                    const bnx = bx / (blen + 0.001) * 8, bny = by / (blen + 0.001) * 8;
                    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(sp.x + nx, sp.y + ny);
                    ctx.lineTo(sp.x + nx - bnx, sp.y + ny - bny);
                    ctx.lineTo(sp.x - bnx, sp.y - bny);
                    ctx.stroke();
                }

                this.drawResultArrow(o.x, o.y, sp.x, sp.y, this.colors.result, 'proj');
                break;
            }
        }
    },

    drawResultArrow(x1, y1, x2, y2, color, label) {
        const ctx = this.ctx;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        const angle = Math.atan2(y2 - y1, x2 - x1);
        const headLen = 10;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - headLen * Math.cos(angle - 0.3), y2 - headLen * Math.sin(angle - 0.3));
        ctx.lineTo(x2 - headLen * Math.cos(angle + 0.3), y2 - headLen * Math.sin(angle + 0.3));
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = color;
        ctx.font = 'bold 18px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText(label, (x1 + x2) / 2 + 15 * Math.cos(angle + Math.PI / 2),
                            (y1 + y2) / 2 + 15 * Math.sin(angle + Math.PI / 2));
    },

    drawDragHints() {
        const ctx = this.ctx;
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.font = '16px ' + CF.sans;
        ctx.textAlign = 'right';
        ctx.fillText('\u62d6\u62fd\u5411\u91cf\u7aef\u70b9\u8c03\u6574', this.W - 10, this.H - 8);
    }
};

function initVectorOps() {
    VectorOps.init();
}

window.VectorOps = VectorOps;
window.initVectorOps = initVectorOps;