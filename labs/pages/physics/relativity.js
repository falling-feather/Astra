// ===== 狭义相对论可视化引擎 (v3) =====
// 交互增强: 可拖拽时空事件 · Lorentz 变换模式 · 速度叠加 u 滑块
//           双生子旅行距离控制 · 全局坐标探针 · 双击重置事件

const RelativityDemo = {
    canvas: null,
    ctx: null,
    animId: null,
    running: true,
    paused: false,
    _resizeObs: null,
    _lastTime: 0,
    dt: 0,
    _stars: null,
    _listeners: [],

    // 速度参数 (v/c)
    beta: 0.0,
    gamma: 1.0,

    // 演示模式
    mode: 'time',

    // 动画时间
    t: 0,

    // 时钟
    restClockAngle: 0,
    moveClockAngle: 0,

    // 飞船
    shipX: 0,

    // ── 交互增强状态 ──
    // 时空图可拖拽事件点 [{x, ct}]，坐标单位为 "光年" / "年"
    stEvents: [],
    _stDrag: -1,       // 正在拖拽的事件索引，-1 = 无
    _stLayout: null,    // 上一帧时空图的布局缓存 {cx, cy, axLen}

    // Lorentz 变换模式
    lorentzEvents: [],  // [{x, ct}] S 系坐标
    _ltDrag: -1,
    _ltLayout: null,
    _ltAnimBeta: 0,     // 动画用的当前 beta（平滑过渡）

    // 速度叠加 u 控制
    velU: 0.5,          // 用户设定的 u/c

    // 双生子旅行距离
    twinDist: 1.0,      // 光年

    // 鼠标探针
    _mouse: { x: -1000, y: -1000, active: false },

    init() {
        this.canvas = document.getElementById('relativity-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this._listeners = [];

        this.stEvents = [];
        this._stDrag = -1;
        this.lorentzEvents = [
            { x: 0.5, ct: 0.8 },
            { x: -0.3, ct: 0.4 },
            { x: 0.7, ct: -0.5 }
        ];
        this._ltDrag = -1;
        this._ltAnimBeta = 0;
        this.velU = 0.5;
        this.twinDist = 1.0;
        this._mouse = { x: -1000, y: -1000, active: false };

        this.resizeCanvas();
        this.bindControls();
        this._injectExtraPanels();

        // ResizeObserver
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver(() => this.resizeCanvas());
            this._resizeObs.observe(this.canvas.parentElement);
        } else {
            this._on(window, 'resize', () => this.resizeCanvas());
        }

        this.updateGamma();
        this.updateInfo();
        this._syncPanelVisibility();
        this.start();
    },

    destroy() {
        if (this._resizeObs) {
            this._resizeObs.disconnect();
            this._resizeObs = null;
        }
        if (this.animId) {
            cancelAnimationFrame(this.animId);
            this.animId = null;
        }
        this.running = false;
        // 清除所有事件监听
        for (const { el, evt, fn } of this._listeners) {
            el.removeEventListener(evt, fn);
        }
        this._listeners = [];
    },

    /** 统一事件绑定，destroy 时自动清除 */
    _on(el, evt, fn) {
        el.addEventListener(evt, fn);
        this._listeners.push({ el, evt, fn });
    },

    togglePause() {
        this.paused = !this.paused;
        const btn = document.getElementById('rel-pause');
        if (btn) btn.textContent = this.paused ? '继续' : '暂停';
        if (!this.paused && this.running && !this.animId) {
            this.start();
        }
    },

    resizeCanvas() {
        if (!this.canvas) return;
        if (window.PhysicsZoom && window.PhysicsZoom.movedCanvas === this.canvas) return;
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const w = rect.width;
        // 优先使用 CSS 容器高度，避免按宽度推算出的高度大于 .relativity-canvas-wrap 导致底部被 overflow 裁切
        let h = rect.height;
        if (!Number.isFinite(h) || h < 2) {
            h = Math.min(Math.max(w * 0.62, 400), 640);
        }
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w;
        this.H = h;
    },

    bindControls() {
        const slider = document.getElementById('rel-velocity');
        const label = document.getElementById('rel-velocity-val');
        if (slider) {
            this._on(slider, 'input', () => {
                this.beta = parseFloat(slider.value);
                label.textContent = this.beta.toFixed(2) + 'c';
                this.updateGamma();
                this.updateInfo();
            });
        }

        document.querySelectorAll('.rel-mode-btn').forEach(btn => {
            this._on(btn, 'click', () => {
                document.querySelectorAll('.rel-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.mode = btn.dataset.mode;
                this.t = 0;
                this.restClockAngle = 0;
                this.moveClockAngle = 0;
                this.shipX = 0;
                this.updateInfo();
                this._syncPanelVisibility();
            });
        });

        const resetBtn = document.getElementById('rel-reset');
        if (resetBtn) {
            this._on(resetBtn, 'click', () => {
                this.t = 0;
                this.restClockAngle = 0;
                this.moveClockAngle = 0;
                this.shipX = 0;
                if (this.mode === 'spacetime') this.stEvents = [];
                if (this.mode === 'lorentz') {
                    this.lorentzEvents = [
                        { x: 0.5, ct: 0.8 },
                        { x: -0.3, ct: 0.4 },
                        { x: 0.7, ct: -0.5 }
                    ];
                }
            });
        }

        const pauseBtn = document.getElementById('rel-pause');
        if (pauseBtn) {
            this._on(pauseBtn, 'click', () => this.togglePause());
        }

        // ── Canvas 鼠标交互 ──
        this._on(this.canvas, 'mousemove', (e) => this._handleMouseMove(e));
        this._on(this.canvas, 'mousedown', (e) => this._handleMouseDown(e));
        this._on(this.canvas, 'mouseup', () => this._handleMouseUp());
        this._on(this.canvas, 'mouseleave', () => {
            this._mouse.active = false;
            this._stDrag = -1;
            this._ltDrag = -1;
        });
        this._on(this.canvas, 'dblclick', (e) => this._handleDblClick(e));

        // touch 支持
        this._on(this.canvas, 'touchstart', (e) => {
            e.preventDefault();
            const t = e.touches[0];
            this._handleMouseDown({ offsetX: t.clientX - this.canvas.getBoundingClientRect().left,
                                     offsetY: t.clientY - this.canvas.getBoundingClientRect().top });
        });
        this._on(this.canvas, 'touchmove', (e) => {
            e.preventDefault();
            const t = e.touches[0];
            this._handleMouseMove({ offsetX: t.clientX - this.canvas.getBoundingClientRect().left,
                                     offsetY: t.clientY - this.canvas.getBoundingClientRect().top });
        });
        this._on(this.canvas, 'touchend', () => this._handleMouseUp());
    },

    /** 注入额外控制面板（速度叠加 u 滑块、双生子距离、Lorentz 模式按钮） */
    _injectExtraPanels() {
        const modeBtns = document.querySelector('.rel-mode-btns');
        if (!modeBtns) return;

        // 添加 Lorentz 变换模式按钮
        if (!modeBtns.querySelector('[data-mode="lorentz"]')) {
            const ltBtn = document.createElement('button');
            ltBtn.className = 'rel-mode-btn';
            ltBtn.dataset.mode = 'lorentz';
            ltBtn.textContent = 'Lorentz 变换';
            modeBtns.appendChild(ltBtn);
            this._on(ltBtn, 'click', () => {
                document.querySelectorAll('.rel-mode-btn').forEach(b => b.classList.remove('active'));
                ltBtn.classList.add('active');
                this.mode = 'lorentz';
                this.t = 0;
                this.updateInfo();
                this._syncPanelVisibility();
            });
        }

        // 速度叠加 u 滑块面板
        const velRow = document.querySelector('.rel-velocity-row');
        if (velRow && !document.getElementById('rel-vel-u-panel')) {
            const panel = document.createElement('div');
            panel.id = 'rel-vel-u-panel';
            panel.className = 'rel-extra-panel';
            panel.innerHTML = `
                <label>物体速度 u：</label>
                <input type="range" id="rel-vel-u" min="0" max="0.99" step="0.01" value="0.50">
                <span class="rel-val" id="rel-vel-u-val">0.50c</span>
            `;
            velRow.parentElement.insertBefore(panel, velRow.nextSibling);
            const uSlider = document.getElementById('rel-vel-u');
            const uLabel = document.getElementById('rel-vel-u-val');
            this._on(uSlider, 'input', () => {
                this.velU = parseFloat(uSlider.value);
                uLabel.textContent = this.velU.toFixed(2) + 'c';
                this.updateInfo();
            });
        }

        // 双生子旅行距离面板
        if (velRow && !document.getElementById('rel-twin-panel')) {
            const panel = document.createElement('div');
            panel.id = 'rel-twin-panel';
            panel.className = 'rel-extra-panel';
            panel.innerHTML = `
                <label>旅行距离：</label>
                <input type="range" id="rel-twin-dist" min="0.2" max="5" step="0.1" value="1.0">
                <span class="rel-val" id="rel-twin-dist-val">1.0 光年</span>
            `;
            const uPanel = document.getElementById('rel-vel-u-panel');
            uPanel.parentElement.insertBefore(panel, uPanel.nextSibling);
            const dSlider = document.getElementById('rel-twin-dist');
            const dLabel = document.getElementById('rel-twin-dist-val');
            this._on(dSlider, 'input', () => {
                this.twinDist = parseFloat(dSlider.value);
                dLabel.textContent = this.twinDist.toFixed(1) + ' 光年';
                this.updateInfo();
            });
        }
    },

    /** 根据当前模式显示/隐藏额外面板 */
    _syncPanelVisibility() {
        const uPanel = document.getElementById('rel-vel-u-panel');
        const tPanel = document.getElementById('rel-twin-panel');
        if (uPanel) uPanel.style.display = this.mode === 'velocity' ? 'flex' : 'none';
        if (tPanel) tPanel.style.display = this.mode === 'twins' ? 'flex' : 'none';

        const wrap = this.canvas && this.canvas.parentElement;
        if (wrap && wrap.classList.contains('relativity-canvas-wrap')) {
            const tall = this.mode === 'spacetime' || this.mode === 'doppler';
            wrap.classList.toggle('relativity-canvas-wrap--tall', tall);
        }
        this.resizeCanvas();
    },

    // ── 鼠标事件处理 ──
    _getCanvasXY(e) {
        return { x: e.offsetX, y: e.offsetY };
    },

    _handleMouseMove(e) {
        const p = this._getCanvasXY(e);
        this._mouse = { x: p.x, y: p.y, active: true };

        // 时空图拖拽
        if (this.mode === 'spacetime' && this._stDrag >= 0 && this._stLayout) {
            const L = this._stLayout;
            const ev = this.stEvents[this._stDrag];
            if (ev) {
                ev.x = (p.x - L.cx) / L.axLen;
                ev.ct = -(p.y - L.cy) / L.axLen;
                ev.x = Math.max(-1, Math.min(1, ev.x));
                ev.ct = Math.max(-1, Math.min(1, ev.ct));
            }
            this.canvas.style.cursor = 'grabbing';
            return;
        }

        // Lorentz 变换拖拽
        if (this.mode === 'lorentz' && this._ltDrag >= 0 && this._ltLayout) {
            const L = this._ltLayout;
            const ev = this.lorentzEvents[this._ltDrag];
            if (ev) {
                ev.x = (p.x - L.cx) / L.axLen;
                ev.ct = -(p.y - L.cy) / L.axLen;
                ev.x = Math.max(-1, Math.min(1, ev.x));
                ev.ct = Math.max(-1, Math.min(1, ev.ct));
            }
            this.canvas.style.cursor = 'grabbing';
            return;
        }

        // 悬停检测
        if (this.mode === 'spacetime' && this._stLayout) {
            const hit = this._hitTestEvents(this.stEvents, this._stLayout, p);
            this.canvas.style.cursor = hit >= 0 ? 'grab' : 'crosshair';
        } else if (this.mode === 'lorentz' && this._ltLayout) {
            const hit = this._hitTestEvents(this.lorentzEvents, this._ltLayout, p);
            this.canvas.style.cursor = hit >= 0 ? 'grab' : 'crosshair';
        } else {
            this.canvas.style.cursor = 'default';
        }
    },

    _handleMouseDown(e) {
        const p = this._getCanvasXY(e);
        // 时空图
        if (this.mode === 'spacetime' && this._stLayout) {
            const hit = this._hitTestEvents(this.stEvents, this._stLayout, p);
            if (hit >= 0) {
                this._stDrag = hit;
                return;
            }
            // 点击空白处添加新事件（最多 6 个）
            if (this.stEvents.length < 6) {
                const L = this._stLayout;
                const nx = (p.x - L.cx) / L.axLen;
                const nct = -(p.y - L.cy) / L.axLen;
                if (Math.abs(nx) <= 1 && Math.abs(nct) <= 1) {
                    this.stEvents.push({ x: nx, ct: nct });
                    this._stDrag = this.stEvents.length - 1;
                }
            }
        }
        // Lorentz 变换
        if (this.mode === 'lorentz' && this._ltLayout) {
            const hit = this._hitTestEvents(this.lorentzEvents, this._ltLayout, p);
            if (hit >= 0) {
                this._ltDrag = hit;
                return;
            }
            if (this.lorentzEvents.length < 6) {
                const L = this._ltLayout;
                const nx = (p.x - L.cx) / L.axLen;
                const nct = -(p.y - L.cy) / L.axLen;
                if (Math.abs(nx) <= 1 && Math.abs(nct) <= 1) {
                    this.lorentzEvents.push({ x: nx, ct: nct });
                    this._ltDrag = this.lorentzEvents.length - 1;
                }
            }
        }
    },

    _handleMouseUp() {
        this._stDrag = -1;
        this._ltDrag = -1;
        if (this.mode === 'spacetime' || this.mode === 'lorentz') {
            this.canvas.style.cursor = 'crosshair';
        }
    },

    _handleDblClick(e) {
        const p = this._getCanvasXY(e);
        // 双击删除事件
        if (this.mode === 'spacetime' && this._stLayout) {
            const hit = this._hitTestEvents(this.stEvents, this._stLayout, p);
            if (hit >= 0) {
                this.stEvents.splice(hit, 1);
                return;
            }
        }
        if (this.mode === 'lorentz' && this._ltLayout) {
            const hit = this._hitTestEvents(this.lorentzEvents, this._ltLayout, p);
            if (hit >= 0) {
                this.lorentzEvents.splice(hit, 1);
                return;
            }
        }
    },

    _hitTestEvents(events, layout, p) {
        const hitR = 12;
        for (let i = events.length - 1; i >= 0; i--) {
            const ev = events[i];
            const px = layout.cx + ev.x * layout.axLen;
            const py = layout.cy - ev.ct * layout.axLen;
            const dx = p.x - px;
            const dy = p.y - py;
            if (dx * dx + dy * dy < hitR * hitR) return i;
        }
        return -1;
    },

    /** Lorentz 变换: (x, ct) → (x', ct') */
    _lorentzTransform(x, ct, beta) {
        const g = 1 / Math.sqrt(Math.max(1 - beta * beta, 1e-10));
        return {
            x: g * (x - beta * ct),
            ct: g * (ct - beta * x)
        };
    },

    updateGamma() {
        const b2 = this.beta * this.beta;
        this.gamma = b2 >= 1 ? 100 : 1 / Math.sqrt(1 - b2);
    },

    /* ── 绘制 ── */

    start() {
        this._lastTime = performance.now();
        const step = (now) => {
            const rawDt = (now - this._lastTime) / 1000;
            this._lastTime = now;
            this.dt = Math.min(rawDt, 0.1); // cap to avoid spiral after tab-away
            if (!this.paused) {
                this.t += this.dt;
                this.draw();
            }
            if (this.running) this.animId = requestAnimationFrame(step);
            else this.animId = null;
        };
        this.animId = requestAnimationFrame(step);
    },

    draw() {
        const ctx = this.ctx;
        const W = this.W;
        const H = this.H;
        ctx.clearRect(0, 0, W, H);

        // 背景星空
        this.drawStars(ctx, W, H);

        if (this.mode === 'time') this.drawTimeDilation(ctx, W, H);
        else if (this.mode === 'length') this.drawLengthContraction(ctx, W, H);
        else if (this.mode === 'mass') this.drawMassEnergy(ctx, W, H);
        else if (this.mode === 'spacetime') this.drawSpacetime(ctx, W, H);
        else if (this.mode === 'velocity') this.drawVelocityAddition(ctx, W, H);
        else if (this.mode === 'twins') this.drawTwinParadox(ctx, W, H);
        else if (this.mode === 'doppler') this.drawDoppler(ctx, W, H);
        else if (this.mode === 'lorentz') this.drawLorentz(ctx, W, H);

        // 鼠标探针（仅在非拖拽、非时空图/Lorentz 模式下显示坐标）
        if (this._mouse.active && this.mode !== 'spacetime' && this.mode !== 'lorentz') {
            this._drawProbe(ctx);
        }
    },

    /** 鼠标坐标探针 */
    _drawProbe(ctx) {
        const mx = this._mouse.x;
        const my = this._mouse.y;
        const info = `(${mx.toFixed(0)}, ${my.toFixed(0)})  β=${this.beta.toFixed(2)}  γ=${this.gamma.toFixed(3)}`;

        ctx.save();
        // 十字线
        ctx.strokeStyle = 'rgba(200,210,240,0.15)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(mx, 0); ctx.lineTo(mx, this.H);
        ctx.moveTo(0, my); ctx.lineTo(this.W, my);
        ctx.stroke();
        ctx.setLineDash([]);

        // 文字背景
        ctx.font = '16px ' + CF.mono;
        const tw = ctx.measureText(info).width + 12;
        const tx = Math.min(mx + 12, this.W - tw);
        const ty = Math.max(my - 22, 14);
        ctx.fillStyle = 'rgba(15,18,28,0.8)';
        ctx.fillRect(tx - 4, ty - 11, tw, 16);
        ctx.fillStyle = '#8b9dc3';
        ctx.textAlign = 'left';
        ctx.fillText(info, tx, ty);
        ctx.restore();
    },

    drawStars(ctx, W, H) {
        // 预生成星星坐标（仅首次或画布尺寸变化时）
        if (!this._stars || this._stars.W !== W || this._stars.H !== H) {
            const seed = 42;
            const starData = [];
            for (let i = 0; i < 60; i++) {
                starData.push({
                    x: ((seed * (i + 1) * 7919) % 10000) / 10000 * W,
                    y: ((seed * (i + 1) * 6271) % 10000) / 10000 * H,
                    r: ((seed * (i + 1) * 3571) % 10000) / 10000 * 1.5 + 0.3
                });
            }
            this._stars = { W, H, data: starData };
        }
        const stars = this._stars.data;
        for (let i = 0; i < stars.length; i++) {
            const s = stars[i];
            const alpha = 0.3 + 0.3 * Math.sin(this.t * 2 + i);
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(200,210,240,${alpha})`;
            ctx.fill();
        }
    },

    /* ── 时间膨胀 ── */
    drawTimeDilation(ctx, W, H) {
        const cx1 = W * 0.28;
        const cx2 = W * 0.72;
        const cy = H * 0.5;
        const clockR = Math.min(W * 0.14, H * 0.28, 90);

        // 静止时钟速度
        const restSpeed = 1.0;
        const moveSpeed = 1.0 / this.gamma;

        this.restClockAngle += restSpeed * 1.8 * this.dt;
        this.moveClockAngle += moveSpeed * 1.8 * this.dt;

        // 标签
        ctx.fillStyle = '#8b9dc3';
        ctx.font = '19px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('静止观察者', cx1, cy - clockR - 24);
        ctx.fillText('高速运动者 (v = ' + this.beta.toFixed(2) + 'c)', cx2, cy - clockR - 24);

        // 绘制两个时钟
        this.drawClock(ctx, cx1, cy, clockR, this.restClockAngle, '#5b8dce', '1.00s');
        this.drawClock(ctx, cx2, cy, clockR, this.moveClockAngle, '#c4793a', (1 / this.gamma).toFixed(3) + 's');

        // γ 显示
        ctx.fillStyle = '#e8dcc8';
        ctx.font = 'bold 22px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText('γ = ' + this.gamma.toFixed(4), W * 0.5, H * 0.12);

        // 公式
        ctx.fillStyle = '#8b9dc3';
        ctx.font = '18px ' + CF.mono;
        ctx.fillText("Δt' = γ · Δt", W * 0.5, H * 0.92);
    },

    drawClock(ctx, cx, cy, r, angle, color, label) {
        // 表盘
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // 刻度
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
            const inner = r * 0.85;
            const outer = r * 0.95;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
            ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
            ctx.strokeStyle = 'rgba(200,210,240,0.5)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        // 中心点
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        // 秒针
        const a = angle - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * r * 0.75, cy + Math.sin(a) * r * 0.75);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();

        // 标签
        ctx.fillStyle = color;
        ctx.font = 'bold 19px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText(label, cx, cy + r + 22);
    },

    /* ── 长度收缩 ── */
    drawLengthContraction(ctx, W, H) {
        const topY = H * 0.28;
        const botY = H * 0.68;
        const restLen = W * 0.35;
        const moveLen = restLen / this.gamma;
        const cx = W * 0.5;

        // 标签
        ctx.fillStyle = '#8b9dc3';
        ctx.font = '19px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('静止参考系中的飞船', cx, topY - 40);
        ctx.fillText('运动参考系中的飞船 (v = ' + this.beta.toFixed(2) + 'c)', cx, botY - 40);

        // 静止飞船
        this.drawShip(ctx, cx - restLen / 2, topY, restLen, 40, '#5b8dce');

        // 运动飞船（收缩）
        this.shipX += this.beta * 72 * this.dt;
        if (this.shipX > W * 0.6) this.shipX = -W * 0.6;
        const moveShipCx = cx + this.shipX;
        this.drawShip(ctx, moveShipCx - moveLen / 2, botY, moveLen, 40, '#c4793a');

        // 尺寸标注 — 静止
        this.drawDimension(ctx, cx - restLen / 2, topY + 56, cx + restLen / 2, 'L₀ = 1.000', '#5b8dce');

        // 尺寸标注 — 运动
        this.drawDimension(ctx, moveShipCx - moveLen / 2, botY + 56, moveShipCx + moveLen / 2,
            "L = L₀/γ = " + (1 / this.gamma).toFixed(3), '#c4793a');

        // γ 显示
        ctx.fillStyle = '#e8dcc8';
        ctx.font = 'bold 22px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText('γ = ' + this.gamma.toFixed(4), W * 0.5, H * 0.12);

        // 公式
        ctx.fillStyle = '#8b9dc3';
        ctx.font = '18px ' + CF.mono;
        ctx.fillText("L = L₀ / γ = L₀ · √(1 - v²/c²)", W * 0.5, H * 0.92);
    },

    drawShip(ctx, x, y, w, h, color) {
        ctx.save();
        ctx.beginPath();
        // 机身
        ctx.moveTo(x, y + h * 0.3);
        ctx.lineTo(x + w * 0.15, y);
        ctx.lineTo(x + w * 0.85, y);
        ctx.lineTo(x + w, y + h * 0.3);
        ctx.lineTo(x + w * 0.95, y + h * 0.7);
        ctx.lineTo(x + w * 0.85, y + h);
        ctx.lineTo(x + w * 0.15, y + h);
        ctx.lineTo(x + w * 0.05, y + h * 0.7);
        ctx.closePath();

        const grad = ctx.createLinearGradient(x, y, x, y + h);
        grad.addColorStop(0, color);
        grad.addColorStop(1, color + '66');
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // 窗口
        const winR = Math.min(h * 0.15, 6);
        ctx.beginPath();
        ctx.arc(x + w * 0.5, y + h * 0.4, winR, 0, Math.PI * 2);
        ctx.fillStyle = '#e8dcc8';
        ctx.fill();
        ctx.restore();
    },

    drawDimension(ctx, x1, y, x2, label, color) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        // 横线
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.stroke();
        // 两端竖线
        ctx.beginPath();
        ctx.moveTo(x1, y - 6);
        ctx.lineTo(x1, y + 6);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x2, y - 6);
        ctx.lineTo(x2, y + 6);
        ctx.stroke();
        // 箭头
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x1 + 6, y - 3);
        ctx.lineTo(x1 + 6, y + 3);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x2, y);
        ctx.lineTo(x2 - 6, y - 3);
        ctx.lineTo(x2 - 6, y + 3);
        ctx.closePath();
        ctx.fill();
        // 标签
        ctx.fillStyle = color;
        ctx.font = '17px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText(label, (x1 + x2) / 2, y + 20);
    },

    /* ── 质能等价 ── */
    drawMassEnergy(ctx, W, H) {
        const cx = W * 0.5;
        const baseM = 1.0;
        const relM = baseM * this.gamma;
        const E = relM; // E = γmc² (单位 mc²)
        const Ek = (this.gamma - 1) * baseM; // 动能
        const E0 = baseM; // 静止能量

        // γ 显示
        ctx.fillStyle = '#e8dcc8';
        ctx.font = 'bold 22px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText('γ = ' + this.gamma.toFixed(4), cx, H * 0.1);

        // 能量柱状图
        const barW = Math.min(W * 0.12, 60);
        const barMaxH = H * 0.5;
        const barY = H * 0.72;
        const barGap = W * 0.18;

        const bars = [
            { label: 'E₀ = mc²', val: E0, max: Math.max(E, 3), color: '#5b8dce' },
            { label: 'Eₖ = (γ-1)mc²', val: Ek, max: Math.max(E, 3), color: '#c4793a' },
            { label: 'E = γmc²', val: E, max: Math.max(E, 3), color: '#8b6fc0' }
        ];

        bars.forEach((bar, i) => {
            const bx = cx + (i - 1) * barGap - barW / 2;
            const bh = Math.min(bar.val / bar.max, 1) * barMaxH;

            // 背景槽
            ctx.fillStyle = 'rgba(200,210,240,0.08)';
            ctx.fillRect(bx, barY - barMaxH, barW, barMaxH);

            // 值
            const grad = ctx.createLinearGradient(bx, barY, bx, barY - bh);
            grad.addColorStop(0, bar.color + '99');
            grad.addColorStop(1, bar.color);
            ctx.fillStyle = grad;
            ctx.fillRect(bx, barY - bh, barW, bh);

            // 边框
            ctx.strokeStyle = bar.color;
            ctx.lineWidth = 1;
            ctx.strokeRect(bx, barY - barMaxH, barW, barMaxH);

            // 数值
            ctx.fillStyle = bar.color;
            ctx.font = 'bold 18px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillText(bar.val.toFixed(3), bx + barW / 2, barY - bh - 8);

            // 标签
            ctx.fillStyle = '#8b9dc3';
            ctx.font = '17px ' + CF.mono;
            ctx.fillText(bar.label, bx + barW / 2, barY + 18);
        });

        // 单位说明
        ctx.fillStyle = '#8b9dc3';
        ctx.font = '16px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('(单位: mc²)', cx, barY + 36);

        // 质量球
        const ballY = H * 0.2;
        const restR = 18;
        const relR = restR * Math.min(Math.pow(this.gamma, 0.3), 3);

        // 静止质量球
        ctx.beginPath();
        ctx.arc(cx - barGap, ballY, restR, 0, Math.PI * 2);
        ctx.fillStyle = '#5b8dce44';
        ctx.fill();
        ctx.strokeStyle = '#5b8dce';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#5b8dce';
        ctx.font = '17px ' + CF.mono;
        ctx.fillText('m₀', cx - barGap, ballY + restR + 16);

        // 相对论质量球（视觉放大）
        ctx.beginPath();
        ctx.arc(cx + barGap, ballY, relR, 0, Math.PI * 2);
        ctx.fillStyle = '#8b6fc044';
        ctx.fill();
        ctx.strokeStyle = '#8b6fc0';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#8b6fc0';
        ctx.font = '17px ' + CF.mono;
        ctx.fillText('γm₀ = ' + relM.toFixed(2), cx + barGap, ballY + relR + 16);

        // 公式
        ctx.fillStyle = '#8b9dc3';
        ctx.font = '18px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText('E² = (pc)² + (mc²)²    |    E = γmc²', cx, H * 0.93);
    },

    /* ── 双生子佯谬 (增强：旅行距离可调) ── */
    drawTwinParadox(ctx, W, H) {
        const v = this.beta;
        const g = this.gamma;
        const D = this.twinDist; // 旅行距离 (光年)

        // 旅行总坐标时 = 2D/v (v=0 时为正无穷，用 cap)
        const totalTime = v > 0.01 ? 2 * D / v : 9999;
        // 旅行者固有时 = totalTime / γ
        const properTime = totalTime / g;

        // 归一化 cycle = 3 单位 (0→1 去, 1→2 返, 2→3 停留展示)
        const cycle = 3;
        const phase = this.t * 0.3 % cycle;
        const leg = phase < 1 ? 'outbound' : phase < 2 ? 'return' : 'rest';
        const legProgress = phase < 1 ? phase : phase < 2 ? phase - 1 : phase - 2;

        // 地球人年龄（按坐标时线性映射）
        const earthAge = phase < 2 ? (phase / 2) * totalTime : totalTime;
        // 旅行者年龄
        const travelAge = phase < 2 ? (phase / 2) * properTime : properTime;

        // ── 布局参数 ──
        const earthX = W * 0.22;
        const travelX = W * 0.78;
        const topY = H * 0.18;
        const botY = H * 0.78;
        const pathH = botY - topY;
        const midX = W * 0.5;

        const earthColor = '#5b8dce';
        const travelColor = '#c4793a';
        const starColor = '#e8dcc8';

        // ── 地球和星球 ──
        // 地球
        ctx.beginPath();
        ctx.arc(earthX, botY + 20, 12, 0, Math.PI * 2);
        ctx.fillStyle = earthColor + '44';
        ctx.fill();
        ctx.strokeStyle = earthColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = earthColor;
        ctx.font = '17px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('地球', earthX, botY + 46);

        // 目标星球
        ctx.beginPath();
        ctx.arc(travelX, botY + 20, 8, 0, Math.PI * 2);
        ctx.fillStyle = starColor + '44';
        ctx.fill();
        ctx.strokeStyle = starColor;
        ctx.stroke();
        ctx.fillStyle = starColor;
        ctx.fillText('目标星', travelX, botY + 46);

        // ── 飞行路径 (虚线) ──
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(200,210,240,0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(earthX, botY);
        ctx.lineTo(travelX, topY);
        ctx.lineTo(earthX, botY);
        ctx.stroke();
        ctx.setLineDash([]);

        // ── 飞船位置 ──
        let shipPx, shipPy;
        if (leg === 'outbound') {
            shipPx = earthX + (travelX - earthX) * legProgress;
            shipPy = botY - pathH * legProgress;
        } else if (leg === 'return') {
            shipPx = travelX - (travelX - earthX) * legProgress;
            shipPy = topY + pathH * legProgress;
        } else {
            shipPx = earthX;
            shipPy = botY;
        }

        // 飞船尾迹
        if (leg !== 'rest') {
            const trailLen = 6;
            for (let i = 1; i <= trailLen; i++) {
                const alpha = (1 - i / trailLen) * 0.4;
                const offX = leg === 'outbound' ? -i * 3 : i * 3;
                const offY = leg === 'outbound' ? i * 3 : -i * 3;
                ctx.beginPath();
                ctx.arc(shipPx + offX, shipPy + offY, 2, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(196,121,58,${alpha})`;
                ctx.fill();
            }
        }

        // 飞船
        ctx.beginPath();
        ctx.arc(shipPx, shipPy, 6, 0, Math.PI * 2);
        ctx.fillStyle = travelColor;
        ctx.fill();
        ctx.strokeStyle = travelColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // ── 年龄条形图 ──
        const barW = 40;
        const barMaxH = H * 0.25;
        const barY = H * 0.86;
        const maxAge = Math.max(totalTime, 0.01);

        // 地球人
        const eBarH = Math.min(earthAge / maxAge, 1) * barMaxH;
        ctx.fillStyle = earthColor + '22';
        ctx.fillRect(earthX - barW / 2, barY - barMaxH, barW, barMaxH);
        ctx.fillStyle = earthColor + '99';
        ctx.fillRect(earthX - barW / 2, barY - eBarH, barW, eBarH);
        ctx.strokeStyle = earthColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(earthX - barW / 2, barY - barMaxH, barW, barMaxH);

        ctx.fillStyle = earthColor;
        ctx.font = 'bold 18px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText(earthAge.toFixed(2) + '年', earthX, barY + 16);
        ctx.font = '16px ' + CF.sans;
        ctx.fillText('地球双胞胎', earthX, barY + 32);

        // 旅行者
        const tBarH = Math.min(travelAge / maxAge, 1) * barMaxH;
        ctx.fillStyle = travelColor + '22';
        ctx.fillRect(travelX - barW / 2, barY - barMaxH, barW, barMaxH);
        ctx.fillStyle = travelColor + '99';
        ctx.fillRect(travelX - barW / 2, barY - tBarH, barW, tBarH);
        ctx.strokeStyle = travelColor;
        ctx.strokeRect(travelX - barW / 2, barY - barMaxH, barW, barMaxH);

        ctx.fillStyle = travelColor;
        ctx.font = 'bold 18px ' + CF.mono;
        ctx.fillText(travelAge.toFixed(2) + '年', travelX, barY + 16);
        ctx.font = '16px ' + CF.sans;
        ctx.fillText('旅行双胞胎', travelX, barY + 32);

        // ── 年龄差 ──
        const ageDiff = earthAge - travelAge;
        if (ageDiff > 0.01) {
            ctx.fillStyle = '#e8dcc8';
            ctx.font = 'bold 19px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillText('年龄差: ' + ageDiff.toFixed(3) + ' 年', midX, barY + 16);
        }

        // ── 旅行距离标注 ──
        ctx.fillStyle = '#8b9dc366';
        ctx.font = '16px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('D = ' + D.toFixed(1) + ' 光年', midX, botY + 46);

        // ── 阶段指示 ──
        ctx.fillStyle = 'rgba(200,210,240,0.6)';
        ctx.font = '17px ' + CF.sans;
        ctx.textAlign = 'center';
        const stageLabel = leg === 'outbound' ? '🚀 去程中...' : leg === 'return' ? '🔄 返程中...' : '🏠 已返回地球';
        ctx.fillText(stageLabel, midX, topY - 8);

        // ── 顶部信息 ──
        ctx.fillStyle = '#e8dcc8';
        ctx.font = 'bold 22px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText('v = ' + v.toFixed(2) + 'c    γ = ' + g.toFixed(4), midX, H * 0.06);

        // ── 底部公式 ──
        ctx.fillStyle = '#8b9dc3';
        ctx.font = '18px ' + CF.mono;
        const tFmt = v > 0.01 ? properTime.toFixed(2) : '∞';
        ctx.fillText("τ = 2D/(γv) = " + tFmt + " 年    Δt = 2D/v = " + (v > 0.01 ? totalTime.toFixed(2) : '∞') + " 年", midX, H * 0.95);
    },

    /* ── 相对论多普勒效应 ── */
    drawDoppler(ctx, W, H) {
        const beta = this.beta;
        const cx = W * 0.5;
        const cy = H * 0.48;

        // 多普勒因子
        const approachRatio = beta < 0.999 ? Math.sqrt((1 + beta) / (1 - beta)) : 30;
        const recedeRatio = beta < 0.999 ? Math.sqrt((1 - beta) / (1 + beta)) : 0.03;

        // ── 光源 (中心, 向右运动) ──
        const sourceX = cx + Math.sin(this.t * 0.8) * W * 0.15;

        // 光源
        ctx.beginPath();
        ctx.arc(sourceX, cy, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#e8dcc8';
        ctx.fill();
        ctx.strokeStyle = '#e8dcc8';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // 运动方向箭头
        if (beta > 0.01) {
            ctx.strokeStyle = 'rgba(200,210,240,0.4)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(sourceX + 16, cy);
            ctx.lineTo(sourceX + 35, cy);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(sourceX + 35, cy);
            ctx.lineTo(sourceX + 28, cy - 4);
            ctx.moveTo(sourceX + 35, cy);
            ctx.lineTo(sourceX + 28, cy + 4);
            ctx.stroke();
            ctx.fillStyle = 'rgba(200,210,240,0.5)';
            ctx.font = '15px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.fillText('v', sourceX + 26, cy - 10);
        }

        // ── 波前圆环 ──
        const numWaves = 8;
        const waveSpeed = 80; // 像素/秒
        const waveInterval = 0.35; // 秒

        for (let i = 0; i < numWaves; i++) {
            const age = (this.t % (waveInterval * numWaves)) - i * waveInterval;
            if (age < 0) continue;
            const radius = age * waveSpeed;
            if (radius > W * 0.7) continue;

            // 波前发射时光源位置
            const emitX = sourceX - age * beta * waveSpeed * 0.6;
            const alpha = Math.max(0, 0.5 - radius / (W * 0.7) * 0.5);

            ctx.beginPath();
            ctx.arc(emitX, cy, radius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(200,210,240,${alpha})`;
            ctx.lineWidth = 1.2;
            ctx.stroke();
        }

        // ── 观察者 ──
        const obsLeftX = W * 0.08;
        const obsRightX = W * 0.92;
        const obsY = cy;

        // 左侧观察者 (光源远离 → 红移)
        ctx.fillStyle = '#e74c3c88';
        ctx.beginPath();
        ctx.arc(obsLeftX, obsY, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#e74c3c';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#e74c3c';
        ctx.font = '16px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('红移观察者', obsLeftX, obsY + 28);

        // 右侧观察者 (光源接近 → 蓝移)
        ctx.fillStyle = '#3498db88';
        ctx.beginPath();
        ctx.arc(obsRightX, obsY, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#3498db';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#3498db';
        ctx.fillText('蓝移观察者', obsRightX, obsY + 28);

        // ── 频率/波长条形 ──
        const barW = Math.min(W * 0.18, 100);
        const barH = 24;
        const barY = cy + H * 0.22;

        // 原始频率
        ctx.fillStyle = '#e8dcc844';
        ctx.fillRect(cx - barW / 2, barY, barW, barH);
        ctx.strokeStyle = '#e8dcc8';
        ctx.lineWidth = 1;
        ctx.strokeRect(cx - barW / 2, barY, barW, barH);
        ctx.fillStyle = '#e8dcc8';
        ctx.font = '16px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText('f₀ (原始)', cx, barY - 6);
        ctx.fillText('1.000', cx, barY + barH / 2 + 4);

        // 红移频率 (左)
        const redW = barW * Math.min(recedeRatio, 2);
        ctx.fillStyle = '#e74c3c44';
        ctx.fillRect(obsLeftX - redW / 2, barY, redW, barH);
        ctx.strokeStyle = '#e74c3c';
        ctx.strokeRect(obsLeftX - redW / 2, barY, redW, barH);
        ctx.fillStyle = '#e74c3c';
        ctx.fillText('f = ' + recedeRatio.toFixed(3) + 'f₀', obsLeftX, barY - 6);
        // 波长条内色块
        this.drawWavelengthBar(ctx, obsLeftX - redW / 2, barY, redW, barH, recedeRatio, 'red');

        // 蓝移频率 (右)
        const blueW = barW * Math.min(approachRatio, 2);
        ctx.fillStyle = '#3498db44';
        ctx.fillRect(obsRightX - blueW / 2, barY, blueW, barH);
        ctx.strokeStyle = '#3498db';
        ctx.strokeRect(obsRightX - blueW / 2, barY, blueW, barH);
        ctx.fillStyle = '#3498db';
        ctx.fillText('f = ' + approachRatio.toFixed(3) + 'f₀', obsRightX, barY - 6);
        this.drawWavelengthBar(ctx, obsRightX - blueW / 2, barY, blueW, barH, approachRatio, 'blue');

        // ── 光谱色带 ──
        const specY = cy + H * 0.36;
        const specW = W * 0.6;
        const specH = 16;
        const specX = cx - specW / 2;

        // 渐变色带 (蓝→绿→黄→红)
        const specGrad = ctx.createLinearGradient(specX, 0, specX + specW, 0);
        specGrad.addColorStop(0, '#4400ff');
        specGrad.addColorStop(0.2, '#0066ff');
        specGrad.addColorStop(0.4, '#00cc44');
        specGrad.addColorStop(0.6, '#cccc00');
        specGrad.addColorStop(0.8, '#ff6600');
        specGrad.addColorStop(1, '#cc0000');
        ctx.fillStyle = specGrad;
        ctx.fillRect(specX, specY, specW, specH);
        ctx.strokeStyle = 'rgba(200,210,240,0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(specX, specY, specW, specH);

        // 原始频率标记
        ctx.strokeStyle = '#e8dcc8';
        ctx.lineWidth = 2;
        const origMark = specX + specW * 0.5;
        ctx.beginPath(); ctx.moveTo(origMark, specY - 4); ctx.lineTo(origMark, specY + specH + 4); ctx.stroke();

        // 红移标记
        if (beta > 0.01) {
            const redShift = Math.max(0, Math.min(1, 0.5 + (1 - recedeRatio) * 0.5));
            const redMark = specX + specW * redShift;
            ctx.strokeStyle = '#e74c3c';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(redMark, specY - 6); ctx.lineTo(redMark, specY + specH + 6); ctx.stroke();
            ctx.fillStyle = '#e74c3c';
            ctx.font = '15px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.fillText('红移', redMark, specY + specH + 18);
        }

        // 蓝移标记
        if (beta > 0.01) {
            const blueShift = Math.max(0, Math.min(1, 0.5 - (approachRatio - 1) * 0.15));
            const blueMark = specX + specW * blueShift;
            ctx.strokeStyle = '#3498db';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(blueMark, specY - 6); ctx.lineTo(blueMark, specY + specH + 6); ctx.stroke();
            ctx.fillStyle = '#3498db';
            ctx.font = '15px ' + CF.sans;
            ctx.fillText('蓝移', blueMark, specY + specH + 18);
        }

        ctx.fillStyle = 'rgba(200,210,240,0.4)';
        ctx.font = '15px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText('蓝', specX, specY - 4);
        ctx.textAlign = 'right';
        ctx.fillText('红', specX + specW, specY - 4);

        // ── 顶部 γ ──
        ctx.fillStyle = '#e8dcc8';
        ctx.font = 'bold 22px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText('v = ' + beta.toFixed(2) + 'c    γ = ' + this.gamma.toFixed(4), cx, H * 0.06);

        // ── 底部公式 ──
        ctx.fillStyle = '#8b9dc3';
        ctx.font = '18px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText("f_obs = f₀ · √((1±β)/(1∓β))", cx, H * 0.95);
    },

    drawWavelengthBar(ctx, x, y, w, h, ratio, type) {
        const stripes = Math.max(2, Math.round(6 * Math.min(ratio, 2)));
        const stripeW = w / stripes;
        const color = type === 'red' ? '#e74c3c' : '#3498db';
        for (let i = 0; i < stripes; i++) {
            if (i % 2 === 0) {
                ctx.fillStyle = color + '44';
                ctx.fillRect(x + i * stripeW, y, stripeW, h);
            }
        }
    },

    /* ── 速度叠加对比 ── */
    drawVelocityAddition(ctx, W, H) {
        const v = this.beta; // 参考系速度 (v/c)

        // ── 图表区域 ──
        const padL = W * 0.14;
        const padR = W * 0.06;
        const padT = H * 0.16;
        const padB = H * 0.18;
        const gW = W - padL - padR;
        const gH = H - padT - padB;
        const ox = padL;          // 原点 x
        const oy = padT + gH;    // 原点 y

        const restColor = '#5b8dce';
        const moveColor = '#c4793a';
        const limitColor = '#e8dcc8';

        // ── 网格 ──
        ctx.strokeStyle = 'rgba(200,210,240,0.08)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 5; i++) {
            const fx = ox + (i / 5) * gW;
            ctx.beginPath(); ctx.moveTo(fx, oy); ctx.lineTo(fx, oy - gH); ctx.stroke();
            const fy = oy - (i / 5) * gH;
            ctx.beginPath(); ctx.moveTo(ox, fy); ctx.lineTo(ox + gW, fy); ctx.stroke();
        }

        // ── 坐标轴 ──
        ctx.strokeStyle = 'rgba(200,210,240,0.4)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + gW, oy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox, oy - gH); ctx.stroke();

        // 轴标签
        ctx.fillStyle = '#8b9dc3';
        ctx.font = '17px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText("u / c  (物体在运动系中的速度)", ox + gW / 2, oy + 36);
        ctx.save();
        ctx.translate(ox - 36, oy - gH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText("合成速度 / c", 0, 0);
        ctx.restore();

        // 刻度
        ctx.fillStyle = 'rgba(200,210,240,0.5)';
        ctx.font = '15px ' + CF.mono;
        ctx.textAlign = 'center';
        for (let i = 0; i <= 5; i++) {
            const val = (i / 5).toFixed(1);
            ctx.fillText(val, ox + (i / 5) * gW, oy + 16);
        }
        ctx.textAlign = 'right';
        for (let i = 0; i <= 5; i++) {
            const val = (i / 5).toFixed(1);
            ctx.fillText(val, ox - 6, oy - (i / 5) * gH + 4);
        }
        // 1.5 / 2.0 extra for classical
        ctx.fillText('1.5', ox - 6, oy - (1.5 / 2) * gH + 4);
        ctx.fillText('2.0', ox - 6, oy - gH + 4);

        // ── 光速极限线 y=1.0 ──
        const yLimit = oy - (1 / 2) * gH; // y 轴现在 max = 2.0
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = limitColor + '66';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ox, yLimit);
        ctx.lineTo(ox + gW, yLimit);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = limitColor + 'aa';
        ctx.font = '16px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText('c (光速极限)', ox + gW + 4, yLimit + 4);

        // ── 映射函数：速度(0~2) → 画布 y ──
        const toY = (val) => oy - (val / 2) * gH;
        const toX = (u) => ox + u * gW; // u: 0~1

        // ── 经典速度叠加曲线 u_classical = u + v ──
        ctx.strokeStyle = restColor;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        const steps = 100;
        for (let i = 0; i <= steps; i++) {
            const u = i / steps;
            const uTotal = u + v;
            const px = toX(u);
            const py = toY(Math.min(uTotal, 2));
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.stroke();

        // ── 相对论速度叠加曲线 u_rel = (u + v) / (1 + uv) ──
        ctx.strokeStyle = moveColor;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
            const u = i / steps;
            const uTotal = (u + v) / (1 + u * v);
            const px = toX(u);
            const py = toY(uTotal);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.stroke();

        // ── 用户控制的 u 标记 ──
        const uVal = this.velU;
        const classicalVal = uVal + v;
        const relativisticVal = (uVal + v) / (1 + uVal * v);
        const markerX = toX(uVal);

        // 垂直参考线
        ctx.strokeStyle = 'rgba(200,210,240,0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(markerX, oy);
        ctx.lineTo(markerX, oy - gH);
        ctx.stroke();

        // 经典标记
        ctx.beginPath();
        ctx.arc(markerX, toY(Math.min(classicalVal, 2)), 6, 0, Math.PI * 2);
        ctx.fillStyle = restColor;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // 相对论标记
        ctx.beginPath();
        ctx.arc(markerX, toY(relativisticVal), 6, 0, Math.PI * 2);
        ctx.fillStyle = moveColor;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.stroke();

        // ── 差值指示线 ──
        if (classicalVal > relativisticVal + 0.01) {
            ctx.strokeStyle = 'rgba(200,210,240,0.25)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(markerX + 2, toY(Math.min(classicalVal, 2)));
            ctx.lineTo(markerX + 2, toY(relativisticVal));
            ctx.stroke();
            ctx.setLineDash([]);
            const diffVal = classicalVal - relativisticVal;
            ctx.fillStyle = '#e8dcc8aa';
            ctx.font = '15px ' + CF.mono;
            ctx.textAlign = 'left';
            ctx.fillText('Δ=' + diffVal.toFixed(3) + 'c',
                markerX + 6, (toY(Math.min(classicalVal, 2)) + toY(relativisticVal)) / 2 + 4);
        }

        // ── 数值标注 ──
        ctx.font = 'bold 17px ' + CF.mono;
        ctx.textAlign = 'left';
        const labelX = Math.min(markerX + 12, ox + gW - 100);
        ctx.fillStyle = restColor;
        ctx.fillText('经典: ' + classicalVal.toFixed(3) + 'c', labelX, toY(Math.min(classicalVal, 2)) - 8);
        ctx.fillStyle = moveColor;
        ctx.fillText('相对论: ' + relativisticVal.toFixed(3) + 'c', labelX, toY(relativisticVal) + 18);

        // ── 图例 ──
        const legX = ox + gW * 0.55;
        const legY = oy - gH + 20;
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = restColor;
        ctx.beginPath(); ctx.moveTo(legX, legY); ctx.lineTo(legX + 24, legY); ctx.stroke();
        ctx.fillStyle = restColor;
        ctx.font = '17px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText('经典叠加  u+v', legX + 30, legY + 4);

        ctx.strokeStyle = moveColor;
        ctx.beginPath(); ctx.moveTo(legX, legY + 20); ctx.lineTo(legX + 24, legY + 20); ctx.stroke();
        ctx.fillStyle = moveColor;
        ctx.fillText('相对论  (u+v)/(1+uv/c²)', legX + 30, legY + 24);

        // ── 顶部 γ + v ──
        ctx.fillStyle = '#e8dcc8';
        ctx.font = 'bold 22px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText('v = ' + v.toFixed(2) + 'c    γ = ' + this.gamma.toFixed(4), W * 0.5, H * 0.06);

        // ── 底部公式 ──
        ctx.fillStyle = '#8b9dc3';
        ctx.font = '18px ' + CF.mono;
        ctx.fillText("u' = (u + v) / (1 + uv/c²)", W * 0.5, H * 0.95);
    },

    /* ── 闵可夫斯基时空图 (交互增强：可拖拽事件点) ── */
    drawSpacetime(ctx, W, H) {
        const cx = W * 0.5;
        const cy = H * 0.52;
        const axLen = Math.min(W * 0.38, H * 0.40, 200);
        const beta = this.beta;

        // 缓存布局供鼠标交互使用
        this._stLayout = { cx, cy, axLen };

        const axisColor = 'rgba(200,210,240,0.35)';
        const restColor = '#5b8dce';
        const moveColor = '#c4793a';
        const lightColor = '#e8dcc8';
        const eventColors = ['#e74c3c', '#2ecc71', '#f1c40f', '#9b59b6', '#1abc9c', '#e67e22'];

        // ── 网格 ──
        ctx.strokeStyle = 'rgba(200,210,240,0.07)';
        ctx.lineWidth = 1;
        const gridN = 5;
        for (let i = -gridN; i <= gridN; i++) {
            const gx = cx + (i / gridN) * axLen;
            ctx.beginPath(); ctx.moveTo(gx, cy - axLen); ctx.lineTo(gx, cy + axLen); ctx.stroke();
            const gy = cy + (i / gridN) * axLen;
            ctx.beginPath(); ctx.moveTo(cx - axLen, gy); ctx.lineTo(cx + axLen, gy); ctx.stroke();
        }

        // ── 静止参考系坐标轴 ──
        ctx.strokeStyle = axisColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cx - axLen, cy); ctx.lineTo(cx + axLen, cy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx, cy + axLen); ctx.lineTo(cx, cy - axLen); ctx.stroke();
        ctx.fillStyle = restColor;
        ctx.font = '18px ' + CF.mono;
        ctx.textAlign = 'left';
        ctx.fillText('x', cx + axLen + 6, cy + 4);
        ctx.textAlign = 'center';
        ctx.fillText('ct', cx, cy - axLen - 10);

        // ── 光锥 (45°) ──
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = lightColor;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx - axLen, cy - axLen); ctx.lineTo(cx + axLen, cy + axLen); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + axLen, cy - axLen); ctx.lineTo(cx - axLen, cy + axLen); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = lightColor + 'aa';
        ctx.font = '16px ' + CF.sans;
        ctx.textAlign = 'right';
        ctx.fillText('光锥 (v=c)', cx + axLen - 2, cy - axLen + 14);

        // ── 光锥阴影 ──
        ctx.save();
        ctx.globalAlpha = 0.04;
        ctx.fillStyle = lightColor;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx - axLen, cy - axLen);
        ctx.lineTo(cx + axLen, cy - axLen);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx - axLen, cy + axLen);
        ctx.lineTo(cx + axLen, cy + axLen);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        // ── 运动参考系坐标轴 ──
        if (beta > 0.01) {
            const angle = Math.atan(beta);
            const ctpDx = Math.sin(angle) * axLen;
            const ctpDy = Math.cos(angle) * axLen;
            ctx.strokeStyle = moveColor;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cx - ctpDx, cy + ctpDy);
            ctx.lineTo(cx + ctpDx, cy - ctpDy);
            ctx.stroke();
            const xpDx = Math.cos(angle) * axLen;
            const xpDy = Math.sin(angle) * axLen;
            ctx.beginPath();
            ctx.moveTo(cx - xpDx, cy + xpDy);
            ctx.lineTo(cx + xpDx, cy - xpDy);
            ctx.stroke();
            ctx.fillStyle = moveColor;
            ctx.font = '18px ' + CF.mono;
            ctx.textAlign = 'left';
            ctx.fillText("x'", cx + xpDx + 6, cy - xpDy + 4);
            ctx.textAlign = 'center';
            ctx.fillText("ct'", cx + ctpDx + 8, cy - ctpDy - 6);

            // 同时线 (平行于 x')
            ctx.strokeStyle = moveColor + '44';
            ctx.lineWidth = 1;
            for (let k = -3; k <= 3; k++) {
                if (k === 0) continue;
                const offX = k * (ctpDx / 3);
                const offY = -k * (ctpDy / 3);
                ctx.beginPath();
                ctx.moveTo(cx + offX - xpDx * 0.8, cy + offY + xpDy * 0.8);
                ctx.lineTo(cx + offX + xpDx * 0.8, cy + offY - xpDy * 0.8);
                ctx.stroke();
            }
        }

        // ── 世界线：静止物体 ──
        ctx.strokeStyle = restColor;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy + axLen * 0.9);
        ctx.lineTo(cx, cy - axLen * 0.9);
        ctx.stroke();
        const dotY = cy - (((this.t * 0.5) % 1.8) - 0.9) * axLen;
        ctx.beginPath();
        ctx.arc(cx, dotY, 4, 0, Math.PI * 2);
        ctx.fillStyle = restColor;
        ctx.fill();

        // ── 世界线：运动物体 ──
        if (beta > 0.01) {
            const slope = 1 / beta;
            const xEnd = axLen * 0.9;
            const ctEnd = xEnd * slope;
            const clamp = Math.min(1, (axLen * 0.9) / Math.max(Math.abs(ctEnd), 0.001));
            const dx = xEnd * clamp;
            const dy = ctEnd * clamp;
            ctx.strokeStyle = moveColor;
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(cx - dx, cy + dy);
            ctx.lineTo(cx + dx, cy - dy);
            ctx.stroke();
            const frac = ((this.t * 0.5) % 1.8) - 0.9;
            ctx.beginPath();
            ctx.arc(cx + frac * dx, cy - frac * dy, 4, 0, Math.PI * 2);
            ctx.fillStyle = moveColor;
            ctx.fill();
        }

        // ── 原点 ──
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#e8dcc8';
        ctx.fill();

        // ── 可拖拽事件点 ──
        for (let i = 0; i < this.stEvents.length; i++) {
            const ev = this.stEvents[i];
            const px = cx + ev.x * axLen;
            const py = cy - ev.ct * axLen;
            const col = eventColors[i % eventColors.length];

            // 因果判定
            const s2 = ev.ct * ev.ct - ev.x * ev.x;
            const causal = s2 > 0.001 ? (ev.ct > 0 ? '类时(未来)' : '类时(过去)')
                : s2 < -0.001 ? '类空' : '类光';

            // 事件到原点的连线
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = col + '66';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(px, py);
            ctx.stroke();
            ctx.setLineDash([]);

            // 事件点
            const isHover = this._stDrag === i;
            ctx.beginPath();
            ctx.arc(px, py, isHover ? 8 : 6, 0, Math.PI * 2);
            ctx.fillStyle = col;
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // 标签
            ctx.fillStyle = col;
            ctx.font = 'bold 16px ' + CF.mono;
            ctx.textAlign = 'left';
            const labelX = px + 10;
            const labelY = py - 6;
            ctx.fillText(`E${i + 1} (${ev.x.toFixed(2)}, ${ev.ct.toFixed(2)})`, labelX, labelY);
            ctx.font = '15px ' + CF.sans;
            ctx.fillStyle = col + 'cc';
            ctx.fillText(causal + '  s²=' + s2.toFixed(3), labelX, labelY + 14);

            // S' 系坐标
            if (beta > 0.01) {
                const t2 = this._lorentzTransform(ev.x, ev.ct, beta);
                ctx.fillStyle = moveColor + 'cc';
                ctx.fillText(`S': (${t2.x.toFixed(2)}, ${t2.ct.toFixed(2)})`, labelX, labelY + 26);
            }
        }

        // ── 提示文字 ──
        if (this.stEvents.length === 0) {
            ctx.fillStyle = 'rgba(200,210,240,0.35)';
            ctx.font = '17px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.fillText('点击添加事件 · 拖拽移动 · 双击删除', cx, cy + axLen + 24);
        }

        // ── 区域标签 ──
        ctx.font = '16px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(200,210,240,0.25)';
        ctx.fillText('未来 (类时)', cx, cy - axLen * 0.6);
        ctx.fillText('过去 (类时)', cx, cy + axLen * 0.65);
        ctx.fillText('类空', cx - axLen * 0.6, cy + 4);
        ctx.fillText('类空', cx + axLen * 0.6, cy + 4);

        // ── 顶部 γ ──
        ctx.fillStyle = '#e8dcc8';
        ctx.font = 'bold 22px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText('γ = ' + this.gamma.toFixed(4), cx, H * 0.06);

        // 底部公式
        ctx.fillStyle = '#8b9dc3';
        ctx.font = '18px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText("s² = (ct)² - x²  (不变间隔)", cx, H * 0.95);
    },

    /* ── Lorentz 变换可视化 (新模式) ── */
    drawLorentz(ctx, W, H) {
        const cx = W * 0.5;
        const cy = H * 0.52;
        const axLen = Math.min(W * 0.36, H * 0.38, 190);
        const beta = this.beta;

        // 平滑动画 beta
        const targetBeta = beta;
        this._ltAnimBeta += (targetBeta - this._ltAnimBeta) * 0.08;
        const ab = this._ltAnimBeta;
        const ag = 1 / Math.sqrt(Math.max(1 - ab * ab, 1e-10));

        const restColor = '#5b8dce';
        const moveColor = '#c4793a';
        const lightColor = '#e8dcc8';
        const eventColors = ['#e74c3c', '#2ecc71', '#f1c40f', '#9b59b6', '#1abc9c', '#e67e22'];

        // ── 左半区：S 系 ──
        const lx = W * 0.25;
        const rx = W * 0.75;
        const half = axLen * 0.9;

        // S 系交互布局（鼠标事件映射到 S 系坐标）
        this._ltLayout = { cx: lx, cy, axLen: half };

        // S 系标签
        ctx.fillStyle = restColor;
        ctx.font = 'bold 19px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText('S 系 (静止)', lx, H * 0.08);

        // S' 系标签
        ctx.fillStyle = moveColor;
        ctx.fillText("S' 系 (v=" + beta.toFixed(2) + "c)", rx, H * 0.08);

        // ── 绘制 S 系坐标网格 ──
        this._drawMiniSpacetime(ctx, lx, cy, half, restColor, 0, '类光线 (45°)');

        // ── 绘制 S' 系坐标网格（变换后） ──
        this._drawMiniSpacetime(ctx, rx, cy, half, moveColor, 0, '类光线');

        // ── 连线箭头 ──
        ctx.strokeStyle = 'rgba(200,210,240,0.3)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(lx + half + 10, cy);
        ctx.lineTo(rx - half - 10, cy);
        ctx.stroke();
        ctx.setLineDash([]);
        // 箭头
        const arrowMid = (lx + half + rx - half) / 2;
        ctx.fillStyle = 'rgba(200,210,240,0.5)';
        ctx.beginPath();
        ctx.moveTo(arrowMid + 6, cy);
        ctx.lineTo(arrowMid - 4, cy - 4);
        ctx.lineTo(arrowMid - 4, cy + 4);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(200,210,240,0.4)';
        ctx.font = '16px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('Lorentz', arrowMid, cy - 10);
        ctx.fillText('变换', arrowMid, cy + 18);

        // ── 在两侧绘制事件点 ──
        for (let i = 0; i < this.lorentzEvents.length; i++) {
            const ev = this.lorentzEvents[i];
            const col = eventColors[i % eventColors.length];

            // S 系
            const sx = lx + ev.x * half;
            const sy = cy - ev.ct * half;
            const isDrag = this._ltDrag === i;
            ctx.beginPath();
            ctx.arc(sx, sy, isDrag ? 8 : 6, 0, Math.PI * 2);
            ctx.fillStyle = col;
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.fillStyle = col;
            ctx.font = 'bold 15px ' + CF.mono;
            ctx.textAlign = 'left';
            ctx.fillText(`E${i + 1}`, sx + 8, sy - 4);

            // S' 系 (Lorentz 变换)
            const t2 = this._lorentzTransform(ev.x, ev.ct, ab);
            const tx = rx + t2.x * half;
            const ty = cy - t2.ct * half;

            // 连线
            ctx.strokeStyle = col + '44';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(tx, ty);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.beginPath();
            ctx.arc(tx, ty, 6, 0, Math.PI * 2);
            ctx.fillStyle = col;
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.fillStyle = col;
            ctx.font = 'bold 15px ' + CF.mono;
            ctx.textAlign = 'left';
            ctx.fillText(`E${i + 1}'`, tx + 8, ty - 4);
        }

        // ── 事件坐标表 ──
        const tableY = cy + half + 20;
        ctx.font = '16px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#8b9dc3';
        ctx.fillText('事件', W * 0.15, tableY);
        ctx.fillStyle = restColor;
        ctx.fillText('S: (x, ct)', W * 0.35, tableY);
        ctx.fillStyle = moveColor;
        ctx.fillText("S': (x', ct')", W * 0.55, tableY);
        ctx.fillStyle = '#8b9dc3';
        ctx.fillText('s² (不变)', W * 0.78, tableY);

        for (let i = 0; i < this.lorentzEvents.length; i++) {
            const ev = this.lorentzEvents[i];
            const t2 = this._lorentzTransform(ev.x, ev.ct, ab);
            const s2 = ev.ct * ev.ct - ev.x * ev.x;
            const col = eventColors[i % eventColors.length];
            const rowY = tableY + 16 + i * 14;
            ctx.fillStyle = col;
            ctx.fillText(`E${i + 1}`, W * 0.15, rowY);
            ctx.fillStyle = restColor;
            ctx.fillText(`(${ev.x.toFixed(2)}, ${ev.ct.toFixed(2)})`, W * 0.35, rowY);
            ctx.fillStyle = moveColor;
            ctx.fillText(`(${t2.x.toFixed(2)}, ${t2.ct.toFixed(2)})`, W * 0.55, rowY);
            ctx.fillStyle = '#8b9dc3';
            ctx.fillText(s2.toFixed(3), W * 0.78, rowY);
        }

        // ── 提示 ──
        if (this.lorentzEvents.length === 0) {
            ctx.fillStyle = 'rgba(200,210,240,0.35)';
            ctx.font = '17px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.fillText('点击左侧坐标系添加事件 · 拖拽移动 · 双击删除', cx, tableY + 10);
        }

        // 顶部 γ
        ctx.fillStyle = '#e8dcc8';
        ctx.font = 'bold 22px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText('v = ' + beta.toFixed(2) + 'c    γ = ' + this.gamma.toFixed(4), cx, H * 0.06);

        // 底部公式
        ctx.fillStyle = '#8b9dc3';
        ctx.font = '18px ' + CF.mono;
        ctx.textAlign = 'center';
        ctx.fillText("x' = γ(x - βct)    ct' = γ(ct - βx)", cx, H * 0.95);
    },

    /** 辅助：绘制小型时空坐标系 */
    _drawMiniSpacetime(ctx, cx, cy, half, color, angle, lightLabel) {
        // 网格
        ctx.strokeStyle = 'rgba(200,210,240,0.06)';
        ctx.lineWidth = 1;
        for (let i = -4; i <= 4; i++) {
            const f = i / 4;
            ctx.beginPath(); ctx.moveTo(cx + f * half, cy - half); ctx.lineTo(cx + f * half, cy + half); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(cx - half, cy + f * half); ctx.lineTo(cx + half, cy + f * half); ctx.stroke();
        }
        // 坐标轴
        ctx.strokeStyle = color + '88';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cx - half, cy); ctx.lineTo(cx + half, cy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx, cy + half); ctx.lineTo(cx, cy - half); ctx.stroke();
        // 光锥
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = '#e8dcc866';
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(cx - half, cy - half); ctx.lineTo(cx + half, cy + half); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + half, cy - half); ctx.lineTo(cx - half, cy + half); ctx.stroke();
        ctx.setLineDash([]);
    },

    /* ── 信息面板 ── */
    updateInfo() {
        const info = document.getElementById('rel-info');
        if (!info) return;

        const g = this.gamma;
        const b = this.beta;

        if (this.mode === 'time') {
            info.innerHTML = `
                <h3>时间膨胀 Time Dilation</h3>
                <p>当物体以接近光速运动时，运动参考系中的时间会变慢。静止观察者测量到的时间间隔 Δt'
                   与运动物体固有时间 Δt 的关系：</p>
                <p style="text-align:center;font-family:var(--font-mono);font-size:1.1em;color:#e8dcc8;">
                    Δt' = γ · Δt = ${g.toFixed(4)} · Δt
                </p>
                <p>当前速度 <strong>v = ${b.toFixed(2)}c</strong>，洛伦兹因子 <strong>γ = ${g.toFixed(4)}</strong>。
                   运动时钟每走 <strong>${(1/g).toFixed(3)}</strong> 秒，静止时钟走 1 秒。</p>`;
        } else if (this.mode === 'length') {
            info.innerHTML = `
                <h3>长度收缩 Length Contraction</h3>
                <p>运动方向上的长度在静止观察者看来会缩短。长度收缩公式：</p>
                <p style="text-align:center;font-family:var(--font-mono);font-size:1.1em;color:#e8dcc8;">
                    L = L₀ / γ = L₀ · √(1 - v²/c²) = ${(1/g).toFixed(4)} · L₀
                </p>
                <p>当前速度 <strong>v = ${b.toFixed(2)}c</strong>，飞船长度收缩为原来的
                   <strong>${(100/g).toFixed(1)}%</strong>。</p>`;
        } else if (this.mode === 'mass') {
            info.innerHTML = `
                <h3>质能等价 Mass-Energy Equivalence</h3>
                <p>爱因斯坦质能关系 E = mc² 是狭义相对论最著名的推论。运动物体的总能量：</p>
                <p style="text-align:center;font-family:var(--font-mono);font-size:1.1em;color:#e8dcc8;">
                    E = γmc² = ${g.toFixed(4)}mc²
                </p>
                <p>其中静止能量 E₀ = mc²，动能 Eₖ = (γ-1)mc² = <strong>${(g-1).toFixed(4)}mc²</strong>。
                   在低速 (v≪c) 时，Eₖ ≈ ½mv²。</p>`;
        } else if (this.mode === 'spacetime') {
            info.innerHTML = `
                <h3>闵可夫斯基时空图 Minkowski Spacetime Diagram</h3>
                <p>时空图是理解狭义相对论的核心工具。纵轴为 <strong>ct</strong>（时间×光速），横轴为 <strong>x</strong>（空间），
                   使得光以 45° 传播。</p>
                <p><strong style="color:#e8dcc8">虚线</strong>：光锥——因果关系的边界。锥内为<em>类时</em>间隔（可到达），锥外为<em>类空</em>间隔（不可到达）。</p>
                <p><strong style="color:#c4793a">橙色轴</strong>：运动参考系的 ct' 和 x' 轴。拖动速度滑块，
                   观察运动坐标轴如何向光锥"夹拢"——这就是同时性的相对性。</p>
                <p>🖱️ <strong>交互</strong>：<em>点击</em>添加事件（最多 6 个）→ <em>拖拽</em>移动 → <em>双击</em>删除。
                   每个事件显示 S 系坐标、因果类型和 S' 系变换坐标。</p>
                <p>不变间隔：<strong style="font-family:var(--font-mono);">s² = (ct)² - x²</strong>，在所有参考系中相同。</p>`;
        } else if (this.mode === 'lorentz') {
            info.innerHTML = `
                <h3>Lorentz 变换 Lorentz Transformation</h3>
                <p>Lorentz 变换是沟通不同惯性参考系的核心数学工具：</p>
                <p style="text-align:center;font-family:var(--font-mono);font-size:1.1em;color:#e8dcc8;">
                    x' = γ(x - βct)&emsp;&emsp;ct' = γ(ct - βx)
                </p>
                <p>左侧为 S 系（静止），右侧为 S' 系（以 v = ${b.toFixed(2)}c 运动）。
                   同一个事件在两个参考系中有不同坐标，但<strong>不变间隔 s² = (ct)² - x²</strong> 保持相同。</p>
                <p>🖱️ <strong>交互</strong>：在左侧坐标系中<em>点击</em>添加事件 → <em>拖拽</em>移动 → <em>双击</em>删除。
                   右侧自动显示变换后的位置。拖动速度滑块观察坐标变化。</p>
                <p>底部表格实时验证 s² 在变换前后保持不变（数值精度内）。</p>`;
        } else if (this.mode === 'velocity') {
            const u = this.velU;
            const classVal = (u + b).toFixed(3);
            const relVal = ((u + b) / (1 + u * b)).toFixed(3);
            info.innerHTML = `
                <h3>速度叠加 Velocity Addition</h3>
                <p>经典力学中，速度直接相加：u' = u + v。但在狭义相对论中，速度叠加公式为：</p>
                <p style="text-align:center;font-family:var(--font-mono);font-size:1.1em;color:#e8dcc8;">
                    u' = (u + v) / (1 + uv/c²)
                </p>
                <p>这保证了合成速度永远不会超过光速 c。</p>
                <p>当前参数：v = ${b.toFixed(2)}c，u = ${u.toFixed(2)}c →
                   经典 = <strong style="color:#5b8dce">${classVal}c</strong>，
                   相对论 = <strong style="color:#c4793a">${relVal}c</strong>，
                   差异 = <strong>${(parseFloat(classVal) - parseFloat(relVal)).toFixed(3)}c</strong>。</p>
                <p>🎛️ 使用<strong>物体速度 u 滑块</strong>控制图上的标记点位置，直观对比两种理论的预测差异。</p>`;
        } else if (this.mode === 'twins') {
            const D = this.twinDist;
            const totalT = b > 0.01 ? (2 * D / b) : Infinity;
            const properT = totalT / g;
            const ageDiff = totalT - properT;
            info.innerHTML = `
                <h3>双生子佯谬 Twin Paradox</h3>
                <p>一对双胞胎，一人留在地球，一人乘飞船以 v = ${b.toFixed(2)}c 前往 <strong>D = ${D.toFixed(1)} 光年</strong>外的星球并返回。</p>
                <p>地球坐标时：Δt = 2D/v = <strong>${b > 0.01 ? totalT.toFixed(2) : '∞'}</strong> 年<br>
                   旅行者固有时：τ = Δt/γ = <strong>${b > 0.01 ? properT.toFixed(2) : '∞'}</strong> 年<br>
                   年龄差：<strong>${b > 0.01 ? ageDiff.toFixed(2) : '0'}</strong> 年</p>
                <p>"佯谬"在于：从旅行者角度看，地球也在运动，时间应该变慢。但关键是<strong>旅行者经历了加速（转向）</strong>，
                   两个参考系<em>不对称</em>——旅行者不是惯性系，所以旅行者确实比地球人年轻。</p>
                <p>🎛️ 调节<strong>旅行距离</strong>滑块，观察不同距离下的年龄差变化。</p>`;
        } else if (this.mode === 'doppler') {
            const approach = b < 0.999 ? Math.sqrt((1+b)/(1-b)) : 30;
            const recede = b < 0.999 ? Math.sqrt((1-b)/(1+b)) : 0.03;
            info.innerHTML = `
                <h3>相对论多普勒效应 Relativistic Doppler Effect</h3>
                <p>当光源相对于观察者运动时，观测到的频率会发生变化。与经典多普勒不同，相对论多普勒还包含时间膨胀的贡献。</p>
                <p style="text-align:center;font-family:var(--font-mono);font-size:1.1em;color:#e8dcc8;">
                    f_接近 = f₀ · √((1+β)/(1-β)) = ${approach.toFixed(3)}f₀
                </p>
                <p style="text-align:center;font-family:var(--font-mono);font-size:1.1em;color:#e8dcc8;">
                    f_远离 = f₀ · √((1-β)/(1+β)) = ${recede.toFixed(3)}f₀
                </p>
                <p><strong style="color:#3498db">蓝移</strong>（接近）：频率增大、波长缩短 →
                   <strong style="color:#e74c3c">红移</strong>（远离）：频率降低、波长拉长。</p>
                <p>天文学中的<strong>宇宙学红移</strong>就是基于此原理，用于测量星系的退行速度。</p>`;
        }
    }
};

function initRelativity() {
    RelativityDemo.init();
}
