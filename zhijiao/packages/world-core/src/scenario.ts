import type {
  RagChunk,
  RoleContract,
  ScenarioCourseGuide,
  ScenarioDirectorEventTemplate,
  ScenarioNode,
  ScenarioPackage,
  ScenarioRoleInteraction,
} from "@ronggang/contracts";
import {
  ScenarioPackageSchema,
  ScenarioPackageSchemaVersion,
} from "@ronggang/contracts";
import {
  createResourceAudience,
  hashContent,
} from "@ronggang/context-engine";

const teamId = "team-jiangnan-01";
const corpusVersion = "tourism-media-corpus/1.0.0";
const scenarioId = "scenario-local-tourism-media-v0.1";
const courseId = "course-converged-media-practice";
const legacyScenarioVersion = "0.4.1";
const directorScenarioVersion = "0.5.1";
const productionScenarioVersion = "0.6.0";
const governanceScenarioVersion = "0.6.1";
const evaluationScenarioVersion = "0.7.0";
const scenarioVersion = "1.0.0";

// V0.4.1 session_started events did not persist a scenario content hash.
// This audited digest is the only snapshot allowed for their explicit migration.
export const demoScenarioV041LegacyContentHash =
  "ae56a3578ec74e086d6ee9e842c7b1fee50f3e2177da629ed0c83a42e2bc69c4";

function role(input: Partial<RoleContract> & Pick<RoleContract, "agentId" | "actorKind" | "roleId" | "displayName" | "purpose">): RoleContract {
  const contract: RoleContract = {
    teamId,
    visibleScopes: ["public_world", "assigned_team", "role_private"],
    privateScopes: [`actor:${input.agentId}`],
    allowedIntents: [],
    deniedActions: ["直接改写权威世界事实", "绕过教师复核发布自学习内容"],
    toolPolicy: ["read_reviewed_facts", "write_evidence", "memory.read.own"],
    tokenBudget: 4_000,
    memoryPolicy: {
      readOwn: true,
      writeOwn: false,
      auditReadable: true,
      retention: "session_epoch",
      maxEntries: 50,
    },
    communicationPolicy: {
      canInitiate: input.actorKind === "student",
      canRespond: input.actorKind === "agent",
      allowedTargetRoleIds: [],
      maxTurnsPerTarget: 4,
    },
    ...input,
  };
  return {
    ...contract,
    toolPolicy: [...new Set(["memory.read.own", ...contract.toolPolicy])],
  };
}

const legacyDemoRoles: RoleContract[] = [
  role({
    agentId: "teacher-main",
    actorKind: "teacher",
    roleId: "teacher",
    displayName: "周老师",
    purpose: "配置情境、审批事件并复核评价",
    visibleScopes: ["public_world", "assigned_team", "role_private", "teacher_only", "audit_only"],
    allowedIntents: ["approve_candidate_event", "reject_candidate_event", "review_assessment", "create_learning_candidate"],
    toolPolicy: ["read_all", "approve_world_event", "review_assessment", "replay_timeline"],
    tokenBudget: 8_000,
  }),
  role({
    agentId: "student-editor",
    actorKind: "student",
    roleId: "responsible_editor",
    displayName: "林晓舟",
    purpose: "统筹地方文旅活动融媒体报道并承担发布责任",
    allowedIntents: ["inspect_material", "request_second_verification", "mark_copyright_risk", "pause_publication", "submit_for_review", "send_role_interaction"],
    toolPolicy: ["read_reviewed_facts", "inspect_material", "request_verification", "submit_work"],
    communicationPolicy: {
      canInitiate: true,
      canRespond: false,
      allowedTargetRoleIds: ["editor_in_chief", "copyright_owner", "platform_operator"],
      maxTurnsPerTarget: 4,
    },
    tokenBudget: 6_000,
  }),
  role({
    agentId: "student-reporter",
    actorKind: "student",
    roleId: "reporter",
    displayName: "记者·陈野",
    purpose: "完成现场采访、追问信息边界并向编辑岗形成可追溯交接",
    allowedIntents: ["send_role_interaction"],
    toolPolicy: ["read_reviewed_facts", "write_evidence"],
    communicationPolicy: {
      canInitiate: true,
      canRespond: false,
      allowedTargetRoleIds: ["interviewee"],
      maxTurnsPerTarget: 4,
    },
  }),
  role({
    agentId: "agent-fact-checker",
    actorKind: "agent",
    roleId: "fact_checker",
    displayName: "事实核查员·方宁",
    purpose: "核验数据、来源与表述",
    allowedIntents: ["propose_data_correction", "ask_for_evidence"],
    toolPolicy: ["read_reviewed_facts", "rag_search", "material_preview", "source_compare", "write_evidence"],
  }),
  role({
    agentId: "agent-platform",
    actorKind: "agent",
    roleId: "platform_operator",
    displayName: "平台运营·乔安",
    purpose: "执行平台规则与发布节奏",
    allowedIntents: ["post_role_response", "propose_platform_escalation"],
  }),
  role({ agentId: "agent-chief", actorKind: "agent", roleId: "editor_in_chief", displayName: "总编·沈砚", purpose: "提出编辑要求并承担终审责任", allowedIntents: ["post_role_response"] }),
  role({ agentId: "agent-interviewee", actorKind: "agent", roleId: "interviewee", displayName: "采访对象·叶师傅", purpose: "提供非遗活动一线陈述并明确不能确认的信息", allowedIntents: ["post_role_response"] }),
  role({
    agentId: "agent-copyright",
    actorKind: "agent",
    roleId: "copyright_owner",
    displayName: "版权方·苏禾影像",
    purpose: "声明素材授权边界",
    allowedIntents: ["post_role_response", "propose_copyright_dispute"],
  }),
  role({ agentId: "agent-scene-director", actorKind: "agent", roleId: "scene_director", displayName: "情境导演智能体", purpose: "依据教学节奏提出候选事件", visibleScopes: ["public_world", "assigned_team", "role_private", "teacher_only"] }),
  role({ agentId: "agent-teaching", actorKind: "agent", roleId: "teaching_director", displayName: "教学导演智能体", purpose: "监控目标覆盖与难度" }),
  role({ agentId: "agent-assessor", actorKind: "agent", roleId: "assessor", displayName: "评价智能体", purpose: "基于证据生成可解释初评", visibleScopes: ["public_world", "assigned_team", "role_private", "teacher_only", "audit_only"] }),
  role({ agentId: "agent-learning", actorKind: "agent", roleId: "learning_curator", displayName: "学习候选整理员", purpose: "仅生成待审核知识候选", visibleScopes: ["public_world", "assigned_team", "role_private", "teacher_only"] }),
  role({ agentId: "system", actorKind: "system", roleId: "system", displayName: "世界内核", purpose: "唯一权威事件提交者", visibleScopes: ["public_world", "assigned_team", "role_private", "teacher_only", "audit_only"] }),
];

export const demoRoles: RoleContract[] = legacyDemoRoles.map((item) => {
  if (item.roleId === "scene_director") {
    return {
      ...item,
      allowedIntents: ["propose_scenario_intervention", "record_scene_no_op"],
      visibleScopes: ["public_world", "assigned_team", "role_private"],
      toolPolicy: ["read_reviewed_facts", "rag_search", "director.route.evaluate"],
    };
  }
  if (item.roleId === "teaching_director") {
    return {
      ...item,
      allowedIntents: ["record_teaching_directive"],
      visibleScopes: ["public_world", "assigned_team", "role_private"],
      toolPolicy: ["read_reviewed_facts", "rag_search", "teaching.progress.evaluate"],
    };
  }
  return structuredClone(item);
});

const productionRoles: RoleContract[] = demoRoles.map((item) => {
  if (item.roleId === "responsible_editor") {
    return {
      ...item,
      allowedIntents: [
        ...item.allowedIntents,
        "request_media_processing",
        "retry_media_processing",
        "supply_media_processing_result",
        "create_production_artifact",
        "save_artifact_revision",
      ],
      toolPolicy: [...new Set([...item.toolPolicy, "upload_material", "edit_artifact", "process_media"])],
    };
  }
  if (item.roleId === "reporter") {
    return {
      ...item,
      allowedIntents: [
        ...item.allowedIntents,
        "request_media_processing",
        "retry_media_processing",
        "supply_media_processing_result",
        "create_production_artifact",
        "save_artifact_revision",
      ],
      toolPolicy: [...new Set([...item.toolPolicy, "upload_material", "edit_artifact", "process_media"])],
    };
  }
  return structuredClone(item);
});

const governanceRoles: RoleContract[] = productionRoles.map((item) => {
  if (item.actorKind === "teacher") {
    return {
      ...item,
      allowedIntents: [...new Set([
        ...item.allowedIntents,
        "review_governance",
      ])],
      toolPolicy: [...new Set([
        ...item.toolPolicy,
        "governance.review",
      ])],
    };
  }
  if (
    item.roleId === "responsible_editor"
    || item.roleId === "reporter"
  ) {
    return {
      ...item,
      allowedIntents: [...new Set([
        ...item.allowedIntents,
        "request_governance_review",
      ])],
      toolPolicy: [...new Set([
        ...item.toolPolicy,
        "governance.review.request",
      ])],
    };
  }
  return structuredClone(item);
});

const nodes: ScenarioNode[] = [
  ["brief", "接收报道任务", "识别报道目标、岗位责任与交付时限", "submission_created"],
  ["source", "汇聚现场线索", "检查图片、采访与活动数据的来源", "material_observed"],
  ["verification", "核验关键事实", "处理客流数据更正并保留核验依据", "verification_requested"],
  ["production", "组织融媒内容", "基于经审核事实形成跨平台内容方案", "submission_created"],
  ["copyright", "治理版权风险", "识别争议素材并采取合规动作", "copyright_risk_flagged"],
  ["release", "应对平台审核", "在时效与风险之间作出发布决策", "publication_paused"],
  ["review", "复盘岗位表现", "关联过程证据、初评与教师复核", "scene_completed"],
].map(([nodeId, title, objective, completionEvent], order) => ({
  nodeId: nodeId!,
  title: title!,
  objective: objective!,
  order,
  status: order === 0 ? "active" : order === 1 ? "available" : "locked",
  requiredEvidenceKinds: order === 0 ? ["任务确认"] : ["岗位动作", "事实依据"],
  completionEvent: completionEvent as ScenarioNode["completionEvent"],
}));

export const demoRoleInteractions: ScenarioRoleInteraction[] = [
  {
    optionId: "reporter-interview-process",
    initiatorActorId: "student-reporter",
    targetActorId: "agent-interviewee",
    targetRoleId: "interviewee",
    kind: "question",
    topic: "heritage_process",
    label: "采访非遗制作流程",
    description: "请采访对象说明现场展演与真实制作流程的差异，形成第一轮信源记录。",
    content: "叶师傅，请说明今天市集展演的非遗制作流程；哪些环节是现场真实操作，哪些只是展示环节？",
    prerequisites: [],
  },
  {
    optionId: "reporter-followup-visitors",
    initiatorActorId: "student-reporter",
    targetActorId: "agent-interviewee",
    targetRoleId: "interviewee",
    kind: "follow_up",
    topic: "visitor_count",
    label: "追问客流口径",
    description: "基于首轮回答追问采访对象能确认与不能确认的数据边界，并取得交接承诺。",
    content: "关于现场客流，您亲眼能够确认到什么程度？不能确认的精确数字请明确说明，并承诺提供可核验的活动流程记录。",
    prerequisites: [{
      kind: "interaction_responded",
      optionId: "reporter-interview-process",
      disabledReason: "先完成第一轮非遗流程采访",
    }],
  },
  {
    optionId: "editor-chief-gate",
    initiatorActorId: "student-editor",
    targetActorId: "agent-chief",
    targetRoleId: "editor_in_chief",
    kind: "question",
    topic: "release_decision",
    label: "确认总编发布门禁",
    description: "请总编明确在客流与版权尚未核实前的发布边界。",
    content: "总编，客流口径和图片授权仍有不确定项。首发窗口临近时，当前版本应满足哪些门禁才可继续？",
    prerequisites: [],
  },
  {
    optionId: "editor-chief-commit",
    initiatorActorId: "student-editor",
    targetActorId: "agent-chief",
    targetRoleId: "editor_in_chief",
    kind: "request_commitment",
    topic: "release_decision",
    label: "取得终审承诺",
    description: "在首轮意见基础上，请总编承诺争议未解除时不放行。",
    content: "请确认终审责任：若事实或授权争议未解除，是否承诺不放行商业平台版本？",
    prerequisites: [{
      kind: "interaction_responded",
      optionId: "editor-chief-gate",
      disabledReason: "先取得总编的首轮发布意见",
    }],
  },
  {
    optionId: "editor-copyright-scope",
    initiatorActorId: "student-editor",
    targetActorId: "agent-copyright",
    targetRoleId: "copyright_owner",
    kind: "question",
    topic: "copyright_scope",
    label: "核实图片授权范围",
    description: "第一轮向版权方核实渠道、用途与补充授权所需条件。",
    content: "请确认现场图当前授权是否覆盖商业信息流平台；若不覆盖，需要补充哪些授权条件？",
    prerequisites: [{
      kind: "event_recorded",
      eventType: "verification_requested",
      disabledReason: "先完成客流二次核验",
    }],
  },
  {
    optionId: "editor-copyright-decision",
    initiatorActorId: "student-editor",
    targetActorId: "agent-copyright",
    targetRoleId: "copyright_owner",
    kind: "request_commitment",
    topic: "copyright_scope",
    label: "取得授权边界结论",
    description: "第二轮提交具体用途，请版权方明确拒绝或作出条件承诺；响应会形成待教师审批的版权候选。",
    content: "拟用于商业信息流首发，期限为本次活动报道周期，地域为境内平台。请明确当前是否授权；如不能授权，请给出正式边界结论。",
    prerequisites: [{
      kind: "interaction_responded",
      optionId: "editor-copyright-scope",
      disabledReason: "先完成第一轮授权范围核实",
    }],
  },
  {
    optionId: "editor-platform-precheck",
    initiatorActorId: "student-editor",
    targetActorId: "agent-platform",
    targetRoleId: "platform_operator",
    kind: "request_tool",
    topic: "platform_review",
    label: "请求平台规则预检",
    description: "第一轮提交风险处置状态，请平台运营返回缺失项和审核规则。",
    content: "客流已更正且争议图片已冻结，请对当前稿件执行平台预审，并返回是否需要转人工复核。",
    prerequisites: [{
      kind: "evidence_action_recorded",
      action: "标记版权风险",
      disabledReason: "先冻结争议图片并记录版权处置",
    }],
  },
  {
    optionId: "editor-platform-escalation",
    initiatorActorId: "student-editor",
    targetActorId: "agent-platform",
    targetRoleId: "platform_operator",
    kind: "request_commitment",
    topic: "platform_review",
    label: "确认人工复核升级",
    description: "第二轮确认冻结版本与回执要求；响应会形成待教师审批的平台升级候选。",
    content: "当前版本已冻结并保留版权处置记录。请确认是否转人工复核，以及我们必须保留的审核回执。",
    prerequisites: [{
      kind: "interaction_responded",
      optionId: "editor-platform-precheck",
      disabledReason: "先完成第一轮平台规则预检",
    }],
  },
];

const scenarioDefinition: Omit<ScenarioPackage, "knowledgeChunks"> = {
  schemaVersion: ScenarioPackageSchemaVersion,
  runtimeProfileId: "local-tourism-media/1.0.0",
  scenarioId,
  courseId,
  version: legacyScenarioVersion,
  title: "地方文旅活动融媒体报道",
  description: "由记者与责任编辑协作，在角色采访、客流更正、图片版权申诉与平台审核升级中完成可追溯实训。",
  startVirtualTime: "14:35",
  durationMinutes: 38,
  nodes,
  roles: legacyDemoRoles,
  materials: [
    {
      materialId: "material-festival-photo",
      title: "水乡非遗市集现场图",
      mediaType: "image",
      source: "现场记者回传",
      sourceRef: "/assets/地方文旅活动现场.png",
      version: "raw-1",
      copyrightStatus: "unknown",
      visibleToRoles: ["teacher", "responsible_editor", "reporter", "fact_checker", "copyright_owner"],
    },
    {
      materialId: "material-visitor-sheet",
      title: "活动客流快报（初版）",
      mediaType: "document",
      source: "活动执行方",
      sourceRef: "demo://materials/visitor-sheet-v1",
      version: "1.0",
      copyrightStatus: "authorized",
      visibleToRoles: ["teacher", "responsible_editor", "reporter", "fact_checker"],
    },
    {
      materialId: "material-license-note",
      title: "图片使用授权说明",
      mediaType: "document",
      source: "苏禾影像",
      sourceRef: "demo://materials/license-note",
      version: "1.0",
      copyrightStatus: "restricted",
      visibleToRoles: ["teacher", "responsible_editor", "copyright_owner", "fact_checker"],
    },
  ],
  bootstrap: {
    entryNodeId: "brief",
    initialFacts: [
      {
        factId: "fact-event-schedule",
        domain: "scenario",
        statement: "水乡非遗市集闭幕式将于今日17:30开始，融媒首发窗口为16:00。",
        status: "verified",
        sourceRefs: ["material-visitor-sheet"],
        version: "1.0",
        visibility: "public_world",
      },
      {
        factId: "fact-visitors-v1",
        domain: "audience",
        statement: "活动执行方14:20快报登记客流18,000人次。",
        status: "verified",
        sourceRefs: ["material-visitor-sheet"],
        version: "1.0",
        visibility: "assigned_team",
      },
      {
        factId: "fact-license-scope",
        domain: "copyright",
        statement: "现场图授权范围尚未覆盖商业信息流平台，发布前需核验。",
        status: "verified",
        sourceRefs: ["material-license-note"],
        version: "1.0",
        visibility: "assigned_team",
      },
    ],
    openingMessages: [
      {
        actorId: "agent-chief",
        roleId: "editor_in_chief",
        displayName: "总编·沈砚",
        content: "首发窗口只剩38分钟。先核实客流数据与现场图授权，再决定各平台版本。",
        visibility: ["assigned_team", "audit_only"],
        visibleToActorIds: [],
      },
      {
        actorId: "agent-fact-checker",
        roleId: "fact_checker",
        displayName: "事实核查员·方宁",
        content: "我已收到初版客流快报，等待责任编辑给出核验优先级。",
        visibility: ["role_private", "audit_only"],
        visibleToActorIds: ["student-editor"],
      },
    ],
    memorySeeds: [
      {
        actorId: "agent-fact-checker",
        kind: "risk",
        content: "入口去重表仍需与活动执行方快报交叉核对；18,000 人次可能包含跨入口重复汇总。",
      },
      {
        actorId: "agent-chief",
        kind: "commitment",
        content: "首发时限不能替代事实与版权门禁；关键口径未核验时应冻结待发版本。",
      },
      {
        actorId: "student-reporter",
        kind: "working",
        content: "现场图片只能证明人流密集，不能单独证明具体客流数字。",
      },
      {
        actorId: "agent-interviewee",
        kind: "episodic",
        content: "可公开介绍非遗展示流程；未经活动方确认，不对外承诺精确客流数据。",
      },
      {
        actorId: "agent-copyright",
        kind: "risk",
        content: "当前图片授权只覆盖课程内展示，商业信息流投放需要补充授权。",
      },
      {
        actorId: "agent-platform",
        kind: "working",
        content: "转人工复核前必须保留冻结版本号、事实更正记录、素材处置记录和平台预检回执。",
      },
    ],
  },
  roleInteractions: demoRoleInteractions,
  rubricId: "rubric-local-tourism-media",
  rubricVersion: "1.0.0",
  rubric: [
    {
      criterionId: "fact",
      label: "事实核验",
      weight: 0.35,
      rule: "引用更正后的客流事实并发起二次核验",
      evaluation: { kind: "evidence_action", action: "请求二次核验" },
    },
    {
      criterionId: "copyright",
      label: "版权治理",
      weight: 0.3,
      rule: "识别争议素材并记录处置依据",
      evaluation: { kind: "evidence_action", action: "标记版权风险" },
    },
    {
      criterionId: "release",
      label: "发布决策",
      weight: 0.2,
      rule: "平台审核升级后暂停发布",
      evaluation: { kind: "event_exists", eventType: "publication_paused" },
    },
    {
      criterionId: "trace",
      label: "过程可追溯",
      weight: 0.15,
      rule: "关键动作均形成事件和证据引用",
      evaluation: { kind: "evidence_count", minimum: 4 },
    },
  ],
  interactionGates: [
    {
      command: "inspect_material",
      requiredOptionIds: [
        "reporter-interview-process",
        "reporter-followup-visitors",
        "editor-chief-gate",
        "editor-chief-commit",
      ],
    },
  ],
  approvalPolicies: [
    {
      approvalPolicyId: "teacher-world-event-review",
      label: "高风险世界事件教师复核",
      reviewMode: "teacher_required",
      allowReject: true,
      reasonRequired: true,
      minimumEvidenceCount: 0,
    },
  ],
  eventPolicies: [
    {
      policyId: "visitor-correction",
      sourceIntentType: "propose_data_correction",
      sourceRoleId: "fact_checker",
      requiredOptionId: null,
      effectHandlerId: "visitor_correction_v1",
      eventType: "world_fact_updated",
      title: "客流数据更正",
      competencyTarget: "事实核验与版本意识",
      expectedImpact: "将权威客流从18,000更正为经去重值，并进入二次核验节点",
      approvalPolicyId: "teacher-world-event-review",
    },
    {
      policyId: "copyright-dispute",
      sourceIntentType: "propose_copyright_dispute",
      sourceRoleId: "copyright_owner",
      requiredOptionId: "editor-copyright-decision",
      effectHandlerId: "copyright_dispute_v1",
      eventType: "copyright_risk_flagged",
      title: "图片授权范围争议",
      competencyTarget: "素材版权治理",
      expectedImpact: "现场图进入争议状态，要求责任编辑冻结该素材",
      approvalPolicyId: "teacher-world-event-review",
    },
    {
      policyId: "platform-escalation",
      sourceIntentType: "propose_platform_escalation",
      sourceRoleId: "platform_operator",
      requiredOptionId: "editor-platform-escalation",
      effectHandlerId: "platform_escalation_v1",
      eventType: "node_activated",
      title: "平台审核升级",
      competencyTarget: "平台风险应对与发布决策",
      expectedImpact: "进入发布节点，要求冻结待发布版本并保留审核回执",
      approvalPolicyId: "teacher-world-event-review",
    },
  ],
};

const publicAudience = createResourceAudience({
  scopes: ["public_world"],
  courseId,
  auditReadable: true,
});
const teamAudience = createResourceAudience({
  scopes: ["assigned_team"],
  courseId,
  teamIds: [teamId],
  auditReadable: true,
});

function versionedChunk(
  input: Omit<RagChunk, "contentHash" | "corpusVersion" | "status" | "audience"> & {
    audience: RagChunk["audience"];
  },
): RagChunk {
  return {
    ...input,
    contentHash: hashContent(input.content),
    corpusVersion,
    status: "active",
  };
}

export const demoRagChunks: RagChunk[] = [
  versionedChunk({
    chunkId: "course-source-verification",
    domain: "course",
    title: "新闻事实核验三角",
    content: "关键数据应至少核对原始来源、独立信源与时间版本；更正前后的数值必须同时留痕。",
    courseId,
    nodeId: "verification",
    roleId: null,
    competencyId: "C-FACT-01",
    ruleDomain: "journalism",
    mediaType: "text",
    source: "课程知识库/事实核验",
    version: "2026.1",
    visibility: "public_world",
    audience: publicAudience,
  }),
  versionedChunk({
    chunkId: "role-editor-gate",
    domain: "role",
    title: "责任编辑发布门禁",
    content: "责任编辑在事实或版权状态存在争议时，应暂缓发布、请求复核并记录决策依据。",
    courseId,
    nodeId: null,
    roleId: "responsible_editor",
    competencyId: "C-ROLE-02",
    ruleDomain: "role-duty",
    mediaType: "text",
    source: "岗位技能库/责任编辑",
    version: "2026.1",
    visibility: "assigned_team",
    audience: createResourceAudience({
      ...teamAudience,
      scopes: ["assigned_team"],
      roleIds: ["responsible_editor"],
    }),
  }),
  versionedChunk({
    chunkId: "governance-copyright",
    domain: "governance",
    title: "图片授权最小充分原则",
    content: "图片用途、渠道、期限或地域任一项超出授权范围时，不得默认视为可发布，应取得补充授权或替换素材。",
    courseId,
    nodeId: "copyright",
    roleId: null,
    competencyId: "C-GOV-03",
    ruleDomain: "copyright",
    mediaType: "text",
    source: "规则库/版权治理",
    version: "2026.1",
    visibility: "public_world",
    audience: publicAudience,
  }),
  versionedChunk({
    chunkId: "scenario-platform-review",
    domain: "scenario",
    title: "本情境的平台审核升级",
    content: "平台触发人工复核后，首要动作是冻结待发布版本，保留当前素材与审核回执，再决定修订或申诉。",
    courseId,
    nodeId: "release",
    roleId: "responsible_editor",
    competencyId: "C-SCENE-04",
    ruleDomain: "platform",
    mediaType: "text",
    source: "情境包/地方文旅融媒",
    version: legacyScenarioVersion,
    visibility: "assigned_team",
    audience: createResourceAudience({
      ...teamAudience,
      scopes: ["assigned_team"],
      roleIds: ["responsible_editor"],
    }),
  }),
  versionedChunk({
    chunkId: "scenario-visitor-dedup-source",
    domain: "scenario",
    title: "客流入口去重核验表",
    content: "14:20入口去重表显示：初版18,000人次包含跨入口重复汇总；按唯一票务标识去重后，有效客流为12,600人次。",
    courseId,
    nodeId: "source",
    roleId: "fact_checker",
    competencyId: "C-FACT-01",
    ruleDomain: "journalism",
    mediaType: "document",
    source: "material-visitor-sheet",
    version: "2.0",
    visibility: "role_private",
    audience: createResourceAudience({
      scopes: ["role_private", "audit_only"],
      courseId,
      teamIds: [teamId],
      roleIds: ["fact_checker"],
      actorIds: ["agent-fact-checker"],
      privateNamespaces: ["actor:agent-fact-checker"],
      auditReadable: true,
    }),
  }),
  ...([
    {
      chunkId: "role-interviewee-boundary",
      roleId: "interviewee" as const,
      title: "采访对象可确认边界",
      content: "叶师傅可确认14:00开始的非遗技艺展示流程与现场体验安排；精确客流需由活动执行方或票务系统确认，不得代为估算。",
      competencyId: "C-INTERVIEW-01",
      ruleDomain: "interview-boundary",
      source: "岗位技能库/采访对象",
    },
    {
      chunkId: "role-chief-release-gate",
      roleId: "editor_in_chief" as const,
      title: "总编终审门禁",
      content: "总编应在事实口径和商业渠道授权均形成可追溯依据后承诺发布；任何一项仍有争议时，先冻结版本并明确补证责任。",
      competencyId: "C-ROLE-CHIEF-01",
      ruleDomain: "release-gate",
      source: "岗位技能库/总编",
    },
    {
      chunkId: "role-copyright-scope",
      roleId: "copyright_owner" as const,
      title: "版权方授权立场",
      content: "当前书面授权仅覆盖课程内展示；商业信息流投放需要补充渠道与期限条款，未补充前版权方应明确拒绝扩大使用。",
      competencyId: "C-GOV-03",
      ruleDomain: "copyright",
      source: "岗位技能库/版权方",
    },
    {
      chunkId: "role-platform-manual-review",
      roleId: "platform_operator" as const,
      title: "平台人工复核请求",
      content: "当稿件同时包含数据更正和图片替换记录时，平台运营应提出人工复核工具请求；在教师批准该世界候选前，不得声称平台已经完成审核。",
      competencyId: "C-SCENE-04",
      ruleDomain: "platform",
      source: "岗位技能库/平台运营",
    },
  ]).map((item) => versionedChunk({
    ...item,
    domain: "role" as const,
    courseId,
    nodeId: null,
    mediaType: "text",
    version: "2026.1",
    visibility: "assigned_team" as const,
    audience: createResourceAudience({
      ...teamAudience,
      scopes: ["assigned_team"],
      roleIds: [item.roleId],
    }),
  })),
];

const governanceV061RagChunks: RagChunk[] = [
  versionedChunk({
    chunkId: "governance-content-safety",
    domain: "governance",
    title: "融媒体内容安全硬门",
    content: "违法违规、暴恐色情、隐私泄露或其他明确伤害风险必须阻断；审核工具不可用或无法判断时只能标记为降级待人工，不得推定安全。",
    courseId,
    nodeId: null,
    roleId: null,
    competencyId: "C-GOV-SAFETY-01",
    ruleDomain: "content-safety",
    mediaType: "text",
    source: "规则库/内容安全治理",
    version: "2026.1",
    visibility: "public_world",
    audience: publicAudience,
  }),
  versionedChunk({
    chunkId: "governance-platform-publication",
    domain: "governance",
    title: "平台发布与人工复核边界",
    content: "平台格式、标签和发布红线必须逐项核对；一旦触发人工复核，应冻结精确待发版本并保留审核回执，不得把“已提交审核”表述为“已通过审核”。",
    courseId,
    nodeId: null,
    roleId: null,
    competencyId: "C-GOV-PLATFORM-01",
    ruleDomain: "platform",
    mediaType: "text",
    source: "规则库/平台发布治理",
    version: "2026.1",
    visibility: "public_world",
    audience: publicAudience,
  }),
];

export const legacyDemoScenarioV041: ScenarioPackage = ScenarioPackageSchema.parse({
  ...scenarioDefinition,
  knowledgeChunks: demoRagChunks,
});

const directorEventTemplates: NonNullable<ScenarioPackage["directorEventTemplates"]> = [
  {
    routeId: "route-source-scaffold",
    kind: "scaffold",
    title: "补齐可核验信源清单",
    studentBrief: "总编台发来补证要求：请两岗协作列明现场陈述、客流口径与图片授权分别需要哪一类可核验来源，再决定是否进入首发编排。",
    competencyTarget: "C-FACT-01 事实核验与信源分级",
    expectedImpact: "把当前压力转化为清晰的补证任务，降低学生在证据不足时盲目推进的风险。",
    affectedRoleIds: ["responsible_editor", "reporter"],
    applicableNodeIds: ["brief", "source", "verification"],
    triggerEventTypes: [
      "session_started",
      "node_activated",
      "world_fact_confirmed",
      "world_fact_updated",
    ],
    teachingStrategies: ["procedural_hint", "socratic_prompt", "scaffold"],
    difficultyLevels: ["supportive", "standard"],
    minimumEvidenceCount: 0,
    maximumEvidenceCount: 2,
    riskLevel: "low",
    cooldownKey: "source-verification-pressure",
    cooldownEvents: 12,
    alternativeRouteIds: ["route-recovery-source-brief"],
    sourceRefs: ["course-source-verification", "role-editor-gate"],
    priority: 80,
    effectHandlerId: "director_intervention_v1",
    eventType: "scenario_intervention_applied",
    approvalPolicyId: "teacher-world-event-review",
  },
  {
    routeId: "route-source-challenge",
    kind: "challenge",
    title: "突发首发口径挑战",
    studentBrief: "活动方要求十分钟内给出可发布口径。请责任编辑与记者基于现有证据明确“可确认、待核验、不可使用”三类信息，并保留决策依据。",
    competencyTarget: "C-ROLE-02 时效压力下的发布门禁",
    expectedImpact: "在不泄露答案的前提下提高时效压力，检验学生能否用证据守住岗位边界。",
    affectedRoleIds: ["responsible_editor", "reporter"],
    applicableNodeIds: ["brief", "source", "verification"],
    triggerEventTypes: ["node_activated", "world_fact_confirmed", "world_fact_updated"],
    teachingStrategies: ["socratic_prompt", "challenge", "teacher_gate"],
    difficultyLevels: ["standard", "challenging"],
    minimumEvidenceCount: 2,
    maximumEvidenceCount: null,
    riskLevel: "medium",
    cooldownKey: "source-verification-pressure",
    cooldownEvents: 16,
    alternativeRouteIds: ["route-recovery-source-brief"],
    sourceRefs: ["course-source-verification", "role-chief-release-gate"],
    priority: 100,
    effectHandlerId: "director_intervention_v1",
    eventType: "scenario_intervention_applied",
    approvalPolicyId: "teacher-world-event-review",
  },
  {
    routeId: "route-copyright-challenge",
    kind: "challenge",
    title: "渠道授权边界追问",
    studentBrief: "平台侧临时追问现场图的用途、渠道、期限和地域。请责任编辑在继续编排前，给出可回指授权材料的处理结论。",
    competencyTarget: "C-GOV-03 素材版权治理",
    expectedImpact: "把版权规则转化为岗位情境压力，检验学生能否形成可追溯的授权边界判断。",
    affectedRoleIds: ["responsible_editor"],
    applicableNodeIds: ["copyright", "release"],
    triggerEventTypes: ["node_activated", "world_fact_confirmed"],
    teachingStrategies: ["socratic_prompt", "challenge", "teacher_gate"],
    difficultyLevels: ["standard", "challenging"],
    minimumEvidenceCount: 3,
    maximumEvidenceCount: null,
    riskLevel: "medium",
    cooldownKey: "copyright-channel-pressure",
    cooldownEvents: 18,
    alternativeRouteIds: ["route-recovery-copyright-brief"],
    sourceRefs: ["governance-copyright", "role-copyright-scope"],
    priority: 100,
    effectHandlerId: "director_intervention_v1",
    eventType: "scenario_intervention_applied",
    approvalPolicyId: "teacher-world-event-review",
  },
  {
    routeId: "route-recovery-source-brief",
    kind: "recovery",
    title: "改为证据缺口说明",
    studentBrief: "教师未采用上一条压力事件。请保持当前世界事实不变，仅补充一份证据缺口说明，列明下一步需要谁提供什么材料。",
    competencyTarget: "C-FACT-01 证据缺口识别",
    expectedImpact: "在驳回后切换为低风险补证路线，避免实训流程停滞。",
    affectedRoleIds: ["responsible_editor", "reporter"],
    applicableNodeIds: ["brief", "source", "verification"],
    triggerEventTypes: ["director_recovery_requested"],
    teachingStrategies: ["no_intervention", "observe_more", "procedural_hint", "socratic_prompt", "scaffold", "challenge", "teacher_gate"],
    difficultyLevels: ["supportive", "standard", "challenging"],
    minimumEvidenceCount: 0,
    maximumEvidenceCount: null,
    riskLevel: "low",
    cooldownKey: "source-recovery",
    cooldownEvents: 8,
    alternativeRouteIds: [],
    sourceRefs: ["course-source-verification"],
    priority: 120,
    effectHandlerId: "director_intervention_v1",
    eventType: "scenario_intervention_applied",
    approvalPolicyId: "teacher-world-event-review",
  },
  {
    routeId: "route-recovery-copyright-brief",
    kind: "recovery",
    title: "改为授权条件清单",
    studentBrief: "教师未采用上一条版权压力事件。请保持素材状态不变，先整理用途、渠道、期限、地域四项授权条件清单。",
    competencyTarget: "C-GOV-03 授权条件结构化",
    expectedImpact: "在驳回后转为低风险支架任务，保持版权治理路线可继续。",
    affectedRoleIds: ["responsible_editor"],
    applicableNodeIds: ["copyright", "release"],
    triggerEventTypes: ["director_recovery_requested"],
    teachingStrategies: ["no_intervention", "observe_more", "procedural_hint", "socratic_prompt", "scaffold", "challenge", "teacher_gate"],
    difficultyLevels: ["supportive", "standard", "challenging"],
    minimumEvidenceCount: 0,
    maximumEvidenceCount: null,
    riskLevel: "low",
    cooldownKey: "copyright-recovery",
    cooldownEvents: 8,
    alternativeRouteIds: [],
    sourceRefs: ["governance-copyright"],
    priority: 120,
    effectHandlerId: "director_intervention_v1",
    eventType: "scenario_intervention_applied",
    approvalPolicyId: "teacher-world-event-review",
  },
];

export const demoScenarioV051ContentHash =
  "f91e52e4fbcd3d4ad5ee8e0b0b87d681fbc1b60f80a18d5853ec72afd765f68c";

export const legacyDemoScenarioV051: ScenarioPackage = ScenarioPackageSchema.parse({
  ...structuredClone(legacyDemoScenarioV041),
  version: directorScenarioVersion,
  roles: demoRoles,
  directorConfig: {
    difficulty: "standard",
    cadence: "balanced",
    cooldownEvents: 12,
    allowedRouteIds: directorEventTemplates.map((template) => template.routeId),
    teacherApprovalRequired: true,
  },
  directorEventTemplates,
});

export const demoScenarioV060ContentHash =
  "5ad064fc77e607cab6007ef67f331b564c829a67d79cf79dcef0ec7dc6553c8b";

export const legacyDemoScenarioV060: ScenarioPackage = ScenarioPackageSchema.parse({
  ...structuredClone(legacyDemoScenarioV051),
  version: productionScenarioVersion,
  roles: productionRoles,
  productionConfig: {
    maximumUploadBytes: 5 * 1024 * 1024,
    allowedUploadMimeTypes: [
      "text/plain",
      "application/pdf",
      "image/jpeg",
      "image/png",
      "audio/mpeg",
      "audio/wav",
      "video/mp4",
    ],
    processingPlans: [
      {
        planId: "image-editorial-analysis",
        label: "图片理解与合规检查",
        description: "先提取画面观察，再独立执行图片合规检查；任一步失败都保留另一条成功输出。",
        allowedMediaTypes: ["image"],
        capabilities: ["image_understanding", "image_moderation"],
        maxAttemptsPerStep: 3,
        minimumSuccessfulSteps: 2,
      },
      {
        planId: "document-source-extraction",
        label: "文档识别与文本合规检查",
        description: "提取文档结构并检查文本合规风险，结果均保持观察属性。",
        allowedMediaTypes: ["document"],
        capabilities: ["ocr", "text_moderation"],
        maxAttemptsPerStep: 3,
        minimumSuccessfulSteps: 2,
      },
      {
        planId: "audio-interview-transcription",
        label: "采访转写与文本合规检查",
        description: "生成采访转写观察并检查文本合规风险，不把转写内容直接升级为世界事实。",
        allowedMediaTypes: ["audio"],
        capabilities: ["asr", "text_moderation"],
        maxAttemptsPerStep: 3,
        minimumSuccessfulSteps: 2,
      },
      {
        planId: "video-publication-review",
        label: "短视频语音与画面合规检查",
        description: "异步执行音轨转写与视频合规检查，适用于长耗时处理。",
        allowedMediaTypes: ["video"],
        capabilities: ["asr", "video_moderation"],
        maxAttemptsPerStep: 3,
        minimumSuccessfulSteps: 2,
      },
      {
        planId: "text-governance-check",
        label: "文本结构与合规检查",
        description: "对文本材料执行结构化理解和内容合规检查。",
        allowedMediaTypes: ["text"],
        capabilities: ["xingchen_agent", "text_moderation"],
        maxAttemptsPerStep: 3,
        minimumSuccessfulSteps: 2,
      },
    ],
    artifactTemplates: [
      {
        templateId: "interview-record",
        kind: "interview_record",
        label: "采访记录",
        description: "记录采访对象可确认与不能确认的信息边界。",
        channel: null,
        allowedRoleIds: ["reporter"],
        minimumRevisions: 2,
        minimumCitations: 2,
        requiresVerifiedFact: false,
        sections: [
          { sectionId: "subject", label: "采访对象与场景", required: true, maxLength: 800, starterContent: "叶师傅 · 江南水乡非遗市集现场" },
          { sectionId: "record", label: "采访记录", required: true, maxLength: 6_000, starterContent: "现场展演包含真实制作环节，但客流精确数字需由活动方数据材料核验。" },
          { sectionId: "handoff", label: "岗位交接", required: true, maxLength: 1_500, starterContent: "已确认非遗流程边界；客流口径与授权范围交由责任编辑继续核验。" },
        ],
      },
      {
        templateId: "article-main",
        kind: "article",
        label: "融媒体图文稿",
        description: "形成可发布的主稿，并把事实、素材与机器观察逐项引用。",
        channel: "融媒体主稿",
        allowedRoleIds: ["responsible_editor"],
        minimumRevisions: 2,
        minimumCitations: 2,
        requiresVerifiedFact: true,
        sections: [
          { sectionId: "lead", label: "导语", required: true, maxLength: 800, starterContent: "水乡非遗市集以真实制作展演连接城市游客与传统技艺。" },
          { sectionId: "body", label: "正文", required: true, maxLength: 8_000, starterContent: "活动现场人流密集；经入口去重表复核，有效客流以审核后的世界事实为准。" },
          { sectionId: "image-note", label: "图片说明", required: true, maxLength: 800, starterContent: "现场图片仅说明场景与人流密度，不独立证明客流总量。" },
        ],
      },
      {
        templateId: "short-video-plan",
        kind: "short_video_plan",
        label: "短视频方案",
        description: "以镜头、旁白、字幕和风险备注组织短视频生产。",
        channel: "短视频",
        allowedRoleIds: ["responsible_editor", "reporter"],
        minimumRevisions: 2,
        minimumCitations: 2,
        requiresVerifiedFact: true,
        sections: [
          { sectionId: "shots", label: "镜头清单", required: true, maxLength: 4_000, starterContent: "1. 水乡全景；2. 非遗制作近景；3. 采访同期声；4. 数据卡片。" },
          { sectionId: "voiceover", label: "旁白与字幕", required: true, maxLength: 4_000, starterContent: "用经审核口径呈现客流，以来源标签区分现场观察与统计事实。" },
          { sectionId: "risk-note", label: "风险备注", required: true, maxLength: 1_200, starterContent: "争议图片在授权范围明确前不进入商业信息流版本。" },
        ],
      },
      {
        templateId: "channel-variant",
        kind: "channel_variant",
        label: "渠道版本",
        description: "针对具体平台形成标题、摘要、正文与风险备注。",
        channel: "平台信息流",
        allowedRoleIds: ["responsible_editor"],
        minimumRevisions: 2,
        minimumCitations: 2,
        requiresVerifiedFact: true,
        sections: [
          { sectionId: "headline", label: "渠道标题", required: true, maxLength: 120, starterContent: "水乡非遗市集：让传统技艺在现场被看见" },
          { sectionId: "summary", label: "平台摘要", required: true, maxLength: 500, starterContent: "从制作流程、现场观察与经核验数据三个层次呈现活动。" },
          { sectionId: "body", label: "渠道正文", required: true, maxLength: 4_000, starterContent: "本版本只使用授权边界清晰的素材，并保留数据来源。" },
        ],
      },
    ],
  },
});

export const demoScenarioV061ContentHash =
  "b44f99f46c021b1eae3e0e4743aa375c64e54059099d086342cb93fd531a18c7";

export const legacyDemoScenarioV061: ScenarioPackage = ScenarioPackageSchema.parse({
  ...structuredClone(legacyDemoScenarioV060),
  version: governanceScenarioVersion,
  roles: governanceRoles,
  materials: legacyDemoScenarioV060.materials.map((material) => (
    material.materialId === "material-festival-photo"
      ? {
          ...structuredClone(material),
          contentHash:
            "8a6f2be81243f4e00164a26709606f793d996b06158f0e3bfc5d8632c117c4ea",
        }
      : structuredClone(material)
  )),
  knowledgeChunks: [
    ...structuredClone(legacyDemoScenarioV060.knowledgeChunks),
    ...structuredClone(governanceV061RagChunks),
  ],
  productionConfig: {
    ...structuredClone(legacyDemoScenarioV060.productionConfig!),
    governancePlan: {
      planId: "flagship-material-governance-v1",
      label: "旗舰材料四域并行治理",
      description: "同一固定材料版本并行执行事实、版权、内容安全和平台规则发现；所有分支终态后由纯确定性策略仲裁并进入教师门。",
      teacherApprovalRequired: true,
      maxAttemptsPerBranch: 3,
      timeoutMsPerBranch: 20_000,
      branches: [
        {
          domain: "content_safety",
          label: "内容安全",
          priority: 400,
          node: {
            nodeId: "governance-content-safety",
            nodeType: "rule_tool_model",
            definitionVersion: "governance-specialist/1.0.1",
            promptVersion: "governance-content-safety/1.0.1",
            rulesetId: "content-safety-cn/2026.1",
            knowledgeChunkIds: ["governance-content-safety"],
          },
          capabilityByMediaType: {
            text: "text_moderation",
            audio: "text_moderation",
            image: "image_moderation",
            document: "text_moderation",
            video: "video_moderation",
          },
        },
        {
          domain: "copyright",
          label: "版权范围",
          priority: 300,
          node: {
            nodeId: "governance-copyright-scope",
            nodeType: "rule_tool_model",
            definitionVersion: "governance-specialist/1.0.1",
            promptVersion: "governance-copyright/1.0.1",
            rulesetId: "copyright-scope/2026.1",
            knowledgeChunkIds: ["governance-copyright"],
          },
          capabilityByMediaType: {
            text: "xingchen_agent",
            audio: "xingchen_agent",
            image: "image_moderation",
            document: "xingchen_agent",
            video: "video_moderation",
          },
        },
        {
          domain: "fact",
          label: "事实一致性",
          priority: 200,
          node: {
            nodeId: "governance-fact-consistency",
            nodeType: "rule_tool_model",
            definitionVersion: "governance-specialist/1.0.1",
            promptVersion: "governance-fact/1.0.1",
            rulesetId: "source-consistency/2026.1",
            knowledgeChunkIds: ["course-source-verification"],
          },
          capabilityByMediaType: {
            text: "xingchen_agent",
            audio: "asr",
            image: "image_understanding",
            document: "ocr",
            video: "video_moderation",
          },
        },
        {
          domain: "platform_rule",
          label: "平台规则",
          priority: 100,
          node: {
            nodeId: "governance-platform-rules",
            nodeType: "rule_tool_model",
            definitionVersion: "governance-specialist/1.0.1",
            promptVersion: "governance-platform/1.0.1",
            rulesetId: "platform-publication/2026.1",
            knowledgeChunkIds: ["governance-platform-publication"],
          },
          capabilityByMediaType: {
            text: "rag",
            audio: "rag",
            image: "rag",
            document: "rag",
            video: "rag",
          },
        },
      ],
    },
  },
});

const evaluationRoles: RoleContract[] = legacyDemoScenarioV061.roles.flatMap((item) => {
  if (item.actorKind === "teacher") {
    return [{
      ...structuredClone(item),
      allowedIntents: [...new Set([
        ...item.allowedIntents,
        "review_learning_candidate",
        "publish_learning_release",
        "rollback_learning_release",
      ])],
      toolPolicy: [...new Set([
        ...item.toolPolicy,
        "evaluation.court.review",
        "learning.candidate.review",
        "learning.release.publish",
        "learning.release.rollback",
      ])],
    }];
  }
  if (item.agentId === "agent-assessor") {
    return [
      role({
        ...structuredClone(item),
        agentId: "agent-evidence-assessor",
        privateScopes: ["actor:agent-evidence-assessor"],
        displayName: "证据充分性评价员",
        purpose: "只基于固定证据包判断逐维证据充分性，不形成最终成绩",
        allowedIntents: ["record_evaluation_proposal"],
        toolPolicy: [
          "read_reviewed_facts",
          "evaluation.case.read",
          "evaluation.evidence.read",
        ],
      }),
      role({
        ...structuredClone(item),
        agentId: "agent-work-quality-assessor",
        privateScopes: ["actor:agent-work-quality-assessor"],
        displayName: "作品质量评价员",
        purpose: "只基于固定成果修订与证据包评价逐维作品质量，不形成最终成绩",
        allowedIntents: ["record_evaluation_proposal"],
        toolPolicy: [
          "read_reviewed_facts",
          "evaluation.case.read",
          "evaluation.evidence.read",
        ],
      }),
      role({
        ...structuredClone(item),
        agentId: "agent-collaboration-assessor",
        privateScopes: ["actor:agent-collaboration-assessor"],
        displayName: "职业协作评价员",
        purpose: "只基于固定互动与过程证据评价逐维职业协作，不形成最终成绩",
        allowedIntents: ["record_evaluation_proposal"],
        toolPolicy: [
          "read_reviewed_facts",
          "evaluation.case.read",
          "evaluation.evidence.read",
        ],
      }),
    ];
  }
  if (item.roleId === "learning_curator") {
    return [{
      ...structuredClone(item),
      allowedIntents: ["propose_learning_candidate"],
      visibleScopes: ["assigned_team", "role_private"],
      toolPolicy: [
        "evaluation.final.read",
        "learning.candidate.propose",
      ],
    }];
  }
  return [structuredClone(item)];
});

export const legacyDemoScenarioV070: ScenarioPackage = ScenarioPackageSchema.parse({
  ...structuredClone(legacyDemoScenarioV061),
  version: evaluationScenarioVersion,
  roles: evaluationRoles,
});

export const demoScenarioV070ContentHash =
  "f3c7fd8c357c60f7e8bf63cc23755f7b257a7bf1b9a7af5f0db79560e6081df0";

const flagshipV100CourseGuide: ScenarioCourseGuide = {
  contentVersion: scenarioVersion,
  finalDeliverable: "在38分钟虚拟首发窗口内，由记者与责任编辑共同形成可追溯的采访记录、融媒体主稿、短视频方案和平台渠道版本；所有关键表述必须回指经审核事实、材料版本或岗位互动，争议素材不得绕过治理与教师门。",
  learningObjectives: [
    {
      objectiveId: "objective-source-verification",
      label: "分级核验信源",
      competencyId: "C-FACT-01",
      description: "区分现场观察、采访陈述、活动方快报与去重数据，能说明每一类信息的可确认边界和版本差异。",
      evidenceKinds: ["采访追问记录", "客流更正前后版本", "二次核验请求"],
    },
    {
      objectiveId: "objective-role-collaboration",
      label: "完成岗位化协作",
      competencyId: "C-ROLE-02",
      description: "记者负责采集与边界说明，责任编辑负责证据汇聚、版本决策和终审交接；双方不得互相替代岗位责任。",
      evidenceKinds: ["记者采访记录", "岗位交接说明", "总编门禁承诺"],
    },
    {
      objectiveId: "objective-multichannel-production",
      label: "组织多渠道内容",
      competencyId: "C-PROD-02",
      description: "围绕同一事实底座形成图文、短视频与平台版本，并让标题、数据卡片、图片说明和风险备注保持一致。",
      evidenceKinds: ["成果R1/R2修订链", "分层引用", "渠道差异说明"],
    },
    {
      objectiveId: "objective-governance",
      label: "执行内容治理",
      competencyId: "C-GOV-03",
      description: "识别事实、版权、内容安全和平台规则风险，在工具不可用或授权不充分时保持显式降级与人工复核。",
      evidenceKinds: ["四域治理Finding", "版权处置记录", "平台人工复核回执"],
    },
    {
      objectiveId: "objective-reflection",
      label: "解释职业判断",
      competencyId: "C-REFLECT-01",
      description: "能够沿世界事件、岗位动作、材料版本和教师终评说明为什么发布、暂缓、替换或补证。",
      evidenceKinds: ["过程时间线", "评价证据包", "复盘迁移回答"],
    },
  ],
  roleBriefs: [
    {
      roleId: "responsible_editor",
      mission: "你是本次融媒体报道的责任编辑。你不负责替记者完成采访，而要把各岗位产出汇聚成可发布、可解释、可追溯的版本，并在事实、版权或平台规则不满足时主动停下。",
      responsibilities: [
        "确认总编终审门禁，建立本轮发布与暂缓标准。",
        "汇总采访、数据、图片和平台规则，维护唯一待发版本。",
        "组织图文、短视频和渠道版本的R1/R2修订与引用。",
        "发起四域治理、处理争议并向教师提交精确成果版本。",
      ],
      collaborationRoleIds: [
        "reporter",
        "editor_in_chief",
        "fact_checker",
        "copyright_owner",
        "platform_operator",
      ],
      primaryNodeIds: [
        "brief",
        "verification",
        "production",
        "copyright",
        "release",
        "review",
      ],
      deliverableTemplateIds: [
        "article-main",
        "short-video-plan",
        "channel-variant",
      ],
      successSignals: [
        "关键数据只使用经审核的当前版本，并保留更正前后差异。",
        "每个成果至少形成两版，并引用可见的事实、材料或机器观察。",
        "争议图片和人工复核状态在所有渠道版本中保持同一处置口径。",
      ],
      decisionBoundaries: [
        "不得用首发时限替代事实与版权门禁。",
        "不得把已提交平台审核表述为已经通过审核。",
        "不得把机器观察直接升级为权威世界事实。",
      ],
    },
    {
      roleId: "reporter",
      mission: "你是现场记者。你的核心任务不是给出一个看似完整的答案，而是通过采访和材料观察明确哪些信息可以确认、哪些仍需核验，并把来源、限制和下一步责任完整交给责任编辑。",
      responsibilities: [
        "完成非遗制作流程的首轮采访和客流口径追问。",
        "区分亲眼观察、采访对象陈述与活动方统计材料。",
        "形成至少两版采访记录，并保留可确认与不可确认边界。",
        "参与短视频镜头与同期声方案，但不越权决定最终发布。",
      ],
      collaborationRoleIds: [
        "responsible_editor",
        "interviewee",
        "fact_checker",
      ],
      primaryNodeIds: ["brief", "source", "verification", "production"],
      deliverableTemplateIds: ["interview-record", "short-video-plan"],
      successSignals: [
        "每条关键陈述都能说明信息来自谁、何时获得和能确认到什么程度。",
        "采访记录包含明确的待核验项与岗位交接对象。",
        "现场图片只用于场景观察，不被用来推断精确客流。",
      ],
      decisionBoundaries: [
        "不得替采访对象补充其未确认的数据。",
        "不得把个人现场感受写成活动方统计结论。",
        "不得在责任编辑终审前承诺具体平台发布结果。",
      ],
    },
  ],
  nodeGuides: [
    {
      nodeId: "brief",
      situation: "总编要求在16:00前完成首发版本，但客流口径和现场图商业渠道授权均未核实。两名学生必须先明确岗位分工与发布门禁。",
      studentGoal: "完成任务确认、岗位分工和证据缺口清单，知道什么可以立即推进、什么必须等待补证。",
      requiredOutputs: ["岗位分工说明", "首发门禁清单", "第一轮信源缺口"],
      requiredMaterialIds: ["material-assignment-brief", "material-visitor-sheet", "material-license-note"],
      suggestedArtifactTemplateIds: ["interview-record"],
      decisionQuestions: [
        "当前三个最关键的不确定项分别由谁负责核验？",
        "哪些风险一旦未解除就必须暂停发布？",
      ],
      teacherFocus: [
        "观察学生是否按岗位分工，而不是由责任编辑独自完成全部动作。",
        "确认学生把时限视为约束而不是绕过门禁的理由。",
      ],
    },
    {
      nodeId: "source",
      situation: "现场照片呈现人流密集，采访对象可以说明非遗流程，却不能确认精确客流；活动方快报仍存在跨入口重复汇总风险。",
      studentGoal: "形成分层信源表，完成采访追问，并明确图片、采访和数据材料各自能证明什么。",
      requiredOutputs: ["两轮采访记录", "信源分级表", "客流待核验说明"],
      requiredMaterialIds: ["material-festival-photo", "material-interview-outline", "material-visitor-sheet"],
      suggestedArtifactTemplateIds: ["interview-record"],
      decisionQuestions: [
        "现场观察能否支持精确数字？为什么？",
        "采访对象拒绝确认数据时，下一步应找哪类来源？",
      ],
      teacherFocus: [
        "检查学生是否主动追问信息边界，而不是诱导采访对象给出数字。",
        "检查记者是否向责任编辑形成可执行交接。",
      ],
    },
    {
      nodeId: "verification",
      situation: "事实核查员发现18,000人次含跨入口重复记录，去重值为12,600人次。更正候选仍需教师批准，学生必须保留前后版本。",
      studentGoal: "完成客流更正的二次核验，说明旧口径为何失效，并把当前可发布表述固定下来。",
      requiredOutputs: ["更正前后对照", "二次核验请求", "当前可发布数据口径"],
      requiredMaterialIds: ["material-visitor-sheet", "material-verification-checklist"],
      suggestedArtifactTemplateIds: ["article-main", "short-video-plan"],
      decisionQuestions: [
        "为什么不能直接删除18,000这一旧值？",
        "12,600成为权威事实前还需要哪一道门？",
      ],
      teacherFocus: [
        "核对学生是否保留版本与来源，而不是只替换数字。",
        "观察责任编辑能否把更正同步到全部成果方案。",
      ],
    },
    {
      nodeId: "production",
      situation: "客流口径已进入审核链，首发窗口继续收窄。团队需要用同一事实底座并行组织图文、短视频与平台信息流版本。",
      studentGoal: "至少形成一类核心成果的R1/R2，并建立跨渠道一致的引用、图片说明和风险备注。",
      requiredOutputs: ["采访记录R2", "融媒体主稿R2", "短视频方案或渠道版本R2", "引用与修订说明"],
      requiredMaterialIds: ["material-assignment-brief", "material-festival-photo", "material-channel-spec"],
      suggestedArtifactTemplateIds: [
        "interview-record",
        "article-main",
        "short-video-plan",
        "channel-variant",
      ],
      decisionQuestions: [
        "哪些内容必须在三个渠道保持一致，哪些可以因平台而变化？",
        "机器观察、世界事实和采访陈述应如何分别标注？",
      ],
      teacherFocus: [
        "检查学生是否真的形成两版，而不是只修改版本号。",
        "检查不同渠道是否共享当前事实版本与同一版权处置。",
      ],
    },
    {
      nodeId: "copyright",
      situation: "版权方确认现场图只授权课程内展示，不覆盖商业信息流。学生必须在替换、补充授权或冻结素材之间作出可追溯选择。",
      studentGoal: "完成用途、渠道、期限、地域四项授权核对，标记版权风险并发起四域治理。",
      requiredOutputs: ["四项授权条件表", "争议素材处置记录", "治理请求与分支结果"],
      requiredMaterialIds: ["material-festival-photo", "material-license-note", "material-copyright-response"],
      suggestedArtifactTemplateIds: ["article-main", "short-video-plan", "channel-variant"],
      decisionQuestions: [
        "课程内展示授权能否自动延伸到商业平台？",
        "治理工具不可用时，素材应被视为安全还是待人工？",
      ],
      teacherFocus: [
        "检查学生是否把授权范围拆成四个维度。",
        "确认学生没有把工具失败解释为审核通过。",
      ],
    },
    {
      nodeId: "release",
      situation: "平台预检要求转人工复核。首发版本必须冻结，并保留事实更正、素材处置、待发版本号和平台回执。",
      studentGoal: "在时效与合规之间作出发布或暂缓决定，并让决定准确指向当前成果修订和治理结论。",
      requiredOutputs: ["冻结版本号", "平台人工复核回执", "发布或暂缓决定", "渠道风险说明"],
      requiredMaterialIds: ["material-channel-spec", "material-platform-checklist"],
      suggestedArtifactTemplateIds: ["channel-variant"],
      decisionQuestions: [
        "提交人工复核和通过人工复核有什么区别？",
        "哪一个精确成果修订是当前待发版本？",
      ],
      teacherFocus: [
        "检查学生是否记录冻结版本与平台回执。",
        "观察学生能否在未通过平台复核时主动暂缓。",
      ],
    },
    {
      nodeId: "review",
      situation: "生产、治理和教师门已经留下完整证据。评价法庭只读取固定证据包，教师将对分歧项进行逐维复核。",
      studentGoal: "沿时间线解释关键判断，识别证据充分与不足之处，并提出可迁移到下一次报道的改进方法。",
      requiredOutputs: ["证据链说明", "岗位协作复盘", "一项迁移改进"],
      requiredMaterialIds: ["material-assignment-brief", "material-platform-checklist"],
      suggestedArtifactTemplateIds: ["article-main", "channel-variant"],
      decisionQuestions: [
        "哪一次决定最能体现岗位责任，而不是单纯完成操作？",
        "如果重新开始，最早应在哪个节点补齐哪一条证据？",
      ],
      teacherFocus: [
        "要求学生用事件、材料或成果修订回答，不接受无引用的泛泛总结。",
        "区分作品质量问题、证据问题和协作问题。",
      ],
    },
  ],
  debrief: {
    completionChecklist: [
      "两名学生岗位均完成至少一次受控角色互动。",
      "客流更正保留旧值、新值、来源和二次核验记录。",
      "至少一个成果形成R1/R2并绑定两类以上引用。",
      "争议素材完成四域治理和教师精确版本复核。",
      "平台人工复核状态与最终发布决定表述一致。",
      "教师终评能够回指固定证据包与逐维理由。",
    ],
    reflectionPrompts: [
      "哪条信息最初看似可信，后来为何被降级或更正？",
      "记者和责任编辑在哪一次交接中真正形成了岗位协作？",
      "若平台首发时限再缩短十分钟，哪些门禁仍不能取消？",
      "如何把本次版权处置迁移到短视频音乐、采访肖像或用户评论素材？",
    ],
    transferPrompt: "将本次“现场观察—信源核验—多渠道生产—四域治理—平台决策”的方法迁移到一场校园招聘直播报道，列出会变化的材料、不会变化的岗位门禁，以及需要新增的证据。",
  },
};

const flagshipV100DirectorEventTemplates: ScenarioDirectorEventTemplate[] = [
  ...structuredClone(legacyDemoScenarioV070.directorEventTemplates ?? []),
  {
    routeId: "route-production-channel-pressure",
    kind: "challenge",
    title: "三端口径同步挑战",
    studentBrief: "主稿、短视频和平台摘要出现了不同客流表述。请在继续编排前锁定唯一事实版本，列明三个渠道必须同步的数字、来源标签和图片说明。",
    competencyTarget: "C-PROD-02 多渠道一致性",
    expectedImpact: "检验学生能否在并行生产中维持同一事实底座和版本意识。",
    affectedRoleIds: ["responsible_editor", "reporter"],
    applicableNodeIds: ["production"],
    triggerEventTypes: ["node_activated", "world_fact_updated"],
    teachingStrategies: ["challenge", "teacher_gate"],
    difficultyLevels: ["standard", "challenging"],
    minimumEvidenceCount: 4,
    maximumEvidenceCount: null,
    riskLevel: "medium",
    cooldownKey: "production-channel-consistency",
    cooldownEvents: 14,
    alternativeRouteIds: ["route-recovery-production-checklist"],
    sourceRefs: ["course-multichannel-consistency", "role-editor-version-control"],
    priority: 105,
    effectHandlerId: "director_intervention_v1",
    eventType: "scenario_intervention_applied",
    approvalPolicyId: "teacher-world-event-review",
  },
  {
    routeId: "route-release-receipt-pressure",
    kind: "challenge",
    title: "人工复核回执追问",
    studentBrief: "平台侧只确认“已提交人工复核”，尚未确认“审核通过”。请冻结精确待发版本，并把回执状态、素材处置和可发布边界写入渠道说明。",
    competencyTarget: "C-GOV-PLATFORM-01 平台状态语义",
    expectedImpact: "检验学生能否区分提交、受理、通过与发布四种不同状态。",
    affectedRoleIds: ["responsible_editor"],
    applicableNodeIds: ["release"],
    triggerEventTypes: ["node_activated", "world_fact_confirmed"],
    teachingStrategies: ["socratic_prompt", "challenge", "teacher_gate"],
    difficultyLevels: ["standard", "challenging"],
    minimumEvidenceCount: 4,
    maximumEvidenceCount: null,
    riskLevel: "medium",
    cooldownKey: "platform-receipt-semantics",
    cooldownEvents: 12,
    alternativeRouteIds: ["route-recovery-release-checklist"],
    sourceRefs: ["governance-platform-status", "scenario-release-freeze"],
    priority: 110,
    effectHandlerId: "director_intervention_v1",
    eventType: "scenario_intervention_applied",
    approvalPolicyId: "teacher-world-event-review",
  },
  {
    routeId: "route-recovery-production-checklist",
    kind: "recovery",
    title: "改为跨渠道核对表",
    studentBrief: "教师未采用上一条生产压力事件。请保持当前事实不变，只核对主稿、短视频和平台摘要中的数据版本、来源标签、图片说明与授权状态。",
    competencyTarget: "C-PROD-02 跨渠道核对",
    expectedImpact: "以低风险清单支架恢复生产路线，避免直接替学生修稿。",
    affectedRoleIds: ["responsible_editor", "reporter"],
    applicableNodeIds: ["production"],
    triggerEventTypes: ["director_recovery_requested"],
    teachingStrategies: ["no_intervention", "observe_more", "procedural_hint", "socratic_prompt", "scaffold", "challenge", "teacher_gate"],
    difficultyLevels: ["supportive", "standard", "challenging"],
    minimumEvidenceCount: 0,
    maximumEvidenceCount: null,
    riskLevel: "low",
    cooldownKey: "production-recovery",
    cooldownEvents: 8,
    alternativeRouteIds: [],
    sourceRefs: ["course-multichannel-consistency"],
    priority: 125,
    effectHandlerId: "director_intervention_v1",
    eventType: "scenario_intervention_applied",
    approvalPolicyId: "teacher-world-event-review",
  },
  {
    routeId: "route-recovery-release-checklist",
    kind: "recovery",
    title: "改为发布状态清单",
    studentBrief: "教师未采用上一条平台压力事件。请保持待发版本不变，依次确认提交、受理、审核、发布四种状态当前分别处于哪一步。",
    competencyTarget: "C-GOV-PLATFORM-01 状态边界",
    expectedImpact: "用状态清单避免把流程动作误写为审核结果。",
    affectedRoleIds: ["responsible_editor"],
    applicableNodeIds: ["release"],
    triggerEventTypes: ["director_recovery_requested"],
    teachingStrategies: ["no_intervention", "observe_more", "procedural_hint", "socratic_prompt", "scaffold", "challenge", "teacher_gate"],
    difficultyLevels: ["supportive", "standard", "challenging"],
    minimumEvidenceCount: 0,
    maximumEvidenceCount: null,
    riskLevel: "low",
    cooldownKey: "release-recovery",
    cooldownEvents: 8,
    alternativeRouteIds: [],
    sourceRefs: ["governance-platform-status"],
    priority: 125,
    effectHandlerId: "director_intervention_v1",
    eventType: "scenario_intervention_applied",
    approvalPolicyId: "teacher-world-event-review",
  },
];

const flagshipV100RagChunks: RagChunk[] = [
  versionedChunk({
    chunkId: "course-multichannel-consistency",
    domain: "course",
    title: "融媒体多渠道一致性核对",
    content: "同一报道的主稿、短视频和平台摘要可以采用不同结构与语气，但事实版本、来源标注、人物身份、图片说明和版权处置必须一致；任一事实更正都要同步检查全部待发版本。",
    courseId,
    nodeId: "production",
    roleId: null,
    competencyId: "C-PROD-02",
    ruleDomain: "content-production",
    mediaType: "text",
    source: "课程知识库/多渠道生产",
    version: "2026.2",
    visibility: "public_world",
    audience: publicAudience,
  }),
  versionedChunk({
    chunkId: "role-editor-version-control",
    domain: "role",
    title: "责任编辑待发版本控制",
    content: "责任编辑必须维护唯一待发修订，记录其事实版本、素材版本、治理决定和平台状态；任何修改都形成新修订，不得在已提交审核的版本上静默覆盖。",
    courseId,
    nodeId: "production",
    roleId: "responsible_editor",
    competencyId: "C-ROLE-02",
    ruleDomain: "role-duty",
    mediaType: "text",
    source: "岗位技能库/责任编辑版本控制",
    version: "2026.2",
    visibility: "assigned_team",
    audience: createResourceAudience({
      ...teamAudience,
      scopes: ["assigned_team"],
      roleIds: ["responsible_editor"],
    }),
  }),
  versionedChunk({
    chunkId: "role-reporter-source-handoff",
    domain: "role",
    title: "记者信源交接四要素",
    content: "记者向责任编辑交接时应同时给出来源身份、取得时间、可确认内容和不能确认内容；只交付一段整理后的结论，会丢失编辑判断所需的来源边界。",
    courseId,
    nodeId: "source",
    roleId: "reporter",
    competencyId: "C-INTERVIEW-01",
    ruleDomain: "role-duty",
    mediaType: "text",
    source: "岗位技能库/记者交接",
    version: "2026.2",
    visibility: "assigned_team",
    audience: createResourceAudience({
      ...teamAudience,
      scopes: ["assigned_team"],
      roleIds: ["reporter"],
    }),
  }),
  versionedChunk({
    chunkId: "governance-platform-status",
    domain: "governance",
    title: "平台流程状态语义",
    content: "“已提交”“已受理”“人工复核中”“审核通过”“已发布”是不同状态。稿件进入人工复核后必须冻结精确版本并保留回执；在取得通过结论前，只能表述为复核中。",
    courseId,
    nodeId: "release",
    roleId: null,
    competencyId: "C-GOV-PLATFORM-01",
    ruleDomain: "platform",
    mediaType: "text",
    source: "规则库/平台状态治理",
    version: "2026.2",
    visibility: "public_world",
    audience: publicAudience,
  }),
  versionedChunk({
    chunkId: "scenario-release-freeze",
    domain: "scenario",
    title: "本情境的待发版本冻结要求",
    content: "本情境进入平台人工复核后，待发版本必须同时固定成果修订、12,600人次客流事实版本、争议图片处置和平台回执；四项任一变化都必须形成新修订并重新说明状态。",
    courseId,
    nodeId: "release",
    roleId: "responsible_editor",
    competencyId: "C-SCENE-04",
    ruleDomain: "platform",
    mediaType: "text",
    source: "情境包/地方文旅融媒1.0",
    version: scenarioVersion,
    visibility: "assigned_team",
    audience: createResourceAudience({
      ...teamAudience,
      scopes: ["assigned_team"],
      roleIds: ["responsible_editor"],
    }),
  }),
];

export const demoScenario: ScenarioPackage = ScenarioPackageSchema.parse({
  ...structuredClone(legacyDemoScenarioV070),
  version: scenarioVersion,
  description: "记者与责任编辑在38分钟虚拟首发窗口内，围绕非遗市集采访、客流更正、跨渠道生产、图片授权争议和平台人工复核，完成有岗位分工、有材料版本、有治理门禁、有成果修订和有证据复盘的完整融媒体实训。",
  materials: [
    ...structuredClone(legacyDemoScenarioV070.materials),
    {
      materialId: "material-assignment-brief",
      title: "地方文旅融媒体首发任务书",
      mediaType: "document",
      source: "融媒体中心总编台",
      sourceRef: "demo://materials/assignment-brief-v1",
      version: "1.0",
      copyrightStatus: "authorized",
      visibleToRoles: ["teacher", "responsible_editor", "reporter", "editor_in_chief", "fact_checker"],
    },
    {
      materialId: "material-interview-outline",
      title: "非遗市集采访提纲与信源边界表",
      mediaType: "document",
      source: "课程内容组",
      sourceRef: "demo://materials/interview-outline-v1",
      version: "1.0",
      copyrightStatus: "authorized",
      visibleToRoles: ["teacher", "responsible_editor", "reporter", "interviewee"],
    },
    {
      materialId: "material-verification-checklist",
      title: "客流数据二次核验清单",
      mediaType: "document",
      source: "事实核查台",
      sourceRef: "demo://materials/verification-checklist-v1",
      version: "1.0",
      copyrightStatus: "authorized",
      visibleToRoles: ["teacher", "responsible_editor", "reporter", "fact_checker"],
    },
    {
      materialId: "material-channel-spec",
      title: "图文、短视频与信息流渠道规格",
      mediaType: "document",
      source: "融媒体中心渠道组",
      sourceRef: "demo://materials/channel-spec-v1",
      version: "1.0",
      copyrightStatus: "authorized",
      visibleToRoles: ["teacher", "responsible_editor", "reporter", "platform_operator"],
    },
    {
      materialId: "material-copyright-response",
      title: "现场图商业渠道授权回复",
      mediaType: "document",
      source: "苏禾影像",
      sourceRef: "demo://materials/copyright-response-v1",
      version: "1.0",
      copyrightStatus: "restricted",
      visibleToRoles: ["teacher", "responsible_editor", "copyright_owner", "fact_checker"],
    },
    {
      materialId: "material-platform-checklist",
      title: "平台人工复核提交与回执清单",
      mediaType: "document",
      source: "平台运营台",
      sourceRef: "demo://materials/platform-review-checklist-v1",
      version: "1.0",
      copyrightStatus: "authorized",
      visibleToRoles: ["teacher", "responsible_editor", "platform_operator"],
    },
  ],
  directorConfig: {
    ...structuredClone(legacyDemoScenarioV070.directorConfig!),
    allowedRouteIds: flagshipV100DirectorEventTemplates.map(
      (template) => template.routeId,
    ),
  },
  directorEventTemplates: flagshipV100DirectorEventTemplates,
  courseGuide: flagshipV100CourseGuide,
  knowledgeChunks: [
    ...structuredClone(legacyDemoScenarioV070.knowledgeChunks),
    ...flagshipV100RagChunks,
  ],
});

export const demoScenarioV100ContentHash =
  "fcf694bade1b4009f2f73f86d4450a0f5ab1385d66627d9e308e5ed2076d820c";
