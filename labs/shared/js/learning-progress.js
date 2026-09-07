// ===== X-01: Learning Progress System =====
// Tracks which experiments the user has visited in memory for the current page lifecycle.
// Renders ✓ badges on gallery cards and a progress bar in page heroes.

const LearningProgress = {
    _KEY: 'englab-progress',
    _data: null, // { visited: { "function-graph": timestamp, ... } }
    _catalogueHandler: null,

    init() {
        this._load();
        if (!this._catalogueHandler) {
            this._catalogueHandler = () => {
                // ModuleSelector also rebuilds its catalogue surfaces on this
                // event. Render after that synchronous rebuild has completed.
                setTimeout(() => this._renderAll(), 0);
            };
            window.addEventListener('astra:student-catalogue-ready', this._catalogueHandler);
        }
        // Render badges & bars whenever a subject page becomes visible
        this._renderAll();
    },

    // ── Public API ──

    markVisited(moduleId) {
        this._load();
        if (!this._data.visited[moduleId]) {
            this._data.visited[moduleId] = Date.now();
            this._save();
        }
        // Update UI immediately
        this._setBadge(moduleId, true);
        this._updateBarsForModule(moduleId);
    },

    isVisited(moduleId) {
        this._load();
        return !!this._data.visited[moduleId];
    },

    getSubjectProgress(page) {
        const session = window.AstraApplicationSession;
        const user = session && typeof session.getUser === 'function' ? session.getUser() : null;
        const catalogue = window.AstraStudentCourseCatalogue;
        const exps = (CONFIG.experiments[page] || []).filter(e => {
            if (e.variant === 'upcoming') return false;
            if (!user || user.role !== 'student') return true;
            if (!catalogue || typeof catalogue.allowsActivity !== 'function') return false;
            try {
                return catalogue.allowsActivity(page, e.id) === true;
            } catch (error) {
                return false;
            }
        });
        const total = exps.length;
        const visited = exps.filter(e => this.isVisited(e.id)).length;
        return { visited, total, percent: total ? Math.round(visited / total * 100) : 0 };
    },

    getOverallProgress() {
        let visited = 0, total = 0;
        Object.keys(CONFIG.experiments).forEach(page => {
            const p = this.getSubjectProgress(page);
            visited += p.visited;
            total += p.total;
        });
        return { visited, total, percent: total ? Math.round(visited / total * 100) : 0 };
    },

    reset() {
        this._data = { visited: {} };
        this._save();
        this._renderAll();
    },

    // ── In-memory state ──

    _load() {
        if (this._data) return;
        this._data = { visited: {} };
    },

    _save() {
        // Intentionally not persisted: account-linked learning state belongs to the backend.
    },

    // ── UI Rendering ──

    _renderAll() {
        Object.keys(CONFIG.experiments).forEach(page => {
            this._renderBadges(page);
            this._renderProgressBar(page);
        });
        this._renderHomeProgress();
    },

    /** Add ✓ badges on visited gallery cards */
    _renderBadges(page) {
        const gallery = document.getElementById(`gallery-${page}`);
        if (!gallery) return;
        const cards = gallery.querySelectorAll('.module-card[data-module-target]');
        cards.forEach(card => {
            const mid = card.dataset.moduleTarget;
            this._setBadge(mid, this.isVisited(mid), card);
        });
    },

    _setBadge(moduleId, visited, card) {
        if (!card) {
            // Find across all galleries
            card = document.querySelector(`.module-card[data-module-target="${moduleId}"]`);
        }
        if (!card) return;
        if (visited) {
            card.classList.add('module-card--visited');
        } else {
            card.classList.remove('module-card--visited');
        }
    },

    /** Inject or update a progress bar inside the page hero */
    _renderProgressBar(page) {
        const pageEl = document.getElementById(`page-${page}`);
        if (!pageEl) return;
        const hero = pageEl.querySelector('.page-hero__text');
        if (!hero) return;

        const { visited, total, percent } = this.getSubjectProgress(page);

        let bar = hero.querySelector('.progress-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.className = 'progress-bar';
            bar.innerHTML = `
                <div class="progress-bar__track">
                    <div class="progress-bar__fill"></div>
                </div>
                <span class="progress-bar__text"></span>
            `;
            hero.appendChild(bar);
        }

        bar.querySelector('.progress-bar__fill').style.width = percent + '%';
        bar.querySelector('.progress-bar__text').textContent =
            visited === 0 ? `共 ${total} 个实验` : `已探索 ${visited}/${total} 个实验`;
    },

    /** Update bars for the subject that owns this moduleId */
    _updateBarsForModule(moduleId) {
        for (const page of Object.keys(CONFIG.experiments)) {
            if (CONFIG.experiments[page].some(e => e.id === moduleId)) {
                this._renderProgressBar(page);
                break;
            }
        }
    },

    /** Render overall progress on the home page */
    _renderHomeProgress() {
        // Overall progress widget removed in v4.0.5 — only per-satellite chips remain.

        // ── Per-satellite progress chips ──
        const subjects = ['mathematics', 'physics', 'chemistry', 'algorithms', 'biology'];
        subjects.forEach((page, i) => {
            const sat = document.querySelector(`.satellite-${i + 1}[data-target="${page}"]`);
            if (!sat) return;
            const container = sat.querySelector('.satellite-label-container');
            if (!container) return;

            const { visited, total } = this.getSubjectProgress(page);
            let chip = container.querySelector('.satellite-progress');
            if (!chip) {
                chip = document.createElement('span');
                chip.className = 'satellite-progress';
                container.appendChild(chip);
            }
            chip.textContent = `${visited}/${total}`;
            chip.classList.toggle('satellite-progress--active', visited > 0);
        });
    }
};
