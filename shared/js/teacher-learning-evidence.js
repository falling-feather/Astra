(function (global) {
    'use strict';

    if (global.AstraTeacherLearningEvidence) return;

    const POLL_MS = 4000;
    const PROGRESS_PAGE_LIMIT = 50;
    const EVENT_PAGE_LIMIT = 50;
    const RELEASE_STATES = new Set(['open', 'locked', 'hidden']);
    const EVENT_TYPES = new Set([
        'started',
        'predicted',
        'attempted',
        'corrected',
        'explained',
        'completed',
        'transferred'
    ]);
    const SUPPORTED_FACT_ACTIVITIES = new Set([
        'physics.mechanics',
        'control-flow.loop-boundary'
    ]);
    const EVENT_LABELS = Object.freeze({
        started: '开始学习',
        predicted: '记录预测',
        attempted: '进行尝试',
        corrected: '完成修正',
        explained: '提交解释',
        completed: '服务端完成投影',
        transferred: '历史迁移投影'
    });
    const RELEASE_LABELS = Object.freeze({
        open: '开放：学生现在可以进入。',
        locked: '锁定：学生可以看到，但当前不能进入。',
        hidden: '隐藏：学生端不会显示这个分块及其名称。'
    });
    const FACT_DEGRADED_MESSAGE = '课程专属事实尚未接入；当前只能确认事件类型与时间。';
    const CONTROL_TRACE_MESSAGE = '课程 producer 尚未提交结构化轨迹；当前不会从源码、浏览器输出或公开样例推断运算符、次数与结果。';
    let active = null;

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function positiveInteger(value) {
        const number = Number(value);
        return Number.isInteger(number) && number > 0 ? number : 0;
    }

    function nonNegativeInteger(value) {
        return Number.isInteger(value) && value >= 0;
    }

    function validDate(value) {
        return value === null || (
            typeof value === 'string'
            && Number.isFinite(new Date(value).getTime())
        );
    }

    function normalizeBaseUrl(value) {
        try {
            return global.AstraApiClient && typeof global.AstraApiClient.normalizeBaseUrl === 'function'
                ? global.AstraApiClient.normalizeBaseUrl(value || '')
                : String(value || '').replace(/\/+$/, '');
        } catch (_) {
            return '';
        }
    }

    function normalizeSnapshot(session) {
        let raw = null;
        try {
            raw = session.bridge && typeof session.bridge.snapshot === 'function'
                ? session.bridge.snapshot()
                : null;
        } catch (_) {
            raw = null;
        }
        const role = String(raw && raw.role || '').toLowerCase();
        return Object.freeze({
            role: role === 'teacher' || role === 'admin' ? role : '',
            online: Boolean(raw && raw.online),
            attached: Boolean(raw && raw.curriculumAttached),
            classId: positiveInteger(raw && raw.classId),
            courseId: positiveInteger(raw && raw.courseId),
            classLabel: String(raw && raw.classLabel || '').slice(0, 160),
            courseLabel: String(raw && raw.courseLabel || '').slice(0, 240),
            baseUrl: normalizeBaseUrl(raw && raw.baseUrl)
        });
    }

    function scopeKey(snapshot) {
        return `${snapshot.baseUrl}|${snapshot.classId || ''}:${snapshot.courseId || ''}`;
    }

    function scopeOf(snapshot) {
        return Object.freeze({
            class_id: snapshot.classId,
            course_id: snapshot.courseId
        });
    }

    function current(session, generation, controller) {
        return Boolean(
            session
            && session === active
            && !session.destroyed
            && generation === session.generation
            && controller
            && !controller.signal.aborted
        );
    }

    function currentEvidence(session, generation, controller) {
        return Boolean(
            session
            && session === active
            && !session.destroyed
            && generation === session.evidenceGeneration
            && controller
            && !controller.signal.aborted
        );
    }

    function normalizedError(error) {
        const client = global.AstraLearningEvidenceClient;
        return client && typeof client.normalizeError === 'function'
            ? client.normalizeError(error)
            : error;
    }

    function errorCode(error) {
        const normalized = normalizedError(error);
        return String(normalized && normalized.code || 'teacher_workflow_unavailable');
    }

    function errorMessage(code) {
        const messages = {
            explicit_scope_required: '请先明确选择学校、班级与课程；系统不会静默组合教学范围。',
            course_not_attached: '这个班级尚未挂接课程。请先到“组织与课程”完成挂接。',
            no_students: '当前班级没有有效学生，暂时无法查看进度。',
            forbidden: '你无权查看这个班级或课程。系统没有显示其他教学范围的数据。',
            identity_required: '当前会话已失效；请重新登录并确认身份。',
            offline: '当前离线，不能安全读取、发布安排、反馈或纠正记录。',
            progress_schema_invalid: '学生进度响应与当前教学范围不一致，页面已拒绝渲染。',
            aggregate_schema_invalid: '班级概况响应与当前教学范围不一致，页面已拒绝渲染。'
        };
        return messages[code] || '当前教学状态暂不可用；页面没有保留上一范围的数据。';
    }

    function clearController(session, key) {
        const controller = session && session[key];
        if (controller && !controller.signal.aborted) controller.abort();
        if (session) session[key] = null;
    }

    function notifyMutation(session, locked) {
        if (!session) return;
        session.correctionInFlight = Boolean(locked);
        const callback = session.bridge && session.bridge.mutationState;
        if (typeof callback === 'function') {
            try { callback(session.correctionInFlight); } catch (_) {}
        }
    }

    function lockParentWrite(session, error, confirmed) {
        const callback = session && session.bridge && session.bridge.lockWrite;
        if (typeof callback === 'function') {
            try { callback(error || new Error('teacher_correction_readback_failed'), Boolean(confirmed)); } catch (_) {}
        }
    }

    function clearTimer(session) {
        if (session.timer) global.clearTimeout(session.timer);
        session.timer = 0;
    }

    function schedule(session, delay, clear) {
        clearTimer(session);
        if (
            !session
            || session !== active
            || session.destroyed
            || !session.authorityReady
        ) return;
        session.timer = global.setTimeout(
            () => refreshSession(session, clear ? { clear: true } : { clear: false, background: true }),
            Math.max(0, Number(delay) || 0)
        );
    }

    function workflowHasFocus(session) {
        const focused = global.document && global.document.activeElement;
        return Boolean(focused && session.root && Array.from(
            session.root.querySelectorAll('[data-teacher-natural-workflow]')
        ).some(container => typeof container.contains === 'function' && container.contains(focused)));
    }

    function workflowDataSignature(session) {
        return JSON.stringify({
            progress: session.progress,
            aggregate: session.aggregate,
            progressError: session.progressError,
            aggregateError: session.aggregateError,
            errorCode: session.errorCode
        });
    }

    function clearWorkflowState(session, code) {
        clearTimer(session);
        clearController(session, 'controller');
        clearController(session, 'evidenceController');
        clearController(session, 'correctionController');
        notifyMutation(session, false);
        session.generation += 1;
        session.evidenceGeneration += 1;
        session.scopeKey = '';
        session.progress = null;
        session.aggregate = null;
        session.progressOffset = 0;
        session.progressError = '';
        session.aggregateError = '';
        session.pendingRender = false;
        session.phase = code ? 'partial' : 'idle';
        session.errorCode = code || '';
        session.evidencePage = null;
        session.evidenceError = '';
        session.evidenceStatus = '';
        session.evidenceStatusType = '';
        session.selectedStudentId = 0;
        session.selectedStudentLabel = '';
        session.evidenceFilters.activityKey = '';
        session.evidenceFilters.eventType = '';
        session.eventTokens.clear();
        session.dialogCloseRequested = false;
        session.renderRevision += 1;
        closeDialog(session, { restoreFocus: false });
    }

    function validateProgressPage(payload, snapshot, expectedOffset) {
        const items = payload && payload.items;
        const studentIds = new Set();
        const validRows = Array.isArray(items) && items.length <= PROGRESS_PAGE_LIMIT && items.every(row => {
            if (
                !row
                || !positiveInteger(row.student_id)
                || studentIds.has(row.student_id)
                || typeof row.display_name !== 'string'
                || !row.display_name.trim()
                || row.display_name.length > 240
                || !Array.isArray(row.blocks)
            ) return false;
            studentIds.add(row.student_id);
            const unitIds = new Set();
            const activityKeys = new Set();
            return row.blocks.every(block => {
                if (
                    !block
                    || !positiveInteger(block.course_unit_id)
                    || unitIds.has(block.course_unit_id)
                    || typeof block.activity_key !== 'string'
                    || block.activity_key.length > 120
                    || activityKeys.has(block.activity_key)
                    || !/^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/.test(block.activity_key)
                    || !positiveInteger(block.position)
                    || typeof block.started !== 'boolean'
                    || typeof block.completed !== 'boolean'
                    || !nonNegativeInteger(block.submitted)
                    || !nonNegativeInteger(block.graded)
                    || !validDate(block.recent_activity_at)
                    || !RELEASE_STATES.has(block.effective_release_state)
                ) return false;
                unitIds.add(block.course_unit_id);
                activityKeys.add(block.activity_key);
                return true;
            });
        });
        const nextOffset = payload && payload.next_offset;
        if (
            !payload
            || payload.class_id !== snapshot.classId
            || payload.course_id !== snapshot.courseId
            || !positiveInteger(payload.plan_version)
            || !nonNegativeInteger(payload.total)
            || payload.limit !== PROGRESS_PAGE_LIMIT
            || payload.offset !== expectedOffset
            || !validRows
            || items.length > payload.total
            || payload.offset + items.length > payload.total
            || !(nextOffset === null || (
                nonNegativeInteger(nextOffset)
                && nextOffset > payload.offset
                && nextOffset <= payload.total
            ))
        ) {
            const error = new Error('progress_schema_invalid');
            error.code = 'progress_schema_invalid';
            throw error;
        }
        return Object.freeze({
            class_id: payload.class_id,
            course_id: payload.course_id,
            plan_version: payload.plan_version,
            total: payload.total,
            limit: payload.limit,
            offset: payload.offset,
            next_offset: nextOffset,
            items: Object.freeze(items.map(row => Object.freeze({
                student_id: row.student_id,
                display_name: row.display_name,
                blocks: Object.freeze(row.blocks.map(block => Object.freeze(Object.assign({}, block))))
            })))
        });
    }

    function aggregateTotals(aggregate) {
        const activities = aggregate && Array.isArray(aggregate.activities) ? aggregate.activities : [];
        return activities.reduce((totals, item) => {
            totals.notStarted += Number(item.not_started || 0);
            totals.inProgress += Number(item.in_progress || 0);
            totals.completed += Number(item.completed || 0);
            totals.transferred += Number(item.transferred || 0);
            return totals;
        }, { notStarted: 0, inProgress: 0, completed: 0, transferred: 0 });
    }

    function progressSummary(row) {
        return row.blocks.reduce((summary, block) => {
            if (block.started) summary.started += 1;
            if (block.completed) summary.completed += 1;
            summary.submitted += block.submitted;
            summary.graded += block.graded;
            if (block.recent_activity_at && (
                !summary.recent || new Date(block.recent_activity_at) > new Date(summary.recent)
            )) summary.recent = block.recent_activity_at;
            return summary;
        }, { started: 0, completed: 0, submitted: 0, graded: 0, recent: null });
    }

    function formatDate(value) {
        if (!value) return '暂无';
        const date = new Date(value);
        if (!Number.isFinite(date.getTime())) return '暂无';
        return new Intl.DateTimeFormat('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    }

    function visibleBlockColumns(rows) {
        const columns = new Map();
        rows.forEach(row => row.blocks.forEach(block => {
            if (block.effective_release_state === 'hidden' || columns.has(block.course_unit_id)) return;
            columns.set(block.course_unit_id, Object.freeze({
                courseUnitId: block.course_unit_id,
                position: block.position
            }));
        }));
        return Array.from(columns.values()).sort((left, right) => (
            left.position - right.position || left.courseUnitId - right.courseUnitId
        ));
    }

    function blockProgressMarkup(block) {
        if (!block || block.effective_release_state === 'hidden') {
            return '<span class="teacher-block-progress__hidden">此学生不可见</span>';
        }
        return `
            <span class="teacher-block-progress__release" data-release-state="${escapeHtml(block.effective_release_state)}">${escapeHtml(RELEASE_LABELS[block.effective_release_state])}</span>
            <dl class="teacher-block-progress__facts">
                <div><dt>开始</dt><dd>${block.started ? '是' : '否'}</dd></div>
                <div><dt>完成</dt><dd>${block.completed ? '是' : '否'}</dd></div>
                <div><dt>提交</dt><dd>${block.submitted}</dd></div>
                <div><dt>评分</dt><dd>${block.graded}</dd></div>
                <div><dt>最近活动</dt><dd>${escapeHtml(formatDate(block.recent_activity_at))}</dd></div>
            </dl>`;
    }

    function pageControls(page, kind, label) {
        if (!page) return '';
        const items = Array.isArray(page.items) ? page.items : [];
        const start = items.length ? page.offset + 1 : 0;
        const end = items.length ? Math.min(page.total, page.offset + items.length) : 0;
        const previous = Math.max(0, page.offset - page.limit);
        const next = page.next_offset == null ? page.offset : page.next_offset;
        return `
            <nav class="teacher-natural-pagination" aria-label="${escapeHtml(label)}分页">
                <span>${start}–${end} / ${page.total}</span>
                <div>
                    <button type="button" data-teacher-natural-page="${escapeHtml(kind)}" data-offset="${previous}" ${page.offset > 0 ? '' : 'disabled'}>上一页</button>
                    <button type="button" data-teacher-natural-page="${escapeHtml(kind)}" data-offset="${next}" ${page.next_offset == null ? 'disabled' : ''}>下一页</button>
                </div>
            </nav>`;
    }

    function progressRowsMarkup(session) {
        const rows = session.progress && session.progress.items || [];
        if (!rows.length) {
            return '<div class="teacher-natural-empty">当前班级没有有效学生，暂时无法查看进度。</div>';
        }
        const columns = visibleBlockColumns(rows);
        const tableRows = rows.map(row => {
            const byUnit = new Map(row.blocks.map(block => [block.course_unit_id, block]));
            const hiddenCount = row.blocks.filter(block => block.effective_release_state === 'hidden').length;
            return `
                <tr>
                    <th scope="row"><strong>${escapeHtml(row.display_name)}</strong>${hiddenCount ? `<small>${hiddenCount} 个隐藏分块</small>` : ''}</th>
                    ${columns.map(column => `<td>${blockProgressMarkup(byUnit.get(column.courseUnitId))}</td>`).join('')}
                    <td class="teacher-natural-progress-table__actions">
                        <button type="button" data-teacher-student-preview="${row.student_id}">预览学生状态</button>
                        <button type="button" data-teacher-student-evidence="${row.student_id}">查看学习证据</button>
                    </td>
                </tr>`;
        }).join('');
        const mobileRows = rows.map(row => {
            const summary = progressSummary(row);
            const visibleBlocks = row.blocks.filter(block => block.effective_release_state !== 'hidden');
            const hiddenCount = row.blocks.length - visibleBlocks.length;
            return `
                <details class="teacher-progress-disclosure">
                    <summary><strong>${escapeHtml(row.display_name)}</strong><span>${visibleBlocks.filter(block => block.completed).length} / ${visibleBlocks.length} 个可见分块完成</span></summary>
                    <ol class="teacher-progress-disclosure__blocks">
                        ${visibleBlocks.map(block => `<li><strong>课程分块 ${block.position}</strong>${blockProgressMarkup(block)}</li>`).join('') || '<li class="teacher-natural-empty">当前没有对学生可见的课程分块。</li>'}
                    </ol>
                    ${hiddenCount ? `<p class="teacher-progress-disclosure__hidden">${hiddenCount} 个隐藏分块未显示名称、标识或历史。</p>` : ''}
                    <p class="teacher-progress-disclosure__recent">最近活动：${escapeHtml(formatDate(summary.recent))}</p>
                    <div class="teacher-progress-disclosure__actions">
                        <button type="button" data-teacher-student-preview="${row.student_id}">预览学生状态</button>
                        <button type="button" data-teacher-student-evidence="${row.student_id}">查看学习证据</button>
                    </div>
                </details>`;
        }).join('');
        return `
            <div class="teacher-progress-desktop">
                <table class="teacher-natural-progress-table">
                    <caption>当前班级学生 × 可见课程分块学习状态</caption>
                    <thead><tr><th scope="col">学生</th>${columns.map(column => `<th scope="col">课程分块 ${column.position}</th>`).join('')}<th scope="col">操作</th></tr></thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>
            <div class="teacher-progress-mobile">${mobileRows}</div>`;
    }

    function aggregateMarkup(session) {
        if (session.aggregateError) {
            return `<div class="teacher-natural-state" role="alert">${escapeHtml(errorMessage(session.aggregateError))}</div>`;
        }
        if (!session.aggregate) {
            return '<div class="teacher-natural-state" role="status">正在读取班级学习概况…</div>';
        }
        const totals = aggregateTotals(session.aggregate);
        return `
            <dl class="teacher-natural-overview" aria-label="班级学习概况">
                <div><dt>活跃学生</dt><dd>${Number(session.aggregate.active_students || 0)}</dd></div>
                <div><dt>尚未开始</dt><dd>${totals.notStarted}</dd></div>
                <div><dt>进行中</dt><dd>${totals.inProgress}</dd></div>
                <div><dt>已完成</dt><dd>${totals.completed}</dd></div>
            </dl>
            <p class="teacher-natural-note">概况只作班级趋势参考；学生完成状态以本页学生进度和服务端投影为准。</p>`;
    }

    function workflowMarkup(session) {
        const snapshot = normalizeSnapshot(session);
        if (session.errorCode) {
            return `
                <header class="teacher-natural-header"><div><span>LEARNING STATUS</span><h3>学生进度与学习证据</h3></div></header>
                <div class="teacher-natural-state" role="${session.errorCode === 'identity_required' ? 'alert' : 'status'}">${escapeHtml(errorMessage(session.errorCode))}</div>`;
        }
        if (!snapshot.classId || !snapshot.courseId) {
            return `
                <header class="teacher-natural-header"><div><span>LEARNING STATUS</span><h3>学生进度与学习证据</h3></div></header>
                <div class="teacher-natural-state" role="status">${escapeHtml(errorMessage('explicit_scope_required'))}</div>`;
        }
        if (!snapshot.attached) {
            return `
                <header class="teacher-natural-header"><div><span>LEARNING STATUS</span><h3>学生进度与学习证据</h3></div></header>
                <div class="teacher-natural-state" role="status">${escapeHtml(errorMessage('course_not_attached'))}</div>`;
        }
        const progress = session.progressError
            ? `<div class="teacher-natural-state" role="alert">${escapeHtml(errorMessage(session.progressError))}</div>`
            : session.progress
                ? `${progressRowsMarkup(session)}${pageControls(session.progress, 'progress', '学生进度')}`
                : '<div class="teacher-natural-state" role="status">正在读取当前班级与课程的最新学习状态…</div>';
        return `
            <header class="teacher-natural-header">
                <div><span>LEARNING STATUS</span><h3>学生进度与学习证据</h3><p>${escapeHtml(snapshot.classLabel)} · ${escapeHtml(snapshot.courseLabel)}</p></div>
                <button type="button" data-teacher-natural-refresh>刷新当前范围</button>
            </header>
            ${aggregateMarkup(session)}
            <section class="teacher-natural-progress" aria-label="学生进度">${progress}</section>`;
    }

    function render(session) {
        if (!session || session !== active || session.destroyed || !session.root) return;
        if (session.pendingRender && workflowHasFocus(session)) return;
        if (session.pendingRender) {
            session.pendingRender = false;
            session.renderRevision += 1;
        }
        const signature = [
            session.scopeKey,
            session.phase,
            session.errorCode,
            session.progressError,
            session.aggregateError,
            session.renderRevision,
            session.progress && `${session.progress.offset}:${session.progress.total}:${session.progress.plan_version}`,
            session.aggregate && session.aggregate.generated_at
        ].join('|');
        session.root.querySelectorAll('[data-teacher-natural-workflow]').forEach(container => {
            if (container.dataset.teacherNaturalSignature === signature) return;
            container.dataset.teacherNaturalSignature = signature;
            container.setAttribute('aria-busy', session.phase === 'loading' ? 'true' : 'false');
            container.innerHTML = workflowMarkup(session);
        });
    }

    async function refreshSession(session, options) {
        if (!session || session !== active || session.destroyed || !session.authorityReady) return;
        const request = Object.assign({}, options || {});
        const snapshot = normalizeSnapshot(session);
        const nextScopeKey = scopeKey(snapshot);
        const attachmentChanged = snapshot.attached !== session.consumedAttachment;
        request.force = Boolean(request.force || attachmentChanged);
        if (session.dialog && session.dialog.open && !request.force) {
            schedule(session, POLL_MS);
            return false;
        }
        session.consumedAttachment = snapshot.attached;
        if (!snapshot.role || !snapshot.online || !snapshot.classId || !snapshot.courseId || !snapshot.attached) {
            clearWorkflowState(
                session,
                !snapshot.role ? 'identity_required'
                    : !snapshot.online ? 'offline'
                        : !snapshot.classId || !snapshot.courseId ? 'explicit_scope_required'
                            : 'course_not_attached'
            );
            session.scopeKey = nextScopeKey;
            render(session);
            return false;
        }
        if (session.scopeKey !== nextScopeKey) {
            clearWorkflowState(session, '');
            session.scopeKey = nextScopeKey;
            session.progressOffset = 0;
        }
        clearController(session, 'controller');
        const controller = new AbortController();
        const generation = ++session.generation;
        const offset = request.offset === undefined ? session.progressOffset : Math.max(0, Number(request.offset) || 0);
        const previousSignature = workflowDataSignature(session);
        session.controller = controller;
        session.errorCode = '';
        if (request.clear !== false) {
            session.phase = 'loading';
            session.progress = null;
            session.aggregate = null;
            session.progressError = '';
            session.aggregateError = '';
            session.pendingRender = false;
            render(session);
        }
        const progressRequest = global.AstraApiClient.request(
            `/api/progress/courses/${snapshot.courseId}/classes/${snapshot.classId}/students`,
            {
                baseUrl: snapshot.baseUrl,
                params: { limit: PROGRESS_PAGE_LIMIT, offset },
                signal: controller.signal
            }
        );
        const aggregateRequest = global.AstraLearningEvidenceClient.teacherAggregate(
            scopeOf(snapshot),
            { signal: controller.signal, baseUrl: snapshot.baseUrl }
        );
        const [progressResult, aggregateResult] = await Promise.allSettled([progressRequest, aggregateRequest]);
        if (!current(session, generation, controller)) return false;
        if (progressResult.status === 'fulfilled') {
            try {
                session.progress = validateProgressPage(progressResult.value, snapshot, offset);
                session.progressOffset = session.progress.offset;
                session.progressError = '';
            } catch (error) {
                session.progress = null;
                session.progressError = errorCode(error);
            }
        } else {
            session.progress = null;
            session.progressError = errorCode(progressResult.reason);
        }
        if (aggregateResult.status === 'fulfilled') {
            session.aggregate = aggregateResult.value;
            session.aggregateError = '';
        } else {
            session.aggregate = null;
            session.aggregateError = errorCode(aggregateResult.reason);
        }
        session.phase = session.progress && session.aggregate ? 'ready' : 'partial';
        session.controller = null;
        const changed = previousSignature !== workflowDataSignature(session);
        if (request.background && workflowHasFocus(session) && (changed || session.pendingRender)) {
            session.pendingRender = true;
        } else if (changed || session.pendingRender || request.clear !== false) {
            session.pendingRender = false;
            session.renderRevision += 1;
            render(session);
        }
        schedule(session, POLL_MS);
        return Boolean(session.progress && session.aggregate);
    }

    function studentRow(session, studentId) {
        const rows = session.progress && session.progress.items || [];
        return rows.find(row => row.student_id === studentId) || null;
    }

    function ensureDialog(session) {
        if (session.dialog && session.dialog.isConnected) return session.dialog;
        const dialog = global.document.createElement('dialog');
        dialog.className = 'teacher-natural-dialog';
        dialog.setAttribute('data-teacher-natural-dialog', '');
        dialog.setAttribute('aria-labelledby', 'teacher-natural-dialog-title');
        session.root.appendChild(dialog);
        session.dialog = dialog;
        return dialog;
    }

    function focusableIn(dialog) {
        return Array.from(dialog.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
        )).filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
    }

    function trapDialogKeydown(session, event) {
        if (!session.dialog || !session.dialog.open) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
            closeDialog(session);
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = focusableIn(session.dialog);
        if (!focusable.length) {
            event.preventDefault();
            session.dialog.querySelector('[data-teacher-dialog-title]')?.focus();
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && global.document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && global.document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    function bindDialogCapture(session) {
        if (session.dialogCaptureBound) return;
        session.onDocumentKeydown = event => trapDialogKeydown(session, event);
        global.document.addEventListener('keydown', session.onDocumentKeydown, true);
        session.dialogCaptureBound = true;
    }

    function unbindDialogCapture(session) {
        if (!session || !session.dialogCaptureBound) return;
        global.document.removeEventListener('keydown', session.onDocumentKeydown, true);
        session.dialogCaptureBound = false;
    }

    function openDialog(session, markup, trigger, mode) {
        const dialog = ensureDialog(session);
        if (trigger && trigger.isConnected) session.returnFocus = trigger;
        else if (!dialog.open) session.returnFocus = null;
        session.dialogMode = mode || '';
        session.dialogCloseRequested = false;
        dialog.innerHTML = markup;
        bindDialogCapture(session);
        if (!dialog.open && typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
        const title = dialog.querySelector('[data-teacher-dialog-title]');
        if (title) title.focus();
    }

    function closeDialog(session, options) {
        if (!session) return;
        const restoreFocus = !options || options.restoreFocus !== false;
        const evidenceDialog = session.dialogMode === 'evidence';
        if (evidenceDialog && session.correctionInFlight) {
            session.dialogCloseRequested = true;
        } else if (evidenceDialog) {
            clearController(session, 'evidenceController');
            session.evidenceGeneration += 1;
            session.evidencePage = null;
            session.evidenceError = '';
            session.evidenceStatus = '';
            session.evidenceStatusType = '';
            session.selectedStudentId = 0;
            session.selectedStudentLabel = '';
            session.eventTokens.clear();
        }
        unbindDialogCapture(session);
        if (session.releaseResolver) {
            const resolve = session.releaseResolver;
            session.releaseResolver = null;
            resolve(false);
        }
        const dialog = session.dialog;
        if (dialog) {
            if (dialog.open && typeof dialog.close === 'function') dialog.close();
            else dialog.removeAttribute('open');
            dialog.innerHTML = '';
        }
        const target = session.returnFocus;
        session.returnFocus = null;
        session.dialogMode = '';
        if (restoreFocus && target && target.isConnected && !target.disabled) target.focus();
    }

    function studentPreviewMarkup(row) {
        const visibleBlocks = row.blocks.filter(block => block.effective_release_state !== 'hidden');
        const hiddenCount = row.blocks.length - visibleBlocks.length;
        const blocks = visibleBlocks.length
            ? visibleBlocks.map(block => `
                <li>
                    <div><strong>课程分块 ${block.position}</strong><span>${escapeHtml(RELEASE_LABELS[block.effective_release_state])}</span></div>
                    ${block.effective_release_state === 'locked' ? '<p>当前条件未满足；学生可以看到此分块，但不能进入。</p>' : ''}
                </li>`).join('')
            : '<li class="teacher-natural-empty">当前没有对学生可见的课程分块。</li>';
        return `
            <form method="dialog" class="teacher-natural-dialog__surface">
                <header><div><span>STUDENT STATUS PREVIEW</span><h2 id="teacher-natural-dialog-title" data-teacher-dialog-title tabindex="-1">${escapeHtml(row.display_name)} · 学生状态预览</h2></div><button type="button" data-teacher-dialog-close aria-label="关闭预览">关闭</button></header>
                <p class="teacher-natural-dialog__notice">这是安全只读预览，不会切换身份、加载学生运行时或代表学生执行任何操作。</p>
                <ol class="teacher-student-preview-list">${blocks}</ol>
                ${hiddenCount ? `<p class="teacher-natural-dialog__notice">${hiddenCount} 个隐藏分块未显示名称、标识或历史。</p>` : ''}
            </form>`;
    }

    function evidenceFiltersMarkup(session) {
        const row = studentRow(session, session.selectedStudentId);
        const blocks = row ? row.blocks.slice().sort((left, right) => left.position - right.position) : [];
        const activityOptions = blocks.map(block => `
            <option value="${escapeHtml(block.activity_key)}"${session.evidenceFilters.activityKey === block.activity_key ? ' selected' : ''}>课程分块 ${block.position}</option>`).join('');
        const eventOptions = Array.from(EVENT_TYPES).map(type => `
            <option value="${type}"${session.evidenceFilters.eventType === type ? ' selected' : ''}>${escapeHtml(EVENT_LABELS[type])}</option>`).join('');
        return `
            <form class="teacher-evidence-filters" data-teacher-evidence-filters>
                <label><span>课程分块</span><select name="activity_key"><option value="">全部分块</option>${activityOptions}</select></label>
                <label><span>事实类型</span><select name="event_type"><option value="">全部类型</option>${eventOptions}</select></label>
                <button type="submit">应用筛选</button>
            </form>`;
    }

    function evidenceFactsMarkup(item) {
        if (!SUPPORTED_FACT_ACTIVITIES.has(item.activity_key)) {
            return `<p class="teacher-natural-degraded">${FACT_DEGRADED_MESSAGE}</p>`;
        }
        const facts = Object.values(item.evidence_summary.facts || {});
        const factList = facts.length
            ? `<ul class="teacher-evidence-facts">${facts.slice(0, 12).map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul>`
            : '<p class="teacher-natural-degraded">当前事件没有通过有限事实校验的课程事实。</p>';
        const controlNote = item.activity_key === 'control-flow.loop-boundary'
            ? `<p class="teacher-natural-degraded">${CONTROL_TRACE_MESSAGE}</p>`
            : '';
        const truncated = item.evidence_summary.truncated
            ? '<p class="teacher-natural-truncated">部分事实未通过有限事实校验，已安全省略；请勿据此判断答案正确性。</p>'
            : '';
        return `${factList}${controlNote}${truncated}`;
    }

    function evidenceItemsMarkup(session) {
        const page = session.evidencePage;
        if (!page || !page.items.length) {
            return '<div class="teacher-natural-empty">尚无学习证据。学生完成预测或尝试后会显示在这里；浏览页面本身不计完成。</div>';
        }
        session.eventTokens.clear();
        const row = studentRow(session, session.selectedStudentId);
        const releaseByUnit = new Map((row && row.blocks || []).map(block => [
            block.course_unit_id,
            block.effective_release_state
        ]));
        return page.items.map((item, index) => {
            const token = `event-${index + 1}`;
            session.eventTokens.set(token, item.event_id);
            const releaseState = releaseByUnit.get(item.course_unit_id);
            const canCorrect = releaseState === 'open'
                && !item.corrected_by_event_id
                && !['completed', 'transferred'].includes(item.event_type);
            return `
                <article class="teacher-evidence-event">
                    <header><strong>${escapeHtml(EVENT_LABELS[item.event_type] || item.event_type)}</strong><time>${escapeHtml(formatDate(item.occurred_at))}</time></header>
                    ${evidenceFactsMarkup(item)}
                    ${item.corrected_by_event_id
                        ? '<p class="teacher-evidence-corrected">这条原记录已有追加式纠正；原事实仍保留。</p>'
                        : ''}
                    ${releaseState !== 'open'
                        ? '<p class="teacher-natural-degraded">当前分块不是明确开放状态，历史可查看，但不能新增纠正。</p>'
                        : ''}
                    ${canCorrect ? `
                        <form data-teacher-evidence-correction="${escapeHtml(token)}">
                            <p>原记录不会被删除。本次纠正将作为新记录保留，系统会依据课程完成条件重新核对状态。</p>
                            <label><span>纠正原因</span><textarea name="reason" minlength="1" maxlength="1000" required></textarea></label>
                            <button type="submit">记录追加式纠正</button>
                        </form>` : ''}
                </article>`;
        }).join('');
    }

    function evidenceDialogMarkup(session) {
        const busy = session.evidenceStatus === 'loading' || session.evidenceStatus === 'saving';
        const body = session.evidenceError
            ? `<div class="teacher-natural-state" role="alert">${escapeHtml(errorMessage(session.evidenceError))}<button type="button" data-teacher-evidence-retry>重试读取</button></div>`
            : busy
                ? `<div class="teacher-natural-state" role="status">${session.evidenceStatus === 'saving' ? '正在保存纠正并重新读取最新证据…' : `正在读取 ${escapeHtml(session.selectedStudentLabel)} 的学习证据…`}</div>`
                : `${session.evidenceStatus ? `<div class="teacher-natural-feedback" role="${session.evidenceStatusType === 'error' ? 'alert' : 'status'}">${escapeHtml(session.evidenceStatus)}</div>` : ''}${evidenceItemsMarkup(session)}${pageControls(session.evidencePage, 'evidence', '学习证据')}`;
        return `
            <section class="teacher-natural-dialog__surface" aria-busy="${busy}">
                <header><div><span>LEARNING EVIDENCE</span><h2 id="teacher-natural-dialog-title" data-teacher-dialog-title tabindex="-1">${escapeHtml(session.selectedStudentLabel)} · 学习证据</h2></div><button type="button" data-teacher-dialog-close aria-label="关闭证据详情">关闭</button></header>
                <p class="teacher-natural-dialog__notice">完成状态只认学生进度与班级概况；事件时间线不会伪造或等待客户端 completed。</p>
                ${evidenceFiltersMarkup(session)}
                <div class="teacher-evidence-timeline">${body}</div>
            </section>`;
    }

    async function loadEvidence(session, studentId, options) {
        const row = studentRow(session, studentId);
        if (!row) return false;
        const request = options || {};
        if (session.selectedStudentId !== studentId) {
            session.evidenceFilters.activityKey = '';
            session.evidenceFilters.eventType = '';
        }
        clearController(session, 'evidenceController');
        const controller = new AbortController();
        const generation = ++session.evidenceGeneration;
        const snapshot = normalizeSnapshot(session);
        const requestScopeKey = scopeKey(snapshot);
        const offset = Math.max(0, Number(request.offset) || 0);
        session.evidenceController = controller;
        session.selectedStudentId = studentId;
        session.selectedStudentLabel = row.display_name;
        session.evidencePage = null;
        session.evidenceError = '';
        session.evidenceStatus = 'loading';
        session.evidenceStatusType = '';
        let loaded = false;
        if (!request.background) {
            openDialog(session, evidenceDialogMarkup(session), request.trigger || session.returnFocus, 'evidence');
        }
        try {
            const page = await global.AstraLearningEvidenceClient.teacherEvents(
                {
                    class_id: snapshot.classId,
                    course_id: snapshot.courseId,
                    subject_user_id: studentId
                },
                {
                    activity_key: session.evidenceFilters.activityKey || undefined,
                    event_type: session.evidenceFilters.eventType || undefined,
                    limit: EVENT_PAGE_LIMIT,
                    offset
                },
                { signal: controller.signal, baseUrl: snapshot.baseUrl }
            );
            if (!currentEvidence(session, generation, controller) || scopeKey(normalizeSnapshot(session)) !== requestScopeKey) return;
            session.evidencePage = page;
            session.evidenceStatus = request.feedback || '';
            session.evidenceStatusType = request.feedbackType || '';
            loaded = true;
        } catch (error) {
            if (!currentEvidence(session, generation, controller) || scopeKey(normalizeSnapshot(session)) !== requestScopeKey) return;
            session.evidenceError = errorCode(error);
            session.evidenceStatus = '';
        } finally {
            if (currentEvidence(session, generation, controller)) {
                session.evidenceController = null;
                if (!request.background && !session.dialogCloseRequested && session.dialog && session.dialog.open) {
                    session.dialog.innerHTML = evidenceDialogMarkup(session);
                }
            }
        }
        return loaded;
    }

    function applyEvidenceFilters(session, form) {
        if (!session.selectedStudentId || session.evidenceStatus === 'saving') return;
        const row = studentRow(session, session.selectedStudentId);
        const activityField = form.querySelector('[name="activity_key"]');
        const eventField = form.querySelector('[name="event_type"]');
        const activityKey = String(activityField && activityField.value || '');
        const eventType = String(eventField && eventField.value || '');
        const knownActivities = new Set((row && row.blocks || []).map(block => block.activity_key));
        session.evidenceFilters.activityKey = knownActivities.has(activityKey) ? activityKey : '';
        session.evidenceFilters.eventType = EVENT_TYPES.has(eventType) ? eventType : '';
        return loadEvidence(session, session.selectedStudentId, { offset: 0, trigger: session.returnFocus });
    }

    async function submitCorrection(session, form) {
        if (session.evidenceStatus === 'saving' || session.correctionInFlight) return;
        const token = form.dataset.teacherEvidenceCorrection;
        const eventId = session.eventTokens.get(token);
        const reasonField = form.querySelector('[name="reason"]');
        const reason = String(reasonField && reasonField.value || '').trim();
        if (!eventId || !reason) {
            if (reasonField) reasonField.focus();
            return;
        }
        const snapshot = normalizeSnapshot(session);
        const correctionScopeKey = scopeKey(snapshot);
        const studentId = session.selectedStudentId;
        const offset = session.evidencePage && session.evidencePage.offset || 0;
        clearController(session, 'correctionController');
        const correctionController = new AbortController();
        const correctionGeneration = session.evidenceGeneration;
        session.correctionController = correctionController;
        session.dialogCloseRequested = false;
        notifyMutation(session, true);
        session.evidenceStatus = 'saving';
        session.evidenceStatusType = '';
        ensureDialog(session).innerHTML = evidenceDialogMarkup(session);
        let mutationState = 'failed';
        let mutationError = null;
        try {
            try {
                await global.AstraLearningEvidenceClient.appendTeacherCorrection(
                    { event_id: eventId, reason },
                    { signal: correctionController.signal, baseUrl: snapshot.baseUrl }
                );
                if (session !== active || session.destroyed || correctionController.signal.aborted
                    || correctionGeneration !== session.evidenceGeneration || scopeKey(normalizeSnapshot(session)) !== correctionScopeKey) return;
                session.evidenceStatus = '纠正已记录，原记录仍保留；学习状态已按最新证据重新核对。';
                session.evidenceStatusType = 'success';
                mutationState = 'success';
            } catch (error) {
                if (session !== active || session.destroyed || correctionController.signal.aborted
                    || correctionGeneration !== session.evidenceGeneration || scopeKey(normalizeSnapshot(session)) !== correctionScopeKey) return;
                const normalized = normalizedError(error);
                mutationError = normalized;
                const ambiguous = Boolean(normalized && normalized.details && normalized.details.ambiguous);
                if (Number(normalized && normalized.details && normalized.details.status) === 409 || normalized && normalized.code === 'event_already_corrected') {
                    session.evidenceStatus = '这条记录已被纠正，或课程状态已经变化。已刷新最新证据，没有重复写入。';
                    session.evidenceStatusType = 'warning';
                    mutationState = 'conflict';
                } else if (ambiguous) {
                    session.evidenceStatus = '尚不能确认本次写入结果。系统不会自动重试；正在读取最新状态。';
                    session.evidenceStatusType = 'error';
                    mutationState = 'ambiguous';
                } else {
                    session.evidenceStatus = '纠正未保存；请确认网络与课程状态后重试。';
                    session.evidenceStatusType = 'error';
                }
            }
            if (mutationState !== 'failed' && session === active && session.selectedStudentId === studentId
                && scopeKey(normalizeSnapshot(session)) === correctionScopeKey) {
                const feedback = session.evidenceStatus;
                const feedbackType = session.evidenceStatusType;
                const eventsRead = await loadEvidence(session, studentId, {
                    offset, trigger: session.returnFocus, feedback, feedbackType,
                    background: session.dialogCloseRequested
                });
                const progressRead = session === active && scopeKey(normalizeSnapshot(session)) === correctionScopeKey
                    ? await refreshSession(session, { clear: false, background: session.dialogCloseRequested, force: true })
                    : false;
                if (mutationState === 'ambiguous' || !eventsRead || !progressRead) {
                    const confirmed = mutationState === 'success'
                        || Boolean(mutationError && mutationError.details && mutationError.details.confirmed);
                    lockParentWrite(session, mutationError || new Error('teacher_correction_readback_failed'), confirmed);
                }
            } else if (session === active && !session.dialogCloseRequested && session.dialog && session.dialog.open) {
                session.dialog.innerHTML = evidenceDialogMarkup(session);
            }
        } finally {
            if (session.correctionController === correctionController) session.correctionController = null;
            notifyMutation(session, false);
            if (session.dialogCloseRequested) {
                session.evidencePage = null;
                session.evidenceStatus = '';
                session.evidenceStatusType = '';
                session.selectedStudentId = 0;
                session.selectedStudentLabel = '';
                session.eventTokens.clear();
            }
        }
    }

    function releasePreviewValue(kind, value) {
        if (kind === 'releaseMode') return RELEASE_LABELS[value] || value;
        if (kind === 'openAt') return value ? formatDate(value) : '未设置';
        if (kind === 'prerequisiteLabel') return value || '无';
        return String(value);
    }

    function releasePreviewField(label, kind, before, after) {
        const changed = kind === 'openAt'
            ? ((!before && after) || (before && !after) || before && after && new Date(before).getTime() !== new Date(after).getTime())
            : before !== after;
        return `
            <div class="${changed ? 'is-changed' : 'is-unchanged'}">
                <dt>${escapeHtml(label)}</dt>
                <dd><span>${escapeHtml(releasePreviewValue(kind, before))}</span><i aria-hidden="true">→</i><strong>${escapeHtml(releasePreviewValue(kind, after))}</strong></dd>
            </div>`;
    }

    function releasePreviewMarkup(preview) {
        return `
            <section class="teacher-natural-dialog__surface">
                <header><div><span>RELEASE PREVIEW</span><h2 id="teacher-natural-dialog-title" data-teacher-dialog-title tabindex="-1">预览本次安排</h2></div><button type="button" data-teacher-dialog-close aria-label="关闭安排预览">关闭</button></header>
                <p class="teacher-natural-dialog__notice">${escapeHtml(preview.classLabel)} · ${escapeHtml(preview.courseLabel)} · 当前版本 v${preview.expectedVersion}</p>
                <ol class="teacher-release-preview-list">
                    ${preview.items.map(item => `
                        <li data-preview-unit="${item.courseUnitId}">
                            <strong>${escapeHtml(item.label)}</strong>
                            <dl>
                                ${releasePreviewField('顺序', 'position', item.before.position, item.after.position)}
                                ${releasePreviewField('呈现', 'releaseMode', item.before.releaseMode, item.after.releaseMode)}
                                ${releasePreviewField('开放时间', 'openAt', item.before.openAt, item.after.openAt)}
                                ${releasePreviewField('前置分块', 'prerequisiteLabel', item.before.prerequisiteLabel, item.after.prerequisiteLabel)}
                            </dl>
                        </li>`).join('')}
                </ol>
                <dl class="teacher-release-preview-reason"><dt>调整说明</dt><dd>${escapeHtml(preview.reason || '未填写')}</dd></dl>
                <p>确认后只发送一次 PATCH；2xx、冲突或结果不明都会重新读取权威安排，不会自动重发。</p>
                <footer><button type="button" data-teacher-dialog-close>返回调整</button><button type="button" data-teacher-release-confirm>确认并发布</button></footer>
            </section>`;
    }

    function normalizeReleasePreviewState(raw) {
        const position = positiveInteger(raw && raw.position);
        const releaseMode = String(raw && raw.releaseMode || '');
        const openAt = raw && raw.openAt == null ? null : String(raw.openAt);
        const prerequisiteLabel = String(raw && raw.prerequisiteLabel || '').slice(0, 240);
        if (!position || !RELEASE_STATES.has(releaseMode) || openAt !== null && !Number.isFinite(new Date(openAt).getTime())) return null;
        return Object.freeze({ position, releaseMode, openAt, prerequisiteLabel });
    }

    function confirmReleasePlan(rawPreview) {
        const session = active;
        if (!session || session.destroyed || session.releaseResolver) return Promise.resolve(false);
        const snapshot = normalizeSnapshot(session);
        const unitIds = new Set();
        const items = rawPreview && Array.isArray(rawPreview.items)
            ? rawPreview.items.map(item => ({
                courseUnitId: positiveInteger(item && item.courseUnitId),
                label: String(item && item.label || '').slice(0, 240),
                before: normalizeReleasePreviewState(item && item.before),
                after: normalizeReleasePreviewState(item && item.after)
            }))
            : [];
        const preview = {
            classId: positiveInteger(rawPreview && rawPreview.classId),
            courseId: positiveInteger(rawPreview && rawPreview.courseId),
            classLabel: String(rawPreview && rawPreview.classLabel || '').slice(0, 160),
            courseLabel: String(rawPreview && rawPreview.courseLabel || '').slice(0, 240),
            expectedVersion: positiveInteger(rawPreview && rawPreview.expectedVersion),
            reason: String(rawPreview && rawPreview.reason || '').slice(0, 4000),
            items
        };
        if (
            preview.classId !== snapshot.classId
            || preview.courseId !== snapshot.courseId
            || !preview.expectedVersion
            || !items.length || items.length > 100
            || items.some(item => {
                const duplicate = !item.courseUnitId || unitIds.has(item.courseUnitId);
                unitIds.add(item.courseUnitId);
                return duplicate || !item.label || !item.before || !item.after;
            })
        ) return Promise.resolve(false);
        return new Promise(resolve => {
            session.releaseResolver = resolve;
            openDialog(session, releasePreviewMarkup(preview), global.document.activeElement, 'release');
        });
    }

    function closest(target, selector) {
        return target && typeof target.closest === 'function' ? target.closest(selector) : null;
    }

    function handleClick(session, event) {
        const target = event.target;
        const close = closest(target, '[data-teacher-dialog-close]');
        if (close) {
            closeDialog(session);
            return;
        }
        const confirm = closest(target, '[data-teacher-release-confirm]');
        if (confirm && session.releaseResolver) {
            const resolve = session.releaseResolver;
            session.releaseResolver = null;
            closeDialog(session);
            resolve(true);
            return;
        }
        const refreshButton = closest(target, '[data-teacher-natural-refresh]');
        if (refreshButton) {
            refreshSession(session);
            return;
        }
        const previewButton = closest(target, '[data-teacher-student-preview]');
        if (previewButton) {
            const row = studentRow(session, positiveInteger(previewButton.dataset.teacherStudentPreview));
            if (row) openDialog(session, studentPreviewMarkup(row), previewButton, 'student');
            return;
        }
        const evidenceButton = closest(target, '[data-teacher-student-evidence]');
        if (evidenceButton) {
            loadEvidence(session, positiveInteger(evidenceButton.dataset.teacherStudentEvidence), {
                trigger: evidenceButton
            });
            return;
        }
        const pageButton = closest(target, '[data-teacher-natural-page]');
        if (pageButton && !pageButton.disabled) {
            const offset = Math.max(0, Number(pageButton.dataset.offset) || 0);
            if (pageButton.dataset.teacherNaturalPage === 'progress') {
                refreshSession(session, { offset });
            } else if (pageButton.dataset.teacherNaturalPage === 'evidence' && session.selectedStudentId) {
                loadEvidence(session, session.selectedStudentId, { offset, trigger: session.returnFocus });
            }
            return;
        }
        const retry = closest(target, '[data-teacher-evidence-retry]');
        if (retry && session.selectedStudentId) {
            loadEvidence(session, session.selectedStudentId, { trigger: session.returnFocus });
        }
    }

    function handleSubmit(session, event) {
        const filters = closest(event.target, '[data-teacher-evidence-filters]');
        if (filters) {
            event.preventDefault();
            applyEvidenceFilters(session, filters);
            return;
        }
        const form = closest(event.target, '[data-teacher-evidence-correction]');
        if (!form) return;
        event.preventDefault();
        submitCorrection(session, form);
    }

    function handleScopeChange(session, event) {
        const target = event.target;
        if (!target || typeof target.matches !== 'function' || !target.matches(
            '[data-teacher-scope="schoolId"], [data-teacher-scope="classId"], [data-teacher-scope="courseId"]'
        )) return;
        if (session.correctionInFlight) return;
        clearWorkflowState(session, 'explicit_scope_required');
        session.scopeKey = '';
        render(session);
        schedule(session, 0, true);
    }

    function evaluate(session) {
        if (!session || session !== active || session.destroyed) return;
        const snapshot = normalizeSnapshot(session);
        const key = scopeKey(snapshot);
        render(session);
        if (session.authorityReady && (key !== session.scopeKey || snapshot.attached !== session.consumedAttachment)) {
            schedule(session, 0, true);
        }
    }

    function blockForAuthority(session) {
        if (!session || session !== active || session.destroyed) return;
        session.authorityReady = false;
        clearTimer(session);
        clearWorkflowState(session, 'identity_required');
        render(session);
    }

    function restoreAuthority(session) {
        if (!session || session !== active || session.destroyed) return;
        session.authorityReady = true;
        clearWorkflowState(session, '');
        schedule(session, 0, true);
    }

    function mount(root, bridge) {
        destroy();
        if (!root || typeof root.querySelectorAll !== 'function') return null;
        const session = {
            root,
            bridge: bridge || {},
            destroyed: false,
            authorityReady: true,
            generation: 0,
            evidenceGeneration: 0,
            scopeKey: '',
            consumedAttachment: null,
            phase: 'idle',
            errorCode: '',
            progress: null,
            aggregate: null,
            progressOffset: 0,
            progressError: '',
            aggregateError: '',
            pendingRender: false,
            controller: null,
            evidenceController: null,
            correctionController: null,
            correctionInFlight: false,
            evidencePage: null,
            evidenceError: '',
            evidenceStatus: '',
            evidenceStatusType: '',
            selectedStudentId: 0,
            selectedStudentLabel: '',
            evidenceFilters: { activityKey: '', eventType: '' },
            eventTokens: new Map(),
            renderRevision: 0,
            timer: 0,
            observer: null,
            unsubscribe: null,
            dialog: null,
            dialogMode: '',
            dialogCloseRequested: false,
            returnFocus: null,
            releaseResolver: null,
            onClick: null,
            onSubmit: null,
            onChange: null,
            onDocumentKeydown: null,
            dialogCaptureBound: false
        };
        active = session;
        session.onClick = event => handleClick(session, event);
        session.onSubmit = event => handleSubmit(session, event);
        session.onChange = event => handleScopeChange(session, event);
        root.addEventListener('click', session.onClick);
        root.addEventListener('submit', session.onSubmit);
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
            const snapshot = normalizeSnapshot(session);
            const scope = change && (change.projection || change);
            if (
                session.authorityReady
                && change
                && change.type === 'confirmed'
                && scope
                && Number(scope.class_id) === snapshot.classId
                && Number(scope.course_id) === snapshot.courseId
            ) schedule(session, 0);
        });
        schedule(session, 0, true);
        return Object.freeze({ destroy, refresh });
    }

    function refresh() {
        if (!active) return Promise.resolve(false);
        return Promise.resolve(refreshSession(active)).then(() => true);
    }

    function clearScope() {
        if (!active || active.destroyed) return false;
        clearWorkflowState(active, 'explicit_scope_required');
        render(active);
        return true;
    }

    function isMutationPending() {
        return Boolean(active && !active.destroyed && active.correctionInFlight);
    }

    function destroy() {
        const session = active;
        if (!session) return;
        active = null;
        session.destroyed = true;
        session.authorityReady = false;
        session.generation += 1;
        session.evidenceGeneration += 1;
        clearTimer(session);
        clearController(session, 'controller');
        clearController(session, 'evidenceController');
        clearController(session, 'correctionController');
        notifyMutation(session, false);
        closeDialog(session, { restoreFocus: false });
        if (session.observer) session.observer.disconnect();
        if (session.unsubscribe) session.unsubscribe();
        if (session.dialog) {
            session.dialog.remove();
        }
        if (session.root) {
            session.root.removeEventListener('click', session.onClick);
            session.root.removeEventListener('submit', session.onSubmit);
            session.root.removeEventListener('change', session.onChange);
        }
        session.eventTokens.clear();
        session.dialog = null;
        session.root = null;
        session.bridge = null;
    }

    global.AstraTeacherLearningEvidence = Object.freeze({
        mount,
        refresh,
        clearScope,
        isMutationPending,
        confirmReleasePlan,
        destroy,
        pollMs: POLL_MS
    });
})(window);
