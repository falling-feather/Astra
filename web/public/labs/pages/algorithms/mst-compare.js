// ===== Minimum Spanning Tree Compare: Prim vs Kruskal =====

const MSTCompare = {
    canvas: null,
    ctx: null,
    W: 0,
    H: 0,
    _listeners: [],
    _ro: null,
    _timer: 0,
    playing: false,
    stepIndex: 0,
    preset: 'campus',
    primSteps: [],
    kruskalSteps: [],

    presets: {
        campus: {
            label: '校园光纤',
            nodes: [
                { id: 0, label: 'A', x: 0.14, y: 0.20 },
                { id: 1, label: 'B', x: 0.45, y: 0.12 },
                { id: 2, label: 'C', x: 0.78, y: 0.24 },
                { id: 3, label: 'D', x: 0.20, y: 0.68 },
                { id: 4, label: 'E', x: 0.54, y: 0.55 },
                { id: 5, label: 'F', x: 0.86, y: 0.73 }
            ],
            edges: [
                [0, 1, 4], [0, 3, 7], [0, 4, 8],
                [1, 2, 5], [1, 3, 6], [1, 4, 3],
                [2, 4, 6], [2, 5, 9],
                [3, 4, 2], [3, 5, 11],
                [4, 5, 4]
            ]
        },
        bridge: {
            label: '桥梁节点',
            nodes: [
                { id: 0, label: 'P', x: 0.12, y: 0.52 },
                { id: 1, label: 'Q', x: 0.30, y: 0.18 },
                { id: 2, label: 'R', x: 0.55, y: 0.20 },
                { id: 3, label: 'S', x: 0.82, y: 0.36 },
                { id: 4, label: 'T', x: 0.32, y: 0.78 },
                { id: 5, label: 'U', x: 0.62, y: 0.72 },
                { id: 6, label: 'V', x: 0.88, y: 0.78 }
            ],
            edges: [
                [0, 1, 5], [0, 4, 4], [1, 2, 2], [1, 4, 7],
                [2, 3, 6], [2, 5, 3], [3, 5, 8], [3, 6, 5],
                [4, 5, 6], [5, 6, 4], [0, 5, 10]
            ]
        }
    },

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        this.destroy();
        this.canvas = document.getElementById('mst-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.canvas.setAttribute('role', 'img');
        this.canvas.setAttribute('aria-label', 'Prim 与 Kruskal 最小生成树算法并排对比');
        this._resize();
        this._buildControls();
        this._recompute();
        if (typeof ResizeObserver !== 'undefined') {
            this._ro = new ResizeObserver(() => this._resize());
            this._ro.observe(this.canvas.parentElement);
        } else {
            this._on(window, 'resize', () => this._resize());
        }
    },

    destroy() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = 0;
        }
        this.playing = false;
        this._listeners.forEach(l => l.el.removeEventListener(l.evt, l.fn, l.opts));
        this._listeners.length = 0;
        if (this._ro) this._ro.disconnect();
        this._ro = null;
        const ctrl = document.getElementById('mst-controls');
        if (ctrl) ctrl.innerHTML = '';
        this.canvas = null;
        this.ctx = null;
    },

    _resize() {
        if (!this.canvas || !this.canvas.parentElement || !this.ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const w = this.canvas.parentElement.getBoundingClientRect().width || 640;
        const h = w < 720 ? Math.min(Math.max(w * 1.15, 520), 700) : Math.min(Math.max(w * 0.56, 420), 560);
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
        const ctrl = document.getElementById('mst-controls');
        if (!ctrl) return;
        ctrl.innerHTML = '';

        const actions = document.createElement('div');
        actions.className = 'mst-actions';
        [
            ['play', '播放'],
            ['prev', '上一步'],
            ['next', '下一步'],
            ['reset', '重置']
        ].forEach(([id, text]) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'mst-btn' + (id === 'play' ? ' mst-btn--primary' : '');
            btn.id = 'mst-' + id;
            btn.textContent = text;
            this._on(btn, 'click', () => this._handleAction(id));
            actions.appendChild(btn);
        });
        ctrl.appendChild(actions);

        const presets = document.createElement('div');
        presets.className = 'mst-presets';
        Object.entries(this.presets).forEach(([key, item]) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'mst-chip' + (key === this.preset ? ' active' : '');
            btn.textContent = item.label;
            this._on(btn, 'click', () => {
                this.preset = key;
                this.stepIndex = 0;
                this.playing = false;
                this._syncPlayButton();
                presets.querySelectorAll('.mst-chip').forEach(b => b.classList.toggle('active', b === btn));
                this._recompute();
            });
            presets.appendChild(btn);
        });
        ctrl.appendChild(presets);
    },

    _handleAction(action) {
        const max = this._maxSteps();
        if (action === 'play') {
            this.playing = !this.playing;
            this._syncPlayButton();
            if (this.playing) {
                this._timer = setInterval(() => {
                    if (this.stepIndex >= max) {
                        this.playing = false;
                        this._syncPlayButton();
                        clearInterval(this._timer);
                        this._timer = 0;
                        return;
                    }
                    this.stepIndex++;
                    this._updateInfo();
                    this._draw();
                }, 900);
            } else if (this._timer) {
                clearInterval(this._timer);
                this._timer = 0;
            }
        } else if (action === 'prev') {
            this.stepIndex = Math.max(0, this.stepIndex - 1);
        } else if (action === 'next') {
            this.stepIndex = Math.min(max, this.stepIndex + 1);
        } else if (action === 'reset') {
            this.stepIndex = 0;
            this.playing = false;
            this._syncPlayButton();
            if (this._timer) clearInterval(this._timer);
            this._timer = 0;
        }
        this._updateInfo();
        this._draw();
    },

    _syncPlayButton() {
        const btn = document.getElementById('mst-play');
        if (btn) btn.textContent = this.playing ? '暂停' : '播放';
    },

    _recompute() {
        const data = this.presets[this.preset];
        this.primSteps = this._prim(data);
        this.kruskalSteps = this._kruskal(data);
        this._updateInfo();
        this._draw();
    },

    _maxSteps() {
        return Math.max(this.primSteps.length, this.kruskalSteps.length);
    },

    _edgeKey(edge) {
        const a = Math.min(edge.u, edge.v);
        const b = Math.max(edge.u, edge.v);
        return a + '-' + b;
    },

    _edges(data) {
        return data.edges.map((e, i) => ({ u: e[0], v: e[1], w: e[2], id: i, key: Math.min(e[0], e[1]) + '-' + Math.max(e[0], e[1]) }));
    },

    _prim(data) {
        const n = data.nodes.length;
        const edges = this._edges(data);
        const visited = new Set([0]);
        const accepted = [];
        const steps = [];

        while (visited.size < n) {
            const candidates = edges.filter(e => visited.has(e.u) !== visited.has(e.v));
            candidates.sort((a, b) => a.w - b.w || a.u - b.u || a.v - b.v);
            const chosen = candidates[0];
            if (!chosen) break;
            accepted.push(chosen);
            visited.add(visited.has(chosen.u) ? chosen.v : chosen.u);
            steps.push({
                current: chosen,
                accepted: accepted.map(e => e.key),
                candidates: candidates.slice(0, 5).map(e => e.key),
                visited: Array.from(visited),
                message: `从当前树向外选择最小跨边 ${this._edgeName(data, chosen)}，总权重 ${this._sumAccepted(accepted)}。`
            });
        }
        return steps;
    },

    _kruskal(data) {
        const n = data.nodes.length;
        const edges = this._edges(data).sort((a, b) => a.w - b.w || a.u - b.u || a.v - b.v);
        const parent = Array.from({ length: n }, (_, i) => i);
        const find = x => {
            while (parent[x] !== x) {
                parent[x] = parent[parent[x]];
                x = parent[x];
            }
            return x;
        };
        const union = (a, b) => {
            const ra = find(a);
            const rb = find(b);
            if (ra !== rb) parent[rb] = ra;
            return ra !== rb;
        };

        const accepted = [];
        const rejected = [];
        const steps = [];
        for (const edge of edges) {
            const ok = union(edge.u, edge.v);
            if (ok) accepted.push(edge);
            else rejected.push(edge);

            const components = {};
            for (let i = 0; i < n; i++) {
                const root = find(i);
                if (!components[root]) components[root] = [];
                components[root].push(i);
            }

            steps.push({
                current: edge,
                action: ok ? 'accept' : 'reject',
                accepted: accepted.map(e => e.key),
                rejected: rejected.map(e => e.key),
                components,
                message: ok
                    ? `按边权顺序接受 ${this._edgeName(data, edge)}，合并两个连通分量。`
                    : `${this._edgeName(data, edge)} 会形成环，跳过。`
            });
            if (accepted.length === n - 1) break;
        }
        return steps;
    },

    _sumAccepted(edges) {
        return edges.reduce((sum, e) => sum + e.w, 0);
    },

    _edgeName(data, edge) {
        return `${data.nodes[edge.u].label}-${data.nodes[edge.v].label}(${edge.w})`;
    },

    _stateFor(steps) {
        if (this.stepIndex <= 0) {
            return { current: null, accepted: [], rejected: [], candidates: [], visited: [0], message: '尚未开始，点击下一步或播放观察选边顺序。' };
        }
        return steps[Math.min(this.stepIndex, steps.length) - 1] || steps[steps.length - 1];
    },

    _updateInfo() {
        const info = document.getElementById('mst-info');
        if (!info) return;
        const data = this.presets[this.preset];
        const prim = this._stateFor(this.primSteps);
        const kruskal = this._stateFor(this.kruskalSteps);
        const finalWeight = this.primSteps.length
            ? this.primSteps[this.primSteps.length - 1].accepted.reduce((sum, key) => sum + this._edgeByKey(data, key).w, 0)
            : 0;

        info.innerHTML = `
            <div class="mst-info__head">最小生成树观察卡</div>
            <div class="mst-info__grid">
                <div class="mst-info__row"><span>当前观察</span><p>第 ${this.stepIndex}/${this._maxSteps()} 步；Prim：${prim.message} Kruskal：${kruskal.message}</p></div>
                <div class="mst-info__row"><span>关键判断</span><p>两种算法都只适用于连通无向带权图，目标是连接全部顶点且总权重最小；最终 MST 权重为 ${finalWeight}。</p></div>
                <div class="mst-info__row"><span>适用范围</span><p>Prim 从一个已连通的顶点集合向外扩张；Kruskal 从全局最小边开始，用并查集避免成环。</p></div>
                <div class="mst-info__row"><span>参考依据</span><p>OpenDSA：Minimal Cost Spanning Trees 与 Kruskal’s Algorithm。</p></div>
            </div>
        `;
    },

    _edgeByKey(data, key) {
        return this._edges(data).find(e => e.key === key) || { w: 0 };
    },

    _draw() {
        const { ctx, W, H } = this;
        if (!ctx || !W || !H) return;
        const data = this.presets[this.preset];
        ctx.clearRect(0, 0, W, H);

        const bg = ctx.createLinearGradient(0, 0, W, H);
        bg.addColorStop(0, '#120f0a');
        bg.addColorStop(0.55, '#1a120b');
        bg.addColorStop(1, '#0f172a');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        const stacked = W < 720;
        const gap = 18;
        const panelH = stacked ? (H - gap * 3) / 2 : H - gap * 2;
        const panelW = stacked ? W - gap * 2 : (W - gap * 3) / 2;
        const primBox = { x: gap, y: gap, w: panelW, h: panelH };
        const krBox = stacked
            ? { x: gap, y: gap * 2 + panelH, w: panelW, h: panelH }
            : { x: gap * 2 + panelW, y: gap, w: panelW, h: panelH };

        this._drawPanel(primBox, 'Prim：从树向外扩张', this._stateFor(this.primSteps), '#f59e0b', true);
        this._drawPanel(krBox, 'Kruskal：按边权全局扫描', this._stateFor(this.kruskalSteps), '#38bdf8', false);
    },

    _drawPanel(box, title, state, accent, isPrim) {
        const { ctx } = this;
        const data = this.presets[this.preset];
        const nodeById = Object.fromEntries(data.nodes.map(n => [n.id, n]));
        const sx = x => box.x + 28 + x * (box.w - 56);
        const sy = y => box.y + 50 + y * (box.h - 92);
        const accepted = new Set(state.accepted || []);
        const rejected = new Set(state.rejected || []);
        const candidates = new Set(state.candidates || []);
        const currentKey = state.current ? this._edgeKey(state.current) : '';

        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,.035)';
        ctx.strokeStyle = 'rgba(245,158,11,.18)';
        this._roundRect(box.x, box.y, box.w, box.h, 10);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = 'rgba(255,255,255,.9)';
        ctx.font = '700 14px Inter, sans-serif';
        ctx.fillText(title, box.x + 16, box.y + 24);

        ctx.font = '12px Inter, sans-serif';
        const total = Array.from(accepted).reduce((sum, key) => sum + this._edgeByKey(data, key).w, 0);
        ctx.fillStyle = 'rgba(255,255,255,.62)';
        ctx.fillText(`已选 ${accepted.size}/${data.nodes.length - 1} 条 · 权重 ${total}`, box.x + 16, box.y + 43);

        for (const raw of data.edges) {
            const edge = { u: raw[0], v: raw[1], w: raw[2], key: Math.min(raw[0], raw[1]) + '-' + Math.max(raw[0], raw[1]) };
            const a = nodeById[edge.u];
            const b = nodeById[edge.v];
            let color = 'rgba(255,255,255,.20)';
            let width = 1.4;
            if (candidates.has(edge.key)) color = 'rgba(250,204,21,.42)';
            if (rejected.has(edge.key)) color = 'rgba(248,113,113,.30)';
            if (accepted.has(edge.key)) {
                color = accent;
                width = 4;
            }
            if (edge.key === currentKey) {
                color = '#fde68a';
                width = 5;
            }
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.beginPath();
            ctx.moveTo(sx(a.x), sy(a.y));
            ctx.lineTo(sx(b.x), sy(b.y));
            ctx.stroke();

            const mx = (sx(a.x) + sx(b.x)) / 2;
            const my = (sy(a.y) + sy(b.y)) / 2;
            ctx.fillStyle = 'rgba(15,23,42,.88)';
            this._roundRect(mx - 11, my - 10, 22, 18, 5);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,.82)';
            ctx.font = '700 11px JetBrains Mono, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(String(edge.w), mx, my + 4);
            ctx.textAlign = 'start';
        }

        const componentColors = ['#f59e0b', '#38bdf8', '#4ade80', '#f472b6', '#a78bfa', '#fb7185', '#22d3ee'];
        const compByNode = {};
        if (!isPrim && state.components) {
            Object.values(state.components).forEach((group, i) => {
                group.forEach(id => { compByNode[id] = componentColors[i % componentColors.length]; });
            });
        }
        const visited = new Set(state.visited || []);
        data.nodes.forEach(node => {
            const x = sx(node.x);
            const y = sy(node.y);
            const nodeColor = isPrim
                ? (visited.has(node.id) ? accent : 'rgba(255,255,255,.22)')
                : (compByNode[node.id] || 'rgba(255,255,255,.22)');
            ctx.fillStyle = 'rgba(0,0,0,.32)';
            ctx.beginPath();
            ctx.arc(x + 2, y + 3, 15, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = nodeColor;
            ctx.beginPath();
            ctx.arc(x, y, 15, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,.72)';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = '#111827';
            ctx.font = '800 12px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(node.label, x, y + 4);
            ctx.textAlign = 'start';
        });
        ctx.restore();
    },

    _roundRect(x, y, w, h, r) {
        const rr = Math.min(r, w / 2, h / 2);
        const { ctx } = this;
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.arcTo(x + w, y, x + w, y + h, rr);
        ctx.arcTo(x + w, y + h, x, y + h, rr);
        ctx.arcTo(x, y + h, x, y, rr);
        ctx.arcTo(x, y, x + w, y, rr);
        ctx.closePath();
    }
};

function initMSTCompare() {
    MSTCompare.init();
}

if (typeof window !== 'undefined') {
    window.MSTCompare = MSTCompare;
    window.initMSTCompare = initMSTCompare;
}
