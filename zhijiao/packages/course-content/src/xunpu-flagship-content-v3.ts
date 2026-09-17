import {
  WorldSimulationReleaseSchema,
  WorldSimulationReleaseSchemaVersion,
  challengeScoreCeiling,
  type ChallengeLevel,
  type WorldSimulationRelease,
} from "@ronggang/contracts";
import { deepFreeze, hashCanonical } from "./canonical.js";
import { xunpuContractCourseRelease } from "./course-release-adapter.js";
import { xunpuCourseRelease } from "./xunpu-course.js";
import { xunpuFlagshipActionPolicyV4 } from "./xunpu-flagship-v4/runtime-definition.js";
import { getXunpuWorldSimulationReleaseV3 } from "./xunpu-world-simulation-v3.js";

export const XunpuFlagshipContentManifestSchemaVersion =
  "xunpu-flagship-content/3.0.0" as const;

type StudentVerb = WorldSimulationRelease["allowedStudentVerbs"][number];
type CourseReleaseRef = WorldSimulationRelease["courseReleaseRef"];

export interface XunpuFlagshipRoleV3 {
  roleId: string;
  entityId: string;
  displayName: string;
  professionalRole: string;
  publicGoal: string;
  privatePressure: string;
  disclosureRules: string[];
  simulationNotice: string;
}

export interface XunpuFlagshipArtifactV3 {
  artifactId: string;
  title: string;
  artifactKind: string;
  conflictDomainRefs: string[];
  requiredAtChallengeLevels: ChallengeLevel[];
  editableFields: Array<{
    fieldId: string;
    label: string;
    minimumLength: number;
    maximumLength: number;
  }>;
  completionChecks: string[];
  evidenceRequirements: string[];
}

export interface XunpuFlagshipConflictDomainV3 {
  conflictDomainId: string;
  title: string;
  worldProblem: string;
  activationTriggers: string[];
  proactiveTriggerKinds: Array<"student" | "npc" | "clock" | "threshold">;
  principalRoleRefs: string[];
  coreVariableRefs: string[];
  eventTemplateRefs: string[];
  availableStudentVerbs: StudentVerb[];
  requiredArtifactRefs: string[];
  alternativeRoutes: Array<{
    routeId: string;
    label: string;
    steps: string[];
    tradeoff: string;
  }>;
  recoveryConditions: string[];
}

export interface XunpuFlagshipChallengeProfileV3 {
  challengeLevel: ChallengeLevel;
  scoreCeiling: number;
  concurrentConflictLimit: number;
  scaffoldingBudget: number;
  npcResistance: string;
  deadlinePattern: string;
  eventTemplateRefs: string[];
  protectionRules: string[];
}

export interface XunpuFlagshipTeacherGateV3 {
  gateId: string;
  title: string;
  gateKind: "privacy_and_consent" | "publication_risk" | "final_assessment";
  entryConditions: string[];
  resubmissionConditions: string[];
}

export interface XunpuFlagshipEndingV3 {
  endingId: string;
  title: string;
  endingKind:
    | "trusted_collaboration"
    | "prudent_delay"
    | "traffic_backlash"
    | "governance_failure";
  conditionSummary: string;
  learningMeaning: string;
}

export interface XunpuFlagshipContentManifestV3 {
  schemaVersion: typeof XunpuFlagshipContentManifestSchemaVersion;
  manifestId: string;
  version: number;
  title: string;
  premise: string;
  expectedDurationMinutes: number;
  primaryJobId: "integrated_media_reporter";
  studentRoleId: "reporter";
  factBoundary: {
    allNamedPeopleAreSimulated: true;
    allPrivatePressuresAreSimulated: true;
    publicFactsRequireKnowledgeRefs: true;
    noExternalMediaCopied: true;
  };
  sourceKnowledgeRefs: Array<{
    knowledgeId: string;
    reviewStatus: "pending_expert_review" | "verified" | "retired";
    locator: string;
    url: string;
  }>;
  sourceRefresh: {
    checkedAt: string;
    checkedKnowledgeRefs: string[];
    findings: string[];
    expertReviewStillRequired: true;
  };
  hiddenScenarioFacts: Array<{
    factId: string;
    summary: string;
    visibleToRoleRefs: string[];
    mayBecomePublicThrough: StudentVerb[];
    simulationOnly: true;
    mustNeverBePresentedAsRealPersonFact: true;
  }>;
  principalRoles: XunpuFlagshipRoleV3[];
  conflictDomains: XunpuFlagshipConflictDomainV3[];
  artifacts: XunpuFlagshipArtifactV3[];
  rubricBlueprints: Array<{
    criterionId: string;
    title: string;
    weight: number;
    artifactRefs: string[];
    observableEvidence: string[];
    minimumIndependentEvidenceCount: number;
    failClosedWhen: string[];
  }>;
  assessmentBoundary: {
    artifactCompletionIsNotCompetencyScore: true;
    insufficientEvidenceStatus: "insufficient_evidence";
    finalAuthority: "teacher";
  };
  challengeProfiles: XunpuFlagshipChallengeProfileV3[];
  teacherGates: XunpuFlagshipTeacherGateV3[];
  endings: XunpuFlagshipEndingV3[];
  timingPlan: Array<{
    phaseId: string;
    minutes: number;
    purpose: string;
    reorderable: boolean;
  }>;
  answerDemoSteps: string[];
  contentHash: string;
}

export interface XunpuFlagshipContentIssueV3 {
  code: string;
  path: string;
  message: string;
}

export interface XunpuFlagshipContentValidationV3 {
  valid: boolean;
  issues: XunpuFlagshipContentIssueV3[];
}

const allLevels: ChallengeLevel[] = [3, 4, 5, 6, 7];
const level3Events = [
  "event-template-topic-brief",
  "event-template-gatekeeper",
  "event-template-inheritor",
  "event-template-community-source",
  "event-template-source-check",
  "event-template-clock",
  "event-template-draft-story",
  "event-template-verification-wait",
  "event-template-publication",
  "event-template-teacher-pause",
];
const level4Events = [
  ...level3Events,
  "event-template-researcher-probe",
  "event-template-official-request",
  "event-template-compare-sources",
  "event-template-shopkeeper",
  "event-template-commercial-response",
  // The default showcase is level 4. It must still contain one unmistakable
  // rights conflict so the flagship chain exercises consent, recovery and a
  // consequential choice instead of stopping at editorial discussion.
  "event-template-visual-consent",
];
const level5Events = [
  ...level4Events,
  "event-template-rights-inspection",
  "event-template-rights-contact",
  "event-template-safety-rumor",
  "event-template-limited-alert",
];
const level6Events = [
  ...level5Events,
  "event-template-platform-feedback",
  "event-template-community-challenge",
  "event-template-correction",
  "event-template-teacher-privacy",
];
const level7Events = [
  ...level6Events,
];

const manifestDraft: Omit<XunpuFlagshipContentManifestV3, "contentHash"> = {
  schemaVersion: XunpuFlagshipContentManifestSchemaVersion,
  manifestId: "xunpu-flagship-content-v3-r3",
  version: 3,
  title: "海丝融媒编辑部：簪花围热点报道日",
  premise: "学生作为新入职融媒体记者，在一个持续推进的虚拟工作日内解释蟳埔女习俗与簪花围传播热点，处理文化主体、信源冲突、商业交换、素材权利、公共安全和发布后反馈，并以真实作品版本承担后果。",
  expectedDurationMinutes: 55,
  primaryJobId: "integrated_media_reporter",
  studentRoleId: "reporter",
  factBoundary: {
    allNamedPeopleAreSimulated: true,
    allPrivatePressuresAreSimulated: true,
    publicFactsRequireKnowledgeRefs: true,
    noExternalMediaCopied: true,
  },
  sourceKnowledgeRefs: xunpuCourseRelease.knowledgeRecords.map((record) => ({
    knowledgeId: record.knowledgeId,
    reviewStatus: record.reviewStatus,
    locator: record.source.locator,
    url: record.source.url,
  })),
  sourceRefresh: {
    checkedAt: "2026-08-26",
    checkedKnowledgeRefs: [
      "xunpu-k001-heritage-status-boundary",
      "xunpu-k002-custom-and-zanhuawei-definition",
      "xunpu-k008-innovation-case-selection",
      "xunpu-k009-2024-visitor-statistics",
      "xunpu-k014-source-status-over-topic-match",
      "xunpu-k022-real-project-scenario-teaching",
      "xunpu-k023-integrated-production-workflow",
      "xunpu-k024-all-media-job-loop",
    ],
    findings: [
      "国务院第二批国家级非物质文化遗产名录与泉州 DB 3505/T 16—2024 均支持 2008 年列入名录；出现 2007 年说法时必须作为来源冲突重新核验。",
      "福建省文旅厅 2024 文旅经济创新案例页面仍可访问；页面客流和传播数据只限该页面标明的 2024 统计时点，不得跨年度复用。",
      "教育部 2025 专业教学标准仍明确素材采集、内容编辑、审核发布和融媒体全流程实训要求，支持九类真实成果而非点击式完成。",
      "页面主题相关不等于来源当前有效；明确标记废止、失效的材料只用于训练来源状态识别。",
    ],
    expertReviewStillRequired: true,
  },
  hiddenScenarioFacts: [
    {
      factId: "sim-fact-editor-window",
      summary: "仿真：栏目首轮窗口将在世界时钟推进后收窄，责任编辑不会因学生停留页面而暂停。",
      visibleToRoleRefs: ["role-responsible-editor"],
      mayBecomePublicThrough: ["ask", "wait", "observe"],
      simulationOnly: true,
      mustNeverBePresentedAsRealPersonFact: true,
    },
    {
      factId: "sim-fact-community-boundary",
      summary: "仿真：阿环愿意谈劳动和公开习俗，但不接受家庭地址、未成年人和私人空间进入报道。",
      visibleToRoleRefs: ["role-community-source"],
      mayBecomePublicThrough: ["ask", "probe", "negotiate"],
      simulationOnly: true,
      mustNeverBePresentedAsRealPersonFact: true,
    },
    {
      factId: "sim-fact-origin-claim-uncertain",
      summary: "仿真：研究者掌握的材料只能证明名录、标准和文化实践，无法把单一起源传说写成定论。",
      visibleToRoleRefs: ["role-heritage-researcher"],
      mayBecomePublicThrough: ["probe", "inspect", "compare"],
      simulationOnly: true,
      mustNeverBePresentedAsRealPersonFact: true,
    },
    {
      factId: "sim-fact-merchant-exchange",
      summary: "仿真：吴姐准备以高清素材换取标题、首图和套餐链接曝光。",
      visibleToRoleRefs: ["role-merchant-partner"],
      mayBecomePublicThrough: ["ask", "probe", "negotiate"],
      simulationOnly: true,
      mustNeverBePresentedAsRealPersonFact: true,
    },
    {
      factId: "sim-fact-official-data-pending",
      summary: "仿真：最新客流和拥挤处置数据仍在汇总，只能确认上次公开值、统计时点和下一更新窗口。",
      visibleToRoleRefs: ["role-public-liaison"],
      mayBecomePublicThrough: ["ask", "inspect", "wait"],
      simulationOnly: true,
      mustNeverBePresentedAsRealPersonFact: true,
    },
    {
      factId: "sim-fact-license-scope-mismatch",
      summary: "仿真：热门近景素材只有线下展示许可，不包含商业短视频、二次剪辑和跨平台投放。",
      visibleToRoleRefs: ["role-rights-contact"],
      mayBecomePublicThrough: ["inspect", "compare", "negotiate"],
      simulationOnly: true,
      mustNeverBePresentedAsRealPersonFact: true,
    },
    {
      factId: "sim-fact-platform-rule-hit",
      summary: "仿真：夸张标题、未确认数字、近景许可缺失或静默修改会触发平台退回与更正要求。",
      visibleToRoleRefs: ["role-platform-duty"],
      mayBecomePublicThrough: ["inspect", "submit", "escalate"],
      simulationOnly: true,
      mustNeverBePresentedAsRealPersonFact: true,
    },
    {
      factId: "sim-fact-safety-rumor",
      summary: "仿真：群聊中的巷口封闭截图缺少发布主体、时间和现场定位，不能直接作为公共安全事实。",
      visibleToRoleRefs: ["role-public-liaison", "role-responsible-editor"],
      mayBecomePublicThrough: ["inspect", "compare", "wait"],
      simulationOnly: true,
      mustNeverBePresentedAsRealPersonFact: true,
    },
  ],
  principalRoles: [
    {
      roleId: "role-responsible-editor",
      entityId: "entity-editor",
      displayName: "陈编辑",
      professionalRole: "责任编辑",
      publicGoal: "在发布窗口内形成可信、可审核、可更正的融媒体专题。",
      privatePressure: "仿真：栏目窗口正在收窄，但她不愿用未经核验的流量标题换时效。",
      disclosureRules: ["可以说明截稿与栏目要求", "不得替学生选角度或写稿", "高风险发布只能提出门候选"],
      simulationNotice: "姓名、压力与对话均为教学仿真，不指向真实编辑。",
    },
    {
      roleId: "role-community-source",
      entityId: "entity-community-source",
      displayName: "阿环",
      professionalRole: "蟳埔社区受访者",
      publicGoal: "让报道准确呈现社区生活、劳动和文化主体。",
      privatePressure: "仿真：她愿意谈公开习俗，但拒绝家庭地址、未成年人和私人空间被传播。",
      disclosureRules: ["学生先说明用途后才谈家庭记忆", "可协商匿名与删题", "感到被猎奇化时会降低信任或撤回引语"],
      simulationNotice: "人物、家庭信息和授权冲突均为教学仿真。",
    },
    {
      roleId: "role-heritage-researcher",
      entityId: "entity-researcher",
      displayName: "陈老师",
      professionalRole: "非遗研究者",
      publicGoal: "纠正概念混用并帮助记者区分确定事实、解释和待核说法。",
      privatePressure: "仿真：她掌握地方标准和公开档案，但对部分网络起源说法明确保留。",
      disclosureRules: ["只对可定位材料给确定口径", "遇到转引链会要求回到原始出处", "不会把学术推测包装成事实"],
      simulationNotice: "研究者身份、意见与材料回应均为教学仿真。",
    },
    {
      roleId: "role-merchant-partner",
      entityId: "entity-shopkeeper",
      displayName: "吴姐",
      professionalRole: "文旅商户与素材合作方",
      publicGoal: "让游客看见旅拍服务并提高门店触达。",
      privatePressure: "仿真：她愿意提供高清素材，但希望标题、首图和链接突出套餐。",
      disclosureRules: ["可谈素材来源与授权范围", "会提出商业交换条件", "记者拒绝植入后仍可能保留有限采访合作"],
      simulationNotice: "人物、商户和交换条件均为教学仿真。",
    },
    {
      roleId: "role-public-liaison",
      entityId: "entity-public-liaison",
      displayName: "蔡主任",
      professionalRole: "文旅部门联络员",
      publicGoal: "提供可核验公共信息并避免未汇总数字被提前写成定论。",
      privatePressure: "仿真：最新客流与拥挤处置数据仍在汇总，只能确认时间、口径与更新窗口。",
      disclosureRules: ["已公开材料可以定位回复", "未完成汇总的数字只说明状态", "公共安全事项优先给限定性口径"],
      simulationNotice: "岗位、数据等待和答复均为教学仿真。",
    },
    {
      roleId: "role-rights-contact",
      entityId: "entity-rights-contact",
      displayName: "许老师",
      professionalRole: "素材权利联络人",
      publicGoal: "核对作者、人物同意、用途、期限、平台与 AI 标识边界。",
      privatePressure: "仿真：热门近景图只获线下展示许可，不包含商业短视频与二次剪辑。",
      disclosureRules: ["可以确认授权范围和缺口", "不代替权利人作新许可", "授权撤回或范围不明时要求替换或补证"],
      simulationNotice: "素材、许可范围和权利争议均为教学仿真。",
    },
    {
      roleId: "role-platform-duty",
      entityId: "entity-platform-duty",
      displayName: "乔安",
      professionalRole: "融媒体平台值守",
      publicGoal: "按平台事实、权利、标题与标识规则给出可追溯发布回执。",
      privatePressure: "仿真：热点窗口流量较高，但误导标题、未授权近景和不透明修改会触发退回或投诉升级。",
      disclosureRules: ["只说明命中规则与修订入口", "不替学生重写作品", "发布后保留更正、下架和回应链"],
      simulationNotice: "平台、规则命中与传播反馈均为教学仿真。",
    },
  ],
  artifacts: [
    {
      artifactId: "artifact-topic-brief",
      title: "选题工单",
      artifactKind: "topic_brief",
      conflictDomainRefs: ["conflict-editorial-framing"],
      requiredAtChallengeLevels: allLevels,
      editableFields: [
        { fieldId: "angle", label: "报道角度", minimumLength: 24, maximumLength: 320 },
        { fieldId: "audience", label: "核心受众", minimumLength: 8, maximumLength: 160 },
        { fieldId: "public_value", label: "公共价值", minimumLength: 24, maximumLength: 320 },
        { fieldId: "risk_plan", label: "风险与时间计划", minimumLength: 24, maximumLength: 400 },
      ],
      completionChecks: ["角度不把簪花围等同于猎奇视觉", "明确至少一类公众问题", "列出时间预算与放弃条件"],
      evidenceRequirements: ["至少引用一条文化来源", "记录采纳或拒绝编辑建议的理由"],
    },
    {
      artifactId: "artifact-source-matrix",
      title: "信源矩阵",
      artifactKind: "source_matrix",
      conflictDomainRefs: ["conflict-interview-interest", "conflict-fact-source"],
      requiredAtChallengeLevels: allLevels,
      editableFields: [
        { fieldId: "claims", label: "主张与出处", minimumLength: 80, maximumLength: 1800 },
        { fieldId: "conflicts", label: "冲突与待核项", minimumLength: 24, maximumLength: 900 },
      ],
      completionChecks: ["至少三类不同立场信源", "区分原始来源与转引", "每项主张具有状态"],
      evidenceRequirements: ["来源定位", "核验行动", "状态变化收据"],
    },
    {
      artifactId: "artifact-interview-plan-log",
      title: "采访提纲与对话记录",
      artifactKind: "interview_plan_and_log",
      conflictDomainRefs: ["conflict-interview-interest"],
      requiredAtChallengeLevels: allLevels,
      editableFields: [
        { fieldId: "questions", label: "自写问题与追问", minimumLength: 80, maximumLength: 1800 },
        { fieldId: "consent", label: "公开、匿名与删题边界", minimumLength: 24, maximumLength: 600 },
      ],
      completionChecks: ["存在开放问题和证据追问", "明确用途与公开范围", "记录拒答、承诺或删题"],
      evidenceRequirements: ["NPC 回答引用", "学生追问", "同意或匿名范围"],
    },
    {
      artifactId: "artifact-fact-check-sheet",
      title: "事实核查表",
      artifactKind: "fact_check_sheet",
      conflictDomainRefs: ["conflict-fact-source", "conflict-breaking-safety"],
      requiredAtChallengeLevels: allLevels,
      editableFields: [
        { fieldId: "fact_items", label: "逐条事实、证据与置信度", minimumLength: 120, maximumLength: 2400 },
        { fieldId: "final_wording", label: "最终限定措辞", minimumLength: 24, maximumLength: 900 },
      ],
      completionChecks: ["确定事实与待核说法分开", "年份和客流不可跨年度拼接", "公共安全表述标明时点"],
      evidenceRequirements: ["原始来源", "专家或官方回应", "修订差异"],
    },
    {
      artifactId: "artifact-rights-ledger",
      title: "素材权利台账",
      artifactKind: "rights_ledger",
      conflictDomainRefs: ["conflict-material-rights"],
      requiredAtChallengeLevels: [5, 6, 7],
      editableFields: [
        { fieldId: "materials", label: "作者、人物、渠道与元数据", minimumLength: 80, maximumLength: 1800 },
        { fieldId: "permission_scope", label: "用途、期限、平台和 AI 标识", minimumLength: 40, maximumLength: 900 },
      ],
      completionChecks: ["每项素材有来源", "肖像与版权范围分开", "撤回或缺口具有替代方案"],
      evidenceRequirements: ["元数据", "授权回复", "替换或限用途决定"],
    },
    {
      artifactId: "artifact-feature-story",
      title: "专题稿",
      artifactKind: "feature_story",
      conflictDomainRefs: ["conflict-editorial-framing", "conflict-post-publication"],
      requiredAtChallengeLevels: allLevels,
      editableFields: [
        { fieldId: "headline", label: "标题", minimumLength: 8, maximumLength: 60 },
        { fieldId: "lead", label: "导语", minimumLength: 40, maximumLength: 280 },
        { fieldId: "body", label: "正文", minimumLength: 480, maximumLength: 3600 },
        { fieldId: "disclosure", label: "来源与 AI 使用披露", minimumLength: 20, maximumLength: 600 },
      ],
      completionChecks: ["主张能够回指信源矩阵", "引用与授权状态一致", "至少保存 R1 和 R2 两个版本"],
      evidenceRequirements: ["逐版本 diff", "事实引用", "建议取舍理由"],
    },
    {
      artifactId: "artifact-multiplatform-script",
      title: "多平台脚本",
      artifactKind: "multiplatform_script",
      conflictDomainRefs: ["conflict-material-rights", "conflict-breaking-safety"],
      requiredAtChallengeLevels: [5, 6, 7],
      editableFields: [
        { fieldId: "graphic_summary", label: "图文摘要", minimumLength: 80, maximumLength: 600 },
        { fieldId: "video_script", label: "短视频分镜或口播", minimumLength: 160, maximumLength: 1800 },
        { fieldId: "breaking_update", label: "限定性快讯", minimumLength: 40, maximumLength: 360 },
      ],
      completionChecks: ["各平台不改变事实边界", "画面与授权台账一致", "快讯标明时间与未知项"],
      evidenceRequirements: ["平台适配理由", "治理检查", "素材引用"],
    },
    {
      artifactId: "artifact-publication-correction-decision",
      title: "发布与更正决定",
      artifactKind: "publication_and_correction_decision",
      conflictDomainRefs: ["conflict-breaking-safety", "conflict-post-publication"],
      requiredAtChallengeLevels: allLevels,
      editableFields: [
        { fieldId: "publication_plan", label: "时间、渠道、限制与未知项", minimumLength: 60, maximumLength: 900 },
        { fieldId: "correction_note", label: "更正、下架或坚持理由", minimumLength: 40, maximumLength: 900 },
      ],
      completionChecks: ["正式发布前进入对应教师门", "说明仍未知的事实", "保留公开更正入口"],
      evidenceRequirements: ["教师门决定", "世界后果", "公开反馈"],
    },
    {
      artifactId: "artifact-transfer-reflection",
      title: "迁移复盘",
      artifactKind: "transfer_reflection",
      conflictDomainRefs: ["conflict-post-publication"],
      requiredAtChallengeLevels: allLevels,
      editableFields: [
        { fieldId: "critical_decisions", label: "关键判断与后果", minimumLength: 120, maximumLength: 1600 },
        { fieldId: "ai_decisions", label: "AI 建议采纳、补证或拒绝", minimumLength: 80, maximumLength: 1200 },
        { fieldId: "next_job_transfer", label: "迁移到下一岗位情境", minimumLength: 80, maximumLength: 1200 },
      ],
      completionChecks: ["至少引用两次真实轨迹", "包含一次失误或不确定判断", "提出下一场可执行改进"],
      evidenceRequirements: ["工作行动", "作品版本", "NPC/教师决定与世界后果"],
    },
  ],
  rubricBlueprints: [
    {
      criterionId: "criterion-fact-verification",
      title: "事实与信源核验",
      weight: 20,
      artifactRefs: ["artifact-source-matrix", "artifact-fact-check-sheet", "artifact-feature-story"],
      observableEvidence: ["主张能够回指原始来源", "识别转引和年份冲突", "对未知项使用限定措辞", "发现错误后修订正文"],
      minimumIndependentEvidenceCount: 3,
      failClosedWhen: ["只有作品最终文本而无核验过程", "来源定位缺失", "把仿真隐藏事实当成公开事实"],
    },
    {
      criterionId: "criterion-interview-consent",
      title: "采访、沟通与知情边界",
      weight: 18,
      artifactRefs: ["artifact-interview-plan-log", "artifact-publication-correction-decision"],
      observableEvidence: ["说明身份与用途", "围绕矛盾进行追问", "记录匿名、删题与撤回", "承诺越界后主动修复"],
      minimumIndependentEvidenceCount: 3,
      failClosedWhen: ["只有预写提纲而无真实 NPC 对话", "没有公开范围记录", "忽略撤回仍提交"],
    },
    {
      criterionId: "criterion-editorial-judgment",
      title: "编辑判断与独立性",
      weight: 18,
      artifactRefs: ["artifact-topic-brief", "artifact-feature-story", "artifact-publication-correction-decision"],
      observableEvidence: ["角度连接公共价值", "识别商业交换", "解释时效与核验取舍", "拒绝或披露利益关系"],
      minimumIndependentEvidenceCount: 3,
      failClosedWhen: ["只记录选择结果而无理由", "用触达替代公共价值", "作品隐藏商业条件"],
    },
    {
      criterionId: "criterion-rights-governance",
      title: "素材权利与内容治理",
      weight: 16,
      artifactRefs: ["artifact-rights-ledger", "artifact-multiplatform-script", "artifact-publication-correction-decision"],
      observableEvidence: ["核对作者与人物同意", "区分用途、平台与期限", "撤回后替换或补授权", "平台标识与标题合规"],
      minimumIndependentEvidenceCount: 3,
      failClosedWhen: ["素材只有截图或链接", "权利范围不明仍标记可用", "教师门未决仍发布"],
    },
    {
      criterionId: "criterion-multiplatform-production",
      title: "融媒体作品生产与适配",
      weight: 14,
      artifactRefs: ["artifact-feature-story", "artifact-multiplatform-script"],
      observableEvidence: ["正文具有 R1/R2 差异", "图文、短视频和快讯保持同一事实边界", "平台适配有受众与渠道理由"],
      minimumIndependentEvidenceCount: 2,
      failClosedWhen: ["只有完成布尔值", "没有正文内容哈希", "多个平台版本相互矛盾"],
    },
    {
      criterionId: "criterion-recovery-transfer",
      title: "纠错恢复、协作与迁移",
      weight: 14,
      artifactRefs: ["artifact-publication-correction-decision", "artifact-transfer-reflection"],
      observableEvidence: ["发现失误后补证或公开更正", "能够说明 AI 建议取舍", "把本场策略迁移到下一岗位问题"],
      minimumIndependentEvidenceCount: 2,
      failClosedWhen: ["复盘没有引用真实轨迹", "只因终局安全就判定高能力", "只因使用支架就直接扣分"],
    },
  ],
  assessmentBoundary: {
    artifactCompletionIsNotCompetencyScore: true,
    insufficientEvidenceStatus: "insufficient_evidence",
    finalAuthority: "teacher",
  },
  conflictDomains: [
    {
      conflictDomainId: "conflict-editorial-framing",
      title: "选题与编辑要求",
      worldProblem: "热点角度、公共价值、文化解释和发布时间谁优先。",
      activationTriggers: ["world_start", "student_observes_editorial_brief", "deadline_threshold"],
      proactiveTriggerKinds: ["student", "clock", "threshold"],
      principalRoleRefs: ["role-responsible-editor"],
      coreVariableRefs: ["deadline_pressure", "editorial_independence", "reach_potential"],
      eventTemplateRefs: ["event-template-topic-brief", "event-template-clock"],
      availableStudentVerbs: ["observe", "ask", "compare", "draft", "wait"],
      requiredArtifactRefs: ["artifact-topic-brief", "artifact-feature-story"],
      alternativeRoutes: [
        { routeId: "route-angle-first", label: "先定题再访", steps: ["浏览公开材料", "提交暂定角度", "带问题进入现场"], tradeoff: "节奏清楚，但可能因现场新事实返工。" },
        { routeId: "route-field-first", label: "先访后定", steps: ["先说明采访范围", "收集人物问题", "再锁定角度"], tradeoff: "文化主体更充分，但消耗发布窗口。" },
      ],
      recoveryConditions: ["角度被否定后可保留来源并新建工单版本", "错过首轮窗口后可转为审慎深度稿"],
    },
    {
      conflictDomainId: "conflict-interview-interest",
      title: "采访、隐私与利益关系",
      worldProblem: "采访价值、家庭边界、匿名承诺和商业交换条件发生冲突。",
      activationTriggers: ["student_contacts_community", "merchant_offers_material", "community_trust_threshold"],
      proactiveTriggerKinds: ["student", "npc", "threshold"],
      principalRoleRefs: ["role-community-source", "role-merchant-partner"],
      coreVariableRefs: ["community_trust", "source_access", "editorial_independence"],
      eventTemplateRefs: ["event-template-gatekeeper", "event-template-inheritor", "event-template-community-source", "event-template-shopkeeper", "event-template-commercial-response"],
      availableStudentVerbs: ["ask", "probe", "negotiate", "wait", "escalate"],
      requiredArtifactRefs: ["artifact-interview-plan-log", "artifact-source-matrix"],
      alternativeRoutes: [
        { routeId: "route-community-first", label: "社区关系优先", steps: ["说明用途", "协商公开范围", "取得人物线索"], tradeoff: "信任较高，但素材和商业信息到手较慢。" },
        { routeId: "route-merchant-first", label: "素材入口优先", steps: ["听取素材条件", "拆分授权与植入", "再向社区交叉核实"], tradeoff: "素材丰富，但必须承担利益披露与独立性压力。" },
        { routeId: "route-alternate-source", label: "拒绝条件并转向替代信源", steps: ["明确拒绝商业承诺", "记录缺失", "访问其他人物或公开档案"], tradeoff: "独立性稳定，但时间和可访问性下降。" },
      ],
      recoveryConditions: ["被拒访后可缩小问题或转为匿名", "承诺越界后可主动道歉、撤回问题并重建范围"],
    },
    {
      conflictDomainId: "conflict-fact-source",
      title: "事实与信源冲突",
      worldProblem: "非遗概念、年份、客流与起源说法在官方材料、转引和口述之间冲突。",
      activationTriggers: ["student_inspects_source", "student_requests_official_data", "researcher_challenges_claim"],
      proactiveTriggerKinds: ["student", "npc"],
      principalRoleRefs: ["role-heritage-researcher", "role-public-liaison"],
      coreVariableRefs: ["evidence_confidence", "deadline_pressure", "correction_debt"],
      eventTemplateRefs: ["event-template-source-check", "event-template-researcher-probe", "event-template-official-request", "event-template-compare-sources"],
      availableStudentVerbs: ["probe", "inspect", "compare", "wait", "draft", "escalate"],
      requiredArtifactRefs: ["artifact-source-matrix", "artifact-fact-check-sheet"],
      alternativeRoutes: [
        { routeId: "route-wait-official", label: "等待完整口径", steps: ["提交核验请求", "等待汇总窗口", "更新确定事实"], tradeoff: "准确性高但截稿压力上升。" },
        { routeId: "route-bounded-claim", label: "先发限定表达", steps: ["说明数据时点", "保留未知项", "承诺后续更新"], tradeoff: "保留时效，但需要公开更新与更正能力。" },
        { routeId: "route-remove-claim", label: "删除争议主张", steps: ["移除无法核验数字", "保留文化事实", "记录删改理由"], tradeoff: "风险最低，但叙事信息量与传播潜力下降。" },
      ],
      recoveryConditions: ["错误年份可通过原始名录和地方标准交叉更正", "未完成客流数据可改为带时点的状态说明"],
    },
    {
      conflictDomainId: "conflict-material-rights",
      title: "素材、肖像与授权范围",
      worldProblem: "热门素材来源、人物同意、授权平台和二次剪辑范围不一致。",
      activationTriggers: ["student_imports_material", "rights_contact_flags_scope", "tourist_withdraws_consent"],
      proactiveTriggerKinds: ["student", "npc"],
      principalRoleRefs: ["role-rights-contact", "role-platform-duty"],
      coreVariableRefs: ["copyright_risk", "platform_risk", "reach_potential"],
      eventTemplateRefs: ["event-template-rights-inspection", "event-template-rights-contact", "event-template-visual-consent"],
      availableStudentVerbs: ["inspect", "compare", "negotiate", "draft", "wait", "escalate"],
      requiredArtifactRefs: ["artifact-rights-ledger", "artifact-multiplatform-script"],
      alternativeRoutes: [
        { routeId: "route-replace-material", label: "立即替换", steps: ["停用争议近景", "选择自制远景或无人物画面", "更新脚本"], tradeoff: "快速降险，但视觉冲击与触达可能下降。" },
        { routeId: "route-wait-permission", label: "等待补授权", steps: ["列明用途", "联系权利人", "保存可验证回复"], tradeoff: "保留素材价值，但消耗发布窗口。" },
        { routeId: "route-limit-use", label: "限制用途并披露", steps: ["缩小平台和期限", "显式标识", "进入权利教师门"], tradeoff: "可折中使用，但条件复杂且必须严格执行。" },
      ],
      recoveryConditions: ["撤回后可替换、打码或重获授权", "误用未发布时可阻断并重建台账"],
    },
    {
      conflictDomainId: "conflict-breaking-safety",
      title: "突发、拥挤传闻与公共安全",
      worldProblem: "降雨、拥挤和疏导传闻出现，编辑要求立即形成多平台快讯。",
      activationTriggers: ["virtual_minute_threshold", "safety_rumor_emerges", "public_liaison_updates"],
      proactiveTriggerKinds: ["clock", "npc", "threshold"],
      principalRoleRefs: ["role-public-liaison", "role-responsible-editor", "role-platform-duty"],
      coreVariableRefs: ["public_safety_risk", "public_trust", "deadline_pressure"],
      eventTemplateRefs: ["event-template-safety-rumor", "event-template-limited-alert", "event-template-clock"],
      availableStudentVerbs: ["observe", "inspect", "compare", "wait", "draft", "escalate", "submit"],
      requiredArtifactRefs: ["artifact-fact-check-sheet", "artifact-multiplatform-script", "artifact-publication-correction-decision"],
      alternativeRoutes: [
        { routeId: "route-limited-alert", label: "发布限定性提醒", steps: ["确认权威主体", "标注时点和未知项", "发布服务信息"], tradeoff: "兼顾时效与安全，但需要持续更新。" },
        { routeId: "route-wait-safety", label: "等待权威确认", steps: ["并列记录线索", "联系联络员", "暂缓发布"], tradeoff: "降低误导风险，但可能错过服务窗口。" },
        { routeId: "route-refuse-rumor", label: "拒绝转发传闻", steps: ["说明证据缺口", "保留内部核验", "转向已确认服务信息"], tradeoff: "公众风险最低，但短期触达较弱。" },
      ],
      recoveryConditions: ["错误快讯可公开更正并保留旧版本", "延误后可转为深度解释与服务更新"],
    },
    {
      conflictDomainId: "conflict-post-publication",
      title: "发布后反馈与更正",
      worldProblem: "平台警告、社区质疑、权利投诉、转载或线索反转要求记者继续承担责任。",
      activationTriggers: ["story_published", "platform_flags_story", "community_challenges_framing"],
      proactiveTriggerKinds: ["npc", "threshold"],
      principalRoleRefs: ["role-platform-duty", "role-community-source", "role-responsible-editor"],
      coreVariableRefs: ["public_trust", "reach_potential", "correction_debt", "platform_risk"],
      eventTemplateRefs: ["event-template-publication", "event-template-platform-feedback", "event-template-community-challenge", "event-template-correction"],
      availableStudentVerbs: ["inspect", "probe", "draft", "escalate", "submit"],
      requiredArtifactRefs: ["artifact-feature-story", "artifact-publication-correction-decision", "artifact-transfer-reflection"],
      alternativeRoutes: [
        { routeId: "route-public-correction", label: "公开更正并解释", steps: ["定位错误版本", "补充证据", "发布更正说明"], tradeoff: "短期暴露失误，但更有机会恢复长期信任。" },
        { routeId: "route-takedown-rebuild", label: "下架并重建", steps: ["暂停传播", "通知相关人物", "重做作品与发布门"], tradeoff: "损失触达和时效，但适用于不可逆高风险。" },
        { routeId: "route-defend-with-evidence", label: "保留作品并公开证据", steps: ["核对质疑", "发布来源清单", "解释不修改理由"], tradeoff: "若证据充分可维护专业判断；若判断错误会放大反噬。" },
      ],
      recoveryConditions: ["流量反噬可通过公开更正与补证转为可恢复失败", "治理失败必须先下架或阻断再进入复盘"],
    },
  ],
  challengeProfiles: [
    {
      challengeLevel: 3,
      scoreCeiling: challengeScoreCeiling(3),
      concurrentConflictLimit: 1,
      scaffoldingBudget: 5,
      npcResistance: "多数人物合作；关键证据缺口会被明确提示。",
      deadlinePattern: "单一任务完成后才推进五分钟，首轮发布窗口宽松。",
      eventTemplateRefs: level3Events,
      protectionRules: ["一次只出现一个主冲突", "允许多次补证", "不触发复合权利与安全危机"],
    },
    {
      challengeLevel: 4,
      scoreCeiling: challengeScoreCeiling(4),
      concurrentConflictLimit: 2,
      scaffoldingBudget: 4,
      npcResistance: "人物保留部分信息；有效追问后才提供定位或条件。",
      deadlinePattern: "出现一次并行等待与轻度催办。",
      eventTemplateRefs: level4Events,
      protectionRules: ["保留至少两条合法来源路径", "商业条件可以拒绝且不会直接封死课程"],
    },
    {
      challengeLevel: 5,
      scoreCeiling: challengeScoreCeiling(5),
      concurrentConflictLimit: 2,
      scaffoldingBudget: 3,
      npcResistance: "口径矛盾、回应延迟与条件交换并存。",
      deadlinePattern: "两项工作并行，等待会真实消耗发布窗口。",
      eventTemplateRefs: level5Events,
      protectionRules: ["至少一条恢复路径始终开放", "高风险素材必须可替换或补授权"],
    },
    {
      challengeLevel: 6,
      scoreCeiling: challengeScoreCeiling(6),
      concurrentConflictLimit: 3,
      scaffoldingBudget: 2,
      npcResistance: "人物会质疑、拒绝或因学生承诺改变合作程度。",
      deadlinePattern: "三项冲突可能叠加，平台反馈不会等待学生完成当前卡片。",
      eventTemplateRefs: level6Events,
      protectionRules: ["教师可暂停高风险事件", "不得制造无来源事实或不可解释随机惩罚"],
    },
    {
      challengeLevel: 7,
      scoreCeiling: challengeScoreCeiling(7),
      concurrentConflictLimit: 4,
      scaffoldingBudget: 1,
      npcResistance: "合理范围内强势追问、撤回承诺并施加事实、权利与安全复合压力。",
      deadlinePattern: "强时间压力与发布后延迟后果并存。",
      eventTemplateRefs: level7Events,
      protectionRules: ["禁止羞辱与违法诱导", "禁止无解陷阱", "任何失败都保留复盘或纠错出口"],
    },
  ],
  teacherGates: [
    {
      gateId: "gate-interview-rights",
      title: "采访对象身份、隐私与撤回权教师门",
      gateKind: "privacy_and_consent",
      entryConditions: ["近景、家庭或未成年人信息拟公开", "受访者撤回或授权范围不清"],
      resubmissionConditions: ["完成匿名、删题、替换或新授权", "说明作品版本和影响范围"],
    },
    {
      gateId: "gate-publication-risk",
      title: "事实、公共安全、版权与平台正式发布门",
      gateKind: "publication_risk",
      entryConditions: ["正式对外发布", "重大事实仍有冲突", "公共安全、版权或平台风险为高"],
      resubmissionConditions: ["明确缺口和可再次提交条件", "修订作品、证据与权利台账必须同版本"],
    },
    {
      gateId: "gate-final-assessment",
      title: "最终能力评价与课程归档门",
      gateKind: "final_assessment",
      entryConditions: ["世界已进入终局", "必交成果与真实轨迹齐备"],
      resubmissionConditions: ["缺证据维度保持 insufficient，不补造分数", "教师逐维引用证据并记录分歧"],
    },
  ],
  endings: [
    {
      endingId: "ending-trusted-collaboration",
      title: "可信合作",
      endingKind: "trusted_collaboration",
      conditionSummary: "证据充分、授权清楚、社区信任较高，并在发布窗口内透明说明未知项。",
      learningMeaning: "准确、权益、文化主体与传播可以通过专业取舍共同维护。",
    },
    {
      endingId: "ending-prudent-delay",
      title: "审慎延误",
      endingKind: "prudent_delay",
      conditionSummary: "作品可信且关系良好，但因等待核验或补授权错过部分传播窗口。",
      learningMeaning: "讨论时效与审慎的合理边界，不把延误自动判为低能力。",
    },
    {
      endingId: "ending-traffic-backlash",
      title: "流量反噬",
      endingKind: "traffic_backlash",
      conditionSummary: "触达较高，但事实、权利或透明度债务在发布后形成质疑、更正或下架。",
      learningMeaning: "短期指标与长期公共信任发生可观察冲突。",
    },
    {
      endingId: "ending-governance-failure",
      title: "治理失败",
      endingKind: "governance_failure",
      conditionSummary: "无视同意、授权或公共安全高风险门，造成投诉、阻断或撤稿。",
      learningMeaning: "失败终局仍可产生纠错能力证据，但不能被动画惩罚替代专业复盘。",
    },
  ],
  timingPlan: [
    { phaseId: "phase-brief", minutes: 4, purpose: "读取编辑工单与公开材料，形成初始角度。", reorderable: false },
    { phaseId: "phase-access", minutes: 5, purpose: "说明身份与边界，取得现场准入。", reorderable: true },
    { phaseId: "phase-interview", minutes: 9, purpose: "完成至少一名社区人物和一名利益相关方的多轮采访。", reorderable: true },
    { phaseId: "phase-verification", minutes: 8, purpose: "处理术语、年份、客流或起源说法冲突。", reorderable: true },
    { phaseId: "phase-rights", minutes: 6, purpose: "建立素材权利与人物同意台账。", reorderable: true },
    { phaseId: "phase-breaking", minutes: 7, purpose: "响应时钟或阈值触发的公共安全突发。", reorderable: true },
    { phaseId: "phase-drafting", minutes: 7, purpose: "形成专题稿和多平台版本，至少保存 R1/R2。", reorderable: true },
    { phaseId: "phase-publication", minutes: 4, purpose: "进入高风险发布门并承担渠道选择。", reorderable: false },
    { phaseId: "phase-feedback", minutes: 5, purpose: "处理发布后反馈、更正与迁移复盘。", reorderable: false },
  ],
  answerDemoSteps: [
    "查看世界与编辑工单",
    "编辑一条信源矩阵记录",
    "向社区受访者追问并协商公开范围",
    "由 NPC 或时钟主动触发冲突事实",
    "查看来自真实 AgentRun 的唯一建议",
    "采纳、补证或拒绝并说明理由",
    "修订一段真实作品并形成新内容哈希",
    "教师处理一次高风险发布门",
    "观察信任、风险、传播与后续事件变化",
    "管理员沿同一引用链解释智能体必要性",
  ],
};

export const xunpuFlagshipContentManifestV3: Readonly<
  XunpuFlagshipContentManifestV3
> = deepFreeze({
  ...manifestDraft,
  contentHash: hashCanonical(manifestDraft),
});

function duplicates(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

export function validateXunpuFlagshipContentManifestV3(
  manifest: XunpuFlagshipContentManifestV3,
): XunpuFlagshipContentValidationV3 {
  const issues: XunpuFlagshipContentIssueV3[] = [];
  const issue = (code: string, path: string, message: string) => {
    issues.push({ code, path, message });
  };
  if (manifest.schemaVersion !== XunpuFlagshipContentManifestSchemaVersion) {
    issue("schema_version", "schemaVersion", "旗舰内容 Schema 版本不匹配");
  }
  if (manifest.expectedDurationMinutes < 45 || manifest.expectedDurationMinutes > 60) {
    issue("duration", "expectedDurationMinutes", "完整旗舰必须位于 45—60 分钟");
  }
  if (manifest.principalRoles.length !== 7) {
    issue("role_count", "principalRoles", "旗舰必须固定七类主要岗位角色");
  }
  if (manifest.conflictDomains.length !== 6) {
    issue("conflict_count", "conflictDomains", "旗舰必须固定六组可重排冲突域");
  }
  if (manifest.artifacts.length !== 9) {
    issue("artifact_count", "artifacts", "旗舰必须声明九类真实成果");
  }
  if (manifest.teacherGates.length !== 3) {
    issue("teacher_gate_count", "teacherGates", "旗舰只保留三类教师门");
  }
  if (manifest.endings.length !== 4) {
    issue("ending_count", "endings", "旗舰必须声明四类可解释终局");
  }
  if (manifest.challengeProfiles.map((item) => item.challengeLevel).join(",")
    !== "3,4,5,6,7") {
    issue("challenge_levels", "challengeProfiles", "挑战必须按 3—7 级各声明一次");
  }
  for (const profile of manifest.challengeProfiles) {
    if (profile.scoreCeiling !== challengeScoreCeiling(profile.challengeLevel)) {
      issue("score_ceiling", `challengeProfiles.${profile.challengeLevel}`, "挑战等级与本局上限不一致");
    }
  }
  const roleIds = manifest.principalRoles.map((item) => item.roleId);
  const conflictIds = manifest.conflictDomains.map((item) => item.conflictDomainId);
  const artifactIds = manifest.artifacts.map((item) => item.artifactId);
  const gateIds = manifest.teacherGates.map((item) => item.gateId);
  const endingIds = manifest.endings.map((item) => item.endingId);
  if (duplicates(roleIds)) issue("duplicate_role", "principalRoles", "主要角色 ID 必须唯一");
  if (duplicates(conflictIds)) issue("duplicate_conflict", "conflictDomains", "冲突域 ID 必须唯一");
  if (duplicates(artifactIds)) issue("duplicate_artifact", "artifacts", "成果 ID 必须唯一");
  if (duplicates(gateIds)) issue("duplicate_gate", "teacherGates", "教师门 ID 必须唯一");
  if (duplicates(endingIds)) issue("duplicate_ending", "endings", "终局 ID 必须唯一");
  const roleSet = new Set(roleIds);
  const conflictSet = new Set(conflictIds);
  const artifactSet = new Set(artifactIds);
  for (const role of manifest.principalRoles) {
    if (!role.simulationNotice.includes("教学仿真")) {
      issue("role_simulation_notice", `principalRoles.${role.roleId}`, "每名角色必须明确教学仿真边界");
    }
  }
  for (const hiddenFact of manifest.hiddenScenarioFacts) {
    if (!hiddenFact.simulationOnly
      || !hiddenFact.mustNeverBePresentedAsRealPersonFact
      || hiddenFact.visibleToRoleRefs.some((ref) => !roleSet.has(ref))
      || hiddenFact.mayBecomePublicThrough.length === 0) {
      issue("hidden_fact_boundary", `hiddenScenarioFacts.${hiddenFact.factId}`, "隐藏事实必须是可经行动揭示的教学仿真且只能引用已知角色");
    }
  }
  for (const artifact of manifest.artifacts) {
    if (artifact.conflictDomainRefs.some((ref) => !conflictSet.has(ref))) {
      issue("artifact_conflict_ref", `artifacts.${artifact.artifactId}`, "成果引用了未知冲突域");
    }
    if (artifact.editableFields.length === 0 || artifact.completionChecks.length === 0) {
      issue("artifact_semantics", `artifacts.${artifact.artifactId}`, "成果必须包含真实字段与完成检查");
    }
  }
  for (const conflict of manifest.conflictDomains) {
    if (conflict.principalRoleRefs.some((ref) => !roleSet.has(ref))) {
      issue("conflict_role_ref", `conflictDomains.${conflict.conflictDomainId}`, "冲突域引用了未知角色");
    }
    if (conflict.requiredArtifactRefs.some((ref) => !artifactSet.has(ref))) {
      issue("conflict_artifact_ref", `conflictDomains.${conflict.conflictDomainId}`, "冲突域引用了未知成果");
    }
    if (conflict.alternativeRoutes.length < 2) {
      issue("alternative_routes", `conflictDomains.${conflict.conflictDomainId}`, "每个冲突域至少需要两条合法路径");
    }
    if (conflict.recoveryConditions.length === 0) {
      issue("recovery", `conflictDomains.${conflict.conflictDomainId}`, "冲突域必须保留失败恢复条件");
    }
  }
  if (manifest.rubricBlueprints.reduce((sum, criterion) => sum + criterion.weight, 0) !== 100
    || !manifest.assessmentBoundary.artifactCompletionIsNotCompetencyScore
    || manifest.assessmentBoundary.finalAuthority !== "teacher") {
    issue("assessment_boundary", "rubricBlueprints", "量规必须合计 100 且不能把成果完成直接当能力分");
  }
  for (const criterion of manifest.rubricBlueprints) {
    if (criterion.artifactRefs.some((ref) => !artifactSet.has(ref))
      || criterion.observableEvidence.length === 0
      || criterion.minimumIndependentEvidenceCount < 2
      || criterion.failClosedWhen.length === 0) {
      issue("rubric_evidence", `rubricBlueprints.${criterion.criterionId}`, "量规必须绑定真实成果、多个独立证据和失败关闭条件");
    }
  }
  const proactiveDomains = manifest.conflictDomains.filter((domain) => (
    domain.proactiveTriggerKinds.some((kind) => kind !== "student")
  ));
  if (proactiveDomains.length < 3) {
    issue("proactive_conflicts", "conflictDomains", "至少三组冲突必须能由 NPC、时钟或阈值主动触发");
  }
  const sourceIds = manifest.sourceKnowledgeRefs.map((item) => item.knowledgeId);
  const authoredSourceIds = xunpuCourseRelease.knowledgeRecords.map((item) => item.knowledgeId);
  if (sourceIds.length !== 24 || authoredSourceIds.some((id) => !sourceIds.includes(id))) {
    issue("source_coverage", "sourceKnowledgeRefs", "旗舰必须引用全部 24 条泉州来源记录");
  }
  if (manifest.sourceKnowledgeRefs.some((source) => (
    !source.url.startsWith("https://") || source.locator.trim().length < 5
  ))) {
    issue("source_metadata", "sourceKnowledgeRefs", "来源必须具有 HTTPS 与明确定位");
  }
  if (manifest.sourceRefresh.checkedKnowledgeRefs.some((ref) => !sourceIds.includes(ref))
    || manifest.sourceRefresh.findings.length < 3
    || !manifest.sourceRefresh.expertReviewStillRequired) {
    issue("source_refresh", "sourceRefresh", "来源复查必须引用已登记知识并继续保留专家复核门");
  }
  if (!manifest.factBoundary.allNamedPeopleAreSimulated
    || !manifest.factBoundary.allPrivatePressuresAreSimulated
    || !manifest.factBoundary.publicFactsRequireKnowledgeRefs
    || !manifest.factBoundary.noExternalMediaCopied) {
    issue("fact_boundary", "factBoundary", "真实事实与教学仿真边界不得关闭");
  }
  const { contentHash: _contentHash, ...hashInput } = manifest;
  if (hashCanonical(hashInput) !== manifest.contentHash) {
    issue("content_hash_drift", "contentHash", "旗舰内容哈希漂移");
  }
  return { valid: issues.length === 0, issues };
}

const manifestValidation = validateXunpuFlagshipContentManifestV3(
  xunpuFlagshipContentManifestV3,
);
if (!manifestValidation.valid) {
  throw new Error(`泉州旗舰内容发布失败：${JSON.stringify(manifestValidation.issues)}`);
}

function entity(
  entityId: string,
  entityKind: WorldSimulationRelease["worldEntities"][number]["entityKind"],
  title: string,
  professionalRole: string | null,
  publicDescription: string,
): WorldSimulationRelease["worldEntities"][number] {
  return {
    entityId,
    entityKind,
    title,
    professionalRole,
    publicDescription,
    visibleScopes: ["student", "teacher", "admin"],
    initialStateHash: hashCanonical({ entityId, publicDescription }),
  };
}

const addedEntities: WorldSimulationRelease["worldEntities"] = [
  entity("entity-community-source", "person", "阿环", "蟳埔社区受访者", "愿意谈公开习俗与劳动生活，但会根据采访边界调整公开范围。"),
  entity("entity-researcher", "person", "陈老师", "非遗研究者", "只对可定位材料给确定口径，并明确区分公开事实、解释和待核说法。"),
  entity("entity-public-liaison", "person", "蔡主任", "文旅部门联络员", "提供带时点的公开信息，并说明尚未完成汇总的数据状态。"),
  entity("entity-rights-contact", "person", "许老师", "素材权利联络人", "核对作者、人物同意、用途、平台、期限与二次剪辑范围。"),
  entity("entity-platform-duty", "person", "乔安", "融媒体平台值守", "返回事实、权利、标题与标识规则命中，并保留更正和下架入口。"),
  ...xunpuFlagshipContentManifestV3.artifacts.map((artifact) => entity(
    artifact.artifactId,
    "artifact",
    artifact.title,
    null,
    `学生真实编辑并版本化保存的${artifact.title}；完成状态必须由字段、内容哈希与证据机械校验。`,
  )),
];

const addedRules: WorldSimulationRelease["rules"] = [
  {
    ruleId: "rule-topic-framing",
    title: "选题角度必须连接公共价值与文化主体",
    triggerEventTypes: ["student_observes_editorial_brief"],
    allowedIntentTypes: ["editor_sets_brief"],
    affectedVariableIds: ["editorial_independence", "reach_potential"],
    riskLevel: "low",
    teacherGateId: null,
    deterministicFallbackId: "fallback-topic-framing",
  },
  {
    ruleId: "rule-community-consent",
    title: "社区采访范围随说明、追问和承诺变化",
    triggerEventTypes: ["student_asks_community_source", "teacher_reviews_privacy"],
    allowedIntentTypes: ["community_source_responds", "teacher_bounds_disclosure"],
    affectedVariableIds: ["community_trust", "source_access"],
    riskLevel: "high",
    teacherGateId: "gate-interview-rights",
    deterministicFallbackId: "fallback-community-consent",
  },
  {
    ruleId: "rule-expert-context",
    title: "研究者只把可定位材料提升为确定事实",
    triggerEventTypes: ["student_probes_researcher", "student_compares_sources"],
    allowedIntentTypes: ["researcher_clarifies", "fact_checker_compares"],
    affectedVariableIds: ["evidence_confidence", "community_trust"],
    riskLevel: "low",
    teacherGateId: null,
    deterministicFallbackId: "fallback-expert-context",
  },
  {
    ruleId: "rule-official-data-window",
    title: "未完成汇总的数据只能以状态或限定表达进入作品",
    triggerEventTypes: ["student_requests_official_data"],
    allowedIntentTypes: ["public_liaison_updates"],
    affectedVariableIds: ["evidence_confidence", "deadline_pressure"],
    riskLevel: "medium",
    teacherGateId: null,
    deterministicFallbackId: "fallback-official-data-window",
  },
  {
    ruleId: "rule-rights-ledger",
    title: "素材用途必须与可验证授权范围一致",
    triggerEventTypes: ["student_inspects_rights", "rights_contact_flags_scope"],
    allowedIntentTypes: ["rights_contact_assesses", "governance_requests_replacement"],
    affectedVariableIds: ["copyright_risk", "platform_risk"],
    riskLevel: "high",
    teacherGateId: "gate-interview-rights",
    deterministicFallbackId: "fallback-rights-ledger",
  },
  {
    ruleId: "rule-public-safety-alert",
    title: "公共安全快讯必须标明权威主体、时点与未知项",
    triggerEventTypes: ["safety_rumor_emerges", "student_submits_limited_alert"],
    allowedIntentTypes: ["safety_checker_assesses", "platform_holds_or_publishes_alert"],
    affectedVariableIds: ["public_safety_risk", "public_trust", "deadline_pressure"],
    riskLevel: "high",
    teacherGateId: "gate-publication-risk",
    deterministicFallbackId: "fallback-hold-safety-alert",
  },
  {
    ruleId: "rule-artifact-revision",
    title: "真实作品修订必须产生父版本与内容哈希",
    triggerEventTypes: ["student_drafts_story"],
    allowedIntentTypes: ["editor_reviews_revision"],
    affectedVariableIds: ["evidence_confidence", "deadline_pressure"],
    riskLevel: "low",
    teacherGateId: null,
    deterministicFallbackId: "fallback-save-revision",
  },
  {
    ruleId: "rule-prudent-verification-delay",
    title: "等待核验必须有明确时限与并行工作计划",
    triggerEventTypes: ["student_waits_for_verification"],
    allowedIntentTypes: ["editor_records_prudent_delay"],
    affectedVariableIds: ["deadline_pressure", "evidence_confidence"],
    riskLevel: "low",
    teacherGateId: null,
    deterministicFallbackId: "fallback-bounded-verification-delay",
  },
  {
    ruleId: "rule-post-publication-accountability",
    title: "发布后的质疑、投诉与更正继续改变世界",
    triggerEventTypes: ["platform_flags_story", "community_challenges_framing", "student_submits_correction"],
    allowedIntentTypes: ["platform_returns_feedback", "community_requests_correction", "editor_reviews_correction"],
    affectedVariableIds: ["public_trust", "reach_potential", "correction_debt", "platform_risk"],
    riskLevel: "high",
    teacherGateId: "gate-publication-risk",
    deterministicFallbackId: "fallback-public-correction",
  },
  {
    ruleId: "rule-final-assessment-closure",
    title: "最终评价只归档真实证据与教师裁决",
    triggerEventTypes: ["teacher_records_final_assessment"],
    allowedIntentTypes: ["assessor_records_evidence_decision"],
    affectedVariableIds: ["public_trust"],
    riskLevel: "high",
    teacherGateId: "gate-final-assessment",
    deterministicFallbackId: "fallback-insufficient-assessment-evidence",
  },
];

function event(
  eventTemplateId: string,
  eventType: string,
  title: string,
  sourceKind: WorldSimulationRelease["eventTemplates"][number]["sourceKind"],
  affectedObjectRefs: WorldSimulationRelease["eventTemplates"][number]["affectedObjectRefs"],
  candidateAgentTemplateIds: string[],
  ruleRefs: string[],
  challengeLevels: ChallengeLevel[],
  publicCue: string,
): WorldSimulationRelease["eventTemplates"][number] {
  return {
    eventTemplateId,
    eventType,
    title,
    sourceKind,
    affectedObjectRefs,
    candidateAgentTemplateIds,
    ruleRefs,
    challengeLevels,
    publicCue,
  };
}

const addedEvents: WorldSimulationRelease["eventTemplates"] = [
  event("event-template-topic-brief", "student_observes_editorial_brief", "读取编辑工单并提出选题角度", "student_action", [
    { objectType: "entity", objectId: "entity-editor" },
    { objectType: "artifact", objectId: "artifact-topic-brief" },
    { objectType: "world_variable", objectId: "editorial_independence" },
  ], ["agent-template-editor", "agent-template-teaching-director"], ["rule-topic-framing"], allLevels, "陈编辑只给目标、受众和窗口，不替你决定角度：请先写下公共价值与放弃条件。"),
  event("event-template-community-source", "student_asks_community_source", "与社区受访者协商公开边界", "student_action", [
    { objectType: "entity", objectId: "entity-community-source" },
    { objectType: "artifact", objectId: "artifact-interview-plan-log" },
    { objectType: "world_variable", objectId: "community_trust" },
    { objectType: "world_variable", objectId: "source_access" },
  ], ["agent-template-community-source", "agent-template-competency-assessor"], ["rule-community-consent"], allLevels, "阿环愿意谈公开习俗，但先问：家庭、住址和孩子会不会出现在报道里？"),
  event("event-template-researcher-probe", "student_probes_researcher", "研究者要求区分事实与起源推测", "student_action", [
    { objectType: "entity", objectId: "entity-researcher" },
    { objectType: "artifact", objectId: "artifact-fact-check-sheet" },
    { objectType: "world_variable", objectId: "evidence_confidence" },
  ], ["agent-template-researcher", "agent-template-fact-checker"], ["rule-expert-context"], [4, 5, 6, 7], "陈老师指出：国家级非遗名录、地方标准和网络起源说法不是同一层级证据。"),
  event("event-template-official-request", "student_requests_official_data", "向公共联络员请求带时点数据", "student_action", [
    { objectType: "entity", objectId: "entity-public-liaison" },
    { objectType: "artifact", objectId: "artifact-source-matrix" },
    { objectType: "world_variable", objectId: "deadline_pressure" },
  ], ["agent-template-public-liaison", "agent-template-fact-checker"], ["rule-official-data-window"], [4, 5, 6, 7], "蔡主任只能确认公开材料和下一次汇总时间，最新客流不能提前写成最终数字。"),
  event("event-template-compare-sources", "student_compares_sources", "并列比对原始名录、地方标准与转引", "student_action", [
    { objectType: "entity", objectId: "entity-cultural-association" },
    { objectType: "artifact", objectId: "artifact-source-matrix" },
    { objectType: "world_variable", objectId: "evidence_confidence" },
  ], ["agent-template-fact-checker", "agent-template-researcher"], ["rule-expert-context", "rule-source-verification"], [4, 5, 6, 7], "至少一条网络材料把来源年份写错；请回到原始发布机关和文件定位。"),
  event("event-template-commercial-response", "student_resolves_commercial_exchange", "回应商户素材换曝光条件", "student_action", [
    { objectType: "entity", objectId: "entity-shopkeeper" },
    { objectType: "artifact", objectId: "artifact-topic-brief" },
    { objectType: "artifact", objectId: "artifact-rights-ledger" },
    { objectType: "world_variable", objectId: "editorial_independence" },
    { objectType: "world_variable", objectId: "source_access" },
  ], ["agent-template-shopkeeper", "agent-template-editor"], ["rule-commercial-boundary"], [4, 5, 6, 7], "吴姐正在等待你的明确回应：素材授权、提供方披露和编辑决定可以协商，但标题、首图与套餐曝光不能被默认交换。"),
  event("event-template-rights-inspection", "student_inspects_rights", "核对素材作者、人物与使用范围", "student_action", [
    { objectType: "entity", objectId: "entity-rights-contact" },
    { objectType: "artifact", objectId: "artifact-rights-ledger" },
    { objectType: "world_variable", objectId: "copyright_risk" },
  ], ["agent-template-rights-contact", "agent-template-governance"], ["rule-rights-ledger"], [5, 6, 7], "一张热门近景图只有转发截图，没有作者、原文件和可用于短视频的许可。"),
  event("event-template-rights-contact", "rights_contact_flags_scope", "权利联络人主动指出许可范围不符", "npc_intent", [
    { objectType: "entity", objectId: "entity-rights-contact" },
    { objectType: "artifact", objectId: "artifact-rights-ledger" },
    { objectType: "world_variable", objectId: "copyright_risk" },
    { objectType: "world_variable", objectId: "platform_risk" },
  ], ["agent-template-rights-contact", "agent-template-governance"], ["rule-rights-ledger"], [5, 6, 7], "许老师主动联系：线下展示许可不包含商业短视频与二次剪辑。"),
  event("event-template-safety-rumor", "safety_rumor_emerges", "降雨与拥挤传闻进入编辑部", "system_clock", [
    { objectType: "entity", objectId: "entity-public-liaison" },
    { objectType: "artifact", objectId: "artifact-fact-check-sheet" },
    { objectType: "world_variable", objectId: "public_safety_risk" },
  ], ["agent-template-scene-director", "agent-template-fact-checker", "agent-template-content-safety"], ["rule-public-safety-alert"], [5, 6, 7], "群聊出现“巷口已封闭”的截图，但没有时间、发布主体和现场定位。"),
  event("event-template-limited-alert", "student_submits_limited_alert", "提交带时点与未知项的安全提醒", "student_action", [
    { objectType: "entity", objectId: "entity-platform-duty" },
    { objectType: "artifact", objectId: "artifact-multiplatform-script" },
    { objectType: "world_variable", objectId: "public_trust" },
  ], ["agent-template-public-liaison", "agent-template-content-safety", "agent-template-platform-rule"], ["rule-public-safety-alert"], [5, 6, 7], "快讯必须说明谁在何时确认了什么，以及哪些情况仍待核。"),
  event("event-template-verification-wait", "student_waits_for_verification", "用明确时限等待必要核验", "student_action", [
    { objectType: "entity", objectId: "entity-editor" },
    { objectType: "world_variable", objectId: "deadline_pressure" },
    { objectType: "world_variable", objectId: "evidence_confidence" },
  ], ["agent-template-editor"], ["rule-prudent-verification-delay"], allLevels, "你可以用十分钟等待关键核验，但必须说明等待什么、何时停止，以及期间并行完成什么。"),
  event("event-template-draft-story", "student_drafts_story", "保存专题稿真实修订版本", "student_action", [
    { objectType: "entity", objectId: "entity-editor" },
    { objectType: "artifact", objectId: "artifact-feature-story" },
    { objectType: "world_variable", objectId: "evidence_confidence" },
  ], ["agent-template-editor", "agent-template-competency-assessor"], ["rule-artifact-revision"], allLevels, "稿件必须保存正文、父版本和内容哈希；只点击“完成”不会产生作品。"),
  event("event-template-platform-feedback", "platform_flags_story", "平台主动退回标题或素材", "npc_intent", [
    { objectType: "entity", objectId: "entity-platform-duty" },
    { objectType: "artifact", objectId: "artifact-publication-correction-decision" },
    { objectType: "world_variable", objectId: "platform_risk" },
  ], ["agent-template-platform", "agent-template-platform-rule"], ["rule-post-publication-accountability"], [6, 7], "乔安发来退回原因：标题把未确认数字写成定论，且近景素材许可范围不清。"),
  event("event-template-community-challenge", "community_challenges_framing", "社区受访者主动质疑猎奇化表达", "npc_intent", [
    { objectType: "entity", objectId: "entity-community-source" },
    { objectType: "artifact", objectId: "artifact-feature-story" },
    { objectType: "world_variable", objectId: "community_trust" },
  ], ["agent-template-community-source", "agent-template-editor"], ["rule-post-publication-accountability"], [6, 7], "阿环指出：成稿只剩“网红头饰”和游客镜头，劳动与社区主体被删掉了。"),
  event("event-template-correction", "student_submits_correction", "提交公开更正、下架或坚持说明", "student_action", [
    { objectType: "entity", objectId: "entity-newsroom" },
    { objectType: "artifact", objectId: "artifact-publication-correction-decision" },
    { objectType: "world_variable", objectId: "correction_debt" },
  ], ["agent-template-editor", "agent-template-platform", "agent-template-competency-assessor"], ["rule-post-publication-accountability"], [6, 7], "请选择公开更正、下架重做或保留并公开证据；静默覆盖旧版本不被接受。"),
  event("event-template-teacher-privacy", "teacher_reviews_privacy", "教师处理身份、隐私与撤回权高风险门", "teacher_intervention", [
    { objectType: "entity", objectId: "entity-community-source" },
    { objectType: "artifact", objectId: "artifact-interview-plan-log" },
    { objectType: "world_variable", objectId: "community_trust" },
  ], ["agent-template-teaching-director", "agent-template-governance"], ["rule-community-consent"], [6, 7], "教师只判断公开边界是否可接受，不替学生重写采访记录。"),
  event("event-template-teacher-final-assessment", "teacher_records_final_assessment", "教师按真实证据完成最终能力裁决", "teacher_intervention", [
    { objectType: "entity", objectId: "entity-newsroom" },
    { objectType: "artifact", objectId: "artifact-transfer-reflection" },
  ], ["agent-template-competency-assessor", "agent-template-learner-twin"], ["rule-final-assessment-closure"], [7], "证据不足的维度保持不足，不因安全终局或页面完成而自动给满分。"),
];

const challengeLevelsByEvent = new Map<string, ChallengeLevel[]>();
for (const profile of xunpuFlagshipContentManifestV3.challengeProfiles) {
  for (const eventTemplateId of profile.eventTemplateRefs) {
    const levels = challengeLevelsByEvent.get(eventTemplateId) ?? [];
    levels.push(profile.challengeLevel);
    challengeLevelsByEvent.set(eventTemplateId, levels);
  }
}

export function buildXunpuFlagshipWorldSimulationReleaseV3R2(
  courseReleaseRef: CourseReleaseRef = {
    courseId: xunpuContractCourseRelease.courseId,
    releaseId: xunpuContractCourseRelease.releaseId,
    version: xunpuContractCourseRelease.version,
    contentHash: xunpuContractCourseRelease.contentHash,
  },
): WorldSimulationRelease {
  const base = getXunpuWorldSimulationReleaseV3();
  const worldEntities = [...base.worldEntities, ...addedEntities];
  const variableDefinitions: WorldSimulationRelease["variableDefinitions"] = [
    ...base.variableDefinitions,
    {
      variableId: "public_safety_risk",
      title: "公共安全误导风险",
      valueKind: "bounded",
      minimum: 0,
      maximum: 100,
      initialValue: 12,
      studentProjection: "当前没有经权威确认的高风险安全信息",
      visibleScopes: ["student", "teacher", "admin"],
    },
  ];
  const rules: WorldSimulationRelease["rules"] = [
    ...base.rules.map((rule) => {
      if (rule.ruleId === "rule-consent-withdrawal") {
        return { ...rule, teacherGateId: "gate-interview-rights" };
      }
      if (rule.ruleId === "rule-commercial-boundary") {
        return {
          ...rule,
          triggerEventTypes: [
            ...rule.triggerEventTypes,
            "student_resolves_commercial_exchange",
          ],
        };
      }
      return rule;
    }),
    ...addedRules,
  ];
  const eventTemplates: WorldSimulationRelease["eventTemplates"] = [
    ...base.eventTemplates.map((item) => ({
      ...item,
      challengeLevels: challengeLevelsByEvent.get(item.eventTemplateId)
        ?? item.challengeLevels,
    })),
    ...addedEvents,
  ];
  const endingDefinitions: WorldSimulationRelease["endingDefinitions"] = [
    {
      endingId: "ending-trusted-collaboration",
      endingKind: "professional_success",
      title: "可信合作",
      conditionRuleRefs: ["rule-community-consent", "rule-source-verification", "rule-publication"],
      reflectionPrompt: "哪些真实行为同时维护了事实、文化主体、权利和公共信任？",
    },
    {
      endingId: "ending-prudent-delay",
      endingKind: "deadline_failure",
      title: "审慎延误",
      conditionRuleRefs: ["rule-official-data-window", "rule-virtual-clock"],
      reflectionPrompt: "错过部分窗口是否合理？哪些核验可以前置或并行？",
    },
    {
      endingId: "ending-traffic-backlash",
      endingKind: "recoverable_failure",
      title: "流量反噬",
      conditionRuleRefs: ["rule-publication", "rule-post-publication-accountability"],
      reflectionPrompt: "短期触达如何积累为事实、权利或透明度债务？",
    },
    {
      endingId: "ending-governance-failure",
      endingKind: "governance_failure",
      title: "治理失败",
      conditionRuleRefs: ["rule-consent-withdrawal", "rule-rights-ledger", "rule-publication"],
      reflectionPrompt: "哪一个更早的行动本可避免投诉、阻断或撤稿？",
    },
  ];
  const riskGates: WorldSimulationRelease["riskGates"] = [
    {
      gateId: "gate-interview-rights",
      title: "身份、隐私、肖像与撤回权风险门",
      riskCategory: "ethics",
      requiredReviewerRole: "teacher",
      decisionOptions: ["approve", "revise", "reject"],
    },
    base.riskGates.find((gate) => gate.gateId === "gate-publication-risk")!,
    {
      gateId: "gate-final-assessment",
      title: "最终能力评价与课程归档门",
      riskCategory: "public_trust",
      requiredReviewerRole: "teacher",
      decisionOptions: ["approve", "revise", "reject"],
    },
  ];
  const scenarioReleaseRef = {
    scenarioId: "scenario-xunpu-living-world",
    version: "3.3.0",
    contentHash: hashCanonical({
      manifestHash: xunpuFlagshipContentManifestV3.contentHash,
      runtimeShape: "six-reorderable-conflict-domains",
    }),
  };
  const releaseWithoutSimulationRef = {
    schemaVersion: WorldSimulationReleaseSchemaVersion,
    releaseStatus: "released" as const,
    courseReleaseRef,
    scenarioReleaseRef,
    title: xunpuFlagshipContentManifestV3.title,
    summary: xunpuFlagshipContentManifestV3.premise,
    primaryJobId: "integrated_media_reporter" as const,
    studentRoleId: "reporter" as const,
    expectedDurationMinutes: xunpuFlagshipContentManifestV3.expectedDurationMinutes,
    worldEntities,
    variableDefinitions,
    rules,
    eventTemplates,
    endingDefinitions,
    riskGates,
    challengeVariants: xunpuFlagshipContentManifestV3.challengeProfiles.map((profile) => ({
      worldVariantId: `world-variant-r2-level-${profile.challengeLevel}`,
      challengeLevel: profile.challengeLevel,
      scoreCeiling: profile.scoreCeiling,
      pressureSummary: `${profile.challengeLevel} 级压力：${profile.npcResistance}${profile.deadlinePattern}`,
      eventTemplateRefs: [...profile.eventTemplateRefs],
      scaffoldingBudget: profile.scaffoldingBudget,
    })),
    allowedStudentVerbs: base.allowedStudentVerbs,
    publishedAt: "2026-08-29T05:00:00.000Z",
  };
  const release = WorldSimulationReleaseSchema.parse({
    ...releaseWithoutSimulationRef,
    simulationReleaseRef: {
      simulationId: "simulation-xunpu-living-world",
      releaseId: "simulation-xunpu-living-world-r2.2",
      version: 4,
      contentHash: hashCanonical({
        manifestHash: xunpuFlagshipContentManifestV3.contentHash,
        ...releaseWithoutSimulationRef,
      }),
    },
  });
  return structuredClone(deepFreeze(release));
}

export const xunpuFlagshipWorldSimulationReleaseV3R2 = deepFreeze(
  buildXunpuFlagshipWorldSimulationReleaseV3R2(),
);

const runtimeAgentTemplateAlias = new Map<string, string>([
  ["agent-template-gatekeeper", "agent-template-community-source"],
  ["agent-template-inheritor", "agent-template-researcher"],
  ["agent-template-tourist", "agent-template-rights-contact"],
  ["agent-template-platform-rule", "agent-template-platform"],
]);

/**
 * Binds the immutable R2 content release to the six-group/fourteen-agent
 * runtime cast. World characters are not counted as extra architecture nodes:
 * the field-role templates drive their authorized entity instances while the
 * professional templates retain review, governance and assessment duties.
 */
export function buildXunpuFlagshipRuntimeReleaseV3R2(
  courseReleaseRef: CourseReleaseRef = {
    courseId: xunpuContractCourseRelease.courseId,
    releaseId: xunpuContractCourseRelease.releaseId,
    version: xunpuContractCourseRelease.version,
    contentHash: xunpuContractCourseRelease.contentHash,
  },
  releaseGeneration: "runtime.3" | "runtime.4" = "runtime.4",
): WorldSimulationRelease {
  const contentRelease = buildXunpuFlagshipWorldSimulationReleaseV3R2(
    courseReleaseRef,
  );
  const eventTemplates = contentRelease.eventTemplates.map((template) => ({
    ...template,
    candidateAgentTemplateIds: [
      ...new Set(template.candidateAgentTemplateIds.map((agentTemplateId) => (
        runtimeAgentTemplateAlias.get(agentTemplateId) ?? agentTemplateId
      ))),
    ],
  }));
  const {
    simulationReleaseRef: _contentSimulationReleaseRef,
    ...releaseWithoutSimulationRef
  } = {
    ...contentRelease,
    scenarioReleaseRef: {
      ...contentRelease.scenarioReleaseRef,
      version: "3.3.1",
      contentHash: hashCanonical({
        sourceScenarioRef: contentRelease.scenarioReleaseRef,
        runtimeBinding: "six-groups-fourteen-agents-v2",
      }),
    },
    eventTemplates,
    ...(releaseGeneration === "runtime.4" ? { actionPolicy: xunpuFlagshipActionPolicyV4 } : {}),
    publishedAt: releaseGeneration === "runtime.4" ? "2026-09-07T05:30:00.000Z" : "2026-08-29T05:05:00.000Z",
  };
  const release = WorldSimulationReleaseSchema.parse({
    ...releaseWithoutSimulationRef,
    simulationReleaseRef: {
      simulationId: "simulation-xunpu-living-world",
      releaseId: `simulation-xunpu-living-world-r2-${releaseGeneration}`,
      version: releaseGeneration === "runtime.4" ? 6 : 5,
      contentHash: hashCanonical({
        runtimeAgentBinding: "six-groups-fourteen-agents-v2",
        ...releaseWithoutSimulationRef,
      }),
    },
  });
  return structuredClone(deepFreeze(release));
}
