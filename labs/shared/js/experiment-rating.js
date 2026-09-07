// ===== Experiment Rating Module =====
// Shows a floating 5-star rating card after spending time in an experiment.
// Ratings remain in memory until a backend-owned account-scoped API is available.

const ExperimentRating = {
    _card: null,
    _timer: null,
    _currentModule: null,
    _storageKey: 'englab-ratings',
    _ratings: {},
    _delay: 30000, // 30s before showing

    init() {
        // Nothing global
    },

    /** Show rating card after delay when experiment opens */
    show(moduleId) {
        this._currentModule = moduleId;
        // Don't show if already rated
        if (this._getRating(moduleId) > 0) return;

        var self = this;
        this._timer = setTimeout(function() {
            self._injectCard(moduleId);
        }, self._delay);
    },

    /** Hide and cleanup when leaving experiment */
    hide() {
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
        if (this._card && this._card.parentNode) this._card.remove();
        this._card = null;
        this._currentModule = null;
    },

    /** Get rating for a module (0 = not rated) */
    getRating(moduleId) {
        return this._getRating(moduleId);
    },

    // ── Internal ──

    _getRatings() {
        return { ...this._ratings };
    },

    _getRating(moduleId) {
        return this._getRatings()[moduleId] || 0;
    },

    _setRating(moduleId, stars) {
        var ratings = this._getRatings();
        ratings[moduleId] = stars;
        this._ratings = ratings;
    },

    _injectCard(moduleId) {
        if (this._card) this._card.remove();

        var card = document.createElement('div');
        card.className = 'rating-card';
        card.innerHTML =
            '<div class="rating-card__label">为这个实验打分</div>' +
            '<div class="rating-card__stars">' +
                this._renderStars(0) +
            '</div>' +
            '<button class="rating-card__close" aria-label="关闭">&times;</button>';

        var self = this;

        // Star hover + click
        card.querySelector('.rating-card__stars').addEventListener('mouseover', function(e) {
            var star = e.target.closest('[data-star]');
            if (!star) return;
            self._highlightStars(card, parseInt(star.dataset.star));
        });
        card.querySelector('.rating-card__stars').addEventListener('mouseout', function() {
            self._highlightStars(card, 0);
        });
        card.querySelector('.rating-card__stars').addEventListener('click', function(e) {
            var star = e.target.closest('[data-star]');
            if (!star) return;
            var rating = parseInt(star.dataset.star);
            self._setRating(moduleId, rating);
            self._showThanks(card, rating);
        });

        // Close button
        card.querySelector('.rating-card__close').addEventListener('click', function() {
            card.classList.remove('rating-card--visible');
            setTimeout(function() { if (card.parentNode) card.remove(); }, 300);
        });

        var mechanicsHost = moduleId === 'mechanics'
            ? document.querySelector('#page-physics.active [data-module="mechanics"].module-active > .demo-section')
            : null;
        if (mechanicsHost) {
            card.classList.add('rating-card--mechanics-inline');
            var mechanicsLayout = mechanicsHost.querySelector('.demo-layout');
            mechanicsHost.insertBefore(card, mechanicsLayout || null);
        } else {
            document.body.appendChild(card);
        }
        this._card = card;

        // Animate in
        card.offsetHeight;
        card.classList.add('rating-card--visible');
    },

    _renderStars(active) {
        var html = '';
        for (var i = 1; i <= 5; i++) {
            var filled = i <= active;
            html += '<span class="rating-star' + (filled ? ' rating-star--filled' : '') + '" data-star="' + i + '" role="button" tabindex="0" aria-label="' + i + ' 星">' +
                '<svg width="22" height="22" viewBox="0 0 24 24" ' +
                (filled ? 'fill="currentColor" stroke="none"' : 'fill="none" stroke="currentColor" stroke-width="2"') +
                '><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' +
                '</span>';
        }
        return html;
    },

    _highlightStars(card, count) {
        var stars = card.querySelectorAll('.rating-star');
        for (var i = 0; i < stars.length; i++) {
            var n = i + 1;
            var filled = n <= count;
            stars[i].classList.toggle('rating-star--filled', filled);
            var svg = stars[i].querySelector('svg');
            if (filled) {
                svg.setAttribute('fill', 'currentColor');
                svg.setAttribute('stroke', 'none');
            } else {
                svg.setAttribute('fill', 'none');
                svg.setAttribute('stroke', 'currentColor');
            }
        }
    },

    _showThanks(card, rating) {
        card.querySelector('.rating-card__label').textContent = '感谢评分！';
        card.querySelector('.rating-card__stars').innerHTML = this._renderStars(rating);
        card.querySelector('.rating-card__stars').style.pointerEvents = 'none';
        var closeBtn = card.querySelector('.rating-card__close');
        if (closeBtn) closeBtn.style.display = 'none';

        setTimeout(function() {
            card.classList.remove('rating-card--visible');
            setTimeout(function() { if (card.parentNode) card.remove(); }, 300);
        }, 1500);
    }
};

window.ExperimentRating = ExperimentRating;
