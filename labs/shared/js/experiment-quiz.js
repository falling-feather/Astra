// ===== X-02: Experiment Quiz Module =====
// Shows a "📝 小测验" button in experiments that have quiz data.
// Opens a modal with 3 random multiple-choice questions.

const ExperimentQuiz = {
    _overlay: null,
    _btn: null,
    _currentModule: null,
    _scoreKey: 'englab-quiz-scores',
    _scores: {},
    _moduleAliases: {
        complex: 'complex-numbers',
    },

    init() {
        // Nothing to do globally — per-experiment show/hide handled by show()/hide()
    },

    /** Called by router onPageEnter — inject quiz button if data exists */
    show(moduleId) {
        const quizModuleId = this._resolveModuleId(moduleId);
        this._currentModule = quizModuleId;
        if (typeof QUIZ_DATA === 'undefined' || !QUIZ_DATA[quizModuleId] || QUIZ_DATA[quizModuleId].length === 0) {
            this._removeButton();
            this._closeOverlay();
            return;
        }

        this._injectButton(quizModuleId);
    },

    /** Called by router onPageLeave — remove quiz button */
    hide() {
        if (this._btn && this._btn.parentNode) {
            this._btn.parentNode.removeChild(this._btn);
        }
        this._btn = null;
        this._closeOverlay();
        this._currentModule = null;
    },

    // ── Floating button ──
    _injectButton(moduleId) {
        if (this._btn) {
            this._btn.dataset.moduleId = moduleId;
            return;
        }

        const btn = document.createElement('button');
        btn.className = 'quiz-fab';
        btn.dataset.moduleId = moduleId;
        btn.setAttribute('aria-label', '开始小测验');
        btn.setAttribute('title', '章节小测验');
        btn.innerHTML = '<i data-lucide="clipboard-check"></i><span>小测验</span>';
        btn.addEventListener('click', () => this._startQuiz(btn.dataset.moduleId));
        document.body.appendChild(btn);
        this._btn = btn;

        if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
    },

    _removeButton() {
        if (this._btn && this._btn.parentNode) {
            this._btn.parentNode.removeChild(this._btn);
        }
        this._btn = null;
    },

    // ── Quiz flow ──
    _startQuiz(moduleId) {
        const pool = QUIZ_DATA[moduleId];
        if (!pool || pool.length === 0) return;

        // Pick 3 random questions (or fewer if pool is small)
        const count = Math.min(3, pool.length);
        const selected = this._shuffle([...pool]).slice(0, count);

        this._renderOverlay(selected, moduleId);
    },

    _renderOverlay(questions, moduleId) {
        this._closeOverlay();

        const overlay = document.createElement('div');
        overlay.className = 'quiz-overlay';
        overlay.innerHTML = `
            <div class="quiz-modal" role="dialog" aria-label="章节小测验">
                <div class="quiz-header">
                    <h3>📝 章节小测验</h3>
                    <button class="quiz-close" aria-label="关闭">&times;</button>
                </div>
                <div class="quiz-body"></div>
                <div class="quiz-footer" style="display:none">
                    <div class="quiz-score"></div>
                    <button class="quiz-retry">再试一次</button>
                </div>
            </div>
        `;

        const modal = overlay.querySelector('.quiz-modal');
        const body = overlay.querySelector('.quiz-body');
        const footer = overlay.querySelector('.quiz-footer');
        const scoreEl = overlay.querySelector('.quiz-score');
        const closeBtn = overlay.querySelector('.quiz-close');
        const retryBtn = overlay.querySelector('.quiz-retry');

        // Render questions
        let answered = 0;
        let correct = 0;

        questions.forEach((q, i) => {
            const qEl = document.createElement('div');
            qEl.className = 'quiz-question';
            qEl.innerHTML = `
                <div class="quiz-q-text"><span class="quiz-q-num">${i + 1}.</span> ${this._escHtml(q.q)}</div>
                <div class="quiz-options"></div>
                <div class="quiz-tip" style="display:none"></div>
            `;

            const optsCont = qEl.querySelector('.quiz-options');
            const tipEl = qEl.querySelector('.quiz-tip');

            q.opts.forEach((opt, j) => {
                const optBtn = document.createElement('button');
                optBtn.className = 'quiz-opt';
                optBtn.textContent = `${'ABCD'[j]}. ${opt}`;
                optBtn.addEventListener('click', () => {
                    if (qEl.classList.contains('quiz-answered')) return;
                    qEl.classList.add('quiz-answered');
                    answered++;

                    if (j === q.ans) {
                        optBtn.classList.add('quiz-opt--correct');
                        correct++;
                    } else {
                        optBtn.classList.add('quiz-opt--wrong');
                        // Highlight correct answer
                        optsCont.children[q.ans].classList.add('quiz-opt--correct');
                    }

                    tipEl.textContent = '💡 ' + q.tip;
                    tipEl.style.display = '';

                    if (answered === questions.length) {
                        this._showResult(footer, scoreEl, correct, questions.length, moduleId);
                    }
                });
                optsCont.appendChild(optBtn);
            });

            body.appendChild(qEl);
        });

        // Close handlers
        closeBtn.addEventListener('click', () => this._closeOverlay());
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this._closeOverlay();
        });
        retryBtn.addEventListener('click', () => this._startQuiz(moduleId));

        // Keyboard
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this._closeOverlay();
        });

        document.body.appendChild(overlay);
        this._overlay = overlay;

        // Focus trap
        requestAnimationFrame(() => {
            modal.focus();
            overlay.style.opacity = '1';
        });
    },

    _showResult(footer, scoreEl, correct, total, moduleId) {
        footer.style.display = '';
        const pct = Math.round((correct / total) * 100);
        const emoji = pct === 100 ? '🎉' : pct >= 67 ? '👍' : '💪';
        scoreEl.innerHTML = `${emoji} 得分：<strong>${correct}/${total}</strong>（${pct}%）`;

        // Save best score
        this._saveScore(moduleId, correct, total);
    },

    _saveScore(moduleId, correct, total) {
        const prev = this._scores[moduleId];
        const pct = Math.round((correct / total) * 100);
        if (!prev || pct > prev.pct) {
            this._scores[moduleId] = { correct, total, pct, ts: Date.now() };
        }
    },

    _closeOverlay() {
        if (this._overlay && this._overlay.parentNode) {
            this._overlay.parentNode.removeChild(this._overlay);
        }
        this._overlay = null;
    },

    // ── Helpers ──
    _shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    },

    _escHtml(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    },

    _resolveModuleId(moduleId) {
        if (typeof QUIZ_DATA !== 'undefined' && QUIZ_DATA[moduleId]) return moduleId;
        const alias = this._moduleAliases[moduleId];
        if (typeof QUIZ_DATA !== 'undefined' && alias && QUIZ_DATA[alias]) return alias;
        return moduleId;
    }
};

window.ExperimentQuiz = ExperimentQuiz;
