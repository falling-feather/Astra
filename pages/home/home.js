// ═══════════════════════════════════════════════════════════════
// 工科实验室 · 首页逻辑  v7.0 (qianduan 重构)
// 契约: window.initHome / window.selectModule /
//       window.SatelliteSystem / window.ParticleNetwork
// ═══════════════════════════════════════════════════════════════
const _isReturningVisitor = !!(window.__englabCache && window.__englabCache.returnVisitor);

// ===== 粒子网络系统（OffscreenCanvas Worker 优先） =====
const ParticleNetwork = {
    canvas: null, ctx: null,
    particles: [],
    mouse: { x: -1000, y: -1000 },
    maxDist: 124,
    W: 0, H: 0,
    running: false,
    _resizeObs: null,
    _hidden: false,

    // ── FPS 自适应 ──
    _fpsFrames: 0,
    _fpsTime: 0,
    _fps: 60,
    _targetCount: 0,
    _maxParticles: 80,

    // ── 空间网格 ──
    _grid: null,
    _gridCols: 0,
    _gridRows: 0,
    _cellSize: 0,

    // ── OffscreenCanvas Worker ──
    _worker: null,
    _useWorker: false,
    _canvasTransferred: false,
    _dpr: 1,
    _initing: false,
    _mouseBound: false,
    _visibilityBound: false,

    init() {
        this.canvas = document.getElementById('particle-network');
        if (!this.canvas || this._initing || this.running) return;
        const homePage = document.getElementById('page-home');
        if (homePage && !homePage.classList.contains('active')) return;

        this._maxParticles = (typeof _isLowEnd !== 'undefined' && _isLowEnd) ? 28 : 48;
        this._cellSize = this.maxDist;
        this._initing = true;
        this._tryInit(0);
    },

    _measure() {
        const parent = this.canvas.parentElement;
        const w = parent && parent.clientWidth > 0 ? parent.clientWidth : window.innerWidth;
        const h = parent && parent.clientHeight > 0 ? parent.clientHeight : window.innerHeight;
        return { w, h };
    },

    _tryInit(attempt) {
        const { w, h } = this._measure();
        if ((w < 8 || h < 8) && attempt < 48) {
            requestAnimationFrame(() => this._tryInit(attempt + 1));
            return;
        }
        if (w < 8 || h < 8) {
            this._initing = false;
            return;
        }

        const preferDirect = typeof _isLowEnd !== 'undefined' && _isLowEnd;
        const canWorker = !preferDirect &&
            typeof this.canvas.transferControlToOffscreen === 'function' &&
            typeof Worker !== 'undefined' &&
            !this.canvas.dataset.workerFailed;

        if (canWorker) {
            try {
                this._initWorker(w, h);
                this._initing = false;
                return;
            } catch (e) {
                console.warn('[ParticleNetwork] OffscreenCanvas 回退:', e);
                if (this._worker) {
                    this._worker.terminate();
                    this._worker = null;
                }
                this._useWorker = false;
                this._replaceTransferredCanvas(true);
            }
        }

        this._initDirect();
        this._initing = false;
    },

    /** OffscreenCanvas + Web Worker 渲染路径 */
    _initWorker(w, h) {
        const lowEnd = typeof _isLowEnd !== 'undefined' && _isLowEnd;
        this._dpr = lowEnd ? Math.min(window.devicePixelRatio || 1, 1.25) : Math.min(window.devicePixelRatio || 1, 1.5);
        const offscreen = this.canvas.transferControlToOffscreen();
        this._canvasTransferred = true;
        this._worker = new Worker('shared/workers/particle-worker.js');
        this._useWorker = true;

        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.W = w; this.H = h;

        this._worker.onerror = (e) => {
            console.warn('[ParticleNetwork] Worker 异常，停止后台渲染:', e.message || e);
            this.running = false;
            if (this._worker) {
                this._worker.terminate();
                this._worker = null;
            }
            this._useWorker = false;
            this._replaceTransferredCanvas(true);
            const homePage = document.getElementById('page-home');
            if (!homePage || homePage.classList.contains('active')) this._initDirect();
        };

        this._worker.postMessage({
            type: 'init', canvas: offscreen,
            width: w, height: h, dpr: this._dpr,
            maxParticles: this._maxParticles
        }, [offscreen]);

        this.running = true;
        this._bindSharedListeners();
    },

    _bindSharedListeners() {
        if (!this._mouseBound) {
            this._mouseBound = true;
            document.addEventListener('mousemove', e => {
                this.mouse.x = e.clientX;
                this.mouse.y = e.clientY;
                if (this._worker) this._worker.postMessage({ type: 'mouse', x: e.clientX, y: e.clientY });
            });
        }

        if (!this._resizeObs && typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver(() => {
                const { w: nw, h: nh } = this._measure();
                if (nw < 8 || nh < 8) return;
                this.canvas.style.width = nw + 'px';
                this.canvas.style.height = nh + 'px';
                this.W = nw; this.H = nh;
                if (this._worker) this._worker.postMessage({ type: 'resize', width: nw, height: nh, dpr: this._dpr });
                else if (this.ctx) { this.resize(); this.spawn(); }
            });
            this._resizeObs.observe(this.canvas.parentElement);
        }

        if (!this._visibilityBound) {
            this._visibilityBound = true;
            document.addEventListener('visibilitychange', () => {
                this._hidden = document.hidden;
                if (this._worker) {
                    this._worker.postMessage({ type: 'visibility', hidden: document.hidden });
                } else if (!this._hidden && this.running) {
                    this._fpsTime = performance.now();
                    this._fpsFrames = 0;
                }
            });
        }
    },

    /** 主线程直接渲染路径（OffscreenCanvas 不可用时的回退） */
    _initDirect() {
        if (this._useWorker) return;
        this.ctx = this.canvas.getContext('2d', { alpha: true });
        if (!this.ctx) return;
        this.resize();
        this._bindSharedListeners();

        if (!this._resizeObs && typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', () => { this.resize(); this.spawn(); });
        }

        this.spawn();
        this.running = true;
        this._fpsTime = performance.now();
        this.loop();
    },

    /**
     * transferControlToOffscreen() is irreversible for a canvas element. Replace
     * the transferred node before falling back or re-entering the home page so a
     * fresh rendering context can be created without InvalidStateError.
     */
    _replaceTransferredCanvas(markWorkerFailed = false) {
        if (!this.canvas || !this._canvasTransferred) {
            if (markWorkerFailed && this.canvas) this.canvas.dataset.workerFailed = '1';
            return;
        }
        const replacement = this.canvas.cloneNode(false);
        if (markWorkerFailed) replacement.dataset.workerFailed = '1';
        else delete replacement.dataset.workerFailed;
        this.canvas.replaceWith(replacement);
        this.canvas = replacement;
        this.ctx = null;
        this._canvasTransferred = false;
    },

    destroy() {
        this.running = false;
        this._initing = false;
        if (this._worker) {
            this._worker.postMessage({ type: 'destroy' });
            this._worker.terminate();
            this._worker = null;
        }
        this._useWorker = false;
        if (this._resizeObs) { this._resizeObs.disconnect(); this._resizeObs = null; }
        this._replaceTransferredCanvas(false);
    },

    resize() {
        const lowEnd = typeof _isLowEnd !== 'undefined' && _isLowEnd;
        const dpr = lowEnd ? Math.min(window.devicePixelRatio || 1, 1.25) : Math.min(window.devicePixelRatio || 1, 1.5);
        const measured = this._measure ? this._measure() : { w: window.innerWidth, h: window.innerHeight };
        const w = measured.w;
        const h = measured.h;
        if (!this.canvas || w < 8 || h < 8) return;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w;
        this.H = h;
        this._gridCols = Math.ceil(w / this._cellSize) + 1;
        this._gridRows = Math.ceil(h / this._cellSize) + 1;
    },

    spawn() {
        const area = this.W * this.H;
        this._targetCount = Math.min(Math.floor(area / 18000), this._maxParticles);
        this.particles = [];
        for (let i = 0; i < this._targetCount; i++) {
            this.particles.push({
                x: Math.random() * this.W,
                y: Math.random() * this.H,
                vx: (Math.random() - 0.5) * 0.4,
                vy: (Math.random() - 0.5) * 0.4,
                r: 1 + Math.random() * 1.5
            });
        }
    },

    /** 基于实际帧率自适应调整粒子数量 */
    _adaptParticleCount() {
        this._fpsFrames++;
        const now = performance.now();
        const elapsed = now - this._fpsTime;
        if (elapsed < 1000) return;

        this._fps = Math.round(this._fpsFrames * 1000 / elapsed);
        this._fpsFrames = 0;
        this._fpsTime = now;

        const particles = this.particles;
        if (this._fps < 25 && particles.length > 20) {
            const remove = Math.max(2, Math.floor(particles.length * 0.2));
            particles.splice(particles.length - remove, remove);
            this._targetCount = particles.length;
        } else if (this._fps > 50 && particles.length < this._targetCount) {
            const add = Math.min(4, this._targetCount - particles.length);
            for (let i = 0; i < add; i++) {
                particles.push({
                    x: Math.random() * this.W,
                    y: Math.random() * this.H,
                    vx: (Math.random() - 0.5) * 0.4,
                    vy: (Math.random() - 0.5) * 0.4,
                    r: 1 + Math.random() * 1.5
                });
            }
        }
    },

    /** 构建空间网格 */
    _buildGrid() {
        const cols = this._gridCols, rows = this._gridRows;
        const cs = this._cellSize;
        const grid = new Array(cols * rows);
        for (let k = 0; k < grid.length; k++) grid[k] = [];
        const particles = this.particles;
        for (let i = 0; i < particles.length; i++) {
            const c = Math.min(cols - 1, (particles[i].x / cs) | 0);
            const r = Math.min(rows - 1, (particles[i].y / cs) | 0);
            grid[r * cols + c].push(i);
        }
        this._grid = grid;
    },

    loop() {
        if (!this.running) return;
        requestAnimationFrame(() => this.loop());
        if (this._hidden) return;

        this._adaptParticleCount();

        const { ctx, particles, mouse, maxDist, W, H } = this;
        const maxDist2 = maxDist * maxDist;
        const mouseDist = maxDist * 1.5;
        const mouseDist2 = mouseDist * mouseDist;
        ctx.clearRect(0, 0, W, H);

        ctx.fillStyle = 'rgba(120,184,255,0.4)';
        ctx.beginPath();
        for (const p of particles) {
            p.x += p.vx;
            p.y += p.vy;
            if (p.x < 0 || p.x > W) p.vx *= -1;
            if (p.y < 0 || p.y > H) p.vy *= -1;

            const dx = mouse.x - p.x, dy = mouse.y - p.y;
            const dist2 = dx * dx + dy * dy;
            if (dist2 < 40000) {
                p.vx += dx * 0.00005;
                p.vy += dy * 0.00005;
            }

            ctx.moveTo(p.x + p.r, p.y);
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        }
        ctx.fill();

        this._buildGrid();
        const grid = this._grid;
        const cols = this._gridCols, rows = this._gridRows;
        const cs = this._cellSize;

        ctx.lineWidth = 0.5;
        const bins = [[], [], [], []];

        for (let i = 0; i < particles.length; i++) {
            const pi = particles[i];
            const gc = Math.min(cols - 1, (pi.x / cs) | 0);
            const gr = Math.min(rows - 1, (pi.y / cs) | 0);

            for (let dr = -1; dr <= 1; dr++) {
                const nr = gr + dr;
                if (nr < 0 || nr >= rows) continue;
                for (let dc = -1; dc <= 1; dc++) {
                    const nc = gc + dc;
                    if (nc < 0 || nc >= cols) continue;
                    const cell = grid[nr * cols + nc];
                    for (let k = 0; k < cell.length; k++) {
                        const j = cell[k];
                        if (j <= i) continue;
                        const pj = particles[j];
                        const dx = pi.x - pj.x;
                        const dy = pi.y - pj.y;
                        const d2 = dx * dx + dy * dy;
                        if (d2 < maxDist2) {
                            const ratio = 1 - Math.sqrt(d2) / maxDist;
                            const bin = Math.min(3, (ratio * 4) | 0);
                            bins[bin].push(i, j);
                        }
                    }
                }
            }
            const mdx = mouse.x - pi.x;
            const mdy = mouse.y - pi.y;
            const md2 = mdx * mdx + mdy * mdy;
            if (md2 < mouseDist2) {
                const ratio = 1 - Math.sqrt(md2) / mouseDist;
                const bin = Math.min(3, (ratio * 4) | 0);
                bins[bin].push(i, -1);
            }
        }

        const alphas = [0.03, 0.06, 0.09, 0.12];
        for (let b = 0; b < 4; b++) {
            const arr = bins[b];
            if (!arr.length) continue;
            ctx.strokeStyle = `rgba(120,184,255,${alphas[b]})`;
            ctx.beginPath();
            for (let k = 0; k < arr.length; k += 2) {
                const pi = arr[k], pj = arr[k + 1];
                ctx.moveTo(particles[pi].x, particles[pi].y);
                if (pj === -1) {
                    ctx.lineTo(mouse.x, mouse.y);
                } else {
                    ctx.lineTo(particles[pj].x, particles[pj].y);
                }
            }
            ctx.stroke();
        }
    }
};

// ===== 大标题逐字入场 =====
function initHeadingChars() {
    const title = document.getElementById('home-title');
    if (!title) return;
    const text = title.dataset.text || title.textContent.trim();
    title.dataset.text = text;
    title.innerHTML = Array.from(text).map((ch, i) =>
        `<span class="home-heading__char" style="--ci:${i}">${ch}</span>`
    ).join('');
}

// ===== 打字机标语 =====
const TaglineTyper = {
    phrases: [
        '星序 Astra · 多星系可视化学习平台',
        'Visualize. Interact. Understand.',
        '数学 · 物理 · 化学 · 算法 · 生物',
        '从抽象到直觉，从公式到画面'
    ],
    idx: 0,
    el: null,
    charIdx: 0,
    deleting: false,
    timeout: null,

    init() {
        this.el = document.getElementById('tagline-text');
        if (!this.el) return;
        if (this.timeout) clearTimeout(this.timeout);
        this.el.textContent = '';
        this.charIdx = 0;
        this.deleting = false;
        this.tick();
    },

    tick() {
        const phrase = this.phrases[this.idx];
        if (!this.deleting) {
            this.charIdx++;
            this.el.textContent = phrase.slice(0, this.charIdx);
            if (this.charIdx >= phrase.length) {
                this.timeout = setTimeout(() => { this.deleting = true; this.tick(); }, 3000);
                return;
            }
            this.timeout = setTimeout(() => this.tick(), 60 + Math.random() * 40);
        } else {
            this.charIdx--;
            this.el.textContent = phrase.slice(0, this.charIdx);
            if (this.charIdx <= 0) {
                this.deleting = false;
                this.idx = (this.idx + 1) % this.phrases.length;
                this.timeout = setTimeout(() => this.tick(), 400);
                return;
            }
            this.timeout = setTimeout(() => this.tick(), 25);
        }
    }
};

// ===== 3D 场景倾斜（鼠标跟随 · lerp 平滑） =====
const SceneTilt = {
    tx: 0, ty: 0,   // 目标角度
    cx: 0, cy: 0,   // 当前角度
    el: null,
    enabled: true,

    init() {
        this.el = document.getElementById('home-scene');
        this.enabled = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
            && !(typeof _isLowEnd !== 'undefined' && _isLowEnd);
        if (window.__homeTiltBound) return;
        window.__homeTiltBound = true;
        document.addEventListener('mousemove', e => {
            SceneTilt.tx = (e.clientX / window.innerWidth - 0.5) * 2;   // -1 ~ 1
            SceneTilt.ty = (e.clientY / window.innerHeight - 0.5) * 2;
        });
    },

    /** 由 SatelliteSystem 的 rAF 循环驱动 */
    apply() {
        if (!this.el || !this.enabled) return;
        this.cx += (this.tx - this.cx) * 0.045;
        this.cy += (this.ty - this.cy) * 0.045;
        this.el.style.transform =
            `rotateX(${(-this.cy * 3.2).toFixed(3)}deg) rotateY(${(this.cx * 4.2).toFixed(3)}deg)`;
    }
};

// ===== 独立轨道行星系统 =====
const SatelliteSystem = {
    isRunning: true,
    startTime: Date.now(),
    satellites: [],
    orbit: null,
    rafId: null,

    // 每颗行星独立轨道；phase 让首屏分散，避免一加载就挤在同侧。
    orbits: [
        { radiusX: 300, radiusY: 170, tiltX: 65, tiltZ: 25,  period: 26000, dir:  1, phase:  55 },
        { radiusX: 365, radiusY: 212, tiltX: 60, tiltZ: -15, period: 33000, dir: -1, phase: 250 },
        { radiusX: 430, radiusY: 248, tiltX: 70, tiltZ: 35,  period: 41000, dir:  1, phase: 205 },
        { radiusX: 385, radiusY: 224, tiltX: 55, tiltZ: -30, period: 30000, dir: -1, phase: 210 },
        { radiusX: 340, radiusY: 198, tiltX: 62, tiltZ: 18,  period: 36000, dir:  1, phase: 345 }
    ],

    // 移动端缩放轨道半径，避免图标贴边或遮挡底部 CTA。
    getScaledOrbits: function() {
        const w = window.innerWidth;
        if (w <= 480) {
            return this.orbits.map(o => ({ ...o, radiusX: o.radiusX * 0.52, radiusY: o.radiusY * 0.52 }));
        } else if (w <= 768) {
            return this.orbits.map(o => ({ ...o, radiusX: o.radiusX * 0.72, radiusY: o.radiusY * 0.72 }));
        }
        return this.orbits;
    },

    perspective: 1200,
    _lastFrameTime: 0,

    init: function() {
        this.satellites = document.querySelectorAll('.satellite');
        this.orbit = document.getElementById('satellites-orbit');

        if (!this.orbit || this.satellites.length === 0) return;

        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.startTime = Date.now();
        this.isRunning = true;
        this._lastFrameTime = 0;
        this.loop();
    },

    loop: function() {
        if (!this.isRunning) return;
        this.rafId = requestAnimationFrame(this.loop.bind(this));

        // 低端设备帧率限制：约 30fps
        const perfNow = performance.now();
        const minInterval = (typeof _isLowEnd !== 'undefined' && _isLowEnd) ? 33 : 0;
        if (minInterval > 0 && perfNow - this._lastFrameTime < minInterval) return;
        this._lastFrameTime = perfNow;

        SceneTilt.apply();

        const now = Date.now();
        const toRad = Math.PI / 180;
        const scaledOrbits = this.getScaledOrbits();
        // 轨道中心与星球中心对齐（星球 translateY(6vh)）
        const yOff = window.innerHeight * 0.06;

        this.satellites.forEach((sat, index) => {
            if (sat.classList.contains('focusing')) return;
            if (index >= scaledOrbits.length) return;

            const orb = scaledOrbits[index];
            const elapsed = (now - this.startTime) % orb.period;
            const angle = (orb.phase + ((elapsed / orb.period) * 360 * orb.dir)) * toRad;

            const xOrbit = orb.radiusX * Math.cos(angle);
            const yOrbit = orb.radiusY * Math.sin(angle);

            const cosTiltX = Math.cos(orb.tiltX * toRad);
            const sinTiltX = Math.sin(orb.tiltX * toRad);
            const cosTiltZ = Math.cos(orb.tiltZ * toRad);
            const sinTiltZ = Math.sin(orb.tiltZ * toRad);

            const yRotX = yOrbit * cosTiltX;
            const zRotX = yOrbit * sinTiltX;

            const xFinal = xOrbit * cosTiltZ - yRotX * sinTiltZ;
            const yFinal = xOrbit * sinTiltZ + yRotX * cosTiltZ + yOff;
            const zFinal = zRotX;

            const scale = this.perspective / (this.perspective - zFinal);

            sat.style.transform = `translate(-50%, -50%) translate3d(${xFinal}px, ${yFinal}px, 0) scale(${scale})`;
            sat.style.zIndex = zFinal > 0 ? 20 : 5;
            sat.style.opacity = Math.max(0.48, Math.min(1, 0.62 + (scale - 0.82) * 1.35));
        });
    }
};

// ===== 模块选择动画 =====
function selectModule(target) {
    const mainStar = document.getElementById('main-star');
    const satellite = document.querySelector(`.satellite[data-target="${target}"]`);
    const allSatellites = document.querySelectorAll('.satellite');
    const homePage = document.getElementById('page-home');

    if (!mainStar || !satellite || !homePage) {
        navigate(target);
        return;
    }

    // Set transition origin from satellite position for radial wipe
    const satRect = satellite.getBoundingClientRect();
    if (typeof Router !== 'undefined') {
        Router.transitionOrigin = {
            x: ((satRect.left + satRect.width / 2) / window.innerWidth) * 100,
            y: ((satRect.top + satRect.height / 2) / window.innerHeight) * 100
        };
    }

    emitClickParticles(satellite);
    SatelliteSystem.isRunning = false;
    mainStar.classList.add('shake');

    setTimeout(() => {
        mainStar.classList.remove('shake');
        satellite.classList.add('focusing');

        allSatellites.forEach(sat => {
            if (sat !== satellite) {
                sat.style.transition = 'opacity 0.5s ease-out, transform 0.5s ease-out';
                sat.style.opacity = '0';
                sat.style.transform += ' scale(0)';
            }
        });

        mainStar.classList.add('fading-out');
        // starPop 的 forwards 填充会盖过内联 transform，必须先取消动画
        mainStar.style.animation = 'none';
        mainStar.style.transition = 'opacity 0.5s ease-out, transform 0.5s ease-out';
        mainStar.style.opacity = '0';
        mainStar.style.transform = 'translateY(6vh) scale(0.5)';

        document.querySelectorAll('.orbit-path').forEach(o => {
            o.style.transition = 'opacity 0.4s ease-out';
            o.style.opacity = '0';
        });

        const heading = document.querySelector('.home-heading');
        if (heading) { heading.style.transition = 'opacity 0.3s'; heading.style.opacity = '0'; }

        setTimeout(() => {
            satellite.style.transition = 'transform 0.8s cubic-bezier(0.4, 0, 0.2, 1)';
            satellite.style.zIndex = '1000';
            satellite.style.transform = 'translate(-50%, -50%) translate3d(0px, 0px, 0) scale(4)';

            const icon = satellite.querySelector('.satellite-icon');
            if (icon) { icon.style.transition = 'transform 0.8s'; icon.style.transform = 'scale(1)'; }

            const labelContainer = satellite.querySelector('.satellite-label-container');
            if (labelContainer) { labelContainer.style.transition = 'opacity 0.3s'; labelContainer.style.opacity = '0'; }

            const colors = {
                mathematics: 'rgba(91,141,206,0.25)',
                physics: 'rgba(139,111,192,0.25)',
                chemistry: 'rgba(77,158,126,0.25)',
                algorithms: 'rgba(196,121,58,0.25)',
                biology: 'rgba(58,158,143,0.25)'
            };
            homePage.style.transition = 'background 0.8s ease-out';
            homePage.style.background = `radial-gradient(ellipse at center, ${colors[target] || 'rgba(91,141,206,0.25)'} 0%, #04070f 100%)`;

            setTimeout(() => {
                // Skip router animation — selectModule already provides visual departure
                Router.navigateTo(target, false);
                setTimeout(() => resetHomeState(allSatellites, mainStar, homePage, satellite, icon, labelContainer), 300);
            }, 800);
        }, 400);
    }, 250);
}

function resetHomeState(allSatellites, mainStar, homePage, satellite, icon, labelContainer) {
    SatelliteSystem.startTime = Date.now();
    SatelliteSystem.isRunning = true;

    allSatellites.forEach(sat => {
        sat.classList.remove('focusing');
        sat.style.transition = ''; sat.style.opacity = ''; sat.style.transform = ''; sat.style.zIndex = '';
    });

    mainStar.classList.remove('fading-out');
    mainStar.style.animation = '';
    mainStar.style.transition = ''; mainStar.style.opacity = ''; mainStar.style.transform = ''; mainStar.style.zIndex = '';

    document.querySelectorAll('.orbit-path').forEach(o => { o.style.transition = ''; o.style.opacity = ''; });
    homePage.style.transition = ''; homePage.style.background = '';

    const heading = document.querySelector('.home-heading');
    if (heading) { heading.style.transition = ''; heading.style.opacity = ''; }
    if (icon) icon.style.transform = '';
    if (labelContainer) { labelContainer.style.transition = ''; labelContainer.style.opacity = ''; }
}

// ===== 点击粒子效果 =====
function emitClickParticles(element) {
    const rect = element.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    for (let i = 0; i < 14; i++) {
        const p = document.createElement('div');
        p.className = 'cursor-particle';
        const angle = (Math.PI * 2 / 14) * i + (Math.random() - 0.5) * 0.6;
        const dist = 25 + Math.random() * 50;
        p.style.left = (cx + Math.cos(angle) * dist) + 'px';
        p.style.top  = (cy + Math.sin(angle) * dist) + 'px';
        const size = 2 + Math.random() * 3;
        p.style.width = size + 'px';
        p.style.height = size + 'px';
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 850);
    }
}

// ===== 多层星空背景 =====
function createStars() {
    const lowEnd = typeof _isLowEnd !== 'undefined' && _isLowEnd;
    const returning = typeof _isReturningVisitor !== 'undefined' && _isReturningVisitor;
    const layers = [
        { id: 'star-layer-1', count: lowEnd ? 32 : (returning ? 58 : 72), classes: ['small'] },
        { id: 'star-layer-2', count: lowEnd ? 16 : (returning ? 28 : 38), classes: ['small', 'medium'] },
        { id: 'star-layer-3', count: lowEnd ? 6 : (returning ? 10 : 14), classes: ['medium', 'large', 'bright'] }
    ];

    layers.forEach(layer => {
        const el = document.getElementById(layer.id);
        if (!el) return;
        el.innerHTML = '';

        for (let i = 0; i < layer.count; i++) {
            const s = document.createElement('div');
            const cls = layer.classes[Math.floor(Math.random() * layer.classes.length)];
            s.className = 'star ' + cls;
            s.style.left = Math.random() * 100 + '%';
            s.style.top  = Math.random() * 100 + '%';
            s.style.animationDelay    = (Math.random() * 6) + 's';
            s.style.animationDuration = (2.5 + Math.random() * 5) + 's';
            el.appendChild(s);
        }
    });
}

// ===== 视差背景跟踪 =====
function initParallax() {
    if (window.__homeParallaxBound) return;
    window.__homeParallaxBound = true;

    const depths = [0.015, 0.04, 0.09];
    const layerEls = [
        document.getElementById('star-layer-1'),
        document.getElementById('star-layer-2'),
        document.getElementById('star-layer-3')
    ];

    function applyParallax(clientX, clientY) {
        const x = (clientX / window.innerWidth  - 0.5) * 2;
        const y = (clientY / window.innerHeight - 0.5) * 2;

        layerEls.forEach((layer, i) => {
            if (!layer) return;
            const d = depths[i];
            layer.style.transform = `translate(${x * d * 100}px, ${y * d * 100}px)`;
        });
    }

    document.addEventListener('mousemove', e => applyParallax(e.clientX, e.clientY));
    document.addEventListener('touchmove', e => {
        const t = e.touches[0];
        applyParallax(t.clientX, t.clientY);
    }, { passive: true });
}

// ===== 眼睛跟随 + 眨眼 =====
function initEyeTracking() {
    const main = document.getElementById('main-star');
    const pl = document.getElementById('pupil-left');
    const pr = document.getElementById('pupil-right');
    if (!main || !pl || !pr) {
        window.__homeEyeTrackingBound = false;
        return;
    }
    if (window.__homeEyeTrackingBound) return;
    window.__homeEyeTrackingBound = true;

    function trackEye(clientX, clientY) {
        const rect = main.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top  + rect.height / 2;
        const dx = clientX - cx, dy = clientY - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const ang  = Math.atan2(dy, dx);
        const maxMove = 6;
        const ratio = Math.min(dist / 260, 1);
        const mx = Math.cos(ang) * ratio * maxMove;
        const my = Math.sin(ang) * ratio * maxMove;
        if (pl) pl.style.transform = `translate(calc(-50% + ${mx}px), calc(-50% + ${my}px))`;
        if (pr) pr.style.transform = `translate(calc(-50% + ${mx}px), calc(-50% + ${my}px))`;
    }

    document.addEventListener('mousemove', e => trackEye(e.clientX, e.clientY));
    document.addEventListener('touchmove', e => {
        const t = e.touches[0];
        trackEye(t.clientX, t.clientY);
    }, { passive: true });

    // 不规则眨眼
    function scheduleBlink() {
        const delay = 2500 + Math.random() * 4500;
        setTimeout(() => {
            const eyes = document.querySelectorAll('.eye');
            eyes.forEach(e => e.classList.add('blink'));
            setTimeout(() => {
                eyes.forEach(e => e.classList.remove('blink'));
                // 偶尔双眨
                if (Math.random() < 0.25) {
                    setTimeout(() => {
                        eyes.forEach(e => e.classList.add('blink'));
                        setTimeout(() => eyes.forEach(e => e.classList.remove('blink')), 140);
                    }, 200);
                }
            }, 140);
            scheduleBlink();
        }, delay);
    }
    scheduleBlink();
}

// ===== 流星系统 =====
function initShootingStars() {
    if (window.__homeShootingStarsBound) return;
    window.__homeShootingStarsBound = true;

    const container = document.getElementById('shooting-stars');
    if (!container) return;

    function spawnStar() {
        // 离开首页后停止链式生成，重进首页时由 initHome 重新拉起
        const page = document.getElementById('page-home');
        if (!page || !page.classList.contains('active')) {
            window.__homeShootingStarsBound = false;
            return;
        }

        const star = document.createElement('div');
        star.className = 'shooting-star';

        const startX  = Math.random() * window.innerWidth * 0.7;
        const startY  = Math.random() * window.innerHeight * 0.35;
        const angle   = 25 + Math.random() * 35;   // 25–60°
        const distance = 200 + Math.random() * 350;
        const duration = 0.5 + Math.random() * 0.9;

        star.style.left  = startX + 'px';
        star.style.top   = startY + 'px';
        star.style.width = (55 + Math.random() * 65) + 'px';
        star.style.transform = `rotate(${angle}deg)`;
        star.style.setProperty('--tx', (Math.cos(angle * Math.PI/180) * distance) + 'px');
        star.style.setProperty('--ty', (Math.sin(angle * Math.PI/180) * distance) + 'px');
        star.style.setProperty('--duration', duration + 's');

        container.appendChild(star);
        setTimeout(() => star.remove(), duration * 1000 + 150);

        setTimeout(spawnStar, 3500 + Math.random() * 7000);
    }

    setTimeout(spawnStar, 2000 + Math.random() * 3000);
}

// ===== 首页初始化（分阶段，避免首次加载卡顿）=====
// 低端设备检测：硬件线程数 ≤ 4 或内存 ≤ 4GB 时启用简化模式
const _isLowEnd = (navigator.hardwareConcurrency || 8) <= 4 ||
                  (navigator.deviceMemory && navigator.deviceMemory <= 4);

function initHome() {
    // ── Phase 1 (同步): 先确保首页可见可交互 ──
    initHeadingChars();
    SceneTilt.init();
    SatelliteSystem.init();
    TaglineTyper.init();
    if (window.__loadProgress) window.__loadProgress(85);

    // 其余动效延后：先让页面出来，再逐步补视觉细节
    requestAnimationFrame(function () {
        if (window.__loadProgress) window.__loadProgress(95);

        const scheduleEnhancements = window.requestIdleCallback
            ? (cb) => window.requestIdleCallback(cb, { timeout: _isReturningVisitor ? 450 : 300 })
            : (cb) => setTimeout(cb, _isReturningVisitor ? 180 : 120);

        scheduleEnhancements(function () {
            createStars();
            initParallax();
            const startParticles = () => {
                if (!ParticleNetwork.running) ParticleNetwork.init();
            };
            if (!_isLowEnd && !_isReturningVisitor) {
                startParticles();
                initShootingStars();
            } else if (!_isLowEnd) {
                setTimeout(function () {
                    startParticles();
                    initShootingStars();
                }, 350);
            }
            initEyeTracking();
        });
    });
}

// 导出全局
window.selectModule = selectModule;
window.SatelliteSystem = SatelliteSystem;
window.ParticleNetwork = ParticleNetwork;
