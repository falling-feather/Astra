(() => {
    'use strict';

    const DEFAULT_PARAMETER = 50;

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    const __OWNER__ = {
        root: null,
        canvas: null,
        context: null,
        readout: null,
        parameterControl: null,
        parameterOutput: null,
        toggleButton: null,
        stateOutput: null,
        notice: null,
        controls: null,
        resizeObserver: null,
        motionPreference: null,
        frame: 0,
        lastTime: 0,
        parameter: DEFAULT_PARAMETER,
        elapsed: 0,
        paused: false,
        reducedMotion: false,

        init() {
            this.destroy();
            this.root = document.querySelector(
                '#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE__'
            );
            if (!this.root) return false;

            this.canvas = this.root.querySelector('[data-role="canvas"]');
            this.readout = this.root.querySelector('[data-role="readout"]');
            this.parameterControl = this.root.querySelector('[data-control="parameter"]');
            this.parameterOutput = this.root.querySelector('[data-role="parameter-value"]');
            this.toggleButton = this.root.querySelector('[data-action="toggle"]');
            this.stateOutput = this.root.querySelector('[data-role="state"]');
            this.notice = this.root.querySelector('[data-role="notice"]');
            if (
                !this.canvas
                || !this.readout
                || !this.parameterControl
                || !this.parameterOutput
                || !this.toggleButton
                || !this.stateOutput
                || !this.notice
            ) {
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
            this.motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
            this.reducedMotion = Boolean(this.motionPreference.matches);
            this.parameterControl.addEventListener('input', (event) => {
                this.parameter = clamp(Number(event.target.value), 0, 100);
                this.syncUi();
                this.render();
            }, { signal });
            this.toggleButton.addEventListener('click', () => {
                if (this.reducedMotion) return;
                this.paused = !this.paused;
                if (this.paused) this.stopLoop();
                this.syncUi();
                if (!this.paused && !this.frame) this.startLoop();
            }, { signal });
            this.root.querySelector('[data-action="reset"]')?.addEventListener('click', () => {
                this.reset();
            }, { signal });
            this.motionPreference.addEventListener?.('change', (event) => {
                this.reducedMotion = Boolean(event.matches);
                if (this.reducedMotion) this.stopLoop();
                this.syncUi();
                this.render();
                if (!this.reducedMotion && !this.paused) this.startLoop();
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
            this.stopLoop();
            if (this.parameterControl) this.parameterControl.value = String(DEFAULT_PARAMETER);
            this.syncUi();
            this.render();
            if (!this.reducedMotion) this.startLoop();
        },

        syncUi() {
            if (!this.root) return;
            const state = this.reducedMotion
                ? 'reduced-motion'
                : (this.paused ? 'paused' : 'running');
            const stateLabel = this.reducedMotion
                ? '静态模式'
                : (this.paused ? '已暂停' : '运行中');
            const notice = this.reducedMotion
                ? '已减少动态效果；调整参数仍会刷新静态结果。'
                : (this.paused ? '模拟已暂停，可调整参数或继续。' : '模拟运行中，可直接调整参数。');
            const parameterLabel = `${this.parameter.toFixed(0)} __PARAMETER_UNIT__`;

            this.root.dataset.state = state;
            if (this.parameterOutput) {
                this.parameterOutput.value = parameterLabel;
                this.parameterOutput.textContent = parameterLabel;
            }
            if (this.stateOutput) {
                this.stateOutput.value = stateLabel;
                this.stateOutput.textContent = stateLabel;
            }
            if (this.notice) this.notice.textContent = notice;
            if (this.toggleButton) {
                this.toggleButton.disabled = this.reducedMotion;
                this.toggleButton.textContent = this.reducedMotion
                    ? '静态模式'
                    : (this.paused ? '继续模拟' : '暂停模拟');
                this.toggleButton.setAttribute(
                    'aria-pressed',
                    String(this.paused || this.reducedMotion)
                );
            }
        },

        resize() {
            if (!this.canvas || !this.context) return;
            const parent = this.canvas.parentElement || this.canvas;
            const rect = parent.getBoundingClientRect();
            const width = Math.round(parent.clientWidth || rect.width || 0);
            const height = Math.round(parent.clientHeight || rect.height || 0);
            if (width <= 0 || height <= 0) return;
            const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
            this.canvas.width = Math.round(width * dpr);
            this.canvas.height = Math.round(height * dpr);
            this.canvas.style.width = `${width}px`;
            this.canvas.style.height = `${height}px`;
            this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
            this.render();
        },

        stopLoop() {
            if (this.frame) cancelAnimationFrame(this.frame);
            this.frame = 0;
        },

        startLoop() {
            if (this.frame || this.paused || this.reducedMotion) return;
            this.lastTime = performance.now();
            const tick = (now) => {
                this.frame = 0;
                if (!this.root || this.paused || this.reducedMotion) return;
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
            this.readout.textContent = `__PARAMETER_LABEL__ ${state.parameter.toFixed(0)} __PARAMETER_UNIT__ · 时间 ${state.elapsed_seconds.toFixed(1)} s`;
        },

        destroy() {
            this.stopLoop();
            this.controls?.abort();
            this.controls = null;
            this.resizeObserver?.disconnect();
            this.resizeObserver = null;
            this.motionPreference = null;
            this.root = null;
            this.canvas = null;
            this.context = null;
            this.readout = null;
            this.parameterControl = null;
            this.parameterOutput = null;
            this.toggleButton = null;
            this.stateOutput = null;
            this.notice = null;
            this.paused = false;
            this.reducedMotion = false;
            this.elapsed = 0;
        }
    };

    window.__OWNER__ = __OWNER__;
    window.init__OWNER__ = () => __OWNER__.init();
})();
