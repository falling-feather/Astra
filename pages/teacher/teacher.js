(function () {
    'use strict';

    const TEACHER_ASSET_VERSION = '20260719v75ReviewTeacherLayersP0';
    const API_BASE_STORAGE_KEY = 'astra-teacher-api-base';
    const TEACHER_VIEWS = Object.freeze({
        overview: '教学总览',
        curriculum: '课程节奏',
        assignments: '作业发布',
        grading: '批改与学情',
        structure: '组织与课程'
    });
    const RELEASE_MODES = Object.freeze(['open', 'locked', 'hidden']);
    const RELEASE_MODE_LABELS = Object.freeze({ open: '开放', locked: '锁定', hidden: '隐藏' });
    const GALAXY_LABELS = Object.freeze({ englab: '工科试验室', 'code-space': '代码空间', 'future-galaxy': '未来星系' });
    const RELEASE_REASON_LABELS = Object.freeze({
        manual_locked: '教师锁定',
        scheduled: '等待开放时间',
        prerequisite_incomplete: '前置分块未完成'
    });
    const CODE_STATUS_LABELS = Object.freeze({
        queued: '排队中',
        runner_unavailable: '判题器未启用',
        running: '判题中',
        accepted: '通过',
        wrong_answer: '答案不符',
        partial: '部分通过',
        compile_error: '编译错误',
        runtime_error: '运行错误',
        time_limit: '运行超时',
        memory_limit: '内存超限',
        output_limit: '输出超限',
        internal_error: '判题异常',
        cancelled: '已取消'
    });
    const COURSE_PROGRESS_PAGE_LIMIT = 50;
    const CODE_SUBMISSION_PAGE_LIMIT = 100;
    const MEMBER_PAGE_LIMIT = 50;
    const ACTIVE_STUDENT_PAGE_LIMIT = 50;
    const ASSIGNMENT_SUBMISSION_PAGE_LIMIT = 50;
    const CODE_ATTEMPT_PAGE_LIMIT = 20;

    const state = {
        root: null,
        apiBase: '',
        initialized: false,
        active: false,
        online: navigator.onLine !== false,
        runtimeBound: false,
        lifecycleController: null,
        requestGeneration: 0,
        onOnline: null,
        onOffline: null,
        onAuthRequired: null,
        busy: false,
        user: null,
        activeView: 'overview',
        writeLock: null,
        selected: {
            schoolId: '',
            classId: '',
            courseId: '',
            unitId: '',
            assignmentId: '',
            studentId: '',
            codeSubmissionId: ''
        },
        filters: {
            galaxyKey: '',
            memberRole: 'student',
            memberStatus: 'active',
            submissionStatus: 'submitted',
            codeStatus: ''
        },
        pagination: {
            memberOffset: 0,
            activeStudentOffset: 0,
            assignmentSubmissionOffset: 0,
            courseProgressOffset: 0,
            codeSubmissionsOffset: 0,
            codeAttemptOffset: 0
        },
        data: {
            schools: [],
            classes: [],
            courses: [],
            units: [],
            assignments: [],
            members: [],
            membersPage: null,
            activeStudents: [],
            activeStudentsPage: null,
            submissions: [],
            assignmentSubmissions: [],
            assignmentSubmissionsPage: null,
            collaborators: [],
            collaboratorBatchResult: null,
            pointRule: null,
            assignmentClassPolicy: null,
            knowledge: null,
            progress: null,
            studentBatchImportResult: null,
            curriculumAttached: false,
            releasePlan: null,
            courseProgress: null,
            codeSubmissions: null,
            codeSubmissionSource: null,
            codeSubmissionAttempts: [],
            codeSubmissionAttemptsPage: null
        },
        errors: {},
        flash: null,
        learningEvidenceResourceError: null,
        learningEvidenceLoadGeneration: 0
    };

    function initTeacher() {
        state.root = document.querySelector('[data-teacher-workbench]');
        if (!state.root) return;
        state.active = true;
        state.online = navigator.onLine !== false;
        if (window.AstraApiClient) AstraApiClient.scrubLegacyTokens();
        state.apiBase = resolveApiBase();
        renderShell();
        mountTeacherLearningEvidence();
        if (!state.initialized) {
            bindEvents();
            state.initialized = true;
        }
        bindRuntimeEvents();
        if (!state.online) {
            renderAuthError(AstraApiClient.offlineError());
            refreshIcons();
            return;
        }
        refreshAll();
    }

    function destroyTeacher() {
        state.active = false;
        state.learningEvidenceLoadGeneration += 1;
        if (window.AstraTeacherLearningEvidence) window.AstraTeacherLearningEvidence.destroy();
        invalidateRequests();
        unbindRuntimeEvents();
        clearWorkspace();
        state.busy = false;
        state.flash = null;
        state.learningEvidenceResourceError = null;
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
        return Object.freeze({ code: String(error && error.code || 'learning_evidence_resource_failed'),
            message: '共享教师证据资源加载失败或超时；页面不会继续显示为“正在读取”。请重试加载。' });
    }
    function teacherLearningEvidenceResourceMarkup(issue) {
        return `
            <header class="astra-authority-summary__header"><div><span>RESOURCE FAIL-CLOSED</span><h3>权威学习证据汇总</h3></div></header>
            <div class="astra-authority-summary__state" role="status"><strong>${escapeHtml(issue.code)}</strong><p>${escapeHtml(issue.message)}</p>
            <button type="button" class="astra-authority-summary__retry" data-teacher-evidence-resource-retry>重试加载学习证据</button></div>`;
    }

    function renderTeacherLearningEvidenceResourceState() {
        if (!state.root || !state.learningEvidenceResourceError) return;
        state.root.querySelectorAll('[data-learning-evidence-teacher-aggregate]').forEach((container) => {
            delete container.dataset.authoritySignature;
            container.classList.add('astra-authority-summary');
            container.innerHTML = teacherLearningEvidenceResourceMarkup(state.learningEvidenceResourceError);
        });
    }

    async function mountTeacherLearningEvidence() {
        const generation = ++state.learningEvidenceLoadGeneration;
        state.learningEvidenceResourceError = null;
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
            window.AstraTeacherLearningEvidence.mount(state.root);
            return true;
        } catch (error) {
            if (!state.active || generation !== state.learningEvidenceLoadGeneration) return false;
            state.learningEvidenceResourceError = learningEvidenceResourceIssue(error);
            renderTeacherLearningEvidenceResourceState();
            console.warn('[TeacherWorkbench] learning evidence unavailable', error && (error.code || error.message));
            return false;
        }
    }

    function bindRuntimeEvents() {
        if (state.runtimeBound) return;
        state.onOnline = () => {
            state.online = true;
            if (state.active) refreshAll();
        };
        state.onOffline = () => {
            state.online = false;
            invalidateRequests();
            setBusy(false);
            clearWorkspace();
            if (state.active) {
                renderAuthError(AstraApiClient.offlineError());
                setFlash('warning', '已隐藏旧教学数据；恢复网络后将重新读取后端状态');
                renderWorkspace();
            }
        };
        state.onAuthRequired = () => {
            invalidateRequests();
            setBusy(false);
            clearWorkspace();
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
                    <p>在星序中统一安排班级、课程、作业与学情，不进入任何单一学习单元的后台。</p>
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
                <section class="teacher-summary-strip" data-teacher-kpis aria-label="教学运行摘要"></section>
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
            if (target.matches('[data-teacher-plan-field]')) {
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
        if (!state.selected.schoolId && state.data.schools.length) {
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
        state.errors.courses = null;
        const schoolId = state.selected.schoolId;
        const [classesResult, coursesResult] = await Promise.allSettled([
            fetchJson('/api/classes', { params: { school_id: schoolId } }),
            fetchJson('/api/courses', { params: { school_id: schoolId } })
        ]);
        if (!isCurrentRequest(generation)) return;
        if (classesResult.status === 'fulfilled') {
            state.data.classes = classesResult.value;
        } else {
            state.data.classes = [];
            state.errors.classes = classesResult.reason;
        }
        if (coursesResult.status === 'fulfilled') {
            state.data.courses = coursesResult.value;
        } else {
            state.data.courses = [];
            state.errors.courses = coursesResult.reason;
        }
        state.selected.classId = normalizeSelectedId(state.selected.classId, state.data.classes);
        const visibleCourses = filteredCourses();
        state.selected.courseId = normalizeSelectedId(state.selected.courseId, visibleCourses);
        if (!state.selected.classId && state.data.classes.length) state.selected.classId = String(state.data.classes[0].id);
        if (!state.selected.courseId && visibleCourses.length === 1) state.selected.courseId = String(visibleCourses[0].id);
        await Promise.all([loadClassScope(generation), loadCourseScope(generation)]);
        if (!isCurrentRequest(generation)) return;
        await loadCurriculumScope(generation);
        if (!isCurrentRequest(generation)) return;
        renderWorkspace();
    }

    async function loadClassScope(generation = state.requestGeneration) {
        if (!isCurrentRequest(generation)) return;
        state.data.members = [];
        state.data.membersPage = null;
        state.data.activeStudents = [];
        state.data.activeStudentsPage = null;
        state.data.submissions = [];
        state.data.knowledge = null;
        state.data.progress = null;
        state.errors.members = null;
        state.errors.activeStudents = null;
        state.errors.submissions = null;
        state.errors.knowledge = null;
        state.errors.progress = null;
        if (!state.selected.classId) return;
        const classId = state.selected.classId;
        const memberParams = {
            role: state.filters.memberRole || undefined,
            status: state.filters.memberStatus || undefined,
            limit: MEMBER_PAGE_LIMIT,
            offset: state.pagination.memberOffset
        };
        const submissionParams = {
            class_id: classId,
            status: state.filters.submissionStatus || undefined,
            limit: 50,
            offset: 0
        };
        const [membersResult, activeStudentsResult, submissionsResult, knowledgeResult] = await Promise.allSettled([
            fetchJson(`/api/classes/${classId}/members/page`, { params: memberParams }),
            fetchJson(`/api/classes/${classId}/members/page`, {
                params: {
                    role: 'student',
                    status: 'active',
                    limit: ACTIVE_STUDENT_PAGE_LIMIT,
                    offset: state.pagination.activeStudentOffset
                }
            }),
            fetchJson('/api/admin/submissions/pending', { params: submissionParams }),
            fetchClassKnowledge(classId)
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
            state.selected.studentId = normalizeSelectedUserId(state.selected.studentId, state.data.activeStudents);
            if (!state.selected.studentId) {
                const firstStudent = state.data.activeStudents[0];
                state.selected.studentId = firstStudent ? String(firstStudent.user_id) : '';
            }
        } else {
            state.errors.activeStudents = activeStudentsResult.reason;
            state.selected.studentId = '';
        }
        if (submissionsResult.status === 'fulfilled') {
            state.data.submissions = Array.isArray(submissionsResult.value.items) ? submissionsResult.value.items : [];
            state.data.submissions.total = submissionsResult.value.total || state.data.submissions.length;
        } else {
            state.errors.submissions = submissionsResult.reason;
        }
        if (knowledgeResult.status === 'fulfilled') {
            state.data.knowledge = knowledgeResult.value;
        } else {
            state.errors.knowledge = knowledgeResult.reason;
        }
        await loadStudentProgress(generation);
    }

    async function fetchClassKnowledge(classId) {
        const courseId = state.selected.courseId;
        if (courseId) {
            const attachedCourses = await fetchJson('/api/courses', { params: { class_id: classId } });
            const attached = attachedCourses.some((course) => String(course.id) === String(courseId));
            if (!attached) return null;
        }
        return fetchJson(`/api/classes/${classId}/knowledge`, {
            params: { course_id: courseId || undefined }
        });
    }

    async function loadStudentProgress(generation = state.requestGeneration) {
        if (!isCurrentRequest(generation)) return;
        state.data.progress = null;
        state.errors.progress = null;
        if (!state.selected.classId || !state.selected.studentId) return;
        let progress = null;
        let requestError = null;
        try {
            progress = await fetchJson(`/api/progress/users/${state.selected.studentId}`, {
                params: { class_id: state.selected.classId }
            });
        } catch (error) {
            requestError = error;
        }
        if (!isCurrentRequest(generation)) return;
        state.data.progress = requestError ? null : progress;
        state.errors.progress = requestError;
    }

    async function loadCourseScope(generation = state.requestGeneration) {
        if (!isCurrentRequest(generation)) return;
        state.data.units = [];
        state.data.assignments = [];
        state.data.assignmentSubmissions = [];
        state.data.assignmentSubmissionsPage = null;
        state.data.collaborators = [];
        state.data.pointRule = null;
        state.errors.units = null;
        state.errors.assignments = null;
        state.errors.assignmentSubmissions = null;
        state.errors.collaborators = null;
        state.errors.pointRule = null;
        if (!state.selected.courseId) return;
        const courseId = state.selected.courseId;
        const [unitsResult, assignmentsResult, collaboratorsResult] = await Promise.allSettled([
            fetchJson(`/api/courses/${courseId}/units`),
            fetchJson(`/api/courses/${courseId}/assignments`),
            fetchJson(`/api/courses/${courseId}/collaborators`, { params: { status: 'all' } })
        ]);
        if (!isCurrentRequest(generation)) return;
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
        if (!state.selected.assignmentId && state.data.assignments.length) {
            state.selected.assignmentId = String(state.data.assignments[0].id);
        }
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
        if (!state.selected.assignmentId) return;
        const params = {
            class_id: state.selected.classId || undefined,
            limit: ASSIGNMENT_SUBMISSION_PAGE_LIMIT,
            offset: state.pagination.assignmentSubmissionOffset
        };
        const policyRequest = state.selected.classId
            ? fetchJson(`/api/assignments/${state.selected.assignmentId}/classes/${state.selected.classId}/policy`)
            : Promise.resolve(null);
        const [submissionsResult, ruleResult, policyResult] = await Promise.allSettled([
            fetchJson(`/api/assignments/${state.selected.assignmentId}/submissions/page`, { params }),
            fetchJson(`/api/points/assignments/${state.selected.assignmentId}/rule`),
            policyRequest
        ]);
        if (!isCurrentRequest(generation)) return;
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

    async function loadCurriculumScope(generation = state.requestGeneration) {
        if (!isCurrentRequest(generation)) return;
        state.data.curriculumAttached = false;
        state.data.releasePlan = null;
        state.data.courseProgress = null;
        state.data.codeSubmissions = null;
        state.data.codeSubmissionSource = null;
        state.data.codeSubmissionAttempts = [];
        state.data.codeSubmissionAttemptsPage = null;
        state.pagination.codeAttemptOffset = 0;
        state.selected.codeSubmissionId = '';
        state.errors.curriculumScope = null;
        state.errors.releasePlan = null;
        state.errors.courseProgress = null;
        state.errors.codeSubmissions = null;
        state.errors.codeSubmissionSource = null;
        state.errors.codeSubmissionAttempts = null;
        if (!state.selected.classId || !state.selected.courseId) return;

        const classId = state.selected.classId;
        const courseId = state.selected.courseId;
        let attachedCourses = [];
        try {
            attachedCourses = await fetchJson('/api/courses', { params: { class_id: classId } });
        } catch (error) {
            if (!isCurrentRequest(generation)) return;
            state.errors.curriculumScope = error;
            return;
        }
        if (!isCurrentRequest(generation)) return;
        state.data.curriculumAttached = attachedCourses.some((course) => String(course.id) === String(courseId));
        if (!state.data.curriculumAttached) return;

        const [planResult, progressResult, codeResult] = await Promise.allSettled([
            fetchJson(`/api/courses/${courseId}/classes/${classId}/release-plan`),
            fetchJson(`/api/progress/courses/${courseId}/classes/${classId}/students`, {
                params: { limit: COURSE_PROGRESS_PAGE_LIMIT, offset: state.pagination.courseProgressOffset }
            }),
            fetchJson('/api/code-submissions', {
                params: {
                    class_id: classId,
                    course_id: courseId,
                    limit: CODE_SUBMISSION_PAGE_LIMIT,
                    offset: state.pagination.codeSubmissionsOffset
                }
            })
        ]);
        if (!isCurrentRequest(generation)) return;
        if (planResult.status === 'fulfilled') {
            state.data.releasePlan = planResult.value;
        } else {
            state.errors.releasePlan = planResult.reason;
        }
        if (progressResult.status === 'fulfilled') {
            state.data.courseProgress = progressResult.value;
            state.pagination.courseProgressOffset = Number(progressResult.value.offset) || 0;
        } else {
            state.errors.courseProgress = progressResult.reason;
        }
        if (codeResult.status === 'fulfilled') {
            state.data.codeSubmissions = codeResult.value;
            state.pagination.codeSubmissionsOffset = Number(codeResult.value.offset) || 0;
        } else {
            state.errors.codeSubmissions = codeResult.reason;
        }
    }

    async function loadCodeSubmissionDetails(submissionId, generation = state.requestGeneration) {
        if (!isCurrentRequest(generation) || !submissionId) return;
        state.data.codeSubmissionSource = null;
        state.data.codeSubmissionAttempts = [];
        state.data.codeSubmissionAttemptsPage = null;
        state.errors.codeSubmissionSource = null;
        state.errors.codeSubmissionAttempts = null;
        const [sourceResult, attemptsResult] = await Promise.allSettled([
            fetchJson(`/api/code-submissions/${submissionId}/source`),
            fetchJson(`/api/code-submissions/${submissionId}/attempts/page`, {
                params: { limit: CODE_ATTEMPT_PAGE_LIMIT, offset: state.pagination.codeAttemptOffset }
            })
        ]);
        if (!isCurrentRequest(generation) || String(state.selected.codeSubmissionId) !== String(submissionId)) return;
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

        event.preventDefault();
        const nextTab = tabs[nextIndex];
        setActiveView(nextTab.dataset.teacherView);
        nextTab.focus();
    }

    function renderWorkspace() {
        renderFlash();
        renderWriteLock();
        const dashboard = getDashboard();
        if (dashboard) dashboard.hidden = !state.user || !['teacher', 'admin'].includes(state.user.role);
        renderKpis();
        renderScope();
        syncViewNavigation();
        renderPanels();
        applyWriteAvailability();
        refreshIcons();
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
        const blocked = Boolean(state.writeLock || !state.online || state.busy);
        state.root.querySelectorAll(
            '[data-teacher-form] button[type="submit"], [data-teacher-member-status], [data-teacher-collaborator-status], [data-teacher-plan-preset], [data-teacher-plan-reset]'
        ).forEach((control) => {
            if (blocked) control.disabled = true;
        });
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
            assignments: renderAssignmentWorkspace,
            grading: renderGradingWorkspace,
            structure: renderOrganizationPanel
        };
        container.dataset.activeView = state.activeView;
        container.setAttribute('aria-labelledby', `teacher-tab-${state.activeView}`);
        container.innerHTML = (panels[state.activeView] || panels.overview)();
    }

    function setActiveView(view) {
        if (!Object.prototype.hasOwnProperty.call(TEACHER_VIEWS, view)) return;
        state.activeView = view;
        syncViewNavigation();
        renderPanels();
        applyWriteAvailability();
        refreshIcons();
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
            : !state.selected.classId
                ? renderOverviewEmpty('先建立或选择班级', '选择班级后，这里会显示待批改、待发布与进行中的教学行动。', 'structure', '前往组织与课程')
                : !state.data.submissions.length
                    ? renderOverviewEmpty('暂无待批改的作业', '学生提交的作业会在这里形成行动队列，便于快速批改与反馈。', 'assignments', '查看作业发布')
                    : renderSubmissionQueue();
        return `
            <div class="teacher-overview-layout">
                <article class="teacher-overview-main">
                    <header class="teacher-section-heading"><div><span>TEACHING NOW</span><h2>今日教学行动</h2></div><button type="button" data-teacher-view-target="grading">查看全部批改 <i data-lucide="arrow-right"></i></button></header>
                    <div class="teacher-queue-tabs" aria-label="行动队列"><span class="is-active">待批改</span><span>待发布</span><span>进行中</span></div>
                    ${queue}
                </article>
                <aside class="teacher-overview-aside">
                    <section class="teacher-scope-tree">
                        <header><span>CONTEXT</span><h2>当前教学范围</h2></header>
                        <ol>
                            <li><i data-lucide="school"></i><div><span>学校</span><strong>${escapeHtml(schoolLabel)}</strong></div></li>
                            <li><i data-lucide="users"></i><div><span>班级</span><strong>${escapeHtml(classLabel)}</strong></div></li>
                            <li><i data-lucide="book-open"></i><div><span>课程</span><strong>${escapeHtml(courseLabel)}</strong></div></li>
                        </ol>
                    </section>
                    <section class="teacher-quick-actions">
                        <header><span>NEXT STEP</span><h2>快速开始</h2></header>
                        ${renderQuickAction('assignments', 'clipboard-plus', '发布作业', '布置新作业给当前教学范围')}
                        ${renderQuickAction('curriculum', 'milestone', '安排课程节奏', '分批开放分块并查看全班进度')}
                        ${renderQuickAction('structure', 'book-plus', '创建课程', '建立课程并挂接班级')}
                        ${renderQuickAction('grading', 'chart-no-axes-combined', '查看学情', '查看学生进度与作业反馈')}
                    </section>
                </aside>
            </div>
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
                                <div class="teacher-curriculum-grid">
                                    ${renderReleasePlanPanel()}
                                    ${renderProgressMatrix()}
                                </div>
                                ${renderCodeSubmissionPanel()}
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
                        <small data-teacher-plan-draft-status>尚未修改</small>
                    </div>
                    <div class="teacher-plan-list">
                        ${plan.items.map((item, index) => renderReleasePlanRow(item, index, plan.items, editable)).join('')}
                    </div>
                    <footer class="teacher-plan-actions">
                        <label><span>调整说明</span><input name="reason" maxlength="4000" placeholder="例如：第二周开放控制流程练习" ${editable ? '' : 'disabled'}></label>
                        <button type="submit" ${editable && plan.items.length ? '' : 'disabled'}><i data-lucide="send"></i><span>发布到当前班级</span></button>
                    </footer>
                </form>
            </article>
        `;
    }

    function renderReleasePlanRow(item, index, allItems, editable) {
        const unit = findById(state.data.units, item.course_unit_id);
        const earlierItems = allItems.filter((candidate) => Number(candidate.position) < Number(item.position));
        const reasons = Array.isArray(item.lock_reasons) ? item.lock_reasons : [];
        return `
            <div class="teacher-plan-row" data-teacher-plan-row data-unit-id="${escapeAttr(item.course_unit_id)}">
                <div class="teacher-plan-row__index"><span>${String(index + 1).padStart(2, '0')}</span><i></i></div>
                <div class="teacher-plan-row__identity">
                    <strong>${escapeHtml(unit ? unit.title : item.activity_key)}</strong>
                    <code>${escapeHtml(item.activity_key)}</code>
                    <span class="teacher-release-state teacher-release-state--${escapeAttr(item.effective_release_state)}">${escapeHtml(RELEASE_MODE_LABELS[item.effective_release_state] || item.effective_release_state)}</span>
                    ${reasons.length ? `<small>${reasons.map((reason) => escapeHtml(RELEASE_REASON_LABELS[reason] || reason)).join(' · ')}</small>` : ''}
                </div>
                <label><span>顺序</span><input type="number" min="1" max="100" value="${escapeAttr(item.position)}" data-teacher-plan-field="position" ${editable ? '' : 'disabled'}></label>
                <label><span>呈现</span><select data-teacher-plan-field="release_mode" ${editable ? '' : 'disabled'}>${RELEASE_MODES.map((mode) => `<option value="${mode}"${mode === item.release_mode ? ' selected' : ''}>${escapeHtml(RELEASE_MODE_LABELS[mode])}</option>`).join('')}</select></label>
                <label><span>开放时间</span><input type="datetime-local" value="${escapeAttr(datetimeLocalValue(item.open_at))}" data-teacher-plan-field="open_at" ${editable ? '' : 'disabled'}></label>
                <label><span>前置分块</span><select data-teacher-plan-field="prerequisite_unit_id" ${editable ? '' : 'disabled'}><option value="">无</option>${earlierItems.map((candidate) => {
                    const candidateUnit = findById(state.data.units, candidate.course_unit_id);
                    return `<option value="${candidate.course_unit_id}"${Number(candidate.course_unit_id) === Number(item.prerequisite_unit_id) ? ' selected' : ''}>${escapeHtml(candidateUnit ? candidateUnit.title : candidate.activity_key)}</option>`;
                }).join('')}</select></label>
            </div>
        `;
    }

    function renderProgressMatrix() {
        const content = state.learningEvidenceResourceError
            ? teacherLearningEvidenceResourceMarkup(state.learningEvidenceResourceError)
            : '<p>正在按明确班级与课程读取 0051 权威 aggregate。</p>';
        return `<article class="teacher-curriculum-panel teacher-curriculum-panel--progress" data-learning-evidence-teacher-aggregate>${content}</article>`;
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
        return `<span class="teacher-code-status teacher-code-status--${escapeAttr(normalized)}">${escapeHtml(CODE_STATUS_LABELS[value] || value || '未知')}</span>`;
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
                    ${renderOperation('course', 'book-plus', '创建课程', '在当前学校下建立课程内容', `
                        <form class="teacher-form" data-teacher-form="course">
                            <label><span>标题</span><input name="title" maxlength="180" required ${schoolDisabled ? 'disabled' : ''}></label>
                            <label><span>所属星系</span><select name="galaxy_key" ${schoolDisabled ? 'disabled' : ''}>${optionSet([], 'englab', [['englab', '工科试验室'], ['code-space', '代码空间'], ['future-galaxy', '未来星系']])}</select></label>
                            <label><span>课程稳定键</span><input name="course_key" maxlength="96" pattern="[a-zA-Z0-9][a-zA-Z0-9_-]*" placeholder="例如 control-flow" ${schoolDisabled ? 'disabled' : ''}></label>
                            <label><span>状态</span><select name="status" ${schoolDisabled ? 'disabled' : ''}>${optionSet(['draft', 'published', 'archived'], 'draft')}</select></label>
                            <label class="teacher-form__full"><span>摘要</span><textarea name="summary" maxlength="2000" rows="2" ${schoolDisabled ? 'disabled' : ''}></textarea></label>
                            <button type="submit" ${schoolDisabled ? 'disabled' : ''}><i data-lucide="book-plus"></i><span>创建课程</span></button>
                        </form>
                    `)}
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
        if (!state.selected.classId) return renderEmpty('请选择班级');
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
                    <h2><i data-lucide="chart-no-axes-combined"></i>学情口径</h2>
                    ${statusBadge('partial')}
                </header>
                <p class="teacher-muted">权威完成与迁移统一在“课程编排”的 0051 aggregate 区域按明确班级/课程读取；本区继续保留作业提交与教师反馈入口，不用旧访问或 knowledge 统计声明掌握。</p>
            </article>
        `;
    }

    async function handleFormSubmit(form) {
        const formType = form.dataset.teacherForm;
        if (!canStartMutation(formType)) return;
        try {
            setBusy(true);
            if (formType === 'school') await createSchool(form);
            if (formType === 'class') await createClass(form);
            if (formType === 'course') await createCourse(form);
            if (formType === 'attach') await attachCourseToClass();
            if (formType === 'unit') await createUnit(form);
            if (formType === 'assignment') await createAssignment(form);
            if (formType === 'assignment-audience') await updateAssignmentAudience(form);
            if (formType === 'assignment-class-policy') await updateAssignmentClassPolicy(form);
            if (formType === 'point-rule') await updatePointRule(form);
            if (formType === 'release-plan') await updateReleasePlan(form);
            if (formType === 'collaborator') await createCollaborator(form);
            if (formType === 'collaborator-batch') await batchUpdateCollaborators(form);
            if (formType === 'student-batch-import') await batchImportStudents(form);
            if (formType === 'student-transfer') await transferStudent(form);
            if (formType === 'grade') await gradeSubmission(form);
            form.reset();
        } catch (error) {
            await handleMutationFailure(error, formType || 'teacher-write');
        } finally {
            setBusy(false);
            renderWorkspace();
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

    async function createCourse(form) {
        const data = formData(form);
        const course = await fetchJson('/api/courses', {
            method: 'POST',
            body: {
                school_id: Number(state.selected.schoolId),
                galaxy_key: optional(data.galaxy_key),
                course_key: optional(data.course_key),
                title: data.title,
                summary: optional(data.summary),
                status: data.status || 'draft'
            }
        });
        setFlash('success', '课程已创建');
        state.selected.courseId = String(course.id);
        await reconcileConfirmedWrite('创建课程', () => loadSchoolScope());
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

    async function updateReleasePlan(form) {
        const plan = state.data.releasePlan;
        if (!plan || !state.data.curriculumAttached) throw new Error('当前班级课程发布计划尚未就绪');
        const rows = Array.from(form.querySelectorAll('[data-teacher-plan-row]'));
        if (!rows.length) throw new Error('当前课程没有可编排分块');
        const items = rows.map((row) => {
            const position = Number(row.querySelector('[data-teacher-plan-field="position"]').value);
            const releaseMode = row.querySelector('[data-teacher-plan-field="release_mode"]').value;
            const openAtValue = row.querySelector('[data-teacher-plan-field="open_at"]').value;
            const prerequisiteValue = row.querySelector('[data-teacher-plan-field="prerequisite_unit_id"]').value;
            if (!Number.isInteger(position) || position < 1) throw new Error('课程分块顺序必须是正整数');
            if (!RELEASE_MODES.includes(releaseMode)) throw new Error('课程分块呈现状态无效');
            return {
                course_unit_id: Number(row.dataset.unitId),
                position,
                release_mode: releaseMode,
                open_at: openAtValue ? new Date(openAtValue).toISOString() : null,
                prerequisite_unit_id: prerequisiteValue ? Number(prerequisiteValue) : null
            };
        });
        const positions = items.map((item) => item.position);
        if (new Set(positions).size !== positions.length) throw new Error('课程分块顺序不能重复');
        const byUnitId = new Map(items.map((item) => [item.course_unit_id, item]));
        items.forEach((item) => {
            if (!item.prerequisite_unit_id) return;
            const prerequisite = byUnitId.get(item.prerequisite_unit_id);
            if (!prerequisite || prerequisite.position >= item.position) {
                throw new Error('前置分块必须位于当前分块之前');
            }
        });
        const reason = optional(new FormData(form).get('reason'));
        try {
            const updated = await fetchJson(
                `/api/courses/${state.selected.courseId}/classes/${state.selected.classId}/release-plan`,
                {
                    method: 'PATCH',
                    body: {
                        expected_version: Number(plan.plan_version),
                        items,
                        reason
                    }
                }
            );
            state.data.releasePlan = updated;
            setFlash(updated.changed ? 'success' : 'warning', updated.changed
                ? `课程节奏已发布，权威版本更新为 v${updated.plan_version}`
                : `提交内容与权威版本 v${updated.plan_version} 一致，无需重复写入`);
            await reconcileConfirmedWrite('发布课程节奏', () => loadCurriculumScope());
        } catch (error) {
            if (Number(error && error.status) !== 409) throw error;
            await loadCurriculumScope();
            setFlash('warning', '另一位教师已更新课程节奏；系统已回读最新权威版本，请确认后重新发布');
        }
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

    async function gradeSubmission(form) {
        const data = formData(form);
        await fetchJson(`/api/submissions/${data.submission_id}/grade`, {
            method: 'PATCH',
            body: {
                score: Number(data.score) || 0,
                feedback: optional(data.feedback),
                status: data.status || 'graded'
            }
        });
        setFlash('success', '评分已提交');
        await reconcileConfirmedWrite(
            '提交评分',
            () => Promise.all([loadClassScope(), loadAssignmentScope()])
        );
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
        if (state.busy) return false;
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
    }

    function markReleasePlanDraft(control) {
        const row = control.closest('[data-teacher-plan-row]');
        if (row) row.classList.add('is-dirty');
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
        const supported = new Set(['progress', 'code', 'members', 'active-students', 'assignment-submissions', 'code-attempts']);
        if (!supported.has(kind)) return;
        if (['progress', 'code'].includes(kind) && (!classId || !courseId)) return;
        if (['members', 'active-students'].includes(kind) && !classId) return;
        if (kind === 'assignment-submissions' && !assignmentId) return;
        if (kind === 'code-attempts' && !codeSubmissionId) return;
        const generation = beginRequestGeneration();
        setBusy(true);
        try {
            if (kind === 'progress') {
                state.errors.courseProgress = null;
                const page = await fetchJson(`/api/progress/courses/${courseId}/classes/${classId}/students`, {
                    params: { limit: COURSE_PROGRESS_PAGE_LIMIT, offset }
                });
                if (!isCurrentRequest(generation)) return;
                state.data.courseProgress = page;
                state.pagination.courseProgressOffset = Number(page.offset) || 0;
            } else if (kind === 'code') {
                state.errors.codeSubmissions = null;
                const page = await fetchJson('/api/code-submissions', {
                    params: { class_id: classId, course_id: courseId, limit: CODE_SUBMISSION_PAGE_LIMIT, offset }
                });
                if (!isCurrentRequest(generation)) return;
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
                state.selected.studentId = state.data.activeStudents[0] ? String(state.data.activeStudents[0].user_id) : '';
                await loadStudentProgress(generation);
            } else if (kind === 'assignment-submissions') {
                state.errors.assignmentSubmissions = null;
                const page = await fetchJson(`/api/assignments/${assignmentId}/submissions/page`, {
                    params: {
                        class_id: classId || undefined,
                        limit: ASSIGNMENT_SUBMISSION_PAGE_LIMIT,
                        offset
                    }
                });
                if (!isCurrentRequest(generation)) return;
                state.data.assignmentSubmissionsPage = page;
                state.data.assignmentSubmissions = Array.isArray(page.items) ? page.items : [];
                state.pagination.assignmentSubmissionOffset = Number(page.offset) || 0;
            } else if (kind === 'code-attempts') {
                state.errors.codeSubmissionAttempts = null;
                const page = await fetchJson(`/api/code-submissions/${codeSubmissionId}/attempts/page`, {
                    params: { limit: CODE_ATTEMPT_PAGE_LIMIT, offset }
                });
                if (!isCurrentRequest(generation) || String(state.selected.codeSubmissionId) !== String(codeSubmissionId)) return;
                state.data.codeSubmissionAttemptsPage = page;
                state.data.codeSubmissionAttempts = Array.isArray(page.items) ? page.items : [];
                state.pagination.codeAttemptOffset = Number(page.offset) || 0;
            }
        } catch (error) {
            if (!isCurrentRequest(generation)) return;
            const errorKey = {
                progress: 'courseProgress',
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

    async function handleScopeChange(target) {
        if (state.busy) {
            renderWorkspace();
            return;
        }
        const key = target.dataset.teacherScope;
        if (key === 'galaxyKey') {
            state.filters.galaxyKey = target.value;
            resetPagination();
            const courses = filteredCourses();
            state.selected.courseId = normalizeSelectedId(state.selected.courseId, courses);
            if (!state.selected.courseId && courses.length === 1) state.selected.courseId = String(courses[0].id);
            setBusy(true);
            try {
                await loadCourseScope();
                await loadClassScope();
                await loadCurriculumScope();
            } finally {
                setBusy(false);
                renderWorkspace();
            }
            return;
        }
        state.selected[key] = target.value;
        if (key === 'schoolId' || key === 'classId' || key === 'courseId') resetPagination();
        if (key === 'assignmentId') state.pagination.assignmentSubmissionOffset = 0;
        if (key === 'schoolId' || key === 'classId') state.data.studentBatchImportResult = null;
        if (key === 'schoolId' || key === 'courseId') state.data.collaboratorBatchResult = null;
        setBusy(true);
        try {
            if (key === 'schoolId') await loadSchoolScope();
            if (key === 'classId') {
                await loadClassScope();
                await loadAssignmentScope();
                await loadCurriculumScope();
            }
            if (key === 'courseId') {
                await loadCourseScope();
                await loadClassScope();
                await loadCurriculumScope();
            }
            if (key === 'unitId') renderWorkspace();
            if (key === 'assignmentId') await loadAssignmentScope();
            if (key === 'studentId') await loadStudentProgress();
        } finally {
            setBusy(false);
            renderWorkspace();
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
            <p class="teacher-muted">统计口径 ${escapeHtml(knowledge.rule_version || 'v1')}：仅纳入已发布课程/单元、本班有效分配且有效状态为 active 的作业。</p>
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

    function renderProgress(progress) {
        if (!state.selected.studentId) return renderEmpty('暂无学生');
        if (!progress) return renderEmpty('暂无学生进度');
        return `
            <div class="teacher-metric-grid teacher-metric-grid--progress">
                ${metric('提交', progress.submitted_assignments)}
                ${metric('已评分', progress.graded_assignments)}
                ${metric('事件', progress.learning_events)}
                ${metric('完成', progress.completed_events)}
                ${metric('积分', progress.total_points)}
                ${metric('完成率', formatPercent(progress.completion_percent))}
            </div>
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
            <div class="teacher-error">
                <i data-lucide="triangle-alert"></i>
                <span>${escapeHtml(label)}：${escapeHtml(errorMessage(error))}</span>
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

    function studentOptions() {
        return state.data.activeStudents.map((member) => (
            `<option value="${member.user_id}"${String(member.user_id) === state.selected.studentId ? ' selected' : ''}>${escapeHtml(member.display_name || member.username)}</option>`
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

    function normalizeSelectedUserId(value, members) {
        if (!value) return '';
        return members.some((item) => String(item.user_id) === String(value)) ? String(value) : '';
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
            state.data.progress = null;
            state.data.studentBatchImportResult = null;
            state.data.curriculumAttached = false;
            state.data.releasePlan = null;
            state.data.courseProgress = null;
            state.data.codeSubmissions = null;
            state.data.codeSubmissionSource = null;
            state.data.codeSubmissionAttempts = [];
            state.data.codeSubmissionAttemptsPage = null;
            state.selected.codeSubmissionId = '';
        }
    }

    function clearWorkspace() {
        state.user = null;
        state.errors = {};
        resetPagination();
        Object.keys(state.data).forEach((key) => {
            state.data[key] = Array.isArray(state.data[key]) ? [] : null;
        });
        hideDashboard();
    }

    function resetPagination() {
        state.pagination.memberOffset = 0;
        state.pagination.activeStudentOffset = 0;
        state.pagination.assignmentSubmissionOffset = 0;
        state.pagination.courseProgressOffset = 0;
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
        if (state.root) state.root.classList.toggle('is-busy', state.busy);
        if (state.root) {
            state.root.querySelectorAll('[data-teacher-action="refresh"], [data-teacher-api-base]').forEach((control) => {
                control.disabled = state.busy;
            });
        }
        if (state.root && state.busy) applyWriteAvailability();
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
        if (state.busy) {
            input.value = state.apiBase;
            return;
        }
        const previous = state.apiBase;
        state.apiBase = AstraApiClient.normalizeBaseUrl(input.value);
        persistApiBase();
        if (state.apiBase !== previous) refreshAll();
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
            lockConfirmedWrite
        };
    }
})();
