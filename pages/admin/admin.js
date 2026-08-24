(function () {
    'use strict';

    const ADMIN_ASSET_VERSION = '20260825v840TeacherApplicationP0';
    const API_BASE_STORAGE_KEY = 'astra-admin-api-base';

    const state = {
        root: null,
        apiBase: '',
        user: null,
        busy: false,
        active: false,
        ownersMounted: false,
        activeSection: 'overview',
        online: navigator.onLine !== false,
        runtimeBound: false,
        lifecycleController: null,
        requestGeneration: 0,
        panelGenerations: Object.create(null),
        writeLock: null,
        pendingJoinReview: null,
        joinReviewExecutor: null,
        pendingUserUpdate: null,
        pendingOrganizationUpdate: null,
        organizationEditor: null,
        organizationEditorTrigger: null,
        organizationGeneration: 0,
        onOnline: null,
        onOffline: null,
        onAuthRequired: null,
        eventController: null,
        modulePromise: null,
        sectionLoaded: Object.create(null),
        rafIds: new Set(),
        panels: {},
        panelData: {}
    };

    const GOVERNANCE_SECTIONS = Object.freeze([
        Object.freeze({ id: 'overview', label: '治理总览', meta: 'OVERVIEW', icon: 'radar' }),
        Object.freeze({ id: 'organizations', label: '组织', meta: 'ORGANIZATION', icon: 'landmark' }),
        Object.freeze({ id: 'identity', label: '人员', meta: 'PEOPLE', icon: 'users-round' }),
        Object.freeze({ id: 'classes', label: '班级', meta: 'CLASSES', icon: 'school' }),
        Object.freeze({ id: 'courses', label: '课程', meta: 'COURSES', icon: 'book-open-check' }),
        Object.freeze({ id: 'audit', label: '审计', meta: 'AUDIT', icon: 'scroll-text' })
    ]);

    const PANEL_SECTIONS = Object.freeze({
        users: 'identity',
        schools: 'organizations',
        classes: 'classes',
        'join-requests': 'identity',
        'audit-logs': 'audit'
    });

    const ORGANIZATION_CONFIGS = Object.freeze({
        school: Object.freeze({
            label: '学校',
            panelId: 'schools',
            collection: 'schools',
            fields: Object.freeze([
                Object.freeze({ name: 'name', label: '学校名称', required: true, maxLength: 160 }),
                Object.freeze({ name: 'region', label: '区域', maxLength: 160 }),
                Object.freeze({ name: 'description', label: '说明', maxLength: 2000, multiline: true })
            ])
        }),
        class: Object.freeze({
            label: '班级',
            panelId: 'classes',
            collection: 'classes',
            fields: Object.freeze([
                Object.freeze({ name: 'name', label: '班级名称', required: true, maxLength: 160 }),
                Object.freeze({ name: 'grade', label: '年级', maxLength: 64 }),
                Object.freeze({ name: 'term', label: '学期', maxLength: 64 }),
                Object.freeze({ name: 'description', label: '说明', maxLength: 2000, multiline: true })
            ])
        })
    });

    const PANEL_CONFIGS = [
        {
            id: 'users',
            title: '用户与权限',
            icon: 'users-round',
            path: '/api/admin/users',
            filters: [
                selectFilter('role', '角色', [
                    ['', '全部'], ['student', '学生'], ['teacher', '教师'], ['admin', '管理员']
                ]),
                selectFilter('status', '状态', [
                    ['', '全部'], ['active', '启用'], ['disabled', '停用']
                ]),
                textFilter('q', '账号或名称')
            ],
            columns: [
                col('id', 'ID'), col('username', '账号'), col('display_name', '显示名称'),
                badgeCol('role', '角色'), badgeCol('status', '状态'), dateCol('updated_at', '更新')
            ],
            details: ['created_at', 'updated_at'],
            actions: 'user-governance'
        },
        {
            id: 'schools',
            title: '学校与组织',
            icon: 'landmark',
            path: '/api/admin/schools',
            filters: [
                selectFilter('status', '状态', [
                    ['', '全部'], ['active', '启用'], ['archived', '已归档']
                ]),
                textFilter('q', '学校或区域')
            ],
            columns: [
                col('id', 'ID'), col('name', '学校'), col('region', '区域'),
                badgeCol('status', '状态'), col('version', '版本')
            ],
            details: ['id', 'name', 'region', 'description', 'status', 'version', 'created_at', 'updated_at'],
            actions: 'organization-governance',
            organizationKind: 'school'
        },
        {
            id: 'classes',
            title: '全局班级',
            icon: 'school',
            path: '/api/admin/classes',
            filters: [
                selectFilter('status', '状态', [
                    ['', '全部'], ['active', '启用'], ['archived', '已归档']
                ]),
                textFilter('q', '班级、年级或学期'),
                textFilter('school_id', '学校 ID')
            ],
            columns: [
                col('id', 'ID'), col('school_id', '学校 ID'), col('name', '班级'),
                col('grade', '年级'), col('term', '学期'), badgeCol('status', '状态'), col('version', '版本')
            ],
            details: ['id', 'school_id', 'name', 'grade', 'term', 'description', 'status', 'version', 'created_at', 'updated_at'],
            actions: 'organization-governance',
            organizationKind: 'class'
        },
        {
            id: 'join-requests',
            title: '班级加入请求',
            icon: 'user-plus',
            path: '/api/admin/class-join-requests',
            filters: [
                selectFilter('status', '状态', [
                    ['', '全部'],
                    ['pending', 'pending'],
                    ['approved', 'approved'],
                    ['rejected', 'rejected']
                ], 'pending'),
                selectFilter('role', '角色', [
                    ['', '全部'],
                    ['student', 'student'],
                    ['teacher', 'teacher']
                ]),
                textFilter('q', '搜索')
            ],
            columns: [
                col('id', 'ID'),
                col('user_display_name', '用户'),
                col('class_name', '班级'),
                col('school_name', '学校'),
                badgeCol('role', '角色'),
                badgeCol('status', '状态'),
                dateCol('created_at', '申请时间')
            ],
            details: ['message', 'review_note', 'reviewed_by_user_id', 'reviewed_at'],
            actions: 'join-request-review'
        },
        {
            id: 'audit-logs',
            title: '审计日志',
            icon: 'scroll-text',
            path: '/api/admin/audit-logs',
            filters: [
                selectFilter('event_result', '结果', [
                    ['', '全部'],
                    ['success', 'success'],
                    ['failure', 'failure']
                ]),
                textFilter('action', 'Action'),
                textFilter('resource_type', '资源类型'),
                textFilter('resource_id', '资源 ID'),
                textFilter('request_id', 'Request ID'),
                textFilter('from', '开始时间'),
                textFilter('to', '结束时间')
            ],
            columns: [
                col('id', 'ID'),
                col('actor_user_id', 'Actor'),
                badgeCol('actor_role', '角色'),
                col('action', 'Action'),
                col('resource_type', '资源'),
                badgeCol('event_result', '结果'),
                col('request_id', 'Request'),
                dateCol('created_at', '时间')
            ],
            details: ['resource_id', 'failure_reason', 'request_method', 'request_path', 'snapshot_json']
        }
    ];
    const BUSINESS_PANEL_IDS = new Set(['users', 'schools', 'classes', 'join-requests', 'audit-logs']);
    const OWNER_MODULES = Object.freeze([
        Object.freeze({ path: 'pages/admin/admin-course-governance.js', ready: 'AdminCourseGovernance' }),
        Object.freeze({ path: 'pages/admin/admin-secondary-governance.js', ready: 'AdminSecondaryGovernance' })
    ]);
    function col(key, label) { return { key, label }; }
    function badgeCol(key, label) { return { key, label, badge: true }; }
    function dateCol(key, label) { return { key, label, type: 'date' }; }
    function selectFilter(name, label, options, value) {
        return { type: 'select', name, label, options, value: value || '' };
    }
    function textFilter(name, label) {
        return { type: 'text', name, label };
    }

    function loadOwnerModule(config) {
        if (window[config.ready]) return Promise.resolve();
        const source = `${config.path}?v=${ADMIN_ASSET_VERSION}`;
        return new Promise((resolve, reject) => {
            let script = Array.from(document.scripts).find((candidate) => {
                const current = candidate.getAttribute('src') || '';
                return current === source || current.split('?')[0] === config.path;
            });
            if (script && script.dataset.adminOwnerState === 'failed') { script.remove(); script = null; }
            if (!script) {
                script = document.createElement('script');
                script.src = source;
                script.async = true;
                script.dataset.adminOwner = config.ready;
                script.dataset.adminOwnerState = 'loading';
            }
            let settled = false;
            script.dataset.adminOwner = config.ready;
            const cleanup = () => { script.removeEventListener('load', onLoad); script.removeEventListener('error', onError); script.__adminOwnerCleanup = null; };
            const fail = (message) => {
                if (settled) return;
                settled = true; cleanup();
                script.dataset.adminOwnerState = 'failed'; script.remove();
                reject(new Error(message));
            };
            const onLoad = () => {
                if (!window[config.ready]) { fail(`${config.ready} 未完成注册`); return; }
                settled = true; cleanup();
                script.dataset.adminOwnerState = 'loaded'; resolve();
            };
            const onError = () => fail(`治理模块加载失败：${config.path}`);
            script.__adminOwnerCleanup = cleanup;
            script.addEventListener('load', onLoad);
            script.addEventListener('error', onError);
            if (!script.isConnected) document.body.appendChild(script);
        });
    }

    function ensureOwnerModules() {
        if (!state.modulePromise) {
            state.modulePromise = Promise.all(OWNER_MODULES.map(loadOwnerModule)).catch((error) => {
                Array.from(document.scripts)
                    .filter((script) => OWNER_MODULES.some((config) => script.dataset.adminOwner === config.ready))
                    .forEach((script) => { if (typeof script.__adminOwnerCleanup === 'function') script.__adminOwnerCleanup(); script.remove(); });
                state.modulePromise = null;
                throw error;
            });
        }
        return state.modulePromise;
    }

    function mountOwnerModules() {
        if (state.ownersMounted) return true;
        if (!state.active || !state.root || !state.user || state.user.role !== 'admin') return false;
        const courseHost = state.root.querySelector('[data-admin-course-host]');
        const secondaryHost = state.root.querySelector('[data-admin-secondary-host]');
        if (!courseHost || !secondaryHost || !window.AdminCourseGovernance || !window.AdminSecondaryGovernance) return false;
        const courseMounted = AdminCourseGovernance.mount(courseHost, {
            getApiBase: () => state.apiBase, notify: setNotice, refreshIcons,
            onMutation: async () => Promise.all([refreshStats(), refreshPanel('audit-logs')]),
            onWriteStateChange: applyAdminWriteAvailability
        });
        const secondaryMounted = AdminSecondaryGovernance.mount(secondaryHost, {
            getApiBase: () => state.apiBase, notify: setNotice, refreshIcons, overviewHost: state.root.querySelector('[data-admin-business-overview]'), healthPath: '/api/health'
        });
        state.ownersMounted = Boolean(courseMounted && secondaryMounted);
        if (!state.ownersMounted) unmountOwnerModules();
        return state.ownersMounted;
    }
    function unmountOwnerModules() {
        if (window.AdminCourseGovernance) AdminCourseGovernance.destroy();
        if (window.AdminSecondaryGovernance) AdminSecondaryGovernance.destroy();
        state.ownersMounted = false;
    }
    function courseWriteState() { try { return window.AdminCourseGovernance ? AdminCourseGovernance.snapshot() : {}; } catch (error) { return {}; } }
    function courseWriteBlocked(snapshot) { const current = snapshot || courseWriteState(); return Boolean(Number(current.mutationCourseId) || Number(current.lockCount) || (current.lockedCourseIds || []).length); }
    function initializeJoinReviewExecutor() {
        state.joinReviewExecutor = createConfirmedJoinReviewExecutor(commitJoinReview, (snapshot) => {
            state.pendingJoinReview = snapshot.pending ? snapshot.pending.key : null;
            if (state.root) { rerenderJoinRequestsPanel(); refreshIcons(); }
        });
    }
    function invalidateJoinReviewConfirmation() {
        if (state.joinReviewExecutor) state.joinReviewExecutor.invalidate();
        else state.pendingJoinReview = null;
    }

    function initAdmin() {
        state.root = document.querySelector('[data-admin-governance]');
        if (!state.root) return;
        state.active = true;
        state.online = navigator.onLine !== false;
        if (window.AstraApiClient) AstraApiClient.scrubLegacyTokens();
        state.apiBase = resolveApiBase();
        initializePanelState();
        initializeJoinReviewExecutor();
        renderShell();
        bindEvents();
        bindRuntimeEvents();
        if (!state.online) {
            renderAuthError(AstraApiClient.offlineError());
            refreshIcons();
            return;
        }
        refreshAll();
    }
    function destroyAdmin() {
        state.active = false;
        invalidateRequests();
        unbindRuntimeEvents();
        if (state.eventController) state.eventController.abort();
        state.eventController = null;
        state.rafIds.forEach((id) => window.cancelAnimationFrame(id));
        state.rafIds.clear();
        unmountOwnerModules();
        state.user = null;
        state.busy = false;
        state.panelData = {};
        state.joinReviewExecutor = null;
        state.pendingJoinReview = null;
        resetOrganizationEditor(false);
        const dashboard = getDashboard();
        if (dashboard) dashboard.hidden = true;
        if (state.root) {
            const authContainer = state.root.querySelector('[data-admin-auth-state]');
            if (authContainer && window.AstraAuthUI) AstraAuthUI.unmount(authContainer);
            state.root.innerHTML = `
                <div class="admin-loading">
                    <i data-lucide="loader-circle"></i>
                    <span>管理端已离开</span>
                </div>
            `;
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
            state.user = null;
            state.panelData = {};
            unmountOwnerModules();
            resetOrganizationEditor(false);
            clearDashboardDom();
            const dashboard = getDashboard();
            if (dashboard) dashboard.hidden = true;
            if (state.active) {
                renderAuthError(AstraApiClient.offlineError());
                refreshIcons();
            }
        };
        state.onAuthRequired = () => {
            invalidateRequests();
            setBusy(false);
            state.user = null;
            state.panelData = {};
            unmountOwnerModules();
            resetOrganizationEditor(false);
            clearDashboardDom();
            const dashboard = getDashboard();
            if (dashboard) dashboard.hidden = true;
            if (state.active) {
                renderAuthError(new AstraApiClient.Error('登录状态已失效', { status: 401, code: 'unauthorized' }));
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

    function initializePanelState() {
        PANEL_CONFIGS.filter((config) => BUSINESS_PANEL_IDS.has(config.id)).forEach((config) => {
            if (!state.panels[config.id]) {
                state.panels[config.id] = { limit: 10, offset: 0, filters: {} };
            }
            config.filters.forEach((filter) => {
                if (filter.value && state.panels[config.id].filters[filter.name] === undefined) {
                    state.panels[config.id].filters[filter.name] = filter.value;
                }
            });
        });
    }
    function sectionLabel(sectionId) {
        const section = GOVERNANCE_SECTIONS.find((item) => item.id === sectionId);
        return section ? section.label : GOVERNANCE_SECTIONS[0].label;
    }
    function applyActiveSection(options) {
        if (!state.root) return;
        const activeSection = GOVERNANCE_SECTIONS.some((item) => item.id === state.activeSection)
            ? state.activeSection
            : 'overview';
        state.activeSection = activeSection;
        const overview = state.root.querySelector('[data-admin-overview]');
        if (overview) overview.hidden = activeSection !== 'overview';
        state.root.querySelectorAll('[data-admin-section]').forEach((panel) => {
            panel.hidden = panel.dataset.adminSection !== activeSection;
        });
        state.root.querySelectorAll('[data-admin-section-button]').forEach((button) => {
            const selected = button.dataset.adminSectionButton === activeSection;
            if (selected) button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
            button.setAttribute('aria-selected', selected ? 'true' : 'false');
            button.tabIndex = selected ? 0 : -1;
        });
        const title = state.root.querySelector('[data-admin-current-section-title]');
        if (title) title.textContent = sectionLabel(activeSection);
        if (options && options.focus) {
            const target = activeSection === 'overview'
                ? state.root.querySelector('[data-admin-overview]')
                : state.root.querySelector(`[data-admin-section="${activeSection}"]`);
            if (target) {
                const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
                try { target.focus({ preventScroll: true }); } catch (error) { target.focus(); }
            }
        }
    }

    function setActiveSection(sectionId, options) {
        if (!GOVERNANCE_SECTIONS.some((item) => item.id === sectionId)) return;
        state.activeSection = sectionId;
        applyActiveSection(options);
        if (state.user && state.user.role === 'admin') refreshActiveSection(sectionId);
    }

    function governanceShellMarkup() {
        initializePanelState();
        return `
            <header class="admin-governance__header">
                <div class="admin-governance__title">
                    <span class="admin-governance__eyebrow">
                        <i data-lucide="orbit"></i>
                        ASTRA GOVERNANCE
                    </span>
                    <h1>全局治理</h1>
                    <p>三个星系，一张总账。所有写入继续经过领域校验、权限控制与审计。</p>
                </div>
                <div class="admin-governance__actions">
                    <details class="admin-connection-settings">
                        <summary><i data-lucide="waypoints"></i><span>连接设置</span></summary>
                        <label class="admin-api-base">
                            <span>API</span>
                            <input type="url" data-admin-api-base value="${escapeAttr(state.apiBase)}" placeholder="同源" autocomplete="off">
                        </label>
                    </details>
                    <button type="button" class="admin-icon-button" data-admin-action="refresh" data-admin-refresh-control aria-label="刷新治理总览">
                        <i data-lucide="refresh-cw"></i>
                        <span>刷新</span>
                    </button>
                </div>
            </header>
            <div class="admin-auth-state" data-admin-auth-state></div>
            <div class="admin-notice" data-admin-notice hidden role="status" aria-live="polite"></div>
            <div class="admin-dashboard" data-admin-dashboard hidden>
                <div class="admin-governance-layout">
                    <aside class="admin-governance-index" aria-label="全局治理索引">
                        <section class="admin-galaxy-scope" aria-labelledby="admin-galaxy-scope-title">
                            <span id="admin-galaxy-scope-title">治理范围</span>
                            <strong>全部星系</strong>
                            <ol>
                                <li><i>01</i><span>工科试验室</span></li>
                                <li><i>02</i><span>代码空间</span></li>
                                <li><i>03</i><span>未来星系</span></li>
                            </ol>
                            <p>统一账号、组织、内容与审计边界；不再维护星系内的独立管理页。</p>
                        </section>
                        <nav class="admin-section-nav" aria-label="治理领域" role="tablist" aria-orientation="vertical">
                            ${GOVERNANCE_SECTIONS.map((section) => `
                                <button type="button" role="tab" aria-controls="admin-domain-${section.id}" aria-selected="${state.activeSection === section.id ? 'true' : 'false'}" tabindex="${state.activeSection === section.id ? '0' : '-1'}" data-admin-section-button="${section.id}"${state.activeSection === section.id ? ' aria-current="page"' : ''}>
                                    <i data-lucide="${section.icon}"></i>
                                    <span>${escapeHtml(section.label)}<small>${escapeHtml(section.meta)}</small></span>
                                </button>
                            `).join('')}
                        </nav>
                        <section class="admin-secondary-entry" aria-label="次级治理入口">
                            <button type="button" class="admin-text-button" data-admin-secondary-open="identity"><i data-lucide="badge-check"></i>教师身份审核</button><button type="button" class="admin-text-button" data-admin-secondary-open="more"><i data-lucide="library"></i>更多治理</button>
                            <button type="button" class="admin-text-button" data-admin-secondary-open="advanced"><i data-lucide="wrench"></i>高级诊断</button>
                        </section>
                    </aside>
                    <div class="admin-governance-workspace">
                        <header class="admin-workspace-heading">
                            <span>GOVERNED DOMAIN</span>
                            <h2 data-admin-current-section-title>${escapeHtml(sectionLabel(state.activeSection))}</h2>
                        </header>
                        <section id="admin-domain-overview" role="tabpanel" class="admin-overview" data-admin-overview tabindex="-1"${state.activeSection === 'overview' ? '' : ' hidden'}>
                            <section data-admin-business-overview aria-label="真实业务治理摘要"></section><section class="admin-kpi-grid" data-admin-stats></section>
                            <section class="admin-database-map" data-admin-database-map></section>
                        </section>
                        <section class="admin-panel-grid" data-admin-panels>
                            ${['organizations', 'identity', 'classes', 'audit'].map(renderDomainShell).join('')}
                            <article id="admin-domain-courses" role="tabpanel" class="admin-panel admin-course-domain" data-admin-section="courses" data-admin-course-host tabindex="-1"${state.activeSection === 'courses' ? '' : ' hidden'}></article>
                        </section>
                    </div>
                </div>
                <dialog class="admin-organization-dialog" data-admin-organization-dialog aria-labelledby="admin-organization-dialog-title" aria-describedby="admin-organization-dialog-description">
                    <div data-admin-organization-editor></div>
                </dialog>
                <div data-admin-secondary-host></div>
            </div>
        `;
    }

    function renderShell() {
        state.root.innerHTML = governanceShellMarkup();
        applyActiveSection();
        refreshIcons();
    }

    function renderDomainShell(sectionId) {
        return `<section id="admin-domain-${sectionId}" role="tabpanel" class="admin-domain-panel" data-admin-section="${sectionId}" tabindex="-1"${state.activeSection === sectionId ? '' : ' hidden'}>${PANEL_CONFIGS.filter((config) => BUSINESS_PANEL_IDS.has(config.id) && PANEL_SECTIONS[config.id] === sectionId).map(renderPanelShell).join('')}</section>`;
    }

    function renderPanelShell(config) {
        return `
            <article id="admin-panel-${config.id}" class="admin-panel" data-admin-panel="${config.id}">
                <header class="admin-panel__header">
                    <div>
                        <h2><i data-lucide="${config.icon}"></i>${escapeHtml(config.title)}</h2>
                        <p data-admin-panel-meta="${config.id}">--</p>
                    </div>
                    <button type="button" class="admin-icon-button admin-icon-button--compact" data-admin-panel-refresh="${config.id}" aria-label="刷新${escapeAttr(config.title)}">
                        <i data-lucide="refresh-cw"></i>
                    </button>
                </header>
                <form class="admin-panel__filters" data-admin-panel-form="${config.id}">
                    ${config.filters.map((filter) => renderFilter(config.id, filter)).join('')}
                    <label>
                        <span>条数</span>
                        <select name="limit">
                            ${[5, 10, 25].map((limit) => `<option value="${limit}"${limit === state.panels[config.id].limit ? ' selected' : ''}>${limit}</option>`).join('')}
                        </select>
                    </label>
                    <button type="submit" class="admin-icon-button admin-icon-button--compact" aria-label="应用筛选">
                        <i data-lucide="filter"></i>
                    </button>
                </form>
                <div class="admin-panel__body" data-admin-panel-body="${config.id}">
                    ${renderLoading('加载中')}
                </div>
            </article>
        `;
    }

    function renderFilter(panelId, filter) {
        const current = state.panels[panelId].filters[filter.name] || filter.value || '';
        if (filter.type === 'select') {
            return `
                <label>
                    <span>${escapeHtml(filter.label)}</span>
                    <select name="${escapeAttr(filter.name)}">
                        ${filter.options.map(([value, label]) => `<option value="${escapeAttr(value)}"${value === current ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}
                    </select>
                </label>
            `;
        }
        return `
            <label>
                <span>${escapeHtml(filter.label)}</span>
                <input type="search" name="${escapeAttr(filter.name)}" value="${escapeAttr(current)}" autocomplete="off">
            </label>
        `;
    }

    function bindEvents() {
        if (state.eventController && !state.eventController.signal.aborted) return;
        state.eventController = new AbortController();
        const eventOptions = { signal: state.eventController.signal };
        state.root.addEventListener('click', (event) => {
            const sectionButton = event.target.closest('[data-admin-section-button]');
            if (sectionButton) {
                setActiveSection(sectionButton.dataset.adminSectionButton, { focus: true });
                return;
            }

            const secondaryButton = event.target.closest('[data-admin-secondary-open]');
            if (secondaryButton && window.AdminSecondaryGovernance) {
                AdminSecondaryGovernance.open(secondaryButton.dataset.adminSecondaryOpen, secondaryButton);
                return;
            }

            const refreshAllButton = event.target.closest('[data-admin-action="refresh"]');
            if (refreshAllButton) {
                if (state.busy) return;
                const courseState = courseWriteState();
                if (courseWriteBlocked(courseState)) {
                    setNotice('warning', `课程写入或对账锁未解除（${courseState.mutationCourseId || courseState.lockedCourseIds?.join(', ') || 'locked'}）；不能刷新或切换 API Base。`);
                    return;
                }
                if (!state.writeLock) resetOrganizationEditor(false);
                invalidateJoinReviewConfirmation();
                state.pendingUserUpdate = null;
                state.pendingOrganizationUpdate = null;
                setNotice('', '');
                refreshAll({ releaseWriteLock: true });
                return;
            }

            const userUpdateButton = event.target.closest('[data-admin-user-update]');
            if (userUpdateButton) {
                updateUserGovernance(userUpdateButton);
                return;
            }

            const openPanelButton = event.target.closest('[data-admin-open-panel]');
            if (openPanelButton) {
                focusOrganizationPanel(openPanelButton.dataset.adminOpenPanel);
                return;
            }

            const organizationEditButton = event.target.closest('[data-admin-organization-edit]');
            if (organizationEditButton) {
                openOrganizationEditor(organizationEditButton);
                return;
            }

            const organizationCloseButton = event.target.closest('[data-admin-organization-close]');
            if (organizationCloseButton) {
                closeOrganizationEditor();
                return;
            }

            const organizationConfirmButton = event.target.closest('[data-admin-organization-confirm]');
            if (organizationConfirmButton) {
                prepareOrganizationUpdate(organizationConfirmButton.dataset.adminOrganizationConfirm);
                return;
            }

            const organizationReconcileButton = event.target.closest('[data-admin-organization-reconcile]');
            if (organizationReconcileButton) {
                reconcileOrganizationWrite(true);
                return;
            }

            const organizationUnlockButton = event.target.closest('[data-admin-organization-unlock]');
            if (organizationUnlockButton) {
                unlockOrganizationWrite();
                return;
            }

            const joinReviewButton = event.target.closest('[data-admin-join-review]');
            if (joinReviewButton) {
                reviewJoinRequest(joinReviewButton);
                return;
            }

            const refreshPanelButton = event.target.closest('[data-admin-panel-refresh]');
            if (refreshPanelButton) {
                const panelId = refreshPanelButton.dataset.adminPanelRefresh;
                if (panelId === 'join-requests') invalidateJoinReviewConfirmation();
                refreshPanel(panelId);
                return;
            }

            const pageButton = event.target.closest('[data-admin-page]');
            if (pageButton) {
                const panelId = pageButton.dataset.adminPanelId;
                const direction = pageButton.dataset.adminPage;
                const panelState = state.panels[panelId];
                if (!panelState) return;
                const data = state.panelData[panelId] || {};
                if (direction === 'next' && data.next_offset !== null && data.next_offset !== undefined) {
                    panelState.offset = data.next_offset;
                } else if (direction === 'prev') {
                    panelState.offset = Math.max(0, panelState.offset - panelState.limit);
                }
                refreshPanel(panelId);
            }
        }, eventOptions);

        state.root.addEventListener('keydown', (event) => {
            const current = event.target.closest('[data-admin-section-button]');
            if (!current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
            const buttons = Array.from(state.root.querySelectorAll('[data-admin-section-button]'));
            const currentIndex = buttons.indexOf(current);
            let nextIndex = currentIndex;
            if (event.key === 'Home') nextIndex = 0;
            else if (event.key === 'End') nextIndex = buttons.length - 1;
            else if (['ArrowLeft', 'ArrowUp'].includes(event.key)) nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
            else nextIndex = (currentIndex + 1) % buttons.length;
            event.preventDefault();
            const next = buttons[nextIndex];
            if (next) {
                setActiveSection(next.dataset.adminSectionButton);
                next.focus();
            }
        }, eventOptions);

        state.root.addEventListener('submit', (event) => {
            const form = event.target.closest('[data-admin-panel-form]');
            if (!form) return;
            event.preventDefault();
            applyPanelForm(form.dataset.adminPanelForm, form);
        }, eventOptions);

        state.root.addEventListener('change', (event) => {
            const apiInput = event.target.closest('[data-admin-api-base]');
            if (apiInput) {
                if (state.busy || state.writeLock || courseWriteBlocked()) {
                    apiInput.value = state.apiBase;
                    setNotice('warning', '课程写入或对账锁未解除；API Base 保持不变。');
                    return;
                }
                if (window.AdminCourseGovernance && !AdminCourseGovernance.invalidateContext()) { apiInput.value = state.apiBase; return; }
                if (window.AdminSecondaryGovernance) AdminSecondaryGovernance.invalidateContext();
                invalidateJoinReviewConfirmation();
                state.apiBase = normalizeApiBase(apiInput.value);
                localStorage.setItem(API_BASE_STORAGE_KEY, state.apiBase);
                apiInput.value = state.apiBase;
                refreshAll();
                return;
            }
            const form = event.target.closest('[data-admin-panel-form]');
            if (form && event.target.tagName === 'SELECT') {
                applyPanelForm(form.dataset.adminPanelForm, form);
            }
        }, eventOptions);

        state.root.addEventListener('input', (event) => {
            const form = event.target.closest('[data-admin-organization-form]');
            if (!form || !state.pendingOrganizationUpdate) return;
            state.pendingOrganizationUpdate = null;
            if (state.organizationEditor) {
                state.organizationEditor.message = '输入已变化，上一次确认已失效；请重新预览。';
                state.organizationEditor.messageType = 'warning';
            }
            form.querySelectorAll('[data-admin-organization-confirm]').forEach((button) => {
                button.classList.remove('admin-icon-button--confirming');
                button.setAttribute('aria-label', button.dataset.adminOrganizationConfirm === 'status'
                    ? '预览组织状态变更'
                    : '预览组织资料变更');
            });
            const preview = form.querySelector('[data-admin-organization-preview]');
            if (preview) preview.remove();
            const inlineNotice = form.querySelector('[data-admin-organization-form-notice]');
            if (inlineNotice) {
                inlineNotice.hidden = false;
                inlineNotice.className = 'admin-organization-form__notice admin-organization-form__notice--warning';
                inlineNotice.textContent = '输入已变化，上一次确认已失效；请重新预览。';
            }
        }, eventOptions);

        state.root.addEventListener('cancel', (event) => {
            const dialog = event.target.closest('[data-admin-organization-dialog]');
            if (!dialog) return;
            event.preventDefault();
            if (!state.busy) closeOrganizationEditor();
        }, { capture: true, signal: state.eventController.signal });
    }

    function applyPanelForm(panelId, form) {
        const panelState = state.panels[panelId];
        if (!panelState) return;
        if (panelId === 'join-requests') invalidateJoinReviewConfirmation();
        const data = new FormData(form);
        panelState.limit = Number(data.get('limit')) || 10;
        panelState.offset = 0;
        panelState.filters = {};
        PANEL_CONFIGS.find((config) => config.id === panelId).filters.forEach((filter) => {
            const value = String(data.get(filter.name) || '').trim();
            if (value) panelState.filters[filter.name] = value;
        });
        refreshPanel(panelId);
    }

    async function refreshActiveSection(sectionId, generation, options) {
        const section = String(sectionId || state.activeSection || 'overview');
        const force = Boolean(options && options.force);
        if (section !== 'overview' && state.sectionLoaded[section] && !force) return true;
        let results = [];
        if (section === 'overview') {
            results = await Promise.all([refreshStats(generation), AdminSecondaryGovernance.loadOverview({ force })]);
        } else if (section === 'organizations') {
            results = await Promise.all([refreshPanel('schools', generation)]);
        } else if (section === 'identity') {
            results = await Promise.all([
                refreshPanel('users', generation),
                refreshPanel('join-requests', generation)
            ]);
        } else if (section === 'classes') {
            results = await Promise.all([refreshPanel('classes', generation)]);
        } else if (section === 'courses') {
            results = [window.AdminCourseGovernance
                ? await AdminCourseGovernance.activate({ force })
                : false];
        } else if (section === 'audit') {
            results = await Promise.all([refreshPanel('audit-logs', generation)]);
        }
        const complete = results.length > 0 && results.every((result) => result === true);
        if (complete) state.sectionLoaded[section] = true;
        return complete;
    }

    async function refreshAll(options) {
        if (!state.root || !state.active) return;
        const releaseWriteLock = Boolean(options && options.releaseWriteLock);
        invalidateJoinReviewConfirmation();
        const generation = beginRequestGeneration();
        setBusy(true);
        state.user = null;
        state.panelData = {};
        state.sectionLoaded = Object.create(null);
        clearDashboardDom();
        renderAuthState('checking');
        const dashboard = getDashboard();
        if (dashboard) dashboard.hidden = true;
        if (!state.online) {
            unmountOwnerModules();
            renderAuthError(AstraApiClient.offlineError());
            setBusy(false);
            refreshIcons();
            return;
        }
        try {
            const user = await fetchJson('/api/users/me');
            if (!isCurrentRequest(generation)) return;
            state.user = user;
            if (user.role !== 'admin') {
                unmountOwnerModules();
                renderAuthState('forbidden', user);
                return;
            }
            await ensureOwnerModules();
            if (!isCurrentRequest(generation)) return;
            if (!mountOwnerModules()) throw new Error('管理员治理 owner 挂载失败');
            renderAuthState('ready', user);
            if (dashboard) dashboard.hidden = false;
            const reconciled = await refreshActiveSection(state.activeSection, generation, { force: true });
            if (releaseWriteLock && state.writeLock) {
                if (state.writeLock.action === 'organization-governance') {
                    await reconcileOrganizationWrite(false);
                } else if (state.writeLock.action === 'join-request-review') {
                    await reconcileJoinReviewWrite(state.writeLock);
                } else if (reconciled) {
                    setWriteLock(null);
                    setNotice('success', '权威列表、统计与审计已重新读取，治理写锁已解除。');
                } else {
                    setNotice('warning', '权威刷新未完整完成，治理写锁保持；系统不会重复发送写入。');
                }
            }
            return reconciled;
        } catch (error) {
            if (AstraApiClient.isCancelled(error) || !isCurrentRequest(generation)) return;
            unmountOwnerModules();
            renderAuthError(error);
        } finally {
            if (isCurrentRequest(generation)) {
                setBusy(false);
                rerenderJoinRequestsPanel();
                rerenderPanel('users');
                refreshIcons();
            }
        }
    }

    async function refreshStats(generation) {
        const requestGeneration = generation || state.requestGeneration;
        const container = state.root.querySelector('[data-admin-stats]');
        const databaseMap = state.root.querySelector('[data-admin-database-map]');
        if (!container) return;
        container.innerHTML = renderLoading('统计加载中');
        if (databaseMap) databaseMap.innerHTML = renderLoading('数据地图加载中');
        try {
            const stats = AdminSecondaryGovernance.validateStatsPayload(await fetchJson('/api/admin/stats'));
            if (!isCurrentRequest(requestGeneration)) return;
            container.innerHTML = renderStats(stats);
            if (databaseMap) databaseMap.innerHTML = renderDatabaseMap(stats, null, null);
            return true;
        } catch (error) {
            if (AstraApiClient.isCancelled(error) || !isCurrentRequest(requestGeneration)) return;
            container.innerHTML = renderError(error, '统计读取失败');
            if (databaseMap) databaseMap.innerHTML = renderError(error, '数据地图读取失败');
            return false;
        }
    }

    async function refreshPanel(panelId, generation) {
        const requestGeneration = generation || state.requestGeneration;
        const panelGeneration = (state.panelGenerations[panelId] || 0) + 1;
        state.panelGenerations[panelId] = panelGeneration;
        const config = PANEL_CONFIGS.find((item) => item.id === panelId);
        const body = state.root && state.root.querySelector(`[data-admin-panel-body="${panelId}"]`);
        const meta = state.root && state.root.querySelector(`[data-admin-panel-meta="${panelId}"]`);
        if (!config || !body) return;
        body.innerHTML = renderLoading('加载中');
        if (meta) meta.textContent = '--';
        try {
            const panelState = state.panels[panelId];
            const params = Object.assign({}, panelState.filters, {
                limit: panelState.limit,
                offset: panelState.offset
            });
            const data = await fetchJson(config.path, params);
            if (!isCurrentRequest(requestGeneration) || state.panelGenerations[panelId] !== panelGeneration) return;
            state.panelData[panelId] = data;
            body.innerHTML = renderPanelData(config, data);
            if (meta) meta.textContent = `共 ${formatNumber(data.total || 0)} 条`;
            return true;
        } catch (error) {
            if (AstraApiClient.isCancelled(error)
                || !isCurrentRequest(requestGeneration)
                || state.panelGenerations[panelId] !== panelGeneration) return;
            body.innerHTML = renderError(error, '队列读取失败');
            if (meta) meta.textContent = '读取失败';
            return false;
        } finally {
            applyAdminWriteAvailability();
            refreshIcons();
        }
    }

    function renderAuthState(mode, user) {
        const container = state.root.querySelector('[data-admin-auth-state]');
        if (!container) return;
        if (window.AstraAuthUI) AstraAuthUI.unmount(container);
        if (mode === 'checking') {
            container.innerHTML = `
                <div class="admin-auth-card admin-auth-card--checking">
                    <i data-lucide="loader-circle"></i>
                    <span>正在校验管理员会话</span>
                </div>
            `;
            return;
        }
        if (mode === 'forbidden') {
            if (window.AstraAuthUI) {
                AstraAuthUI.mountAccount(container, {
                    role: 'admin', baseUrl: state.apiBase, user: user || {}, roleMismatch: true,
                    onSignedOut: () => refreshAll()
                });
                return;
            }

            container.innerHTML = `
                <div class="admin-auth-card admin-auth-card--blocked">
                    <i data-lucide="shield-x"></i>
                    <div>
                        <strong>当前账号无管理权限</strong>
                        <span>${escapeHtml(user.display_name || user.username || '当前用户')} · ${escapeHtml(user.role || 'unknown')}</span>
                    </div>
                </div>
            `;
            return;
        }
        if (window.AstraAuthUI) {
            AstraAuthUI.mountAccount(container, {
                role: 'admin', baseUrl: state.apiBase, user: user || {},
                onSignedOut: () => refreshAll()
            });
            return;
        }
        container.innerHTML = `
            <div class="admin-auth-card admin-auth-card--ready">
                <i data-lucide="shield-check"></i>
                <div>
                    <strong>${escapeHtml(user.display_name || user.username)}</strong>
                    <span>${escapeHtml(user.username)} · ${escapeHtml(user.role)} · ${escapeHtml(user.status)}</span>
                </div>
                <span class="admin-status-pill admin-status-pill--ready">治理操作已启用</span>
            </div>
        `;
    }

    function renderAuthError(error) {
        const container = state.root.querySelector('[data-admin-auth-state]');
        if (!container) return;
        const isUnauthenticated = error && error.status === 401;
        const isForbidden = error && error.status === 403;
        const isOffline = error && error.code === 'offline';
        if (isUnauthenticated && window.AstraAuthUI) {
            AstraAuthUI.mountGate(container, {
                role: 'admin', baseUrl: state.apiBase,
                onAuthenticated: () => refreshAll()
            });
            return;
        }
        if (window.AstraAuthUI) AstraAuthUI.unmount(container);
        container.innerHTML = `
            <div class="admin-auth-card admin-auth-card--blocked">
                <i data-lucide="${isUnauthenticated ? 'lock' : isForbidden ? 'shield-x' : isOffline ? 'wifi-off' : 'server-off'}"></i>
                <div>
                    <strong>${isUnauthenticated ? '需要管理员会话' : isForbidden ? '当前账号无管理权限' : isOffline ? '当前处于离线状态' : '后端连接失败'}</strong>
                    <span>${escapeHtml(errorMessage(error))}</span>
                </div>
            </div>
        `;
    }

    function renderStats(stats) {
        const items = [
            ['pending_class_join_requests', '待审加入', 'user-plus'],
            ['total_users', '用户', 'users'],
            ['total_schools', '学校', 'landmark'],
            ['total_classes', '班级', 'school'],
            ['total_courses', '课程', 'book-open'],
            ['total_assignments', '作业', 'clipboard-list'],
            ['total_submissions', '提交', 'send'],
            ['total_audit_logs', '审计日志', 'scroll-text']
        ];
        const roleText = stats.users_by_role
            ? Object.entries(stats.users_by_role).map(([role, total]) => `${role}:${total}`).join(' / ')
            : '';
        return items.map(([key, label, icon]) => `
            <article class="admin-kpi">
                <span class="admin-kpi__icon"><i data-lucide="${icon}"></i></span>
                <strong>${formatNumber(stats[key] || 0)}</strong>
                <span>${escapeHtml(label)}</span>
                ${key === 'total_users' && roleText ? `<em>${escapeHtml(roleText)}</em>` : ''}
            </article>
        `).join('');
    }

    function renderDatabaseMap(stats, health, organizationSummary) {
        const databaseOk = health ? Boolean(health.database && health.database.ok) : true;
        const entities = [
            ['users', '用户', stats.total_users, 'users'],
            ['schools', '学校', stats.total_schools, 'landmark'],
            ['classes', '班级', stats.total_classes, 'school'],
            ['courses', '课程', stats.total_courses, 'book-open'],
            ['assignments', '作业', stats.total_assignments, 'clipboard-list'],
            ['submissions', '提交', stats.total_submissions, 'send'],
            ['events', '学习事件', stats.total_learning_events, 'activity'],
            ['audits', '审计记录', stats.total_audit_logs, 'scroll-text']
        ];
        const roleTotal = Math.max(1, Number(stats.total_users || 0));
        return `
            <header class="admin-database-map__header">
                <div>
                    <h2><i data-lucide="database-zap"></i>领域数据地图</h2>
                    <p>展示业务实体与规模；写入只能通过带校验、审计和权限控制的领域操作完成，不开放任意 SQL。</p>
                </div>
                <div class="admin-database-map__actions">
                    <span class="admin-status-pill admin-status-pill--${databaseOk ? 'good' : 'bad'}">${health ? `数据库 ${databaseOk ? '已连接' : '异常'}` : '业务统计已读取'}</span>
                    <button type="button" class="admin-icon-button" data-admin-open-panel="schools">
                        <i data-lucide="workflow"></i><span>进入受限组织治理</span>
                    </button>
                </div>
            </header>
            <div class="admin-database-map__entities">
                ${entities.map(([id, label, total, icon], index) => `
                    <article data-entity="${id}">
                        <span><i data-lucide="${icon}"></i>${escapeHtml(label)}</span>
                        <strong>${formatNumber(total || 0)}</strong>
                        ${index < entities.length - 1 ? '<i class="admin-database-map__arrow" data-lucide="arrow-right"></i>' : ''}
                    </article>
                `).join('')}
            </div>
            <div class="admin-database-map__roles" aria-label="用户角色分布">
                ${[['student', '学生'], ['teacher', '教师'], ['admin', '管理员']].map(([role, label]) => {
                    const total = Number((stats.users_by_role || {})[role] || 0);
                    const width = Math.max(total ? 4 : 0, Math.round(total / roleTotal * 100));
                    return `<div><span>${escapeHtml(label)}</span><b><i style="width:${width}%"></i></b><strong>${formatNumber(total)}</strong></div>`;
                }).join('')}
            </div>
        `;
    }

    function renderPanelData(config, data) {
        const items = Array.isArray(data.items) ? data.items : [];
        if (!items.length) {
            return `
                <div class="admin-empty">
                    <i data-lucide="circle-check"></i>
                    <span>暂无记录</span>
                </div>
                ${renderPager(config.id, data)}
            `;
        }
        return `
            <div class="admin-table-wrap">
                <table class="admin-table">
                    <thead>
                        <tr>${config.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}<th>详情</th></tr>
                    </thead>
                    <tbody>
                        ${items.map((item) => renderRow(config, item)).join('')}
                    </tbody>
                </table>
            </div>
            ${renderPager(config.id, data)}
        `;
    }

    function renderRow(config, item) {
        return `
            <tr>
                ${config.columns.map((column) => `<td data-label="${escapeAttr(column.label)}">${renderCell(item, column)}</td>`).join('')}
                <td data-label="详情">${renderDetails(config, item)}</td>
            </tr>
        `;
    }

    function renderCell(item, column) {
        const raw = valueAt(item, column.key);
        const text = formatValue(raw, column);
        if (column.badge) {
            return `<span class="admin-status-pill admin-status-pill--${statusClass(raw)}">${escapeHtml(text)}</span>`;
        }
        return escapeHtml(text);
    }

    function renderDetails(config, item) {
        const details = {};
        const approvePending = state.pendingJoinReview === `${item.id}:approved`;
        const rejectPending = state.pendingJoinReview === `${item.id}:rejected`;
        config.details.forEach((key) => {
            details[key] = valueAt(item, key);
        });
        return `
            ${config.actions === 'user-governance' ? renderUserGovernance(item) : ''}
            ${config.actions === 'organization-governance' ? renderOrganizationGovernanceAction(config, item) : ''}
            ${config.actions === 'join-request-review' && item.status === 'pending' ? `
                <div class="admin-row-actions">
                    <button type="button" class="admin-icon-button admin-icon-button--compact${approvePending ? ' admin-icon-button--confirming' : ''}" data-admin-write data-admin-join-review="approved" data-join-request-id="${item.id}" ${state.busy || state.writeLock || !state.online ? 'disabled' : ''} aria-label="${approvePending ? '再次点击确认批准加入请求' : '批准加入请求'}">
                        <i data-lucide="check"></i>
                    </button>
                    <button type="button" class="admin-icon-button admin-icon-button--compact${rejectPending ? ' admin-icon-button--confirming' : ''}" data-admin-write data-admin-join-review="rejected" data-join-request-id="${item.id}" ${state.busy || state.writeLock || !state.online ? 'disabled' : ''} aria-label="${rejectPending ? '再次点击确认拒绝加入请求' : '拒绝加入请求'}">
                        <i data-lucide="x"></i>
                    </button>
                </div>
            ` : ''}
            ${config.actions === 'organization-governance'
                ? renderOrganizationReadOnlyDetails(details)
                : `
                    <details class="admin-row-detail admin-row-detail--business">
                        <summary>查看</summary>
                        <dl>
                            ${Object.entries(details).map(([key, value]) => `
                                <div><dt>${escapeHtml(organizationFieldLabel(key))}</dt><dd>${escapeHtml(formatValue(value, {}))}</dd></div>
                            `).join('')}
                        </dl>
                    </details>
                `}
        `;
    }

    function renderOrganizationGovernanceAction(config, item) {
        const kindLabel = config.organizationKind === 'school' ? '学校' : '班级';
        const lockBlocks = Boolean(state.writeLock) && !(
            state.writeLock.action === 'organization-governance'
            && state.writeLock.kind === config.organizationKind
            && Number(state.writeLock.resourceId) === Number(item.id)
        );
        return `
            <div class="admin-row-actions">
                <button type="button" class="admin-icon-button admin-icon-button--compact" data-admin-organization-edit data-organization-kind="${config.organizationKind}" data-organization-id="${item.id}" ${state.busy || !state.online || lockBlocks ? 'disabled' : ''} aria-label="治理${escapeAttr(kindLabel)} ${escapeAttr(item.name || item.id)}">
                    <i data-lucide="settings-2"></i><span>受限治理</span>
                </button>
            </div>
        `;
    }

    function renderOrganizationReadOnlyDetails(details) {
        return `
            <details class="admin-row-detail admin-row-detail--organization">
                <summary>历史与版本</summary>
                <dl>
                    ${Object.entries(details).map(([key, value]) => `
                        <div><dt>${escapeHtml(organizationFieldLabel(key))}</dt><dd>${escapeHtml(formatValue(value, {}))}</dd></div>
                    `).join('')}
                </dl>
            </details>
        `;
    }

    function renderUserGovernance(item) {
        const pending = state.pendingUserUpdate && state.pendingUserUpdate.userId === Number(item.id)
            ? state.pendingUserUpdate
            : null;
        const confirming = Boolean(pending);
        const selectedRole = pending ? pending.role : item.role;
        const selectedStatus = pending ? pending.status : item.status;
        return `
            <div class="admin-user-governance" data-admin-user-governance="${item.id}">
                <select data-admin-user-role aria-label="用户角色">
                    ${['student', 'teacher', 'admin'].map((role) => `<option value="${role}"${selectedRole === role ? ' selected' : ''}>${role}</option>`).join('')}
                </select>
                <select data-admin-user-status aria-label="用户状态">
                    ${['active', 'disabled'].map((status) => `<option value="${status}"${selectedStatus === status ? ' selected' : ''}>${status}</option>`).join('')}
                </select>
                <button type="button" class="admin-icon-button admin-icon-button--compact${confirming ? ' admin-icon-button--confirming' : ''}" data-admin-write data-admin-user-update data-user-id="${item.id}" ${state.busy || state.writeLock || !state.online ? 'disabled' : ''} aria-label="${confirming ? '再次点击确认用户权限变更' : '预览用户权限变更'}">
                    <i data-lucide="${confirming ? 'shield-alert' : 'save'}"></i>
                </button>
            </div>`;
    }

    function organizationConfig(kind) {
        return ORGANIZATION_CONFIGS[String(kind || '')] || null;
    }

    function organizationEndpoint(kind, id) {
        const config = organizationConfig(kind);
        return config ? `/api/admin/${config.collection}/${Number(id)}` : '';
    }

    function organizationFieldLabel(key) {
        const labels = {
            id: 'ID', school_id: '学校 ID', name: '名称', region: '区域', grade: '年级',
            term: '学期', description: '说明', status: '状态', version: '版本',
            created_at: '创建时间', updated_at: '更新时间', reason: '治理原因'
        };
        return labels[key] || key;
    }

    function focusOrganizationPanel(panelId) {
        if (!['schools', 'classes'].includes(panelId)) return;
        setActiveSection(panelId === 'classes' ? 'classes' : 'organizations');
        const panel = state.root && state.root.querySelector(`[data-admin-panel="${panelId}"]`);
        if (!panel) return;
        const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        panel.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
        try { panel.focus({ preventScroll: true }); } catch (error) { panel.focus(); }
    }

    async function openOrganizationEditor(button) {
        if (state.busy || !state.online) return;
        const operationOwner = captureLifecycleOwner();
        if (!operationOwner) return;
        const kind = String(button.dataset.organizationKind || '');
        const id = Number(button.dataset.organizationId);
        const config = organizationConfig(kind);
        if (!config || !id) return;
        const generation = state.organizationGeneration + 1;
        state.organizationGeneration = generation;
        state.organizationEditorTrigger = button;
        state.pendingOrganizationUpdate = null;
        state.organizationEditor = {
            kind,
            id,
            loading: true,
            resource: null,
            draft: null,
            message: '',
            messageType: ''
        };
        setBusy(true);
        renderOrganizationDialog(true, '[data-admin-organization-title]');
        try {
            const resource = await fetchJson(organizationEndpoint(kind, id), undefined, operationOwner.controller.signal);
            if (!isLifecycleOwner(operationOwner)
                || !state.organizationEditor
                || state.organizationGeneration !== generation) return;
            state.organizationEditor.loading = false;
            state.organizationEditor.resource = resource;
            state.organizationEditor.draft = organizationDraftFromResource(config, resource);
            replacePanelResource(config.panelId, resource);
            renderOrganizationDialog(true, '[data-admin-organization-title]');
        } catch (error) {
            if (!isLifecycleOwner(operationOwner)
                || AstraApiClient.isCancelled(error)
                || state.organizationGeneration !== generation) return;
            if (!state.organizationEditor) return;
            state.organizationEditor.loading = false;
            state.organizationEditor.error = errorMessage(error);
            renderOrganizationDialog(true, '[data-admin-organization-close]');
        } finally {
            if (isLifecycleOwner(operationOwner)) setBusy(false);
            if (isLifecycleOwner(operationOwner)
                && state.organizationEditor
                && state.organizationGeneration === generation) {
                renderOrganizationDialog(true, organizationOutcomeFocusSelector());
            }
        }
    }

    function closeOrganizationEditor() {
        if (state.busy) return;
        resetOrganizationEditor(true);
    }

    function resetOrganizationEditor(restoreFocus) {
        state.organizationGeneration += 1;
        const editor = state.organizationEditor;
        const originalTrigger = state.organizationEditorTrigger;
        const currentTrigger = editor && state.root && state.root.querySelector(
            `[data-admin-organization-edit][data-organization-kind="${editor.kind}"][data-organization-id="${editor.id}"]`
        );
        const trigger = originalTrigger && originalTrigger.isConnected ? originalTrigger : currentTrigger;
        const dialog = state.root && state.root.querySelector('[data-admin-organization-dialog]');
        if (dialog && dialog.open) dialog.close();
        state.organizationEditor = null;
        state.organizationEditorTrigger = null;
        state.pendingOrganizationUpdate = null;
        if (restoreFocus && trigger && trigger.isConnected) {
            try { trigger.focus({ preventScroll: true }); } catch (error) { trigger.focus(); }
        }
    }

    function renderOrganizationDialog(openDialog, focusSelector) {
        const dialog = state.root && state.root.querySelector('[data-admin-organization-dialog]');
        const container = dialog && dialog.querySelector('[data-admin-organization-editor]');
        if (!dialog || !container || !state.organizationEditor) return;
        const nextFocusSelector = focusSelector || organizationDialogFocusSelector(dialog);
        container.innerHTML = renderOrganizationEditorContent(state.organizationEditor);
        if (openDialog && !dialog.open) {
            if (typeof dialog.showModal === 'function') dialog.showModal();
            else dialog.setAttribute('open', '');
        }
        applyAdminWriteAvailability();
        refreshIcons();
        if (openDialog || dialog.open) {
            const rafId = window.requestAnimationFrame(() => {
                state.rafIds.delete(rafId);
                if (!dialog.open && !dialog.hasAttribute('open')) return;
                let target = nextFocusSelector && dialog.querySelector(nextFocusSelector);
                if (!target || target.disabled) {
                    target = dialog.querySelector('[data-admin-organization-status], [data-admin-organization-lock], [data-admin-organization-title], [data-admin-organization-close]:not([disabled])');
                }
                if (!target) return;
                try { target.focus({ preventScroll: true }); } catch (error) { target.focus(); }
            });
            state.rafIds.add(rafId);
        }
    }

    function organizationDialogFocusSelector(dialog) {
        const active = document.activeElement;
        if (!active || !dialog.contains(active)) return '[data-admin-organization-title]';
        const confirmation = active.getAttribute && active.getAttribute('data-admin-organization-confirm');
        if (['metadata', 'status'].includes(confirmation)) {
            return `[data-admin-organization-confirm="${confirmation}"]`;
        }
        const stableAttributes = [
            'data-admin-organization-close',
            'data-admin-organization-reconcile',
            'data-admin-organization-unlock',
            'data-admin-organization-status',
            'data-admin-organization-lock',
            'data-admin-organization-title'
        ];
        for (const attribute of stableAttributes) {
            if (active.hasAttribute && active.hasAttribute(attribute)) return `[${attribute}]`;
        }
        const fieldName = String(active.getAttribute && active.getAttribute('name') || '');
        if (/^[a-z_]+$/.test(fieldName)) return `[name="${fieldName}"]`;
        return '[data-admin-organization-title]';
    }

    function organizationOutcomeFocusSelector() {
        if (state.writeLock && state.writeLock.action === 'organization-governance') {
            return state.writeLock.reconciled
                ? '[data-admin-organization-unlock]'
                : '[data-admin-organization-lock]';
        }
        if (state.organizationEditor && state.organizationEditor.message) {
            return '[data-admin-organization-status]';
        }
        return '[data-admin-organization-title]';
    }

    function renderOrganizationEditorContent(editor) {
        const config = organizationConfig(editor.kind);
        if (!config) return '';
        if (editor.loading) {
            return `
                <header class="admin-organization-dialog__header">
                    <div><span>权威读取</span><h2 id="admin-organization-dialog-title" data-admin-organization-title tabindex="-1">${escapeHtml(config.label)}治理</h2></div>
                    <button type="button" class="admin-icon-button" data-admin-organization-close disabled aria-label="读取完成后关闭治理对话框"><i data-lucide="x"></i></button>
                </header>
                <p id="admin-organization-dialog-description">正在通过精确接口读取当前资源和乐观并发版本。</p>
                ${renderLoading('读取权威状态')}
            `;
        }
        if (editor.error || !editor.resource) {
            return `
                <header class="admin-organization-dialog__header">
                    <div><span>读取失败</span><h2 id="admin-organization-dialog-title" data-admin-organization-title tabindex="-1">${escapeHtml(config.label)}治理</h2></div>
                    <button type="button" class="admin-icon-button" data-admin-organization-close aria-label="关闭治理对话框"><i data-lucide="x"></i></button>
                </header>
                <p id="admin-organization-dialog-description">未读取到权威资源，治理写入保持关闭。</p>
                <div class="admin-organization-alert admin-organization-alert--error" role="alert">${escapeHtml(editor.error || '资源不可用')}</div>
            `;
        }

        const resource = editor.resource;
        const draft = editor.draft || organizationDraftFromResource(config, resource);
        const pending = state.pendingOrganizationUpdate
            && state.pendingOrganizationUpdate.kind === editor.kind
            && state.pendingOrganizationUpdate.id === editor.id
            ? state.pendingOrganizationUpdate
            : null;
        const lock = state.writeLock
            && state.writeLock.action === 'organization-governance'
            && state.writeLock.kind === editor.kind
            && state.writeLock.resourceId === editor.id
            ? state.writeLock
            : null;
        const archived = resource.status === 'archived';
        const nextStatus = archived ? 'active' : 'archived';
        const statusAction = archived ? '恢复' : '归档';
        const disabled = state.busy || Boolean(state.writeLock) || !state.online;
        return `
            <header class="admin-organization-dialog__header">
                <div>
                    <span>受限领域治理</span>
                    <h2 id="admin-organization-dialog-title" data-admin-organization-title tabindex="-1">${escapeHtml(config.label)} · ${escapeHtml(resource.name)}</h2>
                </div>
                <button type="button" class="admin-icon-button" data-admin-organization-close ${state.busy ? 'disabled' : ''} aria-label="关闭治理对话框"><i data-lucide="x"></i></button>
            </header>
            <p id="admin-organization-dialog-description">仅可修改明确列出的领域字段；版本号和归属关系由系统维护，每次写入都记录原因与审计。</p>
            ${editor.message ? `<div class="admin-organization-alert admin-organization-alert--${escapeAttr(editor.messageType || 'warning')}" data-admin-organization-status tabindex="-1" role="${editor.messageType === 'success' ? 'status' : 'alert'}">${escapeHtml(editor.message)}</div>` : ''}
            ${lock ? renderOrganizationWriteLock(lock) : ''}
            <dl class="admin-organization-readonly" data-admin-organization-readonly="${escapeAttr(resource.status)}">
                <div><dt>ID</dt><dd>${formatNumber(resource.id)}</dd></div>
                ${editor.kind === 'class' ? `<div><dt>学校 ID</dt><dd>${formatNumber(resource.school_id)}</dd></div>` : ''}
                <div><dt>当前状态</dt><dd><span class="admin-status-pill admin-status-pill--${statusClass(resource.status)}">${archived ? '已归档 · 教学只读' : '启用'}</span></dd></div>
                <div><dt>权威版本</dt><dd data-admin-organization-version="${resource.version}">v${formatNumber(resource.version)}</dd></div>
                <div><dt>更新时间</dt><dd>${escapeHtml(formatDate(resource.updated_at))}</dd></div>
            </dl>
            <form class="admin-organization-form" data-admin-organization-form data-organization-kind="${editor.kind}" data-organization-id="${editor.id}" aria-busy="${state.busy ? 'true' : 'false'}">
                <div class="admin-organization-form__fields">
                    ${config.fields.map((field) => renderOrganizationField(field, draft[field.name])).join('')}
                </div>
                <label class="admin-organization-form__reason">
                    <span>治理原因 <b>必填</b></span>
                    <textarea name="reason" data-admin-organization-reason required maxlength="500" rows="3" placeholder="说明本次调整的业务原因和影响">${escapeHtml(draft.reason || '')}</textarea>
                </label>
                <div class="admin-organization-form__notice" data-admin-organization-form-notice hidden></div>
                ${pending ? renderOrganizationPreview(pending, resource) : ''}
                <div class="admin-organization-form__actions">
                    <button type="button" class="admin-icon-button${pending && pending.action === 'metadata' ? ' admin-icon-button--confirming' : ''}" data-admin-write data-admin-organization-confirm="metadata" ${disabled ? 'disabled' : ''} aria-label="${pending && pending.action === 'metadata' ? `再次确认写入${config.label}资料` : `预览${config.label}资料变更`}">
                        <i data-lucide="${pending && pending.action === 'metadata' ? 'shield-alert' : 'save'}"></i>
                        <span>${pending && pending.action === 'metadata' ? '再次确认写入资料' : '预览资料变更'}</span>
                    </button>
                    <button type="button" class="admin-icon-button ${archived ? 'admin-icon-button--restore' : 'admin-icon-button--danger'}${pending && pending.action === 'status' ? ' admin-icon-button--confirming' : ''}" data-admin-write data-admin-organization-confirm="status" data-next-status="${nextStatus}" ${disabled ? 'disabled' : ''} aria-label="${pending && pending.action === 'status' ? `再次确认${statusAction}${config.label}` : `预览${statusAction}${config.label}`}">
                        <i data-lucide="${archived ? 'archive-restore' : 'archive'}"></i>
                        <span>${pending && pending.action === 'status' ? `再次确认${statusAction}` : `预览${statusAction}`}</span>
                    </button>
                </div>
                <p class="admin-organization-form__history-note"><i data-lucide="history"></i>归档不是删除：历史作业、提交、学习事件、统计与审计继续保留只读；恢复仍以后端责任人和父组织约束为准。</p>
            </form>
        `;
    }

    function renderOrganizationField(field, value) {
        const attributes = `${field.required ? ' required' : ''} maxlength="${field.maxLength}"`;
        const control = field.multiline
            ? `<textarea name="${field.name}" rows="4"${attributes}>${escapeHtml(value || '')}</textarea>`
            : `<input type="text" name="${field.name}" value="${escapeAttr(value || '')}"${attributes}>`;
        return `<label class="${field.multiline ? 'admin-organization-field--multiline' : ''}"><span>${escapeHtml(field.label)}${field.required ? ' <b>必填</b>' : ''}</span>${control}</label>`;
    }

    function renderOrganizationPreview(pending, resource) {
        const entries = Object.entries(pending.payload)
            .filter(([key]) => !['expected_version', 'reason'].includes(key));
        return `
            <section class="admin-organization-preview" data-admin-organization-preview role="alert">
                <h3><i data-lucide="shield-alert"></i>写入预览：尚未发送</h3>
                <dl>
                    ${entries.map(([key, value]) => `
                        <div>
                            <dt>${escapeHtml(organizationFieldLabel(key))}</dt>
                            <dd><del>${escapeHtml(formatOrganizationComparison(resource[key]))}</del><i data-lucide="arrow-right"></i><ins>${escapeHtml(formatOrganizationComparison(value))}</ins></dd>
                        </div>
                    `).join('')}
                    <div><dt>原因</dt><dd>${escapeHtml(pending.payload.reason)}</dd></div>
                    <div><dt>并发版本</dt><dd>v${formatNumber(pending.payload.expected_version)}</dd></div>
                </dl>
                <p>再次点击同一操作按钮才会发送一次 PATCH；输入变化会立即废弃本次确认。</p>
            </section>
        `;
    }

    function renderOrganizationWriteLock(lock) {
        const requestId = String(lock.requestId || '').trim();
        return `
            <section class="admin-organization-write-lock" data-admin-organization-lock tabindex="-1" role="alert">
                <h3><i data-lucide="lock-keyhole"></i>${lock.reconciled ? '结果已回读，等待人工确认' : '治理写入已锁定'}</h3>
                <p>${escapeHtml(lock.message || '系统不会自动重复发送写入；请先精确读取权威资源并核对审计。')}</p>
                ${requestId ? `<code>Request ID: ${escapeHtml(requestId)}</code>` : ''}
                <div>
                    <button type="button" class="admin-icon-button" data-admin-organization-reconcile ${state.busy ? 'disabled' : ''}><i data-lucide="refresh-cw"></i><span>重新权威对账</span></button>
                    ${lock.reconciled ? `<button type="button" class="admin-icon-button admin-icon-button--confirming" data-admin-organization-unlock ${state.busy ? 'disabled' : ''}><i data-lucide="unlock-keyhole"></i><span>确认核对并解除锁定</span></button>` : ''}
                </div>
            </section>
        `;
    }

    function organizationDraftFromResource(config, resource) {
        const draft = { reason: '' };
        config.fields.forEach((field) => {
            draft[field.name] = resource[field.name] === null || resource[field.name] === undefined
                ? ''
                : String(resource[field.name]);
        });
        return draft;
    }

    function readOrganizationDraft(form, config) {
        const draft = { reason: String(form.elements.reason?.value || '') };
        config.fields.forEach((field) => {
            draft[field.name] = String(form.elements[field.name]?.value || '');
        });
        return draft;
    }

    function normalizedOrganizationValue(field, value) {
        const normalized = String(value === null || value === undefined ? '' : value).trim();
        if (field.required) return normalized;
        return normalized || null;
    }

    function prepareOrganizationUpdate(action) {
        if (state.busy || !state.organizationEditor || !state.organizationEditor.resource) return;
        const editor = state.organizationEditor;
        const config = organizationConfig(editor.kind);
        const dialog = state.root && state.root.querySelector('[data-admin-organization-dialog]');
        const form = dialog && dialog.querySelector('[data-admin-organization-form]');
        if (!config || !form) return;
        if (!state.online) {
            setOrganizationEditorMessage('warning', '当前离线，组织治理写入已停用。');
            return;
        }
        if (state.writeLock) {
            setOrganizationEditorMessage('warning', '已有治理写入等待权威对账，解除锁定前不能发送新写入。');
            return;
        }

        const draft = readOrganizationDraft(form, config);
        editor.draft = draft;
        let payload;
        try {
            payload = buildOrganizationMutation(editor.kind, editor.resource, draft, action);
        } catch (error) {
            showOrganizationFormError(form, error.message, error.selector);
            return;
        }

        const signature = organizationMutationSignature(editor.kind, editor.id, action, payload);
        const pending = state.pendingOrganizationUpdate;
        if (!pending || pending.signature !== signature) {
            state.pendingOrganizationUpdate = {
                signature,
                kind: editor.kind,
                id: editor.id,
                action,
                payload,
                draft: { ...draft }
            };
            editor.message = '变更预览已生成，尚未发送；请核对后再次点击同一操作按钮。';
            editor.messageType = 'warning';
            renderOrganizationDialog(true, `[data-admin-organization-confirm="${action}"]`);
            return;
        }
        commitOrganizationUpdate(pending);
    }

    function organizationMutationSignature(kind, id, action, payload) {
        return JSON.stringify({ kind, id: Number(id), action, payload });
    }

    function buildOrganizationMutation(kind, resource, draft, action) {
        const config = organizationConfig(kind);
        if (!config || !resource || !draft) throw organizationValidationError('组织治理输入无效。');
        const reason = String(draft.reason || '').trim();
        if (!reason) throw organizationValidationError('治理原因不能为空。', '[data-admin-organization-reason]');
        if (reason.length > 500) throw organizationValidationError('治理原因不能超过 500 个字符。', '[data-admin-organization-reason]');
        const payload = {
            expected_version: Number(resource.version),
            reason
        };
        if (action === 'status') {
            payload.status = resource.status === 'archived' ? 'active' : 'archived';
            return payload;
        }
        if (action !== 'metadata') throw organizationValidationError('未知的组织治理动作。');
        for (const field of config.fields) {
            const nextValue = normalizedOrganizationValue(field, draft[field.name]);
            if (field.required && !nextValue) {
                throw organizationValidationError(`${field.label}不能为空。`, `[name="${field.name}"]`);
            }
            if (nextValue !== null && String(nextValue).length > field.maxLength) {
                throw organizationValidationError(`${field.label}不能超过 ${field.maxLength} 个字符。`, `[name="${field.name}"]`);
            }
            const currentValue = normalizedOrganizationValue(field, resource[field.name]);
            if (nextValue !== currentValue) payload[field.name] = nextValue;
        }
        if (Object.keys(payload).length === 2) {
            throw organizationValidationError('资料字段没有变化，未发送写入。');
        }
        return payload;
    }

    function organizationValidationError(message, selector) {
        const error = new Error(message);
        error.selector = selector || '';
        return error;
    }

    async function commitOrganizationUpdate(submission) {
        if (state.busy || state.writeLock || !state.online) return;
        const operationOwner = captureLifecycleOwner();
        if (!operationOwner) return;
        const config = organizationConfig(submission.kind);
        if (!config) return;
        state.pendingOrganizationUpdate = null;
        setBusy(true);
        setOrganizationEditorMessage('warning', '治理写入正在发送；刷新和其他写操作已锁定。', false);
        renderOrganizationDialog(true, '[data-admin-organization-title]');
        try {
            await AstraApiClient.request(organizationEndpoint(submission.kind, submission.id), {
                baseUrl: state.apiBase,
                method: 'PATCH',
                body: submission.payload,
                signal: operationOwner.controller.signal
            });
            setWriteLock(organizationWriteLock(submission, {
                outcome: 'confirmed',
                message: '服务器已确认写入，正在执行精确资源、列表、统计和审计回读；生命周期切换时必须由新页面显式续接对账。'
            }));
            if (!isLifecycleOwner(operationOwner)) return;
            const authority = await loadOrganizationAuthority(submission.kind, submission.id, submission.draft, operationOwner);
            if (!isLifecycleOwner(operationOwner)) return;
            if (!organizationMutationMatches(authority, submission.payload, submission.payload.expected_version)) {
                setWriteLock(organizationWriteLock(submission, {
                    outcome: 'confirmed-authority-mismatch',
                    reconciled: true,
                    authorityVersion: Number(authority.version),
                    message: '服务器已返回成功，但精确权威资源不是预期的 version+1/目标字段；不得宣称成功或自动重发。'
                }));
                if (state.organizationEditor) {
                    state.organizationEditor.draft = { ...submission.draft };
                    state.organizationEditor.message = state.writeLock.message;
                    state.organizationEditor.messageType = 'warning';
                }
                await refreshOrganizationEvidence(config.panelId);
                if (!isLifecycleOwner(operationOwner)) return;
                setNotice('warning', `${config.label} #${submission.id} 的成功响应与权威资源不一致，写锁保持并等待人工核对。`);
                return;
            }
            const evidenceOk = await refreshOrganizationEvidence(config.panelId);
            if (!isLifecycleOwner(operationOwner)) return;
            if (evidenceOk) {
                setWriteLock(null);
                if (state.organizationEditor) {
                    state.organizationEditor.draft = organizationDraftFromResource(config, authority);
                    state.organizationEditor.message = `已写入并完成权威回读，当前版本为 v${authority.version}。`;
                    state.organizationEditor.messageType = 'success';
                }
                setNotice('success', `${config.label} #${submission.id} 已更新，权威资源、统计和审计已同步。`);
            } else {
                setWriteLock(organizationWriteLock(submission, {
                    outcome: 'confirmed-awaiting-evidence',
                    message: '服务器已确认写入，但列表、统计或审计回读未完整完成。'
                }));
                setOrganizationEditorMessage('warning', '写入已确认，但完整对账尚未完成；系统不会重复发送，请重新权威对账。', false);
            }
        } catch (error) {
            if (error && error.status === 409) {
                if (isLifecycleOwner(operationOwner)) {
                    await handleOrganizationConflict(submission, error, operationOwner);
                }
            } else if (error && (error.confirmed || AstraApiClient.isAmbiguousMutation(error))) {
                setWriteLock(organizationWriteLock(submission, {
                    outcome: error.confirmed ? 'confirmed-unknown-response' : 'unknown',
                    requestId: String(error.requestId || ''),
                    message: '写入响应无法确认，系统未自动重试；必须通过精确资源和审计回读判定结果。'
                }));
                if (isLifecycleOwner(operationOwner)) {
                    await reconcileOrganizationWrite(false, operationOwner);
                }
            } else if (isLifecycleOwner(operationOwner) && !AstraApiClient.isCancelled(error)) {
                setOrganizationEditorMessage('error', errorMessage(error), false);
            }
        } finally {
            if (isLifecycleOwner(operationOwner)) {
                setBusy(false);
                if (state.organizationEditor) renderOrganizationDialog(true, organizationOutcomeFocusSelector());
                applyAdminWriteAvailability();
            }
        }
    }

    function organizationWriteLock(submission, extra) {
        return Object.assign({
            action: 'organization-governance',
            kind: submission.kind,
            resourceId: submission.id,
            payload: { ...submission.payload },
            draft: { ...submission.draft },
            expectedVersion: Number(submission.payload.expected_version),
            reconciled: false,
            requestId: ''
        }, extra || {});
    }

    async function handleOrganizationConflict(submission, error, operationOwner) {
        const config = organizationConfig(submission.kind);
        try {
            const authority = await loadOrganizationAuthority(submission.kind, submission.id, submission.draft, operationOwner);
            if (!isLifecycleOwner(operationOwner)) return;
            if (state.organizationEditor) {
                state.organizationEditor.draft = { ...submission.draft };
                state.organizationEditor.message = `检测到版本冲突：服务器当前为 v${authority.version}。旧确认已废弃，草稿已保留；请基于最新值重新预览。`;
                state.organizationEditor.messageType = 'warning';
            }
            await Promise.all([refreshPanel(config.panelId), refreshPanel('audit-logs')]);
            if (!isLifecycleOwner(operationOwner)) return;
            setNotice('warning', `${config.label} #${submission.id} 发生并发冲突，已精确回读且未自动重发。`);
        } catch (readError) {
            if (!isLifecycleOwner(operationOwner) || AstraApiClient.isCancelled(readError)) return;
            setWriteLock(organizationWriteLock(submission, {
                outcome: 'conflict-unreconciled',
                requestId: String(error.requestId || ''),
                message: '服务器拒绝了陈旧版本，但最新资源读取失败；写入保持锁定。'
            }));
            setOrganizationEditorMessage('warning', '版本冲突后的权威读取失败；请重新对账，系统不会自动重发。', false);
        }
    }

    async function reconcileOrganizationWrite(manual, existingOwner) {
        const lock = state.writeLock;
        if (!lock || lock.action !== 'organization-governance') return false;
        if (manual && state.busy) return false;
        const operationOwner = existingOwner || captureLifecycleOwner();
        if (!operationOwner || !isLifecycleOwner(operationOwner)) return false;
        const wasBusy = state.busy;
        if (!wasBusy) {
            setBusy(true);
            if (state.organizationEditor) renderOrganizationDialog(true, '[data-admin-organization-title]');
        }
        try {
            const config = organizationConfig(lock.kind);
            const authority = await loadOrganizationAuthority(lock.kind, lock.resourceId, lock.draft, operationOwner);
            if (!isLifecycleOwner(operationOwner)) return false;
            if (organizationMutationMatches(authority, lock.payload, lock.expectedVersion)) {
                const evidenceOk = await refreshOrganizationEvidence(config.panelId);
                if (!isLifecycleOwner(operationOwner)) return false;
                if (evidenceOk) {
                    setWriteLock(null);
                    state.pendingOrganizationUpdate = null;
                    if (state.organizationEditor) {
                        state.organizationEditor.draft = organizationDraftFromResource(config, authority);
                        state.organizationEditor.message = `未知响应已由权威回读确认生效，当前版本为 v${authority.version}；未发生重复写入。`;
                        state.organizationEditor.messageType = 'success';
                    }
                    setNotice('success', `${config.label} #${lock.resourceId} 已由权威回读确认生效，治理写锁已解除。`);
                    return true;
                }
                setWriteLock(Object.assign({}, lock, {
                    outcome: 'applied-awaiting-evidence',
                    message: '精确资源已证明变更生效，但列表、统计或审计仍未完整回读。'
                }));
                return false;
            }

            const unchangedVersion = Number(authority.version) === Number(lock.expectedVersion);
            setWriteLock(Object.assign({}, lock, {
                reconciled: true,
                authorityVersion: Number(authority.version),
                outcome: unchangedVersion ? 'not-observed' : 'conflict-observed',
                message: unchangedVersion
                    ? '精确回读尚未观察到目标变更；请核对后人工解除锁定，任何重试都必须重新双确认。'
                    : '权威版本已变化且内容与目标不一致；请核对冲突后人工解除锁定。'
            }));
            if (state.organizationEditor) {
                state.organizationEditor.draft = { ...(lock.draft || {}) };
                state.organizationEditor.message = state.writeLock.message;
                state.organizationEditor.messageType = 'warning';
            }
            setNotice('warning', `${config.label} #${lock.resourceId} 的写入结果未获证明，系统未自动重试。`);
            return false;
        } catch (error) {
            if (!isLifecycleOwner(operationOwner) || AstraApiClient.isCancelled(error)) return false;
            setWriteLock(Object.assign({}, lock, {
                reconciled: false,
                message: '权威资源读取失败，治理写锁保持；系统不会自动重试。'
            }));
            setOrganizationEditorMessage('warning', `${state.writeLock.message}${state.writeLock.requestId ? ` Request ID: ${state.writeLock.requestId}` : ''}`, false);
            return false;
        } finally {
            if (isLifecycleOwner(operationOwner)) {
                if (!wasBusy) setBusy(false);
                if (state.organizationEditor) renderOrganizationDialog(true, organizationOutcomeFocusSelector());
            }
        }
    }

    function unlockOrganizationWrite() {
        const lock = state.writeLock;
        if (state.busy || !lock || lock.action !== 'organization-governance' || !lock.reconciled) return;
        const config = organizationConfig(lock.kind);
        setWriteLock(null);
        state.pendingOrganizationUpdate = null;
        if (state.organizationEditor) {
            state.organizationEditor.message = '已依据权威回读人工解除锁定。草稿仍保留，任何新写入都必须重新预览并再次确认。';
            state.organizationEditor.messageType = 'warning';
        }
        setNotice('warning', `${config.label} #${lock.resourceId} 的写锁已人工解除；系统没有自动重发。`);
        renderOrganizationDialog(true, '[data-admin-organization-status]');
    }

    async function loadOrganizationAuthority(kind, id, preservedDraft, operationOwner) {
        const config = organizationConfig(kind);
        if (operationOwner && !isLifecycleOwner(operationOwner)) {
            throw Object.assign(new Error('组织治理生命周期已切换。'), {
                code: 'cancelled',
                cancelled: true,
                ambiguous: false
            });
        }
        const resource = await fetchJson(
            organizationEndpoint(kind, id),
            undefined,
            operationOwner && operationOwner.controller.signal
        );
        if (operationOwner && !isLifecycleOwner(operationOwner)) {
            throw Object.assign(new Error('组织治理生命周期已切换。'), {
                code: 'cancelled',
                cancelled: true,
                ambiguous: false
            });
        }
        replacePanelResource(config.panelId, resource);
        if (state.organizationEditor
            && state.organizationEditor.kind === kind
            && state.organizationEditor.id === Number(id)) {
            state.organizationEditor.resource = resource;
            state.organizationEditor.loading = false;
            state.organizationEditor.error = '';
            state.organizationEditor.draft = preservedDraft
                ? { ...preservedDraft }
                : organizationDraftFromResource(config, resource);
        }
        return resource;
    }

    async function refreshOrganizationEvidence(panelId) {
        const results = await Promise.all([
            refreshPanel(panelId),
            refreshPanel('audit-logs'),
            refreshStats()
        ]);
        return results.every((result) => result === true);
    }

    function replacePanelResource(panelId, resource) {
        const page = state.panelData[panelId];
        if (!page || !Array.isArray(page.items)) return;
        const index = page.items.findIndex((item) => Number(item.id) === Number(resource.id));
        if (index >= 0) page.items[index] = resource;
        rerenderPanel(panelId);
    }

    function organizationMutationMatches(resource, payload, expectedVersion) {
        if (!resource || Number(resource.version) !== Number(expectedVersion) + 1) return false;
        return Object.entries(payload || {})
            .filter(([key]) => !['expected_version', 'reason'].includes(key))
            .every(([key, value]) => normalizedComparable(resource[key]) === normalizedComparable(value));
    }

    function normalizedComparable(value) {
        if (value === null || value === undefined || String(value).trim() === '') return null;
        return String(value).trim();
    }

    function formatOrganizationComparison(value) {
        const normalized = normalizedComparable(value);
        return normalized === null ? '（空）' : normalized;
    }

    function showOrganizationFormError(form, message, selector) {
        const notice = form.querySelector('[data-admin-organization-form-notice]');
        if (notice) {
            notice.hidden = false;
            notice.className = 'admin-organization-form__notice admin-organization-form__notice--error';
            notice.textContent = message;
        }
        if (selector) {
            const target = form.querySelector(selector);
            if (target) target.focus();
        }
    }

    function setOrganizationEditorMessage(type, message, rerender) {
        if (!state.organizationEditor) return;
        state.organizationEditor.messageType = type;
        state.organizationEditor.message = String(message || '');
        if (rerender !== false) renderOrganizationDialog(true, '[data-admin-organization-status]');
    }

    function renderPager(panelId, data) {
        const panelState = state.panels[panelId];
        const total = data.total || 0;
        const from = total === 0 ? 0 : panelState.offset + 1;
        const to = Math.min(total, panelState.offset + (data.items ? data.items.length : 0));
        const hasPrev = panelState.offset > 0;
        const hasNext = data.next_offset !== null && data.next_offset !== undefined;
        return `
            <div class="admin-pager">
                <span>${formatNumber(from)}-${formatNumber(to)} / ${formatNumber(total)}</span>
                <div>
                    <button type="button" class="admin-icon-button admin-icon-button--compact" data-admin-panel-id="${panelId}" data-admin-page="prev"${hasPrev ? '' : ' disabled'} aria-label="上一页">
                        <i data-lucide="chevron-left"></i>
                    </button>
                    <button type="button" class="admin-icon-button admin-icon-button--compact" data-admin-panel-id="${panelId}" data-admin-page="next"${hasNext ? '' : ' disabled'} aria-label="下一页">
                        <i data-lucide="chevron-right"></i>
                    </button>
                </div>
            </div>
        `;
    }

    async function updateUserGovernance(button) {
        if (state.busy || state.writeLock) return;
        if (!state.online) {
            setNotice('warning', '当前离线，用户治理写入已停用。');
            return;
        }
        const userId = Number(button.dataset.userId);
        const controls = button.closest('[data-admin-user-governance]');
        const role = controls && controls.querySelector('[data-admin-user-role]')?.value;
        const status = controls && controls.querySelector('[data-admin-user-status]')?.value;
        if (!userId || !['student', 'teacher', 'admin'].includes(role) || !['active', 'disabled'].includes(status)) return;

        const currentUser = ((state.panelData.users && state.panelData.users.items) || [])
            .find((item) => Number(item.id) === userId);
        if (currentUser && currentUser.role === role && currentUser.status === status) {
            state.pendingUserUpdate = null;
            setNotice('warning', `用户 #${userId} 的角色和状态没有变化，未发送写入。`);
            rerenderPanel('users');
            refreshIcons();
            return;
        }

        const confirmationKey = `${userId}:${role}:${status}`;
        if (!state.pendingUserUpdate || state.pendingUserUpdate.key !== confirmationKey) {
            state.pendingUserUpdate = { key: confirmationKey, userId, role, status };
            setNotice('warning', `将用户 #${userId} 调整为 ${role} / ${status}。再次点击同一保存按钮才会写入；权限变化会撤销其活动会话。`);
            rerenderPanel('users');
            refreshIcons();
            return;
        }

        state.pendingUserUpdate = null;
        setBusy(true);
        try {
            await AstraApiClient.request(`/api/admin/users/${userId}`, {
                baseUrl: state.apiBase,
                method: 'PATCH',
                body: { role, status },
                signal: state.lifecycleController && state.lifecycleController.signal
            });
            const results = await Promise.all([
                refreshPanel('users'), refreshPanel('audit-logs'), refreshStats()
            ]);
            if (results.some((result) => !result)) {
                setWriteLock({ action: 'user-governance', resourceId: userId });
                setNotice('warning', '用户变更已由服务端确认，但列表核对未完整完成；写入已锁定，请刷新后核对。');
            } else {
                setNotice('success', `用户 #${userId} 已更新为 ${role} / ${status}，审计日志和统计已同步。`);
            }
        } catch (error) {
            if (error && (error.confirmed || AstraApiClient.isAmbiguousMutation(error))) {
                setWriteLock({
                    action: 'user-governance', resourceId: userId, requestId: String(error.requestId || '')
                });
                await Promise.all([refreshPanel('users'), refreshPanel('audit-logs'), refreshStats()]);
                setNotice('warning', '用户变更结果尚未确认，系统未自动重试；写入已锁定，请刷新并依据审计日志核对。');
            } else {
                setNotice('error', errorMessage(error));
            }
        } finally {
            setBusy(false);
            rerenderPanel('users');
            refreshIcons();
        }
    }

    function adminItems(payload) {
        return Array.isArray(payload) ? payload : payload && Array.isArray(payload.items) ? payload.items : [];
    }

    function joinRequestMatches(item, authority, nextStatus) {
        return Boolean(item && authority
            && ['id', 'school_id', 'class_id', 'user_id'].every((key) => Number(item[key]) === Number(authority[key]))
            && String(item.role) === String(authority.role)
            && String(item.status) === String(nextStatus));
    }

    function parseAuditSnapshot(value) {
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
        try { return typeof value === 'string' ? JSON.parse(value) : null; } catch (error) { return null; }
    }

    function joinReviewAuditMatches(payload, authority, nextStatus, requestId) {
        const action = nextStatus === 'approved' ? 'class.join.request.approve' : 'class.join.request.reject';
        return adminItems(payload).some((item) => {
            const after = (parseAuditSnapshot(item.snapshot_json) || {}).after || {};
            return item.action === action && item.resource_type === 'class_join_request'
                && Number(item.resource_id) === Number(authority.id) && item.request_id === requestId
                && item.event_result === 'success'
                && Number(after.class_id) === Number(authority.class_id)
                && Number(after.user_id) === Number(authority.user_id)
                && String(after.role) === String(authority.role)
                && String(after.status) === String(nextStatus);
        });
    }

    function createConfirmedJoinReviewExecutor(execute, onChange) {
        let pending = null;
        let inFlight = null;
        const snapshot = () => Object.freeze({ pending, busy: Boolean(inFlight) });
        const emit = () => { if (typeof onChange === 'function') onChange(snapshot()); };
        return Object.freeze({
            submit: async (authority, nextStatus) => {
                if (inFlight) return { kind: 'busy', sent: false };
                const signature = JSON.stringify([authority.id, authority.school_id, authority.class_id, authority.user_id, authority.role, nextStatus]);
                if (!pending || pending.signature !== signature) {
                    pending = { signature, key: `${authority.id}:${nextStatus}` };
                    emit();
                    return { kind: 'confirmation', sent: false };
                }
                pending = null;
                inFlight = Promise.resolve().then(() => execute(authority, nextStatus));
                emit();
                try { return { kind: 'sent', sent: true, value: await inFlight }; }
                finally { inFlight = null; emit(); }
            },
            invalidate: () => { pending = null; emit(); },
            snapshot
        });
    }

    function joinReviewRequestId() {
        const random = globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
            ? globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 18)
            : Math.random().toString(36).slice(2, 20);
        return `admin-join-${Date.now().toString(36)}-${random}`.slice(0, 64);
    }

    async function findApprovedMember(authority, options) {
        if (options.nextStatus !== 'approved') return null;
        let offset = 0;
        const seen = new Set();
        while (!seen.has(offset)) {
            seen.add(offset);
            const page = await options.request(`/api/classes/${Number(authority.class_id)}/members/page`, {
                baseUrl: options.baseUrl,
                params: { role: authority.role, status: 'active', limit: 200, offset },
                signal: options.signal
            });
            if (!page || !Array.isArray(page.items)) throw new Error('班级成员分页响应无效');
            const member = page.items.find((item) => Number(item.class_id) === Number(authority.class_id)
                && Number(item.user_id) === Number(authority.user_id)
                && item.role === authority.role && item.status === 'active');
            if (member) return { page, member };
            if (page.next_offset === null || page.next_offset === undefined) break;
            offset = Number(page.next_offset);
            if (!Number.isInteger(offset) || offset < 0) break;
        }
        throw new Error('批准后未在权威成员分页中找到对应关系');
    }

    async function readJoinReviewAuthority(authority, nextStatus, requestId, options) {
        const common = { baseUrl: options.baseUrl, signal: options.signal };
        const action = nextStatus === 'approved' ? 'class.join.request.approve' : 'class.join.request.reject';
        const [exactPage, joinList, stats, audit, member] = await Promise.all([
            options.request('/api/admin/class-join-requests', {
                ...common, params: { status: nextStatus, class_id: authority.class_id, user_id: authority.user_id, role: authority.role, limit: 200, offset: 0 }
            }),
            options.request('/api/admin/class-join-requests', { ...common, params: options.listParams }),
            options.request('/api/admin/stats', common),
            options.request('/api/admin/audit-logs', {
                ...common, params: { action, resource_type: 'class_join_request', resource_id: authority.id, request_id: requestId, limit: 25, offset: 0 }
            }),
            findApprovedMember(authority, { ...options, nextStatus })
        ]);
        const reviewed = adminItems(exactPage).find((item) => Number(item.id) === Number(authority.id));
        if (!joinRequestMatches(reviewed, authority, nextStatus)) throw new Error('加入申请权威回读不匹配');
        if (!joinList || !Array.isArray(joinList.items)) throw new Error('加入申请列表刷新无效');
        const checkedStats = AdminSecondaryGovernance.validateStatsPayload(stats);
        if (!joinReviewAuditMatches(audit, authority, nextStatus, requestId)) throw new Error('加入审批精确审计回读不匹配');
        return Object.freeze({ reviewed, joinList, stats: checkedStats, audit, member });
    }

    function joinReviewUnknown(message, authority, nextStatus, requestId, baseUrl, cause) {
        return Object.assign(new Error(message), {
            joinReviewUnknown: true, authority, nextStatus, requestId, baseUrl, cause
        });
    }

    async function executeJoinReviewTransaction(authority, nextStatus, options) {
        const requestId = options.requestId || joinReviewRequestId();
        let response;
        try {
            response = await options.request(`/api/admin/class-join-requests/${Number(authority.id)}`, {
                baseUrl: options.baseUrl, method: 'PATCH', headers: { 'X-Request-ID': requestId },
                body: { status: nextStatus, note: 'reviewed from admin governance UI' }, signal: options.signal
            });
        } catch (error) {
            if (typeof options.isAmbiguous === 'function' && options.isAmbiguous(error)) {
                throw joinReviewUnknown('加入审批结果未知', authority, nextStatus, requestId, options.baseUrl, error);
            }
            throw error;
        }
        if (!joinRequestMatches(response, authority, nextStatus)) {
            throw joinReviewUnknown('加入审批响应与原申请不匹配', authority, nextStatus, requestId, options.baseUrl);
        }
        try {
            const readback = await readJoinReviewAuthority(authority, nextStatus, requestId, options);
            return Object.freeze({ response, readback, requestId, baseUrl: options.baseUrl });
        } catch (error) {
            throw joinReviewUnknown('加入审批必要回读未完整通过', authority, nextStatus, requestId, options.baseUrl, error);
        }
    }

    function currentJoinListParams() { const panel = state.panels['join-requests']; return Object.assign({}, panel.filters, { limit: panel.limit, offset: panel.offset }); }

    function applyJoinReviewReadback(readback) {
        state.panelData['join-requests'] = readback.joinList;
        state.panelData['audit-logs'] = readback.audit;
        state.sectionLoaded.audit = false;
        rerenderJoinRequestsPanel();
        rerenderPanel('audit-logs');
        const meta = state.root && state.root.querySelector('[data-admin-panel-meta="join-requests"]');
        if (meta) meta.textContent = `共 ${formatNumber(readback.joinList.total || 0)} 条`;
        const stats = state.root && state.root.querySelector('[data-admin-stats]');
        const map = state.root && state.root.querySelector('[data-admin-database-map]');
        if (stats) stats.innerHTML = renderStats(readback.stats);
        if (map) map.innerHTML = renderDatabaseMap(readback.stats, null, null);
    }

    function joinReviewLock(error) {
        return {
            action: 'join-request-review', resourceId: Number(error.authority.id),
            authority: error.authority, nextStatus: error.nextStatus,
            requestId: error.requestId, baseUrl: error.baseUrl
        };
    }

    async function reconcileJoinReviewWrite(lock) {
        if (!lock || lock.action !== 'join-request-review') return false;
        try {
            const readback = await readJoinReviewAuthority(lock.authority, lock.nextStatus, lock.requestId, {
                request: AstraApiClient.request.bind(AstraApiClient), baseUrl: lock.baseUrl,
                signal: state.lifecycleController && state.lifecycleController.signal,
                listParams: currentJoinListParams()
            });
            applyJoinReviewReadback(readback);
            setWriteLock(null);
            setNotice('success', `加入申请 #${lock.resourceId} 已由申请、成员/拒绝边界、统计与精确审计共同确认；未重发 PATCH。`);
            return true;
        } catch (error) {
            setNotice('warning', '加入审批权威回读仍未完整通过；写锁保持，系统不会自动重发 PATCH。');
            return false;
        }
    }

    async function commitJoinReview(authority, nextStatus) {
        setBusy(true);
        try {
            const result = await executeJoinReviewTransaction(authority, nextStatus, {
                request: AstraApiClient.request.bind(AstraApiClient), baseUrl: state.apiBase,
                signal: state.lifecycleController && state.lifecycleController.signal,
                listParams: currentJoinListParams(),
                isAmbiguous: (error) => Boolean(error && (error.confirmed || AstraApiClient.isAmbiguousMutation(error)))
            });
            applyJoinReviewReadback(result.readback);
            setNotice('success', `${nextStatus === 'approved' ? '批准' : '拒绝'}加入申请 #${authority.id} 已完成权威回读；Request ID ${result.requestId}`);
            return result;
        } catch (error) {
            if (error && error.joinReviewUnknown) {
                const lock = joinReviewLock(error);
                setWriteLock(lock);
                if (state.active && error.cause && AstraApiClient.isAmbiguousMutation(error.cause)) await reconcileJoinReviewWrite(lock);
                if (state.writeLock) setNotice('warning', '审批结果未决；申请、成员/拒绝边界、统计或精确审计未能共同证明结果，写锁保持且不会自动重发。');
            } else {
                setNotice('error', errorMessage(error));
            }
            throw error;
        } finally {
            setBusy(false);
            rerenderJoinRequestsPanel();
            refreshIcons();
        }
    }

    async function reviewJoinRequest(button) {
        if (state.busy || state.writeLock || !state.online || !state.joinReviewExecutor) return;
        const joinRequestId = Number(button.dataset.joinRequestId);
        const nextStatus = button.dataset.adminJoinReview;
        const authority = adminItems(state.panelData['join-requests'])
            .find((item) => Number(item.id) === joinRequestId && item.status === 'pending');
        if (!authority || !['approved', 'rejected'].includes(nextStatus)) return;
        try {
            const result = await state.joinReviewExecutor.submit(authority, nextStatus);
            if (result.kind === 'confirmation') {
                setNotice('warning', `再次点击同一按钮以确认${nextStatus === 'approved' ? '批准' : '拒绝'}加入请求 #${joinRequestId}；未发送任何写入。`);
            }
        } catch (error) {}
    }

    function rerenderJoinRequestsPanel() {
        const data = state.panelData['join-requests'];
        const config = PANEL_CONFIGS.find((item) => item.id === 'join-requests');
        const body = state.root && state.root.querySelector('[data-admin-panel-body="join-requests"]');
        if (data && config && body) body.innerHTML = renderPanelData(config, data);
    }

    function rerenderPanel(panelId) {
        const data = state.panelData[panelId];
        const config = PANEL_CONFIGS.find((item) => item.id === panelId);
        const body = state.root && state.root.querySelector(`[data-admin-panel-body="${panelId}"]`);
        if (data && config && body) body.innerHTML = renderPanelData(config, data);
    }

    function setNotice(type, message) {
        const notice = state.root && state.root.querySelector('[data-admin-notice]');
        if (!notice) return;
        const text = String(message || '').trim();
        notice.hidden = !text;
        notice.className = `admin-notice${type ? ` admin-notice--${type}` : ''}`;
        notice.textContent = text;
    }

    async function fetchJson(path, params, signal) {
        return AstraApiClient.request(path, {
            baseUrl: state.apiBase,
            params,
            signal: signal || (state.lifecycleController && state.lifecycleController.signal)
        });
    }

    function captureLifecycleOwner() {
        if (!state.active || !state.lifecycleController || state.lifecycleController.signal.aborted) return null;
        return {
            generation: state.requestGeneration,
            controller: state.lifecycleController
        };
    }

    function isLifecycleOwner(owner) {
        return Boolean(
            owner
            && state.active
            && owner.generation === state.requestGeneration
            && owner.controller === state.lifecycleController
            && !owner.controller.signal.aborted
        );
    }

    function beginRequestGeneration() {
        if (state.lifecycleController && !state.lifecycleController.signal.aborted) {
            state.lifecycleController.abort();
        }
        state.lifecycleController = new AbortController();
        state.requestGeneration += 1;
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

    function resolveApiBase() {
        let fromUrl = '';
        try {
            fromUrl = new URLSearchParams(window.location.search).get('apiBase') || '';
        } catch (error) {}
        if (fromUrl) {
            const normalized = normalizeApiBase(fromUrl);
            localStorage.setItem(API_BASE_STORAGE_KEY, normalized);
            return normalized;
        }
        const stored = localStorage.getItem(API_BASE_STORAGE_KEY) || '';
        if (stored) return normalizeApiBase(stored);
        const configBase = window.CONFIG && window.CONFIG.backend && window.CONFIG.backend.apiBaseUrl;
        return normalizeApiBase(configBase || '');
    }

    function normalizeApiBase(value) {
        return AstraApiClient.normalizeBaseUrl(value);
    }

    function renderLoading(text) {
        return `
            <div class="admin-loading">
                <i data-lucide="loader-circle"></i>
                <span>${escapeHtml(text)}</span>
            </div>
        `;
    }

    function renderError(error, title) {
        return `
            <div class="admin-error">
                <i data-lucide="triangle-alert"></i>
                <strong>${escapeHtml(title)}</strong>
                <span>${escapeHtml(errorMessage(error))}</span>
            </div>
        `;
    }

    function errorMessage(error) {
        return AstraApiClient.message(error);
    }

    function valueAt(item, key) {
        return String(key).split('.').reduce((value, part) => {
            if (value === null || value === undefined) return undefined;
            return value[part];
        }, item);
    }

    function formatValue(value, column) {
        if (value === null || value === undefined || value === '') return '--';
        if (column.type === 'date') return formatDate(value);
        if (typeof value === 'number') return formatNumber(value);
        if (typeof value === 'boolean') return value ? 'true' : 'false';
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
    }

    function formatNumber(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return String(value || 0);
        return number.toLocaleString('zh-CN');
    }

    function formatDate(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function statusClass(value) {
        const normalized = String(value || 'empty').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        if (['success', 'approved', 'active', 'trusted', 'ok', 'yes', 'true', 'queued'].includes(normalized)) return 'good';
        if (['pending', 'pending-review', 'watch', 'warning', 'triaged', 'in-progress', 'planned'].includes(normalized)) return 'warn';
        if (['failed', 'rejected', 'blocked', 'critical', 'cancelled', 'closed', 'no', 'false'].includes(normalized)) return 'bad';
        if (['readonly', 'archived'].includes(normalized)) return 'readonly';
        return 'neutral';
    }

    function getDashboard() {
        return state.root && state.root.querySelector('[data-admin-dashboard]');
    }

    function clearDashboardDom() {
        if (!state.root) return;
        const stats = state.root.querySelector('[data-admin-stats]');
        const databaseMap = state.root.querySelector('[data-admin-database-map]');
        if (stats) stats.innerHTML = '';
        if (databaseMap) databaseMap.innerHTML = '';
        state.root.querySelectorAll('[data-admin-panel-body]').forEach((body) => {
            body.innerHTML = renderLoading('等待权威刷新');
        });
        state.root.querySelectorAll('[data-admin-panel-meta]').forEach((meta) => {
            meta.textContent = '--';
        });
    }

    function setBusy(value) {
        state.busy = value;
        if (state.root) state.root.classList.toggle('is-busy', value);
        applyAdminWriteAvailability();
    }

    function setWriteLock(value) {
        state.writeLock = value || null;
        applyAdminWriteAvailability();
    }

    function applyAdminWriteAvailability() {
        if (!state.root) return;
        const courseBlocked = courseWriteBlocked();
        const writeDisabled = state.busy || Boolean(state.writeLock) || !state.online;
        state.root.querySelectorAll('[data-admin-write], [data-admin-user-update], [data-admin-join-review]').forEach((control) => {
            control.disabled = writeDisabled;
        });
        state.root.querySelectorAll('[data-admin-refresh-control]').forEach((control) => {
            control.disabled = state.busy || courseBlocked;
        });
        state.root.querySelectorAll('[data-admin-api-base]').forEach((control) => {
            control.disabled = state.busy || Boolean(state.writeLock) || courseBlocked;
        });
        state.root.querySelectorAll('[data-admin-organization-edit]').forEach((control) => {
            const lockTargetsControl = state.writeLock
                && state.writeLock.action === 'organization-governance'
                && state.writeLock.kind === control.dataset.organizationKind
                && Number(state.writeLock.resourceId) === Number(control.dataset.organizationId);
            control.disabled = state.busy || !state.online || (Boolean(state.writeLock) && !lockTargetsControl);
        });
        const form = state.root.querySelector('[data-admin-organization-form]');
        if (form) form.setAttribute('aria-busy', state.busy ? 'true' : 'false');
    }

    function refreshIcons() {
        if (typeof lucide !== 'undefined' && lucide && typeof lucide.createIcons === 'function') {
            try {
                lucide.createIcons({ attrs: { 'stroke-width': 1.8 }, root: state.root || document });
            } catch (error) {}
        }
    }

    function escapeHtml(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    function escapeAttr(value) {
        return escapeHtml(value);
    }
    window.initAdmin = initAdmin;
    window.destroyAdmin = destroyAdmin;
    window.initAdminGovernance = initAdmin;
    window.AdminGovernance = {
        version: ADMIN_ASSET_VERSION,
        refresh: refreshAll,
        contract: Object.freeze({
            buildOrganizationMutation,
            organizationMutationSignature,
            organizationMutationMatches,
            courseWriteBlocked,
            governanceShellMarkup,
            createConfirmedJoinReviewExecutor,
            executeJoinReviewTransaction,
            readJoinReviewAuthority,
            ensureOwnerModules,
            joinRequestMatches,
            joinReviewAuditMatches,
            organizationFields: (kind) => {
                const config = organizationConfig(kind);
                return config ? config.fields.map((field) => field.name) : [];
            }
        })
    };
})();
