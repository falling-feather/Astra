(function (global) {
    'use strict';

    if (global.AstraRoleHomeClient) return;

    const NEXT_ACTIVITY_STATUSES = new Set(['not_started', 'in_progress']);
    const ROLE_COPY = Object.freeze({
        student: Object.freeze({ eyebrow: 'LEARNER PRIORITY', title: '当前首要学习任务', action: '进入我的学习' }),
        teacher: Object.freeze({ eyebrow: 'TEACHING PRIORITY', title: '当前首要教学事项', action: '进入教学工作台' }),
        admin: Object.freeze({ eyebrow: 'GOVERNANCE PRIORITY', title: '当前首要治理事项', action: '进入全局治理' })
    });
    const state = {
        root: null,
        host: null,
        user: null,
        phase: 'idle',
        generation: 0,
        pendingRefreshGeneration: 0,
        controller: null,
        classes: [],
        courses: [],
        schools: [],
        selected: { school_id: '', class_id: '', course_id: '' },
        task: null,
        issue: null,
        syncIssue: null,
        recovery: null,
        aggregate: null,
        pending: null,
        unsubscribe: null,
        clickHandler: null,
        changeHandler: null
    };

    function api() {
        if (!global.AstraApiClient) throw new Error('AstraApiClient unavailable');
        return global.AstraApiClient;
    }

    function evidence() {
        if (!global.AstraLearningEvidenceClient) throw new Error('AstraLearningEvidenceClient unavailable');
        return global.AstraLearningEvidenceClient;
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function list(payload) {
        if (Array.isArray(payload)) return payload;
        return payload && Array.isArray(payload.items) ? payload.items : [];
    }

    function positiveId(value) {
        const id = Number(value);
        return Number.isInteger(id) && id > 0 ? id : 0;
    }

    function begin() {
        if (state.controller) state.controller.abort();
        state.controller = new AbortController();
        state.generation += 1;
        return {
            generation: state.generation,
            controller: state.controller,
            signal: state.controller.signal
        };
    }

    function current(scope) {
        return Boolean(scope && scope.generation === state.generation && scope.controller === state.controller && !scope.signal.aborted);
    }

    function resetData() {
        state.phase = 'loading';
        state.pendingRefreshGeneration += 1;
        state.classes = [];
        state.courses = [];
        state.schools = [];
        state.selected = { school_id: '', class_id: '', course_id: '' };
        state.task = null;
        state.issue = null;
        state.syncIssue = null;
        state.recovery = null;
        state.aggregate = null;
        state.pending = null;
    }

    function normalizedError(error) {
        return global.AstraLearningEvidenceClient && typeof global.AstraLearningEvidenceClient.normalizeError === 'function'
            ? global.AstraLearningEvidenceClient.normalizeError(error)
            : error;
    }

    function issue(code, message) {
        state.issue = Object.freeze({ code, message });
    }

    function evidenceAuthorityIssue(change) {
        if (!change || change.type !== 'authority-cleared') return null;
        return Object.freeze({
            code: 'identity_required',
            message: '登录身份或角色已变化；请重新登录后再核对首要任务与未同步状态。'
        });
    }

    function classLabel(item) {
        return [item && (item.name || item.title || `班级 ${item.id}`), item && item.grade, item && item.term]
            .filter(Boolean).join(' · ');
    }

    function courseLabel(item) {
        return item && (item.title || item.name || item.course_key || `课程 ${item.id}`);
    }

    function schoolLabel(item) {
        return item && (item.name || item.title || `学校 ${item.id}`);
    }

    function optionMarkup(items, selected, labeler, placeholder) {
        const hasSelection = Boolean(String(selected || '').trim());
        const options = [`<option value=""${hasSelection ? ' disabled' : ' selected'}>${escapeHtml(placeholder)}</option>`];
        items.forEach(item => {
            const id = String(item.id);
            options.push(`<option value="${escapeHtml(id)}"${String(selected) === id ? ' selected' : ''}>${escapeHtml(labeler(item))}</option>`);
        });
        return options.join('');
    }

    function assignmentTask(item) {
        if (!item) return null;
        const assignment = item.assignment && typeof item.assignment === 'object' ? item.assignment : item;
        const due = assignment.due_at || assignment.deadline || item.due_at || '';
        const dueAt = due ? new Date(due) : null;
        const dueValid = Boolean(dueAt && Number.isFinite(dueAt.getTime()));
        const submitted = Boolean(submissionOf(item));
        const blocked = item.read_only || item.can_submit === false;
        const overdue = Boolean(!submitted && !blocked && dueValid && dueAt.getTime() < Date.now());
        return Object.freeze({
            code: submitted ? 'ASSIGNMENT · SUBMITTED' : blocked ? 'ASSIGNMENT · LOCKED' : overdue ? 'ASSIGNMENT · OVERDUE' : 'ASSIGNMENT · ACTIVE',
            title: assignment.title || assignment.name || '待完成作业',
            detail: !due ? '无截止时间' : dueValid
                ? `${overdue ? '已逾期 · 截止' : '截止'} ${dueAt.toLocaleString('zh-CN')}`
                : '截止时间格式异常，请进入工作区核对。',
            meta: submitted ? '该任务已有权威提交记录，可在工作区查看结果。' : blocked ? '当前任务已锁定或不可提交，请在工作区查看原因。' : '任务事实来自当前班级与课程的权威作业列表。',
            href: '#student',
            action: '进入我的学习核对'
        });
    }

    function submissionOf(item) {
        return item && (item.submission || item.latest_submission || item.submitted_at);
    }

    function assignmentDue(item) {
        const assignment = item && item.assignment && typeof item.assignment === 'object' ? item.assignment : item;
        const value = assignment && (assignment.due_at || assignment.deadline) || item && item.due_at;
        const time = value ? new Date(value).getTime() : Number.POSITIVE_INFINITY;
        return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
    }

    function primaryAssignment(items) {
        const active = items.filter(item => !submissionOf(item) && item.can_submit !== false && !item.read_only);
        active.sort((left, right) => assignmentDue(left) - assignmentDue(right)
            || positiveId((left.assignment || left).id) - positiveId((right.assignment || right).id));
        return active[0] || null;
    }

    function recoveryTask(response, units, course) {
        const resume = response && response.resume;
        if (!resume) return null;
        const activity = list(response.activities).find(item => (
            item.course_unit_id === resume.course_unit_id
            && item.activity_key === resume.activity_key
            && item.rule_version === resume.rule_version
        ));
        if (!activity || !NEXT_ACTIVITY_STATUSES.has(activity.status)) return null;
        const unit = list(units).find(item => (
            positiveId(item && item.id) === resume.course_unit_id
            && item.activity_key === resume.activity_key
        ));
        const catalog = global.AstraLearningActivityCatalog;
        const mapping = catalog && course && typeof catalog.resolve === 'function'
            ? catalog.resolve(course.galaxy_key, resume.activity_key)
            : null;
        const href = mapping
            && mapping.course_key === course.course_key
            && typeof catalog.recoveryHref === 'function'
            ? catalog.recoveryHref(mapping, unit)
            : '';
        if (!unit || !href) return null;
        return Object.freeze({
            code: 'SCOPED RECOVERY',
            title: unit.title || courseLabel(course),
            detail: '仅恢复当前明确班级与课程中的权威学习位置。',
            meta: `规则版本 ${resume.rule_version} · 服务端记录于 ${new Date(resume.last_occurred_at).toLocaleString('zh-CN')}`,
            href,
            action: '继续本课程'
        });
    }

    function primaryOpenUnit(items, recovery) {
        const projections = list(recovery && recovery.activities);
        return items
            .filter(item => (
                item
                && item.effective_release_state === 'open'
                && item.status !== 'archived'
                && positiveId(item.id)
            ))
            .filter(item => {
                const activity = projections.find(projection => (
                    Number(projection.course_unit_id) === Number(item.id)
                    && projection.activity_key === item.activity_key
                ));
                return !activity || NEXT_ACTIVITY_STATUSES.has(activity.status);
            })
            .slice()
            .sort((left, right) => Number(left.position || Number.MAX_SAFE_INTEGER) - Number(right.position || Number.MAX_SAFE_INTEGER)
                || positiveId(left.id) - positiveId(right.id))[0] || null;
    }

    function openUnitTask(unit, course) {
        if (!unit || !course) return null;
        const catalog = global.AstraLearningActivityCatalog;
        const mapping = catalog && typeof catalog.resolve === 'function'
            ? catalog.resolve(course.galaxy_key, unit.activity_key)
            : null;
        const href = mapping
            && mapping.course_key === course.course_key
            && typeof catalog.recoveryHref === 'function'
            ? catalog.recoveryHref(mapping, unit)
            : '';
        if (!href) return null;
        return Object.freeze({
            code: 'COURSE UNIT · OPEN',
            title: unit.title || courseLabel(course),
            detail: '当前班级与课程发布计划中的首个开放单元。',
            meta: `权威发布状态：open · ${courseLabel(course)}`,
            href,
            action: '开始学习'
        });
    }

    async function loadStudent(scope) {
        const classes = list(await api().request('/api/classes', {
            params: { mine: true },
            signal: scope.signal
        }));
        if (!current(scope)) return;
        state.classes = classes;
        if (!classes.length) {
            state.phase = 'empty';
            issue('class_scope_missing', '你尚未加入可用班级；请先通过“我的学习”加入班级。');
            return;
        }
        if (classes.length === 1) {
            state.selected.class_id = String(classes[0].id);
            await loadStudentClass(scope, classes[0].id);
            return;
        }
        state.phase = 'scope-required';
        issue('class_selection_required', '你有多个班级，请先明确选择本次学习班级。');
    }

    async function loadStudentClass(scope, classId) {
        const courses = list(await api().request('/api/courses', {
            params: { class_id: classId },
            signal: scope.signal
        }));
        if (!current(scope)) return;
        state.courses = courses;
        state.selected.course_id = '';
        state.task = null;
        state.recovery = null;
        if (!courses.length) {
            state.phase = 'empty';
            issue('course_scope_missing', '当前班级尚未发布可用课程，请联系教师。');
            return;
        }
        if (courses.length === 1) {
            state.selected.course_id = String(courses[0].id);
            await loadStudentScope(scope, classId, courses[0].id);
            return;
        }
        state.phase = 'scope-required';
        issue('course_selection_required', '当前班级有多个课程，请明确选择后再恢复学习。');
    }

    async function loadStudentScope(scope, classId, courseId) {
        state.phase = 'loading';
        state.issue = null;
        const pendingRefreshGeneration = ++state.pendingRefreshGeneration;
        const [assignmentsResult, recoveryResult, pendingResult, unitsResult] = await Promise.allSettled([
            api().request('/api/assignments/me', {
                params: { class_id: classId, course_id: courseId, filter: 'active', limit: 200, offset: 0 },
                signal: scope.signal
            }),
            evidence().recovery({ class_id: classId, course_id: courseId }, { signal: scope.signal }),
            evidence().pendingSummary(),
            api().request(`/api/courses/${courseId}/units`, {
                params: { class_id: classId },
                signal: scope.signal
            })
        ]);
        if (!current(scope)) return;
        if (pendingRefreshGeneration === state.pendingRefreshGeneration) {
            if (pendingResult.status === 'fulfilled') {
                state.pending = pendingResult.value;
                state.syncIssue = null;
            } else {
                state.syncIssue = Object.freeze({
                    code: 'sync_state_unavailable',
                    message: '未同步证据数量暂时无法读取；页面不会把未知状态显示为已同步。'
                });
            }
        }
        if (assignmentsResult.status !== 'fulfilled') {
            state.task = null;
            issue('assignment_source_unavailable', '权威作业列表暂时无法读取，无法安全判断当前首要学习任务；请重试。');
            state.phase = 'empty';
            return;
        }
        if (recoveryResult.status === 'fulfilled') {
            state.recovery = recoveryResult.value;
        } else {
            const error = normalizedError(recoveryResult.reason);
            issue(error.code || 'recovery_unavailable', error.code === 'rule_binding_missing'
                ? '当前课程尚未绑定学习证据规则；教师完成发布后即可记录与恢复。'
                : '当前课程的权威恢复投影暂不可用，请稍后重试。');
        }
        const assignments = assignmentsResult.status === 'fulfilled' ? list(assignmentsResult.value) : [];
        const units = recoveryResult.status === 'fulfilled' && unitsResult.status === 'fulfilled'
            ? list(unitsResult.value)
            : [];
        const course = state.courses.find(item => positiveId(item.id) === courseId) || null;
        const assignment = assignmentTask(primaryAssignment(assignments));
        const recovery = assignment ? null : recoveryTask(state.recovery, units, course);
        if (!assignment && state.recovery && state.recovery.resume && !recovery) {
            state.task = null;
            issue('recovery_route_unavailable', '服务端续学位置无法与当前发布单元和安全深链对应；请进入“我的学习”核对，不会回退到其他课程。');
        } else {
            state.task = assignment || recovery || openUnitTask(primaryOpenUnit(units, state.recovery), course);
        }
        if (
            !state.task
            && recoveryResult.status === 'fulfilled'
            && unitsResult.status !== 'fulfilled'
        ) {
            issue('course_units_unavailable', '课程发布单元暂时无法读取，无法确认下一项开放学习；请重试。');
        }
        if (!state.task && !state.issue) issue('no_authoritative_task', '当前明确作用域内没有待办任务或可恢复位置。');
        state.phase = state.task ? 'ready' : 'empty';
    }

    async function loadTeacher(scope) {
        const schools = list(await api().request('/api/schools', { signal: scope.signal }));
        if (!current(scope)) return;
        state.schools = schools;
        if (!schools.length) {
            state.phase = 'empty';
            issue('school_scope_missing', '当前账号没有可管理学校，请联系管理员分配教学范围。');
            return;
        }
        if (schools.length === 1) {
            state.selected.school_id = String(schools[0].id);
            await loadTeacherSchool(scope, schools[0].id);
            return;
        }
        state.phase = 'scope-required';
        issue('school_selection_required', '你有多个学校范围，请先明确选择本次教学学校。');
    }

    async function loadTeacherSchool(scope, schoolId) {
        const classesResult = await api().request('/api/classes', {
            params: { school_id: schoolId, mine: true },
            signal: scope.signal
        });
        if (!current(scope)) return;
        state.classes = list(classesResult);
        state.courses = [];
        state.selected.class_id = state.classes.length === 1 ? String(state.classes[0].id) : '';
        state.selected.course_id = '';
        if (!state.classes.length) {
            state.phase = 'empty';
            issue('class_scope_missing', '当前学校尚无可教学班级；请先在教学工作台建立或加入班级。');
            return;
        }
        if (!state.selected.class_id) {
            state.phase = 'scope-required';
            issue('teaching_scope_selection_required', '请明确选择本人任教班级后查看挂接课程。');
            return;
        }
        await loadTeacherClass(scope, state.selected.class_id);
    }

    async function loadTeacherClass(scope, classId) {
        const courses = list(await api().request('/api/courses', {
            params: { class_id: classId },
            signal: scope.signal
        }));
        if (!current(scope)) return;
        state.courses = courses;
        state.selected.course_id = courses.length === 1 ? String(courses[0].id) : '';
        if (!courses.length) {
            state.phase = 'empty';
            issue('course_scope_missing', '当前任教班级尚未挂接课程，请先在教学工作台完成课程挂接。');
            return;
        }
        if (!state.selected.course_id) {
            state.phase = 'scope-required';
            issue('course_selection_required', '当前班级挂接了多个课程，请明确选择本次教学课程。');
            return;
        }
        await loadTeacherScope(scope, classId, state.selected.course_id);
    }

    async function loadTeacherScope(scope, classId, courseId) {
        state.phase = 'loading';
        state.issue = null;
        const [aggregateResult, reviewResult] = await Promise.allSettled([
            evidence().teacherAggregate({ class_id: classId, course_id: courseId }, { signal: scope.signal }),
            api().request('/api/admin/submissions/pending', {
                params: { class_id: classId, course_id: courseId, limit: 1, offset: 0 },
                signal: scope.signal
            })
        ]);
        if (!current(scope)) return;
        if (aggregateResult.status === 'fulfilled') state.aggregate = aggregateResult.value;
        else {
            const error = normalizedError(aggregateResult.reason);
            issue(error.code || 'aggregate_unavailable', error.code === 'rule_binding_missing'
                ? '当前课程尚未绑定学习证据规则；请在既有课程发布流程中完成规则配置。'
                : '当前教学范围的权威学习汇总暂不可用。');
        }
        if (reviewResult.status !== 'fulfilled') {
            state.task = null;
            issue('review_source_unavailable', '权威待处理提交列表暂时无法读取，无法安全判断当前首要教学事项；请重试。');
            state.phase = 'empty';
            return;
        }
        const review = list(reviewResult.value)[0] || null;
        state.task = review ? Object.freeze({
            code: 'REVIEW · PENDING',
            title: review.assignment_title || review.title || '有一项提交等待处理',
            detail: '该事项来自当前明确班级与课程的待处理提交列表。',
            meta: state.aggregate ? `权威汇总更新时间 ${new Date(state.aggregate.generated_at).toLocaleTimeString('zh-CN')}` : '学习证据汇总暂不可用。',
            href: '#teacher',
            action: '处理教学事项'
        }) : state.aggregate ? Object.freeze({
            code: 'EVIDENCE · AGGREGATE',
            title: '查看当前课程学习证据汇总',
            detail: `当前作用域包含 ${Number(state.aggregate.active_students || 0)} 名活跃学习者。`,
            meta: `权威汇总更新时间 ${new Date(state.aggregate.generated_at).toLocaleTimeString('zh-CN')}`,
            href: '#teacher',
            action: '进入教学工作台'
        }) : null;
        if (!state.task && !state.issue) issue('no_teaching_task', '当前明确教学范围内没有待处理事项。');
        state.phase = state.task ? 'ready' : 'empty';
    }

    async function loadAdmin(scope) {
        const payload = await api().request('/api/admin/class-join-requests', {
            params: { status: 'pending', limit: 1, offset: 0 },
            signal: scope.signal
        });
        if (!current(scope)) return;
        const pending = list(payload)[0];
        state.task = pending ? Object.freeze({
            code: 'GOVERNANCE · PENDING',
            title: pending.class_name ? `处理 ${pending.class_name} 的加入申请` : '处理一项班级加入申请',
            detail: '该事项来自权威治理队列；申请人明细仅在治理工作区显示。',
            meta: '运维指标不占用星序首屏。',
            href: '#admin',
            action: '进入治理工作区'
        }) : null;
        if (!state.task) issue('no_governance_task', '当前没有待处理治理事项。');
        state.phase = state.task ? 'ready' : 'empty';
    }

    function changeMatchesSelectedScope(change) {
        const scope = change && (change.projection || change);
        const classId = positiveId(state.selected.class_id);
        const courseId = positiveId(state.selected.course_id);
        return Boolean(
            scope
            && classId
            && courseId
            && Number(scope.class_id) === classId
            && Number(scope.course_id) === courseId
        );
    }

    async function refreshPendingSummaryOnly() {
        if (!state.user) return false;
        const generation = state.generation;
        const user = state.user;
        const refreshGeneration = ++state.pendingRefreshGeneration;
        try {
            const pending = await evidence().pendingSummary();
            if (
                generation !== state.generation
                || user !== state.user
                || refreshGeneration !== state.pendingRefreshGeneration
            ) return false;
            state.pending = pending;
            state.syncIssue = null;
        } catch (_) {
            if (
                generation !== state.generation
                || user !== state.user
                || refreshGeneration !== state.pendingRefreshGeneration
            ) return false;
            state.syncIssue = Object.freeze({
                code: 'sync_state_unavailable',
                message: '未同步证据数量暂时无法读取；已保留上次计数，请重试核对。'
            });
        }
        render();
        return true;
    }

    async function refreshSelectedEvidenceScope(change) {
        if (
            !state.user
            || !['student', 'teacher'].includes(state.user.role)
            || !changeMatchesSelectedScope(change)
        ) return false;
        const classId = positiveId(state.selected.class_id);
        const courseId = positiveId(state.selected.course_id);
        const scope = begin();
        state.phase = 'loading';
        state.issue = null;
        state.task = null;
        if (state.user.role === 'student') {
            state.recovery = null;
        } else {
            state.aggregate = null;
        }
        render();
        try {
            if (state.user.role === 'student') await loadStudentScope(scope, classId, courseId);
            else await loadTeacherScope(scope, classId, courseId);
        } catch (error) {
            if (!current(scope) || api().isCancelled && api().isCancelled(error)) return false;
            const normalized = normalizedError(error);
            state.phase = 'error';
            issue(normalized.code || 'role_home_scope_refresh_failed', '当前明确作用域暂时无法刷新，请检查网络后重试。');
        }
        if (current(scope)) render();
        return current(scope);
    }

    async function load() {
        if (!state.user) return;
        const scope = begin();
        resetData();
        render();
        try {
            if (state.user.role === 'student') await loadStudent(scope);
            else if (state.user.role === 'teacher') await loadTeacher(scope);
            else if (state.user.role === 'admin') await loadAdmin(scope);
            else issue('role_not_supported', '当前身份没有星序任务首页。');
        } catch (error) {
            if (!current(scope) || api().isCancelled && api().isCancelled(error)) return;
            const normalized = normalizedError(error);
            state.phase = 'error';
            issue(normalized.code || 'role_home_unavailable', '首要任务暂时无法加载，请检查网络后重试。');
        }
        if (current(scope)) render();
    }

    async function choose(field, value) {
        const id = positiveId(value);
        if (!id || !state.user) return;
        const scope = begin();
        state.selected[field] = String(id);
        state.issue = null;
        state.task = null;
        state.phase = 'loading';
        render();
        try {
            if (state.user.role === 'student' && field === 'class_id') await loadStudentClass(scope, id);
            else if (state.user.role === 'student' && field === 'course_id') {
                await loadStudentScope(scope, positiveId(state.selected.class_id), id);
            } else if (state.user.role === 'teacher' && field === 'school_id') {
                await loadTeacherSchool(scope, id);
            } else if (state.user.role === 'teacher' && field === 'class_id') {
                await loadTeacherClass(scope, id);
            } else if (state.user.role === 'teacher' && field === 'course_id') {
                const classId = positiveId(state.selected.class_id);
                const courseId = positiveId(state.selected.course_id);
                if (classId && courseId) await loadTeacherScope(scope, classId, courseId);
                else {
                    state.phase = 'scope-required';
                    issue('teaching_scope_selection_required', '请同时明确班级与课程。');
                }
            }
        } catch (error) {
            if (!current(scope) || api().isCancelled && api().isCancelled(error)) return;
            state.phase = 'error';
            issue('scope_unavailable', '所选作用域暂不可用，请刷新后重试。');
        }
        if (current(scope)) render();
    }

    function controlsMarkup() {
        const controls = [];
        if (state.user && state.user.role === 'teacher' && state.schools.length) {
            controls.push(`<label><span>学校</span><select data-role-home-scope="school_id">${optionMarkup(state.schools, state.selected.school_id, schoolLabel, '请选择学校')}</select></label>`);
        }
        if (state.classes.length) {
            controls.push(`<label><span>班级</span><select data-role-home-scope="class_id">${optionMarkup(state.classes, state.selected.class_id, classLabel, '请选择班级')}</select></label>`);
        }
        if (state.courses.length) {
            controls.push(`<label><span>课程</span><select data-role-home-scope="course_id">${optionMarkup(state.courses, state.selected.course_id, courseLabel, '请选择课程')}</select></label>`);
        }
        return controls.length ? `<div class="planets-priority__scope" aria-label="明确任务作用域">${controls.join('')}</div>` : '';
    }

    function taskMarkup() {
        if (state.phase === 'loading') {
            return '<div class="planets-priority__empty" role="status">正在读取当前身份的权威首要任务…</div>';
        }
        if (state.task) {
            return `<article class="planets-priority__task">
                <span>${escapeHtml(state.task.code)}</span>
                <h3>${escapeHtml(state.task.title)}</h3>
                <p>${escapeHtml(state.task.detail)}</p>
                <small>${escapeHtml(state.task.meta)}</small>
                <a href="${escapeHtml(state.task.href)}">${escapeHtml(state.task.action)} <b aria-hidden="true">→</b></a>
            </article>`;
        }
        return state.issue ? '' : '<div class="planets-priority__empty"><strong>no_authoritative_task</strong><p>当前没有可显示的权威任务。</p><button type="button" data-role-home-retry>重新加载</button></div>';
    }

    function issueMarkup() {
        if (!state.issue) return '';
        return `<div class="planets-priority__issue" role="status"><strong>${escapeHtml(state.issue.code)}</strong><p>${escapeHtml(state.issue.message)}</p><button type="button" data-role-home-retry>重新核对</button></div>`;
    }

    function render() {
        if (!state.host || !state.user) return;
        const copy = ROLE_COPY[state.user.role] || ROLE_COPY.student;
        const sync = state.syncIssue
            ? `<div class="planets-priority__issue" role="status"><strong>${escapeHtml(state.syncIssue.code)}</strong><p>${escapeHtml(state.syncIssue.message)}</p><button type="button" data-role-home-pending-retry>重新核对</button></div>`
            : '';
        const pending = state.pending && Number(state.pending.count || 0) > 0
            ? `<p class="planets-priority__pending">有 ${Number(state.pending.count)} 条学习证据尚未同步；联网后会自动使用原事件编号对账。</p>`
            : '';
        state.host.innerHTML = `<div class="planets-section-heading"><h2>${escapeHtml(copy.title)}</h2><span>${escapeHtml(copy.eyebrow)}</span></div>${controlsMarkup()}${pending}${sync}${issueMarkup()}${taskMarkup()}`;
    }

    function mount(root, user) {
        destroy();
        state.root = root instanceof Element ? root : document.getElementById('page-planets');
        if (!state.root) return false;
        const intro = state.root.querySelector('.planets-intro');
        const host = document.createElement('section');
        host.className = 'planets-priority';
        host.dataset.astraRoleHome = 'true';
        host.setAttribute('aria-label', '当前身份首要任务');
        if (intro && intro.parentNode) intro.insertAdjacentElement('afterend', host);
        else state.root.querySelector('.planets-main')?.prepend(host);
        state.host = host;
        state.user = user || null;
        state.clickHandler = event => {
            const pendingRetry = event.target instanceof Element && event.target.closest('[data-role-home-pending-retry]');
            if (pendingRetry) {
                refreshPendingSummaryOnly();
                return;
            }
            const retry = event.target instanceof Element && event.target.closest('[data-role-home-retry]');
            if (retry) {
                const classId = positiveId(state.selected.class_id);
                const courseId = positiveId(state.selected.course_id);
                if (classId && courseId && state.user && ['student', 'teacher'].includes(state.user.role)) {
                    refreshSelectedEvidenceScope({ class_id: classId, course_id: courseId });
                } else {
                    load();
                }
            }
        };
        state.changeHandler = event => {
            const select = event.target instanceof Element && event.target.closest('[data-role-home-scope]');
            if (select) choose(select.dataset.roleHomeScope, select.value);
        };
        host.addEventListener('click', state.clickHandler);
        host.addEventListener('change', state.changeHandler);
        state.unsubscribe = evidence().subscribe(change => {
            const authorityIssue = evidenceAuthorityIssue(change);
            if (authorityIssue) {
                if (state.controller) state.controller.abort();
                state.controller = null;
                state.generation += 1;
                resetData();
                state.phase = 'blocked';
                state.issue = authorityIssue;
                render();
                return;
            }
            if (change && change.type === 'identity-configured') {
                load();
                return;
            }
            if (['confirmed', 'local-pending', 'syncing', 'manual-intervention'].includes(change.type)) {
                if (changeMatchesSelectedScope(change)) refreshSelectedEvidenceScope(change);
                else refreshPendingSummaryOnly();
            }
        });
        load();
        return true;
    }

    function setUser(user) {
        if (!state.host || !user) return false;
        if (state.user && String(state.user.id) === String(user.id) && state.user.role === user.role) return true;
        state.user = user;
        load();
        return true;
    }

    function destroy() {
        if (state.controller) state.controller.abort();
        state.controller = null;
        state.generation += 1;
        if (state.unsubscribe) state.unsubscribe();
        if (state.host && state.clickHandler) state.host.removeEventListener('click', state.clickHandler);
        if (state.host && state.changeHandler) state.host.removeEventListener('change', state.changeHandler);
        if (state.host && state.host.isConnected) state.host.remove();
        state.root = null;
        state.host = null;
        state.user = null;
        state.unsubscribe = null;
        state.clickHandler = null;
        state.changeHandler = null;
        resetData();
        state.phase = 'idle';
    }

    global.AstraRoleHomeClient = Object.freeze({
        mount,
        setUser,
        load,
        choose,
        destroy,
        snapshot: () => Object.freeze({
            phase: state.phase,
            role: state.user && state.user.role || '',
            scope: Object.freeze(Object.assign({}, state.selected)),
            issue: state.issue,
            task: state.task
        })
    });
})(window);
