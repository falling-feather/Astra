/* ═══════════════════════════════════════════════════
   Ionic Reaction – Equation Splitting & Ionization
   ═══════════════════════════════════════════════════ */
const IonicReaction = {
    _listeners: [],
    _on(el, evt, fn, opts) { el.addEventListener(evt, fn, opts); this._listeners.push({ el, evt, fn, opts }); },
    canvas: null, ctx: null, animId: null,
    currentIdx: 0,
    animProgress: 0,
    phase: 'molecular', // molecular | ionic | net-ionic
    reactions: [
        {
            name: 'NaOH + HCl \u2192 NaCl + H\u2082O',
            molecular: ['NaOH', '+', 'HCl', '\u2192', 'NaCl', '+', 'H\u2082O'],
            ionic: ['Na\u207A', '+', 'OH\u207B', '+', 'H\u207A', '+', 'Cl\u207B', '\u2192', 'Na\u207A', '+', 'Cl\u207B', '+', 'H\u2082O'],
            netIonic: ['OH\u207B', '+', 'H\u207A', '\u2192', 'H\u2082O'],
            spectator: ['Na\u207A', 'Cl\u207B'],
            particles: { left: [
                { symbol: 'Na\u207A', color: 'rgba(100,150,255,0.8)', charge: '+' },
                { symbol: 'OH\u207B', color: 'rgba(255,100,100,0.8)', charge: '-' },
                { symbol: 'H\u207A', color: 'rgba(255,200,50,0.8)', charge: '+' },
                { symbol: 'Cl\u207B', color: 'rgba(100,255,150,0.8)', charge: '-' }
            ], right: [
                { symbol: 'Na\u207A', color: 'rgba(100,150,255,0.8)', charge: '+', spectator: true },
                { symbol: 'Cl\u207B', color: 'rgba(100,255,150,0.8)', charge: '-', spectator: true },
                { symbol: 'H\u2082O', color: 'rgba(150,200,255,0.8)', charge: '0' }
            ]}
        },
        {
            name: 'Na\u2082CO\u2083 + 2HCl \u2192 2NaCl + H\u2082O + CO\u2082\u2191',
            molecular: ['Na\u2082CO\u2083', '+', '2HCl', '\u2192', '2NaCl', '+', 'H\u2082O', '+', 'CO\u2082\u2191'],
            ionic: ['2Na\u207A', '+', 'CO\u2083\u00B2\u207B', '+', '2H\u207A', '+', '2Cl\u207B', '\u2192', '2Na\u207A', '+', '2Cl\u207B', '+', 'H\u2082O', '+', 'CO\u2082\u2191'],
            netIonic: ['CO\u2083\u00B2\u207B', '+', '2H\u207A', '\u2192', 'H\u2082O', '+', 'CO\u2082\u2191'],
            spectator: ['Na\u207A', 'Cl\u207B'],
            particles: { left: [
                { symbol: 'Na\u207A', color: 'rgba(100,150,255,0.8)', charge: '+' },
                { symbol: 'CO\u2083\u00B2\u207B', color: 'rgba(255,150,50,0.8)', charge: '2-' },
                { symbol: 'H\u207A', color: 'rgba(255,200,50,0.8)', charge: '+' },
                { symbol: 'Cl\u207B', color: 'rgba(100,255,150,0.8)', charge: '-' }
            ], right: [
                { symbol: 'Na\u207A', color: 'rgba(100,150,255,0.8)', charge: '+', spectator: true },
                { symbol: 'Cl\u207B', color: 'rgba(100,255,150,0.8)', charge: '-', spectator: true },
                { symbol: 'H\u2082O', color: 'rgba(150,200,255,0.8)', charge: '0' },
                { symbol: 'CO\u2082', color: 'rgba(200,200,200,0.8)', charge: '0' }
            ]}
        },
        {
            name: 'BaCl\u2082 + Na\u2082SO\u2084 \u2192 BaSO\u2084\u2193 + 2NaCl',
            molecular: ['BaCl\u2082', '+', 'Na\u2082SO\u2084', '\u2192', 'BaSO\u2084\u2193', '+', '2NaCl'],
            ionic: ['Ba\u00B2\u207A', '+', '2Cl\u207B', '+', '2Na\u207A', '+', 'SO\u2084\u00B2\u207B', '\u2192', 'BaSO\u2084\u2193', '+', '2Na\u207A', '+', '2Cl\u207B'],
            netIonic: ['Ba\u00B2\u207A', '+', 'SO\u2084\u00B2\u207B', '\u2192', 'BaSO\u2084\u2193'],
            spectator: ['Na\u207A', 'Cl\u207B'],
            particles: { left: [
                { symbol: 'Ba\u00B2\u207A', color: 'rgba(200,100,255,0.8)', charge: '2+' },
                { symbol: 'Cl\u207B', color: 'rgba(100,255,150,0.8)', charge: '-' },
                { symbol: 'Na\u207A', color: 'rgba(100,150,255,0.8)', charge: '+' },
                { symbol: 'SO\u2084\u00B2\u207B', color: 'rgba(255,150,100,0.8)', charge: '2-' }
            ], right: [
                { symbol: 'Na\u207A', color: 'rgba(100,150,255,0.8)', charge: '+', spectator: true },
                { symbol: 'Cl\u207B', color: 'rgba(100,255,150,0.8)', charge: '-', spectator: true },
                { symbol: 'BaSO\u2084\u2193', color: 'rgba(255,255,255,0.9)', charge: '0' }
            ]}
        }
    ],
    particlePositions: [],

    init() {
        this.canvas = document.getElementById('ionic-reaction-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this._resize();
        this._on(window, 'resize', () => this._resize());
        this._buildControls();
        this._initParticles();
        this.updateInfo();
        this._loop();
    },
    destroy() {
        if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
        this._listeners.forEach(l => l.el.removeEventListener(l.evt, l.fn, l.opts));
        this._listeners.length = 0;
        const c = document.getElementById('ionic-reaction-controls');
        if (c) c.innerHTML = '';
    },
    _resize() {
        const p = this.canvas.parentElement;
        const dpr = window.devicePixelRatio || 1;
        const w = p.clientWidth;
        const h = p.clientHeight || 420;
        if (w <= 0 || h <= 0) return;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w;
        this.H = h;
    },
    _buildControls() {
        const ctrl = document.getElementById('ionic-reaction-controls');
        if (!ctrl) return;
        ctrl.innerHTML = '';
        // reaction selector
        const sel = document.createElement('select');
        sel.className = 'ionrxn-select';
        this.reactions.forEach((r, i) => {
            const opt = document.createElement('option');
            opt.value = i; opt.textContent = r.name;
            sel.appendChild(opt);
        });
        this._on(sel, 'change', () => {
            this.currentIdx = parseInt(sel.value);
            this.phase = 'molecular';
            this.animProgress = 0;
            this._initParticles();
            this._updatePhaseButtons();
            this.updateInfo();
        });
        ctrl.appendChild(sel);
        // phase buttons
        const phases = [
            { id: 'molecular', label: '\u5316\u5b66\u65b9\u7a0b\u5f0f' },
            { id: 'ionic', label: '\u5168\u79bb\u5b50\u65b9\u7a0b\u5f0f' },
            { id: 'net-ionic', label: '\u51c0\u79bb\u5b50\u65b9\u7a0b\u5f0f' }
        ];
        this._phaseBtnWrap = document.createElement('div');
        this._phaseBtnWrap.className = 'ionrxn-mode-btns';
        phases.forEach(p => {
            const b = document.createElement('button');
            b.className = 'ionrxn-mode-btn' + (p.id === this.phase ? ' active' : '');
            b.textContent = p.label;
            b.dataset.phase = p.id;
            this._on(b, 'click', () => {
                this.phase = p.id;
                this.animProgress = 0;
                this._updatePhaseButtons();
                this.updateInfo();
            });
            this._phaseBtnWrap.appendChild(b);
        });
        ctrl.appendChild(this._phaseBtnWrap);
    },
    _updatePhaseButtons() {
        if (!this._phaseBtnWrap) return;
        this._phaseBtnWrap.querySelectorAll('.ionrxn-mode-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.phase === this.phase);
        });
    },
    _initParticles() {
        this.particlePositions = [];
        const rxn = this.reactions[this.currentIdx];
        const allP = rxn.particles.left.concat(rxn.particles.right);
        allP.forEach((p, i) => {
            const isLeft = i < rxn.particles.left.length;
            this.particlePositions.push({
                x: isLeft ? 80 + Math.random() * (this.W * 0.35) : this.W * 0.55 + Math.random() * (this.W * 0.35),
                y: this.H * 0.45 + Math.random() * (this.H * 0.35),
                vx: (Math.random() - 0.5) * 0.8,
                vy: (Math.random() - 0.5) * 0.8,
                ...p
            });
        });
    },
    _draw(t) {
        const ctx = this.ctx, W = this.W, H = this.H;
        ctx.clearRect(0, 0, W, H);
        const rxn = this.reactions[this.currentIdx];
        this.animProgress = Math.min(1, this.animProgress + 0.008);

        // beaker background
        ctx.strokeStyle = 'rgba(200,200,200,0.15)';
        ctx.lineWidth = 2;
        // left beaker
        ctx.beginPath();
        ctx.moveTo(30, H * 0.38); ctx.lineTo(30, H * 0.85); ctx.lineTo(W * 0.45, H * 0.85); ctx.lineTo(W * 0.45, H * 0.38);
        ctx.stroke();
        ctx.fillStyle = 'rgba(77,158,126,0.05)';
        ctx.fillRect(30, H * 0.38, W * 0.45 - 30, H * 0.47);
        // right beaker
        ctx.beginPath();
        ctx.moveTo(W * 0.55, H * 0.38); ctx.lineTo(W * 0.55, H * 0.85); ctx.lineTo(W - 30, H * 0.85); ctx.lineTo(W - 30, H * 0.38);
        ctx.stroke();
        ctx.fillStyle = 'rgba(77,158,126,0.05)';
        ctx.fillRect(W * 0.55, H * 0.38, W * 0.45 - 30, H * 0.47);

        // arrow between beakers
        ctx.beginPath();
        ctx.moveTo(W * 0.46, H * 0.6);
        ctx.lineTo(W * 0.54, H * 0.6);
        ctx.strokeStyle = 'rgba(200,200,200,0.4)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(W * 0.54, H * 0.6);
        ctx.lineTo(W * 0.52, H * 0.57);
        ctx.lineTo(W * 0.52, H * 0.63);
        ctx.closePath();
        ctx.fillStyle = 'rgba(200,200,200,0.4)';
        ctx.fill();

        ctx.font = '15px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(200,200,200,0.5)';
        ctx.fillText('\u53CD\u5E94\u524D', W * 0.24, H * 0.36);
        ctx.fillText('\u53CD\u5E94\u540E', W * 0.76, H * 0.36);

        // animate particles (simple Brownian motion)
        this.particlePositions.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            const isLeft = p.x < W * 0.5;
            const lBound = isLeft ? 40 : W * 0.56;
            const rBound = isLeft ? W * 0.44 : W - 40;
            if (p.x < lBound || p.x > rBound) p.vx *= -1;
            if (p.y < H * 0.4 || p.y > H * 0.83) p.vy *= -1;
            p.x = Math.max(lBound, Math.min(rBound, p.x));
            p.y = Math.max(H * 0.4, Math.min(H * 0.83, p.y));

            const isSpectator = p.spectator && this.phase === 'net-ionic';
            const alpha = isSpectator ? 0.2 : 0.8;
            // draw particle circle
            ctx.beginPath();
            ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
            ctx.fillStyle = p.color.replace('0.8', String(alpha));
            ctx.fill();
            if (isSpectator) {
                ctx.setLineDash([2, 2]);
                ctx.strokeStyle = 'rgba(255,255,255,0.2)';
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.setLineDash([]);
            }
            // symbol
            ctx.font = 'bold 15px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillStyle = isSpectator ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.9)';
            ctx.fillText(p.symbol, p.x, p.y + 4);
        });

        // equation display at top
        let eqParts;
        if (this.phase === 'molecular') eqParts = rxn.molecular;
        else if (this.phase === 'ionic') eqParts = rxn.ionic;
        else eqParts = rxn.netIonic;

        ctx.font = 'bold 19px ' + CF.mono;
        ctx.textAlign = 'center';
        const eqStr = eqParts.join(' ');
        ctx.fillStyle = 'rgba(77,158,126,0.9)';
        ctx.fillText(eqStr, W / 2, 25);

        // spectator ions annotation
        if (this.phase === 'net-ionic') {
            ctx.font = '16px ' + CF.sans;
            ctx.fillStyle = 'rgba(200,200,200,0.5)';
            ctx.fillText('\u65C1\u89C2\u79BB\u5B50: ' + rxn.spectator.join(', ') + ' (\u4E0D\u53C2\u4E0E\u53CD\u5E94)', W / 2, H * 0.92);
        }

        // phase indicator
        const phaseLabels = { 'molecular': '\u5316\u5B66\u65B9\u7A0B\u5F0F', 'ionic': '\u5168\u79BB\u5B50\u65B9\u7A0B\u5F0F', 'net-ionic': '\u51C0\u79BB\u5B50\u65B9\u7A0B\u5F0F' };
        ctx.font = '17px ' + CF.sans;
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(77,158,126,0.7)';
        ctx.fillText(phaseLabels[this.phase], W - 14, H * 0.92);
    },
    _loop() {
        const t = performance.now() / 1000;
        this._draw(t);
        this.animId = requestAnimationFrame(() => this._loop());
    },

    /* ── education panel ── */
    updateInfo() {
        const el = document.getElementById('ionic-info');
        if (!el) return;
        const r = this.reactions[this.currentIdx];
        const phaseLabels = { 'molecular': '化学方程式', 'ionic': '全离子方程式', 'net-ionic': '净离子方程式' };
        const spectators = r.spectator.join('、');
        let h = `<div class="chem-hd"><span class="chem-tag">${phaseLabels[this.phase]}</span>离子反应知识点</div>
<div class="chem-row"><span class="chem-key">离子反应定义</span>有离子参加或生成的反应，在电解质溶液中进行</div>
<div class="chem-row"><span class="chem-key chem-key--purple">拆分规则</span>强酸、强碱、可溶性盐 → 拆为离子；弱电解质、沉淀、气体、水 → 保留分子式</div>
<div class="chem-row"><span class="chem-key chem-key--amber">旁观离子</span>${spectators} — 反应前后形态不变，全离子→净离子时消去</div>`;
        if (this.phase === 'net-ionic') {
            h += `<div class="chem-row"><span class="chem-key">净离子方程式</span>${r.netIonic.join(' ')} — 反映反应本质</div>`;
        }
        h += `<div class="chem-note">💡 人教版必修1：离子方程式书写步骤：写→拆→删→查。本质是找到真正参与反应的离子，消去旁观离子</div>`;
        el.innerHTML = h;
    }
};

function initIonicReaction() { IonicReaction.init(); }
window.IonicReaction = IonicReaction;