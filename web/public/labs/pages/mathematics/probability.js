// ===== Probability & Statistics Visualization =====
// Coin flip / Dice roll frequency-to-probability convergence + histogram

const Probability = {
    canvas: null, ctx: null, W: 0, H: 0,
    mode: 'coin',       // 'coin' or 'dice'
    trials: [],          // results array
    totalTrials: 0,
    animating: false,
    animId: 0,
    speed: 10,           // trials per frame
    _listeners: [],
    _resizeObs: null,

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        this.canvas = document.getElementById('prob-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        this.bindEvents();
        this.reset();
        this.draw();
        this.updateInfo();
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
        const h = Math.min(w * 0.65, 480);
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

        // Mode buttons
        document.querySelectorAll('.prob-mode-btn').forEach(btn => {
            this._on(btn, 'click', () => {
                document.querySelectorAll('.prob-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.mode = btn.dataset.mode;
                this.reset();
                this.draw();
                this.updateInfo();
            });
        });

        const playBtn = document.getElementById('prob-play-btn');
        if (playBtn) this._on(playBtn, 'click', () => this.toggleAnim());

        const resetBtn = document.getElementById('prob-reset-btn');
        if (resetBtn) this._on(resetBtn, 'click', () => { this.reset(); this.draw(); });

        const addBtn = document.getElementById('prob-add-btn');
        if (addBtn) this._on(addBtn, 'click', () => { this.addTrials(100); this.draw(); });

        const add1kBtn = document.getElementById('prob-add1k-btn');
        if (add1kBtn) this._on(add1kBtn, 'click', () => { this.addTrials(1000); this.draw(); });

        const speedSlider = document.getElementById('prob-speed');
        if (speedSlider) this._on(speedSlider, 'input', () => {
            this.speed = parseInt(speedSlider.value);
        });
    },

    reset() {
        this.stopAnim();
        this.totalTrials = 0;
        if (this.mode === 'coin') {
            this.trials = [0, 0]; // [heads, tails]
        } else {
            this.trials = [0, 0, 0, 0, 0, 0]; // faces 1-6
        }
        this.convergenceHistory = []; // track ratio over time
        this.updateInfo();
    },

    addTrials(n) {
        const faces = this.mode === 'coin' ? 2 : 6;
        for (let i = 0; i < n; i++) {
            const r = Math.floor(Math.random() * faces);
            this.trials[r]++;
            this.totalTrials++;
        }
        // Record convergence point
        if (this.mode === 'coin') {
            this.convergenceHistory.push({
                n: this.totalTrials,
                ratio: this.trials[0] / this.totalTrials
            });
        } else {
            this.convergenceHistory.push({
                n: this.totalTrials,
                maxDev: Math.max(...this.trials.map(c => Math.abs(c / this.totalTrials - 1/6)))
            });
        }
        this.updateInfo();
    },

    toggleAnim() {
        if (this.animating) this.stopAnim();
        else this.startAnim();
    },

    startAnim() {
        this.animating = true;
        const btn = document.getElementById('prob-play-btn');
        if (btn) btn.textContent = '\u25a0 \u6682\u505c';
        const step = () => {
            if (!this.animating) return;
            this.addTrials(this.speed);
            this.draw();
            this.animId = requestAnimationFrame(step);
        };
        this.animId = requestAnimationFrame(step);
    },

    stopAnim() {
        this.animating = false;
        cancelAnimationFrame(this.animId);
        const btn = document.getElementById('prob-play-btn');
        if (btn) btn.textContent = '\u25b6 \u8fde\u7eed\u5b9e\u9a8c';
    },

    updateInfo() {
        const el = document.getElementById('prob-info-text');
        if (!el) return;
        const n = this.totalTrials;
        if (n === 0) { el.textContent = '\u70b9\u51fb\u201c\u5f00\u59cb\u5b9e\u9a8c\u201d\u6216\u201c\u8fde\u7eed\u5b9e\u9a8c\u201d'; return; }
        if (this.mode === 'coin') {
            const hR = (this.trials[0] / n * 100).toFixed(2);
            const tR = (this.trials[1] / n * 100).toFixed(2);
            el.textContent = '\u5b9e\u9a8c ' + n + ' \u6b21 | \u6b63\u9762: ' + this.trials[0] + ' (' + hR + '%) | \u53cd\u9762: ' + this.trials[1] + ' (' + tR + '%)';
        } else {
            const parts = this.trials.map((c, i) => (i + 1) + ':\u00a0' + c);
            el.textContent = '\u5b9e\u9a8c ' + n + ' \u6b21 | ' + parts.join('  ');
        }
    },

    draw() {
        const { ctx, W, H } = this;
        if (!ctx || W === 0) return;
        ctx.clearRect(0, 0, W, H);

        // Layout: left = histogram, right = convergence curve
        const midX = W * 0.5;
        const margin = 30;
        const barAreaW = midX - margin * 2;
        const barAreaH = H - margin * 2 - 20;

        this.drawHistogram(margin, margin + 10, barAreaW, barAreaH);
        this.drawConvergence(midX + margin / 2, margin + 10, midX - margin * 1.5, barAreaH);
    },

    drawHistogram(x, y, w, h) {
        const ctx = this.ctx;
        const n = this.totalTrials;
        const faces = this.mode === 'coin' ? 2 : 6;
        const labels = this.mode === 'coin'
            ? ['\u6b63\u9762', '\u53cd\u9762']
            : ['1', '2', '3', '4', '5', '6'];
        const colors = this.mode === 'coin'
            ? ['#5b8dce', '#c678dd']
            : ['#e06c75', '#e5c07b', '#98c379', '#56b6c2', '#5b8dce', '#c678dd'];

        const barW = Math.min(w / faces * 0.7, 60);
        const gap = (w - barW * faces) / (faces + 1);

        // Title
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '18px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('\u9891\u7387\u76f4\u65b9\u56fe', x + w / 2, y - 2);

        // Theoretical line
        const expected = 1 / faces;
        const maxRatio = n === 0 ? 1 : Math.max(expected * 1.5, ...this.trials.map(c => c / n));

        for (let i = 0; i < faces; i++) {
            const ratio = n === 0 ? 0 : this.trials[i] / n;
            const barH = (ratio / maxRatio) * h * 0.85;
            const bx = x + gap + i * (barW + gap);
            const by = y + h - barH;

            ctx.fillStyle = colors[i];
            ctx.globalAlpha = 0.7;
            ctx.fillRect(bx, by, barW, barH);
            ctx.globalAlpha = 1;

            // Ratio label
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            ctx.font = '16px ' + CF.mono;
            ctx.textAlign = 'center';
            if (n > 0) ctx.fillText((ratio * 100).toFixed(1) + '%', bx + barW / 2, by - 4);

            // Face label
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            ctx.font = '17px ' + CF.sans;
            ctx.fillText(labels[i], bx + barW / 2, y + h + 14);
        }

        // Expected value line
        if (n > 0) {
            const ey = y + h - (expected / maxRatio) * h * 0.85;
            ctx.strokeStyle = 'rgba(86,182,194,0.6)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(x, ey);
            ctx.lineTo(x + w, ey);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#56b6c2';
            ctx.font = '16px ' + CF.sans;
            ctx.textAlign = 'left';
            ctx.fillText('\u7406\u8bba: ' + (expected * 100).toFixed(1) + '%', x + 2, ey - 4);
        }
    },

    drawConvergence(x, y, w, h) {
        const ctx = this.ctx;
        const hist = this.convergenceHistory;
        if (!hist || hist.length === 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.font = '18px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.fillText('\u6536\u655b\u66f2\u7ebf', x + w / 2, y - 2);
            ctx.fillText('\u5f00\u59cb\u5b9e\u9a8c\u540e\u663e\u793a', x + w / 2, y + h / 2);
            return;
        }

        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '18px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('\u6536\u655b\u66f2\u7ebf', x + w / 2, y - 2);

        // Axes
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + h);
        ctx.lineTo(x + w, y + h);
        ctx.stroke();

        if (this.mode === 'coin') {
            // Plot ratio of heads vs trials
            const expected = 0.5;
            const yMid = y + h / 2;

            // Expected line
            ctx.strokeStyle = 'rgba(86,182,194,0.4)';
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(x, yMid);
            ctx.lineTo(x + w, yMid);
            ctx.stroke();
            ctx.setLineDash([]);

            // Y axis labels
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.font = '17px ' + CF.mono;
            ctx.textAlign = 'right';
            ctx.fillText('100%', x - 3, y + 4);
            ctx.fillText('50%', x - 3, yMid + 3);
            ctx.fillText('0%', x - 3, y + h + 3);

            // Convergence line
            ctx.strokeStyle = '#5b8dce';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            const maxN = hist[hist.length - 1].n;
            for (let i = 0; i < hist.length; i++) {
                const px = x + (hist[i].n / maxN) * w;
                const py = y + (1 - hist[i].ratio) * h;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();

            // Convergence band (0.5 ± 1/sqrt(n))
            if (hist.length > 1) {
                ctx.fillStyle = 'rgba(86,182,194,0.08)';
                ctx.beginPath();
                for (let i = 0; i < hist.length; i++) {
                    const px = x + (hist[i].n / maxN) * w;
                    const band = 1 / Math.sqrt(hist[i].n + 1);
                    const py = y + (1 - (0.5 + band)) * h;
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                for (let i = hist.length - 1; i >= 0; i--) {
                    const px = x + (hist[i].n / maxN) * w;
                    const band = 1 / Math.sqrt(hist[i].n + 1);
                    const py = y + (1 - (0.5 - band)) * h;
                    ctx.lineTo(px, py);
                }
                ctx.closePath();
                ctx.fill();
            }

            // X axis label
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.font = '17px ' + CF.sans;
            ctx.textAlign = 'right';
            ctx.fillText('n=' + maxN, x + w, y + h + 14);
        } else {
            // Dice: plot max deviation from 1/6
            const maxDev = Math.max(0.2, ...hist.map(h => h.maxDev));
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.font = '17px ' + CF.mono;
            ctx.textAlign = 'right';
            ctx.fillText((maxDev * 100).toFixed(0) + '%', x - 3, y + 4);
            ctx.fillText('0%', x - 3, y + h + 3);

            // Zero line (perfect convergence)
            ctx.strokeStyle = 'rgba(86,182,194,0.4)';
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(x, y + h);
            ctx.lineTo(x + w, y + h);
            ctx.stroke();
            ctx.setLineDash([]);

            // Deviation curve
            ctx.strokeStyle = '#e5c07b';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            const maxN = hist[hist.length - 1].n;
            for (let i = 0; i < hist.length; i++) {
                const px = x + (hist[i].n / maxN) * w;
                const py = y + h - (hist[i].maxDev / maxDev) * h;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();

            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.font = '17px ' + CF.sans;
            ctx.textAlign = 'right';
            ctx.fillText('n=' + maxN, x + w, y + h + 14);

            ctx.textAlign = 'center';
            ctx.fillText('\u6700\u5927\u504f\u5dee', x + w / 2, y + h + 14);
        }
    },

    /* \u2500\u2500 education panel \u2500\u2500 */
    updateInfo() {
        const el = document.getElementById('prob-edu-info');
        if (!el) return;
        const modeLabel = this.mode === 'coin' ? '\u629b\u786c\u5e01' : '\u63b7\u9ab0\u5b50';
        const p = this.mode === 'coin' ? '1/2' : '1/6';
        let h = `<div class="math-hd"><span class="math-tag">${modeLabel}</span>\u6982\u7387\u7edf\u8ba1\u77e5\u8bc6\u70b9</div>
<div class="math-row"><span class="math-key">\u53e4\u5178\u6982\u578b</span>\u6709\u9650\u7b49\u53ef\u80fd\u4e8b\u4ef6\uff0cP(A) = m/n\u3002${this.mode === 'coin' ? '\u786c\u5e01\u6b63\u53cd\u5404 1/2' : '\u9ab0\u5b50\u6bcf\u9762 1/6'}</div>
<div class="math-row"><span class="math-key math-key--red">\u5927\u6570\u5b9a\u5f8b</span>\u5f53\u8bd5\u9a8c\u6b21\u6570 n \u2192 \u221e \u65f6\uff0c\u9891\u7387 \u2192 \u7406\u8bba\u6982\u7387 ${p}\u3002\u89c2\u5bdf\u67f1\u72b6\u56fe\u6536\u655b\u8fc7\u7a0b</div>
<div class="math-row"><span class="math-key math-key--amber">\u9891\u7387 vs \u6982\u7387</span>\u9891\u7387\u662f\u5b9e\u9a8c\u7ed3\u679c\uff0c\u6982\u7387\u662f\u7406\u8bba\u503c\uff1b\u524d\u8005\u968f\u6837\u672c\u589e\u5927\u8d8b\u8fd1\u540e\u8005</div>
<div class="math-row"><span class="math-key">\u51e0\u4f55\u6982\u578b</span>\u8bd5\u9a8c\u7ed3\u679c\u843d\u5728\u67d0\u533a\u57df\u5185\u7684\u6982\u7387 = \u8be5\u533a\u57df\u9762\u79ef / \u603b\u9762\u79ef\uff08\u7b49\u53ef\u80fd\u6027\uff09</div>
<div class="math-note">\ud83d\udca1 \u4eba\u6559\u7248\u5fc5\u4fee1\uff1a\u70b9\u51fb\u201c\u8fde\u7eed\u5b9e\u9a8c\u201d\u89c2\u5bdf\u9891\u7387\u5982\u4f55\u968f\u8bd5\u9a8c\u6b21\u6570\u589e\u52a0\u800c\u6536\u655b\u5230\u7406\u8bba\u6982\u7387</div>`;
        el.innerHTML = h;
    }
};

function initProbability() {
    Probability.init();
}

window.Probability = Probability;
window.initProbability = initProbability;