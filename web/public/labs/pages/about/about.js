/* ═══════════════════════════════════════════════════════════════
 * About 模块 —— 开源协议与用户版更新摘要
 * ═══════════════════════════════════════════════════════════════ */

(() => {
    'use strict';

    const MARKED_ASSET = 'shared/vendor/marked-v12/marked.min.js?v=20260719re2OfflineP0';
    const cache = Object.create(null);
    let markedPromise = null;

    const PUBLIC_CHANGELOG = [
        {
            date: '2026-06-18',
            title: '多学科学习地图升级',
            items: [
                '首页学科地图补充了学习建议、主题层级与参考资料入口。',
                '数学、物理、化学、生物、算法等模块的实验卡片说明更贴近学习任务。',
                '新增工程、材料、信息技术、数据科学、人文与宇宙等方向的可视化入口。'
            ]
        },
        {
            date: '2026-06-18',
            title: '知识内容与交互细化',
            items: [
                '生命科学模块补充细胞呼吸、光合作用等主题的概念边界与参考教材。',
                '理化模块加强单位、模型近似和适用条件说明，降低误读概率。',
                '多个实验补充移动端适配、画布文字排版和交互反馈。'
            ]
        },
        {
            date: '2026-06-18',
            title: '页面体验整理',
            items: [
                '统一模块选择器、实验卡片、悬浮入口和返回顶部等公共界面。',
                '刷新本地缓存版本，减少旧资源导致的页面显示异常。',
                '整理公开页面文案，使说明面向学习者而不是开发流程。'
            ]
        }
    ];

    /** 懒加载 marked.js */
    function loadMarked() {
        if (window.marked) return Promise.resolve(window.marked);
        if (markedPromise) return markedPromise;
        markedPromise = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = MARKED_ASSET;
            s.onload = () => {
                if (window.marked) resolve(window.marked);
                else reject(new Error('marked.js 已加载但全局变量缺失'));
            };
            s.onerror = () => reject(new Error('本地 Markdown 渲染组件加载失败'));
            document.head.appendChild(s);
        });
        return markedPromise;
    }

    /** 拉取文本，会话内缓存 */
    async function fetchText(url) {
        if (cache[url]) return cache[url];
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`无法加载 ${url}（HTTP ${res.status}）`);
        const txt = await res.text();
        cache[url] = txt;
        return txt;
    }

    /** 简单的 HTML 转义（用于内容回退） */
    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /** 时间戳格式化 */
    function fmtTime(d) {
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    /** 主渲染函数 */
    async function renderMarkdown(targetId, { url, title, subtitle }) {
        const root = document.getElementById(targetId);
        if (!root) return;
        root.innerHTML = `<div class="about-doc__loading">正在加载内容…</div>`;

        try {
            const [marked, src] = await Promise.all([loadMarked(), fetchText(url)]);

            // marked v12 推荐 API：marked.parse(md, options)
            const html = marked.parse(src, { gfm: true, breaks: false });

            root.innerHTML = `
                <header class="about-doc__header">
                    <span class="about-doc__eyebrow">${escapeHtml(subtitle)}</span>
                    <h1 class="about-doc__title">${escapeHtml(title)}</h1>
                    <p class="about-doc__source">
                        <span>开源协议文本 <code>${escapeHtml(url)}</code></span>
                        <span>· 加载时间 ${fmtTime(new Date())}</span>
                        <button type="button" data-action="refresh" title="刷新内容">刷新内容</button>
                    </p>
                </header>
                <article class="about-doc__body markdown-body">${html}</article>
            `;

            const refreshBtn = root.querySelector('[data-action="refresh"]');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', () => {
                    delete cache[url];
                    renderMarkdown(targetId, { url, title, subtitle });
                });
            }
        } catch (err) {
            root.innerHTML = `
                <div class="about-doc__error">
                    <h2>加载失败</h2>
                    <p>${escapeHtml(err.message || String(err))}</p>
                    <p>可尝试刷新页面后重新打开。</p>
                </div>
            `;
        }
    }

    function renderChangelog() {
        const root = document.getElementById('about-changelog-content');
        if (!root) return;

        const entries = PUBLIC_CHANGELOG.map((entry) => `
            <article class="about-release">
                <div class="about-release__date">${escapeHtml(entry.date)}</div>
                <h2>${escapeHtml(entry.title)}</h2>
                <ul>
                    ${entry.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
                </ul>
            </article>
        `).join('');

        root.innerHTML = `
            <header class="about-doc__header">
                <span class="about-doc__eyebrow">CHANGELOG · 学习体验更新</span>
                <h1 class="about-doc__title">更新日志</h1>
                <p class="about-doc__intro">这里记录面向学习者的主要内容和体验变化。</p>
            </header>
            <div class="about-release-list">${entries}</div>
        `;
    }

    // ─── 暴露给 router.js 调用 ─────────────────────────────────────
    window.initLicense = function () {
        renderMarkdown('about-license-content', {
            url: 'LICENSE.md',
            title: '开源协议',
            subtitle: 'LICENSE · 使用许可',
        });
    };

    window.initChangelog = function () {
        renderChangelog();
    };

    function syncCurrentAboutRoute() {
        const page = (location.hash || '').replace(/^#/, '').split('/')[0];
        if (page === 'license') window.initLicense();
        if (page === 'changelog') window.initChangelog();
    }

    syncCurrentAboutRoute();
    window.addEventListener('hashchange', () => {
        setTimeout(syncCurrentAboutRoute, 0);
    });
})();
