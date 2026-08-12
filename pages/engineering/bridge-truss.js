// ===== Engineering Applications: Bridge Truss Lab =====

(function () {
    const LOAD_PATH_MAPPING = Object.freeze({
        galaxy_key: 'future-galaxy',
        course_key: 'engineering-systems',
        activity_key: 'engineering.load-path'
    });
    const PREDICTION_VALUES = Object.freeze({
        reaction_balance_id: new Set(['more-balanced', 'more-unbalanced', 'no-change', 'insufficient']),
        gh_change_id: new Set(['absolute-increase', 'absolute-decrease', 'no-change', 'insufficient']),
        cd_change_id: new Set(['absolute-increase', 'absolute-decrease', 'no-change', 'insufficient'])
    });
    const JUDGEMENTS = new Set([
        'equilibrium-redistribution', 'single-load-path', 'color-means-compression',
        'no-redistribution', 'insufficient'
    ]);
    const FIXED_ROWS = Object.freeze({
        B: Object.freeze({ reaction_ay_kn: 45, reaction_ey_kn: 15, member_gh_kn: -30, member_cd_kn: 22.5 }),
        C: Object.freeze({ reaction_ay_kn: 30, reaction_ey_kn: 30, member_gh_kn: -60, member_cd_kn: 45 }),
        D: Object.freeze({ reaction_ay_kn: 15, reaction_ey_kn: 45, member_gh_kn: -30, member_cd_kn: 37.5 })
    });

    function exactKeys(value, keys) {
        return Boolean(value && typeof value === 'object' && !Array.isArray(value)
            && Object.keys(value).sort().join('|') === keys.slice().sort().join('|'));
    }

    function roundTo(value, digits) {
        const factor = 10 ** digits;
        const rounded = Math.round((Number(value) + Number.EPSILON) * factor) / factor;
        return Object.is(rounded, -0) ? 0 : rounded;
    }

    function memberType(force) {
        return Math.abs(force) < 0.05 ? 'zero' : force > 0 ? 'tension' : 'compression';
    }

    function normalizeLoadPathObservation(node, result) {
        const gh = result && result.memberForces && result.memberForces.find(member => member.name === 'GH');
        const cd = result && result.memberForces && result.memberForces.find(member => member.name === 'CD');
        const reactions = result && result.reactions;
        if (!FIXED_ROWS[node] || !gh || !cd || !reactions) return null;
        return Object.freeze({
            load_node_id: node,
            load_kn: 60,
            reaction_ay_kn: roundTo(reactions.Ay, 1),
            reaction_ey_kn: roundTo(reactions.Ey, 1),
            member_gh_kn: roundTo(gh.force, 1),
            member_cd_kn: roundTo(cd.force, 1),
            member_gh_type_id: memberType(gh.force),
            member_cd_type_id: memberType(cd.force),
            residual_fx_kn: roundTo(reactions.Ax, 2),
            residual_fy_kn: roundTo(reactions.Ay + reactions.Ey - 60, 2)
        });
    }

    function validObservation(value, node) {
        const expected = FIXED_ROWS[node];
        const keys = [
            'load_node_id', 'load_kn', 'reaction_ay_kn', 'reaction_ey_kn',
            'member_gh_kn', 'member_cd_kn', 'member_gh_type_id', 'member_cd_type_id',
            'residual_fx_kn', 'residual_fy_kn'
        ];
        return Boolean(
            expected
            && exactKeys(value, keys)
            && value.load_node_id === node
            && value.load_kn === 60
            && value.reaction_ay_kn === expected.reaction_ay_kn
            && value.reaction_ey_kn === expected.reaction_ey_kn
            && value.member_gh_kn === expected.member_gh_kn
            && value.member_cd_kn === expected.member_cd_kn
            && value.member_gh_type_id === 'compression'
            && value.member_cd_type_id === 'tension'
            && Math.abs(value.residual_fx_kn) <= 0.05
            && Math.abs(value.residual_fy_kn) <= 0.05
        );
    }

    // Pure presentation projection: it only reads exact observations already owned by the
    // controlled flow. It never solves, records evidence or advances the course state.
    function buildLoadPathStory(stage, observations) {
        const snapshots = observations || {};
        const hasB = validObservation(snapshots.B, 'B');
        const hasC = validObservation(snapshots.C, 'C');
        const hasD = validObservation(snapshots.D, 'D');
        const stories = {
            prediction: {
                title: '先锁定比较条件，再写下预测',
                cue: '荷载、杆件数量与理想模型保持不变；此刻只提交推理，不读取反力、杆力或趋势答案。',
                checks: ['确认唯一变量是荷载节点', '分别预测支座反力、GH 与 CD 的变化', '用节点平衡或载荷路径写出理由']
            },
            predicted: {
                title: '运行 B，建立可复查的基线',
                cue: '观察完整求解后再记录：Aᵧ / Eᵧ、GH / CD 的正负号与类型，以及平衡残差。',
                checks: ['确认荷载仍为 60 kN', '先读数值，再读受拉 / 受压类型', '残差接近零才把本次作为基线']
            },
            'observed-b': {
                title: '只把荷载节点由 B 改为 C',
                cue: '保持 60 kN、完整 15 杆和理想二维铰接模型不变，观察同一组指标如何重分配。',
                checks: ['对齐比较 Aᵧ 与 Eᵧ', '比较 |GH| 与 |CD|', '再次检查两个方向的平衡残差']
            },
            'observed-c': {
                title: '先用 B / C 实测作判断',
                cue: '变化摘要只消费上方两次 exact solve；颜色与过渡动画负责解释过程，不进入证据。',
                checks: ['用反力差描述支座分配', '用绝对值比较杆力强弱', '把符号对应到受拉 / 受压']
            },
            assessed: {
                title: '运行 D，检查“镜像”说法的边界',
                cue: 'D 是独立完整求解。请逐项核对支座反力、GH 与 CD，不凭画面对称推定数值。',
                checks: ['核对 Aᵧ / Eᵧ 是否互换', '核对 GH 是否复现基线', '单独核对 CD，避免过度概括']
            },
            'observed-d': {
                title: '三组观察齐全，收束模型结论',
                cue: '现在可以用 B / C / D 的 exact solve 说明平衡重分配，并明确该模型不能替代真实结构安全校核。',
                checks: ['结论必须引用三组观察', '区分支座镜像与杆力差异', '确认理想模型边界']
            },
            corrected: {
                title: '把观察压缩成结构化解释',
                cue: '解释应同时包含反力、关键杆件、平衡依据与模型限制；页面不自行写入完成状态。',
                checks: ['证据来自三次完整求解', '结论不依赖颜色', '完成状态交由服务端投影']
            },
            'waiting-server': {
                title: '页面解释已提交，等待权威投影',
                cue: '可复述下方三工况结论；本页保持只读，不新增证据，也不自行判定 completed。',
                checks: ['回看三组 exact solve', '复述平衡重分配', '说明模型不能直接用于安全判断']
            }
        };
        const active = stories[stage] || stories.prediction;
        const complete = hasB && hasC && hasD;
        const conclusion = complete ? {
            title: '三工况结论 · exact solve',
            facts: [
                `B → C：支座反力差 |Aᵧ−Eᵧ| 从 ${Math.abs(snapshots.B.reaction_ay_kn - snapshots.B.reaction_ey_kn).toFixed(1)} kN 变为 ${Math.abs(snapshots.C.reaction_ay_kn - snapshots.C.reaction_ey_kn).toFixed(1)} kN。`,
                `B → C：|GH| 从 ${Math.abs(snapshots.B.member_gh_kn).toFixed(1)} kN 变为 ${Math.abs(snapshots.C.member_gh_kn).toFixed(1)} kN，|CD| 从 ${Math.abs(snapshots.B.member_cd_kn).toFixed(1)} kN 变为 ${Math.abs(snapshots.C.member_cd_kn).toFixed(1)} kN。`,
                `D：Aᵧ / Eᵧ = ${snapshots.D.reaction_ay_kn.toFixed(1)} / ${snapshots.D.reaction_ey_kn.toFixed(1)} kN，GH = ${snapshots.D.member_gh_kn.toFixed(1)} kN，CD = ${snapshots.D.member_cd_kn.toFixed(1)} kN；支座反力可作镜像核对，但不能把全部杆力概括为镜像。`
            ],
            boundary: '模型边界：结果只属于 60 kN、完整 15 杆、理想二维铰接桁架；未包含材料、屈曲、连接与安全系数，不能直接作为真实结构安全结论。',
            receipt: stage === 'waiting-server'
                ? '结构化解释已保存；completed 仍只由服务端规则投影。'
                : stage === 'corrected'
                ? '纠正已确认，结构化解释待提交；completed 仍只由服务端规则投影。'
                : 'B / C / D 三次观察已齐，仅生成只读教学结论；纠正、解释与 completed 尚未完成。'
        } : null;
        return Object.freeze({ ...active, checks: Object.freeze(active.checks.slice()), conclusion });
    }

    function validPrediction(value) {
        return Boolean(
            exactKeys(value, ['reaction_balance_id', 'gh_change_id', 'cd_change_id', 'reason_size'])
            && PREDICTION_VALUES.reaction_balance_id.has(value.reaction_balance_id)
            && PREDICTION_VALUES.gh_change_id.has(value.gh_change_id)
            && PREDICTION_VALUES.cd_change_id.has(value.cd_change_id)
            && Number.isInteger(value.reason_size)
            && value.reason_size >= 4
            && value.reason_size <= 160
        );
    }

    function predictedEvidence(prediction) {
        return Object.freeze({ prediction: Object.freeze({ ...prediction }) });
    }

    function attemptedEvidence(observation) {
        return Object.freeze({
            operation: 'run-fixed-load-case',
            cursor: Object.freeze({ ...observation })
        });
    }

    function correctedEvidence(judgement) {
        return Object.freeze({
            correction: Object.freeze({
                conclusion_id: 'load-redistributes-by-equilibrium',
                initial_judgement_id: judgement,
                mirror_check_passed: true,
                model_id: 'ideal-2d-pin-jointed-truss',
                model_limit_acknowledged: true
            }),
            cursor: Object.freeze({ stage: 'after-repair' })
        });
    }

    function explainedEvidence() {
        return Object.freeze({
            artifact: Object.freeze({
                kind: 'load-path-conclusion',
                conclusion_id: 'joint-equilibrium-redistribution',
                evidence_pair_id: 'b-c-reactions-gh-cd',
                model_limit_id: 'ideal-truss-not-safety'
            }),
            cursor: Object.freeze({ stage: 'explained' })
        });
    }

    function initialRecovery() {
        return { stage: 'prediction', observations: {}, judgement: '' };
    }

    function scopeMatches(payload, scope) {
        return ['class_id', 'course_id', 'course_unit_id', 'activity_key']
            .every(key => String(payload && payload[key]) === String(scope && scope[key]));
    }

    function validStartedEvidence(evidence) {
        return exactKeys(evidence, ['cursor'])
            && exactKeys(evidence.cursor, ['surface', 'stage'])
            && evidence.cursor.surface === 'future-galaxy'
            && evidence.cursor.stage === 'entered';
    }

    function validCorrectedEvidence(evidence) {
        const correction = evidence && evidence.correction;
        return Boolean(
            exactKeys(evidence, ['correction', 'cursor'])
            && exactKeys(correction, ['conclusion_id', 'initial_judgement_id', 'mirror_check_passed', 'model_id', 'model_limit_acknowledged'])
            && exactKeys(evidence.cursor, ['stage'])
            && correction.conclusion_id === 'load-redistributes-by-equilibrium'
            && JUDGEMENTS.has(correction.initial_judgement_id)
            && correction.mirror_check_passed === true
            && correction.model_id === 'ideal-2d-pin-jointed-truss'
            && correction.model_limit_acknowledged === true
            && evidence.cursor.stage === 'after-repair'
        );
    }

    function validExplainedEvidence(evidence) {
        const artifact = evidence && evidence.artifact;
        return Boolean(
            exactKeys(evidence, ['artifact', 'cursor'])
            && exactKeys(artifact, ['kind', 'conclusion_id', 'evidence_pair_id', 'model_limit_id'])
            && exactKeys(evidence.cursor, ['stage'])
            && artifact.kind === 'load-path-conclusion'
            && artifact.conclusion_id === 'joint-equilibrium-redistribution'
            && artifact.evidence_pair_id === 'b-c-reactions-gh-cd'
            && artifact.model_limit_id === 'ideal-truss-not-safety'
            && evidence.cursor.stage === 'explained'
        );
    }

    function recoverLoadPathPrefix(records, scope) {
        const fallback = initialRecovery();
        if (!Array.isArray(records) || records.length > 16) return fallback;
        const events = [];
        const identities = new Set();
        let lastTime = -Infinity;
        for (const record of records) {
            const payload = record && record.payload;
            const time = payload && new Date(payload.occurred_at).getTime();
            if (
                !record
                || !['local-pending', 'syncing'].includes(record.state)
                || !payload
                || !scopeMatches(payload, scope)
                || !Number.isFinite(time)
                || time < lastTime
                || !payload.client_event_id
                || identities.has(payload.client_event_id)
                || !['started', 'predicted', 'attempted', 'corrected', 'explained'].includes(payload.event_type)
            ) return fallback;
            lastTime = time;
            identities.add(payload.client_event_id);
            events.push(payload);
        }
        if (events[0] && events[0].event_type === 'started') {
            if (!validStartedEvidence(events[0].evidence)) return fallback;
            events.shift();
        }
        if (events.some(event => event.event_type === 'started')) return fallback;
        if (!events.length) return fallback;
        const prediction = events.shift();
        if (prediction.event_type !== 'predicted'
            || !exactKeys(prediction.evidence, ['prediction'])
            || !validPrediction(prediction.evidence.prediction)) return fallback;
        const recovered = { stage: 'predicted', observations: {}, judgement: '' };
        for (const node of ['B', 'C', 'D']) {
            if (!events.length) break;
            const event = events[0];
            if (event.event_type !== 'attempted') break;
            if (!exactKeys(event.evidence, ['operation', 'cursor'])
                || event.evidence.operation !== 'run-fixed-load-case'
                || !validObservation(event.evidence.cursor, node)) return fallback;
            events.shift();
            recovered.observations[node] = Object.freeze({ ...event.evidence.cursor });
            recovered.stage = node === 'B' ? 'observed-b' : node === 'C' ? 'observed-c' : 'observed-d';
        }
        if (recovered.stage === 'observed-d' && (!events.length || events[0].event_type !== 'corrected')) {
            delete recovered.observations.D;
            recovered.stage = 'observed-c';
        }
        if (events[0] && events[0].event_type === 'corrected') {
            if (!recovered.observations.D || !validCorrectedEvidence(events[0].evidence)) return fallback;
            recovered.judgement = events[0].evidence.correction.initial_judgement_id;
            recovered.stage = 'corrected';
            events.shift();
        }
        if (events[0] && events[0].event_type === 'explained') {
            if (recovered.stage !== 'corrected' || !validExplainedEvidence(events[0].evidence)) return fallback;
            recovered.stage = 'waiting-server';
            events.shift();
        }
        if (events.length) return fallback;
        return recovered;
    }

    function createClientEventId(eventType) {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
        return `future-${eventType}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    function createLoadPathFlow(options) {
        const settings = options || {};
        const controller = settings.controller;
        let destroyed = false;
        let busy = false;
        let actionInFlight = false;
        let manualBlocked = false;
        let state = recoverLoadPathPrefix(settings.pendingRecords || [], controller && controller.context && controller.context());
        const retryIds = new Map();

        const snapshot = () => Object.freeze({
            stage: state.stage,
            busy,
            blocked: manualBlocked,
            judgement: state.judgement,
            observations: Object.freeze({ ...state.observations })
        });
        const notify = () => {
            if (!destroyed && typeof settings.onChange === 'function') settings.onChange(snapshot());
        };
        const blockManualIntervention = error => {
            if (!error || error.code !== 'pending_recovery_manual_intervention') return false;
            manualBlocked = true;
            retryIds.clear();
            notify();
            return true;
        };
        const authorize = async () => {
            if (destroyed || manualBlocked || !controller || typeof controller.record !== 'function'
                || typeof controller.context !== 'function'
                || typeof settings.resolveAuthority !== 'function'
                || typeof settings.sameAuthority !== 'function'
                || typeof settings.isActive === 'function' && !settings.isActive()) return null;
            const expected = controller.context();
            let current;
            try {
                current = typeof settings.authorizeRecord === 'function'
                    ? await settings.authorizeRecord(expected)
                    : await settings.resolveAuthority(LOAD_PATH_MAPPING);
            } catch (error) {
                blockManualIntervention(error);
                throw error;
            }
            if (destroyed || !actionInFlight || typeof settings.isActive === 'function' && !settings.isActive()
                || !settings.sameAuthority(expected, current)) return null;
            return current;
        };
        const runAction = async action => {
            if (destroyed || actionInFlight || manualBlocked) return false;
            actionInFlight = true;
            busy = true;
            notify();
            try {
                return await action();
            } catch (error) {
                return false;
            } finally {
                actionInFlight = false;
                busy = false;
                notify();
            }
        };
        const record = async (actionKey, eventType, evidence) => {
            if (!await authorize()) return false;
            const clientEventId = retryIds.get(actionKey) || createClientEventId(eventType);
            retryIds.set(actionKey, clientEventId);
            try {
                const result = await controller.record(eventType, evidence, { client_event_id: clientEventId });
                if (result && (result.outcome === 'manual-intervention' || result.state === 'manual-intervention')) {
                    manualBlocked = true;
                    retryIds.clear();
                    notify();
                    return false;
                }
                const durable = result && (
                    ['confirmed', 'reconciled', 'queued'].includes(result.outcome)
                    || ['confirmed', 'local-pending'].includes(result.state)
                );
                if (!durable || !await authorize()) {
                    return false;
                }
                retryIds.delete(actionKey);
                return true;
            } catch (error) {
                blockManualIntervention(error);
                return false;
            }
        };
        const api = {
            predict(prediction) { return runAction(async () => {
                if (state.stage !== 'prediction' || !validPrediction(prediction)) return false;
                if (!await record('prediction', 'predicted', predictedEvidence(prediction))) return false;
                state = { stage: 'predicted', observations: {}, judgement: '' };
                notify();
                return true;
            }); },
            observe(node) { return runAction(async () => {
                const expected = state.stage === 'predicted' ? 'B' : state.stage === 'observed-b' ? 'C' : state.stage === 'assessed' ? 'D' : '';
                if (node !== expected || !await authorize() || typeof settings.observe !== 'function') return false;
                const observation = settings.observe(node);
                if (!validObservation(observation, node)) return false;
                if (!await record(`observe-${node}`, 'attempted', attemptedEvidence(observation))) return false;
                state.observations[node] = observation;
                state.stage = node === 'B' ? 'observed-b' : node === 'C' ? 'observed-c' : 'observed-d';
                notify();
                return true;
            }); },
            assess(judgement) { return runAction(async () => {
                if (state.stage !== 'observed-c' || !JUDGEMENTS.has(judgement) || !await authorize()
                    || !validObservation(state.observations.B, 'B') || !validObservation(state.observations.C, 'C')) return false;
                state.judgement = judgement;
                state.stage = 'assessed';
                notify();
                return true;
            }); },
            correct(modelLimitAcknowledged) { return runAction(async () => {
                if (state.stage !== 'observed-d' || modelLimitAcknowledged !== true || !JUDGEMENTS.has(state.judgement)
                    || !validObservation(state.observations.D, 'D')) return false;
                if (!await record('correct', 'corrected', correctedEvidence(state.judgement))) return false;
                state.stage = 'corrected';
                notify();
                return true;
            }); },
            explain() { return runAction(async () => {
                if (state.stage !== 'corrected') return false;
                if (!await record('explain', 'explained', explainedEvidence())) return false;
                state.stage = 'waiting-server';
                notify();
                return true;
            }); },
            redo() { return runAction(async () => {
                if (!await authorize()) return false;
                retryIds.clear();
                state = initialRecovery();
                notify();
                return true;
            }); },
            snapshot,
            destroy() {
                destroyed = true;
                actionInFlight = false;
                busy = false;
                retryIds.clear();
            }
        };
        notify();
        return Object.freeze(api);
    }

    const BridgeTruss = {
        canvas: null,
        ctx: null,
        loadInput: null,
        loadValue: null,
        safetyInput: null,
        safetyValue: null,
        positionButtons: [],
        memberButtons: [],
        infoRoot: null,
        controlledRoot: null,
        controlledFlow: null,
        controlledAbort: null,
        controlledActivity: false,
        rafId: 0,
        reducedMotion: false,
        controlledFlowState: null,
        controlledVisualResult: null,
        controlledVisualNode: '',
        controlledVisualPosition: 1,
        controlledVisualReveal: 0,
        controlledVisualAnimating: false,
        dpr: 1,
        state: {
            load: 60,
            loadJoint: 'C',
            memberMode: 'full',
            safetyFactor: 1.8
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

        init(options) {
            const settings = options || {};
            this.destroy();
            this.controlledActivity = settings.controlledActivity === true;
            this.reducedMotion = typeof window.matchMedia === 'function'
                && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            this._resetControlledVisual();
            this.state.load = 60;
            this.state.loadJoint = this.controlledActivity ? 'B' : 'C';
            this.state.memberMode = 'full';
            this.state.safetyFactor = 1.8;
            this.canvas = document.getElementById('bridge-truss-canvas');
            if (!this.canvas) return;
            this.ctx = typeof this.canvas.getContext === 'function'
                ? this.canvas.getContext('2d')
                : null;
            this.loadInput = document.getElementById('truss-load');
            this.loadValue = document.getElementById('truss-load-value');
            this.safetyInput = document.getElementById('truss-safety');
            this.safetyValue = document.getElementById('truss-safety-value');
            this.positionButtons = this.controlledActivity ? [] : Array.from(document.querySelectorAll('[data-truss-joint]'));
            this.memberButtons = this.controlledActivity ? [] : Array.from(document.querySelectorAll('[data-truss-member]'));
            this.infoRoot = document.getElementById('truss-info');

            if (this.loadInput && !this.loadInput.dataset.bound) {
                this.loadInput.dataset.bound = 'true';
                this.loadInput.addEventListener('input', () => {
                    this.state.load = Number(this.loadInput.value) || 60;
                    this.render();
                });
            }

            if (this.safetyInput && !this.safetyInput.dataset.bound) {
                this.safetyInput.dataset.bound = 'true';
                this.safetyInput.addEventListener('input', () => {
                    this.state.safetyFactor = Math.max(1.1, Number(this.safetyInput.value) || 1.8);
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

            this.memberButtons.forEach(button => {
                if (button.dataset.bound) return;
                button.dataset.bound = 'true';
                button.addEventListener('click', () => {
                    this.state.memberMode = button.dataset.trussMember || 'full';
                    this.render();
                });
            });

            window.addEventListener('resize', this._boundResize || (this._boundResize = () => this.render()));
            this.render();
            if (this.controlledActivity) this._initControlledFlow(settings);
        },

        destroy() {
            if (this.controlledAbort) this.controlledAbort.abort();
            this.controlledAbort = null;
            if (this.controlledFlow) this.controlledFlow.destroy();
            this.controlledFlow = null;
            this.controlledRoot = null;
            this.controlledActivity = false;
            if (this.rafId) cancelAnimationFrame(this.rafId);
            this.rafId = 0;
            this.controlledFlowState = null;
            this.controlledVisualResult = null;
            this.controlledVisualNode = '';
            this.controlledVisualPosition = 1;
            this.controlledVisualReveal = 0;
            this.controlledVisualAnimating = false;
            if (this._boundResize) window.removeEventListener('resize', this._boundResize);
        },

        _initControlledFlow(options) {
            this.controlledRoot = document.querySelector('[data-load-path-flow]');
            this._mountControlledShowcase();
            const controller = options && options.evidenceController;
            const provider = window.FutureGalaxyPublicationContext;
            if (!this.controlledRoot || !controller || !provider
                || typeof provider.resolveLearningEvidence !== 'function'
                || typeof provider.sameLearningEvidenceAuthority !== 'function') {
                this._setControlledStatus('课程范围或证据服务不可用；当前活动保持只读。');
                return;
            }
            this.controlledAbort = new AbortController();
            this.controlledFlow = createLoadPathFlow({
                controller,
                pendingRecords: options.pendingRecords || [],
                authorizeRecord: options.authorizeRecord,
                resolveAuthority: () => provider.resolveLearningEvidence(LOAD_PATH_MAPPING),
                sameAuthority: (expected, current) => provider.sameLearningEvidenceAuthority(expected, current),
                isActive: () => !this.controlledAbort.signal.aborted
                    && (!options.isRuntimeCurrent || options.isRuntimeCurrent()),
                observe: (node) => {
                    this.state.load = 60;
                    this.state.loadJoint = node;
                    this.state.memberMode = 'full';
                    const exactResult = this.solve();
                    this._animateControlledResult(node, exactResult);
                    return normalizeLoadPathObservation(node, exactResult);
                },
                onChange: state => this._renderControlledFlow(state)
            });
            this.controlledRoot.addEventListener('click', async event => {
                const button = event.target instanceof Element && event.target.closest('[data-load-path-action]');
                if (!button || button.disabled || !this.controlledFlow) return;
                const action = button.dataset.loadPathAction;
                if (action === 'predict') {
                    const value = name => {
                        const field = this.controlledRoot.querySelector(`[data-load-path-prediction="${name}"]`);
                        return field && field.value || '';
                    };
                    const reason = this.controlledRoot.querySelector('[data-load-path-reason]');
                    await this.controlledFlow.predict({
                        reaction_balance_id: value('reaction_balance_id'),
                        gh_change_id: value('gh_change_id'),
                        cd_change_id: value('cd_change_id'),
                        reason_size: String(reason && reason.value || '').trim().length
                    });
                } else if (action === 'observe') {
                    await this.controlledFlow.observe(button.dataset.loadPathNode || '');
                } else if (action === 'assess') {
                    const judgement = this.controlledRoot.querySelector('[data-load-path-judgement]');
                    await this.controlledFlow.assess(judgement && judgement.value || '');
                } else if (action === 'correct') {
                    const acknowledged = this.controlledRoot.querySelector('[data-load-path-model-limit]');
                    await this.controlledFlow.correct(Boolean(acknowledged && acknowledged.checked));
                } else if (action === 'explain') {
                    await this.controlledFlow.explain();
                } else if (action === 'redo') {
                    if (await this.controlledFlow.redo()) {
                        this.state.load = 60;
                        this.state.loadJoint = 'B';
                        this.state.memberMode = 'full';
                        this._resetControlledVisual();
                        this.render();
                    }
                }
            }, { signal: this.controlledAbort.signal });
            this._renderControlledFlow(this.controlledFlow.snapshot());
        },

        _setControlledStatus(message) {
            const status = this.controlledRoot && this.controlledRoot.querySelector('[data-load-path-status]');
            if (status) status.textContent = message;
        },

        _renderControlledFlow(flowState) {
            if (!this.controlledRoot || !flowState) return;
            this.controlledFlowState = flowState;
            const stage = flowState.stage;
            const busy = flowState.busy;
            const blocked = flowState.blocked === true;
            const enabledAction = {
                predict: stage === 'prediction',
                B: stage === 'predicted',
                C: stage === 'observed-b',
                assess: stage === 'observed-c',
                D: stage === 'assessed',
                correct: stage === 'observed-d',
                explain: stage === 'corrected',
                redo: stage !== 'prediction'
            };
            this.controlledRoot.querySelectorAll('[data-load-path-action]').forEach(button => {
                const action = button.dataset.loadPathAction;
                const key = action === 'observe' ? button.dataset.loadPathNode : action;
                button.disabled = blocked || busy || !enabledAction[key];
            });
            this.controlledRoot.querySelectorAll('[data-load-path-prediction], [data-load-path-reason]').forEach(field => {
                field.disabled = blocked || busy || stage !== 'prediction';
            });
            const judgement = this.controlledRoot.querySelector('[data-load-path-judgement]');
            if (judgement) {
                judgement.disabled = blocked || busy || stage !== 'observed-c';
                if (flowState.judgement) judgement.value = flowState.judgement;
                else if (stage === 'prediction') judgement.value = '';
            }
            const acknowledged = this.controlledRoot.querySelector('[data-load-path-model-limit]');
            if (acknowledged) {
                acknowledged.disabled = blocked || busy || stage !== 'observed-d';
                if (stage === 'prediction') acknowledged.checked = false;
            }
            ['B', 'C', 'D'].forEach(node => {
                const observation = flowState.observations[node];
                const row = this.controlledRoot.querySelector(`[data-load-path-row="${node}"]`);
                if (!row) return;
                if (!validObservation(observation, node)) {
                    row.innerHTML = `<th>${node}</th><td colspan="5">尚未运行</td>`;
                    return;
                }
                const ghType = observation.member_gh_type_id === 'compression' ? '受压' : observation.member_gh_type_id === 'tension' ? '受拉' : '近零';
                const cdType = observation.member_cd_type_id === 'compression' ? '受压' : observation.member_cd_type_id === 'tension' ? '受拉' : '近零';
                row.innerHTML = `<th>${node}</th><td>${observation.reaction_ay_kn.toFixed(1)}</td><td>${observation.reaction_ey_kn.toFixed(1)}</td><td>${observation.member_gh_kn.toFixed(1)} / ${ghType}</td><td>${observation.member_cd_kn.toFixed(1)} / ${cdType}</td><td>${observation.residual_fx_kn.toFixed(2)} / ${observation.residual_fy_kn.toFixed(2)}</td>`;
            });
            const messages = {
                prediction: '先完成结构化预测；尚未运行任何工况。',
                predicted: '预测已耐久保存。现在运行 B 基线。',
                'observed-b': 'B 基线已保存。只把荷载节点改为 C。',
                'observed-c': 'B/C 完整快照已保存。请先作观察后判断。',
                assessed: '本页判断已保存于当前页面。现在运行 D 镜像复核。',
                'observed-d': 'D 镜像快照已保存。确认模型边界后完成纠正。',
                corrected: '纠正证据已保存。提交固定结构化解释。',
                'waiting-server': '解释已保存；完成状态仅等待服务端投影，本页不自行判定 completed。'
            };
            this._setControlledStatus(blocked
                ? '证据冲突需处理，本活动只读。'
                : busy ? '正在保存本次证据，请勿重复操作。' : messages[stage] || '活动保持失败关闭。');
            this._updateControlledShowcase(flowState);
            if (!busy && this.controlledActivity) this._syncControlledVisualFromFlow(flowState);
        },

        _mountControlledShowcase() {
            const root = this.controlledRoot;
            if (!root || typeof document.createElement !== 'function'
                || typeof root.querySelector !== 'function') return;
            if (!root.querySelector('[data-load-path-progress]')
                && typeof root.insertBefore === 'function') {
                const progress = document.createElement('nav');
                progress.className = 'fg-load-path__progress';
                progress.dataset.loadPathProgress = 'true';
                progress.setAttribute('aria-label', '载荷路径学习步骤');
                progress.innerHTML = `
                    <ol>
                        <li data-load-path-progress-step="0"><span>01</span><strong>预测</strong></li>
                        <li data-load-path-progress-step="1"><span>02</span><strong>基线 B</strong></li>
                        <li data-load-path-progress-step="2"><span>03</span><strong>变化 C</strong></li>
                        <li data-load-path-progress-step="3"><span>04</span><strong>判断</strong></li>
                        <li data-load-path-progress-step="4"><span>05</span><strong>镜像 D</strong></li>
                        <li data-load-path-progress-step="5"><span>06</span><strong>解释</strong></li>
                    </ol>`;
                root.insertBefore(progress, root.firstChild || null);
            }
            const progress = root.querySelector('[data-load-path-progress]');
            if (!root.querySelector('[data-load-path-brief]')) {
                const brief = document.createElement('section');
                brief.className = 'fg-load-path__brief';
                brief.dataset.loadPathBrief = 'true';
                brief.setAttribute('aria-label', '课程目标与受控条件');
                brief.innerHTML = `
                    <div><span>课程目标</span><strong>用三次完整求解解释荷载路径如何重分配</strong><p>最终产出：预测、B / C / D 观察、平衡判断、模型边界与结构化解释。</p></div>
                    <dl>
                        <div><dt>唯一变量</dt><dd>荷载节点 B → C → D</dd></div>
                        <div><dt>固定条件</dt><dd>60 kN · 完整 15 杆</dd></div>
                        <div><dt>模型</dt><dd>理想二维铰接桁架</dd></div>
                    </dl>`;
                root.insertBefore(brief, progress && progress.nextSibling || root.firstChild || null);
            }
            if (!root.querySelector('[data-load-path-coach]')) {
                const coach = document.createElement('aside');
                coach.className = 'fg-load-path__coach';
                coach.dataset.loadPathCoach = 'true';
                coach.setAttribute('aria-live', 'polite');
                coach.innerHTML = `
                    <span>当前讲解</span>
                    <strong data-load-path-coach-title></strong>
                    <p data-load-path-coach-cue></p>
                    <ul data-load-path-coach-checks></ul>`;
                const firstStep = root.querySelector('.fg-load-path__step');
                root.insertBefore(coach, firstStep || null);
            }
            let delta = root.querySelector('[data-load-path-delta]');
            if (!delta) {
                delta = document.createElement('aside');
                delta.className = 'fg-load-path__delta';
                delta.dataset.loadPathDelta = 'true';
                delta.hidden = true;
                delta.innerHTML = `
                    <span>B → C 可观察变化</span>
                    <div data-load-path-delta-copy></div>
                    <p>数值来自上方两次完整求解；颜色和过渡动画不作为学习证据。</p>`;
                const table = root.querySelector('.fg-load-path__table-wrap');
                if (table && table.parentNode && typeof table.parentNode.insertBefore === 'function') {
                    table.parentNode.insertBefore(delta, table.nextSibling || null);
                } else if (typeof root.appendChild === 'function') {
                    root.appendChild(delta);
                }
            }
            if (!root.querySelector('[data-load-path-conclusion]')) {
                const conclusion = document.createElement('section');
                conclusion.className = 'fg-load-path__conclusion';
                conclusion.dataset.loadPathConclusion = 'true';
                conclusion.hidden = true;
                conclusion.setAttribute('aria-label', '三工况结论与模型边界');
                conclusion.innerHTML = `
                    <span>结课收束</span>
                    <strong data-load-path-conclusion-title></strong>
                    <ul data-load-path-conclusion-facts></ul>
                    <p data-load-path-conclusion-boundary></p>
                    <small data-load-path-conclusion-receipt></small>`;
                if (delta.parentNode && typeof delta.parentNode.insertBefore === 'function') {
                    delta.parentNode.insertBefore(conclusion, delta.nextSibling || null);
                } else if (typeof root.appendChild === 'function') {
                    root.appendChild(conclusion);
                }
            }
        },

        _updateControlledShowcase(flowState) {
            const root = this.controlledRoot;
            if (!root || !flowState) return;
            const stage = flowState.stage;
            if (root.dataset) root.dataset.loadPathStage = stage;
            const stageIndex = {
                prediction: 0,
                predicted: 1,
                'observed-b': 2,
                'observed-c': 3,
                assessed: 4,
                'observed-d': 4,
                corrected: 5,
                'waiting-server': 6
            }[stage] ?? 0;
            if (typeof root.querySelectorAll === 'function') {
                root.querySelectorAll('[data-load-path-progress-step]').forEach(item => {
                    const index = Number(item.dataset && item.dataset.loadPathProgressStep);
                    if (!Number.isFinite(index)) return;
                    item.dataset.state = index < stageIndex ? 'complete' : index === stageIndex ? 'active' : 'locked';
                    if (typeof item.setAttribute === 'function' && index === stageIndex && stageIndex < 6) {
                        item.setAttribute('aria-current', 'step');
                    } else if (typeof item.removeAttribute === 'function') {
                        item.removeAttribute('aria-current');
                    }
                });
            }
            const delta = typeof root.querySelector === 'function'
                ? root.querySelector('[data-load-path-delta]')
                : null;
            const copy = typeof root.querySelector === 'function'
                ? root.querySelector('[data-load-path-delta-copy]')
                : null;
            const baseline = flowState.observations && flowState.observations.B;
            const changed = flowState.observations && flowState.observations.C;
            const ready = validObservation(baseline, 'B') && validObservation(changed, 'C');
            if (delta) delta.hidden = !ready;
            if (ready && copy) {
                const spreadB = Math.abs(baseline.reaction_ay_kn - baseline.reaction_ey_kn);
                const spreadC = Math.abs(changed.reaction_ay_kn - changed.reaction_ey_kn);
                const ghDelta = Math.abs(changed.member_gh_kn) - Math.abs(baseline.member_gh_kn);
                const cdDelta = Math.abs(changed.member_cd_kn) - Math.abs(baseline.member_cd_kn);
                copy.innerHTML = `
                    <strong><small>反力差 |Aᵧ−Eᵧ|</small>${spreadB.toFixed(1)} → ${spreadC.toFixed(1)} kN</strong>
                    <strong><small>|GH|</small>${Math.abs(baseline.member_gh_kn).toFixed(1)} → ${Math.abs(changed.member_gh_kn).toFixed(1)} kN <em>+${ghDelta.toFixed(1)}</em></strong>
                    <strong><small>|CD|</small>${Math.abs(baseline.member_cd_kn).toFixed(1)} → ${Math.abs(changed.member_cd_kn).toFixed(1)} kN <em>+${cdDelta.toFixed(1)}</em></strong>`;
            }
            const story = buildLoadPathStory(stage, flowState.observations);
            const coachTitle = root.querySelector('[data-load-path-coach-title]');
            const coachCue = root.querySelector('[data-load-path-coach-cue]');
            const coachChecks = root.querySelector('[data-load-path-coach-checks]');
            if (coachTitle) coachTitle.textContent = story.title;
            if (coachCue) coachCue.textContent = story.cue;
            if (coachChecks) coachChecks.innerHTML = story.checks.map(item => `<li>${item}</li>`).join('');
            const conclusion = root.querySelector('[data-load-path-conclusion]');
            if (conclusion) conclusion.hidden = !story.conclusion;
            if (story.conclusion) {
                const conclusionTitle = root.querySelector('[data-load-path-conclusion-title]');
                const conclusionFacts = root.querySelector('[data-load-path-conclusion-facts]');
                const conclusionBoundary = root.querySelector('[data-load-path-conclusion-boundary]');
                const conclusionReceipt = root.querySelector('[data-load-path-conclusion-receipt]');
                if (conclusionTitle) conclusionTitle.textContent = story.conclusion.title;
                if (conclusionFacts) conclusionFacts.innerHTML = story.conclusion.facts.map(item => `<li>${item}</li>`).join('');
                if (conclusionBoundary) conclusionBoundary.textContent = story.conclusion.boundary;
                if (conclusionReceipt) conclusionReceipt.textContent = story.conclusion.receipt;
            }
            if (this.canvas && typeof this.canvas.setAttribute === 'function') {
                const labels = {
                    prediction: '载荷路径实验：预测阶段，只显示中性桁架与固定荷载，不显示求解答案',
                    predicted: '载荷路径实验：预测已记录，等待运行 B 基线',
                    'observed-b': '载荷路径实验：B 基线已观察，等待只改为 C',
                    'observed-c': '载荷路径实验：B 与 C 已观察，等待判断',
                    assessed: '载荷路径实验：判断已保存，等待 D 镜像复核',
                    'observed-d': '载荷路径实验：D 镜像已观察，等待纠正',
                    corrected: '载荷路径实验：纠正已记录，等待结构化解释',
                    'waiting-server': '载荷路径实验：解释已记录，等待服务端完成投影'
                };
                this.canvas.setAttribute('aria-label', labels[stage] || '载荷路径受控实验');
            }
        },

        _resetControlledVisual() {
            if (this.rafId) cancelAnimationFrame(this.rafId);
            this.rafId = 0;
            this.controlledVisualResult = null;
            this.controlledVisualNode = '';
            this.controlledVisualPosition = 1;
            this.controlledVisualReveal = 0;
            this.controlledVisualAnimating = false;
        },

        _syncControlledVisualFromFlow(flowState) {
            if (!flowState || !this.controlledActivity) return;
            const observations = flowState.observations || {};
            const node = validObservation(observations.D, 'D') ? 'D'
                : validObservation(observations.C, 'C') ? 'C'
                : validObservation(observations.B, 'B') ? 'B' : '';
            if (!node) {
                if (this.controlledVisualResult || this.controlledVisualAnimating) {
                    this._resetControlledVisual();
                    this.state.loadJoint = 'B';
                    this.render();
                }
                return;
            }
            if (this.controlledVisualNode === node) return;
            if (this.rafId) cancelAnimationFrame(this.rafId);
            this.rafId = 0;
            this.controlledVisualAnimating = false;
            this.state.load = 60;
            this.state.loadJoint = node;
            this.state.memberMode = 'full';
            this.controlledVisualResult = this.solve();
            this.controlledVisualNode = node;
            this.controlledVisualPosition = this._controlledNodePosition(node);
            this.controlledVisualReveal = 1;
            this.render();
        },

        _controlledNodePosition(node) {
            return ({ B: 1, C: 2, D: 3 })[node] || 1;
        },

        _animateControlledResult(node, exactResult) {
            const targetPosition = this._controlledNodePosition(node);
            const startPosition = Number.isFinite(this.controlledVisualPosition)
                ? this.controlledVisualPosition
                : targetPosition;
            const startResult = this.controlledVisualResult
                || this._zeroControlledResult(exactResult);
            const startReveal = this.controlledVisualResult ? this.controlledVisualReveal : 0;
            if (this.rafId) cancelAnimationFrame(this.rafId);
            this.rafId = 0;
            this.controlledVisualNode = node;
            if (this.reducedMotion || typeof requestAnimationFrame !== 'function') {
                this.controlledVisualResult = exactResult;
                this.controlledVisualPosition = targetPosition;
                this.controlledVisualReveal = 1;
                this.controlledVisualAnimating = false;
                this.render();
                return;
            }
            const startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
                ? performance.now()
                : Date.now();
            const duration = 620;
            this.controlledVisualAnimating = true;
            const frame = timestamp => {
                const now = Number.isFinite(timestamp) ? timestamp : Date.now();
                const progress = Math.max(0, Math.min(1, (now - startedAt) / duration));
                const eased = 1 - Math.pow(1 - progress, 3);
                this.controlledVisualResult = this._interpolateControlledResult(startResult, exactResult, eased);
                this.controlledVisualPosition = startPosition + (targetPosition - startPosition) * eased;
                this.controlledVisualReveal = startReveal + (1 - startReveal) * eased;
                this.render();
                if (progress < 1) {
                    this.rafId = requestAnimationFrame(frame);
                    return;
                }
                this.rafId = 0;
                this.controlledVisualResult = exactResult;
                this.controlledVisualPosition = targetPosition;
                this.controlledVisualReveal = 1;
                this.controlledVisualAnimating = false;
                this.render();
            };
            this.rafId = requestAnimationFrame(frame);
        },

        _zeroControlledResult(result) {
            return {
                ...result,
                memberForces: result.memberForces.map(member => ({ ...member, force: 0, type: 'zero' })),
                reactions: { Ax: 0, Ay: 0, Ey: 0 },
                maxForce: 1,
                critical: { ...result.critical, force: 0, type: 'zero' }
            };
        },

        _interpolateControlledResult(from, to, progress) {
            const lerp = (left, right) => left + (right - left) * progress;
            const fromMembers = new Map(from.memberForces.map(member => [member.name, member]));
            const memberForces = to.memberForces.map(member => {
                const start = fromMembers.get(member.name) || { force: 0 };
                const force = lerp(Number(start.force) || 0, Number(member.force) || 0);
                return {
                    ...member,
                    force,
                    type: Math.abs(force) < 0.01 ? 'zero' : force > 0 ? 'tension' : 'compression'
                };
            });
            const maxForce = Math.max(1, ...memberForces.map(member => Math.abs(member.force)));
            const critical = memberForces.reduce((best, member) => (
                Math.abs(member.force) > Math.abs(best.force) ? member : best
            ), memberForces[0]);
            return {
                ...to,
                memberForces,
                maxForce,
                critical,
                reactions: {
                    Ax: lerp(Number(from.reactions.Ax) || 0, Number(to.reactions.Ax) || 0),
                    Ay: lerp(Number(from.reactions.Ay) || 0, Number(to.reactions.Ay) || 0),
                    Ey: lerp(Number(from.reactions.Ey) || 0, Number(to.reactions.Ey) || 0)
                }
            };
        },

        render() {
            if (this.loadInput) this.loadInput.value = String(this.state.load);
            if (this.loadValue) this.loadValue.textContent = `${this.state.load} kN`;
            if (this.safetyInput) this.safetyInput.value = String(this.state.safetyFactor);
            if (this.safetyValue) this.safetyValue.textContent = this.state.safetyFactor.toFixed(1);
            this.positionButtons.forEach(button => {
                const active = button.dataset.trussJoint === this.state.loadJoint;
                button.classList.toggle('is-active', active);
                button.setAttribute('aria-pressed', active ? 'true' : 'false');
            });
            this.memberButtons.forEach(button => {
                const active = button.dataset.trussMember === this.state.memberMode;
                button.classList.toggle('is-active', active);
                button.setAttribute('aria-pressed', active ? 'true' : 'false');
            });

            const exactResult = this.solve();
            const result = this.controlledActivity && this.controlledVisualResult
                ? this.controlledVisualResult
                : exactResult;
            if (this.canvas && this.ctx) {
                this._resizeCanvas();
                this.draw(result, this.controlledActivity ? {
                    loadPosition: this.controlledVisualPosition,
                    answerVisibility: this.controlledVisualReveal
                } : null);
            }
            this.updateInfo(result, this.controlledActivity ? {
                revealResults: this.controlledVisualReveal >= 0.999,
                animating: this.controlledVisualAnimating,
                node: this.controlledVisualNode
            } : null);
        },

        solve() {
            if (this.state.memberMode === 'remove-fb') {
                return this._unavailableMemberResult('FB');
            }

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
            const allowableForce = 130 / this.state.safetyFactor;
            const utilization = Math.abs(critical.force) / allowableForce;

            return {
                memberForces,
                reactions: {
                    Ax: byName.Ax || 0,
                    Ay: byName.Ay || 0,
                    Ey: byName.Ey || 0
                },
                maxForce,
                critical,
                removedMember: '',
                structuralStatus: {
                    stable: true,
                    message: ''
                },
                safety: {
                    available: true,
                    factor: this.state.safetyFactor,
                    allowableForce,
                    utilization,
                    passes: utilization <= 1
                }
            };
        },

        _unavailableMemberResult(removedMember) {
            return {
                memberForces: this.members.map((pair) => {
                    const name = pair.join('');
                    return {
                        name,
                        from: pair[0],
                        to: pair[1],
                        force: 0,
                        type: name === removedMember ? 'removed' : 'unavailable',
                        disabled: name === removedMember,
                        unavailable: true
                    };
                }),
                reactions: { Ax: 0, Ay: 0, Ey: 0 },
                maxForce: 1,
                critical: { name: removedMember, force: 0, type: 'unavailable' },
                removedMember,
                structuralStatus: {
                    stable: false,
                    message: 'FB 斜杆缺失后，受力路径中断；本静定桁架模型无法继续校核。'
                },
                safety: {
                    available: false,
                    factor: this.state.safetyFactor,
                    allowableForce: null,
                    utilization: null,
                    passes: false
                }
            };
        },

        draw(result, presentation) {
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
            const answerVisibility = presentation
                ? Math.max(0, Math.min(1, Number(presentation.answerVisibility) || 0))
                : 1;
            const loadPosition = presentation && Number.isFinite(presentation.loadPosition)
                ? presentation.loadPosition
                : this.joints.find(joint => joint.id === this.state.loadJoint)?.x || 1;
            const loadJoint = {
                x: padX + (loadPosition / 4) * span,
                y: deckY
            };

            this._drawGrid(ctx, w, h, deckY, padX, span);
            this._drawSupports(ctx, joints);
            this._drawLoad(ctx, loadJoint, this.state.load);
            if (result.structuralStatus.stable && answerVisibility > 0.04) {
                this._drawReactions(ctx, joints, result.reactions);
            }

            result.memberForces.forEach(member => {
                const a = joints.get(member.from);
                const b = joints.get(member.to);
                const ratio = Math.abs(member.force) / result.maxForce;
                const visibleRatio = ratio * answerVisibility;
                const width = member.disabled ? 1.4 : 2 + visibleRatio * 7;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.lineWidth = width;
                ctx.lineCap = 'round';
                ctx.setLineDash(member.disabled ? [7, 6] : []);
                ctx.strokeStyle = member.disabled
                    ? 'rgba(184,84,80,0.92)'
                    : answerVisibility <= 0.01
                    ? 'rgba(138,144,160,0.55)'
                    : member.type === 'tension'
                    ? `rgba(79,168,163,${0.34 + visibleRatio * 0.62})`
                    : member.type === 'compression'
                    ? `rgba(216,163,72,${0.34 + visibleRatio * 0.62})`
                    : 'rgba(138,144,160,0.38)';
                ctx.stroke();
                ctx.setLineDash([]);
            });

            result.memberForces.forEach(member => {
                const a = joints.get(member.from);
                const b = joints.get(member.to);
                const mx = (a.x + b.x) / 2;
                const my = (a.y + b.y) / 2;
                if (answerVisibility < 0.82 || Math.abs(member.force) < result.maxForce * 0.18) return;
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
            ctx.save();
            ctx.fillStyle = this.controlledActivity
                ? 'rgba(216,220,230,0.82)'
                : result.safety.available && result.safety.passes ? 'rgba(126,215,193,0.92)' : 'rgba(225,106,92,0.95)';
            ctx.font = `600 12px ${this._fontMono()}`;
            ctx.textAlign = 'left';
            const safetyText = this.controlledActivity
                ? answerVisibility <= 0.01
                    ? '60 kN 固定工况 · 预测提交前隐藏求解答案'
                    : '理想二维铰接桁架读数 · 非现实结构安全结论'
                : result.safety.available
                ? `安全校核：利用率 ${(result.safety.utilization * 100).toFixed(0)}% / 系数 ${result.safety.factor.toFixed(1)}`
                : '构件路径中断：本模型不可校核';
            ctx.fillText(safetyText, padX, top);
            ctx.restore();
        },

        updateInfo(result, presentation) {
            if (!this.infoRoot) return;
            if (this.controlledActivity && (!presentation || !presentation.revealResults)) {
                const processText = presentation && presentation.animating
                    ? `荷载正在移向 ${presentation.node || '目标'} 节点；画面只插值展示，最终数值仍由完整静力求解产生。`
                    : '先提交结构化预测，再运行 B 基线。预测提交前不显示支座反力、杆件轴力或颜色答案。';
                this.infoRoot.innerHTML = `
                    <div class="truss-panel truss-panel--locked">
                        <span class="truss-panel__label">固定实验条件</span>
                        <strong>60 kN · 完整 15 杆 · 理想二维铰接</strong>
                        <p>本课程只改变荷载节点 B → C → D；荷载、杆系与支座模型保持锁定。</p>
                    </div>
                    <div class="truss-panel truss-panel--process">
                        <span class="truss-panel__label">当前可观察过程</span>
                        <strong>${presentation && presentation.animating ? '求解画面更新中' : '等待预测与首个基线'}</strong>
                        <p>${processText}</p>
                    </div>
                `;
                return;
            }
            if (!result.structuralStatus.stable) {
                this.infoRoot.innerHTML = `
                    <div class="truss-panel">
                        <span class="truss-panel__label">构件路径中断</span>
                        <strong>FB 斜杆已移除</strong>
                        <p>该 15 杆、3 支反力的静定桁架失去一根构件后，不能用原静力模型重新求得平衡。画布因此只标示失效位置，不输出伪造内力、反力或安全通过率。</p>
                    </div>
                `;
                return;
            }
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
                <div class="truss-panel truss-panel--reaction">
                    <span class="truss-panel__label">支座反力</span>
                    <strong>A_y ${left} kN / E_y ${right} kN</strong>
                    <p>整体平衡先满足 ΣFy = 0 与 ΣM = 0；荷载越靠近一侧，该侧反力通常越大。</p>
                </div>
                <div class="truss-panel truss-panel--member">
                    <span class="truss-panel__label">最大杆力</span>
                    <strong>${critical.name} · ${Math.abs(critical.force).toFixed(1)} kN · ${typeLabel}</strong>
                    <p>未知杆力先按受拉建立；计算方向相反时显示为受压，线宽随轴力大小变化。</p>
                </div>
                <div class="truss-panel truss-panel--load">
                    <span class="truss-panel__label">当前荷载</span>
                    <strong>${this.state.load} kN 作用于 ${loadJoint} 节点</strong>
                    <p>节点法在每个铰接点列 ΣFx = 0、ΣFy = 0，因此本页只把荷载施加在节点上。</p>
                </div>
                <div class="truss-panel truss-panel--boundary">
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

    function initBridgeTruss(options) {
        BridgeTruss.init(options);
    }

    function destroyBridgeTruss() {
        BridgeTruss.destroy();
    }

    window.BridgeTruss = BridgeTruss;
    window.initBridgeTruss = initBridgeTruss;
    window.destroyBridgeTruss = destroyBridgeTruss;
})();
