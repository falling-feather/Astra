import { describe, expect, it } from "vitest";
import {
  AgentRunTraceSchema,
  type AgentRunTrace,
  type ArtifactRevision,
  type EvaluationDimensionProposal,
  type EvaluationEvaluatorKind,
  type Evidence,
  type ProductionSubmission,
  type RubricCriterion,
  type TeacherAssessmentReview,
  type WorldEvent,
} from "@ronggang/contracts";
import {
  arbitrateEvaluationProposals,
  createEvaluationCase,
  createLearningArtifactRelease,
  createLearningCandidate,
  createLearningCandidateReview,
  createLearningReleaseRollback,
  createRuleEvaluationProposal,
  createSemanticEvaluationProposal,
  createUnavailableEvaluationProposal,
  runLearningCandidateReplay,
} from "../src/index.js";

const now = "2026-07-25T10:00:00.000Z";
const sha = (character: string) => character.repeat(64);
const fixedId = (prefix: string) => `${prefix}-fixture`;

const rubric: RubricCriterion[] = [
  {
    criterionId: "source-check",
    label: "信源核验",
    weight: 0.4,
    rule: "必须形成二次核验证据",
    evaluation: {
      kind: "evidence_action",
      action: "二次核验",
    },
  },
  {
    criterionId: "submitted",
    label: "精确提交",
    weight: 0.3,
    rule: "必须形成成果提交事件",
    evaluation: {
      kind: "event_exists",
      eventType: "submission_created",
    },
  },
  {
    criterionId: "evidence-coverage",
    label: "证据覆盖",
    weight: 0.3,
    rule: "至少引用四条过程证据",
    evaluation: {
      kind: "evidence_count",
      minimum: 4,
    },
  },
];

function evidence(
  evidenceId: string,
  action: string,
  eventRefs: string[] = [],
): Evidence {
  return {
    evidenceId,
    sessionId: "session-evaluation",
    nodeId: "review",
    actorId: "student-editor",
    action,
    basis: `${action}形成固定过程证据`,
    materialRefs: ["material-1"],
    eventRefs,
    observationRefs: [],
    artifactRevisionRefs: ["revision-2"],
    processingTaskRefs: [],
    createdAt: now,
    visibility: ["assigned_team", "audit_only"],
  };
}

const evidenceA = evidence(
  "evidence-a",
  "完成二次核验并确认统计口径",
  ["event-submission"],
);
const evidenceB = evidence("evidence-b", "完成版权边界核验");

const submission: ProductionSubmission = {
  submissionId: "submission-1",
  artifactId: "artifact-1",
  revisionId: "revision-2",
  revisionNumber: 2,
  evidenceRefs: ["evidence-a", "evidence-b"],
  citationIds: ["citation-1"],
  submittedBy: "student-editor",
  requestId: "submit-request-1",
  submittedAt: now,
};

const revision = {
  revisionId: "revision-2",
  artifactId: "artifact-1",
  revisionNumber: 2,
  previousRevisionId: "revision-1",
  title: "地方文旅活动融媒体报道",
  summary: "固定证据和治理结论后的精确修订。",
  sections: [{
    sectionId: "lead",
    label: "导语",
    content: "经核验后的报道正文。",
  }],
  citations: [],
  revisionNote: "提交评价的精确 R2。",
  contentHash: sha("a"),
  authorActorId: "student-editor",
  requestId: "revision-request-2",
  createdAt: now,
  audience: {
    policyVersion: "acl/1.0.0",
    courseId: "course-1",
    sessionId: "session-evaluation",
    sessionEpoch: "epoch-1",
    scopes: ["assigned_team"],
    teamIds: ["team-editorial-01"],
    roleIds: ["responsible_editor"],
    actorIds: ["student-editor"],
    privateNamespaces: [],
    auditReadable: true,
  },
} as ArtifactRevision;

const submissionEvent = {
  eventId: "event-submission",
  eventType: "submission_created",
} as WorldEvent;

function evaluationFixture(
  evidenceItems: Evidence[] = [evidenceA, evidenceB],
) {
  return createEvaluationCase({
    nextId: fixedId,
    now,
    sessionEpoch: "epoch-1",
    openedFromMessageId: "message-submission",
    submission,
    revision,
    rubricId: "rubric-media",
    rubricVersion: "1.0.0",
    rubric,
    evidence: evidenceItems,
    events: [submissionEvent],
    scenarioReleaseId: "scenario-release-1",
    scenarioContentHash: sha("b"),
  });
}

function modelTrace(kind: Exclude<EvaluationEvaluatorKind, "rule">): AgentRunTrace {
  return AgentRunTraceSchema.parse({
    taskId: `task-${kind}`,
    agentRunId: `run-${kind}`,
    correlationId: `correlation-${kind}`,
    agentId: `agent-${kind}`,
    roleId: "assessor",
    definitionVersion: `assessment-${kind}/1.0.0`,
    promptVersion: `assessment-${kind}-prompt/1.0.0`,
    inputStateVersion: 10,
    triggerRefs: ["event-submission"],
    contextManifest: null,
    promptHash: sha(kind === "work_quality" ? "c" : kind === "evidence_sufficiency" ? "d" : "e"),
    status: "completed",
    nodes: [{
      nodeId: "model",
      kind: "model",
      status: "success",
      startedAt: now,
      completedAt: now,
      durationMs: 10,
      selectedEdgeId: null,
      errorCode: null,
    }],
    modelCalls: 1,
    modelInvocations: [{
      invocationId: `invocation-${kind}`,
      profileId: "deepseek-test",
      provider: "deepseek",
      mode: "live",
      model: "deepseek-v4-flash",
      requestId: `provider-request-${kind}`,
      status: "completed",
      outputMode: "json_object",
      finishReason: "stop",
      tokenUsage: { input: 100, output: 40, total: 140 },
      latencyMs: 25,
      attempts: 1,
      estimatedCostUsd: null,
      errorCode: null,
      startedAt: now,
      completedAt: now,
    }],
    toolCalls: 0,
    tokenUsage: { input: 100, output: 40 },
    fallbackUsed: false,
    errorCode: null,
    startedAt: now,
    completedAt: now,
    durationMs: 25,
  });
}

function semanticDimensions(
  factor: number,
  confidence = 0.9,
): EvaluationDimensionProposal[] {
  const { evaluationCase } = evaluationFixture();
  return evaluationCase.dimensions.map((dimension) => ({
    dimensionId: dimension.dimensionId,
    scoreSuggestion: Math.round(dimension.maxScore * factor * 100) / 100,
    maxScore: dimension.maxScore,
    reason: "语义评价仅依据固定证据包形成建议。",
    evidenceRefs: ["evidence-a"],
    confidence,
    riskFlags: [],
  }));
}

function semanticProposal(
  kind: Exclude<EvaluationEvaluatorKind, "rule">,
  factor: number,
  confidence = 0.9,
) {
  const { evaluationCase, evidenceBundle } = evaluationFixture();
  return createSemanticEvaluationProposal({
    nextId: fixedId,
    now,
    evaluationCase,
    evidenceBundle,
    evaluatorKind: kind,
    status: "completed",
    dimensions: semanticDimensions(factor, confidence),
    errorCode: null,
    trace: modelTrace(kind),
  });
}

describe("V0.7 deterministic evaluation", () => {
  it("keeps evidence bundle and case hashes stable when evidence arrives out of order", () => {
    const ordered = evaluationFixture([evidenceA, evidenceB]);
    const reversed = evaluationFixture([evidenceB, evidenceA]);

    expect(ordered.evidenceBundle.evidenceRefs.map((item) => item.evidenceId))
      .toEqual(["evidence-a", "evidence-b"]);
    expect(reversed.evidenceBundle.evidenceRefs)
      .toEqual(ordered.evidenceBundle.evidenceRefs);
    expect(reversed.evidenceBundle.bundleHash)
      .toBe(ordered.evidenceBundle.bundleHash);
    expect(reversed.evaluationCase.caseHash)
      .toBe(ordered.evaluationCase.caseHash);
  });

  it("scores every deterministic rubric kind against the fixed evidence bundle", () => {
    const { evaluationCase, evidenceBundle } = evaluationFixture();
    const proposal = createRuleEvaluationProposal({
      nextId: fixedId,
      now,
      evaluationCase,
      evidenceBundle,
      rubric,
      evidence: [evidenceB, evidenceA],
      events: [submissionEvent],
    });

    expect(proposal.status).toBe("completed");
    expect(proposal.dimensions).toEqual([
      expect.objectContaining({
        dimensionId: "source-check",
        scoreSuggestion: 40,
        maxScore: 40,
        evidenceRefs: ["evidence-a"],
      }),
      expect.objectContaining({
        dimensionId: "submitted",
        scoreSuggestion: 30,
        maxScore: 30,
        evidenceRefs: ["evidence-a"],
      }),
      expect.objectContaining({
        dimensionId: "evidence-coverage",
        scoreSuggestion: 15,
        maxScore: 30,
        evidenceRefs: ["evidence-a", "evidence-b"],
        riskFlags: ["rule_not_fully_satisfied"],
      }),
    ]);
  });

  it("accepts only complete semantic dimensions and evidence from the frozen whitelist", () => {
    const { evaluationCase, evidenceBundle } = evaluationFixture();
    const valid = semanticDimensions(0.8);
    const proposal = createSemanticEvaluationProposal({
      nextId: fixedId,
      now,
      evaluationCase,
      evidenceBundle,
      evaluatorKind: "work_quality",
      status: "completed",
      dimensions: valid.map((dimension) => ({
        ...dimension,
        evidenceRefs: ["evidence-b", "evidence-a", "evidence-a"],
      })),
      errorCode: null,
      trace: modelTrace("work_quality"),
    });
    expect(proposal.dimensions.every(
      (dimension) => dimension.evidenceRefs.join(",") === "evidence-a,evidence-b",
    )).toBe(true);

    expect(() => createSemanticEvaluationProposal({
      nextId: fixedId,
      now,
      evaluationCase,
      evidenceBundle,
      evaluatorKind: "work_quality",
      status: "completed",
      dimensions: valid.slice(1),
      errorCode: null,
      trace: modelTrace("work_quality"),
    })).toThrow("语义评价必须逐一覆盖案件中的全部量规维度");
    expect(() => createSemanticEvaluationProposal({
      nextId: fixedId,
      now,
      evaluationCase,
      evidenceBundle,
      evaluatorKind: "work_quality",
      status: "completed",
      dimensions: valid.map((dimension, index) => (
        index === 0
          ? { ...dimension, evidenceRefs: ["evidence-outside-bundle"] }
          : dimension
      )),
      errorCode: null,
      trace: modelTrace("work_quality"),
    })).toThrow("语义评价引用证据包之外的证据");
    expect(() => createSemanticEvaluationProposal({
      nextId: fixedId,
      now,
      evaluationCase,
      evidenceBundle,
      evaluatorKind: "work_quality",
      status: "completed",
      dimensions: valid.map((dimension, index) => (
        index === 0
          ? { ...dimension, scoreSuggestion: dimension.maxScore + 0.01 }
          : dimension
      )),
      errorCode: null,
      trace: modelTrace("work_quality"),
    })).toThrow("语义评价分数超出维度上限");
  });

  it("keeps unavailable evaluators scoreless and forces a degraded arbitration", () => {
    const { evaluationCase, evidenceBundle } = evaluationFixture();
    const rule = createRuleEvaluationProposal({
      nextId: fixedId,
      now,
      evaluationCase,
      evidenceBundle,
      rubric,
      evidence: [evidenceA, evidenceB],
      events: [submissionEvent],
    });
    const unavailable = createUnavailableEvaluationProposal({
      nextId: fixedId,
      now,
      evaluationCase,
      evidenceBundle,
      evaluatorKind: "work_quality",
      definitionVersion: "assessment-work-quality/1.0.0",
      promptVersion: "assessment-work-quality-prompt/1.0.0",
      errorCode: "model_output_truncated",
    });
    expect(unavailable).toMatchObject({
      status: "unavailable",
      dimensions: [],
      overallConfidence: 0,
      errorCode: "model_output_truncated",
    });
    const arbitration = arbitrateEvaluationProposals({
      nextId: fixedId,
      now,
      evaluationCase,
      proposals: [
        rule,
        unavailable,
        semanticProposal("evidence_sufficiency", 0.85),
        semanticProposal("professional_collaboration", 0.9),
      ],
    });
    expect(arbitration.status).toBe("degraded");
    expect(arbitration.unavailableEvaluatorKinds).toEqual(["work_quality"]);
    expect(arbitration.disputes.filter(
      (dispute) => dispute.code === "evaluator_unavailable",
    )).toHaveLength(rubric.length);
  });

  it("makes arbitration, ordering and disputes stable under proposal reordering", () => {
    const { evaluationCase, evidenceBundle } = evaluationFixture();
    const rule = createRuleEvaluationProposal({
      nextId: fixedId,
      now,
      evaluationCase,
      evidenceBundle,
      rubric,
      evidence: [evidenceA, evidenceB],
      events: [submissionEvent],
    });
    const proposals = [
      rule,
      semanticProposal("evidence_sufficiency", 0.1, 0.5),
      semanticProposal("work_quality", 0.95),
      semanticProposal("professional_collaboration", 0.9),
    ];
    const first = arbitrateEvaluationProposals({
      nextId: fixedId,
      now,
      evaluationCase,
      proposals,
    });
    const second = arbitrateEvaluationProposals({
      nextId: fixedId,
      now,
      evaluationCase,
      proposals: [proposals[3]!, proposals[1]!, proposals[0]!, proposals[2]!],
    });

    expect(first.status).toBe("disputed");
    expect(first.disputes.some(
      (dispute) => dispute.code === "score_spread",
    )).toBe(true);
    expect(first.disputes.some(
      (dispute) => dispute.code === "low_confidence",
    )).toBe(true);
    expect(second.proposalIds).toEqual(first.proposalIds);
    expect(second.proposalSetHash).toBe(first.proposalSetHash);
    expect(second.recommendations).toEqual(first.recommendations);
    expect(second.disputes).toEqual(first.disputes);
    expect(second.decisionHash).toBe(first.decisionHash);
  });
});

const teacherReview: TeacherAssessmentReview = {
  schemaVersion: "evaluation/1.0.0",
  reviewId: "teacher-review-1",
  evaluationCaseId: "evaluation-case-1",
  arbitrationId: "arbitration-1",
  arbitrationRevision: 1,
  decisionHash: sha("7"),
  evidenceBundleHash: sha("8"),
  dimensions: [{
    dimensionId: "quality",
    proposedScore: 85,
    finalScore: 85,
    maxScore: 100,
    delta: 0,
    publicFeedback: "证据充分，作品达到要求。",
    overrideReason: null,
    evidenceRefs: ["evidence-a", "evidence-b"],
  }],
  finalScore: 85,
  publicSummary: "教师已完成精确逐维复核。",
  internalNote: "内部校准记录。",
  reviewedBy: "teacher-main",
  reviewedAt: now,
  requestId: "teacher-review-request-1",
  finalHash: sha("9"),
};

function learningCandidate(
  evidenceRefs: string[] = ["evidence-b", "evidence-a"],
  proposedContent: Record<string, unknown> = {
    finalScore: 85,
    summary: "已审核评分样例",
  },
) {
  return createLearningCandidate({
    nextId: fixedId,
    now,
    title: "地方文旅报道评分样例",
    proposedContent,
    sourceEvidenceRefs: evidenceRefs,
    sourceFinalAssessmentId: teacherReview.reviewId,
    evaluationCaseId: teacherReview.evaluationCaseId,
    courseId: "course-1",
    scenarioId: "scenario-1",
    rubricId: "rubric-media",
    expectedBenefit: "用于同版量规的离线校准。",
    knownRisks: ["不适用于其他量规版本"],
    conflictRefs: [],
    generatedBy: "agent-learning-curator",
    generatorTraceId: "run-learning-1",
  });
}

function replay(candidate = learningCandidate()) {
  return runLearningCandidateReplay({
    nextId: fixedId,
    now,
    candidate,
    finalAssessment: teacherReview,
    allowedEvidenceRefs: ["evidence-a", "evidence-b"],
    scenarioReleaseId: "scenario-release-1",
    scenarioContentHash: sha("a"),
    rubricHash: sha("b"),
    activeReleaseId: null,
  });
}

describe("V0.7 supervised learning governance", () => {
  it("keeps candidate identity immutable and replay deterministic", () => {
    const ordered = learningCandidate(["evidence-a", "evidence-b"]);
    const reversed = learningCandidate(["evidence-b", "evidence-a"]);
    expect(ordered.status).toBe("pending_review");
    expect(reversed.sourceEvidenceRefs).toEqual(["evidence-a", "evidence-b"]);
    expect(reversed.candidateHash).toBe(ordered.candidateHash);

    const first = replay(ordered);
    const second = replay(reversed);
    expect(first.status).toBe("passed");
    expect(first.checks.every((check) => check.status === "passed")).toBe(true);
    expect(second.fixtureHash).toBe(first.fixtureHash);
    expect(second.reportHash).toBe(first.reportHash);
  });

  it("fails replay closed for evidence drift, score drift, and private fields", () => {
    const outsideEvidence = learningCandidate(["evidence-outside"]);
    const evidenceReport = replay(outsideEvidence);
    expect(evidenceReport.status).toBe("failed");
    expect(evidenceReport.checks.find(
      (check) => check.checkId === "source_traceability",
    )?.status).toBe("failed");

    const scoreDrift = replay(learningCandidate(undefined, { finalScore: 50 }));
    expect(scoreDrift.status).toBe("failed");
    expect(scoreDrift.scoreDrift).toBe(35);

    const privateField = replay(learningCandidate(undefined, {
      finalScore: 85,
      internalNote: "teacher-only canary",
    }));
    expect(privateField.status).toBe("failed");
    expect(privateField.privacyViolationCount).toBe(1);
  });

  it("allows rejection but refuses approval and publication after a failed replay", () => {
    const candidate = learningCandidate(undefined, { finalScore: 50 });
    const failedReplay = replay(candidate);
    expect(() => createLearningCandidateReview({
      nextId: fixedId,
      now,
      candidate,
      replayReport: failedReplay,
      decision: "approve",
      reason: "不应批准。",
      reviewedBy: "teacher-main",
      requestId: "candidate-review-approve",
    })).toThrow("离线回放未通过的候选不能批准");

    const rejection = createLearningCandidateReview({
      nextId: fixedId,
      now,
      candidate,
      replayReport: failedReplay,
      decision: "reject",
      reason: "评分漂移超出门槛。",
      reviewedBy: "teacher-main",
      requestId: "candidate-review-reject",
    });
    expect(rejection.decision).toBe("reject");
    expect(candidate.status).toBe("pending_review");
    expect(() => createLearningArtifactRelease({
      nextId: fixedId,
      now,
      artifactKey: "assessment-example:rubric-media",
      courseId: "course-1",
      version: "1.0.0",
      parentReleaseId: null,
      candidate,
      review: rejection,
      replayReport: failedReplay,
      publishedBy: "teacher-main",
      requestId: "publish-rejected",
    })).toThrow("学习候选尚未通过精确回放与人工批准门");
  });

  it("binds approval to the exact candidate and replay report", () => {
    const candidate = learningCandidate();
    const otherCandidate = createLearningCandidate({
      nextId: (prefix) => `${prefix}-other`,
      now,
      title: "另一个评分样例",
      proposedContent: { finalScore: 85, summary: "另一份样例" },
      sourceEvidenceRefs: ["evidence-a"],
      sourceFinalAssessmentId: teacherReview.reviewId,
      evaluationCaseId: teacherReview.evaluationCaseId,
      courseId: "course-1",
      scenarioId: "scenario-1",
      rubricId: "rubric-media",
      expectedBenefit: "另一个测试候选。",
      knownRisks: [],
      conflictRefs: [],
      generatedBy: "agent-learning-curator",
      generatorTraceId: "run-learning-other",
    });
    const otherReplay = replay(otherCandidate);

    expect(() => createLearningCandidateReview({
      nextId: fixedId,
      now,
      candidate,
      replayReport: otherReplay,
      decision: "approve",
      reason: "不能使用其他候选的回放。",
      reviewedBy: "teacher-main",
      requestId: "candidate-review-cross-boundary",
    })).toThrow("离线回放与学习候选不匹配");
  });

  it("publishes only an approved exact replay and derives stable release and rollback hashes", () => {
    const candidate = learningCandidate();
    const passedReplay = replay(candidate);
    const snapshot = structuredClone(candidate);
    const approval = createLearningCandidateReview({
      nextId: fixedId,
      now,
      candidate,
      replayReport: passedReplay,
      decision: "approve",
      reason: "固定回放全部通过。",
      reviewedBy: "teacher-main",
      requestId: "candidate-review-approved",
    });
    const release = createLearningArtifactRelease({
      nextId: fixedId,
      now,
      artifactKey: "assessment-example:rubric-media",
      courseId: "course-1",
      version: "1.0.0",
      parentReleaseId: null,
      candidate,
      review: approval,
      replayReport: passedReplay,
      publishedBy: "teacher-main",
      requestId: "publish-approved",
    });
    const repeatedRelease = createLearningArtifactRelease({
      nextId: fixedId,
      now,
      artifactKey: "assessment-example:rubric-media",
      courseId: "course-1",
      version: "1.0.0",
      parentReleaseId: null,
      candidate,
      review: approval,
      replayReport: passedReplay,
      publishedBy: "teacher-main",
      requestId: "publish-approved",
    });
    expect(candidate).toEqual(snapshot);
    expect(candidate.status).toBe("pending_review");
    expect(repeatedRelease.contentHash).toBe(release.contentHash);

    const rollback = createLearningReleaseRollback({
      nextId: fixedId,
      now,
      activeRelease: release,
      targetReleaseId: null,
      reason: "回退到无活动学习版本。",
      rolledBackBy: "teacher-main",
      requestId: "rollback-1",
    });
    const repeatedRollback = createLearningReleaseRollback({
      nextId: fixedId,
      now,
      activeRelease: repeatedRelease,
      targetReleaseId: null,
      reason: "回退到无活动学习版本。",
      rolledBackBy: "teacher-main",
      requestId: "rollback-1",
    });
    expect(repeatedRollback.rollbackHash).toBe(rollback.rollbackHash);
    expect(rollback.activeContentHash).toBe(release.contentHash);
    expect(createLearningReleaseRollback({
      nextId: fixedId,
      now,
      activeRelease: release,
      targetReleaseId: "learning-release-stable",
      reason: "回退到上一稳定版本。",
      rolledBackBy: "teacher-main",
      requestId: "rollback-2",
    }).rollbackHash).not.toBe(rollback.rollbackHash);
  });
});
