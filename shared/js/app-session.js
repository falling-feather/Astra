(function (global) {
    'use strict';

    const PROTECTED_PAGES = new Set(['student', 'teacher', 'admin']);
    const learningEvidenceFreshProofs = new WeakSet();
    const currentScriptUrl = document.currentScript && document.currentScript.src
        ? document.currentScript.src
        : new URL('shared/js/app-session.js', document.baseURI).href;
    const learningEvidenceLoader = new URL('learning-evidence-loader.js', currentScriptUrl);
    const currentScriptVersion = new URL(currentScriptUrl, document.baseURI).searchParams.get('v') || '';
    if (currentScriptVersion) learningEvidenceLoader.searchParams.set('v', currentScriptVersion);
    const learningEvidenceLoaderUrl = learningEvidenceLoader.href;
    let learningEvidenceLoaderPromise = null;
    let signedOutPromise = null;
    const ROLE_PAGE_ACCESS = Object.freeze({
        student: new Set(['student']),
        teacher: new Set(['teacher']),
        admin: new Set(['teacher', 'admin'])
    });
    const ROLE_LANDING = Object.freeze({ student: 'planets', teacher: 'planets', admin: 'planets' });
    const ROLE_WORKSPACE = Object.freeze({ student: 'student', teacher: 'teacher', admin: 'admin' });
    const ROLE_LABEL = Object.freeze({ student: '学生', teacher: '教师', admin: '管理员' });
    const state = {
        user: null,
        apiBase: '',
        bootPromise: null,
        resolveBoot: null,
        overlay: null,
        view: 'login',
        busy: false,
        status: null,
        appStarted: false,
        explicitSignedOut: false,
        reloadPending: false,
        authorityClearRetry: null
    };

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function api() {
        if (!global.AstraApiClient || typeof global.AstraApiClient.request !== 'function') {
            throw new Error('API 客户端尚未就绪');
        }
        return global.AstraApiClient;
    }

    function resolveApiBase() {
        let candidate = '';
        try {
            candidate = new URLSearchParams(global.location.search).get('apiBase') || '';
        } catch (_) {}
        if (!candidate && global.CONFIG && global.CONFIG.backend) {
            candidate = global.CONFIG.backend.apiBaseUrl || '';
        }
        return api().normalizeBaseUrl(candidate);
    }

    function request(path, options) {
        return api().request(path, Object.assign({
            baseUrl: state.apiBase,
            dispatchAuthRequired: false
        }, options || {}));
    }

    function ensureLearningEvidenceLoader() {
        if (global.AstraLearningEvidenceLoader) return Promise.resolve(global.AstraLearningEvidenceLoader);
        if (learningEvidenceLoaderPromise) return learningEvidenceLoaderPromise;
        learningEvidenceLoaderPromise = new Promise(function (resolve, reject) {
            let script = Array.from(document.scripts).find(function (item) {
                return item.src === learningEvidenceLoaderUrl;
            });
            const created = !script;
            if (!script) {
                script = document.createElement('script');
                script.src = learningEvidenceLoaderUrl;
                script.async = false;
                script.dataset.learningEvidenceBootstrap = 'true';
            }
            let settled = false;
            let timer = 0;
            function cleanup() {
                if (timer) global.clearTimeout(timer);
                script.removeEventListener('load', onLoad);
                script.removeEventListener('error', onError);
            }
            function finish(error) {
                if (settled) return;
                settled = true;
                cleanup();
                if (error) {
                    if (created) script.remove();
                    learningEvidenceLoaderPromise = null;
                    reject(error);
                } else {
                    resolve(global.AstraLearningEvidenceLoader);
                }
            }
            function onLoad() {
                if (global.AstraLearningEvidenceLoader) finish();
                else finish(new Error('学习证据 loader 未安装运行时 owner'));
            }
            function onError() {
                finish(new Error('学习证据 loader 加载失败'));
            }
            script.addEventListener('load', onLoad);
            script.addEventListener('error', onError);
            timer = global.setTimeout(function () {
                if (global.AstraLearningEvidenceLoader) finish();
                else finish(new Error('学习证据 loader 加载超时'));
            }, 10000);
            if (created) document.head.appendChild(script);
            else if (global.AstraLearningEvidenceLoader) finish();
        });
        return learningEvidenceLoaderPromise;
    }

    function roleResourceRegistry() {
        const registry = global.AstraPageRegistry;
        if (
            !registry
            || typeof registry.stylesForRole !== 'function'
            || typeof registry.resourcesForRole !== 'function'
            || typeof registry.allRoleResources !== 'function'
        ) {
            throw new Error('角色资源注册表尚未就绪');
        }
        return registry;
    }

    function absoluteResourceUrl(resource) {
        return new URL(String(resource || ''), document.baseURI || global.location.href).href;
    }

    async function pruneRoleResourceCaches(role) {
        const registry = roleResourceRegistry();
        const allowedUrls = new Set(registry.resourcesForRole(role).map(absoluteResourceUrl));
        const rolePaths = new Set(registry.allRoleResources().map(function (resource) {
            return new URL(absoluteResourceUrl(resource)).pathname;
        }));

        document.querySelectorAll('link[rel="stylesheet"]').forEach(function (link) {
            const linkUrl = new URL(link.href);
            if (rolePaths.has(linkUrl.pathname) && !allowedUrls.has(link.href)) link.remove();
        });

        if (!global.caches || typeof global.caches.keys !== 'function') return;
        const cacheNames = await global.caches.keys();
        await Promise.all(cacheNames.map(async function (name) {
            const cache = await global.caches.open(name);
            const requests = await cache.keys();
            await Promise.all(requests.map(function (cachedRequest) {
                const cachedUrl = new URL(cachedRequest.url);
                if (!rolePaths.has(cachedUrl.pathname) || allowedUrls.has(cachedRequest.url)) return false;
                return cache.delete(cachedRequest);
            }));
        }));
    }

    function loadRoleStyles(role) {
        const styles = roleResourceRegistry().stylesForRole(role);
        return Promise.all(styles.map(function (resource) {
            const href = absoluteResourceUrl(resource);
            const existing = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).find(function (link) {
                return link.href === href;
            });
            if (existing && existing.sheet) {
                existing.dataset.astraRoleResource = resource;
                return Promise.resolve();
            }
            return new Promise(function (resolve, reject) {
                const link = existing || document.createElement('link');
                const timeout = global.setTimeout(function () {
                    link.remove();
                    reject(new Error('角色样式加载超时'));
                }, 8000);
                const finish = function (callback) {
                    global.clearTimeout(timeout);
                    callback();
                };
                link.rel = 'stylesheet';
                link.href = href;
                link.dataset.astraRoleResource = resource;
                link.addEventListener('load', function () {
                    finish(resolve);
                }, { once: true });
                link.addEventListener('error', function () {
                    link.remove();
                    finish(function () { reject(new Error('角色样式加载失败')); });
                }, { once: true });
                if (!existing) document.head.appendChild(link);
            });
        }));
    }

    async function prepareRoleResources(role) {
        await pruneRoleResourceCaches(role);
        await loadRoleStyles(role);
    }

    async function reloadAfterRoleResourceCleanup() {
        if (state.reloadPending) return;
        state.reloadPending = true;
        try {
            await pruneRoleResourceCaches(null);
        } catch (error) {}
        state.user = null;
        global.location.reload();
    }

    function roleLanding(role) {
        return ROLE_LANDING[String(role || '')] || 'planets';
    }

    function roleWorkspace(role) {
        return ROLE_WORKSPACE[String(role || '')] || 'planets';
    }

    function canAccessPage(page, role) {
        const target = String(page || 'planets');
        if (!PROTECTED_PAGES.has(target)) return true;
        const access = ROLE_PAGE_ACCESS[String(role || (state.user && state.user.role) || '')];
        return Boolean(access && access.has(target));
    }

    function guardPage(page) {
        const target = String(page || 'planets');
        if (canAccessPage(target)) return target;
        const fallback = roleLanding(state.user && state.user.role);
        global.dispatchEvent(new CustomEvent('astra:navigation-denied', {
            detail: { requestedPage: target, fallbackPage: fallback, role: state.user && state.user.role }
        }));
        return fallback;
    }

    function setApplicationLocked(locked) {
        document.body.classList.toggle('app-auth-locked', Boolean(locked));
        ['navbar', 'main-content'].forEach(function (id) {
            const node = document.getElementById(id) || document.querySelector('.' + id);
            if (!node) return;
            node.setAttribute('aria-hidden', locked ? 'true' : 'false');
            if ('inert' in node) node.inert = Boolean(locked);
        });
        document.querySelectorAll('footer').forEach(function (node) {
            node.setAttribute('aria-hidden', locked ? 'true' : 'false');
            if ('inert' in node) node.inert = Boolean(locked);
        });
    }

    function dismissLoadingScreen() {
        if (typeof global.__dismissEnglabLoading === 'function') {
            global.__dismissEnglabLoading();
            return;
        }
        const screen = document.getElementById('loading-screen');
        if (screen) screen.classList.add('hidden');
    }

    function applyRoleUI() {
        const role = state.user && state.user.role;
        document.documentElement.dataset.sessionRole = role || 'anonymous';
        document.querySelectorAll('[data-app-roles]').forEach(function (node) {
            const roles = String(node.dataset.appRoles || '').split(',').map(function (item) {
                return item.trim();
            }).filter(Boolean);
            const visible = Boolean(role && roles.includes(role));
            node.hidden = !visible;
            node.setAttribute('aria-hidden', visible ? 'false' : 'true');
            if ('inert' in node) node.inert = !visible;
        });
        PROTECTED_PAGES.forEach(function (page) {
            const section = document.getElementById('page-' + page);
            if (!section) return;
            const allowed = canAccessPage(page, role);
            section.hidden = !allowed;
            section.setAttribute('aria-hidden', allowed ? 'false' : 'true');
            if ('inert' in section) section.inert = !allowed;
            if (!allowed) section.classList.remove('active');
        });
    }

    function renderSessionControl() {
        const existing = document.querySelector('[data-app-session-control]');
        if (existing) existing.remove();
        if (!state.user) return;
        const host = document.querySelector('#navbar .nav-container');
        if (!host) return;
        const node = document.createElement('div');
        node.className = 'app-session-control';
        node.dataset.appSessionControl = 'true';
        node.innerHTML = `
            <button type="button" class="app-session-control__trigger" data-session-action="toggle" aria-expanded="false">
                <span class="app-session-control__avatar" aria-hidden="true">${escapeHtml(String(ROLE_LABEL[state.user.role] || state.user.display_name || state.user.username || '?').slice(0, 1))}</span>
                <span class="app-session-control__identity">
                    <strong>${escapeHtml(state.user.display_name || state.user.username)}</strong>
                    <small>${escapeHtml(ROLE_LABEL[state.user.role] || state.user.role)}</small>
                </span>
            </button>
            <div class="app-session-control__menu" data-session-menu hidden>
                <button type="button" data-session-action="overview">返回星序总览</button>
                <button type="button" data-session-action="workspace">进入${escapeHtml(ROLE_LABEL[state.user.role] || '')}工作台</button>
                <button type="button" data-session-action="logout">安全退出</button>
            </div>`;
        node.addEventListener('click', handleSessionControlClick);
        host.appendChild(node);
    }

    function handleSessionControlClick(event) {
        const actionNode = event.target instanceof Element ? event.target.closest('[data-session-action]') : null;
        if (!actionNode) return;
        const action = actionNode.dataset.sessionAction;
        const control = actionNode.closest('[data-app-session-control]');
        const menu = control && control.querySelector('[data-session-menu]');
        if (action === 'toggle' && menu) {
            const willOpen = menu.hidden;
            menu.hidden = !willOpen;
            actionNode.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
            return;
        }
        if (action === 'overview') {
            if (menu) menu.hidden = true;
            if (global.Router && typeof global.Router.navigateTo === 'function') {
                global.Router.navigateTo(roleLanding(state.user && state.user.role), true);
            } else {
                global.location.hash = roleLanding(state.user && state.user.role);
            }
            return;
        }
        if (action === 'workspace') {
            if (menu) menu.hidden = true;
            if (global.Router && typeof global.Router.navigateTo === 'function') {
                global.Router.navigateTo(roleWorkspace(state.user && state.user.role), true);
            } else {
                global.location.hash = roleWorkspace(state.user && state.user.role);
            }
            return;
        }
        if (action === 'logout') logout();
    }

    function statusMarkup() {
        if (!state.status) return '';
        const retry = state.authorityClearRetry
            ? `<button type="button" class="app-auth-secondary" data-learning-authority-retry ${state.busy ? 'disabled' : ''}>重新清理本地证据</button>`
            : '';
        const code = state.status.code ? `<strong>${escapeHtml(state.status.code)}</strong>` : '';
        return `<div class="app-auth-status app-auth-status--${escapeHtml(state.status.type || 'info')}" role="status">${code}<span>${escapeHtml(state.status.message)}</span>${retry}</div>`;
    }

    function loginForm() {
        return `
            <form class="app-auth-form" data-app-auth-form="login">
                <label>账号<input name="username" autocomplete="username" minlength="3" maxlength="64" required></label>
                <label>密码<input name="password" type="password" autocomplete="current-password" minlength="8" maxlength="128" required></label>
                <button class="app-auth-primary" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? '正在验证…' : '登录并进入星序'}</button>
            </form>`;
    }

    function registerForm() {
        return `
            <form class="app-auth-form" data-app-auth-form="register">
                <label>账号<input name="username" autocomplete="username" minlength="3" maxlength="64" required></label>
                <label>显示名称<input name="display_name" autocomplete="name" minlength="1" maxlength="80" required></label>
                <label>账号性质<select name="role" required><option value="student">学生</option><option value="teacher">教师</option></select></label>
                <label>密码<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label>
                <label>确认密码<input name="password_confirm" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label>
                <button class="app-auth-primary" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? '正在创建…' : '创建账号并进入'}</button>
            </form>`;
    }

    function resetForm() {
        return `
            <form class="app-auth-form" data-app-auth-form="reset-request">
                <label>账号<input name="username" autocomplete="username" minlength="3" maxlength="64" required></label>
                <button class="app-auth-primary" type="submit" ${state.busy ? 'disabled' : ''}>申请重置凭据</button>
            </form>
            <form class="app-auth-form app-auth-form--secondary" data-app-auth-form="reset-confirm">
                <label>重置凭据<input name="token" autocomplete="one-time-code" required></label>
                <label>新密码<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label>
                <button class="app-auth-secondary" type="submit" ${state.busy ? 'disabled' : ''}>确认新密码</button>
            </form>`;
    }

    function renderPortal() {
        if (!state.overlay) return;
        const forms = state.view === 'register' ? registerForm() : (state.view === 'reset' ? resetForm() : loginForm());
        state.overlay.innerHTML = `
            <main class="app-auth-portal" aria-labelledby="app-auth-title">
                <section class="app-auth-context">
                    <div class="app-auth-brand" aria-label="星序认证入口">ASTRA <span>星序</span></div>
                    <div>
                        <p class="app-auth-context__kicker">统一身份入口</p>
                        <h1 id="app-auth-title">先确认身份，再进入你的星序。</h1>
                        <p>学生只进入学习空间，教师获得教学与班级管理，管理员进入全局治理。权限由服务端会话确认，不由页面自行声明。</p>
                    </div>
                    <ul class="app-auth-context__roles" aria-label="角色权限说明">
                        <li><span>学生</span>课程、班级、作业与提交</li>
                        <li><span>教师</span>教学、作业、审批与班级</li>
                        <li><span>管理员</span>用户、组织、审计与全局状态</li>
                    </ul>
                </section>
                <section class="app-auth-panel">
                    <div class="app-auth-tabs" role="tablist" aria-label="账号操作">
                        <button type="button" data-app-auth-view="login" class="${state.view === 'login' ? 'active' : ''}">登录</button>
                        <button type="button" data-app-auth-view="register" class="${state.view === 'register' ? 'active' : ''}">注册</button>
                        <button type="button" data-app-auth-view="reset" class="${state.view === 'reset' ? 'active' : ''}">重置密码</button>
                    </div>
                    ${statusMarkup()}
                    ${forms}
                    <p class="app-auth-panel__note">登录凭据由 HttpOnly Cookie 与服务端 Session 协调保存；本页面不会把访问令牌写入浏览器存储。</p>
                </section>
            </main>`;
    }

    function ensurePortal() {
        if (!state.overlay) {
            state.overlay = document.createElement('div');
            state.overlay.className = 'app-auth-overlay';
            state.overlay.dataset.appAuthOverlay = 'true';
            state.overlay.addEventListener('click', handlePortalClick);
            state.overlay.addEventListener('submit', handlePortalSubmit);
            document.body.appendChild(state.overlay);
        }
        state.overlay.hidden = false;
        renderPortal();
        setApplicationLocked(true);
        dismissLoadingScreen();
    }

    function hidePortal() {
        if (state.overlay) state.overlay.hidden = true;
        setApplicationLocked(false);
    }

    function handlePortalClick(event) {
        const clearRetry = event.target instanceof Element ? event.target.closest('[data-learning-authority-retry]') : null;
        if (clearRetry && !state.busy) {
            retryLearningAuthorityClear();
            return;
        }
        const viewNode = event.target instanceof Element ? event.target.closest('[data-app-auth-view]') : null;
        if (!viewNode || state.busy || state.authorityClearRetry) return;
        state.view = viewNode.dataset.appAuthView || 'login';
        state.status = null;
        renderPortal();
    }

    function formValue(form, name) {
        return String(new FormData(form).get(name) || '').trim();
    }

    async function handlePortalSubmit(event) {
        const form = event.target;
        if (!(form instanceof HTMLFormElement) || !form.dataset.appAuthForm || state.busy) return;
        event.preventDefault();
        if (state.authorityClearRetry) {
            retryLearningAuthorityClear();
            return;
        }
        if (!form.reportValidity()) return;
        state.busy = true;
        state.status = null;
        renderPortal();
        try {
            if (form.dataset.appAuthForm === 'login') await submitLogin(form);
            if (form.dataset.appAuthForm === 'register') await submitRegister(form);
            if (form.dataset.appAuthForm === 'reset-request') await submitResetRequest(form);
            if (form.dataset.appAuthForm === 'reset-confirm') await submitResetConfirm(form);
        } catch (error) {
            state.status = { type: 'error', message: api().message(error) };
        } finally {
            state.busy = false;
            if (!state.user) renderPortal();
        }
    }

    async function submitLogin(form) {
        if (!await prepareExplicitAuthentication()) return false;
        await request('/api/auth/login', {
            method: 'POST',
            body: { username: formValue(form, 'username'), password: formValue(form, 'password') }
        });
        return reconcileSession(true, true);
    }

    async function submitRegister(form) {
        const password = formValue(form, 'password');
        if (password !== formValue(form, 'password_confirm')) {
            throw Object.assign(new Error('两次输入的密码不一致'), { code: 'invalid_request' });
        }
        const username = formValue(form, 'username');
        if (!await prepareExplicitAuthentication()) return false;
        await request('/api/auth/register', {
            method: 'POST',
            body: {
                username: username,
                display_name: formValue(form, 'display_name'),
                password: password,
                role: formValue(form, 'role')
            }
        });
        await request('/api/auth/login', { method: 'POST', body: { username: username, password: password } });
        return reconcileSession(true, true);
    }

    async function submitResetRequest(form) {
        const result = await request('/api/auth/password-reset/request', {
            method: 'POST', body: { username: formValue(form, 'username') }
        });
        state.status = {
            type: 'success',
            message: result && result.reset_token
                ? '开发环境重置凭据：' + result.reset_token
                : '若账号有效，重置凭据将通过已配置的受控通道送达。'
        };
    }

    async function submitResetConfirm(form) {
        await request('/api/auth/password-reset/confirm', {
            method: 'POST',
            body: { token: formValue(form, 'token'), password: formValue(form, 'password') }
        });
        state.view = 'login';
        state.status = { type: 'success', message: '密码已更新，旧会话已撤销，请重新登录。' };
    }

    async function reconcileSession(explicitAuthentication, authorityPrepared) {
        const user = await request('/api/users/me', { method: 'GET' });
        return completeAuthentication(user, Boolean(explicitAuthentication), Boolean(authorityPrepared));
    }

    function issueLearningEvidenceFreshProof() {
        const proof = Object.freeze({});
        learningEvidenceFreshProofs.add(proof);
        return proof;
    }

    function consumeLearningEvidenceFreshProof(proof) {
        if (!proof || typeof proof !== 'object' || !learningEvidenceFreshProofs.has(proof)) return false;
        learningEvidenceFreshProofs.delete(proof);
        return true;
    }

    async function clearLearningAuthority(reason) {
        const loader = global.AstraLearningEvidenceLoader || await ensureLearningEvidenceLoader();
        if (!loader || typeof loader.clearAuthority !== 'function') {
            const error = new Error('学习证据清理 owner 不可用。');
            error.code = 'learning_evidence_clear_unavailable';
            throw error;
        }
        await loader.clearAuthority(reason);
    }

    async function prepareExplicitAuthentication() {
        try {
            await clearLearningAuthority('explicit-authentication-before-login');
            return true;
        } catch (error) {
            showLearningAuthorityClearFailure(error, {
                reason: 'explicit-authentication-before-login'
            });
            return false;
        }
    }

    function showLearningAuthorityClearFailure(error, retry) {
        global.console && global.console.warn('[ApplicationSession] learning evidence authority clear failed', error && (error.code || error.message));
        state.user = null;
        state.authorityClearRetry = Object.freeze(Object.assign({}, retry || {}));
        state.status = {
            type: 'error',
            code: 'learning_evidence_clear_failed',
            message: '本地待同步学习证据尚未完成物理清理。应用保持锁定且不会重载或启用新身份；请重试清理。'
        };
        applyRoleUI();
        ensurePortal();
    }

    async function retryLearningAuthorityClear() {
        const retry = state.authorityClearRetry;
        if (!retry || state.busy) return false;
        state.busy = true;
        state.status = {
            type: 'info',
            code: 'learning_evidence_clear_retrying',
            message: '正在重新清理本地学习证据…'
        };
        renderPortal();
        try {
            await clearLearningAuthority(retry.reason || 'retry-after-clear-failure');
            state.authorityClearRetry = null;
            if (retry.user) {
                await completeAuthentication(retry.user, Boolean(retry.explicitAuthentication), true);
                return true;
            }
            if (retry.reloadAfter) {
                await reloadAfterRoleResourceCleanup();
                return true;
            }
            state.view = 'login';
            state.status = {
                type: 'success',
                code: 'learning_evidence_clear_succeeded',
                message: '本地学习证据已清理；现在可以重新登录。'
            };
            return true;
        } catch (error) {
            showLearningAuthorityClearFailure(error, retry);
            return false;
        } finally {
            state.busy = false;
            if (!state.reloadPending && !state.user) renderPortal();
        }
    }

    async function completeAuthentication(user, explicitAuthentication, authorityPrepared) {
        if (!user || !ROLE_PAGE_ACCESS[user.role]) throw new Error('账号角色无效');
        let recoveredPersistentAuthority = false;
        if (!authorityPrepared) {
            try {
                if (explicitAuthentication) {
                    await clearLearningAuthority('explicit-authentication');
                } else {
                    const loader = global.AstraLearningEvidenceLoader || await ensureLearningEvidenceLoader();
                    if (!loader || typeof loader.recoverPendingAuthority !== 'function') {
                        const error = new Error('学习证据持久清理 owner 不可用。');
                        error.code = 'learning_evidence_clear_unavailable';
                        throw error;
                    }
                    recoveredPersistentAuthority = Boolean(await loader.recoverPendingAuthority());
                }
            } catch (error) {
                showLearningAuthorityClearFailure(error, {
                    reason: explicitAuthentication
                        ? 'explicit-authentication'
                        : 'recover-persistent-authority-clear',
                    user: Object.freeze(Object.assign({}, user)),
                    explicitAuthentication: Boolean(explicitAuthentication)
                });
                return false;
            }
        }
        state.authorityClearRetry = null;
        if (state.appStarted) {
            await reloadAfterRoleResourceCleanup();
            return true;
        }
        await prepareRoleResources(user.role);
        await ensureLearningEvidenceLoader();
        state.user = Object.freeze(Object.assign({}, user));
        state.explicitSignedOut = false;
        applyRoleUI();
        renderSessionControl();
        hidePortal();
        const detail = { user: state.user };
        if (explicitAuthentication || authorityPrepared || recoveredPersistentAuthority) {
            detail.learning_evidence_fresh_proof = issueLearningEvidenceFreshProof();
        }
        global.dispatchEvent(new CustomEvent('astra:session-ready', { detail }));
        if (state.resolveBoot) {
            state.resolveBoot(true);
            state.resolveBoot = null;
        }
        return true;
    }

    async function requireAuthentication() {
        state.appStarted = Boolean(global.Router && global.Router._initialEnterFired);
        state.user = null;
        try {
            await clearLearningAuthority('unauthorized');
        } catch (error) {
            showLearningAuthorityClearFailure(error, {
                reason: 'unauthorized',
                reloadAfter: state.appStarted
            });
            return false;
        }
        if (state.appStarted) {
            await reloadAfterRoleResourceCleanup();
            return true;
        }
        await pruneRoleResourceCaches(null).catch(function () {});
        state.view = 'login';
        state.status = state.explicitSignedOut
            ? null
            : { type: 'error', message: '登录状态已失效，请重新登录。' };
        applyRoleUI();
        ensurePortal();
        return true;
    }

    async function logout() {
        try {
            await request('/api/auth/logout', { method: 'POST' });
        } catch (error) {
            if (!(error && error.status === 401)) {
                global.alert(api().message(error));
                return;
            }
        }
        global.dispatchEvent(new CustomEvent('astra:session-signed-out'));
        await handleSignedOut();
    }

    async function handleSignedOut() {
        if (signedOutPromise) return signedOutPromise;
        const operation = (async function () {
            state.explicitSignedOut = true;
            state.user = null;
            try {
                await clearLearningAuthority('signed-out');
            } catch (error) {
                showLearningAuthorityClearFailure(error, {
                    reason: 'signed-out',
                    reloadAfter: true
                });
                return false;
            }
            await reloadAfterRoleResourceCleanup();
            return true;
        })();
        signedOutPromise = operation;
        operation.then(
            function () {
                if (signedOutPromise === operation) signedOutPromise = null;
            },
            function () {
                if (signedOutPromise === operation) signedOutPromise = null;
            }
        );
        return operation;
    }

    function bootstrap() {
        if (state.bootPromise) return state.bootPromise;
        state.apiBase = resolveApiBase();
        setApplicationLocked(true);
        global.addEventListener('astra:api-auth-required', requireAuthentication);
        global.addEventListener('astra:session-signed-out', handleSignedOut);
        state.bootPromise = new Promise(function (resolve) {
            state.resolveBoot = resolve;
            ensureLearningEvidenceLoader()
                .then(function () { return request('/api/users/me', { method: 'GET' }); })
                .then(completeAuthentication)
                .catch(async function (error) {
                    state.user = null;
                    if (error && error.status === 401) {
                        try {
                            await clearLearningAuthority('unauthorized');
                        } catch (clearError) {
                            showLearningAuthorityClearFailure(clearError, {
                                reason: 'unauthorized',
                                reloadAfter: false
                            });
                            return;
                        }
                    }
                    await pruneRoleResourceCaches(null).catch(function () {});
                    state.view = 'login';
                    state.status = error && error.status === 401
                        ? null
                        : { type: 'error', message: api().message(error) };
                    applyRoleUI();
                    ensurePortal();
                });
        });
        return state.bootPromise;
    }

    global.AstraApplicationSession = Object.freeze({
        bootstrap: bootstrap,
        getUser: function () { return state.user; },
        getRole: function () { return state.user && state.user.role; },
        resolveApiBase: resolveApiBase,
        roleLanding: roleLanding,
        roleWorkspace: roleWorkspace,
        canAccessPage: canAccessPage,
        guardPage: guardPage,
        applyRoleUI: applyRoleUI,
        consumeLearningEvidenceFreshProof: consumeLearningEvidenceFreshProof,
        requireAuthentication: requireAuthentication,
        logout: logout
    });
})(window);
