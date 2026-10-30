// 星序 AI 助教：同源调用学校后端代理，永不在浏览器保存 DeepSeek 密钥。
(function (global) {
    'use strict';
    if (global.AstraAiTutor) return;

    const state = { button: null, panel: null, messages: null, input: null, status: null, send: null, enabled: null, busy: false };
    const apiPath = (path) => {
        const base = String(global.ASTRA_API_BASE || '/api').replace(/\/$/u, '');
        return `${base}${path}`;
    };
    const esc = (value) => String(value ?? '').replace(/[&<>"']/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const append = (text, kind) => {
        if (!state.messages) return;
        const node = document.createElement('div');
        node.className = `ai-tutor-message ai-tutor-message--${kind}`;
        node.textContent = String(text || '');
        state.messages.appendChild(node);
        state.messages.scrollTop = state.messages.scrollHeight;
    };
    const setStatus = (text) => { if (state.status) state.status.textContent = text || ''; };
    const setBusy = (busy) => {
        state.busy = busy;
        if (state.send) state.send.disabled = busy || !state.input?.value.trim();
        if (state.input) state.input.disabled = busy;
    };
    async function loadConfig() {
        try {
            const response = await fetch(apiPath('/ai-tutor/config'), { credentials: 'same-origin', headers: { Accept: 'application/json' } });
            if (!response.ok) throw new Error(response.status === 401 ? '请先登录星序，再使用 AI 助教。' : '学校 AI 助教配置暂不可读取。');
            const config = await response.json();
            state.enabled = config.enabled === true;
            if (!state.enabled) append('学校尚未启用 AI 助教。请联系管理员配置 DeepSeek 后端服务。', 'assistant');
            else append('你好，我是星序 AI 助教。可以结合当前实验帮你梳理概念、观察现象和下一步问题。', 'assistant');
        } catch (error) {
            state.enabled = false;
            append(error instanceof Error ? error.message : 'AI 助教暂不可用。', 'error');
        }
    }
    async function sendMessage(event) {
        event?.preventDefault();
        const message = state.input?.value.trim() || '';
        if (!message || state.busy) return;
        if (state.enabled !== true) { append('当前学校还没有启用 AI 助教。', 'error'); return; }
        append(message, 'user');
        state.input.value = '';
        setBusy(true);
        setStatus('正在思考…');
        try {
            const response = await fetch(apiPath('/ai-tutor/chat'), {
                method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ message, context: { space: 'englab', route: global.location.hash || '#home', page_title: document.title } })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.detail || 'AI 助教暂时没有回应。');
            append(payload.answer || '这次没有得到可显示的回答。', 'assistant');
            setStatus('');
        } catch (error) {
            append(error instanceof Error ? error.message : 'AI 助教暂时没有回应。', 'error');
            setStatus('');
        } finally { setBusy(false); }
    }
    function toggle(open) {
        if (!state.panel) return;
        state.panel.hidden = open === undefined ? !state.panel.hidden : !open;
        state.button?.setAttribute('aria-expanded', String(!state.panel.hidden));
        if (!state.panel.hidden) { state.input?.focus({ preventScroll: true }); if (state.enabled === null) void loadConfig(); }
    }
    function init() {
        if (state.button || !document.body) return;
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'ai-tutor-fab'; button.setAttribute('aria-label', '打开 AI 助教'); button.setAttribute('aria-expanded', 'false'); button.setAttribute('data-tip', 'AI 助教');
        button.innerHTML = '<i class="icon" aria-hidden="true">✦</i>';
        button.addEventListener('click', (event) => { event.stopPropagation(); toggle(); });
        document.body.appendChild(button); state.button = button;
        const panel = document.createElement('aside'); panel.className = 'ai-tutor-panel'; panel.hidden = true; panel.setAttribute('aria-label', '星序 AI 助教');
        panel.innerHTML = '<header class="ai-tutor-panel__header"><div><strong>AI 助教</strong><small>学校统一配置 · DeepSeek</small></div><button type="button" class="ai-tutor-panel__close" aria-label="关闭 AI 助教">×</button></header><div class="ai-tutor-panel__messages" aria-live="polite"></div><div class="ai-tutor-panel__status" role="status"></div><form class="ai-tutor-panel__form"><textarea class="ai-tutor-panel__input" rows="2" maxlength="2000" placeholder="问问当前实验中的概念或现象…" aria-label="向 AI 助教提问"></textarea><button class="ai-tutor-panel__send" type="submit">发送</button></form>';
        document.body.appendChild(panel); state.panel = panel; state.messages = panel.querySelector('.ai-tutor-panel__messages'); state.input = panel.querySelector('.ai-tutor-panel__input'); state.status = panel.querySelector('.ai-tutor-panel__status'); state.send = panel.querySelector('.ai-tutor-panel__send');
        panel.querySelector('.ai-tutor-panel__close')?.addEventListener('click', () => toggle(false)); panel.querySelector('form')?.addEventListener('submit', sendMessage); state.input?.addEventListener('input', () => setBusy(false));
    }
    global.AstraAiTutor = Object.freeze({ init, open: () => toggle(true), close: () => toggle(false) });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && state.panel && !state.panel.hidden) {
            event.preventDefault();
            toggle(false);
        }
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})(window);
