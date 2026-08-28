(function () {
    'use strict';

    const STUDENT_ASSET_VERSION = '20260828v861PresentationCleanupP3';
    const API_BASE_STORAGE_KEY = 'astra-student-api-base';
    const REQUEST_TIMEOUT_MS = 12000;
    const ASSIGNMENT_PAGE_LIMIT = 8;
    const LEGACY_DEMO_TEXT = Object.freeze({ 'Physics evidence review': '机械运动证据回顾', 'Humanities claim review': '人文观点证据辨析', 'Loop boundary review': '循环边界过程回顾', 'Synthetic local-preview evidence for the review loop.': '整理本次学习证据，并说明现象与判断依据。', 'Synthetic loop trace awaiting teacher feedback.': '记录循环结束前后的条件变化，等待教师给出针对性反馈。', 'Synthetic feedback: explain the observed boundary.': '观察记录完整；请进一步解释边界条件为什么会改变最终结果。' });
    function presentationText(value) { const text = String(value || ''); return LEGACY_DEMO_TEXT[text] || text; }

    function emptyPage() {
        return { items: [], total: 0, limit: ASSIGNMENT_PAGE_LIMIT, offset: 0, next_offset: null };
    }

    function emptyData() {
        return {
            classes: [],
            schools: [],
            courses: [],
            units: [],
            assignments: emptyPage(),
            todayAssignments: emptyPage(),
            progress: null,
            points: [],
            knowledge: null,
            snapshots: emptyPage()
        };
    }

    const state = {
        root: null,
        initialized: false,
        runtimeBound: false,
        active: false,
        apiBase: '',
        user: null,
        authorized: false,
        online: navigator.onLine !== false,
        busy: false,
        loadingScope: false,
        joining: false,
        uncertainJoinClassId: '',
        scopeGeneration: 0,
        lifecycleController: null,
        scopeController: null,
        selected: {
            classId: '',
            courseId: '',
            assignmentId: ''
        },
        pagination: {
            assignmentOffset: 0,
            assignmentLimit: ASSIGNMENT_PAGE_LIMIT
        },
        assignmentFilter: 'all',
        pendingSubmissions: new Set(),
        uncertainSubmissions: new Set(),
        answers: Object.create(null),
        errors: {},
        flash: null,
        data: emptyData(),
        learningEvidenceResourceError: null,
        learningEvidenceLoadGeneration: 0,
        onOnline: null,
        onOffline: null,
        onAuthRequired: null
    };

    function initStudent() {
        state.root = document.querySelector('[data-student-workbench]');
        if (!state.root) return;

        state.active = true;
        state.online = navigator.onLine !== false;
        if (window.AstraApiClient) AstraApiClient.scrubLegacyTokens();
        state.apiBase = resolveApiBase();
        abortController(state.lifecycleController);
        state.lifecycleController = new AbortController();
        renderShell();
        mountStudentLearningEvidence();

        if (!state.initialized) {
            bindEvents();
            state.initialized = true;
        }
        bindRuntimeEvents();
        refreshAll();
    }

    function destroyStudent() {
        state.active = false;
        state.learningEvidenceLoadGeneration += 1;
        if (window.AstraStudentLearningEvidence) window.AstraStudentLearningEvidence.destroy();
        state.scopeGeneration += 1;
        abortController(state.scopeController);
        abortController(state.lifecycleController);
        state.scopeController = null;
        state.lifecycleController = null;
        unbindRuntimeEvents();

        state.user = null;
        state.authorized = false;
        state.busy = false;
        state.loadingScope = false;
        state.joining = false;
        state.uncertainJoinClassId = '';
        state.selected = { classId: '', courseId: '', assignmentId: '' };
        state.pagination.assignmentOffset = 0;
        state.pendingSubmissions.clear();
        state.uncertainSubmissions.clear();
        state.answers = Object.create(null);
        state.errors = {};
        state.flash = null;
        state.data = emptyData();
        state.learningEvidenceResourceError = null;

        if (state.root) {
            const authContainer = state.root.querySelector('[data-student-auth-state]');
            if (authContainer && window.AstraAuthUI) AstraAuthUI.unmount(authContainer);
            state.root.innerHTML = `
                <div class="student-loading">
                    <i data-lucide="loader-circle"></i>
                    <span>正在载入学生学习台</span>
                </div>
            `;
        }
    }

    function learningEvidenceResourceIssue(error) {
        return Object.freeze({
            code: String(error && error.code || 'learning_evidence_resource_failed'),
            message: '共享学习证据资源加载失败或超时；页面不会继续显示为“正在读取”。请重试加载。'
        });
    }

    function learningEvidenceResourceMarkup(issue, title) {
        return `
            <header class="astra-authority-summary__header"><div><span>数据连接提示</span><h3>${escapeHtml(title)}</h3></div></header>
            <div class="astra-authority-summary__state" role="status">
                <strong>学习记录暂时无法载入</strong>
                <p>${escapeHtml(issue.message)}</p>
                <button type="button" class="astra-authority-summary__retry" data-student-evidence-resource-retry>重试加载学习证据</button>
            </div>`;
    }

    function renderStudentLearningEvidenceResourceState() {
        if (!state.root || !state.learningEvidenceResourceError) return;
        const targets = [
            ['progress', '权威学习投影'],
            ['knowledge', '活动证据状态']
        ];
        targets.forEach(([name, title]) => {
            const container = state.root.querySelector(`[data-student-panel="${name}"]`);
            if (!container) return;
            delete container.dataset.authoritySignature;
            container.classList.add('astra-authority-summary');
            container.innerHTML = learningEvidenceResourceMarkup(state.learningEvidenceResourceError, title);
        });
    }

    async function mountStudentLearningEvidence() {
        const generation = ++state.learningEvidenceLoadGeneration;
        state.learningEvidenceResourceError = null;
        if (window.AstraStudentLearningEvidence) window.AstraStudentLearningEvidence.destroy();
        try {
            const loader = window.AstraLearningEvidenceLoader;
            if (!loader || typeof loader.ensure !== 'function') {
                const error = new Error('learning evidence loader unavailable');
                error.code = 'learning_evidence_loader_unavailable';
                throw error;
            }
            await loader.ensure({ student: true, engineeringContext: true });
            if (!state.active || generation !== state.learningEvidenceLoadGeneration) return false;
            if (!window.AstraStudentLearningEvidence || typeof window.AstraStudentLearningEvidence.mount !== 'function') {
                const error = new Error('student learning evidence owner unavailable');
                error.code = 'student_evidence_owner_unavailable';
                throw error;
            }
            window.AstraStudentLearningEvidence.mount(state.root);
            renderWorkspace();
            return true;
        } catch (error) {
            if (!state.active || generation !== state.learningEvidenceLoadGeneration) return false;
            state.learningEvidenceResourceError = learningEvidenceResourceIssue(error);
            renderStudentLearningEvidenceResourceState();
            console.warn('[StudentWorkbench] learning evidence unavailable', error && (error.code || error.message));
            return false;
        }
    }

    function renderShell() {
        state.root.innerHTML = `
            <header class="student-workbench__header">
                <div class="student-workbench__title">
                    <h1>我的学习</h1>
                    <p data-student-greeting>正在确认学习身份</p>
                </div>
                <div class="student-workbench__controls" data-student-controls hidden>
                    <label class="student-scope-control">
                        <i data-lucide="users"></i>
                        <span class="sr-only">班级</span>
                        <select data-student-scope="classId" aria-label="选择班级"></select>
                    </label>
                    <label class="student-scope-control">
                        <i data-lucide="book-open"></i>
                        <span class="sr-only">课程</span>
                        <select data-student-scope="courseId" aria-label="选择课程"></select>
                    </label>
                    <button type="button" class="student-button student-button--ghost" data-student-action="refresh">
                        <i data-lucide="refresh-cw"></i>
                        <span>刷新</span>
                    </button>
                </div>
            </header>
            <div class="student-network" data-student-network hidden></div>
            <div class="student-auth-state" data-student-auth-state></div>
            <div class="student-flash" data-student-flash hidden role="status" aria-live="polite"></div>
            <div class="student-dashboard" data-student-dashboard hidden>
                <section class="student-join-state" data-student-join-state hidden></section>
                <div class="student-layout" data-student-layout hidden>
                    <section class="student-panel student-panel--today" data-student-panel="today"></section>
                    <section class="student-panel student-panel--progress" data-student-panel="progress"></section>
                    <section class="student-panel student-panel--course" data-student-panel="course"></section>
                    <section class="student-panel student-panel--assignments" data-student-panel="assignments"></section>
                    <section class="student-panel student-panel--submission" data-student-panel="submission"></section>
                    <section class="student-panel student-panel--knowledge" data-student-panel="knowledge"></section>
                    <section class="student-panel student-panel--points" data-student-panel="points"></section>
                </div>
            </div>
        `;
        renderNetworkState();
        refreshIcons();
    }

    function bindEvents() {
        state.root.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;

            if (target.closest('[data-student-evidence-resource-retry]')) {
                mountStudentLearningEvidence();
                return;
            }

            if (target.closest('[data-student-action="refresh"]')) {
                refreshAll();
                return;
            }

            const engineeringUnitLink = target.closest('[data-student-englab-activity]');
            if (engineeringUnitLink) {
                event.preventDefault();
                const navigationGeneration = state.scopeGeneration;
                const navigationSignal = state.scopeController && state.scopeController.signal;
                window.AstraLearningEvidenceLoader.ensure({ engineeringContext: true })
                    .then(() => {
                        if (!state.active || state.scopeGeneration !== navigationGeneration || !navigationSignal || navigationSignal.aborted) return false;
                        return window.AstraEngineeringLabPublicationContext.navigateStudent(state.user, state.selected.classId, engineeringUnitLink.hash, { signal: navigationSignal });
                    })
                    .catch(error => { if (error && error.code === 'cancelled') return; setFlash('error', errorMessage(error)); renderWorkspace(); });
                return;
            }

            const assignmentButton = target.closest('[data-student-assignment-id]');
            if (assignmentButton) {
                state.selected.assignmentId = String(assignmentButton.dataset.studentAssignmentId || '');
                renderWorkspace();
                const editor = state.root.querySelector('[data-student-panel="submission"]');
                if (editor && window.matchMedia('(max-width: 760px)').matches) {
                    editor.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
                }
                return;
            }

            const filterButton = target.closest('[data-student-assignment-filter]');
            if (filterButton) {
                if (state.busy || state.loadingScope) return;
                const nextFilter = filterButton.dataset.studentAssignmentFilter || 'all';
                if (!['all', 'active', 'feedback', 'history'].includes(nextFilter) || nextFilter === state.assignmentFilter) return;
                state.assignmentFilter = nextFilter;
                state.selected.assignmentId = '';
                state.pagination.assignmentOffset = 0;
                renderAssignmentsPanel();
                refreshIcons();
                refreshAssignmentsOnly();
                return;
            }

            const pageButton = target.closest('[data-student-assignment-page]');
            if (pageButton && !pageButton.disabled && !state.busy && !state.loadingScope) {
                const direction = pageButton.dataset.studentAssignmentPage;
                if (direction === 'next' && state.data.assignments.next_offset !== null) {
                    state.pagination.assignmentOffset = Number(state.data.assignments.next_offset) || 0;
                } else if (direction === 'prev') {
                    state.pagination.assignmentOffset = Math.max(
                        0,
                        state.pagination.assignmentOffset - state.pagination.assignmentLimit
                    );
                }
                refreshAssignmentsOnly();
            }
        });

        state.root.addEventListener('change', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLSelectElement)) return;
            const scope = target.dataset.studentScope;
            if (scope === 'classId') {
                state.selected.classId = target.value;
                state.selected.courseId = '';
                state.selected.assignmentId = '';
                state.pagination.assignmentOffset = 0;
                refreshClassScope();
            } else if (scope === 'courseId') {
                state.selected.courseId = target.value;
                state.selected.assignmentId = '';
                state.pagination.assignmentOffset = 0;
                refreshCourseScope();
            }
        });

        state.root.addEventListener('input', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLTextAreaElement) || !target.dataset.studentAnswerFor) return;
            const assignmentId = target.dataset.studentAnswerFor;
            state.answers[assignmentId] = target.value;
            const counter = state.root.querySelector(`[data-student-answer-count="${cssEscape(assignmentId)}"]`);
            if (counter) counter.textContent = `${target.value.length}/5000`;
        });

        state.root.addEventListener('submit', (event) => {
            const form = event.target;
            if (!(form instanceof HTMLFormElement)) return;
            if (form.matches('[data-student-join-form]')) {
                event.preventDefault();
                handleDirectJoin(form);
                return;
            }
            if (form.matches('[data-student-submission-form]')) {
                event.preventDefault();
                handleAssignmentSubmission(form);
            }
        });
    }

    function bindRuntimeEvents() {
        if (state.runtimeBound) return;
        state.onOnline = () => {
            state.online = true;
            if (state.active) refreshAll();
        };
        state.onOffline = () => {
            state.online = false;
            abortController(state.scopeController);
            closeFutureGalaxyPublication();
            state.user = null;
            state.authorized = false;
            state.busy = false;
            state.loadingScope = false;
            state.data = emptyData();
            state.answers = Object.create(null);
            clearDashboardDom();
            hideDashboard();
            if (state.active) {
                renderAuthError(AstraApiClient.offlineError());
                setFlash('warning', '已隐藏旧学习数据；恢复网络后将重新读取后端状态');
                renderNetworkState();
                renderFlash();
                renderHeaderControls();
                refreshIcons();
            }
        };
        state.onAuthRequired = () => {
            state.scopeGeneration += 1;
            abortController(state.scopeController);
            abortController(state.lifecycleController);
            closeFutureGalaxyPublication();
            state.scopeController = null;
            state.lifecycleController = new AbortController();
            state.user = null;
            state.authorized = false;
            state.busy = false;
            state.loadingScope = false;
            state.joining = false;
            state.pendingSubmissions.clear();
            state.data = emptyData();
            state.answers = Object.create(null);
            state.uncertainSubmissions.clear();
            state.uncertainJoinClassId = '';
            clearDashboardDom();
            hideDashboard();
            if (state.active) {
                renderAuthError(new AstraApiClient.Error('登录状态已失效', { status: 401, code: 'unauthorized' }));
                renderFlash();
                refreshIcons();
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

    function futureGalaxyPublicationContext() {
        return window.FutureGalaxyPublicationContext || null;
    }

    function closeFutureGalaxyPublication() {
        const context = futureGalaxyPublicationContext();
        return context && typeof context.close === 'function' ? context.close() : false;
    }

    function buildFutureCourseIdMap(payload, manifest) {
        const context = futureGalaxyPublicationContext();
        return context && typeof context.buildCourseIdMap === 'function'
            ? context.buildCourseIdMap(payload, manifest)
            : null;
    }

    async function configureFutureGalaxyPublication(classId, coursePayload) {
        const context = futureGalaxyPublicationContext();
        if (!context || typeof context.configure !== 'function') {
            return { availability: 'unavailable', source: 'publication-context-unavailable' };
        }
        return context.configure(classId, coursePayload);
    }

    async function bootstrapFutureGalaxyPublication(user) {
        const context = futureGalaxyPublicationContext();
        if (!context || typeof context.bootstrap !== 'function') {
            return { availability: 'unavailable', source: 'publication-context-unavailable' };
        }
        return context.bootstrap(user);
    }

    async function refreshAll() {
        if (!state.root || !state.active) return;
        const scope = beginScopeRequest();
        const previousUserId = state.user && state.user.id;
        state.busy = true;
        state.errors = {};
        state.flash = null;
        state.authorized = false;
        state.user = null;
        state.data = emptyData();
        state.selected.assignmentId = '';
        clearDashboardDom();
        hideDashboard();
        renderAuthState('checking');
        renderFlash();
        renderHeaderControls();

        try {
            const user = await requestJson('/api/users/me', { signal: scope.signal });
            if (!isCurrentScope(scope)) return;
            state.user = user;
            if (previousUserId && String(previousUserId) !== String(user && user.id)) {
                state.answers = Object.create(null);
                state.uncertainSubmissions.clear();
                state.uncertainJoinClassId = '';
            }
            if (!user || user.role !== 'student') {
                state.answers = Object.create(null);
                renderAuthState('forbidden', user || {});
                return;
            }

            state.authorized = true;
            renderAuthState('ready', user);
            const classPayload = await requestJson('/api/classes', {
                params: { mine: true },
                signal: scope.signal
            });
            if (!isCurrentScope(scope)) return;
            state.data.classes = normalizeList(classPayload);
            if (state.uncertainJoinClassId) {
                const pendingClassId = state.uncertainJoinClassId;
                const joined = state.data.classes.some((item) => String(entityId(item)) === String(pendingClassId));
                updateJoinReconciliationLock(pendingClassId, joined);
                setFlash(
                    joined ? 'success' : 'warning',
                    joined
                        ? '已通过权威读取确认班级加入成功'
                        : '权威班级列表尚未显示已确认的加入结果，入口继续锁定；请稍后刷新对账'
                );
            }
            state.selected.classId = normalizeEntityId(state.selected.classId, state.data.classes);
            if (!state.selected.classId && state.data.classes.length === 1) {
                state.selected.classId = String(entityId(state.data.classes[0]));
            }
            showDashboard();

            if (!state.selected.classId) {
                closeFutureGalaxyPublication();
                state.busy = false;
                renderWorkspace();
                return;
            }
            await loadClassScope(scope);
        } catch (error) {
            if (isCancelled(error)) return;
            closeFutureGalaxyPublication();
            renderAuthError(error);
            hideDashboard();
        } finally {
            if (isCurrentScope(scope)) {
                state.busy = false;
                state.loadingScope = false;
                renderWorkspace();
                if (window.AstraStudentLearningEvidence && typeof window.AstraStudentLearningEvidence.refresh === 'function') {
                    window.AstraStudentLearningEvidence.refresh();
                }
            }
        }
    }

    async function refreshClassScope() {
        const scope = beginScopeRequest();
        const publication = window.AstraEngineeringLabPublicationContext;
        if (publication && typeof publication.switchClass === 'function') void publication.switchClass(state.user, state.selected.classId, { signal: scope.signal });
        if (!state.authorized || !state.selected.classId) {
            if (state.authorized) closeFutureGalaxyPublication();
            renderWorkspace();
            return;
        }
        state.loadingScope = true;
        state.errors = {};
        state.data.schools = [];
        state.data.courses = [];
        state.data.units = [];
        state.data.assignments = emptyPage();
        state.data.todayAssignments = emptyPage();
        state.data.progress = null;
        state.data.points = [];
        state.data.knowledge = null;
        state.data.snapshots = emptyPage();
        renderWorkspace();
        try {
            await loadClassScope(scope);
        } catch (error) {
            if (!isCancelled(error)) setFlash('error', errorMessage(error));
        } finally {
            if (isCurrentScope(scope)) {
                state.loadingScope = false;
                renderWorkspace();
            }
        }
    }

    async function loadClassScope(scope) {
        const classId = state.selected.classId;
        state.loadingScope = true;
        const results = await Promise.allSettled([
            requestJson('/api/schools', { params: { class_id: classId }, signal: scope.signal }),
            requestJson('/api/courses', { params: { class_id: classId }, signal: scope.signal }),
            requestJson('/api/progress/me', { params: { class_id: classId }, signal: scope.signal }),
            requestJson('/api/points/ledger', { params: { class_id: classId }, signal: scope.signal })
        ]);
        if (!isCurrentScope(scope)) return;

        applySettledList(results[0], 'schools');
        applySettledList(results[1], 'courses');
        applySettledValue(results[2], 'progress');
        applySettledList(results[3], 'points');

        if (results[1].status === 'fulfilled') {
            void configureFutureGalaxyPublication(classId, state.data.courses);
        } else {
            closeFutureGalaxyPublication();
        }

        state.selected.courseId = normalizeEntityId(state.selected.courseId, state.data.courses);
        if (!state.selected.courseId && state.data.courses.length === 1) {
            state.selected.courseId = String(entityId(state.data.courses[0]));
        }
        await loadCourseScope(scope);
        if (!isCurrentScope(scope)) return;
        state.loadingScope = false;
        renderWorkspace();
    }

    async function refreshCourseScope() {
        if (!state.authorized || !state.selected.classId) return;
        const scope = beginScopeRequest();
        state.loadingScope = true;
        state.errors.units = null;
        state.errors.assignments = null;
        state.errors.knowledge = null;
        state.errors.snapshots = null;
        state.data.units = [];
        state.data.assignments = emptyPage();
        state.data.todayAssignments = emptyPage();
        state.data.knowledge = null;
        state.data.snapshots = emptyPage();
        renderWorkspace();
        try {
            await loadCourseScope(scope);
        } catch (error) {
            if (!isCancelled(error)) setFlash('error', errorMessage(error));
        } finally {
            if (isCurrentScope(scope)) {
                state.loadingScope = false;
                renderWorkspace();
            }
        }
    }

    async function loadCourseScope(scope) {
        const classId = state.selected.classId;
        const courseId = state.selected.courseId;
        const assignmentParams = {
            class_id: classId,
            course_id: courseId || undefined,
            filter: state.assignmentFilter,
            limit: state.pagination.assignmentLimit,
            offset: state.pagination.assignmentOffset
        };
        const knowledgeParams = {
            class_id: classId,
            course_id: courseId || undefined
        };
        const assignmentRequest = requestJson('/api/assignments/me', {
            params: assignmentParams,
            signal: scope.signal
        });
        const todayAssignmentRequest = state.assignmentFilter === 'active'
            ? assignmentRequest
            : requestJson('/api/assignments/me', {
                params: {
                    class_id: classId,
                    course_id: courseId || undefined,
                    filter: 'active',
                    limit: 200,
                    offset: 0
                },
                signal: scope.signal
            });
        const requests = [
            courseId
                ? requestJson(`/api/courses/${courseId}/units`, {
                    params: { class_id: classId },
                    signal: scope.signal
                })
                : Promise.resolve([]),
            assignmentRequest,
            requestJson('/api/knowledge/me', { params: knowledgeParams, signal: scope.signal }),
            requestJson('/api/knowledge/me/snapshots', {
                params: { ...knowledgeParams, limit: 4, offset: 0 },
                signal: scope.signal
            }),
            todayAssignmentRequest
        ];
        const results = await Promise.allSettled(requests);
        if (!isCurrentScope(scope)) return;

        applySettledList(results[0], 'units');
        applySettledPage(results[1], 'assignments');
        if (results[1].status === 'fulfilled') clearSubmissionUncertainty(state.data.assignments.items);
        applySettledValue(results[2], 'knowledge');
        applySettledPage(results[3], 'snapshots');
        applySettledPage(results[4], 'todayAssignments');
        normalizeSelectedAssignment();
    }

    async function refreshAssignmentsOnly() {
        if (!state.selected.classId) return;
        const scope = beginScopeRequest();
        state.errors.assignments = null;
        try {
            const payload = await requestJson('/api/assignments/me', {
                params: assignmentQueryParams(),
                signal: scope.signal
            });
            if (!isCurrentScope(scope)) return;
            state.data.assignments = normalizePage(payload);
            state.errors.assignments = null;
            clearSubmissionUncertainty(state.data.assignments.items);
            normalizeSelectedAssignment();
        } catch (error) {
            if (!isCancelled(error)) state.errors.assignments = error;
        } finally {
            if (isCurrentScope(scope)) renderWorkspace();
        }
    }

    async function handleDirectJoin(form) {
        if (state.joining || state.uncertainJoinClassId || !state.online) {
            if (state.uncertainJoinClassId) {
                setFlash('warning', '上一次加入结果尚未确认，请先刷新完成对账');
                renderFlash();
            }
            return;
        }
        const formData = new FormData(form);
        const classId = Number(formData.get('class_id'));
        if (!Number.isInteger(classId) || classId < 1) {
            setFlash('error', '请输入有效的班级 ID');
            renderFlash();
            return;
        }

        state.joining = true;
        renderWorkspace();
        try {
            await requestJson(`/api/classes/${classId}/join`, {
                method: 'POST',
                body: { role: 'student' }
            });
            state.uncertainJoinClassId = String(classId);
            await refreshAll();
            const joined = state.data.classes.some((item) => String(entityId(item)) === String(classId));
            updateJoinReconciliationLock(classId, joined);
            setFlash(
                joined ? 'success' : 'warning',
                joined
                    ? '服务器已确认加入班级，学习范围已刷新'
                    : '服务器已确认加入请求；权威列表暂未显示该班级，入口保持锁定且不会重复发送'
            );
        } catch (error) {
            if (isCancelled(error) && !AstraApiClient.isAmbiguousMutation(error)) return;
            if (error.confirmed || AstraApiClient.isAmbiguousMutation(error)) {
                state.uncertainJoinClassId = String(classId);
                if (!state.active) return;
                const outcome = await reconcileJoin(classId);
                if (outcome.found) {
                    updateJoinReconciliationLock(classId, true);
                    setFlash('success', '已通过本人班级列表确认加入成功，未重复发送');
                } else if (outcome.refreshed) {
                    updateJoinReconciliationLock(classId, false);
                    setFlash('warning', '加入请求未自动重试；权威班级列表暂未显示结果，入口继续锁定，请稍后刷新对账');
                } else {
                    setFlash('error', '加入结果尚未确认，系统未自动重试；当前加入入口已锁定，请恢复网络后刷新对账');
                }
            } else {
                setFlash('error', errorMessage(error));
            }
            renderFlash();
        } finally {
            state.joining = false;
            renderWorkspace();
        }
    }

    async function reconcileJoin(classId) {
        try {
            const payload = await requestJson('/api/classes', { params: { mine: true } });
            const classes = normalizeList(payload);
            state.data.classes = classes;
            const found = classes.some((item) => String(entityId(item)) === String(classId));
            if (found) {
                state.selected.classId = String(classId);
                await refreshAll();
            }
            return { refreshed: true, found };
        } catch (error) {
            if (!isCancelled(error)) state.errors.classes = error;
            return { refreshed: false, found: false };
        }
    }

    async function handleAssignmentSubmission(form) {
        const assignmentId = String(form.dataset.assignmentId || '');
        const item = findAssignmentItem(assignmentId);
        if (!item || !itemCanSubmit(item) || state.pendingSubmissions.has(assignmentId) || !state.online) return;

        const answer = String(state.answers[assignmentId] || '').trim();
        if (!answer) {
            setFlash('error', '请输入作业内容后再提交');
            renderFlash();
            return;
        }

        const classId = state.selected.classId;
        const courseId = state.selected.courseId;
        state.pendingSubmissions.add(assignmentId);
        renderWorkspace();

        try {
            const createdSubmission = await requestJson(`/api/assignments/${assignmentId}/submissions`, {
                method: 'POST',
                body: {
                    class_id: Number(classId),
                    content: { answer }
                }
            });
            updateSubmissionReconciliationLock(assignmentId, false);
            applyConfirmedSubmission(assignmentId, createdSubmission);
            delete state.answers[assignmentId];
            const outcome = await reconcileSubmission(assignmentId, classId, courseId);
            const confirmedInAuthority = updateSubmissionReconciliationLock(assignmentId, outcome.found);
            setFlash(
                confirmedInAuthority ? 'success' : 'warning',
                confirmedInAuthority
                    ? '作业已提交，提交记录已刷新'
                    : outcome.refreshed
                        ? '服务器已确认提交；权威列表暂未显示记录，当前作业保持锁定且不会重复发送'
                        : '服务器已确认提交；列表刷新失败，当前作业保持锁定，请稍后刷新对账'
            );
        } catch (error) {
            if (isCancelled(error) && !AstraApiClient.isAmbiguousMutation(error)) return;
            if (error.status === 409 || error.confirmed || error.ambiguous) {
                state.uncertainSubmissions.add(assignmentId);
                if (!state.active) return;
                const outcome = await reconcileSubmission(assignmentId, classId, courseId);
                updateSubmissionReconciliationLock(assignmentId, outcome.found);
                if (outcome.found) {
                    delete state.answers[assignmentId];
                    setFlash('success', '已确认服务器存在本次提交，未重复发送');
                } else if (!outcome.refreshed) {
                    setFlash('error', '提交结果仍未确认，未自动重投；该作业已临时锁定，请先刷新完成对账');
                } else if (error.status === 409) {
                    setFlash('error', `${errorMessage(error)}；作业列表已刷新，请按最新状态处理`);
                } else {
                    setFlash('error', '网络结果不明确，未自动重投。作业列表已刷新，请确认状态后手动决定');
                }
            } else {
                setFlash('error', errorMessage(error));
            }
        } finally {
            state.pendingSubmissions.delete(assignmentId);
            renderWorkspace();
        }
    }

    async function reconcileSubmission(assignmentId, classId, courseId) {
        const results = await Promise.allSettled([
            requestJson('/api/assignments/me', {
                params: {
                    ...assignmentQueryParams(),
                    class_id: classId,
                    course_id: courseId || undefined
                }
            }),
            requestJson('/api/progress/me', {
                params: { class_id: classId }
            }),
            requestJson('/api/knowledge/me', {
                params: {
                    class_id: classId,
                    course_id: courseId || undefined
                }
            })
        ]);
        applySettledValue(results[1], 'progress');
        applySettledValue(results[2], 'knowledge');

        if (results[0].status === 'fulfilled') {
            state.data.assignments = normalizePage(results[0].value);
            state.errors.assignments = null;
            clearSubmissionUncertainty(state.data.assignments.items);
            const found = state.data.assignments.items.find((item) => String(assignmentIdOf(item)) === String(assignmentId));
            state.selected.assignmentId = String(assignmentId);
            normalizeSelectedAssignment();
            return { refreshed: true, found: Boolean(found && submissionOf(found)) };
        }
        if (!isCancelled(results[0].reason)) state.errors.assignments = results[0].reason;
        return { refreshed: false, found: false };
    }

    function applyConfirmedSubmission(assignmentId, submission) {
        if (!submission) return;
        const pages = [state.data.assignments, state.data.todayAssignments];
        pages.forEach((page) => {
            const item = (page.items || []).find((candidate) => (
                String(assignmentIdOf(candidate)) === String(assignmentId)
            ));
            if (!item) return;
            item.submission = submission;
            item.can_submit = false;
            item.read_only = true;
            item.submit_block_reason = 'already_submitted';
        });
    }

    function updateJoinReconciliationLock(classId, found) {
        if (found) {
            state.uncertainJoinClassId = '';
            return true;
        }
        state.uncertainJoinClassId = String(classId || '');
        return false;
    }

    function updateSubmissionReconciliationLock(assignmentId, found) {
        const normalizedId = String(assignmentId || '');
        if (!normalizedId) return false;
        if (found) {
            state.uncertainSubmissions.delete(normalizedId);
            return true;
        }
        state.uncertainSubmissions.add(normalizedId);
        return false;
    }

    function clearSubmissionUncertainty(items) {
        (items || []).forEach((item) => {
            if (submissionOf(item)) {
                state.uncertainSubmissions.delete(String(assignmentIdOf(item)));
            }
        });
    }

    function renderWorkspace() {
        if (!state.root) return;
        renderNetworkState();
        renderFlash();
        renderHeaderControls();
        const dashboard = getDashboard();
        if (!dashboard || !state.authorized) return;

        dashboard.hidden = false;
        const joinState = state.root.querySelector('[data-student-join-state]');
        const layout = state.root.querySelector('[data-student-layout]');
        const hasClass = Boolean(state.selected.classId && state.data.classes.length);
        if (joinState) {
            joinState.hidden = hasClass;
            if (!hasClass) joinState.innerHTML = renderJoinState();
        }
        if (layout) layout.hidden = !hasClass;
        if (!hasClass) {
            refreshIcons();
            return;
        }

        renderTodayPanel();
        renderProgressPanel();
        renderCoursePanel();
        renderAssignmentsPanel();
        renderSubmissionPanel();
        renderKnowledgePanel();
        renderPointsPanel();
        refreshIcons();
    }

    function renderHeaderControls() {
        if (!state.root) return;
        const greeting = state.root.querySelector('[data-student-greeting]');
        if (greeting) {
            greeting.textContent = state.user
                ? `欢迎回来，${state.user.display_name || state.user.username || '同学'}`
                : '正在确认学习身份';
        }

        const controls = state.root.querySelector('[data-student-controls]');
        if (!controls) return;
        controls.hidden = !state.authorized;
        if (!state.authorized) return;
        const classSelect = controls.querySelector('[data-student-scope="classId"]');
        const courseSelect = controls.querySelector('[data-student-scope="courseId"]');
        const locked = state.busy || state.loadingScope || state.pendingSubmissions.size > 0 || state.joining;

        if (classSelect) {
            classSelect.innerHTML = state.data.classes.length
                ? `${state.data.classes.length > 1 ? `<option value=""${state.selected.classId ? '' : ' selected'}>请选择班级</option>` : ''}${state.data.classes.map((item) => {
                    const label = [item.name || `班级 ${entityId(item)}`, item.grade, item.term].filter(Boolean).join(' · ');
                    return `<option value="${escapeAttr(entityId(item))}"${String(entityId(item)) === state.selected.classId ? ' selected' : ''}>${escapeHtml(label)}</option>`;
                }).join('')}`
                : '<option value="">尚未加入班级</option>';
            classSelect.disabled = locked || !state.data.classes.length;
        }
        if (courseSelect) {
            courseSelect.innerHTML = state.data.courses.length
                ? `${state.data.courses.length > 1 ? `<option value=""${state.selected.courseId ? '' : ' selected'}>请选择课程</option>` : ''}${state.data.courses.map((item) => (
                    `<option value="${escapeAttr(entityId(item))}"${String(entityId(item)) === state.selected.courseId ? ' selected' : ''}>${escapeHtml(item.title || `课程 ${entityId(item)}`)}</option>`
                )).join('')}`
                : '<option value="">暂无已发布课程</option>';
            courseSelect.disabled = locked || !state.data.courses.length;
        }
        const refreshButton = controls.querySelector('[data-student-action="refresh"]');
        if (refreshButton) refreshButton.disabled = locked;
        state.root.classList.toggle('is-busy', state.busy || state.loadingScope);
    }

    function renderAuthState(mode, user) {
        const container = state.root && state.root.querySelector('[data-student-auth-state]');
        if (!container) return;
        if (window.AstraAuthUI) AstraAuthUI.unmount(container);
        if (mode === 'checking') {
            container.innerHTML = `
                <div class="student-auth-card student-auth-card--checking">
                    <i data-lucide="loader-circle"></i>
                    <div><strong>正在校验学生会话</strong><span>学习数据仅在权限确认后加载</span></div>
                </div>
            `;
            return;
        }
        if (mode === 'forbidden') {
            if (window.AstraAuthUI) {
                AstraAuthUI.mountAccount(container, {
                    role: 'student', baseUrl: state.apiBase, user: user || {}, roleMismatch: true,
                    onSignedOut: () => refreshAll()
                });
                return;
            }
            container.innerHTML = `
                <div class="student-auth-card student-auth-card--blocked">
                    <i data-lucide="shield-x"></i>
                    <div>
                        <strong>当前账号不是学生身份</strong>
                        <span>${escapeHtml((user && (user.display_name || user.username)) || '当前会话')} · ${escapeHtml((user && user.role) || 'unknown')}</span>
                    </div>
                </div>
            `;
            refreshIcons();
            return;
        }
        if (window.AstraAuthUI) {
            AstraAuthUI.mountAccount(container, {
                role: 'student', baseUrl: state.apiBase, user: user || {},
                onSignedOut: () => refreshAll()
            });
            return;
        }
        container.innerHTML = `
            <div class="student-auth-card student-auth-card--ready">
                <i data-lucide="circle-check"></i>
                <div>
                    <strong>学生会话已连接</strong>
                    <span>${escapeHtml(user.username || '')} · 实时数据不写入本地存储</span>
                </div>
            </div>
        `;
        refreshIcons();
    }

    function renderAuthError(error) {
        const container = state.root && state.root.querySelector('[data-student-auth-state]');
        if (!container) return;
        const greeting = state.root && state.root.querySelector('[data-student-greeting]');
        const isUnauthenticated = error && error.status === 401;
        const isForbidden = error && error.status === 403;
        const isOffline = error && error.code === 'offline';
        if (isUnauthenticated && window.AstraAuthUI) {
            AstraAuthUI.mountGate(container, {
                role: 'student', baseUrl: state.apiBase,
                onAuthenticated: () => refreshAll()
            });
            if (greeting) greeting.textContent = '登录后进入学生学习台';
            return;
        }
        if (window.AstraAuthUI) AstraAuthUI.unmount(container);
        if (greeting) {
            greeting.textContent = isUnauthenticated
                ? '学习会话需要重新登录'
                : isForbidden
                    ? '当前账号无学生权限'
                    : isOffline
                        ? '当前离线，实时数据已停止'
                        : '暂时无法连接学习服务';
        }
        container.innerHTML = `
            <div class="student-auth-card student-auth-card--blocked">
                <i data-lucide="${isUnauthenticated ? 'lock' : isForbidden ? 'shield-x' : isOffline ? 'wifi-off' : 'server-off'}"></i>
                <div>
                    <strong>${isUnauthenticated ? '需要有效的学生会话' : isForbidden ? '当前账号无学生权限' : isOffline ? '当前处于离线状态' : '后端连接失败'}</strong>
                    <span>${escapeHtml(errorMessage(error))}</span>
                </div>
            </div>
        `;
        refreshIcons();
    }

    function renderNetworkState() {
        const container = state.root && state.root.querySelector('[data-student-network]');
        if (!container) return;
        container.hidden = state.online;
        container.textContent = state.online
            ? ''
            : '当前离线：旧学习数据已隐藏，所有写操作已停用；恢复联网后会重新校验会话与数据。';
    }

    function renderFlash() {
        const container = state.root && state.root.querySelector('[data-student-flash]');
        if (!container) return;
        if (!state.flash) {
            container.hidden = true;
            container.textContent = '';
            return;
        }
        container.hidden = false;
        container.className = `student-flash student-flash--${state.flash.type}`;
        container.textContent = state.flash.message;
    }

    function renderJoinState() {
        if (state.data.classes.length > 1) {
            return `
                <div class="student-empty-hero">
                    <span class="student-empty-hero__icon"><i data-lucide="users-round"></i></span>
                    <div>
                        <h2>请选择一个班级</h2>
                        <p>你加入了多个班级。选择班级后，系统才会读取该班级的课程发布状态与学习内容。</p>
                    </div>
                </div>
            `;
        }
        return `
            <div class="student-empty-hero">
                <span class="student-empty-hero__icon"><i data-lucide="users-round"></i></span>
                <div>
                    <h2>还没有可用班级</h2>
                    <p>输入教师提供的班级 ID 直接加入。加入成功后才会加载课程、作业与个人学习数据。</p>
                </div>
                <form class="student-join-form" data-student-join-form>
                    <label>
                        <span>班级 ID</span>
                        <input name="class_id" type="number" inputmode="numeric" min="1" required autocomplete="off" placeholder="例如 1024">
                    </label>
                    <button type="submit" class="student-button student-button--primary"${state.joining || state.uncertainJoinClassId || !state.online ? ' disabled' : ''}>
                        <i data-lucide="log-in"></i>
                        <span>${state.joining ? '正在加入' : state.uncertainJoinClassId ? '等待对账' : '加入班级'}</span>
                    </button>
                </form>
            </div>
        `;
    }

    function renderTodayPanel() {
        const container = panel('today');
        if (!container) return;
        const items = state.data.todayAssignments.items || [];
        const actionable = items
            .filter(itemCanSubmit)
            .slice()
            .sort((a, b) => dueTimestamp(assignmentOf(a)) - dueTimestamp(assignmentOf(b)))[0];
        const selected = items.find((item) => (
            String(assignmentIdOf(item)) === state.selected.assignmentId
        ));
        const focus = actionable || selected || items[0];
        container.innerHTML = panelHeader('今日任务', 'calendar-check') + (state.errors.todayAssignments
            ? renderPanelError(state.errors.todayAssignments, '任务读取失败')
            : state.loadingScope && !items.length
                ? renderLoading('正在整理当前任务')
                : focus
                    ? renderTodayTask(focus)
                    : renderEmpty('当前课程暂无作业任务'));
    }

    function renderTodayTask(item) {
        const assignment = assignmentOf(item);
        const course = courseOf(item) || selectedCourse();
        const unit = unitOf(item);
        const due = dueInfo(assignment.due_at);
        const action = itemCanSubmit(item) ? '继续作业' : submissionOf(item) ? '查看记录' : '查看作业';
        return `
            <div class="student-today-task">
                <span class="student-today-task__icon"><i data-lucide="${itemCanSubmit(item) ? 'clipboard-pen-line' : 'book-open-check'}"></i></span>
                <div class="student-today-task__copy">
                    <strong>${escapeHtml(presentationText(assignment.title) || '未命名作业')}</strong>
                    <span>${escapeHtml([unit && unit.title, course && course.title].filter(Boolean).join(' · ') || '当前课程')}</span>
                    <small class="${due.overdue ? 'is-overdue' : ''}">${escapeHtml(due.label)}</small>
                </div>
                <button type="button" class="student-button ${itemCanSubmit(item) ? 'student-button--primary' : 'student-button--ghost'}" data-student-assignment-id="${escapeAttr(assignmentIdOf(item))}">
                    <span>${escapeHtml(action)}</span>
                </button>
            </div>
        `;
    }

    function renderProgressPanel() {
        const container = panel('progress');
        if (!container) return;
        delete container.dataset.authoritySignature;
        if (state.learningEvidenceResourceError) {
            container.classList.add('astra-authority-summary');
            container.innerHTML = learningEvidenceResourceMarkup(state.learningEvidenceResourceError, '权威学习投影');
            return;
        }
        container.innerHTML = renderLoading('正在读取 0051 权威学习投影');
    }

    function renderCoursePanel() {
        const container = panel('course');
        if (!container) return;
        const course = selectedCourse();
        const units = state.data.units || [];
        const context = window.AstraEngineeringLabPublicationContext;
        const visibleUnits = context ? units.map(context.describeStudentUnit).filter(Boolean) : [];
        container.innerHTML = panelHeader('课程内容', 'route', course ? course.title : '') + (state.errors.units
            ? renderPanelError(state.errors.units, '课程内容读取失败')
            : state.loadingScope && !units.length
                ? renderLoading('正在载入课程内容')
                : !course
                    ? renderEmpty('当前班级暂无已发布课程')
                    : `
                        ${course.summary ? `<p class="student-course-summary">${escapeHtml(course.summary)}</p>` : ''}
                        ${visibleUnits.length ? `
                            <ol class="student-unit-rail">
                                ${visibleUnits.map((unit) => `<li data-student-unit-state="${unit.release_state}">
                                    <span class="student-unit-index">${unit.position}</span>
                                    <div><strong>${escapeHtml(unit.title)}</strong><small>${unit.release_state === 'open' ? '开放学习' : '教师已锁定'}</small></div>
                                    ${unit.executable ? `<a href="#${escapeAttr(unit.content_slug)}" aria-label="进入 ${escapeAttr(unit.title)}"${unit.engineering_activity ? ` data-student-englab-activity="${unit.activity_key}"` : ''}><i data-lucide="arrow-up-right"></i></a>` : `<span class="student-unit-no-link"${unit.release_state === 'open' ? '' : ` aria-label="${escapeAttr(unit.title)}当前被教师锁定"`}>${unit.release_state === 'open' ? '待绑定' : '暂不可进入'}</span>`}
                                </li>`).join('')}
                            </ol>
                        ` : renderEmpty('该课程暂无当前可见单元')}
                    `);
    }

    function renderAssignmentsPanel() {
        const container = panel('assignments');
        if (!container) return;
        const allItems = state.data.assignments.items || [];
        const total = Number(state.data.assignments.total || allItems.length);
        container.innerHTML = `
            ${panelHeader('作业中心', 'clipboard-list', `${formatNumber(total)} 项`)}
            <div class="student-assignment-tabs" role="tablist" aria-label="作业筛选">
                ${assignmentTab('all', '全部记录')}
                ${assignmentTab('active', '进行中')}
                ${assignmentTab('feedback', '已批改')}
                ${assignmentTab('history', '历史')}
            </div>
            ${state.errors.assignments
                ? renderPanelError(state.errors.assignments, '作业列表读取失败')
                : state.loadingScope && !allItems.length
                    ? renderLoading('正在载入作业')
                    : allItems.length
                        ? `<div class="student-assignment-list">${allItems.map(renderAssignmentRow).join('')}</div>`
                        : renderEmpty(state.assignmentFilter === 'all' ? '暂无作业记录' : '当前筛选下暂无作业')}
            ${renderAssignmentPager()}
        `;
    }

    function renderAssignmentRow(item) {
        const assignment = assignmentOf(item);
        const submission = submissionOf(item);
        const due = dueInfo(assignment.due_at);
        const selected = String(assignmentIdOf(item)) === state.selected.assignmentId;
        const status = assignmentStatus(item);
        const unit = unitOf(item);
        const action = itemCanSubmit(item) ? '提交作业' : submission && submission.feedback ? '查看反馈' : '查看记录';
        return `
            <article class="student-assignment-row${selected ? ' is-selected' : ''}">
                <span class="student-assignment-row__index">${escapeHtml(assignmentIdOf(item))}</span>
                <div class="student-assignment-row__copy">
                    <div><strong>${escapeHtml(presentationText(assignment.title) || '未命名作业')}</strong>${statusPill(status)}</div>
                    <span>${escapeHtml((unit && unit.title) || '课程作业')}</span>
                    <small class="${due.overdue ? 'is-overdue' : ''}">${escapeHtml(due.label)}</small>
                </div>
                <button type="button" class="student-button student-button--compact ${itemCanSubmit(item) ? 'student-button--outline' : 'student-button--ghost'}" data-student-assignment-id="${escapeAttr(assignmentIdOf(item))}">
                    <span>${escapeHtml(action)}</span><i data-lucide="chevron-right"></i>
                </button>
            </article>
        `;
    }

    function renderSubmissionPanel() {
        const container = panel('submission');
        if (!container) return;
        const item = selectedAssignmentItem();
        if (state.errors.assignments && !item) {
            container.innerHTML = panelHeader('提交与反馈', 'send') + renderPanelError(state.errors.assignments, '作业详情不可用');
            return;
        }
        if (!item) {
            container.innerHTML = panelHeader('提交与反馈', 'send') + renderEmpty('从作业中心选择一项查看详情');
            return;
        }

        const assignment = assignmentOf(item);
        const submission = submissionOf(item);
        const assignmentId = String(assignmentIdOf(item));
        const pending = state.pendingSubmissions.has(assignmentId);
        const due = dueInfo(assignment.due_at);
        const unit = unitOf(item);
        const answer = state.answers[assignmentId] || '';
        const canSubmit = itemCanSubmit(item);
        const blockedReason = state.uncertainSubmissions.has(assignmentId)
            ? '提交结果尚未确认，请先刷新作业列表完成对账'
            : submitBlockLabel(item.submit_block_reason);

        container.innerHTML = `
            ${panelHeader('提交与反馈', 'send')}
            <div class="student-submission-heading">
                <div>
                    <h3>${escapeHtml(presentationText(assignment.title) || '未命名作业')}</h3>
                    <p>${escapeHtml((unit && unit.title) || '课程作业')} · 满分 ${formatNumber(assignment.max_score)} 分</p>
                </div>
                ${statusPill(assignmentStatus(item))}
            </div>
            <p class="student-submission-due ${due.overdue ? 'is-overdue' : ''}">${escapeHtml(due.label)}${due.overdue && canSubmit ? ' · 当前仍开放提交' : ''}</p>
            ${assignment.description ? `<div class="student-assignment-description">${escapeHtml(presentationText(assignment.description))}</div>` : ''}
            ${submission
                ? renderSubmissionReview(submission)
                : canSubmit
                    ? `
                        <form class="student-submission-form" data-student-submission-form data-assignment-id="${escapeAttr(assignmentId)}">
                            <label>
                                <span>我的答案</span>
                                <textarea data-student-answer-for="${escapeAttr(assignmentId)}" maxlength="5000" rows="8" required placeholder="在此输入作业内容…">${escapeHtml(answer)}</textarea>
                                <small data-student-answer-count="${escapeAttr(assignmentId)}">${answer.length}/5000</small>
                            </label>
                            <p>提交后不可重复提交；网络结果不明确时系统只刷新记录对账，不会自动重投。</p>
                            <button type="submit" class="student-button student-button--primary student-button--wide"${pending || !state.online ? ' disabled' : ''}>
                                <i data-lucide="${pending ? 'loader-circle' : 'send'}"></i>
                                <span>${pending ? '正在确认提交' : '提交作业'}</span>
                            </button>
                        </form>
                    `
                    : `<div class="student-readonly-state"><i data-lucide="lock-keyhole"></i><div><strong>当前作业为只读</strong><span>${escapeHtml(blockedReason || '当前状态不允许提交')}</span></div></div>`}
        `;
    }

    function renderSubmissionReview(submission) {
        const answer = extractSubmissionAnswer(submission.content);
        const hasScore = submission.score !== null && submission.score !== undefined;
        return `
            <div class="student-review-block">
                <div class="student-review-block__meta">
                    <span>${statusPill(submission.status || 'submitted')}</span>
                    <span>提交于 ${escapeHtml(formatDate(submission.submitted_at))}</span>
                    ${hasScore ? `<strong>${formatNumber(submission.score)} 分</strong>` : ''}
                </div>
                <div class="student-review-copy">
                    <span>我的提交</span>
                    <div>${escapeHtml(answer || '未提供可显示的正文')}</div>
                </div>
                <div class="student-feedback ${submission.feedback ? 'has-feedback' : ''}">
                    <span><i data-lucide="message-circle-more"></i> 教师反馈</span>
                    <p>${escapeHtml(presentationText(submission.feedback) || '教师尚未留下反馈')}</p>
                </div>
            </div>
        `;
    }

    function renderKnowledgePanel() {
        const container = panel('knowledge');
        if (!container) return;
        delete container.dataset.authoritySignature;
        if (state.learningEvidenceResourceError) {
            container.classList.add('astra-authority-summary');
            container.innerHTML = learningEvidenceResourceMarkup(state.learningEvidenceResourceError, '活动证据状态');
            return;
        }
        container.innerHTML = renderLoading('正在读取服务端活动证据状态');
    }

    function renderPointsPanel() {
        const container = panel('points');
        if (!container) return;
        const points = (state.data.points || []).slice().sort((a, b) => Number(b.id || 0) - Number(a.id || 0)).slice(0, 6);
        const total = state.data.progress && state.data.progress.total_points;
        container.innerHTML = panelHeader('积分记录', 'badge-cent') + (state.errors.points
            ? renderPanelError(state.errors.points, '积分记录读取失败')
            : state.loadingScope && !state.data.progress
                ? renderLoading('正在载入积分')
                : `
                    <div class="student-points-total"><i data-lucide="coins"></i><span>当前积分</span><strong>${formatNumber(total)}</strong></div>
                    ${points.length ? `
                        <div class="student-points-list">
                            ${points.map((item) => `
                                <div>
                                    <span>${escapeHtml(pointReasonLabel(item.reason))}${item.assignment_id ? ' · 指定作业' : ''}</span>
                                    <strong class="${Number(item.delta) >= 0 ? 'is-positive' : 'is-negative'}">${Number(item.delta) >= 0 ? '+' : ''}${formatNumber(item.delta)}</strong>
                                </div>
                            `).join('')}
                        </div>
                    ` : renderEmpty('当前班级暂无积分流水')}
                `);
    }

    function panelHeader(title, icon, meta) {
        return `
            <header class="student-panel__header">
                <h2><i data-lucide="${escapeAttr(icon)}"></i>${escapeHtml(title)}</h2>
                ${meta ? `<span>${escapeHtml(meta)}</span>` : ''}
            </header>
        `;
    }

    function assignmentTab(value, label) {
        const selected = state.assignmentFilter === value;
        const disabled = state.busy || state.loadingScope;
        return `<button type="button" role="tab" aria-selected="${selected ? 'true' : 'false'}" data-student-assignment-filter="${escapeAttr(value)}" class="${selected ? 'is-active' : ''}"${disabled ? ' disabled' : ''}>${escapeHtml(label)}</button>`;
    }

    function renderAssignmentPager() {
        const page = state.data.assignments;
        if (!page || (!page.total && !page.items.length)) return '';
        const hasPrev = Number(page.offset || 0) > 0;
        const hasNext = page.next_offset !== null && page.next_offset !== undefined;
        const pageNumber = Math.floor(Number(page.offset || 0) / Number(page.limit || ASSIGNMENT_PAGE_LIMIT)) + 1;
        return `
            <div class="student-pager">
                <span>第 ${pageNumber} 页 · 共 ${formatNumber(page.total)} 项</span>
                <div>
                    <button type="button" data-student-assignment-page="prev" aria-label="上一页"${hasPrev && !state.busy && !state.loadingScope ? '' : ' disabled'}><i data-lucide="chevron-left"></i></button>
                    <button type="button" data-student-assignment-page="next" aria-label="下一页"${hasNext && !state.busy && !state.loadingScope ? '' : ' disabled'}><i data-lucide="chevron-right"></i></button>
                </div>
            </div>
        `;
    }

    function statusPill(value) {
        const normalized = String(value || 'unknown').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
        return `<span class="student-status student-status--${escapeAttr(normalized)}">${escapeHtml(statusLabel(value))}</span>`;
    }

    function renderLoading(label) {
        return `<div class="student-panel-state"><i data-lucide="loader-circle"></i><span>${escapeHtml(label)}</span></div>`;
    }

    function renderEmpty(label) {
        return `<div class="student-panel-state student-panel-state--empty"><i data-lucide="inbox"></i><span>${escapeHtml(label)}</span></div>`;
    }

    function renderPanelError(error, label) {
        return `<div class="student-panel-state student-panel-state--error"><i data-lucide="triangle-alert"></i><span>${escapeHtml(label)}：${escapeHtml(errorMessage(error))}</span></div>`;
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

    function clearDashboardDom() {
        if (!state.root) return;
        const controls = state.root.querySelector('[data-student-controls]');
        if (controls) controls.hidden = true;
        state.root.querySelectorAll('[data-student-scope]').forEach((select) => {
            select.innerHTML = '';
        });
        const joinState = state.root.querySelector('[data-student-join-state]');
        const layout = state.root.querySelector('[data-student-layout]');
        if (joinState) {
            joinState.hidden = true;
            joinState.innerHTML = '';
        }
        if (layout) layout.hidden = true;
        state.root.querySelectorAll('[data-student-panel]').forEach((panel) => {
            panel.innerHTML = '';
        });
    }

    function getDashboard() {
        return state.root && state.root.querySelector('[data-student-dashboard]');
    }

    function panel(name) {
        return state.root && state.root.querySelector(`[data-student-panel="${name}"]`);
    }

    function selectedClass() {
        return state.data.classes.find((item) => String(entityId(item)) === state.selected.classId) || null;
    }

    function selectedCourse() {
        return state.data.courses.find((item) => String(entityId(item)) === state.selected.courseId) || null;
    }

    function selectedAssignmentItem() {
        return findAssignmentItem(state.selected.assignmentId);
    }

    function findAssignmentItem(assignmentId) {
        return (state.data.assignments.items || []).find((item) => String(assignmentIdOf(item)) === String(assignmentId)) || null;
    }

    function normalizeSelectedAssignment() {
        const items = state.data.assignments.items || [];
        if (!items.some((item) => String(assignmentIdOf(item)) === state.selected.assignmentId)) {
            state.selected.assignmentId = items.length ? String(assignmentIdOf(items[0])) : '';
        }
    }

    function assignmentOf(item) {
        return item && item.assignment ? item.assignment : (item || {});
    }

    function submissionOf(item) {
        return item && item.submission ? item.submission : null;
    }

    function courseOf(item) {
        return item && item.course ? item.course : null;
    }

    function unitOf(item) {
        return item && item.unit ? item.unit : null;
    }

    function assignmentIdOf(item) {
        const assignment = assignmentOf(item);
        return assignment.id !== undefined ? assignment.id : (item && item.assignment_id);
    }

    function itemCanSubmit(item) {
        const assignmentId = String(assignmentIdOf(item));
        return Boolean(item && item.can_submit) && !submissionOf(item) && !state.uncertainSubmissions.has(assignmentId);
    }

    function assignmentStatus(item) {
        if (state.uncertainSubmissions.has(String(assignmentIdOf(item)))) return 'confirming';
        const submission = submissionOf(item);
        if (submission && submission.status) return submission.status;
        const assignment = assignmentOf(item);
        if (itemCanSubmit(item)) return 'active';
        return assignment.status || (item && item.submit_block_reason) || 'readonly';
    }

    function assignmentQueryParams() {
        return {
            class_id: state.selected.classId,
            course_id: state.selected.courseId || undefined,
            filter: state.assignmentFilter,
            limit: state.pagination.assignmentLimit,
            offset: state.pagination.assignmentOffset
        };
    }

    function applySettledList(result, key) {
        if (result.status === 'fulfilled') {
            state.data[key] = normalizeList(result.value);
            state.errors[key] = null;
        } else if (!isCancelled(result.reason)) {
            state.data[key] = [];
            state.errors[key] = result.reason;
        }
    }

    function applySettledValue(result, key) {
        if (result.status === 'fulfilled') {
            state.data[key] = result.value;
            state.errors[key] = null;
        } else if (!isCancelled(result.reason)) {
            state.data[key] = null;
            state.errors[key] = result.reason;
        }
    }

    function applySettledPage(result, key) {
        if (result.status === 'fulfilled') {
            state.data[key] = normalizePage(result.value);
            state.errors[key] = null;
        } else if (!isCancelled(result.reason)) {
            state.data[key] = emptyPage();
            state.errors[key] = result.reason;
        }
    }

    function normalizeList(payload) {
        if (Array.isArray(payload)) return payload;
        if (payload && Array.isArray(payload.items)) return payload.items;
        return [];
    }

    function normalizePage(payload) {
        if (Array.isArray(payload)) {
            return {
                items: payload,
                total: payload.length,
                limit: payload.length || ASSIGNMENT_PAGE_LIMIT,
                offset: 0,
                next_offset: null
            };
        }
        const items = payload && Array.isArray(payload.items) ? payload.items : [];
        return {
            items,
            total: Number(payload && payload.total !== undefined ? payload.total : items.length),
            limit: Number(payload && payload.limit ? payload.limit : ASSIGNMENT_PAGE_LIMIT),
            offset: Number(payload && payload.offset ? payload.offset : 0),
            next_offset: payload && payload.next_offset !== undefined ? payload.next_offset : null
        };
    }

    function normalizeEntityId(value, items) {
        if (!value) return '';
        return items.some((item) => String(entityId(item)) === String(value)) ? String(value) : '';
    }

    function entityId(item) {
        return item && item.id !== undefined ? item.id : '';
    }

    function statusLabel(value) {
        return {
            active: '待提交',
            submitted: '待反馈',
            graded: '已批改',
            returned: '已退回',
            closed: '已关闭',
            archived: '已归档',
            readonly: '只读',
            already_submitted: '已提交',
            assignment_closed: '已关闭',
            assignment_archived: '已归档',
            assignment_not_active: '不可提交',
            confirming: '待确认'
        }[String(value || '').toLowerCase()] || String(value || '未知');
    }

    function submitBlockLabel(value) {
        return {
            already_submitted: '该作业已有提交记录',
            assignment_closed: '作业已关闭，只能查看历史记录',
            assignment_archived: '作业已归档，只能查看历史记录',
            class_archived: '班级已归档，只能查看历史作业与提交记录',
            assignment_not_active: '作业当前未开放提交'
        }[value] || (value ? statusLabel(value) : '当前状态不允许提交');
    }

    function pointReasonLabel(value) {
        return {
            assignment_grade: '作业批改积分',
            learning_complete: '学习完成积分',
            manual_adjustment: '人工调整'
        }[value] || value || '积分变化';
    }

    function extractSubmissionAnswer(content) {
        if (content === null || content === undefined) return '';
        if (typeof content === 'string') return content;
        if (typeof content === 'object') {
            for (const key of ['answer', 'text', 'response', 'content']) {
                if (typeof content[key] === 'string') return content[key];
            }
            if (String(content.kind || '') === 'synthetic-demo') return '已完成实验观察记录，等待教师查看。';
            const itemCount = Array.isArray(content) ? content.length : Object.keys(content).length;
            return itemCount > 0 ? `已提交结构化作答，共包含 ${itemCount} 项记录。` : '已提交作答。';
        }
        return String(content);
    }

    function dueInfo(value) {
        if (!value) return { label: '未设置截止时间', overdue: false };
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return { label: `截止：${String(value)}`, overdue: false };
        return {
            label: `截止：${formatDate(value)}`,
            overdue: date.getTime() < Date.now()
        };
    }

    function dueTimestamp(assignment) {
        if (!assignment || !assignment.due_at) return Number.MAX_SAFE_INTEGER;
        const value = new Date(assignment.due_at).getTime();
        return Number.isNaN(value) ? Number.MAX_SAFE_INTEGER : value;
    }

    function beginScopeRequest() {
        abortController(state.scopeController);
        state.scopeController = new AbortController();
        state.scopeGeneration += 1;
        return {
            generation: state.scopeGeneration,
            controller: state.scopeController,
            signal: state.scopeController.signal
        };
    }

    function isCurrentScope(scope) {
        return Boolean(
            state.active &&
            scope &&
            scope.generation === state.scopeGeneration &&
            scope.controller === state.scopeController &&
            !scope.signal.aborted
        );
    }

    function abortController(controller) {
        if (controller && !controller.signal.aborted) controller.abort();
    }

    async function requestJson(path, options) {
        const request = options || {};
        return AstraApiClient.request(path, {
            baseUrl: state.apiBase,
            params: request.params,
            method: request.method,
            headers: request.headers,
            body: request.body,
            timeoutMs: request.timeout || REQUEST_TIMEOUT_MS,
            signal: request.signal || (state.lifecycleController && state.lifecycleController.signal)
        });
    }

    function resolveApiBase() {
        let fromQuery = '';
        try {
            fromQuery = new URLSearchParams(window.location.search).get('apiBase') || '';
        } catch (error) {}
        const queryBase = normalizeApiBase(fromQuery);
        if (queryBase) {
            try { window.localStorage.setItem(API_BASE_STORAGE_KEY, queryBase); } catch (error) {}
            return queryBase;
        }
        try {
            const stored = normalizeApiBase(window.localStorage.getItem(API_BASE_STORAGE_KEY) || '');
            if (stored) return stored;
        } catch (error) {}
        const configured = window.CONFIG && window.CONFIG.backend && window.CONFIG.backend.apiBaseUrl;
        return normalizeApiBase(configured || '');
    }

    function normalizeApiBase(value) {
        return AstraApiClient.normalizeBaseUrl(value);
    }

    function errorMessage(error) {
        return AstraApiClient.message(error);
    }

    function isCancelled(error) {
        return AstraApiClient.isCancelled(error);
    }

    function setFlash(type, message) {
        state.flash = { type, message: String(message || '') };
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

    function formatNumber(value) {
        const number = Number(value || 0);
        return Number.isFinite(number) ? number.toLocaleString('zh-CN') : '0';
    }

    function formatPercent(value) {
        return `${clampNumber(value, 0, 100).toFixed(0)}%`;
    }

    function clampNumber(value, min, max) {
        const number = Number(value || 0);
        if (!Number.isFinite(number)) return min;
        return Math.min(max, Math.max(min, number));
    }

    function prefersReducedMotion() {
        return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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

    function cssEscape(value) {
        if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value));
        return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    }

    function refreshIcons() {
        if (typeof lucide !== 'undefined' && lucide && typeof lucide.createIcons === 'function') {
            try {
                lucide.createIcons({ attrs: { 'stroke-width': 1.8 }, root: state.root || document });
            } catch (error) {}
        }
    }

    window.initStudent = initStudent;
    window.destroyStudent = destroyStudent;
    window.StudentWorkbench = {
        version: STUDENT_ASSET_VERSION,
        refresh: refreshAll,
        destroy: destroyStudent
    };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            state,
            applyConfirmedSubmission,
            updateJoinReconciliationLock,
            updateSubmissionReconciliationLock,
            buildFutureCourseIdMap,
            bootstrapFutureGalaxyPublication,
            configureFutureGalaxyPublication,
            closeFutureGalaxyPublication,
            renderCoursePanel
        };
    }
})();
