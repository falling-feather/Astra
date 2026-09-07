// ===== Cell Structure Visualization — v2 =====
// DPR · ResizeObserver · Detailed organelle rendering · Click-to-zoom

const CellStructure = {
    canvas: null, ctx: null, W: 0, H: 0,
    info: null,
    isPlant: false,
    showLabels: true,
    hoveredOrganelle: null,

    // Zoom
    zoomed: null,            // organelle object or null
    zoomProgress: 0,         // 0 = overview, 1 = zoomed
    zoomTarget: 0,

    // Animation
    time: 0,
    animId: null,
    _ro: null,
    _listeners: [],
    _lpTimer: null,
    _lpStartXY: null,
    _lpOrg: null,
    _lpPreview: false,

    /* ═══════════ Core ═══════════ */

    init() {
        this.destroy();
        this.canvas = document.getElementById('cell-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.info = document.getElementById('cell-info');

        this.resize();
        this.bindControls();
        this.bindCanvas();
        this.startLoop();
        this._injectInfoPanel();
        this._updateInfo();

        if (typeof ResizeObserver !== 'undefined') {
            this._ro = new ResizeObserver(() => this.resize());
            this._ro.observe(this.canvas.parentElement);
        } else {
            this._on(window, 'resize', () => this.resize());
        }
    },

    destroy() {
        if (this.animId) cancelAnimationFrame(this.animId);
        this.animId = null;
        if (this._lpTimer) clearTimeout(this._lpTimer);
        this._lpTimer = null;
        if (this._ro) this._ro.disconnect();
        this._ro = null;
        this._listeners.forEach(({ el, event, handler, options }) => {
            el.removeEventListener(event, handler, options);
        });
        this._listeners.length = 0;
        if (this.canvas) this.canvas.style.cursor = '';
        this.hoveredOrganelle = null;
        this.zoomed = null;
        this.zoomProgress = 0;
        this.zoomTarget = 0;
        this._lpStartXY = null;
        this._lpOrg = null;
        this._lpPreview = false;
        this.canvas = null;
        this.ctx = null;
        this.info = null;
        this.W = 0;
        this.H = 0;
    },

    _on(el, event, handler, options) {
        if (!el) return;
        el.addEventListener(event, handler, options);
        this._listeners.push({ el, event, handler, options });
    },

    resize() {
        if (!this.canvas || !this.ctx) return;
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
        this.W = w;
        this.H = h;
    },

    bindControls() {
        const toggleBtn = document.getElementById('bio-cell-toggle');
        this._on(toggleBtn, 'click', () => {
            this.isPlant = !this.isPlant;
            this.hoveredOrganelle = null;
            this.zoomOut();
            this._updateInfo();
        });
        const labelBtn = document.getElementById('bio-cell-label-toggle');
        this._on(labelBtn, 'click', () => { this.showLabels = !this.showLabels; });
        this._on(document, 'keydown', (e) => { if (e.key === 'Escape' && this.zoomed) this.zoomOut(); });
    },

    bindCanvas() {
        const hitTest = (mx, my) => {
            const list = this.getOrganelles();
            for (let i = list.length - 1; i >= 0; i--) {
                const o = list[i];
                const dx = (mx - o.x) / o.rx, dy = (my - o.y) / o.ry;
                if (dx * dx + dy * dy <= 1) return o;
            }
            return null;
        };

        this._on(this.canvas, 'mousemove', (e) => {
            if (this.zoomed) { this.canvas.style.cursor = 'zoom-out'; return; }
            const r = this.canvas.getBoundingClientRect();
            this.hoveredOrganelle = hitTest((e.clientX - r.left) / this.W, (e.clientY - r.top) / this.H);
            this.canvas.style.cursor = this.hoveredOrganelle ? 'zoom-in' : 'default';
        });

        this._on(this.canvas, 'mouseleave', () => { this.hoveredOrganelle = null; });

        this._on(this.canvas, 'click', () => {
            if (this.zoomed) { this.zoomOut(); return; }
            if (this.hoveredOrganelle) this.zoomTo(this.hoveredOrganelle);
        });

        this._on(this.canvas, 'touchstart', (e) => {
            e.preventDefault();
            if (this.zoomed) { this.zoomOut(); return; }
            const r = this.canvas.getBoundingClientRect();
            const t = e.touches[0];
            this._lpStartXY = { x: t.clientX, y: t.clientY };
            this._lpOrg = hitTest((t.clientX - r.left) / this.W, (t.clientY - r.top) / this.H);
            this._lpPreview = false;
            if (!this._lpOrg) return;
            this._lpTimer = setTimeout(() => {
                this._lpPreview = true;
                this.hoveredOrganelle = this._lpOrg;
                if (this.info) this.info.innerHTML =
                    `<strong>${this._lpOrg.name}</strong>：${this._lpOrg.desc}<br><span style="opacity:0.5;font-size:0.85em">松开返回 / 短按放大</span>`;
                if (navigator.vibrate) navigator.vibrate(20);
                this._lpTimer = null;
            }, 350);
        }, { passive: false });

        this._on(this.canvas, 'touchmove', (e) => {
            if (!this._lpStartXY || !e.touches[0]) return;
            const dx = e.touches[0].clientX - this._lpStartXY.x;
            const dy = e.touches[0].clientY - this._lpStartXY.y;
            if (dx * dx + dy * dy > 100) {
                if (this._lpTimer) { clearTimeout(this._lpTimer); this._lpTimer = null; }
                if (this._lpPreview) { this.hoveredOrganelle = null; this._lpPreview = false; }
                this._lpOrg = null;
            }
        }, { passive: true });

        this._on(this.canvas, 'touchend', () => {
            if (this._lpTimer) {
                clearTimeout(this._lpTimer); this._lpTimer = null;
                if (this._lpOrg) this.zoomTo(this._lpOrg);
            } else if (this._lpPreview) {
                this.hoveredOrganelle = null;
                this._lpPreview = false;
            }
            this._lpStartXY = null;
            this._lpOrg = null;
        });

        this._on(this.canvas, 'touchcancel', () => {
            if (this._lpTimer) { clearTimeout(this._lpTimer); this._lpTimer = null; }
            if (this._lpPreview) {
                this.hoveredOrganelle = null;
                this._lpPreview = false;
            }
            this._lpStartXY = null;
            this._lpOrg = null;
        });
    },

    zoomTo(org) {
        this.zoomed = org;
        this.zoomTarget = 1;
        if (this.info) this.info.innerHTML =
            `<strong>${org.name}</strong>：${org.desc}<br><span style="opacity:0.5;font-size:0.85em">点击画布或按 ESC 返回总览</span>`;
    },

    zoomOut() {
        this.zoomed = null;
        this.zoomTarget = 0;
        if (this.info) this.info.textContent =
            (this.isPlant ? '植物细胞' : '动物细胞') + ' — 点击细胞器查看内部结构';
    },

    startLoop() {
        if (this.animId) cancelAnimationFrame(this.animId);
        const loop = () => {
            if (!this.ctx) { this.animId = null; return; }
            this.time += 0.016;
            this.zoomProgress += (this.zoomTarget - this.zoomProgress) * 0.12;
            if (Math.abs(this.zoomProgress - this.zoomTarget) < 0.002) this.zoomProgress = this.zoomTarget;
            this.draw();
            this.animId = requestAnimationFrame(loop);
        };
        this.animId = requestAnimationFrame(loop);
    },

    /* ═══════════ Organelle Data ═══════════ */

    getOrganelles() { return this.isPlant ? this._plant() : this._animal(); },

    _animal() {
        return [
            { id: 'membrane', name: '细胞膜', x: .5, y: .5, rx: .44, ry: .42,
              color: 'rgba(91,141,206,0.06)', border: '#5b8dce',
              desc: '磷脂双分子层构成的半透膜，镶嵌多种膜蛋白（通道蛋白、载体蛋白），控制物质进出细胞，具有选择透过性和流动性。' },
            { id: 'nucleus', name: '细胞核', x: .5, y: .42, rx: .14, ry: .13,
              color: 'rgba(139,111,192,0.12)', border: '#8b6fc0',
              desc: '双层核膜包裹，核膜上有核孔复合体允许 mRNA 等大分子通过。内含核仁（合成 rRNA）和染色质（DNA + 组蛋白）。' },
            { id: 'mito', name: '线粒体', x: .25, y: .35, rx: .07, ry: .04,
              color: 'rgba(196,121,58,0.15)', border: '#c4793a',
              desc: '双层膜结构：外膜光滑，内膜向内折叠形成嵴(cristae)以增大面积。基质含少量环状 DNA 和核糖体。有氧呼吸产生 ATP 的主要场所。' },
            { id: 'mito', name: '线粒体', x: .73, y: .62, rx: .06, ry: .035,
              color: 'rgba(196,121,58,0.15)', border: '#c4793a', hl: true,
              desc: '双层膜结构：外膜光滑，内膜向内折叠形成嵴(cristae)以增大面积。有氧呼吸产生 ATP 的主要场所。' },
            { id: 'er', name: '内质网', x: .64, y: .34, rx: .10, ry: .07,
              color: 'rgba(77,158,126,0.08)', border: '#4d9e7e',
              desc: '单层膜构成的扁平囊状/管状网络系统。粗面 ER 附有核糖体参与蛋白质合成加工；光面 ER 参与脂质合成和 Ca²⁺ 储存。' },
            { id: 'golgi', name: '高尔基体', x: .34, y: .63, rx: .07, ry: .045,
              color: 'rgba(184,84,80,0.12)', border: '#b85450',
              desc: '由扁平膜囊(cisternae)堆叠而成。cis 面接收 ER 输送的蛋白，经过糖基化等修饰后从 trans 面以囊泡形式分泌分拣。' },
            { id: 'lysosome', name: '溶酶体', x: .43, y: .73, rx: .035, ry: .035,
              color: 'rgba(220,160,60,0.2)', border: '#dca03c',
              desc: '单层膜囊泡，内含 60 多种酸性水解酶(最适 pH≈5)，消化衰老细胞器和外来异物，是细胞内的"消化车间"。' },
            { id: 'centrosome', name: '中心体', x: .60, y: .69, rx: .03, ry: .03,
              color: 'rgba(79,168,163,0.2)', border: '#4fa8a3',
              desc: '由两个互相垂直的中心粒(9×3微管排列)和周围基质组成。在有丝分裂时形成纺锤体，牵引染色体分离。典型动物细胞常见；高等植物细胞通常没有中心粒。' },
            { id: 'ribosome', name: '核糖体', x: .55, y: .22, rx: .015, ry: .015,
              color: 'rgba(255,255,255,0.35)', border: '#aaa',
              desc: '由 rRNA 和蛋白质构成的大小两个亚基(60S+40S)。游离核糖体合成胞内蛋白，附着核糖体合成分泌蛋白。无膜结构。' }
        ];
    },

    _plant() {
        return [
            { id: 'wall', name: '细胞壁', x: .5, y: .5, rx: .47, ry: .45,
              color: 'rgba(77,158,126,0.04)', border: '#4d9e7e',
              desc: '主要成分纤维素微纤丝，通过胞间连丝(plasmodesmata)连通相邻细胞。全透性，提供机械支持和保护。植物细胞常见结构。' },
            { id: 'membrane', name: '细胞膜', x: .5, y: .5, rx: .43, ry: .41,
              color: 'rgba(91,141,206,0.06)', border: '#5b8dce',
              desc: '紧贴细胞壁内侧的磷脂双分子层半透膜，控制物质进出。' },
            { id: 'vacuole', name: '液泡', x: .5, y: .56, rx: .22, ry: .2,
              color: 'rgba(91,141,206,0.06)', border: 'rgba(91,141,206,0.45)',
              desc: '由液泡膜(tonoplast)包裹的大型囊泡，内含细胞液（水、糖、有机酸、花青素、无机盐），维持渗透压和膨压。成熟植物细胞特征。' },
            { id: 'nucleus', name: '细胞核', x: .5, y: .32, rx: .11, ry: .10,
              color: 'rgba(139,111,192,0.12)', border: '#8b6fc0',
              desc: '双层核膜包裹，内含核仁和染色质。核孔允许大分子通过，是遗传信息的控制中心。' },
            { id: 'chloroplast', name: '叶绿体', x: .26, y: .40, rx: .06, ry: .035,
              color: 'rgba(58,158,143,0.2)', border: '#3a9e8f',
              desc: '双层膜结构。内含类囊体(thylakoid)堆叠成基粒(grana)，基粒间由基质类囊体相连。基质(stroma)含 DNA、核糖体和淀粉粒。绿色植物进行光合作用的细胞常见，并非所有植物细胞都含有。' },
            { id: 'chloroplast', name: '叶绿体', x: .72, y: .44, rx: .055, ry: .032,
              color: 'rgba(58,158,143,0.2)', border: '#3a9e8f', hl: true,
              desc: '双层膜结构。类囊体堆叠成基粒，基质含 DNA 和核糖体。绿色植物进行光合作用的细胞常见，并非所有植物细胞都含有。' },
            { id: 'mito', name: '线粒体', x: .30, y: .58, rx: .055, ry: .03,
              color: 'rgba(196,121,58,0.15)', border: '#c4793a',
              desc: '双层膜结构，内膜折叠形成嵴。有氧呼吸产生 ATP。' },
            { id: 'er', name: '内质网', x: .68, y: .32, rx: .08, ry: .055,
              color: 'rgba(77,158,126,0.08)', border: '#4d9e7e',
              desc: '单层膜网络系统，参与蛋白质和脂质的合成与运输。' },
            { id: 'golgi', name: '高尔基体', x: .38, y: .44, rx: .05, ry: .035,
              color: 'rgba(184,84,80,0.12)', border: '#b85450',
              desc: '在植物细胞中与细胞壁形成有关，参与纤维素和多糖的合成与分泌。' }
        ];
    },

    /* ═══════════ Main Draw ═══════════ */

    draw() {
        const { ctx, W, H } = this;
        if (!ctx || W === 0) return;
        ctx.clearRect(0, 0, W, H);
        const fs = Math.max(11, W * 0.019);

        const zp = this.zoomProgress;

        // Overview layer
        if (zp < 1) {
            ctx.globalAlpha = 1 - zp;
            this.drawOverview(ctx, W, H);
            ctx.globalAlpha = 1;
        }

        // Detail layer
        if (zp > 0.01 && this.zoomed) {
            ctx.globalAlpha = zp;
            this.drawDetail(ctx, W, H, this.zoomed);
            ctx.globalAlpha = 1;
        }

        // Type badge (always)
        ctx.fillStyle = `rgba(255,255,255,${0.4 * (1 - zp)})`;
        ctx.font = '500 ' + (fs + 5) + 'px ' + CF.sans;
        ctx.textAlign = 'right';
        ctx.fillText(this.isPlant ? '🌱 植物细胞' : '🔬 动物细胞', W - 14, H - 12);
    },

    /* ═══════════ Overview ═══════════ */

    drawOverview(ctx, W, H) {
        const fs = Math.max(11, W * 0.019);
        const list = this.getOrganelles();
        const t = this.time;

        for (const o of list) {
            const cx = o.x * W, cy = o.y * H;
            const breathe = 1 + Math.sin(t * 1.5 + o.x * 10) * 0.006;
            const rx = o.rx * W * breathe, ry = o.ry * H * breathe;
            const hov = this.hoveredOrganelle === o;

            ctx.save();
            this._drawOrganelleShape(ctx, o.id, cx, cy, rx, ry, o, hov);

            // Border
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
            ctx.strokeStyle = o.border;
            ctx.lineWidth = hov ? 2.5 : 1.5;
            if (hov) { ctx.shadowColor = o.border; ctx.shadowBlur = 14; }
            ctx.stroke();
            ctx.shadowBlur = 0;

            // Label
            if (this.showLabels && !o.hl) {
                ctx.fillStyle = hov ? '#fff' : o.border;
                ctx.font = `${hov ? '600 ' : '500 '}${fs - 3}px ${CF.sans}`;
                ctx.textAlign = 'center';
                ctx.fillText(o.name, cx, cy - ry - 7);
            }

            // Zoom-in icon on hover
            if (hov) {
                const ix = cx + rx - 10, iy = cy - ry + 10;
                ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.arc(ix, iy, 5, 0, Math.PI * 2); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(ix + 3.8, iy + 3.8); ctx.lineTo(ix + 7, iy + 7); ctx.stroke();
                ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(ix - 2.5, iy); ctx.lineTo(ix + 2.5, iy); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(ix, iy - 2.5); ctx.lineTo(ix, iy + 2.5); ctx.stroke();
            }
            ctx.restore();
        }
    },

    /* ── organelle-specific overview shapes ── */

    _drawOrganelleShape(ctx, id, cx, cy, rx, ry, o, hov) {
        const key = id.replace(/\d+$/, '');
        switch (key) {
            case 'membrane': return this._ovMembrane(ctx, cx, cy, rx, ry, hov);
            case 'wall':     return this._ovWall(ctx, cx, cy, rx, ry);
            case 'nucleus':  return this._ovNucleus(ctx, cx, cy, rx, ry, hov);
            case 'mito':     return this._ovMito(ctx, cx, cy, rx, ry, hov);
            case 'er':       return this._ovER(ctx, cx, cy, rx, ry, hov);
            case 'golgi':    return this._ovGolgi(ctx, cx, cy, rx, ry, hov);
            case 'lysosome': return this._ovLysosome(ctx, cx, cy, rx, ry, hov);
            case 'centrosome': return this._ovCentrosome(ctx, cx, cy, rx, ry, hov);
            case 'ribosome': return this._ovRibosome(ctx, cx, cy, rx, ry, hov);
            case 'chloroplast': return this._ovChloroplast(ctx, cx, cy, rx, ry, hov);
            case 'vacuole':  return this._ovVacuole(ctx, cx, cy, rx, ry, hov);
            default:
                ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
                ctx.fillStyle = o.color; ctx.fill();
        }
    },

    _ovMembrane(ctx, cx, cy, rx, ry, hov) {
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(91,141,206,0.04)'; ctx.fill();
        const n = Math.round(Math.max(30, rx * 0.6));
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            const px = cx + Math.cos(a) * rx, py = cy + Math.sin(a) * ry;
            const nx = -Math.sin(a), ny = Math.cos(a) * (rx / ry);
            const len = Math.hypot(nx, ny) || 1;
            const ux = nx / len * 2.5, uy = ny / len * 2.5;
            ctx.fillStyle = 'rgba(91,141,206,0.22)';
            ctx.beginPath(); ctx.arc(px + ux, py + uy, 1.6, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(px - ux, py - uy, 1.6, 0, Math.PI * 2); ctx.fill();
        }
        const chAngles = [0.12, 0.38, 0.61, 0.85];
        for (const f of chAngles) {
            const a = f * Math.PI * 2;
            ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, hov ? 4.5 : 3.5, 0, Math.PI * 2);
            ctx.fillStyle = hov ? 'rgba(91,141,206,0.5)' : 'rgba(91,141,206,0.3)'; ctx.fill();
        }
    },

    _ovWall(ctx, cx, cy, rx, ry) {
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(77,158,126,0.03)'; ctx.fill();
        ctx.save(); ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.clip();
        ctx.strokeStyle = 'rgba(77,158,126,0.06)'; ctx.lineWidth = 0.8;
        for (let i = -25; i < 25; i++) {
            ctx.beginPath(); ctx.moveTo(cx - rx + i * 16, cy - ry); ctx.lineTo(cx - rx + i * 16 + ry, cy + ry); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(cx - rx + i * 16, cy + ry); ctx.lineTo(cx - rx + i * 16 + ry, cy - ry); ctx.stroke();
        }
        ctx.restore();
    },

    _ovNucleus(ctx, cx, cy, rx, ry, hov) {
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = hov ? 'rgba(139,111,192,0.15)' : 'rgba(139,111,192,0.08)'; ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx, cy, rx * .92, ry * .92, 0, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(139,111,192,0.2)'; ctx.lineWidth = .8; ctx.stroke();
        const nr = Math.min(rx, ry) * 0.3;
        ctx.beginPath(); ctx.arc(cx + rx * .15, cy - ry * .05, nr, 0, Math.PI * 2);
        ctx.fillStyle = hov ? 'rgba(139,111,192,0.35)' : 'rgba(139,111,192,0.18)'; ctx.fill();
        ctx.strokeStyle = 'rgba(139,111,192,0.14)'; ctx.lineWidth = 1;
        for (let i = 0; i < 5; i++) {
            ctx.beginPath();
            const sx = cx - rx * .5 + i * rx * .25, sy = cy - ry * .4;
            ctx.moveTo(sx, sy);
            for (let t = 0; t < 5; t++) {
                ctx.quadraticCurveTo(sx + (t % 2 ? 7 : -7), sy + t * ry * .15, sx + (t % 2 ? 3 : -3), sy + (t + .5) * ry * .15);
            }
            ctx.stroke();
        }
        for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2 + .3;
            ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rx * .96, cy + Math.sin(a) * ry * .96, 2, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(139,111,192,0.3)'; ctx.fill();
        }
    },

    _ovMito(ctx, cx, cy, rx, ry, hov) {
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = hov ? 'rgba(196,121,58,0.18)' : 'rgba(196,121,58,0.1)'; ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx, cy, rx * .88, ry * .82, 0, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(196,121,58,0.25)'; ctx.lineWidth = .8; ctx.stroke();
        ctx.strokeStyle = 'rgba(196,121,58,0.3)'; ctx.lineWidth = 1.2;
        const folds = 3;
        for (let i = 0; i < folds; i++) {
            const f = (i + 1) / (folds + 1);
            const xp = cx - rx * .7 + f * rx * 1.4;
            const side = i % 2 === 0 ? 1 : -1;
            ctx.beginPath();
            ctx.moveTo(cx + side * rx * .82, cy + (f - .5) * ry * .8);
            ctx.quadraticCurveTo(xp, cy + (f - .5) * ry * .2, xp - side * rx * .15, cy + (f - .5) * ry * .8);
            ctx.stroke();
        }
    },

    _ovER(ctx, cx, cy, rx, ry, hov) {
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = hov ? 'rgba(77,158,126,0.1)' : 'rgba(77,158,126,0.05)'; ctx.fill();
        ctx.strokeStyle = 'rgba(77,158,126,0.25)'; ctx.lineWidth = 1.2;
        for (let row = -2; row <= 2; row++) {
            ctx.beginPath();
            const y0 = cy + row * ry * .3;
            for (let t = 0; t <= 20; t++) {
                const x = cx - rx * .8 + (t / 20) * rx * 1.6;
                const y = y0 + Math.sin(t * 1.2) * ry * .08;
                t === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        for (let row = -2; row <= 0; row++) {
            const y0 = cy + row * ry * .3;
            for (let t = 2; t <= 18; t += 3) {
                const x = cx - rx * .8 + (t / 20) * rx * 1.6;
                const y = y0 + Math.sin(t * 1.2) * ry * .08 - 3;
                ctx.beginPath(); ctx.arc(x, y, 1.2, 0, Math.PI * 2); ctx.fill();
            }
        }
    },

    _ovGolgi(ctx, cx, cy, rx, ry, hov) {
        const layers = 4;
        for (let i = 0; i < layers; i++) {
            const f = (i - (layers - 1) / 2) / layers;
            const yOff = f * ry * 1.6;
            const curve = rx * (.9 - Math.abs(f) * .3);
            ctx.beginPath();
            ctx.moveTo(cx - curve, cy + yOff);
            ctx.quadraticCurveTo(cx, cy + yOff - ry * .18, cx + curve, cy + yOff);
            ctx.quadraticCurveTo(cx, cy + yOff + ry * .18, cx - curve, cy + yOff);
            ctx.fillStyle = hov ? 'rgba(184,84,80,0.18)' : 'rgba(184,84,80,0.1)'; ctx.fill();
            ctx.strokeStyle = 'rgba(184,84,80,0.35)'; ctx.lineWidth = 1; ctx.stroke();
        }
        const vesicles = [[.8, -.6], [-.85, .5], [.7, .7]];
        for (const [vx, vy] of vesicles) {
            ctx.beginPath(); ctx.arc(cx + vx * rx, cy + vy * ry, 3.5, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(184,84,80,0.2)'; ctx.fill();
            ctx.strokeStyle = 'rgba(184,84,80,0.3)'; ctx.lineWidth = .8; ctx.stroke();
        }
    },

    _ovLysosome(ctx, cx, cy, rx, ry, hov) {
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
        g.addColorStop(0, hov ? 'rgba(220,160,60,0.35)' : 'rgba(220,160,60,0.2)');
        g.addColorStop(1, 'rgba(220,160,60,0.05)');
        ctx.fillStyle = g; ctx.fill();
        for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2 + this.time * .5;
            const d = rx * .45;
            ctx.beginPath(); ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * (ry / rx), 1.5, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(220,160,60,0.5)'; ctx.fill();
        }
    },

    _ovCentrosome(ctx, cx, cy, rx, ry, hov) {
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = hov ? 'rgba(79,168,163,0.25)' : 'rgba(79,168,163,0.12)'; ctx.fill();
        const s = Math.min(rx, ry) * .35;
        ctx.fillStyle = 'rgba(79,168,163,0.4)';
        ctx.fillRect(cx - s, cy - 1.5, s * 2, 3);
        ctx.fillRect(cx - 1.5, cy - s, 3, s * 2);
        for (const [dx, dy] of [[s,0],[-s,0],[0,s],[0,-s]]) {
            ctx.beginPath(); ctx.arc(cx + dx, cy + dy, 2, 0, Math.PI * 2); ctx.fill();
        }
    },

    _ovRibosome(ctx, cx, cy, rx, ry, hov) {
        ctx.beginPath(); ctx.arc(cx, cy + ry * .15, rx * .7, 0, Math.PI * 2);
        ctx.fillStyle = hov ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.25)'; ctx.fill();
        ctx.beginPath(); ctx.arc(cx, cy - ry * .25, rx * .5, 0, Math.PI * 2);
        ctx.fillStyle = hov ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.18)'; ctx.fill();
    },

    _ovChloroplast(ctx, cx, cy, rx, ry, hov) {
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = hov ? 'rgba(58,158,143,0.25)' : 'rgba(58,158,143,0.12)'; ctx.fill();
        const stacks = 3;
        for (let s = 0; s < stacks; s++) {
            const gx = cx + (s - 1) * rx * .45;
            for (let d = -1; d <= 1; d++) {
                ctx.fillStyle = 'rgba(58,158,143,0.3)';
                ctx.fillRect(gx - rx * .08, cy + d * ry * .22 - 2, rx * .16, 4);
            }
        }
        ctx.strokeStyle = 'rgba(58,158,143,0.15)'; ctx.lineWidth = .8;
        ctx.beginPath(); ctx.moveTo(cx - rx * .45, cy); ctx.lineTo(cx + rx * .45, cy); ctx.stroke();
    },

    _ovVacuole(ctx, cx, cy, rx, ry, hov) {
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = hov ? 'rgba(91,141,206,0.1)' : 'rgba(91,141,206,0.04)'; ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx, cy, rx * .95, ry * .95, 0, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(91,141,206,0.2)'; ctx.lineWidth = .8; ctx.stroke();
        for (let i = 0; i < 8; i++) {
            const a = ((7 * (i + 1) * 3571) % 10000) / 10000 * Math.PI * 2;
            const d = ((7 * (i + 1) * 7919) % 10000) / 10000 * .6 + .1;
            ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rx * d, cy + Math.sin(a) * ry * d, 1.5, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(91,141,206,0.2)'; ctx.fill();
        }
    },

    /* ═══════════ Detail / Zoomed View ═══════════ */

    drawDetail(ctx, W, H, org) {
        const fs = Math.max(11, W * 0.019);
        const key = org.id.replace(/\d+$/, '');
        ctx.fillStyle = '#0c1018'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = org.border;
        ctx.font = 'bold ' + (fs + 11) + 'px ' + CF.sans; ctx.textAlign = 'left';
        ctx.fillText(org.name + ' — 内部结构', 16, 28);
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = fs + 'px ' + CF.sans; ctx.textAlign = 'right';
        ctx.fillText('点击返回  ✕', W - 14, 22);

        const pad = 40;
        const dw = W - pad * 2, dh = H - pad * 2 - 10;
        const dcx = W / 2, dcy = H / 2 + 10;

        switch (key) {
            case 'membrane': this._detMembrane(ctx, dcx, dcy, dw, dh, org); break;
            case 'nucleus':  this._detNucleus(ctx, dcx, dcy, dw, dh, org); break;
            case 'mito':     this._detMito(ctx, dcx, dcy, dw, dh, org); break;
            case 'er':       this._detER(ctx, dcx, dcy, dw, dh, org); break;
            case 'golgi':    this._detGolgi(ctx, dcx, dcy, dw, dh, org); break;
            case 'chloroplast': this._detChloroplast(ctx, dcx, dcy, dw, dh, org); break;
            case 'vacuole':  this._detVacuole(ctx, dcx, dcy, dw, dh, org); break;
            case 'wall':     this._detWall(ctx, dcx, dcy, dw, dh, org); break;
            default:         this._detGeneric(ctx, dcx, dcy, dw, dh, org);
        }
    },

    _label(ctx, x, y, text, color, align) {
        const fs = Math.max(13, this.W * 0.024);
        ctx.fillStyle = color || 'rgba(255,255,255,0.6)';
        ctx.font = '500 ' + fs + 'px ' + CF.sans;
        ctx.textAlign = align || 'left';
        ctx.fillText(text, x, y);
    },

    _arrow(ctx, x1, y1, x2, y2, color) {
        ctx.strokeStyle = color || 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.setLineDash([]);
    },

    /* ── 细胞膜 detail ── */
    _detMembrane(ctx, cx, cy, w, h, org) {
        const bH = h * .35;
        const y0 = cy - bH / 2;
        const headR = Math.min(w * .014, 8);
        const tailL = bH * .32;
        const gap = headR * 2.8;
        const count = Math.floor(w * .75 / gap);
        const startX = cx - (count * gap) / 2;

        this._label(ctx, cx, y0 - tailL - headR - 18, '细胞外 (Extracellular)', 'rgba(255,255,255,0.4)', 'center');
        this._label(ctx, cx, y0 + bH + tailL + headR + 24, '细胞内 (Intracellular)', 'rgba(255,255,255,0.4)', 'center');

        for (let i = 0; i < count; i++) {
            const x = startX + i * gap + gap / 2;
            this._phospholipid(ctx, x, y0, headR, tailL, -1, '#5b8dce');
            this._phospholipid(ctx, x, y0 + bH, headR, tailL, 1, '#5b8dce');
        }

        const chX = cx - w * .15;
        this._channelProtein(ctx, chX, y0, bH, headR, tailL);
        this._arrow(ctx, chX, y0 - tailL - headR - 8, chX - w * .12, y0 - tailL - headR - 30, org.border);
        this._label(ctx, chX - w * .12 - 4, y0 - tailL - headR - 36, '通道蛋白', org.border, 'center');

        const cpX = cx + w * .18;
        ctx.fillStyle = 'rgba(196,121,58,0.3)';
        ctx.beginPath(); ctx.ellipse(cpX, cy, 14, bH * .35, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#c4793a'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(cpX, cy, 3.5, 0, Math.PI * 2); ctx.fillStyle = '#c4793a'; ctx.fill();
        this._arrow(ctx, cpX, y0 - tailL - headR - 8, cpX + w * .1, y0 - tailL - headR - 30, '#c4793a');
        this._label(ctx, cpX + w * .1 + 4, y0 - tailL - headR - 36, '载体蛋白', '#c4793a', 'center');

        const gpX = cx + w * .02;
        ctx.fillStyle = 'rgba(77,158,126,0.3)';
        ctx.fillRect(gpX - 5, y0 - tailL - headR, 10, bH + tailL * 2 + headR * 2);
        ctx.strokeStyle = '#4d9e7e'; ctx.lineWidth = 1;
        ctx.strokeRect(gpX - 5, y0 - tailL - headR, 10, bH + tailL * 2 + headR * 2);
        ctx.strokeStyle = '#4d9e7e'; ctx.lineWidth = 1.5;
        for (const dx of [-8, 0, 8]) {
            ctx.beginPath(); ctx.moveTo(gpX, y0 - tailL - headR);
            ctx.lineTo(gpX + dx, y0 - tailL - headR - 10); ctx.stroke();
            ctx.beginPath(); ctx.arc(gpX + dx, y0 - tailL - headR - 12, 2.5, 0, Math.PI * 2);
            ctx.fillStyle = '#4d9e7e'; ctx.fill();
        }
        this._arrow(ctx, gpX, y0 - tailL - headR * 3 - 12, gpX + w * .08, y0 - tailL - headR - 42, '#4d9e7e');
        this._label(ctx, gpX + w * .08 + 4, y0 - tailL - headR - 48, '糖蛋白', '#4d9e7e', 'center');

        const bx = startX - 14;
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(bx, y0 - tailL - headR); ctx.lineTo(bx - 6, y0 - tailL - headR);
        ctx.lineTo(bx - 6, y0 + bH + tailL + headR); ctx.lineTo(bx, y0 + bH + tailL + headR); ctx.stroke();
        this._label(ctx, bx - 10, cy + 4, '磷脂双分子层', 'rgba(255,255,255,0.35)', 'right');
    },

    _phospholipid(ctx, x, y, r, tail, dir, color) {
        ctx.beginPath(); ctx.arc(x, y - dir * (tail + r), r, 0, Math.PI * 2);
        ctx.fillStyle = color + '66'; ctx.fill();
        ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
        ctx.strokeStyle = color + '55'; ctx.lineWidth = 1.5;
        for (const off of [-r * .35, r * .35]) {
            ctx.beginPath(); ctx.moveTo(x + off, y - dir * tail);
            ctx.quadraticCurveTo(x + off + 2, y - dir * tail * .5, x + off - 1, y);
            ctx.stroke();
        }
    },

    _channelProtein(ctx, x, y0, bH, headR, tailL) {
        const pw = 18, ph = bH + tailL * 2 + headR * 2;
        const top = y0 - tailL - headR;
        ctx.fillStyle = 'rgba(91,141,206,0.25)';
        ctx.beginPath();
        ctx.moveTo(x - pw / 2, top); ctx.lineTo(x - pw / 2, top + ph);
        ctx.lineTo(x - 3, top + ph); ctx.quadraticCurveTo(x - 1, top + ph * .5, x - 3, top);
        ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x + pw / 2, top); ctx.lineTo(x + pw / 2, top + ph);
        ctx.lineTo(x + 3, top + ph); ctx.quadraticCurveTo(x + 1, top + ph * .5, x + 3, top);
        ctx.closePath(); ctx.fill();
        const iy = top + ph * (.5 + Math.sin(this.time * 2) * .2);
        ctx.beginPath(); ctx.arc(x, iy, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#8b6fc0'; ctx.fill();
    },

    /* ── 细胞核 detail ── */
    _detNucleus(ctx, cx, cy, w, h, org) {
        const rx = w * .42, ry = h * .42;
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(139,111,192,0.06)'; ctx.fill();
        ctx.strokeStyle = '#8b6fc0'; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.beginPath(); ctx.ellipse(cx, cy, rx - 5, ry - 5, 0, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(139,111,192,0.4)'; ctx.lineWidth = 1.5; ctx.stroke();

        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const px = cx + Math.cos(a) * (rx - 2.5), py = cy + Math.sin(a) * (ry - 2.5);
            ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fillStyle = '#0c1018'; ctx.fill();
            ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(139,111,192,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.beginPath(); ctx.arc(px, py, 1.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(139,111,192,0.4)'; ctx.fill();
        }
        this._arrow(ctx, cx + Math.cos(.4) * rx + 8, cy + Math.sin(.4) * ry, cx + rx + 30, cy - ry * .3, org.border);
        this._label(ctx, cx + rx + 32, cy - ry * .3, '核孔复合体');

        const nlR = Math.min(rx, ry) * .22, nlx = cx + rx * .18, nly = cy - ry * .1;
        ctx.beginPath(); ctx.arc(nlx, nly, nlR, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(139,111,192,0.25)'; ctx.fill();
        ctx.strokeStyle = 'rgba(139,111,192,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            ctx.beginPath(); ctx.arc(nlx + Math.cos(a) * nlR * .5, nly + Math.sin(a) * nlR * .5, 2, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(139,111,192,0.3)'; ctx.fill();
        }
        this._arrow(ctx, nlx, nly + nlR + 4, nlx - rx * .2, cy + ry * .4, '#a78bfa');
        this._label(ctx, nlx - rx * .2 - 4, cy + ry * .4 + 4, '核仁 (合成rRNA)', '#a78bfa');

        ctx.strokeStyle = 'rgba(196,121,58,0.35)'; ctx.lineWidth = 2;
        for (let i = 0; i < 6; i++) {
            ctx.beginPath();
            const sx = cx - rx * .5 + i * rx * .18, sy = cy - ry * .5 + i * ry * .08;
            ctx.moveTo(sx, sy);
            for (let t = 0; t < 8; t++) {
                ctx.quadraticCurveTo(sx + (t % 2 ? 10 : -10), sy + t * ry * .1, sx + (t % 2 ? 5 : -5), sy + (t + .5) * ry * .1);
            }
            ctx.stroke();
        }
        this._arrow(ctx, cx - rx * .5, cy + ry * .3, cx - rx - 20, cy + ry * .5, '#c4793a');
        this._label(ctx, cx - rx - 22, cy + ry * .5 + 4, '染色质 (DNA+组蛋白)', '#c4793a', 'right');
        this._arrow(ctx, cx - rx - 4, cy - ry * .5, cx - rx - 30, cy - ry * .7, org.border);
        this._label(ctx, cx - rx - 32, cy - ry * .7, '双层核膜', org.border, 'right');
    },

    /* ── 线粒体 detail ── */
    _detMito(ctx, cx, cy, w, h, org) {
        const rx = w * .44, ry = h * .36;
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(196,121,58,0.06)'; ctx.fill();
        ctx.strokeStyle = '#c4793a'; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.beginPath(); ctx.ellipse(cx, cy, rx - 8, ry - 8, 0, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(196,121,58,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();

        ctx.strokeStyle = 'rgba(196,121,58,0.5)'; ctx.lineWidth = 2;
        ctx.fillStyle = 'rgba(196,121,58,0.08)';
        for (let i = 0; i < 5; i++) {
            const f = (i + .5) / 5;
            const baseX = cx - rx * .7 + f * rx * 1.4;
            const side = i % 2 === 0 ? -1 : 1;
            const baseY = cy + side * (ry - 8);
            const tipY = cy + side * ry * .05;
            const cw = rx * .06;
            ctx.beginPath();
            ctx.moveTo(baseX - cw, baseY);
            ctx.quadraticCurveTo(baseX - cw - 2, tipY, baseX, tipY - side * 4);
            ctx.quadraticCurveTo(baseX + cw + 2, tipY, baseX + cw, baseY);
            ctx.fill(); ctx.stroke();
        }

        this._arrow(ctx, cx + rx - 3, cy - ry + 12, cx + rx + 20, cy - ry - 10, 'rgba(196,121,58,0.6)');
        this._label(ctx, cx + rx + 22, cy - ry - 14, '膜间腔');
        this._label(ctx, cx, cy + ry * .15, '基质 (Matrix)', 'rgba(196,121,58,0.5)', 'center');

        ctx.beginPath(); ctx.ellipse(cx - rx * .22, cy + ry * .25, 8, 5, 0.3, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,200,100,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
        this._arrow(ctx, cx - rx * .22 + 10, cy + ry * .25, cx - rx * .22 + 35, cy + ry * .45, 'rgba(255,200,100,0.5)');
        this._label(ctx, cx - rx * .22 + 37, cy + ry * .45, '环状DNA', 'rgba(255,200,100,0.6)');

        for (let i = 0; i < 4; i++) {
            ctx.beginPath(); ctx.arc(cx + rx * (.1 + i * .12), cy - ry * .2, 2, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fill();
        }

        this._arrow(ctx, cx - rx - 2, cy, cx - rx - 25, cy - ry * .4, org.border);
        this._label(ctx, cx - rx - 27, cy - ry * .4, '外膜', org.border, 'right');
        this._arrow(ctx, cx - rx + 10, cy + ry * .15, cx - rx - 25, cy + ry * .3, 'rgba(196,121,58,0.6)');
        this._label(ctx, cx - rx - 27, cy + ry * .3, '内膜(嵴)', 'rgba(196,121,58,0.6)', 'right');
    },

    /* ── 内质网 detail ── */
    _detER(ctx, cx, cy, w, h, org) {
        const left = cx - w * .42, mid = cx;
        this._label(ctx, left + w * .15, cy - h * .38, '粗面内质网 (Rough ER)', '#4d9e7e', 'center');
        for (let i = 0; i < 5; i++) {
            const y = cy - h * .25 + i * h * .12;
            const sw = w * .32;
            ctx.strokeStyle = 'rgba(77,158,126,0.4)'; ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + sw, y); ctx.stroke();
            if (i < 4) {
                ctx.fillStyle = 'rgba(77,158,126,0.04)';
                ctx.fillRect(left, y + 1, sw, h * .12 - 2);
            }
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            for (let j = 0; j < 8; j++) {
                ctx.beginPath(); ctx.arc(left + 12 + j * sw / 9, y - 3, 2, 0, Math.PI * 2); ctx.fill();
            }
        }

        const right = cx + w * .42;
        this._label(ctx, right - w * .15, cy - h * .38, '光面内质网 (Smooth ER)', 'rgba(77,158,126,0.7)', 'center');
        ctx.strokeStyle = 'rgba(77,158,126,0.35)'; ctx.lineWidth = 2.5;
        for (let i = 0; i < 6; i++) {
            ctx.beginPath();
            const y0 = cy - h * .22 + i * h * .1;
            for (let t = 0; t <= 15; t++) {
                const x = mid + w * .05 + (t / 15) * w * .35;
                const y = y0 + Math.sin(t * .8 + i) * h * .03;
                t === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        const vx = left + w * .35, vy = cy - h * .1;
        ctx.beginPath(); ctx.arc(vx, vy, 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(77,158,126,0.15)'; ctx.fill();
        ctx.strokeStyle = 'rgba(77,158,126,0.4)'; ctx.lineWidth = 1.5; ctx.stroke();
        this._arrow(ctx, vx + 10, vy, vx + 30, vy - 10, 'rgba(77,158,126,0.4)');
        this._label(ctx, vx + 32, vy - 14, '转运囊泡→高尔基体');

        this._arrow(ctx, left + 12, cy - h * .25 - 5, left - 10, cy - h * .32, 'rgba(255,255,255,0.3)');
        this._label(ctx, left - 12, cy - h * .32, '核糖体', 'rgba(255,255,255,0.5)', 'right');
    },

    /* ── 高尔基体 detail ── */
    _detGolgi(ctx, cx, cy, w, h, org) {
        const layers = 5, layerH = h * .08, maxW = w * .5;
        this._label(ctx, cx - maxW / 2 - 20, cy - layers * layerH, 'cis 面 (接收)', 'rgba(184,84,80,0.7)', 'right');
        this._label(ctx, cx - maxW / 2 - 20, cy + layers * layerH, 'trans 面 (分泌)', 'rgba(184,84,80,0.7)', 'right');

        for (let i = 0; i < layers; i++) {
            const f = (i - (layers - 1) / 2) / layers;
            const yOff = f * layers * layerH;
            const lw = maxW * (1 - Math.abs(f) * .4);
            ctx.beginPath();
            ctx.moveTo(cx - lw / 2, cy + yOff - layerH * .3);
            ctx.quadraticCurveTo(cx, cy + yOff - layerH * .6, cx + lw / 2, cy + yOff - layerH * .3);
            ctx.lineTo(cx + lw / 2, cy + yOff + layerH * .3);
            ctx.quadraticCurveTo(cx, cy + yOff + layerH * .6, cx - lw / 2, cy + yOff + layerH * .3);
            ctx.closePath();
            ctx.fillStyle = `rgba(184,84,80,${0.08 + i * 0.03})`; ctx.fill();
            ctx.strokeStyle = 'rgba(184,84,80,0.45)'; ctx.lineWidth = 1.5; ctx.stroke();
        }

        const vy1 = cy - layers * layerH - 20;
        for (let i = 0; i < 3; i++) {
            const vx = cx - 30 + i * 30;
            ctx.beginPath(); ctx.arc(vx, vy1, 7, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(77,158,126,0.15)'; ctx.fill();
            ctx.strokeStyle = 'rgba(77,158,126,0.35)'; ctx.lineWidth = 1; ctx.stroke();
            ctx.beginPath(); ctx.moveTo(vx, vy1 + 9); ctx.lineTo(vx, vy1 + 16);
            ctx.strokeStyle = 'rgba(77,158,126,0.3)'; ctx.stroke();
        }
        this._label(ctx, cx, vy1 - 12, '来自内质网的转运囊泡', 'rgba(77,158,126,0.6)', 'center');

        const vy2 = cy + layers * layerH + 20;
        for (let i = 0; i < 4; i++) {
            const vx = cx - 40 + i * 28;
            ctx.beginPath(); ctx.arc(vx, vy2, 6 + i * .8, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(184,84,80,0.15)'; ctx.fill();
            ctx.strokeStyle = 'rgba(184,84,80,0.4)'; ctx.lineWidth = 1; ctx.stroke();
        }
        this._label(ctx, cx, vy2 + 18, '分泌囊泡 → 细胞膜/溶酶体', 'rgba(184,84,80,0.6)', 'center');
    },

    /* ── 叶绿体 detail ── */
    _detChloroplast(ctx, cx, cy, w, h, org) {
        const rx = w * .44, ry = h * .38;
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(58,158,143,0.05)'; ctx.fill();
        ctx.strokeStyle = '#3a9e8f'; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.beginPath(); ctx.ellipse(cx, cy, rx - 6, ry - 6, 0, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(58,158,143,0.4)'; ctx.lineWidth = 1.5; ctx.stroke();

        const granaPos = [-.35, 0, .35];
        for (const gx of granaPos) {
            const gcx = cx + gx * rx;
            const dw = rx * .12, dh2 = 5, discs = 4;
            for (let d = 0; d < discs; d++) {
                const dy = cy - (discs / 2) * (dh2 + 2) + d * (dh2 + 2);
                ctx.beginPath(); ctx.ellipse(gcx, dy, dw, dh2, 0, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(58,158,143,0.25)'; ctx.fill();
                ctx.strokeStyle = 'rgba(58,158,143,0.5)'; ctx.lineWidth = 1; ctx.stroke();
            }
        }

        ctx.strokeStyle = 'rgba(58,158,143,0.25)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cx - .35 * rx + rx * .12, cy); ctx.lineTo(cx - rx * .12, cy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + rx * .12, cy); ctx.lineTo(cx + .35 * rx - rx * .12, cy); ctx.stroke();

        this._arrow(ctx, cx - .35 * rx, cy + 20, cx - .35 * rx - 20, cy + 40, org.border);
        this._label(ctx, cx - .35 * rx - 22, cy + 44, '基粒(Granum)', org.border, 'right');
        this._label(ctx, cx + rx * .2, cy + ry * .55, '基质 (Stroma)', 'rgba(58,158,143,0.5)', 'center');

        ctx.beginPath(); ctx.ellipse(cx + rx * .25, cy + ry * .35, 7, 4, 0.5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,200,100,0.45)'; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.beginPath(); ctx.ellipse(cx - rx * .15, cy + ry * .4, 6, 8, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1; ctx.stroke();
        this._arrow(ctx, cx - rx * .15, cy + ry * .4 + 10, cx - rx * .15, cy + ry * .65, 'rgba(255,255,255,0.2)');
        this._label(ctx, cx - rx * .15, cy + ry * .7, '淀粉粒', 'rgba(255,255,255,0.4)', 'center');
        this._arrow(ctx, cx + rx + 2, cy - ry * .3, cx + rx + 25, cy - ry * .5, org.border);
        this._label(ctx, cx + rx + 27, cy - ry * .5, '双层膜', org.border);
    },

    /* ── 液泡 detail ── */
    _detVacuole(ctx, cx, cy, w, h, org) {
        const rx = w * .4, ry = h * .4;
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(91,141,206,0.05)'; ctx.fill();
        ctx.strokeStyle = 'rgba(91,141,206,0.6)'; ctx.lineWidth = 2.5; ctx.stroke();
        this._arrow(ctx, cx + rx + 3, cy, cx + rx + 30, cy - 15, 'rgba(91,141,206,0.5)');
        this._label(ctx, cx + rx + 32, cy - 19, '液泡膜 (Tonoplast)', 'rgba(91,141,206,0.7)');
        this._label(ctx, cx, cy - ry * .6, '细胞液', 'rgba(91,141,206,0.5)', 'center');

        const particles = [
            { x: -.2, y: -.15, label: '糖', color: '#dca03c' },
            { x: .25, y: .1, label: '有机酸', color: '#b85450' },
            { x: -.1, y: .25, label: '花青素', color: '#8b6fc0' },
            { x: .15, y: -.25, label: 'K⁺', color: '#4fa8a3' },
            { x: -.3, y: .1, label: 'H₂O', color: '#5b8dce' },
        ];
        for (const p of particles) {
            const px = cx + p.x * rx, py = cy + p.y * ry;
            ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2);
            ctx.fillStyle = p.color + '55'; ctx.fill();
            ctx.strokeStyle = p.color; ctx.lineWidth = 1; ctx.stroke();
            ctx.fillStyle = p.color;
            ctx.font = '500 ' + Math.max(13, this.W * 0.024) + 'px ' + CF.sans; ctx.textAlign = 'center';
            ctx.fillText(p.label, px, py + 14);
        }

        ctx.fillStyle = 'rgba(91,141,206,0.15)';
        for (let i = 0; i < 15; i++) {
            const a = ((7 * (i + 1) * 3571) % 10000) / 10000 * Math.PI * 2;
            const d = ((7 * (i + 1) * 7919) % 10000) / 10000 * .7 + .05;
            ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rx * d, cy + Math.sin(a) * ry * d, 1.5, 0, Math.PI * 2); ctx.fill();
        }
    },

    /* ── 细胞壁 detail ── */
    _detWall(ctx, cx, cy, w, h, org) {
        const totalW = w * .7, left = cx - totalW / 2;
        const layerLabels = [
            { name: '中层 (Middle Lamella)', w: .12, color: 'rgba(120,90,60,0.3)', border: 'rgba(120,90,60,0.5)' },
            { name: '初生壁 (Primary Wall)', w: .25, color: 'rgba(77,158,126,0.15)', border: 'rgba(77,158,126,0.5)' },
            { name: '次生壁 (Secondary Wall)', w: .3, color: 'rgba(77,158,126,0.08)', border: 'rgba(77,158,126,0.35)' },
            { name: '细胞膜', w: .05, color: 'rgba(91,141,206,0.15)', border: 'rgba(91,141,206,0.5)' },
        ];
        let xOff = 0;
        for (const layer of layerLabels) {
            const lw = totalW * layer.w, lx = left + xOff;
            ctx.fillStyle = layer.color; ctx.fillRect(lx, cy - h * .35, lw, h * .7);
            ctx.strokeStyle = layer.border; ctx.lineWidth = 1.5; ctx.strokeRect(lx, cy - h * .35, lw, h * .7);
            if (layer.name.includes('壁')) {
                ctx.save();
                ctx.beginPath(); ctx.rect(lx, cy - h * .35, lw, h * .7); ctx.clip();
                ctx.strokeStyle = layer.border; ctx.lineWidth = .6;
                for (let i = -10; i < 20; i++) {
                    ctx.beginPath(); ctx.moveTo(lx + i * 8, cy - h * .35); ctx.lineTo(lx + i * 8 + h * .3, cy + h * .35); ctx.stroke();
                }
                ctx.restore();
            }
            ctx.fillStyle = layer.border;
            ctx.font = '500 ' + Math.max(13, this.W * 0.024) + 'px ' + CF.sans; ctx.textAlign = 'center';
            ctx.fillText(layer.name, lx + lw / 2, cy + h * .4 + 14);
            xOff += lw;
        }

        const pdX = left + totalW * .35;
        ctx.fillStyle = 'rgba(91,141,206,0.2)'; ctx.fillRect(pdX - 3, cy - h * .35, 6, h * .7);
        ctx.strokeStyle = 'rgba(91,141,206,0.4)'; ctx.lineWidth = 1; ctx.strokeRect(pdX - 3, cy - h * .35, 6, h * .7);
        this._arrow(ctx, pdX, cy - h * .35 - 3, pdX + 30, cy - h * .35 - 18, 'rgba(91,141,206,0.5)');
        this._label(ctx, pdX + 32, cy - h * .35 - 22, '胞间连丝', 'rgba(91,141,206,0.6)');
    },

    /* ── generic fallback ── */
    _detGeneric(ctx, cx, cy, w, h, org) {
        const rx = w * .3, ry = h * .3;
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = org.color; ctx.fill();
        ctx.strokeStyle = org.border; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = 'bold ' + Math.max(13, this.W * 0.024 + 11) + 'px ' + CF.sans; ctx.textAlign = 'center';
        ctx.fillText(org.name, cx, cy);
        ctx.font = Math.max(13, this.W * 0.024 + 5) + 'px ' + CF.sans;
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        const desc = org.desc.length > 40 ? org.desc.slice(0, 40) + '…' : org.desc;
        ctx.fillText(desc, cx, cy + 22);
    },
    _injectInfoPanel() {
        const el = document.getElementById('cellstr-info');
        if (!el) return;
        el.innerHTML = `
            <div class="cellstr-info__hd">\ud83d\udd2c \u7ec6\u80de\u7ed3\u6784\u77e5\u8bc6\u70b9</div>
            <div class="cellstr-info__grid">
                <div class="cellstr-info__block">
                    <div class="cellstr-info__sub">\u5f53\u524d\u7c7b\u578b</div>
                    <div class="cellstr-info__val" id="cellstr-type">\u52a8\u7269\u7ec6\u80de</div>
                    <div class="cellstr-info__desc" id="cellstr-type-desc">\u6709\u4e2d\u5fc3\u4f53\uff0c\u65e0\u7ec6\u80de\u58c1\u3001\u53f6\u7eff\u4f53\u548c\u5927\u6db2\u6ce1</div>
                </div>
                <div class="cellstr-info__block">
                    <div class="cellstr-info__sub">\u5e38\u89c1/\u7279\u5f81\u7ed3\u6784</div>
                    <div class="cellstr-info__val" id="cellstr-unique">\u4e2d\u5fc3\u4f53</div>
                    <div class="cellstr-info__desc" id="cellstr-unique-desc">\u4e0e\u7ec6\u80de\u5206\u88c2\u6709\u5173\uff0c\u53d1\u51fa\u7eba\u9524\u4e1d</div>
                </div>
            </div>
            <div class="cellstr-info__row">\u5171\u6709\u7ed3\u6784 \u2014 \u7ec6\u80de\u819c\u3001\u7ebf\u7c92\u4f53\u3001\u6838\u7cd6\u4f53\u3001\u5185\u8d28\u7f51\u3001\u9ad8\u5c14\u57fa\u4f53\u3001\u6eb6\u9176\u4f53\u3001\u7ec6\u80de\u6838</div>
            <div class="cellstr-info__note">\u4eba\u6559\u7248\u5fc5\u4fee1 \u2014 \u7ec6\u80de\u662f\u751f\u547d\u6d3b\u52a8\u7684\u57fa\u672c\u7ed3\u6784\u548c\u529f\u80fd\u5355\u4f4d\uff0c\u70b9\u51fb\u7ec6\u80de\u5668\u53ef\u653e\u5927\u67e5\u770b\u8be6\u60c5</div>
        `;
    },

    _updateInfo() {
        const typeEl = document.getElementById('cellstr-type');
        const descEl = document.getElementById('cellstr-type-desc');
        const uniqEl = document.getElementById('cellstr-unique');
        const uniqDescEl = document.getElementById('cellstr-unique-desc');
        if (!typeEl) return;
        if (this.isPlant) {
            typeEl.textContent = '\u690d\u7269\u7ec6\u80de';
            descEl.textContent = '\u690d\u7269\u7ec6\u80de\u5e38\u6709\u7ec6\u80de\u58c1\u548c\u5927\u6db2\u6ce1\uff0c\u7eff\u8272\u7ec4\u7ec7\u7ec6\u80de\u5e38\u542b\u53f6\u7eff\u4f53';
            uniqEl.textContent = '\u7ec6\u80de\u58c1\u3001\u53f6\u7eff\u4f53(\u7eff\u8272\u7ec4\u7ec7)\u3001\u5927\u6db2\u6ce1';
            uniqDescEl.textContent = '\u7ec6\u80de\u58c1\u63d0\u4f9b\u652f\u6301\uff1b\u7eff\u8272\u7ec4\u7ec7\u4e2d\u7684\u53f6\u7eff\u4f53\u8fdb\u884c\u5149\u5408\u4f5c\u7528\uff1b\u5927\u6db2\u6ce1\u7ef4\u6301\u6e17\u900f\u538b';
        } else {
            typeEl.textContent = '\u52a8\u7269\u7ec6\u80de';
            descEl.textContent = '\u5178\u578b\u52a8\u7269\u7ec6\u80de\u5e38\u6709\u4e2d\u5fc3\u4f53\uff0c\u65e0\u7ec6\u80de\u58c1\u3001\u53f6\u7eff\u4f53\u548c\u5927\u6db2\u6ce1';
            uniqEl.textContent = '\u4e2d\u5fc3\u4f53';
            uniqDescEl.textContent = '\u4e0e\u7ec6\u80de\u5206\u88c2\u6709\u5173\uff0c\u53d1\u51fa\u7eba\u9524\u4e1d';
        }
    }
};

function initCellStructure() {
    CellStructure.init();
}

window.CellStructure = CellStructure;
window.initCellStructure = initCellStructure;
