// ===== Chemical Bond Visualization =====
// Ionic, Covalent, Metallic bonds

const ChemBond = {
    canvas: null, ctx: null, W: 0, H: 0,
    _listeners: [],
    _resizeObs: null,
    _raf: null,

    mode: 'ionic', // 'ionic', 'covalent', 'metallic'
    time: 0,
    running: true,

    bondInfo: {
        ionic: {
            name: '\u79bb\u5b50\u952e',
            desc: '\u7531\u9634\u9633\u79bb\u5b50\u4e4b\u95f4\u7684\u9759\u7535\u5f15\u529b\u5f62\u6210\uff0c\u5982 NaCl',
            example: 'Na\u207a + Cl\u207b \u2192 NaCl'
        },
        covalent: {
            name: '\u5171\u4ef7\u952e',
            desc: '\u539f\u5b50\u95f4\u901a\u8fc7\u5171\u7528\u7535\u5b50\u5bf9\u5f62\u6210\uff0c\u5982 H\u2082O',
            example: 'H\u2012O\u2012H (\u5171\u7528\u7535\u5b50\u5bf9)'
        },
        metallic: {
            name: '\u91d1\u5c5e\u952e',
            desc: '\u81ea\u7531\u7535\u5b50\u6d77\u4e0e\u91d1\u5c5e\u9633\u79bb\u5b50\u4e4b\u95f4\u7684\u4f5c\u7528\u529b',
            example: '\u91d1\u5c5e\u9633\u79bb\u5b50 + \u81ea\u7531\u7535\u5b50\u6d77'
        }
    },

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        this.canvas = document.getElementById('chembond-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.time = 0;
        this.running = true;
        this.resize();
        this.bindEvents();
        this.loop();
        this.updateInfo();
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
        const rect = wrap.getBoundingClientRect();
        const w = rect.width;
        const h = Math.min(w * 0.55, 360);
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w;
        this.H = h;
    },

    bindEvents() {
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver(() => { this.resize(); });
            this._resizeObs.observe(this.canvas.parentElement);
        }

        document.querySelectorAll('.chembond-mode-btn').forEach(btn => {
            this._on(btn, 'click', () => {
                document.querySelectorAll('.chembond-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.mode = btn.dataset.mode;
                this.time = 0;
                this.updateInfo();
            });
        });
    },

    updateInfo() {
        const info = this.bondInfo[this.mode];
        const el = document.getElementById('chembond-info');
        if (!el) return;
        let h = '';
        if (this.mode === 'ionic') {
            h = `<div class="chem-hd"><span class="chem-tag">离子键</span>化学键知识点</div>
<div class="chem-row"><span class="chem-key chem-key--purple">构成微粒</span>阳离子（如 Na⁺）+ 阴离子（如 Cl⁻）—— 注意：是<b>离子</b>不是<b>原子</b>，金属已转出电子，非金属已得到电子</div>
<div class="chem-row"><span class="chem-key">本质静电作用</span><span style="color:#5b8dce">吸引</span>：阳离子核 ↔ 阴离子电子云｜<span style="color:#e06c75">排斥</span>：核 ↔ 核、电子云 ↔ 电子云｜键长 = 两类作用力大小相等的<b>平衡距离</b></div>
<div class="chem-row"><span class="chem-key chem-key--purple">形成条件</span>活泼金属 + 活泼非金属（电负性差 > 1.7），如 ${info.example}</div>
<div class="chem-row"><span class="chem-key chem-key--amber">特征</span>无方向性、无饱和性 — 离子晶体中每个离子周围吸引尽可能多的异号离子</div>
<div class="chem-row"><span class="chem-key">性质影响</span>离子键强 → 熔沸点高、硬度大；熔融/溶于水可导电（自由移动离子）</div>
<div class="chem-note">💡 人教版必修2：判断离子键——看是否由阴阳离子构成。NH₄Cl 虽无金属但含 NH₄⁺ 与 Cl⁻ 的离子键</div>`;
        } else if (this.mode === 'covalent') {
            h = `<div class="chem-hd"><span class="chem-tag">共价键</span>化学键知识点</div>
<div class="chem-row"><span class="chem-key chem-key--purple">构成微粒</span>原子（核 + 内层电子）+ <b>共用电子对</b>（位于两核之间）—— 三类粒子构成</div>
<div class="chem-row"><span class="chem-key">本质静电作用</span><span style="color:#5b8dce">吸引</span>：A 核 ↔ 共用电子对、B 核 ↔ 共用电子对｜<span style="color:#e06c75">排斥</span>：A 核 ↔ B 核、电子 ↔ 电子｜键长 = 总吸引 = 总排斥的平衡位置</div>
<div class="chem-row"><span class="chem-key chem-key--purple">分类</span>极性共价键（共用电子对偏移，如 H-Cl）vs 非极性共价键（电子对不偏移，如 H-H）</div>
<div class="chem-row"><span class="chem-key chem-key--amber">特征</span>有方向性（最大重叠原理）、有饱和性（成键电子数有限）</div>
<div class="chem-row"><span class="chem-key">键参数</span>键能↑ → 稳定性↑；键长↓ → 键越强；键角决定分子空间构型</div>
<div class="chem-note">💡 人教版必修2：σ 键（头碰头重叠）可绕轴旋转，π 键（肩并肩重叠）不可旋转。双键 = 1σ + 1π</div>`;
        } else {
            h = `<div class="chem-hd"><span class="chem-tag">金属键</span>化学键知识点</div>
<div class="chem-row"><span class="chem-key chem-key--purple">构成微粒</span>金属<b>阳离子</b>（脱去价电子的金属原子）+ <b>自由电子</b>（"电子海"，整个晶体共有，不属于某个原子）</div>
<div class="chem-row"><span class="chem-key">本质静电作用</span><span style="color:#5b8dce">吸引</span>：每个阳离子 ↔ 周围自由电子海｜<span style="color:#e06c75">排斥</span>：阳离子 ↔ 阳离子（被电子海有效屏蔽）｜本质：阳离子被电子海"粘合"</div>
<div class="chem-row"><span class="chem-key chem-key--purple">自由电子模型</span>金属阳离子规则排列，自由电子在整个晶体中运动（"电子海洋"）</div>
<div class="chem-row"><span class="chem-key chem-key--amber">特征</span>无方向性、无饱和性 — 金属晶体中原子倾向密堆积</div>
<div class="chem-row"><span class="chem-key">性质解释</span>导电导热（自由电子）、延展性（离子层滑动后仍被电子海粘合）、金属光泽（电子吸收后再辐射光）</div>
<div class="chem-note">💡 人教版选择性必修2：金属键强度影响熔沸点——原子半径↓、价电子数↑ → 金属键越强 → 熔点越高</div>`;
        }
        el.innerHTML = h;
    },

    loop() {
        if (!this.running) return;
        this.time += 0.016;
        this.draw();
        this._raf = requestAnimationFrame(() => this.loop());
    },

    draw() {
        const { ctx, W, H, mode } = this;
        if (!ctx || W === 0) return;
        ctx.clearRect(0, 0, W, H);

        if (mode === 'ionic') this.drawIonic();
        else if (mode === 'covalent') this.drawCovalent();
        else this.drawMetallic();
    },

    // v4.5.0-α8 辅助：力箭头（蓝色实线 = 吸引、红色虚线 = 排斥）
    // 吸引箭头：从两端指向中心；排斥箭头：从中心指向两端
    _drawForceArrow(x1, y1, x2, y2, type) {
        const ctx = this.ctx;
        const isAttract = type === 'attract';
        const color = isAttract ? 'rgba(91,141,206,0.85)' : 'rgba(224,108,117,0.75)';
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1.6;
        if (!isAttract) ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
        // 箭头头部
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.hypot(dx, dy);
        if (len > 0.001) {
            const ux = dx / len, uy = dy / len;
            const arrowSize = 6;
            const ah = (cx, cy, dirX, dirY) => {
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.lineTo(cx - dirX * arrowSize - dirY * arrowSize * 0.5,
                           cy - dirY * arrowSize + dirX * arrowSize * 0.5);
                ctx.lineTo(cx - dirX * arrowSize + dirY * arrowSize * 0.5,
                           cy - dirY * arrowSize - dirX * arrowSize * 0.5);
                ctx.closePath();
                ctx.fill();
            };
            if (isAttract) {
                // 双向箭头朝中心（吸引）：箭头在两端各一个，指向中心
                ah(x1 + ux * 4, y1 + uy * 4, -ux, -uy);
                ah(x2 - ux * 4, y2 - uy * 4, ux, uy);
            } else {
                // 双向箭头朝外（排斥）：箭头在两端各一个，指向外
                ah(x1 - ux * 2, y1 - uy * 2, ux, uy);
                ah(x2 + ux * 2, y2 + uy * 2, -ux, -uy);
            }
        }
        ctx.restore();
    },

    // v4.5.0-α8 辅助：电荷徽章（与 chemical-reactions 一致的红正/蓝负圆形）
    _drawChargeBadge(x, y, charge) {
        const ctx = this.ctx;
        const isPos = charge.indexOf('+') !== -1;
        const r = 8;
        ctx.save();
        ctx.shadowColor = isPos ? '#ff5566' : '#5588ff';
        ctx.shadowBlur = 8;
        ctx.fillStyle = isPos ? 'rgba(255, 90, 110, 0.95)' : 'rgba(100, 150, 255, 0.95)';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(charge, x, y + 0.5);
        ctx.restore();
    },

    drawIonic() {
        const { ctx, W, H, time } = this;
        const cx = W / 2, cy = H / 2;

        // Na+ and Cl- attracting
        const sep = 50 + 30 * Math.cos(time * 1.5); // breathing

        // Na+
        const naX = cx - sep;
        ctx.fillStyle = '#7a8fc2';
        ctx.beginPath();
        ctx.arc(naX, cy, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 18px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Na\u207a', naX, cy);

        // Cl-
        const clX = cx + sep;
        ctx.fillStyle = '#4d9e7e';
        ctx.beginPath();
        ctx.arc(clX, cy, 28, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText('Cl\u207b', clX, cy);

        // v4.5.0-α8 电荷徽章（强调微粒带电属性）
        this._drawChargeBadge(naX + 18, cy - 18, '+');
        this._drawChargeBadge(clX + 22, cy - 22, '−');

        // v4.5.0-α8 静电力可视化：吸引（蓝实箭头，离子间）+ 排斥（红虚箭头，核-核 / 电子云-电子云）
        // 吸引力：阳离子核 ↔ 阴离子电子云
        this._drawForceArrow(naX + 22, cy + 8, clX - 28, cy + 8, 'attract');
        // 排斥力（核-核同向、轻度示意）：从两侧外推
        this._drawForceArrow(naX - 22, cy - 14, clX + 28, cy - 14, 'repel');

        // 力标签
        ctx.fillStyle = 'rgba(91,141,206,0.85)';
        ctx.font = '13px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText('F\u5f15 (\u9633\u79bb\u5b50 \u2194 \u9634\u79bb\u5b50)', cx, cy + 26);
        ctx.fillStyle = 'rgba(224,108,117,0.75)';
        ctx.fillText('F\u6392 (\u6838 \u2194 \u6838 / e\u207b\u4e91 \u2194 e\u207b\u4e91)', cx, cy - 30);

        // 平衡距离标记
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '12px ' + CF.mono;
        ctx.fillText('\u952e\u957f = F\u5f15 \u2261 F\u6392 \u7684\u5e73\u8861\u8ddd\u79bb', cx, cy + 50);

        // Electron shells hint
        this.drawElectronShell(naX, cy, 30, 2, time, '#7a8fc2');
        this.drawElectronShell(clX, cy, 38, 8, time, '#4d9e7e');

        // Crystal lattice preview (right side)
        const lx = W * 0.88, ly = H * 0.22;
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '13px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('\u6676\u4f53\u7ed3\u6784', lx, ly - 16);

        const gridSize = 18;
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
                const gx = lx - gridSize + c * gridSize;
                const gy = ly + r * gridSize;
                const isNa = (r + c) % 2 === 0;
                ctx.fillStyle = isNa ? '#7a8fc2' : '#4d9e7e';
                ctx.globalAlpha = 0.5;
                ctx.beginPath();
                ctx.arc(gx, gy, isNa ? 5 : 7, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1;
            }
        }
    },

    drawElectronShell(cx, cy, r, nElectrons, time, color) {
        const ctx = this.ctx;
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.15;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;

        for (let i = 0; i < nElectrons; i++) {
            const angle = (i / nElectrons) * Math.PI * 2 + time * 0.8;
            const ex = cx + r * Math.cos(angle);
            const ey = cy + r * Math.sin(angle);
            ctx.fillStyle = '#e5c07b';
            ctx.beginPath();
            ctx.arc(ex, ey, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }
    },

    drawCovalent() {
        const { ctx, W, H, time } = this;
        const cx = W / 2, cy = H / 2;

        // Water molecule H-O-H
        const angle = 52.25 * Math.PI / 180; // half of 104.5 degree
        const bondLen = 55;
        const oX = cx, oY = cy;
        const h1X = cx - bondLen * Math.sin(angle);
        const h1Y = cy - bondLen * Math.cos(angle);
        const h2X = cx + bondLen * Math.sin(angle);
        const h2Y = cy - bondLen * Math.cos(angle);

        // Bonds
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(h1X, h1Y);
        ctx.lineTo(oX, oY);
        ctx.lineTo(h2X, h2Y);
        ctx.stroke();

        // Oxygen
        ctx.fillStyle = '#e06c75';
        ctx.beginPath();
        ctx.arc(oX, oY, 25, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 19px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('O', oX, oY);

        // Hydrogens
        [{ x: h1X, y: h1Y }, { x: h2X, y: h2Y }].forEach(h => {
            ctx.fillStyle = '#5b8dce';
            ctx.beginPath();
            ctx.arc(h.x, h.y, 16, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 17px ' + CF.sans;
            ctx.fillText('H', h.x, h.y);
        });

        // Shared electron pairs (animated orbit)
        [{ x: h1X, y: h1Y }, { x: h2X, y: h2Y }].forEach((h, idx) => {
            const midX = (h.x + oX) / 2;
            const midY = (h.y + oY) / 2;
            for (let e = 0; e < 2; e++) {
                const phase = time * 1.2 + idx * Math.PI + e * Math.PI;
                const perpX = -(h.y - oY);
                const perpY = h.x - oX;
                const len = Math.hypot(perpX, perpY);
                const offX = perpX / len * 6 * Math.sin(phase);
                const offY = perpY / len * 6 * Math.sin(phase);
                const along = Math.cos(phase) * 15;
                const dx = (h.x - oX) / Math.hypot(h.x - oX, h.y - oY);
                const dy = (h.y - oY) / Math.hypot(h.x - oX, h.y - oY);
                const ex = midX + dx * along + offX;
                const ey = midY + dy * along + offY;
                ctx.fillStyle = '#e5c07b';
                ctx.beginPath();
                ctx.arc(ex, ey, 3, 0, Math.PI * 2);
                ctx.fill();
            }
        });

        // Angle label
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        const arcR = 25;
        ctx.beginPath();
        const aStart = -Math.PI / 2 - angle;
        const aEnd = -Math.PI / 2 + angle;
        ctx.arc(oX, oY, arcR, aStart, aEnd);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '15px ' + CF.mono;
        ctx.fillText('104.5\u00b0', oX, oY + 35);

        // Electronegativity hint
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.font = '15px ' + CF.sans;
        ctx.fillText('\u03b4\u207b', oX, oY - 30);
        ctx.fillText('\u03b4\u207a', h1X, h1Y - 20);
        ctx.fillText('\u03b4\u207a', h2X, h2Y - 20);

        // v4.5.0-α8 静电力可视化：H 核 ↔ 共用电子对（吸引）+ H 核 ↔ O 核（排斥）
        // 共用电子对中点
        [{ h: { x: h1X, y: h1Y } }, { h: { x: h2X, y: h2Y } }].forEach(({ h }) => {
            const midX = (h.x + oX) / 2;
            const midY = (h.y + oY) / 2;
            // H 核（小球边缘）→ 共用电子对中点：吸引
            const dx = midX - h.x, dy = midY - h.y;
            const dlen = Math.hypot(dx, dy) || 1;
            const hex = h.x + dx / dlen * 18;
            const hey = h.y + dy / dlen * 18;
            const mex = midX - dx / dlen * 4;
            const mey = midY - dy / dlen * 4;
            this._drawForceArrow(hex, hey, mex, mey, 'attract');
        });
        // O 核 → 共用电子对中点：吸引（中心向两侧）
        [{ h: { x: h1X, y: h1Y } }, { h: { x: h2X, y: h2Y } }].forEach(({ h }) => {
            const midX = (h.x + oX) / 2;
            const midY = (h.y + oY) / 2;
            const dx = midX - oX, dy = midY - oY;
            const dlen = Math.hypot(dx, dy) || 1;
            const oex = oX + dx / dlen * 27;
            const oey = oY + dy / dlen * 27;
            const mex = midX + dx / dlen * 2;
            const mey = midY + dy / dlen * 2;
            this._drawForceArrow(oex, oey, mex, mey, 'attract');
        });

        // 力示意标签（右下角小图例）
        const lgX = W - 116;
        const lgY = H - 56;
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.font = '11px ' + CF.mono;
        ctx.textAlign = 'left';
        // 吸引示例
        this._drawForceArrow(lgX, lgY, lgX + 28, lgY, 'attract');
        ctx.fillStyle = 'rgba(91,141,206,0.95)';
        ctx.fillText('F\u5f15: \u6838 \u2194 \u5171\u7528 e\u207b\u5bf9', lgX + 34, lgY + 4);
        // 排斥示例
        this._drawForceArrow(lgX, lgY + 18, lgX + 28, lgY + 18, 'repel');
        ctx.fillStyle = 'rgba(224,108,117,0.85)';
        ctx.fillText('F\u6392: \u6838 \u2194 \u6838', lgX + 34, lgY + 22);
        // 平衡说明
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillText('\u952e\u957f = F\u5f15\u2261F\u6392 \u5e73\u8861', lgX, lgY + 40);

        // 共用电子对标签
        ctx.fillStyle = 'rgba(229,192,123,0.7)';
        ctx.font = '12px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText('\u5171\u7528 e\u207b\u5bf9', (h1X + oX) / 2 - 8, (h1Y + oY) / 2 + 18);
        ctx.fillText('\u5171\u7528 e\u207b\u5bf9', (h2X + oX) / 2 + 8, (h2Y + oY) / 2 + 18);
    },

    drawMetallic() {
        const { ctx, W, H, time } = this;

        // v4.5.0-α8 自由电子"海洋"底色
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, 'rgba(91,141,206,0.06)');
        grad.addColorStop(1, 'rgba(91,141,206,0.14)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        // Grid of cations + free electron sea
        const cols = Math.floor(W / 45);
        const rows = Math.floor(H / 45);
        const gapX = W / (cols + 1);
        const gapY = H / (rows + 1);

        // Metal cations (fixed grid)
        const cationPos = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x = gapX * (c + 1);
                const y = gapY * (r + 1);
                cationPos.push({ x, y });
                ctx.fillStyle = 'rgba(196,149,102,0.55)';
                ctx.beginPath();
                ctx.arc(x, y, 12, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = 'rgba(255,255,255,0.4)';
                ctx.font = '14px ' + CF.sans;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('M\u207a', x, y);
            }
        }

        // Free electrons (random-ish movement)
        const nElectrons = cols * rows * 2;
        for (let i = 0; i < nElectrons; i++) {
            const seed = i * 137.508;
            const x = ((seed * 0.618 + time * 25 * (0.3 + (i % 5) * 0.15)) % W + W) % W;
            const y = ((seed * 0.414 + time * 18 * (0.2 + (i % 7) * 0.1)) % H + H) % H;
            ctx.fillStyle = 'rgba(91,141,206,0.55)';
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, Math.PI * 2);
            ctx.fill();
        }

        // v4.5.0-α8 焦点阳离子周围画"吸引力光圈"，强调每个阳离子被自由电子海包围
        if (cationPos.length > 0) {
            const focus = cationPos[Math.floor(cationPos.length / 2)];
            // 呼吸光环
            const haloR = 28 + 6 * Math.sin(time * 1.6);
            const halo = ctx.createRadialGradient(focus.x, focus.y, 14, focus.x, focus.y, haloR);
            halo.addColorStop(0, 'rgba(91,141,206,0.30)');
            halo.addColorStop(1, 'rgba(91,141,206,0)');
            ctx.fillStyle = halo;
            ctx.beginPath();
            ctx.arc(focus.x, focus.y, haloR, 0, Math.PI * 2);
            ctx.fill();
            // 4 个方向的吸引箭头（M⁺ ↔ e⁻ 海）
            const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            dirs.forEach(([dx, dy]) => {
                const x1 = focus.x + dx * 14;
                const y1 = focus.y + dy * 14;
                const x2 = focus.x + dx * 26;
                const y2 = focus.y + dy * 26;
                this._drawForceArrow(x1, y1, x2, y2, 'attract');
            });
            // 焦点电荷徽章
            this._drawChargeBadge(focus.x + 10, focus.y - 10, '+');
        }

        // Label
        ctx.fillStyle = 'rgba(91,141,206,0.6)';
        ctx.font = '13px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('\u81ea\u7531\u7535\u5b50\u6d77 (e\u207b)', W / 2, H - 24);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '12px ' + CF.mono;
        ctx.fillText('F\u5f15: \u9633\u79bb\u5b50 \u2194 e\u207b \u6d77 \u2192 \u91d1\u5c5e\u952e\u672c\u8d28', W / 2, H - 8);
    }
};

function initChemBond() {
    ChemBond.init();
}

window.ChemBond = ChemBond;
window.initChemBond = initChemBond;