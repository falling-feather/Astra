// ===== Particle Network — OffscreenCanvas Web Worker =====
// 从主线程接收 OffscreenCanvas，在 Worker 中独立运行粒子模拟+渲染
'use strict';

const rAF = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame.bind(self)
    : (fn) => setTimeout(fn, 16);

let canvas, ctx;
let W = 0, H = 0;
let particles = [];
let mouse = { x: -1000, y: -1000 };
const maxDist = 140;
const maxDist2 = maxDist * maxDist;
const mouseDist = maxDist * 1.5;
const mouseDist2 = mouseDist * mouseDist;
const cellSize = maxDist;

let running = false;
let hidden = false;
let maxParticles = 80;
let targetCount = 0;

// FPS 自适应
let fpsFrames = 0, fpsTime = 0, fps = 60;

// 空间网格
let grid = null, gridCols = 0, gridRows = 0;

/* ── 消息处理 ── */
self.onmessage = function (e) {
    const msg = e.data;
    switch (msg.type) {
        case 'init':
            canvas = msg.canvas;
            ctx = canvas.getContext('2d');
            maxParticles = msg.maxParticles || 80;
            resize(msg.width, msg.height, msg.dpr);
            spawn();
            running = true;
            fpsTime = performance.now();
            loop();
            break;
        case 'resize':
            resize(msg.width, msg.height, msg.dpr);
            spawn();
            break;
        case 'mouse':
            mouse.x = msg.x;
            mouse.y = msg.y;
            break;
        case 'visibility':
            hidden = msg.hidden;
            if (!hidden && running) {
                fpsTime = performance.now();
                fpsFrames = 0;
            }
            break;
        case 'destroy':
            running = false;
            break;
    }
};

/* ── 尺寸 ── */
function resize(w, h, dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = w; H = h;
    gridCols = Math.ceil(w / cellSize) + 1;
    gridRows = Math.ceil(h / cellSize) + 1;
}

/* ── 生成粒子 ── */
function spawn() {
    const area = W * H;
    targetCount = Math.min(Math.floor(area / 18000), maxParticles);
    particles = [];
    for (let i = 0; i < targetCount; i++) {
        particles.push({
            x: Math.random() * W,
            y: Math.random() * H,
            vx: (Math.random() - 0.5) * 0.4,
            vy: (Math.random() - 0.5) * 0.4,
            r: 1 + Math.random() * 1.5
        });
    }
}

/* ── FPS 自适应粒子数量 ── */
function adaptParticleCount() {
    fpsFrames++;
    const now = performance.now();
    const elapsed = now - fpsTime;
    if (elapsed < 1000) return;

    fps = Math.round(fpsFrames * 1000 / elapsed);
    fpsFrames = 0;
    fpsTime = now;

    if (fps < 25 && particles.length > 20) {
        const remove = Math.max(2, Math.floor(particles.length * 0.2));
        particles.splice(particles.length - remove, remove);
        targetCount = particles.length;
    } else if (fps > 50 && particles.length < targetCount) {
        const add = Math.min(4, targetCount - particles.length);
        for (let i = 0; i < add; i++) {
            particles.push({
                x: Math.random() * W,
                y: Math.random() * H,
                vx: (Math.random() - 0.5) * 0.4,
                vy: (Math.random() - 0.5) * 0.4,
                r: 1 + Math.random() * 1.5
            });
        }
    }
}

/* ── 空间网格 ── */
function buildGrid() {
    const cols = gridCols, rows = gridRows;
    const cs = cellSize;
    const g = new Array(cols * rows);
    for (let k = 0; k < g.length; k++) g[k] = [];
    for (let i = 0; i < particles.length; i++) {
        const c = Math.min(cols - 1, (particles[i].x / cs) | 0);
        const r = Math.min(rows - 1, (particles[i].y / cs) | 0);
        g[r * cols + c].push(i);
    }
    grid = g;
}

/* ── 主循环 ── */
function loop() {
    if (!running) return;
    rAF(loop);
    if (hidden) return;

    adaptParticleCount();
    ctx.clearRect(0, 0, W, H);

    // 更新 & 绘制粒子
    ctx.fillStyle = 'rgba(58,169,255,0.42)';
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

    // 基于空间网格的连线
    buildGrid();
    const cols = gridCols, rows = gridRows;
    const cs = cellSize;

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
                    const ddx = pi.x - pj.x;
                    const ddy = pi.y - pj.y;
                    const d2 = ddx * ddx + ddy * ddy;
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
        ctx.strokeStyle = `rgba(58,169,255,${alphas[b]})`;
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
