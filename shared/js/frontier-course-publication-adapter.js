/* Student course projection for Future Galaxy.
 *
 * This wrapper intentionally lives outside frontier-manifest.js. The manifest
 * remains the frozen catalogue of completed activities; this file only adapts
 * backend course instances and release states onto that catalogue.
 */
(function attachFutureCoursePublicationAdapter(global) {
    'use strict';

    const base = global.FrontierCourseManifest;
    if (!base || !Array.isArray(base.courses)) return;

    const GALAXY_KEY = base.galaxy_key;
    const courses = base.courses;
    const allActivities = courses.flatMap(course => course.activities);
    let config = null;
    let snapshot = null;
    let evidenceBindings = null;
    let inFlight = null;
    let generation = 0;

    function activityAccess(fillState) {
        return Object.freeze(Object.fromEntries(allActivities.map(activity => [
            activity.activity_key,
            Object.freeze({ state: fillState })
        ])));
    }

    function deriveCourseAccess(access) {
        return Object.freeze(Object.fromEntries(courses.map(course => {
            const states = course.activities.map(activity => (
                access[activity.activity_key] || { state: 'unavailable' }
            ).state);
            const state = states.every(value => value === 'hidden')
                ? 'hidden'
                : states.includes('open')
                    ? 'open'
                    : states.every(value => value === 'locked' || value === 'hidden')
                        ? 'locked'
                        : 'unavailable';
            return [course.course_key, Object.freeze({ state })];
        })));
    }

    function unavailable(source) {
        const access = activityAccess('unavailable');
        return Object.freeze({
            galaxy_key: GALAXY_KEY,
            source,
            availability: 'unavailable',
            teacher_plan: 'unavailable',
            course_access: deriveCourseAccess(access),
            activity_access: access
        });
    }

    function normalizeCourseIds(value) {
        if (!value || typeof value !== 'object') return null;
        const output = {};
        courses.forEach(course => {
            const id = Number(value[course.course_key]);
            if (Number.isInteger(id) && id > 0) output[course.course_key] = id;
        });
        return Object.keys(output).length ? Object.freeze(output) : null;
    }

    function normalizeCourseClassIds(value, courseIds, fallbackClassId) {
        if (!courseIds) return null;
        const output = {};
        Object.keys(courseIds).forEach(courseKey => {
            const explicit = value && typeof value === 'object'
                && Object.prototype.hasOwnProperty.call(value, courseKey);
            const classId = Number(explicit ? value[courseKey] : fallbackClassId);
            output[courseKey] = Number.isInteger(classId) && classId > 0 ? classId : null;
        });
        return Object.freeze(output);
    }

    function adaptCourse(course, units) {
        if (!course || !Array.isArray(units)) return null;
        const expected = new Map(course.activities.map(activity => [activity.activity_key, activity]));
        const access = Object.fromEntries(course.activities.map(activity => [
            activity.activity_key,
            Object.freeze({ state: 'hidden' })
        ]));
        const unitIds = {};
        for (const unit of units) {
            if (!unit || typeof unit !== 'object'
                || !expected.has(unit.activity_key)
                || typeof unit.title !== 'string'
                || !Number.isInteger(unit.position)
                || !Array.isArray(unit.lock_reasons)
                || !['open', 'locked'].includes(unit.effective_release_state)
                || access[unit.activity_key].state !== 'hidden') return null;
            access[unit.activity_key] = Object.freeze({ state: unit.effective_release_state });
            const unitId = Number(unit.id);
            if (Number.isInteger(unitId) && unitId > 0) unitIds[unit.activity_key] = unitId;
        }
        return Object.freeze({ access: Object.freeze(access), unitIds: Object.freeze(unitIds) });
    }

    function configureHttp({ course_ids, class_id, course_class_ids, fetcher } = {}) {
        generation += 1;
        inFlight = null;
        evidenceBindings = null;
        const courseIds = normalizeCourseIds(course_ids);
        const request = typeof fetcher === 'function'
            ? fetcher
            : typeof global.fetch === 'function'
                ? global.fetch.bind(global)
                : null;
        if (!courseIds || !request) {
            config = null;
            snapshot = unavailable('http-config-unavailable');
            return false;
        }
        config = Object.freeze({
            courseIds,
            courseClassIds: normalizeCourseClassIds(course_class_ids, courseIds, class_id),
            fetcher: request
        });
        snapshot = unavailable('http-pending');
        return true;
    }

    async function refresh() {
        if (!config) return snapshot || unavailable('http-unconfigured');
        const activeConfig = config;
        const activeGeneration = generation;
        if (inFlight && inFlight.generation === activeGeneration) return inFlight.promise;

        const configuredCourses = courses.filter(course => activeConfig.courseIds[course.course_key] != null);
        const promise = Promise.all(configuredCourses.map(async course => {
            const courseId = activeConfig.courseIds[course.course_key];
            const classId = activeConfig.courseClassIds[course.course_key];
            const classQuery = classId == null ? '' : `?class_id=${encodeURIComponent(String(classId))}`;
            const response = await activeConfig.fetcher(
                `/api/courses/${encodeURIComponent(String(courseId))}/units${classQuery}`,
                { credentials: 'same-origin' }
            );
            if (!response || response.ok !== true || typeof response.json !== 'function') {
                throw new Error('Invalid course unit response');
            }
            const adapted = adaptCourse(course, await response.json());
            if (!adapted) throw new Error('Invalid course unit fields');
            return Object.freeze({ course, adapted });
        })).then(perCourse => {
            const access = Object.assign(
                {},
                activityAccess('hidden'),
                ...perCourse.map(item => item.adapted.access)
            );
            Object.keys(access).forEach(key => { access[key] = Object.freeze({ ...access[key] }); });
            const frozenAccess = Object.freeze(access);
            const bindings = {};
            perCourse.forEach(({ course, adapted }) => {
                const classId = activeConfig.courseClassIds[course.course_key];
                if (!Number.isInteger(classId) || classId <= 0) return;
                Object.entries(adapted.unitIds).forEach(([activityKey, unitId]) => {
                    bindings[activityKey] = Object.freeze({
                        galaxy_key: GALAXY_KEY,
                        course_key: course.course_key,
                        activity_key: activityKey,
                        class_id: classId,
                        course_id: activeConfig.courseIds[course.course_key],
                        course_unit_id: unitId,
                        access_state: frozenAccess[activityKey] && frozenAccess[activityKey].state,
                        authority_generation: activeGeneration
                    });
                });
            });
            const next = Object.freeze({
                galaxy_key: GALAXY_KEY,
                source: 'http-cache',
                availability: 'available',
                teacher_plan: 'unavailable',
                course_access: deriveCourseAccess(frozenAccess),
                activity_access: frozenAccess
            });
            if (activeGeneration === generation && activeConfig === config) {
                snapshot = next;
                evidenceBindings = Object.freeze(bindings);
            }
            return activeGeneration === generation && activeConfig === config ? next : (snapshot || next);
        }).catch(() => {
            const next = unavailable('http-unavailable');
            if (activeGeneration === generation && activeConfig === config) {
                snapshot = next;
                evidenceBindings = null;
            }
            return activeGeneration === generation && activeConfig === config ? next : (snapshot || next);
        }).finally(() => {
            if (inFlight && inFlight.generation === activeGeneration) inFlight = null;
        });
        inFlight = Object.freeze({ generation: activeGeneration, promise });
        return promise;
    }

    function resolveAvailability() {
        if (config || snapshot) return snapshot || unavailable('http-pending');
        return base.resolveAvailability();
    }

    function resolveEvidenceBinding(courseKey, activityKey) {
        const activity = base.getActivity(courseKey, activityKey);
        const binding = evidenceBindings && evidenceBindings[activityKey];
        const access = snapshot && snapshot.activity_access && snapshot.activity_access[activityKey];
        if (!config || !activity || !binding
            || !snapshot || snapshot.availability !== 'available'
            || !access || access.state !== 'open'
            || binding.course_key !== courseKey
            || binding.activity_key !== activityKey
            || binding.authority_generation !== generation) return null;
        return Object.freeze({ ...binding });
    }

    const adapter = Object.freeze({
        ...base,
        configureHttp,
        hasHttpConfig: () => !!config,
        refresh,
        resolveAvailability,
        resolveEvidenceBinding
    });

    global.FrontierCourseManifest = adapter;
    global.FrontierCoursePublicationAdapter = adapter;
})(window);
