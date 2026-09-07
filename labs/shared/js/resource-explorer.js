/* Loaded only by the generated public-resource package, before main.js. */
(function installResourceExplorer(global) {
    'use strict';
    const enabled = Boolean(document.querySelector('meta[name="astra-resource-explorer"][content="public"]'));
    global.AstraResourceExplorer = Object.freeze({
        start(initialize) {
            if (!enabled) return false;
            const count = global.AstraLearningActivityCatalog.entries().filter(item => item.galaxy_key === 'englab').length;
            const heading = document.querySelector('.home-heading__eyebrow');
            if (heading) heading.textContent = `Engineering Lab · ${count} Experiments`;
            initialize();
            return true;
        },
        guardRoute(route) {
            if (!enabled || !global.AstraPageRegistry.rolesFor(route.page).length) return route;
            return { page: 'home', moduleId: null, anchorId: null };
        }
    });
})(window);
