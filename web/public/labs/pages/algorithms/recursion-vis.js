// ===== Recursion Visualization =====
// Fibonacci tree and Tower of Hanoi

const RecursionVis = {
    canvas: null, ctx: null, W: 0, H: 0,
    _listeners: [],
    _resizeObs: null,
    _raf: null,
    _timer: null,

    mode: 'fibonacci', // 'fibonacci' or 'hanoi'
    running: false,
    speed: 200, // ms per step

    // Fibonacci state
    fibN: 5,
    fibTree: null,
    fibStepIndex: 0,
    fibSteps: [],

    // Hanoi state
    hanoiN: 3,
    hanoiPegs: [[], [], []],
    hanoiMoves: [],
    hanoiStepIndex: 0,

    colors: {
        node: '#c4793a',
        nodeActive: '#e5c07b',
        nodeComplete: '#98c379',
        edge: 'rgba(255,255,255,0.12)',
        text: 'rgba(255,255,255,0.8)',
        disk: ['#5b8dce', '#c678dd', '#e06c75', '#e5c07b', '#98c379', '#c4793a', '#3a9e8f']
    },

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        this.canvas = document.getElementById('recur-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        this.bindEvents();
        this.buildFibTree();
        this.draw();
        this.updateEdu();
    },

    destroy() {
        this.running = false;
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
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
    },

    bindEvents() {
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver(() => { this.resize(); this.draw(); });
            this._resizeObs.observe(this.canvas.parentElement);
        }

        document.querySelectorAll('.recur-mode-btn').forEach(btn => {
            this._on(btn, 'click', () => {
                document.querySelectorAll('.recur-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.mode = btn.dataset.mode;
                this.stop();
                if (this.mode === 'fibonacci') this.buildFibTree();
                else this.buildHanoi();
                this.draw();
                this.updateEdu();
                // Toggle param visibility
                const fibP = document.getElementById('recur-fib-param');
                const hanP = document.getElementById('recur-hanoi-param');
                if (fibP) fibP.style.display = this.mode === 'fibonacci' ? '' : 'none';
                if (hanP) hanP.style.display = this.mode === 'hanoi' ? '' : 'none';
            });
        });

        const nSlider = document.getElementById('recur-fib-n');
        if (nSlider) this._on(nSlider, 'input', () => {
            this.fibN = parseInt(nSlider.value);
            const lbl = document.getElementById('recur-fib-n-val');
            if (lbl) lbl.textContent = this.fibN;
            this.stop();
            this.buildFibTree();
            this.draw();
        });

        const hSlider = document.getElementById('recur-hanoi-n');
        if (hSlider) this._on(hSlider, 'input', () => {
            this.hanoiN = parseInt(hSlider.value);
            const lbl = document.getElementById('recur-hanoi-n-val');
            if (lbl) lbl.textContent = this.hanoiN;
            this.stop();
            this.buildHanoi();
            this.draw();
        });

        const speedSlider = document.getElementById('recur-speed');
        if (speedSlider) this._on(speedSlider, 'input', () => {
            this.speed = parseInt(speedSlider.value);
        });

        const playBtn = document.getElementById('recur-play');
        if (playBtn) this._on(playBtn, 'click', () => {
            if (this.running) { this.stop(); playBtn.textContent = '\u25b6 \u64ad\u653e'; }
            else { this.start(); playBtn.textContent = '\u23f8 \u6682\u505c'; }
        });

        const resetBtn = document.getElementById('recur-reset');
        if (resetBtn) this._on(resetBtn, 'click', () => {
            this.stop();
            if (this.mode === 'fibonacci') { this.buildFibTree(); }
            else { this.buildHanoi(); }
            this.draw();
            const pb = document.getElementById('recur-play');
            if (pb) pb.textContent = '\u25b6 \u64ad\u653e';
        });

        const stepBtn = document.getElementById('recur-step');
        if (stepBtn) this._on(stepBtn, 'click', () => {
            this.stepOnce();
            this.draw();
        });
    },

    stop() {
        this.running = false;
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    },

    start() {
        this.running = true;
        this.runStep();
    },

    runStep() {
        if (!this.running) return;
        this.stepOnce();
        this.draw();
        if (this.running) {
            this._timer = setTimeout(() => this.runStep(), this.speed);
        }
    },

    stepOnce() {
        if (this.mode === 'fibonacci') {
            if (this.fibStepIndex < this.fibSteps.length) {
                const step = this.fibSteps[this.fibStepIndex];
                step.state = 'complete';
                this.fibStepIndex++;
                // Mark next as active
                if (this.fibStepIndex < this.fibSteps.length) {
                    this.fibSteps[this.fibStepIndex].state = 'active';
                }
            } else {
                this.running = false;
                const pb = document.getElementById('recur-play');
                if (pb) pb.textContent = '\u25b6 \u64ad\u653e';
            }
        } else {
            if (this.hanoiStepIndex < this.hanoiMoves.length) {
                const move = this.hanoiMoves[this.hanoiStepIndex];
                const disk = this.hanoiPegs[move.from].pop();
                this.hanoiPegs[move.to].push(disk);
                this.hanoiStepIndex++;
                this.updateStepInfo();
            } else {
                this.running = false;
                const pb = document.getElementById('recur-play');
                if (pb) pb.textContent = '\u25b6 \u64ad\u653e';
            }
        }
    },

    updateStepInfo() {
        const el = document.getElementById('recur-info');
        if (!el) return;
        if (this.mode === 'fibonacci') {
            const done = this.fibStepIndex;
            const total = this.fibSteps.length;
            el.textContent = '\u8ba1\u7b97\u6b65\u9aa4: ' + done + ' / ' + total + '  \u8c03\u7528\u6b21\u6570: ' + total;
        } else {
            el.textContent = '\u79fb\u52a8\u6b65\u9aa4: ' + this.hanoiStepIndex + ' / ' + this.hanoiMoves.length +
                '  \u6700\u5c11\u6b65\u6570: ' + (Math.pow(2, this.hanoiN) - 1);
        }
    },

    // ─── Fibonacci tree ───
    buildFibTree() {
        this.fibSteps = [];
        this.fibStepIndex = 0;
        let id = 0;
        const build = (n, depth, x, spread) => {
            const node = { id: id++, n, depth, x, state: 'pending', result: null, left: null, right: null };
            this.fibSteps.push(node);
            if (n <= 1) {
                node.result = n;
            } else {
                node.left = build(n - 1, depth + 1, x - spread, spread * 0.5);
                node.right = build(n - 2, depth + 1, x + spread, spread * 0.5);
                node.result = node.left.result + node.right.result;
            }
            return node;
        };
        this.fibTree = build(this.fibN, 0, 0.5, 0.22);
        if (this.fibSteps.length > 0) this.fibSteps[0].state = 'active';
        this.updateStepInfo();
    },

    drawFibTree() {
        const { ctx, W, H } = this;
        const maxDepth = this.fibN;
        const nodeR = Math.max(12, Math.min(18, W / (Math.pow(2, maxDepth) * 3)));

        const drawNode = (node) => {
            if (!node) return;
            const nx = node.x * W;
            const ny = 30 + node.depth * ((H - 60) / Math.max(maxDepth, 1));

            // Edges first
            if (node.left) {
                const lx = node.left.x * W;
                const ly = 30 + node.left.depth * ((H - 60) / Math.max(maxDepth, 1));
                ctx.strokeStyle = this.colors.edge;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(nx, ny);
                ctx.lineTo(lx, ly);
                ctx.stroke();
            }
            if (node.right) {
                const rx = node.right.x * W;
                const ry = 30 + node.right.depth * ((H - 60) / Math.max(maxDepth, 1));
                ctx.strokeStyle = this.colors.edge;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(nx, ny);
                ctx.lineTo(rx, ry);
                ctx.stroke();
            }

            drawNode(node.left);
            drawNode(node.right);

            // Node circle
            let color = 'rgba(255,255,255,0.08)';
            if (node.state === 'active') color = this.colors.nodeActive;
            else if (node.state === 'complete') color = this.colors.nodeComplete;

            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(nx, ny, nodeR, 0, Math.PI * 2);
            ctx.fill();

            if (node.state !== 'pending') {
                ctx.strokeStyle = color;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(nx, ny, nodeR, 0, Math.PI * 2);
                ctx.stroke();
            }

            // Label
            ctx.fillStyle = node.state === 'pending' ? 'rgba(255,255,255,0.3)' : '#fff';
            ctx.font = (nodeR > 14 ? '11' : '9') + 'px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const label = 'f(' + node.n + ')';
            ctx.fillText(label, nx, ny);

            // Result below
            if (node.state === 'complete') {
                ctx.fillStyle = 'rgba(152,195,121,0.7)';
                ctx.font = '14px ' + CF.mono;
                ctx.fillText('=' + node.result, nx, ny + nodeR + 10);
            }
        };

        drawNode(this.fibTree);
    },

    // ─── Tower of Hanoi ───
    buildHanoi() {
        this.hanoiPegs = [[], [], []];
        this.hanoiMoves = [];
        this.hanoiStepIndex = 0;
        for (let i = this.hanoiN; i >= 1; i--) this.hanoiPegs[0].push(i);
        // Generate moves
        const solve = (n, from, to, aux) => {
            if (n === 0) return;
            solve(n - 1, from, aux, to);
            this.hanoiMoves.push({ from, to, disk: n });
            solve(n - 1, aux, to, from);
        };
        solve(this.hanoiN, 0, 2, 1);
        this.updateStepInfo();
    },

    drawHanoi() {
        const { ctx, W, H } = this;
        const n = this.hanoiN;
        const baseY = H - 30;
        const pegH = H - 80;
        const pegSpacing = W / 4;

        // Peg names
        const pegNames = ['A', 'B', 'C'];

        for (let p = 0; p < 3; p++) {
            const px = pegSpacing * (p + 1);

            // Peg pole
            ctx.strokeStyle = 'rgba(255,255,255,0.15)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(px, baseY);
            ctx.lineTo(px, baseY - pegH);
            ctx.stroke();

            // Base
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            ctx.fillRect(px - 40, baseY, 80, 4);

            // Peg label
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.font = '17px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.fillText(pegNames[p], px, baseY + 18);

            // Disks
            const peg = this.hanoiPegs[p];
            peg.forEach((disk, i) => {
                const diskW = 20 + disk * (60 / n);
                const diskH = Math.min(20, pegH / (n + 1));
                const dx = px - diskW / 2;
                const dy = baseY - (i + 1) * diskH;

                ctx.fillStyle = this.colors.disk[(disk - 1) % this.colors.disk.length];
                ctx.beginPath();
                const r = 4;
                ctx.moveTo(dx + r, dy);
                ctx.lineTo(dx + diskW - r, dy);
                ctx.quadraticCurveTo(dx + diskW, dy, dx + diskW, dy + r);
                ctx.lineTo(dx + diskW, dy + diskH - r);
                ctx.quadraticCurveTo(dx + diskW, dy + diskH, dx + diskW - r, dy + diskH);
                ctx.lineTo(dx + r, dy + diskH);
                ctx.quadraticCurveTo(dx, dy + diskH, dx, dy + diskH - r);
                ctx.lineTo(dx, dy + r);
                ctx.quadraticCurveTo(dx, dy, dx + r, dy);
                ctx.fill();

                // Disk number
                ctx.fillStyle = '#fff';
                ctx.font = '15px ' + CF.mono;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(disk, px, dy + diskH / 2);
            });
        }
    },

    draw() {
        const { ctx, W, H } = this;
        if (!ctx || W === 0) return;
        ctx.clearRect(0, 0, W, H);

        if (this.mode === 'fibonacci') this.drawFibTree();
        else this.drawHanoi();

        this.updateStepInfo();
    },

    /* ── education panel ── */
    updateEdu() {
        let el = document.getElementById('recur-edu');
        if (!el) {
            const info = document.getElementById('recur-info');
            if (!info || !info.parentElement) return;
            el = document.createElement('div');
            el.id = 'recur-edu';
            el.className = 'recur-edu';
            info.parentElement.appendChild(el);
        }
        if (this.mode === 'fibonacci') {
            const n = this.fibN;
            const calls = this.fibSteps.length;
            const done = this.fibStepIndex >= calls;
            el.innerHTML =
                '<b>Fibonacci 递归树</b>: F(n) = F(n-1) + F(n-2)，F(0)=0, F(1)=1' +
                '<br>• <b>朴素递归</b>时间 O(2ⁿ)：n=' + n + ' 时产生 ' + calls + ' 次调用，' +
                '存在大量<b>重叠子问题</b>（如 F(' + Math.max(0, n - 2) + ') 被重复计算多次）。' +
                '<br>• <b>记忆化</b>（备忘录）：缓存已算结果，降至 O(n) 时间 + O(n) 空间。' +
                '<br>• <b>递推（DP）</b>：自底向上 f[i]=f[i-1]+f[i-2]，O(n) 时间 + O(1) 空间。' +
                (done ? '<br>✅ 递归完成! 观察树中重复节点（相同颜色）的数量。' :
                '<br>💡 点击"播放"观察递归调用展开过程，注意重复子问题的出现。');
        } else {
            const n = this.hanoiN;
            const minMoves = Math.pow(2, n) - 1;
            el.innerHTML =
                '<b>汉诺塔</b>: 将 ' + n + ' 个圆盘从 A 柱移到 C 柱，大盘不能放在小盘上。' +
                '<br>• <b>递归策略</b>: 先将上面 n-1 个移到 B，将最大盘移到 C，再将 n-1 个从 B 移到 C。' +
                '<br>• <b>递推关系</b>: T(n) = 2T(n-1) + 1，解为 T(n) = 2ⁿ − 1 = ' + minMoves + ' 步。' +
                '<br>• 这是<b>最优解</b>——不存在少于 ' + minMoves + ' 步的方案。' +
                '<br>💡 汉诺塔是理解递归"分治"思想的经典模型：将大问题拆解为相同结构的子问题。';
        }
    }
};

function initRecursionVis() {
    RecursionVis.init();
}

window.RecursionVis = RecursionVis;
window.initRecursionVis = initRecursionVis;