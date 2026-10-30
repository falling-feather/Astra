// ===== Astra Page Registry =====
(function attachAstraPageRegistry(global) {
    'use strict';

    if (global.AstraPageRegistry) return;

    const ROLE_RESOURCE_VERSION = '20260828v864RoleWorkbenchHarmonyP0';
    const TEACHER_RESOURCE_VERSION = '20260828v864RoleWorkbenchHarmonyP0';
    const FUTURE_RESOURCE_VERSION = '20260824v816ExperimentRestoreP2';
    const ADMIN_RESOURCE_VERSION = '20260828v864RoleWorkbenchHarmonyP0';
    const PLANETS_RESOURCE_VERSION = '20260828v864RoleWorkbenchHarmonyP0';
    const ABOUT_RESOURCE_VERSION = '20260719re2OfflineP0';
    const ROLE_WORKBENCH_OVERVIEW_VERSION = '20260828v864RoleWorkbenchHarmonyP0';

    const definePage = (config) => Object.freeze({
        galaxy: config.galaxy || 'englab',
        tags: Object.freeze([...(config.tags || [])]),
        roles: Object.freeze([...(config.roles || [])]),
        styles: Object.freeze([...(config.styles || [])]),
        resources: Object.freeze([...(config.resources || [])]),
        script: config.script || null,
        ready: config.ready || null, enter: config.enter || null, leave: config.leave || null
    });

    const definitions = Object.freeze({
        planets: definePage({
            galaxy: 'astra',
            script: `pages/planets/planets.js?v=${PLANETS_RESOURCE_VERSION}&patch=20260828v866StudentProjectionP0`,
            ready: 'initPlanets',
            enter: 'initPlanets',
            leave: 'destroyPlanets'
        }),
        home: definePage({
            galaxy: 'englab',
            script: 'pages/home/home.js?v=20260825v834Show04P0&patch=20260828v866StudentProjectionP0',
            ready: 'initHome',
            enter: 'initHome'
        }),
        mathematics: definePage({ galaxy: 'englab', tags: ['course'] }),
        physics: definePage({ galaxy: 'englab', tags: ['course'] }),
        chemistry: definePage({ galaxy: 'englab', tags: ['course'] }),
        algorithms: definePage({ galaxy: 'englab', tags: ['course'] }),
        biology: definePage({ galaxy: 'englab', tags: ['course'] }),
        student: definePage({
            galaxy: 'astra',
            roles: ['student'],
            styles: [
                `pages/student/student.css?v=${ROLE_RESOURCE_VERSION}`,
                `shared/css/role-workbench-overview.css?v=${ROLE_WORKBENCH_OVERVIEW_VERSION}`
            ],
            resources: [
                `shared/js/role-workbench-overview.js?v=${ROLE_WORKBENCH_OVERVIEW_VERSION}`,
                `shared/js/role-workbench-bridge.js?v=${ROLE_WORKBENCH_OVERVIEW_VERSION}`
            ],
            script: `pages/student/student-workbench.js?v=${ROLE_RESOURCE_VERSION}&patch=20260828v866StudentProjectionP0`,
            ready: 'initStudent',
            enter: 'initStudent',
            leave: 'destroyStudent'
        }),
        teacher: definePage({
            galaxy: 'astra',
            roles: ['teacher', 'admin'],
            styles: [
                `pages/teacher/teacher-foundation.css?v=${TEACHER_RESOURCE_VERSION}`,
                `pages/teacher/teacher-workbench.css?v=${TEACHER_RESOURCE_VERSION}`,
                `pages/teacher/teacher-curriculum.css?v=${TEACHER_RESOURCE_VERSION}`,
                `pages/teacher/teacher-course-authoring.css?v=${TEACHER_RESOURCE_VERSION}`,
                `shared/css/role-workbench-overview.css?v=${ROLE_WORKBENCH_OVERVIEW_VERSION}`
            ],
            resources: [
                `pages/teacher/teacher-course-authoring.js?v=${TEACHER_RESOURCE_VERSION}`, `pages/teacher/teacher-course-grading.js?v=${TEACHER_RESOURCE_VERSION}`,
                `shared/js/role-workbench-overview.js?v=${ROLE_WORKBENCH_OVERVIEW_VERSION}`,
                `shared/js/role-workbench-bridge.js?v=${ROLE_WORKBENCH_OVERVIEW_VERSION}`
            ],
            script: `pages/teacher/teacher.js?v=${TEACHER_RESOURCE_VERSION}`,
            ready: 'initTeacher',
            enter: 'initTeacher',
            leave: 'destroyTeacher'
        }),
        admin: definePage({
            galaxy: 'astra',
            roles: ['admin'],
            styles: [
                `pages/admin/admin.css?v=${ADMIN_RESOURCE_VERSION}`,
                `shared/css/role-workbench-overview.css?v=${ROLE_WORKBENCH_OVERVIEW_VERSION}`
            ],
            resources: [
                `shared/js/role-workbench-overview.js?v=${ROLE_WORKBENCH_OVERVIEW_VERSION}`,
                `shared/js/role-workbench-bridge.js?v=${ROLE_WORKBENCH_OVERVIEW_VERSION}`
            ],
            script: `pages/admin/admin.js?v=${ADMIN_RESOURCE_VERSION}`,
            ready: 'initAdmin',
            enter: 'initAdmin',
            leave: 'destroyAdmin'
        }),
        frontier: definePage({
            galaxy: 'frontier',
            tags: ['frontier'],
            styles: [`pages/frontier/frontier.css?v=${FUTURE_RESOURCE_VERSION}`],
            script: `shared/js/frontier-learning.js?v=${FUTURE_RESOURCE_VERSION}`,
            ready: 'initFrontierCourse',
            enter: 'initFrontierCourse',
            leave: 'destroyFrontierCourse'
        }),
        cosmos: definePage({
            galaxy: 'frontier',
            tags: ['frontier'],
            styles: [`pages/frontier/frontier.css?v=${FUTURE_RESOURCE_VERSION}`],
            script: `shared/js/frontier-learning.js?v=${FUTURE_RESOURCE_VERSION}`,
            ready: 'initFrontierCourse',
            enter: 'initFrontierCourse',
            leave: 'destroyFrontierCourse'
        }),
        engineering: definePage({
            galaxy: 'frontier',
            tags: ['frontier'],
            styles: [`pages/engineering/engineering.css?v=${FUTURE_RESOURCE_VERSION}`, 'pages/engineering/robot-arm-ik/styles.css?v=20260825v834Show04P0'],
            script: 'pages/engineering/engineering-page.js?v=20260825v834Show04P0',
            ready: 'initEngineeringPage',
            enter: 'initEngineeringPage',
            leave: 'destroyEngineeringPage'
        }),
        datascience: definePage({
            galaxy: 'frontier',
            tags: ['frontier'],
            styles: [`pages/frontier/frontier.css?v=${FUTURE_RESOURCE_VERSION}`],
            script: `shared/js/frontier-learning.js?v=${FUTURE_RESOURCE_VERSION}`,
            ready: 'initFrontierCourse',
            enter: 'initFrontierCourse',
            leave: 'destroyFrontierCourse'
        }),
        infotech: definePage({
            galaxy: 'frontier',
            tags: ['frontier'],
            styles: [`pages/frontier/frontier.css?v=${FUTURE_RESOURCE_VERSION}`],
            script: `shared/js/frontier-learning.js?v=${FUTURE_RESOURCE_VERSION}`,
            ready: 'initFrontierCourse',
            enter: 'initFrontierCourse',
            leave: 'destroyFrontierCourse'
        }),
        materials: definePage({
            galaxy: 'frontier',
            tags: ['frontier'],
            styles: [`pages/frontier/frontier.css?v=${FUTURE_RESOURCE_VERSION}`],
            script: `shared/js/frontier-learning.js?v=${FUTURE_RESOURCE_VERSION}`,
            ready: 'initFrontierCourse',
            enter: 'initFrontierCourse',
            leave: 'destroyFrontierCourse'
        }),
        humanities: definePage({
            galaxy: 'frontier',
            tags: ['frontier'],
            styles: [`pages/frontier/frontier.css?v=${FUTURE_RESOURCE_VERSION}`],
            script: `shared/js/frontier-learning.js?v=${FUTURE_RESOURCE_VERSION}`,
            ready: 'initFrontierCourse',
            enter: 'initFrontierCourse',
            leave: 'destroyFrontierCourse'
        }),
        license: definePage({
            galaxy: 'englab',
            script: `pages/about/about.js?v=${ABOUT_RESOURCE_VERSION}`,
            ready: 'initLicense',
            enter: 'initLicense'
        }),
        changelog: definePage({
            galaxy: 'englab',
            script: `pages/about/about.js?v=${ABOUT_RESOURCE_VERSION}`,
            ready: 'initChangelog',
            enter: 'initChangelog'
        })
    });
    const pageNames = Object.freeze(Object.keys(definitions));

    const get = (page) => definitions[page] || null;
    const hasTag = (page, tag) => {
        const definition = get(page);
        return !!definition && definition.tags.includes(tag);
    };
    const resourcesForRole = (role) => Array.from(new Set(pageNames.flatMap((page) => {
        const definition = get(page);
        if (!definition || !definition.roles.includes(role)) return [];
        return definition.styles.concat(definition.resources, definition.script ? [definition.script] : []);
    })));
    const invokeHook = (page, hook) => {
        const definition = get(page);
        const hookName = definition && definition[hook];
        if (!hookName) return false;
        const handler = global[hookName];
        if (typeof handler === 'function') handler();
        return true;
    };

    const registry = Object.freeze({
        get,
        has: (page) => !!get(page),
        pages: () => pageNames.slice(),
        pagesByTag: (tag) => pageNames.filter((page) => hasTag(page, tag)),
        hasTag,
        galaxyFor: (page) => {
            const definition = get(page);
            return definition ? definition.galaxy : 'englab';
        },
        scriptFor: (page) => {
            const definition = get(page);
            return definition ? definition.script : null;
        },
        stylesFor: (page) => {
            const definition = get(page);
            return definition ? definition.styles.slice() : [];
        },
        rolesFor: (page) => {
            const definition = get(page);
            return definition ? definition.roles.slice() : [];
        },
        stylesForRole: (role) => Array.from(new Set(pageNames.flatMap((page) => {
            const definition = get(page);
            return definition && definition.roles.includes(role) ? definition.styles : [];
        }))),
        resourcesForRole: (role) => resourcesForRole(String(role || '')).slice(),
        allRoleResources: () => Array.from(new Set(
            pageNames.flatMap((page) => {
                const definition = get(page);
                if (!definition || !definition.roles.length) return [];
                return definition.styles.concat(definition.resources, definition.script ? [definition.script] : []);
            })
        )),
        isReady: (page) => {
            const definition = get(page);
            const hookName = definition && definition.ready;
            return !hookName || typeof global[hookName] === 'function';
        },
        enter: (page) => invokeHook(page, 'enter'),
        leave: (page) => invokeHook(page, 'leave')
    });

    Object.defineProperty(global, 'AstraPageRegistry', {
        value: registry,
        configurable: false,
        enumerable: true,
        writable: false
    });
})(window);
