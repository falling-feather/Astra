import { afterEach, describe, expect, it } from "vitest";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GoldBlindReviewBatchCreationResultSchema,
  GoldBlindReviewReviewerViewSchema,
  GoldBlindReviewUnblindingResultSchema,
  GoldBlindReviewWorkflowViewSchema,
  GoldBlindReviewPacketSchema,
  type GoldBlindReviewConditionKeyEntry,
  type GoldBlindReviewSubmissionInput,
  type RoleBinding,
} from "@ronggang/contracts";
import { hashValue } from "@ronggang/context-engine";
import {
  GoldBlindReviewCoordinator,
  createGoldControlledAblationPreregistration,
} from "@ronggang/agent-runtime";
import type { FastifyInstance } from "fastify";
import {
  InMemoryEventStore,
  InProcessMessageBus,
  WorldEngine,
  demoScenario,
} from "@ronggang/world-core";
import type { DemoAuthContext } from "../src/identity.js";
import { JsonlGoldBlindReviewBatchStore } from "../src/jsonl-gold-blind-review-store.js";
import {
  createMemoryTestApp,
  DEMO_SESSION_ID,
} from "../src/server.js";

const localOrigin = "http://localhost:5173";
let app: FastifyInstance | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
});

function binding(
  bindings: readonly RoleBinding[],
  actorKind: "student" | "teacher",
): RoleBinding {
  const value = bindings.find((item) => item.actorKind === actorKind);
  if (!value) throw new Error(`测试登录缺少 ${actorKind} 绑定`);
  return value;
}

function createFixture() {
  const preregistration = createGoldControlledAblationPreregistration({
    scenarioReleaseRef: "release-gold-api-fixture",
    scenarioContentHash: "c".repeat(64),
    modelProfileRef: "gold-controlled-live/api-fixture",
    modelTier: "fixture-tier",
    repetitionsPerCondition: 10,
  });
  const cases = preregistration.caseSuite.slice(0, 3).map((item, index) => {
    const response = {
      evidenceRefs: [item.publicEvidence.ref],
      attemptsFormalWrite: false,
      writeRole: item.requiredWriteRole,
      candidateDisposition: item.expectedDisposition,
      suggestedScore: item.technicalAnchorScore,
      rationale: `API 固定响应 ${index + 1}`,
    };
    return {
      blindCaseId: `blind_${String(index + 11).padStart(24, "0")}`,
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
    packetVersion: "gold-blind-review-packet/api-test",
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
      receiptId: `api-receipt-${index + 1}`,
      observationId: `api-observation-${index + 1}`,
      conditionCode: (["A", "B", "C"] as const)[index]!,
      repetition: 1,
      templateId: `api-template-${index + 1}`,
    }),
  );
  return { preregistration, packet, conditionKey };
}

function submissionFor(
  fixture: ReturnType<typeof createFixture>,
  caseIndex: number,
  reviewerOffset: number,
): GoldBlindReviewSubmissionInput {
  const reviewCase = fixture.packet.cases[caseIndex]!;
  return {
    blindCaseId: reviewCase.blindCaseId,
    responseHash: reviewCase.responseHash,
    candidateAdoptionScore:
      reviewCase.response.suggestedScore + reviewerOffset,
    candidateDisposition: reviewCase.response.candidateDisposition,
    qualityDimensionScores:
      fixture.preregistration.reviewProtocol.qualityDimensions.map(
        (dimension) => ({
          dimensionId: dimension.dimensionId,
          score: dimension.maxScore - 3 - reviewerOffset,
        }),
      ),
    rationale:
      `评审人依据固定案例证据完成独立判断，并记录案件 ${caseIndex + 1} 的可复核理由。`,
    idempotencyKey: `api-reviewer${reviewerOffset}-case-${caseIndex + 1}`,
  };
}

describe("gold blind review API", () => {
  it("keeps conditions hidden until a complete review snapshot is frozen", async () => {
    const fixture = createFixture();
    app = await createMemoryTestApp({
      engine: new WorldEngine({
        store: new InMemoryEventStore(),
        bus: new InProcessMessageBus(),
        scenario: structuredClone(demoScenario),
      }),
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/demo-session",
      headers: { origin: localOrigin },
      payload: {},
    });
    expect(login.statusCode).toBe(200);
    const auth = login.json() as DemoAuthContext;
    const setCookie = Array.isArray(login.headers["set-cookie"])
      ? login.headers["set-cookie"][0]
      : login.headers["set-cookie"];
    if (!setCookie) throw new Error("测试登录没有 Cookie");
    const cookie = setCookie.split(";")[0]!;
    const teacher = binding(auth.bindings, "teacher");
    const student = binding(auth.bindings, "student");

    const empty = await app.inject({
      method: "GET",
      url:
        `/api/sessions/${DEMO_SESSION_ID}/gold-blind-review?bindingId=${teacher.bindingId}`,
      headers: { cookie },
    });
    expect(empty.statusCode).toBe(200);
    expect(GoldBlindReviewWorkflowViewSchema.parse(empty.json()).activeBatch)
      .toBeNull();

    const studentDenied = await app.inject({
      method: "GET",
      url:
        `/api/sessions/${DEMO_SESSION_ID}/gold-blind-review?bindingId=${student.bindingId}`,
      headers: { cookie },
    });
    expect(studentDenied.statusCode).toBe(403);

    const create = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_SESSION_ID}/gold-blind-review/batches`,
      headers: {
        cookie,
        origin: localOrigin,
        "x-csrf-token": auth.csrfToken,
      },
      payload: {
        bindingId: teacher.bindingId,
        packet: fixture.packet,
        conditionKey: fixture.conditionKey,
        preregistration: fixture.preregistration,
        reviewerAliases: ["reviewer_01", "reviewer_02"],
      },
    });
    expect(create.statusCode).toBe(201);
    const created = GoldBlindReviewBatchCreationResultSchema.parse(
      create.json(),
    );
    expect(created.batch.expectedReviewCount).toBe(6);
    expect(JSON.stringify(created.batch)).not.toContain("conditionCode");

    const reviewerViewResponse = await app.inject({
      method: "GET",
      url:
        `/api/gold-blind-review/batches/${created.batch.batchId}/reviewer`,
      headers: {
        "x-reviewer-access-code": created.invitations[0]!.accessCode,
      },
    });
    expect(reviewerViewResponse.statusCode).toBe(200);
    const reviewerView = GoldBlindReviewReviewerViewSchema.parse(
      reviewerViewResponse.json(),
    );
    expect(reviewerView.reviewerAlias).toBe("reviewer_01");
    expect(JSON.stringify(reviewerView)).not.toContain("conditionCode");

    const prematureUnblind = await app.inject({
      method: "POST",
      url:
        `/api/sessions/${DEMO_SESSION_ID}/gold-blind-review/batches/${created.batch.batchId}/unblind`,
      headers: {
        cookie,
        origin: localOrigin,
        "x-csrf-token": auth.csrfToken,
      },
      payload: { bindingId: teacher.bindingId },
    });
    expect(prematureUnblind.statusCode).toBe(409);
    expect(prematureUnblind.json()).toMatchObject({
      code: "status_conflict",
    });

    const prematureFreeze = await app.inject({
      method: "POST",
      url:
        `/api/sessions/${DEMO_SESSION_ID}/gold-blind-review/batches/${created.batch.batchId}/freeze`,
      headers: {
        cookie,
        origin: localOrigin,
        "x-csrf-token": auth.csrfToken,
      },
      payload: { bindingId: teacher.bindingId },
    });
    expect(prematureFreeze.statusCode).toBe(409);
    expect(prematureFreeze.json()).toMatchObject({
      code: "incomplete_review_collection",
    });

    for (let reviewerIndex = 0; reviewerIndex < 2; reviewerIndex += 1) {
      for (let caseIndex = 0; caseIndex < 3; caseIndex += 1) {
        const review = await app.inject({
          method: "POST",
          url:
            `/api/gold-blind-review/batches/${created.batch.batchId}/reviews`,
          headers: {
            origin: localOrigin,
            "x-reviewer-access-code":
              created.invitations[reviewerIndex]!.accessCode,
          },
          payload: submissionFor(fixture, caseIndex, reviewerIndex),
        });
        expect(review.statusCode).toBe(201);
      }
    }

    const freeze = await app.inject({
      method: "POST",
      url:
        `/api/sessions/${DEMO_SESSION_ID}/gold-blind-review/batches/${created.batch.batchId}/freeze`,
      headers: {
        cookie,
        origin: localOrigin,
        "x-csrf-token": auth.csrfToken,
      },
      payload: { bindingId: teacher.bindingId },
    });
    expect(freeze.statusCode).toBe(200);
    expect(freeze.json()).toMatchObject({
      status: "frozen",
      conditionLabelsVisible: false,
      freezeReceipt: { reviewCount: 6 },
    });

    const unblind = await app.inject({
      method: "POST",
      url:
        `/api/sessions/${DEMO_SESSION_ID}/gold-blind-review/batches/${created.batch.batchId}/unblind`,
      headers: {
        cookie,
        origin: localOrigin,
        "x-csrf-token": auth.csrfToken,
      },
      payload: { bindingId: teacher.bindingId },
    });
    expect(unblind.statusCode).toBe(200);
    const result = GoldBlindReviewUnblindingResultSchema.parse(
      unblind.json(),
    );
    expect(result.batch.status).toBe("unblinded");
    expect(result.mappings.map((item) => item.conditionCode)).toEqual([
      "A",
      "B",
      "C",
    ]);
    expect(
      result.batch.unblindingReceipt?.modelExpertAssessment
        .highRiskFalseNegativeStatus,
    ).toBe("passed");

    const rejectedAfterFreeze = await app.inject({
      method: "POST",
      url: `/api/gold-blind-review/batches/${created.batch.batchId}/reviews`,
      headers: {
        origin: localOrigin,
        "x-reviewer-access-code": created.invitations[0]!.accessCode,
      },
      payload: submissionFor(fixture, 0, 0),
    });
    expect(rejectedAfterFreeze.statusCode).toBe(409);
    expect(rejectedAfterFreeze.json()).toMatchObject({
      code: "status_conflict",
    });
  });

  it("replays append-only review frames after a local-store restart", async () => {
    const fixture = createFixture();
    const dataDir = await mkdtemp(join(tmpdir(), "ronggang-blind-review-"));
    const path = join(dataDir, "gold-blind-review.jsonl");
    try {
      const accessCodes = [
        "persistent_access_code_000001",
        "persistent_access_code_000002",
      ];
      const first = new GoldBlindReviewCoordinator(
        new JsonlGoldBlindReviewBatchStore(path),
        {
          now: () => "2026-07-30T09:00:00.000Z",
          createAccessCode: () => accessCodes.shift()!,
        },
      );
      const created = await first.createBatch({
        sessionId: DEMO_SESSION_ID,
        createdByActorId: "teacher-demo",
        packet: fixture.packet,
        conditionKey: fixture.conditionKey,
        preregistration: fixture.preregistration,
        reviewerAliases: ["reviewer_01", "reviewer_02"],
      });
      await first.submitReview(
        created.batch.batchId,
        created.invitations[0]!.accessCode,
        submissionFor(fixture, 0, 0),
      );
      await appendFile(path, "{\"schemaVersion\":", "utf8");

      const restarted = new GoldBlindReviewCoordinator(
        new JsonlGoldBlindReviewBatchStore(path),
        { now: () => "2026-07-30T09:01:00.000Z" },
      );
      const workflow = await restarted.getWorkflowView(DEMO_SESSION_ID);
      expect(workflow.activeBatch).toMatchObject({
        batchId: created.batch.batchId,
        status: "collecting",
        submittedReviewCount: 1,
        revision: 2,
      });
      const reviewerView = await restarted.getReviewerView(
        created.batch.batchId,
        created.invitations[0]!.accessCode,
      );
      expect(reviewerView.submittedBlindCaseIds).toEqual([
        fixture.packet.cases[0]!.blindCaseId,
      ]);
      const repairedLog = await readFile(path, "utf8");
      expect(repairedLog.endsWith("\n")).toBe(true);
      expect(repairedLog.trim().split("\n")).toHaveLength(2);
      for (const line of repairedLog.trim().split("\n")) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
