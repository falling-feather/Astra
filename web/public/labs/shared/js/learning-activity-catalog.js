(function (global) {
    'use strict';

    if (global.AstraLearningActivityCatalog && global.AstraShowcaseActivitySelection) return;

    const ALLOWED_EVENTS = Object.freeze(['started', 'predicted', 'attempted', 'corrected', 'explained']);
    const SHOWCASE_ACTIVITY_KEYS = Object.freeze({
        englab: 'physics.mechanics',
        'code-space': 'control-flow.loop-boundary',
        'future-galaxy': 'engineering.load-path'
    });
    const FUTURE_KEYS = Object.freeze([
        'cosmos.day-season',
        'cosmos.orbital-scale',
        'cosmos.evidence-log',
        'engineering.load-path',
        'engineering.member-choice',
        'engineering.safety-check',
        'engineering.robot-arm-ik',
        'datascience.model-fit',
        'datascience.outlier-test',
        'datascience.evidence-claim',
        'infotech.packet-route',
        'infotech.layer-contract',
        'infotech.fault-trace',
        'materials.grain-boundary',
        'materials.defect-path',
        'materials.process-window',
        'humanities.context-map',
        'humanities.voice-shift',
        'humanities.claim-review'
    ]);
    const CODE_SPACE_KEYS = Object.freeze({
        'program-start': Object.freeze([
            'program-start.first-output',
            'program-start.variable-box',
            'program-start.input-response'
        ]),
        'control-flow': Object.freeze([
            'control-flow.branch-doors',
            'control-flow.loop-boundary',
            'control-flow.nested-grid'
        ]),
        'data-functions': Object.freeze([
            'data-functions.list-snapshot',
            'data-functions.parameter-return',
            'data-functions.array-scan'
        ]),
        'algorithm-thinking': Object.freeze([
            'algorithm-thinking.linear-search',
            'algorithm-thinking.bubble-pass',
            'algorithm-thinking.binary-choice'
        ]),
        'debugging-testing': Object.freeze([
            'debugging-testing.assert-boundary',
            'debugging-testing.trace-mismatch',
            'debugging-testing.minimal-case'
        ]),
        'challenge-submission': Object.freeze([
            'challenge-submission.multi-language-counter',
            'challenge-submission.public-sample',
            'challenge-submission.submission-record'
        ])
    });
    const FUTURE_COURSE_KEYS = Object.freeze({
        cosmos: 'earth-space',
        engineering: 'engineering-systems',
        datascience: 'data-ai',
        infotech: 'information-technology',
        materials: 'materials-science',
        humanities: 'humanities-futures'
    });
    const ACTIVITY_KEY_PATTERN = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/;
    const CONTENT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)+$/;

    function freezeEntry(entry) {
        return Object.freeze(Object.assign({}, entry, {
            publication_context: Object.freeze(Object.assign({}, entry.publication_context)),
            allowed_events: ALLOWED_EVENTS
        }));
    }

    function engineeringLabEntries() {
        const registry = global.AstraExperimentRegistry;
        if (!registry || typeof registry.entries !== 'function') return Object.freeze([]);
        return Object.freeze(registry.entries().map(definition => {
            const activityKey = `${definition.subject}.${definition.id}`;
            return freezeEntry({
                learning_space_key: 'englab',
                subject_key: definition.subject,
                galaxy_key: 'englab',
                course_key: definition.subject,
                activity_key: activityKey,
                source_key: `${definition.subject}:${definition.id}`,
                publication_context: {
                    learning_space_key: 'englab',
                    subject_key: definition.subject,
                    galaxy_key: 'englab',
                    course_key: definition.subject,
                    activity_key: activityKey
                }
            });
        }));
    }

    function codeSpaceEntries() {
        return Object.freeze(Object.entries(CODE_SPACE_KEYS).flatMap(([courseKey, activityKeys]) => (
            activityKeys.map(activityKey => freezeEntry({
                learning_space_key: 'code-space',
                subject_key: courseKey,
                galaxy_key: 'code-space',
                course_key: courseKey,
                activity_key: activityKey,
                source_key: activityKey,
                publication_context: {
                    learning_space_key: 'code-space',
                    subject_key: courseKey,
                    galaxy_key: 'code-space',
                    course_key: courseKey,
                    activity_key: activityKey
                }
            }))
        )));
    }

    function futureGalaxyEntries() {
        return Object.freeze(FUTURE_KEYS.map(activityKey => {
            const direction = activityKey.split('.')[0];
            const subjectKey = FUTURE_COURSE_KEYS[direction];
            return freezeEntry({
                learning_space_key: 'future-galaxy',
                subject_key: subjectKey,
                galaxy_key: 'future-galaxy',
                course_key: subjectKey,
                activity_key: activityKey,
                source_key: activityKey,
                publication_context: {
                    learning_space_key: 'future-galaxy',
                    subject_key: subjectKey,
                    galaxy_key: 'future-galaxy',
                    course_key: subjectKey,
                    activity_key: activityKey
                }
            });
        }));
    }

    function entries(learningSpaceKey) {
        const catalogs = {
            englab: engineeringLabEntries(),
            'code-space': codeSpaceEntries(),
            'future-galaxy': futureGalaxyEntries()
        };
        if (learningSpaceKey) return catalogs[learningSpaceKey] || Object.freeze([]);
        return Object.freeze(Object.values(catalogs).flat());
    }

    function resolve(learningSpaceKey, activityKey) {
        return entries(learningSpaceKey).find(entry => entry.activity_key === activityKey) || null;
    }

    function recoveryHref(entry, unit) {
        if (!entry || !unit || unit.activity_key !== entry.activity_key) return '';
        const contentSlug = String(unit.content_slug || '').trim().toLowerCase();
        if (entry.learning_space_key === 'englab') {
            if (!CONTENT_SLUG_PATTERN.test(contentSlug)) return '';
            const [subject, moduleId] = contentSlug.split('/');
            return subject === entry.subject_key && `${subject}.${moduleId}` === entry.activity_key
                ? `#${contentSlug}`
                : '';
        }
        if (entry.learning_space_key === 'code-space') {
            return ACTIVITY_KEY_PATTERN.test(entry.activity_key)
                ? `codevis/#challenge?activity=${encodeURIComponent(entry.activity_key)}`
                : '';
        }
        if (entry.learning_space_key === 'future-galaxy') {
            const [direction, activitySlug] = entry.activity_key.split('.');
            return FUTURE_KEYS.includes(entry.activity_key)
                ? `#${direction}/${activitySlug}`
                : '';
        }
        return '';
    }

    function verify() {
        const expected = Object.freeze({ englab: 90, 'code-space': 18, 'future-galaxy': 19 });
        const result = {};
        Object.keys(expected).forEach(key => {
            const catalog = entries(key);
            const keys = catalog.map(item => item.activity_key);
            const uniqueKeys = new Set(keys);
            const missing = key === 'future-galaxy'
                ? FUTURE_KEYS.filter(activityKey => !uniqueKeys.has(activityKey))
                : [];
            const unknown = key === 'future-galaxy'
                ? keys.filter(activityKey => !FUTURE_KEYS.includes(activityKey))
                : [];
            const taxonomyValid = catalog.every(item => (
                item.learning_space_key === key
                && typeof item.subject_key === 'string'
                && item.subject_key.length > 0
                && !Object.prototype.hasOwnProperty.call(item, 'representative')
                && !Object.prototype.hasOwnProperty.call(item, 'tier')
                && !Object.prototype.hasOwnProperty.call(item, 'quality')
            ));
            result[key] = Object.freeze({
                expected: expected[key],
                actual: catalog.length,
                unique: uniqueKeys.size === catalog.length,
                taxonomy: taxonomyValid,
                missing: Object.freeze(missing),
                unknown: Object.freeze(unknown),
                valid: catalog.length === expected[key]
                    && uniqueKeys.size === catalog.length
                    && taxonomyValid
                    && missing.length === 0
                    && unknown.length === 0
            });
        });
        return Object.freeze(result);
    }

    global.AstraLearningActivityCatalog = Object.freeze({
        allowedEvents: ALLOWED_EVENTS,
        futureKeys: FUTURE_KEYS,
        entries,
        resolve,
        recoveryHref,
        verify
    });

    global.AstraShowcaseActivitySelection = Object.freeze({
        activityKeys: SHOWCASE_ACTIVITY_KEYS,
        forSpace(learningSpaceKey) {
            return SHOWCASE_ACTIVITY_KEYS[String(learningSpaceKey || '')] || '';
        },
        resolve(learningSpaceKey) {
            const activityKey = SHOWCASE_ACTIVITY_KEYS[String(learningSpaceKey || '')] || '';
            return activityKey ? resolve(learningSpaceKey, activityKey) : null;
        },
        matches(entry) {
            if (!entry) return false;
            const learningSpaceKey = String(entry.learning_space_key || entry.galaxy_key || '');
            return SHOWCASE_ACTIVITY_KEYS[learningSpaceKey] === entry.activity_key;
        }
    });
})(window);
