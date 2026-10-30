// ===== Engineering Applications: independent experiment route owner =====
(function attachEngineeringPage(global) {
    'use strict';

    if (global.EngineeringPage) return;

    const ROBOT_ROUTE = 'engineering/robot-arm-ik';
    const VIEW_BRIDGE = 'bridge-truss';
    const VIEW_ROBOT = 'robot-arm-ik';
    const resources = Object.freeze({
        [VIEW_BRIDGE]: Object.freeze({
            src: 'pages/engineering/bridge-truss.js?v=20260824v816ExperimentRestoreP2',
            ready: 'initBridgeTruss',
            destroy: 'destroyBridgeTruss'
        }),
        [VIEW_ROBOT]: Object.freeze({
            src: 'pages/engineering/robot-arm-ik/index.js?v=20260825v834Show04P0',
            ready: 'initRobotArmIk',
            destroy: 'destroyRobotArmIk'
        })
    });

    const scriptPromises = new Map();
    let active = false;
    let currentView = null;
    let generation = 0;
    let routeEvents = null;

    function routeValue() {
        return String(global.location?.hash || '').replace(/^#/, '');
    }

    function requestedView() {
        return routeValue() === ROBOT_ROUTE ? VIEW_ROBOT : VIEW_BRIDGE;
    }

    function pageRoot() {
        return global.document?.getElementById('page-engineering') || null;
    }

    function setViewVisibility(view) {
        const page = pageRoot();
        if (!page) return;
        const showRobot = view === VIEW_ROBOT;
        const hero = page.querySelector(':scope > .frontier-hero');
        const bridge = page.querySelector(':scope > .engineering-shell');
        const robot = page.querySelector('[data-engineering-view="robot-arm-ik"]');

        if (hero) hero.hidden = showRobot;
        if (bridge) bridge.hidden = showRobot;
        if (robot) robot.hidden = !showRobot;
        page.classList.toggle('engineering-page--robot-arm-ik', showRobot);
    }

    function loadScript(view) {
        const resource = resources[view];
        if (!resource) return Promise.reject(new Error(`Unknown engineering view: ${view}`));
        if (typeof global[resource.ready] === 'function') return Promise.resolve();
        if (scriptPromises.has(resource.src)) return scriptPromises.get(resource.src);

        const promise = new Promise((resolve, reject) => {
            const plainSrc = resource.src.split('?')[0];
            const existing = Array.from(global.document?.scripts || []).find((script) => {
                const current = script.getAttribute('src') || '';
                return current === resource.src || current.split('?')[0] === plainSrc;
            });
            const script = existing || global.document.createElement('script');
            const finish = () => {
                if (typeof global[resource.ready] !== 'function') {
                    reject(new Error(`Engineering runtime did not expose ${resource.ready}`));
                    return;
                }
                resolve();
            };

            if (existing && typeof global[resource.ready] === 'function') {
                finish();
                return;
            }
            if (!existing) {
                script.src = resource.src;
                script.async = true;
                script.dataset.engineeringRuntime = view;
                global.document.body.appendChild(script);
            }
            script.addEventListener('load', finish, { once: true });
            script.addEventListener('error', () => {
                scriptPromises.delete(resource.src);
                reject(new Error(`Failed to load engineering runtime: ${resource.src}`));
            }, { once: true });
        });
        scriptPromises.set(resource.src, promise);
        return promise;
    }

    function destroyCurrent() {
        if (!currentView) return;
        const destroyName = resources[currentView]?.destroy;
        if (destroyName && typeof global[destroyName] === 'function') {
            try { global[destroyName](); } catch (error) {
                console.warn('[EngineeringPage] cleanup failed:', currentView, error);
            }
        }
        currentView = null;
    }

    async function activateRequestedView(options = {}) {
        if (!active) return false;
        const nextView = requestedView();
        if (nextView === currentView) return true;
        const requestGeneration = ++generation;
        destroyCurrent();
        setViewVisibility(nextView);

        try {
            await loadScript(nextView);
            if (!active || requestGeneration !== generation || requestedView() !== nextView) return false;
            const initName = resources[nextView].ready;
            const initialized = global[initName]();
            if (initialized === false) throw new Error(`${initName} could not mount its view`);
            currentView = nextView;
            if (options.resetScroll !== false) global.scrollTo?.({ top: 0, behavior: 'auto' });
            return true;
        } catch (error) {
            if (active && requestGeneration === generation) {
                console.warn('[EngineeringPage] view activation failed:', nextView, error);
            }
            return false;
        }
    }

    function init() {
        active = true;
        generation += 1;
        routeEvents?.abort();
        routeEvents = new AbortController();
        global.addEventListener('hashchange', () => activateRequestedView(), { signal: routeEvents.signal });
        return activateRequestedView({ resetScroll: false });
    }

    function destroy() {
        active = false;
        generation += 1;
        routeEvents?.abort();
        routeEvents = null;
        destroyCurrent();
        setViewVisibility(VIEW_BRIDGE);
    }

    const EngineeringPage = Object.freeze({
        init,
        destroy,
        route: ROBOT_ROUTE,
        snapshot: () => Object.freeze({
            active,
            current_view: currentView,
            requested_view: requestedView(),
            generation
        })
    });

    global.EngineeringPage = EngineeringPage;
    global.initEngineeringPage = () => EngineeringPage.init();
    global.destroyEngineeringPage = () => EngineeringPage.destroy();
})(window);
