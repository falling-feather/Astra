// ===== Router: GSAP Page Transitions =====
const Router = {
    overlay: null,
    currentPage: 'planets',
    isTransitioning: false,
    _initialEnterFired: false,
    _queuedNavigation: null,
    _pageEnterComplete: true,
    _runningTimeId: null,
    _hashReconcileId: null,
    _pendingModule: null,
    _pendingModuleGeneration: 0,
    _pendingAnchor: null,
    _lastAppliedAnchor: null,
    _anchorScrollGeneration: 0,
    _anchorScrollTimers: [],
    _pageScriptPromises: {},
    _galaxySupportPromises: {},
    frontierPages: window.AstraPageRegistry.pagesByTag('frontier'),
    coursePages: window.AstraPageRegistry.pagesByTag('course'),
    _activeGalaxy: null,
    _galaxyCacheKey: 'astra-galaxy-cache-meta',
    _galaxyCacheVersion: '20260704qianduanV70',
    courseSupportScripts: [
        'shared/js/lucide.min.js?v=20260417d',
        'shared/js/module-selector.js?v=20260812v825PhysicsBindOrderP0'
    ],
    galaxySupportScripts: {
        astra: [
            'shared/js/lucide.min.js?v=20260417d'
        ],
        englab: [
            'shared/js/lucide.min.js?v=20260417d',
            'shared/js/learning-progress.js?v=20260422a',
            'shared/js/back-to-top.js?v=20260424rr',
            'shared/js/fab-trigger.js?v=20260528v61g',
            'shared/js/touch-gestures.js?v=20260418a',
            'shared/js/scroll-animations.js?v=20260731v7969StudentUiP0',
            'shared/js/experiment-guide.js?v=20260716v7427RoleWorkflowGateP0',
            'shared/js/experiment-export.js?v=20260528v61f',
            'shared/js/quiz-data.js?v=20260618refsP1',
            'shared/js/experiment-quiz.js?v=20260606fix1',
            'shared/js/experiment-favorites.js?v=20260423q',
            'shared/js/experiment-rating.js?v=20260418g',
            'shared/js/global-search.js?v=20260731v7969StudentUiP0',
            'shared/js/keyboard-shortcuts.js?v=20260424v45b',
            'shared/js/related-experiments.js?v=20260424v45c'
        ],
        frontier: [
            'shared/js/lucide.min.js?v=20260417d',
            'shared/js/frontier-learning.js?v=20260812v814FlagshipMotionP0',
            'shared/js/scroll-animations.js?v=20260731v7969StudentUiP0'
        ]
    },
    transitionOrigin: { x: 50, y: 50 },

    init() {
        // Create transition overlay
        this.overlay = document.createElement('div');
        this.overlay.className = 'page-transition-overlay';
        document.body.appendChild(this.overlay);

        // Nav click delegation (intercept for animated transitions)
        document.querySelectorAll('.nav-item[data-page], .nav-logo[data-page]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const page = item.dataset.page;
                if (page) {
                    // If already on this page, reset to gallery view (back to experiment list)
                    if (page === this.currentPage && this._isActivePage(page)) {
                        this._pendingModule = null;
                        this._pendingAnchor = null;
                        this._lastAppliedAnchor = null;
                        if (page !== 'home' && typeof ModuleSelector !== 'undefined' && ModuleSelector.activeModule[page]) {
                            let closed = false;
                            try { closed = ModuleSelector.closeModule(page) === true; } catch (error) {}
                            if (!closed) {
                                this._restoreModuleRoute(page);
                                return;
                            }
                        }
                        if (window.location.hash.slice(1) !== page) {
                            history.pushState(null, '', `#${page}`);
                        }
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                        return;
                    }
                    this._pendingModule = page === 'student' && (this.coursePages.includes(this.currentPage) || (this.frontierPages.includes(this.currentPage) && this.currentPage !== 'frontier')) ? this.currentPage : null;
                    this._pendingAnchor = null;
                    this._lastAppliedAnchor = null;
                    // Use nav item center as transition origin
                    const rect = item.getBoundingClientRect();
                    this.transitionOrigin = {
                        x: ((rect.left + rect.width / 2) / window.innerWidth) * 100,
                        y: ((rect.top + rect.height / 2) / window.innerHeight) * 100
                    };
                    this.navigateTo(page, true);
                }
            });
        });

        // Initial state 鈥?determine page from hash
        const parsedInit = this._guardParsedRoute(this._parseHash());
        const initialPage = parsedInit.page;
        this.currentPage = initialPage;
        this._pendingModule = parsedInit.moduleId;
        this._pendingAnchor = parsedInit.anchorId || null;

        // Ensure the correct page has 'active' class (HTML defaults to planets v6.1.0-alpha5)
        if (initialPage !== 'planets') {
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            const initEl = document.getElementById(`page-${initialPage}`);
            if (initEl) initEl.classList.add('active');
        }
        this.updateNav(initialPage);

        // CRITICAL FIX: Always fire onPageEnter for the initial page.
        // Previously, handleHash() returned early when page-home already had .active
        // in HTML, so initHome() was never called on first load 鈥?causing the
        // satellite animation to never start until a re-navigation.
        this._initialEnterFired = true;
        // v5.0锛氬垵娆″姞杞斤紙鐗瑰埆鏄洿鎺ヨ繘鍏?#planets锛変篃闇€瑕佸悓姝ュ鑸爮鍙鎬э紝
        //       鍚﹀垯 HTML 榛樿鐨?.navbar--transparent 涓嶄細琚浛鎹负 .navbar--hidden銆?
        const initNavbar = document.getElementById('navbar');
        if (initNavbar) {
            const isFrontier = this._isFrontierPage(initialPage);
            initNavbar.classList.toggle('navbar--transparent', initialPage === 'home');
            initNavbar.classList.toggle('navbar--hidden', this._galaxyForPage(initialPage) === 'astra');
            initNavbar.classList.toggle('navbar--frontier', isFrontier);
        }
        this._toggleGalaxyFooters(initialPage);
        this._syncGalaxyRuntime(initialPage);
        this.onPageEnter(initialPage);

        // Show running time footer for non-home pages
        this._toggleRunningTime(this._usesEnglabFooter(initialPage));

        window.addEventListener('hashchange', () => this.handleHash());

        // Handle popstate (back/forward)
        window.addEventListener('popstate', () => this.handleHash());

        this._startHashReconcile();
    },

    /**
     * 瑙ｆ瀽 hash锛屾敮鎸?"subject/experiment" 娣遍摼鎺ヤ笌鏈潵鏄熺郴椤靛唴閿氱偣銆?
     * 杩斿洖 { page, moduleId, anchorId }锛宮oduleId 涓?anchorId 鍧囧彲涓虹┖銆?
     */
    _parseHash() {
        const raw = (window.location.hash || '').slice(1);
        if (!raw) return { page: 'planets', moduleId: null, anchorId: null };
        const anchorPage = this._pageForFrontierAnchor(raw);
        if (anchorPage) return { page: anchorPage, moduleId: null, anchorId: raw };
        const idx = raw.indexOf('/');
        if (idx === -1) return { page: raw, moduleId: null, anchorId: null };
        return { page: raw.slice(0, idx), moduleId: raw.slice(idx + 1) || null, anchorId: null };
    },

    _guardParsedRoute(parsed) {
        const route = parsed || { page: 'planets', moduleId: null, anchorId: null };
        const session = window.AstraApplicationSession;
        if (!session || typeof session.guardPage !== 'function') return route;
        const allowedPage = session.guardPage(route.page);
        if (allowedPage === route.page) return window.AstraStudentCourseCatalogue && typeof window.AstraStudentCourseCatalogue.guardRoute === 'function' ? window.AstraStudentCourseCatalogue.guardRoute(route, this.coursePages, this.frontierPages) : route;
        const guarded = { page: allowedPage, moduleId: null, anchorId: null };
        if (window.location.hash.slice(1) !== allowedPage) {
            history.replaceState(null, '', `#${allowedPage}`);
        }
        return guarded;
    },

    _restoreModuleRoute(page) {
        let activeModule = null;
        try {
            if (typeof ModuleSelector !== 'undefined' && ModuleSelector.activeModule) {
                activeModule = ModuleSelector.activeModule[page] || null;
            }
        } catch (error) {}
        const stableRoute = activeModule ? `${page}/${activeModule}` : page;
        if (window.location.hash.slice(1) !== stableRoute) {
            history.replaceState(null, '', `#${stableRoute}`);
        }
        return stableRoute;
    },

    _pageForFrontierAnchor(anchorId) {
        if (!anchorId || !anchorId.startsWith('frontier-')) return null;
        return this.frontierPages.find((page) => anchorId.startsWith(`frontier-${page}-`)) || null;
    },

    _galaxyForPage(page) {
        return window.AstraPageRegistry.galaxyFor(page);
    },

    getActiveGalaxy() {
        return this._activeGalaxy || this._galaxyForPage(this.currentPage);
    },

    _readCookieValue(name) {
        try {
            const prefix = `${encodeURIComponent(name)}=`;
            const item = document.cookie.split('; ').find((entry) => entry.startsWith(prefix));
            return item ? decodeURIComponent(item.slice(prefix.length)) : null;
        } catch (e) {
            return null;
        }
    },

    _writeCookieValue(name, value) {
        try {
            const maxAge = 60 * 60 * 24 * 180;
            document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
        } catch (e) {}
    },

    _readGalaxyCacheMeta() {
        const fallback = {
            version: this._galaxyCacheVersion,
            loadedGalaxies: {},
            visits: {}
        };
        try {
            const stored = window.localStorage && window.localStorage.getItem(this._galaxyCacheKey);
            const raw = JSON.parse(stored || this._readCookieValue(this._galaxyCacheKey) || '{}');
            if (raw.version !== this._galaxyCacheVersion) {
                return fallback;
            }
            raw.loadedGalaxies = raw.loadedGalaxies || {};
            raw.visits = raw.visits || {};
            return raw;
        } catch (e) {
            return fallback;
        }
    },

    _writeGalaxyCacheMeta(meta) {
        try {
            const value = JSON.stringify(meta);
            if (window.localStorage) {
                window.localStorage.setItem(this._galaxyCacheKey, value);
            }
            this._writeCookieValue(this._galaxyCacheKey, value);
        } catch (e) {}
    },

    _markGalaxyLoaded(galaxy, page) {
        const meta = this._readGalaxyCacheMeta();
        const now = Date.now();
        meta.lastGalaxy = galaxy;
        meta.lastPage = page;
        meta.updatedAt = now;
        meta.loadedGalaxies[galaxy] = {
            firstLoadedAt: meta.loadedGalaxies[galaxy] && meta.loadedGalaxies[galaxy].firstLoadedAt || now,
            lastLoadedAt: now
        };
        meta.visits[galaxy] = (meta.visits[galaxy] || 0) + 1;
        this._writeGalaxyCacheMeta(meta);
        window.__astraGalaxyCache = meta;
        if (typeof window.warmGalaxyCache === 'function') {
            window.warmGalaxyCache(galaxy);
        }
    },

    loadActiveGalaxySupport() {
        return this._loadGalaxySupport(this.getActiveGalaxy(), this.currentPage);
    },

    _loadGalaxySupport(galaxy, page) {
        try {
            if (new URLSearchParams(location.search).get('noDeferred') === '1') {
                return Promise.resolve();
            }
        } catch (e) {}

        const scripts = this.galaxySupportScripts[galaxy] || [];
        if (!scripts.length) {
            this._bootGalaxySupport(galaxy, page);
            return Promise.resolve();
        }

        if (!this._galaxySupportPromises[galaxy]) {
            this._galaxySupportPromises[galaxy] = scripts.reduce(
                (chain, src) => chain.then(() => this._loadScriptOnce(src, 'routerGalaxyScript', galaxy)),
                Promise.resolve()
            ).catch((error) => {
                delete this._galaxySupportPromises[galaxy];
                throw error;
            });
        }

        return this._galaxySupportPromises[galaxy].then(() => {
            this._bootGalaxySupport(galaxy, page);
        });
    },

    _bootGalaxySupport(galaxy) {
        const current = this.currentPage;
        if (this._galaxyForPage(current) !== galaxy) return;

        if (typeof lucide !== 'undefined') {
            try { lucide.createIcons(); } catch (e) {}
        }

        if (galaxy === 'englab') {
            if (typeof ExperimentGuide !== 'undefined') ExperimentGuide.init();
            if (typeof ExperimentExport !== 'undefined') ExperimentExport.init();
            if (typeof ExperimentQuiz !== 'undefined') ExperimentQuiz.init();
            if (typeof ExperimentFavorites !== 'undefined') ExperimentFavorites.init();
            if (typeof ExperimentRating !== 'undefined') ExperimentRating.init();
            if (typeof LearningProgress !== 'undefined') LearningProgress.init();
            if (typeof GlobalSearch !== 'undefined') GlobalSearch.init();
            if (typeof KeyboardShortcuts !== 'undefined') KeyboardShortcuts.init();

            const isCoursePage = this.coursePages.includes(current);
            if (typeof BackToTop !== 'undefined') {
                if (isCoursePage) BackToTop.show(); else BackToTop.hide();
            }
            if (typeof FabTrigger !== 'undefined') {
                if (isCoursePage) FabTrigger.show(); else FabTrigger.hide();
            }
            return;
        }

        if (galaxy === 'frontier') {
            if (typeof FrontierLearning !== 'undefined') FrontierLearning.init(current);
            if (typeof window.initScrollAnimations === 'function') window.initScrollAnimations();
            if (current !== 'home' && current !== 'planets' && typeof window.initPageScrollAnimations === 'function') {
                window.initPageScrollAnimations(current);
            }
            if (current !== 'home' && current !== 'planets' && typeof window.initHeroVisual === 'function') {
                window.initHeroVisual(current);
            }
            this._reapplyFrontierAnchorAfterRuntime(current);
        }
    },

    _reapplyFrontierAnchorAfterRuntime(page) {
        const parsed = this._guardParsedRoute(this._parseHash());
        if (parsed.page !== page || !parsed.anchorId) return;
        this._pendingAnchor = parsed.anchorId;
        this._scheduleAnchorScroll(() => {
            if (this.currentPage !== page || !this._isActivePage(page)) return;
            this._applyPendingAnchor();
        }, 40);
    },

    _cancelPendingAnchorScroll() {
        this._anchorScrollGeneration += 1;
        if (Array.isArray(this._anchorScrollTimers) && this._anchorScrollTimers.length) {
            this._anchorScrollTimers.splice(0).forEach((id) => {
                try { clearTimeout(id); } catch (e) {}
            });
        }
    },

    _scheduleAnchorScroll(handler, delay) {
        const id = setTimeout(() => {
            this._anchorScrollTimers = this._anchorScrollTimers.filter((item) => item !== id);
            handler();
        }, delay);
        this._anchorScrollTimers.push(id);
        return id;
    },

    _resetPageScroll() {
        try {
            const rootStyle = document.documentElement.style;
            const bodyStyle = document.body.style;
            const previousRootBehavior = rootStyle.scrollBehavior;
            const previousBodyBehavior = bodyStyle.scrollBehavior;
            const scroller = document.scrollingElement || document.documentElement;
            rootStyle.scrollBehavior = 'auto';
            bodyStyle.scrollBehavior = 'auto';
            window.scrollTo(0, 0);
            if (scroller) scroller.scrollTop = 0;
            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;
            rootStyle.scrollBehavior = previousRootBehavior;
            bodyStyle.scrollBehavior = previousBodyBehavior;
        } catch (e) {
            try { window.scrollTo(0, 0); } catch (ignored) {}
        }
    },

    _syncGalaxyRuntime(page) {
        const nextGalaxy = this._galaxyForPage(page);
        const previousGalaxy = this._activeGalaxy;
        if (previousGalaxy && previousGalaxy !== nextGalaxy) {
            this._unloadGalaxyRuntime(previousGalaxy, nextGalaxy);
        }
        this._activeGalaxy = nextGalaxy;
        document.documentElement.dataset.activeGalaxy = nextGalaxy;
        document.body.dataset.activeGalaxy = nextGalaxy;
        this._markGalaxyLoaded(nextGalaxy, page);
        this._loadGalaxySupport(nextGalaxy, page).catch((error) => {
            console.warn('[Router] galaxy support load failed:', nextGalaxy, error);
        });
    },

    _unloadGalaxyRuntime(previousGalaxy, nextGalaxy) {
        try {
            window.dispatchEvent(new CustomEvent('astra:galaxy-unload', {
                detail: { previousGalaxy, nextGalaxy }
            }));
        } catch (e) {}

        if (previousGalaxy === 'englab' && typeof ModuleSelector !== 'undefined' && ModuleSelector.activeModule) {
            this.coursePages.forEach((subject) => {
                if (ModuleSelector.activeModule[subject] && typeof ModuleSelector.closeModule === 'function') {
                    try {
                        ModuleSelector.closeModule(subject, {
                            preserveHash: true,
                            skipExperimentCleanup: true
                        });
                    } catch (e) {}
                }
            });
            try {
                if (typeof BackToTop !== 'undefined') BackToTop.hide();
                if (typeof FabTrigger !== 'undefined') FabTrigger.hide();
            } catch (e) {}
        }

        if (previousGalaxy === 'frontier') {
            if (typeof FrontierLearning !== 'undefined' && typeof FrontierLearning.destroy === 'function') {
                try { FrontierLearning.destroy(); } catch (e) {}
            }
            if (typeof destroyAllHeroVisuals === 'function') {
                try { destroyAllHeroVisuals(); } catch (e) {}
            }
        }
    },

    handleHash() {
        const parsed = this._guardParsedRoute(this._parseHash());
        const page = parsed.page;
        this._pendingModule = parsed.moduleId;
        this._pendingAnchor = parsed.anchorId || null;
        if (!this._pendingAnchor) {
            this._lastAppliedAnchor = null;
            this._cancelPendingAnchorScroll();
        }
        // 鍚?page 浣嗘繁閾炬帴鎴栭〉鍐呴敋鐐瑰彉鍖栵細鐩存帴澶勭悊锛屼笉閲嶈蛋杞満
        if (page === this.currentPage && this._isActivePage(page)) {
            if (this._pendingAnchor) {
                this._applyPendingAnchor();
                return;
            }
            this._applyPendingModule(page);
            return;
        }
        this.navigateTo(page, false);
    },

    navigateTo(page, animate = true) {
        const guarded = this._guardParsedRoute({ page, moduleId: this._pendingModule, anchorId: this._pendingAnchor });
        if (guarded.page !== page) {
            page = guarded.page;
            this._pendingModule = null;
            this._pendingAnchor = null;
        }
        if (this.isTransitioning) {
            this._queueNavigation(page, animate);
            return;
        }
        if (page === this.currentPage && this._isActivePage(page)) {
            if (this._pendingAnchor) this._applyPendingAnchor();
            return;
        }
        this.isTransitioning = true; // Set immediately to prevent race conditions
        this._cancelPendingAnchorScroll();

        const currentEl = document.querySelector('.page.active');
        const targetEl = document.getElementById(`page-${page}`);
        if (!targetEl) {
            this.isTransitioning = false;
            this._pageEnterComplete = true;
            this._flushQueuedNavigation();
            return;
        }
        this._pageEnterComplete = false;

        // Update hash without triggering hashchange
        // 淇濈暀鍙兘瀛樺湪鐨勬繁閾炬帴妯″潡鍚庣紑锛堝 #physics/momentum-conservation锛?
        const desiredHash = this._pendingAnchor || (this._pendingModule ? `${page}/${this._pendingModule}` : page);
        if (window.location.hash.slice(1) !== desiredHash) {
            history.pushState(null, '', `#${desiredHash}`);
        }

        // Update nav
        this.updateNav(page);

        // Update navbar visibility/transparency
        // v4.3锛歨ome 閫忔槑鍖栵紱v4.4锛歱lanets 澶у睆瀹屽叏闅愯棌椤舵爮锛堜綔涓虹洰褰曟壙杞芥洿娌夋蹈锛?
        const navbar = document.getElementById('navbar');
        if (navbar) {
            const isFrontier = this._isFrontierPage(page);
            navbar.classList.toggle('navbar--transparent', page === 'home');
            navbar.classList.toggle('navbar--hidden', this._galaxyForPage(page) === 'astra');
            navbar.classList.toggle('navbar--frontier', isFrontier);
        }
        this._toggleGalaxyFooters(page);

        // Toggle running time footer
        this._toggleRunningTime(this._usesEnglabFooter(page));

        const prevPage = currentEl && currentEl.id
            ? currentEl.id.replace(/^page-/, '')
            : this.currentPage;
        this.currentPage = page;

        // Cleanup previous page modules
        this.onPageLeave(prevPage);
        this._syncGalaxyRuntime(page);

        // Respect prefers-reduced-motion
        const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        const isDirectoryTransition = page === 'planets' || prevPage === 'planets';
        if (!animate || isDirectoryTransition || !currentEl || typeof gsap === 'undefined' || prefersReduced) {
            // No animation (initial load, no GSAP, or reduced motion)
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            targetEl.classList.add('active');
            this._resetPageScroll();
            this.onPageEnter(page);
            this._finishTransition();
            return;
        }

        // Determine accent color for overlay
        const colors = {
            mathematics: 'rgba(91,141,206,0.12)',
            physics: 'rgba(139,111,192,0.12)',
            chemistry: 'rgba(77,158,126,0.12)',
            algorithms: 'rgba(196,121,58,0.12)',
            biology: 'rgba(58,158,143,0.12)',
            student: 'rgba(67,201,141,0.12)',
            cosmos: 'rgba(116,185,255,0.12)',
            datascience: 'rgba(138,167,255,0.12)',
            infotech: 'rgba(94,224,216,0.12)',
            materials: 'rgba(224,181,106,0.12)',
            humanities: 'rgba(126,215,193,0.12)',
            engineering: 'rgba(216,163,72,0.12)',
            frontier: 'rgba(242,200,107,0.12)',
            home: 'rgba(91,141,206,0.08)',
            planets: 'rgba(0,255,213,0.10)'
        };
        this.overlay.style.background = `linear-gradient(135deg, ${colors[page] || colors.home}, var(--surface-0))`;

        const ox = this.transitionOrigin.x;
        const oy = this.transitionOrigin.y;

        const tl = gsap.timeline({
            onComplete: () => {
                this._finishTransition();
            }
        });

        // Phase 1: Current page exit
        tl.to(currentEl, {
            opacity: 0,
            scale: 0.97,
            filter: 'blur(6px)',
            duration: 0.18,
            ease: 'power2.in',
            onComplete: () => {
                currentEl.classList.remove('active');
                gsap.set(currentEl, { clearProps: 'all' });
            }
        });

        // Phase 2: Radial clip-path wipe in from origin point
        tl.set(this.overlay, {
            opacity: 1,
            clipPath: `circle(0% at ${ox}% ${oy}%)`
        }, '-=0.1');

        tl.to(this.overlay, {
            clipPath: `circle(150% at ${ox}% ${oy}%)`,
            duration: 0.3,
            ease: 'power3.inOut'
        });

        // Phase 3: Switch content and start reveal
        tl.add(() => {
            targetEl.classList.add('active');
            this._resetPageScroll();
            gsap.set(targetEl, { opacity: 0, y: 20 });
            // Pre-hide hero children so they never flash visible during the page fade-in.
            // animatePageContent will animate them in individually afterwards.
            if (page !== 'home' && page !== 'planets') {
                const heroKids = targetEl.querySelectorAll(
                    '.page-hero__eyebrow, .page-hero__label, .page-hero__title, .page-hero__desc, .page-hero__actions, .page-hero__visual, .frontier-hero__label, .frontier-hero__title, .frontier-hero__desc, .frontier-hero__visual'
                );
                if (heroKids.length) gsap.set(heroKids, { y: 15, opacity: 0 });
            }
            // Start hero canvas rendering immediately in the background.
            // The canvas is invisible (opacity 0) but already drawing, so when
            // it fades in with the hero animation there is no blank-canvas flash.
            if (page !== 'home' && page !== 'planets' && typeof initHeroVisual === 'function') {
                initHeroVisual(page);
            }
        }, '-=0.1');

        // Phase 4: Fade out overlay while fading in target
        tl.to(this.overlay, {
            opacity: 0,
            duration: 0.2,
            ease: 'power2.out',
            onComplete: () => {
                gsap.set(this.overlay, { clipPath: 'circle(0% at 50% 50%)', opacity: 0 });
            }
        });

        tl.to(targetEl, {
            opacity: 1,
            y: 0,
            duration: 0.3,
            ease: 'power3.out',
            onComplete: () => this.animatePageContent(page, targetEl)
        }, '-=0.18');
    },

    _queueNavigation(page, animate) {
        this._queuedNavigation = {
            page,
            moduleId: this._pendingModule,
            anchorId: this._pendingAnchor,
            animate
        };
    },

    _finishTransition() {
        this.isTransitioning = false;
        this.transitionOrigin = { x: 50, y: 50 };
        this._flushQueuedNavigation();
    },

    _flushQueuedNavigation() {
        if (!this._queuedNavigation || this.isTransitioning || !this._pageEnterComplete) return;
        const next = this._queuedNavigation;
        this._queuedNavigation = null;
        this._pendingModule = next.moduleId;
        this._pendingAnchor = next.anchorId || null;

        if (next.page === this.currentPage && this._isActivePage(next.page)) {
            if (this._pendingAnchor) {
                this._applyPendingAnchor();
                return;
            }
            this._applyPendingModule(next.page);
            return;
        }

        setTimeout(() => this.navigateTo(next.page, next.animate), 0);
    },

    _startHashReconcile() {
        if (this._hashReconcileId) return;
        this._hashReconcileId = setInterval(() => {
            if (this.isTransitioning) return;
            const parsed = this._guardParsedRoute(this._parseHash());
            const page = parsed.page;
            if (!document.getElementById(`page-${page}`)) return;
            if (page === this.currentPage && this._isActivePage(page)) {
                if (parsed.anchorId && parsed.anchorId !== this._lastAppliedAnchor) {
                    this._pendingAnchor = parsed.anchorId;
                    this._applyPendingAnchor();
                }
                return;
            }

            this._pendingModule = parsed.moduleId;
            this._pendingAnchor = parsed.anchorId || null;
            this.navigateTo(page, false);
        }, 250);
    },

    // Staggered entry for page sub-elements
    animatePageContent(page, pageEl) {
        if (typeof gsap === 'undefined') {
            this.onPageEnter(page);
            return;
        }

        if (page === 'home' || page === 'planets' || page === 'frontier') {
            this.onPageEnter(page);
            return;
        }

        // Animate hero elements with stagger
        const hero = pageEl.querySelector('.page-hero, .frontier-hero');
        if (hero) {
            const heroChildren = hero.querySelectorAll('.page-hero__eyebrow, .page-hero__label, .page-hero__title, .page-hero__desc, .page-hero__actions, .page-hero__visual, .frontier-hero__label, .frontier-hero__title, .frontier-hero__desc, .frontier-hero__visual');
            if (heroChildren.length) {
                // Hero children are already pre-hidden (y:15, opacity:0) in Phase 3.
                // Use gsap.to() to avoid re-setting the start state which would cause a flash.
                gsap.to(heroChildren, {
                    y: 0, opacity: 1,
                    duration: 0.35,
                    ease: 'power3.out',
                    stagger: 0.06,
                    onComplete: () => this.onPageEnter(page)
                });
                return;
            }
        }

        this.onPageEnter(page);
    },

    updateNav(page) {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
            item.removeAttribute('aria-current');
        });
        document.querySelectorAll('.nav-indicator').forEach(indicator => {
            indicator.style.opacity = '0';
        });
        const activeNav = document.querySelector(`.nav-item[data-page="${page}"]`);
        if (activeNav) {
            activeNav.classList.add('active');
            activeNav.setAttribute('aria-current', 'page');
        }

        // Animate indicator
        this.moveIndicator(activeNav);
    },

    moveIndicator(activeItem) {
        const indicator = activeItem && activeItem.parentElement
            ? activeItem.parentElement.querySelector('.nav-indicator')
            : null;
        if (!indicator || !activeItem) {
            return;
        }

        const menu = activeItem.parentElement;
        const menuRect = menu.getBoundingClientRect();
        const itemRect = activeItem.getBoundingClientRect();

        indicator.style.opacity = '1';
        indicator.style.width = itemRect.width + 'px';
        indicator.style.left = (itemRect.left - menuRect.left) + 'px';
    },

    _isPageScriptReady(page) {
        return window.AstraPageRegistry.isReady(page);
    },

    _loadScriptOnce(src, markerName, markerValue) {
        if (!src) return Promise.resolve();
        const key = markerName + ':' + src;
        if (this._pageScriptPromises[key]) return this._pageScriptPromises[key];

        this._pageScriptPromises[key] = new Promise((resolve, reject) => {
            const plainSrc = src.split('?')[0];
            const existing = Array.from(document.scripts).find(script => {
                const current = script.getAttribute('src') || '';
                return current === src || current.split('?')[0] === plainSrc;
            });

            if (existing && !existing.dataset[markerName]) {
                resolve();
                return;
            }

            const script = existing || document.createElement('script');
            if (!existing) {
                script.src = src;
                script.async = true;
                script.dataset[markerName] = markerValue || 'true';
                document.body.appendChild(script);
            }

            script.addEventListener('load', () => resolve(), { once: true });
            script.addEventListener('error', () => {
                delete this._pageScriptPromises[key];
                reject(new Error(`Failed to load script: ${src}`));
            }, { once: true });
        });

        return this._pageScriptPromises[key];
    },

    _loadPageScript(page) {
        if (window.AstraApplicationSession && !window.AstraApplicationSession.canAccessPage(page)) {
            return Promise.resolve();
        }
        const src = window.AstraPageRegistry.scriptFor(page);
        if (!src || this._isPageScriptReady(page)) return Promise.resolve();
        if (this._pageScriptPromises[src]) return this._pageScriptPromises[src];

        this._pageScriptPromises[src] = new Promise((resolve, reject) => {
            const plainSrc = src.split('?')[0];
            const existing = Array.from(document.scripts).find(script => {
                const current = script.getAttribute('src') || '';
                return current === src || current.split('?')[0] === plainSrc;
            });

            if (existing && !existing.dataset.routerPageScript) {
                resolve();
                return;
            }

            const script = existing || document.createElement('script');
            if (!existing) {
                script.src = src;
                script.async = true;
                script.dataset.routerPageScript = page;
                document.body.appendChild(script);
            }

            script.addEventListener('load', () => resolve(), { once: true });
            script.addEventListener('error', () => {
                delete this._pageScriptPromises[src];
                reject(new Error(`Failed to load page script: ${src}`));
            }, { once: true });
        });

        return this._pageScriptPromises[src];
    },

    _needsCourseSupport(page) {
        return this.coursePages.includes(page) && typeof ModuleSelector === 'undefined';
    },

    _loadCourseSupport(page) {
        if (!this.coursePages.includes(page)) return Promise.resolve();
        return this.courseSupportScripts.reduce(
            (chain, src) => chain.then(() => this._loadScriptOnce(src, 'routerSupportScript', page)),
            Promise.resolve()
        ).then(() => {
            if (typeof ModuleSelector !== 'undefined' && !ModuleSelector.__routerSupportBooted) {
                ModuleSelector.__routerSupportBooted = true;
                ModuleSelector.__bootedAfterMinimalStart = true;
                ModuleSelector.init();
            }
            if (typeof lucide !== 'undefined') {
                try { lucide.createIcons(); } catch (e) {}
            }
        });
    },

    _ensurePageScript(page) {
        const pageScriptReady = this._isPageScriptReady(page);
        const needsCourseSupport = this._needsCourseSupport(page);
        if (pageScriptReady && !needsCourseSupport) {
            if (this.coursePages.includes(page)) this._loadCourseSupport(page);
            return true;
        }
        try {
            if (new URLSearchParams(location.search).get('noPageScript') === '1') return true;
        } catch (e) {}
        setTimeout(() => {
            this._loadCourseSupport(page)
                .then(() => this._loadPageScript(page))
                .then(() => {
                    if (this.currentPage === page && this._isActivePage(page)) {
                        this.onPageEnter(page);
                    }
                })
                .catch(error => {
                    console.warn('[Router] page script load failed:', page, error);
                });
        }, 120);
        return false;
    },

    onPageEnter(page) {
        if (window.AstraApplicationSession && !window.AstraApplicationSession.canAccessPage(page)) {
            this.navigateTo(window.AstraApplicationSession.guardPage(page), false);
            return;
        }
        if (!this._ensurePageScript(page)) {
            this._pageEnterComplete = true;
            this._flushQueuedNavigation();
            return;
        }

        // v6.1.0-alpha6 淇锛歨ome / planets 鏄€屽崟灞忛攣瀹氬紡銆嶅睍绀洪〉锛岃嫢娌跨敤鍓嶄竴椤电殑 scrollTop锛?
        // 鍔犱笂 home-scroll-locked 鍚?body 楂樺害琚拤姝诲湪 100vh锛屾棫婊氬姩鍋忕Щ浼氳棣栭〉鍗″湪涓嬫柟鐣欓粦妗嗐€?
        // 鐢ㄥ弻闃舵閲嶇疆锛氬悓姝ョ疆 0 + rAF 鍐嶇疆 0锛堣鐩?GSAP 杞満缁撴潫鍚庢祻瑙堝櫒鎭㈠婊氬姩鐨勮竟缂樺満鏅級銆?
        if (page === 'home' || page === 'planets') {
            const resetScroll = () => this._resetPageScroll();
            resetScroll();
            requestAnimationFrame(resetScroll);
        }
        document.body.classList.toggle('home-scroll-locked', page === 'home' || page === 'frontier');

        // v5.0锛氱Щ闄や寒鑹蹭富棰橈紝鍏ㄧ珯鍥哄畾 dark
        document.documentElement.setAttribute('data-theme', 'dark');

        // v5.0锛欶AB 浠呭湪瀛︾璇剧▼椤垫樉绀猴紝棣栭〉/澶氭槦绯诲ぇ灞忕瓑灞曠ず椤甸潰涓嶆樉绀?
        const isCoursePage = this.coursePages.includes(page);
        if (typeof BackToTop !== 'undefined') {
            if (isCoursePage) BackToTop.show(); else BackToTop.hide();
        }
        if (typeof FabTrigger !== 'undefined') {
            if (isCoursePage) FabTrigger.show(); else FabTrigger.hide();
        }

        // === Page Initialization ===
        // Home page initializes directly; subject pages rely on ModuleSelector
        // for lazy per-experiment initialization (triggered when user opens an experiment).
        window.AstraPageRegistry.enter(page);
        // Subject pages: show sidebar toggle if an experiment was previously open,
        // but don't eagerly initialize any experiments (ModuleSelector handles it).

        // Refresh ScrollTrigger on content pages
        if (typeof ScrollTrigger !== 'undefined') {
            ScrollTrigger.refresh();
        }

        // Trigger scroll animations for the new page
        if (page !== 'home' && page !== 'planets' && typeof initPageScrollAnimations === 'function') {
            initPageScrollAnimations(page);
        }

        // Initialize hero canvas if present

        // Initialize hero canvas (also serves as fallback for non-animated path).
        // canvas.dataset.initialized prevents double-init on the animated path.
        if (page !== 'home' && page !== 'planets' && typeof initHeroVisual === 'function') {
            initHeroVisual(page);
        }

        // 娣遍摼鎺ワ細URL 褰㈠ #physics/momentum-conservation 鏃讹紝鑷姩鎵撳紑瀵瑰簲瀹為獙
        this._applyPendingModule(page);
        this._applyPendingAnchor();
        this._pageEnterComplete = true;
        this._flushQueuedNavigation();
    },

    /**
     * 鑻?_pendingModule 涓庡綋鍓?page锛堣绋嬮〉锛夊尮閰嶏紝鍒欏皾璇曡皟鐢?ModuleSelector.openModule銆?
     * 绛夊緟 ModuleSelector 娓叉煋濂戒晶鏍忓悗鍐嶈皟鐢紝浠ュ鐞嗛灞忓嵆鐩磋揪鐨勫満鏅€?
     */
    _applyPendingModule(page) {
        const moduleId = this._pendingModule;
        if (!moduleId) return;
        const isCoursePage = this.coursePages.includes(page);
        if (!isCoursePage) { this._pendingModule = null; return; }
        const generation = ++this._pendingModuleGeneration;
        const tryOpen = (retries) => {
            if (generation !== this._pendingModuleGeneration
                || this.currentPage !== page
                || !this._isActivePage(page)
                || this._pendingModule !== moduleId) {
                return;
            }
            if (typeof ModuleSelector !== 'undefined' && typeof ModuleSelector.openModule === 'function') {
                let opened = false;
                try { opened = ModuleSelector.openModule(page, moduleId) === true; } catch (e) {}
                this._pendingModule = null;
                if (!opened) this._restoreModuleRoute(page);
                return;
            }
            if (retries > 0) setTimeout(() => tryOpen(retries - 1), 60);
        };
        // 绛変竴涓?microtask + 涓€娆?60ms 閲嶈瘯锛岃鐩?ModuleSelector 灏氭湭鍒濆鍖栫殑杈圭紭鍦烘櫙
        setTimeout(() => tryOpen(5), 0);
    },

    _applyPendingAnchor() {
        const anchorId = this._pendingAnchor;
        if (!anchorId) return;
        const parsed = this._parseHash();
        const anchorPage = parsed.anchorId === anchorId ? parsed.page : this._pageForFrontierAnchor(anchorId);
        const target = document.getElementById(anchorId);
        if (!target) return;
        if (anchorPage && (this.currentPage !== anchorPage || !this._isActivePage(anchorPage))) return;
        const activePage = anchorPage
            ? document.getElementById(`page-${anchorPage}`)
            : document.querySelector('.page.active');
        if (activePage && !activePage.contains(target)) return;

        this._cancelPendingAnchorScroll();
        const generation = this._anchorScrollGeneration;
        const context = target.previousElementSibling && target.previousElementSibling.classList.contains('frontier-section-context')
            ? target.previousElementSibling
            : null;
        const scrollTarget = context || target;
        this._lastAppliedAnchor = anchorId;
        this._pendingAnchor = null;
        const run = () => {
            if (generation !== this._anchorScrollGeneration) return;
            if (anchorPage && (this.currentPage !== anchorPage || !this._isActivePage(anchorPage))) return;
            if (activePage && !activePage.classList.contains('active')) return;
            try {
                const offset = 88;
                const rootStyle = document.documentElement.style;
                const bodyStyle = document.body.style;
                const previousRootBehavior = rootStyle.scrollBehavior;
                const previousBodyBehavior = bodyStyle.scrollBehavior;
                const align = () => {
                    if (generation !== this._anchorScrollGeneration) return;
                    if (anchorPage && (this.currentPage !== anchorPage || !this._isActivePage(anchorPage))) return;
                    if (activePage && !activePage.classList.contains('active')) return;
                    const top = Math.max(0, scrollTarget.getBoundingClientRect().top + window.pageYOffset - offset);
                    const scroller = document.scrollingElement || document.documentElement;
                    rootStyle.scrollBehavior = 'auto';
                    bodyStyle.scrollBehavior = 'auto';
                    window.scrollTo(0, top);
                    if (scroller) scroller.scrollTop = top;
                    document.documentElement.scrollTop = top;
                    document.body.scrollTop = top;
                };
                requestAnimationFrame(align);
                [80, 220, 720, 1400].forEach((delay) => this._scheduleAnchorScroll(align, delay));
                this._scheduleAnchorScroll(() => {
                    if (generation !== this._anchorScrollGeneration) return;
                    rootStyle.scrollBehavior = previousRootBehavior;
                    bodyStyle.scrollBehavior = previousBodyBehavior;
                }, 1460);
                target.setAttribute('tabindex', '-1');
                target.focus({ preventScroll: true });
            } catch (e) { /* noop */ }
        };
        this._scheduleAnchorScroll(run, 0);
    },

    onPageLeave(page) {
        if (page === 'home' || page === 'frontier') {
            document.body.classList.remove('home-scroll-locked');
        }
        if (page !== 'home' && page !== 'planets' && typeof destroyHeroVisual === 'function') {
            try { destroyHeroVisual(page); } catch (e) { /* ignore */ }
        }

        if (this._galaxyForPage(page) === 'frontier'
            && typeof FrontierLearning !== 'undefined'
            && typeof FrontierLearning.destroy === 'function') {
            try { FrontierLearning.destroy(page); } catch (e) { /* ignore */ }
        }

        if (page === 'home') {
            if (typeof ParticleNetwork !== 'undefined' && ParticleNetwork.destroy) ParticleNetwork.destroy();
            if (typeof SatelliteSystem !== 'undefined') SatelliteSystem.isRunning = false;
        } else if (!window.AstraPageRegistry.leave(page)) {
            if (typeof ModuleSelector !== 'undefined' && typeof ModuleSelector.leavePage === 'function') {
                try { ModuleSelector.leavePage(page, { preserveHash: true }); } catch (e) { /* ignore */ }
            }
        }
    },

    // 鈹€鈹€ Running Time Footer 鈹€鈹€
    _toggleRunningTime(show) {
        const el = document.getElementById('running-time-footer');
        if (!el) return;
        if (show) {
            el.classList.add('visible');
            if (!this._runningTimeId) {
                const START = new Date('2026-04-14T00:00:00').getTime();
                const dEl = document.getElementById('rt-days');
                const hEl = document.getElementById('rt-hours');
                const mEl = document.getElementById('rt-minutes');
                const sEl = document.getElementById('rt-seconds');
                const tick = () => {
                    const diff = Math.max(0, Date.now() - START);
                    const d = Math.floor(diff / 86400000);
                    const h = Math.floor((diff % 86400000) / 3600000);
                    const m = Math.floor((diff % 3600000) / 60000);
                    const s = Math.floor((diff % 60000) / 1000);
                    if (dEl) dEl.textContent = d;
                    if (hEl) hEl.textContent = h;
                    if (mEl) mEl.textContent = m;
                    if (sEl) sEl.textContent = s;
                };
                tick();
                this._runningTimeId = setInterval(tick, 1000);
            }
        } else {
            el.classList.remove('visible');
            if (this._runningTimeId) {
                clearInterval(this._runningTimeId);
                this._runningTimeId = null;
            }
        }
    },

    _isFrontierPage(page) {
        return this.frontierPages.includes(page);
    },

    _isActivePage(page) {
        const active = document.querySelector('.page.active');
        return !!active && active.id === `page-${page}`;
    },

    _usesEnglabFooter(page) {
        return this._galaxyForPage(page) === 'englab' && page !== 'home';
    },

    _toggleGalaxyFooters(page) {
        const englabFooter = document.getElementById('site-footer');
        const frontierFooter = document.getElementById('frontier-footer');
        const showFrontier = this._isFrontierPage(page) && page !== 'frontier';
        const showEnglab = this._usesEnglabFooter(page);

        if (englabFooter) englabFooter.style.display = showEnglab ? '' : 'none';
        if (frontierFooter) {
            frontierFooter.hidden = !showFrontier;
            frontierFooter.classList.toggle('is-visible', showFrontier);
        }
    }
};

// Global navigate function (backward compatible)
function navigate(page) {
    Router.navigateTo(page, true);
}

window.navigate = navigate;
window.Router = Router;
