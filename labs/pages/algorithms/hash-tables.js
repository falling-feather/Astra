/* Hash tables: separate chaining, linear probing, and load factor */
const HashTablesLab = {
    canvas: null,
    ctx: null,
    W: 0,
    H: 0,
    _listeners: [],
    _ro: null,
    size: 8,
    keys: [],
    chains: [],
    linear: [],
    activeKey: 26,
    action: 'idle',
    path: [],
    chainBucket: null,
    chainNode: -1,
    foundLinear: -1,
    message: '',
    presets: {
        sparse: { label: '低负载', size: 8, keys: [18, 41, 22, 7] },
        collision: { label: '集中冲突', size: 8, keys: [10, 18, 26, 34, 2] },
        dense: { label: '高负载', size: 8, keys: [5, 13, 21, 29, 6, 14] }
    },

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        if (this.canvas) this.destroy();
        this.canvas = document.getElementById('hashtable-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this._loadPreset('collision', false);
        this._resize();
        if (typeof ResizeObserver !== 'undefined') {
            this._ro = new ResizeObserver(() => this._resize());
            this._ro.observe(this.canvas.parentElement);
        } else {
            this._on(window, 'resize', () => this._resize());
        }
        this._buildControls();
        this._setMessage('同一组键会同时进入链地址表与线性探测表。先观察 hash(key)=key mod m，再比较冲突如何被处理。');
        this._draw();
    },

    destroy() {
        this._listeners.forEach(l => l.el.removeEventListener(l.evt, l.fn, l.opts));
        this._listeners.length = 0;
        if (this._ro) this._ro.disconnect();
        this._ro = null;
        const ctrl = document.getElementById('hashtable-controls');
        if (ctrl) ctrl.innerHTML = '';
        this.canvas = null;
        this.ctx = null;
    },

    _resize() {
        if (!this.canvas || !this.canvas.parentElement || !this.ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const w = this.canvas.parentElement.getBoundingClientRect().width;
        const h = w < 680 ? Math.min(Math.max(w * 1.12, 520), 680) : Math.min(Math.max(w * 0.58, 430), 560);
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
        const ctrl = document.getElementById('hashtable-controls');
        if (!ctrl) return;
        ctrl.innerHTML = '';

        const inputWrap = document.createElement('label');
        inputWrap.className = 'hashlab-input';
        const label = document.createElement('span');
        label.textContent = '键值';
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.max = '999';
        input.value = String(this.activeKey);
        input.id = 'hashtable-key';
        this._on(input, 'input', () => {
            const next = parseInt(input.value, 10);
            if (Number.isFinite(next)) this.activeKey = next;
            this.action = 'preview';
            this._previewKey();
        });
        inputWrap.append(label, input);
        ctrl.appendChild(inputWrap);

        const ops = document.createElement('div');
        ops.className = 'hashlab-buttons';
        [
            ['insert', '插入'],
            ['find', '查找'],
            ['delete', '删除'],
            ['rehash', '扩容重散列']
        ].forEach(([op, text]) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'hashlab-btn' + (op === 'rehash' ? ' hashlab-btn--ghost' : '');
            btn.textContent = text;
            this._on(btn, 'click', () => this._runOp(op));
            ops.appendChild(btn);
        });
        ctrl.appendChild(ops);

        const presets = document.createElement('div');
        presets.className = 'hashlab-presets';
        Object.entries(this.presets).forEach(([key, item]) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'hashlab-chip' + (key === 'collision' ? ' active' : '');
            btn.dataset.preset = key;
            btn.textContent = item.label;
            this._on(btn, 'click', () => {
                presets.querySelectorAll('.hashlab-chip').forEach(b => b.classList.toggle('active', b === btn));
                this._loadPreset(key, true);
                const field = document.getElementById('hashtable-key');
                if (field) field.value = String(this.activeKey);
            });
            presets.appendChild(btn);
        });
        ctrl.appendChild(presets);
    },

    _runOp(op) {
        if (op === 'rehash') {
            this._rehash();
            return;
        }
        const key = this._currentKey();
        this.activeKey = key;
        const hash = this._hash(key);
        this.action = op;
        this.chainBucket = hash;
        this.chainNode = this.chains[hash].indexOf(key);
        const probe = this._probe(key, op === 'insert');
        this.path = probe.path;
        this.foundLinear = probe.foundIndex;

        if (op === 'insert') {
            if (this.keys.includes(key)) {
                this._setMessage(`${key} 已存在：查找先命中已有键，不重复插入。`);
            } else if (probe.placeIndex < 0) {
                this._setMessage('开放地址表已无空槽，必须扩容后再插入。');
            } else {
                this.keys.push(key);
                this.chains[hash].push(key);
                this.linear[probe.placeIndex] = { key, home: hash };
                this._setMessage(`插入 ${key}：链地址追加到槽 ${hash}；线性探测依次检查 ${this.path.join(' → ')}。`);
            }
        } else if (op === 'find') {
            const found = this.keys.includes(key);
            this._setMessage(found
                ? `查找 ${key} 成功：链地址只扫描目标桶，线性探测到第 ${this.path.length} 次检查命中。`
                : `查找 ${key} 失败：线性探测遇到空槽即可停止，链地址扫描槽 ${hash} 的链表后结束。`);
        } else if (op === 'delete') {
            const chainPos = this.chains[hash].indexOf(key);
            if (chainPos >= 0) this.chains[hash].splice(chainPos, 1);
            const index = this.linear.findIndex(cell => cell && !cell.deleted && cell.key === key);
            if (index >= 0) this.linear[index] = { deleted: true, oldKey: key };
            this.keys = this.keys.filter(k => k !== key);
            this._setMessage(index >= 0
                ? `删除 ${key}：链地址直接移除节点；线性探测留下 tombstone，避免截断后续探测路径。`
                : `${key} 不在表中，没有删除任何元素。`);
        }

        this._updateInfo();
        this._draw();
    },

    _previewKey() {
        const key = this._currentKey();
        this.chainBucket = this._hash(key);
        const probe = this._probe(key, false);
        this.path = probe.path;
        this.foundLinear = probe.foundIndex;
        this._setMessage(`预览 ${key}：hash(${key}) = ${key} mod ${this.size} = ${this.chainBucket}。`);
        this._updateInfo();
        this._draw();
    },

    _currentKey() {
        const input = document.getElementById('hashtable-key');
        const raw = input ? parseInt(input.value, 10) : this.activeKey;
        if (!Number.isFinite(raw)) return this.activeKey || 0;
        return Math.max(0, Math.min(999, raw));
    },

    _loadPreset(name, announce) {
        const preset = this.presets[name] || this.presets.collision;
        this.size = preset.size;
        this.keys = preset.keys.slice();
        this.activeKey = name === 'sparse' ? 30 : name === 'dense' ? 37 : 26;
        this.action = 'idle';
        this.path = [];
        this.chainBucket = null;
        this.chainNode = -1;
        this.foundLinear = -1;
        this._rebuildTables();
        if (announce) {
            this._setMessage(`${preset.label}样例已载入：${this.keys.join(', ')}。`);
            this._updateInfo();
            this._draw();
        }
    },

    _rebuildTables() {
        this.chains = Array.from({ length: this.size }, () => []);
        this.linear = Array.from({ length: this.size }, () => null);
        this.keys.forEach(key => {
            const h = this._hash(key);
            this.chains[h].push(key);
            const p = this._probeIn(this.linear, key, true);
            if (p.placeIndex >= 0) this.linear[p.placeIndex] = { key, home: h };
        });
    },

    _rehash() {
        const oldSize = this.size;
        this.size = this.size * 2;
        this.action = 'rehash';
        this.path = [];
        this.chainBucket = null;
        this.chainNode = -1;
        this.foundLinear = -1;
        this._rebuildTables();
        this._setMessage(`扩容重散列：槽数 ${oldSize} → ${this.size}，所有键按新的 hash(key)=key mod ${this.size} 重新放置，tombstone 被清除。`);
        this._updateInfo();
        this._draw();
    },

    _hash(key) {
        return ((key % this.size) + this.size) % this.size;
    },

    _probe(key, forInsert) {
        return this._probeIn(this.linear, key, forInsert);
    },

    _probeIn(table, key, forInsert) {
        const start = this._hash(key);
        const path = [];
        let firstDeleted = -1;
        for (let step = 0; step < this.size; step++) {
            const idx = (start + step) % this.size;
            path.push(idx);
            const cell = table[idx];
            if (!cell) {
                return {
                    path,
                    foundIndex: -1,
                    placeIndex: forInsert ? (firstDeleted >= 0 ? firstDeleted : idx) : -1
                };
            }
            if (cell.deleted) {
                if (firstDeleted < 0) firstDeleted = idx;
                continue;
            }
            if (cell.key === key) {
                return {
                    path,
                    foundIndex: idx,
                    placeIndex: idx
                };
            }
        }
        return { path, foundIndex: -1, placeIndex: firstDeleted };
    },

    _setMessage(text) {
        this.message = text;
        this._updateInfo();
    },

    _updateInfo() {
        const info = document.getElementById('hashtable-info');
        if (!info) return;
        const occupied = this.linear.filter(c => c && !c.deleted).length;
        const q = this.linear.filter(Boolean).length;
        const alpha = occupied / this.size;
        const pressure = q / this.size;
        const maxChain = Math.max(0, ...this.chains.map(chain => chain.length));
        const key = this._currentKey();
        const h = this._hash(key);
        info.innerHTML = `
            <div class="hashlab-info__head">
                <span class="hashlab-tag">hash(${key}) = ${h}</span>
                <h3>哈希表：从冲突处理到负载因子</h3>
            </div>
            <div class="hashlab-info__grid">
                <div class="hashlab-info__row"><span>链地址法</span><strong>每个槽是一条链；最长链 = ${maxChain}</strong></div>
                <div class="hashlab-info__row"><span>线性探测</span><strong>冲突后检查 h, h+1, h+2...；本次路径 ${this.path.length ? this.path.join(' → ') : '待操作'}</strong></div>
                <div class="hashlab-info__row"><span>负载因子</span><strong>α = n / m = ${occupied}/${this.size} = ${alpha.toFixed(2)}</strong></div>
                <div class="hashlab-info__row"><span>探测压力</span><strong>q / m = ${q}/${this.size} = ${pressure.toFixed(2)}（含 tombstone）</strong></div>
            </div>
            <p class="hashlab-info__note">${this._escape(this.message)}</p>
            <p class="hashlab-info__source">参考 Open Data Structures 5.1 ChainedHashTable 与 5.2 LinearHashTable。这里用 key mod m 作为可视化示例；实际工程需选择更均匀的哈希函数。</p>
        `;
    },

    _draw() {
        if (!this.ctx || !this.W || !this.H) return;
        const ctx = this.ctx;
        const compact = this.W < 680;
        ctx.clearRect(0, 0, this.W, this.H);
        this._drawBackground(ctx);
        const pad = compact ? 18 : 24;
        const top = compact ? 26 : 30;
        const gap = compact ? 18 : 22;
        const panelH = compact ? (this.H - top * 2 - gap) / 2 : this.H - top * 2;
        const chainBox = compact
            ? { x: pad, y: top, w: this.W - pad * 2, h: panelH }
            : { x: pad, y: top, w: (this.W - pad * 2 - gap) / 2, h: panelH };
        const linearBox = compact
            ? { x: pad, y: top + panelH + gap, w: this.W - pad * 2, h: panelH }
            : { x: pad + chainBox.w + gap, y: top, w: chainBox.w, h: panelH };
        this._drawChainPanel(ctx, chainBox);
        this._drawLinearPanel(ctx, linearBox);
    },

    _drawBackground(ctx) {
        const bg = ctx.createLinearGradient(0, 0, this.W, this.H);
        bg.addColorStop(0, 'rgba(24, 18, 12, 0.98)');
        bg.addColorStop(0.52, 'rgba(22, 21, 28, 0.98)');
        bg.addColorStop(1, 'rgba(13, 18, 24, 0.98)');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, this.W, this.H);
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 166, 83, 0.06)';
        ctx.lineWidth = 1;
        for (let x = -40; x < this.W + 80; x += 36) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x + this.H * 0.32, this.H);
            ctx.stroke();
        }
        for (let y = 20; y < this.H; y += 36) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(this.W, y - this.W * 0.12);
            ctx.stroke();
        }
        ctx.restore();
    },

    _drawChainPanel(ctx, box) {
        this._panel(ctx, box, '链地址法 Separate chaining', '槽位存链表，冲突键追加到同一桶');
        const rowH = Math.min(28, (box.h - 84) / this.size);
        const startY = box.y + 62;
        const indexW = 34;
        const bucketX = box.x + 48;
        const bucketW = box.w - 64;
        for (let i = 0; i < this.size; i++) {
            const y = startY + i * rowH;
            const active = i === this.chainBucket;
            this._slotLabel(ctx, box.x + 16, y, indexW, rowH - 5, i, active);
            this._roundRect(ctx, bucketX, y, bucketW, rowH - 5, 8);
            ctx.fillStyle = active ? 'rgba(255,166,83,0.12)' : 'rgba(255,255,255,0.035)';
            ctx.fill();
            ctx.strokeStyle = active ? 'rgba(255,166,83,0.55)' : 'rgba(255,255,255,0.08)';
            ctx.stroke();
            let nodeX = bucketX + 8;
            this.chains[i].forEach((key, j) => {
                const w = Math.min(48, Math.max(34, String(key).length * 9 + 20));
                const found = active && key === this.activeKey && (this.action === 'find' || this.action === 'delete' || this.action === 'insert');
                this._roundRect(ctx, nodeX, y + 4, w, rowH - 13, 8);
                ctx.fillStyle = found ? 'rgba(99, 214, 155, 0.82)' : 'rgba(255,166,83,0.2)';
                ctx.fill();
                ctx.strokeStyle = found ? 'rgba(99,214,155,0.95)' : 'rgba(255,166,83,0.4)';
                ctx.stroke();
                ctx.fillStyle = found ? 'rgba(8,14,12,0.95)' : 'rgba(255,239,217,0.9)';
                ctx.font = `700 12px ${this._fontFamily(true)}`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(String(key), nodeX + w / 2, y + rowH / 2 - 2);
                if (j < this.chains[i].length - 1) {
                    ctx.strokeStyle = 'rgba(255,166,83,0.35)';
                    ctx.beginPath();
                    ctx.moveTo(nodeX + w + 3, y + rowH / 2 - 2);
                    ctx.lineTo(nodeX + w + 14, y + rowH / 2 - 2);
                    ctx.stroke();
                }
                nodeX += w + 16;
            });
        }
        this._stat(ctx, box, `平均桶长 α=${(this.keys.length / this.size).toFixed(2)}，目标桶扫描 ${this.chainBucket == null ? 0 : this.chains[this.chainBucket].length} 个节点`);
    },

    _drawLinearPanel(ctx, box) {
        this._panel(ctx, box, '开放地址法 Linear probing', '每个槽只放一个键，冲突后向后探测');
        const cols = Math.min(8, this.size);
        const rows = Math.ceil(this.size / cols);
        const gap = 8;
        const cellW = Math.min(54, (box.w - 36 - gap * (cols - 1)) / cols);
        const cellH = Math.min(58, (box.h - 128 - gap * (rows - 1)) / rows);
        const gridW = cols * cellW + (cols - 1) * gap;
        const startX = box.x + (box.w - gridW) / 2;
        const startY = box.y + 80;
        for (let i = 0; i < this.size; i++) {
            const row = Math.floor(i / cols);
            const col = i % cols;
            const x = startX + col * (cellW + gap);
            const y = startY + row * (cellH + gap);
            const cell = this.linear[i];
            const inPath = this.path.includes(i);
            const found = i === this.foundLinear;
            this._roundRect(ctx, x, y, cellW, cellH, 10);
            ctx.fillStyle = found
                ? 'rgba(99,214,155,0.82)'
                : inPath
                    ? 'rgba(255,166,83,0.22)'
                    : cell && cell.deleted
                        ? 'rgba(255,95,95,0.10)'
                        : 'rgba(255,255,255,0.04)';
            ctx.fill();
            ctx.strokeStyle = found
                ? 'rgba(99,214,155,0.95)'
                : inPath
                    ? 'rgba(255,166,83,0.72)'
                    : 'rgba(255,255,255,0.1)';
            ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.42)';
            ctx.font = `700 10px ${this._fontFamily(true)}`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(String(i), x + 7, y + 6);
            if (cell && cell.deleted) {
                ctx.fillStyle = 'rgba(255,120,120,0.9)';
                ctx.font = `700 11px ${this._fontFamily(false)}`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('del', x + cellW / 2, y + cellH / 2 + 4);
            } else if (cell) {
                ctx.fillStyle = found ? 'rgba(8,14,12,0.95)' : 'rgba(255,239,217,0.92)';
                ctx.font = `800 15px ${this._fontFamily(true)}`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(String(cell.key), x + cellW / 2, y + cellH / 2 + 4);
                ctx.fillStyle = found ? 'rgba(8,14,12,0.62)' : 'rgba(255,255,255,0.42)';
                ctx.font = `600 9px ${this._fontFamily(true)}`;
                ctx.fillText(`h=${cell.home}`, x + cellW / 2, y + cellH - 10);
            }
        }
        if (this.path.length > 1) this._drawProbePath(ctx, startX, startY, cellW, cellH, gap, cols);
        const q = this.linear.filter(Boolean).length;
        this._stat(ctx, box, `探测压力 q/m=${q}/${this.size}=${(q / this.size).toFixed(2)}；遇到空槽说明查找失败`);
    },

    _drawProbePath(ctx, startX, startY, cellW, cellH, gap, cols) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,166,83,0.65)';
        ctx.fillStyle = 'rgba(255,166,83,0.75)';
        ctx.lineWidth = 1.7;
        ctx.setLineDash([5, 5]);
        for (let i = 0; i < this.path.length - 1; i++) {
            const a = this._cellCenter(this.path[i], startX, startY, cellW, cellH, gap, cols);
            const b = this._cellCenter(this.path[i + 1], startX, startY, cellW, cellH, gap, cols);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
        }
        ctx.restore();
    },

    _cellCenter(index, startX, startY, cellW, cellH, gap, cols) {
        const row = Math.floor(index / cols);
        const col = index % cols;
        return {
            x: startX + col * (cellW + gap) + cellW / 2,
            y: startY + row * (cellH + gap) + cellH / 2
        };
    },

    _panel(ctx, box, title, subtitle) {
        ctx.save();
        this._roundRect(ctx, box.x, box.y, box.w, box.h, 16);
        ctx.fillStyle = 'rgba(255,255,255,0.026)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,166,83,0.16)';
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,166,83,0.96)';
        ctx.font = `800 15px ${this._fontFamily(false)}`;
        ctx.fillText(title, box.x + 18, box.y + 26);
        ctx.fillStyle = 'rgba(239,231,222,0.64)';
        ctx.font = `500 12px ${this._fontFamily(false)}`;
        this._wrapText(ctx, subtitle, box.x + 18, box.y + 48, box.w - 36, 17, 2);
        ctx.restore();
    },

    _slotLabel(ctx, x, y, w, h, value, active) {
        this._roundRect(ctx, x, y, w, h, 8);
        ctx.fillStyle = active ? 'rgba(255,166,83,0.28)' : 'rgba(255,255,255,0.05)';
        ctx.fill();
        ctx.strokeStyle = active ? 'rgba(255,166,83,0.6)' : 'rgba(255,255,255,0.1)';
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,239,217,0.84)';
        ctx.font = `800 11px ${this._fontFamily(true)}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(value), x + w / 2, y + h / 2);
    },

    _stat(ctx, box, text) {
        ctx.save();
        const y = box.y + box.h - 38;
        this._roundRect(ctx, box.x + 16, y, box.w - 32, 24, 8);
        ctx.fillStyle = 'rgba(255,166,83,0.08)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,166,83,0.14)';
        ctx.stroke();
        ctx.fillStyle = 'rgba(239,231,222,0.72)';
        ctx.font = `600 11px ${this._fontFamily(false)}`;
        this._wrapText(ctx, text, box.x + 28, y + 16, box.w - 56, 14, 1);
        ctx.restore();
    },

    _escape(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    _wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
        const chars = String(text).split('');
        let line = '';
        let lines = 0;
        for (let i = 0; i < chars.length; i++) {
            const test = line + chars[i];
            if (ctx.measureText(test).width > maxWidth && line) {
                ctx.fillText(line, x, y + lines * lineHeight);
                line = chars[i];
                lines++;
                if (maxLines && lines >= maxLines) return;
            } else {
                line = test;
            }
        }
        if (line && (!maxLines || lines < maxLines)) ctx.fillText(line, x, y + lines * lineHeight);
    },

    _roundRect(ctx, x, y, w, h, r) {
        const radius = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + w, y, x + w, y + h, radius);
        ctx.arcTo(x + w, y + h, x, y + h, radius);
        ctx.arcTo(x, y + h, x, y, radius);
        ctx.arcTo(x, y, x + w, y, radius);
        ctx.closePath();
    },

    _fontFamily(mono) {
        if (typeof CF !== 'undefined') return mono ? CF.mono : CF.sans;
        return mono ? 'monospace' : 'system-ui, sans-serif';
    }
};

function initHashTablesLab() {
    HashTablesLab.init();
}

window.HashTablesLab = HashTablesLab;
window.initHashTablesLab = initHashTablesLab;
