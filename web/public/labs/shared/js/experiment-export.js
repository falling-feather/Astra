// ===== Experiment Export — Screenshot & CSV (E-03) =====
// Provides Canvas PNG screenshot download and optional CSV data export.
// A floating export button appears when an experiment is active.

const ExperimentExport = {
    _btn: null,
    _menu: null,
    _menuOpen: false,
    _currentPage: null,
    _currentModule: null,
    _initialized: false,

    // Experiments can register CSV data providers:
    // ExperimentExport.registerCSV('moduleId', () => ({ headers: [...], rows: [[...], ...] }))
    _csvProviders: {},

    init() {
        if (this._initialized) return;
        this._createButton();
        this._createMenu();
        this._initialized = true;
    },

    // Show button when experiment opens
    show(page, moduleId) {
        this._currentPage = page;
        this._currentModule = moduleId;
        if (this._btn) this._btn.style.display = 'flex';
        // Update CSV option visibility
        this._updateMenuOptions();
    },

    // Hide button when returning to gallery
    hide() {
        this._currentPage = null;
        this._currentModule = null;
        if (this._btn) this._btn.style.display = 'none';
        this._closeMenu();
    },

    // Register a CSV data provider for a specific experiment
    registerCSV(moduleId, providerFn) {
        this._csvProviders[moduleId] = providerFn;
    },

    // ── Screenshot ──

    _screenshot() {
        this._closeMenu();
        const canvas = this._findCanvas();
        if (!canvas) return;

        try {
            canvas.toBlob(function(blob) {
                if (!blob) return;
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = ExperimentExport._makeFilename('png');
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
            }, 'image/png');
        } catch (e) {
            // Canvas may be tainted (cross-origin images)
            console.warn('[ExperimentExport] Screenshot failed:', e);
        }
    },

    // ── CSV Export ──

    _exportCSV() {
        this._closeMenu();
        if (!this._currentModule) return;

        const provider = this._csvProviders[this._currentModule];
        if (!provider) return;

        let data;
        try { data = provider(); } catch (e) {
            console.warn('[ExperimentExport] CSV provider error:', e);
            return;
        }
        if (!data || !data.headers || !data.rows) return;

        // BOM for Excel UTF-8 compatibility
        var csv = '\uFEFF';
        csv += data.headers.map(this._escapeCSV).join(',') + '\r\n';
        for (var i = 0; i < data.rows.length; i++) {
            csv += data.rows[i].map(this._escapeCSV).join(',') + '\r\n';
        }

        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = this._makeFilename('csv');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
    },

    _escapeCSV(val) {
        if (val == null) return '';
        var s = String(val);
        if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    },

    // ── UI ──

    _createButton() {
        var btn = document.createElement('button');
        btn.className = 'experiment-export-btn';
        btn.id = 'experiment-export-btn';
        btn.setAttribute('aria-label', '导出实验数据');
        btn.setAttribute('title', '截图 / 导出');
        btn.setAttribute('data-tip', '截图导出');
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
        btn.style.display = 'none';

        var self = this;
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            self._toggleMenu();
        });
        document.body.appendChild(btn);
        this._btn = btn;
    },

    _createMenu() {
        var menu = document.createElement('div');
        menu.className = 'experiment-export-menu';
        menu.id = 'experiment-export-menu';
        menu.innerHTML =
            '<button class="experiment-export-menu__item" data-action="screenshot">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' +
                ' 截图 (PNG)' +
            '</button>' +
            '<button class="experiment-export-menu__item" data-action="csv">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>' +
                ' 数据 (CSV)' +
            '</button>' +
            '<button class="experiment-export-menu__item" data-action="share">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>' +
                ' 复制链接' +
            '</button>';

        var self = this;
        menu.addEventListener('click', function(e) {
            var item = e.target.closest('[data-action]');
            if (!item) return;
            var action = item.dataset.action;
            if (action === 'screenshot') self._screenshot();
            else if (action === 'csv') self._exportCSV();
            else if (action === 'share') self._copyShareLink();
        });

        // Close menu when clicking elsewhere
        document.addEventListener('click', function(e) {
            if (self._menuOpen && !self._btn.contains(e.target) && !menu.contains(e.target)) {
                self._closeMenu();
            }
        });

        document.body.appendChild(menu);
        this._menu = menu;
    },

    _toggleMenu() {
        if (this._menuOpen) {
            this._closeMenu();
        } else {
            this._openMenu();
        }
    },

    _openMenu() {
        if (!this._menu || !this._btn) return;
        this._menu.classList.add('open');
        this._menuOpen = true;
    },

    _closeMenu() {
        if (this._menu) this._menu.classList.remove('open');
        this._menuOpen = false;
    },

    _updateMenuOptions() {
        if (!this._menu) return;
        var csvItem = this._menu.querySelector('[data-action="csv"]');
        if (csvItem) {
            var hasCSV = this._currentModule && !!this._csvProviders[this._currentModule];
            csvItem.style.display = hasCSV ? 'flex' : 'none';
        }
    },

    // ── Share Link ──

    _copyShareLink() {
        this._closeMenu();
        // 若当前有实验打开，生成 #subject/experiment 形式的深链接；否则使用当前 URL
        var url;
        if (this._currentPage && this._currentModule) {
            url = window.location.origin + window.location.pathname +
                  '#' + this._currentPage + '/' + this._currentModule;
        } else {
            url = window.location.href;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(
                function() { ExperimentExport._showToast('链接已复制到剪贴板'); },
                function() { ExperimentExport._fallbackCopy(url); }
            );
        } else {
            this._fallbackCopy(url);
        }
    },

    _fallbackCopy(text) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            this._showToast('链接已复制到剪贴板');
        } catch (e) {
            this._showToast('复制失败，请手动复制地址栏链接');
        }
        document.body.removeChild(ta);
    },

    _showToast(msg) {
        var existing = document.querySelector('.export-toast');
        if (existing) existing.remove();

        var toast = document.createElement('div');
        toast.className = 'export-toast';
        toast.textContent = msg;
        document.body.appendChild(toast);

        // Force reflow then show
        toast.offsetHeight;
        toast.classList.add('export-toast--visible');

        setTimeout(function() {
            toast.classList.remove('export-toast--visible');
            setTimeout(function() { if (toast.parentNode) toast.remove(); }, 300);
        }, 2000);
    },

    // ── Helpers ──

    _findCanvas() {
        if (!this._currentPage || !this._currentModule) return null;
        var pageEl = document.getElementById('page-' + this._currentPage);
        if (!pageEl) return null;
        var section = pageEl.querySelector('[data-module="' + this._currentModule + '"].module-active');
        if (!section) return null;
        return section.querySelector('canvas');
    },

    _makeFilename(ext) {
        var mod = this._currentModule || 'experiment';
        var now = new Date();
        var ts = now.getFullYear() +
            String(now.getMonth() + 1).padStart(2, '0') +
            String(now.getDate()).padStart(2, '0') + '_' +
            String(now.getHours()).padStart(2, '0') +
            String(now.getMinutes()).padStart(2, '0');
        return mod + '_' + ts + '.' + ext;
    }
};

window.ExperimentExport = ExperimentExport;
