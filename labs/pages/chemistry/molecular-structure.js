// ===== Molecular Structure Visualization v2 =====
// 3D ball-and-stick, modes: view / measure / orbital
// Event cleanup: destroy(), _listeners, _on()

const MoleculeVis = {
    canvas: null, ctx: null, W: 0, H: 0,
    molecule: null,
    rotX: -0.4, rotY: 0.6,
    dragging: false, lastMouse: { x: 0, y: 0 },
    scale: 80,
    autoRotate: false, autoRotateId: null,
    _listeners: [],
    _ro: null,

    mode: 'view', // view | measure | orbital
    measureAtoms: [],  // indices of selected atoms for measurement
    hoveredAtom: -1,
    _projected: [],

    atomStyles: {
        H:  { color: '#ffffff', r: 0.31, name: '\u6c22', en: 2.20 },
        C:  { color: '#555555', r: 0.77, name: '\u78b3', en: 2.55 },
        N:  { color: '#3050F8', r: 0.75, name: '\u6c2e', en: 3.04 },
        O:  { color: '#FF0D0D', r: 0.73, name: '\u6c27', en: 3.44 },
        S:  { color: '#FFFF30', r: 1.02, name: '\u786b', en: 2.58 },
        P:  { color: '#FF8000', r: 1.06, name: '\u78f7', en: 2.19 },
        Cl: { color: '#1FF01F', r: 0.99, name: '\u6c2f', en: 3.16 },
        F:  { color: '#90E050', r: 0.64, name: '\u6c1f', en: 3.98 },
        Na: { color: '#AB5CF2', r: 1.66, name: '\u94a0', en: 0.93 },
        Fe: { color: '#E06633', r: 1.24, name: '\u94c1', en: 1.83 },
        Br: { color: '#A62929', r: 1.14, name: '\u6eb4', en: 2.96 },
        I:  { color: '#940094', r: 1.33, name: '\u7898', en: 2.66 }
    },

    // ============ 键参数表（v4.5.0-α4 新增） ============
    // 键长单位 Å (10⁻¹⁰ m)，键能单位 kJ/mol
    // 数据来源：CRC Handbook + 人教版选必二（部分取代表性数值）
    // key 规则：将两端元素按字母升序排列后用 '-' 拼接 + '|' + 键级
    bondData: {
        'H-O|1':  { length: 0.96, energy: 463, type: '极性共价键 σ' },
        'C-H|1':  { length: 1.09, energy: 413, type: '弱极性共价键 σ' },
        'C-C|1':  { length: 1.54, energy: 348, type: '非极性共价键 σ' },
        'C-C|2':  { length: 1.34, energy: 614, type: '非极性共价键 σ+π' },
        'C-C|3':  { length: 1.20, energy: 839, type: '非极性共价键 σ+2π' },
        'C-O|1':  { length: 1.43, energy: 358, type: '极性共价键 σ' },
        'C-O|2':  { length: 1.20, energy: 745, type: '极性共价键 σ+π' },
        'C-O|2-co2': { length: 1.16, energy: 799, type: '极性共价键 σ+π（CO₂ 累积式）' },
        'H-N|1':  { length: 1.01, energy: 391, type: '极性共价键 σ' },
        'Cl-H|1': { length: 1.27, energy: 432, type: '极性共价键 σ' },
        'Cl-C|1': { length: 1.77, energy: 328, type: '极性共价键 σ' },
        // S-H：键长长于 O-H、键能小于 O-H —— 与 H₂O 对比的关键数据
        'H-S|1':  { length: 1.34, energy: 347, type: '弱极性共价键 σ' },
        // 苯环 C-C 键长居于单键(1.54)与双键(1.34)之间，能量高于单键
        'C-C|aromatic': { length: 1.40, energy: 519, type: '芳香键（离域 π，键级≈1.5）' }
    },

    molecules: {
        H2O: {
            name: '\u6c34 H\u2082O',
            formula: 'H\u2082O',
            desc: '\u6781\u6027\u5206\u5b50\uff0c\u952e\u89d2 104.5\u00b0\uff0csp\u00b3\u6742\u5316',
            hybridization: 'sp\u00b3',
            polarity: '\u6781\u6027',
            shape: 'V\u5f62',
            bondAngle: '104.5\u00b0',
            atoms: [
                { el: 'O', x: 0, y: 0, z: 0 },
                { el: 'H', x: -0.76, y: 0.59, z: 0 },
                { el: 'H', x: 0.76, y: 0.59, z: 0 }
            ],
            bonds: [[0,1,1],[0,2,1]],
            lonePairs: [[0, 2]]  // atom index, count
        },
        CO2: {
            name: '\u4e8c\u6c27\u5316\u78b3 CO\u2082',
            formula: 'CO\u2082',
            desc: '\u7ebf\u6027\u975e\u6781\u6027\u5206\u5b50\uff0csp\u6742\u5316',
            hybridization: 'sp',
            polarity: '\u975e\u6781\u6027',
            shape: '\u7ebf\u5f62',
            atoms: [
                { el: 'C', x: 0, y: 0, z: 0 },
                { el: 'O', x: -1.16, y: 0, z: 0 },
                { el: 'O', x: 1.16, y: 0, z: 0 }
            ],
            bonds: [[0,1,2],[0,2,2]],
            lonePairs: [[1,2],[2,2]]
        },
        CH4: {
            name: '\u7532\u70f7 CH\u2084',
            formula: 'CH\u2084',
            desc: '\u6b63\u56db\u9762\u4f53\u6784\u578b\uff0c\u952e\u89d2 109.5\u00b0\uff0csp\u00b3\u6742\u5316',
            hybridization: 'sp\u00b3',
            polarity: '\u975e\u6781\u6027',
            shape: '\u6b63\u56db\u9762\u4f53',
            atoms: [
                { el: 'C', x: 0, y: 0, z: 0 },
                { el: 'H', x: 0.63, y: 0.63, z: 0.63 },
                { el: 'H', x: -0.63, y: -0.63, z: 0.63 },
                { el: 'H', x: -0.63, y: 0.63, z: -0.63 },
                { el: 'H', x: 0.63, y: -0.63, z: -0.63 }
            ],
            bonds: [[0,1,1],[0,2,1],[0,3,1],[0,4,1]],
            lonePairs: []
        },
        NH3: {
            name: '\u6c28 NH\u2083',
            formula: 'NH\u2083',
            desc: '\u4e09\u89d2\u9525\u5f62\uff0c\u952e\u89d2 107.3\u00b0\uff0csp\u00b3\u6742\u5316',
            hybridization: 'sp\u00b3',
            polarity: '\u6781\u6027',
            shape: '\u4e09\u89d2\u9525',
            atoms: [
                { el: 'N', x: 0, y: -0.38, z: 0 },
                { el: 'H', x: 0.94, y: 0.31, z: 0 },
                { el: 'H', x: -0.47, y: 0.31, z: 0.82 },
                { el: 'H', x: -0.47, y: 0.31, z: -0.82 }
            ],
            bonds: [[0,1,1],[0,2,1],[0,3,1]],
            lonePairs: [[0,1]]
        },
        C2H4: {
            name: '\u4e59\u70ef C\u2082H\u2084',
            formula: 'C\u2082H\u2084',
            desc: '\u5e73\u9762\u5206\u5b50\uff0cC=C\u53cc\u952e\uff0csp\u00b2\u6742\u5316',
            hybridization: 'sp\u00b2',
            polarity: '\u975e\u6781\u6027',
            shape: '\u5e73\u9762\u4e09\u89d2',
            atoms: [
                { el: 'C', x: -0.67, y: 0, z: 0 },
                { el: 'C', x: 0.67, y: 0, z: 0 },
                { el: 'H', x: -1.24, y: 0.93, z: 0 },
                { el: 'H', x: -1.24, y: -0.93, z: 0 },
                { el: 'H', x: 1.24, y: 0.93, z: 0 },
                { el: 'H', x: 1.24, y: -0.93, z: 0 }
            ],
            bonds: [[0,1,2],[0,2,1],[0,3,1],[1,4,1],[1,5,1]],
            lonePairs: []
        },
        C2H2: {
            name: '\u4e59\u7094 C\u2082H\u2082',
            formula: 'C\u2082H\u2082',
            desc: '\u7ebf\u6027\u5206\u5b50\uff0cC\u2261C\u4e09\u952e\uff0csp\u6742\u5316',
            hybridization: 'sp',
            polarity: '\u975e\u6781\u6027',
            shape: '\u7ebf\u5f62',
            atoms: [
                { el: 'C', x: -0.6, y: 0, z: 0 },
                { el: 'C', x: 0.6, y: 0, z: 0 },
                { el: 'H', x: -1.66, y: 0, z: 0 },
                { el: 'H', x: 1.66, y: 0, z: 0 }
            ],
            bonds: [[0,1,3],[0,2,1],[1,3,1]],
            lonePairs: []
        },
        C6H6: {
            name: '\u82ef C\u2086H\u2086',
            formula: 'C\u2086H\u2086',
            desc: '\u5e73\u9762\u516d\u5143\u73af\uff0c\u79bb\u57df\u03c0\u952e\uff0csp\u00b2\u6742\u5316',
            hybridization: 'sp\u00b2',
            polarity: '\u975e\u6781\u6027',
            shape: '\u5e73\u9762\u516d\u89d2',
            atoms: (() => {
                const atoms = [];
                for (let i = 0; i < 6; i++) {
                    const a = (i * 60 - 90) * Math.PI / 180;
                    atoms.push({ el: 'C', x: 1.4 * Math.cos(a), y: 1.4 * Math.sin(a), z: 0 });
                }
                for (let i = 0; i < 6; i++) {
                    const a = (i * 60 - 90) * Math.PI / 180;
                    atoms.push({ el: 'H', x: 2.48 * Math.cos(a), y: 2.48 * Math.sin(a), z: 0 });
                }
                return atoms;
            })(),
            bonds: (() => {
                const bonds = [];
                for (let i = 0; i < 6; i++) {
                    bonds.push([i, (i + 1) % 6, i % 2 === 0 ? 2 : 1]);
                    bonds.push([i, i + 6, 1]);
                }
                return bonds;
            })(),
            lonePairs: []
        },
        // NOTE (v4.5.0-α4)：移除原 NaCl 条目 —— NaCl 是离子化合物晶体而非分子，
        // 没有独立的"NaCl 分子"在常温下存在；离子键演示请查看"化学键"实验
        C2H5OH: {
            name: '\u4e59\u9187 C\u2082H\u2085OH',
            formula: 'C\u2082H\u2085OH',
            desc: '\u6781\u6027\u6709\u673a\u5206\u5b50\uff0c\u542b\u7f9f\u57fa(-OH)',
            hybridization: 'sp\u00b3',
            polarity: '\u6781\u6027',
            shape: '\u56db\u9762\u4f53',
            atoms: [
                { el: 'C', x: -0.77, y: 0, z: 0 },
                { el: 'C', x: 0.77, y: 0, z: 0 },
                { el: 'O', x: 1.44, y: 1.15, z: 0 },
                { el: 'H', x: -1.2, y: 0.93, z: 0.4 },
                { el: 'H', x: -1.2, y: -0.93, z: 0.4 },
                { el: 'H', x: -1.2, y: 0, z: -0.88 },
                { el: 'H', x: 1.2, y: -0.52, z: 0.88 },
                { el: 'H', x: 1.2, y: -0.52, z: -0.88 },
                { el: 'H', x: 2.38, y: 1.0, z: 0 }
            ],
            bonds: [[0,1,1],[1,2,1],[0,3,1],[0,4,1],[0,5,1],[1,6,1],[1,7,1],[2,8,1]],
            lonePairs: [[2,2]]
        },
        HCl: {
            name: '\u6c2f\u5316\u6c22 HCl',
            formula: 'HCl',
            desc: '\u5f3a\u9178\uff0c\u6781\u6027\u5171\u4ef7\u952e',
            polarity: '\u6781\u6027',
            shape: '\u7ebf\u5f62',
            atoms: [
                { el: 'H', x: -0.64, y: 0, z: 0 },
                { el: 'Cl', x: 0.64, y: 0, z: 0 }
            ],
            bonds: [[0,1,1]],
            lonePairs: [[1,3]]
        },
        // ============ v4.5.0-α5 新增分子 ============
        HCHO: {
            name: '\u7532\u919b HCHO',
            formula: 'HCHO',
            desc: '\u5e73\u9762\u5206\u5b50\uff0cC \u4e3a sp\u00b2 \u6742\u5316\uff0cC=O \u53cc\u952e + 2 \u4e2a C\u2014H \u5355\u952e\uff1b\u6700\u7b80\u5355\u7684\u919b\uff0c\u6c34\u6eb6\u6db2\u5373\u798f\u5c14\u9a6c\u6797',
            hybridization: 'sp\u00b2',
            polarity: '\u6781\u6027',
            shape: '\u5e73\u9762\u4e09\u89d2',
            bondAngle: '\u2220HCH \u2248116\u00b0\u3001\u2220HCO \u2248122\u00b0',
            atoms: [
                { el: 'C', x: 0, y: 0, z: 0 },
                { el: 'O', x: 0, y: 1.21, z: 0 },
                { el: 'H', x: -0.93, y: -0.58, z: 0 },
                { el: 'H', x: 0.93, y: -0.58, z: 0 }
            ],
            bonds: [[0,1,2],[0,2,1],[0,3,1]],
            lonePairs: [[1, 2]]
        },
        H2S: {
            name: '\u786b\u5316\u6c22 H\u2082S',
            formula: 'H\u2082S',
            desc: 'V \u5f62\u5206\u5b50\uff0c\u952e\u89d2\u7ea6 92\u00b0\uff08\u63a5\u8fd1 90\u00b0\uff09\uff1b\u4e0e H\u2082O \u5bf9\u6bd4\uff1aS \u539f\u5b50\u534a\u5f84\u5927\u3001\u7535\u8d1f\u6027\u5c0f\uff0c\u51e0\u4e4e\u4e0d\u6742\u5316\uff0c\u51c0\u7528 3p \u8f68\u9053\u6210\u952e',
            hybridization: '\u8fd1 p \u8f68\u9053\uff08\u5f31\u6742\u5316\uff09',
            polarity: '\u6781\u6027\uff08\u8f83\u5f31\uff09',
            shape: 'V \u5f62',
            bondAngle: '\u224892\u00b0',
            compareWith: 'H2O',
            hybNote: 'S \u539f\u5b50\u534a\u5f84\u5927\uff08109 pm > O 73 pm\uff09\u3001\u7535\u8d1f\u6027\u5c0f\uff082.58 < O 3.44\uff09\uff0c3p \u8f68\u9053\u95f4\u5939\u89d2\u63a5\u8fd1 90\u00b0\uff0c\u51e0\u4e4e\u4e0d\u53d1\u751f\u6742\u5316\uff1bH\u2082O \u4e2d O \u7684 sp\u00b3 \u6742\u5316\u4f7f\u952e\u89d2\u6269\u5927\u81f3 104.5\u00b0',
            atoms: [
                { el: 'S', x: 0, y: 0, z: 0 },
                { el: 'H', x: -0.97, y: 0.93, z: 0 },
                { el: 'H', x: 0.97, y: 0.93, z: 0 }
            ],
            bonds: [[0,1,1],[0,2,1]],
            lonePairs: [[0, 2]]
        },
        CH3COOH: {
            name: '\u4e59\u9178 CH\u2083COOH',
            formula: 'CH\u2083COOH',
            desc: '\u5f31\u9178\uff08Ka\u22481.8\u00d710\u207b\u2075\uff09\uff0c\u542b\u7fa7\u57fa(-COOH)\uff1bC\u2081 sp\u00b3\uff08\u7532\u57fa\u3001\u56db\u9762\u4f53\uff09\uff0cC\u2082 sp\u00b2\uff08\u7fb0\u57fa/\u7fa7\u57fa\u3001\u5e73\u9762\uff09',
            hybridization: 'sp\u00b3 + sp\u00b2',
            polarity: '\u6781\u6027',
            shape: '\u7532\u57fa\u56db\u9762\u4f53 + \u7fa7\u57fa\u5e73\u9762',
            bondAngle: '\u2220O=C\u2014O \u2248124\u00b0\u3001\u2220H\u2014C\u2014H \u2248109.5\u00b0',
            hybNote: '\u4e24\u4e2a C \u539f\u5b50\u6742\u5316\u65b9\u5f0f\u4e0d\u540c\uff1a\u7532\u57fa\u78b3 sp\u00b3 \u56db\u9762\u4f53\uff0c\u7fa7\u57fa\u78b3 sp\u00b2 \u5e73\u9762\u4e09\u89d2\u3002C=O \u4e0e C\u2014O\u2014H \u4e2d\u7684 O \u5b58\u5728 p-\u03c0 \u5171\u8f6d\uff0c\u4f7f\u7fa7\u57fa\u6c22\u539f\u5b50\u6613\u7535\u79bb\u2192\u9178\u6027',
            atoms: [
                { el: 'C', x: -0.77, y: 0, z: 0 },
                { el: 'C', x: 0.77, y: 0, z: 0 },
                { el: 'O', x: 1.30, y: 1.15, z: 0 },
                { el: 'O', x: 1.30, y: -1.15, z: 0 },
                { el: 'H', x: -1.20, y: 0.93, z: 0.40 },
                { el: 'H', x: -1.20, y: -0.93, z: 0.40 },
                { el: 'H', x: -1.20, y: 0, z: -0.88 },
                { el: 'H', x: 2.20, y: -1.15, z: 0 }
            ],
            bonds: [
                [0, 1, 1],  // C\u2014C
                [1, 2, 2],  // C=O
                [1, 3, 1],  // C\u2014O
                [3, 7, 1],  // O\u2014H
                [0, 4, 1], [0, 5, 1], [0, 6, 1]  // 3 \u4e2a C\u2014H
            ],
            lonePairs: [[2, 2], [3, 2]]
        }
    },

    /* ============ Init / Destroy ============ */

    init() {
        this.canvas = document.getElementById('mol-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        this.loadMolecule('H2O');
        this._bindCanvasEvents();
        this._bindControlEvents();
        this._injectModeButtons();

        if (typeof ResizeObserver !== 'undefined') {
            this._ro = new ResizeObserver(() => { this.resize(); this.draw(); });
            this._ro.observe(this.canvas.parentElement);
        }
        this._onResize = () => { this.resize(); this.draw(); };
        window.addEventListener('resize', this._onResize);
    },

    destroy() {
        if (this.autoRotateId) { cancelAnimationFrame(this.autoRotateId); this.autoRotateId = null; }
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
        if (this._onResize) { window.removeEventListener('resize', this._onResize); }
        this._listeners.forEach(([el, evt, fn, opts]) => el.removeEventListener(evt, fn, opts));
        this._listeners = [];
    },

    _on(el, evt, fn, opts) {
        if (!el) return;
        el.addEventListener(evt, fn, opts);
        this._listeners.push([el, evt, fn, opts]);
    },

    resize() {
        const wrap = this.canvas?.parentElement;
        if (!wrap) return;
        const w = wrap.clientWidth;
        if (w === 0) return;
        const h = Math.min(w, 480);
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w; this.H = h;
    },

    /* ============ Controls ============ */

    _injectModeButtons() {
        const controls = this.canvas?.parentElement?.querySelector('.viz-controls');
        if (!controls || document.getElementById('mol-mode-buttons')) return;

        const wrap = document.createElement('div');
        wrap.id = 'mol-mode-buttons';
        wrap.className = 'mol-modes';
        wrap.innerHTML = '<button class="mol-mode-btn active" data-mode="view">\u89c2\u5bdf</button>'
            + '<button class="mol-mode-btn" data-mode="measure">\u6d4b\u91cf</button>'
            + '<button class="mol-mode-btn" data-mode="orbital">\u6742\u5316\u8f68\u9053</button>';
        controls.parentElement.insertBefore(wrap, controls);

        wrap.querySelectorAll('.mol-mode-btn').forEach(btn => {
            this._on(btn, 'click', () => {
                this.switchMode(btn.dataset.mode);
            });
        });
    },

    switchMode(mode) {
        this.mode = mode;
        this.measureAtoms = [];
        document.querySelectorAll('.mol-mode-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.mode === mode);
        });
        const msgs = {
            view: '\u62d6\u62fd\u65cb\u8f6c\u5206\u5b50\uff0c\u6eda\u8f6e\u7f29\u653e\uff0c\u70b9\u51fb\u539f\u5b50\u67e5\u770b\u4fe1\u606f',
            measure: '\u7528\u9f20\u6807\u70b9\u51fb\u4e24\u4e2a\u539f\u5b50\u6d4b\u91cf\u952e\u957f / \u4e09\u4e2a\u539f\u5b50\u6d4b\u91cf\u952e\u89d2',
            orbital: '\u663e\u793a\u4e2d\u5fc3\u539f\u5b50\u7684\u6742\u5316\u8f68\u9053\u793a\u610f\u56fe'
        };
        const el = document.getElementById('mol-info');
        if (el) el.innerHTML = '<div class="mol-info-desc">' + (msgs[mode] || '') + '</div>';
        this.draw();
    },

    _bindControlEvents() {
        // Molecule selector buttons
        document.querySelectorAll('.mol-select-btn').forEach(btn => {
            this._on(btn, 'click', () => {
                document.querySelectorAll('.mol-select-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.loadMolecule(btn.dataset.mol);
            });
        });

        const autoBtn = document.getElementById('mol-auto-rotate');
        this._on(autoBtn, 'click', () => this.toggleAutoRotate());

        const resetBtn = document.getElementById('mol-reset');
        this._on(resetBtn, 'click', () => {
            this.rotX = -0.4; this.rotY = 0.6; this.scale = 80;
            this.measureAtoms = [];
            this.draw();
        });
    },

    _bindCanvasEvents() {
        // Drag to rotate
        this._on(this.canvas, 'mousedown', (e) => {
            this.dragging = true;
            this.lastMouse = { x: e.clientX, y: e.clientY };
        });
        const onMouseMove = (e) => {
            if (!this.dragging) {
                // hover detection
                const rect = this.canvas.getBoundingClientRect();
                const mx = e.clientX - rect.left, my = e.clientY - rect.top;
                this.hoveredAtom = this._hitAtom(mx, my);
                this.canvas.style.cursor = this.hoveredAtom >= 0 ? 'pointer' : 'grab';
                this.draw();
                return;
            }
            const dx = e.clientX - this.lastMouse.x;
            const dy = e.clientY - this.lastMouse.y;
            this.rotY += dx * 0.01;
            this.rotX += dy * 0.01;
            this.lastMouse = { x: e.clientX, y: e.clientY };
            this.draw();
        };
        this._on(this.canvas, 'mousemove', onMouseMove);
        this._on(this.canvas, 'mouseup', () => { this.dragging = false; });
        this._on(this.canvas, 'mouseleave', () => { this.dragging = false; });

        // Touch
        this._on(this.canvas, 'touchstart', (e) => {
            e.preventDefault();
            this.dragging = true;
            this.lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }, { passive: false });
        this._on(this.canvas, 'touchmove', (e) => {
            e.preventDefault();
            if (!this.dragging) return;
            const dx = e.touches[0].clientX - this.lastMouse.x;
            const dy = e.touches[0].clientY - this.lastMouse.y;
            this.rotY += dx * 0.01;
            this.rotX += dy * 0.01;
            this.lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            this.draw();
        }, { passive: false });
        this._on(this.canvas, 'touchend', () => { this.dragging = false; });

        // Zoom
        this._on(this.canvas, 'wheel', (e) => {
            e.preventDefault();
            this.scale = Math.max(30, Math.min(200, this.scale - e.deltaY * 0.1));
            this.draw();
        }, { passive: false });

        // Click
        this._on(this.canvas, 'click', (e) => {
            if (this.hoveredAtom < 0 || !this.molecule) return;

            if (this.mode === 'measure') {
                this._handleMeasureClick(this.hoveredAtom);
            } else {
                const a = this.molecule.atoms[this.hoveredAtom];
                const style = this.atomStyles[a.el] || { name: a.el };
                const el = document.getElementById('mol-info');
                if (el) {
                    const enStr = style.en ? ' \u00b7 \u7535\u8d1f\u6027 ' + style.en : '';
                    el.innerHTML = '<div class="mol-info-title">' + this.molecule.name + '</div>'
                        + '<div class="mol-info-desc">\u9009\u4e2d\u539f\u5b50: <span style="color:' + (style.color || '#aaa') + '">' + a.el + ' (' + style.name + ')</span>'
                        + ' \u00b7 \u5171\u4ef7\u534a\u5f84 ' + (style.r || '?') + ' \u00c5' + enStr
                        + ' \u00b7 \u5750\u6807 (' + a.x.toFixed(2) + ', ' + a.y.toFixed(2) + ', ' + a.z.toFixed(2) + ')</div>';
                }
            }
            this.draw();
        });
    },

    _handleMeasureClick(atomIdx) {
        if (this.measureAtoms.includes(atomIdx)) {
            this.measureAtoms = this.measureAtoms.filter(i => i !== atomIdx);
        } else {
            this.measureAtoms.push(atomIdx);
            if (this.measureAtoms.length > 3) this.measureAtoms.shift();
        }

        const mol = this.molecule;
        const el = document.getElementById('mol-info');
        if (!el || !mol) return;

        if (this.measureAtoms.length === 2) {
            const [i, j] = this.measureAtoms;
            const a = mol.atoms[i], b = mol.atoms[j];
            const dist = Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2 + (a.z-b.z)**2);
            el.innerHTML = '<div class="mol-info-title">\u952e\u957f\u6d4b\u91cf</div>'
                + '<div class="mol-info-desc">' + a.el + '(' + (i+1) + ') \u2014 ' + b.el + '(' + (j+1) + '): <strong>' + dist.toFixed(3) + ' \u00c5</strong></div>';
        } else if (this.measureAtoms.length === 3) {
            const [i, j, k] = this.measureAtoms;
            const a = mol.atoms[i], b = mol.atoms[j], c = mol.atoms[k];
            const v1 = { x: a.x-b.x, y: a.y-b.y, z: a.z-b.z };
            const v2 = { x: c.x-b.x, y: c.y-b.y, z: c.z-b.z };
            const dot = v1.x*v2.x + v1.y*v2.y + v1.z*v2.z;
            const m1 = Math.sqrt(v1.x**2 + v1.y**2 + v1.z**2);
            const m2 = Math.sqrt(v2.x**2 + v2.y**2 + v2.z**2);
            const angle = Math.acos(Math.max(-1, Math.min(1, dot / (m1 * m2)))) * 180 / Math.PI;
            el.innerHTML = '<div class="mol-info-title">\u952e\u89d2\u6d4b\u91cf</div>'
                + '<div class="mol-info-desc">\u2220 ' + a.el + '(' + (i+1) + ')-' + b.el + '(' + (j+1) + ')-' + c.el + '(' + (k+1) + '): <strong>' + angle.toFixed(1) + '\u00b0</strong></div>';
        } else {
            el.innerHTML = '<div class="mol-info-desc">\u5df2\u9009 ' + this.measureAtoms.length + ' \u4e2a\u539f\u5b50\uff0c\u7ee7\u7eed\u70b9\u51fb\u9009\u62e9 (2\u4e2a=\u952e\u957f, 3\u4e2a=\u952e\u89d2)</div>';
        }
    },

    /* ============ Molecule loading ============ */

    loadMolecule(key) {
        this.molecule = this.molecules[key] || null;
        if (!this.molecule) return;
        this.rotX = -0.4; this.rotY = 0.6;
        this.measureAtoms = [];
        this.draw();
        this.updateInfo();
    },

    toggleAutoRotate() {
        const btn = document.getElementById('mol-auto-rotate');
        if (this.autoRotateId) {
            cancelAnimationFrame(this.autoRotateId);
            this.autoRotateId = null;
            this.autoRotate = false;
            if (btn) btn.textContent = '\u81ea\u52a8\u65cb\u8f6c';
            return;
        }
        this.autoRotate = true;
        if (btn) btn.textContent = '\u505c\u6b62\u65cb\u8f6c';
        const loop = () => {
            this.rotY += 0.015;
            this.draw();
            this.autoRotateId = requestAnimationFrame(loop);
        };
        this.autoRotateId = requestAnimationFrame(loop);
    },

    /* ============ 3D Projection ============ */

    project(x, y, z) {
        const cosY = Math.cos(this.rotY), sinY = Math.sin(this.rotY);
        let x1 = x * cosY + z * sinY;
        let z1 = -x * sinY + z * cosY;
        const cosX = Math.cos(this.rotX), sinX = Math.sin(this.rotX);
        let y1 = y * cosX - z1 * sinX;
        let z2 = y * sinX + z1 * cosX;
        const s = this.scale;
        const depth = 1 + z2 * 0.12;
        return { x: this.W / 2 + x1 * s, y: this.H / 2 + y1 * s, z: z2, depth: Math.max(0.3, depth) };
    },

    _hitAtom(mx, my) {
        for (let i = this._projected.length - 1; i >= 0; i--) {
            const a = this._projected[i];
            const style = this.atomStyles[a.el] || { r: 0.5 };
            const r = style.r * 18 * a.depth;
            const dx = mx - a.x, dy = my - a.y;
            if (dx * dx + dy * dy <= r * r) return a.idx;
        }
        return -1;
    },

    /* ============ Main Draw ============ */

    draw() {
        const { ctx, W, H } = this;
        if (!this.molecule || !ctx) return;
        ctx.clearRect(0, 0, W, H);

        ctx.fillStyle = '#0d1017';
        ctx.fillRect(0, 0, W, H);

        const mol = this.molecule;
        const projected = mol.atoms.map(a => ({ ...a, ...this.project(a.x, a.y, a.z) }));

        // Sort bonds by avgZ
        const bondsToDraw = mol.bonds.map(([i, j, order]) => ({
            i, j, order, avgZ: (projected[i].z + projected[j].z) / 2
        }));
        bondsToDraw.sort((a, b) => a.avgZ - b.avgZ);

        // Sort atoms by z (painter's algorithm)
        const atomsToDraw = projected.map((a, idx) => ({ ...a, idx }));
        atomsToDraw.sort((a, b) => a.z - b.z);
        this._projected = atomsToDraw;

        // Draw bonds
        bondsToDraw.forEach(({ i, j, order }) => {
            this._drawBond(projected[i], projected[j], order);
        });

        // Orbital overlay (behind atoms but after bonds)
        if (this.mode === 'orbital' && mol.hybridization) {
            this._drawOrbitalHint(projected);
        }

        // Draw atoms
        atomsToDraw.forEach(a => {
            const isMeasured = this.measureAtoms.includes(a.idx);
            this._drawAtom(a, isMeasured);
        });

        // Measurement overlays
        if (this.mode === 'measure' && this.measureAtoms.length >= 2) {
            this._drawMeasurement(projected);
        }

        // Molecule name badge
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '600 17px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText(mol.name, 12, 24);
        if (mol.hybridization) {
            ctx.fillStyle = 'rgba(77,158,126,0.5)';
            ctx.font = '16px ' + CF.mono;
            ctx.fillText(mol.hybridization + ' | ' + mol.shape + ' | ' + mol.polarity, 12, 42);
        }
    },

    _drawBond(a, b, order) {
        const { ctx } = this;
        const avgDepth = (a.depth + b.depth) / 2;
        const alpha = 0.3 + avgDepth * 0.3;

        if (order === 1) {
            ctx.strokeStyle = 'rgba(180,180,180,' + alpha + ')';
            ctx.lineWidth = 3 * avgDepth;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        } else if (order === 2) {
            const dx = b.x - a.x, dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            const nx = -dy / len * 3, ny = dx / len * 3;
            ctx.strokeStyle = 'rgba(180,180,180,' + alpha + ')';
            ctx.lineWidth = 2.5 * avgDepth;
            ctx.beginPath(); ctx.moveTo(a.x + nx, a.y + ny); ctx.lineTo(b.x + nx, b.y + ny); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(a.x - nx, a.y - ny); ctx.lineTo(b.x - nx, b.y - ny); ctx.stroke();
        } else if (order === 3) {
            const dx = b.x - a.x, dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            const nx = -dy / len * 4, ny = dx / len * 4;
            ctx.strokeStyle = 'rgba(180,180,180,' + alpha + ')';
            ctx.lineWidth = 2 * avgDepth;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(a.x + nx, a.y + ny); ctx.lineTo(b.x + nx, b.y + ny); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(a.x - nx, a.y - ny); ctx.lineTo(b.x - nx, b.y - ny); ctx.stroke();
        }
    },

    _drawAtom(a, isMeasured) {
        const { ctx } = this;
        const style = this.atomStyles[a.el] || { color: '#aaa', r: 0.5 };
        const r = style.r * 18 * a.depth;
        const hov = a.idx === this.hoveredAtom;

        if (hov || isMeasured) {
            ctx.beginPath(); ctx.arc(a.x, a.y, r + 5, 0, Math.PI * 2);
            ctx.strokeStyle = isMeasured ? 'rgba(77,158,126,0.7)' : 'rgba(255,255,255,0.5)';
            ctx.lineWidth = 2; ctx.stroke();
            ctx.shadowColor = style.color; ctx.shadowBlur = 16;
        }

        const grd = ctx.createRadialGradient(a.x - r * 0.2, a.y - r * 0.2, 0, a.x, a.y, r);
        grd.addColorStop(0, this._lighten(style.color, hov ? 0.55 : 0.4));
        grd.addColorStop(0.7, style.color);
        grd.addColorStop(1, this._darken(style.color, 0.3));

        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;

        // Specular highlight
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath(); ctx.arc(a.x - r * 0.25, a.y - r * 0.25, r * 0.45, 0, Math.PI * 2); ctx.fill();

        // Label
        ctx.fillStyle = a.el === 'H' ? '#333' : '#fff';
        ctx.font = 'bold ' + Math.max(12, Math.round(16 * a.depth)) + 'px ' + CF.mono;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(a.el, a.x, a.y);

        if (hov && r > 5) {
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.font = '500 16px ' + CF.sans;
            ctx.fillText(style.name || a.el, a.x, a.y - r - 8);
        }
    },

    _drawMeasurement(projected) {
        const { ctx } = this;
        if (this.measureAtoms.length === 2) {
            const [i, j] = this.measureAtoms;
            const a = projected[i], b = projected[j];
            ctx.strokeStyle = 'rgba(77,158,126,0.5)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            ctx.setLineDash([]);

            const dist = Math.sqrt((this.molecule.atoms[i].x - this.molecule.atoms[j].x)**2
                + (this.molecule.atoms[i].y - this.molecule.atoms[j].y)**2
                + (this.molecule.atoms[i].z - this.molecule.atoms[j].z)**2);
            ctx.fillStyle = 'rgba(77,158,126,0.8)';
            ctx.font = '600 17px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillText(dist.toFixed(3) + ' \u00c5', (a.x + b.x) / 2, (a.y + b.y) / 2 - 10);
        } else if (this.measureAtoms.length === 3) {
            const [i, j, k] = this.measureAtoms;
            const a = projected[i], b = projected[j], c = projected[k];
            ctx.strokeStyle = 'rgba(77,158,126,0.4)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.stroke();
            ctx.setLineDash([]);

            // Arc
            const mol = this.molecule;
            const v1 = { x: mol.atoms[i].x-mol.atoms[j].x, y: mol.atoms[i].y-mol.atoms[j].y, z: mol.atoms[i].z-mol.atoms[j].z };
            const v2 = { x: mol.atoms[k].x-mol.atoms[j].x, y: mol.atoms[k].y-mol.atoms[j].y, z: mol.atoms[k].z-mol.atoms[j].z };
            const dot = v1.x*v2.x + v1.y*v2.y + v1.z*v2.z;
            const m1 = Math.sqrt(v1.x**2 + v1.y**2 + v1.z**2);
            const m2 = Math.sqrt(v2.x**2 + v2.y**2 + v2.z**2);
            const angle = Math.acos(Math.max(-1, Math.min(1, dot / (m1 * m2)))) * 180 / Math.PI;

            ctx.fillStyle = 'rgba(77,158,126,0.8)';
            ctx.font = '600 17px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillText(angle.toFixed(1) + '\u00b0', b.x, b.y - 20);
        }
    },

    _drawOrbitalHint(projected) {
        const { ctx } = this;
        const mol = this.molecule;
        if (!mol.hybridization || mol.hybridization === '\u79bb\u5b50\u952e') return;

        // Show lone pairs as electron clouds
        if (mol.lonePairs) {
            mol.lonePairs.forEach(([atomIdx, count]) => {
                const p = projected[atomIdx];
                for (let i = 0; i < count; i++) {
                    const angle = Math.PI * 0.3 + i * Math.PI * 0.5;
                    const dx = Math.cos(angle) * 30;
                    const dy = -Math.sin(angle) * 25 - 15;
                    const grd = ctx.createRadialGradient(p.x + dx, p.y + dy, 0, p.x + dx, p.y + dy, 18);
                    grd.addColorStop(0, 'rgba(100,200,255,0.2)');
                    grd.addColorStop(1, 'transparent');
                    ctx.fillStyle = grd;
                    ctx.beginPath(); ctx.arc(p.x + dx, p.y + dy, 18, 0, Math.PI * 2); ctx.fill();

                    // Electron dots
                    ctx.fillStyle = 'rgba(100,200,255,0.5)';
                    ctx.beginPath(); ctx.arc(p.x + dx - 3, p.y + dy, 2, 0, Math.PI * 2); ctx.fill();
                    ctx.beginPath(); ctx.arc(p.x + dx + 3, p.y + dy, 2, 0, Math.PI * 2); ctx.fill();
                }
            });
        }

        // Hybridization label
        ctx.fillStyle = 'rgba(100,200,255,0.4)';
        ctx.font = '15px ' + CF.mono;
        ctx.textAlign = 'right';
        ctx.fillText('\u6742\u5316: ' + mol.hybridization, this.W - 12, this.H - 12);
    },

    /* ============ Color Helpers ============ */

    _lighten(hex, amt) {
        const rgb = this._hexToRgb(hex);
        return 'rgb(' + Math.min(255, rgb.r + 255 * amt) + ',' + Math.min(255, rgb.g + 255 * amt) + ',' + Math.min(255, rgb.b + 255 * amt) + ')';
    },

    _darken(hex, amt) {
        const rgb = this._hexToRgb(hex);
        return 'rgb(' + Math.max(0, rgb.r - 255 * amt) + ',' + Math.max(0, rgb.g - 255 * amt) + ',' + Math.max(0, rgb.b - 255 * amt) + ')';
    },

    _hexToRgb(hex) {
        const h = hex.replace('#', '');
        return {
            r: parseInt(h.substring(0, 2), 16),
            g: parseInt(h.substring(2, 4), 16),
            b: parseInt(h.substring(4, 6), 16)
        };
    },

    /* ============ Info Panel ============ */

    // 根据原子对 + 键级查键参数表（v4.5.0-α4）。返回 {label, length, energy, type} 或 null
    _lookupBond(el1, el2, order, mol) {
        const a = el1 < el2 ? el1 : el2;
        const b = el1 < el2 ? el2 : el1;
        // 特殊情况覆盖
        if (mol && mol.formula === 'C\u2086H\u2086' && a === 'C' && b === 'C') {
            // 苯环 C-C 不论 order=1/2 都按芳香键
            return { label: 'C\u2014C(\u82ef)', ...this.bondData['C-C|aromatic'] };
        }
        if (mol && mol.formula === 'CO\u2082' && order === 2 && ((a === 'C' && b === 'O') || (a === 'O' && b === 'C'))) {
            return { label: 'C=O(CO\u2082)', ...this.bondData['C-O|2-co2'] };
        }
        const key = a + '-' + b + '|' + order;
        const data = this.bondData[key];
        if (!data) return null;
        const orderSym = order === 1 ? '\u2014' : (order === 2 ? '=' : '\u2261');
        return { label: a + orderSym + b, ...data };
    },

    // 收集分子内所有不重复键，附加平均实际键长（用于与表值对比）
    _collectBondParams(mol) {
        const groups = new Map();
        mol.bonds.forEach(([i, j, order]) => {
            const a = mol.atoms[i], b = mol.atoms[j];
            const info = this._lookupBond(a.el, b.el, order, mol);
            if (!info) return;
            const dist = Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2 + (a.z-b.z)**2);
            const k = info.label;
            if (!groups.has(k)) groups.set(k, { info, count: 0, sumDist: 0 });
            const g = groups.get(k);
            g.count++; g.sumDist += dist;
        });
        return Array.from(groups.values()).map(g => ({
            ...g.info, count: g.count, modelDist: g.sumDist / g.count
        }));
    },

    updateInfo() {
        const el = document.getElementById('mol-info');
        if (!el || !this.molecule) return;
        const mol = this.molecule;
        const atomCounts = {};
        mol.atoms.forEach(a => { atomCounts[a.el] = (atomCounts[a.el] || 0) + 1; });
        const bondTypes = { 1: 0, 2: 0, 3: 0 };
        mol.bonds.forEach(([,,o]) => { bondTypes[o] = (bondTypes[o] || 0) + 1; });

        let html = '<div class="mol-info-title">' + mol.name + '</div>';
        html += '<div class="mol-info-desc">' + mol.desc + '</div>';
        html += '<div class="mol-info-row"><span class="mol-info-label">\u539f\u5b50\u6570</span><span>' + mol.atoms.length + '</span></div>';
        html += '<div class="mol-info-row"><span class="mol-info-label">\u7ec4\u6210</span><span>';
        for (const [elem, count] of Object.entries(atomCounts)) {
            const style = this.atomStyles[elem];
            html += '<span class="mol-atom-badge" style="background:' + (style ? style.color : '#aaa') + ';color:' + (elem === 'H' ? '#333' : '#fff') + '">' + elem + '</span> \u00d7' + count + ' ';
        }
        html += '</span></div>';
        html += '<div class="mol-info-row"><span class="mol-info-label">\u5316\u5b66\u952e</span><span>';
        if (bondTypes[1]) html += '\u5355\u952e \u00d7' + bondTypes[1] + ' ';
        if (bondTypes[2]) html += '\u53cc\u952e \u00d7' + bondTypes[2] + ' ';
        if (bondTypes[3]) html += '\u4e09\u952e \u00d7' + bondTypes[3];
        html += '</span></div>';
        if (mol.hybridization) html += '<div class="mol-info-row"><span class="mol-info-label">\u6742\u5316</span><span>' + mol.hybridization + '</span></div>';
        html += '<div class="mol-info-row"><span class="mol-info-label">\u6781\u6027</span><span>' + (mol.polarity || '-') + '</span></div>';
        html += '<div class="mol-info-row"><span class="mol-info-label">\u5206\u5b50\u6784\u578b</span><span>' + (mol.shape || '-') + '</span></div>';

        // 键参数表（v4.5.0-α4 新增）
        const bondParams = this._collectBondParams(mol);
        if (bondParams.length > 0) {
            html += '<div class="mol-bondparams">';
            html += '<div class="mol-bondparams__title">\u952e\u53c2\u6570 <span class="mol-bondparams__sub">\u952e\u957f\u00a0\u00b7\u00a0\u952e\u80fd\u00a0\u00b7\u00a0\u7c7b\u578b</span></div>';
            html += '<table class="mol-bondparams__tbl">';
            html += '<thead><tr><th>\u952e</th><th>\u00d7</th><th>\u952e\u957f / \u00c5</th><th>\u952e\u80fd / kJ\u00b7mol\u207b\u00b9</th><th>\u7c7b\u578b</th></tr></thead><tbody>';
            bondParams.forEach(p => {
                html += '<tr>'
                    + '<td class="mol-bondparams__bond">' + p.label + '</td>'
                    + '<td>' + p.count + '</td>'
                    + '<td>' + p.length.toFixed(2) + '</td>'
                    + '<td>' + p.energy + '</td>'
                    + '<td class="mol-bondparams__type">' + p.type + '</td>'
                    + '</tr>';
            });
            html += '</tbody></table>';
            html += '<div class="mol-bondparams__hint">\u{1F4A1} \u952e\u957f\u8d8a\u77ed\u00a0\u00b7\u00a0\u952e\u80fd\u8d8a\u5927 \u2192 \u952e\u8d8a\u7a33\u5b9a\u3002\u540c\u5143\u7d20\u4e0d\u540c\u952e\u7ea7\uff1a\u4e09\u952e>\u53cc\u952e>\u5355\u952e</div>';
            html += '</div>';
        }

        // 对比面板（v4.5.0-α5：H₂S vs H₂O 等同族对比）
        if (mol.compareWith && this.molecules[mol.compareWith]) {
            const ref = this.molecules[mol.compareWith];
            const myParams = bondParams[0]; // 取首条键作为对比
            const refParams = this._collectBondParams(ref)[0];
            if (myParams && refParams) {
                html += '<div class="mol-compare">';
                html += '<div class="mol-compare__title">\u{1F50D} \u4e0e <b>' + ref.formula + '</b> \u5bf9\u6bd4 \u00b7 <span class="mol-compare__sub">\u540c\u65cf\u5143\u7d20 / \u4e0d\u540c\u4e2d\u5fc3\u539f\u5b50</span></div>';
                html += '<table class="mol-compare__tbl"><thead><tr>'
                    + '<th>\u5bf9\u6bd4\u9879</th>'
                    + '<th>' + mol.formula + '</th>'
                    + '<th>' + ref.formula + '</th>'
                    + '</tr></thead><tbody>';
                html += '<tr><td>\u4e3b\u952e</td><td>' + myParams.label + '</td><td>' + refParams.label + '</td></tr>';
                html += '<tr><td>\u952e\u957f / \u00c5</td><td>' + myParams.length.toFixed(2) + '</td><td>' + refParams.length.toFixed(2) + '</td></tr>';
                html += '<tr><td>\u952e\u80fd / kJ\u00b7mol\u207b\u00b9</td><td>' + myParams.energy + '</td><td>' + refParams.energy + '</td></tr>';
                html += '<tr><td>\u952e\u89d2</td><td>' + (mol.bondAngle || '\u2014') + '</td><td>' + (ref.bondAngle || '\u2014') + '</td></tr>';
                html += '<tr><td>\u6742\u5316</td><td>' + (mol.hybridization || '\u2014') + '</td><td>' + (ref.hybridization || '\u2014') + '</td></tr>';
                html += '<tr><td>\u6781\u6027</td><td>' + (mol.polarity || '\u2014') + '</td><td>' + (ref.polarity || '\u2014') + '</td></tr>';
                html += '</tbody></table>';
                html += '<div class="mol-compare__hint">\u{1F4A1} \u540c\u4e3b\u65cf\u5143\u7d20\u539f\u5b50\u534a\u5f84\u589e\u5927 \u2192 \u952e\u957f\u589e\u957f\u3001\u952e\u80fd\u51cf\u5c0f\u3002\u539f\u5b50\u7535\u8d1f\u6027\u51cf\u5c0f \u2192 \u952e\u6781\u6027\u51cf\u5f31\uff1b\u6742\u5316\u7a0b\u5ea6\u51cf\u5f31 \u2192 \u952e\u89d2\u63a5\u8fd1 90\u00b0</div>';
                html += '</div>';
            }
        }

        // Educational panel
        const hybMap = {
            'sp3': '1个s + 3个p轨道杂化 → 4个等价sp³杂化轨道，键角≈109.5°（正四面体）',
            'sp2': '1个s + 2个p轨道杂化 → 3个等价sp²杂化轨道，键角≈120°（平面三角形），剩余p轨道形成π键',
            'sp': '1个s + 1个p轨道杂化 → 2个等价sp杂化轨道，键角=180°（直线形），剩余2个p轨道形成π键'
        };
        const hybKey = mol.hybridization ? mol.hybridization.toLowerCase().replace(/[³²]/g, m => m === '³' ? '3' : '2') : '';
        // v4.5.0-α5：molecule.hybNote 优先（用于 H₂S 不杂化、CH₃COOH 混合杂化等特殊情况）
        const hybDesc = mol.hybNote || hybMap[hybKey] || (mol.hybridization ? mol.hybridization + ' 杂化' : '—');
        const polarDesc = mol.polarity === '非极性' || mol.polarity === '非极性分子'
            ? '分子中正负电荷中心重合，偶极矩μ=0。判据：高对称结构（如正四面体CH₄、直线形CO₂）键的极性相互抵消'
            : '分子中正负电荷中心不重合，偶极矩μ≠0。极性越强→沸点越高、水溶性越强';

        html += '<div class="mol-edu">';
        html += '<div class="chem-hd"><span class="chem-tag">\u5206\u5b50\u7ed3\u6784</span>VSEPR 理论与杂化轨道</div>';
        html += '<div class="chem-row"><span class="chem-key">\u6742\u5316\u89e3\u8bfb</span>' + hybDesc + '</div>';
        html += '<div class="chem-row"><span class="chem-key chem-key--amber">\u6781\u6027\u5206\u6790</span>' + polarDesc + '</div>';
        html += '<div class="chem-row"><span class="chem-key chem-key--purple">VSEPR</span>价层电子对互斥理论：孤对电子排斥 > 成键电子对排斥，孤对越多→键角越小</div>';
        html += '<div class="chem-note">💡 共价键：原子间通过共用电子对形成；σ键（头碰头重叠）可自由旋转，π键（肩并肩重叠）限制旋转。双键 = 1σ+1π，三键 = 1σ+2π</div>';
        html += '</div>';

        el.innerHTML = html;
    }
};

function initMoleculeVis() {
    MoleculeVis.init();
}