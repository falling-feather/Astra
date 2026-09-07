// ===== Experiment Favorites Module =====
// Adds a heart button in experiment view to bookmark experiments.
// Favorited experiments show a heart indicator on gallery cards.

const ExperimentFavorites = {
    _btn: null,
    _currentModule: null,
    _storageKey: 'englab-favorites',
    _favorites: [],

    init() {
        // Nothing global — per-experiment show/hide via show()/hide()
    },

    /** Show heart toggle when experiment opens */
    show(moduleId) {
        this._currentModule = moduleId;
        this._injectButton(moduleId);
    },

    /** Remove heart button when returning to gallery */
    hide() {
        if (this._btn && this._btn.parentNode) this._btn.remove();
        this._btn = null;
        this._currentModule = null;
    },

    /** Check if a module is favorited */
    isFavorited(moduleId) {
        return this._getFavorites().indexOf(moduleId) !== -1;
    },

    /** Update heart indicators on gallery cards */
    updateGalleryCards() {
        var favs = this._getFavorites();
        document.querySelectorAll('.module-card').forEach(function(card) {
            var mid = card.dataset.moduleTarget;
            if (!mid) return;
            var existing = card.querySelector('.module-card__fav');
            if (favs.indexOf(mid) !== -1) {
                if (!existing) {
                    var badge = document.createElement('div');
                    badge.className = 'module-card__fav';
                    badge.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg>';
                    card.appendChild(badge);
                }
            } else {
                if (existing) existing.remove();
            }
        });
    },

    // ── Internal ──

    _getFavorites() {
        return this._favorites.slice();
    },

    _setFavorites(arr) {
        this._favorites = arr.slice();
    },

    _toggle(moduleId) {
        var favs = this._getFavorites();
        var idx = favs.indexOf(moduleId);
        if (idx === -1) {
            favs.push(moduleId);
        } else {
            favs.splice(idx, 1);
        }
        this._setFavorites(favs);
        this._updateButton(moduleId);
    },

    _injectButton(moduleId) {
        if (this._btn) this._btn.remove();

        var btn = document.createElement('button');
        btn.className = 'favorite-fab';
        btn.setAttribute('aria-label', '收藏实验');
        btn.setAttribute('data-tip', '收藏实验');
        var self = this;
        btn.addEventListener('click', function() { self._toggle(moduleId); });
        btn.addEventListener('click', function() {
            btn.classList.remove('is-rippling');
            void btn.offsetWidth;
            btn.classList.add('is-rippling');
            setTimeout(function() { btn.classList.remove('is-rippling'); }, 600);
        });
        document.body.appendChild(btn);
        this._btn = btn;
        this._updateButton(moduleId);
    },

    _updateButton(moduleId) {
        if (!this._btn) return;
        var active = this.isFavorited(moduleId);
        this._btn.classList.toggle('favorite-fab--active', active);
        this._btn.title = active ? '取消收藏' : '收藏实验';
        this._btn.setAttribute('aria-label', active ? '取消收藏' : '收藏实验');
        this._btn.setAttribute('data-tip', active ? '取消收藏' : '收藏实验');
        if (active) {
            this._btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg>';
        } else {
            this._btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg>';
        }
    }
};

window.ExperimentFavorites = ExperimentFavorites;
