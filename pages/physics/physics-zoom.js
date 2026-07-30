// Shared zoom modal for physics experiments.
const PhysicsZoom = {
    modal: null,
    host: null,
    titleEl: null,
    closeBtn: null,
    originalParent: null,
    movedCanvas: null,
    movedPlaceholder: null,
    originalInlineStyle: null,
    originalRect: null,
    _resizeHandlerBound: null,
    _closeHandlerBound: null,
    _backdropHandlerBound: null,
    _keydownHandlerBound: null,
    _listenersAttached: false,
    _returnFocusTarget: null,
    _pinchCtrl: null,

    init() {
        this._ensureModal();
        this._attachModalListeners();
        this._attachButtons();
    },

    _ensureModal() {
        if (document.getElementById('physics-zoom-modal')) {
            this.modal = document.getElementById('physics-zoom-modal');
            this.host = document.getElementById('physics-zoom-host');
            this.titleEl = document.getElementById('physics-zoom-title');
            this.closeBtn = document.getElementById('physics-zoom-close');
            return;
        }

        const modal = document.createElement('div');
        modal.id = 'physics-zoom-modal';
        modal.className = 'physics-zoom-modal';
        modal.innerHTML = `
            <div class="physics-zoom-modal__inner" role="dialog" aria-modal="true" aria-label="物理实验放大视图">
                <div class="physics-zoom-modal__toolbar">
                    <span id="physics-zoom-title" class="physics-zoom-modal__title">放大视图</span>
                    <button id="physics-zoom-close" class="physics-zoom-modal__close" type="button">关闭</button>
                </div>
                <div id="physics-zoom-host" class="physics-zoom-modal__host"></div>
            </div>
        `;
        document.body.appendChild(modal);

        this.modal = modal;
        this.host = document.getElementById('physics-zoom-host');
        this.titleEl = document.getElementById('physics-zoom-title');
        this.closeBtn = document.getElementById('physics-zoom-close');
    },

    _attachModalListeners() {
        if (this._listenersAttached || !this.modal || !this.closeBtn) return;
        if (!this._closeHandlerBound) this._closeHandlerBound = () => this.close();
        if (!this._backdropHandlerBound) {
            this._backdropHandlerBound = (e) => {
                if (e.target === this.modal) this.close();
            };
        }
        if (!this._keydownHandlerBound) {
            this._keydownHandlerBound = (e) => {
                if (!this.modal?.classList.contains('open')) return;
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    this.close();
                    return;
                }
                if (e.key === 'Tab') this._trapFocus(e);
            };
        }
        if (!this._resizeHandlerBound) this._resizeHandlerBound = () => this._handleResize();

        this.closeBtn.addEventListener('click', this._closeHandlerBound);
        this.modal.addEventListener('click', this._backdropHandlerBound);
        document.addEventListener('keydown', this._keydownHandlerBound);
        window.addEventListener('resize', this._resizeHandlerBound);
        this._listenersAttached = true;
    },

    _detachModalListeners() {
        if (!this._listenersAttached) return;
        this.closeBtn?.removeEventListener('click', this._closeHandlerBound);
        this.modal?.removeEventListener('click', this._backdropHandlerBound);
        document.removeEventListener('keydown', this._keydownHandlerBound);
        window.removeEventListener('resize', this._resizeHandlerBound);
        this._listenersAttached = false;
    },

    _focusableElements() {
        if (!this.modal) return [];
        const selector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
        return Array.from(this.modal.querySelectorAll(selector)).filter((element) => {
            if (element.isConnected === false || element.hidden || element.disabled) return false;
            if (element.getAttribute?.('aria-hidden') === 'true') return false;
            return true;
        });
    },

    _trapFocus(event) {
        const focusable = this._focusableElements();
        if (!focusable.length) {
            event.preventDefault();
            event.stopImmediatePropagation();
            this.closeBtn?.focus({ preventScroll: true });
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (event.shiftKey ? active === first || !this.modal.contains(active) : active === last || !this.modal.contains(active)) {
            event.preventDefault();
            event.stopImmediatePropagation();
            (event.shiftKey ? last : first).focus({ preventScroll: true });
        }
    },

    _restoreFocus() {
        const target = this._returnFocusTarget;
        this._returnFocusTarget = null;
        if (!target || typeof target.focus !== 'function') return;
        if (target.isConnected === false || target.hidden || target.disabled) return;
        if (target.getAttribute?.('aria-disabled') === 'true') return;
        if (target.closest?.('[hidden], [inert], [aria-hidden="true"]')) return;
        if (typeof target.getClientRects === 'function' && target.getClientRects().length === 0) return;
        target.focus({ preventScroll: true });
    },

    _attachButtons() {
        const sections = document.querySelectorAll('#page-physics .content-section[data-module]');
        sections.forEach(section => {
            const canvas = section.querySelector('canvas');
            if (!canvas) return;
            if (section.querySelector('.physics-zoom-btn')) return;

            const controls = section.querySelector(
                '.physics-controls, .em-controls, .wave-controls, .rel-actions, .circ-btns, .energy-controls, .circuit-controls, .emi-controls, .ac-controls, .grav-controls, .proj-action-row, .kin-action-row'
            );
            if (!controls) return;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'physics-zoom-btn';
            btn.textContent = '放大';
            btn.addEventListener('click', () => {
                const title = section.querySelector('h2, h3')?.textContent?.trim() || '物理实验';
                this.open(canvas, title, btn);
            });
            controls.appendChild(btn);
        });
    },

    open(canvas, title, trigger = document.activeElement) {
        if (!canvas || this.movedCanvas) return;
        this._ensureModal();
        this._attachModalListeners();
        this._returnFocusTarget = trigger;
        // 画布暂时挂到 modal 宿主时，各实验 resize 必须用 movedCanvas 判断并跳过，否则会按宿主宽度重算而破坏原比例与缓冲区。
        this.originalParent = canvas.parentElement;
        this.movedCanvas = canvas;
        this.movedPlaceholder = document.createComment('physics-zoom-placeholder');
        this.originalInlineStyle = canvas.getAttribute('style') || '';
        this.originalRect = canvas.getBoundingClientRect();
        this.originalParent.insertBefore(this.movedPlaceholder, canvas);
        this.host.appendChild(canvas);
        this.titleEl.textContent = title + ' · 放大视图';

        // 按原始尺寸作为基准，只做等比缩放，避免填充导致比例变化
        this.movedCanvas.style.width = this.originalRect.width + 'px';
        this.movedCanvas.style.height = this.originalRect.height + 'px';
        this.movedCanvas.style.transformOrigin = 'center center';

        this.modal.classList.add('open');

        // Enable pinch-zoom gesture on touch devices
        if (typeof TouchGestures !== 'undefined' && !this._pinchCtrl) {
            this._pinchCtrl = TouchGestures.enablePinchZoom(this.host, this.movedCanvas, { maxScale: 4 });
        }
        if (this._pinchCtrl) this._pinchCtrl.reset();
        this._syncScale();
        this.closeBtn.focus({ preventScroll: true });
    },

    _syncScale() {
        if (!this.movedCanvas || !this.originalRect || !this.host) return;
        const hostRect = this.host.getBoundingClientRect();
        if (hostRect.width <= 0 || hostRect.height <= 0 || this.originalRect.width <= 0 || this.originalRect.height <= 0) return;

        const sx = hostRect.width / this.originalRect.width;
        const sy = hostRect.height / this.originalRect.height;
        const scale = Math.min(1, sx, sy);

        // If pinch-zoom is active, delegate transform to its controller
        if (this._pinchCtrl) {
            this._pinchCtrl.setBaseScale(scale);
        } else {
            this.movedCanvas.style.transform = `scale(${scale})`;
        }
    },

    syncOriginalParentResize(canvas, originalParent) {
        if (
            !canvas
            || canvas !== this.movedCanvas
            || !originalParent
            || originalParent !== this.originalParent
        ) return false;
        this._handleResize();
        return true;
    },

    _handleResize() {
        if (this.movedCanvas && this.originalParent) {
            let metrics = null;
            try {
                const physics = window.PhysicsSim;
                if (
                    physics
                    && physics.canvas === this.movedCanvas
                    && typeof physics.resizeForZoom === 'function'
                ) {
                    metrics = physics.resizeForZoom(this.originalParent);
                }
            } catch (error) {
                metrics = null;
            }
            if (metrics) {
                this.originalRect = {
                    width: metrics.width,
                    height: metrics.height
                };
                this.movedCanvas.style.width = metrics.width + 'px';
                this.movedCanvas.style.height = metrics.height + 'px';
            }
        }
        this._syncScale();
    },

    close() {
        const canRestoreCanvas = this.movedCanvas && this.originalParent && this.movedPlaceholder;
        const restoredCanvas = canRestoreCanvas ? this.movedCanvas : null;
        try {
            if (this._pinchCtrl) { this._pinchCtrl.destroy(); this._pinchCtrl = null; }
            if (canRestoreCanvas) {
                // 先还原原始 inline 样式，确保缩小后尺寸完全回到放大前
                if (this.originalInlineStyle) {
                    this.movedCanvas.setAttribute('style', this.originalInlineStyle);
                } else {
                    this.movedCanvas.removeAttribute('style');
                }
                this.originalParent.insertBefore(this.movedCanvas, this.movedPlaceholder);
                this.originalParent.removeChild(this.movedPlaceholder);
            }
        } finally {
            this.movedCanvas = null;
            this.originalParent = null;
            this.movedPlaceholder = null;
            this.originalInlineStyle = null;
            this.originalRect = null;
            this.modal?.classList.remove('open');
            this._detachModalListeners();
            if (restoredCanvas) restoredCanvas.dispatchEvent(new Event('astra:physics-zoom-restored'));
            this._restoreFocus();
        }
    },

    destroy() {
        try {
            this.close();
        } finally {
            this._detachModalListeners();
            this._restoreFocus();
        }
    }
};

window.PhysicsZoom = PhysicsZoom;
