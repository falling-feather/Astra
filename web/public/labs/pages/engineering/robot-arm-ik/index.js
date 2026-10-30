(() => {
    'use strict';

    const DEFAULT_PARAMETER = 50;
    const LINK_LENGTHS = Object.freeze([1.04, 0.82, 0.58]);
    const DEFAULT_ANGLES = Object.freeze([18, 42, -38].map((degrees) => degrees * Math.PI / 180));
    const MAX_ITERATIONS = 28;
    const SOLVER_TOLERANCE = 0.008;
    const MAX_JOINT_STEP = Math.PI / 3;
    const MAX_FRAME_SECONDS = 0.05;
    const TRAIL_LIMIT = 72;
    const PRESETS = Object.freeze({
        reachable: Object.freeze({ x: 1.55, y: 0.9 }),
        limit: Object.freeze({ x: -1.65, y: 0.4 }),
        outside: Object.freeze({ x: 2.76, y: 0.52 })
    });

    const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const radiansToDegrees = (radians) => radians * 180 / Math.PI;
    const normalizeAngle = (angle) => {
        let normalized = angle;
        while (normalized > Math.PI) normalized -= Math.PI * 2;
        while (normalized < -Math.PI) normalized += Math.PI * 2;
        return normalized;
    };

    const RobotArmIk = {
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
        residualOutput: null,
        iterationsOutput: null,
        reachOutput: null,
        stageHint: null,
        frame: 0,
        lastTime: 0,
        lastStepSeconds: 0,
        pixelRatio: 1,
        parameter: DEFAULT_PARAMETER,
        elapsed: 0,
        paused: false,
        reducedMotion: false,
        dragging: false,
        dragPointerId: null,
        preset: 'trajectory',
        target: null,
        angles: [...DEFAULT_ANGLES],
        solution: null,
        trail: [],

        init() {
            this.destroy();
            this.root = document.querySelector(
                '#page-engineering [data-module="robot-arm-ik"] .astra-exp--robot-arm-ik'
            );
            if (!this.root) return false;

            this.canvas = this.root.querySelector('[data-role="canvas"]');
            this.readout = this.root.querySelector('[data-role="readout"]');
            this.parameterControl = this.root.querySelector('[data-control="parameter"]');
            this.parameterOutput = this.root.querySelector('[data-role="parameter-value"]');
            this.toggleButton = this.root.querySelector('[data-action="toggle"]');
            this.stateOutput = this.root.querySelector('[data-role="state"]');
            this.notice = this.root.querySelector('[data-role="notice"]');
            this.residualOutput = this.root.querySelector('[data-role="residual"]');
            this.iterationsOutput = this.root.querySelector('[data-role="iterations"]');
            this.reachOutput = this.root.querySelector('[data-role="reach-state"]');
            this.stageHint = this.root.querySelector('[data-role="stage-hint"]');

            if (
                !this.canvas
                || !this.readout
                || !this.parameterControl
                || !this.parameterOutput
                || !this.toggleButton
                || !this.stateOutput
                || !this.notice
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
                this.solveTarget();
                this.syncUi('关节限位已更新，目标位置保持不变。');
                this.render();
            }, { signal });

            this.root.querySelectorAll('button[data-preset]').forEach((button) => {
                button.addEventListener('click', () => this.applyPreset(button.dataset.preset), { signal });
            });

            this.toggleButton.addEventListener('click', () => {
                if (this.reducedMotion) return;
                this.paused = !this.paused;
                this.dragging = false;
                this.dragPointerId = null;
                if (this.paused) {
                    this.lastStepSeconds = 0;
                    this.stopLoop();
                } else {
                    this.preset = 'trajectory';
                }
                this.syncUi(this.paused ? '轨迹已暂停，可拖动目标点定位。' : '目标恢复沿参考轨迹移动。');
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

        jointLimitRadians() {
            return (40 + 1.3 * this.parameter) * Math.PI / 180;
        },

        jointLimitDegrees() {
            return radiansToDegrees(this.jointLimitRadians());
        },

        maximumReach() {
            return LINK_LENGTHS.reduce((sum, length) => sum + length, 0);
        },

        trajectoryTarget(time) {
            return {
                x: 1.34 + 0.72 * Math.cos(time * 0.62),
                y: 0.62 + 0.86 * Math.sin(time * 0.84)
            };
        },

        forwardKinematics(angles) {
            const positions = [{ x: 0, y: 0 }];
            let heading = 0;
            for (let index = 0; index < LINK_LENGTHS.length; index += 1) {
                heading += angles[index];
                const previous = positions[positions.length - 1];
                positions.push({
                    x: previous.x + LINK_LENGTHS[index] * Math.cos(heading),
                    y: previous.y + LINK_LENGTHS[index] * Math.sin(heading)
                });
            }
            return positions;
        },

        solveCcd(target, startingAngles = this.angles) {
            const jointLimit = this.jointLimitRadians();
            const angles = startingAngles.map((angle) => clamp(normalizeAngle(angle), -jointLimit, jointLimit));
            let positions = this.forwardKinematics(angles);
            let residual = distance(positions[positions.length - 1], target);
            let iterations = 0;
            let saturated = angles.some((angle) => Math.abs(Math.abs(angle) - jointLimit) < 1e-6);

            for (let iteration = 0; iteration < MAX_ITERATIONS && residual > SOLVER_TOLERANCE; iteration += 1) {
                iterations = iteration + 1;
                for (let joint = LINK_LENGTHS.length - 1; joint >= 0; joint -= 1) {
                    positions = this.forwardKinematics(angles);
                    const pivot = positions[joint];
                    const end = positions[positions.length - 1];
                    const endVector = { x: end.x - pivot.x, y: end.y - pivot.y };
                    const targetVector = { x: target.x - pivot.x, y: target.y - pivot.y };
                    const endLength = Math.hypot(endVector.x, endVector.y);
                    const targetLength = Math.hypot(targetVector.x, targetVector.y);
                    if (endLength < 1e-9 || targetLength < 1e-9) continue;

                    const cross = endVector.x * targetVector.y - endVector.y * targetVector.x;
                    const dot = endVector.x * targetVector.x + endVector.y * targetVector.y;
                    const correction = clamp(Math.atan2(cross, dot), -MAX_JOINT_STEP, MAX_JOINT_STEP);
                    const unconstrained = normalizeAngle(angles[joint] + correction);
                    const constrained = clamp(unconstrained, -jointLimit, jointLimit);
                    if (Math.abs(constrained - unconstrained) > 1e-8) saturated = true;
                    angles[joint] = constrained;
                }
                positions = this.forwardKinematics(angles);
                residual = distance(positions[positions.length - 1], target);
            }

            const targetDistance = Math.hypot(target.x, target.y);
            const outside = targetDistance > this.maximumReach() + SOLVER_TOLERANCE;
            const reached = residual <= SOLVER_TOLERANCE;
            const status = reached ? 'reachable' : (outside ? 'outside' : 'limited');
            return Object.freeze({
                angles: Object.freeze([...angles]),
                positions: Object.freeze(positions.map((point) => Object.freeze({ ...point }))),
                residual,
                iterations,
                reached,
                outside,
                saturated,
                status
            });
        },

        solveTarget({ resetAngles = false, trace = true } = {}) {
            const start = resetAngles ? [...DEFAULT_ANGLES] : this.angles;
            this.solution = this.solveCcd(this.target, start);
            this.angles = [...this.solution.angles];
            const end = this.solution.positions[this.solution.positions.length - 1];
            if (trace) {
                const last = this.trail[this.trail.length - 1];
                if (!last || distance(last, end) > 0.014) {
                    this.trail.push({ x: end.x, y: end.y });
                    if (this.trail.length > TRAIL_LIMIT) this.trail.splice(0, this.trail.length - TRAIL_LIMIT);
                }
            }
            return this.solution;
        },

        applyPreset(name) {
            if (!Object.hasOwn(PRESETS, name)) return;
            this.paused = true;
            this.stopLoop();
            this.lastStepSeconds = 0;
            this.preset = name;
            this.target = { ...PRESETS[name] };
            this.trail = [];
            this.solveTarget({ resetAngles: true });
            const label = name === 'reachable' ? '可达点' : (name === 'limit' ? '限位挑战' : '越界点');
            this.syncUi(`${label}已载入，结果可重复复算。`);
            this.render();
        },

        reset() {
            this.parameter = DEFAULT_PARAMETER;
            this.elapsed = 0;
            this.lastStepSeconds = 0;
            this.paused = false;
            this.dragging = false;
            this.dragPointerId = null;
            this.preset = 'trajectory';
            this.angles = [...DEFAULT_ANGLES];
            this.target = this.trajectoryTarget(0);
            this.trail = [];
            this.stopLoop();
            if (this.parameterControl) this.parameterControl.value = String(DEFAULT_PARAMETER);
            this.solveTarget({ resetAngles: true });
            this.syncUi('目标沿参考轨迹移动，机械臂实时求解。');
            this.render();
            if (!this.reducedMotion) this.startLoop();
        },

        syncUi(message = '') {
            if (!this.root) return;
            const state = this.reducedMotion ? 'reduced-motion' : (this.paused ? 'paused' : 'running');
            const stateLabel = this.reducedMotion ? '静态求解' : (this.paused ? '手动定位' : '轨迹演示');
            const limit = this.jointLimitDegrees();
            this.root.dataset.state = state;
            this.root.dataset.reach = this.solution?.status || 'reachable';
            this.root.dataset.preset = this.preset;
            this.stateOutput.textContent = stateLabel;
            this.parameterOutput.textContent = `${this.parameter.toFixed(0)} · ±${limit.toFixed(1)}°`;
            this.toggleButton.disabled = this.reducedMotion;
            this.toggleButton.setAttribute('aria-pressed', String(this.paused));
            this.toggleButton.textContent = this.paused ? '继续轨迹' : '暂停轨迹';
            this.root.querySelectorAll('button[data-preset]').forEach((button) => {
                button.setAttribute('aria-pressed', String(button.dataset.preset === this.preset));
            });
            if (message) this.notice.textContent = message;
            this.notice.dataset.tone = this.solution?.status === 'outside' ? 'warning' : 'info';
        },

        startLoop() {
            this.stopLoop();
            if (!this.root || this.paused || this.reducedMotion) return;
            this.lastTime = 0;
            const tick = (time) => {
                if (!this.root || this.paused || this.reducedMotion) {
                    this.frame = 0;
                    return;
                }
                if (!this.lastTime) this.lastTime = time;
                const step = clamp((time - this.lastTime) / 1000, 0, MAX_FRAME_SECONDS);
                this.lastTime = time;
                this.lastStepSeconds = step;
                this.elapsed += step;
                this.target = this.trajectoryTarget(this.elapsed);
                this.solveTarget();
                this.render();
                this.frame = requestAnimationFrame(tick);
            };
            this.frame = requestAnimationFrame(tick);
        },

        stopLoop() {
            if (this.frame) cancelAnimationFrame(this.frame);
            this.frame = 0;
            this.lastTime = 0;
        },

        resize() {
            if (!this.canvas || !this.context) return;
            const rect = this.canvas.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            this.pixelRatio = clamp(window.devicePixelRatio || 1, 1, 2);
            const width = Math.max(1, Math.round(rect.width * this.pixelRatio));
            const height = Math.max(1, Math.round(rect.height * this.pixelRatio));
            if (this.canvas.width !== width || this.canvas.height !== height) {
                this.canvas.width = width;
                this.canvas.height = height;
            }
            this.context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
            this.render();
        },

        layout() {
            const width = this.canvas ? this.canvas.width / this.pixelRatio : 0;
            const height = this.canvas ? this.canvas.height / this.pixelRatio : 0;
            const compact = width < 680;
            const base = {
                x: width * (compact ? 0.24 : 0.26),
                y: height * (compact ? 0.68 : 0.7)
            };
            const scale = Math.min(
                width / (compact ? 3.75 : 4.05),
                height / (compact ? 3.35 : 3.5)
            );
            return { width, height, compact, base, scale };
        },

        modelToScreen(point, layout = this.layout()) {
            return {
                x: layout.base.x + point.x * layout.scale,
                y: layout.base.y - point.y * layout.scale
            };
        },

        screenToModel(point, layout = this.layout()) {
            return {
                x: clamp((point.x - layout.base.x) / layout.scale, -1.45, 3.05),
                y: clamp((layout.base.y - point.y) / layout.scale, -1.55, 2.65)
            };
        },

        pointerPoint(event) {
            const rect = this.canvas.getBoundingClientRect();
            return { x: event.clientX - rect.left, y: event.clientY - rect.top };
        },

        beginDrag(event) {
            if (!this.canvas || !this.solution) return;
            event.preventDefault();
            this.canvas.setPointerCapture?.(event.pointerId);
            this.dragging = true;
            this.dragPointerId = event.pointerId;
            this.paused = true;
            this.preset = 'manual';
            this.stopLoop();
            this.lastStepSeconds = 0;
            this.target = this.screenToModel(this.pointerPoint(event));
            this.solveTarget();
            this.syncUi('目标点正在拖动，CCD 解随位置实时更新。');
            this.render();
        },

        updateDrag(event) {
            if (!this.dragging || event.pointerId !== this.dragPointerId) return;
            event.preventDefault();
            this.target = this.screenToModel(this.pointerPoint(event));
            this.solveTarget();
            this.render();
        },

        endDrag(event) {
            if (!this.dragging || event.pointerId !== this.dragPointerId) return;
            event.preventDefault();
            this.canvas.releasePointerCapture?.(event.pointerId);
            this.dragging = false;
            this.dragPointerId = null;
            const status = this.solution?.status;
            const message = status === 'reachable'
                ? '目标已到达；末端误差低于求解容差。'
                : (status === 'outside' ? '目标超出最大臂长，残差已保留显示。' : '当前限位迭代未到达，残差已保留显示。');
            this.syncUi(message);
            this.render();
        },

        statusLabel(status = this.solution?.status) {
            if (status === 'reachable') return '可达';
            if (status === 'outside') return '超出臂长';
            return '受限';
        },

        snapshot() {
            const solution = this.solution;
            const end = solution?.positions?.[solution.positions.length - 1] || { x: 0, y: 0 };
            return Object.freeze({
                parameter: this.parameter,
                elapsed_seconds: this.elapsed,
                joint_limit_degrees: this.jointLimitDegrees(),
                link_lengths: Object.freeze([...LINK_LENGTHS]),
                target: Object.freeze({ ...(this.target || { x: 0, y: 0 }) }),
                end_effector: Object.freeze({ ...end }),
                residual: solution?.residual ?? 0,
                iterations: solution?.iterations ?? 0,
                status: solution?.status || 'detached',
                joint_angles_degrees: Object.freeze((solution?.angles || []).map(radiansToDegrees)),
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
                    maximum_step_seconds: MAX_FRAME_SECONDS,
                    frames_per_second: this.lastStepSeconds > 0 ? 1 / this.lastStepSeconds : 0
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
            const gradient = context.createRadialGradient(
                layout.width * 0.55,
                layout.height * 0.34,
                0,
                layout.width * 0.48,
                layout.height * 0.5,
                Math.max(layout.width, layout.height)
            );
            gradient.addColorStop(0, '#143348');
            gradient.addColorStop(0.48, '#081b2a');
            gradient.addColorStop(1, '#030912');
            context.fillStyle = gradient;
            context.fillRect(0, 0, layout.width, layout.height);

            context.save();
            context.strokeStyle = 'rgba(112, 206, 235, 0.065)';
            context.lineWidth = 1;
            const spacing = layout.compact ? 28 : 38;
            for (let x = 0; x <= layout.width; x += spacing) {
                context.beginPath();
                context.moveTo(x, 0);
                context.lineTo(x, layout.height);
                context.stroke();
            }
            for (let y = 0; y <= layout.height; y += spacing) {
                context.beginPath();
                context.moveTo(0, y);
                context.lineTo(layout.width, y);
                context.stroke();
            }
            context.restore();
        },

        drawWorkspace(context, layout) {
            const reach = this.maximumReach() * layout.scale;
            context.save();
            const reachGradient = context.createRadialGradient(
                layout.base.x,
                layout.base.y,
                reach * 0.12,
                layout.base.x,
                layout.base.y,
                reach
            );
            reachGradient.addColorStop(0, 'rgba(87, 211, 232, 0.085)');
            reachGradient.addColorStop(0.72, 'rgba(87, 211, 232, 0.035)');
            reachGradient.addColorStop(1, 'rgba(87, 211, 232, 0.005)');
            context.fillStyle = reachGradient;
            context.beginPath();
            context.arc(layout.base.x, layout.base.y, reach, 0, Math.PI * 2);
            context.fill();
            context.setLineDash([7, 8]);
            context.strokeStyle = 'rgba(111, 220, 239, 0.22)';
            context.lineWidth = 1;
            context.stroke();
            context.setLineDash([]);

            context.strokeStyle = 'rgba(188, 230, 241, 0.16)';
            context.beginPath();
            context.moveTo(0, layout.base.y);
            context.lineTo(layout.width, layout.base.y);
            context.stroke();
            context.beginPath();
            context.moveTo(layout.base.x, 0);
            context.lineTo(layout.base.x, layout.height);
            context.stroke();

            context.fillStyle = 'rgba(196, 234, 242, 0.5)';
            context.font = '600 10px ui-monospace, monospace';
            context.fillText(`Rmax ${this.maximumReach().toFixed(2)}`, layout.base.x + reach - 74, layout.base.y - 9);
            context.restore();
        },

        drawReferenceTrajectory(context, layout) {
            context.save();
            context.setLineDash([3, 7]);
            context.strokeStyle = 'rgba(255, 203, 105, 0.2)';
            context.lineWidth = 1.2;
            context.beginPath();
            for (let index = 0; index <= 96; index += 1) {
                const point = this.modelToScreen(this.trajectoryTarget(index / 96 * 12), layout);
                if (index === 0) context.moveTo(point.x, point.y);
                else context.lineTo(point.x, point.y);
            }
            context.stroke();
            context.restore();
        },

        drawTrail(context, layout) {
            if (this.trail.length < 2) return;
            const gradient = context.createLinearGradient(0, 0, layout.width, 0);
            gradient.addColorStop(0, 'rgba(78, 192, 255, 0.08)');
            gradient.addColorStop(1, 'rgba(108, 242, 207, 0.58)');
            context.save();
            context.strokeStyle = gradient;
            context.lineWidth = 2;
            context.beginPath();
            this.trail.forEach((modelPoint, index) => {
                const point = this.modelToScreen(modelPoint, layout);
                if (index === 0) context.moveTo(point.x, point.y);
                else context.lineTo(point.x, point.y);
            });
            context.stroke();
            context.restore();
        },

        drawJointArc(context, center, previousHeading, angle, limit, radius, index) {
            context.save();
            context.strokeStyle = 'rgba(255, 206, 111, 0.25)';
            context.lineWidth = 1.2;
            context.beginPath();
            context.arc(center.x, center.y, radius, -previousHeading - limit, -previousHeading + limit);
            context.stroke();

            context.strokeStyle = 'rgba(255, 220, 142, 0.82)';
            context.lineWidth = 2.2;
            context.beginPath();
            context.arc(center.x, center.y, radius, -previousHeading, -previousHeading - angle, angle > 0);
            context.stroke();
            context.fillStyle = 'rgba(235, 248, 249, 0.72)';
            context.font = '700 9px ui-monospace, monospace';
            context.fillText(`q${index + 1}`, center.x + radius + 4, center.y - 5);
            context.restore();
        },

        drawArm(context, layout) {
            if (!this.solution) return;
            const points = this.solution.positions.map((point) => this.modelToScreen(point, layout));
            const linkColors = ['#69d7ff', '#72e8c5', '#ffd176'];
            let previousHeading = 0;
            context.save();

            this.solution.angles.forEach((angle, index) => {
                this.drawJointArc(
                    context,
                    points[index],
                    previousHeading,
                    angle,
                    this.jointLimitRadians(),
                    layout.compact ? 21 + index * 2 : 28 + index * 3,
                    index
                );
                previousHeading += angle;
            });

            for (let index = 0; index < LINK_LENGTHS.length; index += 1) {
                const start = points[index];
                const end = points[index + 1];
                context.lineCap = 'round';
                context.strokeStyle = 'rgba(2, 9, 16, 0.72)';
                context.lineWidth = layout.compact ? 17 : 22;
                context.beginPath();
                context.moveTo(start.x, start.y);
                context.lineTo(end.x, end.y);
                context.stroke();

                context.strokeStyle = linkColors[index];
                context.lineWidth = layout.compact ? 10 : 13;
                context.shadowColor = `${linkColors[index]}88`;
                context.shadowBlur = 14;
                context.beginPath();
                context.moveTo(start.x, start.y);
                context.lineTo(end.x, end.y);
                context.stroke();
                context.shadowBlur = 0;

                const highlight = context.createLinearGradient(start.x, start.y, end.x, end.y);
                highlight.addColorStop(0, 'rgba(255,255,255,0.48)');
                highlight.addColorStop(0.45, 'rgba(255,255,255,0.06)');
                highlight.addColorStop(1, 'rgba(255,255,255,0.28)');
                context.strokeStyle = highlight;
                context.lineWidth = 2;
                context.beginPath();
                context.moveTo(start.x, start.y - 2);
                context.lineTo(end.x, end.y - 2);
                context.stroke();
            }

            points.slice(0, -1).forEach((point, index) => {
                context.fillStyle = '#07121d';
                context.strokeStyle = linkColors[index];
                context.lineWidth = 3;
                context.beginPath();
                context.arc(point.x, point.y, layout.compact ? 9 : 12, 0, Math.PI * 2);
                context.fill();
                context.stroke();
                context.fillStyle = '#dffaff';
                context.beginPath();
                context.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
                context.fill();
            });

            const end = points[points.length - 1];
            const heading = this.solution.angles.reduce((sum, angle) => sum + angle, 0);
            context.translate(end.x, end.y);
            context.rotate(-heading);
            context.strokeStyle = '#effcff';
            context.lineWidth = 3;
            context.lineCap = 'round';
            context.beginPath();
            context.moveTo(-2, -8);
            context.lineTo(8, -14);
            context.moveTo(-2, 8);
            context.lineTo(8, 14);
            context.stroke();
            context.restore();
        },

        drawTargetAndResidual(context, layout) {
            if (!this.solution || !this.target) return;
            const target = this.modelToScreen(this.target, layout);
            const endModel = this.solution.positions[this.solution.positions.length - 1];
            const end = this.modelToScreen(endModel, layout);
            const outside = this.solution.status === 'outside';
            const limited = this.solution.status === 'limited';
            const tone = outside ? '#ff806f' : (limited ? '#ffc765' : '#62f1d4');

            context.save();
            if (this.solution.residual > SOLVER_TOLERANCE) {
                context.setLineDash([5, 5]);
                context.strokeStyle = tone;
                context.lineWidth = 1.7;
                context.beginPath();
                context.moveTo(end.x, end.y);
                context.lineTo(target.x, target.y);
                context.stroke();
                context.setLineDash([]);
            }

            context.shadowColor = tone;
            context.shadowBlur = 18;
            context.strokeStyle = tone;
            context.lineWidth = 2.5;
            context.beginPath();
            context.arc(target.x, target.y, this.dragging ? 18 : 14, 0, Math.PI * 2);
            context.stroke();
            context.shadowBlur = 0;
            context.beginPath();
            context.moveTo(target.x - 22, target.y);
            context.lineTo(target.x + 22, target.y);
            context.moveTo(target.x, target.y - 22);
            context.lineTo(target.x, target.y + 22);
            context.stroke();
            context.fillStyle = tone;
            context.beginPath();
            context.arc(target.x, target.y, 4, 0, Math.PI * 2);
            context.fill();

            const label = outside ? 'OUTSIDE' : (limited ? 'LIMITED' : 'TARGET');
            context.fillStyle = tone;
            context.font = '700 10px ui-monospace, monospace';
            context.fillText(label, target.x + 18, target.y - 17);
            if (this.solution.residual > 0.025) {
                context.fillStyle = 'rgba(236, 247, 249, 0.72)';
                context.fillText(`e ${this.solution.residual.toFixed(3)}`, (target.x + end.x) / 2 + 7, (target.y + end.y) / 2 - 7);
            }
            context.restore();
        },

        render() {
            if (!this.context || !this.canvas || !this.readout || !this.solution) return;
            const layout = this.layout();
            if (layout.width <= 0 || layout.height <= 0) return;
            const context = this.context;
            this.drawBackground(context, layout);
            this.drawWorkspace(context, layout);
            this.drawReferenceTrajectory(context, layout);
            this.drawTrail(context, layout);
            this.drawArm(context, layout);
            this.drawTargetAndResidual(context, layout);

            const limit = this.jointLimitDegrees();
            this.root.dataset.reach = this.solution.status;
            this.readout.textContent = `主参数 ${this.parameter.toFixed(0)} · 限位 ±${limit.toFixed(1)}° · 误差 ${this.solution.residual.toFixed(3)} · 目标 (${this.target.x.toFixed(2)}, ${this.target.y.toFixed(2)})`;
            if (this.residualOutput) this.residualOutput.textContent = this.solution.residual.toFixed(4);
            if (this.iterationsOutput) this.iterationsOutput.textContent = String(this.solution.iterations);
            if (this.reachOutput) this.reachOutput.textContent = this.statusLabel();
            if (this.stageHint) this.stageHint.hidden = this.elapsed > 3.5 && !this.paused;
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
            this.residualOutput = null;
            this.iterationsOutput = null;
            this.reachOutput = null;
            this.stageHint = null;
            this.pixelRatio = 1;
            this.parameter = DEFAULT_PARAMETER;
            this.elapsed = 0;
            this.lastStepSeconds = 0;
            this.paused = false;
            this.reducedMotion = false;
            this.dragging = false;
            this.dragPointerId = null;
            this.preset = 'trajectory';
            this.target = null;
            this.angles = [...DEFAULT_ANGLES];
            this.solution = null;
            this.trail = [];
        }
    };

    window.RobotArmIk = RobotArmIk;
    window.initRobotArmIk = () => RobotArmIk.init();
    window.destroyRobotArmIk = () => RobotArmIk.destroy();
})();
