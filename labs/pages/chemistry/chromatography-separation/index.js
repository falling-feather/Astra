(() => {
    'use strict';

    const DEFAULT_PARAMETER = 50;
    const DEFAULT_FLOW = 1.4;
    const HOLD_UP_VOLUME_ML = 10;
    const PLATE_NUMBER = 900;
    const MODEL_MINUTES_PER_SECOND = 3.2;
    const MAX_FRAME_SECONDS = 0.05;
    const COMPONENTS = Object.freeze([
        Object.freeze({ id: 'A', color: '#55e8ff', dark: '#187a9e' }),
        Object.freeze({ id: 'B', color: '#ffcb63', dark: '#b86d22' }),
        Object.freeze({ id: 'C', color: '#ff6ec7', dark: '#9c3c83' })
    ]);
    const PRESETS = Object.freeze({ overlap: 0, balanced: 50, resolved: 90 });

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const gaussian = (x, mean, sigma) => Math.exp(-0.5 * ((x - mean) / sigma) ** 2);

    const ChromatographySeparation = {
        root: null,
        canvas: null,
        context: null,
        readout: null,
        parameterControl: null,
        parameterOutput: null,
        toggleButton: null,
        stateOutput: null,
        notice: null,
        controls: null,
        resizeObserver: null,
        motionPreference: null,
        flowControl: null,
        flowOutput: null,
        holdUpOutput: null,
        resolutionOutput: null,
        nextPeakOutput: null,
        stageHint: null,
        frame: 0,
        lastTime: 0,
        lastStepSeconds: 0,
        parameter: DEFAULT_PARAMETER,
        flow: DEFAULT_FLOW,
        elapsed: 0,
        paused: false,
        reducedMotion: false,
        preset: 'balanced',
        scrubbing: false,
        scrubPointerId: null,

        init() {
            this.destroy();
            this.root = document.querySelector(
                '#page-chemistry [data-module="chromatography-separation"] .astra-exp--chromatography-separation'
            );
            if (!this.root) return false;

            this.canvas = this.root.querySelector('[data-role="canvas"]');
            this.readout = this.root.querySelector('[data-role="readout"]');
            this.parameterControl = this.root.querySelector('[data-control="parameter"]');
            this.parameterOutput = this.root.querySelector('[data-role="parameter-value"]');
            this.toggleButton = this.root.querySelector('[data-action="toggle"]');
            this.stateOutput = this.root.querySelector('[data-role="state"]');
            this.notice = this.root.querySelector('[data-role="notice"]');
            this.flowControl = this.root.querySelector('[data-control="flow"]');
            this.flowOutput = this.root.querySelector('[data-role="flow-value"]');
            this.holdUpOutput = this.root.querySelector('[data-role="hold-up-time"]');
            this.resolutionOutput = this.root.querySelector('[data-role="resolution"]');
            this.nextPeakOutput = this.root.querySelector('[data-role="next-peak"]');
            this.stageHint = this.root.querySelector('[data-role="stage-hint"]');

            if (
                !this.canvas
                || !this.readout
                || !this.parameterControl
                || !this.parameterOutput
                || !this.toggleButton
                || !this.stateOutput
                || !this.notice
                || !this.flowControl
                || !this.flowOutput
            ) {
                this.destroy();
                return false;
            }

            this.context = this.canvas.getContext('2d');
            if (!this.context) {
                this.destroy();
                return false;
            }

            this.controls = new AbortController();
            const signal = this.controls.signal;
            this.motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
            this.reducedMotion = Boolean(this.motionPreference.matches);

            this.parameterControl.addEventListener('input', (event) => {
                this.parameter = clamp(Number(event.target.value), 0, 100);
                this.preset = 'custom';
                this.elapsed = 0;
                this.syncUi('保留差已更新，三组分重新进样。');
                this.render();
            }, { signal });

            this.flowControl.addEventListener('input', (event) => {
                this.flow = clamp(Number(event.target.value), 0.8, 2);
                this.elapsed = 0;
                this.syncUi('流量已更新，时间轴与色带速度同步重算。');
                this.render();
            }, { signal });

            this.root.querySelectorAll('[data-preset]').forEach((button) => {
                button.addEventListener('click', () => this.applyPreset(button.dataset.preset), { signal });
            });

            this.toggleButton.addEventListener('click', () => {
                if (this.reducedMotion) return;
                this.paused = !this.paused;
                if (this.paused) {
                    this.lastStepSeconds = 0;
                    this.stopLoop();
                }
                this.syncUi();
                this.render();
                if (!this.paused && !this.frame) this.startLoop();
            }, { signal });

            this.root.querySelector('[data-action="reset"]')?.addEventListener('click', () => this.reset(), { signal });
            this.motionPreference.addEventListener?.('change', (event) => {
                this.reducedMotion = Boolean(event.matches);
                if (this.reducedMotion) {
                    this.lastStepSeconds = 0;
                    this.stopLoop();
                }
                this.syncUi();
                this.render();
                if (!this.reducedMotion && !this.paused) this.startLoop();
            }, { signal });

            this.canvas.addEventListener('pointerdown', (event) => this.beginScrub(event), { signal });
            this.canvas.addEventListener('pointermove', (event) => this.updateScrub(event), { signal });
            this.canvas.addEventListener('pointerup', (event) => this.endScrub(event), { signal });
            this.canvas.addEventListener('pointercancel', (event) => this.endScrub(event), { signal });

            this.resizeObserver = new ResizeObserver(() => this.resize());
            this.resizeObserver.observe(this.canvas.parentElement || this.canvas);
            this.resize();
            this.reset();
            return true;
        },

        retentionGap() {
            return 0.25 + 0.0075 * this.parameter;
        },

        model() {
            const gap = this.retentionGap();
            const holdUpTime = HOLD_UP_VOLUME_ML / this.flow;
            const retentionFactors = [0.6, 0.6 + gap, 0.6 + 2 * gap];
            const retentionTimes = retentionFactors.map((factor) => holdUpTime * (1 + factor));
            const sigmas = retentionTimes.map((retentionTime) => retentionTime / Math.sqrt(PLATE_NUMBER));
            const baselineWidths = sigmas.map((sigma) => 4 * sigma);
            const resolutions = [0, 1].map((index) => (
                2 * (retentionTimes[index + 1] - retentionTimes[index])
                / (baselineWidths[index] + baselineWidths[index + 1])
            ));
            const axisMaximum = Math.max(holdUpTime * 1.15, retentionTimes[2] + 3.8 * sigmas[2]);
            return {
                gap,
                holdUpTime,
                retentionFactors,
                retentionTimes,
                sigmas,
                baselineWidths,
                plateNumber: PLATE_NUMBER,
                resolutions,
                minimumResolution: Math.min(...resolutions),
                axisMaximum
            };
        },

        modelTime(model = this.model()) {
            if (this.reducedMotion && this.elapsed === 0) return model.retentionTimes[0] * 1.15;
            return (this.elapsed * MODEL_MINUTES_PER_SECOND) % model.axisMaximum;
        },

        applyPreset(name) {
            if (!Object.hasOwn(PRESETS, name)) return;
            this.parameter = PRESETS[name];
            this.parameterControl.value = String(this.parameter);
            this.preset = name;
            this.elapsed = 0;
            this.syncUi(`${name === 'overlap' ? '峰重叠' : (name === 'resolved' ? '高分离' : '均衡')}状态已载入。`);
            this.render();
        },

        reset() {
            this.parameter = DEFAULT_PARAMETER;
            this.flow = DEFAULT_FLOW;
            this.elapsed = 0;
            this.lastStepSeconds = 0;
            this.paused = false;
            this.preset = 'balanced';
            this.scrubbing = false;
            this.scrubPointerId = null;
            this.stopLoop();
            if (this.parameterControl) this.parameterControl.value = String(DEFAULT_PARAMETER);
            if (this.flowControl) this.flowControl.value = String(DEFAULT_FLOW);
            this.syncUi('三组分已进样，色带与检测曲线同步推进。');
            this.render();
            if (!this.reducedMotion) this.startLoop();
        },

        syncUi(message = '') {
            if (!this.root) return;
            const state = this.reducedMotion ? 'reduced-motion' : (this.paused ? 'paused' : 'running');
            const stateLabel = this.reducedMotion ? '静态对照' : (this.paused ? '已暂停' : '运行中');
            const model = this.model();
            const parameterLabel = `${this.parameter.toFixed(0)} · Δk ${model.gap.toFixed(3)}`;
            this.root.dataset.state = state;
            this.root.dataset.preset = this.preset;
            this.parameterOutput.value = parameterLabel;
            this.parameterOutput.textContent = parameterLabel;
            this.flowOutput.value = `${this.flow.toFixed(2)} mL/min`;
            this.flowOutput.textContent = `${this.flow.toFixed(2)} mL/min`;
            this.stateOutput.value = stateLabel;
            this.stateOutput.textContent = stateLabel;
            this.root.querySelectorAll('[data-preset]').forEach((button) => {
                button.setAttribute('aria-pressed', String(button.dataset.preset === this.preset));
            });
            this.toggleButton.disabled = this.reducedMotion;
            this.toggleButton.textContent = this.reducedMotion ? '静态模式' : (this.paused ? '继续扫描' : '暂停扫描');
            this.toggleButton.setAttribute('aria-pressed', String(this.paused || this.reducedMotion));
            const fallback = this.reducedMotion
                ? '已减少动态效果；调参仍会刷新色带与峰形。'
                : (this.paused ? '扫描已暂停，可拖动扫描线对照色带。' : '色带向检测端推进，检测曲线同步显现。');
            this.notice.textContent = message || fallback;
        },

        resize() {
            if (!this.canvas || !this.context) return;
            const parent = this.canvas.parentElement || this.canvas;
            const rect = parent.getBoundingClientRect();
            const width = Math.round(parent.clientWidth || rect.width || 0);
            const height = Math.round(parent.clientHeight || rect.height || 0);
            if (width <= 0 || height <= 0) return;
            const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
            this.canvas.width = Math.round(width * dpr);
            this.canvas.height = Math.round(height * dpr);
            this.canvas.style.width = `${width}px`;
            this.canvas.style.height = `${height}px`;
            this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
            this.render();
        },

        stopLoop() {
            if (this.frame) cancelAnimationFrame(this.frame);
            this.frame = 0;
        },

        startLoop() {
            if (this.frame || this.paused || this.reducedMotion) return;
            this.lastStepSeconds = 0;
            this.lastTime = performance.now();
            const tick = (now) => {
                this.frame = 0;
                if (!this.root || this.paused || this.reducedMotion || this.scrubbing) return;
                const dt = clamp((now - this.lastTime) / 1000, 0, MAX_FRAME_SECONDS);
                this.lastTime = now;
                this.lastStepSeconds = dt;
                this.elapsed += dt;
                this.render();
                this.frame = requestAnimationFrame(tick);
            };
            this.frame = requestAnimationFrame(tick);
        },

        layout() {
            if (!this.canvas) return { width: 0, height: 0, compact: false };
            const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
            const width = this.canvas.width / dpr;
            const height = this.canvas.height / dpr;
            const compact = width < 620;
            if (compact) {
                return {
                    width,
                    height,
                    compact,
                    column: { x: 28, y: 92, width: width - 56, height: Math.max(130, height * 0.31) },
                    chart: { x: 38, y: Math.max(270, height * 0.54), width: width - 60, height: Math.max(126, height * 0.32) }
                };
            }
            return {
                width,
                height,
                compact,
                column: { x: 44, y: 116, width: Math.max(180, width * 0.28), height: height - 190 },
                chart: { x: width * 0.40, y: 118, width: width * 0.55 - 26, height: height - 188 }
            };
        },

        canvasPoint(event) {
            const rect = this.canvas.getBoundingClientRect();
            return {
                x: (event.clientX - rect.left) * (this.canvas.clientWidth / Math.max(rect.width, 1)),
                y: (event.clientY - rect.top) * (this.canvas.clientHeight / Math.max(rect.height, 1))
            };
        },

        beginScrub(event) {
            const point = this.canvasPoint(event);
            const chart = this.layout().chart;
            if (
                point.x < chart.x - 18 || point.x > chart.x + chart.width + 18
                || point.y < chart.y - 18 || point.y > chart.y + chart.height + 18
            ) return;
            event.preventDefault();
            this.scrubbing = true;
            this.scrubPointerId = event.pointerId;
            this.paused = true;
            this.stopLoop();
            this.canvas.setPointerCapture?.(event.pointerId);
            this.updateScrub(event);
        },

        updateScrub(event) {
            if (!this.scrubbing || event.pointerId !== this.scrubPointerId) return;
            event.preventDefault();
            const point = this.canvasPoint(event);
            const chart = this.layout().chart;
            const ratio = clamp((point.x - chart.x) / Math.max(chart.width, 1), 0, 0.9999);
            this.elapsed = ratio * this.model().axisMaximum / MODEL_MINUTES_PER_SECOND;
            this.syncUi('已定位检测时刻；按继续扫描恢复播放。');
            this.render();
        },

        endScrub(event) {
            if (!this.scrubbing || event.pointerId !== this.scrubPointerId) return;
            event.preventDefault();
            this.canvas.releasePointerCapture?.(event.pointerId);
            this.scrubbing = false;
            this.scrubPointerId = null;
            this.syncUi('检测时刻已固定，可直接比较色带与峰位。');
        },

        snapshot() {
            const model = this.model();
            return Object.freeze({
                parameter: this.parameter,
                elapsed_seconds: this.elapsed,
                model_time_minutes: this.modelTime(model),
                flow_ml_per_minute: this.flow,
                hold_up_time_minutes: model.holdUpTime,
                retention_gap: model.gap,
                retention_factors: Object.freeze([...model.retentionFactors]),
                retention_times_minutes: Object.freeze([...model.retentionTimes]),
                plate_number: model.plateNumber,
                minimum_resolution: model.minimumResolution,
                preset: this.preset
            });
        },

        debugSnapshot() {
            const rootState = this.root ? (this.root.dataset.state || 'mounted') : 'detached';
            return Object.freeze({
                state: rootState,
                model: this.snapshot(),
                timing: Object.freeze({
                    last_step_seconds: this.lastStepSeconds,
                    maximum_step_seconds: MAX_FRAME_SECONDS
                }),
                resources: Object.freeze({
                    animation_frames: this.frame ? 1 : 0,
                    resize_observers: this.resizeObserver ? 1 : 0,
                    control_scopes: this.controls ? 1 : 0,
                    canvas_bitmap: Object.freeze({
                        width: this.canvas ? this.canvas.width : 0,
                        height: this.canvas ? this.canvas.height : 0
                    })
                })
            });
        },

        drawBackground(context, layout) {
            const { width, height } = layout;
            const gradient = context.createRadialGradient(width * 0.46, height * 0.34, 0, width * 0.52, height * 0.48, Math.max(width, height));
            gradient.addColorStop(0, '#102c37');
            gradient.addColorStop(0.48, '#071822');
            gradient.addColorStop(1, '#03090f');
            context.fillStyle = gradient;
            context.fillRect(0, 0, width, height);
            context.save();
            context.strokeStyle = 'rgba(105, 221, 218, 0.055)';
            context.lineWidth = 1;
            const spacing = layout.compact ? 28 : 40;
            for (let x = 0; x <= width; x += spacing) {
                context.beginPath();
                context.moveTo(x, 0);
                context.lineTo(x, height);
                context.stroke();
            }
            for (let y = 0; y <= height; y += spacing) {
                context.beginPath();
                context.moveTo(0, y);
                context.lineTo(width, y);
                context.stroke();
            }
            context.restore();
        },

        drawPanel(context, rect, label) {
            context.save();
            context.fillStyle = 'rgba(3, 13, 19, 0.72)';
            context.strokeStyle = 'rgba(126, 224, 219, 0.18)';
            context.lineWidth = 1;
            context.beginPath();
            context.roundRect(rect.x - 14, rect.y - 30, rect.width + 28, rect.height + 48, 14);
            context.fill();
            context.stroke();
            context.fillStyle = 'rgba(221, 247, 245, 0.68)';
            context.font = '600 11px ui-monospace, monospace';
            context.fillText(label, rect.x, rect.y - 10);
            context.restore();
        },

        drawColumn(context, layout, model, time) {
            const rect = layout.column;
            this.drawPanel(context, rect, layout.compact ? 'COLUMN / 色带推进' : 'SEPARATION COLUMN / 色带推进');
            const horizontal = layout.compact;
            const axisStart = horizontal ? rect.x + 18 : rect.y + 18;
            const axisLength = horizontal ? rect.width - 36 : rect.height - 36;
            const crossCenter = horizontal ? rect.y + rect.height * 0.54 : rect.x + rect.width * 0.5;
            const tubeWidth = horizontal ? Math.min(72, rect.height * 0.52) : Math.min(92, rect.width * 0.48);

            context.save();
            const tubeGradient = horizontal
                ? context.createLinearGradient(rect.x, 0, rect.x + rect.width, 0)
                : context.createLinearGradient(0, rect.y, 0, rect.y + rect.height);
            tubeGradient.addColorStop(0, 'rgba(91, 216, 213, 0.08)');
            tubeGradient.addColorStop(0.5, 'rgba(188, 248, 240, 0.17)');
            tubeGradient.addColorStop(1, 'rgba(91, 216, 213, 0.07)');
            context.fillStyle = tubeGradient;
            context.strokeStyle = 'rgba(164, 239, 233, 0.42)';
            context.lineWidth = 1.5;
            context.beginPath();
            if (horizontal) {
                context.roundRect(rect.x, crossCenter - tubeWidth / 2, rect.width, tubeWidth, tubeWidth / 2);
            } else {
                context.roundRect(crossCenter - tubeWidth / 2, rect.y, tubeWidth, rect.height, tubeWidth / 2);
            }
            context.fill();
            context.stroke();

            const drawBand = (fraction, color, widthScale, alpha = 1) => {
                const center = axisStart + clamp(fraction, 0, 1) * axisLength;
                const bandWidth = clamp(axisLength * widthScale, 7, horizontal ? 34 : 26);
                const gradient = horizontal
                    ? context.createLinearGradient(center - bandWidth, 0, center + bandWidth, 0)
                    : context.createLinearGradient(0, center - bandWidth, 0, center + bandWidth);
                gradient.addColorStop(0, color.replace('ALPHA', '0'));
                gradient.addColorStop(0.35, color.replace('ALPHA', String(0.56 * alpha)));
                gradient.addColorStop(0.5, color.replace('ALPHA', String(0.96 * alpha)));
                gradient.addColorStop(0.65, color.replace('ALPHA', String(0.56 * alpha)));
                gradient.addColorStop(1, color.replace('ALPHA', '0'));
                context.fillStyle = gradient;
                context.shadowColor = color.replace('ALPHA', String(0.8 * alpha));
                context.shadowBlur = 15;
                if (horizontal) context.fillRect(center - bandWidth, crossCenter - tubeWidth / 2 + 3, bandWidth * 2, tubeWidth - 6);
                else context.fillRect(crossCenter - tubeWidth / 2 + 3, center - bandWidth, tubeWidth - 6, bandWidth * 2);
                context.shadowBlur = 0;
            };

            const solventFraction = clamp(time / model.holdUpTime, 0, 1);
            drawBand(solventFraction, 'rgba(211,247,244,ALPHA)', 0.018, 0.44);
            model.retentionTimes.forEach((retentionTime, index) => {
                const fraction = clamp(time / retentionTime, 0, 1);
                const fade = fraction >= 1 ? clamp(1.22 - time / retentionTime, 0.15, 1) : 1;
                const rgba = index === 0
                    ? 'rgba(85,232,255,ALPHA)'
                    : (index === 1 ? 'rgba(255,203,99,ALPHA)' : 'rgba(255,110,199,ALPHA)');
                drawBand(fraction, rgba, 0.032 + model.sigmas[index] / model.axisMaximum * 0.42, fade);
            });

            context.fillStyle = 'rgba(220, 247, 244, 0.62)';
            context.font = '600 10px ui-monospace, monospace';
            if (horizontal) {
                context.fillText('INJECT', rect.x, crossCenter - tubeWidth / 2 - 8);
                context.textAlign = 'right';
                context.fillText('DETECT', rect.x + rect.width, crossCenter - tubeWidth / 2 - 8);
            } else {
                context.textAlign = 'center';
                context.fillText('INJECT', crossCenter, rect.y - 8);
                context.fillText('DETECT', crossCenter, rect.y + rect.height + 13);
            }
            context.restore();
        },

        signalAt(time, model, index = null) {
            if (index !== null) return gaussian(time, model.retentionTimes[index], model.sigmas[index]);
            return model.retentionTimes.reduce((sum, retentionTime, componentIndex) => (
                sum + gaussian(time, retentionTime, model.sigmas[componentIndex])
            ), 0);
        },

        drawChromatogram(context, layout, model, time) {
            const rect = layout.chart;
            this.drawPanel(context, rect, 'DETECTOR SIGNAL / 检测峰');
            const left = rect.x;
            const right = rect.x + rect.width;
            const top = rect.y;
            const bottom = rect.y + rect.height;
            context.save();
            context.strokeStyle = 'rgba(217, 245, 243, 0.32)';
            context.lineWidth = 1;
            context.beginPath();
            context.moveTo(left, top);
            context.lineTo(left, bottom);
            context.lineTo(right, bottom);
            context.stroke();

            const ticks = layout.compact ? 4 : 6;
            context.font = '500 9px ui-monospace, monospace';
            context.fillStyle = 'rgba(210, 239, 237, 0.5)';
            context.textAlign = 'center';
            for (let index = 0; index <= ticks; index += 1) {
                const ratio = index / ticks;
                const x = left + ratio * rect.width;
                context.strokeStyle = 'rgba(173, 224, 220, 0.08)';
                context.beginPath();
                context.moveTo(x, top);
                context.lineTo(x, bottom);
                context.stroke();
                context.fillText((model.axisMaximum * ratio).toFixed(0), x, bottom + 14);
            }
            context.textAlign = 'right';
            context.fillText('t / min', right, bottom + 28);

            const points = Math.max(160, Math.round(rect.width));
            const yFor = (signal) => bottom - 8 - clamp(signal / 1.18, 0, 1) * (rect.height - 18);
            const xFor = (sampleTime) => left + sampleTime / model.axisMaximum * rect.width;

            COMPONENTS.forEach((component, componentIndex) => {
                context.strokeStyle = `${component.color}42`;
                context.lineWidth = 1.15;
                context.beginPath();
                for (let index = 0; index <= points; index += 1) {
                    const sampleTime = model.axisMaximum * index / points;
                    const pointX = xFor(sampleTime);
                    const pointY = yFor(this.signalAt(sampleTime, model, componentIndex));
                    if (index === 0) context.moveTo(pointX, pointY);
                    else context.lineTo(pointX, pointY);
                }
                context.stroke();
            });

            const liveMaximum = clamp(time, 0, model.axisMaximum);
            const livePoints = Math.max(1, Math.round(points * liveMaximum / model.axisMaximum));
            const liveGradient = context.createLinearGradient(left, 0, right, 0);
            liveGradient.addColorStop(0, '#55e8ff');
            liveGradient.addColorStop(0.52, '#ffcb63');
            liveGradient.addColorStop(1, '#ff6ec7');
            context.strokeStyle = liveGradient;
            context.lineWidth = layout.compact ? 2 : 2.5;
            context.shadowColor = 'rgba(113, 238, 231, 0.48)';
            context.shadowBlur = 8;
            context.beginPath();
            for (let index = 0; index <= livePoints; index += 1) {
                const sampleTime = liveMaximum * index / livePoints;
                const pointX = xFor(sampleTime);
                const pointY = yFor(this.signalAt(sampleTime, model));
                if (index === 0) context.moveTo(pointX, pointY);
                else context.lineTo(pointX, pointY);
            }
            context.stroke();
            context.shadowBlur = 0;

            model.retentionTimes.forEach((retentionTime, index) => {
                const peakX = xFor(retentionTime);
                const peakY = yFor(1);
                context.fillStyle = COMPONENTS[index].color;
                context.font = '700 10px ui-monospace, monospace';
                context.textAlign = 'center';
                context.fillText(`${COMPONENTS[index].id}  ${retentionTime.toFixed(1)}`, peakX, peakY - 7);
            });

            const sweepX = xFor(liveMaximum);
            context.setLineDash([4, 5]);
            context.strokeStyle = 'rgba(235, 255, 251, 0.82)';
            context.lineWidth = 1;
            context.beginPath();
            context.moveTo(sweepX, top);
            context.lineTo(sweepX, bottom);
            context.stroke();
            context.setLineDash([]);
            context.fillStyle = '#effffc';
            context.beginPath();
            context.arc(sweepX, yFor(this.signalAt(liveMaximum, model)), 3.5, 0, Math.PI * 2);
            context.fill();
            context.restore();
        },

        render() {
            if (!this.context || !this.canvas || !this.readout) return;
            const layout = this.layout();
            if (layout.width <= 0 || layout.height <= 0) return;
            const model = this.model();
            const time = this.modelTime(model);
            const context = this.context;
            this.drawBackground(context, layout);
            this.drawColumn(context, layout, model, time);
            this.drawChromatogram(context, layout, model, time);

            const nextIndex = model.retentionTimes.findIndex((retentionTime) => retentionTime >= time);
            const nextLabel = nextIndex >= 0
                ? `${COMPONENTS[nextIndex].id} · ${model.retentionTimes[nextIndex].toFixed(2)} min`
                : '本轮已完成';
            this.readout.textContent = `主参数 ${this.parameter.toFixed(0)} · Δk ${model.gap.toFixed(3)} · t ${time.toFixed(1)} min · min Rs ${model.minimumResolution.toFixed(2)}`;
            if (this.holdUpOutput) this.holdUpOutput.textContent = `${model.holdUpTime.toFixed(2)} min`;
            if (this.resolutionOutput) this.resolutionOutput.textContent = model.minimumResolution.toFixed(2);
            if (this.nextPeakOutput) this.nextPeakOutput.textContent = nextLabel;
            if (this.stageHint) this.stageHint.hidden = this.elapsed > 4 && !this.paused;
        },

        destroy() {
            this.stopLoop();
            this.controls?.abort();
            this.controls = null;
            this.resizeObserver?.disconnect();
            this.resizeObserver = null;
            this.motionPreference = null;
            this.root = null;
            this.canvas = null;
            this.context = null;
            this.readout = null;
            this.parameterControl = null;
            this.parameterOutput = null;
            this.toggleButton = null;
            this.stateOutput = null;
            this.notice = null;
            this.flowControl = null;
            this.flowOutput = null;
            this.holdUpOutput = null;
            this.resolutionOutput = null;
            this.nextPeakOutput = null;
            this.stageHint = null;
            this.parameter = DEFAULT_PARAMETER;
            this.flow = DEFAULT_FLOW;
            this.elapsed = 0;
            this.lastStepSeconds = 0;
            this.paused = false;
            this.reducedMotion = false;
            this.preset = 'balanced';
            this.scrubbing = false;
            this.scrubPointerId = null;
        }
    };

    window.ChromatographySeparation = ChromatographySeparation;
    window.initChromatographySeparation = () => ChromatographySeparation.init();
})();
