import { createKnowledgeRecord, deepFreeze } from "./canonical.js";
import {
  KnowledgeRecordSchemaVersion,
  type KnowledgeRecordDraft,
  type PublicSource,
} from "./types.js";

const accessedAt = "2026-08-09";
const pendingReviewNote =
  "已在 2026-08-09 核对官方页面、版本和定位；教学转译尚待融媒体专业教师复核。";

type SourceBase = Omit<PublicSource, "locator">;

function source(base: SourceBase, locator: string): PublicSource {
  return { ...base, locator };
}

const xunpuTechniqueStandard: SourceBase = {
  sourceId: "source-quanzhou-xunpu-technique-standard-2024",
  title: "非物质文化遗产 蟳埔女习俗 簪花围技艺",
  publisher: "泉州市市场监督管理局、泉州市文化广电和旅游局",
  url: "https://scjgj.quanzhou.gov.cn/xxgk/zfxxgk/fdzdgknr/ywgz/202407/P020240722394947013233.pdf",
  publicationDate: "2024-07-17",
  accessedAt,
  sourceVersion: "DB 3505/T 16-2024（2024-10-17 实施）",
  publicationStatus: "current",
  accessStatus: "reachable_on_check_date",
  storedExcerpt: null,
  rightsNote: "仅保存标准元数据、条款定位和改写教学摘要；PDF、图片与图示不复制进仓库。",
};

const xunpuInnovationCase: SourceBase = {
  sourceId: "source-fujian-xunpu-innovation-case-2024",
  title: "福建泉州簪花围入选“2024十大文旅经济创新案例”",
  publisher: "福建省文化和旅游厅",
  url: "https://wlt.fujian.gov.cn/wldt/btdt/202412/t20241209_6589570.htm",
  publicationDate: "2024-11-30",
  accessedAt,
  sourceVersion: "福建省文旅厅页面发布日期 2024-11-30",
  publicationStatus: "current",
  accessStatus: "reachable_on_check_date",
  storedExcerpt: null,
  rightsNote: "仅保存页面元数据、段落定位和改写教学摘要；页面图片不复制进仓库。",
};

const fengzeEconomyCase: SourceBase = {
  sourceId: "source-fujian-fengze-tourism-economy-2024",
  title: "文旅经济工作正向激励县（市、区）：做强文旅经济做靓“花YOUNG丰泽”",
  publisher: "福建省文化和旅游厅",
  url: "https://wlt.fujian.gov.cn/zwgk/ztzl/fjswljjfzdh/cgzs/xywljjgzzxjl/202404/t20240413_6428130.htm",
  publicationDate: "2024-04-13",
  accessedAt,
  sourceVersion: "福建省文旅厅页面发布日期 2024-04-13",
  publicationStatus: "current",
  accessStatus: "reachable_on_check_date",
  storedExcerpt: null,
  rightsNote: "仅保存页面元数据、段落定位和改写教学摘要；页面图片不复制进仓库。",
};

const xunpuLogoCase: SourceBase = {
  sourceId: "source-fujian-xunpu-logo-2024",
  title: "泉州“蟳埔LOGO”全球发布！",
  publisher: "福建省文化和旅游厅（来源：海丝泉州文旅之声）",
  url: "https://wlt.fujian.gov.cn/wldt/sxdt/202407/t20240730_6491711.htm",
  publicationDate: "2024-07-30",
  accessedAt,
  sourceVersion: "福建省文旅厅页面发布日期 2024-07-30",
  publicationStatus: "current",
  accessStatus: "reachable_on_check_date",
  storedExcerpt: null,
  rightsNote: "仅保存品牌发布事实和页面定位；LOGO 与页面图片不复制、不预设可授权使用。",
};

const xunpuServiceStatusCase: SourceBase = {
  sourceId: "source-fujian-xunpu-service-standard-status-2024",
  title: "蟳埔簪花围有了行业规范",
  publisher: "福建省人民政府门户网站（来源：福建日报）",
  url: "https://www.fujian.gov.cn/zwgk/ztzl/sxzygwzxsgzx/sdjj/wvjj/202404/t20240430_6442136.htm",
  publicationDate: "2024-04-30",
  accessedAt,
  sourceVersion: "页面发布日期 2024-04-30；当前页面明确标注“废止，失效”",
  publicationStatus: "historical_status_marker",
  accessStatus: "reachable_on_check_date",
  storedExcerpt: null,
  rightsNote: "仅作为识别来源时效状态的训练材料，不作为现行服务规范依据；图片不复制。",
};

const intangibleHeritageLaw: SourceBase = {
  sourceId: "source-npc-intangible-cultural-heritage-law-2011",
  title: "中华人民共和国非物质文化遗产法",
  publisher: "全国人民代表大会常务委员会",
  url: "https://www.npc.gov.cn/npc/c2/c12435/c12488/201905/t20190522_70066.html",
  publicationDate: "2011-02-25",
  accessedAt,
  sourceVersion: "2011-02-25 通过，2011-06-01 施行版",
  publicationStatus: "current",
  accessStatus: "reachable_on_check_date",
  storedExcerpt: null,
  rightsNote: "保存法律元数据、条款号和改写教学摘要，不保存大段法条原文。",
};

const falseNewsRules: SourceBase = {
  sourceId: "source-nppa-false-news-rules-2011",
  title: "关于严防虚假新闻报道的若干规定",
  publisher: "国家新闻出版署主办中国记者网",
  url: "https://press.nppa.gov.cn/zcfg/202312/t20231205_820779_m.html",
  publicationDate: "2011-10-14",
  accessedAt,
  sourceVersion: "新出政发〔2011〕14号；中国记者网 2023-07-27 页面版",
  publicationStatus: "current",
  accessStatus: "reachable_on_check_date",
  storedExcerpt: null,
  rightsNote: "保存规范元数据、条款定位和改写教学摘要，不保存大段原文。",
};

const internetNewsRules: SourceBase = {
  sourceId: "source-cac-internet-news-rules-2017",
  title: "互联网新闻信息服务管理规定",
  publisher: "国家互联网信息办公室",
  url: "https://www.cac.gov.cn/2017-05/02/c_1120902760.htm",
  publicationDate: "2017-05-02",
  accessedAt,
  sourceVersion: "国家互联网信息办公室令第1号，2017-06-01 施行版",
  publicationStatus: "current",
  accessStatus: "reachable_on_check_date",
  storedExcerpt: null,
  rightsNote: "保存规范元数据、条款定位和改写教学摘要，不保存大段原文。",
};

const photographyCopyrightRules: SourceBase = {
  sourceId: "source-ncac-photography-copyright-2020",
  title: "国家版权局关于规范摄影作品版权秩序的通知",
  publisher: "国家版权局",
  url: "https://www.ncac.gov.cn/xxfb/flfg/gfxwj/202006/t20200611_50562.html",
  publicationDate: "2020-05-20",
  accessedAt,
  sourceVersion: "国版发〔2020〕1号",
  publicationStatus: "current",
  accessStatus: "reachable_on_check_date",
  storedExcerpt: null,
  rightsNote: "保存通知元数据、条款定位和改写教学摘要；不复制任何摄影作品。",
};

const moeMediaStandard: SourceBase = {
  sourceId: "source-moe-media-technology-operation-standard-2025",
  title: "融媒体技术与运营专业教学标准（高等职业教育专科）",
  publisher: "中华人民共和国教育部",
  url: "https://www.moe.gov.cn/s78/A07/zcs_ztzl/2017_zt06/17zt06_bznr/bznr_zyjyzyjxbz/gdzyjy_zk/zk_xwcbdl/xwcbdl_gbysl/202502/P020250207548141306012.pdf",
  publicationDate: "2025-02-07",
  accessedAt,
  sourceVersion: "职业教育专业教学标准 2025 年修（制）订版，专业代码 560213",
  publicationStatus: "current",
  accessStatus: "reachable_on_check_date",
  storedExcerpt: null,
  rightsNote: "仅保存标准元数据、页码定位和改写教学摘要；PDF 不复制进仓库。",
};

const allMediaOccupationStandard: SourceBase = {
  sourceId: "source-mohrss-all-media-operator-standard-2023",
  title: "全媒体运营师国家职业标准",
  publisher: "中华人民共和国人力资源和社会保障部",
  url: "https://www.mohrss.gov.cn/xxgk2020/fdzdgknr/rcrs_4225/jnrc/202312/W020231205397300830298.pdf",
  publicationDate: "2023-10",
  accessedAt,
  sourceVersion: "职业编码 4-13-01-05，2023 年版，2023 年 10 月第 1 版",
  publicationStatus: "current",
  accessStatus: "reachable_on_check_date",
  storedExcerpt: null,
  rightsNote: "仅保存标准元数据、页码定位和改写教学摘要；PDF 不复制进仓库。",
};

type KnowledgeInput = Omit<
  KnowledgeRecordDraft,
  "schemaVersion" | "reviewStatus" | "reviewNote" | "reusePolicy"
> & { reviewNote?: string };

function knowledge(input: KnowledgeInput) {
  const { reviewNote = pendingReviewNote, ...draft } = input;
  return createKnowledgeRecord({
    ...draft,
    schemaVersion: KnowledgeRecordSchemaVersion,
    reviewStatus: "pending_expert_review",
    reviewNote,
    reusePolicy: "metadata_link_and_paraphrase_only",
  });
}

export const xunpuKnowledgeRecords = deepFreeze([
  knowledge({
    knowledgeId: "xunpu-k001-heritage-status-boundary",
    topic: "蟳埔女习俗的名录身份与报道边界",
    teachingSummary: "蟳埔女习俗于 2008 年列入第二批国家级非物质文化遗产名录。报道时应区分“蟳埔女习俗”项目、簪花围技艺与泉州世界遗产地，不能把三个概念互换。",
    applicableSectionIds: ["xunpu-topic-brief", "xunpu-fact-check"],
    source: source(xunpuTechniqueStandard, "PDF 第4页（前置页 III）“引言”第3—5段"),
  }),
  knowledge({
    knowledgeId: "xunpu-k002-custom-and-zanhuawei-definition",
    topic: "蟳埔女习俗与簪花围术语",
    teachingSummary: "地方标准分别界定蟳埔女习俗的流传地域和簪花围的整体头饰结构。写作应以标准术语描述，而不是只用“网红头饰”替代文化主体。",
    applicableSectionIds: ["xunpu-topic-brief", "xunpu-source-map", "xunpu-story-revision"],
    source: source(xunpuTechniqueStandard, "标准正文第1页，第3.1—3.2条"),
  }),
  knowledge({
    knowledgeId: "xunpu-k003-cultural-respect",
    topic: "文化内涵优先于视觉奇观",
    teachingSummary: "簪花围技艺的基本要求首先强调尊重传统文化并了解头饰部件含义。选题、标题与镜头说明不能把社区成员客体化或把传统简化为装饰噱头。",
    applicableSectionIds: ["xunpu-topic-brief", "xunpu-interview-plan", "xunpu-story-revision"],
    source: source(xunpuTechniqueStandard, "标准正文第1—2页，第4.1—4.2条"),
  }),
  knowledge({
    knowledgeId: "xunpu-k004-technique-sequence",
    topic: "簪花围技艺流程的事实链",
    teachingSummary: "地方标准把技艺概括为材料准备、盘发、装饰、成型，并细化到工具与头饰部件。现场观察记录应按步骤记载，不能依据成片倒推未观察到的动作。",
    applicableSectionIds: ["xunpu-interview-plan", "xunpu-field-reporting", "xunpu-fact-check"],
    source: source(xunpuTechniqueStandard, "标准正文第2页，第5.1—5.2.1条及图1流程名称"),
  }),
  knowledge({
    knowledgeId: "xunpu-k005-daily-festival-difference",
    topic: "日常佩戴与节庆佩戴差异",
    teachingSummary: "花串数量会随时节、当地习俗和个人选择变化，日常与喜庆节日的常见搭配不同。单次游客体验画面不能代表所有蟳埔女性的日常状态。",
    applicableSectionIds: ["xunpu-source-map", "xunpu-field-reporting", "xunpu-fact-check"],
    source: source(xunpuTechniqueStandard, "标准正文第7页，第5.2.3.2条及注"),
  }),
  knowledge({
    knowledgeId: "xunpu-k006-documentation-and-archive",
    topic: "非遗记录与档案意识",
    teachingSummary: "地方标准建议使用文字、照片、影像和数字多媒体记录技艺、表现形式与知识，并建立保护传承档案。课程中的素材清单必须把内容、来源、授权和版本关联起来。",
    applicableSectionIds: ["xunpu-field-reporting", "xunpu-publish-review"],
    source: source(xunpuTechniqueStandard, "标准正文第15页，第7.1条"),
  }),
  knowledge({
    knowledgeId: "xunpu-k007-transmission-and-public-communication",
    topic: "传承内容与公共传播",
    teachingSummary: "传授既包括历史、制作细节和部件含义，也包括练习过程；推广可借助大众传媒和教育活动，但应服务于公众理解和保护传承，而非只追逐流量。",
    applicableSectionIds: ["xunpu-interview-plan", "xunpu-story-revision", "xunpu-publish-review"],
    source: source(xunpuTechniqueStandard, "标准正文第16页，第7.2.2—7.3.3条"),
  }),
  knowledge({
    knowledgeId: "xunpu-k008-innovation-case-selection",
    topic: "官方案例入选事实",
    teachingSummary: "官方页面记载蟳埔簪花围入选 2024 十大文旅经济创新案例。报道可将其作为传播与文旅融合背景，但不能据此推导所有经营主体均获益。",
    applicableSectionIds: ["xunpu-topic-brief", "xunpu-source-map"],
    source: source(xunpuInnovationCase, "正文第1—2段（案例发布与入选说明）"),
  }),
  knowledge({
    knowledgeId: "xunpu-k009-2024-visitor-statistics",
    topic: "2024 年游客数据的口径与时点",
    teachingSummary: "官方页面在 2024 年 11 月发布了当年以来累计游客量和单日峰值数据。使用时必须写明统计区间、发布主体和“累计/峰值”口径，不能改写成常态日均。",
    applicableSectionIds: ["xunpu-source-map", "xunpu-fact-check", "xunpu-story-revision"],
    source: source(xunpuInnovationCase, "正文第3段（“2024年以来”游客累计量与单日峰值）"),
  }),
  knowledge({
    knowledgeId: "xunpu-k010-online-reach-attribution",
    topic: "线上传播量与跨国触达的归因边界",
    teachingSummary: "官方页面同时报告线上话题量和传播至多个国家。课程把这些数据视为发布方口径，要求保留出处，禁止把话题量直接等同于独立受众或文化认同。",
    applicableSectionIds: ["xunpu-topic-brief", "xunpu-fact-check", "xunpu-publish-review"],
    source: source(xunpuInnovationCase, "正文第3段（线上话题量与跨国传播范围）"),
  }),
  knowledge({
    knowledgeId: "xunpu-k011-case-evaluation-frame",
    topic: "文旅案例评价维度的有限使用",
    teachingSummary: "案例材料介绍了创造力、传播力、引领力及多维观测框架。学生可借它设计复盘问题，但不能将案例评选指标直接替代新闻真实性、版权或文化尊重标准。",
    applicableSectionIds: ["xunpu-topic-brief", "xunpu-publish-review"],
    source: source(xunpuInnovationCase, "正文末段（报告筛选维度与观测指标说明）"),
  }),
  knowledge({
    knowledgeId: "xunpu-k012-yearly-statistics-not-interchangeable",
    topic: "不同年份数据不可拼接",
    teachingSummary: "2024 年 4 月页面给出 2023 年蟳埔接待量和话题点赞量，并描述“指挥部+公司”运作模式。它与 2024 年后续数据属于不同时间快照，必须分别标注。",
    applicableSectionIds: ["xunpu-source-map", "xunpu-fact-check"],
    source: source(fengzeEconomyCase, "“打造顶流品牌 激活新引擎”段（页面正文第107—114行）"),
  }),
  knowledge({
    knowledgeId: "xunpu-k013-logo-is-rights-bearing-asset",
    topic: "官方发布不等于素材自由使用",
    teachingSummary: "官方页面记录蟳埔 LOGO 的启用、设计征集与应用方向。报道可以说明发布事实，但若要把 LOGO 放入作品，仍需单独核验授权范围，不能从“官方发布”推断可任意复制。",
    applicableSectionIds: ["xunpu-field-reporting", "xunpu-fact-check", "xunpu-story-revision"],
    source: source(xunpuLogoCase, "正文第1段、第4—6段（启用、设计过程与应用方向）"),
  }),
  knowledge({
    knowledgeId: "xunpu-k014-source-status-over-topic-match",
    topic: "来源状态优先于主题相关性",
    teachingSummary: "福建省政府页面虽介绍簪花围服务规范，但当前页面同时标注“废止，失效”。它只能用于训练来源状态识别，不能作为现行服务规则或发布结论。",
    applicableSectionIds: ["xunpu-source-map", "xunpu-fact-check"],
    source: source(xunpuServiceStatusCase, "页面状态栏及正文第1—3段"),
    reviewNote: "页面状态已核对；该记录仅作失效来源反例，仍待专业教师确认课堂呈现方式。",
  }),
  knowledge({
    knowledgeId: "xunpu-k015-authenticity-integrity-transmission",
    topic: "非遗保护的真实性、整体性与传承性",
    teachingSummary: "非物质文化遗产法要求保护注重真实性、整体性和传承性，并要求使用时尊重形式与内涵、禁止歪曲贬损。标题、剪辑和商业化叙事都应接受这一边界检查。",
    applicableSectionIds: ["xunpu-topic-brief", "xunpu-story-revision", "xunpu-publish-review"],
    source: source(intangibleHeritageLaw, "第一章第4—5条"),
  }),
  knowledge({
    knowledgeId: "xunpu-k016-interview-consent-and-custom",
    topic: "非遗调查中的同意与习俗尊重",
    teachingSummary: "法律明确非遗调查应征得调查对象同意、尊重其风俗习惯并不得损害合法权益。课程将采访预约、用途说明和可撤回记录设为现场采集的前置证据。",
    applicableSectionIds: ["xunpu-interview-plan", "xunpu-field-reporting"],
    source: source(intangibleHeritageLaw, "第二章第14—16条，重点为第16条"),
  }),
  knowledge({
    knowledgeId: "xunpu-k017-multiple-perspectives",
    topic: "采访应覆盖相关方而非单一陈述",
    teachingSummary: "防范失实报道规范要求采访真实、准确、全面、客观，并听取事件相关方意见。课程的采访提纲须覆盖社区、传承实践者、经营者、游客和管理方的不同主张。",
    applicableSectionIds: ["xunpu-source-map", "xunpu-interview-plan"],
    source: source(falseNewsRules, "第一条第（二）—（五）项"),
  }),
  knowledge({
    knowledgeId: "xunpu-k018-network-claim-needs-verification",
    topic: "网络线索不能直接升级为事实",
    teachingSummary: "网络信息、手机信息和社会来稿在发布前需要逐一核实，转载也应核对首发来源并避免断章取义。热门短视频只作为线索，不自动成为事实证据。",
    applicableSectionIds: ["xunpu-source-map", "xunpu-fact-check"],
    source: source(falseNewsRules, "第二条第（二）—（四）项"),
  }),
  knowledge({
    knowledgeId: "xunpu-k019-correction-is-part-of-workflow",
    topic: "投诉、核查与更正闭环",
    teachingSummary: "规范要求建立投诉核查、结果反馈和失实报道更正机制。最终发布不是课程终点，复盘阶段必须能根据新证据形成版本化更正。",
    applicableSectionIds: ["xunpu-story-revision", "xunpu-publish-review"],
    source: source(falseNewsRules, "第三条第（一）—（二）项"),
  }),
  knowledge({
    knowledgeId: "xunpu-k020-republication-traceability",
    topic: "转载信息的来源可追溯",
    teachingSummary: "互联网新闻信息转载需注明来源、原作者、原标题等信息并保证可追溯。课程发布包必须保留来源链，不能只留下二次转述截图。",
    applicableSectionIds: ["xunpu-fact-check", "xunpu-story-revision", "xunpu-publish-review"],
    source: source(internetNewsRules, "第三章第15条"),
  }),
  knowledge({
    knowledgeId: "xunpu-k021-photography-permission",
    topic: "摄影作品与现场照片的权利核验",
    teachingSummary: "以新闻事件为主题的摄影作品仍可能受著作权保护，使用他人摄影作品原则上要核验许可。水印或权利声明也不能单独证明完整权属，素材清单需记录作者、授权和使用范围。",
    applicableSectionIds: ["xunpu-field-reporting", "xunpu-fact-check", "xunpu-story-revision"],
    source: source(photographyCopyrightRules, "通知第1—2条、第10条"),
  }),
  knowledge({
    knowledgeId: "xunpu-k022-real-project-scenario-teaching",
    topic: "真实项目与情境式训练",
    teachingSummary: "教育部标准要求专业核心课程围绕岗位工作内容和典型任务，并鼓励依托真实生产项目开展项目式、情境式教学。课程据此把公开案例转化为连续采编任务，而不是静态知识展示。",
    applicableSectionIds: ["xunpu-topic-brief", "xunpu-publish-review"],
    source: source(moeMediaStandard, "PDF 第3页，第8.1.2节“专业课程”第1—2段"),
  }),
  knowledge({
    knowledgeId: "xunpu-k023-integrated-production-workflow",
    topic: "融媒体制作发布的完整工作流",
    teachingSummary: "标准把热点收集筛选策划、文字声音影像加工、数据监控调整和目标受众分发列为融媒体制作发布典型任务，并包含稿件审核发布流程。七个小节共同覆盖这条链路。",
    applicableSectionIds: ["xunpu-topic-brief", "xunpu-field-reporting", "xunpu-story-revision", "xunpu-publish-review"],
    source: source(moeMediaStandard, "PDF 第7页，专业核心课程表第8项“融媒体制作发布实战”"),
  }),
  knowledge({
    knowledgeId: "xunpu-k024-all-media-job-loop",
    topic: "全媒体运营师的信息工作闭环",
    teachingSummary: "国家职业标准把全媒体运营概括为运用多种媒介技术和渠道，对信息进行加工、匹配、分发、传播与反馈，并划分创意策划、视听运营、直播运营、流量运营和数据分析方向。记者需理解协作链但不越权替代其他岗位。",
    applicableSectionIds: ["xunpu-topic-brief", "xunpu-story-revision", "xunpu-publish-review"],
    source: source(allMediaOccupationStandard, "PDF 第5页（正文第1页），第1.3—1.4节"),
  }),
]);

export const xunpuKnowledgeRecordCount = xunpuKnowledgeRecords.length;
