import { describe, expect, it } from "vitest";
import {
  EvaluationProposalSchema,
  LearningCandidateSchema,
  PublishLearningReleasePayloadSchema,
  ReviewAssessmentPayloadSchema,
  ReviewLearningCandidatePayloadSchema,
  RollbackLearningReleasePayloadSchema,
} from "../src/index.js";

const sha = (character: string) => character.repeat(64);

const completedProposal = {
  schemaVersion: "evaluation/1.0.0",
  proposalId: "proposal-quality",
  evaluationCaseId: "evaluation-case-1",
  caseHash: sha("a"),
  evidenceBundleHash: sha("b"),
  evaluatorKind: "work_quality",
  status: "completed",
  dimensions: [{
    dimensionId: "quality",
    scoreSuggestion: 24,
    maxScore: 30,
    reason: "作品结构清晰，且结论有固定证据。",
    evidenceRefs: ["evidence-1"],
    confidence: 0.88,
    riskFlags: [],
  }],
  overallConfidence: 0.88,
  errorCode: null,
  execution: {
    agentRunId: "agent-run-1",
    definitionVersion: "assessment-quality/1.0.0",
    promptVersion: "assessment-quality-prompt/1.0.0",
    rulesetVersion: null,
    provider: "deepseek",
    providerMode: "live",
    model: "deepseek-v4-flash",
    providerRequestId: "provider-request-1",
    inputHash: sha("c"),
    outputHash: sha("d"),
  },
  createdAt: "2026-07-25T10:00:00.000Z",
  proposalHash: sha("e"),
} as const;

describe("V0.7 evaluation and learning contracts", () => {
  it("fails closed when an unavailable evaluator attempts to carry a score", () => {
    const unavailable = {
      ...completedProposal,
      status: "unavailable",
      dimensions: [],
      overallConfidence: 0,
      errorCode: "model_output_truncated",
    } as const;
    expect(EvaluationProposalSchema.parse(unavailable)).toMatchObject({
      status: "unavailable",
      dimensions: [],
      overallConfidence: 0,
      errorCode: "model_output_truncated",
    });
    expect(() => EvaluationProposalSchema.parse({
      ...unavailable,
      dimensions: completedProposal.dimensions,
    })).toThrow("不可用评价不得伪造分数或置信度");
    expect(() => EvaluationProposalSchema.parse({
      ...unavailable,
      overallConfidence: 0.1,
    })).toThrow("不可用评价不得伪造分数或置信度");
    expect(() => EvaluationProposalSchema.parse({
      ...unavailable,
      errorCode: null,
    })).toThrow("不可用评价必须保留安全错误码");
  });

  it("keeps a learning candidate immutable in pending_review", () => {
    const candidate = {
      schemaVersion: "learning-governance/1.0.0",
      candidateId: "candidate-1",
      candidateType: "assessment_example",
      status: "pending_review",
      title: "已复核的证据评分样例",
      proposedContent: { finalScore: 91 },
      sourceEvidenceRefs: ["evidence-1"],
      sourceFinalAssessmentId: "review-1",
      evaluationCaseId: "evaluation-case-1",
      applicabilityScope: {
        courseId: "course-1",
        scenarioId: "scenario-1",
        rubricId: "rubric-1",
      },
      expectedBenefit: "校准同类评价。",
      knownRisks: ["只适用于同版量规"],
      conflictRefs: [],
      generatedBy: "learning-curator",
      generatorTraceId: "agent-run-learning",
      candidateHash: sha("f"),
      createdAt: "2026-07-25T10:00:00.000Z",
    } as const;
    expect(LearningCandidateSchema.parse(candidate).status).toBe("pending_review");
    expect(() => LearningCandidateSchema.parse({
      ...candidate,
      status: "approved",
    })).toThrow();
    expect(() => LearningCandidateSchema.parse({
      ...candidate,
      reviewedBy: "forged-teacher",
    })).toThrow();
  });

  it("requires exact CAS hashes and rejects client actor claims", () => {
    const reviewAssessment = {
      evaluationCaseId: "evaluation-case-1",
      expectedArbitrationRevision: 2,
      expectedDecisionHash: sha("1"),
      expectedEvidenceBundleHash: sha("2"),
      dimensions: [{
        dimensionId: "quality",
        finalScore: 26,
        publicFeedback: "结构完整，来源可回指。",
        overrideReason: "教师依据具体作品修正两分。",
      }],
      publicSummary: "已完成逐维复核。",
      internalNote: "本次用于评价校准。",
      requestId: "assessment-review-request-1",
    };
    expect(ReviewAssessmentPayloadSchema.parse(reviewAssessment)).toEqual(
      reviewAssessment,
    );
    expect(() => ReviewAssessmentPayloadSchema.parse({
      ...reviewAssessment,
      actorId: "forged-teacher",
    })).toThrow();

    const reviewCandidate = {
      candidateId: "candidate-1",
      expectedCandidateHash: sha("3"),
      expectedReplayReportHash: sha("4"),
      decision: "approve",
      reason: "离线回放通过。",
      requestId: "candidate-review-request-1",
    };
    expect(ReviewLearningCandidatePayloadSchema.parse(reviewCandidate)).toEqual(
      reviewCandidate,
    );
    expect(() => ReviewLearningCandidatePayloadSchema.parse({
      ...reviewCandidate,
      expectedCandidateHash: "stale",
    })).toThrow();

    const publish = {
      candidateId: "candidate-1",
      reviewId: "candidate-review-1",
      replayReportId: "replay-1",
      expectedActiveReleaseId: "learning-release-1",
      version: "1.1.0",
      requestId: "publish-request-1",
    };
    expect(PublishLearningReleasePayloadSchema.parse(publish)).toEqual(publish);
    expect(() => PublishLearningReleasePayloadSchema.parse({
      ...publish,
      version: "latest",
    })).toThrow();

    const rollback = {
      activeReleaseId: "learning-release-2",
      expectedActiveContentHash: sha("5"),
      targetReleaseId: "learning-release-1",
      reason: "线上指标回退到稳定版本。",
      requestId: "rollback-request-1",
    };
    expect(RollbackLearningReleasePayloadSchema.parse(rollback)).toEqual(
      rollback,
    );
    expect(() => RollbackLearningReleasePayloadSchema.parse({
      ...rollback,
      expectedActiveContentHash: sha("6"),
      reviewedBy: "forged-teacher",
    })).toThrow();
  });
});
