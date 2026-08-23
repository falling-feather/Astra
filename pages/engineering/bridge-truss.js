// ===== Engineering Applications: Bridge Truss Lab =====

(function () {
    const BridgeTruss = {
        canvas: null,
        ctx: null,
        loadInput: null,
        loadValue: null,
        positionButtons: [],
        infoRoot: null,
        rafId: 0,
        dpr: 1,
        state: {
            load: 60,
            loadJoint: 'C'
        },
        joints: [
            { id: 'A', x: 0, y: 0 },
            { id: 'B', x: 1, y: 0 },
            { id: 'C', x: 2, y: 0 },
            { id: 'D', x: 3, y: 0 },
            { id: 'E', x: 4, y: 0 },
            { id: 'F', x: 0.5, y: 1 },
            { id: 'G', x: 1.5, y: 1 },
            { id: 'H', x: 2.5, y: 1 },
            { id: 'I', x: 3.5, y: 1 }
        ],
        members: [
            ['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'E'],
            ['F', 'G'], ['G', 'H'], ['H', 'I'],
            ['A', 'F'], ['F', 'B'], ['B', 'G'], ['G', 'C'],
            ['C', 'H'], ['H', 'D'], ['D', 'I'], ['I', 'E']
        ],

        init() {
            this.canvas = document.getElementById('bridge-truss-canvas');
            if (!this.canvas) return;
            this.ctx = typeof this.canvas.getContext === 'function'
                ? this.canvas.getContext('2d')
                : null;
            this.loadInput = document.getElementById('truss-load');
            this.loadValue = document.getElementById('truss-load-value');
            this.positionButtons = Array.from(document.querySelectorAll('[data-truss-joint]'));
            this.infoRoot = document.getElementById('truss-info');

            if (this.loadInput && !this.loadInput.dataset.bound) {
                this.loadInput.dataset.bound = 'true';
                this.loadInput.addEventListener('input', () => {
                    this.state.load = Number(this.loadInput.value) || 60;
                    this.render();
                });
            }

            this.positionButtons.forEach(button => {
                if (button.dataset.bound) return;
                button.dataset.bound = 'true';
                button.addEventListener('click', () => {
                    this.state.loadJoint = button.dataset.trussJoint || 'C';
                    this.render();
                });
            });

            window.addEventListener('resize', this._boundResize || (this._boundResize = () => this.render()));
            this.render();
        },

        destroy() {
            if (this.rafId) cancelAnimationFrame(this.rafId);
            this.rafId = 0;
            if (this._boundResize) window.removeEventListener('resize', this._boundResize);
        },

        render() {
            if (this.loadInput) this.loadInput.value = String(this.state.load);
            if (this.loadValue) this.loadValue.textContent = `${this.state.load} kN`;
            this.positionButtons.forEach(button => {
                const active = button.dataset.trussJoint === this.state.loadJoint;
                button.classList.toggle('is-active', active);
                button.setAttribute('aria-pressed', active ? 'true' : 'false');
            });

            const result = this.solve();
            if (this.canvas && this.ctx) {
                this._resizeCanvas();
                this.draw(result);
            }
            this.updateInfo(result);
        },

        solve() {
            const jointIndex = new Map(this.joints.map((joint, index) => [joint.id, index]));
            const unknowns = this.members.map(pair => pair.join(''));
            unknowns.push('Ax', 'Ay', 'Ey');

            const n = unknowns.length;
            const rows = [];
            const rhs = [];
            const external = {};
            this.joints.forEach(joint => { external[joint.id] = { x: 0, y: 0 }; });
            external[this.state.loadJoint].y -= this.state.load;

            this.joints.forEach(joint => {
                const rowX = Array(n).fill(0);
                const rowY = Array(n).fill(0);

                this.members.forEach((pair, memberIndex) => {
                    const [fromId, toId] = pair;
                    if (joint.id !== fromId && joint.id !== toId) return;
                    const from = this.joints[jointIndex.get(fromId)];
                    const to = this.joints[jointIndex.get(toId)];
                    const dx = to.x - from.x;
                    const dy = to.y - from.y;
                    const len = Math.hypot(dx, dy) || 1;
                    const sign = joint.id === fromId ? 1 : -1;
                    rowX[memberIndex] = sign * dx / len;
                    rowY[memberIndex] = sign * dy / len;
                });

                if (joint.id === 'A') {
                    rowX[unknowns.indexOf('Ax')] = 1;
                    rowY[unknowns.indexOf('Ay')] = 1;
                }
                if (joint.id === 'E') {
                    rowY[unknowns.indexOf('Ey')] = 1;
                }

                rows.push(rowX);
                rhs.push(-external[joint.id].x);
                rows.push(rowY);
                rhs.push(-external[joint.id].y);
            });

            const values = this._solveLinearSystem(rows, rhs);
            const byName = {};
            unknowns.forEach((name, index) => { byName[name] = values[index] || 0; });

            const memberForces = this.members.map(pair => {
                const name = pair.join('');
                const force = byName[name] || 0;
                return {
                    name,
                    from: pair[0],
                    to: pair[1],
                    force,
                    type: Math.abs(force) < 0.01 ? 'zero' : force > 0 ? 'tension' : 'compression'
                };
            });

            const maxForce = Math.max(1, ...memberForces.map(item => Math.abs(item.force)));
            const critical = memberForces.reduce((best, item) => (
                Math.abs(item.force) > Math.abs(best.force) ? item : best
            ), memberForces[0]);

            return {
                memberForces,
                reactions: {
                    Ax: byName.Ax || 0,
                    Ay: byName.Ay || 0,
                    Ey: byName.Ey || 0
                },
                maxForce,
                critical
            };
        },

        draw(result) {
            const ctx = this.ctx;
            const w = this.canvas.clientWidth;
            const h = this.canvas.clientHeight;
            ctx.clearRect(0, 0, w, h);

            const padX = Math.max(36, w * 0.08);
            const top = Math.max(76, h * 0.16);
            const deckY = h * 0.66;
            const span = w - padX * 2;
            const height = Math.max(96, Math.min(170, h * 0.28));
            const toScreen = joint => ({
                x: padX + (joint.x / 4) * span,
                y: deckY - joint.y * height
            });
            const joints = new Map(this.joints.map(joint => [joint.id, { ...joint, ...toScreen(joint) }]));

            this._drawGrid(ctx, w, h, deckY, padX, span);
            this._drawSupports(ctx, joints);
            this._drawLoad(ctx, joints.get(this.state.loadJoint), this.state.load);
            this._drawReactions(ctx, joints, result.reactions);

            result.memberForces.forEach(member => {
                const a = joints.get(member.from);
                const b = joints.get(member.to);
                const ratio = Math.abs(member.force) / result.maxForce;
                const width = 2 + ratio * 7;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.lineWidth = width;
                ctx.lineCap = 'round';
                ctx.strokeStyle = member.type === 'tension'
                    ? `rgba(79,168,163,${0.46 + ratio * 0.5})`
                    : member.type === 'compression'
                    ? `rgba(216,163,72,${0.46 + ratio * 0.5})`
                    : 'rgba(138,144,160,0.38)';
                ctx.stroke();
            });

            result.memberForces.forEach(member => {
                const a = joints.get(member.from);
                const b = joints.get(member.to);
                const mx = (a.x + b.x) / 2;
                const my = (a.y + b.y) / 2;
                if (Math.abs(member.force) < result.maxForce * 0.18) return;
                this._label(ctx, mx, my, `${Math.abs(member.force).toFixed(0)} kN`, member.type);
            });

            joints.forEach(joint => {
                ctx.beginPath();
                ctx.arc(joint.x, joint.y, 5, 0, Math.PI * 2);
                ctx.fillStyle = '#d8dce6';
                ctx.fill();
                ctx.strokeStyle = 'rgba(8,9,14,0.7)';
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.fillStyle = 'rgba(216,220,230,0.72)';
                ctx.font = `12px ${this._fontMono()}`;
                ctx.textAlign = 'center';
                ctx.fillText(joint.id, joint.x, joint.y + 21);
            });

            this._drawLegend(ctx, w, top);
        },

        updateInfo(result) {
            if (!this.infoRoot) return;
            const critical = result.critical || { name: '-', force: 0, type: 'zero' };
            const typeLabel = critical.type === 'tension' ? '受拉' : critical.type === 'compression' ? '受压' : '近似零力';
            const left = result.reactions.Ay.toFixed(1);
            const right = result.reactions.Ey.toFixed(1);
            const loadJoint = this.state.loadJoint;
            const nearZero = result.memberForces
                .filter(member => Math.abs(member.force) < Math.max(1, result.maxForce * 0.04))
                .map(member => member.name);
            const zeroText = nearZero.length
                ? `${nearZero.slice(0, 3).join('、')}${nearZero.length > 3 ? ' 等' : ''}`
                : '当前工况不明显';
            this.infoRoot.innerHTML = `
                <div class="truss-panel">
                    <span class="truss-panel__label">支座反力</span>
                    <strong>A_y ${left} kN / E_y ${right} kN</strong>
                    <p>整体平衡先满足 ΣFy = 0 与 ΣM = 0；荷载越靠近一侧，该侧反力通常越大。</p>
                </div>
                <div class="truss-panel">
                    <span class="truss-panel__label">最大杆力</span>
                    <strong>${critical.name} · ${Math.abs(critical.force).toFixed(1)} kN · ${typeLabel}</strong>
                    <p>未知杆力先按受拉建立；计算方向相反时显示为受压，线宽随轴力大小变化。</p>
                </div>
                <div class="truss-panel">
                    <span class="truss-panel__label">当前荷载</span>
                    <strong>${this.state.load} kN 作用于 ${loadJoint} 节点</strong>
                    <p>节点法在每个铰接点列 ΣFx = 0、ΣFy = 0，因此本页只把荷载施加在节点上。</p>
                </div>
                <div class="truss-panel">
                    <span class="truss-panel__label">近零杆件</span>
                    <strong>${zeroText}</strong>
                    <p>近零只针对当前荷载位置；真实桥梁的移动荷载、风载和自重可能让这些杆件重新受力。</p>
                </div>
            `;
        },

        _resizeCanvas() {
            const rect = this.canvas.getBoundingClientRect();
            const w = Math.max(320, rect.width || this.canvas.offsetWidth || 640);
            const h = Math.max(360, rect.height || this.canvas.offsetHeight || 520);
            this.dpr = window.devicePixelRatio || 1;
            const targetW = Math.round(w * this.dpr);
            const targetH = Math.round(h * this.dpr);
            if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
                this.canvas.width = targetW;
                this.canvas.height = targetH;
                this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
            }
        },

        _solveLinearSystem(matrix, vector) {
            const n = vector.length;
            const a = matrix.map((row, i) => row.slice().concat(vector[i]));

            for (let col = 0; col < n; col += 1) {
                let pivot = col;
                for (let row = col + 1; row < n; row += 1) {
                    if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
                }
                if (Math.abs(a[pivot][col]) < 1e-9) continue;
                if (pivot !== col) [a[pivot], a[col]] = [a[col], a[pivot]];

                const div = a[col][col];
                for (let k = col; k <= n; k += 1) a[col][k] /= div;

                for (let row = 0; row < n; row += 1) {
                    if (row === col) continue;
                    const factor = a[row][col];
                    if (Math.abs(factor) < 1e-12) continue;
                    for (let k = col; k <= n; k += 1) {
                        a[row][k] -= factor * a[col][k];
                    }
                }
            }
            return a.map(row => row[n]);
        },

        _drawGrid(ctx, w, h, deckY, padX, span) {
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.045)';
            ctx.lineWidth = 1;
            for (let i = 0; i <= 4; i += 1) {
                const x = padX + (i / 4) * span;
                ctx.beginPath();
                ctx.moveTo(x, deckY + 42);
                ctx.lineTo(x, Math.max(40, deckY - 220));
                ctx.stroke();
            }
            ctx.beginPath();
            ctx.moveTo(padX - 24, deckY + 34);
            ctx.lineTo(w - padX + 24, deckY + 34);
            ctx.strokeStyle = 'rgba(216,163,72,0.18)';
            ctx.stroke();
            ctx.fillStyle = 'rgba(138,144,160,0.72)';
            ctx.font = `12px ${this._fontMono()}`;
            ctx.textAlign = 'left';
            ctx.fillText('理想 Warren 桁架：整体平衡 + 节点平衡', padX, 34);
            ctx.restore();
        },

        _drawSupports(ctx, joints) {
            const a = joints.get('A');
            const e = joints.get('E');
            ctx.save();
            ctx.fillStyle = 'rgba(138,144,160,0.5)';
            this._triangle(ctx, a.x, a.y + 25, 34, 26);
            ctx.fill();
            ctx.beginPath();
            ctx.rect(e.x - 18, e.y + 20, 36, 10);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(e.x - 10, e.y + 36, 4, 0, Math.PI * 2);
            ctx.arc(e.x + 10, e.y + 36, 4, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(216,220,230,0.45)';
            ctx.fill();
            ctx.restore();
        },

        _drawLoad(ctx, joint, load) {
            if (!joint) return;
            ctx.save();
            const len = 48 + load * 0.25;
            ctx.strokeStyle = 'rgba(184,84,80,0.95)';
            ctx.fillStyle = 'rgba(184,84,80,0.95)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(joint.x, joint.y - len - 16);
            ctx.lineTo(joint.x, joint.y - 12);
            ctx.stroke();
            this._arrowHead(ctx, joint.x, joint.y - 12, Math.PI / 2, 9);
            ctx.fill();
            this._label(ctx, joint.x, joint.y - len - 26, `${load} kN`, 'load');
            ctx.restore();
        },

        _drawReactions(ctx, joints, reactions) {
            const a = joints.get('A');
            const e = joints.get('E');
            ctx.save();
            ctx.strokeStyle = 'rgba(91,141,206,0.85)';
            ctx.fillStyle = 'rgba(91,141,206,0.85)';
            ctx.lineWidth = 2.5;
            [[a, reactions.Ay], [e, reactions.Ey]].forEach(([joint, value]) => {
                const len = 30 + Math.abs(value) * 0.34;
                ctx.beginPath();
                ctx.moveTo(joint.x, joint.y + 52);
                ctx.lineTo(joint.x, joint.y + 52 - len);
                ctx.stroke();
                this._arrowHead(ctx, joint.x, joint.y + 52 - len, -Math.PI / 2, 8);
                ctx.fill();
                this._label(ctx, joint.x, joint.y + 64, `${value.toFixed(0)} kN`, 'reaction');
            });
            ctx.restore();
        },

        _drawLegend(ctx, w, top) {
            const items = [
                ['受拉', 'rgba(79,168,163,0.9)'],
                ['受压', 'rgba(216,163,72,0.9)'],
                ['外荷载', 'rgba(184,84,80,0.9)'],
                ['支座反力', 'rgba(91,141,206,0.9)']
            ];
            ctx.save();
            ctx.font = `12px ${this._fontMono()}`;
            ctx.textAlign = 'right';
            let y = top;
            items.forEach(([label, color]) => {
                ctx.strokeStyle = color;
                ctx.lineWidth = 5;
                ctx.beginPath();
                ctx.moveTo(w - 118, y - 4);
                ctx.lineTo(w - 78, y - 4);
                ctx.stroke();
                ctx.fillStyle = 'rgba(216,220,230,0.72)';
                ctx.fillText(label, w - 28, y);
                y += 24;
            });
            ctx.restore();
        },

        _label(ctx, x, y, text, type) {
            const pad = 5;
            ctx.save();
            ctx.font = `12px ${this._fontMono()}`;
            const width = ctx.measureText(text).width + pad * 2;
            const bg = type === 'compression'
                ? 'rgba(216,163,72,0.16)'
                : type === 'tension'
                ? 'rgba(79,168,163,0.16)'
                : type === 'load'
                ? 'rgba(184,84,80,0.16)'
                : 'rgba(91,141,206,0.14)';
            ctx.fillStyle = bg;
            ctx.fillRect(x - width / 2, y - 12, width, 18);
            ctx.fillStyle = 'rgba(216,220,230,0.86)';
            ctx.textAlign = 'center';
            ctx.fillText(text, x, y + 1);
            ctx.restore();
        },

        _triangle(ctx, x, y, width, height) {
            ctx.beginPath();
            ctx.moveTo(x, y - height / 2);
            ctx.lineTo(x - width / 2, y + height / 2);
            ctx.lineTo(x + width / 2, y + height / 2);
            ctx.closePath();
        },

        _arrowHead(ctx, x, y, angle, size) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x - Math.cos(angle - Math.PI / 6) * size, y - Math.sin(angle - Math.PI / 6) * size);
            ctx.lineTo(x - Math.cos(angle + Math.PI / 6) * size, y - Math.sin(angle + Math.PI / 6) * size);
            ctx.closePath();
        },

        _fontMono() {
            if (window.CF && CF.mono) return CF.mono;
            return 'JetBrains Mono, Consolas, monospace';
        }
    };

    function initBridgeTruss() {
        BridgeTruss.init();
    }

    function destroyBridgeTruss() {
        BridgeTruss.destroy();
    }

    window.BridgeTruss = BridgeTruss;
    window.initBridgeTruss = initBridgeTruss;
    window.destroyBridgeTruss = destroyBridgeTruss;
})();
