/* ============================================================
 * Codevis · 简化路由
 * hash 路由 + page enter/leave 回调
 * ============================================================ */
(function (global) {
    'use strict';

    const CvRouter = {
        currentPage: 'catalog',
        currentParams: new URLSearchParams(),
        initialized: false,
        pages: {},

        register(pageId, hooks) {
            // hooks: { onEnter?: fn, onLeave?: fn }
            this.pages[pageId] = hooks || {};
        },

        init() {
            if (this.initialized) return;
            this.initialized = true;
            window.addEventListener('hashchange', () => this._handle());
            this._handle(true);
        },

        navigateTo(pageId, params) {
            const search = new URLSearchParams(params || {});
            const nextHash = '#' + pageId + (search.size ? '?' + search.toString() : '');
            if (window.location.hash === nextHash) return;
            window.location.hash = nextHash;
        },

        _handle(isInitial) {
            const rawHash = (window.location.hash || '#catalog').slice(1);
            const separator = rawHash.indexOf('?');
            const requested = (separator >= 0 ? rawHash.slice(0, separator) : rawHash) || 'catalog';
            const query = separator >= 0 ? rawHash.slice(separator + 1) : '';
            const target = document.getElementById('cv-page-' + requested) ? requested : 'catalog';
            this.currentParams = new URLSearchParams(target === requested ? query : '');

            if (!isInitial && this.currentPage && this.pages[this.currentPage]) {
                try { this.pages[this.currentPage].onLeave && this.pages[this.currentPage].onLeave(); }
                catch (e) { console.warn('[CvRouter] onLeave error', e); }
            }

            document.querySelectorAll('.cv-page').forEach(el => el.classList.remove('cv-page--active'));
            const pageEl = document.getElementById('cv-page-' + target);
            if (pageEl) pageEl.classList.add('cv-page--active');

            // nav 高亮
            document.querySelectorAll('.cv-nav-item').forEach(el => {
                const isActive = el.dataset.page === target;
                el.classList.toggle('cv-nav-item--active', isActive);
                if (isActive) el.setAttribute('aria-current', 'page');
                else el.removeAttribute('aria-current');
            });

            this.currentPage = target;

            // 滚动复位
            const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            window.scrollTo({ top: 0, behavior: isInitial || reducedMotion ? 'auto' : 'smooth' });

            if (this.pages[target]) {
                try { this.pages[target].onEnter && this.pages[target].onEnter(); }
                catch (e) { console.warn('[CvRouter] onEnter error', e); }
            }
        }
    };

    global.CvRouter = CvRouter;
})(window);
