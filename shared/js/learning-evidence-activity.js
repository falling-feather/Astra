(function (global) {
    'use strict';

    if (global.AstraLearningEvidenceActivity) return;

    const mounted = new WeakMap();
    const DOMAIN_COMMAND_CAPACITY = 16;
    const PEER_IDENTITY_CAPACITY = 256;

    function client() {
        if (!global.AstraLearningEvidenceClient) throw new Error('AstraLearningEvidenceClient unavailable');
        return global.AstraLearningEvidenceClient;
    }

    function catalog() {
        if (!global.AstraLearningActivityCatalog) throw new Error('AstraLearningActivityCatalog unavailable');
        return global.AstraLearningActivityCatalog;
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function normalizeError(error) {
        return client().normalizeError(error);
    }

    function defaultContextResolver(mapping) {
        if (mapping.galaxy_key === 'englab') {
            const provider = global.AstraEngineeringLabPublicationContext;
            return provider && provider.resolve(mapping.publication_context);
        }
        if (mapping.galaxy_key === 'code-space') {
            const provider = global.AstraCodeSpaceStudentContext;
            return provider && provider.resolveLearningEvidence(mapping.publication_context);
        }
        if (mapping.galaxy_key === 'future-galaxy') {
            const provider = global.FutureGalaxyPublicationContext;
            return provider && provider.resolveLearningEvidence(mapping.publication_context);
        }
        return null;
    }

    function stateMessage(code) {
        const messages = {
            class_selection_required: '你有多个班级，请明确选择本次活动所属班级。',
            scope_selection_required: '请先在当前产品中明确选择班级与课程。',
            class_scope_missing: '当前账号没有可用班级。',
            course_scope_missing: '当前班级没有匹配的已发布课程。',
            course_unit_missing: '当前课程尚未发布这一活动单元。',
            activity_locked: '该活动当前被教师锁定，不能写入学习证据。',
            activity_hidden: '该活动未在当前发布范围中开放。',
            publication_context_unavailable: '活动发布上下文暂不可用，请稍后重试。',
            rule_binding_missing: '当前课程尚未绑定学习证据规则，请联系教师完成发布。',
            rule_version_conflict: '规则版本已变化，请重新打开活动后继续。',
            student_role_required: '只有学习者可以提交本活动证据。',
            identity_required: '登录身份或角色已变化，本次操作未保存，请重新登录后继续。',
            cancelled: '登录身份或角色已变化，本次操作未保存，请重新登录后继续。',
            online_required: '自由文本解释不会保存在本机，请联网后重试。',
            evidence_memory_buffer_full: '活动操作暂存已满，请等待当前事件写入完成后重试本次操作。',
            evidence_peer_identity_full: '本活动等待跨标签确认的证据身份已达上限，请等待已有事件同步后重试。',
            queue_limit_reached: '共享待同步证据队列已满；本次操作仍保留在当前页面，请等待真实队列容量释放后重试。'
        };
        return messages[code] || '学习证据暂不可用，请稍后重试。';
    }

    function earliestPendingOccurredAt(commands) {
        return (Array.isArray(commands) ? commands : []).reduce((earliest, command) => {
            const value = command && command.occurred_at;
            const time = value && new Date(value).getTime();
            if (!Number.isFinite(time)) return earliest;
            if (!earliest || time < new Date(earliest).getTime()) return new Date(time).toISOString();
            return earliest;
        }, '');
    }

    function panelMarkup(options) {
        const domainOnly = options.domainOnly === true;
        const steps = domainOnly ? '' : options.integrated ? `<div class="astra-evidence-panel__steps astra-evidence-panel__steps--integrated" data-evidence-controls hidden>
                <label><span>结构化解释</span><select data-evidence-value="explanation"><option value="claim-supported">证据支持判断</option><option value="claim-needs-review">判断仍需复核</option></select><button type="button" data-evidence-command="explained">记录解释</button></label>
            </div>` : `<div class="astra-evidence-panel__steps" data-evidence-controls hidden>
                <label><span>1 · 预测</span><select data-evidence-value="prediction"><option value="expect-change">预计会改变</option><option value="expect-stable">预计保持稳定</option></select><button type="button" data-evidence-command="predicted">记录预测</button></label>
                <div class="astra-evidence-panel__domain"><span>2–3 · 操作与修正</span><b>${escapeHtml(options.operationLabel || '请在上方真实活动中完成操作')}</b><small>实际控件会自动记录有界领域事件，不需要另点“记录操作”。</small></div>
                <label><span>4 · 结构化解释</span><select data-evidence-value="explanation"><option value="claim-supported">证据支持判断</option><option value="claim-needs-review">判断仍需复核</option></select><button type="button" data-evidence-command="explained">记录解释</button></label>
            </div>`;
        const onlineExplanation = domainOnly ? '' : `<details class="astra-evidence-panel__online">
                <summary>补充自由文本解释（仅联网）</summary>
                <label><span>解释不会进入离线队列</span><textarea maxlength="800" data-evidence-free-text></textarea></label>
                <button type="button" data-evidence-command="explained-text">联网提交解释</button>
            </details>`;
        return `<div class="astra-evidence-panel__heading"><div><span>LEARNING EVIDENCE</span><h3>${escapeHtml(options.title || '学习证据')}</h3></div><small>完成与迁移仅显示服务端投影</small></div>
            <div data-evidence-scope></div>
            <div class="astra-evidence-status" data-evidence-status hidden></div>
            <div class="astra-evidence-status" data-evidence-domain-status hidden></div>
            <p class="astra-evidence-panel__projection" data-evidence-projection hidden></p>
            ${steps}
            ${onlineExplanation}`;
    }

    function createSession(host, options, mapping) {
        const abort = new AbortController();
        const state = {
            host,
            options,
            mapping,
            abort,
            context: null,
            ruleVersion: 0,
            projection: null,
            unsubscribe: null,
            initialized: false,
            initializing: null,
            initializeGeneration: 0,
            pendingCommands: [],
            draining: false,
            domainInFlight: false,
            domainBlockReason: '',
            domainGeneration: 0,
            recoveryTimer: 0,
            recoveryController: null,
            recoveryGeneration: 0,
            releaseDomainCommands: null,
            initializationError: null,
            authorityInvalidated: false,
            activeCommand: null,
            recentUntrackedCommand: null,
            recentDomainCommand: null,
            recordOperations: new Map(),
            commandGeneration: 0,
            commandInFlight: false,
            recordGeneration: 0,
            forceStartedOnInitialize: false
        };

        function statusNode() {
            return host.querySelector('[data-evidence-status]');
        }

        function renderStatus(value, message) {
            const component = global.AstraLearningEvidenceStatus;
            if (!component) return;
            component.render(statusNode(), value, {
                message,
                retry: () => client().flush().then(refreshStatus).catch(showError)
            });
        }

        function renderDomainStatus(value, message) {
            const node = host.querySelector('[data-evidence-domain-status]');
            if (!node) return;
            if (!message) {
                node.hidden = true;
                node.textContent = '';
                node.className = 'astra-evidence-status';
                delete node.dataset.evidenceState;
                delete node.dataset.evidenceDomainState;
                node.removeAttribute('role');
                return;
            }
            const component = global.AstraLearningEvidenceStatus;
            if (component) {
                component.render(node, value, { message });
                node.dataset.evidenceDomainState = value;
                return;
            }
            node.hidden = false;
            node.textContent = message;
            node.dataset.evidenceDomainState = value;
            node.setAttribute('role', value === 'manual-intervention' ? 'alert' : 'status');
        }

        function showDomainError(error) {
            const normalized = normalizeError(error);
            renderDomainStatus('manual-intervention', stateMessage(normalized.code));
            if (!state.activeCommand) showError(normalized);
        }

        function showError(error, settings) {
            const normalized = normalizeError(error);
            const node = statusNode();
            if (!node) return;
            const signal = document.createElement('span');
            const label = document.createElement('strong');
            const message = document.createElement('span');
            signal.className = 'astra-evidence-status__signal';
            signal.setAttribute('aria-hidden', 'true');
            label.textContent = '需要处理';
            message.textContent = settings && settings.message || stateMessage(normalized.code);
            node.hidden = false;
            node.className = 'astra-evidence-status astra-evidence-status--manual-intervention';
            node.dataset.evidenceState = 'manual-intervention';
            node.setAttribute('role', 'alert');
            node.replaceChildren(signal, label, message);
            if (settings && settings.initializeRetry) {
                const retry = document.createElement('button');
                retry.type = 'button';
                retry.className = 'astra-evidence-status__retry';
                retry.dataset.evidenceInitializeRetry = 'true';
                retry.textContent = '重新确认范围';
                retry.addEventListener('click', () => initialize(), { signal: abort.signal });
                node.appendChild(retry);
            }
        }

        function renderScope(result) {
            const scopeNode = host.querySelector('[data-evidence-scope]');
            if (!scopeNode) return;
            const classes = result && Array.isArray(result.classes) ? result.classes : [];
            if (result && result.error_code === 'class_selection_required' && classes.length) {
                scopeNode.innerHTML = `<label class="astra-evidence-panel__scope"><span>选择活动班级</span><select data-evidence-class><option value="">请选择班级</option>${classes.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name || `班级 ${item.id}`)}</option>`).join('')}</select></label>`;
                const select = scopeNode.querySelector('[data-evidence-class]');
                select.addEventListener('change', async () => {
                    const provider = mapping.galaxy_key === 'englab'
                        ? global.AstraEngineeringLabPublicationContext
                        : null;
                    if (!provider || typeof provider.selectClass !== 'function' || !select.value) return;
                    select.disabled = true;
                    const selected = await provider.selectClass(select.value);
                    if (!selected || abort.signal.aborted || !host.isConnected) return;
                    await initialize();
                }, { signal: abort.signal });
                return;
            }
            scopeNode.replaceChildren();
        }

        function renderProjection() {
            const node = host.querySelector('[data-evidence-projection]');
            if (!node) return;
            const projection = state.projection;
            if (!projection || !projection.status) {
                node.hidden = true;
                node.textContent = '';
                delete node.dataset.projectionStatus;
                return;
            }
            const labels = {
                not_started: '尚未开始',
                in_progress: '进行中',
                completed: '已完成',
                transferred: '已迁移'
            };
            node.textContent = `服务端学习投影：${labels[projection.status] || projection.status}（规则版本 ${projection.rule_version}）`;
            node.dataset.projectionStatus = projection.status;
            node.hidden = false;
        }

        function clearProjection() {
            state.projection = null;
            renderProjection();
        }

        function projectionHasStarted() {
            const value = state.projection && state.projection.first_started_at;
            return Boolean(
                value
                && Number.isFinite(new Date(value).getTime())
            );
        }

        function renderProjectionRefreshFailure(error) {
            const node = host.querySelector('[data-evidence-projection]');
            if (!node) return;
            const normalized = normalizeError(error);
            node.textContent = `本次事件已确认；服务端投影暂不可刷新（${normalized.code}），可稍后重试。`;
            node.dataset.projectionStatus = 'refresh-failed';
            node.hidden = false;
        }

        async function resolveContext() {
            const resolver = typeof options.resolveContext === 'function'
                ? options.resolveContext
                : defaultContextResolver;
            const resolved = await resolver(mapping);
            if (!resolved || resolved.available !== true) {
                renderScope(resolved);
                const code = resolved && resolved.error_code || 'publication_context_unavailable';
                const error = new Error(stateMessage(code));
                error.code = code;
                throw error;
            }
            renderScope(null);
            return resolved;
        }

        async function resolveRule(context, signal) {
            const operationSignal = signal || abort.signal;
            const recovery = await client().recovery({
                class_id: context.class_id,
                course_id: context.course_id
            }, { signal: operationSignal });
            if (
                operationSignal.aborted
                || abort.signal.aborted
                || context !== state.context
            ) {
                const cancelled = new Error('Learning evidence recovery superseded');
                cancelled.code = 'cancelled';
                throw cancelled;
            }
            const ruleVersion = Number(recovery && recovery.rule_version);
            if (!Number.isInteger(ruleVersion) || ruleVersion <= 0) {
                const error = new Error(stateMessage('rule_binding_missing'));
                error.code = 'rule_binding_missing';
                throw error;
            }
            state.projection = (recovery.activities || []).find(item => (
                Number(item.course_unit_id) === Number(context.course_unit_id)
                && item.activity_key === context.activity_key
            )) || null;
            renderProjection();
            return ruleVersion;
        }

        function commandPayload(eventType, evidence, occurredAt) {
            const context = state.context || {};
            return {
                class_id: context.class_id,
                course_id: context.course_id,
                course_unit_id: context.course_unit_id,
                assignment_id: context.assignment_id,
                activity_key: context.activity_key,
                rule_version: state.ruleVersion,
                event_type: eventType,
                evidence,
                occurred_at: occurredAt
            };
        }

        function sameRecordAuthority(expected, current) {
            if (!expected || !current || current.available !== true) return false;
            const exact = ['class_id', 'course_id', 'course_unit_id', 'activity_key'];
            if (!exact.every(key => String(expected[key]) === String(current[key]))) return false;
            const privateKeys = ['identity_id', 'authority_generation', 'access_state'];
            return privateKeys.every(key => (
                expected[key] === undefined
                || current[key] !== undefined && String(expected[key]) === String(current[key])
            ));
        }

        async function authorizeRecord(eventType, evidence) {
            if (typeof options.authorizeRecord !== 'function') return;
            const context = state.context;
            const generation = state.recordGeneration;
            const authorized = await options.authorizeRecord(Object.freeze({
                mapping,
                context,
                event_type: eventType,
                evidence
            }));
            if (
                abort.signal.aborted
                || state.authorityInvalidated
                || generation !== state.recordGeneration
                || context !== state.context
                || !sameRecordAuthority(context, authorized)
            ) {
                const error = new Error(stateMessage('identity_required'));
                error.code = 'identity_required';
                throw error;
            }
        }

        function createClientEventId(eventType) {
            if (global.crypto && typeof global.crypto.randomUUID === 'function') {
                return global.crypto.randomUUID();
            }
            return [
                'activity',
                eventType,
                Date.now().toString(36),
                Math.random().toString(16).slice(2)
            ].join('-');
        }

        function commandLabel(eventType) {
            return {
                predicted: '预测',
                explained: '解释'
            }[eventType] || '证据';
        }

        function changeEventType(change) {
            return change && (
                change.event_type
                || change.projection && change.projection.last_event_type
            ) || '';
        }

        function matchesActiveCommand(value) {
            const active = state.activeCommand;
            return Boolean(
                active
                && value
                && value.client_event_id === active.client_event_id
                && changeEventType(value) === active.event_type
            );
        }

        function hasEventIdentity(value) {
            return Boolean(value && value.client_event_id && changeEventType(value));
        }

        function recordOperationKey(value) {
            return hasEventIdentity(value)
                ? `${changeEventType(value)}:${value.client_event_id}`
                : '';
        }

        function operationScope(value) {
            return value && (value.projection || value) || {};
        }

        function operationMatchesScope(operation, value) {
            const scope = operationScope(value);
            return Boolean(
                operation
                && Number(scope.class_id) === operation.class_id
                && Number(scope.course_id) === operation.course_id
                && Number(scope.course_unit_id) === operation.course_unit_id
                && scope.activity_key === operation.activity_key
            );
        }

        function isKnownRecordOperation(value) {
            const operation = state.recordOperations.get(recordOperationKey(value));
            return Boolean(
                operation
                && operation.record_generation === state.recordGeneration
                && operationMatchesScope(operation, value)
            );
        }

        function releaseRecordOperation(value, expectedOperation) {
            const operationKey = recordOperationKey(value);
            const operation = state.recordOperations.get(operationKey);
            if (!operation || expectedOperation && operation !== expectedOperation) return false;
            state.recordOperations.delete(operationKey);
            if (
                state.domainBlockReason === 'local-identity-full'
                && state.recordOperations.size < PEER_IDENTITY_CAPACITY
            ) {
                state.domainBlockReason = '';
            }
            if (
                state.initialized
                && state.pendingCommands.length
                && !state.draining
                && !state.authorityInvalidated
                && !abort.signal.aborted
            ) drainDomainCommands();
            return true;
        }

        function waitsForPeerTerminal(result) {
            return Boolean(
                result
                && (
                    result.outcome === 'queued'
                    || result.state === 'local-pending'
                )
            );
        }

        function peerIdentityCapacityError() {
            const error = new Error(stateMessage('evidence_peer_identity_full'));
            error.code = 'evidence_peer_identity_full';
            return error;
        }

        function matchesRecentUntrackedCommand(value) {
            const recent = state.recentUntrackedCommand;
            return Boolean(
                !state.activeCommand
                && recent
                && recent.record_generation === state.recordGeneration
                && value
                && value.client_event_id === recent.client_event_id
                && changeEventType(value) === recent.event_type
            );
        }

        function matchesRecentDomainCommand(value) {
            const recent = state.recentDomainCommand;
            return Boolean(
                recent
                && recent.record_generation === state.recordGeneration
                && value
                && value.client_event_id === recent.client_event_id
                && changeEventType(value) === recent.event_type
                && operationMatchesScope(recent, value)
            );
        }

        function isCurrentCommand(command) {
            return Boolean(
                command
                && state.activeCommand
                && command.record_generation === state.recordGeneration
                && command.generation === state.activeCommand.generation
                && command.client_event_id === state.activeCommand.client_event_id
                && command.event_type === state.activeCommand.event_type
            );
        }

        function isCurrentRecord(operation) {
            return Boolean(
                operation
                && operation.record_generation === state.recordGeneration
                && !abort.signal.aborted
            );
        }

        function isCurrentUntrackedCommand(command) {
            return Boolean(
                isCurrentRecord(command)
                && matchesRecentUntrackedCommand(command)
            );
        }

        function isCurrentDomainCommand(command) {
            return Boolean(
                command
                && state.recentDomainCommand === command
                && command.record_generation === state.recordGeneration
                && !abort.signal.aborted
            );
        }

        function canRenderRecordResult(trackedCommand, untrackedCommand) {
            return trackedCommand
                ? isCurrentCommand(trackedCommand)
                : isCurrentUntrackedCommand(untrackedCommand);
        }

        function invalidateActiveCommand() {
            state.recordGeneration += 1;
            state.commandGeneration += 1;
            state.activeCommand = null;
            state.recentUntrackedCommand = null;
            state.recentDomainCommand = null;
            state.recordOperations.clear();
            state.commandInFlight = false;
        }

        function syncCommandButtons() {
            const disabled = Boolean(
                !state.initialized
                || state.authorityInvalidated
                || abort.signal.aborted
                || state.commandInFlight
            );
            host.querySelectorAll('[data-evidence-command]').forEach(button => {
                button.disabled = disabled;
            });
        }

        function renderCommandResult(command, result) {
            if (!isCurrentCommand(command)) return;
            if (command.state === 'confirmed' && result.state !== 'confirmed') return;
            command.state = result.state || 'manual-intervention';
            const label = commandLabel(command.event_type);
            if (result.state === 'syncing') {
                renderStatus('syncing', `正在提交本次${label}。`);
                return;
            }
            if (result.state === 'confirmed') {
                renderStatus('confirmed', `本次${label}已由服务端确认。完成状态仍以服务端投影为准。`);
                return;
            }
            if (result.state === 'local-pending') {
                renderStatus('local-pending', `本次${label}已安全保存在本机，将使用同一事件编号自动重试同步。`);
                return;
            }
            renderStatus('manual-intervention', `本次${label}尚未获得权威确认，已保留原事件编号等待人工核对。`);
        }

        function renderUntrackedCommandResult(command, result) {
            if (!isCurrentUntrackedCommand(command)) return;
            const recent = state.recentUntrackedCommand;
            const nextState = result.state
                || (result.outcome === 'confirmed' ? 'confirmed' : 'local-pending');
            if (recent.state === 'confirmed' && nextState !== 'confirmed') return;
            recent.state = nextState;
            if (nextState === 'confirmed') {
                renderStatus('confirmed', `本次${commandLabel(command.event_type)}已由服务端确认。完成状态仍以服务端投影为准。`);
                return;
            }
            if (nextState === 'syncing' && recent.domain_command) {
                renderStatus('syncing', '正在按顺序保存操作证据；后续操作已在当前页面内有界排队。');
                return;
            }
            renderStatus(nextState);
        }

        function renderDomainRecordResult(command, result) {
            if (!isCurrentDomainCommand(command)) return;
            const nextState = result && result.state
                || (result && result.outcome === 'confirmed' ? 'confirmed' : 'manual-intervention');
            if (command.state === 'confirmed' && nextState !== 'confirmed') return;
            command.state = nextState;
            if (nextState === 'confirmed') {
                renderDomainStatus('confirmed', '操作证据已由服务端确认。');
                return;
            }
            if (nextState === 'local-pending') {
                renderDomainStatus('local-pending', '操作证据已安全保存在本机，正在等待自动同步。');
                return;
            }
            renderDomainStatus('manual-intervention', '操作证据尚未获得权威确认，请稍后重试或人工核对。');
        }

        function shouldWarnCommandError(error) {
            const code = error && error.code || '';
            return Boolean(
                error
                && !abort.signal.aborted
                && ![
                    'cancelled',
                    'identity_required',
                    'evidence_peer_identity_full',
                    'queue_limit_reached'
                ].includes(code)
            );
        }

        function setCommandAvailability(available) {
            const controls = host.querySelector('[data-evidence-controls]');
            if (controls) controls.hidden = !available;
            if (!available) {
                host.querySelectorAll('[data-evidence-command]').forEach(button => {
                    button.disabled = true;
                });
                return;
            }
            syncCommandButtons();
        }

        async function record(eventType, evidence, settings) {
            if (!state.context || !state.ruleVersion) {
                const error = new Error('Activity evidence context unavailable');
                error.code = 'publication_context_unavailable';
                throw error;
            }
            if (typeof options.authorizeRecord === 'function') {
                await authorizeRecord(eventType, evidence);
            }
            const commandSettings = settings || {};
            const clientEventId = commandSettings.client_event_id || createClientEventId(eventType);
            const recordOperation = {
                client_event_id: clientEventId,
                event_type: eventType,
                domain_command: Boolean(commandSettings.domainCommand),
                class_id: Number(state.context.class_id),
                course_id: Number(state.context.course_id),
                course_unit_id: Number(state.context.course_unit_id),
                activity_key: state.context.activity_key,
                record_generation: state.recordGeneration
            };
            const operationKey = recordOperationKey(recordOperation);
            if (
                !state.recordOperations.has(operationKey)
                && state.recordOperations.size >= PEER_IDENTITY_CAPACITY
            ) {
                const error = peerIdentityCapacityError();
                if (recordOperation.domain_command) showDomainError(error);
                else showError(error);
                throw error;
            }
            state.recordOperations.set(operationKey, recordOperation);
            if (recordOperation.domain_command) {
                recordOperation.state = 'syncing';
                state.recentDomainCommand = recordOperation;
            }
            let retainRecordOperation = false;
            const trackedCommand = commandSettings.trackStatus ? {
                client_event_id: clientEventId,
                event_type: eventType,
                generation: ++state.commandGeneration,
                record_generation: recordOperation.record_generation,
                state: 'syncing'
            } : null;
            const untrackedCommand = trackedCommand || state.activeCommand
                ? null
                : recordOperation;
            if (trackedCommand) {
                state.activeCommand = trackedCommand;
                state.recentUntrackedCommand = null;
                state.commandInFlight = true;
                syncCommandButtons();
            } else if (untrackedCommand) {
                state.recentUntrackedCommand = Object.assign({
                    state: 'syncing'
                }, untrackedCommand);
            }
            if (!state.activeCommand || trackedCommand) {
                renderStatus('syncing', trackedCommand
                    ? `正在提交本次${commandLabel(eventType)}。`
                    : commandSettings.domainCommand
                        ? '正在按顺序保存操作证据；后续操作已在当前页面内有界排队。'
                        : undefined);
            }
            try {
                const payload = Object.assign(
                    commandPayload(eventType, evidence, commandSettings.occurred_at),
                    { client_event_id: clientEventId }
                );
                const result = await client().record(payload, commandSettings);
                if (!isCurrentRecord(recordOperation)) return result;
                if (result.outcome === 'cancelled') {
                    const error = new Error(stateMessage('identity_required'));
                    error.code = 'identity_required';
                    if (recordOperation.domain_command) {
                        showDomainError(error);
                    } else if (canRenderRecordResult(trackedCommand, untrackedCommand)) {
                        showError(error, trackedCommand ? {
                            message: `本次${commandLabel(eventType)}未保存：${stateMessage('identity_required')}`
                        } : undefined);
                    }
                    throw error;
                }
                retainRecordOperation = Boolean(
                    waitsForPeerTerminal(result)
                    && state.recordOperations.get(operationKey) === recordOperation
                );
                if (trackedCommand) {
                    renderCommandResult(trackedCommand, result);
                } else if (untrackedCommand) {
                    renderUntrackedCommandResult(untrackedCommand, result);
                }
                if (recordOperation.domain_command) {
                    renderDomainRecordResult(recordOperation, result);
                }
                if (eventType === 'explained' && result.state === 'confirmed') {
                    const context = state.context;
                    if (context && canRenderRecordResult(trackedCommand, untrackedCommand)) {
                        cancelProjectionRecovery();
                        try {
                            const ruleVersion = await resolveRule(context);
                            if (
                                state.context === context
                                && canRenderRecordResult(trackedCommand, untrackedCommand)
                            ) state.ruleVersion = ruleVersion;
                        } catch (error) {
                            if (canRenderRecordResult(trackedCommand, untrackedCommand)) {
                                renderProjectionRefreshFailure(error);
                            }
                        }
                    }
                    if (canRenderRecordResult(trackedCommand, untrackedCommand)) {
                        renderStatus('confirmed', `本次解释已确认；服务端投影为${state.projection && state.projection.status ? `“${state.projection.status}”` : '当前规则状态'}。`);
                    }
                }
                if (!retainRecordOperation) {
                    releaseRecordOperation(recordOperation, recordOperation);
                }
                return result;
            } catch (error) {
                if (!isCurrentRecord(recordOperation)) {
                    return Object.freeze({ outcome: 'cancelled', state: '' });
                }
                const normalized = error && error.code === 'cancelled'
                    ? Object.assign(new Error(stateMessage('identity_required')), { code: 'identity_required' })
                    : normalizeError(error);
                if (
                    recordOperation.domain_command
                    && normalized.code === 'queue_limit_reached'
                ) {
                    retainRecordOperation = true;
                    showDomainError(normalized);
                    throw error;
                }
                releaseRecordOperation(recordOperation, recordOperation);
                if (recordOperation.domain_command) {
                    showDomainError(normalized);
                } else if (canRenderRecordResult(trackedCommand, untrackedCommand)) {
                    showError(normalized, trackedCommand ? {
                        message: `本次${commandLabel(eventType)}未保存：${stateMessage(normalizeError(normalized).code)}`
                    } : undefined);
                }
                throw error;
            } finally {
                if (!retainRecordOperation) {
                    releaseRecordOperation(recordOperation, recordOperation);
                }
                if (trackedCommand && isCurrentCommand(trackedCommand)) {
                    state.commandInFlight = false;
                }
                syncCommandButtons();
            }
        }

        async function refreshStatus() {
            if (!state.context) return;
            const current = await client().stateFor(state.context);
            if (current && current.state && !state.activeCommand) renderStatus(current.state);
        }

        function cancelProjectionRecovery() {
            if (state.recoveryTimer) global.clearTimeout(state.recoveryTimer);
            state.recoveryTimer = 0;
            if (state.recoveryController) state.recoveryController.abort();
            state.recoveryController = null;
            state.recoveryGeneration += 1;
        }

        function scheduleProjectionRecovery(change) {
            if (!state.context || abort.signal.aborted) return;
            if (state.recoveryTimer) global.clearTimeout(state.recoveryTimer);
            state.recoveryTimer = global.setTimeout(async () => {
                state.recoveryTimer = 0;
                if (!state.context || abort.signal.aborted) return;
                if (state.recoveryController) state.recoveryController.abort();
                const context = state.context;
                const controller = new AbortController();
                const generation = ++state.recoveryGeneration;
                state.recoveryController = controller;
                try {
                    const ruleVersion = await resolveRule(context, controller.signal);
                    if (generation !== state.recoveryGeneration || controller.signal.aborted) return;
                    state.ruleVersion = ruleVersion;
                    if (state.activeCommand && matchesActiveCommand(change)) {
                        renderCommandResult(state.activeCommand, { state: 'confirmed' });
                    } else if (matchesRecentUntrackedCommand(change)) {
                        renderUntrackedCommandResult(state.recentUntrackedCommand, {
                            state: 'confirmed'
                        });
                    } else if (
                        !state.activeCommand
                        && !state.recentUntrackedCommand
                        && !hasEventIdentity(change)
                    ) {
                        renderStatus('confirmed', `证据已确认；服务端投影为${state.projection && state.projection.status ? `“${state.projection.status}”` : '当前规则状态'}。`);
                    }
                } catch (error) {
                    const normalized = normalizeError(error);
                    if (abort.signal.aborted || normalized.code === 'cancelled') return;
                    if (
                        state.activeCommand && matchesActiveCommand(change)
                        || matchesRecentUntrackedCommand(change)
                    ) {
                        renderProjectionRefreshFailure(normalized);
                        return;
                    }
                    if (
                        !state.activeCommand
                        && !state.recentUntrackedCommand
                        && !hasEventIdentity(change)
                    ) showError(normalized);
                } finally {
                    if (state.recoveryController === controller) state.recoveryController = null;
                }
            }, 160);
        }

        function cloneDomainEvidence(evidence) {
            let serialized = '';
            try {
                serialized = JSON.stringify(evidence);
            } catch (_) {}
            if (!serialized || serialized.length > 8192) {
                const error = new Error(stateMessage('evidence_memory_buffer_full'));
                error.code = 'evidence_memory_buffer_full';
                throw error;
            }
            return JSON.parse(serialized);
        }

        function bufferDomainCommand(eventType, evidence, occurredAt, scope) {
            const retainedCount = state.pendingCommands.length;
            if (retainedCount >= DOMAIN_COMMAND_CAPACITY) {
                const error = new Error(stateMessage('evidence_memory_buffer_full'));
                error.code = 'evidence_memory_buffer_full';
                showDomainError(error);
                return false;
            }
            try {
                state.pendingCommands.push({
                    client_event_id: createClientEventId(eventType),
                    eventType,
                    evidence: cloneDomainEvidence(evidence),
                    class_id: Number(scope && scope.class_id || 0),
                    course_id: Number(scope && scope.course_id || 0),
                    occurred_at: occurredAt && Number.isFinite(new Date(occurredAt).getTime())
                        ? new Date(occurredAt).toISOString()
                        : new Date().toISOString()
                });
                if (state.initializationError) {
                    showError(state.initializationError, { initializeRetry: true });
                } else if (state.initialized) {
                    const message = '正在按顺序保存操作证据；后续操作已在当前页面内有界排队。';
                    renderDomainStatus('syncing', message);
                    if (!state.activeCommand) renderStatus('syncing', message);
                } else {
                    const message = '活动范围正在确认；首批真实操作已在当前页面内暂存。';
                    renderDomainStatus('syncing', message);
                    renderStatus('syncing', message);
                }
                return true;
            } catch (error) {
                showDomainError(error);
                return false;
            }
        }

        async function drainDomainCommands() {
            if (state.draining || !state.initialized || state.domainBlockReason) return;
            const generation = state.domainGeneration;
            state.draining = true;
            try {
                while (
                    state.pendingCommands.length
                    && state.initialized
                    && !abort.signal.aborted
                    && generation === state.domainGeneration
                ) {
                    const command = state.pendingCommands[0];
                    if (
                        command.class_id
                        && (
                            command.class_id !== Number(state.context && state.context.class_id)
                            || command.course_id !== Number(state.context && state.context.course_id)
                        )
                    ) {
                        state.pendingCommands.shift();
                        continue;
                    }
                    if (state.recordOperations.size >= PEER_IDENTITY_CAPACITY) {
                        state.domainBlockReason = 'local-identity-full';
                        showDomainError(peerIdentityCapacityError());
                        break;
                    }
                    state.domainInFlight = true;
                    try {
                        await record(command.eventType, command.evidence, {
                            client_event_id: command.client_event_id,
                            occurred_at: command.occurred_at,
                            domainCommand: true,
                            signal: abort.signal
                        });
                        if (state.pendingCommands[0] === command) {
                            state.pendingCommands.shift();
                        }
                    } catch (error) {
                        const normalized = normalizeError(error);
                        if (normalized.code === 'queue_limit_reached') {
                            state.domainBlockReason = 'shared-queue-full';
                            showDomainError(normalized);
                            break;
                        }
                        if (state.pendingCommands[0] === command) {
                            state.pendingCommands.shift();
                        }
                        if (shouldWarnCommandError(normalized)) {
                            global.console && global.console.warn('[LearningEvidenceActivity] buffered domain command rejected', error.code || error.message);
                        }
                    } finally {
                        if (generation === state.domainGeneration) state.domainInFlight = false;
                    }
                }
            } finally {
                if (generation === state.domainGeneration) {
                    state.draining = false;
                    state.domainInFlight = false;
                }
            }
        }

        function resetDomainCommands() {
            state.domainGeneration += 1;
            state.pendingCommands.length = 0;
            state.draining = false;
            state.domainInFlight = false;
            state.domainBlockReason = '';
            renderDomainStatus('', '');
        }

        function initialize() {
            if (state.authorityInvalidated) {
                const error = new Error(stateMessage('identity_required'));
                error.code = 'identity_required';
                showError(error);
                return Promise.resolve();
            }
            if (state.initializing) return state.initializing;
            const generation = ++state.initializeGeneration;
            state.initialized = false;
            state.initializationError = null;
            const operation = (async () => {
                setCommandAvailability(false);
                renderStatus('syncing', '正在确认活动发布范围与规则绑定。');
                try {
                    const context = await resolveContext();
                    if (generation !== state.initializeGeneration || abort.signal.aborted) return;
                    state.context = context;
                    state.ruleVersion = await resolveRule(context);
                    if (generation !== state.initializeGeneration || abort.signal.aborted) return;
                    let pendingStarted = false;
                    if (
                        !state.forceStartedOnInitialize
                        && !projectionHasStarted()
                        && options.reusePendingStarted === true
                        && typeof client().pendingFor === 'function'
                    ) {
                        const pending = await client().pendingFor(context);
                        if (generation !== state.initializeGeneration || abort.signal.aborted) return;
                        pendingStarted = pending.some(record => (
                            record && record.payload && record.payload.event_type === 'started'
                        ));
                    }
                    if (state.forceStartedOnInitialize || !projectionHasStarted() && !pendingStarted) {
                        const startedAt = earliestPendingOccurredAt(state.pendingCommands);
                        const started = await record('started', {
                            cursor: {
                                surface: mapping.galaxy_key,
                                stage: 'entered'
                            }
                        }, startedAt ? { occurred_at: startedAt } : undefined);
                        if (generation !== state.initializeGeneration || abort.signal.aborted) return;
                        if (
                            !started
                            || !['confirmed', 'reconciled', 'queued'].includes(started.outcome)
                        ) {
                            const error = new Error('Initial learning evidence event is not durable');
                            error.code = 'learning_evidence_failed';
                            throw error;
                        }
                    }
                    state.forceStartedOnInitialize = false;
                    state.initialized = true;
                    await drainDomainCommands();
                    await refreshStatus();
                    if (generation !== state.initializeGeneration || abort.signal.aborted) return;
                    setCommandAvailability(true);
                } catch (error) {
                    if (
                        generation === state.initializeGeneration
                        && !abort.signal.aborted
                        && !state.authorityInvalidated
                    ) {
                        state.initializationError = error;
                        showError(error && error.code === 'cancelled'
                            ? Object.assign(new Error(stateMessage('identity_required')), { code: 'identity_required' })
                            : error, { initializeRetry: error && error.code !== 'cancelled' && error.code !== 'identity_required' });
                    }
                }
            })();
            state.initializing = operation;
            operation.then(
                () => {
                    if (state.initializing === operation) state.initializing = null;
                },
                () => {
                    if (state.initializing === operation) state.initializing = null;
                }
            );
            return operation;
        }

        function controlValue(name) {
            const node = host.querySelector(`[data-evidence-value="${name}"]`);
            return node && node.value || '';
        }

        host.addEventListener('click', async event => {
            const button = event.target instanceof Element && event.target.closest('[data-evidence-command]');
            if (
                !button
                || button.disabled
                || !state.initialized
                || state.authorityInvalidated
                || state.commandInFlight
            ) return;
            const command = button.dataset.evidenceCommand;
            try {
                if (command === 'predicted') {
                    await record('predicted', {
                        prediction: { choice: controlValue('prediction') },
                        cursor: { stage: 'predicted' }
                    }, { trackStatus: true });
                } else if (command === 'explained') {
                    await record('explained', {
                        artifact: { kind: 'claim-evidence-link', value: controlValue('explanation') },
                        cursor: { stage: 'explained' }
                    }, { trackStatus: true });
                } else if (command === 'explained-text') {
                    const textarea = host.querySelector('[data-evidence-free-text]');
                    const value = String(textarea && textarea.value || '').trim();
                    if (!value) return;
                    await record('explained', {
                        artifact: { kind: 'free-text', text: value },
                        cursor: { stage: 'explained-online' }
                    }, { onlineOnly: true, trackStatus: true });
                    textarea.value = '';
                }
            } catch (error) {
                if (shouldWarnCommandError(error) && error.code !== 'online_required') {
                    global.console && global.console.warn('[LearningEvidenceActivity] command failed', error.code || error.message);
                }
            } finally {
                syncCommandButtons();
            }
        }, { signal: abort.signal });

        function acceptDomainCommand(detail, occurredAt) {
            if (!detail || detail.galaxy_key !== mapping.galaxy_key || detail.activity_key !== mapping.activity_key) return false;
            if (!['predicted', 'attempted', 'corrected'].includes(detail.event_type)) return false;
            if (state.authorityInvalidated) {
                const error = new Error(stateMessage('identity_required'));
                error.code = 'identity_required';
                showError(error);
                return false;
            }
            if (!state.initialized) {
                return bufferDomainCommand(detail.event_type, detail.evidence, occurredAt, detail);
            }
            if (
                detail.class_id
                && (
                    Number(detail.class_id) !== Number(state.context && state.context.class_id)
                    || Number(detail.course_id) !== Number(state.context && state.context.course_id)
                )
            ) return false;
            const accepted = bufferDomainCommand(detail.event_type, detail.evidence, occurredAt, detail);
            if (accepted) drainDomainCommands();
            return accepted;
        }

        const loader = global.AstraLearningEvidenceLoader;
        if (loader && typeof loader.claimDomainCommands === 'function') {
            state.releaseDomainCommands = loader.claimDomainCommands(mapping, acceptDomainCommand);
        } else {
            global.addEventListener('astra:learning-domain-command', event => {
                acceptDomainCommand(event && event.detail, new Date().toISOString());
            }, { signal: abort.signal });
        }
        global.addEventListener('online', () => {
            if (!state.initialized && !state.initializing && !abort.signal.aborted) initialize();
        }, { signal: abort.signal });

        state.unsubscribe = client().subscribe(change => {
            if (change && change.type === 'authority-cleared') {
                state.authorityInvalidated = true;
                invalidateActiveCommand();
                state.initializeGeneration += 1;
                state.initialized = false;
                state.context = null;
                state.ruleVersion = 0;
                state.initializationError = null;
                resetDomainCommands();
                clearProjection();
                cancelProjectionRecovery();
                setCommandAvailability(false);
                showError(Object.assign(new Error(stateMessage('identity_required')), { code: 'identity_required' }));
                return;
            }
            if (change && change.type === 'identity-configured') {
                invalidateActiveCommand();
                state.authorityInvalidated = false;
                state.forceStartedOnInitialize = true;
                state.initializeGeneration += 1;
                state.initialized = false;
                state.context = null;
                state.ruleVersion = 0;
                state.initializationError = null;
                resetDomainCommands();
                clearProjection();
                cancelProjectionRecovery();
                setCommandAvailability(false);
                const restart = () => {
                    if (!abort.signal.aborted && !state.authorityInvalidated) initialize();
                };
                if (state.initializing) state.initializing.then(restart, restart);
                else restart();
                return;
            }
            if (change && change.type === 'queue-capacity-released') {
                if (
                    state.domainBlockReason === 'shared-queue-full'
                    && state.initialized
                    && state.pendingCommands.length
                    && !state.authorityInvalidated
                    && !abort.signal.aborted
                ) {
                    state.domainBlockReason = '';
                    drainDomainCommands();
                }
                return;
            }
            const scope = change && (change.projection || change);
            if (
                !state.context || !scope
                || Number(scope.class_id) !== Number(state.context.class_id)
                || Number(scope.course_id) !== Number(state.context.course_id)
                || Number(scope.course_unit_id) !== Number(state.context.course_unit_id)
                || scope.activity_key !== state.context.activity_key
            ) return;
            const knownRecordChange = isKnownRecordOperation(change);
            const currentRecordChange = Boolean(
                knownRecordChange
                || matchesActiveCommand(change)
                || matchesRecentUntrackedCommand(change)
            );
            if (change.state && state.activeCommand && matchesActiveCommand(change)) {
                renderCommandResult(state.activeCommand, {
                    state: change.state
                });
            } else if (change.state && matchesRecentUntrackedCommand(change)) {
                renderUntrackedCommandResult(state.recentUntrackedCommand, {
                    state: change.state
                });
            }
            if (
                (change.state || change.type === 'confirmed')
                && matchesRecentDomainCommand(change)
            ) {
                renderDomainRecordResult(state.recentDomainCommand, {
                    state: change.state || 'confirmed'
                });
            }
            if (
                change.type === 'confirmed'
                && (!hasEventIdentity(change) || currentRecordChange)
            ) {
                scheduleProjectionRecovery(change);
                releaseRecordOperation(change);
            } else if (
                currentRecordChange
                && change.state
                && !['local-pending', 'syncing'].includes(change.state)
            ) {
                releaseRecordOperation(change);
            }
        });
        initialize();

        return Object.freeze({
            record,
            refresh: initialize,
            context: () => state.context,
            destroy() {
                abort.abort();
                cancelProjectionRecovery();
                state.initializeGeneration += 1;
                state.initialized = false;
                state.initializationError = null;
                state.authorityInvalidated = true;
                invalidateActiveCommand();
                resetDomainCommands();
                clearProjection();
                if (state.releaseDomainCommands) state.releaseDomainCommands();
                state.releaseDomainCommands = null;
                if (state.unsubscribe) state.unsubscribe();
                state.unsubscribe = null;
                if (host.isConnected) host.remove();
                mounted.delete(host);
            }
        });
    }

    function mount(options) {
        const settings = options || {};
        const parent = settings.host instanceof Element ? settings.host : null;
        if (!parent) return null;
        const mapping = catalog().resolve(settings.galaxy_key, settings.activity_key);
        if (!mapping || !mapping.representative) return null;
        const existing = parent.querySelector(':scope > [data-learning-evidence-activity]');
        if (existing) {
            const controller = mounted.get(existing);
            if (controller) return controller;
            existing.remove();
        }
        const host = document.createElement('section');
        host.className = 'astra-evidence-panel';
        host.dataset.learningEvidenceActivity = mapping.activity_key;
        if (settings.domainOnly === true) host.dataset.evidenceInteraction = 'domain-only';
        host.setAttribute('aria-label', `学习证据：${mapping.activity_key}`);
        host.innerHTML = panelMarkup(settings);
        parent.appendChild(host);
        const controller = createSession(host, settings, mapping);
        mounted.set(host, controller);
        return controller;
    }

    function destroyWithin(parent) {
        if (!(parent instanceof Element)) return;
        parent.querySelectorAll('[data-learning-evidence-activity]').forEach(host => {
            const controller = mounted.get(host);
            if (controller) controller.destroy();
            else host.remove();
        });
    }

    global.AstraLearningEvidenceActivity = Object.freeze({
        mount,
        destroyWithin
    });
})(window);
