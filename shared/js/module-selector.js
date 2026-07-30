// ===== Module Selector (Sidebar Navigation + Lazy Init) =====
// Provides sidebar navigation for experiments within each subject page.
// Experiments are only initialized when opened (fixing canvas-in-hidden-container issues).

const EXPERIMENT_REGISTRY_UNAVAILABLE_WARNING =
    '[ModuleSelector] experiment registry unavailable; transition refused';
const UNKNOWN_MODULE_WARNING =
    '[ModuleSelector] refusing transition to unknown module';
const PUBLICATION_CLASSIFICATION_WARNING =
    '[ModuleSelector] publication classification failed; transition refused';

const ModuleSelector = {
    activeModule: {},   // { pageName: 'module-id' | null }
    _initialized: {},   // { 'module-id': true } — tracks which modules have been initialized
    _runtimeDirty: {},  // init threw after it may have started runtime resources
    _sidebars: {},      // { pageName: sidebar DOM element }
    _sidebarOpen: {},   // { pageName: bool }
    _swipeBackCtrls: {}, // { pageName: SwipeBack controller }
    _scriptPromises: {},
    _transitionGeneration: {},
    _transitionTimers: {},
    _publicationGateNodes: {},
    _publicationGatePending: {},
    _pageEnhancementScripts: {
        physics: ['pages/physics/physics-zoom.js'],
        biology: ['pages/biology/biology.js?v=20260416b', 'pages/biology/biology-zoom.js?v=20260416b']
    },

    _getExperimentGuide() {
        if (window.ExperimentGuide) return window.ExperimentGuide;
        if (globalThis.ExperimentGuide) return globalThis.ExperimentGuide;
        return typeof ExperimentGuide !== 'undefined' ? ExperimentGuide : null;
    },

    init() {
        const pages = ['mathematics', 'physics', 'chemistry', 'algorithms', 'biology'];
        pages.forEach(page => {
            const pageEl = document.getElementById(`page-${page}`);
            if (!pageEl) return;

            pageEl.classList.add(`page-${page}`);
            this.activeModule[page] = null;
            this._sidebarOpen[page] = false;
            this._transitionGeneration[page] = 0;
            this._transitionTimers[page] = [];

            this.createSidebar(page, pageEl);
            this.createLearningOverview(page, pageEl);
            this.createGallery(page, pageEl);
        });

        // Create global backdrop for mobile
        const backdrop = document.createElement('div');
        backdrop.className = 'module-sidebar-backdrop';
        backdrop.id = 'module-sidebar-backdrop';
        backdrop.addEventListener('click', () => this._closeSidebarForCurrentPage());
        document.body.appendChild(backdrop);

        // ── E-04: Global keyboard navigation ──
        this._initKeyboardNav();
    },

    createSidebar(page, pageEl) {
        const experiments = CONFIG.experiments[page];
        if (!experiments || experiments.length === 0) return;

        // Sidebar container
        const sidebar = document.createElement('nav');
        sidebar.className = 'module-sidebar';
        sidebar.id = `sidebar-${page}`;
        sidebar.setAttribute('aria-label', `${CONFIG.pages[page].label}实验导航`);

        // Header
        const header = document.createElement('div');
        header.className = 'module-sidebar__header';
        header.textContent = CONFIG.pages[page].label + ' 实验';
        sidebar.appendChild(header);

        // Back-to-gallery button
        const backItem = document.createElement('button');
        backItem.className = 'module-sidebar__item';
        backItem.innerHTML = `
            <span class="module-sidebar__item-icon"><i data-lucide="layout-grid"></i></span>
            <span class="module-sidebar__item-text">返回实验列表</span>
        `;
        backItem.addEventListener('click', () => this.closeModule(page));
        sidebar.appendChild(backItem);

        // Experiment items
        experiments.forEach((exp, idx) => {
            if (exp.variant === 'upcoming') return;
            const item = document.createElement('button');
            item.className = 'module-sidebar__item';
            item.dataset.moduleTarget = exp.id;
            item.setAttribute('aria-label', exp.title);
            item.title = exp.description || exp.title;

            item.innerHTML = `
                <span class="module-sidebar__item-icon"><i data-lucide="${exp.icon || 'box'}"></i></span>
                <span class="module-sidebar__item-text">${exp.title}</span>
                <span class="module-sidebar__item-badge">${String(idx + 1).padStart(2, '0')}</span>
            `;

            item.addEventListener('click', () => {
                this.openModule(page, exp.id);
            });
            sidebar.appendChild(item);
        });

        // Toggle button
        const toggle = document.createElement('button');
        toggle.className = 'module-sidebar-toggle';
        toggle.id = `sidebar-toggle-${page}`;
        toggle.setAttribute('aria-label', '切换实验导航');
        toggle.innerHTML = '<i data-lucide="panel-left"></i>';
        toggle.addEventListener('click', () => this.toggleSidebar(page));

        // Append sidebar & toggle to document.body so position:fixed works
        // (pageEl has will-change:transform which breaks fixed positioning)
        document.body.appendChild(sidebar);
        document.body.appendChild(toggle);
        this._sidebars[page] = sidebar;

        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    createLearningOverview(page, pageEl) {
        const experiments = CONFIG.experiments[page];
        const hero = pageEl.querySelector('.page-hero');
        const learning = CONFIG.learningDesign;
        const subject = learning && learning.subjects ? learning.subjects[page] : null;
        if (!experiments || !hero || !subject) return;

        const activeCount = experiments.filter(exp => exp.variant !== 'upcoming').length;
        const label = this._escapeHtml(CONFIG.pages[page]?.label || page);
        const methodText = subject.teachingNote || '建议先完成基础实验，再进入带有模型近似或跨学科背景的主题。每个实验都配有观察任务、可调参数和小测验。';
        const featured = experiments.filter(exp => exp.variant !== 'upcoming').slice(0, 3).map((exp, idx) => `
            <div class="learning-path__item">
                <span class="learning-path__index">${String(idx + 1).padStart(2, '0')}</span>
                <strong>${this._escapeHtml(exp.title)}</strong>
                <p>${this._escapeHtml(exp.description || '')}</p>
            </div>
        `).join('');
        const sourceLinks = (subject.sources || []).slice(0, 6).map(source => {
            const item = this._normalizeLearningSource(source);
            if (!item.label) return '';
            if (item.url) {
                return `<a href="${this._escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${this._escapeHtml(item.label)}</a>`;
            }
            return `<span>${this._escapeHtml(item.label)}</span>`;
        }).join('');
        const sourceBlock = sourceLinks ? `
            <div class="learning-overview__sources" aria-label="${label}参考资料">
                <span>参考资料</span>
                ${sourceLinks}
            </div>
        ` : '';
        const sourceNote = learning.sourceNote ? `
            <div class="learning-overview__note" aria-label="${label}学习说明">
                <i data-lucide="book-open"></i>
                <p>${this._escapeHtml(learning.sourceNote)}</p>
            </div>
        ` : '';

        const overview = document.createElement('section');
        overview.className = 'learning-overview';
        overview.id = `learning-overview-${page}`;
        overview.setAttribute('aria-label', `${label}学习地图`);
        overview.innerHTML = `
            <div class="learning-overview__copy">
                <span class="learning-overview__eyebrow">${label} · 学习地图</span>
                <h2>${this._escapeHtml(CONFIG.pages[page]?.title || label)}</h2>
                <p>${this._escapeHtml(subject.overview || CONFIG.pages[page]?.desc || '')}</p>
            </div>
            <div class="learning-overview__ledger" aria-label="学习概览">
                <div><span>实验数</span><strong>${activeCount}</strong></div>
                <div><span>学习方式</span><strong>互动观察</strong></div>
                <div><span>练习入口</span><strong>小测验</strong></div>
            </div>
            <div class="learning-overview__method">
                <i data-lucide="route"></i>
                <p>${this._escapeHtml(methodText)}</p>
            </div>
            ${sourceNote}
            ${sourceBlock}
            <div class="learning-path" aria-label="${label}推荐学习起点">
                ${featured}
            </div>
        `;

        hero.insertAdjacentElement('afterend', overview);
    },

    createGallery(page, pageEl) {
        const experiments = CONFIG.experiments[page];
        if (!experiments || experiments.length === 0) return;

        const hero = pageEl.querySelector('.page-hero');
        if (!hero) return;

        const gallery = document.createElement('div');
        gallery.className = 'module-gallery';
        gallery.id = `gallery-${page}`;

        experiments.forEach((exp, idx) => {
            if (exp.variant === 'upcoming') return;
            const meta = this.getLearningMeta(page, exp);

            const card = document.createElement('div');
            card.className = 'module-card';
            card.dataset.moduleTarget = exp.id;
            card.setAttribute('role', 'button');
            card.setAttribute('tabindex', '0');
            card.setAttribute('aria-label', exp.title);
            card.title = exp.description || exp.title;

            card.innerHTML = `
                <div class="module-card__topline">
                    <div class="module-card__icon"><i data-lucide="${this._escapeHtml(exp.icon || 'box')}"></i></div>
                </div>
                <div class="module-card__title">${this._escapeHtml(exp.title)}</div>
                <div class="module-card__desc">${this._escapeHtml(exp.description)}</div>
                <div class="module-card__learning">
                    <div>
                        <span>学习目标</span>
                        <p>${this._escapeHtml(meta.task)}</p>
                    </div>
                </div>
                <div class="module-card__badge">${String(idx + 1).padStart(2, '0')}</div>
            `;

            card.addEventListener('click', () => this.openModule(page, exp.id));
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.openModule(page, exp.id);
                }
            });
            gallery.appendChild(card);
        });

        const overview = document.getElementById(`learning-overview-${page}`);
        (overview || hero).insertAdjacentElement('afterend', gallery);
        pageEl.classList.add('module-gallery-active');

        if (typeof lucide !== 'undefined') lucide.createIcons();

        // Show favorite indicators on gallery cards
        if (window.ExperimentFavorites) ExperimentFavorites.updateGalleryCards();
    },

    getLearningMeta(page, exp) {
        const learning = CONFIG.learningDesign || {};
        const focus = learning.focus ? learning.focus[exp.id] : null;
        return {
            task: focus?.task || `观察 ${exp.title} 中参数变化与结论的对应关系。`
        };
    },

    _normalizeLearningSource(source) {
        if (!source) return { label: '', url: '' };
        if (typeof source === 'string') return { label: source, url: '' };
        return {
            label: source.label || source.title || source.url || '',
            url: /^https?:\/\//i.test(source.url || '') ? source.url : ''
        };
    },

    _escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    _beginModuleTransition(page) {
        const nextGeneration = (this._transitionGeneration[page] || 0) + 1;
        this._transitionGeneration[page] = nextGeneration;
        const timers = this._transitionTimers[page] || [];
        timers.forEach((id) => {
            try { clearTimeout(id); } catch (error) {}
        });
        this._transitionTimers[page] = [];
        return nextGeneration;
    },

    _isCurrentModuleTransition(page, moduleId, generation) {
        return this._transitionGeneration[page] === generation
            && this.activeModule[page] === moduleId;
    },

    _scheduleModuleTask(page, moduleId, generation, delay, callback) {
        if (!this._transitionTimers[page]) this._transitionTimers[page] = [];
        const id = setTimeout(() => {
            this._transitionTimers[page] = (this._transitionTimers[page] || [])
                .filter((timerId) => timerId !== id);
            if (!this._isCurrentModuleTransition(page, moduleId, generation)) return;
            callback();
        }, delay);
        this._transitionTimers[page].push(id);
        return id;
    },

    openModule(page, moduleId, options = {}) {
        const pageEl = document.getElementById(`page-${page}`);
        if (!pageEl) return false;

        let registry = null;
        try {
            registry = window.AstraExperimentRegistry;
        } catch (error) {
            console.warn(EXPERIMENT_REGISTRY_UNAVAILABLE_WARNING);
            return false;
        }
        if (!registry || typeof registry.get !== 'function') {
            console.warn(EXPERIMENT_REGISTRY_UNAVAILABLE_WARNING);
            return false;
        }
        let targetDefinition = null;
        try {
            targetDefinition = registry.get(page, moduleId);
        } catch (error) {
            console.warn('[ModuleSelector] experiment registry lookup failed; transition refused');
            return false;
        }
        if (!targetDefinition) {
            if (
                options.authorityPrepared !== true
                && this._shouldResolveUnknownPublicationTarget(page, moduleId, pageEl)
            ) {
                return this._openUnknownPublicationTarget(page, moduleId);
            }
            console.warn(UNKNOWN_MODULE_WARNING);
            return false;
        }
        const sections = pageEl.querySelectorAll(`[data-module="${moduleId}"]`);
        if (sections.length === 0) {
            console.warn('[ModuleSelector] refusing transition because module DOM is unavailable:', `${page}:${moduleId}`);
            return false;
        }

        if (options.authorityPrepared !== true && this._requiresPublicationGate(page, moduleId)) {
            return this._openPublicationGuardedModule(page, moduleId, pageEl, sections);
        }

        // If same module, just close sidebar
        if (this.activeModule[page] === moduleId) {
            this._cancelPublicationGate(page);
            if (window.innerWidth <= 768) this._closeSidebar(page);
            return true;
        }

        // Deactivate previous module
        const prevModule = this.activeModule[page];
        if (prevModule) {
            if (!this._releaseModuleRuntime(page, prevModule)) return false;
            this._releaseEvidenceRuntime(page, prevModule, pageEl);
            if (window.BackendContent && typeof BackendContent.destroyExperimentSchema === 'function') {
                try { BackendContent.destroyExperimentSchema(page, prevModule); } catch (error) {}
            }
            pageEl.querySelectorAll(`[data-module="${prevModule}"].module-active`).forEach(s => {
                s.classList.remove('module-active');
            });
        }
        this._cancelPublicationGate(page);
        const generation = this._beginModuleTransition(page);

        // Hide gallery
        const gallery = document.getElementById(`gallery-${page}`);
        if (gallery) gallery.style.display = 'none';

        // Show target module sections
        sections.forEach(s => s.classList.add('module-active'));

        // Update sidebar active state
        const sidebar = this._sidebars[page];
        if (sidebar) {
            sidebar.querySelectorAll('.module-sidebar__item').forEach(item => {
                item.classList.toggle('active', item.dataset.moduleTarget === moduleId);
            });
        }

        // Remove gallery-active state
        pageEl.classList.remove('module-gallery-active');

        // Show sidebar toggle button
        const toggle = document.getElementById(`sidebar-toggle-${page}`);
        if (toggle) toggle.style.display = 'flex';

        this.activeModule[page] = moduleId;

        // v6.1：同步深链接到 URL hash（#subject/experiment），便于分享 / 刷新保持现场
        try {
            const newHash = '#' + page + '/' + moduleId;
            if (window.location.hash !== newHash) {
                history.replaceState(null, '', newHash);
            }
        } catch (e) {}

        // Lazy-initialize this specific module
        this._initModule(page, moduleId, generation);
        this._mountEvidenceRuntime(page, moduleId, pageEl, sections, generation);
        const backendSchemaReady = this._applyBackendSchema(page, moduleId);

        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });

        // 默认关闭侧边栏，避免改变实验区域尺寸
        this._closeSidebar(page);

        // Trigger resize for canvas elements
        this._scheduleModuleTask(page, moduleId, generation, 150, () => {
            window.dispatchEvent(new Event('resize'));
        });

        // E-04: Focus first interactive control for keyboard users
        this._focusExperiment(page, moduleId, generation, backendSchemaReady);

        // Render related experiments after deferred galaxy support becomes ready.
        this._showRelatedExperiments(page, moduleId, generation);

        // Enable swipe-back from left edge (touch devices)
        if (typeof TouchGestures !== 'undefined' && !this._swipeBackCtrls[page]) {
            this._swipeBackCtrls[page] = TouchGestures.enableSwipeBack(
                pageEl, () => this.closeModule(page)
            );
        }
        return true;
    },

    _isStableModuleId(page, moduleId) {
        if (typeof moduleId !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(moduleId)) return false;
        return `${page}.${moduleId}`.length <= 120;
    },

    _shouldResolveUnknownPublicationTarget(page, moduleId, pageEl) {
        if (page !== 'physics' || !this._isStableModuleId(page, moduleId)) return false;
        if (this.activeModule[page]) return false;
        if (window.location.hash !== `#${page}/${moduleId}`) return false;
        const hasModuleDom = Array.from(pageEl.querySelectorAll('[data-module]')).some(section => (
            section && section.dataset && section.dataset.module === moduleId
        ));
        if (hasModuleDom) return false;
        const session = window.AstraApplicationSession;
        const user = session && typeof session.getUser === 'function' ? session.getUser() : null;
        return Boolean(user && user.role === 'student');
    },

    _openUnknownPublicationTarget(page, moduleId) {
        const existing = this._publicationGatePending[page];
        if (
            existing
            && existing.unknownTarget === true
            && existing.moduleId === moduleId
            && existing.generation === this._transitionGeneration[page]
        ) {
            return true;
        }

        this._cancelPublicationGate(page);
        const generation = this._beginModuleTransition(page);
        const controller = new AbortController();
        this._publicationGatePending[page] = {
            moduleId,
            generation,
            unknownTarget: true,
            controller
        };
        this._resolvePublicationAccess(page, moduleId, controller.signal).then(access => {
            if (!this._isCurrentUnknownPublicationTarget(page, moduleId, controller, generation)) return;
            delete this._publicationGatePending[page];
            const code = access && access.error_code || 'publication_context_unavailable';
            if (code === 'activity_hidden' || code === 'activity_locked') {
                this.closeModule(page);
                return;
            }
            console.warn(code === 'course_unit_missing'
                ? UNKNOWN_MODULE_WARNING
                : PUBLICATION_CLASSIFICATION_WARNING);
            this.closeModule(page);
        }).catch(() => {
            if (!this._isCurrentUnknownPublicationTarget(page, moduleId, controller, generation)) return;
            delete this._publicationGatePending[page];
            console.warn(PUBLICATION_CLASSIFICATION_WARNING);
            this.closeModule(page);
        });
        return true;
    },

    _isCurrentUnknownPublicationTarget(page, moduleId, controller, generation) {
        const pending = this._publicationGatePending[page];
        return Boolean(
            pending
            && pending.controller === controller
            && pending.unknownTarget === true
            && pending.moduleId === moduleId
            && pending.generation === generation
            && this._transitionGeneration[page] === generation
            && !this.activeModule[page]
        );
    },

    _requiresPublicationGate(page, moduleId) {
        if (page !== 'physics' || !this._isStableModuleId(page, moduleId)) return false;
        const session = window.AstraApplicationSession;
        const user = session && typeof session.getUser === 'function' ? session.getUser() : null;
        return Boolean(user && user.role === 'student');
    },

    _openPublicationGuardedModule(page, moduleId, pageEl, sections) {
        const pending = this._publicationGatePending[page];
        if (
            pending
            && pending.moduleId === moduleId
            && pending.generation === this._transitionGeneration[page]
        ) {
            this._closeSidebar(page);
            return true;
        }

        const previousModule = this.activeModule[page];
        if (previousModule) {
            if (!this._releaseModuleRuntime(page, previousModule)) return false;
            this._releaseEvidenceRuntime(page, previousModule, pageEl);
            if (window.BackendContent && typeof BackendContent.destroyExperimentSchema === 'function') {
                try { BackendContent.destroyExperimentSchema(page, previousModule); } catch (error) {}
            }
        }

        this._cancelPublicationGate(page);
        const generation = this._beginModuleTransition(page);
        this.activeModule[page] = null;
        pageEl.querySelectorAll('[data-module].module-active').forEach(section => {
            section.classList.remove('module-active');
        });
        pageEl.querySelectorAll('.related-experiments').forEach(element => element.remove());
        this._hideModuleTools();
        this._closeSidebar(page);
        if (this._swipeBackCtrls[page]) {
            this._swipeBackCtrls[page].destroy();
            this._swipeBackCtrls[page] = null;
        }

        const gallery = document.getElementById(`gallery-${page}`);
        if (gallery) gallery.style.display = 'none';
        pageEl.classList.remove('module-gallery-active');
        const toggle = document.getElementById(`sidebar-toggle-${page}`);
        if (toggle) toggle.style.display = 'none';
        try {
            const nextHash = `#${page}/${moduleId}`;
            if (window.location.hash !== nextHash) history.replaceState(null, '', nextHash);
        } catch (error) {}

        const controller = new AbortController();
        this._publicationGatePending[page] = { moduleId, generation, controller };
        this._renderPublicationGate(page, pageEl, 'checking');
        window.scrollTo({ top: 0, behavior: 'smooth' });

        this._resolvePublicationAccess(page, moduleId, controller.signal).then(access => {
            if (!this._isCurrentPublicationGate(page, moduleId, generation)) return;
            delete this._publicationGatePending[page];
            if (access && access.available === true) {
                this._clearPublicationGate(page);
                this.openModule(page, moduleId, { authorityPrepared: true });
                return;
            }
            const code = access && access.error_code || 'publication_context_unavailable';
            if (code === 'course_unit_missing') {
                console.warn(UNKNOWN_MODULE_WARNING);
                this.closeModule(page);
                return;
            }
            if (this._isUndiscoverablePublicationAccess(code)) {
                this.closeModule(page);
                return;
            }
            this._renderPublicationGate(page, pageEl, code === 'activity_locked' ? 'locked' : 'unavailable', code);
        }).catch(() => {
            if (!this._isCurrentPublicationGate(page, moduleId, generation)) return;
            delete this._publicationGatePending[page];
            this._renderPublicationGate(page, pageEl, 'unavailable', 'publication_context_unavailable');
        });
        return true;
    },

    _isUndiscoverablePublicationAccess(code) {
        return code === 'activity_hidden'
            || code === 'activity_locked'
            || code === 'course_scope_missing';
    },

    _isCurrentPublicationGate(page, moduleId, generation) {
        const pending = this._publicationGatePending[page];
        return Boolean(
            pending
            && pending.moduleId === moduleId
            && pending.generation === generation
            && this._transitionGeneration[page] === generation
            && !this.activeModule[page]
        );
    },

    async _resolvePublicationAccess(page, moduleId, signal) {
        if (page !== 'physics' || !this._isStableModuleId(page, moduleId)) {
            return Object.freeze({ available: false, error_code: 'activity_mapping_missing' });
        }
        if (signal && signal.aborted) {
            return Object.freeze({ available: false, error_code: 'cancelled' });
        }
        const loader = window.AstraLearningEvidenceLoader;
        if (!loader || typeof loader.ensure !== 'function') {
            return Object.freeze({ available: false, error_code: 'publication_context_unavailable' });
        }
        await loader.ensure({ engineeringContext: true });
        if (signal && signal.aborted) {
            return Object.freeze({ available: false, error_code: 'cancelled' });
        }
        const context = window.AstraEngineeringLabPublicationContext;
        if (!context || typeof context.resolve !== 'function') {
            return Object.freeze({ available: false, error_code: 'publication_context_unavailable' });
        }
        const catalog = window.AstraLearningActivityCatalog;
        const activity = moduleId === 'mechanics'
            ? (catalog && typeof catalog.resolve === 'function'
                ? catalog.resolve('englab', 'physics.mechanics')
                : Object.freeze({
                    galaxy_key: 'englab',
                    course_key: 'physics',
                    activity_key: 'physics.mechanics'
                }))
            : Object.freeze({
                galaxy_key: 'englab',
                course_key: 'physics',
                activity_key: `physics.${moduleId}`
            });
        if (!activity) return Object.freeze({ available: false, error_code: 'activity_mapping_missing' });
        return context.resolve(activity, { signal });
    },

    _renderPublicationGate(page, pageEl, state, errorCode = '') {
        this._clearPublicationGate(page);
        const copy = {
            checking: {
                label: '正在确认课程发布状态',
                message: '确认完成前不会启动实验画布或交互资源。'
            },
            locked: {
                label: '该实验当前已锁定',
                message: '教师尚未开放“力学模拟”。实验画布与交互资源均未启动。'
            },
            unavailable: {
                label: '暂不能进入该实验',
                message: errorCode === 'class_selection_required'
                    ? '请返回学生工作台，选择本次学习所属班级后再进入。'
                    : '无法确认当前班级的权威发布状态，已保持失败关闭。'
            }
        }[state] || {
            label: '暂不能进入该实验',
            message: '无法确认当前班级的权威发布状态，已保持失败关闭。'
        };
        const gate = document.createElement('section');
        gate.className = 'physics-publication-gate';
        gate.dataset.moduleAccessGate = page;
        gate.dataset.moduleAccessState = state;
        gate.setAttribute('role', state === 'checking' ? 'status' : 'alert');
        gate.setAttribute('aria-live', 'polite');
        gate.innerHTML = `
            <span class="physics-publication-gate__eyebrow">课程发布状态</span>
            <h2>${copy.label}</h2>
            <p>${copy.message}</p>
            <button type="button" data-module-access-return="${page}">安全返回物理实验列表</button>
        `;
        const returnButton = gate.querySelector('[data-module-access-return]');
        if (returnButton) returnButton.addEventListener('click', () => this.closeModule(page));
        pageEl.appendChild(gate);
        this._publicationGateNodes[page] = gate;
        if (state !== 'checking' && returnButton) returnButton.focus();
    },

    _clearPublicationGate(page) {
        const gate = this._publicationGateNodes[page];
        if (gate && typeof gate.remove === 'function') gate.remove();
        delete this._publicationGateNodes[page];
    },

    _cancelPublicationGate(page) {
        const pending = this._publicationGatePending[page];
        if (pending && pending.controller && typeof pending.controller.abort === 'function') {
            try { pending.controller.abort(); } catch (error) {}
        }
        delete this._publicationGatePending[page];
        this._clearPublicationGate(page);
    },

    _hideModuleTools() {
        const actions = [
            () => {
                const guide = this._getExperimentGuide();
                if (guide) guide.hideHelpButton();
            },
            () => { if (window.ExperimentExport) ExperimentExport.hide(); },
            () => { if (window.ExperimentQuiz) ExperimentQuiz.hide(); },
            () => { if (window.ExperimentFavorites) ExperimentFavorites.hide(); },
            () => { if (window.ExperimentRating) ExperimentRating.hide(); }
        ];
        actions.forEach((action) => {
            try { action(); } catch (error) { /* page leave must continue */ }
        });
    },

    _preparePageCleanup(page) {
        const subjectZoom = page === 'physics'
            ? window.PhysicsZoom
            : (page === 'biology' ? window.BiologyZoom : null);
        try {
            if (subjectZoom && typeof subjectZoom.close === 'function') subjectZoom.close();
            return true;
        } catch (error) {
            // Canvas cleanup must continue even if the shared zoom overlay cannot close.
            return false;
        }
    },

    _releaseModuleRuntime(page, moduleId, options = {}) {
        if (!moduleId || options.skipExperimentCleanup === true) return true;
        const registry = window.AstraExperimentRegistry;
        const definition = registry && typeof registry.get === 'function'
            ? registry.get(page, moduleId)
            : null;
        if (!definition) {
            console.warn('[ModuleSelector] refusing transition for unknown module:', `${page}:${moduleId}`);
            return false;
        }
        if (!this._preparePageCleanup(page)) {
            console.warn('[ModuleSelector] refusing transition because the subject zoom could not close:', `${page}:${moduleId}`);
            return false;
        }
        if (definition.cleanup?.verified !== true) return true;

        const key = `${page}:${moduleId}`;
        if (!this._initialized[key] && !this._runtimeDirty[key]) return true;
        let cleanupReport = null;
        try {
            cleanupReport = registry.cleanupModule(page, moduleId);
        } catch (error) {}
        if (!cleanupReport || cleanupReport.outcome !== 'cleaned' || cleanupReport.executed !== 1) {
            console.warn('[ModuleSelector] refusing transition because exact cleanup did not complete:', `${page}:${moduleId}`);
            return false;
        }
        delete this._initialized[key];
        delete this._runtimeDirty[key];
        return true;
    },

    _releaseEvidenceRuntime(page, moduleId, pageEl) {
        if (window.AstraLearningEvidenceActivity) {
            window.AstraLearningEvidenceActivity.destroyWithin(pageEl);
        }
        if (
            page === 'physics'
            && moduleId === 'mechanics'
            && window.AstraLearningEvidenceLoader
        ) {
            window.AstraLearningEvidenceLoader.clearDomainCommands('englab', 'physics.mechanics');
        }
    },

    _ownerReleaseSucceeded(report) {
        return Boolean(
            report
            && Number.isInteger(report.attempted)
            && Number.isInteger(report.executed)
            && Number.isInteger(report.failed)
            && report.attempted > 0
            && report.executed > 0
            && report.executed <= report.attempted
            && report.failed === 0
        );
    },

    _mountEvidenceRuntime(page, moduleId, pageEl, sections, generation) {
        if (
            page !== 'physics'
            || moduleId !== 'mechanics'
            || !window.AstraLearningEvidenceLoader
        ) return;
        window.AstraLearningEvidenceLoader.ensure({ activity: true, engineeringContext: true }).then(() => {
            if (!this._isCurrentModuleTransition(page, moduleId, generation)) return;
            const host = Array.from(sections).find(section => section.isConnected && section.classList.contains('module-active'));
            if (!host || !pageEl.isConnected || !window.AstraLearningEvidenceActivity) return;
            window.AstraLearningEvidenceActivity.mount({
                host,
                galaxy_key: 'englab',
                activity_key: 'physics.mechanics',
                title: '力学实验学习证据',
                integrated: true,
                operationLabel: '完成上方 e=0.40 / e=0.80 受控对照并修正判断'
            });
        }).catch(error => {
            if (this._isCurrentModuleTransition(page, moduleId, generation)) {
                window.AstraLearningEvidenceLoader.clearDomainCommands('englab', 'physics.mechanics');
                console.warn('[ModuleSelector] learning evidence unavailable', error && (error.code || error.message));
            }
        });
    },

    closeModule(page, options = {}) {
        const pageEl = document.getElementById(`page-${page}`);
        if (!pageEl) return false;
        const activeModule = this.activeModule[page];
        if (activeModule && !this._releaseModuleRuntime(page, activeModule, options)) return false;
        if (activeModule && options.skipEvidenceCleanup !== true) {
            this._releaseEvidenceRuntime(page, activeModule, pageEl);
        }
        const generation = options.transitionGeneration || this._beginModuleTransition(page);
        this._cancelPublicationGate(page);
        if (activeModule && window.BackendContent && typeof BackendContent.destroyExperimentSchema === 'function') {
            try { BackendContent.destroyExperimentSchema(page, activeModule); } catch (error) {}
        }

        this._hideModuleTools();

        // Hide all module sections
        pageEl.querySelectorAll('[data-module].module-active').forEach(s => {
            s.classList.remove('module-active');
        });

        // v4.5-α3: 移除相关实验推荐面板
        pageEl.querySelectorAll('.related-experiments').forEach(el => el.remove());

        // Show gallery
        const gallery = document.getElementById(`gallery-${page}`);
        if (gallery) gallery.style.display = '';

        // Update favorite indicators on gallery cards
        if (window.ExperimentFavorites) ExperimentFavorites.updateGalleryCards();

        // Restore gallery-active state
        pageEl.classList.add('module-gallery-active');

        // Hide sidebar and toggle
        this._closeSidebar(page);
        const toggle = document.getElementById(`sidebar-toggle-${page}`);
        if (toggle) toggle.style.display = 'none';

        this.activeModule[page] = null;

        // v6.1：清理深链接，把 #subject/experiment 还原成 #subject
        if (!options.preserveHash) {
            try {
                const newHash = '#' + page;
                if (window.location.hash !== newHash) {
                    history.replaceState(null, '', newHash);
                }
            } catch (e) {}
        }

        // Clear sidebar active states
        const sidebar = this._sidebars[page];
        if (sidebar) {
            sidebar.querySelectorAll('.module-sidebar__item.active').forEach(i => i.classList.remove('active'));
        }

        window.scrollTo({ top: 0, behavior: 'smooth' });

        // Destroy swipe-back gesture for this page
        if (this._swipeBackCtrls[page]) {
            this._swipeBackCtrls[page].destroy();
            this._swipeBackCtrls[page] = null;
        }
        return generation > 0;
    },

    leavePage(page, options = {}) {
        const generation = this._beginModuleTransition(page);
        const activeModule = this.activeModule[page];
        try {
            if (activeModule) {
                this.closeModule(page, {
                    ...options,
                    skipExperimentCleanup: true,
                    skipEvidenceCleanup: true,
                    transitionGeneration: generation
                });
            }
        } catch (error) {
            // Continue through the same best-effort phases that legacy Router used.
        }
        this._hideModuleTools();
        this._preparePageCleanup(page);
        let cleanupReport = Object.freeze({ attempted: 0, executed: 0, failed: 0 });
        try {
            cleanupReport = window.AstraExperimentRegistry?.cleanupPage(page) || cleanupReport;
        } catch (error) {
            cleanupReport = Object.freeze({ attempted: 0, executed: 0, failed: 1 });
        }
        if (activeModule && this._ownerReleaseSucceeded(cleanupReport)) {
            const pageEl = typeof document !== 'undefined'
                ? document.getElementById(`page-${page}`)
                : null;
            if (pageEl) this._releaseEvidenceRuntime(page, activeModule, pageEl);
        }
        try { this.resetPage(page); } catch (error) { /* keep navigation moving */ }
        return cleanupReport;
    },

    toggleSidebar(page) {
        if (this._sidebarOpen[page]) {
            this._closeSidebar(page);
        } else {
            this._openSidebar(page);
        }
    },

    _openSidebar(page) {
        const sidebar = this._sidebars[page];
        const toggle = document.getElementById(`sidebar-toggle-${page}`);
        const backdrop = document.getElementById('module-sidebar-backdrop');

        if (sidebar) sidebar.classList.add('open');
        if (toggle) toggle.classList.add('shifted');
        this._sidebarOpen[page] = true;

        // 移动端显示遮罩，桌面端保持覆盖式侧栏
        if (window.innerWidth <= 768) {
            if (backdrop) backdrop.classList.add('visible');
        }
    },

    _closeSidebar(page) {
        const sidebar = this._sidebars[page];
        const toggle = document.getElementById(`sidebar-toggle-${page}`);
        const backdrop = document.getElementById('module-sidebar-backdrop');

        if (sidebar) sidebar.classList.remove('open');
        if (toggle) toggle.classList.remove('shifted');
        if (backdrop) backdrop.classList.remove('visible');
        this._sidebarOpen[page] = false;
    },

    _closeSidebarForCurrentPage() {
        const page = Router.currentPage;
        if (page && this._sidebars[page]) {
            this._closeSidebar(page);
        }
    },

    // ── Lazy Module Initialization ──
    // Only initialize a module when it is first opened.
    _loadScript(src) {
        if (!src) return Promise.resolve();
        if (this._scriptPromises[src]) return this._scriptPromises[src];

        this._scriptPromises[src] = new Promise((resolve, reject) => {
            const plainSrc = src.split('?')[0];
            const existing = Array.from(document.scripts).find(script => {
                const current = script.getAttribute('src') || '';
                return current === src || current.split('?')[0] === plainSrc;
            });

            if (existing && existing.dataset.moduleLoaderLoaded === 'true') {
                resolve();
                return;
            }
            if (existing && !existing.dataset.moduleLoaderSrc) {
                resolve();
                return;
            }

            const script = existing || document.createElement('script');
            if (!existing) {
                script.src = src;
                script.async = true;
                script.dataset.moduleLoaderSrc = src;
                document.body.appendChild(script);
            }

            script.addEventListener('load', () => {
                script.dataset.moduleLoaderLoaded = 'true';
                resolve();
            }, { once: true });

            script.addEventListener('error', () => {
                delete this._scriptPromises[src];
                reject(new Error(`Failed to load ${src}`));
            }, { once: true });
        });

        return this._scriptPromises[src];
    },

    _loadModuleAssets(page, moduleId) {
        const scripts = [];
        const experimentScript = window.AstraExperimentRegistry?.scriptFor(page, moduleId);
        if (experimentScript) scripts.push(experimentScript);
        if (this._pageEnhancementScripts[page]) scripts.push(...this._pageEnhancementScripts[page]);

        return scripts.reduce(
            (chain, src) => chain.then(() => this._loadScript(src)),
            Promise.resolve()
        );
    },

    _initModule(page, moduleId, generation = this._transitionGeneration[page]) {
        const key = `${page}:${moduleId}`;
        if (this._initialized[key] || this._runtimeDirty[key]) {
            if (this._isCurrentModuleTransition(page, moduleId, generation)) {
                this._showModuleTools(page, moduleId);
            }
            return;
        }

        const initFn = () => window.AstraExperimentRegistry?.init(page, moduleId) || false;
        const runInit = (attempt = 0) => {
            if (!this._isCurrentModuleTransition(page, moduleId, generation)) return;
            let initialized = false;
            try {
                initialized = initFn();
            } catch (error) {
                if (this._isCurrentModuleTransition(page, moduleId, generation)) {
                    this._runtimeDirty[key] = true;
                    console.warn('[ModuleSelector] init function failed:', moduleId, error);
                }
                return;
            }
            if (initialized === false && attempt < 20) {
                this._scheduleModuleTask(page, moduleId, generation, 100, () => runInit(attempt + 1));
                return;
            }
            if (initialized === false) {
                console.warn('[ModuleSelector] init function unavailable after script load:', moduleId);
                return;
            }
            if (!this._isCurrentModuleTransition(page, moduleId, generation)) return;
            this._initialized[key] = true;
            delete this._runtimeDirty[key];
            if (page === 'physics' && window.PhysicsZoom && typeof window.PhysicsZoom.init === 'function') {
                try { window.PhysicsZoom.init(); } catch (error) {}
            }
            if (page === 'biology' && window.BiologyZoom && typeof window.BiologyZoom.init === 'function') {
                try { window.BiologyZoom.init(); } catch (error) {}
            }
            this._showModuleTools(page, moduleId);
        };
        this._loadModuleAssets(page, moduleId)
            .then(() => {
                if (!this._isCurrentModuleTransition(page, moduleId, generation)) return;
                this._scheduleModuleTask(page, moduleId, generation, 50, () => runInit());
            })
            .catch(error => {
                if (this._isCurrentModuleTransition(page, moduleId, generation)) {
                    console.warn('[ModuleSelector] failed to load module assets:', moduleId, error);
                }
            });
    },

    _showModuleTools(page, moduleId) {
        // Show experiment guide on first visit
        const guide = this._getExperimentGuide();
        if (guide) {
            guide.showIfFirstTime(page, moduleId);
            guide.showHelpButton(page, moduleId);
        }
        // Show export button (E-03)
        if (window.ExperimentExport) {
            ExperimentExport.show(page, moduleId);
        }
        // Show quiz FAB (X-02)
        if (window.ExperimentQuiz) {
            ExperimentQuiz.show(moduleId);
        }
        // Show favorites button
        if (window.ExperimentFavorites) {
            ExperimentFavorites.show(moduleId);
        }
        // Show rating card after delay
        if (window.ExperimentRating) {
            ExperimentRating.show(moduleId);
        }
    },

    _showRelatedExperiments(page, moduleId, generation, attempt = 0) {
        this._scheduleModuleTask(page, moduleId, generation, attempt === 0 ? 80 : 100, () => {
            if (typeof RelatedExperiments !== 'undefined' && typeof RelatedExperiments.show === 'function') {
                RelatedExperiments.show(page, moduleId);
                return;
            }
            if (attempt < 20) this._showRelatedExperiments(page, moduleId, generation, attempt + 1);
        });
    },

    _applyBackendSchema(page, moduleId) {
        if (!window.BackendContent || typeof BackendContent.applyExperimentSchema !== 'function') {
            return Promise.resolve(false);
        }
        try {
            return Promise.resolve(BackendContent.applyExperimentSchema(page, moduleId));
        } catch (e) {
            console.warn('[ModuleSelector] backend schema apply failed:', moduleId, e);
            return Promise.resolve(false);
        }
    },

    // Reset initialization state when leaving a page (so re-entering re-inits)
    resetPage(page) {
        const experiments = CONFIG.experiments[page];
        if (!experiments) return;
        this._cancelPublicationGate(page);
        if (window.BackendContent && typeof BackendContent.destroyPage === 'function') {
            try { BackendContent.destroyPage(page); } catch (error) { /* state reset must continue */ }
        }
        experiments.forEach(exp => {
            delete this._initialized[`${page}:${exp.id}`];
            delete this._runtimeDirty[`${page}:${exp.id}`];
        });
        this.activeModule[page] = null;

        // Reset sidebar
        this._closeSidebar(page);
        const toggle = document.getElementById(`sidebar-toggle-${page}`);
        if (toggle) toggle.style.display = 'none';

        // Show gallery
        const pageEl = document.getElementById(`page-${page}`);
        if (pageEl) {
            pageEl.querySelectorAll('[data-module].module-active').forEach(s => {
                s.classList.remove('module-active');
            });
            pageEl.classList.add('module-gallery-active');
            const gallery = document.getElementById(`gallery-${page}`);
            if (gallery) gallery.style.display = '';
        }

        // Clear sidebar active states
        const sidebar = this._sidebars[page];
        if (sidebar) {
            sidebar.querySelectorAll('.module-sidebar__item.active').forEach(i => i.classList.remove('active'));
        }
    },

    // Show back button (kept for backward compat, now no-op since sidebar handles it)
    showBackButton() {},

    // ── E-04: Keyboard Navigation ──

    _initKeyboardNav() {
        document.addEventListener('keydown', (e) => {
            // Skip if user is typing in an input/textarea/select
            const tag = (e.target.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

            const page = typeof Router !== 'undefined' ? Router.currentPage : null;
            if (!page) return;

            if (e.key === 'Escape') {
                // Priority chain: zoom modal → guide overlay → export menu → sidebar → experiment
                const zoomModal = document.querySelector('.physics-zoom-modal.open, .biology-zoom-modal.open');
                if (zoomModal) return; // Let zoom modal handle its own Esc

                const guideOverlay = document.getElementById('experiment-guide-overlay');
                if (guideOverlay && guideOverlay.classList.contains('active')) return; // Guide handles Esc

                // Close export menu if open
                if (window.ExperimentExport && ExperimentExport._menuOpen) {
                    ExperimentExport._closeMenu();
                    e.preventDefault();
                    return;
                }

                // Close sidebar if open
                if (this._sidebarOpen[page]) {
                    this._closeSidebar(page);
                    e.preventDefault();
                    return;
                }

                // Close experiment → back to gallery
                if (this.activeModule[page]) {
                    this.closeModule(page);
                    e.preventDefault();
                    return;
                }
            }

            // Arrow keys in sidebar
            if (this._sidebarOpen[page] && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                this._sidebarArrowNav(page, e.key === 'ArrowDown' ? 1 : -1);
                e.preventDefault();
            }
        });
    },

    _sidebarArrowNav(page, direction) {
        const sidebar = this._sidebars[page];
        if (!sidebar) return;
        const items = Array.from(sidebar.querySelectorAll('.module-sidebar__item[data-module-target]'));
        if (items.length === 0) return;

        const focused = document.activeElement;
        let idx = items.indexOf(focused);
        if (idx < 0) {
            // Find currently active item
            idx = items.findIndex(i => i.classList.contains('active'));
        }
        idx = Math.max(0, Math.min(items.length - 1, idx + direction));
        items[idx].focus();
    },

    // Focus the first interactive control inside the experiment when it opens
    _focusExperiment(page, moduleId, generation = this._transitionGeneration[page], backendSchemaReady = null) {
        const pageEl = document.getElementById(`page-${page}`);
        if (!pageEl) return;
        if (!pageEl.querySelector(`[data-module="${moduleId}"].module-active`)) return;

        // Backend schema may replace the module's leading card after openModule().
        // Resolve the active section and focus target at execution time so a detached
        // pre-schema node cannot silently return focus to <body>.
        const focusCurrentTarget = (onlyIfLost = false) => {
            const currentSection = pageEl.querySelector(`[data-module="${moduleId}"].module-active`);
            if (!currentSection) return;
            if (onlyIfLost) {
                const active = document.activeElement;
                if (active && active !== document.body && active.isConnected !== false) return;
            }
            const focusable = currentSection.querySelector(
                'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
            );
            if (focusable) focusable.focus();
        };
        this._scheduleModuleTask(page, moduleId, generation, 200, () => focusCurrentTarget(false));
        if (backendSchemaReady && typeof backendSchemaReady.then === 'function') {
            backendSchemaReady.then(() => {
                if (!this._isCurrentModuleTransition(page, moduleId, generation)) return;
                this._scheduleModuleTask(page, moduleId, generation, 0, () => focusCurrentTarget(true));
            }).catch(() => {});
        }
    }
};
