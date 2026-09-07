/* Local, audited runtime loader. Large language assets never load on the catalogue route. */
(function (global) {
    'use strict';

    const scripts = {
        javascript: [
            'vendor/js-interpreter/45d00b0c86e48cca1bb3af0f711bc4c0d626c359/acorn.js',
            'vendor/js-interpreter/45d00b0c86e48cca1bb3af0f711bc4c0d626c359/interpreter.js'
        ],
        python: [
            'vendor/skulpt/1.2.0/skulpt.min.js',
            'vendor/skulpt/1.2.0/skulpt-stdlib.js'
        ]
    };
    const pending = Object.create(null);

    function languageKey(language) {
        return language;
    }

    function addScript(src) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector('script[data-cv-runtime-src="' + src + '"]');
                if (existing) {
                    if (existing.dataset.cvLoaded === 'true') { resolve(); return; }
                    existing.addEventListener('load', resolve, { once: true });
                    existing.addEventListener('error', () => { existing.remove(); reject(new Error('运行组件未能载入。')); }, { once: true });
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.dataset.cvRuntimeSrc = src;
            script.onload = () => { script.dataset.cvLoaded = 'true'; resolve(); };
            script.onerror = () => { script.remove(); reject(new Error('运行组件未能载入。')); };
            document.head.appendChild(script);
        });
    }

    global.CvRuntimeLoader = {
        async ensure(language) {
            const key = languageKey(language);
            if (!scripts[key]) return;
            if (!pending[key]) {
                pending[key] = scripts[key]
                    .reduce((chain, src) => chain.then(() => addScript(src)), Promise.resolve())
                    .catch(error => { delete pending[key]; throw error; });
            }
            return pending[key];
        },
        isLoaded(language) {
            const key = languageKey(language);
            const sources = scripts[key];
            return !!(sources && pending[key] && document.querySelector('script[data-cv-runtime-src="' + sources[sources.length - 1] + '"][data-cv-loaded="true"]'));
        }
    };
})(window);
