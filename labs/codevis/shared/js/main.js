/* ============================================================
 * Codevis application entry.
 * ============================================================ */
(function () {
    'use strict';

    async function bootstrap() {
        if (window.CvStudentContext && typeof window.CvStudentContext.start === 'function') {
            await window.CvStudentContext.start();
            const contextState = window.CvStudentContext.getState && window.CvStudentContext.getState();
            if (contextState && contextState.phase === 'redirecting') return;
        }

        if (window.CvRouter) {
            CvRouter.register('catalog', { onEnter: () => window.CvCourseCatalog && CvCourseCatalog.init() });
            CvRouter.register('lesson', { onEnter: () => window.CvCourseCatalog && CvCourseCatalog.renderLesson() });
            CvRouter.register('challenge', {
                onEnter: () => window.CvCourseChallenge && CvCourseChallenge.init(),
                onLeave: () => window.CvCourseChallenge && CvCourseChallenge.cancel()
            });
            CvRouter.register('trace', {
                onEnter: () => window.CodeTrace && CodeTrace.init(),
                onLeave: () => {
                    window.CodeTrace && CodeTrace.destroy && CodeTrace.destroy();
                    window.CvRuntime && CvRuntime.cancel();
                }
            });
            CvRouter.init();
        }

        document.querySelectorAll('.cv-nav-item').forEach(el => {
            el.addEventListener('click', (event) => {
                const page = el.dataset.page;
                if (!page) return;
                event.preventDefault();
                CvRouter.navigateTo(page);
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { bootstrap(); });
    } else {
        bootstrap();
    }
})();
