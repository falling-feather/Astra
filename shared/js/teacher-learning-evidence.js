(function (global) {
    'use strict';

    if (global.AstraTeacherLearningEvidence) return;

    const POLL_MS = 4000;
    let active = null;

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function normalizeList(payload) {
        return Array.isArray(payload) ? payload : payload && Array.isArray(payload.items) ? payload.items : [];
    }

    function scopeOf(root) {
        const classSelect = root.querySelector('[data-teacher-scope="classId"]');
        const courseSelect = root.querySelector('[data-teacher-scope="courseId"]');
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
            explicit_scope_required: '请先明确选择班级与课程；系统不会静默组合教学范围。',
            course_not_attached: '所选课程未挂接当前班级，请重新选择合法教学范围。',
            rule_binding_missing: '当前课程尚未绑定学习证据规则，权威汇总不显示零值。',
            rule_binding_invalid: '当前规则绑定无效，权威汇总已按失败关闭。',
            aggregate_schema_invalid: '服务端 aggregate 与当前作用域或冻结 schema 不一致，页面已拒绝渲染。',
            forbidden: '当前身份无权读取所选班级与课程的学习证据汇总。',
            identity_required: '当前会话已失效；请重新登录并确认身份后读取权威汇总。',
            offline: '离线时不展示缓存汇总；恢复网络后会在约 4 秒内发起新一轮读取，显示时延另含接口耗时。'
        };
        return messages[code] || '权威学习证据汇总暂不可用；旧访问记录不会替代该结果。';
    }

    function aggregateMarkup(aggregate) {
        const activities = aggregate && Array.isArray(aggregate.activities) ? aggregate.activities : [];
        const totals = activities.reduce((result, item) => {
            result.notStarted += Number(item.not_started || 0);
            result.inProgress += Number(item.in_progress || 0);
            result.completed += Number(item.completed || 0);
            result.transferred += Number(item.transferred || 0);
            return result;
        }, { notStarted: 0, inProgress: 0, completed: 0, transferred: 0 });
        const rows = activities.slice(0, 8).map(item => `
            <li>
                <code>${escapeHtml(item.activity_key)}</code>
                <span>未开始 ${Number(item.not_started || 0)}</span>
                <span>进行中 ${Number(item.in_progress || 0)}</span>
                <span>完成 ${Number(item.completed || 0)}</span>
                <span>迁移 ${Number(item.transferred || 0)}</span>
            </li>`).join('');
        return `
            <header class="astra-authority-summary__header">
                <div><span>0051 PROJECTION AGGREGATE</span><h3>权威学习证据汇总</h3></div>
                <small>规则版本 ${escapeHtml(aggregate.rule_version)} · ${escapeHtml(new Date(aggregate.generated_at).toLocaleTimeString('zh-CN'))}</small>
            </header>
            <div class="astra-authority-summary__metrics" aria-label="权威投影汇总">
                <div><strong>${Number(aggregate.active_students || 0)}</strong><span>活跃学习者</span></div>
                <div><strong>${totals.inProgress}</strong><span>进行中投影项</span></div>
                <div><strong>${totals.completed}</strong><span>完成投影项</span></div>
                <div><strong>${totals.transferred}</strong><span>迁移投影项</span></div>
            </div>
            ${rows ? `<ul class="astra-authority-summary__activities">${rows}</ul>` : '<p class="astra-authority-summary__note">当前规则尚无活动投影；不把历史浏览或兼容访问计为完成。</p>'}
            <p class="astra-authority-summary__note">投影项按活动累计，不代表去重学生数；仅展示服务端 aggregate。历史 <code>/progress</code> 与 knowledge 记录只保留兼容用途，不参与完成/掌握判断。</p>`;
    }

    function stateMarkup(mode, code) {
        const loading = mode === 'loading';
        return `
            <header class="astra-authority-summary__header">
                <div><span>0051 PROJECTION AGGREGATE</span><h3>权威学习证据汇总</h3></div>
            </header>
            <div class="astra-authority-summary__state" role="status">
                <strong>${escapeHtml(loading ? '正在读取' : code || 'partial')}</strong>
                <p>${escapeHtml(loading ? '正在按明确班级与课程读取服务端 aggregate。' : messageFor(code))}</p>
            </div>`;
    }

    function render(session) {
        if (!session || session !== active || !session.root) return;
        const nodes = session.root.querySelectorAll('[data-learning-evidence-teacher-aggregate]');
        const signature = `${session.scopeKey}:${session.phase}:${session.errorCode}:${session.aggregate && session.aggregate.generated_at || ''}`;
        nodes.forEach(node => {
            const ownedView = node.querySelector('[data-learning-evidence-owner-view]');
            if (
                node.dataset.authoritySignature === signature
                && ownedView
                && ownedView.dataset.learningEvidenceOwnerView === signature
            ) return;
            node.dataset.authoritySignature = signature;
            node.classList.add('astra-authority-summary');
            const markup = session.phase === 'ready'
                ? aggregateMarkup(session.aggregate)
                : stateMarkup(session.phase, session.errorCode);
            node.innerHTML = `<div data-learning-evidence-owner-view="${escapeHtml(signature)}">${markup}</div>`;
        });
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

    async function validateAttachedCourse(session, scope, signal) {
        const payload = await global.AstraApiClient.request('/api/courses', {
            params: { class_id: scope.class_id },
            signal
        });
        return normalizeList(payload).some(course => Number(course.id) === scope.course_id);
    }

    async function refresh(session) {
        if (!session || session !== active || session.destroyed || !session.authorityReady) return;
        const scope = scopeOf(session.root);
        const nextKey = scopeKey(scope);
        if (!scope.class_id || !scope.course_id) {
            clearRequest(session);
            session.scopeKey = nextKey;
            session.aggregate = null;
            session.phase = 'partial';
            session.errorCode = 'explicit_scope_required';
            render(session);
            return;
        }
        clearRequest(session);
        const controller = new AbortController();
        const generation = ++session.generation;
        session.controller = controller;
        session.scopeKey = nextKey;
        session.phase = session.aggregate && session.aggregate.class_id === scope.class_id && session.aggregate.course_id === scope.course_id
            ? 'ready'
            : 'loading';
        session.errorCode = '';
        render(session);
        try {
            const attached = await validateAttachedCourse(session, scope, controller.signal);
            if (!attached) {
                const error = new Error('course_not_attached');
                error.code = 'course_not_attached';
                throw error;
            }
            const aggregate = await global.AstraLearningEvidenceClient.teacherAggregate(scope, {
                signal: controller.signal
            });
            if (session !== active || generation !== session.generation || controller.signal.aborted) return;
            session.aggregate = aggregate;
            session.phase = 'ready';
            session.errorCode = '';
        } catch (rawError) {
            const error = normalizedError(rawError);
            if (session !== active || generation !== session.generation || controller.signal.aborted || error && error.code === 'cancelled') return;
            session.aggregate = null;
            session.phase = 'partial';
            session.errorCode = error && error.code || 'aggregate_unavailable';
        } finally {
            if (session === active && generation === session.generation && !session.destroyed) {
                session.controller = null;
                render(session);
                schedule(session, POLL_MS);
            }
        }
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
        clearRequest(session);
        if (session.timer) global.clearTimeout(session.timer);
        session.timer = 0;
        session.aggregate = null;
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
            aggregate: null,
            phase: 'partial',
            errorCode: 'explicit_scope_required',
            timer: 0,
            controller: null,
            generation: 0,
            authorityReady: true,
            observer: null,
            unsubscribe: null,
            onChange: null
        };
        active = session;
        session.onChange = event => {
            const target = event.target;
            if (target instanceof HTMLSelectElement && target.matches('[data-teacher-scope="classId"], [data-teacher-scope="courseId"]')) {
                schedule(session, 0);
            }
        };
        root.addEventListener('change', session.onChange);
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
            if (
                session.authorityReady
                && change && change.type === 'confirmed' && scope
                && Number(scope.class_id) === current.class_id
                && Number(scope.course_id) === current.course_id
            ) schedule(session, 0);
        });
        schedule(session, 0);
        return Object.freeze({ destroy });
    }

    function destroy() {
        const session = active;
        if (!session) return;
        active = null;
        session.destroyed = true;
        session.authorityReady = false;
        session.generation += 1;
        clearRequest(session);
        if (session.timer) global.clearTimeout(session.timer);
        if (session.observer) session.observer.disconnect();
        if (session.unsubscribe) session.unsubscribe();
        if (session.root && session.onChange) session.root.removeEventListener('change', session.onChange);
        session.timer = 0;
        session.root = null;
    }

    global.AstraTeacherLearningEvidence = Object.freeze({
        mount,
        destroy,
        pollMs: POLL_MS
    });
})(window);
