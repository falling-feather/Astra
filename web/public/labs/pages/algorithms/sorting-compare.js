// ===== Sorting Algorithm Comparison =====
// 5 algorithms: Bubble, Selection, Insertion, Quick, Merge — side by side animated

const SortCompare = {
    canvas: null, ctx: null, W: 0, H: 0,
    algorithms: ['bubble', 'selection', 'insertion', 'quick', 'merge'],
    algoNames: {
        bubble: '\u5192\u6ce1\u6392\u5e8f', selection: '\u9009\u62e9\u6392\u5e8f',
        insertion: '\u63d2\u5165\u6392\u5e8f', quick: '\u5feb\u901f\u6392\u5e8f', merge: '\u5f52\u5e76\u6392\u5e8f'
    },
    complexity: {
        bubble: 'O(n\u00b2)', selection: 'O(n\u00b2)',
        insertion: 'O(n\u00b2)', quick: 'O(n log n)', merge: 'O(n log n)'
    },
    states: {},      // per-algorithm state: { arr, steps, stepIdx, comparisons, swaps, done }
    arraySize: 30,
    speed: 50,       // ms per step
    animating: false,
    animId: 0,
    lastStepTime: 0,
    _listeners: [],
    _resizeObs: null,

    colors: {
        bar: '#5b8dce',
        comparing: '#e5c07b',
        swapping: '#e06c75',
        sorted: '#98c379',
        pivot: '#c678dd'
    },

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        this.canvas = document.getElementById('sortcmp-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        this.bindEvents();
        this.generate();
        this.draw();
        this.updateEdu();
    },

    destroy() {
        this.stopAnim();
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
        const h = Math.min(w * 0.7, 550);
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
        } else {
            this._on(window, 'resize', () => { this.resize(); this.draw(); });
        }

        const startBtn = document.getElementById('sortcmp-start');
        if (startBtn) this._on(startBtn, 'click', () => this.toggleAnim());

        const genBtn = document.getElementById('sortcmp-gen');
        if (genBtn) this._on(genBtn, 'click', () => { this.generate(); this.draw(); });

        const sizeSlider = document.getElementById('sortcmp-size');
        if (sizeSlider) this._on(sizeSlider, 'input', () => {
            this.arraySize = parseInt(sizeSlider.value);
            const lab = document.getElementById('sortcmp-size-val');
            if (lab) lab.textContent = this.arraySize;
            this.generate();
            this.draw();
        });

        const speedSlider = document.getElementById('sortcmp-speed');
        if (speedSlider) this._on(speedSlider, 'input', () => {
            this.speed = 110 - parseInt(speedSlider.value);
        });
    },

    generate() {
        this.stopAnim();
        const base = [];
        for (let i = 0; i < this.arraySize; i++) base.push(Math.floor(Math.random() * 100) + 1);

        for (const algo of this.algorithms) {
            const arr = [...base];
            const steps = this.generateSteps(algo, [...arr]);
            this.states[algo] = {
                arr: arr,
                steps: steps,
                stepIdx: 0,
                comparisons: 0,
                swaps: 0,
                done: false,
                highlights: {}
            };
        }
        this.updateStats();
    },

    generateSteps(algo, arr) {
        const steps = [];
        const record = (type, indices, extra) => {
            steps.push({ type, indices: [...indices], arr: [...arr], extra });
        };

        switch (algo) {
            case 'bubble': {
                const n = arr.length;
                for (let i = 0; i < n - 1; i++) {
                    for (let j = 0; j < n - 1 - i; j++) {
                        record('compare', [j, j + 1]);
                        if (arr[j] > arr[j + 1]) {
                            [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]];
                            record('swap', [j, j + 1]);
                        }
                    }
                    record('sorted', [n - 1 - i]);
                }
                record('done', []);
                break;
            }
            case 'selection': {
                const n = arr.length;
                for (let i = 0; i < n - 1; i++) {
                    let minIdx = i;
                    for (let j = i + 1; j < n; j++) {
                        record('compare', [minIdx, j]);
                        if (arr[j] < arr[minIdx]) minIdx = j;
                    }
                    if (minIdx !== i) {
                        [arr[i], arr[minIdx]] = [arr[minIdx], arr[i]];
                        record('swap', [i, minIdx]);
                    }
                    record('sorted', [i]);
                }
                record('done', []);
                break;
            }
            case 'insertion': {
                const n = arr.length;
                for (let i = 1; i < n; i++) {
                    let j = i;
                    while (j > 0) {
                        record('compare', [j - 1, j]);
                        if (arr[j - 1] > arr[j]) {
                            [arr[j - 1], arr[j]] = [arr[j], arr[j - 1]];
                            record('swap', [j - 1, j]);
                            j--;
                        } else break;
                    }
                }
                record('done', []);
                break;
            }
            case 'quick': {
                const qs = (lo, hi) => {
                    if (lo >= hi) return;
                    const pivot = arr[hi];
                    record('compare', [hi], { pivot: hi });
                    let i = lo;
                    for (let j = lo; j < hi; j++) {
                        record('compare', [j, hi]);
                        if (arr[j] < pivot) {
                            if (i !== j) {
                                [arr[i], arr[j]] = [arr[j], arr[i]];
                                record('swap', [i, j]);
                            }
                            i++;
                        }
                    }
                    [arr[i], arr[hi]] = [arr[hi], arr[i]];
                    record('swap', [i, hi]);
                    record('sorted', [i]);
                    qs(lo, i - 1);
                    qs(i + 1, hi);
                };
                qs(0, arr.length - 1);
                record('done', []);
                break;
            }
            case 'merge': {
                const ms = (lo, hi) => {
                    if (lo >= hi) return;
                    const mid = Math.floor((lo + hi) / 2);
                    ms(lo, mid);
                    ms(mid + 1, hi);
                    // merge
                    const left = arr.slice(lo, mid + 1);
                    const right = arr.slice(mid + 1, hi + 1);
                    let i = 0, j = 0, k = lo;
                    while (i < left.length && j < right.length) {
                        record('compare', [lo + i, mid + 1 + j]);
                        if (left[i] <= right[j]) {
                            arr[k++] = left[i++];
                        } else {
                            arr[k++] = right[j++];
                        }
                        record('swap', [k - 1], { merged: true });
                    }
                    while (i < left.length) { arr[k++] = left[i++]; record('swap', [k - 1]); }
                    while (j < right.length) { arr[k++] = right[j++]; record('swap', [k - 1]); }
                };
                ms(0, arr.length - 1);
                record('done', []);
                break;
            }
        }
        return steps;
    },

    toggleAnim() {
        if (this.animating) this.stopAnim();
        else this.startAnim();
    },

    startAnim() {
        this.animating = true;
        const btn = document.getElementById('sortcmp-start');
        if (btn) btn.textContent = '\u25a0 \u6682\u505c';
        this.lastStepTime = performance.now();
        const step = (now) => {
            if (!this.animating) return;
            if (now - this.lastStepTime >= this.speed) {
                this.lastStepTime = now;
                let anyActive = false;
                for (const algo of this.algorithms) {
                    const s = this.states[algo];
                    if (s.done) continue;
                    anyActive = true;
                    if (s.stepIdx < s.steps.length) {
                        const st = s.steps[s.stepIdx];
                        s.arr = [...st.arr];
                        s.highlights = {};
                        if (st.type === 'compare') {
                            s.comparisons++;
                            for (const idx of st.indices) s.highlights[idx] = 'comparing';
                        } else if (st.type === 'swap') {
                            s.swaps++;
                            for (const idx of st.indices) s.highlights[idx] = 'swapping';
                        } else if (st.type === 'sorted') {
                            for (const idx of st.indices) s.highlights[idx] = 'sorted';
                        } else if (st.type === 'done') {
                            s.done = true;
                            s.highlights = {};
                        }
                        s.stepIdx++;
                    } else {
                        s.done = true;
                    }
                }
                this.draw();
                this.updateStats();
                if (!anyActive) { this.stopAnim(); this.updateEdu(); return; }
            }
            this.animId = requestAnimationFrame(step);
        };
        this.animId = requestAnimationFrame(step);
    },

    stopAnim() {
        this.animating = false;
        cancelAnimationFrame(this.animId);
        const btn = document.getElementById('sortcmp-start');
        if (btn) btn.textContent = '\u25b6 \u5f00\u59cb\u6392\u5e8f';
    },

    updateStats() {
        const el = document.getElementById('sortcmp-stats');
        if (!el) return;
        const parts = this.algorithms.map(a => {
            const s = this.states[a];
            if (!s) return '';
            const name = this.algoNames[a];
            const done = s.done ? ' \u2705' : '';
            return name + ': ' + s.comparisons + '\u6bd4/' + s.swaps + '\u6362' + done;
        });
        el.textContent = parts.join('  |  ');
    },

    draw() {
        const { ctx, W, H } = this;
        if (!ctx || W === 0) return;
        ctx.clearRect(0, 0, W, H);

        const cols = this.W > 600 ? 5 : (this.W > 400 ? 3 : 2);
        const rows = Math.ceil(5 / cols);
        const cellW = W / cols;
        const cellH = H / rows;
        const padding = 8;

        for (let i = 0; i < this.algorithms.length; i++) {
            const algo = this.algorithms[i];
            const s = this.states[algo];
            if (!s) continue;

            const col = i % cols;
            const row = Math.floor(i / cols);
            const x = col * cellW + padding;
            const y = row * cellH + padding;
            const w = cellW - padding * 2;
            const h = cellH - padding * 2 - 18;

            // Title
            ctx.fillStyle = s.done ? '#98c379' : 'rgba(255,255,255,0.6)';
            ctx.font = '16px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.fillText(this.algoNames[algo] + ' ' + this.complexity[algo], x + w / 2, y + 12);

            // Bars
            const barW = Math.max(1, w / s.arr.length - 0.5);
            const maxVal = 101;
            const barAreaH = h - 4;

            for (let j = 0; j < s.arr.length; j++) {
                const bx = x + (j / s.arr.length) * w;
                const barH = (s.arr[j] / maxVal) * barAreaH;
                const by = y + 16 + barAreaH - barH;

                let color = this.colors.bar;
                if (s.done) color = this.colors.sorted;
                else if (s.highlights[j] === 'comparing') color = this.colors.comparing;
                else if (s.highlights[j] === 'swapping') color = this.colors.swapping;
                else if (s.highlights[j] === 'sorted') color = this.colors.sorted;
                else if (s.highlights[j] === 'pivot') color = this.colors.pivot;

                ctx.fillStyle = color;
                ctx.fillRect(bx, by, barW, barH);
            }

            // Border
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(x - 2, y, w + 4, cellH - padding * 2);
        }
    },

    /* ── education panel ── */
    updateEdu() {
        let el = document.getElementById('sortcmp-edu');
        if (!el) {
            const stats = document.getElementById('sortcmp-stats');
            if (!stats || !stats.parentElement) return;
            el = document.createElement('div');
            el.id = 'sortcmp-edu';
            el.className = 'sortcmp-edu';
            stats.parentElement.parentElement.appendChild(el);
        }
        const allDone = this.algorithms.every(a => this.states[a]?.done);
        if (allDone && this.states.bubble) {
            const stats = this.algorithms.map(a => ({
                name: this.algoNames[a],
                cmp: this.states[a].comparisons,
                swp: this.states[a].swaps
            }));
            const best = stats.reduce((a, b) => a.cmp < b.cmp ? a : b);
            el.innerHTML =
                '<b>排序完成!</b> 最少比较: ' + best.name + ' (' + best.cmp + ' 次)' +
                '<br>• <b>冒泡排序</b> O(n²): 稳定，反复交换相邻逆序对，最好 O(n) (已序)。' +
                '<br>• <b>选择排序</b> O(n²): 不稳定，每轮选最小值放到前端，比较次数固定 n(n-1)/2。' +
                '<br>• <b>插入排序</b> O(n²): 稳定，将元素插入已排序部分，对近乎有序数据效率极高。' +
                '<br>• <b>快速排序</b> O(n log n): 不稳定，分治 + 枢轴划分，最坏 O(n²) 但实际最快。' +
                '<br>• <b>归并排序</b> O(n log n): 稳定，分治 + 合并，需 O(n) 额外空间。' +
                '<br>💡 n=' + this.arraySize + ' 时，O(n²) ≈ ' + (this.arraySize * this.arraySize) +
                ' 次，O(n log n) ≈ ' + Math.round(this.arraySize * Math.log2(this.arraySize)) + ' 次。';
        } else {
            el.innerHTML =
                '<b>五种经典排序算法对比</b>' +
                '<br>• <b>冒泡 / 选择 / 插入</b>: 简单排序，时间 O(n²)，适合小数据或教学。' +
                '<br>• <b>快排 / 归并</b>: 高效排序，时间 O(n log n)，是实际工程首选。' +
                '<br>• <b>稳定性</b>: 相等元素的相对顺序是否保持（冒泡/插入/归并 稳定，选择/快排 不稳定）。' +
                '<br>💡 点击"开始排序"观察不同算法的比较次数与交换次数差异。';
        }
    }
};

function initSortCompare() {
    SortCompare.init();
}

window.SortCompare = SortCompare;
window.initSortCompare = initSortCompare;