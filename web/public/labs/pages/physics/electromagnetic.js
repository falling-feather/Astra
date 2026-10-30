// ===== 电磁场可视化引擎 (v2) =====
// 3 显示模式 + 等势线 + 电势热图 + 测量探针 + 预设配置

const EMField = {
    canvas: null, ctx: null, W: 0, H: 0,
    charges: [],
    _animId: null,
    paused: false,

    // 粒子轨迹模式
    particles: [],     // [{x, y, vx, vy, trail:[{x,y}], color}]
    particleSign: +1,  // 测试粒子电荷符号
    _lastTime: 0,

    // 磁场模式
    currents: [],      // [{x, y, I}]  I>0 出屏(·) I<0 入屏(×)
    magneticNeedleStep: 36,
    _magDragIndex: -1,
    _magDragOffX: 0,
    _magDragOffY: 0,
    _magProbePos: null,

    // 拖拽状态
    dragIndex: -1,
    dragOffsetX: 0,
    dragOffsetY: 0,

    // 显示模式: 'lines' | 'equipotential' | 'heatmap'
    displayMode: 'lines',

    // 场线选项
    showFieldLines: true,
    showVectorField: false,
    fieldLineCount: 16,
    vectorGridStep: 32,
    arrowScale: 22,

    // 等势线选项
    contourCount: 12,

    // 热图缓存
    _heatDirty: true,
    _heatCanvas: null,

    // 探针
    probePos: null,  // {x, y} or null

    // 物理常数
    k: 800,

    COLOR_POS: '#ef4444',
    COLOR_NEG: '#3b82f6',

    _ro: null,

    // ═══════════════════════════════════════════
    // 初始化
    // ═══════════════════════════════════════════
    init() {
        this.canvas = document.getElementById('em-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.resizeCanvas();
        this.bindControls();
        this.bindCanvas();
        this._injectModeButtons();
        this._injectPresets();
        this._injectProbeToggle();
        this._injectParticlePanel();
        this._injectMagneticPanel();
        this._injectGlobalActions();

        this._ro = new ResizeObserver(() => {
            this.resizeCanvas();
            this._heatDirty = true;
            this.render();
        });
        this._ro.observe(this.canvas.parentElement);
    },

    destroy() {
        if (this._ro) {
            this._ro.disconnect();
            this._ro = null;
        }
        if (this._animId) {
            cancelAnimationFrame(this._animId);
            this._animId = null;
        }
    },

    resizeCanvas() {
        if (!this.canvas) return;
        if (window.PhysicsZoom && window.PhysicsZoom.movedCanvas === this.canvas) return;
        const container = this.canvas.parentElement;
        const rect = container.getBoundingClientRect();
        if (rect.width < 1) return;
        const h = Math.min(Math.max(rect.width * 0.56, 340), 560);
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = rect.width;
        this.H = h;
        this._heatDirty = true;
    },

    _injectGlobalActions() {
        const ctrl = document.querySelector('.em-controls');
        if (!ctrl || document.getElementById('em-global-actions')) return;
        const row = document.createElement('div');
        row.id = 'em-global-actions';
        row.className = 'physics-actions';
        row.innerHTML = `
            <button id="em-pause" class="btn btn--ghost">暂停</button>
            <button id="em-reset" class="btn btn--ghost">重置</button>
        `;
        ctrl.appendChild(row);

        const pauseBtn = document.getElementById('em-pause');
        const resetBtn = document.getElementById('em-reset');
        if (pauseBtn) pauseBtn.addEventListener('click', () => this.togglePause());
        if (resetBtn) resetBtn.addEventListener('click', () => this.resetScene());
    },

    togglePause() {
        this.paused = !this.paused;
        const btn = document.getElementById('em-pause');
        if (btn) btn.textContent = this.paused ? '继续' : '暂停';
    },

    resetScene() {
        this.paused = false;
        const btn = document.getElementById('em-pause');
        if (btn) btn.textContent = '暂停';
        this.probePos = null;
        this.particles = [];
        this.dragIndex = -1;
        this._magDragIndex = -1;
        if (this.displayMode === 'magnetic') {
            this.currents = [];
            this._magProbePos = null;
        } else {
            this.loadPreset('dipole');
        }
        this.render();
    },

    // ═══════════════════════════════════════════
    // 动态注入：模式按钮
    // ═══════════════════════════════════════════
    _injectModeButtons() {
        const header = this.canvas.closest('.demo-section')?.querySelector('.section-header');
        if (!header || document.getElementById('em-mode-btns')) return;
        const div = document.createElement('div');
        div.id = 'em-mode-btns';
        div.style.cssText = 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;';
        div.innerHTML = [['lines','电力线'],['equipotential','等势线'],['heatmap','电势图'],['particle','粒子轨迹'],['magnetic','磁场']]
            .map(([m,t]) => `<button class="em-mode-btn${m==='lines'?' active':''}" data-mode="${m}">${t}</button>`)
            .join('');
        header.appendChild(div);
        div.querySelectorAll('.em-mode-btn').forEach(btn =>
            btn.addEventListener('click', () => this.setDisplayMode(btn.dataset.mode))
        );
    },

    // ═══════════════════════════════════════════
    // 动态注入：预设配置
    // ═══════════════════════════════════════════
    _injectPresets() {
        const ctrl = document.querySelector('.em-controls');
        if (!ctrl || document.getElementById('em-presets')) return;
        const div = document.createElement('div');
        div.id = 'em-presets';
        div.className = 'em-presets';
        div.innerHTML = `<label style="font-size:0.82rem;color:rgba(255,255,255,0.5);margin-bottom:4px">预设配置</label>
            <div class="em-preset-btns">
                <button class="em-preset-btn" data-preset="dipole">偶极子</button>
                <button class="em-preset-btn" data-preset="quadrupole">四极子</button>
                <button class="em-preset-btn" data-preset="capacitor">平行板</button>
                <button class="em-preset-btn" data-preset="triangle">三角形</button>
            </div>`;
        ctrl.appendChild(div);
        div.querySelectorAll('.em-preset-btn').forEach(btn =>
            btn.addEventListener('click', () => this.loadPreset(btn.dataset.preset))
        );
    },

    // ═══════════════════════════════════════════
    // 动态注入：探针开关
    // ═══════════════════════════════════════════
    _injectProbeToggle() {
        const toggleGroup = document.querySelector('.em-toggle-group');
        if (!toggleGroup || document.getElementById('em-toggle-probe')) return;
        const label = document.createElement('label');
        label.className = 'em-toggle';
        label.innerHTML = '<input type="checkbox" id="em-toggle-probe"><span>测量探针</span>';
        toggleGroup.appendChild(label);
        label.querySelector('input').addEventListener('change', e => {
            if (!e.target.checked) this.probePos = null;
            this.render();
        });
    },

    // ═══════════════════════════════════════════
    // 模式切换
    // ═══════════════════════════════════════════
    setDisplayMode(mode) {
        this.displayMode = mode;
        document.querySelectorAll('.em-mode-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.mode === mode));
        if (mode === 'heatmap') this._heatDirty = true;

        // 粒子面板
        const pPanel = document.getElementById('em-particle-panel');
        if (pPanel) pPanel.style.display = mode === 'particle' ? '' : 'none';

        // 磁场面板
        const mPanel = document.getElementById('em-magnetic-panel');
        if (mPanel) mPanel.style.display = mode === 'magnetic' ? '' : 'none';

        // 粒子模式启动/停止动画
        if (mode === 'particle') {
            this._startParticleLoop();
        } else {
            if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
            this.render();
        }
    },

    // ═══════════════════════════════════════════
    // 预设加载
    // ═══════════════════════════════════════════
    loadPreset(name) {
        const cx = this.W / 2, cy = this.H / 2;
        const d = Math.min(this.W, this.H) * 0.25;
        switch (name) {
            case 'dipole':
                this.charges = [
                    { x: cx - d, y: cy, q: 1 },
                    { x: cx + d, y: cy, q: -1 }
                ]; break;
            case 'quadrupole':
                this.charges = [
                    { x: cx - d, y: cy - d, q: 1 },
                    { x: cx + d, y: cy - d, q: -1 },
                    { x: cx - d, y: cy + d, q: -1 },
                    { x: cx + d, y: cy + d, q: 1 }
                ]; break;
            case 'capacitor':
                this.charges = [];
                for (let i = 0; i < 5; i++) {
                    const y = cy - d + i * d / 2;
                    this.charges.push({ x: cx - d, y, q: 1 });
                    this.charges.push({ x: cx + d, y, q: -1 });
                } break;
            case 'triangle':
                this.charges = [
                    { x: cx, y: cy - d, q: 1 },
                    { x: cx - d * 0.87, y: cy + d * 0.5, q: 1 },
                    { x: cx + d * 0.87, y: cy + d * 0.5, q: -1 }
                ]; break;
        }
        this.updateStats();
        this._heatDirty = true;
        this.render();
    },

    // ═══════════════════════════════════════════
    // 控件绑定
    // ═══════════════════════════════════════════
    bindControls() {
        const addPos = document.getElementById('em-add-pos');
        const addNeg = document.getElementById('em-add-neg');
        const clearBtn = document.getElementById('em-clear');
        const toggleLines = document.getElementById('em-toggle-lines');
        const toggleVectors = document.getElementById('em-toggle-vectors');
        const lineCountSlider = document.getElementById('em-line-count');

        if (addPos) addPos.addEventListener('click', () => this.addCharge(+1));
        if (addNeg) addNeg.addEventListener('click', () => this.addCharge(-1));
        if (clearBtn) clearBtn.addEventListener('click', () => {
            this.charges = [];
            this.updateStats();
            this._heatDirty = true;
            this.render();
        });
        if (toggleLines) toggleLines.addEventListener('change', e => {
            this.showFieldLines = e.target.checked;
            this.render();
        });
        if (toggleVectors) toggleVectors.addEventListener('change', e => {
            this.showVectorField = e.target.checked;
            this.render();
        });
        if (lineCountSlider) lineCountSlider.addEventListener('input', e => {
            this.fieldLineCount = parseInt(e.target.value);
            const lbl = document.getElementById('em-line-count-value');
            if (lbl) lbl.textContent = this.fieldLineCount;
            this.render();
        });
    },

    // ═══════════════════════════════════════════
    // Canvas 交互
    // ═══════════════════════════════════════════
    bindCanvas() {
        const getPos = e => {
            const rect = this.canvas.getBoundingClientRect();
            if (e.touches) return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
            return { x: e.clientX - rect.left, y: e.clientY - rect.top };
        };

        const onDown = e => {
            e.preventDefault();
            const pos = getPos(e);
            // 粒子模式：点击释放测试粒子
            if (this.displayMode === 'particle') {
                this._launchParticle(pos.x, pos.y);
                return;
            }
            // 磁场模式：拖拽已有导线 或 放置新导线
            if (this.displayMode === 'magnetic') {
                // 先检查是否点中已有导线
                for (let i = this.currents.length - 1; i >= 0; i--) {
                    const c = this.currents[i];
                    if ((pos.x - c.x) ** 2 + (pos.y - c.y) ** 2 < 400) {
                        this._magDragIndex = i;
                        this._magDragOffX = pos.x - c.x;
                        this._magDragOffY = pos.y - c.y;
                        this.canvas.style.cursor = 'grabbing';
                        return;
                    }
                }
                // 未点中 → 放置新导线
                if (this.currents.length < 20) {
                    this.currents.push({ x: pos.x, y: pos.y, I: this._magCurrentSign || 1 });
                    this.render();
                }
                return;
            }
            for (let i = this.charges.length - 1; i >= 0; i--) {
                const c = this.charges[i];
                if ((pos.x-c.x)**2 + (pos.y-c.y)**2 < 400) {
                    this.dragIndex = i;
                    this.dragOffsetX = pos.x - c.x;
                    this.dragOffsetY = pos.y - c.y;
                    this.canvas.style.cursor = 'grabbing';
                    return;
                }
            }
        };
        const onMove = e => {
            const pos = getPos(e);
            // 探针
            const probeEl = document.getElementById('em-toggle-probe');
            if (probeEl && probeEl.checked && this.dragIndex < 0) {
                this.probePos = pos;
                this.render();
            }
            // 磁场导线拖拽
            if (this._magDragIndex >= 0) {
                e.preventDefault();
                this.currents[this._magDragIndex].x = pos.x - this._magDragOffX;
                this.currents[this._magDragIndex].y = pos.y - this._magDragOffY;
                this._magProbePos = pos;
                this.render();
                return;
            }
            // 磁场探针跟踪
            if (this.displayMode === 'magnetic' && this.currents.length > 0) {
                this._magProbePos = pos;
                this.render();
                return;
            }
            if (this.dragIndex < 0) return;
            e.preventDefault();
            this.charges[this.dragIndex].x = pos.x - this.dragOffsetX;
            this.charges[this.dragIndex].y = pos.y - this.dragOffsetY;
            this._heatDirty = true;
            this.render();
        };
        const onUp = () => {
            this.dragIndex = -1;
            this._magDragIndex = -1;
            this.canvas.style.cursor = 'default';
        };

        this.canvas.addEventListener('mousedown', onDown);
        this.canvas.addEventListener('mousemove', onMove);
        this.canvas.addEventListener('mouseup', onUp);
        this.canvas.addEventListener('mouseleave', e => {
            onUp();
            if (this.probePos) { this.probePos = null; this.render(); }
            if (this._magProbePos) { this._magProbePos = null; this.render(); }
        });
        this.canvas.addEventListener('touchstart', onDown, { passive: false });
        this.canvas.addEventListener('touchmove', onMove, { passive: false });
        this.canvas.addEventListener('touchend', onUp);

        // 双击删除电荷/电流
        this.canvas.addEventListener('dblclick', e => {
            const pos = getPos(e);
            if (this.displayMode === 'magnetic') {
                for (let i = this.currents.length - 1; i >= 0; i--) {
                    if ((pos.x-this.currents[i].x)**2 + (pos.y-this.currents[i].y)**2 < 400) {
                        this.currents.splice(i, 1);
                        this.render();
                        return;
                    }
                }
                return;
            }
            for (let i = this.charges.length - 1; i >= 0; i--) {
                if ((pos.x-this.charges[i].x)**2 + (pos.y-this.charges[i].y)**2 < 400) {
                    this.charges.splice(i, 1);
                    this.updateStats();
                    this._heatDirty = true;
                    this.render();
                    return;
                }
            }
        });
    },

    // ═══════════════════════════════════════════
    // 电荷管理
    // ═══════════════════════════════════════════
    addCharge(sign) {
        if (this.charges.length >= 20) return;
        const margin = 60;
        const x = margin + Math.random() * (this.W - 2 * margin);
        const y = margin + Math.random() * (this.H - 2 * margin);
        this.charges.push({ x, y, q: sign });
        this.updateStats();
        this._heatDirty = true;
        this.render();
    },

    updateStats() {
        const el = document.getElementById('em-charge-count');
        if (el) el.textContent = this.charges.length;
    },

    // ═══════════════════════════════════════════
    // 物理计算
    // ═══════════════════════════════════════════
    fieldAt(px, py) {
        let ex = 0, ey = 0;
        for (const c of this.charges) {
            const dx = px - c.x, dy = py - c.y;
            const r2 = dx * dx + dy * dy;
            if (r2 < 100) continue;
            const r = Math.sqrt(r2);
            const E = this.k * c.q / r2;
            ex += E * dx / r;
            ey += E * dy / r;
        }
        return { x: ex, y: ey };
    },

    potentialAt(px, py) {
        let V = 0;
        for (const c of this.charges) {
            const dx = px - c.x, dy = py - c.y;
            const r = Math.max(Math.sqrt(dx * dx + dy * dy), 10);
            V += this.k * c.q / r;
        }
        return V;
    },

    // ═══════════════════════════════════════════
    // 主渲染
    // ═══════════════════════════════════════════
    render() {
        const ctx = this.ctx;
        if (!ctx || !this.W) return;
        ctx.clearRect(0, 0, this.W, this.H);
        this.drawGrid();

        if (this.charges.length === 0) {
            this.drawEmptyHint();
            return;
        }

        switch (this.displayMode) {
            case 'lines':
                if (this.showFieldLines) this.drawFieldLines();
                if (this.showVectorField) this.drawVectorField();
                break;
            case 'equipotential':
                this.drawEquipotentialLines();
                break;
            case 'heatmap':
                this.drawHeatmap();
                break;
            case 'particle':
                ctx.globalAlpha = 0.15;
                this.drawFieldLines();
                ctx.globalAlpha = 1;
                this.drawParticles();
                break;
            case 'magnetic':
                this.drawMagneticField();
                break;
        }

        if (this.displayMode !== 'magnetic') {
            this.drawCharges();
            if (this.probePos) this.drawProbe();
        }
    },

    // ═══════════════════════════════════════════
    // 背景 / 空提示
    // ═══════════════════════════════════════════
    drawGrid() {
        const ctx = this.ctx;
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.lineWidth = 0.5;
        for (let x = 40; x < this.W; x += 40) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.H); ctx.stroke();
        }
        for (let y = 40; y < this.H; y += 40) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.W, y); ctx.stroke();
        }
    },

    drawEmptyHint() {
        const ctx = this.ctx;
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.font = '500 20px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('添加电荷或选择预设以查看电场分布', this.W / 2, this.H / 2);
        ctx.font = '17px ' + CF.sans;
        ctx.fillText('双击电荷可删除', this.W / 2, this.H / 2 + 24);
        ctx.textAlign = 'left';
    },

    // ═══════════════════════════════════════════
    // 电场线绘制（增强）
    // ═══════════════════════════════════════════
    drawFieldLines() {
        const ctx = this.ctx;
        const positives = this.charges.filter(c => c.q > 0);
        const negatives = this.charges.filter(c => c.q < 0);
        const sources = positives.length > 0 ? positives : negatives;

        for (const src of sources) {
            for (let i = 0; i < this.fieldLineCount; i++) {
                const angle = (2 * Math.PI * i) / this.fieldLineCount;
                let x = src.x + 14 * Math.cos(angle);
                let y = src.y + 14 * Math.sin(angle);
                ctx.beginPath(); ctx.moveTo(x, y);
                const dir = src.q > 0 ? 1 : -1;

                for (let s = 0; s < 600; s++) {
                    const E = this.fieldAt(x, y);
                    const mag = Math.sqrt(E.x*E.x + E.y*E.y);
                    if (mag < 0.5) break;
                    const nx = x + dir * 3 * E.x / mag;
                    const ny = y + dir * 3 * E.y / mag;

                    let hit = false;
                    for (const c of this.charges) {
                        if (c === src) continue;
                        if ((nx-c.x)**2 + (ny-c.y)**2 < 144) { hit = true; break; }
                    }
                    ctx.lineTo(nx, ny);
                    if (hit || nx < -10 || nx > this.W+10 || ny < -10 || ny > this.H+10) break;
                    x = nx; y = ny;
                }

                const grad = ctx.createLinearGradient(src.x, src.y, x, y);
                const base = src.q > 0 ? 'rgba(239,68,68,' : 'rgba(59,130,246,';
                grad.addColorStop(0, base + '0.6)');
                grad.addColorStop(1, base + '0.08)');
                ctx.strokeStyle = grad;
                ctx.lineWidth = 1.2;
                ctx.stroke();
            }
        }
    },

    // ═══════════════════════════════════════════
    // 矢量场
    // ═══════════════════════════════════════════
    drawVectorField() {
        const ctx = this.ctx;
        const step = this.vectorGridStep;
        for (let x = step/2; x < this.W; x += step) {
            for (let y = step/2; y < this.H; y += step) {
                let tooClose = false;
                for (const c of this.charges) {
                    if ((x-c.x)**2 + (y-c.y)**2 < 900) { tooClose = true; break; }
                }
                if (tooClose) continue;
                const E = this.fieldAt(x, y);
                const mag = Math.sqrt(E.x*E.x + E.y*E.y);
                if (mag < 0.3) continue;
                const len = Math.min(this.arrowScale, 5 * Math.log(1 + mag));
                const angle = Math.atan2(E.y, E.x);
                const ex = x + len * Math.cos(angle), ey = y + len * Math.sin(angle);
                const intensity = Math.min(1, mag / 30);
                ctx.strokeStyle = `rgba(${59+Math.round(intensity*180)},${130-Math.round(intensity*62)},${246-Math.round(intensity*182)},${0.3+intensity*0.5})`;
                ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
                const hl = 4;
                ctx.beginPath();
                ctx.moveTo(ex, ey); ctx.lineTo(ex - hl*Math.cos(angle-0.5), ey - hl*Math.sin(angle-0.5));
                ctx.moveTo(ex, ey); ctx.lineTo(ex - hl*Math.cos(angle+0.5), ey - hl*Math.sin(angle+0.5));
                ctx.stroke();
            }
        }
    },

    // ═══════════════════════════════════════════
    // 等势线（Marching Squares）
    // ═══════════════════════════════════════════
    drawEquipotentialLines() {
        const ctx = this.ctx;
        const step = 6; // 采样间距
        const cols = Math.ceil(this.W / step) + 1;
        const rows = Math.ceil(this.H / step) + 1;

        // 计算势场网格
        const grid = new Float64Array(cols * rows);
        let vMin = Infinity, vMax = -Infinity;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const v = this.potentialAt(c * step, r * step);
                grid[r * cols + c] = v;
                if (v < vMin) vMin = v;
                if (v > vMax) vMax = v;
            }
        }

        // 选择等势线值：关于 0 对称，等间距
        const absMax = Math.max(Math.abs(vMin), Math.abs(vMax));
        if (absMax < 1) return;
        const n = this.contourCount;
        const levels = [];
        for (let i = 1; i <= n; i++) {
            const v = absMax * i / (n + 1);
            levels.push(v);
            levels.push(-v);
        }
        levels.push(0);

        // Marching squares 绘制
        for (const level of levels) {
            const hue = level > 0 ? 0 : level < 0 ? 220 : 60; // red for +, blue for -, yellow for 0
            const sat = level === 0 ? 80 : 70;
            const alpha = level === 0 ? 0.6 : 0.35;
            ctx.strokeStyle = `hsla(${hue},${sat}%,60%,${alpha})`;
            ctx.lineWidth = level === 0 ? 2 : 1;

            ctx.beginPath();
            for (let r = 0; r < rows - 1; r++) {
                for (let c = 0; c < cols - 1; c++) {
                    const idx = r * cols + c;
                    const v00 = grid[idx] - level;
                    const v10 = grid[idx + 1] - level;
                    const v01 = grid[idx + cols] - level;
                    const v11 = grid[idx + cols + 1] - level;

                    const code = (v00 > 0 ? 8 : 0) | (v10 > 0 ? 4 : 0) | (v11 > 0 ? 2 : 0) | (v01 > 0 ? 1 : 0);
                    if (code === 0 || code === 15) continue;

                    const x0 = c * step, y0 = r * step;
                    // 线性插值边上的交点
                    const lerp = (a, b) => a / (a - b);
                    const top    = { x: x0 + step * lerp(v00, v10), y: y0 };
                    const bottom = { x: x0 + step * lerp(v01, v11), y: y0 + step };
                    const left   = { x: x0, y: y0 + step * lerp(v00, v01) };
                    const right  = { x: x0 + step, y: y0 + step * lerp(v10, v11) };

                    const segments = this._marchingSegments(code, top, right, bottom, left);
                    for (const [a, b] of segments) {
                        ctx.moveTo(a.x, a.y);
                        ctx.lineTo(b.x, b.y);
                    }
                }
            }
            ctx.stroke();
        }

        // 也叠加显示淡化的场线
        ctx.globalAlpha = 0.15;
        this.drawFieldLines();
        ctx.globalAlpha = 1;
    },

    _marchingSegments(code, top, right, bottom, left) {
        // Marching squares lookup: returns array of [p1, p2] line segments
        switch (code) {
            case 1: case 14: return [[left, bottom]];
            case 2: case 13: return [[bottom, right]];
            case 3: case 12: return [[left, right]];
            case 4: case 11: return [[top, right]];
            case 5: return [[left, top], [bottom, right]]; // saddle
            case 6: case 9:  return [[top, bottom]];
            case 7: case 8:  return [[left, top]];
            case 10: return [[top, right], [left, bottom]]; // saddle
            default: return [];
        }
    },

    // ═══════════════════════════════════════════
    // 电势热图
    // ═══════════════════════════════════════════
    drawHeatmap() {
        const { ctx, W, H } = this;
        if (this._heatDirty) {
            this._renderHeatToOffscreen();
            this._heatDirty = false;
        }
        if (this._heatCanvas) {
            ctx.globalAlpha = 0.85;
            ctx.drawImage(this._heatCanvas, 0, 0, W, H);
            ctx.globalAlpha = 1;
        }
        // 叠加等势线轮廓
        ctx.globalAlpha = 0.3;
        const savedContourCount = this.contourCount;
        this.contourCount = 8;
        this.drawEquipotentialLines();
        this.contourCount = savedContourCount;
        ctx.globalAlpha = 1;
    },

    _renderHeatToOffscreen() {
        const { W, H } = this;
        const scale = 3; // 1/3 分辨率
        const w = Math.ceil(W / scale), h = Math.ceil(H / scale);
        if (!this._heatCanvas) this._heatCanvas = document.createElement('canvas');
        this._heatCanvas.width = w; this._heatCanvas.height = h;
        const octx = this._heatCanvas.getContext('2d');
        const imgData = octx.createImageData(w, h);
        const data = imgData.data;

        // 先找极值
        let vMin = 0, vMax = 0;
        const vals = new Float64Array(w * h);
        for (let py = 0; py < h; py++) {
            for (let px = 0; px < w; px++) {
                const v = this.potentialAt(px * scale, py * scale);
                vals[py * w + px] = v;
                if (v < vMin) vMin = v;
                if (v > vMax) vMax = v;
            }
        }
        const absMax = Math.max(Math.abs(vMin), Math.abs(vMax), 1);

        for (let i = 0; i < vals.length; i++) {
            const norm = vals[i] / absMax; // [-1, 1]
            const [r, g, b] = this._divergingColor(norm);
            data[i*4] = r; data[i*4+1] = g; data[i*4+2] = b; data[i*4+3] = 255;
        }
        octx.putImageData(imgData, 0, 0);
    },

    _divergingColor(t) {
        // Blue(-1) → Dark(0) → Red(+1) diverging colormap
        // Clamp to [-1, 1]
        t = Math.max(-1, Math.min(1, t));
        if (t >= 0) {
            // 0→1: dark → red
            const s = Math.pow(t, 0.5);
            return [Math.round(20 + 215 * s), Math.round(18 - 18 * s + 40 * s * (1-s)), Math.round(20 - 10 * s)];
        } else {
            // -1→0: blue → dark
            const s = Math.pow(-t, 0.5);
            return [Math.round(20 - 10 * s), Math.round(18 + 30 * s * (1-s)), Math.round(20 + 210 * s)];
        }
    },

    // ═══════════════════════════════════════════
    // 测量探针
    // ═══════════════════════════════════════════
    drawProbe() {
        const ctx = this.ctx;
        const { x: px, y: py } = this.probePos;
        // 十字线
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, this.H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(this.W, py); ctx.stroke();
        ctx.setLineDash([]);

        // 计算该点的 E 和 V
        const E = this.fieldAt(px, py);
        const eMag = Math.sqrt(E.x*E.x + E.y*E.y);
        const V = this.potentialAt(px, py);
        const eAngle = Math.atan2(E.y, E.x);

        // E 向量箭头
        const arrowLen = Math.min(40, 8 * Math.log(1 + eMag));
        const ax = px + arrowLen * Math.cos(eAngle);
        const ay = py + arrowLen * Math.sin(eAngle);
        ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ax, ay); ctx.stroke();
        const hl = 6;
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - hl*Math.cos(eAngle-0.4), ay - hl*Math.sin(eAngle-0.4));
        ctx.lineTo(ax - hl*Math.cos(eAngle+0.4), ay - hl*Math.sin(eAngle+0.4));
        ctx.closePath(); ctx.fill();

        // 数值标签
        const tx = px < this.W - 160 ? px + 12 : px - 155;
        const ty = py > 60 ? py - 10 : py + 50;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.beginPath();
        ctx.roundRect(tx - 4, ty - 16, 150, 50, 6);
        ctx.fill();
        ctx.font = '500 16px ' + CF.mono;
        ctx.fillStyle = '#fbbf24';
        ctx.textAlign = 'left';
        ctx.fillText(`|E| = ${eMag.toFixed(1)}`, tx, ty);
        ctx.fillStyle = '#a78bfa';
        ctx.fillText(`V = ${V.toFixed(1)}`, tx, ty + 16);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText(`θ = ${(eAngle * 180 / Math.PI).toFixed(0)}°`, tx, ty + 32);
    },

    // ═══════════════════════════════════════════
    // 电荷绘制
    // ═══════════════════════════════════════════
    drawCharges() {
        const ctx = this.ctx;
        for (const c of this.charges) {
            const r = 16;
            // 光晕
            const glow = ctx.createRadialGradient(c.x, c.y, r*0.5, c.x, c.y, r*2.5);
            const gc = c.q > 0 ? 'rgba(239,68,68,' : 'rgba(59,130,246,';
            glow.addColorStop(0, gc + '0.25)');
            glow.addColorStop(1, gc + '0)');
            ctx.fillStyle = glow;
            ctx.beginPath(); ctx.arc(c.x, c.y, r*2.5, 0, Math.PI*2); ctx.fill();

            // 电荷实体
            const grad = ctx.createRadialGradient(c.x-3, c.y-3, 2, c.x, c.y, r);
            if (c.q > 0) { grad.addColorStop(0, '#fca5a5'); grad.addColorStop(1, '#dc2626'); }
            else { grad.addColorStop(0, '#93c5fd'); grad.addColorStop(1, '#2563eb'); }
            ctx.fillStyle = grad;
            ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI*2); ctx.fill();
            ctx.strokeStyle = c.q > 0 ? '#fca5a5' : '#93c5fd';
            ctx.lineWidth = 1.5; ctx.stroke();

            // +/- 符号
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 20px ' + CF.sans;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(c.q > 0 ? '+' : '−', c.x, c.y + 1);
        }
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    },

    /* ====== 磁场模式 ====== */

    _magCurrentSign: 1,

    _injectMagneticPanel() {
        const wrap = document.getElementById('em-controls');
        if (!wrap || document.getElementById('em-magnetic-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'em-magnetic-panel';
        panel.style.cssText = 'display:none;margin-top:8px;padding:8px 12px;background:rgba(30,41,59,.55);border-radius:8px;font-size:13px;color:#e2e8f0;';
        panel.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <label style="display:flex;align-items:center;gap:4px;cursor:pointer">
                    <input type="radio" name="em-msign" value="1" checked> <span style="color:#f59e0b">⊙</span> 出屏
                </label>
                <label style="display:flex;align-items:center;gap:4px;cursor:pointer">
                    <input type="radio" name="em-msign" value="-1"> <span style="color:#8b5cf6">⊗</span> 入屏
                </label>
                <button id="em-mag-preset-pair" style="padding:2px 10px;border-radius:4px;border:1px solid #64748b;background:transparent;color:#cbd5e1;cursor:pointer;font-size:12px">同向平行</button>
                <button id="em-mag-preset-anti" style="padding:2px 10px;border-radius:4px;border:1px solid #64748b;background:transparent;color:#cbd5e1;cursor:pointer;font-size:12px">反向平行</button>
                <button id="em-mag-preset-tri" style="padding:2px 10px;border-radius:4px;border:1px solid #64748b;background:transparent;color:#cbd5e1;cursor:pointer;font-size:12px">三角排列</button>
                <button id="em-mag-preset-solenoid" style="padding:2px 10px;border-radius:4px;border:1px solid #64748b;background:transparent;color:#cbd5e1;cursor:pointer;font-size:12px">螺线管截面</button>
                <button id="em-mag-preset-quad" style="padding:2px 10px;border-radius:4px;border:1px solid #64748b;background:transparent;color:#cbd5e1;cursor:pointer;font-size:12px">四极</button>
                <button id="em-clear-currents" style="padding:2px 10px;border-radius:4px;border:1px solid #64748b;background:transparent;color:#cbd5e1;cursor:pointer;font-size:12px">清空</button>
            </div>
            <div style="margin-top:6px;color:#94a3b8;font-size:12px">点击画布放置载流导线，双击删除</div>
        `;
        wrap.appendChild(panel);

        panel.querySelectorAll('input[name="em-msign"]').forEach(r => {
            r.addEventListener('change', () => { this._magCurrentSign = Number(r.value); });
        });
        document.getElementById('em-clear-currents').addEventListener('click', () => {
            this.currents = [];
            this.render();
        });
        const presetBtn = (id, fn) => {
            document.getElementById(id).addEventListener('click', () => { fn(); this.render(); });
        };
        const cx = () => this.W / 2, cy = () => this.H / 2;
        const d = () => Math.min(this.W, this.H) * 0.2;

        presetBtn('em-mag-preset-pair', () => {
            this.currents = [
                { x: cx() - d(), y: cy(), I: 1 },
                { x: cx() + d(), y: cy(), I: 1 }
            ];
        });
        presetBtn('em-mag-preset-anti', () => {
            this.currents = [
                { x: cx() - d(), y: cy(), I: 1 },
                { x: cx() + d(), y: cy(), I: -1 }
            ];
        });
        presetBtn('em-mag-preset-tri', () => {
            const r = d() * 1.1;
            this.currents = [0, 1, 2].map(i => {
                const a = -Math.PI / 2 + i * Math.PI * 2 / 3;
                return { x: cx() + Math.cos(a) * r, y: cy() + Math.sin(a) * r, I: 1 };
            });
        });
        presetBtn('em-mag-preset-solenoid', () => {
            const n = 8, gap = this.W * 0.06;
            const startX = cx() - (n - 1) * gap / 2;
            this.currents = [];
            for (let i = 0; i < n; i++) {
                // 上排向右(出屏)，下排向左(入屏)，模拟螺线管截面
                this.currents.push({ x: startX + i * gap, y: cy() - d() * 0.6, I: 1 });
                this.currents.push({ x: startX + i * gap, y: cy() + d() * 0.6, I: -1 });
            }
        });
        presetBtn('em-mag-preset-quad', () => {
            const r = d() * 0.9;
            // 四极：相邻方向相反
            this.currents = [0, 1, 2, 3].map(i => {
                const a = Math.PI / 4 + i * Math.PI / 2;
                return { x: cx() + Math.cos(a) * r, y: cy() + Math.sin(a) * r, I: i % 2 === 0 ? 1 : -1 };
            });
        });
    },

    magneticFieldAt(px, py) {
        let bx = 0, by = 0;
        for (const c of this.currents) {
            const dx = px - c.x, dy = py - c.y;
            const r2 = dx * dx + dy * dy;
            if (r2 < 100) continue; // 避免奇点
            const r = Math.sqrt(r2);
            const B = c.I / (2 * Math.PI * r); // μ₀ 被吸收进缩放
            // B 方向：右手定则，I 出屏 → 逆时针 → (-dy, dx)/r
            bx += B * (-dy) / r;
            by += B * dx / r;
        }
        return { x: bx, y: by };
    },

    drawMagneticField() {
        const { ctx, W, H } = this;
        const step = this.magneticNeedleStep;

        if (this.currents.length === 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.font = '19px ' + CF.sans;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('点击画布放置载流导线', W / 2, H / 2);
            return;
        }

        // 找最大场强用于归一化
        let maxB = 0;
        for (let y = step / 2; y < H; y += step) {
            for (let x = step / 2; x < W; x += step) {
                const B = this.magneticFieldAt(x, y);
                const mag = Math.hypot(B.x, B.y);
                if (mag > maxB) maxB = mag;
            }
        }
        if (maxB < 1e-10) maxB = 1;

        // 绘制罗盘针
        for (let y = step / 2; y < H; y += step) {
            for (let x = step / 2; x < W; x += step) {
                // 跳过导线附近
                let nearWire = false;
                for (const c of this.currents) {
                    if ((x - c.x) ** 2 + (y - c.y) ** 2 < step * step) { nearWire = true; break; }
                }
                if (nearWire) continue;

                const B = this.magneticFieldAt(x, y);
                const mag = Math.hypot(B.x, B.y);
                if (mag < 1e-10) continue;

                const angle = Math.atan2(B.y, B.x);
                const normMag = Math.min(mag / maxB, 1);
                const len = step * 0.35 * (0.3 + 0.7 * normMag);

                ctx.save();
                ctx.translate(x, y);
                ctx.rotate(angle);

                // 针体
                ctx.strokeStyle = `rgba(251,191,36,${0.2 + normMag * 0.6})`;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(-len, 0);
                ctx.lineTo(len, 0);
                ctx.stroke();

                // 箭头
                ctx.fillStyle = `rgba(251,191,36,${0.3 + normMag * 0.6})`;
                ctx.beginPath();
                ctx.moveTo(len, 0);
                ctx.lineTo(len - 4, -2.5);
                ctx.lineTo(len - 4, 2.5);
                ctx.closePath();
                ctx.fill();

                ctx.restore();
            }
        }

        // 绘制磁力线（从导线出发的同心圆弧）
        ctx.lineWidth = 0.8;
        for (const c of this.currents) {
            const maxR = Math.max(W, H);
            const radii = [30, 60, 100, 150, 220, 320];
            for (const r of radii) {
                if (r > maxR) break;
                ctx.strokeStyle = c.I > 0 ? 'rgba(251,191,36,0.12)' : 'rgba(139,92,246,0.12)';
                ctx.beginPath();
                ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
                ctx.stroke();

                // 方向箭头
                const dir = c.I > 0 ? 1 : -1; // 出屏逆时针，入屏顺时针
                for (let a = 0; a < 4; a++) {
                    const angle = a * Math.PI / 2 + dir * 0.1;
                    const ax = c.x + Math.cos(angle) * r;
                    const ay = c.y + Math.sin(angle) * r;
                    const tx = -Math.sin(angle) * dir;
                    const ty = Math.cos(angle) * dir;
                    ctx.fillStyle = c.I > 0 ? 'rgba(251,191,36,0.2)' : 'rgba(139,92,246,0.2)';
                    ctx.beginPath();
                    ctx.moveTo(ax + tx * 5, ay + ty * 5);
                    ctx.lineTo(ax - tx * 2 + ty * 3, ay - ty * 2 - tx * 3);
                    ctx.lineTo(ax - tx * 2 - ty * 3, ay - ty * 2 + tx * 3);
                    ctx.closePath();
                    ctx.fill();
                }
            }
        }

        // 绘制导线
        this.drawCurrentWires();

        // 磁场探针信息
        if (this._magProbePos) this.drawMagneticProbe();
    },

    drawMagneticProbe() {
        const ctx = this.ctx;
        const { x: px, y: py } = this._magProbePos;

        // 计算该点的 B
        const B = this.magneticFieldAt(px, py);
        const bMag = Math.hypot(B.x, B.y);
        const bAngle = Math.atan2(B.y, B.x);

        // 十字线
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, this.H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(this.W, py); ctx.stroke();
        ctx.setLineDash([]);

        // B 向量箭头
        if (bMag > 1e-6) {
            const arrowLen = Math.min(50, 12 * Math.log(1 + bMag * 200));
            const ax = px + arrowLen * Math.cos(bAngle);
            const ay = py + arrowLen * Math.sin(bAngle);
            ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ax, ay); ctx.stroke();
            const hl = 6;
            ctx.fillStyle = '#38bdf8';
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(ax - hl * Math.cos(bAngle - 0.4), ay - hl * Math.sin(bAngle - 0.4));
            ctx.lineTo(ax - hl * Math.cos(bAngle + 0.4), ay - hl * Math.sin(bAngle + 0.4));
            ctx.closePath(); ctx.fill();
        }

        // 信息标签
        const tx = px < this.W - 180 ? px + 14 : px - 175;
        const ty = py > 70 ? py - 12 : py + 55;
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.beginPath();
        ctx.roundRect(tx - 6, ty - 18, 170, 62, 6);
        ctx.fill();

        ctx.font = '500 16px ' + CF.mono;
        ctx.textAlign = 'left';
        ctx.fillStyle = '#38bdf8';
        ctx.fillText(`|B| = ${(bMag * 1000).toFixed(2)} mT`, tx, ty);
        ctx.fillStyle = '#fbbf24';
        ctx.fillText(`\u03b8 = ${(bAngle * 180 / Math.PI).toFixed(1)}\u00b0`, tx, ty + 16);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText(`Bx=${(B.x * 1000).toFixed(2)}  By=${(B.y * 1000).toFixed(2)}`, tx, ty + 32);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '15px ' + CF.sans;
        ctx.fillText(`\u5bfc\u7ebf\u6570: ${this.currents.length}`, tx, ty + 46);
    },

    drawCurrentWires() {
        const ctx = this.ctx;
        for (const c of this.currents) {
            const r = 14;
            // 外圈
            ctx.beginPath();
            ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
            ctx.fillStyle = c.I > 0 ? 'rgba(251,191,36,0.15)' : 'rgba(139,92,246,0.15)';
            ctx.fill();
            ctx.strokeStyle = c.I > 0 ? '#f59e0b' : '#8b5cf6';
            ctx.lineWidth = 2;
            ctx.stroke();

            // 符号：⊙(出屏, 中心一点) 或 ⊗(入屏, ×)
            ctx.fillStyle = c.I > 0 ? '#fbbf24' : '#a78bfa';
            ctx.font = 'bold 19px ' + CF.sans;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            if (c.I > 0) {
                // 圆心点
                ctx.beginPath();
                ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
                ctx.fill();
            } else {
                // × 号
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#a78bfa';
                const s = 6;
                ctx.beginPath();
                ctx.moveTo(c.x - s, c.y - s); ctx.lineTo(c.x + s, c.y + s);
                ctx.moveTo(c.x + s, c.y - s); ctx.lineTo(c.x - s, c.y + s);
                ctx.stroke();
            }

            // 标签
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = '15px ' + CF.sans;
            ctx.fillText(c.I > 0 ? 'I ⊙' : 'I ⊗', c.x, c.y - r - 6);
        }
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    },

    /* ====== 粒子轨迹模式 ====== */

    _injectParticlePanel() {
        const wrap = document.getElementById('em-controls');
        if (!wrap || document.getElementById('em-particle-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'em-particle-panel';
        panel.style.cssText = 'display:none;margin-top:8px;padding:8px 12px;background:rgba(30,41,59,.55);border-radius:8px;font-size:13px;color:#e2e8f0;';
        panel.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <label style="display:flex;align-items:center;gap:4px;cursor:pointer">
                    <input type="radio" name="em-psign" value="1" checked> <span style="color:#f87171">+</span> 粒子
                </label>
                <label style="display:flex;align-items:center;gap:4px;cursor:pointer">
                    <input type="radio" name="em-psign" value="-1"> <span style="color:#60a5fa">−</span> 粒子
                </label>
                <button id="em-clear-particles" style="margin-left:auto;padding:2px 10px;border-radius:4px;border:1px solid #64748b;background:transparent;color:#cbd5e1;cursor:pointer;font-size:12px">清空粒子</button>
            </div>
            <div style="margin-top:6px;color:#94a3b8;font-size:12px">点击画布释放测试粒子</div>
        `;
        wrap.appendChild(panel);

        panel.querySelectorAll('input[name="em-psign"]').forEach(r => {
            r.addEventListener('change', () => { this.particleSign = Number(r.value); });
        });
        document.getElementById('em-clear-particles').addEventListener('click', () => {
            this.particles = [];
            this.render();
        });
    },

    _startParticleLoop() {
        if (this._animId) return;
        this._lastTime = performance.now();
        const loop = (now) => {
            const rawDt = (now - this._lastTime) / 1000;
            this._lastTime = now;
            const dt = Math.min(rawDt, 0.1);

            if (!this.paused) this._stepParticles(dt);
            this.render();

            this._animId = requestAnimationFrame(loop);
        };
        this._animId = requestAnimationFrame(loop);
    },

    _stopParticleLoop() {
        if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
    },

    _stepParticles(dt) {
        const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
        const k = 800;          // 场力缩放
        const maxSpeed = 600;   // 像素/秒
        const trailMax = 200;   // 最大尾迹点数
        const subSteps = 4;
        const sub = dt / subSteps;

        for (let p of this.particles) {
            for (let s = 0; s < subSteps; s++) {
                const E = this.fieldAt(p.x, p.y);
                const ax = p.sign * k * E.x;
                const ay = p.sign * k * E.y;

                // Velocity Verlet
                p.x += p.vx * sub + 0.5 * ax * sub * sub;
                p.y += p.vy * sub + 0.5 * ay * sub * sub;

                const E2 = this.fieldAt(p.x, p.y);
                const ax2 = p.sign * k * E2.x;
                const ay2 = p.sign * k * E2.y;
                p.vx += 0.5 * (ax + ax2) * sub;
                p.vy += 0.5 * (ay + ay2) * sub;

                // 限速
                const spd = Math.hypot(p.vx, p.vy);
                if (spd > maxSpeed) { p.vx *= maxSpeed / spd; p.vy *= maxSpeed / spd; }
            }

            p.trail.push({ x: p.x, y: p.y });
            if (p.trail.length > trailMax) p.trail.shift();

            // 出界标记
            if (p.x < -50 || p.x > w + 50 || p.y < -50 || p.y > h + 50) p.dead = true;
        }

        this.particles = this.particles.filter(p => !p.dead);
    },

    _launchParticle(x, y) {
        this.particles.push({
            x, y,
            vx: 0, vy: 0,
            sign: this.particleSign,
            trail: [{ x, y }],
            dead: false
        });
    },

    drawParticles() {
        const ctx = this.ctx;
        for (const p of this.particles) {
            // 尾迹
            if (p.trail.length > 1) {
                ctx.lineWidth = 2;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                for (let i = 1; i < p.trail.length; i++) {
                    const alpha = i / p.trail.length;
                    ctx.strokeStyle = p.sign > 0
                        ? `rgba(248,113,113,${alpha * 0.8})`
                        : `rgba(96,165,250,${alpha * 0.8})`;
                    ctx.beginPath();
                    ctx.moveTo(p.trail[i - 1].x, p.trail[i - 1].y);
                    ctx.lineTo(p.trail[i].x, p.trail[i].y);
                    ctx.stroke();
                }
            }
            // 粒子本体
            const r = 5;
            const grad = ctx.createRadialGradient(p.x - 1, p.y - 1, 1, p.x, p.y, r);
            if (p.sign > 0) {
                grad.addColorStop(0, '#fef2f2'); grad.addColorStop(1, '#f87171');
            } else {
                grad.addColorStop(0, '#eff6ff'); grad.addColorStop(1, '#60a5fa');
            }
            ctx.fillStyle = grad;
            ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();

            ctx.fillStyle = '#fff';
            ctx.font = 'bold 13px ' + CF.sans;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(p.sign > 0 ? '+' : '−', p.x, p.y + 0.5);
        }
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
};

function initElectromagnetic() {
    EMField.init();
}
