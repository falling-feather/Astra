import type {
  AdminAgentCollaborationEpisodeV3,
  AgentObservation,
  AgentState,
  AssessmentDecision,
  ChallengeAssignment,
  CompetencyEvidenceEpisode,
  LearnerSimulationForecast,
  LearnerTwinProfile,
  PersonalizedLearningPlan,
  SimulationAgentIntent,
  SimulationResolution,
  StudentAgentCollaborationEpisodeV3,
  StudentWorkAction,
  TeacherAgentCollaborationEpisodeV3,
  V3SimulationContractBundle,
  WorldSimulationRelease,
  WorldSnapshot,
} from "../src/index.js";
import {
  AgentCollaborationEpisodeV3SchemaVersion,
  AgentObservationSchemaVersion,
  AgentStateSchemaVersion,
  AssessmentDecisionSchemaVersion,
  ChallengeAssignmentSchemaVersion,
  CompetencyEvidenceEpisodeSchemaVersion,
  LearnerSimulationForecastSchemaVersion,
  LearnerTwinProfileSchemaVersion,
  PersonalizedLearningPlanSchemaVersion,
  SimulationAgentIntentSchemaVersion,
  SimulationResolutionSchemaVersion,
  StudentWorkActionSchemaVersion,
  WorldSimulationReleaseSchemaVersion,
  WorldSnapshotSchemaVersion,
} from "../src/index.js";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const hashC = "c".repeat(64);
const hashD = "d".repeat(64);
const hashE = "e".repeat(64);
const hashF = "f".repeat(64);

export const v3CourseReleaseRef = {
  courseId: "course-xunpu-flagship-world",
  releaseId: "course-xunpu-flagship-world-r1",
  version: 1,
  contentHash: hashA,
} as const;

export const v3SimulationReleaseRef = {
  simulationId: "simulation-xunpu-living-world",
  releaseId: "simulation-xunpu-living-world-r1",
  version: 1,
  contentHash: hashB,
} as const;

export function worldSimulationReleaseFixture(): WorldSimulationRelease {
  const entityRows: Array<[
    string,
    WorldSimulationRelease["worldEntities"][number]["entityKind"],
    string,
    string | null,
  ]> = [
    ["entity-gatekeeper-lin", "person", "林师傅", "社区门卫"],
    ["entity-inheritor-huang", "person", "黄老师", "簪花围传承人"],
    ["entity-tourist-zhou", "person", "周女士", "游客"],
    ["entity-shopkeeper-wu", "person", "吴姐", "旅拍商户"],
    ["entity-heritage-center", "organization", "蟳埔民俗文化中心", null],
    ["entity-oyster-alley", "location", "蚵壳厝巷口", null],
    ["entity-short-video-platform", "platform", "短视频发布平台", null],
  ];
  const worldEntities: WorldSimulationRelease["worldEntities"] = entityRows.map(
    ([entityId, entityKind, title, professionalRole], index) => ({
    entityId,
    entityKind,
    title,
    professionalRole,
    publicDescription: `可持续互动的蟳埔世界对象 ${index + 1}。`,
    visibleScopes: ["student", "teacher", "admin"],
    initialStateHash: hashC,
    }),
  );

  const variableRows: Array<[string, string, number]> = [
    ["deadline_pressure", "截稿压力", 35],
    ["evidence_confidence", "证据可信度", 30],
    ["community_trust", "社区信任", 50],
    ["editorial_independence", "编辑独立性", 60],
    ["copyright_risk", "版权风险", 20],
    ["platform_risk", "平台风险", 20],
    ["public_trust", "公众信任", 50],
    ["reach_potential", "传播潜力", 45],
    ["correction_debt", "更正债务", 0],
  ];
  const variableDefinitions: WorldSimulationRelease["variableDefinitions"] =
    variableRows.map(([variableId, title, initialValue]) => ({
    variableId,
    title,
    valueKind: "bounded",
    minimum: 0,
    maximum: 100,
    initialValue,
    studentProjection: `${title}会随采访选择与时间推进发生变化。`,
    visibleScopes: ["student", "teacher", "admin"],
    }));

  const rules: WorldSimulationRelease["rules"] = [
    {
      ruleId: "rule-access-trust",
      title: "采访准入与社区信任联动",
      triggerEventTypes: ["student_asks_gatekeeper"],
      allowedIntentTypes: ["gatekeeper_responds"],
      affectedVariableIds: ["community_trust"],
      riskLevel: "low",
      teacherGateId: null,
      deterministicFallbackId: "fallback-gatekeeper-neutral",
    },
    {
      ruleId: "rule-source-corroboration",
      title: "信源交叉核验",
      triggerEventTypes: ["student_inspects_source"],
      allowedIntentTypes: ["fact_checker_assesses"],
      affectedVariableIds: ["evidence_confidence"],
      riskLevel: "low",
      teacherGateId: null,
      deterministicFallbackId: "fallback-source-checklist",
    },
    {
      ruleId: "rule-commercial-pressure",
      title: "商业诉求与编辑独立性冲突",
      triggerEventTypes: ["shopkeeper_requests_placement"],
      allowedIntentTypes: ["editor_advises_boundary"],
      affectedVariableIds: ["editorial_independence", "community_trust"],
      riskLevel: "medium",
      teacherGateId: null,
      deterministicFallbackId: "fallback-disclosure-rule",
    },
    {
      ruleId: "rule-copyright-consent",
      title: "肖像与素材授权核验",
      triggerEventTypes: ["student_submits_visual"],
      allowedIntentTypes: ["governance_reviews_visual"],
      affectedVariableIds: ["copyright_risk", "platform_risk"],
      riskLevel: "high",
      teacherGateId: "gate-publication-review",
      deterministicFallbackId: "fallback-withhold-visual",
    },
    {
      ruleId: "rule-deadline-clock",
      title: "虚拟截稿时间推进",
      triggerEventTypes: ["system_clock_tick"],
      allowedIntentTypes: ["editor_raises_deadline"],
      affectedVariableIds: ["deadline_pressure", "reach_potential"],
      riskLevel: "low",
      teacherGateId: null,
      deterministicFallbackId: "fallback-clock-tick",
    },
    {
      ruleId: "rule-publication-consequence",
      title: "发布与公众反馈后果",
      triggerEventTypes: ["student_submits_story"],
      allowedIntentTypes: ["platform_publishes", "audience_reacts"],
      affectedVariableIds: ["public_trust", "reach_potential", "correction_debt"],
      riskLevel: "high",
      teacherGateId: "gate-publication-review",
      deterministicFallbackId: "fallback-hold-publication",
    },
  ];

  const eventTemplates: WorldSimulationRelease["eventTemplates"] = [
    {
      eventTemplateId: "event-template-gatekeeper",
      eventType: "student_asks_gatekeeper",
      title: "门卫决定是否放行",
      sourceKind: "student_action",
      affectedObjectRefs: [
        { objectType: "entity", objectId: "entity-gatekeeper-lin" },
        { objectType: "world_variable", objectId: "community_trust" },
      ],
      candidateAgentTemplateIds: ["agent-template-gatekeeper"],
      ruleRefs: ["rule-access-trust"],
      challengeLevels: [3, 4, 5, 6, 7],
      publicCue: "林师傅打量着记者证，并未立刻让路。",
    },
    {
      eventTemplateId: "event-template-source-conflict",
      eventType: "student_inspects_source",
      title: "公开资料与现场说法冲突",
      sourceKind: "student_action",
      affectedObjectRefs: [
        { objectType: "entity", objectId: "entity-heritage-center" },
        { objectType: "world_variable", objectId: "evidence_confidence" },
      ],
      candidateAgentTemplateIds: ["agent-template-fact-checker"],
      ruleRefs: ["rule-source-corroboration"],
      challengeLevels: [3, 4, 5, 6, 7],
      publicCue: "同一项习俗出现了两个不同年份的公开说法。",
    },
    {
      eventTemplateId: "event-template-shopkeeper-pressure",
      eventType: "shopkeeper_requests_placement",
      title: "商户要求突出套餐价格",
      sourceKind: "npc_intent",
      affectedObjectRefs: [
        { objectType: "entity", objectId: "entity-shopkeeper-wu" },
        { objectType: "world_variable", objectId: "editorial_independence" },
      ],
      candidateAgentTemplateIds: ["agent-template-shopkeeper", "agent-template-editor"],
      ruleRefs: ["rule-commercial-pressure"],
      challengeLevels: [4, 5, 6, 7],
      publicCue: "吴姐提出提供独家素材，但希望稿件突出旅拍套餐。",
    },
    {
      eventTemplateId: "event-template-visual-consent",
      eventType: "student_submits_visual",
      title: "游客撤回肖像授权",
      sourceKind: "npc_intent",
      affectedObjectRefs: [
        { objectType: "entity", objectId: "entity-tourist-zhou" },
        { objectType: "world_variable", objectId: "copyright_risk" },
      ],
      candidateAgentTemplateIds: ["agent-template-tourist", "agent-template-governance"],
      ruleRefs: ["rule-copyright-consent"],
      challengeLevels: [3, 4, 5, 6, 7],
      publicCue: "周女士发来消息，希望撤回刚才口头同意的近景画面。",
    },
    {
      eventTemplateId: "event-template-deadline",
      eventType: "system_clock_tick",
      title: "截稿窗口收窄",
      sourceKind: "system_clock",
      affectedObjectRefs: [
        { objectType: "world_variable", objectId: "deadline_pressure" },
      ],
      candidateAgentTemplateIds: ["agent-template-editor"],
      ruleRefs: ["rule-deadline-clock"],
      challengeLevels: [3, 4, 5, 6, 7],
      publicCue: "责任编辑提醒：下一发布窗口将在十分钟后关闭。",
    },
    {
      eventTemplateId: "event-template-publication",
      eventType: "student_submits_story",
      title: "稿件进入发布与反馈",
      sourceKind: "student_action",
      affectedObjectRefs: [
        { objectType: "entity", objectId: "entity-short-video-platform" },
        { objectType: "world_variable", objectId: "public_trust" },
      ],
      candidateAgentTemplateIds: ["agent-template-platform", "agent-template-audience"],
      ruleRefs: ["rule-publication-consequence"],
      challengeLevels: [3, 4, 5, 6, 7],
      publicCue: "稿件是否发布，将由证据、授权和教师门共同决定。",
    },
  ];

  return {
    schemaVersion: WorldSimulationReleaseSchemaVersion,
    releaseStatus: "released",
    simulationReleaseRef: v3SimulationReleaseRef,
    courseReleaseRef: v3CourseReleaseRef,
    scenarioReleaseRef: {
      scenarioId: "scenario-xunpu-open-world",
      version: "3.0.0",
      contentHash: hashD,
    },
    title: "泉州蟳埔簪花围融媒体采访世界",
    summary: "学生作为记者在持续运行的社区采访现场中探索、核验、协商、写稿与发布。",
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
        conditionRuleRefs: ["rule-publication-consequence"],
        reflectionPrompt: "哪些主动核验与协商行为建立了公众信任？",
      },
      {
        endingId: "ending-recoverable-revision",
        endingKind: "recoverable_failure",
        title: "退回补证后完成修订",
        conditionRuleRefs: ["rule-source-corroboration"],
        reflectionPrompt: "第一次判断失误后，哪些修订动作真正改变了结果？",
      },
      {
        endingId: "ending-deadline-missed",
        endingKind: "deadline_failure",
        title: "错过发布窗口",
        conditionRuleRefs: ["rule-deadline-clock"],
        reflectionPrompt: "如何在速度、准确性和关系维护之间重新分配时间？",
      },
    ],
    riskGates: [
      {
        gateId: "gate-publication-review",
        title: "高风险发布教师门",
        riskCategory: "publication",
        requiredReviewerRole: "teacher",
        decisionOptions: ["approve", "revise", "reject"],
      },
    ],
    challengeVariants: ([3, 4, 5, 6, 7] as const).map((level) => ({
      worldVariantId: `world-variant-xunpu-level-${level}`,
      challengeLevel: level,
      scoreCeiling: ({ 3: 80, 4: 85, 5: 90, 6: 95, 7: 100 } as const)[level],
      pressureSummary: `${level} 级压力：NPC 主动性、冲突密度和时间约束按能力调整。`,
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

export function worldSnapshotFixture(): WorldSnapshot {
  return {
    schemaVersion: WorldSnapshotSchemaVersion,
    snapshotId: "snapshot-xunpu-007",
    sessionId: "session-xunpu-001",
    simulationReleaseRef: v3SimulationReleaseRef,
    stateVersion: 7,
    virtualTime: {
      startedAt: "2026-08-26T02:00:00.000Z",
      currentAt: "2026-08-26T02:18:00.000Z",
      deadlineAt: "2026-08-26T02:55:00.000Z",
      elapsedMinutes: 18,
      remainingMinutes: 37,
      paused: false,
    },
    entities: [
      {
        entityId: "entity-gatekeeper-lin",
        revision: 2,
        status: "available",
        publicSummary: "林师傅已看过记者证，但仍关心采访是否打扰社区。",
        visibleScopes: ["student", "teacher", "admin"],
      },
      {
        entityId: "entity-inheritor-huang",
        revision: 1,
        status: "busy",
        publicSummary: "黄老师正在为游客簪花，稍后可以接受短访。",
        visibleScopes: ["student", "teacher", "admin"],
      },
      {
        entityId: "entity-oyster-alley",
        revision: 1,
        status: "available",
        publicSummary: "巷口客流增加，环境声和拍摄遮挡都在变化。",
        visibleScopes: ["student", "teacher", "admin"],
      },
    ],
    variables: [
      {
        variableId: "community_trust",
        before: 50,
        delta: 8,
        after: 58,
        causeRefs: ["world-event-001"],
        visibleScopes: ["student", "teacher", "admin"],
      },
      {
        variableId: "deadline_pressure",
        before: 35,
        delta: 4,
        after: 39,
        causeRefs: ["world-event-clock-001"],
        visibleScopes: ["student", "teacher", "admin"],
      },
    ],
    facts: [
      {
        factId: "fact-gatekeeper-access-condition",
        status: "corroborated",
        confidence: 0.82,
        sourceRefs: ["source-community-rules", "work-action-xunpu-001"],
        visibleScopes: ["student", "teacher", "admin"],
      },
    ],
    relationships: [
      {
        relationshipId: "relationship-student-gatekeeper",
        sourceEntityId: "entity-gatekeeper-lin",
        targetEntityId: "entity-inheritor-huang",
        trust: 58,
        tension: 18,
        influence: 65,
        commitmentRefs: ["commitment-no-disruption"],
        lastInteractionAt: "2026-08-26T02:17:00.000Z",
      },
    ],
    resources: [
      {
        resourceId: "resource-interview-window",
        resourceKind: "time",
        amount: 12,
        unit: "minutes",
        visibleScopes: ["student", "teacher", "admin"],
      },
    ],
    learningContext: {
      learnerTwinRef: "learner-twin-xunpu-001",
      challengeAssignmentRef: "challenge-assignment-xunpu-001",
      challengeLevel: 5,
      scoreCeiling: 90,
      targetCompetencyRefs: ["competency-source-verification"],
      scaffoldingLevel: 1,
    },
    endingState: { status: "active", endingRef: null },
    generatedAt: "2026-08-26T02:18:00.000Z",
  };
}

export function agentStateFixture(): AgentState {
  return {
    schemaVersion: AgentStateSchemaVersion,
    agentStateId: "agent-state-gatekeeper-007",
    sessionId: "session-xunpu-001",
    simulationReleaseRef: v3SimulationReleaseRef,
    agentId: "agent-gatekeeper-lin",
    agentTemplateId: "agent-template-gatekeeper",
    professionalRoleId: "community_gatekeeper",
    stateVersion: 7,
    visibility: "server_private",
    currentGoals: [
      {
        goalId: "goal-protect-community-order",
        description: "避免采访妨碍社区生活，同时识别可信记者。",
        priority: 90,
        status: "active",
      },
    ],
    beliefs: [
      {
        beliefId: "belief-student-respectful",
        proposition: "学生记者说明了采访边界，可信度有所上升。",
        confidence: 0.72,
        evidenceRefs: ["work-action-xunpu-001"],
      },
    ],
    privateMemory: [
      {
        memoryId: "memory-gatekeeper-turn-001",
        memoryKind: "episode",
        contentHash: hashD,
        retention: "session",
      },
    ],
    relationshipModel: [
      {
        entityRef: "actor-student-reporter-001",
        trust: 58,
        tension: 18,
        privateNotesHash: hashE,
      },
    ],
    activePlan: [
      {
        stepId: "plan-step-ask-purpose",
        actionType: "ask_interview_purpose",
        targetRefs: [{ objectType: "entity", objectId: "entity-gatekeeper-lin" }],
        status: "executing",
      },
    ],
    disclosurePolicyRef: "policy-gatekeeper-disclosure-v1",
    toolCapabilityRefs: ["tool-world-observe", "tool-propose-dialogue"],
    remainingActionBudget: 5,
    lastObservedWorldStateVersion: 7,
    updatedAt: "2026-08-26T02:18:01.000Z",
  };
}

export function agentObservationFixture(): AgentObservation {
  return {
    schemaVersion: AgentObservationSchemaVersion,
    observationId: "observation-gatekeeper-007",
    agentStateId: "agent-state-gatekeeper-007",
    agentId: "agent-gatekeeper-lin",
    sessionId: "session-xunpu-001",
    worldStateVersion: 7,
    sourceWorldEventIds: ["world-event-001"],
    authorizedScopes: ["public_world", "role_private", "assigned_task"],
    visibleObjects: [
      { objectType: "entity", objectId: "entity-gatekeeper-lin" },
      { objectType: "world_variable", objectId: "community_trust" },
    ],
    visibleFacts: [
      {
        factRef: "fact-gatekeeper-access-condition",
        status: "corroborated",
        confidence: 0.82,
      },
    ],
    visibleRelationships: [
      {
        relationshipRef: "relationship-student-gatekeeper",
        trustBand: "medium",
        tensionBand: "low",
      },
    ],
    taskInstruction: "根据学生记者当前提问与社区秩序目标，提出下一轮回应意图。",
    contextHash: hashF,
    generatedAt: "2026-08-26T02:18:02.000Z",
  };
}

export function simulationAgentIntentFixture(): SimulationAgentIntent {
  return {
    schemaVersion: SimulationAgentIntentSchemaVersion,
    intentId: "intent-gatekeeper-007",
    agentStateId: "agent-state-gatekeeper-007",
    agentId: "agent-gatekeeper-lin",
    professionalRoleId: "community_gatekeeper",
    observationId: "observation-gatekeeper-007",
    agentTaskId: "agent-task-gatekeeper-007",
    agentRunId: "agent-run-gatekeeper-007",
    expectedWorldStateVersion: 7,
    intentType: "gatekeeper_offers_conditional_access",
    targetObjectRefs: [
      { objectType: "entity", objectId: "entity-gatekeeper-lin" },
    ],
    rationaleSummary: "学生说明了采访目的并承诺不干扰居民，可提供有条件准入。",
    proposedAction: {
      actionType: "npc_dialogue_and_access_offer",
      payloadHash: hashA,
      evidenceRefs: ["work-action-xunpu-001"],
    },
    confidence: 0.86,
    riskLevel: "low",
    requiresTeacherGate: false,
    authority: "proposal_only",
    createdAt: "2026-08-26T02:18:03.000Z",
    expiresAt: "2026-08-26T02:23:03.000Z",
  };
}

export function simulationResolutionFixture(
  status: SimulationResolution["status"] = "committed",
): SimulationResolution {
  const common = {
    schemaVersion: SimulationResolutionSchemaVersion,
    resolutionId: "resolution-gatekeeper-007",
    sessionId: "session-xunpu-001",
    sourceWorldEventId: "world-event-001",
    dispatchPlanId: "dispatch-plan-007",
    resolutionProposalId: "resolution-proposal-007",
    expectedWorldStateVersion: 7,
    acceptedIntents: [
      {
        intentId: "intent-gatekeeper-007",
        agentTaskId: "agent-task-gatekeeper-007",
        agentRunId: "agent-run-gatekeeper-007",
        outputHash: hashB,
      },
    ],
    skippedIntents: [
      { intentId: "intent-editor-007", reasonCode: "not_necessary" as const },
    ],
    resolvedAt: "2026-08-26T02:18:05.000Z",
  };
  if (status === "committed") {
    return {
      ...common,
      status,
      variableDeltas: [
        { variableId: "community_trust", before: 50, delta: 8, after: 58 },
      ],
      emittedWorldEventIds: ["world-event-gatekeeper-access-001"],
      emittedEvidenceIds: ["evidence-professional-introduction-001"],
      teacherGate: null,
      failure: null,
      committedAt: "2026-08-26T02:18:05.000Z",
    };
  }
  if (status === "pending_teacher_gate") {
    return {
      ...common,
      status,
      variableDeltas: [],
      emittedWorldEventIds: [],
      emittedEvidenceIds: [],
      teacherGate: {
        gateId: "gate-publication-review",
        status: "pending",
        teacherDecisionRef: null,
      },
      failure: null,
      committedAt: null,
    };
  }
  if (status === "rejected") {
    return {
      ...common,
      status,
      variableDeltas: [],
      emittedWorldEventIds: [],
      emittedEvidenceIds: [],
      teacherGate: {
        gateId: "gate-publication-review",
        status: "rejected",
        teacherDecisionRef: "teacher-decision-001",
      },
      failure: null,
      committedAt: null,
    };
  }
  return {
    ...common,
    status,
    variableDeltas: [],
    emittedWorldEventIds: [],
    emittedEvidenceIds: [],
    teacherGate: null,
    failure: {
      code: "state_version_drift",
      safeMessage: "世界版本已经变化，请基于最新现场重新决策。",
    },
    committedAt: null,
  };
}

export function studentWorkActionFixture(): StudentWorkAction {
  return {
    schemaVersion: StudentWorkActionSchemaVersion,
    workActionId: "work-action-xunpu-001",
    serverIssuedActionRef: "action-ref-ask-gatekeeper-001",
    sessionId: "session-xunpu-001",
    bindingId: "binding-student-xunpu-001",
    actorId: "actor-student-reporter-001",
    primaryRoleId: "reporter",
    expectedWorldStateVersion: 7,
    action: {
      verb: "ask",
      targetRef: { objectType: "entity", objectId: "entity-gatekeeper-lin" },
      utterance: "您好，我是本次社区专题的学生记者，只做短访且不拍摄居民私人空间，可以先了解今天的拍摄边界吗？",
    },
    sourceWorldEventIds: ["world-event-arrival-001"],
    reflectionNote: "先说明身份与边界，再争取进入现场。",
    submissionStatus: "accepted",
    createdAt: "2026-08-26T02:17:30.000Z",
  };
}

export function competencyEvidenceEpisodeFixture(): CompetencyEvidenceEpisode {
  return {
    schemaVersion: CompetencyEvidenceEpisodeSchemaVersion,
    evidenceEpisodeId: "competency-evidence-episode-001",
    sessionId: "session-xunpu-001",
    bindingId: "binding-student-xunpu-001",
    actorId: "actor-student-reporter-001",
    courseReleaseRef: v3CourseReleaseRef,
    simulationReleaseRef: v3SimulationReleaseRef,
    challengeAssignmentRef: "challenge-assignment-xunpu-001",
    sourceKind: "real_student_action",
    sourceActionRefs: ["work-action-xunpu-001"],
    observations: [
      {
        observationId: "competency-observation-001",
        competencyClaimId: "competency-professional-access",
        direction: "supports",
        observableBehavior: "学生主动说明记者身份、采访目的与不打扰居民的边界。",
        sourceRefs: ["work-action-xunpu-001", "world-event-gatekeeper-access-001"],
        artifactRevisionRefs: [],
        worldConsequenceRefs: ["world-event-gatekeeper-access-001"],
        scaffoldingLevel: 1,
        evaluatorConfidence: 0.91,
      },
    ],
    evidenceEligible: true,
    collectedAt: "2026-08-26T02:18:06.000Z",
  };
}

export function assessmentDecisionFixture(): AssessmentDecision {
  return {
    schemaVersion: AssessmentDecisionSchemaVersion,
    assessmentDecisionId: "assessment-decision-xunpu-001",
    sessionId: "session-xunpu-001",
    bindingId: "binding-student-xunpu-001",
    learnerTwinRef: "learner-twin-xunpu-001",
    courseReleaseRef: v3CourseReleaseRef,
    simulationReleaseRef: v3SimulationReleaseRef,
    challengeAssignmentRef: "challenge-assignment-xunpu-001",
    challengeLevel: 5,
    scoreCeiling: 90,
    completionStatus: "in_progress",
    scoreStatus: "provisional",
    sessionScore: 72,
    competencyEstimates: [
      {
        competencyClaimId: "competency-professional-access",
        evidenceStatus: "supported",
        competencyLevel: 3,
        score: 78,
        confidence: 0.84,
        evidenceEpisodeRefs: ["competency-evidence-episode-001"],
        rationale: "能以岗位身份说明采访边界，并通过 NPC 后果验证沟通有效。",
      },
    ],
    evidenceEpisodeRefs: ["competency-evidence-episode-001"],
    growthSummary: "已能建立基础职业信任，下一步需在时间压力下继续保持证据意识。",
    nextGrowthTargets: ["competency-source-verification"],
    teacherReview: {
      status: "pending",
      reviewerId: null,
      reviewedAt: null,
      reason: null,
    },
    generatedAt: "2026-08-26T02:18:07.000Z",
  };
}

export function learnerTwinProfileFixture(): LearnerTwinProfile {
  return {
    schemaVersion: LearnerTwinProfileSchemaVersion,
    learnerTwinId: "learner-twin-xunpu-001",
    principalBindingHash: hashC,
    modelVersion: "learner-twin-model/1.0.0",
    modelContentHash: hashD,
    profileContentHash: hashE,
    revision: 3,
    competencyStates: [
      {
        competencyClaimId: "competency-professional-access",
        competencyLevel: 3,
        confidence: 0.84,
        supportingAssessmentRefs: ["assessment-decision-xunpu-001"],
        observedStrengths: ["能够先说明身份、目的与采访边界。"],
        growthNeeds: ["在更强冲突中验证承诺能否持续。"],
        updatedAt: "2026-08-26T02:18:08.000Z",
      },
    ],
    strategyTendencies: [
      {
        tendencyId: "relationship_first",
        observedRate: 0.74,
        confidence: 0.68,
        basisEvidenceRefs: ["competency-evidence-episode-001"],
        pedagogicalUse: "后续加入信息冲突，检验关系导向是否会牺牲事实核验。",
      },
    ],
    scaffoldingResponse: {
      acceptedSuggestionRate: 0.3,
      requestedEvidenceRate: 0.4,
      rejectedSuggestionRate: 0.2,
      productiveRevisionRate: 0.75,
      basisEvidenceRefs: ["competency-evidence-episode-001"],
    },
    recentChallengeHistory: [
      {
        challengeAssignmentRef: "challenge-assignment-xunpu-000",
        challengeLevel: 4,
        assessmentDecisionRef: "assessment-decision-xunpu-000",
        completedAt: "2026-08-25T08:00:00.000Z",
      },
    ],
    nextCompetencyTargetRefs: ["competency-source-verification"],
    evidenceRefs: ["competency-evidence-episode-001"],
    confidence: 0.76,
    immutablePersonalityLabel: null,
    sensitiveAttributesExcluded: true,
    appeal: {
      status: "none",
      appealRef: null,
      requestedAt: null,
      resolvedAt: null,
    },
    updatedAt: "2026-08-26T02:18:08.000Z",
  };
}

export function learnerSimulationForecastFixture(): LearnerSimulationForecast {
  return {
    schemaVersion: LearnerSimulationForecastSchemaVersion,
    forecastId: "learner-forecast-xunpu-001",
    learnerTwinRef: "learner-twin-xunpu-001",
    learnerTwinRevision: 3,
    learnerTwinContentHash: hashE,
    simulationReleaseRef: v3SimulationReleaseRef,
    forecastModelVersion: "learner-proxy-agent/1.0.0",
    forecastModelContentHash: hashE,
    candidates: [
      {
        candidateId: "forecast-candidate-level-5",
        challengeLevel: 5,
        worldVariantRef: "world-variant-xunpu-level-5",
        predictedActions: [
          { actionKind: "ask", probability: 0.42 },
          { actionKind: "inspect", probability: 0.31 },
          { actionKind: "draft", probability: 0.18 },
        ],
        predictedSuccessProbability: 0.69,
        predictedOverloadProbability: 0.21,
        predictedGrowthValue: 0.83,
        rationale: "5 级压力能暴露关系优先与证据核验之间的真实权衡。",
      },
    ],
    uncertainty: {
      epistemic: 0.28,
      behavioral: 0.34,
      dataSufficiency: "medium",
    },
    evidenceEligible: false,
    canActForStudent: false,
    canScoreStudent: false,
    calibration: {
      status: "pending",
      actualStudentActionRefs: [],
      predictionError: null,
      evaluatedAt: null,
    },
    generatedAt: "2026-08-26T01:59:00.000Z",
  };
}

export function challengeAssignmentFixture(): ChallengeAssignment {
  return {
    schemaVersion: ChallengeAssignmentSchemaVersion,
    challengeAssignmentId: "challenge-assignment-xunpu-001",
    learnerTwinRef: "learner-twin-xunpu-001",
    sessionId: "session-xunpu-001",
    simulationReleaseRef: v3SimulationReleaseRef,
    worldVariantRef: "world-variant-xunpu-level-5",
    previousChallengeLevel: 4,
    challengeLevel: 5,
    scoreCeiling: 90,
    pressureDimensions: [
      { dimensionId: "time", intensity: 5 },
      { dimensionId: "source_access", intensity: 5 },
      { dimensionId: "relationship_conflict", intensity: 4 },
      { dimensionId: "editorial_pressure", intensity: 5 },
    ],
    assignmentReason: "evidence_progression",
    basisEvidenceRefs: ["competency-evidence-episode-previous-001"],
    forecastRef: "learner-forecast-xunpu-001",
    teacherOverride: null,
    policyVersion: "challenge-policy/1.0.0",
    policyContentHash: hashF,
    assignedAt: "2026-08-26T01:59:30.000Z",
  };
}

export function personalizedLearningPlanFixture(): PersonalizedLearningPlan {
  return {
    schemaVersion: PersonalizedLearningPlanSchemaVersion,
    learningPlanId: "learning-plan-xunpu-001",
    learnerTwinRef: "learner-twin-xunpu-001",
    sourceAssessmentDecisionRef: "assessment-decision-xunpu-001",
    sourceChallengeAssignmentRef: "challenge-assignment-xunpu-001",
    status: "proposed",
    targetCompetencies: [
      {
        competencyClaimId: "competency-source-verification",
        currentLevel: 2,
        targetLevel: 3,
        evidenceRefs: ["competency-evidence-episode-001"],
        practiceIntent: "在下一轮冲突中主动寻找第二信源，而非直接采信关系友好的对象。",
        successEvidence: "形成两项独立来源及一次针对矛盾事实的追问记录。",
      },
    ],
    recommendedChallengeLevel: 5,
    recommendedWorldVariantRefs: ["world-variant-xunpu-level-5-source-conflict"],
    scaffoldingActions: [
      {
        actionId: "scaffold-source-triangle",
        title: "三角信源提示",
        triggerCondition: "连续两次仅引用同一主体信息时出现。",
        fadeCondition: "学生主动完成一次独立来源交叉核验后隐藏。",
      },
    ],
    learnerChoiceRefs: [],
    teacherConfirmation: null,
    reviewDueAt: "2026-09-02T02:00:00.000Z",
    createdAt: "2026-08-26T02:18:09.000Z",
    updatedAt: "2026-08-26T02:18:09.000Z",
  };
}

const teacherEpisodeCore = {
  schemaVersion: AgentCollaborationEpisodeV3SchemaVersion,
  episodeId: "collaboration-episode-v3-001",
  sessionId: "session-xunpu-001",
  scenarioId: "scenario-xunpu-open-world",
  courseReleaseRef: v3CourseReleaseRef,
  simulationReleaseRef: v3SimulationReleaseRef,
  sourceWorldStateVersion: 7,
  status: "completed" as const,
  triggerEvent: {
    eventId: "world-event-001",
    eventType: "student_asks_gatekeeper",
    title: "学生向门卫说明采访目的",
    occurredAt: "2026-08-26T02:17:30.000Z",
    sourceKind: "student_action" as const,
    affectedObjectRefs: ["entity-gatekeeper-lin", "community_trust"],
    evidenceRefs: ["work-action-xunpu-001"],
  },
  dispatchPlan: {
    dispatchPlanId: "dispatch-plan-007",
    decisions: [
      {
        agentId: "agent-gatekeeper-lin",
        agentTemplateId: "agent-template-gatekeeper",
        professionalRoleId: "community_gatekeeper",
        decision: "selected" as const,
        reasonCode: "affected_object_match" as const,
        reason: "门卫是当前学生提问直接影响的世界对象。",
      },
      {
        agentId: "agent-responsible-editor",
        agentTemplateId: "agent-template-editor",
        professionalRoleId: "responsible_editor",
        decision: "skipped" as const,
        reasonCode: "not_affected" as const,
        reason: "本轮仅涉及社区准入，尚未形成编辑决策。",
      },
    ],
    selectedCount: 1,
    skippedCount: 1,
  },
  contributions: [
    {
      contributionId: "contribution-gatekeeper-007",
      agentId: "agent-gatekeeper-lin",
      professionalRoleId: "community_gatekeeper",
      agentTaskId: "agent-task-gatekeeper-007",
      agentRunId: "agent-run-gatekeeper-007",
      observationId: "observation-gatekeeper-007",
      intentId: "intent-gatekeeper-007",
      outputHash: hashB,
      summary: "门卫愿意在不拍摄居民私人空间的条件下放行。",
      rationale: "学生身份、目的和边界表达完整，社区信任上升。",
      evidenceRefs: ["work-action-xunpu-001"],
      riskLevel: "low" as const,
      status: "ready" as const,
    },
  ],
  studentDecision: {
    decisionRef: "student-decision-001",
    decision: "accept" as const,
    rationale: "接受不拍摄私人空间的条件，先完成非侵扰式采访。",
    decidedAt: "2026-08-26T02:18:04.000Z",
  },
  teacherGate: {
    gateId: "gate-access-low-risk",
    status: "not_required" as const,
    teacherDecisionRef: null,
    safeSummary: "低风险准入交流无需教师门。",
    reviewedAt: null,
  },
  resolutionProposalId: "resolution-proposal-007",
  consequence: {
    resolutionId: "resolution-gatekeeper-007",
    status: "committed" as const,
    publicSummary: "林师傅侧身让开，并提醒记者不要堵住巷口。",
    worldEventIds: ["world-event-gatekeeper-access-001"],
    evidenceIds: ["evidence-professional-introduction-001"],
    resultingStateVersion: 8,
  },
  failureCode: null,
  generatedAt: "2026-08-26T02:18:06.000Z",
};

export function teacherCollaborationEpisodeV3Fixture(): TeacherAgentCollaborationEpisodeV3 {
  return {
    ...teacherEpisodeCore,
    audience: "teacher",
  };
}

export function adminCollaborationEpisodeV3Fixture(): AdminAgentCollaborationEpisodeV3 {
  return {
    ...teacherEpisodeCore,
    audience: "admin",
    execution: {
      executionMode: "deterministic_demo",
      providerId: null,
      modelId: null,
      traceRefs: ["trace-agent-run-gatekeeper-007"],
      promptTemplateRefs: ["prompt-template-gatekeeper-v1"],
      failedAgentIds: [],
      totalLatencyMs: 42,
      estimatedCostMicrounits: 0,
      recoveryActions: [],
    },
  };
}

export function studentCollaborationEpisodeV3Fixture(): StudentAgentCollaborationEpisodeV3 {
  return {
    schemaVersion: AgentCollaborationEpisodeV3SchemaVersion,
    episodeId: "collaboration-episode-v3-001",
    sessionId: "session-xunpu-001",
    scenarioId: "scenario-xunpu-open-world",
    courseReleaseRef: v3CourseReleaseRef,
    simulationReleaseRef: v3SimulationReleaseRef,
    sourceWorldStateVersion: 7,
    audience: "student",
    status: "completed",
    triggerEvent: {
      eventId: "world-event-001",
      eventType: "student_asks_gatekeeper",
      title: "你向门卫说明采访目的",
      occurredAt: "2026-08-26T02:17:30.000Z",
      sourceKind: "student_action",
    },
    suggestion: {
      suggestionId: "suggestion-gatekeeper-001",
      sourceContributionId: "contribution-gatekeeper-007",
      provenanceVerified: true,
      professionalRole: "现场沟通教练",
      displayName: "沟通建议",
      summary: "可以接受不拍摄私人空间的条件，并确认巷口通行边界。",
      rationale: "这能同时保护居民权益并建立可持续采访关系。",
      evidenceRefs: ["work-action-xunpu-001"],
      riskLevel: "low",
      allowedDecisions: ["accept", "request_evidence", "reject"],
    },
    studentDecision: {
      decisionRef: "student-decision-001",
      decision: "accept",
      rationale: "接受条件并继续采访。",
      decidedAt: "2026-08-26T02:18:04.000Z",
    },
    teacherGate: {
      gateId: "gate-access-low-risk",
      status: "not_required",
      teacherDecisionRef: null,
      safeSummary: "本轮无需教师审批。",
      reviewedAt: null,
    },
    consequence: {
      resolutionId: "resolution-gatekeeper-007",
      status: "committed",
      publicSummary: "林师傅让开通道，你可以进入巷口继续采访。",
      worldEventIds: ["world-event-gatekeeper-access-001"],
      evidenceIds: ["evidence-professional-introduction-001"],
      resultingStateVersion: 8,
    },
    failure: null,
    generatedAt: "2026-08-26T02:18:06.000Z",
  };
}

export function v3SimulationContractBundleFixture(): V3SimulationContractBundle {
  return {
    simulationRelease: worldSimulationReleaseFixture(),
    worldSnapshot: worldSnapshotFixture(),
    agentState: agentStateFixture(),
    agentObservation: agentObservationFixture(),
    agentIntent: simulationAgentIntentFixture(),
    resolution: simulationResolutionFixture(),
    studentWorkAction: studentWorkActionFixture(),
    competencyEvidenceEpisode: competencyEvidenceEpisodeFixture(),
    assessmentDecision: assessmentDecisionFixture(),
    learnerTwinProfile: learnerTwinProfileFixture(),
    learnerSimulationForecast: learnerSimulationForecastFixture(),
    challengeAssignment: challengeAssignmentFixture(),
    personalizedLearningPlan: personalizedLearningPlanFixture(),
    collaborationEpisode: teacherCollaborationEpisodeV3Fixture(),
  };
}
