/* Student course projection for Code Space.
 *
 * Kept outside course-manifest.js so release plumbing can evolve without
 * changing the protected activity catalogue or any finished activity body.
 */
(function attachCodeSpacePublicationAdapter(global) {
    'use strict';

    const manifest = global.CvCourseManifest;
    const fallback = global.CvCourseStateAdapter;
    if (!manifest || !Array.isArray(manifest.courses) || !fallback) return;

    const courses = manifest.courses;
    const byActivity = new Map(courses.flatMap(course => course.activities.map(activity => [activity.activity_key, activity])));
    const activityKeyPattern = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/;
    const state = {
        configured: false,
        phase: 'idle',
        courseIds: null,
        courseClassIds: null,
        fetcher: null,
        records: new Map(),
        unitIds: new Map(),
        generation: 0
    };

    function unavailable(source) {
        return { status: 'unavailable', source, detail: '' };
    }

    function validUnit(unit) {
        return !!unit && typeof unit === 'object' && unit.id != null
            && typeof unit.activity_key === 'string' && activityKeyPattern.test(unit.activity_key)
            && typeof unit.title === 'string' && unit.title.length > 0
            && Number.isInteger(unit.position) && unit.position >= 0
            && (unit.effective_release_state === 'open' || unit.effective_release_state === 'locked')
            && Array.isArray(unit.lock_reasons)
            && unit.lock_reasons.every(reason => typeof reason === 'string');
    }

    function stateFromUnit(unit) {
        if (unit.effective_release_state === 'open') {
            return { status: 'available', source: 'be-004', detail: '' };
        }
        const labels = {
            manual_locked: '教师暂未开放',
            scheduled: '尚未到开放时间',
            prerequisite_incomplete: '前置学习尚未完成'
        };
        const reasons = unit.lock_reasons.map(reason => labels[reason] || '当前开放条件尚未满足');
        return {
            status: 'locked',
            source: 'be-004',
            detail: '',
            lock_reason: Array.from(new Set(reasons)).join('；')
        };
    }

    function normalizeCourseIds(value) {
        if (!value || typeof value !== 'object') return null;
        const output = {};
        courses.forEach(course => {
            const courseId = Number(value[course.course_key]);
            if (Number.isInteger(courseId) && courseId > 0) output[course.course_key] = courseId;
        });
        return Object.keys(output).length ? output : null;
    }

    function normalizeCourseClassIds(value, courseIds, fallbackClassId) {
        if (!courseIds) return null;
        const output = {};
        Object.keys(courseIds).forEach(courseKey => {
            const explicit = value && typeof value === 'object'
                && Object.prototype.hasOwnProperty.call(value, courseKey);
            const classId = Number(explicit ? value[courseKey] : fallbackClassId);
            output[courseKey] = Number.isInteger(classId) && classId > 0 ? String(classId) : null;
        });
        return output;
    }

    const adapter = Object.freeze({
        contract: Object.freeze({
            ...(fallback.contract || {}),
            projection: 'partial-subjects-with-per-course-class-scope'
        }),

        configureHttp({ course_ids, class_id, course_class_ids, fetcher } = {}) {
            state.generation += 1;
            state.configured = true;
            state.phase = 'unavailable';
            state.courseIds = normalizeCourseIds(course_ids);
            state.courseClassIds = normalizeCourseClassIds(course_class_ids, state.courseIds, class_id);
            state.fetcher = typeof fetcher === 'function' ? fetcher : global.fetch;
            state.records.clear();
            state.unitIds.clear();
        },

        async refresh() {
            if (!state.configured || !state.courseIds || typeof state.fetcher !== 'function') {
                state.phase = 'unavailable';
                return false;
            }
            const generation = state.generation;
            const courseIds = { ...state.courseIds };
            const courseClassIds = { ...(state.courseClassIds || {}) };
            const fetcher = state.fetcher;
            try {
                const configuredCourses = courses.filter(course => courseIds[course.course_key] != null);
                const entries = await Promise.all(configuredCourses.map(async course => {
                    const courseId = courseIds[course.course_key];
                    const classId = courseClassIds[course.course_key];
                    const classQuery = classId == null ? '' : `?class_id=${encodeURIComponent(classId)}`;
                    const response = await fetcher(`/api/courses/${encodeURIComponent(String(courseId))}/units${classQuery}`, {
                        credentials: 'same-origin'
                    });
                    if (!response || !response.ok || typeof response.json !== 'function') throw new Error('request failed');
                    const units = await response.json();
                    if (!Array.isArray(units) || !units.every(validUnit)) throw new Error('invalid payload');
                    return [course.course_key, units];
                }));
                if (generation !== state.generation) return false;
                state.records.clear();
                state.unitIds.clear();
                entries.forEach(([courseKey, units]) => units.forEach(unit => {
                    const activity = byActivity.get(unit.activity_key);
                    if (!activity || activity.course_key !== courseKey) return;
                    state.records.set(unit.activity_key, stateFromUnit(unit));
                    state.unitIds.set(unit.activity_key, Number(unit.id));
                }));
                state.phase = 'ready';
                return true;
            } catch (error) {
                if (generation !== state.generation) return false;
                state.records.clear();
                state.unitIds.clear();
                state.phase = 'unavailable';
                return false;
            }
        },

        resolve(activity) {
            if (!state.configured) return fallback.resolve(activity);
            if (state.phase !== 'ready') return unavailable('adapter-unavailable');
            return state.records.get(activity && activity.activity_key)
                || { status: 'hidden', source: 'be-004', detail: '' };
        },

        unitIdFor(activity) {
            if (!state.configured) return typeof fallback.unitIdFor === 'function' ? fallback.unitIdFor(activity) : null;
            if (!activity || state.phase !== 'ready') return null;
            const value = Number(state.unitIds.get(activity.activity_key));
            return Number.isInteger(value) && value > 0 ? value : null;
        }
    });

    global.CvCourseStateAdapter = adapter;
    global.CvCoursePublicationAdapter = adapter;
})(window);
