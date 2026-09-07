// ===== Materials & Microstructure: Crystal and Grain Lab =====

(function () {
    const CELL_DATA = {
        sc: {
            label: '简单立方',
            code: 'SC',
            atoms: 1,
            coordination: 6,
            packing: 0.52,
            contact: 'a = 2r',
            stack: 'AAA',
            examples: 'Po',
            summary: '原子只与六个最近邻接触，堆积效率低，金属中很少见。'
        },
        bcc: {
            label: '体心立方',
            code: 'BCC',
            atoms: 2,
            coordination: 8,
            packing: 0.68,
            contact: 'a = 4r / √3',
            stack: '中心原子连接八个角原子',
            examples: 'Fe, Cr, W',
            summary: '角原子与体心原子接触，常见于铁、铬、钨等金属。'
        },
        fcc: {
            label: '面心立方',
            code: 'FCC',
            atoms: 4,
            coordination: 12,
            packing: 0.74,
            contact: 'a = 2√2r',
            stack: 'ABCABC',
            examples: 'Al, Cu, Ni',
            summary: '属于立方最密堆积，每个原子有 12 个最近邻。'
        },
        hcp: {
            label: '密排六方',
            code: 'HCP',
            atoms: 6,
            coordination: 12,
            packing: 0.74,
            contact: 'c/a ≈ 1.633',
            stack: 'ABAB',
            examples: 'Mg, Ti, Zn',
            summary: '与 FCC 同为最密堆积，但堆垛顺序是 ABAB。'
        }
    };

    const PRESETS = {
        refined: { label: '快速凝固', grainSize: 18 },
        recrystallized: { label: '再结晶', grainSize: 38 },
        annealed: { label: '退火长大', grainSize: 92 }
    };

    const MaterialsLab = {
        canvas: null,
        ctx: null,
        grainInput: null,
        grainValue: null,
        defectInput: null,
        defectValue: null,
        coolingInput: null,
        coolingValue: null,
        infoRoot: null,
        cellButtons: [],
        presetButtons: [],
        dpr: 1,
        cellId: 'fcc',
        grainSize: 45,
        defectDensity: 2,
        coolingRate: 50,
        _boundResize: null,

        init() {
            this.canvas = document.getElementById('materials-canvas');
            if (!this.canvas) return;
            this.ctx = typeof this.canvas.getContext === 'function'
                ? this.canvas.getContext('2d')
                : null;
            this.grainInput = document.getElementById('materials-grain-size');
            this.grainValue = document.getElementById('materials-grain-size-value');
            this.defectInput = document.getElementById('materials-defect');
            this.defectValue = document.getElementById('materials-defect-value');
            this.coolingInput = document.getElementById('materials-cooling');
            this.coolingValue = document.getElementById('materials-cooling-value');
            this.infoRoot = document.getElementById('materials-info');
            this.cellButtons = Array.from(document.querySelectorAll('[data-material-cell]'));
            this.presetButtons = Array.from(document.querySelectorAll('[data-material-preset]'));
            this._bindControls();
            if (!this._boundResize) this._boundResize = () => this.render();
            window.addEventListener('resize', this._boundResize);
            this.render();
        },

        destroy() {
            if (this._boundResize) window.removeEventListener('resize', this._boundResize);
        },

        render() {
            this._syncControls();

            const cell = CELL_DATA[this.cellId] || CELL_DATA.fcc;
            const model = this._calculate(cell);
            if (this.canvas && this.ctx) {
                this._resizeCanvas();
                this._draw(model);
            }
            this._updateInfo(model);
        },

        _bindControls() {
            if (this.grainInput && !this.grainInput.dataset.bound) {
                this.grainInput.dataset.bound = 'true';
                this.grainInput.addEventListener('input', () => {
                    this.grainSize = Number(this.grainInput.value) || 45;
                    this._clearPresetState();
                    this.render();
                });
            }

            if (this.defectInput && !this.defectInput.dataset.bound) {
                this.defectInput.dataset.bound = 'true';
                this.defectInput.addEventListener('input', () => {
                    this.defectDensity = Math.max(0, Math.min(10, Number(this.defectInput.value) || 0));
                    this.render();
                });
            }

            if (this.coolingInput && !this.coolingInput.dataset.bound) {
                this.coolingInput.dataset.bound = 'true';
                this.coolingInput.addEventListener('input', () => {
                    this.coolingRate = Math.max(10, Math.min(100, Number(this.coolingInput.value) || 50));
                    this.render();
                });
            }

            this.cellButtons.forEach(button => {
                if (button.dataset.bound) return;
                button.dataset.bound = 'true';
                button.addEventListener('click', () => {
                    this.cellId = button.dataset.materialCell || 'fcc';
                    this.render();
                });
            });

            this.presetButtons.forEach(button => {
                if (button.dataset.bound) return;
                button.dataset.bound = 'true';
                button.addEventListener('click', () => {
                    const preset = PRESETS[button.dataset.materialPreset];
                    if (!preset) return;
                    this.grainSize = preset.grainSize;
                    this.render();
                });
            });
        },

        _syncControls() {
            if (this.grainInput) this.grainInput.value = String(this.grainSize);
            if (this.grainValue) this.grainValue.textContent = `${Math.round(this.grainSize)} μm`;
            if (this.defectInput) this.defectInput.value = String(this.defectDensity);
            if (this.defectValue) this.defectValue.textContent = `${Math.round(this.defectDensity)} / 10`;
            if (this.coolingInput) this.coolingInput.value = String(this.coolingRate);
            if (this.coolingValue) this.coolingValue.textContent = String(Math.round(this.coolingRate));
            this.cellButtons.forEach(button => {
                const active = button.dataset.materialCell === this.cellId;
                button.classList.toggle('is-active', active);
                button.setAttribute('aria-pressed', String(active));
            });
            this.presetButtons.forEach(button => {
                const preset = PRESETS[button.dataset.materialPreset];
                const active = preset && Math.round(preset.grainSize) === Math.round(this.grainSize);
                button.classList.toggle('is-active', !!active);
                button.setAttribute('aria-pressed', String(!!active));
            });
        },

        _clearPresetState() {
            this.presetButtons.forEach(button => {
                button.classList.remove('is-active');
                button.setAttribute('aria-pressed', 'false');
            });
        },

        _calculate(cell) {
            const coolingFraction = (this.coolingRate - 10) / 90;
            const observedGrainSize = Math.max(5, this.grainSize * (1 - coolingFraction * 0.55));
            const boundaryIndex = Math.sqrt(45 / observedGrainSize);
            const hallPetchTerm = 1 / Math.sqrt(observedGrainSize);
            const strengthIndex = 0.72 + 1.55 * hallPetchTerm - this.defectDensity * 0.025;
            const grainCount = Math.round(this._map(observedGrainSize, 5, 120, 70, 12));
            return {
                cell,
                grainSize: this.grainSize,
                observedGrainSize,
                defectDensity: this.defectDensity,
                defectCount: Math.round(this.defectDensity * 1.8),
                coolingRate: this.coolingRate,
                boundaryIndex,
                hallPetchTerm,
                strengthIndex,
                grainCount
            };
        },

        _draw(model) {
            const ctx = this.ctx;
            const w = this.canvas.clientWidth;
            const h = this.canvas.clientHeight;
            if (w <= 0 || h <= 0) return;
            ctx.clearRect(0, 0, w, h);

            const compact = w < 720;
            const cellBox = compact
                ? { x: 34, y: 34, w: w - 68, h: Math.max(158, h * 0.32) }
                : { x: 46, y: 44, w: Math.max(260, w * 0.38), h: h - 88 };
            const grainBox = compact
                ? { x: 34, y: cellBox.y + cellBox.h + 28, w: w - 68, h: Math.max(150, h * 0.3) }
                : { x: cellBox.x + cellBox.w + 34, y: 44, w: w - cellBox.x - cellBox.w - 80, h: Math.max(250, h * 0.52) };
            const curveBox = compact
                ? { x: 34, y: grainBox.y + grainBox.h + 28, w: w - 68, h: Math.max(112, h - grainBox.y - grainBox.h - 60) }
                : { x: grainBox.x, y: grainBox.y + grainBox.h + 30, w: grainBox.w, h: h - grainBox.y - grainBox.h - 74 };

            this._drawPanel(ctx, cellBox, '晶胞模型', model.cell.code);
            this._drawCell(ctx, cellBox, model.cell);
            this._drawPackingBar(ctx, cellBox, model.cell);

            this._drawPanel(ctx, grainBox, '多晶显微结构', `${Math.round(model.observedGrainSize)} μm`);
            this._drawGrains(ctx, grainBox, model);

            this._drawPanel(ctx, curveBox, '晶粒尺寸趋势', 'relative');
            this._drawStrengthCurve(ctx, curveBox, model);
        },

        _drawPanel(ctx, box, title, tag) {
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.035)';
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.lineWidth = 1;
            this._roundRect(ctx, box.x, box.y, box.w, box.h, 8);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = 'rgba(220,228,238,0.82)';
            ctx.font = `12px ${this._fontMono()}`;
            ctx.textAlign = 'left';
            ctx.fillText(title, box.x + 16, box.y + 24);
            ctx.textAlign = 'right';
            ctx.fillStyle = 'rgba(224,181,106,0.9)';
            ctx.fillText(tag, box.x + box.w - 16, box.y + 24);
            ctx.restore();
        },

        _drawCell(ctx, box, cell) {
            if (cell.code === 'HCP') {
                this._drawHcpCell(ctx, box, cell);
                return;
            }

            const cx = box.x + box.w * 0.5;
            const cy = box.y + box.h * 0.42;
            const size = Math.min(box.w, box.h) * 0.44;
            const dx = size * 0.28;
            const dy = -size * 0.22;
            const front = this._cubePoints(cx - size * 0.46, cy - size * 0.1, size);
            const back = front.map(p => ({ x: p.x + dx, y: p.y + dy }));
            const corners = [...front, ...back];

            ctx.save();
            ctx.strokeStyle = 'rgba(224,181,106,0.34)';
            ctx.lineWidth = 1.2;
            this._drawCubeEdges(ctx, front, back);

            if (cell.code === 'BCC') {
                this._drawAtom(ctx, cx + dx * 0.5, cy - size * 0.1 + dy * 0.5, size * 0.095, '#7ed7c1');
            }
            if (cell.code === 'FCC') {
                const faces = [
                    this._mid(front[0], front[1], front[2], front[3]),
                    this._mid(back[0], back[1], back[2], back[3]),
                    this._mid(front[1], back[1], back[2], front[2]),
                    this._mid(front[0], back[0], back[3], front[3])
                ];
                faces.forEach(point => this._drawAtom(ctx, point.x, point.y, size * 0.075, '#7ed7c1'));
            }

            corners.forEach(point => this._drawAtom(ctx, point.x, point.y, size * 0.062, '#e4d8bd'));

            ctx.fillStyle = 'rgba(238,241,248,0.88)';
            ctx.font = `15px ${this._fontDisplay()}`;
            ctx.textAlign = 'center';
            ctx.fillText(cell.label, cx, box.y + box.h - 76);
            ctx.fillStyle = 'rgba(166,176,192,0.88)';
            ctx.font = `12px ${this._fontMono()}`;
            ctx.fillText(`${cell.contact} · ${cell.examples}`, cx, box.y + box.h - 52);
            ctx.restore();
        },

        _drawHcpCell(ctx, box, cell) {
            const cx = box.x + box.w * 0.5;
            const top = box.y + box.h * 0.29;
            const radius = Math.min(box.w, box.h) * 0.15;
            const layers = [
                { y: top, offset: 0, color: '#e4d8bd' },
                { y: top + radius * 0.9, offset: radius * 0.52, color: '#7ed7c1' },
                { y: top + radius * 1.8, offset: 0, color: '#e4d8bd' }
            ];
            ctx.save();
            layers.forEach(layer => {
                for (let i = 0; i < 7; i += 1) {
                    const angle = (Math.PI / 3) * i;
                    const x = i === 6 ? cx + layer.offset : cx + layer.offset + Math.cos(angle) * radius;
                    const y = i === 6 ? layer.y : layer.y + Math.sin(angle) * radius * 0.62;
                    this._drawAtom(ctx, x, y, radius * 0.24, layer.color);
                }
            });
            ctx.strokeStyle = 'rgba(224,181,106,0.34)';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            for (let i = 0; i < 6; i += 1) {
                const angle = (Math.PI / 3) * i;
                const x = cx + Math.cos(angle) * radius * 1.16;
                const y = top + radius * 0.9 + Math.sin(angle) * radius * 0.74;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.stroke();
            ctx.fillStyle = 'rgba(238,241,248,0.88)';
            ctx.font = `15px ${this._fontDisplay()}`;
            ctx.textAlign = 'center';
            ctx.fillText(cell.label, cx, box.y + box.h - 76);
            ctx.fillStyle = 'rgba(166,176,192,0.88)';
            ctx.font = `12px ${this._fontMono()}`;
            ctx.fillText(`${cell.stack} · ${cell.examples}`, cx, box.y + box.h - 52);
            ctx.restore();
        },

        _drawPackingBar(ctx, box, cell) {
            const x = box.x + 24;
            const y = box.y + box.h - 35;
            const width = box.w - 48;
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            this._roundRect(ctx, x, y, width, 8, 5);
            ctx.fill();
            ctx.fillStyle = 'rgba(224,181,106,0.84)';
            this._roundRect(ctx, x, y, width * cell.packing, 8, 5);
            ctx.fill();
            ctx.fillStyle = 'rgba(166,176,192,0.9)';
            ctx.font = `11px ${this._fontMono()}`;
            ctx.textAlign = 'left';
            ctx.fillText(`堆积效率约 ${Math.round(cell.packing * 100)}%`, x, y - 8);
            ctx.textAlign = 'right';
            ctx.fillText(`配位数 ${cell.coordination}`, x + width, y - 8);
            ctx.restore();
        },

        _drawGrains(ctx, box, model) {
            const inset = 18;
            const area = { x: box.x + inset, y: box.y + 42, w: box.w - inset * 2, h: box.h - 60 };
            const seeds = this._grainSeeds(model.grainCount, area);
            const step = Math.max(5, Math.round(Math.min(area.w, area.h) / 58));
            const palette = ['#e0b56a', '#7ed7c1', '#8aa7ff', '#d6dbe6', '#f3c58f'];

            ctx.save();
            ctx.beginPath();
            ctx.rect(area.x, area.y, area.w, area.h);
            ctx.clip();
            for (let y = area.y; y < area.y + area.h; y += step) {
                for (let x = area.x; x < area.x + area.w; x += step) {
                    const nearest = this._nearestSeed(x, y, seeds);
                    ctx.fillStyle = this._rgba(palette[nearest.index % palette.length], 0.10 + (nearest.index % 4) * 0.018);
                    ctx.fillRect(x, y, step + 0.5, step + 0.5);
                }
            }

            ctx.strokeStyle = 'rgba(255,255,255,0.13)';
            ctx.lineWidth = 1;
            seeds.forEach((seed, i) => {
                const next = seeds[(i * 7 + 5) % seeds.length];
                if (!next) return;
                ctx.beginPath();
                ctx.moveTo(seed.x, seed.y);
                ctx.lineTo((seed.x + next.x) / 2, (seed.y + next.y) / 2);
                ctx.stroke();
            });

            ctx.strokeStyle = 'rgba(224,181,106,0.62)';
            ctx.lineWidth = 1.4;
            const lines = Math.min(8, Math.max(3, Math.round(110 / model.observedGrainSize)));
            for (let i = 0; i < lines; i += 1) {
                const sx = area.x + (i + 0.8) * (area.w / (lines + 1));
                const sy = area.y + area.h * (0.24 + (i % 3) * 0.16);
                ctx.beginPath();
                ctx.moveTo(sx, sy);
                ctx.quadraticCurveTo(sx + 24, sy + 16, sx + 52, sy + 5);
                ctx.stroke();
            }
            for (let i = 0; i < model.defectCount; i += 1) {
                const x = area.x + ((Math.sin(i * 12.7 + model.defectDensity) + 1) / 2) * area.w;
                const y = area.y + ((Math.cos(i * 8.3 + model.defectDensity) + 1) / 2) * area.h;
                ctx.beginPath();
                ctx.arc(x, y, 2.4 + model.defectDensity * 0.12, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(225,106,92,0.9)';
                ctx.fill();
            }
            if (model.defectDensity > 0) {
                const pathY = area.y + area.h * 0.62;
                ctx.strokeStyle = `rgba(225,106,92,${0.25 + model.defectDensity * 0.05})`;
                ctx.lineWidth = 1.2 + model.defectDensity * 0.16;
                ctx.beginPath();
                ctx.moveTo(area.x + 8, pathY);
                ctx.lineTo(area.x + area.w * 0.42, pathY - model.defectDensity * 2);
                ctx.lineTo(area.x + area.w * 0.72, pathY + model.defectDensity * 1.5);
                ctx.stroke();
            }
            ctx.restore();

            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.strokeRect(area.x, area.y, area.w, area.h);
            ctx.fillStyle = 'rgba(166,176,192,0.9)';
            ctx.font = `12px ${this._fontMono()}`;
            ctx.textAlign = 'left';
            ctx.fillText('晶界越密，位错滑移路径越容易被打断', area.x, area.y + area.h + 22);
        },

        _drawStrengthCurve(ctx, box, model) {
            const pad = { l: 38, r: 18, t: 38, b: 32 };
            const plot = {
                x: box.x + pad.l,
                y: box.y + pad.t,
                w: box.w - pad.l - pad.r,
                h: box.h - pad.t - pad.b
            };
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.16)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(plot.x, plot.y);
            ctx.lineTo(plot.x, plot.y + plot.h);
            ctx.lineTo(plot.x + plot.w, plot.y + plot.h);
            ctx.stroke();

            const minD = 5;
            const maxD = 120;
            const value = d => 0.72 + 1.55 / Math.sqrt(d);
            const maxV = value(minD);
            const minV = value(maxD);
            const sx = d => plot.x + ((d - minD) / (maxD - minD)) * plot.w;
            const sy = v => plot.y + plot.h - ((v - minV) / (maxV - minV)) * plot.h;

            ctx.strokeStyle = 'rgba(126,215,193,0.88)';
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            for (let i = 0; i <= 90; i += 1) {
                const d = minD + (i / 90) * (maxD - minD);
                const x = sx(d);
                const y = sy(value(d));
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();

            const markerX = sx(model.observedGrainSize);
            const markerY = sy(model.strengthIndex);
            ctx.strokeStyle = 'rgba(224,181,106,0.42)';
            ctx.beginPath();
            ctx.moveTo(markerX, plot.y);
            ctx.lineTo(markerX, plot.y + plot.h);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(markerX, markerY, 5.5, 0, Math.PI * 2);
            ctx.fillStyle = '#e0b56a';
            ctx.fill();
            ctx.strokeStyle = 'rgba(8,9,14,0.8)';
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.fillStyle = 'rgba(166,176,192,0.9)';
            ctx.font = `11px ${this._fontMono()}`;
            ctx.textAlign = 'left';
            ctx.fillText('细晶粒', plot.x, plot.y + plot.h + 22);
            ctx.textAlign = 'right';
            ctx.fillText('粗晶粒', plot.x + plot.w, plot.y + plot.h + 22);
            ctx.textAlign = 'left';
            ctx.fillText('相对强度', box.x + 16, box.y + 24);
            ctx.restore();
        },

        _updateInfo(model) {
            if (!this.infoRoot) return;
            const cell = model.cell;
            const boundary = this._boundaryHint(model);
            this.infoRoot.innerHTML = `
                <div class="materials-panel">
                    <span class="materials-panel__label">缺陷与工艺读数</span>
                    <strong>缺陷 ${model.defectDensity.toFixed(0)} / 10 · 冷却 ${model.coolingRate.toFixed(0)}</strong>
                    <p>红色缺陷点与传播线随缺陷密度增加；本教学模型把冷却速率映射为当前可见组织尺度 ${model.observedGrainSize.toFixed(1)} μm。</p>
                </div>
                <div class="materials-panel">
                    <span class="materials-panel__label">晶体结构</span>
                    <strong>${cell.label}</strong>
                    <p>${cell.summary}</p>
                </div>
                <div class="materials-panel">
                    <span class="materials-panel__label">晶胞数据</span>
                    <strong>${cell.atoms} 个原子 · 配位数 ${cell.coordination}</strong>
                    <p>堆积效率约 ${Math.round(cell.packing * 100)}%，几何关系 ${cell.contact}。</p>
                </div>
                <div class="materials-panel">
                    <span class="materials-panel__label">晶粒尺度</span>
                    <strong>${Math.round(model.observedGrainSize)} μm</strong>
                    <p>相对晶界密度约 ${model.boundaryIndex.toFixed(2)}；在微米级多晶金属入门模型中，晶粒越细，单位体积内晶界通常越多。</p>
                </div>
                <div class="materials-panel">
                    <span class="materials-panel__label">性能趋势</span>
                    <strong>${model.strengthIndex.toFixed(2)} 相对强度指数</strong>
                    <p>按 σy≈σ0+ky·d^-1/2 的方向表达；当前 d^-1/2 项约 ${model.hallPetchTerm.toFixed(3)} μm^-1/2，不能外推到所有合金、温度或纳米晶情境。</p>
                </div>
                <div class="materials-panel">
                    <span class="materials-panel__label">适用范围</span>
                    <strong>${this._escapeHtml(boundary.title)}</strong>
                    <p>${this._escapeHtml(boundary.copy)}</p>
                </div>`;
        },

        _boundaryHint(model) {
            if (model.observedGrainSize <= 12) {
                return {
                    title: '接近超细晶讨论边缘',
                    copy: '晶粒继续变小时，晶界扩散、晶界滑移和材料成分会更明显，Hall-Petch 型直线趋势不能简单外推。'
                };
            }
            if (model.observedGrainSize >= 85) {
                return {
                    title: '粗晶粒更依赖其他缺陷',
                    copy: '晶界密度降低后，强度还会受到位错密度、相组成、孔隙和热处理历史影响，不能只看平均晶粒尺寸。'
                };
            }
            return {
                title: '适合观察微米级趋势',
                copy: '这个范围适合把晶粒细化理解为晶界增加、位错运动受阻的入门模型，但仍需要限定材料种类和测试条件。'
            };
        },

        _resizeCanvas() {
            const rect = this.canvas.getBoundingClientRect();
            const width = rect.width || this.canvas.offsetWidth || 720;
            const height = rect.height || this.canvas.offsetHeight || 560;
            const dpr = window.devicePixelRatio || 1;
            if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
                this.canvas.width = Math.round(width * dpr);
                this.canvas.height = Math.round(height * dpr);
                this.canvas.style.width = `${width}px`;
                this.canvas.style.height = `${height}px`;
                this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            }
        },

        _cubePoints(x, y, s) {
            return [
                { x, y },
                { x: x + s, y },
                { x: x + s, y: y + s },
                { x, y: y + s }
            ];
        },

        _drawCubeEdges(ctx, front, back) {
            [front, back].forEach(points => {
                ctx.beginPath();
                ctx.moveTo(points[0].x, points[0].y);
                points.slice(1).forEach(point => ctx.lineTo(point.x, point.y));
                ctx.closePath();
                ctx.stroke();
            });
            for (let i = 0; i < 4; i += 1) {
                ctx.beginPath();
                ctx.moveTo(front[i].x, front[i].y);
                ctx.lineTo(back[i].x, back[i].y);
                ctx.stroke();
            }
        },

        _drawAtom(ctx, x, y, r, color) {
            const gradient = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.15, x, y, r);
            gradient.addColorStop(0, 'rgba(255,255,255,0.96)');
            gradient.addColorStop(0.36, color);
            gradient.addColorStop(1, 'rgba(16,18,25,0.76)');
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fillStyle = gradient;
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.16)';
            ctx.lineWidth = 1;
            ctx.stroke();
        },

        _mid(...points) {
            return {
                x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
                y: points.reduce((sum, point) => sum + point.y, 0) / points.length
            };
        },

        _grainSeeds(count, area) {
            let seed = 92821 + Math.round(this.grainSize * 13) + this.cellId.charCodeAt(0);
            const random = () => {
                seed = (seed * 1664525 + 1013904223) >>> 0;
                return seed / 4294967296;
            };
            const seeds = [];
            for (let i = 0; i < count; i += 1) {
                seeds.push({
                    x: area.x + random() * area.w,
                    y: area.y + random() * area.h,
                    index: i
                });
            }
            return seeds;
        },

        _nearestSeed(x, y, seeds) {
            let best = seeds[0];
            let bestD = Infinity;
            seeds.forEach(seed => {
                const dx = seed.x - x;
                const dy = seed.y - y;
                const d = dx * dx + dy * dy;
                if (d < bestD) {
                    bestD = d;
                    best = seed;
                }
            });
            return best;
        },

        _rgba(hex, alpha) {
            const value = hex.replace('#', '');
            const r = parseInt(value.slice(0, 2), 16);
            const g = parseInt(value.slice(2, 4), 16);
            const b = parseInt(value.slice(4, 6), 16);
            return `rgba(${r},${g},${b},${alpha})`;
        },

        _roundRect(ctx, x, y, w, h, r) {
            if (w <= 0 || h <= 0) return;
            const radius = Math.max(0, Math.min(r, w / 2, h / 2));
            ctx.beginPath();
            ctx.moveTo(x + radius, y);
            ctx.arcTo(x + w, y, x + w, y + h, radius);
            ctx.arcTo(x + w, y + h, x, y + h, radius);
            ctx.arcTo(x, y + h, x, y, radius);
            ctx.arcTo(x, y, x + w, y, radius);
            ctx.closePath();
        },

        _map(value, minA, maxA, minB, maxB) {
            const t = Math.max(0, Math.min(1, (value - minA) / (maxA - minA)));
            return minB + (maxB - minB) * t;
        },

        _escapeHtml(value) {
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        },

        _fontDisplay() {
            return '"Noto Sans SC", "Microsoft YaHei UI", system-ui, sans-serif';
        },

        _fontMono() {
            return 'Consolas, "SFMono-Regular", "Liberation Mono", monospace';
        }
    };

    window.MaterialsLab = MaterialsLab;
    window.initMaterialsLab = () => MaterialsLab.init();
    window.destroyMaterialsLab = () => MaterialsLab.destroy();
})();
