// ===== Genetics Visualization v3 =====
// Punnett Square + Population Genetics (Hardy-Weinberg) + Pedigree Chart + Cross Animation
// Canvas-based, DPR-aware, ResizeObserver, event-cleanup ready

const Genetics = {
    canvas: null, ctx: null, W: 0, H: 0,
    info: null, animId: null, time: 0,
    _listeners: [],

    // Mode: 'punnett' | 'population' | 'pedigree'
    mode: 'punnett',

    // ── Punnett state ──
    punnettMode: 'single',  // 'single' | 'double'
    parent1: 'Aa', parent2: 'Aa',
    crossResult: null,
    crossAnim: null, // {phase:'gamete'|'combine'|'done', t:0, gametes1:[], gametes2:[], pairs:[]}

    // ── Population state (Hardy-Weinberg) ──
    popFreqP: 0.5,         // dominant allele frequency
    popSize: 200,
    popGenerations: 0,
    popHistory: [],         // [{p, q, AA, Aa, aa}]
    popIndividuals: [],     // [{genotype, x, y, vx, vy}]
    popRunning: false,
    popSelection: 'none',   // 'none' | 'against_aa' | 'for_AA' | 'heterozygote_advantage'
    popMutation: false,
    popDrift: false,

    // ── Pedigree state ──
    pedigreePreset: 'autosomal_dominant',
    pedigreeData: null,

    /* ============ Init / Destroy ============ */

    init() {
        if (this.canvas) this.destroy();
        this.canvas = document.getElementById('genetics-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.info = document.getElementById('genetics-info');

        this.resize();
        this.bindControls();
        this._injectInfoPanel();
        this.startLoop();
        this._updateInfo();

        if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(() => this.resize());
            ro.observe(this.canvas.parentElement);
            this._ro = ro;
        }
        this._onResize = () => this.resize();
        window.addEventListener('resize', this._onResize);
    },

    destroy() {
        if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
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
        const wrap = this.canvas.parentElement;
        if (!wrap) return;
        const w = wrap.clientWidth;
        if (w === 0) return;
        const h = Math.min(Math.max(w * 0.48, 300), 420);
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w; this.H = h;
    },

    bindControls() {
        // Cross button
        this._on(document.getElementById('bio-cross'), 'click', () => {
            if (this.mode !== 'punnett') { this.switchMode('punnett'); }
            this.performCross();
        });

        // Parent selects
        const s1 = document.getElementById('bio-parent1');
        const s2 = document.getElementById('bio-parent2');
        this._on(s1, 'change', () => { this.parent1 = s1.value; });
        this._on(s2, 'change', () => { this.parent2 = s2.value; });

        // Mode toggle — inject buttons if not exist
        this._injectModeButtons();

        // Punnett single/double toggle
        this._on(document.getElementById('bio-genetics-single'), 'click', () => {
            this.punnettMode = 'single';
            this._updateParentOptions();
            this.crossResult = null; this.crossAnim = null;
        });
        this._on(document.getElementById('bio-genetics-double'), 'click', () => {
            this.punnettMode = 'double';
            this._updateParentOptions();
            this.crossResult = null; this.crossAnim = null;
        });

        // Population controls
        this._on(document.getElementById('bio-pop-start'), 'click', () => {
            if (this.mode !== 'population') this.switchMode('population');
            this.popRunning = !this.popRunning;
            const btn = document.getElementById('bio-pop-start');
            if (btn) btn.textContent = this.popRunning ? '\u6682\u505c' : '\u7ee7\u7eed\u6f14\u5316';
        });
        this._on(document.getElementById('bio-pop-reset'), 'click', () => {
            this.resetPopulation();
        });
        this._on(document.getElementById('bio-pop-freq'), 'input', (e) => {
            this.popFreqP = parseFloat(e.target.value) || 0.5;
            if (!this.popRunning) this.resetPopulation();
        });
        this._on(document.getElementById('bio-pop-selection'), 'change', (e) => {
            this.popSelection = e.target.value;
        });

        // Pedigree controls
        this._on(document.getElementById('bio-pedigree-preset'), 'change', (e) => {
            this.pedigreePreset = e.target.value;
            this.buildPedigree();
        });

        // Canvas click
        this._on(this.canvas, 'click', (e) => {
            if (this.mode === 'pedigree') {
                const r = this.canvas.getBoundingClientRect();
                const mx = (e.clientX - r.left), my = (e.clientY - r.top);
                this._pedigreeClick(mx, my);
            }
        });
    },

    _injectModeButtons() {
        const section = this.canvas?.closest('.demo-section');
        const controls = section?.querySelector('.viz-controls');
        if (!controls) return;

        let wrap = document.getElementById('bio-genetics-modes');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.id = 'bio-genetics-modes';
            wrap.className = 'genetics-modes';
            wrap.innerHTML = '<button class="gen-mode-btn active" data-mode="punnett">\u5b5f\u5fb7\u5c14\u6742\u4ea4</button>'
                + '<button class="gen-mode-btn" data-mode="population">\u79cd\u7fa4\u9057\u4f20</button>'
                + '<button class="gen-mode-btn" data-mode="pedigree">\u7cfb\u8c31\u56fe</button>';
            controls.parentElement.insertBefore(wrap, controls);
        }

        wrap.querySelectorAll('.gen-mode-btn').forEach(btn => {
            this._on(btn, 'click', () => {
                this.switchMode(btn.dataset.mode);
            });
        });
    },

    switchMode(mode) {
        this.mode = mode;
        this.crossAnim = null;
        this.popRunning = false;
        const startBtn = document.getElementById('bio-pop-start');
        if (startBtn) startBtn.textContent = '\u5f00\u59cb\u6f14\u5316';

        // Update button active state
        document.querySelectorAll('.gen-mode-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.mode === mode);
        });

        // Show/hide control groups
        const punnettCtrls = document.getElementById('bio-punnett-controls');
        const popCtrls = document.getElementById('bio-pop-controls');
        const pedCtrls = document.getElementById('bio-pedigree-controls');
        if (punnettCtrls) punnettCtrls.style.display = mode === 'punnett' ? '' : 'none';
        if (popCtrls) popCtrls.style.display = mode === 'population' ? '' : 'none';
        if (pedCtrls) pedCtrls.style.display = mode === 'pedigree' ? '' : 'none';

        if (mode === 'population' && this.popHistory.length === 0) {
            this.resetPopulation();
        }
        if (mode === 'pedigree' && !this.pedigreeData) {
            this.buildPedigree();
        }

        const msgs = {
            punnett: '\u9009\u62e9\u4eb2\u672c\u57fa\u56e0\u578b\uff0c\u70b9\u51fb\u6742\u4ea4\u67e5\u770b\u540e\u4ee3\u6bd4\u4f8b',
            population: '\u8bbe\u7f6e\u7b49\u4f4d\u57fa\u56e0\u9891\u7387\uff0c\u89c2\u5bdf\u79cd\u7fa4\u8fdb\u5316\u52a8\u6001',
            pedigree: '\u70b9\u51fb\u4e2a\u4f53\u67e5\u770b\u57fa\u56e0\u578b\uff0c\u5206\u6790\u9057\u4f20\u65b9\u5f0f'
        };
        if (this.info) this.info.textContent = msgs[mode] || '';
        this._updateInfo();
    },

    /* ============ Animation Loop ============ */

    startLoop() {
        const loop = (now) => {
            if (!now) now = performance.now();
            this.time = now / 1000;
            this.update();
            this.draw();
            this.animId = requestAnimationFrame(loop);
        };
        this.animId = requestAnimationFrame(loop);
    },

    update() {
        // Cross animation
        if (this.crossAnim && this.crossAnim.phase !== 'done') {
            this.crossAnim.t += 0.016;
            if (this.crossAnim.phase === 'gamete' && this.crossAnim.t > 1.2) {
                this.crossAnim.phase = 'combine';
                this.crossAnim.t = 0;
            }
            if (this.crossAnim.phase === 'combine' && this.crossAnim.t > 1.5) {
                this.crossAnim.phase = 'done';
            }
        }

        // Population simulation
        if (this.mode === 'population' && this.popRunning) {
            this._popStep();
        }
    },

    /* ============ Punnett Square ============ */

    _updateParentOptions() {
        const s1 = document.getElementById('bio-parent1');
        const s2 = document.getElementById('bio-parent2');
        if (!s1 || !s2) return;

        if (this.punnettMode === 'single') {
            const opts = '<option value="AA">AA (\u7eaf\u5408\u663e\u6027)</option>'
                + '<option value="Aa" selected>Aa (\u6742\u5408)</option>'
                + '<option value="aa">aa (\u7eaf\u5408\u9690\u6027)</option>';
            s1.innerHTML = opts; s2.innerHTML = opts;
            s1.value = 'Aa'; s2.value = 'Aa';
        } else {
            const opts = '<option value="AABB">AABB</option>'
                + '<option value="AaBb" selected>AaBb</option>'
                + '<option value="AABb">AABb</option>'
                + '<option value="AaBB">AaBB</option>'
                + '<option value="aaBb">aaBb</option>'
                + '<option value="Aabb">Aabb</option>'
                + '<option value="aabb">aabb</option>'
                + '<option value="AAbb">AAbb</option>'
                + '<option value="aaBB">aaBB</option>';
            s1.innerHTML = opts; s2.innerHTML = opts;
            s1.value = 'AaBb'; s2.value = 'AaBb';
        }
        this.parent1 = s1.value;
        this.parent2 = s2.value;
    },

    performCross() {
        this.parent1 = document.getElementById('bio-parent1')?.value || this.parent1;
        this.parent2 = document.getElementById('bio-parent2')?.value || this.parent2;

        const g1 = this._getGametes(this.parent1);
        const g2 = this._getGametes(this.parent2);

        const grid = [];
        const counts = {};
        for (const a of g1) {
            for (const b of g2) {
                const genotype = this._combineGametes(a, b);
                grid.push(genotype);
                counts[genotype] = (counts[genotype] || 0) + 1;
            }
        }

        this.crossResult = { g1, g2, grid, counts, total: grid.length };

        // Start animation
        this.crossAnim = {
            phase: 'gamete', t: 0,
            gametes1: g1, gametes2: g2, pairs: grid
        };

        if (this.info) {
            const ratios = Object.entries(counts).sort().map(([k, v]) => k + ':' + v).join(' , ');
            this.info.innerHTML = '<strong>\u540e\u4ee3\u57fa\u56e0\u578b\u6bd4\u4f8b</strong>\uff1a' + ratios
                + '<br><span style="opacity:0.6">\u8868\u73b0\u578b\u6bd4\u4f8b\uff1a' + this._phenotypeRatio(counts) + '</span>';
        }
    },

    _combineGametes(g1, g2) {
        if (g1.length === 1) {
            // Single gene: g1='A', g2='a' → 'Aa'
            return this._normalizePair(g1, g2);
        }
        // Double gene: g1='AB', g2='ab' → gene1: A+a='Aa', gene2: B+b='Bb' → 'AaBb'
        let result = '';
        for (let i = 0; i < g1.length; i++) {
            result += this._normalizePair(g1[i], g2[i]);
        }
        return result;
    },

    _normalizePair(c1, c2) {
        // Uppercase before lowercase: 'a'+'A' → 'Aa'
        if (c1 === c1.toLowerCase() && c2 === c2.toUpperCase()) return c2 + c1;
        return c1 + c2;
    },

    _getGametes(genotype) {
        if (genotype.length === 2) {
            const a1 = genotype[0], a2 = genotype[1];
            if (a1 === a2) return [a1];
            return [a1, a2];
        }
        // Double: AaBb etc
        const a1 = genotype[0], a2 = genotype[1];
        const b1 = genotype[2], b2 = genotype[3];
        const aAlleles = a1 === a2 ? [a1] : [a1, a2];
        const bAlleles = b1 === b2 ? [b1] : [b1, b2];
        const result = [];
        for (const a of aAlleles) {
            for (const b of bAlleles) result.push(a + b);
        }
        return result;
    },

    _normalizeGenotype(g) {
        if (g.length === 2) {
            const chars = g.split('');
            if (chars[0] === chars[0].toLowerCase() && chars[1] === chars[1].toUpperCase()) {
                return chars[1] + chars[0];
            }
            return g;
        }
        // 4 chars: sort each gene pair
        let a = g.slice(0, 2), b = g.slice(2, 4);
        if (a[0] === a[0].toLowerCase() && a[1] === a[1].toUpperCase()) a = a[1] + a[0];
        if (b[0] === b[0].toLowerCase() && b[1] === b[1].toUpperCase()) b = b[1] + b[0];
        return a + b;
    },

    _genotypeType(g) {
        if (g.length <= 2) {
            const upper = g.replace(/[a-z]/g, '').length;
            const lower = g.replace(/[A-Z]/g, '').length;
            if (lower === 0) return 'dominant';
            if (upper === 0) return 'recessive';
            return 'carrier';
        }
        // Double gene: check each gene pair independently
        const dom1 = g[0] === g[0].toUpperCase();
        const dom2 = g[2] === g[2].toUpperCase();
        if (dom1 && dom2) return 'dom_dom';
        if (dom1 && !dom2) return 'dom_rec';
        if (!dom1 && dom2) return 'rec_dom';
        return 'rec_rec';
    },

    _phenotypeRatio(counts) {
        const isSingle = this.punnettMode === 'single';
        const phenoCounts = {};
        for (const [g, c] of Object.entries(counts)) {
            let label;
            if (isSingle) {
                label = this._genotypeType(g) === 'recessive' ? '\u9690\u6027' : '\u663e\u6027';
            } else {
                // Double gene: classify each gene pair independently
                // g = 'AaBb' → gene1 = 'Aa', gene2 = 'Bb'
                const gene1 = g.slice(0, 2);
                const gene2 = g.slice(2, 4);
                const dom1 = gene1[0] === gene1[0].toUpperCase();
                const dom2 = gene2[0] === gene2[0].toUpperCase();
                if (dom1 && dom2) label = 'A_B_';
                else if (dom1 && !dom2) label = 'A_bb';
                else if (!dom1 && dom2) label = 'aaB_';
                else label = 'aabb';
            }
            phenoCounts[label] = (phenoCounts[label] || 0) + c;
        }
        const values = Object.values(phenoCounts);
        const g = this._gcd(...values);
        return Object.entries(phenoCounts).map(([k, v]) => k + ':' + (v / g)).join(' : ');
    },

    _gcd(...nums) {
        const gcd2 = (a, b) => b === 0 ? a : gcd2(b, a % b);
        return nums.reduce((a, b) => gcd2(a, b));
    },

    /* ============ Population Genetics ============ */

    resetPopulation() {
        const p = this.popFreqP;
        const q = 1 - p;
        this.popGenerations = 0;
        this.popHistory = [{ p, q, AA: p * p, Aa: 2 * p * q, aa: q * q }];
        this.popRunning = false;
        const btn = document.getElementById('bio-pop-start');
        if (btn) btn.textContent = '\u5f00\u59cb\u6f14\u5316';

        // Generate individuals
        this.popIndividuals = [];
        for (let i = 0; i < this.popSize; i++) {
            const r = Math.random();
            let genotype;
            if (r < p * p) genotype = 'AA';
            else if (r < p * p + 2 * p * q) genotype = 'Aa';
            else genotype = 'aa';
            this.popIndividuals.push({
                genotype,
                x: Math.random() * this.W * 0.55 + this.W * 0.02,
                y: Math.random() * this.H * 0.65 + this.H * 0.05,
                vx: (Math.random() - 0.5) * 0.8,
                vy: (Math.random() - 0.5) * 0.8,
                alive: true
            });
        }

        if (this.info) {
            this.info.innerHTML = '<strong>Hardy-Weinberg \u5e73\u8861</strong>\uff1ap=' + p.toFixed(2) + ', q=' + q.toFixed(2)
                + ' \u2192 AA:' + (p * p * 100).toFixed(1) + '% Aa:' + (2 * p * q * 100).toFixed(1) + '% aa:' + (q * q * 100).toFixed(1) + '%';
        }
    },

    _popStep() {
        if (!this.popIndividuals.length) return;

        // Move individuals
        const pad = 4;
        const maxX = this.W * 0.57, maxY = this.H * 0.7;
        for (const ind of this.popIndividuals) {
            if (!ind.alive) continue;
            ind.x += ind.vx;
            ind.y += ind.vy;
            if (ind.x < pad || ind.x > maxX) ind.vx *= -1;
            if (ind.y < pad || ind.y > maxY) ind.vy *= -1;
            ind.x = Math.max(pad, Math.min(maxX, ind.x));
            ind.y = Math.max(pad, Math.min(maxY, ind.y));
        }

        // Every ~60 frames, do a generation step
        this._popAccum = (this._popAccum || 0) + 1;
        if (this._popAccum < 60) return;
        this._popAccum = 0;

        // Selection
        if (this.popSelection !== 'none') {
            const living = this.popIndividuals.filter(i => i.alive);
            for (const ind of living) {
                let survivalRate = 1.0;
                if (this.popSelection === 'against_aa' && ind.genotype === 'aa') survivalRate = 0.5;
                if (this.popSelection === 'for_AA' && ind.genotype !== 'AA') survivalRate = 0.7;
                if (this.popSelection === 'heterozygote_advantage') {
                    if (ind.genotype === 'AA') survivalRate = 0.8;
                    if (ind.genotype === 'aa') survivalRate = 0.6;
                }
                if (Math.random() > survivalRate) ind.alive = false;
            }
        }

        // Reproduction: sample alleles from living individuals
        const living = this.popIndividuals.filter(i => i.alive);
        if (living.length < 4) {
            this.popRunning = false;
            if (this.info) this.info.textContent = '\u79cd\u7fa4\u706d\u7edd\uff01\u4e2a\u4f53\u6570\u8fc7\u5c11\u65e0\u6cd5\u7ee7\u7eed';
            return;
        }

        // Allele pool
        const alleles = [];
        for (const ind of living) {
            if (ind.genotype === 'AA') { alleles.push('A', 'A'); }
            else if (ind.genotype === 'Aa') { alleles.push('A', 'a'); }
            else { alleles.push('a', 'a'); }
        }

        // Genetic drift: if popDrift or small population, sample with replacement
        const nextGen = [];
        const targetSize = this.popDrift ? Math.min(living.length, 50) : this.popSize;
        for (let i = 0; i < targetSize; i++) {
            const a1 = alleles[Math.floor(Math.random() * alleles.length)];
            const a2 = alleles[Math.floor(Math.random() * alleles.length)];
            let g;
            if (a1 === 'A' && a2 === 'A') g = 'AA';
            else if (a1 === 'a' && a2 === 'a') g = 'aa';
            else g = 'Aa';

            // Mutation (low rate)
            if (this.popMutation && Math.random() < 0.01) {
                if (g === 'AA') g = 'Aa';
                else if (g === 'aa') g = 'Aa';
            }

            nextGen.push({
                genotype: g,
                x: Math.random() * this.W * 0.55 + this.W * 0.02,
                y: Math.random() * this.H * 0.65 + this.H * 0.05,
                vx: (Math.random() - 0.5) * 0.8,
                vy: (Math.random() - 0.5) * 0.8,
                alive: true
            });
        }

        this.popIndividuals = nextGen;
        this.popGenerations++;

        // Calculate frequencies
        let countA = 0, total = 0;
        for (const ind of nextGen) {
            if (ind.genotype === 'AA') countA += 2;
            else if (ind.genotype === 'Aa') countA += 1;
            total += 2;
        }
        const newP = countA / total;
        const newQ = 1 - newP;
        const AA = nextGen.filter(i => i.genotype === 'AA').length / nextGen.length;
        const Aa = nextGen.filter(i => i.genotype === 'Aa').length / nextGen.length;
        const aa = nextGen.filter(i => i.genotype === 'aa').length / nextGen.length;
        this.popHistory.push({ p: newP, q: newQ, AA, Aa, aa });

        if (this.info) {
            this.info.innerHTML = '<strong>\u7b2c ' + this.popGenerations + ' \u4ee3</strong> | p=' + newP.toFixed(3)
                + ' q=' + newQ.toFixed(3) + ' | AA:' + (AA * 100).toFixed(1) + '% Aa:'
                + (Aa * 100).toFixed(1) + '% aa:' + (aa * 100).toFixed(1) + '%'
                + ' | \u4e2a\u4f53\u6570:' + nextGen.length;
        }
    },

    /* ============ Pedigree Chart ============ */

    buildPedigree() {
        const presets = {
            autosomal_dominant: {
                title: '\u5e38\u67d3\u8272\u4f53\u663e\u6027\u9057\u4f20',
                desc: '\u60a3\u8005\u81f3\u5c11\u643a\u5e26\u4e00\u4e2a\u663e\u6027\u7b49\u4f4d\u57fa\u56e0(A)\uff0c\u60a3\u75c5\u8868\u73b0\u4e3a Aa \u6216 AA',
                nodes: [
                    { id: 0, sex: 'M', genotype: 'Aa', affected: true, gen: 0, pos: 0 },
                    { id: 1, sex: 'F', genotype: 'aa', affected: false, gen: 0, pos: 1 },
                    { id: 2, sex: 'M', genotype: 'Aa', affected: true, gen: 1, pos: 0 },
                    { id: 3, sex: 'F', genotype: 'aa', affected: false, gen: 1, pos: 1 },
                    { id: 4, sex: 'M', genotype: 'aa', affected: false, gen: 1, pos: 2 },
                    { id: 5, sex: 'F', genotype: 'Aa', affected: true, gen: 1, pos: 3 },
                    { id: 6, sex: 'M', genotype: 'Aa', affected: true, gen: 2, pos: 0 },
                    { id: 7, sex: 'F', genotype: 'aa', affected: false, gen: 2, pos: 1 },
                    { id: 8, sex: 'M', genotype: 'aa', affected: false, gen: 2, pos: 2 },
                    { id: 9, sex: 'F', genotype: 'aa', affected: false, gen: 2, pos: 3 }
                ],
                unions: [[0,1],[4,5]],
                children: { '0-1': [2,3,4,5], '4-5': [6,7,8,9] }
            },
            autosomal_recessive: {
                title: '\u5e38\u67d3\u8272\u4f53\u9690\u6027\u9057\u4f20',
                desc: '\u60a3\u8005\u57fa\u56e0\u578b\u4e3a aa\uff0c\u7236\u6bcd\u5747\u4e3a\u643a\u5e26\u8005(Aa)',
                nodes: [
                    { id: 0, sex: 'M', genotype: 'Aa', affected: false, gen: 0, pos: 0 },
                    { id: 1, sex: 'F', genotype: 'Aa', affected: false, gen: 0, pos: 1 },
                    { id: 2, sex: 'F', genotype: 'AA', affected: false, gen: 1, pos: 0 },
                    { id: 3, sex: 'M', genotype: 'Aa', affected: false, gen: 1, pos: 1 },
                    { id: 4, sex: 'F', genotype: 'aa', affected: true, gen: 1, pos: 2 },
                    { id: 5, sex: 'M', genotype: 'Aa', affected: false, gen: 1, pos: 3 }
                ],
                unions: [[0,1]],
                children: { '0-1': [2,3,4,5] }
            },
            x_linked_recessive: {
                title: 'X\u8fde\u9501\u9690\u6027\u9057\u4f20',
                desc: '\u7537\u6027\u60a3\u8005\u57fa\u56e0\u578b X\u1d43Y\uff0c\u5973\u6027\u643a\u5e26\u8005 X\u1d2cX\u1d43',
                nodes: [
                    { id: 0, sex: 'M', genotype: 'XAY', affected: false, gen: 0, pos: 0 },
                    { id: 1, sex: 'F', genotype: 'XAXa', affected: false, gen: 0, pos: 1 },
                    { id: 2, sex: 'M', genotype: 'XAY', affected: false, gen: 1, pos: 0 },
                    { id: 3, sex: 'F', genotype: 'XAXa', affected: false, gen: 1, pos: 1 },
                    { id: 4, sex: 'M', genotype: 'XaY', affected: true, gen: 1, pos: 2 },
                    { id: 5, sex: 'F', genotype: 'XAXA', affected: false, gen: 1, pos: 3 }
                ],
                unions: [[0,1]],
                children: { '0-1': [2,3,4,5] }
            },
            x_linked_dominant: {
                title: 'X\u8fde\u9501\u663e\u6027\u9057\u4f20',
                desc: '\u7537\u6027\u60a3\u8005\u7684\u5973\u513f\u5168\u90e8\u60a3\u75c5\uff0c\u5973\u6027\u60a3\u8005\u540e\u4ee3\u534a\u6570\u60a3\u75c5',
                nodes: [
                    { id: 0, sex: 'M', genotype: 'XAY', affected: true, gen: 0, pos: 0 },
                    { id: 1, sex: 'F', genotype: 'XaXa', affected: false, gen: 0, pos: 1 },
                    { id: 2, sex: 'F', genotype: 'XAXa', affected: true, gen: 1, pos: 0 },
                    { id: 3, sex: 'M', genotype: 'XaY', affected: false, gen: 1, pos: 1 },
                    { id: 4, sex: 'F', genotype: 'XAXa', affected: true, gen: 1, pos: 2 },
                    { id: 5, sex: 'M', genotype: 'XaY', affected: false, gen: 1, pos: 3 }
                ],
                unions: [[0,1]],
                children: { '0-1': [2,3,4,5] }
            }
        };

        const preset = presets[this.pedigreePreset] || presets.autosomal_dominant;
        this.pedigreeData = preset;
        this._selectedPedigreeNode = null;

        if (this.info) {
            this.info.innerHTML = '<strong>' + preset.title + '</strong>\uff1a' + preset.desc;
        }
    },

    _pedigreeClick(mx, my) {
        if (!this.pedigreeData) return;
        const nodes = this.pedigreeData.nodes;
        const { W, H } = this;
        const genCount = Math.max(...nodes.map(n => n.gen)) + 1;
        const genH = H / (genCount + 1);
        const r = 18;

        for (const node of nodes) {
            const maxPos = Math.max(...nodes.filter(n => n.gen === node.gen).map(n => n.pos)) + 1;
            const colW = W * 0.7 / maxPos;
            const nx = W * 0.15 + colW * (node.pos + 0.5);
            const ny = genH * (node.gen + 1);

            if (Math.abs(mx - nx) < r + 4 && Math.abs(my - ny) < r + 4) {
                this._selectedPedigreeNode = node;
                if (this.info) {
                    const sexLabel = node.sex === 'M' ? '\u7537\u6027' : '\u5973\u6027';
                    const statusLabel = node.affected ? '\u60a3\u75c5' : '\u6b63\u5e38';
                    this.info.innerHTML = '<strong>' + sexLabel + ' (ID:' + node.id + ')</strong> | \u57fa\u56e0\u578b: '
                        + node.genotype + ' | \u72b6\u6001: ' + statusLabel;
                }
                return;
            }
        }
        this._selectedPedigreeNode = null;
    },

    /* ============ Education Panel ============ */

    _injectInfoPanel() {
        const el = document.getElementById('gen-edu-info');
        if (!el) return;
        el.innerHTML = `
            <div class="gen-edu-info__hd">🧬 遗传学知识点</div>
            <div class="gen-edu-info__grid">
                <div class="gen-edu-info__block">
                    <div class="gen-edu-info__sub">当前模式</div>
                    <div id="gen-edu-mode" class="gen-edu-info__val">孟德尔杂交</div>
                    <div id="gen-edu-mode-desc" class="gen-edu-info__desc">选择亲本基因型，点击杂交查看后代比例</div>
                </div>
                <div class="gen-edu-info__block" id="gen-edu-detail-block">
                    <div class="gen-edu-info__sub">核心定律</div>
                    <div id="gen-edu-detail" class="gen-edu-info__val">分离定律</div>
                </div>
                <div class="gen-edu-info__block" id="gen-edu-laws-block">
                    <div class="gen-edu-info__sub">知识要点</div>
                    <div id="gen-edu-laws"></div>
                </div>
                <div class="gen-edu-info__block">
                    <div class="gen-edu-info__sub">💡 人教版必修2</div>
                    <div class="gen-edu-info__note" id="gen-edu-note">等位基因在形成配子时彼此分离，分别进入不同配子中。显性纯合(AA)与杂合(Aa)表现型相同，需测交鉴定。</div>
                </div>
            </div>
        `;
    },

    _updateInfo() {
        const modeEl = document.getElementById('gen-edu-mode');
        const descEl = document.getElementById('gen-edu-mode-desc');
        const detailEl = document.getElementById('gen-edu-detail');
        const lawsEl = document.getElementById('gen-edu-laws');
        const noteEl = document.getElementById('gen-edu-note');
        if (!modeEl) return;

        if (this.mode === 'punnett') {
            modeEl.textContent = '孟德尔杂交';
            descEl.textContent = this.punnettMode === 'single' ? '单基因杂交 — 分离定律' : '双基因杂交 — 自由组合定律';
            detailEl.textContent = this.punnettMode === 'single' ? '分离定律' : '自由组合定律';
            if (lawsEl) {
                lawsEl.innerHTML = this.punnettMode === 'single'
                    ? '<div class="gen-edu-info__row"><span class="gen-edu-info__key" style="--c:#3a9e8f">分离定律</span> 等位基因在形成配子时彼此分离</div>'
                      + '<div class="gen-edu-info__row"><span class="gen-edu-info__key" style="--c:#8b6fc0">经典比例</span> Aa × Aa → AA:Aa:aa = 1:2:1，表现型比 3:1</div>'
                      + '<div class="gen-edu-info__row"><span class="gen-edu-info__key" style="--c:#c4793a">测交</span> 显性纯合(AA)与杂合(Aa)表现型相同，需测交鉴定</div>'
                    : '<div class="gen-edu-info__row"><span class="gen-edu-info__key" style="--c:#3a9e8f">自由组合</span> 非同源染色体上的基因自由组合</div>'
                      + '<div class="gen-edu-info__row"><span class="gen-edu-info__key" style="--c:#8b6fc0">经典比例</span> AaBb × AaBb → 9:3:3:1 表现型比</div>'
                      + '<div class="gen-edu-info__row"><span class="gen-edu-info__key" style="--c:#c4793a">配子类型</span> 16种配子组合，产生 9 种基因型</div>';
            }
            if (noteEl) noteEl.textContent = this.punnettMode === 'single'
                ? '等位基因在形成配子时彼此分离，分别进入不同配子中。显性纯合(AA)与杂合(Aa)表现型相同，需测交鉴定。'
                : '两对等位基因分别位于两对同源染色体上，减数分裂时非同源染色体上的非等位基因自由组合。';
        } else if (this.mode === 'population') {
            modeEl.textContent = '种群遗传';
            descEl.textContent = 'Hardy-Weinberg 遗传平衡定律';
            detailEl.textContent = 'p² + 2pq + q² = 1';
            if (lawsEl) {
                lawsEl.innerHTML = '<div class="gen-edu-info__row"><span class="gen-edu-info__key" style="--c:#3a9e8f">平衡条件</span> 大种群、随机交配、无选择/突变/迁移</div>'
                    + '<div class="gen-edu-info__row"><span class="gen-edu-info__key" style="--c:#8b6fc0">基因频率</span> p=显性等位基因频率，q=隐性等位基因频率</div>'
                    + '<div class="gen-edu-info__row"><span class="gen-edu-info__key" style="--c:#c4793a">进化因素</span> 开启"自然选择"观察基因频率偏离平衡的过程</div>';
            }
            if (noteEl) noteEl.textContent = '在理想条件下基因频率和基因型频率代代不变。自然选择、突变、基因漂变和迁移是打破平衡引起进化的四大因素。';
        } else if (this.mode === 'pedigree') {
            modeEl.textContent = '系谱图分析';
            descEl.textContent = '判断遗传方式与基因型';
            detailEl.textContent = this.pedigreeData ? this.pedigreeData.title : '—';
            if (lawsEl) {
                lawsEl.innerHTML = '<div class="gen-edu-info__row"><span class="gen-edu-info__key" style="--c:#3a9e8f">■ 方/●圆</span> 方=男性，圆=女性；实心=患病，空心=正常</div>'
                    + '<div class="gen-edu-info__row"><span class="gen-edu-info__key" style="--c:#8b6fc0">• 携带者</span> 中心小圆点表示表型正常但携带隐性基因</div>'
                    + '<div class="gen-edu-info__row"><span class="gen-edu-info__key" style="--c:#c4793a">判断口诀</span> 无中生有为隐性，有中生无为显性；隐性看女，显性看男</div>';
            }
            if (noteEl) noteEl.textContent = '点击个体查看基因型信息，选择不同遗传方式观察系谱图特征。常隐：父母正常可生患病后代；X隐：男性患者多于女性。';
        }
    },

    /* ============ Main Draw ============ */

    draw() {
        const { ctx, W, H, mode } = this;
        if (!ctx || W === 0) return;
        ctx.clearRect(0, 0, W, H);

        switch (mode) {
            case 'punnett':    this._drawPunnett(ctx, W, H); break;
            case 'population': this._drawPopulation(ctx, W, H); break;
            case 'pedigree':   this._drawPedigree(ctx, W, H); break;
        }
    },

    /* ── Punnett Draw ── */

    _drawPunnett(ctx, W, H) {
        const fs = Math.max(11, W * 0.019);
        if (!this.crossResult) {
            // Placeholder
            ctx.fillStyle = 'rgba(58,158,143,0.08)';
            ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.font = '500 ' + (fs + 8) + 'px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.fillText('\u9009\u62e9\u4eb2\u672c\u57fa\u56e0\u578b\uff0c\u70b9\u51fb\u201c\u6742\u4ea4\u201d\u67e5\u770b\u7ed3\u679c', W / 2, H / 2);
            return;
        }

        const { g1, g2, grid, counts, total } = this.crossResult;
        const cols = g2.length, rows = g1.length;
        const isSingle = this.punnettMode === 'single';
        const gridFrac = isSingle ? 0.5 : 0.46;
        const cellSize = Math.min((W * gridFrac) / (cols + 1), (H * (isSingle ? 0.55 : 0.66)) / (rows + 1), isSingle ? 80 : 96);
        const gridW = (cols + 1) * cellSize;
        const gridH = (rows + 1) * cellSize;
        const ox = (W * (gridFrac + 0.05) - gridW) / 2 + cellSize;
        const oy = ((H * (isSingle ? 0.55 : 0.66)) - gridH) / 2 + cellSize + 30;

        const animPhase = this.crossAnim ? this.crossAnim.phase : 'done';
        const animT = this.crossAnim ? this.crossAnim.t : 1;

        // Title
        ctx.fillStyle = 'rgba(58,158,143,0.7)';
        ctx.font = 'bold ' + (fs + 3) + 'px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText(isSingle ? '\u5355\u57fa\u56e0\u6742\u4ea4' : '\u53cc\u57fa\u56e0\u6742\u4ea4', 10, fs + 5);

        // Parent labels
        ctx.fillStyle = 'rgba(58,158,143,0.6)';
        ctx.font = '600 ' + (fs + 5) + 'px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText('\u2640 ' + this.parent2, ox + gridW / 2 - cellSize / 2, oy - cellSize - 6);
        ctx.save();
        ctx.translate(ox - cellSize - 6, oy + gridH / 2 - cellSize / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('\u2642 ' + this.parent1, 0, 0);
        ctx.restore();

        // Header row (gametes of parent2)
        for (let c = 0; c < cols; c++) {
            const x = ox + c * cellSize, y = oy - cellSize;
            ctx.fillStyle = 'rgba(58,158,143,0.12)';
            ctx.fillRect(x, y, cellSize - 2, cellSize - 2);
            ctx.fillStyle = '#3a9e8f';
            ctx.font = '600 ' + (fs + 3) + 'px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillText(g2[c], x + cellSize / 2 - 1, y + cellSize / 2 + 4);
        }

        // Header col (gametes of parent1)
        for (let r = 0; r < rows; r++) {
            const x = ox - cellSize, y = oy + r * cellSize;
            ctx.fillStyle = 'rgba(58,158,143,0.12)';
            ctx.fillRect(x, y, cellSize - 2, cellSize - 2);
            ctx.fillStyle = '#3a9e8f';
            ctx.font = '600 ' + (fs + 3) + 'px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillText(g1[r], x + cellSize / 2 - 1, y + cellSize / 2 + 4);
        }

        // Grid cells
        let idx = 0;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x = ox + c * cellSize, y = oy + r * cellSize;
                const genotype = grid[idx];
                const type = this._genotypeType(genotype);

                // Animation: fade in
                let alpha = 1;
                if (animPhase === 'gamete') alpha = 0;
                else if (animPhase === 'combine') alpha = Math.min(1, animT / 1.2);

                const colors = {
                    dominant: 'rgba(58,158,143,0.2)',
                    carrier: 'rgba(139,111,192,0.15)',
                    recessive: 'rgba(196,121,58,0.15)',
                    dom_dom: 'rgba(58,158,143,0.2)',
                    dom_rec: 'rgba(78,130,196,0.18)',
                    rec_dom: 'rgba(196,170,58,0.18)',
                    rec_rec: 'rgba(196,121,58,0.2)'
                };

                ctx.globalAlpha = alpha;
                ctx.fillStyle = colors[type] || colors.carrier;
                ctx.fillRect(x, y, cellSize - 2, cellSize - 2);
                ctx.strokeStyle = 'rgba(255,255,255,0.08)';
                ctx.lineWidth = 1;
                ctx.strokeRect(x, y, cellSize - 2, cellSize - 2);

                ctx.fillStyle = '#fff';
                const cellFs = Math.min(fs + 5, cellSize * (genotype.length > 2 ? 0.28 : 0.48));
                ctx.font = '600 ' + cellFs + 'px ' + CF.mono;
                ctx.textAlign = 'center';
                ctx.fillText(genotype, x + cellSize / 2 - 1, y + cellSize / 2 + 4);
                ctx.globalAlpha = 1;

                idx++;
            }
        }

        // ── Statistics bar chart (right side) ──
        this._drawPunnettStats(ctx, W, H, counts, total);
    },

    _drawPunnettStats(ctx, W, H, counts, total) {
        const fs = Math.max(11, W * 0.019);
        const entries = Object.entries(counts).sort();
        const isDouble = this.punnettMode !== 'single';
        const many = entries.length > 9 || isDouble;
        const labelFs = many ? Math.max(10, fs * 0.65) : fs;
        const pctFs = many ? Math.max(9, fs * 0.6) : fs;
        const statX = many ? W * 0.50 : W * 0.6;
        const statW = many ? W * 0.48 : W * 0.35;
        const barArea = { x: statX, y: 30, w: statW, h: many ? H * 0.75 : H * 0.55 };
        const barW = Math.min(barArea.w / (entries.length * 1.4), many ? 30 : 50);
        const gap = barW * (many ? 0.35 : 0.6);
        const totalW = entries.length * barW + (entries.length - 1) * gap;
        const startX = barArea.x + (barArea.w - totalW) / 2;

        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '500 ' + (many ? labelFs + 2 : fs) + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('\u540e\u4ee3\u7edf\u8ba1', barArea.x + barArea.w / 2, barArea.y - 6);

        const maxCount = Math.max(...entries.map(e => e[1]));
        const maxBarH = barArea.h - (many ? 60 : 40);

        entries.forEach(([g, count], i) => {
            const x = startX + i * (barW + gap);
            const ratio = count / total;
            const barH = (count / maxCount) * maxBarH;
            const type = this._genotypeType(g);

            const colors = {
                dominant: '#3a9e8f',
                carrier: '#8b6fc0',
                recessive: '#c4793a',
                dom_dom: '#3a9e8f',
                dom_rec: '#4e82c4',
                rec_dom: '#c4aa3a',
                rec_rec: '#c4793a'
            };
            const color = colors[type] || '#3a9e8f';

            // Bar
            ctx.fillStyle = color + '44';
            ctx.fillRect(x, barArea.y + maxBarH - barH + 20, barW, barH);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(x, barArea.y + maxBarH - barH + 20, barW, barH);

            // Genotype label (rotated for many entries)
            ctx.fillStyle = color;
            if (many) {
                ctx.save();
                ctx.font = '600 ' + labelFs + 'px ' + CF.mono;
                ctx.textAlign = 'right';
                ctx.translate(x + barW / 2 + 3, barArea.y + maxBarH + 26);
                ctx.rotate(-Math.PI / 4);
                ctx.fillText(g, 0, 0);
                ctx.restore();
            } else {
                ctx.font = '600 ' + fs + 'px ' + CF.mono;
                ctx.textAlign = 'center';
                ctx.fillText(g, x + barW / 2, barArea.y + maxBarH + 36);
            }

            // Percentage
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            ctx.font = '500 ' + pctFs + 'px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillText((ratio * 100).toFixed(1) + '%', x + barW / 2, barArea.y + maxBarH - barH + 14);
        });

        // Legend
        const legendY = barArea.y + barArea.h + (many ? 50 : 30);
        const legendItems = many ? [
            ['A_B_(\u53cc\u663e)', '#3a9e8f'],
            ['A_bb', '#4e82c4'],
            ['aaB_', '#c4aa3a'],
            ['aabb(\u53cc\u9690)', '#c4793a']
        ] : [
            ['\u663e\u6027\u7eaf\u5408', '#3a9e8f'],
            ['\u6742\u5408', '#8b6fc0'],
            ['\u9690\u6027\u7eaf\u5408', '#c4793a']
        ];
        let lx = barArea.x;
        for (const [label, color] of legendItems) {
            ctx.fillStyle = color;
            ctx.fillRect(lx, legendY, 10, 10);
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = (many ? labelFs : fs) + 'px ' + CF.sans;
            ctx.textAlign = 'left';
            ctx.fillText(label, lx + 14, legendY + 9);
            lx += ctx.measureText(label).width + 28;
        }

        // Edu panel (bottom)
    },

    _drawPunnettEdu(ctx, W, H) {
        // Education content moved to DOM _injectInfoPanel()
    },

    /* ── Population Draw ── */

    _drawPopulation(ctx, W, H) {
        // Draw individuals
        const genoColors = { AA: '#3a9e8f', Aa: '#8b6fc0', aa: '#c4793a' };

        for (const ind of this.popIndividuals) {
            if (!ind.alive) continue;
            ctx.beginPath();
            ctx.arc(ind.x, ind.y, 3.5, 0, Math.PI * 2);
            ctx.fillStyle = genoColors[ind.genotype] || '#fff';
            ctx.fill();
        }

        // Draw allele frequency history (right panel)
        this._drawPopGraph(ctx, W, H);

    },

    _drawPopGraph(ctx, W, H) {
        const fs = Math.max(11, W * 0.019);
        const gx = W * 0.6, gy = 20, gw = W * 0.36, gh = H * 0.45;

        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fillRect(gx, gy, gw, gh);
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.strokeRect(gx, gy, gw, gh);

        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '500 ' + fs + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('\u7b49\u4f4d\u57fa\u56e0\u9891\u7387\u53d8\u5316', gx + gw / 2, gy - 4);

        // Axes
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.moveTo(gx, gy + gh); ctx.lineTo(gx + gw, gy + gh); // x
        ctx.moveTo(gx, gy); ctx.lineTo(gx, gy + gh); // y
        ctx.stroke();

        // Y labels (0, 0.5, 1)
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = (fs - 3) + 'px ' + CF.mono;
        ctx.textAlign = 'right';
        ctx.fillText('1.0', gx - 3, gy + 4);
        ctx.fillText('0.5', gx - 3, gy + gh / 2 + 3);
        ctx.fillText('0.0', gx - 3, gy + gh + 3);

        if (this.popHistory.length < 2) return;

        // Plot p (dominant allele) in teal
        const len = this.popHistory.length;
        const dx = gw / Math.max(len - 1, 1);

        ctx.strokeStyle = '#3a9e8f'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        this.popHistory.forEach((h, i) => {
            const x = gx + i * dx;
            const y = gy + gh - h.p * gh;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Plot q (recessive allele) in orange
        ctx.strokeStyle = '#c4793a'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        this.popHistory.forEach((h, i) => {
            const x = gx + i * dx;
            const y = gy + gh - h.q * gh;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Graph legend
        const ly = gy + gh + 14;
        ctx.fillStyle = '#3a9e8f';
        ctx.fillRect(gx + 10, ly, 12, 3);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = (fs - 3) + 'px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText('p (A)', gx + 26, ly + 4);

        ctx.fillStyle = '#c4793a';
        ctx.fillRect(gx + 70, ly, 12, 3);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillText('q (a)', gx + 86, ly + 4);
    },

    _drawPopEdu(ctx, W, H) {
        // Education content moved to DOM _injectInfoPanel()
    },

    /* ── Pedigree Draw ── */

    _drawPedigree(ctx, W, H) {
        const fs = Math.max(11, W * 0.019);
        if (!this.pedigreeData) {
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.font = (fs + 8) + 'px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.fillText('\u9009\u62e9\u9057\u4f20\u65b9\u5f0f\u67e5\u770b\u7cfb\u8c31\u56fe', W / 2, H / 2);
            return;
        }

        const { nodes, unions, children, title } = this.pedigreeData;
        const genCount = Math.max(...nodes.map(n => n.gen)) + 1;
        const genH = (H * 0.65) / (genCount + 0.5);
        const r = 18;

        // Title
        ctx.fillStyle = 'rgba(58,158,143,0.6)';
        ctx.font = 'bold ' + (fs + 3) + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText(title, W / 2, 22);

        // Compute positions
        const positions = {};
        for (const node of nodes) {
            const sameGen = nodes.filter(n => n.gen === node.gen);
            const maxPos = Math.max(...sameGen.map(n => n.pos)) + 1;
            const colW = W * 0.7 / maxPos;
            positions[node.id] = {
                x: W * 0.15 + colW * (node.pos + 0.5),
                y: genH * (node.gen + 1) + 20
            };
        }

        // Draw union lines
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1.5;
        for (const [id1, id2] of unions) {
            const p1 = positions[id1], p2 = positions[id2];
            ctx.beginPath();
            ctx.moveTo(p1.x + r + 2, p1.y);
            ctx.lineTo(p2.x - r - 2, p2.y);
            ctx.stroke();
        }

        // Draw parent-child lines
        for (const [key, childIds] of Object.entries(children)) {
            const [pid1, pid2] = key.split('-').map(Number);
            const pp1 = positions[pid1], pp2 = positions[pid2];
            const midX = (pp1.x + pp2.x) / 2;
            const midY = pp1.y;

            // Vertical line down from union
            const childY = positions[childIds[0]].y;
            const lineY = midY + r + 5;
            const childLineY = childY - r - 5;
            const branchY = (lineY + childLineY) / 2;

            ctx.strokeStyle = 'rgba(255,255,255,0.15)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(midX, lineY);
            ctx.lineTo(midX, branchY);
            ctx.stroke();

            // Horizontal line across children
            const childXs = childIds.map(id => positions[id].x);
            const minCX = Math.min(...childXs), maxCX = Math.max(...childXs);
            ctx.beginPath();
            ctx.moveTo(minCX, branchY);
            ctx.lineTo(maxCX, branchY);
            ctx.stroke();

            // Vertical lines to each child
            for (const cid of childIds) {
                const cp = positions[cid];
                ctx.beginPath();
                ctx.moveTo(cp.x, branchY);
                ctx.lineTo(cp.x, childLineY);
                ctx.stroke();
            }
        }

        // Draw nodes
        for (const node of nodes) {
            const { x, y } = positions[node.id];
            const selected = this._selectedPedigreeNode === node;

            if (node.sex === 'M') {
                // Male = square
                ctx.fillStyle = node.affected ? '#3a9e8f' : 'rgba(255,255,255,0.04)';
                ctx.fillRect(x - r, y - r, r * 2, r * 2);
                ctx.strokeStyle = selected ? '#fff' : 'rgba(58,158,143,0.5)';
                ctx.lineWidth = selected ? 2.5 : 1.5;
                ctx.strokeRect(x - r, y - r, r * 2, r * 2);
            } else {
                // Female = circle
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fillStyle = node.affected ? '#3a9e8f' : 'rgba(255,255,255,0.04)';
                ctx.fill();
                ctx.strokeStyle = selected ? '#fff' : 'rgba(58,158,143,0.5)';
                ctx.lineWidth = selected ? 2.5 : 1.5;
                ctx.stroke();
            }

            // Carrier dot (for autosomal recessive carriers)
            if (!node.affected && node.genotype.includes('a') && !node.genotype.startsWith('aa')) {
                ctx.beginPath();
                ctx.arc(x, y, 4, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(58,158,143,0.5)';
                ctx.fill();
            }

            // Generation label
            if (node.pos === 0) {
                ctx.fillStyle = 'rgba(255,255,255,0.2)';
                ctx.font = fs + 'px ' + CF.sans;
                ctx.textAlign = 'right';
                const genLabels = ['I', 'II', 'III', 'IV'];
                ctx.fillText(genLabels[node.gen] || '', W * 0.1, y + 4);
            }
        }

    }
};

function initGenetics() {
    Genetics.init();
}
