const BackendContent = {
    _schemaRequests: new Map(),
    _renderGenerations: new WeakMap(),
    _renderIntents: new WeakMap(),
    _activeRenderIntents: new Set(),
    _sandboxControllers: new WeakMap(),
    _activeSandboxControllers: new Set(),
    _sandboxReadyTimeoutMs: 10000,

    isEnabled() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            if (params.get('backendSchema') === '1') return true;
            if (params.get('backendSchema') === '0') return false;
            return window.localStorage && window.localStorage.getItem('astra-backend-schema') === '1';
        } catch (e) {
            return false;
        }
    },

    getApiBaseUrl() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            const queryBase = params.get('apiBase');
            const configured = typeof CONFIG !== 'undefined' && CONFIG.backend && CONFIG.backend.apiBaseUrl;
            const stored = window.localStorage && window.localStorage.getItem('astra-api-base');
            return AstraApiClient.normalizeBaseUrl(queryBase || stored || configured || '');
        } catch (e) {
            return '';
        }
    },

    fetchPageSchema(slug) {
        if (!this.isEnabled() || !slug) return Promise.resolve(null);
        const key = `${this.getApiBaseUrl()}::${slug}`;
        const existing = this._schemaRequests.get(key);
        if (existing) return existing.promise;
        const controller = new AbortController();
        const encodedSlug = slug.split('/').map(encodeURIComponent).join('/');
        const request = AstraApiClient.request(`/api/render/page/${encodedSlug}`, {
            baseUrl: this.getApiBaseUrl(),
            signal: controller.signal
        }).finally(() => {
            const current = this._schemaRequests.get(key);
            if (current && current.promise === request) this._schemaRequests.delete(key);
        });
        this._schemaRequests.set(key, { promise: request, controller });
        return request;
    },

    applyExperimentSchema(page, moduleId) {
        if (!page || !moduleId) return Promise.resolve(false);
        const slug = `${page}/${moduleId}`;
        const target = document.querySelector(`#page-${page} [data-module="${moduleId}"]`);
        if (!target) return Promise.resolve(false);
        if (!this.isEnabled()) {
            this._removeRenderIntent(target);
            this._clearBackendViews(target);
            return Promise.resolve(true);
        }
        this._setRenderIntent(target, page, moduleId);
        this._clearBackendViews(target);
        const generation = (this._renderGenerations.get(target) || 0) + 1;
        this._renderGenerations.set(target, generation);
        return this.fetchPageSchema(slug).then((schema) => {
            if (this._renderGenerations.get(target) !== generation) return;
            if (!schema || schema.layout !== 'experiment-page') {
                throw new AstraApiClient.Error('后端内容结构无效', {
                    code: 'invalid_response',
                    mutation: false,
                    ambiguous: false
                });
            }
            this._removeSchemaError(target);
            this._renderLearningTask(target, schema);
            this._renderScriptSandbox(target, schema, moduleId);
        }).catch((error) => {
            if (this._renderGenerations.get(target) !== generation) return;
            if (AstraApiClient.isCancelled(error) && navigator.onLine !== false) return;
            this._clearBackendViews(target);
            this._renderSchemaError(target, page, moduleId, error);
        });
    },

    destroyExperimentSchema(page, moduleId) {
        const target = document.querySelector(`#page-${page} [data-module="${moduleId}"]`);
        if (target) {
            this._renderGenerations.set(target, (this._renderGenerations.get(target) || 0) + 1);
            this._removeRenderIntent(target);
            this._clearBackendViews(target, { restoreStatic: false });
        }
    },

    destroyPage(page) {
        const root = document.getElementById(`page-${page}`);
        if (!root) return;
        root.querySelectorAll('[data-module]').forEach((target) => {
            this._renderGenerations.set(target, (this._renderGenerations.get(target) || 0) + 1);
            this._removeRenderIntent(target);
            this._clearBackendViews(target, { restoreStatic: false });
        });
    },

    destroyAll() {
        this._abortSchemaRequests();
        document.querySelectorAll('[data-module]').forEach((target) => {
            this._renderGenerations.set(target, (this._renderGenerations.get(target) || 0) + 1);
            this._removeRenderIntent(target);
            this._clearBackendViews(target, { restoreStatic: false });
        });
        this._activeRenderIntents.clear();
        this._renderIntents = new WeakMap();
    },

    _renderLearningTask(target, schema) {
        const task = Array.isArray(schema.sections)
            ? schema.sections.find((section) => section.type === 'learning-task')
            : null;
        if (!task) {
            this._removeLearningCard(target);
            return;
        }

        let card = target.querySelector('[data-backend-schema-card]');
        if (!card) {
            card = document.createElement('aside');
            card.className = 'backend-learning-card';
            card.setAttribute('data-backend-schema-card', 'true');
            const insertBefore = Array.from(target.children).find((child) =>
                child.matches && child.matches('.experiment-container, .physics-canvas-wrap, .lab-shell')
            );
            target.insertBefore(card, insertBefore || target.firstElementChild);
        }

        const concepts = task.props && Array.isArray(task.props.concepts)
            ? task.props.concepts.slice(0, 4)
            : [];
        card.innerHTML = `
            <div class="backend-learning-card__body">
                <div class="backend-learning-card__eyebrow">${this._escape(schema.title || '学习任务')}</div>
                <h3 class="backend-learning-card__title">${this._escape(task.title || '观察任务')}</h3>
                <p class="backend-learning-card__summary">${this._escape(task.summary || schema.summary || '')}</p>
                ${concepts.length ? `<div class="backend-learning-card__concepts">${concepts.map((item) => `<span>${this._escape(item)}</span>`).join('')}</div>` : ''}
            </div>
        `;
    },

    _renderSchemaError(target, page, moduleId, error) {
        this._destroyScriptSandbox(target);
        this._removeLearningCard(target);
        this._removeSchemaError(target);
        const card = document.createElement('aside');
        card.className = 'backend-learning-card backend-learning-card--error';
        card.setAttribute('data-backend-schema-error', 'true');
        card.innerHTML = `
            <div class="backend-learning-card__body">
                <div class="backend-learning-card__eyebrow">后端内容暂不可用</div>
                <h3 class="backend-learning-card__title">继续使用当前静态实验</h3>
                <p class="backend-learning-card__summary">${this._escape(AstraApiClient.message(error))}。未使用旧 API 缓存冒充实时内容。</p>
            </div>
            <button type="button" class="backend-sandbox-card__refresh" data-backend-schema-retry aria-label="重新读取后端内容">
                <i data-lucide="refresh-cw" aria-hidden="true"></i>
            </button>
        `;
        const retry = card.querySelector('[data-backend-schema-retry]');
        if (retry) retry.addEventListener('click', () => this.applyExperimentSchema(page, moduleId));
        target.insertBefore(card, target.firstElementChild);
        this._refreshIcons(card);
    },

    _removeSchemaError(target) {
        const card = target && target.querySelector('[data-backend-schema-error]');
        if (card) card.remove();
    },

    _removeLearningCard(target) {
        const card = target && target.querySelector('[data-backend-schema-card]');
        if (card) card.remove();
    },

    _clearBackendViews(target, options = {}) {
        if (!target) return;
        this._destroyScriptSandbox(target, options);
        this._removeLearningCard(target);
        this._removeSchemaError(target);
    },

    _setRenderIntent(target, page, moduleId) {
        let intent = this._renderIntents.get(target);
        if (!intent) {
            intent = { target, page: String(page), moduleId: String(moduleId) };
            this._renderIntents.set(target, intent);
            this._activeRenderIntents.add(intent);
            return;
        }
        intent.page = String(page);
        intent.moduleId = String(moduleId);
    },

    _removeRenderIntent(target) {
        const intent = this._renderIntents.get(target);
        if (intent) this._activeRenderIntents.delete(intent);
        this._renderIntents.delete(target);
    },

    _abortSchemaRequests() {
        this._schemaRequests.forEach((entry) => {
            if (entry.controller && !entry.controller.signal.aborted) entry.controller.abort();
        });
        this._schemaRequests.clear();
    },

    _renderScriptSandbox(target, schema, moduleId) {
        const entry = this._findScriptManifest(schema, moduleId);
        if (!entry || !entry.manifest) {
            this._destroyScriptSandbox(target);
            return;
        }

        const embed = entry.manifest.embed;
        if (!embed || embed.status !== 'embeddable' || !embed.iframe) {
            this._renderBlockedSandbox(target, entry);
            return;
        }

        this._mountScriptSandbox(target, schema, entry, embed);
    },

    _mountScriptSandbox(target, schema, entry, embed, options = {}) {
        const iframeConfig = embed.iframe || {};
        const src = this._absoluteApiUrl(iframeConfig.src);
        const sandboxTokens = String(iframeConfig.sandbox || '').trim();
        const protocol = embed.messageProtocol || {};
        const documentContract = embed.document || {};
        const sandboxId = String(embed.sandboxId || entry.manifest.sandboxId || '');
        const validContract = (
            embed.descriptorVersion === 'astra-script-sandbox-embed-v1'
            && embed.originModel === 'opaque'
            && sandboxId
            && protocol.source === 'astra-content-script-sandbox'
            && protocol.sandboxId === sandboxId
            && protocol.bootstrapProtocolVersion === 'astra-script-sandbox-bootstrap-v1'
            && typeof documentContract.contractVersion === 'string'
            && documentContract.contractVersion
            && typeof documentContract.templateId === 'string'
            && documentContract.templateId
        );
        if (!src || !this._isSafeIframeSandbox(sandboxTokens) || !validContract) {
            this._renderBlockedSandbox(target, entry);
            return;
        }
        const existing = this._sandboxControllers.get(target);
        if (!options.force && existing && !existing.destroyed && existing.src === src && existing.sandboxId === sandboxId) {
            return;
        }

        this._destroyScriptSandbox(target);

        const shell = document.createElement('aside');
        shell.className = 'backend-sandbox-card';
        shell.setAttribute('data-backend-sandbox-card', 'true');
        shell.dataset.state = 'loading';
        shell.dataset.sandboxId = String(embed.sandboxId || '');

        shell.innerHTML = `
            <div class="backend-sandbox-card__header">
                <div>
                    <div class="backend-sandbox-card__eyebrow">${this._escape(schema.title || '脚本沙箱')}</div>
                    <h3 class="backend-sandbox-card__title">${this._escape(entry.sectionTitle || '交互实验')}</h3>
                </div>
                <div class="backend-sandbox-card__actions">
                    <span class="backend-sandbox-card__status" data-backend-sandbox-status>加载中</span>
                    <button class="backend-sandbox-card__refresh" type="button" aria-label="刷新沙箱" data-backend-sandbox-refresh title="刷新沙箱">
                        <i data-lucide="refresh-cw" aria-hidden="true"></i>
                    </button>
                </div>
            </div>
            <div class="backend-sandbox-card__frame-wrap">
                <iframe class="backend-sandbox-card__frame" data-backend-sandbox-frame></iframe>
            </div>
            <p class="backend-sandbox-card__message" data-backend-sandbox-message>等待隔离内容响应。</p>
        `;

        const insertBefore = Array.from(target.children).find((child) =>
            child.matches && child.matches('.demo-section, .experiment-container, .physics-canvas-wrap, .lab-shell')
        );
        target.insertBefore(shell, insertBefore || target.firstElementChild);

        const iframe = shell.querySelector('[data-backend-sandbox-frame]');
        const refresh = shell.querySelector('[data-backend-sandbox-refresh]');
        const expectedSource = String(protocol.source || 'astra-content-script-sandbox');
        const expectedProtocolVersion = String(protocol.bootstrapProtocolVersion || '');
        const controller = {
            target,
            shell,
            iframe,
            src,
            sandboxId,
            moduleId: String((entry && entry.moduleId) || ''),
            expectedSource,
            expectedProtocolVersion,
            expectedDocumentContractVersion: String(documentContract.contractVersion),
            expectedTemplateId: String(documentContract.templateId),
            state: 'loading',
            destroyed: false,
            terminal: false,
            staticRuntimeSuspended: false,
            lastMessageType: '',
            initialLoadObserved: false,
            timeoutId: null,
            onMessage: null,
            onLoad: null,
            onError: null,
        };

        controller.onMessage = (event) => this._handleSandboxMessage(controller, event);
        controller.onLoad = () => {
            if (controller.destroyed || controller.terminal) return;
            if (!controller.initialLoadObserved) {
                controller.initialLoadObserved = true;
                if (controller.state !== 'loading') return;
                this._setSandboxState(controller, 'bootstrapping', '隔离文档已加载，等待脚本启动。');
                return;
            }
            this._markSandboxTerminal(controller, 'error', '隔离内容发生未预期导航，已恢复静态实验。');
        };
        controller.onError = () => {
            this._markSandboxTerminal(controller, 'error', '隔离内容加载失败。');
        };

        window.addEventListener('message', controller.onMessage);
        iframe.addEventListener('load', controller.onLoad);
        iframe.addEventListener('error', controller.onError);
        if (refresh) {
            refresh.addEventListener('click', () => this._mountScriptSandbox(target, schema, entry, embed, { force: true }));
        }

        if (sandboxTokens) iframe.setAttribute('sandbox', sandboxTokens);
        iframe.referrerPolicy = String(iframeConfig.referrerPolicy || 'no-referrer');
        iframe.loading = String(iframeConfig.loading || 'lazy');
        iframe.title = String(iframeConfig.title || 'Astra Script Sandbox');
        iframe.src = src;

        controller.timeoutId = window.setTimeout(() => {
            const detail = controller.lastMessageType === 'assets-ready'
                ? '脚本资产已加载，但内容尚未发出 ready。'
                : '隔离内容响应超时。';
            this._markSandboxTerminal(controller, 'timeout', detail);
        }, this._sandboxReadyTimeoutMs);

        this._sandboxControllers.set(target, controller);
        this._activeSandboxControllers.add(controller);
        this._refreshIcons(shell);
    },

    _handleSandboxMessage(controller, event) {
        if (controller.destroyed
            || controller.terminal
            || event.source !== controller.iframe.contentWindow
            || event.origin !== 'null') return;
        const data = event.data || {};
        if (!data || data.source !== controller.expectedSource) return;
        const metadata = data.metadata || {};
        if (metadata.sandboxId !== controller.sandboxId) return;
        if (controller.expectedProtocolVersion && metadata.protocolVersion !== controller.expectedProtocolVersion) {
            return;
        }
        if (metadata.documentContractVersion !== controller.expectedDocumentContractVersion
            || metadata.templateId !== controller.expectedTemplateId) return;

        const type = String(data.type || '');
        controller.lastMessageType = type;
        if (type === 'bootstrap-ready') {
            if (!['loading', 'bootstrapping'].includes(controller.state)) return;
            this._setSandboxState(controller, 'bootstrapping', '脚本启动中。');
            return;
        }
        if (type === 'assets-ready') {
            if (!['loading', 'bootstrapping', 'assets'].includes(controller.state)) return;
            const assetCount = data.payload && Number.isFinite(data.payload.assetCount)
                ? data.payload.assetCount
                : null;
            const suffix = assetCount === null ? '' : `（${assetCount} 个资产）`;
            this._setSandboxState(controller, 'assets', `脚本资产已加载${suffix}。`);
            return;
        }
        if (type === 'ready') {
            if (!['loading', 'bootstrapping', 'assets'].includes(controller.state)) return;
            if (!this._activateSandboxRuntime(controller)) {
                this._markSandboxTerminal(controller, 'error', '静态实验未能安全切换到隔离运行时。');
                return;
            }
            this._setSandboxState(controller, 'ready', '隔离内容已就绪。');
            this._clearSandboxTimer(controller);
            return;
        }
        if (type === 'resize') {
            if (controller.state !== 'ready') return;
            const requested = Number(data.payload && data.payload.height);
            if (Number.isFinite(requested)) {
                controller.iframe.style.height = `${Math.min(900, Math.max(320, requested))}px`;
            }
            return;
        }
        if (type === 'error' || type === 'unhandledrejection') {
            const message = this._sandboxErrorMessage(data.payload);
            this._markSandboxTerminal(controller, 'error', message);
        }
    },

    _renderBlockedSandbox(target, entry) {
        this._destroyScriptSandbox(target);
        target.classList.remove('backend-sandbox-runtime-active');

        const shell = document.createElement('aside');
        shell.className = 'backend-sandbox-card backend-sandbox-card--blocked';
        shell.setAttribute('data-backend-sandbox-card', 'true');
        shell.dataset.state = 'blocked';
        shell.innerHTML = `
            <div class="backend-sandbox-card__header">
                <div>
                    <div class="backend-sandbox-card__eyebrow">脚本沙箱</div>
                    <h3 class="backend-sandbox-card__title">${this._escape(entry.sectionTitle || '交互实验')}</h3>
                </div>
                <span class="backend-sandbox-card__status" data-backend-sandbox-status>已阻止</span>
            </div>
            <p class="backend-sandbox-card__message" data-backend-sandbox-message>当前脚本未进入可执行隔离路径。</p>
        `;

        const insertBefore = Array.from(target.children).find((child) =>
            child.matches && child.matches('.demo-section, .experiment-container, .physics-canvas-wrap, .lab-shell')
        );
        target.insertBefore(shell, insertBefore || target.firstElementChild);
    },

    _destroyScriptSandbox(target, options = {}) {
        const controller = this._sandboxControllers.get(target);
        if (controller) {
            controller.destroyed = true;
            if (options.restoreStatic !== false) this._restoreStaticFallback(controller);
            else if (controller.target) controller.target.classList.remove('backend-sandbox-runtime-active');
            this._clearSandboxTimer(controller);
            if (controller.onMessage) window.removeEventListener('message', controller.onMessage);
            if (controller.iframe && controller.onLoad) controller.iframe.removeEventListener('load', controller.onLoad);
            if (controller.iframe && controller.onError) controller.iframe.removeEventListener('error', controller.onError);
            if (controller.iframe) controller.iframe.removeAttribute('src');
            if (controller.shell) controller.shell.remove();
            this._activeSandboxControllers.delete(controller);
            this._sandboxControllers.delete(target);
            return;
        }

        const stray = target.querySelector('[data-backend-sandbox-card]');
        if (stray) stray.remove();
        target.classList.remove('backend-sandbox-runtime-active');
    },

    _markSandboxTerminal(controller, state, message) {
        if (!controller || controller.destroyed || controller.terminal) return;
        controller.terminal = true;
        this._setSandboxState(controller, state, message);
        const restored = this._restoreStaticFallback(controller);
        if (!restored) {
            this._setSandboxState(controller, 'error', `${message} 静态实验恢复失败，请切换模块后重试。`);
        }
        this._clearSandboxTimer(controller);
        if (controller.iframe) controller.iframe.removeAttribute('src');
    },

    _clearSandboxTimer(controller) {
        if (controller.timeoutId) {
            window.clearTimeout(controller.timeoutId);
            controller.timeoutId = null;
        }
    },

    _setSandboxState(controller, state, message) {
        if (controller.destroyed) return;
        controller.state = state;
        controller.shell.dataset.state = state;
        const status = controller.shell.querySelector('[data-backend-sandbox-status]');
        const text = controller.shell.querySelector('[data-backend-sandbox-message]');
        const labels = {
            loading: '加载中',
            bootstrapping: '启动中',
            assets: '已加载',
            ready: '已就绪',
            error: '加载失败',
            timeout: '需刷新',
            blocked: '已阻止',
        };
        if (status) status.textContent = labels[state] || state;
        if (text) text.textContent = message || '';
    },

    _isSafeIframeSandbox(value) {
        const tokens = String(value || '').split(/\s+/).filter(Boolean);
        return tokens.length === 1 && tokens[0] === 'allow-scripts';
    },

    _sandboxErrorMessage(payload) {
        const code = payload && payload.code ? String(payload.code) : '';
        const messages = {
            template_missing: '隔离实验模板不可用。',
            initializer_missing: '隔离实验初始化入口不可用。',
            initializer_failed: '隔离实验初始化失败。',
            asset_load_failed: '隔离实验脚本资产加载失败。',
            content_script_sandbox_bootstrap_failed: '隔离实验未能完成受控初始化。'
        };
        return messages[code] || '隔离实验未能完成启动，已恢复静态实验。';
    },

    _activateSandboxRuntime(controller) {
        if (!controller || controller.destroyed || controller.terminal) return false;
        if (controller.moduleId === 'energy-conservation'
            && window.EnergyConservation
            && typeof window.EnergyConservation.destroy === 'function') {
            try {
                window.EnergyConservation.destroy();
                controller.staticRuntimeSuspended = true;
            } catch (error) {
                return false;
            }
        }
        controller.target.classList.add('backend-sandbox-runtime-active');
        return true;
    },

    _restoreStaticFallback(controller) {
        if (!controller || !controller.target) return false;
        controller.target.classList.remove('backend-sandbox-runtime-active');
        if (controller.staticRuntimeSuspended && controller.moduleId === 'energy-conservation') {
            if (typeof window.initEnergyConservation !== 'function') return false;
            try {
                window.initEnergyConservation();
                controller.staticRuntimeSuspended = false;
            } catch (error) {
                return false;
            }
        }
        return true;
    },

    _findScriptManifest(schema, moduleId) {
        const sections = Array.isArray(schema.sections) ? schema.sections : [];
        const matched = sections.find((section) => {
            if (!section || section.type !== 'experiment') return false;
            const props = section.props || {};
            return section.experimentId === moduleId || props.moduleSelectorId === moduleId;
        });
        const matchedManifest = matched && matched.props && matched.props.scriptManifest;
        if (matchedManifest) {
            return {
                manifest: matchedManifest,
                sectionTitle: matched.title || schema.title || '',
                moduleId: String(matched.experimentId || (matched.props && matched.props.moduleSelectorId) || moduleId || ''),
            };
        }

        const manifests = [];
        this._collectScriptManifests(schema, manifests);
        return manifests[0] || null;
    },

    _collectScriptManifests(value, manifests, sectionTitle) {
        if (Array.isArray(value)) {
            value.forEach((item) => this._collectScriptManifests(item, manifests, sectionTitle));
            return;
        }
        if (!value || typeof value !== 'object') return;
        const nextTitle = typeof value.title === 'string' ? value.title : sectionTitle;
        if (value.scriptManifest && typeof value.scriptManifest === 'object') {
            manifests.push({ manifest: value.scriptManifest, sectionTitle: nextTitle || '' });
        }
        Object.keys(value).forEach((key) => this._collectScriptManifests(value[key], manifests, nextTitle));
    },

    _absoluteApiUrl(src) {
        if (!src || typeof src !== 'string') return '';
        const value = src.trim();
        if (!value) return '';
        try {
            const absolute = /^https?:\/\//i.test(value);
            const url = AstraApiClient.buildUrl(value, absolute ? '' : this.getApiBaseUrl());
            if (url.search || url.hash) return '';
            if (!/^\/api\/render\/script-sandboxes\/[^/]+\/page\//.test(url.pathname)) return '';
            return url.toString();
        } catch (error) {
            return '';
        }
    },

    _refreshIcons(root) {
        if (typeof lucide !== 'undefined' && lucide && typeof lucide.createIcons === 'function') {
            try { lucide.createIcons({ attrs: { 'stroke-width': 1.8 }, root }); } catch (e) {}
        }
    },

    _escape(value) {
        const div = document.createElement('div');
        div.textContent = String(value || '');
        return div.innerHTML;
    }
};

BackendContent._onOffline = () => {
    BackendContent._abortSchemaRequests();
    Array.from(BackendContent._activeRenderIntents).forEach((intent) => {
        if (!intent.target || !intent.target.isConnected) {
            if (intent.target) BackendContent._removeRenderIntent(intent.target);
            return;
        }
        BackendContent._renderGenerations.set(
            intent.target,
            (BackendContent._renderGenerations.get(intent.target) || 0) + 1
        );
        BackendContent._clearBackendViews(intent.target);
        BackendContent._renderSchemaError(
            intent.target,
            intent.page,
            intent.moduleId,
            AstraApiClient.offlineError()
        );
    });
};

BackendContent._onOnline = () => {
    Array.from(BackendContent._activeRenderIntents).forEach((intent) => {
        if (!intent.target || !intent.target.isConnected) {
            if (intent.target) BackendContent._removeRenderIntent(intent.target);
            return;
        }
        BackendContent.applyExperimentSchema(intent.page, intent.moduleId);
    });
};

window.addEventListener('offline', BackendContent._onOffline);
window.addEventListener('online', BackendContent._onOnline);

window.BackendContent = BackendContent;
