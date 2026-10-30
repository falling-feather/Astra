// ===== 光学可视化引擎 =====
// 6 模式: 透镜成像、双缝干涉、折射与全反射、棱镜色散、衍射光栅、偏振与马吕斯定律

const OpticsLab = {
    canvas: null, ctx: null, W: 0, H: 0,
    mode: 'lens',        // 'lens' | 'doubleslit' | 'refraction' | 'prism' | 'grating' | 'polarization'
    paused: false,

    // 透镜成像
    lensFocal: 120,      // 焦距 px
    objDist: 250,        // 物距 px (正)
    objHeight: 60,       // 物高 px

    // 双缝干涉
    slitSep: 40,         // 缝间距 px
    wavelength: 16,      // λ px (用于波纹间距)
    _slitTime: 0,
    _slitAnimId: null,
    _slitRunning: false,
    _slitLastTime: 0,

    // 折射
    n1: 1.0,
    n2: 1.5,
    incidentAngle: 30,   // 度

    // 棱镜色散
    prismApex: 60,           // 顶角 (度)
    prismIncident: 50,       // 入射角 (度)
    prismMaterial: 'crown',  // 'crown' | 'flint'

    // 衍射光栅
    gratingN: 6,             // 缝数
    gratingD: 30,            // 缝距 (px)
    gratingWavelength: 16,   // λ (px)
    gratingWhite: false,     // 白光模式

    // 偏振
    polarizerCount: 2,
    polarizerAngles: [0, 90, 45],

    init() {
        this.canvas = document.getElementById('optics-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');

        this.resize();
        this._injectModeButtons();
        this._injectLensPanel();
        this._injectSlitPanel();
        this._injectRefractionPanel();
        this._injectPrismPanel();
        this._injectGratingPanel();
        this._injectPolarizationPanel();
        this._injectGlobalActions();
        this.setMode('lens');

        if (typeof ResizeObserver !== 'undefined') {
            this._ro = new ResizeObserver(() => { this.resize(); this.render(); });
            this._ro.observe(this.canvas.parentElement);
        }
    },

    destroy() {
        if (this._slitAnimId) { cancelAnimationFrame(this._slitAnimId); this._slitAnimId = null; }
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
    },

    resize() {
        if (window.PhysicsZoom && window.PhysicsZoom.movedCanvas === this.canvas) return;
        const wrap = this.canvas.parentElement;
        if (!wrap) return;
        const w = wrap.clientWidth;
        if (w === 0) return;
        const h = Math.min(w * 0.55, 440);
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w; this.H = h;
    },

    // ═══════════════════════════════════════════
    // UI 面板
    // ═══════════════════════════════════════════
    _injectModeButtons() {
        const wrap = document.getElementById('optics-controls');
        if (!wrap) return;
        const bar = document.createElement('div');
        bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;';
        [['lens', '透镜成像'], ['doubleslit', '双缝干涉'], ['refraction', '折射与全反射'], ['prism', '棱镜色散'], ['grating', '衍射光栅'], ['polarization', '偏振']].forEach(([key, label]) => {
            const btn = document.createElement('button');
            btn.className = 'btn btn--ghost optics-mode-btn';
            btn.dataset.mode = key;
            btn.textContent = label;
            btn.addEventListener('click', () => this.setMode(key));
            bar.appendChild(btn);
        });
        wrap.prepend(bar);
    },

    _injectGlobalActions() {
        const wrap = document.getElementById('optics-controls');
        if (!wrap || document.getElementById('optics-global-actions')) return;
        const row = document.createElement('div');
        row.id = 'optics-global-actions';
        row.className = 'physics-actions';
        row.innerHTML = `
            <button id="optics-pause" class="btn btn--ghost">暂停</button>
            <button id="optics-reset" class="btn btn--ghost">重置</button>
        `;
        wrap.appendChild(row);

        const pauseBtn = document.getElementById('optics-pause');
        const resetBtn = document.getElementById('optics-reset');
        if (pauseBtn) pauseBtn.addEventListener('click', () => {
            this.paused = !this.paused;
            pauseBtn.textContent = this.paused ? '继续' : '暂停';
        });
        if (resetBtn) resetBtn.addEventListener('click', () => this.resetScene());
    },

    resetScene() {
        this.paused = false;
        const pauseBtn = document.getElementById('optics-pause');
        if (pauseBtn) pauseBtn.textContent = '暂停';

        this.mode = 'lens';
        this.lensFocal = 120;
        this.objDist = 250;
        this.objHeight = 60;

        this.slitSep = 40;
        this.wavelength = 16;
        this._slitTime = 0;
        this._slitRunning = false;
        if (this._slitAnimId) { cancelAnimationFrame(this._slitAnimId); this._slitAnimId = null; }

        this.n1 = 1.0;
        this.n2 = 1.5;
        this.incidentAngle = 30;

        this.prismApex = 60;
        this.prismIncident = 50;
        this.prismMaterial = 'crown';

        this.gratingN = 6;
        this.gratingD = 30;
        this.gratingWavelength = 16;
        this.gratingWhite = false;

        this.polarizerCount = 2;
        this.polarizerAngles = [0, 90, 45];

        this.setMode('lens');
        this.render();
    },

    _injectLensPanel() {
        const wrap = document.getElementById('optics-controls');
        if (!wrap || document.getElementById('optics-lens-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'optics-lens-panel';
        panel.style.cssText = 'display:none;padding:8px 12px;background:rgba(30,41,59,.55);border-radius:8px;font-size:13px;color:#e2e8f0;';
        panel.innerHTML = `
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
                <div>
                    <label style="font-size:12px;color:#94a3b8">焦距 f</label>
                    <input type="range" id="optics-focal" min="40" max="250" step="5" value="120" style="width:100px;vertical-align:middle">
                    <span id="optics-focal-val" style="font-size:12px;color:#cbd5e1">120</span>
                </div>
                <div>
                    <label style="font-size:12px;color:#94a3b8">物距 d<sub>o</sub></label>
                    <input type="range" id="optics-objdist" min="40" max="450" step="5" value="250" style="width:100px;vertical-align:middle">
                    <span id="optics-objdist-val" style="font-size:12px;color:#cbd5e1">250</span>
                </div>
            </div>
            <div id="optics-lens-info" style="margin-top:6px;color:#94a3b8;font-size:12px"></div>
        `;
        wrap.appendChild(panel);

        document.getElementById('optics-focal').addEventListener('input', e => {
            this.lensFocal = parseFloat(e.target.value);
            document.getElementById('optics-focal-val').textContent = this.lensFocal;
            this.render();
        });
        document.getElementById('optics-objdist').addEventListener('input', e => {
            this.objDist = parseFloat(e.target.value);
            document.getElementById('optics-objdist-val').textContent = this.objDist;
            this.render();
        });
    },

    _injectSlitPanel() {
        const wrap = document.getElementById('optics-controls');
        if (!wrap || document.getElementById('optics-slit-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'optics-slit-panel';
        panel.style.cssText = 'display:none;padding:8px 12px;background:rgba(30,41,59,.55);border-radius:8px;font-size:13px;color:#e2e8f0;';
        panel.innerHTML = `
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
                <div>
                    <label style="font-size:12px;color:#94a3b8">缝间距 d</label>
                    <input type="range" id="optics-slitsep" min="10" max="80" step="2" value="40" style="width:90px;vertical-align:middle">
                    <span id="optics-slitsep-val" style="font-size:12px;color:#cbd5e1">40</span>
                </div>
                <div>
                    <label style="font-size:12px;color:#94a3b8">波长 λ</label>
                    <input type="range" id="optics-wavelength" min="6" max="30" step="1" value="16" style="width:90px;vertical-align:middle">
                    <span id="optics-wavelength-val" style="font-size:12px;color:#cbd5e1">16</span>
                </div>
                <button id="optics-slit-toggle" class="btn btn--ghost" style="font-size:12px;padding:2px 12px">播放</button>
            </div>
            <div style="margin-top:6px;color:#94a3b8;font-size:12px">I = I₀ cos²(πd sinθ / λ) — 干涉条纹间距 ∝ λ/d</div>
        `;
        wrap.appendChild(panel);

        document.getElementById('optics-slitsep').addEventListener('input', e => {
            this.slitSep = parseFloat(e.target.value);
            document.getElementById('optics-slitsep-val').textContent = this.slitSep;
            this.render();
        });
        document.getElementById('optics-wavelength').addEventListener('input', e => {
            this.wavelength = parseFloat(e.target.value);
            document.getElementById('optics-wavelength-val').textContent = this.wavelength;
            this.render();
        });
        document.getElementById('optics-slit-toggle').addEventListener('click', () => {
            if (this._slitRunning) {
                this._slitRunning = false;
                document.getElementById('optics-slit-toggle').textContent = '播放';
            } else {
                this._slitRunning = true;
                document.getElementById('optics-slit-toggle').textContent = '暂停';
                this._slitLastTime = 0;
                this._runSlitAnim();
            }
        });
    },

    _injectRefractionPanel() {
        const wrap = document.getElementById('optics-controls');
        if (!wrap || document.getElementById('optics-refraction-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'optics-refraction-panel';
        panel.style.cssText = 'display:none;padding:8px 12px;background:rgba(30,41,59,.55);border-radius:8px;font-size:13px;color:#e2e8f0;';
        panel.innerHTML = `
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
                <div>
                    <label style="font-size:12px;color:#94a3b8">n₁</label>
                    <input type="range" id="optics-n1" min="1.0" max="2.5" step="0.05" value="1.0" style="width:80px;vertical-align:middle">
                    <span id="optics-n1-val" style="font-size:12px;color:#cbd5e1">1.00</span>
                </div>
                <div>
                    <label style="font-size:12px;color:#94a3b8">n₂</label>
                    <input type="range" id="optics-n2" min="1.0" max="2.5" step="0.05" value="1.5" style="width:80px;vertical-align:middle">
                    <span id="optics-n2-val" style="font-size:12px;color:#cbd5e1">1.50</span>
                </div>
                <div>
                    <label style="font-size:12px;color:#94a3b8">入射角 θ</label>
                    <input type="range" id="optics-incident" min="0" max="89" step="1" value="30" style="width:90px;vertical-align:middle">
                    <span id="optics-incident-val" style="font-size:12px;color:#cbd5e1">30°</span>
                </div>
            </div>
            <div id="optics-refraction-info" style="margin-top:6px;color:#94a3b8;font-size:12px"></div>
        `;
        wrap.appendChild(panel);

        document.getElementById('optics-n1').addEventListener('input', e => {
            this.n1 = parseFloat(e.target.value);
            document.getElementById('optics-n1-val').textContent = this.n1.toFixed(2);
            this.render();
        });
        document.getElementById('optics-n2').addEventListener('input', e => {
            this.n2 = parseFloat(e.target.value);
            document.getElementById('optics-n2-val').textContent = this.n2.toFixed(2);
            this.render();
        });
        document.getElementById('optics-incident').addEventListener('input', e => {
            this.incidentAngle = parseFloat(e.target.value);
            document.getElementById('optics-incident-val').textContent = this.incidentAngle + '°';
            this.render();
        });
    },

    _injectPrismPanel() {
        const wrap = document.getElementById('optics-controls');
        if (!wrap || document.getElementById('optics-prism-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'optics-prism-panel';
        panel.style.cssText = 'display:none;padding:8px 12px;background:rgba(30,41,59,.55);border-radius:8px;font-size:13px;color:#e2e8f0;';
        panel.innerHTML = `
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
                <div>
                    <label style="font-size:12px;color:#94a3b8">顶角 A</label>
                    <input type="range" id="optics-prism-apex" min="30" max="80" step="1" value="60" style="width:75px;vertical-align:middle">
                    <span id="optics-prism-apex-val" style="font-size:12px;color:#cbd5e1">60°</span>
                </div>
                <div>
                    <label style="font-size:12px;color:#94a3b8">入射角 θ₁</label>
                    <input type="range" id="optics-prism-inc" min="20" max="80" step="1" value="50" style="width:75px;vertical-align:middle">
                    <span id="optics-prism-inc-val" style="font-size:12px;color:#cbd5e1">50°</span>
                </div>
                <div>
                    <label style="font-size:12px;color:#94a3b8">材质</label>
                    <select id="optics-prism-mat" style="background:rgba(15,23,42,.7);color:#e2e8f0;border:1px solid rgba(148,163,184,.2);border-radius:4px;padding:2px 6px;font-size:12px">
                        <option value="crown" selected>冕牌玻璃</option>
                        <option value="flint">火石玻璃</option>
                    </select>
                </div>
            </div>
            <div id="optics-prism-info" style="margin-top:6px;color:#94a3b8;font-size:12px"></div>
        `;
        wrap.appendChild(panel);

        document.getElementById('optics-prism-apex').addEventListener('input', e => {
            this.prismApex = parseFloat(e.target.value);
            document.getElementById('optics-prism-apex-val').textContent = this.prismApex + '°';
            this.render();
        });
        document.getElementById('optics-prism-inc').addEventListener('input', e => {
            this.prismIncident = parseFloat(e.target.value);
            document.getElementById('optics-prism-inc-val').textContent = this.prismIncident + '°';
            this.render();
        });
        document.getElementById('optics-prism-mat').addEventListener('change', e => {
            this.prismMaterial = e.target.value;
            this.render();
        });
    },

    _injectGratingPanel() {
        const wrap = document.getElementById('optics-controls');
        if (!wrap || document.getElementById('optics-grating-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'optics-grating-panel';
        panel.style.cssText = 'display:none;padding:8px 12px;background:rgba(30,41,59,.55);border-radius:8px;font-size:13px;color:#e2e8f0;';
        panel.innerHTML = `
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
                <div>
                    <label style="font-size:12px;color:#94a3b8">缝数 N</label>
                    <input type="range" id="optics-grating-n" min="2" max="60" step="1" value="6" style="width:70px;vertical-align:middle">
                    <span id="optics-grating-n-val" style="font-size:12px;color:#cbd5e1">6</span>
                </div>
                <div>
                    <label style="font-size:12px;color:#94a3b8">缝距 d</label>
                    <input type="range" id="optics-grating-d" min="10" max="60" step="1" value="30" style="width:70px;vertical-align:middle">
                    <span id="optics-grating-d-val" style="font-size:12px;color:#cbd5e1">30</span>
                </div>
                <div>
                    <label style="font-size:12px;color:#94a3b8">波长 λ</label>
                    <input type="range" id="optics-grating-lam" min="6" max="30" step="1" value="16" style="width:70px;vertical-align:middle">
                    <span id="optics-grating-lam-val" style="font-size:12px;color:#cbd5e1">16</span>
                </div>
                <label style="font-size:12px;color:#94a3b8;cursor:pointer">
                    <input type="checkbox" id="optics-grating-white" style="vertical-align:middle"> 白光
                </label>
            </div>
            <div id="optics-grating-info" style="margin-top:6px;color:#94a3b8;font-size:12px"></div>
        `;
        wrap.appendChild(panel);

        document.getElementById('optics-grating-n').addEventListener('input', e => {
            this.gratingN = parseInt(e.target.value);
            document.getElementById('optics-grating-n-val').textContent = this.gratingN;
            this.render();
        });
        document.getElementById('optics-grating-d').addEventListener('input', e => {
            this.gratingD = parseInt(e.target.value);
            document.getElementById('optics-grating-d-val').textContent = this.gratingD;
            this.render();
        });
        document.getElementById('optics-grating-lam').addEventListener('input', e => {
            this.gratingWavelength = parseInt(e.target.value);
            document.getElementById('optics-grating-lam-val').textContent = this.gratingWavelength;
            this.render();
        });
        document.getElementById('optics-grating-white').addEventListener('change', e => {
            this.gratingWhite = e.target.checked;
            this.render();
        });
    },

    _injectPolarizationPanel() {
        const wrap = document.getElementById('optics-controls');
        if (!wrap || document.getElementById('optics-pol-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'optics-pol-panel';
        panel.style.cssText = 'display:none;padding:8px 12px;background:rgba(30,41,59,.55);border-radius:8px;font-size:13px;color:#e2e8f0;';
        panel.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <div>
                    <label style="font-size:12px;color:#94a3b8">片数</label>
                    <select id="optics-pol-count" style="background:rgba(15,23,42,.7);color:#e2e8f0;border:1px solid rgba(148,163,184,.2);border-radius:4px;padding:2px 6px;font-size:12px">
                        <option value="2" selected>2 片</option>
                        <option value="3">3 片</option>
                    </select>
                </div>
                <div>
                    <label style="font-size:12px;color:#94a3b8">θ₁</label>
                    <input type="range" id="optics-pol-a1" min="0" max="180" step="1" value="0" style="width:60px;vertical-align:middle">
                    <span id="optics-pol-a1-val" style="font-size:12px;color:#cbd5e1">0°</span>
                </div>
                <div>
                    <label style="font-size:12px;color:#94a3b8">θ₂</label>
                    <input type="range" id="optics-pol-a2" min="0" max="180" step="1" value="90" style="width:60px;vertical-align:middle">
                    <span id="optics-pol-a2-val" style="font-size:12px;color:#cbd5e1">90°</span>
                </div>
                <div id="optics-pol-a3-wrap" style="display:none">
                    <label style="font-size:12px;color:#94a3b8">θ₃</label>
                    <input type="range" id="optics-pol-a3" min="0" max="180" step="1" value="45" style="width:60px;vertical-align:middle">
                    <span id="optics-pol-a3-val" style="font-size:12px;color:#cbd5e1">45°</span>
                </div>
            </div>
            <div style="display:flex;gap:5px;margin-top:6px;flex-wrap:wrap">
                <button class="btn btn--ghost optics-pol-preset" data-preset="parallel" style="font-size:11px;padding:2px 8px">平行 0°,0°</button>
                <button class="btn btn--ghost optics-pol-preset" data-preset="crossed" style="font-size:11px;padding:2px 8px">正交 0°,90°</button>
                <button class="btn btn--ghost optics-pol-preset" data-preset="paradox" style="font-size:11px;padding:2px 8px">悖论 0°,45°,90°</button>
            </div>
            <div id="optics-pol-info" style="margin-top:6px;color:#94a3b8;font-size:12px"></div>
        `;
        wrap.appendChild(panel);

        document.getElementById('optics-pol-count').addEventListener('change', e => {
            this.polarizerCount = parseInt(e.target.value);
            document.getElementById('optics-pol-a3-wrap').style.display = this.polarizerCount === 3 ? '' : 'none';
            this.render();
        });
        ['a1', 'a2', 'a3'].forEach((key, i) => {
            document.getElementById(`optics-pol-${key}`).addEventListener('input', e => {
                this.polarizerAngles[i] = parseInt(e.target.value);
                document.getElementById(`optics-pol-${key}-val`).textContent = this.polarizerAngles[i] + '°';
                this.render();
            });
        });
        panel.querySelectorAll('.optics-pol-preset').forEach(btn => {
            btn.addEventListener('click', () => {
                const p = btn.dataset.preset;
                if (p === 'parallel')     { this.polarizerCount = 2; this.polarizerAngles = [0, 0, 45]; }
                else if (p === 'crossed') { this.polarizerCount = 2; this.polarizerAngles = [0, 90, 45]; }
                else if (p === 'paradox') { this.polarizerCount = 3; this.polarizerAngles = [0, 45, 90]; }
                document.getElementById('optics-pol-count').value = this.polarizerCount;
                document.getElementById('optics-pol-a3-wrap').style.display = this.polarizerCount === 3 ? '' : 'none';
                for (let j = 0; j < 3; j++) {
                    const k = ['a1', 'a2', 'a3'][j];
                    document.getElementById(`optics-pol-${k}`).value = this.polarizerAngles[j];
                    document.getElementById(`optics-pol-${k}-val`).textContent = this.polarizerAngles[j] + '°';
                }
                this.render();
            });
        });
    },

    // ═══════════════════════════════════════════
    // 模式切换
    // ═══════════════════════════════════════════
    setMode(mode) {
        this.mode = mode;
        document.querySelectorAll('.optics-mode-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.mode === mode);
        });
        const lp = document.getElementById('optics-lens-panel');
        const sp = document.getElementById('optics-slit-panel');
        const rp = document.getElementById('optics-refraction-panel');
        if (lp) lp.style.display = mode === 'lens' ? '' : 'none';
        if (sp) sp.style.display = mode === 'doubleslit' ? '' : 'none';
        if (rp) rp.style.display = mode === 'refraction' ? '' : 'none';
        const pp = document.getElementById('optics-prism-panel');
        if (pp) pp.style.display = mode === 'prism' ? '' : 'none';
        const gp = document.getElementById('optics-grating-panel');
        if (gp) gp.style.display = mode === 'grating' ? '' : 'none';
        const polP = document.getElementById('optics-pol-panel');
        if (polP) polP.style.display = mode === 'polarization' ? '' : 'none';

        if (mode !== 'doubleslit') {
            this._slitRunning = false;
            if (this._slitAnimId) { cancelAnimationFrame(this._slitAnimId); this._slitAnimId = null; }
        }
        this.render();
        this.updateInfo();
    },

    // ═══════════════════════════════════════════
    // 渲染入口
    // ═══════════════════════════════════════════
    render() {
        const { ctx, W, H } = this;
        if (W === 0) return;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#0c1222';
        ctx.fillRect(0, 0, W, H);

        switch (this.mode) {
            case 'lens': this.drawLens(); break;
            case 'doubleslit': this.drawDoubleSlit(); break;
            case 'refraction': this.drawRefraction(); break;
            case 'prism': this.drawPrism(); break;
            case 'grating': this.drawGrating(); break;
            case 'polarization': this.drawPolarization(); break;
        }
    },

    // ═══════════════════════════════════════════
    // 透镜成像
    // ═══════════════════════════════════════════
    drawLens() {
        const { ctx, W, H } = this;
        const axisY = H / 2;
        const lensX = W / 2;
        const f = this.lensFocal;
        const dObj = this.objDist;
        const hObj = this.objHeight;

        // 光轴
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(0, axisY); ctx.lineTo(W, axisY); ctx.stroke();
        ctx.setLineDash([]);

        // 透镜
        ctx.strokeStyle = 'rgba(56,189,248,0.6)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(lensX, axisY - H * 0.35);
        ctx.lineTo(lensX, axisY + H * 0.35);
        ctx.stroke();
        // 箭头 (凸透镜)
        const aSize = 8;
        ctx.fillStyle = 'rgba(56,189,248,0.6)';
        [axisY - H * 0.35, axisY + H * 0.35].forEach(y => {
            const dir = y < axisY ? 1 : -1;
            ctx.beginPath();
            ctx.moveTo(lensX - aSize, y + dir * aSize * 0.3);
            ctx.lineTo(lensX, y);
            ctx.lineTo(lensX + aSize, y + dir * aSize * 0.3);
            ctx.stroke();
        });

        // 焦点标记
        ctx.fillStyle = '#f59e0b';
        [lensX - f, lensX + f].forEach(x => {
            if (x > 10 && x < W - 10) {
                ctx.beginPath();
                ctx.arc(x, axisY, 4, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = 'rgba(245,158,11,0.6)';
                ctx.font = '15px ' + CF.sans;
                ctx.textAlign = 'center';
                ctx.fillText('F', x, axisY + 16);
                ctx.fillStyle = '#f59e0b';
            }
        });

        // 物体 (红箭头)
        const objX = lensX - dObj;
        ctx.strokeStyle = '#f43f5e';
        ctx.fillStyle = '#f43f5e';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(objX, axisY);
        ctx.lineTo(objX, axisY - hObj);
        ctx.stroke();
        // 箭头头部
        ctx.beginPath();
        ctx.moveTo(objX, axisY - hObj);
        ctx.lineTo(objX - 5, axisY - hObj + 10);
        ctx.lineTo(objX + 5, axisY - hObj + 10);
        ctx.closePath(); ctx.fill();

        // 像距计算: 1/f = 1/do + 1/di → di = f*do/(do-f)
        const dImg = (f * dObj) / (dObj - f);
        const magnification = -dImg / dObj;
        const hImg = magnification * hObj;
        const imgX = lensX + dImg;
        const isReal = dImg > 0;

        // 三条主光线
        ctx.lineWidth = 1.5;

        // 光线 1: 物→平行于轴→透镜→通过像方焦点
        ctx.strokeStyle = 'rgba(251,191,36,0.5)';
        ctx.beginPath();
        ctx.moveTo(objX, axisY - hObj);
        ctx.lineTo(lensX, axisY - hObj); // 平行到透镜
        if (isReal) {
            ctx.lineTo(imgX, axisY - hImg); // 到像
            // 延长
            const ext = W;
            const slope = (axisY - hImg - (axisY - hObj)) / (imgX - lensX);
            ctx.lineTo(ext, (axisY - hObj) + slope * (ext - lensX));
        } else {
            ctx.lineTo(W, axisY - hObj + ((axisY - hObj) - (axisY)) / f * (W - lensX)); // 发散
            // 虚延长线
            ctx.stroke();
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = 'rgba(251,191,36,0.25)';
            ctx.beginPath();
            ctx.moveTo(lensX, axisY - hObj);
            ctx.lineTo(imgX, axisY - hImg);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // 光线 2: 物→通过光心→直线
        ctx.strokeStyle = 'rgba(56,189,248,0.5)';
        ctx.beginPath();
        ctx.moveTo(objX, axisY - hObj);
        if (isReal) {
            ctx.lineTo(imgX, axisY - hImg);
            const slope2 = ((axisY - hObj) - axisY) / (objX - lensX);
            ctx.lineTo(W, axisY + slope2 * (W - lensX));
        } else {
            const slope2 = ((axisY - hObj) - axisY) / (objX - lensX);
            ctx.lineTo(W, axisY + slope2 * (W - lensX));
        }
        ctx.stroke();

        // 光线 3: 物→通过物方焦点→透镜→平行
        ctx.strokeStyle = 'rgba(139,92,246,0.5)';
        const fObjX = lensX - f;
        // 从物到物方焦点的延长线打到透镜上什么高度
        const slopeToF = ((axisY - hObj) - axisY) / (objX - fObjX);
        const hitY = axisY + slopeToF * (lensX - fObjX);
        ctx.beginPath();
        ctx.moveTo(objX, axisY - hObj);
        ctx.lineTo(lensX, hitY);
        if (isReal) {
            ctx.lineTo(imgX, hitY); // 平行出射到像
            ctx.lineTo(W, hitY);
        } else {
            ctx.lineTo(W, hitY);
        }
        ctx.stroke();

        // 虚像延长线
        if (!isReal) {
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = 'rgba(139,92,246,0.25)';
            ctx.beginPath();
            ctx.moveTo(lensX, hitY);
            ctx.lineTo(imgX, hitY);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // 像 (绿箭头 — 实像; 虚线 — 虚像)
        if (imgX > 10 && imgX < W - 10) {
            if (isReal) {
                ctx.strokeStyle = '#22c55e';
                ctx.fillStyle = '#22c55e';
                ctx.lineWidth = 3;
            } else {
                ctx.strokeStyle = 'rgba(34,197,94,0.5)';
                ctx.fillStyle = 'rgba(34,197,94,0.5)';
                ctx.lineWidth = 2;
                ctx.setLineDash([4, 4]);
            }
            ctx.beginPath();
            ctx.moveTo(imgX, axisY);
            ctx.lineTo(imgX, axisY - hImg);
            ctx.stroke();
            ctx.setLineDash([]);
            // 箭头
            const imgDir = hImg > 0 ? -1 : 1;
            ctx.beginPath();
            ctx.moveTo(imgX, axisY - hImg);
            ctx.lineTo(imgX - 5, axisY - hImg + imgDir * 10);
            ctx.lineTo(imgX + 5, axisY - hImg + imgDir * 10);
            ctx.closePath(); ctx.fill();
        }

        // 标注
        ctx.font = '15px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#f43f5e';
        ctx.fillText('物', objX, axisY + 20);
        if (imgX > 10 && imgX < W - 10) {
            ctx.fillStyle = '#22c55e';
            ctx.fillText(isReal ? '实像' : '虚像', imgX, axisY + 20);
        }
        ctx.fillStyle = 'rgba(56,189,248,0.6)';
        ctx.fillText('凸透镜', lensX, axisY + H * 0.35 + 16);

        // 公式信息
        const info = document.getElementById('optics-lens-info');
        if (info) {
            const absD = Math.abs(dImg).toFixed(0);
            const m = Math.abs(magnification).toFixed(2);
            info.innerHTML = `1/f = 1/d<sub>o</sub> + 1/d<sub>i</sub> → d<sub>i</sub> = ${isReal ? '' : '−'}${absD}px | 放大率 |m| = ${m} | ${isReal ? '实像(倒立)' : '虚像(正立)'}`;
        }
    },

    // ═══════════════════════════════════════════
    // 双缝干涉
    // ═══════════════════════════════════════════
    drawDoubleSlit() {
        const { ctx, W, H } = this;
        const barrierX = W * 0.3;
        const screenX = W * 0.85;
        const cy = H / 2;
        const d = this.slitSep;
        const lambda = this.wavelength;

        // 暗背景
        ctx.fillStyle = '#0a0f18';
        ctx.fillRect(0, 0, W, H);

        // 挡板
        ctx.fillStyle = 'rgba(100,116,139,0.6)';
        ctx.fillRect(barrierX - 3, 0, 6, cy - d / 2 - 3);
        ctx.fillRect(barrierX - 3, cy - d / 2 + 3, 6, d - 6);
        ctx.fillRect(barrierX - 3, cy + d / 2 + 3, 6, H - cy - d / 2 - 3);

        // 缝隙高亮
        ctx.fillStyle = 'rgba(251,191,36,0.3)';
        ctx.fillRect(barrierX - 2, cy - d / 2 - 3, 4, 6);
        ctx.fillRect(barrierX - 2, cy + d / 2 - 3, 4, 6);

        // 入射波（左侧平面波）
        ctx.strokeStyle = 'rgba(56,189,248,0.12)';
        ctx.lineWidth = 1;
        const phase = this._slitTime * 3;
        for (let x = 0; x < barrierX; x += lambda) {
            const xx = x + (phase % lambda);
            if (xx < barrierX) {
                ctx.beginPath();
                ctx.moveTo(xx, 0);
                ctx.lineTo(xx, H);
                ctx.stroke();
            }
        }

        // 从两缝发出的圆弧波
        const slit1Y = cy - d / 2;
        const slit2Y = cy + d / 2;
        const maxR = W * 0.7;
        for (let r = (phase % lambda); r < maxR; r += lambda) {
            if (r < 5) continue;
            ctx.strokeStyle = 'rgba(56,189,248,0.1)';
            ctx.lineWidth = 1;
            // 只画右半
            ctx.beginPath();
            ctx.arc(barrierX, slit1Y, r, -Math.PI / 2, Math.PI / 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(barrierX, slit2Y, r, -Math.PI / 2, Math.PI / 2);
            ctx.stroke();
        }

        // 屏幕上的干涉条纹
        ctx.fillStyle = 'rgba(71,85,105,0.3)';
        ctx.fillRect(screenX - 2, 0, 4, H);

        const L = screenX - barrierX;
        for (let y = 0; y < H; y++) {
            const yOffset = y - cy;
            const sinTheta = yOffset / Math.sqrt(L * L + yOffset * yOffset);
            const delta = d * sinTheta;
            const intensity = Math.cos(Math.PI * delta / lambda) ** 2;

            // 条纹颜色
            const barW = 3 + intensity * 18;
            const alpha = 0.05 + intensity * 0.8;
            ctx.fillStyle = `rgba(56,189,248,${alpha})`;
            ctx.fillRect(screenX, y, barW, 1);
        }

        // 标签
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '15px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('双缝', barrierX, H - 10);
        ctx.fillText('光屏', screenX + 12, H - 10);
        ctx.fillText(`d = ${d}px`, barrierX, 14);
        ctx.fillText(`λ = ${lambda}px`, barrierX + 50, 14);

        // 条纹间距
        const fringeSpacing = (lambda * L / d).toFixed(0);
        ctx.fillStyle = 'rgba(56,189,248,0.5)';
        ctx.font = '16px ' + CF.mono;
        ctx.fillText(`Δy = λL/d ≈ ${fringeSpacing}px`, W * 0.6, H - 10);
    },

    _runSlitAnim() {
        if (!this._slitRunning) return;
        if (this.paused) {
            this._slitAnimId = requestAnimationFrame(() => this._runSlitAnim());
            return;
        }
        const now = performance.now();
        if (!this._slitLastTime) this._slitLastTime = now;
        const dt = Math.min((now - this._slitLastTime) / 1000, 0.1);
        this._slitLastTime = now;
        this._slitTime += dt;
        this.render();
        this._slitAnimId = requestAnimationFrame(() => this._runSlitAnim());
    },

    // ═══════════════════════════════════════════
    // 折射与全反射
    // ═══════════════════════════════════════════
    drawRefraction() {
        const { ctx, W, H } = this;
        const midY = H / 2;

        // 两种介质背景
        ctx.fillStyle = 'rgba(12,18,34,0.9)';
        ctx.fillRect(0, 0, W, midY);
        ctx.fillStyle = `rgba(30,58,90,${0.3 + (this.n2 - 1) * 0.3})`;
        ctx.fillRect(0, midY, W, H - midY);

        // 界面
        ctx.strokeStyle = 'rgba(148,163,184,0.4)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(W, midY); ctx.stroke();

        // 法线
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
        ctx.setLineDash([]);

        const cx = W / 2;
        const theta1Rad = this.incidentAngle * Math.PI / 180;
        const rayLen = Math.min(W, H) * 0.4;

        // 入射光
        const inX = cx - rayLen * Math.sin(theta1Rad);
        const inY = midY - rayLen * Math.cos(theta1Rad);
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(inX, inY); ctx.lineTo(cx, midY); ctx.stroke();
        // 箭头
        const inAngle = Math.atan2(midY - inY, cx - inX);
        this._drawRayArrow(ctx, cx - 15 * Math.cos(inAngle), midY - 15 * Math.sin(inAngle), inAngle, '#fbbf24');

        // Snell: n1 sin(θ1) = n2 sin(θ2)
        const sinTheta2 = this.n1 * Math.sin(theta1Rad) / this.n2;
        const isTotalReflection = Math.abs(sinTheta2) > 1;

        // 反射光 (总是存在)
        const reflX = cx + rayLen * Math.sin(theta1Rad);
        const reflY = midY - rayLen * Math.cos(theta1Rad);
        ctx.strokeStyle = isTotalReflection ? '#f43f5e' : 'rgba(244,63,94,0.5)';
        ctx.lineWidth = isTotalReflection ? 2.5 : 1.5;
        ctx.beginPath(); ctx.moveTo(cx, midY); ctx.lineTo(reflX, reflY); ctx.stroke();
        const reflAngle = Math.atan2(reflY - midY, reflX - cx);
        this._drawRayArrow(ctx, cx + 20 * Math.cos(reflAngle), midY + 20 * Math.sin(reflAngle), reflAngle,
            isTotalReflection ? '#f43f5e' : 'rgba(244,63,94,0.5)');

        // 折射光 (不全反射时)
        if (!isTotalReflection) {
            const theta2Rad = Math.asin(sinTheta2);
            const refrX = cx + rayLen * Math.sin(theta2Rad);
            const refrY = midY + rayLen * Math.cos(theta2Rad);
            ctx.strokeStyle = '#22c55e';
            ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.moveTo(cx, midY); ctx.lineTo(refrX, refrY); ctx.stroke();
            const refrAngle = Math.atan2(refrY - midY, refrX - cx);
            this._drawRayArrow(ctx, cx + 20 * Math.cos(refrAngle), midY + 20 * Math.sin(refrAngle), refrAngle, '#22c55e');

            // 折射角标注
            ctx.strokeStyle = 'rgba(34,197,94,0.3)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(cx, midY, 35, Math.PI / 2 - theta2Rad, Math.PI / 2);
            ctx.stroke();
            ctx.fillStyle = '#22c55e';
            ctx.font = '16px ' + CF.mono;
            ctx.textAlign = 'left';
            ctx.fillText(`θ₂=${(theta2Rad * 180 / Math.PI).toFixed(1)}°`, cx + 40, midY + 25);
        }

        // 入射角标注
        ctx.strokeStyle = 'rgba(251,191,36,0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, midY, 30, -Math.PI / 2, -Math.PI / 2 + theta1Rad);
        ctx.stroke();
        ctx.fillStyle = '#fbbf24';
        ctx.font = '16px ' + CF.mono;
        ctx.textAlign = 'right';
        ctx.fillText(`θ₁=${this.incidentAngle}°`, cx - 35, midY - 20);

        // 介质标签
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '17px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText(`n₁ = ${this.n1.toFixed(2)}`, 10, 20);
        ctx.fillText(`n₂ = ${this.n2.toFixed(2)}`, 10, midY + 20);

        // 临界角
        let criticalAngle = null;
        if (this.n1 > this.n2) {
            criticalAngle = Math.asin(this.n2 / this.n1) * 180 / Math.PI;
        }

        // 信息面板
        const info = document.getElementById('optics-refraction-info');
        if (info) {
            let text = `Snell 定律: n₁sinθ₁ = n₂sinθ₂ → `;
            if (isTotalReflection) {
                text += `<span style="color:#f43f5e">全反射！</span> θ₁ > θ<sub>c</sub> = ${criticalAngle.toFixed(1)}°`;
            } else {
                const theta2 = Math.asin(sinTheta2) * 180 / Math.PI;
                text += `θ₂ = ${theta2.toFixed(1)}°`;
                if (criticalAngle !== null) {
                    text += ` | 临界角 θ<sub>c</sub> = ${criticalAngle.toFixed(1)}°`;
                }
            }
            info.innerHTML = text;
        }

        // 全反射闪光效果
        if (isTotalReflection) {
            ctx.fillStyle = 'rgba(244,63,94,0.08)';
            ctx.beginPath();
            ctx.arc(cx, midY, 50, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#f43f5e';
            ctx.font = 'bold 17px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.fillText('全反射', cx, midY - 55);
        }

        // 方程
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '17px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText('n₁ sin θ₁ = n₂ sin θ₂', W / 2, H - 12);
    },

    // ═══════════════════════════════════════════
    // 棱镜色散
    // ═══════════════════════════════════════════
    drawPrism() {
        const { ctx, W, H } = this;
        const A = this.prismApex * Math.PI / 180;
        const theta1 = this.prismIncident * Math.PI / 180;
        const side = Math.min(W, H) * 0.30;
        const halfBase = side * Math.sin(A / 2);
        const pH = side * Math.cos(A / 2);

        // Rotate prism so horizontal light gives desired θ₁
        const rot = theta1 - A / 2;
        const cR = Math.cos(rot), sR = Math.sin(rot);
        const pcx = W * 0.38, pcy = H * 0.50;
        const rv = (vx, vy) => ({ x: pcx + vx * cR - vy * sR, y: pcy + vx * sR + vy * cR });
        const apex = rv(0, -pH * 0.5);
        const bl = rv(-halfBase, pH * 0.5);
        const br = rv(halfBase, pH * 0.5);

        // Prism body
        ctx.fillStyle = 'rgba(56,189,248,0.05)';
        ctx.strokeStyle = 'rgba(56,189,248,0.45)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(apex.x, apex.y); ctx.lineTo(bl.x, bl.y); ctx.lineTo(br.x, br.y);
        ctx.closePath(); ctx.fill(); ctx.stroke();

        // Left face: apex → bl
        const ldx = bl.x - apex.x, ldy = bl.y - apex.y;
        const ll = Math.sqrt(ldx * ldx + ldy * ldy);
        const lt = { x: ldx / ll, y: ldy / ll };
        const ln = { x: -lt.y, y: lt.x };   // outward normal (CCW)

        // Right face: apex → br
        const rdx = br.x - apex.x, rdy = br.y - apex.y;
        const rl = Math.sqrt(rdx * rdx + rdy * rdy);
        const rtV = { x: rdx / rl, y: rdy / rl };
        const rn = { x: rtV.y, y: -rtV.x };  // outward normal (CW)

        // Hit point (mid left face)
        const hit = { x: (apex.x + bl.x) / 2, y: (apex.y + bl.y) / 2 };

        // Incoming direction: horizontal from left
        const di = { x: 1, y: 0 };
        const beamIn = W * 0.32;
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(hit.x - beamIn, hit.y); ctx.lineTo(hit.x, hit.y); ctx.stroke();

        // White light label
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.font = '17px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('白光', hit.x - beamIn * 0.5, hit.y - 14);

        // Screen
        const scrX = W * 0.86;
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(scrX, 0); ctx.lineTo(scrX, H); ctx.stroke();

        // Trace wavelengths
        const pts = [];
        for (let nm = 380; nm <= 750; nm += 3) {
            const n = this._cauchyN(nm);

            // Refract at left face (air → glass)
            const r1 = this._refract2D(di.x, di.y, ln.x, ln.y, 1 / n);
            if (!r1) continue;

            // Intersect refracted ray with right face
            const t = this._raySegIntersect(hit.x, hit.y, r1.x, r1.y,
                apex.x, apex.y, br.x, br.y);
            if (!t || t < 1) continue;

            const h2 = { x: hit.x + r1.x * t, y: hit.y + r1.y * t };

            // Refract at right face (glass → air), normal toward glass = inward
            const r2 = this._refract2D(r1.x, r1.y, -rn.x, -rn.y, n);
            if (!r2) continue;

            const [cRed, cG, cB] = this._wavelengthToRGB(nm);
            const col = `rgb(${cRed},${cG},${cB})`;

            // Internal ray
            ctx.strokeStyle = col;
            ctx.globalAlpha = 0.22;
            ctx.lineWidth = 0.7;
            ctx.beginPath(); ctx.moveTo(hit.x, hit.y); ctx.lineTo(h2.x, h2.y); ctx.stroke();

            // Exit ray
            ctx.globalAlpha = 0.75;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(h2.x, h2.y);
            ctx.lineTo(h2.x + r2.x * W, h2.y + r2.y * W);
            ctx.stroke();
            ctx.globalAlpha = 1;

            // Screen dot
            if (Math.abs(r2.x) > 0.001) {
                const ts = (scrX - h2.x) / r2.x;
                if (ts > 0) {
                    const sy = h2.y + r2.y * ts;
                    if (sy > 0 && sy < H) {
                        pts.push({ nm, sy, col });
                        ctx.fillStyle = col;
                        ctx.fillRect(scrX, sy - 1.5, 16, 3);
                    }
                }
            }
        }

        // No spectrum path → show hint
        if (pts.length < 3) {
            ctx.fillStyle = 'rgba(244,63,94,0.6)';
            ctx.font = '17px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.fillText('全反射 — 请减小入射角或顶角', W / 2, H / 2);
        }

        // Apex angle arc
        const aR = 18;
        const a1 = Math.atan2(bl.y - apex.y, bl.x - apex.x);
        const a2 = Math.atan2(br.y - apex.y, br.x - apex.x);
        ctx.strokeStyle = 'rgba(56,189,248,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(apex.x, apex.y, aR, a2, a1); ctx.stroke();
        ctx.fillStyle = 'rgba(56,189,248,0.5)';
        ctx.font = '15px ' + CF.mono;
        ctx.textAlign = 'center';
        const amid = (a1 + a2) / 2;
        ctx.fillText(`${this.prismApex}°`, apex.x + 26 * Math.cos(amid), apex.y + 26 * Math.sin(amid));

        // Spectrum labels
        if (pts.length > 4) {
            ctx.font = '15px ' + CF.mono;
            ctx.textAlign = 'left';
            const vio = pts[0], red = pts[pts.length - 1];
            ctx.fillStyle = vio.col;
            ctx.fillText('紫 380nm', scrX + 20, vio.sy + 4);
            ctx.fillStyle = red.col;
            ctx.fillText('红 750nm', scrX + 20, red.sy + 4);
        }

        // Screen label
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '15px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('光屏', scrX + 8, H - 8);

        // Prism label
        const bm = { x: (bl.x + br.x) / 2, y: (bl.y + br.y) / 2 };
        ctx.fillStyle = 'rgba(56,189,248,0.4)';
        ctx.font = '16px ' + CF.sans;
        ctx.fillText('棱镜', bm.x, bm.y + 18);

        // Info panel
        const info = document.getElementById('optics-prism-info');
        if (info) {
            const nR = this._cauchyN(700).toFixed(4);
            const nV = this._cauchyN(400).toFixed(4);
            const matName = this.prismMaterial === 'crown' ? '冕牌玻璃' : '火石玻璃';
            info.innerHTML = `${matName} | n<sub>红700</sub>=${nR}  n<sub>紫400</sub>=${nV}  Δn=${(parseFloat(nV) - parseFloat(nR)).toFixed(4)} | Cauchy: n(λ) = A + B/λ²`;
        }
    },

    // ═══════════════════════════════════════════
    // 衍射光栅
    // ═══════════════════════════════════════════
    drawGrating() {
        const { ctx, W, H } = this;
        const N = this.gratingN;
        const d = this.gratingD;
        const lambda = this.gratingWavelength;
        const isWhite = this.gratingWhite;

        const gX = W * 0.28;   // grating position
        const sX = W * 0.78;   // screen position
        const cy = H / 2;
        const L = sX - gX;

        ctx.fillStyle = '#0a0f18';
        ctx.fillRect(0, 0, W, H);

        // --- Grating visual ---
        const totalSpan = Math.min((N - 1) * 3.5, H * 0.7);
        const visualN = Math.min(N, Math.floor(totalSpan / 3) + 1);
        const vStep = visualN > 1 ? totalSpan / (visualN - 1) : 0;

        ctx.fillStyle = 'rgba(100,116,139,0.5)';
        ctx.fillRect(gX - 3, 0, 6, H);
        for (let i = 0; i < visualN; i++) {
            const y = cy - totalSpan / 2 + i * vStep;
            ctx.fillStyle = '#0a0f18';
            ctx.fillRect(gX - 3, y - 1.5, 6, 3);
            ctx.fillStyle = 'rgba(251,191,36,0.25)';
            ctx.fillRect(gX - 2, y - 1, 4, 2);
        }

        // Incoming plane waves
        if (!isWhite) {
            ctx.strokeStyle = 'rgba(56,189,248,0.10)';
            ctx.lineWidth = 1;
            for (let x = lambda; x < gX; x += lambda) {
                ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
            }
        } else {
            const grad = ctx.createLinearGradient(0, 0, gX, 0);
            grad.addColorStop(0, 'rgba(255,255,255,0)');
            grad.addColorStop(0.8, 'rgba(255,255,255,0.04)');
            grad.addColorStop(1, 'rgba(255,255,255,0.08)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, gX - 4, H);
        }

        // --- Screen ---
        ctx.fillStyle = 'rgba(71,85,105,0.2)';
        ctx.fillRect(sX - 1, 0, 2, H);

        if (isWhite) {
            // White light: sum RGB per pixel
            const baseScale = lambda / 550;
            for (let y = 0; y < H; y++) {
                const yOff = y - cy;
                const sinTh = yOff / Math.sqrt(L * L + yOff * yOff);
                let rS = 0, gS = 0, bS = 0;
                for (let nm = 400; nm <= 700; nm += 10) {
                    const lp = nm * baseScale;
                    const beta = Math.PI * d * sinTh / lp;
                    let I_n;
                    if (Math.abs(Math.sin(beta)) < 1e-8) {
                        I_n = 1;
                    } else {
                        const r = Math.sin(N * beta) / (N * Math.sin(beta));
                        I_n = r * r;
                    }
                    const [rv, gv, bv] = this._wavelengthToRGB(nm);
                    rS += rv * I_n; gS += gv * I_n; bS += bv * I_n;
                }
                const sc = 0.035;
                const pr = Math.min(255, Math.round(rS * sc));
                const pg = Math.min(255, Math.round(gS * sc));
                const pb = Math.min(255, Math.round(bS * sc));
                if (pr + pg + pb > 5) {
                    ctx.fillStyle = `rgb(${pr},${pg},${pb})`;
                    ctx.fillRect(sX, y, 14, 1);
                }
            }
        } else {
            // Monochromatic: cyan pattern + intensity curve
            const iData = new Float32Array(H);
            for (let y = 0; y < H; y++) {
                const yOff = y - cy;
                const sinTh = yOff / Math.sqrt(L * L + yOff * yOff);
                const beta = Math.PI * d * sinTh / lambda;
                if (Math.abs(Math.sin(beta)) < 1e-8) {
                    iData[y] = 1;
                } else {
                    const r = Math.sin(N * beta) / (N * Math.sin(beta));
                    iData[y] = r * r;
                }
                const a = 0.05 + iData[y] * 0.85;
                const bw = 3 + iData[y] * 14;
                ctx.fillStyle = `rgba(56,189,248,${a})`;
                ctx.fillRect(sX, y, bw, 1);
            }

            // Intensity curve
            const pX = sX + 22;
            const pW = W - pX - 40;
            if (pW > 30) {
                ctx.strokeStyle = 'rgba(56,189,248,0.45)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                for (let y = 0; y < H; y++) {
                    const x = pX + iData[y] * pW;
                    if (y === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                }
                ctx.stroke();
            }

            // Order labels: d sinθ = mλ
            ctx.font = '14px ' + CF.mono;
            ctx.textAlign = 'left';
            ctx.fillStyle = 'rgba(251,191,36,0.6)';
            for (let m = 0; m <= 8; m++) {
                const sinTh = m * lambda / d;
                if (Math.abs(sinTh) >= 1) break;
                const th = Math.asin(sinTh);
                const yP = cy + L * Math.tan(th);
                const yN = cy - L * Math.tan(th);
                const lx = pW > 30 ? pX + pW + 3 : sX + 18;
                if (yP > 5 && yP < H - 5) ctx.fillText(`m=${m}`, lx, yP + 3);
                if (m > 0 && yN > 5 && yN < H - 5) ctx.fillText(`m=−${m}`, lx, yN + 3);
            }
        }

        // Labels
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '15px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText(`N = ${N}`, gX, H - 8);
        ctx.fillText('光屏', sX + 8, H - 8);
        ctx.fillText(`d = ${d}px`, gX, 14);
        if (!isWhite) ctx.fillText(`λ = ${lambda}px`, gX + 55, 14);

        // Equation
        ctx.fillStyle = 'rgba(56,189,248,0.45)';
        ctx.font = '16px ' + CF.mono;
        ctx.fillText('d sinθ = mλ', W * 0.53, H - 8);

        // Info
        const info = document.getElementById('optics-grating-info');
        if (info) {
            if (isWhite) {
                info.innerHTML = `${N} 缝光栅 + 白光 | 各级次按波长展成彩色光谱，中央极大为白色`;
            } else {
                const mMax = Math.floor(d / lambda);
                info.innerHTML = `d sinθ = mλ | m<sub>max</sub> = ${mMax} | N = ${N} → 主极大强度 ∝ N² | 缝数越多峰越尖锐`;
            }
        }
    },

    // ═══════════════════════════════════════════
    // 偏振与马吕斯定律
    // ═══════════════════════════════════════════
    drawPolarization() {
        const { ctx, W, H } = this;
        const cy = H * 0.42;
        const nPol = this.polarizerCount;
        const ang = this.polarizerAngles;

        // Layout
        const srcX = W * 0.08, endX = W * 0.88;
        const polX = [];
        for (let i = 0; i < nPol; i++) polX.push(srcX + (endX - srcX) * (i + 1) / (nPol + 1));

        // Intensities at each stage
        const stageI = [1.0];       // before P1: unpolarized
        const stagePol = [null];    // null = unpolarized
        stageI.push(0.5);
        stagePol.push(ang[0]);
        for (let i = 1; i < nPol; i++) {
            const delta = (ang[i] - stagePol[stagePol.length - 1]) * Math.PI / 180;
            stageI.push(stageI[stageI.length - 1] * Math.cos(delta) ** 2);
            stagePol.push(ang[i]);
        }

        // x-boundaries for beam segments
        const segX = [srcX + 20];
        polX.forEach(x => segX.push(x));
        segX.push(endX);

        // --- Source ---
        ctx.fillStyle = 'rgba(251,191,36,0.12)';
        ctx.beginPath(); ctx.arc(srcX, cy, 16, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(251,191,36,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(srcX, cy, 16, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '15px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('光源', srcX, cy + 30);

        // --- Beams + E-field ---
        for (let s = 0; s < segX.length - 1; s++) {
            const x1 = segX[s] + (s === 0 ? 0 : 12);
            const x2 = segX[s + 1] - (s < segX.length - 2 ? 12 : 0);
            const inten = stageI[s];
            if (inten < 0.0005) continue;
            const bw = 2 + Math.sqrt(inten) * 5;
            const ba = 0.12 + inten * 0.55;
            ctx.strokeStyle = `rgba(251,191,36,${ba})`;
            ctx.lineWidth = bw;
            ctx.beginPath(); ctx.moveTo(x1, cy); ctx.lineTo(x2, cy); ctx.stroke();

            // E-field arrows
            const pol = stagePol[s];
            const amp = 8 + Math.sqrt(inten) * 11;
            if (pol === null) {
                ctx.strokeStyle = 'rgba(251,191,36,0.15)';
                ctx.lineWidth = 1;
                for (let x = x1 + 8; x < x2 - 4; x += 11) {
                    const a = (x * 2.3999) % Math.PI;
                    ctx.beginPath();
                    ctx.moveTo(x - amp * Math.sin(a), cy - amp * Math.cos(a));
                    ctx.lineTo(x + amp * Math.sin(a), cy + amp * Math.cos(a));
                    ctx.stroke();
                }
            } else {
                const ar = pol * Math.PI / 180;
                ctx.strokeStyle = `rgba(56,189,248,${0.15 + inten * 0.3})`;
                ctx.lineWidth = 1.2;
                for (let x = x1 + 8; x < x2 - 4; x += 13) {
                    ctx.beginPath();
                    ctx.moveTo(x - amp * Math.sin(ar), cy - amp * Math.cos(ar));
                    ctx.lineTo(x + amp * Math.sin(ar), cy + amp * Math.cos(ar));
                    ctx.stroke();
                }
            }
            // Intensity above midpoint
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.font = '14px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillText(`${(inten * 100).toFixed(0)}%`, (x1 + x2) / 2, cy - amp - 6);
        }

        // --- Polarizer plates ---
        const plateH = H * 0.32;
        for (let i = 0; i < nPol; i++) {
            const x = polX[i];
            const ar = ang[i] * Math.PI / 180;
            ctx.fillStyle = 'rgba(100,116,139,0.12)';
            ctx.strokeStyle = 'rgba(148,163,184,0.35)';
            ctx.lineWidth = 1.5;
            ctx.fillRect(x - 5, cy - plateH / 2, 10, plateH);
            ctx.strokeRect(x - 5, cy - plateH / 2, 10, plateH);
            // Transmission axis
            const axL = plateH * 0.4;
            ctx.strokeStyle = 'rgba(56,189,248,0.65)';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(x - axL * Math.sin(ar), cy - axL * Math.cos(ar));
            ctx.lineTo(x + axL * Math.sin(ar), cy + axL * Math.cos(ar));
            ctx.stroke();
            // Angle label
            ctx.fillStyle = 'rgba(56,189,248,0.55)';
            ctx.font = '15px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillText(`${ang[i]}°`, x, cy + plateH / 2 + 14);
            // Name
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.font = '15px ' + CF.sans;
            const nm = i === 0 ? '偏振片' : (nPol === 3 && i === 1 ? '中间片' : '检偏器');
            ctx.fillText(nm, x, cy - plateH / 2 - 8);
        }

        // --- Intensity meter ---
        const finalI = stageI[stageI.length - 1];
        const mW = 12, mH = H * 0.4, mX = endX + 4;
        ctx.fillStyle = 'rgba(30,41,59,0.4)';
        ctx.fillRect(mX, cy - mH / 2, mW, mH);
        ctx.strokeStyle = 'rgba(148,163,184,0.2)';
        ctx.lineWidth = 1;
        ctx.strokeRect(mX, cy - mH / 2, mW, mH);
        const fH = finalI * mH;
        ctx.fillStyle = 'rgba(251,191,36,0.55)';
        ctx.fillRect(mX, cy + mH / 2 - fH, mW, fH);
        ctx.fillStyle = 'rgba(251,191,36,0.7)';
        ctx.font = '15px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText(`${(finalI * 100).toFixed(1)}%`, mX + mW / 2, cy + mH / 2 + 14);
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '14px ' + CF.sans;
        ctx.fillText('强度', mX + mW / 2, cy - mH / 2 - 6);

        // Formula
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '16px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText('Malus: I = I₀ cos²θ', W / 2, H - 10);

        // Info
        const info = document.getElementById('optics-pol-info');
        if (info) {
            let text = `光源 → P₁(${ang[0]}°): I₀/2`;
            let prevP = ang[0];
            for (let i = 1; i < nPol; i++) {
                const d = ang[i] - prevP;
                const c2 = (Math.cos(d * Math.PI / 180) ** 2).toFixed(3);
                const label = (nPol === 3 && i === 1) ? '中间' : '检偏器';
                text += ` → ${label}(${ang[i]}°): ×cos²(${d}°)=${c2}`;
                prevP = ang[i];
            }
            text += ` → <strong style="color:#fbbf24">${(finalI * 100).toFixed(1)}%</strong>`;
            if (nPol === 3 && ang[0] === 0 && ang[2] === 90) {
                text += ' <span style="color:#22c55e">✦ 偏振悖论</span>';
            }
            info.innerHTML = text;
        }
    },

    // ═══════════════════════════════════════════
    // 辅助函数
    // ═══════════════════════════════════════════
    _refract2D(dx, dy, nx, ny, ratio) {
        // Snell 2D: n must point toward the ray's incoming side
        const cosI = -(dx * nx + dy * ny);
        if (cosI < 0) return null;
        const sin2T = ratio * ratio * (1 - cosI * cosI);
        if (sin2T > 1) return null;
        const cosT = Math.sqrt(1 - sin2T);
        return { x: ratio * dx + (ratio * cosI - cosT) * nx,
                 y: ratio * dy + (ratio * cosI - cosT) * ny };
    },

    _raySegIntersect(ox, oy, dx, dy, px1, py1, px2, py2) {
        const ex = px2 - px1, ey = py2 - py1;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-10) return null;
        const t = ((px1 - ox) * ey - (py1 - oy) * ex) / den;
        const u = ((px1 - ox) * dy - (py1 - oy) * dx) / den;
        if (t < 0.5 || u < 0.01 || u > 0.99) return null;
        return t;
    },

    _wavelengthToRGB(nm) {
        let r, g, b;
        if (nm < 380) nm = 380; if (nm > 780) nm = 780;
        if (nm < 440)      { r = -(nm - 440) / 60; g = 0; b = 1; }
        else if (nm < 490) { r = 0; g = (nm - 440) / 50; b = 1; }
        else if (nm < 510) { r = 0; g = 1; b = -(nm - 510) / 20; }
        else if (nm < 580) { r = (nm - 510) / 70; g = 1; b = 0; }
        else if (nm < 645) { r = 1; g = -(nm - 645) / 65; b = 0; }
        else               { r = 1; g = 0; b = 0; }
        let f = 1;
        if (nm < 420) f = 0.3 + 0.7 * (nm - 380) / 40;
        else if (nm > 700) f = 0.3 + 0.7 * (780 - nm) / 80;
        return [Math.round(255 * r * f), Math.round(255 * g * f), Math.round(255 * b * f)];
    },

    _cauchyN(nm) {
        if (this.prismMaterial === 'flint') return 1.610 + 10500 / (nm * nm);
        return 1.5220 + 4500 / (nm * nm);
    },

    _drawRayArrow(ctx, x, y, angle, color) {
        const hl = 7;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x + hl * Math.cos(angle), y + hl * Math.sin(angle));
        ctx.lineTo(x - hl * Math.cos(angle - 0.5), y - hl * Math.sin(angle - 0.5));
        ctx.lineTo(x - hl * Math.cos(angle + 0.5), y - hl * Math.sin(angle + 0.5));
        ctx.closePath(); ctx.fill();
    },

    /* ── education panel ── */
    updateInfo() {
        const el = document.getElementById('optics-info');
        if (!el) return;
        const labels = { lens:'透镜成像', doubleslit:'双缝干涉', refraction:'折射与全反射', prism:'棱镜色散', grating:'衡射光栅', polarization:'偏振' };
        const data = {
            lens: [
                ['透镜公式','1/f = 1/dₒ + 1/dᵢ，物距大于 2f 时成缩小实像，f < d < 2f 时成放大实像'],
                ['实像 / 虚像','实像由实际光线会聚（倒立），虚像由光线反向延长线交于同侧（正立）'],
                ['放大率','m = dᵢ/dₒ = 像高/物高，|m| > 1 放大，|m| < 1 缩小']
            ],
            doubleslit: [
                ['干涉条件','两列相干波叠加，等光程差处明纹，半波长奇数倍处暗纹'],
                ['条纹间距','Δy = λL/d，波长越长/缝距越小/屏距越大→条纹越宽'],
                ['白光干涉','各色光条纹间距不同，中央明纹为白色，两侧彩色']
            ],
            refraction: [
                ['Snell 定律','n₁sinθ₁ = n₂sinθ₂，光从光疏到光密介质时折射角 < 入射角'],
                ['全反射','光从光密到光疏介质，入射角 > 临界角 θc = arcsin(n₂/n₁) 时发生'],
                ['应用','光纤通信利用全反射，水中看物体偶变浅是折射现象']
            ],
            prism: [
                ['色散原理','不同波长的光折射率不同 (Cauchy 方程)，紫光偏转最大、红光最小'],
                ['最小偏向角','当光线对称通过棱镜时偏向角最小，可用于测量折射率'],
                ['连续光谱','白光经棱镜分解为红橙黄绿青蓝紫连续光谱']
            ],
            grating: [
                ['光栅方程','d sinθ = mλ，缝数越多峰越尖锐，分辨率越高'],
                ['各级次谱','每个级次 m 中白光展为彩色光谱，级次越高色散越大'],
                ['应用','光谱分析、测量波长、X 射线衡射']
            ],
            polarization: [
                ['Malus 定律','I = I₀cos²θ，偏振光通过检偶器，透射强度与夹角余弦平方成正比'],
                ['偏振片','将自然光变为线偏振光，两片正交时完全遮光'],
                ['偏振悖论','两正交偏振片间插入 45° 中间片反而透光 (I = I₀/8)']
            ]
        };
        const items = data[this.mode] || data.lens;
        let h = `<div class="ac-hd"><span class="ac-tag">${labels[this.mode]}</span>光学知识点</div>`;
        items.forEach(([k, v]) => h += `<div class="ac-row"><span class="ac-key">${k}</span>${v}</div>`);
        h += `<div class="ac-note">💡 人教版选择性必修1：切换上方模式按钮探索几何光学与波动光学的不同现象</div>`;
        el.innerHTML = h;
    }
};

function initOptics() {
    OpticsLab.init();
}
