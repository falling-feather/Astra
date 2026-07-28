(function (global) {
    'use strict';

    if (global.AstraLearningEvidenceActivity) return;

    const mounted = new WeakMap();

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
            evidence_memory_buffer_full: '活动初始化期间的操作暂存已满，请等待范围确认后再继续。'
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
        const steps = options.integrated ? `<div class="astra-evidence-panel__steps astra-evidence-panel__steps--integrated" data-evidence-controls hidden>
                <label><span>结构化解释</span><select data-evidence-value="explanation"><option value="claim-supported">证据支持判断</option><option value="claim-needs-review">判断仍需复核</option></select><button type="button" data-evidence-command="explained">记录解释</button></label>
            </div>` : `<div class="astra-evidence-panel__steps" data-evidence-controls hidden>
                <label><span>1 · 预测</span><select data-evidence-value="prediction"><option value="expect-change">预计会改变</option><option value="expect-stable">预计保持稳定</option></select><button type="button" data-evidence-command="predicted">记录预测</button></label>
                <div class="astra-evidence-panel__domain"><span>2–3 · 操作与修正</span><b>${escapeHtml(options.operationLabel || '请在上方真实活动中完成操作')}</b><small>实际控件会自动记录有界领域事件，不需要另点“记录操作”。</small></div>
                <label><span>4 · 结构化解释</span><select data-evidence-value="explanation"><option value="claim-supported">证据支持判断</option><option value="claim-needs-review">判断仍需复核</option></select><button type="button" data-evidence-command="explained">记录解释</button></label>
            </div>`;
        return `<div class="astra-evidence-panel__heading"><div><span>LEARNING EVIDENCE</span><h3>${escapeHtml(options.title || '学习证据')}</h3></div><small>完成与迁移仅显示服务端投影</small></div>
            <div data-evidence-scope></div>
            <div class="astra-evidence-status" data-evidence-status hidden></div>
            <p class="astra-evidence-panel__projection" data-evidence-projection hidden></p>
            ${steps}
            <details class="astra-evidence-panel__online">
                <summary>补充自由文本解释（仅联网）</summary>
                <label><span>解释不会进入离线队列</span><textarea maxlength="800" data-evidence-free-text></textarea></label>
                <button type="button" data-evidence-command="explained-text">联网提交解释</button>
            </details>`;
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
            recoveryTimer: 0,
            recoveryController: null,
            recoveryGeneration: 0,
            releaseDomainCommands: null,
            initializationError: null,
            authorityInvalidated: false
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
            message.textContent = stateMessage(normalized.code);
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
            const recovery = await client().recovery({
                class_id: context.class_id,
                course_id: context.course_id
            }, { signal: signal || abort.signal });
            if (abort.signal.aborted || context !== state.context) {
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
            return Object.assign({}, state.context, {
                rule_version: state.ruleVersion,
                event_type: eventType,
                evidence,
                occurred_at: occurredAt
            });
        }

        async function record(eventType, evidence, settings) {
            if (!state.context || !state.ruleVersion) {
                const error = new Error('Activity evidence context unavailable');
                error.code = 'publication_context_unavailable';
                throw error;
            }
            renderStatus('syncing');
            try {
                const result = await client().record(commandPayload(eventType, evidence, settings && settings.occurred_at), settings);
                if (result.outcome === 'cancelled') {
                    const error = new Error(stateMessage('identity_required'));
                    error.code = 'identity_required';
                    showError(error);
                    return result;
                }
                renderStatus(result.state || (result.outcome === 'confirmed' ? 'confirmed' : 'local-pending'));
                if (eventType === 'explained' && result.state === 'confirmed') {
                    cancelProjectionRecovery();
                    state.ruleVersion = await resolveRule(state.context);
                    renderStatus('confirmed', `证据已确认；服务端投影为${state.projection && state.projection.status ? `“${state.projection.status}”` : '当前规则状态'}。`);
                }
                return result;
            } catch (error) {
                showError(error && error.code === 'cancelled'
                    ? Object.assign(new Error(stateMessage('identity_required')), { code: 'identity_required' })
                    : error);
                throw error;
            }
        }

        async function refreshStatus() {
            if (!state.context) return;
            const current = await client().stateFor(state.context);
            if (current && current.state) renderStatus(current.state);
        }

        function cancelProjectionRecovery() {
            if (state.recoveryTimer) global.clearTimeout(state.recoveryTimer);
            state.recoveryTimer = 0;
            if (state.recoveryController) state.recoveryController.abort();
            state.recoveryController = null;
            state.recoveryGeneration += 1;
        }

        function scheduleProjectionRecovery() {
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
                    renderStatus('confirmed', `证据已确认；服务端投影为${state.projection && state.projection.status ? `“${state.projection.status}”` : '当前规则状态'}。`);
                } catch (error) {
                    const normalized = normalizeError(error);
                    if (!abort.signal.aborted && normalized.code !== 'cancelled') showError(normalized);
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
            if (state.pendingCommands.length >= 16) {
                const error = new Error(stateMessage('evidence_memory_buffer_full'));
                error.code = 'evidence_memory_buffer_full';
                showError(error);
                return false;
            }
            try {
                state.pendingCommands.push({
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
                } else {
                    renderStatus('syncing', '活动范围正在确认；首批真实操作已在当前页面内暂存。');
                }
                return true;
            } catch (error) {
                showError(error);
                return false;
            }
        }

        async function drainDomainCommands() {
            if (state.draining || !state.initialized) return;
            state.draining = true;
            try {
                while (state.pendingCommands.length && state.initialized && !abort.signal.aborted) {
                    const command = state.pendingCommands.shift();
                    if (
                        command.class_id
                        && (
                            command.class_id !== Number(state.context && state.context.class_id)
                            || command.course_id !== Number(state.context && state.context.course_id)
                        )
                    ) continue;
                    try {
                        await record(command.eventType, command.evidence, { occurred_at: command.occurred_at });
                    } catch (error) {
                        global.console && global.console.warn('[LearningEvidenceActivity] buffered domain command rejected', error.code || error.message);
                    }
                }
            } finally {
                state.draining = false;
            }
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
                host.querySelector('[data-evidence-controls]').hidden = true;
                renderStatus('syncing', '正在确认活动发布范围与规则绑定。');
                try {
                    const context = await resolveContext();
                    if (generation !== state.initializeGeneration || abort.signal.aborted) return;
                    state.context = context;
                    state.ruleVersion = await resolveRule(context);
                    if (generation !== state.initializeGeneration || abort.signal.aborted) return;
                    host.querySelector('[data-evidence-controls]').hidden = false;
                    const startedAt = earliestPendingOccurredAt(state.pendingCommands);
                    await record('started', {
                        cursor: {
                            surface: mapping.galaxy_key,
                            stage: 'entered'
                        }
                    }, startedAt ? { occurred_at: startedAt } : undefined);
                    state.initialized = true;
                    await drainDomainCommands();
                    await refreshStatus();
                } catch (error) {
                    if (!abort.signal.aborted) {
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
            if (!button || button.disabled) return;
            const command = button.dataset.evidenceCommand;
            button.disabled = true;
            try {
                if (command === 'predicted') {
                    await record('predicted', {
                        prediction: { choice: controlValue('prediction') },
                        cursor: { stage: 'predicted' }
                    });
                } else if (command === 'explained') {
                    await record('explained', {
                        artifact: { kind: 'claim-evidence-link', value: controlValue('explanation') },
                        cursor: { stage: 'explained' }
                    });
                } else if (command === 'explained-text') {
                    const textarea = host.querySelector('[data-evidence-free-text]');
                    const value = String(textarea && textarea.value || '').trim();
                    if (!value) return;
                    await record('explained', {
                        artifact: { kind: 'free-text', text: value },
                        cursor: { stage: 'explained-online' }
                    }, { onlineOnly: true });
                    textarea.value = '';
                }
            } catch (error) {
                if (error && error.code !== 'online_required') global.console && global.console.warn('[LearningEvidenceActivity] command failed', error.code || error.message);
            } finally {
                button.disabled = false;
            }
        }, { signal: abort.signal });

        function acceptDomainCommand(detail, occurredAt) {
            if (!detail || detail.galaxy_key !== mapping.galaxy_key || detail.activity_key !== mapping.activity_key) return;
            if (!['predicted', 'attempted', 'corrected'].includes(detail.event_type)) return;
            if (state.authorityInvalidated) {
                const error = new Error(stateMessage('identity_required'));
                error.code = 'identity_required';
                showError(error);
                return;
            }
            if (!state.initialized) {
                bufferDomainCommand(detail.event_type, detail.evidence, occurredAt, detail);
                return;
            }
            if (
                detail.class_id
                && (
                    Number(detail.class_id) !== Number(state.context && state.context.class_id)
                    || Number(detail.course_id) !== Number(state.context && state.context.course_id)
                )
            ) return;
            record(detail.event_type, detail.evidence, { occurred_at: occurredAt }).catch(error => {
                global.console && global.console.warn('[LearningEvidenceActivity] domain command rejected', error.code || error.message);
            });
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
                state.initializeGeneration += 1;
                state.initialized = false;
                state.context = null;
                state.ruleVersion = 0;
                state.initializationError = null;
                state.pendingCommands.length = 0;
                cancelProjectionRecovery();
                host.querySelector('[data-evidence-controls]').hidden = true;
                showError(Object.assign(new Error(stateMessage('identity_required')), { code: 'identity_required' }));
                return;
            }
            if (change && change.type === 'identity-configured') {
                state.authorityInvalidated = false;
                const restart = () => {
                    if (!abort.signal.aborted && !state.authorityInvalidated) initialize();
                };
                if (state.initializing) state.initializing.then(restart, restart);
                else restart();
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
            if (change.state) renderStatus(change.state);
            if (change.type === 'confirmed') scheduleProjectionRecovery();
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
                state.pendingCommands.length = 0;
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
