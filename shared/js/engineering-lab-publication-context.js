(function (global) {
    'use strict';

    if (global.AstraEngineeringLabPublicationContext) return;

    const state = {
        user: null,
        classes: [],
        selectedClassId: 0,
        generation: 0,
        controller: null
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

    async function prepare(user) {
        const session = global.AstraApplicationSession;
        const sessionUser = session && typeof session.getUser === 'function' ? session.getUser() : null;
        state.user = user || sessionUser || null;
        if (!state.user || state.user.role !== 'student') {
            return Object.freeze({ available: false, error_code: 'student_role_required', classes: [] });
        }
        const scope = begin();
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
    }

    function selectClass(classId) {
        const selected = state.classes.find(item => id(item.id) === id(classId));
        if (!selected) return false;
        state.selectedClassId = id(selected.id);
        return true;
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
        if (state.controller) state.controller.abort();
        state.controller = null;
        state.generation += 1;
        state.user = null;
        state.classes = [];
        state.selectedClassId = 0;
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
        resolve,
        close,
        snapshot: () => Object.freeze({
            class_id: state.selectedClassId || null,
            classes: state.classes.slice()
        })
    });
})(window);
