// ===== 元素化合物 =====
// 双模式：价-类二维图（Na/Fe/Al/Cl/N/S 转化网络） · 焰色反应模拟
// 人教版必修一 第3章 / 必修二 第3章

const ElementCompounds = {
    canvas: null, ctx: null, W: 0, H: 0,
    mode: 'diagram',          // 'diagram' | 'flame'
    _listeners: [],
    _resizeObs: null,
    _raf: null,
    _lastTime: 0,

    /* ── 价类二维图状态 ── */
    _elem: 'Na',
    _selNode: null,
    _nodeBoxes: {},           // id -> {x,y,w,h}

    /* ── 焰色反应状态 ── */
    _metal: 'Na',
    _particles: [],
    _flameT: 0,

    _COL: {
        accent: '#4d9e7e',
        amber: '#e5c07b',
        text: '#e6e6e6',
        dim: '#8a8a8a',
        line: 'rgba(255,255,255,.12)',
        nodeFill: 'rgba(77,158,126,.10)',
        nodeBorder: 'rgba(77,158,126,.45)',
    },

    /* ── 物质类别列（金属 / 非金属共用 5 列）── */
    _CATS_METAL: ['单质', '氢化物', '氧化物', '碱', '盐'],
    _CATS_NONMETAL: ['单质', '氢化物', '氧化物', '含氧酸', '盐'],

    /* ═══════════════════ 元素数据 ═══════════════════ */
    _DATA: {
        Na: {
            name: '钠', kind: 'metal', sub: 'ⅠA 活泼金属',
            vals: ['+1', '0'],
            species: [
                { id: 'na', f: 'Na', cat: 0, vi: 1 },
                { id: 'na2o', f: 'Na₂O', cat: 2, vi: 0 },
                { id: 'na2o2', f: 'Na₂O₂', cat: 2, vi: 0, note: '过氧化物' },
                { id: 'naoh', f: 'NaOH', cat: 3, vi: 0 },
                { id: 'nacl', f: 'NaCl', cat: 4, vi: 0 },
                { id: 'na2co3', f: 'Na₂CO₃', cat: 4, vi: 0 },
                { id: 'nahco3', f: 'NaHCO₃', cat: 4, vi: 0 },
            ],
            rxns: [
                { from: 'na', to: 'na2o', eq: '4Na + O₂ = 2Na₂O', cond: '常温', phenom: '银白色变暗（缓慢氧化）' },
                { from: 'na', to: 'na2o2', eq: '2Na + O₂ →(点燃) Na₂O₂', cond: '点燃', phenom: '黄色火焰，生成淡黄色固体' },
                { from: 'na', to: 'naoh', eq: '2Na + 2H₂O = 2NaOH + H₂↑', cond: '与水', phenom: '浮、熔、游、响、红（酚酞变红）' },
                { from: 'na2o', to: 'naoh', eq: 'Na₂O + H₂O = 2NaOH', cond: '—', phenom: '放热，碱性氧化物' },
                { from: 'na2o2', to: 'naoh', eq: '2Na₂O₂ + 2H₂O = 4NaOH + O₂↑', cond: '—', phenom: '放出 O₂（既是氧化剂又是还原剂）' },
                { from: 'naoh', to: 'na2co3', eq: '2NaOH + CO₂ = Na₂CO₃ + H₂O', cond: 'CO₂ 少量', phenom: '生成正盐' },
                { from: 'na2co3', to: 'nahco3', eq: 'Na₂CO₃ + CO₂ + H₂O = 2NaHCO₃', cond: 'CO₂ 足量', phenom: '正盐转酸式盐' },
                { from: 'nahco3', to: 'na2co3', eq: '2NaHCO₃ →(Δ) Na₂CO₃ + H₂O↑ + CO₂↑', cond: '加热', phenom: '小苏打受热分解' },
            ],
        },
        Fe: {
            name: '铁', kind: 'metal', sub: 'Ⅷ族 变价金属',
            vals: ['+3', '+2', '0'],
            species: [
                { id: 'fe', f: 'Fe', cat: 0, vi: 2 },
                { id: 'feo', f: 'FeO', cat: 2, vi: 1 },
                { id: 'fe2o3', f: 'Fe₂O₃', cat: 2, vi: 0 },
                { id: 'fe3o4', f: 'Fe₃O₄', cat: 2, vi: 0, note: 'FeO·Fe₂O₃ 混合价' },
                { id: 'feoh2', f: 'Fe(OH)₂', cat: 3, vi: 1 },
                { id: 'feoh3', f: 'Fe(OH)₃', cat: 3, vi: 0 },
                { id: 'fecl2', f: 'FeCl₂', cat: 4, vi: 1 },
                { id: 'fecl3', f: 'FeCl₃', cat: 4, vi: 0 },
            ],
            rxns: [
                { from: 'fe', to: 'fe3o4', eq: '3Fe + 2O₂ →(点燃) Fe₃O₄', cond: '点燃', phenom: '剧烈燃烧，火星四射' },
                { from: 'fe', to: 'fecl2', eq: 'Fe + 2HCl = FeCl₂ + H₂↑', cond: '非氧化性酸', phenom: '浅绿色溶液（Fe²⁺）' },
                { from: 'fe', to: 'fecl3', eq: '2Fe + 3Cl₂ →(点燃) 2FeCl₃', cond: '与 Cl₂', phenom: '棕褐色烟（强氧化剂→+3）' },
                { from: 'fecl2', to: 'fecl3', eq: '2FeCl₂ + Cl₂ = 2FeCl₃', cond: '被氧化', phenom: '浅绿变棕黄（Fe²⁺→Fe³⁺）' },
                { from: 'fecl3', to: 'fecl2', eq: '2FeCl₃ + Fe = 3FeCl₂', cond: '被还原', phenom: '棕黄变浅绿' },
                { from: 'fecl2', to: 'feoh2', eq: 'FeCl₂ + 2NaOH = Fe(OH)₂↓ + 2NaCl', cond: '与碱', phenom: '白色沉淀（迅速变色）' },
                { from: 'feoh2', to: 'feoh3', eq: '4Fe(OH)₂ + O₂ + 2H₂O = 4Fe(OH)₃', cond: '空气中', phenom: '白→灰绿→红棕' },
                { from: 'fecl3', to: 'feoh3', eq: 'FeCl₃ + 3NaOH = Fe(OH)₃↓ + 3NaCl', cond: '与碱', phenom: '红褐色沉淀' },
                { from: 'feoh3', to: 'fe2o3', eq: '2Fe(OH)₃ →(Δ) Fe₂O₃ + 3H₂O', cond: '加热分解', phenom: '红褐色固体→红棕色粉末' },
            ],
        },
        Al: {
            name: '铝', kind: 'metal', sub: 'ⅢA 两性金属',
            vals: ['+3', '0'],
            species: [
                { id: 'al', f: 'Al', cat: 0, vi: 1 },
                { id: 'al2o3', f: 'Al₂O₃', cat: 2, vi: 0 },
                { id: 'aloh3', f: 'Al(OH)₃', cat: 3, vi: 0 },
                { id: 'alcl3', f: 'AlCl₃', cat: 4, vi: 0 },
                { id: 'naalo2', f: 'NaAlO₂', cat: 4, vi: 0, note: '偏铝酸钠' },
            ],
            rxns: [
                { from: 'al', to: 'al2o3', eq: '4Al + 3O₂ = 2Al₂O₃', cond: '常温', phenom: '生成致密氧化膜，抗腐蚀' },
                { from: 'al', to: 'alcl3', eq: '2Al + 6HCl = 2AlCl₃ + 3H₂↑', cond: '与酸', phenom: '放出 H₂' },
                { from: 'al', to: 'naalo2', eq: '2Al + 2NaOH + 2H₂O = 2NaAlO₂ + 3H₂↑', cond: '与强碱', phenom: '放出 H₂（铝的两性）' },
                { from: 'al2o3', to: 'alcl3', eq: 'Al₂O₃ + 6HCl = 2AlCl₃ + 3H₂O', cond: '与酸', phenom: '两性氧化物溶解' },
                { from: 'al2o3', to: 'naalo2', eq: 'Al₂O₃ + 2NaOH = 2NaAlO₂ + H₂O', cond: '与强碱', phenom: '两性氧化物溶解' },
                { from: 'alcl3', to: 'aloh3', eq: 'AlCl₃ + 3NH₃·H₂O = Al(OH)₃↓ + 3NH₄Cl', cond: '用弱碱氨水', phenom: '白色胶状沉淀（不溶于弱碱）' },
                { from: 'aloh3', to: 'naalo2', eq: 'Al(OH)₃ + NaOH = NaAlO₂ + 2H₂O', cond: '与强碱', phenom: '两性氢氧化物溶解' },
                { from: 'aloh3', to: 'alcl3', eq: 'Al(OH)₃ + 3HCl = AlCl₃ + 3H₂O', cond: '与酸', phenom: '溶解' },
                { from: 'aloh3', to: 'al2o3', eq: '2Al(OH)₃ →(Δ) Al₂O₃ + 3H₂O', cond: '加热分解', phenom: '—' },
            ],
        },
        Cl: {
            name: '氯', kind: 'nonmetal', sub: 'ⅦA 活泼非金属',
            vals: ['+1', '0', '-1'],
            species: [
                { id: 'cl2', f: 'Cl₂', cat: 0, vi: 1 },
                { id: 'hcl', f: 'HCl', cat: 1, vi: 2 },
                { id: 'hclo', f: 'HClO', cat: 3, vi: 0 },
                { id: 'nacl', f: 'NaCl', cat: 4, vi: 2 },
                { id: 'naclo', f: 'NaClO', cat: 4, vi: 0 },
            ],
            rxns: [
                { from: 'cl2', to: 'hcl', eq: 'H₂ + Cl₂ →(点燃) 2HCl', cond: '点燃/光照', phenom: '苍白色火焰，瓶口白雾' },
                { from: 'cl2', to: 'hclo', eq: 'Cl₂ + H₂O ⇌ HCl + HClO', cond: '溶于水', phenom: '部分反应，HClO 具漂白性' },
                { from: 'cl2', to: 'naclo', eq: 'Cl₂ + 2NaOH = NaCl + NaClO + H₂O', cond: '与碱', phenom: '制漂白液（歧化反应）' },
                { from: 'cl2', to: 'nacl', eq: '2Na + Cl₂ →(点燃) 2NaCl', cond: '与金属', phenom: '黄色火焰，白烟' },
                { from: 'hclo', to: 'hcl', eq: '2HClO →(光照) 2HCl + O₂↑', cond: '见光分解', phenom: 'HClO 不稳定' },
            ],
        },
        N: {
            name: '氮', kind: 'nonmetal', sub: 'ⅤA 多价非金属',
            vals: ['+5', '+4', '+2', '0', '-3'],
            species: [
                { id: 'n2', f: 'N₂', cat: 0, vi: 3 },
                { id: 'nh3', f: 'NH₃', cat: 1, vi: 4 },
                { id: 'no', f: 'NO', cat: 2, vi: 2 },
                { id: 'no2', f: 'NO₂', cat: 2, vi: 1 },
                { id: 'hno3', f: 'HNO₃', cat: 3, vi: 0 },
                { id: 'nh4cl', f: 'NH₄Cl', cat: 4, vi: 4 },
            ],
            rxns: [
                { from: 'n2', to: 'nh3', eq: 'N₂ + 3H₂ ⇌(高温高压催化剂) 2NH₃', cond: '工业合成氨', phenom: '可逆反应' },
                { from: 'n2', to: 'no', eq: 'N₂ + O₂ →(放电) 2NO', cond: '雷电/高温', phenom: '生成无色 NO' },
                { from: 'no', to: 'no2', eq: '2NO + O₂ = 2NO₂', cond: '常温', phenom: '无色→红棕色' },
                { from: 'no2', to: 'hno3', eq: '3NO₂ + H₂O = 2HNO₃ + NO', cond: '工业制硝酸', phenom: '红棕色气体溶解' },
                { from: 'nh3', to: 'no', eq: '4NH₃ + 5O₂ →(催化剂Δ) 4NO + 6H₂O', cond: '氨的催化氧化', phenom: '制硝酸的关键一步' },
                { from: 'nh3', to: 'nh4cl', eq: 'NH₃ + HCl = NH₄Cl', cond: '与酸', phenom: '产生白烟' },
            ],
        },
        S: {
            name: '硫', kind: 'nonmetal', sub: 'ⅥA 多价非金属',
            vals: ['+6', '+4', '0', '-2'],
            species: [
                { id: 's', f: 'S', cat: 0, vi: 2 },
                { id: 'h2s', f: 'H₂S', cat: 1, vi: 3 },
                { id: 'so2', f: 'SO₂', cat: 2, vi: 1 },
                { id: 'so3', f: 'SO₃', cat: 2, vi: 0 },
                { id: 'h2so3', f: 'H₂SO₃', cat: 3, vi: 1 },
                { id: 'h2so4', f: 'H₂SO₄', cat: 3, vi: 0 },
                { id: 'na2so3', f: 'Na₂SO₃', cat: 4, vi: 1 },
                { id: 'na2so4', f: 'Na₂SO₄', cat: 4, vi: 0 },
            ],
            rxns: [
                { from: 's', to: 'so2', eq: 'S + O₂ →(点燃) SO₂', cond: '点燃', phenom: '蓝紫色火焰' },
                { from: 's', to: 'h2s', eq: 'H₂ + S →(Δ) H₂S', cond: '加热', phenom: '生成臭鸡蛋气味气体' },
                { from: 'so2', to: 'so3', eq: '2SO₂ + O₂ ⇌(催化剂Δ) 2SO₃', cond: '接触氧化', phenom: '可逆反应（工业制硫酸）' },
                { from: 'so2', to: 'h2so3', eq: 'SO₂ + H₂O = H₂SO₃', cond: '溶于水', phenom: '生成亚硫酸（中强酸）' },
                { from: 'so3', to: 'h2so4', eq: 'SO₃ + H₂O = H₂SO₄', cond: '—', phenom: '放出大量热' },
                { from: 'h2so3', to: 'na2so3', eq: 'H₂SO₃ + 2NaOH = Na₂SO₃ + 2H₂O', cond: '中和', phenom: '生成亚硫酸盐' },
                { from: 'h2so4', to: 'na2so4', eq: 'H₂SO₄ + 2NaOH = Na₂SO₄ + 2H₂O', cond: '中和', phenom: '生成硫酸盐' },
            ],
        },
    },

    /* ═══════════════════ 焰色反应数据 ═══════════════════ */
    _FLAME: [
        { sym: 'Na', name: '钠', color: '#ffd11a', desc: '黄色', wl: '589 nm', tip: '观察时无需钴玻璃；黄色掩盖力强' },
        { sym: 'K', name: '钾', color: '#c77dff', desc: '紫色', wl: '766 / 404 nm', tip: '须透过蓝色钴玻璃观察（滤去钠的黄光）' },
        { sym: 'Li', name: '锂', color: '#ff3b5c', desc: '紫红色', wl: '671 nm', tip: '深红偏紫' },
        { sym: 'Ca', name: '钙', color: '#ff7a2f', desc: '砖红色', wl: '622 nm', tip: '橙红，常见于钙盐检验' },
        { sym: 'Cu', name: '铜', color: '#36e26b', desc: '绿色', wl: '510 nm', tip: '蓝绿色，焰色鲜亮' },
        { sym: 'Ba', name: '钡', color: '#bfff3a', desc: '黄绿色', wl: '524 nm', tip: '偏黄的绿色' },
        { sym: 'Sr', name: '锶', color: '#ff2d6f', desc: '洋红色', wl: '650 nm', tip: '猩红/洋红，烟花常用' },
    ],

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    /* ═══════════════════ 价类二维图布局 ═══════════════════ */
    _layout() {
        const d = this._DATA[this._elem];
        const leftPad = 54, rightPad = 16, topPad = 42, botPad = 18;
        const innerW = this.W - leftPad - rightPad;
        const innerH = this.H - topPad - botPad;
        const nVals = d.vals.length;
        const colX = c => leftPad + (c + 0.5) * innerW / 5;
        const rowY = vi => topPad + (vi + 0.5) * innerH / nVals;

        // 同格碰撞 → 垂直偏移
        const groups = {};
        d.species.forEach(s => {
            const k = s.cat * 100 + s.vi;
            (groups[k] = groups[k] || []).push(s);
        });
        this._nodeBoxes = {};
        const ctx = this.ctx;
        ctx.font = '13px ' + CF.mono;
        d.species.forEach(s => {
            const k = s.cat * 100 + s.vi;
            const grp = groups[k];
            const idx = grp.indexOf(s);
            const spread = (idx - (grp.length - 1) / 2) * 30;
            const w = Math.max(44, ctx.measureText(s.f).width + 16);
            const h = 26;
            const cx = colX(s.cat);
            const cy = rowY(s.vi) + spread;
            this._nodeBoxes[s.id] = { x: cx - w / 2, y: cy - h / 2, w, h, cx, cy };
        });
        this._lo = { leftPad, rightPad, topPad, botPad, colX, rowY, nVals };
    },

    /* ── 矩形边缘交点（朝向目标）── */
    _edge(box, tx, ty) {
        const dx = tx - box.cx, dy = ty - box.cy;
        if (dx === 0 && dy === 0) return { x: box.cx, y: box.cy };
        const hw = box.w / 2 + 3, hh = box.h / 2 + 3;
        const sx = dx === 0 ? Infinity : hw / Math.abs(dx);
        const sy = dy === 0 ? Infinity : hh / Math.abs(dy);
        const s = Math.min(sx, sy);
        return { x: box.cx + dx * s, y: box.cy + dy * s };
    },

    _arrowHead(x, y, ang, color) {
        const ctx = this.ctx, len = 8, spread = 0.42;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - len * Math.cos(ang - spread), y - len * Math.sin(ang - spread));
        ctx.lineTo(x - len * Math.cos(ang + spread), y - len * Math.sin(ang + spread));
        ctx.closePath();
        ctx.fill();
    },

    /* ═══════════════════ 绘制：价类二维图 ═══════════════════ */
    _drawDiagram() {
        const ctx = this.ctx, d = this._DATA[this._elem];
        ctx.clearRect(0, 0, this.W, this.H);
        this._layout();
        const lo = this._lo;
        const cats = d.kind === 'metal' ? this._CATS_METAL : this._CATS_NONMETAL;

        // 网格 + 列标题
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = 'bold 13px ' + CF.sans;
        for (let c = 0; c < 5; c++) {
            const x = lo.colX(c);
            ctx.fillStyle = (d.kind === 'metal' && c === 1) ? this._COL.dim : this._COL.accent;
            ctx.fillText(cats[c], x, 18);
            ctx.strokeStyle = this._COL.line;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, lo.topPad - 6); ctx.lineTo(x, this.H - lo.botPad);
            ctx.stroke();
        }
        // 化合价行标签
        ctx.font = '12px ' + CF.mono;
        ctx.textAlign = 'left';
        for (let vi = 0; vi < d.vals.length; vi++) {
            const y = lo.rowY(vi);
            ctx.fillStyle = this._COL.amber;
            ctx.fillText(d.vals[vi], 10, y);
            ctx.strokeStyle = this._COL.line;
            ctx.setLineDash([3, 4]);
            ctx.beginPath();
            ctx.moveTo(lo.leftPad - 6, y); ctx.lineTo(this.W - lo.rightPad, y);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        // 轴名
        ctx.fillStyle = this._COL.dim;
        ctx.font = '11px ' + CF.sans;
        ctx.textAlign = 'left'; ctx.fillText('化合价', 6, lo.topPad - 24);

        // 反应箭头
        d.rxns.forEach(r => {
            const a = this._nodeBoxes[r.from], b = this._nodeBoxes[r.to];
            if (!a || !b) return;
            const hl = this._selNode && (r.from === this._selNode || r.to === this._selNode);
            const p1 = this._edge(a, b.cx, b.cy);
            const p2 = this._edge(b, a.cx, a.cy);
            ctx.strokeStyle = hl ? this._COL.amber : 'rgba(77,158,126,.35)';
            ctx.lineWidth = hl ? 2 : 1;
            ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
            this._arrowHead(p2.x, p2.y, Math.atan2(p2.y - p1.y, p2.x - p1.x), hl ? this._COL.amber : 'rgba(77,158,126,.5)');
        });

        // 节点
        d.species.forEach(s => {
            const box = this._nodeBoxes[s.id];
            const sel = s.id === this._selNode;
            ctx.fillStyle = sel ? 'rgba(229,192,123,.16)' : this._COL.nodeFill;
            ctx.strokeStyle = sel ? this._COL.amber : this._COL.nodeBorder;
            ctx.lineWidth = sel ? 2 : 1.3;
            if (sel) { ctx.shadowColor = this._COL.amber; ctx.shadowBlur = 12; }
            this._roundRect(box.x, box.y, box.w, box.h, 6);
            ctx.fill(); ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.fillStyle = sel ? '#fff' : this._COL.text;
            ctx.font = '13px ' + CF.mono;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(s.f, box.cx, box.cy);
        });
    },

    _roundRect(x, y, w, h, r) {
        const ctx = this.ctx;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    },

    /* ═══════════════════ 绘制：焰色反应 ═══════════════════ */
    _spawnFlame() {
        const m = this._FLAME.find(x => x.sym === this._metal);
        const baseX = this.W / 2;
        const baseY = this.H - 70;
        for (let i = 0; i < 6; i++) {
            const spread = (Math.random() - 0.5) * 26;
            this._particles.push({
                x: baseX + spread,
                y: baseY,
                vx: spread * 0.012 + (Math.random() - 0.5) * 0.3,
                vy: -(1.5 + Math.random() * 1.4),
                life: 1,
                decay: 0.012 + Math.random() * 0.012,
                size: 10 + Math.random() * 14,
                color: m.color,
            });
        }
    },

    _drawFlame() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.W, this.H);
        const m = this._FLAME.find(x => x.sym === this._metal);
        const baseX = this.W / 2, baseY = this.H - 70;

        // 酒精灯本体
        ctx.fillStyle = '#26303f';
        ctx.strokeStyle = 'rgba(255,255,255,.18)';
        ctx.lineWidth = 1.5;
        this._roundRect(baseX - 34, baseY + 6, 68, 54, 8); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#1c2530';
        this._roundRect(baseX - 12, baseY - 8, 24, 18, 4); ctx.fill(); ctx.stroke();
        // 灯芯
        ctx.fillStyle = '#5a4632';
        ctx.fillRect(baseX - 3, baseY - 14, 6, 10);

        // 底层暖焰
        const g = ctx.createRadialGradient(baseX, baseY - 18, 2, baseX, baseY - 18, 30);
        g.addColorStop(0, 'rgba(120,160,255,.45)');
        g.addColorStop(1, 'rgba(60,90,160,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(baseX, baseY - 18, 16, 26, 0, 0, Math.PI * 2); ctx.fill();

        // 粒子
        ctx.globalCompositeOperation = 'lighter';
        this._particles.forEach(p => {
            const pg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
            pg.addColorStop(0, this._hexA(p.color, 0.55 * p.life));
            pg.addColorStop(0.5, this._hexA(p.color, 0.22 * p.life));
            pg.addColorStop(1, this._hexA(p.color, 0));
            ctx.fillStyle = pg;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
        });
        ctx.globalCompositeOperation = 'source-over';

        // 标注
        ctx.fillStyle = m.color;
        ctx.font = 'bold 16px ' + CF.sans;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.shadowColor = m.color; ctx.shadowBlur = 10;
        ctx.fillText(m.sym + '（' + m.name + '）焰色：' + m.desc, baseX, 16);
        ctx.shadowBlur = 0;
        ctx.fillStyle = this._COL.dim;
        ctx.font = '12px ' + CF.sans;
        ctx.fillText('特征谱线 ≈ ' + m.wl, baseX, 40);
    },

    _hexA(hex, a) {
        const n = parseInt(hex.slice(1), 16);
        const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
        return 'rgba(' + r + ',' + g + ',' + b + ',' + a.toFixed(3) + ')';
    },

    _animate(ts) {
        if (!this._lastTime) this._lastTime = ts;
        const dt = Math.min(40, ts - this._lastTime);
        this._lastTime = ts;
        this._flameT += dt;
        if (this._flameT > 40) { this._spawnFlame(); this._flameT = 0; }
        this._particles.forEach(p => {
            p.x += p.vx * dt * 0.06;
            p.y += p.vy * dt * 0.06;
            p.vx += (Math.random() - 0.5) * 0.04;
            p.life -= p.decay * dt * 0.06;
            p.size *= 0.997;
        });
        this._particles = this._particles.filter(p => p.life > 0);
        this._drawFlame();
        this._raf = requestAnimationFrame(t => this._animate(t));
    },

    _startFlame() {
        if (this._raf) return;
        this._lastTime = 0; this._flameT = 0; this._particles = [];
        this._raf = requestAnimationFrame(t => this._animate(t));
    },

    _stopAnim() {
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    },

    _draw() {
        if (this.mode === 'diagram') this._drawDiagram();
        else this._drawFlame();
    },

    /* ═══════════════════ 控件 ═══════════════════ */
    _buildControls() {
        const el = document.getElementById('ec-controls');
        if (!el) return;
        el.innerHTML = '';

        const modes = document.createElement('fieldset');
        modes.className = 'ec-mode-btns';
        modes.setAttribute('role', 'group');
        modes.setAttribute('aria-label', '模式选择');
        [
            { key: 'diagram', label: '🔗 价-类二维图' },
            { key: 'flame', label: '🔥 焰色反应' },
        ].forEach(m => {
            const btn = document.createElement('button');
            btn.className = 'ec-mode-btn' + (m.key === this.mode ? ' active' : '');
            btn.dataset.mode = m.key;
            btn.textContent = m.label;
            this._on(btn, 'click', () => this._switchMode(m.key));
            modes.appendChild(btn);
        });
        el.appendChild(modes);

        const params = document.createElement('div');
        params.className = 'ec-params';
        params.id = 'ec-params';
        el.appendChild(params);
        this._buildModeParams();

        this._updateInfo();
    },

    _buildModeParams() {
        const par = document.getElementById('ec-params');
        if (!par) return;
        par.innerHTML = '';

        if (this.mode === 'diagram') {
            const hint = document.createElement('div');
            hint.className = 'ec-pick-label';
            hint.textContent = '选择元素：';
            par.appendChild(hint);
            const wrap = document.createElement('div');
            wrap.className = 'ec-elem-btns';
            Object.keys(this._DATA).forEach(k => {
                const btn = document.createElement('button');
                btn.className = 'ec-elem-btn' + (k === this._elem ? ' active' : '');
                btn.textContent = k + ' ' + this._DATA[k].name;
                this._on(btn, 'click', () => {
                    this._elem = k; this._selNode = null;
                    wrap.querySelectorAll('.ec-elem-btn').forEach(b => b.classList.toggle('active', b === btn));
                    this._draw(); this._updateInfo();
                });
                wrap.appendChild(btn);
            });
            par.appendChild(wrap);
            const tip = document.createElement('div');
            tip.className = 'ec-pick-tip';
            tip.textContent = '👆 点击图中物质节点，高亮其参与的转化反应';
            par.appendChild(tip);
        } else {
            const hint = document.createElement('div');
            hint.className = 'ec-pick-label';
            hint.textContent = '选择金属：';
            par.appendChild(hint);
            const wrap = document.createElement('div');
            wrap.className = 'ec-elem-btns';
            this._FLAME.forEach(m => {
                const btn = document.createElement('button');
                btn.className = 'ec-elem-btn' + (m.sym === this._metal ? ' active' : '');
                btn.textContent = m.sym + ' ' + m.name;
                this._on(btn, 'click', () => {
                    this._metal = m.sym; this._particles = [];
                    wrap.querySelectorAll('.ec-elem-btn').forEach(b => b.classList.toggle('active', b === btn));
                    this._updateInfo();
                });
                wrap.appendChild(btn);
            });
            par.appendChild(wrap);
        }
    },

    _updateInfo() {
        const el = document.getElementById('ec-info');
        if (!el) return;
        if (this.mode === 'diagram') {
            const d = this._DATA[this._elem];
            let html = '<div class="ec-mode-tag">价-类二维图</div>' +
                '<div class="ec-data-row">元素：<strong>' + this._elem + ' ' + d.name + '</strong>（' + d.sub + '）</div>';
            if (this._selNode) {
                const sp = d.species.find(s => s.id === this._selNode);
                const rs = d.rxns.filter(r => r.from === this._selNode || r.to === this._selNode);
                html += '<div class="ec-data-row">选中物质：<strong>' + sp.f + '</strong>' +
                    (sp.note ? ' <span class="ec-note">（' + sp.note + '）</span>' : '') + '</div>';
                html += '<div class="ec-rxn-list">';
                rs.forEach(r => {
                    const dir = r.from === this._selNode ? '→ 生成' : '← 来自';
                    html += '<div class="ec-rxn">' +
                        '<div class="ec-eq">' + r.eq + '</div>' +
                        '<div class="ec-meta"><span class="ec-tag">' + r.cond + '</span>' + r.phenom + '</div>' +
                        '</div>';
                });
                html += '</div>';
            } else {
                html += '<div class="ec-tip">💡 横轴=物质类别，纵轴=化合价。点击节点查看反应方程式、条件与现象。</div>';
            }
            el.innerHTML = html;
        } else {
            const m = this._FLAME.find(x => x.sym === this._metal);
            el.innerHTML =
                '<div class="ec-mode-tag">焰色反应</div>' +
                '<div class="ec-data-row">金属：<strong>' + m.sym + ' ' + m.name + '</strong></div>' +
                '<div class="ec-data-row">焰色：<strong style="color:' + m.color + '">' + m.desc + '</strong></div>' +
                '<div class="ec-data-row">特征谱线：' + m.wl + '</div>' +
                '<div class="ec-tip">💡 ' + m.tip + '</div>' +
                '<div class="ec-tip">⚗ 焰色反应是元素的<strong>物理性质</strong>（电子跃迁释放特定波长的光），可用于检验金属（离子）。</div>';
        }
    },

    _switchMode(m) {
        if (m === this.mode) return;
        this._stopAnim();
        this.mode = m;
        document.querySelectorAll('.ec-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
        this._buildModeParams();
        this._updateInfo();
        this._injectEduPanel();
        if (m === 'diagram') this._draw();
        else this._startFlame();
    },

    /* ═══════════════════ 教育面板 ═══════════════════ */
    _injectEduPanel() {
        const el = document.getElementById('ec-edu');
        if (!el) return;
        if (this.mode === 'diagram') {
            el.innerHTML =
                '<h4>📚 元素化合物：价-类二维图</h4>' +
                '<p>把同种元素的物质按<strong>化合价</strong>（纵轴）与<strong>物质类别</strong>（横轴：单质 / 氢化物 / 氧化物 / 酸碱 / 盐）排布，转化关系一目了然：</p>' +
                '<ul>' +
                '<li><strong>同价转化（横向）</strong>：化合价不变，类别改变 —— 一般是复分解或化合反应，如 Na₂O→NaOH→Na₂CO₃</li>' +
                '<li><strong>变价转化（纵向）</strong>：化合价升降 —— 必为<strong>氧化还原反应</strong>，如 Fe²⁺⇌Fe³⁺、S→SO₂→SO₃</li>' +
                '<li><strong>两性物质</strong>：Al₂O₃、Al(OH)₃ 既溶于强酸又溶于强碱</li>' +
                '<li><strong>价态规律</strong>：处于最高价只有氧化性、最低价只有还原性、中间价两者兼有</li>' +
                '</ul>' +
                '<p class="ec-formula">判断思路：先看价态变化 → 选氧化剂/还原剂；再看类别变化 → 选酸/碱/盐。</p>' +
                '<p class="ec-tip">💡 二维图是高中元素化合物复习的核心工具，能把零散反应织成一张转化网。</p>';
        } else {
            el.innerHTML =
                '<h4>🔥 焰色反应原理</h4>' +
                '<p>某些金属或其化合物在灼烧时，电子吸收能量跃迁到<strong>较高能级</strong>，随后跃迁回基态时把多余能量以<strong>特定波长的光</strong>释放出来，呈现特征焰色。</p>' +
                '<ul>' +
                '<li><strong>本质</strong>：电子能级跃迁（物理变化），由元素决定，与是单质还是化合物无关</li>' +
                '<li><strong>操作</strong>：用铂丝（或洁净铁丝）蘸取样品在酒精灯外焰灼烧，每次实验前用稀盐酸洗净并灼烧至无色</li>' +
                '<li><strong>钾的观察</strong>：须透过<strong>蓝色钴玻璃</strong>，滤去钠的黄光干扰</li>' +
                '</ul>' +
                '<p class="ec-formula">常见焰色：Na 黄 · K 紫 · Li 紫红 · Ca 砖红 · Cu 绿 · Ba 黄绿 · Sr 洋红</p>' +
                '<p class="ec-tip">💡 节日烟花的绚丽色彩正是不同金属盐焰色反应的应用。</p>';
        }
    },

    /* ═══════════════════ 交互：点击节点 ═══════════════════ */
    _onClick(e) {
        if (this.mode !== 'diagram') return;
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left, y = e.clientY - rect.top;
        let hit = null;
        for (const id in this._nodeBoxes) {
            const b = this._nodeBoxes[id];
            if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { hit = id; break; }
        }
        this._selNode = (hit === this._selNode) ? null : hit;
        this._draw();
        this._updateInfo();
    },

    /* ═══════════════════ Canvas 设置 ═══════════════════ */
    _resize() {
        const c = this.canvas;
        if (!c) return;
        const rect = c.parentElement.getBoundingClientRect();
        const w = rect.width;
        const h = Math.min(Math.max(w * 0.66, 360), 560);
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
        this.canvas = document.getElementById('ec-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this._resize();
        this._buildControls();
        this._injectEduPanel();
        this._on(this.canvas, 'click', e => this._onClick(e));
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver(() => {
                this._resize();
                if (this.mode === 'diagram') this._draw();
            });
            this._resizeObs.observe(this.canvas.parentElement);
        }
        this._draw();
    },

    destroy() {
        this._stopAnim();
        this._listeners.forEach(l => l.el.removeEventListener(l.evt, l.fn, l.opts));
        this._listeners = [];
        if (this._resizeObs) { this._resizeObs.disconnect(); this._resizeObs = null; }
        this._particles = [];
        this._selNode = null;
    }
};

window.ElementCompounds = ElementCompounds;
function initElementCompounds() { ElementCompounds.init(); }
window.initElementCompounds = initElementCompounds;
