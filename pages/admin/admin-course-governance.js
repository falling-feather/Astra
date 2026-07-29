(function attachAdminCourseGovernance(global) {
    'use strict';

    if (global.AdminCourseGovernance) return;

    const TRANSITIONS = Object.freeze({
        draft: Object.freeze(['published', 'archived']),
        published: Object.freeze(['draft', 'archived']),
        archived: Object.freeze(['draft'])
    });
    const STATUS_LABELS = Object.freeze({
        draft: '草稿',
        published: '已发布',
        archived: '已归档'
    });
    const state = {
        host: null,
        context: null,
        controllers: null,
        mounted: false,
        loaded: false,
        loading: false,
        courses: [],
        query: '',
        status: '',
        selectedId: 0,
        editor: null,
        pending: null,
        confirmationExecutor: null,
        results: new Map(),
        locks: new Map(),
        triggerId: 0,
        clickHandler: null,
        inputHandler: null,
        changeHandler: null,
        cancelHandler: null,
        rafIds: new Set()
    };

    function allowedTransitions(status) {
        return (TRANSITIONS[String(status || '')] || []).slice();
    }

    function normalizeReason(value) {
        const reason = String(value == null ? '' : value).trim();
        if (!reason) throw new Error('治理原因不能为空');
        if (reason.length > 1000) throw new Error('治理原因不能超过 1000 个字符');
        return reason;
    }

    function buildMutation(course, targetStatus, reasonValue) {
        if (!course || !Number(course.id)) throw new Error('课程权威状态不可用');
        const expectedStatus = String(course.status || '');
        const target = String(targetStatus || '');
        if (!Object.prototype.hasOwnProperty.call(TRANSITIONS, expectedStatus)) {
            throw new Error('课程当前状态不受治理合同支持');
        }
        if (target === expectedStatus) throw new Error('课程状态没有变化');
        if (!allowedTransitions(expectedStatus).includes(target)) {
            throw new Error(`${expectedStatus} 不能直接转换为 ${target || '空状态'}`);
        }
        return Object.freeze({
            expected_status: expectedStatus,
            status: target,
            reason: normalizeReason(reasonValue)
        });
    }

    function impactMatches(impact) {
        return Boolean(
            impact
            && ['attached_class_count', 'course_unit_count', 'assignment_count'].every((key) => (
                Number.isInteger(impact[key]) && impact[key] >= 0
            ))
        );
    }

    function responseMatches(result, originalCourse, targetStatus) {
        return Boolean(
            result
            && result.course
            && originalCourse
            && Number(result.course.id) === Number(originalCourse.id)
            && Number(result.course.school_id) === Number(originalCourse.school_id)
            && String(result.course.status) === String(targetStatus)
            && impactMatches(result.impact)
        );
    }

    function pageItems(payload) {
        if (Array.isArray(payload)) return payload;
        return payload && Array.isArray(payload.items) ? payload.items : [];
    }

    function parseAuditSnapshot(value) {
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
        if (typeof value !== 'string' || !value.trim()) return null;
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
        } catch (error) {
            return null;
        }
    }

    function auditIdentityMatches(item, lock) {
        return Boolean(
            item
            && lock
            && String(item.action || '') === 'course.status.patch'
            && String(item.resource_type || '') === 'course'
            && Number(item.resource_id) === Number(lock.courseId)
            && String(item.request_id || '') === String(lock.requestId || '')
        );
    }

    function exactAuditEntry(payload, lock) {
        return pageItems(payload).find((item) => (
            auditIdentityMatches(item, lock)
            && String(item.event_result || '') === 'success'
            && String((parseAuditSnapshot(item.snapshot_json) || {}).after?.status || '') === String(lock.targetStatus)
        )) || null;
    }

    function auditEvidenceState(payload, lock) {
        const candidates = pageItems(payload).filter((item) => auditIdentityMatches(item, lock));
        if (!candidates.length) return 'absent';
        return exactAuditEntry(candidates, lock) ? 'exact' : 'mismatch';
    }

    function exactAuditPresent(payload, lock) {
        return auditEvidenceState(payload, lock) === 'exact';
    }

    function auditFact(item) {
        if (!item) return null;
        const snapshot = parseAuditSnapshot(item.snapshot_json) || {};
        return Object.freeze({
            action: String(item.action || ''),
            resourceType: String(item.resource_type || ''),
            resourceId: Number(item.resource_id),
            requestId: String(item.request_id || ''),
            eventResult: String(item.event_result || ''),
            afterStatus: String(snapshot.after?.status || ''),
            createdAt: String(item.created_at || '')
        });
    }

    function courseAuditParams(lock) {
        return {
            action: 'course.status.patch',
            resource_type: 'course',
            resource_id: Number(lock.courseId),
            request_id: String(lock.requestId || ''),
            limit: 25,
            offset: 0
        };
    }

    function trustedWriteCheckpoint(response, course, payload, requestId) {
        if (!responseMatches(response, course, payload && payload.status)) return null;
        return Object.freeze({
            writeConfirmed: true,
            authority: Object.freeze(Object.assign({}, response.course)),
            impact: Object.freeze(Object.assign({}, response.impact)),
            requestId: String(requestId || '')
        });
    }

    function transferMutationCheckpoint(operation, checkpoint) {
        if (!operation || !checkpoint || checkpoint.writeConfirmed !== true) return false;
        operation.checkpoint = checkpoint;
        return true;
    }

    function lockFromMutationOperation(operation, outcome) {
        if (!operation || !operation.course || !operation.payload) return null;
        const checkpoint = operation.checkpoint || {};
        return Object.assign({
            courseId: Number(operation.course.id),
            schoolId: Number(operation.course.school_id),
            expectedStatus: operation.payload.expected_status,
            targetStatus: operation.payload.status,
            reason: operation.payload.reason,
            requestId: String(operation.requestId || ''),
            outcome: outcome || 'unknown',
            authority: null
        }, checkpoint, {
            requestId: String(checkpoint.requestId || operation.requestId || ''),
            outcome: outcome || 'unknown'
        });
    }

    async function executeCourseWriteTransaction(course, payload, options) {
        const settings = options || {};
        const requestId = String(settings.requestId || '');
        const execute = typeof settings.request === 'function' ? settings.request : apiRequest;
        let response;
        try {
            response = await sendCourseStatusPatch(course, payload, requestId, settings.signal, execute);
        } catch (error) {
            if (typeof settings.isAmbiguous === 'function' && settings.isAmbiguous(error)) {
                return Object.freeze({ kind: 'ambiguous', requestId, error });
            }
            throw error;
        }
        const checkpoint = trustedWriteCheckpoint(response, course, payload, requestId);
        if (!checkpoint) {
            return Object.freeze({ kind: 'ambiguous', requestId, response });
        }
        if (typeof settings.onResponseVerified === 'function') settings.onResponseVerified(checkpoint);
        const lock = {
            courseId: Number(course.id),
            targetStatus: String(payload.status),
            requestId
        };
        let auditPayload;
        try {
            auditPayload = await execute('/api/admin/audit-logs', {
                params: courseAuditParams(lock),
                signal: settings.signal
            });
        } catch (error) {
            return Object.freeze({ kind: 'audit-read-failed', requestId, response, checkpoint, error });
        }
        const evidence = auditEvidenceState(auditPayload, lock);
        const kind = evidence === 'exact'
            ? 'verified'
            : evidence === 'absent' ? 'audit-missing' : 'audit-mismatch';
        return Object.freeze({
            kind,
            requestId,
            response,
            checkpoint,
            auditPayload,
            audit: exactAuditEntry(auditPayload, lock)
        });
    }

    function reconcileOutcome(authority, auditPayload, lock) {
        if (!authority || !lock) return 'mismatch';
        if (Number(authority.id) !== Number(lock.courseId)) return 'mismatch';
        if (lock.schoolId != null && Number(authority.school_id) !== Number(lock.schoolId)) return 'mismatch';
        const evidence = auditEvidenceState(auditPayload, lock);
        if (String(authority.status) === String(lock.targetStatus) && evidence === 'exact') return 'applied';
        if (!lock.writeConfirmed
            && String(authority.status) === String(lock.expectedStatus)
            && evidence === 'absent') return 'unchanged';
        return 'mismatch';
    }

    function classifyConflict(authority, expectedStatus, targetStatus) {
        if (!authority || !String(authority.status || '')) return 'read-failed';
        const currentStatus = String(authority.status);
        if (currentStatus === String(targetStatus)) return 'no-op';
        if (currentStatus !== String(expectedStatus)) return 'stale';
        if (!allowedTransitions(currentStatus).includes(String(targetStatus))) return 'invalid';
        return 'unresolved';
    }

    function conflictPresentation(outcome, authority, payload) {
        const expected = escapeHtml(statusLabel(payload && payload.expected_status));
        const target = escapeHtml(statusLabel(payload && payload.status));
        const actual = escapeHtml(statusLabel(authority && authority.status));
        const copies = {
            'no-op': { title: '状态冲突：目标已存在', messageHtml: `课程已处于「${target}」，没有产生写入，也不会新增审计记录。` },
            stale: { title: '状态冲突：前置状态已过期', messageHtml: `课程状态已从「${expected}」变为「${actual}」。本次请求未重发；请核对最新状态后重新选择。` },
            invalid: { title: '状态冲突：转换非法', messageHtml: `不能从「${actual}」直接切换为「${target}」。已归档课程必须先恢复为草稿并重新复核。` },
            'read-failed': { title: '冲突回读失败', messageHtml: '未读取到课程权威当前状态（actual），无法分类本次冲突。本次请求未重发；请人工刷新。' },
            unresolved: { title: '状态冲突：原因未决', messageHtml: `权威课程仍为「${actual || expected}」，无法解释本次 409。本次请求未重发；请人工刷新。` }
        };
        return copies[outcome] || copies['read-failed'];
    }

    function confirmationDecision(pending, course, payload) {
        const signature = JSON.stringify([
            Number(course && course.id),
            payload && payload.expected_status,
            payload && payload.status,
            payload && payload.reason
        ]);
        if (!pending || pending.signature !== signature) {
            return {
                send: false,
                pending: { signature, courseId: Number(course && course.id), payload }
            };
        }
        return { send: true, pending: null };
    }

    function sendCourseStatusPatch(course, payload, requestId, signal, request) {
        const execute = typeof request === 'function' ? request : apiRequest;
        return execute(`/api/courses/${Number(course.id)}/status`, {
            method: 'PATCH',
            headers: { 'X-Request-ID': requestId },
            body: payload,
            signal
        });
    }

    function createConfirmedMutationExecutor(execute, onChange, canSubmit) {
        let pending = null;
        let inFlight = null;
        const snapshot = () => Object.freeze({ pending, busy: Boolean(inFlight) });
        const emit = () => {
            if (typeof onChange === 'function') onChange(snapshot());
        };
        return Object.freeze({
            submit: async (course, payload) => {
                if (inFlight) return { kind: 'busy', sent: false, pending };
                if (typeof canSubmit === 'function' && !canSubmit()) {
                    return { kind: 'blocked', sent: false, pending };
                }
                const confirmation = confirmationDecision(pending, course, payload);
                pending = confirmation.pending;
                if (!confirmation.send) {
                    emit();
                    return { kind: 'confirmation', sent: false, pending };
                }
                pending = null;
                const promise = Promise.resolve().then(() => execute(course, payload));
                inFlight = promise;
                emit();
                try {
                    return { kind: 'sent', sent: true, pending: null, value: await promise };
                } finally {
                    if (inFlight === promise) inFlight = null;
                    emit();
                }
            },
            invalidate: () => {
                pending = null;
                emit();
            },
            snapshot
        });
    }

    function invalidateConfirmationContext(executor) {
        if (!executor || typeof executor.invalidate !== 'function') return false;
        executor.invalidate();
        return true;
    }

    function createControllerOwnership(ControllerType) {
        if (typeof ControllerType !== 'function') throw new TypeError('AbortController is required');
        const owners = { read: null, mutation: null, reconcile: null };
        const counters = { read: 0, mutation: 0, reconcile: 0 };

        function start(kind, metadata, replace) {
            const active = owners[kind];
            if (active && !active.signal.aborted) {
                if (!replace) return null;
                active.controller.abort();
            }
            const controller = new ControllerType();
            counters[kind] += 1;
            const owner = Object.assign({
                kind,
                generation: counters[kind],
                controller,
                signal: controller.signal
            }, metadata || {});
            owners[kind] = owner;
            return owner;
        }

        return Object.freeze({
            beginRead: (metadata) => start('read', metadata, true),
            beginMutation: (metadata) => start('mutation', metadata, false),
            beginReconcile: (metadata) => start('reconcile', metadata, true),
            current: (kind, owner) => Boolean(owner && owners[kind] === owner && !owner.signal.aborted),
            owner: (kind) => owners[kind],
            invalidate: (kind) => {
                const owner = owners[kind];
                if (owner && !owner.signal.aborted) owner.controller.abort();
                owners[kind] = null;
                counters[kind] += 1;
            },
            finish: (kind, owner) => {
                if (owners[kind] === owner) owners[kind] = null;
            },
            destroy: (onAmbiguousMutation) => {
                const mutation = owners.mutation;
                if (mutation && !mutation.signal.aborted && typeof onAmbiguousMutation === 'function') {
                    onAmbiguousMutation(mutation);
                }
                Object.keys(owners).forEach((kind) => {
                    const owner = owners[kind];
                    if (owner && !owner.signal.aborted) owner.controller.abort();
                    owners[kind] = null;
                });
            }
        });
    }

    function selectedCourse() {
        return state.courses.find((course) => Number(course.id) === Number(state.selectedId)) || null;
    }

    function createEditor(course) {
        const targets = allowedTransitions(course && course.status);
        return {
            targetStatus: targets[0] || '',
            reason: '',
            message: '',
            messageType: ''
        };
    }

    function selectionFromAuthority(courses, selectedId) {
        const authority = (courses || []).find((course) => Number(course.id) === Number(selectedId));
        return Object.freeze({
            selectedId: authority ? Number(authority.id) : 0,
            editor: authority ? createEditor(authority) : null
        });
    }

    function storeCourseResult(results, courseId, result) {
        results.set(Number(courseId), result);
        return result;
    }

    function resetCourseContext(context) {
        context.loaded = false;
        context.loading = false;
        context.courses = [];
        context.editor = null;
        context.results.clear();
        return context;
    }

    function createRequestId() {
        let token = '';
        try {
            token = global.crypto && typeof global.crypto.randomUUID === 'function'
                ? global.crypto.randomUUID()
                : '';
        } catch (error) {}
        if (!token) {
            token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
        }
        return `admin-course-${token}`.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 64);
    }

    function isCurrent(kind, operation) {
        return Boolean(
            state.mounted
            && state.controllers
            && state.controllers.current(kind, operation)
        );
    }

    function mutationOwner() {
        return state.controllers && state.controllers.owner('mutation');
    }

    function mutationBusy() {
        const owner = mutationOwner();
        return Boolean(owner && !owner.signal.aborted);
    }

    function courseWriteBlocked(snapshot) {
        const current = snapshot || {
            mutationCourseId: Number((mutationOwner() || {}).courseId || 0),
            lockCount: state.locks.size,
            lockedCourseIds: Array.from(state.locks.keys())
        };
        return Boolean(
            Number(current.mutationCourseId)
            || Number(current.lockCount)
            || (current.lockedCourseIds || []).length
        );
    }

    function guardedCourseSelection(currentId, requestedId, snapshot) {
        return courseWriteBlocked(snapshot) ? Number(currentId || 0) : Number(requestedId || 0);
    }

    function courseRowDisabled(courseId, selectedId, snapshot) {
        const current = snapshot || {
            mutationCourseId: Number((mutationOwner() || {}).courseId || 0),
            lockCount: state.locks.size,
            lockedCourseIds: Array.from(state.locks.keys())
        };
        if (!courseWriteBlocked(current)) return false;
        return Boolean(
            Number(current.mutationCourseId)
            || Number(courseId) !== Number(selectedId)
            || !(current.lockedCourseIds || []).some((id) => Number(id) === Number(courseId))
        );
    }

    function apiRequest(path, options) {
        const context = state.context || {};
        return global.AstraApiClient.request(path, Object.assign({}, options || {}, {
            baseUrl: typeof context.getApiBase === 'function' ? context.getApiBase() : ''
        }));
    }

    function notify(type, message) {
        if (state.context && typeof state.context.notify === 'function') {
            state.context.notify(type, message);
        }
    }

    function notifyWriteStateChange() {
        if (state.context && typeof state.context.onWriteStateChange === 'function') {
            state.context.onWriteStateChange();
        }
    }

    function refreshIcons() {
        if (state.context && typeof state.context.refreshIcons === 'function') {
            state.context.refreshIcons();
        }
    }

    function schedule(callback) {
        const id = global.requestAnimationFrame(() => {
            state.rafIds.delete(id);
            if (state.mounted) callback();
        });
        state.rafIds.add(id);
        return id;
    }

    function cancelScheduled() {
        state.rafIds.forEach((id) => global.cancelAnimationFrame(id));
        state.rafIds.clear();
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function statusLabel(status) {
        return STATUS_LABELS[String(status || '')] || String(status || '--');
    }

    function statusClass(status) {
        if (status === 'published') return 'good';
        if (status === 'draft') return 'warn';
        if (status === 'archived') return 'readonly';
        return 'neutral';
    }

    function filteredCourses() {
        const query = state.query.trim().toLowerCase();
        return state.courses.filter((course) => {
            if (state.locks.has(Number(course.id)) && Number(course.id) === Number(state.selectedId)) return true;
            if (state.status && String(course.status) !== state.status) return false;
            if (!query) return true;
            return [
                course.id,
                course.title,
                course.course_key,
                course.galaxy_key,
                course.school_id
            ].some((value) => String(value == null ? '' : value).toLowerCase().includes(query));
        });
    }

    function renderStatusSummary() {
        const counts = { draft: 0, published: 0, archived: 0 };
        state.courses.forEach((course) => {
            if (Object.prototype.hasOwnProperty.call(counts, course.status)) counts[course.status] += 1;
        });
        return Object.entries(counts).map(([status, count]) => `
            <article>
                <span>${escapeHtml(statusLabel(status))}</span>
                <strong>${Number(count).toLocaleString('zh-CN')}</strong>
            </article>
        `).join('');
    }

    function renderCourseList() {
        if (state.loading) {
            return '<div class="admin-loading" role="status"><i data-lucide="loader-circle"></i><span>正在读取课程权威状态</span></div>';
        }
        const courses = filteredCourses();
        if (!courses.length) {
            return '<div class="admin-empty"><i data-lucide="search-x"></i><span>当前筛选下没有课程；不会编造演示样例。</span></div>';
        }
        return `<div class="admin-course-list" role="list" aria-label="课程治理列表">
            ${courses.map((course) => {
                const selected = Number(course.id) === Number(state.selectedId);
                const locked = state.locks.has(Number(course.id));
                const disabled = courseRowDisabled(course.id, state.selectedId);
                return `
                    <button type="button" role="listitem" class="admin-course-row${selected ? ' is-selected' : ''}" data-admin-course-select="${Number(course.id)}" aria-pressed="${selected ? 'true' : 'false'}"${disabled ? ' disabled' : ''}>
                        <span>
                            <strong>${escapeHtml(course.title || `课程 #${course.id}`)}</strong>
                            <small>${escapeHtml(course.galaxy_key || '--')} / ${escapeHtml(course.course_key || '--')}</small>
                        </span>
                        <span class="admin-status-pill admin-status-pill--${statusClass(course.status)}">${escapeHtml(statusLabel(course.status))}</span>
                        ${locked ? '<i data-lucide="lock-keyhole" aria-label="写入已锁定"></i>' : '<i data-lucide="chevron-right" aria-hidden="true"></i>'}
                    </button>
                `;
            }).join('')}
        </div>`;
    }

    function renderImpact(impact) {
        if (!impactMatches(impact)) return '';
        return `
            <dl class="admin-course-impact" data-admin-course-impact>
                <div><dt>挂接班级</dt><dd>${impact.attached_class_count}</dd></div>
                <div><dt>课程单元</dt><dd>${impact.course_unit_count}</dd></div>
                <div><dt>关联作业</dt><dd>${impact.assignment_count}</dd></div>
            </dl>
            <p class="admin-course-impact__note">以上是结构影响计数，不表示“受影响学生人数”。</p>
        `;
    }

    function renderAuditFact(audit) {
        if (!audit) return '';
        return `
            <dl class="admin-course-audit-fact" data-admin-course-audit-fact>
                <div><dt>Action</dt><dd>${escapeHtml(audit.action)}</dd></div>
                <div><dt>Resource</dt><dd>${escapeHtml(audit.resourceType)} #${escapeHtml(audit.resourceId)}</dd></div>
                <div><dt>Event result</dt><dd>${escapeHtml(audit.eventResult)}</dd></div>
                <div><dt>After status</dt><dd>${escapeHtml(statusLabel(audit.afterStatus))}</dd></div>
                <div><dt>Request ID</dt><dd><code>${escapeHtml(audit.requestId)}</code></dd></div>
                <div><dt>Created at</dt><dd>${escapeHtml(audit.createdAt || '--')}</dd></div>
            </dl>
        `;
    }

    function renderLock(lock) {
        if (!lock) return '';
        const canUnlock = lock.outcome === 'unchanged' && !lock.writeConfirmed;
        const outcomeCopy = lock.outcome === 'applied'
            ? '已由课程权威状态和精确审计共同确认。'
            : lock.outcome === 'unchanged'
                ? '课程仍为写入前状态，且精确 Request ID 下没有审计；可人工确认后解锁。'
                : lock.outcome === 'mismatch'
                    ? '课程状态或审计与本次请求不一致，必须保持锁定。'
                    : lock.outcome === 'read-failed'
                        ? '权威回读未完成，必须保持锁定。'
                        : '写入结果未知，系统不会自动重发。';
        return `
            <section class="admin-course-lock" data-admin-course-lock="${escapeHtml(lock.outcome || 'unknown')}" tabindex="-1">
                <h3><i data-lucide="lock-keyhole"></i>课程写入已锁定</h3>
                <p>${escapeHtml(outcomeCopy)}</p>
                <code>Request ID: ${escapeHtml(lock.requestId || '--')}</code>
                <div>
                    <button type="button" class="admin-icon-button" data-admin-course-reconcile>
                        <i data-lucide="scan-search"></i><span>重新权威对账</span>
                    </button>
                    ${canUnlock ? `
                        <button type="button" class="admin-icon-button admin-icon-button--restore" data-admin-course-unlock>
                            <i data-lucide="unlock-keyhole"></i><span>确认未生效并解锁</span>
                        </button>
                    ` : ''}
                </div>
            </section>
        `;
    }

    function renderInspectorContent(course, options) {
        if (!course) {
            return `
                <div class="admin-course-inspector__empty">
                    <i data-lucide="mouse-pointer-click"></i>
                    <strong>选择一门课程</strong>
                    <p>检查当前状态、合法转换与结构影响后再进入双确认。</p>
                </div>
            `;
        }
        if (!state.editor) state.editor = createEditor(course);
        const lock = state.locks.get(Number(course.id));
        const result = state.results.get(Number(course.id));
        const busy = mutationBusy();
        const targets = allowedTransitions(course.status);
        const pending = state.pending && Number(state.pending.courseId) === Number(course.id)
            ? state.pending
            : null;
        const dialogHeader = options && options.dialog ? `
            <header class="admin-course-inspector__dialog-header">
                <span>课程治理</span>
                <button type="button" class="admin-icon-button admin-icon-button--compact" data-admin-course-close aria-label="关闭课程治理">
                    <i data-lucide="x"></i>
                </button>
            </header>
        ` : '';
        return `
            ${dialogHeader}
            <div class="admin-course-inspector__heading" tabindex="-1" data-admin-course-title>
                <span>COURSE #${Number(course.id)}</span>
                <h3>${escapeHtml(course.title || `课程 #${course.id}`)}</h3>
                <p>${escapeHtml(course.galaxy_key || '--')} / ${escapeHtml(course.course_key || '--')} · 学校 #${escapeHtml(course.school_id || '--')}</p>
            </div>
            <dl class="admin-course-authority">
                <div><dt>当前状态</dt><dd><span class="admin-status-pill admin-status-pill--${statusClass(course.status)}">${escapeHtml(statusLabel(course.status))}</span></dd></div>
                <div><dt>创建者</dt><dd>#${escapeHtml(course.creator_user_id || '--')}</dd></div>
            </dl>
            ${lock ? renderLock(lock) : `
                <form class="admin-course-form" data-admin-course-form>
                    <label>
                        <span>目标状态</span>
                        <select name="status" data-admin-course-target${busy ? ' disabled' : ''}>
                            ${targets.map((target) => `<option value="${target}"${state.editor.targetStatus === target ? ' selected' : ''}>${escapeHtml(statusLabel(target))}</option>`).join('')}
                        </select>
                    </label>
                    <label>
                        <span>治理原因 <b>必填，最多 1000 字</b></span>
                        <textarea name="reason" maxlength="1000" rows="4" data-admin-course-reason${busy ? ' disabled' : ''}>${escapeHtml(state.editor.reason)}</textarea>
                    </label>
                    ${pending ? `
                        <section class="admin-course-preview" data-admin-course-preview>
                            <h4><i data-lucide="shield-alert"></i>影响确认</h4>
                            <p>${escapeHtml(statusLabel(pending.payload.expected_status))} → ${escapeHtml(statusLabel(pending.payload.status))}</p>
                            <p>原因：${escapeHtml(pending.payload.reason)}</p>
                            <small>再次点击同一按钮才会发送一条 PATCH；修改任一输入都会使本次确认失效。</small>
                        </section>
                    ` : ''}
                    ${state.editor.message ? `<div class="admin-course-message admin-course-message--${escapeHtml(state.editor.messageType || 'warning')}" role="status" data-admin-course-status tabindex="-1">${escapeHtml(state.editor.message)}</div>` : ''}
                    <button type="submit" class="admin-icon-button${pending ? ' admin-icon-button--confirming' : ''}" data-admin-course-confirm${busy || !targets.length ? ' disabled' : ''}>
                        <i data-lucide="${pending ? 'shield-check' : 'scan-eye'}"></i>
                        <span>${pending ? '再次确认并执行' : '预览状态变更'}</span>
                    </button>
                </form>
            `}
            ${result ? `
                <section class="admin-course-result admin-course-result--${escapeHtml(result.type || 'info')}" data-admin-course-result tabindex="-1">
                    <h4>${escapeHtml(result.title || '治理结果')}</h4>
                    <p>${result.messageHtml || escapeHtml(result.message || '')}</p>
                    ${result.requestId ? `<code>Request ID: ${escapeHtml(result.requestId)}</code>` : ''}
                    ${renderImpact(result.impact)}
                    ${renderAuditFact(result.audit)}
                </section>
            ` : ''}
        `;
    }

    function render() {
        if (!state.host) return;
        const selected = selectedCourse();
        const compactDialogWasOpen = Boolean(
            state.host.querySelector('[data-admin-course-dialog][open]')
        );
        state.host.innerHTML = `
            <section class="admin-course-workbench" data-admin-course-workbench>
                <header class="admin-panel__header admin-course-header">
                    <div>
                        <h2><i data-lucide="book-open-check"></i>课程状态治理</h2>
                        <p>固定转换矩阵、单次 CAS 与 Request ID 对账；不提供通用课程修改或删除。</p>
                    </div>
                    <button type="button" class="admin-icon-button admin-icon-button--compact" data-admin-course-refresh aria-label="刷新课程列表"${mutationBusy() ? ' disabled' : ''}>
                        <i data-lucide="refresh-cw"></i>
                    </button>
                </header>
                <div class="admin-course-status-summary" aria-label="课程状态统计">${renderStatusSummary()}</div>
                <div class="admin-course-grid">
                    <section class="admin-course-browser">
                        <form class="admin-course-filters" data-admin-course-filters>
                            <label><span>搜索</span><input type="search" name="q" value="${escapeHtml(state.query)}" placeholder="标题、Course Key、ID" autocomplete="off"></label>
                            <label><span>状态</span><select name="status">
                                <option value="">全部状态</option>
                                ${Object.keys(TRANSITIONS).map((status) => `<option value="${status}"${state.status === status ? ' selected' : ''}>${escapeHtml(statusLabel(status))}</option>`).join('')}
                            </select></label>
                        </form>
                        ${renderCourseList()}
                    </section>
                    <aside class="admin-course-inspector" data-admin-course-inspector aria-label="课程治理检查器">
                        ${renderInspectorContent(selected)}
                    </aside>
                </div>
                <dialog class="admin-course-dialog" data-admin-course-dialog aria-label="课程治理检查器">
                    ${renderInspectorContent(selected, { dialog: true })}
                </dialog>
            </section>
        `;
        if (compactDialogWasOpen && selected && isCompact()) openCompactDialog(false);
        refreshIcons();
    }

    function isCompact() {
        return Boolean(global.matchMedia && global.matchMedia('(max-width: 820px)').matches);
    }

    function focusSelectedTrigger() {
        if (!state.host || !state.triggerId) return;
        const trigger = state.host.querySelector(`[data-admin-course-select="${state.triggerId}"]`);
        if (trigger) schedule(() => {
            try { trigger.focus({ preventScroll: true }); } catch (error) { trigger.focus(); }
        });
    }

    function openCompactDialog(focusTitle) {
        if (!state.host || !selectedCourse()) return;
        const dialog = state.host.querySelector('[data-admin-course-dialog]');
        if (!dialog || dialog.open) return;
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
        if (focusTitle !== false) schedule(() => {
            const target = dialog.querySelector('[data-admin-course-title]');
            if (target) target.focus();
        });
    }

    function closeCompactDialog() {
        const dialog = state.host && state.host.querySelector('[data-admin-course-dialog]');
        if (dialog && dialog.open) dialog.close();
        else if (dialog) dialog.removeAttribute('open');
        focusSelectedTrigger();
    }

    function selectCourse(courseId) {
        if (guardedCourseSelection(state.selectedId, courseId) !== Number(courseId)) return false;
        const course = state.courses.find((item) => Number(item.id) === Number(courseId));
        if (!course) return false;
        state.selectedId = Number(course.id);
        state.triggerId = Number(course.id);
        state.editor = createEditor(course);
        clearPending();
        render();
        if (isCompact()) openCompactDialog();
        return true;
    }

    function clearPending() {
        state.pending = null;
        invalidateConfirmationContext(state.confirmationExecutor);
    }

    function invalidatePending(message) {
        if (!state.pending) return;
        clearPending();
        if (state.editor) {
            state.editor.message = message || '输入已变化，上一次确认已失效；请重新预览。';
            state.editor.messageType = 'warning';
        }
    }

    async function submitCourse(event) {
        event.preventDefault();
        const course = selectedCourse();
        if (!course || !state.editor || courseWriteBlocked()) return;
        let payload;
        try {
            payload = buildMutation(course, state.editor.targetStatus, state.editor.reason);
        } catch (error) {
            state.editor.message = error.message;
            state.editor.messageType = 'error';
            render();
            if (isCompact()) openCompactDialog();
            return;
        }
        if (!state.confirmationExecutor) return;
        const outcome = await state.confirmationExecutor.submit(course, payload);
        if (outcome.kind === 'confirmation' && state.mounted && state.editor) {
            state.editor.message = '已生成影响预览；尚未发送任何写入。';
            state.editor.messageType = 'warning';
            render();
            if (isCompact()) openCompactDialog(false);
        }
    }

    function updateCourse(authority) {
        const index = state.courses.findIndex((course) => Number(course.id) === Number(authority && authority.id));
        if (index >= 0) state.courses[index] = Object.assign({}, state.courses[index], authority);
    }

    function mutationLock(course, payload, requestId, outcome, checkpoint) {
        const lock = lockFromMutationOperation({ course, payload, requestId, checkpoint }, outcome);
        if (!lock) return null;
        state.locks.set(lock.courseId, lock);
        state.selectedId = lock.courseId;
        state.triggerId = lock.courseId;
        clearPending();
        notifyWriteStateChange();
        return lock;
    }

    async function commitCourse(course, payload) {
        const requestId = createRequestId();
        const operation = state.controllers && state.controllers.beginMutation({
            courseId: Number(course.id),
            course: Object.assign({}, course),
            payload,
            requestId,
            sent: false,
            checkpoint: null
        });
        if (!operation) return false;
        notifyWriteStateChange();
        if (Number(state.selectedId) === Number(course.id) && state.editor) {
            state.editor.message = '正在提交一条课程状态 PATCH，并等待结构化回执。';
            state.editor.messageType = 'warning';
        }
        render();
        if (isCompact()) openCompactDialog(false);
        try {
            operation.sent = true;
            const transaction = await executeCourseWriteTransaction(course, payload, {
                requestId,
                signal: operation.signal,
                request: apiRequest,
                onResponseVerified: (checkpoint) => transferMutationCheckpoint(operation, checkpoint),
                isAmbiguous: (error) => Boolean(
                    error && (error.confirmed || global.AstraApiClient.isAmbiguousMutation(error))
                )
            });
            if (!isCurrent('mutation', operation)) return false;
            if (transaction.kind === 'ambiguous') {
                const lock = mutationLock(course, payload, requestId, 'unknown');
                state.results.set(Number(course.id), {
                    type: 'warning',
                    title: transaction.response ? '2xx 回执结构不可信' : '写入结果未知',
                    message: transaction.response
                        ? '服务器返回 2xx，但课程 ID、学校 ID、目标状态或 impact 不满足冻结结构；写入已锁定并开始权威对账。'
                        : '系统不会自动重发；正在按课程 ID 与精确 Request ID 回读。',
                    requestId
                });
                await reconcile(lock);
                return false;
            }
            const result = transaction.response;
            updateCourse(result.course);
            if (Number(state.selectedId) === Number(course.id)) {
                state.editor = createEditor(result.course);
            }
            if (transaction.kind !== 'verified') {
                const outcome = transaction.kind === 'audit-read-failed' ? 'read-failed' : 'mismatch';
                const lock = mutationLock(course, payload, requestId, outcome, transaction.checkpoint);
                state.results.set(Number(course.id), {
                    type: 'warning',
                    title: '课程已写入，精确审计未确认',
                    message: transaction.kind === 'audit-read-failed'
                        ? '2xx 权威回执已确认写入，但精确审计读取失败；课程保持写锁，仅可只读对账。'
                        : '2xx 权威回执已确认写入，但本次 Request ID 的精确成功审计缺失或不匹配；课程保持写锁，仅可只读对账。',
                    requestId
                });
                return false;
            }
            storeCourseResult(state.results, course.id, {
                type: 'success',
                title: '课程状态与精确审计已确认',
                message: `${statusLabel(payload.expected_status)} → ${statusLabel(payload.status)} 已由结构化回执与精确审计共同确认。`,
                requestId,
                impact: result.impact,
                audit: auditFact(transaction.audit)
            });
            notify('success', `课程 #${Number(course.id)} 已更新；Request ID ${requestId}`);
            if (state.context && typeof state.context.onMutation === 'function') {
                await state.context.onMutation({
                    course: result.course,
                    impact: result.impact,
                    requestId
                });
            }
            return true;
        } catch (error) {
            if (!isCurrent('mutation', operation)) return false;
            if (error && error.status === 409) {
                state.results.set(Number(course.id), {
                    type: 'warning',
                    title: '状态冲突',
                    message: `${global.AstraApiClient.message(error)}；正在权威回读并分类，不会自动重发。`,
                    requestId: error.requestId || requestId
                });
                await refreshAuthorityAfterConflict(course, payload);
            } else if (!global.AstraApiClient.isCancelled(error)) {
                state.results.set(Number(course.id), {
                    type: 'error',
                    title: '课程治理未执行',
                    message: global.AstraApiClient.message(error),
                    requestId: error && error.requestId || requestId
                });
            } else if (operation.sent) {
                mutationLock(course, payload, error && error.requestId || requestId, 'unknown', operation.checkpoint);
            }
            return false;
        } finally {
            if (state.controllers) state.controllers.finish('mutation', operation);
            notifyWriteStateChange();
            if (state.mounted) {
                render();
                if (isCompact()) openCompactDialog(false);
            }
        }
    }

    async function refreshAuthorityAfterConflict(course, payload) {
        const courseId = Number(course.id);
        const operation = state.controllers && state.controllers.beginReconcile({
            courseId,
            purpose: 'conflict'
        });
        if (!operation) return 'read-failed';
        try {
            const coursesPayload = await apiRequest('/api/courses', { signal: operation.signal });
            if (!isCurrent('reconcile', operation)) return 'read-failed';
            const authority = pageItems(coursesPayload).find((item) => Number(item.id) === courseId);
            const outcome = classifyConflict(authority, course.status, payload.status);
            if (authority) {
                updateCourse(authority);
                if (Number(state.selectedId) === courseId) state.editor = createEditor(authority);
            }
            const copy = conflictPresentation(outcome, authority, payload);
            state.results.set(courseId, {
                type: 'warning',
                title: copy.title,
                messageHtml: copy.messageHtml,
                requestId: (state.results.get(courseId) || {}).requestId
            });
            return outcome;
        } catch (error) {
            if (!global.AstraApiClient.isCancelled(error)) {
                const result = state.results.get(Number(courseId)) || {};
                Object.assign(result, conflictPresentation('read-failed', null, payload));
                state.results.set(Number(courseId), result);
            }
            return 'read-failed';
        } finally {
            if (state.controllers) state.controllers.finish('reconcile', operation);
        }
    }

    async function reconcile(lock) {
        if (!lock) return false;
        const operation = state.controllers && state.controllers.beginReconcile({
            courseId: lock.courseId,
            purpose: 'unknown'
        });
        if (!operation) return false;
        lock.outcome = 'unknown';
        try {
            const [coursesPayload, auditPayload] = await Promise.all([
                apiRequest('/api/courses', { signal: operation.signal }),
                apiRequest('/api/admin/audit-logs', {
                    params: courseAuditParams(lock),
                    signal: operation.signal
                })
            ]);
            if (!isCurrent('reconcile', operation)) return false;
            const authority = pageItems(coursesPayload).find((course) => Number(course.id) === Number(lock.courseId));
            lock.authority = authority || null;
            lock.outcome = reconcileOutcome(authority, auditPayload, lock);
            if (authority) updateCourse(authority);
            if (lock.outcome === 'applied') {
                state.locks.delete(lock.courseId);
                notifyWriteStateChange();
                if (authority && Number(state.selectedId) === Number(lock.courseId)) {
                    state.editor = createEditor(authority);
                }
                state.results.set(lock.courseId, {
                    type: 'success',
                    title: lock.writeConfirmed ? '课程状态与精确审计已确认' : '未知结果已权威确认',
                    message: '课程目标状态与精确 Request ID 审计同时存在；没有重发 PATCH。',
                    requestId: lock.requestId,
                    impact: lock.impact,
                    audit: auditFact(exactAuditEntry(auditPayload, lock))
                });
                notify('success', `课程 #${lock.courseId} 已由权威状态与精确审计确认生效。`);
                if (state.context && typeof state.context.onMutation === 'function') {
                    await state.context.onMutation({ course: authority, requestId: lock.requestId, reconciled: true });
                }
            } else if (lock.outcome === 'unchanged') {
                state.results.set(lock.courseId, {
                    type: 'warning',
                    title: '未知结果尚未生效',
                    message: '权威课程仍为原状态且精确审计为空；必须人工确认后才能解锁。',
                    requestId: lock.requestId
                });
            } else {
                state.results.set(lock.courseId, {
                    type: 'warning',
                    title: '权威证据不一致',
                    message: '课程状态与精确审计无法共同证明本次结果，写锁保持。',
                    requestId: lock.requestId
                });
            }
            if (state.mounted) {
                render();
                if (isCompact()) openCompactDialog(false);
            }
            return lock.outcome === 'applied';
        } catch (error) {
            if (!global.AstraApiClient.isCancelled(error)) {
                lock.outcome = 'read-failed';
                state.results.set(lock.courseId, {
                    type: 'warning',
                    title: '权威回读失败',
                    message: '课程或精确审计读取失败；写锁保持，系统不会自动重发。',
                    requestId: lock.requestId
                });
                if (isCurrent('reconcile', operation)) {
                    render();
                    if (isCompact()) openCompactDialog(false);
                }
            }
            return false;
        } finally {
            if (state.controllers) state.controllers.finish('reconcile', operation);
        }
    }

    function unlockUnchanged() {
        const course = selectedCourse();
        const lock = course && state.locks.get(Number(course.id));
        if (!lock || lock.writeConfirmed || lock.outcome !== 'unchanged' || !lock.authority) return;
        if (String(lock.authority.status) !== String(lock.expectedStatus)) return;
        state.locks.delete(Number(course.id));
        notifyWriteStateChange();
        state.editor = createEditor(lock.authority);
        clearPending();
        state.results.set(Number(course.id), {
            type: 'warning',
            title: '已人工解除写锁',
            message: '确认课程保持原状态且精确审计为空；新的操作必须重新预览并双确认。',
            requestId: lock.requestId
        });
        render();
        if (isCompact()) openCompactDialog(false);
    }

    async function activate(options) {
        if (!state.mounted || !state.host) return false;
        if (mutationBusy() && options && options.force) return false;
        if (state.loaded && !(options && options.force)) {
            render();
            return true;
        }
        const operation = state.controllers && state.controllers.beginRead({ purpose: 'courses' });
        if (!operation) return false;
        state.loading = true;
        render();
        try {
            const payload = await apiRequest('/api/courses', { signal: operation.signal });
            if (!isCurrent('read', operation)) return false;
            if (!Array.isArray(payload)) throw new Error('课程列表响应不是数组');
            state.courses = payload.slice();
            state.loaded = true;
            const lockedId = Array.from(state.locks.keys())
                .find((courseId) => state.courses.some((course) => Number(course.id) === Number(courseId)));
            const preferredId = lockedId || state.selectedId;
            if (preferredId) {
                const selection = selectionFromAuthority(state.courses, preferredId);
                state.selectedId = selection.selectedId;
                state.triggerId = selection.selectedId;
                state.editor = selection.editor;
                clearPending();
            }
            state.loading = false;
            render();
            const locks = Array.from(state.locks.values());
            for (const lock of locks) {
                if (!state.mounted) break;
                await reconcile(lock);
            }
            return true;
        } catch (error) {
            if (global.AstraApiClient.isCancelled(error) || !isCurrent('read', operation)) return false;
            state.loading = false;
            state.host.innerHTML = `
                <div class="admin-error" role="alert">
                    <i data-lucide="triangle-alert"></i>
                    <strong>课程治理读取失败</strong>
                    <span>${escapeHtml(global.AstraApiClient.message(error))}</span>
                    <button type="button" class="admin-icon-button" data-admin-course-refresh>重试</button>
                </div>
            `;
            refreshIcons();
            return false;
        } finally {
            if (state.controllers) state.controllers.finish('read', operation);
        }
    }

    function onClick(event) {
        const select = event.target.closest('[data-admin-course-select]');
        if (select) {
            selectCourse(select.dataset.adminCourseSelect);
            return;
        }
        if (event.target.closest('[data-admin-course-refresh]')) {
            if (courseWriteBlocked()) return;
            activate({ force: true });
            return;
        }
        if (event.target.closest('[data-admin-course-close]')) {
            closeCompactDialog();
            return;
        }
        if (event.target.closest('[data-admin-course-reconcile]')) {
            const course = selectedCourse();
            const lock = course && state.locks.get(Number(course.id));
            if (lock) reconcile(lock);
            return;
        }
        if (event.target.closest('[data-admin-course-unlock]')) unlockUnchanged();
    }

    function onInput(event) {
        if (event.target.matches('[data-admin-course-reason]') && state.editor) {
            state.editor.reason = event.target.value;
            invalidatePending();
        }
        if (event.target.matches('[data-admin-course-filters] [name="q"]')) {
            state.query = event.target.value;
            render();
        }
    }

    function onChange(event) {
        if (event.target.matches('[data-admin-course-target]') && state.editor) {
            state.editor.targetStatus = event.target.value;
            invalidatePending();
            render();
            if (isCompact()) openCompactDialog(false);
            return;
        }
        if (event.target.matches('[data-admin-course-filters] [name="status"]')) {
            state.status = event.target.value;
            render();
        }
    }

    function onSubmit(event) {
        if (event.target.matches('[data-admin-course-form]')) submitCourse(event);
        else if (event.target.matches('[data-admin-course-filters]')) event.preventDefault();
    }

    function onCancel(event) {
        const dialog = event.target.closest('[data-admin-course-dialog]');
        if (!dialog) return;
        event.preventDefault();
        if (mutationBusy()) return;
        closeCompactDialog();
    }

    function invalidateContext() {
        if (mutationBusy() || state.locks.size) return false;
        if (state.controllers) state.controllers.invalidate('read');
        clearPending();
        resetCourseContext(state);
        if (state.mounted) render();
        return true;
    }

    function mount(host, context) {
        destroy();
        if (!(host instanceof Element)) return false;
        state.host = host;
        state.context = context || {};
        state.controllers = createControllerOwnership(global.AbortController);
        state.confirmationExecutor = createConfirmedMutationExecutor(commitCourse, (snapshot) => {
            state.pending = snapshot.pending;
        }, () => !courseWriteBlocked());
        state.mounted = true;
        state.loaded = false;
        state.clickHandler = onClick;
        state.inputHandler = onInput;
        state.changeHandler = onChange;
        state.submitHandler = onSubmit;
        state.cancelHandler = onCancel;
        host.addEventListener('click', state.clickHandler);
        host.addEventListener('input', state.inputHandler);
        host.addEventListener('change', state.changeHandler);
        host.addEventListener('submit', state.submitHandler);
        host.addEventListener('cancel', state.cancelHandler, true);
        render();
        notifyWriteStateChange();
        return true;
    }

    function destroy() {
        state.mounted = false;
        if (state.controllers) {
            state.controllers.destroy((operation) => {
                if (!operation.sent || !operation.course || !operation.payload) return;
                const lock = mutationLock(
                    operation.course,
                    operation.payload,
                    operation.requestId,
                    'unknown',
                    operation.checkpoint
                );
                state.results.set(lock.courseId, {
                    type: 'warning',
                    title: lock.writeConfirmed ? '离页时精确审计待确认' : '离页时写入结果未知',
                    message: lock.writeConfirmed
                        ? '可信 2xx 已固化，精确审计尚未确认；写锁保留，重新进入后只读对账。'
                        : 'PATCH 发出后页面已离开；写锁保留，重新进入后只做权威对账，不会自动重发。',
                    requestId: lock.requestId
                });
            });
        }
        state.controllers = null;
        if (state.confirmationExecutor) state.confirmationExecutor.invalidate();
        state.confirmationExecutor = null;
        cancelScheduled();
        if (state.host) {
            if (state.clickHandler) state.host.removeEventListener('click', state.clickHandler);
            if (state.inputHandler) state.host.removeEventListener('input', state.inputHandler);
            if (state.changeHandler) state.host.removeEventListener('change', state.changeHandler);
            if (state.submitHandler) state.host.removeEventListener('submit', state.submitHandler);
            if (state.cancelHandler) state.host.removeEventListener('cancel', state.cancelHandler, true);
            const dialog = state.host.querySelector('[data-admin-course-dialog]');
            if (dialog && dialog.open) dialog.close();
        }
        state.host = null;
        state.context = null;
        state.loaded = false;
        state.loading = false;
        state.courses = [];
        state.selectedId = 0;
        state.editor = null;
        state.pending = null;
        state.triggerId = 0;
        state.clickHandler = null;
        state.inputHandler = null;
        state.changeHandler = null;
        state.submitHandler = null;
        state.cancelHandler = null;
    }

    global.AdminCourseGovernance = Object.freeze({
        mount,
        activate,
        invalidateContext,
        destroy,
        contract: Object.freeze({
            allowedTransitions,
            buildMutation,
            selectionFromAuthority,
            storeCourseResult,
            resetCourseContext,
            impactMatches,
            responseMatches,
            reconcileOutcome,
            exactAuditPresent,
            exactAuditEntry,
            auditEvidenceState,
            auditFact,
            courseAuditParams,
            trustedWriteCheckpoint,
            transferMutationCheckpoint,
            lockFromMutationOperation,
            executeCourseWriteTransaction,
            parseAuditSnapshot,
            classifyConflict,
            conflictPresentation,
            confirmationDecision,
            sendCourseStatusPatch,
            createConfirmedMutationExecutor,
            invalidateConfirmationContext,
            createControllerOwnership,
            courseWriteBlocked,
            guardedCourseSelection,
            courseRowDisabled
        }),
        snapshot: () => Object.freeze({
            mounted: state.mounted,
            loaded: state.loaded,
            selectedId: state.selectedId,
            courses: Object.freeze(state.courses.map((course) => Object.freeze({
                id: Number(course.id),
                school_id: Number(course.school_id),
                status: String(course.status || '')
            }))),
            lockCount: state.locks.size,
            lockedCourseIds: Object.freeze(Array.from(state.locks.keys())),
            pending: Boolean(state.pending),
            mutationCourseId: Number((mutationOwner() || {}).courseId || 0)
        })
    });
})(window);
