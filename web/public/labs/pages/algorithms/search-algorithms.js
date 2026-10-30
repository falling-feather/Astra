/* ═══════════════════════════════════════════════════════════════════
   search-algorithms.js  v3.0
   \u641c\u7d22\u7b97\u6cd5\u53ef\u89c6\u5316\u6a21\u5757
   \u2500  SearchComparison : Linear / Binary / Interpolation / Jump
   \u2500  TreeTraversal    : PreOrder / InOrder / PostOrder / LevelOrder
   \u2500  HashSearch       : Hash Table Lookup (\u94fe\u5730\u5740\u6cd5)
   ═══════════════════════════════════════════════════════════════════ */

/* ============================================================
   \u2460  SearchComparison  \u2014  DOM-\u57fa\u7684\u6570\u7ec4\u641c\u7d22\u53ef\u89c6\u5316
   ============================================================ */
var SearchComparison = {
    arr: [], target: null, speed: 600,
    isRunning: false, mode: 'binary',
    _listeners: [], _timers: [],

    /* ── \u4e8b\u4ef6/\u5b9a\u65f6\u5668\u7ba1\u7406 ── */
    _on(el, evt, fn, opts) { el.addEventListener(evt, fn, opts); this._listeners.push([el, evt, fn, opts]); },
    _delay(ms) { return new Promise(r => { const t = setTimeout(r, ms); this._timers.push(t); }); },
    _clearTimers() { this._timers.forEach(t => clearTimeout(t)); this._timers = []; },

    init() {
        this.destroy();
        this.generateArray();

        /* \u901f\u5ea6\u6ed1\u5757 */
        const spd = document.getElementById('bs-speed');
        if (spd) {
            this._on(spd, 'input', () => {
                this.speed = +spd.value;
                const lbl = document.getElementById('bs-speed-value');
                if (lbl) lbl.textContent = spd.value + 'ms';
            });
        }

        /* \u6a21\u5f0f\u5207\u6362\u6309\u94ae */
        document.querySelectorAll('.sc-mode-btn').forEach(b => {
            this._on(b, 'click', () => {
                if (this.isRunning) return;
                document.querySelectorAll('.sc-mode-btn').forEach(x => x.classList.remove('active'));
                b.classList.add('active');
                this.mode = b.dataset.mode;
                this.reset();
                this.updateEdu('idle');
            });
        });

        this.updateEdu('idle');
    },

    destroy() {
        this._clearTimers();
        this._listeners.forEach(([el, evt, fn, opts]) => el.removeEventListener(evt, fn, opts));
        this._listeners = [];
        this.isRunning = false;
    },

    /* ── \u6570\u7ec4\u751f\u6210 ── */
    generateArray() {
        if (this.isRunning) return;
        const n = 20;
        const set = new Set();
        while (set.size < n) set.add(Math.floor(Math.random() * 99) + 1);
        this.arr = [...set].sort((a, b) => a - b);
        this.target = null;
        this.render();
        this.setInfo('\u70b9\u51fb "\u5f00\u59cb\u67e5\u627e" \u6216\u5148\u9009\u62e9\u7b97\u6cd5\u6a21\u5f0f');
        this.updateEdu('idle');
    },

    /* ── DOM \u6e32\u67d3 ── */
    render(highlights) {
        const c = document.getElementById('bs-array');
        if (!c) return;
        c.innerHTML = '';
        const hl = highlights || {};
        this.arr.forEach((v, i) => {
            const cell = document.createElement('div');
            cell.className = 'bs-cell';
            if (hl.found === i) cell.classList.add('bs-found');
            else if (hl.mid === i) cell.classList.add('bs-mid');
            else if (hl.low !== undefined && hl.high !== undefined && i >= hl.low && i <= hl.high && !hl.eliminated?.has(i)) {
                if (i === hl.low) cell.classList.add('bs-low');
                else if (i === hl.high) cell.classList.add('bs-high');
            } else if (hl.eliminated?.has(i)) {
                cell.classList.add('bs-eliminated');
            }
            if (hl.current === i) cell.classList.add('bs-mid');      /* \u5f53\u524d\u68c0\u67e5\u4f4d */
            if (hl.jump === i) cell.classList.add('bs-low');          /* jump \u8df3\u8dc3\u4f4d */
            if (hl.interp === i) cell.classList.add('bs-mid');        /* \u63d2\u503c\u4f30\u8ba1\u4f4d */

            cell.innerHTML = '<span class="bs-idx">' + i + '</span><span class="bs-val">' + v + '</span>';
            c.appendChild(cell);
        });
    },

    /* ── \u5f00\u59cb\u67e5\u627e ── */
    async start() {
        if (this.isRunning) return;
        const input = document.getElementById('bs-target');
        if (!input) return;
        let t = parseInt(input.value);
        if (isNaN(t)) {
            t = this.arr[Math.floor(Math.random() * this.arr.length)];
            input.value = t;
        }
        this.target = t;
        this.isRunning = true;
        this._aborted = false;
        this.setButtons(false);

        switch (this.mode) {
            case 'linear':  await this.runLinear(); break;
            case 'binary':  await this.runBinary(); break;
            case 'interp':  await this.runInterpolation(); break;
            case 'jump':    await this.runJump(); break;
        }

        this.isRunning = false;
        this.setButtons(true);
    },

    /* ── Linear Search O(n) ── */
    async runLinear() {
        const arr = this.arr, t = this.target;
        let steps = 0;
        this.updateEdu('linear-start');
        for (let i = 0; i < arr.length; i++) {
            if (this._aborted) return;
            steps++;
            const eliminated = new Set();
            for (let j = 0; j < i; j++) eliminated.add(j);
            this.render({ current: i, eliminated });
            this.setInfo('\u7ebf\u6027\u641c\u7d22\uff1a\u7b2c ' + steps + ' \u6b65\uff0c\u68c0\u67e5 arr[' + i + '] = ' + arr[i]);
            this.updateEdu('linear-visit');
            await this._delay(this.speed);

            if (arr[i] === t) {
                this.render({ found: i });
                this.setInfo('\u2705 \u7ebf\u6027\u641c\u7d22\uff1a\u627e\u5230 ' + t + ' \u5728\u7d22\u5f15 ' + i + '\uff0c\u5171 ' + steps + ' \u6b65');
                this.updateEdu('linear-done');
                return;
            }
        }
        this.render({ eliminated: new Set(arr.map((_, i) => i)) });
        this.setInfo('\u274c \u7ebf\u6027\u641c\u7d22\uff1a\u672a\u627e\u5230 ' + t + '\uff0c\u5171 ' + steps + ' \u6b65');
        this.updateEdu('linear-done');
    },

    /* ── Binary Search O(log n) ── */
    async runBinary() {
        const arr = this.arr, t = this.target;
        let lo = 0, hi = arr.length - 1, steps = 0;
        const eliminated = new Set();
        this.updateEdu('binary-start');

        while (lo <= hi) {
            if (this._aborted) return;
            steps++;
            const mid = Math.floor((lo + hi) / 2);
            this.render({ low: lo, high: hi, mid, eliminated });
            this.setInfo('\u4e8c\u5206\u67e5\u627e\uff1a\u7b2c ' + steps + ' \u6b65\uff0clo=' + lo + ' hi=' + hi + ' mid=' + mid + ' \u2192 arr[' + mid + ']=' + arr[mid]);
            this.updateEdu('binary-visit');
            await this._delay(this.speed);

            if (arr[mid] === t) {
                this.render({ found: mid, eliminated });
                this.setInfo('\u2705 \u4e8c\u5206\u67e5\u627e\uff1a\u627e\u5230 ' + t + ' \u5728\u7d22\u5f15 ' + mid + '\uff0c\u5171 ' + steps + ' \u6b65');
                this.updateEdu('binary-done');
                return;
            }
            if (arr[mid] < t) {
                for (let x = lo; x <= mid; x++) eliminated.add(x);
                lo = mid + 1;
            } else {
                for (let x = mid; x <= hi; x++) eliminated.add(x);
                hi = mid - 1;
            }
        }
        this.render({ eliminated: new Set(arr.map((_, i) => i)) });
        this.setInfo('\u274c \u4e8c\u5206\u67e5\u627e\uff1a\u672a\u627e\u5230 ' + t + '\uff0c\u5171 ' + steps + ' \u6b65');
        this.updateEdu('binary-done');
    },

    /* ── Interpolation Search O(log log n) avg ── */
    async runInterpolation() {
        const arr = this.arr, t = this.target;
        let lo = 0, hi = arr.length - 1, steps = 0;
        const eliminated = new Set();
        this.updateEdu('interp-start');

        while (lo <= hi && t >= arr[lo] && t <= arr[hi]) {
            if (this._aborted) return;
            steps++;
            let pos;
            if (arr[hi] === arr[lo]) {
                pos = lo;
            } else {
                pos = lo + Math.round(((t - arr[lo]) / (arr[hi] - arr[lo])) * (hi - lo));
            }
            pos = Math.max(lo, Math.min(hi, pos));

            this.render({ low: lo, high: hi, interp: pos, eliminated });
            this.setInfo('\u63d2\u503c\u67e5\u627e\uff1a\u7b2c ' + steps + ' \u6b65\uff0c\u4f30\u8ba1\u4f4d\u7f6e pos=' + pos + ' \u2192 arr[' + pos + ']=' + arr[pos]);
            this.updateEdu('interp-visit');
            await this._delay(this.speed);

            if (arr[pos] === t) {
                this.render({ found: pos, eliminated });
                this.setInfo('\u2705 \u63d2\u503c\u67e5\u627e\uff1a\u627e\u5230 ' + t + ' \u5728\u7d22\u5f15 ' + pos + '\uff0c\u5171 ' + steps + ' \u6b65');
                this.updateEdu('interp-done');
                return;
            }
            if (arr[pos] < t) {
                for (let x = lo; x <= pos; x++) eliminated.add(x);
                lo = pos + 1;
            } else {
                for (let x = pos; x <= hi; x++) eliminated.add(x);
                hi = pos - 1;
            }
        }
        this.render({ eliminated: new Set(arr.map((_, i) => i)) });
        this.setInfo('\u274c \u63d2\u503c\u67e5\u627e\uff1a\u672a\u627e\u5230 ' + t + '\uff0c\u5171 ' + steps + ' \u6b65');
        this.updateEdu('interp-done');
    },

    /* ── Jump Search O(\u221an) ── */
    async runJump() {
        const arr = this.arr, t = this.target, n = arr.length;
        let step = Math.floor(Math.sqrt(n));
        let steps = 0;
        const eliminated = new Set();
        this.updateEdu('jump-start');

        /* \u7b2c\u4e00\u9636\u6bb5\uff1a\u8df3\u8dc3 */
        let prev = 0, curr = step;
        while (curr < n && arr[Math.min(curr, n - 1)] < t) {
            if (this._aborted) return;
            steps++;
            for (let x = prev; x < curr; x++) eliminated.add(x);
            this.render({ jump: Math.min(curr, n - 1), eliminated });
            this.setInfo('\u8df3\u8dc3\u67e5\u627e\uff1a\u7b2c ' + steps + ' \u6b65\uff0c\u8df3\u5230 arr[' + Math.min(curr, n - 1) + ']=' + arr[Math.min(curr, n - 1)] + ' (step=' + step + ')');
            this.updateEdu('jump-phase1');
            await this._delay(this.speed);
            prev = curr;
            curr += step;
        }

        /* \u7b2c\u4e8c\u9636\u6bb5\uff1a\u7ebf\u6027\u626b\u63cf */
        this.updateEdu('jump-phase2');
        for (let i = prev; i < Math.min(curr, n); i++) {
            if (this._aborted) return;
            steps++;
            this.render({ current: i, eliminated });
            this.setInfo('\u8df3\u8dc3\u67e5\u627e\uff1a\u7b2c ' + steps + ' \u6b65\uff0c\u7ebf\u6027\u626b\u63cf arr[' + i + ']=' + arr[i]);
            await this._delay(this.speed);

            if (arr[i] === t) {
                this.render({ found: i, eliminated });
                this.setInfo('\u2705 \u8df3\u8dc3\u67e5\u627e\uff1a\u627e\u5230 ' + t + ' \u5728\u7d22\u5f15 ' + i + '\uff0c\u5171 ' + steps + ' \u6b65 (step=\u221a' + n + '=' + step + ')');
                this.updateEdu('jump-done');
                return;
            }
            if (arr[i] > t) break;
            eliminated.add(i);
        }
        this.render({ eliminated: new Set(arr.map((_, i) => i)) });
        this.setInfo('\u274c \u8df3\u8dc3\u67e5\u627e\uff1a\u672a\u627e\u5230 ' + t + '\uff0c\u5171 ' + steps + ' \u6b65');
        this.updateEdu('jump-done');
    },

    /* ── \u6559\u80b2\u9762\u677f ── */
    updateEdu(phase) {
        let el = document.getElementById('bs-edu');
        if (!el) {
            const info = document.getElementById('bs-info');
            if (!info || !info.parentElement) return;
            el = document.createElement('div');
            el.id = 'bs-edu';
            el.className = 'search-edu';
            info.parentElement.appendChild(el);
        }
        const n = this.arr.length;
        const tips = {
            idle: '<b>\u9009\u62e9\u7b97\u6cd5</b>\uff1a\u7ebf\u6027 O(n) | \u4e8c\u5206 O(log n) | \u63d2\u503c O(log log n) | \u8df3\u8dc3 O(\u221an)\u3002\u6240\u6709\u7b97\u6cd5\u5747\u5728\u6709\u5e8f\u6570\u7ec4\u4e0a\u5de5\u4f5c\uff08\u7ebf\u6027\u4e5f\u53ef\u65e0\u5e8f\uff09\u3002',
            'linear-start': '<b>\u7ebf\u6027\u641c\u7d22</b>\uff1a\u4ece\u5de6\u5230\u53f3\u9010\u4e2a\u68c0\u67e5\uff0c\u6700\u7b80\u5355\u7684\u641c\u7d22\u7b97\u6cd5\u3002\u65f6\u95f4 O(n)\uff0c\u7a7a\u95f4 O(1)\u3002\u4e0d\u8981\u6c42\u6709\u5e8f\u3002',
            'linear-visit': '<b>\u9010\u4e2a\u6bd4\u8f83</b>\uff1a\u4f9d\u6b21\u7ebf\u6027\u626b\u63cf\u3002\u6700\u574f\u60c5\u51b5\u9700\u904d\u5386\u5168\u90e8 ' + n + ' \u4e2a\u5143\u7d20\u3002 \u5e73\u5747\u8bbf\u95ee n/2 = ' + Math.round(n / 2) + ' \u6b21\u3002',
            'linear-done': '<b>\u7ebf\u6027\u641c\u7d22\u5b8c\u6210</b>\u3002\u590d\u6742\u5ea6\uff1a\u6700\u4f18 O(1)\uff0c\u5e73\u5747 O(n/2)\uff0c\u6700\u574f O(n)\u3002\u8bd5\u8bd5\u4e8c\u5206\u67e5\u627e\u770b\u63d0\u5347\u591a\u5927\uff1f',
            'binary-start': '<b>\u4e8c\u5206\u67e5\u627e</b>\uff1a\u6bcf\u6b21\u6392\u9664\u4e00\u534a\u5019\u9009\u533a\u95f4\u3002' + n + ' \u4e2a\u5143\u7d20\u6700\u591a\u9700 \u2308log\u2082(' + n + ')\u2309 = ' + Math.ceil(Math.log2(n)) + ' \u6b65\u3002',
            'binary-visit': '<b>\u6bcf\u6b21\u51cf\u534a</b>\uff1a\u6bd4\u8f83 mid \u4e0e target\uff0c\u7f29\u5c0f [lo, hi] \u8303\u56f4\u3002\u6548\u7387\u6bd4\u7ebf\u6027\u9ad8\u5f97\u591a\u2014\u2014 1,000,000 \u5143\u7d20\u4ec5\u9700 ~20 \u6b65\u3002',
            'binary-done': '<b>\u4e8c\u5206\u67e5\u627e\u5b8c\u6210</b>\u3002\u65f6\u95f4 O(log n)\uff0c\u7a7a\u95f4 O(1)\u3002\u8981\u6c42\u6570\u7ec4\u6709\u5e8f\u3002',
            'interp-start': '<b>\u63d2\u503c\u67e5\u627e</b>\uff1a\u6839\u636e\u503c\u7684\u5206\u5e03\u4f30\u7b97\u4f4d\u7f6e\uff0c\u800c\u975e\u603b\u53d6\u4e2d\u70b9\u3002\u5747\u5300\u5206\u5e03\u65f6\u5e73\u5747 O(log log n)\u3002',
            'interp-visit': '<b>\u4f30\u8ba1\u4f4d\u7f6e</b>\uff1apos = lo + ((t-arr[lo])/(arr[hi]-arr[lo])) \u00d7 (hi-lo)\u3002\u5982\u679c\u6570\u636e\u5747\u5300\uff0c\u4f30\u8ba1\u5f88\u51c6\uff01',
            'interp-done': '<b>\u63d2\u503c\u67e5\u627e\u5b8c\u6210</b>\u3002\u5747\u5300\u5206\u5e03: O(log log n)\uff0c\u6700\u574f: O(n)\u3002\u9002\u5408\u5927\u89c4\u6a21\u5747\u5300\u6570\u636e\u3002',
            'jump-start': '<b>\u8df3\u8dc3\u67e5\u627e</b>\uff1a\u5148\u4ee5 \u221a' + n + '=' + Math.floor(Math.sqrt(n)) + ' \u6b65\u957f\u8df3\u8dc3\uff0c\u5b9a\u4f4d\u533a\u95f4\u540e\u7ebf\u6027\u626b\u63cf\u3002\u65f6\u95f4 O(\u221an)\u3002',
            'jump-phase1': '<b>\u7b2c\u4e00\u9636\u6bb5\uff1a\u8df3\u8dc3</b>\uff1a\u4ee5 step=\u221a' + n + '=' + Math.floor(Math.sqrt(n)) + ' \u8df3\u8fc7\u6574\u5757\uff0c\u5feb\u901f\u7f29\u5c0f\u8303\u56f4\u3002',
            'jump-phase2': '<b>\u7b2c\u4e8c\u9636\u6bb5\uff1a\u7ebf\u6027\u626b\u63cf</b>\uff1a\u5728\u5df2\u5b9a\u4f4d\u7684 \u221a' + n + ' \u5927\u5c0f\u7684\u5757\u5185\u9010\u4e2a\u68c0\u67e5\u3002',
            'jump-done': '<b>\u8df3\u8dc3\u67e5\u627e\u5b8c\u6210</b>\u3002\u65f6\u95f4 O(\u221an)\uff0c\u4ecb\u4e8e\u7ebf\u6027\u548c\u4e8c\u5206\u4e4b\u95f4\u3002\u5b9e\u73b0\u7b80\u5355\uff0c\u9002\u5408\u5185\u5b58\u987a\u5e8f\u8bbf\u95ee\u78c1\u76d8\u573a\u666f\u3002'
        };
        el.innerHTML = tips[phase] || '';
    },

    reset() {
        if (this.isRunning) { this._aborted = true; return; }
        this._clearTimers();
        this.target = null;
        this.render();
        this.setInfo('\u9009\u62e9\u7b97\u6cd5\u6a21\u5f0f\uff0c\u7136\u540e\u70b9\u51fb "\u5f00\u59cb\u67e5\u627e"');
        this.updateEdu('idle');
    },

    setInfo(text) {
        const el = document.getElementById('bs-info');
        if (el) el.textContent = text;
    },

    setButtons(enabled) {
        document.querySelectorAll('#bs-controls .btn').forEach(b => b.disabled = !enabled);
    }
};


/* ============================================================
   \u2461  TreeTraversal  \u2014  Canvas-\u57fa\u7684\u6811\u904d\u5386\u53ef\u89c6\u5316
   ============================================================ */
var TreeTraversal = {
    canvas: null, ctx: null, W: 0, H: 0,
    tree: null,              /* { val, left, right, x, y, id } */
    nodes: [],               /* \u6241\u5e73\u5316\u8282\u70b9\u5217\u8868 */
    visited: [],             /* \u8bbf\u95ee\u5e8f\u5217 (id[]) */
    current: null,           /* \u5f53\u524d\u8bbf\u95ee\u8282\u70b9 id */
    isRunning: false, speed: 500, mode: 'preorder',
    hoverNode: -1, _aborted: false,
    _listeners: [], _timers: [],

    presets: {
        balanced: {
            name: '\u5e73\u8861BST',
            build() {
                /* 15\u8282\u70b9\u5b8c\u5168\u4e8c\u53c9\u6811\uff0c\u503c\u6709\u5e8f */
                const vals = [50, 25, 75, 12, 37, 62, 87, 6, 18, 31, 43, 56, 68, 81, 93];
                return TreeTraversal._buildFromArray(vals);
            }
        },
        skewed: {
            name: '\u5de6\u659c\u6811',
            build() {
                /* \u5de6\u659c\u6811\uff0c7\u8282\u70b9 */
                const vals = [40, 30, 20, 15, 10, 7, 3];
                let root = null;
                for (const v of vals) {
                    const n = { val: v, left: null, right: null, id: 0, x: 0, y: 0 };
                    if (!root) { root = n; }
                    else {
                        let cur = root;
                        while (cur.left) cur = cur.left;
                        cur.left = n;
                    }
                }
                return root;
            }
        },
        complete: {
            name: '\u5b8c\u5168\u4e8c\u53c9\u6811',
            build() {
                const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
                return TreeTraversal._buildComplete(vals);
            }
        },
        bst_random: {
            name: '\u968f\u673aBST',
            build() {
                const vals = [];
                const set = new Set();
                while (set.size < 12) { const v = Math.floor(Math.random() * 99) + 1; set.add(v); }
                return TreeTraversal._buildBST([...set]);
            }
        }
    },

    _buildFromArray(vals) {
        /* \u5c42\u5e8f\u6570\u7ec4 -> \u6811 */
        if (vals.length === 0) return null;
        const nodes = vals.map(v => ({ val: v, left: null, right: null, id: 0, x: 0, y: 0 }));
        for (let i = 0; i < nodes.length; i++) {
            if (2 * i + 1 < nodes.length) nodes[i].left = nodes[2 * i + 1];
            if (2 * i + 2 < nodes.length) nodes[i].right = nodes[2 * i + 2];
        }
        return nodes[0];
    },

    _buildComplete(vals) {
        return this._buildFromArray(vals);
    },

    _buildBST(vals) {
        /* \u968f\u673a\u63d2\u5165\u987a\u5e8f\u7684BST */
        const shuffled = vals.slice();
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        let root = null;
        for (const v of shuffled) {
            root = this._insertBST(root, v);
        }
        return root;
    },

    _insertBST(node, val) {
        if (!node) return { val, left: null, right: null, id: 0, x: 0, y: 0 };
        if (val < node.val) node.left = this._insertBST(node.left, val);
        else node.right = this._insertBST(node.right, val);
        return node;
    },

    /* ── \u4e8b\u4ef6/\u5b9a\u65f6\u5668\u7ba1\u7406 ── */
    _on(el, evt, fn, opts) { el.addEventListener(evt, fn, opts); this._listeners.push([el, evt, fn, opts]); },
    _delay(ms) { return new Promise(r => { const t = setTimeout(r, ms); this._timers.push(t); }); },
    _clearTimers() { this._timers.forEach(t => clearTimeout(t)); this._timers = []; },

    init() {
        this.destroy();
        this.canvas = document.getElementById('tree-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.sizeCanvas();

        this._on(window, 'resize', () => { this.sizeCanvas(); this.layoutTree(); this.draw(); });

        /* \u9884\u8bbe\u6309\u94ae */
        document.querySelectorAll('.tree-presets .btn--ghost').forEach(b => {
            this._on(b, 'click', () => {
                if (this.isRunning) return;
                document.querySelectorAll('.tree-presets .btn--ghost').forEach(x => x.classList.remove('active'));
                b.classList.add('active');
                this.loadPreset(b.dataset.preset);
            });
        });

        /* \u901f\u5ea6 */
        const spd = document.getElementById('tree-speed');
        if (spd) {
            this._on(spd, 'input', () => {
                this.speed = +spd.value;
                const lbl = document.getElementById('tree-speed-value');
                if (lbl) lbl.textContent = spd.value + 'ms';
            });
        }

        /* Hover */
        this._on(this.canvas, 'mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            const mx = (e.clientX - rect.left) * dpr;
            const my = (e.clientY - rect.top) * dpr;
            const r = Math.min(this.W, this.H) * 0.032;
            let found = -1;
            for (let i = 0; i < this.nodes.length; i++) {
                const dx = this.nodes[i].x - mx, dy = this.nodes[i].y - my;
                if (dx * dx + dy * dy < (r + 6) * (r + 6)) { found = i; break; }
            }
            if (found !== this.hoverNode) {
                this.hoverNode = found;
                this.canvas.style.cursor = found >= 0 ? 'pointer' : 'default';
                this.draw();
            }
        });
        this._on(this.canvas, 'mouseleave', () => {
            if (this.hoverNode !== -1) { this.hoverNode = -1; this.canvas.style.cursor = 'default'; this.draw(); }
        });

        this.loadPreset('balanced');
        this.updateEdu('idle');
    },

    destroy() {
        this._clearTimers();
        this._listeners.forEach(([el, evt, fn, opts]) => el.removeEventListener(evt, fn, opts));
        this._listeners = [];
        this.isRunning = false;
        this._aborted = true;
    },

    sizeCanvas() {
        if (!this.canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const w = rect.width, h = Math.max(320, Math.min(480, w * 0.65));
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.canvas.width = Math.round(w * dpr);
        this.canvas.height = Math.round(h * dpr);
        this.W = this.canvas.width;
        this.H = this.canvas.height;
    },

    loadPreset(name) {
        if (this.isRunning) return;
        const p = this.presets[name];
        if (!p) return;
        this.tree = p.build();
        this.layoutTree();
        this.resetState();
        this.draw();
    },

    /* ── \u6811\u5e03\u5c40 ── */
    layoutTree() {
        if (!this.tree) return;
        this.nodes = [];
        let id = 0;
        const depth = this._depth(this.tree);
        const W = this.W, H = this.H;
        const padTop = H * 0.08, padBot = H * 0.08;
        const usableH = H - padTop - padBot;
        const layerH = depth > 1 ? usableH / (depth - 1) : 0;

        const assign = (node, d, xmin, xmax) => {
            if (!node) return;
            node.id = id++;
            node.x = (xmin + xmax) / 2;
            node.y = padTop + d * layerH;
            this.nodes.push(node);
            assign(node.left, d + 1, xmin, node.x);
            assign(node.right, d + 1, node.x, xmax);
        };
        assign(this.tree, 0, W * 0.05, W * 0.95);
    },

    _depth(node) {
        if (!node) return 0;
        return 1 + Math.max(this._depth(node.left), this._depth(node.right));
    },

    /* ── \u7ed8\u5236 ── */
    draw() {
        if (!this.ctx) return;
        const ctx = this.ctx, W = this.W, H = this.H;

        ctx.fillStyle = getComputedStyle(document.documentElement)
            .getPropertyValue('--surface-2').trim() || '#151822';
        ctx.fillRect(0, 0, W, H);

        const r = Math.min(W, H) * 0.032;
        const visitedSet = new Set(this.visited);

        /* \u8fb9 */
        const drawEdges = (node) => {
            if (!node) return;
            if (node.left) {
                const eActive = visitedSet.has(node.id) && visitedSet.has(node.left.id);
                ctx.beginPath();
                ctx.moveTo(node.x, node.y + r);
                ctx.lineTo(node.left.x, node.left.y - r);
                ctx.strokeStyle = eActive ? 'rgba(196,121,58,0.5)' : 'rgba(255,255,255,0.1)';
                ctx.lineWidth = eActive ? 2.5 : 1.5;
                ctx.stroke();
            }
            if (node.right) {
                const eActive = visitedSet.has(node.id) && visitedSet.has(node.right.id);
                ctx.beginPath();
                ctx.moveTo(node.x, node.y + r);
                ctx.lineTo(node.right.x, node.right.y - r);
                ctx.strokeStyle = eActive ? 'rgba(196,121,58,0.5)' : 'rgba(255,255,255,0.1)';
                ctx.lineWidth = eActive ? 2.5 : 1.5;
                ctx.stroke();
            }
            drawEdges(node.left);
            drawEdges(node.right);
        };
        drawEdges(this.tree);

        /* \u8282\u70b9 */
        this.nodes.forEach((n, i) => {
            const isCur = this.current === n.id;
            const isVis = visitedSet.has(n.id);
            const isHov = this.hoverNode === i && !this.isRunning;

            ctx.beginPath();
            ctx.arc(n.x, n.y, r, 0, Math.PI * 2);

            if (isCur) {
                ctx.fillStyle = '#c4793a'; ctx.shadowColor = '#c4793a'; ctx.shadowBlur = 16;
            } else if (isVis) {
                ctx.fillStyle = '#4d9e7e'; ctx.shadowColor = '#4d9e7e'; ctx.shadowBlur = 8;
            } else if (isHov) {
                ctx.fillStyle = '#5b8dce'; ctx.shadowColor = '#5b8dce'; ctx.shadowBlur = 12;
            } else {
                ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.shadowBlur = 0;
            }
            ctx.fill();
            ctx.shadowBlur = 0;

            ctx.strokeStyle = isCur ? '#e8a050' : isVis ? '#6cc09a' : isHov ? '#7ba8d8' : 'rgba(255,255,255,0.15)';
            ctx.lineWidth = (isCur || isHov) ? 2.5 : 1.5;
            ctx.stroke();

            /* \u8bbf\u95ee\u5e8f\u53f7 */
            if (isVis) {
                const order = this.visited.indexOf(n.id) + 1;
                ctx.fillStyle = 'rgba(255,255,255,0.4)';
                ctx.font = '500 14px ' + CF.mono;
                ctx.textAlign = 'center';
                ctx.fillText(order, n.x, n.y - r - 6);
            }

            /* \u6807\u7b7e */
            ctx.fillStyle = isCur || isVis || isHov ? '#fff' : 'rgba(255,255,255,0.5)';
            ctx.font = '600 ' + Math.max(13, Math.round(r * 0.9)) + 'px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(n.val, n.x, n.y);
        });

        /* \u5e95\u90e8\u8bbf\u95ee\u5e8f\u5217 */
        if (this.visited.length > 0) {
            ctx.font = '17px ' + CF.sans;
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.textAlign = 'left';
            const seq = this.visited.map(id => {
                const nd = this.nodes.find(n => n.id === id);
                return nd ? nd.val : '?';
            }).join(' \u2192 ');
            ctx.fillText('\u8bbf\u95ee\u987a\u5e8f: ' + seq, 10, H - 12);
        }

        /* \u60ac\u505c\u63d0\u793a */
        if (this.hoverNode >= 0 && !this.isRunning) {
            const nd = this.nodes[this.hoverNode];
            const info = 'val=' + nd.val + (nd.left ? ' L=' + nd.left.val : '') + (nd.right ? ' R=' + nd.right.val : '');
            const tw = ctx.measureText(info).width;
            const tx = Math.min(nd.x + 12, W - tw - 20);
            const ty = nd.y - r - 20;
            ctx.fillStyle = 'rgba(13,16,23,0.9)';
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(tx - 6, ty - 12, tw + 12, 18, 4);
            ctx.fill(); ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.font = '15px ' + CF.mono;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(info, tx, ty);
        }
    },

    /* ── \u904d\u5386\u7b97\u6cd5 ── */
    async startTraversal(mode) {
        if (this.isRunning) return;
        this.mode = mode || this.mode;
        this.isRunning = true;
        this._aborted = false;
        this.visited = [];
        this.current = null;
        this.setButtons(false);
        this.draw();

        switch (this.mode) {
            case 'preorder':  await this._preorder(this.tree);  break;
            case 'inorder':   await this._inorder(this.tree);   break;
            case 'postorder': await this._postorder(this.tree); break;
            case 'levelorder': await this._levelorder();         break;
        }

        if (!this._aborted) {
            this.current = null;
            this.draw();
            const seq = this.visited.map(id => {
                const nd = this.nodes.find(n => n.id === id);
                return nd ? nd.val : '?';
            }).join(' \u2192 ');
            this.setInfo(this._modeLabel() + ' \u5b8c\u6210\uff01\u8bbf\u95ee ' + this.visited.length + ' \u4e2a\u8282\u70b9\uff1a' + seq);
            this.updateEdu(this.mode + '-done');
        }
        this.isRunning = false;
        this.setButtons(true);
    },

    async _preorder(node) {
        if (!node || this._aborted) return;
        this.current = node.id;
        this.visited.push(node.id);
        this.draw();
        this.setInfo('\u524d\u5e8f: \u8bbf\u95ee ' + node.val + ' (\u6839\u2192\u5de6\u2192\u53f3)');
        this.updateEdu('preorder-visit');
        await this._delay(this.speed);
        await this._preorder(node.left);
        await this._preorder(node.right);
    },

    async _inorder(node) {
        if (!node || this._aborted) return;
        await this._inorder(node.left);
        if (this._aborted) return;
        this.current = node.id;
        this.visited.push(node.id);
        this.draw();
        this.setInfo('\u4e2d\u5e8f: \u8bbf\u95ee ' + node.val + ' (\u5de6\u2192\u6839\u2192\u53f3\uff0cBST\u5219\u6709\u5e8f)');
        this.updateEdu('inorder-visit');
        await this._delay(this.speed);
        await this._inorder(node.right);
    },

    async _postorder(node) {
        if (!node || this._aborted) return;
        await this._postorder(node.left);
        if (this._aborted) return;
        await this._postorder(node.right);
        if (this._aborted) return;
        this.current = node.id;
        this.visited.push(node.id);
        this.draw();
        this.setInfo('\u540e\u5e8f: \u8bbf\u95ee ' + node.val + ' (\u5de6\u2192\u53f3\u2192\u6839\uff0c\u5220\u9664/\u91ca\u653e\u5b89\u5168)');
        this.updateEdu('postorder-visit');
        await this._delay(this.speed);
    },

    async _levelorder() {
        const queue = this.tree ? [this.tree] : [];
        let level = 0;
        this.updateEdu('levelorder-start');
        while (queue.length > 0 && !this._aborted) {
            const sz = queue.length;
            level++;
            for (let i = 0; i < sz; i++) {
                if (this._aborted) return;
                const node = queue.shift();
                this.current = node.id;
                this.visited.push(node.id);
                this.draw();
                this.setInfo('\u5c42\u5e8f: \u7b2c ' + level + ' \u5c42\uff0c\u8bbf\u95ee ' + node.val);
                this.updateEdu('levelorder-visit');
                await this._delay(this.speed);
                if (node.left) queue.push(node.left);
                if (node.right) queue.push(node.right);
            }
        }
    },

    _modeLabel() {
        const m = { preorder: '\u524d\u5e8f\u904d\u5386', inorder: '\u4e2d\u5e8f\u904d\u5386', postorder: '\u540e\u5e8f\u904d\u5386', levelorder: '\u5c42\u5e8f\u904d\u5386' };
        return m[this.mode] || this.mode;
    },

    /* ── \u6559\u80b2\u9762\u677f ── */
    updateEdu(phase) {
        let el = document.getElementById('tree-edu');
        if (!el) {
            const info = document.getElementById('tree-info');
            if (!info || !info.parentElement) return;
            el = document.createElement('div');
            el.id = 'tree-edu';
            el.className = 'search-edu';
            info.parentElement.appendChild(el);
        }
        const n = this.nodes.length;
        const tips = {
            idle: '<b>\u6811\u904d\u5386</b>\uff1a\u56db\u79cd\u7ecf\u5178\u65b9\u5f0f\u8bbf\u95ee\u4e8c\u53c9\u6811\u7684\u6240\u6709\u8282\u70b9\u3002\u65f6\u95f4\u590d\u6742\u5ea6\u5747\u4e3a O(n)\uff0cn=' + n + '\u3002',
            'preorder-visit': '<b>\u524d\u5e8f (NLR)</b>\uff1a\u5148\u8bbf\u95ee\u6839\uff0c\u518d\u5de6\u5b50\u6811\uff0c\u6700\u540e\u53f3\u5b50\u6811\u3002\u7528\u9014\uff1a\u590d\u5236\u6811\u3001\u524d\u7f00\u8868\u8fbe\u5f0f\u3001\u5e8f\u5217\u5316\u3002',
            'preorder-done': '<b>\u524d\u5e8f\u5b8c\u6210</b>\u3002\u6839\u6c38\u8fdc\u5728\u7b2c\u4e00\u4e2a\u4f4d\u7f6e\u3002\u9012\u5f52\u6df1\u5ea6 = \u6811\u7684\u9ad8\u5ea6 h\uff0c\u7a7a\u95f4 O(h)\u3002',
            'inorder-visit': '<b>\u4e2d\u5e8f (LNR)</b>\uff1a\u5148\u5de6\u5b50\u6811\uff0c\u518d\u6839\uff0c\u6700\u540e\u53f3\u5b50\u6811\u3002<em>BST\u7684\u4e2d\u5e8f\u4ea7\u751f\u6709\u5e8f\u5e8f\u5217\uff01</em>',
            'inorder-done': '<b>\u4e2d\u5e8f\u5b8c\u6210</b>\u3002\u5bf9BST\u800c\u8a00\uff0c\u4e2d\u5e8f\u8f93\u51fa\u5c31\u662f\u6392\u5e8f\u7ed3\u679c\u3002\u7528\u4e8e\u8868\u8fbe\u5f0f\u6811\u3001BST\u9a8c\u8bc1\u7b49\u3002',
            'postorder-visit': '<b>\u540e\u5e8f (LRN)</b>\uff1a\u5148\u5de6\u5b50\u6811\uff0c\u518d\u53f3\u5b50\u6811\uff0c\u6700\u540e\u6839\u3002\u6839\u5728\u6700\u540e\u88ab\u8bbf\u95ee\uff0c\u9002\u5408\u5220\u9664/\u91ca\u653e\u3002',
            'postorder-done': '<b>\u540e\u5e8f\u5b8c\u6210</b>\u3002\u6839\u6c38\u8fdc\u5728\u6700\u540e\u3002\u5e38\u7528\u4e8e\u5220\u9664\u6811\u3001\u540e\u7f00\u8868\u8fbe\u5f0f\u6c42\u503c\u3001\u8ba1\u7b97\u5b50\u6811\u5c5e\u6027\u3002',
            'levelorder-start': '<b>\u5c42\u5e8f (BFS)</b>\uff1a\u7528\u961f\u5217\u9010\u5c42\u8bbf\u95ee\uff0c\u540c\u4e00\u5c42\u5de6\u5230\u53f3\u3002\u7a7a\u95f4 O(w)\uff0cw=\u6700\u5927\u5c42\u5bbd\u3002',
            'levelorder-visit': '<b>\u9010\u5c42\u8bbf\u95ee</b>\uff1a\u5f53\u524d\u5c42\u8282\u70b9\u51fa\u961f\u540e\uff0c\u5c06\u5176\u5b50\u8282\u70b9\u5165\u961f\u3002\u7528\u4e8e\u5c42\u5e8f\u6253\u5370\u3001\u6700\u77ed\u8def\u5f84\u3002',
            'levelorder-done': '<b>\u5c42\u5e8f\u5b8c\u6210</b>\u3002\u5373\u6811\u7684 BFS\u3002\u8f93\u51fa\u6309\u5c42\u6392\u5217\uff0c\u5e38\u7528\u4e8e\u5e8f\u5217\u5316\u4e8c\u53c9\u6811\u3002'
        };
        el.innerHTML = tips[phase] || '';
    },

    resetState() {
        this.visited = [];
        this.current = null;
        this._aborted = false;
        this.setInfo('\u9009\u62e9\u904d\u5386\u65b9\u5f0f\uff1a\u524d\u5e8f / \u4e2d\u5e8f / \u540e\u5e8f / \u5c42\u5e8f');
        this.updateEdu('idle');
    },

    reset() {
        if (this.isRunning) { this._aborted = true; return; }
        this._clearTimers();
        this.resetState();
        this.draw();
    },

    setInfo(text) {
        const el = document.getElementById('tree-info');
        if (el) el.textContent = text;
    },

    setButtons(enabled) {
        document.querySelectorAll('#tree-controls .btn').forEach(b => b.disabled = !enabled);
    }
};


/* ============================================================
   \u2462  HashSearch  \u2014  \u54c8\u5e0c\u8868\u67e5\u627e\u53ef\u89c6\u5316 (\u94fe\u5730\u5740\u6cd5)
   ============================================================ */
var HashSearch = {
    canvas: null, ctx: null, W: 0, H: 0,
    tableSize: 7,
    table: [],              /* Array of arrays (chaining) */
    speed: 500,
    isRunning: false, _aborted: false,
    _listeners: [], _timers: [],

    _on(el, evt, fn, opts) { el.addEventListener(evt, fn, opts); this._listeners.push([el, evt, fn, opts]); },
    _delay(ms) { return new Promise(r => { const t = setTimeout(r, ms); this._timers.push(t); }); },
    _clearTimers() { this._timers.forEach(t => clearTimeout(t)); this._timers = []; },

    hash(key) {
        return key % this.tableSize;
    },

    init() {
        this.destroy();
        this.canvas = document.getElementById('hash-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.sizeCanvas();
        this._on(window, 'resize', () => { this.sizeCanvas(); this.draw(); });

        /* \u901f\u5ea6 */
        const spd = document.getElementById('hash-speed');
        if (spd) {
            this._on(spd, 'input', () => {
                this.speed = +spd.value;
                const lbl = document.getElementById('hash-speed-value');
                if (lbl) lbl.textContent = spd.value + 'ms';
            });
        }

        this.buildRandom();
        this.updateEdu('idle');
    },

    destroy() {
        this._clearTimers();
        this._listeners.forEach(([el, evt, fn, opts]) => el.removeEventListener(evt, fn, opts));
        this._listeners = [];
        this.isRunning = false;
        this._aborted = true;
    },

    sizeCanvas() {
        if (!this.canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const w = rect.width, h = Math.max(300, Math.min(420, w * 0.55));
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.canvas.width = Math.round(w * dpr);
        this.canvas.height = Math.round(h * dpr);
        this.W = this.canvas.width;
        this.H = this.canvas.height;
    },

    buildRandom() {
        if (this.isRunning) return;
        this.table = Array.from({ length: this.tableSize }, () => []);
        /* \u63d2\u516510~15\u4e2a\u968f\u673a\u503c */
        const count = 10 + Math.floor(Math.random() * 6);
        const used = new Set();
        for (let i = 0; i < count; i++) {
            let v;
            do { v = Math.floor(Math.random() * 99) + 1; } while (used.has(v));
            used.add(v);
            const idx = this.hash(v);
            this.table[idx].push(v);
        }
        this.draw();
        this.setInfo('\u54c8\u5e0c\u8868\u5df2\u751f\u6210\uff0c' + count + ' \u4e2a\u5143\u7d20\u5206\u5e03\u5728 ' + this.tableSize + ' \u4e2a\u69fd\u4e2d');
        this.updateEdu('idle');
    },

    /* ── \u63d2\u5165 ── */
    async insertValue() {
        if (this.isRunning) return;
        const input = document.getElementById('hash-input');
        if (!input) return;
        const v = parseInt(input.value);
        if (isNaN(v) || v < 1 || v > 99) { this.setInfo('\u8bf7\u8f93\u5165 1~99 \u7684\u6574\u6570'); return; }

        this.isRunning = true;
        this._aborted = false;
        this.setButtons(false);

        const idx = this.hash(v);
        this.setInfo('\u63d2\u5165 ' + v + '\uff1ahash(' + v + ') = ' + v + ' % ' + this.tableSize + ' = ' + idx);
        this.updateEdu('insert-hash');
        this.draw({ highlightSlot: idx });
        await this._delay(this.speed);

        /* \u68c0\u67e5\u91cd\u590d */
        if (this.table[idx].includes(v)) {
            this.setInfo(v + ' \u5df2\u5b58\u5728\u4e8e\u69fd ' + idx);
            this.draw({ highlightSlot: idx, highlightVal: v });
        } else {
            this.table[idx].push(v);
            this.setInfo('\u2705 ' + v + ' \u63d2\u5165\u5230\u69fd ' + idx + '\uff0c\u94fe\u957f ' + this.table[idx].length);
            this.updateEdu('insert-done');
            this.draw({ highlightSlot: idx, highlightVal: v });
        }

        await this._delay(this.speed);
        input.value = '';
        this.isRunning = false;
        this.setButtons(true);
    },

    /* ── \u67e5\u627e ── */
    async searchValue() {
        if (this.isRunning) return;
        const input = document.getElementById('hash-input');
        if (!input) return;
        const v = parseInt(input.value);
        if (isNaN(v)) { this.setInfo('\u8bf7\u8f93\u5165\u8981\u67e5\u627e\u7684\u503c'); return; }

        this.isRunning = true;
        this._aborted = false;
        this.setButtons(false);

        const idx = this.hash(v);
        this.setInfo('\u67e5\u627e ' + v + '\uff1ahash(' + v + ') = ' + v + ' % ' + this.tableSize + ' = ' + idx);
        this.updateEdu('search-hash');
        this.draw({ highlightSlot: idx });
        await this._delay(this.speed);

        const chain = this.table[idx];
        let found = false;
        for (let i = 0; i < chain.length; i++) {
            if (this._aborted) break;
            this.draw({ highlightSlot: idx, checkVal: chain[i] });
            this.setInfo('\u68c0\u67e5\u69fd ' + idx + ' \u7b2c ' + (i + 1) + ' \u4e2a\u5143\u7d20: ' + chain[i] + (chain[i] === v ? ' \u2714' : ' \u2718'));
            this.updateEdu('search-chain');
            await this._delay(this.speed);
            if (chain[i] === v) {
                found = true;
                this.draw({ highlightSlot: idx, highlightVal: v });
                this.setInfo('\u2705 \u627e\u5230 ' + v + ' \u5728\u69fd ' + idx + '\uff0c\u94fe\u4e2d\u7b2c ' + (i + 1) + ' \u4e2a\u4f4d\u7f6e\uff01');
                this.updateEdu('search-found');
                break;
            }
        }
        if (!found) {
            this.setInfo('\u274c \u672a\u627e\u5230 ' + v + '\uff0c\u69fd ' + idx + ' \u94fe\u957f ' + chain.length);
            this.updateEdu('search-notfound');
        }

        await this._delay(this.speed);
        this.isRunning = false;
        this.setButtons(true);
    },

    /* ── \u7ed8\u5236 ── */
    draw(hl) {
        if (!this.ctx) return;
        const ctx = this.ctx, W = this.W, H = this.H;
        hl = hl || {};

        ctx.fillStyle = getComputedStyle(document.documentElement)
            .getPropertyValue('--surface-2').trim() || '#151822';
        ctx.fillRect(0, 0, W, H);

        const slotW = Math.min(W * 0.12, 80);
        const slotH = 36;
        const padLeft = 20;
        const startY = 40;
        const gapY = (H - startY - 20) / this.tableSize;
        const nodeW = 42, nodeH = 28, nodeGap = 6;

        for (let i = 0; i < this.tableSize; i++) {
            const sy = startY + i * gapY;
            const isHL = hl.highlightSlot === i;

            /* \u69fd\u6846 */
            ctx.fillStyle = isHL ? 'rgba(196,121,58,0.15)' : 'rgba(255,255,255,0.04)';
            ctx.strokeStyle = isHL ? '#c4793a' : 'rgba(255,255,255,0.1)';
            ctx.lineWidth = isHL ? 2 : 1;
            ctx.beginPath();
            ctx.roundRect(padLeft, sy, slotW, slotH, 4);
            ctx.fill(); ctx.stroke();

            /* \u69fd\u6807\u7b7e */
            ctx.fillStyle = isHL ? '#c4793a' : 'rgba(255,255,255,0.5)';
            ctx.font = '600 17px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('[' + i + ']', padLeft + slotW / 2, sy + slotH / 2);

            /* \u94fe\u8282\u70b9 */
            const chain = this.table[i];
            let cx = padLeft + slotW + 16;
            for (let j = 0; j < chain.length; j++) {
                const v = chain[j];
                const isHLVal = hl.highlightVal === v && hl.highlightSlot === i;
                const isCheck = hl.checkVal === v && hl.highlightSlot === i;

                /* \u8fde\u63a5\u7ebf */
                ctx.beginPath();
                ctx.moveTo(cx - 16, sy + slotH / 2);
                ctx.lineTo(cx, sy + slotH / 2);
                ctx.strokeStyle = 'rgba(255,255,255,0.15)';
                ctx.lineWidth = 1;
                ctx.stroke();

                /* \u7bad\u5934 */
                ctx.beginPath();
                ctx.moveTo(cx, sy + slotH / 2);
                ctx.lineTo(cx - 5, sy + slotH / 2 - 3);
                ctx.lineTo(cx - 5, sy + slotH / 2 + 3);
                ctx.closePath();
                ctx.fillStyle = 'rgba(255,255,255,0.15)';
                ctx.fill();

                /* \u8282\u70b9\u6846 */
                ctx.fillStyle = isHLVal ? 'rgba(77,158,126,0.2)' : isCheck ? 'rgba(196,121,58,0.15)' : 'rgba(255,255,255,0.04)';
                ctx.strokeStyle = isHLVal ? '#4d9e7e' : isCheck ? '#c4793a' : 'rgba(255,255,255,0.1)';
                ctx.lineWidth = (isHLVal || isCheck) ? 2 : 1;
                ctx.beginPath();
                ctx.roundRect(cx, sy + (slotH - nodeH) / 2, nodeW, nodeH, 4);
                ctx.fill(); ctx.stroke();

                /* \u503c */
                ctx.fillStyle = isHLVal ? '#4d9e7e' : isCheck ? '#c4793a' : 'rgba(255,255,255,0.6)';
                ctx.font = '600 17px ' + CF.mono;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(v, cx + nodeW / 2, sy + slotH / 2);

                cx += nodeW + nodeGap + 16;
            }

            /* \u7a7a\u69fd\u6807\u8bb0 */
            if (chain.length === 0) {
                ctx.fillStyle = 'rgba(255,255,255,0.15)';
                ctx.font = '15px ' + CF.sans;
                ctx.textAlign = 'left';
                ctx.fillText('null', padLeft + slotW + 16, sy + slotH / 2);
            }
        }

        /* \u6807\u9898 */
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '500 16px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText('hash(key) = key % ' + this.tableSize, padLeft, 24);

        /* \u7edf\u8ba1 */
        const total = this.table.reduce((s, c) => s + c.length, 0);
        const maxChain = Math.max(...this.table.map(c => c.length));
        const loadFactor = (total / this.tableSize).toFixed(2);
        ctx.textAlign = 'right';
        ctx.fillText('\u5143\u7d20: ' + total + '  \u8d1f\u8f7d\u56e0\u5b50: ' + loadFactor + '  \u6700\u957f\u94fe: ' + maxChain, W - 20, 24);
    },

    /* ── \u6559\u80b2\u9762\u677f ── */
    updateEdu(phase) {
        let el = document.getElementById('hash-edu');
        if (!el) {
            const info = document.getElementById('hash-info');
            if (!info || !info.parentElement) return;
            el = document.createElement('div');
            el.id = 'hash-edu';
            el.className = 'search-edu';
            info.parentElement.appendChild(el);
        }
        const total = this.table.reduce((s, c) => s + c.length, 0);
        const maxChain = Math.max(...this.table.map(c => c.length), 0);
        const tips = {
            idle: '<b>\u54c8\u5e0c\u8868</b>\uff1a\u901a\u8fc7\u54c8\u5e0c\u51fd\u6570\u5c06\u952e\u6620\u5c04\u5230\u69fd\u4f4d\uff0c\u5e73\u5747 O(1) \u67e5\u627e\u3002\u672c\u4f8b\u4f7f\u7528 key%' + this.tableSize + ' \u548c\u94fe\u5730\u5740\u6cd5\u5904\u7406\u51b2\u7a81\u3002',
            'insert-hash': '<b>\u63d2\u5165</b>\uff1a\u5148\u8ba1\u7b97\u54c8\u5e0c\u503c\u786e\u5b9a\u69fd\u4f4d\uff0c\u7136\u540e\u8ffd\u52a0\u5230\u8be5\u69fd\u7684\u94fe\u8868\u672b\u5c3e\u3002O(1) \u5e73\u5747\u65f6\u95f4\u3002',
            'insert-done': '<b>\u63d2\u5165\u5b8c\u6210</b>\u3002\u5f53\u524d\u8d1f\u8f7d\u56e0\u5b50 = ' + (total / this.tableSize).toFixed(2) + '\u3002\u8d1f\u8f7d\u56e0\u5b50\u8d8a\u5927\uff0c\u51b2\u7a81\u8d8a\u591a\uff0c\u6027\u80fd\u4e0b\u964d\u3002',
            'search-hash': '<b>\u67e5\u627e</b>\uff1a\u5148\u8ba1\u7b97\u54c8\u5e0c\u5b9a\u4f4d\u69fd\uff0c\u518d\u904d\u5386\u94fe\u8868\u3002\u7406\u60f3\u60c5\u51b5 O(1)\uff0c\u6700\u574f O(n)\u3002',
            'search-chain': '<b>\u94fe\u8868\u904d\u5386</b>\uff1a\u8fdb\u5165\u76ee\u6807\u69fd\u540e\uff0c\u9010\u4e2a\u6bd4\u8f83\u94fe\u4e2d\u5143\u7d20\u3002\u5f53\u524d\u6700\u957f\u94fe = ' + maxChain + '\u3002',
            'search-found': '<b>\u67e5\u627e\u6210\u529f</b>\uff01\u54c8\u5e0c\u8868\u7684\u5e73\u5747\u67e5\u627e\u65f6\u95f4\u63a5\u8fd1 O(1+\u03b1)\uff0c\u03b1=\u8d1f\u8f7d\u56e0\u5b50\u3002',
            'search-notfound': '<b>\u672a\u627e\u5230</b>\u3002\u904d\u5386\u4e86\u6574\u6761\u94fe\u540e\u786e\u8ba4\u4e0d\u5b58\u5728\u3002\u53ef\u4ee5\u8003\u8651\u6269\u5bb9 (rehash) \u51cf\u5c11\u94fe\u957f\u3002'
        };
        el.innerHTML = tips[phase] || '';
    },

    reset() {
        if (this.isRunning) { this._aborted = true; return; }
        this._clearTimers();
        this.buildRandom();
    },

    setInfo(text) {
        const el = document.getElementById('hash-info');
        if (el) el.textContent = text;
    },

    setButtons(enabled) {
        document.querySelectorAll('#hash-controls .btn').forEach(b => b.disabled = !enabled);
        const input = document.getElementById('hash-input');
        if (input) input.disabled = !enabled;
    }
};


/* ============================================================
   \u521d\u59cb\u5316
   ============================================================ */
function initSearchAlgorithms() {
    SearchComparison.init();
    TreeTraversal.init();
    HashSearch.init();
}

window.SearchComparison = SearchComparison;
window.TreeTraversal = TreeTraversal;
window.HashSearch = HashSearch;
window.initSearchAlgorithms = initSearchAlgorithms;

/* \u517c\u5bb9\u65e7\u63a5\u53e3 */
window.BinarySearch = {
    init: function() { SearchComparison.init(); },
    generateArray: function() { SearchComparison.generateArray(); },
    start: function() { SearchComparison.start(); },
    reset: function() { SearchComparison.reset(); }
};
window.GraphTraversal = {
    init: function() { TreeTraversal.init(); },
    startBFS: function() { TreeTraversal.startTraversal('levelorder'); },
    startDFS: function() { TreeTraversal.startTraversal('preorder'); },
    reset: function() { TreeTraversal.reset(); },
    loadPreset: function(name) {
        var map = { tree: 'balanced', grid: 'complete', cycle: 'bst_random' };
        TreeTraversal.loadPreset(map[name] || name);
    }
};