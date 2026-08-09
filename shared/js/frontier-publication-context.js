/* Future Galaxy student publication context: Cookie session -> class -> course map -> BE-004 units. */
(function installFutureGalaxyPublicationContext(global) {
    'use strict';

    if (global.FutureGalaxyPublicationContext) return;

    const GALAXY_KEY = 'future-galaxy';
    const MANAGED_PAGES = new Set(['frontier', 'cosmos', 'engineering', 'datascience', 'infotech', 'materials', 'humanities']);
    const state = {
        generation: 0,
        controller: null,
        classId: '',
        courseIds: null,
        userId: ''
    };

    const normalizeList = (payload) => Array.isArray(payload)
        ? payload
        : (payload && Array.isArray(payload.items) ? payload.items : []);
    const entityId = (item) => item && (item.id !== undefined && item.id !== null) ? item.id : '';
    const abortController = (controller) => {
        if (controller && typeof controller.abort === 'function') controller.abort();
    };

    function getManifest() {
        const manifest = global.FrontierCourseManifest;
        return manifest
            && manifest.galaxy_key === GALAXY_KEY
            && Array.isArray(manifest.courses)
            && typeof manifest.configureHttp === 'function'
            && typeof manifest.refresh === 'function'
            ? manifest
            : null;
    }

    function currentStudent() {
        const session = global.AstraApplicationSession;
        const user = session && typeof session.getUser === 'function' ? session.getUser() : null;
        return user && user.role === 'student' && user.id !== undefined && user.id !== null
            ? user
            : null;
    }

    function beginContext() {
        abortController(state.controller);
        state.generation += 1;
        state.controller = new AbortController();
        // A student context is not authoritative until its class and complete course map
        // have both been verified. Close the legacy catalogue before the first await so a
        // direct Future Galaxy route cannot mount an owner while /api/classes is pending.
        const manifest = getManifest();
        if (manifest) manifest.configureHttp({});
        state.classId = '';
        state.courseIds = null;
        rerenderIfActive();
        return {
            generation: state.generation,
            controller: state.controller,
            signal: state.controller.signal
        };
    }

    function isCurrent(context) {
        return Boolean(
            context
            && context.generation === state.generation
            && context.controller === state.controller
            && !context.signal.aborted
        );
    }

    function pageFromHash() {
        const page = String((global.location && global.location.hash) || '#frontier').replace(/^#/, '').split('/')[0] || 'frontier';
        return MANAGED_PAGES.has(page) ? page : '';
    }

    function rerenderIfActive() {
        const page = pageFromHash();
        if (!page) return;
        if (global.FrontierLearning && typeof global.FrontierLearning.renderRoute === 'function') {
            global.FrontierLearning.renderRoute(page);
        } else if (typeof global.initFrontierCourse === 'function') {
            global.initFrontierCourse();
        }
    }

    function close(context) {
        if (context && !isCurrent(context)) return false;
        abortController(state.controller);
        state.generation += 1;
        state.controller = null;
        const manifest = getManifest();
        if (manifest) manifest.configureHttp({});
        state.classId = '';
        state.courseIds = null;
        state.userId = '';
        rerenderIfActive();
        return true;
    }

    function validCourseId(value) {
        return (typeof value === 'number' && Number.isFinite(value) && value > 0)
            || (typeof value === 'string' && value.trim().length > 0);
    }

    function buildCourseIdMap(payload, manifest) {
        const target = manifest || getManifest();
        if (!target) return null;
        const expected = new Set(target.courses.map((course) => course.course_key));
        const map = {};
        for (const item of normalizeList(payload)) {
            if (!item || item.galaxy_key !== GALAXY_KEY) continue;
            const courseKey = String(item.course_key || '');
            if (!expected.has(courseKey) || Object.prototype.hasOwnProperty.call(map, courseKey) || !validCourseId(item.id)) return null;
            map[courseKey] = item.id;
        }
        return Object.keys(map).length === expected.size ? Object.freeze(map) : null;
    }

    async function requestSameOriginJson(path, options) {
        if (typeof global.fetch !== 'function') throw new Error('Future course authority fetch is unavailable');
        const request = options || {};
        const origin = (global.location && global.location.origin) || 'http://localhost';
        const url = new URL(path, origin);
        Object.entries(request.params || {}).forEach(([key, value]) => {
            if (value !== undefined && value !== null && String(value).trim() !== '') url.searchParams.set(key, String(value));
        });
        const response = await global.fetch(`${url.pathname}${url.search}`, {
            method: 'GET',
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
            signal: request.signal
        });
        if (!response || response.ok !== true || typeof response.json !== 'function') throw new Error('Future course authority request failed');
        return response.json();
    }

    async function configureForContext(context, classId, coursePayload) {
        const manifest = getManifest();
        if (!manifest || !isCurrent(context)) return { availability: 'unavailable', source: 'manifest-unavailable' };
        const courseIds = buildCourseIdMap(coursePayload, manifest);
        if (!courseIds) {
            close(context);
            return { availability: 'unavailable', source: 'course-map-unavailable' };
        }
        const configured = manifest.configureHttp({
            course_ids: courseIds,
            class_id: classId,
            fetcher: (path, request) => {
                if (!isCurrent(context)) return Promise.reject(new Error('Future course context superseded'));
                return global.fetch(path, {
                    ...(request || {}),
                    credentials: 'same-origin',
                    signal: context.signal
                });
            }
        });
        if (!configured) {
            close(context);
            return { availability: 'unavailable', source: 'http-config-unavailable' };
        }
        state.classId = String(classId);
        state.courseIds = courseIds;
        const snapshot = await manifest.refresh();
        if (!isCurrent(context)) return { availability: 'unavailable', source: 'superseded' };
        rerenderIfActive();
        return snapshot;
    }

    async function configure(classId, coursePayload) {
        const user = currentStudent();
        if (!classId || !user) {
            close();
            return { availability: 'unavailable', source: user ? 'class-context-unavailable' : 'identity-required' };
        }
        const context = beginContext();
        state.userId = String(user.id);
        try {
            return await configureForContext(context, classId, coursePayload);
        } catch (error) {
            if (isCurrent(context)) close(context);
            return { availability: 'unavailable', source: 'course-context-unavailable' };
        }
    }

    async function bootstrap(user) {
        if (!user || user.role !== 'student' || user.id === undefined || user.id === null) return { availability: 'legacy-boundary' };
        const userId = String(user.id || '');
        const context = beginContext();
        state.userId = userId;
        try {
            const classes = normalizeList(await requestSameOriginJson('/api/classes', {
                params: { mine: true }, signal: context.signal
            }));
            if (!isCurrent(context)) return { availability: 'unavailable', source: 'superseded' };
            if (classes.length !== 1) {
                close(context);
                return { availability: 'unavailable', source: 'class-selection-required' };
            }
            const classId = entityId(classes[0]);
            if (!classId) {
                close(context);
                return { availability: 'unavailable', source: 'class-context-unavailable' };
            }
            const courses = await requestSameOriginJson('/api/courses', {
                params: { class_id: classId }, signal: context.signal
            });
            return configureForContext(context, classId, courses);
        } catch (error) {
            if (isCurrent(context)) close(context);
            return { availability: 'unavailable', source: 'course-context-unavailable' };
        }
    }

    function learningEvidenceUnavailable(errorCode) {
        return Object.freeze({ available: false, error_code: errorCode || 'publication_context_unavailable' });
    }

    function routeMatchesActivity(activityKey) {
        const parts = String((global.location && global.location.hash) || '').replace(/^#/, '').split('/');
        const expected = String(activityKey || '').split('.');
        return parts[0] === expected[0] && parts[1] === expected.slice(1).join('.');
    }

    async function resolveLearningEvidence(mapping) {
        if (
            !mapping
            || mapping.galaxy_key !== GALAXY_KEY
            || mapping.course_key !== 'engineering-systems'
            || mapping.activity_key !== 'engineering.load-path'
        ) return learningEvidenceUnavailable('activity_mapping_missing');
        const user = currentStudent();
        if (!user || !state.userId || String(user.id) !== state.userId) {
            return learningEvidenceUnavailable('identity_required');
        }
        if (!routeMatchesActivity(mapping.activity_key)) {
            return learningEvidenceUnavailable('activity_hidden');
        }
        const catalogue = global.AstraStudentCourseCatalogue;
        if (
            catalogue
            && typeof catalogue.allowsActivity === 'function'
            && !catalogue.allowsActivity('engineering', 'load-path')
        ) return learningEvidenceUnavailable('activity_hidden');
        const manifest = getManifest();
        if (!manifest || typeof manifest.resolveEvidenceBinding !== 'function') {
            return learningEvidenceUnavailable('publication_context_unavailable');
        }
        const binding = manifest.resolveEvidenceBinding(mapping.course_key, mapping.activity_key);
        if (!binding || binding.access_state !== 'open') {
            const access = manifest.resolveAvailability && manifest.resolveAvailability();
            const stateValue = access && access.activity_access && access.activity_access[mapping.activity_key]
                && access.activity_access[mapping.activity_key].state;
            return learningEvidenceUnavailable(stateValue === 'locked' ? 'activity_locked'
                : stateValue === 'hidden' ? 'activity_hidden'
                    : 'publication_context_unavailable');
        }
        if (
            String(binding.class_id) !== String(state.classId)
            || String(binding.course_id) !== String(state.courseIds && state.courseIds[mapping.course_key])
        ) return learningEvidenceUnavailable('cancelled');
        return Object.freeze({
            available: true,
            class_id: binding.class_id,
            course_id: binding.course_id,
            course_unit_id: binding.course_unit_id,
            activity_key: mapping.activity_key,
            galaxy_key: GALAXY_KEY,
            course_key: mapping.course_key,
            identity_id: state.userId,
            authority_generation: state.generation,
            access_state: 'open'
        });
    }

    function sameLearningEvidenceAuthority(expected, current) {
        if (!expected || !current || expected.available !== true || current.available !== true) return false;
        return [
            'class_id', 'course_id', 'course_unit_id', 'activity_key',
            'identity_id', 'authority_generation', 'access_state'
        ].every(key => String(expected[key]) === String(current[key]));
    }

    const api = Object.freeze({
        bootstrap,
        configure,
        close,
        buildCourseIdMap,
        resolveLearningEvidence,
        sameLearningEvidenceAuthority,
        snapshot: () => Object.freeze({ classId: state.classId, courseIds: state.courseIds, userId: state.userId, generation: state.generation })
    });
    global.FutureGalaxyPublicationContext = api;

    if (typeof global.addEventListener === 'function') {
        global.addEventListener('astra:session-ready', (event) => {
            const user = event && event.detail && event.detail.user;
            if (user && user.role === 'student') void bootstrap(user);
            else close();
        });
        const closeOnAuthorityLoss = () => close();
        global.addEventListener('astra:api-auth-required', closeOnAuthorityLoss);
        global.addEventListener('astra:session-signed-out', closeOnAuthorityLoss);
    }

    const session = global.AstraApplicationSession;
    const currentUser = session && typeof session.getUser === 'function' ? session.getUser() : null;
    if (currentUser && currentUser.role === 'student') void bootstrap(currentUser);

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(window);
