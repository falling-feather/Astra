/* Future Galaxy student publication context: Cookie session -> class -> course map -> BE-004 units. */
(function installFutureGalaxyPublicationContext(global) {
    'use strict';

    if (global.FutureGalaxyPublicationContext) return;

    const GALAXY_KEY = 'future-galaxy';
    // Engineering is a linked independent experiment, not a Future runtime mount.
    const MANAGED_PAGES = new Set(['frontier', 'cosmos', 'datascience', 'infotech', 'materials', 'humanities']);
    const state = {
        generation: 0,
        controller: null,
        classId: '',
        courseIds: null,
        courseClassIds: null,
        userId: ''
    };
    let projectionAdapterPromise = null;

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

    function ensureProjectionAdapter() {
        if (global.FrontierCoursePublicationAdapter) {
            return global.FrontierCoursePublicationAdapter;
        }
        const documentRef = global.document;
        if (!documentRef || typeof documentRef.createElement !== 'function') {
            return getManifest();
        }
        if (projectionAdapterPromise) return projectionAdapterPromise;
        const source = 'shared/js/frontier-course-publication-adapter.js?v=20260828v866StudentProjectionP0';
        projectionAdapterPromise = new Promise((resolve, reject) => {
            const scripts = documentRef.scripts ? Array.from(documentRef.scripts) : [];
            const existing = scripts.find(script => {
                const src = String(script.getAttribute && script.getAttribute('src') || script.src || '');
                return src.split('?')[0].endsWith('shared/js/frontier-course-publication-adapter.js');
            });
            const finish = () => global.FrontierCoursePublicationAdapter
                ? resolve(global.FrontierCoursePublicationAdapter)
                : reject(new Error('Future course projection adapter unavailable'));
            if (existing) {
                existing.addEventListener('load', finish, { once: true });
                existing.addEventListener('error', () => reject(new Error('Future course projection adapter failed to load')), { once: true });
                return;
            }
            const script = documentRef.createElement('script');
            script.src = source;
            script.async = true;
            script.dataset.frontierCourseProjection = 'true';
            script.addEventListener('load', finish, { once: true });
            script.addEventListener('error', () => reject(new Error('Future course projection adapter failed to load')), { once: true });
            documentRef.head.appendChild(script);
        }).catch(error => {
            projectionAdapterPromise = null;
            throw error;
        });
        return projectionAdapterPromise;
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
        // A student context is not authoritative until its course scope has been verified.
        // Close the legacy catalogue before the first await so a
        // direct Future Galaxy route cannot mount an owner while /api/classes is pending.
        const manifest = getManifest();
        if (manifest) manifest.configureHttp({});
        state.classId = '';
        state.courseIds = null;
        state.courseClassIds = null;
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
        state.courseClassIds = null;
        state.userId = '';
        rerenderIfActive();
        return true;
    }

    function validCourseId(value) {
        return (typeof value === 'number' && Number.isFinite(value) && value > 0)
            || (typeof value === 'string' && value.trim().length > 0);
    }

    function buildCourseIdMap(payload, manifest) {
        const scope = buildCourseScope(payload, [], null, manifest);
        return scope && scope.courseIds;
    }

    function buildCourseScope(payload, preferredPayload, preferredClassId, manifest) {
        const target = manifest || getManifest();
        if (!target) return null;
        const expected = new Set(target.courses.map((course) => course.course_key));
        const map = {};
        const classIds = {};
        const include = (items, classId, overwrite) => {
            for (const item of normalizeList(items)) {
                if (!item || item.galaxy_key !== GALAXY_KEY) continue;
                const subjectKey = String(item.subject_key || item.course_key || '');
                if (!expected.has(subjectKey)) continue;
                if (!validCourseId(item.id)) return false;
                if (!overwrite && Object.prototype.hasOwnProperty.call(map, subjectKey)) continue;
                map[subjectKey] = item.id;
                classIds[subjectKey] = validCourseId(classId) ? classId : null;
            }
            return true;
        };
        if (!include(payload, null, false) || !include(preferredPayload, preferredClassId, true)) return null;
        return Object.keys(map).length ? Object.freeze({
            courseIds: Object.freeze(map),
            courseClassIds: Object.freeze(classIds)
        }) : null;
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

    async function configureForContext(context, classId, coursePayload, classCoursePayload = []) {
        const manifest = getManifest();
        if (!manifest || !isCurrent(context)) return { availability: 'unavailable', source: 'manifest-unavailable' };
        const courseScope = buildCourseScope(coursePayload, classCoursePayload, classId, manifest);
        if (!courseScope) {
            close(context);
            return { availability: 'unavailable', source: 'course-map-unavailable' };
        }
        const configured = manifest.configureHttp({
            course_ids: courseScope.courseIds,
            class_id: classId,
            course_class_ids: courseScope.courseClassIds,
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
        state.classId = classId == null ? '' : String(classId);
        state.courseIds = courseScope.courseIds;
        state.courseClassIds = courseScope.courseClassIds;
        const snapshot = await manifest.refresh();
        if (!isCurrent(context)) return { availability: 'unavailable', source: 'superseded' };
        rerenderIfActive();
        return snapshot;
    }

    async function configure(classId, coursePayload) {
        const user = currentStudent();
        if (!user) {
            close();
            return { availability: 'unavailable', source: 'identity-required' };
        }
        const context = beginContext();
        state.userId = String(user.id);
        try {
            const adapter = ensureProjectionAdapter();
            if (adapter && typeof adapter.then === 'function') await adapter;
            if (!isCurrent(context)) return { availability: 'unavailable', source: 'superseded' };
            return await configureForContext(context, classId, coursePayload, classId == null ? [] : coursePayload);
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
            const adapter = ensureProjectionAdapter();
            if (adapter && typeof adapter.then === 'function') await adapter;
            if (!isCurrent(context)) return { availability: 'unavailable', source: 'superseded' };
            const classes = normalizeList(await requestSameOriginJson('/api/classes', {
                params: { mine: true }, signal: context.signal
            }));
            if (!isCurrent(context)) return { availability: 'unavailable', source: 'superseded' };
            let selectedClass = classes.length === 1 ? classes[0] : null;
            if (classes.length > 1) {
                const scope = global.AstraStudentScopeSelection;
                const remembered = scope && typeof scope.read === 'function' ? scope.read(user) : null;
                selectedClass = classes.find((item) => String(entityId(item)) === String(remembered && remembered.class_id || '')) || null;
            }
            if (classes.length > 1 && !selectedClass) {
                close(context);
                return { availability: 'unavailable', source: 'class-selection-required' };
            }
            const classId = selectedClass ? entityId(selectedClass) : null;
            if (selectedClass && !classId) {
                close(context);
                return { availability: 'unavailable', source: 'class-context-unavailable' };
            }
            const [courses, classCourses] = await Promise.all([
                requestSameOriginJson('/api/courses', { signal: context.signal }),
                classId == null
                    ? Promise.resolve([])
                    : requestSameOriginJson('/api/courses', { params: { class_id: classId }, signal: context.signal })
            ]);
            return configureForContext(context, classId, courses, classCourses);
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
            String(binding.class_id) !== String(state.courseClassIds && state.courseClassIds[mapping.course_key])
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
        snapshot: () => Object.freeze({ classId: state.classId, courseIds: state.courseIds, courseClassIds: state.courseClassIds, userId: state.userId, generation: state.generation })
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
