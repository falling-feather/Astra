(() => {
    'use strict';

    const DEFAULT_PARAMETER = 50;
    const DEFAULT_DAMPING = 0;
    const DEFAULT_SPEED = 1.25;
    const FIXED_STEP = 1 / 240;
    const MAX_FRAME_SECONDS = 0.05;
    const GRAVITY = 9.81;
    const MASS_1 = 1;
    const MASS_2 = 1;
    const LENGTH_1 = 1;
    const LENGTH_2 = 1;
    const TRAIL_LIMIT = 260;
    const PHASE_LIMIT = 320;
    const PRESETS = Object.freeze({
        calm: Object.freeze({ theta1: 0.82, theta2: 0.46 }),
        balanced: Object.freeze({ theta1: 2.1, theta2: -0.35 }),
        chaotic: Object.freeze({ theta1: 2.15, theta2: 1.1 })
    });

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const radiansToDegrees = (value) => value * 180 / Math.PI;
    const degreesToRadians = (value) => value * Math.PI / 180;
    const normalizeAngle = (value) => Math.atan2(Math.sin(value), Math.cos(value));
    const finiteState = (state) => state.every(Number.isFinite);

    const DoublePendulumChaos = {
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
        dampingControl: null,
        dampingOutput: null,
        speedControl: null,
        speedOutput: null,
        separationOutput: null,
        energyOutput: null,
        timeOutput: null,
        stageHint: null,
        frame: 0,
        lastTime: 0,
        lastStepSeconds: 0,
        accumulator: 0,
        parameter: DEFAULT_PARAMETER,
        damping: DEFAULT_DAMPING,
        speed: DEFAULT_SPEED,
        elapsed: 0,
        paused: false,
        reducedMotion: false,
        preset: 'chaotic',
        initialTheta1: PRESETS.chaotic.theta1,
        initialTheta2: PRESETS.chaotic.theta2,
        stateA: [0, 0, 0, 0],
        stateB: [0, 0, 0, 0],
        initialEnergyA: 0,
        initialEnergyB: 0,
        trailsA: [],
        trailsB: [],
        phaseA: [],
        phaseB: [],
        simulationSteps: 0,
        dragging: false,
        dragResume: false,
        dragPointerId: null,

        init() {
            this.destroy();
            this.root = document.querySelector(
                '#page-physics [data-module="double-pendulum-chaos"] .astra-exp--double-pendulum-chaos'
            );
            if (!this.root) return false;

            this.canvas = this.root.querySelector('[data-role="canvas"]');
            this.readout = this.root.querySelector('[data-role="readout"]');
            this.parameterControl = this.root.querySelector('[data-control="parameter"]');
            this.parameterOutput = this.root.querySelector('[data-role="parameter-value"]');
            this.toggleButton = this.root.querySelector('[data-action="toggle"]');
            this.stateOutput = this.root.querySelector('[data-role="state"]');
            this.notice = this.root.querySelector('[data-role="notice"]');
            this.dampingControl = this.root.querySelector('[data-control="damping"]');
            this.dampingOutput = this.root.querySelector('[data-role="damping-value"]');
            this.speedControl = this.root.querySelector('[data-control="speed"]');
            this.speedOutput = this.root.querySelector('[data-role="speed-value"]');
            this.separationOutput = this.root.querySelector('[data-role="separation"]');
            this.energyOutput = this.root.querySelector('[data-role="energy"]');
            this.timeOutput = this.root.querySelector('[data-role="time"]');
            this.stageHint = this.root.querySelector('[data-role="stage-hint"]');

            if (
                !this.canvas
                || !this.readout
                || !this.parameterControl
                || !this.parameterOutput
                || !this.toggleButton
                || !this.stateOutput
                || !this.notice
                || !this.dampingControl
                || !this.dampingOutput
                || !this.speedControl
                || !this.speedOutput
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
                this.resetSimulation();
                this.syncUi('初值差已更新，两组轨迹重新同步释放。');
                this.render();
            }, { signal });

            this.dampingControl.addEventListener('input', (event) => {
                this.damping = clamp(Number(event.target.value), 0, 0.06);
                this.resetSimulation();
                this.syncUi('阻尼已更新，能量读数改为相对变化。');
                this.render();
            }, { signal });

            this.speedControl.addEventListener('input', (event) => {
                this.speed = clamp(Number(event.target.value), 0.5, 2);
                this.syncUi('时间倍率只改变演示速度，不改变模型步长。');
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

            this.canvas.addEventListener('pointerdown', (event) => this.beginDrag(event), { signal });
            this.canvas.addEventListener('pointermove', (event) => this.updateDrag(event), { signal });
            this.canvas.addEventListener('pointerup', (event) => this.endDrag(event), { signal });
            this.canvas.addEventListener('pointercancel', (event) => this.endDrag(event), { signal });

            this.resizeObserver = new ResizeObserver(() => this.resize());
            this.resizeObserver.observe(this.canvas.parentElement || this.canvas);
            this.resize();
            this.reset();
            return true;
        },

        parameterDegrees() {
            return 0.05 + this.parameter * 0.0195;
        },

        applyPreset(name) {
            const next = PRESETS[name];
            if (!next) return;
            this.preset = name;
            this.initialTheta1 = next.theta1;
            this.initialTheta2 = next.theta2;
            this.resetSimulation();
            this.syncUi(`${name === 'chaotic' ? '混沌' : (name === 'balanced' ? '翻转' : '低能')}姿态已载入。`);
            this.render();
        },

        reset() {
            this.parameter = DEFAULT_PARAMETER;
            this.damping = DEFAULT_DAMPING;
            this.speed = DEFAULT_SPEED;
            this.preset = 'chaotic';
            this.initialTheta1 = PRESETS.chaotic.theta1;
            this.initialTheta2 = PRESETS.chaotic.theta2;
            this.paused = false;
            this.dragging = false;
            this.dragPointerId = null;
            this.stopLoop();
            if (this.parameterControl) this.parameterControl.value = String(DEFAULT_PARAMETER);
            if (this.dampingControl) this.dampingControl.value = String(DEFAULT_DAMPING);
            if (this.speedControl) this.speedControl.value = String(DEFAULT_SPEED);
            this.resetSimulation();
            this.syncUi('两组双摆同步释放，轨迹差异会逐步放大。');
            this.render();
            if (!this.reducedMotion) this.startLoop();
        },

        resetSimulation() {
            const delta = degreesToRadians(this.parameterDegrees());
            this.elapsed = 0;
            this.accumulator = 0;
            this.lastStepSeconds = 0;
            this.simulationSteps = 0;
            this.stateA = [this.initialTheta1, 0, this.initialTheta2, 0];
            this.stateB = [this.initialTheta1, 0, this.initialTheta2 + delta, 0];
            this.initialEnergyA = this.energy(this.stateA);
            this.initialEnergyB = this.energy(this.stateB);
            this.trailsA = [this.endpoint(this.stateA)];
            this.trailsB = [this.endpoint(this.stateB)];
            this.phaseA = [[normalizeAngle(this.stateA[2]), this.stateA[3]]];
            this.phaseB = [[normalizeAngle(this.stateB[2]), this.stateB[3]]];
        },

        derivatives(state) {
            const [theta1, omega1, theta2, omega2] = state;
            const delta = theta1 - theta2;
            const denominator = 2 * MASS_1 + MASS_2 - MASS_2 * Math.cos(2 * delta);
            const alpha1 = (
                -GRAVITY * (2 * MASS_1 + MASS_2) * Math.sin(theta1)
                - MASS_2 * GRAVITY * Math.sin(theta1 - 2 * theta2)
                - 2 * Math.sin(delta) * MASS_2 * (
                    omega2 * omega2 * LENGTH_2
                    + omega1 * omega1 * LENGTH_1 * Math.cos(delta)
                )
            ) / (LENGTH_1 * denominator) - this.damping * omega1;
            const alpha2 = (
                2 * Math.sin(delta) * (
                    omega1 * omega1 * LENGTH_1 * (MASS_1 + MASS_2)
                    + GRAVITY * (MASS_1 + MASS_2) * Math.cos(theta1)
                    + omega2 * omega2 * LENGTH_2 * MASS_2 * Math.cos(delta)
                )
            ) / (LENGTH_2 * denominator) - this.damping * omega2;
            return [omega1, alpha1, omega2, alpha2];
        },

        rk4(state, step) {
            const addScaled = (source, delta, scale) => source.map((value, index) => value + delta[index] * scale);
            const k1 = this.derivatives(state);
            const k2 = this.derivatives(addScaled(state, k1, step / 2));
            const k3 = this.derivatives(addScaled(state, k2, step / 2));
            const k4 = this.derivatives(addScaled(state, k3, step));
            return state.map((value, index) => value + step * (
                k1[index] + 2 * k2[index] + 2 * k3[index] + k4[index]
            ) / 6);
        },

        advance(step) {
            this.stateA = this.rk4(this.stateA, step);
            this.stateB = this.rk4(this.stateB, step);
            if (!finiteState(this.stateA) || !finiteState(this.stateB)) {
                this.resetSimulation();
                this.syncUi('数值状态已自动回到稳定初值。');
                return;
            }
            this.elapsed += step;
            this.simulationSteps += 1;
            if (this.simulationSteps % 3 === 0) {
                this.trailsA.push(this.endpoint(this.stateA));
                this.trailsB.push(this.endpoint(this.stateB));
                if (this.trailsA.length > TRAIL_LIMIT) this.trailsA.shift();
                if (this.trailsB.length > TRAIL_LIMIT) this.trailsB.shift();
            }
            if (this.simulationSteps % 6 === 0) {
                this.phaseA.push([normalizeAngle(this.stateA[2]), this.stateA[3]]);
                this.phaseB.push([normalizeAngle(this.stateB[2]), this.stateB[3]]);
                if (this.phaseA.length > PHASE_LIMIT) this.phaseA.shift();
                if (this.phaseB.length > PHASE_LIMIT) this.phaseB.shift();
            }
        },

        energy(state) {
            const [theta1, omega1, theta2, omega2] = state;
            const kinetic = 0.5 * (MASS_1 + MASS_2) * LENGTH_1 * LENGTH_1 * omega1 * omega1
                + 0.5 * MASS_2 * LENGTH_2 * LENGTH_2 * omega2 * omega2
                + MASS_2 * LENGTH_1 * LENGTH_2 * omega1 * omega2 * Math.cos(theta1 - theta2);
            const potential = -(MASS_1 + MASS_2) * GRAVITY * LENGTH_1 * Math.cos(theta1)
                - MASS_2 * GRAVITY * LENGTH_2 * Math.cos(theta2);
            return kinetic + potential;
        },

        geometry(state) {
            const [theta1, , theta2] = state;
            const joint = { x: LENGTH_1 * Math.sin(theta1), y: LENGTH_1 * Math.cos(theta1) };
            const end = {
                x: joint.x + LENGTH_2 * Math.sin(theta2),
                y: joint.y + LENGTH_2 * Math.cos(theta2)
            };
            return { joint, end };
        },

        endpoint(state) {
            const point = this.geometry(state).end;
            return [point.x, point.y];
        },

        currentSeparation() {
            const a = this.endpoint(this.stateA);
            const b = this.endpoint(this.stateB);
            return Math.hypot(a[0] - b[0], a[1] - b[1]);
        },

        energyMetric() {
            const relative = (state, initial) => Math.abs(initial) > 1e-9
                ? (this.energy(state) - initial) / Math.abs(initial)
                : 0;
            const a = relative(this.stateA, this.initialEnergyA);
            const b = relative(this.stateB, this.initialEnergyB);
            return this.damping === 0 ? Math.max(Math.abs(a), Math.abs(b)) : (a + b) / 2;
        },

        syncUi(message = '') {
            if (!this.root) return;
            const state = this.reducedMotion ? 'reduced-motion' : (this.paused ? 'paused' : 'running');
            const stateLabel = this.reducedMotion ? '静态模式' : (this.paused ? '已暂停' : '运行中');
            this.root.dataset.state = state;
            this.root.dataset.preset = this.preset;

            const parameterLabel = `${this.parameter.toFixed(0)} · ${this.parameterDegrees().toFixed(2)}°`;
            this.parameterOutput.value = parameterLabel;
            this.parameterOutput.textContent = parameterLabel;
            this.dampingOutput.value = `${this.damping.toFixed(3)} s⁻¹`;
            this.dampingOutput.textContent = `${this.damping.toFixed(3)} s⁻¹`;
            this.speedOutput.value = `${this.speed.toFixed(2)}×`;
            this.speedOutput.textContent = `${this.speed.toFixed(2)}×`;
            this.stateOutput.value = stateLabel;
            this.stateOutput.textContent = stateLabel;

            this.root.querySelectorAll('[data-preset]').forEach((button) => {
                button.setAttribute('aria-pressed', String(button.dataset.preset === this.preset));
            });

            this.toggleButton.disabled = this.reducedMotion;
            this.toggleButton.textContent = this.reducedMotion ? '静态模式' : (this.paused ? '继续模拟' : '暂停模拟');
            this.toggleButton.setAttribute('aria-pressed', String(this.paused || this.reducedMotion));

            const fallback = this.reducedMotion
                ? '已减少动态效果；调参或拖动仍会刷新静态结果。'
                : (this.paused ? '模拟已暂停，可比较读数或调整初值。' : '两组双摆同步运行，轨迹差异正在累积。');
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
                if (!this.root || this.paused || this.reducedMotion || this.dragging) return;
                const frameSeconds = clamp((now - this.lastTime) / 1000, 0, MAX_FRAME_SECONDS);
                this.lastTime = now;
                this.accumulator += frameSeconds * this.speed;
                let stepped = false;
                while (this.accumulator >= FIXED_STEP) {
                    this.advance(FIXED_STEP);
                    this.accumulator -= FIXED_STEP;
                    stepped = true;
                }
                this.lastStepSeconds = stepped ? FIXED_STEP : 0;
                this.render();
                this.frame = requestAnimationFrame(tick);
            };
            this.frame = requestAnimationFrame(tick);
        },

        layout() {
            if (!this.canvas) return { width: 0, height: 0, pivotX: 0, pivotY: 0, scale: 1 };
            const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
            const width = this.canvas.width / dpr;
            const height = this.canvas.height / dpr;
            return {
                width,
                height,
                pivotX: width >= 680 ? width * 0.39 : width * 0.5,
                pivotY: Math.max(74, height * 0.16),
                scale: Math.min(height * 0.29, width * (width >= 680 ? 0.18 : 0.24))
            };
        },

        canvasPoint(event) {
            const rect = this.canvas.getBoundingClientRect();
            return {
                x: (event.clientX - rect.left) * (this.canvas.clientWidth / Math.max(rect.width, 1)),
                y: (event.clientY - rect.top) * (this.canvas.clientHeight / Math.max(rect.height, 1))
            };
        },

        screenGeometry(state) {
            const layout = this.layout();
            const geometry = this.geometry(state);
            return {
                joint: {
                    x: layout.pivotX + geometry.joint.x * layout.scale,
                    y: layout.pivotY + geometry.joint.y * layout.scale
                },
                end: {
                    x: layout.pivotX + geometry.end.x * layout.scale,
                    y: layout.pivotY + geometry.end.y * layout.scale
                }
            };
        },

        beginDrag(event) {
            if (!this.canvas || this.dragging) return;
            const point = this.canvasPoint(event);
            const a = this.screenGeometry(this.stateA).end;
            const b = this.screenGeometry(this.stateB).end;
            const nearA = Math.hypot(point.x - a.x, point.y - a.y) <= 54;
            const nearB = Math.hypot(point.x - b.x, point.y - b.y) <= 54;
            if (!nearA && !nearB) return;
            event.preventDefault();
            this.dragging = true;
            this.dragPointerId = event.pointerId;
            this.dragResume = !this.paused && !this.reducedMotion;
            this.paused = true;
            this.stopLoop();
            this.canvas.setPointerCapture?.(event.pointerId);
            this.updateDrag(event);
            this.syncUi('拖动中：释放后从新姿态继续。');
        },

        updateDrag(event) {
            if (!this.dragging || event.pointerId !== this.dragPointerId) return;
            event.preventDefault();
            const point = this.canvasPoint(event);
            const layout = this.layout();
            const jointModel = {
                x: Math.sin(this.initialTheta1),
                y: Math.cos(this.initialTheta1)
            };
            const joint = {
                x: layout.pivotX + jointModel.x * layout.scale,
                y: layout.pivotY + jointModel.y * layout.scale
            };
            this.initialTheta2 = Math.atan2(point.x - joint.x, point.y - joint.y);
            this.preset = 'custom';
            this.resetSimulation();
            this.syncUi('拖动中：释放后从新姿态继续。');
            this.render();
        },

        endDrag(event) {
            if (!this.dragging || event.pointerId !== this.dragPointerId) return;
            event.preventDefault();
            this.canvas.releasePointerCapture?.(event.pointerId);
            this.dragging = false;
            this.dragPointerId = null;
            this.paused = !this.dragResume;
            this.syncUi(this.paused ? '新姿态已固定，按继续模拟开始。' : '新姿态已释放。');
            if (!this.paused && !this.reducedMotion) this.startLoop();
        },

        snapshot() {
            return Object.freeze({
                parameter: this.parameter,
                elapsed_seconds: this.elapsed,
                initial_gap_degrees: this.parameterDegrees(),
                damping_per_second: this.damping,
                speed_multiplier: this.speed,
                endpoint_separation_meters: this.currentSeparation(),
                relative_energy_change: this.energyMetric(),
                preset: this.preset,
                simulation_steps: this.simulationSteps
            });
        },

        debugSnapshot() {
            const rootState = this.root ? (this.root.dataset.state || 'mounted') : 'detached';
            return Object.freeze({
                state: rootState,
                model: this.snapshot(),
                timing: Object.freeze({
                    last_step_seconds: this.lastStepSeconds,
                    maximum_step_seconds: FIXED_STEP
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
            const gradient = context.createRadialGradient(width * 0.36, height * 0.26, 0, width * 0.4, height * 0.45, Math.max(width, height));
            gradient.addColorStop(0, '#13284a');
            gradient.addColorStop(0.5, '#081426');
            gradient.addColorStop(1, '#030811');
            context.fillStyle = gradient;
            context.fillRect(0, 0, width, height);

            context.save();
            context.strokeStyle = 'rgba(131, 179, 236, 0.07)';
            context.lineWidth = 1;
            const spacing = width < 520 ? 32 : 44;
            for (let x = (layout.pivotX % spacing); x < width; x += spacing) {
                context.beginPath();
                context.moveTo(x, 0);
                context.lineTo(x, height);
                context.stroke();
            }
            for (let y = (layout.pivotY % spacing); y < height; y += spacing) {
                context.beginPath();
                context.moveTo(0, y);
                context.lineTo(width, y);
                context.stroke();
            }
            context.restore();
        },

        drawTrail(context, points, layout, color) {
            if (points.length < 2) return;
            context.save();
            context.lineCap = 'round';
            for (let index = 1; index < points.length; index += 1) {
                const alpha = 0.05 + 0.7 * index / points.length;
                context.strokeStyle = color.replace('ALPHA', alpha.toFixed(3));
                context.lineWidth = 0.6 + 2.1 * index / points.length;
                context.beginPath();
                context.moveTo(layout.pivotX + points[index - 1][0] * layout.scale, layout.pivotY + points[index - 1][1] * layout.scale);
                context.lineTo(layout.pivotX + points[index][0] * layout.scale, layout.pivotY + points[index][1] * layout.scale);
                context.stroke();
            }
            context.restore();
        },

        drawPendulum(context, state, layout, color, label, offset = 0) {
            const geometry = this.geometry(state);
            const joint = {
                x: layout.pivotX + geometry.joint.x * layout.scale + offset,
                y: layout.pivotY + geometry.joint.y * layout.scale
            };
            const end = {
                x: layout.pivotX + geometry.end.x * layout.scale + offset,
                y: layout.pivotY + geometry.end.y * layout.scale
            };
            context.save();
            context.strokeStyle = color;
            context.lineWidth = 3;
            context.shadowColor = color;
            context.shadowBlur = 12;
            context.beginPath();
            context.moveTo(layout.pivotX + offset, layout.pivotY);
            context.lineTo(joint.x, joint.y);
            context.lineTo(end.x, end.y);
            context.stroke();

            [[joint, 8], [end, 11]].forEach(([point, radius], index) => {
                context.fillStyle = index === 0 ? '#d8eaff' : color;
                context.beginPath();
                context.arc(point.x, point.y, radius, 0, Math.PI * 2);
                context.fill();
            });
            context.shadowBlur = 0;
            context.fillStyle = color;
            context.font = '600 12px ui-monospace, monospace';
            context.fillText(label, end.x + 15, end.y + 4);
            context.restore();
            return { joint, end };
        },

        drawPhasePlot(context, layout) {
            if (layout.width < 680) return;
            const width = Math.min(238, layout.width * 0.29);
            const height = Math.min(184, layout.height * 0.3);
            const x = layout.width - width - 22;
            const y = layout.height - height - 22;
            context.save();
            context.fillStyle = 'rgba(3, 9, 19, 0.76)';
            context.strokeStyle = 'rgba(160, 195, 236, 0.2)';
            context.lineWidth = 1;
            context.beginPath();
            context.roundRect(x, y, width, height, 10);
            context.fill();
            context.stroke();
            context.fillStyle = 'rgba(226, 239, 255, 0.72)';
            context.font = '600 11px ui-monospace, monospace';
            context.fillText('PHASE SPACE  θ₂ / ω₂', x + 12, y + 20);

            const plot = (points, color) => {
                if (points.length < 2) return;
                context.strokeStyle = color;
                context.lineWidth = 1.3;
                context.beginPath();
                points.forEach((point, index) => {
                    const px = x + 12 + (normalizeAngle(point[0]) + Math.PI) / (2 * Math.PI) * (width - 24);
                    const py = y + 30 + (1 - (clamp(point[1], -12, 12) + 12) / 24) * (height - 42);
                    if (index === 0) context.moveTo(px, py);
                    else context.lineTo(px, py);
                });
                context.stroke();
            };
            plot(this.phaseA, 'rgba(71, 224, 255, 0.78)');
            plot(this.phaseB, 'rgba(255, 92, 203, 0.72)');
            context.restore();
        },

        drawMobileGauge(context, layout, separation) {
            if (layout.width >= 680) return;
            const x = layout.width - 56;
            const y = layout.height - 62;
            const ratio = clamp(separation / 2.4, 0, 1);
            context.save();
            context.lineWidth = 6;
            context.strokeStyle = 'rgba(255,255,255,0.1)';
            context.beginPath();
            context.arc(x, y, 28, Math.PI * 0.75, Math.PI * 2.25);
            context.stroke();
            context.strokeStyle = ratio > 0.55 ? '#ff5ccb' : '#47e0ff';
            context.beginPath();
            context.arc(x, y, 28, Math.PI * 0.75, Math.PI * (0.75 + 1.5 * ratio));
            context.stroke();
            context.fillStyle = 'rgba(232,244,255,0.78)';
            context.font = '600 10px ui-monospace, monospace';
            context.textAlign = 'center';
            context.fillText('Δr', x, y + 3);
            context.restore();
        },

        render() {
            if (!this.context || !this.canvas || !this.readout) return;
            const layout = this.layout();
            if (layout.width <= 0 || layout.height <= 0) return;
            const context = this.context;
            this.drawBackground(context, layout);
            this.drawTrail(context, this.trailsA, layout, 'rgba(71,224,255,ALPHA)');
            this.drawTrail(context, this.trailsB, layout, 'rgba(255,92,203,ALPHA)');

            context.save();
            context.fillStyle = '#e7f2ff';
            context.shadowColor = '#8cbcff';
            context.shadowBlur = 14;
            context.beginPath();
            context.arc(layout.pivotX, layout.pivotY, 7, 0, Math.PI * 2);
            context.fill();
            context.restore();

            const pendulumA = this.drawPendulum(context, this.stateA, layout, '#47e0ff', 'A', -1.5);
            const pendulumB = this.drawPendulum(context, this.stateB, layout, '#ff5ccb', 'B', 1.5);
            const separation = this.currentSeparation();
            context.save();
            context.setLineDash([5, 6]);
            context.strokeStyle = 'rgba(255, 222, 124, 0.78)';
            context.lineWidth = 1.5;
            context.beginPath();
            context.moveTo(pendulumA.end.x, pendulumA.end.y);
            context.lineTo(pendulumB.end.x, pendulumB.end.y);
            context.stroke();
            context.restore();

            this.drawPhasePlot(context, layout);
            this.drawMobileGauge(context, layout, separation);

            const energyMetric = this.energyMetric();
            const energyLabel = this.damping === 0
                ? `${(Math.abs(energyMetric) * 100).toFixed(4)}%`
                : `${energyMetric >= 0 ? '+' : ''}${(energyMetric * 100).toFixed(2)}%`;
            this.readout.textContent = `主参数 ${this.parameter.toFixed(0)} · Δθ ${this.parameterDegrees().toFixed(2)}° · 分离 ${separation.toFixed(3)} m · t ${this.elapsed.toFixed(1)} s`;
            if (this.separationOutput) this.separationOutput.textContent = `${separation.toFixed(3)} m`;
            if (this.energyOutput) {
                this.energyOutput.textContent = energyLabel;
                this.energyOutput.parentElement?.querySelector('span')?.replaceChildren(
                    this.damping === 0 ? '能量误差' : '能量变化'
                );
            }
            if (this.timeOutput) this.timeOutput.textContent = `${this.elapsed.toFixed(1)} s`;
            if (this.stageHint) this.stageHint.hidden = this.elapsed > 9 && !this.paused;
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
            this.dampingControl = null;
            this.dampingOutput = null;
            this.speedControl = null;
            this.speedOutput = null;
            this.separationOutput = null;
            this.energyOutput = null;
            this.timeOutput = null;
            this.stageHint = null;
            this.parameter = DEFAULT_PARAMETER;
            this.damping = DEFAULT_DAMPING;
            this.speed = DEFAULT_SPEED;
            this.elapsed = 0;
            this.accumulator = 0;
            this.lastStepSeconds = 0;
            this.paused = false;
            this.reducedMotion = false;
            this.dragging = false;
            this.dragPointerId = null;
            this.trailsA = [];
            this.trailsB = [];
            this.phaseA = [];
            this.phaseB = [];
            this.stateA = [0, 0, 0, 0];
            this.stateB = [0, 0, 0, 0];
        }
    };

    window.DoublePendulumChaos = DoublePendulumChaos;
    window.initDoublePendulumChaos = () => DoublePendulumChaos.init();
})();
