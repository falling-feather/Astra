/**
 * 返回顶部 FAB（v4.2.17 / v4.2.44 改造：始终在折叠菜单内可见，
 * 不再受滚动距离限制——与其他 4 个功能 FAB 一致由 FabTrigger 统一展开/收起）
 */
(function() {
    'use strict';

    const BackToTop = {
        _btn: null,

        show() {
            if (this._btn) return;
            const btn = document.createElement('button');
            btn.className = 'back-to-top-fab back-to-top-fab--visible';
            btn.setAttribute('aria-label', '返回顶部');
            btn.setAttribute('data-tip', '返回顶部');
            btn.innerHTML = '<i data-lucide="arrow-up"></i>';
            btn.addEventListener('click', () => {
                btn.classList.remove('is-rippling');
                void btn.offsetWidth;
                btn.classList.add('is-rippling');
                setTimeout(() => btn.classList.remove('is-rippling'), 600);
                window.scrollTo({ top: 0, behavior: 'smooth' });
                // v4.2.22：单次动作后自动收起折叠菜单
                if (typeof FabTrigger !== 'undefined') FabTrigger.collapse();
            });
            document.body.appendChild(btn);
            this._btn = btn;
            if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
        },

        hide() {
            if (this._btn && this._btn.parentNode) this._btn.parentNode.removeChild(this._btn);
            this._btn = null;
        }
    };

    window.BackToTop = BackToTop;
})();
