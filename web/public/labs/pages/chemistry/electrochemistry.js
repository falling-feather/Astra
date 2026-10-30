// ===== Electrochemistry Visualization =====
// Galvanic cell (原电池) and Electrolytic cell (电解池)

const Electrochemistry = {
    canvas: null, ctx: null, W: 0, H: 0,
    _listeners: [],
    _resizeObs: null,
    _raf: null,

    mode: 'galvanic', // 'galvanic' or 'electrolytic'
    running: true,
    time: 0,
    particles: [], // electron/ion particles

    // Galvanic: Zn-Cu cell
    // Electrolytic: CuSO4 electrolysis
    cells: {
        galvanic: {
            anode: { metal: 'Zn', color: '#7a8fc2', label: '\u8d1f\u6781/\u9633\u6781(Zn)', reaction: 'Zn \u2212 2e\u207b \u2192 Zn\u00b2\u207a' },
            cathode: { metal: 'Cu', color: '#c49566', label: '\u6b63\u6781/\u9634\u6781(Cu)', reaction: 'Cu\u00b2\u207a + 2e\u207b \u2192 Cu' },
            electrolyte: 'ZnSO\u2084 / CuSO\u2084',
            title: '\u539f\u7535\u6c60 (Zn\u2012Cu)',
            emf: 'E\u00b0 = 1.10 V'
        },
        electrolytic: {
            anode: { metal: 'C(+)', color: '#666', label: '\u9633\u6781(+)', reaction: '2Cl\u207b \u2212 2e\u207b \u2192 Cl\u2082\u2191' },
            cathode: { metal: 'C(\u2212)', color: '#555', label: '\u9634\u6781(\u2212)', reaction: 'Cu\u00b2\u207a + 2e\u207b \u2192 Cu' },
            electrolyte: 'CuCl\u2082 \u6eb6\u6db2',
            title: '\u7535\u89e3\u6c60 (CuCl\u2082)',
            emf: '\u5916\u52a0\u7535\u538b'
        }
    },

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        this.canvas = document.getElementById('echem-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.time = 0;
        this.particles = [];
        this.running = true;
        this.resize();
        this.bindEvents();
        this.spawnParticles();
        this.loop();
    },

    destroy() {
        this.running = false;
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
        for (const l of this._listeners) l.el.removeEventListener(l.evt, l.fn, l.opts);
        this._listeners = [];
        if (this._resizeObs) { this._resizeObs.disconnect(); this._resizeObs = null; }
    },

    resize() {
        const wrap = this.canvas.parentElement;
        if (!wrap) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = wrap.getBoundingClientRect();
        const w = rect.width;
        const h = Math.min(w * 0.65, 420);
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w;
        this.H = h;
    },

    bindEvents() {
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver(() => { this.resize(); });
            this._resizeObs.observe(this.canvas.parentElement);
        }

        document.querySelectorAll('.echem-mode-btn').forEach(btn => {
            this._on(btn, 'click', () => {
                document.querySelectorAll('.echem-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.mode = btn.dataset.mode;
                this.time = 0;
                this.spawnParticles();
                this.updateInfo();
            });
        });

        const playBtn = document.getElementById('echem-play');
        if (playBtn) this._on(playBtn, 'click', () => {
            this.running = !this.running;
            playBtn.textContent = this.running ? '\u23f8 \u6682\u505c' : '\u25b6 \u64ad\u653e';
            if (this.running) this.loop();
        });
    },

    spawnParticles() {
        this.particles = [];
        // Electrons in wire (top)
        for (let i = 0; i < 8; i++) {
            this.particles.push({
                type: 'electron',
                progress: Math.random(), // 0-1 along wire path
                speed: 0.15 + Math.random() * 0.1
            });
        }
        // Cations in solution
        for (let i = 0; i < 6; i++) {
            this.particles.push({
                type: 'cation',
                progress: Math.random(),
                speed: 0.06 + Math.random() * 0.04,
                y: 0.3 + Math.random() * 0.4
            });
        }
        // Anions in solution
        for (let i = 0; i < 5; i++) {
            this.particles.push({
                type: 'anion',
                progress: Math.random(),
                speed: 0.04 + Math.random() * 0.03,
                y: 0.3 + Math.random() * 0.4
            });
        }
    },

    updateInfo() {
        const cell = this.cells[this.mode];
        const el = document.getElementById('echem-info');
        if (!el) return;
        let h = '';
        if (this.mode === 'galvanic') {
            h = `<div class="chem-hd"><span class="chem-tag">原电池</span>电化学知识点</div>
<div class="chem-row"><span class="chem-key">装置</span>${cell.title} &emsp; ${cell.emf}</div>
<div class="chem-row"><span class="chem-key chem-key--purple">负极（氧化）</span>${cell.anode.reaction} — 较活泼金属失电子</div>
<div class="chem-row"><span class="chem-key chem-key--amber">正极（还原）</span>${cell.cathode.reaction} — 较不活泼金属/碳棒得电子</div>
<div class="chem-row"><span class="chem-key">电解质</span>${cell.electrolyte} — 离子定向移动形成内电路</div>
<div class="chem-row"><span class="chem-key">判断方法</span>活泼性：Zn > Cu → Zn 为负极（阳极，氧化）。电子外电路：负极→正极</div>
<div class="chem-row"><span class="chem-key">离子迁移</span>阳离子向阴极附近、阴离子向阳极附近移动，以维持溶液电中性</div>
<div class="chem-note">💡 人教版必修2：原电池将化学能转化为电能。构成条件：①两种活泼性不同的电极 ②电解质溶液 ③形成闭合回路 ④自发氧化还原反应</div>`;
        } else {
            h = `<div class="chem-hd"><span class="chem-tag">电解池</span>电化学知识点</div>
<div class="chem-row"><span class="chem-key">装置</span>${cell.title} &emsp; ${cell.emf}</div>
<div class="chem-row"><span class="chem-key chem-key--purple">阳极（氧化）</span>${cell.anode.reaction} — 阴离子在阳极失电子</div>
<div class="chem-row"><span class="chem-key chem-key--amber">阴极（还原）</span>${cell.cathode.reaction} — 阳离子在阴极得电子</div>
<div class="chem-row"><span class="chem-key">电解质</span>${cell.electrolyte} — 外加电源强制非自发反应发生</div>
<div class="chem-row"><span class="chem-key">电极符号</span>电解池阳极接电源正极，阴极接电源负极；阳极氧化、阴极还原</div>
<div class="chem-row"><span class="chem-key">放电顺序</span>阳极：S²⁻>I⁻>Br⁻>Cl⁻>OH⁻；阴极：Ag⁺>Cu²⁺>H⁺>…</div>
<div class="chem-note">💡 人教版选择性必修1：电解将电能转化为化学能。阳极连电源正极，阴极连负极。"阳氧阴还"口诀</div>`;
        }
        el.innerHTML = h;
    },

    loop() {
        if (!this.running) return;
        this.time += 0.016;

        // Move particles
        this.particles.forEach(p => {
            p.progress += p.speed * 0.016;
            if (p.progress > 1) p.progress -= 1;
        });

        this.draw();
        this._raf = requestAnimationFrame(() => this.loop());
    },

    draw() {
        const { ctx, W, H, mode } = this;
        if (!ctx || W === 0) return;
        ctx.clearRect(0, 0, W, H);

        const cell = this.cells[mode];
        const pad = 30;
        const cellW = W - pad * 2;
        const cellH = H - 60;
        const cellY = 40;

        // Solution container
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(pad, cellY, cellW, cellH);

        // Solution fill
        const solGrad = ctx.createLinearGradient(pad, cellY, pad, cellY + cellH);
        solGrad.addColorStop(0, 'rgba(77,158,126,0.05)');
        solGrad.addColorStop(1, 'rgba(77,158,126,0.12)');
        ctx.fillStyle = solGrad;
        ctx.fillRect(pad + 1, cellY + 1, cellW - 2, cellH - 2);

        // Salt bridge / membrane (center divider)
        const midX = W / 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 6;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(midX, cellY);
        ctx.lineTo(midX, cellY + cellH);
        ctx.stroke();
        ctx.setLineDash([]);

        // Salt bridge label
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '15px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText(mode === 'galvanic' ? '\u76d0\u6865' : '\u9694\u819c', midX, cellY + cellH + 14);

        // Electrodes
        const ew = 20, eh = cellH * 0.6;
        const anodeX = pad + cellW * 0.2;
        const cathodeX = pad + cellW * 0.8;
        const electrodeY = cellY + cellH * 0.2;

        // Anode
        ctx.fillStyle = cell.anode.color;
        ctx.fillRect(anodeX - ew / 2, electrodeY, ew, eh);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.strokeRect(anodeX - ew / 2, electrodeY, ew, eh);

        // Cathode
        ctx.fillStyle = cell.cathode.color;
        ctx.fillRect(cathodeX - ew / 2, electrodeY, ew, eh);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.strokeRect(cathodeX - ew / 2, electrodeY, ew, eh);

        // Electrode labels
        ctx.fillStyle = '#ddd';
        ctx.font = 'bold 16px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText(cell.anode.label, anodeX, electrodeY - 6);
        ctx.fillText(cell.cathode.label, cathodeX, electrodeY - 6);

        // Wire on top connecting electrodes
        const wireY = cellY - 18;
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(anodeX, electrodeY);
        ctx.lineTo(anodeX, wireY);
        ctx.lineTo(cathodeX, wireY);
        ctx.lineTo(cathodeX, electrodeY);
        ctx.stroke();

        // Direction label on wire
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '15px ' + CF.sans;
        ctx.textAlign = 'center';
        const arrowDir = mode === 'galvanic' ? '\u2192' : '\u2190';
        ctx.fillText('e\u207b ' + arrowDir, midX, wireY - 4);

        // External device (lightbulb / battery)
        if (mode === 'galvanic') {
            // Lightbulb icon
            ctx.beginPath();
            ctx.arc(midX, wireY, 6, 0, Math.PI * 2);
            ctx.strokeStyle = '#e5c07b';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            const glow = Math.sin(this.time * 4) * 0.3 + 0.7;
            ctx.fillStyle = 'rgba(229,192,123,' + glow + ')';
            ctx.fill();
        } else {
            // Battery icon
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.fillRect(midX - 10, wireY - 4, 20, 8);
            ctx.fillStyle = '#e06c75';
            ctx.fillRect(midX - 7, wireY - 3, 14, 6);
            ctx.fillStyle = '#fff';
            ctx.font = '13px ' + CF.sans;
            ctx.fillText('\u7535\u6e90', midX, wireY + 16);
        }

        // Draw particles
        this.drawParticles(anodeX, cathodeX, wireY, electrodeY, eh, cellY, cellH, pad, cellW);

        // Reactions at bottom
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '16px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText(cell.anode.reaction, anodeX, cellY + cellH + 14);
        ctx.fillText(cell.cathode.reaction, cathodeX, cellY + cellH + 14);

        // Bubbles effect at electrodes
        this.drawBubbles(anodeX, cathodeX, electrodeY, eh);
    },

    drawParticles(anodeX, cathodeX, wireY, electrodeY, eh, cellY, cellH, pad, cellW) {
        const ctx = this.ctx;
        const isGalvanic = this.mode === 'galvanic';

        this.particles.forEach(p => {
            if (p.type === 'electron') {
                // Electron travels along wire: anode -> up -> right -> cathode (galvanic)
                // Electrolytic: cathode(left) -> up -> right -> anode(right)
                let x, y;
                const fromX = isGalvanic ? anodeX : cathodeX;
                const toX = isGalvanic ? cathodeX : anodeX;
                const totalPath = (electrodeY - wireY) * 2 + Math.abs(toX - fromX);
                const leg1 = electrodeY - wireY; // up
                const leg2 = Math.abs(toX - fromX); // across
                const pos = p.progress * totalPath;

                if (pos < leg1) {
                    x = fromX;
                    y = electrodeY - pos;
                } else if (pos < leg1 + leg2) {
                    const t = (pos - leg1) / leg2;
                    x = fromX + (toX - fromX) * t;
                    y = wireY;
                } else {
                    x = toX;
                    y = wireY + (pos - leg1 - leg2);
                }

                ctx.fillStyle = '#5b8dce';
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fill();

                // e- label
                ctx.fillStyle = 'rgba(91,141,206,0.6)';
                ctx.font = '13px ' + CF.sans;
                ctx.textAlign = 'center';
                ctx.fillText('e\u207b', x, y - 5);
            } else if (p.type === 'cation') {
                // Cations move toward cathode through solution
                const solLeft = pad + 10;
                const solRight = pad + cellW - 10;
                const cathSide = isGalvanic ? solRight * 0.7 : solLeft + cellW * 0.3;
                const x = solLeft + p.progress * (solRight - solLeft);
                const y = cellY + p.y * cellH;

                ctx.fillStyle = '#c49566';
                ctx.beginPath();
                ctx.arc(x, y, 3.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = 'rgba(196,149,102,0.5)';
                ctx.font = '12px ' + CF.sans;
                ctx.textAlign = 'center';
                ctx.fillText('+', x, y - 5);
            } else if (p.type === 'anion') {
                // Anions move toward anode
                const solLeft = pad + 10;
                const solRight = pad + cellW - 10;
                const x = solRight - p.progress * (solRight - solLeft);
                const y = cellY + p.y * cellH;

                ctx.fillStyle = '#4d9e7e';
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = 'rgba(77,158,126,0.5)';
                ctx.font = '12px ' + CF.sans;
                ctx.textAlign = 'center';
                ctx.fillText('\u2212', x, y - 5);
            }
        });
    },

    drawBubbles(anodeX, cathodeX, electrodeY, eh) {
        const ctx = this.ctx;
        const t = this.time;

        // Small bubbles at anode (oxidation produces ions / gas)
        for (let i = 0; i < 3; i++) {
            const phase = t * 1.5 + i * 2.1;
            const y = electrodeY + eh * 0.3 - (phase % 3) * 15;
            const x = anodeX + Math.sin(phase * 2) * 6;
            const r = 1.5 + Math.sin(phase) * 0.5;
            ctx.fillStyle = 'rgba(255,255,255,0.1)';
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }

        // At cathode (reduction deposits / produces gas)
        for (let i = 0; i < 3; i++) {
            const phase = t * 1.2 + i * 1.8;
            const y = electrodeY + eh * 0.4 - (phase % 3) * 12;
            const x = cathodeX + Math.sin(phase * 1.8) * 6;
            const r = 1.5 + Math.cos(phase) * 0.5;
            ctx.fillStyle = 'rgba(255,255,255,0.1)';
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
    }
};

function initElectrochemistry() {
    Electrochemistry.init();
    Electrochemistry.updateInfo();
}

window.Electrochemistry = Electrochemistry;
window.initElectrochemistry = initElectrochemistry;
