// ===== 力学模拟引擎 (v2) =====
// ResizeObserver + DPR + 教育面板 + destroy

const PhysicsSim = {
    canvas: null,
    ctx: null,
    balls: [],
    running: false,
    paused: false,
    lastTime: 0,
    fpsFrames: 0,
    fpsTime: 0,
    currentFps: 0,

    // 可调参数
    gravity: 980,
    restitution: 0.75,
    friction: 0.10,
    ballRadius: 16,

    // 拖拽发射
    dragStart: null,
    dragEnd: null,
    isDragging: false,

    // 颜色调色板（紫色系，匹配物理页主题）
    palette: [
        '#8b6fc0', '#a78bfa', '#7c3aed', '#6366f1',
        '#818cf8', '#c084fc', '#e879f9', '#a855f7'
    ],

    _resizeObs: null,
    _raf: null,
    _listeners: [],

    init() {
        this.destroy();
        this.canvas = document.getElementById('physics-canvas');
        if (!this.canvas) return;

        this.ctx = this.canvas.getContext('2d');
        this.resizeCanvas();
        this.bindControls();
        this.bindCanvas();

        // ResizeObserver
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver(() => this.resizeCanvas());
            this._resizeObs.observe(this.canvas.parentElement);
        }
        this._on(window, 'resize', () => this.resizeCanvas());
        this._on(this.canvas, 'astra:physics-zoom-restored', () => this.resizeCanvas());
    },

    destroy() {
        this.running = false;
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
        if (this._resizeObs) { this._resizeObs.disconnect(); this._resizeObs = null; }
        this._listeners.forEach(({ el, event, handler, options }) => {
            el.removeEventListener(event, handler, options);
        });
        this._listeners = [];
        this.isDragging = false;
        this.dragStart = null;
        this.dragEnd = null;
        this.canvas = null;
        this.ctx = null;
    },

    _on(el, event, handler, options) {
        if (!el) return;
        el.addEventListener(event, handler, options);
        this._listeners.push({ el, event, handler, options });
    },

    _recordEvidence(operation, cursor) {
        window.dispatchEvent(new CustomEvent('astra:learning-domain-command', {
            detail: {
                galaxy_key: 'englab',
                activity_key: 'physics.mechanics',
                event_type: 'attempted',
                evidence: { operation, cursor }
            }
        }));
    },

    resizeCanvas() {
        if (!this.canvas) return null;
        if (window.PhysicsZoom && window.PhysicsZoom.movedCanvas === this.canvas) return null;
        return this._resizeToContainer(this.canvas.parentElement, false);
    },

    resizeForZoom(originalParent) {
        if (
            !this.canvas
            || !originalParent
            || !window.PhysicsZoom
            || window.PhysicsZoom.movedCanvas !== this.canvas
        ) return null;
        return this._resizeToContainer(originalParent, true);
    },

    _resizeToContainer(container, renderImmediately) {
        if (!container || typeof container.getBoundingClientRect !== 'function') return null;
        const w = Number(container.getBoundingClientRect().width);
        if (!Number.isFinite(w) || w <= 0) return null;
        // 用宽度推算高度，防止 ResizeObserver 循环膨胀
        const h = Math.min(Math.max(w * 0.56, 320), 560);
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.max(1, Math.round(w * dpr));
        this.canvas.height = Math.max(1, Math.round(h * dpr));
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w;
        this.H = h;
        if (renderImmediately) this.render();
        return Object.freeze({
            width: w,
            height: h,
            dpr,
            bitmapWidth: this.canvas.width,
            bitmapHeight: this.canvas.height
        });
    },

    bindControls() {
        const gravSlider = document.getElementById('gravity-slider');
        const restSlider = document.getElementById('restitution-slider');
        const fricSlider = document.getElementById('friction-slider');
        const radSlider = document.getElementById('radius-slider');
        const clearBtn = document.getElementById('physics-clear');
        const pauseBtn = document.getElementById('physics-pause');

        this._on(gravSlider, 'input', () => {
            this.gravity = +gravSlider.value;
            document.getElementById('gravity-value').textContent = gravSlider.value;
        });
        this._on(gravSlider, 'change', () => this._recordEvidence('gravity_adjustment', {
            parameter: 'gravity',
            band: this.gravity < 650 ? 'low' : this.gravity > 1300 ? 'high' : 'medium'
        }));

        this._on(restSlider, 'input', () => {
            this.restitution = +restSlider.value / 100;
            document.getElementById('restitution-value').textContent = this.restitution.toFixed(2);
        });
        this._on(restSlider, 'change', () => this._recordEvidence('restitution_adjustment', {
            parameter: 'restitution',
            band: this.restitution < .4 ? 'low' : this.restitution > .8 ? 'high' : 'medium'
        }));

        this._on(fricSlider, 'input', () => {
            this.friction = +fricSlider.value / 100;
            document.getElementById('friction-value').textContent = this.friction.toFixed(2);
        });
        this._on(fricSlider, 'change', () => this._recordEvidence('friction_adjustment', {
            parameter: 'friction',
            band: this.friction < .2 ? 'low' : this.friction > .65 ? 'high' : 'medium'
        }));

        this._on(radSlider, 'input', () => {
            this.ballRadius = +radSlider.value;
            document.getElementById('radius-value').textContent = radSlider.value;
        });
        this._on(radSlider, 'change', () => this._recordEvidence('radius_adjustment', {
            parameter: 'radius',
            band: this.ballRadius < 16 ? 'small' : this.ballRadius > 28 ? 'large' : 'medium'
        }));

        this._on(clearBtn, 'click', () => {
            this.resetScene();
        });

        this._on(pauseBtn, 'click', () => {
            this.paused = !this.paused;
            pauseBtn.textContent = this.paused ? '继续' : '暂停';
        });
    },

    resetScene() {
        this.balls = [];
        this.gravity = 980;
        this.restitution = 0.75;
        this.friction = 0.10;
        this.ballRadius = 16;
        this.paused = false;

        const set = (id, value, outId, fmt) => {
            const el = document.getElementById(id);
            const out = document.getElementById(outId);
            if (el) el.value = value;
            if (out) out.textContent = fmt ? fmt(value) : String(value);
        };
        set('gravity-slider', 980, 'gravity-value');
        set('restitution-slider', 75, 'restitution-value', v => (v / 100).toFixed(2));
        set('friction-slider', 10, 'friction-value', v => (v / 100).toFixed(2));
        set('radius-slider', 16, 'radius-value');

        const pauseBtn = document.getElementById('physics-pause');
        if (pauseBtn) pauseBtn.textContent = '暂停';

        this.updateStats();
        this.render();
    },

    bindCanvas() {
        const getPos = (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            return { x: clientX - rect.left, y: clientY - rect.top };
        };

        // Mouse
        this._on(this.canvas, 'mousedown', (e) => {
            this.dragStart = getPos(e);
            this.isDragging = true;
        });

        this._on(this.canvas, 'mousemove', (e) => {
            if (this.isDragging) this.dragEnd = getPos(e);
        });

        this._on(this.canvas, 'mouseup', (e) => {
            if (this.isDragging && this.dragStart) {
                const end = getPos(e);
                this.launchBall(this.dragStart, end);
            }
            this.isDragging = false;
            this.dragStart = null;
            this.dragEnd = null;
        });

        // Touch
        this._on(this.canvas, 'touchstart', (e) => {
            e.preventDefault();
            this.dragStart = getPos(e);
            this.isDragging = true;
        }, { passive: false });

        this._on(this.canvas, 'touchmove', (e) => {
            e.preventDefault();
            if (this.isDragging) this.dragEnd = getPos(e);
        }, { passive: false });

        this._on(this.canvas, 'touchend', (e) => {
            if (this.isDragging && this.dragStart) {
                const end = this.dragEnd || this.dragStart;
                this.launchBall(this.dragStart, end);
            }
            this.isDragging = false;
            this.dragStart = null;
            this.dragEnd = null;
        });
    },

    launchBall(start, end) {
        const dx = start.x - end.x;
        const dy = start.y - end.y;
        const speed = Math.sqrt(dx * dx + dy * dy) * 3;
        const angle = Math.atan2(dy, dx);

        // Cap at 100 balls for performance
        if (this.balls.length >= 100) {
            this.balls.shift();
        }

        this.balls.push({
            x: start.x,
            y: start.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            r: this.ballRadius,
            color: this.palette[Math.floor(Math.random() * this.palette.length)],
            trail: []
        });

        this._recordEvidence('simulation_launch', {
            speed_band: speed < 240 ? 'low' : speed > 720 ? 'high' : 'medium',
            radius_band: this.ballRadius < 16 ? 'small' : this.ballRadius > 28 ? 'large' : 'medium'
        });
        this.updateStats();
    },

    start() {
        if (this.running) return;
        this.running = true;
        this.lastTime = performance.now();
        this.fpsTime = this.lastTime;
        this.loop();
    },

    stop() {
        this.running = false;
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    },

    loop() {
        if (!this.running) return;
        this._raf = requestAnimationFrame(() => this.loop());

        const now = performance.now();
        const dt = Math.min((now - this.lastTime) / 1000, 0.032); // Cap at ~30fps min
        this.lastTime = now;

        // FPS counter
        this.fpsFrames++;
        if (now - this.fpsTime >= 500) {
            this.currentFps = Math.round(this.fpsFrames / ((now - this.fpsTime) / 1000));
            this.fpsFrames = 0;
            this.fpsTime = now;
            const el = document.getElementById('physics-fps');
            if (el) el.textContent = this.currentFps;
        }

        if (!this.paused) this.update(dt);
        this.render();
    },

    update(dt) {
        const g = this.gravity;
        const rest = this.restitution;
        const fric = this.friction;

        for (let i = 0; i < this.balls.length; i++) {
            const b = this.balls[i];

            // Gravity
            b.vy += g * dt;

            // Apply friction (air resistance)
            b.vx *= (1 - fric * dt);
            b.vy *= (1 - fric * 0.3 * dt);

            // Move
            b.x += b.vx * dt;
            b.y += b.vy * dt;

            // Trail (store last 8 positions)
            b.trail.push({ x: b.x, y: b.y });
            if (b.trail.length > 8) b.trail.shift();

            // Wall collisions
            if (b.x - b.r < 0) {
                b.x = b.r;
                b.vx = Math.abs(b.vx) * rest;
            }
            if (b.x + b.r > this.W) {
                b.x = this.W - b.r;
                b.vx = -Math.abs(b.vx) * rest;
            }
            if (b.y + b.r > this.H) {
                b.y = this.H - b.r;
                b.vy = -Math.abs(b.vy) * rest;

                // Friction on ground
                b.vx *= (1 - fric);

                // Stop micro-bouncing
                if (Math.abs(b.vy) < 15) {
                    b.vy = 0;
                    b.y = this.H - b.r;
                }
            }
            if (b.y - b.r < 0) {
                b.y = b.r;
                b.vy = Math.abs(b.vy) * rest;
            }

            // Ball-to-ball collisions
            for (let j = i + 1; j < this.balls.length; j++) {
                this.resolveCollision(b, this.balls[j]);
            }
        }
    },

    resolveCollision(a, b) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = a.r + b.r;

        if (dist >= minDist || dist === 0) return;

        // Normalize
        const nx = dx / dist;
        const ny = dy / dist;

        // Separate
        const overlap = (minDist - dist) / 2;
        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;

        // Relative velocity along normal
        const dvx = a.vx - b.vx;
        const dvy = a.vy - b.vy;
        const relVn = dvx * nx + dvy * ny;

        if (relVn < 0) return; // Moving apart

        // Equal mass elastic collision with restitution
        const impulse = relVn * (1 + this.restitution) / 2;
        a.vx -= impulse * nx;
        a.vy -= impulse * ny;
        b.vx += impulse * nx;
        b.vy += impulse * ny;
    },

    render() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.W, this.H);

        // Subtle grid
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.lineWidth = 1;
        const gridSize = 40;
        for (let x = gridSize; x < this.W; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, this.H);
            ctx.stroke();
        }
        for (let y = gridSize; y < this.H; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(this.W, y);
            ctx.stroke();
        }

        // Ground line
        ctx.strokeStyle = 'rgba(139,111,192,0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, this.H - 1);
        ctx.lineTo(this.W, this.H - 1);
        ctx.stroke();

        // Balls
        for (const b of this.balls) {
            // Trail
            if (b.trail.length > 1) {
                const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
                if (speed > 30) {
                    ctx.beginPath();
                    ctx.moveTo(b.trail[0].x, b.trail[0].y);
                    for (let t = 1; t < b.trail.length; t++) {
                        ctx.lineTo(b.trail[t].x, b.trail[t].y);
                    }
                    ctx.strokeStyle = b.color + '30';
                    ctx.lineWidth = b.r * 0.6;
                    ctx.lineCap = 'round';
                    ctx.stroke();
                }
            }

            // Ball body
            const gradient = ctx.createRadialGradient(
                b.x - b.r * 0.3, b.y - b.r * 0.3, 0,
                b.x, b.y, b.r
            );
            gradient.addColorStop(0, b.color + 'ff');
            gradient.addColorStop(0.7, b.color + 'cc');
            gradient.addColorStop(1, b.color + '66');

            ctx.beginPath();
            ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
            ctx.fillStyle = gradient;
            ctx.fill();

            // Highlight
            ctx.beginPath();
            ctx.arc(b.x - b.r * 0.25, b.y - b.r * 0.25, b.r * 0.35, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,0.2)';
            ctx.fill();

            // Shadow on ground
            if (b.y + b.r < this.H) {
                const shadowY = this.H - 2;
                const proximity = 1 - ((shadowY - b.y) / this.H);
                const shadowR = b.r * (0.5 + proximity * 0.5);
                ctx.beginPath();
                ctx.ellipse(b.x, shadowY, shadowR, 3, 0, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(0,0,0,${proximity * 0.15})`;
                ctx.fill();
            }
        }

        // Drag arrow
        if (this.isDragging && this.dragStart && this.dragEnd) {
            const dx = this.dragStart.x - this.dragEnd.x;
            const dy = this.dragStart.y - this.dragEnd.y;
            const len = Math.sqrt(dx * dx + dy * dy);

            if (len > 5) {
                ctx.save();
                ctx.strokeStyle = 'rgba(167,139,250,0.6)';
                ctx.lineWidth = 2;
                ctx.setLineDash([6, 4]);
                ctx.beginPath();
                ctx.moveTo(this.dragStart.x, this.dragStart.y);
                ctx.lineTo(this.dragStart.x + dx, this.dragStart.y + dy);
                ctx.stroke();
                ctx.setLineDash([]);

                // Arrowhead
                const angle = Math.atan2(dy, dx);
                const aLen = 10;
                ctx.fillStyle = 'rgba(167,139,250,0.6)';
                ctx.beginPath();
                ctx.moveTo(this.dragStart.x + dx, this.dragStart.y + dy);
                ctx.lineTo(
                    this.dragStart.x + dx - aLen * Math.cos(angle - 0.4),
                    this.dragStart.y + dy - aLen * Math.sin(angle - 0.4)
                );
                ctx.lineTo(
                    this.dragStart.x + dx - aLen * Math.cos(angle + 0.4),
                    this.dragStart.y + dy - aLen * Math.sin(angle + 0.4)
                );
                ctx.fill();
                ctx.restore();

                // Preview ball
                ctx.beginPath();
                ctx.arc(this.dragStart.x, this.dragStart.y, this.ballRadius, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(167,139,250,0.5)';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        }

        // Empty state hint
        if (this.balls.length === 0 && !this.isDragging) {
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            ctx.font = '20px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.fillText('在画布上拖拽来发射小球', this.W / 2, this.H / 2 - 10);
            ctx.font = '18px ' + CF.sans;
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            ctx.fillText('拖拽方向和距离决定发射速度', this.W / 2, this.H / 2 + 15);
        }
    },

    updateStats() {
        const el = document.getElementById('ball-count');
        if (el) el.textContent = this.balls.length;
        this.updateEdu();
    },

    updateEdu() {
        let eduEl = document.getElementById('physics-edu');
        if (!eduEl) {
            const parent = document.getElementById('physics-info') || document.getElementById('ball-count')?.closest('.physics-info');
            if (!parent) return;
            const container = parent.parentElement || parent;
            eduEl = document.createElement('div');
            eduEl.id = 'physics-edu';
            eduEl.style.cssText = 'font-size:12px;color:#a78bfa;margin-top:8px;line-height:1.5;opacity:0.8;';
            container.appendChild(eduEl);
        }
        if (this.balls.length === 0) {
            eduEl.innerHTML = `<strong>牵引探索</strong>：在画布上拖拽发射小球，观察牵引力、弹性碰撞与摩擦力的作用。`;
        } else {
            const totalKE = this.balls.reduce((s, b) => s + 0.5 * (b.vx * b.vx + b.vy * b.vy), 0);
            const totalPE = this.balls.reduce((s, b) => s + this.gravity * (this.H - b.y), 0);
            eduEl.innerHTML =
                `<strong>牛顿力学</strong>：` +
                `F=ma，重力 g=${this.gravity} px/s²，恢复系数 e=${this.restitution.toFixed(2)}，摩擦 μ=${this.friction.toFixed(2)}` +
                `<br>球数: ${this.balls.length}，` +
                `总动能 ∝ ${totalKE.toFixed(0)}，` +
                `总势能 ∝ ${totalPE.toFixed(0)}，` +
                `E<sub>total</sub> ∝ ${(totalKE + totalPE).toFixed(0)}` +
                `<br>ℹ️ 弹性碰撞守恒动量·非完全弹性碰撞损失动能`;
        }
    }
};

// ===== 物理页初始化 =====
function initPhysics() {
    PhysicsSim.init();
    PhysicsSim.start();
}

window.PhysicsSim = PhysicsSim;
