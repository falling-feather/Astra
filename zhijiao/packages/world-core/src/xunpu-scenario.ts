import { createHash } from "node:crypto";
import {
  ScenarioPackageSchema,
  ScenarioPackageSchemaVersion,
  ScenarioExperienceSchemaVersion,
  type EventType,
  type RoleContract,
  type ScenarioExperienceDesign,
  type ScenarioPackage,
} from "@ronggang/contracts";

const courseId = "course-xunpu-intangible-media";
const scenarioId = "scenario-xunpu-media";
const version = "2.0.0";
const teamId = "team-jiangnan-01";

interface NodeSpec {
  nodeId: string;
  title: string;
  objective: string;
  completionEvent: EventType;
  materialIds: string[];
  requiredOutputs: string[];
  decisionQuestions: string[];
  teacherFocus: string[];
}

const nodeSpecs: NodeSpec[] = [
  {
    nodeId: "xunpu-topic-brief",
    title: "专题选题与受众定位",
    objective: "在热度压力下确定可核验的核心问题、受众与暂缓表述。",
    completionEvent: "evidence_recorded",
    materialIds: ["xunpu-material-case-metadata"],
    requiredOutputs: ["蟳埔专题选题卡", "受众需要分析", "来源边界清单"],
    decisionQuestions: ["哪些说法有公开来源支持？", "哪些标题需要先补证再使用？"],
    teacherFocus: ["观察学生是否把热度当作线索而非事实。"],
  },
  {
    nodeId: "xunpu-source-map",
    title: "信源分级与版本核对",
    objective: "区分官方、研究、采访与平台来源，保留年份、定位和失效状态。",
    completionEvent: "material_observed",
    materialIds: ["xunpu-material-case-metadata", "xunpu-material-standard-metadata"],
    requiredOutputs: ["信源分级表", "冲突说法记录", "补证路线"],
    decisionQuestions: ["不同年份的数据能否直接比较？", "失效页面还能支持现行结论吗？"],
    teacherFocus: ["检查学生是否保留冲突而不是静默挑选更吸睛数字。"],
  },
  {
    nodeId: "xunpu-interview-plan",
    title: "采访设计与知情边界",
    objective: "围绕传承、社区生活和游客体验设计分组问题，并取得用途说明。",
    completionEvent: "role_interaction_responded",
    materialIds: ["xunpu-material-interview-brief"],
    requiredOutputs: ["采访问题组", "知情与录像用途记录", "删题与拒答边界"],
    decisionQuestions: ["采访对象能确认到什么范围？", "拒答后应向哪一类来源补证？"],
    teacherFocus: ["关注学生是否尊重拒答、用途与人物信息边界。"],
  },
  {
    nodeId: "xunpu-field-reporting",
    title: "现场采集与素材台账",
    objective: "区分观察、采访与推断，形成素材权利和现场事实台账。",
    completionEvent: "production_artifact_created",
    materialIds: ["xunpu-material-interview-brief"],
    requiredOutputs: ["现场观察记录", "人物与标识授权台账", "待核事实清单"],
    decisionQuestions: ["画面中的人物和标识是否可发布？", "哪些现场观察不能写成普遍事实？"],
    teacherFocus: ["检查观察、推断和授权状态是否分别记录。"],
  },
  {
    nodeId: "xunpu-fact-check",
    title: "关键主张核验",
    objective: "逐项核验年份、身份、数据口径与来源状态，并记录更正依据。",
    completionEvent: "verification_requested",
    materialIds: ["xunpu-material-case-metadata", "xunpu-material-standard-metadata"],
    requiredOutputs: ["主张核验表", "更正与补证清单", "证据引用"],
    decisionQuestions: ["哪条证据能直接支持当前主张？", "哪些主张必须降级表达？"],
    teacherFocus: ["关注学生是否把智能体建议当作待判断依据而非自动结论。"],
  },
  {
    nodeId: "xunpu-story-revision",
    title: "协同修订与多端表达",
    objective: "在编辑压力下完成事实安全、叙事清晰且适配渠道的版本修订。",
    completionEvent: "artifact_revision_saved",
    materialIds: ["xunpu-material-platform-rules"],
    requiredOutputs: ["专题稿 R1/R2", "修改说明", "渠道适配清单"],
    decisionQuestions: ["哪些修改提升表达但不改变事实边界？", "哪些平台化标题会造成过度承诺？"],
    teacherFocus: ["检查版本差异、来源引用和协作责任是否可追溯。"],
  },
  {
    nodeId: "xunpu-publish-review",
    title: "发布门与迁移复盘",
    objective: "提交最终作品，经教师门处理发布后质疑并完成迁移反思。",
    completionEvent: "teacher_reviewed",
    materialIds: ["xunpu-material-platform-rules", "xunpu-material-standard-metadata"],
    requiredOutputs: ["最终专题作品", "发布与更正记录", "迁移反思"],
    decisionQuestions: ["提交平台审核是否等于发布通过？", "出现年份质疑时如何连续更新？"],
    teacherFocus: ["教师只批准有证据的世界后果，并逐维固定终评。"],
  },
];

function standardRole(input: {
  agentId: string;
  actorKind: RoleContract["actorKind"];
  roleId: RoleContract["roleId"];
  displayName: string;
  purpose: string;
  allowedIntents: string[];
  toolPolicy: string[];
  canInitiate: boolean;
  canRespond: boolean;
  allowedTargetRoleIds: RoleContract["roleId"][];
}): RoleContract {
  return {
    agentId: input.agentId,
    actorKind: input.actorKind,
    roleId: input.roleId,
    displayName: input.displayName,
    purpose: input.purpose,
    teamId,
    visibleScopes: input.actorKind === "teacher" || input.actorKind === "system"
      ? ["public_world", "assigned_team", "role_private", "teacher_only", "audit_only"]
      : ["public_world", "assigned_team", "role_private"],
    privateScopes: [`actor:${input.agentId}`],
    allowedIntents: input.allowedIntents,
    deniedActions: [
      "直接改写权威世界事实",
      "绕过教师门发布或形成最终评价",
      "导出其他角色私有记忆",
    ],
    toolPolicy: input.toolPolicy,
    tokenBudget: input.actorKind === "teacher" ? 8_000 : 4_000,
    memoryPolicy: {
      readOwn: true,
      writeOwn: false,
      auditReadable: true,
      retention: "session_epoch",
      maxEntries: 50,
    },
    communicationPolicy: {
      canInitiate: input.canInitiate,
      canRespond: input.canRespond,
      allowedTargetRoleIds: input.allowedTargetRoleIds,
      maxTurnsPerTarget: 6,
    },
  };
}

const roles: RoleContract[] = [
  standardRole({
    agentId: "teacher-main",
    actorKind: "teacher",
    roleId: "teacher",
    displayName: "周老师",
    purpose: "组织泉州蟳埔专题实训、审批高风险事件并完成终评。",
    allowedIntents: [
      "approve_candidate_event",
      "reject_candidate_event",
      "review_assessment",
      "review_governance",
      "create_learning_candidate",
      "review_learning_candidate",
      "publish_learning_release",
      "rollback_learning_release",
    ],
    toolPolicy: ["memory.read.own", "read_all", "approve_world_event", "review_assessment", "replay_timeline"],
    canInitiate: false,
    canRespond: false,
    allowedTargetRoleIds: [],
  }),
  standardRole({
    agentId: "student-reporter",
    actorKind: "student",
    roleId: "reporter",
    displayName: "融媒体记者",
    purpose: "完成选题、采访、核验、稿件修订、发布与复盘的唯一学生主岗位。",
    allowedIntents: [
      "inspect_material",
      "request_second_verification",
      "send_role_interaction",
      "request_media_processing",
      "retry_media_processing",
      "supply_media_processing_result",
      "create_production_artifact",
      "save_artifact_revision",
      "request_governance_review",
      "submit_for_review",
    ],
    toolPolicy: ["memory.read.own", "read_reviewed_facts", "write_evidence", "upload_material", "edit_artifact", "process_media", "governance.review.request", "submit_work"],
    canInitiate: true,
    canRespond: false,
    allowedTargetRoleIds: ["interviewee", "editor_in_chief", "copyright_owner", "platform_operator"],
  }),
  standardRole({
    agentId: "agent-interviewee",
    actorKind: "agent",
    roleId: "interviewee",
    displayName: "蟳埔社区受访者·阿玲",
    purpose: "只说明亲历的簪花围体验、社区生活与同意公开范围。",
    allowedIntents: ["post_role_response"],
    toolPolicy: ["memory.read.own", "read_reviewed_facts", "write_evidence"],
    canInitiate: false,
    canRespond: true,
    allowedTargetRoleIds: [],
  }),
  standardRole({
    agentId: "agent-chief",
    actorKind: "agent",
    roleId: "editor_in_chief",
    displayName: "责任编辑·林编",
    purpose: "提出选题、结构与事实边界修订意见，不替学生写稿。",
    allowedIntents: ["post_role_response"],
    toolPolicy: ["memory.read.own", "read_reviewed_facts", "write_evidence"],
    canInitiate: false,
    canRespond: true,
    allowedTargetRoleIds: [],
  }),
  standardRole({
    agentId: "agent-copyright",
    actorKind: "agent",
    roleId: "copyright_owner",
    displayName: "素材权利联络人·许老师",
    purpose: "说明人物、标识、图片与录像的授权范围并提出版权候选。",
    allowedIntents: ["post_role_response", "propose_copyright_dispute"],
    toolPolicy: ["memory.read.own", "read_reviewed_facts", "write_evidence"],
    canInitiate: false,
    canRespond: true,
    allowedTargetRoleIds: [],
  }),
  standardRole({
    agentId: "agent-platform",
    actorKind: "agent",
    roleId: "platform_operator",
    displayName: "平台值守·乔安",
    purpose: "说明多端发布、标识、更正与人工复核边界。",
    allowedIntents: ["post_role_response", "propose_platform_escalation"],
    toolPolicy: ["memory.read.own", "read_reviewed_facts", "write_evidence"],
    canInitiate: false,
    canRespond: true,
    allowedTargetRoleIds: [],
  }),
  standardRole({
    agentId: "system",
    actorKind: "system",
    roleId: "system",
    displayName: "世界内核",
    purpose: "保存唯一权威事件流并执行通过教师门的后果。",
    allowedIntents: [],
    toolPolicy: ["memory.read.own", "read_reviewed_facts", "write_evidence"],
    canInitiate: false,
    canRespond: false,
    allowedTargetRoleIds: [],
  }),
];

const materials: ScenarioPackage["materials"] = [
  {
    materialId: "xunpu-material-case-metadata",
    title: "蟳埔簪花围案例公开来源索引",
    mediaType: "document",
    source: "福建省文化和旅游厅等公开页面元数据",
    sourceRef: "demo://xunpu/public-source-metadata-v1",
    version: "1.0",
    copyrightStatus: "restricted",
    visibleToRoles: ["teacher", "reporter", "editor_in_chief", "interviewee"],
  },
  {
    materialId: "xunpu-material-standard-metadata",
    title: "专业教学与全媒体运营职业标准索引",
    mediaType: "document",
    source: "教育部、人力资源和社会保障部公开标准元数据",
    sourceRef: "demo://xunpu/standard-source-metadata-v1",
    version: "1.0",
    copyrightStatus: "restricted",
    visibleToRoles: ["teacher", "reporter", "editor_in_chief"],
  },
  {
    materialId: "xunpu-material-interview-brief",
    title: "仿真采访边界与知情说明",
    mediaType: "text",
    source: "课程仿真材料",
    sourceRef: "demo://xunpu/interview-consent-brief-v1",
    version: "1.0",
    copyrightStatus: "authorized",
    visibleToRoles: ["teacher", "reporter", "interviewee", "editor_in_chief", "copyright_owner"],
  },
  {
    materialId: "xunpu-material-platform-rules",
    title: "多端发布、更正与显式标识仿真清单",
    mediaType: "document",
    source: "课程仿真材料",
    sourceRef: "demo://xunpu/platform-checklist-v1",
    version: "1.0",
    copyrightStatus: "authorized",
    visibleToRoles: ["teacher", "reporter", "editor_in_chief", "copyright_owner", "platform_operator"],
  },
];

const knowledge = [
  {
    chunkId: "xunpu-chunk-source-boundary",
    domain: "course" as const,
    title: "来源、年份与可证范围",
    content: "公开来源必须保留发布者、日期、定位、版本与状态；热度、转述和不同年份数据不能直接替代当前可证事实。",
    nodeId: "xunpu-source-map",
    roleId: null,
    competencyId: "C-XUNPU-SOURCE",
    ruleDomain: "source-verification",
  },
  {
    chunkId: "xunpu-chunk-interview-boundary",
    domain: "course" as const,
    title: "采访知情与拒答边界",
    content: "记者应说明采访和录像用途，尊重拒答、删题和匿名要求，并把不能确认的信息转成下一步补证任务。",
    nodeId: "xunpu-interview-plan",
    roleId: "reporter" as const,
    competencyId: "C-XUNPU-INTERVIEW",
    ruleDomain: "interview-ethics",
  },
  {
    chunkId: "xunpu-chunk-publication-gate",
    domain: "governance" as const,
    title: "平台提交、教师门与更正",
    content: "平台提交不等于审核通过；高风险发布后果必须经教师门，发现年份、版权或标识问题时应保留版本并连续更正。",
    nodeId: "xunpu-publish-review",
    roleId: "reporter" as const,
    competencyId: "C-XUNPU-GOVERNANCE",
    ruleDomain: "publication-governance",
  },
].map((item) => ({
  ...item,
  courseId,
  mediaType: "text",
  source: "泉州蟳埔专题课程知识库（教学转译，待专家复核）",
  version,
  visibility: "assigned_team" as const,
  contentHash: createHash("sha256").update(item.content, "utf8").digest("hex"),
  corpusVersion: "xunpu-course/2.0.0",
  status: "active" as const,
  audience: {
    policyVersion: "acl/1.0.0" as const,
    courseId,
    sessionId: null,
    sessionEpoch: null,
    scopes: ["assigned_team" as const],
    teamIds: [teamId],
    roleIds: item.roleId ? [item.roleId] : [],
    actorIds: [],
    privateNamespaces: [],
    auditReadable: true,
  },
}));

export const xunpuScenarioV200: ScenarioPackage = ScenarioPackageSchema.parse({
  schemaVersion: ScenarioPackageSchemaVersion,
  runtimeProfileId: "local-tourism-media/1.0.0",
  scenarioId,
  courseId,
  version,
  title: "泉州蟳埔簪花围非遗专题采编实战",
  description: "记者单主岗与受控责任编辑、核查、治理、运营智能体协作完成七节连续专题实训。",
  startVirtualTime: "09:00",
  durationMinutes: 120,
  nodes: nodeSpecs.map((node, index) => ({
    nodeId: node.nodeId,
    title: node.title,
    objective: node.objective,
    order: index,
    status: index === 0 ? "active" : index === 1 ? "available" : "locked",
    requiredEvidenceKinds: node.requiredOutputs,
    completionEvent: node.completionEvent,
  })),
  roles,
  materials,
  bootstrap: {
    entryNodeId: "xunpu-topic-brief",
    initialFacts: [
      {
        factId: "xunpu-fact-public-case-exists",
        domain: "heritage-tourism",
        statement: "蟳埔簪花围已有可追溯的公开文旅案例材料，可作为专题选题线索。",
        status: "verified",
        sourceRefs: ["xunpu-material-case-metadata"],
        version: "1.0",
        visibility: "assigned_team",
      },
      {
        factId: "xunpu-fact-viral-claims-unverified",
        domain: "source-verification",
        statement: "热榜中的夸张年份、客流与身份说法尚未逐项核定，不得直接写入权威稿件。",
        status: "unverified",
        sourceRefs: ["xunpu-material-case-metadata"],
        version: "1.0",
        visibility: "assigned_team",
      },
    ],
    openingMessages: [
      {
        actorId: "agent-chief",
        roleId: "editor_in_chief",
        displayName: "责任编辑·林编",
        content: "先把选题的受众、来源口径和暂缓表述写清楚；热榜只能决定核查优先级。",
        visibility: ["role_private", "audit_only"],
        visibleToActorIds: ["student-reporter"],
      },
      {
        actorId: "agent-interviewee",
        roleId: "interviewee",
        displayName: "蟳埔社区受访者·阿玲",
        content: "我愿意介绍亲历的社区生活，但请先说明录像用途，也不要替我概括不能确认的历史说法。",
        visibility: ["role_private", "audit_only"],
        visibleToActorIds: ["student-reporter"],
      },
    ],
    memorySeeds: [
      {
        actorId: "agent-interviewee",
        kind: "episodic",
        content: "只公开亲历的簪花体验、家庭接待变化和同意使用的内容；历史年代由公开权威来源核定。",
      },
      {
        actorId: "agent-platform",
        kind: "working",
        content: "平台人工复核需要精确版本、来源、人物授权、标识和更正联系人；提交不等于审核通过。",
      },
    ],
  },
  roleInteractions: [
    {
      optionId: "xunpu-interview-request-consent",
      initiatorActorId: "student-reporter",
      targetActorId: "agent-interviewee",
      targetRoleId: "interviewee",
      kind: "question",
      topic: "heritage_process",
      label: "说明用途并请求采访",
      description: "向受访者说明文字、图片与录像用途，再询问亲历范围和不能确认的信息。",
      content: "本次内容用于课程仿真的公开专题练习。请说明你同意公开的亲历内容、需要匿名或删题的部分，以及应由其他来源核定的说法。",
      prerequisites: [],
    },
    {
      optionId: "xunpu-chief-review-request",
      initiatorActorId: "student-reporter",
      targetActorId: "agent-chief",
      targetRoleId: "editor_in_chief",
      kind: "request_commitment",
      topic: "release_decision",
      label: "请求责任编辑审阅事实边界",
      description: "提交来源、采访边界与稿件差异，请责任编辑指出必须补证或降级表达的部分。",
      content: "请按来源版本、采访同意、事实主张和多端标题四项审阅当前稿件，只指出问题与修订边界，不代写成稿。",
      prerequisites: [],
    },
    {
      optionId: "xunpu-copyright-scope-request",
      initiatorActorId: "student-reporter",
      targetActorId: "agent-copyright",
      targetRoleId: "copyright_owner",
      kind: "question",
      topic: "copyright_scope",
      label: "核定人物与素材授权范围",
      description: "逐项确认人物、商标、图片和录像可用于哪些渠道与期限。",
      content: "请只依据素材台账说明人物、标识、图片和录像的授权渠道、期限、署名与禁止用途；缺失项保持待补。",
      prerequisites: [],
    },
    {
      optionId: "xunpu-platform-review-request",
      initiatorActorId: "student-reporter",
      targetActorId: "agent-platform",
      targetRoleId: "platform_operator",
      kind: "request_commitment",
      topic: "platform_review",
      label: "提交冻结版本并请求人工复核",
      description: "提交最终版本、来源、授权与标识清单，请平台返回人工复核状态。",
      content: "当前专题已冻结版本并附来源、人物授权、AI辅助说明和更正联系人。请确认是否进入人工复核以及必须保留的回执。",
      prerequisites: [{
        kind: "interaction_responded",
        optionId: "xunpu-copyright-scope-request",
        disabledReason: "先完成素材授权边界核对",
      }],
    },
  ],
  rubricId: "rubric-xunpu-integrated-media",
  rubricVersion: "2.0.0",
  rubric: [
    { criterionId: "xunpu-source-quality", label: "来源与版本", weight: 0.2, rule: "关键主张保留来源、日期、定位、版本和可证范围。", evaluation: { kind: "evidence_count", minimum: 3 } },
    { criterionId: "xunpu-interview-boundary", label: "采访边界", weight: 0.15, rule: "保留用途说明、拒答与下一权威来源。", evaluation: { kind: "event_exists", eventType: "role_interaction_responded" } },
    { criterionId: "xunpu-fact-check", label: "事实核验", weight: 0.2, rule: "冲突主张形成补证、更正或降级表达。", evaluation: { kind: "event_exists", eventType: "verification_requested" } },
    { criterionId: "xunpu-rights", label: "素材权利", weight: 0.15, rule: "人物、标识与素材授权逐项可追溯。", evaluation: { kind: "event_exists", eventType: "governance_reviewed" } },
    { criterionId: "xunpu-revision", label: "稿件修订", weight: 0.15, rule: "版本差异回应核验与渠道要求。", evaluation: { kind: "event_exists", eventType: "artifact_revision_saved" } },
    { criterionId: "xunpu-gate", label: "发布与教师门", weight: 0.1, rule: "高风险后果经教师批准，平台提交不写成审核通过。", evaluation: { kind: "event_exists", eventType: "candidate_event_approved" } },
    { criterionId: "xunpu-reflection", label: "迁移复盘", weight: 0.05, rule: "说明方法如何迁移到另一类地方文旅专题。", evaluation: { kind: "event_exists", eventType: "teacher_reviewed" } },
  ],
  interactionGates: [],
  eventPolicies: [
    {
      policyId: "xunpu-copyright-dispute-policy",
      sourceIntentType: "propose_copyright_dispute",
      sourceRoleId: "copyright_owner",
      requiredOptionId: "xunpu-copyright-scope-request",
      effectHandlerId: "copyright_dispute_v1",
      eventType: "copyright_risk_flagged",
      title: "素材授权范围存在缺口",
      competencyTarget: "素材权利核定与发布阻断",
      expectedImpact: "经教师批准后把版权风险写入世界状态并保持发布阻断。",
      approvalPolicyId: "teacher-xunpu-publication-review",
    },
    {
      policyId: "xunpu-platform-escalation-policy",
      sourceIntentType: "propose_platform_escalation",
      sourceRoleId: "platform_operator",
      requiredOptionId: "xunpu-platform-review-request",
      effectHandlerId: "platform_escalation_v1",
      eventType: "node_activated",
      title: "专题进入平台人工复核",
      competencyTarget: "多端发布、更正与回执判断",
      expectedImpact: "经教师批准后进入发布复盘节点，但不宣称平台审核通过。",
      approvalPolicyId: "teacher-xunpu-publication-review",
    },
  ],
  approvalPolicies: [{
    approvalPolicyId: "teacher-xunpu-publication-review",
    label: "蟳埔专题世界后果教师复核",
    reviewMode: "teacher_required",
    allowReject: true,
    reasonRequired: true,
    minimumEvidenceCount: 1,
  }],
  courseGuide: {
    contentVersion: "2.0.0",
    finalDeliverable: "形成一套可追溯的蟳埔簪花围融媒体专题，包括选题卡、信源表、采访与授权记录、核验表、稿件版本、发布回执和迁移反思。",
    learningObjectives: [
      { objectiveId: "xunpu-objective-source", label: "建立可追溯来源链", competencyId: "C-XUNPU-SOURCE", description: "以来源、版本、定位和可证范围支撑专题关键主张。", evidenceKinds: ["信源表", "核验表", "引用记录"] },
      { objectiveId: "xunpu-objective-reporting", label: "完成现场采访与采集", competencyId: "C-XUNPU-INTERVIEW", description: "在知情、拒答与权利边界内完成采访和素材台账。", evidenceKinds: ["采访线程", "知情记录", "素材台账"] },
      { objectiveId: "xunpu-objective-governance", label: "完成治理发布与复盘", competencyId: "C-XUNPU-GOVERNANCE", description: "经教师门完成多端发布、更正与迁移反思。", evidenceKinds: ["稿件版本", "教师决定", "平台回执"] },
    ],
    roleBriefs: [{
      roleId: "reporter",
      mission: "承担融媒体采编主岗位，完成从选题、采访、核验到发布复盘的连续任务；责任编辑、核查、治理和运营由受控智能体协作。",
      responsibilities: ["判断来源与受众", "完成采访和素材台账", "处理智能体建议", "提交版本与教师门", "完成迁移反思"],
      collaborationRoleIds: ["interviewee", "editor_in_chief", "copyright_owner", "platform_operator"],
      primaryNodeIds: nodeSpecs.map((node) => node.nodeId),
      deliverableTemplateIds: [],
      successSignals: ["关键主张能回到公开来源与采访证据", "学生每次只处理一个最相关建议", "高风险世界后果均经过教师门"],
      decisionBoundaries: ["不得把智能体输出自动写成事实", "不得把平台提交写成审核通过", "不得复制未授权图像或视频"],
    }],
    nodeGuides: nodeSpecs.map((node) => ({
      nodeId: node.nodeId,
      situation: node.objective,
      studentGoal: node.objective,
      requiredOutputs: node.requiredOutputs,
      requiredMaterialIds: node.materialIds,
      suggestedArtifactTemplateIds: [],
      decisionQuestions: node.decisionQuestions,
      teacherFocus: node.teacherFocus,
    })),
    debrief: {
      completionChecklist: ["七节任务进入同一不可变课程发布版", "来源、学生选择、教师门与世界后果可追溯", "最终作品与评价证据对应"],
      reflectionPrompts: ["哪些建议被采纳、补证或拒绝，为什么？", "若迁移到应急报道，哪些来源与教师门方法保持不变？"],
      transferPrompt: "把来源分级、单建议判断、教师门和连续更正方法迁移到另一类地方文旅融媒体任务。",
    },
  },
  knowledgeChunks: knowledge,
});

// Frozen after ScenarioPackageSchema parsing and canonical release hashing.
export const xunpuScenarioV200ContentHash =
  "faf6a5a00ec6824341a1dac8d2d2058703375cd72871351fb469ad6e1a70e0ee";

const interactiveVersion = "2.0.1";
const xunpuApprovalPolicyId = "teacher-xunpu-publication-review";

const xunpuInteractiveSpecs = [
  {
    nodeId: "xunpu-topic-brief",
    sceneId: "xunpu-scene-topic-desk",
    sceneTitle: "蟳埔专题选题台",
    sceneDescription: "从公开案例线索、目标受众与待核验说法中收敛本轮唯一选题。",
    hotspotId: "xunpu-hotspot-topic-board",
    hotspotLabel: "选题依据板",
    npcActorId: "agent-chief",
    npcKnown: "责任编辑掌握专题定位、受众边界与发布风险，但不会替学生决定选题。",
    npcWithheld: "最终选题是否达到课程量规，需要学生先提交可核验依据。",
    tasks: [
      ["xunpu-topic-compare-angles", "比较候选角度", "比较文化传承、社区生活和游客体验三个角度的受众价值与证据基础。"],
      ["xunpu-topic-request-basis", "标记待补依据", "把热榜说法拆成已有公开来源、需要采访补证和暂缓使用三类。"],
      ["xunpu-topic-submit-card", "提交专题选题卡", "冻结核心问题、目标受众、来源边界和暂缓表述，进入教师门。"],
    ],
    agentTemplateId: "assistant/course-navigation",
    contributionLabel: "课程导航智能体提供选题边界检查",
    worldChange: "选题卡完成教师核对后，专题进入信源分级阶段。",
    competencyId: "C-XUNPU-SOURCE",
    evidenceKind: "专题选题卡与来源边界清单",
  },
  {
    nodeId: "xunpu-source-map",
    sceneId: "xunpu-scene-source-lab",
    sceneTitle: "信源分级核验台",
    sceneDescription: "保留发布者、日期、定位、版本和状态，显式呈现冲突与失效来源。",
    hotspotId: "xunpu-hotspot-source-ledger",
    hotspotLabel: "信源版本账本",
    npcActorId: "agent-chief",
    npcKnown: "责任编辑知道哪些说法影响标题风险，但不能把热度或旧页面改写成当前事实。",
    npcWithheld: "冲突来源的最终取舍必须由学生给出版本与定位依据。",
    tasks: [
      ["xunpu-source-classify", "完成信源分级", "按官方、研究、采访和平台线索分类全部来源。"],
      ["xunpu-source-check-version", "核对来源版本", "记录发布时间、访问时间、页码或条款，并识别失效页面。"],
      ["xunpu-source-decide-suggestion", "提交补证路线", "保留冲突说法并冻结下一步采访或公开来源补证路线。"],
    ],
    agentTemplateId: "assistant/material-understanding",
    contributionLabel: "材料理解智能体提示版本与定位缺口",
    worldChange: "信源版本账本经教师核对后，采访设计任务开放。",
    competencyId: "C-XUNPU-SOURCE",
    evidenceKind: "信源分级表、版本定位与补证路线",
  },
  {
    nodeId: "xunpu-interview-plan",
    sceneId: "xunpu-scene-interview-room",
    sceneTitle: "社区采访准备区",
    sceneDescription: "围绕传承、社区生活与游客体验分组提问，并明确用途、拒答和删题边界。",
    hotspotId: "xunpu-hotspot-interviewee",
    hotspotLabel: "受访者沟通席",
    npcActorId: "agent-interviewee",
    npcKnown: "受访者只确认亲历的社区生活与簪花体验，并愿意说明可公开范围。",
    npcWithheld: "无法亲历确认的历史年代和统计结论不会因采访压力而披露。",
    tasks: [
      ["xunpu-interview-build-question-groups", "编排采访问题组", "按事实、体验与追问三层组织问题，避免诱导式提问。"],
      ["xunpu-interview-request-consent", "取得知情同意", "说明文字、图片与录像用途，记录匿名、删题和拒答要求。"],
      ["xunpu-interview-handle-pressure", "处理采访边界", "把拒答与不能确认的信息转换成公开来源补证任务。"],
    ],
    agentTemplateId: "assistant/interview-structuring",
    contributionLabel: "采访结构化智能体检查知情与追问边界",
    worldChange: "采访边界经教师核对后，现场采集任务开放。",
    competencyId: "C-XUNPU-INTERVIEW",
    evidenceKind: "采访问题组、知情记录与拒答边界",
  },
  {
    nodeId: "xunpu-field-reporting",
    sceneId: "xunpu-scene-field-site",
    sceneTitle: "蟳埔现场采集区",
    sceneDescription: "区分现场观察、人物引语与记者推断，同时建立人物、标识和素材权利台账。",
    hotspotId: "xunpu-hotspot-field-ledger",
    hotspotLabel: "现场事实与权利台账",
    npcActorId: "agent-copyright",
    npcKnown: "版权联络角色能够解释人物、标识、图片与录像授权要素。",
    npcWithheld: "缺少书面范围的素材不会被默认视为可跨平台发布。",
    tasks: [
      ["xunpu-field-record-observation", "记录现场观察", "分栏记录可直接观察事实、人物引语和待核推断。"],
      ["xunpu-field-capture-quotes", "整理关键引语", "保留说话人、时间、语境和同意公开范围。"],
      ["xunpu-field-clear-material-rights", "核清素材权利", "逐项记录人物、商标、图片与录像的渠道、期限和禁止用途。"],
    ],
    agentTemplateId: "assistant/material-understanding",
    contributionLabel: "材料理解智能体识别事实与素材权利缺口",
    worldChange: "现场采集台账经教师核对后，关键主张核验任务开放。",
    competencyId: "C-XUNPU-INTERVIEW",
    evidenceKind: "现场观察、引语与素材权利台账",
  },
  {
    nodeId: "xunpu-fact-check",
    sceneId: "xunpu-scene-verification-desk",
    sceneTitle: "关键主张核验台",
    sceneDescription: "逐项核验年份、身份、数据口径和来源状态，留下更正、降级或补证结论。",
    hotspotId: "xunpu-hotspot-claims-board",
    hotspotLabel: "主张—证据对照板",
    npcActorId: "agent-chief",
    npcKnown: "责任编辑知道哪些主张会影响标题和公共理解，但不能替代证据核验。",
    npcWithheld: "最终更正或降级结论必须回到来源版本、采访记录与权利台账。",
    tasks: [
      ["xunpu-check-extract-claims", "提取关键主张", "把稿件中的年份、身份、数据和因果说法拆成可逐项核验的主张。"],
      ["xunpu-check-resolve-conflicts", "处理证据冲突", "比较来源版本与可证范围，形成补证、更正或降级表述。"],
      ["xunpu-check-clear-rights", "冻结核验结论", "把事实与权利核验结论写入同一可追溯清单。"],
    ],
    agentTemplateId: "governance/fact",
    contributionLabel: "事实核查智能体标记证据覆盖与冲突",
    worldChange: "关键主张核验经教师核对后，协同修订任务开放。",
    competencyId: "C-XUNPU-SOURCE",
    evidenceKind: "主张核验表、更正与补证清单",
  },
  {
    nodeId: "xunpu-story-revision",
    sceneId: "xunpu-scene-editing-room",
    sceneTitle: "协同修订工作台",
    sceneDescription: "在编辑压力下完成事实安全、叙事清晰并适配多端的 R1/R2 版本。",
    hotspotId: "xunpu-hotspot-version-diff",
    hotspotLabel: "R1/R2 版本差异",
    npcActorId: "agent-chief",
    npcKnown: "责任编辑可指出结构、事实边界与渠道表达问题，但不会代写成稿。",
    npcWithheld: "教师核对前，不会把吸睛标题等同于可以发布的最终版本。",
    tasks: [
      ["xunpu-revision-draft-r1", "形成 R1 稿件", "按已核验主张组织专题结构并保留来源引用。"],
      ["xunpu-revision-decide-contributions", "处理协作建议", "逐项说明建议被采纳、补证或拒绝的理由与依据。"],
      ["xunpu-revision-submit-r2", "提交 R2 冻结版", "完成多端适配、版本差异和修改说明后提交教师门。"],
    ],
    agentTemplateId: "production/text",
    contributionLabel: "文本生产智能体提供结构与渠道适配建议",
    worldChange: "R2 冻结版经教师核对后，发布与复盘任务开放。",
    competencyId: "C-XUNPU-GOVERNANCE",
    evidenceKind: "R1/R2 稿件、修改说明与渠道适配清单",
  },
  {
    nodeId: "xunpu-publish-review",
    sceneId: "xunpu-scene-release-room",
    sceneTitle: "发布门与复盘台",
    sceneDescription: "冻结作品、来源、授权和标识清单，处理发布后质疑并完成迁移反思。",
    hotspotId: "xunpu-hotspot-platform-review",
    hotspotLabel: "平台人工复核入口",
    npcActorId: "agent-platform",
    npcKnown: "平台运营角色知道人工复核需要的版本、来源、授权、标识与更正联系人。",
    npcWithheld: "在材料不完整时不会承诺审核通过，也不会替教师形成最终评价。",
    tasks: [
      ["xunpu-publish-submit-package", "提交发布包", "提交冻结稿件、来源、人物与素材授权、AI 辅助标识和更正联系人。"],
      ["xunpu-publish-analyze-feedback", "分析发布反馈", "区分事实质疑、表达意见与平台回执，建立连续更新记录。"],
      ["xunpu-publish-record-correction", "完成更正与迁移复盘", "记录更正版本、依据、影响渠道与可迁移的方法。"],
    ],
    agentTemplateId: "governance/platform",
    contributionLabel: "平台治理智能体检查发布、标识与更正边界",
    worldChange: "最终发布包与迁移复盘进入教师终评，平台提交不被表述为审核通过。",
    competencyId: "C-XUNPU-GOVERNANCE",
    evidenceKind: "最终作品、发布回执、更正记录与迁移反思",
  },
] as const;

const decisionLabels = {
  accept: ["采纳建议", "依据当前来源与任务边界采纳本轮唯一建议。"],
  request_evidence: ["请求补证", "建议方向可能有效，但必须先补齐来源、版本或现场证据。"],
  reject: ["拒绝建议", "建议与当前证据、岗位边界或任务目标不匹配。"],
} as const;

const xunpuInteractiveExperience: ScenarioExperienceDesign = {
  schemaVersion: ScenarioExperienceSchemaVersion,
  contentVersion: interactiveVersion,
  kind: "flagship",
  summary: "七个连续现场把记者的可执行任务、单条智能体建议、教师门、权威世界后果与能力证据串成同一条可回放黄金链。",
  scenes: xunpuInteractiveSpecs.map((spec) => ({
    sceneId: spec.sceneId,
    title: spec.sceneTitle,
    description: spec.sceneDescription,
    visualMode: "structured_cards" as const,
    nodeIds: [spec.nodeId],
  })),
  npcInstances: [
    {
      actorId: "agent-chief",
      roleId: "editor_in_chief",
      displayName: "责任编辑·林编",
      sceneIds: xunpuInteractiveSpecs
        .filter((spec) => spec.npcActorId === "agent-chief")
        .map((spec) => spec.sceneId),
      privatePerspective: {
        knownInformation: ["选题边界", "事实核验要求", "稿件版本与发布风险"],
        withheldInformation: ["未经学生证据支持的最终判断"],
        disclosureRules: ["只指出问题和修订边界", "不替学生完成选择或写稿"],
      },
    },
    {
      actorId: "agent-interviewee",
      roleId: "interviewee",
      displayName: "蟳埔社区受访者·阿环",
      sceneIds: xunpuInteractiveSpecs
        .filter((spec) => spec.npcActorId === "agent-interviewee")
        .map((spec) => spec.sceneId),
      privatePerspective: {
        knownInformation: ["亲历的簪花体验与社区生活", "本人同意公开的范围"],
        withheldInformation: ["无法亲历确认的年代与统计结论"],
        disclosureRules: ["先说明采访用途", "尊重拒答、删题与匿名要求"],
      },
    },
    {
      actorId: "agent-copyright",
      roleId: "copyright_owner",
      displayName: "素材权利联络人·许老师",
      sceneIds: xunpuInteractiveSpecs
        .filter((spec) => spec.npcActorId === "agent-copyright")
        .map((spec) => spec.sceneId),
      privatePerspective: {
        knownInformation: ["人物、标识、图片与录像授权要素"],
        withheldInformation: ["缺少书面范围时的最终授权结论"],
        disclosureRules: ["逐项说明渠道、期限和禁止用途", "缺失项保持待补"],
      },
    },
    {
      actorId: "agent-platform",
      roleId: "platform_operator",
      displayName: "平台值守·乔安",
      sceneIds: xunpuInteractiveSpecs
        .filter((spec) => spec.npcActorId === "agent-platform")
        .map((spec) => spec.sceneId),
      privatePerspective: {
        knownInformation: ["平台预检、人工复核、标识和更正要求"],
        withheldInformation: ["材料不完整时的最终审核结果"],
        disclosureRules: ["冻结版本齐全后才进入人工复核", "提交审核不得写成审核通过"],
      },
    },
  ],
  hotspots: xunpuInteractiveSpecs.map((spec) => ({
    hotspotId: spec.hotspotId,
    sceneId: spec.sceneId,
    label: spec.hotspotLabel,
    description: spec.sceneDescription,
    targetActorId: spec.npcActorId,
    visibleToRoleIds: ["reporter" as const],
    interactionOptionIds: spec.nodeId === "xunpu-interview-plan"
      ? ["xunpu-interview-npc-consent-dialogue"]
      : [],
  })),
  nodeMappings: xunpuInteractiveSpecs.map((spec) => {
    const node = nodeSpecs.find((candidate) => candidate.nodeId === spec.nodeId)!;
    const visibleTasks = spec.tasks.map(([taskId, label, description], index) => ({
      taskId,
      label,
      description,
      roleIds: ["reporter" as const],
      expectedOutput: node.requiredOutputs[Math.min(index, node.requiredOutputs.length - 1)]!,
      completionSignal: index === 2
        ? "形成教师门候选，批准后推进到下一课程小节"
        : "选择写入权威事件流并形成过程证据",
    }));
    const decisionTasks = (Object.keys(decisionLabels) as Array<keyof typeof decisionLabels>)
      .map((decision) => ({
        taskId: `${spec.nodeId}:agent-decision:${decision}`,
        label: decisionLabels[decision][0],
        description: decisionLabels[decision][1],
        roleIds: ["reporter" as const],
        expectedOutput: "本轮智能体建议处理决定",
        completionSignal: "三选一决定写入权威事件流且同一节点不可改写",
      }));
    const finalTaskId = spec.tasks[2][0];
    const contributionId = `${spec.nodeId}:agent-contribution`;
    const dynamicEventId = `${spec.nodeId}:advance-event`;
    const deliverableId = `${spec.nodeId}:deliverable`;
    const evidenceRequirementId = `${spec.nodeId}:capability-evidence`;
    return {
      nodeId: spec.nodeId,
      operationTasks: [...visibleTasks, ...decisionTasks],
      worldOpportunities: [{
        opportunityId: `${spec.nodeId}:world-opportunity`,
        sceneId: spec.sceneId,
        hotspotId: spec.hotspotId,
        label: "完成本节三项现场任务",
        choiceRefs: visibleTasks.map((task) => task.taskId),
        studentVisibleConsequence: spec.worldChange,
      }],
      npcInformationGaps: [{
        gapId: `${spec.nodeId}:npc-information-gap`,
        npcActorId: spec.npcActorId,
        knownInformation: spec.npcKnown,
        withheldInformation: spec.npcWithheld,
        revealCondition: "学生先提交来源、现场记录或任务选择，NPC 只在声明边界内响应。",
        resultingObjectKinds: ["evidence", "teacher_gate_candidate"],
      }],
      agentContributions: [{
        contributionId,
        templateId: spec.agentTemplateId,
        plane: "student_assistance" as const,
        trigger: "当前小节出现新的世界事件、学生证据或任务选择时，按受影响集合只读参与。",
        outputKind: spec.contributionLabel,
        authority: "advisory_only" as const,
      }],
      dynamicEvents: [{
        dynamicEventId,
        eventType: "node_activated" as const,
        triggerKind: "student_action" as const,
        triggerRef: finalTaskId,
        worldChanges: [spec.worldChange],
        affectedTaskIds: visibleTasks.map((task) => task.taskId),
        approvalPolicyId: xunpuApprovalPolicyId,
      }],
      stageDeliverables: [{
        deliverableId,
        label: node.requiredOutputs.join("、"),
        objectKind: "course_stage_deliverable",
        templateId: null,
        required: true,
      }],
      capabilityEvidence: [{
        evidenceRequirementId,
        competencyId: spec.competencyId,
        behavior: `学生完成“${spec.tasks[2][1]}”并能解释来源、建议决定与教师门之间的因果关系。`,
        evidenceKind: spec.evidenceKind,
        sourceRefs: [finalTaskId, contributionId, dynamicEventId, deliverableId],
        successCriterion: "来源定位、学生选择、智能体贡献、教师决定和世界后果均可追溯且无越权写入。",
      }],
    };
  }),
  causalBranches: xunpuInteractiveSpecs.map((spec) => ({
    branchId: `${spec.nodeId}:causal-branch`,
    nodeId: spec.nodeId,
    label: `${spec.sceneTitle}主因果分支`,
    studentChoiceRef: spec.tasks[2][0],
    agentContributionRef: `${spec.nodeId}:agent-contribution`,
    worldConsequenceRef: `${spec.nodeId}:advance-event`,
    capabilityEvidenceRef: `${spec.nodeId}:capability-evidence`,
  })),
  fixedEvaluation: {
    evaluationId: "xunpu-fixed-evaluation-2.0.1",
    rubricId: xunpuScenarioV200.rubricId,
    rubricVersion: xunpuScenarioV200.rubricVersion,
    evidenceRequirementIds: xunpuInteractiveSpecs.map(
      (spec) => `${spec.nodeId}:capability-evidence`,
    ),
    teacherFinalRequired: true,
  },
};

const xunpuBaselineRuntimeRoles: RoleContract[] = [
  standardRole({
    agentId: "agent-teaching",
    actorKind: "agent",
    roleId: "teaching_director",
    displayName: "教学导演智能体",
    purpose: "监控七节连续实训的目标覆盖、节奏与学习难度，只形成教学指令记录。",
    allowedIntents: ["record_teaching_directive"],
    toolPolicy: ["memory.read.own", "read_reviewed_facts", "rag_search", "teaching.progress.evaluate"],
    canInitiate: false,
    canRespond: false,
    allowedTargetRoleIds: [],
  }),
  standardRole({
    agentId: "agent-scene-director",
    actorKind: "agent",
    roleId: "scene_director",
    displayName: "情境导演智能体",
    purpose: "依据当前节点、证据和教学节奏提出受控情境候选，不直接改写世界。",
    allowedIntents: ["propose_scenario_intervention", "record_scene_no_op"],
    toolPolicy: ["memory.read.own", "read_reviewed_facts", "rag_search", "director.route.evaluate"],
    canInitiate: false,
    canRespond: false,
    allowedTargetRoleIds: [],
  }),
  standardRole({
    agentId: "agent-fact-checker",
    actorKind: "agent",
    roleId: "fact_checker",
    displayName: "事实核查智能体",
    purpose: "核验年份、来源版本、数据口径和可证范围，只提出更正或补证建议。",
    allowedIntents: ["propose_data_correction", "ask_for_evidence"],
    toolPolicy: ["memory.read.own", "read_reviewed_facts", "rag_search", "material_preview", "source_compare", "write_evidence"],
    canInitiate: false,
    canRespond: false,
    allowedTargetRoleIds: [],
  }),
  ...([
    ["agent-governance-copyright", "版权治理智能体", "对固定素材版本核查来源、授权范围、渠道、地域与期限。"],
    ["agent-governance-content-safety", "内容安全治理智能体", "对固定内容版本执行内容安全规则与风险分析。"],
    ["agent-governance-platform-rule", "平台规则治理智能体", "对固定发布版本执行目标平台规则、标识与渠道适配分析。"],
  ] as const).map(([agentId, displayName, purpose]) => standardRole({
    agentId,
    actorKind: "agent",
    roleId: "fact_checker",
    displayName,
    purpose,
    allowedIntents: ["record_governance_finding"],
    toolPolicy: ["memory.read.own", "read_reviewed_facts", "governance.review.read", "governance.finding.write"],
    canInitiate: false,
    canRespond: false,
    allowedTargetRoleIds: [],
  })),
  ...([
    ["agent-evidence-assessor", "证据充分性评价智能体", "只基于冻结证据包判断逐维证据充分性，不形成最终成绩。"],
    ["agent-work-quality-assessor", "作品质量评价智能体", "只基于冻结成果修订和证据包评价作品质量，不形成最终成绩。"],
    ["agent-collaboration-assessor", "职业协作评价智能体", "只基于冻结互动和过程证据评价职业协作，不形成最终成绩。"],
  ] as const).map(([agentId, displayName, purpose]) => ({
    ...standardRole({
      agentId,
      actorKind: "agent",
      roleId: "assessor",
      displayName,
      purpose,
      allowedIntents: ["record_evaluation_proposal"],
      toolPolicy: ["memory.read.own", "read_reviewed_facts", "evaluation.case.read", "evaluation.evidence.read"],
      canInitiate: false,
      canRespond: false,
      allowedTargetRoleIds: [],
    }),
    visibleScopes: [
      "public_world" as const,
      "assigned_team" as const,
      "role_private" as const,
      "teacher_only" as const,
      "audit_only" as const,
    ],
  })),
  standardRole({
    agentId: "agent-learning",
    actorKind: "agent",
    roleId: "learning_curator",
    displayName: "学习迁移策展智能体",
    purpose: "从教师终评提炼待审核迁移候选，不直接发布课程知识。",
    allowedIntents: ["propose_learning_candidate"],
    toolPolicy: ["memory.read.own", "evaluation.final.read", "learning.candidate.propose"],
    canInitiate: false,
    canRespond: false,
    allowedTargetRoleIds: [],
  }),
];

/**
 * Immutable interactive successor to the content/runtime-only 2.0.0 release.
 * V2.0.0 stays available for historical sessions; new course launches bind to
 * this package so the approved student UI is backed by real WorldEngine events.
 */
export const xunpuScenarioV201: ScenarioPackage = ScenarioPackageSchema.parse({
  ...structuredClone(xunpuScenarioV200),
  version: interactiveVersion,
  description: "记者单主岗与受控责任编辑、核查、治理、运营智能体共同完成七节连续实训；每次操作、建议决定、教师门和世界后果均写入同一权威事件流。",
  roles: [
    ...structuredClone(xunpuScenarioV200.roles),
    ...structuredClone(xunpuBaselineRuntimeRoles),
  ],
  roleInteractions: xunpuScenarioV200.roleInteractions.map((option) => (
    option.optionId === "xunpu-interview-request-consent"
      ? {
          ...structuredClone(option),
          optionId: "xunpu-interview-npc-consent-dialogue",
        }
      : structuredClone(option)
  )),
  courseGuide: {
    ...structuredClone(xunpuScenarioV200.courseGuide!),
    contentVersion: interactiveVersion,
  },
  experienceDesign: xunpuInteractiveExperience,
});

// Frozen after ScenarioPackageSchema parsing and canonical release hashing.
export const xunpuScenarioV201ContentHash =
  "6bb647057c50419cd0372f09ad13d6c99b3b4e10a641c91b272184a8e4220a06";
