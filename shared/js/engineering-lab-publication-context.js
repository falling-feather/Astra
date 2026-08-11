(function (global) {
    'use strict';

    if (global.AstraEngineeringLabPublicationContext) return;

    const state = {
        user: null,
        classes: [],
        selectedClassId: 0,
        authorityGeneration: 0,
        prepareFlight: null,
        resolveFlight: null,
        navigationGeneration: 0,
        navigationController: null
    };
    const UNIT_ACCESS_ERROR_CODES = new Set([
        'activity_hidden',
        'activity_locked',
        'course_unit_missing'
    ]);

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

    function identityKey(user) {
        return user && user.id != null ? `${user.role || ''}:${user.id}` : '';
    }

    function setUser(user) {
        const next = user || null;
        if (identityKey(next) !== identityKey(state.user)) {
            abortPublicationFlights();
            state.classes = [];
            state.selectedClassId = 0;
            state.authorityGeneration += 1;
        }
        state.user = next;
    }

    function setSelectedClassId(value) {
        const next = id(value);
        if (next !== state.selectedClassId) {
            abortOwnerFlight('resolveFlight');
            state.authorityGeneration += 1;
        }
        state.selectedClassId = next;
    }

    function routeMatchesActivity(activityKey) {
        const parts = String((global.location && global.location.hash) || '').replace(/^#/, '').split('/');
        const expected = String(activityKey || '').split('.');
        return parts[0] === expected[0] && parts[1] === expected.slice(1).join('.');
    }

    function validPhysicsActivity(activity) {
        if (!activity || activity.galaxy_key !== 'englab' || activity.course_key !== 'physics') return false;
        const activityKey = String(activity.activity_key || '');
        return activityKey.length <= 120
            && /^physics\.[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/.test(activityKey);
    }

    function unitAccessDisposition(payload) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
        const keys = Object.keys(payload).sort();
        if (keys.length !== 2 || keys[0] !== 'available' || keys[1] !== 'error_code') return null;
        if (payload.available === true && payload.error_code === null) {
            return Object.freeze({ available: true, error_code: null });
        }
        if (payload.available === false && UNIT_ACCESS_ERROR_CODES.has(payload.error_code)) {
            return Object.freeze({ available: false, error_code: payload.error_code });
        }
        return null;
    }

    function unavailablePublication() {
        return Object.freeze({ available: false, error_code: 'publication_context_unavailable' });
    }

    function cancelledPublication(extra = {}) {
        return Object.freeze(Object.assign({ available: false, error_code: 'cancelled' }, extra));
    }

    function abortOwnerFlight(field, expected = null) {
        const flight = state[field];
        if (!flight || (expected && flight !== expected)) return false;
        state[field] = null;
        if (!flight.controller.signal.aborted) flight.controller.abort();
        return true;
    }

    function abortPublicationFlights() {
        abortOwnerFlight('prepareFlight');
        abortOwnerFlight('resolveFlight');
    }

    function abortResolveFlightOnRouteChange() {
        const flight = state.resolveFlight;
        if (!flight) return;
        const currentRoute = String((global.location && global.location.hash) || '');
        if (!flight.route || flight.route !== currentRoute) {
            abortOwnerFlight('resolveFlight', flight);
        }
    }

    function currentOwnerFlight(field, flight) {
        return Boolean(
            flight
            && state[field] === flight
            && !flight.controller.signal.aborted
        );
    }

    function acquireOwnerFlight(field, key, operation) {
        const existing = state[field];
        if (existing && existing.key === key && !existing.controller.signal.aborted) return existing;
        if (existing) abortOwnerFlight(field, existing);
        const flight = {
            key,
            controller: new AbortController(),
            waiters: 0,
            settled: false,
            promise: null
        };
        state[field] = flight;
        try {
            flight.promise = Promise.resolve(operation(flight));
        } catch (error) {
            flight.promise = Promise.reject(error);
        }
        const settle = () => {
            flight.settled = true;
            if (state[field] === flight) state[field] = null;
        };
        flight.promise.then(settle, settle);
        return flight;
    }

    function joinOwnerFlight(field, flight, externalSignal, cancelledValue) {
        flight.waiters += 1;
        return new Promise((resolve, reject) => {
            let joined = true;
            const release = () => {
                if (!joined) return false;
                joined = false;
                if (externalSignal && typeof externalSignal.removeEventListener === 'function') {
                    externalSignal.removeEventListener('abort', onAbort);
                }
                flight.waiters = Math.max(0, flight.waiters - 1);
                if (!flight.settled && flight.waiters === 0) {
                    const abortIfUnclaimed = () => {
                        if (
                            !flight.settled
                            && flight.waiters === 0
                            && currentOwnerFlight(field, flight)
                        ) abortOwnerFlight(field, flight);
                    };
                    if (field === 'prepareFlight') Promise.resolve().then(abortIfUnclaimed);
                    else abortIfUnclaimed();
                }
                return true;
            };
            const onAbort = () => {
                if (!release()) return;
                resolve(cancelledValue());
            };
            if (externalSignal && externalSignal.aborted) {
                onAbort();
                return;
            }
            if (externalSignal && typeof externalSignal.addEventListener === 'function') {
                externalSignal.addEventListener('abort', onAbort, { once: true });
            }
            flight.promise.then(
                value => {
                    if (!release()) return;
                    resolve(value);
                },
                error => {
                    if (!release()) return;
                    reject(error);
                }
            );
        });
    }

    async function prepare(user, options = {}) {
        const session = global.AstraApplicationSession;
        const sessionUser = session && typeof session.getUser === 'function' ? session.getUser() : null;
        setUser(user || sessionUser || null);
        if (!state.user || state.user.role !== 'student') {
            return Object.freeze({ available: false, error_code: 'student_role_required', classes: [] });
        }
        const externalSignal = options && options.signal;
        if (externalSignal && externalSignal.aborted) {
            return cancelledPublication({ classes: [] });
        }
        const prepareIdentity = identityKey(state.user);
        const flight = acquireOwnerFlight('prepareFlight', prepareIdentity, async owner => {
            try {
                const classes = list(await api().request('/api/classes', {
                    params: { mine: true },
                    signal: owner.controller.signal
                }));
                if (
                    !currentOwnerFlight('prepareFlight', owner)
                    || identityKey(state.user) !== prepareIdentity
                ) return cancelledPublication({ classes: [] });
                state.classes = classes;
                if (!classes.some(item => id(item.id) === state.selectedClassId)) setSelectedClassId(0);
                if (classes.length === 1) setSelectedClassId(classes[0].id);
                return Object.freeze({
                    available: Boolean(state.selectedClassId),
                    error_code: state.selectedClassId ? '' : classes.length ? 'class_selection_required' : 'class_scope_missing',
                    classes: classes.slice(),
                    class_id: state.selectedClassId || null
                });
            } catch (error) {
                if (owner.controller.signal.aborted || (api().isCancelled && api().isCancelled(error))) {
                    return cancelledPublication({ classes: [] });
                }
                throw error;
            }
        });
        return joinOwnerFlight(
            'prepareFlight',
            flight,
            externalSignal,
            () => cancelledPublication({ classes: [] })
        );
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
        abortPublicationFlights();
        state.authorityGeneration += 1;
        state.selectedClassId = 0;
    }

    function selectPreparedClass(classId, classes) {
        const selected = classes.find(item => id(item.id) === id(classId));
        if (!selected) return false;
        state.classes = classes.slice();
        setSelectedClassId(selected.id);
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
        setUser(user || sessionUser || null);
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
            setSelectedClassId(0);
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
                error_code: 'publication_context_unavailable',
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

    async function resolve(activity, options = {}) {
        const externalSignal = options && options.signal;
        if (externalSignal && externalSignal.aborted) {
            return cancelledPublication();
        }
        if (!validPhysicsActivity(activity)) {
            return Object.freeze({ available: false, error_code: 'activity_mapping_missing' });
        }
        if (!routeMatchesActivity(activity.activity_key)) {
            return Object.freeze({ available: false, error_code: 'activity_hidden' });
        }
        try {
            if (!state.user || state.user.role !== 'student' || !state.classes.length) {
                const prepared = await prepare(state.user, { signal: externalSignal });
                if (prepared.error_code === 'cancelled') {
                    return cancelledPublication();
                }
                if (prepared.error_code === 'student_role_required') {
                    return Object.freeze({ available: false, error_code: 'student_role_required' });
                }
            }
        } catch (error) {
            return unavailablePublication();
        }
        if (!state.user || state.user.role !== 'student') {
            return Object.freeze({ available: false, error_code: 'student_role_required' });
        }
        if (state.user.id == null || String(state.user.id).trim() === '') {
            return Object.freeze({ available: false, error_code: 'identity_required' });
        }
        if (!state.selectedClassId) {
            return Object.freeze({
                available: false,
                error_code: state.classes.length ? 'class_selection_required' : 'class_scope_missing',
                classes: state.classes.slice()
            });
        }
        if (externalSignal && externalSignal.aborted) {
            return cancelledPublication();
        }
        const resolveIdentity = identityKey(state.user);
        const resolveIdentityId = String(state.user.id);
        const resolveClassId = state.selectedClassId;
        const resolveAuthorityGeneration = state.authorityGeneration;
        const resolveRoute = String((global.location && global.location.hash) || '');
        const resolveKey = [
            resolveIdentity,
            resolveClassId,
            activity.activity_key,
            resolveRoute,
            resolveAuthorityGeneration
        ].join('|');
        const flight = acquireOwnerFlight('resolveFlight', resolveKey, async owner => {
            owner.route = resolveRoute;
            const currentResolve = () => Boolean(
                currentOwnerFlight('resolveFlight', owner)
                && identityKey(state.user) === resolveIdentity
                && state.selectedClassId === resolveClassId
                && state.authorityGeneration === resolveAuthorityGeneration
                && String((global.location && global.location.hash) || '') === resolveRoute
            );
            try {
                if (!currentResolve()) return cancelledPublication();
                const courses = list(await api().request('/api/courses', {
                    params: { class_id: resolveClassId },
                    signal: owner.controller.signal
                }));
                if (!currentResolve()) return cancelledPublication();
                const matches = courses.filter(course => course.galaxy_key === 'englab' && course.course_key === 'physics');
                if (matches.length !== 1) {
                    return Object.freeze({ available: false, error_code: matches.length ? 'course_scope_ambiguous' : 'course_scope_missing' });
                }
                const courseId = id(matches[0].id);
                if (!courseId) return unavailablePublication();
                const units = list(await api().request(`/api/courses/${courseId}/units`, {
                    params: { class_id: resolveClassId },
                    signal: owner.controller.signal
                }));
                if (!currentResolve()) return cancelledPublication();
                const matchesUnits = units.filter(unit => unit.activity_key === activity.activity_key);
                if (matchesUnits.length > 1) {
                    return Object.freeze({ available: false, error_code: 'course_unit_ambiguous' });
                }
                if (matchesUnits.length === 1) {
                    const unit = matchesUnits[0];
                    if (!routeMatchesActivity(activity.activity_key)) return cancelledPublication();
                    if (unit.effective_release_state === 'locked') {
                        return Object.freeze({ available: false, error_code: 'activity_locked' });
                    }
                    if (unit.effective_release_state === 'hidden') {
                        return Object.freeze({ available: false, error_code: 'activity_hidden' });
                    }
                    if (unit.effective_release_state !== 'open' || !id(unit.id)) {
                        return unavailablePublication();
                    }
                    return Object.freeze({
                        available: true,
                        class_id: resolveClassId,
                        course_id: courseId,
                        course_unit_id: id(unit.id),
                        activity_key: activity.activity_key,
                        galaxy_key: 'englab',
                        course_key: 'physics',
                        identity_id: resolveIdentityId,
                        authority_generation: resolveAuthorityGeneration,
                        access_state: 'open'
                    });
                }

                const disposition = unitAccessDisposition(await api().request(
                    `/api/courses/${courseId}/unit-access`,
                    {
                        params: {
                            class_id: resolveClassId,
                            activity_key: activity.activity_key
                        },
                        signal: owner.controller.signal
                    }
                ));
                if (!currentResolve()) return cancelledPublication();
                if (!disposition || disposition.available === true) return unavailablePublication();
                return disposition;
            } catch (error) {
                const client = global.AstraApiClient;
                if (
                    owner.controller.signal.aborted
                    || (client && typeof client.isCancelled === 'function' && client.isCancelled(error))
                ) return cancelledPublication();
                return unavailablePublication();
            }
        });
        return joinOwnerFlight(
            'resolveFlight',
            flight,
            externalSignal,
            () => cancelledPublication()
        );
    }

    function close() {
        invalidatePublicationScope();
        setUser(null);
        state.classes = [];
    }

    function sameLearningEvidenceAuthority(expected, currentContext) {
        if (!expected || !currentContext || expected.available !== true || currentContext.available !== true) return false;
        return [
            'class_id', 'course_id', 'course_unit_id', 'activity_key',
            'identity_id', 'authority_generation', 'access_state'
        ].every(key => String(expected[key]) === String(currentContext[key]));
    }

    global.addEventListener('astra:session-ready', event => {
        const user = event && event.detail && event.detail.user;
        if (user && user.role === 'student') prepare(user).catch(() => {});
        else close();
    });
    global.addEventListener('astra:api-auth-required', close);
    global.addEventListener('astra:session-signed-out', close);
    global.addEventListener('hashchange', abortResolveFlightOnRouteChange);

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
        sameLearningEvidenceAuthority,
        close,
        snapshot: () => Object.freeze({
            class_id: state.selectedClassId || null,
            classes: state.classes.slice(),
            identity_id: state.user && state.user.id != null ? String(state.user.id) : '',
            authority_generation: state.authorityGeneration
        })
    });
})(window);
