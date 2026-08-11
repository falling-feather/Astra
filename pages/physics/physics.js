// ===== 力学模拟引擎 (v2) =====
// ResizeObserver + DPR + 教育面板 + destroy

const MECHANICS_STAGE = Object.freeze({
    P0: 'P0_AWAIT_PREDICTION',
    P1: 'P1_READY_040',
    P2: 'P2_RUNNING_040',
    P3: 'P3_SNAPSHOT_040',
    P4: 'P4_RUNNING_080',
    P5: 'P5_COMPARE',
    P6: 'P6_CORRECT',
    P7: 'P7_EXPLAIN',
    P8: 'P8_AWAIT_COMPLETION'
});

const MECHANICS_AUTHORITY_ERRORS = new Set([
    'pending_recovery_manual_intervention',
    'identity_required',
    'student_role_required',
    'activity_hidden',
    'activity_locked',
    'course_scope_missing',
    'course_scope_ambiguous',
    'course_unit_missing',
    'course_unit_ambiguous',
    'publication_context_unavailable',
    'cancelled'
]);

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
    _evidenceBinding: null,
    _courseActionInFlight: false,
    _courseRecordPermit: null,
    _panelCommandPermit: null,
    _courseRetryIds: new Map(),
    _courseGeneration: 0,
    _courseNextFocus: '',
    _motionQuery: null,
    _reducedMotion: false,
    _lastReducedRender: 0,
    _lastCourseHudUpdate: 0,
    _courseVisualPhase: '',
    _courseVisualDirty: true,

    init() {
        this.destroy();
        this.canvas = document.getElementById('physics-canvas');
        if (!this.canvas) return;

        this.ctx = this.canvas.getContext('2d');
        this._motionQuery = typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-reduced-motion: reduce)')
            : null;
        this._reducedMotion = Boolean(this._motionQuery && this._motionQuery.matches);
        if (this._motionQuery && typeof this._motionQuery.addEventListener === 'function') {
            this._on(this._motionQuery, 'change', event => {
                this._reducedMotion = Boolean(event && event.matches);
                this._courseVisualDirty = true;
                this.render();
            });
        }
        this.resizeCanvas();
        this.bindCourse();
        this.bindControls();
        this.bindCanvas();

        // ResizeObserver
        if (typeof ResizeObserver !== 'undefined') {
            const resizeContainer = this.canvas.parentElement;
            this._resizeObs = new ResizeObserver(() => {
                const zoom = window.PhysicsZoom;
                if (
                    zoom
                    && typeof zoom.syncOriginalParentResize === 'function'
                    && zoom.syncOriginalParentResize(this.canvas, resizeContainer)
                ) return;
                this.resizeCanvas();
            });
            this._resizeObs.observe(resizeContainer);
        }
        this._on(window, 'resize', () => this.resizeCanvas());
        this._on(this.canvas, 'astra:physics-zoom-restored', () => this.resizeCanvas());
    },

    destroy() {
        this._courseGeneration += 1;
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
        this._evidenceBinding = null;
        this._courseActionInFlight = false;
        this._courseRecordPermit = null;
        this._panelCommandPermit = null;
        this._courseRetryIds = new Map();
        this._courseNextFocus = '';
        this._motionQuery = null;
        this._reducedMotion = false;
        this._lastReducedRender = 0;
        this._lastCourseHudUpdate = 0;
        this._courseVisualPhase = '';
        this._courseVisualDirty = true;
        this.canvas = null;
        this.ctx = null;
    },

    _on(el, event, handler, options) {
        if (!el) return;
        el.addEventListener(event, handler, options);
        this._listeners.push({ el, event, handler, options });
    },

    _courseError(code, message) {
        const error = new Error(message || code || 'learning_evidence_failed');
        error.code = code || 'learning_evidence_failed';
        return error;
    },

    _evidenceResultMatchesRequest(result, clientEventId, eventType) {
        return Boolean(
            result
            && result.client_event_id === clientEventId
            && result.event_type === eventType
        );
    },

    _isAuthoritativeEvidenceResult(result, clientEventId, eventType) {
        return Boolean(
            this._evidenceResultMatchesRequest(result, clientEventId, eventType)
            && ['confirmed', 'reconciled'].includes(result.outcome)
            && result.state === 'confirmed'
        );
    },

    _isManualEvidenceResult(result, clientEventId, eventType) {
        return Boolean(
            this._evidenceResultMatchesRequest(result, clientEventId, eventType)
            && result.outcome === 'manual-intervention'
            && result.state === 'manual-intervention'
        );
    },

    _createCourseEventId(eventType) {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }
        return `mechanics-${eventType}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    },

    _setDisabled(node, disabled) {
        if (!node) return;
        node.disabled = Boolean(disabled);
        if (typeof node.setAttribute === 'function') {
            node.setAttribute('aria-disabled', disabled ? 'true' : 'false');
        }
    },

    _refreshEvidenceCommands() {
        const controller = this._evidenceBinding && this._evidenceBinding.controller;
        if (controller && typeof controller.refreshCommands === 'function') {
            controller.refreshCommands();
        }
    },

    _bindingIsCurrent(binding = this._evidenceBinding, generation = this._courseGeneration) {
        return Boolean(
            binding
            && binding === this._evidenceBinding
            && binding.generation === generation
            && generation === this._courseGeneration
            && this.canvas
            && (typeof binding.isActive !== 'function' || binding.isActive())
        );
    },

    async _authorizeCourseBinding(binding, generation) {
        if (!this._bindingIsCurrent(binding, generation)) {
            throw this._courseError('cancelled');
        }
        const current = await binding.resolveAuthority(binding.context);
        if (!this._bindingIsCurrent(binding, generation)) {
            throw this._courseError('cancelled');
        }
        if (!binding.sameAuthority(binding.context, current)) {
            throw this._courseError(current && current.error_code || 'identity_required');
        }
        return current;
    },

    bindCourseEvidence(controller, options = {}) {
        const state = this._ensureCourseState();
        const context = controller && typeof controller.context === 'function'
            ? controller.context()
            : null;
        const validContext = context
            && context.available === true
            && Number.isInteger(Number(context.class_id))
            && Number(context.class_id) > 0
            && Number.isInteger(Number(context.course_id))
            && Number(context.course_id) > 0
            && Number.isInteger(Number(context.course_unit_id))
            && Number(context.course_unit_id) > 0
            && context.activity_key === 'physics.mechanics'
            && String(context.identity_id || '').trim() !== ''
            && Number.isInteger(Number(context.authority_generation))
            && Number(context.authority_generation) >= 0
            && context.access_state === 'open';
        if (
            !validContext
            || !controller
            || typeof controller.record !== 'function'
            || typeof controller.consumeCommandReceipt !== 'function'
            || typeof options.resolveAuthority !== 'function'
            || typeof options.sameAuthority !== 'function'
            || typeof options.isActive === 'function' && !options.isActive()
        ) {
            return this.blockCourseEvidence(this._courseError('publication_context_unavailable'));
        }
        this._evidenceBinding = {
            controller,
            context,
            resolveAuthority: options.resolveAuthority,
            sameAuthority: options.sameAuthority,
            isActive: options.isActive,
            generation: this._courseGeneration
        };
        state.evidenceReady = true;
        state.blocked = false;
        this._setCourseStage('证据范围已确认 · 等待预测');
        this._setCourseFeedback(
            '请从预测开始一组新的受控观察；刷新后不会把离散历史拼成“已恢复”的完整实验组。',
            'ready'
        );
        this._syncCourseUi();
        return true;
    },

    blockCourseEvidence(error) {
        const state = this._ensureCourseState();
        const code = error && error.code || 'publication_context_unavailable';
        this._controlledTrial = null;
        this.balls = this.balls.filter(ball => !ball || !ball.controlled);
        state.evidenceReady = false;
        state.blocked = true;
        this._courseActionInFlight = false;
        this._courseRecordPermit = null;
        this._panelCommandPermit = null;
        const manual = code === 'pending_recovery_manual_intervention';
        this._setCourseStage(manual ? '证据冲突需处理 · 本活动只读' : '学习证据不可用 · 本活动只读');
        this._setCourseFeedback(
            manual
                ? '当前作用域存在需人工处理的证据冲突；所有受控实验输入与动作已禁用。'
                : '无法确认当前身份、路由与课程作用域；所有受控实验输入与动作已失败关闭。',
            'blocked'
        );
        this._setCourseVisualPhase('blocked', null);
        this._syncCourseUi();
        return false;
    },

    _handleCourseActionError(error, retryMessage) {
        const code = error && error.code || '';
        if (MECHANICS_AUTHORITY_ERRORS.has(code)) return this.blockCourseEvidence(error);
        this._setCourseFeedback(
            retryMessage || '本次证据尚未获得权威确认；当前阶段保持锁定，系统会复用原事件编号等待同步或重试。',
            'retry'
        );
        return false;
    },

    authorizeCourseRecord(eventType, evidence) {
        const permit = this._courseRecordPermit;
        return Boolean(
            permit
            && permit.eventType === eventType
            && permit.evidence === evidence
            && permit.generation === this._courseGeneration
            && this._courseActionInFlight
            && this._bindingIsCurrent(permit.binding, permit.generation)
        );
    },

    canUseCourseEvidenceCommand(command) {
        const state = this._ensureCourseState();
        return command === 'explained'
            && state.stage === MECHANICS_STAGE.P7
            && state.evidenceReady
            && !state.blocked
            && !this._courseActionInFlight
            && this._bindingIsCurrent();
    },

    beginCourseEvidenceCommand(detail) {
        if (
            !detail
            || detail.event_type !== 'explained'
            || !this.canUseCourseEvidenceCommand('explained')
        ) return null;
        const binding = this._evidenceBinding;
        const clientEventId = this._courseRetryIds.get('explain')
            || this._createCourseEventId('explained');
        this._courseRetryIds.set('explain', clientEventId);
        this._courseActionInFlight = true;
        this._courseRecordPermit = {
            binding,
            generation: this._courseGeneration,
            eventType: 'explained',
            evidence: detail.evidence
        };
        this._panelCommandPermit = Object.freeze({
            client_event_id: clientEventId,
            event_type: 'explained',
            evidence: detail.evidence,
            owner_generation: this._courseGeneration,
            binding_generation: binding.generation,
            authority_generation: Number(binding.context.authority_generation)
        });
        this._syncCourseUi();
        return this._panelCommandPermit;
    },

    completeCourseEvidenceCommand(detail) {
        const permit = detail && detail.permit;
        const state = this._ensureCourseState();
        const binding = this._evidenceBinding;
        const controller = binding && binding.controller;
        const recordPermit = this._courseRecordPermit;
        if (
            !permit
            || permit !== this._panelCommandPermit
            || permit.owner_generation !== this._courseGeneration
            || permit.binding_generation !== binding?.generation
            || permit.authority_generation !== Number(binding?.context?.authority_generation)
            || permit.event_type !== 'explained'
            || detail.event_type !== 'explained'
            || detail.evidence !== permit.evidence
            || detail.client_event_id !== permit.client_event_id
            || !recordPermit
            || recordPermit.binding !== binding
            || recordPermit.generation !== permit.binding_generation
            || recordPermit.eventType !== detail.event_type
            || recordPermit.evidence !== detail.evidence
            || typeof controller?.consumeCommandReceipt !== 'function'
            || !this._bindingIsCurrent(binding, permit.binding_generation)
            || state.stage !== MECHANICS_STAGE.P7
        ) return false;
        const recorded = controller.consumeCommandReceipt(detail.receipt, {
            permit,
            result: detail.result,
            evidence: detail.evidence,
            event_type: detail.event_type,
            client_event_id: detail.client_event_id,
            owner_generation: permit.owner_generation,
            binding_generation: permit.binding_generation,
            authority_generation: permit.authority_generation
        });
        if (!recorded) return false;
        const result = recorded.result;
        this._courseRecordPermit = null;
        this._panelCommandPermit = null;
        this._courseActionInFlight = false;
        if (this._isManualEvidenceResult(result, detail.client_event_id, detail.event_type)) {
            return this.blockCourseEvidence(this._courseError('pending_recovery_manual_intervention'));
        }
        if (!this._isAuthoritativeEvidenceResult(result, detail.client_event_id, detail.event_type)) {
            this._setCourseFeedback('解释尚未获得权威确认；当前阶段保持锁定，系统会复用本次解释的事件编号等待同步或重试。', 'retry');
            this._syncCourseUi();
            return false;
        }
        this._courseRetryIds.delete('explain');
        state.stage = MECHANICS_STAGE.P8;
        this._setCourseStage('解释已记录 · 等待服务端完成投影');
        this._setCourseFeedback('客户端不会自行标记完成；最终状态只认下方服务端学习投影。', 'waiting');
        this._courseNextFocus = 'mechanics-prediction-submit';
        this._syncCourseUi();
        const next = this._courseNode(this._courseNextFocus);
        this._courseNextFocus = '';
        if (next && !next.disabled) next.focus();
        return true;
    },

    failCourseEvidenceCommand(error) {
        if (!this._panelCommandPermit) return false;
        this._courseRecordPermit = null;
        this._panelCommandPermit = null;
        this._courseActionInFlight = false;
        const result = this._handleCourseActionError(error, '解释尚未获得权威确认；当前阶段保持锁定，系统会复用本次解释的事件编号等待同步或重试。');
        this._syncCourseUi();
        return result;
    },

    _ensureCourseState() {
        if (!this._courseState) {
            this._courseState = {
                prediction: null,
                measurements: Object.create(null),
                stage: MECHANICS_STAGE.P0,
                evidenceReady: false,
                blocked: false
            };
        }
        return this._courseState;
    },

    _courseNode(id) {
        return document.getElementById(id);
    },

    async _runCourseAction(action) {
        const state = this._ensureCourseState();
        const binding = this._evidenceBinding;
        const generation = this._courseGeneration;
        if (
            this._courseActionInFlight
            || state.blocked
            || !state.evidenceReady
            || !this._bindingIsCurrent(binding, generation)
        ) {
            this._syncCourseUi();
            return false;
        }
        this._courseActionInFlight = true;
        this._courseNextFocus = '';
        this._syncCourseUi();
        try {
            return await action({ binding, generation });
        } catch (error) {
            if (this._bindingIsCurrent(binding, generation)) this._handleCourseActionError(error);
            return false;
        } finally {
            if (generation === this._courseGeneration) {
                this._courseActionInFlight = false;
                this._courseRecordPermit = null;
                this._syncCourseUi();
                const next = this._courseNextFocus === '@evidence-explained'
                    ? document.querySelector('[data-evidence-command="explained"]')
                    : this._courseNode(this._courseNextFocus);
                this._courseNextFocus = '';
                if (next && !next.disabled) next.focus();
            }
        }
    },

    async _recordCourseEvidence(actionKey, eventType, evidence, binding, generation, isStillValid) {
        await this._authorizeCourseBinding(binding, generation);
        if (!this._bindingIsCurrent(binding, generation)) throw this._courseError('cancelled');
        if (typeof isStillValid === 'function' && !isStillValid()) {
            throw this._courseError('cancelled');
        }
        const clientEventId = this._courseRetryIds.get(actionKey)
            || this._createCourseEventId(eventType);
        this._courseRetryIds.set(actionKey, clientEventId);
        const permit = {
            binding,
            generation,
            eventType,
            evidence
        };
        this._courseRecordPermit = permit;
        let result;
        try {
            result = await binding.controller.record(eventType, evidence, {
                client_event_id: clientEventId
            });
            if (!this._bindingIsCurrent(binding, generation) || this._courseRecordPermit !== permit) {
                throw this._courseError('cancelled');
            }
            if (typeof isStillValid === 'function' && !isStillValid()) {
                throw this._courseError('cancelled');
            }
            if (this._isManualEvidenceResult(result, clientEventId, eventType)) {
                throw this._courseError('pending_recovery_manual_intervention');
            }
            if (!this._isAuthoritativeEvidenceResult(result, clientEventId, eventType)) {
                throw this._courseError('learning_evidence_failed');
            }
            await this._authorizeCourseBinding(binding, generation);
            if (!this._bindingIsCurrent(binding, generation) || this._courseRecordPermit !== permit) {
                throw this._courseError('cancelled');
            }
            this._courseRetryIds.delete(actionKey);
            return result;
        } finally {
            if (this._courseRecordPermit === permit) this._courseRecordPermit = null;
        }
    },

    bindCourse() {
        this._mountCourseShowcase();
        const prediction = this._courseNode('mechanics-prediction-submit');
        const trial040 = this._courseNode('mechanics-trial-040');
        const trial080 = this._courseNode('mechanics-trial-080');
        const correction = this._courseNode('mechanics-correction-submit');
        const replay = this._courseNode('mechanics-replay');
        this._resetCourseOwnerState();
        this._on(prediction, 'click', () => {
            const stage = this._ensureCourseState().stage;
            const action = stage === MECHANICS_STAGE.P0
                ? this._submitCoursePrediction()
                : this._redoCourseGroup();
            Promise.resolve(action).catch(() => {});
        });
        this._on(trial040, 'click', () => {
            Promise.resolve(this._startControlledTrial(0.40)).catch(() => {});
        });
        this._on(trial080, 'click', () => {
            Promise.resolve(this._startControlledTrial(0.80)).catch(() => {});
        });
        this._on(correction, 'click', () => {
            Promise.resolve(this._submitCourseCorrection()).catch(() => {});
        });
        this._on(replay, 'click', () => {
            Promise.resolve(this._showCourseReplay()).catch(() => {});
        });
        this._syncCourseUi();
    },

    _mountCourseShowcase() {
        if (typeof document.createElement !== 'function'
            || typeof document.querySelector !== 'function') return;
        const root = document.querySelector('[data-mechanics-course]');
        if (root && typeof root.querySelector === 'function') {
            if (!root.querySelector('[data-mechanics-progress]')
                && typeof root.insertBefore === 'function') {
                const progress = document.createElement('nav');
                progress.className = 'mechanics-course__progress';
                progress.dataset.mechanicsProgress = 'true';
                progress.setAttribute('aria-label', '恢复系数实验学习步骤');
                progress.innerHTML = `
                    <ol>
                        <li data-mechanics-progress-step="0"><span>01</span><strong>预测</strong></li>
                        <li data-mechanics-progress-step="1"><span>02</span><strong>e=0.40</strong></li>
                        <li data-mechanics-progress-step="2"><span>03</span><strong>e=0.80</strong></li>
                        <li data-mechanics-progress-step="3"><span>04</span><strong>比较</strong></li>
                        <li data-mechanics-progress-step="4"><span>05</span><strong>修正</strong></li>
                        <li data-mechanics-progress-step="5"><span>06</span><strong>解释</strong></li>
                    </ol>`;
                const goal = root.querySelector('.mechanics-course__goal');
                root.insertBefore(progress, goal && goal.nextSibling || root.firstChild || null);
            }
            if (!root.querySelector('[data-mechanics-locks]')
                && typeof root.insertBefore === 'function') {
                const locks = document.createElement('section');
                locks.className = 'mechanics-course__locks';
                locks.dataset.mechanicsLocks = 'true';
                locks.setAttribute('aria-label', '受控实验固定变量');
                locks.innerHTML = `
                    <div class="mechanics-course__only-variable"><span>唯一改变</span><strong>e = 0.40 → 0.80</strong></div>
                    <dl>
                        <div><dt>落高 H</dt><dd>200 px · 锁定</dd></div>
                        <div><dt>重力 g</dt><dd>980 px/s² · 锁定</dd></div>
                        <div><dt>半径 r</dt><dd>16 px · 锁定</dd></div>
                        <div><dt>水平速度 vₓ</dt><dd>0 · 锁定</dd></div>
                        <div><dt>μ / 教学阻尼</dt><dd>0 · 锁定</dd></div>
                    </dl>`;
                const progress = root.querySelector('[data-mechanics-progress]');
                root.insertBefore(locks, progress && progress.nextSibling || root.firstChild || null);
            }
        }
        const visual = this.canvas && this.canvas.parentElement;
        if (!visual || typeof visual.querySelector !== 'function'
            || typeof visual.insertBefore !== 'function'
            || visual.querySelector('[data-mechanics-canvas-hud]')) return;
        const hud = document.createElement('section');
        hud.className = 'mechanics-canvas-hud';
        hud.dataset.mechanicsCanvasHud = 'true';
        hud.setAttribute('aria-label', '受控实验实时读数');
        hud.innerHTML = `
            <div class="mechanics-canvas-hud__phase"><span>真实循环阶段</span><strong data-mechanics-live-phase>等待受控实验</strong></div>
            <div><span>当前恢复系数</span><strong data-mechanics-live-e>—</strong></div>
            <div><span>实时高度</span><strong data-mechanics-live-height>—</strong></div>
            <div><span>垂直运动</span><strong data-mechanics-live-velocity>—</strong></div>`;
        visual.insertBefore(hud, this.canvas);
    },

    _updateCourseShowcase(state) {
        if (!state || typeof document.querySelector !== 'function') return;
        const root = document.querySelector('[data-mechanics-course]');
        if (!root) return;
        if (root.dataset) root.dataset.mechanicsStage = state.stage;
        const stageIndex = {
            [MECHANICS_STAGE.P0]: 0,
            [MECHANICS_STAGE.P1]: 1,
            [MECHANICS_STAGE.P2]: 1,
            [MECHANICS_STAGE.P3]: 2,
            [MECHANICS_STAGE.P4]: 2,
            [MECHANICS_STAGE.P5]: 3,
            [MECHANICS_STAGE.P6]: 4,
            [MECHANICS_STAGE.P7]: 5,
            [MECHANICS_STAGE.P8]: 6
        }[state.stage] ?? 0;
        if (typeof root.querySelectorAll === 'function') {
            root.querySelectorAll('[data-mechanics-progress-step]').forEach(item => {
                const index = Number(item.dataset && item.dataset.mechanicsProgressStep);
                if (!Number.isFinite(index)) return;
                item.dataset.state = index < stageIndex ? 'complete' : index === stageIndex ? 'active' : 'locked';
                if (typeof item.setAttribute === 'function' && index === stageIndex && stageIndex < 6) {
                    item.setAttribute('aria-current', 'step');
                } else if (typeof item.removeAttribute === 'function') {
                    item.removeAttribute('aria-current');
                }
            });
        }
    },

    _setCourseVisualPhase(phase, ball, label) {
        const changed = phase !== this._courseVisualPhase;
        this._courseVisualPhase = phase;
        if (changed) this._courseVisualDirty = true;
        const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
        const reducedControlledTrial = Boolean(
            this._reducedMotion
            && ball
            && ball.controlled
            && this._controlledTrial === ball.controlled
        );
        if (reducedControlledTrial && !changed) return;
        const hudInterval = this._reducedMotion ? 250 : 100;
        if (!changed && now - this._lastCourseHudUpdate < hudInterval) return;
        this._lastCourseHudUpdate = now;
        if (typeof document.querySelector !== 'function') return;
        const phaseNode = document.querySelector('[data-mechanics-live-phase]');
        const eNode = document.querySelector('[data-mechanics-live-e]');
        const heightNode = document.querySelector('[data-mechanics-live-height]');
        const velocityNode = document.querySelector('[data-mechanics-live-velocity]');
        const phaseLabels = {
            idle: '等待受控实验',
            ready: '固定条件已锁定',
            falling: '释放下降',
            impact: '第一次碰撞',
            rising: '第一次回弹上升',
            peak: '第一峰值已捕获',
            compare: '两次真实峰值对照',
            cancelled: '本次观察已取消',
            blocked: '实验保持只读'
        };
        if (phaseNode) phaseNode.textContent = label || phaseLabels[phase] || '等待受控实验';
        const trial = ball && ball.controlled;
        if (eNode) eNode.textContent = trial ? `e=${trial.restitution.toFixed(2)}` : '—';
        if (!trial) {
            if (heightNode) heightNode.textContent = '—';
            if (velocityNode) velocityNode.textContent = '—';
            if (this.canvas && typeof this.canvas.setAttribute === 'function') {
                const stageLabel = label || phaseLabels[phase] || '等待受控实验';
                this.canvas.setAttribute('aria-label', `恢复系数受控实验画布，当前阶段：${stageLabel}`);
            }
            return;
        }
        const height = Math.max(0, Math.min(trial.dropHeight, trial.floorCenterY - ball.y));
        if (heightNode) heightNode.textContent = `${height.toFixed(1)} px`;
        if (velocityNode) {
            const direction = phase === 'peak' ? '峰值静止'
                : ball.vy > 1 ? '向下'
                : ball.vy < -1 ? '向上' : '释放';
            velocityNode.textContent = `${direction} · vᵧ ${Number(ball.vy).toFixed(0)} px/s`;
        }
        if (this.canvas && typeof this.canvas.setAttribute === 'function') {
            this.canvas.setAttribute(
                'aria-label',
                `恢复系数受控实验，${phaseNode ? phaseNode.textContent : phaseLabels[phase] || ''}，e=${trial.restitution.toFixed(2)}，实时高度 ${height.toFixed(1)} 像素`
            );
        }
    },

    _resetCourseOwnerState() {
        this._evidenceBinding = null;
        this._courseActionInFlight = false;
        this._courseRecordPermit = null;
        this._panelCommandPermit = null;
        this._courseRetryIds = new Map();
        this._courseNextFocus = '';
        this._courseVisualPhase = '';
        this._courseVisualDirty = true;
        this._lastCourseHudUpdate = 0;
        this._courseState = {
            prediction: null,
            measurements: Object.create(null),
            stage: MECHANICS_STAGE.P0,
            evidenceReady: false,
            blocked: false
        };
        this._controlledTrial = null;
        this._comparisonOverlay = false;
        this.balls = [];
        this.paused = false;
        this.isDragging = false;
        this.dragStart = null;
        this.dragEnd = null;

        this._clearCourseGroupDom();
        this._setCourseStage('正在确认学习证据范围');
        this._setCourseFeedback('范围确认完成前，受控实验输入与动作保持禁用。', 'checking');
        this._resetFreeControls();
        this._setCourseVisualPhase('idle', null);
        const ballCount = this._courseNode('ball-count');
        if (ballCount) ballCount.textContent = '0';
        const fps = this._courseNode('physics-fps');
        if (fps) fps.textContent = '0';
        this.updateEdu();
    },

    _clearCourseGroupDom() {
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
        if (typeof feedback.setAttribute === 'function') {
            feedback.setAttribute('role', state === 'blocked' ? 'alert' : 'status');
            feedback.setAttribute('aria-live', 'polite');
        }
    },

    _setCourseStage(message) {
        const node = this._courseNode('mechanics-course-stage');
        if (node) node.textContent = message;
    },

    _syncCourseUi() {
        const state = this._ensureCourseState();
        const available = Boolean(
            state.evidenceReady
            && !state.blocked
            && !this._courseActionInFlight
            && this._bindingIsCurrent()
        );
        const redoAvailable = [
            MECHANICS_STAGE.P3,
            MECHANICS_STAGE.P5,
            MECHANICS_STAGE.P7,
            MECHANICS_STAGE.P8
        ].includes(state.stage);
        const predictionButton = this._courseNode('mechanics-prediction-submit');
        const trial040 = this._courseNode('mechanics-trial-040');
        const trial080 = this._courseNode('mechanics-trial-080');
        const correction = this._courseNode('mechanics-correction-submit');
        const replay = this._courseNode('mechanics-replay');
        const predictionInputs = [
            this._courseNode('mechanics-prediction-choice'),
            this._courseNode('mechanics-prediction-relation'),
            this._courseNode('mechanics-prediction-reason')
        ];
        const correctionInputs = [
            this._courseNode('mechanics-correction-choice'),
            this._courseNode('mechanics-model-limit')
        ];
        predictionInputs.forEach(node => this._setDisabled(
            node,
            !available || state.stage !== MECHANICS_STAGE.P0
        ));
        correctionInputs.forEach(node => this._setDisabled(
            node,
            !available || state.stage !== MECHANICS_STAGE.P5
        ));
        if (predictionButton) {
            predictionButton.textContent = redoAvailable
                ? '重新开始一组受控实验'
                : '记录预测并解锁观察';
        }
        this._setDisabled(
            predictionButton,
            !available || !(state.stage === MECHANICS_STAGE.P0 || redoAvailable)
        );
        this._setDisabled(trial040, !available || state.stage !== MECHANICS_STAGE.P1);
        this._setDisabled(trial080, !available || state.stage !== MECHANICS_STAGE.P3);
        this._setDisabled(correction, !available || state.stage !== MECHANICS_STAGE.P5);
        this._setDisabled(
            replay,
            !available || ![MECHANICS_STAGE.P5, MECHANICS_STAGE.P7, MECHANICS_STAGE.P8].includes(state.stage)
        );
        const controlledBusy = Boolean(this._controlledTrial);
        [
            'gravity-slider',
            'restitution-slider',
            'friction-slider',
            'radius-slider',
            'physics-clear',
            'physics-pause'
        ].forEach(id => this._setDisabled(this._courseNode(id), controlledBusy));
        if (this.canvas && typeof this.canvas.setAttribute === 'function') {
            this.canvas.setAttribute('aria-disabled', controlledBusy ? 'true' : 'false');
        }
        this._updateCourseShowcase(state);
        this._refreshEvidenceCommands();
    },

    _submitCoursePrediction() {
        return this._runCourseAction(async ({ binding, generation }) => {
            const state = this._ensureCourseState();
            if (state.stage !== MECHANICS_STAGE.P0) return false;
            const choice = this._courseNode('mechanics-prediction-choice')?.value || '';
            const relation = this._courseNode('mechanics-prediction-relation')?.value || '';
            const reason = String(this._courseNode('mechanics-prediction-reason')?.value || '').trim();
            if (
                !['higher-080', 'higher-040', 'same-height'].includes(choice)
                || !['two-times', 'four-times', 'cannot-tell'].includes(relation)
                || reason.length < 4
            ) {
                this._setCourseFeedback('请先选择两项判断，并用一句话写出预测理由。', 'needs-input');
                this._courseNextFocus = 'mechanics-prediction-reason';
                return false;
            }
            const evidence = {
                prediction: {
                    expects_higher_080: choice === 'higher-080',
                    expected_height_multiplier: relation === 'four-times'
                        ? 4
                        : (relation === 'two-times' ? 2 : 0),
                    reason_size: Math.min(reason.length, 160)
                },
                cursor: { stage: 'prediction-recorded' }
            };
            await this._recordCourseEvidence('prediction', 'predicted', evidence, binding, generation);
            if (!this._bindingIsCurrent(binding, generation)) return false;
            state.prediction = { choice, relation };
            state.stage = MECHANICS_STAGE.P1;
            this._setCourseStage('预测已记录 · 仅开放 e=0.40');
            this._setCourseFeedback('现在只改变恢复系数。完成 e=0.40 的完整快照和证据后，才会开放 e=0.80。', 'ready');
            this._setCourseVisualPhase('ready', null, '等待释放 e=0.40');
            this._courseNextFocus = 'mechanics-trial-040';
            return true;
        });
    },

    _startControlledTrial(restitution) {
        return this._runCourseAction(async ({ binding, generation }) => {
            const state = this._ensureCourseState();
            const key = Number(restitution).toFixed(2);
            const expectedStage = key === '0.40'
                ? MECHANICS_STAGE.P1
                : key === '0.80' ? MECHANICS_STAGE.P3 : '';
            if (
                !expectedStage
                || state.stage !== expectedStage
                || this._controlledTrial
                || state.measurements[key]
                || !this.canvas
                || !Number.isFinite(this.W)
                || !Number.isFinite(this.H)
                || this.H < 232
            ) return false;
            await this._authorizeCourseBinding(binding, generation);
            if (!this._bindingIsCurrent(binding, generation)) return false;

            const radius = 16;
            const dropHeight = 200;
            const floorCenterY = this.H - radius;
            const trial = {
                restitution: Number(key),
                dropHeight,
                gravity: 980,
                radius,
                horizontalVelocity: 0,
                damping: 0,
                floorCenterY,
                rebounded: false,
                rising: false,
                peakY: floorCenterY,
                ownerGeneration: generation,
                completed: false
            };
            this._comparisonOverlay = false;
            this.balls = [{
                x: this.W / 2,
                y: floorCenterY - dropHeight,
                vx: 0,
                vy: 0,
                r: radius,
                color: restitution < 0.6 ? '#a78bfa' : '#38bdf8',
                trail: [],
                gravity: 980,
                friction: 0,
                restitution: Number(key),
                controlled: trial
            }];
            this._controlledTrial = trial;
            state.stage = key === '0.40' ? MECHANICS_STAGE.P2 : MECHANICS_STAGE.P4;
            this.paused = false;
            this._setCourseStage(`正在观察 e=${key} 的第一次反弹`);
            this._setCourseFeedback('只看第一次峰值；改动滑块、拖拽、暂停、清除或 resize 都会取消本次快照且零写入。', 'observing');
            this._setCourseVisualPhase('falling', this.balls[0]);
            this.updateStats();
            this.render();
            if (this._reducedMotion) {
                this._courseVisualDirty = false;
                this._lastReducedRender = typeof performance !== 'undefined'
                    && typeof performance.now === 'function'
                    ? performance.now()
                    : Date.now();
            }
            return true;
        });
    },

    _recordControlledMeasurement(restitution, measurement, trial) {
        return this._runCourseAction(async ({ binding, generation }) => {
            const state = this._ensureCourseState();
            const key = Number(restitution).toFixed(2);
            const runningStage = key === '0.40'
                ? MECHANICS_STAGE.P2
                : key === '0.80' ? MECHANICS_STAGE.P4 : '';
            const retryStage = key === '0.40' ? MECHANICS_STAGE.P1 : MECHANICS_STAGE.P3;
            const dropHeight = Number(measurement && measurement.dropHeight);
            const reboundHeight = Number(measurement && measurement.reboundHeight);
            if (
                !runningStage
                || state.stage !== runningStage
                || trial !== this._controlledTrial
                || !trial
                || state.measurements[key]
            ) return false;
            if (
                trial.ownerGeneration !== generation
                || Number(trial.restitution).toFixed(2) !== key
                || trial.dropHeight !== 200
                || trial.gravity !== 980
                || trial.radius !== 16
                || trial.horizontalVelocity !== 0
                || trial.damping !== 0
                || trial.completed !== true
                || dropHeight !== 200
                || !Number.isFinite(reboundHeight)
                || reboundHeight < 0
                || reboundHeight > 200
            ) {
                this._cancelControlledTrial(
                    '第一峰值快照无效',
                    '本次快照不满足固定工况或完整峰值门禁；未写入尝试证据，请重试同一档。'
                );
                return false;
            }
            const normalizedHeight = Number(reboundHeight.toFixed(1));
            const ratio = Number((normalizedHeight / 200).toFixed(2));
            const result = Object.freeze({
                restitution: Number(key),
                dropHeight: 200,
                reboundHeight: normalizedHeight,
                ratio
            });
            const evidence = {
                operation: 'restitution_adjustment',
                cursor: {
                    stage: 'after-observation',
                    trial: key === '0.40' ? 40 : 80,
                    preset: {
                        restitution: Number(key),
                        drop_height_px: 200,
                        gravity_px_s2: 980,
                        radius_px: 16,
                        horizontal_velocity_px_s: 0,
                        damping: 0
                    },
                    observation: {
                        first_rebound_height_px: normalizedHeight,
                        height_ratio: ratio
                    }
                }
            };
            try {
                await this._recordCourseEvidence(
                    `attempt-${key}`,
                    'attempted',
                    evidence,
                    binding,
                    generation,
                    () => this._controlledTrial === trial && state.stage === runningStage
                );
            } catch (error) {
                if (generation === this._courseGeneration && !state.blocked) {
                    if (this._controlledTrial === trial) this._controlledTrial = null;
                    state.stage = retryStage;
                    this.balls = this.balls.filter(ball => !ball || ball.controlled !== trial);
                    this._setCourseStage(`e=${key} 证据未确认 · 请重试同一固定预设`);
                }
                throw error;
            }
            if (!this._bindingIsCurrent(binding, generation)) return false;
            if (this._controlledTrial !== trial || state.stage !== runningStage) return false;
            this._controlledTrial = null;
            state.measurements[key] = result;
            const suffix = key === '0.40' ? '040' : '080';
            const heightNode = this._courseNode(`mechanics-measure-h-${suffix}`);
            const ratioNode = this._courseNode(`mechanics-measure-ratio-${suffix}`);
            if (heightNode) heightNode.textContent = `${normalizedHeight.toFixed(1)} px`;
            if (ratioNode) ratioNode.textContent = ratio.toFixed(2);

            if (key === '0.40') {
                state.stage = MECHANICS_STAGE.P3;
                this._setCourseStage('e=0.40 快照与证据已记录 · 仅开放 e=0.80');
                this._setCourseFeedback('保持 H、g、半径、初速度和阻尼不变；现在运行 e=0.80。', 'continue');
                this._courseNextFocus = 'mechanics-trial-080';
            } else {
                state.stage = MECHANICS_STAGE.P5;
                const ratio040 = state.measurements['0.40'].ratio;
                const ratio080 = result.ratio;
                const predictionMatches = state.prediction
                    && state.prediction.choice === 'higher-080'
                    && state.prediction.relation === 'four-times';
                this._setCourseStage('两组快照完成 · 比较后修正并确认模型边界');
                this._setCourseFeedback(
                    `${predictionMatches ? '预测与测量方向一致。' : '测量要求修订原预测。'} `
                    + `h/H 从 ${ratio040.toFixed(2)} 变为 ${ratio080.toFixed(2)}；这只是本页理想受控模型内的比较。`,
                    predictionMatches ? 'matched' : 'revise'
                );
                this._courseNextFocus = 'mechanics-correction-choice';
            }
            const completedBall = this.balls.find(ball => ball && ball.controlled === trial);
            this._setCourseVisualPhase('peak', completedBall || null);
            return true;
        });
    },

    _submitCourseCorrection() {
        return this._runCourseAction(async ({ binding, generation }) => {
            const state = this._ensureCourseState();
            if (
                state.stage !== MECHANICS_STAGE.P5
                || !state.measurements['0.40']
                || !state.measurements['0.80']
                || state.measurements['0.80'].ratio <= state.measurements['0.40'].ratio
            ) return false;
            const choice = this._courseNode('mechanics-correction-choice')?.value || '';
            const modelLimit = Boolean(this._courseNode('mechanics-model-limit')?.checked);
            if (choice !== 'height-follows-e-squared') {
                this._setCourseFeedback('再比较两行 h/H：恢复系数先作用于碰撞后的速度，达到高度还要经过平方关系。', 'needs-revision');
                this._courseNextFocus = 'mechanics-correction-choice';
                return false;
            }
            if (!modelLimit) {
                this._setCourseFeedback('请先确认这条关系只适用于本页列出的理想化受控条件。', 'needs-limit');
                this._courseNextFocus = 'mechanics-model-limit';
                return false;
            }
            state.stage = MECHANICS_STAGE.P6;
            const evidence = {
                correction: {
                    height_follows_e_squared: true,
                    model_limit_acknowledged: true,
                    ratio_040: state.measurements['0.40'].ratio,
                    ratio_080: state.measurements['0.80'].ratio
                },
                cursor: { stage: 'after-repair' }
            };
            try {
                await this._recordCourseEvidence('correction', 'corrected', evidence, binding, generation);
            } catch (error) {
                if (generation === this._courseGeneration && !state.blocked) state.stage = MECHANICS_STAGE.P5;
                throw error;
            }
            if (!this._bindingIsCurrent(binding, generation)) return false;
            state.stage = MECHANICS_STAGE.P7;
            this._setCourseStage('修正已记录 · 最后提交结构化解释');
            this._setCourseFeedback('请在“学习证据”区提交结构化解释；自由文本入口已关闭，完成状态仍由服务端派生。', 'explain');
            this._courseNextFocus = '@evidence-explained';
            return true;
        });
    },

    _showCourseReplay() {
        return this._runCourseAction(async ({ binding, generation }) => {
            const state = this._ensureCourseState();
            if (
                ![MECHANICS_STAGE.P5, MECHANICS_STAGE.P7, MECHANICS_STAGE.P8].includes(state.stage)
                || !state.measurements['0.40']
                || !state.measurements['0.80']
                || this._controlledTrial
            ) return false;
            await this._authorizeCourseBinding(binding, generation);
            if (!this._bindingIsCurrent(binding, generation)) return false;
            this._comparisonOverlay = true;
            this.balls = [];
            this._setCourseStage('正在重看两次第一峰值（不新增证据）');
            this._setCourseFeedback('Canvas 标出两组峰值；数值仍以等价测量表为准，本操作不改变课程阶段。', 'replay');
            this._setCourseVisualPhase('compare', null);
            this.render();
            this._courseNextFocus = 'mechanics-measurements';
            return true;
        });
    },

    _redoCourseGroup() {
        return this._runCourseAction(async ({ binding, generation }) => {
            const state = this._ensureCourseState();
            if (![MECHANICS_STAGE.P3, MECHANICS_STAGE.P5, MECHANICS_STAGE.P7, MECHANICS_STAGE.P8].includes(state.stage)) {
                return false;
            }
            await this._authorizeCourseBinding(binding, generation);
            if (!this._bindingIsCurrent(binding, generation)) return false;
            this._controlledTrial = null;
            this._comparisonOverlay = false;
            this.balls = this.balls.filter(ball => !ball || !ball.controlled);
            state.prediction = null;
            state.measurements = Object.create(null);
            state.stage = MECHANICS_STAGE.P0;
            this._courseRetryIds = new Map();
            this._clearCourseGroupDom();
            this._setCourseStage('新受控组 · 等待新的预测');
            this._setCourseFeedback('旧事件保持 append-only；本次显式重做会为新预测和新快照生成新的事件编号。', 'redo');
            this._setCourseVisualPhase('idle', null, '等待新的预测');
            this._courseNextFocus = 'mechanics-prediction-choice';
            return true;
        });
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
        return this._cancelControlledTrial(
            '画布尺寸已变化',
            '尺寸变化使本次轨迹失去同一几何基准；本次不记录尝试证据，请重新运行该固定预设。'
        );
    },

    _cancelControlledTrial(reason, message) {
        if (!this._controlledTrial) return false;
        const key = Number(this._controlledTrial.restitution).toFixed(2);
        const state = this._ensureCourseState();
        this._controlledTrial = null;
        this._comparisonOverlay = false;
        this.balls = this.balls.filter(ball => !ball || !ball.controlled);
        this.paused = false;
        this.isDragging = false;
        this.dragStart = null;
        this.dragEnd = null;
        const pauseButton = this._courseNode('physics-pause');
        if (pauseButton) pauseButton.textContent = '暂停';
        state.stage = key === '0.40' ? MECHANICS_STAGE.P1 : MECHANICS_STAGE.P3;
        this._setCourseStage(`${reason || '本次观察已取消'} · e=${key} 可重新运行`);
        this._setCourseFeedback(
            message || '本次未形成完整第一峰值快照，也没有写入尝试证据；请重新运行同一固定预设。',
            'retry'
        );
        this._setCourseVisualPhase('cancelled', null);
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
        const interruptControlled = () => this._cancelControlledTrial(
            '自由探索参数已改动',
            '受控轮次要求 H=200、g=980、r=16、vx=0、阻尼=0；本次已取消且零写入。'
        );

        this._on(gravSlider, 'input', () => {
            interruptControlled();
            this.gravity = +gravSlider.value;
            document.getElementById('gravity-value').textContent = gravSlider.value;
        });

        this._on(restSlider, 'input', () => {
            interruptControlled();
            this.restitution = +restSlider.value / 100;
            document.getElementById('restitution-value').textContent = this.restitution.toFixed(2);
        });

        this._on(fricSlider, 'input', () => {
            interruptControlled();
            this.friction = +fricSlider.value / 100;
            document.getElementById('friction-value').textContent = this.friction.toFixed(2);
        });

        this._on(radSlider, 'input', () => {
            interruptControlled();
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
            if (this._cancelControlledTrial(
                '受控观察已被暂停动作中断',
                '暂停只属于自由探索；本次受控观察已取消且零写入，请重新运行固定预设。'
            )) return;
            this.paused = !this.paused;
            pauseBtn.textContent = this.paused ? '继续' : '暂停';
        });
    },

    resetScene() {
        this._cancelControlledTrial(
            '受控观察已清空',
            '清空只影响当前画布；本次未形成测量，也没有写入尝试证据。请重新运行同一固定预设。'
        );
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
            if (this._cancelControlledTrial(
                '受控观察已被拖拽中断',
                '拖拽发射只属于自由探索；本次受控观察已取消且零写入。'
            )) return;
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
            if (this._cancelControlledTrial(
                '受控观察已被触控拖拽中断',
                '触控发射只属于自由探索；本次受控观察已取消且零写入。'
            )) return;
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
        if (this._cancelControlledTrial(
            '受控观察已被自由发射中断',
            '自由发射不会计入课程尝试；本次受控观察已取消且零写入。'
        )) return false;
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
        const reducedControlledTrial = Boolean(this._reducedMotion && this._controlledTrial);
        const shouldRender = !this._reducedMotion
            || this._courseVisualDirty
            || (!reducedControlledTrial && now - this._lastReducedRender >= 250);
        if (shouldRender) {
            this.render();
            this._lastReducedRender = now;
            this._courseVisualDirty = false;
        }
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
                    b.controlled.visualImpactFrames = this._reducedMotion ? 1 : 4;
                    this._setCourseVisualPhase('impact', b);
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
                    if (b.controlled.visualImpactFrames > 0) {
                        b.controlled.visualImpactFrames -= 1;
                        this._setCourseVisualPhase('impact', b);
                    } else {
                        this._setCourseVisualPhase('rising', b);
                    }
                } else if (b.controlled.rising) {
                    b.controlled.completed = true;
                    b.y = b.controlled.peakY;
                    b.vx = 0;
                    b.vy = 0;
                    this._setCourseVisualPhase('peak', b);
                    const reboundHeight = Math.max(
                        0,
                        b.controlled.floorCenterY - b.controlled.peakY
                    );
                    if (this._controlledTrial === b.controlled) {
                        Promise.resolve(this._recordControlledMeasurement(
                            b.controlled.restitution,
                            {
                                dropHeight: b.controlled.dropHeight,
                                reboundHeight
                            },
                            b.controlled
                        )).catch(() => {});
                    }
                }
            } else if (b.controlled && !b.controlled.rebounded) {
                this._setCourseVisualPhase('falling', b);
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
            if (!this._reducedMotion && b.trail.length > 1) {
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
        const controlledBall = this.balls.find(ball => ball && ball.controlled);
        const active = this._controlledTrial || controlledBall && controlledBall.controlled;
        if (active) {
            const startY = active.floorCenterY - active.dropHeight;
            const rulerX = Math.max(26, this.W * 0.1);
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
            ctx.strokeStyle = 'rgba(125, 211, 252, 0.42)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(rulerX, startY);
            ctx.lineTo(rulerX, active.floorCenterY);
            ctx.stroke();
            ctx.font = `500 11px ${CF.sans}`;
            ctx.textAlign = 'right';
            [0, 50, 100, 150, 200].forEach(height => {
                const y = active.floorCenterY - height;
                ctx.beginPath();
                ctx.moveTo(rulerX - 5, y);
                ctx.lineTo(rulerX + 5, y);
                ctx.stroke();
                ctx.fillText(`${height}`, rulerX - 9, y + 4);
            });
            ctx.textAlign = 'left';
            ctx.fillStyle = 'rgba(191, 219, 254, 0.78)';
            ctx.fillText('h / px', rulerX - 8, Math.max(16, startY - 18));
            if (controlledBall) {
                const height = Math.max(0, Math.min(active.dropHeight, active.floorCenterY - controlledBall.y));
                const markerY = active.floorCenterY - height;
                ctx.strokeStyle = controlledBall.color;
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(rulerX + 8, markerY);
                ctx.lineTo(Math.max(rulerX + 38, controlledBall.x - controlledBall.r - 12), markerY);
                ctx.stroke();
                ctx.fillStyle = 'rgba(248, 250, 252, 0.94)';
                ctx.font = `600 12px ${CF.sans}`;
                ctx.textAlign = 'left';
                ctx.fillText(`实时 h=${height.toFixed(1)} px`, rulerX + 12, Math.max(20, markerY - 7));
                if (Math.abs(controlledBall.vy) > 4) {
                    const direction = controlledBall.vy > 0 ? 1 : -1;
                    const arrowLength = Math.min(58, 22 + Math.abs(controlledBall.vy) * 0.035);
                    const startArrowY = controlledBall.y - direction * (controlledBall.r + 7);
                    const endArrowY = startArrowY + direction * arrowLength;
                    ctx.strokeStyle = 'rgba(248, 250, 252, 0.78)';
                    ctx.fillStyle = 'rgba(248, 250, 252, 0.78)';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(controlledBall.x + controlledBall.r + 12, startArrowY);
                    ctx.lineTo(controlledBall.x + controlledBall.r + 12, endArrowY);
                    ctx.stroke();
                    const arrowDirection = direction > 0 ? Math.PI / 2 : -Math.PI / 2;
                    const arrowX = controlledBall.x + controlledBall.r + 12;
                    ctx.beginPath();
                    ctx.moveTo(arrowX, endArrowY);
                    ctx.lineTo(arrowX - Math.cos(arrowDirection - Math.PI / 6) * 8, endArrowY - Math.sin(arrowDirection - Math.PI / 6) * 8);
                    ctx.lineTo(arrowX - Math.cos(arrowDirection + Math.PI / 6) * 8, endArrowY - Math.sin(arrowDirection + Math.PI / 6) * 8);
                    ctx.closePath();
                    ctx.fill();
                }
            }
            ctx.fillStyle = 'rgba(167, 139, 250, 0.84)';
            ctx.font = `600 11px ${CF.sans}`;
            ctx.textAlign = 'right';
            ctx.fillText('锁定：g=980 · r=16 · vₓ=0 · μ/阻尼=0', this.W - 18, 24);
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
