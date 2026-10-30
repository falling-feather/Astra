/* ═══════════════════════════════════════════════════
   Universal Gravitation – Orbital Simulation
   ═══════════════════════════════════════════════════ */
const Gravitation = {
    _listeners: [],
    _on(el, evt, fn, opts) { el.addEventListener(evt, fn, opts); this._listeners.push({ el, evt, fn, opts }); },
    canvas: null, ctx: null, animId: null,
    paused: false,
    mode: 'orbit', // v4.6.0-α4: orbit | field | kepler | cosmic
    // central body
    centralMass: 500,
    centralR: 30,
    // satellites
    satellites: [],
    G: 0.8,
    trailLen: 200,
    showVectors: true,
    // v4.6.0-α4：开普勒模式实时统计
    _kepler: { areaSwept: 0, lastT: 0, period: 0, periodStart: 0, lastQuadrant: 0, semiMajor: 0, semiMinor: 0, perihelion: 0, aphelion: 0 },
    // v4.6.0-α4：三宇宙速度模式（视觉化常量；实际物理仍按 G/M 缩放）
    _cosmic: { launched: false },

    init() {
        this.canvas = document.getElementById('gravitation-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.paused = false;
        this._resize();
        this._on(window, 'resize', () => this._resize());
        this._buildControls();
        this._initSatellites();
        this.updateInfo();
        this._loop();
    },
    destroy() {
        if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
        this._listeners.forEach(l => l.el.removeEventListener(l.evt, l.fn, l.opts));
        this._listeners.length = 0;
        const c = document.getElementById('gravitation-controls');
        if (c) c.innerHTML = '';
    },
    _resize() {
        if (window.PhysicsZoom && window.PhysicsZoom.movedCanvas === this.canvas) return;
        const p = this.canvas.parentElement;
        const dpr = window.devicePixelRatio || 1;
        const w = p.clientWidth;
        const h = Math.min(Math.max(w * 0.56, 360), 560);
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w;
        this.H = h;
        this.cx = this.W / 2;
        this.cy = this.H / 2;
    },
    _buildControls() {
        const ctrl = document.getElementById('gravitation-controls');
        if (!ctrl) return;
        ctrl.innerHTML = '';
        // mode buttons
        const modes = [
            { id: 'orbit',  label: '\u8f68\u9053\u6a21\u62df' },
            { id: 'field',  label: '\u5f15\u529b\u573a' },
            { id: 'kepler', label: '\u2728 \u5f00\u666e\u52d2' },     // v4.6.0-α4
            { id: 'cosmic', label: '\ud83d\ude80 \u4e09\u5b87\u5b99\u901f\u5ea6' } // v4.6.0-α4
        ];
        const btnWrap = document.createElement('div');
        btnWrap.className = 'grav-mode-btns';
        modes.forEach(m => {
            const b = document.createElement('button');
            b.className = 'grav-mode-btn' + (m.id === this.mode ? ' active' : '');
            b.textContent = m.label;
            this._on(b, 'click', () => {
                this.mode = m.id;
                btnWrap.querySelectorAll('.grav-mode-btn').forEach(x => x.classList.remove('active'));
                b.classList.add('active');
                // v4.6.0-α4：切换到 kepler/cosmic 模式时初始化对应卫星
                if (m.id === 'kepler') this._initKepler();
                else if (m.id === 'cosmic') this._initCosmic();
                else if (m.id === 'orbit') this._initSatellites();
                this.updateInfo();
            });
            btnWrap.appendChild(b);
        });
        ctrl.appendChild(btnWrap);
        // mass slider
        const wrap = document.createElement('label');
        wrap.className = 'grav-param';
        wrap.innerHTML = '<span>\u4e2d\u5fc3\u8d28\u91cf M=</span>';
        const inp = document.createElement('input');
        inp.type = 'range'; inp.min = 100; inp.max = 1500; inp.step = 50; inp.value = this.centralMass;
        const val = document.createElement('span');
        val.textContent = this.centralMass;
        this._on(inp, 'input', () => {
            this.centralMass = parseFloat(inp.value);
            val.textContent = inp.value;
        });
        wrap.appendChild(inp);
        wrap.appendChild(val);
        ctrl.appendChild(wrap);
        // vector toggle
        const vb = document.createElement('button');
        vb.className = 'grav-mode-btn active';
        vb.textContent = '\u529b\u5411\u91cf';
        this._on(vb, 'click', () => {
            this.showVectors = !this.showVectors;
            vb.classList.toggle('active', this.showVectors);
        });
        ctrl.appendChild(vb);

        const pauseBtn = document.getElementById('grav-pause');
        if (pauseBtn) {
            pauseBtn.textContent = '暂停';
            this._on(pauseBtn, 'click', () => {
                this.paused = !this.paused;
                pauseBtn.textContent = this.paused ? '继续' : '暂停';
            });
        }

        const resetBtn = document.getElementById('grav-reset');
        if (resetBtn) {
            this._on(resetBtn, 'click', () => {
                this.paused = false;
                if (pauseBtn) pauseBtn.textContent = '暂停';
                // v4.6.0-α4：按当前 mode 分流重置
                if (this.mode === 'kepler') this._initKepler();
                else if (this.mode === 'cosmic') this._initCosmic();
                else this._initSatellites();
            });
        }
    },
    _initSatellites() {
        this.satellites = [];
        const orbits = [
            { dist: 100, speed: 2.2, color: 'rgba(100,180,255,0.8)', r: 6, name: '\u536b\u661f A' },
            { dist: 160, speed: 1.5, color: 'rgba(255,180,100,0.8)', r: 8, name: '\u536b\u661f B' },
            { dist: 230, speed: 1.0, color: 'rgba(100,255,180,0.8)', r: 5, name: '\u536b\u661f C' }
        ];
        orbits.forEach(o => {
            const angle = Math.random() * Math.PI * 2;
            this.satellites.push({
                x: this.cx + o.dist * Math.cos(angle),
                y: this.cy + o.dist * Math.sin(angle),
                vx: -o.speed * Math.sin(angle),
                vy: o.speed * Math.cos(angle),
                r: o.r,
                color: o.color,
                name: o.name,
                trail: []
            });
        });
    },

    /* ── v4.6.0-α4：开普勒模式（单椭圆 + 面积扫描 + T²/a³） ── */
    _initKepler() {
        this.satellites = [];
        // 在近日点（perihelion）以一定切向速度发射，使其运行椭圆轨道
        // 圆轨道速度 v_circ = sqrt(GM/r)；注入额外速度形成椭圆
        const r0 = 110;             // 近日点距离
        const vCirc = Math.sqrt(this.G * this.centralMass / r0);
        const vTan = vCirc * 1.18;   // 略大于圆速度 → 椭圆
        this.satellites.push({
            x: this.cx + r0,
            y: this.cy,
            vx: 0,
            vy: -vTan,
            r: 7,
            color: 'rgba(229,192,123,0.9)',
            name: '\u884c\u661f',
            trail: []
        });
        // reset kepler stats
        this._kepler = {
            areaSwept: 0, lastT: performance.now(), period: 0, periodStart: performance.now(),
            startAngle: 0, lastAngle: 0, totalAngle: 0,
            semiMajor: 0, semiMinor: 0, perihelion: r0, aphelion: 0,
            minR: r0, maxR: r0,
            quarterAreas: [0, 0, 0, 0],   // 四等份扫面积（验证第二定律）
            quarterStartAngle: 0
        };
    },

    /* ── v4.6.0-α4：三宇宙速度模式（同发三星，对比轨道形状） ── */
    _initCosmic() {
        this.satellites = [];
        const r0 = 100;
        const vCirc = Math.sqrt(this.G * this.centralMass / r0);     // v₁ 等价
        const vEsc  = Math.sqrt(2 * this.G * this.centralMass / r0); // v₂ 等价（√2·v₁）
        const tracks = [
            { v: vCirc * 1.0,  color: 'rgba(91,141,206,0.9)',  name: 'v\u2081 \u5706\u8f68\u9053',     symbol: '\u25CB', tag: '\u00177.9 km/s' },
            { v: vEsc  * 1.0,  color: 'rgba(229,192,123,0.9)', name: 'v\u2082 \u629b\u7269\u7ebf\u8f68\u9053', symbol: '\u2230', tag: '\u017711.2 km/s' },
            { v: vEsc  * 1.32, color: 'rgba(155,141,206,0.9)', name: 'v\u2083 \u53cc\u66f2\u7ebf\u8f68\u9053', symbol: '\u221E', tag: '\u017716.7 km/s' }
        ];
        tracks.forEach(t => {
            this.satellites.push({
                x: this.cx + r0,
                y: this.cy,
                vx: 0,
                vy: -t.v,
                r: 6,
                color: t.color,
                name: t.name,
                tag: t.tag,
                trail: []
            });
        });
        // 加大轨迹长度便于看到完整路径
        this._cosmicTrailLen = 600;
    },

    _stepPhysics() {
        if (this.paused) return;
        const G = this.G, M = this.centralMass;
        // v4.6.0-α4：kepler 模式使用更小步长以提升椭圆稳定性 + 累计面积/最大半径
        const isKepler = this.mode === 'kepler';
        const isCosmic = this.mode === 'cosmic';
        const trailMax = isCosmic ? (this._cosmicTrailLen || 600) : (isKepler ? 800 : this.trailLen);
        const subSteps = isKepler ? 3 : 1;
        this.satellites.forEach((s, idx) => {
            for (let st = 0; st < subSteps; st++) {
                const dx = this.cx - s.x;
                const dy = this.cy - s.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < this.centralR) return;
                const F = G * M / (dist * dist);
                const dt = 1 / subSteps;
                s.vx += F * dx / dist * dt;
                s.vy += F * dy / dist * dt;
                s.x += s.vx * dt;
                s.y += s.vy * dt;
            }
            s.trail.push({ x: s.x, y: s.y });
            if (s.trail.length > trailMax) s.trail.shift();

            // v4.6.0-α4：kepler 实时统计
            if (isKepler && idx === 0) {
                const dxR = s.x - this.cx, dyR = s.y - this.cy;
                const r = Math.sqrt(dxR * dxR + dyR * dyR);
                const k = this._kepler;
                if (r < k.minR) k.minR = r;
                if (r > k.maxR) k.maxR = r;
                k.perihelion = k.minR;
                k.aphelion = k.maxR;
                k.semiMajor = (k.minR + k.maxR) / 2;
                // 短半轴 b = sqrt(r_p · r_a)（开普勒椭圆几何）
                k.semiMinor = Math.sqrt(k.minR * k.maxR);
                // 面积速率：dA = 0.5 |r × v|，恒量
                k.areaRate = 0.5 * Math.abs(dxR * s.vy - dyR * s.vx);
                // 角度累计估算周期（绕一圈 = 2π）
                const ang = Math.atan2(dyR, dxR);
                if (k.lastAngle === 0) { k.lastAngle = ang; k.startAngle = ang; }
                let dAng = ang - k.lastAngle;
                if (dAng > Math.PI) dAng -= 2 * Math.PI;
                if (dAng < -Math.PI) dAng += 2 * Math.PI;
                k.totalAngle += Math.abs(dAng);
                k.lastAngle = ang;
                if (k.totalAngle >= 2 * Math.PI && k.period === 0) {
                    k.period = (performance.now() - k.periodStart) / 1000;
                }
            }
        });
    },
    _drawOrbit() {
        const ctx = this.ctx, W = this.W, H = this.H;
        this._stepPhysics();

        // starfield background
        if (!this._stars) {
            this._stars = [];
            for (let i = 0; i < 60; i++) {
                this._stars.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.5 + 0.5, a: Math.random() });
            }
        }
        this._stars.forEach(s => {
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,' + (s.a * 0.3) + ')';
            ctx.fill();
        });

        // central body (sun/planet)
        const grd = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, this.centralR);
        grd.addColorStop(0, 'rgba(255,200,50,0.9)');
        grd.addColorStop(0.7, 'rgba(255,150,30,0.7)');
        grd.addColorStop(1, 'rgba(255,100,0,0.2)');
        ctx.beginPath();
        ctx.arc(this.cx, this.cy, this.centralR, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();
        // glow
        ctx.beginPath();
        ctx.arc(this.cx, this.cy, this.centralR + 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,200,50,0.1)';
        ctx.fill();
        // label
        ctx.font = '16px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,200,50,0.8)';
        ctx.fillText('M = ' + this.centralMass, this.cx, this.cy + this.centralR + 18);

        // satellites
        this.satellites.forEach(s => {
            // trail
            if (s.trail.length > 1) {
                ctx.beginPath();
                s.trail.forEach((p, i) => {
                    if (i === 0) ctx.moveTo(p.x, p.y);
                    else ctx.lineTo(p.x, p.y);
                });
                ctx.strokeStyle = s.color.replace('0.8', '0.2');
                ctx.lineWidth = 1;
                ctx.stroke();
            }
            // body
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fillStyle = s.color;
            ctx.fill();
            // name
            ctx.font = '15px ' + CF.sans;
            ctx.fillStyle = s.color;
            ctx.fillText(s.name, s.x, s.y - s.r - 5);
            // force vector
            if (this.showVectors) {
                const dx = this.cx - s.x, dy = this.cy - s.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const F = this.G * this.centralMass / (dist * dist);
                const scale = F * 10;
                const ux = dx / dist, uy = dy / dist;
                ctx.beginPath();
                ctx.moveTo(s.x, s.y);
                ctx.lineTo(s.x + ux * scale, s.y + uy * scale);
                ctx.strokeStyle = 'rgba(255,100,100,0.6)';
                ctx.lineWidth = 2;
                ctx.stroke();
                // arrowhead
                const ax = s.x + ux * scale, ay = s.y + uy * scale;
                const angle = Math.atan2(uy, ux);
                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.lineTo(ax - 6 * Math.cos(angle - 0.4), ay - 6 * Math.sin(angle - 0.4));
                ctx.lineTo(ax - 6 * Math.cos(angle + 0.4), ay - 6 * Math.sin(angle + 0.4));
                ctx.closePath();
                ctx.fillStyle = 'rgba(255,100,100,0.6)';
                ctx.fill();
                // velocity vector
                const vScale = 8;
                ctx.beginPath();
                ctx.moveTo(s.x, s.y);
                ctx.lineTo(s.x + s.vx * vScale, s.y + s.vy * vScale);
                ctx.strokeStyle = 'rgba(100,200,100,0.6)';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        });

        // formula
        ctx.font = 'bold 18px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(139,111,192,0.9)';
        ctx.fillText('F = GMm/r\u00B2', 14, 25);
        ctx.font = '16px ' + CF.sans;
        ctx.fillStyle = 'rgba(200,200,200,0.5)';
        ctx.fillText('\u7EA2: \u5F15\u529B  \u7EFF: \u901F\u5EA6', 14, 45);
    },
    _drawField() {
        const ctx = this.ctx, W = this.W, H = this.H;
        const step = 35;
        const M = this.centralMass;
        ctx.font = 'bold 18px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(139,111,192,0.9)';
        ctx.fillText('\u5F15\u529B\u573A\u5206\u5E03 (g = GM/r\u00B2)', W / 2, 25);

        // central body
        ctx.beginPath();
        ctx.arc(this.cx, this.cy, this.centralR * 0.8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,200,50,0.7)';
        ctx.fill();

        // field arrows
        for (let x = step; x < W; x += step) {
            for (let y = step; y < H; y += step) {
                const dx = this.cx - x, dy = this.cy - y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < this.centralR * 1.2) continue;
                const g = this.G * M / (dist * dist);
                const len = Math.min(g * 8, step * 0.6);
                const ux = dx / dist, uy = dy / dist;
                const alpha = Math.min(0.7, g * 2);
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.lineTo(x + ux * len, y + uy * len);
                ctx.strokeStyle = 'rgba(139,111,192,' + alpha + ')';
                ctx.lineWidth = 1.5;
                ctx.stroke();
                // small arrowhead
                const ax = x + ux * len, ay = y + uy * len;
                const angle = Math.atan2(uy, ux);
                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.lineTo(ax - 4 * Math.cos(angle - 0.5), ay - 4 * Math.sin(angle - 0.5));
                ctx.lineTo(ax - 4 * Math.cos(angle + 0.5), ay - 4 * Math.sin(angle + 0.5));
                ctx.closePath();
                ctx.fillStyle = 'rgba(139,111,192,' + alpha + ')';
                ctx.fill();
            }
        }
        // equipotential circles
        ctx.setLineDash([4, 6]);
        [80, 140, 210].forEach((r, i) => {
            ctx.beginPath();
            ctx.arc(this.cx, this.cy, r, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(139,111,192,' + (0.3 - i * 0.08) + ')';
            ctx.lineWidth = 1;
            ctx.stroke();
        });
        ctx.setLineDash([]);
    },
    _loop() {
        this.ctx.clearRect(0, 0, this.W, this.H);
        if (this.mode === 'orbit') {
            this._drawOrbit();
        } else if (this.mode === 'field') {
            this._drawField();
        } else if (this.mode === 'kepler') {
            this._drawKepler();
        } else if (this.mode === 'cosmic') {
            this._drawCosmic();
        }
        this.animId = requestAnimationFrame(() => this._loop());
    },

    /* ── v4.6.0-α4：开普勒模式 ── */
    _drawKepler() {
        const ctx = this.ctx;
        this._stepPhysics();
        // 中心恒星
        const grd = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, this.centralR);
        grd.addColorStop(0, 'rgba(255,200,50,0.9)');
        grd.addColorStop(0.7, 'rgba(255,150,30,0.7)');
        grd.addColorStop(1, 'rgba(255,100,0,0.2)');
        ctx.beginPath(); ctx.arc(this.cx, this.cy, this.centralR, 0, Math.PI * 2); ctx.fillStyle = grd; ctx.fill();
        ctx.font = '13px ' + CF.sans; ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,200,50,0.85)';
        ctx.fillText('\u2605 \u6052\u661f', this.cx, this.cy + this.centralR + 14);

        // 椭圆轨道描点
        const sat = this.satellites[0];
        if (!sat) return;
        if (sat.trail.length > 1) {
            ctx.beginPath();
            sat.trail.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
            ctx.strokeStyle = 'rgba(229,192,123,0.45)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
        // 第二定律：扇形（从恒星到当前 + 恒星到 ~30 帧前位置）
        const tail = sat.trail[Math.max(0, sat.trail.length - 30)];
        if (tail) {
            ctx.beginPath();
            ctx.moveTo(this.cx, this.cy);
            ctx.lineTo(tail.x, tail.y);
            // 沿轨迹画弧（折线近似）
            for (let i = sat.trail.length - 30; i < sat.trail.length; i++) {
                if (i >= 0 && sat.trail[i]) ctx.lineTo(sat.trail[i].x, sat.trail[i].y);
            }
            ctx.lineTo(this.cx, this.cy);
            ctx.closePath();
            ctx.fillStyle = 'rgba(91,141,206,0.22)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(91,141,206,0.5)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // 标记近日点 / 远日点
        const k = this._kepler;
        if (k.minR < k.maxR) {
            // 近日点（猜测在最右开始位置附近）— 用 trail 中半径极小处
            let pIdx = -1, pMin = 1e9, aIdx = -1, aMax = 0;
            for (let i = 0; i < sat.trail.length; i++) {
                const dx = sat.trail[i].x - this.cx, dy = sat.trail[i].y - this.cy;
                const r = Math.sqrt(dx * dx + dy * dy);
                if (r < pMin) { pMin = r; pIdx = i; }
                if (r > aMax) { aMax = r; aIdx = i; }
            }
            const drawMark = (idx, color, label) => {
                if (idx < 0) return;
                const p = sat.trail[idx];
                ctx.save();
                ctx.fillStyle = color;
                ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
                ctx.font = '11px ' + CF.sans;
                ctx.textAlign = 'center';
                ctx.fillText(label, p.x, p.y - 8);
                ctx.restore();
            };
            drawMark(pIdx, 'rgba(231,76,60,0.85)', '\u8fd1\u65e5\u70b9');
            drawMark(aIdx, 'rgba(91,141,206,0.85)', '\u8fdc\u65e5\u70b9');
        }

        // 行星
        ctx.beginPath();
        ctx.arc(sat.x, sat.y, sat.r, 0, Math.PI * 2);
        ctx.fillStyle = sat.color; ctx.fill();
        ctx.font = '13px ' + CF.sans;
        ctx.fillStyle = sat.color;
        ctx.fillText(sat.name, sat.x, sat.y - sat.r - 5);

        // 信息面板（左上）
        ctx.save();
        ctx.font = 'bold 16px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(229,192,123,0.95)';
        ctx.fillText('\u2728 \u5f00\u666e\u52d2\u4e09\u5b9a\u5f8b', 14, 26);
        ctx.font = '12px ' + CF.mono;
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        const lines = [
            `\u2160 \u8f68\u9053=\u692d\u5706 \u00b7 \u6052\u661f\u5728\u4e00\u7126\u70b9`,
            `\u2161 \u9762\u79ef\u901f\u7387 dA/dt = ${(k.areaRate || 0).toFixed(1)} (\u606e\u91cf)`,
            `\u2162 T\u00b2 / a\u00b3 = 4\u03c0\u00b2/(GM)`,
            ``,
            `\u8fd1\u65e5\u8ddd\u79bb r\u209a = ${k.perihelion.toFixed(1)}`,
            `\u8fdc\u65e5\u8ddd\u79bb r\u2090 = ${k.aphelion.toFixed(1)}`,
            `\u534a\u957f\u8f74 a = ${k.semiMajor.toFixed(1)}`,
            `\u534a\u77ed\u8f74 b = ${k.semiMinor.toFixed(1)}`,
            `\u79bb\u5fc3\u7387 e = ${k.semiMajor > 0 ? ((k.aphelion - k.perihelion) / (k.aphelion + k.perihelion)).toFixed(3) : '--'}`,
            `\u5468\u671f T \u2248 ${k.period > 0 ? k.period.toFixed(2) + 's' : '\u6d4b\u91cf\u4e2d...'}`
        ];
        lines.forEach((ln, i) => ctx.fillText(ln, 14, 50 + i * 16));
        if (k.period > 0 && k.semiMajor > 0) {
            const ratio = (k.period * k.period) / Math.pow(k.semiMajor / 100, 3);  // 缩放无量纲对比
            ctx.fillStyle = 'rgba(91,141,206,0.95)';
            ctx.fillText(`T\u00b2/a\u00b3 \u2248 ${ratio.toFixed(2)} (\u5e38\u91cf)`, 14, 50 + lines.length * 16);
        }
        ctx.restore();
    },

    /* ── v4.6.0-α4：三宇宙速度模式 ── */
    _drawCosmic() {
        const ctx = this.ctx;
        this._stepPhysics();

        // 星空
        if (!this._cosmicStars) {
            this._cosmicStars = [];
            for (let i = 0; i < 80; i++) {
                this._cosmicStars.push({ x: Math.random() * this.W, y: Math.random() * this.H, r: Math.random() * 1.2 + 0.3, a: Math.random() });
            }
        }
        this._cosmicStars.forEach(s => {
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,' + (s.a * 0.25) + ')';
            ctx.fill();
        });

        // 地球（中心）
        const grd = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, this.centralR);
        grd.addColorStop(0, 'rgba(91,141,206,0.95)');
        grd.addColorStop(0.7, 'rgba(60,120,180,0.7)');
        grd.addColorStop(1, 'rgba(40,80,140,0.2)');
        ctx.beginPath(); ctx.arc(this.cx, this.cy, this.centralR, 0, Math.PI * 2); ctx.fillStyle = grd; ctx.fill();
        ctx.font = '13px ' + CF.sans; ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(91,141,206,0.85)';
        ctx.fillText('\ud83c\udf0d \u5730\u7403', this.cx, this.cy + this.centralR + 14);

        // 三卫星 + 轨迹
        this.satellites.forEach((s) => {
            // 轨迹
            if (s.trail.length > 1) {
                ctx.beginPath();
                s.trail.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
                ctx.strokeStyle = s.color.replace('0.9', '0.55');
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
            // 球
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fillStyle = s.color; ctx.fill();
        });

        // 标题与图例
        ctx.save();
        ctx.font = 'bold 16px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(155,141,206,0.95)';
        ctx.fillText('\ud83d\ude80 \u4e09\u4e2a\u5b87\u5b99\u901f\u5ea6 \u00b7 \u4e34\u754c\u8f68\u9053\u5bf9\u6bd4', 14, 26);
        ctx.font = '12px ' + CF.mono;
        const items = [
            { color: 'rgba(91,141,206,0.95)',  text: 'v\u2081 \u2248 7.9 km/s  \u2192 \u5706\u8f68\u9053\uff08\u73af\u7ed5\u8d77\u70b9\uff09' },
            { color: 'rgba(229,192,123,0.95)', text: 'v\u2082 \u2248 11.2 km/s \u2192 \u629b\u7269\u7ebf\uff08\u8131\u79bb\u5730\u7403\uff09' },
            { color: 'rgba(155,141,206,0.95)', text: 'v\u2083 \u2248 16.7 km/s \u2192 \u53cc\u66f2\u7ebf\uff08\u8131\u79bb\u592a\u9633\u7cfb\uff09' }
        ];
        items.forEach((it, i) => {
            ctx.fillStyle = it.color;
            ctx.beginPath(); ctx.arc(22, 50 + i * 20 - 4, 4, 0, Math.PI * 2); ctx.fill();
            ctx.fillText(it.text, 32, 50 + i * 20);
        });
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '11px ' + CF.sans;
        ctx.fillText('\u5168\u90e8\u4ece\u540c\u4e00\u70b9\u5212\u51fa \u00b7 \u53ea\u662f\u521d\u901f\u5927\u5c0f\u4e0d\u540c\uff0c\u8f68\u9053\u5b8c\u5168\u4e0d\u540c', 14, 50 + items.length * 20 + 8);
        ctx.restore();
    },

    /* ── education panel ── */
    updateInfo() {
        const el = document.getElementById('grav-info');
        if (!el) return;
        const M = this.centralMass;
        let h = '';
        if (this.mode === 'orbit') {
            h = `<div class="ac-hd"><span class="ac-tag">轨道</span>万有引力与天体运动</div>
<div class="ac-row"><span class="ac-key">万有引力定律</span>F = GMm/r² — 任意两质点间的引力，G = 6.674×10⁻¹¹ N·m²/kg²</div>
<div class="ac-row"><span class="ac-key ac-key--purple">轨道速度</span>GMm/r² = mv²/r → v = √(GM/r) — 轨道越高速度越小</div>
<div class="ac-row"><span class="ac-key ac-key--amber">开普勒第三定律</span>T²/r³ = 4π²/(GM) — 所有卫星的 T²/r³ 为同一常数</div>
<div class="ac-row"><span class="ac-key">第一宇宙速度</span>v₁ = √(gR) ≈ 7.9 km/s — 近地圆轨道最小发射速度，也是最大环绕速度</div>
<div class="ac-note">💡 人教版必修2：向心力由万有引力提供。近地卫星速度最大、周期最短。当前中心质量 M = ${M}，调节滑块观察轨道变化</div>`;
        } else if (this.mode === 'field') {
            h = `<div class="ac-hd"><span class="ac-tag ac-tag--amber">引力场</span>引力场强度分布</div>
<div class="ac-row"><span class="ac-key">场强定义</span>g = F/m = GM/r² — 距质心 r 处的引力场强度（单位质量受力）</div>
<div class="ac-row"><span class="ac-key ac-key--purple">等势面</span>虚线圆 = 引力势能相等的面，球对称质量的等势面为同心球面</div>
<div class="ac-row"><span class="ac-key ac-key--amber">场线特征</span>箭头指向质心，越靠近中心越密集 → 场强越大</div>
<div class="ac-row"><span class="ac-key">表面重力</span>g₀ = GM/R² — 天体表面的重力加速度，地球 g₀ ≈ 9.8 m/s²</div>
<div class="ac-note">💡 人教版必修2：引力场强度随距离平方反比递减。等势面与场线处处垂直。当前 M = ${M}</div>`;
        } else if (this.mode === 'kepler') {
            h = `<div class="ac-hd"><span class="ac-tag ac-tag--amber">开普勒</span>开普勒三定律可视化</div>
<div class="ac-row"><span class="ac-key ac-key--amber">第一定律</span>所有行星的轨道是<b>椭圆</b>，太阳位于其中一个<b>焦点</b>上 — 红点=近日点，蓝点=远日点</div>
<div class="ac-row"><span class="ac-key ac-key--purple">第二定律</span>行星与太阳的连线在相等时间内扫过<b>相等面积</b> → 蓝色扇形面积每帧近乎不变（dA/dt = 常量）</div>
<div class="ac-row"><span class="ac-key">第三定律</span>T² / a³ = 4π² / (GM) — 所有行星的 T²/a³ 为同一常数，与轨道大小无关</div>
<div class="ac-row"><span class="ac-key ac-key--purple">物理本质</span>第二定律 ⟺ 角动量守恒 L = m·v·r⊥ = 常量；近日点速度大、远日点速度小</div>
<div class="ac-note">💡 人教版必修2：开普勒由观测归纳得到，牛顿用万有引力定律给出严格证明。注意椭圆离心率 e 越大轨道越扁</div>`;
        } else if (this.mode === 'cosmic') {
            h = `<div class="ac-hd"><span class="ac-tag ac-tag--purple">宇宙速度</span>三个宇宙速度临界轨道</div>
<div class="ac-row"><span class="ac-key">第一宇宙速度</span>v₁ = √(GM/R) ≈ <b>7.9 km/s</b> — 近地圆轨道速度，也是发射人造卫星的最小速度</div>
<div class="ac-row"><span class="ac-key ac-key--amber">第二宇宙速度</span>v₂ = √(2GM/R) ≈ <b>11.2 km/s</b> = √2·v₁ — 脱离地球引力束缚（轨道变为<b>抛物线</b>）</div>
<div class="ac-row"><span class="ac-key ac-key--purple">第三宇宙速度</span>v₃ ≈ <b>16.7 km/s</b> — 在地球轨道处脱离<b>太阳系</b>（相对地球速度，轨道为<b>双曲线</b>）</div>
<div class="ac-row"><span class="ac-key">能量判据</span>E = ½mv² − GMm/r：E&lt;0 椭圆束缚态 / E=0 抛物线 / E&gt;0 双曲线脱离</div>
<div class="ac-note">💡 三颗卫星从同一点同方向发射，仅初速度不同 → 轨道分别为圆/抛物线/双曲线，直观呈现"能量决定轨道形状"</div>`;
        }
        el.innerHTML = h;
    }
};

function initGravitation() { Gravitation.init(); }
window.Gravitation = Gravitation;