(function (global) {
    'use strict';

    if (global.AstraEngineeringLabPublicationContext) return;

    const state = {
        user: null,
        classes: [],
        selectedClassId: 0,
        generation: 0,
        controller: null,
        navigationGeneration: 0,
        navigationController: null
    };

    function api() {
        if (!global.AstraApiClient) throw new Error('AstraApiClient unavailable');
        return global.AstraApiClient;
    }

    function list(payload) {
        if (Array.isArray(payload)) return payload;
        return payload && Array.isArray(payload.items) ? payload.items : [];
    }

    function id(value) {
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
    }

    function begin() {
        if (state.controller) state.controller.abort();
        state.controller = new AbortController();
        state.generation += 1;
        return { generation: state.generation, controller: state.controller, signal: state.controller.signal };
    }

    function current(scope) {
        return scope && scope.generation === state.generation && scope.controller === state.controller && !scope.signal.aborted;
    }

    async function prepare(user, options = {}) {
        const session = global.AstraApplicationSession;
        const sessionUser = session && typeof session.getUser === 'function' ? session.getUser() : null;
        state.user = user || sessionUser || null;
        if (!state.user || state.user.role !== 'student') {
            return Object.freeze({ available: false, error_code: 'student_role_required', classes: [] });
        }
        const scope = begin();
        const externalSignal = options && options.signal;
        const abortScope = () => scope.controller.abort();
        if (externalSignal && typeof externalSignal.addEventListener === 'function') {
            if (externalSignal.aborted) abortScope();
            else externalSignal.addEventListener('abort', abortScope, { once: true });
        }
        try {
            const classes = list(await api().request('/api/classes', {
                params: { mine: true },
                signal: scope.signal
            }));
            if (!current(scope)) return Object.freeze({ available: false, error_code: 'cancelled', classes: [] });
            state.classes = classes;
            if (!classes.some(item => id(item.id) === state.selectedClassId)) state.selectedClassId = 0;
            if (classes.length === 1) state.selectedClassId = id(classes[0].id);
            return Object.freeze({
                available: Boolean(state.selectedClassId),
                error_code: state.selectedClassId ? '' : classes.length ? 'class_selection_required' : 'class_scope_missing',
                classes: classes.slice(),
                class_id: state.selectedClassId || null
            });
        } catch (error) {
            if (scope.signal.aborted || (api().isCancelled && api().isCancelled(error))) {
                return Object.freeze({ available: false, error_code: 'cancelled', classes: [] });
            }
            throw error;
        } finally {
            if (externalSignal && typeof externalSignal.removeEventListener === 'function') {
                externalSignal.removeEventListener('abort', abortScope);
            }
        }
    }

    function cancelNavigation() {
        if (state.navigationController) state.navigationController.abort();
        state.navigationController = null;
        state.navigationGeneration += 1;
    }

    function beginNavigation(externalSignal) {
        cancelNavigation();
        const controller = new AbortController();
        state.navigationController = controller;
        const abortNavigation = () => controller.abort();
        if (externalSignal && typeof externalSignal.addEventListener === 'function') {
            if (externalSignal.aborted) abortNavigation();
            else externalSignal.addEventListener('abort', abortNavigation, { once: true });
        }
        return {
            generation: state.navigationGeneration,
            controller,
            signal: controller.signal,
            detach: () => {
                if (externalSignal && typeof externalSignal.removeEventListener === 'function') {
                    externalSignal.removeEventListener('abort', abortNavigation);
                }
            }
        };
    }

    function currentNavigation(scope) {
        return Boolean(
            scope
            && scope.generation === state.navigationGeneration
            && scope.controller === state.navigationController
            && !scope.signal.aborted
        );
    }

    function navigationError(code) {
        const error = new Error(code);
        error.code = code;
        return error;
    }

    function invalidatePublicationScope() {
        cancelNavigation();
        if (state.controller) state.controller.abort();
        state.controller = null;
        state.generation += 1;
        state.selectedClassId = 0;
    }

    function selectPreparedClass(classId, classes) {
        const selected = classes.find(item => id(item.id) === id(classId));
        if (!selected) return false;
        state.classes = classes.slice();
        state.selectedClassId = id(selected.id);
        return true;
    }

    function selectClass(classId) {
        const classes = state.classes.slice();
        invalidatePublicationScope();
        return selectPreparedClass(classId, classes);
    }

    async function switchClass(user, classId, options = {}) {
        const classKey = id(classId);
        invalidatePublicationScope();
        const session = global.AstraApplicationSession;
        const sessionUser = session && typeof session.getUser === 'function' ? session.getUser() : null;
        state.user = user || sessionUser || null;
        if (!classKey) {
            return Object.freeze({
                available: false,
                error_code: 'class_selection_required',
                classes: state.classes.slice(),
                class_id: null
            });
        }
        try {
            const prepared = await prepare(state.user, options);
            if (prepared.error_code === 'cancelled' || prepared.error_code === 'student_role_required') return prepared;
            state.selectedClassId = 0;
            if (!selectPreparedClass(classKey, prepared.classes || [])) {
                return Object.freeze({
                    available: false,
                    error_code: 'class_scope_missing',
                    classes: prepared.classes || [],
                    class_id: null
                });
            }
            return Object.freeze({
                available: true,
                error_code: '',
                classes: state.classes.slice(),
                class_id: state.selectedClassId
            });
        } catch (error) {
            return Object.freeze({
                available: false,
                error_code: error && error.code || 'publication_context_unavailable',
                classes: state.classes.slice(),
                class_id: null
            });
        }
    }

    function describeStudentUnit(unit, index) {
        const releaseState = String(unit && unit.effective_release_state || '').trim().toLowerCase();
        if (releaseState !== 'open' && releaseState !== 'locked') return null;
        const contentSlug = String(unit && unit.content_slug || '').trim();
        const activityKey = String(unit && unit.activity_key || '').trim();
        return Object.freeze({
            release_state: releaseState,
            title: String(unit && unit.title || `单元 ${Number(index) + 1}`),
            position: Number(index) + 1,
            content_slug: contentSlug,
            activity_key: activityKey,
            executable: releaseState === 'open' && Boolean(contentSlug),
            engineering_activity: releaseState === 'open' && activityKey === 'physics.mechanics'
        });
    }

    async function navigateStudent(user, classId, href, options = {}) {
        const target = String(href || '');
        const classKey = id(classId);
        if (!target.startsWith('#') || !classKey) throw new Error('invalid_engineering_navigation');
        const navigation = beginNavigation(options && options.signal);
        try {
            const prepared = await prepare(user, { signal: navigation.signal });
            if (!currentNavigation(navigation) || prepared.error_code === 'cancelled') throw navigationError('cancelled');
            if (prepared.error_code === 'student_role_required') throw navigationError('student_role_required');
            if (!selectPreparedClass(classKey, prepared.classes || [])) throw navigationError('class_scope_missing');
            if (!currentNavigation(navigation)) throw navigationError('cancelled');
            global.location.hash = target;
            return true;
        } finally {
            navigation.detach();
            if (state.navigationController === navigation.controller) state.navigationController = null;
        }
    }

    async function resolve(activity) {
        if (!activity || activity.galaxy_key !== 'englab') {
            return Object.freeze({ available: false, error_code: 'activity_mapping_missing' });
        }
        if (!state.user || state.user.role !== 'student' || !state.classes.length) await prepare(state.user);
        if (!state.selectedClassId) {
            return Object.freeze({
                available: false,
                error_code: state.classes.length ? 'class_selection_required' : 'class_scope_missing',
                classes: state.classes.slice()
            });
        }
        const scope = begin();
        try {
            const courses = list(await api().request('/api/courses', {
                params: { class_id: state.selectedClassId },
                signal: scope.signal
            }));
            if (!current(scope)) return Object.freeze({ available: false, error_code: 'cancelled' });
            const matches = courses.filter(course => course.galaxy_key === 'englab' && course.course_key === activity.course_key);
            if (matches.length !== 1) {
                return Object.freeze({ available: false, error_code: matches.length ? 'course_scope_ambiguous' : 'course_scope_missing' });
            }
            const courseId = id(matches[0].id);
            const units = list(await api().request(`/api/courses/${courseId}/units`, {
                params: { class_id: state.selectedClassId },
                signal: scope.signal
            }));
            if (!current(scope)) return Object.freeze({ available: false, error_code: 'cancelled' });
            const matchesUnits = units.filter(unit => unit.activity_key === activity.activity_key);
            if (matchesUnits.length !== 1) {
                return Object.freeze({ available: false, error_code: matchesUnits.length ? 'course_unit_ambiguous' : 'course_unit_missing' });
            }
            const unit = matchesUnits[0];
            if (unit.effective_release_state !== 'open') {
                return Object.freeze({
                    available: false,
                    error_code: unit.effective_release_state === 'locked' ? 'activity_locked' : 'activity_hidden'
                });
            }
            return Object.freeze({
                available: true,
                class_id: state.selectedClassId,
                course_id: courseId,
                course_unit_id: id(unit.id),
                activity_key: activity.activity_key,
                galaxy_key: 'englab',
                course_key: activity.course_key
            });
        } catch (error) {
            if (api().isCancelled && api().isCancelled(error)) return Object.freeze({ available: false, error_code: 'cancelled' });
            return Object.freeze({ available: false, error_code: error && error.code || 'publication_context_unavailable' });
        }
    }

    function close() {
        invalidatePublicationScope();
        state.user = null;
        state.classes = [];
    }

    global.addEventListener('astra:session-ready', event => {
        const user = event && event.detail && event.detail.user;
        if (user && user.role === 'student') prepare(user).catch(() => {});
        else close();
    });
    global.addEventListener('astra:api-auth-required', close);
    global.addEventListener('astra:session-signed-out', close);

    const session = global.AstraApplicationSession;
    const user = session && typeof session.getUser === 'function' ? session.getUser() : null;
    if (user && user.role === 'student') prepare(user).catch(() => {});

    global.AstraEngineeringLabPublicationContext = Object.freeze({
        prepare,
        selectClass,
        switchClass,
        cancelNavigation,
        describeStudentUnit,
        navigateStudent,
        resolve,
        close,
        snapshot: () => Object.freeze({
            class_id: state.selectedClassId || null,
            classes: state.classes.slice()
        })
    });
})(window);
