// ===== String Matching Visualization =====
// KMP algorithm step-by-step animation

const StringMatch = {
    canvas: null, ctx: null, W: 0, H: 0,
    _listeners: [],
    _resizeObs: null,
    _raf: null,
    running: true,

    text: 'ABABDABACDABABCABAB',
    pattern: 'ABABCABAB',
    algo: 'kmp', // 'brute' or 'kmp'
    steps: [],
    currentStep: 0,
    playing: false,
    speed: 1,
    lps: [], // KMP failure function

    _on(el, evt, fn, opts) {
        el.addEventListener(evt, fn, opts);
        this._listeners.push({ el, evt, fn, opts });
    },

    init() {
        this.canvas = document.getElementById('strmatch-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.running = true;
        this.resize();
        this.computeSteps();
        this.bindEvents();
        this.draw();
        this.updateEdu();
    },

    destroy() {
        this.running = false;
        this.playing = false;
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
        const h = Math.min(w * 0.55, 380);
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w;
        this.H = h;
    },

    computeLPS() {
        const p = this.pattern;
        const lps = new Array(p.length).fill(0);
        let len = 0, i = 1;
        while (i < p.length) {
            if (p[i] === p[len]) {
                len++;
                lps[i] = len;
                i++;
            } else {
                if (len !== 0) len = lps[len - 1];
                else { lps[i] = 0; i++; }
            }
        }
        this.lps = lps;
        return lps;
    },

    computeSteps() {
        this.steps = [];
        this.currentStep = 0;
        const t = this.text, p = this.pattern;

        if (this.algo === 'kmp') {
            const lps = this.computeLPS();
            let i = 0, j = 0;
            while (i < t.length) {
                this.steps.push({
                    ti: i, pj: j, pOffset: i - j,
                    match: t[i] === p[j],
                    found: false,
                    comparing: true
                });
                if (t[i] === p[j]) {
                    i++; j++;
                    if (j === p.length) {
                        this.steps.push({
                            ti: i - 1, pj: j - 1, pOffset: i - j,
                            match: true, found: true, comparing: false
                        });
                        j = lps[j - 1];
                    }
                } else {
                    if (j !== 0) {
                        j = lps[j - 1];
                    } else {
                        i++;
                    }
                }
            }
        } else {
            // Brute force
            for (let i = 0; i <= t.length - p.length; i++) {
                let found = true;
                for (let j = 0; j < p.length; j++) {
                    this.steps.push({
                        ti: i + j, pj: j, pOffset: i,
                        match: t[i + j] === p[j],
                        found: false,
                        comparing: true
                    });
                    if (t[i + j] !== p[j]) {
                        found = false;
                        break;
                    }
                }
                if (found) {
                    this.steps.push({
                        ti: i + p.length - 1, pj: p.length - 1, pOffset: i,
                        match: true, found: true, comparing: false
                    });
                }
            }
        }
        if (this.steps.length === 0) {
            this.steps.push({ ti: 0, pj: 0, pOffset: 0, match: false, found: false, comparing: false });
        }
    },

    bindEvents() {
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver(() => this.resize());
            this._resizeObs.observe(this.canvas.parentElement);
        }
        document.querySelectorAll('.strmatch-algo-btn').forEach(btn => {
            this._on(btn, 'click', () => {
                document.querySelectorAll('.strmatch-algo-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.algo = btn.dataset.algo;
                this.playing = false;
                this.computeSteps();
                this.draw();
                this.updateEdu();
            });
        });
        const playBtn = document.getElementById('strmatch-play');
        if (playBtn) {
            this._on(playBtn, 'click', () => {
                if (this.currentStep >= this.steps.length - 1) {
                    this.currentStep = 0;
                }
                this.playing = !this.playing;
                if (this.playing) this.autoPlay();
            });
        }
        const stepBtn = document.getElementById('strmatch-step');
        if (stepBtn) {
            this._on(stepBtn, 'click', () => {
                this.playing = false;
                if (this.currentStep < this.steps.length - 1) {
                    this.currentStep++;
                    this.draw();
                    this.updateEdu();
                }
            });
        }
        const resetBtn = document.getElementById('strmatch-reset');
        if (resetBtn) {
            this._on(resetBtn, 'click', () => {
                this.playing = false;
                this.currentStep = 0;
                this.draw();
                this.updateEdu();
            });
        }
        const speedS = document.getElementById('strmatch-speed');
        if (speedS) {
            this._on(speedS, 'input', () => { this.speed = parseFloat(speedS.value); });
        }
    },

    autoPlay() {
        if (!this.playing || !this.running) return;
        if (this.currentStep < this.steps.length - 1) {
            this.currentStep++;
            this.draw();
            this.updateEdu();
            setTimeout(() => this.autoPlay(), 400 / this.speed);
        } else {
            this.playing = false;
            this.updateEdu();
        }
    },

    draw() {
        const { ctx, W, H, text, pattern, steps, currentStep } = this;
        if (!ctx || W === 0) return;
        ctx.clearRect(0, 0, W, H);

        const step = steps[currentStep] || steps[0];
        const cellW = Math.min(28, (W - 40) / Math.max(text.length, 10));
        const cellH = 30;
        const startX = 20;

        // Title
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '15px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText(this.algo === 'kmp' ? 'KMP \u7b97\u6cd5' : '\u66b4\u529b\u5339\u914d', 10, 18);
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '14px ' + CF.mono;
        ctx.fillText('\u6b65\u9aa4 ' + (currentStep + 1) + '/' + steps.length, 10, 32);

        // Text row
        const textY = 60;
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.font = '14px ' + CF.mono;
        ctx.textAlign = 'left';
        ctx.fillText('\u6587\u672c:', startX, textY - 8);

        for (let i = 0; i < text.length; i++) {
            const x = startX + i * cellW;
            // Highlight matched positions from found steps
            let bg = 'rgba(255,255,255,0.03)';
            if (step.found && i >= step.pOffset && i < step.pOffset + pattern.length) {
                bg = 'rgba(77,158,126,0.2)';
            } else if (i === step.ti && step.comparing) {
                bg = step.match ? 'rgba(77,158,126,0.15)' : 'rgba(224,108,117,0.15)';
            }
            ctx.fillStyle = bg;
            ctx.fillRect(x, textY, cellW - 1, cellH);

            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = '17px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillText(text[i], x + cellW / 2, textY + cellH / 2 + 4);

            // Index
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            ctx.font = '12px ' + CF.mono;
            ctx.fillText(i, x + cellW / 2, textY + cellH + 10);
        }

        // Pattern row (shifted by pOffset)
        const patY = textY + cellH + 22;
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.font = '14px ' + CF.mono;
        ctx.textAlign = 'left';
        ctx.fillText('\u6a21\u5f0f:', startX, patY - 8);

        for (let j = 0; j < pattern.length; j++) {
            const x = startX + (step.pOffset + j) * cellW;
            let bg = 'rgba(196,121,58,0.05)';
            if (step.found) {
                bg = 'rgba(77,158,126,0.2)';
            } else if (j === step.pj && step.comparing) {
                bg = step.match ? 'rgba(77,158,126,0.15)' : 'rgba(224,108,117,0.15)';
            } else if (j < step.pj) {
                bg = 'rgba(77,158,126,0.08)';
            }
            ctx.fillStyle = bg;
            ctx.fillRect(x, patY, cellW - 1, cellH);

            ctx.fillStyle = 'rgba(196,121,58,0.6)';
            ctx.font = '17px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillText(pattern[j], x + cellW / 2, patY + cellH / 2 + 4);
        }

        // Comparison arrow
        if (step.comparing) {
            const arrowX = startX + step.ti * cellW + cellW / 2;
            ctx.strokeStyle = step.match ? 'rgba(77,158,126,0.4)' : 'rgba(224,108,117,0.4)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(arrowX, textY + cellH + 2);
            ctx.lineTo(arrowX, patY - 2);
            ctx.stroke();
            // Arrow head
            ctx.fillStyle = ctx.strokeStyle;
            ctx.beginPath();
            ctx.moveTo(arrowX - 3, patY - 5);
            ctx.lineTo(arrowX + 3, patY - 5);
            ctx.lineTo(arrowX, patY - 1);
            ctx.fill();
        }

        // Status message
        const statusY = patY + cellH + 30;
        ctx.font = '15px ' + CF.sans;
        ctx.textAlign = 'left';
        if (step.found) {
            ctx.fillStyle = 'rgba(77,158,126,0.5)';
            ctx.fillText('\u2705 \u5339\u914d\u6210\u529f! \u4f4d\u7f6e: ' + step.pOffset, startX, statusY);
        } else if (step.comparing) {
            ctx.fillStyle = step.match ? 'rgba(77,158,126,0.4)' : 'rgba(224,108,117,0.4)';
            ctx.fillText(step.match ? '\u2714 \u5b57\u7b26\u5339\u914d' : '\u2718 \u5b57\u7b26\u4e0d\u5339\u914d, ' + (this.algo === 'kmp' ? '\u67e5\u627e LPS \u8df3\u8f6c' : '\u6a21\u5f0f\u53f3\u79fb'), startX, statusY);
        }

        // KMP LPS table
        if (this.algo === 'kmp') {
            this.drawLPSTable(statusY + 25);
        }
    },

    drawLPSTable(y) {
        const { ctx, W, pattern, lps } = this;
        const cellW = Math.min(22, (W - 80) / pattern.length);
        const startX = 20;

        ctx.fillStyle = 'rgba(196,121,58,0.3)';
        ctx.font = '15px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText('LPS \u8868 (\u524d\u7f00\u51fd\u6570):', startX, y);

        // Pattern chars
        for (let i = 0; i < pattern.length; i++) {
            const x = startX + i * cellW;
            ctx.fillStyle = 'rgba(196,121,58,0.08)';
            ctx.fillRect(x, y + 5, cellW - 1, 18);
            ctx.fillStyle = 'rgba(196,121,58,0.5)';
            ctx.font = '15px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillText(pattern[i], x + cellW / 2, y + 18);
        }
        // LPS values
        for (let i = 0; i < lps.length; i++) {
            const x = startX + i * cellW;
            ctx.fillStyle = 'rgba(255,255,255,0.05)';
            ctx.fillRect(x, y + 24, cellW - 1, 18);
            ctx.fillStyle = 'rgba(229,192,123,0.5)';
            ctx.font = '15px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillText(lps[i], x + cellW / 2, y + 37);
        }
    },

    /* ── education panel ── */
    updateEdu() {
        let el = document.getElementById('strmatch-edu');
        if (!el) {
            const wrap = this.canvas?.closest('.demo-section');
            if (!wrap) return;
            el = document.createElement('div');
            el.id = 'strmatch-edu';
            el.className = 'strmatch-edu';
            wrap.appendChild(el);
        }
        const step = this.steps[this.currentStep];
        const m = this.pattern.length;
        const n = this.text.length;
        if (this.algo === 'kmp') {
            const found = step && step.found;
            el.innerHTML =
                '<b>KMP 算法</b> — 利用前缀函数避免重复比较' +
                '<br>• <b>LPS 数组</b>（最长公共前后缀）: [' + this.lps.join(', ') + ']' +
                '<br>• 失配时模式串跳转到 lps[j-1] 位置，<b>主串指针不回退</b>。' +
                '<br>• 时间 O(n+m) = O(' + n + '+' + m + ') = O(' + (n + m) + ')，空间 O(m) 存 LPS。' +
                (found ? '<br>✅ 匹配成功! KMP 的优势在失配较多时尤为明显。' :
                '<br>💡 对比暴力算法 O(nm)，KMP 的核心思想是"不走回头路"。');
        } else {
            const found = step && step.found;
            el.innerHTML =
                '<b>暴力匹配</b> — 逐位对齐逐字符比较' +
                '<br>• 将模式串对齐到主串每个位置，逐字符匹配。' +
                '<br>• 失配时模式串回到开头，主串回退到下一个起点。' +
                '<br>• 最坏时间 O(nm) = O(' + n + '×' + m + ') = O(' + (n * m) + ')。' +
                (found ? '<br>✅ 匹配成功! 暴力法简单但效率低，适合短文本。' :
                '<br>💡 暴力法的问题: 失配时已比较的信息被浪费，KMP 利用 LPS 避免了这一点。');
        }
    }
};

StringMatch.updateEdu = function () {
    let el = document.getElementById('strmatch-edu');
    if (!el) {
        const wrap = this.canvas?.closest('.demo-section');
        if (!wrap) return;
        el = document.createElement('div');
        el.id = 'strmatch-edu';
        el.className = 'strmatch-edu';
        wrap.appendChild(el);
    }

    const step = this.steps[this.currentStep] || this.steps[0];
    const m = this.pattern.length;
    const n = this.text.length;
    const found = step && step.found;
    const sourceNote = '<p class="algo-source-note">参考资料：NIST Dictionary of Algorithms and Data Structures 的 Knuth-Morris-Pratt algorithm 条目。页面使用 LPS 表解释跳转思想，符号与教材中的 next / failure function 可能略有差异。</p>';

    if (this.algo === 'kmp') {
        el.innerHTML =
            '<b>KMP 算法</b>：先用模式串构造 LPS 表，失配时让模式串跳到仍可能匹配的位置。' +
            '<br><b>LPS 数组</b>（最长相等前后缀长度）：[' + this.lps.join(', ') + ']。' +
            '<br>当 <code>text[i]</code> 与 <code>pattern[j]</code> 失配时，KMP 使用 <code>lps[j-1]</code> 决定新的 j，文本指针 i 不需要回退。' +
            '<br>时间复杂度为 <code>O(n + m)</code>，空间复杂度为 <code>O(m)</code>。这里 n = ' + n + '，m = ' + m + '。' +
            (found
                ? '<br>匹配成功：模式串从文本位置 ' + step.pOffset + ' 开始出现。'
                : '<br>对照暴力匹配可以看到：KMP 复用的是模式串自身的结构信息。') +
            sourceNote;
        return;
    }

    el.innerHTML =
        '<b>暴力匹配</b>：把模式串依次对齐到文本的每个可能起点，再逐字符比较。' +
        '<br>失配后，模式串回到开头，文本起点右移一位；这种方法实现直接，但会丢掉已经比较过的信息。' +
        '<br>最坏时间复杂度为 <code>O(nm)</code>，这里 n = ' + n + '，m = ' + m + '。' +
        (found
            ? '<br>匹配成功：模式串从文本位置 ' + step.pOffset + ' 开始出现。'
            : '<br>适合用来理解“为什么 KMP 要记录前后缀信息”。') +
        sourceNote;
};

function initStringMatch() {
    StringMatch.init();
}

window.StringMatch = StringMatch;
window.initStringMatch = initStringMatch;
