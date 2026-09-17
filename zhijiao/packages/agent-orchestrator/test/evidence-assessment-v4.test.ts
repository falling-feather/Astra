import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AssessmentCriterionIdV4Schema,
  BlindEvidenceAssessmentInputV4Schema,
  BlindEvidenceAssessmentInputV4SchemaVersion,
  FlagshipContentReferenceV4SchemaVersion,
  type BlindEvidenceAssessmentInputV4,
} from "@ronggang/contracts";
import {
  xunpuV4AdversarialPairs,
  xunpuV4AssessmentCriteria,
  xunpuV4WorkSamples,
} from "@ronggang/course-content";
import {
  evaluateBlindCriteriaV4,
  issueEvidenceAssessmentDecisionV4,
  type EvidenceAssessmentRubricV4,
  type StructuredAssessmentEvidenceCodeV4,
  type StructuredAssessmentEvidenceFactV4,
} from "../src/index.js";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const rubric: EvidenceAssessmentRubricV4 = {
  rubricVersion: "xunpu-v4-rubric-r1",
  rubricContentHash: digest(JSON.stringify(xunpuV4AssessmentCriteria)),
  reviewStatus: "pending_expert_review",
  criteria: xunpuV4AssessmentCriteria.map((criterion) => ({
    criterionId: AssessmentCriterionIdV4Schema.parse(criterion.criterionId),
    weight: criterion.weight,
    minimumIndependentEvidenceCount: criterion.minimumIndependentEvidenceCount,
  })),
};

let sequence = 0;

function fact(
  evidenceCode: StructuredAssessmentEvidenceCodeV4,
  sourceKind: StructuredAssessmentEvidenceFactV4["sourceKind"],
  key: string,
): StructuredAssessmentEvidenceFactV4 {
  sequence += 1;
  return {
    evidenceRef: `evidence-${key}-${sequence}`,
    sourceKind,
    evidenceCode,
    independenceKey: `independent-${key}-${sequence}`,
    sourceContentHash: digest(`${key}:${sequence}`),
  };
}

function blindInput(
  facts: StructuredAssessmentEvidenceFactV4[],
  surfaceSignals: BlindEvidenceAssessmentInputV4["surfaceSignals"] = {
    textLength: 0,
    keywordMatchCount: 0,
    completionClickCount: 0,
    endingKind: "unknown",
    allowedForScoring: false,
  },
): BlindEvidenceAssessmentInputV4 {
  const byKind = (kind: StructuredAssessmentEvidenceFactV4["sourceKind"]) => (
    [...new Set(facts.filter((item) => item.sourceKind === kind).map((item) => item.evidenceRef))]
  );
  const artifactRefs = byKind("artifact_revision");
  const claimRefs = byKind("claim_evidence");
  return BlindEvidenceAssessmentInputV4Schema.parse({
    schemaVersion: BlindEvidenceAssessmentInputV4SchemaVersion,
    blindCaseId: `blind-case-${digest(JSON.stringify(facts)).slice(0, 16)}`,
    flagshipContentHash: digest("flagship-content"),
    rubricVersion: rubric.rubricVersion,
    rubricContentHash: rubric.rubricContentHash,
    rubricReviewStatus: rubric.reviewStatus,
    artifactRevisions: (artifactRefs.length > 0 ? artifactRefs : ["revision-context-only"]).map(
      (revisionRef, index) => ({
        artifactRef: `artifact-${index + 1}`,
        revisionRef,
        contentHash: digest(revisionRef),
      }),
    ),
    claimEvidenceLinks: [{
      claimRef: "claim-runtime-case",
      evidenceRefs: claimRefs.length > 0 ? claimRefs : ["evidence-context-claim"],
      supportStatus: "supported",
      sourceCount: Math.max(1, claimRefs.length),
    }],
    behaviorEvidenceRefs: byKind("student_behavior").length > 0
      ? byKind("student_behavior")
      : ["behavior-context-only"],
    worldConsequenceRefs: byKind("world_consequence").length > 0
      ? byKind("world_consequence")
      : ["consequence-context-only"],
    scaffoldingEpisodeRefs: byKind("scaffolding"),
    recoveryPairRefs: byKind("recovery_pair"),
    surfaceSignals,
    excludedContextFields: [
      "student_identity",
      "binding_id",
      "challenge_level",
      "agent_advice",
      "provider_and_model",
      "prompt_and_trace",
    ],
    inputHash: digest(JSON.stringify({ facts, surfaceSignals })),
    generatedAt: "2026-08-28T15:00:00.000Z",
  });
}

const samples: Record<string, StructuredAssessmentEvidenceFactV4[]> = {
  "work-sample-01-traceable-high": [
    fact("verified_claim_supported", "claim_evidence", "clean-fact-a"),
    fact("cross_source_comparison", "student_behavior", "clean-fact-b"),
    fact("bounded_unknown", "artifact_revision", "clean-fact-c"),
    fact("rights_receipt_linked", "artifact_revision", "clean-rights-a"),
    fact("ai_disclosure_preserved", "claim_evidence", "clean-rights-b"),
    fact("withdrawal_replaced", "recovery_pair", "clean-rights-c"),
    fact("revision_pair_preserved", "recovery_pair", "clean-recovery-a"),
    fact("evidence_request_or_reasoned_rejection", "student_behavior", "clean-recovery-b"),
  ],
  "work-sample-02-polished-fabricated": [
    fact("fabricated_reference_detected", "claim_evidence", "fabricated-a"),
    fact("unsupported_claim_detected", "artifact_revision", "fabricated-b"),
    fact("completion_context_only", "artifact_revision", "fabricated-c"),
    fact("actual_media_derivative", "artifact_revision", "fabricated-media-a"),
    fact("platform_rationale_recorded", "world_consequence", "fabricated-media-b"),
  ],
  "work-sample-03-concise-supported": [
    fact("verified_claim_supported", "claim_evidence", "concise-a"),
    fact("cross_source_comparison", "student_behavior", "concise-b"),
    fact("bounded_unknown", "artifact_revision", "concise-c"),
  ],
  "work-sample-04-keyword-stuffed": [
    fact("completion_context_only", "artifact_revision", "keywords-a"),
    fact("advice_present_context_only", "scaffolding", "keywords-b"),
  ],
  "work-sample-05-blind-ai-accept": [
    fact("commercial_exchange_hidden", "student_behavior", "blind-accept-a"),
    fact("public_value_tradeoff", "artifact_revision", "blind-accept-b"),
    fact("deadline_tradeoff_evidenced", "world_consequence", "blind-accept-c"),
    fact("advice_present_context_only", "scaffolding", "blind-accept-advice"),
  ],
  "work-sample-06-evidenced-rejection": [
    fact("commercial_exchange_disclosed_or_rejected", "student_behavior", "reject-a"),
    fact("public_value_tradeoff", "artifact_revision", "reject-b"),
    fact("deadline_tradeoff_evidenced", "world_consequence", "reject-c"),
  ],
  "work-sample-07-failure-recovery": [
    fact("revision_pair_preserved", "recovery_pair", "recovery-a"),
    fact("public_correction_preserved", "world_consequence", "recovery-b"),
    fact("initial_error_preserved", "artifact_revision", "recovery-c"),
    fact("grounded_transfer_reflection", "artifact_revision", "recovery-d"),
    fact("verified_claim_supported", "claim_evidence", "recovery-fact-a"),
    fact("bounded_unknown", "artifact_revision", "recovery-fact-b"),
    fact("unsupported_claim_detected", "world_consequence", "recovery-fact-c"),
    fact("cross_source_comparison", "student_behavior", "recovery-fact-d"),
  ],
  "work-sample-08-reach-rights-breach": [
    fact("withdrawal_ignored", "world_consequence", "breach-rights-a"),
    fact("rights_receipt_linked", "artifact_revision", "breach-rights-b"),
    fact("ai_disclosure_preserved", "claim_evidence", "breach-rights-c"),
    fact("actual_media_derivative", "artifact_revision", "breach-media-a"),
    fact("cross_format_consistent", "world_consequence", "breach-media-b"),
  ],
};

function judgment(sampleId: string, criterionId: string) {
  const facts = samples[sampleId]!;
  return evaluateBlindCriteriaV4({ blindInput: blindInput(facts), evidenceFacts: facts, rubric })
    .find((item) => item.criterionId === criterionId)!;
}

describe("V4 evidence-grounded anti-gaming assessment", () => {
  it("covers the frozen eight samples and all six adversarial pair invariants", () => {
    expect(Object.keys(samples).sort()).toEqual(xunpuV4WorkSamples.map((sample) => sample.sampleId).sort());
    expect(xunpuV4AdversarialPairs).toHaveLength(6);

    expect(judgment(
      "work-sample-03-concise-supported",
      "criterion-fact-verification",
    ).band).toBe("high");
    expect(judgment(
      "work-sample-04-keyword-stuffed",
      "criterion-fact-verification",
    ).band).toBeNull();

    expect(judgment(
      "work-sample-06-evidenced-rejection",
      "criterion-editorial-judgment",
    ).score).toBeGreaterThan(judgment(
      "work-sample-05-blind-ai-accept",
      "criterion-editorial-judgment",
    ).score!);

    expect(judgment(
      "work-sample-07-failure-recovery",
      "criterion-recovery-transfer",
    ).band).toBe("high");
    expect(judgment(
      "work-sample-07-failure-recovery",
      "criterion-fact-verification",
    ).band).toBe("medium");

    expect(judgment(
      "work-sample-08-reach-rights-breach",
      "criterion-rights-governance",
    ).score).toBeLessThan(judgment(
      "work-sample-01-traceable-high",
      "criterion-rights-governance",
    ).score!);
    expect(judgment(
      "work-sample-08-reach-rights-breach",
      "criterion-multiplatform-production",
    ).band).toBe("high");

    expect(judgment(
      "work-sample-02-polished-fabricated",
      "criterion-fact-verification",
    ).evidenceStatus).toBe("insufficient");
    expect(judgment(
      "work-sample-03-concise-supported",
      "criterion-fact-verification",
    ).score).toBeGreaterThan(0);
  });

  it("ignores length, keyword and completion surfaces and excludes advice from scoring", () => {
    const facts = [
      ...samples["work-sample-03-concise-supported"]!,
      fact("advice_present_context_only", "scaffolding", "surface-advice"),
      fact("completion_context_only", "artifact_revision", "surface-completion"),
    ];
    const sparse = blindInput(facts);
    const stuffed = blindInput(facts, {
      textLength: 999_999,
      keywordMatchCount: 999,
      completionClickCount: 999,
      endingKind: "perfect_success",
      allowedForScoring: false,
    });
    const left = evaluateBlindCriteriaV4({ blindInput: sparse, evidenceFacts: facts, rubric });
    const right = evaluateBlindCriteriaV4({ blindInput: stuffed, evidenceFacts: facts, rubric });
    expect(right.map(({ rationale: _rationale, ...item }) => item))
      .toEqual(left.map(({ rationale: _rationale, ...item }) => item));
    expect(left.every((item) => item.surfaceSignalsUsed === false)).toBe(true);
  });

  it("applies challenge ceiling only after six blind evidence judgments", () => {
    const facts = [
      fact("verified_claim_supported", "claim_evidence", "all-fact-a"),
      fact("cross_source_comparison", "student_behavior", "all-fact-b"),
      fact("bounded_unknown", "artifact_revision", "all-fact-c"),
      fact("purpose_and_scope_declared", "student_behavior", "all-interview-a"),
      fact("consent_scope_recorded", "artifact_revision", "all-interview-b"),
      fact("open_followup_recorded", "world_consequence", "all-interview-c"),
      fact("public_value_tradeoff", "artifact_revision", "all-editorial-a"),
      fact("commercial_exchange_disclosed_or_rejected", "student_behavior", "all-editorial-b"),
      fact("deadline_tradeoff_evidenced", "world_consequence", "all-editorial-c"),
      fact("rights_receipt_linked", "artifact_revision", "all-rights-a"),
      fact("withdrawal_replaced", "recovery_pair", "all-rights-b"),
      fact("ai_disclosure_preserved", "claim_evidence", "all-rights-c"),
      fact("actual_media_derivative", "artifact_revision", "all-media-a"),
      fact("cross_format_consistent", "world_consequence", "all-media-b"),
      fact("revision_pair_preserved", "recovery_pair", "all-recovery-a"),
      fact("public_correction_preserved", "world_consequence", "all-recovery-b"),
    ];
    const result = issueEvidenceAssessmentDecisionV4({
      blindInput: blindInput(facts),
      evidenceFacts: facts,
      rubric,
      scoreCeiling: 80,
      challengeAdjustmentRef: "challenge-adjustment-after-blind",
      generatedAt: "2026-08-28T15:10:00.000Z",
    });
    expect(result.blindJudgments.every((item) => item.score !== null)).toBe(true);
    expect(result.rawWeightedScore).toBeGreaterThan(80);
    expect(result.decision).toMatchObject({
      status: "provisional",
      sessionScore: 80,
      adviceAgentExcluded: true,
      challengeAppliedAfterBlindAssessment: true,
      challengeAdjustmentRef: "challenge-adjustment-after-blind",
    });
  });

  it("fails the whole published score closed when one required dimension lacks evidence", () => {
    const facts = samples["work-sample-03-concise-supported"]!;
    const result = issueEvidenceAssessmentDecisionV4({
      blindInput: blindInput(facts),
      evidenceFacts: facts,
      rubric,
      scoreCeiling: 100,
      challengeAdjustmentRef: "challenge-adjustment-insufficient",
      generatedAt: "2026-08-28T15:20:00.000Z",
    });
    expect(result.decision.status).toBe("insufficient_evidence");
    expect(result.decision.sessionScore).toBeNull();
    expect(result.decision.evidenceRefs).toEqual([]);
    expect(result.decision.criterionAssessments.every(
      (criterion) => criterion.score === null && criterion.evidenceRefs.length === 0,
    )).toBe(true);
  });

  it("rejects a server fact that is not present in the blind evidence envelope", () => {
    const facts = samples["work-sample-03-concise-supported"]!;
    const forged = [{
      ...facts[0]!,
      evidenceRef: "evidence-cross-learner-forged",
    }, ...facts.slice(1)];
    expect(() => evaluateBlindCriteriaV4({
      blindInput: blindInput(facts),
      evidenceFacts: forged,
      rubric,
    })).toThrow(/不属于盲化输入/u);
  });
});
