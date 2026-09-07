// ===== 原子结构与电子排布 =====
// 3 模式: 轨道形状 · 电子排布 · 玻尔模型
// 人教版必修一 第4章 / 选择性必修二 第1章

const AtomicStructure = {
    canvas: null, ctx: null, W: 0, H: 0,
    mode: 'orbital',        // 'orbital' | 'config' | 'bohr'
    _listeners: [],
    _resizeObs: null,
    _raf: null,
    _bohrAngle: 0,
    _lastTime: 0,

    /* ── 轨道模式状态 ── */
    _orbital: '1s',
    _orbImg: null,           // 缓存的 ImageData

    /* ── 电子排布/玻尔 模式状态 ── */
    _Z: 6,                   // 原子序数 1-36

    /* ── 元素表 (Z=1-36) ── */
    _EL: [
        '', 'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne',
        'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar',
        'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn',
        'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr'
    ],
    _ELCN: [
        '', '氢', '氦', '锂', '铍', '硼', '碳', '氮', '氧', '氟', '氖',
        '钠', '镁', '铝', '硅', '磷', '硫', '氯', '氩',
        '钾', '钙', '钪', '钛', '钒', '铬', '锰', '铁', '钴', '镍', '铜', '锌',
        '镓', '锗', '砷', '硒', '溴', '氪'
    ],

    /* ── 可选轨道 ── */
    _ORBS: [
        { key: '1s', label: '1s', scale: 6 },
        { key: '2s', label: '2s', scale: 15 },
        { key: '2p_z', label: '2pz', scale: 16 },
        { key: '2p_x', label: '2p\u2093', scale: 16 },
        { key: '3s', label: '3s', scale: 28 },
        { key: '3p_z', label: '3pz', scale: 28 },
        { key: '3d_z2', label: '3dz\u00b2', scale: 38 },
        { key: '3d_xz', label: '3d\u2093z', scale: 38 },
    ],

    /* ── 填充顺序 (Z≤36) ── */
    _FILL: [
        { name: '1s', boxes: 1, max: 2 },
        { name: '2s', boxes: 1, max: 2 },
        { name: '2p', boxes: 3, max: 6 },
        { name: '3s', boxes: 1, max: 2 },
        { name: '3p', boxes: 3, max: 6 },
        { name: '4s', boxes: 1, max: 2 },
        { name: '3d', boxes: 5, max: 10 },
        { name: '4p', boxes: 3, max: 6 },
    ],

    /* ── 颜色 ── */
    _COL: {
        bg: '#0a0e1a',
        accent: '#4d9e7e',
        text: '#e0e0e0',
        dim: '#888',
        boxBorder: 'rgba(77,158,126,0.5)',
        boxFill: 'rgba(77,158,126,0.08)',
        arrowUp: '#4ecdc4',
        arrowDn: '#ff6b6b',
        shell: ['#4ecdc4', '#ffd93d', '#ff6b6b', '#b8e986'],
        nucleus: '#ffd93d',
    },

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    /* ═══════════════════ 波函数 ═══════════════════ */
    _psi(key, r, cosT, sinT, signX) {
        if (r < 1e-10) return 0;
        let R, Y;
        switch (key) {
            case '1s':
                R = 2 * Math.exp(-r);
                Y = 1; break;
            case '2s':
                R = (1 / 1.414) * (2 - r) * Math.exp(-r / 2);
                Y = 1; break;
            case '2p_z':
                R = (1 / 4.899) * r * Math.exp(-r / 2);
                Y = cosT; break;
            case '2p_x':
                R = (1 / 4.899) * r * Math.exp(-r / 2);
                Y = sinT * signX; break;
            case '3s':
                R = (2 / 140.3) * (27 - 18 * r + 2 * r * r) * Math.exp(-r / 3);
                Y = 1; break;
            case '3p_z':
                R = (8 / 66.14) * r * (6 - r) * Math.exp(-r / 3);
                Y = cosT; break;
            case '3d_z2':
                R = (4 / 1476.4) * r * r * Math.exp(-r / 3);
                Y = 3 * cosT * cosT - 1; break;
            case '3d_xz':
                R = (4 / 1476.4) * r * r * Math.exp(-r / 3);
                Y = sinT * cosT * signX; break;
            default: return 0;
        }
        return R * Y;
    },

    /* ── 计算轨道密度图 ── */
    _computeOrbitalImg() {
        const orb = this._ORBS.find(o => o.key === this._orbital);
        if (!orb) return;
        const gs = Math.min(180, Math.min(this.W, this.H));
        if (gs < 10) return;
        const scale = orb.scale;
        const data = new Float32Array(gs * gs);
        let mx = 0;
        for (let j = 0; j < gs; j++) {
            for (let i = 0; i < gs; i++) {
                const x = (i / gs - 0.5) * 2 * scale;
                const z = -(j / gs - 0.5) * 2 * scale;
                const r = Math.sqrt(x * x + z * z);
                if (r < 0.01) { data[j * gs + i] = 0; continue; }
                const cosT = z / r;
                const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
                const signX = x >= 0 ? 1 : -1;
                const v = this._psi(this._orbital, r, cosT, sinT, signX);
                const d = v * v;
                data[j * gs + i] = d;
                if (d > mx) mx = d;
            }
        }
        // 转成 ImageData
        const img = this.ctx.createImageData(gs, gs);
        for (let k = 0; k < gs * gs; k++) {
            const t = mx > 0 ? data[k] / mx : 0;
            const g = Math.pow(t, 0.35); // gamma 提亮弱区域
            const idx = k * 4;
            if (g < 0.01) {
                img.data[idx] = 10; img.data[idx + 1] = 14; img.data[idx + 2] = 26; img.data[idx + 3] = 0;
            } else if (g < 0.3) {
                const s = g / 0.3;
                img.data[idx] = 10 + 20 * s | 0;
                img.data[idx + 1] = 20 + 50 * s | 0;
                img.data[idx + 2] = 60 + 100 * s | 0;
                img.data[idx + 3] = 80 + 120 * s | 0;
            } else if (g < 0.6) {
                const s = (g - 0.3) / 0.3;
                img.data[idx] = 30 + 50 * s | 0;
                img.data[idx + 1] = 70 + 110 * s | 0;
                img.data[idx + 2] = 160 + 60 * s | 0;
                img.data[idx + 3] = 200 + 40 * s | 0;
            } else {
                const s = (g - 0.6) / 0.4;
                img.data[idx] = 80 + 175 * s | 0;
                img.data[idx + 1] = 180 + 75 * s | 0;
                img.data[idx + 2] = 220 + 35 * s | 0;
                img.data[idx + 3] = 240 + 15 * s | 0;
            }
        }
        this._orbImg = { img, gs };
    },

    /* ═══════════════════ 电子排布计算 ═══════════════════ */
    _fillBoxes(n, boxes) {
        const b = new Array(boxes).fill(0);
        let rem = n;
        for (let i = 0; i < boxes && rem > 0; i++) { b[i] = 1; rem--; }
        for (let i = 0; i < boxes && rem > 0; i++) { b[i] = 2; rem--; }
        return b;
    },

    _getConfig(Z) {
        // Cr(24): [Ar]3d⁵4s¹, Cu(29): [Ar]3d¹⁰4s¹
        let rem = Z;
        const cfg = [];
        const fill = this._FILL;
        // 特殊处理 Cr/Cu
        const special = {};
        if (Z === 24) { special['4s'] = 1; special['3d'] = 5; }
        if (Z === 29) { special['4s'] = 1; special['3d'] = 10; }
        for (const f of fill) {
            if (rem <= 0) break;
            let n;
            if (special[f.name] !== undefined) {
                n = special[f.name];
            } else {
                n = Math.min(rem, f.max);
            }
            cfg.push({ name: f.name, boxes: f.boxes, electrons: n, boxState: this._fillBoxes(n, f.boxes) });
            rem -= n;
        }
        return cfg;
    },

    _configNotation(Z) {
        const cfg = this._getConfig(Z);
        return cfg.map(c => c.name + (c.electrons < 10 ? '\u2070\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079'[c.electrons] : '\u00b9\u2070')).join(' ');
    },
    _configNotationStr(Z) {
        const sup = ['\u2070', '\u00b9', '\u00b2', '\u00b3', '\u2074', '\u2075', '\u2076', '\u2077', '\u2078', '\u2079', '\u00b9\u2070'];
        const cfg = this._getConfig(Z);
        return cfg.map(c => c.name + (sup[c.electrons] || c.electrons)).join(' ');
    },

    /* ═══════════════════ 玻尔模型壳层 ═══════════════════ */
    _getShells(Z) {
        if (Z <= 0) return [];
        if (Z <= 2) return [Z];
        if (Z <= 10) return [2, Z - 2];
        if (Z <= 18) return [2, 8, Z - 10];
        if (Z <= 20) return [2, 8, 8, Z - 18];
        // Z=21-36: d 电子进入 M 层
        let nN;
        if (Z === 24 || Z === 29) nN = 1;
        else if (Z <= 30) nN = 2;
        else nN = Z - 28;
        const nM = Z - 2 - 8 - nN;
        return [2, 8, nM, nN];
    },

    /* ═══════════════════ 绘制 ═══════════════════ */
    _draw() {
        const { ctx, W, H } = this;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = this._COL.bg;
        ctx.fillRect(0, 0, W, H);
        if (this.mode === 'orbital') this._drawOrbital();
        else if (this.mode === 'config') this._drawConfig();
        else this._drawBohr();
    },

    /* ── 轨道形状 ── */
    _drawOrbital() {
        const { ctx, W, H, _orbImg } = this;
        if (!_orbImg) return;
        const { img, gs } = _orbImg;
        // 用离屏 canvas 缩放
        const oc = document.createElement('canvas');
        oc.width = gs; oc.height = gs;
        oc.getContext('2d').putImageData(img, 0, 0);
        const size = Math.min(W, H) * 0.88;
        const ox = (W - size) / 2, oy = (H - size) / 2;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(oc, ox, oy, size, size);

        // 坐标轴
        const cx = W / 2, cy = H / 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(ox, cy); ctx.lineTo(ox + size, cy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx, oy); ctx.lineTo(cx, oy + size); ctx.stroke();
        ctx.setLineDash([]);

        // 轴标签
        ctx.fillStyle = this._COL.dim;
        ctx.font = '13px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('x', ox + size - 8, cy - 6);
        ctx.fillText('z', cx + 10, oy + 14);

        // 轨道标签
        const orb = this._ORBS.find(o => o.key === this._orbital);
        ctx.fillStyle = this._COL.accent;
        ctx.font = 'bold 18px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText(orb ? orb.label : this._orbital, 16, 28);

        // 量子数
        const o = this._ORBS.find(ob => ob.key === this._orbital);
        const qn = this._getQuantumNumbers(this._orbital);
        ctx.fillStyle = this._COL.dim;
        ctx.font = '13px ' + CF.mono;
        ctx.fillText('n=' + qn.n + '  l=' + qn.l + '  m=' + qn.m, 16, 48);

        // 节面信息
        ctx.fillStyle = 'rgba(255,200,50,0.7)';
        ctx.font = '12px ' + CF.sans;
        const nodes = qn.n - qn.l - 1;
        ctx.fillText('径向节面: ' + nodes + '  角向节面: ' + qn.l, 16, H - 12);
    },

    _getQuantumNumbers(key) {
        const map = {
            '1s': { n: 1, l: 0, m: 0 }, '2s': { n: 2, l: 0, m: 0 },
            '2p_z': { n: 2, l: 1, m: 0 }, '2p_x': { n: 2, l: 1, m: 1 },
            '3s': { n: 3, l: 0, m: 0 }, '3p_z': { n: 3, l: 1, m: 0 },
            '3d_z2': { n: 3, l: 2, m: 0 }, '3d_xz': { n: 3, l: 2, m: 1 },
        };
        return map[key] || { n: 0, l: 0, m: 0 };
    },

    /* ── 电子排布 ── */
    _drawConfig() {
        const { ctx, W, H, _Z } = this;
        const cfg = this._getConfig(_Z);
        const el = this._EL[_Z] || '';
        const cn = this._ELCN[_Z] || '';

        // 标题
        ctx.fillStyle = this._COL.accent;
        ctx.font = 'bold 16px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText(el + ' (' + cn + ')  Z=' + _Z, W / 2, 26);
        ctx.fillStyle = this._COL.text;
        ctx.font = '13px ' + CF.mono;
        ctx.fillText(this._configNotationStr(_Z), W / 2, 46);

        // 绘制能级盒子
        const pad = 16;
        const boxW = 28, boxH = 36, gap = 6;
        const levels = cfg.length;
        const totalH = levels * (boxH + 20);
        const startY = Math.min(H - pad - 30, (H + totalH) / 2);

        // 能量轴
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        const axX = pad + 10;
        ctx.beginPath(); ctx.moveTo(axX, 60); ctx.lineTo(axX, startY + 10); ctx.stroke();
        ctx.fillStyle = this._COL.dim;
        ctx.font = '11px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.save(); ctx.translate(axX - 2, (60 + startY) / 2);
        ctx.rotate(-Math.PI / 2); ctx.fillText('能量 ↑', 0, 0);
        ctx.restore();

        const labelX = pad + 36;
        const boxStartX = labelX + 32;

        for (let i = 0; i < levels; i++) {
            const c = cfg[i];
            const y = startY - i * (boxH + 20);
            // 能级标签
            ctx.fillStyle = this._COL.dim;
            ctx.font = '13px ' + CF.mono;
            ctx.textAlign = 'right';
            ctx.fillText(c.name, labelX + 24, y + boxH / 2 + 4);

            // 盒子
            for (let b = 0; b < c.boxes; b++) {
                const bx = boxStartX + b * (boxW + gap);
                ctx.strokeStyle = this._COL.boxBorder;
                ctx.lineWidth = 1.5;
                ctx.fillStyle = this._COL.boxFill;
                ctx.fillRect(bx, y, boxW, boxH);
                ctx.strokeRect(bx, y, boxW, boxH);

                // 箭头
                const state = c.boxState[b];
                const mid = bx + boxW / 2;
                if (state >= 1) this._drawArrow(mid - 5, y + boxH - 6, y + 6, this._COL.arrowUp, true);
                if (state >= 2) this._drawArrow(mid + 5, y + boxH - 6, y + 6, this._COL.arrowDn, false);
            }
        }

        // 特殊标注
        if (_Z === 24 || _Z === 29) {
            ctx.fillStyle = 'rgba(255,200,50,0.8)';
            ctx.font = '12px ' + CF.sans;
            ctx.textAlign = 'center';
            const txt = _Z === 24 ? '⚠ Cr 例外: 3d⁵4s¹（半满稳定）' : '⚠ Cu 例外: 3d¹⁰4s¹（全满稳定）';
            ctx.fillText(txt, W / 2, H - 10);
        }
    },

    _drawArrow(x, y1, y2, color, isUp) {
        const ctx = this.ctx;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke();
        // 箭头
        const tipY = isUp ? y2 : y1;
        const dir = isUp ? 1 : -1;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x, tipY);
        ctx.lineTo(x - 4, tipY + dir * 7);
        ctx.lineTo(x + 4, tipY + dir * 7);
        ctx.closePath(); ctx.fill();
    },

    /* ── 玻尔模型 ── */
    _drawBohr() {
        const { ctx, W, H, _Z } = this;
        const shells = this._getShells(_Z);
        const el = this._EL[_Z] || '';
        const cx = W / 2, cy = H / 2;
        const maxR = Math.min(W, H) * 0.42;
        const nShells = shells.length;
        const shellNames = ['K', 'L', 'M', 'N'];

        // 核
        const nucR = 18;
        const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, nucR);
        grd.addColorStop(0, '#ffe066');
        grd.addColorStop(1, '#cc8800');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(cx, cy, nucR, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#222';
        ctx.font = 'bold 13px ' + CF.sans;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(el, cx, cy);

        // 壳层 + 电子
        for (let s = 0; s < nShells; s++) {
            const r = nucR + 20 + (maxR - nucR - 20) * (s + 1) / (nShells + 0.5);
            // 轨道圆
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
            // 壳层标签
            ctx.fillStyle = this._COL.dim;
            ctx.font = '11px ' + CF.sans;
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillText(shellNames[s] + '(' + shells[s] + ')', cx + r + 6, cy);

            // 电子
            const ne = shells[s];
            const col = this._COL.shell[s % this._COL.shell.length];
            for (let e = 0; e < ne; e++) {
                const a = this._bohrAngle * (1 - s * 0.15) + (Math.PI * 2 * e) / ne;
                const ex = cx + r * Math.cos(a);
                const ey = cy + r * Math.sin(a);
                // 发光
                ctx.fillStyle = col;
                ctx.shadowColor = col;
                ctx.shadowBlur = 8;
                ctx.beginPath(); ctx.arc(ex, ey, 4, 0, Math.PI * 2); ctx.fill();
                ctx.shadowBlur = 0;
            }
        }

        // 元素信息
        ctx.fillStyle = this._COL.accent;
        ctx.font = 'bold 15px ' + CF.sans;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(el + ' (' + this._ELCN[_Z] + ')  Z=' + _Z, cx, 12);
        ctx.fillStyle = this._COL.dim;
        ctx.font = '12px ' + CF.sans;
        ctx.fillText('电子层: ' + shells.join(', '), cx, 32);
    },

    /* ── 玻尔动画循环 ── */
    _animate(ts) {
        if (!this._lastTime) this._lastTime = ts;
        const dt = (ts - this._lastTime) / 1000;
        this._lastTime = ts;
        this._bohrAngle += dt * 0.8;
        this._draw();
        this._raf = requestAnimationFrame(t => this._animate(t));
    },

    _startBohrAnim() {
        if (this._raf) return;
        this._lastTime = 0;
        this._raf = requestAnimationFrame(t => this._animate(t));
    },

    _stopAnim() {
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    },

    /* ═══════════════════ 控件 ═══════════════════ */
    _buildControls() {
        const el = document.getElementById('as-controls');
        if (!el) return;
        el.innerHTML = '';

        // 模式按钮
        const modes = document.createElement('fieldset');
        modes.className = 'as-mode-btns';
        modes.setAttribute('role', 'group');
        modes.setAttribute('aria-label', '模式选择');
        [
            { key: 'orbital', label: '⚛ 轨道形状' },
            { key: 'config', label: '📊 电子排布' },
            { key: 'bohr', label: '🔬 玻尔模型' },
        ].forEach(m => {
            const btn = document.createElement('button');
            btn.className = 'as-mode-btn' + (m.key === this.mode ? ' active' : '');
            btn.dataset.mode = m.key;
            btn.textContent = m.label;
            this._on(btn, 'click', () => this._switchMode(m.key));
            modes.appendChild(btn);
        });
        el.appendChild(modes);

        // 模式特定参数
        const params = document.createElement('div');
        params.className = 'as-params';
        params.id = 'as-params';
        el.appendChild(params);
        this._buildModeParams();

        // 信息区
        const info = document.createElement('div');
        info.className = 'as-info';
        info.id = 'as-info';
        el.appendChild(info);
        this._updateInfo();
    },

    _buildModeParams() {
        const par = document.getElementById('as-params');
        if (!par) return;
        par.innerHTML = '';

        if (this.mode === 'orbital') {
            // 轨道选择按钮
            const wrap = document.createElement('div');
            wrap.className = 'as-orbital-btns';
            this._ORBS.forEach(o => {
                const btn = document.createElement('button');
                btn.className = 'as-orb-btn' + (o.key === this._orbital ? ' active' : '');
                btn.textContent = o.label;
                this._on(btn, 'click', () => {
                    this._orbital = o.key;
                    wrap.querySelectorAll('.as-orb-btn').forEach(b => b.classList.toggle('active', b.textContent === o.label));
                    this._computeOrbitalImg();
                    this._draw();
                    this._updateInfo();
                });
                wrap.appendChild(btn);
            });
            par.appendChild(wrap);
        } else {
            // 原子序数滑块
            this._buildSlider(par, '原子序数 Z', this._Z, 1, 36, 1, v => {
                this._Z = v;
                this._draw();
                this._updateInfo();
            }, v => {
                const s = this._EL[v] || '';
                return v + ' (' + s + ')';
            });
        }
    },

    _buildSlider(parent, label, val, min, max, step, onChange, fmt) {
        const row = document.createElement('div');
        row.className = 'as-slider-row';
        const lbl = document.createElement('div');
        lbl.className = 'as-label';
        const valSpan = document.createElement('strong');
        valSpan.textContent = fmt ? fmt(val) : val;
        lbl.innerHTML = label + ' = ';
        lbl.appendChild(valSpan);
        const slider = document.createElement('input');
        slider.type = 'range'; slider.className = 'as-slider';
        slider.min = min; slider.max = max; slider.step = step; slider.value = val;
        this._on(slider, 'input', () => {
            const v = +slider.value;
            valSpan.textContent = fmt ? fmt(v) : v;
            onChange(v);
        });
        row.appendChild(lbl);
        row.appendChild(slider);
        parent.appendChild(row);
    },

    _updateInfo() {
        const el = document.getElementById('as-info');
        if (!el) return;
        if (this.mode === 'orbital') {
            const qn = this._getQuantumNumbers(this._orbital);
            el.innerHTML =
                '<div class="as-mode-tag">轨道形状</div>' +
                '<div class="as-data-row">主量子数 n = <strong>' + qn.n + '</strong></div>' +
                '<div class="as-data-row">角量子数 l = <strong>' + qn.l + '</strong></div>' +
                '<div class="as-data-row">磁量子数 m = <strong>' + qn.m + '</strong></div>' +
                '<div class="as-tip">💡 |ψ|² 表示电子出现概率密度</div>';
        } else if (this.mode === 'config') {
            const cfg = this._configNotationStr(this._Z);
            const totalE = this._Z;
            let note = '';
            if (this._Z === 24) note = '<div class="as-tip">⚠ Cr 例外: 半满 3d⁵ 更稳定</div>';
            else if (this._Z === 29) note = '<div class="as-tip">⚠ Cu 例外: 全满 3d¹⁰ 更稳定</div>';
            el.innerHTML =
                '<div class="as-mode-tag">电子排布</div>' +
                '<div class="as-data-row">' + this._EL[this._Z] + ' (' + this._ELCN[this._Z] + ')  Z=' + this._Z + '</div>' +
                '<div class="as-data-row"><strong>' + cfg + '</strong></div>' +
                '<div class="as-data-row">总电子数: ' + totalE + '</div>' + note;
        } else {
            const shells = this._getShells(this._Z);
            el.innerHTML =
                '<div class="as-mode-tag">玻尔模型</div>' +
                '<div class="as-data-row">' + this._EL[this._Z] + ' (' + this._ELCN[this._Z] + ')  Z=' + this._Z + '</div>' +
                '<div class="as-data-row">电子层分布: ' + shells.join(', ') + '</div>' +
                '<div class="as-tip">💡 电子层容量: K=2, L=8, M=18, N=32</div>';
        }
    },

    _switchMode(m) {
        if (m === this.mode) return;
        this._stopAnim();
        this.mode = m;
        document.querySelectorAll('.as-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
        this._buildModeParams();
        this._updateInfo();
        this._injectEduPanel();
        if (m === 'orbital') {
            this._computeOrbitalImg();
            this._draw();
        } else if (m === 'bohr') {
            this._startBohrAnim();
        } else {
            this._draw();
        }
    },

    /* ═══════════════════ 教育面板 ═══════════════════ */
    _injectEduPanel() {
        const el = document.getElementById('as-edu');
        if (!el) return;
        el.innerHTML =
            '<h4>📚 原子结构与电子排布</h4>' +
            '<p>原子核外电子按<strong>能级</strong>排列在不同轨道上，遵循三大规则：</p>' +
            '<ul>' +
            '<li><strong>泡利不相容原理</strong>：每个轨道最多容纳 2 个自旋相反的电子</li>' +
            '<li><strong>能量最低原理</strong>（构造原理）：电子优先填入能量较低的轨道（1s→2s→2p→3s→…）</li>' +
            '<li><strong>洪特规则</strong>：等价轨道中电子尽量分占不同轨道且自旋平行</li>' +
            '</ul>' +
            '<p class="as-formula">轨道角动量: L = √(l(l+1))·ℏ &nbsp;&nbsp; 磁量子数: m = -l, ..., +l</p>' +
            '<p class="as-tip">💡 Cr(24) 和 Cu(29) 是常见的"反常"电子排布——半满/全满 d 轨道额外稳定</p>';
    },

    /* ═══════════════════ Canvas 设置 ═══════════════════ */
    _resize() {
        const c = this.canvas;
        if (!c) return;
        const rect = c.parentElement.getBoundingClientRect();
        const w = rect.width;
        const h = Math.min(w * 0.65, 520);
        const dpr = window.devicePixelRatio || 1;
        c.width = w * dpr;
        c.height = h * dpr;
        c.style.width = w + 'px';
        c.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w;
        this.H = h;
    },

    /* ═══════════════════ 生命周期 ═══════════════════ */
    init() {
        this.canvas = document.getElementById('as-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this._resize();
        this._buildControls();
        this._injectEduPanel();
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver(() => {
                this._resize();
                if (this.mode === 'orbital') { this._computeOrbitalImg(); this._draw(); }
                else if (this.mode !== 'bohr') this._draw();
            });
            this._resizeObs.observe(this.canvas.parentElement);
        }
        // 初始绘制
        this._computeOrbitalImg();
        this._draw();
    },

    destroy() {
        this._stopAnim();
        this._listeners.forEach(l => l.el.removeEventListener(l.evt, l.fn, l.opts));
        this._listeners = [];
        if (this._resizeObs) { this._resizeObs.disconnect(); this._resizeObs = null; }
        this._orbImg = null;
    }
};

window.AtomicStructure = AtomicStructure;
function initAtomicStructure() { AtomicStructure.init(); }
window.initAtomicStructure = initAtomicStructure;
