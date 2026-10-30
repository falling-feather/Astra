(function (global) {
    'use strict';

    if (global.AstraStudentLearningEvidence) return;

    let active = null;

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function scopeOf(root) {
        const classSelect = root.querySelector('[data-student-scope="classId"]');
        const courseSelect = root.querySelector('[data-student-scope="courseId"]');
        return {
            class_id: Number(classSelect && classSelect.value || 0),
            course_id: Number(courseSelect && courseSelect.value || 0)
        };
    }

    function scopeKey(scope) {
        return `${scope.class_id || ''}:${scope.course_id || ''}`;
    }

    function normalizedError(error) {
        const client = global.AstraLearningEvidenceClient;
        return client && typeof client.normalizeError === 'function' ? client.normalizeError(error) : error;
    }

    function messageFor(code) {
        const messages = {
            explicit_scope_required: '请先明确选择班级与课程；多作用域不会静默选择第一项。',
            rule_binding_missing: '当前课程尚未配置学习记录规则，因此不会用零完成率猜测你的进度。',
            rule_binding_invalid: '当前课程记录配置异常，页面已停止显示可能不准确的进度。',
            recovery_schema_invalid: '返回的课程记录与当前班课不一致，页面已停止显示旧数据。',
            forbidden: '当前身份无权读取所选学习范围。',
            identity_required: '当前会话已失效；请重新登录后读取学习进度。',
            offline: '离线时不会把历史浏览记录当作最新进度；请恢复网络后刷新。'
        };
        return messages[code] || '学习进度暂不可用；历史浏览记录不会被当作课程完成。';
    }

    function projectionSummary(recovery, pending, pendingError) {
        const activities = recovery && Array.isArray(recovery.activities) ? recovery.activities : [];
        const counts = activities.reduce((result, item) => {
            const status = ['not_started', 'in_progress', 'completed', 'transferred'].includes(item.status)
                ? item.status
                : 'not_started';
            result[status] += 1;
            return result;
        }, { not_started: 0, in_progress: 0, completed: 0, transferred: 0 });
        const pendingIssue = pendingError
            ? '<p class="astra-authority-summary__pending"><strong>同步状态待确认</strong> · 未同步记录数量当前未知；已保留上次计数，不会显示为已同步。</p><button type="button" class="astra-authority-summary__retry" data-student-evidence-retry>重新读取</button>'
            : '';
        return `
            ${pendingIssue}
            <div class="astra-authority-summary__metrics" aria-label="课程学习进度">
                <div><strong>${counts.not_started}</strong><span>未开始</span></div>
                <div><strong>${counts.in_progress}</strong><span>进行中</span></div>
                <div><strong>${counts.completed}</strong><span>已确认完成</span></div>
                <div><strong>${counts.transferred}</strong><span>记录已迁移</span></div>
            </div>
            ${Number(pending && pending.count || 0) > 0 ? `<p class="astra-authority-summary__pending">本账号有 ${Number(pending.count)} 条证据未同步；以上投影不提前计入本地待同步事件。</p>` : ''}
            <p class="astra-authority-summary__note">记录规则 ${escapeHtml(recovery.rule_version)}；完成状态只采用平台已确认的课程记录。</p>`;
    }

    function activityList(recovery) {
        const activities = recovery && Array.isArray(recovery.activities) ? recovery.activities : [];
        if (!activities.length) {
            return '<p class="astra-authority-summary__note">当前课程还没有学习活动记录；历史浏览不会被当作课程完成。</p>';
        }
        return `<ul class="astra-authority-summary__activities">${activities.slice(0, 8).map(item => `
            <li>
                <code>${escapeHtml(item.activity_key)}</code>
                <span>${escapeHtml({
                    not_started: '未开始',
                    in_progress: '进行中',
                    completed: '已完成',
                    transferred: '已迁移'
                }[item.status] || item.status)}</span>
                <span>尝试 ${Number(item.attempt_count || 0)}</span>
                <span>修正 ${Number(item.corrected_count || 0)}</span>
                <span>解释 ${Number(item.explained_count || 0)}</span>
            </li>`).join('')}</ul>`;
    }

    function evidenceTraceMarkup(recovery) {
        const activities = recovery && Array.isArray(recovery.activities) ? recovery.activities : [];
        if (!activities.length) {
            return '<div class="student-evidence-trace__empty"><strong>证据链尚未开始</strong><p>进入课程正式活动并完成一次可验证操作后，这里会形成“操作—规则—结果—来源”的时间链。</p></div>';
        }
        return `<section class="student-evidence-trace" aria-label="学习证据链"><header><div><span>EVIDENCE TRACE</span><strong>操作如何变成学习结果</strong></div><small>规则 v${escapeHtml(recovery.rule_version)} · 服务端投影</small></header><ol>${activities.slice().sort((left, right) => traceTime(left) - traceTime(right)).slice(-8).map((item, index) => studentTraceItemMarkup(item, recovery.rule_version, index)).join('')}</ol></section>`;
    }

    function studentTraceItemMarkup(item, ruleVersion, index) {
        const status = {
            not_started: '尚未形成结果',
            in_progress: '正在学习',
            completed: '已确认完成',
            transferred: '历史结果已迁移'
        }[item.status] || item.status;
        const operation = item.learner_event_count
            ? `${Number(item.attempt_count || 0)} 次尝试 · ${Number(item.corrected_count || 0)} 次修正 · ${Number(item.explained_count || 0)} 次解释`
            : '等待首次有效操作';
        const href = evidenceSourceHref(item);
        const source = href
            ? `<a href="${escapeHtml(href)}" data-student-evidence-source="${escapeHtml(item.activity_key)}"><code>${escapeHtml(item.activity_key)}</code><span>回到来源</span></a>`
            : `<code>${escapeHtml(item.activity_key)}</code><small>来源活动</small>`;
        const eventTime = item.completed_at || item.transferred_at || item.last_occurred_at || item.first_started_at;
        return `<li data-status="${escapeHtml(item.status)}"><i><b>${String(index + 1).padStart(2, '0')}</b></i><article><header><strong>${escapeHtml(status)}</strong><time>${escapeHtml(formatTraceDate(eventTime))}</time></header><div class="student-evidence-trace__route"><span><small>操作</small><b>${escapeHtml(operation)}</b></span><em>→</em><span><small>规则</small><b>课程规则 v${escapeHtml(ruleVersion)}</b></span><em>→</em><span><small>结果</small><b>${escapeHtml(status)}</b></span><em>→</em><span><small>来源</small>${source}</span></div><footer><span>${Number(item.learner_event_count || 0)} 条学生证据</span><span>${item.completed_at ? `完成于 ${escapeHtml(formatTraceDate(item.completed_at))}` : '尚未到达完成条件'}</span></footer></article></li>`;
    }

    function evidenceSourceHref(item) {
        const catalog = global.AstraLearningActivityCatalog;
        if (!catalog || typeof catalog.entries !== 'function' || typeof catalog.recoveryHref !== 'function') return '';
        const entry = catalog.entries().find(candidate => candidate.activity_key === item.activity_key);
        if (!entry) return '';
        const parts = String(item.activity_key || '').split('.');
        const contentSlug = parts.length === 2 ? `${parts[0]}/${parts[1]}` : '';
        return catalog.recoveryHref(entry, { activity_key: item.activity_key, content_slug: contentSlug });
    }

    function traceTime(item) {
        const value = item && (item.completed_at || item.transferred_at || item.last_occurred_at || item.first_started_at);
        const time = new Date(value || 0).getTime();
        return Number.isFinite(time) ? time : 0;
    }

    function formatTraceDate(value) {
        if (!value) return '等待事件';
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '时间待确认';
    }

    function header(title, eyebrow) {
        return `<header class="astra-authority-summary__header"><div><span>${escapeHtml(eyebrow)}</span><h3>${escapeHtml(title)}</h3></div></header>`;
    }

    function stateMarkup(title, eyebrow, phase, code) {
        const loading = phase === 'loading';
        return `${header(title, eyebrow)}<div class="astra-authority-summary__state" role="status"><strong>${escapeHtml(loading ? '正在读取' : code || '暂不可用')}</strong><p>${escapeHtml(loading ? '正在读取当前班课的学习进度。' : messageFor(code))}</p>${loading ? '' : '<button type="button" class="astra-authority-summary__retry" data-student-evidence-retry>重新读取</button>'}</div>`;
    }

    function render(session) {
        if (!session || session !== active || !session.root) return;
        const progress = session.root.querySelector('[data-student-panel="progress"]');
        const compatibility = session.root.querySelector('[data-student-panel="knowledge"]');
        const projectionSignature = session.recovery && Array.isArray(session.recovery.activities)
            ? session.recovery.activities.map(item => `${item.course_unit_id}:${item.activity_key}:${item.status}:${item.attempt_count}:${item.corrected_count}:${item.explained_count}:${item.last_occurred_at || ''}:${item.completed_at || ''}`).join('|')
            : '';
        const signature = `${session.scopeKey}:${session.phase}:${session.errorCode}:${session.pendingError}:${session.recovery && session.recovery.rule_version || ''}:${session.pending && session.pending.count || 0}:${projectionSignature}`;
        if (progress && progress.dataset.authoritySignature !== signature) {
            progress.dataset.authoritySignature = signature;
            progress.classList.add('astra-authority-summary');
            progress.innerHTML = session.phase === 'ready'
                ? `${header('学习进度', '进度同步')}${projectionSummary(session.recovery, session.pending, session.pendingError)}`
                : stateMarkup('学习进度', '进度同步', session.phase, session.errorCode);
        }
        if (compatibility && compatibility.dataset.authoritySignature !== signature) {
            compatibility.dataset.authoritySignature = signature;
            compatibility.classList.add('astra-authority-summary');
            compatibility.innerHTML = session.phase === 'ready'
                ? `${header('学习证据链', '学习活动记录')}${evidenceTraceMarkup(session.recovery)}<details class="student-evidence-trace__details"><summary>查看原始活动计数</summary>${activityList(session.recovery)}</details><p class="astra-authority-summary__note">历史兼容统计不会用于判断学习掌握情况；证据链只解释服务端投影，也不会把浏览页面本身当作完成。</p>`
                : stateMarkup('学习活动记录', '课程记录', session.phase, session.errorCode);
        }
    }

    function clearRequest(session) {
        if (session.controller) session.controller.abort();
        session.controller = null;
    }

    function schedule(session, delay) {
        if (session.timer) global.clearTimeout(session.timer);
        session.timer = 0;
        if (!session.authorityReady || session.destroyed || session !== active) return;
        session.timer = global.setTimeout(() => refresh(session), Math.max(0, Number(delay || 0)));
    }

    async function refresh(session) {
        if (!session || session !== active || session.destroyed || !session.authorityReady) return;
        const scope = scopeOf(session.root);
        const nextKey = scopeKey(scope);
        if (!scope.class_id || !scope.course_id) {
            clearRequest(session);
            session.scopeKey = nextKey;
            session.recovery = null;
            session.phase = 'partial';
            session.errorCode = 'explicit_scope_required';
            render(session);
            return;
        }
        clearRequest(session);
        const controller = new AbortController();
        const generation = ++session.generation;
        const pendingGeneration = ++session.pendingGeneration;
        session.controller = controller;
        session.scopeKey = nextKey;
        session.phase = 'loading';
        session.errorCode = '';
        render(session);
        try {
            const [recoveryResult, pendingResult] = await Promise.allSettled([
                global.AstraLearningEvidenceClient.recovery(scope, { signal: controller.signal }),
                global.AstraLearningEvidenceClient.pendingSummary()
            ]);
            if (session !== active || generation !== session.generation || controller.signal.aborted) return;
            if (pendingGeneration === session.pendingGeneration) {
                if (pendingResult.status === 'fulfilled') {
                    session.pending = pendingResult.value;
                    session.pendingError = '';
                } else {
                    session.pendingError = 'sync_state_unavailable';
                }
            }
            if (recoveryResult.status === 'fulfilled') {
                session.recovery = recoveryResult.value;
                session.phase = 'ready';
            } else {
                throw recoveryResult.reason;
            }
        } catch (rawError) {
            const error = normalizedError(rawError);
            if (session !== active || generation !== session.generation || controller.signal.aborted || error && error.code === 'cancelled') return;
            session.recovery = null;
            session.phase = 'partial';
            session.errorCode = error && error.code || 'recovery_unavailable';
        } finally {
            if (session === active && generation === session.generation && !session.destroyed) {
                session.controller = null;
                render(session);
            }
        }
    }

    async function refreshPendingOnly(session) {
        if (!session || session !== active || session.destroyed || !session.authorityReady) return false;
        const generation = ++session.pendingGeneration;
        try {
            const pending = await global.AstraLearningEvidenceClient.pendingSummary();
            if (session !== active || session.destroyed || !session.authorityReady || generation !== session.pendingGeneration) {
                return false;
            }
            session.pending = pending;
            session.pendingError = '';
        } catch (_) {
            if (session !== active || session.destroyed || !session.authorityReady || generation !== session.pendingGeneration) {
                return false;
            }
            session.pendingError = 'sync_state_unavailable';
        }
        render(session);
        return true;
    }

    function evaluate(session) {
        if (!session || session !== active || session.destroyed) return;
        const key = scopeKey(scopeOf(session.root));
        render(session);
        if (session.authorityReady && key !== session.scopeKey) schedule(session, 0);
    }

    function blockForAuthority(session) {
        if (!session || session !== active || session.destroyed) return;
        session.authorityReady = false;
        session.generation += 1;
        session.pendingGeneration += 1;
        clearRequest(session);
        if (session.timer) global.clearTimeout(session.timer);
        session.timer = 0;
        session.recovery = null;
        session.pending = null;
        session.pendingError = '';
        session.phase = 'blocked';
        session.errorCode = 'identity_required';
        render(session);
    }

    function restoreAuthority(session) {
        if (!session || session !== active || session.destroyed) return;
        session.authorityReady = true;
        session.generation += 1;
        schedule(session, 0);
    }

    function mount(root) {
        destroy();
        if (!(root instanceof Element)) return null;
        const session = {
            root,
            destroyed: false,
            scopeKey: '',
            recovery: null,
            pending: null,
            pendingError: '',
            pendingGeneration: 0,
            phase: 'partial',
            errorCode: 'explicit_scope_required',
            timer: 0,
            controller: null,
            generation: 0,
            authorityReady: true,
            observer: null,
            unsubscribe: null,
            onChange: null,
            onClick: null,
            onOnline: null
        };
        active = session;
        session.onChange = event => {
            const target = event.target;
            if (target instanceof HTMLSelectElement && target.matches('[data-student-scope="classId"], [data-student-scope="courseId"]')) {
                schedule(session, 0);
            }
        };
        root.addEventListener('change', session.onChange);
        session.onClick = event => {
            const retry = event.target && event.target.closest && event.target.closest('[data-student-evidence-retry]');
            if (retry && root.contains(retry)) schedule(session, 0);
        };
        session.onOnline = () => schedule(session, 0);
        root.addEventListener('click', session.onClick);
        global.addEventListener('online', session.onOnline);
        session.observer = new MutationObserver(() => evaluate(session));
        session.observer.observe(root, { childList: true, subtree: true });
        session.unsubscribe = global.AstraLearningEvidenceClient.subscribe(change => {
            if (change && change.type === 'authority-cleared') {
                blockForAuthority(session);
                return;
            }
            if (change && change.type === 'identity-configured') {
                restoreAuthority(session);
                return;
            }
            const scope = change && (change.projection || change);
            const current = scopeOf(root);
            const queueStateChange = Boolean(
                session.authorityReady
                && change
                && ['confirmed', 'local-pending', 'syncing', 'manual-intervention'].includes(change.type)
                && scope
            );
            if (!queueStateChange) return;
            if (
                Number(scope.class_id) === current.class_id
                && Number(scope.course_id) === current.course_id
            ) {
                schedule(session, change.type === 'confirmed' ? 120 : 0);
            } else {
                refreshPendingOnly(session);
            }
        });
        schedule(session, 0);
        return Object.freeze({ destroy });
    }

    function refreshActive() {
        if (!active || active.destroyed || !active.authorityReady) return false;
        schedule(active, 0);
        return true;
    }

    function destroy() {
        const session = active;
        if (!session) return;
        active = null;
        session.destroyed = true;
        session.authorityReady = false;
        session.generation += 1;
        session.pendingGeneration += 1;
        clearRequest(session);
        if (session.timer) global.clearTimeout(session.timer);
        if (session.observer) session.observer.disconnect();
        if (session.unsubscribe) session.unsubscribe();
        if (session.root && session.onChange) session.root.removeEventListener('change', session.onChange);
        if (session.root && session.onClick) session.root.removeEventListener('click', session.onClick);
        if (session.onOnline) global.removeEventListener('online', session.onOnline);
        session.timer = 0;
        session.root = null;
    }

    global.AstraStudentLearningEvidence = Object.freeze({ mount, refresh: refreshActive, destroy });
})(window);
