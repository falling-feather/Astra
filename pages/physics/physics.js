// ===== 力学模拟引擎 (v2) =====
// ResizeObserver + DPR + 教育面板 + destroy

const PhysicsSim = {
    canvas: null,
    ctx: null,
    balls: [],
    running: false,
    paused: false,
    lastTime: 0,
    fpsFrames: 0,
    fpsTime: 0,
    currentFps: 0,

    // 可调参数
    gravity: 980,
    restitution: 0.75,
    friction: 0.10,
    ballRadius: 16,

    // 拖拽发射
    dragStart: null,
    dragEnd: null,
    isDragging: false,

    // 颜色调色板（紫色系，匹配物理页主题）
    palette: [
        '#8b6fc0', '#a78bfa', '#7c3aed', '#6366f1',
        '#818cf8', '#c084fc', '#e879f9', '#a855f7'
    ],

    _resizeObs: null,
    _raf: null,
    _listeners: [],
    _courseState: null,
    _controlledTrial: null,
    _comparisonOverlay: false,

    init() {
        this.destroy();
        this.canvas = document.getElementById('physics-canvas');
        if (!this.canvas) return;

        this.ctx = this.canvas.getContext('2d');
        this.resizeCanvas();
        this.bindCourse();
        this.bindControls();
        this.bindCanvas();

        // ResizeObserver
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver(() => this.resizeCanvas());
            this._resizeObs.observe(this.canvas.parentElement);
        }
        this._on(window, 'resize', () => this.resizeCanvas());
        this._on(this.canvas, 'astra:physics-zoom-restored', () => this.resizeCanvas());
    },

    destroy() {
        this.running = false;
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
        if (this._resizeObs) { this._resizeObs.disconnect(); this._resizeObs = null; }
        this._listeners.forEach(({ el, event, handler, options }) => {
            el.removeEventListener(event, handler, options);
        });
        this._listeners = [];
        this.isDragging = false;
        this.dragStart = null;
        this.dragEnd = null;
        this.balls = [];
        this.paused = false;
        this.lastTime = 0;
        this.fpsFrames = 0;
        this.fpsTime = 0;
        this.currentFps = 0;
        this.W = 0;
        this.H = 0;
        this._courseState = null;
        this._controlledTrial = null;
        this._comparisonOverlay = false;
        this.canvas = null;
        this.ctx = null;
    },

    _on(el, event, handler, options) {
        if (!el) return;
        el.addEventListener(event, handler, options);
        this._listeners.push({ el, event, handler, options });
    },

    _dispatchEvidence(eventType, evidence) {
        window.dispatchEvent(new CustomEvent('astra:learning-domain-command', {
            detail: {
                galaxy_key: 'englab',
                activity_key: 'physics.mechanics',
                event_type: eventType,
                evidence
            }
        }));
    },

    _ensureCourseState() {
        if (!this._courseState) {
            this._courseState = {
                predicted: false,
                corrected: false,
                prediction: null,
                measurements: Object.create(null)
            };
        }
        return this._courseState;
    },

    _courseNode(id) {
        return document.getElementById(id);
    },

    bindCourse() {
        const prediction = this._courseNode('mechanics-prediction-submit');
        const trial040 = this._courseNode('mechanics-trial-040');
        const trial080 = this._courseNode('mechanics-trial-080');
        const correction = this._courseNode('mechanics-correction-submit');
        const replay = this._courseNode('mechanics-replay');
        this._resetCourseOwnerState();
        this._on(prediction, 'click', () => this._submitCoursePrediction());
        this._on(trial040, 'click', () => this._startControlledTrial(0.40));
        this._on(trial080, 'click', () => this._startControlledTrial(0.80));
        this._on(correction, 'click', () => this._submitCourseCorrection());
        this._on(replay, 'click', () => this._showCourseReplay());
        this._syncCourseUi();
    },

    _resetCourseOwnerState() {
        this._courseState = {
            predicted: false,
            corrected: false,
            prediction: null,
            measurements: Object.create(null)
        };
        this._controlledTrial = null;
        this._comparisonOverlay = false;
        this.balls = [];
        this.paused = false;
        this.isDragging = false;
        this.dragStart = null;
        this.dragEnd = null;

        const clearValue = id => {
            const node = this._courseNode(id);
            if (node) node.value = '';
        };
        [
            'mechanics-prediction-choice',
            'mechanics-prediction-relation',
            'mechanics-prediction-reason',
            'mechanics-correction-choice'
        ].forEach(clearValue);
        const modelLimit = this._courseNode('mechanics-model-limit');
        if (modelLimit) modelLimit.checked = false;
        [
            'mechanics-measure-h-040',
            'mechanics-measure-ratio-040',
            'mechanics-measure-h-080',
            'mechanics-measure-ratio-080'
        ].forEach(id => {
            const node = this._courseNode(id);
            if (node) node.textContent = '待测';
        });
        this._setCourseStage('等待预测');
        this._setCourseFeedback('完成预测后再运行两组受控观察。');
        this._resetFreeControls();
        const ballCount = this._courseNode('ball-count');
        if (ballCount) ballCount.textContent = '0';
        const fps = this._courseNode('physics-fps');
        if (fps) fps.textContent = '0';
        this.updateEdu();
    },

    _resetFreeControls() {
        this.gravity = 980;
        this.restitution = 0.75;
        this.friction = 0.10;
        this.ballRadius = 16;
        this.paused = false;

        const set = (id, value, outId, fmt) => {
            const element = this._courseNode(id);
            const output = this._courseNode(outId);
            if (element) element.value = value;
            if (output) output.textContent = fmt ? fmt(value) : String(value);
        };
        set('gravity-slider', 980, 'gravity-value');
        set('restitution-slider', 75, 'restitution-value', value => (value / 100).toFixed(2));
        set('friction-slider', 10, 'friction-value', value => (value / 100).toFixed(2));
        set('radius-slider', 16, 'radius-value');

        const pauseButton = this._courseNode('physics-pause');
        if (pauseButton) pauseButton.textContent = '暂停';
    },

    _setCourseFeedback(message, state = '') {
        const feedback = this._courseNode('mechanics-course-feedback');
        if (!feedback) return;
        feedback.textContent = message;
        if (state) feedback.dataset.feedbackState = state;
        else delete feedback.dataset.feedbackState;
    },

    _setCourseStage(message) {
        const node = this._courseNode('mechanics-course-stage');
        if (node) node.textContent = message;
    },

    _syncCourseUi() {
        const state = this._ensureCourseState();
        const running = Boolean(this._controlledTrial);
        const measured040 = Boolean(state.measurements['0.40']);
        const measured080 = Boolean(state.measurements['0.80']);
        const predictionButton = this._courseNode('mechanics-prediction-submit');
        const trial040 = this._courseNode('mechanics-trial-040');
        const trial080 = this._courseNode('mechanics-trial-080');
        const correction = this._courseNode('mechanics-correction-submit');
        const replay = this._courseNode('mechanics-replay');
        if (predictionButton) predictionButton.disabled = state.predicted;
        if (trial040) trial040.disabled = !state.predicted || running || measured040;
        if (trial080) trial080.disabled = !state.predicted || running || measured080;
        if (correction) {
            correction.disabled = !measured040 || !measured080 || running || state.corrected;
        }
        if (replay) replay.disabled = !measured040 || !measured080 || running;
    },

    _submitCoursePrediction() {
        const state = this._ensureCourseState();
        if (state.predicted) return false;
        const choice = this._courseNode('mechanics-prediction-choice')?.value || '';
        const relation = this._courseNode('mechanics-prediction-relation')?.value || '';
        const reason = String(this._courseNode('mechanics-prediction-reason')?.value || '').trim();
        if (!choice || !relation || reason.length < 4) {
            this._setCourseFeedback('请先选择两项判断，并用一句话写出预测理由。', 'needs-input');
            this._courseNode('mechanics-prediction-reason')?.focus();
            return false;
        }
        state.predicted = true;
        state.prediction = { choice, relation };
        this._dispatchEvidence('predicted', {
            prediction: {
                expects_higher_080: choice === 'higher-080',
                expected_height_multiplier: relation === 'four-times'
                    ? 4
                    : (relation === 'two-times' ? 2 : 0),
                reason_size: Math.min(reason.length, 160)
            },
            cursor: { stage: 'prediction-recorded' }
        });
        this._setCourseStage('预测已记录 · 请先运行 e=0.40');
        this._setCourseFeedback('现在只改变恢复系数。先运行 e=0.40，再运行 e=0.80。', 'ready');
        this._syncCourseUi();
        this._courseNode('mechanics-trial-040')?.focus();
        return true;
    },

    _startControlledTrial(restitution) {
        const state = this._ensureCourseState();
        const key = Number(restitution).toFixed(2);
        if (
            !state.predicted
            || this._controlledTrial
            || !['0.40', '0.80'].includes(key)
            || state.measurements[key]
            || !this.canvas
            || !Number.isFinite(this.W)
            || !Number.isFinite(this.H)
        ) return false;

        const radius = 16;
        const dropHeight = 200;
        const floorCenterY = this.H - radius;
        this._comparisonOverlay = false;
        this.balls = [{
            x: this.W / 2,
            y: Math.max(radius, floorCenterY - dropHeight),
            vx: 0,
            vy: 0,
            r: radius,
            color: restitution < 0.6 ? '#a78bfa' : '#38bdf8',
            trail: [],
            gravity: 980,
            friction: 0,
            restitution: Number(restitution),
            controlled: {
                restitution: Number(restitution),
                dropHeight,
                floorCenterY,
                rebounded: false,
                rising: false,
                peakY: floorCenterY
            }
        }];
        this._controlledTrial = this.balls[0].controlled;
        this.paused = false;
        this._setCourseStage(`正在观察 e=${key} 的第一次反弹`);
        this._setCourseFeedback('只看第一次峰值；不要用尾迹长度判断高度。', 'observing');
        this._syncCourseUi();
        this.updateStats();
        this.render();
        return true;
    },

    _recordControlledMeasurement(restitution, measurement) {
        const state = this._ensureCourseState();
        const key = Number(restitution).toFixed(2);
        const dropHeight = Number(measurement && measurement.dropHeight);
        const reboundHeight = Number(measurement && measurement.reboundHeight);
        if (
            !state.predicted
            || !['0.40', '0.80'].includes(key)
            || state.measurements[key]
            || !Number.isFinite(dropHeight)
            || dropHeight <= 0
            || !Number.isFinite(reboundHeight)
            || reboundHeight < 0
            || reboundHeight > dropHeight
        ) return false;
        const normalizedHeight = reboundHeight;
        const ratio = normalizedHeight / dropHeight;
        const result = Object.freeze({
            restitution: Number(key),
            dropHeight,
            reboundHeight: normalizedHeight,
            ratio
        });
        state.measurements[key] = result;
        const suffix = key === '0.40' ? '040' : '080';
        const heightNode = this._courseNode(`mechanics-measure-h-${suffix}`);
        const ratioNode = this._courseNode(`mechanics-measure-ratio-${suffix}`);
        if (heightNode) heightNode.textContent = `${normalizedHeight.toFixed(1)} px`;
        if (ratioNode) ratioNode.textContent = ratio.toFixed(2);
        this._dispatchEvidence('attempted', {
            operation: 'restitution_adjustment',
            cursor: {
                stage: 'after-observation',
                trial: key === '0.40' ? 40 : 80,
                preset: {
                    restitution: Number(key),
                    drop_height_px: dropHeight,
                    gravity_px_s2: 980,
                    radius_px: 16,
                    horizontal_velocity_px_s: 0,
                    damping: 0
                },
                observation: {
                    first_rebound_height_px: Number(normalizedHeight.toFixed(1)),
                    height_ratio: Number(ratio.toFixed(2))
                }
            }
        });

        const measured040 = Boolean(state.measurements['0.40']);
        const measured080 = Boolean(state.measurements['0.80']);
        if (measured040 && measured080) {
            const ratio040 = state.measurements['0.40'].ratio;
            const ratio080 = state.measurements['0.80'].ratio;
            const predictionMatches = state.prediction
                && state.prediction.choice === 'higher-080'
                && state.prediction.relation === 'four-times';
            this._setCourseStage('两组测量完成 · 请修正并说明模型限制');
            this._setCourseFeedback(
                `${predictionMatches ? '预测与测量方向一致。' : '测量要求修订原预测。'} `
                + `h/H 从 ${ratio040.toFixed(2)} 变为 ${ratio080.toFixed(2)}；请把速度关系连接到高度关系。`,
                predictionMatches ? 'matched' : 'revise'
            );
            this._courseNode('mechanics-correction-choice')?.focus();
        } else {
            const nextKey = measured040 ? '0.80' : '0.40';
            this._setCourseStage(`已记录 e=${key} · 请运行 e=${nextKey}`);
            this._setCourseFeedback('保持所有常量不变，完成另一组后再比较 h/H。', 'continue');
            this._courseNode(nextKey === '0.40' ? 'mechanics-trial-040' : 'mechanics-trial-080')?.focus();
        }
        this._syncCourseUi();
        return true;
    },

    _submitCourseCorrection() {
        const state = this._ensureCourseState();
        if (
            state.corrected
            || !state.measurements['0.40']
            || !state.measurements['0.80']
        ) return false;
        const choice = this._courseNode('mechanics-correction-choice')?.value || '';
        const modelLimit = Boolean(this._courseNode('mechanics-model-limit')?.checked);
        if (choice !== 'height-follows-e-squared') {
            this._setCourseFeedback('再比较两行 h/H：恢复系数先作用于碰撞后的速度，达到高度还要经过平方关系。', 'needs-revision');
            this._courseNode('mechanics-correction-choice')?.focus();
            return false;
        }
        if (!modelLimit) {
            this._setCourseFeedback('请先确认这条关系只适用于本页列出的理想化受控条件。', 'needs-limit');
            this._courseNode('mechanics-model-limit')?.focus();
            return false;
        }
        state.corrected = true;
        this._dispatchEvidence('corrected', {
            correction: {
                height_follows_e_squared: true,
                model_limit_acknowledged: true,
                ratio_040: Number(state.measurements['0.40'].ratio.toFixed(2)),
                ratio_080: Number(state.measurements['0.80'].ratio.toFixed(2))
            },
            cursor: { stage: 'after-repair' }
        });
        this._setCourseStage('修正已记录 · 最后提交结构化解释');
        this._setCourseFeedback('请在“学习证据”区记录解释：观察结果、e² 关系，以及理想模型限制。', 'explain');
        this._syncCourseUi();
        setTimeout(() => {
            const explanation = document.querySelector('[data-evidence-command="explained"]');
            if (explanation && !explanation.disabled) explanation.focus();
        }, 0);
        return true;
    },

    _showCourseReplay() {
        const state = this._ensureCourseState();
        if (!state.measurements['0.40'] || !state.measurements['0.80'] || this._controlledTrial) {
            return false;
        }
        this._comparisonOverlay = true;
        this.balls = [];
        this._setCourseStage('正在重看两次第一峰值（不新增证据）');
        this._setCourseFeedback('Canvas 标出两组峰值；数值仍以等价测量表为准。', 'replay');
        this.render();
        this._courseNode('mechanics-measurements')?.focus();
        return true;
    },

    resizeCanvas() {
        if (!this.canvas) return null;
        if (window.PhysicsZoom && window.PhysicsZoom.movedCanvas === this.canvas) return null;
        return this._resizeToContainer(this.canvas.parentElement, false);
    },

    resizeForZoom(originalParent) {
        if (
            !this.canvas
            || !originalParent
            || !window.PhysicsZoom
            || window.PhysicsZoom.movedCanvas !== this.canvas
        ) return null;
        return this._resizeToContainer(originalParent, true);
    },

    _resizeToContainer(container, renderImmediately) {
        if (!container || typeof container.getBoundingClientRect !== 'function') return null;
        const w = Number(container.getBoundingClientRect().width);
        if (!Number.isFinite(w) || w <= 0) return null;
        // 用宽度推算高度，防止 ResizeObserver 循环膨胀
        const h = Math.min(Math.max(w * 0.56, 320), 560);
        const logicalSizeChanged = Number.isFinite(this.W)
            && Number.isFinite(this.H)
            && this.W > 0
            && this.H > 0
            && (
                Math.abs(this.W - w) > 0.5
                || Math.abs(this.H - h) > 0.5
            );
        if (logicalSizeChanged && this._controlledTrial) {
            this._cancelControlledTrialForResize();
        }
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.max(1, Math.round(w * dpr));
        this.canvas.height = Math.max(1, Math.round(h * dpr));
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w;
        this.H = h;
        if (renderImmediately) this.render();
        return Object.freeze({
            width: w,
            height: h,
            dpr,
            bitmapWidth: this.canvas.width,
            bitmapHeight: this.canvas.height
        });
    },

    _cancelControlledTrialForResize() {
        if (!this._controlledTrial) return false;
        const key = Number(this._controlledTrial.restitution).toFixed(2);
        this._controlledTrial = null;
        this._comparisonOverlay = false;
        this.balls = this.balls.filter(ball => !ball || !ball.controlled);
        this.paused = false;
        this.isDragging = false;
        this.dragStart = null;
        this.dragEnd = null;
        const pauseButton = this._courseNode('physics-pause');
        if (pauseButton) pauseButton.textContent = '暂停';
        this._setCourseStage(`画布尺寸已变化 · e=${key} 可重新运行`);
        this._setCourseFeedback(
            '尺寸变化使本次轨迹失去同一几何基准；本次不记录尝试证据，请重新运行该固定预设。',
            'retry'
        );
        this.updateStats();
        this._syncCourseUi();
        return true;
    },

    bindControls() {
        const gravSlider = document.getElementById('gravity-slider');
        const restSlider = document.getElementById('restitution-slider');
        const fricSlider = document.getElementById('friction-slider');
        const radSlider = document.getElementById('radius-slider');
        const clearBtn = document.getElementById('physics-clear');
        const pauseBtn = document.getElementById('physics-pause');

        this._on(gravSlider, 'input', () => {
            this.gravity = +gravSlider.value;
            document.getElementById('gravity-value').textContent = gravSlider.value;
        });

        this._on(restSlider, 'input', () => {
            this.restitution = +restSlider.value / 100;
            document.getElementById('restitution-value').textContent = this.restitution.toFixed(2);
        });

        this._on(fricSlider, 'input', () => {
            this.friction = +fricSlider.value / 100;
            document.getElementById('friction-value').textContent = this.friction.toFixed(2);
        });

        this._on(radSlider, 'input', () => {
            this.ballRadius = +radSlider.value;
            document.getElementById('radius-value').textContent = radSlider.value;
        });

        const settleFreeExplorationControl = () => {
            this.updateEdu();
            this.render();
        };
        [gravSlider, restSlider, fricSlider, radSlider].forEach(slider => {
            this._on(slider, 'change', settleFreeExplorationControl);
        });

        this._on(clearBtn, 'click', () => {
            this.resetScene();
        });

        this._on(pauseBtn, 'click', () => {
            this.paused = !this.paused;
            pauseBtn.textContent = this.paused ? '继续' : '暂停';
        });
    },

    resetScene() {
        if (this._controlledTrial) {
            const key = Number(this._controlledTrial.restitution).toFixed(2);
            this._controlledTrial = null;
            this._setCourseStage(`e=${key} 观察已清空 · 可重新运行`);
            this._setCourseFeedback('本次未形成测量，也没有写入尝试证据。请重新运行同一固定预设。', 'retry');
        }
        this._comparisonOverlay = false;
        this.balls = [];
        this._resetFreeControls();

        this.updateStats();
        this.render();
        this._syncCourseUi();
    },

    bindCanvas() {
        const getPos = (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            return { x: clientX - rect.left, y: clientY - rect.top };
        };

        // Mouse
        this._on(this.canvas, 'mousedown', (e) => {
            if (this._controlledTrial) return;
            this.dragStart = getPos(e);
            this.isDragging = true;
        });

        this._on(this.canvas, 'mousemove', (e) => {
            if (this.isDragging) this.dragEnd = getPos(e);
        });

        this._on(this.canvas, 'mouseup', (e) => {
            if (this.isDragging && this.dragStart) {
                const end = getPos(e);
                this.launchBall(this.dragStart, end);
            }
            this.isDragging = false;
            this.dragStart = null;
            this.dragEnd = null;
        });

        // Touch
        this._on(this.canvas, 'touchstart', (e) => {
            e.preventDefault();
            if (this._controlledTrial) return;
            this.dragStart = getPos(e);
            this.isDragging = true;
        }, { passive: false });

        this._on(this.canvas, 'touchmove', (e) => {
            e.preventDefault();
            if (this.isDragging) this.dragEnd = getPos(e);
        }, { passive: false });

        this._on(this.canvas, 'touchend', (e) => {
            if (this.isDragging && this.dragStart) {
                const end = this.dragEnd || this.dragStart;
                this.launchBall(this.dragStart, end);
            }
            this.isDragging = false;
            this.dragStart = null;
            this.dragEnd = null;
        });
    },

    launchBall(start, end) {
        if (this._controlledTrial) return false;
        this._comparisonOverlay = false;
        const dx = start.x - end.x;
        const dy = start.y - end.y;
        const speed = Math.sqrt(dx * dx + dy * dy) * 3;
        const angle = Math.atan2(dy, dx);

        // Cap at 100 balls for performance
        if (this.balls.length >= 100) {
            this.balls.shift();
        }

        this.balls.push({
            x: start.x,
            y: start.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            r: this.ballRadius,
            color: this.palette[Math.floor(Math.random() * this.palette.length)],
            trail: []
        });

        this.updateStats();
        return true;
    },

    start() {
        if (this.running) return;
        this.running = true;
        this.lastTime = performance.now();
        this.fpsTime = this.lastTime;
        this.loop();
    },

    stop() {
        this.running = false;
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    },

    loop() {
        if (!this.running) return;
        this._raf = requestAnimationFrame(() => this.loop());

        const now = performance.now();
        const dt = Math.min((now - this.lastTime) / 1000, 0.032); // Cap at ~30fps min
        this.lastTime = now;

        // FPS counter
        this.fpsFrames++;
        if (now - this.fpsTime >= 500) {
            this.currentFps = Math.round(this.fpsFrames / ((now - this.fpsTime) / 1000));
            this.fpsFrames = 0;
            this.fpsTime = now;
            const el = document.getElementById('physics-fps');
            if (el) el.textContent = this.currentFps;
        }

        if (!this.paused) this.update(dt);
        this.render();
    },

    update(dt) {
        for (let i = 0; i < this.balls.length; i++) {
            const b = this.balls[i];
            if (b.controlled?.completed) continue;
            const g = Number.isFinite(b.gravity) ? b.gravity : this.gravity;
            const rest = Number.isFinite(b.restitution) ? b.restitution : this.restitution;
            const fric = Number.isFinite(b.friction) ? b.friction : this.friction;

            // Gravity
            b.vy += g * dt;

            // Apply friction (air resistance)
            b.vx *= (1 - fric * dt);
            b.vy *= (1 - fric * 0.3 * dt);

            // Move
            b.x += b.vx * dt;
            b.y += b.vy * dt;

            // Trail (store last 8 positions)
            b.trail.push({ x: b.x, y: b.y });
            if (b.trail.length > 8) b.trail.shift();

            // Wall collisions
            if (b.x - b.r < 0) {
                b.x = b.r;
                b.vx = Math.abs(b.vx) * rest;
            }
            if (b.x + b.r > this.W) {
                b.x = this.W - b.r;
                b.vx = -Math.abs(b.vx) * rest;
            }
            if (b.y + b.r > this.H) {
                b.y = this.H - b.r;
                b.vy = -Math.abs(b.vy) * rest;
                if (b.controlled && !b.controlled.rebounded) {
                    b.controlled.rebounded = true;
                    b.controlled.rising = true;
                    b.controlled.peakY = b.y;
                }

                // Friction on ground
                b.vx *= (1 - fric);

                // Stop micro-bouncing
                if (Math.abs(b.vy) < 15) {
                    b.vy = 0;
                    b.y = this.H - b.r;
                }
            }
            if (b.y - b.r < 0) {
                b.y = b.r;
                b.vy = Math.abs(b.vy) * rest;
            }

            if (b.controlled?.rebounded && !b.controlled.completed) {
                if (b.vy < 0) {
                    b.controlled.rising = true;
                    b.controlled.peakY = Math.min(b.controlled.peakY, b.y);
                } else if (b.controlled.rising) {
                    b.controlled.completed = true;
                    b.y = b.controlled.peakY;
                    b.vx = 0;
                    b.vy = 0;
                    const reboundHeight = Math.max(
                        0,
                        b.controlled.floorCenterY - b.controlled.peakY
                    );
                    if (this._controlledTrial === b.controlled) {
                        this._controlledTrial = null;
                        this._recordControlledMeasurement(
                            b.controlled.restitution,
                            {
                                dropHeight: b.controlled.dropHeight,
                                reboundHeight
                            }
                        );
                    }
                }
            }

            // Ball-to-ball collisions
            for (let j = i + 1; j < this.balls.length; j++) {
                this.resolveCollision(b, this.balls[j]);
            }
        }
    },

    resolveCollision(a, b) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = a.r + b.r;

        if (dist >= minDist || dist === 0) return;

        // Normalize
        const nx = dx / dist;
        const ny = dy / dist;

        // Separate
        const overlap = (minDist - dist) / 2;
        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;

        // Relative velocity along normal
        const dvx = a.vx - b.vx;
        const dvy = a.vy - b.vy;
        const relVn = dvx * nx + dvy * ny;

        if (relVn < 0) return; // Moving apart

        // Equal mass elastic collision with restitution
        const impulse = relVn * (1 + this.restitution) / 2;
        a.vx -= impulse * nx;
        a.vy -= impulse * ny;
        b.vx += impulse * nx;
        b.vy += impulse * ny;
    },

    render() {
        const ctx = this.ctx;
        if (!ctx || !Number.isFinite(this.W) || !Number.isFinite(this.H)) return;
        ctx.clearRect(0, 0, this.W, this.H);

        // Subtle grid
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.lineWidth = 1;
        const gridSize = 40;
        for (let x = gridSize; x < this.W; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, this.H);
            ctx.stroke();
        }
        for (let y = gridSize; y < this.H; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(this.W, y);
            ctx.stroke();
        }

        // Ground line
        ctx.strokeStyle = 'rgba(139,111,192,0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, this.H - 1);
        ctx.lineTo(this.W, this.H - 1);
        ctx.stroke();

        this._renderCourseGuide(ctx);

        // Balls
        for (const b of this.balls) {
            // Trail
            if (b.trail.length > 1) {
                const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
                if (speed > 30) {
                    ctx.beginPath();
                    ctx.moveTo(b.trail[0].x, b.trail[0].y);
                    for (let t = 1; t < b.trail.length; t++) {
                        ctx.lineTo(b.trail[t].x, b.trail[t].y);
                    }
                    ctx.strokeStyle = b.color + '30';
                    ctx.lineWidth = b.r * 0.6;
                    ctx.lineCap = 'round';
                    ctx.stroke();
                }
            }

            // Ball body
            const gradient = ctx.createRadialGradient(
                b.x - b.r * 0.3, b.y - b.r * 0.3, 0,
                b.x, b.y, b.r
            );
            gradient.addColorStop(0, b.color + 'ff');
            gradient.addColorStop(0.7, b.color + 'cc');
            gradient.addColorStop(1, b.color + '66');

            ctx.beginPath();
            ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
            ctx.fillStyle = gradient;
            ctx.fill();

            // Highlight
            ctx.beginPath();
            ctx.arc(b.x - b.r * 0.25, b.y - b.r * 0.25, b.r * 0.35, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,0.2)';
            ctx.fill();

            // Shadow on ground
            if (b.y + b.r < this.H) {
                const shadowY = this.H - 2;
                const proximity = 1 - ((shadowY - b.y) / this.H);
                const shadowR = b.r * (0.5 + proximity * 0.5);
                ctx.beginPath();
                ctx.ellipse(b.x, shadowY, shadowR, 3, 0, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(0,0,0,${proximity * 0.15})`;
                ctx.fill();
            }
        }

        // Drag arrow
        if (this.isDragging && this.dragStart && this.dragEnd) {
            const dx = this.dragStart.x - this.dragEnd.x;
            const dy = this.dragStart.y - this.dragEnd.y;
            const len = Math.sqrt(dx * dx + dy * dy);

            if (len > 5) {
                ctx.save();
                ctx.strokeStyle = 'rgba(167,139,250,0.6)';
                ctx.lineWidth = 2;
                ctx.setLineDash([6, 4]);
                ctx.beginPath();
                ctx.moveTo(this.dragStart.x, this.dragStart.y);
                ctx.lineTo(this.dragStart.x + dx, this.dragStart.y + dy);
                ctx.stroke();
                ctx.setLineDash([]);

                // Arrowhead
                const angle = Math.atan2(dy, dx);
                const aLen = 10;
                ctx.fillStyle = 'rgba(167,139,250,0.6)';
                ctx.beginPath();
                ctx.moveTo(this.dragStart.x + dx, this.dragStart.y + dy);
                ctx.lineTo(
                    this.dragStart.x + dx - aLen * Math.cos(angle - 0.4),
                    this.dragStart.y + dy - aLen * Math.sin(angle - 0.4)
                );
                ctx.lineTo(
                    this.dragStart.x + dx - aLen * Math.cos(angle + 0.4),
                    this.dragStart.y + dy - aLen * Math.sin(angle + 0.4)
                );
                ctx.fill();
                ctx.restore();

                // Preview ball
                ctx.beginPath();
                ctx.arc(this.dragStart.x, this.dragStart.y, this.ballRadius, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(167,139,250,0.5)';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        }

        // Empty state hint
        if (this.balls.length === 0 && !this.isDragging && !this._comparisonOverlay) {
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            ctx.font = '20px ' + CF.sans;
            ctx.textAlign = 'center';
            ctx.fillText('在画布上拖拽来发射小球', this.W / 2, this.H / 2 - 10);
            ctx.font = '18px ' + CF.sans;
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            ctx.fillText('拖拽方向和距离决定发射速度', this.W / 2, this.H / 2 + 15);
        }
    },

    _renderCourseGuide(ctx) {
        const active = this._controlledTrial;
        if (active) {
            const startY = active.floorCenterY - active.dropHeight;
            ctx.save();
            ctx.strokeStyle = 'rgba(125, 211, 252, 0.75)';
            ctx.fillStyle = 'rgba(224, 242, 254, 0.92)';
            ctx.lineWidth = 2;
            ctx.setLineDash([7, 5]);
            ctx.beginPath();
            ctx.moveTo(Math.max(16, this.W * 0.18), startY);
            ctx.lineTo(Math.min(this.W - 16, this.W * 0.82), startY);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.font = `600 14px ${CF.sans}`;
            ctx.textAlign = 'left';
            ctx.fillText(
                `固定下落高度 200 px · e=${active.restitution.toFixed(2)}`,
                Math.max(16, this.W * 0.18),
                Math.max(22, startY - 10)
            );
            ctx.restore();
        }

        if (!this._comparisonOverlay) return;
        const state = this._ensureCourseState();
        const entries = [
            ['0.40', state.measurements['0.40'], '#a78bfa'],
            ['0.80', state.measurements['0.80'], '#38bdf8']
        ].filter(([, measurement]) => Boolean(measurement));
        if (entries.length !== 2) return;

        ctx.save();
        ctx.font = `600 14px ${CF.sans}`;
        ctx.textAlign = 'center';
        entries.forEach(([key, measurement, color], index) => {
            const x = this.W * (index === 0 ? 0.34 : 0.66);
            const floorY = this.H - 1;
            const height = Math.min(this.H - 72, Math.max(2, measurement.reboundHeight));
            ctx.fillStyle = color + '33';
            ctx.fillRect(x - 34, floorY - height, 68, height);
            ctx.strokeStyle = color;
            ctx.lineWidth = 3;
            ctx.strokeRect(x - 34, floorY - height, 68, height);
            ctx.fillStyle = 'rgba(248, 250, 252, 0.94)';
            ctx.fillText(`e=${key}`, x, Math.max(24, floorY - height - 28));
            ctx.fillText(
                `h/H=${measurement.ratio.toFixed(2)}`,
                x,
                Math.max(44, floorY - height - 8)
            );
        });
        ctx.restore();
    },

    updateStats() {
        const el = document.getElementById('ball-count');
        if (el) el.textContent = this.balls.length;
        this.updateEdu();
    },

    updateEdu() {
        let eduEl = document.getElementById('physics-edu');
        if (!eduEl) {
            const parent = document.getElementById('physics-info') || document.getElementById('ball-count')?.closest('.physics-info');
            if (!parent) return;
            const container = parent.parentElement || parent;
            eduEl = document.createElement('div');
            eduEl.id = 'physics-edu';
            eduEl.style.cssText = 'font-size:12px;color:#a78bfa;margin-top:8px;line-height:1.5;opacity:0.8;';
            container.appendChild(eduEl);
        }
        if (this.balls.length === 0) {
            eduEl.innerHTML = `<strong>自由探索</strong>：在画布上拖拽会给小球一个初速度；滑块中的“摩擦力”是教学耗散参数，不代表完整的接触摩擦模型。`;
        } else {
            const totalKE = this.balls.reduce((s, b) => s + 0.5 * (b.vx * b.vx + b.vy * b.vy), 0);
            const totalPE = this.balls.reduce((s, b) => {
                const gravity = Number.isFinite(b.gravity) ? b.gravity : this.gravity;
                return s + gravity * (this.H - b.y);
            }, 0);
            const activePreset = this._controlledTrial
                ? `受控预设 e=${this._controlledTrial.restitution.toFixed(2)}：固定落高 200 px、竖直释放、教学耗散为 0。`
                : `自由探索参数：g=${this.gravity} px/s²，e=${this.restitution.toFixed(2)}，教学耗散=${this.friction.toFixed(2)}。`;
            eduEl.innerHTML =
                `<strong>运动状态</strong>：${activePreset}` +
                `<br>球数: ${this.balls.length}，` +
                `动能代理值 ${totalKE.toFixed(0)}，` +
                `重力势能代理值 ${totalPE.toFixed(0)}` +
                `<br>ℹ️ 本页数值采用像素单位，只用于同一模型内比较，不能直接当作 SI 能量。`;
        }
    }
};

// ===== 物理页初始化 =====
function initPhysics() {
    PhysicsSim.init();
    PhysicsSim.start();
}

window.PhysicsSim = PhysicsSim;
