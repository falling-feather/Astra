// ===== Set Operations Visualization =====
// Venn diagram with interactive set operations: Union, Intersection, Difference, Complement

const SetOps = {
    canvas: null, ctx: null, W: 0, H: 0,
    setA: new Set([1,2,3,4,5,6]),
    setB: new Set([4,5,6,7,8,9]),
    universal: new Set([1,2,3,4,5,6,7,8,9,10]),
    operation: 'union',  // union, intersection, differenceAB, differenceBA, complement, symmetric
    result: new Set(),
    hoverRegion: null,
    _listeners: [],
    _resizeObs: null,

    opInfo: {
        union:         { symbol: 'A \u222a B', name: '\u5e76\u96c6', desc: '\u5c5e\u4e8e A \u6216\u5c5e\u4e8e B \u7684\u6240\u6709\u5143\u7d20' },
        intersection:  { symbol: 'A \u2229 B', name: '\u4ea4\u96c6', desc: '\u540c\u65f6\u5c5e\u4e8e A \u548c B \u7684\u5143\u7d20' },
        differenceAB:  { symbol: 'A \u2212 B', name: '\u5dee\u96c6 A-B', desc: '\u5c5e\u4e8e A \u4f46\u4e0d\u5c5e\u4e8e B \u7684\u5143\u7d20' },
        differenceBA:  { symbol: 'B \u2212 A', name: '\u5dee\u96c6 B-A', desc: '\u5c5e\u4e8e B \u4f46\u4e0d\u5c5e\u4e8e A \u7684\u5143\u7d20' },
        complement:    { symbol: 'A\u1d9c (U\u2212A)', name: 'A \u7684\u8865\u96c6', desc: '\u5168\u96c6\u4e2d\u4e0d\u5c5e\u4e8e A \u7684\u5143\u7d20' },
        symmetric:     { symbol: 'A \u2206 B', name: '\u5bf9\u79f0\u5dee', desc: '\u5c5e\u4e8e A \u6216 B \u4f46\u4e0d\u540c\u65f6\u5c5e\u4e8e\u4e24\u8005\u7684\u5143\u7d20' }
    },

    colors: {
        setA: 'rgba(91,141,206,0.35)',
        setB: 'rgba(198,120,221,0.35)',
        highlight: 'rgba(86,182,194,0.5)',
        stroke: 'rgba(255,255,255,0.3)',
        text: 'rgba(255,255,255,0.85)'
    },

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        this.canvas = document.getElementById('setops-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        this.bindEvents();
        this.compute();
        this.draw();
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
    },

    bindEvents() {
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver(() => { this.resize(); this.draw(); });
            this._resizeObs.observe(this.canvas.parentElement);
        } else {
            this._on(window, 'resize', () => { this.resize(); this.draw(); });
        }

        // Operation buttons
        document.querySelectorAll('.setops-op-btn').forEach(btn => {
            this._on(btn, 'click', () => {
                document.querySelectorAll('.setops-op-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.operation = btn.dataset.op;
                this.compute();
                this.draw();
                this.updateInfo();
            });
        });

        // Hover on canvas
        this._on(this.canvas, 'mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const region = this.hitTest(x, y);
            if (region !== this.hoverRegion) {
                this.hoverRegion = region;
                this.draw();
            }
        });
        this._on(this.canvas, 'mouseleave', () => {
            this.hoverRegion = null;
            this.draw();
        });

        // Edit set inputs
        const inputA = document.getElementById('setops-input-a');
        const inputB = document.getElementById('setops-input-b');
        const inputU = document.getElementById('setops-input-u');
        if (inputA) this._on(inputA, 'change', () => { this.parseInput(inputA, 'setA'); });
        if (inputB) this._on(inputB, 'change', () => { this.parseInput(inputB, 'setB'); });
        if (inputU) this._on(inputU, 'change', () => { this.parseInput(inputU, 'universal'); });
    },

    parseInput(el, prop) {
        const nums = el.value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
        if (nums.length > 0) {
            this[prop] = new Set(nums);
            this.compute();
            this.draw();
            this.updateInfo();
        }
    },

    compute() {
        const A = this.setA;
        const B = this.setB;
        const U = this.universal;
        switch (this.operation) {
            case 'union':
                this.result = new Set([...A, ...B]); break;
            case 'intersection':
                this.result = new Set([...A].filter(x => B.has(x))); break;
            case 'differenceAB':
                this.result = new Set([...A].filter(x => !B.has(x))); break;
            case 'differenceBA':
                this.result = new Set([...B].filter(x => !A.has(x))); break;
            case 'complement':
                this.result = new Set([...U].filter(x => !A.has(x))); break;
            case 'symmetric':
                this.result = new Set([...A].filter(x => !B.has(x)).concat([...B].filter(x => !A.has(x)))); break;
        }
        this.updateInfo();
    },

    updateInfo() {
        const info = this.opInfo[this.operation];
        const nameEl = document.getElementById('setops-op-name');
        const descEl = document.getElementById('setops-op-desc');
        const resultEl = document.getElementById('setops-result');
        if (nameEl) nameEl.textContent = info.symbol + ' \u2014 ' + info.name;
        if (descEl) descEl.textContent = info.desc;
        if (resultEl) {
            const sorted = [...this.result].sort((a, b) => a - b);
            resultEl.textContent = '\u7ed3\u679c = {' + sorted.join(', ') + '}' + ' \uff08' + sorted.length + ' \u4e2a\u5143\u7d20\uff09';
        }
        /* education panel */
        const eduEl = document.getElementById('setops-edu');
        if (eduEl) {
            const opEdu = {
                union: '<div class="math-row"><span class="math-key">并集 A∪B</span>属于 A <strong>或</strong>属于 B 的全部元素（"或"关系）</div><div class="math-row"><span class="math-key math-key--amber">性质</span>A⊆A∪B, B⊆A∪B；A∪∅=A；A∪U=U</div>',
                intersection: '<div class="math-row"><span class="math-key">交集 A∩B</span><strong>同时</strong>属于 A 和 B 的元素（"且"关系）</div><div class="math-row"><span class="math-key math-key--amber">性质</span>A∩B⊆A, A∩B⊆B；A∩∅=∅；A∩A=A</div>',
                differenceAB: '<div class="math-row"><span class="math-key">差集 A−B</span>属于 A 但<strong>不</strong>属于 B 的元素</div><div class="math-row"><span class="math-key math-key--amber">性质</span>A−B = A∩B\u1d9c；(A−B)∪(A∩B) = A</div>',
                differenceBA: '<div class="math-row"><span class="math-key">差集 B−A</span>属于 B 但<strong>不</strong>属于 A 的元素</div><div class="math-row"><span class="math-key math-key--amber">性质</span>B−A = B∩A\u1d9c；通常 A−B ≠ B−A</div>',
                complement: '<div class="math-row"><span class="math-key">补集 A\u1d9c</span>全集 U 中不属于 A 的元素，即 U−A</div><div class="math-row"><span class="math-key math-key--amber">德摩根律</span>(A∪B)\u1d9c = A\u1d9c∩B\u1d9c；(A∩B)\u1d9c = A\u1d9c∪B\u1d9c</div>',
                symmetric: '<div class="math-row"><span class="math-key">对称差 A△B</span>属于 A 或 B 但不同时属于两者：(A−B)∪(B−A)</div><div class="math-row"><span class="math-key math-key--amber">等价</span>A△B = (A∪B) − (A∩B)</div>'
            };
            eduEl.innerHTML = `<div class="math-hd"><span class="math-tag">${info.symbol}</span>集合运算知识点</div>
${opEdu[this.operation]}
<div class="math-row"><span class="math-key math-key--red">Venn 图</span>阴影区域表示运算结果 — 画 Venn 图是解集合题的核心方法</div>
<div class="math-row"><span class="math-key">元素特性</span>确定性（能判断是否属于集合）、互异性（元素不重复）、无序性</div>
<div class="math-note">💡 人教版必修1：集合是高中数学的基础语言。修改输入框中的元素，观察 Venn 图与运算结果的对应关系</div>`;
        }
    },

    getCircles() {
        const cx = this.W / 2;
        const cy = this.H / 2;
        const r = Math.min(this.W * 0.18, this.H * 0.35, 110);
        const offset = r * 0.55;
        return {
            A: { x: cx - offset, y: cy, r },
            B: { x: cx + offset, y: cy, r }
        };
    },

    hitTest(mx, my) {
        const c = this.getCircles();
        const inA = Math.hypot(mx - c.A.x, my - c.A.y) <= c.A.r;
        const inB = Math.hypot(mx - c.B.x, my - c.B.y) <= c.B.r;
        if (inA && inB) return 'AB';
        if (inA) return 'A';
        if (inB) return 'B';
        return 'outside';
    },

    draw() {
        const { ctx, W, H, operation } = this;
        if (!ctx || W === 0) return;
        ctx.clearRect(0, 0, W, H);
        const c = this.getCircles();

        // Universal set rectangle
        const margin = 20;
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(margin, margin, W - margin * 2, H - margin * 2);
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '20px ' + CF.sans;
        ctx.fillText('U', margin + 6, margin + 16);

        // Draw highlight FIRST (behind circles)
        this.drawHighlight(c);

        // Set A
        ctx.beginPath();
        ctx.arc(c.A.x, c.A.y, c.A.r, 0, Math.PI * 2);
        ctx.fillStyle = this.colors.setA;
        ctx.fill();
        ctx.strokeStyle = this.colors.stroke;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Set B
        ctx.beginPath();
        ctx.arc(c.B.x, c.B.y, c.B.r, 0, Math.PI * 2);
        ctx.fillStyle = this.colors.setB;
        ctx.fill();
        ctx.strokeStyle = this.colors.stroke;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Labels
        ctx.fillStyle = this.colors.text;
        ctx.font = 'bold 24px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('A', c.A.x - c.A.r * 0.55, c.A.y);
        ctx.fillText('B', c.B.x + c.B.r * 0.55, c.B.y);

        // Element numbers in regions
        this.drawElements(c);

        // Hover tooltip
        if (this.hoverRegion) this.drawTooltip(c);

        // Formula display
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '23px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(this.opInfo[operation].symbol, W / 2, H - 30);
    },

    drawHighlight(c) {
        const ctx = this.ctx;
        const op = this.operation;

        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = this.colors.highlight;

        if (op === 'union') {
            ctx.beginPath();
            ctx.arc(c.A.x, c.A.y, c.A.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(c.B.x, c.B.y, c.B.r, 0, Math.PI * 2);
            ctx.fill();
        } else if (op === 'intersection') {
            // Clip A then fill B
            ctx.beginPath();
            ctx.arc(c.A.x, c.A.y, c.A.r, 0, Math.PI * 2);
            ctx.clip();
            ctx.beginPath();
            ctx.arc(c.B.x, c.B.y, c.B.r, 0, Math.PI * 2);
            ctx.fill();
        } else if (op === 'differenceAB') {
            // A minus B: draw A, then subtract B
            ctx.beginPath();
            ctx.arc(c.A.x, c.A.y, c.A.r, 0, Math.PI * 2);
            ctx.arc(c.B.x, c.B.y, c.B.r, 0, Math.PI * 2, true);
            ctx.fill();
        } else if (op === 'differenceBA') {
            ctx.beginPath();
            ctx.arc(c.B.x, c.B.y, c.B.r, 0, Math.PI * 2);
            ctx.arc(c.A.x, c.A.y, c.A.r, 0, Math.PI * 2, true);
            ctx.fill();
        } else if (op === 'complement') {
            // Fill universal, subtract A
            const margin = 20;
            ctx.beginPath();
            ctx.rect(margin, margin, this.W - margin * 2, this.H - margin * 2);
            ctx.arc(c.A.x, c.A.y, c.A.r, 0, Math.PI * 2, true);
            ctx.fill();
        } else if (op === 'symmetric') {
            // (A-B) U (B-A)
            ctx.beginPath();
            ctx.arc(c.A.x, c.A.y, c.A.r, 0, Math.PI * 2);
            ctx.arc(c.B.x, c.B.y, c.B.r, 0, Math.PI * 2, true);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(c.B.x, c.B.y, c.B.r, 0, Math.PI * 2);
            ctx.arc(c.A.x, c.A.y, c.A.r, 0, Math.PI * 2, true);
            ctx.fill();
        }
        ctx.restore();
    },

    drawElements(c) {
        const ctx = this.ctx;
        const A = this.setA;
        const B = this.setB;
        const U = this.universal;

        // Partition elements into regions
        const onlyA = [...A].filter(x => !B.has(x));
        const onlyB = [...B].filter(x => !A.has(x));
        const both = [...A].filter(x => B.has(x));
        const outside = [...U].filter(x => !A.has(x) && !B.has(x));

        ctx.font = '17px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Only A region
        const inResult = this.result;
        const drawNums = (nums, cx, cy, spread) => {
            const cols = Math.ceil(Math.sqrt(nums.length));
            nums.sort((a, b) => a - b).forEach((n, i) => {
                const row = Math.floor(i / cols);
                const col = i % cols;
                const x = cx + (col - (cols - 1) / 2) * spread;
                const y = cy + (row - (Math.ceil(nums.length / cols) - 1) / 2) * (spread * 0.9);
                ctx.fillStyle = inResult.has(n) ? '#56b6c2' : 'rgba(255,255,255,0.45)';
                ctx.fillText(n, x, y);
            });
        };

        const offset = c.A.r * 0.35;
        if (onlyA.length) drawNums(onlyA, c.A.x - offset, c.A.y, 16);
        if (onlyB.length) drawNums(onlyB, c.B.x + offset, c.B.y, 16);
        if (both.length) drawNums(both, (c.A.x + c.B.x) / 2, c.A.y, 16);

        // Outside elements (near corners)
        if (outside.length) {
            ctx.fillStyle = inResult.has(outside[0]) ? '#56b6c2' : 'rgba(255,255,255,0.3)';
            ctx.font = '16px ' + CF.mono;
            const outs = outside.sort((a, b) => a - b).join(', ');
            ctx.fillText(outs, this.W / 2, this.H - 50);
        }
    },

    drawTooltip(c) {
        const ctx = this.ctx;
        const r = this.hoverRegion;
        let elements = [];
        let label = '';
        if (r === 'A') {
            elements = [...this.setA].filter(x => !this.setB.has(x));
            label = 'A \u2212 B';
        } else if (r === 'B') {
            elements = [...this.setB].filter(x => !this.setA.has(x));
            label = 'B \u2212 A';
        } else if (r === 'AB') {
            elements = [...this.setA].filter(x => this.setB.has(x));
            label = 'A \u2229 B';
        } else if (r === 'outside') {
            elements = [...this.universal].filter(x => !this.setA.has(x) && !this.setB.has(x));
            label = 'U \u2212 (A \u222a B)';
        }
        if (!label) return;
        const sorted = elements.sort((a, b) => a - b);
        const text = label + ' = {' + sorted.join(', ') + '}';
        ctx.fillStyle = 'rgba(30,30,30,0.85)';
        ctx.font = '18px ' + CF.sans;
        const tw = ctx.measureText(text).width + 16;
        const tx = this.W / 2 - tw / 2;
        const ty = 30;
        ctx.fillRect(tx, ty, tw, 24);
        ctx.fillStyle = '#56b6c2';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, this.W / 2, ty + 12);
    }
};

function initSetOps() {
    SetOps.init();
}

window.SetOps = SetOps;
window.initSetOps = initSetOps;