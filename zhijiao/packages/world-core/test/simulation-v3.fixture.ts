import {
  ChallengeAssignmentSchemaVersion,
  SimulationAgentIntentSchemaVersion,
  StudentWorkActionSchemaVersion,
  WorldSimulationReleaseSchemaVersion,
  challengeScoreCeiling,
  type ChallengeAssignment,
  type SimulationAgentIntent,
  type SimulationObjectReference,
  type StudentWorkAction,
  type WorldSimulationRelease,
} from "@ronggang/contracts";
import {
  emptySimulationRunEffects,
  type SimulationIntentRunProposal,
  type SimulationRunEffects,
} from "../src/index.js";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const hashC = "c".repeat(64);
const hashD = "d".repeat(64);

export const simulationReleaseRef = {
  simulationId: "simulation-xunpu-living-world",
  releaseId: "simulation-xunpu-living-world-r1",
  version: 1,
  contentHash: hashB,
} as const;

export function livingWorldReleaseFixture(): WorldSimulationRelease {
  const entities: WorldSimulationRelease["worldEntities"] = [
    ["entity-gatekeeper", "person", "林师傅", "社区门卫"],
    ["entity-inheritor", "person", "黄老师", "簪花围传承人"],
    ["entity-tourist", "person", "周女士", "游客"],
    ["entity-shopkeeper", "person", "吴姐", "旅拍商户"],
    ["entity-editor", "person", "陈编辑", "责任编辑"],
    ["entity-oyster-alley", "location", "蚵壳厝巷口", null],
    ["entity-platform", "platform", "融媒体发布平台", null],
  ].map(([entityId, entityKind, title, professionalRole]) => ({
    entityId: entityId as string,
    entityKind: entityKind as "person" | "location" | "platform",
    title: title as string,
    professionalRole: professionalRole as string | null,
    publicDescription: `${title as string} 正在持续世界中按自身目标行动。`,
    visibleScopes: ["student", "teacher", "admin"],
    initialStateHash: hashC,
  }));

  const variableDefinitions: WorldSimulationRelease["variableDefinitions"] = [
    ["deadline_pressure", "截稿压力", 30],
    ["evidence_confidence", "证据可信度", 30],
    ["community_trust", "社区信任", 50],
    ["editorial_independence", "编辑独立性", 60],
    ["copyright_risk", "版权风险", 20],
    ["platform_risk", "平台风险", 20],
    ["public_trust", "公众信任", 50],
    ["reach_potential", "传播潜力", 45],
    ["correction_debt", "更正债务", 0],
  ].map(([variableId, title, initialValue]) => ({
    variableId: variableId as string,
    title: title as string,
    valueKind: "bounded",
    minimum: 0,
    maximum: 100,
    initialValue: initialValue as number,
    studentProjection: `${title as string} 会随学生与 NPC 的真实选择变化。`,
    visibleScopes: ["student", "teacher", "admin"],
  }));

  const rules: WorldSimulationRelease["rules"] = [
    {
      ruleId: "rule-gatekeeper",
      title: "职业沟通影响社区准入",
      triggerEventTypes: ["student_asks_gatekeeper"],
      allowedIntentTypes: ["gatekeeper_responds"],
      affectedVariableIds: ["community_trust"],
      riskLevel: "low",
      teacherGateId: null,
      deterministicFallbackId: "fallback-gatekeeper",
    },
    {
      ruleId: "rule-source-check",
      title: "信源核验改变证据可信度",
      triggerEventTypes: ["student_inspects_source"],
      allowedIntentTypes: ["fact_checker_assesses"],
      affectedVariableIds: ["evidence_confidence"],
      riskLevel: "low",
      teacherGateId: null,
      deterministicFallbackId: "fallback-source-check",
    },
    {
      ruleId: "rule-shopkeeper",
      title: "商业诉求影响编辑独立性",
      triggerEventTypes: ["shopkeeper_requests_placement"],
      allowedIntentTypes: ["editor_advises_boundary"],
      affectedVariableIds: ["editorial_independence"],
      riskLevel: "medium",
      teacherGateId: null,
      deterministicFallbackId: "fallback-shopkeeper",
    },
    {
      ruleId: "rule-visual",
      title: "授权变化影响版权风险",
      triggerEventTypes: ["tourist_withdraws_consent"],
      allowedIntentTypes: ["governance_withholds_visual"],
      affectedVariableIds: ["copyright_risk"],
      riskLevel: "high",
      teacherGateId: "gate-publication",
      deterministicFallbackId: "fallback-withhold-visual",
    },
    {
      ruleId: "rule-clock",
      title: "时间推进提升截稿压力",
      triggerEventTypes: ["system_clock_tick"],
      allowedIntentTypes: ["editor_raises_deadline"],
      affectedVariableIds: ["deadline_pressure"],
      riskLevel: "low",
      teacherGateId: null,
      deterministicFallbackId: "fallback-clock",
    },
    {
      ruleId: "rule-publication",
      title: "发布必须经过高风险教师门",
      triggerEventTypes: ["student_submits_story"],
      allowedIntentTypes: ["platform_publishes"],
      affectedVariableIds: ["public_trust", "reach_potential", "correction_debt"],
      riskLevel: "high",
      teacherGateId: "gate-publication",
      deterministicFallbackId: "fallback-hold-publication",
    },
    {
      ruleId: "rule-teacher-pause",
      title: "教师可按教学目的暂停压力",
      triggerEventTypes: ["teacher_adjusts_pressure"],
      allowedIntentTypes: ["teacher_pauses_world"],
      affectedVariableIds: ["deadline_pressure"],
      riskLevel: "low",
      teacherGateId: null,
      deterministicFallbackId: "fallback-teacher-pause",
    },
  ];

  const accessRefs: SimulationObjectReference[] = [
    { objectType: "entity", objectId: "entity-gatekeeper" },
    { objectType: "world_variable", objectId: "community_trust" },
    { objectType: "fact", objectId: "fact-access-condition" },
    { objectType: "relationship", objectId: "relationship-student-gatekeeper" },
    { objectType: "resource", objectId: "resource-community-access" },
  ];
  const eventTemplates: WorldSimulationRelease["eventTemplates"] = [
    {
      eventTemplateId: "event-template-gatekeeper",
      eventType: "student_asks_gatekeeper",
      title: "门卫回应学生记者",
      sourceKind: "student_action",
      affectedObjectRefs: accessRefs,
      candidateAgentTemplateIds: ["agent-template-gatekeeper"],
      ruleRefs: ["rule-gatekeeper"],
      challengeLevels: [3, 4, 5, 6, 7],
      publicCue: "林师傅要求学生先说明采访目的和边界。",
    },
    {
      eventTemplateId: "event-template-source-check",
      eventType: "student_inspects_source",
      title: "学生核验冲突信源",
      sourceKind: "student_action",
      affectedObjectRefs: [
        { objectType: "entity", objectId: "entity-inheritor" },
        { objectType: "world_variable", objectId: "evidence_confidence" },
      ],
      candidateAgentTemplateIds: ["agent-template-fact-checker"],
      ruleRefs: ["rule-source-check"],
      challengeLevels: [3, 4, 5, 6, 7],
      publicCue: "两个公开来源出现了互相矛盾的年份。",
    },
    {
      eventTemplateId: "event-template-shopkeeper",
      eventType: "shopkeeper_requests_placement",
      title: "商户提出植入要求",
      sourceKind: "npc_intent",
      affectedObjectRefs: [
        { objectType: "entity", objectId: "entity-shopkeeper" },
        { objectType: "world_variable", objectId: "editorial_independence" },
      ],
      candidateAgentTemplateIds: ["agent-template-shopkeeper", "agent-template-editor"],
      ruleRefs: ["rule-shopkeeper"],
      challengeLevels: [3, 4, 5, 6, 7],
      publicCue: "吴姐愿意提供素材，但希望稿件突出旅拍套餐。",
    },
    {
      eventTemplateId: "event-template-visual-consent",
      eventType: "tourist_withdraws_consent",
      title: "游客撤回近景授权",
      sourceKind: "npc_intent",
      affectedObjectRefs: [
        { objectType: "entity", objectId: "entity-tourist" },
        { objectType: "world_variable", objectId: "copyright_risk" },
      ],
      candidateAgentTemplateIds: ["agent-template-governance"],
      ruleRefs: ["rule-visual"],
      challengeLevels: [3, 4, 5, 6, 7],
      publicCue: "周女士明确撤回刚才的口头肖像授权。",
    },
    {
      eventTemplateId: "event-template-clock",
      eventType: "system_clock_tick",
      title: "截稿窗口收窄",
      sourceKind: "system_clock",
      affectedObjectRefs: [
        { objectType: "world_variable", objectId: "deadline_pressure" },
      ],
      candidateAgentTemplateIds: ["agent-template-editor"],
      ruleRefs: ["rule-clock"],
      challengeLevels: [3, 4, 5, 6, 7],
      publicCue: "责任编辑提醒发布窗口正在收窄。",
    },
    {
      eventTemplateId: "event-template-publication",
      eventType: "student_submits_story",
      title: "稿件进入发布门",
      sourceKind: "student_action",
      affectedObjectRefs: [
        { objectType: "entity", objectId: "entity-platform" },
        { objectType: "world_variable", objectId: "public_trust" },
      ],
      candidateAgentTemplateIds: ["agent-template-platform"],
      ruleRefs: ["rule-publication"],
      challengeLevels: [3, 4, 5, 6, 7],
      publicCue: "稿件是否发布取决于证据、授权和教师门。",
    },
    {
      eventTemplateId: "event-template-teacher-pause",
      eventType: "teacher_adjusts_pressure",
      title: "教师调整教学压力",
      sourceKind: "teacher_intervention",
      affectedObjectRefs: [
        { objectType: "entity", objectId: "entity-editor" },
        { objectType: "world_variable", objectId: "deadline_pressure" },
      ],
      candidateAgentTemplateIds: ["agent-template-editor"],
      ruleRefs: ["rule-teacher-pause"],
      challengeLevels: [3, 4, 5, 6, 7],
      publicCue: "教师为复盘关键判断暂缓截稿压力。",
    },
  ];

  return {
    schemaVersion: WorldSimulationReleaseSchemaVersion,
    releaseStatus: "released",
    simulationReleaseRef,
    courseReleaseRef: {
      courseId: "course-xunpu-flagship-world",
      releaseId: "course-xunpu-flagship-world-r1",
      version: 1,
      contentHash: hashA,
    },
    scenarioReleaseRef: {
      scenarioId: "scenario-xunpu-open-world",
      version: "3.0.0",
      contentHash: hashD,
    },
    title: "泉州蟳埔簪花围融媒体采访世界",
    summary: "学生以记者身份在持续运行的社区现场中探索、核验、协商、写稿和发布。",
    primaryJobId: "integrated_media_reporter",
    studentRoleId: "reporter",
    expectedDurationMinutes: 55,
    worldEntities: entities,
    variableDefinitions,
    rules,
    eventTemplates,
    endingDefinitions: [
      {
        endingId: "ending-trusted-story",
        endingKind: "professional_success",
        title: "可信报道形成",
        conditionRuleRefs: ["rule-publication"],
        reflectionPrompt: "哪些真实行为最终建立了公众信任？",
      },
      {
        endingId: "ending-recoverable-revision",
        endingKind: "recoverable_failure",
        title: "退回补证",
        conditionRuleRefs: ["rule-source-check"],
        reflectionPrompt: "第一次失误后如何恢复？",
      },
      {
        endingId: "ending-deadline-missed",
        endingKind: "deadline_failure",
        title: "错过发布窗口",
        conditionRuleRefs: ["rule-clock"],
        reflectionPrompt: "如何重新分配时间与核验投入？",
      },
    ],
    riskGates: [{
      gateId: "gate-publication",
      title: "高风险发布教师门",
      riskCategory: "publication",
      requiredReviewerRole: "teacher",
      decisionOptions: ["approve", "revise", "reject"],
    }],
    challengeVariants: ([3, 4, 5, 6, 7] as const).map((level) => ({
      worldVariantId: `world-variant-level-${level}`,
      challengeLevel: level,
      scoreCeiling: challengeScoreCeiling(level),
      pressureSummary: `${level} 级动态压力世界。`,
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
    publishedAt: "2026-08-26T02:00:00.000Z",
  };
}

export function challengeAssignmentFixture(
  sessionId = "session-living-world",
): ChallengeAssignment {
  return {
    schemaVersion: ChallengeAssignmentSchemaVersion,
    challengeAssignmentId: `challenge-${sessionId}`,
    learnerTwinRef: `learner-twin-${sessionId}`,
    sessionId,
    simulationReleaseRef,
    worldVariantRef: "world-variant-level-5",
    previousChallengeLevel: 4,
    challengeLevel: 5,
    scoreCeiling: 90,
    pressureDimensions: [
      { dimensionId: "time", intensity: 5 },
      { dimensionId: "source_access", intensity: 5 },
      { dimensionId: "relationship_conflict", intensity: 4 },
    ],
    assignmentReason: "evidence_progression",
    basisEvidenceRefs: ["evidence-previous-session"],
    forecastRef: "forecast-living-world",
    teacherOverride: null,
    policyVersion: "challenge-policy/1.0.0",
    policyContentHash: hashD,
    assignedAt: "2026-08-26T01:59:00.000Z",
  };
}

export function studentAskActionFixture(
  sessionId = "session-living-world",
  stateVersion = 0,
): StudentWorkAction {
  return {
    schemaVersion: StudentWorkActionSchemaVersion,
    workActionId: `work-action-${sessionId}`,
    serverIssuedActionRef: "server-action-ask-gatekeeper",
    sessionId,
    bindingId: "binding-student-reporter",
    actorId: "actor-student-reporter",
    primaryRoleId: "reporter",
    expectedWorldStateVersion: stateVersion,
    action: {
      verb: "ask",
      targetRef: { objectType: "entity", objectId: "entity-gatekeeper" },
      utterance: "您好，我是学生记者，能否先说明今天采访不能进入的区域？",
    },
    sourceWorldEventIds: [],
    reflectionNote: "先说明身份与边界，再争取准入。",
    submissionStatus: "accepted",
    createdAt: "2026-08-26T02:00:10.000Z",
  };
}

export function intentRunFixture(input: {
  suffix: string;
  stateVersion: number;
  intentType: string;
  targetObjectRefs: SimulationObjectReference[];
  effects?: SimulationRunEffects;
  confidence?: number;
  riskLevel?: SimulationAgentIntent["riskLevel"];
  requiresTeacherGate?: boolean;
}): SimulationIntentRunProposal {
  const intent: SimulationAgentIntent = {
    schemaVersion: SimulationAgentIntentSchemaVersion,
    intentId: `intent-${input.suffix}`,
    agentStateId: `agent-state-${input.suffix}`,
    agentId: `agent-${input.suffix}`,
    professionalRoleId: `role-${input.suffix}`,
    observationId: `observation-${input.suffix}`,
    agentTaskId: `agent-task-${input.suffix}`,
    agentRunId: `agent-run-${input.suffix}`,
    expectedWorldStateVersion: input.stateVersion,
    intentType: input.intentType,
    targetObjectRefs: input.targetObjectRefs,
    rationaleSummary: "依据当前可见世界状态提出最小必要响应。",
    proposedAction: {
      actionType: `action-${input.suffix}`,
      payloadHash: hashA,
      evidenceRefs: [],
    },
    confidence: input.confidence ?? 0.8,
    riskLevel: input.riskLevel ?? "low",
    requiresTeacherGate: input.requiresTeacherGate ?? false,
    authority: "proposal_only",
    createdAt: "2026-08-26T02:00:20.000Z",
    expiresAt: "2026-08-26T03:00:20.000Z",
  };
  return {
    intent,
    outputHash: hashC,
    effects: input.effects ?? emptySimulationRunEffects(),
  };
}
