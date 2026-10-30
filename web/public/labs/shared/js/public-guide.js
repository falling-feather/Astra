(function (global) {
    'use strict';

    if (global.AstraPublicGuide) return;

    const SPACE_META = Object.freeze([
        Object.freeze({
            key: 'englab',
            tone: 'blue',
            title: '工科试验室',
            description: '数理化生与算法可视化',
            icon: 'flask-conical'
        }),
        Object.freeze({
            key: 'code-space',
            tone: 'green',
            title: '代码空间',
            description: '程序执行追踪与数据结构动画',
            icon: 'code-2'
        }),
        Object.freeze({
            key: 'future-galaxy',
            tone: 'gold',
            title: '未来星系',
            description: '工程、数据、材料与跨学科探索',
            icon: 'orbit'
        })
    ]);

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function catalogueCounts() {
        const catalog = global.AstraLearningActivityCatalog;
        if (!catalog || typeof catalog.verify !== 'function') return Object.freeze({});
        try {
            const verification = catalog.verify();
            const counts = {};
            SPACE_META.forEach(function (space) {
                const item = verification && verification[space.key];
                counts[space.key] = item && item.valid && Number.isInteger(item.actual)
                    ? item.actual
                    : null;
            });
            return Object.freeze(counts);
        } catch (_) {
            return Object.freeze({});
        }
    }

    function countText(count) {
        return Number.isInteger(count) ? `${count} 项活动` : '目录校验中';
    }

    function spaceNode(space, count, compact) {
        return `
            <button class="public-space public-space--${space.tone}${compact ? ' public-space--compact' : ''}"
                    type="button" data-public-target="auth"
                    aria-label="登录后进入${escapeHtml(space.title)}">
                <span class="public-space__orb" aria-hidden="true"><i data-lucide="${space.icon}"></i></span>
                <span class="public-space__copy">
                    <strong>${escapeHtml(space.title)}</strong>
                    <small>${escapeHtml(countText(count))}</small>
                    ${compact ? `<em>${escapeHtml(space.description)}</em>` : ''}
                </span>
            </button>`;
    }

    function mechanicsVisual() {
        return `
            <svg class="public-course-visual public-course-visual--mechanics" viewBox="0 0 620 280" role="img" aria-label="两组恢复系数对应的反弹轨迹与高度对照图">
                <defs>
                    <linearGradient id="public-mechanics-line" x1="0" x2="1">
                        <stop offset="0" stop-color="#6edbff"/><stop offset="1" stop-color="#62e8bf"/>
                    </linearGradient>
                </defs>
                <path class="public-course-grid" d="M28 228H592M28 170H592M28 112H592M28 54H592"/>
                <path class="public-course-path" d="M42 62 Q96 62 124 228 Q153 103 188 228 Q220 145 254 228 Q282 177 315 228"/>
                <circle cx="42" cy="62" r="12"/><circle cx="124" cy="228" r="6"/><circle cx="188" cy="228" r="6"/><circle cx="254" cy="228" r="6"/><circle cx="315" cy="228" r="6"/>
                <g class="public-mechanics-chart">
                    <path d="M378 228V52M378 228H586"/>
                    <path class="public-chart-a" d="M392 82L444 119L497 151L550 176"/>
                    <path class="public-chart-b" d="M392 124L444 159L497 187L550 207"/>
                    <circle class="public-chart-a" cx="392" cy="82" r="5"/><circle class="public-chart-a" cx="444" cy="119" r="5"/><circle class="public-chart-a" cx="497" cy="151" r="5"/><circle class="public-chart-a" cx="550" cy="176" r="5"/>
                    <circle class="public-chart-b" cx="392" cy="124" r="5"/><circle class="public-chart-b" cx="444" cy="159" r="5"/><circle class="public-chart-b" cx="497" cy="187" r="5"/><circle class="public-chart-b" cx="550" cy="207" r="5"/>
                </g>
            </svg>`;
    }

    function trussVisual() {
        return `
            <svg class="public-course-visual public-course-visual--truss" viewBox="0 0 620 280" role="img" aria-label="桁架节点载荷和力传递路径示意图">
                <defs>
                    <marker id="public-arrow-gold" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7Z" fill="#f4c56c"/></marker>
                </defs>
                <g class="public-truss-base">
                    <path d="M58 226H562M58 226L155 142L252 226L310 84L368 226L465 142L562 226M155 142H465M252 226L155 142M368 226L465 142M155 142L310 84L465 142M252 226L310 84L368 226"/>
                    <circle cx="58" cy="226" r="8"/><circle cx="155" cy="142" r="8"/><circle cx="252" cy="226" r="8"/><circle cx="310" cy="84" r="9"/><circle cx="368" cy="226" r="8"/><circle cx="465" cy="142" r="8"/><circle cx="562" cy="226" r="8"/>
                </g>
                <g class="public-truss-load">
                    <path d="M310 22V68" marker-end="url(#public-arrow-gold)"/>
                    <path d="M310 84L252 226L58 226"/><path d="M310 84L368 226L562 226"/>
                </g>
                <text x="330" y="40">向下拖动载荷</text>
            </svg>`;
    }

    function workflowStage(index, title, owner, copy, tone) {
        return `
            <li class="public-workflow__stage public-workflow__stage--${tone}">
                <span class="public-workflow__number">${String(index).padStart(2, '0')}</span>
                <strong>${escapeHtml(title)}</strong>
                <small>${escapeHtml(owner)}</small>
                <p>${escapeHtml(copy)}</p>
            </li>`;
    }

    function render(options) {
        const activeView = String(options && options.activeView || 'login');
        const forms = String(options && options.forms || '');
        const status = String(options && options.status || '');
        const counts = catalogueCounts();
        const heroSpaces = SPACE_META.map(function (space) {
            return spaceNode(space, counts[space.key], false);
        }).join('');
        const directorySpaces = SPACE_META.map(function (space) {
            return spaceNode(space, counts[space.key], true);
        }).join('');

        return `
            <main class="public-guide" aria-labelledby="app-auth-title">
                <header class="public-guide__header">
                    <button class="public-guide__brand" type="button" data-public-target="top" aria-label="返回星序导览顶部">
                        <span class="public-guide__brand-mark" aria-hidden="true"></span>
                        <strong>星序 <span>ASTRA</span></strong>
                    </button>
                    <nav class="public-guide__nav" aria-label="导览导航">
                        <button type="button" data-public-target="workflow">平台能力</button>
                        <button type="button" data-public-target="spaces">学习空间</button>
                        <button type="button" data-public-target="workflow">教学闭环</button>
                    </nav>
                    <button class="public-guide__login-link" type="button" data-public-target="auth">
                        <i data-lucide="user-round" aria-hidden="true"></i><span>登录 / 注册</span>
                    </button>
                </header>

                <section class="public-hero" data-public-section="top">
                    <div class="public-hero__copy">
                        <h1 id="app-auth-title">把抽象知识，<br>变成可以观察、操作<br>与回读的课堂旅程。</h1>
                        <p>面向学生、教师与学校管理者的多星系互动教学平台。</p>
                        <div class="public-hero__actions">
                            <button class="public-action public-action--primary" type="button" data-public-target="spaces">探索三大学习空间<i data-lucide="arrow-right" aria-hidden="true"></i></button>
                            <button class="public-action public-action--secondary" type="button" data-public-target="auth">进入星序<i data-lucide="arrow-right" aria-hidden="true"></i></button>
                        </div>
                    </div>
                    <div class="public-orbit" aria-label="三大学习空间目录">
                        <div class="public-orbit__star" aria-hidden="true"></div>
                        <div class="public-orbit__ring public-orbit__ring--one" aria-hidden="true"></div>
                        <div class="public-orbit__ring public-orbit__ring--two" aria-hidden="true"></div>
                        <div class="public-orbit__ring public-orbit__ring--three" aria-hidden="true"></div>
                        ${heroSpaces}
                    </div>
                    <button class="public-hero__continuation" type="button" data-public-target="workflow">
                        <span>从一次预测，到一条可回读的学习证据</span>
                        <i data-lucide="arrow-down" aria-hidden="true"></i>
                    </button>
                </section>

                <section class="public-workflow" data-public-section="workflow" aria-labelledby="public-workflow-title">
                    <div class="public-section-heading">
                        <h2 id="public-workflow-title">学生做什么，教师看什么，系统记录什么</h2>
                        <p>一次课堂互动，沿同一条业务链留下可解释、可回读的结果。</p>
                    </div>
                    <ol class="public-workflow__rail">
                        ${workflowStage(1, '预测', '学生', '基于当前理解作出预测，不提前写成结论。', 'blue')}
                        ${workflowStage(2, '操作', '学生', '在页面中调整变量、运行实验并观察变化。', 'blue')}
                        ${workflowStage(3, '检查', '学生', '提交版本化检查点，获得即时反馈。', 'green')}
                        ${workflowStage(4, '权威证据', '系统', '记录内容版本、尝试与服务端确认结果。', 'gold')}
                        ${workflowStage(5, '教师回读', '教师', '结合证据和过程给出教学判断。', 'blue')}
                    </ol>
                    <p class="public-workflow__truth"><i data-lucide="info" aria-hidden="true"></i>浏览器中的互动 ≠ 掌握；教师的回读与判断始终是教学的关键环节。</p>
                </section>

                <section class="public-spaces" data-public-section="spaces" aria-labelledby="public-spaces-title">
                    <div class="public-section-heading">
                        <h2 id="public-spaces-title">三大学习空间，一条统一的教学主线</h2>
                        <p>课程分布在不同主题空间，身份、班级与学习证据仍由星序统一协调。</p>
                    </div>
                    <div class="public-spaces__rail" aria-label="真实学习空间目录">
                        <span class="public-spaces__line" aria-hidden="true"></span>
                        ${directorySpaces}
                    </div>
                </section>

                <section class="public-courses" aria-labelledby="public-courses-title">
                    <div class="public-section-heading">
                        <h2 id="public-courses-title">两种代表性互动，快速看懂教学过程</h2>
                    </div>
                    <div class="public-courses__layout">
                        <article class="public-course public-course--mechanics">
                            <div class="public-course__copy">
                                <h3>碰撞与反弹：<br>用对照实验读懂恢复系数</h3>
                                <button type="button" data-public-target="auth">查看课程<i data-lucide="arrow-right" aria-hidden="true"></i></button>
                            </div>
                            ${mechanicsVisual()}
                        </article>
                        <article class="public-course public-course--truss">
                            <div class="public-course__copy">
                                <h3>桁架载荷路径：<br>让力的传递过程看得见</h3>
                                <button type="button" data-public-target="auth">查看课程<i data-lucide="arrow-right" aria-hidden="true"></i></button>
                            </div>
                            ${trussVisual()}
                        </article>
                    </div>
                </section>

                <section class="public-auth" data-public-section="auth" aria-labelledby="public-auth-title">
                    <div class="public-auth__context">
                        <h2 id="public-auth-title">从真实身份进入你的星序</h2>
                        <p>登录后，系统根据学生、教师或管理员身份开放对应的学习与工作空间。</p>
                        <div class="public-auth__orbit" aria-hidden="true">
                            <span></span><span></span><span></span><i></i>
                        </div>
                    </div>
                    <section class="app-auth-panel" aria-label="星序账号入口">
                        <div class="app-auth-tabs" role="tablist" aria-label="账号操作">
                            <button type="button" data-app-auth-view="login" class="${activeView === 'login' ? 'active' : ''}">登录</button>
                            <button type="button" data-app-auth-view="register" class="${activeView === 'register' ? 'active' : ''}">注册</button>
                            <button type="button" data-app-auth-view="reset" class="${activeView === 'reset' ? 'active' : ''}">重置密码</button>
                        </div>
                        ${status}
                        ${forms}
                        <p class="app-auth-panel__note"><i data-lucide="lock-keyhole" aria-hidden="true"></i>凭据由 HttpOnly Cookie 与服务端 Session 协调保存。</p>
                    </section>
                </section>

                <footer class="public-guide__footer">
                    <span>星序 ASTRA · 本地教学展示环境</span>
                    <button type="button" data-public-target="top">返回顶部<i data-lucide="arrow-up" aria-hidden="true"></i></button>
                </footer>
            </main>`;
    }

    function enhance(root) {
        if (!root || !global.lucide || typeof global.lucide.createIcons !== 'function') return;
        try {
            global.lucide.createIcons({ nodes: [root] });
        } catch (_) {
            try { global.lucide.createIcons(); } catch (_) {}
        }
    }

    function scrollTo(root, targetName, behavior) {
        if (!root) return false;
        const target = root.querySelector(`[data-public-section="${String(targetName || '')}"]`);
        if (!target || typeof target.scrollIntoView !== 'function') return false;
        target.scrollIntoView({
            behavior: behavior === 'smooth' ? 'smooth' : 'auto',
            block: 'start'
        });
        return true;
    }

    global.AstraPublicGuide = Object.freeze({
        spaces: SPACE_META,
        render,
        enhance,
        scrollTo,
        catalogueCounts
    });
})(window);
