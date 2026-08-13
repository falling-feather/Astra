// GAME-001 replaces the legacy long-form frontier sections at runtime.  The manifest
// remains the only source of course/activity keys and availability fallback state.
(function installFutureGalaxyCourseRuntime(global) {
    'use strict';

    // Router support can request the same asset after the direct boot script. Keep
    // one listener/runtime generation instead of registering a second course shell.
    if (global.__futureGalaxyCourseRuntimeInstalled) return;
    global.__futureGalaxyCourseRuntimeInstalled = true;

    const FrontierLearning = global.FrontierLearning || {};
    global.FrontierLearning = FrontierLearning;

    let activeRuntime = null;
    let hashListenerInstalled = false;
    let generation = 0;
    let manifestPromise = null;
    let stylePromise = null;
    const FUTURE_REPRESENTATIVE = 'engineering.load-path';

    const MANAGED_PAGES = new Set(['frontier', 'cosmos', 'engineering', 'datascience', 'infotech', 'materials', 'humanities']);
    const $ = (root, selector) => root.querySelector(selector);
    const esc = (value) => String(value || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
    const getManifest = () => global.FrontierCourseManifest || null;
    const pageFromHash = () => (global.location.hash || '#frontier').replace(/^#/, '').split('/')[0] || 'frontier';
    const activityFromHash = () => (global.location.hash || '').replace(/^#/, '').split('/')[1] || '';
    const isReducedMotion = () => !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const courseAccess = (availability, course) => {
        if (availability.availability === 'default-open') return { state: 'open' };
        return availability.course_access[course.course_key] || { state: 'unavailable' };
    };
    const activityAccess = (availability, activity) => {
        const session = global.AstraApplicationSession;
        const user = session && typeof session.getUser === 'function' ? session.getUser() : null;
        const catalogue = global.AstraStudentCourseCatalogue;
        if (user && user.role === 'student' && catalogue && typeof catalogue.allowsActivity === 'function') {
            const page = String(activity && activity.activity_key || '').split('.')[0];
            const moduleId = String(activity && activity.route_slug || '').trim();
            if (!catalogue.allowsActivity(page, moduleId)) return { state: 'hidden' };
        }
        if (availability.availability === 'default-open') return { state: 'open' };
        return availability.activity_access[activity.activity_key] || { state: 'unavailable' };
    };

    function addCleanup(runtime, cleanup) {
        runtime.cleanups.push(cleanup);
        return cleanup;
    }

    function ensureManifest() {
        if (getManifest()) return Promise.resolve(getManifest());
        if (manifestPromise) return manifestPromise;
        manifestPromise = new Promise((resolve, reject) => {
            const source = 'pages/frontier/frontier-manifest.js?v=20260809v804FutureEvidenceP0';
            const existing = Array.from(document.scripts).find((script) => (script.getAttribute('src') || '').split('?')[0] === source.split('?')[0]);
            if (existing) {
                existing.addEventListener('load', () => getManifest() ? resolve(getManifest()) : reject(new Error('Future manifest unavailable')), { once: true });
                existing.addEventListener('error', () => reject(new Error('Future manifest failed to load')), { once: true });
                return;
            }
            const script = document.createElement('script');
            script.src = source;
            script.async = true;
            script.dataset.frontierManifest = 'true';
            script.addEventListener('load', () => getManifest() ? resolve(getManifest()) : reject(new Error('Future manifest unavailable')), { once: true });
            script.addEventListener('error', () => reject(new Error('Future manifest failed to load')), { once: true });
            document.head.appendChild(script);
        }).catch((error) => { manifestPromise = null; throw error; });
        return manifestPromise;
    }

    function ensureCourseStyle() {
        const existing = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).find((link) => {
            try { return new URL(link.href, document.baseURI).pathname.endsWith('/pages/frontier/frontier.css'); } catch (error) { return false; }
        });
        if (existing) {
            existing.dataset.frontierCourseStyle = 'true';
            return Promise.resolve();
        }
        if (stylePromise) return stylePromise;
        stylePromise = new Promise((resolve, reject) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'pages/frontier/frontier.css?v=20260813v833LoadPathSameFrameP0';
            link.dataset.frontierCourseStyle = 'true';
            link.addEventListener('load', resolve, { once: true });
            link.addEventListener('error', () => reject(new Error('Future course style failed to load')), { once: true });
            document.head.appendChild(link);
        }).catch((error) => { stylePromise = null; throw error; });
        return stylePromise;
    }

    function cleanupRuntime(runtime) {
        if (!runtime || runtime.destroyed) return;
        runtime.destroyed = true;
        runtime.abort.abort();
        if (runtime.visual && typeof runtime.visual.dispose === 'function') runtime.visual.dispose();
        runtime.visual = null;
        runtime.cleanups.splice(0).reverse().forEach((cleanup) => {
            try { cleanup(); } catch (error) { /* cleanup must not block a route leave */ }
        });
    }

    function clearActive(page) {
        if (!activeRuntime) return;
        if (page && activeRuntime.page !== page) return;
        cleanupRuntime(activeRuntime);
        activeRuntime = null;
    }

    function resolveRoute(requestedPage) {
        const manifest = getManifest();
        if (!manifest) return null;
        const page = requestedPage || pageFromHash();
        if (page === 'frontier') return { page, course: null, activity: null, availability: manifest.resolveAvailability() };
        const course = manifest.getCourseByPage(page);
        if (!course) return null;
        const availability = manifest.resolveAvailability();
        const requestedActivity = activityFromHash();
        const defaultActivity = course.activities.find((item) => activityAccess(availability, item).state === 'open') || course.activities.find((item) => activityAccess(availability, item).state !== 'hidden') || course.activities[0];
        const requestedMatch = course.activities.find((item) => item.route_slug === requestedActivity);
        const activity = requestedMatch && activityAccess(availability, requestedMatch).state !== 'hidden'
            ? requestedMatch
            : defaultActivity;
        if (requestedActivity && requestedMatch && requestedMatch !== activity && activity) {
            try {
                global.history.replaceState(null, '', `#${page}/${activity.route_slug}`);
            } catch (error) {}
        }
        return { page, course, activity, availability, courseAccess: courseAccess(availability, course), access: activityAccess(availability, activity) };
    }

    function renderCatalogue(runtime, manifest) {
        const availability = manifest.resolveAvailability();
        const positions = [
            ['16%', '24%'], ['49%', '10%'], ['82%', '24%'],
            ['18%', '70%'], ['50%', '82%'], ['82%', '68%']
        ];
        const visibleCourses = manifest.courses.map((course) => {
            const firstOpen = course.activities.find((activity) => activityAccess(availability, activity).state === 'open');
            return firstOpen ? { course, firstOpen } : null;
        }).filter(Boolean);
        const routes = visibleCourses.map(({ course, firstOpen }, index) => {
            const [x, y] = positions[index] || ['50%', '50%'];
            return `
                <a class="fg-star-route" style="--star-x:${x};--star-y:${y};--star-order:${index}" href="#${esc(course.page)}/${esc(firstOpen.route_slug)}" data-page="${esc(course.page)}" data-galaxy-key="${esc(course.galaxy_key)}" data-course-key="${esc(course.course_key)}">
                    <span class="fg-star-route__signal" aria-hidden="true"><i></i></span>
                    <span class="fg-star-route__copy">
                        <small>0${index + 1} / ${esc(course.eyebrow)}</small>
                        <strong>${esc(course.title)}</strong>
                        <em>${esc(course.question)}</em>
                    </span>
                </a>`;
        }).join('');
        const stateNotice = availability.availability === 'unavailable'
            ? '<aside class="fg-atlas-state" aria-live="polite"><strong>课程星图暂不可用</strong><span>权威发布状态恢复后才会生成课程入口。</span></aside>'
            : '';
        runtime.mount.innerHTML = `
            <main class="fg-shell fg-overview" data-galaxy-key="${esc(manifest.galaxy_key)}">
                <figure class="fg-atlas-sky" aria-hidden="true">
                    <img src="UI/future-galaxy/orbit-observatory.webp" width="1600" height="900" alt="" fetchpriority="high" decoding="async">
                    <span></span>
                </figure>
                <header class="fg-atlas-copy">
                    <div class="fg-eyebrow">FUTURE GALAXY / LIVE COURSE ATLAS</div>
                    <h1 id="future-galaxy-title">把未来拆成<br>可操纵的问题</h1>
                    <p>选择一颗航标星，从预测开始；操纵变量、观察证据，再写下能被检验的判断。</p>
                </header>
                <section class="fg-orbit-map" aria-labelledby="future-catalogue-title">
                    <div class="fg-orbit-map__core" aria-hidden="true">
                        <span></span><i></i>
                    </div>
                    <h2 id="future-catalogue-title" class="sr-only">未来星系课程目录</h2>
                    ${routes}
                </section>
                ${stateNotice}
                <div class="fg-atlas-legend" aria-hidden="true"><span>COURSE SIGNALS / ${String(visibleCourses.length).padStart(2, '0')}</span><span>OBSERVATION IS A METHOD</span></div>
            </main>`;
    }

    function activityAnswers(activity) {
        const answers = {
            'cosmos.day-season': [['地轴倾角改变了不同半球的受光条件', true], ['夏季只因离太阳更近', false]],
            'cosmos.orbital-scale': [['改变位置不会取消地轴倾角造成的受光差异', true], ['轨道位置单独决定昼夜长短', false]],
            'cosmos.evidence-log': [['同地阴影方向随太阳方位改变', true], ['阴影方向与观测时刻无关', false]],
            'engineering.load-path': [['连续的杆件路径把载荷传向支座', true], ['载荷只作用在被点击的一个节点', false]],
            'engineering.member-choice': [['斜杆改变会让力在其他构件中重新分配', true], ['删去斜杆不会改变受力路径', false]],
            'engineering.safety-check': [['较大载荷需要比较关键杆件与约束', true], ['安全校核只看一根杆件的颜色', false]],
            'datascience.model-fit': [['要比较残差和趋势是否合理', true], ['只要直线经过最多点就足够', false]],
            'datascience.outlier-test': [['离群点可能明显拉动拟合结果', true], ['离群点不会影响任何模型参数', false]],
            'datascience.evidence-claim': [['结论应说明样本范围与不确定性', true], ['图上有趋势就能断言因果', false]],
            'infotech.packet-route': [['更多跳数会增加需要观察的路径环节', true], ['每一跳都忽略上层请求状态', false]],
            'infotech.layer-contract': [['分层让每层处理相对明确的职责', true], ['分层表示所有信息都在同一层完成', false]],
            'infotech.fault-trace': [['先沿可见路径定位异常节点更可检验', true], ['故障发生时无需查看路径', false]],
            'materials.grain-boundary': [['更细晶粒通常带来更多晶界线索', true], ['晶粒大小与边界数量无关', false]],
            'materials.defect-path': [['缺陷位置会影响需要追踪的传播路径', true], ['缺陷只是一种与材料无关的装饰', false]],
            'materials.process-window': [['工艺变化应结合组织尺度一起判断', true], ['冷却速率不会改变任何组织特征', false]],
            'humanities.context-map': [['关系图提示回读语境，而非替代解释', true], ['连接最多的词自动等于唯一事实', false]],
            'humanities.voice-shift': [['切换材料会改变被强调的关系', true], ['叙事视角不影响任何线索', false]],
            'humanities.claim-review': [['较高证据阈值会移除较弱的关联', true], ['所有连接都拥有相同证据强度', false]]
        };
        return (answers[activity.activity_key] || [['先回看观察证据', true], ['跳过观察直接下结论', false]])
            .map(([text, correct]) => ({ text, correct }));
    }

    function controlledLoadPathMarkup() {
        return `<section class="fg-load-path" data-load-path-flow>
            <div class="fg-load-path__step">
                <h2>1 · 先预测</h2>
                <p>固定 60 kN 竖向节点荷载、完整 15 杆理想二维铰接桁架。预测从 B 移到 C 后的平衡与杆力变化。</p>
                <label>支座反力分配
                    <select data-load-path-prediction="reaction_balance_id">
                        <option value="">请选择</option><option value="more-balanced">更均衡</option><option value="more-unbalanced">更不均衡</option><option value="no-change">不变</option><option value="insufficient">证据不足</option>
                    </select>
                </label>
                <label>GH 轴力绝对值
                    <select data-load-path-prediction="gh_change_id">
                        <option value="">请选择</option><option value="absolute-increase">增大</option><option value="absolute-decrease">减小</option><option value="no-change">不变</option><option value="insufficient">证据不足</option>
                    </select>
                </label>
                <label>CD 轴力绝对值
                    <select data-load-path-prediction="cd_change_id">
                        <option value="">请选择</option><option value="absolute-increase">增大</option><option value="absolute-decrease">减小</option><option value="no-change">不变</option><option value="insufficient">证据不足</option>
                    </select>
                </label>
                <label>本地预测理由（4—160 字，仅发送字数）<textarea data-load-path-reason minlength="4" maxlength="160"></textarea></label>
                <button type="button" data-load-path-action="predict">记录预测</button>
            </div>
            <div class="fg-load-path__step">
                <h2>2 · B → C → D 受控观察</h2>
                <p>先运行 B 基线，只把荷载节点改为 C；完成观察后判断，才开放 D 镜像复核。颜色仅辅助辨识，以下数值表是判断依据。</p>
                <div class="fg-load-path__nodes" aria-label="固定工况节点">
                    <button type="button" data-load-path-action="observe" data-load-path-node="B">运行 B 基线</button>
                    <button type="button" data-load-path-action="observe" data-load-path-node="C">只改为 C</button>
                    <button type="button" data-load-path-action="observe" data-load-path-node="D">运行 D 镜像</button>
                </div>
                <div class="fg-load-path__table-wrap" tabindex="0" role="region" aria-label="B C D 观测数值表">
                    <table><thead><tr><th>节点</th><th>Aᵧ kN</th><th>Eᵧ kN</th><th>GH kN / 类型</th><th>CD kN / 类型</th><th>平衡余量 Fx/Fy kN</th></tr></thead>
                    <tbody>${['B', 'C', 'D'].map(node => `<tr data-load-path-row="${node}"><th>${node}</th><td colspan="5">尚未运行</td></tr>`).join('')}</tbody></table>
                </div>
            </div>
            <div class="fg-load-path__step">
                <h2>3 · 观察后判断与镜像纠正</h2>
                <label>当前判断
                    <select data-load-path-judgement>
                        <option value="">请选择</option><option value="equilibrium-redistribution">平衡导致内力重新分配</option><option value="single-load-path">只有单一传力路径</option><option value="color-means-compression">颜色本身即可证明受压</option><option value="no-redistribution">节点变化不引起重新分配</option><option value="insufficient">证据仍不足</option>
                    </select>
                </label>
                <button type="button" data-load-path-action="assess">保存本页判断并开放 D</button>
                <label class="fg-check"><input type="checkbox" data-load-path-model-limit>我理解这是理想二维铰接桁架的合成工况，不是现实结构安全结论。</label>
                <button type="button" data-load-path-action="correct">用 D 镜像完成纠正</button>
                <button type="button" data-load-path-action="explain">提交结构化解释</button>
                <button type="button" data-load-path-action="redo">显式重做</button>
                <p class="fg-load-path__status" data-load-path-status role="status" aria-live="polite">正在确认课程范围与学习证据。</p>
            </div>
        </section>`;
    }

    async function mountRepresentativeEvidence(runtime, route) {
        if (!runtime || !route || route.activity.activity_key !== FUTURE_REPRESENTATIVE) return null;
        const host = $(runtime.mount, '[data-fg-evidence-host]');
        const loader = global.AstraLearningEvidenceLoader;
        const provider = global.FutureGalaxyPublicationContext;
        if (!host || !loader || typeof loader.ensure !== 'function' || !provider
            || typeof provider.resolveLearningEvidence !== 'function'
            || typeof provider.sameLearningEvidenceAuthority !== 'function') {
            throw new Error('Future learning evidence authority unavailable');
        }
        const evidenceClient = await loader.ensure({ activity: true });
        if (runtime.abort.signal.aborted || activeRuntime !== runtime || !host.isConnected) {
            throw new Error('Future learning evidence mount superseded');
        }
        const activity = global.AstraLearningEvidenceActivity;
        if (!activity || typeof activity.mount !== 'function') throw new Error('Future learning evidence activity unavailable');
        const mapping = Object.freeze({
            galaxy_key: 'future-galaxy',
            course_key: route.course.course_key,
            activity_key: route.activity.activity_key
        });
        if (!evidenceClient || typeof evidenceClient.pendingFor !== 'function') {
            throw new Error('Future pending evidence recovery unavailable');
        }
        const initialContext = await provider.resolveLearningEvidence(mapping);
        if (!initialContext || initialContext.available !== true) {
            throw new Error('Future learning evidence context unavailable');
        }
        const pending = await evidenceClient.pendingFor(initialContext);
        if (runtime.abort.signal.aborted || activeRuntime !== runtime || !host.isConnected) {
            throw new Error('Future learning evidence recovery superseded');
        }
        const authorizeCurrentRecord = async context => {
            await evidenceClient.pendingFor(context);
            const current = await provider.resolveLearningEvidence(mapping);
            return provider.sameLearningEvidenceAuthority(context, current) ? current : null;
        };
        const controller = activity.mount({
            host,
            galaxy_key: mapping.galaxy_key,
            activity_key: mapping.activity_key,
            integrated: true,
            domainOnly: true,
            reusePendingStarted: true,
            title: '工程观察证据状态',
            resolveContext: async () => {
                const current = await provider.resolveLearningEvidence(mapping);
                if (!provider.sameLearningEvidenceAuthority(initialContext, current)) {
                    throw new Error('Future learning evidence authority changed');
                }
                return current;
            },
            authorizeRecord: ({ context }) => authorizeCurrentRecord(context)
        });
        if (!controller) throw new Error('Future representative evidence controller unavailable');
        let released = false;
        addCleanup(runtime, () => {
            if (released) return;
            released = true;
            controller.destroy();
        });
        await controller.refresh();
        if (runtime.abort.signal.aborted || activeRuntime !== runtime || !host.isConnected) {
            throw new Error('Future learning evidence initialization superseded');
        }
        const context = controller.context();
        if (!context || !provider.sameLearningEvidenceAuthority(initialContext, context)) {
            throw new Error('Future learning evidence context changed');
        }
        if (runtime.abort.signal.aborted || activeRuntime !== runtime || !host.isConnected) {
            throw new Error('Future learning evidence recovery superseded');
        }
        return Object.freeze({ controller, pending, authorizeRecord: authorizeCurrentRecord });
    }

    const OWNER_CONFIG = Object.freeze({
        'earth-space': { script: 'pages/cosmos/earth-sun.js?v=20260719re7', init: 'initCosmosSeasons', destroy: 'destroyCosmosSeasons' },
        'engineering-systems': { script: 'pages/engineering/bridge-truss.js?v=20260812v829FlagshipStoryP0', init: 'initBridgeTruss', destroy: 'destroyBridgeTruss' },
        'data-ai': { script: 'pages/datascience/linear-regression.js?v=20260719v755Game001', init: 'initLinearRegressionLab', destroy: 'destroyLinearRegressionLab' },
        'information-technology': { script: 'pages/infotech/network-layers.js?v=20260719re7', init: 'initNetworkLayersLab', destroy: 'destroyNetworkLayersLab' },
        'materials-science': { script: 'pages/materials/materials-lab.js?v=20260719re7', init: 'initMaterialsLab', destroy: 'destroyMaterialsLab' },
        'humanities-futures': { script: 'pages/humanities/text-lab.js?v=20260719re7', init: 'initHumanitiesLab', destroy: 'destroyHumanitiesLab' }
    });

    function ownerMarkup(courseKey, activityKey) {
        const views = {
            'earth-space': `<div class="fg-owner-controls"><label>年内日期 <output id="cosmos-day-value">6月 21日</output><input id="cosmos-day" type="range" min="1" max="365" value="172"></label><label>观察纬度 <output id="cosmos-latitude-value">39.9°N</output><input id="cosmos-latitude" type="range" min="-66.5" max="66.5" step="0.5" value="39.9"></label><label>观察时刻 <output id="cosmos-hour-value">12:00</output><input id="cosmos-hour" type="range" min="6" max="18" step="0.5" value="12"></label><div><button type="button" data-cosmos-lat="0">赤道</button><button type="button" data-cosmos-lat="39.9">中纬度</button><button type="button" data-cosmos-lat="-23.5">南回归线</button></div></div><canvas id="earth-sun-canvas" aria-label="太阳高度、地轴倾角与昼长图"></canvas><div id="cosmos-info" class="fg-owner-info" aria-live="polite"></div>`,
            'engineering-systems': activityKey === FUTURE_REPRESENTATIVE
                ? `<div class="fg-owner-controls fg-owner-controls--controlled"><p><strong>固定受控工况</strong>：60 kN、完整 15 杆、理想二维铰接桁架；按右侧步骤运行 B/C/D。</p></div><canvas id="bridge-truss-canvas" aria-label="理想 Warren 桁架 B C D 固定工况受力图"></canvas><div id="truss-info" class="fg-owner-info" aria-live="polite"></div>`
                : `<div class="fg-owner-controls"><label>竖向载荷 <output id="truss-load-value">60 kN</output><input id="truss-load" type="range" min="20" max="120" step="5" value="60"></label><label>安全系数 <output id="truss-safety-value">1.8</output><input id="truss-safety" type="range" min="1.1" max="3" step="0.1" value="1.8"></label><div><button type="button" data-truss-joint="B">左跨 B</button><button type="button" data-truss-joint="C">中跨 C</button><button type="button" data-truss-joint="D">右跨 D</button></div><div><button type="button" data-truss-member="full">15 根完整桁架</button><button type="button" data-truss-member="remove-fb">14 根：移除 FB 斜杆</button></div></div><canvas id="bridge-truss-canvas" aria-label="Warren 桁架桥受力图"></canvas><div id="truss-info" class="fg-owner-info" aria-live="polite"></div>`,
            'data-ai': `<div class="fg-owner-controls"><div><button type="button" data-regression-dataset="study">学习时长</button><button type="button" data-regression-dataset="climate">温度销量</button><button type="button" data-regression-dataset="outlier">异常点</button></div><label>斜率 w <output id="regression-slope-value">6.00</output><input id="regression-slope" type="range" min="-8" max="16" step="0.05" value="6"></label><label>截距 b <output id="regression-intercept-value">38.0</output><input id="regression-intercept" type="range" min="-20" max="120" step="0.5" value="38"></label><label>学习率 <output id="regression-rate-value">0.15</output><input id="regression-rate" type="range" min="0.02" max="0.6" step="0.01" value="0.15"></label><div><button type="button" id="regression-step">梯度下降一步</button><button type="button" id="regression-fit">最小二乘线</button><button type="button" id="regression-reset">重置</button></div></div><canvas id="linear-regression-canvas" aria-label="线性回归散点、残差与损失图"></canvas><div id="regression-info" class="fg-owner-info" aria-live="polite"></div>`,
            'information-technology': `<div class="fg-owner-controls"><div><button type="button" data-network-scenario="web">网页请求</button><button type="button" data-network-scenario="media">视频片段</button><button type="button" data-network-scenario="form">表单提交</button><button type="button" data-network-scenario="sync">同步消息</button></div><label>应用数据 <output id="network-payload-value">1800 B</output><input id="network-payload" type="range" min="300" max="6000" step="100" value="1800"></label><label>路径跳数 <output id="network-hops-value">4</output><input id="network-hops" type="range" min="2" max="8" value="4"></label><div><button type="button" data-network-fault="none">无故障</button><button type="button" data-network-fault="access">接入节点失效</button><button type="button" data-network-fault="transit">中继节点失效</button><button type="button" data-network-fault="edge">边缘节点失效</button></div></div><canvas id="network-layers-canvas" aria-label="网络封装与分组路由图"></canvas><div id="network-info" class="fg-owner-info" aria-live="polite"></div>`,
            'materials-science': `<div class="fg-owner-controls"><div><button type="button" data-material-cell="sc">SC</button><button type="button" data-material-cell="bcc">BCC</button><button type="button" data-material-cell="fcc">FCC</button><button type="button" data-material-cell="hcp">HCP</button></div><label>平均晶粒 <output id="materials-grain-size-value">45 μm</output><input id="materials-grain-size" type="range" min="5" max="120" value="45"></label><label>缺陷密度 <output id="materials-defect-value">2 / 10</output><input id="materials-defect" type="range" min="0" max="10" step="1" value="2"></label><label>冷却速率 <output id="materials-cooling-value">50</output><input id="materials-cooling" type="range" min="10" max="100" step="5" value="50"></label><div><button type="button" data-material-preset="refined">快速凝固</button><button type="button" data-material-preset="recrystallized">再结晶</button><button type="button" data-material-preset="annealed">退火</button></div></div><canvas id="materials-canvas" aria-label="晶胞、晶粒与相对强度图"></canvas><div id="materials-info" class="fg-owner-info" aria-live="polite"></div>`,
            'humanities-futures': `<div class="fg-owner-controls"><div><button type="button" data-humanities-sample="learning">学习札记</button><button type="button" data-humanities-sample="city">城市水利</button><button type="button" data-humanities-sample="primary">史料方法</button></div><div><button type="button" data-humanities-mode="terms">词项分布</button><button type="button" data-humanities-mode="contexts">上下文</button><button type="button" data-humanities-mode="network">共现网络</button></div><label>共现证据阈值 <output id="humanities-threshold-value">1 次</output><input id="humanities-threshold" type="range" min="1" max="3" step="1" value="1"></label><div id="humanities-focus-list" aria-label="关注词项"></div></div><canvas id="humanities-canvas" aria-label="词项、语境与共现关系图"></canvas><div id="humanities-info" class="fg-owner-info" aria-live="polite"></div>`
        };
        return views[courseKey] || '';
    }

    function ensureOwner(config) {
        if (typeof global[config.init] === 'function') return Promise.resolve();
        return new Promise((resolve, reject) => {
            const plain = config.script.split('?')[0];
            const existing = Array.from(document.scripts).find((script) => (script.getAttribute('src') || '').split('?')[0] === plain);
            if (existing) {
                existing.addEventListener('load', () => typeof global[config.init] === 'function' ? resolve() : reject(new Error('Course owner unavailable')), { once: true });
                existing.addEventListener('error', () => reject(new Error('Course owner failed to load')), { once: true });
                return;
            }
            const script = document.createElement('script');
            script.src = config.script;
            script.async = true;
            script.dataset.frontierOwner = config.init;
            script.addEventListener('load', () => typeof global[config.init] === 'function' ? resolve() : reject(new Error('Course owner unavailable')), { once: true });
            script.addEventListener('error', () => reject(new Error('Course owner failed to load')), { once: true });
            document.body.appendChild(script);
        });
    }

    function makeControlledLoadPathReadonly(root, message) {
        if (!root) return;
        root.querySelectorAll([
            '[data-load-path-action]',
            '[data-load-path-prediction]',
            '[data-load-path-reason]',
            '[data-load-path-judgement]',
            '[data-load-path-model-limit]'
        ].join(', ')).forEach((control) => {
            control.disabled = true;
            control.setAttribute('aria-disabled', 'true');
        });
        const flow = $(root, '[data-load-path-flow]');
        if (flow) {
            flow.dataset.loadPathReadonly = 'true';
            flow.setAttribute('aria-disabled', 'true');
        }
        const status = $(root, '[data-load-path-status]');
        if (status) status.textContent = message;
    }

    function mountOwnerVisual(runtime, route, stage) {
        const config = OWNER_CONFIG[route.course.course_key];
        if (!config) return mountCanvasVisual(runtime, route, stage, 50, true, '简化观测模式');
        const controlledLoadPath = route.activity.activity_key === FUTURE_REPRESENTATIVE;
        stage.innerHTML = `<span class="fg-stage-label">OBSERVATION FIELD / 观测场</span>${ownerMarkup(route.course.course_key, route.activity.activity_key)}<span class="fg-stage-status" data-fg-stage-status>正在准备互动</span>`;
        const evidence = controlledLoadPath
            ? runtime.evidenceBindingPromise
            : Promise.resolve(null);
        return Promise.all([ensureOwner(config), evidence]).then(([, binding]) => {
            if (runtime.abort.signal.aborted || activeRuntime !== runtime || !stage.isConnected) return;
            global[config.init](controlledLoadPath ? {
                controlledActivity: true,
                evidenceController: binding && binding.controller,
                pendingRecords: binding && binding.pending || [],
                authorizeRecord: binding && binding.authorizeRecord,
                isRuntimeCurrent: () => !runtime.abort.signal.aborted && activeRuntime === runtime && stage.isConnected
            } : undefined);
            if (route.activity.activity_key !== FUTURE_REPRESENTATIVE) applyOwnerPreset(route, stage);
            runtime.visual = { dispose() { try { global[config.destroy](); } catch (error) {} } };
            const status = $(stage, '[data-fg-stage-status]'); if (status) status.textContent = '互动已就绪';
        }).catch((error) => {
            if (runtime.abort.signal.aborted || activeRuntime !== runtime || !stage.isConnected) return;
            if (controlledLoadPath) {
                const manual = error && error.code === 'pending_recovery_manual_intervention';
                makeControlledLoadPathReadonly(
                    runtime.mount,
                    manual
                        ? '证据冲突需处理，本活动只读。'
                        : '课程范围或证据服务暂不可用；本活动保持只读，请稍后重试。'
                );
                const status = $(stage, '[data-fg-stage-status]');
                if (status) status.textContent = '只读观测模式';
                return;
            }
            mountCanvasVisual(runtime, route, stage, 50, true, '只读观测模式');
        });
    }

    function applyOwnerPreset(route, stage) {
        const presets = {
            'cosmos.day-season': { values: { '#cosmos-day': 172, '#cosmos-latitude': 39.9 } },
            'cosmos.evidence-log': { values: { '#cosmos-day': 80, '#cosmos-latitude': 0, '#cosmos-hour': 9 } },
            'engineering.load-path': { values: { '#truss-load': 60 }, click: '[data-truss-joint="C"]' },
            'engineering.member-choice': { values: { '#truss-load': 80 }, click: '[data-truss-member="remove-fb"]' },
            'engineering.safety-check': { values: { '#truss-load': 110, '#truss-safety': 2.4 }, click: '[data-truss-joint="D"]' },
            'datascience.model-fit': { values: { '#regression-slope': 6, '#regression-intercept': 38, '#regression-rate': .15 }, click: '[data-regression-dataset="study"]' },
            'datascience.outlier-test': { values: { '#regression-slope': 4, '#regression-intercept': 42, '#regression-rate': .1 }, click: '[data-regression-dataset="outlier"]' },
            'datascience.evidence-claim': { values: { '#regression-slope': 2, '#regression-intercept': 28, '#regression-rate': .25 }, click: '[data-regression-dataset="climate"]' },
            'infotech.packet-route': { values: { '#network-payload': 1800, '#network-hops': 4 }, click: '[data-network-scenario="web"]' },
            'infotech.layer-contract': { values: { '#network-payload': 4200, '#network-hops': 3 }, click: '[data-network-scenario="media"]' },
            'infotech.fault-trace': { values: { '#network-payload': 900, '#network-hops': 7 }, click: '[data-network-fault="transit"]' },
            'materials.grain-boundary': { values: { '#materials-grain-size': 45 }, click: '[data-material-cell="fcc"]' },
            'materials.defect-path': { values: { '#materials-grain-size': 20, '#materials-defect': 8 }, click: '[data-material-cell="bcc"]' },
            'materials.process-window': { values: { '#materials-grain-size': 92, '#materials-cooling': 20 }, click: '[data-material-preset="annealed"]' },
            'humanities.context-map': { values: { '#humanities-threshold': 1 }, click: '[data-humanities-mode="network"]' },
            'humanities.voice-shift': { click: '[data-humanities-sample="city"]' },
            'humanities.claim-review': { values: { '#humanities-threshold': 2 }, click: '[data-humanities-sample="primary"]' }
        };
        const preset = presets[route.activity.activity_key];
        if (!preset) return;
        Object.entries(preset.values || {}).forEach(([selector, value]) => {
            const input = $(stage, selector);
            if (!input) return;
            input.value = String(value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const button = preset.click && $(stage, preset.click);
        if (button) button.click();
    }

    function renderCourse(runtime, route) {
        const { course, activity } = route;
        const controlledLoadPath = activity.activity_key === FUTURE_REPRESENTATIVE;
        const answers = activityAnswers(activity);
        const nav = course.activities.filter((item) => activityAccess(route.availability, item).state !== 'hidden').map((item) => {
            const access = activityAccess(route.availability, item);
            if (access.state === 'open') return `<a href="#${esc(course.page)}/${esc(item.route_slug)}" data-galaxy-key="${esc(course.galaxy_key)}" data-course-key="${esc(course.course_key)}" data-activity-key="${esc(item.activity_key)}"${item.activity_key === activity.activity_key ? ' aria-current="page"' : ''}>${esc(item.title)}</a>`;
            return `<span aria-label="${esc(item.title)}暂不可用" data-activity-key="${esc(item.activity_key)}">${esc(item.title)}</span>`;
        }).join('');
        const modelControl = controlledLoadPath ? controlledLoadPathMarkup() : activity.kind === 'webgl'
            ? `<section class="fg-control"><label for="fg-orbit-position">${esc(activity.input)}</label><output for="fg-orbit-position" data-fg-output>50</output><input id="fg-orbit-position" data-fg-control type="range" min="0" max="100" value="50" aria-label="${esc(activity.input)}"><label for="fg-view-${runtime.id}">观察方位</label><output for="fg-view-${runtime.id}" data-fg-view-output>35°</output><input id="fg-view-${runtime.id}" data-fg-view type="range" min="0" max="360" value="35" aria-label="观察方位"><label class="fg-check"><input data-fg-low-power type="checkbox"${isReducedMotion() ? ' checked' : ''}>简化观测模式</label></section>`
            : `<section><h2>可操纵输入</h2><p>在观测场使用本课的控制器，改变${esc(activity.input)}后再比较证据。</p></section>`;
        runtime.mount.innerHTML = `
            <main class="fg-shell fg-course" data-galaxy-key="${esc(course.galaxy_key)}" data-course-key="${esc(course.course_key)}" data-activity-key="${esc(activity.activity_key)}" data-activity-kind="${esc(activity.kind)}">
                <nav class="fg-breadcrumb" aria-label="课程路径"><a href="#frontier">未来星系</a><span>/</span><span>${esc(course.title)}</span><span>/</span><span>${esc(activity.title)}</span></nav>
                <header class="fg-course-head">
                    <div><div class="fg-eyebrow">${esc(course.eyebrow)}</div><h1>${esc(activity.title)}</h1><p>${esc(course.question)}</p></div>
                    <ul class="fg-meta"><li><b>学习目标</b>${esc(course.objective)}</li><li><b>本次判断</b>${esc(activity.decision)}</li></ul>
                </header>
                <nav class="fg-activity-nav" aria-label="${esc(course.title)}子课程">${nav}</nav>
                <section class="fg-lab" aria-label="${esc(activity.title)}互动实验">
                    <div class="fg-stage" data-fg-stage>
                        <span class="fg-stage-label">OBSERVATION FIELD / 观测场</span>
                        <span class="fg-stage-status" data-fg-stage-status>准备观测</span>
                    </div>
                    <aside class="fg-panel">
                        <section><h2>问题</h2><p>${esc(course.question)}</p></section>
                        ${controlledLoadPath ? modelControl : `<section><h2>先预测</h2><p>${esc(activity.prompt)}</p></section>
                        ${modelControl}
                        <section><h2>观察</h2><p data-fg-observation>${esc(activity.observation)}</p></section>
                        <section><h2>判断或解释</h2><p>${esc(activity.decision)}</p><div class="fg-answers">${answers.map((answer, index) => `<label class="fg-answer"><input type="radio" name="fg-answer-${runtime.id}" value="${index}" data-fg-correct="${answer.correct}">${esc(answer.text)}</label>`).join('')}</div><button class="fg-submit" type="button" data-fg-submit>提交判断</button><p class="fg-feedback" data-fg-feedback aria-live="polite"></p></section>`}
                        ${controlledLoadPath ? '<section class="fg-load-path__evidence" data-fg-evidence-host aria-label="学习证据同步与服务端投影"></section>' : ''}
                    </aside>
                </section>
                <footer class="fg-course-footer"><span>把这次观察写成能被下一次操纵检验的解释。</span><a href="#frontier">回到课程目录</a></footer>
            </main>`;
        wireCourse(runtime, route);
    }

    function renderUnavailableCourse(runtime, route) {
        const locked = route && route.access && route.access.state === 'locked';
        const title = locked ? '本节尚未开放' : '课程暂不可用';
        const description = locked
            ? '教师正在按班级学习节奏开放课程，请先完成当前可学习的内容。'
            : '课程状态暂时无法确认，请稍后重试。';
        const metaLabel = locked ? '学习节奏' : '后续';
        const metaText = locked ? '开放后可从课程目录进入。' : '可先回到课程目录继续探索。';
        runtime.mount.innerHTML = `<main class="fg-shell fg-course" data-galaxy-key="future-galaxy"><nav class="fg-breadcrumb" aria-label="课程路径"><a href="#frontier">未来星系</a><span>/</span><span>课程状态</span></nav><header class="fg-course-head"><div><div class="fg-eyebrow">COURSE</div><h1>${title}</h1><p>${description}</p></div><ul class="fg-meta"><li><b>${metaLabel}</b>${metaText}</li></ul></header><p class="fg-footer-note"><a href="#frontier">回到课程目录</a></p></main>`;
    }

    function setupCanvas(canvas, lowPower) {
        const bounds = canvas.getBoundingClientRect();
        const ratio = Math.min(global.devicePixelRatio || 1, lowPower ? 1 : 1.5);
        const width = Math.max(1, Math.round(bounds.width * ratio));
        const height = Math.max(1, Math.round(bounds.height * ratio));
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        const context = canvas.getContext('2d');
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        return { context, width: bounds.width, height: bounds.height };
    }

    function strokeLine(context, from, to, color, width) {
        context.beginPath(); context.moveTo(from[0], from[1]); context.lineTo(to[0], to[1]); context.strokeStyle = color; context.lineWidth = width; context.stroke();
    }

    function drawCanvas(canvas, visual, value, lowPower) {
        const { context, width, height } = setupCanvas(canvas, lowPower);
        const t = value / 100;
        context.clearRect(0, 0, width, height);
        context.fillStyle = '#07142d'; context.fillRect(0, 0, width, height);
        const kind = visual;
        if (kind === 'orbit') {
            const cx = width * .54; const cy = height * .53; const orbitRadiusX = width * .27; const orbitRadiusY = height * .12; const focusX = cx - Math.sqrt(Math.max(0, orbitRadiusX ** 2 - orbitRadiusY ** 2)); const earthX = cx + Math.cos(t * Math.PI * 2) * orbitRadiusX; const earthY = cy + Math.sin(t * Math.PI * 2) * orbitRadiusY;
            context.strokeStyle = 'rgba(140,231,255,.48)'; context.lineWidth = 1; context.beginPath(); context.ellipse(cx, cy, width * .27, height * .12, 0, 0, Math.PI * 2); context.stroke();
            context.fillStyle = '#ffca75'; context.beginPath(); context.arc(focusX, cy, 22, 0, Math.PI * 2); context.fill();
            context.fillStyle = '#55b7ff'; context.beginPath(); context.arc(earthX, earthY, 28, 0, Math.PI * 2); context.fill();
            context.fillStyle = 'rgba(4,12,28,.72)'; context.beginPath(); context.arc(earthX + 8, earthY, 26, -Math.PI / 2, Math.PI / 2); context.fill();
            strokeLine(context, [focusX, cy], [earthX, earthY], 'rgba(255,216,130,.42)', 1);
        } else if (kind === 'bridge') {
            const x0 = width * .13, x1 = width * .87, y = height * .68, top = height * .35, nodes = [[x0,y],[width*.31,y],[width*.5,y],[width*.69,y],[x1,y]];
            nodes.forEach((node, index) => { if (index) strokeLine(context, nodes[index - 1], node, `hsl(${200 - Math.abs(index - 2 - t * 2) * 25} 90% 65%)`, 5); });
            for (let index = 0; index < 4; index += 1) strokeLine(context, nodes[index], [nodes[index + 1][0], top + (index % 2) * 34], 'rgba(140,231,255,.72)', 3);
            const loadX = x0 + (x1 - x0) * t; strokeLine(context, [loadX, height*.14], [loadX, y - 11], '#ffb86b', 3); context.fillStyle = '#ffb86b'; context.fillRect(loadX - 6, height*.14, 12, 12);
        } else if (kind === 'data') {
            const points = [[.14,.71],[.25,.61],[.34,.57],[.46,.48],[.55,.49],[.69,.31],[.8,.27]]; context.fillStyle = '#8ce7ff'; points.forEach(([x,y]) => { context.beginPath(); context.arc(width*x, height*y, 5, 0, Math.PI*2); context.fill(); });
            const slope = .22 + t * .58; strokeLine(context, [width*.1,height*(.8-slope*.1)], [width*.9,height*(.8-slope*.8)], '#ffb86b', 3); context.strokeStyle='rgba(255,184,107,.28)'; context.setLineDash([4,5]); points.forEach(([x,y]) => strokeLine(context,[width*x,height*y],[width*x,height*(.8-slope*(x-.1))],'rgba(255,184,107,.28)',1)); context.setLineDash([]);
        } else if (kind === 'network') {
            const nodes = [[.15,.55],[.35,.3],[.35,.73],[.58,.5],[.82,.5]].map(([x,y]) => [width*x,height*y]); const active = Math.floor(t * 4);
            nodes.slice(1).forEach((node, index) => strokeLine(context, nodes[index], node, index <= active ? '#8ce7ff' : 'rgba(140,231,255,.22)', index <= active ? 4 : 2));
            nodes.forEach((node, index) => { context.fillStyle = index <= active + 1 ? '#ffb86b' : '#30608b'; context.beginPath(); context.arc(node[0],node[1],15,0,Math.PI*2); context.fill(); });
        } else if (kind === 'materials') {
            const grain = 20 + (1 - t) * 46; for (let y = grain; y < height; y += grain * 1.25) for (let x = grain; x < width; x += grain * 1.18) { context.beginPath(); context.arc(x + (y/grain%2)*8,y,grain*.55,0,Math.PI*2); context.fillStyle=`hsla(${190+(x+y)%60},70%,${30 + t*22}%,.82)`; context.fill(); context.strokeStyle='rgba(220,242,255,.36)'; context.stroke(); }
            strokeLine(context,[width*.1,height*.18],[width*.9,height*.18],'#ffb86b',2); context.fillStyle='#ffb86b'; context.fillRect(width*.1,height*.15,width*.8*t,5);
        } else {
            const nodes = [[.22,.32],[.46,.21],[.73,.35],[.28,.68],[.58,.67],[.82,.73]].map(([x,y]) => [width*x,height*y]);
            [[0,1],[1,2],[0,3],[1,4],[2,4],[3,4],[4,5]].forEach(([a,b], index) => strokeLine(context,nodes[a],nodes[b],index < 3 + Math.floor(t*4) ? 'rgba(140,231,255,.75)' : 'rgba(140,231,255,.16)',2));
            nodes.forEach((node,index) => { context.fillStyle = index === Math.floor(t*5) ? '#ffb86b' : '#8ce7ff'; context.beginPath(); context.arc(node[0],node[1],13,0,Math.PI*2); context.fill(); });
        }
    }

    function disposeThreeResources(renderer, scene, renderTargets, imageBitmaps, canvas) {
        const textures = new Set();
        const materials = new Set();
        if (scene) scene.traverse((object) => {
            if (object.geometry && typeof object.geometry.dispose === 'function') object.geometry.dispose();
            if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => {
                materials.add(material);
                Object.values(material).forEach((value) => { if (value && value.isTexture) textures.add(value); });
            });
            if (object.userData && object.userData.imageBitmap && typeof object.userData.imageBitmap.close === 'function') imageBitmaps.add(object.userData.imageBitmap);
        });
        materials.forEach((material) => material.dispose && material.dispose());
        textures.forEach((texture) => texture.dispose && texture.dispose());
        renderTargets.forEach((target) => target.dispose && target.dispose());
        imageBitmaps.forEach((bitmap) => bitmap.close && bitmap.close());
        renderer.setAnimationLoop && renderer.setAnimationLoop(null);
        renderer.renderLists && renderer.renderLists.dispose && renderer.renderLists.dispose();
        renderer.dispose && renderer.dispose();
        renderer.forceContextLoss && renderer.forceContextLoss();
        if (canvas && canvas.isConnected) canvas.remove();
    }

    async function mountThreeOrbit(runtime, route, stage, value, lowPower, viewAzimuth = 35) {
        if (lowPower || isReducedMotion()) return mountCanvasVisual(runtime, route, stage, value, true, '简化观测模式');
        const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label', '可观察地球日照与轨道位置的三维模型'); stage.prepend(canvas);
        let renderer; let scene; let camera; let earth; let sun; let light; let frame = 0; let observer;
        const targets = new Set(); const bitmaps = new Set();
        try {
            const THREE = await import('../../shared/vendor/three-r185/three.module.js');
            if (runtime.abort.signal.aborted || activeRuntime !== runtime || !canvas.isConnected) {
                if (canvas.isConnected) canvas.remove();
                return;
            }
            renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
            renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 1.5));
            scene = new THREE.Scene(); scene.background = new THREE.Color(0x07142d);
            camera = new THREE.PerspectiveCamera(38, 1, .1, 100);
            const ambient = new THREE.AmbientLight(0x7eaaff, 1.45); scene.add(ambient);
            const orbitMajorRadius = 2.5;
            const orbitMinorRadius = 1.2;
            const orbitFocusX = -Math.sqrt(orbitMajorRadius ** 2 - orbitMinorRadius ** 2);
            sun = new THREE.Mesh(new THREE.SphereGeometry(.33, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffc56b })); sun.position.set(orbitFocusX, 0, 0); scene.add(sun);
            // A point light at the teaching sun makes the Earth day/night boundary visible.
            // This is deliberately a non-real-scale learning model, not an orbital simulation.
            light = new THREE.PointLight(0xffd381, 22, 0, 2); light.position.copy(sun.position); scene.add(light);
            earth = new THREE.Mesh(new THREE.SphereGeometry(1.05, 36, 24), new THREE.MeshStandardMaterial({ color: 0x3098ef, roughness: .72, metalness: .04 })); earth.rotation.z = 23.44 * Math.PI / 180; scene.add(earth);
            const orbit = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 65 }, (_, index) => { const angle = index / 64 * Math.PI * 2; return new THREE.Vector3(Math.cos(angle) * orbitMajorRadius, 0, Math.sin(angle) * orbitMinorRadius); })), new THREE.LineBasicMaterial({ color: 0x8ce7ff, transparent: true, opacity: .6 })); scene.add(orbit);
            const setCamera = (azimuth) => { viewAzimuth = azimuth; const radians = viewAzimuth * Math.PI / 180; camera.position.set(Math.sin(radians) * 7.8, 4.4, Math.cos(radians) * 7.8); camera.lookAt(0, 0, 0); };
            const resize = () => { const bounds = stage.getBoundingClientRect(); renderer.setSize(bounds.width, Math.max(350, bounds.height), false); camera.aspect = bounds.width / Math.max(350, bounds.height); camera.updateProjectionMatrix(); };
            const render = (next) => { const angle = next / 100 * Math.PI * 2; earth.position.set(Math.cos(angle) * orbitMajorRadius, 0, Math.sin(angle) * orbitMinorRadius); earth.rotation.y = angle * 1.2; light.position.copy(sun.position); setCamera(viewAzimuth); renderer.render(scene, camera); };
            resize(); render(value);
            observer = new ResizeObserver(() => { global.cancelAnimationFrame(frame); frame = global.requestAnimationFrame(() => { resize(); render(value); }); }); observer.observe(stage);
            runtime.visual = { update(next) { value = next; global.cancelAnimationFrame(frame); frame = global.requestAnimationFrame(() => render(value)); }, setView(next) { viewAzimuth = next; global.cancelAnimationFrame(frame); frame = global.requestAnimationFrame(() => render(value)); }, dispose() { global.cancelAnimationFrame(frame); observer.disconnect(); disposeThreeResources(renderer, scene, targets, bitmaps, canvas); } };
            const status = $(stage, '[data-fg-stage-status]'); if (status) status.textContent = '互动已就绪；这是非真实比例的学习模型';
        } catch (error) {
            if (renderer) disposeThreeResources(renderer, scene, targets, bitmaps, canvas);
            else if (canvas.isConnected) canvas.remove();
            if (!runtime.abort.signal.aborted && activeRuntime === runtime) mountCanvasVisual(runtime, route, stage, value, true, '简化观测模式');
        }
    }

    function mountCanvasVisual(runtime, route, stage, value, lowPower, message) {
        if (runtime.visual && runtime.visual.dispose) runtime.visual.dispose();
        stage.querySelectorAll('canvas').forEach((canvas) => canvas.remove());
        const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label', `${route.course.title} ${route.activity.title} 可操纵观察图`); stage.prepend(canvas);
        let frame = 0;
        const draw = () => drawCanvas(canvas, route.course.visual, value, lowPower);
        const schedule = () => { global.cancelAnimationFrame(frame); frame = global.requestAnimationFrame(draw); };
        const observer = new ResizeObserver(schedule); observer.observe(stage); schedule();
        runtime.visual = { update(next) { value = next; schedule(); }, dispose() { global.cancelAnimationFrame(frame); observer.disconnect(); if (canvas.isConnected) canvas.remove(); } };
        const status = $(stage, '[data-fg-stage-status]'); if (status) status.textContent = message || '互动已就绪';
    }

    function wireCourse(runtime, route) {
        const control = $(runtime.mount, '[data-fg-control]'); const output = $(runtime.mount, '[data-fg-output]'); const lowPower = $(runtime.mount, '[data-fg-low-power]'); const stage = $(runtime.mount, '[data-fg-stage]');
        const view = $(runtime.mount, '[data-fg-view]'); const viewOutput = $(runtime.mount, '[data-fg-view-output]');
        let value = Number(control && control.value || 50);
        runtime.evidenceBindingPromise = route.activity.activity_key === FUTURE_REPRESENTATIVE
            ? mountRepresentativeEvidence(runtime, route)
            : Promise.resolve(null);
        const mountVisual = () => {
            if (runtime.visual && runtime.visual.dispose) runtime.visual.dispose();
            runtime.visual = null;
            if (route.activity.kind === 'webgl') mountThreeOrbit(runtime, route, stage, value, !!(lowPower && lowPower.checked), Number(view && view.value || 35));
            else mountOwnerVisual(runtime, route, stage);
        };
        if (route.activity.kind === 'webgl' && control) {
            control.addEventListener('input', () => { value = Number(control.value); output.value = String(value); output.textContent = String(value); if (runtime.visual) runtime.visual.update(value); }, { signal: runtime.abort.signal });
            lowPower.addEventListener('change', mountVisual, { signal: runtime.abort.signal });
            view.addEventListener('input', () => { viewOutput.value = `${view.value}°`; viewOutput.textContent = `${view.value}°`; if (runtime.visual && runtime.visual.setView) runtime.visual.setView(Number(view.value)); }, { signal: runtime.abort.signal });
        }
        const submit = $(runtime.mount, '[data-fg-submit]');
        if (submit) submit.addEventListener('click', () => {
            const selected = runtime.mount.querySelector('input[name="fg-answer-' + runtime.id + '"]:checked'); const feedback = $(runtime.mount, '[data-fg-feedback]');
            if (!selected) {
                feedback.textContent = `先完成「${route.activity.title}」的选择，再回看你操纵变量后的观察。`;
            } else if (selected.dataset.fgCorrect === 'true') {
                feedback.textContent = `这个解释可以由本课观察支持：${route.activity.decision}`;
            } else {
                feedback.textContent = `试着再观察一次：比较操纵前后的证据，再检查这个解释。`;
            }
        }, { signal: runtime.abort.signal });
        mountVisual();
    }

    function render(requestedPage) {
        const route = resolveRoute(requestedPage);
        if (!route) return false;
        const mount = document.getElementById(`page-${route.page}`);
        if (!mount) return false;
        clearActive();
        const runtime = { id: ++generation, generation, page: route.page, mount, abort: new AbortController(), cleanups: [], visual: null, destroyed: false };
        activeRuntime = runtime;
        const manifest = getManifest();
        if (route.page === 'frontier') renderCatalogue(runtime, manifest);
        else if (route.access.state === 'open') renderCourse(runtime, route);
        else renderUnavailableCourse(runtime, route);
        if (global.lucide && typeof global.lucide.createIcons === 'function') global.lucide.createIcons();
        return true;
    }

    function installHashListener() {
        if (hashListenerInstalled) return;
        hashListenerInstalled = true;
        global.addEventListener('hashchange', () => {
            const next = pageFromHash();
            if (MANAGED_PAGES.has(next)) global.setTimeout(() => render(next), 0);
        });
    }

    function refreshHttpCourseState() {
        const manifest = getManifest();
        if (!manifest || !manifest.hasHttpConfig || !manifest.hasHttpConfig()) return Promise.resolve(null);
        return manifest.refresh().then(() => {
            const next = pageFromHash();
            if (MANAGED_PAGES.has(next)) render(next);
        });
    }

    Object.assign(FrontierLearning, {
        init(page) {
            installHashListener();
            const target = page || pageFromHash();
            if (!MANAGED_PAGES.has(target)) return false;
            if (getManifest()) {
                ensureCourseStyle().then(() => { render(target); refreshHttpCourseState(); }).catch(() => { render(target); refreshHttpCourseState(); });
                return true;
            }
            Promise.all([ensureManifest(), ensureCourseStyle()]).then(() => { render(target); refreshHttpCourseState(); }).catch(() => {});
            return false;
        },
        destroy(page) { clearActive(page); },
        renderRoute(page) { return render(page); },
        lifecycleContract: Object.freeze({
            abortController: true,
            cleanupStack: true,
            generationGuard: true,
            disposes: Object.freeze(['controls', 'passes', 'geometry', 'material', 'texture', 'renderTarget', 'ImageBitmap', 'renderLists', 'renderer', 'animationLoop', 'canvas'])
        })
    });
    global.initFrontierCourse = () => FrontierLearning.init(pageFromHash());
    global.destroyFrontierCourse = () => FrontierLearning.destroy();
    global.refreshFutureGalaxyCourses = () => refreshHttpCourseState();
})(window);
