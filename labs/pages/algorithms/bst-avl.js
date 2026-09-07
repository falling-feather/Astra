/* Binary search tree and AVL rotation lab */
const BSTAVL = {
    canvas: null,
    ctx: null,
    W: 0,
    H: 0,
    _listeners: [],
    _ro: null,
    root: null,
    mode: 'avl',
    activeKey: 35,
    path: [],
    action: 'idle',
    message: '',
    rotation: '',
    highlighted: new Set(),
    values: [],
    presets: {
        balanced: { label: '平衡样例', values: [40, 20, 60, 10, 30, 50, 70], mode: 'avl', key: 35 },
        skewed: { label: '退化 BST', values: [10, 20, 30, 40, 50, 60], mode: 'bst', key: 70 },
        ll: { label: 'LL 右旋', values: [30, 20, 10], mode: 'avl', key: 5 },
        lr: { label: 'LR 双旋', values: [30, 10, 20], mode: 'avl', key: 25 },
        rr: { label: 'RR 左旋', values: [10, 20, 30], mode: 'avl', key: 35 },
        rl: { label: 'RL 双旋', values: [10, 30, 20], mode: 'avl', key: 25 }
    },

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        if (this.canvas) this.destroy();
        this.canvas = document.getElementById('bstavl-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this._loadPreset('balanced', false);
        this._resize();
        if (typeof ResizeObserver !== 'undefined') {
            this._ro = new ResizeObserver(() => this._resize());
            this._ro.observe(this.canvas.parentElement);
        } else {
            this._on(window, 'resize', () => this._resize());
        }
        this._buildControls();
        this._setMessage('AVL 模式会在普通 BST 插入/删除之后检查平衡因子，并用旋转恢复高度平衡。');
        this._draw();
    },

    destroy() {
        this._listeners.forEach(l => l.el.removeEventListener(l.evt, l.fn, l.opts));
        this._listeners.length = 0;
        if (this._ro) this._ro.disconnect();
        this._ro = null;
        const ctrl = document.getElementById('bstavl-controls');
        if (ctrl) ctrl.innerHTML = '';
        this.canvas = null;
        this.ctx = null;
    },

    _resize() {
        if (!this.canvas || !this.canvas.parentElement || !this.ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const w = this.canvas.parentElement.getBoundingClientRect().width;
        const h = w < 680 ? Math.min(Math.max(w * 1.12, 540), 700) : Math.min(Math.max(w * 0.58, 440), 580);
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
        const ctrl = document.getElementById('bstavl-controls');
        if (!ctrl) return;
        ctrl.innerHTML = '';

        const inputWrap = document.createElement('label');
        inputWrap.className = 'bstavl-input';
        const label = document.createElement('span');
        label.textContent = '键值';
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '1';
        input.max = '99';
        input.value = String(this.activeKey);
        input.id = 'bstavl-key';
        this._on(input, 'input', () => {
            const next = parseInt(input.value, 10);
            if (Number.isFinite(next)) this.activeKey = this._clampKey(next);
        });
        inputWrap.append(label, input);
        ctrl.appendChild(inputWrap);

        const mode = document.createElement('div');
        mode.className = 'bstavl-mode';
        [
            ['bst', '普通 BST'],
            ['avl', 'AVL 自动平衡']
        ].forEach(([value, text]) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'bstavl-chip' + (value === this.mode ? ' active' : '');
            btn.dataset.mode = value;
            btn.textContent = text;
            this._on(btn, 'click', () => {
                this.mode = value;
                mode.querySelectorAll('.bstavl-chip').forEach(b => b.classList.toggle('active', b === btn));
                this._rebuildFromValues();
                this._setMessage(value === 'avl'
                    ? '已切换到 AVL：每次更新后会维持所有节点 |bf| ≤ 1。'
                    : '已切换到普通 BST：插入顺序可能让树退化成长链。');
                this._draw();
            });
            mode.appendChild(btn);
        });
        ctrl.appendChild(mode);

        const ops = document.createElement('div');
        ops.className = 'bstavl-buttons';
        [
            ['insert', '插入'],
            ['find', '查找'],
            ['delete', '删除'],
            ['inorder', '中序'],
            ['reset', '重置']
        ].forEach(([op, text]) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'bstavl-btn' + (op === 'reset' || op === 'inorder' ? ' bstavl-btn--ghost' : '');
            btn.textContent = text;
            this._on(btn, 'click', () => this._runOp(op));
            ops.appendChild(btn);
        });
        ctrl.appendChild(ops);

        const presets = document.createElement('div');
        presets.className = 'bstavl-presets';
        Object.entries(this.presets).forEach(([key, item]) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'bstavl-chip' + (key === 'balanced' ? ' active' : '');
            btn.textContent = item.label;
            this._on(btn, 'click', () => {
                presets.querySelectorAll('.bstavl-chip').forEach(b => b.classList.toggle('active', b === btn));
                this._loadPreset(key, true);
                this._syncControls();
            });
            presets.appendChild(btn);
        });
        ctrl.appendChild(presets);
    },

    _runOp(op) {
        if (op === 'reset') {
            this._loadPreset('balanced', true);
            this._syncControls();
            return;
        }
        if (op === 'inorder') {
            const order = this._inorder(this.root);
            this.path = order.slice();
            this.highlighted = new Set(order);
            this.rotation = '';
            this.action = 'inorder';
            this._setMessage('中序遍历结果：' + (order.length ? order.join(' < ') : '空树') + '。BST 的中序序列应保持有序。');
            this._draw();
            return;
        }

        const key = this._currentKey();
        this.activeKey = key;
        this.rotation = '';
        this.highlighted = new Set();

        if (op === 'find') {
            const result = this._search(key);
            this.path = result.path;
            this.highlighted = new Set(result.path);
            this.action = 'find';
            this._setMessage(result.found
                ? `查找 ${key} 成功：沿 ${result.path.join(' → ')} 命中。`
                : `查找 ${key} 失败：沿 ${result.path.join(' → ') || '空树'} 到空子树停止。`);
        } else if (op === 'insert') {
            this.path = [];
            const before = this._inorder(this.root).join(',');
            const out = this._insert(this.root, key, this.path);
            this.root = out.node;
            this._refreshValues();
            this.highlighted = new Set(this.path.concat([key]));
            this.action = 'insert';
            this._setMessage(out.inserted
                ? `插入 ${key}：先按 BST 路径定位叶子${this.rotation ? '，再执行 ' + this.rotation + '。' : '。'}`
                : `${key} 已存在：本模块按集合模型处理，不重复插入。`);
            if (this.mode === 'avl' && before !== this._inorder(this.root).join(',')) this._validateAVLNote();
        } else if (op === 'delete') {
            this.path = [];
            const out = this._delete(this.root, key, this.path);
            this.root = out.node;
            this._refreshValues();
            this.highlighted = new Set(this.path);
            this.action = 'delete';
            const suffix = out.successor ? ` 两子节点删除使用中序后继 ${out.successor} 替换。` : '';
            this._setMessage(out.deleted
                ? `删除 ${key}：${suffix}${this.rotation ? '随后 ' + this.rotation + ' 恢复平衡。' : '结构已更新。'}`
                : `${key} 不在树中，没有删除节点。`);
        }

        this._syncControls();
        this._draw();
    },

    _validateAVLNote() {
        if (!this.rotation) {
            const maxBalance = this._maxAbsBalance(this.root);
            if (maxBalance <= 1) this.message += ' 当前所有节点平衡因子都在 -1、0、1 内。';
        }
    },

    _loadPreset(name, announce) {
        const preset = this.presets[name] || this.presets.balanced;
        this.mode = preset.mode;
        this.activeKey = preset.key;
        this.values = [];
        this.root = null;
        this.rotation = '';
        this.path = [];
        preset.values.forEach(value => {
            const holder = [];
            const out = this._insert(this.root, value, holder, true);
            this.root = out.node;
            if (out.inserted) this.values.push(value);
        });
        this.values = this._inorder(this.root);
        this.highlighted = new Set(preset.values);
        this.action = 'preset';
        if (announce) {
            this._setMessage(`${preset.label}已载入：${preset.values.join(', ')}。${this.mode === 'avl' ? '可观察旋转后仍保持中序有序。' : '可对比普通 BST 的高度变化。'}`);
            this._draw();
        }
    },

    _syncControls() {
        const keyInput = document.getElementById('bstavl-key');
        if (keyInput) keyInput.value = String(this.activeKey);
        document.querySelectorAll('#bstavl-controls [data-mode]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === this.mode);
        });
    },

    _rebuildFromValues() {
        const values = this._inorder(this.root);
        this.root = null;
        this.values = [];
        this.rotation = '';
        values.forEach(value => {
            const path = [];
            const out = this._insert(this.root, value, path, true);
            this.root = out.node;
            if (out.inserted) this.values.push(value);
        });
        this.values = this._inorder(this.root);
        this.path = [];
        this.highlighted = new Set();
    },

    _currentKey() {
        const input = document.getElementById('bstavl-key');
        const raw = input ? parseInt(input.value, 10) : this.activeKey;
        return this._clampKey(Number.isFinite(raw) ? raw : this.activeKey || 1);
    },

    _clampKey(value) {
        return Math.max(1, Math.min(99, value));
    },

    _newNode(value) {
        return { value, left: null, right: null, height: 1, x: 0, y: 0, depth: 0 };
    },

    _height(node) {
        return node ? node.height : 0;
    },

    _update(node) {
        if (node) node.height = Math.max(this._height(node.left), this._height(node.right)) + 1;
        return node;
    },

    _balance(node) {
        return node ? this._height(node.left) - this._height(node.right) : 0;
    },

    _insert(node, value, path, silent) {
        if (!node) return { node: this._newNode(value), inserted: true };
        path.push(node.value);
        let inserted = false;
        if (value === node.value) return { node, inserted: false };
        if (value < node.value) {
            const out = this._insert(node.left, value, path, silent);
            node.left = out.node;
            inserted = out.inserted;
        } else {
            const out = this._insert(node.right, value, path, silent);
            node.right = out.node;
            inserted = out.inserted;
        }
        this._update(node);
        if (this.mode === 'avl' && inserted) node = this._rebalanceAfterInsert(node, value, silent);
        return { node, inserted };
    },

    _delete(node, value, path) {
        if (!node) return { node: null, deleted: false, successor: null };
        path.push(node.value);
        let deleted = false;
        let successor = null;
        if (value < node.value) {
            const out = this._delete(node.left, value, path);
            node.left = out.node;
            deleted = out.deleted;
            successor = out.successor;
        } else if (value > node.value) {
            const out = this._delete(node.right, value, path);
            node.right = out.node;
            deleted = out.deleted;
            successor = out.successor;
        } else {
            deleted = true;
            if (!node.left || !node.right) {
                return { node: node.left || node.right, deleted, successor: null };
            }
            const min = this._minNode(node.right);
            successor = min.value;
            node.value = min.value;
            const out = this._delete(node.right, min.value, path);
            node.right = out.node;
        }
        if (!node) return { node, deleted, successor };
        this._update(node);
        if (this.mode === 'avl' && deleted) node = this._rebalanceAfterDelete(node);
        return { node, deleted, successor };
    },

    _rebalanceAfterInsert(node, value, silent) {
        const bf = this._balance(node);
        if (bf > 1 && value < node.left.value) {
            if (!silent) this.rotation = `LL 失衡：对 ${node.value} 右旋`;
            return this._rotateRight(node);
        }
        if (bf < -1 && value > node.right.value) {
            if (!silent) this.rotation = `RR 失衡：对 ${node.value} 左旋`;
            return this._rotateLeft(node);
        }
        if (bf > 1 && value > node.left.value) {
            if (!silent) this.rotation = `LR 失衡：先左旋 ${node.left.value}，再右旋 ${node.value}`;
            node.left = this._rotateLeft(node.left);
            return this._rotateRight(node);
        }
        if (bf < -1 && value < node.right.value) {
            if (!silent) this.rotation = `RL 失衡：先右旋 ${node.right.value}，再左旋 ${node.value}`;
            node.right = this._rotateRight(node.right);
            return this._rotateLeft(node);
        }
        return node;
    },

    _rebalanceAfterDelete(node) {
        const bf = this._balance(node);
        if (bf > 1 && this._balance(node.left) >= 0) {
            this.rotation = this.rotation || `删除后左高：对 ${node.value} 右旋`;
            return this._rotateRight(node);
        }
        if (bf > 1 && this._balance(node.left) < 0) {
            this.rotation = this.rotation || `删除后 LR：先左旋 ${node.left.value}，再右旋 ${node.value}`;
            node.left = this._rotateLeft(node.left);
            return this._rotateRight(node);
        }
        if (bf < -1 && this._balance(node.right) <= 0) {
            this.rotation = this.rotation || `删除后右高：对 ${node.value} 左旋`;
            return this._rotateLeft(node);
        }
        if (bf < -1 && this._balance(node.right) > 0) {
            this.rotation = this.rotation || `删除后 RL：先右旋 ${node.right.value}，再左旋 ${node.value}`;
            node.right = this._rotateRight(node.right);
            return this._rotateLeft(node);
        }
        return node;
    },

    _rotateRight(y) {
        const x = y.left;
        const t2 = x.right;
        x.right = y;
        y.left = t2;
        this._update(y);
        this._update(x);
        return x;
    },

    _rotateLeft(x) {
        const y = x.right;
        const t2 = y.left;
        y.left = x;
        x.right = t2;
        this._update(x);
        this._update(y);
        return y;
    },

    _search(value) {
        const path = [];
        let cur = this.root;
        while (cur) {
            path.push(cur.value);
            if (value === cur.value) return { found: true, path };
            cur = value < cur.value ? cur.left : cur.right;
        }
        return { found: false, path };
    },

    _minNode(node) {
        let cur = node;
        while (cur && cur.left) cur = cur.left;
        return cur;
    },

    _inorder(node, out = []) {
        if (!node) return out;
        this._inorder(node.left, out);
        out.push(node.value);
        this._inorder(node.right, out);
        return out;
    },

    _refreshValues() {
        this.values = this._inorder(this.root);
    },

    _nodeCount(node) {
        return node ? 1 + this._nodeCount(node.left) + this._nodeCount(node.right) : 0;
    },

    _maxAbsBalance(node) {
        if (!node) return 0;
        return Math.max(Math.abs(this._balance(node)), this._maxAbsBalance(node.left), this._maxAbsBalance(node.right));
    },

    _layout() {
        const nodes = [];
        const walk = (node, depth) => {
            if (!node) return;
            walk(node.left, depth + 1);
            node.depth = depth;
            nodes.push(node);
            walk(node.right, depth + 1);
        };
        walk(this.root, 0);
        const left = 48;
        const right = this.W - 48;
        const top = 76;
        const levelGap = Math.max(70, Math.min(96, (this.H - 150) / Math.max(1, this._height(this.root) - 1)));
        nodes.forEach((node, index) => {
            node.x = nodes.length === 1 ? this.W / 2 : left + (right - left) * (index / (nodes.length - 1));
            node.y = top + node.depth * levelGap;
        });
    },

    _draw() {
        if (!this.ctx || !this.canvas) return;
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.W, this.H);
        this._drawBackground(ctx);
        this._layout();
        this._drawEdges(ctx, this.root);
        this._drawNodes(ctx, this.root);
        this._drawLegend(ctx);
        this._updateInfo();
    },

    _drawBackground(ctx) {
        const grd = ctx.createLinearGradient(0, 0, this.W, this.H);
        grd.addColorStop(0, 'rgba(196,121,58,0.12)');
        grd.addColorStop(0.55, 'rgba(13,16,23,0.94)');
        grd.addColorStop(1, 'rgba(77,158,126,0.10)');
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, this.W, this.H);
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        for (let x = 28; x < this.W; x += 36) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, this.H);
            ctx.stroke();
        }
    },

    _drawEdges(ctx, node) {
        if (!node) return;
        ctx.lineWidth = 2;
        [['left', node.left], ['right', node.right]].forEach(([, child]) => {
            if (!child) return;
            const inPath = this.highlighted.has(node.value) && this.highlighted.has(child.value);
            ctx.strokeStyle = inPath ? 'rgba(242,200,107,0.95)' : 'rgba(255,255,255,0.20)';
            ctx.beginPath();
            ctx.moveTo(node.x, node.y + 20);
            const midY = (node.y + child.y) / 2;
            ctx.bezierCurveTo(node.x, midY, child.x, midY, child.x, child.y - 20);
            ctx.stroke();
        });
        this._drawEdges(ctx, node.left);
        this._drawEdges(ctx, node.right);
    },

    _drawNodes(ctx, node) {
        if (!node) return;
        const bf = this._balance(node);
        const active = this.highlighted.has(node.value);
        const imbalanced = Math.abs(bf) > 1;
        const r = 21;

        ctx.save();
        ctx.shadowColor = active ? 'rgba(242,200,107,0.45)' : 'rgba(0,0,0,0.25)';
        ctx.shadowBlur = active ? 18 : 8;
        ctx.fillStyle = imbalanced ? 'rgba(194,80,80,0.88)' : active ? 'rgba(242,200,107,0.92)' : 'rgba(19,24,33,0.96)';
        ctx.strokeStyle = active ? 'rgba(255,240,190,0.9)' : imbalanced ? 'rgba(255,150,150,0.9)' : 'rgba(196,121,58,0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.fillStyle = active ? '#17120b' : '#f4efe7';
        ctx.font = '700 14px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(node.value), node.x, node.y - 3);

        ctx.fillStyle = active ? 'rgba(23,18,11,0.72)' : 'rgba(255,255,255,0.55)';
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.fillText('h' + node.height + ' bf' + bf, node.x, node.y + 14);
        ctx.restore();

        this._drawNodes(ctx, node.left);
        this._drawNodes(ctx, node.right);
    },

    _drawLegend(ctx) {
        const x = 18;
        const y = 18;
        ctx.save();
        ctx.fillStyle = 'rgba(8,10,14,0.72)';
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.lineWidth = 1;
        this._roundRect(ctx, x, y, Math.min(360, this.W - 36), 42, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.82)';
        ctx.font = '700 13px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const modeText = this.mode === 'avl' ? 'AVL 自动平衡' : '普通 BST';
        ctx.fillText(modeText + ' · 高度 ' + this._height(this.root) + ' · 节点 ' + this._nodeCount(this.root), x + 14, y + 8);
        ctx.fillStyle = this._maxAbsBalance(this.root) <= 1 ? 'rgba(120,210,165,0.92)' : 'rgba(255,130,120,0.92)';
        ctx.font = '11px Inter, sans-serif';
        const bal = this.mode === 'avl'
            ? 'AVL 条件：所有节点 |bf| ≤ 1'
            : '普通 BST：复杂度取决于树高';
        ctx.fillText(bal, x + 14, y + 25);
        if (this.rotation) {
            ctx.fillStyle = 'rgba(242,200,107,0.95)';
            ctx.fillText(this.rotation, Math.min(380, this.W * 0.52), y + 25);
        }
        ctx.restore();
    },

    _roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    },

    _setMessage(text) {
        this.message = text;
        this._updateInfo();
    },

    _updateInfo() {
        const info = document.getElementById('bstavl-info');
        if (!info) return;
        const inorder = this._inorder(this.root);
        const height = this._height(this.root);
        const worst = height ? 'O(h) = O(' + height + ')' : 'O(1)';
        const maxBalance = this._maxAbsBalance(this.root);
        info.innerHTML = `
            <div class="bstavl-info__head">
                <h3>BST / AVL 操作读数</h3>
                <span class="bstavl-tag">${this.mode === 'avl' ? '自平衡' : '未平衡'}</span>
            </div>
            <div class="bstavl-info__grid">
                <div class="bstavl-info__row"><span>根节点</span><strong>${this.root ? this.root.value : '空'}</strong></div>
                <div class="bstavl-info__row"><span>高度 h</span><strong>${height}</strong></div>
                <div class="bstavl-info__row"><span>最坏查找</span><strong>${worst}</strong></div>
                <div class="bstavl-info__row"><span>最大 |bf|</span><strong>${maxBalance}</strong></div>
                <div class="bstavl-info__row bstavl-info__row--wide"><span>中序序列</span><strong>${inorder.join(' < ') || '空树'}</strong></div>
                <div class="bstavl-info__row bstavl-info__row--wide"><span>访问路径</span><strong>${this.path.join(' → ') || '等待操作'}</strong></div>
            </div>
            <p class="bstavl-info__note">${this.message}</p>
            <p class="bstavl-info__source">参考 Open Data Structures 的 BST 搜索、插入、删除定义，以及 OpenDSA 对 AVL 高度平衡和单/双旋转的说明。</p>
        `;
    }
};

function initBSTAVL() {
    BSTAVL.init();
}

window.BSTAVL = BSTAVL;
window.initBSTAVL = initBSTAVL;
