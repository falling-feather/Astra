// ===== Chemical Reaction Rate v2 =====
// Collision theory + Maxwell-Boltzmann distribution + activation energy diagram

const ReactionRate = {
    canvas: null, ctx: null, W: 0, H: 0,
    _listeners: [], _resizeObs: null, _raf: null,
    running: true, paused: false, speed: 1,
    time: 0, _lastT: 0,

    temperature: 300, concentration: 50, catalyst: false,
    particles: [], collisions: 0, reacted: 0,
    history: [], flashes: [],
    hoverX: -1, hoverY: -1,

    _on(el, evt, fn, opts) { el.addEventListener(evt, fn, opts); this._listeners.push({ el, evt, fn, opts }); },
    _simWidth(width = this.W || 500) { return width < 520 ? width : width * 0.52; },

    /* ─── lifecycle ─── */
    init() {
        this.canvas = document.getElementById('rxnrate-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.time = 0; this._lastT = 0;
        this.running = true; this.paused = false; this.speed = 1;
        this.collisions = 0; this.reacted = 0;
        this.history = []; this.flashes = [];
        this.resize();
        this.spawnParticles();
        this.bindEvents();
        this.updateInfo();
        this.canvas.setAttribute('role', 'img');
        this.canvas.setAttribute('aria-label', '化学反应速率模拟：粒子碰撞、能量分布、活化能和催化剂影响');
        this._lastT = performance.now();
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
        const w = wrap.getBoundingClientRect().width;
        const h = w < 520 ? Math.min(Math.max(w * 0.62, 220), 260) : Math.min(Math.max(w * 0.5, 280), 400);
        this.canvas.width = w * dpr; this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w; this.H = h;
    },

    /* ─── particles ─── */
    spawnParticles() {
        this.particles = [];
        this.collisions = 0; this.reacted = 0;
        this.history = []; this.flashes = [];
        const n = Math.round(this.concentration / 100 * 40) + 10;
        const sp = this.temperature / 300;
        const simW = this._simWidth(this.W || 500);
        for (let i = 0; i < n; i++) {
            const type = i < n / 2 ? 'A' : 'B';
            this.particles.push({
                x: 8 + Math.random() * (simW - 16),
                y: 8 + Math.random() * ((this.H || 300) - 16),
                vx: (Math.random() - 0.5) * 2.2 * sp,
                vy: (Math.random() - 0.5) * 2.2 * sp,
                type, reacted: false,
                r: type === 'A' ? 6 : 5
            });
        }
        this.updateInfo();
    },

    /* ─── events ─── */
    bindEvents() {
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver(() => this.resize());
            this._resizeObs.observe(this.canvas.parentElement);
        }
        const bind = (id, prop, cb) => {
            const el = document.getElementById(id);
            if (!el) return;
            this._on(el, 'input', () => {
                this[prop] = parseFloat(el.value);
                const d = document.getElementById(id + '-val');
                if (d) d.textContent = el.value;
                if (cb) cb();
            });
        };
        bind('rxnrate-temp', 'temperature', () => { this.spawnParticles(); });
        bind('rxnrate-conc', 'concentration', () => { this.spawnParticles(); });
        const cat = document.getElementById('rxnrate-catalyst');
        if (cat) this._on(cat, 'change', () => { this.catalyst = cat.checked; this.updateInfo(); });
        const rst = document.getElementById('rxnrate-reset');
        if (rst) this._on(rst, 'click', () => this.spawnParticles());
        // speed / pause
        const spd = document.getElementById('rxr-speed');
        if (spd) this._on(spd, 'input', () => { this.speed = parseFloat(spd.value); });
        const pb = document.getElementById('rxr-pause');
        if (pb) this._on(pb, 'click', () => {
            this.paused = !this.paused;
            pb.textContent = this.paused ? '▶' : '⏸';
            pb.setAttribute('aria-label', this.paused ? '继续' : '暂停');
        });
        // hover
        this._on(this.canvas, 'mousemove', e => { const r = this.canvas.getBoundingClientRect(); this.hoverX = e.clientX - r.left; this.hoverY = e.clientY - r.top; });
        this._on(this.canvas, 'mouseleave', () => { this.hoverX = -1; this.hoverY = -1; });
    },

    /* ─── loop ─── */
    loop() {
        if (!this.running) return;
        const now = performance.now();
        if (!this.paused) {
            const dt = Math.min((now - this._lastT) / 1000, 0.05);
            this.time += dt * this.speed;
            this.update(dt * this.speed);
        }
        this._lastT = now;
        this.draw();
        this._raf = requestAnimationFrame(() => this.loop());
    },

    update(dt) {
        const { particles, W, H } = this;
        const sp = this.temperature / 300;
        const Ea = this.catalyst ? 0.3 : 0.7;
        const simW = this._simWidth(W);
        const scale = dt * 60; // normalise to ~60fps

        for (const p of particles) {
            if (p.reacted) continue;
            p.x += p.vx * sp * scale;
            p.y += p.vy * sp * scale;
            if (p.x < p.r) { p.x = p.r; p.vx *= -1; }
            if (p.x > simW - p.r) { p.x = simW - p.r; p.vx *= -1; }
            if (p.y < p.r) { p.y = p.r; p.vy *= -1; }
            if (p.y > H - p.r) { p.y = H - p.r; p.vy *= -1; }
        }
        // collisions
        for (let i = 0; i < particles.length; i++) {
            const a = particles[i]; if (a.reacted) continue;
            for (let j = i + 1; j < particles.length; j++) {
                const b = particles[j];
                if (b.reacted || a.type === b.type) continue;
                const dist = Math.hypot(a.x - b.x, a.y - b.y);
                if (dist < a.r + b.r + 2) {
                    this.collisions++;
                    const energy = Math.hypot(a.vx - b.vx, a.vy - b.vy);
                    if (energy > Ea) {
                        a.reacted = true; b.reacted = true;
                        this.reacted += 2;
                        this.flashes.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, t: 1 });
                    }
                }
            }
        }
        // decay flashes
        for (let i = this.flashes.length - 1; i >= 0; i--) {
            this.flashes[i].t -= dt * 3;
            if (this.flashes[i].t <= 0) this.flashes.splice(i, 1);
        }
        // history every ~0.5s
        if (Math.floor(this.time * 2) > this.history.length) {
            this.history.push(this.reacted);
            this.updateInfo();
        }
    },

    /* ─── draw ─── */
    draw() {
        const { ctx, W, H } = this;
        if (!ctx || W === 0) return;
        ctx.clearRect(0, 0, W, H);
        const compact = W < 520;
        const simW = this._simWidth(W);

        // simulation area
        ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
        ctx.strokeRect(4, 4, simW - 8, H - 8);

        // particles
        for (const p of this.particles) {
            if (p.reacted) { ctx.fillStyle = 'rgba(100,100,100,0.15)'; }
            else {
                const g = ctx.createRadialGradient(p.x - 1, p.y - 1, 0, p.x, p.y, p.r);
                if (p.type === 'A') { g.addColorStop(0, 'rgba(255,160,160,0.9)'); g.addColorStop(1, 'rgba(224,108,117,0.5)'); }
                else { g.addColorStop(0, 'rgba(160,190,255,0.9)'); g.addColorStop(1, 'rgba(91,141,206,0.5)'); }
                ctx.fillStyle = g;
            }
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        }
        // collision flashes
        for (const f of this.flashes) {
            ctx.fillStyle = `rgba(229,192,123,${(f.t * 0.6).toFixed(2)})`;
            ctx.beginPath(); ctx.arc(f.x, f.y, 8 + (1 - f.t) * 6, 0, Math.PI * 2); ctx.fill();
        }
        // legend
        const legendY = compact ? H - 18 : H - 6;
        ctx.font = (compact ? '12px ' : '14px ') + CF.sans; ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(224,108,117,0.7)'; ctx.fillText('● A (反应物)', 8, legendY);
        ctx.fillStyle = 'rgba(91,141,206,0.7)'; ctx.fillText('● B (反应物)', compact ? 88 : 80, legendY);
        ctx.fillStyle = 'rgba(100,100,100,0.4)'; ctx.fillText('● 产物', compact ? 170 : 152, legendY);

        // right side: top = Maxwell-Boltzmann, bottom = reaction progress
        if (!compact) {
            const rx = simW + 12, rw = W - simW - 20;
            this.drawMB(rx, 8, rw, H * 0.48 - 12);
            this.drawProgress(rx, H * 0.48 + 4, rw, H * 0.52 - 12);
        } else {
            ctx.font = '13px ' + CF.mono;
            ctx.textAlign = 'right';
            ctx.fillStyle = 'rgba(255,255,255,0.34)';
            ctx.fillText(`T=${this.temperature}K  Ea=${this.catalyst ? '低' : '高'}`, W - 10, 18);
            ctx.fillText(`碰撞 ${this.collisions}  转化 ${this.reacted}/${this.particles.length}`, W - 10, 36);
        }

        // hover
        this.drawHover(simW);
    },

    /* Maxwell-Boltzmann distribution */
    drawMB(x, y, w, h) {
        const { ctx, temperature, catalyst } = this;
        ctx.save();
        // title
        ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '14px ' + CF.sans; ctx.textAlign = 'center';
        ctx.fillText('Maxwell-Boltzmann 分布', x + w / 2, y + 10);
        // axes
        const ax = x + 4, ay = y + 16, aw = w - 8, ah = h - 22;
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax, ay + ah); ctx.lineTo(ax + aw, ay + ah); ctx.stroke();
        ctx.font = '13px ' + CF.mono; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.fillText('动能 E', ax + aw / 2, ay + ah + 10);
        ctx.save(); ctx.translate(ax - 3, ay + ah / 2); ctx.rotate(-Math.PI / 2);
        ctx.fillText('f(E)', 0, 0); ctx.restore();

        // draw curve
        const mb = (E, T) => Math.sqrt(E) * Math.exp(-E * 3000 / T);
        const Ea = catalyst ? 0.3 : 0.7;
        const n = 80;
        // find max for normalisation
        let maxF = 0;
        for (let i = 1; i <= n; i++) { const E = i / n * 1.5; maxF = Math.max(maxF, mb(E, temperature)); }
        // filled area beyond Ea
        ctx.fillStyle = 'rgba(77,158,126,0.12)';
        ctx.beginPath();
        let started = false;
        for (let i = 0; i <= n; i++) {
            const E = i / n * 1.5;
            if (E < Ea) continue;
            const px = ax + (E / 1.5) * aw;
            const py = ay + ah - (mb(E, temperature) / maxF) * ah * 0.9;
            if (!started) { ctx.moveTo(px, ay + ah); ctx.lineTo(px, py); started = true; }
            else ctx.lineTo(px, py);
        }
        if (started) { ctx.lineTo(ax + aw, ay + ah); ctx.closePath(); ctx.fill(); }

        // main curve
        ctx.strokeStyle = 'rgba(91,141,206,0.6)'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 1; i <= n; i++) {
            const E = i / n * 1.5;
            const px = ax + (E / 1.5) * aw;
            const py = ay + ah - (mb(E, temperature) / maxF) * ah * 0.9;
            i === 1 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.stroke();

        // comparison curve at different T (lighter)
        const T2 = temperature > 400 ? 200 : 600;
        let maxF2 = 0;
        for (let i = 1; i <= n; i++) { const E = i / n * 1.5; maxF2 = Math.max(maxF2, mb(E, T2)); }
        ctx.strokeStyle = 'rgba(224,108,117,0.3)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath();
        for (let i = 1; i <= n; i++) {
            const E = i / n * 1.5;
            const px = ax + (E / 1.5) * aw;
            const py = ay + ah - (mb(E, T2) / maxF2) * ah * 0.9;
            i === 1 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.stroke(); ctx.setLineDash([]);

        // Ea line
        const eaX = ax + (Ea / 1.5) * aw;
        ctx.strokeStyle = 'rgba(229,192,123,0.5)'; ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath(); ctx.moveTo(eaX, ay); ctx.lineTo(eaX, ay + ah); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(229,192,123,0.6)'; ctx.font = '13px ' + CF.mono; ctx.textAlign = 'center';
        ctx.fillText(catalyst ? 'Ea(催化)' : 'Ea', eaX, ay - 2);

        // legend
        ctx.font = '12px ' + CF.sans; ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(91,141,206,0.6)'; ctx.fillText(temperature + 'K', ax + aw, ay + 8);
        ctx.fillStyle = 'rgba(224,108,117,0.3)'; ctx.fillText(T2 + 'K (参考)', ax + aw, ay + 17);
        ctx.restore();
    },

    /* reaction progress chart */
    drawProgress(x, y, w, h) {
        const { ctx, history } = this;
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = '14px ' + CF.sans; ctx.textAlign = 'center';
        ctx.fillText('反应进度 · 统计', x + w / 2, y + 10);
        const ax = x + 4, ay = y + 16, aw = w - 8, ah = h - 24;
        ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 0.6; ctx.strokeRect(ax, ay, aw, ah);

        if (history.length >= 2) {
            const maxV = Math.max(...history, 1);
            // area fill
            ctx.fillStyle = 'rgba(77,158,126,0.08)';
            ctx.beginPath(); ctx.moveTo(ax, ay + ah);
            history.forEach((v, i) => {
                const px = ax + (i / (history.length - 1)) * aw;
                const py = ay + ah - (v / maxV) * ah;
                ctx.lineTo(px, py);
            });
            ctx.lineTo(ax + aw, ay + ah); ctx.closePath(); ctx.fill();
            // line
            ctx.strokeStyle = 'rgba(77,158,126,0.55)'; ctx.lineWidth = 1.5;
            ctx.beginPath();
            history.forEach((v, i) => {
                const px = ax + (i / (history.length - 1)) * aw;
                const py = ay + ah - (v / maxV) * ah;
                i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
            });
            ctx.stroke();
        }

        // stats text
        const total = this.particles.length;
        const active = total - this.reacted;
        const lines = [`粒子: ${total}  未反应: ${active}  已反应: ${this.reacted}`, `碰撞: ${this.collisions}  Ea: ${this.catalyst ? '低(催化)' : '高'}`];
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = '13px ' + CF.mono; ctx.textAlign = 'left';
        lines.forEach((l, i) => ctx.fillText(l, ax + 2, ay + ah + 10 + i * 11));
    },

    /* hover tooltip */
    drawHover(simW) {
        if (this.hoverX < 0 || this.hoverX > simW) return;
        const { ctx } = this;
        let best = null, bestD = 14;
        for (const p of this.particles) {
            if (p.reacted) continue;
            const d = Math.hypot(this.hoverX - p.x, this.hoverY - p.y);
            if (d < bestD) { bestD = d; best = p; }
        }
        if (!best) return;
        ctx.strokeStyle = 'rgba(229,192,123,0.6)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(best.x, best.y, best.r + 3, 0, Math.PI * 2); ctx.stroke();
        const v = Math.hypot(best.vx, best.vy);
        const KE = (0.5 * v * v).toFixed(2);
        const label = `${best.type}  v=${v.toFixed(2)}  KE=${KE}`;
        const tw = ctx.measureText(label).width + 14;
        const tx = Math.min(best.x + 10, simW - tw - 4), ty = Math.max(best.y - 28, 4);
        ctx.fillStyle = 'rgba(20,22,30,0.88)'; ctx.beginPath(); ctx.roundRect(tx, ty, tw, 20, 4); ctx.fill();
        ctx.fillStyle = 'rgba(229,192,123,0.9)'; ctx.font = '14px ' + CF.mono; ctx.textAlign = 'left';
        ctx.fillText(label, tx + 7, ty + 14);
    },

    /* ─── education panel ─── */
    updateInfo() {
        const el = document.getElementById('rxr-info');
        if (!el) return;
        const T = this.temperature;
        const total = this.particles.length;
        const pct = total > 0 ? (this.reacted / total * 100).toFixed(1) : '0.0';
        const Ea = this.catalyst ? '低（催化剂降低活化能）' : '高（无催化剂）';
        el.innerHTML = `<div class="rxr-hd"><span class="rxr-tag">碰撞理论</span>化学反应速率</div>
<div class="rxr-grid">
    <div class="rxr-card">
        <span class="rxr-card__label">速率含义</span>
        <strong>浓度随时间变化</strong>
        <p>反应速率通常用反应物消耗或生成物形成的浓度变化除以时间间隔表示。</p>
    </div>
    <div class="rxr-card">
        <span class="rxr-card__label">有效碰撞</span>
        <strong>足够能量 + 合适取向</strong>
        <p>粒子碰撞只有在能量达到活化能并且取向合适时，才更可能形成产物。</p>
    </div>
</div>
<div class="rxr-row"><span class="rxr-key">Arrhenius</span>k = A·e<sup>-Ea/(RT)</sup> &nbsp; 温度↑ → k↑ → 速率↑</div>
<div class="rxr-row"><span class="rxr-key rxr-key--purple">浓度影响</span>浓度↑ → 单位体积粒子数↑ → 碰撞频率↑</div>
<div class="rxr-row"><span class="rxr-key rxr-key--amber">活化能 Ea</span>${Ea}</div>
<div class="rxr-row"><span class="rxr-key">当前</span>T=${T}K  转化率=${pct}%  碰撞=${this.collisions}次</div>
<div class="rxr-note"><strong>模型边界：</strong>画布使用二维粒子和简化能量阈值表达趋势；真实反应速率还受反应机理、取向因子、溶剂、表面积、光照和实验测定速率级数等条件影响。催化剂提供较低活化能路径，不改变反应物和产物的热力学平衡关系。</div>
<div class="rxr-source">资料依据：OpenStax Chemistry 2e 12.1 Chemical Reaction Rates、12.2 Factors Affecting Reaction Rates、12.5 Collision Theory。</div>`;
    }
};

function initReactionRate() { ReactionRate.init(); }
window.ReactionRate = ReactionRate;
window.initReactionRate = initReactionRate;
