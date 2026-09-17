import { describe, expect, it } from "vitest";
import {
  FlagshipEvidenceAssessmentAdminCaseResponseV4Schema,
  FlagshipEvidenceAssessmentResponseV4Schema,
  WorkQualityAssessmentRunReceiptV4Schema,
} from "../src/index.js";
import {
  blindEvidenceAssessmentInputV4Fixture,
  evidenceAssessmentDecisionV4Fixture,
} from "./v4-flagship.fixture.js";

const hashB = "b".repeat(64);

function assessmentResponseFixture() {
  const decision = evidenceAssessmentDecisionV4Fixture();
  return {
    assessment: {
      schemaVersion: "flagship-assessment-view/4.0.0",
      status: "final",
      safeMessage: "课程教师已依据同一证据完成逐维终裁。",
      decision,
      criteria: decision.criterionAssessments.map((criterion, index) => ({
        criterionId: criterion.criterionId,
        title: `岗位能力维度 ${index + 1}`,
        evidenceStatus: criterion.evidenceStatus,
        band: criterion.band,
        score: criterion.score,
        confidence: criterion.confidence,
        rationale: criterion.rationale,
      })),
      evidenceCoverage: {
        artifactRevisionCount: 1,
        claimLinkCount: 1,
        behaviorCount: 6,
        consequenceCount: 1,
        recoveryPairCount: 1,
      },
      rubric: {
        version: "xunpu-rubric-v4-r1",
        reviewStatus: "verified",
        classroomApplicabilityConfirmed: true,
        externalExpertValidityEstablished: false,
      },
      teacherReviewAllowed: false,
      audience: "student",
    },
  };
}

function adminCaseResponseFixture() {
  const decision = evidenceAssessmentDecisionV4Fixture();
  return {
    assessmentCase: {
      schemaVersion: "flagship-assessment-admin-case/4.0.0",
      sessionId: "session-xunpu-v4-001",
      sourceHash: hashB,
      blindInput: blindEvidenceAssessmentInputV4Fixture(),
      evidenceFacts: [{
        evidenceRef: "evidence-criterion-001",
        sourceKind: "claim_evidence",
        evidenceCode: "verified_claim_supported",
        independenceKey: "independence-verified-claim",
        sourceContentHash: hashB,
      }],
      blindJudgments: decision.criterionAssessments,
      rawWeightedScore: 90,
      scoreCeiling: 95,
      qualityRuns: [{
        qualityRunRef: "quality-run-v4-001",
        inputHash: decision.blindInputHash,
        outputHash: hashB,
        mode: "deterministic_fallback",
        fallbackReason: "model_not_configured",
        providerId: null,
        modelId: null,
        traceRef: null,
        latencyMs: null,
        estimatedCostMicros: 0,
        createdAt: "2026-08-28T04:11:00.000Z",
      }],
      decisionHistory: [{ sourceHash: hashB, decision }],
      reviewReceipts: [{
        requestId: "request-review-v4-001",
        requestHash: hashB,
        sourceAssessmentDecisionId: decision.assessmentDecisionId,
        resultAssessmentDecisionId: decision.assessmentDecisionId,
        reviewerId: "teacher-v4-001",
        status: "confirmed",
        rubricApplicabilityConfirmed: true,
        changedCriterionIds: [],
        createdAt: "2026-08-28T04:12:00.000Z",
      }],
      antiGaming: {
        surfaceSignalsUsed: false,
        adviceAgentExcluded: true,
        challengeAppliedAfterBlindAssessment: true,
      },
    },
  };
}

describe("flagship assessment public V4 contracts", () => {
  it("accepts the role-safe public view and complete administrator audit case", () => {
    expect(
      FlagshipEvidenceAssessmentResponseV4Schema.parse(assessmentResponseFixture())
        .assessment.status,
    ).toBe("final");
    expect(
      FlagshipEvidenceAssessmentAdminCaseResponseV4Schema.parse(
        adminCaseResponseFixture(),
      ).assessmentCase.qualityRuns,
    ).toHaveLength(1);
  });

  it("rejects a student-authored review capability and missing administrator receipts", () => {
    const forgedStudent = assessmentResponseFixture();
    forgedStudent.assessment.teacherReviewAllowed = true;
    expect(() => FlagshipEvidenceAssessmentResponseV4Schema.parse(forgedStudent))
      .toThrow();

    const incompleteAdmin = adminCaseResponseFixture() as Record<string, any>;
    delete incompleteAdmin.assessmentCase.qualityRuns;
    expect(() => FlagshipEvidenceAssessmentAdminCaseResponseV4Schema.parse(incompleteAdmin))
      .toThrow();
  });

  it("rejects a live quality run without an all-or-none provider receipt", () => {
    expect(() => WorkQualityAssessmentRunReceiptV4Schema.parse({
      qualityRunRef: "quality-run-v4-live-forged",
      inputHash: hashB,
      outputHash: hashB,
      mode: "independent_live_agent",
      fallbackReason: null,
      providerId: "provider-live",
      modelId: null,
      traceRef: null,
      latencyMs: null,
      estimatedCostMicros: 1,
      createdAt: "2026-08-28T04:11:00.000Z",
    })).toThrow();
  });

  it("rejects receipts that claim media exposure before the rights gate", () => {
    const base = adminCaseResponseFixture().assessmentCase.qualityRuns[0]!;
    expect(() => WorkQualityAssessmentRunReceiptV4Schema.parse({
      ...base,
      mode: "deterministic_fallback",
      fallbackReason: "media_not_eligible",
      providerId: null,
      modelId: null,
      traceRef: null,
      latencyMs: null,
      mediaObservation: {
        preparationStatus: "not_eligible",
        expectedAssetCount: 1,
        preparedInputCount: 1,
        representationKinds: ["image_preview"],
        inputContentHashes: [hashB],
        providerInvocationIncludedMedia: true,
        limitations: ["权利门失败。"],
      },
    })).toThrow();
  });
});
