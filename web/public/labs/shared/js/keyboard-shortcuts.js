// ===== Keyboard Shortcuts (v4.5-α2) =====
// Ctrl/Alt + 1~5 切换学科；Ctrl/Alt + 0 回首页；Ctrl/Alt + ` 进星系；/ 打开搜索
// 当全局搜索浮层处于打开状态时禁用，避免与输入冲突。

const KeyboardShortcuts = {
    map: [
        { key: '1', page: 'mathematics', label: '数学' },
        { key: '2', page: 'physics',     label: '物理' },
        { key: '3', page: 'chemistry',   label: '化学' },
        { key: '4', page: 'algorithms',  label: '算法' },
        { key: '5', page: 'biology',     label: '生物' },
        { key: '0', page: 'home',        label: '首页' },
        { key: '`', page: 'planets',     label: '星系' }
    ],
    _toastEl: null,
    _toastTimer: null,
    _initialized: false,

    init() {
        if (this._initialized) return;
        // 创建一次性 toast 元素
        this._ensureToast();
        window.addEventListener('keydown', (e) => this._onKey(e));
        this._initialized = true;
    },

    _onKey(e) {
        // 全局搜索打开时不响应（避免抢占输入）
        if (typeof GlobalSearch !== 'undefined' && GlobalSearch.isOpen) return;
        // 输入框/可编辑元素聚焦时不响应
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

        // 「/」 打开全局搜索
        if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            if (typeof GlobalSearch !== 'undefined') GlobalSearch.open();
            return;
        }

        // Ctrl/Cmd 或 Alt + 数字/反引号
        const useCtrl = (e.ctrlKey || e.metaKey) && !e.altKey;
        const useAlt = e.altKey && !e.ctrlKey && !e.metaKey;
        if (!useCtrl && !useAlt) return;

        const hit = this.map.find(m => m.key === e.key);
        if (!hit) return;
        e.preventDefault();
        this._goto(hit);
    },

    _goto(entry) {
        const targetHash = '#' + entry.page;
        if (location.hash === targetHash) {
            this._showToast(`已在 ${entry.label}`);
            return;
        }
        location.hash = entry.page;
        this._showToast(`→ ${entry.label}`);
    },

    _ensureToast() {
        if (this._toastEl) return;
        const el = document.createElement('div');
        el.className = 'kbsc-toast';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        document.body.appendChild(el);
        this._toastEl = el;
    },

    _showToast(text) {
        if (!this._toastEl) return;
        this._toastEl.textContent = text;
        this._toastEl.classList.add('kbsc-toast--visible');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            this._toastEl.classList.remove('kbsc-toast--visible');
        }, 1100);
    }
};

if (typeof window !== 'undefined') window.KeyboardShortcuts = KeyboardShortcuts;
