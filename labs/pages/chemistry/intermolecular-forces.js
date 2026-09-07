// ===== 分子间力与氢键 =====
// 双模式：氢化物沸点趋势图（范德华力 vs 氢键反常） · 氢键模型动画（水/HF/氨网络）
// 人教版选必二 第2章

const Intermolecular = {
    canvas: null, ctx: null, W: 0, H: 0,
    mode: 'boiling',          // 'boiling' | 'hbond'
    _listeners: [],
    _resizeObs: null,
    _raf: null,
    _lastTime: 0,
    _t: 0,

    /* ── 沸点趋势状态 ── */
    _enabled: { IVA: true, VA: true, VIA: true, VIIA: true },
    _selPt: null,             // {gid, idx}
    _ptHits: [],              // 屏幕坐标命中表

    /* ── 氢键模型状态 ── */
    _hb: 'water',

    _COL: {
        accent: '#4d9e7e',
        amber: '#e5c07b',
        text: '#e6e6e6',
        dim: '#8a8a8a',
        line: 'rgba(255,255,255,.12)',
        grid: 'rgba(255,255,255,.07)',
    },

    /* ═══════════════════ 沸点数据（°C，周期 2~5）═══════════════════ */
    _BP: [
        {
            gid: 'IVA', name: 'ⅣA 族 氢化物', color: '#5b9bd5', anomaly: null,
            note: '无氢键 → 沸点随相对分子质量增大而单调升高（范德华力增强），是“纯范德华力”的参照线。',
            pts: [
                { f: 'CH₄', p: 2, bp: -161.5 },
                { f: 'SiH₄', p: 3, bp: -111.8 },
                { f: 'GeH₄', p: 4, bp: -88.5 },
                { f: 'SnH₄', p: 5, bp: -52.0 },
            ],
        },
        {
            gid: 'VA', name: 'ⅤA 族 氢化物', color: '#70ad47', anomaly: 0,
            note: 'NH₃ 因 N—H 之间形成氢键，沸点反常偏高，明显高于同族 PH₃。',
            pts: [
                { f: 'NH₃', p: 2, bp: -33.3 },
                { f: 'PH₃', p: 3, bp: -87.7 },
                { f: 'AsH₃', p: 4, bp: -62.5 },
                { f: 'SbH₃', p: 5, bp: -17.1 },
            ],
        },
        {
            gid: 'VIA', name: 'ⅥA 族 氢化物', color: '#ed7d31', anomaly: 0,
            note: 'H₂O 每个分子可形成多达 4 个氢键并构成立体网络，沸点高达 100℃，远高于同族 H₂S。',
            pts: [
                { f: 'H₂O', p: 2, bp: 100.0 },
                { f: 'H₂S', p: 3, bp: -60.3 },
                { f: 'H₂Se', p: 4, bp: -41.3 },
                { f: 'H₂Te', p: 5, bp: -2.2 },
            ],
        },
        {
            gid: 'VIIA', name: 'ⅦA 族 氢化物', color: '#e5c07b', anomaly: 0,
            note: '单个 H—F···F 氢键很强，HF 沸点反常高于 HCl（同族其余按范德华力递增）。水的高沸点还来自多氢键网络。',
            pts: [
                { f: 'HF', p: 2, bp: 19.5 },
                { f: 'HCl', p: 3, bp: -85.0 },
                { f: 'HBr', p: 4, bp: -66.8 },
                { f: 'HI', p: 5, bp: -35.4 },
            ],
        },
    ],

    /* ═══════════════════ 氢键模型数据 ═══════════════════ */
    _ATOM: {
        O: { c: '#ff5a5a', r: 13 },
        N: { c: '#5b8cff', r: 13 },
        F: { c: '#50d890', r: 13 },
        C: { c: '#9aa0aa', r: 12 },
        H: { c: '#d8dde6', r: 8 },
    },

    _HB: [
        {
            id: 'water', name: '水 H₂O', donor: 'O—H', acceptor: 'O',
            note: '每个水分子既可作 2 个氢键的“给体”、又可作 2 个氢键的“受体”，最多形成 4 个氢键 → 立体网络。这是水沸点反常高、冰密度小于液态水的根本原因。',
            atoms: [
                { el: 'O', x: 0.50, y: 0.50, m: 0 }, { el: 'H', x: 0.42, y: 0.43, m: 0 }, { el: 'H', x: 0.58, y: 0.43, m: 0 },
                { el: 'O', x: 0.50, y: 0.16, m: 1 }, { el: 'H', x: 0.45, y: 0.25, m: 1 }, { el: 'H', x: 0.58, y: 0.09, m: 1 },
                { el: 'O', x: 0.18, y: 0.66, m: 2 }, { el: 'H', x: 0.27, y: 0.60, m: 2 }, { el: 'H', x: 0.12, y: 0.75, m: 2 },
                { el: 'O', x: 0.82, y: 0.66, m: 3 }, { el: 'H', x: 0.73, y: 0.60, m: 3 }, { el: 'H', x: 0.88, y: 0.75, m: 3 },
                { el: 'O', x: 0.50, y: 0.86, m: 4 }, { el: 'H', x: 0.43, y: 0.78, m: 4 }, { el: 'H', x: 0.58, y: 0.93, m: 4 },
            ],
            bonds: [[0, 1], [0, 2], [3, 4], [3, 5], [6, 7], [6, 8], [9, 10], [9, 11], [12, 13], [12, 14]],
            hbonds: [[4, 0], [1, 6], [2, 9], [13, 0]],
        },
        {
            id: 'hf', name: '氟化氢 HF', donor: 'F—H', acceptor: 'F',
            note: '单个 H—F···F 氢键很强；固态、液态 HF 常以锯齿状长链存在，沸点反常高于同族 HCl。与水的三维氢键网络需分开比较。',
            atoms: [
                { el: 'F', x: 0.10, y: 0.40, m: 0 }, { el: 'H', x: 0.22, y: 0.55, m: 0 },
                { el: 'F', x: 0.36, y: 0.62, m: 1 }, { el: 'H', x: 0.48, y: 0.42, m: 1 },
                { el: 'F', x: 0.62, y: 0.40, m: 2 }, { el: 'H', x: 0.74, y: 0.55, m: 2 },
                { el: 'F', x: 0.88, y: 0.62, m: 3 }, { el: 'H', x: 0.99, y: 0.42, m: 3 },
            ],
            bonds: [[0, 1], [2, 3], [4, 5], [6, 7]],
            hbonds: [[1, 2], [3, 4], [5, 6]],
        },
        {
            id: 'nh3', name: '氨 NH₃', donor: 'N—H', acceptor: 'N',
            note: 'N—H 之间形成氢键，使 NH₃ 沸点反常偏高；氢键也是氨极易溶于水（喷泉实验）的重要原因。',
            atoms: [
                { el: 'N', x: 0.28, y: 0.26, m: 0 }, { el: 'H', x: 0.18, y: 0.34, m: 0 }, { el: 'H', x: 0.36, y: 0.18, m: 0 }, { el: 'H', x: 0.38, y: 0.36, m: 0 },
                { el: 'N', x: 0.60, y: 0.52, m: 1 }, { el: 'H', x: 0.50, y: 0.42, m: 1 }, { el: 'H', x: 0.72, y: 0.48, m: 1 }, { el: 'H', x: 0.62, y: 0.66, m: 1 },
                { el: 'N', x: 0.44, y: 0.80, m: 2 }, { el: 'H', x: 0.34, y: 0.88, m: 2 }, { el: 'H', x: 0.56, y: 0.86, m: 2 }, { el: 'H', x: 0.46, y: 0.64, m: 2 },
            ],
            bonds: [[0, 1], [0, 2], [0, 3], [4, 5], [4, 6], [4, 7], [8, 9], [8, 10], [8, 11]],
            hbonds: [[5, 0], [11, 4]],
        },
    ],

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    /* ═══════════════════ 绘制：沸点趋势图 ═══════════════════ */
    _drawBoiling() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.W, this.H);
        const L = 56, R = 18, T = 34, B = 52;
        const iw = this.W - L - R, ih = this.H - T - B;
        const yMin = -180, yMax = 120;
        const xOf = p => L + (p - 2) / 3 * iw;
        const yOf = bp => T + (yMax - bp) / (yMax - yMin) * ih;

        // 网格 + Y 轴刻度
        ctx.textBaseline = 'middle'; ctx.font = '11px ' + CF.mono;
        for (let v = -150; v <= 100; v += 50) {
            const y = yOf(v);
            ctx.strokeStyle = v === 0 ? this._COL.line : this._COL.grid;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(this.W - R, y); ctx.stroke();
            ctx.fillStyle = this._COL.dim; ctx.textAlign = 'right';
            ctx.fillText(v + '', L - 8, y);
        }
        // X 轴刻度（周期）
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        for (let p = 2; p <= 5; p++) {
            const x = xOf(p);
            ctx.fillStyle = this._COL.dim; ctx.font = '11px ' + CF.mono;
            ctx.fillText('第 ' + p + ' 周期', x, this.H - B + 10);
        }
        // 轴标题
        ctx.fillStyle = this._COL.dim; ctx.font = '11px ' + CF.sans;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText('沸点 / ℃', 6, T - 14);

        // 折线 + 数据点
        this._ptHits = [];
        this._BP.forEach(g => {
            if (!this._enabled[g.gid]) return;
            // 折线
            ctx.strokeStyle = g.color; ctx.lineWidth = 2;
            ctx.beginPath();
            g.pts.forEach((pt, i) => {
                const x = xOf(pt.p), y = yOf(pt.bp);
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.stroke();
            // 点
            g.pts.forEach((pt, i) => {
                const x = xOf(pt.p), y = yOf(pt.bp);
                const sel = this._selPt && this._selPt.gid === g.gid && this._selPt.idx === i;
                const isAnom = g.anomaly === i;
                this._ptHits.push({ x, y, gid: g.gid, idx: i });
                if (isAnom) {
                    ctx.strokeStyle = this._COL.amber; ctx.lineWidth = 1.5;
                    ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke();
                }
                ctx.fillStyle = g.color;
                if (sel) { ctx.shadowColor = g.color; ctx.shadowBlur = 12; }
                ctx.beginPath(); ctx.arc(x, y, sel ? 6 : 4.2, 0, Math.PI * 2); ctx.fill();
                ctx.shadowBlur = 0;
                // 分子式标签
                ctx.fillStyle = sel ? '#fff' : this._COL.text;
                ctx.font = (sel ? 'bold ' : '') + '11px ' + CF.mono;
                ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
                ctx.fillText(pt.f, x, y - (isAnom ? 13 : 8));
                if (isAnom) {
                    ctx.fillStyle = this._COL.amber; ctx.font = '10px ' + CF.sans;
                    ctx.textBaseline = 'top';
                    ctx.fillText('氢键↑', x, y + 11);
                }
            });
        });

        // 图例
        let lx = L + 6, ly = T + 6;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '11px ' + CF.sans;
        this._BP.forEach(g => {
            const on = this._enabled[g.gid];
            ctx.globalAlpha = on ? 1 : 0.3;
            ctx.fillStyle = g.color;
            ctx.fillRect(lx, ly - 5, 16, 3);
            ctx.fillStyle = this._COL.text;
            ctx.fillText(g.gid, lx + 22, ly);
            ly += 18;
        });
        ctx.globalAlpha = 1;
    },

    /* ═══════════════════ 绘制：氢键模型 ═══════════════════ */
    _drawHbond() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.W, this.H);
        const ex = this._HB.find(e => e.id === this._hb);
        const pad = 50;
        const sz = Math.min(this.W - pad * 2, this.H - pad * 2 - 30);
        const ox = (this.W - sz) / 2, oy = (this.H - sz) / 2 + 10;
        const fx = m => ox + this._float(m).dx;
        const fy = m => oy + this._float(m).dy;
        const px = a => fx(a.m) + a.x * sz;
        const py = a => fy(a.m) + a.y * sz;
        const A = ex.atoms;

        // 氢键（虚线，置于底层）
        ctx.setLineDash([4, 4]); ctx.lineWidth = 2;
        ex.hbonds.forEach(([i, j]) => {
            const a = A[i], b = A[j];
            ctx.strokeStyle = 'rgba(229,192,123,.75)';
            ctx.beginPath(); ctx.moveTo(px(a), py(a)); ctx.lineTo(px(b), py(b)); ctx.stroke();
        });
        ctx.setLineDash([]);

        // 共价键
        ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 3;
        ex.bonds.forEach(([i, j]) => {
            const a = A[i], b = A[j];
            ctx.beginPath(); ctx.moveTo(px(a), py(a)); ctx.lineTo(px(b), py(b)); ctx.stroke();
        });

        // 原子
        A.forEach(a => {
            const at = this._ATOM[a.el];
            const x = px(a), y = py(a);
            const g = ctx.createRadialGradient(x - at.r * 0.3, y - at.r * 0.3, 1, x, y, at.r);
            g.addColorStop(0, '#fff');
            g.addColorStop(0.25, at.c);
            g.addColorStop(1, at.c);
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(x, y, at.r, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = a.el === 'H' ? '#222' : '#fff';
            ctx.font = 'bold ' + (a.el === 'H' ? 9 : 11) + 'px ' + CF.sans;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(a.el, x, y);
        });

        // 标题 + 图例
        ctx.fillStyle = this._COL.text; ctx.font = 'bold 15px ' + CF.sans;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(ex.name + '　分子间氢键 ' + ex.donor + '···' + ex.acceptor, this.W / 2, 14);
        // 图例：虚线=氢键，实线=共价键
        ctx.font = '11px ' + CF.sans; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        const ly = this.H - 18;
        ctx.strokeStyle = 'rgba(229,192,123,.75)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(16, ly); ctx.lineTo(40, ly); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = this._COL.dim; ctx.fillText('氢键（分子间）', 46, ly);
        ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(168, ly); ctx.lineTo(192, ly); ctx.stroke();
        ctx.fillText('共价键（分子内）', 198, ly);
    },

    _float(m) {
        const t = this._t;
        return {
            dx: 5 * Math.sin(t * 0.0012 + m * 1.7),
            dy: 5 * Math.cos(t * 0.0009 + m * 2.3),
        };
    },

    _draw() {
        if (this.mode === 'boiling') this._drawBoiling();
        else this._drawHbond();
    },

    _animate(ts) {
        if (!this._lastTime) this._lastTime = ts;
        this._t = ts;
        this._lastTime = ts;
        this._drawHbond();
        this._raf = requestAnimationFrame(t => this._animate(t));
    },

    _startAnim() {
        if (this._raf) return;
        this._lastTime = 0;
        this._raf = requestAnimationFrame(t => this._animate(t));
    },

    _stopAnim() {
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    },

    /* ═══════════════════ 控件 ═══════════════════ */
    _buildControls() {
        const el = document.getElementById('im-controls');
        if (!el) return;
        el.innerHTML = '';

        const modes = document.createElement('fieldset');
        modes.className = 'im-mode-btns';
        modes.setAttribute('role', 'group');
        modes.setAttribute('aria-label', '模式选择');
        [
            { key: 'boiling', label: '📈 沸点趋势' },
            { key: 'hbond', label: '💧 氢键模型' },
        ].forEach(m => {
            const btn = document.createElement('button');
            btn.className = 'im-mode-btn' + (m.key === this.mode ? ' active' : '');
            btn.dataset.mode = m.key;
            btn.textContent = m.label;
            this._on(btn, 'click', () => this._switchMode(m.key));
            modes.appendChild(btn);
        });
        el.appendChild(modes);

        const params = document.createElement('div');
        params.className = 'im-params';
        params.id = 'im-params';
        el.appendChild(params);
        this._buildModeParams();

        this._updateInfo();
    },

    _buildModeParams() {
        const par = document.getElementById('im-params');
        if (!par) return;
        par.innerHTML = '';

        if (this.mode === 'boiling') {
            const hint = document.createElement('div');
            hint.className = 'im-pick-label';
            hint.textContent = '显示族（点击切换）：';
            par.appendChild(hint);
            const wrap = document.createElement('div');
            wrap.className = 'im-elem-btns';
            this._BP.forEach(g => {
                const btn = document.createElement('button');
                btn.className = 'im-elem-btn' + (this._enabled[g.gid] ? ' active' : '');
                btn.textContent = g.gid;
                btn.style.borderColor = g.color;
                this._on(btn, 'click', () => {
                    this._enabled[g.gid] = !this._enabled[g.gid];
                    btn.classList.toggle('active', this._enabled[g.gid]);
                    this._draw();
                });
                wrap.appendChild(btn);
            });
            par.appendChild(wrap);
            const tip = document.createElement('div');
            tip.className = 'im-pick-tip';
            tip.textContent = '👆 点击折线上的数据点查看沸点与成因';
            par.appendChild(tip);
        } else {
            const hint = document.createElement('div');
            hint.className = 'im-pick-label';
            hint.textContent = '选择含氢键物质：';
            par.appendChild(hint);
            const wrap = document.createElement('div');
            wrap.className = 'im-elem-btns';
            this._HB.forEach(e => {
                const btn = document.createElement('button');
                btn.className = 'im-elem-btn' + (e.id === this._hb ? ' active' : '');
                btn.textContent = e.name;
                this._on(btn, 'click', () => {
                    this._hb = e.id;
                    wrap.querySelectorAll('.im-elem-btn').forEach(b => b.classList.toggle('active', b === btn));
                    this._updateInfo();
                });
                wrap.appendChild(btn);
            });
            par.appendChild(wrap);
        }
    },

    _updateInfo() {
        const el = document.getElementById('im-info');
        if (!el) return;
        if (this.mode === 'boiling') {
            let html = '<div class="im-mode-tag">氢化物沸点趋势</div>';
            if (this._selPt) {
                const g = this._BP.find(x => x.gid === this._selPt.gid);
                const pt = g.pts[this._selPt.idx];
                const isAnom = g.anomaly === this._selPt.idx;
                html += '<div class="im-data-row">物质：<strong>' + pt.f + '</strong>（' + g.gid + '，第 ' + pt.p + ' 周期）</div>' +
                    '<div class="im-data-row">沸点：<strong>' + pt.bp + ' ℃</strong></div>' +
                    '<div class="im-data-row">主要分子间作用：<strong>' + (isAnom ? '氢键 + 范德华力' : '范德华力') + '</strong></div>';
                if (isAnom) html += '<div class="im-tip">⚡ ' + g.note + '</div>';
                else html += '<div class="im-note">' + g.note + '</div>';
            } else {
                html += '<div class="im-tip">💡 ⅣA 族（无氢键）沸点随分子量单调升高；ⅤA/ⅥA/ⅦA 族第 2 周期的 NH₃ / H₂O / HF 因氢键出现“反常”高点。</div>';
            }
            el.innerHTML = html;
        } else {
            const e = this._HB.find(x => x.id === this._hb);
            el.innerHTML =
                '<div class="im-mode-tag">氢键模型</div>' +
                '<div class="im-data-row">物质：<strong>' + e.name + '</strong></div>' +
                '<div class="im-data-row">氢键形式：<strong>' + e.donor + '···' + e.acceptor + '</strong></div>' +
                '<div class="im-data-row">键能数量级：范德华力 ≈ 几 kJ/mol，氢键 ≈ 20~40 kJ/mol，共价键 ≈ 400+ kJ/mol</div>' +
                '<div class="im-tip">⚡ ' + e.note + '</div>';
        }
    },

    _switchMode(m) {
        if (m === this.mode) return;
        this._stopAnim();
        this.mode = m;
        document.querySelectorAll('.im-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
        this._buildModeParams();
        this._updateInfo();
        this._injectEduPanel();
        if (m === 'boiling') this._draw();
        else this._startAnim();
    },

    /* ═══════════════════ 教育面板 ═══════════════════ */
    _injectEduPanel() {
        const el = document.getElementById('im-edu');
        if (!el) return;
        if (this.mode === 'boiling') {
            el.innerHTML =
                '<h4>📚 范德华力 vs 氢键</h4>' +
                '<p><strong>分子间作用力（范德华力）</strong>普遍存在于分子之间，强度比化学键弱得多。一般地，组成和结构相似的物质，<strong>相对分子质量越大，范德华力越强，熔沸点越高</strong>（如 ⅣA 族 CH₄→SnH₄）。</p>' +
                '<ul>' +
                '<li><strong>氢键</strong>：当 H 与电负性大、半径小的 <strong>N、O、F</strong> 相连时，与另一分子中的 N/O/F 形成的特殊作用力，记作 X—H···Y</li>' +
                '<li><strong>“反常”高沸点</strong>：NH₃、H₂O、HF 因分子间氢键，沸点远高于同族其他氢化物</li>' +
                '<li><strong>强弱比较</strong>：共价键 ≫ 氢键 &gt; 范德华力；氢键属于分子间作用力，不是化学键</li>' +
                '<li><strong>影响</strong>：氢键还使物质熔点升高、溶解度增大（如 NH₃、乙醇与水互溶）</li>' +
                '</ul>' +
                '<p class="im-formula">判断口诀：组成结构相似看分子量；出现 N/O/F—H 想氢键。</p>' +
                '<p class="im-tip">💡 H₂O 的沸点（100℃）若按范德华力外推应约 −70℃，氢键把它“抬高”了近 170℃。</p>';
        } else {
            el.innerHTML =
                '<h4>💧 氢键的形成与方向性</h4>' +
                '<p>氢键 <strong>X—H···Y</strong> 中，X、Y 为 N、O、F；H 几乎裸露的质子被相邻分子中 Y 原子的孤对电子吸引，具有一定的 <strong>方向性</strong> 和 <strong>饱和性</strong>。</p>' +
                '<ul>' +
                '<li><strong>水</strong>：每个 H₂O 可形成 4 个氢键 → 立体网络；结冰时网络撑开，<strong>冰的密度小于水</strong>，故冰能浮于水面</li>' +
                '<li><strong>HF</strong>：单个 H—F···F 氢键很强 → 沸点反常高、液态呈锯齿链；水的高沸点还来自多氢键三维网络</li>' +
                '<li><strong>分子内氢键</strong>：如邻羟基苯甲醛，会降低分子间氢键 → 沸点反而较对位异构体低</li>' +
                '<li><strong>生物意义</strong>：DNA 双螺旋靠碱基对氢键维系（A=T 两个、G≡C 三个）；蛋白质二级结构也依赖氢键</li>' +
                '</ul>' +
                '<p class="im-formula">虚线表示氢键（分子间），实线表示共价键（分子内）。</p>' +
                '<p class="im-tip">💡 氢键比共价键弱约一个数量级，却在物性与生命过程中起决定性作用。</p>';
        }
    },

    /* ═══════════════════ 交互：点击数据点 ═══════════════════ */
    _onClick(e) {
        if (this.mode !== 'boiling') return;
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left, y = e.clientY - rect.top;
        let hit = null, best = 196;
        this._ptHits.forEach(p => {
            const d = (p.x - x) ** 2 + (p.y - y) ** 2;
            if (d < best) { best = d; hit = p; }
        });
        if (hit) {
            this._selPt = (this._selPt && this._selPt.gid === hit.gid && this._selPt.idx === hit.idx)
                ? null : { gid: hit.gid, idx: hit.idx };
        } else {
            this._selPt = null;
        }
        this._draw();
        this._updateInfo();
    },

    /* ═══════════════════ Canvas 设置 ═══════════════════ */
    _resize() {
        const c = this.canvas;
        if (!c) return;
        const rect = c.parentElement.getBoundingClientRect();
        const w = rect.width;
        const h = Math.min(Math.max(w * 0.62, 360), 540);
        const dpr = window.devicePixelRatio || 1;
        c.width = w * dpr;
        c.height = h * dpr;
        c.style.width = w + 'px';
        c.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w; this.H = h;
    },

    /* ═══════════════════ 生命周期 ═══════════════════ */
    init() {
        this.canvas = document.getElementById('im-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this._resize();
        this._buildControls();
        this._injectEduPanel();
        this._on(this.canvas, 'click', e => this._onClick(e));
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver(() => {
                this._resize();
                if (this.mode === 'boiling') this._draw();
            });
            this._resizeObs.observe(this.canvas.parentElement);
        }
        if (this.mode === 'boiling') this._draw();
        else this._startAnim();
    },

    destroy() {
        this._stopAnim();
        this._listeners.forEach(l => l.el.removeEventListener(l.evt, l.fn, l.opts));
        this._listeners = [];
        if (this._resizeObs) { this._resizeObs.disconnect(); this._resizeObs = null; }
        this._selPt = null;
    }
};

window.Intermolecular = Intermolecular;
function initIntermolecular() { Intermolecular.init(); }
window.initIntermolecular = initIntermolecular;
