(function (global) {
    'use strict';

    const ROLE_META = Object.freeze({
        student: { label: '学生', icon: 'graduation-cap', route: 'student', registration: true },
        teacher: { label: '教师', icon: 'presentation', route: 'teacher', registration: true },
        admin: { label: '管理员', icon: 'shield-check', route: 'admin', registration: false }
    });
    const ACCOUNT_STATUS_LABELS = Object.freeze({
        active: '账号正常', disabled: '账号已停用', pending: '等待审核', inactive: '暂未启用'
    });
    const mounted = new WeakMap();

    function mountGate(container, options) {
        if (!(container instanceof Element)) return;
        const config = normalizeOptions(options);
        const state = { view: 'login', busy: false, status: null, config };
        install(container, state, renderGate, handleGateClick, handleGateSubmit);
    }

    function mountAccount(container, options) {
        if (!(container instanceof Element)) return;
        const config = normalizeOptions(options);
        const state = {
            view: 'account',
            busy: false,
            status: null,
            config,
            sessionsOpen: false,
            sessions: [],
            sessionsLoading: false,
            sessionsError: null
        };
        install(container, state, renderAccount, handleAccountClick, null);
    }

    function unmount(container) {
        if (!(container instanceof Element)) return;
        const current = mounted.get(container);
        if (current && current.controller) current.controller.abort();
        container.onclick = null;
        container.onsubmit = null;
        mounted.delete(container);
    }

    function install(container, state, renderer, clickHandler, submitHandler) {
        unmount(container);
        state.container = container;
        state.controller = new AbortController();
        state.render = () => renderer(container, state);
        container.onclick = (event) => clickHandler && clickHandler(container, state, event);
        container.onsubmit = (event) => submitHandler && submitHandler(container, state, event);
        mounted.set(container, state);
        state.render();
    }

    function renderGate(container, state) {
        const role = state.config.role;
        const meta = ROLE_META[role];
        container.innerHTML = `
            <section class="astra-auth" data-auth-ui="gate" data-auth-role="${role}" aria-labelledby="astra-auth-${role}-title">
                <div class="astra-auth__intro">
                    <span class="astra-auth__icon" aria-hidden="true"><i data-lucide="${meta.icon}"></i></span>
                    <div>
                        <span class="astra-auth__eyebrow">FIRST-PARTY ACCOUNT</span>
                        <h2 id="astra-auth-${role}-title">${meta.label}账号入口</h2>
                        <p>认证仅使用 HttpOnly Cookie。页面不会读取、保存或发送 Bearer token。</p>
                    </div>
                </div>
                <div class="astra-auth__tabs" role="tablist" aria-label="账号操作">
                    ${tabButton('login', '登录', state.view)}
                    ${meta.registration ? tabButton('register', '注册', state.view) : ''}
                    ${tabButton('reset', '重置密码', state.view)}
                </div>
                <div class="astra-auth__body">
                    ${renderGateView(state)}
                </div>
                ${renderStatus(state.status)}
            </section>
        `;
        refreshIcons();
        focusFirstField(container);
    }

    function renderGateView(state) {
        if (state.view === 'register') return renderRegisterForm(state);
        if (state.view === 'reset') return renderResetForms(state);
        return renderLoginForm(state);
    }

    function renderLoginForm(state) {
        return `
            <form class="astra-auth__form" data-auth-form="login" novalidate>
                <label>
                    <span>用户名</span>
                    <input name="username" autocomplete="username" minlength="3" maxlength="64" required ${disabled(state)}>
                </label>
                <label>
                    <span>密码</span>
                    <input name="password" type="password" autocomplete="current-password" maxlength="128" required ${disabled(state)}>
                </label>
                <button type="submit" class="astra-auth__primary" ${disabled(state)}>
                    <i data-lucide="log-in"></i><span>${state.busy ? '正在校验' : `登录${ROLE_META[state.config.role].label}工作台`}</span>
                </button>
                <button type="button" class="astra-auth__secondary" data-auth-action="reconcile" ${disabled(state)}>
                    重新读取当前会话
                </button>
            </form>
        `;
    }

    function renderRegisterForm(state) {
        const meta = ROLE_META[state.config.role];
        if (!meta.registration) {
            return `
                <div class="astra-auth__boundary" role="note">
                    <i data-lucide="shield-alert"></i>
                    <div><strong>管理员不开放公开注册</strong><p>首个管理员必须由部署负责人通过受控 bootstrap 初始化，后续账号由管理员治理。</p></div>
                </div>
            `;
        }
        return `
            <form class="astra-auth__form" data-auth-form="register" novalidate>
                <div class="astra-auth__boundary" role="note">
                    <i data-lucide="badge-check"></i>
                    <div><strong>注册身份固定为${meta.label}</strong><p>注册不会授予学校、班级或课程权限；加入与授权仍由后端规则控制。</p></div>
                </div>
                <label><span>用户名</span><input name="username" autocomplete="username" minlength="3" maxlength="64" required ${disabled(state)}></label>
                <label><span>显示名称</span><input name="display_name" autocomplete="name" maxlength="120" required ${disabled(state)}></label>
                <label><span>密码</span><input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required ${disabled(state)}></label>
                <label><span>确认密码</span><input name="password_confirm" type="password" autocomplete="new-password" minlength="8" maxlength="128" required ${disabled(state)}></label>
                <button type="submit" class="astra-auth__primary" ${disabled(state)}>
                    <i data-lucide="user-plus"></i><span>${state.busy ? '正在创建' : `注册并登录${meta.label}账号`}</span>
                </button>
            </form>
        `;
    }

    function renderResetForms(state) {
        return `
            <div class="astra-auth__reset-grid">
                <form class="astra-auth__form" data-auth-form="reset-request" novalidate>
                    <h3>申请重置</h3>
                    <p>无论账号是否存在，系统都返回相同结果。正式环境的重置凭据必须通过受控通道送达。</p>
                    <label><span>用户名</span><input name="username" autocomplete="username" maxlength="64" required ${disabled(state)}></label>
                    <button type="submit" class="astra-auth__secondary" ${disabled(state)}>发送重置申请</button>
                </form>
                <form class="astra-auth__form" data-auth-form="reset-confirm" novalidate>
                    <h3>确认新密码</h3>
                    <label><span>重置凭据</span><input name="token" type="password" autocomplete="one-time-code" minlength="20" maxlength="256" required ${disabled(state)}></label>
                    <label><span>新密码</span><input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required ${disabled(state)}></label>
                    <button type="submit" class="astra-auth__primary" ${disabled(state)}>确认重置</button>
                </form>
            </div>
        `;
    }

    function renderAccount(container, state) {
        const user = state.config.user || {};
        const expected = ROLE_META[state.config.role];
        const actual = ROLE_META[user.role] || { label: user.role || '未知角色', icon: 'user-round' };
        const mismatch = Boolean(state.config.roleMismatch);
        container.innerHTML = `
            <section class="astra-account${mismatch ? ' astra-account--mismatch' : ''}" data-auth-ui="account" data-auth-role="${state.config.role}">
                <div class="astra-account__identity">
                    <span class="astra-auth__icon" aria-hidden="true"><i data-lucide="${actual.icon}"></i></span>
                    <div>
                        <strong>${escapeHtml(user.display_name || user.username || '当前用户')}</strong>
                        <span>${escapeHtml(actual.label)} · ${escapeHtml(ACCOUNT_STATUS_LABELS[user.status] || '状态待确认')}</span>
                        ${mismatch ? `<em>此入口需要${expected.label}身份，请切换账号。</em>` : '<em>Cookie 会话已连接，敏感数据不写入普通存储。</em>'}
                    </div>
                </div>
                <div class="astra-account__actions">
                    <button type="button" class="astra-auth__secondary" data-auth-action="sessions" ${disabled(state)}>
                        <i data-lucide="monitor-smartphone"></i><span>活动会话</span>
                    </button>
                    <button type="button" class="astra-auth__secondary" data-auth-action="logout" ${disabled(state)}>
                        <i data-lucide="log-out"></i><span>${mismatch ? '退出并切换账号' : '退出登录'}</span>
                    </button>
                </div>
                ${state.sessionsOpen ? renderSessions(state) : ''}
                ${renderStatus(state.status)}
            </section>
        `;
        refreshIcons();
    }

    function renderSessions(state) {
        if (state.sessionsLoading) return '<div class="astra-sessions"><p>正在读取活动会话…</p></div>';
        if (state.sessionsError) return `<div class="astra-sessions"><p>${escapeHtml(message(state.sessionsError))}</p></div>`;
        if (!state.sessions.length) return '<div class="astra-sessions"><p>没有其他活动会话。</p></div>';
        return `
            <div class="astra-sessions" aria-live="polite">
                <div class="astra-sessions__heading"><strong>活动会话</strong><span>仅显示当前账号未过期且未撤销的会话</span></div>
                <ul>
                    ${state.sessions.map((item) => `
                        <li${item.is_current ? ' class="is-current"' : ''}>
                            <div>
                                <strong>${escapeHtml(item.device_label || '未命名设备')}${item.is_current ? ' · 当前' : ''}</strong>
                                <span>最近活动 ${formatDate(item.last_seen_at || item.created_at)} · 到期 ${formatDate(item.expires_at)}</span>
                            </div>
                            <button type="button" data-auth-revoke-session="${escapeAttr(item.id)}" ${disabled(state)}>${item.is_current ? '退出当前会话' : '撤销'}</button>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    }

    async function handleGateClick(container, state, event) {
        const target = event.target instanceof Element ? event.target : null;
        if (!target || state.busy) return;
        const tab = target.closest('[data-auth-view]');
        if (tab) {
            state.view = tab.dataset.authView || 'login';
            state.status = null;
            state.render();
            return;
        }
        if (target.closest('[data-auth-action="reconcile"]')) {
            await reconcileSession(state);
        }
    }

    async function handleGateSubmit(container, state, event) {
        const form = event.target;
        if (!(form instanceof HTMLFormElement) || !form.dataset.authForm || state.busy) return;
        event.preventDefault();
        if (!form.reportValidity()) return;
        if (form.dataset.authForm === 'login') await submitLogin(state, form);
        if (form.dataset.authForm === 'register') await submitRegistration(state, form);
        if (form.dataset.authForm === 'reset-request') await submitResetRequest(state, form);
        if (form.dataset.authForm === 'reset-confirm') await submitResetConfirm(state, form);
    }

    async function submitLogin(state, form) {
        const data = new FormData(form);
        await runMutation(state, async () => {
            await request('/api/auth/login', state, {
                method: 'POST',
                body: { username: text(data, 'username'), password: text(data, 'password') }
            });
            await reconcileSession(state, { fromMutation: true, successMessage: '登录成功，正在进入工作台' });
        });
    }

    async function submitRegistration(state, form) {
        const data = new FormData(form);
        const password = text(data, 'password');
        if (password !== text(data, 'password_confirm')) {
            state.status = { type: 'error', message: '两次输入的密码不一致' };
            state.render();
            return;
        }
        await runMutation(state, async () => {
            await request('/api/auth/register', state, {
                method: 'POST',
                body: {
                    username: text(data, 'username'),
                    display_name: text(data, 'display_name'),
                    password,
                    role: state.config.role
                }
            });
            await request('/api/auth/login', state, {
                method: 'POST',
                body: { username: text(data, 'username'), password }
            });
            await reconcileSession(state, { fromMutation: true, successMessage: '注册成功，正在进入工作台' });
        });
    }

    async function submitResetRequest(state, form) {
        const data = new FormData(form);
        await runMutation(state, async () => {
            await request('/api/auth/password-reset/request', state, {
                method: 'POST', body: { username: text(data, 'username') }
            });
            state.status = { type: 'success', message: '若账号有效，重置凭据将通过已配置的受控通道送达。' };
        });
    }

    async function submitResetConfirm(state, form) {
        const data = new FormData(form);
        await runMutation(state, async () => {
            await request('/api/auth/password-reset/confirm', state, {
                method: 'POST', body: { token: text(data, 'token'), password: text(data, 'password') }
            });
            state.view = 'login';
            state.status = { type: 'success', message: '密码已更新，旧活动会话已撤销，请重新登录。' };
        });
    }

    async function reconcileSession(state, options) {
        if (state.busy && !(options && options.fromMutation)) return;
        try {
            const user = await request('/api/users/me', state, { method: 'GET' });
            state.status = { type: 'success', message: (options && options.successMessage) || '已确认有效会话' };
            if (typeof state.config.onAuthenticated === 'function') state.config.onAuthenticated(user);
        } catch (error) {
            state.status = { type: 'error', message: message(error) };
            if (!state.busy) state.render();
        }
    }

    async function handleAccountClick(container, state, event) {
        const target = event.target instanceof Element ? event.target : null;
        if (!target || state.busy) return;
        if (target.closest('[data-auth-action="sessions"]')) {
            state.sessionsOpen = !state.sessionsOpen;
            state.status = null;
            if (state.sessionsOpen) await loadSessions(state);
            else state.render();
            return;
        }
        if (target.closest('[data-auth-action="logout"]')) {
            await runMutation(state, async () => {
                await request('/api/auth/logout', state, { method: 'POST' });
                try {
                    global.dispatchEvent(new global.CustomEvent('astra:session-signed-out'));
                } catch (error) {}
                if (typeof state.config.onSignedOut === 'function') state.config.onSignedOut();
            });
            return;
        }
        const revoke = target.closest('[data-auth-revoke-session]');
        if (revoke) {
            const sessionId = String(revoke.dataset.authRevokeSession || '');
            await runMutation(state, async () => {
                const result = await request(`/api/auth/sessions/${encodeURIComponent(sessionId)}`, state, { method: 'DELETE' });
                if (result && result.is_current) {
                    if (typeof state.config.onSignedOut === 'function') state.config.onSignedOut();
                    return;
                }
                await loadSessions(state, { keepBusy: true });
                state.status = { type: 'success', message: '会话已撤销' };
            });
        }
    }

    async function loadSessions(state, options) {
        state.sessionsLoading = true;
        state.sessionsError = null;
        if (!(options && options.keepBusy)) state.render();
        try {
            const result = await request('/api/auth/sessions', state, { method: 'GET' });
            state.sessions = Array.isArray(result) ? result : [];
        } catch (error) {
            state.sessions = [];
            state.sessionsError = error;
        } finally {
            state.sessionsLoading = false;
            state.render();
        }
    }

    async function runMutation(state, operation) {
        state.busy = true;
        state.status = null;
        state.render();
        try {
            await operation();
        } catch (error) {
            const ambiguous = global.AstraApiClient && AstraApiClient.isAmbiguousMutation(error);
            state.status = {
                type: ambiguous ? 'warning' : 'error',
                message: ambiguous
                    ? `${message(error)}；请使用“重新读取当前会话”核对，不要重复提交。`
                    : message(error)
            };
        } finally {
            state.busy = false;
            if (mounted.get(state.container) === state) state.render();
        }
    }

    function request(path, state, options) {
        if (!global.AstraApiClient) return Promise.reject(new Error('API 客户端尚未加载'));
        return AstraApiClient.request(path, Object.assign({}, options || {}, {
            baseUrl: state.config.baseUrl,
            signal: state.controller.signal,
            dispatchAuthRequired: state.view === 'account'
        }));
    }

    function normalizeOptions(options) {
        const source = options || {};
        const role = ROLE_META[source.role] ? source.role : 'student';
        return {
            role,
            baseUrl: String(source.baseUrl || ''),
            user: source.user || null,
            roleMismatch: Boolean(source.roleMismatch),
            onAuthenticated: source.onAuthenticated,
            onSignedOut: source.onSignedOut
        };
    }

    function tabButton(view, label, current) {
        const selected = view === current;
        return `<button type="button" role="tab" data-auth-view="${view}" aria-selected="${selected}" class="${selected ? 'is-active' : ''}">${label}</button>`;
    }

    function renderStatus(status) {
        if (!status) return '<div class="astra-auth__status" data-auth-status hidden aria-live="polite"></div>';
        return `<div class="astra-auth__status astra-auth__status--${escapeAttr(status.type)}" data-auth-status role="status" aria-live="polite">${escapeHtml(status.message)}</div>`;
    }

    function disabled(state) {
        return state.busy ? 'disabled aria-disabled="true"' : '';
    }

    function text(data, key) {
        return String(data.get(key) || '').trim();
    }

    function message(error) {
        if (global.AstraApiClient) return AstraApiClient.message(error);
        return error && error.message ? String(error.message) : '请求失败，请稍后重试';
    }

    function focusFirstField(container) {
        global.requestAnimationFrame(() => {
            const input = container.querySelector('input:not([disabled])');
            if (input && container.matches(':focus-within')) input.focus();
        });
    }

    function formatDate(value) {
        if (!value) return '--';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '--';
        return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(date);
    }

    function refreshIcons() {
        if (global.lucide && typeof global.lucide.createIcons === 'function') {
            try { global.lucide.createIcons(); } catch (error) {}
        }
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function escapeAttr(value) {
        return escapeHtml(value);
    }

    global.AstraAuthUI = Object.freeze({ mountGate, mountAccount, unmount });
})(typeof window !== 'undefined' ? window : globalThis);
