/* 星序 Astra · 统一资源总览 v7.4.33
 * 契约：window.initPlanets / window.destroyPlanets 必须存在。
 */
(function attachPlanetsOverview(global) {
    'use strict';

    const PLANETS_ASSET_VERSION = '20260731v7969StudentUiP0';
    const ROLE_VIEW = Object.freeze({
        student: Object.freeze({
            label: '学生',
            code: 'STUDENT ORBIT',
            copy: '学习资源保持在同一张星图中；作业、提交与班级进度集中在“我的学习”。'
        }),
        'teacher-applicant': Object.freeze({
            label: '教师申请者',
            code: 'READ-ONLY PREVIEW',
            copy: '审核期间可预览三星系正式内容；班级、课程加入和学习进度写入均已暂停。'
        }),
        teacher: Object.freeze({
            label: '教师',
            code: 'TEACHER ORBIT',
            copy: '在总览中进入任一星系备课；课程、班级、作业与审批集中在“教学工作台”。'
        }),
        admin: Object.freeze({
            label: '管理员',
            code: 'ADMIN ORBIT',
            copy: '三个星系共用一个治理入口；组织、账号、内容、运行状态与审计统一进入“全局治理”。'
        })
    });
    const COURSE_CATALOGUE = Object.freeze({
        englab: Object.freeze({
            galaxyKey: 'englab',
            overviewHref: '#home',
            indexLabel: '工程基础',
            indexCopy: '实验与可视化学科目录',
            indexCode: 'ENG / 01',
            courses: Object.freeze([
                Object.freeze({ key: 'mathematics', label: '数学', page: 'mathematics', href: '#mathematics' }),
                Object.freeze({ key: 'physics', label: '物理', page: 'physics', href: '#physics' }),
                Object.freeze({ key: 'chemistry', label: '化学', page: 'chemistry', href: '#chemistry' }),
                Object.freeze({ key: 'algorithms', label: '算法', page: 'algorithms', href: '#algorithms' }),
                Object.freeze({ key: 'biology', label: '生物', page: 'biology', href: '#biology' })
            ])
        }),
        codespace: Object.freeze({
            galaxyKey: 'code-space',
            overviewHref: 'codevis/index.html#catalog',
            indexLabel: '代码空间',
            indexCopy: '多语言学习方向与交互挑战',
            indexCode: 'CODE / 02',
            courses: Object.freeze([
                Object.freeze({ key: 'program-start', label: '程序起步', href: 'codevis/index.html#catalog' }),
                Object.freeze({ key: 'control-flow', label: '控制流程', href: 'codevis/index.html#catalog' }),
                Object.freeze({ key: 'data-functions', label: '数据与函数', href: 'codevis/index.html#catalog' }),
                Object.freeze({ key: 'algorithm-thinking', label: '算法思维', href: 'codevis/index.html#catalog' }),
                Object.freeze({ key: 'debugging-testing', label: '调试与测试', href: 'codevis/index.html#catalog' }),
                Object.freeze({ key: 'challenge-submission', label: '挑战提交', href: 'codevis/index.html#catalog' })
            ])
        }),
        frontier: Object.freeze({
            galaxyKey: 'future-galaxy',
            overviewHref: '#frontier',
            indexLabel: '跨学科路线',
            indexCopy: '从星图进入六条未来学科方向',
            indexCode: 'FRONTIER / 03',
            courses: Object.freeze([
                Object.freeze({ key: 'earth-space', label: '地球与宇宙', page: 'cosmos', href: '#cosmos' }),
                Object.freeze({ key: 'engineering-systems', label: '工程应用', page: 'engineering', href: '#engineering' }),
                Object.freeze({ key: 'data-ai', label: '数据与 AI', page: 'datascience', href: '#datascience' }),
                Object.freeze({ key: 'information-technology', label: '信息技术', page: 'infotech', href: '#infotech' }),
                Object.freeze({ key: 'materials-science', label: '材料', page: 'materials', href: '#materials' }),
                Object.freeze({ key: 'humanities-futures', label: '人文', page: 'humanities', href: '#humanities' })
            ])
        })
    });
    const catalogueState = {
        phase: 'closed',
        role: '',
        records: [],
        classIds: new Set(),
        pages: new Set(),
        activities: new Map()
    };
    let catalogueRefreshGeneration = 0;
    let catalogueRefreshController = null;

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
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
    }

    function isPendingTeacherApplicant(user) {
        return Boolean(
            user
            && user.role === 'student'
            && user.teacher_application
            && user.teacher_application.status === 'pending'
        );
    }

    let rememberedStudentScope = Object.freeze({ user_id: 0, class_id: 0, course_id: 0 });

    global.AstraStudentScopeSelection = Object.freeze({
        read(user) {
            const userId = positiveId(user && (user.id || user.user_id));
            if (!userId || String(user && user.role || '') !== 'student' || rememberedStudentScope.user_id !== userId) {
                return Object.freeze({ class_id: 0, course_id: 0 });
            }
            return Object.freeze({
                class_id: rememberedStudentScope.class_id,
                course_id: rememberedStudentScope.course_id
            });
        },
        update(user, classId, courseId) {
            const userId = positiveId(user && (user.id || user.user_id));
            if (!userId || String(user && user.role || '') !== 'student') return false;
            rememberedStudentScope = Object.freeze({
                user_id: userId,
                class_id: positiveId(classId),
                course_id: positiveId(courseId)
            });
            try {
                global.dispatchEvent(new CustomEvent('astra:student-scope-selected', {
                    detail: {
                        class_id: rememberedStudentScope.class_id,
                        course_id: rememberedStudentScope.course_id
                    }
                }));
            } catch (error) {}
            return true;
        },
        clear(user) {
            const userId = positiveId(user && (user.id || user.user_id));
            if (userId && rememberedStudentScope.user_id !== userId) return false;
            rememberedStudentScope = Object.freeze({ user_id: 0, class_id: 0, course_id: 0 });
            return true;
        }
    });

    function courseIdentity(course) {
        const learningSpaceKey = String(course && (course.learning_space_key || course.galaxy_key) || '');
        const subjectKey = String(course && (course.subject_key || course.course_key) || '');
        return `${learningSpaceKey}:${subjectKey}`;
    }

    function catalogueEntryByIdentity(identity) {
        for (const [groupName, group] of Object.entries(COURSE_CATALOGUE)) {
            const entry = group.courses.find((item) => `${group.galaxyKey}:${item.key}` === identity);
            if (entry) return { groupName, group, entry };
        }
        return null;
    }

    function applyStudentCourseDom() {
        const isStudent = catalogueState.role === 'student';
        const ready = catalogueState.phase === 'ready';
        const hasPersonalAccess = ready;
        const routedPages = [
            'mathematics', 'physics', 'chemistry', 'algorithms', 'biology',
            'cosmos', 'engineering', 'datascience', 'infotech', 'materials', 'humanities'
        ];
        document.querySelectorAll('.nav-item[data-page]').forEach((link) => {
            const page = link.dataset.page;
            if (!routedPages.includes(page)) return;
            const allowed = !isStudent || (ready && catalogueState.pages.has(page));
            link.hidden = !allowed;
            link.toggleAttribute('inert', !allowed);
        });
        document.querySelectorAll('.satellite[data-target]').forEach((node) => {
            const page = node.dataset.target;
            const allowed = !isStudent || (ready && catalogueState.pages.has(page));
            node.hidden = !allowed;
            node.toggleAttribute('inert', !allowed);
        });
        document.querySelectorAll('a[href="#student"], a[href^="#student/"]').forEach((link) => {
            if (!isStudent) return;
            link.hidden = !hasPersonalAccess;
            link.toggleAttribute('inert', !hasPersonalAccess);
        });
        document.querySelectorAll('.module-card[data-module-target], .module-sidebar__item[data-module-target]').forEach((node) => {
            const page = node.closest('.page')?.id.replace(/^page-/, '')
                || node.closest('.module-sidebar')?.id.replace(/^sidebar-/, '');
            if (!page || !isStudent) {
                node.hidden = false;
                node.removeAttribute('inert');
                return;
            }
            const activityKeys = catalogueState.activities.get(page);
            const activityKey = `${page}.${node.dataset.moduleTarget || ''}`;
            const allowed = ready && activityKeys && activityKeys.has(activityKey);
            node.hidden = !allowed;
            node.toggleAttribute('inert', !allowed);
        });
    }

    function setCatalogueSnapshot(role, phase, records, classIds) {
        catalogueState.role = role || '';
        catalogueState.phase = phase;
        catalogueState.records = Array.isArray(records) ? records.slice() : [];
        catalogueState.classIds = new Set((classIds || []).map(positiveId).filter(Boolean));
        catalogueState.pages = new Set();
        catalogueState.activities = new Map();
        (records || []).forEach((record) => {
            if (record.entry.page) catalogueState.pages.add(record.entry.page);
            catalogueState.activities.set(record.entry.page || record.entry.key, new Set(record.activityKeys || []));
        });
        if ((records || []).some((record) => record.groupName === 'englab')) catalogueState.pages.add('home');
        if ((records || []).some((record) => record.groupName === 'frontier')) catalogueState.pages.add('frontier');
        applyStudentCourseDom();
        global.dispatchEvent(new CustomEvent('astra:student-catalogue-ready', {
            detail: { role: catalogueState.role, phase: catalogueState.phase }
        }));
    }

    function allCatalogueRecords() {
        return Object.entries(COURSE_CATALOGUE).flatMap(([groupName, group]) => (
            group.courses.map((entry) => ({ groupName, group, entry, activityKeys: [] }))
        ));
    }

    async function loadStudentCatalogue(signal) {
        const client = global.AstraApiClient;
        if (!client || typeof client.request !== 'function') return { records: [], classIds: [] };
        const classes = list(await client.request('/api/classes', {
            params: { mine: true },
            signal
        })).filter((item) => positiveId(item && item.id));
        const classIds = classes.map((item) => positiveId(item.id));
        if (!classes.length) {
            const courses = list(await client.request('/api/courses', { signal }));
            const courseResults = await Promise.allSettled(courses.map(async (course) => {
                const match = catalogueEntryByIdentity(courseIdentity(course));
                const courseId = positiveId(course && course.id);
                if (!match || !courseId) return null;
                const units = list(await client.request(`/api/courses/${courseId}/units`, { signal }));
                const activityKeys = units
                    .filter((unit) => unit && unit.effective_release_state === 'open')
                    .map((unit) => String(unit.activity_key || '').trim())
                    .filter(Boolean);
                return activityKeys.length ? { ...match, courseId, courseIds: [courseId], activityKeys, classIds: [] } : null;
            }));
            return {
                records: courseResults
                    .filter((result) => result.status === 'fulfilled' && result.value)
                    .map((result) => result.value),
                classIds
            };
        }

        const classCourseIds = new Set();
        const classResults = await Promise.allSettled(classes.map(async (classroom) => {
            const classId = positiveId(classroom.id);
            const courses = list(await client.request('/api/courses', {
                params: { class_id: classId },
                signal
            }));
            const courseResults = await Promise.allSettled(courses.map(async (course) => {
                const match = catalogueEntryByIdentity(courseIdentity(course));
                const courseId = positiveId(course && course.id);
                if (courseId) classCourseIds.add(courseId);
                if (!match || !courseId) return null;
                const units = list(await client.request(`/api/courses/${courseId}/units`, {
                    params: { class_id: classId },
                    signal
                }));
                const activityKeys = units
                    .filter((unit) => unit && unit.effective_release_state === 'open')
                    .map((unit) => String(unit.activity_key || '').trim())
                    .filter(Boolean);
                return activityKeys.length ? { ...match, courseId, courseIds: [courseId], activityKeys, classIds: [classId] } : null;
            }));
            return courseResults
                .filter((result) => result.status === 'fulfilled' && result.value)
                .map((result) => result.value);
        }));

        const merged = new Map();
        const mergeRecord = (record) => {
            const identity = `${record.group.galaxyKey}:${record.entry.key}`;
            const current = merged.get(identity);
            if (!current) {
                merged.set(identity, {
                    ...record,
                    courseIds: Array.from(new Set(record.courseIds || [record.courseId].filter(Boolean))),
                    activityKeys: Array.from(new Set(record.activityKeys)),
                    classIds: Array.from(new Set(record.classIds || []))
                });
                return;
            }
            current.courseIds = Array.from(new Set((current.courseIds || []).concat(record.courseIds || [record.courseId].filter(Boolean))));
            current.activityKeys = Array.from(new Set(current.activityKeys.concat(record.activityKeys)));
            current.classIds = Array.from(new Set((current.classIds || []).concat(record.classIds || [])));
        };
        classResults.forEach((classResult) => {
            if (classResult.status !== 'fulfilled') return;
            classResult.value.forEach(mergeRecord);
        });

        const visibleCourses = list(await client.request('/api/courses', { signal }));
        const directResults = await Promise.allSettled(visibleCourses
            .filter((course) => !classCourseIds.has(positiveId(course && course.id)))
            .map(async (course) => {
                const match = catalogueEntryByIdentity(courseIdentity(course));
                const courseId = positiveId(course && course.id);
                if (!match || !courseId) return null;
                const units = list(await client.request(`/api/courses/${courseId}/units`, { signal }));
                const activityKeys = units
                    .filter((unit) => unit && unit.effective_release_state === 'open')
                    .map((unit) => String(unit.activity_key || '').trim())
                    .filter(Boolean);
                return activityKeys.length ? { ...match, courseId, courseIds: [courseId], activityKeys, classIds: [] } : null;
            }));
        directResults.forEach((result) => {
            if (result.status === 'fulfilled' && result.value) mergeRecord(result.value);
        });
        return { records: Array.from(merged.values()), classIds };
    }

    async function refreshCatalogue(user) {
        if (catalogueRefreshController) catalogueRefreshController.abort();
        const controller = new AbortController();
        catalogueRefreshController = controller;
        const generation = ++catalogueRefreshGeneration;
        const session = global.AstraApplicationSession;
        const currentUser = user || (session && typeof session.getUser === 'function' ? session.getUser() : null);

        if (!currentUser) {
            setCatalogueSnapshot('', 'closed', [], []);
            return catalogueState.records.slice();
        }
        if (isPendingTeacherApplicant(currentUser)) {
            const records = allCatalogueRecords();
            setCatalogueSnapshot('teacher-applicant', 'ready', records, []);
            return records;
        }
        if (currentUser.role !== 'student') {
            const records = allCatalogueRecords();
            setCatalogueSnapshot(currentUser.role, 'ready', records, []);
            return records;
        }

        setCatalogueSnapshot('student', 'loading', [], []);
        try {
            const result = await loadStudentCatalogue(controller.signal);
            if (controller.signal.aborted || generation !== catalogueRefreshGeneration) return [];
            setCatalogueSnapshot('student', 'ready', result.records, result.classIds);
            return result.records;
        } catch (error) {
            if (controller.signal.aborted || generation !== catalogueRefreshGeneration) return [];
            setCatalogueSnapshot('student', 'ready', [], []);
            return [];
        }
    }

    global.AstraStudentCourseCatalogue = Object.freeze({
        refresh: refreshCatalogue,
        allowsPage(page) {
            if (catalogueState.role !== 'student') return true;
            if (catalogueState.phase !== 'ready') return false;
            return catalogueState.pages.has(String(page || ''));
        },
        allowsPersonalPage() {
            if (catalogueState.role !== 'student') return true;
            return catalogueState.phase === 'ready';
        },
        guardRoute(route, coursePages, frontierPages) {
            if (catalogueState.role !== 'student') return route;
            const page = String(route && route.page || '');
            const personalBlocked = page === 'student' && catalogueState.phase !== 'ready';
            const courseManaged = page === 'home'
                || (coursePages || []).includes(page)
                || (frontierPages || []).includes(page);
            const courseBlocked = courseManaged && !(catalogueState.phase === 'ready' && catalogueState.pages.has(page));
            if (!personalBlocked && !courseBlocked) return route;
            if (global.location.hash.slice(1) !== 'planets') global.history.replaceState(null, '', '#planets');
            return { page: 'planets', moduleId: null, anchorId: null };
        },
        allowsActivity(page, moduleId) {
            if (catalogueState.role !== 'student') return true;
            if (catalogueState.phase !== 'ready') return false;
            const activities = catalogueState.activities.get(String(page || ''));
            return Boolean(activities && activities.has(`${page}.${moduleId}`));
        },
        snapshot() {
            return Object.freeze({
                phase: catalogueState.phase,
                role: catalogueState.role,
                class_ids: Object.freeze(Array.from(catalogueState.classIds)),
                pages: Object.freeze(Array.from(catalogueState.pages)),
                records: Object.freeze(catalogueState.records.map((record) => Object.freeze({
                    learning_space_key: record.group.galaxyKey,
                    subject_key: record.entry.key,
                    galaxy_key: record.group.galaxyKey,
                    course_key: record.entry.key,
                    course_id: positiveId(record.courseId),
                    course_ids: Object.freeze((record.courseIds || [record.courseId]).map(positiveId).filter(Boolean)),
                    page: record.entry.page || '',
                    activity_keys: Object.freeze((record.activityKeys || []).slice()),
                    class_ids: Object.freeze((record.classIds || []).slice())
                })))
            });
        }
    });

    const view = {
        root: null,
        active: false,
        details: [],
        sessionHandler: null,
        membershipHandler: null,
        actionHandler: null,
        roleHomeGeneration: 0,
        catalogueGeneration: 0,

        init() {
            if (this.active) this.destroy();
            this.root = document.getElementById('page-planets');
            if (!this.root) return;
            this.active = true;
            this.details = Array.from(this.root.querySelectorAll('details[data-galaxy]'));
            this.details.forEach((detail) => {
                const handler = () => this.syncDisclosure(detail);
                detail.__astraDisclosureHandler = handler;
                detail.addEventListener('toggle', handler);
                this.syncDisclosure(detail);
            });
            this.sessionHandler = () => this.syncSession();
            global.addEventListener('astra:session-ready', this.sessionHandler);
            this.membershipHandler = () => this.syncSession();
            global.addEventListener('astra:class-membership-changed', this.membershipHandler);
            this.actionHandler = (event) => this.handleAction(event);
            this.root.addEventListener('click', this.actionHandler);
            this.syncSession();
            this.refreshIcons();
        },

        destroy() {
            this.details.forEach((detail) => {
                if (detail.__astraDisclosureHandler) {
                    detail.removeEventListener('toggle', detail.__astraDisclosureHandler);
                    delete detail.__astraDisclosureHandler;
                }
            });
            if (this.sessionHandler) global.removeEventListener('astra:session-ready', this.sessionHandler);
            if (this.membershipHandler) global.removeEventListener('astra:class-membership-changed', this.membershipHandler);
            if (this.root && this.actionHandler) this.root.removeEventListener('click', this.actionHandler);
            this.details = [];
            this.sessionHandler = null;
            this.membershipHandler = null;
            this.actionHandler = null;
            this.root = null;
            this.active = false;
            this.roleHomeGeneration += 1;
            if (global.AstraRoleHomeClient && typeof global.AstraRoleHomeClient.destroy === 'function') {
                global.AstraRoleHomeClient.destroy();
            }
        },

        syncDisclosure(detail) {
            const toggle = detail && detail.querySelector('.planets-galaxy-row__toggle');
            if (toggle) toggle.textContent = detail.open ? '收起资源' : '展开资源';
        },

        async handleAction(event) {
            const direct = event.target instanceof Element
                ? event.target.closest('[data-planets-galaxy-direct]')
                : null;
            if (direct) {
                event.stopPropagation();
                return;
            }
            const actionNode = event.target instanceof Element
                ? event.target.closest('[data-planets-session-action]')
                : null;
            if (!actionNode || !this.root || !this.root.contains(actionNode)) return;
            if (actionNode.dataset.planetsSessionAction !== 'logout') return;
            const session = global.AstraApplicationSession;
            if (!session || typeof session.logout !== 'function' || actionNode.disabled) return;
            actionNode.disabled = true;
            actionNode.setAttribute('aria-busy', 'true');
            try {
                await session.logout();
            } finally {
                actionNode.disabled = false;
                actionNode.removeAttribute('aria-busy');
            }
        },

        syncSession() {
            if (!this.root) return;
            const session = global.AstraApplicationSession;
            const user = session && typeof session.getUser === 'function' ? session.getUser() : null;
            const role = isPendingTeacherApplicant(user)
                ? 'teacher-applicant'
                : user && ROLE_VIEW[user.role] ? user.role : 'student';
            const roleView = ROLE_VIEW[role];
            this.root.dataset.sessionRole = role;

            const name = this.root.querySelector('[data-planets-identity-name]');
            const roleLabel = this.root.querySelector('[data-planets-identity-role]');
            const routeCode = this.root.querySelector('[data-planets-route-code]');
            const routeCopy = this.root.querySelector('[data-planets-route-copy]');
            if (name) name.textContent = user ? (user.display_name || user.username || '已验证用户') : '已验证用户';
            if (roleLabel) roleLabel.textContent = roleView.label + '视图';
            if (routeCode) routeCode.textContent = roleView.code;
            if (routeCopy) routeCopy.textContent = roleView.copy;

            if (session && typeof session.applyRoleUI === 'function') session.applyRoleUI();
            this.syncCatalogue(user);
            this.syncRoleHome(user);
        },

        renderCatalogue(records, role, phase = 'ready') {
            if (!this.root) return;
            const byGroup = new Map(Object.keys(COURSE_CATALOGUE).map((name) => [name, []]));
            (records || []).forEach((record) => byGroup.get(record.groupName)?.push(record));
            Object.entries(COURSE_CATALOGUE).forEach(([groupName, group]) => {
                const detail = this.root.querySelector(`[data-galaxy="${groupName}"]`);
                const listNode = this.root.querySelector(`[data-planets-course-list="${groupName}"]`);
                const direct = this.root.querySelector(`[data-planets-galaxy-direct="${groupName}"]`);
                const visible = byGroup.get(groupName) || [];
                if (detail) detail.hidden = visible.length === 0;
                if (listNode) {
                    listNode.replaceChildren();
                    visible.forEach((record, index) => {
                        const link = document.createElement('a');
                        link.href = record.entry.href;
                        link.dataset.courseKey = record.entry.key;
                        link.innerHTML = `<span>${String(index + 1).padStart(2, '0')}</span>${escapeHtml(record.entry.label)}`;
                        listNode.appendChild(link);
                    });
                }
                if (direct) {
                    const first = visible[0];
                    direct.href = first ? first.entry.href : group.overviewHref;
                    direct.hidden = !first;
                    direct.toggleAttribute('inert', !first);
                    direct.setAttribute('aria-label', first
                        ? `进入${first.entry.label}`
                        : `当前身份没有可用的${group.indexLabel}内容`);
                }
            });
            const index = this.root.querySelector('[data-planets-resource-index]');
            const indexList = this.root.querySelector('[data-planets-resource-index-list]');
            if (indexList) {
                indexList.replaceChildren();
                Object.entries(COURSE_CATALOGUE).forEach(([groupName, group]) => {
                    const first = (byGroup.get(groupName) || [])[0];
                    if (!first) return;
                    const link = document.createElement('a');
                    link.href = first.entry.href;
                    link.innerHTML = `<span>${escapeHtml(group.indexLabel)}</span><strong>${escapeHtml(group.indexCopy)}</strong><i>${escapeHtml(group.indexCode)}</i>`;
                    indexList.appendChild(link);
                });
            }
            if (index) index.hidden = !(indexList && indexList.childElementCount);
            this.details.filter((detail) => !detail.hidden).forEach((detail) => this.syncDisclosure(detail));
            this.refreshIcons();
        },

        async syncCatalogue(user) {
            const generation = ++this.catalogueGeneration;
            await refreshCatalogue(user);
            if (!this.active || generation !== this.catalogueGeneration) return;
            this.renderCatalogue(catalogueState.records, catalogueState.role, catalogueState.phase);
        },

        async syncRoleHome(user) {
            if (!user || !this.root || !global.AstraLearningEvidenceLoader) return;
            const generation = ++this.roleHomeGeneration;
            if (isPendingTeacherApplicant(user)) {
                if (global.AstraRoleHomeClient && typeof global.AstraRoleHomeClient.destroy === 'function') {
                    global.AstraRoleHomeClient.destroy();
                }
                return;
            }
            try {
                await global.AstraLearningEvidenceLoader.ensure({ roleHome: true });
                if (!this.active || generation !== this.roleHomeGeneration || !this.root) return;
                const owner = global.AstraRoleHomeClient;
                const mounted = this.root.querySelector('[data-astra-role-home]');
                if (mounted && owner && typeof owner.setUser === 'function') owner.setUser(user);
                else if (owner && typeof owner.mount === 'function') owner.mount(this.root, user);
            } catch (error) {
                if (generation === this.roleHomeGeneration) {
                    console.warn('[PlanetsView] role home unavailable', error && (error.code || error.message));
                }
            }
        },

        refreshIcons() {
            if (!global.lucide || typeof global.lucide.createIcons !== 'function') return;
            try {
                global.lucide.createIcons({ attrs: { 'stroke-width': 1.7 }, root: this.root || document });
            } catch (error) {}
        }
    };

    global.PlanetsView = view;
    global.initPlanets = function initPlanets() { view.init(); };
    global.destroyPlanets = function destroyPlanets() { view.destroy(); };
    global.AstraPlanetsContract = Object.freeze({
        version: PLANETS_ASSET_VERSION,
        galaxies: Object.freeze(['englab', 'codespace', 'frontier']),
        roleViews: Object.freeze(Object.keys(ROLE_VIEW))
    });
})(window);
