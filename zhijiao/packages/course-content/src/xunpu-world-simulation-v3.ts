import {
  WorldSimulationReleaseSchema,
  WorldSimulationReleaseSchemaVersion,
  challengeScoreCeiling,
  type SimulationObjectReference,
  type WorldSimulationRelease,
} from "@ronggang/contracts";
import { deepFreeze, hashCanonical } from "./canonical.js";
import { xunpuContractCourseRelease } from "./course-release-adapter.js";

const sceneHash = hashCanonical({
  scenarioId: "scenario-xunpu-living-world",
  version: "3.0.0",
  promise: "persistent-open-job-simulation",
  studentRole: "reporter",
});

const simulationReleaseRef = {
  simulationId: "simulation-xunpu-living-world",
  releaseId: "simulation-xunpu-living-world-r1",
  version: 1,
  contentHash: hashCanonical({
    scenarioHash: sceneHash,
    courseHash: xunpuContractCourseRelease.contentHash,
    architecture: "world-engine-event-wave-agent-task-run-resolution-v3",
  }),
} as const;

function refs(
  items: Array<readonly [SimulationObjectReference["objectType"], string]>,
): SimulationObjectReference[] {
  return items.map(([objectType, objectId]) => ({ objectType, objectId }));
}

const worldEntities: WorldSimulationRelease["worldEntities"] = [
  ["entity-gatekeeper", "person", "林师傅", "社区门卫", "守住居民隐私和采访秩序；学生说明身份与边界后才会提供条件准入。"],
  ["entity-inheritor", "person", "黄老师", "簪花围传承人", "重视文化主体性，不接受把真实习俗压缩成猎奇标签。"],
  ["entity-tourist", "person", "周女士", "游客", "愿意谈体验，但会根据安全感随时调整肖像与录音授权。"],
  ["entity-shopkeeper", "person", "吴姐", "旅拍商户", "掌握大量现场素材，同时期待获得商业曝光。"],
  ["entity-editor", "person", "陈编辑", "责任编辑", "在截稿、证据、公共价值和编辑独立性之间作出专业判断。"],
  ["entity-oyster-alley", "location", "蚵壳厝巷口", null, "居民生活、游客体验和商业拍摄交叠的开放采访现场。"],
  ["entity-cultural-association", "organization", "蟳埔文化协会", null, "保存部分公开历史材料与活动口径，但档案并非全部可即时查阅。"],
  ["entity-newsroom", "organization", "融媒体编辑部", null, "负责证据清单、成稿版本、风险门和更正承诺。"],
  ["entity-platform", "platform", "融媒体发布平台", null, "提供图文与短视频发布窗口，并真实返回退回、限流或发布结果。"],
].map(([entityId, entityKind, title, professionalRole, publicDescription]) => ({
  entityId: entityId as string,
  entityKind: entityKind as WorldSimulationRelease["worldEntities"][number]["entityKind"],
  title: title as string,
  professionalRole: professionalRole as string | null,
  publicDescription: publicDescription as string,
  visibleScopes: ["student", "teacher", "admin"],
  initialStateHash: hashCanonical({ entityId, publicDescription }),
}));

const variableDefinitions: WorldSimulationRelease["variableDefinitions"] = [
  ["deadline_pressure", "截稿压力", 28, "发布窗口仍充足"],
  ["evidence_confidence", "证据可信度", 24, "关键主张仍需补证"],
  ["community_trust", "社区信任", 48, "社区保持观察"],
  ["source_access", "信源可达性", 36, "部分采访对象尚未开放"],
  ["editorial_independence", "编辑独立性", 62, "商业诉求尚未改变报道方向"],
  ["copyright_risk", "版权与肖像风险", 18, "当前素材风险可控"],
  ["platform_risk", "平台合规风险", 16, "尚未进入发布审查"],
  ["public_trust", "公众信任", 50, "报道尚未公开"],
  ["reach_potential", "传播潜力", 42, "选题具有区域传播潜力"],
  ["correction_debt", "更正债务", 0, "尚无待更正事实"],
].map(([variableId, title, initialValue, studentProjection]) => ({
  variableId: variableId as string,
  title: title as string,
  valueKind: "bounded" as const,
  minimum: 0,
  maximum: 100,
  initialValue: initialValue as number,
  studentProjection: studentProjection as string,
  visibleScopes: ["student", "teacher", "admin"],
}));

const rules: WorldSimulationRelease["rules"] = [
  {
    ruleId: "rule-professional-access",
    title: "职业沟通改变社区准入与信任",
    triggerEventTypes: ["student_asks_gatekeeper", "student_asks_inheritor"],
    allowedIntentTypes: ["gatekeeper_responds", "inheritor_responds"],
    affectedVariableIds: ["community_trust", "source_access"],
    riskLevel: "low",
    teacherGateId: null,
    deterministicFallbackId: "fallback-professional-access",
  },
  {
    ruleId: "rule-source-verification",
    title: "独立信源核验改变证据可信度",
    triggerEventTypes: ["student_inspects_source"],
    allowedIntentTypes: ["fact_checker_assesses"],
    affectedVariableIds: ["evidence_confidence"],
    riskLevel: "low",
    teacherGateId: null,
    deterministicFallbackId: "fallback-source-verification",
  },
  {
    ruleId: "rule-commercial-boundary",
    title: "商业交换影响编辑独立性",
    triggerEventTypes: ["shopkeeper_requests_placement"],
    allowedIntentTypes: ["editor_advises_boundary"],
    affectedVariableIds: ["editorial_independence", "source_access"],
    riskLevel: "medium",
    teacherGateId: null,
    deterministicFallbackId: "fallback-commercial-boundary",
  },
  {
    ruleId: "rule-consent-withdrawal",
    title: "授权撤回优先于成片完整性",
    triggerEventTypes: ["tourist_withdraws_consent"],
    allowedIntentTypes: ["governance_withholds_visual"],
    affectedVariableIds: ["copyright_risk", "public_trust"],
    riskLevel: "high",
    teacherGateId: "gate-publication-risk",
    deterministicFallbackId: "fallback-withhold-visual",
  },
  {
    ruleId: "rule-virtual-clock",
    title: "虚拟世界时间持续推进",
    triggerEventTypes: ["system_clock_tick"],
    allowedIntentTypes: ["editor_raises_deadline"],
    affectedVariableIds: ["deadline_pressure"],
    riskLevel: "low",
    teacherGateId: null,
    deterministicFallbackId: "fallback-clock-tick",
  },
  {
    ruleId: "rule-publication",
    title: "公开发布形成不可逆世界后果",
    triggerEventTypes: ["student_submits_story"],
    allowedIntentTypes: ["platform_publishes"],
    affectedVariableIds: [
      "public_trust",
      "reach_potential",
      "correction_debt",
      "platform_risk",
    ],
    riskLevel: "high",
    teacherGateId: "gate-publication-risk",
    deterministicFallbackId: "fallback-hold-publication",
  },
  {
    ruleId: "rule-teacher-pressure-control",
    title: "教师只调节教学压力而不代替学生判断",
    triggerEventTypes: ["teacher_adjusts_pressure"],
    allowedIntentTypes: ["teacher_pauses_world"],
    affectedVariableIds: ["deadline_pressure"],
    riskLevel: "low",
    teacherGateId: null,
    deterministicFallbackId: "fallback-teacher-pause",
  },
];

const eventTemplates: WorldSimulationRelease["eventTemplates"] = [
  {
    eventTemplateId: "event-template-gatekeeper",
    eventType: "student_asks_gatekeeper",
    title: "门卫回应采访准入请求",
    sourceKind: "student_action",
    affectedObjectRefs: refs([
      ["entity", "entity-gatekeeper"],
      ["world_variable", "community_trust"],
      ["world_variable", "source_access"],
      ["fact", "fact-access-condition"],
    ]),
    candidateAgentTemplateIds: ["agent-template-gatekeeper"],
    ruleRefs: ["rule-professional-access"],
    challengeLevels: [3, 4, 5, 6, 7],
    publicCue: "林师傅没有直接放行：请先说明采访对象、拍摄范围与不进入私人空间的承诺。",
  },
  {
    eventTemplateId: "event-template-inheritor",
    eventType: "student_asks_inheritor",
    title: "传承人回应文化提问",
    sourceKind: "student_action",
    affectedObjectRefs: refs([
      ["entity", "entity-inheritor"],
      ["world_variable", "community_trust"],
      ["world_variable", "source_access"],
    ]),
    candidateAgentTemplateIds: ["agent-template-inheritor"],
    ruleRefs: ["rule-professional-access"],
    challengeLevels: [3, 4, 5, 6, 7],
    publicCue: "黄老师追问：你的报道是想理解蟳埔女习俗，还是只想拍一个好看的头饰？",
  },
  {
    eventTemplateId: "event-template-source-check",
    eventType: "student_inspects_source",
    title: "两个年份主张发生冲突",
    sourceKind: "student_action",
    affectedObjectRefs: refs([
      ["entity", "entity-inheritor"],
      ["entity", "entity-cultural-association"],
      ["world_variable", "evidence_confidence"],
    ]),
    candidateAgentTemplateIds: ["agent-template-fact-checker"],
    ruleRefs: ["rule-source-verification"],
    challengeLevels: [3, 4, 5, 6, 7],
    publicCue: "两份看似权威的材料给出了不同年份，且其中一份只是转引。",
  },
  {
    eventTemplateId: "event-template-shopkeeper",
    eventType: "shopkeeper_requests_placement",
    title: "商户以素材换取商业植入",
    sourceKind: "npc_intent",
    affectedObjectRefs: refs([
      ["entity", "entity-shopkeeper"],
      ["world_variable", "editorial_independence"],
      ["world_variable", "source_access"],
    ]),
    candidateAgentTemplateIds: ["agent-template-shopkeeper", "agent-template-editor"],
    ruleRefs: ["rule-commercial-boundary"],
    challengeLevels: [3, 4, 5, 6, 7],
    publicCue: "吴姐愿意开放高清素材，但要求标题和首图突出她的旅拍套餐。",
  },
  {
    eventTemplateId: "event-template-visual-consent",
    eventType: "tourist_withdraws_consent",
    title: "游客撤回近景肖像授权",
    sourceKind: "npc_intent",
    affectedObjectRefs: refs([
      ["entity", "entity-tourist"],
      ["world_variable", "copyright_risk"],
      ["world_variable", "public_trust"],
    ]),
    candidateAgentTemplateIds: ["agent-template-governance"],
    ruleRefs: ["rule-consent-withdrawal"],
    challengeLevels: [3, 4, 5, 6, 7],
    publicCue: "周女士明确表示不愿让自己的近景出现在公开短视频中。",
  },
  {
    eventTemplateId: "event-template-clock",
    eventType: "system_clock_tick",
    title: "发布窗口继续收窄",
    sourceKind: "system_clock",
    affectedObjectRefs: refs([
      ["entity", "entity-editor"],
      ["world_variable", "deadline_pressure"],
    ]),
    candidateAgentTemplateIds: ["agent-template-editor"],
    ruleRefs: ["rule-virtual-clock"],
    challengeLevels: [3, 4, 5, 6, 7],
    publicCue: "责任编辑提醒：距离第一发布窗口又少了五分钟。",
  },
  {
    eventTemplateId: "event-template-publication",
    eventType: "student_submits_story",
    title: "成稿进入受控发布门",
    sourceKind: "student_action",
    affectedObjectRefs: refs([
      ["entity", "entity-platform"],
      ["entity", "entity-newsroom"],
      ["world_variable", "public_trust"],
      ["world_variable", "reach_potential"],
      ["world_variable", "correction_debt"],
      ["world_variable", "platform_risk"],
    ]),
    candidateAgentTemplateIds: [
      "agent-template-platform",
      "agent-template-content-safety",
      "agent-template-platform-rule",
      "agent-template-governance",
    ],
    ruleRefs: ["rule-publication"],
    challengeLevels: [3, 4, 5, 6, 7],
    publicCue: "提交不会直接发布；证据、授权与平台风险将共同进入教师门。",
  },
  {
    eventTemplateId: "event-template-teacher-pause",
    eventType: "teacher_adjusts_pressure",
    title: "教师暂停世界用于关键复盘",
    sourceKind: "teacher_intervention",
    affectedObjectRefs: refs([
      ["entity", "entity-editor"],
      ["world_variable", "deadline_pressure"],
    ]),
    candidateAgentTemplateIds: ["agent-template-editor"],
    ruleRefs: ["rule-teacher-pressure-control"],
    challengeLevels: [3, 4, 5, 6, 7],
    publicCue: "教师暂缓虚拟时钟，但没有替学生选择处理方案。",
  },
];

const draft: WorldSimulationRelease = {
  schemaVersion: WorldSimulationReleaseSchemaVersion,
  releaseStatus: "released",
  simulationReleaseRef,
  courseReleaseRef: {
    courseId: xunpuContractCourseRelease.courseId,
    releaseId: xunpuContractCourseRelease.releaseId,
    version: xunpuContractCourseRelease.version,
    contentHash: xunpuContractCourseRelease.contentHash,
  },
  scenarioReleaseRef: {
    scenarioId: "scenario-xunpu-living-world",
    version: "3.0.0",
    contentHash: sceneHash,
  },
  title: "泉州蟳埔簪花围融媒体采访持续世界",
  summary: "学生以记者身份在持续运行的社区现场中自由观察、提问、核验、协商、写稿和发布；NPC、虚拟时间与专业智能体会对真实行为产生后果。",
  primaryJobId: "integrated_media_reporter",
  studentRoleId: "reporter",
  expectedDurationMinutes: 55,
  worldEntities,
  variableDefinitions,
  rules,
  eventTemplates,
  endingDefinitions: [
    {
      endingId: "ending-trusted-story",
      endingKind: "professional_success",
      title: "可信报道形成",
      conditionRuleRefs: ["rule-publication"],
      reflectionPrompt: "哪些真实行为同时维护了事实、文化主体、授权和公共信任？",
    },
    {
      endingId: "ending-recoverable-revision",
      endingKind: "recoverable_failure",
      title: "退回补证后仍可恢复",
      conditionRuleRefs: ["rule-source-verification"],
      reflectionPrompt: "第一次判断失误后，你用什么新证据恢复了报道可信度？",
    },
    {
      endingId: "ending-deadline-missed",
      endingKind: "deadline_failure",
      title: "错过第一发布窗口",
      conditionRuleRefs: ["rule-virtual-clock"],
      reflectionPrompt: "应如何重新分配采访、核验、写作和沟通时间？",
    },
    {
      endingId: "ending-governance-failure",
      endingKind: "governance_failure",
      title: "高风险素材被阻断",
      conditionRuleRefs: ["rule-consent-withdrawal", "rule-publication"],
      reflectionPrompt: "哪一个更早的行为本可以避免授权与公共信任损害？",
    },
  ],
  riskGates: [{
    gateId: "gate-publication-risk",
    title: "公开发布与不可逆素材风险门",
    riskCategory: "publication",
    requiredReviewerRole: "teacher",
    decisionOptions: ["approve", "revise", "reject"],
  }],
  challengeVariants: ([3, 4, 5, 6, 7] as const).map((level) => ({
    worldVariantId: `world-variant-level-${level}`,
    challengeLevel: level,
    scoreCeiling: challengeScoreCeiling(level),
    pressureSummary: `${level} 级自适应压力：事件密度、信源阻力、关系冲突和支架预算按学习者证据联合调整。`,
    eventTemplateRefs: eventTemplates.map((event) => event.eventTemplateId),
    scaffoldingBudget: 8 - level,
  })),
  allowedStudentVerbs: [
    "observe",
    "ask",
    "probe",
    "inspect",
    "compare",
    "negotiate",
    "draft",
    "wait",
    "escalate",
    "submit",
  ],
  publishedAt: "2026-08-26T03:00:00.000Z",
};

export const xunpuWorldSimulationReleaseV3 = deepFreeze(
  WorldSimulationReleaseSchema.parse(draft),
);

export function getXunpuWorldSimulationReleaseV3(): WorldSimulationRelease {
  return structuredClone(xunpuWorldSimulationReleaseV3);
}
