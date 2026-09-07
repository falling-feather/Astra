// ===== Chemical Reactions Visualization — v2 with Bond Mechanics =====
const ChemReaction = {
    canvas: null,
    ctx: null,
    W: 0, H: 0,
    molecules: [],   // molecules with internal structure + bonds
    animId: null,
    running: false,
    progress: 0,     // 0 → 1
    speed: 1,
    currentReaction: null,
    _lastTime: 0,

    atomStyles: {
        H:  { color: '#ffffff', r: 8,  textColor: '#333' },
        O:  { color: '#FF0D0D', r: 13, textColor: '#fff' },
        C:  { color: '#555555', r: 14, textColor: '#fff' },
        N:  { color: '#3050F8', r: 13, textColor: '#fff' },
        Na: { color: '#AB5CF2', r: 15, textColor: '#fff' },
        Cl: { color: '#1FF01F', r: 15, textColor: '#333' },
        Fe: { color: '#E06633', r: 16, textColor: '#fff' },
        S:  { color: '#FFFF30', r: 14, textColor: '#333' },
        Ca: { color: '#3DFF00', r: 16, textColor: '#333' },
        Cu: { color: '#C88033', r: 16, textColor: '#fff' }
    },

    // Bond types for visual distinction
    BOND_SINGLE: 1,
    BOND_DOUBLE: 2,
    BOND_TRIPLE: 3,
    BOND_IONIC:  4,
    BOND_HYDROGEN: 5,

    /*
     * Each reaction defines:
     *   reactantMols: array of molecule definitions (with atoms, bonds, positions)
     *   productMols:  array of molecule definitions
     *   bondBreaks:   which bonds in reactants break (indices)
     *   bondForms:    which bonds in products form (indices)
     *   atomMap:      mapping from reactant atom index → product atom index
     */
    reactions: {
        combustion: {
            name: '甲烷燃烧',
            equation: 'CH₄ + 2O₂ → CO₂ + 2H₂O',
            desc: '碳氢化合物与氧气反应，C-H键断裂，形成C=O和O-H键',
            type: '放热',
            energy: -890,
            unit: 'kJ/mol',
            activationEnergy: 150,
            mechanism: 'C-H键断裂 → C与O结合(C=O) → H与O结合(O-H)',
            reactantMols: [
                {
                    formula: 'CH₄', cx: 0.20, cy: 0.45,
                    atoms: [
                        { el: 'C', lx: 0, ly: 0 },
                        { el: 'H', lx: -1, ly: -0.7 },
                        { el: 'H', lx: 1, ly: -0.7 },
                        { el: 'H', lx: -1, ly: 0.7 },
                        { el: 'H', lx: 1, ly: 0.7 }
                    ],
                    bonds: [
                        { a: 0, b: 1, type: 1 },
                        { a: 0, b: 2, type: 1 },
                        { a: 0, b: 3, type: 1 },
                        { a: 0, b: 4, type: 1 }
                    ]
                },
                {
                    formula: 'O₂', cx: 0.38, cy: 0.30,
                    atoms: [
                        { el: 'O', lx: -0.5, ly: 0 },
                        { el: 'O', lx: 0.5, ly: 0 }
                    ],
                    bonds: [ { a: 0, b: 1, type: 2 } ]
                },
                {
                    formula: 'O₂', cx: 0.38, cy: 0.65,
                    atoms: [
                        { el: 'O', lx: -0.5, ly: 0 },
                        { el: 'O', lx: 0.5, ly: 0 }
                    ],
                    bonds: [ { a: 0, b: 1, type: 2 } ]
                }
            ],
            productMols: [
                {
                    formula: 'CO₂', cx: 0.68, cy: 0.35,
                    atoms: [
                        { el: 'O', lx: -0.9, ly: 0 },
                        { el: 'C', lx: 0, ly: 0 },
                        { el: 'O', lx: 0.9, ly: 0 }
                    ],
                    bonds: [
                        { a: 0, b: 1, type: 2 },
                        { a: 1, b: 2, type: 2 }
                    ]
                },
                {
                    formula: 'H₂O', cx: 0.80, cy: 0.25,
                    atoms: [
                        { el: 'H', lx: -0.65, ly: 0.4 },
                        { el: 'O', lx: 0, ly: 0 },
                        { el: 'H', lx: 0.65, ly: 0.4 }
                    ],
                    bonds: [
                        { a: 0, b: 1, type: 1 },
                        { a: 1, b: 2, type: 1 }
                    ]
                },
                {
                    formula: 'H₂O', cx: 0.80, cy: 0.60,
                    atoms: [
                        { el: 'H', lx: -0.65, ly: 0.4 },
                        { el: 'O', lx: 0, ly: 0 },
                        { el: 'H', lx: 0.65, ly: 0.4 }
                    ],
                    bonds: [
                        { a: 0, b: 1, type: 1 },
                        { a: 1, b: 2, type: 1 }
                    ]
                }
            ]
        },
        synthesis: {
            name: '合成氨',
            equation: 'N₂ + 3H₂ → 2NH₃',
            desc: '哈伯法：N≡N三键断裂，H-H键断裂，形成N-H键',
            type: '放热',
            energy: -92,
            unit: 'kJ/mol',
            activationEnergy: 230,
            mechanism: 'N≡N三键断裂(946kJ/mol) + H-H键断裂 → N-H键形成',
            reactantMols: [
                {
                    formula: 'N₂', cx: 0.20, cy: 0.45,
                    atoms: [
                        { el: 'N', lx: -0.4, ly: 0 },
                        { el: 'N', lx: 0.4, ly: 0 }
                    ],
                    bonds: [ { a: 0, b: 1, type: 3 } ]
                },
                {
                    formula: 'H₂', cx: 0.36, cy: 0.25,
                    atoms: [ { el: 'H', lx: -0.3, ly: 0 }, { el: 'H', lx: 0.3, ly: 0 } ],
                    bonds: [ { a: 0, b: 1, type: 1 } ]
                },
                {
                    formula: 'H₂', cx: 0.36, cy: 0.50,
                    atoms: [ { el: 'H', lx: -0.3, ly: 0 }, { el: 'H', lx: 0.3, ly: 0 } ],
                    bonds: [ { a: 0, b: 1, type: 1 } ]
                },
                {
                    formula: 'H₂', cx: 0.36, cy: 0.72,
                    atoms: [ { el: 'H', lx: -0.3, ly: 0 }, { el: 'H', lx: 0.3, ly: 0 } ],
                    bonds: [ { a: 0, b: 1, type: 1 } ]
                }
            ],
            productMols: [
                {
                    formula: 'NH₃', cx: 0.70, cy: 0.32,
                    atoms: [
                        { el: 'N', lx: 0, ly: -0.2 },
                        { el: 'H', lx: -0.65, ly: 0.45 },
                        { el: 'H', lx: 0.65, ly: 0.45 },
                        { el: 'H', lx: 0, ly: 0.75 }
                    ],
                    bonds: [
                        { a: 0, b: 1, type: 1 },
                        { a: 0, b: 2, type: 1 },
                        { a: 0, b: 3, type: 1 }
                    ]
                },
                {
                    formula: 'NH₃', cx: 0.70, cy: 0.65,
                    atoms: [
                        { el: 'N', lx: 0, ly: -0.2 },
                        { el: 'H', lx: -0.65, ly: 0.45 },
                        { el: 'H', lx: 0.65, ly: 0.45 },
                        { el: 'H', lx: 0, ly: 0.75 }
                    ],
                    bonds: [
                        { a: 0, b: 1, type: 1 },
                        { a: 0, b: 2, type: 1 },
                        { a: 0, b: 3, type: 1 }
                    ]
                }
            ]
        },
        neutralization: {
            // v4.5.0-α6 重做：强酸强碱中和的本质是 H⁺ + OH⁻ → H₂O，
            // Na⁺/Cl⁻ 在水中始终以水合离子形式存在，是「旁观离子」
            name: '强酸强碱中和（离子方程式）',
            equation: 'H⁺ + OH⁻ → H₂O　|　Na⁺、Cl⁻ 旁观',
            fullEquation: '总式：HCl + NaOH → NaCl + H₂O',
            desc: '强酸 HCl、强碱 NaOH、强电解质 NaCl 在水中均完全电离 → 溶液中实际存在 4 种自由水合离子（H⁺、OH⁻、Na⁺、Cl⁻）；只有 H⁺ 与 OH⁻ 通过静电吸引结合成水分子，Na⁺/Cl⁻ 不参与反应（旁观离子）。蒸发后才得到 NaCl 晶体。',
            type: '放热',
            energy: -57.3,
            unit: 'kJ/mol',
            activationEnergy: 20,
            mechanism: '4 种自由水合离子游动 → H⁺ 与 OH⁻ 静电吸引 → 形成 O—H 共价键 → H₂O 分子；Na⁺、Cl⁻ 始终游离',
            reactantMols: [
                {
                    formula: 'H⁺', cx: 0.15, cy: 0.30,
                    atoms: [{ el: 'H', lx: 0, ly: 0, charge: '+' }],
                    bonds: []
                },
                {
                    formula: 'OH⁻', cx: 0.15, cy: 0.65,
                    atoms: [
                        { el: 'O', lx: 0, ly: 0, charge: '-' },
                        { el: 'H', lx: 0.6, ly: 0.32 }
                    ],
                    bonds: [{ a: 0, b: 1, type: 1 }]
                },
                {
                    formula: 'Na⁺', cx: 0.34, cy: 0.30,
                    atoms: [{ el: 'Na', lx: 0, ly: 0, charge: '+' }],
                    bonds: [],
                    spectator: true
                },
                {
                    formula: 'Cl⁻', cx: 0.34, cy: 0.65,
                    atoms: [{ el: 'Cl', lx: 0, ly: 0, charge: '-' }],
                    bonds: [],
                    spectator: true
                }
            ],
            productMols: [
                {
                    formula: 'H₂O', cx: 0.72, cy: 0.32,
                    atoms: [
                        { el: 'H', lx: -0.6, ly: 0.35 },
                        { el: 'O', lx: 0, ly: 0 },
                        { el: 'H', lx: 0.6, ly: 0.35 }
                    ],
                    bonds: [
                        { a: 0, b: 1, type: 1 },
                        { a: 1, b: 2, type: 1 }
                    ]
                },
                {
                    formula: 'Na⁺', cx: 0.66, cy: 0.65,
                    atoms: [{ el: 'Na', lx: 0, ly: 0, charge: '+' }],
                    bonds: [],
                    spectator: true
                },
                {
                    formula: 'Cl⁻', cx: 0.82, cy: 0.65,
                    atoms: [{ el: 'Cl', lx: 0, ly: 0, charge: '-' }],
                    bonds: [],
                    spectator: true
                }
            ]
        },
        decomposition: {
            name: '碳酸钙分解',
            equation: 'CaCO₃ → CaO + CO₂',
            desc: '高温下离子键与共价键同时断裂，需要大量热能',
            type: '吸热',
            energy: 178,
            unit: 'kJ/mol',
            activationEnergy: 300,
            mechanism: 'Ca-O离子键断裂 + C-O键部分断裂 → CaO离子键 + C=O双键形成',
            reactantMols: [
                {
                    formula: 'CaCO₃', cx: 0.25, cy: 0.48,
                    atoms: [
                        { el: 'Ca', lx: -1.1, ly: 0 },
                        { el: 'C', lx: 0, ly: 0 },
                        { el: 'O', lx: 0.9, ly: 0 },
                        { el: 'O', lx: 0, ly: 0.8 },
                        { el: 'O', lx: -0.5, ly: -0.7 }
                    ],
                    bonds: [
                        { a: 0, b: 4, type: 4 },
                        { a: 1, b: 2, type: 2 },
                        { a: 1, b: 3, type: 1 },
                        { a: 1, b: 4, type: 1 }
                    ]
                }
            ],
            productMols: [
                {
                    formula: 'CaO', cx: 0.65, cy: 0.38,
                    atoms: [
                        { el: 'Ca', lx: -0.5, ly: 0 },
                        { el: 'O', lx: 0.5, ly: 0 }
                    ],
                    bonds: [ { a: 0, b: 1, type: 4 } ]
                },
                {
                    formula: 'CO₂', cx: 0.72, cy: 0.62,
                    atoms: [
                        { el: 'O', lx: -0.85, ly: 0 },
                        { el: 'C', lx: 0, ly: 0 },
                        { el: 'O', lx: 0.85, ly: 0 }
                    ],
                    bonds: [
                        { a: 0, b: 1, type: 2 },
                        { a: 1, b: 2, type: 2 }
                    ]
                }
            ]
        },
        redox: {
            // v4.5.0-α7 重做：金属置换的本质是 Fe + Cu²⁺ → Fe²⁺ + Cu，SO₄²⁻ 是旁观离子
            name: '铁与硫酸铜（离子方程式）',
            equation: 'Fe + Cu²⁺ → Fe²⁺ + Cu　|　SO₄²⁻ 旁观',
            fullEquation: '总式：Fe + CuSO₄ → FeSO₄ + Cu',
            desc: '金属活动性 Fe > Cu：Fe 失 2e⁻ 被氧化为 Fe²⁺；Cu²⁺ 得 2e⁻ 被还原为 Cu 单质沉积。SO₄²⁻ 在反应前后均为水合离子，是旁观离子。',
            type: '放热',
            energy: -153,
            unit: 'kJ/mol',
            activationEnergy: 60,
            mechanism: 'Fe 表面失 2e⁻ → 电子经金属导通转给水合 Cu²⁺ → Cu²⁺ 还原为 Cu；SO₄²⁻ 始终游离',
            // 电子转移可视化（α7）：从反应物 mol 0 中心 → mol 1 中心
            electronTransfer: { fromMol: 0, toMol: 1, count: 2, label: '2e⁻' },
            reactantMols: [
                {
                    formula: 'Fe', cx: 0.15, cy: 0.45,
                    atoms: [{ el: 'Fe', lx: 0, ly: 0 }],
                    bonds: []
                },
                {
                    formula: 'Cu²⁺', cx: 0.32, cy: 0.30,
                    atoms: [{ el: 'Cu', lx: 0, ly: 0, charge: '²⁺' }],
                    bonds: []
                },
                {
                    formula: 'SO₄²⁻', cx: 0.32, cy: 0.68,
                    atoms: [
                        { el: 'S', lx: 0, ly: 0 },
                        { el: 'O', lx: 0.7, ly: 0 },
                        { el: 'O', lx: -0.7, ly: 0 },
                        { el: 'O', lx: 0, ly: 0.7 },
                        { el: 'O', lx: 0, ly: -0.7, charge: '²⁻' }
                    ],
                    bonds: [
                        { a: 0, b: 1, type: 1 },
                        { a: 0, b: 2, type: 2 },
                        { a: 0, b: 3, type: 1 },
                        { a: 0, b: 4, type: 1 }
                    ],
                    spectator: true
                }
            ],
            productMols: [
                {
                    formula: 'Fe²⁺', cx: 0.66, cy: 0.30,
                    atoms: [{ el: 'Fe', lx: 0, ly: 0, charge: '²⁺' }],
                    bonds: []
                },
                {
                    formula: 'Cu', cx: 0.85, cy: 0.45,
                    atoms: [{ el: 'Cu', lx: 0, ly: 0 }],
                    bonds: []
                },
                {
                    formula: 'SO₄²⁻', cx: 0.70, cy: 0.68,
                    atoms: [
                        { el: 'S', lx: 0, ly: 0 },
                        { el: 'O', lx: 0.7, ly: 0 },
                        { el: 'O', lx: -0.7, ly: 0 },
                        { el: 'O', lx: 0, ly: 0.7 },
                        { el: 'O', lx: 0, ly: -0.7, charge: '²⁻' }
                    ],
                    bonds: [
                        { a: 0, b: 1, type: 1 },
                        { a: 0, b: 2, type: 2 },
                        { a: 0, b: 3, type: 1 },
                        { a: 0, b: 4, type: 1 }
                    ],
                    spectator: true
                }
            ]
        },
        // ============ v4.5.0-α7 新增：NaCl 在水中溶解 ============
        dissolution: {
            name: 'NaCl 溶解（物理过程）',
            equation: 'NaCl(s) → Na⁺(aq) + Cl⁻(aq)',
            fullEquation: '关键：仅 Na—Cl 离子键断裂，H₂O 中的 O—H 共价键完整保留',
            desc: 'NaCl 晶体投入水中后，水分子的极性端（O 朝向 Na⁺、H 朝向 Cl⁻）削弱并断裂 Na—Cl 离子键，Na⁺、Cl⁻ 被水分子包裹形成水合离子。整个过程不破坏 H₂O 内部的 O—H 共价键 —— 这是「溶解」与「电离」相对于「化学反应」的关键区别。',
            type: '微弱吸热',
            energy: 4,
            unit: 'kJ/mol',
            activationEnergy: 8,
            mechanism: '水分子极性端取向吸引 → Na—Cl 离子键断裂 → 形成水合 Na⁺ 与水合 Cl⁻；O—H 共价键全程不断',
            reactantMols: [
                {
                    formula: 'NaCl(s)', cx: 0.20, cy: 0.45,
                    atoms: [
                        { el: 'Na', lx: -0.5, ly: 0, charge: '+' },
                        { el: 'Cl', lx: 0.5, ly: 0, charge: '-' }
                    ],
                    bonds: [{ a: 0, b: 1, type: 4 }]
                },
                { formula: 'H₂O', cx: 0.10, cy: 0.20,
                    atoms: [{ el: 'H', lx: -0.5, ly: 0.3 }, { el: 'O', lx: 0, ly: 0 }, { el: 'H', lx: 0.5, ly: 0.3 }],
                    bonds: [{ a: 0, b: 1, type: 1 }, { a: 1, b: 2, type: 1 }] },
                { formula: 'H₂O', cx: 0.10, cy: 0.72,
                    atoms: [{ el: 'H', lx: -0.5, ly: 0.3 }, { el: 'O', lx: 0, ly: 0 }, { el: 'H', lx: 0.5, ly: 0.3 }],
                    bonds: [{ a: 0, b: 1, type: 1 }, { a: 1, b: 2, type: 1 }] },
                { formula: 'H₂O', cx: 0.36, cy: 0.20,
                    atoms: [{ el: 'H', lx: -0.5, ly: 0.3 }, { el: 'O', lx: 0, ly: 0 }, { el: 'H', lx: 0.5, ly: 0.3 }],
                    bonds: [{ a: 0, b: 1, type: 1 }, { a: 1, b: 2, type: 1 }] },
                { formula: 'H₂O', cx: 0.36, cy: 0.72,
                    atoms: [{ el: 'H', lx: -0.5, ly: 0.3 }, { el: 'O', lx: 0, ly: 0 }, { el: 'H', lx: 0.5, ly: 0.3 }],
                    bonds: [{ a: 0, b: 1, type: 1 }, { a: 1, b: 2, type: 1 }] }
            ],
            productMols: [
                {
                    formula: 'Na⁺(aq)', cx: 0.65, cy: 0.30,
                    atoms: [{ el: 'Na', lx: 0, ly: 0, charge: '+' }],
                    bonds: []
                },
                {
                    formula: 'Cl⁻(aq)', cx: 0.85, cy: 0.62,
                    atoms: [{ el: 'Cl', lx: 0, ly: 0, charge: '-' }],
                    bonds: []
                },
                { formula: 'H₂O', cx: 0.58, cy: 0.18,
                    atoms: [{ el: 'H', lx: -0.5, ly: 0.3 }, { el: 'O', lx: 0, ly: 0 }, { el: 'H', lx: 0.5, ly: 0.3 }],
                    bonds: [{ a: 0, b: 1, type: 1 }, { a: 1, b: 2, type: 1 }] },
                { formula: 'H₂O', cx: 0.78, cy: 0.18,
                    atoms: [{ el: 'H', lx: -0.5, ly: 0.3 }, { el: 'O', lx: 0, ly: 0 }, { el: 'H', lx: 0.5, ly: 0.3 }],
                    bonds: [{ a: 0, b: 1, type: 1 }, { a: 1, b: 2, type: 1 }] },
                { formula: 'H₂O', cx: 0.62, cy: 0.78,
                    atoms: [{ el: 'H', lx: -0.5, ly: 0.3 }, { el: 'O', lx: 0, ly: 0 }, { el: 'H', lx: 0.5, ly: 0.3 }],
                    bonds: [{ a: 0, b: 1, type: 1 }, { a: 1, b: 2, type: 1 }] },
                { formula: 'H₂O', cx: 0.92, cy: 0.42,
                    atoms: [{ el: 'H', lx: -0.5, ly: 0.3 }, { el: 'O', lx: 0, ly: 0 }, { el: 'H', lx: 0.5, ly: 0.3 }],
                    bonds: [{ a: 0, b: 1, type: 1 }, { a: 1, b: 2, type: 1 }] }
            ]
        }
    },

    init() {
        this.canvas = document.getElementById('rxn-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        this.loadReaction('combustion');
        this.bindControls();
        // Use ResizeObserver so buildScene runs when section becomes visible
        if (typeof ResizeObserver !== 'undefined') {
            this._ro = new ResizeObserver(() => { this.resize(); if (!this.running) this.draw(); });
            this._ro.observe(this.canvas.parentElement);
        }
    },

    destroy() {
        this.stop();
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
    },

    resize() {
        const wrap = this.canvas.parentElement;
        if (!wrap) return;
        const w = wrap.clientWidth;
        if (w === 0) return; // Section not visible yet
        const h = Math.min(w * 0.55, 400);
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const needRebuild = (this.W !== w || this.H !== h);
        this.W = w;
        this.H = h;
        if (needRebuild && this.currentReaction) this.buildScene();
    },

    bindControls() {
        document.querySelectorAll('.rxn-select-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.rxn-select-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.loadReaction(btn.dataset.rxn);
            });
        });

        const playBtn = document.getElementById('rxn-play');
        if (playBtn) playBtn.addEventListener('click', () => this.play());

        const resetBtn = document.getElementById('rxn-reset');
        if (resetBtn) resetBtn.addEventListener('click', () => this.reset());

        const speedSlider = document.getElementById('rxn-speed');
        if (speedSlider) speedSlider.addEventListener('input', () => {
            this.speed = parseFloat(speedSlider.value);
        });
    },

    loadReaction(key) {
        this.currentReaction = this.reactions[key];
        if (!this.currentReaction) return;
        this.stop();
        this.progress = 0;
        this.buildScene();
        this.draw();
        this.updateInfo();
        this.updateEnergyBar();
    },

    // Build the rendering scene from current reaction data
    buildScene() {
        const rxn = this.currentReaction;
        const scale = 42;
        this.reactantAtoms = [];
        this.reactantBonds = [];
        this.productAtoms = [];
        this.productBonds = [];

        // Build reactant atoms with absolute positions
        rxn.reactantMols.forEach((mol, molIdx) => {
            const cx = mol.cx * this.W;
            const cy = mol.cy * this.H;
            const atomStart = this.reactantAtoms.length;
            mol.atoms.forEach(a => {
                this.reactantAtoms.push({
                    el: a.el,
                    x: cx + a.lx * scale,
                    y: cy + a.ly * scale,
                    formula: mol.formula,
                    charge: a.charge || null,
                    spectator: !!mol.spectator,
                    molIdx: molIdx
                });
            });
            mol.bonds.forEach(b => {
                this.reactantBonds.push({
                    a: atomStart + b.a,
                    b: atomStart + b.b,
                    type: b.type
                });
            });
        });

        // Build product atoms with absolute positions
        rxn.productMols.forEach(mol => {
            const cx = mol.cx * this.W;
            const cy = mol.cy * this.H;
            const atomStart = this.productAtoms.length;
            mol.atoms.forEach(a => {
                this.productAtoms.push({
                    el: a.el,
                    x: cx + a.lx * scale,
                    y: cy + a.ly * scale,
                    formula: mol.formula,
                    charge: a.charge || null,
                    spectator: !!mol.spectator
                });
            });
            mol.bonds.forEach(b => {
                this.productBonds.push({
                    a: atomStart + b.a,
                    b: atomStart + b.b,
                    type: b.type
                });
            });
        });
    },

    play() {
        if (this.running) return;
        if (this.progress >= 1) this.progress = 0;
        this.running = true;
        const btn = document.getElementById('rxn-play');
        if (btn) btn.textContent = '反应中...';

        this._lastTime = performance.now();
        const animate = (now) => {
            const rawDt = (now - this._lastTime) / 1000;
            this._lastTime = now;
            const dt = Math.min(rawDt, 0.1);

            this.progress += 0.18 * this.speed * dt;
            if (this.progress >= 1) {
                this.progress = 1;
                this.running = false;
                if (btn) btn.textContent = '▶ 开始反应';
            }
            this.draw();
            this.updateEnergyBar();
            if (this.running) {
                this.animId = requestAnimationFrame(animate);
            }
        };
        this.animId = requestAnimationFrame(animate);
    },

    stop() {
        if (this.animId) {
            cancelAnimationFrame(this.animId);
            this.animId = null;
        }
        this.running = false;
        const btn = document.getElementById('rxn-play');
        if (btn) btn.textContent = '▶ 开始反应';
    },

    reset() {
        this.stop();
        this.progress = 0;
        this.buildScene();
        this.draw();
        this.updateEnergyBar();
    },

    /*
     * Animation phases:
     *   0.00-0.25: Reactants intact, molecules approach center
     *   0.25-0.45: Bonds breaking — bonds become dashed, then vanish; atoms separate
     *   0.45-0.55: Transition zone — free atoms rearrange, flash effect
     *   0.55-0.75: Bonds forming — new bonds appear as dashed, then solidify
     *   0.75-1.00: Products move to final positions
     */
    draw() {
        const { ctx, W, H, progress: t } = this;
        if (!this.currentReaction) return;
        ctx.clearRect(0, 0, W, H);

        // Dark background
        ctx.fillStyle = '#0d1017';
        ctx.fillRect(0, 0, W, H);

        // Phase markers along bottom
        this._drawPhaseIndicator(ctx, t);

        // Reaction flash in transition zone
        if (t > 0.35 && t < 0.65) {
            const intensity = 1 - Math.abs(t - 0.50) / 0.15;
            const rxn = this.currentReaction;
            const flashColor = rxn.type === '放热'
                ? `rgba(255,120,30,${intensity * 0.3})`
                : `rgba(100,180,255,${intensity * 0.3})`;
            const grd = ctx.createRadialGradient(W * 0.5, H * 0.5, 0, W * 0.5, H * 0.5, W * 0.25);
            grd.addColorStop(0, flashColor);
            grd.addColorStop(1, 'transparent');
            ctx.fillStyle = grd;
            ctx.fillRect(0, 0, W, H);
        }

        // Center arrow
        ctx.save();
        ctx.fillStyle = `rgba(255,255,255,${0.08 + 0.12 * Math.sin(t * Math.PI)})`;
        ctx.font = '30px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⟶', W * 0.5, H * 0.48);
        ctx.restore();

        // Draw molecules based on phase
        if (t < 0.25) {
            // Phase 1: reactants approach center
            const localT = t / 0.25;
            const drift = localT * 0.08;
            this._drawMolecules(ctx, this.reactantAtoms, this.reactantBonds, drift, 0, 1.0);
        } else if (t < 0.45) {
            // Phase 2: bonds breaking
            const localT = (t - 0.25) / 0.20;
            const bondOpacity = 1.0 - localT;
            const drift = 0.08;
            const shake = localT * 6;
            this._drawMolecules(ctx, this.reactantAtoms, this.reactantBonds, drift, shake, bondOpacity, true);
        } else if (t < 0.55) {
            // Phase 3: free atoms in transition — draw scattered atoms with no bonds
            const localT = (t - 0.45) / 0.10;
            this._drawFreeAtoms(ctx, localT);
        } else if (t < 0.75) {
            // Phase 4: bonds forming
            const localT = (t - 0.55) / 0.20;
            const bondOpacity = localT;
            const drift = (1 - localT) * 0.05;
            this._drawMolecules(ctx, this.productAtoms, this.productBonds, -drift, 0, bondOpacity, localT < 0.5);
        } else {
            // Phase 5: products settle
            const localT = (t - 0.75) / 0.25;
            const settle = (1 - localT) * 0.02;
            this._drawMolecules(ctx, this.productAtoms, this.productBonds, -settle, 0, 1.0);
        }

        // 电子转移动画（v4.5.0-α7）：相 2-3 期间绘制
        if (this.currentReaction.electronTransfer && t >= 0.25 && t <= 0.60) {
            this._drawElectronTransfer(ctx, t);
        }

        // Equation
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '18px ' + CF.mono;
        ctx.textAlign = 'center';
        const hasFull = !!this.currentReaction.fullEquation;
        ctx.fillText(this.currentReaction.equation, W / 2, hasFull ? H - 28 : H - 14);
        // 总式（v4.5.0-α6：离子方程式之外可补充总式）
        if (hasFull) {
            ctx.fillStyle = 'rgba(255,255,255,0.32)';
            ctx.font = '12px ' + CF.mono;
            ctx.fillText(this.currentReaction.fullEquation, W / 2, H - 10);
        }

        // Mechanism text during breaking/forming phases
        if (t > 0.20 && t < 0.80) {
            const mechOpacity = Math.min(1, Math.min((t - 0.20) / 0.1, (0.80 - t) / 0.1));
            ctx.fillStyle = `rgba(255,200,100,${mechOpacity * 0.7})`;
            ctx.font = '16px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.fillText(this.currentReaction.mechanism, W / 2, hasFull ? H - 48 : H - 34);
        }

        // Energy diagram (mini, top-right)
        this._drawEnergyDiagram(ctx, t);
    },

    _drawPhaseIndicator(ctx, t) {
        const y = 12;
        const left = this.W * 0.15;
        const right = this.W * 0.85;
        const width = right - left;

        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();

        // Progress dot
        const px = left + width * t;
        ctx.fillStyle = this.currentReaction.type === '放热' ? '#FF8844' : '#5b8dce';
        ctx.beginPath();
        ctx.arc(px, y, 4, 0, Math.PI * 2);
        ctx.fill();

        // Phase labels
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.font = '14px ' + CF.sans;
        ctx.textAlign = 'center';
        const labels = ['反应物', '键断裂', '重排', '键形成', '生成物'];
        const positions = [0.125, 0.35, 0.50, 0.65, 0.875];
        labels.forEach((label, i) => {
            const lx = left + width * positions[i];
            const active = Math.abs(t - positions[i]) < 0.12;
            ctx.fillStyle = active ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.2)';
            ctx.fillText(label, lx, y + 14);
        });
    },

    _drawMolecules(ctx, atoms, bonds, driftX, shake, bondOpacity, dashed) {
        const offsetX = driftX * this.W;
        const t = performance.now() * 0.015; // deterministic time seed

        const shakeXY = (idx) => {
            if (!shake) return [0, 0];
            return [
                Math.sin(t + idx * 2.3) * shake,
                Math.cos(t + idx * 3.7) * shake
            ];
        };

        // Draw bonds first (behind atoms)
        bonds.forEach((bond, bi) => {
            const a1 = atoms[bond.a];
            const a2 = atoms[bond.b];
            if (!a1 || !a2) return;

            const [sx1, sy1] = shakeXY(bond.a);
            const [sx2, sy2] = shakeXY(bond.b);
            const x1 = a1.x + offsetX + sx1;
            const y1 = a1.y + sy1;
            const x2 = a2.x + offsetX + sx2;
            const y2 = a2.y + sy2;

            this._drawBond(ctx, x1, y1, x2, y2, bond.type, bondOpacity, dashed);
        });

        // Draw atoms
        atoms.forEach((a, i) => {
            const style = this.atomStyles[a.el] || { color: '#aaa', r: 12, textColor: '#fff' };
            const [sx, sy] = shakeXY(i);
            const ax = a.x + offsetX + sx;
            const ay = a.y + sy;
            // 旁观离子用虚线圈包裹（v4.5.0-α6）
            if (a.spectator) {
                ctx.save();
                ctx.strokeStyle = 'rgba(180,180,180,0.45)';
                ctx.lineWidth = 1.2;
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.arc(ax, ay, style.r + 6, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }
            this._drawAtom(ctx, ax, ay, style.r, style.color, a.el, style.textColor);
            // 电荷徽章（v4.5.0-α6）
            if (a.charge) {
                this._drawChargeBadge(ctx, ax + style.r * 0.75, ay - style.r * 0.75, a.charge);
            }
        });
    },

    // 电荷徽章：右上角小圆，红色 = 正、蓝色 = 负
    _drawChargeBadge(ctx, x, y, charge) {
        const isPos = charge.indexOf('+') !== -1;
        const r = 7;
        ctx.save();
        ctx.shadowColor = isPos ? '#ff5566' : '#5588ff';
        ctx.shadowBlur = 8;
        ctx.fillStyle = isPos ? 'rgba(255, 90, 110, 0.95)' : 'rgba(100, 150, 255, 0.95)';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(charge, x, y + 0.5);
        ctx.restore();
    },

    // 电子转移动画（v4.5.0-α7）：从 fromMol 中心 → toMol 中心
    _drawElectronTransfer(ctx, t) {
        const et = this.currentReaction.electronTransfer;
        if (!et) return;
        const fromAtom = this.reactantAtoms.find(a => a.molIdx === et.fromMol);
        const toAtom = this.reactantAtoms.find(a => a.molIdx === et.toMol);
        if (!fromAtom || !toAtom) return;
        // 局部进度：0.25→0.60 映射到 0→1
        const localT = Math.min(1, Math.max(0, (t - 0.25) / 0.35));
        const ease = localT < 0.5 ? 2 * localT * localT : 1 - Math.pow(-2 * localT + 2, 2) / 2;
        const count = et.count || 2;
        const now = performance.now() * 0.005;
        ctx.save();
        for (let i = 0; i < count; i++) {
            const phase = i / count;
            const sub = (ease + phase * 0.15) % 1;
            const x = fromAtom.x + (toAtom.x - fromAtom.x) * sub;
            // 弧形路径：中段抬高 30px
            const arc = Math.sin(sub * Math.PI) * 35;
            const y = fromAtom.y + (toAtom.y - fromAtom.y) * sub - arc;
            // 黄色发光电子
            ctx.shadowColor = '#ffe66d';
            ctx.shadowBlur = 14;
            ctx.fillStyle = 'rgba(255, 235, 130, 0.95)';
            ctx.beginPath();
            ctx.arc(x, y, 5 + Math.sin(now + i) * 1.2, 0, Math.PI * 2);
            ctx.fill();
            // 内核
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, Math.PI * 2);
            ctx.fill();
        }
        // 标签
        if (et.label) {
            const midX = (fromAtom.x + toAtom.x) / 2;
            const midY = (fromAtom.y + toAtom.y) / 2 - 28;
            const labelOpacity = Math.min(1, localT * 3) * Math.min(1, (1 - localT) * 3);
            ctx.shadowBlur = 0;
            ctx.fillStyle = `rgba(255, 230, 109, ${labelOpacity})`;
            ctx.font = 'bold 14px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillText(et.label, midX, midY);
        }
        ctx.restore();
    },

    _drawFreeAtoms(ctx, localT) {
        // Interpolate between reactant and product atom positions
        // Use all reactant atoms first, then pad with product atoms
        const rAtoms = this.reactantAtoms;
        const pAtoms = this.productAtoms;
        const maxLen = Math.max(rAtoms.length, pAtoms.length);
        const centerX = this.W * 0.5;
        const centerY = this.H * 0.48;

        for (let i = 0; i < maxLen; i++) {
            const r = rAtoms[i % rAtoms.length];
            const p = pAtoms[i % pAtoms.length];
            const el = i < rAtoms.length ? r.el : p.el;
            const style = this.atomStyles[el] || { color: '#aaa', r: 12, textColor: '#fff' };

            // Atoms orbit around center during transition
            const angle = (i / maxLen) * Math.PI * 2 + localT * Math.PI * 0.5;
            const orbitR = 30 + (i % 5) * 18;
            const jitter = Math.sin(localT * 8 + i) * 4;

            const ax = centerX + Math.cos(angle) * orbitR + jitter;
            const ay = centerY + Math.sin(angle) * orbitR * 0.6 + jitter;

            this._drawAtom(ctx, ax, ay, style.r, style.color, el, style.textColor, 0.85);
        }
    },

    _drawAtom(ctx, x, y, r, color, label, textColor, opacity) {
        opacity = opacity || 1;
        ctx.save();
        ctx.globalAlpha = opacity;

        // Glow
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;

        // Gradient sphere
        const grd = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
        grd.addColorStop(0, this._lighten(color, 0.4));
        grd.addColorStop(0.6, color);
        grd.addColorStop(1, this._darken(color, 0.3));
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;

        // Label
        ctx.fillStyle = textColor || '#fff';
        ctx.font = `bold ${Math.max(13, r)}px ${CF.mono}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x, y);

        ctx.restore();
    },

    _drawBond(ctx, x1, y1, x2, y2, type, opacity, dashed) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, opacity));

        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1) { ctx.restore(); return; }

        // Perpendicular offset for multi-bonds
        const nx = -dy / len;
        const ny = dx / len;

        const bondColor = type === 4
            ? 'rgba(180,130,255,0.7)'  // ionic: purple dashed
            : 'rgba(200,200,200,0.7)';

        ctx.strokeStyle = bondColor;
        ctx.lineWidth = type === 4 ? 1.5 : 2;

        if (dashed || type === 4) {
            ctx.setLineDash([4, 4]);
        } else {
            ctx.setLineDash([]);
        }

        if (type === 1 || type === 4) {
            // Single bond / ionic bond
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        } else if (type === 2) {
            // Double bond: two parallel lines
            const offset = 3;
            ctx.beginPath();
            ctx.moveTo(x1 + nx * offset, y1 + ny * offset);
            ctx.lineTo(x2 + nx * offset, y2 + ny * offset);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x1 - nx * offset, y1 - ny * offset);
            ctx.lineTo(x2 - nx * offset, y2 - ny * offset);
            ctx.stroke();
        } else if (type === 3) {
            // Triple bond: three parallel lines
            const offset = 4;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x1 + nx * offset, y1 + ny * offset);
            ctx.lineTo(x2 + nx * offset, y2 + ny * offset);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x1 - nx * offset, y1 - ny * offset);
            ctx.lineTo(x2 - nx * offset, y2 - ny * offset);
            ctx.stroke();
        }

        ctx.setLineDash([]);
        ctx.restore();
    },

    _drawEnergyDiagram(ctx, t) {
        const rxn = this.currentReaction;
        if (!rxn) return;

        // Mini energy diagram in top-right
        const ox = this.W - 140;
        const oy = 25;
        const dw = 120;
        const dh = 70;
        const isExo = rxn.energy < 0;

        ctx.save();
        ctx.globalAlpha = 0.6;

        // Background
        ctx.fillStyle = 'rgba(20,24,35,0.85)';
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        const bx = ox - 8, by = oy - 8, bw = dw + 16, bh = dh + 30, br = 6;
        ctx.beginPath();
        ctx.moveTo(bx + br, by);
        ctx.lineTo(bx + bw - br, by);
        ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + br);
        ctx.lineTo(bx + bw, by + bh - br);
        ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - br, by + bh);
        ctx.lineTo(bx + br, by + bh);
        ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - br);
        ctx.lineTo(bx, by + br);
        ctx.quadraticCurveTo(bx, by, bx + br, by);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Title
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '14px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('能量图', ox + dw / 2, oy);

        // Axes
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(ox, oy + dh);
        ctx.lineTo(ox + dw, oy + dh);
        ctx.moveTo(ox, oy + 8);
        ctx.lineTo(ox, oy + dh);
        ctx.stroke();

        // Energy levels
        const eReactant = isExo ? 0.35 : 0.65;
        const eProduct  = isExo ? 0.65 : 0.35;
        const ePeak     = 0.15; // Activation energy peak

        const ry = oy + dh * eReactant + 8;
        const py = oy + dh * eProduct + 8;
        const peakY = oy + dh * ePeak + 8;

        // Curve
        ctx.strokeStyle = isExo ? '#FF8844' : '#5b8dce';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(ox + 5, ry);
        ctx.lineTo(ox + dw * 0.2, ry);
        // Bezier to peak
        ctx.bezierCurveTo(
            ox + dw * 0.3, ry,
            ox + dw * 0.35, peakY,
            ox + dw * 0.5, peakY
        );
        // Bezier down to product
        ctx.bezierCurveTo(
            ox + dw * 0.65, peakY,
            ox + dw * 0.7, py,
            ox + dw * 0.8, py
        );
        ctx.lineTo(ox + dw - 5, py);
        ctx.stroke();

        // Progress marker on curve
        const curveT = t;
        let markerX, markerY;
        if (curveT < 0.5) {
            const lt = curveT / 0.5;
            markerX = ox + 5 + (dw * 0.5 - 5) * lt;
            markerY = ry + (peakY - ry) * Math.sin(lt * Math.PI * 0.5);
        } else {
            const lt = (curveT - 0.5) / 0.5;
            markerX = ox + dw * 0.5 + (dw * 0.5 - 5) * lt;
            markerY = peakY + (py - peakY) * Math.sin(lt * Math.PI * 0.5);
        }

        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(markerX, markerY, 3, 0, Math.PI * 2);
        ctx.fill();

        // Labels
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '13px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText('Ea', ox + dw * 0.38, peakY - 3);

        // ΔH arrow
        if (Math.abs(ry - py) > 5) {
            ctx.strokeStyle = isExo ? 'rgba(255,136,68,0.5)' : 'rgba(91,141,206,0.5)';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(ox + dw * 0.85, ry);
            ctx.lineTo(ox + dw * 0.85, py);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillText('ΔH', ox + dw * 0.87, (ry + py) / 2 + 3);
        }

        // Bottom label
        ctx.textAlign = 'center';
        ctx.fillText('反应进程', ox + dw / 2, oy + dh + 17);

        ctx.restore();
    },

    _lighten(hex, amount) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgb(${Math.min(255, r + (255 - r) * amount)},${Math.min(255, g + (255 - g) * amount)},${Math.min(255, b + (255 - b) * amount)})`;
    },

    _darken(hex, amount) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgb(${Math.max(0, r * (1 - amount))},${Math.max(0, g * (1 - amount))},${Math.max(0, b * (1 - amount))})`;
    },

    updateEnergyBar() {
        const bar = document.getElementById('rxn-energy-bar');
        const label = document.getElementById('rxn-energy-label');
        if (!bar || !label || !this.currentReaction) return;
        const rxn = this.currentReaction;
        const val = rxn.energy * this.progress;
        const pct = Math.abs(this.progress * 50);

        if (rxn.energy < 0) {
            bar.style.background = `linear-gradient(90deg, #c4793a ${pct}%, transparent ${pct}%)`;
            label.textContent = `ΔH = ${val.toFixed(0)} ${rxn.unit} (放热)`;
            label.style.color = '#c4793a';
        } else {
            bar.style.background = `linear-gradient(90deg, #5b8dce ${pct}%, transparent ${pct}%)`;
            label.textContent = `ΔH = +${val.toFixed(0)} ${rxn.unit} (吸热)`;
            label.style.color = '#5b8dce';
        }
    },

    updateInfo() {
        const el = document.getElementById('rxn-info');
        if (!el || !this.currentReaction) return;
        const rxn = this.currentReaction;
        const isExo = rxn.energy < 0;
        const typeDescs = {
            '放热': '反应物总能量 > 生成物总能量，多余能量以热/光形式释放到环境中',
            '吸热': '反应物总能量 < 生成物总能量，需从环境中吸收能量才能持续反应'
        };
        const typeNotes = {
            'combustion': '燃烧反应是最典型的放热反应，产物CO₂和H₂O的化学键总能量远高于反应物',
            'synthesis': '工业合成氨（Haber法）：高温高压+铁催化剂，N≡N三键键能=946kJ/mol，断键困难',
            'neutralization': '中和热ΔH≈-57.3kJ/mol（稀溶液中强酸+强碱），本质是H⁺+OH⁻→H₂O',
            'decomposition': '分解反应需要持续供热（煅烧石灰石~900°C），Le Chatelier原理：升温有利于吸热反应',
            'redox': '置换反应的本质是氧化还原：活泼金属失电子被氧化，不活泼金属离子得电子被还原'
        };
        const rxnKey = Object.keys(this.reactions).find(k => this.reactions[k] === rxn) || '';
        el.innerHTML = `
            <div class="rxn-info-title">${rxn.name}</div>
            <div class="rxn-info-desc">${rxn.desc}</div>
            <div class="rxn-info-row"><span class="rxn-info-label">方程式</span><span>${rxn.equation}</span></div>
            <div class="rxn-info-row"><span class="rxn-info-label">类型</span><span>${rxn.type}反应</span></div>
            <div class="rxn-info-row"><span class="rxn-info-label">能量变化</span><span>ΔH = ${rxn.energy > 0 ? '+' : ''}${rxn.energy} ${rxn.unit}</span></div>
            <div class="rxn-info-row"><span class="rxn-info-label">活化能</span><span>Ea ≈ ${rxn.activationEnergy} ${rxn.unit}</span></div>
            <div class="rxn-info-row"><span class="rxn-info-label">反应历程</span><span>${rxn.mechanism}</span></div>
            <div class="rxn-edu">
                <div class="chem-hd"><span class="chem-tag">化学反应</span>能量变化与反应原理</div>
                <div class="chem-row"><span class="chem-key">能量本质</span>${typeDescs[rxn.type] || rxn.type}</div>
                <div class="chem-row"><span class="chem-key chem-key--amber">Ea 含义</span>活化能是反应物→活化络合物所需最低能量；Ea越高→反应越慢，催化剂可降低Ea</div>
                <div class="chem-row"><span class="chem-key chem-key--purple">键能分析</span>${isExo ? 'ΔH<0：生成物键能总和 > 反应物键能总和（形成更稳定的化学键）' : 'ΔH>0：反应物键能总和 > 生成物键能总和（产物键能较低）'}</div>
                <div class="chem-note">💡 ${typeNotes[rxnKey] || '化学反应的实质是旧键断裂、新键形成。反应热ΔH = 反应物键能总和 − 生成物键能总和'}</div>
            </div>
        `;
    }
};

function initChemReaction() {
    ChemReaction.init();
}
