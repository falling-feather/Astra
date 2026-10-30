// ===== Greedy Scheduling: interval scheduling and activity selection =====

const GreedyScheduling = {
    canvas: null,
    ctx: null,
    W: 0,
    H: 0,
    _listeners: [],
    _ro: null,
    _timer: 0,
    playing: false,
    stepIndex: 0,
    preset: 'talks',
    strategy: 'finish',
    steps: [],
    optimalFinish: [],
    weightedOptimal: [],

    presets: {
        talks: {
            label: '讲座教室',
            unit: '小时',
            intervals: [
                { id: 'A', label: 'A', start: 0, end: 6, value: 8 },
                { id: 'B', label: 'B', start: 1, end: 3, value: 4 },
                { id: 'C', label: 'C', start: 3, end: 5, value: 4 },
                { id: 'D', label: 'D', start: 5, end: 7, value: 4 },
                { id: 'E', label: 'E', start: 7, end: 9, value: 3 },
                { id: 'F', label: 'F', start: 2, end: 8, value: 7 }
            ]
        },
        trap: {
            label: '短会陷阱',
            unit: '小时',
            intervals: [
                { id: 'A', label: 'A', start: 0, end: 4, value: 5 },
                { id: 'B', label: 'B', start: 4, end: 8, value: 5 },
                { id: 'C', label: 'C', start: 3, end: 5, value: 4 },
                { id: 'D', label: 'D', start: 8, end: 10, value: 2 },
                { id: 'E', label: 'E', start: 1, end: 7, value: 6 },
                { id: 'F', label: 'F', start: 5, end: 9, value: 4 }
            ]
        },
        credits: {
            label: '学分权重',
            unit: '节',
            intervals: [
                { id: 'A', label: 'A', start: 0, end: 2, value: 3 },
                { id: 'B', label: 'B', start: 2, end: 4, value: 3 },
                { id: 'C', label: 'C', start: 4, end: 6, value: 3 },
                { id: 'D', label: 'D', start: 0, end: 6, value: 10 },
                { id: 'E', label: 'E', start: 6, end: 8, value: 2 }
            ]
        }
    },

    strategies: {
        finish: {
            label: '最早结束',
            order: (a, b) => a.end - b.end || a.start - b.start || a.id.localeCompare(b.id),
            reason: '选择最早结束且不冲突的活动，为后续留下最长可用时间。'
        },
        start: {
            label: '最早开始',
            order: (a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id),
            reason: '看似自然，但早开始的长活动可能挡住多个短活动。'
        },
        duration: {
            label: '最短时长',
            order: (a, b) => (a.end - a.start) - (b.end - b.start) || a.start - b.start || a.id.localeCompare(b.id),
            reason: '短活动不一定给整体留下最多空间，局部短不等于全局多。'
        },
        value: {
            label: '最高权重',
            order: (a, b) => b.value - a.value || a.end - b.end || a.id.localeCompare(b.id),
            reason: '适合说明加权问题的直觉，但不能保证最大数量或最大总权重。'
        }
    },

    _COL: {
        bg0: '#0d1118',
        bg1: '#17110c',
        grid: 'rgba(255,255,255,.08)',
        axis: 'rgba(255,255,255,.28)',
        text: '#f5efe7',
        muted: 'rgba(245,239,231,.64)',
        dim: 'rgba(245,239,231,.36)',
        orange: '#f59e0b',
        amber: '#fbbf24',
        green: '#34d399',
        rose: '#fb7185',
        blue: '#38bdf8',
        violet: '#a78bfa'
    },

    _on(el, evt, fn, opts) {
        if (!el) return;
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        this.destroy();
        this.canvas = document.getElementById('greedy-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.canvas.setAttribute('role', 'img');
        this.canvas.setAttribute('aria-label', '贪心区间调度、活动选择与加权反例可视化');
        this._buildControls();
        this._recompute();
        this._resize();
        if (typeof ResizeObserver !== 'undefined') {
            this._ro = new ResizeObserver(() => this._resize());
            this._ro.observe(this.canvas.parentElement);
        } else {
            this._on(window, 'resize', () => this._resize());
        }
    },

    destroy() {
        if (this._timer) clearInterval(this._timer);
        this._timer = 0;
        this.playing = false;
        this._listeners.forEach(l => l.el.removeEventListener(l.evt, l.fn, l.opts));
        this._listeners.length = 0;
        if (this._ro) this._ro.disconnect();
        this._ro = null;
        const ctrl = document.getElementById('greedy-controls');
        if (ctrl) ctrl.innerHTML = '';
        const info = document.getElementById('greedy-info');
        if (info) info.innerHTML = '';
        this.canvas = null;
        this.ctx = null;
    },

    _buildControls() {
        const ctrl = document.getElementById('greedy-controls');
        if (!ctrl) return;
        ctrl.innerHTML = '';

        const actionWrap = document.createElement('div');
        actionWrap.className = 'greedy-actions';
        [
            ['play', '播放'],
            ['prev', '上一步'],
            ['next', '下一步'],
            ['reset', '重置']
        ].forEach(([key, label]) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.id = 'greedy-' + key;
            btn.className = 'greedy-btn' + (key === 'play' ? ' greedy-btn--primary' : '');
            btn.textContent = label;
            this._on(btn, 'click', () => this._handleAction(key));
            actionWrap.appendChild(btn);
        });
        ctrl.appendChild(actionWrap);

        const strategyWrap = document.createElement('div');
        strategyWrap.className = 'greedy-chip-row';
        Object.entries(this.strategies).forEach(([key, item]) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'greedy-chip' + (key === this.strategy ? ' active' : '');
            btn.textContent = item.label;
            this._on(btn, 'click', () => {
                this.strategy = key;
                this.stepIndex = 0;
                this._stopPlaying();
                this._buildControls();
                this._recompute();
            });
            strategyWrap.appendChild(btn);
        });
        ctrl.appendChild(strategyWrap);

        const presetWrap = document.createElement('div');
        presetWrap.className = 'greedy-chip-row';
        Object.entries(this.presets).forEach(([key, item]) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'greedy-chip greedy-chip--preset' + (key === this.preset ? ' active' : '');
            btn.textContent = item.label;
            this._on(btn, 'click', () => {
                this.preset = key;
                this.stepIndex = 0;
                this._stopPlaying();
                this._buildControls();
                this._recompute();
            });
            presetWrap.appendChild(btn);
        });
        ctrl.appendChild(presetWrap);
    },

    _handleAction(action) {
        const max = this.steps.length;
        if (action === 'play') {
            if (this.playing) {
                this._stopPlaying();
            } else {
                this.playing = true;
                this._syncPlayButton();
                this._timer = setInterval(() => {
                    if (this.stepIndex >= max) {
                        this._stopPlaying();
                        return;
                    }
                    this.stepIndex++;
                    this._render();
                }, 850);
            }
            return;
        }
        if (action === 'prev') this.stepIndex = Math.max(0, this.stepIndex - 1);
        if (action === 'next') this.stepIndex = Math.min(max, this.stepIndex + 1);
        if (action === 'reset') {
            this.stepIndex = 0;
            this._stopPlaying();
        }
        this._render();
    },

    _stopPlaying() {
        if (this._timer) clearInterval(this._timer);
        this._timer = 0;
        this.playing = false;
        this._syncPlayButton();
    },

    _syncPlayButton() {
        const btn = document.getElementById('greedy-play');
        if (btn) btn.textContent = this.playing ? '暂停' : '播放';
    },

    _resize() {
        if (!this.canvas || !this.canvas.parentElement || !this.ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const w = this.canvas.parentElement.getBoundingClientRect().width || 640;
        const count = this.presets[this.preset].intervals.length;
        const h = Math.min(Math.max(count * (w < 620 ? 36 : 42) + 142, 350), 540);
        this.canvas.width = Math.floor(w * dpr);
        this.canvas.height = Math.floor(h * dpr);
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w;
        this.H = h;
        this._render();
    },

    _recompute() {
        const items = this._items();
        const ordered = items.slice().sort(this.strategies[this.strategy].order);
        const finishOrdered = items.slice().sort(this.strategies.finish.order);
        this.steps = this._runGreedy(ordered);
        this.optimalFinish = this._runGreedy(finishOrdered).filter(s => s.accepted).map(s => s.item.id);
        this.weightedOptimal = this._weightedOptimal(items);
        this.stepIndex = Math.min(this.stepIndex, this.steps.length);
        this._render();
    },

    _items() {
        return this.presets[this.preset].intervals.map(item => ({ ...item }));
    },

    _runGreedy(ordered) {
        const steps = [];
        let lastEnd = -Infinity;
        ordered.forEach((item) => {
            const accepted = item.start >= lastEnd;
            steps.push({ item, accepted, lastEndBefore: lastEnd });
            if (accepted) lastEnd = item.end;
        });
        return steps;
    },

    _weightedOptimal(items) {
        const arr = items.slice().sort((a, b) => a.end - b.end || a.start - b.start);
        const p = arr.map((item, i) => {
            let best = -1;
            for (let j = 0; j < i; j++) {
                if (arr[j].end <= item.start) best = j;
            }
            return best;
        });
        const dp = new Array(arr.length).fill(0);
        const take = new Array(arr.length).fill(false);
        for (let i = 0; i < arr.length; i++) {
            const include = arr[i].value + (p[i] >= 0 ? dp[p[i]] : 0);
            const exclude = i > 0 ? dp[i - 1] : 0;
            if (include > exclude) {
                dp[i] = include;
                take[i] = true;
            } else {
                dp[i] = exclude;
            }
        }
        const chosen = [];
        for (let i = arr.length - 1; i >= 0;) {
            const include = arr[i].value + (p[i] >= 0 ? dp[p[i]] : 0);
            const exclude = i > 0 ? dp[i - 1] : 0;
            if (take[i] && include >= exclude) {
                chosen.push(arr[i].id);
                i = p[i];
            } else {
                i -= 1;
            }
        }
        return chosen.reverse();
    },

    _acceptedIds() {
        return this.steps.slice(0, this.stepIndex).filter(s => s.accepted).map(s => s.item.id);
    },

    _render() {
        if (!this.ctx || !this.W || !this.H) return;
        this._draw();
        this._updateInfo();
    },

    _draw() {
        const { ctx, W, H } = this;
        const items = this._items();
        const accepted = new Set(this._acceptedIds());
        const processed = new Set(this.steps.slice(0, this.stepIndex).map(s => s.item.id));
        const current = this.stepIndex < this.steps.length ? this.steps[this.stepIndex].item.id : null;
        const maxEnd = Math.max(...items.map(i => i.end));
        const minStart = Math.min(0, ...items.map(i => i.start));
        const xPad = W < 620 ? 54 : 74;
        const top = W < 620 ? 72 : 84;
        const rowH = W < 620 ? 34 : 40;
        const plotW = W - xPad - 24;
        const toX = (t) => xPad + (t - minStart) / (maxEnd - minStart) * plotW;

        const bg = ctx.createLinearGradient(0, 0, W, H);
        bg.addColorStop(0, this._COL.bg0);
        bg.addColorStop(1, this._COL.bg1);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,.035)';
        for (let x = -H; x < W; x += 42) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x + H, H);
            ctx.stroke();
        }
        ctx.restore();

        this._drawSummary(toX, minStart, maxEnd, xPad, top);

        ctx.save();
        ctx.strokeStyle = this._COL.grid;
        ctx.fillStyle = this._COL.dim;
        ctx.font = '11px system-ui, sans-serif';
        for (let t = minStart; t <= maxEnd; t += 1) {
            const x = toX(t);
            ctx.beginPath();
            ctx.moveTo(x, top - 16);
            ctx.lineTo(x, top + items.length * rowH + 8);
            ctx.stroke();
            if (t % 2 === 0 || W >= 620) ctx.fillText(String(t), x - 3, top - 24);
        }
        ctx.strokeStyle = this._COL.axis;
        ctx.beginPath();
        ctx.moveTo(xPad, top - 16);
        ctx.lineTo(xPad + plotW, top - 16);
        ctx.stroke();

        items.forEach((item, idx) => {
            const y = top + idx * rowH;
            const x1 = toX(item.start);
            const x2 = toX(item.end);
            const isAccepted = accepted.has(item.id);
            const isProcessed = processed.has(item.id);
            const isCurrent = item.id === current;
            const isOptimal = this.optimalFinish.includes(item.id);
            ctx.fillStyle = this._COL.muted;
            ctx.font = '12px "SFMono-Regular", Consolas, monospace';
            ctx.fillText(item.id, 18, y + 21);
            ctx.fillStyle = this._COL.dim;
            ctx.fillText(`${item.start}-${item.end}`, W < 620 ? 30 : 38, y + 21);

            let fill = 'rgba(148,163,184,.18)';
            let stroke = 'rgba(148,163,184,.35)';
            if (isOptimal) {
                fill = 'rgba(56,189,248,.12)';
                stroke = 'rgba(56,189,248,.38)';
            }
            if (isProcessed && !isAccepted) {
                fill = 'rgba(251,113,133,.12)';
                stroke = 'rgba(251,113,133,.45)';
            }
            if (isAccepted) {
                fill = 'rgba(52,211,153,.20)';
                stroke = 'rgba(52,211,153,.72)';
            }
            if (isCurrent) {
                fill = 'rgba(251,191,36,.24)';
                stroke = 'rgba(251,191,36,.86)';
            }
            this._roundedRect(ctx, x1, y, Math.max(x2 - x1, 10), rowH - 8, 8);
            ctx.fillStyle = fill;
            ctx.fill();
            ctx.strokeStyle = stroke;
            ctx.lineWidth = isCurrent ? 2 : 1.2;
            ctx.stroke();

            ctx.fillStyle = this._COL.text;
            ctx.font = '12px system-ui, sans-serif';
            const label = `${item.label}  权重 ${item.value}`;
            ctx.fillText(label, x1 + 9, y + 21);
        });

        const acceptedIds = this._acceptedIds();
        acceptedIds.forEach((id, order) => {
            const item = items.find(x => x.id === id);
            if (!item) return;
            const y = top + items.indexOf(item) * rowH;
            const x = toX(item.end) - 12;
            ctx.fillStyle = this._COL.green;
            ctx.beginPath();
            ctx.arc(x, y + 15, 10, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#082019';
            ctx.font = 'bold 11px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(String(order + 1), x, y + 19);
            ctx.textAlign = 'start';
        });

        const lastAccepted = acceptedIds.length ? items.find(i => i.id === acceptedIds[acceptedIds.length - 1]) : null;
        if (lastAccepted) {
            const x = toX(lastAccepted.end);
            ctx.strokeStyle = 'rgba(52,211,153,.72)';
            ctx.setLineDash([5, 6]);
            ctx.beginPath();
            ctx.moveTo(x, top - 20);
            ctx.lineTo(x, top + items.length * rowH + 4);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = this._COL.green;
            ctx.font = '12px system-ui, sans-serif';
            ctx.fillText('lastEnd', x + 6, top + items.length * rowH + 20);
        }
        ctx.restore();
    },

    _drawSummary(toX, minStart, maxEnd, xPad, top) {
        const { ctx, W } = this;
        const accepted = this._acceptedIds();
        const value = this._items().filter(i => accepted.includes(i.id)).reduce((sum, i) => sum + i.value, 0);
        const optValue = this._items().filter(i => this.weightedOptimal.includes(i.id)).reduce((sum, i) => sum + i.value, 0);
        const title = `${this.strategies[this.strategy].label} · 第 ${this.stepIndex}/${this.steps.length} 步`;
        const stats = `已选 ${accepted.length} / 最优数量 ${this.optimalFinish.length} · 当前权重 ${value} / 加权最优 ${optValue}`;

        ctx.fillStyle = 'rgba(255,255,255,.035)';
        this._roundedRect(ctx, 16, 16, W - 32, W < 620 ? 46 : 52, 10);
        ctx.fill();
        ctx.strokeStyle = 'rgba(196,121,58,.18)';
        ctx.stroke();
        ctx.fillStyle = this._COL.text;
        ctx.font = 'bold 14px system-ui, sans-serif';
        ctx.fillText(title, 30, 38);
        ctx.fillStyle = this._COL.muted;
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillText(stats, 30, W < 620 ? 56 : 58);

        ctx.fillStyle = this._COL.dim;
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillText(`${this.presets[this.preset].unit}时间轴`, xPad, top - 42);
        ctx.fillText(`范围 ${minStart}-${maxEnd}`, toX(maxEnd) - 56, top - 42);
    },

    _updateInfo() {
        const info = document.getElementById('greedy-info');
        if (!info) return;
        const accepted = this._acceptedIds();
        const currentStep = this.stepIndex > 0 ? this.steps[this.stepIndex - 1] : null;
        const selectedText = accepted.length ? accepted.join(' → ') : '尚未选择活动';
        const result = this.stepIndex === 0
            ? `尚未开始执行；该场景的无权最优数量是 ${this.optimalFinish.length} 个。`
            : accepted.length === this.optimalFinish.length
            ? '当前选择数量达到无权区间调度的最优数量。'
            : `当前策略只选到 ${accepted.length} 个，最早结束策略可选 ${this.optimalFinish.length} 个。`;
        const weightedValue = this._items().filter(i => accepted.includes(i.id)).reduce((sum, i) => sum + i.value, 0);
        const weightedOptValue = this._items().filter(i => this.weightedOptimal.includes(i.id)).reduce((sum, i) => sum + i.value, 0);
        const decision = currentStep
            ? `${currentStep.item.id}(${currentStep.item.start}-${currentStep.item.end}) ${currentStep.accepted ? '被接受' : '因与已选活动冲突而跳过'}。`
            : '先按策略排序，再从前到后检查每个活动。';

        info.innerHTML = `
            <div class="greedy-info__head">贪心选择：${this.strategies[this.strategy].label}</div>
            <div class="greedy-info__grid">
                <div class="greedy-info__row"><span>当前观察</span><p>${decision}</p></div>
                <div class="greedy-info__row"><span>已选活动</span><p>${selectedText}</p></div>
                <div class="greedy-info__row"><span>关键判断</span><p>${result}</p></div>
                <div class="greedy-info__row"><span>加权提醒</span><p>当前权重 ${weightedValue}，加权最优 ${weightedOptValue}；加权区间调度不能直接套用“最早结束”贪心。</p></div>
                <div class="greedy-info__row"><span>适用范围</span><p>最早结束策略适用于单资源、无权、最大活动数量的区间调度；若目标变成最大权重，需要动态规划或其他优化方法。</p></div>
                <div class="greedy-info__row"><span>参考依据</span><p>Jeff Erickson《Algorithms》贪心算法章节：先按结束时间排序，再用交换论证证明无权区间调度最优。</p></div>
            </div>`;
    },

    _roundedRect(ctx, x, y, w, h, r) {
        const rr = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.lineTo(x + w - rr, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
        ctx.lineTo(x + w, y + h - rr);
        ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
        ctx.lineTo(x + rr, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
        ctx.lineTo(x, y + rr);
        ctx.quadraticCurveTo(x, y, x + rr, y);
    }
};

function initGreedyScheduling() {
    GreedyScheduling.init();
}

if (typeof window !== 'undefined') {
    window.GreedyScheduling = GreedyScheduling;
    window.initGreedyScheduling = initGreedyScheduling;
}
