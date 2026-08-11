// ===== Main Application Bootstrap =====

function initApp() {
    if (window.AstraApiClient && typeof window.AstraApiClient.scrubLegacyTokens === 'function') {
        window.AstraApiClient.scrubLegacyTokens();
    }
    if (window.__loadProgress) window.__loadProgress(30);

    // 1. Initialize module selector (gallery-based navigation per subject page)
    if (typeof ModuleSelector !== 'undefined') ModuleSelector.init();

    // 1b. Initialize experiment guide system
    if (typeof ExperimentGuide !== 'undefined') ExperimentGuide.init();

    // 1d. Initialize experiment export system (E-03)
    if (typeof ExperimentExport !== 'undefined') ExperimentExport.init();

    // 1d2. Initialize quiz system (X-02)
    if (typeof ExperimentQuiz !== 'undefined') ExperimentQuiz.init();

    // 1d3. Initialize favorites system
    if (typeof ExperimentFavorites !== 'undefined') ExperimentFavorites.init();

    // 1d4. Initialize rating system
    if (typeof ExperimentRating !== 'undefined') ExperimentRating.init();

    // 1e. Initialize learning progress system (X-01)
    if (typeof LearningProgress !== 'undefined') LearningProgress.init();

    // 1f. v5.0: theme switch 已移除（仅保留暗色主题）

    // 1g. Initialize global search (v4.5-α1)
    if (typeof GlobalSearch !== 'undefined') GlobalSearch.init();

    // 1h. Initialize keyboard shortcuts (v4.5-α2)
    if (typeof KeyboardShortcuts !== 'undefined') KeyboardShortcuts.init();

    // 1i. Render future-galaxy learning frames from CONFIG.learningDesign
    if (typeof FrontierLearning !== 'undefined') {
        const frontierPage = (location.hash || '').slice(1).split('/')[0];
        FrontierLearning.init(frontierPage);
    }

    // 2. Homepage init moved to Router.onPageEnter('home') for lazy loading

    // 3. All experiment module inits moved to Router.onPageEnter() for lazy loading
    //    Modules are initialized only when their page is navigated to,
    //    and destroyed via Router.onPageLeave() when navigating away.

    // 4. Initialize scroll animation system
    if (typeof initScrollAnimations === 'function') initScrollAnimations();

    // 5. Render Lucide icons — lucide is now served locally (shared/js/lucide.min.js)
    //    so this is synchronous and reliable. CDN fallback script in index.html handles
    //    the rare edge case where the local file fails.
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    } else {
        // lucide CDN fallback may still be loading — retry after a tick
        setTimeout(function() {
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }, 500);
    }

    if (window.__loadProgress) window.__loadProgress(50);

    // 6. Initialize router (page transitions — triggers initHome for homepage)
    //    FIXED: Router.init() now always calls onPageEnter for the initial page,
    //    so initHome() runs on first load instead of requiring a re-navigation.
    Router.init();

    // 7. Speed slider for bucket sort
    const speedInput = document.getElementById('sort-speed');
    if (speedInput) {
        speedInput.addEventListener('input', (e) => {
            const newSpeed = parseInt(e.target.value);
            window.sortSpeed = newSpeed;
            if (typeof sortSpeed !== 'undefined') {
                sortSpeed = newSpeed;
            }
            const speedValueEl = document.getElementById('speed-value');
            if (speedValueEl) {
                speedValueEl.textContent = newSpeed + 'ms';
            }
        });
    }

    // 8. Nav indicator initial position
    requestAnimationFrame(() => {
        const activeNav = document.querySelector('.nav-item.active');
        if (activeNav && Router.moveIndicator) {
            Router.moveIndicator(activeNav);
        }
    });

    // 9. Window resize: update nav indicator
    window.addEventListener('resize', () => {
        const activeNav = document.querySelector('.nav-item.active');
        if (activeNav && Router.moveIndicator) {
            Router.moveIndicator(activeNav);
        }
    });

    // 10. Back to top button
    initBackToTop();

    // 11. Footer visibility based on current page
    updateFooterVisibility();

    // 12. Dismiss loading screen
    //     FIXED: _coreReady() no longer requires lucide (it's now local/sync).
    //     We only require GSAP and Router to be initialized before dismissing.
    //     This prevents the loading bar from being "stuck" due to CDN delays.
    if (window.__loadProgress) window.__loadProgress(70);

    var _loadDismissed = false;
    function _dismissLoadingScreen() {
        if (_loadDismissed) return;
        _loadDismissed = true;
        if (window.__loadProgress) window.__loadProgress(100);
        requestAnimationFrame(function () {
            if (typeof window.__dismissEnglabLoading === 'function') {
                window.__dismissEnglabLoading();
            }
            delete window.__loadProgress;
        });
    }

    // Core readiness check: Router is the only hard dependency.
    // Animation libraries are progressive enhancement and must not block boot.
    function _coreReady() {
        return typeof Router !== 'undefined' &&
               Router._initialEnterFired;
    }

    var _isReturningVisitor = !!(window.__englabCache && window.__englabCache.returnVisitor);
    var _pollLimit = _isReturningVisitor ? 5 : 10;
    var _pollDelay = _isReturningVisitor ? 60 : 90;
    var _fallbackDelay = _isReturningVisitor ? 900 : 1800;

    if (_coreReady()) {
        // Already initialized (e.g. cached resources) — dismiss after a single frame
        requestAnimationFrame(_dismissLoadingScreen);
    } else {
        // Poll briefly for core readiness (deferred scripts may still be executing)
        var _pollCount = 0;
        var _pollTimer = setInterval(function () {
            _pollCount++;
            if (window.__loadProgress) window.__loadProgress(Math.min((_isReturningVisitor ? 82 : 72) + _pollCount * 4, 95));
            if (_coreReady() || _pollCount >= _pollLimit) {
                clearInterval(_pollTimer);
                requestAnimationFrame(_dismissLoadingScreen);
            }
        }, _pollDelay);
    }

    // Hard safety fallback: repeat visits should dismiss much faster
    setTimeout(function () {
        if (!_loadDismissed) _dismissLoadingScreen();
    }, _fallbackDelay);
}

// ===== Back to Top =====
function initBackToTop() {
    const btn = document.getElementById('back-to-top');
    if (!btn) return;

    window.addEventListener('scroll', () => {
        if (window.scrollY > 400) {
            btn.classList.add('visible');
        } else {
            btn.classList.remove('visible');
        }
    }, { passive: true });

    btn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

// ===== Footer Visibility =====
function updateFooterVisibility() {
    const footer = document.getElementById('site-footer');
    const frontierFooter = document.getElementById('frontier-footer');
    if (!footer && !frontierFooter) return;

    const frontierPages = new Set(['frontier', 'cosmos', 'engineering', 'datascience', 'infotech', 'materials', 'humanities']);
    const sync = () => {
        const active = document.querySelector('.page.active');
        const page = active && active.id ? active.id.replace(/^page-/, '') : 'planets';
        const showFrontier = frontierPages.has(page) && page !== 'frontier';
        const galaxy = window.AstraPageRegistry && typeof window.AstraPageRegistry.galaxyFor === 'function'
            ? window.AstraPageRegistry.galaxyFor(page)
            : null;
        const showEnglab = galaxy === 'englab' && page !== 'home';
        if (footer) footer.style.display = showEnglab ? '' : 'none';
        if (frontierFooter) {
            frontierFooter.hidden = !showFrontier;
            frontierFooter.classList.toggle('is-visible', showFrontier);
        }
    };

    // Hide or switch footers according to the active galaxy shell.
    const observer = new MutationObserver(() => {
        sync();
    });

    observer.observe(document.querySelector('.main-content'), {
        childList: false,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
    });

    // Initial check
    sync();
}

window.updateFooterVisibility = updateFooterVisibility;

const ENGLAB_ASSET_VERSION = '20260731v7969StudentUiP0';
const ROLE_LANDING_ASSET_VERSION = '20260731v7969StudentUiP0';
const SESSION_STYLE_ASSET_VERSION = '20260719v759A11yP0';
const SHELL_RUNTIME_ASSET_VERSION = '20260812v815ShowcaseP0';
const PAGE_REGISTRY_ASSET_VERSION = '20260812v815ShowcaseP0';
const BASE_STYLE_ASSET_VERSION = '20260719v758ReleaseAuditP0';
const CORE_HTTP_FALLBACK_ASSETS = [
    './',
    './index.html',
    './shared/css/tokens.css?v=20260424ss',
    './shared/css/base.css?v=' + BASE_STYLE_ASSET_VERSION,
    './shared/css/typography.css?v=20260526v61c',
    './shared/css/navbar.css?v=' + ENGLAB_ASSET_VERSION,
    './shared/css/page-layout.css?v=' + ENGLAB_ASSET_VERSION,
    './shared/css/responsive.css?v=' + ENGLAB_ASSET_VERSION,
    './shared/js/lucide.min.js?v=20260417d',
    './shared/js/config.js?v=' + ENGLAB_ASSET_VERSION,
    './shared/js/api-client.js?v=' + ROLE_LANDING_ASSET_VERSION,
    './shared/js/app-session.js?v=' + SHELL_RUNTIME_ASSET_VERSION,
    './shared/js/experiment-registry.js?v=' + SHELL_RUNTIME_ASSET_VERSION,
    './shared/js/page-registry.js?v=' + PAGE_REGISTRY_ASSET_VERSION,
    './shared/js/router.js?v=' + SHELL_RUNTIME_ASSET_VERSION,
    './shared/js/main.js?v=' + SHELL_RUNTIME_ASSET_VERSION,
    './shared/js/backend-content.js?v=' + ENGLAB_ASSET_VERSION,
    './shared/css/backend-content.css?v=' + ENGLAB_ASSET_VERSION,
    './shared/css/auth-ui.css?v=' + ENGLAB_ASSET_VERSION,
    './shared/css/app-session.css?v=' + SESSION_STYLE_ASSET_VERSION
];

const GALAXY_HTTP_FALLBACK_ASSETS = {
    astra: [
        './pages/planets/planets.css?v=' + ROLE_LANDING_ASSET_VERSION,
        './pages/planets/planets.js?v=' + ROLE_LANDING_ASSET_VERSION
    ],
    englab: [
        './shared/css/module-selector.css?v=20260731v7969StudentUiP0',
        './shared/css/experiment-guide.css?v=20260630mainV64',
        './shared/css/experiment-export.css?v=20260424v44a',
        './shared/css/experiment-quiz.css?v=20260422z',
        './shared/css/experiment-favorites.css?v=20260424oo',
        './shared/css/experiment-rating.css?v=20260422z',
        './shared/css/experiment-polish.css?v=20260526v61c',
        './pages/home/home.css?v=20260715v7420HomeViewportClipP1',
        './pages/mathematics/mathematics.css?v=20260618mathModelP1',
        './pages/physics/physics.css?v=20260812v814FlagshipMotionP0',
        './pages/chemistry/chemistry.css?v=20260618ionP1',
        './pages/algorithms/algorithms.css?v=20260618algoTextP1',
        './pages/biology/biology.css?v=20260618neuralP1',
        './shared/js/module-selector.js?v=' + SHELL_RUNTIME_ASSET_VERSION,
        './shared/js/scroll-animations.js?v=20260731v7969StudentUiP0',
        './shared/js/experiment-guide.js?v=20260716v7427RoleWorkflowGateP0',
        './shared/js/experiment-export.js?v=20260528v61f',
        './shared/js/quiz-data.js?v=20260618refsP1',
        './shared/js/experiment-quiz.js?v=20260606fix1',
        './shared/js/experiment-favorites.js?v=20260423q',
        './shared/js/experiment-rating.js?v=20260418g',
        './shared/js/global-search.js?v=20260731v7969StudentUiP0',
        './shared/js/keyboard-shortcuts.js?v=20260424v45b',
        './shared/js/related-experiments.js?v=20260424v45c',
        './pages/home/home.js?v=20260704qianduanV70'
    ],
    frontier: [
        './pages/frontier/frontier.css?v=20260812v814FlagshipMotionP0',
        './pages/frontier/frontier-manifest.js?v=20260809v804FutureEvidenceP0',
        './shared/js/frontier-publication-context.js?v=20260809v804FutureEvidenceP0',
        './shared/js/frontier-learning.js?v=20260812v814FlagshipMotionP0'
    ]
};

function getFallbackGalaxy() {
    if (typeof Router !== 'undefined' && typeof Router.getActiveGalaxy === 'function') {
        return Router.getActiveGalaxy();
    }
    if (window.__astraBoot && window.__astraBoot.galaxy) return window.__astraBoot.galaxy;
    const hash = (window.location.hash || '#planets').slice(1).split('/')[0];
    if (window.AstraPageRegistry && typeof window.AstraPageRegistry.galaxyFor === 'function') {
        return window.AstraPageRegistry.galaxyFor(hash);
    }
    return hash === 'planets' ? 'astra' : 'englab';
}

function getFallbackAssetsForGalaxy(galaxy) {
    const group = GALAXY_HTTP_FALLBACK_ASSETS[galaxy] || GALAXY_HTTP_FALLBACK_ASSETS.astra;
    return Array.from(new Set(CORE_HTTP_FALLBACK_ASSETS.concat(group)));
}

function updateCacheDiagnostics(patch) {
    window.__englabCache = window.__englabCache || {};
    Object.assign(window.__englabCache, patch || {});
    try {
        const raw = JSON.parse(window.localStorage && window.localStorage.getItem('englab-cache-diagnostics') || '{}');
        const next = Object.assign(raw, patch || {}, { updatedAt: Date.now() });
        if (window.localStorage) {
            window.localStorage.setItem('englab-cache-diagnostics', JSON.stringify(next));
        }
    } catch (_) {}
}

function warmHttpCacheFallback(galaxy) {
    const targetGalaxy = galaxy || getFallbackGalaxy();
    const assets = getFallbackAssetsForGalaxy(targetGalaxy);
    updateCacheDiagnostics({
        cacheMode: 'http-fallback',
        transport: 'browser-http-cache',
        swRegistered: false,
        warmedGalaxy: targetGalaxy
    });

    const runWarmup = function () {
        Promise.all(assets.map(function (url) {
            return fetch(url, {
                credentials: 'same-origin',
                cache: 'force-cache'
            }).then(function (response) {
                return response && response.ok ? response.url : null;
            }).catch(function () {
                return null;
            });
        })).then(function (results) {
            const warmedUrls = results.filter(Boolean);
            updateCacheDiagnostics({
                warmedAssetCount: warmedUrls.length,
                warmedAssetUrls: warmedUrls.slice(0, 12),
                warmedGalaxy: targetGalaxy,
                lastWarmupAt: Date.now()
            });
        });
    };

    if (window.requestIdleCallback) {
        window.requestIdleCallback(runWarmup, { timeout: 1500 });
    } else {
        setTimeout(runWarmup, 500);
    }
}

window.warmGalaxyCache = function (galaxy) {
    if (!galaxy) return;
    const cacheMode = window.__englabCache && window.__englabCache.cacheMode;
    if (cacheMode === 'service-worker' || cacheMode === 'service-worker-pending') return;
    if (!window.__warmedGalaxies) window.__warmedGalaxies = {};
    if (window.__warmedGalaxies[galaxy]) return;
    window.__warmedGalaxies[galaxy] = true;
    warmHttpCacheFallback(galaxy);
};

function registerServiceWorker() {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;

    const hostname = location.hostname;
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    let forcedMode = null;
    try {
        forcedMode = new URLSearchParams(location.search).get('cacheMode') ||
            (window.localStorage && window.localStorage.getItem('englab-force-cache-mode'));
    } catch (_) {}

    const supportsSW = 'serviceWorker' in navigator;
    const forcedServiceWorker = forcedMode === 'service-worker' || forcedMode === 'sw';
    const canUseSW = supportsSW &&
        (window.isSecureContext || isLocalhost) &&
        forcedMode !== 'fallback' &&
        (!isLocalhost || forcedServiceWorker);

    updateCacheDiagnostics({
        origin: location.origin,
        protocol: location.protocol,
        secureContext: !!window.isSecureContext,
        supportsSW: supportsSW,
        cacheMode: canUseSW ? 'service-worker-pending' : 'http-fallback'
    });

    if (isLocalhost && supportsSW && !forcedServiceWorker) {
        updateCacheDiagnostics({
            cacheMode: 'http-fallback',
            transport: 'browser-http-cache',
            swRegistered: false,
            swDisabledForLocalhost: true
        });

        navigator.serviceWorker.getRegistrations()
            .then(function (registrations) {
                return Promise.all(registrations.map(function (registration) {
                    return registration.unregister();
                }));
            })
            .then(function (results) {
                updateCacheDiagnostics({
                    swUnregisteredForLocalhost: results.some(Boolean)
                });
            })
            .catch(function (error) {
                updateCacheDiagnostics({
                    swUnregisterError: String(error && error.message ? error.message : error)
                });
            })
            .finally(function () {
                warmHttpCacheFallback();
            });
        return;
    }

    if (!canUseSW) {
        warmHttpCacheFallback();
        return;
    }

    const doRegister = function () {
        navigator.serviceWorker.register('./sw.js?v=' + SHELL_RUNTIME_ASSET_VERSION)
            .then(function (registration) {
                updateCacheDiagnostics({
                    cacheMode: 'service-worker',
                    transport: 'cache-storage',
                    swRegistered: true,
                    swScope: registration.scope,
                    controller: !!navigator.serviceWorker.controller
                });
                if (navigator.serviceWorker.ready) {
                    navigator.serviceWorker.ready.then(function () {
                        updateCacheDiagnostics({
                            swReady: true,
                            controller: !!navigator.serviceWorker.controller
                        });
                    }).catch(function () {});
                }
            })
            .catch(function (error) {
                updateCacheDiagnostics({
                    cacheMode: 'http-fallback',
                    transport: 'browser-http-cache',
                    swRegistered: false,
                    swError: String(error && error.message ? error.message : error)
                });
                warmHttpCacheFallback();
            });
    };

    if (forcedServiceWorker) {
        doRegister();
    } else if (window.requestIdleCallback) {
        window.requestIdleCallback(doRegister, { timeout: 1200 });
    } else {
        setTimeout(doRegister, 400);
    }
}

// Launch immediately — DOM is ready (sync script at bottom of body).
// Do NOT use DOMContentLoaded: deferred experiment scripts would delay it.
(async function bootstrapApplication() {
    if (!window.AstraApplicationSession) {
        console.error('[App] session coordinator is unavailable');
        return;
    }
    try {
        // Register only the public shell while the authentication gate is active.
        // Router and all role resources still wait for the server session below.
        registerServiceWorker();
        await window.AstraApplicationSession.bootstrap();
        if (window.AstraStudentCourseCatalogue && typeof window.AstraStudentCourseCatalogue.refresh === 'function') {
            await window.AstraStudentCourseCatalogue.refresh(window.AstraApplicationSession.getUser());
        }
        initApp();
    } catch (error) {
        console.error('[App] authentication bootstrap failed', error);
    }
})();
