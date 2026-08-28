(function attachRoleWorkbenchBridge(global) {
    'use strict';

    if (global.AstraRoleWorkbenchBridge) return;

    const VERSION = '20260828v863CourseHealthMatrixP0';
    const OWNER_PATH = `./role-workbench-overview.js?v=${VERSION}`;
    const HOST_SELECTORS = Object.freeze({
        student: '[data-student-role-overview]',
        teacher: '[data-teacher-role-overview]',
        admin: '[data-admin-role-overview]'
    });
    const records = new WeakMap();

    function normalize(input) {
        const config = input || {};
        const role = String(config.role || '');
        const root = config.root;
        if (!HOST_SELECTORS[role] || !root || typeof root.querySelector !== 'function') {
            throw new TypeError('角色工作台桥接参数无效');
        }
        return Object.assign({}, config, { role, root });
    }

    function roleRecords(root, create) {
        let roleMap = records.get(root);
        if (!roleMap && create) {
            roleMap = new Map();
            records.set(root, roleMap);
        }
        return roleMap || null;
    }

    function recordFor(input, create) {
        const config = normalize(input);
        const roleMap = roleRecords(config.root, create);
        if (!roleMap) return null;
        let record = roleMap.get(config.role) || null;
        if (!record && create) {
            record = {
                config,
                owner: null,
                loading: null,
                generation: 0,
                destroyed: false
            };
            roleMap.set(config.role, record);
        }
        if (record) {
            record.config = config;
            record.destroyed = false;
        }
        return record;
    }

    function isActive(record) {
        if (!record || record.destroyed) return false;
        const predicate = record.config && record.config.isActive;
        try {
            return typeof predicate !== 'function' || predicate() === true;
        } catch (error) {
            return false;
        }
    }

    async function ensureOwner(record) {
        if (record.owner) return record.owner;
        if (record.loading) return record.loading;
        const generation = ++record.generation;
        record.loading = import(OWNER_PATH)
            .then(() => {
                if (!isActive(record) || generation !== record.generation) return null;
                const host = record.config.root.querySelector(HOST_SELECTORS[record.config.role]);
                const factory = global.AstraRoleWorkbenchOverview;
                if (!host || !factory || typeof factory.create !== 'function') {
                    throw new Error('角色工作台概览 owner 未完成注册');
                }
                record.owner = factory.create(host, {
                    role: record.config.role,
                    request: (path, options) => request(record, path, options),
                    onAction: (action) => routeAction(record, action),
                    refreshIcons: () => refreshIcons(record)
                });
                return record.owner;
            })
            .finally(() => {
                if (generation === record.generation) record.loading = null;
            });
        return record.loading;
    }

    function request(record, path, options) {
        if (!global.AstraApiClient || typeof global.AstraApiClient.request !== 'function') {
            throw new Error('角色工作台 API 客户端不可用');
        }
        const getBaseUrl = record.config.getBaseUrl;
        return global.AstraApiClient.request(path, {
            baseUrl: typeof getBaseUrl === 'function' ? getBaseUrl() : '',
            params: options && options.params,
            signal: options && options.signal
        });
    }

    async function refresh(input) {
        const record = recordFor(input, true);
        if (!isActive(record)) return false;
        try {
            const owner = await ensureOwner(record);
            if (!owner || !isActive(record)) return false;
            return owner.refresh();
        } catch (error) {
            if (isActive(record)) console.warn('[RoleWorkbenchBridge] overview resource unavailable');
            return false;
        }
    }

    function reset(input) {
        const record = recordFor(input, false);
        if (!record) return false;
        record.generation += 1;
        record.loading = null;
        if (record.owner) record.owner.reset();
        return true;
    }

    function destroy(input) {
        const config = normalize(input);
        const roleMap = roleRecords(config.root, false);
        const record = roleMap && roleMap.get(config.role);
        if (!record) return false;
        record.destroyed = true;
        record.generation += 1;
        record.loading = null;
        if (record.owner) record.owner.destroy();
        record.owner = null;
        roleMap.delete(config.role);
        if (!roleMap.size) records.delete(config.root);
        return true;
    }

    function routeAction(record, action) {
        if (!isActive(record) || !action || typeof action !== 'object') return false;
        if (record.config.role === 'student') return routeStudent(record, action);
        if (record.config.role === 'teacher') return routeTeacher(record, action);
        return routeAdmin(record, action);
    }

    function routeStudent(record, action) {
        const kind = String(action.kind || '');
        if (kind === 'join_course') {
            focusLater(record, '#student-course-enrollment-host', '[data-course-code-input]');
            return true;
        }
        if (kind === 'continue_assignment' || kind === 'open_feedback') {
            afterStudentCourse(record, action.course_id, () => {
                const assignmentSelector = `[data-student-assignment-id="${positiveNumber(action.assignment_id)}"]`;
                retry(record, () => record.config.root.querySelector(assignmentSelector), (control) => {
                    control.click();
                    focusLater(
                        record,
                        kind === 'open_feedback' ? '[data-student-panel="submission"]' : '[data-student-panel="assignments"]',
                        kind === 'open_feedback' ? 'textarea, button, a' : assignmentSelector
                    );
                }, () => focusLater(record, '[data-student-panel="assignments"]', 'button, a'));
            });
            return true;
        }
        if (kind === 'open_course' || kind === 'continue_learning') {
            afterStudentCourse(record, action.course_id, () => focusLater(
                record,
                kind === 'continue_learning' ? '[data-student-focus-stage]' : '[data-student-panel="course"]',
                'a, button'
            ));
            return true;
        }
        return false;
    }

    function afterStudentCourse(record, courseId, callback) {
        retry(record, () => record.config.root.querySelector('[data-student-scope="courseId"]'), (select) => {
            const changed = selectValue(select, courseId);
            global.setTimeout(callback, changed ? 140 : 0);
        }, callback);
    }

    function routeTeacher(record, action) {
        const kind = String(action.kind || '');
        if (kind === 'create_course') {
            openTeacherStructure(record, () => focusLater(record, '[data-teacher-course-authoring]', '[data-course-authoring-action="open"]', true));
            return true;
        }
        if (kind === 'review_course_join_request' || kind === 'open_course_members') {
            openTeacherStructure(record, () => focusTeacherCourseOwner(
                record,
                '[data-teacher-course-membership]',
                '[data-course-membership-course]',
                action.course_id,
                action.request_id ? `[data-request-id="${positiveNumber(action.request_id)}"]` : 'select, button'
            ));
            return true;
        }
        if (kind === 'continue_course_draft' || kind === 'open_teaching_course' || kind === 'open_course_content') {
            openTeacherStructure(record, () => focusTeacherCourseOwner(
                record,
                '[data-teacher-course-content]',
                '[data-course-content-course]',
                action.course_id,
                'select, button, textarea',
                kind === 'open_teaching_course' ? () => focusTeacherLegacyCourse(record, action.course_id) : null
            ));
            return true;
        }
        if (kind === 'grade_submission' || kind === 'open_grading') {
            if (
                kind === 'grade_submission'
                && global.AstraTeacherWorkbenchScope
                && typeof global.AstraTeacherWorkbenchScope.openGrading === 'function'
                && positiveNumber(action.class_id)
            ) {
                void global.AstraTeacherWorkbenchScope.openGrading(action);
                return true;
            }
            clickLater(record, '[data-teacher-view="grading"]');
            selectLater(record, '[data-teacher-scope="courseId"]', action.course_id, () => {
                if (action.assignment_id) selectLater(record, '[data-teacher-scope="assignmentId"]', action.assignment_id);
                focusLater(record, '[data-teacher-panels]', 'button, select, textarea');
            });
            return true;
        }
        return false;
    }

    function openTeacherStructure(record, callback) {
        clickLater(record, '[data-teacher-view="overview"]');
        retry(record, () => record.config.root.querySelector('[data-teacher-secondary="structure"]'), (details) => {
            details.open = true;
            callback();
        });
    }

    function focusTeacherCourseOwner(record, ownerSelector, selectSelector, courseId, focusSelector, fallback) {
        retry(record, () => record.config.root.querySelector(ownerSelector), (owner) => {
            const select = owner.querySelector(selectSelector);
            if (positiveNumber(courseId) && (!select || !hasOption(select, courseId))) {
                if (typeof fallback === 'function') fallback();
                else scrollAndFocus(owner, focusSelector);
                return;
            }
            if (select) selectValue(select, courseId);
            scrollAndFocus(owner, focusSelector);
        });
    }

    function focusTeacherLegacyCourse(record, courseId) {
        clickLater(record, '[data-teacher-view="overview"]');
        selectLater(record, '[data-teacher-scope="courseId"]', courseId, () => focusLater(record, '[data-teacher-panels]', 'button, select, textarea'));
    }

    function routeAdmin(record, action) {
        const kind = String(action.kind || '');
        if (kind === 'review_teacher_application' || kind === 'open_identity_governance') {
            if (global.AdminSecondaryGovernance && typeof global.AdminSecondaryGovernance.open === 'function') {
                global.AdminSecondaryGovernance.open('identity');
            } else {
                clickLater(record, '[data-admin-secondary-open="identity"]');
            }
            if (kind === 'review_teacher_application') {
                focusLater(record, `[data-admin-teacher-application="${positiveNumber(action.request_id)}"]`, 'button, input');
            }
            return true;
        }
        const courseHealthActions = new Set([
            'open_course_content', 'open_course_grading', 'open_course_learning', 'open_course_governance'
        ]);
        if (kind === 'review_course_information' || courseHealthActions.has(kind)) {
            clickLater(record, '[data-admin-section-button="courses"]');
            if (kind === 'review_course_information') {
                focusLater(record, `[data-admin-course-review-select="${positiveNumber(action.revision_id)}"]`, null, true);
            } else {
                clickLater(record, '[data-admin-course-view="status"]');
                if (positiveNumber(action.course_id)) {
                    focusLater(record, `[data-admin-course-select="${positiveNumber(action.course_id)}"]`, null, true);
                }
            }
            return true;
        }
        if (kind === 'review_organization_alert' || kind === 'open_organization_governance') {
            clickLater(record, '[data-admin-section-button="organizations"]');
            return true;
        }
        if (kind === 'open_catalog_governance') {
            clickLater(record, '[data-admin-section-button="identity"]');
            return true;
        }
        if (kind === 'open_governance') {
            clickLater(record, '[data-admin-section-button="overview"]');
            return true;
        }
        return false;
    }

    function selectLater(record, selector, value, callback) {
        if (!positiveNumber(value)) {
            if (typeof callback === 'function') callback();
            return;
        }
        retry(record, () => record.config.root.querySelector(selector), (select) => {
            const changed = selectValue(select, value);
            if (typeof callback === 'function') global.setTimeout(callback, changed ? 140 : 0);
        });
    }

    function selectValue(select, value) {
        const normalized = String(positiveNumber(value) || '');
        if (!normalized || !hasOption(select, normalized)) return false;
        if (String(select.value) === normalized) return false;
        select.value = normalized;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    function hasOption(select, value) {
        const normalized = String(positiveNumber(value) || '');
        return Boolean(normalized && select && select.options && Array.from(select.options).some((option) => String(option.value) === normalized));
    }

    function clickLater(record, selector) {
        retry(record, () => record.config.root.querySelector(selector), (target) => {
            if (typeof target.click === 'function') target.click();
        });
    }

    function focusLater(record, selector, focusSelector, activate) {
        retry(record, () => record.config.root.querySelector(selector), (target) => {
            const control = focusSelector ? target.querySelector(focusSelector) : target;
            if (activate && control && typeof control.click === 'function') control.click();
            scrollAndFocus(target, focusSelector);
        });
    }

    function retry(record, find, use, exhausted, attempt) {
        const currentAttempt = Number(attempt || 0);
        const schedule = typeof global.requestAnimationFrame === 'function'
            ? global.requestAnimationFrame.bind(global)
            : (callback) => global.setTimeout(callback, 0);
        schedule(() => {
            if (!isActive(record)) return;
            const target = find();
            if (target) {
                use(target);
                return;
            }
            if (currentAttempt < 30) {
                global.setTimeout(() => retry(record, find, use, exhausted, currentAttempt + 1), 100);
            } else if (typeof exhausted === 'function') {
                exhausted();
            }
        });
    }

    function scrollAndFocus(target, focusSelector) {
        if (!target) return;
        if (typeof target.scrollIntoView === 'function') {
            target.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
        }
        const control = focusSelector ? target.querySelector(focusSelector) : target;
        if (control && typeof control.focus === 'function') control.focus({ preventScroll: true });
    }

    function reducedMotion() {
        return typeof global.matchMedia === 'function' && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function refreshIcons(record) {
        const refresh = record.config && record.config.refreshIcons;
        if (typeof refresh === 'function') refresh();
        else if (global.lucide && typeof global.lucide.createIcons === 'function') {
            try { global.lucide.createIcons(); } catch (error) {}
        }
    }

    function positiveNumber(value) {
        const number = Number(value);
        return Number.isInteger(number) && number > 0 ? number : 0;
    }

    global.AstraRoleWorkbenchBridge = Object.freeze({
        refresh,
        reset,
        destroy,
        contract: Object.freeze({ VERSION, HOST_SELECTORS, routeAction, positiveNumber })
    });
})(window);
