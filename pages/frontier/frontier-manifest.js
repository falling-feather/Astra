/* Future Galaxy course manifest: the single client-side bridge for BE-004. */
(function attachFutureGalaxyManifest(global) {
    'use strict';

    const GALAXY_KEY = 'future-galaxy';
    const course = (course_key, page, title, eyebrow, question, objective, visual, activities) => Object.freeze({
        galaxy_key: GALAXY_KEY,
        course_key,
        page,
        title,
        eyebrow,
        question,
        objective,
        visual,
        activities: Object.freeze(activities.map((activity) => Object.freeze({
            galaxy_key: GALAXY_KEY,
            course_key,
            ...activity,
            route_slug: activity.route_slug || String(activity.activity_key || '').split('.').slice(1).join('.')
        })))
    });

    const courses = Object.freeze([
        course('earth-space', 'cosmos', '地球与宇宙', 'ORBITAL FIELD', '太阳高度变化为什么会改变白昼与温度？', '用可调的日照角与轨道尺度，把预测、观察和判断连成一次可复查的推理。', 'orbit', [
            { activity_key: 'cosmos.day-season', title: '昼夜与季节', kind: 'canvas', input: '年内日期', input_control: 'cosmos-day', prompt: '先预测：北半球的受光面积会怎样变化？', observation: '观察昼夜分界线与受光带。', decision: '选择最能解释季节差异的结论。' },
            { activity_key: 'cosmos.orbital-scale', title: '轨道与尺度', kind: 'webgl', input: '轨道位置', input_control: 'fg-orbit-position', prompt: '先预测：改变位置后，昼夜分界线与观察角会怎样移动？', observation: '观察可旋转的地球、轨道和日照方向。', decision: '判断位置变化与昼夜现象的关系。' },
            { activity_key: 'cosmos.evidence-log', title: '证据记录', kind: 'canvas', input: '观测时刻', input_control: 'cosmos-hour', prompt: '先预测：同一地点的阴影会向哪里移动？', observation: '观察太阳高度点与影长读数。', decision: '用一句因果解释提交判断。' }
        ]),
        course('engineering-systems', 'engineering', '工程应用', 'SYSTEMS STUDIO', '结构受力如何沿着构件传递？', '调节载荷位置，观察受力路径，判断哪个设计更能稳定传力。', 'bridge', [
            { activity_key: 'engineering.load-path', title: '受力路径', kind: 'canvas', input: '载荷位置', input_control: 'truss-joint', prompt: '先预测：把载荷移到跨中，哪几根杆会先变红？', observation: '观察桁架节点与受力强度。', decision: '选择更合理的加固位置。' },
            { activity_key: 'engineering.member-choice', title: '构件选择', kind: 'canvas', input: '杆件数量', input_control: 'truss-member', prompt: '先预测：删去 FB 斜杆后，原静力模型还能继续校核吗？', observation: '观察虚线 FB 斜杆与“模型不可校核”状态。', decision: '解释三角单元为何常用于稳定结构。' },
            { activity_key: 'engineering.safety-check', title: '安全校核', kind: 'canvas', input: '安全系数', input_control: 'truss-safety', prompt: '先预测：提高安全系数后，允许载荷会怎样变化？', observation: '观察利用率读数与阈值颜色。', decision: '判断方案是否满足约束。' },
            { activity_key: 'engineering.robot-arm-ik', title: '机械臂逆运动学', kind: 'canvas', input: '目标点与关节限位', input_control: 'robot-arm-ik-parameter', prompt: '拖动目标点，观察机械臂能否在限位内到达。', observation: '观察末端误差、迭代次数和目标状态。', decision: '判断目标是可达、受限还是超出臂长。' }
        ]),
        course('data-ai', 'datascience', '数据科学', 'MODEL BENCH', '一条拟合线何时能帮助解释数据？', '改变模型参数并查看误差，区分“贴近样本”和“可解释”的判断。', 'data', [
            { activity_key: 'datascience.model-fit', title: '模型拟合', kind: 'canvas', input: '斜率', input_control: 'regression-slope', prompt: '先预测：斜率变大时哪些点的误差会增加？', observation: '观察样本、拟合线与残差。', decision: '选择误差更小且方向合理的模型。' },
            { activity_key: 'datascience.outlier-test', title: '离群点检验', kind: 'canvas', input: '样本数据集', input_control: 'regression-dataset', prompt: '先预测：切换到含离群点的样本会如何拉动拟合线？', observation: '观察离群点、残差与模型偏移。', decision: '解释为什么需要标记异常值。' },
            { activity_key: 'datascience.evidence-claim', title: '证据与主张', kind: 'canvas', input: '样本数据集', input_control: 'regression-dataset', prompt: '先预测：切换到温度与销量样本会带来什么不确定性？', observation: '观察样本范围、趋势与残差。', decision: '选择最谨慎的结论表述。' }
        ]),
        course('information-technology', 'infotech', '信息技术', 'NETWORK TRACE', '一个请求如何穿过分层网络到达目的地？', '调节跳数和请求体，沿路径观察分层处理，再判断瓶颈所在。', 'network', [
            { activity_key: 'infotech.packet-route', title: '分组路由', kind: 'canvas', input: '跳数', input_control: 'network-hops', prompt: '先预测：增加中继后，请求的到达时间会怎样变化？', observation: '观察数据包穿过节点与层。', decision: '判断哪一段最可能是瓶颈。' },
            { activity_key: 'infotech.layer-contract', title: '分层约定', kind: 'canvas', input: '消息长度', input_control: 'network-payload', prompt: '先预测：更长的消息会影响哪一层的工作？', observation: '观察封装与传输标记。', decision: '解释分层为何能降低复杂度。' },
            { activity_key: 'infotech.fault-trace', title: '故障追踪', kind: 'canvas', input: '故障节点', input_control: 'network-fault', prompt: '先预测：一个节点失效后，包会在哪里停下？', observation: '观察红色故障节点与停下的数据包。', decision: '选择最先检查的网络层。' }
        ]),
        course('materials-science', 'materials', '材料微观', 'MATTER ATLAS', '微观晶粒与缺陷为什么会改变材料表现？', '调节晶粒尺度，观察边界密度与受力方向，再判断微结构方案。', 'materials', [
            { activity_key: 'materials.grain-boundary', title: '晶粒边界', kind: 'canvas', input: '晶粒尺度', input_control: 'materials-grain-size', prompt: '先预测：晶粒更细时，边界数量会怎样变化？', observation: '观察晶粒、边界与受力箭头。', decision: '判断哪种结构更可能阻碍位错。' },
            { activity_key: 'materials.defect-path', title: '缺陷路径', kind: 'canvas', input: '缺陷密度', input_control: 'materials-defect', prompt: '先预测：增加缺陷会让裂纹更容易向哪里延伸？', observation: '观察红色缺陷点与传播路径。', decision: '解释缺陷并非总是“看得见的洞”。' },
            { activity_key: 'materials.process-window', title: '工艺窗口', input: '冷却速率', input_control: 'materials-cooling', kind: 'canvas', prompt: '先预测：冷却更快会如何影响组织尺度？', observation: '观察组织由粗到细的变化与读数。', decision: '选择与目标性能匹配的工艺方向。' }
        ]),
        course('humanities-futures', 'humanities', '人文可视化', 'CONTEXT LAB', '一个文本或图像在什么语境中才有意义？', '调整叙事视角与连接强度，观察关系网络，并用证据解释一个判断。', 'humanities', [
            { activity_key: 'humanities.context-map', title: '语境地图', kind: 'canvas', input: '共现证据阈值', input_control: 'humanities-threshold', prompt: '先预测：提高共现阈值后，哪些主题连接会留下？', observation: '观察人物、事件与概念之间的连线。', decision: '选择最能由关系支持的解释。' },
            { activity_key: 'humanities.voice-shift', title: '视角切换', kind: 'canvas', input: '文本材料', input_control: 'humanities-sample', prompt: '先预测：切换文本材料后，哪些关系会被强调？', observation: '观察节点权重与色彩变化。', decision: '解释“观点”与“事实”如何共存。' },
            { activity_key: 'humanities.claim-review', title: '主张审阅', kind: 'canvas', input: '证据阈值', input_control: 'humanities-threshold', prompt: '先预测：提高证据阈值会留下哪些连接？', observation: '观察弱关联逐步淡出。', decision: '提交可追溯的解释。' }
        ])
    ]);

    const getCourse = (course_key) => courses.find((item) => item.course_key === course_key) || null;
    const getCourseByPage = (page) => courses.find((item) => item.page === page) || null;
    const getActivity = (course_key, activity_key) => {
        const item = getCourse(course_key);
        return item && item.activities.find((activity) => activity.activity_key === activity_key) || null;
    };

    const ACCESS_STATES = new Set(['open', 'locked', 'hidden']);
    const unavailableAccess = () => Object.freeze({ state: 'unavailable' });
    const allActivities = courses.flatMap((item) => item.activities);
    const sanitizeActivityAccess = (raw) => {
        const input = raw && typeof raw === 'object' ? raw : {};
        const output = {};
        allActivities.forEach((item) => {
            const candidate = input[item.activity_key];
            if (typeof candidate === 'string' && ACCESS_STATES.has(candidate)) {
                output[item.activity_key] = Object.freeze({ state: candidate });
                return;
            }
            if (candidate && typeof candidate === 'object' && ACCESS_STATES.has(candidate.state)) {
                const normalized = { state: candidate.state };
                // Progress is intentionally accepted only as explicit numeric state, never inferred.
                if (Number.isFinite(candidate.progress)) normalized.progress = Math.max(0, Math.min(1, Number(candidate.progress)));
                output[item.activity_key] = Object.freeze(normalized);
                return;
            }
            output[item.activity_key] = unavailableAccess();
        });
        return Object.freeze(output);
    };
    const deriveCourseAccess = (activity_access) => Object.freeze(courses.reduce((output, item) => {
        const states = item.activities.map((activity) => activity_access[activity.activity_key] || unavailableAccess()).map((access) => access.state);
        output[item.course_key] = Object.freeze({
            state: states.every((state) => state === 'hidden') ? 'hidden'
                : states.includes('open') ? 'open'
                    : states.every((state) => state === 'locked' || state === 'hidden') ? 'locked'
                        : 'unavailable'
        });
        return output;
    }, {}));

    // BE-004 returns only open/locked units. The adapter calls this once per course
    // after GET /api/courses/{course_id}/units?class_id={class_id}; a known manifest
    // activity absent from a valid response is hidden, and malformed/unknown rows fail closed.
    const adaptBe004Course = (course_key, units) => {
        const currentCourse = getCourse(course_key);
        if (!currentCourse || !Array.isArray(units)) return null;
        const expected = new Map(currentCourse.activities.map((activity) => [activity.activity_key, activity]));
        const output = Object.fromEntries(currentCourse.activities.map((activity) => [activity.activity_key, { state: 'hidden' }]));
        const unitIds = {};
        for (const unit of units) {
            if (!unit || typeof unit !== 'object' || !expected.has(unit.activity_key)
                || !('id' in unit) || typeof unit.title !== 'string' || !Number.isFinite(unit.position)
                || !Array.isArray(unit.lock_reasons) || !['open', 'locked'].includes(unit.effective_release_state)) return null;
            if (output[unit.activity_key].state !== 'hidden') return null;
            output[unit.activity_key] = { state: unit.effective_release_state };
            const unitId = Number(unit.id);
            if (Number.isInteger(unitId) && unitId > 0) unitIds[unit.activity_key] = unitId;
        }
        return Object.freeze({
            access: Object.freeze(output),
            unit_ids: Object.freeze(unitIds)
        });
    };
    const adaptBe004Units = (course_key, units) => {
        const adapted = adaptBe004Course(course_key, units);
        return adapted ? adapted.access : null;
    };

    let httpConfig = null;
    let httpSnapshot = null;
    let httpEvidenceBindings = null;
    let httpRefresh = null;
    let httpGeneration = 0;
    const unavailableSnapshot = (source) => Object.freeze({
        galaxy_key: GALAXY_KEY,
        source,
        availability: 'unavailable',
        teacher_plan: 'unavailable',
        course_access: deriveCourseAccess(sanitizeActivityAccess(null)),
        activity_access: sanitizeActivityAccess(null)
    });
    const isCourseIdMap = (value) => value && typeof value === 'object' && courses.every((item) => {
        const id = value[item.course_key];
        return typeof id === 'string' || Number.isFinite(id);
    });

    // This configures the BE-004 student-unit adapter but never performs a request in
    // resolveAvailability(). Consumers call refresh() during preload/refresh, then render
    // reads only the finished cached snapshot.
    const configureHttp = ({ course_ids, class_id, fetcher } = {}) => {
        httpGeneration += 1;
        httpRefresh = null;
        httpEvidenceBindings = null;
        if (!isCourseIdMap(course_ids) || !(typeof class_id === 'string' || Number.isFinite(class_id))
            || (fetcher !== undefined && typeof fetcher !== 'function')
            || (fetcher === undefined && typeof global.fetch !== 'function')) {
            httpConfig = null;
            httpSnapshot = unavailableSnapshot('http-config-unavailable');
            return false;
        }
        httpConfig = Object.freeze({
            course_ids: Object.freeze({ ...course_ids }),
            class_id: String(class_id),
            fetcher: fetcher || global.fetch.bind(global)
        });
        httpSnapshot = unavailableSnapshot('http-pending');
        return true;
    };
    const refresh = async () => {
        if (!httpConfig) return httpSnapshot || unavailableSnapshot('http-unconfigured');
        const config = httpConfig;
        const generation = httpGeneration;
        if (httpRefresh && httpRefresh.generation === generation) return httpRefresh.promise;
        const promise = Promise.all(courses.map(async (item) => {
            const courseId = encodeURIComponent(String(config.course_ids[item.course_key]));
            const classId = encodeURIComponent(config.class_id);
            const response = await config.fetcher(`/api/courses/${courseId}/units?class_id=${classId}`, { credentials: 'same-origin' });
            if (!response || response.ok !== true || typeof response.json !== 'function') throw new Error('Invalid BE-004 units response');
            const adapted = adaptBe004Course(item.course_key, await response.json());
            if (!adapted) throw new Error('Invalid BE-004 unit fields');
            return Object.freeze({ course: item, adapted });
        })).then((perCourse) => {
            const activity_access = Object.freeze(Object.assign({}, ...perCourse.map(item => item.adapted.access)));
            const evidenceBindings = Object.freeze(Object.assign({}, ...perCourse.map(({ course, adapted }) => (
                Object.fromEntries(Object.entries(adapted.unit_ids).map(([activityKey, unitId]) => [activityKey, Object.freeze({
                    galaxy_key: GALAXY_KEY,
                    course_key: course.course_key,
                    activity_key: activityKey,
                    class_id: Number(config.class_id),
                    course_id: Number(config.course_ids[course.course_key]),
                    course_unit_id: unitId,
                    access_state: activity_access[activityKey] && activity_access[activityKey].state,
                    authority_generation: generation
                })]))
            ))));
            const snapshot = Object.freeze({
                galaxy_key: GALAXY_KEY,
                source: 'http-cache',
                availability: 'available',
                teacher_plan: 'unavailable',
                course_access: deriveCourseAccess(activity_access),
                activity_access
            });
            if (generation === httpGeneration && config === httpConfig) {
                httpSnapshot = snapshot;
                httpEvidenceBindings = evidenceBindings;
            }
            return generation === httpGeneration && config === httpConfig ? snapshot : (httpSnapshot || snapshot);
        }).catch(() => {
            const snapshot = unavailableSnapshot('http-unavailable');
            if (generation === httpGeneration && config === httpConfig) {
                httpSnapshot = snapshot;
                httpEvidenceBindings = null;
            }
            return generation === httpGeneration && config === httpConfig ? snapshot : (httpSnapshot || snapshot);
        }).finally(() => {
            if (httpRefresh && httpRefresh.generation === generation) httpRefresh = null;
        });
        httpRefresh = Object.freeze({ generation, promise });
        return promise;
    };

    // BE-004 can provide a state adapter later. Only a wholly absent adapter means the
    // legacy local catalogue may default-open; every malformed adapter response fails closed.
    const resolveAvailability = () => {
        if (httpConfig || httpSnapshot) return httpSnapshot || unavailableSnapshot('http-pending');
        const adapter = global.AstraCourseStateAdapter;
        if (!adapter) {
            return Object.freeze({
                galaxy_key: GALAXY_KEY,
                source: 'legacy-default-open',
                availability: 'default-open',
                teacher_plan: 'unavailable',
                course_access: Object.freeze({}),
                activity_access: Object.freeze({})
            });
        }
        if (typeof adapter.getFutureGalaxyState !== 'function') {
            return Object.freeze({
                galaxy_key: GALAXY_KEY,
                source: 'adapter-unavailable',
                availability: 'unavailable',
                teacher_plan: 'unavailable',
                course_access: deriveCourseAccess(sanitizeActivityAccess(null)),
                activity_access: sanitizeActivityAccess(null)
            });
        }
        try {
            const incoming = adapter.getFutureGalaxyState({ galaxy_key: GALAXY_KEY, courses });
            if (!incoming || typeof incoming !== 'object') throw new Error('Invalid course state adapter response');
            if (typeof incoming.then === 'function') throw new Error('Future galaxy state must be a cached snapshot, not a pending fetch');
            if (incoming.availability !== 'available' || !incoming.activity_access || typeof incoming.activity_access !== 'object') throw new Error('Unknown future galaxy availability');
            const activity_access = sanitizeActivityAccess(incoming.activity_access);
            return Object.freeze({
                galaxy_key: GALAXY_KEY,
                source: 'adapter',
                availability: 'available',
                teacher_plan: incoming.teacher_plan || 'unavailable',
                course_access: deriveCourseAccess(activity_access),
                activity_access
            });
        } catch (error) {
            return Object.freeze({
                galaxy_key: GALAXY_KEY,
                source: 'adapter-unavailable',
                availability: 'unavailable',
                teacher_plan: 'unavailable',
                course_access: deriveCourseAccess(sanitizeActivityAccess(null)),
                activity_access: sanitizeActivityAccess(null)
            });
        }
    };

    const resolveEvidenceBinding = (course_key, activity_key) => {
        const activity = getActivity(course_key, activity_key);
        const binding = httpEvidenceBindings && httpEvidenceBindings[activity_key];
        const access = httpSnapshot && httpSnapshot.activity_access && httpSnapshot.activity_access[activity_key];
        if (
            !httpConfig
            || !activity
            || !binding
            || httpSnapshot && httpSnapshot.availability !== 'available'
            || !access
            || access.state !== 'open'
            || binding.course_key !== course_key
            || binding.activity_key !== activity_key
            || binding.authority_generation !== httpGeneration
            || !Number.isInteger(binding.class_id)
            || binding.class_id <= 0
            || !Number.isInteger(binding.course_id)
            || binding.course_id <= 0
            || !Number.isInteger(binding.course_unit_id)
            || binding.course_unit_id <= 0
        ) return null;
        return Object.freeze({ ...binding });
    };

    global.FrontierCourseManifest = Object.freeze({
        galaxy_key: GALAXY_KEY,
        courses,
        getCourse,
        getCourseByPage,
        getActivity,
        adaptBe004Units,
        configureHttp,
        hasHttpConfig: () => !!httpConfig,
        refresh,
        resolveAvailability,
        resolveEvidenceBinding
    });
})(window);
