/* ═══════════════════════════════════════════════════
   Substance Transport – Membrane Transport Modes
   ═══════════════════════════════════════════════════ */
const SubstanceTransport = {
    _listeners: [],
    _on(el, evt, fn, opts) { el.addEventListener(evt, fn, opts); this._listeners.push({ el, evt, fn, opts }); },
    canvas: null, ctx: null, animId: null,
    mode: 0, // 0=free diffusion, 1=facilitated, 2=active, 3=endo/exocytosis
    modes: [
        { name: '\u81EA\u7531\u6269\u6563', desc: 'O₂/CO₂ 等小分子顺浓度梯度通过磷脂双分子层；水跨膜主要体现为渗透，可经水通道蛋白加速', color: 'rgba(100,200,150,0.8)', energy: false },
        { name: '\u534F\u52A9\u6269\u6563', desc: '\u901A\u9053\u6216\u8F7D\u4F53\u86CB\u767D\u5E2E\u52A9\u6781\u6027\u5206\u5B50\u6216\u79BB\u5B50\u987A\u68AF\u5EA6\u8FD0\u52A8\uFF0C\u4E0D\u76F4\u63A5\u8017\u80FD', color: 'rgba(100,150,255,0.8)', energy: false },
        { name: '\u4E3B\u52A8\u8FD0\u8F93', desc: '\u8F6C\u8FD0\u86CB\u767D\u5229\u7528 ATP \u6216\u65E2\u6709\u7535\u5316\u5B66\u68AF\u5EA6\uFF0C\u5C06\u7269\u8D28\u9006\u68AF\u5EA6\u8FD0\u8F93', color: 'rgba(255,150,50,0.8)', energy: true },
        { name: '\u80DE\u541E/\u80DE\u5410', desc: '\u5927\u5206\u5B50\u3001\u9897\u7C92\u6216\u5927\u91CF\u7269\u8D28\u901A\u8FC7\u56CA\u6CE1\u8FDB\u51FA\u7EC6\u80DE', color: 'rgba(200,100,200,0.8)', energy: true }
    ],
    molecules: [],
    speed: 1,

    init() {
        this.canvas = document.getElementById('substance-transport-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this._resize();
        if (typeof ResizeObserver !== 'undefined') {
            this._ro = new ResizeObserver(() => this._resize());
            this._ro.observe(this.canvas.parentElement);
        } else {
            this._on(window, 'resize', () => this._resize());
        }
        this._buildControls();
        this._injectInfoPanel();
        this._initMolecules();
        this._loop();
    },
    destroy() {
        if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
        this._listeners.forEach(l => l.el.removeEventListener(l.evt, l.fn, l.opts));
        this._listeners.length = 0;
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
        const c = document.getElementById('substance-transport-controls');
        if (c) c.innerHTML = '';
    },
    _resize() {
        const p = this.canvas.parentElement;
        if (!p) return;
        const dpr = window.devicePixelRatio || 1;
        const w = p.getBoundingClientRect().width;
        const h = Math.min(Math.max(w * 0.48, 300), 420);
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w;
        this.H = h;
        this._initMolecules();
    },
    _buildControls() {
        const ctrl = document.getElementById('substance-transport-controls');
        if (!ctrl) return;
        ctrl.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.className = 'strans-mode-btns';
        this.modes.forEach((m, i) => {
            const b = document.createElement('button');
            b.className = 'strans-btn' + (i === this.mode ? ' active' : '');
            b.textContent = m.name;
            this._on(b, 'click', () => {
                this.mode = i;
                this._initMolecules();
                wrap.querySelectorAll('.strans-btn').forEach(x => x.classList.remove('active'));
                b.classList.add('active');
                this._updateInfo();
            });
            wrap.appendChild(b);
        });
        ctrl.appendChild(wrap);
        const label = document.createElement('label');
        label.className = 'strans-speed';
        label.innerHTML = '<span>\u901F\u5EA6</span>';
        const inp = document.createElement('input');
        inp.type = 'range'; inp.min = 0.3; inp.max = 3; inp.step = 0.1; inp.value = 1;
        this._on(inp, 'input', () => { this.speed = parseFloat(inp.value); });
        label.appendChild(inp);
        ctrl.appendChild(label);
    },
    _initMolecules() {
        this.molecules = [];
        const W = this.W, H = this.H;
        const active = this.mode === 2;
        for (let i = 0; i < 12; i++) {
            const drift = 0.25 + Math.random() * 0.45;
            this.molecules.push({
                x: active ? Math.random() * W * 0.30 + W * 0.62 : Math.random() * W * 0.35 + W * 0.05,
                y: Math.random() * (H - 120) + 60,
                vx: active ? -drift : (Math.random() - 0.5) * 0.8,
                vy: (Math.random() - 0.5) * 0.8,
                r: 5 + Math.random() * 3,
                phase: Math.random() * Math.PI * 2,
                crossed: false
            });
        }
    },
    _drawMembrane(t) {
        const ctx = this.ctx, W = this.W, H = this.H;
        const fs = Math.max(13, W * 0.012);
        const mx = W * 0.5;
        // phospholipid bilayer
        ctx.strokeStyle = 'rgba(200,180,120,0.4)';
        ctx.lineWidth = 20;
        ctx.beginPath();
        ctx.moveTo(mx, 50);
        ctx.lineTo(mx, H - 30);
        ctx.stroke();
        // inner lighter
        ctx.strokeStyle = 'rgba(220,200,140,0.2)';
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.moveTo(mx, 50);
        ctx.lineTo(mx, H - 30);
        ctx.stroke();
        // phospholipid heads circles
        for (let y = 55; y < H - 25; y += 15) {
            ctx.beginPath();
            ctx.arc(mx - 10, y + Math.sin(t + y * 0.1) * 1.5, 4, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(200,180,120,0.5)';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(mx + 10, y + Math.sin(t + y * 0.1 + 1) * 1.5, 4, 0, Math.PI * 2);
            ctx.fill();
        }
        const leftLabel = this.mode === 2 ? '\u9AD8\u6D53\u5EA6\u4FA7\uFF08\u76EE\u6807\uFF09' : '\u9AD8\u6D53\u5EA6\u4FA7';
        const rightLabel = this.mode === 2 ? '\u4F4E\u6D53\u5EA6\u4FA7\uFF08\u6765\u6E90\uFF09' : '\u4F4E\u6D53\u5EA6\u4FA7';
        ctx.font = fs + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(200,200,200,0.4)';
        ctx.fillText(leftLabel, W * 0.25, 42);
        ctx.fillText(rightLabel, W * 0.75, 42);
    },
    _drawChannel(t) {
        const ctx = this.ctx, W = this.W, H = this.H;
        const fs = Math.max(13, W * 0.012);
        const mx = W * 0.5;
        // channel protein
        ctx.fillStyle = 'rgba(100,150,255,0.3)';
        ctx.beginPath();
        ctx.moveTo(mx - 15, H * 0.35);
        ctx.lineTo(mx - 8, H * 0.4);
        ctx.lineTo(mx - 8, H * 0.6);
        ctx.lineTo(mx - 15, H * 0.65);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(mx + 15, H * 0.35);
        ctx.lineTo(mx + 8, H * 0.4);
        ctx.lineTo(mx + 8, H * 0.6);
        ctx.lineTo(mx + 15, H * 0.65);
        ctx.closePath();
        ctx.fill();
        ctx.font = (fs - 3) + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(100,150,255,0.6)';
        ctx.fillText('\u8F7D\u4F53\u86CB\u767D', mx, H * 0.32);
    },
    _drawATP(t) {
        const ctx = this.ctx, W = this.W, H = this.H;
        const fs = Math.max(13, W * 0.012);
        const mx = W * 0.5;
        // pump protein (active transport)
        ctx.fillStyle = 'rgba(255,150,50,0.3)';
        ctx.beginPath();
        ctx.ellipse(mx, H * 0.5, 18, 45, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,150,50,0.5)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.font = (fs - 3) + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,150,50,0.7)';
        ctx.fillText('\u8F7D\u4F53\u86CB\u767D', mx, H * 0.5);
        // ATP icon
        const ap = (t * 0.5) % 1;
        ctx.beginPath();
        ctx.arc(mx + 25, H * 0.5 + 20, 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,200,50,' + (0.4 + ap * 0.3) + ')';
        ctx.fill();
        ctx.font = 'bold ' + (fs - 3) + 'px ' + CF.mono;
        ctx.fillStyle = '#fff';
        ctx.fillText('ATP', mx + 25, H * 0.5 + 22);
        ctx.fillStyle = 'rgba(200,200,200,0.3)';
        ctx.fillText('\u4F4E \u2192 \u9AD8\uFF08\u8017\u80FD\uFF09', mx, H - 15);
    },
    _drawVesicle(t) {
        const ctx = this.ctx, W = this.W, H = this.H;
        const fs = Math.max(13, W * 0.012);
        const mx = W * 0.5;
        // endocytosis on top
        const ep = ((t * 0.3) % 1);
        const ey = H * 0.35;
        // membrane invagination
        ctx.beginPath();
        ctx.arc(mx, ey, 12 + ep * 8, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(200,180,120,0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
        if (ep > 0.6) {
            ctx.beginPath();
            ctx.arc(mx + 25 * (ep - 0.6) * 2.5, ey, 10, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(200,100,200,0.3)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(200,180,120,0.4)';
            ctx.stroke();
        }
        ctx.font = (fs - 3) + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(200,100,200,0.6)';
        ctx.fillText('\u80DE\u541E', mx, ey - 25);
        // exocytosis on bottom
        const ey2 = H * 0.65;
        const ep2 = ((t * 0.3 + 0.5) % 1);
        ctx.beginPath();
        ctx.arc(mx - 25 * ep2, ey2, 10, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(200,100,200,0.3)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(200,180,120,0.4)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = 'rgba(200,100,200,0.6)';
        ctx.fillText('\u80DE\u5410', mx, ey2 + 30);
    },
    _draw(t) {
        const ctx = this.ctx, W = this.W, H = this.H;
        ctx.clearRect(0, 0, W, H);
        const fs = Math.max(13, W * 0.012);
        const m = this.modes[this.mode];
        ctx.font = 'bold ' + (fs + 8) + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(58,158,143,0.9)';
        this._fitText('\u7269\u8D28\u8FD0\u8F93 - ' + m.name, W / 2, 25, W - 28, fs + 8, CF.sans, 'bold');
        ctx.fillStyle = 'rgba(200,200,200,0.5)';
        this._fitText(m.desc, W / 2, H - 8, W - 32, fs, CF.sans);

        this._drawMembrane(t);
        if (this.mode === 1 || this.mode === 2) this._drawChannel(t);
        if (this.mode === 2) this._drawATP(t);
        if (this.mode === 3) this._drawVesicle(t);

        // molecules movement
        const mx = W * 0.5;
        const modeData = this.modes[this.mode];
        this.molecules.forEach(mol => {
            mol.phase += 0.02 * this.speed;
            mol.x += mol.vx * this.speed;
            mol.y += mol.vy * this.speed;
            // boundary bounce
            if (mol.x < 10) { mol.x = 10; mol.vx *= -1; }
            if (mol.y < 55) { mol.y = 55; mol.vy *= -1; }
            if (mol.y > H - 35) { mol.y = H - 35; mol.vy *= -1; }
            if (this.mode === 3) {
                if (mol.x > W - 10) { mol.x = W - 10; mol.vx *= -1; }
                return; // vesicle mode: no crossing
            }
            // membrane crossing logic
            if (!mol.crossed) {
                if (this.mode === 0) {
                    // free diffusion: cross anywhere
                    if (mol.x > mx - 5 && mol.x < mx + 5) {
                        if (Math.random() < 0.02 * this.speed) {
                            mol.crossed = true;
                            mol.x = mx + 15;
                        } else { mol.vx *= -1; }
                    }
                } else if (this.mode === 1) {
                    // facilitated: cross only through channel
                    if (mol.x > mx - 10 && mol.y > H * 0.35 && mol.y < H * 0.65) {
                        if (Math.random() < 0.03 * this.speed) {
                            mol.crossed = true;
                            mol.x = mx + 15;
                        }
                    } else if (mol.x > mx - 12) { mol.vx *= -1; }
                } else if (this.mode === 2) {
                    const inPump = mol.x > mx - 15 && mol.x < mx + 15 && mol.y > H * 0.35 && mol.y < H * 0.65;
                    if (inPump) {
                        if (Math.random() < 0.04 * this.speed) {
                            mol.crossed = true;
                            mol.x = mx - 20;
                            mol.vx = -Math.abs(mol.vx || 0.35);
                        } else {
                            mol.x = mx + 16;
                            mol.vx = Math.abs(mol.vx || 0.35);
                        }
                    } else if (mol.x < mx + 14) {
                        mol.x = mx + 14;
                        mol.vx = Math.abs(mol.vx || 0.35);
                    }
                }
                if (mol.x > W - 10) { mol.x = W - 10; mol.vx *= -1; }
            } else {
                if (this.mode === 2) {
                    if (mol.x > mx - 12) { mol.x = mx - 12; mol.vx = -Math.abs(mol.vx || 0.35); }
                } else {
                    if (mol.x > W - 10) { mol.x = W - 10; mol.vx *= -1; }
                    if (mol.x < mx + 12) { mol.x = mx + 12; mol.vx = Math.abs(mol.vx); }
                }
            }
            // draw molecule
            ctx.beginPath();
            ctx.arc(mol.x, mol.y, mol.r, 0, Math.PI * 2);
            ctx.fillStyle = modeData.color;
            ctx.fill();
        });
    },
    _injectInfoPanel() {
        const el = document.getElementById('strans-info');
        if (!el) return;
        el.innerHTML = `
            <div class="strans-info__hd">物质运输知识点</div>
            <div class="strans-info__grid">
                <div class="strans-info__block">
                    <div class="strans-info__sub">当前方式</div>
                    <div id="strans-mode-display" class="strans-info__val">自由扩散</div>
                    <div id="strans-mode-desc" class="strans-info__desc">O₂/CO₂ 等小分子顺浓度梯度通过磷脂双分子层；水跨膜主要体现为渗透</div>
                </div>
                <div class="strans-info__block">
                    <div class="strans-info__sub">四种运输方式</div>
                    <div class="strans-info__row"><span class="strans-info__key" style="--c:#64c896">自由扩散</span> 顺浓度，不耗能，不需载体（如O₂、CO₂；水主要通过渗透/水通道蛋白跨膜）</div>
                    <div class="strans-info__row"><span class="strans-info__key" style="--c:#6496ff">协助扩散</span> 顺浓度或电化学梯度，不直接耗能，需通道或载体蛋白（如葡萄糖转运、离子通道）</div>
                    <div class="strans-info__row"><span class="strans-info__key" style="--c:#ff9632">主动运输</span> 逆浓度/电化学梯度，需要能量和特异性转运蛋白（如Na⁺-K⁺泵）</div>
                    <div class="strans-info__row"><span class="strans-info__key" style="--c:#c864c8">胞吞/胞吐</span> 大分子、颗粒或大量物质通过膜形变与囊泡进出细胞</div>
                </div>
                <div class="strans-info__block">
                    <div class="strans-info__sub">知识要点</div>
                    <div class="strans-info__note">被动运输不消耗细胞能量，通常顺浓度梯度或水分子自身梯度进行；协助扩散依赖通道/载体蛋白但仍顺梯度。主动运输使用 ATP 或既有电化学梯度，把物质逆浓度/电化学梯度转运。胞吞/胞吐用于大分子、颗粒或大量物质，依赖膜形变和囊泡。</div>
                </div>
            </div>
            <div class="strans-info__source">参考 OpenStax Biology 2e 5.2 Passive Transport、5.3 Active Transport 与 5.4 Bulk Transport；页面用单一膜面演示方向关系，不代表所有转运蛋白的具体结构机制。</div>
        `;
    },

    _fitText(text, x, y, maxWidth, size, family, weight = '') {
        const ctx = this.ctx;
        let fs = size;
        do {
            ctx.font = (weight ? weight + ' ' : '') + fs + 'px ' + family;
            if (ctx.measureText(text).width <= maxWidth || fs <= 11) break;
            fs -= 1;
        } while (fs > 10);
        ctx.fillText(text, x, y);
    },

    _updateInfo() {
        const m = this.modes[this.mode];
        const nameEl = document.getElementById('strans-mode-display');
        const descEl = document.getElementById('strans-mode-desc');
        if (nameEl) nameEl.textContent = m.name;
        if (descEl) descEl.textContent = m.desc;
    },

    _loop() {
        const t = performance.now() / 1000;
        this._draw(t);
        this.animId = requestAnimationFrame(() => this._loop());
    }
};

function initSubstanceTransport() { SubstanceTransport.init(); }
window.SubstanceTransport = SubstanceTransport;
