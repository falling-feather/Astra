// ===== Information Technology: Network Layers Lab =====

(function () {
    const SCENARIOS = {
        web: {
            label: '网页请求',
            domain: 'astra.example',
            ip: '2001:db8::42',
            payload: 1800,
            message: 'HTTP/2 HEADERS + DATA'
        },
        media: {
            label: '视频片段',
            domain: 'media.example',
            ip: '2001:db8::86',
            payload: 4200,
            message: 'video chunk'
        },
        form: {
            label: '表单提交',
            domain: 'api.example',
            ip: '2001:db8::18',
            payload: 900,
            message: 'HTTP/2 POST /answer'
        },
        sync: {
            label: '同步消息',
            domain: 'sync.example',
            ip: '2001:db8::27',
            payload: 600,
            message: 'state update'
        }
    };

    const TCP_HEADER_BYTES = 20;
    const IPV6_HEADER_BYTES = 40;
    const IPV6_MIN_LINK_MTU = 1280;
    const TEACHING_MSS = 1200;

    const NetworkLayersLab = {
        canvas: null,
        ctx: null,
        payloadInput: null,
        hopsInput: null,
        payloadValue: null,
        hopsValue: null,
        infoRoot: null,
        presetButtons: [],
        faultButtons: [],
        dpr: 1,
        scenarioId: 'web',
        state: {
            payload: 1800,
            hops: 4,
            faultNode: 'none'
        },
        tick: 0,
        rafId: 0,
        reducedMotion: false,
        motionQuery: null,
        onMotionChange: null,

        init() {
            this.canvas = document.getElementById('network-layers-canvas');
            if (!this.canvas) return;
            this.ctx = typeof this.canvas.getContext === 'function'
                ? this.canvas.getContext('2d')
                : null;
            this.payloadInput = document.getElementById('network-payload');
            this.hopsInput = document.getElementById('network-hops');
            this.payloadValue = document.getElementById('network-payload-value');
            this.hopsValue = document.getElementById('network-hops-value');
            this.infoRoot = document.getElementById('network-info');
            this.presetButtons = Array.from(document.querySelectorAll('[data-network-scenario]'));
            this.faultButtons = Array.from(document.querySelectorAll('[data-network-fault]'));
            this.motionQuery = typeof window.matchMedia === 'function'
                ? window.matchMedia('(prefers-reduced-motion: reduce)')
                : null;
            this.reducedMotion = Boolean(this.motionQuery && this.motionQuery.matches);
            this.onMotionChange = (event) => {
                this.reducedMotion = Boolean(event.matches);
                if (this.reducedMotion && this.rafId) cancelAnimationFrame(this.rafId);
                this.rafId = 0;
                this.render();
                if (!this.reducedMotion) this._startLoop();
            };
            if (this.motionQuery) this.motionQuery.addEventListener('change', this.onMotionChange);

            this._bindInputs();
            window.addEventListener('resize', this._boundResize || (this._boundResize = () => this.render()));
            this.render();
            if (!this.reducedMotion) this._startLoop();
        },

        destroy() {
            if (this.rafId) cancelAnimationFrame(this.rafId);
            this.rafId = 0;
            if (this._boundResize) window.removeEventListener('resize', this._boundResize);
            if (this.motionQuery && this.onMotionChange) this.motionQuery.removeEventListener('change', this.onMotionChange);
            this.motionQuery = null;
            this.onMotionChange = null;
        },

        render() {
            this._syncControls();
            const model = this._calculate();
            if (this.canvas && this.ctx) {
                this._resizeCanvas();
                this._draw(model);
            }
            this._updateInfo(model);
        },

        _bindInputs() {
            if (this.payloadInput && !this.payloadInput.dataset.bound) {
                this.payloadInput.dataset.bound = 'true';
                this.payloadInput.addEventListener('input', () => {
                    this.state.payload = Number(this.payloadInput.value) || SCENARIOS[this.scenarioId].payload;
                    this.render();
                });
            }
            if (this.hopsInput && !this.hopsInput.dataset.bound) {
                this.hopsInput.dataset.bound = 'true';
                this.hopsInput.addEventListener('input', () => {
                    this.state.hops = Number(this.hopsInput.value) || 4;
                    this.render();
                });
            }
            this.presetButtons.forEach(button => {
                if (button.dataset.bound) return;
                button.dataset.bound = 'true';
                button.addEventListener('click', () => {
                    this.scenarioId = button.dataset.networkScenario || 'web';
                    this.state.payload = SCENARIOS[this.scenarioId].payload;
                    this.render();
                });
            });
            this.faultButtons.forEach(button => {
                if (button.dataset.bound) return;
                button.dataset.bound = 'true';
                button.addEventListener('click', () => {
                    this.state.faultNode = button.dataset.networkFault || 'none';
                    this.render();
                });
            });
        },

        _calculate() {
            const scenario = SCENARIOS[this.scenarioId];
            const payload = Math.max(300, Number(this.state.payload) || scenario.payload);
            const hops = Math.max(2, Math.min(8, Math.round(Number(this.state.hops) || 4)));
            const segments = Math.max(1, Math.ceil(payload / TEACHING_MSS));
            const transportBytes = segments * TCP_HEADER_BYTES;
            const internetBytes = segments * IPV6_HEADER_BYTES;
            const transmittedPerPath = payload + transportBytes + internetBytes;
            const ipv6TcpPayloadBudget = IPV6_MIN_LINK_MTU - IPV6_HEADER_BYTES - TCP_HEADER_BYTES;
            const faultIndexByNode = {
                none: -1,
                access: 1,
                transit: Math.max(1, Math.floor(hops / 2)),
                edge: Math.max(1, hops - 1)
            };
            const faultIndex = Math.min(hops - 1, faultIndexByNode[this.state.faultNode] ?? -1);
            return {
                scenario,
                payload,
                hops,
                segments,
                transportBytes,
                internetBytes,
                transmittedPerPath,
                ipv6TcpPayloadBudget,
                pathBytes: transmittedPerPath * hops,
                fault: {
                    node: this.state.faultNode,
                    index: faultIndex,
                    active: faultIndex >= 1
                }
            };
        },

        _syncControls() {
            const scenario = SCENARIOS[this.scenarioId];
            if (this.payloadInput && Number(this.payloadInput.value) !== this.state.payload) {
                this.payloadInput.value = this.state.payload;
            }
            if (this.hopsInput && Number(this.hopsInput.value) !== this.state.hops) {
                this.hopsInput.value = this.state.hops;
            }
            if (this.payloadValue) this.payloadValue.textContent = `${Math.round(this.state.payload || scenario.payload)} B`;
            if (this.hopsValue) this.hopsValue.textContent = `${Math.round(this.state.hops)} 跳`;
            this.presetButtons.forEach(button => {
                const active = button.dataset.networkScenario === this.scenarioId;
                button.classList.toggle('is-active', active);
                button.setAttribute('aria-pressed', active ? 'true' : 'false');
            });
            this.faultButtons.forEach(button => {
                const active = button.dataset.networkFault === this.state.faultNode;
                button.classList.toggle('is-active', active);
                button.setAttribute('aria-pressed', active ? 'true' : 'false');
            });
        },

        _resizeCanvas() {
            const rect = this.canvas.getBoundingClientRect();
            const width = Math.max(320, Math.floor(rect.width || this.canvas.parentElement.offsetWidth || 760));
            const height = Math.max(360, Math.floor(rect.height || this.canvas.parentElement.offsetHeight || 540));
            const dpr = Math.min(window.devicePixelRatio || 1, this.reducedMotion ? 1 : 1.5);
            if (this.canvas.width !== Math.floor(width * dpr) || this.canvas.height !== Math.floor(height * dpr)) {
                this.canvas.width = Math.floor(width * dpr);
                this.canvas.height = Math.floor(height * dpr);
                this.canvas.style.width = `${width}px`;
                this.canvas.style.height = `${height}px`;
                this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                this.dpr = dpr;
            }
        },

        _startLoop() {
            if (!this.ctx || this.reducedMotion) return;
            if (this.rafId) cancelAnimationFrame(this.rafId);
            const loop = () => {
                this.tick += 0.018;
                this._draw(this._calculate());
                this.rafId = requestAnimationFrame(loop);
            };
            this.rafId = requestAnimationFrame(loop);
        },

        _draw(model) {
            const ctx = this.ctx;
            const w = this.canvas.clientWidth;
            const h = this.canvas.clientHeight;
            ctx.clearRect(0, 0, w, h);

            const compact = w < 720;
            const stack = compact
                ? { x: 28, y: 30, w: w - 56, h: Math.min(178, h * 0.36) }
                : { x: 42, y: 44, w: Math.min(330, w * 0.42), h: h - 88 };
            const route = compact
                ? { x: 28, y: stack.y + stack.h + 30, w: w - 56, h: h - stack.y - stack.h - 58 }
                : { x: stack.x + stack.w + 46, y: 44, w: w - stack.x - stack.w - 88, h: h - 88 };

            this._drawEncapsulation(ctx, stack, model, compact);
            this._drawRoute(ctx, route, model, compact);
        },

        _drawEncapsulation(ctx, area, model, compact) {
            const layers = [
                { name: '应用/HTTP', detail: `${model.scenario.message} · ${model.payload} B`, color: 'rgba(238,241,248,0.12)' },
                { name: 'TCP 段', detail: `${model.segments} 段 · 头部约 ${model.transportBytes} B`, color: 'rgba(94,224,216,0.18)' },
                { name: 'IPv6 包', detail: `源/目的地址 · 头部约 ${model.internetBytes} B`, color: 'rgba(138,167,255,0.18)' },
                { name: '链路帧', detail: `${model.hops} 跳中逐跳重新封装`, color: 'rgba(242,200,107,0.16)' }
            ];
            const gap = compact ? 8 : 14;
            const rowH = (area.h - gap * (layers.length - 1)) / layers.length;

            ctx.save();
            ctx.fillStyle = 'rgba(238,241,248,0.78)';
            ctx.font = `600 14px ${typeof CF !== 'undefined' ? CF.sans : 'sans-serif'}`;
            ctx.fillText('封装顺序', area.x, area.y - 14);

            layers.forEach((layer, index) => {
                const x = area.x + index * (compact ? 5 : 10);
                const y = area.y + index * (rowH + gap);
                const width = area.w - index * (compact ? 10 : 20);
                this._roundRect(ctx, x, y, width, rowH, 8);
                ctx.fillStyle = layer.color;
                ctx.fill();
                ctx.strokeStyle = index === 0 ? 'rgba(238,241,248,0.22)' : 'rgba(94,224,216,0.22)';
                ctx.lineWidth = 1;
                ctx.stroke();

                ctx.fillStyle = 'rgba(238,241,248,0.9)';
                ctx.font = `600 ${compact ? 13 : 15}px ${typeof CF !== 'undefined' ? CF.sans : 'sans-serif'}`;
                ctx.fillText(layer.name, x + 16, y + rowH * 0.43);
                ctx.fillStyle = 'rgba(183,190,206,0.82)';
                ctx.font = `${compact ? 11 : 12}px ${typeof CF !== 'undefined' ? CF.sans : 'sans-serif'}`;
                ctx.fillText(layer.detail, x + 16, y + rowH * 0.72);
            });
            ctx.restore();
        },

        _drawRoute(ctx, area, model, compact) {
            const labels = this._routeLabels(model.hops);
            const points = labels.map((label, index) => {
                const ratio = labels.length === 1 ? 0 : index / (labels.length - 1);
                return {
                    label,
                    x: area.x + ratio * area.w,
                    y: area.y + area.h * (0.42 + Math.sin(ratio * Math.PI) * 0.18)
                };
            });

            ctx.save();
            ctx.fillStyle = 'rgba(238,241,248,0.78)';
            ctx.font = `600 14px ${typeof CF !== 'undefined' ? CF.sans : 'sans-serif'}`;
            ctx.fillText(`${model.scenario.domain} → ${model.scenario.ip}`, area.x, area.y + 4);

            ctx.strokeStyle = 'rgba(94,224,216,0.22)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            points.forEach((point, index) => {
                if (index === 0) ctx.moveTo(point.x, point.y);
                else ctx.lineTo(point.x, point.y);
            });
            ctx.stroke();

            const progress = (this.tick % 1);
            const limit = model.fault.active ? Math.min(points.length - 2, model.fault.index) : points.length - 2;
            const packetIndex = model.fault.active
                ? Math.max(0, limit - 1)
                : Math.min(limit, Math.floor(progress * (points.length - 1)));
            const local = model.fault.active ? 1 : progress * (points.length - 1) - packetIndex;
            const a = points[packetIndex];
            const b = points[packetIndex + 1];
            const px = a.x + (b.x - a.x) * local;
            const py = a.y + (b.y - a.y) * local;

            points.forEach((point, index) => {
                const radius = index === 0 || index === points.length - 1 ? 12 : 9;
                ctx.beginPath();
                ctx.arc(point.x, point.y, radius + 5, 0, Math.PI * 2);
                ctx.fillStyle = index === 0 || index === points.length - 1
                    ? 'rgba(94,224,216,0.14)'
                    : 'rgba(242,200,107,0.11)';
                ctx.fill();
                ctx.beginPath();
                ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
                ctx.fillStyle = index === model.fault.index
                    ? 'rgba(225,106,92,0.92)'
                    : index === 0 || index === points.length - 1
                    ? 'rgba(94,224,216,0.82)'
                    : 'rgba(242,200,107,0.72)';
                ctx.fill();
                ctx.fillStyle = 'rgba(238,241,248,0.82)';
                ctx.font = `${compact ? 10 : 11}px ${typeof CF !== 'undefined' ? CF.sans : 'sans-serif'}`;
                ctx.textAlign = 'center';
                ctx.fillText(point.label, point.x, point.y + radius + 18);
            });

            if (model.fault.active) {
                const failed = points[model.fault.index];
                ctx.strokeStyle = 'rgba(225,106,92,0.95)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(failed.x - 12, failed.y - 12);
                ctx.lineTo(failed.x + 12, failed.y + 12);
                ctx.moveTo(failed.x + 12, failed.y - 12);
                ctx.lineTo(failed.x - 12, failed.y + 12);
                ctx.stroke();
            }

            this._roundRect(ctx, px - 20, py - 12, 40, 24, 7);
            ctx.fillStyle = 'rgba(94,224,216,0.88)';
            ctx.fill();
            ctx.fillStyle = 'rgba(8,9,14,0.9)';
            ctx.font = `700 11px ${typeof CF !== 'undefined' ? CF.mono : 'monospace'}`;
            ctx.textAlign = 'center';
            ctx.fillText('PKT', px, py + 4);

            const summaryY = area.y + area.h - 58;
            ctx.textAlign = 'left';
            ctx.fillStyle = 'rgba(183,190,206,0.85)';
            ctx.font = `${compact ? 11 : 12}px ${typeof CF !== 'undefined' ? CF.sans : 'sans-serif'}`;
            ctx.fillText(`教学近似：HTTP/2 帧进入 TCP 字节流；IPv6 最小链路 MTU ${IPV6_MIN_LINK_MTU} B。`, area.x, summaryY);
            ctx.fillText(`TCP 最小头部 20 B，IPv6 固定头部 40 B；本次逐跳观察量约 ${model.pathBytes} B。`, area.x, summaryY + 20);
            ctx.restore();
        },

        _routeLabels(hops) {
            const middle = ['家庭路由', '接入网', '运营商', '骨干网', '交换中心', '边缘节点', '机房交换'];
            return ['浏览器', ...middle.slice(0, Math.max(0, hops - 1)), '服务器'];
        },

        _updateInfo(model) {
            if (!this.infoRoot) return;
            const faultLabel = model.fault.active
                ? `${this._routeLabels(model.hops)[model.fault.index]} 节点使数据包停止`
                : '未设置路径故障';
            this.infoRoot.innerHTML = `
                <div class="network-panel">
                    <span class="network-panel__label">故障追踪</span>
                    <strong>${this._escapeHtml(faultLabel)}</strong>
                    <p>红色叉号节点与停下的数据包用于观察路径中断，不代表真实网络诊断结论。</p>
                </div>
                <div class="network-panel">
                    <span class="network-panel__label">DNS</span>
                    <strong>${this._escapeHtml(model.scenario.domain)} → ${this._escapeHtml(model.scenario.ip)}</strong>
                    <p>浏览器或系统缓存没有答案时，解析器会向名称服务器查询记录，把人可读域名映射到地址。</p>
                </div>
                <div class="network-panel">
                    <span class="network-panel__label">TCP</span>
                    <strong>${model.segments} 个段 · ${model.transportBytes} B 头部</strong>
                    <p>TCP 面向可靠、有序字节流；这里按 ${TEACHING_MSS} B 教学分段，真实 MSS 会受 TCP 选项与路径 MTU 影响。</p>
                </div>
                <div class="network-panel">
                    <span class="network-panel__label">IPv6</span>
                    <strong>${model.internetBytes} B IPv6 头部</strong>
                    <p>IPv6 固定头部按 40 B 计算；链路 MTU 至少 1280 B，Hop Limit 随逐跳转发递减。</p>
                </div>
                <div class="network-panel">
                    <span class="network-panel__label">逐跳转发</span>
                    <strong>${model.hops} 跳路径</strong>
                    <p>路由器按目标地址选择下一跳；链路帧会在每一跳重新封装，因此逐跳字节量只是观察估算。</p>
                </div>
            `;
        },

        _roundRect(ctx, x, y, w, h, r) {
            const radius = Math.min(r, w / 2, h / 2);
            ctx.beginPath();
            ctx.moveTo(x + radius, y);
            ctx.lineTo(x + w - radius, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
            ctx.lineTo(x + w, y + h - radius);
            ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
            ctx.lineTo(x + radius, y + h);
            ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
            ctx.lineTo(x, y + radius);
            ctx.quadraticCurveTo(x, y, x + radius, y);
            ctx.closePath();
        },

        _escapeHtml(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }
    };

    window.NetworkLayersLab = NetworkLayersLab;
    window.initNetworkLayersLab = function () { NetworkLayersLab.init(); };
    window.destroyNetworkLayersLab = function () { NetworkLayersLab.destroy(); };
})();
