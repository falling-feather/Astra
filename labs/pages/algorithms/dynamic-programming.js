// ===== Dynamic Programming Visualization =====
// 0/1 Knapsack problem: DP table filling animation

const DPVis = {
    canvas: null, ctx: null, W: 0, H: 0,
    _listeners: [],
    _resizeObs: null,
    _raf: null,
    time: 0,
    running: true,

    // Knapsack problem
    items: [
        { w: 2, v: 3, name: 'A' },
        { w: 3, v: 4, name: 'B' },
        { w: 4, v: 5, name: 'C' },
        { w: 5, v: 7, name: 'D' }
    ],
    capacity: 8,
    dp: [],
    step: 0,
    maxStep: 0,
    playing: false,
    speed: 1,
    activeCell: null,
    selectedItems: [],

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        this.canvas = document.getElementById('dp-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.running = true;
        this.resize();
        this.buildDP();
        this.bindEvents();
        this.draw();
        this.updateEdu();
    },

    destroy() {
        this.running = false;
        this.playing = false;
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
        const h = Math.min(w * 0.6, 400);
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w;
        this.H = h;
    },

    buildDP() {
        const n = this.items.length;
        const W = this.capacity;
        this.dp = [];
        this.step = 0;
        this.activeCell = null;
        this.selectedItems = [];

        // Initialize DP table with steps
        const table = Array.from({ length: n + 1 }, () => new Array(W + 1).fill(0));
        const steps = [];

        for (let i = 1; i <= n; i++) {
            for (let j = 0; j <= W; j++) {
                if (this.items[i - 1].w <= j) {
                    const take = table[i - 1][j - this.items[i - 1].w] + this.items[i - 1].v;
                    const skip = table[i - 1][j];
                    table[i][j] = Math.max(take, skip);
                    steps.push({
                        i, j,
                        val: table[i][j],
                        took: take > skip,
                        from: take > skip ? [i - 1, j - this.items[i - 1].w] : [i - 1, j]
                    });
                } else {
                    table[i][j] = table[i - 1][j];
                    steps.push({ i, j, val: table[i][j], took: false, from: [i - 1, j] });
                }
            }
        }

        this.dp = table;
        this.steps = steps;
        this.maxStep = steps.length;
        this.visibleTable = Array.from({ length: n + 1 }, () => new Array(W + 1).fill(null));
        // Row 0 is all 0
        for (let j = 0; j <= W; j++) this.visibleTable[0][j] = 0;

        // Traceback for optimal solution
        this.selectedItems = [];
        let rem = W;
        for (let i = n; i > 0; i--) {
            if (table[i][rem] !== table[i - 1][rem]) {
                this.selectedItems.push(i - 1);
                rem -= this.items[i - 1].w;
            }
        }
    },

    bindEvents() {
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver(() => this.resize());
            this._resizeObs.observe(this.canvas.parentElement);
        }

        const playBtn = document.getElementById('dp-play');
        if (playBtn) {
            this._on(playBtn, 'click', () => {
                this.playing = !this.playing;
                playBtn.textContent = this.playing ? '\u23f8 \u6682\u505c' : '\u25b6 \u64ad\u653e';
                if (this.playing) this.animate();
            });
        }

        const stepBtn = document.getElementById('dp-step');
        if (stepBtn) {
            this._on(stepBtn, 'click', () => {
                this.playing = false;
                if (playBtn) playBtn.textContent = '\u25b6 \u64ad\u653e';
                this.advanceStep();
                this.draw();
                this.updateEdu();
            });
        }

        const resetBtn = document.getElementById('dp-reset');
        if (resetBtn) {
            this._on(resetBtn, 'click', () => {
                this.playing = false;
                if (playBtn) playBtn.textContent = '\u25b6 \u64ad\u653e';
                this.buildDP();
                this.draw();
                this.updateEdu();
            });
        }

        const speedEl = document.getElementById('dp-speed');
        if (speedEl) {
            this._on(speedEl, 'input', () => {
                this.speed = parseFloat(speedEl.value);
            });
        }
    },

    advanceStep() {
        if (this.step >= this.maxStep) return;
        const s = this.steps[this.step];
        this.visibleTable[s.i][s.j] = s.val;
        this.activeCell = { i: s.i, j: s.j, from: s.from, took: s.took };
        this.step++;
    },

    animate() {
        if (!this.playing || !this.running) return;
        this.time += 0.016;

        if (this.time > 0.3 / this.speed) {
            this.time = 0;
            this.advanceStep();
            if (this.step >= this.maxStep) {
                this.playing = false;
                const playBtn = document.getElementById('dp-play');
                if (playBtn) playBtn.textContent = '\u25b6 \u64ad\u653e';
                this.updateEdu();
            }
        }

        this.draw();
        this._raf = requestAnimationFrame(() => this.animate());
    },

    draw() {
        const { ctx, W, H } = this;
        if (!ctx || W === 0) return;
        ctx.clearRect(0, 0, W, H);

        this.drawTable();
        this.drawItems();
    },

    drawTable() {
        const { ctx, W, H, items, capacity, visibleTable, activeCell, step, maxStep } = this;
        const n = items.length;
        const cols = capacity + 1;
        const rows = n + 1;

        const tableX = 80;
        const tableY = 10;
        const cellW = Math.min((W - tableX - 20) / cols, 36);
        const cellH = Math.min((H - tableY - 60) / rows, 32);

        // Header row (capacity)
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '15px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let j = 0; j < cols; j++) {
            ctx.fillText(j.toString(), tableX + j * cellW + cellW / 2, tableY + cellH / 2);
        }

        // Header col (items)
        ctx.fillText('\u5bb9\u91cf\u2192', tableX - 30, tableY + cellH / 2);
        ctx.fillText('0', tableX - 15, tableY + cellH + cellH / 2);
        for (let i = 0; i < n; i++) {
            ctx.fillText(items[i].name, tableX - 15, tableY + (i + 2) * cellH + cellH / 2);
        }

        // Cells
        for (let i = 0; i <= n; i++) {
            for (let j = 0; j < cols; j++) {
                const x = tableX + j * cellW;
                const y = tableY + (i + 1) * cellH;

                // Cell background
                let bg = 'rgba(255,255,255,0.03)';
                if (activeCell && activeCell.i === i && activeCell.j === j) {
                    bg = 'rgba(229,192,123,0.25)';
                } else if (activeCell && activeCell.from && activeCell.from[0] === i && activeCell.from[1] === j) {
                    bg = 'rgba(139,111,192,0.15)';
                } else if (step >= maxStep && this.selectedItems.includes(i - 1) && j === capacity) {
                    bg = 'rgba(77,158,126,0.15)';
                }

                ctx.fillStyle = bg;
                ctx.fillRect(x, y, cellW, cellH);
                ctx.strokeStyle = 'rgba(255,255,255,0.06)';
                ctx.lineWidth = 0.5;
                ctx.strokeRect(x, y, cellW, cellH);

                // Value
                if (visibleTable[i][j] !== null) {
                    ctx.fillStyle = activeCell && activeCell.i === i && activeCell.j === j
                        ? '#e5c07b'
                        : 'rgba(255,255,255,0.5)';
                    ctx.font = '16px ' + CF.mono;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(visibleTable[i][j].toString(), x + cellW / 2, y + cellH / 2);
                }
            }
        }

        // Progress label
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '15px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText('\u6b65\u9aa4: ' + step + '/' + maxStep, tableX, tableY + (n + 2) * cellH + 14);

        if (step >= maxStep) {
            const optVal = this.dp[n][capacity];
            ctx.fillStyle = 'rgba(77,158,126,0.6)';
            ctx.fillText('\u6700\u4f18\u89e3: ' + optVal + ' (\u9009\u53d6: ' + this.selectedItems.map(i => items[i].name).join(',') + ')', tableX + 100, tableY + (n + 2) * cellH + 14);
        }
    },

    drawItems() {
        const { ctx, W, H, items, step, maxStep } = this;
        const x = W - 100;
        const y = 20;

        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = 'bold 15px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText('\u7269\u54c1\u5217\u8868', x, y);

        items.forEach((item, i) => {
            const iy = y + 18 + i * 22;
            const selected = step >= maxStep && this.selectedItems.includes(i);
            ctx.fillStyle = selected ? 'rgba(77,158,126,0.6)' : 'rgba(255,255,255,0.2)';
            ctx.font = '15px ' + CF.mono;
            ctx.fillText(item.name + ': w=' + item.w + ' v=' + item.v, x, iy);
            if (selected) {
                ctx.fillStyle = 'rgba(77,158,126,0.3)';
                ctx.fillText('\u2713', x - 12, iy);
            }
        });

        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '15px ' + CF.mono;
        ctx.fillText('\u5bb9\u91cf W=' + this.capacity, x, y + 18 + items.length * 22 + 10);
    },

    /* ── education panel ── */
    updateEdu() {
        let el = document.getElementById('dp-edu');
        if (!el) {
            const wrap = this.canvas?.closest('.demo-section');
            if (!wrap) return;
            el = document.createElement('div');
            el.id = 'dp-edu';
            el.className = 'dp-edu';
            wrap.appendChild(el);
        }
        const done = this.step >= this.maxStep;
        const n = this.items.length;
        const W = this.capacity;
        if (done) {
            const optVal = this.dp[n][W];
            const chosen = this.selectedItems.map(i => this.items[i].name).join(', ');
            el.innerHTML =
                '<b>✅ DP 填表完成!</b> 最优价值 = ' + optVal + '，选择物品: [' + chosen + ']' +
                '<br>• 总共填写 ' + n + '×' + (W + 1) + ' = ' + (n * (W + 1)) + ' 个单元格，时间 O(nW)。' +
                '<br>• <b>回溯路径</b>: 从 dp[n][W] 向上追踪，若 dp[i][j] ≠ dp[i-1][j] 则物品 i 被选中。' +
                '<br>💡 0/1 背包是 NPC 问题，但 DP 在 W 不大时是高效的<b>伪多项式</b>算法。';
        } else if (this.step > 0) {
            const s = this.steps[this.step - 1];
            const item = this.items[s.i - 1];
            el.innerHTML =
                '<b>0/1 背包 · 动态规划</b> — 正在填充 dp[' + s.i + '][' + s.j + ']' +
                '<br>• 当前物品 ' + item.name + ': 重量=' + item.w + ', 价值=' + item.v +
                '，容量 j=' + s.j +
                '<br>• <b>状态转移</b>: dp[i][j] = max(dp[i-1][j], dp[i-1][j-wᵢ] + vᵢ)' +
                '<br>• ' + (s.took ?
                    '选择装入 → dp[' + (s.i - 1) + '][' + (s.j - item.w) + '] + ' + item.v + ' = ' + s.val :
                    '不装入（重量超限或不划算）→ dp[' + (s.i - 1) + '][' + s.j + '] = ' + s.val) +
                '<br>💡 每个物品只有"选"或"不选"两种决策，穷举需 2ⁿ = ' + Math.pow(2, n) + ' 种，DP 将其优化到 O(nW) = ' + (n * (W + 1)) + '。';
        } else {
            el.innerHTML =
                '<b>0/1 背包问题 · 动态规划</b>' +
                '<br>• ' + n + ' 件物品，背包容量 W=' + W + '。每件物品只能选一次（0/1 决策）。' +
                '<br>• <b>状态定义</b>: dp[i][j] = 前 i 件物品、容量 j 时的最大价值。' +
                '<br>• <b>转移方程</b>: dp[i][j] = max(dp[i-1][j], dp[i-1][j-wᵢ] + vᵢ)' +
                '<br>• <b>最优子结构</b>: 全局最优包含子问题最优；<b>重叠子问题</b>: 多次用到相同 dp[i][j]。' +
                '<br>💡 点击"播放"或"单步"观察 DP 表格逐格填充过程。';
        }
    }
};

DPVis.updateEdu = function () {
    let el = document.getElementById('dp-edu');
    if (!el) {
        const wrap = this.canvas?.closest('.demo-section');
        if (!wrap) return;
        el = document.createElement('div');
        el.id = 'dp-edu';
        el.className = 'dp-edu';
        wrap.appendChild(el);
    }

    const n = this.items.length;
    const W = this.capacity;
    const sourceNote = '<p class="algo-source-note">参考资料：OpenDSA《0/1 Knapsack Problem》。本页用小整数演示表格填充，适合观察状态定义、转移方程和回溯思路。</p>';

    if (this.step >= this.maxStep) {
        const optVal = this.dp[n][W];
        const chosen = this.selectedItems.map(i => this.items[i].name).join(', ') || '无';
        el.innerHTML =
            '<b>DP 表填充完成</b>：最优价值 = ' + optVal + '，选择物品：[' + chosen + ']' +
            '<br>共填充 ' + n + ' x ' + (W + 1) + ' = ' + (n * (W + 1)) + ' 个核心单元格；每格只比较“不取”和“取”两种情况。' +
            '<br><b>回溯路径</b>：从 <code>dp[n][W]</code> 向上比较，若 <code>dp[i][j] !== dp[i-1][j]</code>，说明第 i 件物品被选中。' +
            '<br>0/1 背包的每件物品只能选或不选一次；表格法的时间复杂度为 <code>O(nW)</code>，当容量 W 很大时仍要谨慎估算成本。' +
            sourceNote;
        return;
    }

    if (this.step > 0) {
        const s = this.steps[this.step - 1];
        const item = this.items[s.i - 1];
        const takeValue = s.j >= item.w ? this.dp[s.i - 1][s.j - item.w] + item.v : null;
        const skipValue = this.dp[s.i - 1][s.j];
        el.innerHTML =
            '<b>0/1 背包 · 动态规划</b>：正在填充 <code>dp[' + s.i + '][' + s.j + ']</code>' +
            '<br>当前物品 ' + item.name + '：重量 = ' + item.w + '，价值 = ' + item.v + '；当前容量 j = ' + s.j + '。' +
            '<br><b>状态转移</b>：<code>dp[i][j] = max(dp[i-1][j], dp[i-1][j-w_i] + v_i)</code>。' +
            '<br>不取：' + skipValue + (takeValue === null
                ? '；取：容量不足，所以沿用上一行结果。'
                : '；取：' + takeValue + '，因此本格写入 ' + s.val + '。') +
            '<br>DP 的关键是把重复子问题保存到表格里，避免指数级递归反复计算同一组 <code>(i, j)</code>。' +
            sourceNote;
        return;
    }

    el.innerHTML =
        '<b>0/1 背包问题 · 动态规划</b>' +
        '<br>' + n + ' 件物品，背包容量 W = ' + W + '。每件物品只能选择一次，目标是在不超过容量的前提下让总价值最大。' +
        '<br><b>状态定义</b>：<code>dp[i][j]</code> 表示只看前 i 件物品、容量为 j 时能得到的最大价值。' +
        '<br><b>转移方程</b>：若第 i 件物品放得下，就比较“不取它”和“取它”两种方案；若放不下，就沿用上一行结果。' +
        '<br>点击“播放”或“单步”，观察表格如何逐格填充，以及最终如何从右下角回溯选中物品。' +
        sourceNote;
};

function initDPVis() {
    DPVis.init();
}

window.DPVis = DPVis;
window.initDPVis = initDPVis;
