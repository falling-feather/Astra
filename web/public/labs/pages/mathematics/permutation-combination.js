// ===== Permutation & Combination Visualization v2 =====
// Animated tree, Pascal triangle with hover, education panel

const PermComb = {
    canvas: null, ctx: null, W: 0, H: 0,
    _listeners: [], _resizeObs: null, _raf: null,
    _prevT: 0, running: true,

    mode: 'permutation',
    n: 5, r: 3,
    pascalRows: 8,
    hoverX: -1, hoverY: -1, hoverLabel: '',

    // Animation state
    animProgress: 0, // 0→1 reveals nodes
    treeLayout: [],   // cached node positions
    pascalLayout: [],  // cached cell positions

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        this.canvas = document.getElementById('permcomb-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this._prevT = performance.now();
        this.running = true;
        this.animProgress = 0;
        this.resize();
        this.buildLayout();
        this.bindEvents();
        this.updateInfo();
        this.canvas.setAttribute('role', 'img');
        this.canvas.setAttribute('aria-label', '排列组合可视化：树状图与杨辉三角');
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

    factorial(n) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; },
    perm(n, r) { return this.factorial(n) / this.factorial(n - r); },
    comb(n, r) { if (r > n || r < 0) return 0; return this.factorial(n) / (this.factorial(r) * this.factorial(n - r)); },

    buildLayout() {
        if (this.mode === 'pascal') this.buildPascalLayout();
        else this.buildTreeLayout();
    },

    buildTreeLayout() {
        this.treeLayout = [];
        const { W, H, n, r, mode } = this;
        if (W === 0) return;
        const isPerm = mode === 'permutation';
        const maxShowR = Math.min(r, 3);
        const elements = [];
        for (let i = 1; i <= Math.min(n, 6); i++) elements.push(String.fromCharCode(64 + i));

        const treeTop = 65;
        const levelH = (H - treeTop - 30) / (maxShowR + 0.5);
        const rootX = W / 2;

        let nodeIdx = 0;
        this.treeLayout.push({ x: rootX, y: treeTop, label: '●', depth: -1, idx: nodeIdx++, parent: -1, path: [] });

        const buildRec = (px, py, available, depth, parentIdx, chosen) => {
            if (depth >= maxShowR || available.length === 0) return;
            const count = available.length;
            const maxSpread = Math.min(W * 0.9, count * 60);
            const startX = px - maxSpread / 2;
            const stepX = count > 1 ? maxSpread / (count - 1) : 0;
            const ny = py + levelH;

            for (let i = 0; i < count; i++) {
                const nx = count === 1 ? px : startX + i * stepX;
                const el = available[i];
                const newChosen = [...chosen, el];
                const idx = nodeIdx++;
                this.treeLayout.push({ x: nx, y: ny, label: el, depth, idx, parent: parentIdx, path: newChosen, px, py });

                let nextAvailable;
                if (isPerm) nextAvailable = available.filter(e => e !== el);
                else nextAvailable = available.filter(e => e > el);
                buildRec(nx, ny, nextAvailable, depth + 1, idx, newChosen);
            }
        };
        buildRec(rootX, treeTop, elements, 0, 0, []);
    },

    buildPascalLayout() {
        this.pascalLayout = [];
        const { W, H, pascalRows } = this;
        if (W === 0) return;
        const rows = Math.min(pascalRows, 10);
        const cellR = Math.min(18, (W - 40) / (rows + 2) / 2);
        const startY = 50;
        const rowH = cellR * 2.5;

        for (let i = 0; i <= rows; i++) {
            const rowWidth = (i + 1) * cellR * 2.5;
            const startX = W / 2 - rowWidth / 2 + cellR * 1.25;
            for (let j = 0; j <= i; j++) {
                const val = this.comb(i, j);
                const x = startX + j * cellR * 2.5;
                const y = startY + i * rowH;
                this.pascalLayout.push({ x, y, r: cellR, val, row: i, col: j });
            }
        }
    },

    bindEvents() {
        const wrap = this.canvas.parentElement;
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver(() => { this.resize(); this.buildLayout(); });
            this._resizeObs.observe(wrap);
        }

        document.querySelectorAll('.permcomb-mode-btn').forEach(btn => {
            this._on(btn, 'click', () => {
                document.querySelectorAll('.permcomb-mode-btn').forEach(b => {
                    b.classList.remove('active'); b.setAttribute('aria-pressed', 'false');
                });
                btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true');
                this.mode = btn.dataset.mode;
                this.animProgress = 0;
                this.buildLayout();
                this.updateInfo();
            });
        });

        const nS = document.getElementById('permcomb-n');
        const nV = document.getElementById('pc-n-val');
        if (nS) this._on(nS, 'input', () => {
            this.n = parseInt(nS.value);
            if (nV) nV.textContent = this.n;
            this.r = Math.min(this.r, this.n);
            const rS = document.getElementById('permcomb-r');
            if (rS) { rS.max = this.n; rS.value = this.r; }
            const rV = document.getElementById('pc-r-val');
            if (rV) rV.textContent = this.r;
            this.animProgress = 0; this.buildLayout(); this.updateInfo();
        });

        const rS = document.getElementById('permcomb-r');
        const rV = document.getElementById('pc-r-val');
        if (rS) this._on(rS, 'input', () => {
            this.r = Math.min(parseInt(rS.value), this.n);
            if (rV) rV.textContent = this.r;
            this.animProgress = 0; this.buildLayout(); this.updateInfo();
        });

        // Hover
        this._on(this.canvas, 'mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            this.hoverX = e.clientX - rect.left; this.hoverY = e.clientY - rect.top;
        });
        this._on(this.canvas, 'mouseleave', () => { this.hoverX = -1; this.hoverLabel = ''; });
        this._on(this.canvas, 'touchmove', (e) => {
            const t = e.touches[0]; const rect = this.canvas.getBoundingClientRect();
            this.hoverX = t.clientX - rect.left; this.hoverY = t.clientY - rect.top;
        }, { passive: true });
        this._on(this.canvas, 'touchend', () => { this.hoverX = -1; this.hoverLabel = ''; });
    },

    loop() {
        if (!this.running) return;
        const now = performance.now();
        const dt = Math.min((now - this._prevT) / 1000, 0.05);
        this._prevT = now;

        if (this.animProgress < 1) this.animProgress = Math.min(1, this.animProgress + dt * 1.2);

        this.draw();
        this._raf = requestAnimationFrame(() => this.loop());
    },

    draw() {
        const { ctx, W, H } = this;
        if (!ctx || W === 0) return;
        ctx.clearRect(0, 0, W, H);
        if (this.mode === 'pascal') this.drawPascal();
        else this.drawTree();
        this.detectHover();
        this.drawTooltip();
    },

    drawTree() {
        const { ctx, W, H, n, r, mode, treeLayout, animProgress } = this;
        const isPerm = mode === 'permutation';
        const fs = Math.max(17, W * 0.017);

        // Formula
        const label = isPerm ? `P(${n},${r})` : `C(${n},${r})`;
        const value = isPerm ? this.perm(n, r) : this.comb(n, r);
        ctx.fillStyle = 'rgba(91,141,206,0.55)'; ctx.font = `${fs + 3}px ${CF.mono}`; ctx.textAlign = 'left';
        ctx.fillText(`${label} = ${value}`, 10, 22);
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = `${fs}px ${CF.mono}`;
        if (isPerm) ctx.fillText(`A(${n},${r}) = ${n}!/(${n}-${r})! = ${value}`, 10, 40);
        else ctx.fillText(`C(${n},${r}) = ${n}!/(${r}!·(${n}-${r})!) = ${value}`, 10, 40);

        const colors = ['rgba(224,108,117,0.5)', 'rgba(91,141,206,0.5)', 'rgba(77,158,126,0.5)', 'rgba(229,192,123,0.5)', 'rgba(139,111,192,0.5)', 'rgba(196,121,58,0.5)'];
        const totalNodes = treeLayout.length;
        const visibleCount = Math.floor(animProgress * totalNodes);

        for (let i = 0; i < Math.min(visibleCount, totalNodes); i++) {
            const nd = treeLayout[i];
            const nodeAlpha = Math.min(1, (animProgress * totalNodes - i) * 2);
            if (nodeAlpha <= 0) continue;

            // Connection line to parent
            if (nd.parent >= 0 && nd.px !== undefined) {
                ctx.globalAlpha = nodeAlpha * 0.3;
                ctx.strokeStyle = 'rgba(91,141,206,0.5)'; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(nd.px, nd.py + 5); ctx.lineTo(nd.x, nd.y - 8); ctx.stroke();
            }

            // Node
            ctx.globalAlpha = nodeAlpha;
            if (nd.depth < 0) {
                ctx.fillStyle = 'rgba(91,141,206,0.5)';
                ctx.beginPath(); ctx.arc(nd.x, nd.y, 5, 0, Math.PI * 2); ctx.fill();
            } else {
                const ci = nd.label.charCodeAt(0) - 65;
                const g = ctx.createRadialGradient(nd.x - 2, nd.y - 2, 0, nd.x, nd.y, 10);
                g.addColorStop(0, colors[ci % colors.length].replace('0.5', '0.6'));
                g.addColorStop(1, colors[ci % colors.length].replace('0.5', '0.15'));
                ctx.fillStyle = g;
                ctx.beginPath(); ctx.arc(nd.x, nd.y, 8, 0, Math.PI * 2); ctx.fill();

                ctx.fillStyle = 'rgba(255,255,255,0.7)';
                ctx.font = `${fs}px ${CF.mono}`; ctx.textAlign = 'center';
                ctx.fillText(nd.label, nd.x, nd.y + 3);
            }
            ctx.globalAlpha = 1;
        }

        // Truncation note
        if (r > Math.min(r, 3)) {
            ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.font = `${fs - 1}px ${CF.sans}`; ctx.textAlign = 'center';
            ctx.fillText(`(树截断在第${Math.min(r, 3)}层, 实际深度=${r})`, W / 2, H - 5);
        }
    },

    drawPascal() {
        const { ctx, W, H, pascalLayout, pascalRows, animProgress, hoverX, hoverY } = this;
        const rows = Math.min(pascalRows, 10);
        const fs = Math.max(16, W * 0.016);

        // Title
        ctx.fillStyle = 'rgba(91,141,206,0.55)'; ctx.font = `${fs + 3}px ${CF.sans}`; ctx.textAlign = 'center';
        ctx.fillText('杨辉三角 / 帕斯卡三角', W / 2, 22);

        // Detect hovered row
        let hoverRow = -1;
        for (const c of pascalLayout) {
            if (hoverX >= 0 && Math.hypot(hoverX - c.x, hoverY - c.y) < c.r + 4) { hoverRow = c.row; break; }
        }

        const totalCells = pascalLayout.length;
        const visibleCount = Math.floor(animProgress * totalCells);

        for (let i = 0; i < Math.min(visibleCount, totalCells); i++) {
            const c = pascalLayout[i];
            const nodeAlpha = Math.min(1, (animProgress * totalCells - i) * 3);
            if (nodeAlpha <= 0) continue;
            ctx.globalAlpha = nodeAlpha;

            const isHoveredRow = c.row === hoverRow;
            const intensity = Math.min(0.35, c.val / 100 * 0.3 + 0.04);
            ctx.fillStyle = isHoveredRow
                ? `rgba(229,192,123,${intensity + 0.1})`
                : `rgba(91,141,206,${intensity})`;
            ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.fill();

            ctx.strokeStyle = isHoveredRow ? 'rgba(229,192,123,0.3)' : 'rgba(91,141,206,0.15)';
            ctx.lineWidth = isHoveredRow ? 1 : 0.5; ctx.stroke();

            ctx.fillStyle = isHoveredRow ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.5)';
            ctx.font = (c.val > 99 ? `${fs - 2}` : `${fs}`) + 'px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillText(c.val, c.x, c.y + 3);

            // Connection lines
            if (c.row < rows) {
                const nextCells = pascalLayout.filter(nc => nc.row === c.row + 1);
                ctx.strokeStyle = 'rgba(91,141,206,0.08)'; ctx.lineWidth = 0.5;
                const left = nextCells.find(nc => nc.col === c.col);
                const right = nextCells.find(nc => nc.col === c.col + 1);
                if (left) { ctx.beginPath(); ctx.moveTo(c.x, c.y + c.r); ctx.lineTo(left.x, left.y - left.r); ctx.stroke(); }
                if (right) { ctx.beginPath(); ctx.moveTo(c.x, c.y + c.r); ctx.lineTo(right.x, right.y - right.r); ctx.stroke(); }
            }
        }
        ctx.globalAlpha = 1;

        // Properties
        ctx.fillStyle = 'rgba(229,192,123,0.3)'; ctx.font = `${fs}px ${CF.mono}`; ctx.textAlign = 'left';
        ctx.fillText('C(n,0)=C(n,n)=1', 10, H - 30);
        ctx.fillText('C(n,k)=C(n-1,k-1)+C(n-1,k)', 10, H - 14);

        // Row sums
        ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.textAlign = 'right';
        for (let i = 0; i <= Math.min(rows, 7); i++) {
            const cell = pascalLayout.find(c => c.row === i && c.col === 0);
            if (cell) ctx.fillText('∑=2ⁿ=' + Math.pow(2, i), W - 8, cell.y + 3);
        }
    },

    detectHover() {
        const { hoverX, hoverY } = this;
        if (hoverX < 0) { this.hoverLabel = ''; return; }

        if (this.mode === 'pascal') {
            for (const c of this.pascalLayout) {
                if (Math.hypot(hoverX - c.x, hoverY - c.y) < c.r + 4) {
                    this.hoverLabel = `C(${c.row},${c.col}) = ${c.val}    第${c.row}行第${c.col}项`;
                    return;
                }
            }
        } else {
            for (const nd of this.treeLayout) {
                if (nd.depth < 0) continue;
                if (Math.hypot(hoverX - nd.x, hoverY - nd.y) < 12) {
                    const pathStr = nd.path.join('→');
                    const isPerm = this.mode === 'permutation';
                    this.hoverLabel = isPerm
                        ? `选取路径: ${pathStr} (有序排列)`
                        : `选取路径: ${pathStr} (无序组合)`;
                    return;
                }
            }
        }
        this.hoverLabel = '';
    },

    drawTooltip() {
        if (!this.hoverLabel || this.hoverX < 0) return;
        const { ctx, hoverX, hoverY, W } = this;
        const fs = Math.max(16, W * 0.018);
        ctx.font = `${fs}px ${CF.sans}`;
        const tw = ctx.measureText(this.hoverLabel).width;
        const px = Math.min(hoverX + 12, W - tw - 20);
        const py = Math.max(hoverY - 20, 16);
        ctx.fillStyle = 'rgba(30,30,30,0.88)';
        ctx.beginPath(); ctx.roundRect(px - 7, py - fs - 2, tw + 14, fs + 10, 4); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 0.5; ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.textAlign = 'left';
        ctx.fillText(this.hoverLabel, px, py);
    },

    updateInfo() {
        const el = document.getElementById('pc-info');
        if (!el) return;
        const { n, r, mode } = this;
        const isPerm = mode === 'permutation';
        const isPascal = mode === 'pascal';
        let html = '';

        if (isPascal) {
            html += `<div class="pc-hd"><span class="pc-tag pc-tag--amber">杨辉三角</span>帕斯卡三角 (Pascal's Triangle)</div>`;
            html += `<div class="pc-row"><span class="pc-key">递推关系</span>C(n,k) = C(n-1,k-1) + C(n-1,k)</div>`;
            html += `<div class="pc-row"><span class="pc-key pc-key--amber">行和</span>第 n 行所有元素之和 = 2ⁿ</div>`;
            html += `<div class="pc-row"><span class="pc-key pc-key--purple">对称性</span>C(n,k) = C(n, n-k)，每行左右对称</div>`;
            html += `<div class="pc-note">💡 杨辉三角中蕴含斐波那契数列（对角线求和）、二项式系数、组合恒等式等丰富规律</div>`;
        } else if (isPerm) {
            const val = this.perm(n, r);
            html += `<div class="pc-hd"><span class="pc-tag">排列</span>P(${n},${r}) = ${val}</div>`;
            html += `<div class="pc-row"><span class="pc-key">计算公式</span>A(n,r) = n!/(n-r)! = ${n}!/${n - r}! = ${val}</div>`;
            html += `<div class="pc-row"><span class="pc-key pc-key--purple">乘法原理</span>第1步${n}种选法 × 第2步${n - 1}种 × ... × 第${r}步${n - r + 1}种</div>`;
            html += `<div class="pc-row"><span class="pc-key pc-key--amber">与组合关系</span>P(n,r) = C(n,r) × r!    (排列 = 组合 × 全排列)</div>`;
            html += `<div class="pc-note">💡 排列关注顺序：从 ${n} 个元素中取 ${r} 个的有序安排。AB ≠ BA 算两种</div>`;
        } else {
            const val = this.comb(n, r);
            html += `<div class="pc-hd"><span class="pc-tag">组合</span>C(${n},${r}) = ${val}</div>`;
            html += `<div class="pc-row"><span class="pc-key">计算公式</span>C(n,r) = n!/(r!·(n-r)!) = ${n}!/(${r}!·${n - r}!) = ${val}</div>`;
            html += `<div class="pc-row"><span class="pc-key pc-key--purple">对称性</span>C(${n},${r}) = C(${n},${n - r}) = ${val}</div>`;
            html += `<div class="pc-row"><span class="pc-key pc-key--amber">与排列关系</span>C(n,r) = P(n,r)/r! = ${this.perm(n, r)}/${this.factorial(r)} = ${val}</div>`;
            html += `<div class="pc-note">💡 组合不关注顺序：从 ${n} 个元素中取 ${r} 个的无序子集。{A,B} = {B,A} 算一种</div>`;
        }
        el.innerHTML = html;
    }
};

function initPermComb() { PermComb.init(); }
window.PermComb = PermComb;
window.initPermComb = initPermComb;