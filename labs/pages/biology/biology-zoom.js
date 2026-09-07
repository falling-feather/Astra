// 生物实验放大浮层（与物理 PhysicsZoom 行为一致，独立 DOM id）
const BiologyZoom = {
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
    _pinchCtrl: null,

    init() {
        this._ensureModal();
        this._attachButtons();
    },

    _ensureModal() {
        if (document.getElementById('biology-zoom-modal')) {
            this.modal = document.getElementById('biology-zoom-modal');
            this.host = document.getElementById('biology-zoom-host');
            this.titleEl = document.getElementById('biology-zoom-title');
            this.closeBtn = document.getElementById('biology-zoom-close');
            return;
        }

        const modal = document.createElement('div');
        modal.id = 'biology-zoom-modal';
        modal.className = 'biology-zoom-modal';
        modal.innerHTML = `
            <div class="biology-zoom-modal__inner" role="dialog" aria-modal="true" aria-label="生物实验放大视图">
                <div class="biology-zoom-modal__toolbar">
                    <span id="biology-zoom-title" class="biology-zoom-modal__title">放大视图</span>
                    <button id="biology-zoom-close" class="biology-zoom-modal__close" type="button">关闭</button>
                </div>
                <div id="biology-zoom-host" class="biology-zoom-modal__host"></div>
            </div>
        `;
        document.body.appendChild(modal);

        this.modal = modal;
        this.host = document.getElementById('biology-zoom-host');
        this.titleEl = document.getElementById('biology-zoom-title');
        this.closeBtn = document.getElementById('biology-zoom-close');

        this.closeBtn.addEventListener('click', () => this.close());
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.close();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.modal.classList.contains('open')) this.close();
        });
        this._resizeHandlerBound = () => this._syncScale();
        window.addEventListener('resize', this._resizeHandlerBound);
    },

    _attachButtons() {
        const sections = document.querySelectorAll('#page-biology .content-section[data-module]');
        sections.forEach(section => {
            const canvas = section.querySelector('canvas');
            if (!canvas) return;
            if (section.querySelector('.biology-zoom-btn')) return;

            let controls = section.querySelector(
                '.viz-controls, .mito-controls, .neural-controls, .immune-controls, ' +
                '#ecosystem-controls, #meiosis-controls, #gene-expression-controls, ' +
                '#cell-resp-controls, #substance-transport-controls, #gene-mutation-controls, ' +
                '.genexp-controls, .cellresp-controls, .strans-controls, .gmut-controls, ' +
                '#bio-genetics-controls, #bio-photo-sim-controls, .eco-controls, .meio-controls'
            );
            if (!controls) {
                controls = section.querySelector('.section-header');
            }
            if (!controls) return;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'biology-zoom-btn';
            btn.textContent = '放大';
            btn.addEventListener('click', () => {
                const title = section.querySelector('h2, h3')?.textContent?.trim() || '生物实验';
                this.open(canvas, title);
            });
            controls.appendChild(btn);
        });
    },

    open(canvas, title) {
        if (!canvas || this.movedCanvas) return;
        this.originalParent = canvas.parentElement;
        this.movedCanvas = canvas;
        this.movedPlaceholder = document.createComment('biology-zoom-placeholder');
        this.originalInlineStyle = canvas.getAttribute('style') || '';
        this.originalRect = canvas.getBoundingClientRect();
        this.originalParent.insertBefore(this.movedPlaceholder, canvas);
        this.host.appendChild(canvas);
        this.titleEl.textContent = title + ' · 放大视图';

        this.movedCanvas.style.width = this.originalRect.width + 'px';
        this.movedCanvas.style.height = this.originalRect.height + 'px';
        this.movedCanvas.style.transformOrigin = 'center center';

        this.modal.classList.add('open');
        this._syncScale();

        // Enable pinch-zoom gesture on touch devices
        if (typeof TouchGestures !== 'undefined' && !this._pinchCtrl) {
            this._pinchCtrl = TouchGestures.enablePinchZoom(this.host, this.movedCanvas, { maxScale: 4 });
        }
        if (this._pinchCtrl) this._pinchCtrl.reset();
    },

    _syncScale() {
        if (!this.movedCanvas || !this.originalRect || !this.host) return;
        const hostRect = this.host.getBoundingClientRect();
        if (hostRect.width <= 0 || hostRect.height <= 0 || this.originalRect.width <= 0 || this.originalRect.height <= 0) return;

        const sx = hostRect.width / this.originalRect.width;
        const sy = hostRect.height / this.originalRect.height;
        const scale = Math.min(sx, sy);

        // If pinch-zoom is active, delegate transform to its controller
        if (this._pinchCtrl) {
            this._pinchCtrl.setBaseScale(scale);
        } else {
            this.movedCanvas.style.transform = `scale(${scale})`;
        }
    },

    close() {
        if (!this.movedCanvas || !this.originalParent || !this.movedPlaceholder) return;
        // Destroy pinch-zoom controller
        if (this._pinchCtrl) { this._pinchCtrl.destroy(); this._pinchCtrl = null; }
        if (this.originalInlineStyle) {
            this.movedCanvas.setAttribute('style', this.originalInlineStyle);
        } else {
            this.movedCanvas.removeAttribute('style');
        }
        this.originalParent.insertBefore(this.movedCanvas, this.movedPlaceholder);
        this.originalParent.removeChild(this.movedPlaceholder);
        this.movedCanvas = null;
        this.originalParent = null;
        this.movedPlaceholder = null;
        this.originalInlineStyle = null;
        this.originalRect = null;
        this.modal.classList.remove('open');
    }
};

window.BiologyZoom = BiologyZoom;
