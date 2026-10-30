// ===== DNA Helix Visualization v3 =====
// 3D Helix + Replication Fork + Transcription + Mutation Demo + Edu Panel
// Canvas-based, DPR-aware, ResizeObserver, event-cleanup

const DNAHelix = {
    canvas: null, ctx: null, W: 0, H: 0,
    info: null, animId: null,
    _listeners: [],

    // Mode: 'helix' | 'replication' | 'transcription' | 'mutation'
    mode: 'helix',

    // Helix state
    rotation: 0,
    autoRotate: true,
    replicating: false,
    replicationFork: -0.2,
    transcribing: false,
    transcriptionPos: -0.2,

    // Mutation
    mutationTarget: -1,
    mutationFlash: 0,

    // Interaction
    selectedPair: -1,
    hoverPair: -1,

    // Base pair data (16 pairs)
    basePairs: [
        { base: 'A', complement: 'T', fullName: ['\u817a\u560c\u5464\u201cA\u201d', '\u80f8\u817a\u5627\u5576\u201cT\u201d'] },
        { base: 'T', complement: 'A', fullName: ['\u80f8\u817a\u5627\u5576\u201cT\u201d', '\u817a\u560c\u5464\u201cA\u201d'] },
        { base: 'G', complement: 'C', fullName: ['\u9e1f\u560c\u5464\u201cG\u201d', '\u80de\u5627\u5576\u201cC\u201d'] },
        { base: 'C', complement: 'G', fullName: ['\u80de\u5627\u5576\u201cC\u201d', '\u9e1f\u560c\u5464\u201cG\u201d'] },
        { base: 'A', complement: 'T' }, { base: 'G', complement: 'C' },
        { base: 'T', complement: 'A' }, { base: 'C', complement: 'G' },
        { base: 'A', complement: 'T' }, { base: 'A', complement: 'T' },
        { base: 'G', complement: 'C' }, { base: 'T', complement: 'A' },
        { base: 'C', complement: 'G' }, { base: 'A', complement: 'T' },
        { base: 'G', complement: 'C' }, { base: 'C', complement: 'G' }
    ],

    // Transcription mRNA output
    mRNA: '',

    // Colors
    baseColors: {
        A: '#3a9e8f', T: '#c4793a', G: '#8b6fc0', C: '#5b8dce',
        U: '#b85450'
    },

    /* ============ Init / Destroy ============ */

    init() {
        if (this.canvas) this.destroy();
        this.canvas = document.getElementById('dna-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.info = document.getElementById('dna-info');

        this.resize();
        this.bindControls();
        this.bindCanvas();
        this.startLoop();
        this._injectInfoPanel();
        this._updateInfo();

        if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(() => this.resize());
            ro.observe(this.canvas.parentElement);
            this._ro = ro;
        }
        this._onResize = () => this.resize();
        window.addEventListener('resize', this._onResize);
    },

    destroy() {
        if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
        if (this._onResize) { window.removeEventListener('resize', this._onResize); }
        this._listeners.forEach(([el, evt, fn, opts]) => el.removeEventListener(evt, fn, opts));
        this._listeners = [];
    },

    _on(el, evt, fn, opts) {
        if (!el) return;
        el.addEventListener(evt, fn, opts);
        this._listeners.push([el, evt, fn, opts]);
    },

    resize() {
        const wrap = this.canvas.parentElement;
        if (!wrap) return;
        const w = wrap.clientWidth;
        if (w === 0) return;
        const h = Math.min(Math.max(w * 0.48, 300), 420);
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w; this.H = h;
    },

    bindControls() {
        // Rotate toggle
        this._on(document.getElementById('bio-dna-rotate'), 'click', () => {
            this.autoRotate = !this.autoRotate;
            const btn = document.getElementById('bio-dna-rotate');
            if (btn) btn.textContent = this.autoRotate ? '\u505c\u6b62\u65cb\u8f6c' : '\u65cb\u8f6c\u87ba\u65cb';
        });

        // Replicate
        this._on(document.getElementById('bio-dna-replicate'), 'click', () => {
            this.switchMode('replication');
            this.startReplication();
        });

        // Reset
        this._on(document.getElementById('bio-dna-reset'), 'click', () => {
            this.resetAll();
        });

        // Mode buttons (injected)
        this._injectModeButtons();

        // Transcription
        this._on(document.getElementById('bio-dna-transcribe'), 'click', () => {
            this.switchMode('transcription');
            this.startTranscription();
        });

        // Mutation
        this._on(document.getElementById('bio-dna-mutate'), 'click', () => {
            this.switchMode('mutation');
            this.performMutation();
        });
    },

    _injectModeButtons() {
        const section = this.canvas?.closest('.demo-section');
        const controls = section?.querySelector('.viz-controls');
        if (!controls) return;

        let wrap = document.getElementById('bio-dna-modes');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.id = 'bio-dna-modes';
            wrap.className = 'dna-modes';
            wrap.innerHTML = '<button class="dna-mode-btn active" data-mode="helix">\u53cc\u87ba\u65cb</button>'
                + '<button class="dna-mode-btn" data-mode="replication">\u590d\u5236</button>'
                + '<button class="dna-mode-btn" data-mode="transcription">\u8f6c\u5f55</button>'
                + '<button class="dna-mode-btn" data-mode="mutation">\u7a81\u53d8</button>';
            controls.parentElement.insertBefore(wrap, controls);
        }

        wrap.querySelectorAll('.dna-mode-btn').forEach(btn => {
            this._on(btn, 'click', () => {
                this.switchMode(btn.dataset.mode);
            });
        });
    },

    switchMode(mode) {
        this.mode = mode;
        document.querySelectorAll('.dna-mode-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.mode === mode);
        });

        const msgs = {
            helix: 'DNA \u53cc\u87ba\u65cb\u7ed3\u6784 \u2014 \u70b9\u51fb\u78b1\u57fa\u5bf9\u67e5\u770b\u8be6\u60c5',
            replication: '\u534a\u4fdd\u7559\u590d\u5236 \u2014 \u6bcf\u6761\u5b50\u94fe\u4fdd\u7559\u4e00\u6761\u6bcd\u94fe',
            transcription: '\u8f6c\u5f55 \u2014 DNA \u2192 mRNA\uff0c\u78b1\u57fa\u914d\u5bf9: A\u2192U, T\u2192A, G\u2192C, C\u2192G',
            mutation: '\u57fa\u56e0\u7a81\u53d8 \u2014 \u89c2\u5bdf\u78b1\u57fa\u66ff\u6362\u5bf9\u5e8f\u5217\u7684\u5f71\u54cd'
        };
        if (this.info) this.info.textContent = msgs[mode] || '';
        this._updateInfo();
    },

    resetAll() {
        this.mode = 'helix';
        this.replicating = false;
        this.replicationFork = -0.2;
        this.transcribing = false;
        this.transcriptionPos = -0.2;
        this.mRNA = '';
        this.mutationTarget = -1;
        this.mutationFlash = 0;
        this.selectedPair = -1;
        this.autoRotate = true;

        // Restore original bases
        this.basePairs = [
            { base: 'A', complement: 'T' }, { base: 'T', complement: 'A' },
            { base: 'G', complement: 'C' }, { base: 'C', complement: 'G' },
            { base: 'A', complement: 'T' }, { base: 'G', complement: 'C' },
            { base: 'T', complement: 'A' }, { base: 'C', complement: 'G' },
            { base: 'A', complement: 'T' }, { base: 'A', complement: 'T' },
            { base: 'G', complement: 'C' }, { base: 'T', complement: 'A' },
            { base: 'C', complement: 'G' }, { base: 'A', complement: 'T' },
            { base: 'G', complement: 'C' }, { base: 'C', complement: 'G' }
        ];

        document.querySelectorAll('.dna-mode-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.mode === 'helix');
        });
        const rotBtn = document.getElementById('bio-dna-rotate');
        if (rotBtn) rotBtn.textContent = '\u505c\u6b62\u65cb\u8f6c';
        if (this.info) this.info.textContent = 'DNA \u53cc\u87ba\u65cb\u7ed3\u6784 \u2014 \u70b9\u51fb\u78b1\u57fa\u5bf9\u67e5\u770b\u8be6\u60c5';
    },

    startReplication() {
        this.replicating = true;
        this.replicationFork = -0.2;
        this.autoRotate = false;
        this.rotation = 0;
        if (this.info) this.info.textContent = '\u590d\u5236\u8fdb\u884c\u4e2d... \u89e3\u65cb\u9176\u6253\u5f00\u53cc\u94fe\uff0cDNA\u805a\u5408\u9176\u5408\u6210\u65b0\u94fe';
    },

    startTranscription() {
        this.transcribing = true;
        this.transcriptionPos = -0.2;
        this.mRNA = '';
        this.autoRotate = false;
        this.rotation = 0;
        if (this.info) this.info.textContent = '\u8f6c\u5f55\u8fdb\u884c\u4e2d... RNA\u805a\u5408\u9176\u6cbf\u6a21\u677f\u94fe3\u2032\u21925\u2032\u65b9\u5411\u79fb\u52a8';
    },

    performMutation() {
        // Random point mutation
        const idx = Math.floor(Math.random() * this.basePairs.length);
        const bases = ['A', 'T', 'G', 'C'];
        const complements = { A: 'T', T: 'A', G: 'C', C: 'G' };
        const oldBase = this.basePairs[idx].base;
        let newBase;
        do { newBase = bases[Math.floor(Math.random() * 4)]; } while (newBase === oldBase);

        this.basePairs[idx] = { base: newBase, complement: complements[newBase] };
        this.mutationTarget = idx;
        this.mutationFlash = 1.0;

        if (this.info) {
            this.info.innerHTML = '<strong>\u70b9\u7a81\u53d8</strong>\uff1a\u4f4d\u7f6e ' + (idx + 1) + ' \u7684\u78b1\u57fa\u4ece '
                + oldBase + ' \u7a81\u53d8\u4e3a ' + newBase
                + '<br><span style="opacity:0.6">\u78b1\u57fa\u66ff\u6362\u53ef\u80fd\u5bfc\u81f4\u9519\u4e49\u7a81\u53d8\u3001\u65e0\u4e49\u7a81\u53d8\u6216\u7ec8\u6b62\u7a81\u53d8</span>';
        }
    },

    bindCanvas() {
        const hitTest = (mx, my) => {
            const { W, H } = this;
            const cx = W * 0.42, cy = H * 0.05;
            const spacing = (H * 0.75) / this.basePairs.length;
            for (let i = 0; i < this.basePairs.length; i++) {
                const y = cy + i * spacing + spacing / 2;
                if (Math.abs(my - y) < spacing * 0.4 && mx > cx - W * 0.25 && mx < cx + W * 0.25) {
                    return i;
                }
            }
            return -1;
        };

        this._on(this.canvas, 'mousemove', (e) => {
            const r = this.canvas.getBoundingClientRect();
            this.hoverPair = hitTest(e.clientX - r.left, e.clientY - r.top);
            this.canvas.style.cursor = this.hoverPair >= 0 ? 'pointer' : 'default';
        });

        this._on(this.canvas, 'mouseleave', () => { this.hoverPair = -1; });

        this._on(this.canvas, 'click', (e) => {
            const r = this.canvas.getBoundingClientRect();
            const idx = hitTest(e.clientX - r.left, e.clientY - r.top);
            if (idx >= 0) {
                this.selectedPair = this.selectedPair === idx ? -1 : idx;
                if (this.selectedPair >= 0) {
                    const bp = this.basePairs[idx];
                    const bondType = (bp.base === 'A' || bp.base === 'T') ? '2\u4e2a\u6c22\u952e' : '3\u4e2a\u6c22\u952e';
                    const ringType = (bp.base === 'A' || bp.base === 'G') ? '\u560c\u5464(\u53cc\u73af)' : '\u5627\u5576(\u5355\u73af)';
                    if (this.info) {
                        this.info.innerHTML = '<strong>\u78b1\u57fa\u5bf9 #' + (idx + 1) + '</strong>: '
                            + bp.base + ' \u2014 ' + bp.complement + ' | ' + bondType
                            + ' | ' + bp.base + ' \u662f' + ringType;
                    }
                }
            }
        });

        this._on(this.canvas, 'touchstart', (e) => {
            e.preventDefault();
            const r = this.canvas.getBoundingClientRect();
            const t = e.touches[0];
            const idx = hitTest(t.clientX - r.left, t.clientY - r.top);
            if (idx >= 0) { this.selectedPair = idx; }
        }, { passive: false });
    },

    /* ============ Animation Loop ============ */

    startLoop() {
        let lastTime = 0;
        const loop = (now) => {
            if (!now) now = performance.now();
            const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.1) : 0.016;
            lastTime = now;

            this.update(dt);
            this.draw();
            this.animId = requestAnimationFrame(loop);
        };
        this.animId = requestAnimationFrame(loop);
    },

    update(dt) {
        if (this.autoRotate) {
            this.rotation += dt * 0.8;
        }

        if (this.replicating) {
            this.replicationFork += dt * 0.25;
            if (this.replicationFork > 1.3) {
                this.replicating = false;
                if (this.info) this.info.textContent = '\u590d\u5236\u5b8c\u6210\uff01\u6bcf\u6761\u65b0DNA\u5206\u5b50\u5305\u542b\u4e00\u6761\u6bcd\u94fe\u548c\u4e00\u6761\u5b50\u94fe';
            }
        }

        if (this.transcribing) {
            this.transcriptionPos += dt * 0.22;
            // Build mRNA as transcription progresses
            const progress = this.transcriptionPos;
            const pairsTranscribed = Math.floor(progress * this.basePairs.length);
            let newRNA = '';
            const complement = { A: 'U', T: 'A', G: 'C', C: 'G' };
            for (let i = 0; i < Math.min(pairsTranscribed, this.basePairs.length); i++) {
                newRNA += complement[this.basePairs[i].base] || '?';
            }
            this.mRNA = newRNA;

            if (this.transcriptionPos > 1.3) {
                this.transcribing = false;
                if (this.info) {
                    this.info.innerHTML = '<strong>\u8f6c\u5f55\u5b8c\u6210</strong> | mRNA: <code style="color:#b85450">'
                        + this.mRNA + '</code>';
                }
            }
        }

        if (this.mutationFlash > 0) {
            this.mutationFlash -= dt * 1.5;
            if (this.mutationFlash < 0) this.mutationFlash = 0;
        }
    },

    /* ============ Main Draw ============ */

    draw() {
        const { ctx, W, H } = this;
        if (!ctx || W === 0) return;
        ctx.clearRect(0, 0, W, H);

        // Background
        ctx.fillStyle = '#0a0f12';
        ctx.fillRect(0, 0, W, H);

        switch (this.mode) {
            case 'helix':
            case 'mutation':
                this._drawHelix(ctx, W, H); break;
            case 'replication':
                this._drawReplication(ctx, W, H); break;
            case 'transcription':
                this._drawTranscription(ctx, W, H); break;
        }

        // Edu panel at bottom
        this._drawEdu(ctx, W, H);
    },

    /* ── 3D Helix Drawing ── */

    _drawHelix(ctx, W, H) {
        const fs = Math.max(11, W * 0.019), fsSm = fs - 3;
        const cx = W * 0.42;
        const helixH = H * 0.65;
        const topY = H * 0.06;
        const n = this.basePairs.length;
        const spacing = helixH / n;
        const radius = W * 0.15;
        const rot = this.rotation;

        // Collect draw commands for depth sorting
        const drawCmds = [];

        for (let i = 0; i < n; i++) {
            const bp = this.basePairs[i];
            const y = topY + i * spacing + spacing / 2;
            const angle = rot + i * 0.45;
            const cos = Math.cos(angle), sin = Math.sin(angle);

            // Left and right backbone positions
            const lx = cx + cos * radius;
            const rx = cx - cos * radius;
            const depth = sin; // -1..1

            const isHover = this.hoverPair === i;
            const isSelected = this.selectedPair === i;
            const isMutated = this.mutationTarget === i && this.mutationFlash > 0;

            drawCmds.push({
                depth, y, i,
                draw: () => {
                    // Hydrogen bonds (middle line)
                    const bondCount = (bp.base === 'A' || bp.base === 'T') ? 2 : 3;
                    ctx.strokeStyle = isSelected ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.08)';
                    ctx.lineWidth = isHover ? 1.5 : 0.8;
                    ctx.setLineDash([2, 3]);
                    for (let b = 0; b < bondCount; b++) {
                        const f = (b + 1) / (bondCount + 1);
                        const bx1 = lx + (rx - lx) * (0.3 + f * 0.1);
                        const bx2 = lx + (rx - lx) * (0.5 + f * 0.1);
                        ctx.beginPath(); ctx.moveTo(bx1, y); ctx.lineTo(bx2, y); ctx.stroke();
                    }
                    ctx.setLineDash([]);

                    // Base pair shapes
                    const baseR = isHover || isSelected ? 11 : 9;
                    const alpha = 0.5 + depth * 0.3;

                    // Left base
                    ctx.globalAlpha = alpha;
                    ctx.beginPath(); ctx.arc(lx, y, baseR, 0, Math.PI * 2);
                    const lColor = this.baseColors[bp.base] || '#fff';
                    ctx.fillStyle = lColor + (isMutated ? 'cc' : '66');
                    ctx.fill();
                    if (isMutated) {
                        ctx.strokeStyle = '#ff4444';
                        ctx.lineWidth = 2;
                        ctx.stroke();
                    }
                    ctx.fillStyle = '#fff';
                    ctx.font = 'bold ' + fs + 'px ' + CF.mono;
                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.fillText(bp.base, lx, y);

                    // Right base (complement)
                    ctx.beginPath(); ctx.arc(rx, y, baseR, 0, Math.PI * 2);
                    const rColor = this.baseColors[bp.complement] || '#fff';
                    ctx.fillStyle = rColor + (isMutated ? 'cc' : '66');
                    ctx.fill();
                    if (isMutated) {
                        ctx.strokeStyle = '#ff4444';
                        ctx.lineWidth = 2;
                        ctx.stroke();
                    }
                    ctx.fillStyle = '#fff';
                    ctx.fillText(bp.complement, rx, y);
                    ctx.globalAlpha = 1;

                    // Backbone dots (sugar-phosphate)
                    const bbAlpha = 0.3 + depth * 0.2;
                    ctx.fillStyle = `rgba(120,170,200,${bbAlpha})`;
                    ctx.beginPath(); ctx.arc(lx + cos * 8, y, 3.5, 0, Math.PI * 2); ctx.fill();
                    ctx.beginPath(); ctx.arc(rx - cos * 8, y, 3.5, 0, Math.PI * 2); ctx.fill();
                }
            });
        }

        // Sort by depth (back to front)
        drawCmds.sort((a, b) => a.depth - b.depth);

        // Draw backbone connections first
        ctx.strokeStyle = 'rgba(120,170,200,0.12)';
        ctx.lineWidth = 2;
        for (let i = 0; i < n - 1; i++) {
            const y1 = topY + i * spacing + spacing / 2;
            const y2 = topY + (i + 1) * spacing + spacing / 2;
            const a1 = rot + i * 0.45, a2 = rot + (i + 1) * 0.45;

            // Left backbone
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a1) * radius + Math.cos(a1) * 8, y1);
            ctx.lineTo(cx + Math.cos(a2) * radius + Math.cos(a2) * 8, y2);
            ctx.stroke();

            // Right backbone
            ctx.beginPath();
            ctx.moveTo(cx - Math.cos(a1) * radius - Math.cos(a1) * 8, y1);
            ctx.lineTo(cx - Math.cos(a2) * radius - Math.cos(a2) * 8, y2);
            ctx.stroke();
        }

        // Draw base pairs
        drawCmds.forEach(cmd => cmd.draw());

        // Direction arrows
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.font = fs + 'px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText("5' \u2192 3'", cx + radius + 20, topY + 10);
        ctx.textAlign = 'right';
        ctx.fillText("3' \u2190 5'", cx - radius - 20, topY + 10);

        // Groove labels
        const midY = topY + helixH * 0.4;
        const grooveAngle = rot + (n * 0.45 * 0.4);
        if (Math.cos(grooveAngle) > 0.3) {
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            ctx.font = fsSm + 'px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.fillText('\u5927\u6c9f', cx + radius * 0.5, midY - 8);
            ctx.fillText('\u5c0f\u6c9f', cx - radius * 0.5, midY + 8);
        }

        // Legend (right side)
        this._drawLegend(ctx, W, H);
    },

    _drawLegend(ctx, W, H) {
        const fs = Math.max(11, W * 0.019), fsSm = fs - 3;
        const lx = W * 0.75, ly = 20;
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '600 ' + fsSm + 'px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText('\u78b1\u57fa\u56fe\u4f8b', lx, ly);

        const items = [
            ['A', '\u817a\u560c\u5464 (Adenine)', this.baseColors.A],
            ['T', '\u80f8\u817a\u5627\u5576 (Thymine)', this.baseColors.T],
            ['G', '\u9e1f\u560c\u5464 (Guanine)', this.baseColors.G],
            ['C', '\u80de\u5627\u5576 (Cytosine)', this.baseColors.C]
        ];

        items.forEach(([letter, name, color], i) => {
            const y = ly + 22 + i * (fsSm + 6);
            ctx.fillStyle = color + '88';
            ctx.beginPath(); ctx.arc(lx + 6, y - 3, 7, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold ' + fsSm + 'px ' + CF.mono;
            ctx.textAlign = 'center';
            ctx.fillText(letter, lx + 6, y);
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = fsSm + 'px ' + CF.sans;
            ctx.textAlign = 'left';
            ctx.fillText(name, lx + 18, y);
        });

        // H-bond info
        const by = ly + 22 + items.length * (fsSm + 6) + 10;
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.font = fsSm + 'px ' + CF.sans;
        ctx.fillText('A=T : 2\u4e2a\u6c22\u952e', lx, by);
        ctx.fillText('G\u2261C : 3\u4e2a\u6c22\u952e', lx, by + fsSm + 4);

        // Ring types
        ctx.fillText('A,G : \u560c\u5464(\u53cc\u73af)', lx, by + (fsSm + 4) * 2 + 6);
        ctx.fillText('T,C : \u5627\u5576(\u5355\u73af)', lx, by + (fsSm + 4) * 3 + 6);
    },

    /* ── Replication Drawing ── */

    _drawReplication(ctx, W, H) {
        const fs = Math.max(11, W * 0.019), fsSm = fs - 3;
        const cx = W * 0.42;
        const helixH = H * 0.65;
        const topY = H * 0.06;
        const n = this.basePairs.length;
        const spacing = helixH / n;
        const radius = W * 0.12;
        const fork = this.replicationFork;

        for (let i = 0; i < n; i++) {
            const bp = this.basePairs[i];
            const y = topY + i * spacing + spacing / 2;
            const progress = i / n;
            const separated = progress < fork;
            const newStrand = progress < fork - 0.15;

            if (separated) {
                // Separated strands
                const separation = Math.min((fork - progress) * 3, 1) * radius * 1.8;

                // Original left strand
                const lx = cx - separation * 0.5;
                ctx.fillStyle = this.baseColors[bp.base] + '88';
                ctx.beginPath(); ctx.arc(lx, y, 8, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.font = 'bold ' + fsSm + 'px ' + CF.mono;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(bp.base, lx, y);

                // Original right strand
                const rx = cx + separation * 0.5;
                ctx.fillStyle = this.baseColors[bp.complement] + '88';
                ctx.beginPath(); ctx.arc(rx, y, 8, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.fillText(bp.complement, rx, y);

                // New complementary bases
                if (newStrand) {
                    const alpha = Math.min((fork - 0.15 - progress) * 5, 1);
                    ctx.globalAlpha = alpha;

                    // New complement for left
                    ctx.fillStyle = this.baseColors[bp.complement] + '55';
                    ctx.beginPath(); ctx.arc(lx - 20, y, 7, 0, Math.PI * 2); ctx.fill();
                    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 0.8;
                    ctx.setLineDash([2, 2]);
                    ctx.beginPath(); ctx.moveTo(lx - 12, y); ctx.lineTo(lx - 8, y); ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.fillStyle = '#fff';
                    ctx.font = 'bold ' + fs + 'px ' + CF.mono;
                    ctx.fillText(bp.complement, lx - 20, y);

                    // New complement for right
                    ctx.fillStyle = this.baseColors[bp.base] + '55';
                    ctx.beginPath(); ctx.arc(rx + 20, y, 7, 0, Math.PI * 2); ctx.fill();
                    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 0.8;
                    ctx.setLineDash([2, 2]);
                    ctx.beginPath(); ctx.moveTo(rx + 8, y); ctx.lineTo(rx + 12, y); ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.fillStyle = '#fff';
                    ctx.fillText(bp.base, rx + 20, y);

                    ctx.globalAlpha = 1;
                }
            } else {
                // Still paired (below fork)
                const lx = cx - radius * 0.5;
                const rx = cx + radius * 0.5;

                // Hydrogen bonds
                ctx.strokeStyle = 'rgba(255,255,255,0.1)';
                ctx.lineWidth = 0.8;
                ctx.setLineDash([2, 3]);
                ctx.beginPath(); ctx.moveTo(lx + 10, y); ctx.lineTo(rx - 10, y); ctx.stroke();
                ctx.setLineDash([]);

                ctx.fillStyle = this.baseColors[bp.base] + '66';
                ctx.beginPath(); ctx.arc(lx, y, 8, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.font = 'bold ' + fsSm + 'px ' + CF.mono;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(bp.base, lx, y);

                ctx.fillStyle = this.baseColors[bp.complement] + '66';
                ctx.beginPath(); ctx.arc(rx, y, 8, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.fillText(bp.complement, rx, y);
            }
        }

        // Fork indicator
        const forkY = topY + fork * helixH;
        if (fork > 0 && fork < 1.1) {
            ctx.fillStyle = 'rgba(255,200,50,0.6)';
            ctx.beginPath();
            ctx.moveTo(cx - 3, forkY - 6); ctx.lineTo(cx + 3, forkY - 6);
            ctx.lineTo(cx, forkY); ctx.closePath(); ctx.fill();

            ctx.fillStyle = 'rgba(255,200,50,0.5)';
            ctx.font = fsSm + 'px ' + CF.sans;
            ctx.textAlign = 'right';
            ctx.fillText('\u89e3\u65cb\u9176', cx - 10, forkY - 2);
        }

        // Labels
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = fs + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('\u6bcd\u94fe', cx - radius * 0.5 - 28, topY + 10);
        ctx.fillText('\u6bcd\u94fe', cx + radius * 0.5 + 28, topY + 10);
        if (fork > 0.2) {
            ctx.fillStyle = 'rgba(255,255,255,0.2)';
            ctx.fillText('\u5b50\u94fe', cx - radius * 0.5 - 28, topY + 26);
            ctx.fillText('\u5b50\u94fe', cx + radius * 0.5 + 28, topY + 26);
        }

        this._drawLegend(ctx, W, H);
    },

    /* ── Transcription Drawing ── */

    _drawTranscription(ctx, W, H) {
        const fs = Math.max(11, W * 0.019), fsSm = fs - 3;
        const cx = W * 0.35;
        const helixH = H * 0.60;
        const topY = H * 0.06;
        const n = this.basePairs.length;
        const spacing = helixH / n;
        const pos = this.transcriptionPos;
        const complement = { A: 'U', T: 'A', G: 'C', C: 'G' };

        for (let i = 0; i < n; i++) {
            const bp = this.basePairs[i];
            const y = topY + i * spacing + spacing / 2;
            const progress = i / n;
            const isActive = Math.abs(progress - pos) < 0.08;
            const isTranscribed = progress < pos;

            // Template strand (left)
            const lx = cx - 15;
            ctx.fillStyle = this.baseColors[bp.base] + (isActive ? 'cc' : '55');
            ctx.beginPath(); ctx.arc(lx, y, isActive ? 10 : 8, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold ' + fsSm + 'px ' + CF.mono;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(bp.base, lx, y);

            // Coding strand (right of template)
            const rx = cx + 15;
            ctx.fillStyle = this.baseColors[bp.complement] + '44';
            ctx.beginPath(); ctx.arc(rx, y, 7, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = fsSm + 'px ' + CF.mono;
            ctx.fillText(bp.complement, rx, y);

            // mRNA being synthesized
            if (isTranscribed || isActive) {
                const mBase = complement[bp.base] || '?';
                const mx = cx + 55;
                const alpha = isActive ? Math.min((pos - progress) * 10, 1) : 0.8;
                ctx.globalAlpha = alpha;
                ctx.fillStyle = (this.baseColors[mBase] || '#b85450') + 'aa';
                ctx.beginPath(); ctx.arc(mx, y, 8, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.font = 'bold ' + fsSm + 'px ' + CF.mono;
                ctx.fillText(mBase, mx, y);

                // Arrow from template to mRNA
                if (isActive) {
                    ctx.strokeStyle = 'rgba(255,200,50,0.3)';
                    ctx.lineWidth = 1;
                    ctx.beginPath(); ctx.moveTo(lx + 12, y); ctx.lineTo(mx - 10, y); ctx.stroke();
                }
                ctx.globalAlpha = 1;
            }
        }

        // RNA Polymerase indicator
        const polY = topY + pos * helixH;
        if (pos > 0 && pos < 1.1) {
            ctx.fillStyle = 'rgba(184,84,80,0.4)';
            ctx.beginPath(); ctx.ellipse(cx + 20, polY, 18, 10, 0, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = 'rgba(184,84,80,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            ctx.font = fsSm + 'px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.fillText('RNA\u805a\u5408\u9176', cx + 20, polY + 2);
        }

        // Labels
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = fs + 'px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText("\u6a21\u677f\u94fe 3'\u21925'", cx - 15, topY - 8);
        ctx.fillText("\u7f16\u7801\u94fe 5'\u21923'", cx + 15, topY - 8);
        ctx.fillText('mRNA', cx + 55, topY - 8);

        // mRNA output display
        if (this.mRNA.length > 0) {
            const mRNAy = H * 0.7;
            ctx.fillStyle = 'rgba(184,84,80,0.08)';
            ctx.fillRect(W * 0.6, 20, W * 0.36, H * 0.4);
            ctx.strokeStyle = 'rgba(184,84,80,0.2)';
            ctx.lineWidth = 1;
            ctx.strokeRect(W * 0.6, 20, W * 0.36, H * 0.4);

            ctx.fillStyle = 'rgba(184,84,80,0.6)';
            ctx.font = '600 ' + fs + 'px ' + CF.sans;
            ctx.textAlign = 'left';
            ctx.fillText('mRNA \u5e8f\u5217', W * 0.62, 36);

            // Draw mRNA bases as a grid
            const cols = 8;
            const cellW = Math.min((W * 0.32) / cols, 22);
            for (let i = 0; i < this.mRNA.length; i++) {
                const col = i % cols, row = Math.floor(i / cols);
                const bx = W * 0.62 + col * cellW;
                const by = 50 + row * 22;
                const base = this.mRNA[i];

                ctx.fillStyle = (this.baseColors[base] || '#b85450') + '55';
                ctx.fillRect(bx, by, cellW - 2, 18);
                ctx.fillStyle = '#fff';
                ctx.font = 'bold ' + fs + 'px ' + CF.mono;
                ctx.textAlign = 'center';
                ctx.fillText(base, bx + cellW / 2 - 1, by + 13);
            }

            // Show codons
            if (this.mRNA.length >= 3) {
                const codons = [];
                for (let i = 0; i + 2 < this.mRNA.length; i += 3) {
                    codons.push(this.mRNA.slice(i, i + 3));
                }
                ctx.fillStyle = 'rgba(255,255,255,0.3)';
                ctx.font = fs + 'px ' + CF.sans;
                ctx.textAlign = 'left';
                ctx.fillText('\u5bc6\u7801\u5b50: ' + codons.join(' - '), W * 0.62, 50 + Math.ceil(this.mRNA.length / cols) * 22 + 16);
            }
        }
    },

    /* ── Edu Panel ── */

    _drawEdu(ctx, W, H) {
        const fs = Math.max(11, W * 0.019), fsSm = fs - 3;
        const y0 = H * 0.78;
        ctx.fillStyle = 'rgba(58,158,143,0.06)';
        ctx.fillRect(8, y0, W - 16, H - y0 - 8);
        ctx.strokeStyle = 'rgba(58,158,143,0.15)';
        ctx.lineWidth = 1;
        ctx.strokeRect(8, y0, W - 16, H - y0 - 8);

        const eduContent = {
            helix: {
                title: 'DNA \u53cc\u87ba\u65cb\u7ed3\u6784',
                lines: [
                    '\u2022 \u4e24\u6761\u53cd\u5411\u5e73\u884c\u7684\u591a\u6838\u82f7\u9178\u94fe\uff0c\u53f3\u624b\u87ba\u65cb\uff0c\u6bcf\u5708 10 \u4e2a\u78b1\u57fa\u5bf9\uff0c\u87ba\u8ddd 3.4nm',
                    '\u2022 \u78b1\u57fa\u4e92\u8865\u914d\u5bf9: A=T(2H), G\u2261C(3H)\uff0c\u4fdd\u8bc1 Chargaff \u5b9a\u5f8b'
                ]
            },
            replication: {
                title: '\u534a\u4fdd\u7559\u590d\u5236',
                lines: [
                    '\u2022 \u89e3\u65cb\u9176\u6253\u5f00\u53cc\u94fe\uff0cDNA \u805a\u5408\u9176 III \u6cbf 5\u2032\u21923\u2032 \u65b9\u5411\u5408\u6210\u65b0\u94fe',
                    '\u2022 \u524d\u5bfc\u94fe\u8fde\u7eed\u5408\u6210\uff0c\u540e\u968f\u94fe\u4e0d\u8fde\u7eed\u5408\u6210(\u5188\u5d0e\u7247\u6bb5)'
                ]
            },
            transcription: {
                title: '\u8f6c\u5f55\u8fc7\u7a0b',
                lines: [
                    '\u2022 RNA \u805a\u5408\u9176\u6cbf\u6a21\u677f\u94fe 3\u2032\u21925\u2032 \u79fb\u52a8\uff0c\u5408\u6210 mRNA(5\u2032\u21923\u2032)',
                    '\u2022 \u78b1\u57fa\u914d\u5bf9: A\u2192U, T\u2192A, G\u2192C, C\u2192G\uff0cU(\u5c3f\u5627\u5576)\u66ff\u4ee3T'
                ]
            },
            mutation: {
                title: '\u57fa\u56e0\u7a81\u53d8',
                lines: [
                    '\u2022 \u70b9\u7a81\u53d8: \u78b1\u57fa\u5bf9\u7684\u589e\u6dfb/\u7f3a\u5931/\u66ff\u6362\uff0c\u53ef\u80fd\u5f71\u54cd\u86cb\u767d\u8d28\u529f\u80fd',
                    '\u2022 \u540c\u4e49\u7a81\u53d8(\u65e0\u4e49) / \u9519\u4e49\u7a81\u53d8 / \u7ec8\u6b62\u7a81\u53d8'
                ]
            }
        };

        const content = eduContent[this.mode] || eduContent.helix;
        ctx.fillStyle = 'rgba(58,158,143,0.6)';
        ctx.font = '600 ' + fs + 'px ' + CF.sans;
        ctx.textAlign = 'left';
        ctx.fillText(content.title, 18, y0 + 16);

        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = fs + 'px ' + CF.sans;
        content.lines.forEach((line, i) => {
            ctx.fillText(line, 18, y0 + 34 + i * 18);
        });
    },

    _injectInfoPanel() {
        const el = document.getElementById('dnahelix-info');
        if (!el) return;
        el.innerHTML = `
            <div class="dnahelix-info__hd">\ud83e\uddec DNA\u5206\u5b50\u7ed3\u6784\u4e0e\u529f\u80fd</div>
            <div class="dnahelix-info__grid">
                <div class="dnahelix-info__block">
                    <div class="dnahelix-info__sub">\u5f53\u524d\u6a21\u5f0f</div>
                    <div class="dnahelix-info__val" id="dnahelix-mode">\u53cc\u87ba\u65cb\u7ed3\u6784</div>
                </div>
                <div class="dnahelix-info__block">
                    <div class="dnahelix-info__sub">\u6a21\u5f0f\u8bf4\u660e</div>
                    <div class="dnahelix-info__desc" id="dnahelix-mode-desc">\u4e24\u6761\u53cd\u5411\u5e73\u884c\u7684\u8131\u6c27\u6838\u82f7\u9178\u94fe\u901a\u8fc7\u78b1\u57fa\u5bf9\u76f8\u8fde</div>
                </div>
            </div>
            <div class="dnahelix-info__row"><span class="dnahelix-info__key" style="--c:#3a9e8f">\u78b1\u57fa\u914d\u5bf9</span>A=T (2\u4e2a\u6c22\u952e) &nbsp; G\u2261C (3\u4e2a\u6c22\u952e)</div>
            <div class="dnahelix-info__row"><span class="dnahelix-info__key" style="--c:#8b6fc0">\u57fa\u672c\u5355\u4f4d</span>\u8131\u6c27\u6838\u82f7\u9178 = \u78f7\u9178\u57fa\u56e2 + \u8131\u6c27\u6838\u7cd6 + \u542b\u6c2e\u78b1\u57fa</div>
            <div class="dnahelix-info__note">\u4eba\u6559\u7248\u5fc5\u4fee2 \u2014 Watson\u548cCrick\u4e8e1953\u5e74\u63d0\u51fa\u53cc\u87ba\u65cb\u7ed3\u6784\u6a21\u578b\uff0c\u70b9\u51fb\u78b1\u57fa\u5bf9\u53ef\u67e5\u770b\u8be6\u60c5</div>
        `;
    },

    _updateInfo() {
        const modeEl = document.getElementById('dnahelix-mode');
        const descEl = document.getElementById('dnahelix-mode-desc');
        if (!modeEl) return;
        const data = {
            helix:         ['\u53cc\u87ba\u65cb\u7ed3\u6784', '\u4e24\u6761\u53cd\u5411\u5e73\u884c\u7684\u8131\u6c27\u6838\u82f7\u9178\u94fe\u901a\u8fc7\u78b1\u57fa\u5bf9\u76f8\u8fde'],
            replication:   ['\u534a\u4fdd\u7559\u590d\u5236', '\u4ee5\u6bcd\u94fe\u4e3a\u6a21\u677f\uff0c\u6309\u78b1\u57fa\u4e92\u8865\u914d\u5bf9\u539f\u5219\u5408\u6210\u5b50\u94fe\uff0c\u6bcf\u6761\u5b50DNA\u4fdd\u7559\u4e00\u6761\u6bcd\u94fe'],
            transcription: ['\u8f6c\u5f55\u8fc7\u7a0b', 'DNA\u89e3\u65cb\uff0c\u4ee5\u6a21\u677f\u94fe3\u2032\u21925\u2032\u5408\u6210mRNA\uff0c\u78b1\u57fa\u914d\u5bf9: A\u2192U, T\u2192A, G\u2192C, C\u2192G'],
            mutation:      ['\u57fa\u56e0\u7a81\u53d8', '\u78b1\u57fa\u5bf9\u7684\u589e\u6dfb\u3001\u7f3a\u5931\u6216\u66ff\u6362\uff0c\u53ef\u5bfc\u81f4\u86cb\u767d\u8d28\u7ed3\u6784\u6539\u53d8']
        };
        const d = data[this.mode] || data.helix;
        modeEl.textContent = d[0];
        descEl.textContent = d[1];
    }
};

function initDNAHelix() {
    DNAHelix.init();
}
