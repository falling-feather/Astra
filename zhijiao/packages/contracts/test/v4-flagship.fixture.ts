import type {
  AdminGroundedBusinessMoveV4,
  AdminGroundedCollaborationEpisodeV4,
  AutonomousWorldDecisionV4,
  BlindEvidenceAssessmentInputV4,
  EvidenceAssessmentDecisionV4,
  FlagshipContentReferenceV4,
  MediaWorkRevisionV4,
  SecondSessionHandoffV4,
  SemanticActionDecisionV4,
  SemanticActionRequestV4,
  StudentGroundedCollaborationEpisodeV4,
  TeacherGroundedBusinessMoveV4,
  TeacherGroundedCollaborationEpisodeV4,
  V4FlagshipContractBundle,
} from "../src/index.js";
import {
  AutonomousWorldDecisionV4SchemaVersion,
  BlindEvidenceAssessmentInputV4SchemaVersion,
  EvidenceAssessmentDecisionV4SchemaVersion,
  FlagshipContentReferenceV4SchemaVersion,
  GroundedAgentCollaborationEpisodeV4SchemaVersion,
  MediaWorkRevisionV4SchemaVersion,
  SecondSessionHandoffV4SchemaVersion,
  SemanticActionDecisionV4SchemaVersion,
  SemanticActionRequestV4SchemaVersion,
  V4FlagshipContractBundleSchemaVersion,
} from "../src/index.js";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const hashC = "c".repeat(64);
const hashD = "d".repeat(64);
const hashE = "e".repeat(64);
const hashF = "f".repeat(64);

export function flagshipContentReferenceV4Fixture(): FlagshipContentReferenceV4 {
  return {
    schemaVersion: FlagshipContentReferenceV4SchemaVersion,
    contentSchemaVersion: "xunpu-flagship-content/4.0.0",
    courseReleaseRef: {
      courseId: "course-xunpu-intangible-media",
      releaseId: "course-xunpu-r4",
      version: 4,
      contentHash: hashA,
    },
    scenarioReleaseRef: {
      scenarioId: "scenario-xunpu-living-world",
      version: "4.0.0",
      contentHash: hashB,
    },
    simulationReleaseRef: {
      simulationId: "simulation-xunpu-living-world",
      releaseId: "simulation-xunpu-r4",
      version: 4,
      contentHash: hashC,
    },
    contentHash: hashD,
  };
}

export function semanticActionRequestV4Fixture(): SemanticActionRequestV4 {
  return {
    schemaVersion: SemanticActionRequestV4SchemaVersion,
    requestId: "semantic-request-001",
    sessionId: "session-xunpu-v4-001",
    bindingId: "binding-student-001",
    actionWindowRef: "action-window-001",
    actionWindowHash: hashE,
    expectedWorldStateVersion: 7,
    utterance: "我先向阿环说明报道用途，再询问哪些劳动过程可以公开引用。",
    selections: [{
      selectionToken: "selection_token_community_0001",
      displayKind: "npc",
    }],
    submittedAt: "2026-08-28T04:00:00.000Z",
  };
}

function semanticDecisionShared() {
  return {
    schemaVersion: SemanticActionDecisionV4SchemaVersion,
    decisionId: "semantic-decision-001",
    requestId: "semantic-request-001",
    sessionId: "session-xunpu-v4-001",
    bindingId: "binding-student-001",
    flagshipContentRef: flagshipContentReferenceV4Fixture(),
    sourceWorldStateVersion: 7,
    requestPayloadHash: hashF,
    parserMode: "deterministic_fallback" as const,
    confidence: 0.94,
    decidedAt: "2026-08-28T04:00:01.000Z",
  };
}

export function acceptedSemanticActionDecisionV4Fixture(): SemanticActionDecisionV4 {
  return {
    ...semanticDecisionShared(),
    status: "accepted",
    canonicalAction: {
      actionId: "student-action-001",
      verb: "ask",
      targetRefs: [{
        objectType: "entity",
        objectId: "entity-community-source",
        sourceSelectionTokenHash: hashA,
      }],
      materialRefs: [],
      intentSummary: "说明采访用途并询问可公开的劳动过程。",
      professionalCriteriaRefs: [
        "criterion-interview-consent",
        "criterion-editorial-judgment",
      ],
      riskRefs: [],
      requiresTeacherGate: false,
      authorizationCheck: "service_verified",
      authority: "proposal_only",
    },
    clarification: null,
    refusal: null,
    writeDisposition: "candidate_only",
  };
}

export function clarificationSemanticActionDecisionV4Fixture(): SemanticActionDecisionV4 {
  return {
    ...semanticDecisionShared(),
    status: "clarification_required",
    canonicalAction: null,
    clarification: {
      prompt: "你想询问阿环，还是想核对研究者提供的公开资料？",
      ambiguityCode: "multiple_targets",
      choices: [
        {
          choiceToken: "clarification_choice_community_0001",
          label: "询问阿环",
          consequenceHint: "获得个人经历，但不能代表整个社区。",
        },
        {
          choiceToken: "clarification_choice_research_0002",
          label: "核对公开资料",
          consequenceHint: "进入来源层级和定位核验。",
        },
      ],
      expiresAt: "2026-08-28T04:05:00.000Z",
    },
    refusal: null,
    writeDisposition: "zero_write",
  };
}

export function refusedSemanticActionDecisionV4Fixture(): SemanticActionDecisionV4 {
  return {
    ...semanticDecisionShared(),
    confidence: 1,
    status: "refused",
    canonicalAction: null,
    clarification: null,
    refusal: {
      reasonCode: "forged_authority",
      safeMessage: "不能伪造官方回执或把未核验消息写成主管部门通知。",
      recoveryHint: "请联系公共信息联络员，或将该信息标为待核线索。",
    },
    writeDisposition: "zero_write",
  };
}

function autonomyShared() {
  return {
    schemaVersion: AutonomousWorldDecisionV4SchemaVersion,
    autonomyDecisionId: "autonomy-decision-001",
    sessionId: "session-xunpu-v4-001",
    flagshipContentRef: flagshipContentReferenceV4Fixture(),
    sourceWorldStateVersion: 7,
    virtualMinute: 18,
    trigger: {
      triggerKind: "npc_plan" as const,
      triggerRef: "merchant-plan-offer",
      observedStateHash: hashE,
    },
    evaluatedPlanRefs: [
      "merchant-plan-offer",
      "editor-plan-angle-check",
      "community-plan-framing",
    ],
    evaluatedAt: "2026-08-28T04:02:00.000Z",
  };
}

export function scheduledAutonomousWorldDecisionV4Fixture(): AutonomousWorldDecisionV4 {
  return {
    ...autonomyShared(),
    status: "scheduled",
    selectedPlanRef: "merchant-plan-offer",
    candidateEvent: {
      candidateEventId: "candidate-event-merchant-offer-001",
      eventTemplateRef: "event-template-material-exchange",
      actorEntityRef: "entity-shopkeeper",
      affectedObjectRefs: [
        "entity-shopkeeper",
        "variable-editorial-independence",
      ],
      publicCue: "吴姐主动提出提供一组高吸引样片，但希望标题突出门店。",
      earliestVirtualMinute: 18,
      expiresVirtualMinute: 25,
      authority: "proposal_only",
    },
    suppression: null,
    failure: null,
    writeDisposition: "candidate_only",
  };
}

export function suppressedAutonomousWorldDecisionV4Fixture(): AutonomousWorldDecisionV4 {
  return {
    ...autonomyShared(),
    status: "suppressed",
    selectedPlanRef: null,
    candidateEvent: null,
    suppression: {
      reasonCode: "conflict_budget_exhausted",
      safeReason: "当前压力等级只允许一个并发冲突，保留至下一响应窗口。",
    },
    failure: null,
    writeDisposition: "zero_write",
  };
}

const selectedAgents = [
  ["agent-template-editor", "role-responsible-editor"],
  ["agent-template-fact-checker", "role-fact-checker"],
  ["agent-template-rights", "role-rights-governance"],
  ["agent-template-media", "role-media-producer"],
  ["agent-template-teaching", "role-teaching-director"],
] as const;

const skippedAgents = [
  ["agent-template-scene-director", "role-scene-director"],
  ["agent-template-community", "role-community-source"],
  ["agent-template-researcher", "role-heritage-researcher"],
  ["agent-template-platform", "role-platform-duty"],
  ["agent-template-assessor", "role-assessor"],
  ["agent-template-learner", "role-learning-curator"],
  ["agent-template-governance", "role-governance"],
  ["agent-template-operations", "role-operations"],
  ["agent-template-student-proxy", "role-learner-proxy"],
] as const;

function dispatchDecisions() {
  return [
    ...selectedAgents.map(([agentTemplateRef, professionalRoleId], index) => ({
      agentTemplateRef,
      professionalRoleId,
      decision: "selected" as const,
      reasonCode: index === 0
        ? "affected_object_match" as const
        : "claim_domain_match" as const,
      businessReason: "该角色直接影响当前来源、权利、媒体或教学取舍。",
    })),
    ...skippedAgents.map(([agentTemplateRef, professionalRoleId]) => ({
      agentTemplateRef,
      professionalRoleId,
      decision: "skipped" as const,
      reasonCode: "not_affected" as const,
      businessReason: "当前事件不改变该角色负责的对象或主张。",
    })),
  ];
}

const moveRows = [
  ["move-proposal-001", "proposal", "agent-template-editor", "role-responsible-editor"],
  ["move-challenge-001", "challenge", "agent-template-fact-checker", "role-fact-checker"],
  ["move-evidence-001", "evidence_request", "agent-template-rights", "role-rights-governance"],
  ["move-revision-001", "revision", "agent-template-media", "role-media-producer"],
  ["move-joint-001", "joint_proposal", "agent-template-teaching", "role-teaching-director"],
] as const;

function teacherMoves(): TeacherGroundedBusinessMoveV4[] {
  return moveRows.map(([moveId, moveKind, agentTemplateRef, professionalRoleId], index) => ({
    moveId,
    moveKind,
    agentTemplateRef,
    professionalRoleId,
    safeSummary: [
      "先用社区劳动角度组织报道。",
      "质疑单一受访者是否足以支持文化主张。",
      "要求补充来源定位与人物授权回执。",
      "改为宽景和手部素材，并限定个人引语。",
      "形成兼顾事实、同意与媒体表达的联合方案。",
    ][index]!,
    rationale: "该动作基于公开来源和当前作品证据，不读取学生身份或 NPC 私有记忆。",
    groundedClaimRefs: ["claim-community-practice-boundary"],
    knowledgeCitations: [{
      knowledgeRef: "xunpu-k016-interview-consent-and-custom",
      sourceTitle: "中华人民共和国民法典",
      sourceUrl: "https://wb.flk.npc.gov.cn/flfg/PDF/bd53dd912c1048f2aecbaa229238334b.pdf",
      locator: "第一千零一十八条至第一千零二十条",
      sourceContentHash: hashA,
      reviewStatus: "verified",
      supportsClaimRefs: ["claim-community-practice-boundary"],
      stance: "supports",
    }],
    evidenceRefs: ["evidence-community-interview-001"],
    predecessorMoveRefs: moveRows.slice(0, index).map(([reference]) => reference),
    outputHash: [hashA, hashB, hashC, hashD, hashE][index]!,
  }));
}

function adminMoves(): AdminGroundedBusinessMoveV4[] {
  return teacherMoves().map((move, index) => ({
    ...move,
    execution: {
      agentTaskRef: `agent-task-00${index + 1}`,
      agentRunRef: `agent-run-00${index + 1}`,
      observationRef: `observation-00${index + 1}`,
      intentRef: `intent-00${index + 1}`,
      executionMode: "deterministic_demo",
      providerId: null,
      modelId: null,
      promptTemplateRef: `prompt-template-00${index + 1}`,
      traceRef: `trace-00${index + 1}`,
      latencyMs: 18 + index,
      estimatedCostMicros: 0,
    },
  }));
}

function jointProposal() {
  return {
    jointProposalId: "joint-proposal-001",
    sourceMoveRefs: moveRows.map(([moveId]) => moveId),
    publicSummary: "先确认受访者引语范围，以宽景和手部素材替代未获公开许可的近景，再提交双来源事实说明。",
    recommendedActionRefs: ["action-confirm-quote", "action-replace-closeup"],
    groundedClaimRefs: ["claim-community-practice-boundary"],
    evidenceRefs: ["evidence-community-interview-001", "evidence-rights-ledger-001"],
    riskLevel: "medium" as const,
    requiresTeacherGate: false,
    authority: "proposal_only" as const,
    contentHash: hashF,
  };
}

function collaborationShared() {
  return {
    schemaVersion: GroundedAgentCollaborationEpisodeV4SchemaVersion,
    episodeId: "collaboration-episode-001",
    sessionId: "session-xunpu-v4-001",
    flagshipContentRef: flagshipContentReferenceV4Fixture(),
    sourceWorldStateVersion: 7,
    triggerEventRef: "event-student-action-001",
    affectedObjectRefs: ["entity-community-source", "artifact-interview-notes"],
    generatedAt: "2026-08-28T04:03:00.000Z",
  };
}

export function teacherGroundedCollaborationEpisodeV4Fixture(): TeacherGroundedCollaborationEpisodeV4 {
  return {
    ...collaborationShared(),
    audience: "teacher",
    status: "joint_proposal_ready",
    dispatchDecisions: dispatchDecisions(),
    moves: teacherMoves(),
    jointProposal: jointProposal(),
    failure: null,
    writeDisposition: "proposal_only",
  };
}

export function adminGroundedCollaborationEpisodeV4Fixture(): AdminGroundedCollaborationEpisodeV4 {
  return {
    ...collaborationShared(),
    audience: "admin",
    status: "joint_proposal_ready",
    dispatchDecisions: dispatchDecisions(),
    moves: adminMoves(),
    jointProposal: jointProposal(),
    failure: null,
    writeDisposition: "proposal_only",
    executionSummary: {
      executionMode: "deterministic_demo",
      selectedCount: 5,
      skippedCount: 9,
      totalLatencyMs: 100,
      totalEstimatedCostMicros: 0,
    },
  };
}

export function studentGroundedCollaborationEpisodeV4Fixture(): StudentGroundedCollaborationEpisodeV4 {
  return {
    ...collaborationShared(),
    audience: "student",
    status: "suggestion_ready",
    suggestion: {
      suggestionId: "suggestion-001",
      sourceJointProposalRef: "joint-proposal-001",
      professionalRole: "责任编辑协作建议",
      summary: "先确认引语范围，并用宽景或手部素材替代未获公开许可的近景。",
      rationale: "这样能同时保留采访价值、人物同意和发布时效。",
      knowledgeCitations: teacherMoves()[0]!.knowledgeCitations,
      recommendedActionRefs: ["action-confirm-quote", "action-replace-closeup"],
      riskLevel: "medium",
      allowedDecisions: ["accept", "request_evidence", "reject"],
    },
    studentDecision: null,
    worldConsequenceRef: null,
    failure: null,
  };
}

export function mediaWorkRevisionV4Fixture(): MediaWorkRevisionV4 {
  const disclosure = {
    explicitLabel: true as const,
    implicitMetadata: true as const,
    disclosureText: "AI 生成或辅助的教学仿真素材，不作为公共事实证据。",
  };
  return {
    schemaVersion: MediaWorkRevisionV4SchemaVersion,
    mediaRevisionId: "media-revision-002",
    sessionId: "session-xunpu-v4-001",
    bindingId: "binding-student-001",
    flagshipContentRef: flagshipContentReferenceV4Fixture(),
    artifactRef: "artifact-multiplatform-package",
    revisionNumber: 2,
    parentRevisionRef: "media-revision-001",
    status: "submitted",
    sourceAssets: [
      {
        assetRef: "source-photo-hands-work-01",
        mediaKind: "image",
        contentHash: hashA,
        rightsReceiptRef: "rights-receipt-image-001",
        rightsStatus: "cleared",
        permittedUse: "simulated_publication",
        personConsentMode: "not_applicable",
        aiDisclosure: disclosure,
      },
      {
        assetRef: "audio-ahuan-interview-01",
        mediaKind: "audio",
        contentHash: hashB,
        rightsReceiptRef: "rights-receipt-audio-001",
        rightsStatus: "limited",
        permittedUse: "simulated_publication",
        personConsentMode: "simulated_character",
        aiDisclosure: disclosure,
      },
      {
        assetRef: "video-alley-broll-01",
        mediaKind: "video",
        contentHash: hashC,
        rightsReceiptRef: "rights-receipt-video-001",
        rightsStatus: "cleared",
        permittedUse: "simulated_publication",
        personConsentMode: "not_applicable",
        aiDisclosure: disclosure,
      },
    ],
    transformations: [
      {
        operationId: "media-operation-crop-001",
        operationKind: "crop",
        inputAssetRef: "source-photo-hands-work-01",
        outputAssetRef: "derived-image-001",
        operatorKind: "student",
        rationale: "保留手部动作，移除无关背景。",
        region: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
      },
      {
        operationId: "media-operation-audio-trim-001",
        operationKind: "trim",
        inputAssetRef: "audio-ahuan-interview-01",
        outputAssetRef: "derived-audio-001",
        operatorKind: "student",
        rationale: "只保留已经确认范围的个人经验引语。",
        startMs: 1_000,
        endMs: 14_000,
      },
      {
        operationId: "media-operation-video-trim-001",
        operationKind: "trim",
        inputAssetRef: "video-alley-broll-01",
        outputAssetRef: "derived-video-001",
        operatorKind: "student",
        rationale: "保留公共空间宽景，避免私人门牌。",
        startMs: 0,
        endMs: 6_000,
      },
    ],
    derivedAssets: [
      {
        assetRef: "derived-image-001",
        parentAssetRefs: ["source-photo-hands-work-01"],
        mediaKind: "image",
        mimeType: "image/png",
        contentHash: hashD,
        byteLength: 900_000,
        width: 1280,
        height: 720,
        durationMs: null,
        aiDisclosure: disclosure,
        createdAt: "2026-08-28T04:05:00.000Z",
      },
      {
        assetRef: "derived-audio-001",
        parentAssetRefs: ["audio-ahuan-interview-01"],
        mediaKind: "audio",
        mimeType: "audio/wav",
        contentHash: hashE,
        byteLength: 800_000,
        width: null,
        height: null,
        durationMs: 13_000,
        aiDisclosure: disclosure,
        createdAt: "2026-08-28T04:05:01.000Z",
      },
      {
        assetRef: "derived-video-001",
        parentAssetRefs: ["video-alley-broll-01"],
        mediaKind: "video",
        mimeType: "video/mp4",
        contentHash: hashF,
        byteLength: 700_000,
        width: 720,
        height: 1280,
        durationMs: 6_000,
        aiDisclosure: disclosure,
        createdAt: "2026-08-28T04:05:02.000Z",
      },
    ],
    rightsLedgerRefs: [
      "rights-receipt-image-001",
      "rights-receipt-audio-001",
      "rights-receipt-video-001",
    ],
    supportingEvidenceRefs: [
      "evidence-rights-ledger-001",
      "evidence-community-interview-001",
    ],
    studentEditorialRationale: "用劳动过程和公共空间组成多平台素材，舍弃无法确认公开范围的人物近景。",
    contentHash: hashF,
    createdAt: "2026-08-28T04:06:00.000Z",
  };
}

const criterionIds = [
  "criterion-fact-verification",
  "criterion-interview-consent",
  "criterion-editorial-judgment",
  "criterion-rights-governance",
  "criterion-multiplatform-production",
  "criterion-recovery-transfer",
] as const;

export function blindEvidenceAssessmentInputV4Fixture(): BlindEvidenceAssessmentInputV4 {
  return {
    schemaVersion: BlindEvidenceAssessmentInputV4SchemaVersion,
    blindCaseId: "blind-case-001",
    flagshipContentHash: hashD,
    rubricVersion: "xunpu-rubric-v4",
    rubricContentHash: hashE,
    rubricReviewStatus: "verified",
    artifactRevisions: [{
      artifactRef: "artifact-multiplatform-package",
      revisionRef: "media-revision-002",
      contentHash: hashF,
    }],
    claimEvidenceLinks: [{
      claimRef: "claim-community-practice-boundary",
      evidenceRefs: ["evidence-community-interview-001", "evidence-source-001"],
      supportStatus: "supported",
      sourceCount: 2,
    }],
    behaviorEvidenceRefs: criterionIds.map((_, index) => `evidence-criterion-00${index + 1}`),
    worldConsequenceRefs: ["world-consequence-trust-increase-001"],
    scaffoldingEpisodeRefs: ["suggestion-decision-rejected-001"],
    recoveryPairRefs: ["recovery-pair-consent-001"],
    surfaceSignals: {
      textLength: 680,
      keywordMatchCount: 18,
      completionClickCount: 12,
      endingKind: "ending-trusted-collaboration",
      allowedForScoring: false,
    },
    excludedContextFields: [
      "student_identity",
      "binding_id",
      "challenge_level",
      "agent_advice",
      "provider_and_model",
      "prompt_and_trace",
    ],
    inputHash: hashA,
    generatedAt: "2026-08-28T04:10:00.000Z",
  };
}

export function evidenceAssessmentDecisionV4Fixture(): EvidenceAssessmentDecisionV4 {
  const evidenceRefs = criterionIds.map((_, index) => `evidence-criterion-00${index + 1}`);
  return {
    schemaVersion: EvidenceAssessmentDecisionV4SchemaVersion,
    assessmentDecisionId: "assessment-decision-v4-001",
    blindCaseRef: "blind-case-001",
    blindInputHash: hashA,
    status: "final",
    assessorMode: "deterministic_fallback",
    rubricReviewStatus: "verified",
    criterionAssessments: criterionIds.map((criterionId, index) => ({
      criterionId,
      evidenceStatus: "supported",
      band: "high",
      score: 88 + index,
      confidence: 0.86,
      evidenceRefs: [evidenceRefs[index]!],
      rationale: "判断只来自去身份作品、真实行动、证据关系与世界后果。",
      surfaceSignalsUsed: false,
    })),
    sessionScore: 90,
    evidenceRefs,
    adviceAgentExcluded: true,
    challengeAppliedAfterBlindAssessment: true,
    challengeAdjustmentRef: "challenge-adjustment-001",
    teacherReview: {
      status: "confirmed",
      teacherDecisionRef: "teacher-assessment-decision-001",
      rationale: "逐维核对证据后确认，不以篇幅和终局代替能力。",
      reviewedAt: "2026-08-28T04:12:00.000Z",
    },
    generatedAt: "2026-08-28T04:11:00.000Z",
  };
}

export function secondSessionHandoffV4Fixture(): SecondSessionHandoffV4 {
  return {
    schemaVersion: SecondSessionHandoffV4SchemaVersion,
    handoffId: "second-session-handoff-001",
    learnerSubjectHash: hashB,
    learnerTwinRef: "learner-twin-001",
    learnerTwinContentHash: hashC,
    sourceSessionId: "session-xunpu-v4-001",
    sourceAssessmentDecisionRef: "assessment-decision-v4-001",
    flagshipContentRef: flagshipContentReferenceV4Fixture(),
    createdAt: "2026-08-28T04:15:00.000Z",
    status: "provisioned",
    reasonCode: null,
    proposal: {
      variantRef: "variant-xunpu-consent-negotiation",
      sourceChallengeLevel: 4,
      targetChallengeLevel: 5,
      changedMechanics: [
        {
          mechanicKind: "npc_resistance",
          beforeHash: hashA,
          afterHash: hashB,
          safeSummary: "两名人物采用不同授权范围并在不同时间回应。",
        },
        {
          mechanicKind: "evidence_availability",
          beforeHash: hashC,
          afterHash: hashD,
          safeSummary: "先收到撤回，再开放可替换素材回执。",
        },
      ],
      growthTargetRefs: ["criterion-interview-consent"],
      forecastRef: "learner-forecast-001",
      learnerConsentRequired: true,
    },
    teacherAuthorizationRef: "teacher-second-session-auth-001",
    provision: {
      learnerSubjectHash: hashB,
      membershipRef: "membership-second-001",
      bindingRef: "binding-second-001",
      courseReleaseRef: flagshipContentReferenceV4Fixture().courseReleaseRef,
      scenarioReleaseRef: flagshipContentReferenceV4Fixture().scenarioReleaseRef,
      simulationReleaseRef: flagshipContentReferenceV4Fixture().simulationReleaseRef,
      sessionRef: "session-xunpu-v4-002",
      challengeAssignmentRef: "challenge-assignment-second-001",
      provisionedAt: "2026-08-28T04:16:00.000Z",
    },
    calibration: null,
    failure: null,
    writeDisposition: "committed",
  };
}

export function v4FlagshipContractBundleFixture(): V4FlagshipContractBundle {
  return {
    schemaVersion: V4FlagshipContractBundleSchemaVersion,
    flagshipContentRef: flagshipContentReferenceV4Fixture(),
    semanticActionRequest: semanticActionRequestV4Fixture(),
    semanticActionDecision: acceptedSemanticActionDecisionV4Fixture(),
    autonomousWorldDecision: scheduledAutonomousWorldDecisionV4Fixture(),
    studentCollaborationEpisode: studentGroundedCollaborationEpisodeV4Fixture(),
    teacherCollaborationEpisode: teacherGroundedCollaborationEpisodeV4Fixture(),
    adminCollaborationEpisode: adminGroundedCollaborationEpisodeV4Fixture(),
    mediaWorkRevision: mediaWorkRevisionV4Fixture(),
    blindAssessmentInput: blindEvidenceAssessmentInputV4Fixture(),
    assessmentDecision: evidenceAssessmentDecisionV4Fixture(),
    secondSessionHandoff: secondSessionHandoffV4Fixture(),
  };
}
