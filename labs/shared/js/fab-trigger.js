/**
 * FAB 折叠触发器（v4.2.19）
 * 默认折叠状态：仅显示主控按钮；点击展开 4 个功能 FAB（错峰飞入）。
 */
(function() {
    'use strict';

    const ACTION_SELECTOR = [
        '.favorite-fab',
        '.experiment-guide-help-btn',
        '.back-to-top-fab',
        '.experiment-export-btn'
    ].join(', ');
    const EXPORT_MENU_SELECTOR = '.experiment-export-menu';
    const EXPORT_MENU_ITEM_SELECTOR = '.experiment-export-menu__item';
    const EXPORT_MENU_ID = 'experiment-export-menu';
    const FOCUS_STRUCTURE_SELECTOR = [
        ACTION_SELECTOR,
        EXPORT_MENU_SELECTOR,
        EXPORT_MENU_ITEM_SELECTOR
    ].join(', ');

    const FabTrigger = {
        _btn: null,
        _scrim: null,
        _trace: null,
        _expanded: false,
        _onDocClick: null,
        _onKeyDown: null,
        _focusObserver: null,
        _exportMenuObserver: null,
        _observedExportMenu: null,
        _focusRestore: new WeakMap(),
        _collapseTimer: 0,

        _rememberFocusState(element) {
            if (!element || this._focusRestore.has(element)) return;
            this._focusRestore.set(element, {
                hadTabIndex: element.hasAttribute('tabindex'),
                tabIndex: element.getAttribute('tabindex'),
                hadAriaHidden: element.hasAttribute('aria-hidden'),
                ariaHidden: element.getAttribute('aria-hidden'),
                hadInert: element.hasAttribute('inert'),
                inert: Boolean(element.inert)
            });
        },

        _makeFocusUnavailable(element) {
            if (!element) return;
            this._rememberFocusState(element);
            element.setAttribute('tabindex', '-1');
            element.setAttribute('aria-hidden', 'true');
            element.setAttribute('inert', '');
            if ('inert' in element) element.inert = true;
        },

        _restoreFocusState(element) {
            const previous = element && this._focusRestore.get(element);
            if (!previous) return;
            if (previous.hadTabIndex) element.setAttribute('tabindex', previous.tabIndex);
            else element.removeAttribute('tabindex');
            if (previous.hadAriaHidden) element.setAttribute('aria-hidden', previous.ariaHidden);
            else element.removeAttribute('aria-hidden');
            if (previous.hadInert) element.setAttribute('inert', '');
            else element.removeAttribute('inert');
            if ('inert' in element) element.inert = previous.inert;
            this._focusRestore.delete(element);
        },

        _focusElement(element) {
            if (!element || typeof element.focus !== 'function') return;
            try {
                element.focus({ preventScroll: true });
            } catch (_) {
                element.focus();
            }
        },

        _focusPrimaryIfNeeded() {
            const active = document.activeElement;
            if (!active || !this._btn) return;
            const action = active.closest && active.closest(ACTION_SELECTOR);
            const menu = document.querySelector(EXPORT_MENU_SELECTOR);
            if (action || menu && menu.contains(active)) this._focusElement(this._btn);
        },

        _hasHigherPriorityEscapeOwner() {
            const zoomModal = document.querySelector(
                '.physics-zoom-modal.open, .biology-zoom-modal.open'
            );
            if (zoomModal) return true;
            const guideOverlay = document.getElementById('experiment-guide-overlay');
            if (guideOverlay && guideOverlay.classList.contains('active')) return true;
            return Boolean(window.ExperimentExport && window.ExperimentExport._menuOpen);
        },

        _closeExportMenu() {
            const menu = document.querySelector(EXPORT_MENU_SELECTOR);
            if (!menu || !menu.classList.contains('open')) return;
            const owner = window.ExperimentExport;
            if (owner && typeof owner._closeMenu === 'function') owner._closeMenu();
            else menu.classList.remove('open');
        },

        _observeExportMenu(menu) {
            if (this._observedExportMenu === menu && this._exportMenuObserver) return;
            if (this._exportMenuObserver) this._exportMenuObserver.disconnect();
            this._exportMenuObserver = null;
            this._observedExportMenu = menu || null;
            if (!menu || !this._btn) return;
            this._exportMenuObserver = new MutationObserver(mutations => {
                if (
                    !this._btn
                    || this._observedExportMenu !== menu
                    || !mutations.some(mutation => (
                        mutation.type === 'attributes'
                        && mutation.target === menu
                        && mutation.attributeName === 'class'
                    ))
                ) return;
                this._syncExportFocusState(menu);
            });
            this._exportMenuObserver.observe(menu, {
                attributes: true,
                attributeFilter: ['class']
            });
        },

        _syncExportFocusState(menu) {
            const currentMenu = menu || document.querySelector(EXPORT_MENU_SELECTOR);
            this._observeExportMenu(currentMenu);
            const exportButton = document.querySelector('.experiment-export-btn');
            if (!currentMenu) {
                if (exportButton) exportButton.setAttribute('aria-expanded', 'false');
                return;
            }
            if (!currentMenu.id) currentMenu.id = EXPORT_MENU_ID;
            const items = Array.from(currentMenu.querySelectorAll(EXPORT_MENU_ITEM_SELECTOR));
            const menuAvailable = Boolean(
                this._expanded
                && this._btn
                && currentMenu.classList.contains('open')
            );
            if (exportButton) {
                exportButton.setAttribute('aria-controls', currentMenu.id);
                exportButton.setAttribute('aria-expanded', menuAvailable ? 'true' : 'false');
            }
            if (menuAvailable) {
                this._restoreFocusState(currentMenu);
                items.forEach(element => this._restoreFocusState(element));
                return;
            }
            const active = document.activeElement;
            if (active && currentMenu.contains(active)) {
                const fallback = this._expanded
                    ? document.querySelector('.experiment-export-btn')
                    : this._btn;
                this._focusElement(fallback || this._btn);
            }
            this._makeFocusUnavailable(currentMenu);
            items.forEach(element => this._makeFocusUnavailable(element));
        },

        _syncFocusState() {
            const actions = Array.from(document.querySelectorAll(ACTION_SELECTOR));
            if (this._expanded && this._btn) {
                actions.forEach(element => this._restoreFocusState(element));
            } else {
                this._focusPrimaryIfNeeded();
                actions.forEach(element => this._makeFocusUnavailable(element));
            }
            this._syncExportFocusState(document.querySelector(EXPORT_MENU_SELECTOR));
        },

        _startFocusObserver() {
            if (this._focusObserver) this._focusObserver.disconnect();
            if (this._exportMenuObserver) this._exportMenuObserver.disconnect();
            this._exportMenuObserver = null;
            this._observedExportMenu = null;
            this._focusObserver = new MutationObserver(mutations => {
                if (!this._btn) return;
                const changedNodes = mutations.flatMap(mutation => (
                    mutation.type === 'childList'
                        ? Array.from(mutation.addedNodes).concat(Array.from(mutation.removedNodes))
                        : []
                ));
                const relevantStructureChanged = changedNodes.some(node => (
                    node.nodeType === 1
                    && (
                        node.matches(FOCUS_STRUCTURE_SELECTOR)
                        || node.querySelector(FOCUS_STRUCTURE_SELECTOR)
                    )
                ));
                if (!relevantStructureChanged) return;
                const actionCountChanged = changedNodes.some(node => (
                    node.nodeType === 1
                    && (
                        node.matches(ACTION_SELECTOR)
                        || node.querySelector(ACTION_SELECTOR)
                    )
                ));
                this._syncFocusState();
                if (actionCountChanged && this._refreshBadge) this._refreshBadge();
            });
            this._focusObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
            this._syncFocusState();
        },

        _stopFocusObservers() {
            if (this._focusObserver) this._focusObserver.disconnect();
            this._focusObserver = null;
            if (this._exportMenuObserver) this._exportMenuObserver.disconnect();
            this._exportMenuObserver = null;
            this._observedExportMenu = null;
        },

        show() {
            if (this._btn) {
                this._syncFocusState();
                return;
            }
            // 默认折叠
            document.body.setAttribute('data-fab-expanded', 'false');
            this._expanded = false;

            const btn = document.createElement('button');
            btn.className = 'fab-trigger';
            btn.setAttribute('aria-label', '展开/收起浮动按钮');
            btn.setAttribute('aria-expanded', 'false');
            btn.setAttribute('data-tip', '更多操作');
            btn.innerHTML = '<i class="fab-trigger-icon fab-trigger-icon--menu" data-lucide="more-vertical"></i><i class="fab-trigger-icon fab-trigger-icon--close" data-lucide="x"></i><span class="fab-trigger-badge" title="折叠中的快捷操作数量">0</span>';
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggle();
                // v4.2.26：点击 ripple 水波
                btn.classList.remove('is-rippling');
                void btn.offsetWidth;
                btn.classList.add('is-rippling');
                setTimeout(() => btn.classList.remove('is-rippling'), 600);
            });
            document.body.appendChild(btn);
            this._btn = btn;
            if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });

            // v5.0：徒章根据实际存在的 FAB 数量动态更新，延迟等其他模块创建完成
            this._refreshBadge = () => {
                if (!this._btn) return;
                const badge = this._btn.querySelector('.fab-trigger-badge');
                if (!badge) return;
                const count = document.querySelectorAll(
                    '.favorite-fab, .experiment-guide-help-btn, .back-to-top-fab, .experiment-export-btn'
                ).length;
                badge.textContent = String(count);
                badge.style.display = count > 0 ? '' : 'none';
                badge.title = count > 0 ? '折叠中的快捷操作：' + count + ' 个，点击主按钮展开' : '';
                badge.setAttribute('aria-label', count > 0 ? '折叠中的快捷操作：' + count + ' 个' : '');
                // v6.0.x：根据数量动态调整 data-tip 让主按钮 tooltip 也含意更明确
                if (this._btn) {
                    this._btn.setAttribute('data-tip', count > 0 ? '更多操作 · ' + count + ' 项' : '更多操作');
                }
            };
            setTimeout(this._refreshBadge, 300);
            setTimeout(this._refreshBadge, 1200);

            // v4.2.27：创建半透明遮罩（默认隐藏）
            const scrim = document.createElement('div');
            scrim.className = 'fab-scrim';
            scrim.addEventListener('click', () => this.collapse());
            document.body.appendChild(scrim);
            this._scrim = scrim;

            // v4.2.32：fan-out 弧形轨迹 SVG（仅桌面可见）
            // v4.2.36：内嵌走马灯微粒（SMIL animateMotion 沿 path 循环）
            const trace = document.createElement('div');
            trace.className = 'fab-trace';
            trace.innerHTML = '<svg width="250" height="250" viewBox="0 0 250 250" aria-hidden="true">'
                + '<defs>'
                + '<linearGradient id="fab-trace-grad" gradientUnits="userSpaceOnUse" x1="125" y1="15" x2="23" y2="83">'
                + '<stop offset="0%" stop-color="#5b8dce"/>'
                + '<stop offset="33%" stop-color="#f472b6"/>'
                + '<stop offset="66%" stop-color="#00ffd5"/>'
                + '<stop offset="100%" stop-color="#a78bfa"/>'
                + '</linearGradient>'
                + '<path id="fab-trace-path" d="M 125 15 A 110 110 0 0 0 23 83"/>'
                + '</defs>'
                + '<use class="fab-trace-line" href="#fab-trace-path" stroke="url(#fab-trace-grad)" fill="none"/>'
                // v4.2.41：4 个静默定位锚点（与 4 FAB 弧线角度对应）
                + '<g class="fab-trace-anchors">'
                + '<circle cx="125" cy="15"  r="2.5" fill="#5b8dce" opacity="0.85"/>'
                + '<circle cx="83.4" cy="22.9" r="2.5" fill="#f472b6" opacity="0.85"/>'
                + '<circle cx="47.2" cy="47.2" r="2.5" fill="#00ffd5" opacity="0.85"/>'
                + '<circle cx="22.9" cy="83.4" r="2.5" fill="#a78bfa" opacity="0.85"/>'
                + '</g>'
                + '<circle class="fab-trace-particle" r="3.5" fill="#00ffd5">'
                + '<animateMotion dur="2.4s" repeatCount="indefinite" rotate="auto">'
                + '<mpath href="#fab-trace-path"/>'
                + '</animateMotion>'
                + '</circle>'
                + '<circle class="fab-trace-particle fab-trace-particle--alt" r="3" fill="#a78bfa">'
                + '<animateMotion dur="2.4s" begin="1.2s" repeatCount="indefinite" rotate="auto">'
                + '<mpath href="#fab-trace-path"/>'
                + '</animateMotion>'
                + '</circle>'
                + '</svg>';
            document.body.appendChild(trace);
            this._trace = trace;

            // v4.2.25：每会话首次出现时跳动 2 次，提示用户发现
            try {
                if (!sessionStorage.getItem('englab-fab-discovered')) {
                    btn.classList.add('fab-trigger--bouncing');
                    setTimeout(() => btn.classList.remove('fab-trigger--bouncing'), 1500);
                    sessionStorage.setItem('englab-fab-discovered', '1');
                }
            } catch (e) { /* sessionStorage 不可用则跳过 */ }

            // v4.2.20：点击 FAB 面板外区域自动收起
            this._onDocClick = (e) => {
                if (!this._expanded) return;
                const t = e.target;
                if (!t || !t.closest) return;
                if (t.closest('.fab-trigger') ||
                    t.closest('.favorite-fab') ||
                    t.closest('.experiment-guide-help-btn') ||
                    t.closest('.back-to-top-fab') ||
                    t.closest('.experiment-export-btn') ||
                    t.closest('.experiment-export-menu')) {
                    return; // 点击在任何 FAB / 导出菜单 上，不收起
                }
                this.collapse();
            };
            document.addEventListener('click', this._onDocClick, true);

            // v4.2.21：ESC 键收起菜单（键盘友好）
            this._onKeyDown = (e) => {
                if (
                    e.key === 'Escape'
                    && this._expanded
                    && !this._hasHigherPriorityEscapeOwner()
                ) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    this.collapse();
                }
            };
            document.addEventListener('keydown', this._onKeyDown, true);
            this._startFocusObserver();
        },

        hide() {
            this._focusPrimaryIfNeeded();
            this._closeExportMenu();
            this._expanded = false;
            this._syncFocusState();
            if (this._collapseTimer) clearTimeout(this._collapseTimer);
            this._collapseTimer = 0;
            this._stopFocusObservers();
            if (this._btn && this._btn.parentNode) this._btn.parentNode.removeChild(this._btn);
            this._btn = null;
            if (this._scrim && this._scrim.parentNode) this._scrim.parentNode.removeChild(this._scrim);
            this._scrim = null;
            if (this._trace && this._trace.parentNode) this._trace.parentNode.removeChild(this._trace);
            this._trace = null;
            document.body.removeAttribute('data-fab-expanded');
            document.body.removeAttribute('data-fab-collapsing');
            if (this._onDocClick) {
                document.removeEventListener('click', this._onDocClick, true);
                this._onDocClick = null;
            }
            if (this._onKeyDown) {
                document.removeEventListener('keydown', this._onKeyDown, true);
                this._onKeyDown = null;
            }
        },

        collapse() {
            if (!this._expanded) {
                this._closeExportMenu();
                if (this._btn) this._btn.setAttribute('aria-expanded', 'false');
                this._syncFocusState();
                return;
            }
            this._focusPrimaryIfNeeded();
            this._closeExportMenu();
            this._expanded = false;
            document.body.setAttribute('data-fab-expanded', 'false');
            // v4.2.33：收起时反向错峰（远端先归位 → 近端最后）
            document.body.setAttribute('data-fab-collapsing', 'true');
            if (this._collapseTimer) clearTimeout(this._collapseTimer);
            this._collapseTimer = setTimeout(() => {
                this._collapseTimer = 0;
                // 仅当此刻仍是收起状态才清除（防止用户瞬间再次展开）
                if (!this._expanded) document.body.removeAttribute('data-fab-collapsing');
            }, 450);
            if (this._btn) {
                this._btn.classList.remove('fab-trigger--open');
                this._btn.setAttribute('aria-expanded', 'false');
                this._btn.setAttribute('data-tip', '更多操作');
            }
            if (this._scrim) this._scrim.classList.remove('fab-scrim--visible');
            this._syncFocusState();
        },

        toggle() {
            // v4.2.33：收起路径走 collapse() 以复用反向动画逻辑
            if (this._expanded) {
                this.collapse();
                return;
            }
            this._expanded = true;
            if (this._collapseTimer) clearTimeout(this._collapseTimer);
            this._collapseTimer = 0;
            document.body.setAttribute('data-fab-expanded', 'true');
            document.body.removeAttribute('data-fab-collapsing');
            // v5.0：展开前再次刷新徒章数量，保证与实际弹出的 FAB 匹配
            if (this._refreshBadge) this._refreshBadge();
            if (this._btn) {
                this._btn.classList.toggle('fab-trigger--open', this._expanded);
                this._btn.setAttribute('aria-expanded', 'true');
                this._btn.setAttribute('data-tip', this._expanded ? '收起菜单' : '更多操作');
            }
            if (this._scrim) this._scrim.classList.toggle('fab-scrim--visible', this._expanded);
            this._syncFocusState();
            // v4.2.29：展开瞬间发出青色光环
            if (this._expanded) {
                const halo = document.createElement('span');
                halo.className = 'fab-trigger-halo';
                document.body.appendChild(halo);
                setTimeout(() => { if (halo.parentNode) halo.parentNode.removeChild(halo); }, 650);
            }
        }
    };

    window.FabTrigger = FabTrigger;
})();
