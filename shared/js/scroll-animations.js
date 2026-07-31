// ===== Scroll Animations (GSAP ScrollTrigger) =====

function initScrollAnimations() {
    if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') return;
    gsap.registerPlugin(ScrollTrigger);
}

function initPageScrollAnimations(page) {
    if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') return;

    // Kill existing triggers for this page to avoid duplicates
    const pageEl = document.getElementById(`page-${page}`);
    if (!pageEl) return;

    // Section headers
    const headers = pageEl.querySelectorAll('.section-header');
    headers.forEach(header => {
        gsap.fromTo(header,
            { y: 20, opacity: 0 },
            {
                y: 0, opacity: 1,
                duration: 0.6,
                ease: 'power2.out',
                scrollTrigger: {
                    trigger: header,
                    start: 'top 82%',
                    toggleActions: 'play none none none'
                }
            }
        );
    });

    // Demo sections
    const demos = pageEl.querySelectorAll('.demo-section');
    demos.forEach(demo => {
        gsap.fromTo(demo,
            { y: 30, opacity: 0 },
            {
                y: 0, opacity: 1,
                duration: 0.7,
                ease: 'power3.out',
                scrollTrigger: {
                    trigger: demo,
                    start: 'top 80%',
                    toggleActions: 'play none none none'
                }
            }
        );
    });

    // Video sections
    const videos = pageEl.querySelectorAll('.video-section');
    videos.forEach(vid => {
        gsap.fromTo(vid,
            { y: 25, opacity: 0 },
            {
                y: 0, opacity: 1,
                duration: 0.6,
                ease: 'power2.out',
                scrollTrigger: {
                    trigger: vid,
                    start: 'top 80%',
                    toggleActions: 'play none none none'
                }
            }
        );
    });

    // Steps panels
    const steps = pageEl.querySelectorAll('.steps-panel');
    steps.forEach(step => {
        gsap.fromTo(step,
            { y: 20, opacity: 0 },
            {
                y: 0, opacity: 1,
                duration: 0.6,
                ease: 'power2.out',
                scrollTrigger: {
                    trigger: step,
                    start: 'top 82%',
                    toggleActions: 'play none none none'
                }
            }
        );
    });

    // Page hero text — NOTE: hero elements are already animated by Router.animatePageContent()
    // on page transition. Running a second fromTo here caused triple-flicker (appear→hide→appear).
    // Hero animation is intentionally omitted here to avoid the conflict.

    // Page hero visual — same reason as above, handled by animatePageContent.
}

const HeroVisualRuntime = {
    frames: Object.create(null),
    cleanups: Object.create(null)
};

function requestHeroFrame(page, callback) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        delete HeroVisualRuntime.frames[page];
        return;
    }
    HeroVisualRuntime.frames[page] = requestAnimationFrame(callback);
}

function trackHeroCleanup(page, cleanup) {
    if (!page || typeof cleanup !== 'function') return;
    if (!HeroVisualRuntime.cleanups[page]) HeroVisualRuntime.cleanups[page] = [];
    HeroVisualRuntime.cleanups[page].push(cleanup);
}

function destroyHeroVisual(page) {
    if (!page) return;
    const frame = HeroVisualRuntime.frames[page];
    if (frame) cancelAnimationFrame(frame);
    delete HeroVisualRuntime.frames[page];
    const cleanups = HeroVisualRuntime.cleanups[page] || [];
    cleanups.splice(0).reverse().forEach((cleanup) => {
        try { cleanup(); } catch (e) { /* noop */ }
    });
    delete HeroVisualRuntime.cleanups[page];

    const canvas = document.getElementById(`hero-canvas-${page}`);
    if (canvas) {
        if (canvas.parentElement) canvas.parentElement.classList.remove('hero-visual--fallback');
        delete canvas.dataset.initialized;
        if (typeof canvas.getContext === 'function') {
            const ctx = canvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, canvas.width || canvas.clientWidth, canvas.height || canvas.clientHeight);
        }
    }
}

function destroyAllHeroVisuals() {
    Object.keys(HeroVisualRuntime.frames).forEach((page) => destroyHeroVisual(page));
}

// Hero visual animations (SVG/Canvas decorations)
function initHeroVisual(page) {
    const canvas = document.getElementById(`hero-canvas-${page}`);
    if (!canvas || canvas.dataset.initialized === 'true' || canvas.dataset.initialized === 'unsupported' ||
        canvas.dataset.initialized === 'pending' || canvas.dataset.initialized === 'waiting') return;
    if (typeof canvas.getContext !== 'function') {
        canvas.dataset.initialized = 'unsupported';
        if (canvas.parentElement) canvas.parentElement.classList.add('hero-visual--fallback');
        return;
    }

    const pageEl = document.getElementById(`page-${page}`);
    if (pageEl && !pageEl.classList.contains('active')) {
        if (canvas.dataset.initialized === 'waiting') return;
        canvas.dataset.initialized = 'waiting';
        const observer = new MutationObserver(() => {
            if (!pageEl.classList.contains('active')) return;
            observer.disconnect();
            delete canvas.dataset.initialized;
            initHeroVisual(page);
        });
        observer.observe(pageEl, { attributes: true, attributeFilter: ['class'] });
        trackHeroCleanup(page, () => observer.disconnect());
        return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
        canvas.dataset.initialized = 'unsupported';
        if (canvas.parentElement) canvas.parentElement.classList.add('hero-visual--fallback');
        return;
    }
    if (canvas.parentElement) canvas.parentElement.classList.remove('hero-visual--fallback');

    const drawers = {
        mathematics: drawLissajous,
        physics: drawWaveInterference,
        chemistry: drawMolecule,
        algorithms: drawSortBars,
        biology: drawDNAHelix,
        cosmos: drawEarthOrbit,
        datascience: drawDataRegression,
        infotech: drawNetworkFlow,
        materials: drawMaterialLattice,
        humanities: drawTextConstellation,
        engineering: drawEngineeringTruss,
        frontier: drawFrontierGalaxy
    };
    const drawer = drawers[page];
    if (!drawer) return;

    canvas.dataset.initialized = 'pending';
    let attempts = 0;
    const lowEnd = (navigator.hardwareConcurrency || 8) <= 4 ||
        (navigator.deviceMemory && navigator.deviceMemory <= 4);
    const maxDpr = lowEnd ? 1.25 : 1.75;

    const launch = () => {
        const rect = canvas.getBoundingClientRect();
        let w = rect.width || canvas.offsetWidth || (canvas.parentElement && canvas.parentElement.offsetWidth) || 0;
        let h = rect.height || canvas.offsetHeight || (canvas.parentElement && canvas.parentElement.offsetHeight) || 0;
        if ((w < 4 || h < 4) && attempts < 60) {
            attempts += 1;
            HeroVisualRuntime.frames[page] = requestAnimationFrame(launch);
            return;
        }
        if (w < 4) w = Math.max(window.innerWidth || 400, 400);
        if (h < 4) h = Math.max(window.innerHeight || 220, 220);
        const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        canvas.dataset.initialized = 'true';
        drawer(page, ctx, w, h, canvas);
    };

    launch();
}

// ── Lissajous curve for Mathematics ──
function drawLissajous(page, ctx, w, h) {
    const cx = w / 2, cy = h / 2;
    const scale = Math.min(w, h) * 0.35;
    let t = 0;

    function draw() {
        ctx.clearRect(0, 0, w, h);
        ctx.beginPath();
        for (let i = 0; i <= 600; i++) {
            const angle = (i / 600) * Math.PI * 2 * 3;
            const x = cx + Math.sin(angle * 3 + t) * scale;
            const y = cy + Math.sin(angle * 2) * scale * 0.8;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = 'rgba(91,141,206,0.58)';
        ctx.lineWidth = 1.8;
        ctx.stroke();

        // Dot at current position
        const dotX = cx + Math.sin(t * 3 + t) * scale;
        const dotY = cy + Math.sin(t * 2) * scale * 0.8;
        ctx.beginPath();
        ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(126,177,238,0.86)';
        ctx.fill();

        t += 0.008;
        requestHeroFrame(page, draw);
    }
    draw();
}

// ── Wave interference for Physics ──
function drawWaveInterference(page, ctx, w, h) {
    let t = 0;

    function draw() {
        ctx.clearRect(0, 0, w, h);

        for (let layer = 0; layer < 3; layer++) {
            ctx.beginPath();
            const freq = 0.02 + layer * 0.008;
            const amp = 25 - layer * 5;
            const yOffset = h / 2 + (layer - 1) * 40;
            const phase = t * (1 + layer * 0.3);

            for (let x = 0; x < w; x++) {
                const y = yOffset +
                    Math.sin(x * freq + phase) * amp +
                    Math.sin(x * freq * 1.7 + phase * 0.6) * amp * 0.5;
                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }

            ctx.strokeStyle = `rgba(139,111,192,${0.15 + layer * 0.05})`;
            ctx.lineWidth = 1.2;
            ctx.stroke();
        }

        t += 0.025;
        requestHeroFrame(page, draw);
    }
    draw();
}

// ── Hexagonal molecule for Chemistry ──
function drawMolecule(page, ctx, w, h) {
    const cx = w / 2, cy = h / 2;
    const r = Math.min(w, h) * 0.12;
    let t = 0;

    const nodes = [];
    // Central hex ring
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        nodes.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r, ring: 0 });
    }
    // Outer nodes
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        nodes.push({ x: Math.cos(angle) * r * 2, y: Math.sin(angle) * r * 2, ring: 1 });
    }

    const bonds = [];
    for (let i = 0; i < 6; i++) {
        bonds.push([i, (i + 1) % 6]);
        bonds.push([i, i + 6]);
    }

    function draw() {
        ctx.clearRect(0, 0, w, h);
        const rot = t * 0.3;

        // Bonds
        bonds.forEach(([a, b]) => {
            const ax = cx + nodes[a].x * Math.cos(rot) - nodes[a].y * Math.sin(rot) * 0.3;
            const ay = cy + nodes[a].x * Math.sin(rot) * 0.3 + nodes[a].y * Math.cos(rot);
            const bx = cx + nodes[b].x * Math.cos(rot) - nodes[b].y * Math.sin(rot) * 0.3;
            const by = cy + nodes[b].x * Math.sin(rot) * 0.3 + nodes[b].y * Math.cos(rot);

            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.strokeStyle = 'rgba(77,158,126,0.2)';
            ctx.lineWidth = 1.2;
            ctx.stroke();
        });

        // Nodes
        nodes.forEach((node, i) => {
            const nx = cx + node.x * Math.cos(rot) - node.y * Math.sin(rot) * 0.3;
            const ny = cy + node.x * Math.sin(rot) * 0.3 + node.y * Math.cos(rot);
            const radius = node.ring === 0 ? 4 : 3;

            ctx.beginPath();
            ctx.arc(nx, ny, radius, 0, Math.PI * 2);
            ctx.fillStyle = node.ring === 0 ? 'rgba(77,158,126,0.4)' : 'rgba(77,158,126,0.25)';
            ctx.fill();
        });

        t += 0.01;
        requestHeroFrame(page, draw);
    }
    draw();
}

// ── Decorative sort bars for Algorithms ──
function drawSortBars(page, ctx, w, h) {
    const barCount = 16;
    const barW = w / (barCount * 2);
    const heights = [];
    for (let i = 0; i < barCount; i++) {
        heights.push(0.2 + Math.random() * 0.8);
    }

    let t = 0;
    let swapI = 0;
    let swapTimer = 0;

    function draw() {
        ctx.clearRect(0, 0, w, h);

        // Slowly swap bars
        swapTimer++;
        if (swapTimer > 60) {
            swapTimer = 0;
            const a = swapI % barCount;
            const b = (swapI + 1) % barCount;
            if (heights[a] > heights[b]) {
                const tmp = heights[a];
                heights[a] = heights[b];
                heights[b] = tmp;
            }
            swapI++;
        }

        for (let i = 0; i < barCount; i++) {
            const x = (w / 2) - (barCount * barW) + i * barW * 2;
            const barH = heights[i] * h * 0.6;
            const y = h - barH - 10;

            ctx.fillStyle = `rgba(196,121,58,${0.15 + heights[i] * 0.2})`;
            ctx.fillRect(x, y, barW, barH);
        }

        t += 0.016;
        requestHeroFrame(page, draw);
    }
    draw();
}

// ── Interactive frontier galaxy map ──
function drawFrontierGalaxy(page, ctx, w, h, canvas) {
    const stage = canvas.closest('.frontier-overview-page') || canvas.parentElement || canvas;
    const colors = ['116,185,255', '216,163,72', '138,167,255', '94,224,216', '224,181,106', '126,215,193'];
    const pointer = { targetX: 0, targetY: 0, x: 0, y: 0, active: false };
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const clamp = (min, value, max) => Math.max(min, Math.min(max, value));
    const starCount = reduceMotion ? 72 : 108;
    const stars = Array.from({ length: starCount }, (_, i) => ({
        rx: (Math.sin(i * 77.17) * 0.5 + 0.5),
        ry: (Math.sin(i * 31.73 + 1.8) * 0.5 + 0.5),
        r: 0.45 + ((i * 13) % 7) / 11,
        a: 0.09 + ((i * 17) % 10) / 74,
        drift: 0.12 + ((i * 19) % 16) / 82,
        depth: 0.24 + ((i * 23) % 18) / 18,
        twinkle: 0.6 + ((i * 29) % 14) / 8
    }));
    // 右侧补星：避免背景图右侧留白时 canvas 也偏空
    const rightStars = Array.from({ length: reduceMotion ? 18 : 34 }, (_, i) => ({
        rx: 0.68 + ((i * 19) % 28) / 100,
        ry: (Math.sin(i * 41.3 + 2.1) * 0.5 + 0.5),
        r: 0.35 + ((i * 11) % 5) / 12,
        a: 0.07 + ((i * 13) % 8) / 80,
        drift: 0.14 + ((i * 17) % 12) / 90,
        depth: 0.32 + ((i * 7) % 10) / 20,
        twinkle: 0.7 + ((i * 23) % 10) / 9
    }));
    let width = w;
    let height = h;
    let dpr = window.devicePixelRatio || 1;
    const maxDpr = reduceMotion ? 1 : 1.5;

    const resizeCanvas = () => {
        const rect = canvas.getBoundingClientRect();
        const nextWidth = Math.max(1, rect.width || canvas.offsetWidth || w || 400);
        const nextHeight = Math.max(1, rect.height || canvas.offsetHeight || h || 220);
        const nextDpr = Math.min(window.devicePixelRatio || 1, maxDpr);
        if (Math.abs(nextWidth - width) < 0.5 && Math.abs(nextHeight - height) < 0.5 && nextDpr === dpr) return;
        width = nextWidth;
        height = nextHeight;
        dpr = nextDpr;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resizeCanvas();

    const onPointerMove = (event) => {
        const rect = stage.getBoundingClientRect();
        const x = rect.width ? (event.clientX - rect.left) / rect.width : 0.5;
        const y = rect.height ? (event.clientY - rect.top) / rect.height : 0.5;
        pointer.targetX = clamp(-1, (x - 0.5) * 2, 1);
        pointer.targetY = clamp(-1, (y - 0.5) * 2, 1);
        pointer.active = true;
    };
    const onPointerLeave = () => {
        pointer.active = false;
    };
    stage.addEventListener('pointermove', onPointerMove);
    stage.addEventListener('pointerleave', onPointerLeave);
    trackHeroCleanup(page, () => {
        stage.removeEventListener('pointermove', onPointerMove);
        stage.removeEventListener('pointerleave', onPointerLeave);
        stage.style.removeProperty('--frontier-bg-shift-x');
        stage.style.removeProperty('--frontier-bg-shift-y');
        stage.style.removeProperty('--frontier-orbit-shift-x');
        stage.style.removeProperty('--frontier-orbit-shift-y');
        stage.style.removeProperty('--frontier-glow-x');
        stage.style.removeProperty('--frontier-glow-y');
    });

    let t = 0;
    function draw() {
        resizeCanvas();
        ctx.clearRect(0, 0, width, height);

        const rightFill = ctx.createLinearGradient(width * 0.45, 0, width, 0);
        rightFill.addColorStop(0, 'rgba(101,228,240,0)');
        rightFill.addColorStop(0.42, 'rgba(101,228,240,0.03)');
        rightFill.addColorStop(1, 'rgba(138,167,255,0.05)');
        ctx.fillStyle = rightFill;
        ctx.fillRect(0, 0, width, height);

        if (!pointer.active) {
            pointer.targetX = 0;
            pointer.targetY = 0;
        }
        const ease = reduceMotion ? 0.04 : 0.075;
        pointer.x += (pointer.targetX - pointer.x) * ease;
        pointer.y += (pointer.targetY - pointer.y) * ease;
        const px = pointer.x;
        const py = pointer.y;
        const cursorX = width * (0.5 + px * 0.5);
        const cursorY = height * (0.5 + py * 0.5);

        stage.style.setProperty('--frontier-bg-shift-x', `${(-px * 18).toFixed(2)}px`);
        stage.style.setProperty('--frontier-bg-shift-y', `${(-py * 14).toFixed(2)}px`);
        stage.style.setProperty('--frontier-orbit-shift-x', `${(px * 9).toFixed(2)}px`);
        stage.style.setProperty('--frontier-orbit-shift-y', `${(py * 7).toFixed(2)}px`);
        stage.style.setProperty('--frontier-glow-x', `${clamp(20, 62 + px * 18, 86).toFixed(1)}%`);
        stage.style.setProperty('--frontier-glow-y', `${clamp(18, 43 + py * 16, 78).toFixed(1)}%`);

        stars.forEach((star, i) => {
            let sx = star.rx * width + Math.sin(t * star.drift + i) * (1.6 + star.depth * 3) + px * 18 * star.depth;
            let sy = star.ry * height + Math.cos(t * star.drift + i * 0.6) * (1.2 + star.depth * 2.4) + py * 15 * star.depth;
            const distance = Math.hypot(sx - cursorX, sy - cursorY);
            const cursorPull = pointer.active ? Math.max(0, 1 - distance / 260) : 0;
            sx += (cursorX - sx) * cursorPull * 0.018 * star.depth;
            sy += (cursorY - sy) * cursorPull * 0.014 * star.depth;
            ctx.beginPath();
            ctx.arc(sx, sy, star.r, 0, Math.PI * 2);
            const alpha = clamp(0.04, star.a + Math.sin(t * star.twinkle + i) * 0.035 + cursorPull * 0.18, 0.46);
            ctx.fillStyle = `rgba(231,241,241,${alpha})`;
            ctx.fill();
        });

        rightStars.forEach((star, i) => {
            let sx = star.rx * width + Math.sin(t * star.drift + i * 1.7) * (1.2 + star.depth * 2.6);
            let sy = star.ry * height + Math.cos(t * star.drift + i) * (1.4 + star.depth * 2.2) + py * 12 * star.depth;
            ctx.beginPath();
            ctx.arc(sx, sy, star.r, 0, Math.PI * 2);
            const alpha = clamp(0.05, star.a + Math.sin(t * star.twinkle + i * 0.8) * 0.04, 0.38);
            ctx.fillStyle = `rgba(198,232,236,${alpha})`;
            ctx.fill();
        });

        const canvasRect = canvas.getBoundingClientRect();
        const coreEl = stage.querySelector('.frontier-overview__core');
        let cx = width * 0.52;
        let cy = height * 0.48;
        if (coreEl) {
            const coreRect = coreEl.getBoundingClientRect();
            if (coreRect.width) {
                cx = coreRect.left + coreRect.width / 2 - canvasRect.left;
                cy = coreRect.top + coreRect.height / 2 - canvasRect.top;
            }
        }

        const baseR = Math.min(width, height * 1.3) * 0.2;
        for (let ring = 0; ring < 3; ring++) {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate((reduceMotion ? 0 : t * 0.02 * (ring % 2 ? -1 : 1)) + ring * 0.5);
            ctx.beginPath();
            const rr = baseR + ring * baseR * 0.62;
            ctx.ellipse(0, 0, rr, rr * 0.78, 0, 0, Math.PI * 2);
            const gold = ring === 1;
            ctx.strokeStyle = `rgba(${gold ? '242,200,107' : '150,205,225'}, ${(0.15 - ring * 0.032).toFixed(3)})`;
            ctx.lineWidth = 1;
            ctx.setLineDash(gold ? [3, 9] : []);
            ctx.stroke();
            ctx.restore();
        }
        ctx.setLineDash([]);

        const nodeEls = Array.from(stage.querySelectorAll('.frontier-overview__node'));
        const projected = nodeEls.map((node, index) => {
            const rect = node.getBoundingClientRect();
            const radius = Math.max(rect.width, rect.height) * 0.5;
            return {
                x: rect.left + rect.width / 2 - canvasRect.left,
                y: rect.top + rect.height / 2 - canvasRect.top,
                radius,
                color: colors[index] || '242,200,107'
            };
        });

        projected.forEach((node, index) => {
            const pulse = 0.86 + Math.sin(t * 1.8 + index * 1.1) * 0.14;
            const glowR = (node.radius || 36) * (1.35 + pulse * 0.22);
            const nodeGlow = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, glowR);
            nodeGlow.addColorStop(0, `rgba(${node.color},${(0.16 * pulse).toFixed(3)})`);
            nodeGlow.addColorStop(0.55, `rgba(${node.color},${(0.06 * pulse).toFixed(3)})`);
            nodeGlow.addColorStop(1, `rgba(${node.color},0)`);
            ctx.fillStyle = nodeGlow;
            ctx.beginPath();
            ctx.arc(node.x, node.y, glowR, 0, Math.PI * 2);
            ctx.fill();
        });

        projected.forEach((node) => {
            const grad = ctx.createLinearGradient(cx, cy, node.x, node.y);
            grad.addColorStop(0, `rgba(${node.color},0.32)`);
            grad.addColorStop(1, `rgba(${node.color},0.04)`);
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(node.x, node.y);
            ctx.strokeStyle = grad;
            ctx.lineWidth = 1;
            ctx.stroke();
        });

        const links = [[0, 2], [2, 4], [4, 1], [1, 3], [3, 5], [5, 0]];
        links.forEach(([from, to]) => {
            const a = projected[from];
            const b = projected[to];
            if (!a || !b) return;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = 'rgba(173,226,226,0.12)';
            ctx.lineWidth = 1;
            ctx.stroke();
        });

        const coreGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 100);
        coreGlow.addColorStop(0, 'rgba(242,200,107,0.18)');
        coreGlow.addColorStop(0.5, 'rgba(101,228,240,0.07)');
        coreGlow.addColorStop(1, 'rgba(101,228,240,0)');
        ctx.fillStyle = coreGlow;
        ctx.beginPath();
        ctx.arc(cx, cy, 100, 0, Math.PI * 2);
        ctx.fill();

        if (pointer.active) {
            const halo = ctx.createRadialGradient(cursorX, cursorY, 0, cursorX, cursorY, 240);
            halo.addColorStop(0, 'rgba(101,228,240,0.12)');
            halo.addColorStop(0.38, 'rgba(242,200,107,0.045)');
            halo.addColorStop(1, 'rgba(101,228,240,0)');
            ctx.fillStyle = halo;
            ctx.fillRect(0, 0, width, height);
        }

        t += reduceMotion ? 0.003 : 0.010;
        requestHeroFrame(page, draw);
    }
    draw();
}

window.initScrollAnimations = initScrollAnimations;
window.initPageScrollAnimations = initPageScrollAnimations;
window.initHeroVisual = initHeroVisual;
window.destroyHeroVisual = destroyHeroVisual;
window.destroyAllHeroVisuals = destroyAllHeroVisuals;

const activeEnglabPage = document.querySelector('.page.active[id^="page-"]');
if (activeEnglabPage && typeof Router !== 'undefined') {
    const page = activeEnglabPage.id.replace(/^page-/, '');
    if (Router._galaxyForPage(page) === 'englab') {
        initPageScrollAnimations(page);
        initHeroVisual(page);
    }
}

// ── DNA double helix for Biology ──
function drawDNAHelix(page, ctx, w, h) {
    let t = 0;
    const cx = w / 2;
    const amplitude = Math.min(w, h) * 0.18;
    const freq = 0.022;
    const baseColor1 = 'rgba(58,158,143,';
    const baseColor2 = 'rgba(77,200,170,';
    const bondColor = 'rgba(58,158,143,0.12)';

    function draw() {
        ctx.clearRect(0, 0, w, h);

        // Draw backbone strands
        for (let strand = 0; strand < 2; strand++) {
            const phase = strand * Math.PI;
            ctx.beginPath();
            for (let y = 0; y <= h; y += 2) {
                const x = cx + Math.sin(y * freq + t + phase) * amplitude;
                if (y === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            const alpha = 0.3 - strand * 0.08;
            ctx.strokeStyle = strand === 0 ? baseColor1 + alpha + ')' : baseColor2 + alpha + ')';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Draw base pair rungs
        const step = Math.PI / (freq * 8);
        for (let k = 0; k < 12; k++) {
            const y = ((k * step - t / freq) % h + h) % h;
            const x1 = cx + Math.sin(y * freq + t) * amplitude;
            const x2 = cx + Math.sin(y * freq + t + Math.PI) * amplitude;
            ctx.beginPath();
            ctx.moveTo(x1, y);
            ctx.lineTo(x2, y);
            ctx.strokeStyle = bondColor;
            ctx.lineWidth = 1;
            ctx.stroke();

            // Nodes at each end
            [x1, x2].forEach((x, i) => {
                ctx.beginPath();
                ctx.arc(x, y, 2.5, 0, Math.PI * 2);
                ctx.fillStyle = i === 0 ? 'rgba(58,158,143,0.35)' : 'rgba(77,200,170,0.35)';
                ctx.fill();
            });
        }

        t += 0.012;
        requestHeroFrame(page, draw);
    }
    draw();
}

// Regression scatter and fit for Data Science
function drawDataRegression(page, ctx, w, h) {
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let t = 0;
    const points = [
        [0.10, 0.74], [0.21, 0.66], [0.30, 0.69], [0.40, 0.55],
        [0.50, 0.50], [0.58, 0.40], [0.68, 0.39], [0.77, 0.28], [0.88, 0.24]
    ];

    function draw() {
        ctx.clearRect(0, 0, w, h);
        const pad = Math.min(w, h) * 0.16;
        const left = pad;
        const top = pad * 0.7;
        const pw = w - pad * 2;
        const ph = h - pad * 1.7;
        const right = left + pw;
        const bottom = top + ph;
        const toPx = (x) => left + x * pw;
        const toPy = (y) => top + y * ph;

        // 网格
        ctx.strokeStyle = 'rgba(138,167,255,0.08)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 5; i++) {
            const gx = left + (pw / 5) * i;
            const gy = top + (ph / 5) * i;
            ctx.beginPath(); ctx.moveTo(gx, top); ctx.lineTo(gx, bottom); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(left, gy); ctx.lineTo(right, gy); ctx.stroke();
        }
        // 坐标轴 + 刻度
        ctx.strokeStyle = 'rgba(200,212,240,0.34)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(left, top); ctx.lineTo(left, bottom); ctx.lineTo(right, bottom);
        ctx.stroke();
        ctx.fillStyle = 'rgba(180,195,230,0.45)';
        for (let i = 0; i <= 5; i++) {
            ctx.fillRect(left + (pw / 5) * i - 0.5, bottom, 1, 4);
            ctx.fillRect(left - 4, bottom - (ph / 5) * i - 0.5, 4, 1);
        }

        // 回归参数（随训练轻微迭代）
        const slope = -0.56 + Math.sin(t * 0.7) * 0.03;
        const intercept = 0.74 + Math.cos(t * 0.7) * 0.015;
        const lineY = (x) => intercept + slope * x;

        // 置信带
        ctx.beginPath();
        ctx.moveTo(toPx(0), toPy(lineY(0) - 0.08));
        ctx.lineTo(toPx(1), toPy(lineY(1) - 0.08));
        ctx.lineTo(toPx(1), toPy(lineY(1) + 0.08));
        ctx.lineTo(toPx(0), toPy(lineY(0) + 0.08));
        ctx.closePath();
        ctx.fillStyle = 'rgba(138,167,255,0.10)';
        ctx.fill();

        // 残差虚线
        ctx.strokeStyle = 'rgba(242,200,107,0.3)';
        ctx.setLineDash([2, 3]);
        ctx.lineWidth = 1;
        points.forEach(([x, y]) => {
            ctx.beginPath();
            ctx.moveTo(toPx(x), toPy(y));
            ctx.lineTo(toPx(x), toPy(lineY(x)));
            ctx.stroke();
        });
        ctx.setLineDash([]);

        // 回归线（发光）
        const grad = ctx.createLinearGradient(toPx(0), 0, toPx(1), 0);
        grad.addColorStop(0, 'rgba(138,167,255,0.92)');
        grad.addColorStop(1, 'rgba(94,224,216,0.92)');
        ctx.save();
        ctx.shadowColor = 'rgba(138,167,255,0.55)';
        ctx.shadowBlur = 10;
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(toPx(0), toPy(lineY(0)));
        ctx.lineTo(toPx(1), toPy(lineY(1)));
        ctx.stroke();
        ctx.restore();

        // 散点（发光球）
        points.forEach(([x, y], i) => {
            const px = toPx(x);
            const py = toPy(y);
            const glow = ctx.createRadialGradient(px, py, 1, px, py, 9);
            glow.addColorStop(0, 'rgba(94,224,216,0.5)');
            glow.addColorStop(1, 'rgba(94,224,216,0)');
            ctx.fillStyle = glow;
            ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.fill();
            const body = ctx.createRadialGradient(px - 1.5, py - 1.5, 0.5, px, py, 4.6);
            body.addColorStop(0, '#eaf6ff');
            body.addColorStop(1, i % 2 ? '#5ee0d8' : '#8aa7ff');
            ctx.fillStyle = body;
            ctx.beginPath(); ctx.arc(px, py, 4.2, 0, Math.PI * 2); ctx.fill();
        });

        // 拟合扫描点
        const scanX = (t * 0.18) % 1;
        const sx = toPx(scanX);
        const sy = toPy(lineY(scanX));
        const sg = ctx.createRadialGradient(sx, sy, 1, sx, sy, 13);
        sg.addColorStop(0, 'rgba(255,255,255,0.92)');
        sg.addColorStop(0.4, 'rgba(138,167,255,0.5)');
        sg.addColorStop(1, 'rgba(138,167,255,0)');
        ctx.fillStyle = sg;
        ctx.beginPath(); ctx.arc(sx, sy, 13, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(sx, sy, 3, 0, Math.PI * 2); ctx.fill();

        t += reduceMotion ? 0.004 : 0.016;
        requestHeroFrame(page, draw);
    }

    draw();
}

// Packet route and layered envelope for Information Technology
function drawNetworkFlow(page, ctx, w, h) {
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let t = 0;
    const nodes = [
        { x: 0.14, y: 0.62, r: 12 },
        { x: 0.32, y: 0.42, r: 9 },
        { x: 0.52, y: 0.58, r: 10 },
        { x: 0.72, y: 0.38, r: 9 },
        { x: 0.88, y: 0.56, r: 12 }
    ];

    const pos = (n) => ({ x: n.x * w, y: n.y * h });
    const packetAt = (phase) => {
        const seg = Math.min(nodes.length - 2, Math.floor(phase));
        const local = phase - seg;
        const a = pos(nodes[seg]);
        const b = pos(nodes[seg + 1]);
        return { x: a.x + (b.x - a.x) * local, y: a.y + (b.y - a.y) * local };
    };

    function draw() {
        ctx.clearRect(0, 0, w, h);

        // HUD 网格
        ctx.strokeStyle = 'rgba(94,224,216,0.06)';
        ctx.lineWidth = 1;
        const gs = Math.max(28, Math.min(w, h) * 0.1);
        for (let x = gs; x < w; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
        for (let y = gs; y < h; y += gs) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

        // 链路
        ctx.strokeStyle = 'rgba(94,224,216,0.24)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        nodes.forEach((node, i) => { const p = pos(node); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
        ctx.stroke();

        // 数据包（多个 + 拖尾）
        const span = nodes.length - 1;
        for (let k = 0; k < 3; k++) {
            const phase = (((reduceMotion ? t * 0.4 : t * 0.5) + k / 3) % 1) * span;
            const p = packetAt(phase);
            for (let tr = 1; tr <= 4; tr++) {
                const tp = packetAt(Math.max(0, phase - tr * 0.06));
                ctx.fillStyle = `rgba(94,224,216,${0.18 - tr * 0.035})`;
                ctx.beginPath(); ctx.arc(tp.x, tp.y, 3.4 - tr * 0.5, 0, Math.PI * 2); ctx.fill();
            }
            const g = ctx.createRadialGradient(p.x, p.y, 0.5, p.x, p.y, 9);
            g.addColorStop(0, 'rgba(255,255,255,0.95)');
            g.addColorStop(0.4, 'rgba(94,224,216,0.7)');
            g.addColorStop(1, 'rgba(94,224,216,0)');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.fill();
        }

        // 节点（发光球 + 脉冲环）
        nodes.forEach((node, i) => {
            const p = pos(node);
            const end = i === 0 || i === nodes.length - 1;
            const col = end ? '94,224,216' : '138,167,255';
            const pr = node.r + 6 + Math.sin(t * 2.4 + i) * 2.5;
            ctx.strokeStyle = `rgba(${col},0.3)`;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(p.x, p.y, pr, 0, Math.PI * 2); ctx.stroke();
            const glow = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, node.r + 7);
            glow.addColorStop(0, `rgba(${col},0.5)`);
            glow.addColorStop(1, `rgba(${col},0)`);
            ctx.fillStyle = glow;
            ctx.beginPath(); ctx.arc(p.x, p.y, node.r + 7, 0, Math.PI * 2); ctx.fill();
            const body = ctx.createRadialGradient(p.x - 2, p.y - 2, 0.5, p.x, p.y, node.r);
            body.addColorStop(0, '#f2fdfc');
            body.addColorStop(1, end ? '#3fb8b0' : '#6f87d6');
            ctx.fillStyle = body;
            ctx.beginPath(); ctx.arc(p.x, p.y, node.r, 0, Math.PI * 2); ctx.fill();
        });

        // 协议栈玻璃卡片
        const stackX = w * 0.08;
        const stackY = h * 0.12;
        ['HTTP', 'TCP', 'IPv6', 'LINK'].forEach((label, index) => {
            const cw = w * 0.21;
            const ch = 22;
            const x = stackX + index * 7;
            const y = stackY + index * 27;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(x, y, cw, ch, 5); else ctx.rect(x, y, cw, ch);
            ctx.fillStyle = index % 2 ? 'rgba(94,224,216,0.14)' : 'rgba(138,167,255,0.13)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(210,240,245,0.22)';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = 'rgba(225,245,248,0.8)';
            ctx.font = `600 11px ${typeof CF !== 'undefined' ? CF.mono : 'monospace'}`;
            ctx.textAlign = 'left';
            ctx.fillText(label, x + 9, y + 15);
        });

        t += reduceMotion ? 0.004 : 0.01;
        requestHeroFrame(page, draw);
    }

    draw();
}

// Crystal lattice and grains for Materials
function drawMaterialLattice(page, ctx, w, h) {
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cx = w / 2;
    const cy = h / 2;
    let t = 0;
    const grains = Array.from({ length: 30 }, (_, i) => ({
        a: (i / 30) * Math.PI * 2,
        r: 28 + (i % 7) * 17,
        s: 1.6 + (i % 5) * 0.9
    }));
    const atoms = [];
    for (let row = -2; row <= 2; row++) {
        for (let col = -2; col <= 2; col++) {
            atoms.push({ gx: col + (row % 2 ? 0.5 : 0), gy: row });
        }
    }

    function draw() {
        ctx.clearRect(0, 0, w, h);
        const spacing = Math.min(w, h) * 0.115;
        const radius = Math.min(w, h) * 0.3;
        const tilt = Math.sin(t * 0.5) * 0.1;

        // 背景颗粒（蓝紫景深）
        grains.forEach((g) => {
            const x = cx + Math.cos(g.a + t * 0.05) * g.r;
            const y = cy + Math.sin(g.a + t * 0.05) * g.r * 0.7;
            ctx.beginPath();
            ctx.arc(x, y, g.s, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(138,167,255,${0.1 + (g.s / 8) * 0.22})`;
            ctx.fill();
        });

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-0.12 + tilt * 0.3);

        const place = (a) => ({ x: a.gx * spacing, y: a.gy * spacing * 0.74 });
        const visible = atoms.filter((a) => Math.hypot(place(a).x, place(a).y) < radius * 1.05);

        // 原子键（近邻连线）
        ctx.strokeStyle = 'rgba(126,215,193,0.22)';
        ctx.lineWidth = 1.1;
        for (let i = 0; i < visible.length; i++) {
            for (let j = i + 1; j < visible.length; j++) {
                const a = place(visible[i]);
                const b = place(visible[j]);
                if (Math.hypot(a.x - b.x, a.y - b.y) < spacing * 1.15) {
                    ctx.beginPath();
                    ctx.moveTo(a.x, a.y);
                    ctx.lineTo(b.x, b.y);
                    ctx.stroke();
                }
            }
        }

        // 原子球（金色发光）
        visible.forEach((atom, i) => {
            const p = place(atom);
            const pulse = 1 + Math.sin(t * 1.3 + i) * 0.08;
            const glow = ctx.createRadialGradient(p.x, p.y, 0.5, p.x, p.y, 9 * pulse);
            glow.addColorStop(0, 'rgba(255,220,150,0.55)');
            glow.addColorStop(1, 'rgba(224,181,106,0)');
            ctx.fillStyle = glow;
            ctx.beginPath(); ctx.arc(p.x, p.y, 9 * pulse, 0, Math.PI * 2); ctx.fill();
            const body = ctx.createRadialGradient(p.x - 1.6, p.y - 1.6, 0.5, p.x, p.y, 5);
            body.addColorStop(0, '#fff1d4');
            body.addColorStop(0.6, '#e0b56a');
            body.addColorStop(1, '#9b7438');
            ctx.fillStyle = body;
            ctx.beginPath(); ctx.arc(p.x, p.y, 4.6 * pulse, 0, Math.PI * 2); ctx.fill();
        });

        // 晶界多边形
        ctx.strokeStyle = 'rgba(224,181,106,0.3)';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        for (let i = 0; i <= 6; i++) {
            const a = (i / 6) * Math.PI * 2 + t * 0.06;
            const x = Math.cos(a) * radius;
            const y = Math.sin(a) * radius * 0.74;
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();

        t += reduceMotion ? 0.004 : 0.016;
        requestHeroFrame(page, draw);
    }

    draw();
}

// Term nodes and context arcs for Humanities
function drawTextConstellation(page, ctx, w, h) {
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const terms = ['文本', '语境', '词项', '史料', '提问', '证据', '阅读', '关系'];
    const cx = w / 2;
    const cy = h / 2;
    let t = 0;

    function draw() {
        ctx.clearRect(0, 0, w, h);
        const radius = Math.min(w, h) * 0.33;

        // 背景文本基线
        ctx.strokeStyle = 'rgba(224,181,106,0.10)';
        ctx.lineWidth = 1;
        for (let line = 0; line < 7; line++) {
            const y = cy - radius * 0.8 + line * radius * 0.26 + Math.sin(t * 0.6 + line) * 1.5;
            ctx.beginPath();
            ctx.moveTo(cx - radius * 1.25, y);
            ctx.lineTo(cx + radius * 1.25, y);
            ctx.stroke();
        }

        const nodes = terms.map((term, index) => {
            const angle = -Math.PI / 2 + (index / terms.length) * Math.PI * 2 + Math.sin(t * 0.25) * 0.04;
            return {
                term,
                x: cx + Math.cos(angle) * radius * (0.78 + (index % 3) * 0.07),
                y: cy + Math.sin(angle) * radius * 0.66,
                r: 4.2 + (index % 4) * 0.7
            };
        });

        // 共现弧线（发光曲线）
        ctx.lineWidth = 1.2;
        for (let i = 0; i < nodes.length; i++) {
            const a = nodes[i];
            const b = nodes[(i + 2) % nodes.length];
            const midX = (a.x + b.x) / 2;
            const midY = (a.y + b.y) / 2 - 26 - (i % 3) * 10;
            const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
            grad.addColorStop(0, 'rgba(126,215,193,0.34)');
            grad.addColorStop(1, 'rgba(224,181,106,0.18)');
            ctx.strokeStyle = grad;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.quadraticCurveTo(midX, midY, b.x, b.y);
            ctx.stroke();
        }

        // 中心焦点辉光
        const focus = ctx.createRadialGradient(cx, cy, 1, cx, cy, radius * 0.5);
        focus.addColorStop(0, 'rgba(126,215,193,0.12)');
        focus.addColorStop(1, 'rgba(126,215,193,0)');
        ctx.fillStyle = focus;
        ctx.beginPath(); ctx.arc(cx, cy, radius * 0.5, 0, Math.PI * 2); ctx.fill();

        // 词项节点（发光球）
        nodes.forEach((node, index) => {
            const pulse = 1 + Math.sin(t * 1.2 + index) * 0.12;
            const col = index % 2 ? '126,215,193' : '224,181,106';
            const glow = ctx.createRadialGradient(node.x, node.y, 0.5, node.x, node.y, node.r * 2.4);
            glow.addColorStop(0, `rgba(${col},0.5)`);
            glow.addColorStop(1, `rgba(${col},0)`);
            ctx.fillStyle = glow;
            ctx.beginPath(); ctx.arc(node.x, node.y, node.r * 2.4 * pulse, 0, Math.PI * 2); ctx.fill();
            const body = ctx.createRadialGradient(node.x - 1, node.y - 1, 0.3, node.x, node.y, node.r);
            body.addColorStop(0, '#ffffff');
            body.addColorStop(1, index % 2 ? '#7ed7c1' : '#e0b56a');
            ctx.fillStyle = body;
            ctx.beginPath(); ctx.arc(node.x, node.y, node.r * pulse, 0, Math.PI * 2); ctx.fill();
        });

        // 词项标签
        ctx.fillStyle = 'rgba(235,245,242,0.82)';
        ctx.font = `600 12px ${typeof CF !== 'undefined' ? CF.sans : 'sans-serif'}`;
        ctx.textAlign = 'center';
        nodes.forEach((node) => {
            ctx.fillText(node.term, node.x, node.y - node.r - 6);
        });

        t += reduceMotion ? 0.004 : 0.014;
        requestHeroFrame(page, draw);
    }

    draw();
}

// Earth orbit and axial tilt for Earth & Space Science
function drawEarthOrbit(page, ctx, w, h) {
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let t = 0;
    const cx = w / 2;
    const cy = h / 2;
    const rx = Math.min(w, h) * 0.36;
    const ry = Math.min(w, h) * 0.215;
    const stars = Array.from({ length: 46 }, (_, i) => ({
        x: (Math.sin(i * 12.9 + 0.5) * 0.5 + 0.5) * w,
        y: (Math.sin(i * 78.2 + 2.1) * 0.5 + 0.5) * h,
        r: 0.4 + (i % 3) * 0.45,
        tw: 0.6 + (i % 5) * 0.3
    }));

    function draw() {
        ctx.clearRect(0, 0, w, h);

        stars.forEach((s, i) => {
            const a = 0.16 + Math.sin(t * s.tw + i) * 0.12;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(200,220,255,${Math.max(0.04, a)})`;
            ctx.fill();
        });

        // HUD 外刻度环
        ctx.save();
        ctx.translate(cx, cy);
        ctx.strokeStyle = 'rgba(116,185,255,0.12)';
        ctx.lineWidth = 1;
        const hudR = rx * 1.3;
        for (let k = 0; k < 72; k++) {
            const a = (k / 72) * Math.PI * 2;
            const long = k % 6 === 0;
            const r2 = hudR - (long ? 9 : 4);
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * hudR, Math.sin(a) * hudR * (ry / rx));
            ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2 * (ry / rx));
            ctx.stroke();
        }
        ctx.restore();

        // 公转轨道
        ctx.save();
        ctx.setLineDash([2, 6]);
        ctx.strokeStyle = 'rgba(116,185,255,0.28)';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        // 四季节点
        for (let i = 0; i < 4; i++) {
            const a = i * Math.PI / 2;
            ctx.beginPath();
            ctx.arc(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, 2.2, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(150,200,255,0.55)';
            ctx.fill();
        }

        // 太阳日冕射线（旋转）
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(reduceMotion ? 0 : t * 0.4);
        for (let i = 0; i < 28; i++) {
            const a = (i / 28) * Math.PI * 2;
            const len = 12 + (i % 2 ? 10 : 5) + Math.sin(t * 2 + i) * 3;
            ctx.strokeStyle = `rgba(255,206,110,${0.08 + (i % 2) * 0.05})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * 19, Math.sin(a) * 19);
            ctx.lineTo(Math.cos(a) * (19 + len), Math.sin(a) * (19 + len));
            ctx.stroke();
        }
        ctx.restore();

        // 太阳辉光 + 球体
        const sunGlow = ctx.createRadialGradient(cx, cy, 2, cx, cy, 62);
        sunGlow.addColorStop(0, 'rgba(255,244,214,0.9)');
        sunGlow.addColorStop(0.22, 'rgba(255,200,104,0.5)');
        sunGlow.addColorStop(0.55, 'rgba(240,160,70,0.12)');
        sunGlow.addColorStop(1, 'rgba(240,160,70,0)');
        ctx.fillStyle = sunGlow;
        ctx.beginPath();
        ctx.arc(cx, cy, 62, 0, Math.PI * 2);
        ctx.fill();
        const sunBody = ctx.createRadialGradient(cx - 4, cy - 4, 1, cx, cy, 16);
        sunBody.addColorStop(0, '#fff8e6');
        sunBody.addColorStop(0.55, '#ffce6e');
        sunBody.addColorStop(1, '#ef9f48');
        ctx.fillStyle = sunBody;
        ctx.beginPath();
        ctx.arc(cx, cy, 15, 0, Math.PI * 2);
        ctx.fill();

        // 地球位置
        const angle = t * 0.85;
        const ex = cx + Math.cos(angle) * rx;
        const ey = cy + Math.sin(angle) * ry;

        // 阳光光带
        const beam = ctx.createLinearGradient(cx, cy, ex, ey);
        beam.addColorStop(0, 'rgba(255,206,110,0.3)');
        beam.addColorStop(1, 'rgba(255,206,110,0)');
        ctx.strokeStyle = beam;
        ctx.lineWidth = 7;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.lineCap = 'butt';

        // 地球大气辉光
        const atm = ctx.createRadialGradient(ex, ey, 3, ex, ey, 23);
        atm.addColorStop(0, 'rgba(116,185,255,0.42)');
        atm.addColorStop(1, 'rgba(116,185,255,0)');
        ctx.fillStyle = atm;
        ctx.beginPath();
        ctx.arc(ex, ey, 23, 0, Math.PI * 2);
        ctx.fill();

        // 地球昼夜球体（光照朝向太阳）
        const dir = Math.atan2(cy - ey, cx - ex);
        const lx = ex + Math.cos(dir) * 5;
        const ly = ey + Math.sin(dir) * 5;
        const earth = ctx.createRadialGradient(lx, ly, 1, ex, ey, 12.5);
        earth.addColorStop(0, '#cfe6ff');
        earth.addColorStop(0.45, '#5b9bd6');
        earth.addColorStop(1, '#0c2746');
        ctx.fillStyle = earth;
        ctx.beginPath();
        ctx.arc(ex, ey, 12, 0, Math.PI * 2);
        ctx.fill();

        // 大陆斑块
        ctx.save();
        ctx.beginPath();
        ctx.arc(ex, ey, 12, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = 'rgba(118,196,142,0.42)';
        ctx.beginPath();
        ctx.ellipse(ex - 3 + Math.sin(t) * 1.5, ey + 2, 3.4, 2.2, 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(ex + 4 + Math.sin(t) * 1.5, ey - 3, 2.6, 1.7, -0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // 地轴（倾斜 23.5°）+ 极点
        const tilt = -0.41;
        const axisLen = 19;
        const axTopX = ex + Math.sin(tilt) * axisLen;
        const axTopY = ey - Math.cos(tilt) * axisLen;
        const axBotX = ex - Math.sin(tilt) * axisLen;
        const axBotY = ey + Math.cos(tilt) * axisLen;
        ctx.strokeStyle = 'rgba(226,239,255,0.72)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(axTopX, axTopY);
        ctx.lineTo(axBotX, axBotY);
        ctx.stroke();
        ctx.fillStyle = 'rgba(226,239,255,0.9)';
        ctx.beginPath();
        ctx.arc(axTopX, axTopY, 1.7, 0, Math.PI * 2);
        ctx.fill();

        t += reduceMotion ? 0.003 : 0.0095;
        requestHeroFrame(page, draw);
    }

    draw();
}

// Truss force path for Engineering
function drawEngineeringTruss(page, ctx, w, h) {
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let t = 0;
    const compression = '216,163,72';
    const tension = '79,180,170';

    function point(x, y) {
        return { x: w * (0.13 + x * 0.74), y: h * (0.64 - y * 0.34) };
    }

    function member(a, b, colorRGB, width, intensity) {
        ctx.save();
        ctx.shadowColor = `rgba(${colorRGB},0.5)`;
        ctx.shadowBlur = 6;
        ctx.strokeStyle = `rgba(${colorRGB},${0.4 + intensity * 0.4})`;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.restore();
        const fp = (t * 0.4) % 1;
        ctx.fillStyle = `rgba(255,255,255,${0.4 * intensity})`;
        ctx.beginPath();
        ctx.arc(a.x + (b.x - a.x) * fp, a.y + (b.y - a.y) * fp, 1.6, 0, Math.PI * 2);
        ctx.fill();
    }

    function draw() {
        ctx.clearRect(0, 0, w, h);
        const pulse = 0.5 + Math.sin(t) * 0.5;

        // HUD 网格
        ctx.strokeStyle = 'rgba(216,163,72,0.06)';
        ctx.lineWidth = 1;
        const gs = Math.max(28, Math.min(w, h) * 0.1);
        for (let x = gs; x < w; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
        for (let y = gs; y < h; y += gs) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

        const bottom = [0, 0.25, 0.5, 0.75, 1].map(x => point(x, 0));
        const top = [0.125, 0.375, 0.625, 0.875].map(x => point(x, 0.62));

        for (let i = 0; i < bottom.length - 1; i++) member(bottom[i], bottom[i + 1], tension, 2.6, 0.4 + pulse * 0.2);
        for (let i = 0; i < top.length - 1; i++) member(top[i], top[i + 1], compression, 3 + pulse * 1.2, 0.6 + pulse * 0.3);
        top.forEach((node, i) => {
            member(bottom[i], node, i % 2 ? compression : tension, 2.4 + pulse * 0.6, 0.5);
            member(node, bottom[i + 1], i % 2 ? tension : compression, 2.4 + pulse * 0.6, 0.5);
        });

        // 铰接节点（发光球）
        [...bottom, ...top].forEach((node, index) => {
            const r = index < bottom.length ? 4 : 3.4;
            const glow = ctx.createRadialGradient(node.x, node.y, 0.5, node.x, node.y, r * 2.4);
            glow.addColorStop(0, 'rgba(255,210,140,0.5)');
            glow.addColorStop(1, 'rgba(216,163,72,0)');
            ctx.fillStyle = glow;
            ctx.beginPath(); ctx.arc(node.x, node.y, r * 2.4, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#ffe6bd';
            ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, Math.PI * 2); ctx.fill();
        });

        // 支座（左右三角 + 地面影线）
        ctx.strokeStyle = 'rgba(216,220,230,0.5)';
        ctx.lineWidth = 1.4;
        [bottom[0], bottom[bottom.length - 1]].forEach((s) => {
            ctx.beginPath();
            ctx.moveTo(s.x, s.y);
            ctx.lineTo(s.x - 9, s.y + 14);
            ctx.lineTo(s.x + 9, s.y + 14);
            ctx.closePath();
            ctx.stroke();
            for (let k = -1; k <= 1; k++) {
                ctx.beginPath();
                ctx.moveTo(s.x - 9 + k * 6, s.y + 14);
                ctx.lineTo(s.x - 14 + k * 6, s.y + 20);
                ctx.stroke();
            }
        });

        // 载荷箭头（下压 + 脉冲）
        const load = bottom[2];
        ctx.strokeStyle = 'rgba(230,110,100,0.7)';
        ctx.fillStyle = 'rgba(230,110,100,0.8)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(load.x, load.y - h * (0.3 + pulse * 0.05));
        ctx.lineTo(load.x, load.y - 16);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(load.x, load.y - 7);
        ctx.lineTo(load.x - 8, load.y - 21);
        ctx.lineTo(load.x + 8, load.y - 21);
        ctx.closePath();
        ctx.fill();

        t += reduceMotion ? 0.005 : 0.022;
        requestHeroFrame(page, draw);
    }

    draw();
}
