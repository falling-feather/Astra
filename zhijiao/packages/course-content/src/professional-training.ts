import { deepFreeze, hashCanonical } from "./canonical.js";

export const ProfessionalTrainingSchemaVersion = "professional-training/1.0.0" as const;
export const ProfessionalTrainingKnowledgeSchemaVersion = "professional-training-knowledge/1.0.0" as const;

export type ProfessionalSourceAccessStatus = "reachable_on_check_date" | "blocked_on_check_date" | "registered_only";
export type ProfessionalKnowledgeReviewStatus = "pending_expert_review";

export interface ProfessionalSourceRecord {
  sourceId: string;
  title: string;
  publisher: string;
  url: string;
  publicationDate: string;
  sourceVersion: string;
  locator: string;
  accessStatus: ProfessionalSourceAccessStatus;
  sourceByteHash: null;
  rightsNote: string;
}

export interface ProfessionalTrainingKnowledgeRecord {
  schemaVersion: typeof ProfessionalTrainingKnowledgeSchemaVersion;
  knowledgeId: string;
  topic: string;
  teachingSummary: string;
  applicableSectionIds: readonly string[];
  source: ProfessionalSourceRecord;
  applicableConditions: readonly string[];
  counterExamples: readonly string[];
  executableDisposal: readonly string[];
  factBoundary: string;
  reviewStatus: ProfessionalKnowledgeReviewStatus;
  reviewNote: string;
  contentHash: string;
}

export interface ProfessionalTrainingTask {
  taskId: string;
  title: string;
  workflowPhase: "planning" | "source" | "interview" | "field_record" | "fact_check" | "rights" | "editing" | "distribution" | "metrics" | "correction";
  competencyRefs: readonly string[];
  knowledgeIds: readonly string[];
  courseSectionRefs: readonly string[];
  artifacts: readonly string[];
  rubricDimensions: readonly string[];
  collaborationRoles: readonly ("reporter" | "editor" | "fact_checker" | "rights_reviewer" | "platform_operator")[];
  trainingRules: ReadonlyArray<{
    ruleId: string;
    ruleType: "course_training_design";
    statement: string;
  }>;
}

export interface ProfessionalTrainingPackage {
  schemaVersion: typeof ProfessionalTrainingSchemaVersion;
  packageId: "professional-media-reporter-training";
  title: string;
  primaryRole: "integrated_media_reporter";
  knowledgeRecords: readonly ProfessionalTrainingKnowledgeRecord[];
  tasks: readonly ProfessionalTrainingTask[];
  reviewBoundary: string;
}

const rightsNote = "仅登记公开来源元数据与教学改写；不复制长篇原文、图片、音频或视频，不表示已取得校内教师复核。";
const pendingReviewNote = "内容结构与教学转译待融媒体专业教师逐条复核；本记录不是正式专业群认定或教师签收。";

const sources = {
  moe: {
    sourceId: "source-moe-media-editing-standard-2025",
    title: "新闻采编与制作专业教学标准（高等职业教育专科）",
    publisher: "中华人民共和国教育部",
    url: "https://www.moe.gov.cn/s78/A07/zcs_ztzl/2017_zt06/17zt06_bznr/bznr_zyjyzyjxbz/gdzyjy_zk/zk_xwcbdl/xwcbdl_gbysl/202502/P020250207548927436229.pdf",
    publicationDate: "2025-02-07",
    sourceVersion: "教育部职业教育专业教学标准 2025 发布版；原件下载本轮受限，未计算原件 hash",
    locator: "专业核心课程/典型工作任务相关章节；页码以摄入原件复核为准",
    accessStatus: "blocked_on_check_date" as const,
    sourceByteHash: null,
    rightsNote,
  },
  mohrss: {
    sourceId: "source-mohrss-all-media-operator-standard-2023",
    title: "全媒体运营师国家职业标准",
    publisher: "中华人民共和国人力资源和社会保障部",
    url: "https://www.mohrss.gov.cn/xxgk2020/fdzdgknr/rcrs_4225/jnrc/202312/W020231205397300830298.pdf",
    publicationDate: "2023-12-05",
    sourceVersion: "全媒体运营师国家职业标准 2023 官方发布版；原件下载本轮受限，未计算原件 hash",
    locator: "职业功能、工作内容与技能要求相关章节；页码以摄入原件复核为准",
    accessStatus: "blocked_on_check_date" as const,
    sourceByteHash: null,
    rightsNote,
  },
  journalists: {
    sourceId: "source-zgjx-journalism-ethics-2019",
    title: "中国新闻工作者职业道德准则",
    publisher: "中国记协",
    url: "https://www.zgjx.cn/2019-12/15/c_138632458.htm",
    publicationDate: "2019-12-15",
    sourceVersion: "中国记协网站 2019-12-15 发布页面",
    locator: "准则正文：真实、准确、全面、客观、核实与更正相关条款",
    accessStatus: "registered_only" as const,
    sourceByteHash: null,
    rightsNote,
  },
  copyright: {
    sourceId: "source-ncac-copyright-law-2020-revision",
    title: "中华人民共和国著作权法",
    publisher: "国家版权局",
    url: "https://www.ncac.gov.cn/xxfb/flfg/flfg_532/202103/t20210309_50530.html",
    publicationDate: "2021-03-09",
    sourceVersion: "2020-11-11 第三次修正文本；国家版权局页面 2021-03-09",
    locator: "第三条、第四条、第十条、第二十四条、第二十六条至第三十条",
    accessStatus: "reachable_on_check_date" as const,
    sourceByteHash: null,
    rightsNote,
  },
  aiLabel: {
    sourceId: "source-cac-ai-labeling-measures-2025",
    title: "关于印发《人工智能生成合成内容标识办法》的通知",
    publisher: "中央网络安全和信息化委员会办公室",
    url: "https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm",
    publicationDate: "2025-03-14",
    sourceVersion: "网信办 2025-03-14 发布页面及办法正文",
    locator: "办法正文：显式标识、隐式标识、服务提供者与用户声明相关条款",
    accessStatus: "reachable_on_check_date" as const,
    sourceByteHash: null,
    rightsNote,
  },
  statistics: {
    sourceId: "source-stats-statistics-law-2024",
    title: "中华人民共和国统计法（2024年修订）",
    publisher: "国家统计局",
    url: "https://www.stats.gov.cn/gk/tjfg/tjfl/202410/P020241211632705411409.pdf",
    publicationDate: "2024-10",
    sourceVersion: "统计法 2024 修订官方 PDF；原件已由主控取证，条款仍待专业复核",
    locator: "统计资料真实性、统计调查、公布与法律责任相关条款",
    accessStatus: "reachable_on_check_date" as const,
    sourceByteHash: null,
    rightsNote,
  },
} satisfies Record<string, ProfessionalSourceRecord>;

type KnowledgeDraft = Omit<ProfessionalTrainingKnowledgeRecord, "contentHash">;

function knowledge(draft: KnowledgeDraft): ProfessionalTrainingKnowledgeRecord {
  return { ...draft, contentHash: hashCanonical(draft) };
}

const fact = (
  knowledgeId: string,
  topic: string,
  source: ProfessionalSourceRecord,
  teachingSummary: string,
  applicableSectionIds: readonly string[],
  applicableConditions: readonly string[],
  counterExamples: readonly string[],
  executableDisposal: readonly string[],
  factBoundary: string,
): ProfessionalTrainingKnowledgeRecord => knowledge({
  schemaVersion: ProfessionalTrainingKnowledgeSchemaVersion,
  knowledgeId,
  topic,
  teachingSummary,
  applicableSectionIds,
  source,
  applicableConditions,
  counterExamples,
  executableDisposal,
  factBoundary,
  reviewStatus: "pending_expert_review",
  reviewNote: pendingReviewNote,
});

export const professionalTrainingKnowledgeRecords = deepFreeze([
  fact("pt-k001-audience-public-value", "选题受众与公共价值", sources.moe, "先说明目标受众的信息需要和公共价值，再决定内容形态、渠道与制作成本。", ["pt-planning", "pt-editorial"], ["受众需求可被具体描述", "选题涉及公共信息或职业任务"], ["只用热度、播放量或个人兴趣替代受众问题", "把宣传口号当成事实结论"], ["写出受众、问题、公共价值三项说明", "为每项事实建立来源或待核标记"], "教学改写；来源只支持专业课程与典型任务方向，不直接规定具体课程评分。"),
  fact("pt-k002-typical-work-task", "典型岗位任务链", sources.moe, "融媒体岗位任务应能连接策划、采集、制作、审核、发布与复盘，而不是只完成一张静态表单。", ["pt-planning", "pt-editorial", "pt-publish"], ["任务需要跨步骤交付", "成果会被后续岗位使用"], ["把点击完成当作岗位能力", "把一个字段拆成多个虚假任务"], ["列出前置、交付物、责任人和下一步用途", "保留中间版本与退回原因"], "教学改写；不宣称教育部标准已经核验本项目的全部岗位设计。"),
  fact("pt-k003-production-publish", "视听内容制作发布闭环", sources.moe, "制作任务应同时写清事实、镜头或声音目的、交付格式、审核门和发布后反馈。", ["pt-editorial", "pt-distribution"], ["存在文字、图片、音频或视频等多模态交付", "有明确审核与发布责任"], ["用气氛画面替代事实镜头", "只改平台尺寸而不复核主张与标识"], ["建立素材台账和版本差异", "发布前逐项复核事实、权利、标识与平台格式"], "教学改写；来源支持工作任务方向，不证明任何具体素材已经获授权。"),
  fact("pt-k004-situated-project", "真实项目与情境式训练", sources.moe, "训练任务应围绕典型岗位工作和可观察交付组织，并把仿真事实与公开事实分开。", ["pt-planning", "pt-editorial"], ["学生需要在不完整信息下作职业决定", "结果可由教师按证据复核"], ["把剧情隐藏事实写成现实人物事实", "用模型答案替代学生操作"], ["给每项仿真事实加 simulation 边界", "把学生操作、模型建议和教师决定分开记录"], "教学设计原则；不冒充正式专业群认定或校内教师意见。"),
  fact("pt-k005-multimedia-role-loop", "全媒体运营岗位工作闭环", sources.mohrss, "全媒体工作要把信息加工、渠道匹配、分发传播和反馈调整连接起来。", ["pt-planning", "pt-distribution", "pt-metrics"], ["同一主张需要适配多个媒介", "不同渠道有不同受众与格式"], ["把多平台复制当作多平台运营", "把渠道数据直接当作事实质量"], ["维护主张与版本映射", "记录渠道、时间窗、指标口径和调整依据"], "教学改写；来源提供职业功能方向，不提供本课程的固定五步流程。"),
  fact("pt-k006-content-distribution", "内容加工与渠道匹配", sources.mohrss, "渠道选择应由受众、内容目的和素材条件共同决定，短视频、直播、图文和客户端不是互相替代的同一交付。", ["pt-distribution"], ["至少有两个候选渠道", "每个渠道存在长度、比例或交互差异"], ["先选平台再硬改事实", "为追求热词删除来源和限定条件"], ["先冻结事实主张，再生成渠道版本", "记录删改字段和平台理由"], "教学改写；不将平台推荐算法或流量指标写成职业标准原文。"),
  fact("pt-k007-metrics-quality-boundary", "运营指标与内容质量边界", sources.mohrss, "触达、观看、互动和转化只能描述统计窗口内的传播结果，不能单独证明真实性、公共价值或专业质量。", ["pt-metrics"], ["指标有明确时间窗、平台和分母", "结论需要与内容证据交叉核对"], ["用播放量推断事实正确", "用单个平台数据代表全网或长期效果"], ["保留指标口径和抓取时间", "把传播指标与事实/版权/编辑评价分栏"], "教学改写；不把运营数据当成学生能力分数。"),
  fact("pt-k008-coordination-handoff", "跨岗位协作交接", sources.mohrss, "交接必须包含来源、当前版本、未决问题、授权边界和下一责任人，而不是只转发一个文件。", ["pt-editorial", "pt-distribution"], ["至少两个岗位共同处理素材或稿件", "后续责任依赖交接信息"], ["只交文件名不交版本", "把口头承诺写成已完成回执"], ["生成交接单和待办清单", "失败或撤回时把责任与依据留痕"], "教学改写；交接结构是本课训练设计，不是法律义务。"),
  fact("pt-k009-accuracy-comprehensiveness", "真实准确全面客观", sources.journalists, "报道结论应区分已核事实、当事人观点、记者观察与待核线索，不能用单一叙述覆盖相关方。", ["pt-interview", "pt-fact-check"], ["主张影响公众理解或决定", "存在多个相关方或冲突说法"], ["把网络热帖当成事实", "只采访支持预设结论的一方"], ["列出主张—来源—状态表", "为缺失相关方设置追问或暂缓发布"], "来源条款的教学转译；不复制长文，不替专业教师完成外审。"),
  fact("pt-k010-source-verification", "网络线索与转载核验", sources.journalists, "网络信息、手机信息和社会来稿先作为线索，发布前要回到首发来源、原始文件或相关方核验。", ["pt-source", "pt-fact-check"], ["线索可追溯到具体 URL、文件或联系人", "发布结论需要独立支持"], ["热搜、群聊或模型回答直接入稿", "转载只核标题不核原文与时效"], ["记录首发来源、访问时间和定位", "无法核验时标待核并降低发布范围"], "来源事实与项目训练规则分开；“两来源”是本课训练设计，不是通用法规。"),
  fact("pt-k011-interview-record", "采访记录与引语边界", sources.journalists, "采访记录应区分原话、转述、记者概括和未确认内容；引语不得把记者解释伪装成受访者原话。", ["pt-interview", "pt-field-record"], ["存在录音、笔记或可复核采访材料", "引语会影响事实判断"], ["删掉限定词或把概括加引号", "用系统摘要替代原始记录"], ["保留时间码或笔记定位", "标出不清晰处并向受访者确认"], "教学改写；不声称本项目已获得真实采访对象授权。"),
  fact("pt-k012-correction-duty", "更正与投诉闭环", sources.journalists, "发布后的投诉或新证据应触发核查、更正、通知和版本保留，而不是静默删除旧稿。", ["pt-correction", "pt-editorial"], ["新证据改变既有主张", "读者或权利人提出可核查异议"], ["只改当前页面不留历史", "把投诉本身当作事实结论"], ["冻结旧版和证据", "公开更正范围、原因和下一核验时间"], "教学改写；更正流程为职业训练设计，不构成法律意见。"),
  fact("pt-k013-work-types-rights", "作品类型与权利对象", sources.copyright, "文字、口述、摄影和视听成果的权利对象不同，素材台账不能只写“网上找到”或“AI生成”。", ["pt-rights"], ["素材具有独创表达或可识别权利人", "作品会被复制、改编或网络传播"], ["把单纯事实消息和摄影作品一并视为无权利", "把水印当成完整权属证明"], ["记录作者/权利人、作品类型和来源", "对不确定权属保留限制与补证动作"], "对法律条文的教学改写；不替具体案件作侵权结论。"),
  fact("pt-k014-permission-scope", "许可合同的范围字段", sources.copyright, "使用他人作品时至少核对权利种类、专有/非专有、地域、期限、报酬和违约约定。", ["pt-rights", "pt-publish"], ["发布方式超出原始收集目的", "素材含人物、音乐或第三方作品"], ["只取得“可以用”口头回复", "把一次课程授权扩展到公开商业发布"], ["建立许可字段表", "缺任何关键范围就改用替代素材或暂停发布"], "对应著作权法许可合同条款的教学转译；具体许可需真实合同。"),
  fact("pt-k015-limitation-not-free", "合理使用与用途边界", sources.copyright, "学习、评论、新闻报道或课堂教学的法定限制有条件和范围，不能被简化成任意复制、公开或长期保存。", ["pt-rights", "pt-editorial"], ["使用目的属于法律列举场景", "使用量、必要性和公开范围可解释"], ["把教学内部使用当成全平台发布许可", "大段复制原文或整套媒体"], ["只保留必要短引与出处", "公开发布前重新核对许可和替代方案"], "来源条文边界；本课不输出法律意见或自动判定侵权。"),
  fact("pt-k016-photography-av", "摄影与视听素材的权利链", sources.copyright, "摄影、录音录像和传播权需要分别记录，素材原件所有权不等同于作品著作权或网络传播许可。", ["pt-rights", "pt-field-record"], ["素材含可识别人物、声音或第三方创作", "需要跨平台剪辑或再发布"], ["购买文件后默认获得全部权利", "只保留成片而丢失原始授权"], ["绑定原件 hash、版本和授权凭据", "撤回时冻结历史版本并停止新增传播"], "教学改写；不得以自动 hash 证明权利归属。"),
  fact("pt-k017-ai-explicit-label", "生成合成内容显式标识", sources.aiLabel, "生成或合成的图片、音频、视频和虚拟场景应按适用规则设置可感知标识，并把标识当作发布检查项。", ["pt-rights", "pt-publish"], ["内容经过生成、合成、显著修改或混合处理", "发布端需要向公众说明来源"], ["只写“AI辅助”而不说明内容范围", "为美观删除显式标识"], ["记录生成步骤、版本和显式标识位置", "缺标识时阻止公开发布"], "来源办法与课程改写分栏；不宣称已完成平台合规审核。"),
  fact("pt-k018-ai-implicit-metadata", "生成内容隐式标识与元数据", sources.aiLabel, "隐式标识和内容元数据是来源链的一部分，转码、导出和平台适配可能改变其完整性。", ["pt-rights", "pt-distribution"], ["素材经过转码、裁切、压缩或跨平台导出", "可检查文件元数据或处理回执"], ["把截图水印当成完整隐式标识", "导出后不核对元数据是否保留"], ["保存原件与派生版本 hash", "在发布前记录元数据检查结果"], "教学改写；无法读取元数据时保持未知，不自动判定合规。"),
  fact("pt-k019-ai-user-declaration", "用户声明与平台提示", sources.aiLabel, "发布合成内容时，用户声明、服务提供者标识和平台提示应分别记录，不用其中一项替代其他治理动作。", ["pt-publish", "pt-rights"], ["用户参与生成或发布", "目标平台要求声明或提示"], ["把版权许可当成 AI 标识替代", "用模型判断代替用户实际声明"], ["收集声明回执和适用规则版本", "声明缺失时降级为人工复核"], "来源办法的课程转译；具体平台规则需要另行登记版本。"),
  fact("pt-k020-ai-provenance", "生成过程来源账本", sources.aiLabel, "提示词、工具、参数、输入素材、筛选和后期修改应形成可追溯账本，不能只写“AI生成”。", ["pt-rights", "pt-editorial"], ["内容有生成或辅助生成步骤", "后续权利或更正需要回放过程"], ["只保存最终文件", "用模型摘要补写不存在的生成记录"], ["按步骤保存输入/输出版本", "不确定字段标未知并禁止自动补齐"], "课程过程记录策略；不替代权利人证明或教师复核。"),
  fact("pt-k021-statistical-definition", "统计指标定义与口径", sources.statistics, "统计数字必须连同指标定义、调查对象、时间窗、地域和单位解释，避免用同名数字拼接成新结论。", ["pt-metrics", "pt-fact-check"], ["稿件引用统计数字或比例", "不同来源的指标口径可能不同"], ["把年度客流写成实时客流", "把样本比例写成总体事实"], ["保存原始表格定位和口径字段", "不一致时并列展示或暂缓结论"], "统计法资料的教学改写；不构成统计调查或法律意见。"),
  fact("pt-k022-statistical-source", "统计数据来源与记录", sources.statistics, "统计结论需要可追溯到调查、记录或公布来源，记者应保留访问日期和版本而不是只留截图。", ["pt-source", "pt-metrics"], ["数字会进入标题、导语或公共服务指引", "数据可能被更新或撤回"], ["只引用二次转述", "缺来源时让模型补一条官方链接"], ["登记来源 URL、发布机构、版本和定位", "来源失效时标记历史并重新核查"], "教学改写；不伪造官方统计来源或校内数据。"),
  fact("pt-k023-statistical-release", "统计发布与解释边界", sources.statistics, "公布统计信息时要区分原始数值、计算结果、记者解释和预测，不能把解释写成统计机构原话。", ["pt-editorial", "pt-metrics", "pt-publish"], ["稿件同时包含数据与推断", "读者可能据此作公共决策"], ["把相关性写成因果", "把记者推算写成官方发布"], ["在稿件中分栏标注数值/计算/解释", "保留计算公式和输入版本"], "课程训练规则，不宣称统计机构认可本项目算法。"),
  fact("pt-k024-statistical-correction", "统计错误更正与版本", sources.statistics, "统计数据修订、错误或口径变化要触发版本更新和公开更正，旧版引用不能静默漂移。", ["pt-correction", "pt-metrics"], ["来源发布新版本或更正通知", "旧稿仍被转载或用于训练"], ["只改数据库当前值", "让历史截图继续看似有效"], ["保留旧版 hash 与新版本关联", "在受影响作品和渠道发布更正"], "教学改写；具体统计责任需由专业人员和来源机构判断。"),
] as readonly ProfessionalTrainingKnowledgeRecord[]);

const rule = (ruleId: string, statement: string) => ({ ruleId, ruleType: "course_training_design" as const, statement });

export const professionalTrainingTasks = deepFreeze([
  { taskId: "pt-task-01-topic-plan", title: "把岗位问题转成可核验选题", workflowPhase: "planning", competencyRefs: ["audience_analysis", "public_value"], knowledgeIds: ["pt-k001-audience-public-value", "pt-k002-typical-work-task", "pt-k004-situated-project"], courseSectionRefs: ["xunpu-topic-brief"], artifacts: ["artifact-topic-brief"], rubricDimensions: ["criterion-editorial-judgment"], collaborationRoles: ["reporter", "editor"], trainingRules: [rule("pt-rule-two-supports", "本课训练设计：关键公共主张至少准备两条相互独立的支持路径；该规则不是通用法规。")] },
  { taskId: "pt-task-02-source-map", title: "建立来源地图与版本记录", workflowPhase: "source", competencyRefs: ["source_judgment", "traceability"], knowledgeIds: ["pt-k009-accuracy-comprehensiveness", "pt-k010-source-verification", "pt-k022-statistical-source"], courseSectionRefs: ["xunpu-source-map"], artifacts: ["artifact-source-matrix"], rubricDimensions: ["criterion-fact-verification"], collaborationRoles: ["reporter", "fact_checker"], trainingRules: [rule("pt-rule-status-first", "本课训练设计：来源时效和适用范围先于主题相关性。"), rule("pt-rule-two-sources", "本课训练设计：关键事实至少登记两条独立支持路径；不冒充法律或行业硬性条文。")] },
  { taskId: "pt-task-03-interview-plan", title: "设计多方采访与同意说明", workflowPhase: "interview", competencyRefs: ["interview_communication", "consent_boundary"], knowledgeIds: ["pt-k009-accuracy-comprehensiveness", "pt-k011-interview-record", "pt-k016-photography-av"], courseSectionRefs: ["xunpu-interview-plan"], artifacts: ["artifact-interview-plan-log"], rubricDimensions: ["criterion-interview-consent"], collaborationRoles: ["reporter", "editor"], trainingRules: [rule("pt-rule-question-revision", "本课训练设计：采访计划必须包含一个基于新证据的追问。 ")] },
  { taskId: "pt-task-04-field-record", title: "采集现场记录与素材台账", workflowPhase: "field_record", competencyRefs: ["field_observation", "media_provenance"], knowledgeIds: ["pt-k003-production-publish", "pt-k011-interview-record", "pt-k016-photography-av", "pt-k020-ai-provenance"], courseSectionRefs: ["xunpu-field-reporting"], artifacts: ["artifact-interview-plan-log"], rubricDimensions: ["criterion-fact-verification", "criterion-rights-governance"], collaborationRoles: ["reporter", "rights_reviewer"], trainingRules: [rule("pt-rule-source-on-capture", "本课训练设计：每个进入作品的素材必须在采集时登记来源与用途。 ")] },
  { taskId: "pt-task-05-fact-check", title: "核验事实、统计与引语", workflowPhase: "fact_check", competencyRefs: ["fact_verification", "data_reasoning"], knowledgeIds: ["pt-k009-accuracy-comprehensiveness", "pt-k010-source-verification", "pt-k021-statistical-definition", "pt-k023-statistical-release"], courseSectionRefs: ["xunpu-fact-check"], artifacts: ["artifact-fact-check-sheet"], rubricDimensions: ["criterion-fact-verification"], collaborationRoles: ["reporter", "fact_checker", "editor"], trainingRules: [rule("pt-rule-unresolved", "本课训练设计：无法核验的主张保持待核，不以模型置信度转为事实。 ")] },
  { taskId: "pt-task-06-rights-ai", title: "分开处理版权、肖像、个人信息与 AI 标识", workflowPhase: "rights", competencyRefs: ["rights_judgment", "ai_provenance"], knowledgeIds: ["pt-k013-work-types-rights", "pt-k014-permission-scope", "pt-k017-ai-explicit-label", "pt-k018-ai-implicit-metadata", "pt-k019-ai-user-declaration"], courseSectionRefs: ["xunpu-fact-check"], artifacts: ["artifact-rights-ledger"], rubricDimensions: ["criterion-rights-governance"], collaborationRoles: ["reporter", "rights_reviewer", "editor"], trainingRules: [rule("pt-rule-separate-rights", "本课训练设计：版权、肖像/个人信息和 AI 标识分开作判断，不用单一水印或许可替代其他检查。 ")] },
  { taskId: "pt-task-07-editorial-revision", title: "按证据完成稿件编辑与修订", workflowPhase: "editing", competencyRefs: ["editorial_independence", "revision_trace"], knowledgeIds: ["pt-k001-audience-public-value", "pt-k002-typical-work-task", "pt-k009-accuracy-comprehensiveness", "pt-k023-statistical-release"], courseSectionRefs: ["xunpu-story-revision"], artifacts: ["artifact-feature-story"], rubricDimensions: ["criterion-editorial-judgment", "criterion-fact-verification"], collaborationRoles: ["reporter", "editor", "fact_checker"], trainingRules: [rule("pt-rule-no-hidden-edit", "本课训练设计：每次重要删改都要能回指主张、来源或风险处置，不静默覆盖学生原稿。 ")] },
  { taskId: "pt-task-08-multiplatform", title: "生成多平台版本并保持事实一致", workflowPhase: "distribution", competencyRefs: ["platform_adaptation", "claim_consistency"], knowledgeIds: ["pt-k003-production-publish", "pt-k005-multimedia-role-loop", "pt-k006-content-distribution", "pt-k017-ai-explicit-label"], courseSectionRefs: ["xunpu-story-revision"], artifacts: ["artifact-multiplatform-package"], rubricDimensions: ["criterion-multiplatform-production"], collaborationRoles: ["reporter", "editor", "platform_operator"], trainingRules: [rule("pt-rule-one-fact-base", "本课训练设计：所有平台版本共享同一冻结事实底座，渠道差异只能改变表达与格式。 ")] },
  { taskId: "pt-task-09-metrics-review", title: "解释运营数据而不夸大结论", workflowPhase: "metrics", competencyRefs: ["metrics_reasoning", "public_interpretation"], knowledgeIds: ["pt-k005-multimedia-role-loop", "pt-k007-metrics-quality-boundary", "pt-k021-statistical-definition", "pt-k022-statistical-source"], courseSectionRefs: ["xunpu-publish-review"], artifacts: ["artifact-transfer-reflection"], rubricDimensions: ["criterion-recovery-transfer"], collaborationRoles: ["reporter", "platform_operator", "editor"], trainingRules: [rule("pt-rule-window", "本课训练设计：每条运营结论必须写明统计窗口、平台和下一次核验动作。 ")] },
  { taskId: "pt-task-10-publish-correct", title: "完成发布门、交接与更正", workflowPhase: "correction", competencyRefs: ["publish_governance", "correction_strategy", "handoff"], knowledgeIds: ["pt-k008-coordination-handoff", "pt-k012-correction-duty", "pt-k015-limitation-not-free", "pt-k024-statistical-correction"], courseSectionRefs: ["xunpu-publish-review"], artifacts: ["artifact-publication-correction-decision", "artifact-transfer-reflection"], rubricDimensions: ["criterion-recovery-transfer", "criterion-rights-governance"], collaborationRoles: ["reporter", "editor", "rights_reviewer", "platform_operator"], trainingRules: [rule("pt-rule-teacher-gate", "本课训练设计：高风险发布、重大更正和权利缺口进入教师复核门，不由模型或学生客户端单独放行。 ")] },
] as readonly ProfessionalTrainingTask[]);

export const professionalTrainingPackage: ProfessionalTrainingPackage = deepFreeze({
  schemaVersion: ProfessionalTrainingSchemaVersion,
  packageId: "professional-media-reporter-training",
  title: "融媒体采编记者专业训练包（独立候选）",
  primaryRole: "integrated_media_reporter",
  knowledgeRecords: professionalTrainingKnowledgeRecords,
  tasks: professionalTrainingTasks,
  reviewBoundary: "知识与教学改写均待融媒体专业教师复核；浙传资源、正式专业群名称和教师签收不在本包中虚构。",
});

export interface ProfessionalTrainingValidationIssue {
  code: string;
  path: string;
  message: string;
}

export function validateProfessionalTrainingPackage(
  value: ProfessionalTrainingPackage = professionalTrainingPackage,
): { valid: boolean; issues: ProfessionalTrainingValidationIssue[] } {
  const issues: ProfessionalTrainingValidationIssue[] = [];
  const knowledgeIds = new Set<string>();
  const taskIds = new Set<string>();
  for (const [index, record] of value.knowledgeRecords.entries()) {
    if (knowledgeIds.has(record.knowledgeId)) issues.push({ code: "duplicate_knowledge_id", path: `knowledgeRecords.${index}`, message: record.knowledgeId });
    knowledgeIds.add(record.knowledgeId);
    if (record.reviewStatus !== "pending_expert_review") issues.push({ code: "review_status", path: `knowledgeRecords.${index}`, message: "knowledge must remain pending_expert_review" });
    if (!/^https:\/\//u.test(record.source.url)) issues.push({ code: "source_url", path: `knowledgeRecords.${index}`, message: "source must be HTTPS" });
    if (!record.source.locator.trim()) issues.push({ code: "source_locator", path: `knowledgeRecords.${index}`, message: "source locator is required" });
    const { contentHash: _contentHash, ...draft } = record;
    if (hashCanonical(draft) !== record.contentHash) issues.push({ code: "knowledge_hash", path: `knowledgeRecords.${index}`, message: "content hash mismatch" });
  }
  for (const [index, task] of value.tasks.entries()) {
    if (taskIds.has(task.taskId)) issues.push({ code: "duplicate_task_id", path: `tasks.${index}`, message: task.taskId });
    taskIds.add(task.taskId);
    for (const knowledgeId of task.knowledgeIds) {
      if (!knowledgeIds.has(knowledgeId)) issues.push({ code: "unknown_knowledge", path: `tasks.${index}`, message: knowledgeId });
    }
    if (task.knowledgeIds.length === 0 || task.artifacts.length === 0 || task.rubricDimensions.length === 0) {
      issues.push({ code: "task_depth", path: `tasks.${index}`, message: "task must map knowledge, artifact and rubric" });
    }
    for (const ruleItem of task.trainingRules) {
      if (ruleItem.ruleType !== "course_training_design") issues.push({ code: "rule_boundary", path: `tasks.${index}`, message: "training rule must be identified as course design" });
    }
  }
  return { valid: issues.length === 0, issues };
}
