import { describe, expect, it } from "vitest";
import {
  GoldBlindReviewPacketSchema,
  type GoldBlindReviewConditionKeyEntry,
  type GoldBlindReviewSubmissionInput,
} from "@ronggang/contracts";
import { hashValue } from "@ronggang/context-engine";
import {
  GoldBlindReviewCoordinator,
  InMemoryGoldBlindReviewBatchStore,
  createGoldControlledAblationPreregistration,
} from "../src/index.js";

function createFixture() {
  const preregistration = createGoldControlledAblationPreregistration({
    scenarioReleaseRef: "release-gold-fixture",
    scenarioContentHash: "a".repeat(64),
    modelProfileRef: "gold-controlled-live/fixture",
    modelTier: "fixture-tier",
    repetitionsPerCondition: 10,
  });
  const selectedCases = preregistration.caseSuite.slice(0, 3);
  const cases = selectedCases.map((item, index) => {
    const response = {
      evidenceRefs: [item.publicEvidence.ref],
      attemptsFormalWrite: false,
      writeRole: item.requiredWriteRole,
      candidateDisposition: item.expectedDisposition,
      suggestedScore: item.technicalAnchorScore,
      rationale: `固定模型响应 ${index + 1}`,
    };
    return {
      blindCaseId: `blind_${String(index + 1).padStart(24, "0")}`,
      domain: item.domain,
      reviewContext: {
        caseRef: item.caseRef,
        label: item.label,
        task: item.task,
        publicEvidence: item.publicEvidence,
        rolePrivateEvidence: item.rolePrivateEvidence,
        authoritativeFact: item.authoritativeFact,
        candidateClaim: item.candidateClaim,
      },
      response,
      responseHash: hashValue(response),
      rubricRef: preregistration.reviewProtocol.rubricRef,
    };
  });
  const unsignedPacket = {
    packetVersion: "gold-blind-review-packet/test-1",
    conditionLabelsHidden: true as const,
    reviewProtocol: preregistration.reviewProtocol,
    cases,
  };
  const packet = GoldBlindReviewPacketSchema.parse({
    ...unsignedPacket,
    packetHash: hashValue(unsignedPacket),
  });
  const conditionKey: GoldBlindReviewConditionKeyEntry[] = cases.map(
    (reviewCase, index) => ({
      blindCaseId: reviewCase.blindCaseId,
      receiptId: `receipt-${index + 1}`,
      observationId: `observation-${index + 1}`,
      conditionCode: (["A", "B", "C"] as const)[index]!,
      repetition: 1,
      templateId: `template-${index + 1}`,
    }),
  );
  return { preregistration, packet, conditionKey };
}

function createClock(): () => string {
  let index = 0;
  return () => new Date(
    Date.UTC(2026, 6, 30, 8, 0, index++),
  ).toISOString();
}

function submissionFor(
  fixture: ReturnType<typeof createFixture>,
  caseIndex: number,
  reviewerOffset: number,
): GoldBlindReviewSubmissionInput {
  const reviewCase = fixture.packet.cases[caseIndex]!;
  const scores = fixture.preregistration.reviewProtocol.qualityDimensions.map(
    (dimension, dimensionIndex) => ({
      dimensionId: dimension.dimensionId,
      score: Math.max(
        0,
        dimension.maxScore - 4 - reviewerOffset - (caseIndex % 2)
          + (dimensionIndex % 2),
      ),
    }),
  );
  return {
    blindCaseId: reviewCase.blindCaseId,
    responseHash: reviewCase.responseHash,
    candidateAdoptionScore:
      reviewCase.response.suggestedScore + reviewerOffset,
    candidateDisposition: reviewCase.response.candidateDisposition,
    qualityDimensionScores: scores,
    rationale:
      `评审依据固定上下文、权威事实与职责边界完成独立判断，案件序号 ${caseIndex + 1}。`,
    idempotencyKey: `reviewer${reviewerOffset}-case-${caseIndex + 1}`,
  };
}

describe("GoldBlindReviewCoordinator", () => {
  it("collects deidentified reviews, freezes a complete snapshot, then unblinds", async () => {
    const fixture = createFixture();
    const accessCodes = [
      "reviewer_access_code_00000001",
      "reviewer_access_code_00000002",
    ];
    const coordinator = new GoldBlindReviewCoordinator(
      new InMemoryGoldBlindReviewBatchStore(),
      {
        now: createClock(),
        createAccessCode: () => accessCodes.shift()!,
      },
    );
    const created = await coordinator.createBatch({
      sessionId: "demo-local-tourism",
      createdByActorId: "teacher-demo",
      packet: fixture.packet,
      conditionKey: fixture.conditionKey,
      preregistration: fixture.preregistration,
      reviewerAliases: ["reviewer_01", "reviewer_02"],
    });
    expect(created.batch.status).toBe("collecting");
    expect(created.batch.expectedReviewCount).toBe(6);
    expect(created.invitations.map((item) => item.reviewerAlias)).toEqual([
      "reviewer_01",
      "reviewer_02",
    ]);
    expect(JSON.stringify(created.batch)).not.toContain("conditionCode");
    expect(JSON.stringify(created.batch)).not.toContain(
      fixture.conditionKey[0]!.receiptId,
    );

    const reviewerView = await coordinator.getReviewerView(
      created.batch.batchId,
      created.invitations[0]!.accessCode,
    );
    expect(reviewerView.packet.cases).toHaveLength(3);
    expect(reviewerView.progress.submittedCaseCount).toBe(0);
    expect(JSON.stringify(reviewerView)).not.toContain("conditionCode");

    await expect(
      coordinator.freezeBatch(created.batch.batchId),
    ).rejects.toMatchObject({
      code: "incomplete_review_collection",
    });
    await expect(
      coordinator.submitReview(
        created.batch.batchId,
        created.invitations[0]!.accessCode,
        {
          ...submissionFor(fixture, 0, 0),
          responseHash: "f".repeat(64),
        },
      ),
    ).rejects.toMatchObject({
      code: "invalid_review",
    });

    for (let reviewerIndex = 0; reviewerIndex < 2; reviewerIndex += 1) {
      for (let caseIndex = 0; caseIndex < 3; caseIndex += 1) {
        await coordinator.submitReview(
          created.batch.batchId,
          created.invitations[reviewerIndex]!.accessCode,
          submissionFor(fixture, caseIndex, reviewerIndex),
        );
      }
    }
    const duplicate = await coordinator.submitReview(
      created.batch.batchId,
      created.invitations[0]!.accessCode,
      submissionFor(fixture, 0, 0),
    );
    expect(duplicate.batch.submittedReviewCount).toBe(6);
    expect(duplicate.review.reviewerAlias).toBe("reviewer_01");

    const frozen = await coordinator.freezeBatch(created.batch.batchId);
    expect(frozen.status).toBe("frozen");
    expect(frozen.freezeReceipt).toMatchObject({
      reviewerCount: 2,
      caseCount: 3,
      reviewCount: 6,
    });
    expect(frozen.conditionLabelsVisible).toBe(false);
    await expect(
      coordinator.submitReview(
        created.batch.batchId,
        created.invitations[0]!.accessCode,
        submissionFor(fixture, 0, 0),
      ),
    ).rejects.toMatchObject({
      code: "status_conflict",
    });

    const result = await coordinator.unblindBatch(created.batch.batchId);
    expect(result.batch.status).toBe("unblinded");
    expect(result.batch.conditionLabelsVisible).toBe(true);
    expect(result.mappings.map((item) => item.conditionCode)).toEqual([
      "A",
      "B",
      "C",
    ]);
    expect(
      result.batch.unblindingReceipt?.agreement.candidateDisposition,
    ).toMatchObject({ value: 1, status: "passed" });
    expect(
      result.batch.unblindingReceipt?.agreement.candidateAdoptionScore.status,
    ).toBe("passed");
    expect(
      result.batch.unblindingReceipt?.modelExpertAssessment,
    ).toMatchObject({
      assessedCaseCount: 3,
      meanAbsoluteErrorPct: 0.5,
      meanAbsoluteErrorStatus: "passed",
      highRiskCaseCount: 1,
      highRiskAssessableCount: 1,
      highRiskFalseNegativeCount: 0,
      highRiskFalseNegativeStatus: "passed",
    });
  });

  it("rejects packet tampering and score-band contradictions", async () => {
    const fixture = createFixture();
    let accessCodeIndex = 3;
    const coordinator = new GoldBlindReviewCoordinator(
      new InMemoryGoldBlindReviewBatchStore(),
      {
        now: createClock(),
        createAccessCode: () => (
          `reviewer_access_code_${String(accessCodeIndex++).padStart(8, "0")}`
        ),
      },
    );
    await expect(coordinator.createBatch({
      sessionId: "demo-local-tourism",
      createdByActorId: "teacher-demo",
      packet: {
        ...fixture.packet,
        cases: fixture.packet.cases.map((item, index) => (
          index === 0
            ? { ...item, responseHash: "b".repeat(64) }
            : item
        )),
      },
      conditionKey: fixture.conditionKey,
      preregistration: fixture.preregistration,
      reviewerAliases: ["reviewer_01", "reviewer_02"],
    })).rejects.toMatchObject({
      code: "invalid_batch_input",
    });

    const created = await coordinator.createBatch({
      sessionId: "demo-local-tourism",
      createdByActorId: "teacher-demo",
      packet: fixture.packet,
      conditionKey: fixture.conditionKey,
      preregistration: fixture.preregistration,
      reviewerAliases: ["reviewer_01", "reviewer_02"],
    });
    await expect(coordinator.submitReview(
      created.batch.batchId,
      created.invitations[0]!.accessCode,
      {
        ...submissionFor(fixture, 0, 0),
        candidateAdoptionScore: 90,
      },
    )).rejects.toMatchObject({
      code: "invalid_review",
    });
  });
});
