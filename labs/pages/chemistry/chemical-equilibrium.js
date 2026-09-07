// ===== Chemical Equilibrium Visualization =====
// Shows how concentration, temperature, and pressure affect equilibrium (Le Chatelier's Principle)

const ChemEquilibrium = {
    canvas: null, ctx: null, W: 0, H: 0,
    // Reaction: N2 + 3H2 <=> 2NH3 (exothermic, Delta H < 0)
    concN2: 1.0, concH2: 3.0, concNH3: 0.0,
    temperature: 450,    // Celsius
    pressure: 1.0,       // atm (relative)
    Kc: 0.5,             // equilibrium constant at base T
    time: 0,
    history: [],         // concentration over time
    maxTime: 200,
    animating: false,
    animId: 0,
    equilibrium: false,
    perturbation: null,  // track last perturbation for visual indicator
    _listeners: [],
    _resizeObs: null,

    colors: {
        N2: '#5b8dce',
        H2: '#e06c75',
        NH3: '#98c379',
        bg: 'rgba(77,158,126,0.06)'
    },

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        this.canvas = document.getElementById('cheq-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        this.bindEvents();
        this.reset();
        this.draw();
    },

    destroy() {
        this.stopAnim();
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
        const h = Math.min(w * 0.6, 420);
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
            this._resizeObs = new ResizeObserver(() => { this.resize(); this.draw(); });
            this._resizeObs.observe(this.canvas.parentElement);
        } else {
            this._on(window, 'resize', () => { this.resize(); this.draw(); });
        }

        const startBtn = document.getElementById('cheq-start');
        if (startBtn) this._on(startBtn, 'click', () => this.toggleAnim());

        const resetBtn = document.getElementById('cheq-reset');
        if (resetBtn) this._on(resetBtn, 'click', () => { this.reset(); this.draw(); });

        // Perturbation buttons
        const addN2Btn = document.getElementById('cheq-add-n2');
        if (addN2Btn) this._on(addN2Btn, 'click', () => this.perturb('addN2'));

        const addH2Btn = document.getElementById('cheq-add-h2');
        if (addH2Btn) this._on(addH2Btn, 'click', () => this.perturb('addH2'));

        const rmNH3Btn = document.getElementById('cheq-rm-nh3');
        if (rmNH3Btn) this._on(rmNH3Btn, 'click', () => this.perturb('rmNH3'));

        const heatBtn = document.getElementById('cheq-heat');
        if (heatBtn) this._on(heatBtn, 'click', () => this.perturb('heat'));

        const coolBtn = document.getElementById('cheq-cool');
        if (coolBtn) this._on(coolBtn, 'click', () => this.perturb('cool'));

        const pressUpBtn = document.getElementById('cheq-press-up');
        if (pressUpBtn) this._on(pressUpBtn, 'click', () => this.perturb('pressUp'));

        const pressDownBtn = document.getElementById('cheq-press-down');
        if (pressDownBtn) this._on(pressDownBtn, 'click', () => this.perturb('pressDown'));
    },

    reset() {
        this.stopAnim();
        this.concN2 = 1.0;
        this.concH2 = 3.0;
        this.concNH3 = 0.0;
        this.temperature = 450;
        this.pressure = 1.0;
        this.time = 0;
        this.history = [];
        this.equilibrium = false;
        this.perturbation = null;
        this.updateInfo();
    },

    perturb(type) {
        this.perturbation = type;
        this.equilibrium = false;
        switch (type) {
            case 'addN2': this.concN2 += 0.5; break;
            case 'addH2': this.concH2 += 1.0; break;
            case 'rmNH3': this.concNH3 = Math.max(0, this.concNH3 - 0.3); break;
            case 'heat': this.temperature += 50; break;
            case 'cool': this.temperature = Math.max(200, this.temperature - 50); break;
            case 'pressUp': {
                // 加压 = 等温缩小体积 → 所有气体浓度瞬间按比例增大
                // 压力增到原来的 factor 倍，浓度也增到 factor 倍
                const oldP = this.pressure;
                this.pressure = Math.min(5, this.pressure + 0.5);
                const factor = this.pressure / oldP;
                this.concN2 *= factor;
                this.concH2 *= factor;
                this.concNH3 *= factor;
                break;
            }
            case 'pressDown': {
                // 减压 = 等温增大体积 → 所有气体浓度瞬间按比例减小
                const oldP = this.pressure;
                this.pressure = Math.max(0.2, this.pressure - 0.3);
                const factor = this.pressure / oldP;
                this.concN2 *= factor;
                this.concH2 *= factor;
                this.concNH3 *= factor;
                break;
            }
        }
        if (!this.animating) { this.startAnim(); }
        this.updateInfo();
    },

    getKc() {
        // Kc decreases with temperature (exothermic reaction)
        // ln(K2/K1) = -DH/R * (1/T2 - 1/T1)
        const T = this.temperature + 273.15;
        const T0 = 723.15; // 450C
        const DH = -92000; // J/mol (exothermic)
        const R = 8.314;
        return 0.5 * Math.exp(-DH / R * (1 / T - 1 / T0));
    },

    stepSimulation() {
        // Simplified kinetics toward equilibrium
        // N2 + 3H2 <=> 2NH3
        // Q = [NH3]^2 / ([N2] * [H2]^3)
        // 加压/减压已经直接改变了浓度，所以这里直接用实际浓度计算
        const Kc = this.getKc();

        const Q = (this.concNH3 * this.concNH3 + 0.001) / ((this.concN2 + 0.001) * Math.pow(this.concH2 + 0.001, 3));

        // Rate proportional to deviation from equilibrium
        const rate = 0.015 * (1 + Math.abs(Math.log(Kc / (Q + 0.0001))));
        let dx;
        if (Q < Kc) {
            // Forward reaction favored
            dx = rate * Math.min(0.05, Kc - Q);
        } else {
            // Reverse reaction favored
            dx = -rate * Math.min(0.05, Q - Kc);
        }

        // Stoichiometry: N2(-1) + H2(-3) -> NH3(+2)
        const maxForward = Math.min(this.concN2, this.concH2 / 3);
        const maxReverse = this.concNH3 / 2;

        if (dx > 0) dx = Math.min(dx, maxForward * 0.1);
        else dx = Math.max(dx, -maxReverse * 0.1);

        this.concN2 -= dx;
        this.concH2 -= dx * 3;
        this.concNH3 += dx * 2;

        // Clamp
        this.concN2 = Math.max(0, this.concN2);
        this.concH2 = Math.max(0, this.concH2);
        this.concNH3 = Math.max(0, this.concNH3);

        this.time++;
        this.history.push({
            t: this.time,
            N2: this.concN2,
            H2: this.concH2,
            NH3: this.concNH3
        });
        if (this.history.length > this.maxTime) this.history.shift();

        // Check equilibrium
        if (Math.abs(dx) < 0.0001) {
            this.equilibrium = true;
        }
    },

    toggleAnim() {
        if (this.animating) this.stopAnim();
        else this.startAnim();
    },

    startAnim() {
        this.animating = true;
        const btn = document.getElementById('cheq-start');
        if (btn) btn.textContent = '\u25a0 \u6682\u505c';
        const step = () => {
            if (!this.animating) return;
            this.stepSimulation();
            this.draw();
            this.updateInfo();
            this.animId = requestAnimationFrame(step);
        };
        this.animId = requestAnimationFrame(step);
    },

    stopAnim() {
        this.animating = false;
        cancelAnimationFrame(this.animId);
        const btn = document.getElementById('cheq-start');
        if (btn) btn.textContent = '\u25b6 \u5f00\u59cb';
    },

    updateInfo() {
        const eqEl = document.getElementById('cheq-status');
        if (eqEl) {
            eqEl.textContent = this.equilibrium ? '\u2705 \u5df2\u8fbe\u5e73\u8861' : '\u23f3 \u53cd\u5e94\u8fdb\u884c\u4e2d...';
            eqEl.style.color = this.equilibrium ? '#98c379' : '#e5c07b';
        }
        const concEl = document.getElementById('cheq-conc-display');
        if (concEl) {
            concEl.textContent = '[N\u2082]=' + this.concN2.toFixed(3) + '  [H\u2082]=' + this.concH2.toFixed(3) + '  [NH\u2083]=' + this.concNH3.toFixed(3);
        }
        const tempEl = document.getElementById('cheq-temp-display');
        if (tempEl) tempEl.textContent = 'T=' + this.temperature + '\u00b0C  P=' + this.pressure.toFixed(1) + 'atm  Kc=' + this.getKc().toFixed(4);

        /* education panel */
        const eduEl = document.getElementById('cheq-edu');
        if (eduEl) {
            const Kc = this.getKc().toFixed(4);
            const dir = this.equilibrium ? '平衡态' : (this.concNH3 < 0.5 ? '正向移动中' : '逆向移动中');
            eduEl.innerHTML = `<div class="chem-hd"><span class="chem-tag">${dir}</span>化学平衡知识点</div>
<div class="chem-row"><span class="chem-key">平衡状态</span>正反应速率 = 逆反应速率，各组分浓度不再改变（动态平衡）</div>
<div class="chem-row"><span class="chem-key chem-key--purple">平衡常数</span>K<sub>c</sub> = [NH₃]²/([N₂][H₂]³) = ${Kc} — 只随温度改变；浓度、压强、催化剂不改变 K</div>
<div class="chem-row"><span class="chem-key chem-key--amber">勒夏特列原理</span>改变条件 → 平衡向减弱该改变的方向移动（"削弱但不消除"）</div>
<div class="chem-row"><span class="chem-key">浓度影响</span>增大反应物浓度 → 正移；减小生成物浓度 → 正移；反之逆移</div>
<div class="chem-row"><span class="chem-key">温度与压强</span>升温 → 向吸热方向移动且 K 改变；增压 → 向气体体积减小方向移动（此反应正向），但 K 不变</div>
<div class="chem-note">💡 人教版选择性必修1：N₂ + 3H₂ ⇌ 2NH₃ 为放热反应(ΔH<0)，正向体积减小。催化剂只缩短达到平衡的时间，不改变平衡位置或 K。点击按钮扰动平衡观察响应</div>`;
        }
    },

    draw() {
        const { ctx, W, H } = this;
        if (!ctx || W === 0) return;
        ctx.clearRect(0, 0, W, H);

        const margin = 40;
        const graphW = W - margin * 2;
        const graphH = H - margin * 2 - 10;

        // Graph area
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        ctx.strokeRect(margin, margin, graphW, graphH);

        // Y axis label
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '16px ' + CF.sans;
        ctx.translate(12, margin + graphH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillText('\u6d53\u5ea6 (mol/L)', 0, 0);
        ctx.restore();

        // X axis label
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '16px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('\u65f6\u95f4', margin + graphW / 2, H - 5);

        if (this.history.length < 2) {
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.font = '18px ' + CF.sans;
            ctx.fillText('\u70b9\u51fb\u201c\u5f00\u59cb\u201d\u89c2\u5bdf\u53cd\u5e94\u8fbe\u5230\u5e73\u8861\u7684\u8fc7\u7a0b', W / 2, H / 2);
            this.drawReactionLabel(W / 2, margin - 8);
            return;
        }

        // Find max concentration for y scale
        let maxConc = 0.5;
        for (const h of this.history) {
            maxConc = Math.max(maxConc, h.N2, h.H2, h.NH3);
        }
        maxConc *= 1.1;

        // Y grid lines
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 0.5;
        for (let i = 1; i <= 4; i++) {
            const yy = margin + graphH - (i / 4) * graphH;
            ctx.beginPath();
            ctx.moveTo(margin, yy);
            ctx.lineTo(margin + graphW, yy);
            ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.font = '14px ' + CF.mono;
            ctx.textAlign = 'right';
            ctx.fillText((maxConc * i / 4).toFixed(2), margin - 3, yy + 3);
        }

        // Draw curves
        const drawLine = (key, color) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (let i = 0; i < this.history.length; i++) {
                const px = margin + (i / (this.maxTime - 1)) * graphW;
                const py = margin + graphH - (this.history[i][key] / maxConc) * graphH;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
        };

        drawLine('N2', this.colors.N2);
        drawLine('H2', this.colors.H2);
        drawLine('NH3', this.colors.NH3);

        // Current value dots
        const last = this.history[this.history.length - 1];
        const lastX = margin + ((this.history.length - 1) / (this.maxTime - 1)) * graphW;
        for (const [key, color] of [['N2', this.colors.N2], ['H2', this.colors.H2], ['NH3', this.colors.NH3]]) {
            const ly = margin + graphH - (last[key] / maxConc) * graphH;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(lastX, ly, 4, 0, Math.PI * 2);
            ctx.fill();
        }

        // Legend
        this.drawLegend(margin + 10, margin + 12);
        this.drawReactionLabel(W / 2, margin - 8);

        // Equilibrium marker
        if (this.equilibrium) {
            ctx.fillStyle = 'rgba(152,195,121,0.15)';
            ctx.fillRect(lastX - 2, margin, 4, graphH);
        }
    },

    drawLegend(x, y) {
        const ctx = this.ctx;
        const items = [
            { label: 'N\u2082', color: this.colors.N2 },
            { label: 'H\u2082', color: this.colors.H2 },
            { label: 'NH\u2083', color: this.colors.NH3 }
        ];
        ctx.font = '16px ' + CF.sans;
        let cx = x;
        for (const item of items) {
            ctx.fillStyle = item.color;
            ctx.fillRect(cx, y - 6, 14, 3);
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.textAlign = 'left';
            ctx.fillText(item.label, cx + 18, y);
            cx += 60;
        }
    },

    drawReactionLabel(cx, y) {
        const ctx = this.ctx;
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '17px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('N\u2082 + 3H\u2082 \u21cc 2NH\u2083  (\u0394H < 0, \u653e\u70ed)', cx, y);
    }
};

function initChemEquilibrium() {
    ChemEquilibrium.init();
}

window.ChemEquilibrium = ChemEquilibrium;
window.initChemEquilibrium = initChemEquilibrium;
