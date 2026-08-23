(() => {
    'use strict';

    const DEFAULT_PARAMETER = 50;

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    const __OWNER__ = {
        root: null,
        canvas: null,
        context: null,
        readout: null,
        controls: null,
        resizeObserver: null,
        frame: 0,
        lastTime: 0,
        parameter: DEFAULT_PARAMETER,
        elapsed: 0,
        paused: false,

        init() {
            this.destroy();
            this.root = document.querySelector(
                '#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE__'
            );
            if (!this.root) return false;

            this.canvas = this.root.querySelector('[data-role="canvas"]');
            this.readout = this.root.querySelector('[data-role="readout"]');
            if (!this.canvas || !this.readout) {
                this.destroy();
                return false;
            }

            this.context = this.canvas.getContext('2d');
            if (!this.context) {
                this.destroy();
                return false;
            }

            this.controls = new AbortController();
            const signal = this.controls.signal;
            this.root.querySelector('[data-control="parameter"]')?.addEventListener('input', (event) => {
                this.parameter = clamp(Number(event.target.value), 0, 100);
                this.render();
            }, { signal });
            this.root.querySelector('[data-action="toggle"]')?.addEventListener('click', (event) => {
                this.paused = !this.paused;
                event.currentTarget.textContent = this.paused ? '继续' : '暂停';
                event.currentTarget.setAttribute('aria-pressed', String(this.paused));
                if (!this.paused && !this.frame) this.startLoop();
            }, { signal });
            this.root.querySelector('[data-action="reset"]')?.addEventListener('click', () => {
                this.reset();
            }, { signal });

            this.resizeObserver = new ResizeObserver(() => this.resize());
            this.resizeObserver.observe(this.canvas.parentElement || this.canvas);
            this.resize();
            this.reset();
            return true;
        },

        reset() {
            this.parameter = DEFAULT_PARAMETER;
            this.elapsed = 0;
            this.paused = false;
            const parameter = this.root?.querySelector('[data-control="parameter"]');
            const toggle = this.root?.querySelector('[data-action="toggle"]');
            if (parameter) parameter.value = String(DEFAULT_PARAMETER);
            if (toggle) {
                toggle.textContent = '暂停';
                toggle.setAttribute('aria-pressed', 'false');
            }
            this.render();
            if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) this.startLoop();
        },

        resize() {
            if (!this.canvas || !this.context) return;
            const parent = this.canvas.parentElement || this.canvas;
            const rect = parent.getBoundingClientRect();
            const width = Math.max(1, Math.round(rect.width || 640));
            const height = Math.max(1, Math.round(rect.height || 360));
            const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
            this.canvas.width = Math.round(width * dpr);
            this.canvas.height = Math.round(height * dpr);
            this.canvas.style.width = `${width}px`;
            this.canvas.style.height = `${height}px`;
            this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
            this.render();
        },

        startLoop() {
            if (this.frame || this.paused) return;
            this.lastTime = performance.now();
            const tick = (now) => {
                this.frame = 0;
                if (!this.root || this.paused) return;
                const dt = clamp((now - this.lastTime) / 1000, 0, 0.05);
                this.lastTime = now;
                this.elapsed += dt;
                this.render();
                this.frame = requestAnimationFrame(tick);
            };
            this.frame = requestAnimationFrame(tick);
        },

        snapshot() {
            return Object.freeze({
                parameter: this.parameter,
                elapsed_seconds: this.elapsed
            });
        },

        render() {
            if (!this.context || !this.canvas || !this.readout) return;
            const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
            const width = this.canvas.width / dpr;
            const height = this.canvas.height / dpr;
            const state = this.snapshot();
            this.context.clearRect(0, 0, width, height);
            this.context.fillStyle = '#0b1730';
            this.context.fillRect(0, 0, width, height);
            this.context.fillStyle = '#73e0ff';
            this.context.beginPath();
            this.context.arc(
                width * (0.2 + state.parameter / 166),
                height * (0.5 + Math.sin(state.elapsed_seconds * 2) * 0.12),
                Math.max(8, Math.min(width, height) * 0.035),
                0,
                Math.PI * 2
            );
            this.context.fill();
            this.readout.textContent = `变量 ${state.parameter.toFixed(0)} · 时间 ${state.elapsed_seconds.toFixed(1)} s`;
        },

        destroy() {
            if (this.frame) cancelAnimationFrame(this.frame);
            this.frame = 0;
            this.controls?.abort();
            this.controls = null;
            this.resizeObserver?.disconnect();
            this.resizeObserver = null;
            this.root = null;
            this.canvas = null;
            this.context = null;
            this.readout = null;
            this.paused = false;
            this.elapsed = 0;
        }
    };

    window.__OWNER__ = __OWNER__;
    window.init__OWNER__ = () => __OWNER__.init();
})();
