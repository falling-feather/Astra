import type { AssessmentCriterionIdV4 } from "@ronggang/contracts";
import { deepFreeze, hashCanonical } from "./canonical.js";
import { professionalTrainingTasks } from "./professional-training.js";

export interface MediaTeachingTaskTemplate {
  templateId: "community-story" | "public-service";
  title: string;
  intentTerms: readonly string[];
  purpose: string;
  defaultMinutes: number;
  focusCriteria: readonly AssessmentCriterionIdV4[];
  recommendedStrategies: readonly string[];
  stages: ReadonlyArray<{ taskRef: string; instruction: string; observableResult: string }>;
  sourcePlan: ReadonlyArray<{ personId: string; materialIds: readonly string[]; purpose: string }>;
  acceptableAlternatives: readonly string[];
  reflectionQuestion: string;
}

/** These are bounded teaching designs over existing tasks and world capabilities, not student answers. */
export const mediaTeachingTaskTemplates: readonly MediaTeachingTaskTemplate[] = deepFreeze([
  {
    templateId: "community-story", title: "社区人物与日常劳动报道",
    intentTerms: ["人物", "日常劳动", "社区故事", "口述", "生活", "劳动", "人物报道"],
    purpose: "以具体人物的个人经历呈现社区生活，区分个人表达、公共背景和镜头使用范围；让读者理解劳动过程及不同人的需要。",
    defaultMinutes: 55,
    focusCriteria: ["criterion-interview-consent", "criterion-editorial-judgment"],
    recommendedStrategies: ["community-life", "craft-process", "alternative-framing", "context-recovery"],
    stages: [
      { taskRef: "pt-task-01-topic-plan", instruction: "从委托受众的问题提出切口，说明为什么值得报道，并准备人物不方便时的替代角度。", observableResult: "选题、受众、公共价值和放弃条件在选题工单中对应。" },
      { taskRef: "pt-task-03-interview-plan", instruction: "先说明身份和使用目的，再请受访者讲一件具体经历；围绕细节追问，并分别确认文字记录和影像公开范围。", observableResult: "真实问答及本人约定可回指，不把协调人的引荐当作受访者同意。" },
      { taskRef: "pt-task-02-source-map", instruction: "把人物经验与公共资料并列，标出哪些只代表本人、哪些仍需核验；可先查原文，也可先采访再回查。", observableResult: "信源矩阵区分公开原文、转述、仿真记录与待核主张。" },
      { taskRef: "pt-task-04-field-record", instruction: "保留原话和取得材料的具体过程，核清准备量、预约量与实际参与人数，不将一次观察扩成整体结论。", observableResult: "采访记录中的数字有对象、时点和不能推断的范围。" },
      { taskRef: "pt-task-05-fact-check", instruction: "核对名录身份、技艺标准和文旅案例各自的来源；不为完整叙事补造未证实的起源或年份。", observableResult: "事实核查表逐条连接来源、判断和最终表述。" },
      { taskRef: "pt-task-06-rights-ai", instruction: "按实际文件检查提供方、作者、人物同意、平台及生成标识。缺许可时可以不用样片、改用公共环境或已明确授权的教学素材。", observableResult: "权利台账与实际使用素材对应；教学素材不冒充本人外采。" },
      { taskRef: "pt-task-07-editorial-revision", instruction: "完成有主体、有细节、有来源边界的报道；修订要指出具体增删及理由，不只更换标题。", observableResult: "正文版本保留前后变化及引用，个人讲述不被写成所有居民的共同意见。" },
      { taskRef: "pt-task-08-multiplatform", instruction: "用图文与至少一种视听形态服务委托受众，解释删减信息和替代镜头，保持核心事实一致。", observableResult: "真实媒体派生与脚本能相互核对，简化表达不删除必要限定。" },
      { taskRef: "pt-task-10-publish-correct", instruction: "检查公开范围和待核项后提交教师复核；面对合理语境反馈，可补充、维持并解释，或暂缓，不强制先制造错误。", observableResult: "发布决定有依据，待决教师门未通过前不宣称已经公开发布。" },
      { taskRef: "pt-task-09-metrics-review", instruction: "复盘一次有代价的选择，区分学生判断与AI建议，说明下一次面对另一位受访者如何验证改进。", observableResult: "复盘引用本场行为和作品版本，后续目标具有可观察的检验条件。" },
    ],
    sourcePlan: [
      { personId: "entity-community-source", materialIds: ["material-resident-account", "material-resident-consent"], purpose: "本人经历与本场文字记录范围，不能代表全部社区。" },
      { personId: "entity-inheritor", materialIds: ["material-craft-process", "material-workshop-notes"], purpose: "技艺过程或教学现场可形成另一种合理人物切口。" },
      { personId: "entity-researcher", materialIds: ["material-local-standard", "material-conflicting-claim"], purpose: "核对公共背景，不以专家一句话替代原始出处。" },
      { personId: "entity-rights-contact", materialIds: ["material-license-note", "material-alternative-shots"], purpose: "区分缺口清单、实际许可和替代素材方案。" },
    ],
    acceptableAlternatives: ["受访者不便录制时采用文字记录或不可识别画面。", "可以转向技艺教学者的具体经历，说明切口变化。", "可以拒绝商业素材，也可以在许可明确后披露合作条件。"],
    reflectionQuestion: "哪一处细节因追问或公开范围协商而改变？换一位受访者时，你准备先验证什么？",
  },
  {
    templateId: "public-service", title: "公共服务信息核对与连续更新",
    intentTerms: ["公共服务", "出行", "接驳", "公告", "咨询", "班次", "服务信息", "交通", "连续更新"],
    purpose: "把一次出行体验转成具体服务问题，通过公告版本、使用者经历和当前回执区分已知与待核，形成有时点、可执行的服务报道。",
    defaultMinutes: 45,
    focusCriteria: ["criterion-fact-verification", "criterion-editorial-judgment"],
    recommendedStrategies: ["visitor-service", "shared-street", "missed-mail", "topic-pivot"],
    stages: [
      { taskRef: "pt-task-01-topic-plan", instruction: "明确报道要帮助谁作出什么出行或咨询决定，先列出必须确认与可暂缓的信息。", observableResult: "工单提出具体公众问题和首版发布的最低事实条件。" },
      { taskRef: "pt-task-02-source-map", instruction: "从公开资料点、使用者或商户均可起步，把旧资料、当下观察及待到回执分开；不要求先进入居民小院。", observableResult: "至少两类互补来源进入矩阵，旧答复不被当作今天的班次。" },
      { taskRef: "pt-task-03-interview-plan", instruction: "向使用者核对这一次经历，向联络员核对发布者、版本、时段及服务范围。涉及人物画面时尊重拒绝并说明替代办法。", observableResult: "实际问答、边界选择和未获确认的问题有过程记录。" },
      { taskRef: "pt-task-04-field-record", instruction: "保留公告原版及后续回执。等候可以用于其他调查，不为等一份资料停止全部工作。", observableResult: "材料到达后才引用，v1和v2的适用时点可区分。" },
      { taskRef: "pt-task-05-fact-check", instruction: "逐条检查服务对象、地点、渠道和时段。现场咨询结束不等于街区关闭，个别游客经历不等于总体调查。", observableResult: "核查表说明每项确认能支持的范围，未确认的实时信息保留未知。" },
      { taskRef: "pt-task-06-rights-ai", instruction: "选择与服务问题有关的合法素材，核对作者与人物范围；可以使用公共环境和获准教学素材，不需要以私人采访作为必经门。", observableResult: "作品许可与来源声明对应实际文件，不因公开网页可见而自动认定自由使用。" },
      { taskRef: "pt-task-07-editorial-revision", instruction: "先完成带时点的服务初稿，再根据新回执作必要修订；没有错误也可以补充适用范围或维持有依据的判断。", observableResult: "正文清楚区分已确认信息、未知项和补充依据。" },
      { taskRef: "pt-task-08-multiplatform", instruction: "为出行者制作便于快速查阅的图文和视听版本，保留时点与联系方式边界；不同平台共享同一事实。", observableResult: "媒体派生、脚本和正文的地点、时段及适用对象一致。" },
      { taskRef: "pt-task-10-publish-correct", instruction: "写明是否足以发布、仍需核对什么及下一次更新时间，经教师复核后再走正式发布门。", observableResult: "有限信息下的发布或暂缓决定具有具体依据与后续动作。" },
      { taskRef: "pt-task-09-metrics-review", instruction: "说明一项为及时服务而作的取舍，记录AI建议为什么被采纳或拒绝，并将核验方法迁移到另一类临时信息。", observableResult: "后续训练目标来自本场缺口，点击和播放量不能代替事实质量。" },
    ],
    sourcePlan: [
      { personId: "entity-public-liaison", materialIds: ["material-notice-board", "material-public-service", "material-service-update"], purpose: "核对版本与当前确认范围，等待中的回执不能提前使用。" },
      { personId: "entity-tourist", materialIds: ["material-tourist-account"], purpose: "把具体体验作为线索，不外推全部游客。" },
      { personId: "entity-shopkeeper", materialIds: ["material-shop-service"], purpose: "区分询问、预约、到店与消费；可以只采访而不用样片。" },
      { personId: "entity-researcher", materialIds: ["material-source-method", "material-local-standard"], purpose: "借助原文和方法辨析资料，专家等待不是唯一路径。" },
    ],
    acceptableAlternatives: ["可以先公开资料后采访，也可先使用者线索后核对。", "回执延迟时，可以先发布有明确范围的已确认内容，也可说明暂缓的具体缺口。", "无需居民小院路线；人物拒绝特写时可用说明图或公共环境替代。"],
    reflectionQuestion: "如果下次面对临时交通或活动信息，你会先确认哪三个字段？什么结果会让你修正本次取舍？",
  },
]);

export interface TeachingWorkContrast {
  exampleId: string;
  title: string;
  criterionId: AssessmentCriterionIdV4;
  artifactId: string;
  fieldId: string;
  materialIds: readonly string[];
  knowledgeIds: readonly string[];
  problematicExcerpt: string;
  boundedExcerpt: string;
  reviewReason: string;
  evidenceCondition: string;
}

/** Author-written comparison excerpts. They are neither real student work nor scoring shortcuts. */
export const teachingWorkContrasts: readonly TeachingWorkContrast[] = deepFreeze([
  { exampleId: "contrast-listing-year", title: "名录、标准和案例不能混成一个年份", criterionId: "criterion-fact-verification", artifactId: "artifact-fact-check-sheet", fieldId: "final_wording",
    materialIds: ["material-local-standard", "material-conflicting-claim", "material-expert-mail"], knowledgeIds: ["pt-k010-source-verification", "pt-k023-statistical-release"],
    problematicExcerpt: "2024年簪花围正式入选国家级非遗，并成为文旅创新案例，因此三份材料证明的是同一件事。",
    boundedExcerpt: "应分别核对蟳埔女习俗的名录身份、2024年地方技艺标准和文旅案例入选事项。标准发布日期不能写成新入选年份，研究者说明仍需回到原文定位。",
    reviewReason: "前一表述合并了不同文件的对象与时间，后一表述保留各自的核验任务与适用范围。", evidenceCondition: "只有学生实际取得并引用相应资料后，才能判断本稿引用关系；示范文字本身不能成为本场核验行为。" },
  { exampleId: "contrast-prepared-count", title: "准备量不等于实际到场人数", criterionId: "criterion-fact-verification", artifactId: "artifact-feature-story", fieldId: "body",
    materialIds: ["material-resident-account"], knowledgeIds: ["pt-k021-statistical-definition", "pt-k022-statistical-source"],
    problematicExcerpt: "阿环准备了12份材料，所以今天已有12位游客参加活动；两箱材料也说明活动分成两批进行。",
    boundedExcerpt: "阿环说本次准备12份材料，分装为两箱；这能说明准备工作，不能据此认定实际到场人数或活动批次。报道应继续核对需要公开的数量。",
    reviewReason: "区分原话提供的量与作者增加的推断，评价对象是这条具体主张及其来源，不能仅数文中的数字。", evidenceCondition: "需本人的已发生问答或已取得摘记，以及作品中的对应句子。" },
  { exampleId: "contrast-consultation-window", title: "咨询时段不是街区开放边界", criterionId: "criterion-editorial-judgment", artifactId: "artifact-publication-correction-decision", fieldId: "publication_plan",
    materialIds: ["material-notice-board", "material-service-update", "material-public-service"], knowledgeIds: ["pt-k001-audience-public-value", "pt-k023-statistical-release"],
    problematicExcerpt: "20分钟之后整个街区关闭，游客不能进入。旧交通答复仍可作为今天班次的完整指引。",
    boundedExcerpt: "补充回执只确认现场咨询在本场前20分钟开放，之后改由工作消息回复，公共路线仍开放。旧交通答复用于背景，当前班次尚需另核；首版需标明时点与下次更新时间。",
    reviewReason: "前者扩大了回执效力，后者以当下证据限定服务信息，并给读者可执行的后续安排。", evidenceCondition: "新回执须已到达且实际取得；未收到时只能说明待核，不能引用这段示范假装回执已到。" },
  { exampleId: "contrast-person-consent", title: "引荐、文字记录与影像公开是不同事项", criterionId: "criterion-interview-consent", artifactId: "artifact-interview-plan-log", fieldId: "consent",
    materialIds: ["material-resident-consent"], knowledgeIds: ["pt-k011-interview-record", "pt-k014-permission-scope"],
    problematicExcerpt: "林师傅让我进院，就表示居民同意我录音拍脸，并可在所有平台公开。",
    boundedExcerpt: "协调人的引荐只解决接触安排。本场与阿环确认的是文字记录，影像录制和平台公开不能由此推定；没有本人约定时，我使用不识别人物的替代画面。",
    reviewReason: "应核对实际发生的本人约定及其用途，不能将场景准入或商户核对单替代人物同意。", evidenceCondition: "肯定某项同意必须对应本人确认回合；选择尊重拒绝与替代画面同样可以形成正当边界证据。" },
  { exampleId: "contrast-rights-gap", title: "提供素材不等于授予所有权利", criterionId: "criterion-rights-governance", artifactId: "artifact-rights-ledger", fieldId: "permission_scope",
    materialIds: ["material-commercial-offer", "material-license-note", "material-alternative-shots"], knowledgeIds: ["pt-k013-work-types-rights", "pt-k014-permission-scope", "pt-k017-ai-explicit-label"],
    problematicExcerpt: "样片由店家提供，有水印，说明作者和画面人物都同意记者任意转发。",
    boundedExcerpt: "核对单仍缺作者、人物公开范围及记者使用条件，我先不使用这份样片。改用已确认用途的素材并记录提供方、平台、期限和生成标识；材料可见不等于许可齐全。",
    reviewReason: "真实权利回执与实际用法应逐项对应；默认目录元数据不能单独证明学生完成了职业判断。", evidenceCondition: "需实际选用或放弃素材的记录、作品文件和台账说明；不凭关键词出现给分。" },
  { exampleId: "contrast-format-consistency", title: "多平台适配要保留同一事实边界", criterionId: "criterion-multiplatform-production", artifactId: "artifact-multiplatform-script", fieldId: "breaking_update",
    materialIds: ["material-public-service", "material-service-update"], knowledgeIds: ["pt-k005-multimedia-role-loop", "pt-k006-content-distribution"],
    problematicExcerpt: "图文只写现场咨询结束，短视频为吸引关注改成全街闭门，并删去信息时点。",
    boundedExcerpt: "图文和短视频都保留现场咨询的适用时段及后续联系渠道。短视频压缩背景解释，图文补充原版与更新说明；两者都不把咨询结束写成街区关闭。",
    reviewReason: "表达可以因平台变化，服务范围与事实不能变；仍需真实派生文件及可回读版本来验证。", evidenceCondition: "文本只能作为脚本依据，不冒充已经完成图像、音频或视频加工。" },
  { exampleId: "contrast-grounded-reflection", title: "复盘要回到本场选择并能迁移", criterionId: "criterion-recovery-transfer", artifactId: "artifact-transfer-reflection", fieldId: "next_job_transfer",
    materialIds: ["material-service-update", "material-source-method"], knowledgeIds: ["pt-k008-coordination-handoff", "pt-k012-correction-duty", "pt-k024-statistical-correction"],
    problematicExcerpt: "我每次都采纳AI，因此报道一定正确。下一次继续提高真实性、专业性和传播力就能成功。",
    boundedExcerpt: "本场等回执时我先核对已有公开材料，回执到达后只补充咨询时段并保留旧稿。下次遇到临时活动信息，我先确认发布者、时点和适用范围；若当下渠道给出反证，就修订正文并记录原因。",
    reviewReason: "后者给出具体行为、依据和可检验的后续动作；无需先故意犯错，采纳AI的次数也不是能力证据。", evidenceCondition: "这些行为与版本必须在本场真实发生。若没有发生，表述只能作为未来计划，不能算既有成绩。" },
]);

export const mediaTeachingContent = deepFreeze({
  version: "media-teaching-content/1.0.0",
  templates: mediaTeachingTaskTemplates,
  contrasts: teachingWorkContrasts,
  reviewStatus: "pending_expert_review" as const,
  boundary: "模板和对照片段为本项目教学编写；引用已有发布知识和仿真素材，不是现实委托、真实学生作业或专家认可。六维权重沿当前量规，具体评分须回到本场证据。",
  contentHash: hashCanonical({ templates: mediaTeachingTaskTemplates, contrasts: teachingWorkContrasts }),
});

export function teachingTaskKnowledgeIds(template: MediaTeachingTaskTemplate): string[] {
  return [...new Set(template.stages.flatMap(stage => {
    const task = professionalTrainingTasks.find(item => item.taskId === stage.taskRef);
    if (!task) throw new Error(`教学步骤引用未发布岗位任务：${stage.taskRef}`);
    return task.knowledgeIds;
  }))];
}
