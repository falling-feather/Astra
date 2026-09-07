// ===== Touch Gestures — Pinch-Zoom & Swipe-Back =====
// E-02: 移动端触控手势优化
// 提供可复用的 pinch-zoom（双指缩放 + 平移 + 双击重置）和 swipe-back（左边缘右划返回）。

const TouchGestures = {

    /* ────────────────────────────────────────────
     *  Pinch-Zoom  —  为任意容器内的目标元素启用双指缩放
     *
     *  container: 手势捕获区域 (通常是 .modal__host)
     *  target:    被缩放的元素 (通常是 canvas)
     *  opts.minScale    最小缩放 (默认 1)
     *  opts.maxScale    最大缩放 (默认 5)
     *  opts.onTransform 变换回调 ({scale, panX, panY, totalScale})
     *
     *  返回控制器 { setBaseScale(s), reset(), getScale(), destroy() }
     * ──────────────────────────────────────────── */
    enablePinchZoom(container, target, opts) {
        opts = opts || {};
        const minScale  = opts.minScale  || 1;
        const maxScale  = opts.maxScale  || 5;
        const onTransform = opts.onTransform || null;

        let scale   = 1;
        let panX    = 0;
        let panY    = 0;
        let baseScale = 1;

        // — Pinch state —
        let pinchStartDist  = 0;
        let pinchStartScale = 1;
        let pinchStartMidX  = 0;
        let pinchStartMidY  = 0;
        let pinchStartPanX  = 0;
        let pinchStartPanY  = 0;

        // — Single-finger pan (only when zoomed) —
        let singleStart = null;
        let singlePanX  = 0;
        let singlePanY  = 0;

        // — Double-tap —
        let lastTapTime = 0;

        function dist(a, b) {
            const dx = a.clientX - b.clientX;
            const dy = a.clientY - b.clientY;
            return Math.sqrt(dx * dx + dy * dy);
        }
        function mid(a, b) {
            return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
        }

        function clampPan() {
            const cr = container.getBoundingClientRect();
            const totalScale = baseScale * scale;
            const maxP = Math.max(0, (totalScale - 1) * Math.max(cr.width, cr.height) / 2);
            panX = Math.max(-maxP, Math.min(maxP, panX));
            panY = Math.max(-maxP, Math.min(maxP, panY));
        }

        function apply() {
            const ts = baseScale * scale;
            // translate THEN scale — so pan values are in screen px
            target.style.transform = 'translate(' + (panX) + 'px,' + (panY) + 'px) scale(' + ts + ')';
            target.style.transformOrigin = 'center center';
            if (onTransform) onTransform({ scale: scale, panX: panX, panY: panY, totalScale: ts });
        }

        function onStart(e) {
            if (e.touches.length === 2) {
                e.preventDefault();
                pinchStartDist  = dist(e.touches[0], e.touches[1]);
                pinchStartScale = scale;
                const m = mid(e.touches[0], e.touches[1]);
                pinchStartMidX = m.x;
                pinchStartMidY = m.y;
                pinchStartPanX = panX;
                pinchStartPanY = panY;
                singleStart = null;
            } else if (e.touches.length === 1) {
                // Double-tap detection
                const now = Date.now();
                if (now - lastTapTime < 300) {
                    e.preventDefault();
                    if (scale > 1.05) {
                        // Reset
                        scale = 1; panX = 0; panY = 0;
                    } else {
                        // Quick zoom to 2x around tap point
                        scale = 2;
                        panX = 0; panY = 0;
                    }
                    apply();
                    lastTapTime = 0;
                    return;
                }
                lastTapTime = now;

                // Single-finger pan when zoomed
                if (scale > 1.05) {
                    e.preventDefault();
                    singleStart  = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                    singlePanX   = panX;
                    singlePanY   = panY;
                }
            }
        }

        function onMove(e) {
            if (e.touches.length === 2) {
                e.preventDefault();
                const d = dist(e.touches[0], e.touches[1]);
                const m = mid(e.touches[0], e.touches[1]);
                scale = Math.max(minScale, Math.min(maxScale, pinchStartScale * (d / pinchStartDist)));
                panX  = pinchStartPanX + (m.x - pinchStartMidX);
                panY  = pinchStartPanY + (m.y - pinchStartMidY);
                clampPan();
                apply();
            } else if (e.touches.length === 1 && singleStart && scale > 1.05) {
                e.preventDefault();
                panX = singlePanX + (e.touches[0].clientX - singleStart.x);
                panY = singlePanY + (e.touches[0].clientY - singleStart.y);
                clampPan();
                apply();
            }
        }

        function onEnd(e) {
            if (e.touches.length < 2) singleStart = null;
            // Snap back near 1×
            if (scale < 1.05) {
                scale = 1; panX = 0; panY = 0;
                apply();
            }
        }

        container.addEventListener('touchstart', onStart, { passive: false });
        container.addEventListener('touchmove',  onMove,  { passive: false });
        container.addEventListener('touchend',   onEnd);
        container.addEventListener('touchcancel', onEnd);

        return {
            setBaseScale: function(s) { baseScale = s; apply(); },
            reset:        function()  { scale = 1; panX = 0; panY = 0; apply(); },
            getScale:     function()  { return scale; },
            destroy:      function()  {
                container.removeEventListener('touchstart', onStart);
                container.removeEventListener('touchmove',  onMove);
                container.removeEventListener('touchend',   onEnd);
                container.removeEventListener('touchcancel', onEnd);
            }
        };
    },

    /* ────────────────────────────────────────────
     *  Swipe-Back  —  左边缘右划触发回调
     *
     *  element:  手势区域 (通常是页面级容器)
     *  callback: 达到阈值后执行的函数
     *  opts.edgeWidth   识别起始区域宽度 (默认 24px)
     *  opts.threshold   触发距离 (默认 90px)
     *  opts.maxVertical 最大竖向偏移 (默认 75px)
     *
     *  返回 { destroy() }
     * ──────────────────────────────────────────── */
    enableSwipeBack(element, callback, opts) {
        opts = opts || {};
        const edgeWidth   = opts.edgeWidth   || 24;
        const threshold   = opts.threshold   || 90;
        const maxVertical = opts.maxVertical || 75;

        let tracking = false;
        let startX = 0;
        let startY = 0;

        // Visual indicator arrow
        let indicator = null;
        function ensureIndicator() {
            if (indicator) return;
            indicator = document.createElement('div');
            indicator.className = 'swipe-back-indicator';
            indicator.setAttribute('aria-hidden', 'true');
            indicator.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
            document.body.appendChild(indicator);
        }

        function onStart(e) {
            if (e.touches.length !== 1) return;
            const tx = e.touches[0].clientX;
            if (tx > edgeWidth) return;
            tracking = true;
            startX = tx;
            startY = e.touches[0].clientY;
            ensureIndicator();
        }

        function onMove(e) {
            if (!tracking || e.touches.length !== 1) return;
            const dx = e.touches[0].clientX - startX;
            const dy = Math.abs(e.touches[0].clientY - startY);

            if (dy > maxVertical || dx < 0) {
                tracking = false;
                if (indicator) { indicator.style.opacity = '0'; indicator.style.transform = 'translateX(-40px) translateY(-50%)'; }
                return;
            }

            if (indicator) {
                const progress = Math.min(dx / threshold, 1);
                indicator.style.opacity  = String(progress * 0.8);
                indicator.style.transform = 'translateX(' + (Math.min(dx, threshold + 10) - 40) + 'px) translateY(-50%)';
            }
        }

        function onEnd(e) {
            if (!tracking) return;
            tracking = false;
            const dx = (e.changedTouches[0] || e.touches[0]).clientX - startX;

            if (indicator) {
                indicator.style.opacity = '0';
                indicator.style.transform = 'translateX(-40px) translateY(-50%)';
            }

            if (dx >= threshold) {
                callback();
            }
        }

        function onCancel() {
            tracking = false;
            if (indicator) { indicator.style.opacity = '0'; indicator.style.transform = 'translateX(-40px) translateY(-50%)'; }
        }

        element.addEventListener('touchstart',  onStart, { passive: true });
        element.addEventListener('touchmove',   onMove,  { passive: true });
        element.addEventListener('touchend',    onEnd);
        element.addEventListener('touchcancel', onCancel);

        return {
            destroy: function() {
                element.removeEventListener('touchstart',  onStart);
                element.removeEventListener('touchmove',   onMove);
                element.removeEventListener('touchend',    onEnd);
                element.removeEventListener('touchcancel', onCancel);
                if (indicator && indicator.parentNode) indicator.parentNode.removeChild(indicator);
                indicator = null;
            }
        };
    }
};

window.TouchGestures = TouchGestures;
