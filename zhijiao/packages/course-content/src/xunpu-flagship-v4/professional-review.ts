import { xunpuCourseRelease } from "../xunpu-course.js";
import { xunpuV4AddedKnowledgeRecords } from "./knowledge.js";
import type {
  XunpuProfessionalReviewItemV4,
  XunpuProfessionalReviewPacketV4,
} from "./types.js";

type ReviewFocus = XunpuProfessionalReviewItemV4["reviewFocus"];
type FreshnessPolicy = XunpuProfessionalReviewItemV4["freshnessPolicy"];

const focusPolicies: Record<ReviewFocus, {
  teachingUse: string;
  applicabilityBoundary: string;
  disputeOrExpiryRisk: string;
  requiredReviewerRoles: string[];
  freshnessPolicy: FreshnessPolicy;
}> = {
  cultural_context: {
    teachingUse: "用于文化主体、术语、技艺观察与非遗传播边界的采访和写作训练。",
    applicabilityBoundary: "公开规范只能支持其明示范围；个人实践、历史解释和社区整体经验必须另行采访或限定。",
    disputeOrExpiryRisk: "文化称谓、历史叙述和代表性容易被过度概括；地方标准中的资料性说明不自动等于无争议史实。",
    requiredReviewerRoles: ["融媒体采编专业教师", "非遗保护或泉州地方文化领域专家"],
    freshnessPolicy: "verify_on_each_release",
  },
  fact_and_source: {
    teachingUse: "用于来源分级、统计时点、网络线索核验、引语确认和公开更正训练。",
    applicabilityBoundary: "数字、评选、传播量和状态只能按发布主体、统计窗口、页面状态与 locator 原样限定。",
    disputeOrExpiryRisk: "页面更新、统计口径变化、历史页面失效和二次转载可能使相同数字产生不同含义。",
    requiredReviewerRoles: ["融媒体采编专业教师", "新闻事实核查或数据新闻教师"],
    freshnessPolicy: "verify_on_each_release",
  },
  rights_and_privacy: {
    teachingUse: "用于采访同意、肖像声音、个人信息、素材版权、许可范围和撤回后的版本治理。",
    applicabilityBoundary: "课程只训练风险识别和职业流程，不给具体个案作法律定性；版权、肖像、个人信息分别核对。",
    disputeOrExpiryRisk: "授权主体、平台、期限、用途和作品版本变化会改变可用范围，新闻用途不自动消除权利义务。",
    requiredReviewerRoles: ["融媒体采编专业教师", "知识产权或个人信息保护专业人员"],
    freshnessPolicy: "verify_on_rule_change",
  },
  content_governance: {
    teachingUse: "用于虚假信息防范、平台发布、更正追溯和生成合成内容标识训练。",
    applicabilityBoundary: "规则提示不能替代发布主体的实际审核，也不能让模型、平台回执或热度自动成为事实。",
    disputeOrExpiryRisk: "平台规则与生成合成标识要求可能调整，实施口径和技术标准需在每次规则变化时复核。",
    requiredReviewerRoles: ["融媒体采编专业教师", "内容治理或平台合规专业人员"],
    freshnessPolicy: "verify_on_rule_change",
  },
  occupational_pedagogy: {
    teachingUse: "用于对齐融媒体岗位典型任务、项目式情境教学、视听生产和证据化评价。",
    applicabilityBoundary: "职业与教学标准支持能力结构和任务方向，不证明本课程已经产生教学效果。",
    disputeOrExpiryRisk: "专业标准、职业标准和院校实施条件可能更新；课程转译仍需教师确认适龄性与课时负荷。",
    requiredReviewerRoles: ["融媒体专业带头人", "职业教育课程与评价专家"],
    freshnessPolicy: "verify_annually",
  },
};

const reviewQuestions: Record<string, { focus: ReviewFocus; question: string }> = {
  "xunpu-k001-heritage-status-boundary": { focus: "cultural_context", question: "名录项目、簪花围技艺和泉州世界遗产地的区分是否准确，2008 年表述是否有原始定位支持？" },
  "xunpu-k002-custom-and-zanhuawei-definition": { focus: "cultural_context", question: "术语定义是否忠实于地方标准，是否避免以‘网红头饰’替代完整文化主体？" },
  "xunpu-k003-cultural-respect": { focus: "cultural_context", question: "从标准‘基本要求’转译出的文化尊重规则是否适合新闻选题与镜头判断，是否存在过度法律化？" },
  "xunpu-k004-technique-sequence": { focus: "cultural_context", question: "材料准备、盘发、装饰、成型的教学拆分是否准确，现场未观察步骤是否被明确禁止推断？" },
  "xunpu-k005-daily-festival-difference": { focus: "cultural_context", question: "日常、节庆、时节与个人选择的差异是否表达清楚，是否避免以游客体验代表社区日常？" },
  "xunpu-k006-documentation-and-archive": { focus: "cultural_context", question: "把保护档案要求转译为素材来源、授权和版本台账是否专业、不过度扩张？" },
  "xunpu-k007-transmission-and-public-communication": { focus: "cultural_context", question: "传播与推广训练是否仍以公众理解和保护传承为边界，而非把宣传目标替代新闻判断？" },
  "xunpu-k008-innovation-case-selection": { focus: "fact_and_source", question: "‘入选 2024 案例’的发布主体、日期和称谓是否准确，是否避免扩张为永久排名或全面成效？" },
  "xunpu-k009-2024-visitor-statistics": { focus: "fact_and_source", question: "累计量、峰值、统计区间和发布时间是否完整可见，是否排除了常态日均与当日实时外推？" },
  "xunpu-k010-online-reach-attribution": { focus: "fact_and_source", question: "线上传播量是否明确为发布方口径，是否避免等同独立受众、文化认同或实时平台数据？" },
  "xunpu-k011-case-evaluation-frame": { focus: "fact_and_source", question: "案例评选维度是否只用于复盘问题，而没有替代真实性、权利与文化尊重标准？" },
  "xunpu-k012-yearly-statistics-not-interchangeable": { focus: "fact_and_source", question: "2023 与 2024 数据是否在作品和训练事件中保持独立时点，没有被拼接成当前趋势？" },
  "xunpu-k013-logo-is-rights-bearing-asset": { focus: "rights_and_privacy", question: "是否清楚区分 LOGO 发布事实与素材复制许可，并为实际使用保留独立核权步骤？" },
  "xunpu-k014-source-status-over-topic-match": { focus: "fact_and_source", question: "标注‘废止，失效’的页面是否只作为来源状态反例，且不会进入现行服务结论？" },
  "xunpu-k015-authenticity-integrity-transmission": { focus: "cultural_context", question: "真实性、整体性、传承性及禁止歪曲贬损的教学摘要是否忠实于法条且不过度替社区发言？" },
  "xunpu-k016-interview-consent-and-custom": { focus: "rights_and_privacy", question: "非遗调查同意与习俗尊重是否被恰当转译为采访说明、用途确认和撤回记录，而非泛化为所有场景同一法律结论？" },
  "xunpu-k017-multiple-perspectives": { focus: "fact_and_source", question: "相关方覆盖是否服务于准确、全面和客观，而不是机械要求每篇作品罗列全部十名 NPC？" },
  "xunpu-k018-network-claim-needs-verification": { focus: "fact_and_source", question: "网络、手机和转载线索的核验规则是否明确，模型回答与群聊截图是否被排除为确认事实？" },
  "xunpu-k019-correction-is-part-of-workflow": { focus: "content_governance", question: "投诉、核查、反馈和更正是否形成发布后的职业闭环，且不把所有争议都机械判为错误？" },
  "xunpu-k020-republication-traceability": { focus: "content_governance", question: "转载来源、作者、原标题与可追溯要求是否完整，是否覆盖跨平台版本而不复制长篇原文？" },
  "xunpu-k021-photography-permission": { focus: "rights_and_privacy", question: "摄影作品、权利人、许可与水印证据的边界是否准确，是否避免给具体素材作无依据的法律结论？" },
  "xunpu-k022-real-project-scenario-teaching": { focus: "occupational_pedagogy", question: "真实项目、典型任务和情境式教学的课程转译是否符合专业标准，而不是用剧情替代岗位成果？" },
  "xunpu-k023-integrated-production-workflow": { focus: "occupational_pedagogy", question: "采集、编辑、审核发布、运营反馈与复盘是否构成可观察岗位链，是否遗漏视听制作责任？" },
  "xunpu-k024-all-media-job-loop": { focus: "occupational_pedagogy", question: "全媒体运营岗位能力是否被转译为证据化行为和成果，而非以点击完成、终局或模型评价代替？" },
  "xunpu-k025-portrait-consent": { focus: "rights_and_privacy", question: "肖像制作、使用、公开与许可范围是否区分，合理使用例外是否没有被简化为新闻无限使用？" },
  "xunpu-k026-news-use-necessary-scope": { focus: "rights_and_privacy", question: "公共利益新闻处理个人信息的目的与必要范围是否恰当呈现，是否保留具体情境判断？" },
  "xunpu-k027-voice-protection": { focus: "rights_and_privacy", question: "声音保护参照肖像权规则的教学表述是否准确，录音采访与公开使用范围是否分开？" },
  "xunpu-k028-sensitive-personal-information": { focus: "rights_and_privacy", question: "生物识别等敏感个人信息的特定目的、必要性和严格保护要求是否进入现场拍摄边界？" },
  "xunpu-k029-minor-information": { focus: "rights_and_privacy", question: "不满十四周岁未成年人信息的专门规则是否正确，课程是否始终禁止以采访便利绕过保护？" },
  "xunpu-k030-consent-withdrawal": { focus: "rights_and_privacy", question: "撤回同意后的停止公开、替换与版本留痕是否准确，是否避免把撤回前处理自动描述为违法？" },
  "xunpu-k031-photo-copyright-permission": { focus: "rights_and_privacy", question: "新闻题材摄影作品的版权保护与许可范围是否准确，是否区分时事新闻事实与摄影作品表达？" },
  "xunpu-k032-watermark-not-license": { focus: "rights_and_privacy", question: "水印、权利声明、权属证据和实际许可是否被清晰拆分，训练动作是否要求进一步核验？" },
  "xunpu-k033-ai-explicit-label": { focus: "content_governance", question: "生成合成内容显式标识的适用对象、可感知位置和导出要求是否按现行规则表达？" },
  "xunpu-k034-ai-implicit-label": { focus: "content_governance", question: "文件元数据中的隐式标识与内容属性、服务者编码等要求是否准确，是否与普通 EXIF 混淆？" },
  "xunpu-k035-ai-user-declaration": { focus: "content_governance", question: "用户主动声明、平台标识功能与禁止删除伪造标识的边界是否准确且可执行？" },
  "xunpu-k036-source-interview-correction": { focus: "fact_and_source", question: "多方采访、网络线索复核与公开更正是否按不同阶段呈现，是否允许证据充分时维持判断？" },
};

type NormalizedKnowledge = {
  knowledgeRef: string;
  sourceTitle: string;
  publisher: string;
  url: string;
  publishedAt: string;
  locator: string;
  sourceVersion: string;
  sourceContentHash: string;
};

const baseKnowledge: NormalizedKnowledge[] = xunpuCourseRelease.knowledgeRecords.map((record) => ({
  knowledgeRef: record.knowledgeId,
  sourceTitle: record.source.title,
  publisher: record.source.publisher,
  url: record.source.url,
  publishedAt: record.source.publicationDate,
  locator: record.source.locator,
  sourceVersion: record.source.sourceVersion,
  sourceContentHash: record.contentHash,
}));

const addedKnowledge: NormalizedKnowledge[] = xunpuV4AddedKnowledgeRecords.map((record) => ({
  knowledgeRef: record.knowledgeId,
  sourceTitle: record.sourceTitle,
  publisher: record.publisher,
  url: record.url,
  publishedAt: record.publishedAt,
  locator: record.locator,
  sourceVersion: record.sourceVersion,
  sourceContentHash: record.contentHash,
}));

const items: XunpuProfessionalReviewItemV4[] = [
  ...baseKnowledge,
  ...addedKnowledge,
].map((record) => {
  const spec = reviewQuestions[record.knowledgeRef];
  if (!spec) throw new Error(`知识 ${record.knowledgeRef} 缺少专业复核问题`);
  const policy = focusPolicies[spec.focus];
  return {
    reviewItemId: `professional-review-${record.knowledgeRef}`,
    knowledgeRef: record.knowledgeRef,
    reviewFocus: spec.focus,
    teachingUse: policy.teachingUse,
    applicabilityBoundary: policy.applicabilityBoundary,
    disputeOrExpiryRisk: policy.disputeOrExpiryRisk,
    reviewQuestion: spec.question,
    requiredReviewerRoles: [...policy.requiredReviewerRoles],
    freshnessPolicy: policy.freshnessPolicy,
    sourceSnapshot: {
      sourceTitle: record.sourceTitle,
      publisher: record.publisher,
      url: record.url,
      publishedAt: record.publishedAt,
      locator: record.locator,
      sourceVersion: record.sourceVersion,
      sourceContentHash: record.sourceContentHash,
    },
    reviewStatus: "pending_expert_review",
  };
});

export const xunpuV4ProfessionalReviewPacket: XunpuProfessionalReviewPacketV4 = {
  packetId: "professional-review-packet-xunpu-v4-r1",
  preparedAt: "2026-09-01T12:00:00+08:00",
  reviewStatus: "pending_expert_review",
  items,
  signoffRequirements: [
    "逐项记录 reviewer role、reviewedAt、结论、修订建议和签审证据引用；不得由系统代签。",
    "文化事实、新闻采编、权利治理和职业教学四类至少分别由匹配领域人员复核。",
    "任何驳回项必须从高风险建议候选中移除或修订后重新计算知识与内容哈希。",
    "来源可访问、元数据完整和自动化测试通过均不能替代外部专业复核。",
  ],
  reviewEvidenceMustBeExternal: true,
  noAutomaticVerificationClaim: true,
};
