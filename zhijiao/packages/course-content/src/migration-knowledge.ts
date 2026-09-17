import { createKnowledgeRecord, deepFreeze } from "./canonical.js";
import {
  KnowledgeRecordSchemaVersion,
  type KnowledgeRecordDraft,
  type PublicSource,
} from "./types.js";

const accessedAt = "2026-08-09";
const pendingReviewNote =
  "已在 2026-08-09 联网核对官方或权威主来源、版本与定位；教学转译尚待融媒体专业教师复核。";
const rightsNote =
  "仅保存来源元数据、链接、定位和改写教学摘要；不复制、不保存原文全文、图片、音频、视频、标识或页面截图。";

type SourceBase = Omit<PublicSource, "locator">;

function source(base: SourceBase, locator: string): PublicSource {
  return { ...base, locator };
}

function sourceBase(input: Omit<SourceBase, "accessedAt" | "accessStatus" | "storedExcerpt" | "rightsNote">): SourceBase {
  return {
    ...input,
    accessedAt,
    accessStatus: "reachable_on_check_date",
    storedExcerpt: null,
    rightsNote,
  };
}

type KnowledgeInput = Omit<
  KnowledgeRecordDraft,
  "schemaVersion" | "reviewStatus" | "reviewNote" | "reusePolicy"
>;

function knowledge(input: KnowledgeInput) {
  return createKnowledgeRecord({
    ...input,
    schemaVersion: KnowledgeRecordSchemaVersion,
    reviewStatus: "pending_expert_review",
    reviewNote: pendingReviewNote,
    reusePolicy: "metadata_link_and_paraphrase_only",
  });
}

const villageMediaCase = sourceBase({
  sourceId: "source-neac-village-super-media-2026",
  title: "提升民族地区县级融媒体中心传播力——以贵州榕江县为例",
  publisher: "国家民族事务委员会（来源：中国民族报）",
  url: "https://www.neac.gov.cn/seac/xxgk/202607/1192641.shtml",
  publicationDate: "2026-07-21",
  sourceVersion: "国家民委信息公开页面 2026-07-21 版",
  publicationStatus: "current",
});

const villageSportsReply = sourceBase({
  sourceId: "source-sport-village-super-reply-2025",
  title: "关于政协第十四届全国委员会第三次会议第01819号提案答复的函",
  publisher: "国家体育总局",
  url: "https://www.sport.gov.cn/n315/n10702/c29055094/content.html",
  publicationDate: "2025-06-11",
  sourceVersion: "政协十四届三次会议第01819号提案答复公开版",
  publicationStatus: "current",
});

const villageGalaCase = sourceBase({
  sourceId: "source-mct-village-super-gala-2025",
  title: "贵州“村超村晚”共享民族盛宴",
  publisher: "中华人民共和国文化和旅游部（来源：贵州省文化和旅游厅）",
  url: "https://www.mct.gov.cn/whzx/qgwhxxlb/gz/202501/t20250107_957681.htm",
  publicationDate: "2025-01-07",
  sourceVersion: "文化和旅游部全国联播页面 2025-01-07 版",
  publicationStatus: "current",
});

const villageStreamerCase = sourceBase({
  sourceId: "source-mohrss-village-streamer-2024",
  title: "贵州：‘直播’乡村美好生活，‘贵州村超乡村主播’劳务品牌赋能就业增收",
  publisher: "中国就业网（中国就业培训技术指导中心）",
  url: "https://chinajob.mohrss.gov.cn/h5/c/2024-04-12/402593.shtml",
  publicationDate: "2024-04-12",
  sourceVersion: "中国就业网地方栏目 2024-04-12 页面版",
  publicationStatus: "current",
});

const moeMediaStandard = sourceBase({
  sourceId: "source-moe-media-standard-2025",
  title: "融媒体技术与运营专业教学标准（高等职业教育专科）",
  publisher: "中华人民共和国教育部",
  url: "https://www.moe.gov.cn/s78/A07/zcs_ztzl/2017_zt06/17zt06_bznr/bznr_zyjyzyjxbz/gdzyjy_zk/zk_xwcbdl/xwcbdl_gbysl/202502/P020250207548141306012.pdf",
  publicationDate: "2025-02-07",
  sourceVersion: "职业教育专业教学标准 2025 年修（制）订版，专业代码 560213",
  publicationStatus: "current",
});

const allMediaStandard = sourceBase({
  sourceId: "source-mohrss-all-media-standard-2023",
  title: "全媒体运营师国家职业标准",
  publisher: "中华人民共和国人力资源和社会保障部",
  url: "https://www.mohrss.gov.cn/xxgk2020/fdzdgknr/rcrs_4225/jnrc/202312/W020231205397300830298.pdf",
  publicationDate: "2023-10",
  sourceVersion: "职业编码 4-13-01-05，2023 年 10 月第 1 版",
  publicationStatus: "current",
});

export const villageSuperKnowledgeRecords = deepFreeze([
  knowledge({
    knowledgeId: "village-k001-platform-goal-and-audience",
    topic: "县级融媒体平台目标与受众",
    teachingSummary: "县级融媒体既承担信息传播，也服务基层治理与乡村振兴。平台地图应先写受众的信息需要和公共价值，再决定使用短视频、直播或客户端。",
    applicableSectionIds: ["village-super-platform-map"],
    source: source(villageMediaCase, "正文第20段（县级融媒体功能与短视频、直播背景）"),
  }),
  knowledge({
    knowledgeId: "village-k002-five-story-pillars",
    topic: "村超视听叙事的五类内容支柱",
    teachingSummary: "案例把竞技高光、民族文化展演、乡土生活、情感价值和文旅推广作为五类内容板块。选题应说明主叙事与辅助元素，避免把文化展演仅作比赛背景装饰。",
    applicableSectionIds: ["village-super-story-angle", "village-super-storyboard"],
    source: source(villageMediaCase, "“主要做法”第23段（五大核心板块）"),
  }),
  knowledge({
    knowledgeId: "village-k003-high-frequency-production",
    topic: "高频更新与快速响应机制",
    teachingSummary: "案例中的高频供给建立在现场捕捉、快速制作和持续分发机制上。教学中不能只追求发稿数量，必须为每条快讯保留时间、来源和更正状态。",
    applicableSectionIds: ["village-super-live-update"],
    source: source(villageMediaCase, "“主要做法”第25段（高频更新、快速响应与赛事间歇供给）"),
  }),
  knowledge({
    knowledgeId: "village-k004-tag-matrix",
    topic: "地域、赛事与情感标签组合",
    teachingSummary: "标签可承担检索、定位和议题组织功能。平台适配时应区分地域、赛事与情感标签，不用无关热词替代内容主张。",
    applicableSectionIds: ["village-super-platform-map", "village-super-platform-adaptation"],
    source: source(villageMediaCase, "“主要做法”第26段（三层话题标签矩阵）"),
  }),
  knowledge({
    knowledgeId: "village-k005-collaborative-distribution-matrix",
    topic: "主账号、自媒体与公共信号协同",
    teachingSummary: "案例通过主账号、自媒体参与和赛事公共信号形成传播矩阵。记者使用协作素材时仍需登记来源、剪辑版本和发布责任，开放信号不等于所有素材均可任意改编。",
    applicableSectionIds: ["village-super-platform-map", "village-super-live-update"],
    source: source(villageMediaCase, "“主要做法”第27段（多元传播主体与直播公共信号）"),
  }),
  knowledge({
    knowledgeId: "village-k006-feedback-and-algorithm-boundary",
    topic: "算法、互动反馈与内容判断",
    teachingSummary: "案例建议研究算法规律、用户需求和实时互动，但算法表现只能说明分发结果，不能自动证明事实质量、文化表达或公共价值。",
    applicableSectionIds: ["village-super-platform-adaptation", "village-super-data-review"],
    source: source(villageMediaCase, "“经验启示”第41段（算法驱动、用户导向与反馈机制）"),
  }),
  knowledge({
    knowledgeId: "village-k007-official-multiplatform-showcase",
    topic: "多平台集中展示与直播分发",
    teachingSummary: "国家体育总局答复材料记录了村超案例的多平台展示，以及村超村晚通过多家中央和主流平台直播。课程据此训练同一事实底座的多端版本，而不是拼接不同活动数据。",
    applicableSectionIds: ["village-super-platform-map", "village-super-platform-adaptation"],
    source: source(villageSportsReply, "答复第一部分第29—30段（多平台展示与多平台直播）"),
  }),
  knowledge({
    knowledgeId: "village-k008-live-interview-and-short-video",
    topic: "直播访谈与短视频联合叙事",
    teachingSummary: "公开案例把现场互动访谈、短视频和直播展示组合使用。脚本分镜应分别标出事实镜头、人物观点和现场气氛，不能用氛围画面替代赛事结果。",
    applicableSectionIds: ["village-super-storyboard", "village-super-live-update"],
    source: source(villageGalaCase, "正文第59—62段（直播活动、互动访谈、短视频与四篇章）"),
  }),
  knowledge({
    knowledgeId: "village-k009-community-centered-story",
    topic: "群众主体与多视角人物选择",
    teachingSummary: "案例以群众参与为原则，呈现体育、文化传承、基层治理、青年与志愿者等多类视角。故事角度应避免只使用单一宣传主体或流量人物。",
    applicableSectionIds: ["village-super-story-angle", "village-super-storyboard"],
    source: source(villageGalaCase, "正文第57—63段（群众原则、代表性人物与文化篇章）"),
  }),
  knowledge({
    knowledgeId: "village-k010-cross-platform-streaming",
    topic: "乡村主播的跨平台传播边界",
    teachingSummary: "公开材料列出短视频、直播、电商和多种社交平台的协同使用。教学只借其识别渠道差异；就业与销售数据必须保留时间和发布主体，不能当成单条内容成效。",
    applicableSectionIds: ["village-super-platform-adaptation", "village-super-data-review"],
    source: source(villageStreamerCase, "正文第72—83段（多平台宣传、直播销售与服务体系）"),
  }),
  knowledge({
    knowledgeId: "village-k011-audiovisual-production-workflow",
    topic: "视听内容策划制作工作流",
    teachingSummary: "教育部标准要求围绕典型岗位任务开展项目式、情境式教学，并覆盖视听内容策划、采集、制作与发布。分镜必须连接来源、镜头目的、声音和交付版本。",
    applicableSectionIds: ["village-super-story-angle", "village-super-storyboard"],
    source: source(moeMediaStandard, "PDF 第3页第8.1.2节及第6—7页专业核心课程表"),
  }),
  knowledge({
    knowledgeId: "village-k012-live-and-data-job-loop",
    topic: "直播运营与数据分析闭环",
    teachingSummary: "全媒体运营师标准包含创意策划、视听运营、直播运营、流量运营和数据分析方向。复盘需区分触达、观看、互动、转化与内容质量，不以单一播放量判定成功。",
    applicableSectionIds: ["village-super-live-update", "village-super-data-review"],
    source: source(allMediaStandard, "PDF 第5页第1.3—1.4节及职业技能方向说明"),
  }),
]);

const aiCopyrightCase = sourceBase({
  sourceId: "source-bjrd-ai-image-copyright-case-2024",
  title: "全国首例AI生成图片著作权案入选北京高院工作报告",
  publisher: "北京市人民代表大会常务委员会",
  url: "https://www.bjrd.gov.cn/zyfb/zt/16j2crdh2024/bgjd/lygzbg/202401/t20240123_3543208.html",
  publicationDate: "2024-01-23",
  sourceVersion: "北京市十六届人大二次会议两院工作报告解读页面",
  publicationStatus: "current",
});

const copyrightLaw = sourceBase({
  sourceId: "source-npc-copyright-law-2020",
  title: "中华人民共和国著作权法",
  publisher: "全国人民代表大会常务委员会",
  url: "https://www.npc.gov.cn/c2/c30834/202011/t20201119_308796.html",
  publicationDate: "2020-11-19",
  sourceVersion: "2020-11-11 第三次修正版，2021-06-01 施行",
  publicationStatus: "current",
});

const aiLabelingMeasures = sourceBase({
  sourceId: "source-ai-labeling-measures-2025",
  title: "人工智能生成合成内容标识办法",
  publisher: "国家互联网信息办公室、工业和信息化部、公安部、国家广播电视总局",
  url: "https://www.nrta.gov.cn/art/2025/3/14/art_113_70340.html",
  publicationDate: "2025-03-14",
  sourceVersion: "国信办通字〔2025〕2号，2025-09-01 施行版",
  publicationStatus: "current",
});

const aiLabelingInterpretation = sourceBase({
  sourceId: "source-cac-ai-labeling-interpretation-2025",
  title: "专家解读｜从标识到鉴伪：AI生成合成内容治理的技术防线与社会共治",
  publisher: "中央网络安全和信息化委员会办公室",
  url: "https://www.cac.gov.cn/2025-03/18/c_1744000070320775.htm",
  publicationDate: "2025-03-18",
  sourceVersion: "中国网信网 2025-03-18 专家解读页面版",
  publicationStatus: "current",
});

const deepSynthesisRules = sourceBase({
  sourceId: "source-cac-deep-synthesis-rules-2022",
  title: "互联网信息服务深度合成管理规定",
  publisher: "国家互联网信息办公室、工业和信息化部、公安部",
  url: "https://www.cac.gov.cn/2022-12/11/c_1672221949354811.htm",
  publicationDate: "2022-12-11",
  sourceVersion: "国家互联网信息办公室等三部门令第12号，2023-01-10 施行版",
  publicationStatus: "current",
});

const generativeAiMeasures = sourceBase({
  sourceId: "source-cac-generative-ai-measures-2023",
  title: "生成式人工智能服务管理暂行办法",
  publisher: "国家互联网信息办公室等七部门",
  url: "https://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm",
  publicationDate: "2023-07-13",
  sourceVersion: "2023-08-15 施行版",
  publicationStatus: "current",
});

const copyrightEvidenceNotice = sourceBase({
  sourceId: "source-ncac-copyright-evidence-notice-2020",
  title: "国家版权局关于进一步做好著作权行政执法证据审查和认定工作的通知",
  publisher: "国家版权局",
  url: "https://www.ncac.gov.cn/xxfb/flfg/gfxwj/202011/t20201126_50563.html",
  publicationDate: "2020-11-26",
  sourceVersion: "国版发〔2020〕2号",
  publicationStatus: "current",
});

export const aiCopyrightKnowledgeRecords = deepFreeze([
  knowledge({
    knowledgeId: "ai-k001-human-contribution-ledger",
    topic: "AI视觉生成中的人类贡献记录",
    teachingSummary: "公开案例把提示词、参数和画面选择安排作为个案判断中的人类智力投入。素材台账应保存生成工具、输入版本、参数、筛选和后期修改，而不是只写“AI生成”。",
    applicableSectionIds: ["ai-copyright-source-ledger", "ai-copyright-generation-assessment"],
    source: source(aiCopyrightCase, "正文案件介绍与法院认定段（提示词、参数、画面选择安排）"),
  }),
  knowledge({
    knowledgeId: "ai-k002-case-specific-copyright-judgement",
    topic: "AI生成物是否构成作品须个案判断",
    teachingSummary: "案例结论建立在具体创作过程和独创性投入上，不能推导所有AI图片都当然受保护或当然无权利。记者应把生成判断与权利判断分开记录。",
    applicableSectionIds: ["ai-copyright-generation-assessment", "ai-copyright-rights-check"],
    source: source(aiCopyrightCase, "正文法院认定与案件意义段"),
  }),
  knowledge({
    knowledgeId: "ai-k003-authorship-and-network-rights",
    topic: "署名权与信息网络传播权",
    teachingSummary: "著作权法列明署名权、修改权、保护作品完整权和信息网络传播权。获取网络图片不能只核验是否公开，还要核验作者、许可和传播渠道。",
    applicableSectionIds: ["ai-copyright-source-ledger", "ai-copyright-rights-check"],
    source: source(copyrightLaw, "第二章第一节第9—10条"),
  }),
  knowledge({
    knowledgeId: "ai-k004-author-and-ownership-boundary",
    topic: "作者与权利归属边界",
    teachingSummary: "著作权原则上属于作者，但职务作品、委托关系和合同约定可能改变财产权归属。视觉素材审核必须分别登记创作者、权利人和授权人。",
    applicableSectionIds: ["ai-copyright-source-ledger", "ai-copyright-rights-check"],
    source: source(copyrightLaw, "第二章第二节第11—19条"),
  }),
  knowledge({
    knowledgeId: "ai-k005-lawful-source-and-ip-duty",
    topic: "生成式AI的数据与知识产权义务",
    teachingSummary: "暂行办法要求使用具有合法来源的数据和基础模型，并不得侵害他人知识产权。生成工具的可用不等于输入素材和输出结果已取得发布授权。",
    applicableSectionIds: ["ai-copyright-source-ledger", "ai-copyright-generation-assessment", "ai-copyright-rights-check"],
    source: source(generativeAiMeasures, "第二章第7条第（一）—（二）项"),
  }),
  knowledge({
    knowledgeId: "ai-k006-generated-content-label-duty",
    topic: "生成图片和视频的标识义务",
    teachingSummary: "暂行办法要求按深度合成规定对图片、视频等生成内容进行标识。发布清单应把标识当作独立治理项，不能用版权许可替代标识。",
    applicableSectionIds: ["ai-copyright-labeling", "ai-copyright-platform-review"],
    source: source(generativeAiMeasures, "第三章第12条"),
  }),
  knowledge({
    knowledgeId: "ai-k007-explicit-and-implicit-definitions",
    topic: "显式标识与隐式标识定义",
    teachingSummary: "标识办法区分公众可明显感知的显式标识与文件数据中的隐式标识。课程要求分别检查画面提示和元数据，不把水印截图等同于完整隐式标识。",
    applicableSectionIds: ["ai-copyright-labeling"],
    source: source(aiLabelingMeasures, "第3条（生成合成内容、显式标识与隐式标识定义）"),
  }),
  knowledge({
    knowledgeId: "ai-k008-modality-label-placement",
    topic: "图片与视频显式标识位置",
    teachingSummary: "办法按文本、音频、图片、视频和虚拟场景规定显式标识方式。图片需在适当位置显著提示，视频应关注起始画面和播放周边。",
    applicableSectionIds: ["ai-copyright-labeling", "ai-copyright-platform-review"],
    source: source(aiLabelingMeasures, "第4条第（一）—（六）项"),
  }),
  knowledge({
    knowledgeId: "ai-k009-metadata-provenance",
    topic: "文件元数据中的制作要素",
    teachingSummary: "隐式标识可包含生成属性、服务提供者编码和内容编号等制作要素。跨平台转码前后应核对元数据是否保留，并保存导出版本。",
    applicableSectionIds: ["ai-copyright-source-ledger", "ai-copyright-labeling"],
    source: source(aiLabelingMeasures, "第5条（文件元数据隐式标识与制作要素）"),
  }),
  knowledge({
    knowledgeId: "ai-k010-platform-verification-and-user-declaration",
    topic: "传播平台核验与用户主动声明",
    teachingSummary: "传播服务需要结合隐式标识、用户声明和检测结果添加提示；用户发布生成合成内容也应主动声明。平台预检必须记录每一步依据。",
    applicableSectionIds: ["ai-copyright-labeling", "ai-copyright-platform-review"],
    source: source(aiLabelingMeasures, "第6条第（一）—（四）项及第10条"),
  }),
  knowledge({
    knowledgeId: "ai-k011-lifecycle-trace-and-complaint",
    topic: "生成内容全链路追溯与申诉机制",
    teachingSummary: "深度合成治理要求信息审核、日志留存、辟谣以及申诉投诉举报机制。平台审核失败或投诉出现时，应保留输入、输出、标识和发布版本关系。",
    applicableSectionIds: ["ai-copyright-platform-review", "ai-copyright-complaint-correction"],
    source: source(deepSynthesisRules, "第二章第7—10条、第三章第17—18条"),
  }),
  knowledge({
    knowledgeId: "ai-k012-complaint-evidence-preservation",
    topic: "版权投诉的权属与侵权证据",
    teachingSummary: "国家版权局通知列出底稿、合同、登记等权属材料，以及网页记录、合同和许可范围等侵权证据。投诉更正不能只删除内容，还应冻结旧版和证据。",
    applicableSectionIds: ["ai-copyright-rights-check", "ai-copyright-complaint-correction"],
    source: source(copyrightEvidenceNotice, "第一部分第1—2项、第二部分第7项、第三部分第8—11项"),
  }),
]);

const rainWarningStandard = sourceBase({
  sourceId: "source-cma-rain-warning-standard-2023",
  title: "暴雨预警信号标准",
  publisher: "中国气象局",
  url: "https://www.cma.gov.cn/2011xzt/2022zt/20220509/2014072105/202205/t20220509_4813322.html",
  publicationDate: "2023-06-17",
  sourceVersion: "中国气象局政府门户网站 2023-06-17 页面版",
  publicationStatus: "current",
});

const mctFloodSeasonTip2026 = sourceBase({
  sourceId: "source-mct-flood-season-tip-2026",
  title: "文化和旅游部端午节假期和汛期、暑期出游提示",
  publisher: "中华人民共和国文化和旅游部",
  url: "https://www.mct.gov.cn/whzx/whyw/202606/t20260605_966153.htm",
  publicationDate: "2026-06-05",
  sourceVersion: "文化和旅游部政府门户网站 2026-06-05 版",
  publicationStatus: "current",
});

const mctFloodSeasonTip2024 = sourceBase({
  sourceId: "source-mct-flood-season-tip-2024",
  title: "文化和旅游部汛期出游安全提示",
  publisher: "中华人民共和国文化和旅游部",
  url: "https://www.mct.gov.cn/whzx/whyw/202407/t20240731_954465.htm",
  publicationDate: "2024-07-31",
  sourceVersion: "文化和旅游部政府门户网站 2024-07-31 版",
  publicationStatus: "current",
});

const mctTourismSafetyNotice = sourceBase({
  sourceId: "source-mct-tourism-safety-notice-2019",
  title: "文化和旅游部办公厅关于进一步做好汛期及暑期旅游安全工作的通知",
  publisher: "中华人民共和国文化和旅游部办公厅",
  url: "https://www.mct.gov.cn/whzx/ggtz/201907/t20190715_845057.htm",
  publicationDate: "2019-07-15",
  sourceVersion: "文化和旅游部办公厅 2019-07-13 通知公开版",
  publicationStatus: "current",
});

const beijingReopenTip = sourceBase({
  sourceId: "source-beijing-scenic-reopen-tip-2023",
  title: "市文化和旅游局发布雨后景区旅游安全温馨提示",
  publisher: "北京市文化和旅游局",
  url: "https://whlyj.beijing.gov.cn/zwgk/tzgg/202308/t20230803_3213572.html",
  publicationDate: "2023-08-03",
  sourceVersion: "北京市文化和旅游局 2023-08-03 页面版",
  publicationStatus: "current",
});

const floodControlTourismNotice = sourceBase({
  sourceId: "source-mem-flood-tourism-notice-2019",
  title: "国家防总办公室、文化和旅游部联合印发通知部署加强汛期旅游安全工作",
  publisher: "中华人民共和国应急管理部",
  url: "https://www.mem.gov.cn/xw/bndt/201908/t20190807_329583.shtml",
  publicationDate: "2019-08-07",
  sourceVersion: "应急管理部新闻宣传司 2019-08-07 页面版",
  publicationStatus: "current",
});

const floodControlBriefing2026 = sourceBase({
  sourceId: "source-mem-heavy-rain-briefing-2026",
  title: "国家防总办公室、应急管理部部署重点地区强降雨防范应对工作",
  publisher: "中华人民共和国应急管理部",
  url: "https://www.mem.gov.cn/xw/yjyw/202605/t20260501_602362.shtml",
  publicationDate: "2026-05-01",
  sourceVersion: "应急管理部 2026-05-01 会商部署页面版",
  publicationStatus: "current",
});

export const rainEmergencyKnowledgeRecords = deepFreeze([
  knowledge({
    knowledgeId: "rain-k001-warning-levels-and-thresholds",
    topic: "暴雨预警等级与时间阈值",
    teachingSummary: "暴雨预警以蓝、黄、橙、红四级表示，并对应不同时间窗和降雨量阈值。快讯必须记录发布机构、等级、生效时间和影响范围，不能只写“暴雨预警”。",
    applicableSectionIds: ["rain-warning-verification", "rain-closure-brief"],
    source: source(rainWarningStandard, "暴雨预警信号标准总述及蓝、黄、橙、红四级标准"),
  }),
  knowledge({
    knowledgeId: "rain-k002-warning-defense-guidance",
    topic: "预警等级对应的防御指南",
    teachingSummary: "不同等级防御指南涉及政府响应、交通管制、停课停业和山洪地质灾害防御。记者应引用当前等级的对应指南，不跨等级拼接措施。",
    applicableSectionIds: ["rain-warning-verification", "rain-rumor-check"],
    source: source(rainWarningStandard, "四级暴雨预警各自的“防御指南”段"),
  }),
  knowledge({
    knowledgeId: "rain-k003-check-open-status-before-travel",
    topic: "景区开放状态与行程调整",
    teachingSummary: "文旅部门提示游客同时关注气象、地质灾害预警和景区开放情况。服务信息必须标明查询时点，避免把早先开放状态当作当前状态。",
    applicableSectionIds: ["rain-warning-verification", "rain-visitor-guidance"],
    source: source(mctFloodSeasonTip2026, "正文第一项“关注汛期安全”"),
  }),
  knowledge({
    knowledgeId: "rain-k004-close-and-transfer-visitors",
    topic: "强降雨下关闭景区与转移游客",
    teachingSummary: "联合通知要求强降雨时果断关闭景区并劝离、转移游客。闭园快讯应区分预警、管理决定和执行进度，不把建议性提示写成已经清场。",
    applicableSectionIds: ["rain-closure-brief", "rain-visitor-guidance"],
    source: source(floodControlTourismNotice, "通知要求段（A级景区关闭、劝离与转移游客）"),
  }),
  knowledge({
    knowledgeId: "rain-k005-multichannel-warning-release",
    topic: "多渠道发布旅游预警信息",
    teachingSummary: "文旅安全通知要求通过广播、电视、互联网、短信和电子显示屏等渠道发布预警。多平台版本可以改变篇幅，但预警等级、时间、区域和行动指引必须一致。",
    applicableSectionIds: ["rain-closure-brief", "rain-multiplatform-continuous-update"],
    source: source(mctTourismSafetyNotice, "第二部分“强化预警提示和隐患排查”第1段"),
  }),
  knowledge({
    knowledgeId: "rain-k006-evacuation-route-and-shelter",
    topic: "避险路线、安置点与人员转移",
    teachingSummary: "通知要求提前制定转移预案、启用避灾场所、标明避险路线并告知避灾地点。游客指引必须给出可执行路线和责任联系人，而非泛泛提醒“注意安全”。",
    applicableSectionIds: ["rain-visitor-guidance"],
    source: source(mctTourismSafetyNotice, "第三部分第1段（转移预案、避灾场所、路线与地点）"),
  }),
  knowledge({
    knowledgeId: "rain-k007-timely-and-accurate-reporting",
    topic: "应急值守与信息报告",
    teachingSummary: "通知要求应急通信畅通、信息报告及时准确并对重大险情第一时间上报。连续报道要维护更新时间线和未确认项，不用重复旧稿制造“实时”假象。",
    applicableSectionIds: ["rain-closure-brief", "rain-multiplatform-continuous-update"],
    source: source(mctTourismSafetyNotice, "第三部分第2段（部门联动、24小时值守与信息报告）"),
  }),
  knowledge({
    knowledgeId: "rain-k008-follow-on-site-evacuation",
    topic: "突发情形下听从现场疏散",
    teachingSummary: "汛期提示要求游客遇突发情况听从现场人员引导并有序疏散。服务稿应清楚区分官方指挥、记者观察和游客个体描述。",
    applicableSectionIds: ["rain-visitor-guidance", "rain-rumor-check"],
    source: source(mctFloodSeasonTip2024, "正文第三项“提高防范意识”"),
  }),
  knowledge({
    knowledgeId: "rain-k009-rumor-verification-boundary",
    topic: "灾情传言的核查边界",
    teachingSummary: "应急报道只能依据气象预警、主管部门通报和可复核现场信息描述影响。未经权威确认的伤亡、失联或复开说法只能作为线索并显式标注待核。",
    applicableSectionIds: ["rain-rumor-check"],
    source: source(floodControlBriefing2026, "会商部署中监测预报预警、叫应反馈和转移避险要求"),
  }),
  knowledge({
    knowledgeId: "rain-k010-reopen-risk-assessment",
    topic: "景区复开前的风险评估与隐患处置",
    teachingSummary: "雨后恢复开放仍需风险评估、隐患排查和险情处置。报道不能把降雨减弱或响应降级直接等同于景区全部复开。",
    applicableSectionIds: ["rain-reopen-criteria"],
    source: source(beijingReopenTip, "正文第1段（恢复开放前风险评估、隐患排查与处置）"),
  }),
  knowledge({
    knowledgeId: "rain-k011-partial-area-safety-controls",
    topic: "复开后的危险点位与未开放区域",
    teachingSummary: "恢复开放后仍需清理积水和障碍、设置警示并加强重点点位看护；未开放区域必须明确标识。复开稿应列出开放范围和仍关闭区域。",
    applicableSectionIds: ["rain-reopen-criteria", "rain-multiplatform-continuous-update"],
    source: source(beijingReopenTip, "正文第1—2段（清理、警示、重点看护与未开放区域）"),
  }),
  knowledge({
    knowledgeId: "rain-k012-warning-feedback-loop",
    topic: "预警叫应、跟踪反馈与版本更新",
    teachingSummary: "近期防汛部署强调预警直达责任人并跟踪反馈，涉山涉水景区需提前转移避险。连续更新应记录每次预警、管理动作、执行回执和下一核验时间。",
    applicableSectionIds: ["rain-warning-verification", "rain-multiplatform-continuous-update"],
    source: source(floodControlBriefing2026, "部署段（临灾预警叫应、跟踪反馈与提前转移）"),
  }),
]);

export const migrationKnowledgeRecords = deepFreeze([
  ...villageSuperKnowledgeRecords,
  ...aiCopyrightKnowledgeRecords,
  ...rainEmergencyKnowledgeRecords,
]);

export const villageSuperKnowledgeRecordCount = villageSuperKnowledgeRecords.length;
export const aiCopyrightKnowledgeRecordCount = aiCopyrightKnowledgeRecords.length;
export const rainEmergencyKnowledgeRecordCount = rainEmergencyKnowledgeRecords.length;
export const migrationKnowledgeRecordCount = migrationKnowledgeRecords.length;
