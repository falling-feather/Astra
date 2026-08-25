(function () {
    'use strict';
    const TEACHER_ASSET_VERSION = '20260825v841CourseAuthoringP0', TEACHER_COURSE_AUTHORING_ASSET_VERSION = '20260825v841CourseAuthoringP0', API_BASE_STORAGE_KEY = 'astra-teacher-api-base';
    const TEACHER_VIEWS = Object.freeze({ overview: '教学总览', curriculum: '课程节奏', grading: '批改与学情' }); const RELEASE_MODES = Object.freeze(['open', 'locked', 'hidden']);
    const RELEASE_MODE_LABELS = Object.freeze({ open: '开放', locked: '锁定', hidden: '隐藏' }); const GALAXY_LABELS = Object.freeze({ englab: '工科试验室', 'code-space': '代码空间', 'future-galaxy': '未来星系' }); const RELEASE_REASON_LABELS = Object.freeze({ manual_locked: '教师锁定', scheduled: '等待开放时间', prerequisite_incomplete: '前置分块未完成' });
    const CODE_STATUS_LABELS = Object.freeze({
        queued: '排队中', runner_unavailable: '判题器未启用', running: '判题中', accepted: '通过',
        wrong_answer: '答案不符', partial: '部分通过', compile_error: '编译错误', runtime_error: '运行错误',
        time_limit: '运行超时', memory_limit: '内存超限', output_limit: '输出超限', internal_error: '判题异常',
        cancelled: '已取消'
    });
    const PENDING_SUBMISSION_PAGE_LIMIT = 50, CODE_SUBMISSION_PAGE_LIMIT = 100, MEMBER_PAGE_LIMIT = 50,
        ACTIVE_STUDENT_PAGE_LIMIT = 50, ASSIGNMENT_SUBMISSION_PAGE_LIMIT = 50, CODE_ATTEMPT_PAGE_LIMIT = 20;
    let courseAuthoringOwner = null, courseAuthoringResourceError = null, courseAuthoringLoadGeneration = 0;
    const state = {
        root: null, apiBase: '', initialized: false, active: false, online: navigator.onLine !== false,
        runtimeBound: false, mutationInFlight: false, evidenceMutationInFlight: false, lifecycleController: null, requestGeneration: 0,
        onOnline: null, onOffline: null, onAuthRequired: null, busy: false, user: null,
        activeView: 'overview', writeLock: null, releaseDraft: null,
        selected: { schoolId: '', classId: '', courseId: '', unitId: '', assignmentId: '', codeSubmissionId: '' },
        filters: { galaxyKey: '', memberRole: 'student', memberStatus: 'active', submissionStatus: 'submitted', codeStatus: '' },
        pagination: { memberOffset: 0, activeStudentOffset: 0, assignmentSubmissionOffset: 0, codeSubmissionsOffset: 0, codeAttemptOffset: 0 },
        data: {
            schools: [], classes: [], courses: [], units: [], assignments: [], members: [], membersPage: null,
            activeStudents: [], activeStudentsPage: null, submissions: [], assignmentSubmissions: [],
            assignmentSubmissionsPage: null, collaborators: [], collaboratorBatchResult: null, pointRule: null,
            assignmentClassPolicy: null, knowledge: null, studentBatchImportResult: null, curriculumAttached: false,
            releasePlan: null, codeSubmissions: null, codeSubmissionSource: null, codeSubmissionAttempts: [],
            codeSubmissionAttemptsPage: null
        },
        errors: {}, flash: null, learningEvidenceResourceError: null, learningEvidenceLoadGeneration: 0
    };
    function initTeacher() {
        state.root = document.querySelector('[data-teacher-workbench]');
        if (!state.root) return;
        state.active = true; state.online = navigator.onLine !== false;
        if (window.AstraApiClient) AstraApiClient.scrubLegacyTokens();
        state.apiBase = resolveApiBase(); renderShell(); mountTeacherLearningEvidence(); mountTeacherCourseAuthoring();
        if (!state.initialized) { bindEvents(); state.initialized = true; }
        bindRuntimeEvents();
        if (!state.online) {
            renderAuthError(AstraApiClient.offlineError()); refreshIcons(); return;
        }
        refreshAll();
    }
    function destroyTeacher() {
        state.active = false; state.learningEvidenceLoadGeneration += 1;
        if (window.AstraTeacherLearningEvidence) window.AstraTeacherLearningEvidence.destroy();
        courseAuthoringLoadGeneration += 1; if (courseAuthoringOwner) courseAuthoringOwner.destroy(); courseAuthoringOwner = null; courseAuthoringResourceError = null;
        invalidateRequests(); unbindRuntimeEvents(); clearWorkspace();
        setBusy(false); state.flash = null; state.learningEvidenceResourceError = null;
        if (state.root) {
            const authContainer = state.root.querySelector('[data-teacher-auth-state]');
            if (authContainer && window.AstraAuthUI) AstraAuthUI.unmount(authContainer);
            state.root.innerHTML = `
                <div class="teacher-empty">
                    <i data-lucide="loader-circle"></i>
                    <span>教师端已离开</span>
                </div>
            `;
        }
    }
    function learningEvidenceResourceIssue(error) {
        return Object.freeze({ code: String(error && error.code || 'learning_evidence_resource_failed'), message: '教师协同资源加载失败或超时；旧班级与课程数据没有保留。请重试加载。' });
    }
    function teacherLearningEvidenceResourceMarkup(issue) {
        return `
            <header class="teacher-natural-header"><div><span>RESOURCE FAIL-CLOSED</span><h3>学生进度与学习证据</h3></div></header>
            <div class="teacher-natural-state" role="alert"><strong>${escapeHtml(issue.code)}</strong><p>${escapeHtml(issue.message)}</p>
            <button type="button" class="astra-authority-summary__retry" data-teacher-evidence-resource-retry>重试加载学习证据</button></div>`;
    }
    function renderTeacherLearningEvidenceResourceState() {
        if (!state.root || !state.learningEvidenceResourceError) return;
        state.root.querySelectorAll('[data-teacher-natural-workflow]').forEach((container) => {
            delete container.dataset.teacherNaturalSignature; container.innerHTML = teacherLearningEvidenceResourceMarkup(state.learningEvidenceResourceError);
        });
    }
    function teacherWorkflowSnapshot() {
        const classGroup = selectedClass(), course = selectedCourse();
        return Object.freeze({
            role: state.user && state.user.role || '', online: state.online,
            curriculumAttached: state.data.curriculumAttached === true,
            classId: Number(state.selected.classId) || 0, courseId: Number(state.selected.courseId) || 0,
            classLabel: classGroup && classGroup.name || '', courseLabel: course && course.title || '', baseUrl: state.apiBase
        });
    }
    async function mountTeacherLearningEvidence() {
        const generation = ++state.learningEvidenceLoadGeneration; state.learningEvidenceResourceError = null;
        if (window.AstraTeacherLearningEvidence) window.AstraTeacherLearningEvidence.destroy();
        try {
            const loader = window.AstraLearningEvidenceLoader;
            if (!loader || typeof loader.ensure !== 'function') {
                const error = Object.assign(new Error('learning evidence loader unavailable'), { code: 'learning_evidence_loader_unavailable' });
                throw error;
            }
            await loader.ensure({ teacher: true });
            if (!state.active || generation !== state.learningEvidenceLoadGeneration) return false;
            if (!window.AstraTeacherLearningEvidence || typeof window.AstraTeacherLearningEvidence.mount !== 'function') {
                const error = Object.assign(new Error('teacher learning evidence owner unavailable'), { code: 'teacher_evidence_owner_unavailable' });
                throw error;
            }
            window.AstraTeacherLearningEvidence.mount(state.root, {
                snapshot: teacherWorkflowSnapshot,
                mutationState: (locked) => {
                    state.evidenceMutationInFlight = Boolean(locked); if (state.root) applyWriteAvailability();
                },
                lockWrite: (error, confirmed) => {
                    lockUnknownWrite('追加式纠正', error, confirmed);
                    if (state.root) { renderWriteLock(); applyWriteAvailability(); }
                }
            });
            return true;
        } catch (error) {
            if (!state.active || generation !== state.learningEvidenceLoadGeneration) return false;
            state.learningEvidenceResourceError = learningEvidenceResourceIssue(error); renderTeacherLearningEvidenceResourceState();
            console.warn('[TeacherWorkbench] teacher collaboration resource unavailable');
            return false;
        }
    }
    function teacherCourseAuthoringHost() {
        const snapshot = () => Object.freeze({ active: state.active, role: state.user && state.user.role || '', userId: state.user && state.user.id || 0, schoolId: state.selected.schoolId || '', schoolLabel: selectedSchool() && selectedSchool().name || '', online: state.online, blocked: Boolean(state.writeLock || !state.online || state.busy || state.mutationInFlight || state.evidenceMutationInFlight) });
        return Object.freeze({
            snapshot, request: (path, options) => fetchJson(path, options),
            beginMutation: (label) => { if (!canStartMutation(label)) return false; state.mutationInFlight = true; setBusy(true); return true; },
            endMutation: () => { state.mutationInFlight = false; setBusy(false); if (state.active) renderWorkspace(); },
            failMutation: (error, label) => handleMutationFailure(error, label), notify: (type, message) => setFlash(type, message)
        });
    }
    async function mountTeacherCourseAuthoring() {
        const generation = ++courseAuthoringLoadGeneration; courseAuthoringResourceError = null;
        try {
            await import(`./teacher-course-authoring.js?v=${TEACHER_COURSE_AUTHORING_ASSET_VERSION}`); if (!state.active || generation !== courseAuthoringLoadGeneration) return false;
            courseAuthoringOwner = window.AstraTeacherCourseAuthoring; if (!courseAuthoringOwner || typeof courseAuthoringOwner.mount !== 'function') throw new Error('课程创建向导入口不可用'); courseAuthoringOwner.mount(state.root, teacherCourseAuthoringHost());
            renderPanels(); applyWriteAvailability(); refreshIcons(); return true;
        } catch (error) {
            if (!state.active || generation !== courseAuthoringLoadGeneration) return false; courseAuthoringResourceError = error;
            renderPanels(); refreshIcons(); console.warn('[TeacherWorkbench] course authoring resource unavailable'); return false;
        }
    }
    function bindRuntimeEvents() {
        if (state.runtimeBound) return;
        state.onOnline = () => {
            state.online = true; if (state.active) refreshAll();
        };
        state.onOffline = () => {
            state.online = false; invalidateRequests(); setBusy(false); clearWorkspace();
            if (state.active) {
                renderAuthError(AstraApiClient.offlineError());
                setFlash('warning', '已隐藏旧教学数据；恢复网络后将重新读取后端状态');
                renderWorkspace();
            }
        };
        state.onAuthRequired = () => {
            invalidateRequests(); setBusy(false); clearWorkspace();
            if (state.active) {
                renderAuthError(new AstraApiClient.Error('登录状态已失效', { status: 401, code: 'unauthorized' }));
                renderWorkspace();
            }
        };
        window.addEventListener('online', state.onOnline);
        window.addEventListener('offline', state.onOffline);
        window.addEventListener('astra:api-auth-required', state.onAuthRequired);
        state.runtimeBound = true;
    }
    function unbindRuntimeEvents() {
        if (!state.runtimeBound) return;
        window.removeEventListener('online', state.onOnline);
        window.removeEventListener('offline', state.onOffline);
        window.removeEventListener('astra:api-auth-required', state.onAuthRequired);
        state.onOnline = null;
        state.onOffline = null;
        state.onAuthRequired = null;
        state.runtimeBound = false;
    }
    function renderShell() {
        state.root.innerHTML = `
            <header class="teacher-workbench__header">
                <div class="teacher-workbench__title">
                    <span class="teacher-workbench__eyebrow"><a href="#planets">星序</a><b>/</b>教学工作台</span>
                    <h1>教学工作台</h1>
                    <p>在一个工作台查看当前班课、安排课程节奏并处理学生反馈。</p>
                </div>
                <div class="teacher-workbench__actions">
                    <details class="teacher-connection-settings">
                        <summary><i data-lucide="server-cog"></i><span>连接设置</span></summary>
                        <label class="teacher-api-base"><span>API 来源</span><input type="url" data-teacher-api-base value="${escapeAttr(state.apiBase)}" placeholder="同源" autocomplete="off"></label>
                    </details>
                    <button type="button" class="teacher-icon-button" data-teacher-action="refresh" aria-label="刷新教师工作台">
                        <i data-lucide="refresh-cw"></i>
                        <span>刷新</span>
                    </button>
                </div>
            </header>
            <div class="teacher-auth-state" data-teacher-auth-state></div>
            <div class="teacher-write-lock" data-teacher-write-lock hidden role="alert"></div>
            <div class="teacher-flash" data-teacher-flash hidden></div>
            <div class="teacher-dashboard" data-teacher-dashboard hidden>
                <section class="teacher-focus-stage" data-teacher-focus-stage aria-labelledby="teacher-focus-title"></section><section class="teacher-summary-strip" data-teacher-kpis aria-label="教学运行摘要"></section>
                <section class="teacher-scope-wrap" data-teacher-scope-panel></section>
                <nav class="teacher-view-nav" role="tablist" aria-label="教师工作台分区">
                    ${Object.entries(TEACHER_VIEWS).map(([key, label]) => `
                        <button type="button" id="teacher-tab-${key}" role="tab" data-teacher-view="${key}" aria-controls="teacher-workbench-panel" aria-selected="${state.activeView === key}" tabindex="${state.activeView === key ? '0' : '-1'}" class="${state.activeView === key ? 'is-active' : ''}">${label}</button>
                    `).join('')}
                </nav>
                <section id="teacher-workbench-panel" class="teacher-panel-grid" data-teacher-panels role="tabpanel" aria-labelledby="teacher-tab-${state.activeView}"></section>
            </div>
        `;
        refreshIcons();
    }
    function bindEvents() {
        state.root.addEventListener('keydown', handleViewNavigationKeydown);
        state.root.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            const evidenceRetry = target.closest('[data-teacher-evidence-resource-retry]');
            if (evidenceRetry) {
                mountTeacherLearningEvidence();
                return;
            }
            const refreshButton = target.closest('[data-teacher-action="refresh"]');
            if (refreshButton) {
                if (state.busy) return;
                refreshAll({ clearWriteLock: true });
                return;
            }
            const viewButton = target.closest('[data-teacher-view], [data-teacher-view-target]');
            if (viewButton) {
                setActiveView(viewButton.dataset.teacherView || viewButton.dataset.teacherViewTarget);
                return;
            }
            const memberButton = target.closest('[data-teacher-member-status]');
            if (memberButton) {
                updateMemberStatus(memberButton);
                return;
            }
            const collaboratorButton = target.closest('[data-teacher-collaborator-status]');
            if (collaboratorButton) {
                updateCollaboratorStatus(collaboratorButton);
                return;
            }
            const policyResetButton = target.closest('[data-teacher-class-policy-reset]');
            if (policyResetButton) {
                resetAssignmentClassPolicy();
                return;
            }
            const planPresetButton = target.closest('[data-teacher-plan-preset]');
            if (planPresetButton) {
                applyReleasePlanPreset(planPresetButton.dataset.teacherPlanPreset);
                return;
            }
            const planResetButton = target.closest('[data-teacher-plan-reset]');
            if (planResetButton) {
                state.releaseDraft = null;
                renderPanels();
                applyWriteAvailability();
                refreshIcons();
                return;
            }
            const codeSubmissionButton = target.closest('[data-teacher-code-submission]');
            if (codeSubmissionButton) {
                selectCodeSubmission(codeSubmissionButton.dataset.teacherCodeSubmission);
                return;
            }
            const curriculumPageButton = target.closest('[data-teacher-curriculum-page]');
            if (curriculumPageButton) {
                changeCurriculumPage(
                    curriculumPageButton.dataset.teacherCurriculumPage,
                    curriculumPageButton.dataset.offset
                );
                return;
            }
        });
        state.root.addEventListener('submit', (event) => {
            const form = event.target;
            if (!(form instanceof HTMLFormElement) || !form.dataset.teacherForm) return;
            event.preventDefault();
            handleFormSubmit(form);
        });
        state.root.addEventListener('change', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) return;
            if (target.matches('[data-teacher-scope]')) {
                handleScopeChange(target);
                return;
            }
            if (target.matches('[data-teacher-filter]')) {
                handleFilterChange(target);
                return;
            }
            if (target.matches('[data-teacher-plan-field], [data-teacher-plan-reason]')) {
                markReleasePlanDraft(target);
                return;
            }
            if (target.matches('[data-teacher-api-base]')) {
                applyApiBaseChange(target);
            }
        });
        state.root.addEventListener('blur', (event) => {
            const target = event.target;
            if (target instanceof HTMLInputElement && target.matches('[data-teacher-api-base]')) {
                applyApiBaseChange(target);
            }
        }, true);
    }
    async function refreshAll(options) {
        if (!state.root || !state.active) return;
        const request = options || {};
        const previousIdentity = state.user && `${state.user.id}:${state.user.role}`;
        if (!previousIdentity) clearWorkspace();
        resetPagination();
        const generation = beginRequestGeneration();
        setBusy(true);
        state.user = null;
        renderAuthState('checking');
        hideDashboard();
        if (!state.online) {
            renderAuthError(AstraApiClient.offlineError());
            clearWorkspace();
            setBusy(false);
            renderWorkspace();
            return;
        }
        try {
            const user = await fetchJson('/api/users/me');
            if (!isCurrentRequest(generation)) return;
            if (previousIdentity && previousIdentity !== `${user.id}:${user.role}`) clearWorkspace();
            state.user = user;
            if (!['teacher', 'admin'].includes(user.role)) {
                renderAuthState('forbidden', user);
                clearWorkspace();
                return;
            }
            renderAuthState('ready', user);
            await loadSchools(undefined, generation);
            if (!isCurrentRequest(generation)) return;
            if (request.clearWriteLock) {
                if (hasWorkspaceErrors()) {
                    setFlash('warning', '权威数据尚未完整读取，写操作继续锁定；请恢复服务后再次刷新核对');
                } else {
                    state.writeLock = null;
                    const draft = releaseDraftForCurrentScope();
                    if (draft && state.data.releasePlan) {
                        state.releaseDraft = Object.assign({}, draft, { conflict: false, reconciled: true });
                    }
                }
            }
            showDashboard();
        } catch (error) {
            if (AstraApiClient.isCancelled(error) || !isCurrentRequest(generation)) return;
            renderAuthError(error);
            clearWorkspace();
        } finally {
            if (isCurrentRequest(generation)) {
                setBusy(false);
                renderWorkspace();
                refreshIcons();
            }
        }
    }
    async function loadSchools(preferredId, generation = state.requestGeneration) {
        if (!isCurrentRequest(generation)) return;
        let schools = [];
        let requestError = null;
        try {
            schools = await fetchJson('/api/schools');
        } catch (error) {
            requestError = error;
        }
        if (!isCurrentRequest(generation)) return;
        state.data.schools = requestError ? [] : schools;
        state.errors.schools = requestError;
        const schoolId = preferredId || state.selected.schoolId;
        state.selected.schoolId = normalizeSelectedId(schoolId, state.data.schools);
        if (!state.selected.schoolId && state.data.schools.length === 1) {
            state.selected.schoolId = String(state.data.schools[0].id);
        }
        await loadSchoolScope(generation);
    }
    async function loadSchoolScope(generation = state.requestGeneration) {
        if (!isCurrentRequest(generation)) return;
        resetBelow('school');
        if (!state.selected.schoolId) {
            renderWorkspace();
            return;
        }
        state.errors.classes = null;
        const schoolId = state.selected.schoolId;
        const classParams = { school_id: schoolId };
        if (state.user.role === 'teacher') classParams.mine = true;
        const classesResult = await Promise.resolve(fetchJson('/api/classes', { params: classParams }))
            .then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }));
        if (!isCurrentRequest(generation)) return;
        if (classesResult.status === 'fulfilled') state.data.classes = classesResult.value;
        else { state.data.classes = []; state.errors.classes = classesResult.reason; }
        state.selected.classId = normalizeSelectedId(state.selected.classId, state.data.classes);
        if (!state.selected.classId && state.data.classes.length === 1) state.selected.classId = String(state.data.classes[0].id);
        await loadClassCourses(generation);
        if (!isCurrentRequest(generation)) return;
        await Promise.all([loadClassScope(generation), loadCourseScope(generation)]);
        if (!isCurrentRequest(generation)) return;
        await loadCurriculumScope(generation);
        if (!isCurrentRequest(generation)) return;
        renderWorkspace();
    }
    async function loadClassCourses(generation = state.requestGeneration) {
        if (!isCurrentRequest(generation)) return;
        const previousCourseId = state.selected.courseId;
        state.data.courses = []; state.selected.courseId = ''; state.errors.courses = null;
        if (!state.selected.classId) return;
        try {
            state.data.courses = await fetchJson('/api/courses', { params: { class_id: state.selected.classId } });
        } catch (error) {
            if (isCurrentRequest(generation)) state.errors.courses = error; return;
        }
        if (!isCurrentRequest(generation)) return;
        const visibleCourses = filteredCourses();
        state.selected.courseId = normalizeSelectedId(previousCourseId, visibleCourses);
        if (!state.selected.courseId && visibleCourses.length === 1) state.selected.courseId = String(visibleCourses[0].id);
    }
    function captureCourseScope(generation = state.requestGeneration) { return Object.freeze({ generation, classId: String(state.selected.classId || ''), courseId: String(state.selected.courseId || '') }); }
    function isCurrentCourseScope(scope) { return Boolean(scope && scope.classId && scope.courseId && isCurrentRequest(scope.generation) && String(state.selected.classId) === scope.classId && String(state.selected.courseId) === scope.courseId); }
    function courseScopeSchemaError(code) { return Object.assign(new Error('课程范围分页未通过班级、课程或分页校验'), { code }); }
    function validateCourseScopedPage(payload, scope, limit, offset, errorCode) {
        const items = payload && payload.items, itemCount = Array.isArray(items) ? items.length : 0, consumed = offset + itemCount, ids = new Set(), next = payload && payload.next_offset, validItems = Array.isArray(items)
            && items.length <= limit && items.every((item) => item && Number.isInteger(item.id) && item.id > 0 && !ids.has(item.id)
                && String(item.class_id) === scope.classId && String(item.course_id) === scope.courseId && Boolean(ids.add(item.id)));
        if (!payload || !Number.isInteger(payload.total) || payload.total < 0 || payload.limit !== limit || payload.offset !== offset || !validItems || itemCount > payload.total || !(consumed === payload.total ? next === null : itemCount > 0 && consumed < payload.total && next === consumed)) throw courseScopeSchemaError(errorCode);
        return payload;
    }
    async function loadClassScope(generation = state.requestGeneration) {
        if (!isCurrentRequest(generation)) return;
        state.data.members = []; state.data.membersPage = null; state.data.activeStudents = []; state.data.activeStudentsPage = null;
        state.data.submissions = []; state.data.knowledge = null; state.errors.members = null; state.errors.activeStudents = null;
        state.errors.submissions = null; state.errors.knowledge = null;
        if (!state.selected.classId) return;
        const classId = state.selected.classId;
        const courseScope = captureCourseScope(generation), courseId = courseScope.courseId;
        const memberParams = { role: state.filters.memberRole || undefined, status: state.filters.memberStatus || undefined,
            limit: MEMBER_PAGE_LIMIT, offset: state.pagination.memberOffset };
        const submissionParams = { class_id: classId, course_id: courseId, status: state.filters.submissionStatus || undefined,
            limit: PENDING_SUBMISSION_PAGE_LIMIT, offset: 0 };
        const submissionsRequest = courseId
            ? fetchJson('/api/admin/submissions/pending', { params: submissionParams }).then((page) => validateCourseScopedPage(page, courseScope, PENDING_SUBMISSION_PAGE_LIMIT, 0, 'pending_submission_scope_invalid'))
            : Promise.resolve(null);
        const [membersResult, activeStudentsResult, submissionsResult, knowledgeResult] = await Promise.allSettled([
            fetchJson(`/api/classes/${classId}/members/page`, { params: memberParams }),
            fetchJson(`/api/classes/${classId}/members/page`, { params: { role: 'student', status: 'active',
                limit: ACTIVE_STUDENT_PAGE_LIMIT, offset: state.pagination.activeStudentOffset } }),
            submissionsRequest,
            fetchClassKnowledge(classId, courseId)
        ]);
        if (!isCurrentRequest(generation)) return;
        if (membersResult.status === 'fulfilled') {
            state.data.membersPage = membersResult.value;
            state.data.members = Array.isArray(membersResult.value.items) ? membersResult.value.items : [];
            state.pagination.memberOffset = Number(membersResult.value.offset) || 0;
        } else {
            state.errors.members = membersResult.reason;
        }
        if (activeStudentsResult.status === 'fulfilled') {
            state.data.activeStudentsPage = activeStudentsResult.value;
            state.data.activeStudents = Array.isArray(activeStudentsResult.value.items) ? activeStudentsResult.value.items : [];
            state.pagination.activeStudentOffset = Number(activeStudentsResult.value.offset) || 0;
        } else {
            state.errors.activeStudents = activeStudentsResult.reason;
        }
        if (courseId && isCurrentCourseScope(courseScope) && submissionsResult.status === 'fulfilled') {
            state.data.submissions = Array.isArray(submissionsResult.value.items) ? submissionsResult.value.items : [];
            state.data.submissions.total = submissionsResult.value.total || state.data.submissions.length;
        } else if (courseId && isCurrentCourseScope(courseScope)) {
            state.errors.submissions = submissionsResult.reason;
        }
        const knowledgeScopeCurrent = courseId ? isCurrentCourseScope(courseScope) : String(state.selected.classId) === String(classId);
        if (knowledgeScopeCurrent && knowledgeResult.status === 'fulfilled') {
            state.data.knowledge = knowledgeResult.value;
        } else if (knowledgeScopeCurrent) {
            state.errors.knowledge = knowledgeResult.reason;
        }
    }
    async function fetchClassKnowledge(classId, courseId = state.selected.courseId) {
        if (courseId) {
            const attachedCourses = await fetchJson('/api/courses', { params: { class_id: classId } });
            const attached = attachedCourses.some((course) => String(course.id) === String(courseId));
            if (!attached) return null;
        }
        return fetchJson(`/api/classes/${classId}/knowledge`, { params: courseId ? { course_id: courseId } : undefined });
    }
    async function loadCourseScope(generation = state.requestGeneration) {
        if (!isCurrentRequest(generation)) return;
        state.data.units = []; state.data.assignments = [];
        state.data.assignmentSubmissions = []; state.data.assignmentSubmissionsPage = null;
        state.data.collaborators = []; state.data.pointRule = null;
        state.errors.units = null; state.errors.assignments = null;
        state.errors.assignmentSubmissions = null; state.errors.collaborators = null; state.errors.pointRule = null;
        const courseScope = captureCourseScope(generation);
        if (!courseScope.classId || !courseScope.courseId) return;
        const courseId = courseScope.courseId;
        const [unitsResult, assignmentsResult, collaboratorsResult] = await Promise.allSettled([
            fetchJson(`/api/courses/${courseId}/units`),
            fetchJson(`/api/courses/${courseId}/assignments`, { params: { class_id: courseScope.classId } }),
            fetchJson(`/api/courses/${courseId}/collaborators`, { params: { status: 'all' } })
        ]);
        if (!isCurrentCourseScope(courseScope)) return;
        if (unitsResult.status === 'fulfilled') {
            state.data.units = unitsResult.value;
        } else {
            state.errors.units = unitsResult.reason;
        }
        if (assignmentsResult.status === 'fulfilled') {
            state.data.assignments = assignmentsResult.value;
        } else {
            state.errors.assignments = assignmentsResult.reason;
        }
        if (collaboratorsResult.status === 'fulfilled') {
            state.data.collaborators = collaboratorsResult.value;
        } else {
            state.errors.collaborators = collaboratorsResult.reason;
        }
        state.selected.unitId = normalizeSelectedId(state.selected.unitId, state.data.units);
        state.selected.assignmentId = normalizeSelectedId(state.selected.assignmentId, state.data.assignments);
        if (!state.selected.unitId && state.data.units.length) state.selected.unitId = String(state.data.units[0].id);
        if (!state.selected.assignmentId && state.data.assignments.length) state.selected.assignmentId = String(state.data.assignments[0].id);
        await loadAssignmentScope(generation);
    }
    async function loadAssignmentScope(generation = state.requestGeneration) {
        if (!isCurrentRequest(generation)) return;
        state.data.assignmentSubmissions = [];
        state.data.assignmentSubmissionsPage = null;
        state.data.pointRule = null;
        state.data.assignmentClassPolicy = null;
        state.errors.assignmentSubmissions = null;
        state.errors.pointRule = null;
        state.errors.assignmentClassPolicy = null;
        const courseScope = captureCourseScope(generation), selectedAssignmentId = String(state.selected.assignmentId || '');
        if (!selectedAssignmentId || !courseScope.classId || !courseScope.courseId) return;
        const assignmentId = Number(state.selected.assignmentId);
        const classId = Number(courseScope.classId);
        const offset = state.pagination.assignmentSubmissionOffset;
        const params = {
            class_id: classId,
            limit: ASSIGNMENT_SUBMISSION_PAGE_LIMIT,
            offset
        };
        const policyRequest = fetchJson(`/api/assignments/${assignmentId}/classes/${classId}/policy`);
        const [submissionsResult, ruleResult, policyResult] = await Promise.allSettled([
            fetchJson(`/api/assignments/${assignmentId}/submissions/page`, { params })
                .then((page) => validateAssignmentSubmissionPage(page, { assignmentId, classId, offset })),
            fetchJson(`/api/points/assignments/${assignmentId}/rule`),
            policyRequest
        ]);
        if (!isCurrentCourseScope(courseScope) || String(state.selected.assignmentId) !== selectedAssignmentId) return;
        if (submissionsResult.status === 'fulfilled') {
            state.data.assignmentSubmissionsPage = submissionsResult.value;
            state.data.assignmentSubmissions = Array.isArray(submissionsResult.value.items) ? submissionsResult.value.items : [];
            state.pagination.assignmentSubmissionOffset = Number(submissionsResult.value.offset) || 0;
        } else {
            state.errors.assignmentSubmissions = submissionsResult.reason;
        }
        if (ruleResult.status === 'fulfilled') {
            state.data.pointRule = ruleResult.value;
        } else {
            state.errors.pointRule = ruleResult.reason;
        }
        if (policyResult.status === 'fulfilled') {
            state.data.assignmentClassPolicy = policyResult.value;
        } else {
            state.errors.assignmentClassPolicy = policyResult.reason;
        }
    }
    function validSubmissionDate(value, nullable) { return nullable && value === null || typeof value === 'string' && Number.isFinite(new Date(value).getTime()); }
    function assignmentSubmissionSchemaError(confirmed) {
        return Object.assign(new Error('作业提交分页未通过范围或字段校验'), { code: 'assignment_submission_schema_invalid', confirmed: Boolean(confirmed) });
    }
    function validateAssignmentSubmissionPage(payload, scope, confirmed) {
        const items = payload && payload.items;
        const ids = new Set();
        const validItems = Array.isArray(items) && items.length <= ASSIGNMENT_SUBMISSION_PAGE_LIMIT && items.every((item) => {
            const valid = item && Number.isInteger(item.id) && item.id > 0 && !ids.has(item.id)
                && item.assignment_id === scope.assignmentId && item.class_id === scope.classId
                && Number.isInteger(item.student_id) && item.student_id > 0
                && ['submitted', 'graded', 'returned'].includes(item.status)
                && (item.score === null || Number.isInteger(item.score) && item.score >= 0 && item.score <= 1000)
                && (item.feedback === null || typeof item.feedback === 'string' && item.feedback.length <= 4000)
                && (item.graded_by_user_id === null || Number.isInteger(item.graded_by_user_id) && item.graded_by_user_id > 0)
                && validSubmissionDate(item.submitted_at, false) && validSubmissionDate(item.graded_at, true);
            if (valid) ids.add(item.id);
            return valid;
        });
        const next = payload && payload.next_offset;
        if (!payload || !Number.isInteger(payload.total) || payload.total < 0
            || payload.limit !== ASSIGNMENT_SUBMISSION_PAGE_LIMIT || payload.offset !== scope.offset
            || !validItems || items.length > payload.total || payload.offset + items.length > payload.total
            || !(next === null || Number.isInteger(next) && next > payload.offset && next <= payload.total)) throw assignmentSubmissionSchemaError(confirmed);
        return payload;
    }
    function scopedCodeSubmission(submissionId, scope) { const items = state.data.codeSubmissions && state.data.codeSubmissions.items; return Array.isArray(items) && items.find((item) => String(item.id) === String(submissionId) && String(item.class_id) === scope.classId && String(item.course_id) === scope.courseId); }
    function validateCodeAttemptPage(payload, submissionId, offset) { const items = payload && payload.items, itemCount = Array.isArray(items) ? items.length : 0, consumed = offset + itemCount, next = payload && payload.next_offset; if (!payload || !Number.isInteger(payload.total) || payload.total < 0 || payload.limit !== CODE_ATTEMPT_PAGE_LIMIT || payload.offset !== offset || !Array.isArray(items) || itemCount > CODE_ATTEMPT_PAGE_LIMIT || items.some((item) => !item || String(item.submission_id) !== String(submissionId)) || itemCount > payload.total || !(consumed === payload.total ? next === null : itemCount > 0 && consumed < payload.total && next === consumed)) throw courseScopeSchemaError('code_submission_attempt_scope_invalid'); return payload; }
    async function readSubmissionAuthority(scope, confirmed) {
        const page = validateAssignmentSubmissionPage(await fetchJson(`/api/assignments/${scope.assignmentId}/submissions/page`, {
            params: { class_id: scope.classId, limit: ASSIGNMENT_SUBMISSION_PAGE_LIMIT, offset: scope.offset }
        }), scope, confirmed);
        const record = page.items.find((item) => item.id === scope.submissionId);
        if (!record) throw assignmentSubmissionSchemaError(confirmed);
        state.data.assignmentSubmissionsPage = page; state.data.assignmentSubmissions = page.items;
        state.pagination.assignmentSubmissionOffset = page.offset;
        state.errors.assignmentSubmissions = null;
        return record;
    }
    async function loadCurriculumScope(generation = state.requestGeneration) {
        if (!isCurrentRequest(generation)) return;
        const courseScope = captureCourseScope(generation);
        state.data.curriculumAttached = false; state.data.releasePlan = null; state.data.codeSubmissions = null; state.data.codeSubmissionSource = null; state.data.codeSubmissionAttempts = []; state.data.codeSubmissionAttemptsPage = null;
        state.pagination.codeAttemptOffset = 0; state.selected.codeSubmissionId = '';
        state.errors.curriculumScope = null; state.errors.releasePlan = null; state.errors.codeSubmissions = null; state.errors.codeSubmissionSource = null; state.errors.codeSubmissionAttempts = null;
        if (!courseScope.classId || !courseScope.courseId) return;
        const classId = courseScope.classId, courseId = courseScope.courseId, codeOffset = state.pagination.codeSubmissionsOffset;
        let attachedCourses = [];
        try {
            attachedCourses = await fetchJson('/api/courses', { params: { class_id: classId } });
        } catch (error) {
            if (!isCurrentCourseScope(courseScope)) return;
            state.errors.curriculumScope = error;
            return;
        }
        if (!isCurrentCourseScope(courseScope)) return;
        state.data.curriculumAttached = attachedCourses.some((course) => String(course.id) === String(courseId));
        if (!state.data.curriculumAttached) return;
        const [planResult, codeResult] = await Promise.allSettled([
            fetchJson(`/api/courses/${courseId}/classes/${classId}/release-plan`),
            fetchJson('/api/code-submissions', { params: { class_id: classId, course_id: courseId,
                limit: CODE_SUBMISSION_PAGE_LIMIT, offset: codeOffset } }).then((page) => validateCourseScopedPage(
                page, courseScope, CODE_SUBMISSION_PAGE_LIMIT, codeOffset, 'code_submission_scope_invalid'))
        ]);
        if (!isCurrentCourseScope(courseScope)) return;
        if (planResult.status === 'fulfilled') {
            try {
                state.data.releasePlan = validateReleasePlanResponse(planResult.value, {
                    classId: Number(classId), courseId: Number(courseId)
                });
            } catch (error) {
                state.data.releasePlan = null;
                state.errors.releasePlan = error;
            }
        } else {
            state.errors.releasePlan = planResult.reason;
        }
        if (codeResult.status === 'fulfilled') {
            state.data.codeSubmissions = codeResult.value;
            state.pagination.codeSubmissionsOffset = Number(codeResult.value.offset) || 0;
        } else {
            state.errors.codeSubmissions = codeResult.reason;
        }
    }
    async function loadCodeSubmissionDetails(submissionId, generation = state.requestGeneration) {
        const courseScope = captureCourseScope(generation), attemptOffset = state.pagination.codeAttemptOffset;
        if (!isCurrentCourseScope(courseScope) || !submissionId || !scopedCodeSubmission(submissionId, courseScope)) return;
        state.data.codeSubmissionSource = null;
        state.data.codeSubmissionAttempts = [];
        state.data.codeSubmissionAttemptsPage = null;
        state.errors.codeSubmissionSource = null;
        state.errors.codeSubmissionAttempts = null;
        const [sourceResult, attemptsResult] = await Promise.allSettled([
            fetchJson(`/api/code-submissions/${submissionId}/source`).then((payload) => { if (!payload || String(payload.submission_id) !== String(submissionId)) throw courseScopeSchemaError('code_submission_source_scope_invalid'); return payload; }),
            fetchJson(`/api/code-submissions/${submissionId}/attempts/page`, {
                params: { limit: CODE_ATTEMPT_PAGE_LIMIT, offset: attemptOffset }
            }).then((page) => validateCodeAttemptPage(page, submissionId, attemptOffset))
        ]);
        if (!isCurrentCourseScope(courseScope) || String(state.selected.codeSubmissionId) !== String(submissionId)
            || !scopedCodeSubmission(submissionId, courseScope)) return;
        if (sourceResult.status === 'fulfilled') {
            state.data.codeSubmissionSource = sourceResult.value;
        } else {
            state.errors.codeSubmissionSource = sourceResult.reason;
        }
        if (attemptsResult.status === 'fulfilled') {
            state.data.codeSubmissionAttemptsPage = attemptsResult.value;
            state.data.codeSubmissionAttempts = Array.isArray(attemptsResult.value.items) ? attemptsResult.value.items : [];
            state.pagination.codeAttemptOffset = Number(attemptsResult.value.offset) || 0;
        } else {
            state.errors.codeSubmissionAttempts = attemptsResult.reason;
        }
    }
    function handleViewNavigationKeydown(event) {
        const target = event.target;
        if (!(target instanceof Element) || !target.matches('[data-teacher-view]')) return;
        const tabs = Array.from(state.root.querySelectorAll('[data-teacher-view]'));
        const currentIndex = tabs.indexOf(target);
        if (currentIndex < 0 || !tabs.length) return;
        let nextIndex = currentIndex;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % tabs.length;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = tabs.length - 1;
        else return;
        event.preventDefault(); const nextTab = tabs[nextIndex];
        setActiveView(nextTab.dataset.teacherView); nextTab.focus();
    }
    function renderWorkspace() {
        renderFlash(); renderWriteLock();
        const dashboard = getDashboard(); if (dashboard) dashboard.hidden = !state.user || !['teacher', 'admin'].includes(state.user.role);
        renderTeachingFocus(); renderKpis();
        renderScope(); syncViewNavigation(); renderPanels();
        applyWriteAvailability(); refreshIcons();
    }
    function renderTeachingFocus() {
        const container = state.root && state.root.querySelector('[data-teacher-focus-stage]');
        if (!container) return;
        const course = selectedCourse(), classGroup = selectedClass();
        const plan = state.data.releasePlan && Array.isArray(state.data.releasePlan.items) ? state.data.releasePlan : null;
        const planItems = plan ? plan.items : [], openItems = planItems.filter((item) => item.effective_release_state === 'open');
        const focusItem = openItems[0] || planItems[0] || null, focusUnit = focusItem && findById(state.data.units, focusItem.course_unit_id), selectedAssignment = findById(state.data.assignments, state.selected.assignmentId);
        const pendingTotal = Math.max(0, Number(state.data.submissions.total || state.data.submissions.length) || 0), goalLabel = focusUnit ? focusUnit.title : selectedAssignment ? selectedAssignment.title : course && course.summary ? course.summary : '确认当前班课与开放节奏', outputLabel = selectedAssignment ? `将形成“${selectedAssignment.title}”的学生提交与教师反馈记录` : focusUnit ? `将形成“${focusUnit.title}”的开放、学习过程与反馈记录` : course ? '将形成本班课程节奏与学习反馈记录' : '选择班课后将形成可追踪的教学记录';
        const syncing = state.busy || state.mutationInFlight || state.evidenceMutationInFlight;
        const action = pendingTotal > 0
            ? { view: 'grading', label: '处理待反馈', detail: `${formatNumber(pendingTotal)} 份学生提交等待处理`, icon: 'message-square-text' }
            : course && plan
                ? { view: 'curriculum', label: '检查课程节奏', detail: `${formatNumber(openItems.length)} / ${formatNumber(planItems.length)} 个分块已开放`, icon: 'milestone' }
                : { view: 'structure', label: '建立教学范围', detail: '选择或创建班级与课程后开始教学', icon: 'book-plus' };
        const statusLabel = !state.online
            ? '当前离线，所有写操作已停用'
            : state.writeLock
                ? '上次写入等待权威核对'
                : syncing
                    ? '正在读取最新教学事实'
                    : '当前班课已与服务端同步';
        const railMarkup = planItems.length
            ? `<ol>${planItems.slice(0, 6).map((item, index) => {
                const unit = findById(state.data.units, item.course_unit_id);
                const stateLabel = RELEASE_MODE_LABELS[item.effective_release_state] || item.effective_release_state;
                return `<li data-state="${escapeAttr(item.effective_release_state)}"><span>${formatNumber(index + 1)}</span><strong>${escapeHtml(unit ? unit.title : `课程分块 ${index + 1}`)}</strong><small>${escapeHtml(stateLabel)}</small></li>`;
            }).join('')}</ol>${planItems.length > 6 ? `<p>另有 ${formatNumber(planItems.length - 6)} 个课程分块，请进入课程节奏查看。</p>` : ''}`
            : '<p>确认班级与课程后，这里会呈现真实的课程开放轨道。</p>';
        container.innerHTML = `
            <div class="teacher-focus-stage__context teacher-focus-stage__story"><span class="teacher-focus-stage__label">当前班课</span><div><h2 id="teacher-focus-title">${escapeHtml(course ? course.title : '尚未选择课程')}</h2><p>${escapeHtml(classGroup ? classGroup.name : '尚未选择班级')}${focusUnit ? ` · 当前开放：${escapeHtml(focusUnit.title)}` : ''}</p></div><div class="teacher-focus-stage__teaching-brief" aria-label="本节教学说明"><div class="teacher-focus-stage__goal"><span>本节目标</span><strong>${escapeHtml(goalLabel)}</strong></div><div class="teacher-focus-stage__output"><span>预计产出</span><strong>${escapeHtml(outputLabel)}</strong></div></div></div>
            <button type="button" class="teacher-focus-stage__action" data-teacher-view-target="${escapeAttr(action.view)}"><span><i data-lucide="${escapeAttr(action.icon)}"></i>下一教学动作</span><strong>${escapeHtml(action.label)}</strong><small>${escapeHtml(action.detail)}</small><i data-lucide="arrow-right"></i></button>
            <div class="teacher-focus-stage__rail" aria-label="当前课程发布轨道">${railMarkup}</div>
            <div class="teacher-focus-stage__receipt" role="status"><i data-lucide="${!state.online ? 'wifi-off' : state.writeLock ? 'shield-alert' : syncing ? 'loader-circle' : 'circle-check'}"></i><strong>完成回执</strong><span>${escapeHtml(statusLabel)}</span></div>
        `;
    }
    function renderWriteLock() {
        const container = state.root && state.root.querySelector('[data-teacher-write-lock]');
        if (!container) return;
        if (!state.writeLock) {
            container.hidden = true;
            container.innerHTML = '';
            return;
        }
        const requestHint = state.writeLock.requestId
            ? `请求标识 ${state.writeLock.requestId.slice(0, 12)}…`
            : '未取得请求标识';
        const confirmed = state.writeLock.confirmed === true;
        container.hidden = false;
        container.innerHTML = `
            <i data-lucide="shield-alert"></i>
            <div>
                <strong>${confirmed ? '写入已确认，刷新待完成' : '写操作已暂停'}</strong>
                <span>${confirmed
                    ? '服务器已确认上一次写入，但权威数据刷新失败。系统不会重复发送；请点击顶部刷新完成核对后继续。'
                    : `上一次写入结果无法确认（${escapeHtml(requestHint)}）。系统不会自动重试；请先核对数据，再点击顶部刷新解除。`}</span>
            </div>
        `;
    }
    function applyWriteAvailability() {
        const owner = window.AstraTeacherLearningEvidence, mutationPending = Boolean(state.mutationInFlight || state.evidenceMutationInFlight
            || owner && typeof owner.isMutationPending === 'function' && owner.isMutationPending());
        const blocked = Boolean(state.writeLock || !state.online || state.busy || mutationPending);
        const toggle = (control, disabled) => {
            if (disabled && !control.disabled) { control.dataset.teacherBusyDisabled = ''; control.disabled = true; }
            else if (!disabled && Object.prototype.hasOwnProperty.call(control.dataset, 'teacherBusyDisabled')) { delete control.dataset.teacherBusyDisabled; control.disabled = false; }
        };
        state.root.querySelectorAll('[data-teacher-form] button[type="submit"], [data-teacher-member-status], [data-teacher-collaborator-status], [data-teacher-plan-preset], [data-teacher-plan-reset], [data-course-authoring-control]').forEach(control => toggle(control, blocked));
        state.root.querySelectorAll('[data-teacher-scope], [data-teacher-api-base]').forEach(control => toggle(control, state.busy || mutationPending));
    }
    function renderKpis() {
        const container = state.root.querySelector('[data-teacher-kpis]');
        if (!container) return;
        const activeClasses = state.data.classes.filter((item) => item.status === 'active').length;
        const visibleCourses = state.data.courses.filter((item) => item.status !== 'archived').length;
        const activeStudents = Math.max(0, Number(state.data.activeStudentsPage && state.data.activeStudentsPage.total) || 0);
        const pendingTotal = state.data.submissions.total || state.data.submissions.length || 0;
        const items = [
            ['班级', activeClasses, 'users'],
            ['课程', visibleCourses, 'book-open'],
            ['待批改', pendingTotal, 'inbox'],
            ['学生', activeStudents, 'graduation-cap']
        ];
        container.innerHTML = items.map(([label, value, icon]) => `
            <div class="teacher-summary"><i data-lucide="${icon}"></i><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd></div>
        `).join('');
    }
    function renderScope() {
        const container = state.root.querySelector('[data-teacher-scope-panel]');
        if (!container) return;
        const isCompact = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 760px)').matches;
        const course = selectedCourse();
        const summary = [selectedSchool() && selectedSchool().name, selectedClass() && selectedClass().name, course && galaxyMeta(course).label, course && course.title]
            .filter(Boolean).join(' · ') || '尚未建立教学范围';
        container.innerHTML = `
            <details class="teacher-scope" ${isCompact ? '' : 'open'}>
                <summary><span>当前教学范围</span><strong>${escapeHtml(summary)}</strong><i data-lucide="chevron-down"></i></summary>
                <div class="teacher-scope__fields">
                    ${renderScopeSelect('schoolId', '学校', state.data.schools, state.selected.schoolId, (item) => `${item.name}${item.status !== 'active' ? ` · ${item.status}` : ''}`, state.errors.schools)}
                    ${renderScopeSelect('classId', '班级', state.data.classes, state.selected.classId, (item) => `${item.name}${item.status !== 'active' ? ` · ${item.status}` : ''}`, state.errors.classes)}
                    ${renderGalaxyScopeSelect()}
                    ${renderScopeSelect('courseId', '课程', filteredCourses(), state.selected.courseId, (item) => `${item.title}${item.status !== 'published' ? ` · ${item.status}` : ''}`, state.errors.courses)}
                </div>
            </details>
        `;
    }
    function renderScopeSelect(key, label, items, value, labeler, error) {
        return `
            <label class="teacher-scope__field${error ? ' is-error' : ''}">
                <span>${escapeHtml(label)}</span>
                <select data-teacher-scope="${escapeAttr(key)}" ${error ? 'disabled' : ''}>
                    ${items.length ? '' : '<option value="">--</option>'}
                    ${items.length > 1 && !value ? `<option value="" selected>请选择${escapeHtml(label)}</option>` : ''}
                    ${items.map((item) => `<option value="${item.id}"${String(item.id) === String(value) ? ' selected' : ''}>${escapeHtml(labeler(item))}</option>`).join('')}
                </select>
            </label>
        `;
    }
    function renderPanels() {
        const container = state.root.querySelector('[data-teacher-panels]');
        if (!container) return;
        const panels = {
            overview: renderOverviewPanel,
            curriculum: renderCurriculumWorkspace,
            grading: renderGradingWorkspace
        };
        container.dataset.activeView = state.activeView;
        container.setAttribute('aria-labelledby', `teacher-tab-${state.activeView}`);
        container.innerHTML = (panels[state.activeView] || panels.overview)();
        if (courseAuthoringOwner) courseAuthoringOwner.render();
    }
    function setActiveView(view) {
        const secondary = view === 'assignments' || view === 'structure' ? view : '';
        const targetView = secondary === 'assignments' ? 'curriculum' : secondary === 'structure' ? 'overview' : view;
        if (!Object.prototype.hasOwnProperty.call(TEACHER_VIEWS, targetView)) return;
        state.activeView = targetView;
        syncViewNavigation();
        renderPanels();
        applyWriteAvailability();
        refreshIcons();
        if (secondary) {
            const detail = state.root.querySelector(`[data-teacher-secondary="${secondary}"]`);
            if (detail) {
                detail.open = true;
                detail.querySelector('summary')?.focus();
            }
        }
    }
    function syncViewNavigation() {
        if (!state.root) return;
        state.root.querySelectorAll('[data-teacher-view]').forEach((button) => {
            const selected = button.dataset.teacherView === state.activeView;
            button.classList.toggle('is-active', selected);
            button.setAttribute('aria-selected', String(selected));
            button.tabIndex = selected ? 0 : -1;
        });
    }
    function renderOverviewPanel() {
        const classLabel = selectedClassLabel();
        const schoolLabel = selectedSchool() ? selectedSchool().name : '尚未选择学校';
        const courseLabel = selectedCourseLabel();
        const queue = state.errors.submissions
            ? renderError(state.errors.submissions, '提交队列读取失败')
            : !state.selected.classId || !state.selected.courseId
                ? renderOverviewEmpty('先选择班级与课程', '课程范围确认后，这里会显示当前课程的待批改教学行动。', 'structure', '前往组织与课程')
                : !state.data.submissions.length
                    ? renderOverviewEmpty('暂无待批改的作业', '学生提交的作业会在这里形成行动队列，便于快速批改与反馈。', 'assignments', '查看作业发布')
                    : renderSubmissionQueue();
        return `
            <div class="teacher-overview-layout">
                <article class="teacher-overview-main">
                    <header class="teacher-section-heading"><div><span>当前教学</span><h2>今日教学行动</h2></div><button type="button" data-teacher-view-target="grading">查看全部批改 <i data-lucide="arrow-right"></i></button></header>
                    <div class="teacher-queue-status" aria-label="当前反馈队列"><span>待反馈</span><strong>${formatNumber(state.data.submissions.total || state.data.submissions.length || 0)}</strong><small>仅统计当前班级与课程范围</small></div>
                    ${queue}
                </article>
                <aside class="teacher-overview-aside">
                    <section class="teacher-scope-tree">
                        <header><span>教学范围</span><h2>当前教学范围</h2></header>
                        <ol>
                            <li><i data-lucide="school"></i><div><span>学校</span><strong>${escapeHtml(schoolLabel)}</strong></div></li>
                            <li><i data-lucide="users"></i><div><span>班级</span><strong>${escapeHtml(classLabel)}</strong></div></li>
                            <li><i data-lucide="book-open"></i><div><span>课程</span><strong>${escapeHtml(courseLabel)}</strong></div></li>
                        </ol>
                    </section>
                    <section class="teacher-quick-actions">
                        <header><span>下一步</span><h2>快速开始</h2></header>
                        ${renderQuickAction('assignments', 'clipboard-plus', '发布作业', '布置新作业给当前教学范围')}
                        ${renderQuickAction('curriculum', 'milestone', '安排课程节奏', '分批开放分块并查看全班进度')}
                        ${renderQuickAction('structure', 'book-plus', '创建课程', '建立课程并挂接班级')}
                        ${renderQuickAction('grading', 'chart-no-axes-combined', '查看学情', '查看学生进度与作业反馈')}
                    </section>
                </aside>
            </div>
            <details class="teacher-secondary-workflow" data-teacher-secondary="structure">
                <summary><span><strong>组织与课程</strong><small>按需管理学校、班级、挂班与成员</small></span><i data-lucide="chevron-down"></i></summary>
                <div class="teacher-secondary-workflow__body">${renderOrganizationPanel()}</div>
            </details>
        `;
    }
    function renderGalaxyScopeSelect() {
        return `
            <label class="teacher-scope__field">
                <span>星系</span>
                <select data-teacher-scope="galaxyKey">
                    <option value=""${state.filters.galaxyKey ? '' : ' selected'}>全部星系</option>
                    ${Object.entries(GALAXY_LABELS).map(([value, label]) => `<option value="${value}"${state.filters.galaxyKey === value ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}
                </select>
            </label>
        `;
    }
    function renderOverviewEmpty(title, text, view, action) {
        return `
            <div class="teacher-overview-empty">
                <span class="teacher-overview-empty__icon"><i data-lucide="inbox"></i></span>
                <strong>${escapeHtml(title)}</strong>
                <p>${escapeHtml(text)}</p>
                <button type="button" data-teacher-view-target="${escapeAttr(view)}">${escapeHtml(action)} <i data-lucide="arrow-right"></i></button>
            </div>
        `;
    }
    function renderQuickAction(view, icon, title, detail) {
        return `<button type="button" class="teacher-quick-action" data-teacher-view-target="${escapeAttr(view)}"><span><i data-lucide="${escapeAttr(icon)}"></i></span><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></div><i data-lucide="chevron-right"></i></button>`;
    }
    function renderCurriculumWorkspace() {
        const course = selectedCourse();
        const galaxy = galaxyMeta(course);
        const classGroup = selectedClass();
        const scopeError = state.errors.curriculumScope;
        return `
            <div class="teacher-view teacher-view--curriculum">
                <header class="teacher-view__header teacher-curriculum-hero">
                    <div>
                        <span>COURSE ORCHESTRATION · ${escapeHtml(galaxy.code)}</span>
                        <h2>课程节奏与学习轨道</h2>
                        <p>同一处编排三个星系的开放顺序、班级进度与代码提交；学生端只呈现服务端确认可见的分块。</p>
                    </div>
                    <a class="teacher-galaxy-link teacher-galaxy-link--${escapeAttr(galaxy.tone)}" href="${escapeAttr(galaxy.href)}">
                        <i data-lucide="${escapeAttr(galaxy.icon)}"></i>
                        <span>${escapeHtml(galaxy.label)}</span>
                        <i data-lucide="arrow-up-right"></i>
                    </a>
                </header>
                <section class="teacher-orbit-context" aria-label="当前课程轨道">
                    <div><span>班级轨道</span><strong>${escapeHtml(classGroup ? classGroup.name : '尚未选择班级')}</strong></div>
                    <i data-lucide="chevron-right"></i>
                    <div><span>星系</span><strong>${escapeHtml(galaxy.label)}</strong></div>
                    <i data-lucide="chevron-right"></i>
                    <div><span>课程</span><strong>${escapeHtml(course ? course.title : '尚未选择课程')}</strong></div>
                    <div class="teacher-orbit-context__key"><code>${escapeHtml(course ? `${course.galaxy_key}/${course.course_key}` : '--')}</code></div>
                </section>
                ${!state.selected.classId || !state.selected.courseId
                    ? renderCurriculumEmpty('先选择班级与课程', '顶部教学范围决定发布计划、进度矩阵和代码提交的授权范围。', 'scan-search')
                    : scopeError
                        ? renderError(scopeError, '课程挂班状态读取失败')
                        : !state.data.curriculumAttached
                            ? renderCurriculumEmpty('当前课程尚未挂接此班级', '完成课程挂班后，系统会建立默认开放计划并开始聚合学生进度。', 'link-2-off', 'structure', '前往组织与课程')
                            : `
                                <div class="teacher-curriculum-grid">${renderReleasePlanPanel()}</div>
                                ${renderCodeSubmissionPanel()}
                                <details class="teacher-secondary-workflow" data-teacher-secondary="assignments">
                                    <summary><span><strong>作业发布</strong><small>按需创建单元、作业并设置当前班级策略</small></span><i data-lucide="chevron-down"></i></summary>
                                    <div class="teacher-secondary-workflow__body">${renderAssignmentWorkspace()}</div>
                                </details>
                            `}
            </div>
        `;
    }
    function renderCurriculumEmpty(title, text, icon, view, action) {
        return `
            <div class="teacher-curriculum-empty">
                <i data-lucide="${escapeAttr(icon)}"></i>
                <div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p></div>
                ${view ? `<button type="button" data-teacher-view-target="${escapeAttr(view)}">${escapeHtml(action)} <i data-lucide="arrow-right"></i></button>` : ''}
            </div>
        `;
    }
    function renderReleasePlanPanel() {
        if (state.errors.releasePlan) return `<article class="teacher-curriculum-panel">${renderError(state.errors.releasePlan, '发布计划读取失败')}</article>`;
        const plan = state.data.releasePlan;
        if (!plan || !Array.isArray(plan.items)) return `<article class="teacher-curriculum-panel">${renderEmpty('暂无发布计划')}</article>`;
        const editable = canManageReleasePlan();
        const draft = releaseDraftForCurrentScope();
        const draftItems = new Map((draft && draft.items || []).map((item) => [Number(item.courseUnitId), item]));
        const openCount = plan.items.filter((item) => item.effective_release_state === 'open').length;
        const lockedCount = plan.items.filter((item) => item.effective_release_state === 'locked').length;
        const hiddenCount = plan.items.filter((item) => item.effective_release_state === 'hidden').length;
        return `
            <article class="teacher-curriculum-panel teacher-curriculum-panel--plan">
                <header class="teacher-curriculum-panel__header">
                    <div><span>RELEASE PLAN</span><h3>分块发布计划</h3></div>
                    <div class="teacher-plan-version"><span>权威版本</span><strong>v${formatNumber(plan.plan_version)}</strong></div>
                </header>
                <div class="teacher-plan-summary" aria-label="发布状态摘要">
                    <span data-state="open"><b>${formatNumber(openCount)}</b>开放</span>
                    <span data-state="locked"><b>${formatNumber(lockedCount)}</b>锁定</span>
                    <span data-state="hidden"><b>${formatNumber(hiddenCount)}</b>隐藏</span>
                </div>
                <form class="teacher-release-plan" data-teacher-form="release-plan" data-plan-version="${escapeAttr(plan.plan_version)}">
                    <div class="teacher-plan-presets" aria-label="批量设置发布状态">
                        <span>批量设置</span>
                        ${RELEASE_MODES.map((mode) => `<button type="button" data-teacher-plan-preset="${mode}" ${editable ? '' : 'disabled'}>${escapeHtml(RELEASE_MODE_LABELS[mode])}</button>`).join('')}
                        <button type="button" data-teacher-plan-reset ${editable ? '' : 'disabled'}>撤销草稿</button>
                        <small data-teacher-plan-draft-status>${escapeHtml(draft ? (draft.conflict
                            ? '权威版本已变化；草稿已保留，请重新比较'
                            : draft.reconciled ? `草稿已针对 v${plan.plan_version} 重新比较` : '存在尚未发布的调整') : '尚未修改')}</small>
                    </div>
                    ${draft && draft.conflict ? '<p class="teacher-plan-conflict" role="alert">课程安排已被其他操作更新。已读取最新状态；你的草稿没有自动重发，请核对后再次确认。</p>' : ''}
                    <div class="teacher-plan-list">
                        ${plan.items.map((item, index) => renderReleasePlanRow(item, index, plan.items, editable, draftItems.get(Number(item.course_unit_id)))).join('')}
                    </div>
                    <footer class="teacher-plan-actions">
                        <label><span>调整说明</span><input name="reason" maxlength="4000" data-teacher-plan-reason value="${escapeAttr(draft && draft.reason || '')}" placeholder="例如：第二周开放控制流程练习" ${editable ? '' : 'disabled'}></label>
                        <button type="submit" ${editable && plan.items.length ? '' : 'disabled'}><i data-lucide="scan-search"></i><span>预览本次安排</span></button>
                    </footer>
                </form>
            </article>
        `;
    }
    function renderReleasePlanRow(item, index, allItems, editable, draftItem) {
        const unit = findById(state.data.units, item.course_unit_id);
        const earlierItems = allItems.filter((candidate) => Number(candidate.position) < Number(item.position));
        const reasons = Array.isArray(item.lock_reasons) ? item.lock_reasons : [];
        const value = draftItem || {
            position: String(item.position),
            releaseMode: item.release_mode,
            openAt: datetimeLocalValue(item.open_at),
            prerequisiteUnitId: item.prerequisite_unit_id ? String(item.prerequisite_unit_id) : ''
        };
        return `
            <div class="teacher-plan-row" data-teacher-plan-row data-unit-id="${escapeAttr(item.course_unit_id)}">
                <div class="teacher-plan-row__index"><span>${String(index + 1).padStart(2, '0')}</span><i></i></div>
                <div class="teacher-plan-row__identity">
                    <strong>${escapeHtml(unit ? unit.title : item.activity_key)}</strong>
                    <code>${escapeHtml(item.activity_key)}</code>
                    <span class="teacher-release-state teacher-release-state--${escapeAttr(item.effective_release_state)}">${escapeHtml(RELEASE_MODE_LABELS[item.effective_release_state] || item.effective_release_state)}</span>
                    ${reasons.length ? `<small>${reasons.map((reason) => escapeHtml(RELEASE_REASON_LABELS[reason] || reason)).join(' · ')}</small>` : ''}
                </div>
                <label><span>顺序</span><input type="number" min="1" max="100" value="${escapeAttr(value.position)}" data-teacher-plan-field="position" ${editable ? '' : 'disabled'}></label>
                <label><span>呈现</span><select data-teacher-plan-field="release_mode" ${editable ? '' : 'disabled'}>${RELEASE_MODES.map((mode) => `<option value="${mode}"${mode === value.releaseMode ? ' selected' : ''}>${escapeHtml(RELEASE_MODE_LABELS[mode])}</option>`).join('')}</select></label>
                <label><span>开放时间</span><input type="datetime-local" value="${escapeAttr(value.openAt)}" data-teacher-plan-field="open_at" ${editable ? '' : 'disabled'}></label>
                <label><span>前置分块</span><select data-teacher-plan-field="prerequisite_unit_id" ${editable ? '' : 'disabled'}><option value="">无</option>${earlierItems.map((candidate) => {
                    const candidateUnit = findById(state.data.units, candidate.course_unit_id);
                    return `<option value="${candidate.course_unit_id}"${String(candidate.course_unit_id) === String(value.prerequisiteUnitId) ? ' selected' : ''}>${escapeHtml(candidateUnit ? candidateUnit.title : candidate.activity_key)}</option>`;
                }).join('')}</select></label>
            </div>
        `;
    }
    function renderProgressMatrix() {
        const content = state.learningEvidenceResourceError
            ? teacherLearningEvidenceResourceMarkup(state.learningEvidenceResourceError)
            : '<p>正在按明确班级与课程读取学生进度与班级概况。</p>';
        return `<article class="teacher-curriculum-panel teacher-curriculum-panel--progress" data-teacher-natural-workflow>${content}</article>`;
    }
    function renderCurriculumPageControls(page, kind, itemLabel) {
        const items = page && Array.isArray(page.items) ? page.items : [];
        const total = Math.max(0, Number(page && page.total) || 0);
        const offset = Math.max(0, Number(page && page.offset) || 0);
        const limit = Math.max(1, Number(page && page.limit) || 1);
        const start = items.length ? offset + 1 : 0;
        const end = items.length ? Math.min(total, offset + items.length) : 0;
        const previousOffset = Math.max(0, offset - limit);
        const nextOffset = page && page.next_offset !== null && page.next_offset !== undefined
            ? Math.max(0, Number(page.next_offset) || 0)
            : null;
        return `
            <nav class="teacher-page-nav" aria-label="${escapeAttr(itemLabel)}分页">
                <span>${formatNumber(start)}–${formatNumber(end)} / ${formatNumber(total)}</span>
                <div>
                    <button type="button" data-teacher-curriculum-page="${escapeAttr(kind)}" data-offset="${previousOffset}" ${offset > 0 ? '' : 'disabled'}><i data-lucide="chevron-left"></i><span>上一页</span></button>
                    <button type="button" data-teacher-curriculum-page="${escapeAttr(kind)}" data-offset="${nextOffset === null ? offset : nextOffset}" ${nextOffset === null ? 'disabled' : ''}><span>下一页</span><i data-lucide="chevron-right"></i></button>
                </div>
            </nav>
        `;
    }
    function renderCodeSubmissionPanel() {
        const course = selectedCourse();
        const page = state.data.codeSubmissions || { items: [], total: 0 };
        const allItems = Array.isArray(page.items) ? page.items : [];
        const items = state.filters.codeStatus ? allItems.filter((item) => item.status === state.filters.codeStatus) : allItems;
        const codeCourse = isCodeCourse(course) || allItems.length > 0;
        return `
            <article class="teacher-code-station${codeCourse ? '' : ' teacher-code-station--quiet'}">
                <header class="teacher-code-station__header">
                    <div><span>CODE REVIEW STATION</span><h3>代码提交与判题记录</h3><p>${codeCourse ? '按学生查看原始代码、语言和权威判题状态；公开样例运行不计入此处。' : '当前课程没有已识别的代码活动；建立代码题目后，提交会自动进入此处。'}</p></div>
                    <div><strong>${formatNumber(page.total || allItems.length)}</strong><span>提交记录</span></div>
                </header>
                <div class="teacher-runner-boundary">
                    <section data-runner-lane="browser-precheck"><strong>浏览器预检</strong><p>只用于学生本地学习反馈；browser_runtime_error 不是正式判题，也不会生成通过状态或分数。</p></section>
                    <section data-runner-lane="formal"><strong>正式 runner</strong><p>这里只读取 code-submissions 与 attempt；accepted 是唯一成功，其他状态不会从公开样例或响应摘要推断。</p></section>
                </div>
                ${state.errors.codeSubmissions ? renderError(state.errors.codeSubmissions, '代码提交读取失败') : `
                    <div class="teacher-code-station__toolbar">
                        <label><span>判题状态</span><select data-teacher-filter="codeStatus"><option value="">全部状态</option>${Object.entries(CODE_STATUS_LABELS).map(([value, label]) => `<option value="${value}"${state.filters.codeStatus === value ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></label>
                        <span>本页筛选 ${formatNumber(items.length)} 条</span>
                    </div>
                    <div class="teacher-code-layout">
                        <div class="teacher-code-list" role="list" aria-label="代码提交列表">
                            ${items.length ? items.map((item) => renderCodeSubmissionItem(item)).join('') : renderEmpty(codeCourse ? '当前筛选下暂无代码提交' : '暂无代码提交')}
                        </div>
                        ${renderCodeSubmissionDetails(items)}
                    </div>
                    <footer class="teacher-code-pagination">${renderCurriculumPageControls(page, 'code', '代码提交')}</footer>
                `}
            </article>
        `;
    }
    function renderCodeSubmissionItem(item) {
        const selected = String(item.id) === String(state.selected.codeSubmissionId);
        return `
            <button type="button" role="listitem" class="teacher-code-item${selected ? ' is-selected' : ''}" data-teacher-code-submission="${escapeAttr(item.id)}" aria-pressed="${selected}">
                <span class="teacher-code-item__language">${escapeHtml(String(item.language || '').toUpperCase())}</span>
                <span><strong>${escapeHtml(studentLabel(item.student_id))}</strong><small>${escapeHtml(item.activity_key)}</small></span>
                ${renderCodeStatus(item.status)}
                <time>${formatDate(item.created_at)}</time>
            </button>
        `;
    }
    function renderCodeSubmissionDetails(visibleItems) {
        const selected = (visibleItems || []).find((item) => String(item.id) === String(state.selected.codeSubmissionId));
        if (!selected) {
            return `<div class="teacher-code-detail teacher-code-detail--empty"><i data-lucide="file-code-2"></i><strong>选择一条提交查看代码</strong><p>源代码只在教师授权范围内按需读取，不写入浏览器本地存储。</p></div>`;
        }
        const source = state.data.codeSubmissionSource;
        const attempts = Array.isArray(state.data.codeSubmissionAttempts) ? state.data.codeSubmissionAttempts : [];
        const attemptsPage = state.data.codeSubmissionAttemptsPage || {
            items: attempts,
            total: attempts.length,
            limit: CODE_ATTEMPT_PAGE_LIMIT,
            offset: state.pagination.codeAttemptOffset,
            next_offset: null
        };
        return `
            <div class="teacher-code-detail">
                <header><div><span>提交 #${formatNumber(selected.id)}</span><strong>${escapeHtml(studentLabel(selected.student_id))}</strong></div>${renderCodeStatus(selected.status)}</header>
                <p class="teacher-code-outcome-copy" role="status">${escapeHtml(codeStatusMessage(selected.status))}</p>
                ${state.errors.codeSubmissionSource ? renderError(state.errors.codeSubmissionSource, '源代码读取失败') : !source
                    ? '<div class="teacher-code-loading"><i data-lucide="loader-circle"></i><span>正在读取授权源码</span></div>'
                    : `
                        <div class="teacher-code-meta"><span>${escapeHtml(String(source.language || selected.language).toUpperCase())}</span><code>${escapeHtml(selected.activity_key)}</code><span>${formatDate(selected.created_at)}</span></div>
                        <pre class="teacher-source-code" tabindex="0" aria-label="学生源代码"><code>${escapeHtml(source.source_code)}</code></pre>
                        ${source.stdin ? `<details class="teacher-code-input"><summary>查看标准输入</summary><pre>${escapeHtml(source.stdin)}</pre></details>` : ''}
                    `}
                <section class="teacher-attempts">
                    <h4>判题轨迹</h4>
                    ${state.errors.codeSubmissionAttempts ? renderError(state.errors.codeSubmissionAttempts, '判题轨迹读取失败') : attempts.length
                        ? `<ol>${attempts.map((attempt) => `<li><i></i><div><strong>第 ${formatNumber(attempt.attempt_number)} 次 · ${escapeHtml(CODE_STATUS_LABELS[attempt.status] || attempt.status)}</strong><span>${escapeHtml(attempt.adapter_name || 'runner')} · ${formatDate(attempt.started_at || attempt.created_at)}</span>${attempt.error_code ? `<code>${escapeHtml(attempt.error_code)}</code>` : ''}</div></li>`).join('')}</ol>`
                        : renderEmpty('暂无判题尝试')}
                    ${state.errors.codeSubmissionAttempts ? '' : `<footer class="teacher-list-pagination">${renderCurriculumPageControls(attemptsPage, 'code-attempts', '判题轨迹')}</footer>`}
                </section>
            </div>
        `;
    }
    function renderCodeStatus(value) {
        const normalized = String(value || 'unknown').replace(/[^a-z0-9_-]/gi, '').toLowerCase();
        return `<span class="teacher-code-status teacher-code-status--${escapeAttr(normalized)}" data-formal-outcome="${codeStatusOutcome(value)}">${escapeHtml(CODE_STATUS_LABELS[value] || value || '未知')}</span>`;
    }
    function codeStatusOutcome(value) {
        if (value === 'accepted') return 'success'; if (value === 'runner_unavailable') return 'neutral';
        if (value === 'queued' || value === 'running') return 'processing';
        return 'failure';
    }
    function codeStatusMessage(value) {
        if (value === 'accepted') return '正式判题已通过（accepted）。'; if (value === 'runner_unavailable') return '正式判题未启用（runner_unavailable）。提交已保存；浏览器预检不等同正式通过。';
        if (value === 'queued' || value === 'running') return '正式判题仍在处理中；当前没有成绩或通过结论。';
        return `正式判题未通过（${String(value || 'unknown')}）；浏览器预检不会覆盖这一结果。`;
    }
    function renderOrganizationPanel() {
        const schoolDisabled = !state.selected.schoolId || isSchoolReadOnly();
        const courseDisabled = !state.selected.courseId || isCourseReadOnly();
        const classDisabled = !state.selected.classId || isClassReadOnly();
        return `
            <div class="teacher-view teacher-view--structure">
                <header class="teacher-view__header"><div><span>STRUCTURE</span><h2>组织与课程</h2><p>按学校 → 班级 → 课程顺序建立教学范围；每项操作独立展开，不再把所有表单铺在同一首屏。</p></div></header>
                <div class="teacher-operation-list">
                    ${renderOperation('school', 'school', '创建学校', '建立新的教学组织根节点', `
                        <form class="teacher-form" data-teacher-form="school">
                            <label><span>名称</span><input name="name" maxlength="160" required></label>
                            <label><span>区域</span><input name="region" maxlength="160"></label>
                            <button type="submit"><i data-lucide="plus"></i><span>创建学校</span></button>
                        </form>
                    `, !state.data.schools.length)}
                    ${renderOperation('class', 'users', '创建班级', '在当前学校下建立班级', `
                        <form class="teacher-form" data-teacher-form="class">
                            <label><span>名称</span><input name="name" maxlength="160" required ${schoolDisabled ? 'disabled' : ''}></label>
                            <label><span>年级</span><input name="grade" maxlength="64" ${schoolDisabled ? 'disabled' : ''}></label>
                            <label><span>学期</span><input name="term" maxlength="64" ${schoolDisabled ? 'disabled' : ''}></label>
                            <button type="submit" ${schoolDisabled ? 'disabled' : ''}><i data-lucide="users"></i><span>创建班级</span></button>
                        </form>
                    `)}
                    ${renderOperation('course-authoring', 'book-plus', '创建授课课程', '分步填写并提交管理员审核', renderCourseAuthoringSurface(), true)}
                    ${renderOperation('attach', 'link', '课程挂班', '把当前课程挂接到当前班级', `
                        <form class="teacher-form teacher-form--attach" data-teacher-form="attach">
                            <p><strong>课程</strong>${escapeHtml(selectedCourseLabel())}</p><p><strong>班级</strong>${escapeHtml(selectedClassLabel())}</p>
                            <button type="submit" ${courseDisabled || classDisabled ? 'disabled' : ''}><i data-lucide="link"></i><span>确认挂接</span></button>
                        </form>
                    `)}
                </div>
                ${renderMembersPanel()}
            </div>
        `;
    }
    function renderAssignmentWorkspace() {
        return `
            <div class="teacher-view teacher-view--assignments">
                <header class="teacher-view__header"><div><span>ASSIGNMENTS</span><h2>作业发布</h2><p>选择课程中的单元与作业后，再管理受众、班级策略、积分与协作者。</p></div></header>
                ${renderAssignmentScope()}
                ${renderAssignmentCreationPanel()}
                ${renderCoursePanel()}
            </div>
        `;
    }
    function renderGradingWorkspace() {
        return `
            <div class="teacher-view teacher-view--grading">
                <header class="teacher-view__header"><div><span>REVIEW & INSIGHT</span><h2>批改与学情</h2><p>在同一教学范围中处理提交、反馈和学生学习进度。</p></div></header>
                ${renderAssignmentScope()}
                ${renderProgressMatrix()}
                <div class="teacher-grading-grid">${renderSubmissionsPanel()}${renderInsightPanel()}</div>
            </div>
        `;
    }
    function renderAssignmentScope() {
        return `
            <div class="teacher-assignment-scope" aria-label="作业上下文">
                ${renderScopeSelect('unitId', '单元', state.data.units, state.selected.unitId, (item) => `${item.position}. ${item.title}`, state.errors.units)}
                ${renderScopeSelect('assignmentId', '作业', state.data.assignments, state.selected.assignmentId, (item) => `${item.title}${item.status !== 'active' ? ` · ${item.status}` : ''}`, state.errors.assignments)}
            </div>
        `;
    }
    function renderAssignmentCreationPanel() {
        const unitOptions = state.data.units.map((unit) => `<option value="${unit.id}"${String(unit.id) === state.selected.unitId ? ' selected' : ''}>${escapeHtml(unit.title)}</option>`).join('');
        const unitDisabled = !canCreateCourseUnit();
        const assignmentDisabled = !unitOptions || !canCreateCourseAssignment();
        return `
            <div class="teacher-operation-list teacher-operation-list--compact">
                ${renderOperation('unit', 'layers-3', '创建课程单元', '为当前课程追加可发布单元', `
                    <form class="teacher-form" data-teacher-form="unit">
                        <label><span>标题</span><input name="title" maxlength="180" required ${unitDisabled ? 'disabled' : ''}></label>
                        <label><span>序号</span><input name="position" type="number" min="1" value="${state.data.units.length + 1}" required ${unitDisabled ? 'disabled' : ''}></label>
                        <label><span>状态</span><select name="status" ${unitDisabled ? 'disabled' : ''}>${optionSet(['draft', 'published', 'archived'], 'published')}</select></label>
                        <label><span>活动稳定键</span><input name="activity_key" maxlength="120" pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]*" placeholder="例如 cosmos.orbital-scale" ${unitDisabled ? 'disabled' : ''}></label>
                        <label><span>内容 slug</span><input name="content_slug" maxlength="180" ${unitDisabled ? 'disabled' : ''}></label>
                        <button type="submit" ${unitDisabled ? 'disabled' : ''}><i data-lucide="layers-3"></i><span>创建单元</span></button>
                    </form>
                `, !state.data.units.length)}
                ${renderOperation('assignment', 'clipboard-plus', '发布新作业', '设置满分、受众、截止时间和说明', `
                    <form class="teacher-form" data-teacher-form="assignment">
                        <label><span>单元</span><select name="unit_id" ${assignmentDisabled ? 'disabled' : ''}>${unitOptions || '<option value="">--</option>'}</select></label>
                        <label><span>标题</span><input name="title" maxlength="180" required ${assignmentDisabled ? 'disabled' : ''}></label>
                        <label><span>满分</span><input name="max_score" type="number" min="0" max="1000" value="100" ${assignmentDisabled ? 'disabled' : ''}></label>
                        <label><span>状态</span><select name="status" ${assignmentDisabled ? 'disabled' : ''}>${optionSet(['active', 'closed', 'archived'], 'active')}</select></label>
                        <label><span>受众</span><select name="audience_mode" ${assignmentDisabled ? 'disabled' : ''}>${optionSet(['all_attached_classes', 'selected_classes'], 'all_attached_classes')}</select></label>
                        <label><span>截止</span><input name="due_at" type="datetime-local" ${assignmentDisabled ? 'disabled' : ''}></label>
                        <label class="teacher-form__full"><span>说明</span><textarea name="description" maxlength="4000" rows="2" ${assignmentDisabled ? 'disabled' : ''}></textarea></label>
                        <button type="submit" ${assignmentDisabled ? 'disabled' : ''}><i data-lucide="clipboard-plus"></i><span>发布作业</span></button>
                    </form>
                `, !state.data.assignments.length)}
            </div>
        `;
    }
    function renderOperation(id, icon, title, detail, content, open) {
        return `
            <details class="teacher-operation" data-teacher-operation="${escapeAttr(id)}" ${open ? 'open' : ''}>
                <summary><span class="teacher-operation__icon"><i data-lucide="${escapeAttr(icon)}"></i></span><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></span><i data-lucide="chevron-down"></i></summary>
                <div class="teacher-operation__body">${content}</div>
            </details>
        `;
    }
    function renderCourseAuthoringSurface() {
        const status = courseAuthoringResourceError ? `<div class="teacher-course-authoring__error" role="alert"><div><strong>课程创建向导加载失败</strong><p>${escapeHtml(errorMessage(courseAuthoringResourceError))}</p></div><button type="button" data-teacher-action="refresh">重新加载</button></div>` : '<div class="teacher-course-authoring__loading" role="status"><i data-lucide="loader-circle"></i><span>正在准备课程创建向导…</span></div>';
        return `<div data-teacher-course-authoring>${status}</div>`;
    }
    function renderCoursePanel() {
        const selectedAssignment = findById(state.data.assignments, state.selected.assignmentId);
        const rule = state.data.pointRule || {};
        const policy = state.data.assignmentClassPolicy || {};
        const policyRule = policy.point_rule || {};
        const policyDisabled = !selectedAssignment || !state.selected.classId || !canManageAssignmentClassPolicy();
        const audienceDisabled = !selectedAssignment || !canManageCourseOwnership();
        const pointRuleDisabled = !selectedAssignment || !canManageAssignmentPointRule();
        const collaboratorDisabled = !canManageCourseOwnership();
        return `
            <article class="teacher-panel teacher-panel--wide">
                <header class="teacher-panel__header">
                    <h2><i data-lucide="book-open-check"></i>课程结构</h2>
                    ${statusBadge(selectedCourse() && selectedCourse().status)}
                </header>
                <div class="teacher-structure">
                    <div>
                        <h3>单元</h3>
                        ${renderSimpleList(state.data.units, (unit) => `
                            <strong>${escapeHtml(unit.position + '. ' + unit.title)}</strong>
                            <span>${escapeHtml(unit.content_slug || '无内容绑定')} · ${escapeHtml(unit.status)}</span>
                        `, state.errors.units)}
                    </div>
                    <div>
                        <h3>作业</h3>
                        ${renderSimpleList(state.data.assignments, (assignment) => `
                            <strong>${escapeHtml(assignment.title)}</strong>
                            <span>${escapeHtml(assignment.status)} · ${formatNumber(assignment.max_score)} 分 · ${assignment.due_at ? formatDate(assignment.due_at) : '无截止'}</span>
                        `, state.errors.assignments)}
                    </div>
                </div>
                <div class="teacher-operation-list teacher-operation-list--compact">
                    ${renderOperation('assignment-audience', 'users-round', '作业受众', '设置当前作业的班级覆盖范围', `
                        <form class="teacher-form" data-teacher-form="assignment-audience">
                            <label><span>作业</span><select name="assignment_id" ${selectedAssignment ? '' : 'disabled'}>${assignmentOptions()}</select></label>
                            <label><span>模式</span><select name="audience_mode" ${audienceDisabled ? 'disabled' : ''}>${optionSet(['all_attached_classes', 'selected_classes'], selectedAssignment && selectedAssignment.audience_mode || 'all_attached_classes')}</select></label>
                            <button type="submit" ${audienceDisabled ? 'disabled' : ''}><i data-lucide="users-round"></i><span>保存受众</span></button>
                        </form>
                    `)}
                    ${renderOperation('assignment-class-policy', 'sliders-horizontal', '当前班级策略', '覆盖状态、截止时间与积分策略', `
                        <form class="teacher-form teacher-form--class-policy" data-teacher-form="assignment-class-policy">
                            <label class="teacher-checkbox"><input name="assigned" type="checkbox" ${policy.assigned ? 'checked' : ''} ${policyDisabled ? 'disabled' : ''}><span>分配给本班</span></label>
                            <label><span>状态覆盖</span><select name="status_override" ${policyDisabled ? 'disabled' : ''}>${optionSet(['active', 'closed', 'archived'], policy.status_override || '', [['', '继承全局']])}</select></label>
                            <label class="teacher-checkbox"><input name="due_at_overridden" type="checkbox" ${policy.due_at_overridden ? 'checked' : ''} ${policyDisabled ? 'disabled' : ''}><span>覆盖截止</span></label>
                            <label><span>班级截止</span><input name="due_at_override" type="datetime-local" value="${escapeAttr(datetimeLocalValue(policy.due_at_override))}" ${policyDisabled ? 'disabled' : ''}></label>
                            <label class="teacher-checkbox"><input name="override_points" type="checkbox" ${policyRule.source === 'class_override' ? 'checked' : ''} ${policyDisabled ? 'disabled' : ''}><span>覆盖积分</span></label>
                            <label><span>每分积分</span><input name="points_per_score" type="number" min="0" max="1000" value="${escapeAttr(policyRule.points_per_score ?? 1)}" ${policyDisabled ? 'disabled' : ''}></label>
                            <label><span>积分上限</span><input name="max_points" type="number" min="0" max="100000" value="${escapeAttr(policyRule.max_points ?? '')}" ${policyDisabled ? 'disabled' : ''}></label>
                            <label class="teacher-checkbox"><input name="points_enabled" type="checkbox" ${policyRule.enabled !== false ? 'checked' : ''} ${policyDisabled ? 'disabled' : ''}><span>积分启用</span></label>
                            <button type="submit" ${policyDisabled ? 'disabled' : ''}><i data-lucide="save"></i><span>保存班级策略</span></button>
                            <button type="button" class="teacher-icon-button" data-teacher-class-policy-reset ${policyDisabled || !policy.persisted ? 'disabled' : ''}><i data-lucide="rotate-ccw"></i><span>恢复继承</span></button>
                        </form>
                    `)}
                    ${renderOperation('point-rule', 'badge-cent', '积分规则', '配置作业的积分换算与上限', `
                        <form class="teacher-form" data-teacher-form="point-rule">
                            <label><span>作业</span><select name="assignment_id" ${selectedAssignment ? '' : 'disabled'}>${assignmentOptions()}</select></label>
                            <label class="teacher-checkbox"><input name="enabled" type="checkbox" ${rule.enabled !== false ? 'checked' : ''} ${selectedAssignment ? '' : 'disabled'}><span>启用</span></label>
                            <label><span>每分积分</span><input name="points_per_score" type="number" min="0" max="1000" value="${escapeAttr(rule.points_per_score ?? 1)}" ${selectedAssignment ? '' : 'disabled'}></label>
                            <label><span>上限</span><input name="max_points" type="number" min="0" max="100000" value="${escapeAttr(rule.max_points ?? '')}" ${selectedAssignment ? '' : 'disabled'}></label>
                            <button type="submit" ${pointRuleDisabled ? 'disabled' : ''}><i data-lucide="save"></i><span>保存积分规则</span></button>
                        </form>
                    `)}
                    ${renderOperation('collaborators', 'user-cog', '课程协作者', '添加或批量调整课程协作权限', `
                        <div class="teacher-collaborator-forms">
                            <form class="teacher-form" data-teacher-form="collaborator">
                                <label><span>用户 ID</span><input name="user_id" type="number" min="1" ${collaboratorDisabled ? 'disabled' : ''}></label>
                                <label><span>角色</span><select name="role" ${collaboratorDisabled ? 'disabled' : ''}>${optionSet(['editor', 'content_editor', 'assessment_editor', 'viewer'], 'editor')}</select></label>
                                <button type="submit" ${collaboratorDisabled ? 'disabled' : ''}><i data-lucide="user-plus"></i><span>添加协作者</span></button>
                            </form>
                            <form class="teacher-form" data-teacher-form="collaborator-batch">
                                <label class="teacher-form__full"><span>每行：用户ID,角色,状态</span><textarea name="items" maxlength="12000" rows="4" placeholder="12,content_editor,active" ${collaboratorDisabled ? 'disabled' : ''}></textarea></label>
                                <button type="submit" ${collaboratorDisabled ? 'disabled' : ''}><i data-lucide="list-plus"></i><span>逐项处理</span></button>
                            </form>
                        </div>
                    `)}
                </div>
                ${renderCollaborators()}
                ${renderCollaboratorBatchResult()}
                ${state.errors.assignmentClassPolicy ? renderError(state.errors.assignmentClassPolicy, '当前班级未挂接课程或无策略读取权限') : ''}
            </article>
        `;
    }
    function renderMembersPanel() {
        const classDisabled = !state.selected.classId || isClassReadOnly();
        const targetClasses = state.data.classes.filter((item) => (
            item.status === 'active' && String(item.id) !== String(state.selected.classId)
        ));
        const activeStudentOptions = state.data.activeStudents.map((member) => (
            `<option value="${member.id}">${escapeHtml(member.display_name || member.username)} · ${escapeHtml(member.username)}</option>`
        )).join('');
        const targetClassOptions = targetClasses.map((item) => (
            `<option value="${item.id}">${escapeHtml(item.name)}</option>`
        )).join('');
        const activeStudentsPage = state.data.activeStudentsPage || {
            items: state.data.activeStudents,
            total: state.data.activeStudents.length,
            limit: ACTIVE_STUDENT_PAGE_LIMIT,
            offset: state.pagination.activeStudentOffset,
            next_offset: null
        };
        return `
            <article class="teacher-panel">
                <header class="teacher-panel__header">
                    <h2><i data-lucide="users-round"></i>成员</h2>
                    ${statusBadge(selectedClass() && selectedClass().status)}
                </header>
                <div class="teacher-member-operations">
                    <form class="teacher-form teacher-form--member-operation" data-teacher-form="student-batch-import">
                        <h3>批量导入学生</h3>
                        <label class="teacher-form__full"><span>校内学生用户名（换行、逗号或空格分隔）</span><textarea name="usernames" maxlength="6500" rows="3" required ${classDisabled ? 'disabled' : ''}></textarea></label>
                        <button type="submit" ${classDisabled ? 'disabled' : ''}><i data-lucide="user-round-plus"></i><span>逐项导入</span></button>
                    </form>
                    <form class="teacher-form teacher-form--member-operation" data-teacher-form="student-transfer">
                        <h3>同校转班</h3>
                        <label><span>本页学生</span><select name="membership_id" required ${classDisabled || !activeStudentOptions ? 'disabled' : ''}>${activeStudentOptions || '<option value="">暂无在班学生</option>'}</select></label>
                        <label><span>目标班级</span><select name="target_class_id" required ${classDisabled || !targetClassOptions ? 'disabled' : ''}>${targetClassOptions || '<option value="">暂无可转班级</option>'}</select></label>
                        <label class="teacher-form__full"><span>备注（只记录是否填写，不写入敏感正文）</span><input name="note" maxlength="500" ${classDisabled ? 'disabled' : ''}></label>
                        <button type="submit" ${classDisabled || !activeStudentOptions || !targetClassOptions ? 'disabled' : ''}><i data-lucide="arrow-right-left"></i><span>确认转班</span></button>
                    </form>
                </div>
                ${state.errors.activeStudents
                    ? renderError(state.errors.activeStudents, '转班学生候选读取失败')
                    : `<footer class="teacher-list-pagination teacher-list-pagination--member-operations">${renderCurriculumPageControls(activeStudentsPage, 'active-students', '转班学生候选')}</footer>`}
                ${renderStudentBatchImportResult()}
                <div class="teacher-filter-row">
                    <label><span>角色</span><select data-teacher-filter="memberRole">${optionSet(['student', 'teacher'], state.filters.memberRole, [['', '全部']])}</select></label>
                    <label><span>状态</span><select data-teacher-filter="memberStatus">${optionSet(['active', 'inactive'], state.filters.memberStatus)}</select></label>
                </div>
                ${renderMembersTable()}
            </article>
        `;
    }
    function renderMembersTable() {
        if (state.errors.members) return renderError(state.errors.members, '成员读取失败');
        if (!state.selected.classId) return renderEmpty('请选择班级');
        const page = state.data.membersPage || {
            items: state.data.members,
            total: state.data.members.length,
            limit: MEMBER_PAGE_LIMIT,
            offset: state.pagination.memberOffset,
            next_offset: null
        };
        const content = !state.data.members.length ? renderEmpty('当前页暂无成员') : `
            <div class="teacher-table-wrap">
                <table class="teacher-table">
                    <thead><tr><th>用户</th><th>角色</th><th>状态</th><th>操作</th></tr></thead>
                    <tbody>
                        ${state.data.members.map((member) => `
                            <tr>
                                <td><strong>${escapeHtml(member.display_name || member.username)}</strong><span>${escapeHtml(member.username)} · #${member.user_id}</span></td>
                                <td>${statusBadge(member.role)}</td>
                                <td>${statusBadge(member.status)}</td>
                                <td>
                                    ${member.role === 'student' ? `
                                        <button type="button" class="teacher-icon-button teacher-icon-button--compact" data-teacher-member-status="${member.status === 'active' ? 'inactive' : 'active'}" data-membership-id="${member.id}" ${isClassReadOnly() ? 'disabled' : ''} aria-label="${member.status === 'active' ? '移出班级并保留历史' : '恢复班级成员'}" title="${member.status === 'active' ? '软移除：保留提交、积分和审计历史' : '恢复班级成员'}">
                                            <i data-lucide="${member.status === 'active' ? 'user-minus' : 'user-check'}"></i>
                                        </button>
                                    ` : '<span class="teacher-muted">--</span>'}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
        return `
            ${content}
            <footer class="teacher-list-pagination">${renderCurriculumPageControls(page, 'members', '班级成员')}</footer>
        `;
    }
    function renderStudentBatchImportResult() {
        const result = state.data.studentBatchImportResult;
        if (!result || !Array.isArray(result.items)) return '';
        return `
            <div class="teacher-member-import-result" role="status">
                <strong>导入结果：新增 ${formatNumber(result.created_count)} · 恢复 ${formatNumber(result.restored_count)} · 已存在 ${formatNumber(result.unchanged_count)} · 失败 ${formatNumber(result.failed_count)}</strong>
                <ul>
                    ${result.items.map((item) => `
                        <li>
                            <span>${escapeHtml(item.username || '(空用户名)')}</span>
                            ${statusBadge(item.outcome)}
                            ${item.error_code ? `<code>${escapeHtml(item.error_code)}</code>` : ''}
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    }
    function renderSubmissionsPanel() {
        return `
            <article class="teacher-panel">
                <header class="teacher-panel__header">
                    <h2><i data-lucide="clipboard-list"></i>提交与评分</h2>
                    <span class="teacher-status-pill">${formatNumber(state.data.submissions.total || state.data.submissions.length)} 条</span>
                </header>
                <div class="teacher-filter-row">
                    <label><span>队列</span><select data-teacher-filter="submissionStatus">${optionSet(['submitted', 'returned'], state.filters.submissionStatus, [['', '全部']])}</select></label>
                </div>
                ${renderSubmissionQueue()}
                ${renderGradeForm()}
            </article>
        `;
    }
    function renderSubmissionQueue() {
        if (state.errors.submissions) return renderError(state.errors.submissions, '提交队列读取失败');
        if (!state.selected.classId || !state.selected.courseId) return renderEmpty('请选择班级与课程');
        if (!state.data.submissions.length) return renderEmpty('暂无待处理提交');
        return `
            <div class="teacher-table-wrap teacher-table-wrap--short">
                <table class="teacher-table">
                    <thead><tr><th>学生</th><th>作业</th><th>状态</th><th>时间</th></tr></thead>
                    <tbody>
                        ${state.data.submissions.map((item) => `
                            <tr>
                                <td><strong>${escapeHtml(item.student_display_name || item.student_username)}</strong><span>#${item.student_id}</span></td>
                                <td><strong>${escapeHtml(item.assignment_title)}</strong><span>${escapeHtml(item.course_title || '')}</span></td>
                                <td>${statusBadge(item.status)}</td>
                                <td>${formatDate(item.submitted_at)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }
    function renderGradeForm() {
        const options = state.data.assignmentSubmissions.map((submission) => {
            const member = state.data.members.find((item) => item.user_id === submission.student_id);
            const label = `${member ? (member.display_name || member.username) : `#${submission.student_id}`} · ${submission.status} · #${submission.id}`;
            return `<option value="${submission.id}">${escapeHtml(label)}</option>`;
        }).join('');
        const disabled = !options || isClassReadOnly() || isSchoolReadOnly();
        const page = state.data.assignmentSubmissionsPage || {
            items: state.data.assignmentSubmissions,
            total: state.data.assignmentSubmissions.length,
            limit: ASSIGNMENT_SUBMISSION_PAGE_LIMIT,
            offset: state.pagination.assignmentSubmissionOffset,
            next_offset: null
        };
        return `
            <form class="teacher-form teacher-form--grade" data-teacher-form="grade">
                <h3>评分</h3>
                <label><span>提交</span><select name="submission_id" ${disabled ? 'disabled' : ''}>${options || '<option value="">--</option>'}</select></label>
                <label><span>分数</span><input name="score" type="number" min="0" max="1000" value="100" ${disabled ? 'disabled' : ''}></label>
                <label><span>状态</span><select name="status" ${disabled ? 'disabled' : ''}>${optionSet(['graded', 'returned'], 'graded')}</select></label>
                <label class="teacher-form__full"><span>反馈</span><textarea name="feedback" maxlength="4000" rows="2" ${disabled ? 'disabled' : ''}></textarea></label>
                <button type="submit" ${disabled ? 'disabled' : ''}><i data-lucide="check-check"></i><span>提交</span></button>
            </form>
            ${state.errors.assignmentSubmissions
                ? renderError(state.errors.assignmentSubmissions, '作业提交记录读取失败')
                : `<footer class="teacher-list-pagination">${renderCurriculumPageControls(page, 'assignment-submissions', '作业提交记录')}</footer>`}
        `;
    }
    function renderInsightPanel() {
        return `
            <article class="teacher-panel">
                <header class="teacher-panel__header">
                    <h2><i data-lucide="chart-no-axes-combined"></i>学情统计口径</h2>
                    ${statusBadge('partial')}
                </header>
                <p class="teacher-muted">权威完成与迁移统一在“课程节奏”的学生进度区按明确班级与课程读取；本区只保留作业提交与教师反馈，不用访问次数或旧统计声明掌握。</p>
            </article>
        `;
    }
    async function handleFormSubmit(form) {
        const formType = form.dataset.teacherForm;
        if (!canStartMutation(formType)) return;
        let preserveReleaseDom = false;
        try {
            state.mutationInFlight = true;
            if (formType !== 'release-plan') setBusy(true);
            if (formType === 'school') await createSchool(form);
            if (formType === 'class') await createClass(form);
            if (formType === 'attach') await attachCourseToClass();
            if (formType === 'unit') await createUnit(form);
            if (formType === 'assignment') await createAssignment(form);
            if (formType === 'assignment-audience') await updateAssignmentAudience(form);
            if (formType === 'assignment-class-policy') await updateAssignmentClassPolicy(form);
            if (formType === 'point-rule') await updatePointRule(form);
            if (formType === 'release-plan') preserveReleaseDom = await updateReleasePlan(form) === 'cancelled';
            if (formType === 'collaborator') await createCollaborator(form);
            if (formType === 'collaborator-batch') await batchUpdateCollaborators(form);
            if (formType === 'student-batch-import') await batchImportStudents(form);
            if (formType === 'student-transfer') await transferStudent(form);
            if (formType === 'grade') await gradeSubmission(form);
            if (formType !== 'release-plan') form.reset();
        } catch (error) {
            await handleMutationFailure(error, formType || 'teacher-write');
        } finally {
            state.mutationInFlight = false;
            setBusy(false);
            if (preserveReleaseDom) {
                applyWriteAvailability();
                renderFlash();
            }
            else renderWorkspace();
        }
    }
    async function createSchool(form) {
        const data = formData(form);
        const school = await fetchJson('/api/schools', {
            method: 'POST',
            body: { name: data.name, region: optional(data.region) }
        });
        setFlash('success', '学校已创建');
        state.selected.schoolId = String(school.id);
        await reconcileConfirmedWrite('创建学校', () => loadSchools(school.id));
    }
    async function createClass(form) {
        const data = formData(form);
        const classGroup = await fetchJson('/api/classes', {
            method: 'POST',
            body: {
                school_id: Number(state.selected.schoolId),
                name: data.name,
                grade: optional(data.grade),
                term: optional(data.term)
            }
        });
        setFlash('success', '班级已创建');
        state.selected.classId = String(classGroup.id);
        await reconcileConfirmedWrite('创建班级', () => loadSchoolScope());
    }
    async function attachCourseToClass() {
        await fetchJson(`/api/courses/${state.selected.courseId}/classes`, {
            method: 'POST',
            body: { class_id: Number(state.selected.classId) }
        });
        setFlash('success', '课程已挂接班级');
        await reconcileConfirmedWrite('挂接课程与班级', async () => {
            await loadClassScope();
            await loadCurriculumScope();
        });
    }
    async function createUnit(form) {
        const data = formData(form);
        const unit = await fetchJson(`/api/courses/${state.selected.courseId}/units`, {
            method: 'POST',
            body: {
                activity_key: optional(data.activity_key),
                title: data.title,
                position: Number(data.position) || 1,
                content_slug: optional(data.content_slug),
                status: data.status || 'published'
            }
        });
        setFlash('success', '单元已创建');
        state.selected.unitId = String(unit.id);
        await reconcileConfirmedWrite('创建单元', async () => {
            await loadCourseScope();
            await loadCurriculumScope();
        });
    }
    async function createAssignment(form) {
        const data = formData(form);
        const unitId = data.unit_id || state.selected.unitId;
        const assignment = await fetchJson(`/api/courses/${state.selected.courseId}/units/${unitId}/assignments`, {
            method: 'POST',
            body: {
                title: data.title,
                description: optional(data.description),
                due_at: data.due_at ? new Date(data.due_at).toISOString() : null,
                max_score: Number(data.max_score) || 0,
                status: data.status || 'active',
                audience_mode: data.audience_mode || 'all_attached_classes'
            }
        });
        setFlash('success', '作业已创建');
        state.selected.assignmentId = String(assignment.id);
        await reconcileConfirmedWrite('创建作业', () => loadCourseScope());
    }
    async function updateAssignmentAudience(form) {
        const data = formData(form);
        const assignmentId = data.assignment_id || state.selected.assignmentId;
        await fetchJson(`/api/assignments/${assignmentId}/audience`, {
            method: 'PATCH',
            body: { audience_mode: data.audience_mode || 'all_attached_classes' }
        });
        state.selected.assignmentId = String(assignmentId);
        setFlash('success', '作业受众模式已更新');
        await reconcileConfirmedWrite('更新作业受众', () => loadCourseScope());
    }
    async function updateAssignmentClassPolicy(form) {
        const data = formData(form);
        const pointRule = data.override_points ? {
            enabled: Boolean(data.points_enabled),
            points_per_score: Number(data.points_per_score) || 0,
            max_points: data.max_points ? Number(data.max_points) : null
        } : null;
        await fetchJson(
            `/api/assignments/${state.selected.assignmentId}/classes/${state.selected.classId}/policy`,
            {
                method: 'PUT',
                body: {
                    assigned: Boolean(data.assigned),
                    status_override: optional(data.status_override),
                    due_at_overridden: Boolean(data.due_at_overridden),
                    due_at_override: data.due_at_overridden && data.due_at_override
                        ? new Date(data.due_at_override).toISOString()
                        : null,
                    point_rule: pointRule
                }
            }
        );
        setFlash('success', '当前班级作业与积分覆盖策略已保存');
        await reconcileConfirmedWrite('保存班级作业策略', () => Promise.all([loadAssignmentScope(), loadClassScope()]));
    }
    async function resetAssignmentClassPolicy() {
        if (!canStartMutation('assignment-class-policy-reset')) return;
        try {
            setBusy(true);
            await fetchJson(
                `/api/assignments/${state.selected.assignmentId}/classes/${state.selected.classId}/policy`,
                { method: 'DELETE' }
            );
            setFlash('success', '当前班级已恢复继承全局作业策略');
            await reconcileConfirmedWrite('恢复班级作业策略', () => Promise.all([loadAssignmentScope(), loadClassScope()]));
        } catch (error) {
            await handleMutationFailure(error, 'assignment-class-policy-reset');
        } finally {
            setBusy(false);
            renderWorkspace();
        }
    }
    async function updatePointRule(form) {
        const data = formData(form);
        const assignmentId = data.assignment_id || state.selected.assignmentId;
        await fetchJson(`/api/points/assignments/${assignmentId}/rule`, {
            method: 'PATCH',
            body: {
                enabled: Boolean(data.enabled),
                points_per_score: Number(data.points_per_score) || 0,
                max_points: data.max_points ? Number(data.max_points) : null
            }
        });
        setFlash('success', '积分规则已保存');
        state.selected.assignmentId = String(assignmentId);
        await reconcileConfirmedWrite('保存积分规则', () => loadAssignmentScope());
    }
    function releaseScopeKey() { return `${state.apiBase}|${state.user && state.user.id || ''}:${state.selected.classId || ''}:${state.selected.courseId || ''}`; }
    function releaseDraftForCurrentScope() { return state.releaseDraft && state.releaseDraft.scopeKey === releaseScopeKey() ? state.releaseDraft : null; }
    function captureReleaseDraft(form) {
        const previous = releaseDraftForCurrentScope();
        const draft = {
            scopeKey: releaseScopeKey(),
            reason: String(form.querySelector('[name="reason"]')?.value || '').slice(0, 4000),
            conflict: Boolean(previous && previous.conflict),
            reconciled: Boolean(previous && previous.reconciled),
            items: Array.from(form.querySelectorAll('[data-teacher-plan-row]')).map((row) => ({
                courseUnitId: Number(row.dataset.unitId),
                position: String(row.querySelector('[data-teacher-plan-field="position"]')?.value || ''),
                releaseMode: String(row.querySelector('[data-teacher-plan-field="release_mode"]')?.value || ''),
                openAt: String(row.querySelector('[data-teacher-plan-field="open_at"]')?.value || ''),
                prerequisiteUnitId: String(row.querySelector('[data-teacher-plan-field="prerequisite_unit_id"]')?.value || '')
            }))
        };
        state.releaseDraft = draft;
        return draft;
    }
    function parseReleaseDraft(draft, plan) {
        if (!draft || !plan || draft.scopeKey !== releaseScopeKey() || !draft.items.length) throw new Error('当前课程没有可编排分块');
        const expectedUnits = new Set(plan.items.map((item) => Number(item.course_unit_id)));
        const unitIds = new Set();
        const items = draft.items.map((item) => {
            const position = Number(item.position);
            const courseUnitId = Number(item.courseUnitId);
            const prerequisiteUnitId = item.prerequisiteUnitId ? Number(item.prerequisiteUnitId) : null;
            const openDate = item.openAt ? new Date(item.openAt) : null;
            if (!Number.isInteger(courseUnitId) || !expectedUnits.has(courseUnitId) || unitIds.has(courseUnitId)) throw new Error('课程分块范围无效');
            if (!Number.isInteger(position) || position < 1 || position > 100) throw new Error('课程分块顺序必须是 1—100 的整数');
            if (!RELEASE_MODES.includes(item.releaseMode)) throw new Error('课程分块呈现状态无效');
            if (openDate && !Number.isFinite(openDate.getTime())) throw new Error('课程分块开放时间无效');
            if (prerequisiteUnitId && (!Number.isInteger(prerequisiteUnitId) || !expectedUnits.has(prerequisiteUnitId))) throw new Error('课程分块前置范围无效');
            unitIds.add(courseUnitId);
            return {
                course_unit_id: courseUnitId,
                position,
                release_mode: item.releaseMode,
                open_at: openDate ? openDate.toISOString() : null,
                prerequisite_unit_id: prerequisiteUnitId
            };
        });
        if (items.length !== expectedUnits.size) throw new Error('课程分块草稿不完整');
        if (new Set(items.map((item) => item.position)).size !== items.length) throw new Error('课程分块顺序不能重复');
        const byUnitId = new Map(items.map((item) => [item.course_unit_id, item]));
        items.forEach((item) => {
            const prerequisite = item.prerequisite_unit_id && byUnitId.get(item.prerequisite_unit_id);
            if (item.prerequisite_unit_id && (!prerequisite || prerequisite.position >= item.position)) throw new Error('前置分块必须位于当前分块之前');
        });
        return { items, reason: optional(draft.reason) };
    }
    function releasePreview(plan, command) {
        return {
            classId: Number(state.selected.classId),
            courseId: Number(state.selected.courseId),
            classLabel: selectedClass() && selectedClass().name,
            courseLabel: selectedCourse() && selectedCourse().title,
            expectedVersion: Number(plan.plan_version),
            reason: command.reason,
            items: command.items.map((item) => {
                const original = plan.items.find((candidate) => Number(candidate.course_unit_id) === item.course_unit_id);
                const unit = findById(state.data.units, item.course_unit_id);
                const prerequisite = findById(state.data.units, item.prerequisite_unit_id);
                const originalPrerequisite = original && findById(state.data.units, original.prerequisite_unit_id);
                return {
                    courseUnitId: item.course_unit_id,
                    label: unit ? unit.title : original && original.activity_key,
                    before: {
                        position: original && original.position,
                        releaseMode: original && original.release_mode,
                        openAt: original && original.open_at,
                        prerequisiteLabel: originalPrerequisite && originalPrerequisite.title
                    },
                    after: {
                        position: item.position,
                        releaseMode: item.release_mode,
                        openAt: item.open_at,
                        prerequisiteLabel: prerequisite && prerequisite.title
                    }
                };
            })
        };
    }
    function sameTimestamp(left, right) {
        if (!left && !right) return true;
        return Number.isFinite(new Date(left).getTime()) && new Date(left).getTime() === new Date(right).getTime();
    }
    function releaseSchemaError() {
        return Object.assign(new Error('发布计划响应未通过范围、版本或字段校验'), { code: 'release_plan_schema_invalid', confirmed: true });
    }
    function validateReleasePlanResponse(payload, expectation) {
        const expected = expectation || {};
        const expectedClassId = Number(expected.classId || state.selected.classId),
            expectedCourseId = Number(expected.courseId || state.selected.courseId);
        const items = payload && payload.items;
        const ids = new Set(), positions = new Set();
        if (!payload || payload.course_id !== expectedCourseId
            || payload.class_id !== expectedClassId
            || !Number.isInteger(payload.course_class_id) || payload.course_class_id < 1
            || !Number.isInteger(payload.plan_version) || payload.plan_version < 1
            || typeof payload.changed !== 'boolean' || !Array.isArray(items) || items.length > 100
        ) throw releaseSchemaError();
        const validItems = items.every((item) => {
            const valid = item && Number.isInteger(item.id) && item.id > 0
                && Number.isInteger(item.course_unit_id) && item.course_unit_id > 0 && !ids.has(item.course_unit_id)
                && typeof item.activity_key === 'string' && item.activity_key.length > 0 && item.activity_key.length <= 120
                && Number.isInteger(item.position) && item.position > 0 && item.position <= 100 && !positions.has(item.position)
                && RELEASE_MODES.includes(item.release_mode) && (item.open_at === null || Number.isFinite(new Date(item.open_at).getTime()))
                && (item.prerequisite_unit_id === null || Number.isInteger(item.prerequisite_unit_id) && item.prerequisite_unit_id > 0)
                && RELEASE_MODES.includes(item.effective_release_state) && Array.isArray(item.lock_reasons)
                && item.lock_reasons.length <= 12 && item.lock_reasons.every((reason) => typeof reason === 'string' && reason.length <= 120);
            if (valid) { ids.add(item.course_unit_id); positions.add(item.position); }
            return valid;
        });
        if (!validItems) throw releaseSchemaError();
        if (expected.expectedVersion
            && payload.plan_version !== expected.expectedVersion + (payload.changed ? 1 : 0)) throw releaseSchemaError();
        if (expected.planVersion && payload.plan_version !== expected.planVersion) throw releaseSchemaError();
        if (expected.items) {
            if (items.length !== expected.items.length) throw releaseSchemaError();
            const responseByUnit = new Map(items.map((item) => [item.course_unit_id, item]));
            if (expected.items.some((item) => {
                const response = responseByUnit.get(item.course_unit_id);
                return !response || response.position !== item.position || response.release_mode !== item.release_mode
                    || response.prerequisite_unit_id !== item.prerequisite_unit_id || !sameTimestamp(response.open_at, item.open_at);
            })) throw releaseSchemaError();
        }
        return payload;
    }
    async function readReleasePlanAuthority(expectation) {
        const courseId = Number(state.selected.courseId), classId = Number(state.selected.classId);
        state.data.releasePlan = validateReleasePlanResponse(
            await fetchJson(`/api/courses/${courseId}/classes/${classId}/release-plan`),
            Object.assign({ classId, courseId }, expectation || {})
        );
        state.errors.releasePlan = null;
        return state.data.releasePlan;
    }
    function releaseErrorStatus(error) { return Number(error && (error.status || error.details && error.details.status)) || 0; }
    function lockUnknownWrite(label, error, confirmed) {
        state.writeLock = { label: String(label || 'teacher-write'), requestId: String(error && error.requestId || ''),
            lockedAt: Date.now(), confirmed: Boolean(confirmed) };
    }
    async function updateReleasePlan(form) {
        const plan = state.data.releasePlan;
        if (!plan || !state.data.curriculumAttached) throw new Error('当前班级课程发布计划尚未就绪');
        const draft = captureReleaseDraft(form);
        const command = parseReleaseDraft(draft, plan);
        const previewOwner = window.AstraTeacherLearningEvidence;
        if (!previewOwner || typeof previewOwner.confirmReleasePlan !== 'function') throw new Error('课程安排预览尚未就绪');
        const confirmed = await previewOwner.confirmReleasePlan(releasePreview(plan, command));
        if (!confirmed) {
            setFlash('warning', '本次安排尚未发布；草稿仍保留在当前页面。');
            return 'cancelled';
        }
        setBusy(true);
        let updated;
        try {
            const payload = await fetchJson(
                `/api/courses/${state.selected.courseId}/classes/${state.selected.classId}/release-plan`,
                { method: 'PATCH', body: { expected_version: Number(plan.plan_version), items: command.items, reason: command.reason } }
            );
            updated = validateReleasePlanResponse(payload, {
                expectedVersion: Number(plan.plan_version),
                items: command.items
            });
        } catch (error) {
            if (releaseErrorStatus(error) === 409) {
                try {
                    await readReleasePlanAuthority();
                } catch (readError) {
                    state.errors.releasePlan = readError;
                    lockUnknownWrite('发布课程节奏', readError, false);
                    state.releaseDraft = Object.assign({}, draft, { conflict: true, reconciled: false });
                    setFlash('warning', '课程安排冲突已返回，但最新权威状态读取失败；草稿未重发，写操作保持锁定，请显式刷新后核对。');
                    return 'locked';
                }
                state.releaseDraft = Object.assign({}, draft, { conflict: true, reconciled: false });
                setFlash('warning', '课程安排已被其他操作更新。已读取最新状态；你的草稿没有自动重发，请核对后再次确认。');
                return 'conflict';
            }
            if (AstraApiClient.isAmbiguousMutation(error) || error && error.confirmed) {
                lockUnknownWrite('发布课程节奏', error, Boolean(error && error.confirmed));
                try { await readReleasePlanAuthority(); } catch (readError) { state.errors.releasePlan = readError; }
                setFlash('warning', error && error.confirmed
                    ? '服务器已响应，但结果未通过范围或版本校验。系统不会重复发送；写操作已锁定，请显式刷新后重新比较。'
                    : '尚不能确认本次写入结果。系统不会自动重试；已读取最新状态并锁定写操作，请显式刷新后重新比较。');
                return 'locked';
            }
            throw error;
        }
        try {
            await readReleasePlanAuthority({ planVersion: updated.plan_version, items: command.items });
        } catch (error) {
            lockUnknownWrite('发布课程节奏', error, true);
            state.errors.releasePlan = error;
            setFlash('warning', '课程安排写入已确认，但权威回读失败。系统不会重复发送；请显式刷新完成核对。');
            return 'locked';
        }
        state.releaseDraft = null;
        setFlash(updated.changed ? 'success' : 'warning', updated.changed
            ? `课程节奏已发布，权威版本更新为 v${updated.plan_version}`
            : `提交内容与权威版本 v${updated.plan_version} 一致，无需重复写入`);
        return 'success';
    }
    async function createCollaborator(form) {
        const data = formData(form);
        await fetchJson(`/api/courses/${state.selected.courseId}/collaborators`, {
            method: 'POST',
            body: { user_id: Number(data.user_id), role: data.role || 'editor' }
        });
        setFlash('success', '协作者已添加');
        await reconcileConfirmedWrite('添加协作者', () => loadCourseScope());
    }
    async function batchUpdateCollaborators(form) {
        const data = formData(form);
        const roles = new Set(['editor', 'content_editor', 'assessment_editor', 'viewer']);
        const statuses = new Set(['active', 'inactive']);
        const lines = String(data.items || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        if (!lines.length) throw new Error('请至少输入一行协作者数据');
        if (lines.length > 100) throw new Error('单次最多处理 100 个协作者');
        const items = lines.map((line, index) => {
            const [userIdText, role = 'editor', status = 'active'] = line.split(/[,，\s]+/).filter(Boolean);
            const userId = Number(userIdText);
            if (!Number.isInteger(userId) || userId < 1) throw new Error(`第 ${index + 1} 行用户 ID 无效`);
            if (!roles.has(role)) throw new Error(`第 ${index + 1} 行协作者角色无效`);
            if (!statuses.has(status)) throw new Error(`第 ${index + 1} 行协作者状态无效`);
            return { user_id: userId, role, status, client_ref: `row-${index + 1}` };
        });
        const result = await fetchJson(`/api/courses/${state.selected.courseId}/collaborators/batch`, {
            method: 'POST',
            body: { items }
        });
        state.data.collaboratorBatchResult = result;
        setFlash(
            result.failed_count ? 'warning' : 'success',
            `批量协作者已处理：新增 ${result.created_count}，更新 ${result.updated_count}，未变化 ${result.unchanged_count}，失败 ${result.failed_count}`
        );
        await reconcileConfirmedWrite('批量协作者管理', () => loadCourseScope());
    }
    async function batchImportStudents(form) {
        const data = formData(form);
        const usernames = String(data.usernames || '')
            .split(/[\s,;，；]+/)
            .map((value) => value.trim())
            .filter(Boolean);
        if (!usernames.length) throw new Error('请至少输入一个学生用户名');
        if (usernames.length > 100) throw new Error('单次最多导入 100 个学生用户名');
        const result = await fetchJson(`/api/classes/${state.selected.classId}/students/batch-import`, {
            method: 'POST',
            body: {
                items: usernames.map((username, index) => ({ username, client_ref: `row-${index + 1}` }))
            }
        });
        state.data.studentBatchImportResult = result;
        const level = result.failed_count ? 'warning' : 'success';
        setFlash(level, `批量导入已处理：新增 ${result.created_count}，恢复 ${result.restored_count}，已存在 ${result.unchanged_count}，失败 ${result.failed_count}`);
        await reconcileConfirmedWrite('批量导入学生', () => loadClassScope());
    }
    async function transferStudent(form) {
        const data = formData(form);
        const result = await fetchJson(
            `/api/classes/${state.selected.classId}/students/${Number(data.membership_id)}/transfer`,
            {
                method: 'POST',
                body: {
                    target_class_id: Number(data.target_class_id),
                    note: optional(data.note)
                }
            }
        );
        setFlash('success', result.applied ? '学生已转入目标班级，源班历史记录继续保留' : '转班目标状态已存在，无需重复写入');
        await reconcileConfirmedWrite('学生转班', () => loadClassScope());
    }
    async function gradeSubmission(form) { return gradeSubmissionCommand(formData(form)); }
    async function gradeSubmissionCommand(data) {
        const scope = { submissionId: Number(data.submission_id), assignmentId: Number(state.selected.assignmentId),
            classId: Number(state.selected.classId), offset: state.pagination.assignmentSubmissionOffset };
        if (!scope.submissionId || !scope.assignmentId || !scope.classId
            || !state.data.assignmentSubmissions.some((item) => item.id === scope.submissionId)) {
            throw new Error('请选择当前班级与作业分页中的提交');
        }
        let mutationState = 'success';
        let mutationError = null;
        try {
            await fetchJson(`/api/submissions/${scope.submissionId}/grade`, { method: 'PATCH',
                body: { score: Number(data.score) || 0, feedback: optional(data.feedback), status: data.status || 'graded' } });
        } catch (error) {
            mutationError = error;
            if (releaseErrorStatus(error) === 409) mutationState = 'conflict'; else if (AstraApiClient.isAmbiguousMutation(error) || error && error.confirmed) {
                mutationState = 'locked';
                lockUnknownWrite('提交评分', error, Boolean(error && error.confirmed));
            } else throw error;
        }
        let record;
        try {
            record = await readSubmissionAuthority(scope, mutationState !== 'conflict');
        } catch (error) {
            state.errors.assignmentSubmissions = error;
            lockUnknownWrite('提交评分', mutationError || error, mutationState === 'success');
            setFlash('warning', mutationState === 'conflict'
                ? '评分冲突已返回，但同一作业、班级与分页的权威记录读取失败；系统未重发，写操作保持锁定。'
                : '评分写入后无法确认同一提交的权威记录；系统未重发，写操作保持锁定。');
            return 'locked';
        }
        if (mutationState === 'conflict') { setFlash('warning', '提交状态已变化；已按同一作业、班级与分页回读该提交，系统没有自动重发评分。'); return 'conflict'; }
        if (mutationState === 'locked') { setFlash('warning', '尚不能确认本次评分写入结果。系统不会自动重试；已回读同一提交并保持写锁，请显式刷新后核对。'); return 'locked'; }
        setFlash('success', `权威回读：提交 #${record.id} 已${record.status === 'returned' ? '退回' : '评分'}${record.score === null ? '' : `，得分 ${record.score}`}${record.feedback ? '，反馈已保存' : ''}`);
        return 'success';
    }
    async function updateMemberStatus(button) {
        if (!canStartMutation('member-status')) return;
        try {
            setBusy(true);
            await fetchJson(`/api/classes/${state.selected.classId}/members/${button.dataset.membershipId}`, {
                method: 'PATCH',
                body: { status: button.dataset.teacherMemberStatus, note: null }
            });
            setFlash('success', '成员状态已更新');
            await reconcileConfirmedWrite('更新成员状态', () => loadClassScope());
        } catch (error) {
            await handleMutationFailure(error, 'member-status');
        } finally {
            setBusy(false);
            renderWorkspace();
        }
    }
    async function updateCollaboratorStatus(button) {
        if (!canStartMutation('collaborator-status')) return;
        try {
            setBusy(true);
            await fetchJson(`/api/courses/${state.selected.courseId}/collaborators/${button.dataset.collaboratorId}`, {
                method: 'PATCH',
                body: { status: button.dataset.teacherCollaboratorStatus }
            });
            setFlash('success', '协作者状态已更新');
            await reconcileConfirmedWrite('更新协作者状态', () => loadCourseScope());
        } catch (error) {
            await handleMutationFailure(error, 'collaborator-status');
        } finally {
            setBusy(false);
            renderWorkspace();
        }
    }
    function canStartMutation(label) {
        if (!state.online) {
            setFlash('error', '当前处于离线状态，写操作已停用');
            renderWorkspace();
            return false;
        }
        if (state.writeLock) {
            setFlash('warning', '上一次写入结果尚未确认；请先点击顶部刷新并核对状态');
            renderWorkspace();
            return false;
        }
        if (state.busy || state.mutationInFlight || state.evidenceMutationInFlight) return false;
        return Boolean(label);
    }
    async function handleMutationFailure(error, label) {
        if (error && error.confirmed) {
            try { await refreshAll(); } catch (refreshError) {}
            if (state.active) lockConfirmedWrite(label, error);
            return;
        }
        if (!AstraApiClient.isAmbiguousMutation(error)) {
            setFlash('error', errorMessage(error));
            return;
        }
        state.writeLock = {
            label: String(label || 'teacher-write'),
            requestId: String(error.requestId || ''),
            lockedAt: Date.now()
        };
        try { await refreshAll(); } catch (refreshError) {}
        const requestHint = state.writeLock.requestId ? `（请求 ${state.writeLock.requestId.slice(0, 12)}…）` : '';
        setFlash('warning', `写入结果尚未确认${requestHint}，系统未自动重试；写操作已锁定，请核对后点击顶部刷新解除`);
    }
    async function reconcileConfirmedWrite(label, loader) {
        let refreshError = null;
        try {
            await loader();
        } catch (error) {
            refreshError = error;
        }
        if (!state.active) return false;
        const workspaceError = refreshError || Object.values(state.errors).find(Boolean) || null;
        const authorityUnavailable = !state.online
            || !state.user
            || !['teacher', 'admin'].includes(state.user.role)
            || !state.lifecycleController
            || state.lifecycleController.signal.aborted;
        if (!workspaceError && !authorityUnavailable) return true;
        lockConfirmedWrite(label, workspaceError || AstraApiClient.offlineError());
        return false;
    }
    function lockConfirmedWrite(label, error) {
        state.writeLock = {
            label: String(label || 'teacher-write'),
            requestId: String((error && error.requestId) || ''),
            lockedAt: Date.now(),
            confirmed: true
        };
        const detail = error ? `：${errorMessage(error)}` : '';
        setFlash(
            'warning',
            `${label || '写入'}已由服务器确认，但权威数据刷新失败${detail}。系统不会重复发送；请点击顶部刷新完成核对后继续`
        );
    }
    function applyReleasePlanPreset(mode) {
        if (!RELEASE_MODES.includes(mode) || state.busy || !canManageReleasePlan()) return;
        state.root.querySelectorAll('[data-teacher-plan-field="release_mode"]').forEach((select) => {
            select.value = mode;
            const row = select.closest('[data-teacher-plan-row]');
            if (row) row.classList.add('is-dirty');
        });
        const status = state.root.querySelector('[data-teacher-plan-draft-status]');
        if (status) status.textContent = `草稿：全部设为${RELEASE_MODE_LABELS[mode]}`;
        const form = state.root.querySelector('[data-teacher-form="release-plan"]');
        if (form) captureReleaseDraft(form);
    }
    function markReleasePlanDraft(control) {
        const row = control.closest('[data-teacher-plan-row]');
        if (row) row.classList.add('is-dirty');
        const form = control.closest('[data-teacher-form="release-plan"]');
        if (form) captureReleaseDraft(form);
        const status = state.root.querySelector('[data-teacher-plan-draft-status]');
        if (status) status.textContent = '存在尚未发布的调整';
    }
    async function selectCodeSubmission(submissionId) {
        if (state.busy || !submissionId) return;
        state.selected.codeSubmissionId = String(submissionId);
        state.pagination.codeAttemptOffset = 0;
        state.data.codeSubmissionSource = null;
        state.data.codeSubmissionAttempts = [];
        state.data.codeSubmissionAttemptsPage = null;
        state.errors.codeSubmissionSource = null;
        state.errors.codeSubmissionAttempts = null;
        renderPanels();
        applyWriteAvailability();
        refreshIcons();
        setBusy(true);
        try {
            await loadCodeSubmissionDetails(submissionId);
        } finally {
            setBusy(false);
            renderWorkspace();
        }
    }
    async function changeCurriculumPage(kind, requestedOffset) {
        if (state.busy) return;
        const offset = Math.max(0, Math.floor(Number(requestedOffset) || 0));
        const classId = state.selected.classId;
        const courseId = state.selected.courseId;
        const assignmentId = state.selected.assignmentId;
        const codeSubmissionId = state.selected.codeSubmissionId;
        const supported = new Set(['code', 'members', 'active-students', 'assignment-submissions', 'code-attempts']);
        if (!supported.has(kind)) return;
        if (kind === 'code' && (!classId || !courseId)) return;
        if (['members', 'active-students'].includes(kind) && !classId) return;
        if (kind === 'assignment-submissions' && (!assignmentId || !classId)) return;
        if (kind === 'code-attempts' && !codeSubmissionId) return;
        const generation = beginRequestGeneration();
        const courseScope = captureCourseScope(generation);
        setBusy(true);
        try {
            if (kind === 'code') {
                state.errors.codeSubmissions = null;
                const page = validateCourseScopedPage(await fetchJson('/api/code-submissions', {
                    params: { class_id: classId, course_id: courseId, limit: CODE_SUBMISSION_PAGE_LIMIT, offset }
                }), courseScope, CODE_SUBMISSION_PAGE_LIMIT, offset, 'code_submission_scope_invalid');
                if (!isCurrentCourseScope(courseScope)) return;
                state.data.codeSubmissions = page;
                state.pagination.codeSubmissionsOffset = Number(page.offset) || 0;
                state.selected.codeSubmissionId = '';
                state.data.codeSubmissionSource = null;
                state.data.codeSubmissionAttempts = [];
                state.data.codeSubmissionAttemptsPage = null;
                state.pagination.codeAttemptOffset = 0;
            } else if (kind === 'members') {
                state.errors.members = null;
                const page = await fetchJson(`/api/classes/${classId}/members/page`, {
                    params: {
                        role: state.filters.memberRole || undefined,
                        status: state.filters.memberStatus || undefined,
                        limit: MEMBER_PAGE_LIMIT,
                        offset
                    }
                });
                if (!isCurrentRequest(generation)) return;
                state.data.membersPage = page;
                state.data.members = Array.isArray(page.items) ? page.items : [];
                state.pagination.memberOffset = Number(page.offset) || 0;
            } else if (kind === 'active-students') {
                state.errors.activeStudents = null;
                const page = await fetchJson(`/api/classes/${classId}/members/page`, {
                    params: { role: 'student', status: 'active', limit: ACTIVE_STUDENT_PAGE_LIMIT, offset }
                });
                if (!isCurrentRequest(generation)) return;
                state.data.activeStudentsPage = page;
                state.data.activeStudents = Array.isArray(page.items) ? page.items : [];
                state.pagination.activeStudentOffset = Number(page.offset) || 0;
            } else if (kind === 'assignment-submissions') {
                state.errors.assignmentSubmissions = null;
                const page = validateAssignmentSubmissionPage(
                    await fetchJson(`/api/assignments/${assignmentId}/submissions/page`, {
                        params: { class_id: Number(classId), limit: ASSIGNMENT_SUBMISSION_PAGE_LIMIT, offset }
                    }),
                    { assignmentId: Number(assignmentId), classId: Number(classId), offset }
                );
                if (!isCurrentCourseScope(courseScope) || String(state.selected.assignmentId) !== String(assignmentId)) return;
                state.data.assignmentSubmissionsPage = page;
                state.data.assignmentSubmissions = Array.isArray(page.items) ? page.items : [];
                state.pagination.assignmentSubmissionOffset = Number(page.offset) || 0;
            } else if (kind === 'code-attempts') {
                state.errors.codeSubmissionAttempts = null;
                if (!isCurrentCourseScope(courseScope) || !scopedCodeSubmission(codeSubmissionId, courseScope)) return;
                const page = validateCodeAttemptPage(await fetchJson(`/api/code-submissions/${codeSubmissionId}/attempts/page`, {
                    params: { limit: CODE_ATTEMPT_PAGE_LIMIT, offset }
                }), codeSubmissionId, offset);
                if (!isCurrentCourseScope(courseScope) || String(state.selected.codeSubmissionId) !== String(codeSubmissionId)
                    || !scopedCodeSubmission(codeSubmissionId, courseScope)) return;
                state.data.codeSubmissionAttemptsPage = page;
                state.data.codeSubmissionAttempts = Array.isArray(page.items) ? page.items : [];
                state.pagination.codeAttemptOffset = Number(page.offset) || 0;
            }
        } catch (error) {
            if (!isCurrentRequest(generation) || ['code', 'assignment-submissions', 'code-attempts'].includes(kind)
                && !isCurrentCourseScope(courseScope)) return;
            const errorKey = {
                code: 'codeSubmissions',
                members: 'members',
                'active-students': 'activeStudents',
                'assignment-submissions': 'assignmentSubmissions',
                'code-attempts': 'codeSubmissionAttempts'
            }[kind];
            if (errorKey) state.errors[errorKey] = error;
        } finally {
            if (isCurrentRequest(generation)) {
                setBusy(false);
                renderWorkspace();
            }
        }
    }
    function clearPrivateDownstream() {
        Object.assign(state.data, {
            units: [], assignments: [], members: [], membersPage: null, activeStudents: [], activeStudentsPage: null, submissions: [],
            assignmentSubmissions: [], assignmentSubmissionsPage: null, collaborators: [], collaboratorBatchResult: null,
            pointRule: null, assignmentClassPolicy: null, knowledge: null, studentBatchImportResult: null,
            curriculumAttached: false, releasePlan: null, codeSubmissions: null,
            codeSubmissionSource: null, codeSubmissionAttempts: [], codeSubmissionAttemptsPage: null
        });
        Object.assign(state.selected, { unitId: '', assignmentId: '', codeSubmissionId: '' });
        state.releaseDraft = null; resetPagination();
        const owner = window.AstraTeacherLearningEvidence;
        if (owner && typeof owner.clearScope === 'function') owner.clearScope();
    }
    async function handleScopeChange(target) {
        const evidenceOwner = window.AstraTeacherLearningEvidence;
        if (state.mutationInFlight || state.evidenceMutationInFlight
            || evidenceOwner && typeof evidenceOwner.isMutationPending === 'function' && evidenceOwner.isMutationPending()) {
            setFlash('warning', '当前写入正在等待权威回读，暂不能切换教学范围。');
            renderScope();
            renderFlash();
            return;
        }
        const key = target.dataset.teacherScope;
        const nextValue = target.value;
        invalidateRequests();
        if (['galaxyKey', 'schoolId', 'classId', 'courseId'].includes(key)) {
            clearPrivateDownstream();
            if (key === 'schoolId') {
                state.data.classes = []; state.data.courses = [];
                Object.assign(state.selected, { classId: '', courseId: '' });
            } else if (key === 'classId') {
                state.data.courses = []; state.selected.courseId = '';
            }
        } else if (key === 'assignmentId') {
            Object.assign(state.data, { assignmentSubmissions: [], assignmentSubmissionsPage: null,
                pointRule: null, assignmentClassPolicy: null });
            state.pagination.assignmentSubmissionOffset = 0;
        }
        const generation = beginRequestGeneration();
        if (key === 'galaxyKey') {
            state.filters.galaxyKey = nextValue;
            const courses = filteredCourses();
            state.selected.courseId = normalizeSelectedId(state.selected.courseId, courses);
            if (!state.selected.courseId && courses.length === 1) state.selected.courseId = String(courses[0].id);
            renderWorkspace();
            setBusy(true);
            try {
                await Promise.all([loadCourseScope(generation), loadClassScope(generation)]);
                await loadCurriculumScope(generation);
            } finally {
                if (isCurrentRequest(generation)) { setBusy(false); renderWorkspace(); }
            }
            return;
        }
        state.selected[key] = nextValue;
        renderWorkspace();
        setBusy(true);
        try {
            if (key === 'schoolId') await loadSchoolScope(generation);
            if (key === 'classId') {
                await loadClassCourses(generation);
                await Promise.all([loadClassScope(generation), loadCourseScope(generation)]);
                await loadCurriculumScope(generation);
            }
            if (key === 'courseId') {
                await Promise.all([loadCourseScope(generation), loadClassScope(generation)]);
                await loadCurriculumScope(generation);
            }
            if (key === 'unitId') renderWorkspace();
            if (key === 'assignmentId') await loadAssignmentScope(generation);
        } finally {
            if (isCurrentRequest(generation)) { setBusy(false); renderWorkspace(); }
        }
    }
    async function handleFilterChange(target) {
        if (state.busy) {
            renderWorkspace();
            return;
        }
        const key = target.dataset.teacherFilter;
        if (key === 'memberRole') {
            state.filters.memberRole = target.value;
            state.pagination.memberOffset = 0;
        }
        if (key === 'memberStatus') {
            state.filters.memberStatus = target.value;
            state.pagination.memberOffset = 0;
        }
        if (key === 'submissionStatus') state.filters.submissionStatus = target.value;
        if (key === 'codeStatus') {
            state.filters.codeStatus = target.value;
            renderWorkspace();
            return;
        }
        setBusy(true);
        try {
            await loadClassScope();
        } finally {
            setBusy(false);
            renderWorkspace();
        }
    }
    function renderAuthState(mode, user) {
        const container = state.root.querySelector('[data-teacher-auth-state]');
        if (!container) return;
        if (window.AstraAuthUI) AstraAuthUI.unmount(container);
        if (mode === 'checking') {
            container.innerHTML = `
                <div class="teacher-auth-card teacher-auth-card--checking">
                    <i data-lucide="loader-circle"></i>
                    <span>正在校验教师会话</span>
                </div>
            `;
            return;
        }
        if (mode === 'forbidden') {
            if (window.AstraAuthUI) {
                AstraAuthUI.mountAccount(container, {
                    role: 'teacher', baseUrl: state.apiBase, user: user || {}, roleMismatch: true,
                    onSignedOut: () => refreshAll()
                });
                return;
            }
            container.innerHTML = `
                <div class="teacher-auth-card teacher-auth-card--blocked">
                    <i data-lucide="shield-x"></i>
                    <div>
                        <strong>当前账号无教师权限</strong>
                        <span>${escapeHtml(user.display_name || user.username || '当前用户')} · ${escapeHtml(user.role || 'unknown')}</span>
                    </div>
                </div>
            `;
            return;
        }
        if (window.AstraAuthUI) {
            AstraAuthUI.mountAccount(container, {
                role: 'teacher', baseUrl: state.apiBase, user: user || {},
                onSignedOut: () => refreshAll()
            });
            return;
        }
        container.innerHTML = `
            <div class="teacher-auth-card teacher-auth-card--ready">
                <i data-lucide="presentation"></i>
                <div>
                    <strong>${escapeHtml(user.display_name || user.username)}</strong>
                    <span>${escapeHtml(user.username)} · ${escapeHtml(user.role)} · ${escapeHtml(user.status)}</span>
                </div>
            </div>
        `;
    }
    function renderAuthError(error) {
        const container = state.root.querySelector('[data-teacher-auth-state]');
        if (!container) return;
        const isUnauthenticated = error && error.status === 401;
        const isForbidden = error && error.status === 403;
        const isOffline = error && error.code === 'offline';
        if (isUnauthenticated && window.AstraAuthUI) {
            AstraAuthUI.mountGate(container, {
                role: 'teacher', baseUrl: state.apiBase,
                onAuthenticated: () => refreshAll()
            });
            return;
        }
        if (window.AstraAuthUI) AstraAuthUI.unmount(container);
        container.innerHTML = `
            <div class="teacher-auth-card teacher-auth-card--blocked">
                <i data-lucide="${isUnauthenticated ? 'lock' : isForbidden ? 'shield-x' : isOffline ? 'wifi-off' : 'server-off'}"></i>
                <div>
                    <strong>${isUnauthenticated ? '需要教师会话' : isForbidden ? '当前账号无教师权限' : isOffline ? '当前处于离线状态' : '后端连接失败'}</strong>
                    <span>${escapeHtml(errorMessage(error))}</span>
                </div>
            </div>
        `;
    }
    function renderCollaborators() {
        if (state.errors.collaborators) return renderError(state.errors.collaborators, '协作者读取失败');
        if (!state.selected.courseId) return '';
        if (!state.data.collaborators.length) return `<div class="teacher-empty teacher-empty--inline">暂无协作者</div>`;
        return `
            <div class="teacher-collaborators">
                ${state.data.collaborators.map((item) => `
                    <div>
                        <span>#${item.user_id}</span>
                        ${statusBadge(item.role)}
                        ${statusBadge(item.status)}
                        <button type="button" class="teacher-icon-button teacher-icon-button--compact" data-teacher-collaborator-status="${item.status === 'active' ? 'inactive' : 'active'}" data-collaborator-id="${item.id}" ${canManageCourseOwnership() ? '' : 'disabled'} aria-label="切换协作者状态">
                            <i data-lucide="${item.status === 'active' ? 'user-minus' : 'user-check'}"></i>
                        </button>
                    </div>
                `).join('')}
            </div>
        `;
    }
    function renderCollaboratorBatchResult() {
        const result = state.data.collaboratorBatchResult;
        if (!result || !Array.isArray(result.items)) return '';
        return `
            <div class="teacher-member-import-result" role="status">
                <strong>批量协作者：新增 ${formatNumber(result.created_count)} · 更新 ${formatNumber(result.updated_count)} · 未变化 ${formatNumber(result.unchanged_count)} · 失败 ${formatNumber(result.failed_count)}</strong>
                <ul>
                    ${result.items.map((item) => `
                        <li>
                            <span>用户 #${formatNumber(item.user_id)}</span>
                            ${statusBadge(item.outcome)}
                            ${item.error_code ? `<code>${escapeHtml(item.error_code)}</code>` : ''}
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    }
    function renderKnowledgeStats(knowledge) {
        if (!knowledge || !Array.isArray(knowledge.knowledge_stats) || !knowledge.knowledge_stats.length) {
            return renderEmpty('暂无规则统计');
        }
        const overall = knowledge.knowledge_stats.filter((item) => !item.dimension || item.dimension === 'overall');
        const dimensions = knowledge.knowledge_stats
            .filter((item) => item.dimension && item.dimension !== 'overall' && Number(item.sample_size || 0) > 0)
            .slice()
            .sort((a, b) => Number(a.percent || 0) - Number(b.percent || 0))
            .slice(0, 6);
        return `
            <p class="teacher-muted">本区只纳入已发布课程与单元、本班有效分配且当前生效的作业。</p>
            <div class="teacher-knowledge-list">
                ${overall.slice(0, 3).map((item) => `
                    <div>
                        <strong>${escapeHtml(item.rule_code)}</strong>
                        <span>${formatNumber(item.frequency)} / ${formatNumber(item.sample_size)} · ${formatPercent(item.percent)}</span>
                    </div>
                `).join('')}
            </div>
            ${dimensions.length ? `
                <div class="teacher-divider"></div>
                <div class="teacher-knowledge-list">
                    ${dimensions.map((item) => `
                        <div>
                            <strong>${escapeHtml(item.label || item.knowledge_code || item.rule_code)}</strong>
                            <span>${escapeHtml(item.dimension)} · ${formatNumber(item.frequency)} / ${formatNumber(item.sample_size)} · ${formatPercent(item.percent)}</span>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
        `;
    }
    function renderSimpleList(items, renderer, error) {
        if (error) return renderError(error, '读取失败');
        if (!items.length) return renderEmpty('暂无数据');
        return `<div class="teacher-simple-list">${items.map((item) => `<div>${renderer(item)}</div>`).join('')}</div>`;
    }
    function metric(label, value) {
        return `
            <div class="teacher-metric">
                <strong>${value === undefined || value === null ? '--' : escapeHtml(String(value))}</strong>
                <span>${escapeHtml(label)}</span>
            </div>
        `;
    }
    function renderError(error, label) {
        return `
            <div class="teacher-error" role="alert">
                <i data-lucide="triangle-alert"></i>
                <span>${escapeHtml(label)}：${escapeHtml(errorMessage(error))}</span><button type="button" data-teacher-action="refresh">重试</button>
            </div>
        `;
    }
    function renderEmpty(text) {
        return `<div class="teacher-empty">${escapeHtml(text)}</div>`;
    }
    function renderFlash() {
        const container = state.root.querySelector('[data-teacher-flash]');
        if (!container) return;
        if (!state.flash) {
            container.hidden = true;
            container.innerHTML = '';
            return;
        }
        container.hidden = false;
        container.className = `teacher-flash teacher-flash--${state.flash.type}`;
        const icon = state.flash.type === 'success'
            ? 'circle-check'
            : state.flash.type === 'warning'
                ? 'shield-alert'
                : 'triangle-alert';
        container.innerHTML = `
            <i data-lucide="${icon}"></i>
            <span>${escapeHtml(state.flash.message)}</span>
        `;
    }
    function setFlash(type, message) {
        state.flash = { type, message };
    }
    function selectedSchool() {
        return findById(state.data.schools, state.selected.schoolId);
    }
    function selectedClass() {
        return findById(state.data.classes, state.selected.classId);
    }
    function selectedCourse() {
        return findById(state.data.courses, state.selected.courseId);
    }
    function filteredCourses() {
        if (!state.filters.galaxyKey) return state.data.courses;
        return state.data.courses.filter((course) => String(course.galaxy_key || '') === state.filters.galaxyKey);
    }
    function selectedCourseLabel() {
        const course = selectedCourse();
        return course ? `课程：${course.title}` : '课程：--';
    }
    function selectedClassLabel() {
        const classGroup = selectedClass();
        return classGroup ? `班级：${classGroup.name}` : '班级：--';
    }
    function isClassReadOnly() {
        const classGroup = selectedClass();
        return isSchoolReadOnly() || !classGroup || classGroup.status !== 'active';
    }
    function isSchoolReadOnly() {
        const school = selectedSchool();
        return !school || school.status !== 'active';
    }
    function isCourseReadOnly() {
        const course = selectedCourse();
        return isSchoolReadOnly() || !course || course.status === 'archived';
    }
    function activeCourseCollaboratorRole() {
        if (!state.user) return '';
        const collaborator = state.data.collaborators.find((item) => (
            Number(item.user_id) === Number(state.user.id) && item.status === 'active'
        ));
        return collaborator ? collaborator.role : '';
    }
    function hasCourseCapability(roles) {
        if (isCourseReadOnly() || !state.user) return false;
        const course = selectedCourse();
        if (state.user.role === 'admin' || Number(course.creator_user_id) === Number(state.user.id)) return true;
        return roles.includes(activeCourseCollaboratorRole());
    }
    function canManageCourseOwnership() {
        if (isCourseReadOnly() || !state.user) return false;
        const course = selectedCourse();
        return state.user.role === 'admin' || Number(course.creator_user_id) === Number(state.user.id);
    }
    function canCreateCourseUnit() {
        return hasCourseCapability(['editor', 'content_editor']);
    }
    function canCreateCourseAssignment() {
        return hasCourseCapability(['editor', 'content_editor', 'assessment_editor']);
    }
    function canManageAssignmentPointRule() {
        return hasCourseCapability(['editor', 'assessment_editor']);
    }
    function canManageAssignmentClassPolicy() {
        return !isClassReadOnly() && hasCourseCapability(['editor', 'assessment_editor']);
    }
    function canManageReleasePlan() {
        return Boolean(
            state.data.curriculumAttached
            && state.user
            && ['teacher', 'admin'].includes(state.user.role)
            && !isClassReadOnly()
            && !isCourseReadOnly()
        );
    }
    function galaxyMeta(course) {
        const key = String(course && course.galaxy_key || '').toLowerCase();
        if (key === 'code-space') return { code: 'CODE / 02', label: '代码空间', icon: 'code-2', tone: 'code', href: 'codevis/index.html#catalog' };
        if (key === 'future-galaxy') return { code: 'FRONTIER / 03', label: '未来星系', icon: 'telescope', tone: 'future', href: '#frontier' };
        if (key === 'englab') return { code: 'ENG / 01', label: '工科试验室', icon: 'flask-conical', tone: 'englab', href: '#home' };
        return { code: 'ASTRA / COURSE', label: '星序课程', icon: 'orbit', tone: 'astra', href: '#planets' };
    }
    function isCodeCourse(course) {
        if (!course) return false;
        if (String(course.galaxy_key || '').toLowerCase() === 'code-space') return true;
        if (/代码|编程|算法/i.test(String(course.title || ''))) return true;
        return state.data.units.some((unit) => /^(program|control-flow|data-functions|algorithm|debugging|challenge)[.-]/.test(String(unit.activity_key || '')));
    }
    function studentLabel(studentId) {
        const candidates = state.data.activeStudents.concat(state.data.members);
        const member = candidates.find((item) => Number(item.user_id) === Number(studentId));
        return member ? (member.display_name || member.username || `学生 #${studentId}`) : `学生 #${studentId}`;
    }
    function assignmentOptions() {
        return state.data.assignments.map((assignment) => (
            `<option value="${assignment.id}"${String(assignment.id) === state.selected.assignmentId ? ' selected' : ''}>${escapeHtml(assignment.title)}</option>`
        )).join('') || '<option value="">--</option>';
    }
    function optionSet(values, current, prefix) {
        const options = (prefix || []).concat(values.map((value) => [value, value]));
        return options.map(([value, label]) => `<option value="${escapeAttr(value)}"${value === current ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
    }
    function statusBadge(value) {
        if (!value) return '<span class="teacher-status-pill">--</span>';
        const normalized = String(value).replace(/[^a-z0-9_-]/gi, '').toLowerCase();
        return `<span class="teacher-status-pill teacher-status-pill--${escapeAttr(normalized)}">${escapeHtml(String(value))}</span>`;
    }
    function formData(form) {
        const data = {};
        const raw = new FormData(form);
        raw.forEach((value, key) => {
            data[key] = typeof value === 'string' ? value.trim() : value;
        });
        form.querySelectorAll('input[type="checkbox"][name]').forEach((input) => {
            data[input.name] = input.checked;
        });
        return data;
    }
    function optional(value) {
        const text = String(value || '').trim();
        return text || null;
    }
    function normalizeSelectedId(value, items) {
        if (!value) return '';
        return items.some((item) => String(item.id) === String(value)) ? String(value) : '';
    }
    function resetBelow(level) {
        if (level === 'school') {
            resetPagination();
            state.data.classes = [];
            state.data.courses = [];
            state.data.units = [];
            state.data.assignments = [];
            state.data.members = [];
            state.data.membersPage = null;
            state.data.activeStudents = [];
            state.data.activeStudentsPage = null;
            state.data.submissions = [];
            state.data.assignmentSubmissions = [];
            state.data.assignmentSubmissionsPage = null;
            state.data.collaborators = [];
            state.data.collaboratorBatchResult = null;
            state.data.pointRule = null;
            state.data.assignmentClassPolicy = null;
            state.data.knowledge = null;
            state.data.studentBatchImportResult = null;
            state.data.curriculumAttached = false;
            state.data.releasePlan = null;
            state.data.codeSubmissions = null;
            state.data.codeSubmissionSource = null;
            state.data.codeSubmissionAttempts = [];
            state.data.codeSubmissionAttemptsPage = null;
            state.selected.codeSubmissionId = '';
        }
    }
    function clearWorkspace() {
        state.user = null; state.releaseDraft = null; state.writeLock = null;
        state.errors = {}; state.flash = null;
        Object.keys(state.selected).forEach((key) => { state.selected[key] = ''; });
        state.filters.galaxyKey = ''; resetPagination();
        Object.keys(state.data).forEach((key) => { state.data[key] = Array.isArray(state.data[key]) ? [] : null; });
        const owner = window.AstraTeacherLearningEvidence;
        if (owner && typeof owner.clearScope === 'function') owner.clearScope();
        state.mutationInFlight = false; state.evidenceMutationInFlight = false;
        hideDashboard();
    }
    function resetPagination() {
        state.pagination.memberOffset = 0;
        state.pagination.activeStudentOffset = 0;
        state.pagination.assignmentSubmissionOffset = 0;
        state.pagination.codeSubmissionsOffset = 0;
        state.pagination.codeAttemptOffset = 0;
    }
    function showDashboard() {
        const dashboard = getDashboard();
        if (dashboard) dashboard.hidden = false;
        renderWorkspace();
    }
    function hideDashboard() {
        const dashboard = getDashboard();
        if (dashboard) dashboard.hidden = true;
    }
    function getDashboard() {
        return state.root && state.root.querySelector('[data-teacher-dashboard]');
    }
    function setBusy(value) {
        state.busy = Boolean(value);
        if (state.root) {
            state.root.classList.toggle('is-busy', state.busy);
            if (state.busy && typeof state.root.setAttribute === 'function') state.root.setAttribute('aria-busy', 'true'); else if (!state.busy && typeof state.root.removeAttribute === 'function') state.root.removeAttribute('aria-busy');
            state.root.querySelectorAll('[data-teacher-action="refresh"], [data-teacher-api-base]').forEach((control) => {
                control.disabled = state.busy;
            });
        }
        if (state.root) applyWriteAvailability();
    }
    async function fetchJson(path, options) {
        const request = options || {};
        return AstraApiClient.request(path, {
            baseUrl: state.apiBase,
            params: request.params,
            method: request.method,
            headers: request.headers,
            body: request.body,
            timeoutMs: request.timeoutMs,
            signal: state.lifecycleController && state.lifecycleController.signal
        });
    }
    function beginRequestGeneration() {
        if (state.lifecycleController && !state.lifecycleController.signal.aborted) {
            state.lifecycleController.abort();
        }
        state.lifecycleController = new AbortController();
        state.requestGeneration += 1;
        state.errors = {};
        return state.requestGeneration;
    }
    function invalidateRequests() {
        state.requestGeneration += 1;
        if (state.lifecycleController && !state.lifecycleController.signal.aborted) {
            state.lifecycleController.abort();
        }
        state.lifecycleController = null;
    }
    function isCurrentRequest(generation) {
        return Boolean(
            state.active
            && generation === state.requestGeneration
            && state.lifecycleController
            && !state.lifecycleController.signal.aborted
        );
    }
    function hasWorkspaceErrors() {
        return Object.values(state.errors).some(Boolean);
    }
    function resolveApiBase() {
        try {
            const queryBase = new URLSearchParams(location.search).get('apiBase');
            if (queryBase) return AstraApiClient.normalizeBaseUrl(queryBase);
        } catch (e) {}
        try {
            const stored = localStorage.getItem(API_BASE_STORAGE_KEY);
            if (stored) return AstraApiClient.normalizeBaseUrl(stored);
        } catch (e) {}
        if (window.CONFIG && CONFIG.backend && CONFIG.backend.apiBaseUrl) {
            return AstraApiClient.normalizeBaseUrl(CONFIG.backend.apiBaseUrl);
        }
        return '';
    }
    function persistApiBase() {
        try {
            state.apiBase = AstraApiClient.normalizeBaseUrl(state.apiBase);
            if (state.apiBase) localStorage.setItem(API_BASE_STORAGE_KEY, state.apiBase);
            else localStorage.removeItem(API_BASE_STORAGE_KEY);
            const input = state.root && state.root.querySelector('[data-teacher-api-base]');
            if (input) input.value = state.apiBase;
        } catch (e) {}
    }
    function applyApiBaseChange(input) {
        const owner = window.AstraTeacherLearningEvidence;
        if (state.busy || state.mutationInFlight || state.evidenceMutationInFlight || owner && typeof owner.isMutationPending === 'function' && owner.isMutationPending()) {
            input.value = state.apiBase;
            if (state.root) applyWriteAvailability();
            return false;
        }
        const previous = state.apiBase;
        state.apiBase = AstraApiClient.normalizeBaseUrl(input.value);
        persistApiBase();
        if (state.apiBase !== previous) {
            invalidateRequests();
            clearWorkspace();
            refreshAll();
        }
        return true;
    }
    function findById(items, id) {
        return (items || []).find((item) => String(item.id) === String(id)) || null;
    }
    function errorMessage(error) {
        return AstraApiClient.message(error);
    }
    function formatNumber(value) {
        return new Intl.NumberFormat('zh-CN').format(Number(value || 0));
    }
    function formatPercent(value) {
        return `${Number(value || 0).toFixed(1)}%`;
    }
    function formatDate(value) {
        if (!value) return '--';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return new Intl.DateTimeFormat('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    }
    function datetimeLocalValue(value) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
        return local.toISOString().slice(0, 16);
    }
    function escapeHtml(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    function escapeAttr(value) {
        return escapeHtml(value);
    }
    function refreshIcons() {
        if (typeof lucide !== 'undefined' && lucide && typeof lucide.createIcons === 'function') {
            try {
                lucide.createIcons({ attrs: { 'stroke-width': 1.8 }, root: state.root || document });
            } catch (e) {}
        }
    }
    window.initTeacher = initTeacher;
    window.destroyTeacher = destroyTeacher;
    window.initTeacherWorkbench = initTeacher;
    window.TEACHER_WORKBENCH_VERSION = TEACHER_ASSET_VERSION;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            state,
            reconcileConfirmedWrite,
            lockConfirmedWrite, setBusy
        };
    }
})();
